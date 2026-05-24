<template>
  <div class="logto-callback">
    <div class="callback-container">
      <div class="loading-content" v-if="isLoading">
        <div class="loading-spinner"></div>
        <p class="loading-text">正在登录...</p>
      </div>
      <div class="error-content" v-else-if="error">
        <SvgIcon name="alert" class="error-icon" />
        <p class="error-text">{{ error }}</p>
        <button class="retry-btn" @click="goHome">返回首页</button>
      </div>
      <div class="success-content" v-else-if="success">
        <SvgIcon name="tick" class="success-icon" />
        <p class="success-text">登录成功！</p>
        <p class="redirect-text">即将跳转...</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/SvgIcon.vue'
import { useUserStore } from '@/stores/user.js'
import { logtoApi } from '@/api/index.js'

const router = useRouter()
const userStore = useUserStore()

const isLoading = ref(true)
const error = ref('')
const success = ref(false)

const goHome = () => {
  router.push('/')
}

const handleCallback = async () => {
  try {
    // 获取 URL 参数
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')

    if (!code) {
      throw new Error('缺少授权码')
    }

    // 调用后端回调接口
    const response = await logtoApi.handleCallback({ code, state })

    if (response.success && response.data) {
      // 使用专门的 Logto 登录处理方法
      const result = await userStore.loginWithLogto(response.data)
      
      if (result.success) {
        success.value = true
        isLoading.value = false

        // 延迟跳转
        setTimeout(() => {
          router.push('/')
        }, 1500)
      } else {
        throw new Error(result.message)
      }
    } else {
      throw new Error(response.message || '登录失败')
    }
  } catch (err) {
    console.error('Logto 回调处理失败:', err)
    error.value = err.message || '登录失败，请稍后重试'
    isLoading.value = false
  }
}

onMounted(() => {
  handleCallback()
})
</script>

<style scoped>
.logto-callback {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-color-primary);
  padding: 20px;
}

.callback-container {
  text-align: center;
  max-width: 400px;
}

.loading-content,
.error-content,
.success-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid var(--border-color);
  border-top: 4px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  font-size: 16px;
  color: var(--text-color-secondary);
}

.error-icon,
.success-icon {
  width: 60px;
  height: 60px;
}

.error-icon {
  color: #ff4757;
}

.success-icon {
  color: var(--primary-color);
}

.error-text,
.success-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.redirect-text {
  font-size: 14px;
  color: var(--text-color-secondary);
}

.retry-btn {
  padding: 12px 32px;
  font-size: 16px;
  font-weight: 600;
  color: white;
  background: var(--primary-color);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.retry-btn:hover {
  background: var(--primary-color-dark);
}
</style>
