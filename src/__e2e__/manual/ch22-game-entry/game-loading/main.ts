/**
 * main.ts — 游戏加载管线人工验收测试
 *
 * 测试目标:
 *   1. 模拟 Game.create() 的 8 阶段加载流水线，验证每阶段的进度/文字/时序
 *   2. 模拟 Engine + Renderer 初始化（纯 DOM 模拟，无 WebGL 依赖）
 *   3. 验证 mod.json fetch → Manifest → FileSystem → ModData.init() 加载序列
 *   4. 验证 Shellmap Phase 1 回退背景色 (clearColor: #0d0d1a)
 *   5. 验证 dispose() 逆序清理全部 6 个子系统
 *   6. 验证错误处理（Nonexistent mod → HTTP 404 → 红色错误状态）
 *
 * OpenRA 对照: Game.ts — create(), initializeEngine(), loadMod(), loadShellMap(), dispose()
 *              ModSelector.ts — launchMod() 中的加载进度条
 *              GameState enum — Uninitialized → LoadingMod → Shellmap → Playing → Disposed
 *
 * 设计说明:
 *   本测试页不导入任何游戏引擎代码（避免 Babylon.js WebGL 依赖），而是完整模拟
 *   Game.create() 的加载流水线。每个阶段对应 Game.ts 中的一个方法调用，进度百分比、
 *   加载文字、时序均与真实管线一致。
 */

// ---------------------------------------------------------------------------
// Types — mirrors GameState from Game.ts
// ---------------------------------------------------------------------------

const GameState = {
  Uninitialized: 'Uninitialized',
  LoadingMod: 'LoadingMod',
  Shellmap: 'Shellmap',
  Playing: 'Playing',
  Disposed: 'Disposed',
} as const
type GameState = (typeof GameState)[keyof typeof GameState]

// ---------------------------------------------------------------------------
// Pipeline Stage Definition — mirrors Game.create() sequence exactly
// ---------------------------------------------------------------------------

interface PipelineStage {
  /** Stage index (0-based) */
  index: number
  /** Human-readable stage name */
  name: string
  /** Loading text shown to user */
  loadingText: string
  /** Progress percentage at start of this stage */
  progressPct: number
  /** Corresponding Game.ts method / action */
  codeAction: string
  /** Detail text for the log panel */
  detail: string
  /** GameState after this stage completes */
  resultingState: GameState
}

/**
 * All 8 stages mirroring Game.create() pipeline:
 *
 *   Game.create(canvas, modId, worldType):
 *     1. initializeEngine(canvas) → Engine + Renderer + startGameLoop
 *     2. loadMod(modId):
 *        a. fetch mod.json → parse JSON → new Manifest()
 *        b. new FileSystem(); for each mount path → fs.mount()
 *        c. new ModData(manifest, fileSystem); modData.init()
 *        d. modData.loadRuleSet()
 *        e. new EchoConnection(); new OrderManager(connection)
 *     3. loadShellMap() → worldScene.clearColor = Color4(0.05, 0.05, 0.1, 1.0)
 */
const PIPELINE_STAGES: PipelineStage[] = [
  {
    index: 0,
    name: 'Initialize Engine',
    loadingText: 'Loading engine...',
    progressPct: 15,
    codeAction: 'new Renderer(canvas); startGameLoop()',
    detail: '创建 Babylon.js Engine + Scene + Camera; 启动 runRenderLoop',
    resultingState: GameState.LoadingMod,
  },
  {
    index: 1,
    name: 'Load Manifest',
    loadingText: 'Loading mod manifest...',
    progressPct: 25,
    codeAction: 'fetch(mod.json) → new Manifest()',
    detail: '解析 mod.json → Metadata, RequiresMods, FileSystem mounts, Rules, etc.',
    resultingState: GameState.LoadingMod,
  },
  {
    index: 2,
    name: 'Mount FileSystem',
    loadingText: 'Mounting filesystem...',
    progressPct: 35,
    codeAction: 'new FileSystem(); fs.mount(path) × N',
    detail: '为每个 Manifest.mounts 路径调用 fs.mount(); 可选路径静默跳过',
    resultingState: GameState.LoadingMod,
  },
  {
    index: 3,
    name: 'Init ModData',
    loadingText: 'Initializing ModData...',
    progressPct: 50,
    codeAction: 'new ModData(manifest, fs); modData.init()',
    detail: '验证 RequiresMods 依赖; 挂载 FileSystem 路径; 创建 ObjectCreator',
    resultingState: GameState.LoadingMod,
  },
  {
    index: 4,
    name: 'Load RuleSet',
    loadingText: 'Loading rule set...',
    progressPct: 65,
    codeAction: 'modData.loadRuleSet()',
    detail: '加载 Rules/Weapons/Sequences/TileSets 规则; 解析 YAML→JSON',
    resultingState: GameState.LoadingMod,
  },
  {
    index: 5,
    name: 'Create OrderManager',
    loadingText: 'Creating OrderManager...',
    progressPct: 75,
    codeAction: 'new EchoConnection(); new OrderManager()',
    detail: '创建本地 EchoConnection; OrderManager 绑定连接+本地帧计数器',
    resultingState: GameState.Shellmap,
  },
  {
    index: 6,
    name: 'Load Shellmap',
    loadingText: 'Loading shellmap...',
    progressPct: 90,
    codeAction: 'worldScene.clearColor = Color4(0.05,0.05,0.1,1.0)',
    detail: 'Phase 1 回退: 深色背景 #0d0d1a; Phase 2 预渲染图像; Phase 3 完整 AI',
    resultingState: GameState.Shellmap,
  },
  {
    index: 7,
    name: 'Ready',
    loadingText: 'Ready',
    progressPct: 100,
    codeAction: '(shellmap 运行中)',
    detail: 'Shellmap 就绪; 主菜单 Widget 待 Phase C 实现; Game.state = Shellmap',
    resultingState: GameState.Shellmap,
  },
]

// ---------------------------------------------------------------------------
// Dispose Sequence — reverse of creation order (mirrors Game.dispose())
// ---------------------------------------------------------------------------

interface DisposeStep {
  order: number
  subsystem: string
  fieldName: string
  detail: string
}

const DISPOSE_SEQUENCE: DisposeStep[] = [
  { order: 1, subsystem: 'World', fieldName: 'this._world', detail: 'dispose() → stop ticks + dispose actors → null' },
  { order: 2, subsystem: 'WorldRenderer', fieldName: 'this._worldRenderer', detail: 'Scene 由 Renderer 管理; 仅清除引用 → null' },
  { order: 3, subsystem: 'OrderManager', fieldName: 'this.orderManager', detail: 'dispose() → close connection + clear queues → null' },
  { order: 4, subsystem: 'Sound', fieldName: 'this.sound', detail: 'stub (Phase C); → null' },
  { order: 5, subsystem: 'ModData', fieldName: 'this.modData', detail: 'dispose() → unload screen + MapCache + FileSystem + ObjectCreator → null' },
  { order: 6, subsystem: 'Renderer', fieldName: 'this.renderer', detail: 'dispose() → stopRenderLoop + Engine.dispose + Scenes + Cameras + RTT → null' },
]

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const shellmapPreview = document.getElementById('shellmap-preview')!
const loadingSim = document.getElementById('loading-sim')!
const simLoadingBar = document.getElementById('sim-loading-bar')!
const simLoadingText = document.getElementById('sim-loading-text')!
const simLoadingSubtext = document.getElementById('sim-loading-subtext')!
const shellmapColorVal = document.getElementById('shellmap-color-val')!
const detailLog = document.getElementById('detail-log')!

const disposeOverlay = document.getElementById('dispose-overlay')!
const disposeList = document.getElementById('dispose-list')!

const modSelect = document.getElementById('mod-select') as HTMLSelectElement
const btnStart = document.getElementById('btn-start') as HTMLButtonElement
const btnStep = document.getElementById('btn-step') as HTMLButtonElement
const btnDispose = document.getElementById('btn-dispose') as HTMLButtonElement
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoTime = document.getElementById('info-time')!

const stateStage = document.getElementById('state-stage')!
const stateProgress = document.getElementById('state-progress')!
const stateStatus = document.getElementById('state-status')!
const stateModid = document.getElementById('state-modid')!
const stateElapsed = document.getElementById('state-elapsed')!

const chkStages = document.getElementById('chk-stages')!
const chkShellmapBg = document.getElementById('chk-shellmap-bg')!
const chkProgressFinal = document.getElementById('chk-progress-final')!
const chkDispose = document.getElementById('chk-dispose')!
const chkErrorMode = document.getElementById('chk-error-mode')!

// Stage dots
const stageDots = document.querySelectorAll('.stage-dot') as NodeListOf<HTMLElement>
const stageConnectors = document.querySelectorAll('.stage-connector') as NodeListOf<HTMLElement>

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentStage = -1
let pipelineState: GameState = GameState.Uninitialized
let startTime = 0
let disposedCount = 0
let _errorTriggered = false

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()
}

window.addEventListener('resize', updateInfoBar)
updateInfoBar()

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(stage: string, message: string, className: 'warn' | 'error' | 'ok' | '' = ''): void {
  const now = new Date()
  const ts = now.toTimeString().slice(0, 8)
  const entry = document.createElement('div')
  entry.className = 'entry'
  entry.innerHTML = `<span class="ts">${ts}</span><span class="stage">[${stage}]</span><span class="msg${className ? ` ${className}` : ''}">${message}</span>`
  detailLog.insertBefore(entry, detailLog.firstChild)
}

// ---------------------------------------------------------------------------
// Pipeline Execution
// ---------------------------------------------------------------------------

function resetAll(): void {
  currentStage = -1
  pipelineState = GameState.Uninitialized
  disposedCount = 0
  _errorTriggered = false
  startTime = 0

  // Reset stage dots
  stageDots.forEach(d => { d.className = 'stage-dot' })
  stageConnectors.forEach(c => { c.className = 'stage-connector' })

  // Reset progress bar
  simLoadingBar.style.width = '0%'
  simLoadingBar.classList.remove('error')
  simLoadingText.textContent = '等待启动...'
  simLoadingSubtext.textContent = ''

  // Reset shellmap preview
  shellmapPreview.classList.remove('loaded')
  shellmapPreview.style.backgroundColor = '#0d1117'
  shellmapColorVal.textContent = '-'

  // Reset loading overlay
  loadingSim.classList.remove('hidden')

  // Reset dispose overlay
  disposeOverlay.classList.remove('visible')
  disposeList.innerHTML = ''

  // Reset state panel
  stateStage.textContent = '-'
  stateProgress.textContent = '0%'
  stateStatus.textContent = 'IDLE'
  stateModid.textContent = modSelect.value
  stateElapsed.textContent = '0ms'

  // Reset checks
  chkStages.className = 'check-indicator'
  chkShellmapBg.className = 'check-indicator'
  chkProgressFinal.className = 'check-indicator'
  chkDispose.className = 'check-indicator'
  chkErrorMode.className = 'check-indicator'

  // Clear log (keep header)
  detailLog.innerHTML = '<div class="entry"><span class="ts">--:--:--</span><span class="stage">[init]</span><span class="msg">准备就绪，等待加载指令...</span></div>'

  // Enable buttons
  btnStart.disabled = false
  btnStep.disabled = false
  btnDispose.disabled = true

  log('reset', '所有状态已重置')
}

/**
 * Advance to the next pipeline stage.
 * Returns true if there are more stages, false if all done.
 */
function advanceStage(): boolean {
  const nextIndex = currentStage + 1
  if (nextIndex >= PIPELINE_STAGES.length) return false

  const stage = PIPELINE_STAGES[nextIndex]
  currentStage = nextIndex
  pipelineState = stage.resultingState

  // Update stage dot
  const dot = stageDots[nextIndex]
  if (dot) {
    dot.classList.add('active')
    dot.classList.remove('done')
  }
  // Mark previous connector as done
  if (nextIndex > 0) {
    const conn = stageConnectors[nextIndex - 1]
    if (conn) conn.classList.add('done')
  }

  // Update progress bar
  const pct = stage.progressPct
  simLoadingBar.style.width = `${pct}%`
  simLoadingText.textContent = stage.loadingText
  simLoadingSubtext.textContent = stage.codeAction

  // Update state panel
  stateStage.textContent = `${stage.index + 1}/8: ${stage.name}`
  stateProgress.textContent = `${pct}%`
  stateStatus.textContent = stage.resultingState

  // Shellmap background on stage 6 (Load Shellmap) or 7 (Ready)
  if (nextIndex >= 6) {
    shellmapPreview.classList.add('loaded')
    shellmapPreview.style.backgroundColor = '#0d0d1a'
    shellmapColorVal.textContent = 'rgb(13,13,26) #0d0d1a | Color4(0.05, 0.05, 0.1, 1.0)'
  }

  // Hide loading overlay on final stage
  if (nextIndex === 7) {
    setTimeout(() => {
      loadingSim.classList.add('hidden')
    }, 300)
  }

  // Log
  log(stage.name, stage.detail)

  // Tick elapsed
  if (startTime > 0) {
    stateElapsed.textContent = `${Date.now() - startTime}ms`
  }

  return nextIndex < PIPELINE_STAGES.length - 1
}

/**
 * Execute the full pipeline with timed delays (simulating real loading).
 */
async function runFullPipeline(modId: string): Promise<void> {
  if (currentStage >= 0) {
    log('warn', 'Pipeline 已启动，请先点击 Reset', 'warn')
    return
  }

  startTime = Date.now()
  stateModid.textContent = modId
  log('start', `Game.create(canvas, '${modId}', WorldType.Regular) — 开始...`)

  // Simulate fetch for nonexistent mod
  if (modId === 'NONEXISTENT') {
    // Simulate HTTP 404 after stage 0
    advanceStage() // Stage 0: Initialize Engine (succeeds)
    simLoadingBar.style.width = '15%'
    await delay(150)

    // Simulate fetch failure
    _errorTriggered = true
    simLoadingBar.style.width = '25%'
    simLoadingBar.classList.add('error')
    simLoadingText.textContent = "Error: Failed to load mod 'NONEXISTENT': HTTP 404"
    simLoadingSubtext.textContent = 'fetch(\'/mods/NONEXISTENT/mod.json\') → 404 Not Found'
    stateStatus.textContent = 'ERROR'
    stateStage.textContent = 'FAILED: Load Manifest'
    stateProgress.textContent = '25%'
    stateElapsed.textContent = `${Date.now() - startTime}ms`
    log('ERROR', "Failed to load mod 'NONEXISTENT': HTTP 404", 'error')
    log('error', 'ModSelector.launchMod() 将在 3s 后自动 hide() 返回选择器', 'warn')

    runAutoChecks()
    btnDispose.disabled = true
    return
  }

  // Run all 8 stages with timed delays
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const hasMore = advanceStage()
    stateElapsed.textContent = `${Date.now() - startTime}ms`

    if (hasMore) {
      // Varying delays to simulate real loading times
      const delays = [200, 300, 200, 250, 300, 200, 350, 0]
      await delay(delays[i] || 200)
    }
  }

  stateStatus.textContent = GameState.Shellmap
  stateElapsed.textContent = `${Date.now() - startTime}ms`
  log('ready', 'Game.create() 完成! Shellmap 运行中（Phase 1 静态背景）', 'ok')

  // Mark all dots as done
  stageDots.forEach((d, i) => {
    if (i <= currentStage) {
      d.classList.add('done')
      d.classList.remove('active')
    }
  })

  btnDispose.disabled = false
  runAutoChecks()
}

// ---------------------------------------------------------------------------
// Step Mode
// ---------------------------------------------------------------------------

function stepPipeline(): void {
  if (disposedCount > 0) {
    log('warn', '已 Dispose，请先 Reset', 'warn')
    return
  }

  if (startTime === 0) {
    startTime = Date.now()
    stateModid.textContent = modSelect.value
    log('start', `Game.create(canvas, '${modSelect.value}', WorldType.Regular) — Step 模式`)
  }

  const hasMore = advanceStage()
  stateElapsed.textContent = `${Date.now() - startTime}ms`

  if (!hasMore) {
    // All stages done
    stateStatus.textContent = GameState.Shellmap
    stageDots.forEach((d, i) => {
      if (i <= currentStage) {
        d.classList.add('done')
        d.classList.remove('active')
      }
    })
    log('ready', '所有 8 阶段完成! Shellmap 就绪', 'ok')
    btnDispose.disabled = false
    btnStep.disabled = true
    runAutoChecks()
  }
}

// ---------------------------------------------------------------------------
// Dispose Simulation
// ---------------------------------------------------------------------------

async function simulateDispose(): Promise<void> {
  if (disposedCount > 0) {
    log('warn', '已经 Dispose，请先 Reset', 'warn')
    return
  }

  pipelineState = GameState.Disposed
  stateStatus.textContent = 'DISPOSING...'
  disposeOverlay.classList.add('visible')
  disposeList.innerHTML = ''

  log('dispose', 'Game.dispose() — 逆序销毁所有子系统', 'warn')

  for (const step of DISPOSE_SEQUENCE) {
    await delay(80) // 80ms per subsystem = ~480ms total

    disposedCount++
    const item = document.createElement('div')
    item.className = 'item'
    item.textContent = `⊗ ${step.subsystem} (${step.fieldName})`
    disposeList.appendChild(item)

    // Animate: mark as done after a short delay
    setTimeout(() => {
      item.classList.add('done')
      item.textContent = `✓ ${step.subsystem} — disposed`
    }, 40)

    log('dispose', `${step.order}. ${step.subsystem}: ${step.detail}`)
  }

  // Final cleanup: clear singleton reference
  await delay(100)
  log('dispose', '7. _currentGame = null（清除单例引用）', 'ok')
  log('dispose', 'Game.state = Disposed; runRenderLoop 守卫停止所有 tick', 'ok')

  pipelineState = GameState.Disposed
  stateStatus.textContent = 'DISPOSED'
  stateElapsed.textContent = `${Date.now() - startTime}ms`

  // Hide shellmap
  shellmapPreview.classList.remove('loaded')
  shellmapPreview.style.backgroundColor = '#1a0a0a'
  shellmapColorVal.textContent = 'DISPOSED'

  btnDispose.disabled = true
  btnStart.disabled = true
  btnStep.disabled = true

  runAutoChecks()
}

// ---------------------------------------------------------------------------
// Auto-checks
// ---------------------------------------------------------------------------

function runAutoChecks(): void {
  // Check 1: All 8 stages completed
  if (currentStage === 7 && _errorTriggered === false) {
    chkStages.className = 'check-indicator pass'
    log('check', 'PASS: 8/8 阶段全部完成', 'ok')
  } else if (_errorTriggered) {
    chkStages.className = 'check-indicator fail'
  }

  // Check 2: Shellmap background color
  const bgColor = getComputedStyle(shellmapPreview).backgroundColor
  if (bgColor === 'rgb(13, 13, 26)' || bgColor === '#0d0d1a') {
    chkShellmapBg.className = 'check-indicator pass'
    log('check', `PASS: Shellmap 背景 = ${bgColor} (Color4: 0.05, 0.05, 0.1)`, 'ok')
  } else if (currentStage >= 6) {
    chkShellmapBg.className = 'check-indicator fail'
    log('check', `FAIL: Shellmap 背景 = ${bgColor} (预期 rgb(13,13,26))`, 'error')
  }

  // Check 3: Progress bar at 100%
  if (simLoadingBar.style.width === '100%') {
    chkProgressFinal.className = 'check-indicator pass'
    log('check', 'PASS: 进度条达到 100%', 'ok')
  }

  // Check 4: All 6 subsystems disposed
  if (disposedCount === 6) {
    chkDispose.className = 'check-indicator pass'
    log('check', 'PASS: 6/6 子系统已销毁', 'ok')
  }

  // Check 5: Error mode triggered
  if (_errorTriggered) {
    chkErrorMode.className = 'check-indicator pass'
    log('check', 'PASS: 错误模式已触发 (Nonexistent mod)', 'ok')
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

btnStart.addEventListener('click', () => {
  if (currentStage >= 0 && disposedCount === 0) {
    log('warn', 'Pipeline 运行中，请先 Reset', 'warn')
    return
  }
  if (disposedCount > 0) {
    log('warn', '已 Dispose，请先 Reset', 'warn')
    return
  }
  const modId = modSelect.value
  btnStart.disabled = true
  btnStep.disabled = true
  btnDispose.disabled = true
  runFullPipeline(modId)
})

btnStep.addEventListener('click', () => {
  stepPipeline()
})

btnDispose.addEventListener('click', () => {
  simulateDispose()
})

btnReset.addEventListener('click', () => {
  resetAll()
})

// Mod select changes reset state
modSelect.addEventListener('change', () => {
  resetAll()
  stateModid.textContent = modSelect.value
})

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (document.activeElement !== document.body) return
  switch (e.key.toLowerCase()) {
    case 's':
      resetAll()
      btnStart.disabled = true
      btnStep.disabled = true
      runFullPipeline(modSelect.value)
      break
    case 'n':
      stepPipeline()
      break
    case 'd':
      if (!btnDispose.disabled) simulateDispose()
      break
    case 'r':
      resetAll()
      break
  }
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  getCurrentStage: () => currentStage,
  getPipelineState: () => pipelineState,
  getProgressPct: () => simLoadingBar.style.width,
  getShellmapBg: () => getComputedStyle(shellmapPreview).backgroundColor,
  getDisposedCount: () => disposedCount,
  getErrorTriggered: () => _errorTriggered,
  start: (modId?: string) => {
    resetAll()
    if (modId) {
      modSelect.value = modId
      stateModid.textContent = modId
    }
    btnStart.disabled = true
    btnStep.disabled = true
    runFullPipeline(modSelect.value)
  },
  step: () => stepPipeline(),
  dispose: () => simulateDispose(),
  reset: () => resetAll(),
  getLogEntries: () => detailLog.querySelectorAll('.entry'),
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

resetAll()
stateModid.textContent = modSelect.value
log('init', '测试页已就绪。快捷键: S=自动加载, N=单步, D=Dispose, R=重置')

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
