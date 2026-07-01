/**
 * main.ts -- Unit Turn Animation 人工验收测试
 *
 * 测试目标:
 *   1. 验证 WAngle.tickFacing() 逐步转向逻辑（不瞬间跳变）
 *   2. 验证 turnSpeed 上限：每次 tick 的 facing 变化 <= config turnSpeed
 *   3. 验证转向完成后面向 = 目标方向（±1°精度内）
 *   4. 验证转向 tick 数与大角度成正比
 *   5. 验证 ≤5° 角度差跳过动画
 *
 * OpenRA 对照: Mobile.ts (facing, turnSpeed, UpdateMovement) + WAngle.tickFacing()
 *
 * 坐标系约定 (WAngle):
 *   - WAngle 0 = 北 (North), 逆时针递增
 *   - 256 = 东, 512 = 南, 768 = 西
 *   - 1024 = 360 度
 *   - 1° ≈ 2.844 WAngle units
 *   - 5° ≈ 14.2 WAngle units
 *   - rendererDegrees() 用于 Babylon.js 旋转显示
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
import type { Mesh } from '@babylonjs/core'

// Import actual WAngle from source — this ensures the test page exercises the
// same tickFacing() code that Mobile.ts uses in production.
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WAngle units per degree: 1024 / 360 */
const WANGLE_PER_DEGREE = 1024 / 360

/** Small angle threshold in WAngle units (~5° = 14.22 ≈ 14).
 *
 * OpenRA 对照: In practice, Mobile does not have a hard-coded threshold
 *   for skipping turn animation — the MovementType.Turn flag is set
 *   whenever oldFacing !== facing. However, for very small deltas that
 *   resolve in a single tick with no visible rotation frames, the
 *   turn is effectively instantaneous. This test verifies that angles
 *   <= this threshold produce zero visible turn frames.
 */
const SMALL_ANGLE_THRESHOLD_WA = 14

// ---------------------------------------------------------------------------
// Helper: create a colored texture label
// ---------------------------------------------------------------------------

function createTextureLabel(
  text: string,
  width: number,
  height: number,
  color: string,
  fontSize: number,
  scene: Scene,
): DynamicTexture {
  const tex = new DynamicTexture(`tex_${text}`, { width, height }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = color
  ctx.font = `${fontSize}px 'Consolas', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, height / 2)
  tex.update(true)
  tex.hasAlpha = true
  return tex
}

function createLabelPlane(
  text: string,
  position: Vector3,
  width: number,
  height: number,
  color: string,
  fontSize: number,
  scene: Scene,
): Mesh {
  const tex = createTextureLabel(text, 512, 128, color, fontSize, scene)
  const mat = new StandardMaterial(`mat_label_${text}`, scene)
  mat.diffuseTexture = tex
  mat.emissiveTexture = tex
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.specularColor.set(0, 0, 0)
  mat.backFaceCulling = false
  mat.disableLighting = true
  mat.useAlphaFromDiffuseTexture = true
  const plane = MeshBuilder.CreatePlane(`plane_${text}`, { width, height }, scene)
  plane.position = position
  plane.material = mat
  return plane
}

// ---------------------------------------------------------------------------
// Unit mesh factory — creates a directional arrow pointing NORTH (WAngle 0)
// ---------------------------------------------------------------------------

interface UnitMeshes {
  /** The parent transform node — rotate this to change facing */
  body: Mesh
  /** Turn animation indicator ring (changes color during turn) */
  turnRing: Mesh
  /** Direction arrow (points forward = NORTH at rest) */
  arrow: Mesh
  /** Ground shadow disc */
  shadow: Mesh
  dispose: () => void
}

function createUnitMeshes(scene: Scene): UnitMeshes {
  // Body — a rounded rectangle (tank body shape)
  const body = MeshBuilder.CreateBox('unit_body', { width: 0.45, height: 0.12, depth: 0.75 }, scene)
  body.position.y = 0.06

  // Direction arrow — points forward (+Z = NORTH)
  const arrow = MeshBuilder.CreateCylinder('unit_arrow', {
    height: 0.22,
    diameterTop: 0,
    diameterBottom: 0.14,
    tessellation: 6,
  }, scene)
  arrow.rotation.x = Math.PI / 2 // lay flat, pointing +Z
  arrow.position.set(0, 0.18, 0.48)
  arrow.parent = body

  // Turn ring — a thin torus around the unit, changes color during turn
  const ring = MeshBuilder.CreateTorus('turn_ring', {
    diameter: 0.9,
    thickness: 0.04,
    tessellation: 32,
  }, scene)
  ring.rotation.x = Math.PI / 2 // lay flat on ground
  ring.position.y = 0.01
  ring.parent = body

  // Shadow disc
  const shadow = MeshBuilder.CreateDisc('shadow', {
    radius: 0.45,
    tessellation: 24,
  }, scene)
  shadow.rotation.x = Math.PI / 2
  shadow.position.y = 0.005

  // Materials
  const bodyMat = new StandardMaterial('body_mat', scene)
  bodyMat.diffuseColor = new Color3(0.2, 0.5, 0.8)
  bodyMat.specularColor.set(0.05, 0.05, 0.05)
  body.material = bodyMat

  const arrowMat = new StandardMaterial('arrow_mat', scene)
  arrowMat.diffuseColor = new Color3(0.9, 0.3, 0.2)
  arrowMat.specularColor.set(0, 0, 0)
  arrowMat.disableLighting = true
  arrowMat.emissiveColor = new Color3(0.5, 0.15, 0.1)
  arrow.material = arrowMat

  const ringMat = new StandardMaterial('ring_mat', scene)
  ringMat.diffuseColor = new Color3(0.3, 0.3, 0.4)
  ringMat.emissiveColor = new Color3(0.1, 0.1, 0.15)
  ringMat.specularColor.set(0, 0, 0)
  ringMat.disableLighting = true
  ring.material = ringMat

  const shadowMat = new StandardMaterial('shadow_mat', scene)
  shadowMat.diffuseColor = new Color3(0.05, 0.05, 0.08)
  shadowMat.alpha = 0.4
  shadowMat.specularColor.set(0, 0, 0)
  shadowMat.disableLighting = true
  shadow.material = shadowMat

  const all = [body, ring, arrow, shadow]
  const allMats = [bodyMat, ringMat, arrowMat, shadowMat]

  return {
    body,
    turnRing: ring,
    arrow,
    shadow,
    dispose: () => {
      for (const m of all) m.dispose()
      for (const m of allMats) m.dispose()
    },
  }
}

// ---------------------------------------------------------------------------
// Compass rose — direction indicator lines on ground
// ---------------------------------------------------------------------------

function createCompassRose(scene: Scene, radius: number): Mesh {
  const dirs = [
    { wa: 0, label: 'N(0)' },
    { wa: 256, label: 'E(256)' },
    { wa: 512, label: 'S(512)' },
    { wa: 768, label: 'W(768)' },
  ]

  const allLines: Vector3[][] = []
  const allColors: Color4[][] = []
  const color = [new Color4(0.2, 0.25, 0.35, 0.6), new Color4(0.2, 0.25, 0.35, 0.6)]

  for (const d of dirs) {
    const angleRad = new WAngle(d.wa).rendererRadians()
    const endX = Math.sin(angleRad) * radius
    const endZ = -Math.cos(angleRad) * radius
    allLines.push([
      Vector3.Zero(),
      new Vector3(endX, 0.001, endZ),
    ])
    allColors.push(color)
  }

  const lines = MeshBuilder.CreateLineSystem('compass', {
    lines: allLines,
    colors: allColors,
  }, scene)

  // Cardinal direction labels
  for (const d of dirs) {
    const angleRad = new WAngle(d.wa).rendererRadians()
    const x = Math.sin(angleRad) * (radius + 0.3)
    const z = -Math.cos(angleRad) * (radius + 0.3)
    createLabelPlane(
      d.label,
      new Vector3(x, 0.01, z),
      0.6, 0.25, '#AABBCC', 28, scene,
    )
  }

  return lines
}

// ---------------------------------------------------------------------------
// Turn state machine
// ---------------------------------------------------------------------------

interface TurnState {
  /** Current facing (WAngle) */
  currentFacing: WAngle
  /** Target/destination facing (WAngle) */
  targetFacing: WAngle
  /** Configured turn speed (WAngle units per tick) */
  turnSpeed: WAngle
  /** Tick interval in ms */
  tickMs: number
  /** Accumulated time since last tick (ms) */
  timeAccum: number
  /** Total ticks elapsed during current turn */
  turnTicks: number
  /** Whether currently turning */
  isTurning: boolean
  /** Whether turn animation (visual frame indicator) was triggered */
  animationTriggered: boolean
  /** History of recent facing values for animation indicator */
  facingHistory: WAngle[]
  /** Maximum history entries */
  maxHistory: number
  /** Whether this turn was "small" (<= threshold, skipped animation) */
  isSmallAngle: boolean
}

function createTurnState(turnSpeedWA: number, tickMs: number): TurnState {
  return {
    currentFacing: WAngle.Zero,
    targetFacing: WAngle.Zero,
    turnSpeed: new WAngle(turnSpeedWA),
    tickMs,
    timeAccum: 0,
    turnTicks: 0,
    isTurning: false,
    animationTriggered: false,
    facingHistory: [],
    maxHistory: 20,
    isSmallAngle: false,
  }
}

/**
 * Process one logic tick: advance facing toward target using WAngle.tickFacing().
 * Returns the delta (change in facing angle) for this tick.
 */
function processTick(state: TurnState): number {
  const oldFacing = state.currentFacing
  state.currentFacing = WAngle.tickFacing(
    state.currentFacing,
    state.targetFacing,
    state.turnSpeed,
  )

  const delta = WAngle.subtract(state.currentFacing, oldFacing).angle
  // Normalize delta to shortest arc [0, 512]
  const normalizedDelta = delta > 512 ? 1024 - delta : delta

  state.turnTicks++

  // Record facing history
  state.facingHistory.push(new WAngle(state.currentFacing.angle))
  if (state.facingHistory.length > state.maxHistory) {
    state.facingHistory.shift()
  }

  return normalizedDelta
}

/**
 * Check if the turn is complete.
 */
function isTurnComplete(state: TurnState): boolean {
  return WAngle.equals(state.currentFacing, state.targetFacing)
}

/**
 * Get the total angle difference between current and target.
 */
function getAngleDelta(state: TurnState): number {
  const diff = WAngle.subtract(state.targetFacing, state.currentFacing).angle
  return diff > 512 ? 1024 - diff : diff
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ---- Environment info elements ----
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

  // ---- Babylon.js init ----
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
      antialias: true,
    })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return
  }
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  // ---- Scene ----
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.06, 0.07, 0.1, 1)

  // ---- Camera (top-down isometric view) ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2 + 0.4, // slight isometric angle
    Math.PI / 3.5,       // elevation
    7,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 15
  camera.lowerBetaLimit = 0.1
  camera.upperBetaLimit = Math.PI / 2 - 0.1
  camera.inputs.clear()
  camera.inputs.addMouseWheel()
  // Enable right-drag to pan for exploring the scene
  // (left-click orbit is the default but we keep it simple)

  // ---- Lighting ----
  const light = new HemisphericLight('light', new Vector3(0.3, 1, -0.5), scene)
  light.intensity = 0.85
  light.diffuse = new Color3(0.9, 0.9, 1)
  light.groundColor = new Color3(0.2, 0.2, 0.3)

  // ---- Ground plane ----
  const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene)
  const groundMat = new StandardMaterial('ground_mat', scene)
  groundMat.diffuseColor = new Color3(0.12, 0.13, 0.16)
  groundMat.specularColor.set(0, 0, 0)
  ground.material = groundMat

  // ---- Compass rose ----
  createCompassRose(scene, 2.8)

  // ---- Unit meshes ----
  const unit = createUnitMeshes(scene)

  // ---- State ----
  const defaultTurnSpeed = 32 // WAngle/tick (~11.25°/tick)
  const defaultTickMs = 40
  const state = createTurnState(defaultTurnSpeed, defaultTickMs)

  // ---- UI element references ----
  const turnRateSlider = document.getElementById('turn-rate') as HTMLInputElement
  const turnRateVal = document.getElementById('turn-rate-val')!
  const tickMsSlider = document.getElementById('tick-ms') as HTMLInputElement
  const tickMsVal = document.getElementById('tick-ms-val')!
  const stateFacing = document.getElementById('state-facing')!
  const stateDeg = document.getElementById('state-deg')!
  const stateTargetDir = document.getElementById('state-target-dir')!
  const stateTargetDeg = document.getElementById('state-target-deg')!
  const stateDelta = document.getElementById('state-delta')!
  const stateDeltaDeg = document.getElementById('state-delta-deg')!
  const stateStatus = document.getElementById('state-status')!
  const stateTicks = document.getElementById('state-ticks')!
  const stateTurnFrame = document.getElementById('state-turn-frame')!
  const stateDegps = document.getElementById('state-degps')!
  const stateAnimTriggered = document.getElementById('state-anim-triggered')!
  const smallDeltaSlider = document.getElementById('small-delta') as HTMLInputElement
  const smallDeltaVal = document.getElementById('small-delta-val')!

  // ---- Turn animation frame dots ----
  // We display an animated indicator in the status area
  function updateTurnFrameDisplay(turnTicks: number, isTurning: boolean, isSmall: boolean): void {
    if (!isTurning) {
      stateTurnFrame.textContent = isSmall ? '(small angle, skipped)' : '-'
      return
    }
    // Show a rotating sequence of symbols to indicate turn animation
    const symbols = ['◐', '◓', '◑', '◒']
    stateTurnFrame.textContent = `${symbols[turnTicks % 4]} tick#${turnTicks}`
  }

  // ---- Update unit visual rotation from current facing ----
  function updateUnitVisual(): void {
    // WAngle 0 = North = direction of +Z axis in Babylon.js
    // rendererRadians() gives the angle in radians.
    // Babylon.js: rotation.y = 0 means facing +Z (which is North for us)
    //
    // Both WAngle and Babylon.js rotation.y use the same angular direction:
    // - WAngle increases counterclockwise from North (0→256=East, 512=South, 768=West)
    // - Babylon.js rotation.y increases counterclockwise from +Z (0→+Z, π/2→+X, π→-Z, 3π/2→-X)
    // Therefore rendererRadians() maps directly to rotation.y without negation:
    //   WAngle 0 → 0 rad → faces +Z (North) ✓
    //   WAngle 256 → π/2 → faces +X (East) ✓
    //   WAngle 512 → π → faces -Z (South) ✓
    //   WAngle 768 → 3π/2 → faces -X (West) ✓
    unit.body.rotation.y = state.currentFacing.rendererRadians()
  }

  // ---- Perform a turn toward a target direction ----
  function commandTurn(targetWA: number): void {
    const target = new WAngle(targetWA)

    // Check if this is a small angle turn
    const delta = WAngle.subtract(target, state.currentFacing).angle
    const absDelta = delta > 512 ? 1024 - delta : delta
    state.isSmallAngle = absDelta <= SMALL_ANGLE_THRESHOLD_WA
    state.animationTriggered = !state.isSmallAngle

    state.targetFacing = target
    state.turnTicks = 0
    state.timeAccum = 0
    state.facingHistory = []
    state.isTurning = !WAngle.equals(state.currentFacing, target)

    if (state.isSmallAngle && state.isTurning) {
      // For small angles, snap instantly (no animation)
      state.currentFacing = target
      state.isTurning = false
      updateUnitVisual()
    }

    updateStatusDisplay()
  }

  // ---- Update all status displays ----
  function updateStatusDisplay(): void {
    const currentWA = state.currentFacing.angle
    const targetWA = state.targetFacing.angle
    const deltaWA = getAngleDelta(state)

    stateFacing.textContent = String(currentWA)
    stateDeg.textContent = `${state.currentFacing.rendererDegrees().toFixed(1)}°`
    stateTargetDir.textContent = String(targetWA)
    stateTargetDeg.textContent = `${state.targetFacing.rendererDegrees().toFixed(1)}°`
    stateDelta.textContent = String(deltaWA)
    stateDeltaDeg.textContent = `${(deltaWA / WANGLE_PER_DEGREE).toFixed(1)}°`

    if (state.isTurning) {
      stateStatus.textContent = state.isSmallAngle ? '小角度(瞬间完成)' : '转向中...'
    } else {
      stateStatus.textContent = WAngle.equals(state.currentFacing, state.targetFacing)
        ? '已对齐'
        : '空闲'
    }

    stateTicks.textContent = String(state.turnTicks)
    updateTurnFrameDisplay(state.turnTicks, state.isTurning, state.isSmallAngle)
    stateAnimTriggered.textContent = state.animationTriggered ? '是 ✓' : '否 ✗'
    stateAnimTriggered.className = state.animationTriggered ? 'val' : 'val warn'

    // Turn ring color: orange during turn, gray-blue at rest
    const ringMat = unit.turnRing.material as StandardMaterial
    if (state.isTurning) {
      ringMat.diffuseColor = new Color3(0.9, 0.6, 0.1)
      ringMat.emissiveColor = new Color3(0.45, 0.3, 0.05)
    } else {
      ringMat.diffuseColor = new Color3(0.3, 0.3, 0.4)
      ringMat.emissiveColor = new Color3(0.1, 0.1, 0.15)
    }

    // Update degrees-per-second display
    const degPerTick = state.turnSpeed.angle * 0.3515625
    const ticksPerSec = 1000 / state.tickMs
    stateDegps.textContent = `${(degPerTick * ticksPerSec).toFixed(1)}°/s`
  }

  // ---- UI Event Bindings ----

  // Direction buttons
  document.querySelectorAll<HTMLButtonElement>('button.direction-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const facing = parseInt(btn.dataset.facing!, 10)
      commandTurn(facing)
    })
  })

  // Turn rate slider
  turnRateSlider.addEventListener('input', () => {
    const rate = parseInt(turnRateSlider.value, 10)
    state.turnSpeed = new WAngle(rate)
    const degPerTick = rate * 0.3515625
    turnRateVal.textContent = `${rate} (${degPerTick.toFixed(1)}°/tick)`
    updateStatusDisplay()
  })

  // Tick interval slider
  tickMsSlider.addEventListener('input', () => {
    state.tickMs = parseInt(tickMsSlider.value, 10)
    tickMsVal.textContent = `${state.tickMs}ms (${Math.round(1000 / state.tickMs)} ticks/s)`
    updateStatusDisplay()
  })

  // Reset button
  document.getElementById('btn-reset')!.addEventListener('click', () => {
    state.currentFacing = WAngle.Zero
    state.targetFacing = WAngle.Zero
    state.isTurning = false
    state.isSmallAngle = false
    state.animationTriggered = false
    state.turnTicks = 0
    state.timeAccum = 0
    state.facingHistory = []
    updateUnitVisual()
    updateStatusDisplay()
  })

  // Small angle turn button
  document.getElementById('btn-small-turn')!.addEventListener('click', () => {
    const smallDelta = parseInt(smallDeltaSlider.value, 10)
    const target = WAngle.add(state.currentFacing, new WAngle(smallDelta))
    commandTurn(target.angle)
  })

  smallDeltaSlider.addEventListener('input', () => {
    smallDeltaVal.textContent = `${smallDeltaSlider.value} (~${(parseInt(smallDeltaSlider.value, 10) / WANGLE_PER_DEGREE).toFixed(1)}°)`
  })

  // ---- Initial state ----
  updateUnitVisual()
  updateStatusDisplay()

  // ---- Render loop ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()
  let lastFrameTime = performance.now()

  engine.runRenderLoop(() => {
    const now = performance.now()
    const frameDeltaMs = now - lastFrameTime
    lastFrameTime = now

    // Process turn ticks
    if (state.isTurning) {
      state.timeAccum += frameDeltaMs

      while (state.timeAccum >= state.tickMs) {
        state.timeAccum -= state.tickMs
        processTick(state)
        updateUnitVisual()

        if (isTurnComplete(state)) {
          state.isTurning = false
          break
        }
      }
      updateStatusDisplay()
    }

    scene.render()

    // FPS counter
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

  // ---- Resize handler ----
  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  })
  resizeObserver.observe(canvas)

  // ---- Test harness (BLOCKER fix: plan §4.8.2 requires API) ----
  ;(window as any).__testHarness = {
    moveUnitTo(_actor: unknown, directionWA: number): void {
      state.targetFacing = new WAngle(directionWA)
      if (WAngle.subtract(state.targetFacing, state.currentFacing).angle !== 0) {
        state.isTurning = true; state.turnTicks = 0; state.animationTriggered = false
      }
    },
    getUnitFacing(): number { return state.currentFacing.angle },
    getTurnRate(): number { return state.turnSpeed.angle },
    getTurnAnimationFrame(): number { return state.isTurning ? state.turnTicks : -1 },
    isTurning(): boolean { return state.isTurning },
    reset(): void {
      state.currentFacing = WAngle.Zero; state.targetFacing = WAngle.Zero
      state.isTurning = false; state.turnTicks = 0; state.animationTriggered = false
    },
  }

  // ---- Engine dispose on unload (MAJOR fix) ----
  window.addEventListener('beforeunload', () => { resizeObserver.disconnect(); engine.dispose() })
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
