<script setup>
import SvgIcon from '@/components/SvgIcon.vue'
import DropdownMenu from '@/components/menu/DropdownMenu.vue'
import CommonMenu from '@/components/menu/CommonMenu.vue'
import UserDisplay from '@/components/user/UserDisplay.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import UserName from '@/components/user/UserName.vue'
import { ref, computed, onMounted, watch } from 'vue'
import { useRouteUtils } from '@/composables/useRouteUtils'
import { useUserStore } from '@/stores/user.js'
import { useEconomyStore } from '@/stores/economy.js'
import { useNotificationStore } from '@/stores/notification'
import { useAuthStore } from '@/stores/auth'

const { route, handleExploreClick } = useRouteUtils()
const userStore = useUserStore()
const economyStore = useEconomyStore()
const notificationStore = useNotificationStore()
const authStore = useAuthStore()

const defaultAvatar = new URL('@/assets/imgs/avatar.png', import.meta.url).href

// 从store获取未读通知数量
const unreadCount = computed(() => notificationStore.unreadCount)

// 菜单项配置
const menuItems = ref([
  { label: '发现', icon: 'home', path: '/explore' },
  { label: '发布', icon: 'publish', path: '/publish' },
  { label: '通知', icon: 'notification', path: '/notification' },
  { label: '游戏', icon: 'game', path: '/game' },
  { label: '', icon: 'avatar', path: '/user' },
  { label: '更多', icon: 'menu', path: '' },
]);





// 监听登录状态变化
watch(() => userStore.isLoggedIn, (newValue) => {
  if (newValue) {
    notificationStore.fetchUnreadCount()
    console.log('登录状态已改变')
  } else {
    console.log('未登录')
    notificationStore.clearUnreadCount()
  }
}, { immediate: true })

// 监听路由变化，当从通知页面离开时刷新未读数量
watch(() => route.path, (newPath, oldPath) => {
  if (oldPath === '/notification' && newPath !== '/notification' && userStore.isLoggedIn) {
    // 延迟一下再获取，确保通知已被标记为已读
    setTimeout(() => {
      notificationStore.fetchUnreadCount()
    }, 500)
  }
})

// 登录按钮点击处理
const handleLoginClick = () => {
  authStore.openLoginModal()
}

function handleAvatarError(event) {
  event.target.src = defaultAvatar
}

// 初始化用户信息
onMounted(() => {
  userStore.initUserInfo()
  if (userStore.isLoggedIn) {
    // 获取当前用户装备数据
    economyStore.fetchEquipped()
    economyStore.fetchLevel()
    // 静默获取未读通知数量，不阻塞页面渲染
    notificationStore.fetchUnreadCount().catch(() => {
      // 忽略错误，避免影响用户体验
    })
  }
})
</script>

<template>
  <nav class="sidebar">
    <ul class="sidebar-menu">

      <li>
        <div class="sidebar-link" @click="handleExploreClick"
          :class="{ 'active-link': route.path.startsWith('/explore') }">
          <span class="sidebar-icon">
            <SvgIcon :name="menuItems[0].icon" width="24px" height="24px"
              :class="{ active: route.path.startsWith('/explore') }" />
          </span>
          <span class="sidebar-label">{{ menuItems[0].label }}</span>
        </div>
      </li>

      <li v-for="item in menuItems.slice(1, 4)" :key="item.label"
        :class="{ 'notification-item': item.icon === 'notification' }">
        <RouterLink :to="item.path" class="sidebar-link"
          :class="{ 'active-link': route.path === item.path }">
          <span v-if="item.icon" class="sidebar-icon">
            <SvgIcon :name="item.icon" width="24px" height="24px" :class="{ active: route.path === item.path }" />
          </span>
          <span v-else-if="item.emoji" class="sidebar-icon">{{ item.emoji }}</span>
          <span class="sidebar-label">{{ item.label }}</span>

          <div v-if="item.icon === 'notification' && unreadCount > 0" class="count">{{ unreadCount > 99 ? '···' :
            unreadCount }}</div>
        </RouterLink>
      </li>


      <li v-if="userStore.isLoggedIn">
        <RouterLink :to="menuItems[4].path" class="sidebar-link"
          :class="{ 'active-link': route.path === menuItems[4].path }">
          <span class="sidebar-icon">
            <UserAvatar
              :avatar="userStore.userInfo?.avatar || defaultAvatar"
              :nickname="userStore.userInfo?.nickname || ''"
              :frameConfig="economyStore.equipped?.frame_config"
              :accessoryConfig="economyStore.equipped?.accessory_config"
              :level="economyStore.currentLevel"
              size="sm"
              class="sidebar-avatar"
            />
          </span>
          <span class="sidebar-label">
            <UserName
              :nickname="userStore.userInfo?.nickname || menuItems[4].label"
              :styleConfig="economyStore.equipped?.name_style_config"
              :level="economyStore.currentLevel"
            />
          </span>
        </RouterLink>
      </li>


      <li v-else>
        <button class="login-btn" @click="handleLoginClick">
          登录
        </button>
      </li>
    </ul>

    <div class="sidebar-footer">
      <DropdownMenu direction="up">
        <template #trigger>
          <li class="sidebar-footer-item">
            <div class="sidebar-link">
              <span class="sidebar-icon">
                <SvgIcon :name="menuItems[5].icon" width="24px" height="24px" />
              </span>
              <span class="sidebar-label">{{ menuItems[5].label }}</span>
            </div>
          </li>
        </template>
        <template #menu>
          <CommonMenu />
        </template>
      </DropdownMenu>
    </div>


  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 228px;
  background: var(--bg-color-primary);
  position: fixed;
  z-index: 100;
  left: max(calc(50% - 750px), 0px);
  top: 72px;
  height: calc(100vh - 72px);
  overflow-y: auto;
  padding: 12px;
  justify-content: space-between;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.sidebar-menu {
  flex: 1;
  list-style: none;
  padding: 0;
  margin: 0;
  left: 16px;
}

.sidebar-menu li {
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  height: 48px;
  margin-bottom: 8px;
}

.sidebar-footer-item {
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  height: 48px;
  margin-bottom: 8px;
  border-radius: 999px;
  list-style: none;
  cursor: pointer;
}

.sidebar-footer-item:hover {
  background: var(--bg-color-secondary);
}

.sidebar-link {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  padding: 0px 16px;
  color: var(--text-color-primary);
  text-decoration: none;
  border-radius: 999px;
  cursor: pointer;
}

.sidebar-link:hover {
  background: var(--bg-color-secondary);
}

/* 激活状态的链接样式 */
.sidebar-link.active-link {
  background: var(--bg-color-secondary);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.sidebar-footer-item .sidebar-link:hover {
  background: transparent;
}

.icon {
  color: var(--text-color-tertiary);
}

.active {
  color: var(--text-color-primary);
}

.sidebar-icon {
  margin-right: 16px;
  display: flex;
  align-items: center;
}

.avatar-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.sidebar-footer {
  margin-top: auto;
  margin-bottom: 20px;
}

.theme-switcher-container {
  padding: 0;
}

/* 登录按钮样式 */
.login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0px 16px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

/* 通知badge样式 */
.notification-item {
  position: relative;
}

.notification-item .count {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: var(--danger-color);
  color: white;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  top: 15px;
  left: 100px;
}

/* 移动端隐藏侧边栏 */
@media (max-width: 960px) {
  .sidebar {
    display: none;
  }
}
</style>