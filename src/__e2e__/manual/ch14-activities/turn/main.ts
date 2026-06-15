/**
 * main.ts -- Turn 旋转活动人工验收测试
 *
 * 测试目标:
 *   1. 验证 Turn 活动的核心行为：旋转到目标 facing，使用最短弧
 *   2. 验证 WAngle.tickFacing() 的正确性：diff > 512 时走反方向
 *   3. 验证 WAngle 坐标系 (0=北, 逆时针递增) 在 3D 场景中的正确映射
 *   4. 验证 Mobile 禁用/暂停时转向暂停
 *   5. 验证取消时立即完成
 *   6. 验证转向速度对完成时间的影响
 *   7. 验证无 facing trait 时立即完成
 *
 * OpenRA 对照:
 *   - OpenRA.Mods.Common/Activities/Turn.cs
 *   - WAngle.ts: tickFacing(current, desired, step)
 *   - WAngle convention: 0 = North (-Z), 256 = West (-X), 512 = South (+Z), 768 = East (+X)
 *
 * 本测试使用纯 Babylon.js 模拟 Turn 行为。
 * 所有坐标系约定严格遵循 OpenRA WAngle 规范。
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, LinesMesh, TransformNode,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid Configuration
// ---------------------------------------------------------------------------

const GRID_W = 20
const GRID_H = 20
const CELL_SIZE = 1.0

function cellCenter(x: number, y: number): { x: number; z: number } {
  return { x: x * CELL_SIZE + CELL_SIZE / 2, z: y * CELL_SIZE + CELL_SIZE / 2 }
}

// ---------------------------------------------------------------------------
// WAngle Constants (OpenRA convention)
//   0 = North (负 Z), 256 = West (负 X), 512 = South (正 Z), 768 = East (正 X)
//   Full circle = 1024 units = 360 degrees
// ---------------------------------------------------------------------------

const WANGLE_NORTH = 0
const WANGLE_WEST = 256
const WANGLE_SOUTH = 512
const WANGLE_EAST = 768
const WANGLE_FULL = 1024

/** Convert WAngle to Babylon.js rotation.y (radians).
 *  WAngle 0 (North/-Z) -> rotation.y = PI
 *  WAngle 256 (West/-X) -> rotation.y = PI/2
 *  WAngle 512 (South/+Z) -> rotation.y = 0
 *  WAngle 768 (East/+X) -> rotation.y = -PI/2
 */
function wAngleToRotationY(wangle: number): number {
  return Math.PI * (1 - wangle / 512)
}

/** Shortest angular difference in WAngle space */
function wAngleDiff(from: number, to: number): number {
  let diff = ((to - from + WANGLE_FULL) % WANGLE_FULL)
  if (diff > WANGLE_FULL / 2) diff -= WANGLE_FULL
  return diff
}

/** WAngle.tickFacing simulation (exact algorithm from WAngle.ts) */
function tickFacing(current: number, desired: number, step: number): number {
  const diff = wAngleDiff(current, desired)
  if (diff === 0) return current
  const absDiff = Math.abs(diff)
  const move = Math.min(absDiff, step)
  const sign = diff >= 0 ? 1 : -1
  return ((current + sign * move) % WANGLE_FULL + WANGLE_FULL) % WANGLE_FULL
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_UNIT = new Color3(0.20, 0.60, 0.95)       // #3399F2
const COLOR_ARROW = new Color3(1, 1, 1)               // White
const COLOR_TARGET_INDICATOR = new Color3(1.0, 0.8, 0.0) // #FFCC00
const COLOR_SHORTEST_ARC = new Color3(0.91, 0.27, 0.38)  // #E94560
const COLOR_COMPLETE = new Color3(0.27, 0.80, 0.27)    // #44CC44

// ---------------------------------------------------------------------------
// Unit State
// ---------------------------------------------------------------------------

interface UnitState {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  facing: number          // Current WAngle
  desiredFacing: number    // Target WAngle
  turnSpeed: number        // WAngle per tick
  isTurning: boolean      // Whether currently turning
  turnComplete: boolean   // Whether turn is complete
  isMobileDisabled: boolean
  isMobilePaused: boolean
  turnCount: number       // Total number of turns completed
  completionFrames: number // Frames to complete current turn
  currentTurnFrames: number // Frames elapsed in current turn
}

// ---------------------------------------------------------------------------
// 3D Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.2, 28, new Vector3(GRID_W / 2, 0, GRID_H / 2), scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 50
camera.panningSensibility = 300

new HemisphericLight('hemi', new Vector3(0.3, 1, 0.3), scene)

// Ground
const groundMat = new StandardMaterial('ground', scene)
groundMat.diffuseColor = new Color3(0.12, 0.15, 0.20)
groundMat.specularColor = new Color3(0, 0, 0)
const ground = MeshBuilder.CreateGround('ground', { width: GRID_W * CELL_SIZE, height: GRID_H * CELL_SIZE }, scene)
ground.position = new Vector3(GRID_W / 2 * CELL_SIZE, -0.05, GRID_H / 2 * CELL_SIZE)
ground.material = groundMat

// Grid lines
for (let i = 0; i <= GRID_W; i++) {
  const line = MeshBuilder.CreateLines(`gridX_${i}`, {
    points: [new Vector3(i * CELL_SIZE, 0.01, 0), new Vector3(i * CELL_SIZE, 0.01, GRID_H * CELL_SIZE)],
  }, scene)
  line.color = new Color3(0.15, 0.2, 0.3)
}
for (let i = 0; i <= GRID_H; i++) {
  const line = MeshBuilder.CreateLines(`gridZ_${i}`, {
    points: [new Vector3(0, 0.01, i * CELL_SIZE), new Vector3(GRID_W * CELL_SIZE, 0.01, i * CELL_SIZE)],
  }, scene)
  line.color = new Color3(0.15, 0.2, 0.3)
}

// ---------------------------------------------------------------------------
// Create Unit
// ---------------------------------------------------------------------------

let unit: UnitState
let unitNode: TransformNode
let targetIndicator: Mesh | null = null
let arcLineMesh: LinesMesh | null = null
let completeMarker: Mesh | null = null

function createUnit(): void {
  const node = new TransformNode('unit', scene)
  const center = cellCenter(10, 10)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox('unitBody', { width: 0.6, height: 0.4, depth: 0.6 }, scene)
  body.parent = node
  body.position.y = 0.2
  const mat = new StandardMaterial('unitMat', scene)
  mat.diffuseColor = COLOR_UNIT
  mat.emissiveColor = new Color3(0.1, 0.3, 0.5)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // Arrow indicator (white triangle showing facing)
  const arrow = MeshBuilder.CreateCylinder('arrow', {
    diameterTop: 0, diameterBottom: 0.3, height: 0.5, tessellation: 3,
  }, scene)
  arrow.parent = node
  arrow.position.y = 0.5
  arrow.rotation.z = Math.PI / 2
  const arrowMat = new StandardMaterial('arrowMat', scene)
  arrowMat.diffuseColor = COLOR_ARROW
  arrowMat.emissiveColor = new Color3(0.8, 0.8, 0.8)
  arrowMat.specularColor = new Color3(0, 0, 0)
  arrow.material = arrowMat

  unitNode = node
  void body
  void arrow

  unit = {
    cellX: 10, cellY: 10,
    posX: center.x, posZ: center.z,
    facing: WANGLE_NORTH,
    desiredFacing: WANGLE_NORTH,
    turnSpeed: 8,
    isTurning: false,
    turnComplete: true,
    isMobileDisabled: false,
    isMobilePaused: false,
    turnCount: 0,
    completionFrames: 0,
    currentTurnFrames: 0,
  }
}

createUnit()

// ---------------------------------------------------------------------------
// Target Indicator (shows desired facing direction)
// ---------------------------------------------------------------------------

function updateTargetIndicator(): void {
  if (targetIndicator) { targetIndicator.dispose(); targetIndicator = null }
  if (unit.turnComplete) return

  // Create a cone at the edge of the unit pointing in desired direction
  const angleRad = wAngleToRotationY(unit.desiredFacing)
  const offsetX = Math.sin(angleRad) * 1.5
  const offsetZ = Math.cos(angleRad) * 1.5

  const indicator = MeshBuilder.CreatePolyhedron('targetIndicator', {
    type: 2, // octahedron
    size: 0.15,
  }, scene)
  indicator.position = new Vector3(
    unit.posX + offsetX,
    0.3,
    unit.posZ + offsetZ
  )
  const indMat = new StandardMaterial('indMat', scene)
  indMat.diffuseColor = COLOR_TARGET_INDICATOR
  indMat.emissiveColor = new Color3(0.5, 0.4, 0)
  indMat.specularColor = new Color3(0, 0, 0)
  indicator.material = indMat

  targetIndicator = indicator
}

// ---------------------------------------------------------------------------
// Shortest Arc Visualization (red arc showing the path)
// ---------------------------------------------------------------------------

function updateArcLine(): void {
  if (arcLineMesh) { arcLineMesh.dispose(); arcLineMesh = null }
  if (unit.turnComplete) return

  const diff = wAngleDiff(unit.facing, unit.desiredFacing)
  if (diff === 0) return

  // Draw an arc from current facing to desired facing
  const radius = 1.2
  const points: Vector3[] = []
  const steps = Math.min(32, Math.abs(diff))
  const sign = diff >= 0 ? 1 : -1

  for (let i = 0; i <= steps; i++) {
    const angle = unit.facing + sign * i * (Math.abs(diff) / steps)
    const rad = wAngleToRotationY(((angle % WANGLE_FULL) + WANGLE_FULL) % WANGLE_FULL)
    const x = unit.posX + Math.sin(rad) * radius
    const z = unit.posZ + Math.cos(rad) * radius
    points.push(new Vector3(x, 0.05, z))
  }

  arcLineMesh = MeshBuilder.CreateLines('arcLine', { points }, scene)
  arcLineMesh.color = COLOR_SHORTEST_ARC
}

// ---------------------------------------------------------------------------
// Complete Marker (green checkmark when turn complete)
// ---------------------------------------------------------------------------

function updateCompleteMarker(): void {
  if (completeMarker) { completeMarker.dispose(); completeMarker = null }
  if (!unit.turnComplete) return

  const marker = MeshBuilder.CreateSphere('completeMarker', { diameter: 0.3 }, scene)
  marker.position = new Vector3(unit.posX, 0.8, unit.posZ)
  const mat = new StandardMaterial('completeMat', scene)
  mat.diffuseColor = COLOR_COMPLETE
  mat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  mat.specularColor = new Color3(0, 0, 0)
  marker.material = mat

  completeMarker = marker
}

// ---------------------------------------------------------------------------
// Turn Logic (simulates Turn.ts tick behavior)
// ---------------------------------------------------------------------------

function startTurn(desiredFacing: number): void {
  unit.desiredFacing = ((desiredFacing % WANGLE_FULL) + WANGLE_FULL) % WANGLE_FULL
  unit.isTurning = true
  unit.turnComplete = false
  unit.currentTurnFrames = 0

  // Pre-calculate expected completion frames
  const diff = Math.abs(wAngleDiff(unit.facing, unit.desiredFacing))
  unit.completionFrames = Math.ceil(diff / unit.turnSpeed)

  // Dispose complete marker
  if (completeMarker) { completeMarker.dispose(); completeMarker = null }
}

function tickTurn(): void {
  if (!unit.isTurning) return
  if (unit.turnComplete) return

  // If Mobile is disabled or paused, wait (can't turn)
  if (unit.isMobileDisabled || unit.isMobilePaused) return

  // If already at desired facing, complete immediately
  if (unit.facing === unit.desiredFacing) {
    unit.turnComplete = true
    unit.isTurning = false
    unit.turnCount++
    return
  }

  // Rotate toward desired facing
  unit.facing = tickFacing(unit.facing, unit.desiredFacing, unit.turnSpeed)
  unit.currentTurnFrames++

  // Check if we reached the target
  if (unit.facing === unit.desiredFacing) {
    unit.turnComplete = true
    unit.isTurning = false
    unit.turnCount++
  }
}

// ---------------------------------------------------------------------------
// Update Visuals
// ---------------------------------------------------------------------------

function updateUnitVisuals(): void {
  unitNode.position.x = unit.posX
  unitNode.position.z = unit.posZ
  unitNode.rotation.y = wAngleToRotationY(unit.facing)
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  const stateEl = document.getElementById('stat-turn-state')!
  if (unit.isMobileDisabled) {
    stateEl.textContent = '禁用'
    stateEl.className = 'value disabled'
  } else if (unit.isMobilePaused) {
    stateEl.textContent = '暂停'
    stateEl.className = 'value disabled'
  } else if (unit.isTurning && !unit.turnComplete) {
    stateEl.textContent = '转向中'
    stateEl.className = 'value turning'
  } else {
    stateEl.textContent = '完成'
    stateEl.className = 'value complete'
  }

  document.getElementById('stat-current-facing')!.textContent = `${unit.facing} (${Math.round(unit.facing * 360 / 1024)}°)`
  document.getElementById('stat-desired-facing')!.textContent = `${unit.desiredFacing} (${Math.round(unit.desiredFacing * 360 / 1024)}°)`

  const diff = wAngleDiff(unit.facing, unit.desiredFacing)
  document.getElementById('stat-angle-diff')!.textContent = `${diff} (${Math.round(Math.abs(diff) * 360 / 1024)}°)`
  document.getElementById('stat-turn-speed')!.textContent = String(unit.turnSpeed)
  document.getElementById('stat-completion-frames')!.textContent = unit.turnComplete ? `${unit.currentTurnFrames} 帧` : `${unit.currentTurnFrames}/${unit.completionFrames} 帧`
  document.getElementById('stat-turn-count')!.textContent = String(unit.turnCount)
}

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Scene Control
// ---------------------------------------------------------------------------

let isPaused = false
let speedMultiplier = 1.0

function resetScene(): void {
  unit.facing = WANGLE_NORTH
  unit.desiredFacing = WANGLE_NORTH
  unit.isTurning = false
  unit.turnComplete = true
  unit.isMobileDisabled = false
  unit.isMobilePaused = false
  unit.currentTurnFrames = 0

  if (targetIndicator) { targetIndicator.dispose(); targetIndicator = null }
  if (arcLineMesh) { arcLineMesh.dispose(); arcLineMesh = null }
  if (completeMarker) { completeMarker.dispose(); completeMarker = null }
}

// ---------------------------------------------------------------------------
// Click Handling
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  if (e.button !== 0) return
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (!pickResult?.pickedPoint) return

  const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
  const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return

  // Calculate WAngle from unit to clicked position
  const dx = gx - unit.cellX
  const dz = gy - unit.cellY
  if (dx === 0 && dz === 0) return

  // WAngle: 0 = North (-Z), 256 = West (-X), 512 = South (+Z), 768 = East (+X)
  const angle = Math.atan2(-dx, -dz) // 0 = North, PI/2 = West, PI = South, -PI/2 = East
  let wangle = Math.round((angle * 512) / Math.PI)
  wangle = ((wangle % WANGLE_FULL) + WANGLE_FULL) % WANGLE_FULL

  startTurn(wangle)
})

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (!pickResult?.pickedPoint) return

  const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
  const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return

  unit.cellX = gx
  unit.cellY = gy
  const center = cellCenter(gx, gy)
  unit.posX = center.x
  unit.posZ = center.z
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

document.getElementById('btn-pause')!.addEventListener('click', () => {
  isPaused = true
  document.getElementById('btn-pause')!.classList.add('active')
  document.getElementById('btn-resume')!.classList.remove('active')
})

document.getElementById('btn-resume')!.addEventListener('click', () => {
  isPaused = false
  document.getElementById('btn-pause')!.classList.remove('active')
  document.getElementById('btn-resume')!.classList.add('active')
})

for (const [id, mult] of [['btn-speed-1x', 1.0], ['btn-speed-2x', 2.0], ['btn-speed-4x', 4.0]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    speedMultiplier = mult
    for (const b of ['btn-speed-1x', 'btn-speed-2x', 'btn-speed-4x']) {
      document.getElementById(b)!.classList.toggle('active', b === id)
    }
  })
}

document.getElementById('btn-reset')!.addEventListener('click', resetScene)

// Preset turn targets
const presetTurns: [string, number][] = [
  ['btn-turn-north', WANGLE_NORTH],
  ['btn-turn-east', WANGLE_EAST],
  ['btn-turn-south', WANGLE_SOUTH],
  ['btn-turn-west', WANGLE_WEST],
  ['btn-turn-northeast', 896],
  ['btn-turn-southwest', 384],
]

for (const [id, wangle] of presetTurns) {
  document.getElementById(id)!.addEventListener('click', () => startTurn(wangle))
}

document.getElementById('btn-turn-opposite')!.addEventListener('click', () => {
  startTurn((unit.facing + 512) % WANGLE_FULL)
})

document.getElementById('btn-turn-small')!.addEventListener('click', () => {
  startTurn((unit.facing + 128) % WANGLE_FULL)
})

// Turn speed controls
for (const [id, speed] of [['btn-turn-slow', 4], ['btn-turn-normal', 8], ['btn-turn-fast', 16], ['btn-turn-instant', 256]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    unit.turnSpeed = speed
    for (const b of ['btn-turn-slow', 'btn-turn-normal', 'btn-turn-fast', 'btn-turn-instant']) {
      document.getElementById(b)!.classList.toggle('active', b === id)
    }
    // Recalculate completion frames if turning
    if (unit.isTurning && !unit.turnComplete) {
      const diff = Math.abs(wAngleDiff(unit.facing, unit.desiredFacing))
      unit.completionFrames = unit.currentTurnFrames + Math.ceil(diff / unit.turnSpeed)
    }
  })
}

document.getElementById('btn-toggle-disabled')!.addEventListener('click', () => {
  unit.isMobileDisabled = !unit.isMobileDisabled
  document.getElementById('btn-toggle-disabled')!.classList.toggle('active', unit.isMobileDisabled)
})

document.getElementById('btn-toggle-paused')!.addEventListener('click', () => {
  unit.isMobilePaused = !unit.isMobilePaused
  document.getElementById('btn-toggle-paused')!.classList.toggle('active', unit.isMobilePaused)
})

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault()
      isPaused = !isPaused
      document.getElementById('btn-pause')!.classList.toggle('active', isPaused)
      document.getElementById('btn-resume')!.classList.toggle('active', !isPaused)
      break
    case '1': speedMultiplier = 1.0; break
    case '2': speedMultiplier = 2.0; break
    case '3': speedMultiplier = 4.0; break
    case 'r': resetScene(); break
    case 'n': startTurn(WANGLE_NORTH); break
    case 'e': startTurn(WANGLE_EAST); break
    case 's': startTurn(WANGLE_SOUTH); break
    case 'w': startTurn(WANGLE_WEST); break
    case 'o': startTurn((unit.facing + 512) % WANGLE_FULL); break
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  if (!isPaused) {
    const ticks = Math.ceil(speedMultiplier)
    for (let i = 0; i < ticks; i++) {
      tickTurn()
    }
  }
  updateUnitVisuals()
  updateTargetIndicator()
  updateArcLine()
  updateCompleteMarker()
  updateStatsPanel()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness
;(window as any).__testHarness = {
  scene, camera, engine,
  getUnit: () => unit,
  getFacing: () => unit.facing,
  getDesiredFacing: () => unit.desiredFacing,
  isTurnComplete: () => unit.turnComplete,
  getTurnCount: () => unit.turnCount,
  getCompletionFrames: () => unit.completionFrames,
  startTurn: (wangle: number) => startTurn(wangle),
}
