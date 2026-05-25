<template>
  <div class="admin-management">
    <div class="page-header">
      <h2>管理员管理</h2>
      <button @click="openCreateModal" class="btn btn-primary">
        <span>+</span> 新建管理员
      </button>
    </div>

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>昵称</th>
            <th>角色</th>
            <th>Logto ID</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="admin in admins" :key="admin.id">
            <td>{{ admin.username }}</td>
            <td>{{ admin.nickname || '-' }}</td>
            <td>
              <span :class="['role-tag', admin.isSuper ? 'super' : 'normal']">
                {{ admin.isSuper ? '超级管理员' : '管理员' }}
              </span>
            </td>
            <td>{{ admin.logtoId || '-' }}</td>
            <td>{{ formatDate(admin.createdAt) }}</td>
            <td class="actions">
              <button @click="openPermissionModal(admin)" class="btn-link">权限</button>
              <button 
                v-if="admin.id !== currentAdminId" 
                @click="confirmDelete(admin)" 
                class="btn-link danger"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-if="admins.length === 0 && !loading" class="empty">暂无管理员</div>

    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ isEdit ? '编辑管理员' : '新建管理员' }}</h3>
          <button @click="closeModal" class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>用户名 *</label>
            <input 
              v-model="formData.username" 
              type="text" 
              placeholder="输入用户名"
              :disabled="isEdit"
            />
            <span class="help-text">必填，用于关联 Logto 账户</span>
          </div>
          <div class="form-group">
            <label>Logto ID</label>
            <input 
              v-model="formData.logtoId" 
              type="text" 
              placeholder="留空则自动匹配"
              :disabled="isEdit"
            />
            <span class="help-text">建议留空，系统会自动匹配用户名</span>
          </div>
          <div class="form-group">
            <label>昵称</label>
            <input v-model="formData.nickname" type="text" placeholder="输入昵称" />
          </div>
          <div class="form-group">
            <label>
              <input v-model="formData.isSuper" type="checkbox" />
              设为超级管理员
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closeModal" class="btn btn-outline">取消</button>
          <button @click="submitForm" class="btn btn-primary" :disabled="submitting">
            {{ submitting ? '提交中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showPermissionModal" class="modal-overlay" @click.self="closePermissionModal">
      <div class="modal modal-large">
        <div class="modal-header">
          <h3>设置权限 - {{ permissionFormData.nickname }}</h3>
          <button @click="closePermissionModal" class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>
              <input v-model="permissionFormData.isSuper" type="checkbox" />
              超级管理员（拥有所有权限）
            </label>
          </div>
          
          <div v-if="!permissionFormData.isSuper" class="permission-section">
            <div class="form-group">
              <label>快速选择角色</label>
              <div class="role-buttons">
                <button 
                  v-for="role in roles" 
                  :key="role.key"
                  :class="['btn', 'btn-outline', { active: selectedRole === role.key }]"
                  @click="selectRole(role)"
                >
                  {{ role.name }}
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>精细权限配置</label>
              <div class="permission-groups">
                <div v-for="group in permissionGroups" :key="group.name" class="permission-group">
                  <div class="group-title">{{ group.name }}</div>
                  <div class="permission-list">
                    <label 
                      v-for="perm in group.permissions" 
                      :key="perm.key"
                      class="permission-item"
                    >
                      <input 
                        type="checkbox" 
                        :value="perm.key" 
                        v-model="permissionFormData.permissions"
                      />
                      <span>{{ perm.label }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closePermissionModal" class="btn btn-outline">取消</button>
          <button @click="submitPermission" class="btn btn-primary" :disabled="submitting">
            {{ submitting ? '保存中...' : '保存权限' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal modal-small">
        <div class="modal-header">
          <h3>确认删除</h3>
        </div>
        <div class="modal-body">
          <p>确定要删除管理员 <strong>{{ deleteTarget?.nickname || deleteTarget?.username }}</strong> 吗？</p>
          <p class="warning">此操作不可撤销</p>
        </div>
        <div class="modal-footer">
          <button @click="showDeleteConfirm = false" class="btn btn-outline">取消</button>
          <button @click="executeDelete" class="btn btn-danger" :disabled="submitting">
            {{ submitting ? '删除中...' : '删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAdminStore } from '@/stores/admin'
import apiConfig from '@/config/api.js'
import messageManager from '@/utils/messageManager'

const adminStore = useAdminStore()

const admins = ref([])
const loading = ref(false)
const showModal = ref(false)
const showPermissionModal = ref(false)
const showDeleteConfirm = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const selectedRole = ref('')
const deleteTarget = ref(null)
const currentAdminId = ref(null)

const formData = ref({
  id: null,
  username: '',
  logtoId: '',
  nickname: '',
  isSuper: false
})

const permissionFormData = ref({
  id: null,
  nickname: '',
  isSuper: false,
  permissions: []
})

const permissionGroups = [
  {
    name: '系统功能',
    permissions: [
      { key: 'api_docs:view', label: '查看API文档' },
      { key: 'monitor:view', label: '查看系统监控' }
    ]
  },
  {
    name: '用户管理',
    permissions: [
      { key: 'users:view', label: '查看用户' },
      { key: 'users:edit', label: '编辑用户' },
      { key: 'users:delete', label: '删除用户' },
      { key: 'users:ban', label: '封禁/解封用户' }
    ]
  },
  {
    name: '内容管理',
    permissions: [
      { key: 'posts:view', label: '查看笔记' },
      { key: 'posts:edit', label: '编辑笔记' },
      { key: 'posts:delete', label: '删除笔记' },
      { key: 'post_audit:view', label: '查看待审核笔记' },
      { key: 'post_audit:audit', label: '审核笔记' },
      { key: 'comments:view', label: '查看评论' },
      { key: 'comments:edit', label: '编辑评论' },
      { key: 'comments:delete', label: '删除评论' }
    ]
  },
  {
    name: '分类与标签',
    permissions: [
      { key: 'categories:view', label: '查看分类' },
      { key: 'categories:edit', label: '编辑分类' },
      { key: 'categories:delete', label: '删除分类' },
      { key: 'categories:create', label: '创建分类' },
      { key: 'tags:view', label: '查看标签' },
      { key: 'tags:edit', label: '编辑标签' },
      { key: 'tags:delete', label: '删除标签' },
      { key: 'tags:create', label: '创建标签' }
    ]
  },
  {
    name: '互动管理',
    permissions: [
      { key: 'likes:view', label: '查看点赞' },
      { key: 'likes:delete', label: '删除点赞' },
      { key: 'collections:view', label: '查看收藏' },
      { key: 'collections:delete', label: '删除收藏' },
      { key: 'follows:view', label: '查看关注' },
      { key: 'follows:delete', label: '删除关注' }
    ]
  },
  {
    name: '通知管理',
    permissions: [
      { key: 'notifications:view', label: '查看通知' },
      { key: 'notifications:create', label: '发送通知' },
      { key: 'notifications:delete', label: '删除通知' }
    ]
  },
  {
    name: '会话管理',
    permissions: [
      { key: 'user_sessions:view', label: '查看用户会话' },
      { key: 'user_sessions:delete', label: '禁用用户会话' },
      { key: 'admin_sessions:view', label: '查看管理员会话' },
      { key: 'admin_sessions:delete', label: '禁用管理员会话' }
    ]
  },
  {
    name: '认证管理',
    permissions: [
      { key: 'audit:view', label: '查看认证审核' },
      { key: 'audit:audit', label: '审核认证' }
    ]
  },
  {
    name: '管理员管理',
    permissions: [
      { key: 'admins:view', label: '查看管理员' },
      { key: 'admins:edit', label: '编辑管理员' },
      { key: 'admins:delete', label: '删除管理员' },
      { key: 'admins:create', label: '创建管理员' }
    ]
  }
]

const roles = [
  { key: 'content_admin', name: '内容管理员', permissions: [
    'posts:view', 'posts:edit', 'posts:delete',
    'post_audit:view', 'post_audit:audit',
    'comments:view', 'comments:edit', 'comments:delete',
    'categories:view', 'categories:edit', 'categories:delete', 'categories:create',
    'tags:view', 'tags:edit', 'tags:delete', 'tags:create'
  ]},
  { key: 'user_admin', name: '用户管理员', permissions: [
    'users:view', 'users:edit', 'users:delete', 'users:ban',
    'audit:view', 'audit:audit'
  ]},
  { key: 'operator', name: '运维人员', permissions: [
    'api_docs:view', 'monitor:view',
    'user_sessions:view', 'user_sessions:delete',
    'admin_sessions:view', 'admin_sessions:delete'
  ]}
]

const getAuthHeaders = () => {
  const headers = { 'Content-Type': 'application/json' }
  const token = localStorage.getItem('admin_token')
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

const loadAdmins = async () => {
  loading.value = true
  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/admins`, {
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      admins.value = result.data.data || result.data
    }
  } catch (error) {
    console.error('加载管理员失败:', error)
  } finally {
    loading.value = false
  }
}

const formatDate = (date) => {
  if (!date) return '-'
  return new Date(date).toLocaleString('zh-CN')
}

const openCreateModal = () => {
  isEdit.value = false
  formData.value = {
    id: null,
    username: '',
    logtoId: '',
    nickname: '',
    isSuper: false
  }
  showModal.value = true
}

const openPermissionModal = (admin) => {
  selectedRole.value = ''
  permissionFormData.value = {
    id: admin.id,
    nickname: admin.nickname || admin.username,
    isSuper: admin.isSuper || false,
    permissions: admin.permissions || []
  }
  showPermissionModal.value = true
}

const selectRole = (role) => {
  selectedRole.value = role.key
  permissionFormData.value.permissions = [...role.permissions]
}

const closeModal = () => {
  showModal.value = false
}

const closePermissionModal = () => {
  showPermissionModal.value = false
}

const submitForm = async () => {
  if (!formData.value.username) {
    messageManager.error('用户名不能为空')
    return
  }

  submitting.value = true
  try {
    const url = isEdit.value 
      ? `${apiConfig.baseURL}/admin/admins/${formData.value.id}`
      : `${apiConfig.baseURL}/admin/admins`
    const method = isEdit.value ? 'PUT' : 'POST'

    const response = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify({
        username: formData.value.username,
        logtoId: formData.value.logtoId || null,
        nickname: formData.value.nickname || formData.value.username,
        isSuper: formData.value.isSuper
      })
    })

    const result = await response.json()
    if (result.code === 200) {
      messageManager.success(isEdit.value ? '更新成功' : '创建成功')
      closeModal()
      loadAdmins()
    } else {
      messageManager.error(result.message || '操作失败')
    }
  } catch (error) {
    console.error('操作失败:', error)
    messageManager.error('操作失败')
  } finally {
    submitting.value = false
  }
}

const submitPermission = async () => {
  submitting.value = true
  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/admins/${permissionFormData.value.id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        nickname: permissionFormData.value.nickname,
        isSuper: permissionFormData.value.isSuper,
        permissions: permissionFormData.value.isSuper ? [] : permissionFormData.value.permissions
      })
    })

    const result = await response.json()
    if (result.code === 200) {
      messageManager.success('权限设置成功')
      closePermissionModal()
      loadAdmins()
    } else {
      messageManager.error(result.message || '权限设置失败')
    }
  } catch (error) {
    console.error('权限设置失败:', error)
    messageManager.error('权限设置失败')
  } finally {
    submitting.value = false
  }
}

const confirmDelete = (admin) => {
  deleteTarget.value = admin
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return

  submitting.value = true
  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/admins/${deleteTarget.value.id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })

    const result = await response.json()
    if (result.code === 200) {
      messageManager.success('删除成功')
      showDeleteConfirm.value = false
      deleteTarget.value = null
      loadAdmins()
    } else {
      messageManager.error(result.message || '删除失败')
    }
  } catch (error) {
    console.error('删除失败:', error)
    messageManager.error('删除失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const adminInfo = JSON.parse(localStorage.getItem('admin_info') || '{}')
  currentAdminId.value = adminInfo.id
  await loadAdmins()
})
</script>

<style scoped>
.admin-management {
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.table-container {
  flex: 1;
  overflow: auto;
  background: var(--bg-color-primary);
  border-radius: 8px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px 15px;
  text-align: left;
  border-bottom: 1px solid var(--border-color-primary);
}

.data-table th {
  background: var(--bg-color-secondary);
  font-weight: 600;
  position: sticky;
  top: 0;
}

.role-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
}

.role-tag.super {
  background: #fff1f0;
  color: #cf1322;
}

.role-tag.normal {
  background: #e6f7ff;
  color: #1890ff;
}

.actions {
  white-space: nowrap;
}

.btn-link {
  background: none;
  border: none;
  color: #1890ff;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
}

.btn-link:hover {
  text-decoration: underline;
}

.btn-link.danger {
  color: #ff4d4f;
}

.loading,
.empty {
  text-align: center;
  padding: 40px;
  color: var(--text-color-secondary);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-color-primary);
  border-radius: 8px;
  width: 480px;
  max-width: 90%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-large {
  width: 700px;
}

.modal-small {
  width: 400px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-color-secondary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-color-primary);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 4px;
  font-size: 14px;
}

.form-group input[type="text"]:disabled {
  background: var(--bg-color-secondary);
  cursor: not-allowed;
}

.help-text {
  display: block;
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 4px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: #1890ff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #40a9ff;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-outline {
  background: transparent;
  border: 1px solid var(--border-color-primary);
  color: var(--text-color-primary);
}

.btn-outline.active {
  background: #1890ff;
  color: white;
  border-color: #1890ff;
}

.btn-danger {
  background: #ff4d4f;
  color: white;
}

.permission-section {
  margin-top: 20px;
}

.role-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.permission-groups {
  margin-top: 16px;
}

.permission-group {
  background: var(--bg-color-secondary);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.group-title {
  font-weight: 600;
  margin-bottom: 10px;
  font-size: 14px;
}

.permission-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.permission-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 4px;
}

.permission-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.warning {
  color: #ff4d4f;
  font-size: 14px;
  margin-top: 8px;
}
</style>
