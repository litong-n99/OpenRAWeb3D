/**
 * main.ts — SpriteRenderer ThinInstances 批量渲染性能测试
 *
 * 测试目标:
 *   1. 验证 100/500/1000/5000 个精灵同时渲染时的 FPS 稳定性
 *   2. 验证 ThinInstances 矩阵批量更新的性能表现
 *   3. 验证动态精灵数量切换的平滑性
 *
 * OpenRA 对照: SpriteRenderer.ts ThinInstancesGroup.setInstances()
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { Mesh } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'
import { Matrix } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 类型：精灵实例数据
// ---------------------------------------------------------------------------

interface SpriteData {
  position: Vector3
  rotation: number
  speed: number      // 旋转速度
  colorIndex: number  // 调色板索引
  scale: number
}

// ---------------------------------------------------------------------------
// 颜色调色板
// ---------------------------------------------------------------------------

const PALETTE_COLORS: Color3[] = [
  new Color3(0.95, 0.2, 0.2),   // 红
  new Color3(0.2, 0.85, 0.3),   // 绿
  new Color3(0.2, 0.5, 0.95),   // 蓝
  new Color3(0.95, 0.8, 0.1),   // 黄
  new Color3(0.85, 0.3, 0.9),   // 紫
  new Color3(0.2, 0.85, 0.85),  // 青
  new Color3(0.95, 0.5, 0.2),   // 橙
  new Color3(0.95, 0.95, 0.95), // 白
]

// ---------------------------------------------------------------------------
// 辅助：创建带纹理的单个精灵平面（用作 ThinInstances 的基础 Mesh）
// ---------------------------------------------------------------------------

function createSpriteTexture(color: Color3, scene: Scene): DynamicTexture {
  const size = 64
  const tex = new DynamicTexture(`spriteTex_${Math.random().toString(36).slice(2)}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D

  // 实心圆点
  const half = size / 2
  const r = Math.round(color.r * 255)
  const g = Math.round(color.g * 255)
  const b = Math.round(color.b * 255)

  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.beginPath()
  ctx.arc(half, half, half * 0.4, 0, Math.PI * 2)
  ctx.fill()

  // 外圈
  ctx.strokeStyle = `rgba(255,255,255,0.7)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(half, half, half * 0.45, 0, Math.PI * 2)
  ctx.stroke()

  tex.update(true)
  tex.hasAlpha = true
  return tex
}

// ---------------------------------------------------------------------------
// FPS 历史记录（用于图表）
// ---------------------------------------------------------------------------

interface FpsHistory {
  samples: number[]
  readonly maxSamples: number
}

function createFpsHistory(maxSamples = 120): FpsHistory {
  return { samples: [], maxSamples }
}

function pushFpsSample(history: FpsHistory, fps: number): void {
  history.samples.push(fps)
  if (history.samples.length > history.maxSamples) {
    history.samples.shift()
  }
}

function drawFpsChart(history: FpsHistory, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  if (history.samples.length < 2) return

  // 计算统计量
  const min = Math.min(...history.samples)
  const max = Math.max(...history.samples)
  const avg = history.samples.reduce((a, b) => a + b, 0) / history.samples.length

  const range = max - min || 1
  const xStep = w / (history.samples.length - 1)

  // 画 60fps 参考线
  ctx.strokeStyle = 'rgba(46,204,113,0.3)'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  const y60 = h - ((60 - min) / range) * h
  ctx.moveTo(0, y60)
  ctx.lineTo(w, y60)
  ctx.stroke()
  ctx.setLineDash([])

  // 画 30fps 警戒线
  ctx.strokeStyle = 'rgba(231,76,60,0.3)'
  ctx.setLineDash([2, 6])
  ctx.beginPath()
  const y30 = h - ((30 - min) / range) * h
  ctx.moveTo(0, y30)
  ctx.lineTo(w, y30)
  ctx.stroke()
  ctx.setLineDash([])

  // 画 FPS 折线
  ctx.strokeStyle = '#2ecc71'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < history.samples.length; i++) {
    const x = i * xStep
    const y = h - ((history.samples[i] - min) / range) * h
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // 标注
  ctx.fillStyle = '#666'
  ctx.font = '9px monospace'
  ctx.textAlign = 'left'
  ctx.fillText('60', 2, y60 - 2)
  ctx.fillText('30', 2, y30 - 2)

  document.getElementById('chart-max')!.textContent = String(max)
  document.getElementById('chart-avg')!.textContent = String(Math.round(avg))
  document.getElementById('chart-min')!.textContent = String(min)
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ---- 环境信息 ----
  const infoUa = document.getElementById('info-ua')!
  const infoViewport = document.getElementById('info-viewport')!
  const infoEngine = document.getElementById('info-engine')!
  const infoFps = document.getElementById('info-fps')!
  const infoTime = document.getElementById('info-time')!

  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()

  window.addEventListener('resize', () => {
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  })

  // ---- Babylon.js 初始化 ----
  const sandboxEl = document.getElementById('sandbox')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.width = Math.max(sandboxEl.getBoundingClientRect().width || 800, 1)
  canvas.height = Math.max(sandboxEl.getBoundingClientRect().height || 600, 1)
  sandboxEl.appendChild(canvas)

  let engine: Engine
  try {
    engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: false,
    })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return
  }
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  // ---- 场景创建 ----
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.05, 0.06, 0.08, 1)

  // ---- 摄像机 ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 3,  // RTS 视角
    30,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 80
  camera.panningSensibility = 500
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 基础精灵纹理（用于 ThinInstances 基础 Mesh） ----
  const baseTex = createSpriteTexture(new Color3(1, 1, 1), scene)
  const baseMat = new StandardMaterial('baseMat', scene)
  baseMat.diffuseTexture = baseTex
  baseMat.emissiveTexture = baseTex
  baseMat.emissiveColor = new Color3(1, 1, 1)
  baseMat.useAlphaFromDiffuseTexture = true
  baseMat.specularColor.set(0, 0, 0)
  baseMat.backFaceCulling = false
  baseMat.disableLighting = true

  // ---- 创建基础 Mesh（1x1 单位平面，用作所有 ThinInstances 的模板） ----
  const baseMesh = MeshBuilder.CreatePlane('baseSpriteMesh', { size: 1 }, scene)
  baseMesh.billboardMode = Mesh.BILLBOARDMODE_Y
  baseMesh.material = baseMat

  // ---- 精灵数据 ----
  let spriteData: SpriteData[] = []
  let spriteCount = 500
  const areaSize = 40 // 分布区域大小

  function generateSprites(count: number): SpriteData[] {
    const data: SpriteData[] = []
    for (let i = 0; i < count; i++) {
      data.push({
        position: new Vector3(
          (Math.random() - 0.5) * areaSize,
          (Math.random() - 0.5) * areaSize * 0.7,
          Math.random() * 0.5, // 微小的 Z 偏移
        ),
        rotation: Math.random() * Math.PI * 2,
        speed: (Math.random() - 0.5) * 0.02,
        colorIndex: i % PALETTE_COLORS.length,
        scale: 0.3 + Math.random() * 0.5,
      })
    }
    return data
  }

  function applyThinInstances(): void {
    if (spriteData.length === 0) return

    const count = spriteData.length
    const matrices = new Float32Array(count * 16)
    const colors = new Float32Array(count * 4)

    for (let i = 0; i < count; i++) {
      const d = spriteData[i]
      const c = PALETTE_COLORS[d.colorIndex]

      const scaleMatrix = Matrix.Scaling(d.scale, d.scale, d.scale)
      const rotMatrix = Matrix.RotationZ(d.rotation)
      const transMatrix = Matrix.Translation(d.position.x, d.position.y, d.position.z)

      const world = transMatrix.multiply(rotMatrix).multiply(scaleMatrix)
      const m = world.m
      const off = i * 16
      for (let j = 0; j < 16; j++) {
        matrices[off + j] = m[j]
      }

      const co = i * 4
      colors[co] = c.r
      colors[co + 1] = c.g
      colors[co + 2] = c.b
      colors[co + 3] = 0.9
    }

    baseMesh.thinInstanceSetBuffer('matrix', matrices, 16)
    baseMesh.thinInstanceSetBuffer('color', colors, 4)
    baseMesh.refreshBoundingInfo()
  }

  function updateSpriteCount(newCount: number): void {
    spriteCount = newCount
    spriteData = generateSprites(newCount)
    applyThinInstances()
    document.getElementById('overlay-count')!.textContent = String(newCount)
    document.getElementById('count-val')!.textContent = String(newCount)
    ;(document.getElementById('count-slider') as HTMLInputElement).value = String(newCount)
  }

  // ---- UI 绑定 ----
  const overlayFps = document.getElementById('overlay-fps')!
  const perfFps = document.getElementById('perf-fps')!
  const perfFrameTime = document.getElementById('perf-frame-time')!
  const perfDrawCalls = document.getElementById('perf-draw-calls')!
  const fpsCanvas = document.getElementById('fps-canvas') as HTMLCanvasElement
  const countSlider = document.getElementById('count-slider') as HTMLInputElement
  const countVal = document.getElementById('count-val')!
  const enableAnimCb = document.getElementById('enable-animation') as HTMLInputElement
  const stressModeCb = document.getElementById('stress-mode') as HTMLInputElement

  fpsCanvas.width = fpsCanvas.parentElement!.clientWidth * 2
  fpsCanvas.height = 80 * 2
  fpsCanvas.style.width = '100%'
  fpsCanvas.style.height = '80px'

  const fpsHistory = createFpsHistory(120)

  // 预设按钮
  for (const id of ['preset-100', 'preset-500', 'preset-1000', 'preset-5000']) {
    document.getElementById(id)!.addEventListener('click', () => {
      const count = parseInt(id.split('-')[1])
      updateSpriteCount(count)
    })
  }

  countSlider.addEventListener('input', () => {
    countVal.textContent = countSlider.value
  })

  document.getElementById('apply-count')!.addEventListener('click', () => {
    updateSpriteCount(parseInt(countSlider.value, 10))
  })

  document.getElementById('reset-scene')!.addEventListener('click', () => {
    updateSpriteCount(spriteCount)
  })

  let enableAnimation = true
  let stressMode = false

  enableAnimCb.addEventListener('change', () => {
    enableAnimation = enableAnimCb.checked
  })

  stressModeCb.addEventListener('change', () => {
    stressMode = stressModeCb.checked
  })

  // ---- 初始化 ----
  updateSpriteCount(500)

  // ---- FPS 监控 + 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()
  let frameCount = 0
  let lastDrawCallSample = Date.now()
  let estimatedDrawCalls = 1

  engine.runRenderLoop(() => {
    const now = performance.now()

    // 动画：更新旋转
    if (enableAnimation && spriteData.length > 0) {
      for (const d of spriteData) {
        d.rotation += d.speed
      }
      applyThinInstances()
    }

    // 压力模式：每 10 帧重新生成精灵
    if (stressMode) {
      frameCount++
      if (frameCount % 10 === 0) {
        spriteData = generateSprites(spriteCount)
        applyThinInstances()
      }
    }

    scene.render()

    // FPS 计算
    fpsFrames++
    fpsAccum += now - lastFpsUpdate
    lastFpsUpdate = now

    if (fpsAccum >= 250) {
      fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
      fpsFrames = 0
      fpsAccum = 0

      // 更新每 0.5 秒估算 draw calls
      if (Date.now() - lastDrawCallSample > 500) {
        estimatedDrawCalls = 1 + Math.ceil(spriteData.length / 1024) // ThinInstances 每 1024 个一批
        lastDrawCallSample = Date.now()
      }

      pushFpsSample(fpsHistory, fpsDisplay)
      drawFpsChart(fpsHistory, fpsCanvas)

      const frameTimeMs = fpsDisplay > 0 ? (1000 / fpsDisplay).toFixed(1) : '-'

      overlayFps.textContent = String(fpsDisplay)
      perfFps.textContent = String(fpsDisplay)
      perfFrameTime.textContent = frameTimeMs + 'ms'
      perfDrawCalls.textContent = String(estimatedDrawCalls)
      infoFps.textContent = String(fpsDisplay)
      infoTime.textContent = new Date().toISOString()

      // 颜色指示
      if (fpsDisplay >= 55) {
        perfFps.className = 'perf-value good'
      } else if (fpsDisplay >= 30) {
        perfFps.className = 'perf-value warn'
      } else {
        perfFps.className = 'perf-value bad'
      }
    }
  })

  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  })
  resizeObserver.observe(canvas)
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
