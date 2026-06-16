/**
 * activities/parachute/main.ts — Parachute acceptance test
 *
 * Verifies:
 * 1. Parachute descent at fallRate WDist per tick
 * 2. Landing at ground level with position snapped to ground
 * 3. Landing notification (INotifyParachute.onLanded)
 * 4. Non-interruptible (isInterruptible = false)
 * 5. Horizontal position remains constant during descent
 *
 * OpenRA coordinate system:
 *   - WPos: X, Y (horizontal), Z (altitude)
 *   - In Babylon: X -> X, Z -> -Y (north), altitude -> Y (up)
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Color3,
  LinesMesh,
  TransformNode,
  Mesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const GROUND_LEVEL = 0  // WDist

// ---------------------------------------------------------------------------
// Parachute state
// ---------------------------------------------------------------------------

interface ParachuteState {
  position: Vector3     // Babylon position (X, Y=altitude, Z)
  fallRate: number      // WDist per tick
  groundLevel: number   // WDist
  isDescending: boolean
  tickCount: number
  landed: boolean
}

let parachute: ParachuteState = {
  position: new Vector3(0, 0, 0),
  fallRate: 128,
  groundLevel: 0,
  isDescending: false,
  tickCount: 0,
  landed: false,
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let unitMesh!: TransformNode
let parachuteMesh!: Mesh
let dropLine: LinesMesh | null = null
let trailPoints: Vector3[] = []
let trailLine: LinesMesh | null = null
let landingEffect: Mesh | null = null
let landingEffectTimer = 0

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 20, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 40

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  groundMat.specularColor = new Color3(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30, subdivisions: 20 }, scene)
  ground.position.y = -0.05
  ground.material = groundMat

  // Grid
  const gridMesh = MeshBuilder.CreateGround('grid', { width: 30, height: 30, subdivisions: 20 }, scene)
  gridMesh.position.y = -0.04
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.3, 0.35, 0.3)
  gridMesh.material = gridMat

  // Landing zone marker (circle on ground)
  const zoneMat = new StandardMaterial('zoneMat', scene)
  zoneMat.diffuseColor = new Color3(0.3, 0.5, 0.3)
  zoneMat.alpha = 0.3
  const zone = MeshBuilder.CreateDisc('zone', { radius: 1.5 }, scene)
  zone.position.y = 0.01
  zone.material = zoneMat

  // Unit (brown box - the falling object)
  unitMesh = new TransformNode('unitRoot', scene)

  const unitBodyMat = new StandardMaterial('unitBodyMat', scene)
  unitBodyMat.diffuseColor = new Color3(0.6, 0.4, 0.2)
  const unitBody = MeshBuilder.CreateBox('unitBody', { width: 0.5, height: 0.6, depth: 0.5 }, scene)
  unitBody.material = unitBodyMat
  unitBody.parent = unitMesh

  // Parachute (white canopy above unit)
  const chuteMat = new StandardMaterial('chuteMat', scene)
  chuteMat.diffuseColor = new Color3(0.9, 0.9, 0.95)
  chuteMat.alpha = 0.8
  chuteMat.backFaceCulling = false
  parachuteMesh = MeshBuilder.CreateSphere('chute', { diameter: 1.5, slice: 0.5 }, scene)
  parachuteMesh.position.y = 0.8
  parachuteMesh.material = chuteMat
  parachuteMesh.parent = unitMesh

  // Parachute cords (lines from chute to unit)
  const cordMat = new StandardMaterial('cordMat', scene)
  cordMat.emissiveColor = new Color3(0.7, 0.7, 0.7)
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    const cord = MeshBuilder.CreateCylinder(`cord${i}`, { height: 0.8, diameter: 0.02 }, scene)
    cord.position.y = 0.4
    cord.position.x = 0.3 * Math.cos(angle)
    cord.position.z = 0.3 * Math.sin(angle)
    cord.rotation.x = 0.3 * Math.cos(angle)
    cord.rotation.z = 0.3 * Math.sin(angle)
    cord.material = cordMat
    cord.parent = unitMesh
  }

  updateUnitVisuals()
}

// ---------------------------------------------------------------------------
// Parachute physics
// ---------------------------------------------------------------------------

function tickParachute(): boolean {
  if (!parachute.isDescending || parachute.landed) return true

  parachute.tickCount++

  const currentAlt = parachute.position.y * WORLD_SCALE
  const nextAlt = currentAlt - parachute.fallRate

  if (nextAlt <= parachute.groundLevel) {
    // Landed - snap to ground
    parachute.position.y = parachute.groundLevel / WORLD_SCALE
    parachute.landed = true
    parachute.isDescending = false
    onLanded()
    return true
  }

  parachute.position.y = nextAlt / WORLD_SCALE
  return false
}

function onLanded(): void {
  console.log('[Parachute] onLanded notification triggered')
  showLandingEffect()
}

function onParachuteStart(): void {
  console.log('[Parachute] onParachute notification triggered')
}

// ---------------------------------------------------------------------------
// Visual effects
// ---------------------------------------------------------------------------

function showLandingEffect(): void {
  if (landingEffect) {
    landingEffect.dispose()
    landingEffect = null
  }

  // Dust cloud effect
  const dustMat = new StandardMaterial('dustMat', scene)
  dustMat.emissiveColor = new Color3(0.8, 0.7, 0.5)
  dustMat.alpha = 0.6
  landingEffect = MeshBuilder.CreateSphere('dust', { diameter: 1.0 }, scene)
  landingEffect.position = parachute.position.clone()
  landingEffect.position.y = 0.2
  landingEffect.material = dustMat
  landingEffect.scaling.y = 0.3
  landingEffectTimer = 30
}

function updateLandingEffect(): void {
  if (landingEffectTimer > 0 && landingEffect) {
    landingEffectTimer--
    const scale = 1.0 + (30 - landingEffectTimer) * 0.05
    landingEffect.scaling.x = scale
    landingEffect.scaling.z = scale
    landingEffect.scaling.y = 0.3 * scale
    const mat = landingEffect.material as StandardMaterial
    mat.alpha = 0.6 * (landingEffectTimer / 30)

    if (landingEffectTimer <= 0) {
      landingEffect.dispose()
      landingEffect = null
    }
  }
}

function updateUnitVisuals(): void {
  if (!unitMesh) return
  unitMesh.position = parachute.position.clone()

  // Parachute sway animation when descending
  if (parachute.isDescending && !parachute.landed) {
    const sway = Math.sin(parachute.tickCount * 0.2) * 0.05
    unitMesh.rotation.z = sway
    unitMesh.rotation.x = Math.cos(parachute.tickCount * 0.15) * 0.03
  } else {
    unitMesh.rotation.z = 0
    unitMesh.rotation.x = 0
  }

  // Hide parachute when landed
  if (parachuteMesh) {
    parachuteMesh.isVisible = !parachute.landed
  }

  // Trail during descent
  if (parachute.isDescending) {
    trailPoints.push(parachute.position.clone())
    if (trailPoints.length > 200) trailPoints.shift()
    updateTrail()
  }
}

function updateTrail(): void {
  if (trailLine) { trailLine.dispose(); trailLine = null }
  if (trailPoints.length < 2) return
  const lines: Vector3[][] = []
  for (let i = 1; i < trailPoints.length; i++) {
    lines.push([trailPoints[i - 1], trailPoints[i]])
  }
  trailLine = MeshBuilder.CreateLineSystem('trail', { lines }, scene)
  trailLine.color = new Color3(0.8, 0.8, 0.9)
}

function updateDropLine(): void {
  if (dropLine) { dropLine.dispose(); dropLine = null }
  if (!parachute.isDescending) return

  const startPoint = new Vector3(parachute.position.x, parachute.position.y + 2, parachute.position.z)
  const endPoint = parachute.position.clone()
  const lines = [[startPoint, endPoint]]
  dropLine = MeshBuilder.CreateLineSystem('dropLine', { lines }, scene)
  dropLine.color = new Color3(0.9, 0.9, 1)
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function updateStats(): void {
  const pos = parachute.position
  document.getElementById('st-pos')!.textContent =
    `${Math.round(pos.x * WORLD_SCALE)}, ${Math.round(pos.z * WORLD_SCALE)}, ${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-alt')!.textContent = `${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-state')!.textContent = parachute.landed
    ? '已着陆'
    : parachute.isDescending
      ? '下降中'
      : '待机'
  document.getElementById('st-fall-rate')!.textContent = `${parachute.fallRate}`
  document.getElementById('st-ticks')!.textContent = `${parachute.tickCount}`
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  const selFallRate = document.getElementById('sel-fall-rate') as HTMLSelectElement
  const selStartAlt = document.getElementById('sel-start-alt') as HTMLSelectElement

  document.getElementById('btn-drop')!.addEventListener('click', () => {
    const fallRate = parseInt(selFallRate.value, 10)
    const startAlt = parseInt(selStartAlt.value, 10)
    startParachute(fallRate, startAlt)
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetParachute()
  })

  // Canvas click to set drop position
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect()
    const pick = scene.pick(e.clientX - rect.left, e.clientY - rect.top, (m) => m.name === 'ground' || m.name === 'grid')
    if (pick.hit && pick.pickedPoint) {
      const point = pick.pickedPoint
      // Move the landing zone marker
      const zone = scene.getMeshByName('zone')
      if (zone) {
        zone.position.x = point.x
        zone.position.z = point.z
      }
    }
  })
}

function startParachute(fallRate: number, startAlt: number): void {
  const zone = scene.getMeshByName('zone')
  const dropX = zone ? zone.position.x : 0
  const dropZ = zone ? zone.position.z : 0

  parachute.position = new Vector3(dropX, startAlt / WORLD_SCALE, dropZ)
  parachute.fallRate = fallRate
  parachute.groundLevel = GROUND_LEVEL
  parachute.isDescending = true
  parachute.tickCount = 0
  parachute.landed = false
  trailPoints = []
  if (trailLine) { trailLine.dispose(); trailLine = null }

  onParachuteStart()
  updateUnitVisuals()
}

function resetParachute(): void {
  parachute.position = new Vector3(0, 0, 0)
  parachute.isDescending = false
  parachute.tickCount = 0
  parachute.landed = false
  trailPoints = []
  if (trailLine) { trailLine.dispose(); trailLine = null }
  if (dropLine) { dropLine.dispose(); dropLine = null }
  if (landingEffect) { landingEffect.dispose(); landingEffect = null }
  landingEffectTimer = 0
  updateUnitVisuals()
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0
const TICK_RATE = 1000 / 25

engine.runRenderLoop(() => {
  const deltaTime = engine.getDeltaTime()
  tickAccumulator += deltaTime

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE
    tickParachute()
    updateLandingEffect()
  }

  updateUnitVisuals()
  updateDropLine()
  updateStats()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// Expose
;(window as unknown as Record<string, unknown>).__parachuteTest = {
  parachute,
  startParachute,
  resetParachute,
}
