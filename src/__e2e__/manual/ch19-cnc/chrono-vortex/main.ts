/**
 * ch19-cnc/chrono-vortex/main.ts — ConyardChronoVortex acceptance test
 *
 * Verifies:
 * 1. Frame cycle: opening(0-15) → loop(16-31) × N → closing(32-47) → complete(48)
 * 2. Position rotates around center: offset {X:171, Y:0, Z:0} rotated by angle
 * 3. angle increments by ANGLE_STEP (default 42) each frame
 * 4. loops counter decrements at frame 32, resets to 16 if loops > 0
 * 5. onCompletion callback fires at frame 48
 *
 * OpenRA source: OpenRA.Mods.Cnc/Effects/ConyardChronoVortex.cs
 * TS source: src/OpenRA.Mods.Cnc/Effects/ConyardChronoVortex.ts
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
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants (mirrors ConyardChronoVortex)
// ---------------------------------------------------------------------------

const VORTEX_SIZE = { width: 64, height: 64 }
const VORTEX_OFFSET = { X: 171, Y: 0, Z: 0 }
const DEFAULT_ANGLE_STEP = 42
const WORLD_SCALE = 1024

// ---------------------------------------------------------------------------
// ConyardChronoVortex (re-implemented for visual testing)
// ---------------------------------------------------------------------------

class ConyardChronoVortex {
  readonly center: { X: number; Y: number; Z: number }
  pos: { X: number; Y: number; Z: number }
  angle: number = 0
  /**
   * Current animation frame. Starts at -1 (IDLE, before first tick).
   * After first tick(): 0-15=opening, 16-31=loop, 32-47=closing, 48+=complete.
   */
  frame: number = -1
  size: { width: number; height: number } = VORTEX_SIZE

  private _loops: number
  private _angleStep: number
  private _isComplete: boolean = false
  private _onCompletion: () => void
  /** Initial loops value preserved for maxFrames calculation. */
  private readonly _initialLoops: number

  /**
   * Create a new ConyardChronoVortex effect.
   *
   * @param center World position of the ConYard center (in WDist units).
   * @param loops Number of loop repetitions (default 3).
   * @param angleStep Angular velocity per tick in WAngle units (default 42).
   * @param onCompletion Callback when vortex finishes (frame reaches 48).
   */
  constructor(
    center: { X: number; Y: number; Z: number },
    loops: number = 3,
    angleStep: number = DEFAULT_ANGLE_STEP,
    onCompletion: () => void = () => {},
  ) {
    this.center = { ...center }
    this._loops = loops
    this._initialLoops = loops
    this._angleStep = angleStep
    this._onCompletion = onCompletion
    this.pos = this._rotatePosition()
  }

  private _rotatePosition(): { X: number; Y: number; Z: number } {
    const rad = (this.angle / 1024) * Math.PI * 2
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return {
      X: this.center.X + VORTEX_OFFSET.X * cos - VORTEX_OFFSET.Y * sin,
      Y: this.center.Y + VORTEX_OFFSET.X * sin + VORTEX_OFFSET.Y * cos,
      Z: this.center.Z + VORTEX_OFFSET.Z,
    }
  }

  tick(): void {
    if (this._isComplete) return

    this.frame++

    // Loop logic
    if (this.frame === 32 && --this._loops > 0) {
      this.frame = 16
    }

    // Rotate position
    this.angle += this._angleStep
    this.pos = this._rotatePosition()

    // Completion
    if (this.frame >= 48) {
      this._isComplete = true
      this._onCompletion()
    }
  }

  get isComplete(): boolean { return this._isComplete }
  get loops(): number { return this._loops }
  /** Total frames for this vortex: opening(16) + loops(16×N) + closing(16). Dynamically reflects user-selected loops count. */
  get maxFrames(): number { return 16 + this._initialLoops * 16 + 16 }

  /** Get the phase name for the current frame. */
  get phaseName(): string {
    if (this._isComplete) return 'COMPLETE'
    if (this.frame < 0) return 'IDLE'
    if (this.frame <= 15) return 'OPENING'
    if (this.frame <= 31) return 'LOOP'
    return 'CLOSING'
  }
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let vortex!: ConyardChronoVortex
let initialLoops: number = 3

// Visual elements
let conyardMesh!: Mesh
let vortexParticle: Mesh | null = null
let trailLine: LinesMesh | null = null
const trailPoints: Vector3[] = []
const MAX_TRAIL = 80
let completionFlashed: boolean = false

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  // Overhead camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 12, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 30

  // Lighting
  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 1.0

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.25, 0.3, 0.25)
  const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  // Grid
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.35, 0.4, 0.35)
  const grid = MeshBuilder.CreateGround('grid', { width: 12, height: 12, subdivisions: 12 }, scene)
  grid.position.y = -0.04
  grid.material = gridMat

  // Construction Yard (center building)
  const buildingMat = new StandardMaterial('buildingMat', scene)
  buildingMat.diffuseColor = new Color3(0.4, 0.45, 0.35)

  // Main building
  const mainBuilding = MeshBuilder.CreateBox('mainBuilding', { width: 1.2, height: 0.8, depth: 1.2 }, scene)
  mainBuilding.position.y = 0.4
  const buildingMat2 = new StandardMaterial('buildingMat2', scene)
  buildingMat2.diffuseColor = new Color3(0.35, 0.4, 0.3)
  mainBuilding.material = buildingMat2

  // Crane arm (conyard feature)
  const craneMat = new StandardMaterial('craneMat', scene)
  craneMat.diffuseColor = new Color3(0.5, 0.5, 0.45)
  const crane = MeshBuilder.CreateBox('crane', { width: 0.15, height: 0.15, depth: 0.7 }, scene)
  crane.position.y = 1.0
  crane.material = craneMat

  // Combine into conyard mesh
  conyardMesh = new Mesh('conyardRoot', scene)
  mainBuilding.parent = conyardMesh
  crane.parent = conyardMesh
  conyardMesh.position = new Vector3(0, 0, 0)

  // Center marker (small red dot)
  const centerMat = new StandardMaterial('centerMat', scene)
  centerMat.diffuseColor = new Color3(1, 0, 0)
  centerMat.emissiveColor = new Color3(0.5, 0, 0)
  const centerDot = MeshBuilder.CreateSphere('centerDot', { diameter: 0.15 }, scene)
  centerDot.material = centerMat

  // Vortex orbit circle (visual reference)
  const orbitRadius = VORTEX_OFFSET.X / WORLD_SCALE
  const orbitPoints: Vector3[] = []
  const segments = 64
  for (let i = 0; i <= segments; i++) {
    const rad = (i / segments) * Math.PI * 2
    orbitPoints.push(new Vector3(Math.cos(rad) * orbitRadius, 0.05, Math.sin(rad) * orbitRadius))
  }
  const orbitLine = MeshBuilder.CreateLines('orbit', { points: orbitPoints }, scene)
  const orbitColor = new Color3(0.2, 0.3, 0.5)
  orbitLine.color = orbitColor

  // Create vortex particle mesh
  vortexParticle = new Mesh('vortexParticle', scene)
  vortexParticle.isVisible = false

  initializeVortex()
}

function initializeVortex(): void {
  vortex = new ConyardChronoVortex(
    { X: 0, Y: 0, Z: 0 },
    initialLoops,
    DEFAULT_ANGLE_STEP,
    () => {
      completionFlashed = true
    },
  )
  trailPoints.length = 0
  completionFlashed = false
  if (vortexParticle) vortexParticle.isVisible = false
  if (trailLine) { trailLine.dispose(); trailLine = null }
}

function createVortexVisual(pos: { X: number; Y: number; Z: number }, frame: number): void {
  if (!vortexParticle) return

  const worldPos = new Vector3(pos.X / WORLD_SCALE, 0.15, pos.Y / WORLD_SCALE)

  // Update particle mesh position and size
  vortexParticle.position = worldPos
  vortexParticle.isVisible = true

  // Scale based on phase (opening: growing, loop: full, closing: shrinking)
  const phase = vortex.phaseName
  let scale: number
  if (phase === 'OPENING') {
    scale = (frame / 16) * 0.3  // 0 → 0.3
  } else if (phase === 'LOOP') {
    scale = 0.3
  } else if (phase === 'CLOSING') {
    scale = ((47 - frame) / 16) * 0.3  // 0.3 → 0
  } else {
    scale = 0
  }
  vortexParticle.scaling = new Vector3(scale, scale, scale)

  // Update particle color (blue → white as it spins)
  const angle = vortex.angle % 1024
  const hueAngle = (angle / 1024) * Math.PI * 2
  const r = 0.2 + 0.3 * (Math.sin(hueAngle) * 0.5 + 0.5)
  const g = 0.3 + 0.4 * (Math.cos(hueAngle) * 0.5 + 0.5)
  const b = 0.5 + 0.4 * (Math.sin(hueAngle + 1) * 0.5 + 0.5)

  if (vortexParticle.material) {
    (vortexParticle.material as StandardMaterial).diffuseColor = new Color3(r, g, b)
    ;(vortexParticle.material as StandardMaterial).emissiveColor = new Color3(r * 0.5, g * 0.5, b * 0.5)
  }

  // Trail
  trailPoints.push(worldPos.clone())
  if (trailPoints.length > MAX_TRAIL) trailPoints.shift()
  updateTrail()
}

function updateTrail(): void {
  if (trailLine) { trailLine.dispose(); trailLine = null as unknown as LinesMesh | null }
  if (trailPoints.length < 2) return

  const lines: Vector3[][] = []
  for (let i = 1; i < trailPoints.length; i++) {
    lines.push([trailPoints[i - 1], trailPoints[i]])
  }

  trailLine = MeshBuilder.CreateLineSystem('trail', { lines }, scene)
  trailLine.color = new Color3(0.4, 0.6, 1.0)
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function computeMaxFrames(loops: number): number { return 16 + loops * 16 + 16 }

function updateStatus(): void {
  document.getElementById('st-frame')!.textContent = String(Math.max(0, vortex.frame))
  document.getElementById('st-maxframe')!.textContent = String(vortex.maxFrames)
  document.getElementById('st-phase')!.textContent = vortex.phaseName
  document.getElementById('st-loops')!.textContent = String(vortex.loops)
  document.getElementById('st-angle')!.textContent = String(vortex.angle % 1024)
  document.getElementById('st-pos')!.textContent =
    `${Math.round(vortex.pos.X)}, ${Math.round(vortex.pos.Y)}, ${Math.round(vortex.pos.Z)}`
  document.getElementById('st-complete')!.textContent = String(vortex.isComplete)
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
  document.getElementById('info-tickrate')!.textContent = '25 ticks/s'
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-start')!.addEventListener('click', () => {
    initializeVortex()
  })

  document.getElementById('sel-loops')!.addEventListener('change', (e) => {
    initialLoops = parseInt((e.target as HTMLSelectElement).value)
    document.getElementById('st-maxframe')!.textContent = String(computeMaxFrames(initialLoops))
  })

  document.getElementById('rng-angle')!.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value
    document.getElementById('lbl-angle')!.textContent = val
  })

  document.getElementById('sel-display')!.addEventListener('change', () => {
    // No action needed - display modes are all active in current impl
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    initializeVortex()
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

// Create vortex visual mesh
const vortexVisMat = new StandardMaterial('vortexVisMat', scene)
vortexVisMat.diffuseColor = new Color3(0.3, 0.5, 0.9)
vortexVisMat.emissiveColor = new Color3(0.15, 0.25, 0.45)
vortexVisMat.alpha = 0.7

const vortexVisSphere = MeshBuilder.CreateSphere('vortexVis', { diameter: 0.3 }, scene)
vortexVisSphere.material = vortexVisMat
if (vortexParticle) {
  (vortexParticle as Mesh).dispose()
  vortexParticle = null
}
vortexParticle = vortexVisSphere
vortexParticle.isVisible = false

let tickAccumulator = 0
const TICK_RATE = 1000 / 25

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAccumulator += dt

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE

    if (!vortex.isComplete && vortex.frame >= -1) {
      // Apply configured angle step from slider
      const angleStep = parseInt((document.getElementById('rng-angle') as HTMLInputElement).value)
      vortex['_angleStep'] = angleStep
      vortex.tick()
    }

    // Flash on completion
    if (completionFlashed && vortex.isComplete) {
      completionFlashed = false
      setTimeout(() => {
        if (vortexParticle) vortexParticle.isVisible = false
      }, 500)
    }
  }

  // Update visual position
  if (vortex.frame >= 0 && !vortex.isComplete) {
    createVortexVisual(vortex.pos, vortex.frame)
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})
