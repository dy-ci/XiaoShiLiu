const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { getDB } = require('../utils/db');
const { authenticateToken } = require('../middleware/auth');
const responseHelper = require('../utils/responseHelper');
const connectionManager = require('../websocket/connectionManager');

// ==================== 辅助函数 ====================

/**
 * 验证当前用户是否为指定会话的成员
 * @param {object} db - 数据库实例
 * @param {string} conversationId - 会话ID
 * @param {string} userId - 用户ID
 * @returns {object|null} 成员记录，非成员返回 null
 */
async function verifyConversationMember(db, conversationId, userId) {
  const member = await db('conversation_members')
    .where({ conversation_id: conversationId, user_id: userId })
    .first();
  return member;
}

/**
 * 获取用户在会话中的角色
 * @param {object} db - 数据库实例
 * @param {string} conversationId - 会话ID
 * @param {string} userId - 用户ID
 * @returns {string|null} 角色（owner/admin/member），非成员返回 null
 */
async function getMemberRole(db, conversationId, userId) {
  const member = await db('conversation_members')
    .where({ conversation_id: conversationId, user_id: userId })
    .select('role')
    .first();
  return member ? member.role : null;
}

/**
 * 发送系统消息到指定会话
 * @param {object} db - 数据库实例
 * @param {string} conversationId - 会话ID
 * @param {string} content - 系统消息内容
 * @returns {object} 插入的消息记录
 */
async function sendSystemMessage(db, conversationId, content) {
  const [inserted] = await db('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: null,
      type: 'system',
      content
    })
    .returning('id');

  // 更新会话的 last_message_at
  await db('conversations')
    .where({ id: conversationId })
    .update({ last_message_at: db.fn.now() });

  return inserted;
}

/**
 * 广播消息到会话的所有成员
 * @param {object} db - 数据库实例
 * @param {string} conversationId - 会话ID
 * @param {object} data - 广播数据
 * @param {string} excludeUserId - 排除的用户ID（可选）
 */
async function broadcastToConversation(db, conversationId, data, excludeUserId) {
  const members = await db('conversation_members')
    .where({ conversation_id: conversationId })
    .select('user_id');

  const memberIds = members
    .map(m => String(m.user_id))
    .filter(id => id !== String(excludeUserId));

  connectionManager.broadcastToUsers(memberIds, data);
}

// ==================== 会话管理 ====================

// 1. 获取当前用户的会话列表
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // 查询当前用户的会话成员关系
    const conversations = await db({ cm: 'conversation_members' })
      .leftJoin({ c: 'conversations' }, 'cm.conversation_id', 'c.id')
      .leftJoin({ m: 'messages' }, function () {
        this.on('m.id', '=', db.raw(
          '(SELECT msg.id FROM messages msg WHERE msg.conversation_id = c.id ORDER BY msg.created_at DESC LIMIT 1)'
        ));
      })
      .leftJoin({ u: 'users' }, 'm.sender_id', 'u.id')
      .where('cm.user_id', userId)
      .select(
        'c.id', 'c.type', 'c.title', 'c.avatar_url',
        'c.last_message_at', 'c.created_at',
        'cm.unread_count', 'cm.is_muted', 'cm.role',
        'm.id as last_message_id', 'm.content as last_message_content',
        'm.type as last_message_type', 'm.created_at as last_message_time',
        'u.id as last_sender_id', 'u.nickname as last_sender_nickname',
        'u.avatar as last_sender_avatar'
      )
      .orderBy('c.last_message_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    const countResult = await db('conversation_members')
      .where({ user_id: userId })
      .count('* as total')
      .first();
    const total = parseInt(countResult.total);

    // 对于私聊会话，获取对方的用户信息
    if (conversations.length > 0) {
      for (const conv of conversations) {
        if (conv.type === 'private') {
          const otherMember = await db({ cm2: 'conversation_members' })
            .leftJoin({ u2: 'users' }, 'cm2.user_id', 'u2.id')
            .where({
              'cm2.conversation_id': conv.id,
            })
            .whereNot('cm2.user_id', userId)
            .select('u2.id', 'u2.nickname', 'u2.avatar')
            .first();

          conv.other_user = otherMember ? {
            id: otherMember.id,
            nickname: otherMember.nickname,
            avatar: otherMember.avatar
          } : null;
        }
      }
    }

    responseHelper.success(res, {
      conversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取会话列表失败:', error);
    responseHelper.handleError(error, res, '获取会话列表');
  }
});

// 2. 获取与指定用户的私聊会话（不存在则自动创建）
router.get('/conversations/with/:userId', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const currentUserId = req.user.id;
    const targetUserId = req.params.userId;

    // 验证目标用户是否存在
    const targetUser = await db('users').where({ id: targetUserId }).select('id', 'nickname', 'avatar').first();
    if (!targetUser) {
      return responseHelper.error(res, '目标用户不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 不能和自己私聊
    if (String(currentUserId) === String(targetUserId)) {
      return responseHelper.error(res, '不能与自己创建私聊会话', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 检查是否是好友（需要是好友才能私聊）
    const isFriend = await db('friends')
      .where({ user_id: currentUserId, friend_id: targetUserId })
      .first();
    if (!isFriend) {
      return responseHelper.error(res, '需要先添加好友才能聊天', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 查找是否已存在两人之间的私聊会话
    const existingConversation = await db({ cm1: 'conversation_members' })
      .join({ cm2: 'conversation_members' }, function () {
        this.on('cm1.conversation_id', '=', 'cm2.conversation_id')
          .andOn('cm1.user_id', '=', db.raw(String(currentUserId)))
          .andOn('cm2.user_id', '=', db.raw(String(targetUserId)));
      })
      .join({ c: 'conversations' }, 'cm1.conversation_id', 'c.id')
      .where({ 'c.type': 'private' })
      .select('c.id', 'c.type', 'c.title', 'c.avatar_url', 'c.last_message_at', 'c.created_at')
      .first();

    if (existingConversation) {
      return responseHelper.success(res, existingConversation);
    }

    // 不存在则自动创建
    const [newConvId] = await db('conversations')
      .insert({
        type: 'private',
        title: '',
        avatar_url: null,
        last_message_at: db.fn.now()
      })
      .returning('id');

    // 添加双方为成员
    await db('conversation_members').insert([
      { conversation_id: newConvId.id, user_id: currentUserId, role: 'member', unread_count: 0, is_muted: 0 },
      { conversation_id: newConvId.id, user_id: targetUserId, role: 'member', unread_count: 0, is_muted: 0 }
    ]);

    const newConversation = await db('conversations')
      .where({ id: newConvId.id })
      .select('id', 'type', 'title', 'avatar_url', 'last_message_at', 'created_at')
      .first();

    responseHelper.success(res, newConversation, '私聊会话创建成功');
  } catch (error) {
    console.error('获取/创建私聊会话失败:', error);
    responseHelper.handleError(error, res, '获取/创建私聊会话');
  }
});

// 3. 获取会话详情
router.get('/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;

    // 验证当前用户是该会话成员
    const member = await verifyConversationMember(db, conversationId, userId);
    if (!member) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 获取会话基本信息
    const conversation = await db('conversations')
      .where({ id: conversationId })
      .first();

    if (!conversation) {
      return responseHelper.error(res, '会话不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 获取成员列表（含用户头像、昵称、角色）
    const members = await db({ cm: 'conversation_members' })
      .leftJoin({ u: 'users' }, 'cm.user_id', 'u.id')
      .where('cm.conversation_id', conversationId)
      .select('cm.user_id', 'cm.role', 'cm.unread_count', 'cm.is_muted', 'cm.joined_at',
        'u.nickname', 'u.avatar')
      .orderBy('cm.joined_at', 'asc');

    conversation.members = members;

    responseHelper.success(res, conversation);
  } catch (error) {
    console.error('获取会话详情失败:', error);
    responseHelper.handleError(error, res, '获取会话详情');
  }
});

// 4. 创建群聊
router.post('/conversations/group', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const { title, memberIds } = req.body;

    // 验证必填字段
    if (!title || typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 20) {
      return responseHelper.error(res, '群聊标题长度需在2-20个字符之间', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    if (!Array.isArray(memberIds) || memberIds.length < 2 || memberIds.length > 50) {
      console.log('[创建群聊] memberIds 类型错误:', typeof memberIds, Array.isArray(memberIds), JSON.stringify(memberIds));
      return responseHelper.error(res, '群聊成员数量需在2-50人之间', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证所有目标用户存在
    const stringIds = memberIds.map(id => String(id));
    console.log('[创建群聊] 查找用户 IDs:', stringIds);
    const existingUsers = await db('users')
      .whereIn('id', stringIds)
      .select('id')
      .catch((err) => {
        console.error('[创建群聊] 查询用户失败:', err);
        return [];
      });

    console.log('[创建群聊] 找到用户:', existingUsers.map(u => String(u.id)));

    const existingUserIds = new Set(existingUsers.map(u => String(u.id)));
    const invalidIds = memberIds.filter(id => !existingUserIds.has(String(id)));
    if (invalidIds.length > 0) {
      return responseHelper.error(res, '部分用户不存在', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 创建会话记录
    const [newConv] = await db('conversations')
      .insert({
        type: 'group',
        title: title.trim(),
        avatar_url: null,
        last_message_at: db.fn.now()
      })
      .returning('id');

    const convId = newConv.id;

    // 批量添加成员（创建者为 owner，其他为 member）
    const memberRecords = [
      { conversation_id: convId, user_id: userId, role: 'owner', unread_count: 0, is_muted: 0 }
    ];

    for (const memberId of memberIds) {
      if (String(memberId) !== String(userId)) {
        memberRecords.push({
          conversation_id: convId,
          user_id: memberId,
          role: 'member',
          unread_count: 0,
          is_muted: 0
        });
      }
    }

    await db('conversation_members').insert(memberRecords);

    // 发送系统消息
    const creator = await db('users').where({ id: userId }).select('nickname').first();
    const creatorNickname = creator ? creator.nickname : '未知用户';
    await sendSystemMessage(db, convId, `[${creatorNickname}] 创建了群聊`);

    // 获取完整会话信息
    const conversation = await db('conversations')
      .where({ id: convId })
      .first();

    responseHelper.success(res, conversation, '群聊创建成功');
  } catch (error) {
    console.error('创建群聊失败:', error);
    responseHelper.handleError(error, res, '创建群聊');
  }
});

// 5. 更新群聊信息
router.put('/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;
    const { title, avatar_url } = req.body;

    // 验证当前用户是会话成员
    const role = await getMemberRole(db, conversationId, userId);
    if (!role) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 仅 owner 或 admin 可操作
    if (role !== 'owner' && role !== 'admin') {
      return responseHelper.error(res, '仅群主或管理员可修改群聊信息', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 构建更新数据
    const updateData = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 20) {
        return responseHelper.error(res, '群聊标题长度需在2-20个字符之间', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
      }
      updateData.title = title.trim();
    }
    if (avatar_url !== undefined) {
      updateData.avatar_url = avatar_url;
    }

    if (Object.keys(updateData).length === 0) {
      return responseHelper.error(res, '没有需要更新的字段', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    await db('conversations')
      .where({ id: conversationId })
      .update(updateData);

    // 发送系统消息
    const updater = await db('users').where({ id: userId }).select('nickname').first();
    const updaterNickname = updater ? updater.nickname : '未知用户';
    let systemContent = `[${updaterNickname}] 更新了群聊信息`;
    if (title) {
      systemContent = `[${updaterNickname}] 将群聊名称修改为「${title.trim()}」`;
    }
    await sendSystemMessage(db, conversationId, systemContent);

    // 广播群聊信息更新
    await broadcastToConversation(db, conversationId, {
      type: 'conversation_updated',
      conversation_id: conversationId,
      ...updateData
    });

    responseHelper.success(res, null, '群聊信息更新成功');
  } catch (error) {
    console.error('更新群聊信息失败:', error);
    responseHelper.handleError(error, res, '更新群聊信息');
  }
});

// 6. 退出群聊
router.delete('/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;

    // 验证当前用户是会话成员
    const role = await getMemberRole(db, conversationId, userId);
    if (!role) {
      return responseHelper.error(res, '你不是该会话的成员', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 获取会话信息
    const conversation = await db('conversations')
      .where({ id: conversationId })
      .first();

    if (!conversation) {
      return responseHelper.error(res, '会话不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const quitter = await db('users').where({ id: userId }).select('nickname').first();
    const quitterNickname = quitter ? quitter.nickname : '未知用户';

    if (role === 'owner') {
      // owner 退出：解散群聊
      await db.transaction(async (trx) => {
        // 删除成员
        await trx('conversation_members').where({ conversation_id: conversationId }).del();
        // 删除消息
        await trx('messages').where({ conversation_id: conversationId }).del();
        // 删除会话
        await trx('conversations').where({ id: conversationId }).del();
      });

      // 广播群聊解散
      await broadcastToConversation(db, conversationId, {
        type: 'conversation_disbanded',
        conversation_id: conversationId
      });

      responseHelper.success(res, null, '群聊已解散');
    } else {
      // 普通成员退出：移除自己
      await db('conversation_members')
        .where({ conversation_id: conversationId, user_id: userId })
        .del();

      // 发送系统消息
      await sendSystemMessage(db, conversationId, `[${quitterNickname}] 退出了群聊`);

      // 广播成员退出
      await broadcastToConversation(db, conversationId, {
        type: 'member_left',
        conversation_id: conversationId,
        user_id: userId
      });

      responseHelper.success(res, null, '已退出群聊');
    }
  } catch (error) {
    console.error('退出群聊失败:', error);
    responseHelper.handleError(error, res, '退出群聊');
  }
});

// ==================== 消息管理 ====================

// HTTP 发送消息（WebSocket 降级方案）
router.post('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;
    const { content, type = 'text', reply_to } = req.body;

    // 验证内容
    if (!content || typeof content !== 'string' || content.trim().length === 0 || content.length > 2000) {
      return responseHelper.error(res, '消息内容需在1-2000字符之间', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证会话存在且用户是成员
    const member = await verifyConversationMember(db, conversationId, userId);
    if (!member) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 验证回复消息存在
    if (reply_to) {
      const replyMsg = await db('messages').where({ id: reply_to, conversation_id: conversationId }).first();
      if (!replyMsg) {
        return responseHelper.error(res, '回复的消息不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      }
    }

    // 插入消息
    const [newMessage] = await db('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        type,
        content: content.trim(),
        reply_to: reply_to || null
      })
      .returning('*');

    // 更新会话最后消息时间
    await db('conversations').where({ id: conversationId }).update({ last_message_at: db.fn.now() });

    // 获取发送者信息
    const sender = await db('users').where({ id: userId }).select('id', 'nickname', 'avatar').first();
    const message = {
      ...newMessage,
      sender: sender ? { id: sender.id, nickname: sender.nickname, avatar: sender.avatar } : null
    };

    // 通过 WebSocket 广播给其他成员
    try {
      const members = await db('conversation_members').where({ conversation_id: conversationId }).select('user_id');
      const recipientIds = members.filter(m => String(m.user_id) !== String(userId)).map(m => String(m.user_id));
      connectionManager.broadcastToUsers(recipientIds, {
        type: 'chat',
        message
      });
    } catch (broadcastErr) {
      console.error('广播消息失败:', broadcastErr);
    }

    responseHelper.success(res, { message }, '消息发送成功');
  } catch (error) {
    console.error('HTTP 发送消息失败:', error);
    responseHelper.handleError(error, res, '发送消息');
  }
});

// 7. 获取历史消息（游标分页）
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;
    const direction = req.query.direction || 'before';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // 验证当前用户是该会话成员
    const member = await verifyConversationMember(db, conversationId, userId);
    if (!member) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 构建查询
    let query = db({ m: 'messages' })
      .leftJoin({ u: 'users' }, 'm.sender_id', 'u.id')
      .where('m.conversation_id', conversationId)
      .select(
        'm.id', 'm.conversation_id', 'm.sender_id', 'm.type', 'm.content',
        'm.reply_to', 'm.created_at', 'm.edited_at',
        'u.id as sender_auto_id', 'u.nickname as sender_nickname', 'u.avatar as sender_avatar'
      );

    if (cursor && direction === 'before') {
      // 向上翻页：获取 cursor 之前的消息
      query = query.where('m.id', '<', cursor);
    }

    const messages = await query
      .orderBy('m.created_at', 'desc')
      .limit(limit + 1); // 多取一条判断是否有更多

    // 判断是否还有更多消息
    const hasMore = messages.length > limit;
    const resultMessages = hasMore ? messages.slice(0, limit) : messages;

    // 收集所有 reply_to 消息 ID
    const replyToIds = resultMessages
      .filter(m => m.reply_to)
      .map(m => m.reply_to);

    // 批量查询引用消息的发送者信息
    let replyToSenders = {};
    if (replyToIds.length > 0) {
      const replyMessages = await db('messages')
        .whereIn('id', replyToIds)
        .select('id', 'sender_id', 'content');
      const senderIds = replyMessages.map(rm => rm.sender_id);
      const senders = senderIds.length > 0
        ? await db('users').whereIn('id', senderIds).select('id', 'nickname')
        : [];
      const senderMap = Object.fromEntries(senders.map(s => [s.id, s.nickname]));
      replyToSenders = Object.fromEntries(
        replyMessages.map(rm => [rm.id, { content: rm.content, sender_nickname: senderMap[rm.sender_id] || '未知用户' }])
      );
    }

    // 按时间正序返回，并包装 sender 信息
    resultMessages.reverse();
    const formattedMessages = resultMessages.map(m => ({
      id: m.id,
      conversation_id: m.conversation_id,
      sender_id: m.sender_id,
      type: m.type,
      content: m.content,
      reply_to: m.reply_to ? {
        id: m.reply_to,
        content: replyToSenders[m.reply_to]?.content || '',
        sender: {
          nickname: replyToSenders[m.reply_to]?.sender_nickname || '未知用户'
        }
      } : null,
      created_at: m.created_at,
      edited_at: m.edited_at,
      sender: {
        id: m.sender_id,
        nickname: m.sender_nickname,
        avatar: m.sender_avatar
      }
    }));

    // 批量查询消息的表情回应
    const messageIds = formattedMessages.map(m => m.id);
    let messageReactions = {};
    if (messageIds.length > 0) {
      const reactions = await db('message_reactions')
        .whereIn('message_id', messageIds)
        .select('message_id', 'emoji')
        .count('id as count')
        .groupBy('message_id', 'emoji');
      for (const r of reactions) {
        if (!messageReactions[r.message_id]) {
          messageReactions[r.message_id] = [];
        }
        messageReactions[r.message_id].push({
          emoji: r.emoji,
          count: parseInt(r.count)
        });
      }
    }

    // 将 reactions 附加到消息上
    for (const msg of formattedMessages) {
      msg.reactions = messageReactions[msg.id] || [];
    }

    // 计算下一页游标
    let nextCursor = null;
    if (formattedMessages.length > 0) {
      nextCursor = formattedMessages[0].id;
    }

    // 清除当前用户的未读计数
    await db('conversation_members')
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ unread_count: 0 });

    responseHelper.success(res, {
      messages: formattedMessages,
      hasMore,
      nextCursor
    });
  } catch (error) {
    console.error('获取历史消息失败:', error);
    responseHelper.handleError(error, res, '获取历史消息');
  }
});

// 8. 编辑消息
router.put('/messages/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const messageId = req.params.id;
    const { content } = req.body;

    // 验证内容
    if (!content || typeof content !== 'string' || content.trim().length < 1 || content.trim().length > 2000) {
      return responseHelper.error(res, '消息内容长度需在1-2000个字符之间', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证消息存在
    const message = await db('messages')
      .where({ id: messageId })
      .first();

    if (!message) {
      return responseHelper.error(res, '消息不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 验证发送者是当前用户
    if (String(message.sender_id) !== String(userId)) {
      return responseHelper.error(res, '只能编辑自己的消息', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 验证2分钟内
    const createdAt = new Date(message.created_at);
    const now = new Date();
    const diffMinutes = (now - createdAt) / (1000 * 60);
    if (diffMinutes > 2) {
      return responseHelper.error(res, '消息发送超过2分钟，无法编辑', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 更新消息
    await db('messages')
      .where({ id: messageId })
      .update({
        content: content.trim(),
        edited_at: db.fn.now()
      });

    // 获取更新后的消息
    const updatedMessage = await db('messages')
      .where({ id: messageId })
      .first();

    // 通过 connectionManager 广播 message_edited
    await broadcastToConversation(db, message.conversation_id, {
      type: 'message_edited',
      conversation_id: message.conversation_id,
      message: updatedMessage
    });

    responseHelper.success(res, updatedMessage, '消息编辑成功');
  } catch (error) {
    console.error('编辑消息失败:', error);
    responseHelper.handleError(error, res, '编辑消息');
  }
});

// 9. 撤回消息
router.post('/messages/:id/recall', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const messageId = req.params.id;

    // 验证消息存在
    const message = await db('messages')
      .where({ id: messageId })
      .first();

    if (!message) {
      return responseHelper.error(res, '消息不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 验证发送者是当前用户
    if (String(message.sender_id) !== String(userId)) {
      return responseHelper.error(res, '只能撤回自己的消息', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 验证2分钟内
    const createdAt = new Date(message.created_at);
    const now = new Date();
    const diffMinutes = (now - createdAt) / (1000 * 60);
    if (diffMinutes > 2) {
      return responseHelper.error(res, '消息发送超过2分钟，无法撤回', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证 type 不是 system
    if (message.type === 'system') {
      return responseHelper.error(res, '系统消息无法撤回', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 将消息改为已撤回
    await db('messages')
      .where({ id: messageId })
      .update({
        type: 'system',
        content: '[已撤回]'
      });

    // 获取更新后的消息
    const recalledMessage = await db('messages')
      .where({ id: messageId })
      .first();

    // 通过 connectionManager 广播 message_recalled
    await broadcastToConversation(db, message.conversation_id, {
      type: 'message_recalled',
      conversation_id: message.conversation_id,
      message: recalledMessage
    });

    responseHelper.success(res, recalledMessage, '消息撤回成功');
  } catch (error) {
    console.error('撤回消息失败:', error);
    responseHelper.handleError(error, res, '撤回消息');
  }
});

// 10. 搜索消息
router.get('/conversations/:id/messages/search', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;
    const keyword = req.query.keyword;

    if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
      return responseHelper.error(res, '请输入搜索关键词', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证当前用户是该会话成员
    const member = await verifyConversationMember(db, conversationId, userId);
    if (!member) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 搜索消息
    const kwPattern = `%${keyword.trim()}%`;
    const messages = await db({ m: 'messages' })
      .leftJoin({ u: 'users' }, 'm.sender_id', 'u.id')
      .where('m.conversation_id', conversationId)
      .where('m.content', 'like', kwPattern)
      .select(
        'm.id', 'm.sender_id', 'm.type', 'm.content',
        'm.created_at', 'm.edited_at',
        'u.id as sender_auto_id', 'u.nickname as sender_nickname', 'u.avatar as sender_avatar'
      )
      .orderBy('m.created_at', 'desc')
      .limit(50);

    responseHelper.success(res, { messages, keyword: keyword.trim() });
  } catch (error) {
    console.error('搜索消息失败:', error);
    responseHelper.handleError(error, res, '搜索消息');
  }
});

// ==================== 群成员管理 ====================

// 11. 邀请成员
router.post('/conversations/:id/members', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;
    const { userIds } = req.body;

    // 验证当前用户是 owner 或 admin
    const role = await getMemberRole(db, conversationId, userId);
    if (!role) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }
    if (role !== 'owner' && role !== 'admin') {
      return responseHelper.error(res, '仅群主或管理员可邀请成员', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 验证 userIds
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return responseHelper.error(res, '请提供要邀请的用户列表', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证用户存在
    const existingUsers = await db('users')
      .whereIn('id', userIds.map(String))
      .select('id', 'nickname');
    const existingUserMap = {};
    existingUsers.forEach(u => { existingUserMap[String(u.id)] = u; });

    const invalidIds = userIds.filter(id => !existingUserMap[String(id)]);
    if (invalidIds.length > 0) {
      return responseHelper.error(res, '部分用户不存在', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 获取当前成员列表
    const currentMembers = await db('conversation_members')
      .where({ conversation_id: conversationId })
      .select('user_id');
    const currentMemberIds = new Set(currentMembers.map(m => String(m.user_id)));

    // 过滤掉已是成员的用户
    const newMemberIds = userIds.filter(id => !currentMemberIds.has(String(id)));
    if (newMemberIds.length === 0) {
      return responseHelper.error(res, '这些用户已经是群成员', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 检查群成员总数不超过 50
    const newTotal = currentMemberIds.size + newMemberIds.length;
    if (newTotal > 50) {
      return responseHelper.error(res, '群成员总数不能超过50人', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 批量添加成员
    const memberRecords = newMemberIds.map(id => ({
      conversation_id: conversationId,
      user_id: id,
      role: 'member',
      unread_count: 0,
      is_muted: 0
    }));
    await db('conversation_members').insert(memberRecords);

    // 发送系统消息
    const inviter = await db('users').where({ id: userId }).select('nickname').first();
    const inviterNickname = inviter ? inviter.nickname : '未知用户';
    const invitedNames = newMemberIds.map(id => existingUserMap[String(id)]?.nickname || '未知用户');
    await sendSystemMessage(db, conversationId, `[${inviterNickname}] 邀请了 ${invitedNames.join('、')} 加入群聊`);

    // 广播成员加入
    await broadcastToConversation(db, conversationId, {
      type: 'members_joined',
      conversation_id: conversationId,
      user_ids: newMemberIds
    });

    responseHelper.success(res, null, '成员邀请成功');
  } catch (error) {
    console.error('邀请成员失败:', error);
    responseHelper.handleError(error, res, '邀请成员');
  }
});

// 12. 移除成员
router.delete('/conversations/:id/members/:userId', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const currentUserId = req.user.id;
    const conversationId = req.params.id;
    const targetUserId = req.params.userId;

    // 验证当前用户是 owner 或 admin
    const role = await getMemberRole(db, conversationId, currentUserId);
    if (!role) {
      return responseHelper.error(res, '无权访问该会话', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }
    if (role !== 'owner' && role !== 'admin') {
      return responseHelper.error(res, '仅群主或管理员可移除成员', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 验证目标用户是成员
    const targetMember = await db('conversation_members')
      .where({ conversation_id: conversationId, user_id: targetUserId })
      .first();

    if (!targetMember) {
      return responseHelper.error(res, '该用户不是群成员', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 不能移除 owner
    if (targetMember.role === 'owner') {
      return responseHelper.error(res, '不能移除群主', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // admin 不能移除其他 admin（仅 owner 可以）
    if (role === 'admin' && targetMember.role === 'admin') {
      return responseHelper.error(res, '管理员不能移除其他管理员', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 移除成员
    await db('conversation_members')
      .where({ conversation_id: conversationId, user_id: targetUserId })
      .del();

    // 发送系统消息
    const removedUser = await db('users').where({ id: targetUserId }).select('nickname').first();
    const removedNickname = removedUser ? removedUser.nickname : '未知用户';
    const operator = await db('users').where({ id: currentUserId }).select('nickname').first();
    const operatorNickname = operator ? operator.nickname : '未知用户';
    await sendSystemMessage(db, conversationId, `[${operatorNickname}] 将 [${removedNickname}] 移出了群聊`);

    // 广播成员移除
    await broadcastToConversation(db, conversationId, {
      type: 'member_removed',
      conversation_id: conversationId,
      user_id: targetUserId
    });

    // 通知被移除的用户
    connectionManager.broadcastToUser(String(targetUserId), {
      type: 'removed_from_conversation',
      conversation_id: conversationId
    });

    responseHelper.success(res, null, '成员移除成功');
  } catch (error) {
    console.error('移除成员失败:', error);
    responseHelper.handleError(error, res, '移除成员');
  }
});

// 13. 设置成员角色
router.put('/conversations/:id/members/:userId/role', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const currentUserId = req.user.id;
    const conversationId = req.params.id;
    const targetUserId = req.params.userId;
    const { role } = req.body;

    // 仅 owner 可操作
    const operatorRole = await getMemberRole(db, conversationId, currentUserId);
    if (operatorRole !== 'owner') {
      return responseHelper.error(res, '仅群主可设置成员角色', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 验证角色值
    if (role !== 'admin' && role !== 'member') {
      return responseHelper.error(res, '角色只能是 admin 或 member', RESPONSE_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证目标用户是成员
    const targetMember = await db('conversation_members')
      .where({ conversation_id: conversationId, user_id: targetUserId })
      .first();

    if (!targetMember) {
      return responseHelper.error(res, '该用户不是群成员', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 不能修改 owner 的角色
    if (targetMember.role === 'owner') {
      return responseHelper.error(res, '不能修改群主角色', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 更新角色
    await db('conversation_members')
      .where({ conversation_id: conversationId, user_id: targetUserId })
      .update({ role });

    // 发送系统消息
    const targetUser = await db('users').where({ id: targetUserId }).select('nickname').first();
    const targetNickname = targetUser ? targetUser.nickname : '未知用户';
    const roleText = role === 'admin' ? '管理员' : '普通成员';
    await sendSystemMessage(db, conversationId, `群主将 [${targetNickname}] 设置为${roleText}`);

    // 广播角色变更
    await broadcastToConversation(db, conversationId, {
      type: 'member_role_changed',
      conversation_id: conversationId,
      user_id: targetUserId,
      role
    });

    responseHelper.success(res, null, '角色设置成功');
  } catch (error) {
    console.error('设置成员角色失败:', error);
    responseHelper.handleError(error, res, '设置成员角色');
  }
});

// 14. 切换免打扰
router.put('/conversations/:id/mute', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const conversationId = req.params.id;

    // 验证当前用户是会话成员
    const member = await verifyConversationMember(db, conversationId, userId);
    if (!member) {
      return responseHelper.error(res, '你不是该会话的成员', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 切换 is_muted 字段
    const newMutedStatus = member.is_muted ? 0 : 1;
    await db('conversation_members')
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ is_muted: newMutedStatus });

    responseHelper.success(res, { is_muted: newMutedStatus }, newMutedStatus ? '已开启免打扰' : '已关闭免打扰');
  } catch (error) {
    console.error('切换免打扰失败:', error);
    responseHelper.handleError(error, res, '切换免打扰');
  }
});

// 添加/删除消息表情回应
router.post('/messages/:id/reactions', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const messageId = req.params.id;
    const { emoji } = req.body;

    if (!emoji || emoji.length > 32) {
      return responseHelper.error(res, '无效的表情', RESPONSE_CODES.BAD_REQUEST, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证消息存在
    const message = await db('messages').where({ id: messageId }).first();
    if (!message) {
      return responseHelper.error(res, '消息不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 验证用户是该会话成员
    const member = await db('conversation_members')
      .where({ conversation_id: message.conversation_id, user_id: userId })
      .first();
    if (!member) {
      return responseHelper.error(res, '无权操作', RESPONSE_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    }

    // 检查是否已有该表情回应
    const existing = await db('message_reactions')
      .where({ message_id: messageId, user_id: userId, emoji })
      .first();

    if (existing) {
      // 已存在则删除（toggle）
      await db('message_reactions').where({ id: existing.id }).del();
      responseHelper.success(res, { action: 'removed', emoji });
    } else {
      // 不存在则添加
      await db('message_reactions').insert({
        message_id: messageId,
        user_id: userId,
        emoji
      });
      responseHelper.success(res, { action: 'added', emoji });
    }
  } catch (error) {
    console.error('表情回应操作失败:', error);
    responseHelper.handleError(error, res, '表情回应操作');
  }
});

// ========== 好友系统 ==========

// 获取好友列表
router.get('/friends', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    const friends = await db('friends')
      .where({ user_id: userId })
      .join('users', 'friends.friend_id', 'users.id')
      .select('users.id', 'users.nickname', 'users.avatar', 'friends.created_at as friend_since');

    responseHelper.success(res, { friends });
  } catch (error) {
    console.error('获取好友列表失败:', error);
    responseHelper.handleError(error, res, '获取好友列表');
  }
});

// 发送好友申请
router.post('/friends/request', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const { to_user_id, message } = req.body;

    if (!to_user_id) {
      return responseHelper.error(res, '缺少目标用户', RESPONSE_CODES.BAD_REQUEST, HTTP_STATUS.BAD_REQUEST);
    }

    if (String(userId) === String(to_user_id)) {
      return responseHelper.error(res, '不能添加自己为好友', RESPONSE_CODES.BAD_REQUEST, HTTP_STATUS.BAD_REQUEST);
    }

    // 验证目标用户存在
    const targetUser = await db('users').where({ id: to_user_id }).first();
    if (!targetUser) {
      return responseHelper.error(res, '用户不存在', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 检查是否已是好友
    const existingFriend = await db('friends')
      .where({ user_id: userId, friend_id: to_user_id })
      .first();
    if (existingFriend) {
      return responseHelper.error(res, '已经是好友了', RESPONSE_CODES.BAD_REQUEST, HTTP_STATUS.BAD_REQUEST);
    }

    // 检查是否已有待处理的申请（任一方向）
    const existingRequest = await db('friend_requests')
      .where(function () {
        this.where({ from_user_id: userId, to_user_id })
          .orWhere({ from_user_id: to_user_id, to_user_id: userId });
      })
      .where({ status: 'pending' })
      .first();
    if (existingRequest) {
      return responseHelper.error(res, '已有待处理的好友申请', RESPONSE_CODES.BAD_REQUEST, HTTP_STATUS.BAD_REQUEST);
    }

    // 创建申请
    await db('friend_requests').insert({
      from_user_id: userId,
      to_user_id,
      message: message || '',
      status: 'pending'
    });

    responseHelper.success(res, { message: '好友申请已发送' });
  } catch (error) {
    console.error('发送好友申请失败:', error);
    responseHelper.handleError(error, res, '发送好友申请');
  }
});

// 获取收到的好友申请
router.get('/friends/requests', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    const requests = await db('friend_requests')
      .where({ to_user_id: userId, status: 'pending' })
      .join('users', 'friend_requests.from_user_id', 'users.id')
      .select(
        'friend_requests.id',
        'friend_requests.from_user_id',
        'friend_requests.message',
        'friend_requests.created_at',
        'users.nickname as from_nickname',
        'users.avatar as from_avatar'
      )
      .orderBy('friend_requests.created_at', 'desc');

    responseHelper.success(res, { requests });
  } catch (error) {
    console.error('获取好友申请失败:', error);
    responseHelper.handleError(error, res, '获取好友申请');
  }
});

// 接受好友申请
router.post('/friends/requests/:id/accept', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const requestId = req.params.id;

    const request = await db('friend_requests').where({ id: requestId, to_user_id: userId, status: 'pending' }).first();
    if (!request) {
      return responseHelper.error(res, '申请不存在或已处理', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // 更新申请状态
    await db('friend_requests').where({ id: requestId }).update({
      status: 'accepted',
      handled_at: db.fn.now()
    });

    // 创建双向好友关系
    await db('friends').insert([
      { user_id: request.from_user_id, friend_id: userId },
      { user_id: userId, friend_id: request.from_user_id }
    ]).onConflict(['user_id', 'friend_id']).ignore();

    responseHelper.success(res, { message: '已接受好友申请' });
  } catch (error) {
    console.error('接受好友申请失败:', error);
    responseHelper.handleError(error, res, '接受好友申请');
  }
});

// 拒绝好友申请
router.post('/friends/requests/:id/reject', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const requestId = req.params.id;

    const request = await db('friend_requests').where({ id: requestId, to_user_id: userId, status: 'pending' }).first();
    if (!request) {
      return responseHelper.error(res, '申请不存在或已处理', RESPONSE_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    await db('friend_requests').where({ id: requestId }).update({
      status: 'rejected',
      handled_at: db.fn.now()
    });

    responseHelper.success(res, { message: '已拒绝好友申请' });
  } catch (error) {
    console.error('拒绝好友申请失败:', error);
    responseHelper.handleError(error, res, '拒绝好友申请');
  }
});

// 检查是否是好友
router.get('/friends/check/:userId', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const targetId = req.params.userId;

    const isFriend = await db('friends')
      .where({ user_id: userId, friend_id: targetId })
      .first();

    responseHelper.success(res, { is_friend: !!isFriend });
  } catch (error) {
    console.error('检查好友关系失败:', error);
    responseHelper.handleError(error, res, '检查好友关系');
  }
});

module.exports = router;
