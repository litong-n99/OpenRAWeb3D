/**
 * main.ts -- SpriteRenderer ThinInstances 批量渲染性能测试
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
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'
import { Matrix } from '@babylonjs/core'
import { Quaternion } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 类型：精灵实例数据
// ---------------------------------------------------------------------------

interface SpriteData {
  position: Vector3   // 世界位置 (XZ 平面 + 微小 Y 偏移模拟地面)
  rotation: number    // 绕 Y 轴的旋转角（模拟单位朝向）
  speed: number       // 旋转速度
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
// 预分配缓冲区（避免每帧 GC 压力）
// ---------------------------------------------------------------------------

let matricesBuffer = new Float32Array(0)
let colorsBuffer = new Float32Array(0)
const _scale = new Vector3()
const _translation = new Vector3()
const _rotation = new Quaternion()
const _world = new Matrix()

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
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
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

  // ---- 摄像机 (RTS 俯视角) ----
  // alpha=-PI/4 使 camera 同时具有 X 和 Z 分量，避免边缘视角
  // beta=PI/4 提供约 45 度俯视角（RTS 经典视角）
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 4,   // alpha: 绕 Y 轴 -45 度
    Math.PI / 4,     // beta: 俯角 45 度
    45,              // radius: 足够看到 40x40 区域
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 100
  camera.panningSensibility = 500
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 基础精灵纹理（用于 ThinInstances 基础 Mesh） ----
  const baseTex = createSpriteTexture(new Color3(1, 1, 1), scene)
  const baseMat = new StandardMaterial('baseMat', scene)
  // CRITICAL: disableLighting=true means Babylon.js uses ONLY the emissive channel.
  // Both emissiveTexture AND emissiveColor must be set, otherwise the mesh renders
  // as black (emissiveColor defaults to Color3(0,0,0)) on a near-black background,
  // making all sprites invisible.  This matches the pattern proven in
  // hardware-palette/color-accuracy/main.ts.
  baseMat.diffuseTexture = baseTex
  baseMat.emissiveTexture = baseTex
  baseMat.emissiveColor = Color3.White()
  baseMat.specularColor.set(0, 0, 0)
  baseMat.backFaceCulling = false
  baseMat.disableLighting = true

  // ---- 创建基础 Mesh（水平平面 XZ，作为地面精灵模板） ----
  // 使用 CreateGround 创建 XZ 平面（水平放置在地面上）
  // 这样从俯视 RTS 视角可以清晰地看到精灵
  // 注：原代码使用 CreatePlane（垂直 XY 平面）+ BILLBOARDMODE_Y，
  // 但 ThinInstances 不继承 billboardMode，导致精灵边缘朝摄像机不可见。
  const baseMesh = MeshBuilder.CreateGround('baseSpriteMesh', { width: 1, height: 1 }, scene)
  baseMesh.material = baseMat
  // Prevent frustum culling: the base mesh is only 1x1 at origin, but thin
  // instances spread across a 40x40 area.  Without this flag, the renderer
  // may cull the entire mesh because its base bounding box is too small.
  baseMesh.alwaysSelectAsActiveMesh = true

  // ---- 精灵数据 ----
  let spriteData: SpriteData[] = []
  let spriteCount = 500
  const areaSize = 40 // 分布区域大小（XZ 平面）

  function generateSprites(count: number): SpriteData[] {
    const data: SpriteData[] = []
    for (let i = 0; i < count; i++) {
      data.push({
        position: new Vector3(
          (Math.random() - 0.5) * areaSize,      // X: 世界 X 轴
          0.05 + Math.random() * 0.2,             // Y: 微小高度偏移（贴在地面上）
          (Math.random() - 0.5) * areaSize,       // Z: 世界 Z 轴
        ),
        rotation: Math.random() * Math.PI * 2,
        speed: (Math.random() - 0.5) * 0.02,
        colorIndex: i % PALETTE_COLORS.length,
        scale: 2 + Math.random() * 3,             // 放大到 2-5 单位，确保在 40x40 区域内肉眼可见
      })
    }
    return data
  }

  /**
   * 批量更新 ThinInstances 矩阵缓冲区。
   *
   * 性能关键：此函数在动画模式下每帧调用，必须零分配。
   * - 使用预分配的 Float32Array（仅在 count 变化时重新分配）
   * - 使用 Matrix.ComposeToRef + Quaternion.RotationYawPitchRollToRef（ToRef 变体，复用对象）
   * - 修复前每帧分配 2500+ Matrix 对象 + 2 个大数组，导致 FPS=2
   */
  function applyThinInstances(): void {
    if (spriteData.length === 0) return

    const count = spriteData.length

    // 仅在 count 变化时重新分配缓冲区（避免每帧 GC）
    if (matricesBuffer.length !== count * 16) {
      matricesBuffer = new Float32Array(count * 16)
    }
    if (colorsBuffer.length !== count * 4) {
      colorsBuffer = new Float32Array(count * 4)
    }

    for (let i = 0; i < count; i++) {
      const d = spriteData[i]
      const c = PALETTE_COLORS[d.colorIndex]

      // 使用 ToRef 变体：复用预分配对象，零分配
      _scale.set(d.scale, d.scale, d.scale)
      _translation.set(d.position.x, d.position.y, d.position.z)
      // yaw=d.rotation 绕 Y 轴旋转（模拟地面单位朝向），pitch=0, roll=0
      Quaternion.RotationYawPitchRollToRef(d.rotation, 0, 0, _rotation)
      // scale * rotation * translation -> 单个世界矩阵
      Matrix.ComposeToRef(_scale, _rotation, _translation, _world)

      const off = i * 16
      matricesBuffer.set(_world.m, off)

      // 实例颜色（RGB + alpha）
      const co = i * 4
      colorsBuffer[co] = c.r
      colorsBuffer[co + 1] = c.g
      colorsBuffer[co + 2] = c.b
      colorsBuffer[co + 3] = 0.9
    }

    // 批量设置 ThinInstances 缓冲区
    // staticBuffer=false 允许动态更新（动画帧间修改矩阵）
    baseMesh.thinInstanceSetBuffer('matrix', matricesBuffer, 16, false)
    // color 缓冲区会被 Babylon.js 自动转换为 instanceColor 属性，
    // StandardMaterial 通过 INSTANCESCOLOR define 支持此属性
    baseMesh.thinInstanceSetBuffer('color', colorsBuffer, 4, false)

    // 使用 thinInstanceRefreshBoundingInfo 计算包含所有实例的包围盒
    // (refreshBoundingInfo 仅计算基础 mesh 的包围盒，不会包含 thin instances)
    baseMesh.thinInstanceRefreshBoundingInfo(false)

    // 确保 mesh 可见
    baseMesh.isVisible = true
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
  console.log(`[init] scene ready: ${scene.meshes.length} meshes, spriteData.length=${spriteData.length}`)

  // ---- FPS 监控 + 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = 0
  let firstFrame = true  // skip first frame's huge delta (includes init overhead)
  let frameCount = 0
  let lastDrawCallSample = Date.now()
  let estimatedDrawCalls = 1

  engine.runRenderLoop(() => {
    try {
      // Reset the FPS clock on the first real frame to avoid counting
      // all initialization time as one giant "frame" that reports FPS=1.
      if (firstFrame) {
        lastFpsUpdate = performance.now()
        firstFrame = false
      }
      const now = performance.now()

      try {
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
      } catch (err) {
        console.error('[render-loop] applyThinInstances failed:', err)
      }

      try {
        scene.render()
      } catch (renderErr) {
        console.error('[render-loop] scene.render() failed:', renderErr)
      }

      // Log first successful frame for diagnostics
      if (fpsFrames === 0 && fpsDisplay === 0 && !firstFrame) {
        console.log(`[render-loop] first frame rendered: meshes=${scene.meshes.length}, activeCamera=${scene.activeCamera?.name}, sprites=${spriteData.length}`)
      }

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
    } catch (loopErr) {
      console.error('[render-loop] unhandled error (loop continues):', loopErr)
      // IMPORTANT: Do NOT re-throw. Babylon.js 9.x does not wrap render
      // callbacks in try-catch. Any unhandled error propagates through
      // _renderFrame -> _processFrame -> _renderLoop and prevents
      // requestAnimationFrame from being scheduled for the next frame,
      // silently killing the entire render loop.
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
