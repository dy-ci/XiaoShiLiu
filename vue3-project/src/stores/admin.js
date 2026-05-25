import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { adminApi } from '@/api'

export const useAdminStore = defineStore('admin', () => {
  // 状态
  // Token现在通过HttpOnly Cookie存储，前端不再管理token
  const admin = ref(null)
  const permissions = ref([])

  // 计算属性 - 通过admin对象判断登录状态
  const isLoggedIn = computed(() => !!admin.value || !!JSON.parse(localStorage.getItem('admin_info') || 'null'))
  const isSuperAdmin = computed(() => admin.value?.isSuper || admin.value?.is_super || false)

  // 权限检查
  const hasPermission = (perm) => {
    if (isSuperAdmin.value) return true
    if (!Array.isArray(permissions.value)) return false
    return permissions.value.includes(perm)
  }

  // 检查是否有任意一个权限
  const hasAnyPermission = (perms) => {
    if (isSuperAdmin.value) return true
    if (!Array.isArray(permissions.value)) return false
    return perms.some(p => permissions.value.includes(p))
  }

  // 管理员登录
  const login = async (credentials) => {
    try {
      const response = await adminApi.login(credentials)

      if (response.success && response.data) {
        // Token已通过HttpOnly Cookie设置，无需手动保存
        // 只保存管理员信息到本地（非敏感数据）
        admin.value = response.data.admin
        permissions.value = response.data.admin.permissions || []

        localStorage.setItem('admin_info', JSON.stringify(admin.value))
        localStorage.setItem('admin_permissions', JSON.stringify(permissions.value))

        return { success: true, message: response.message }
      } else {
        return { success: false, message: response.message || '登录失败' }
      }
    } catch (error) {
      console.error('管理员登录失败:', error)

      let errorMessage = '登录失败，请稍后重试'
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message
      } else if (error.message) {
        errorMessage = error.message
      }

      return { success: false, message: errorMessage }
    }
  }

  // Logto 登录
  const logtoLogin = async (data) => {
    try {
      console.log('Admin Logto Login data:', data)
      
      // Token已通过HttpOnly Cookie设置，无需手动保存
      // 只保存管理员信息
      admin.value = data.admin
      permissions.value = data.admin.permissions || []

      localStorage.setItem('admin_info', JSON.stringify(admin.value))
      localStorage.setItem('admin_permissions', JSON.stringify(permissions.value))

      console.log('Logto login successful, permissions:', permissions.value)
      return { success: true }
    } catch (error) {
      console.error('Logto 登录失败:', error)
      return { success: false, message: error.message || 'Logto 登录失败' }
    }
  }

  // 刷新令牌 - 现在由后端Cookie自动管理，此方法保留兼容性
  const refreshTokens = async () => {
    try {
      // Cookie模式下的token刷新由后端处理
      // 前端只需验证当前会话是否有效
      const result = await getCurrentAdmin()
      return { success: result.success }
    } catch (error) {
      console.error('验证会话失败:', error)
      await logout()
      return { success: false, message: error.message }
    }
  }

  // 退出登录
  const logout = async () => {
    try {
      // 调用后端登出接口 - 后端会清除HttpOnly Cookie
      await adminApi.logout()

      // 清除本地存储
      admin.value = null
      permissions.value = []

      localStorage.removeItem('admin_info')
      localStorage.removeItem('admin_permissions')

    } catch (error) {
      console.error('管理员退出登录失败:', error)
      // 即使后端接口失败，也要清除本地状态
      admin.value = null
      permissions.value = []
      localStorage.removeItem('admin_info')
      localStorage.removeItem('admin_permissions')
    }
  }

  // 获取当前管理员信息
  const getCurrentAdmin = async () => {
    try {
      const response = await adminApi.getCurrentAdmin()

      if (response.success && response.data) {
        admin.value = response.data
        permissions.value = response.data.permissions || []
        localStorage.setItem('admin_info', JSON.stringify(admin.value))
        localStorage.setItem('admin_permissions', JSON.stringify(permissions.value))
        return { success: true, data: response.data }
      } else {
        throw new Error(response.message || '获取管理员信息失败')
      }
    } catch (error) {
      console.error('获取管理员信息失败:', error)

      // 如果是401错误，说明Cookie已失效
      if (error.response?.status === 401) {
        await logout()
      }

      return { success: false, message: error.message }
    }
  }

  // 初始化管理员信息（从本地存储恢复）
  const initializeAdmin = () => {
    try {
      const storedAdminInfo = localStorage.getItem('admin_info')
      const storedPermissions = localStorage.getItem('admin_permissions')
      if (storedAdminInfo) {
        admin.value = JSON.parse(storedAdminInfo)
        if (storedPermissions) {
          permissions.value = JSON.parse(storedPermissions)
        }
      }
    } catch (error) {
      console.error('恢复管理员信息失败:', error)
      // 清除可能损坏的数据
      localStorage.removeItem('admin_info')
      localStorage.removeItem('admin_permissions')
      admin.value = null
      permissions.value = []
    }
  }

  // 检查token有效性
  const checkTokenValidity = async () => {
    try {
      const result = await getCurrentAdmin()
      return result.success
    } catch (error) {
      return false
    }
  }

  return {
    // 状态
    admin,
    permissions,

    // 计算属性
    isLoggedIn,
    isSuperAdmin,

    // 方法
    login,
    logtoLogin,
    logout,
    refreshTokens,
    getCurrentAdmin,
    initializeAdmin,
    checkTokenValidity,
    hasPermission,
    hasAnyPermission
  }
})
