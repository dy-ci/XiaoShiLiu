<template>
  <div class="skin-wardrobe">
    <!-- 头部信息栏 -->
    <div class="wardrobe-header">
      <div class="header-left">
        <h3 class="title">我的衣柜</h3>
        <span class="count">{{ wardrobeList.length }} / {{ maxWardrobes }} 套</span>
      </div>
      <button
        v-if="wardrobeList.length < maxWardrobes"
        class="btn btn-primary btn-sm"
        @click="openAddDialog"
      >
        + 添加皮肤
      </button>
    </div>

    <!-- 衣柜网格展示 -->
    <div class="wardrobe-grid" v-if="wardrobeList.length > 0">
      <div
        v-for="item in wardrobeList"
        :key="item.id"
        :class="['wardrobe-item', { 'is-active': item.is_active }]"
      >
        <!-- 皮肤预览 -->
        <div class="skin-preview">
          <img :src="item.skin_url" :alt="item.name" />
          <div v-if="item.cape_url" class="cape-badge">披风</div>
          <div v-if="item.is_active" class="active-badge">当前使用</div>
        </div>

        <!-- 皮肤信息 -->
        <div class="skin-info">
          <h4 class="skin-name">{{ item.name }}</h4>
          <div class="skin-meta">
            <span class="model-tag" :class="item.skin_model">
              {{ item.skin_model === 'slim' ? 'Slim' : 'Classic' }}
            </span>
            <span class="time">{{ formatTime(item.created_at) }}</span>
          </div>
        </div>

        <!-- 操作按钮组 -->
        <div class="action-buttons" v-if="!item.is_active">
          <button class="btn btn-primary btn-xs" @click="equipSkin(item)" :disabled="isEquipping">
            {{ isEquipping ? '切换中...' : '穿戴' }}
          </button>
          <button class="btn btn-secondary btn-xs" @click="editItem(item)">编辑</button>
          <button class="btn btn-danger btn-xs" @click="deleteItem(item)">删除</button>
        </div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <div class="empty-state" v-else>
      <p class="empty-text">衣柜空空如也</p>
      <p class="empty-hint">点击上方按钮添加你的第一套皮肤吧</p>
    </div>

    <!-- 添加/编辑对话框 -->
    <Teleport to="body">
      <div class="modal-overlay" v-if="showDialog" @click.self="showDialog = false">
        <div class="modal-container">
          <div class="modal-header">
            <h2>{{ editingItem ? '编辑皮肤' : '添加到衣柜' }}</h2>
            <button class="close-btn" @click="showDialog = false">
              <SvgIcon name="close" />
            </button>
          </div>

          <form @submit.prevent="handleSubmit" class="edit-form">
            <div class="form-group">
              <label>皮肤名称 *</label>
              <input
                v-model="formData.name"
                type="text"
                placeholder="例如：默认、战斗装、节日装..."
                maxlength="50"
              />
            </div>

            <div class="form-group">
              <label>皮肤文件 (PNG) *{{ editingItem ? '（不修改则留空）' : '' }}</label>
              <div class="file-input-wrapper">
                <input
                  type="file"
                  id="wardrobe-skin-file"
                  @change="handleSkinUpload"
                />
                <label for="wardrobe-skin-file" class="file-label">
                  {{ formData.skinFile ? formData.skinFile.name : '选择皮肤文件（PNG格式，最大500KB）' }}
                </label>
                <p v-if="formData.skinFile" class="file-selected">
                  已选择: {{ formData.skinFile.name }} ({{ (formData.skinFile.size / 1024).toFixed(1) }}KB)
                </p>
              </div>
              <div v-if="editingItem && !formData.skinFile && editingItem.skin_url" class="current-skin-hint">
                当前皮肤将保留不变
              </div>
            </div>

            <div class="form-group">
              <label>皮肤模型</label>
              <div class="model-select">
                <label :class="['radio-option', { active: formData.model === 'classic' }]">
                  <input type="radio" value="classic" v-model="formData.model" />
                  <span>经典（宽）</span>
                </label>
                <label :class="['radio-option', { active: formData.model === 'slim' }]">
                  <input type="radio" value="slim" v-model="formData.model" />
                  <span>Slim（细）</span>
                </label>
              </div>
            </div>

            <div class="form-group">
              <label>披风文件（可选）</label>
              <div class="file-input-wrapper">
                <input
                  type="file"
                  id="wardrobe-cape-file"
                  @change="handleCapeUpload"
                />
                <label for="wardrobe-cape-file" class="file-label small">
                  {{ formData.capeFile ? formData.capeFile.name : '选择披风文件（可选）' }}
                </label>
                <p v-if="formData.capeFile" class="file-selected">
                  已选择: {{ formData.capeFile.name }} ({{ (formData.capeFile.size / 1024).toFixed(1) }}KB)
                </p>
              </div>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" @click="showDialog = false">取消</button>
              <button type="submit" class="btn btn-primary" :disabled="!canSubmit || isSubmitting">
                {{ isSubmitting ? '提交中...' : (editingItem ? '保存修改' : '添加到衣柜') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { gameApi } from '@/api/game'
import messageManager from '@/utils/messageManager'
import SvgIcon from '@/components/SvgIcon.vue'

const props = defineProps({
  profileId: {
    type: [String, Number],
    required: true
  },
  playerName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['equipped'])

// 数据状态
const wardrobeList = ref([])
const maxWardrobes = ref(10)
const showDialog = ref(false)
const editingItem = ref(null)
const isSubmitting = ref(false)
const isEquipping = ref(false)

// 表单数据
const formData = reactive({
  name: '',
  model: 'classic',
  skinFile: null,
  capeFile: null
})

// 计算属性
const canSubmit = computed(() => {
  return formData.name.trim() && (editingItem.value || formData.skinFile)
})

onMounted(async () => {
  await fetchWardrobe()
})

async function fetchWardrobe() {
  try {
    const res = await gameApi.getWardrobe(props.profileId)
    if (res.code === 200) {
      wardrobeList.value = res.data.wardrobe || []
      maxWardrobes.value = res.data.max_wardrobes || 10
    }
  } catch (error) {
    console.error('获取衣柜失败:', error)
    messageManager.error('获取衣柜列表失败')
  }
}

function openAddDialog() {
  resetForm()
  showDialog.value = true
}

function handleSkinUpload(event) {
  const file = event.target.files[0]
  if (!file) return

  if (file.type !== 'image/png') {
    messageManager.error('只支持PNG格式的图片文件')
    event.target.value = ''
    return
  }

  if (file.size > 500 * 1024) {
    messageManager.error('文件大小超过500KB限制')
    event.target.value = ''
    return
  }

  formData.skinFile = file
}

function handleCapeUpload(event) {
  const file = event.target.files[0]
  if (!file) return

  if (file.type !== 'image/png') {
    messageManager.error('只支持PNG格式的图片文件')
    event.target.value = ''
    return
  }

  if (file.size > 500 * 1024) {
    messageManager.error('文件大小超过500KB限制')
    event.target.value = ''
    return
  }

  formData.capeFile = file
}

async function handleSubmit() {
  if (!canSubmit.value) return

  isSubmitting.value = true

  try {
    let res

    if (editingItem.value) {
      const payload = {
        name: formData.name,
        model: formData.model
      }

      if (formData.skinFile) {
        const formPayload = new FormData()
        formPayload.append('name', formData.name)
        formPayload.append('model', formData.model)
        formPayload.append('skin', formData.skinFile)

        if (formData.capeFile) {
          formPayload.append('cape', formData.capeFile)
        }

        res = await gameApi.addToWardrobe(props.profileId, formPayload)
        await gameApi.deleteWardrobeItem(props.profileId, editingItem.value.id)
      } else {
        res = await gameApi.updateWardrobeItem(props.profileId, editingItem.value.id, payload)
      }
    } else {
      const formPayload = new FormData()
      formPayload.append('name', formData.name)
      formPayload.append('model', formData.model)
      formPayload.append('skin', formData.skinFile)

      if (formData.capeFile) {
        formPayload.append('cape', formData.capeFile)
      }

      res = await gameApi.addToWardrobe(props.profileId, formPayload)
    }

    if (res.code === 200) {
      messageManager.success(editingItem.value ? '更新成功' : '添加成功')
      showDialog.value = false
      resetForm()
      await fetchWardrobe()
    } else {
      messageManager.error(res.message || '操作失败')
    }
  } catch (error) {
    console.error('提交失败:', error)
    messageManager.error('操作失败，请重试')
  } finally {
    isSubmitting.value = false
  }
}

function editItem(item) {
  editingItem.value = item
  formData.name = item.name
  formData.model = item.skin_model
  formData.skinFile = null
  formData.capeFile = null
  showDialog.value = true
}

async function deleteItem(item) {
  if (!confirm(`确定要删除「${item.name}」吗？此操作不可恢复`)) {
    return
  }

  try {
    const res = await gameApi.deleteWardrobeItem(props.profileId, item.id)
    if (res.code === 200) {
      messageManager.success('删除成功')
      await fetchWardrobe()
    } else {
      messageManager.error(res.message || '删除失败')
    }
  } catch (error) {
    console.error('删除失败:', error)
    messageManager.error('删除失败')
  }
}

async function equipSkin(item) {
  const currentSkin = wardrobeList.value.find(i => i.is_active)

  let confirmMsg = ''
  if (currentSkin && currentSkin.id !== item.id) {
    confirmMsg = `切换到「${item.name}」后，当前皮肤将保留在衣柜中。\n\n是否继续？`
  } else {
    confirmMsg = `确定要切换到「${item.name}」吗？\n切换后需要重新登录游戏才能生效`
  }

  if (!confirm(confirmMsg)) {
    return
  }

  isEquipping.value = true

  try {
    const res = await gameApi.equipWardrobeItem(props.profileId, item.id)

    if (res.code === 200) {
      messageManager.success(`已切换为「${item.name}」，请重新登录游戏`)
      emit('equipped', item)
      await fetchWardrobe()
    } else {
      messageManager.error(res.message || '切换失败')
    }
  } catch (error) {
    console.error('切换失败:', error)
    messageManager.error('切换失败，请重试')
  } finally {
    isEquipping.value = false
  }
}

function resetForm() {
  formData.name = ''
  formData.model = 'classic'
  formData.skinFile = null
  formData.capeFile = null
  editingItem.value = null
  const skinInput = document.getElementById('wardrobe-skin-file')
  const capeInput = document.getElementById('wardrobe-cape-file')
  if (skinInput) skinInput.value = ''
  if (capeInput) capeInput.value = ''
}

function formatTime(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)} 天前`

  return date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
/* ====== 头部 ====== */
.skin-wardrobe {
  padding: 0;
}

.wardrobe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0;
}

.count {
  font-size: 13px;
  color: var(--text-color-tertiary);
}

/* ====== 衣柜网格 ====== */
.wardrobe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

/* ====== 衣柜项 ====== */
.wardrobe-item {
  background: var(--bg-color-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
  position: relative;
}

.wardrobe-item:hover {
  border-color: var(--primary-color);
}

.wardrobe-item:hover .action-buttons {
  opacity: 1;
}

.wardrobe-item.is-active {
  border-color: var(--primary-color);
  background: var(--bg-color-secondary);
}

.wardrobe-item.is-active .active-badge {
  display: flex;
}

/* ====== 皮肤预览区 ====== */
.skin-preview {
  position: relative;
  width: 100%;
  height: 160px;
  background: linear-gradient(180deg, #87CEEB 0%, #98D8C8 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.skin-preview img {
  max-width: 70%;
  max-height: 85%;
  object-fit: contain;
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
}

/* 标记徽章 */
.active-badge,
.cape-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  z-index: 1;
}

.active-badge {
  background: var(--primary-color);
  color: white;
  display: none;
}

.cape-badge {
  top: 28px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color);
}

/* ====== 皮肤信息区 ====== */
.skin-info {
  padding: 10px 12px;
}

.skin-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0 0 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skin-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.model-tag.classic {
  background: #dbeafe;
  color: #1e40af;
}

.model-tag.slim {
  background: #fce7f3;
  color: #9d174d;
}

.time {
  font-size: 11px;
  color: var(--text-color-tertiary);
}

/* ====== 操作按钮组 ====== */
.action-buttons {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px;
  background: linear-gradient(to top, var(--bg-color-primary), transparent);
  display: flex;
  justify-content: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* ====== 按钮（与CreateProfileModal统一） ====== */
.btn {
  padding: 12px 24px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
}

.btn-xs {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-color-dark);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-color-tertiary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--hover-bg-color);
}

.btn-danger {
  background: var(--danger-color);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: var(--danger-color-dark);
}

/* ====== 空状态 ====== */
.empty-state {
  text-align: center;
  padding: 40px 20px;
}

.empty-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color-secondary);
  margin: 0 0 6px 0;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-color-tertiary);
  margin: 0;
}

/* ====== 对话框（与CreateProfileModal完全一致） ====== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.modal-container {
  background: var(--bg-color-secondary);
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-color-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-secondary);
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--hover-bg-color);
  color: var(--text-color-primary);
}

/* ====== 表单（与CreateProfileModal完全一致） ====== */
.edit-form {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
}

.form-group input[type="text"] {
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  transition: all 0.2s ease;
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(254, 40, 67, 0.1);
}

.current-skin-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

/* ====== 文件上传区域 ====== */
.file-input-wrapper {
  position: relative;
}

.file-input-wrapper input[type="file"] {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  z-index: 2;
}

.file-label {
  display: block;
  padding: 14px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-color-secondary);
  transition: all 0.2s ease;
  position: relative;
  z-index: 1;
  word-break: break-all;
}

.file-label:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--bg-color-tertiary);
}

.file-label.small {
  padding: 10px;
  font-size: 12px;
}

.file-selected {
  font-size: 13px;
  color: var(--primary-color);
  margin-top: 8px;
}

/* ====== 模型选择器 ====== */
.model-select {
  display: flex;
  gap: 10px;
}

.radio-option {
  flex: 1;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  font-size: 13px;
  color: var(--text-color-secondary);
  background: var(--bg-color-primary);
}

.radio-option:hover {
  border-color: var(--primary-color);
}

.radio-option.active {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: white;
}

.radio-option input[type="radio"] {
  display: none;
}

/* ====== 表单操作区 ====== */
.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
