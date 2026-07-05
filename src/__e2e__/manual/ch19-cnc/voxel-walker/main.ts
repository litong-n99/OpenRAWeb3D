/**
 * ch19-cnc/voxel-walker/main.ts — Voxel walker body animation acceptance test
 *
 * Verifies:
 * 1. Three movement states: Idle (breathing), Walking (alternating legs), Turning (body rotation)
 * 2. Limb TransformNode per-frame updates via tick callbacks
 * 3. Left/right leg phase-difference (180 degrees out of phase during walking)
 * 4. Body Y-axis float during idle (breathing effect)
 * 5. Foot-ground contact detection (leg Y position changes foot color)
 *
 * OpenRA source: OpenRA.Mods.Cnc/Traits/Render/WithVoxelWalkerBody.cs (106 lines)
 * TS source: deferred — represented here as visual acceptance model
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
  TransformNode,
  Mesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WANGLE_MAX = 1024
const TICK_RATE = 1000 / 25

const WalkerState = {
  Idle: 'Idle',
  Walking: 'Walking',
  Turning: 'Turning',
} as const
type WalkerState = (typeof WalkerState)[keyof typeof WalkerState]

function wangleToRadians(wangle: number): number {
  // BUGFIX ch14 guard: add -PI/2 offset so WAngle 0 (North=-Z) maps correctly
  return (wangle / WANGLE_MAX) * Math.PI * 2 - Math.PI / 2
}

function wangleToDir(wangle: number): string {
  const n = ((wangle % WANGLE_MAX) + WANGLE_MAX) % WANGLE_MAX
  if (n < 64 || n >= 960) return 'N'
  if (n >= 64 && n < 192) return 'NE'
  if (n >= 192 && n < 320) return 'E'
  if (n >= 320 && n < 448) return 'SE'
  if (n >= 448 && n < 576) return 'S'
  if (n >= 576 && n < 704) return 'SW'
  if (n >= 704 && n < 832) return 'W'
  return 'NW'
}

// ---------------------------------------------------------------------------
// Walker Model
// ---------------------------------------------------------------------------

interface LimbState {
  node: TransformNode
  mesh: Mesh
  basePos: Vector3
  angle: number
}

class WalkerModel {
  bodyNode: TransformNode
  bodyMesh: Mesh
  leftLeg: LimbState
  rightLeg: LimbState
  leftFoot: Mesh
  rightFoot: Mesh
  state: WalkerState = WalkerState.Idle
  frame: number = 0
  cycleLength: number = 12 // ticks per animation cycle
  heading: number = 0 // WAngle
  bodyYOffset: number = 0
  // Track materials for proper disposal
  private materials: StandardMaterial[] = []

  constructor(scene: Scene) {
    // Body
    this.bodyNode = new TransformNode('walkerBody', scene)

    const bodyMat = new StandardMaterial('walkerBodyMat', scene)
    bodyMat.diffuseColor = new Color3(0.3, 0.5, 0.4)
    bodyMat.emissiveColor = new Color3(0.05, 0.1, 0.08)
    this.materials.push(bodyMat)

    this.bodyMesh = new Mesh('walkerBodyMesh', scene)
    const torso = MeshBuilder.CreateBox('torso', { width: 1.0, height: 0.7, depth: 0.8 }, scene)
    torso.position.y = 1.2
    torso.material = bodyMat
    // Head
    const headMat = new StandardMaterial('headMat', scene)
    headMat.diffuseColor = new Color3(0.4, 0.6, 0.5)
    this.materials.push(headMat)
    const head = MeshBuilder.CreateBox('head', { width: 0.4, height: 0.35, depth: 0.4 }, scene)
    head.position.y = 1.7
    head.material = headMat
    head.parent = this.bodyMesh
    torso.parent = this.bodyMesh
    this.bodyMesh.parent = this.bodyNode

    // Left Leg
    const leftLegNode = new TransformNode('leftLeg', scene)
    leftLegNode.parent = this.bodyNode
    leftLegNode.position = new Vector3(-0.3, 0.85, 0)

    const leftLegMat = new StandardMaterial('leftLegMat', scene)
    leftLegMat.diffuseColor = new Color3(0.25, 0.4, 0.35)
    this.materials.push(leftLegMat)
    const leftLegMesh = MeshBuilder.CreateBox('leftLegMesh', { width: 0.2, height: 0.6, depth: 0.2 }, scene)
    leftLegMesh.position.y = -0.3
    leftLegMesh.material = leftLegMat
    leftLegMesh.parent = leftLegNode

    // Left Foot
    const leftFootMat = new StandardMaterial('leftFootMat', scene)
    leftFootMat.diffuseColor = new Color3(0.2, 0.53, 0.2)
    this.materials.push(leftFootMat)
    this.leftFoot = MeshBuilder.CreateBox('leftFoot', { width: 0.25, height: 0.1, depth: 0.3 }, scene)
    this.leftFoot.position.y = -0.65
    this.leftFoot.material = leftFootMat
    this.leftFoot.parent = leftLegNode

    this.leftLeg = {
      node: leftLegNode,
      mesh: leftLegMesh,
      basePos: leftLegNode.position.clone(),
      angle: 0,
    }

    // Right Leg
    const rightLegNode = new TransformNode('rightLeg', scene)
    rightLegNode.parent = this.bodyNode
    rightLegNode.position = new Vector3(0.3, 0.85, 0)

    const rightLegMat = new StandardMaterial('rightLegMat', scene)
    rightLegMat.diffuseColor = new Color3(0.25, 0.4, 0.35)
    this.materials.push(rightLegMat)
    const rightLegMesh = MeshBuilder.CreateBox('rightLegMesh', { width: 0.2, height: 0.6, depth: 0.2 }, scene)
    rightLegMesh.position.y = -0.3
    rightLegMesh.material = rightLegMat
    rightLegMesh.parent = rightLegNode

    const rightFootMat = new StandardMaterial('rightFootMat', scene)
    rightFootMat.diffuseColor = new Color3(0.2, 0.53, 0.2)
    this.materials.push(rightFootMat)
    this.rightFoot = MeshBuilder.CreateBox('rightFoot', { width: 0.25, height: 0.1, depth: 0.3 }, scene)
    this.rightFoot.position.y = -0.65
    this.rightFoot.material = rightFootMat
    this.rightFoot.parent = rightLegNode

    this.rightLeg = {
      node: rightLegNode,
      mesh: rightLegMesh,
      basePos: rightLegNode.position.clone(),
      angle: 0,
    }
  }

  tick(state: WalkerState, heading: number): void {
    this.state = state
    this.heading = heading
    this.frame = (this.frame + 1) % this.cycleLength
    const t = this.frame / this.cycleLength

    switch (state) {
      case WalkerState.Idle:
        this.tickIdle(t)
        break
      case WalkerState.Walking:
        this.tickWalking(t)
        break
      case WalkerState.Turning:
        this.tickTurning(t)
        break
    }

    // Update body rotation
    this.bodyNode.rotation.y = wangleToRadians(heading)

    // Update foot colors based on ground proximity
    this.updateFootColors()
  }

  private tickIdle(t: number): void {
    // Breathing: body bobs ±0.05
    const breathe = Math.sin(t * Math.PI * 2) * 0.05
    this.bodyMesh.position.y = breathe
    this.bodyYOffset = breathe

    // Legs stationary, slight spread
    this.leftLeg.angle = 0.05
    this.rightLeg.angle = -0.05

    const leftRot = this.leftLeg.angle
    const rightRot = this.rightLeg.angle
    this.leftLeg.node.rotation.x = leftRot
    this.rightLeg.node.rotation.x = rightRot
    this.leftLeg.node.position = this.leftLeg.basePos.clone()
    this.rightLeg.node.position = this.rightLeg.basePos.clone()
  }

  private tickWalking(t: number): void {
    // Walking: alternating legs, 180 degree phase shift
    // Left leg: sin(t * 2*PI), Right leg: sin(t * 2*PI + PI)
    const leftAngle = Math.sin(t * Math.PI * 2) * 0.25
    const rightAngle = Math.sin(t * Math.PI * 2 + Math.PI) * 0.25

    this.leftLeg.angle = leftAngle
    this.rightLeg.angle = rightAngle

    this.leftLeg.node.rotation.x = leftAngle
    this.rightLeg.node.rotation.x = rightAngle

    // Body bobs with walking rhythm — twice the frequency
    const bodyBounce = Math.abs(Math.sin(t * Math.PI * 4)) * 0.08
    this.bodyMesh.position.y = bodyBounce
    this.bodyYOffset = bodyBounce

    // Move the walker forward slightly each tick
    const moveSpeed = 0.02
    const headingRad = wangleToRadians(this.heading)
    // BUGFIX: match wangleToRadians -PI/2 offset — cos for X, sin for Z
    this.bodyNode.position.x += Math.cos(headingRad) * moveSpeed
    this.bodyNode.position.z += Math.sin(headingRad) * moveSpeed
  }

  private tickTurning(t: number): void {
    // Turning: outer leg has larger swing amplitude
    const outerAmplitude = 0.35
    const innerAmplitude = 0.15

    // Alternate which leg is "outer"
    const halfCycle = Math.floor(t * 2) % 2 === 0

    const leftAngle = Math.sin(t * Math.PI * 2) * (halfCycle ? outerAmplitude : innerAmplitude)
    const rightAngle = Math.sin(t * Math.PI * 2) * (halfCycle ? innerAmplitude : outerAmplitude)

    this.leftLeg.angle = leftAngle
    this.rightLeg.angle = rightAngle

    this.leftLeg.node.rotation.x = leftAngle
    this.rightLeg.node.rotation.x = rightAngle

    this.bodyMesh.position.y = 0
    this.bodyYOffset = 0

    // Rotate heading during turning animation
    const turnRate = 4  // WAngle per tick
    this.heading = ((this.heading + turnRate) % WANGLE_MAX + WANGLE_MAX) % WANGLE_MAX
  }

  dispose(): void {
    // Dispose root node: recursively disposes all children (meshes, limbs, feet)
    this.bodyNode.dispose()
    // Dispose all tracked materials (not auto-disposed by mesh dispose by default)
    for (const mat of this.materials) {
      mat.dispose()
    }
    this.materials = []
  }

  private updateFootColors(): void {
    // Ground level is at y ≈ -0.65 for feet
    // When leg angle is near 0, foot is flat on ground
    const leftGroundDist = Math.abs(Math.sin(this.leftLeg.angle) * 0.6)
    const rightGroundDist = Math.abs(Math.sin(this.rightLeg.angle) * 0.6)

    // Near ground (< 0.02): bright green, else: dark green
    const leftBright = leftGroundDist < 0.02
    const rightBright = rightGroundDist < 0.02

    const matL = this.leftFoot.material as StandardMaterial
    const matR = this.rightFoot.material as StandardMaterial
    matL.emissiveColor = leftBright ? new Color3(0.3, 0.5, 0.3) : new Color3(0, 0, 0)
    matR.emissiveColor = rightBright ? new Color3(0.3, 0.5, 0.3) : new Color3(0, 0, 0)
  }
}

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let walker!: WalkerModel

let currentState: WalkerState = WalkerState.Idle
let targetHeading: number = 0

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  const camera = new ArcRotateCamera('camera', -Math.PI / 4, Math.PI / 3, 8, new Vector3(0, 0.8, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 20

  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 0.8

  // Ground with grid
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  const ground = MeshBuilder.CreateGround('ground', { width: 16, height: 16 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.3, 0.35, 0.3)
  const grid = MeshBuilder.CreateGround('grid', { width: 16, height: 16, subdivisions: 16 }, scene)
  grid.position.y = -0.04
  grid.material = gridMat

  // Direction markers
  createDirectionMarkers()

  // Build walker
  walker = new WalkerModel(scene)
}

function createDirectionMarkers(): void {
  const markers = [
    { x: 0, z: -3, label: 'N', r: 0, g: 0.5, b: 1 },
    { x: 3, z: 0, label: 'E', r: 1, g: 0.3, b: 0 },
    { x: 0, z: 3, label: 'S', r: 1, g: 0, b: 0 },
    { x: -3, z: 0, label: 'W', r: 0.8, g: 0.8, b: 0 },
  ]
  for (const m of markers) {
    const mat = new StandardMaterial('mk', scene)
    mat.diffuseColor = new Color3(m.r, m.g, m.b)
    mat.emissiveColor = new Color3(m.r * 0.5, m.g * 0.5, m.b * 0.5)
    const s = MeshBuilder.CreateSphere('mk', { diameter: 0.12 }, scene)
    s.position = new Vector3(m.x, 0.02, m.z)
    s.material = mat
  }
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-state')!.textContent = walker.state
  document.getElementById('st-frame')!.textContent = String(walker.frame)
  document.getElementById('st-cycle')!.textContent = String(walker.cycleLength)
  document.getElementById('st-legL')!.textContent = walker.leftLeg.angle.toFixed(2)
  document.getElementById('st-legR')!.textContent = walker.rightLeg.angle.toFixed(2)
  document.getElementById('st-bodyY')!.textContent = walker.bodyYOffset.toFixed(3)
  const h = ((walker.heading % WANGLE_MAX) + WANGLE_MAX) % WANGLE_MAX
  document.getElementById('st-heading')!.textContent = String(h)
  document.getElementById('st-dir')!.textContent = wangleToDir(h)
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
  const btnIdle = document.getElementById('btn-idle')!
  const btnWalk = document.getElementById('btn-walk')!
  const btnTurn = document.getElementById('btn-turn')!
  const rngSpeed = document.getElementById('rng-speed') as HTMLInputElement
  const selDir = document.getElementById('sel-dir') as HTMLSelectElement

  btnIdle.addEventListener('click', () => {
    currentState = WalkerState.Idle
    updateActiveButton('btn-idle')
  })

  btnWalk.addEventListener('click', () => {
    currentState = WalkerState.Walking
    targetHeading = parseInt(selDir.value)
    updateActiveButton('btn-walk')
  })

  btnTurn.addEventListener('click', () => {
    currentState = WalkerState.Turning
    updateActiveButton('btn-turn')
  })

  rngSpeed.addEventListener('input', () => {
    walker.cycleLength = parseInt(rngSpeed.value)
    document.getElementById('lbl-speed')!.textContent = `${rngSpeed.value} tick/周期`
    walker.frame = walker.frame % walker.cycleLength
  })

  selDir.addEventListener('change', () => {
    targetHeading = parseInt(selDir.value)
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    currentState = WalkerState.Idle
    targetHeading = 0 // BUGFIX: reset heading to North
    walker.dispose()
    walker = new WalkerModel(scene)
    walker.bodyNode.position = Vector3.Zero()
    updateActiveButton('btn-idle')
    document.getElementById('lbl-speed')!.textContent = '12 tick/周期'
    ;(rngSpeed as HTMLInputElement).value = '12'
    walker.cycleLength = 12
    ;(selDir as HTMLSelectElement).value = '0' // BUGFIX: reset dropdown
  })
}

function updateActiveButton(activeId: string): void {
  for (const id of ['btn-idle', 'btn-walk', 'btn-turn']) {
    document.getElementById(id)!.classList.toggle('active', id === activeId)
  }
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

    // Update walker state and heading
    walker.tick(currentState, currentState === WalkerState.Turning ? walker.heading : targetHeading)
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => { engine.resize() })
