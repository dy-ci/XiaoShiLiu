<script setup>
import { ref, computed, watch } from 'vue'
import UserDisplay from '@/components/user/UserDisplay.vue'
import UserName from '@/components/user/UserName.vue'
import { userApi } from '@/api/index.js'
import { useChatStore } from '@/stores/chat.js'
import { useUserStore } from '@/stores/user.js'
import { chatApi } from '@/api/chat.js'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'created'])

const chatStore = useChatStore()
const userStore = useUserStore()

const searchKeyword = ref('')
const searchResults = ref([])
const isSearching = ref(false)
const selectedUsers = ref([])
const groupTitle = ref('')
const isCreating = ref(false)
const createMode = ref('private') // 'private' | 'group'

// 是否显示群聊设置
const showGroupSettings = computed(() => createMode.value === 'group' && selectedUsers.value.length > 0)

// 好友列表缓存
const friendsList = ref([])

// 监听弹窗显示
watch(() => props.visible, async (val) => {
  if (val) {
    resetForm()
    try {
      const res = await chatApi.getFriends()
      if (res.success && res.data) {
        friendsList.value = res.data.friends || []
      }
    } catch (e) {
      // ignore
    }
  }
})

const searchError = ref('')
const createError = ref('')

// 搜索用户（从好友列表中搜索）
async function handleSearch() {
  const keyword = searchKeyword.value.trim()
  if (!keyword) {
    searchResults.value = []
    searchError.value = ''
    return
  }

  isSearching.value = true
  searchError.value = ''

  // 从好友列表中过滤
  const filtered = friendsList.value.filter(f =>
    f.nickname?.toLowerCase().includes(keyword.toLowerCase())
  )
  searchResults.value = filtered
  isSearching.value = false
}

// 防抖搜索
let searchTimer = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    handleSearch()
  }, 300)
}

// 选择/取消选择用户
function toggleSelect(user) {
  const index = selectedUsers.value.findIndex(u => String(u.id) === String(user.id))
  if (index > -1) {
    selectedUsers.value.splice(index, 1)
  } else {
    if (createMode.value === 'private' && selectedUsers.value.length >= 1) {
      // 私聊只能选一个
      selectedUsers.value = [user]
    } else {
      selectedUsers.value.push(user)
    }
  }
}

// 判断是否已选中
function isSelected(user) {
  return selectedUsers.value.some(u => String(u.id) === String(user.id))
}

// 移除已选用户
function removeSelected(user) {
  const index = selectedUsers.value.findIndex(u => String(u.id) === String(user.id))
  if (index > -1) {
    selectedUsers.value.splice(index, 1)
  }
}

// 创建会话
async function handleCreate() {
  if (selectedUsers.value.length === 0) return

  createError.value = ''
  isCreating.value = true
  try {
    let result

    if (createMode.value === 'private') {
      // 创建私聊
      const userId = selectedUsers.value[0].id
      result = await chatStore.createPrivateConversation(userId)
    } else {
      // 创建群聊
      const title = groupTitle.value.trim() || '未命名群聊'
      const memberIds = selectedUsers.value.map(u => String(u.id))
      result = await chatStore.createGroup(title, memberIds)
    }

    if (result.success) {
      emit('created', result.data)
      emit('close')
    } else {
      createError.value = result.message || '创建会话失败'
    }
  } catch (error) {
    console.error('创建会话失败:', error)
    createError.value = error.message || '创建会话失败'
  } finally {
    isCreating.value = false
  }
}

// 重置表单
function resetForm() {
  searchKeyword.value = ''
  searchResults.value = []
  selectedUsers.value = []
  groupTitle.value = ''
  createMode.value = 'private'
  isCreating.value = false
}

// 关闭弹窗
function handleClose() {
  emit('close')
}

// 切换创建模式
function switchMode(mode) {
  createMode.value = mode
  selectedUsers.value = []
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click="handleClose">
    <div class="modal-content" @click.stop>
      <!-- 弹窗头部 -->
      <div class="modal-header">
        <h3 class="modal-title">新建聊天</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>

      <!-- 模式切换 -->
      <div class="mode-tabs">
        <button
          class="mode-tab"
          :class="{ 'mode-tab--active': createMode === 'private' }"
          @click="switchMode('private')"
        >
          私聊
        </button>
        <button
          class="mode-tab"
          :class="{ 'mode-tab--active': createMode === 'group' }"
          @click="switchMode('group')"
        >
          群聊
        </button>
      </div>

      <!-- 搜索框 -->
      <div class="search-section">
        <div class="search-box">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchKeyword"
            type="text"
            class="search-input"
            placeholder="搜索昵称或悦社号..."
            @input="onSearchInput"
          />
        </div>
      </div>

      <!-- 已选用户 -->
      <div v-if="selectedUsers.length > 0" class="selected-section">
        <div class="selected-label">已选择 {{ selectedUsers.length }} 人</div>
        <div class="selected-list">
          <div
            v-for="user in selectedUsers"
            :key="user.id"
            class="selected-tag"
          >
            <UserName :nickname="user.nickname || user.username || '未知用户'" />
            <button class="tag-remove" @click="removeSelected(user)">&times;</button>
          </div>
        </div>
      </div>

      <!-- 群聊名称设置 -->
      <div v-if="showGroupSettings" class="group-settings">
        <input
          v-model="groupTitle"
          type="text"
          class="group-title-input"
          placeholder="输入群聊名称（可选）"
        />
      </div>

      <!-- 搜索结果 -->
      <div class="results-section">
        <div v-if="isSearching" class="search-status">搜索中...</div>
        <div v-else-if="searchError" class="search-status search-status--error">{{ searchError }}</div>
        <div v-else-if="searchKeyword && searchResults.length === 0" class="search-status">未找到好友，请先在设置中添加好友</div>

        <div v-for="user in searchResults" :key="user.id" class="user-item" @click="toggleSelect(user)">
          <UserDisplay
            :user="user"
            :clickable="false"
            avatar-size="md"
          />
          <div class="select-indicator" :class="{ 'select-indicator--checked': isSelected(user) }">
            <svg v-if="isSelected(user)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div v-if="createError" class="create-error">{{ createError }}</div>
      <div class="modal-footer">
        <button class="footer-btn footer-btn--cancel" @click="handleClose">取消</button>
        <button
          class="footer-btn footer-btn--confirm"
          :disabled="selectedUsers.length === 0 || isCreating"
          @click="handleCreate"
        >
          {{ isCreating ? '创建中...' : '创建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal-content {
  background: var(--bg-color-primary);
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px var(--shadow-color);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color-primary);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-color-tertiary);
  cursor: pointer;
  line-height: 1;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.close-btn:hover {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
}

.mode-tabs {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.mode-tab {
  flex: 1;
  padding: 8px 16px;
  border-radius: 20px;
  border: none;
  background: var(--bg-color-secondary);
  color: var(--text-color-secondary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-tab:hover {
  background: var(--bg-color-tertiary);
}

.mode-tab--active {
  background: var(--primary-color);
  color: var(--text-color-inverse);
}

.search-section {
  padding: 12px 20px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-color-secondary);
  border-radius: 20px;
  padding: 8px 14px;
}

.search-icon {
  color: var(--text-color-tertiary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: var(--text-color-primary);
}

.search-input::placeholder {
  color: var(--text-color-quaternary);
}

.selected-section {
  padding: 0 20px 8px;
}

.selected-label {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-bottom: 6px;
}

.selected-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.selected-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-color-secondary);
  border-radius: 16px;
  font-size: 13px;
  color: var(--text-color-primary);
}

.tag-remove {
  background: none;
  border: none;
  color: var(--text-color-tertiary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.tag-remove:hover {
  color: var(--danger-color);
}

.group-settings {
  padding: 0 20px 8px;
}

.group-title-input {
  width: 100%;
  padding: 8px 14px;
  border: 1px solid var(--border-color-secondary);
  border-radius: 20px;
  font-size: 14px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  outline: none;
  box-sizing: border-box;
}

.group-title-input:focus {
  border-color: var(--primary-color);
}

.group-title-input::placeholder {
  color: var(--text-color-quaternary);
}

.results-section {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px;
}

.search-status {
  text-align: center;
  padding: 24px;
  font-size: 14px;
  color: var(--text-color-tertiary);
}

.search-status--error {
  color: var(--danger-color, #e8553a);
}

.create-error {
  padding: 8px 20px;
  font-size: 13px;
  color: var(--danger-color, #e8553a);
  background: rgba(232, 85, 58, 0.08);
  border-top: 1px solid var(--border-color-primary);
}

.user-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color-primary);
}

.user-item:hover {
  background: var(--bg-color-secondary);
  margin: 0 -20px;
  padding: 10px 20px;
}

.select-indicator {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--border-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-inverse);
  flex-shrink: 0;
  transition: all 0.2s;
}

.select-indicator--checked {
  background: var(--primary-color);
  border-color: var(--primary-color);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color-primary);
}

.footer-btn {
  padding: 8px 20px;
  border-radius: 20px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.footer-btn--cancel {
  background: var(--bg-color-tertiary);
  color: var(--text-color-primary);
}

.footer-btn--cancel:hover {
  background: var(--border-color-secondary);
}

.footer-btn--confirm {
  background: var(--primary-color);
  color: var(--text-color-inverse);
}

.footer-btn--confirm:hover {
  background: var(--primary-color-dark);
}

.footer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
