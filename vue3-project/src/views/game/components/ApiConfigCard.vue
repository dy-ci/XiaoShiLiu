<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
})

const showFullConfig = ref(false)
const copiedField = ref(null)

const apiRootUrl = computed(() => props.config?.yggdrasil_api_root || '')
const serverName = computed(() => props.config?.server_name || '悦社社区')

function copyToClipboard(text, field) {
  navigator.clipboard.writeText(text).then(() => {
    copiedField.value = field
    setTimeout(() => {
      copiedField.value = null
    }, 2000)
  }).catch(err => {
    console.error('复制失败:', err)
  })
}

function toggleFullConfig() {
  showFullConfig.value = !showFullConfig.value
}
</script>

<template>
  <div class="api-config-card">
    <div class="config-header" @click="toggleFullConfig">
      <div>
        <h3>⚙️ Yggdrasil API 配置</h3>
        <p>用于配置 authlib-injector 或第三方启动器</p>
      </div>
      <button class="toggle-btn">
        {{ showFullConfig ? '▲' : '▼' }}
      </button>
    </div>

    <div v-if="showFullConfig" class="config-body">
      <div class="info-section">
        <h4>📌 基本信息</h4>
        <div class="config-item">
          <label>服务器名称</label>
          <span>{{ serverName }}</span>
        </div>
        <div class="config-item">
          <label>最大角色数</label>
          <span>{{ config.max_profiles_per_user }} 个/用户</span>
        </div>
        <div class="config-item">
          <label>皮肤限制</label>
          <span>{{ config.skin_max_size }}</span>
        </div>
        <div class="config-item">
          <label>支持模型</label>
          <span>{{ config.supported_skin_models.join(' / ') }}</span>
        </div>
      </div>

      <div class="api-section">
        <h4>🔗 API 地址</h4>
        <div class="url-box">
          <code>{{ apiRootUrl }}</code>
          <button 
            class="copy-btn"
            @click.stop="copyToClipboard(apiRootUrl, 'api')"
            :class="{ copied: copiedField === 'api' }"
          >
            {{ copiedField === 'api' ? '✅ 已复制' : '复制' }}
          </button>
        </div>
        
        <p class="usage-tip">
          💡 将此地址填入 authlib-injector 的 "Yggdrasil API Root" 字段
        </p>
      </div>

      <div class="guide-section">
        <h4>📖 使用指南</h4>
        
        <div class="step-card">
          <div class="step-number">1</div>
          <div class="step-content">
            <strong>下载 authlib-injector</strong>
            <p>从 GitHub 下载最新版本</p>
          </div>
        </div>

        <div class="step-card">
          <div class="step-number">2</div>
          <div class="step-content">
            <strong>配置启动参数</strong>
            <p>在 Minecraft 启动器中添加 JVM 参数：</p>
            <code class="jvm-arg">-javaagent:authlib-injector.jar={{ apiRootUrl }}</code>
          </div>
        </div>

        <div class="step-card">
          <div class="step-number">3</div>
          <div class="step-content">
            <strong>登录游戏</strong>
            <p>使用你在悦社创建的角色名和独立密码登录</p>
          </div>
        </div>
      </div>

      <div class="notice-section">
        <h4>⚠️ 注意事项</h4>
        <ul>
          <li><strong>密码安全：</strong>独立密码与社区账户密码不同，请妥善保管</li>
          <li><strong>Token 有效期：</strong>访问令牌有效期为7天，过期后需重新登录</li>
          <li><strong>皮肤格式：</strong>仅支持 PNG 格式，最大 500KB</li>
          <li><strong>角色限制：</strong>每个用户最多创建 {{ config.max_profiles_per_user }} 个角色</li>
          <li><strong>封禁说明：</strong>被封禁的角色无法通过 API 登录游戏</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.api-config-card {
  background: var(--bg-color-secondary);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  margin-bottom: 20px;
  overflow: hidden;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--bg-color-secondary);
  cursor: pointer;
  transition: all 0.3s ease;
}

.config-header:hover {
  background: var(--bg-color-tertiary);
}

.config-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0 0 4px 0;
}

.config-header p {
  font-size: 13px;
  color: var(--text-color-secondary);
  margin: 0;
}

.toggle-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.toggle-btn:hover {
  background: var(--bg-color-tertiary);
}

.config-body {
  padding: 20px;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    max-height: 0;
  }
  to {
    opacity: 1;
    max-height: 1000px;
  }
}

.info-section,
.api-section,
.guide-section,
.notice-section {
  margin-bottom: 24px;
}

.info-section h4,
.api-section h4,
.guide-section h4,
.notice-section h4 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-color);
}

.config-item:last-child {
  border-bottom: none;
}

.config-item label {
  font-size: 14px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

.config-item span {
  font-size: 14px;
  color: var(--text-color-primary);
  font-weight: 600;
}

.url-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg-color-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin-bottom: 10px;
}

.url-box code {
  flex: 1;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: var(--primary-color);
  word-break: break-all;
}

.copy-btn {
  padding: 6px 14px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.3s ease;
}

.copy-btn:hover {
  background: var(--primary-color);
  color: white;
}

.copy-btn.copied {
  background: #10b981;
  border-color: #10b981;
  color: white;
}

.usage-tip {
  font-size: 13px;
  color: var(--text-color-secondary);
  margin: 0;
  line-height: 1.5;
}

.step-card {
  display: flex;
  gap: 14px;
  padding: 14px;
  background: var(--bg-color-primary);
  border-radius: 8px;
  margin-bottom: 12px;
  transition: all 0.3s ease;
}

.step-card:hover {
  transform: translateX(4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.step-number {
  width: 32px;
  height: 32px;
  line-height: 32px;
  text-align: center;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.step-content strong {
  display: block;
  font-size: 14px;
  color: var(--text-color-primary);
  margin-bottom: 4px;
}

.step-content p {
  font-size: 13px;
  color: var(--text-color-secondary);
  margin: 0;
  line-height: 1.5;
}

.jvm-arg {
  display: block;
  margin-top: 8px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #475569;
  word-break: break-all;
}

.notice-section ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.notice-section li {
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-color-secondary);
  line-height: 1.6;
  position: relative;
  padding-left: 18px;
}

.notice-section li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--primary-color);
  font-weight: bold;
}

.notice-section li strong {
  color: var(--text-color-primary);
}

@media (max-width: 768px) {
  .url-box {
    flex-direction: column;
    align-items: stretch;
  }

  .copy-btn {
    width: 100%;
  }
}
</style>
