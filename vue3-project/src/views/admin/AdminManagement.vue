<template>
  <div class="admin-management">
    <div class="page-header">
      <h2>管理员管理</h2>
      <el-button type="primary" @click="openCreateModal">
        <el-icon><Plus /></el-icon>
        新建管理员
      </el-button>
    </div>

    <el-table :data="tableData" style="width: 100%" v-loading="loading">
      <el-table-column prop="username" label="账号" width="180" />
      <el-table-column prop="nickname" label="昵称" width="150" />
      <el-table-column prop="isSuper" label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="row.isSuper ? 'danger' : 'primary'">
            {{ row.isSuper ? '超级管理员' : '管理员' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="logtoId" label="Logto ID" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="创建时间" width="180" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEditModal(row)">编辑</el-button>
          <el-button link type="danger" @click="handleDelete(row)" :disabled="row.logtoId === adminStore.admin?.logtoId">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="fetchData"
        @current-change="fetchData"
      />
    </div>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑管理员' : '新建管理员'"
      width="800px"
      @close="resetForm"
    >
      <el-form ref="formRef" :model="form" label-width="120px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入管理员用户名" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="Logto ID" prop="logtoId">
          <el-input v-model="form.logtoId" placeholder="可选，留空则通过用户名匹配Logto用户" :disabled="isEdit" />
          <div style="font-size: 12px; color: #909399; margin-top: 4px;">
            建议留空，系统会在该用户首次登录时自动通过用户名匹配并关联
          </div>
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="超级管理员" prop="isSuper">
          <el-switch v-model="isSuper" />
        </el-form-item>
        <el-divider content-position="left">权限设置</el-divider>
        <div v-if="!isSuper" class="permission-section">
          <div class="permission-header">
            <span class="header-title">预设角色</span>
            <div class="role-select">
              <el-button
                v-for="role in roles"
                :key="role.key"
                :type="currentRole === role.key ? 'primary' : 'default'"
                size="small"
                @click="selectRole(role.key)"
              >
                {{ role.name }}
              </el-button>
            </div>
          </div>
          <div class="permission-groups">
            <div v-for="group in permissionGroups" :key="group.name" class="permission-group">
              <div class="group-title">{{ group.name }}</div>
              <el-checkbox-group v-model="selectedPermissions" class="permission-grid">
                <div v-for="perm in group.permissions" :key="perm.key" class="permission-item">
                  <el-checkbox :value="perm.key" />
                  <span class="permission-label">{{ perm.label }}</span>
                </div>
              </el-checkbox-group>
            </div>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useAdminStore } from '@/stores/admin'
import { logtoApi, adminApi } from '@/api'

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
  { key: 'operator', name: '运维人员', description: '查看监控和会话' },
  { key: 'custom', name: '自定义', description: '自定义权限' }
]

// 状态
const loading = ref(false)
const submitting = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const tableData = ref([])
const formRef = ref(null)
const isSuper = ref(false)
const currentRole = ref('custom')
const selectedPermissions = ref([])
const editId = ref(null)

const form = reactive({
  username: '',
  logtoId: '',
  nickname: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

// 获取数据
const fetchData = async () => {
  loading.value = true
  try {
    const response = await adminApi.getAdmins({
      page: pagination.page,
      limit: pagination.pageSize
    })
    if (response.success && response.data) {
      // 适配两种返回格式
      tableData.value = response.data.items || response.data.data || []
      pagination.total = response.data.total || (response.data.pagination ? response.data.pagination.total : 0)
    }
  } catch (error) {
    ElMessage.error('获取数据失败')
  } finally {
    loading.value = false
  }
}

// 打开创建对话框
const openCreateModal = () => {
  isEdit.value = false
  editId.value = null
  dialogVisible.value = true
}

// 打开编辑对话框
const openEditModal = (row) => {
  isEdit.value = true
  editId.value = row.id
  form.username = row.username
  form.logtoId = row.logtoId || ''
  form.nickname = row.nickname
  isSuper.value = row.isSuper
  selectedPermissions.value = row.permissions || []
  
  // 自动判断角色
  currentRole.value = 'custom'
  dialogVisible.value = true
}

// 选择预设角色
const selectRole = (roleKey) => {
  currentRole.value = roleKey
  
  if (roleKey === 'super_admin') {
    isSuper.value = true
    selectedPermissions.value = []
  } else {
    isSuper.value = false
    if (roleKey === 'content_admin') {
      selectedPermissions.value = [
        'posts:view', 'posts:edit', 'posts:delete',
        'post_audit:view', 'post_audit:audit',
        'comments:view', 'comments:edit', 'comments:delete',
        'categories:view', 'categories:edit', 'categories:delete', 'categories:create',
        'tags:view', 'tags:edit', 'tags:delete', 'tags:create'
      ]
    } else if (roleKey === 'user_admin') {
      selectedPermissions.value = [
        'users:view', 'users:edit', 'users:delete', 'users:ban',
        'audit:view', 'audit:audit'
      ]
    } else if (roleKey === 'operator') {
      selectedPermissions.value = [
        'api_docs:view', 'monitor:view',
        'user_sessions:view', 'user_sessions:delete',
        'admin_sessions:view', 'admin_sessions:delete'
      ]
    } else {
      // 自定义角色，保留现有权限
    }
  }
}

// 重置表单
const resetForm = () => {
  form.username = ''
  form.logtoId = ''
  form.nickname = ''
  isSuper.value = false
  selectedPermissions.value = []
  currentRole.value = 'custom'
  editId.value = null
  isEdit.value = false
}

// 提交表单
const handleSubmit = async () => {
  submitting.value = true
  try {
    const data = {
      username: form.username,
      logtoId: form.logtoId || null,
      nickname: form.nickname,
      isSuper: isSuper.value,
      permissions: isSuper.value ? [] : selectedPermissions.value
    }
    
    if (isEdit.value) {
      await adminApi.updateAdmin(editId.value, data)
      ElMessage.success('更新成功')
    } else {
      await adminApi.createAdmin(data)
      ElMessage.success('创建成功')
    }
    
    dialogVisible.value = false
    fetchData()
  } catch (error) {
    ElMessage.error(error.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

// 删除
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该管理员吗？', '提示', {
      type: 'warning'
    })
    await adminApi.deleteAdmin(row.id)
    ElMessage.success('删除成功')
    fetchData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.admin-management {
  padding: 20px;
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

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.permission-section {
  margin-top: 16px;
}

.permission-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.header-title {
  font-weight: 600;
}

.role-select {
  display: flex;
  gap: 8px;
}

.permission-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.permission-group {
  background: var(--bg-color-secondary);
  padding: 16px;
  border-radius: 8px;
}

.group-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
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
  padding: 8px;
  border-radius: 6px;
}

.permission-item:hover {
  background: rgba(0,0,0,0.05);
}

.permission-label {
  font-size: 13px;
}
</style>
