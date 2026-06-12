<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as skinview3d from 'skinview3d'

const props = defineProps({
  /** 皮肤图片 URL */
  skinUrl: {
    type: String,
    default: ''
  },
  /** 披风图片 URL */
  capeUrl: {
    type: String,
    default: ''
  },
  /** 玩家名称（显示在头顶名字标签） */
  playerName: {
    type: String,
    default: ''
  },
  /** 皮肤模型类型: 'classic' / 'slim' / 'auto-detect' */
  skinModel: {
    type: String,
    default: 'auto-detect'
  },
  /** 画布宽度 */
  width: {
    type: Number,
    default: 300
  },
  /** 画布高度 */
  height: {
    type: Number,
    default: 400
  },
  /** 是否显示动作切换按钮 */
  showControls: {
    type: Boolean,
    default: true
  },
  /** 是否显示名字标签 */
  showNameTag: {
    type: Boolean,
    default: true
  },
  /** 是否启用鼠标控制（旋转/缩放） */
  enableControls: {
    type: Boolean,
    default: true
  },
  /** 初始动画 */
  defaultAnimation: {
    type: String,
    default: 'idle'
  }
})

const canvasRef = ref(null)
const currentAnimation = ref(props.defaultAnimation)
let viewer = null

// 缓存 URL 可用性检测结果
const urlAvailabilityCache = new Map()

/**
 * 测试图片 URL 是否可以直接访问（不跨域或 CORS 允许）
 * @param {string} url
 * @returns {Promise<boolean>} true=直链可用, false=需要走代理
 */
function testDirectUrl(url) {
  return new Promise((resolve) => {
    const img = new Image()
    let resolved = false

    const done = (ok) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      img.onload = img.onerror = null
      resolve(ok)
    }

    // 超时 3 秒
    const timer = setTimeout(() => done(false), 3000)

    img.onload = () => done(true)
    img.onerror = () => done(false)

    // 跨域请求，用于检测 CORS
    img.crossOrigin = 'anonymous'
    img.src = url
  })
}

/**
 * 获取皮肤/披风 URL
 * 策略：先尝试直链，失败后再走代理
 * @param {string} url
 * @returns {Promise<string>}
 */
async function getResolvedUrl(url) {
  if (!url) return ''

  // 同源 URL 直接返回
  try {
    const urlObj = new URL(url)
    if (urlObj.origin === window.location.origin) {
      return url
    }
  } catch (e) {
    return url
  }

  // 检查缓存
  const cached = urlAvailabilityCache.get(url)
  if (cached !== undefined) {
    return cached ? url : `/api/game/skin-proxy?url=${encodeURIComponent(url)}`
  }

  // 测试直链是否可用
  const directOk = await testDirectUrl(url)
  urlAvailabilityCache.set(url, directOk)

  if (directOk) {
    return url
  }

  // 直链不可用，走代理
  return `/api/game/skin-proxy?url=${encodeURIComponent(url)}`
}

// 动作列表
const animations = [
  { key: 'idle', label: '站立' },
  { key: 'walk', label: '行走' },
  { key: 'run', label: '奔跑' },
  { key: 'fly', label: '飞行' },
  { key: 'swim', label: '游泳' },
  { key: 'wave', label: '挥手' },
  { key: 'crouch', label: '蹲下' }
]

function createAnimation(key) {
  switch (key) {
    case 'idle': return new skinview3d.IdleAnimation()
    case 'walk': return new skinview3d.WalkingAnimation()
    case 'run': return new skinview3d.RunningAnimation()
    case 'fly': return new skinview3d.FlyingAnimation()
    case 'swim': return new skinview3d.SwimAnimation()
    case 'wave': return new skinview3d.WaveAnimation()
    case 'crouch': return new skinview3d.CrouchAnimation()
    default: return new skinview3d.IdleAnimation()
  }
}

function switchAnimation(key) {
  currentAnimation.value = key
  if (viewer) {
    viewer.animation = createAnimation(key)
  }
}

async function initViewer() {
  if (!canvasRef.value) return

  const options = {
    canvas: canvasRef.value,
    width: props.width,
    height: props.height,
    enableControls: props.enableControls,
    animation: createAnimation(props.defaultAnimation)
  }

  // 如果有皮肤URL则加载（先尝试直链，失败再走代理）
  if (props.skinUrl) {
    options.skin = await getResolvedUrl(props.skinUrl)
    options.model = props.skinModel === 'slim' ? 'slim' : (props.skinModel === 'classic' ? 'default' : 'auto-detect')
  }

  // 如果有披风URL则加载（先尝试直链，失败再走代理）
  if (props.capeUrl) {
    options.cape = await getResolvedUrl(props.capeUrl)
  }

  viewer = new skinview3d.SkinViewer(options)

  // 设置名字标签
  if (props.showNameTag && props.playerName) {
    viewer.nameTag = new skinview3d.NameTagObject(props.playerName, {
      textStyle: 'white_with_shadow'
    })
  }

  // 设置背景透明
  viewer.background = null
}

async function loadSkin(url) {
  if (!viewer) return
  if (url) {
    try {
      const resolvedUrl = await getResolvedUrl(url)
      await viewer.loadSkin(resolvedUrl, {
        model: props.skinModel === 'slim' ? 'slim' : (props.skinModel === 'classic' ? 'default' : 'auto-detect')
      })
    } catch (e) {
      console.warn('[SkinViewer3D] 皮肤加载失败:', e)
    }
  } else {
    viewer.resetSkin()
  }
}

async function loadCape(url) {
  if (!viewer) return
  if (url) {
    try {
      const resolvedUrl = await getResolvedUrl(url)
      await viewer.loadCape(resolvedUrl)
    } catch (e) {
      console.warn('[SkinViewer3D] 披风加载失败:', e)
    }
  } else {
    viewer.resetCape()
  }
}

function updateNameTag(name) {
  if (!viewer) return
  if (props.showNameTag && name) {
    viewer.nameTag = new skinview3d.NameTagObject(name, {
      textStyle: 'white_with_shadow'
    })
  } else {
    viewer.nameTag = null
  }
}

onMounted(() => {
  initViewer()
})

onBeforeUnmount(() => {
  if (viewer) {
    viewer.dispose()
    viewer = null
  }
})

// 监听属性变化
watch(() => props.skinUrl, (newUrl) => loadSkin(newUrl))
watch(() => props.capeUrl, (newUrl) => loadCape(newUrl))
watch(() => props.playerName, (newName) => updateNameTag(newName))
watch(() => props.skinModel, () => {
  if (props.skinUrl) {
    loadSkin(props.skinUrl)
  }
})
watch(() => [props.width, props.height], ([w, h]) => {
  if (viewer) {
    viewer.setSize(w, h)
  }
})

defineExpose({
  switchAnimation,
  getViewer: () => viewer
})
</script>

<template>
  <div class="skin-viewer-3d">
    <div class="viewer-canvas-wrapper">
      <canvas
        ref="canvasRef"
        class="viewer-canvas"
      />
    </div>
    <div v-if="showControls" class="viewer-controls">
      <button
        v-for="anim in animations"
        :key="anim.key"
        :class="['control-btn', { active: currentAnimation === anim.key }]"
        :title="anim.label"
        @click="switchAnimation(anim.key)"
      >
        <span class="btn-label">{{ anim.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.skin-viewer-3d {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.viewer-canvas-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  background: transparent;
}

.viewer-canvas {
  display: block;
  max-width: 100%;
  image-rendering: pixelated;
  cursor: grab;
}

.viewer-canvas:active {
  cursor: grabbing;
}

.viewer-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 10px;
  border: 1px solid var(--border-color-primary, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-color-primary, #ffffff);
  color: var(--text-color-secondary, #6b7280);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.control-btn:hover {
  background: var(--bg-color-tertiary, #f3f4f6);
  color: var(--text-color-primary, #1f2937);
  border-color: var(--primary-color, #6366f1);
}

.control-btn.active {
  background: var(--primary-color, #6366f1);
  color: #ffffff;
  border-color: var(--primary-color, #6366f1);
}

.btn-icon {
  font-size: 14px;
  line-height: 1;
}

.btn-label {
  font-size: 12px;
  line-height: 1;
}

@media (max-width: 480px) {
  .viewer-controls {
    gap: 4px;
  }

  .control-btn {
    padding: 4px 8px;
  }

  .btn-label {
    display: none;
  }

  .btn-icon {
    font-size: 16px;
  }
}
</style>
