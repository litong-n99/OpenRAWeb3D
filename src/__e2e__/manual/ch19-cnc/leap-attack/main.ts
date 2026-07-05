/**
 * ch19-cnc/leap-attack/main.ts — Parabolic leap arc + attack acceptance test
 *
 * Verifies:
 * 1. XY trajectory using WPos.lerp (linear interpolation between origin and destination)
 * 2. Z (height) trajectory using sin-based parabolic curve
 * 3. Speed-based tick count: length = max(distance / speed, 1)
 * 4. Attack trigger on landing (target flash)
 * 5. Full arc trajectory visualization
 *
 * OpenRA source: OpenRA.Mods.Cnc/Activities/Leap.cs (126 lines)
 *                OpenRA.Mods.Cnc/Activities/LeapAttack.cs (176 lines)
 *
 * TS source: src/OpenRA.Mods.Cnc/Activities/Leap.ts
 *            src/OpenRA.Mods.Cnc/Activities/LeapAttack.ts
 *
 * Key formulas from Leap.ts:
 *   t = ticks / (length - 1)
 *   height = sin(t * PI) * 256  // default max height
 *   position = new WPos(lerpPos.X, lerpPos.Y, origin.Z + height)
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  Color3,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  LinesMesh,
  TransformNode,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_RATE = 1000 / 25
const WORLD_SCALE = 1024
const CELL_SIZE = 1024  // WDist per cell

// ---------------------------------------------------------------------------
// Leap Simulation (mirrors OpenRA Leap.ts)
// ---------------------------------------------------------------------------

interface LeapSimState {
  originX: number  // WDist
  originY: number  // WDist
  originZ: number  // WDist (height base)
  targetX: number   // WDist
  targetY: number   // WDist
  speed: number     // WDist per tick
  maxHeight: number // WDist (Z-axis peak)
  ticks: number
  totalLength: number
  jumpComplete: boolean
  leaperNode: TransformNode
  targetMesh: Mesh
  trajectoryLine: LinesMesh | null
}

function computeTotalLength(ox: number, oy: number, tx: number, ty: number, speed: number): number {
  const dx = tx - ox
  const dy = ty - oy
  const distance = Math.sqrt(dx * dx + dy * dy)
  return Math.max(Math.floor(distance / speed), 1)
}

function lerpPosition(ox: number, oy: number, tx: number, ty: number, t: number): { x: number; y: number } {
  return {
    x: ox + (tx - ox) * t,
    y: oy + (ty - oy) * t,
  }
}

function getLeapPosition(state: LeapSimState): { x: number; y: number; z: number } {
  if (state.totalLength > 1 && !state.jumpComplete) {
    const t = Math.min(state.ticks / (state.totalLength - 1), 1)
    const lerp = lerpPosition(state.originX, state.originY, state.targetX, state.targetY, t)
    const height = Math.sin(t * Math.PI) * state.maxHeight
    return {
      x: lerp.x / WORLD_SCALE,
      y: height / WORLD_SCALE,
      z: lerp.y / WORLD_SCALE,
    }
  }
  return {
    x: state.targetX / WORLD_SCALE,
    y: 0,
    z: state.targetY / WORLD_SCALE,
  }
}

function generateTrajectoryPoints(state: LeapSimState): Vector3[] {
  const points: Vector3[] = []
  const steps = 64
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const lerp = lerpPosition(state.originX, state.originY, state.targetX, state.targetY, t)
    const height = Math.sin(t * Math.PI) * state.maxHeight
    points.push(new Vector3(lerp.x / WORLD_SCALE, height / WORLD_SCALE, lerp.y / WORLD_SCALE))
  }
  return points
}

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene

let leapState: LeapSimState
let leaperMesh: Mesh
let targetMesh: Mesh
let trajectoryLine: LinesMesh | null = null
let isAutoLeaping: boolean = false
let autoCooldown: number = 0

function getTargetPos(): { x: number; y: number } {
  const sel = (document.getElementById('sel-target') as HTMLSelectElement).value
  const x = 0
  const y = sel === 'near' ? -5 * CELL_SIZE : sel === 'far' ? -18 * CELL_SIZE : -10 * CELL_SIZE
  return { x, y }
}

function setupLeap(): void {
  const speed = parseInt((document.getElementById('rng-speed') as HTMLInputElement).value)
  const maxHeight = parseInt((document.getElementById('rng-height') as HTMLInputElement).value)
  const target = getTargetPos()

  // Update target mesh position
  targetMesh.position.x = target.x / WORLD_SCALE
  targetMesh.position.z = target.y / WORLD_SCALE

  // Reset leaper to origin
  leaperMesh.position = new Vector3(0, 0, 0)

  leapState = {
    originX: 0,
    originY: 0,
    originZ: 0,
    targetX: target.x,
    targetY: target.y,
    speed,
    maxHeight,
    ticks: 0,
    totalLength: computeTotalLength(0, 0, target.x, target.y, speed),
    jumpComplete: false,
    leaperNode: leaperMesh as unknown as TransformNode,
    targetMesh,
    trajectoryLine: null,
  }

  // Generate and show trajectory preview
  if (trajectoryLine) { trajectoryLine.dispose() }
  const trajPts = generateTrajectoryPoints(leapState)
  trajectoryLine = MeshBuilder.CreateLines('trajectory', { points: trajPts, colors: trajPts.map(() => new Color4(1, 0.4, 0.6, 0.6)) }, scene)
  trajectoryLine.color = new Color3(1, 0.4, 0.6)
}

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.06, 0.1, 0.15, 1)

  const camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 3, 15, new Vector3(0, 1, -5), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 30

  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.2), scene)
  hemi.intensity = 0.7

  // Ground grid
  const gMat = new StandardMaterial('gMat', scene)
  gMat.diffuseColor = new Color3(0.15, 0.2, 0.25)
  const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 24 }, scene)
  ground.material = gMat

  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.25, 0.3, 0.35)
  const grid = MeshBuilder.CreateGround('grid', { width: 24, height: 24, subdivisions: 24 }, scene)
  grid.position.y = 0.005
  grid.material = gridMat

  // Origin marker
  const oMat = new StandardMaterial('oMat', scene)
  oMat.diffuseColor = new Color3(0, 0.8, 0.3)
  oMat.emissiveColor = new Color3(0, 0.3, 0.1)
  const origin = MeshBuilder.CreateSphere('origin', { diameter: 0.3 }, scene)
  origin.position = Vector3.Zero()
  origin.material = oMat

  // Leaper (jumping unit — dog/dino shape)
  const lMat = new StandardMaterial('lMat', scene)
  lMat.diffuseColor = new Color3(0.7, 0.3, 0.1)
  lMat.emissiveColor = new Color3(0.2, 0.05, 0)
  leaperMesh = new Mesh('leaper', scene)
  const body = MeshBuilder.CreateBox('body', { width: 0.6, height: 0.4, depth: 0.9 }, scene)
  body.material = lMat
  body.parent = leaperMesh
  // Head
  const head = MeshBuilder.CreateSphere('head', { diameter: 0.35 }, scene)
  head.position.z = -0.5
  head.position.y = 0.15
  head.material = lMat
  head.parent = leaperMesh

  // Tail
  const tailMat = new StandardMaterial('tMat', scene)
  tailMat.diffuseColor = new Color3(0.6, 0.2, 0.1)
  const tail = MeshBuilder.CreateCylinder('tail', { height: 0.5, diameter: 0.08 }, scene)
  tail.position.z = 0.55
  tail.position.y = 0.1
  tail.rotation.x = Math.PI / 2
  tail.material = tailMat
  tail.parent = leaperMesh

  leaperMesh.position = new Vector3(0, 0, 0)

  // Target mesh (edible unit)
  const tMat = new StandardMaterial('tMat2', scene)
  tMat.diffuseColor = new Color3(0.8, 0.7, 0.1)
  targetMesh = new Mesh('target', scene)
  targetMesh.material = tMat // BUGFIX: parent Mesh needs material too (Babylon doesn't inherit)
  const tBody = MeshBuilder.CreateBox('tBody', { width: 0.5, height: 0.3, depth: 0.7 }, scene)
  tBody.material = tMat
  tBody.parent = targetMesh

  // Initialize leap state
  setupLeap()
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  if (!leapState) return
  document.getElementById('st-phase')!.textContent = leapState.jumpComplete ? 'COMPLETE' : (leapState.ticks === 0 ? 'IDLE' : 'LEAPING')
  document.getElementById('st-tick')!.textContent = String(leapState.ticks)
  document.getElementById('st-total')!.textContent = String(leapState.totalLength)
  const t = leapState.totalLength > 1 ? leapState.ticks / (leapState.totalLength - 1) : 1
  document.getElementById('st-progress')!.textContent = t.toFixed(2)
  const pos = getLeapPosition(leapState)
  document.getElementById('st-height')!.textContent = Math.round(pos.y * WORLD_SCALE).toString()
  document.getElementById('st-pos')!.textContent = `${(pos.x * WORLD_SCALE).toFixed(0)}, ${(pos.z * WORLD_SCALE).toFixed(0)}`
  document.getElementById('st-complete')!.textContent = String(leapState.jumpComplete)
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
  document.getElementById('info-tickrate')!.textContent = '25 ticks/s (模拟)'
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-leap')!.addEventListener('click', () => {
    doLeap()
  })

  document.getElementById('btn-auto')!.addEventListener('click', function(this: HTMLButtonElement) {
    isAutoLeaping = !isAutoLeaping
    this.classList.toggle('active', isAutoLeaping)
    if (isAutoLeaping) autoCooldown = 0
  })

  document.getElementById('rng-speed')!.addEventListener('input', function(this: HTMLInputElement) {
    document.getElementById('lbl-speed')!.textContent = this.value
    if (!leapState.jumpComplete) setupLeap()
  })

  document.getElementById('rng-height')!.addEventListener('input', function(this: HTMLInputElement) {
    document.getElementById('lbl-height')!.textContent = this.value
    if (!leapState.jumpComplete) setupLeap()
  })

  document.getElementById('sel-target')!.addEventListener('change', () => {
    if (!leapState.jumpComplete) setupLeap()
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    setupLeap()
    isAutoLeaping = false
    document.getElementById('btn-auto')!.classList.remove('active')
  })
}

function doLeap(): void {
  setupLeap()
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAcc = 0

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAcc += dt

  while (tickAcc >= TICK_RATE) {
    tickAcc -= TICK_RATE

    if (isAutoLeaping && leapState.jumpComplete) {
      autoCooldown++
      if (autoCooldown >= 30) {  // wait 30 ticks between leaps
        setupLeap()
        autoCooldown = 0
      }
    }

    if (!leapState.jumpComplete) {
      // Compute position BEFORE incrementing ticks so t=0 uses ticks=0 (origin)
      const pos = getLeapPosition(leapState)
      leaperMesh.position = new Vector3(pos.x, pos.y, pos.z)

      // Tick the leap (increment AFTER position compute)
      leapState.ticks++

      // Check arrival
      if (leapState.ticks >= leapState.totalLength) {
        leapState.jumpComplete = true
        // Attack: flash target red
        const tMat = targetMesh.material as StandardMaterial
        tMat.emissiveColor = new Color3(1, 0.2, 0)
        setTimeout(() => {
          tMat.emissiveColor = new Color3(0, 0, 0)
        }, 200)
      }
    }
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => { engine.resize() })
