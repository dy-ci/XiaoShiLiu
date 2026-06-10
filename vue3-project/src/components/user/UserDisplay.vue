<script setup>
import { ref, watch, computed } from 'vue'
import UserAvatar from './UserAvatar.vue'
import UserName from './UserName.vue'
import { getUserEquipped } from '@/api/economy.js'

// 全局装备缓存，避免重复请求
const equippedCache = new Map()
// 正在请求中的用户ID集合，防止并发重复请求
const pendingRequests = new Map()

const props = defineProps({
  user: {
    type: Object,
    default: () => ({})
  },
  // 用户ID（优先使用）
  userId: {
    type: String,
    default: ''
  },
  // 是否显示等级
  showLevel: {
    type: Boolean,
    default: false
  },
  // 头像尺寸
  avatarSize: {
    type: String,
    default: 'md'
  },
  // 布局方向：horizontal（水平）/ vertical（垂直）
  layout: {
    type: String,
    default: 'horizontal'
  },
  // 是否可点击跳转个人主页
  clickable: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['click'])

// 用户装备信息
const userEquipped = ref(null)

// 解析用户ID
const resolvedUserId = computed(() => {
  const id = props.userId || props.user?.user_id || props.user?.userId || props.user?.id || ''
  return String(id)
})

// 解析头像
const resolvedAvatar = computed(() => {
  return props.user?.avatar || props.user?.user_avatar || ''
})

// 解析昵称
const resolvedNickname = computed(() => {
  return props.user?.nickname || props.user?.username || props.user?.name || '用户'
})

// 解析等级
const resolvedLevel = computed(() => {
  return props.user?.level || 0
})

// 获取用户装备（带缓存）
async function fetchUserEquipped() {
  const uid = resolvedUserId.value
  if (!uid) return

  // 命中缓存
  if (equippedCache.has(uid)) {
    userEquipped.value = equippedCache.get(uid)
    return
  }

  // 已有相同请求在进行中，复用 Promise
  if (pendingRequests.has(uid)) {
    const data = await pendingRequests.get(uid)
    userEquipped.value = data
    return
  }

  // 发起请求
  const promise = getUserEquipped(uid).then(res => {
    const data = (res.success && res.data) ? { ...res.data, _userId: uid } : null
    equippedCache.set(uid, data)
    pendingRequests.delete(uid)
    return data
  }).catch(() => {
    pendingRequests.delete(uid)
    return null
  })

  pendingRequests.set(uid, promise)
  const data = await promise
  userEquipped.value = data
}

// 监听用户ID变化
watch(() => resolvedUserId.value, (newId) => {
  if (newId) {
    fetchUserEquipped()
  } else {
    userEquipped.value = null
  }
}, { immediate: true })

function handleClick() {
  if (props.clickable) {
    emit('click', resolvedUserId.value)
  }
}
</script>

<template>
  <div
    class="user-display"
    :class="[`user-display--${layout}`, { 'user-display--clickable': clickable }]"
    @click="handleClick"
  >
    <UserAvatar
      :avatar="resolvedAvatar"
      :nickname="resolvedNickname"
      :frameConfig="userEquipped?.frame_config"
      :accessoryConfig="userEquipped?.accessory_config"
      :level="resolvedLevel"
      :size="avatarSize"
      :showLevel="showLevel"
    />
    <div class="user-display__info">
      <UserName
        :nickname="resolvedNickname"
        :styleConfig="userEquipped?.name_style_config"
        :level="resolvedLevel"
        :showLevel="showLevel"
      />
      <slot name="extra" />
    </div>
  </div>
</template>

<style scoped>
.user-display {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.user-display--horizontal {
  flex-direction: row;
}

.user-display--vertical {
  flex-direction: column;
  text-align: center;
}

.user-display--clickable {
  cursor: pointer;
}

.user-display--clickable:hover {
  opacity: 0.85;
}

.user-display__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-display--vertical .user-display__info {
  align-items: center;
}
</style>
