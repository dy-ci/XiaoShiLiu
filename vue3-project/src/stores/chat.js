import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { chatApi } from '@/api/chat.js'
import { useUserStore } from './user.js'

// WebSocket 消息类型常量
const WS_MESSAGE_TYPES = {
  CHAT: 'chat',
  TYPING: 'typing',
  READ: 'read',
  RECALL: 'recall',
  EDIT: 'edit',
  SYSTEM: 'system',
  REACTION: 'reaction_updated',
  PONG: 'pong',
  ERROR: 'error'
}

export const useChatStore = defineStore('chat', () => {
  const userStore = useUserStore()

  // ========== State ==========
  const conversations = ref([])
  const currentConversation = ref(null)
  const messages = ref([])
  const wsConnection = ref(null)
  const wsConnected = ref(false)
  const unreadTotal = ref(0)
  const reconnectCount = ref(0)
  const reconnectTimer = ref(null)
  const heartbeatTimer = ref(null)
  const missedMessagesCursor = ref(null)
  const oldestMessageCursor = ref(null)
  const hasMoreMessages = ref(false)
  const isLoadingMessages = ref(false)
  const isLoadingConversations = ref(false)

  // ========== Getters ==========
  const sortedConversations = computed(() => {
    return [...conversations.value].sort((a, b) => {
      const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return timeB - timeA
    })
  })

  const onlineStatus = computed(() => {
    return wsConnected.value ? 'online' : 'offline'
  })

  const currentConversationMessages = computed(() => {
    if (!currentConversation.value) return []
    const currentId = String(currentConversation.value.id)
    return messages.value.filter(m => String(m.conversation_id) === currentId)
  })

  // ========== WebSocket 相关 ==========

  // 初始化 WebSocket 连接
  function initWebSocket() {
    if (wsConnection.value?.readyState === WebSocket.OPEN) {
      return
    }

    // 从 URL 获取 token（用于初次连接认证）
    const token = localStorage.getItem('token') || localStorage.getItem('user_token') || ''
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // WebSocket 需要直连后端，不走 Vite 代理（代理只支持 HTTP）
    // 开发环境后端默认 3001，生产环境使用当前 host
    const wsHost = import.meta.env.DEV ? 'localhost:3001' : window.location.host
    const wsUrl = `${wsProtocol}//${wsHost}/ws/chat?token=${encodeURIComponent(token)}`

    try {
      const ws = new WebSocket(wsUrl)
      wsConnection.value = ws

      ws.onopen = () => {
        wsConnected.value = true
        reconnectCount.value = 0
        startHeartbeat()

        // 断线重连后，通过 HTTP 拉取断线期间的消息
        if (missedMessagesCursor.value && currentConversation.value) {
          loadMessages(currentConversation.value.id, missedMessagesCursor.value)
          missedMessagesCursor.value = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleWsMessage(data)
        } catch (error) {
          console.error('解析 WebSocket 消息失败:', error)
        }
      }

      ws.onclose = () => {
        wsConnected.value = false
        stopHeartbeat()
        scheduleReconnect()
      }

      ws.onerror = (error) => {
        console.error('WebSocket 错误:', error)
        wsConnected.value = false
      }
    } catch (error) {
      console.error('创建 WebSocket 连接失败:', error)
      scheduleReconnect()
    }
  }

  // 关闭 WebSocket 连接
  function closeWebSocket() {
    stopHeartbeat()
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value)
      reconnectTimer.value = null
    }
    if (wsConnection.value) {
      wsConnection.value.close()
      wsConnection.value = null
    }
    wsConnected.value = false
    reconnectCount.value = 0
  }

  // 启动心跳
  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer.value = setInterval(() => {
      if (wsConnection.value?.readyState === WebSocket.OPEN) {
        wsConnection.value.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  // 停止心跳
  function stopHeartbeat() {
    if (heartbeatTimer.value) {
      clearInterval(heartbeatTimer.value)
      heartbeatTimer.value = null
    }
  }

  // 自动重连（指数退避，最多 5 次）
  function scheduleReconnect() {
    if (reconnectCount.value >= 5) {
      console.warn('WebSocket 重连次数已达上限')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectCount.value), 30000)
    reconnectCount.value++

    reconnectTimer.value = setTimeout(() => {
      initWebSocket()
    }, delay)
  }

  // 发送消息（优先 WebSocket，降级 HTTP）
  async function sendMessage(conversationId, content, type = 'text', replyTo = null) {
    if (wsConnection.value?.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'send_message',
        data: {
          conversation_id: conversationId,
          content,
          type,
          reply_to: replyTo
        }
      }

      wsConnection.value.send(JSON.stringify(payload))
      return { success: true }
    }

    // WebSocket 未连接，通过 HTTP 发送
    try {
      const response = await chatApi.sendMessage(conversationId, {
        content,
        type,
        reply_to: replyTo
      })
      if (response.success && response.data) {
        messages.value.push(response.data.message || response.data)
        return { success: true }
      }
      return { success: false, message: response.message || '发送失败' }
    } catch (error) {
      console.error('HTTP 发送消息失败:', error)
      return { success: false, message: error.message || '发送失败' }
    }
  }

  // 标记已读
  function markRead(conversationId) {
    if (!wsConnection.value || wsConnection.value.readyState !== WebSocket.OPEN) {
      return
    }

    wsConnection.value.send(
      JSON.stringify({
        type: 'mark_read',
        data: {
          conversation_id: conversationId
        }
      })
    )

    // 更新本地未读数
    const conv = conversations.value.find(c => c.id === conversationId)
    if (conv) {
      conv.unread_count = 0
      updateUnreadTotal()
    }
  }

  // 发送正在输入状态
  function sendTyping(conversationId) {
    if (!wsConnection.value || wsConnection.value.readyState !== WebSocket.OPEN) {
      return
    }

    wsConnection.value.send(
      JSON.stringify({
        type: WS_MESSAGE_TYPES.TYPING,
        conversationId
      })
    )
  }

  // 处理 WebSocket 推送消息
  function handleWsMessage(data) {
    switch (data.type) {
      case WS_MESSAGE_TYPES.PONG:
      case 'pong':
        // 心跳响应，无需处理
        break

      case WS_MESSAGE_TYPES.CHAT:
      case 'new_message':
      case 'chat':
        handleNewMessage(data)
        break

      case WS_MESSAGE_TYPES.TYPING:
      case 'typing':
        handleTypingStatus(data)
        break

      case WS_MESSAGE_TYPES.READ:
      case 'unread_update':
      case 'read':
        handleReadReceipt(data)
        break

      case WS_MESSAGE_TYPES.RECALL:
      case 'message_recalled':
      case 'recall':
        handleRecalledMessage(data)
        break

      case WS_MESSAGE_TYPES.EDIT:
      case 'message_edited':
      case 'edit':
        handleEditedMessage(data)
        break

      case WS_MESSAGE_TYPES.SYSTEM:
      case 'system':
        handleSystemMessage(data)
        break

      case WS_MESSAGE_TYPES.REACTION:
      case 'reaction_updated':
        handleReactionUpdated(data)
        break

      case WS_MESSAGE_TYPES.ERROR:
      case 'error':
        console.error('WebSocket 错误消息:', data.message)
        break

      default:
        console.warn('未知 WebSocket 消息类型:', data.type)
    }
  }

  // 处理新消息
  function handleNewMessage(data) {
    // 兼容两种格式：{ message: {...} } 和 { data: {...} }
    const message = data.message || data.data
    if (!message) return

    // 统一字段名
    const msg = {
      ...message,
      type: message.type || message.message_type,
      sender_id: message.sender_id,
      conversation_id: message.conversation_id
    }

    // 添加到消息列表
    messages.value.push(msg)

    // 缓存消息
    if (currentConversation.value) {
      saveMessagesToCache(currentConversation.value.id, messages.value)
    }

    // 更新会话最后消息
    const conv = conversations.value.find(c => String(c.id) === String(msg.conversation_id))
    if (conv) {
      conv.last_message = msg
      conv.last_message_at = msg.created_at
      conv.last_message_content = msg.content
      conv.last_message_type = msg.type
      conv.last_sender_id = msg.sender_id

      // 如果不是当前会话，增加未读数
      if (!currentConversation.value || currentConversation.value.id !== conv.id) {
        conv.unread_count = (conv.unread_count || 0) + 1
        updateUnreadTotal()
      }
    }
  }

  // 处理输入状态
  function handleTypingStatus(data) {
    const conv = conversations.value.find(c => c.id === data.conversationId)
    if (conv) {
      conv.typingUserId = data.userId
      // 3 秒后清除输入状态
      setTimeout(() => {
        if (conv.typingUserId === data.userId) {
          conv.typingUserId = null
        }
      }, 3000)
    }
  }

  // 处理已读回执
  function handleReadReceipt(data) {
    const msgs = messages.value.filter(
      m => m.conversation_id === data.conversationId && m.sender_id === userStore.userInfo?.id
    )
    msgs.forEach(m => {
      m.read_at = data.readAt || new Date().toISOString()
    })
  }

  // 处理撤回消息
  function handleRecalledMessage(data) {
    const messageId = data.messageId || data.data?.id
    if (!messageId) return
    const msg = messages.value.find(m => String(m.id) === String(messageId))
    if (msg) {
      msg.is_recalled = true
      msg.content = '消息已撤回'
    }
  }

  // 处理编辑消息
  function handleEditedMessage(data) {
    const messageId = data.messageId || data.data?.id
    const newContent = data.content || data.data?.content
    const editedAt = data.editedAt || data.data?.edited_at
    if (!messageId) return
    const msg = messages.value.find(m => String(m.id) === String(messageId))
    if (msg && newContent) {
      msg.content = newContent
      msg.is_edited = true
      msg.edited_at = editedAt || new Date().toISOString()
    }
  }

  // 处理系统消息
  function handleSystemMessage(data) {
    if (data.message) {
      messages.value.push({
        id: `system_${Date.now()}`,
        conversation_id: data.conversationId,
        type: 'system',
        content: data.message,
        created_at: new Date().toISOString()
      })
    }
  }

  // 处理表情回应更新
  function handleReactionUpdated(data) {
    const rd = data.data || data
    const messageId = rd.message_id
    if (!messageId) return

    const msg = messages.value.find(m => String(m.id) === String(messageId))
    if (msg) {
      msg.reactions = rd.reactions || []
    }
  }

  // 切换表情回应（WebSocket）
  function toggleReaction(messageId, emoji) {
    if (!wsConnection.value || wsConnection.value.readyState !== WebSocket.OPEN) return

    // 乐观更新：立即在本地更新
    const msg = messages.value.find(m => String(m.id) === String(messageId))
    if (msg) {
      if (!msg.reactions) msg.reactions = []
      const existing = msg.reactions.find(r => r.emoji === emoji)
      if (existing) {
        existing.count--
        if (existing.count <= 0) {
          msg.reactions = msg.reactions.filter(r => r.emoji !== emoji)
        }
      } else {
        msg.reactions.push({ emoji, count: 1 })
      }
    }

    wsConnection.value.send(JSON.stringify({
      type: 'toggle_reaction',
      data: { message_id: messageId, emoji }
    }))
  }

  // ========== HTTP API 操作 ==========

  // 加载会话列表
  async function loadConversations() {
    if (isLoadingConversations.value) return

    isLoadingConversations.value = true
    try {
      const response = await chatApi.getConversations()
      if (response.success && response.data) {
        conversations.value = response.data.conversations || []
        updateUnreadTotal()
      }
    } catch (error) {
      console.error('加载会话列表失败:', error)
    } finally {
      isLoadingConversations.value = false
    }
  }

  // 加载历史消息
  async function loadMessages(conversationId, cursor = null) {
    if (isLoadingMessages.value) return

    isLoadingMessages.value = true
    try {
      const params = { limit: 50 }
      if (cursor) {
        params.cursor = cursor
      }

      const response = await chatApi.getMessages(conversationId, params)
      if (response.success && response.data) {
        const newMessages = response.data.messages || []

        if (cursor) {
          // 加载更多：去重后添加到前面
          const existingIds = new Set(messages.value.map(m => m.id))
          const uniqueNew = newMessages.filter(m => !existingIds.has(m.id))
          messages.value.unshift(...uniqueNew)
        } else {
          // 首次加载：合并缓存和服务器数据，保留缓存中服务器没有的消息
          const existingIds = new Set(newMessages.map(m => m.id))
          const cachedOnly = messages.value.filter(m => !existingIds.has(m.id))
          messages.value = [...newMessages, ...cachedOnly].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        }

        // 保存游标
        if (response.data.nextCursor) {
          missedMessagesCursor.value = response.data.nextCursor
          oldestMessageCursor.value = response.data.nextCursor
        }

        // 判断是否还有更多消息
        hasMoreMessages.value = !!response.data.hasMore

        // 缓存消息
        saveMessagesToCache(conversationId, messages.value)
      }
    } catch (error) {
      console.error('加载消息失败:', error)
    } finally {
      isLoadingMessages.value = false
    }
  }

  // 创建/获取私聊会话
  async function createPrivateConversation(userId) {
    try {
      const response = await chatApi.getConversationWithUser(userId)
      if (response.success && response.data) {
        // 后端直接返回会话对象，不包装在 conversation 字段中
        const conversation = response.data.conversation || response.data

        // 如果会话不在列表中，添加进去
        const exists = conversations.value.find(c => String(c.id) === String(conversation.id))
        if (!exists) {
          conversations.value.unshift(conversation)
        }

        return { success: true, data: conversation }
      }
      return { success: false, message: response.message || '创建会话失败' }
    } catch (error) {
      console.error('创建私聊会话失败:', error)
      return { success: false, message: error.message || '创建会话失败' }
    }
  }

  // 创建群聊
  async function createGroup(title, memberIds) {
    try {
      const response = await chatApi.createGroup({ title, memberIds })
      if (response.success && response.data) {
        const conversation = response.data.conversation || response.data
        conversations.value.unshift(conversation)
        return { success: true, data: conversation }
      }
      return { success: false, message: response.message || '创建群聊失败' }
    } catch (error) {
      console.error('创建群聊失败:', error)
      return { success: false, message: error.message || '创建群聊失败' }
    }
  }

  // 编辑消息（HTTP 方式）
  async function editMessage(messageId, content) {
    try {
      const response = await chatApi.editMessage(messageId, content)
      if (response.success) {
        const msg = messages.value.find(m => m.id === messageId)
        if (msg) {
          msg.content = content
          msg.is_edited = true
          msg.edited_at = new Date().toISOString()
        }
        return { success: true }
      }
      return { success: false, message: response.message || '编辑失败' }
    } catch (error) {
      console.error('编辑消息失败:', error)
      return { success: false, message: error.message || '编辑失败' }
    }
  }

  // 撤回消息（HTTP 方式）
  async function recallMessage(messageId) {
    try {
      const response = await chatApi.recallMessage(messageId)
      if (response.success) {
        const msg = messages.value.find(m => m.id === messageId)
        if (msg) {
          msg.is_recalled = true
          msg.content = '消息已撤回'
        }
        return { success: true }
      }
      return { success: false, message: response.message || '撤回失败' }
    } catch (error) {
      console.error('撤回消息失败:', error)
      return { success: false, message: error.message || '撤回失败' }
    }
  }

  // 设置当前会话
  function setCurrentConversation(conversation) {
    currentConversation.value = conversation
    if (conversation) {
      // 尝试从 localStorage 恢复缓存的消息
      const cached = loadMessagesFromCache(conversation.id)
      if (cached && cached.length > 0) {
        messages.value = cached
      } else {
        messages.value = []
      }
      // 异步加载最新消息（会合并去重）
      loadMessages(conversation.id)
      // 标记已读
      markRead(conversation.id)
    } else {
      messages.value = []
    }
  }

  // 缓存消息到 localStorage
  function saveMessagesToCache(conversationId, msgs) {
    try {
      const key = `chat_messages_${conversationId}`
      // 只缓存最近 200 条，避免超出存储限制
      const toSave = msgs.slice(-200)
      localStorage.setItem(key, JSON.stringify(toSave))
    } catch (e) {
      console.warn('缓存消息失败:', e)
    }
  }

  // 从 localStorage 恢复消息
  function loadMessagesFromCache(conversationId) {
    try {
      const key = `chat_messages_${conversationId}`
      const cached = localStorage.getItem(key)
      return cached ? JSON.parse(cached) : null
    } catch (e) {
      console.warn('恢复消息缓存失败:', e)
      return null
    }
  }

  // 清除消息缓存
  function clearMessagesCache(conversationId) {
    try {
      const key = `chat_messages_${conversationId}`
      localStorage.removeItem(key)
    } catch (e) {
      // ignore
    }
  }

  // 更新未读总数
  function updateUnreadTotal() {
    unreadTotal.value = conversations.value.reduce(
      (sum, c) => sum + (c.unread_count || 0),
      0
    )
  }

  // 重置状态
  function resetState() {
    closeWebSocket()
    conversations.value = []
    currentConversation.value = null
    messages.value = []
    unreadTotal.value = 0
    missedMessagesCursor.value = null
    oldestMessageCursor.value = null
    hasMoreMessages.value = false
  }

  // 加载更多历史消息（向上翻页）
  async function loadMoreMessages() {
    if (!currentConversation.value || !hasMoreMessages.value || isLoadingMessages.value) return
    await loadMessages(currentConversation.value.id, oldestMessageCursor.value)
  }

  return {
    // State
    conversations,
    currentConversation,
    messages,
    wsConnection,
    wsConnected,
    unreadTotal,
    isLoadingMessages,
    isLoadingConversations,
    hasMoreMessages,

    // Getters
    sortedConversations,
    onlineStatus,
    currentConversationMessages,

    // Actions
    initWebSocket,
    closeWebSocket,
    sendMessage,
    markRead,
    sendTyping,
    editMessage,
    recallMessage,
    toggleReaction,
    loadConversations,
    loadMessages,
    loadMoreMessages,
    createPrivateConversation,
    createGroup,
    handleWsMessage,
    setCurrentConversation,
    resetState,
    clearMessagesCache
  }
})
