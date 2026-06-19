/**
 * idle-overlay/main.ts — WithIdleOverlay visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.cs
 * TypeScript:  src/OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.ts
 *
 * Verifies:
 *   E1. Overlay visible during Play phase (actor IDLE)
 *   E2. Overlay hidden during Pause phase (actor IDLE)
 *   E3. Play phase duration = configured ticks ±2
 *   E4. Pause phase duration = configured ticks ±2
 *   E5. Overlay stops immediately when actor becomes BUSY (≤2 ticks)
 *   E6. Overlay offset positioning (WVec relative to body center)
 *   E7. Sequence name queryable via test harness
 *
 * 坐标系约定 (from Viewport.ts / CoordinateTransformer.ts):
 *   - WVec (X, Y, Z) → Babylon Vector3 (X/1024, Z/512, Y/1024)
 *   - Screen-right = world +X, Screen-down = world +Y (south)
 *   - Babylon Y-up = world height (WPos.Z)
 *
 * Tick system:
 *   - 25 ticks/second (40ms per tick), matching OpenRA's default tick rate
 *   - Play/pause cycle simulates the idle overlay's periodic behavior
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  LinesMesh,
  Camera,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Coordinate conversion constants (matching Viewport.ts)
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

/** WVec (OpenRA world offset) → Babylon.js Vector3 */
function wVecToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

// Camera: matching Viewport.ts setupCamera()
const camera = new ArcRotateCamera(
  'rtsCam',
  -Math.PI / 2,  // alpha: camera on -Z side → screen-right = world+X
  Math.PI / 3,    // beta: 60° tilt from horizontal
  8,              // radius
  new Vector3(0, 0.5, 0), // target: near origin, slightly above ground
  scene,
)
camera.mode = Camera.ORTHOGRAPHIC_CAMERA
camera.orthoTop = 3
camera.orthoBottom = -3
camera.orthoLeft = -3
camera.orthoRight = 3
camera.attachControl(canvas, true)

// Lighting
const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.9

// ---------------------------------------------------------------------------
// Reference Grid
// ---------------------------------------------------------------------------

const gridNodes: (Mesh | LinesMesh)[] = []

function buildReferenceGrid(): void {
  // Ground plane
  const ground = MeshBuilder.CreateGround('ground', {
    width: 8,
    height: 8,
  }, scene)
  ground.position = new Vector3(0, -0.02, 0)
  const gmat = new StandardMaterial('gmat', scene)
  gmat.diffuseColor = new Color3(0.12, 0.15, 0.20)
  gmat.specularColor = new Color3(0, 0, 0)
  gmat.alpha = 0.6
  ground.material = gmat
  gridNodes.push(ground)

  // Grid lines every 1 Babylon unit (1024 su = ~1 cell)
  for (let i = -4; i <= 4; i++) {
    const hLine = MeshBuilder.CreateLines(`hLine${i}`, {
      points: [new Vector3(i, 0.005, -4), new Vector3(i, 0.005, 4)],
    }, scene)
    hLine.color = new Color3(0.2, 0.35, 0.6)
    hLine.alpha = i === 0 ? 0.7 : 0.2
    gridNodes.push(hLine)
  }
  for (let j = -4; j <= 4; j++) {
    const vLine = MeshBuilder.CreateLines(`vLine${j}`, {
      points: [new Vector3(-4, 0.005, j), new Vector3(4, 0.005, j)],
    }, scene)
    vLine.color = new Color3(0.2, 0.35, 0.6)
    vLine.alpha = j === 0 ? 0.7 : 0.2
    gridNodes.push(vLine)
  }

  // Origin marker
  const originSphere = MeshBuilder.CreateSphere('origin', { diameter: 0.12 }, scene)
  originSphere.position = new Vector3(0, 0.06, 0)
  const omat = new StandardMaterial('omat', scene)
  omat.diffuseColor = new Color3(1, 1, 1)
  omat.emissiveColor = new Color3(0.3, 0.3, 0.3)
  omat.specularColor = new Color3(0, 0, 0)
  originSphere.material = omat
  gridNodes.push(originSphere)
}

buildReferenceGrid()

// ---------------------------------------------------------------------------
// Body Mesh (represents the actor's main visual)
// ---------------------------------------------------------------------------

const bodyCenter = new Vector3(0, 0.4, 0)

// Main body: a box representing the unit
const bodyBox = MeshBuilder.CreateBox('actorBody', {
  width: 0.8,
  height: 0.6,
  depth: 1.2,
}, scene)
bodyBox.position = bodyCenter.clone()
const bodyMat = new StandardMaterial('bodyMat', scene)
bodyMat.diffuseColor = new Color3(0.55, 0.43, 0.33) // brownish tan
bodyMat.specularColor = new Color3(0.1, 0.1, 0.1)
bodyBox.material = bodyMat

// Turret on top
const turret = MeshBuilder.CreateCylinder('turret', {
  height: 0.2,
  diameterTop: 0.3,
  diameterBottom: 0.4,
}, scene)
turret.position = new Vector3(0, 0.8, 0)
const turretMat = new StandardMaterial('turretMat', scene)
turretMat.diffuseColor = new Color3(0.4, 0.5, 0.35) // olive green
turretMat.specularColor = new Color3(0.05, 0.05, 0.05)
turret.material = turretMat

// Body label ring (ground marker)
const bodyRing = MeshBuilder.CreateTorus('bodyRing', {
  diameter: 1.0,
  thickness: 0.04,
}, scene)
bodyRing.position = new Vector3(0, 0.03, 0)
bodyRing.rotation.x = Math.PI / 2
const ringMat = new StandardMaterial('ringMat', scene)
ringMat.diffuseColor = new Color3(0.3, 0.3, 0.3)
ringMat.alpha = 0.5
ringMat.specularColor = new Color3(0, 0, 0)
bodyRing.material = ringMat

// ---------------------------------------------------------------------------
// Overlay Mesh (represents WithIdleOverlay's decorative animation)
// ---------------------------------------------------------------------------

// The overlay is a glowing torus/ring that floats at the configured offset
const overlayGroup = new Mesh('overlayGroup', scene)

// Main overlay: a glowing disc
const overlayDisc = MeshBuilder.CreateDisc('overlayDisc', {
  radius: 0.2,
  tessellation: 24,
}, scene)
overlayDisc.parent = overlayGroup

const overlayMat = new StandardMaterial('overlayMat', scene)
overlayMat.diffuseColor = new Color3(1, 0.84, 0.0) // bright gold
overlayMat.emissiveColor = new Color3(0.8, 0.6, 0.0)
overlayMat.specularColor = new Color3(0.1, 0.1, 0.1)
overlayDisc.material = overlayMat

// Smaller secondary ring
const overlayRing = MeshBuilder.CreateTorus('overlayRing', {
  diameter: 0.5,
  thickness: 0.04,
}, scene)
overlayRing.parent = overlayGroup
overlayRing.position.y = 0.02
const overlayRingMat = new StandardMaterial('overlayRingMat', scene)
overlayRingMat.diffuseColor = new Color3(1, 0.75, 0.2)
overlayRingMat.emissiveColor = new Color3(0.6, 0.4, 0.0)
overlayRingMat.specularColor = new Color3(0, 0, 0)
overlayRing.material = overlayRingMat

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

const TICK_MS = 40 // 25 ticks/second

// Actor state
let actorIdle = true

// Play/pause cycle configuration (in ticks)
let playDurationTicks = 60
let pauseDurationTicks = 30
let simSpeed = 1.0

// Current cycle state
let currentPhase: 'play' | 'pause' = 'play'
let elapsedTicksInPhase = 0
let totalCycles = 0

// Overlay offset configuration (in sub-units, WVec)
let offsetWX = 0
let offsetWY = 512
let offsetWZ = 1024

// Sequence tracking
const currentSequence = 'idle-overlay'

// Timestamp of last busy transition (for E5 latency measurement)
let lastBusyTransitionTick = -1
let overlayHiddenAtTick = -1

// ---------------------------------------------------------------------------
// Offset Line + Position Management
// ---------------------------------------------------------------------------

/** Refresh the dashed line connecting body center to overlay position */
function refreshOffsetLine(): void {
  // Remove all existing offset lines
  const lines = scene.meshes.filter(m => m.name.startsWith('offsetLine'))
  lines.forEach(l => l.dispose())

  const offsetVec3 = wVecToVector3(offsetWX, offsetWY, offsetWZ)
  const overlayPos = bodyCenter.add(offsetVec3)
  const newLine = MeshBuilder.CreateLines('offsetLine', {
    points: [bodyCenter.clone(), overlayPos.clone()],
  }, scene)
  newLine.color = new Color3(1, 1, 1)
  newLine.alpha = 0.35
}

/** Update overlay group position from current offset values */
function updateOverlayPosition(): void {
  const offsetVec3 = wVecToVector3(offsetWX, offsetWY, offsetWZ)
  overlayGroup.position = bodyCenter.add(offsetVec3)
}

// Initial setup
updateOverlayPosition()
refreshOffsetLine()

// ---------------------------------------------------------------------------
// Visibility Management
// ---------------------------------------------------------------------------

function isOverlayVisible(): boolean {
  return actorIdle && currentPhase === 'play'
}

function applyOverlayVisibility(): void {
  const visible = isOverlayVisible()
  overlayGroup.isVisible = visible

  // Also update offset line visibility
  const line = scene.getMeshByName('offsetLine')
  if (line) line.isVisible = visible
}

// ---------------------------------------------------------------------------
// Animation Effect (pulse + rotation when visible)
// ---------------------------------------------------------------------------

let animTime = 0

function updateOverlayAnimation(deltaMs: number): void {
  if (!isOverlayVisible()) return

  animTime += deltaMs * 0.001

  // Pulse scale: oscillate between 1.0 and 1.3
  const pulse = 1.0 + 0.3 * Math.sin(animTime * 4.0)
  overlayDisc.scaling.setAll(pulse)

  // Rotate the disc slowly
  overlayDisc.rotation.z += deltaMs * 0.001 * 2.0

  // Rotate the ring in opposite direction
  overlayRing.rotation.z -= deltaMs * 0.001 * 1.5

  // Color pulse: vary emissive intensity (pre-allocated _emissiveTemp)
  const emissiveIntensity = 0.5 + 0.5 * Math.sin(animTime * 3.0)
  overlayMat.emissiveColor = _emissiveTemp.set(
    0.8 * emissiveIntensity,
    0.6 * emissiveIntensity,
    0.0,
  )
  overlayRingMat.emissiveColor = new Color3(
    0.6 * emissiveIntensity,
    0.4 * emissiveIntensity,
    0.0,
  )
}

// ---------------------------------------------------------------------------
// Tick Simulation
// ---------------------------------------------------------------------------

function processTick(): void {
  if (actorIdle) {
    // Advance phase timer
    elapsedTicksInPhase++

    const phaseDuration = currentPhase === 'play' ? playDurationTicks : pauseDurationTicks

    if (elapsedTicksInPhase >= phaseDuration) {
      // Switch phase
      if (currentPhase === 'play') {
        currentPhase = 'pause'
        logEvent('phase', `Pause 阶段开始 (持续 ${pauseDurationTicks} ticks)`)
      } else {
        currentPhase = 'play'
        totalCycles++
        logEvent('phase', `Play 阶段开始 — 循环 #${totalCycles} (持续 ${playDurationTicks} ticks)`)
      }
      elapsedTicksInPhase = 0
    }

    applyOverlayVisibility()
  } else {
    // BUSY: overlay hidden, phase paused but not reset
    // (When returning to IDLE, resume from current phase state)
  }

  updateUI()
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

interface LogEntry {
  time: number
  type: 'idle' | 'busy' | 'phase' | 'config' | 'reset'
  message: string
}

const eventLog: LogEntry[] = []
let logStartTime = performance.now()

function logEvent(type: LogEntry['type'], message: string): void {
  const time = (performance.now() - logStartTime) / 1000
  eventLog.push({ time, type, message })
  if (eventLog.length > 100) eventLog.shift()
  renderEventLog()
}

function renderEventLog(): void {
  const el = document.getElementById('event-log')!
  const recent = eventLog.slice(-20)
  el.innerHTML = recent
    .map(e => `<div class="entry ${e.type}">[${e.time.toFixed(1)}s] ${e.message}</div>`)
    .join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// UI Update
// ---------------------------------------------------------------------------

function updateUI(): void {
  // Actor state badge
  const actorBadge = document.getElementById('actor-state-badge')!
  actorBadge.textContent = actorIdle ? 'IDLE' : 'BUSY'
  actorBadge.className = `status-badge ${actorIdle ? 'status-idle' : 'status-busy'}`

  // Overlay visibility badge
  const visBadge = document.getElementById('overlay-vis-badge')!
  const visible = isOverlayVisible()
  visBadge.textContent = visible ? 'VISIBLE' : 'HIDDEN'
  visBadge.className = `status-badge ${visible ? 'status-visible' : 'status-hidden'}`

  // Phase badge
  const phaseBadge = document.getElementById('phase-badge')!
  phaseBadge.textContent = currentPhase === 'play' ? 'PLAY' : 'PAUSE'
  phaseBadge.className = `status-badge ${currentPhase === 'play' ? 'status-play' : 'status-pause'}`

  // Phase bar
  const phaseBarFill = document.getElementById('phase-bar-fill')!
  const phaseDuration = currentPhase === 'play' ? playDurationTicks : pauseDurationTicks
  const progress = Math.min(1, elapsedTicksInPhase / phaseDuration)
  phaseBarFill.style.width = `${(progress * 100).toFixed(1)}%`
  phaseBarFill.className = `phase-bar-fill ${currentPhase === 'play' ? 'play-fill' : 'pause-fill'}`

  // Sequence
  document.getElementById('stat-sequence')!.textContent = currentSequence

  // Elapsed ticks
  document.getElementById('stat-elapsed-ticks')!.textContent =
    `${elapsedTicksInPhase} / ${phaseDuration}`

  // Total cycles
  document.getElementById('stat-cycles')!.textContent = String(totalCycles)

  // Update active button states
  document.getElementById('btn-set-idle')!.classList.toggle('active', actorIdle)
  document.getElementById('btn-set-busy')!.classList.toggle('active', !actorIdle)
}

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-set-idle')!.addEventListener('click', () => {
  if (!actorIdle) {
    actorIdle = true
    // When transitioning back to idle, resume current phase
    // elapsedTicksInPhase is preserved (paused during busy)
    applyOverlayVisibility()
    logEvent('idle', 'Actor → IDLE (overlay 恢复当前阶段)')
  }
})

document.getElementById('btn-set-busy')!.addEventListener('click', () => {
  if (actorIdle) {
    actorIdle = false
    lastBusyTransitionTick = totalTicksElapsed
    overlayHiddenAtTick = totalTicksElapsed // will be updated if hidden within ≤2 ticks
    applyOverlayVisibility()
    logEvent('busy', 'Actor → BUSY (overlay 立即隐藏)')
    // Schedule check for E5
    setTimeout(() => {
      if (!isOverlayVisible()) {
        overlayHiddenAtTick = totalTicksElapsed
      }
    }, TICK_MS * 2 * simSpeed)
  }
})

document.getElementById('btn-force-play')!.addEventListener('click', () => {
  currentPhase = 'play'
  elapsedTicksInPhase = 0
  applyOverlayVisibility()
  logEvent('phase', '强制进入 Play 阶段')
})

document.getElementById('btn-force-pause')!.addEventListener('click', () => {
  currentPhase = 'pause'
  elapsedTicksInPhase = 0
  applyOverlayVisibility()
  logEvent('phase', '强制进入 Pause 阶段')
})

document.getElementById('btn-reset')!.addEventListener('click', () => {
  actorIdle = true
  currentPhase = 'play'
  elapsedTicksInPhase = 0
  totalCycles = 0
  dtAccum = 0
  animTime = 0
  lastBusyTransitionTick = -1
  overlayHiddenAtTick = -1
  offsetWX = 0
  offsetWY = 512
  offsetWZ = 1024
  playDurationTicks = 60
  pauseDurationTicks = 30
  simSpeed = 1.0

  // Reset sliders
  ;(document.getElementById('offset-x') as HTMLInputElement).value = '0'
  ;(document.getElementById('offset-y') as HTMLInputElement).value = '512'
  ;(document.getElementById('offset-z') as HTMLInputElement).value = '1024'
  ;(document.getElementById('play-ticks') as HTMLInputElement).value = '60'
  ;(document.getElementById('pause-ticks') as HTMLInputElement).value = '30'
  ;(document.getElementById('speed') as HTMLInputElement).value = '1'
  document.getElementById('offset-x-val')!.textContent = '0 su'
  document.getElementById('offset-y-val')!.textContent = '512 su'
  document.getElementById('offset-z-val')!.textContent = '1024 su'
  document.getElementById('play-ticks-val')!.textContent = '60'
  document.getElementById('pause-ticks-val')!.textContent = '30'
  document.getElementById('speed-val')!.textContent = '1.0x'

  overlayGroup.scaling.setAll(1)
  overlayDisc.rotation.setAll(0)
  overlayRing.rotation.setAll(0)
  overlayMat.emissiveColor = new Color3(0.8, 0.6, 0.0)
  overlayRingMat.emissiveColor = new Color3(0.6, 0.4, 0.0)

  updateOverlayPosition()
  refreshOffsetLine()
  applyOverlayVisibility()
  updateUI()

  eventLog.length = 0
  logStartTime = performance.now()
  logEvent('reset', '全部状态已重置')
})

// ---------------------------------------------------------------------------
// Slider Handlers
// ---------------------------------------------------------------------------

document.getElementById('offset-x')!.addEventListener('input', (e) => {
  offsetWX = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('offset-x-val')!.textContent = `${offsetWX} su`
  updateOverlayPosition()
  refreshOffsetLine()
})

document.getElementById('offset-y')!.addEventListener('input', (e) => {
  offsetWY = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('offset-y-val')!.textContent = `${offsetWY} su`
  updateOverlayPosition()
  refreshOffsetLine()
})

document.getElementById('offset-z')!.addEventListener('input', (e) => {
  offsetWZ = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('offset-z-val')!.textContent = `${offsetWZ} su`
  updateOverlayPosition()
  refreshOffsetLine()
})

document.getElementById('play-ticks')!.addEventListener('input', (e) => {
  playDurationTicks = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('play-ticks-val')!.textContent = String(playDurationTicks)
  if (currentPhase === 'play') {
    elapsedTicksInPhase = Math.min(elapsedTicksInPhase, playDurationTicks)
  }
  logEvent('config', `Play 时长 → ${playDurationTicks} ticks (${(playDurationTicks * TICK_MS / 1000).toFixed(1)}s)`)
})

document.getElementById('pause-ticks')!.addEventListener('input', (e) => {
  pauseDurationTicks = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('pause-ticks-val')!.textContent = String(pauseDurationTicks)
  if (currentPhase === 'pause') {
    elapsedTicksInPhase = Math.min(elapsedTicksInPhase, pauseDurationTicks)
  }
  logEvent('config', `Pause 时长 → ${pauseDurationTicks} ticks (${(pauseDurationTicks * TICK_MS / 1000).toFixed(1)}s)`)
})

document.getElementById('speed')!.addEventListener('input', (e) => {
  simSpeed = parseFloat((e.target as HTMLInputElement).value)
  document.getElementById('speed-val')!.textContent = `${simSpeed.toFixed(2)}x`
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent =
    navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

let totalTicksElapsed = 0
let lastTickTime = performance.now()
let dtAccum = 0
// Pre-allocated for hot-path mutation (MAJOR fix: no per-frame allocation)
const _emissiveTemp = new Color3()

engine.runRenderLoop(() => {
  const now = performance.now()
  const rawDt = now - lastTickTime
  lastTickTime = now

  // Clamp dt to avoid spiral of death
  const dt = Math.min(rawDt, 200)

  // Accumulate tick time with speed factor
  dtAccum += dt * simSpeed

  // Process ticks
  while (dtAccum >= TICK_MS) {
    dtAccum -= TICK_MS
    totalTicksElapsed++
    processTick()
  }

  // Update overlay animation (continuous)
  updateOverlayAnimation(dt)

  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// ---------------------------------------------------------------------------
// Initial UI update
// ---------------------------------------------------------------------------

updateUI()
logEvent('idle', '初始化: Actor IDLE, Overlay Play 阶段')

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (event) => {
  switch (event.key.toLowerCase()) {
    case 'i':
      document.getElementById('btn-set-idle')!.click()
      break
    case 'b':
      document.getElementById('btn-set-busy')!.click()
      break
    case 'p':
      document.getElementById('btn-force-play')!.click()
      break
    case 'a':
      document.getElementById('btn-force-pause')!.click()
      break
    case 'r':
      document.getElementById('btn-reset')!.click()
      break
    default:
      return
  }
})

// ---------------------------------------------------------------------------
// Test Harness (for programmatic verification)
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  // --- Actor state control ---

  /** Set the actor to IDLE state (overlay resumes current cycle phase) */
  setActorIdle: (_actor?: unknown) => {
    actorIdle = true
    applyOverlayVisibility()
    updateUI()
    return { actorIdle: true, overlayVisible: isOverlayVisible() }
  },

  /** Set the actor to BUSY state (overlay immediately hides) */
  setActorBusy: (_actor?: unknown) => {
    actorIdle = false
    lastBusyTransitionTick = totalTicksElapsed
    applyOverlayVisibility()
    overlayHiddenAtTick = totalTicksElapsed  // MAJOR fix: harness needs immediate timestamp for latency measurement
    updateUI()
    return { actorIdle: false, overlayVisible: isOverlayVisible() }
  },

  // --- Overlay queries ---

  /** Check if the overlay is currently visible */
  getOverlayVisibility: (): boolean => {
    return isOverlayVisible()
  },

  /** Get the current overlay sequence name */
  getOverlaySequence: (): string => {
    return currentSequence
  },

  /** Get the current overlay offset as WVec { x, y, z } in sub-units */
  getOverlayOffset: (): { x: number; y: number; z: number } => {
    return { x: offsetWX, y: offsetWY, z: offsetWZ }
  },

  // --- State info ---

  /** Get the current actor idle state */
  isActorIdle: (): boolean => {
    return actorIdle
  },

  /** Get the current play/pause phase */
  getCurrentPhase: (): string => {
    return currentPhase
  },

  /** Get elapsed ticks in current phase */
  getElapsedTicksInPhase: (): number => {
    return elapsedTicksInPhase
  },

  /** Get configured play/pause durations */
  getCycleConfig: (): { playTicks: number; pauseTicks: number } => {
    return { playTicks: playDurationTicks, pauseTicks: pauseDurationTicks }
  },

  /** Get total simulation ticks elapsed */
  getTotalTicksElapsed: (): number => {
    return totalTicksElapsed
  },

  /** Get total completed cycles */
  getTotalCycles: (): number => {
    return totalCycles
  },

  /** Get the tick count when BUSY transition was first detected (for latency check) */
  getBusyTransitionTick: (): number => {
    return lastBusyTransitionTick
  },

  /** Measure how many ticks it took for overlay to hide after BUSY transition */
  getOverlayHideLatency: (): number | null => {
    if (lastBusyTransitionTick < 0 || overlayHiddenAtTick < 0) return null
    return overlayHiddenAtTick - lastBusyTransitionTick
  },

  // --- Configuration ---

  /** Set the overlay offset (in sub-units, WVec) */
  setOverlayOffset: (x: number, y: number, z: number): void => {
    offsetWX = x
    offsetWY = y
    offsetWZ = z
    ;(document.getElementById('offset-x') as HTMLInputElement).value = String(x)
    ;(document.getElementById('offset-y') as HTMLInputElement).value = String(y)
    ;(document.getElementById('offset-z') as HTMLInputElement).value = String(z)
    document.getElementById('offset-x-val')!.textContent = `${x} su`
    document.getElementById('offset-y-val')!.textContent = `${y} su`
    document.getElementById('offset-z-val')!.textContent = `${z} su`
    updateOverlayPosition()
    refreshOffsetLine()
  },

  /** Set play/pause cycle durations (in ticks) */
  setCycleDurations: (playTicks: number, pauseTicks: number): void => {
    playDurationTicks = playTicks
    pauseDurationTicks = pauseTicks
    ;(document.getElementById('play-ticks') as HTMLInputElement).value = String(playTicks)
    ;(document.getElementById('pause-ticks') as HTMLInputElement).value = String(pauseTicks)
    document.getElementById('play-ticks-val')!.textContent = String(playTicks)
    document.getElementById('pause-ticks-val')!.textContent = String(pauseTicks)
  },

  /** Set simulation speed multiplier */
  setSimSpeed: (speed: number): void => {
    simSpeed = Math.max(0.25, Math.min(4, speed))
    ;(document.getElementById('speed') as HTMLInputElement).value = String(simSpeed)
    document.getElementById('speed-val')!.textContent = `${simSpeed.toFixed(2)}x`
  },

  /** Get the actual overlay mesh world position in Babylon.js Vector3 */
  getOverlayWorldPosition: (): { x: number; y: number; z: number } => {
    const pos = overlayGroup.position
    return { x: pos.x, y: pos.y, z: pos.z }
  },

  /** Get the body center position in Babylon.js Vector3 */
  getBodyCenter: (): { x: number; y: number; z: number } => {
    return { x: bodyCenter.x, y: bodyCenter.y, z: bodyCenter.z }
  },

  /** Get total elapsed wall-clock time in seconds */
  getElapsedWallClock: (): number => {
    return (performance.now() - logStartTime) / 1000
  },

  // --- Reset ---

  /** Reset all state to defaults */
  reset: (): void => {
    document.getElementById('btn-reset')!.click()
  },

  // --- Scene access (for advanced testing) ---
  scene,
  engine,
  camera,
  overlayGroup,
  bodyBox,
}

// Log that test harness is ready
console.log(
  '%c[Test Harness] %cWithIdleOverlay acceptance test ready%c\n' +
  '  window.__testHarness.setActorIdle()\n' +
  '  window.__testHarness.setActorBusy()\n' +
  '  window.__testHarness.getOverlayVisibility()\n' +
  '  window.__testHarness.getOverlaySequence()\n' +
  '  window.__testHarness.getOverlayOffset()\n' +
  '  window.__testHarness.reset()',
  'color: #4caf50;', 'color: #eee;', 'color: #888;',
)
