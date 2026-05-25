import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi, userApi } from '@/api/index.js'

export const useUserStore = defineStore('user', () => {
  // 状态
  // Token现在通过HttpOnly Cookie存储，前端不再管理token
  // token和refreshToken仅用于判断登录状态（通过userInfo是否存在）
  const userInfo = ref(null)
  const isLoading = ref(false)
  
  // 邮箱验证码相关状态
  const isSendingEmailCode = ref(false)
  const emailCodeCountdown = ref(0)
  const emailCodeTimer = ref(null)

  // 计算属性 - 通过userInfo判断登录状态
  const isLoggedIn = computed(() => {
    return !!userInfo.value || !!JSON.parse(localStorage.getItem('userInfo') || 'null')
  })

  // 登录
  const login = async (credentials) => {
    try {
      isLoading.value = true
      const response = await authApi.login(credentials)

      if (response.success && response.data) {
        // Token已通过HttpOnly Cookie设置，无需手动保存
        // 只保存用户信息到本地（非敏感数据）
        userInfo.value = response.data.user
        localStorage.setItem('userInfo', JSON.stringify(response.data.user))

        return { success: true }
      } else {
        return {
          success: false,
          message: response.message || '登录失败'
        }
      }
    } catch (error) {
      console.error('登录失败:', error)
      return {
        success: false,
        message: error.message || '网络错误，请稍后重试'
      }
    } finally {
      isLoading.value = false
    }
  }

  // 注册
  const register = async (userData) => {
    try {
      isLoading.value = true
      const response = await authApi.register(userData)

      if (response.success) {
        // 注册成功后自动登录 - Token已通过Cookie设置
        userInfo.value = response.data.user
        localStorage.setItem('userInfo', JSON.stringify(response.data.user))

        return { success: true }
      } else {
        return { success: false, message: response.message || '注册失败' }
      }
    } catch (error) {
      console.error('注册失败:', error)
      return {
        success: false,
        message: error.message || '网络错误，请稍后重试'
      }
    } finally {
      isLoading.value = false
    }
  }

  // 退出登录
  const logout = async () => {
    try {
      // 调用后端退出接口 - 后端会清除HttpOnly Cookie
      await authApi.logout()
    } catch (error) {
      console.error('退出登录失败:', error)
    } finally {
      // 清除本地用户信息
      userInfo.value = null
      localStorage.removeItem('userInfo')

      // 重置未读通知数量
      try {
        const { useNotificationStore } = await import('./notification')
        const notificationStore = useNotificationStore()
        notificationStore.resetUnreadCount()
      } catch (error) {
        console.error('重置未读通知数量失败:', error)
      }
    }
  }

  // 初始化用户信息（从localStorage恢复）
  const initUserInfo = () => {
    const savedUserInfo = localStorage.getItem('userInfo')
    if (savedUserInfo) {
      try {
        userInfo.value = JSON.parse(savedUserInfo)
      } catch (error) {
        console.error('解析用户信息失败:', error)
        // 清除无效数据
        localStorage.removeItem('userInfo')
        userInfo.value = null
      }
    }
  }

  // 刷新token - 现在由后端Cookie自动管理，此方法保留兼容性
  const refreshUserToken = async () => {
    try {
      // Cookie模式下的token刷新由后端处理
      // 前端只需验证当前会话是否有效
      const response = await authApi.getCurrentUser()
      if (response.success && response.data) {
        userInfo.value = response.data
        localStorage.setItem('userInfo', JSON.stringify(response.data))
        return true
      }
      return false
    } catch (error) {
      console.error('验证会话失败:', error)
      await logout()
      return false
    }
  }

  // 获取当前用户信息
  const getCurrentUser = async () => {
    try {
      const response = await authApi.getCurrentUser()

      if (response.success && response.data) {
        userInfo.value = response.data
        // 更新localStorage中的用户信息
        localStorage.setItem('userInfo', JSON.stringify(response.data))
        return response.data
      } else {
        console.error('获取当前用户信息失败:', response.message)
        return null
      }
    } catch (error) {
      console.error('获取当前用户信息失败:', error)
      return null
    }
  }

  // 获取用户统计信息
  const getUserStats = async (userId) => {
    try {
      const response = await userApi.getUserStats(userId)

      if (response.success) {
        return response.data
      } else {
        console.error('获取用户统计信息失败:', response.message)
        return null
      }
    } catch (error) {
      console.error('获取用户统计信息失败:', error)
      return null
    }
  }

  // 更新用户信息
  const updateUserInfo = (newUserInfo) => {
    if (userInfo.value) {
      // 合并新的用户信息
      userInfo.value = {
        ...userInfo.value,
        ...newUserInfo
      }

      // 更新localStorage中的用户信息
      localStorage.setItem('userInfo', JSON.stringify(userInfo.value))
    }
  }

  // 发送邮箱验证码
  const sendEmailCode = async (email) => {
    try {
      isSendingEmailCode.value = true
      const response = await authApi.sendEmailCode(email)

      if (response.success) {
        startEmailCodeCountdown()
        return { success: true, message: '验证码已发送，请查收邮箱' }
      } else {
        return { success: false, message: response.message || '发送验证码失败' }
      }
    } catch (error) {
      console.error('发送验证码失败:', error)
      return { success: false, message: '网络错误，请稍后重试' }
    } finally {
      isSendingEmailCode.value = false
    }
  }

  // 绑定邮箱
  const bindEmail = async (data) => {
    try {
      const response = await authApi.bindEmail(data)

      if (response.success) {
        // 更新本地用户信息
        if (userInfo.value) {
          userInfo.value.email = data.email
          localStorage.setItem('userInfo', JSON.stringify(userInfo.value))
        }
        return { success: true, message: '邮箱绑定成功' }
      } else {
        return { success: false, message: response.message || '绑定邮箱失败' }
      }
    } catch (error) {
      console.error('绑定邮箱失败:', error)
      return { success: false, message: '网络错误，请稍后重试' }
    }
  }

  // 解除邮箱绑定
  const unbindEmail = async () => {
    try {
      const response = await authApi.unbindEmail()

      if (response.success) {
        // 更新本地用户信息
        if (userInfo.value) {
          userInfo.value.email = ''
          localStorage.setItem('userInfo', JSON.stringify(userInfo.value))
        }
        return { success: true, message: '邮箱解绑成功' }
      } else {
        return { success: false, message: response.message || '解绑邮箱失败' }
      }
    } catch (error) {
      console.error('解绑邮箱失败:', error)
      return { success: false, message: '网络错误，请稍后重试' }
    }
  }

  // Logto 登录成功处理
  const loginWithLogto = async (data) => {
    try {
      isLoading.value = true
      
      console.log('loginWithLogto 接收的数据:', data)
      
      // Token已通过HttpOnly Cookie设置，无需手动保存
      // 只保存用户信息
      userInfo.value = data.user
      localStorage.setItem('userInfo', JSON.stringify(data.user))

      console.log('已保存的用户信息:', {
        userInfo: !!userInfo.value
      })

      return { success: true }
    } catch (error) {
      console.error('Logto 登录失败:', error)
      return {
        success: false,
        message: error.message || '网络错误，请稍后重试'
      }
    } finally {
      isLoading.value = false
    }
  }

  // 开始邮箱验证码倒计时
  const startEmailCodeCountdown = () => {
    emailCodeCountdown.value = 60
    // 清除之前的定时器
    if (emailCodeTimer.value) {
      clearInterval(emailCodeTimer.value)
    }
    emailCodeTimer.value = setInterval(() => {
      emailCodeCountdown.value--
      if (emailCodeCountdown.value <= 0) {
        clearInterval(emailCodeTimer.value)
        emailCodeTimer.value = null
      }
    }, 1000)
  }

  // 清除邮箱验证码倒计时
  const clearEmailCodeCountdown = () => {
    if (emailCodeTimer.value) {
      clearInterval(emailCodeTimer.value)
      emailCodeTimer.value = null
    }
    emailCodeCountdown.value = 0
  }

  return {
    // 状态
    userInfo,
    isLoading,

    // 邮箱验证码相关状态
    isSendingEmailCode,
    emailCodeCountdown,

    // 计算属性
    isLoggedIn,

    // 方法
    login,
    register,
    logout,
    initUserInfo,
    getCurrentUser,
    refreshUserToken,
    getUserStats,
    updateUserInfo,
    loginWithLogto,

    // 邮箱验证码相关方法
    sendEmailCode,
    clearEmailCodeCountdown,
    bindEmail,
    unbindEmail
  }
})
