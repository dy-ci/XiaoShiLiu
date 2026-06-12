<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import MessageBubble from './MessageBubble.vue'
import ChatInput from './ChatInput.vue'
import UserDisplay from '@/components/user/UserDisplay.vue'
import { useChatStore } from '@/stores/chat.js'
import { useUserStore } from '@/stores/user.js'
import { chatApi } from '@/api/chat.js'
import { userApi } from '@/api/index.js'

const chatStore = useChatStore()
const userStore = useUserStore()

const emit = defineEmits(['back'])

const messagesContainer = ref(null)
const replyToMessage = ref(null)
const editingMessage = ref(null)
const editContent = ref('')
const showEditModal = ref(false)
const showSettingsPanel = ref(false)

// 统一右键菜单
const contextMenu = ref({ show: false, message: null, x: 0, y: 0 })
let menuJustOpened = false

// 好友系统
const showFriendRequests = ref(false)
const friendRequests = ref([])
const friendRequestCount = ref(0)
const addFriendId = ref('')
const friendSearchResult = ref(null)

// 加载好友申请
async function loadFriendRequests() {
  try {
    const res = await chatApi.getFriendRequests()
    if (res.success) {
      friendRequests.value = res.data.requests || []
      friendRequestCount.value = friendRequests.value.length
    }
  } catch (e) {
    // ignore
  }
}

// 搜索用户
async function searchFriendUser() {
  if (!addFriendId.value.trim()) return
  try {
    const res = await userApi.searchUsers(addFriendId.value.trim(), { limit: 5 })
    if (res.success && res.data?.users?.length > 0) {
      const user = res.data.users.find(u => String(u.id) !== String(userStore.userInfo?.id))
      if (user) {
        // 检查好友关系
        const friendRes = await chatApi.checkFriend(user.id)
        const isFriend = friendRes.success && friendRes.data?.is_friend
        friendSearchResult.value = {
          ...user,
          _status: isFriend ? 'friend' : 'none'
        }
      } else {
        friendSearchResult.value = null
      }
    } else {
      friendSearchResult.value = null
    }
  } catch (e) {
    // ignore
  }
}

// 发送好友申请
async function sendFriendRequest(userId) {
  try {
    const res = await chatApi.sendFriendRequest(userId)
    if (res.success) {
      if (friendSearchResult.value) {
        friendSearchResult.value._status = 'pending'
      }
    }
  } catch (e) {
    // ignore
  }
}

// 接受好友申请
async function acceptFriendRequest(requestId) {
  try {
    const res = await chatApi.acceptFriendRequest(requestId)
    if (res.success) {
      friendRequests.value = friendRequests.value.filter(r => r.id !== requestId)
      friendRequestCount.value = friendRequests.value.length
    }
  } catch (e) {
    // ignore
  }
}

// 拒绝好友申请
async function rejectFriendRequest(requestId) {
  try {
    const res = await chatApi.rejectFriendRequest(requestId)
    if (res.success) {
      friendRequests.value = friendRequests.value.filter(r => r.id !== requestId)
      friendRequestCount.value = friendRequests.value.length
    }
  } catch (e) {
    // ignore
  }
}

// 当前用户 ID
const currentUserId = computed(() => userStore.userInfo?.id)

// 当前会话消息
const currentMessages = computed(() => chatStore.currentConversationMessages)

// 是否群聊
const isGroup = computed(() => chatStore.currentConversation?.type === 'group')

// 会话标题
const conversationTitle = computed(() => {
  const conv = chatStore.currentConversation
  if (!conv) return ''
  if (conv.title) return conv.title

  // 私聊取对方昵称
  if (conv.other_user) {
    return conv.other_user.nickname || '未知用户'
  }
  const other = (conv.members || []).find(
    m => String(m.user_id) !== String(currentUserId.value)
  )
  return other?.nickname || '未知用户'
})

// 对方用户信息（私聊）
const otherUser = computed(() => {
  const conv = chatStore.currentConversation
  if (!conv || conv.type === 'group') return null
  if (conv.other_user) {
    return conv.other_user
  }
  return (conv.members || []).find(
    m => String(m.user_id) !== String(currentUserId.value)
  )
})

// 在线状态文本
const statusText = computed(() => {
  if (!chatStore.wsConnected) return '连接中...'
  if (isGroup.value) {
    const members = chatStore.currentConversation?.members || []
    return `${members.length} 人`
  }
  return '在线'
})

// 滚动到底部
function scrollToBottom(smooth = false) {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      })
    }
  })
}

// 监听消息变化自动滚动
watch(() => currentMessages.value.length, () => {
  scrollToBottom()
})

// 监听当前会话变化
watch(() => chatStore.currentConversation?.id, () => {
  replyToMessage.value = null
  editingMessage.value = null
})

// 滚动到顶部加载更多历史消息
function handleScroll() {
  const el = messagesContainer.value
  if (!el) return

  // 距离顶部 50px 以内时加载更多
  if (el.scrollTop < 50 && chatStore.hasMoreMessages && !chatStore.isLoadingMessages) {
    // 记住当前滚动位置和高度，加载后恢复
    const oldScrollHeight = el.scrollHeight
    chatStore.loadMoreMessages().then(() => {
      nextTick(() => {
        // 保持滚动位置不变（新消息加载到顶部，高度增加）
        const newScrollHeight = el.scrollHeight
        el.scrollTop = newScrollHeight - oldScrollHeight
      })
    })
  }
}

onMounted(() => {
  scrollToBottom()
  loadFriendRequests()
})

// 判断消息是否为自己发送
function isSelfMessage(message) {
  return String(message.sender_id) === String(currentUserId.value)
}

// 发送消息
function handleSend({ content, type, replyTo }) {
  const convId = chatStore.currentConversation?.id
  if (!convId) return

  if (editingMessage.value) {
    // 编辑模式
    chatStore.editMessage(editingMessage.value.id, content)
    editingMessage.value = null
  } else {
    // 发送新消息
    chatStore.sendMessage(convId, content, type, replyTo)
  }

  replyToMessage.value = null
}

// 引用回复
function handleReply(message) {
  replyToMessage.value = message
}

// 编辑消息
function handleEdit(message) {
  editingMessage.value = message
  editContent.value = message.content
  showEditModal.value = true
}

// 确认编辑
function confirmEdit() {
  if (editingMessage.value && editContent.value.trim()) {
    chatStore.editMessage(editingMessage.value.id, editContent.value.trim())
  }
  cancelEdit()
}

// 取消编辑
function cancelEdit() {
  editingMessage.value = null
  editContent.value = ''
  showEditModal.value = false
}

// 撤回消息
async function handleRecall(messageId) {
  await chatStore.recallMessage(messageId)
}

// 统一右键菜单处理
function handleMessageContextMenu({ message, x, y }) {
  const menuWidth = 100
  const menuHeight = 120
  const posX = Math.min(x, window.innerWidth - menuWidth - 8)
  const posY = Math.min(y, window.innerHeight - menuHeight - 8)
  contextMenu.value = {
    show: true,
    message,
    x: Math.max(8, posX),
    y: Math.max(8, posY)
  }
  menuJustOpened = true
  setTimeout(() => { menuJustOpened = false }, 350)
}

function hideContextMenu() {
  contextMenu.value.show = false
}

function contextMenuReply() {
  if (contextMenu.value.message) {
    handleReply(contextMenu.value.message)
  }
  hideContextMenu()
}

function contextMenuEdit() {
  if (contextMenu.value.message) {
    handleEdit(contextMenu.value.message)
  }
  hideContextMenu()
}

function contextMenuRecall() {
  if (contextMenu.value.message) {
    handleRecall(contextMenu.value.message.id)
  }
  hideContextMenu()
}

// 点击外部关闭菜单
function onDocumentClick(event) {
  if (menuJustOpened) return
  if (event.target.closest('.message-context-menu')) return
  hideContextMenu()
}

// 阻止消息区域的默认右键菜单
function onMessagesContextMenu(event) {
  event.preventDefault()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

// 返回（移动端）
function handleBack() {
  emit('back')
}

// 时间分隔线判断
function shouldShowTimeDivider(message, index) {
  if (index === 0) return true
  const prev = currentMessages.value[index - 1]
  if (!prev || !message.created_at) return false

  const prevTime = new Date(prev.created_at).getTime()
  const currTime = new Date(message.created_at).getTime()
  const diff = currTime - prevTime

  // 超过 5 分钟显示时间分隔线
  return diff > 5 * 60 * 1000
}

// 格式化分隔线时间
function formatDividerTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="chat-window">
    <!-- 顶部栏 -->
    <div class="window-header">
      <button class="back-btn" @click="handleBack">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>

      <div class="header-info">
        <template v-if="isGroup">
          <span class="header-title">{{ conversationTitle }}</span>
        </template>
        <template v-else-if="otherUser">
          <UserDisplay
            :user="otherUser"
            :clickable="false"
            avatar-size="sm"
          />
        </template>
        <span v-else class="header-title">{{ conversationTitle }}</span>
      </div>

      <div class="header-status">
        <span class="status-dot" :class="{ 'status-dot--online': chatStore.wsConnected }"></span>
        <span class="status-text">{{ statusText }}</span>
      </div>

      <button class="header-settings-btn" @click="showSettingsPanel = !showSettingsPanel" title="设置">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </div>

    <!-- 消息区域 -->
    <div ref="messagesContainer" class="messages-area" @scroll="handleScroll" @contextmenu.prevent="onMessagesContextMenu">
      <!-- 加载更多提示 -->
      <div v-if="chatStore.isLoadingMessages && chatStore.currentConversationMessages.length > 0" class="load-more-indicator">
        加载中...
      </div>
      <div v-else-if="chatStore.hasMoreMessages" class="load-more-hint">
        ↑ 上滑加载更多
      </div>

      <template v-for="(msg, index) in currentMessages" :key="msg.id">
        <!-- 时间分隔线 -->
        <div v-if="shouldShowTimeDivider(msg, index)" class="time-divider">
          {{ formatDividerTime(msg.created_at) }}
        </div>

        <MessageBubble
          :message="msg"
          :is-self="isSelfMessage(msg)"
          :show-avatar="!isSelfMessage(msg)"
          @reply="handleReply"
          @edit="handleEdit"
          @recall="handleRecall"
          @contextmenu="handleMessageContextMenu"
        />
      </template>

      <div v-if="currentMessages.length === 0 && !chatStore.isLoadingMessages" class="empty-messages">
        <p>暂无消息，开始聊天吧</p>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <ChatInput
        :reply-to="replyToMessage"
        :disabled="false"
        @send="handleSend"
        @cancel-reply="replyToMessage = null"
      />
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="showEditModal" class="edit-modal-overlay" @click="cancelEdit">
      <div class="edit-modal" @click.stop>
        <h3 class="edit-title">编辑消息</h3>
        <textarea
          v-model="editContent"
          class="edit-textarea"
          rows="4"
          @keydown.enter.prevent="confirmEdit"
        />
        <div class="edit-actions">
          <button class="edit-btn edit-btn--cancel" @click="cancelEdit">取消</button>
          <button class="edit-btn edit-btn--confirm" @click="confirmEdit">确认</button>
        </div>
      </div>
    </div>

    <!-- 设置面板 -->
    <div v-if="showSettingsPanel" class="settings-overlay" @click="showSettingsPanel = false">
      <div class="settings-panel" @click.stop>
        <div class="settings-header">
          <h3>聊天设置</h3>
          <button class="settings-close-btn" @click="showSettingsPanel = false">&times;</button>
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <div class="settings-label">好友申请</div>
            <button class="settings-action-btn" @click="showFriendRequests = true">
              查看好友申请
              <span v-if="friendRequestCount > 0" class="badge">{{ friendRequestCount }}</span>
            </button>
          </div>
          <div class="settings-section">
            <div class="settings-label">添加好友</div>
            <div class="add-friend-row">
              <input
                v-model="addFriendId"
                class="add-friend-input"
                placeholder="输入用户昵称搜索"
                @keyup.enter="searchFriendUser"
              />
              <button class="add-friend-btn" @click="searchFriendUser" :disabled="!addFriendId.trim()">搜索</button>
            </div>
            <div v-if="friendSearchResult" class="friend-search-result">
              <div class="friend-search-item">
                <span>{{ friendSearchResult.nickname }}</span>
                <button
                  class="friend-action-btn"
                  :disabled="friendSearchResult._status !== 'none'"
                  @click="sendFriendRequest(friendSearchResult.id)"
                >
                  {{ friendSearchResult._status === 'none' ? '添加好友' : friendSearchResult._status === 'pending' ? '已申请' : '已是好友' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 好友申请列表 -->
        <div v-if="showFriendRequests" class="friend-requests-panel">
          <div class="settings-header">
            <h3>好友申请</h3>
            <button class="settings-close-btn" @click="showFriendRequests = false">&times;</button>
          </div>
          <div v-if="friendRequests.length === 0" class="empty-requests">暂无好友申请</div>
          <div v-for="req in friendRequests" :key="req.id" class="friend-request-item">
            <div class="request-info">
              <span class="request-name">{{ req.from_nickname }}</span>
              <span v-if="req.message" class="request-message">{{ req.message }}</span>
            </div>
            <div class="request-actions">
              <button class="accept-btn" @click="acceptFriendRequest(req.id)">接受</button>
              <button class="reject-btn" @click="rejectFriendRequest(req.id)">拒绝</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 统一右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.show"
        class="message-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="menu-item" @click="contextMenuReply">引用</div>
        <div v-if="contextMenu.message && String(contextMenu.message.sender_id) === String(currentUserId) && !contextMenu.message.is_recalled" class="menu-item" @click="contextMenuEdit">编辑</div>
        <div v-if="contextMenu.message && String(contextMenu.message.sender_id) === String(currentUserId) && !contextMenu.message.is_recalled" class="menu-item menu-item--danger" @click="contextMenuRecall">撤回</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color-primary);
}

.window-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color-primary);
  flex-shrink: 0;
}

.back-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-color-primary);
  cursor: pointer;
}

.back-btn:hover {
  background: var(--bg-color-secondary);
}

.header-info {
  flex: 1;
  min-width: 0;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.header-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-color-quaternary);
}

.status-dot--online {
  background: #00ba7c;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
}

.loading-indicator {
  text-align: center;
  padding: 16px;
  font-size: 13px;
  color: var(--text-color-tertiary);
}

.load-more-indicator {
  text-align: center;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-color-tertiary);
}

.load-more-hint {
  text-align: center;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-color-quaternary);
}

.empty-messages {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-color-tertiary);
  font-size: 14px;
}

.time-divider {
  text-align: center;
  padding: 12px 0;
  font-size: 12px;
  color: var(--text-color-quaternary);
}

.input-area {
  flex-shrink: 0;
}

/* 编辑弹窗 */
.edit-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.edit-modal {
  background: var(--bg-color-primary);
  border-radius: 12px;
  padding: 20px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 8px 32px var(--shadow-color);
}

.edit-title {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.edit-textarea {
  width: 100%;
  border: 1px solid var(--border-color-secondary);
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  resize: none;
  outline: none;
  box-sizing: border-box;
}

.edit-textarea:focus {
  border-color: var(--primary-color);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.edit-btn {
  padding: 8px 20px;
  border-radius: 20px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.edit-btn--cancel {
  background: var(--bg-color-tertiary);
  color: var(--text-color-primary);
}

.edit-btn--cancel:hover {
  background: var(--border-color-secondary);
}

.edit-btn--confirm {
  background: var(--primary-color);
  color: var(--text-color-inverse);
}

.edit-btn--confirm:hover {
  background: var(--primary-color-dark);
}

/* 移动端显示返回按钮 */
@media (max-width: 960px) {
  .back-btn {
    display: flex;
  }
}
</style>

<!-- 全局样式：右键菜单（Teleport 到 body，scoped 不生效） -->
<style>
.message-context-menu {
  position: fixed;
  background: var(--bg-color-primary);
  border: 1px solid var(--border-color-secondary);
  border-radius: 8px;
  box-shadow: 0 4px 16px var(--shadow-color);
  z-index: 1000;
  min-width: 100px;
  overflow: hidden;
}

.message-context-menu .menu-item {
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
  color: var(--text-color-primary);
}

.message-context-menu .menu-item:hover {
  background: var(--bg-color-secondary);
}

.message-context-menu .menu-item--danger {
  color: var(--danger-color);
}

.message-context-menu .menu-item--danger:hover {
  background: rgba(244, 33, 46, 0.1);
}

/* 设置按钮 */
.header-settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: all 0.15s;
  margin-left: auto;
  flex-shrink: 0;
}

.header-settings-btn:hover {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
}

/* 设置面板 */
.settings-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 20;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 60px 16px 16px;
}

.settings-panel {
  background: var(--bg-color-primary);
  border-radius: 12px;
  box-shadow: 0 4px 24px var(--shadow-color);
  width: 300px;
  max-height: 80%;
  overflow-y: auto;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-primary);
}

.settings-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.settings-close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--text-color-secondary);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-close-btn:hover {
  background: var(--bg-color-secondary);
}

.settings-body {
  padding: 12px 16px;
}

.settings-section {
  margin-bottom: 16px;
}

.settings-label {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-bottom: 8px;
  font-weight: 600;
}

.settings-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  width: 100%;
}

.settings-action-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger-color);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.add-friend-row {
  display: flex;
  gap: 8px;
}

.add-friend-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  font-size: 13px;
  outline: none;
}

.add-friend-input:focus {
  border-color: var(--primary-color);
}

.add-friend-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: var(--primary-color);
  color: var(--text-color-inverse);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.add-friend-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.friend-search-result {
  margin-top: 8px;
}

.friend-search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  font-size: 13px;
}

.friend-action-btn {
  padding: 4px 10px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.friend-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: var(--text-color-quaternary);
  color: var(--text-color-quaternary);
}

/* 好友申请列表 */
.friend-requests-panel {
  border-top: 1px solid var(--border-color-primary);
}

.empty-requests {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-color-tertiary);
  font-size: 13px;
}

.friend-request-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color-primary);
}

.friend-request-item:last-child {
  border-bottom: none;
}

.request-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.request-name {
  font-size: 14px;
  font-weight: 500;
}

.request-message {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.request-actions {
  display: flex;
  gap: 6px;
}

.accept-btn {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: var(--primary-color);
  color: var(--text-color-inverse);
  font-size: 12px;
  cursor: pointer;
}

.reject-btn {
  padding: 4px 10px;
  border: 1px solid var(--border-color-primary);
  border-radius: 6px;
  background: transparent;
  color: var(--text-color-secondary);
  font-size: 12px;
  cursor: pointer;
}
</style>
