/**
 * main.ts — Actor Visibility Toggle 3D 人工验收测试
 *
 * 测试目标:
 *   1. mesh.setEnabled(false) — 雾/Shroud 下的 Actor 隐藏 (模拟 HiddenUnderShroud)
 *   2. mesh.setEnabled(true)  — 雾消散后 Actor 重新出现，位置/朝向保持不变
 *   3. Detection pulse — Cloak 被 DetectCloaked 发现时的白色闪烁
 *      (emissiveColor 从 {0,0,0} 脉冲到 {0.8,0.8,0.8}，持续 5 ticks)
 *   4. 独立 Actor 控制 — 各 Actor 的状态互不影响
 *
 * OpenRA 对照:
 *   - HiddenUnderShroud.cs / HiddenUnderFog.cs — _setActorMeshVisibility(), modifyRender()
 *   - Cloak.ts — _applyDetectionPulse(), _isDetectedByAnyEnemy()
 *   - Ch25 Phase C: Fog Visibility Trait Integration
 *
 * 自包含 — 无外部 trait 依赖，仅使用 Babylon.js 核心 API。
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { Mesh } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of ticks a detection pulse lasts */
const PULSE_DURATION_TICKS = 5

/** Emissive color during detection pulse (white shimmer) */
const PULSE_EMISSIVE = new Color3(0.8, 0.8, 0.8)

/** Default emissive (no pulse) */
const IDLE_EMISSIVE = new Color3(0, 0, 0)

/** Tick interval for visual observation (ms) */
const TICK_INTERVAL_MS = 1000

// ---------------------------------------------------------------------------
// Canvas discovery / creation
// ---------------------------------------------------------------------------

let canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null
if (!canvas) {
  canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.outline = 'none'
  canvas.style.touchAction = 'none'
  document.getElementById('sandbox')!.appendChild(canvas)
}

// ---------------------------------------------------------------------------
// Babylon.js initialization
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  antialias: true,
})

const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1.0)

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'testCamera',
  -Math.PI / 4,  // alpha: orbit from front-right
  Math.PI / 4,   // beta: 45 degrees elevation
  14,            // radius
  new Vector3(0, 0, 0),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 40
camera.lowerBetaLimit = 0.1
camera.upperBetaLimit = Math.PI / 2 - 0.05
camera.attachControl(canvas, true)

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

const light = new HemisphericLight('testLight', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.8

const light2 = new HemisphericLight('fillLight', new Vector3(-0.3, 0.2, -0.5), scene)
light2.intensity = 0.25
light2.diffuse = new Color3(0.4, 0.4, 0.5)

// ---------------------------------------------------------------------------
// Terrain ground plane (dark, representing fogged terrain)
// ---------------------------------------------------------------------------

const groundMat = new StandardMaterial('groundMat', scene)
groundMat.diffuseColor = new Color3(0.12, 0.14, 0.18)
groundMat.specularColor = Color3.Black()
groundMat.backFaceCulling = false

const groundPlane = MeshBuilder.CreateGround(
  'groundPlane',
  { width: 20, height: 20, subdivisions: 10 },
  scene,
)
groundPlane.position.y = -0.5
groundPlane.material = groundMat
groundPlane.receiveShadows = false

// Grid lines on the ground for spatial reference
const gridLineMat = new StandardMaterial('gridLineMat', scene)
gridLineMat.emissiveColor = new Color3(0.18, 0.20, 0.24)
gridLineMat.disableLighting = true

for (let i = -10; i <= 10; i += 2) {
  const lineX = MeshBuilder.CreateLines(
    `gridX_${i}`,
    {
      points: [new Vector3(i, -0.49, -10), new Vector3(i, -0.49, 10)],
    },
    scene,
  )
  lineX.color = new Color3(0.15, 0.17, 0.20)
  lineX.renderingGroupId = 0

  const lineZ = MeshBuilder.CreateLines(
    `gridZ_${i}`,
    {
      points: [new Vector3(-10, -0.49, i), new Vector3(10, -0.49, i)],
    },
    scene,
  )
  lineZ.color = new Color3(0.15, 0.17, 0.20)
  lineZ.renderingGroupId = 0
}

// Origin marker
const originMarker = MeshBuilder.CreateLines(
  'originMarker',
  {
    points: [
      new Vector3(0, -0.48, -0.5),
      new Vector3(0, -0.48, 0.5),
    ],
  },
  scene,
)
originMarker.color = new Color3(0.3, 0.3, 0.3)
originMarker.renderingGroupId = 0

// ---------------------------------------------------------------------------
// "Actor" meshes (colored boxes representing game units)
// ---------------------------------------------------------------------------

const BOX_SIZE = 0.8

// --- Actor A: Red, always visible (not affected by fog) ---
const matA = new StandardMaterial('matA', scene)
matA.diffuseColor = new Color3(0.9, 0.15, 0.15)
matA.specularColor = new Color3(0.3, 0.1, 0.1)
matA.emissiveColor = IDLE_EMISSIVE.clone()

const actorA = MeshBuilder.CreateBox(
  'actorA',
  { width: BOX_SIZE, height: BOX_SIZE, depth: BOX_SIZE },
  scene,
)
actorA.position.set(-3, 0, 0)
actorA.material = matA
actorA.renderingGroupId = 1

// Label pillar under Actor A
const pillarA = MeshBuilder.CreateCylinder(
  'pillarA',
  { height: 0.3, diameter: 0.15 },
  scene,
)
pillarA.position.set(-3, -0.4, 0)
const pillarMatA = new StandardMaterial('pillarMatA', scene)
pillarMatA.diffuseColor = new Color3(0.5, 0.1, 0.1)
pillarA.material = pillarMatA

// --- Actor B: Blue, togglable via setEnabled (simulating fog transition) ---
const matB = new StandardMaterial('matB', scene)
matB.diffuseColor = new Color3(0.15, 0.3, 0.9)
matB.specularColor = new Color3(0.1, 0.2, 0.3)
matB.emissiveColor = IDLE_EMISSIVE.clone()

const actorB = MeshBuilder.CreateBox(
  'actorB',
  { width: BOX_SIZE, height: BOX_SIZE, depth: BOX_SIZE },
  scene,
)
actorB.position.set(0, 0, 0)
actorB.material = matB
actorB.renderingGroupId = 1

const pillarB = MeshBuilder.CreateCylinder(
  'pillarB',
  { height: 0.3, diameter: 0.15 },
  scene,
)
pillarB.position.set(0, -0.4, 0)
const pillarMatB = new StandardMaterial('pillarMatB', scene)
pillarMatB.diffuseColor = new Color3(0.1, 0.2, 0.5)
pillarB.material = pillarMatB

// --- Actor C: Green, cloaked (initial alpha lowered), with detection pulse ---
const matC = new StandardMaterial('matC', scene)
matC.diffuseColor = new Color3(0.15, 0.8, 0.3)
matC.specularColor = new Color3(0.1, 0.3, 0.1)
matC.emissiveColor = IDLE_EMISSIVE.clone()
matC.alpha = 0.5  // cloaked appearance (semi-transparent)

const actorC = MeshBuilder.CreateBox(
  'actorC',
  { width: BOX_SIZE, height: BOX_SIZE, depth: BOX_SIZE },
  scene,
)
actorC.position.set(3, 0, 0)
actorC.material = matC
actorC.renderingGroupId = 1

const pillarC = MeshBuilder.CreateCylinder(
  'pillarC',
  { height: 0.3, diameter: 0.15 },
  scene,
)
pillarC.position.set(3, -0.4, 0)
const pillarMatC = new StandardMaterial('pillarMatC', scene)
pillarMatC.diffuseColor = new Color3(0.1, 0.4, 0.2)
pillarMatC.alpha = 0.5
pillarC.material = pillarMatC

// ---------------------------------------------------------------------------
// Labels above each actor
// ---------------------------------------------------------------------------

function createLabel(text: string, position: Vector3, color: Color3, scene: Scene): void {
  // Use a small plane as a billboard label — for simplicity we use thin box
  const labelMat = new StandardMaterial(`labelMat_${text}`, scene)
  labelMat.emissiveColor = color
  labelMat.disableLighting = true
  labelMat.backFaceCulling = false

  const labelPlane = MeshBuilder.CreatePlane(
    `label_${text}`,
    { width: 1.5, height: 0.35 },
    scene,
  )
  labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
  labelPlane.position.copyFrom(position)
  labelPlane.material = labelMat
  labelPlane.renderingGroupId = 1
}

createLabel('Actor A (always visible)', new Vector3(-3, 0.7, 0), new Color3(0.9, 0.3, 0.3), scene)
createLabel('Actor B (fog toggle)', new Vector3(0, 0.7, 0), new Color3(0.3, 0.5, 0.9), scene)
createLabel('Actor C (cloaked, pulse)', new Vector3(3, 0.7, 0), new Color3(0.3, 0.9, 0.4), scene)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let actorBVisible = true
let pulseTicksRemaining = 0
let totalPulsesTriggered = 0
let pulseTimerId: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// Pulse logic
// ---------------------------------------------------------------------------

function startPulse(): void {
  // If already pulsing, restart the counter (re-trigger behavior)
  pulseTicksRemaining = PULSE_DURATION_TICKS
  totalPulsesTriggered++

  // Apply white emissive immediately
  matC.emissiveColor = PULSE_EMISSIVE.clone()

  // Ensure pulse tick interval is running
  if (pulseTimerId === null) {
    pulseTimerId = setInterval(pulseTick, TICK_INTERVAL_MS)
  }

  updateUIState()
}

function pulseTick(): void {
  pulseTicksRemaining--

  if (pulseTicksRemaining <= 0) {
    // Pulse ended — revert emissive to idle
    matC.emissiveColor = IDLE_EMISSIVE.clone()
    if (pulseTimerId !== null) {
      clearInterval(pulseTimerId)
      pulseTimerId = null
    }
  }

  updateUIState()
}

function resetAll(): void {
  // Clear any active pulse timer
  if (pulseTimerId !== null) {
    clearInterval(pulseTimerId)
    pulseTimerId = null
  }

  // Reset Actor B to visible
  actorBVisible = true
  actorB.setEnabled(true)
  pillarB.setEnabled(true)

  // Reset Actor C pulse state
  pulseTicksRemaining = 0
  matC.emissiveColor = IDLE_EMISSIVE.clone()

  // Reset UI button states
  const toggleBtn = document.getElementById('btn-toggle-b')!
  toggleBtn.classList.add('active')

  updateUIState()
}

// ---------------------------------------------------------------------------
// UI state update
// ---------------------------------------------------------------------------

function updateUIState(): void {
  // Actor B status
  const indB = document.getElementById('ind-b')!
  const statB = document.getElementById('stat-b')!
  if (actorBVisible) {
    indB.className = 'status-indicator on'
    statB.className = 'val highlight'
    statB.textContent = 'Visible (setEnabled=true)'
  } else {
    indB.className = 'status-indicator off'
    statB.className = 'val danger'
    statB.textContent = 'Hidden (setEnabled=false)'
  }

  // Actor C pulse status
  const indC = document.getElementById('ind-c')!
  const statC = document.getElementById('stat-c')!
  if (pulseTicksRemaining > 0) {
    indC.className = 'status-indicator pulse'
    statC.className = 'val success'
    statC.textContent = `Cloaked — DETECTED! (ticks: ${pulseTicksRemaining})`
  } else {
    indC.className = 'status-indicator on'
    statC.className = 'val success'
    statC.textContent = 'Cloaked — visible, idle'
  }

  // Emissive values
  const emissiveEl = document.getElementById('emissive-val')!
  const e = matC.emissiveColor
  emissiveEl.textContent = `(${e.r.toFixed(2)}, ${e.g.toFixed(2)}, ${e.b.toFixed(2)})`

  // Pulse ticks
  document.getElementById('pulse-ticks')!.textContent = String(pulseTicksRemaining)
  document.getElementById('pulse-count')!.textContent = String(totalPulsesTriggered)

  // Actor A (always static)
  document.getElementById('stat-a')!.textContent = 'Always visible — no fog interaction'
}

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  const ua = navigator.userAgent
  document.getElementById('info-ua')!.textContent =
    ua.length > 60 ? ua.slice(0, 57) + '...' : ua
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion >= 2 ? `WebGL ${engine.webGLVersion}.0` : 'Unknown'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Control bindings
// ---------------------------------------------------------------------------

// Toggle Actor B visibility (simulates fog entrance/exit)
document.getElementById('btn-toggle-b')!.addEventListener('click', () => {
  actorBVisible = !actorBVisible
  actorB.setEnabled(actorBVisible)
  pillarB.setEnabled(actorBVisible)

  const toggleBtn = document.getElementById('btn-toggle-b')!
  if (actorBVisible) {
    toggleBtn.classList.add('active')
  } else {
    toggleBtn.classList.remove('active')
  }

  updateUIState()
})

// Trigger detection pulse on Actor C (simulates DetectCloaked)
document.getElementById('btn-pulse-c')!.addEventListener('click', () => {
  startPulse()
  const pulseBtn = document.getElementById('btn-pulse-c')!
  pulseBtn.classList.add('active')
  // Brief visual feedback on button
  setTimeout(() => {
    if (pulseTicksRemaining <= 0) {
      pulseBtn.classList.remove('active')
    }
  }, 300)
})

// Reset all
document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetAll()
  document.getElementById('btn-pulse-c')!.classList.remove('active')
})

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()

  // Update FPS
  document.getElementById('info-fps')!.textContent = engine.getFps().toFixed(0)
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

updateInfoBar()
updateUIState()

// Set initial button state (Actor B starts visible)
document.getElementById('btn-toggle-b')!.classList.add('active')

// Resize handler
window.addEventListener('resize', () => {
  engine.resize()
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
})

// Periodic info bar refresh
setInterval(updateInfoBar, 2000)

// ---------------------------------------------------------------------------
// Cleanup on page unload
// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', () => {
  if (pulseTimerId !== null) {
    clearInterval(pulseTimerId)
    pulseTimerId = null
  }
  engine.dispose()
})

console.log('[actor-visibility] Acceptance test page initialized.')
console.log('  Actor A (red):   position (-3, 0, 0) — always visible')
console.log('  Actor B (blue):  position ( 0, 0, 0) — togglable via setEnabled')
console.log('  Actor C (green): position ( 3, 0, 0) — cloaked (alpha=0.5), detection pulse')
