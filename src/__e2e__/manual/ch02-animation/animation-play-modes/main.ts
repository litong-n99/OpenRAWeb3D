/**
 * main.ts — Animation 高级播放模式人工验收测试
 *
 * 测试目标:
 *   1. PlayFetchIndex — tickAlways=true 模式，外部函数控制帧索引
 *      对应 OpenRA Animation.PlayFetchIndex (Animation.cs:187-195)
 *   2. ReplaceAnim — 序列替换保持相对帧位置（取模）
 *      对应 OpenRA Animation.ReplaceAnim (Animation.cs:151-160)
 *   3. GetRandomExistingSequence — 从候选序列随机选择
 *      对应 OpenRA Animation.GetRandomExistingSequence
 *
 * OpenRA 对照: Animation.ts — 6 种播放模式全覆盖
 *   animation-frame-switching 已覆盖: PlayRepeating, PlayThen, PlayBackwardsThen, PlayFetchDirection (4/6)
 *   本测试页覆盖剩余: PlayFetchIndex, ReplaceAnim (2/6)
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3, Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 序列定义
// ---------------------------------------------------------------------------

interface SequenceDef {
  name: string
  length: number
  tick: number       // 帧间隔 (ms)
  color: [number, number, number]  // 序列主题色
  label: string      // 帧上显示的标签
}

const SEQUENCES: SequenceDef[] = [
  { name: 'walk',    length: 15, tick: 40,  color: [0.2, 0.8, 0.2], label: 'WALK' },
  { name: 'attack',  length: 8,  tick: 60,  color: [0.9, 0.2, 0.2], label: 'ATK' },
  { name: 'idle',    length: 4,  tick: 120, color: [0.5, 0.5, 0.9], label: 'IDLE' },
  { name: 'deploy',  length: 30, tick: 30,  color: [0.9, 0.7, 0.1], label: 'DEPLOY' },
  { name: 'die',     length: 10, tick: 80,  color: [0.3, 0.3, 0.3], label: 'DIE' },
]

// ---------------------------------------------------------------------------
// 帧纹理生成
// ---------------------------------------------------------------------------

interface FrameData {
  index: number
  texture: DynamicTexture
}

function generateFrameTextures(
  seq: SequenceDef,
  scene: Scene,
): FrameData[] {
  const frames: FrameData[] = []
  const size = 256

  for (let i = 0; i < seq.length; i++) {
    const tex = new DynamicTexture(`frame_${seq.name}_${i}`, { width: size, height: size }, scene, false)
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D

    // 背景：使用序列主题色，根据帧索引变化亮度
    const progress = seq.length > 1 ? i / (seq.length - 1) : 0
    const [r, g, b] = seq.color
    const bgR = Math.round((r * 0.4 + r * 0.6 * progress) * 255)
    const bgG = Math.round((g * 0.4 + g * 0.6 * progress) * 255)
    const bgB = Math.round((b * 0.4 + b * 0.6 * progress) * 255)
    ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`
    ctx.fillRect(0, 0, size, size)

    // 序列标签
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.font = 'bold 28px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(seq.label, size / 2, 12)

    // 帧编号（大号居中）
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 64px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), size / 2, size / 2)

    // 进度文本
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '16px monospace'
    ctx.fillText(`${i + 1}/${seq.length}`, size / 2, size / 2 + 50)

    // 边框
    ctx.strokeStyle = `rgba(255,255,255,0.4)`
    ctx.lineWidth = 3
    ctx.strokeRect(4, 4, size - 8, size - 8)

    tex.update(true)
    tex.hasAlpha = false
    frames.push({ index: i, texture: tex })
  }

  return frames
}

// ---------------------------------------------------------------------------
// 事件日志
// ---------------------------------------------------------------------------

let eventLogCount = 0
function logEvent(message: string): void {
  eventLogCount++
  const logEl = document.getElementById('event-log')!
  const now = new Date()
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  const entry = `[${time}] ${message}`
  if (eventLogCount === 1) {
    logEl.textContent = entry
  } else {
    // Keep last 50 entries
    const lines = (logEl.textContent || '').split('\n')
    if (lines.length >= 50) lines.shift()
    lines.push(entry)
    logEl.textContent = lines.join('\n')
  }
  logEl.scrollTop = logEl.scrollHeight
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

  // ---- 场景 ----
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
  camera.orthoTop = 1.8
  camera.orthoBottom = -1.8
  camera.orthoLeft = -3.2
  camera.orthoRight = 3.2
  camera.inputs.clear()

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 主显示平面 ----
  const mainPlane = MeshBuilder.CreatePlane('mainPlane', { width: 2, height: 2 }, scene)
  mainPlane.position = new Vector3(-1.5, 0, 0)
  const mainMat = new StandardMaterial('mainMat', scene)
  mainMat.emissiveColor = new Color3(1, 1, 1)
  mainMat.specularColor.set(0, 0, 0)
  mainMat.backFaceCulling = false
  mainMat.disableLighting = true
  mainPlane.material = mainMat

  // ---- 预览条平面（显示所有帧的缩略网格） ----
  const previewPlanes: ReturnType<typeof MeshBuilder.CreatePlane>[] = []
  const previewMats: StandardMaterial[] = []

  function buildPreviewStrip(frames: FrameData[]): void {
    for (const p of previewPlanes) p.dispose()
    for (const m of previewMats) m.dispose()
    previewPlanes.length = 0
    previewMats.length = 0

    const count = frames.length
    const cellSize = Math.min(0.35, 4 / count)
    const totalWidth = count * cellSize * 1.15
    const startX = 1.5 - totalWidth / 2 + cellSize / 2

    for (let i = 0; i < count; i++) {
      const prevMat = new StandardMaterial(`prevMat_${i}`, scene)
      prevMat.diffuseTexture = frames[i]!.texture
      prevMat.emissiveTexture = frames[i]!.texture
      prevMat.emissiveColor = new Color3(1, 1, 1)
      prevMat.specularColor.set(0, 0, 0)
      prevMat.backFaceCulling = false
      prevMat.disableLighting = true

      const prevPlane = MeshBuilder.CreatePlane(`prevPlane_${i}`, { width: cellSize, height: cellSize }, scene)
      prevPlane.position = new Vector3(startX + i * cellSize * 1.15, -1.5, 0)
      prevPlane.material = prevMat

      previewPlanes.push(prevPlane)
      previewMats.push(prevMat)
    }
  }

  // ---- 状态 ----
  let currentSequence = SEQUENCES[0]!
  let allFrames = new Map<string, FrameData[]>()
  let currentFrameIndex = 0
  let activePlayMode: 'fetchIndex' | 'replaceAnim' | 'random' = 'fetchIndex'
  let isAutoProgress = true
  let tickAlways = true
  let timeUntilNextFrame = 40
  let totalTicks = 0

  // 初始化所有序列的帧纹理
  for (const seq of SEQUENCES) {
    allFrames.set(seq.name, generateFrameTextures(seq, scene))
  }

  function setFrame(frameIdx: number, seq?: SequenceDef): void {
    const s = seq ?? currentSequence
    const idx = Math.max(0, Math.min(s.length - 1, frameIdx))
    const frames = allFrames.get(s.name)!
    const tex = frames[idx]!.texture
    mainMat.diffuseTexture = tex
    mainMat.emissiveTexture = tex
    currentFrameIndex = idx
  }

  function updatePreviewHighlight(): void {
    for (let i = 0; i < previewPlanes.length; i++) {
      previewPlanes[i]!.scaling.setAll(i === currentFrameIndex ? 1.4 : 0.75)
      const mat = previewMats[i]!
      mat.alpha = i === currentFrameIndex ? 1 : 0.4
    }
  }

  // ---- UI 引用 ----
  const playModeSel = document.getElementById('play-mode') as HTMLSelectElement
  const fetchSlider = document.getElementById('fetch-index-slider') as HTMLInputElement
  const fetchVal = document.getElementById('fetch-index-val')!
  const progressBar = document.getElementById('progress-bar')!
  const btnAutoProgress = document.getElementById('btn-auto-progress') as HTMLButtonElement
  const btnFetchManual = document.getElementById('btn-fetch-manual') as HTMLButtonElement
  const replaceControls = document.getElementById('replace-anim-controls')!
  const fetchControls = document.getElementById('fetch-index-controls')!
  const btnReplaceAttack = document.getElementById('btn-replace-attack') as HTMLButtonElement
  const btnReplaceIdle = document.getElementById('btn-replace-idle') as HTMLButtonElement
  const btnReplaceDeploy = document.getElementById('btn-replace-deploy') as HTMLButtonElement
  const btnCurrentSeq = document.getElementById('btn-replace-walk') as HTMLButtonElement
  const btnClearLog = document.getElementById('btn-clear-log') as HTMLButtonElement

  const stateSeq = document.getElementById('state-sequence')!
  const stateSeqLen = document.getElementById('state-seq-length')!
  const stateTick = document.getElementById('state-tick')!
  const stateFrame = document.getElementById('state-frame')!
  const stateDir = document.getElementById('state-direction')!
  const stateTickAlways = document.getElementById('state-tick-always')!
  const stateTimeLeft = document.getElementById('state-time-left')!

  function updateStateDisplay(): void {
    stateSeq.textContent = currentSequence.name
    stateSeqLen.textContent = `${currentSequence.length} 帧`
    stateTick.textContent = `${currentSequence.tick}ms (${Math.round(1000 / currentSequence.tick)}fps)`
    stateFrame.textContent = String(currentFrameIndex)
    stateDir.textContent = '正向'
    stateTickAlways.textContent = String(tickAlways)
    stateTimeLeft.textContent = `${timeUntilNextFrame.toFixed(0)}ms`
  }

  // ---- 切换序列（ReplaceAnim 逻辑：保持帧索引取模） ----
  function switchSequence(seqName: string): void {
    const newSeq = SEQUENCES.find(s => s.name === seqName)
    if (!newSeq) return
    if (newSeq === currentSequence) return

    const oldFrame = currentFrameIndex
    const oldSeqLen = currentSequence.length
    const oldSeqName = currentSequence.name

    // ReplaceAnim: frame %= newSequence.length
    currentSequence = newSeq
    const newFrame = oldFrame % newSeq.length
    currentFrameIndex = newFrame
    timeUntilNextFrame = Math.min(oldSeqLen > 0 ? currentSequence.tick : 40,
      timeUntilNextFrame || currentSequence.tick)

    logEvent(`ReplaceAnim: ${oldSeqName}(${oldFrame}/${oldSeqLen - 1}) → ${newSeq.name}(${newFrame}/${newSeq.length - 1}) [${oldFrame} % ${newSeq.length} = ${newFrame}]`)

    // 重建预览条
    const frames = allFrames.get(currentSequence.name)!
    fetchSlider.max = String(currentSequence.length - 1)
    fetchSlider.value = String(newFrame)
    fetchVal.textContent = `${newFrame} / ${currentSequence.length - 1}`
    buildPreviewStrip(frames)
    setFrame(newFrame)
    updatePreviewHighlight()
    updateStateDisplay()
  }

  // ---- 播放模式切换 UI ----
  playModeSel.addEventListener('change', () => {
    activePlayMode = playModeSel.value as typeof activePlayMode

    switch (activePlayMode) {
      case 'fetchIndex':
        fetchControls.style.display = ''
        replaceControls.style.display = 'none'
        tickAlways = true
        currentSequence = SEQUENCES[0]!
        break
      case 'replaceAnim':
        fetchControls.style.display = 'none'
        replaceControls.style.display = ''
        tickAlways = false
        currentSequence = SEQUENCES[0]!
        break
      case 'random':
        fetchControls.style.display = 'none'
        replaceControls.style.display = 'none'
        tickAlways = false
        break
    }

    // 重建
    const frames = allFrames.get(currentSequence.name)!
    fetchSlider.max = String(currentSequence.length - 1)
    fetchSlider.value = '0'
    fetchVal.textContent = `0 / ${currentSequence.length - 1}`
    currentFrameIndex = 0
    buildPreviewStrip(frames)
    setFrame(0)
    updatePreviewHighlight()
    updateStateDisplay()
    logEvent(`切换到模式: ${activePlayMode}, 序列: ${currentSequence.name}(${currentSequence.length}帧), tickAlways=${tickAlways}`)
  })

  // ---- PlayFetchIndex: 滑块手动控制 ----
  fetchSlider.addEventListener('input', () => {
    const idx = parseInt(fetchSlider.value, 10)
    fetchVal.textContent = `${idx} / ${currentSequence.length - 1}`
    progressBar.style.width = `${(idx / (currentSequence.length - 1)) * 100}%`

    if (!isAutoProgress) {
      // 手动模式：滑块直接设置帧
      setFrame(idx)
      currentFrameIndex = idx
      updatePreviewHighlight()
      updateStateDisplay()
    }
  })

  btnAutoProgress.addEventListener('click', () => {
    isAutoProgress = true
    btnAutoProgress.classList.add('active')
    btnFetchManual.classList.remove('active')
    logEvent('切换到自动推进模式')
  })

  btnFetchManual.addEventListener('click', () => {
    isAutoProgress = false
    btnAutoProgress.classList.remove('active')
    btnFetchManual.classList.add('active')
    logEvent('切换到手动控制模式')
  })

  // ---- ReplaceAnim 按钮 ----
  function makeReplaceHandler(seqName: string): (e: MouseEvent) => void {
    return () => {
      switchSequence(seqName)
      // 更新按钮高亮
      ;[btnCurrentSeq, btnReplaceAttack, btnReplaceIdle, btnReplaceDeploy].forEach(b => b.classList.remove('active'))
      const targetBtn = [btnCurrentSeq, btnReplaceAttack, btnReplaceIdle, btnReplaceDeploy]
        .find(b => b.textContent?.includes(seqName))
      if (targetBtn) targetBtn.classList.add('active')
    }
  }

  btnReplaceAttack.addEventListener('click', makeReplaceHandler('attack'))
  btnReplaceIdle.addEventListener('click', makeReplaceHandler('idle'))
  btnReplaceDeploy.addEventListener('click', makeReplaceHandler('deploy'))

  // 点击当前序列名 = 回到 walk
  btnCurrentSeq.addEventListener('click', makeReplaceHandler('walk'))

  // ---- 清空日志 ----
  btnClearLog.addEventListener('click', () => {
    const logEl = document.getElementById('event-log')!
    logEl.textContent = '(等待操作...)'
    eventLogCount = 0
  })

  // ---- 初始化 ----
  const initFrames = allFrames.get(currentSequence.name)!
  buildPreviewStrip(initFrames)
  setFrame(0)
  updatePreviewHighlight()
  updateStateDisplay()
  logEvent('初始化完成: PlayFetchIndex 模式, walk 序列, tickAlways=true')

  // ---- 渲染循环 ----
  let autoProgressAccum = 0
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime()

    switch (activePlayMode) {
      case 'fetchIndex':
        if (tickAlways) {
          // PlayFetchIndex: tickAlways=true, 每 tick 调用外部函数
          // 自动模式：2 帧/秒 推进
          if (isAutoProgress) {
            autoProgressAccum += dt
            const autoInterval = 500 // ms per frame (2 fps)
            while (autoProgressAccum >= autoInterval) {
              autoProgressAccum -= autoInterval
              const next = (currentFrameIndex + 1) % currentSequence.length
              currentFrameIndex = next
              setFrame(next)
              fetchSlider.value = String(next)
              fetchVal.textContent = `${next} / ${currentSequence.length - 1}`
              progressBar.style.width = `${(next / (currentSequence.length - 1)) * 100}%`
              totalTicks++
            }
          }
        }
        break

      case 'replaceAnim':
        // 正常 tick 累积模式（动画循环）
        timeUntilNextFrame -= dt
        while (timeUntilNextFrame <= 0) {
          timeUntilNextFrame += currentSequence.tick
          const next = (currentFrameIndex + 1) % currentSequence.length
          currentFrameIndex = next
          setFrame(next)
          totalTicks++
        }
        break

      case 'random':
        // GetRandomExistingSequence 演示
        // 无自动行为，手动通过按钮触发
        break
    }

    updatePreviewHighlight()
    updateStateDisplay()

    scene.render()

    // FPS tracking
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

  logEvent('渲染循环已启动')
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
