/**
 * ch19-cnc/voxel-body/main.ts — Multi-part voxel model hierarchy acceptance test
 *
 * Verifies:
 * 1. TransformNode parent-child hierarchy: body(root) → turret(child) → barrel(grandchild)
 * 2. Body facing rotation (WAngle, 0=North=negative Z, counterclockwise from top)
 * 3. Turret yaw relative to body (clockwise from top-down view = positive)
 * 4. Barrel recoil offset chain: local offset → turret transform → body transform → world
 * 5. Hierarchical rotation propagation: turret inherits body rotation, barrel inherits both
 *
 * OpenRA source: OpenRA.Mods.Cnc/Traits/Render/{RenderVoxels,WithVoxelBody,WithVoxelTurret,WithVoxelBarrel}.cs
 * TS source: src/OpenRA.Mods.Cnc/Traits/Render/{RenderVoxels,WithVoxelBody,WithVoxelTurret,WithVoxelBarrel}.ts
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
  LinesMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// WAngle / WRot constants (mirrors OpenRA WAngle.ts)
// ---------------------------------------------------------------------------

const WANGLE_MAX = 1024

function wangleToRadians(wangle: number): number {
  // WAngle 0 = North = negative Z direction
  // Angle increases counterclockwise from top-down view
  // Standard: angle = 2*PI * wangle / 1024
  // But North is -Z, so we need offset: rotate by -PI/2 to map 0 → -Z
  return (wangle / WANGLE_MAX) * Math.PI * 2
}

function wangleToDirectionName(wangle: number): string {
  const normalized = ((wangle % WANGLE_MAX) + WANGLE_MAX) % WANGLE_MAX
  if (normalized < 64 || normalized >= 960) return 'N'
  if (normalized >= 64 && normalized < 192) return 'NE'
  if (normalized >= 192 && normalized < 320) return 'E'
  if (normalized >= 320 && normalized < 448) return 'SE'
  if (normalized >= 448 && normalized < 576) return 'S'
  if (normalized >= 576 && normalized < 704) return 'SW'
  if (normalized >= 704 && normalized < 832) return 'W'
  return 'NW'
}

// ---------------------------------------------------------------------------
// Unit model constants (mirrors default RenderVoxelsInfo)
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const TURRET_OFFSET = { X: 0, Y: 0, Z: 0.3 } // Turret sits on top of body
const BARREL_LOCAL_OFFSET = { X: 0.6, Y: 0, Z: 0 } // Barrel extends forward from turret

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene

// Visual hierarchy elements
let rootNode!: TransformNode  // Represents the actor
let bodyNode!: TransformNode
let turretNode!: TransformNode
let barrelNode!: TransformNode

let bodyMesh!: Mesh
let turretMesh!: Mesh
let barrelMesh!: Mesh

// Hierarchy lines
let bodyToTurretLine: LinesMesh | null = null
let turretToBarrelLine: LinesMesh | null = null

// State
let bodyFacing: number = 0  // WAngle
let turretYaw: number = 0   // WAngle (relative to body)
let recoil: number = 0      // WDist
let isAutoAnimating: boolean = false
let isPaused: boolean = false
let autoTick: number = 0

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  // Overhead camera — default look-down at an angle
  const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 10, new Vector3(0, 0.5, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 25

  // Lighting
  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 0.8
  const dirLight = new HemisphericLight('dir', new Vector3(-0.5, 0.8, -0.3), scene)
  dirLight.intensity = 0.4
  dirLight.diffuse = new Color3(0.4, 0.4, 0.6)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  // Grid for orientation reference
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.3, 0.35, 0.3)
  const grid = MeshBuilder.CreateGround('grid', { width: 12, height: 12, subdivisions: 12 }, scene)
  grid.position.y = -0.04
  grid.material = gridMat

  // Direction markers
  createDirectionMarkers()

  // Build hierarchy
  buildModelHierarchy()
  updateHierarchyVisuals()
}

function createDirectionMarkers(): void {
  // N, S, E, W markers on ground
  const markerMat = (r: number, g: number, b: number) => {
    const m = new StandardMaterial('marker', scene)
    m.diffuseColor = new Color3(r, g, b)
    m.emissiveColor = new Color3(r * 0.5, g * 0.5, b * 0.5)
    return m
  }

  const positions = [
    { pos: new Vector3(0, 0.02, -2.5), color: [0, 0.5, 1], label: 'N (0)' },
    { pos: new Vector3(2.5, 0.02, 0), color: [1, 0.3, 0], label: 'E (256)' },
    { pos: new Vector3(0, 0.02, 2.5), color: [1, 0, 0], label: 'S (512)' },
    { pos: new Vector3(-2.5, 0.02, 0), color: [0.8, 0.8, 0], label: 'W (768)' },
  ]

  for (const p of positions) {
    const marker = MeshBuilder.CreateSphere('dirMarker', { diameter: 0.12 }, scene)
    marker.position = p.pos
    marker.material = markerMat(p.color[0], p.color[1], p.color[2])
  }
}

// ---------------------------------------------------------------------------
// Model Hierarchy Construction (mirrors RenderVoxels + WithVoxel* traits)
// ---------------------------------------------------------------------------

function buildModelHierarchy(): void {
  // Root actor node
  rootNode = new TransformNode('actorRoot', scene)
  rootNode.position = new Vector3(0, 0, 0)

  // Body — root voxel limb (WithVoxelBody)
  // Body offset: {X:0, Y:0, Z:0} from actor center
  bodyNode = new TransformNode('bodyNode', scene)
  bodyNode.parent = rootNode

  // Body mesh — cyan tank hull shape
  const bodyVisMat = new StandardMaterial('bodyMat', scene)
  bodyVisMat.diffuseColor = new Color3(0.1, 0.5, 0.7)  // Cyan
  bodyVisMat.emissiveColor = new Color3(0.05, 0.15, 0.2)

  bodyMesh = new Mesh('bodyMesh', scene)
  // Create a composite tank hull: main box + treads
  const hull = MeshBuilder.CreateBox('hull', { width: 1.8, height: 0.5, depth: 2.4 }, scene)
  hull.position.y = 0.35
  hull.material = bodyVisMat

  // Treads
  const treadMat = new StandardMaterial('treadMat', scene)
  treadMat.diffuseColor = new Color3(0.15, 0.15, 0.15)
  const leftTread = MeshBuilder.CreateBox('leftTread', { width: 0.3, height: 0.3, depth: 2.6 }, scene)
  leftTread.position = new Vector3(-1.0, 0.15, 0)
  leftTread.material = treadMat
  leftTread.parent = bodyMesh

  const rightTread = MeshBuilder.CreateBox('rightTread', { width: 0.3, height: 0.3, depth: 2.6 }, scene)
  rightTread.position = new Vector3(1.0, 0.15, 0)
  rightTread.material = treadMat
  rightTread.parent = bodyMesh

  hull.parent = bodyMesh
  bodyMesh.parent = bodyNode

  // Turret — child of body (WithVoxelTurret)
  // Turret offset: {X:0, Y:0, Z:0.3} WVec from body center
  turretNode = new TransformNode('turretNode', scene)
  turretNode.parent = bodyNode
  turretNode.position = new Vector3(
    TURRET_OFFSET.X / WORLD_SCALE,
    TURRET_OFFSET.Y / WORLD_SCALE + 0.45,  // Visual offset: sit on top of hull
    TURRET_OFFSET.Z / WORLD_SCALE,
  )

  // Turret mesh — orange
  const turretVisMat = new StandardMaterial('turretMat', scene)
  turretVisMat.diffuseColor = new Color3(0.8, 0.45, 0.1)  // Orange
  turretVisMat.emissiveColor = new Color3(0.2, 0.1, 0.02)

  turretMesh = new Mesh('turretMesh', scene)
  const turretBase = MeshBuilder.CreateCylinder('turretBase', { height: 0.35, diameterTop: 0.9, diameterBottom: 1.1, tessellation: 8 }, scene)
  turretBase.position.y = 0.175
  turretBase.material = turretVisMat
  const turretTop = MeshBuilder.CreateBox('turretTop', { width: 0.7, height: 0.25, depth: 0.5 }, scene)
  turretTop.position.y = 0.45
  turretTop.material = turretVisMat
  turretBase.parent = turretMesh
  turretTop.parent = turretMesh
  turretMesh.parent = turretNode

  // Barrel — child of turret (WithVoxelBarrel)
  // Barrel local offset: {X:0.6, Y:0, Z:0} WVec relative to turret
  barrelNode = new TransformNode('barrelNode', scene)
  barrelNode.parent = turretNode
  barrelNode.position = new Vector3(
    BARREL_LOCAL_OFFSET.X / WORLD_SCALE,
    BARREL_LOCAL_OFFSET.Y / WORLD_SCALE,
    BARREL_LOCAL_OFFSET.Z / WORLD_SCALE,
  )

  // Barrel mesh — red
  const barrelVisMat = new StandardMaterial('barrelMat', scene)
  barrelVisMat.diffuseColor = new Color3(0.85, 0.1, 0.1)  // Red
  barrelVisMat.emissiveColor = new Color3(0.25, 0.02, 0.02)

  barrelMesh = new Mesh('barrelMesh', scene)
  const barrelTube = MeshBuilder.CreateCylinder('barrelTube', { height: 1.4, diameter: 0.15, tessellation: 8 }, scene)
  barrelTube.position.z = 0.7  // Extends forward from turret center
  barrelTube.rotation.x = Math.PI / 2  // Rotate to point forward (Z axis)
  barrelTube.material = barrelVisMat
  barrelTube.parent = barrelMesh
  barrelMesh.parent = barrelNode
}

// ---------------------------------------------------------------------------
// Transform Updates (mirrors RenderVoxels tick + ModelAnimation calls)
// ---------------------------------------------------------------------------

function applyBodyFacing(wangle: number): void {
  bodyFacing = ((wangle % WANGLE_MAX) + WANGLE_MAX) % WANGLE_MAX
  // WAngle 0 = North = -Z direction
  // Convert WAngle to rotation around Y axis:
  //   WAngle 0   → facing -Z → rotation.y = PI
  //   WAngle 256 → facing +X → rotation.y = PI/2
  //   WAngle 512 → facing +Z → rotation.y = 0
  //   WAngle 768 → facing -X → rotation.y = 3PI/2
  // Formula: rotation.y = PI - radians  (since wangle increases CCW from North,
  //   but Babylon.js rotation.y increases CCW from +Z/South)
  const radians = wangleToRadians(bodyFacing)
  bodyNode.rotation.y = Math.PI - radians
}

function applyTurretYaw(yaw: number): void {
  turretYaw = yaw
  // Turret yaw is relative to body local coordinates
  // Positive yaw = clockwise from top-down view
  const radians = (turretYaw / WANGLE_MAX) * Math.PI * 2
  turretNode.rotation.y = radians
}

function applyBarrelRecoil(recoilAmount: number): void {
  recoil = recoilAmount
  // Recoil: subtract from barrel's forward (X) axis in local coordinates
  // OpenRA: new WVec(-armament.Recoil, WDist.Zero, WDist.Zero)
  // In Babylon.js, the barrel extends along Z, so recoil pushes back along -Z
  const localRecoil = -recoilAmount / WORLD_SCALE
  barrelNode.position = new Vector3(
    BARREL_LOCAL_OFFSET.X / WORLD_SCALE,
    BARREL_LOCAL_OFFSET.Y / WORLD_SCALE,
    BARREL_LOCAL_OFFSET.Z / WORLD_SCALE + localRecoil,
  )
}

function getBarrelWorldOffset(): Vector3 {
  // Compute the full transform chain to get barrel world position
  const worldMatrix = barrelMesh.getWorldMatrix()
  const pos = new Vector3()
  worldMatrix.getTranslationToRef(pos)
  return pos.subtract(rootNode.position)
}

// ---------------------------------------------------------------------------
// Hierarchy Visual Connectors (lines showing parent-child relationships)
// ---------------------------------------------------------------------------

function updateHierarchyLines(): void {
  // Dispose old lines
  if (bodyToTurretLine) { bodyToTurretLine.dispose(); bodyToTurretLine = null }
  if (turretToBarrelLine) { turretToBarrelLine.dispose(); turretToBarrelLine = null }

  const bodyPos = bodyNode.getAbsolutePosition()
  const turretPos = turretNode.getAbsolutePosition()
  const barrelPos = barrelNode.getAbsolutePosition()

  // Body → Turret line (white)
  bodyToTurretLine = MeshBuilder.CreateLines('bodyTurreLine', {
    points: [bodyPos, turretPos],
  }, scene)
  bodyToTurretLine.color = new Color3(1, 1, 1)

  // Turret → Barrel line (yellow)
  turretToBarrelLine = MeshBuilder.CreateLines('turretBarrelLine', {
    points: [turretPos, barrelPos],
  }, scene)
  turretToBarrelLine.color = new Color3(1, 0.8, 0.2)
}

function updateHierarchyVisuals(): void {
  updateHierarchyLines()
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  const bodyAngle = ((bodyFacing % WANGLE_MAX) + WANGLE_MAX) % WANGLE_MAX
  document.getElementById('st-body')!.textContent = String(bodyAngle)
  document.getElementById('st-body-dir')!.textContent = wangleToDirectionName(bodyAngle)
  document.getElementById('st-turret')!.textContent = String(turretYaw)
  document.getElementById('st-recoil')!.textContent = String(recoil)

  const barrelWorld = getBarrelWorldOffset()
  document.getElementById('st-barrel-offset')!.textContent =
    `${barrelWorld.x.toFixed(2)}, ${barrelWorld.y.toFixed(2)}, ${barrelWorld.z.toFixed(2)}`

  document.getElementById('st-hierarchy')!.textContent =
    `body→turret=${turretNode.getAbsolutePosition().subtract(bodyNode.getAbsolutePosition()).length().toFixed(2)} world-units; ` +
    `turret→barrel=${barrelNode.getAbsolutePosition().subtract(turretNode.getAbsolutePosition()).length().toFixed(2)} world-units`
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
  const btnAuto = document.getElementById('btn-auto')!
  const btnPause = document.getElementById('btn-pause')!
  const rngBody = document.getElementById('rng-body') as HTMLInputElement
  const rngTurret = document.getElementById('rng-turret') as HTMLInputElement
  const rngRecoil = document.getElementById('rng-recoil') as HTMLInputElement
  const btnFire = document.getElementById('btn-fire')!
  const btnReset = document.getElementById('btn-reset')!

  btnAuto.addEventListener('click', () => {
    isAutoAnimating = !isAutoAnimating
    isPaused = false
    btnAuto.classList.toggle('active', isAutoAnimating)
    btnPause.textContent = '暂停'
    if (isAutoAnimating) autoTick = 0
  })

  btnPause.addEventListener('click', () => {
    if (!isAutoAnimating) return
    isPaused = !isPaused
    btnPause.textContent = isPaused ? '继续' : '暂停'
  })

  rngBody.addEventListener('input', () => {
    if (isAutoAnimating) { isAutoAnimating = false; btnAuto.classList.remove('active') }
    const val = parseInt(rngBody.value)
    applyBodyFacing(val)
    document.getElementById('lbl-body')!.textContent = `${val} (${wangleToDirectionName(val)})`
  })

  rngTurret.addEventListener('input', () => {
    if (isAutoAnimating) { isAutoAnimating = false; btnAuto.classList.remove('active') }
    const val = parseInt(rngTurret.value)
    applyTurretYaw(val)
    document.getElementById('lbl-turret')!.textContent = String(val)
  })

  rngRecoil.addEventListener('input', () => {
    if (isAutoAnimating) { isAutoAnimating = false; btnAuto.classList.remove('active') }
    const val = parseInt(rngRecoil.value)
    applyBarrelRecoil(val)
    document.getElementById('lbl-recoil')!.textContent = String(val)
  })

  btnFire.addEventListener('click', () => {
    // Simulate firing: immediate recoil + gradual recovery
    applyBarrelRecoil(120)
    document.getElementById('lbl-recoil')!.textContent = '120'
    ;(document.getElementById('rng-recoil') as HTMLInputElement).value = '120'
  })

  btnReset.addEventListener('click', () => {
    isAutoAnimating = false
    isPaused = false
    btnAuto.classList.remove('active')
    btnPause.textContent = '暂停'
    autoTick = 0
    applyBodyFacing(0)
    applyTurretYaw(0)
    applyBarrelRecoil(0)
    ;(document.getElementById('rng-body') as HTMLInputElement).value = '0'
    ;(document.getElementById('rng-turret') as HTMLInputElement).value = '0'
    ;(document.getElementById('rng-recoil') as HTMLInputElement).value = '0'
    document.getElementById('lbl-body')!.textContent = '0 (N)'
    document.getElementById('lbl-turret')!.textContent = '0'
    document.getElementById('lbl-recoil')!.textContent = '0'
  })
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0
const TICK_RATE = 1000 / 25  // 25 ticks/s

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAccumulator += dt

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE

    // Recoil decay (simulates OpenRA armament recoil recovery)
    if (recoil > 0) {
      recoil = Math.max(0, recoil - 8)
      applyBarrelRecoil(recoil)
      ;(document.getElementById('rng-recoil') as HTMLInputElement).value = String(Math.round(recoil))
      document.getElementById('lbl-recoil')!.textContent = String(Math.round(recoil))
    }

    // Auto animation
    if (isAutoAnimating && !isPaused) {
      autoTick++

      // Body rotates continuously: +8 WAngle per tick (goes through all 8 classic directions)
      const bodyAngle = (autoTick * 8) % WANGLE_MAX
      applyBodyFacing(bodyAngle)
      ;(document.getElementById('rng-body') as HTMLInputElement).value = String(bodyAngle)
      document.getElementById('lbl-body')!.textContent = `${bodyAngle} (${wangleToDirectionName(bodyAngle)})`

      // Turret yaw follows a sine wave: ±64 WAngle
      const turretAngle = Math.round(Math.sin(autoTick * 0.08) * 64)
      applyTurretYaw(turretAngle)
      ;(document.getElementById('rng-turret') as HTMLInputElement).value = String(turretAngle)
      document.getElementById('lbl-turret')!.textContent = String(turretAngle)

      // Fire periodically
      if (autoTick % 50 === 0) {
        recoil = 150
        document.getElementById('lbl-recoil')!.textContent = '150'
        ;(document.getElementById('rng-recoil') as HTMLInputElement).value = '150'
      }
    }

    // Update hierarchy connector lines only on ticks (not every frame)
    updateHierarchyVisuals()
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})
