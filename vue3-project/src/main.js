/**
 * 悦社动态社区 - Vue3前端应用
 * 
 * @author ZTMYO
 * @github https://github.com/ZTMYO
 * @description 基于Vue3+Vite+Pinia的现代化图文社区前端应用
 * @version v1.3.2
 * @license GPLv3
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import 'virtual:svg-icons-register'
// 全局css
import '@/assets/css/index.css'
import '@/assets/css/animations.css'
// 导入懒加载插件
import { lazyPlugin } from './directives'
// 导入主题工具函数
import { initTheme } from '@/utils/themeUtils'
// 导入消息管理器
import { install as messageInstall } from '@/utils/messageManager'
// 导入用户store
import { useUserStore } from '@/stores/user'
// 导入频道store
import { useChannelStore } from '@/stores/channel'

// 初始化主题系统（在应用创建之前）
initTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(lazyPlugin) // 注册懒加载插件
app.use(messageInstall) // 注册消息管理器

// 初始化用户信息
const userStore = useUserStore()
// 先从localStorage恢复用户信息（同步操作，不会失败）
userStore.initUserInfo()

// 延迟验证会话有效性，避免阻塞应用启动
// 使用requestIdleCallback或setTimeout在浏览器空闲时执行
if (userStore.isLoggedIn) {
  // 延迟500ms后再验证，确保页面已完全渲染
  setTimeout(async () => {
    try {
      await userStore.getCurrentUser()
      console.log('用户会话验证成功')
    } catch (error) {
      // 只有在确实是401错误时才清除登录状态
      if (error.response?.status === 401 || error.isSessionExpired) {
        console.log('用户会话已过期，清除本地数据')
        await userStore.logout()
      }
    }
  }, 500)
}

// 初始化频道数据
const channelStore = useChannelStore()
channelStore.loadChannels().catch(error => {
  console.error('加载频道数据失败:', error)
})

app.mount('#app')
