<template>
  <div class="admin-login-page">
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <h1 class="login-title">悦社管理后台</h1>
          <p class="login-subtitle">欢迎回来！请使用 Logto 云认证登录</p>
        </div>

        <div v-if="unifiedMessage" class="message" :class="messageType">
          {{ unifiedMessage }}
        </div>

        <button class="login-button" @click="handleLogtoLogin" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="loading-spinner"></span>
          <span v-else>{{ isSubmitting ? '登录中...' : '使用 Logto 云认证登录' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAdminStore } from '@/stores/admin';
import { logtoApi } from '@/api';

const router = useRouter();
const route = useRoute();
const adminStore = useAdminStore();

const isSubmitting = ref(false);
const unifiedMessage = ref('');
const messageType = ref('error'); // 'error' | 'success'

// 处理 Logto 登录
const handleLogtoLogin = async () => {
  try {
    isSubmitting.value = true;
    unifiedMessage.value = '';

    console.log('正在获取 Logto 管理员登录地址...');
    const response = await logtoApi.getAdminSignInUrl();
    if (response.success && response.data && response.data.signInUrl) {
      console.log('跳转到 Logto 登录:', response.data.signInUrl);
      window.location.href = response.data.signInUrl;
    } else {
      throw new Error(response.message || '获取登录地址失败');
    }
  } catch (error) {
    console.error('登录失败:', error);
    unifiedMessage.value = error.message || '网络错误，请稍后重试';
    messageType.value = 'error';
  } finally {
    isSubmitting.value = false;
  }
};

// 检查 URL 中的 code 回调
onMounted(async () => {
  const code = route.query.code;
  if (code) {
    console.log('检测到 Logto 回调 code，开始处理管理员登录');
    await handleLogtoCallback(code);
  }
});

// 处理 Logto 回调
const handleLogtoCallback = async (code) => {
  try {
    isSubmitting.value = true;
    unifiedMessage.value = '正在登录...';
    messageType.value = 'success';

    console.log('调用后端管理员登录回调接口...');
    const response = await logtoApi.adminCallback({ code });

    if (response.success && response.data) {
      console.log('管理员登录成功:', response.data);

      const result = await adminStore.logtoLogin(response.data);
      if (result.success) {
        unifiedMessage.value = '登录成功，正在跳转...';
        messageType.value = 'success';
        setTimeout(() => {
          router.push('/admin/api-docs');
        }, 1000);
      } else {
        unifiedMessage.value = result.message || '登录失败，请重试';
        messageType.value = 'error';
      }
    } else {
      throw new Error(response.message || '登录失败');
    }
  } catch (error) {
    console.error('Logto 回调处理失败:', error);
    unifiedMessage.value = error.message || '登录失败，请重试';
    messageType.value = 'error';
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<style scoped>
.admin-login-page {
  min-height: 100vh;
  background: var(--bg-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.login-container {
  width: 100%;
  max-width: 400px;
}

.login-card {
  background: var(--bg-color-primary);
  border-radius: 8px;
  padding: 40px;
  box-shadow: 0 4px 12px var(--shadow-color);
  border: 1px solid var(--border-color-primary);
}

.login-header {
  text-align: center;
  margin-bottom: 30px;
}

.login-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0 0 8px 0;
}

.login-subtitle {
  font-size: 14px;
  color: var(--text-color-secondary);
  margin: 0;
}

.message {
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 20px;
}

.message.success {
  background: var(--bg-color-secondary);
  color: #38a169;
  border: 1px solid #9ae6b4;
}

.message.error {
  background: var(--bg-color-secondary);
  color: #e53e3e;
  border: 1px solid #feb2b2;
}

.login-button {
  width: 100%;
  padding: 14px 24px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
}

.login-button:hover:not(:disabled) {
  background: var(--primary-color-dark);
}

.login-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@media (max-width: 480px) {
  .login-card {
    padding: 30px 20px;
  }
}
</style>
