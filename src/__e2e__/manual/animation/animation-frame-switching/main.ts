/**
 * main.ts — Animation 帧动画播放人工验收测试
 *
 * 测试目标:
 *   1. 验证帧动画在 25fps（40ms）帧间隔下的播放流畅度
 *   2. 验证 PlayRepeating / PlayThen / PlayBackwardsThen / PlayFetchDirection 四种模式
 *   3. 验证帧切换无闪烁、时间精度正确
 *
 * OpenRA 对照: Animation.ts — Tick(), tickMs(), 6 种播放模式
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

// ---------------------------------------------------------------------------
// 帧序列生成
// ---------------------------------------------------------------------------

interface FrameData {
  index: number
  texture: DynamicTexture
}

/**
 * 生成动画帧纹理序列。
 * 每帧是一个带编号的彩色方块，便于肉眼区分帧切换。
 */
function generateFrameTextures(
  frameCount: number,
  scene: Scene,
): FrameData[] {
  const frames: FrameData[] = []
  const hueStep = 360 / frameCount

  for (let i = 0; i < frameCount; i++) {
    const size = 256
    const tex = new DynamicTexture(`frame_${i}`, { width: size, height: size }, scene, false)
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D

    // 背景色：从色相环中取色
    const hue = i * hueStep
    const sat = 0.7
    const light = 0.5
    const [r, g, b] = hslToRgb(hue / 360, sat, light)

    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, size, size)

    // 帧编号
    const textColor = light > 0.5 ? '#000' : '#fff'
    ctx.fillStyle = textColor
    ctx.font = 'bold 80px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), size / 2, size / 2)

    // 边框
    ctx.strokeStyle = `rgba(255,255,255,0.5)`
    ctx.lineWidth = 3
    ctx.strokeRect(4, 4, size - 8, size - 8)

    tex.update(true)
    tex.hasAlpha = false
    frames.push({ index: i, texture: tex })
  }

  return frames
}

/**
 * HSL → RGB 转换
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h * 6) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 1 / 6) { r = c; g = x }
  else if (h < 2 / 6) { r = x; g = c }
  else if (h < 3 / 6) { g = c; b = x }
  else if (h < 4 / 6) { g = x; b = c }
  else if (h < 5 / 6) { r = x; b = c }
  else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

// ---------------------------------------------------------------------------
// 标签纹理
// ---------------------------------------------------------------------------

function createLabelTexture(text: string, scene: Scene): DynamicTexture {
  const tex = new DynamicTexture(`label_${text}`, { width: 512, height: 64 }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  ctx.fillStyle = '#00000000'
  ctx.clearRect(0, 0, 512, 64)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 32px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 32)
  tex.update(true)
  return tex
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
  scene.clearColor = new Color4(0.08, 0.09, 0.12, 1)

  // ---- 摄像机 ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 2,
    10,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1 // ORTHOGRAPHIC_CAMERA
  orthoForZoom(camera, 1)
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  function orthoForZoom(cam: typeof camera, zoom: number): void {
    const h = 3 / zoom
    const w = 3 / zoom
    cam.orthoTop = h
    cam.orthoBottom = -h
    cam.orthoLeft = -w * 1.5
    cam.orthoRight = w * 1.5
  }

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 创建帧序列纹理 ----
  let frameCount = 15
  let frames = generateFrameTextures(frameCount, scene)

  // ---- 动画显示平面 ----
  const animPlane = MeshBuilder.CreatePlane('animPlane', { width: 2, height: 2 }, scene)
  animPlane.position = new Vector3(-2, 0, 0)

  const mat = new StandardMaterial('animMat', scene)
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.specularColor.set(0, 0, 0)
  mat.backFaceCulling = false
  mat.disableLighting = true
  animPlane.material = mat

  // ---- 逐帧预览条（底部） ----
  const previewPlanes: ReturnType<typeof MeshBuilder.CreatePlane>[] = []
  const previewMats: StandardMaterial[] = []
  const cellSize = 0.35
  const totalWidth = frameCount * cellSize * 1.1
  const startX = -totalWidth / 2 + cellSize / 2

  function createPreviewStrip(): void {
    // 清理旧预览
    for (const p of previewPlanes) p.dispose()
    for (const m of previewMats) m.dispose()
    previewPlanes.length = 0
    previewMats.length = 0

    for (let i = 0; i < frameCount; i++) {
      const prevMat = new StandardMaterial(`prevMat_${i}`, scene)
      prevMat.diffuseTexture = frames[i].texture
      prevMat.emissiveTexture = frames[i].texture
      prevMat.emissiveColor = new Color3(1, 1, 1)
      prevMat.specularColor.set(0, 0, 0)
      prevMat.backFaceCulling = false
      prevMat.disableLighting = true

      const prevPlane = MeshBuilder.CreatePlane(`prevPlane_${i}`, { width: cellSize, height: cellSize }, scene)
      prevPlane.position = new Vector3(startX + i * cellSize * 1.1, -2.3, 0)
      prevPlane.material = prevMat

      previewPlanes.push(prevPlane)
      previewMats.push(prevMat)
    }
  }

  // ---- 信息标签 ----
  function createInfoPlane(text: string, x: number, y: number): void {
    const tex = createLabelTexture(text, scene)
    const m = new StandardMaterial(`infoMat_${text}`, scene)
    m.diffuseTexture = tex
    m.emissiveTexture = tex
    m.emissiveColor = new Color3(1, 1, 1)
    m.specularColor.set(0, 0, 0)
    m.backFaceCulling = false
    m.disableLighting = true
    const p = MeshBuilder.CreatePlane(`infoPlane_${text}`, { width: 2.5, height: 0.4 }, scene)
    p.position = new Vector3(x, y, 0)
    p.material = m
  }

  createInfoPlane('ANIMATION MAIN', -2, 1.5)
  createInfoPlane('FRAME PREVIEW', 0, -1.9)

  // ---- 动画状态机 ----
  let currentFrame = 0
  let timeUntilNextFrame = 40 // ms
  let isPlaying = true
  let playMode: 'repeating' | 'then' | 'backwards' | 'fetchDirection' = 'repeating'
  let tickInterval = 40 // ms
  let speedMultiplier = 1.0
  let totalTicks = 0
  let direction = 1 // for fetchDirection mode

  function setAnimTexture(frameIdx: number): void {
    const idx = Math.max(0, Math.min(frameCount - 1, frameIdx))
    const tex = frames[idx].texture
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    currentFrame = idx
  }

  function tickAnimation(): void {
    const effectiveTick = tickInterval / speedMultiplier
    timeUntilNextFrame -= 16.667 // 约 60fps 的帧时间

    while (timeUntilNextFrame <= 0) {
      timeUntilNextFrame += effectiveTick
      totalTicks++

      switch (playMode) {
        case 'repeating':
          currentFrame = (currentFrame + 1) % frameCount
          break
        case 'then':
          if (currentFrame < frameCount - 1) {
            currentFrame++
          } else {
            isPlaying = false
          }
          break
        case 'backwards':
          if (currentFrame > 0) {
            currentFrame--
          } else {
            isPlaying = false
          }
          break
        case 'fetchDirection':
          currentFrame = (currentFrame + direction + frameCount) % frameCount
          break
      }
      setAnimTexture(currentFrame)
    }
  }

  // ---- 帧点指示器 ----
  function updateFrameDots(): void {
    const dotsEl = document.getElementById('frame-dots')!
    dotsEl.innerHTML = ''
    for (let i = 0; i < frameCount; i++) {
      const dot = document.createElement('span')
      dot.className = `frame-dot${i === currentFrame ? ' active' : ''}`
      dotsEl.appendChild(dot)
    }
  }

  // ---- UI 绑定 ----
  const playModeSel = document.getElementById('play-mode') as HTMLSelectElement
  const tickSlider = document.getElementById('tick-slider') as HTMLInputElement
  const tickVal = document.getElementById('tick-val')!
  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement
  const speedVal = document.getElementById('speed-val')!
  const btnPlay = document.getElementById('btn-play') as HTMLButtonElement
  const btnPause = document.getElementById('btn-pause') as HTMLButtonElement
  const btnReset = document.getElementById('btn-reset') as HTMLButtonElement
  const frameCountSel = document.getElementById('frame-count') as HTMLSelectElement
  const stateFrame = document.getElementById('state-frame')!
  const stateTotal = document.getElementById('state-total')!
  const stateTimeLeft = document.getElementById('state-time-left')!
  const stateTicks = document.getElementById('state-ticks')!

  stateTotal.textContent = String(frameCount)

  playModeSel.addEventListener('change', () => {
    playMode = playModeSel.value as typeof playMode
    currentFrame = playMode === 'backwards' ? frameCount - 1 : 0
    isPlaying = true
    setAnimTexture(currentFrame)
  })

  tickSlider.addEventListener('input', () => {
    tickInterval = parseInt(tickSlider.value, 10)
    tickVal.textContent = `${tickInterval}ms (${Math.round(1000 / tickInterval)}fps)`
  })

  speedSlider.addEventListener('input', () => {
    speedMultiplier = parseFloat(speedSlider.value)
    speedVal.textContent = `${speedMultiplier.toFixed(1)}x`
  })

  btnPlay.addEventListener('click', () => {
    isPlaying = true
    btnPlay.classList.add('active')
    btnPause.classList.remove('active')
  })

  btnPause.addEventListener('click', () => {
    isPlaying = false
    btnPause.classList.add('active')
    btnPlay.classList.remove('active')
  })

  btnReset.addEventListener('click', () => {
    currentFrame = 0
    timeUntilNextFrame = tickInterval
    totalTicks = 0
    isPlaying = true
    direction = 1
    setAnimTexture(0)
    btnPlay.classList.add('active')
    btnPause.classList.remove('active')
  })

  frameCountSel.addEventListener('change', () => {
    frameCount = parseInt(frameCountSel.value, 10)
    frames = generateFrameTextures(frameCount, scene)
    createPreviewStrip()
    stateTotal.textContent = String(frameCount)
    currentFrame = 0
    setAnimTexture(0)
    updateFrameDots()
  })

  // ---- 初始化 ----
  setAnimTexture(0)
  createPreviewStrip()
  updateFrameDots()
  btnPlay.classList.add('active')

  // ---- FPS 监控 + 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  engine.runRenderLoop(() => {
    if (isPlaying) {
      tickAnimation()
    }

    // 更新 UI 状态
    stateFrame.textContent = String(currentFrame)
    stateTimeLeft.textContent = `${timeUntilNextFrame.toFixed(0)}ms`
    stateTicks.textContent = String(totalTicks)
    updateFrameDots()

    // 更新预览条高亮
    for (let i = 0; i < previewPlanes.length; i++) {
      previewPlanes[i].scaling.setAll(i === currentFrame ? 1.3 : 1)
    }

    scene.render()

    const now = performance.now()
    fpsFrames++
    fpsAccum += now - lastFpsUpdate
    lastFpsUpdate = now

    if (fpsAccum >= 500) {
      fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
      fpsFrames = 0
      fpsAccum = 0
    }
    infoFps.textContent = String(fpsDisplay)
    infoTime.textContent = new Date().toISOString()
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
