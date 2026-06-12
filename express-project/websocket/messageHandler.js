/**
 * WebSocket 消息处理器
 * 处理聊天相关的各类 WebSocket 事件
 */

const { getDB } = require('../utils/db');
const { sanitizeContent } = require('../utils/contentSecurity');
const connectionManager = require('./connectionManager');

// 编辑/撤回时限：2 分钟
const EDIT_RECALL_LIMIT = 2 * 60 * 1000;

/**
 * 处理 WebSocket 收到的消息
 * @param {WebSocket} ws - WebSocket 连接实例
 * @param {string} userId - 当前用户 ID
 * @param {Object} message - 解析后的消息对象 { type, ... }
 */
async function handleMessage(ws, userId, message) {
  try {
    if (!message || !message.type) {
      ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
      return;
    }

    switch (message.type) {
      case 'send_message':
      case 'chat':
        await handleSendMessage(ws, userId, message);
        break;
      case 'mark_read':
      case 'read':
        await handleMarkRead(ws, userId, message);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'edit_message':
        await handleEditMessage(ws, userId, message);
        break;
      case 'recall_message':
        await handleRecallMessage(ws, userId, message);
        break;
      case 'typing':
        await handleTyping(ws, userId, message);
        break;
      case 'add_reaction':
      case 'toggle_reaction':
        await handleToggleReaction(ws, userId, message);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: `未知的事件类型: ${message.type}` }));
    }
  } catch (error) {
    console.error('[MessageHandler] 处理消息失败:', error);
    try {
      ws.send(JSON.stringify({ type: 'error', message: '服务器内部错误' }));
    } catch (sendErr) {
      // 发送失败时忽略，避免因单个消息处理错误导致崩溃
    }
  }
}

/**
 * 处理发送消息事件
 */
async function handleSendMessage(ws, userId, message) {
  const { conversation_id, content, type = 'text', reply_to } = message.data || message;

  // 参数验证
  if (!conversation_id || !content) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少必要参数: conversation_id 或 content' }));
    return;
  }

  const db = getDB();

  // 验证用户是否为该会话的成员
  const membership = await db('conversation_members')
    .where({
      conversation_id,
      user_id: userId
    })
    .first();

  if (!membership) {
    ws.send(JSON.stringify({ type: 'error', message: '您不是该会话的成员' }));
    return;
  }

  // 过滤消息内容（仅对文字消息进行安全过滤）
  const sanitizedContent = type === 'text' ? sanitizeContent(content) : content;

  // 写入消息到 messages 表
  const [insertedMessage] = await db('messages')
    .insert({
      conversation_id,
      sender_id: userId,
      type,
      content: sanitizedContent,
      reply_to: reply_to || null
    })
    .returning(['id', 'conversation_id', 'sender_id', 'type', 'content', 'reply_to', 'created_at', 'edited_at']);

  // 更新会话的 last_message_at
  await db('conversations')
    .where({ id: conversation_id })
    .update({ last_message_at: db.fn.now() });

  // 获取会话信息以判断类型
  const conversation = await db('conversations')
    .where({ id: conversation_id })
    .first();

  // 递增接收者的 unread_count
  if (conversation.type === 'private') {
    // 私聊：递增对方的未读计数
    await db('conversation_members')
      .where({
        conversation_id,
        user_id: userId
      })
      .update({ unread_count: 0 }); // 发送者自己的未读清零

    await db('conversation_members')
      .where({
        conversation_id
      })
      .whereNot({ user_id: userId })
      .increment('unread_count', 1);
  } else {
    // 群聊：递增除发送者外所有成员的未读计数
    await db('conversation_members')
      .where({
        conversation_id,
        user_id: userId
      })
      .update({ unread_count: 0 }); // 发送者自己的未读清零

    await db('conversation_members')
      .where({
        conversation_id
      })
      .whereNot({ user_id: userId })
      .increment('unread_count', 1);
  }

  // 获取发送者信息
  const sender = await db('users')
    .where({ id: userId })
    .select('id', 'nickname', 'avatar')
    .first();

  // 构建推送数据
  const pushData = {
    type: 'new_message',
    data: {
      id: insertedMessage.id,
      conversation_id: insertedMessage.conversation_id,
      sender_id: insertedMessage.sender_id,
      type: insertedMessage.type,
      content: insertedMessage.content,
      reply_to: insertedMessage.reply_to,
      created_at: insertedMessage.created_at,
      edited_at: insertedMessage.edited_at,
      sender: sender ? { id: sender.id, nickname: sender.nickname, avatar: sender.avatar } : null
    }
  };

  // 回显给发送者
  try {
    ws.send(JSON.stringify(pushData));
  } catch (err) {
    console.error('[MessageHandler] 回显消息给发送者失败:', err.message);
  }

  // 推送给接收者/群成员
  try {
    const otherMembers = await db('conversation_members')
      .where({ conversation_id })
      .whereNot({ user_id: userId })
      .select('user_id');

    const otherUserIds = otherMembers.map(m => m.user_id);
    connectionManager.broadcastToUsers(otherUserIds, pushData);
  } catch (err) {
    console.error('[MessageHandler] 推送消息给其他成员失败:', err.message);
  }

  // 触发经济任务（发送消息奖励）
  await triggerEconomyTask(db, userId, 'send_message');
}

/**
 * 处理已读事件
 */
async function handleMarkRead(ws, userId, message) {
  const { conversation_id } = message.data || message;

  if (!conversation_id) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少必要参数: conversation_id' }));
    return;
  }

  const db = getDB();

  // 清零当前用户在该会话的 unread_count
  await db('conversation_members')
    .where({
      conversation_id,
      user_id: userId
    })
    .update({ unread_count: 0 });

  // 获取更新后的未读数
  const member = await db('conversation_members')
    .where({
      conversation_id,
      user_id: userId
    })
    .first();

  // 推送 unread_update 给当前用户的所有连接
  const updateData = {
    type: 'unread_update',
    data: {
      conversation_id,
      unread_count: member ? member.unread_count : 0
    }
  };

  connectionManager.broadcastToUser(userId, updateData);
}

/**
 * 处理编辑消息事件
 */
async function handleEditMessage(ws, userId, message) {
  const { message_id, content } = message.data || message;

  if (!message_id || !content) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少必要参数: message_id 或 content' }));
    return;
  }

  const db = getDB();

  // 查找原始消息
  const originalMessage = await db('messages')
    .where({ id: message_id })
    .first();

  if (!originalMessage) {
    ws.send(JSON.stringify({ type: 'error', message: '消息不存在' }));
    return;
  }

  // 验证是否为消息发送者
  if (originalMessage.sender_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只能编辑自己的消息' }));
    return;
  }

  // 验证 2 分钟时限
  const now = Date.now();
  const createdAt = new Date(originalMessage.created_at).getTime();
  if (now - createdAt > EDIT_RECALL_LIMIT) {
    ws.send(JSON.stringify({ type: 'error', message: '超过 2 分钟，无法编辑' }));
    return;
  }

  // 过滤编辑后的内容
  const sanitizedContent = sanitizeContent(content);

  // 更新消息
  await db('messages')
    .where({ id: message_id })
    .update({
      content: sanitizedContent,
      edited_at: db.fn.now()
    });

  // 构建推送数据
  const pushData = {
    type: 'message_edited',
    data: {
      id: message_id,
      conversation_id: originalMessage.conversation_id,
      content: sanitizedContent,
      edited_at: new Date().toISOString()
    }
  };

  // 推送给会话所有在线成员
  await broadcastToConversation(db, originalMessage.conversation_id, pushData, userId);
}

/**
 * 处理撤回消息事件
 */
async function handleRecallMessage(ws, userId, message) {
  const { message_id } = message.data || message;

  if (!message_id) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少必要参数: message_id' }));
    return;
  }

  const db = getDB();

  // 查找原始消息
  const originalMessage = await db('messages')
    .where({ id: message_id })
    .first();

  if (!originalMessage) {
    ws.send(JSON.stringify({ type: 'error', message: '消息不存在' }));
    return;
  }

  // 验证是否为消息发送者
  if (originalMessage.sender_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只能撤回自己的消息' }));
    return;
  }

  // 验证 2 分钟时限
  const now = Date.now();
  const createdAt = new Date(originalMessage.created_at).getTime();
  if (now - createdAt > EDIT_RECALL_LIMIT) {
    ws.send(JSON.stringify({ type: 'error', message: '超过 2 分钟，无法撤回' }));
    return;
  }

  // 将消息类型改为 system，内容改为 [已撤回]
  await db('messages')
    .where({ id: message_id })
    .update({
      type: 'system',
      content: '[已撤回]'
    });

  // 构建推送数据
  const pushData = {
    type: 'message_recalled',
    data: {
      id: message_id,
      conversation_id: originalMessage.conversation_id
    }
  };

  // 推送给会话所有在线成员
  await broadcastToConversation(db, originalMessage.conversation_id, pushData, userId);
}

/**
 * 处理正在输入事件
 */
async function handleTyping(ws, userId, message) {
  const { conversation_id } = message.data || message;

  if (!conversation_id) return;

  const db = getDB();

  // 获取会话中其他在线成员
  const members = await db('conversation_members')
    .where({ conversation_id })
    .whereNot({ user_id: userId })
    .select('user_id');

  const otherUserIds = members.map(m => m.user_id);

  // 广播给同一会话的其他在线成员
  const typingData = {
    type: 'typing',
    data: {
      conversation_id,
      user_id: userId
    }
  };

  connectionManager.broadcastToUsers(otherUserIds, typingData);
}

/**
 * 向会话所有在线成员广播消息（可选排除某用户）
 * @param {Object} db - Knex 实例
 * @param {string} conversationId - 会话ID
 * @param {Object} data - 推送数据
 * @param {string|null} excludeUserId - 要排除的用户ID（可选）
 */
async function broadcastToConversation(db, conversationId, data, excludeUserId = null) {
  try {
    const members = await db('conversation_members')
      .where({ conversation_id: conversationId })
      .select('user_id');

    const memberUserIds = members.map(m => m.user_id);

    // 如果需要排除某个用户
    const targetUserIds = excludeUserId
      ? memberUserIds.filter(id => id !== excludeUserId)
      : memberUserIds;

    connectionManager.broadcastToUsers(targetUserIds, data);
  } catch (err) {
    console.error('[MessageHandler] 广播给会话成员失败:', err.message);
  }
}

/**
 * 触发经济任务
 * @param {Object} db - Knex 实例
 * @param {string} userId - 用户ID
 * @param {string} action - 任务动作
 */
async function triggerEconomyTask(db, userId, action) {
  try {
    // 尝试导入经济系统模块
    const { ensureEconomyRecord, ensureLevelRecord, addExp } = require('../routes/economyShared');

    // 确保用户经济记录存在
    await ensureEconomyRecord(db, userId);
    await ensureLevelRecord(db, userId);

    // 根据动作类型给予经验奖励
    switch (action) {
      case 'send_message':
        await addExp(db, userId, 2, 'send_message');
        break;
      default:
        break;
    }
  } catch (err) {
    // 经济任务触发失败不影响消息发送
    console.error('[MessageHandler] 触发经济任务失败:', err.message);
  }
}

/**
 * 处理表情回应（toggle：有则删除，无则添加）
 */
async function handleToggleReaction(ws, userId, message) {
  const { message_id, emoji } = message.data || message;

  if (!message_id || !emoji) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少必要参数' }));
    return;
  }

  const db = getDB();

  // 验证消息存在
  const msg = await db('messages').where({ id: message_id }).first();
  if (!msg) {
    ws.send(JSON.stringify({ type: 'error', message: '消息不存在' }));
    return;
  }

  // 检查是否已有该表情
  const existing = await db('message_reactions')
    .where({ message_id, user_id: userId, emoji })
    .first();

  let action;
  if (existing) {
    await db('message_reactions').where({ id: existing.id }).del();
    action = 'removed';
  } else {
    await db('message_reactions').insert({ message_id, user_id: userId, emoji });
    action = 'added';
  }

  // 获取该消息的所有表情回应统计
  const reactions = await db('message_reactions')
    .where({ message_id })
    .select('emoji')
    .count('id as count')
    .groupBy('emoji');

  const reactionSummary = reactions.map(r => ({
    emoji: r.emoji,
    count: parseInt(r.count)
  }));

  // 推送给会话所有成员
  const pushData = {
    type: 'reaction_updated',
    data: {
      message_id,
      conversation_id: msg.conversation_id,
      user_id: userId,
      emoji,
      action,
      reactions: reactionSummary
    }
  };

  await broadcastToConversation(db, msg.conversation_id, pushData);
}

module.exports = {
  handleMessage
};
