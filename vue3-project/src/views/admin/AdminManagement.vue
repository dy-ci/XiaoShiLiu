<template>
  <div class="admin-management">
    <CrudTable 
      title="管理员管理" 
      entity-name="管理员" 
      api-endpoint="/admin/admins" 
      :columns="columns" 
      :form-fields="formFields"
      :search-fields="searchFields" 
      @form-opened="handleFormOpened"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import CrudTable from '@/views/admin/components/CrudTable.vue'
import { useAdminStore } from '@/stores/admin'

const adminStore = useAdminStore()

// 权限分组定义
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

// 预设角色
const roles = [
  { key: 'super_admin', name: '超级管理员', description: '拥有全部权限' },
  { key: 'content_admin', name: '内容管理员', description: '管理内容相关功能' },
  { key: 'user_admin', name: '用户管理员', description: '管理用户和认证' },
  { key: 'operator', name: '运维人员', description: '查看监控和会话' }
]

// 当前编辑的管理员权限
const currentPermissions = ref([])
const currentRole = ref('custom')
const isSuper = ref(false)

const columns = [
  { key: 'username', label: '账号', sortable: false },
  { key: 'nickname', label: '昵称', sortable: false },
  { key: 'isSuper', label: '角色', type: 'tag', sortable: false },
  { key: 'logtoId', label: 'Logto ID', sortable: false },
  { key: 'createdAt', label: '创建时间', type: 'date', sortable: true }
]

const formFields = [
  { key: 'username', label: '账号(Logto用户)', type: 'text', required: true, placeholder: '请输入账号' },
  { key: 'nickname', label: '昵称', type: 'text', placeholder: '请输入昵称' },
  { key: 'isSuper', label: '超级管理员', type: 'checkbox' }
]

const searchFields = [
  { key: 'username', label: '账号', placeholder: '搜索账号' }
]

// 处理表单打开事件，初始化权限
const handleFormOpened = (data) => {
  if (data && data.permissions) {
    currentPermissions.value = Array.isArray(data.permissions) 
      ? [...data.permissions] 
      : []
    isSuper.value = data.is_super || false
  } else {
    currentPermissions.value = []
    isSuper.value = false
  }
  currentRole.value = 'custom'
}

// 选择预设角色
const selectRole = (roleKey) => {
  currentRole.value = roleKey
  
  if (roleKey === 'super_admin') {
    isSuper.value = true
    currentPermissions.value = []
  } else {
    isSuper.value = false
    // 设置对应角色的权限
    if (roleKey === 'content_admin') {
      currentPermissions.value = [
        'posts:view', 'posts:edit', 'posts:delete',
        'post_audit:view', 'post_audit:audit',
        'comments:view', 'comments:edit', 'comments:delete',
        'categories:view', 'categories:edit', 'categories:delete', 'categories:create',
        'tags:view', 'tags:edit', 'tags:delete', 'tags:create'
      ]
    } else if (roleKey === 'user_admin') {
      currentPermissions.value = [
        'users:view', 'users:edit', 'users:delete', 'users:ban',
        'audit:view', 'audit:audit'
      ]
    } else if (roleKey === 'operator') {
      currentPermissions.value = [
        'api_docs:view', 'monitor:view',
        'user_sessions:view', 'user_sessions:delete',
        'admin_sessions:view', 'admin_sessions:delete'
      ]
    }
  }
}

// 切换权限
const togglePermission = (permKey) => {
  if (isSuper.value) return
  
  const index = currentPermissions.value.indexOf(permKey)
  if (index > -1) {
    currentPermissions.value.splice(index, 1)
  } else {
    currentPermissions.value.push(permKey)
  }
}

// 检查是否有权限
const hasPerm = (permKey) => {
  return isSuper.value || currentPermissions.value.includes(permKey)
}
</script>

<style scoped>
.admin-management {
  padding: 20px;
}

.permission-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.permission-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.permission-header h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0;
}

.role-select {
  display: flex;
  gap: 8px;
}

.role-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.role-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.role-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

.permission-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.permission-group {
  background: var(--bg-color-secondary);
  padding: 12px;
  border-radius: 8px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin-bottom: 8px;
}

.permission-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.permission-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.permission-item:hover {
  background: rgba(0,0,0,0.03);
}

.permission-item input {
  cursor: pointer;
}

.permission-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.permission-label {
  font-size: 13px;
  color: var(--text-color-primary);
}
</style>
