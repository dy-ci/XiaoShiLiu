<script setup>
import { ref, onMounted, computed } from 'vue'
import { gameApi } from '@/api/game'
import ProfileCard from './components/ProfileCard.vue'
import CreateProfileModal from './components/CreateProfileModal.vue'
import ApiConfigCard from './components/ApiConfigCard.vue'
import LoadingSpinner from '@/components/spinner/LoadingSpinner.vue'
import messageManager from '@/utils/messageManager'
import SvgIcon from '@/components/SvgIcon.vue'

const profiles = ref([])
const config = ref(null)
const isLoading = ref(true)
const showCreateModal = ref(false)
const showApiConfig = ref(false)

const hasProfiles = computed(() => profiles.value.length > 0)

async function loadProfiles() {
  try {
    const res = await gameApi.getProfiles()
    if (res.success) {
      profiles.value = res.data || []
    }
  } catch (error) {
    console.error('加载角色列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

async function loadConfig() {
  try {
    const res = await gameApi.getConfig()
    if (res.success) {
      config.value = res.data
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

function handleProfileCreated(newProfile) {
  profiles.value.unshift(newProfile)
  messageManager.success('角色创建成功')
}

function handleProfileUpdated(updatedProfile) {
  const index = profiles.value.findIndex(p => p.id === updatedProfile.id)
  if (index !== -1) {
    profiles.value[index] = { ...profiles.value[index], ...updatedProfile }
  }
}

function handleProfileDeleted(profileId) {
  profiles.value = profiles.value.filter(p => p.id !== profileId)
}

onMounted(() => {
  Promise.all([loadProfiles(), loadConfig()])
})
</script>

<template>
  <div class="game-container">
    <div class="game-header">
      <div class="header-title">
        <h1 class="page-title">Minecraft 外置登录</h1>
        <p class="page-desc">管理你的MC游戏角色，上传皮肤和披风</p>
        <p class="page-desc">使用本功能则默认您已经拥有Minecraft正版游戏，否则请勿使用！此功能不能代替正版Minecraft游戏。</p>
        <p class="page-desc">字体为<a href="https://www.fontrepo.com/font/29649/minecraft" target="_blank">Minecraft.ttf</a>，采用<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">CC by 4.0</a>。</p>
      </div>
      
      <div class="header-actions">
        <button 
          v-if="!hasProfiles"
          class="btn btn-primary" 
          @click="showCreateModal = true"
        >
          <SvgIcon name="plus" class="btn-icon" />
          创建角色
        </button>
        
        <button 
          class="btn btn-secondary" 
          @click="showApiConfig = !showApiConfig"
        >
          <SvgIcon name="settings" class="btn-icon" />
          API 配置
        </button>
      </div>
    </div>

    <LoadingSpinner v-if="isLoading" />

    <div v-else class="game-content">
      <ApiConfigCard 
        v-if="showApiConfig && config" 
        :config="config"
      />

      <div v-if="!hasProfiles" class="empty-state">
        <SvgIcon name="game" class="empty-icon" />
        <h3>还没有游戏角色</h3>
        <p>创建一个MC角色来使用外置登录功能</p>
        <button 
          class="btn btn-primary btn-large" 
          @click="showCreateModal = true"
        >
          创建第一个角色
        </button>
      </div>

      <div v-else class="profiles-grid">
        <ProfileCard
          v-for="profile in profiles"
          :key="profile.id"
          :profile="profile"
          @update="handleProfileUpdated"
          @delete="handleProfileDeleted"
        />

        <div 
          v-if="profiles.length < (config?.max_profiles_per_user || 3)"
          class="add-profile-card"
          @click="showCreateModal = true"
        >
          <SvgIcon name="plus" class="add-icon" />
          <p>添加新角色</p>
        </div>
      </div>
    </div>

    <CreateProfileModal
      v-if="showCreateModal"
      :max-count="config?.max_profiles_per_user || 3"
      :current-count="profiles.length"
      @close="showCreateModal = false"
      @created="handleProfileCreated"
    />
  </div>
</template>

<style scoped>
.game-container {
  padding-top: 72px;
  min-height: 100vh;
  background: var(--bg-color-primary);
  padding-bottom: calc(48px + constant(safe-area-inset-bottom));
  padding-bottom: calc(48px + env(safe-area-inset-bottom));
}

.game-header {
  padding: 20px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 16px;
}

.header-title {
  flex: 1;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0 0 8px 0;
}

.page-desc {
  font-size: 14px;
  color: var(--text-color-secondary);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon {
  width: 16px;
  height: 16px;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-color-hover);
}

.btn-secondary {
  background: var(--bg-color-tertiary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--hover-bg-color);
}

.btn-large {
  padding: 14px 32px;
  font-size: 16px;
}

.game-content {
  padding: 20px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  color: var(--text-color-tertiary);
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 18px;
  color: var(--text-color-primary);
  margin: 0 0 8px 0;
  font-weight: 500;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-color-secondary);
  margin: 0 0 24px 0;
}

.profiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.add-profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-color-secondary);
}

.add-profile-card:hover {
  border-color: var(--primary-color);
  background: var(--hover-bg-color);
}

.add-icon {
  width: 48px;
  height: 48px;
  color: var(--primary-color);
  margin-bottom: 12px;
}

.add-profile-card p {
  font-size: 14px;
  color: var(--text-color-secondary);
  margin: 0;
}

@media (max-width: 768px) {
  .profiles-grid {
    grid-template-columns: 1fr;
  }

  .game-header {
    padding: 16px;
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
  }

  .btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
