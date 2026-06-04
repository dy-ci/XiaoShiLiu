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
        class="btn-add"
        @click="openAddDialog"
      >
        <span class="icon">+</span> 添加皮肤
      </button>
    </div>

    <!-- 衣柜网格展示 -->
    <div class="wardrobe-grid" v-if="wardrobeList.length > 0">
      <div
        v-for="item in wardrobeList"
        :key="item.id"
        :class="['wardrobe-item', { 'is-active': item.is_active }]"
        @click="handleItemClick(item)"
      >
        <!-- 皮肤预览 -->
        <div class="skin-preview">
          <img :src="item.skin_url" :alt="item.name" />
          <!-- 披风预览标记 -->
          <div v-if="item.cape_url" class="cape-badge">
            <span>披风</span>
          </div>
          <!-- 当前使用标记 -->
          <div v-if="item.is_active" class="active-badge">
            <span>当前使用</span>
          </div>
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
          <button
            class="btn-equip"
            @click.stop="equipSkin(item)"
            title="穿戴此皮肤"
          >
            穿戴
          </button>
          <button
            class="btn-edit"
            @click.stop="editItem(item)"
            title="编辑"
          >
            编辑
          </button>
          <button
            class="btn-delete"
            @click.stop="deleteItem(item)"
            title="删除"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <div class="empty-state" v-else>
      <div class="empty-icon">👕</div>
      <p class="empty-text">衣柜空空如也</p>
      <p class="empty-hint">点击上方按钮添加你的第一套皮肤吧！</p>
      <button class="btn-add-primary" @click="openAddDialog">
        添加皮肤
      </button>
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="showDialog"
      :title="editingItem ? '编辑皮肤' : '添加到衣柜'"
      width="500px"
      custom-class="wardrobe-dialog"
    >
      <form @submit.prevent="handleSubmit" class="add-form">
        <!-- 皮肤名称输入 -->
        <div class="form-group">
          <label>皮肤名称 *</label>
          <input
            v-model="formData.name"
            type="text"
            placeholder="例如：默认、战斗装、节日装..."
            maxlength="50"
            required
          />
        </div>

        <!-- 皮肤文件上传 -->
        <div class="form-group">
          <label>皮肤文件 (PNG) *</label>
          <div class="upload-area" @click="$refs.skinInput.click()">
            <input
              ref="skinInput"
              type="file"
              accept=".png,image/png"
              @change="handleSkinUpload"
              style="display: none"
            />
            <div v-if="!formData.skinFile" class="upload-placeholder">
              <span class="upload-icon">📁</span>
              <span>点击或拖拽上传皮肤文件</span>
              <span class="upload-hint">支持 PNG 格式，最大 500KB</span>
            </div>
            <div v-else class="upload-preview">
              <img :src="skinPreviewUrl" alt="皮肤预览" />
              <button
                type="button"
                class="btn-remove-file"
                @click.prevent="removeSkinFile"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <!-- 皮肤模型选择 -->
        <div class="form-group">
          <label>皮肤模型</label>
          <div class="model-selector">
            <label :class="['model-option', { active: formData.model === 'classic' }]">
              <input
                type="radio"
                value="classic"
                v-model="formData.model"
              />
              <span class="model-preview classic"></span>
              <span>经典 (宽)</span>
            </label>
            <label :class="['model-option', { active: formData.model === 'slim' }]">
              <input
                type="radio"
                value="slim"
                v-model="formData.model"
              />
              <span class="model-preview slim"></span>
              <span>Slim (细)</span>
            </label>
          </div>
        </div>

        <!-- 披风上传（可选） -->
        <div class="form-group">
          <label>披风文件 (可选)</label>
          <div class="upload-area cape-upload" @click="$refs.capeInput.click()">
            <input
              ref="capeInput"
              type="file"
              accept=".png,image/png"
              @change="handleCapeUpload"
              style="display: none"
            />
            <div v-if="!formData.capeFile" class="upload-placeholder small">
              <span class="upload-icon">🧥</span>
              <span>可选：上传披风</span>
            </div>
            <div v-else class="upload-preview small">
              <img :src="capePreviewUrl" alt="披风预览" />
              <button
                type="button"
                class="btn-remove-file"
                @click.prevent="removeCapeFile"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </form>

      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button
          type="primary"
          @click="handleSubmit"
          :disabled="!canSubmit"
        >
          {{ editingItem ? '保存修改' : '添加到衣柜' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 删除确认对话框 -->
    <el-dialog
      v-model="showDeleteConfirm"
      title="确认删除"
      width="400px"
    >
      <p>确定要删除「{{ deletingItem?.name }}」吗？</p>
      <p class="delete-warning">注意：删除后无法恢复</p>
      <template #footer>
        <el-button @click="showDeleteConfirm = false">取消</el-button>
        <el-button
          type="danger"
          @click="confirmDelete"
        >
          确认删除
        </el-button>
      </template>
    </el-dialog>

    <!-- 穿戴确认对话框 -->
    <el-dialog
      v-model="showEquipConfirm"
      title="切换皮肤"
      width="450px"
    >
      <div class="equip-preview">
        <h4>确定要切换到「{{ equippingItem?.name }}」吗？</h4>
        <div class="preview-compare">
          <div class="preview-item current">
            <span class="label">当前</span>
            <img :src="currentSkin?.skin_url" alt="当前皮肤" />
          </div>
          <span class="arrow">→</span>
          <div class="preview-item new">
            <span class="label">新皮肤</span>
            <img :src="equippingItem?.skin_url" alt="新皮肤" />
          </div>
        </div>
        <p class="equip-notice">切换后需要重新登录游戏才能生效</p>
      </div>
      <template #footer>
        <el-button @click="showEquipConfirm = false">取消</el-button>
        <el-button
          type="success"
          @click="confirmEquip"
        >
          确认切换
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api/game';

const props = defineProps({
  profileId: {
    type: [String, Number],
    required: true
  }
});

// 数据状态
const wardrobeList = ref([]);
const maxWardrobes = ref(10);
const showDialog = ref(false);
const showDeleteConfirm = ref(false);
const showEquipConfirm = ref(false);
const editingItem = ref(null);
const deletingItem = ref(null);
const equippingItem = ref(null);

// 表单数据
const formData = reactive({
  name: '',
  model: 'classic',
  skinFile: null,
  capeFile: null
});

// 预览URL
const skinPreviewUrl = ref('');
const capePreviewUrl = ref('');

// 计算属性
const canSubmit = computed(() => {
  return formData.name.trim() && formData.skinFile;
});

const currentSkin = computed(() => {
  return wardrobeList.value.find(item => item.is_active);
});

// 方法
onMounted(async () => {
  await fetchWardrobe();
});

// 获取衣柜列表
async function fetchWardrobe() {
  try {
    const res = await api.getWardrobe(props.profileId);
    if (res.code === 200) {
      wardrobeList.value = res.data.wardrobe;
      maxWardrobes.value = res.data.max_wardrobes;
    }
  } catch (error) {
    console.error('获取衣柜失败:', error);
    ElMessage.error('获取衣柜列表失败');
  }
}

// 打开添加对话框
function openAddDialog() {
  resetForm();
  showDialog.value = true;
}

// 上传皮肤文件
function handleSkinUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.type !== 'image/png') {
    ElMessage.error('只支持PNG格式的图片');
    return;
  }

  if (file.size > 500 * 1024) {
    ElMessage.error('文件大小不能超过500KB');
    return;
  }

  formData.skinFile = file;
  skinPreviewUrl.value = URL.createObjectURL(file);
}

// 上传披风文件
function handleCapeUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.type !== 'image/png') {
    ElMessage.error('只支持PNG格式的图片');
    return;
  }

  formData.capeFile = file;
  capePreviewUrl.value = URL.createObjectURL(file);
}

// 移除皮肤文件
function removeSkinFile() {
  formData.skinFile = null;
  skinPreviewUrl.value = '';
}

// 移除披风文件
function removeCapeFile() {
  formData.capeFile = null;
  capePreviewUrl.value = '';
}

// 提交表单（添加或编辑）
async function handleSubmit() {
  if (!canSubmit.value) return;

  try {
    let res;

    if (editingItem.value) {
      // 编辑模式（只更新名称和模型）
      res = await api.updateWardrobeItem(props.profileId, editingItem.value.id, {
        name: formData.name,
        model: formData.model
      });
    } else {
      // 新增模式
      const formPayload = new FormData();
      formPayload.append('name', formData.name);
      formPayload.append('model', formData.model);
      formPayload.append('skin', formData.skinFile);

      if (formData.capeFile) {
        formPayload.append('cape', formData.capeFile);
      }

      res = await api.addToWardrobe(props.profileId, formPayload);
    }

    if (res.code === 200) {
      ElMessage.success(editingItem.value ? '更新成功' : '添加成功');
      showDialog.value = false;
      resetForm();
      await fetchWardrobe();
    } else {
      ElMessage.error(res.message || '操作失败');
    }
  } catch (error) {
    console.error('提交失败:', error);
    ElMessage.error('操作失败，请重试');
  }
}

// 编辑项
function editItem(item) {
  editingItem.value = item;
  formData.name = item.name;
  formData.model = item.skin_model;
  // 预填充现有图片（仅用于显示）
  skinPreviewUrl.value = item.skin_url;
  if (item.cape_url) {
    capePreviewUrl.value = item.cape_url;
  }
  showDialog.value = true;
}

// 删除项
function deleteItem(item) {
  deletingItem.value = item;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  try {
    const res = await api.deleteWardrobeItem(props.profileId, deletingItem.value.id);
    if (res.code === 200) {
      ElMessage.success('删除成功');
      showDeleteConfirm.value = false;
      await fetchWardrobe();
    }
  } catch (error) {
    console.error('删除失败:', error);
    ElMessage.error('删除失败');
  }
}

// 穿戴皮肤
function equipSkin(item) {
  equippingItem.value = item;
  showEquipConfirm.value = true;
}

async function confirmEquip() {
  try {
    const res = await api.equipWardrobeItem(props.profileId, equippingItem.value.id);
    if (res.code === 200) {
      ElMessage.success('切换成功，请重新登录游戏');
      showEquipConfirm.value = false;
      await fetchWardrobe();
    }
  } catch (error) {
    console.error('切换失败:', error);
    ElMessage.error('切换失败');
  }
}

// 点击卡片（查看详情或预览）
function handleItemClick(item) {
  // 可以在这里添加预览功能
  console.log('点击了:', item.name);
}

// 重置表单
function resetForm() {
  formData.name = '';
  formData.model = 'classic';
  formData.skinFile = null;
  formData.capeFile = null;
  skinPreviewUrl.value = '';
  capePreviewUrl.value = '';
  editingItem.value = null;
}

// 格式化时间
function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)} 天前`;

  return date.toLocaleDateString('zh-CN');
}
</script>

<style scoped lang="scss">
.skin-wardrobe {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

/* 头部样式 */
.wardrobe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #e5e7eb;

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 12px;

    .title {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin: 0;
    }

    .count {
      font-size: 14px;
      color: #6b7280;
    }
  }

  .btn-add {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    .icon {
      font-size: 18px;
      font-weight: bold;
    }
  }
}

/* 衣柜网格 */
.wardrobe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

/* 单个衣柜项 */
.wardrobe-item {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  position: relative;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);

    .action-buttons {
      opacity: 1;
      transform: translateY(0);
    }
  }

  &.is-active {
    border: 3px solid #667eea;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);

    .active-badge {
      display: flex;
    }
  }
}

/* 皮肤预览区 */
.skin-preview {
  position: relative;
  width: 100%;
  height: 280px;
  background: linear-gradient(180deg, #87CEEB 0%, #98D8C8 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  img {
    max-width: 80%;
    max-height: 90%;
    object-fit: contain;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }
}

/* 标记徽章 */
.active-badge,
.cape-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  z-index: 1;
}

.active-badge {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: none; /* 默认隐藏，通过 is-active 类显示 */
}

.cape-badge {
  top: 44px;
  background: rgba(255, 255, 255, 0.95);
  color: #374151;
  border: 1px solid #d1d5db;
}

/* 皮肤信息区 */
.skin-info {
  padding: 16px;

  .skin-name {
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 8px 0;
  }

  .skin-meta {
    display: flex;
    align-items: center;
    gap: 10px;

    .model-tag {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;

      &.classic {
        background: #dbeafe;
        color: #1e40af;
      }

      &.slim {
        background: #fce7f3;
        color: #9d174d;
      }
    }

    .time {
      font-size: 13px;
      color: #9ca3af;
    }
  }
}

/* 操作按钮组 */
.action-buttons {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: linear-gradient(to top, rgba(255, 255, 255, 0.95), transparent);
  display: flex;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s ease;

  button {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      transform: scale(1.05);
    }
  }

  .btn-equip {
    background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
    color: white;
  }

  .btn-edit {
    background: #f3f4f6;
    color: #374151;

    &:hover {
      background: #e5e7eb;
    }
  }

  .btn-delete {
    background: #fef2f2;
    color: #dc2626;

    &:hover {
      background: #fee2e2;
    }
  }
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 60px 20px;

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
  }

  .empty-text {
    font-size: 18px;
    font-weight: 600;
    color: #374151;
    margin: 0 0 8px 0;
  }

  .empty-hint {
    font-size: 14px;
    color: #9ca3af;
    margin: 0 0 24px 0;
  }

  .btn-add-primary {
    padding: 12px 32px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }
  }
}

/* 对话框样式 */
.wardrobe-dialog {
  .form-group {
    margin-bottom: 20px;

    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
    }
  }

  input[type="text"] {
    width: 100%;
    padding: 10px 14px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    font-size: 14px;
    transition: border-color 0.3s ease;
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: #667eea;
    }
  }
}

/* 上传区域 */
.upload-area {
  border: 2px dashed #d1d5db;
  border-radius: 12px;
  padding: 30px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    border-color: #667eea;
    background: #f9fafb;
  }

  &.cape-upload {
    padding: 20px;
  }

  .upload-placeholder {
    .upload-icon {
      font-size: 36px;
      display: block;
      margin-bottom: 8px;
    }

    span {
      display: block;
      color: #6b7280;
      font-size: 14px;
    }

    .upload-hint {
      font-size: 12px;
      color: #9ca3af;
      margin-top: 4px;
    }

    &.small {
      .upload-icon {
        font-size: 28px;
      }
    }
  }

  .upload-preview {
    position: relative;
    display: inline-block;

    img {
      max-width: 100%;
      max-height: 300px;
      image-rendering: pixelated;
      border-radius: 8px;
    }

    &.small img {
      max-height: 150px;
    }

    .btn-remove-file {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #ef4444;
      color: white;
      border: none;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }
  }
}

/* 模型选择器 */
.model-selector {
  display: flex;
  gap: 16px;

  .model-option {
    flex: 1;
    padding: 16px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    text-align: center;
    transition: all 0.3s ease;

    &:hover {
      border-color: #667eea;
    }

    &.active {
      border-color: #667eea;
      background: #f5f3ff;
    }

    input[type="radio"] {
      display: none;
    }

    .model-preview {
      display: inline-block;
      width: 40px;
      height: 60px;
      background: #d1d5db;
      border-radius: 4px;
      margin-bottom: 8px;

      &.classic {
        width: 30px;
      }

      &.slim {
        width: 22px;
      }
    }

    span:last-child {
      font-size: 13px;
      color: #374151;
    }
  }
}

/* 底部按钮 */
.btn-submit {
  padding: 10px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.delete-warning {
  font-size: 13px;
  color: #ef4444;
  margin: 8px 0 0 0;
}

/* 穿戴确认对话框 */
.equip-preview {
  h4 {
    font-size: 16px;
    color: #374151;
    margin: 0 0 20px 0;
    text-align: center;
  }

  .preview-compare {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    margin-bottom: 16px;

    .preview-item {
      text-align: center;

      .label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        margin-bottom: 8px;
      }

      img {
        width: 120px;
        height: 160px;
        object-fit: contain;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        image-rendering: pixelated;
      }

      &.new img {
        border-color: #10b981;
      }
    }

    .arrow {
      font-size: 24px;
      color: #9ca3af;
    }
  }

  .equip-notice {
    text-align: center;
    font-size: 13px;
    color: #f59e0b;
    margin: 0;
  }
}
</style>
