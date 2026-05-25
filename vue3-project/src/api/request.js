import axios from 'axios'
import apiConfig from '@/config/api.js'
import { HTTP_STATUS, ERROR_MESSAGES } from '@/config/constants.js'
import messageManager from '@/utils/messageManager.js'

// 创建axios实例
const request = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: apiConfig.defaultHeaders
})

// 401错误处理状态锁 - 防止重复跳转
let isHandling401 = false
let redirectTimer = null

// 重置401处理锁
const reset401Lock = () => {
  if (redirectTimer) {
    clearTimeout(redirectTimer)
  }
  redirectTimer = setTimeout(() => {
    isHandling401 = false
  }, 1000) // 1秒内不重复处理401
}

// 请求拦截器
request.interceptors.request.use(
  config => {
    config.withCredentials = true
    return config
  },
  error => {
    console.error('❌ 请求配置错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    if (response.data && response.data.hasOwnProperty('code')) {
      return {
        success: response.data.code === HTTP_STATUS.OK,
        message: response.data.message,
        data: response.data.data
      }
    }

    return response.data
  },
  async error => {
    if (error.response) {
      let errorMessage = ERROR_MESSAGES.REQUEST_FAILED
      switch (error.response.status) {
        case HTTP_STATUS.UNAUTHORIZED:
          console.log('检测到401错误')
          
          // 防止重复跳转导致的循环
          if (!isHandling401) {
            isHandling401 = true
            
            // 判断是管理员还是普通用户页面
            const isAdminPage = window.location.pathname.startsWith('/admin')
            
            // 延迟执行跳转，给当前操作完成的时间
            setTimeout(() => {
              if (isAdminPage) {
                // 管理员页面 - 只有不在登录页时才跳转
                if (!window.location.pathname.includes('/admin/login')) {
                  console.log('401: 跳转到管理员登录页')
                  window.location.href = '/admin/login'
                }
              } else {
                // 普通用户页面 - 跳转到首页
                console.log('401: 跳转到首页')
                window.location.href = '/'
              }
            }, 100) // 100ms延迟
            
            reset401Lock()
          }
          
          errorMessage = ERROR_MESSAGES.SESSION_EXPIRED
          break
        case HTTP_STATUS.TOO_MANY_REQUESTS:
          errorMessage = ERROR_MESSAGES.TOO_MANY_REQUESTS
          try {
            messageManager.warning(errorMessage)
          } catch (e) {
            console.warn('Failed to show rate limit toast:', e)
          }
          break
        case HTTP_STATUS.FORBIDDEN:
          errorMessage = ERROR_MESSAGES.FORBIDDEN
          break
        case HTTP_STATUS.NOT_FOUND:
          errorMessage = ERROR_MESSAGES.NOT_FOUND
          break
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
          errorMessage = ERROR_MESSAGES.INTERNAL_SERVER_ERROR
          console.error('服务器内部错误:', error.response.data)
          break
        default:
          errorMessage = error.response.data?.message || `请求失败 (${error.response.status})`
      }

      if (error.response.data && error.response.data.hasOwnProperty('code')) {
        return {
          success: false,
          message: error.response.data.message || errorMessage,
          data: error.response.data.data,
          isSessionExpired: error.response.status === HTTP_STATUS.UNAUTHORIZED
        }
      }

      return {
        success: false,
        message: errorMessage,
        data: null,
        isSessionExpired: error.response.status === HTTP_STATUS.UNAUTHORIZED
      }
    } else if (error.request) {
      console.error('网络连接失败，请检查网络设置')
      return {
        success: false,
        message: ERROR_MESSAGES.NETWORK_ERROR,
        data: null
      }
    } else {
      console.error('请求配置错误:', error.message)
      return {
        success: false,
        message: error.message || ERROR_MESSAGES.REQUEST_CONFIG_ERROR,
        data: null
      }
    }
  }
)

export default request