import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { adminApi } from '@/api'

export const useAdminStore = defineStore('admin', () => {
  // 状态
  const admin = ref(null)
  const token = ref(localStorage.getItem('admin_token') || '')
  const refreshToken = ref(localStorage.getItem('admin_refresh_token') || '')
  const permissions = ref([])

  // 计算属性
  const isLoggedIn = computed(() => !!admin.value && !!token.value)
  const isSuperAdmin = computed(() => admin.value?.is_super || false)

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
        // 保存管理员信息和令牌
        admin.value = response.data.admin
        token.value = response.data.tokens.access_token
        refreshToken.value = response.data.tokens.refresh_token
        permissions.value = response.data.admin.permissions || []

        // 保存管理员Token到localStorage
        localStorage.setItem('admin_token', token.value)
        localStorage.setItem('admin_refresh_token', refreshToken.value)
        localStorage.setItem('admin_info', JSON.stringify(admin.value))
        localStorage.setItem('admin_permissions', JSON.stringify(permissions.value))

        return { success: true, message: response.message }
      } else {
        return { success: false, message: response.message || '登录失败' }
      }
    } catch (error) {
      console.error('管理员登录失败:', error)

      // 处理网络错误或其他异常
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
      
      admin.value = data.admin
      token.value = data.tokens.access_token
      refreshToken.value = data.tokens.refresh_token
      permissions.value = data.admin.permissions || []

      localStorage.setItem('admin_token', token.value)
      localStorage.setItem('admin_refresh_token', refreshToken.value)
      localStorage.setItem('admin_info', JSON.stringify(admin.value))
      localStorage.setItem('admin_permissions', JSON.stringify(permissions.value))

      console.log('Logto login successful, permissions:', permissions.value)
      return { success: true }
    } catch (error) {
      console.error('Logto 登录失败:', error)
      return { success: false, message: error.message || 'Logto 登录失败' }
    }
  }

  // 刷新令牌
  const refreshTokens = async () => {
    try {
      if (!refreshToken.value) {
        throw new Error('无刷新令牌')
      }

      const response = await adminApi.refreshToken({ refresh_token: refreshToken.value })

      if (response.success && response.data) {
        // 保存新令牌
        token.value = response.data.access_token
        refreshToken.value = response.data.refresh_token

        // 更新本地存储
        localStorage.setItem('admin_token', token.value)
        localStorage.setItem('admin_refresh_token', refreshToken.value)

        return { success: true }
      } else {
        throw new Error(response.message || '刷新令牌失败')
      }
    } catch (error) {
      console.error('刷新令牌失败:', error)
      // 刷新失败，清除登录状态
      await logout()
      return { success: false, message: error.message }
    }
  }

  // 退出登录
  const logout = async () => {
    try {
      // 调用后端登出接口
      if (token.value) {
        await adminApi.logout()
      }

      // 清除本地存储
      admin.value = null
      token.value = ''
      refreshToken.value = ''
      permissions.value = []

      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_refresh_token')
      localStorage.removeItem('admin_info')
      localStorage.removeItem('admin_permissions')

      // 管理员退出登录成功
    } catch (error) {
      console.error('管理员退出登录失败:', error)
      // 即使后端接口失败，也要清除本地状态
      admin.value = null
      token.value = ''
      refreshToken.value = ''
      permissions.value = []
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_refresh_token')
      localStorage.removeItem('admin_info')
      localStorage.removeItem('admin_permissions')
    }
  }

  // 获取当前管理员信息
  const getCurrentAdmin = async () => {
    try {
      if (!token.value) {
        throw new Error('未登录')
      }

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

      // 如果是401错误，尝试刷新令牌
      if (error.response?.status === 401) {
        const refreshResult = await refreshTokens()
        if (refreshResult.success) {
          // 刷新成功后重新获取管理员信息
          try {
            const newResponse = await adminApi.getCurrentAdmin()
            if (newResponse.success && newResponse.data) {
              admin.value = newResponse.data
              permissions.value = newResponse.data.permissions || []
              localStorage.setItem('admin_info', JSON.stringify(admin.value))
              localStorage.setItem('admin_permissions', JSON.stringify(permissions.value))
              return { success: true, data: newResponse.data }
            } else {
              throw new Error(newResponse.message || '获取管理员信息失败')
            }
          } catch (refreshError) {
            console.error('刷新令牌后获取管理员信息失败:', refreshError)
            return { success: false, message: refreshError.message }
          }
        } else {
          // 刷新失败，清除登录状态
          await logout()
        }
      }

      return { success: false, message: error.message }
    }
  }

  // 初始化管理员信息（从本地存储恢复）
  const initializeAdmin = () => {
    try {
      const storedAdminInfo = localStorage.getItem('admin_info')
      const storedPermissions = localStorage.getItem('admin_permissions')
      if (storedAdminInfo && token.value) {
        admin.value = JSON.parse(storedAdminInfo)
        if (storedPermissions) {
          permissions.value = JSON.parse(storedPermissions)
        }
      }
    } catch (error) {
      console.error('恢复管理员信息失败:', error)
      // 清除可能损坏的数据
      logout()
    }
  }

  // 检查token有效性
  const checkTokenValidity = async () => {
    if (!token.value) return false

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
    token,
    refreshToken,
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