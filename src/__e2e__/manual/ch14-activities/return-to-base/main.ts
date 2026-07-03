/**
 * activities/return-to-base/main.ts — ReturnToBase + FlyIdle acceptance test
 *
 * Verifies:
 * 1. ReturnToBase finds nearest available resupplier (green building)
 * 2. No available base: hover aircraft circles near nearest base; non-hover does FlyIdle
 * 3. Landing at base for resupply
 * 4. FlyIdle circling behavior: 90° turn per tick at idleSpeed
 * 5. Target line color: green for return, none when no base
 *
 * OpenRA coordinate system:
 *   - WAngle 0 = North (negative Z), increases CCW
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

const CRUISE_ALTITUDE = 1280
const MOVEMENT_SPEED = 80
const IDLE_SPEED = 40
const TURN_SPEED = 32
const WORLD_SCALE = 1024
const BASE_RESUPPLY_RANGE = 500  // WDist

// ---------------------------------------------------------------------------
// Aircraft state
// ---------------------------------------------------------------------------

interface AircraftState {
  position: Vector3
  facing: number
  roll: number
  speed: number
  idleSpeed: number
  turnSpeed: number
  canHover: boolean
  vTOL: boolean
}

let aircraft: AircraftState = {
  position: new Vector3(5, CRUISE_ALTITUDE / WORLD_SCALE, 5),
  facing: 0,
  roll: 0,
  speed: MOVEMENT_SPEED,
  idleSpeed: IDLE_SPEED,
  turnSpeed: TURN_SPEED,
  canHover: false,
  vTOL: false,
}

// Base buildings
interface BaseBuilding {
  position: Vector3
  available: boolean
  mesh: Mesh | null
}

let bases: BaseBuilding[] = [
  { position: new Vector3(-8, 0, -6), available: true, mesh: null },
  { position: new Vector3(8, 0, 8), available: true, mesh: null },
  { position: new Vector3(-5, 0, 8), available: false, mesh: null },
]

let noBaseMode = false

// Flight state
type FlightPhase = 'idle' | 'returning' | 'landing' | 'resupplying' | 'circling' | 'flyidle'
let currentPhase: FlightPhase = 'idle'
let targetBaseIndex = -1
let phaseTimer = 0
let idleTicks = 0
let idleMaxTicks = 75

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let aircraftMesh!: TransformNode
let targetLine: LinesMesh | null = null
let trailLine: LinesMesh | null = null
let trailPoints: Vector3[] = []

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 30, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 60

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  groundMat.specularColor = new Color3(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40, subdivisions: 20 }, scene)
  ground.position.y = -0.05
  ground.material = groundMat

  // Grid
  const gridMesh = MeshBuilder.CreateGround('grid', { width: 40, height: 40, subdivisions: 20 }, scene)
  gridMesh.position.y = -0.04
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.3, 0.35, 0.3)
  gridMesh.material = gridMat

  // Base buildings
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i]
    const mat = new StandardMaterial(`baseMat${i}`, scene)
    if (base.available) {
      mat.diffuseColor = new Color3(0.3, 0.6, 0.3)  // Green = available
      mat.emissiveColor = new Color3(0.05, 0.15, 0.05)
    } else {
      mat.diffuseColor = new Color3(0.5, 0.5, 0.5)  // Gray = unavailable
      mat.emissiveColor = new Color3(0.05, 0.05, 0.05)
    }

    const box = MeshBuilder.CreateBox(`base${i}`, { width: 2.5, height: 1.5, depth: 2.5 }, scene)
    box.position = base.position.clone()
    box.position.y = 0.75
    box.material = mat
    base.mesh = box

    // Base ring
    const ring = MeshBuilder.CreateTorus(`baseRing${i}`, { diameter: 3.5, thickness: 0.08 }, scene)
    ring.position = base.position.clone()
    ring.position.y = 0.05
    ring.scaling.y = 0.01
    const ringMat = new StandardMaterial(`baseRingMat${i}`, scene)
    ringMat.emissiveColor = base.available ? new Color3(0.2, 0.7, 0.2) : new Color3(0.4, 0.4, 0.4)
    ring.material = ringMat
  }

  // Aircraft
  aircraftMesh = new TransformNode('aircraftRoot', scene)

  const bodyMat = new StandardMaterial('bodyMat', scene)
  bodyMat.diffuseColor = new Color3(0.7, 0.7, 0.75)
  const body = MeshBuilder.CreateBox('body', { width: 0.6, height: 0.3, depth: 1.2 }, scene)
  body.material = bodyMat
  body.parent = aircraftMesh

  const wingMat = new StandardMaterial('wingMat', scene)
  wingMat.diffuseColor = new Color3(0.5, 0.5, 0.55)
  const leftWing = MeshBuilder.CreateBox('lw', { width: 1.2, height: 0.1, depth: 0.4 }, scene)
  leftWing.position.x = -0.6
  leftWing.position.z = -0.1
  leftWing.material = wingMat
  leftWing.parent = aircraftMesh

  const rightWing = MeshBuilder.CreateBox('rw', { width: 1.2, height: 0.1, depth: 0.4 }, scene)
  rightWing.position.x = 0.6
  rightWing.position.z = -0.1
  rightWing.material = wingMat
  rightWing.parent = aircraftMesh

  const noseMat = new StandardMaterial('noseMat', scene)
  noseMat.diffuseColor = new Color3(0.9, 0.3, 0.3)
  const nose = MeshBuilder.CreateBox('nose', { width: 0.3, height: 0.25, depth: 0.4 }, scene)
  nose.position.z = -0.8
  nose.material = noseMat
  nose.parent = aircraftMesh

  updateAircraftVisuals()
}

// ---------------------------------------------------------------------------
// WAngle helpers
// ---------------------------------------------------------------------------

function wAngleToRadians(angle: number): number {
  return -Math.PI / 2 + (angle * 2 * Math.PI / 1024)
}

function tickFacing(current: number, desired: number, turnSpeed: number): number {
  const diff = ((desired - current + 1024) % 1024 + 512) % 1024 - 512
  if (Math.abs(diff) <= turnSpeed) return desired
  return (current + Math.sign(diff) * turnSpeed + 1024) % 1024
}

// ---------------------------------------------------------------------------
// Flight physics
// ---------------------------------------------------------------------------

function flyTick(desiredFacing: number, speed: number): void {
  aircraft.facing = tickFacing(aircraft.facing, desiredFacing, aircraft.turnSpeed)
  const facingRad = wAngleToRadians(aircraft.facing)
  const moveX = (speed / WORLD_SCALE) * Math.cos(facingRad)
  const moveZ = (speed / WORLD_SCALE) * Math.sin(facingRad)
  aircraft.position = new Vector3(
    aircraft.position.x + moveX,
    aircraft.position.y,
    aircraft.position.z + moveZ,
  )
}

function flyTickWithAltitude(desiredFacing: number, speed: number, desiredAltitude: number): void {
  flyTick(desiredFacing, speed)
  const targetAlt = desiredAltitude / WORLD_SCALE
  const altDiff = targetAlt - aircraft.position.y
  const maxClimb = (speed * 0.3) / WORLD_SCALE
  aircraft.position.y += Math.sign(altDiff) * Math.min(Math.abs(altDiff), maxClimb)
}

// ---------------------------------------------------------------------------
// ReturnToBase logic
// ---------------------------------------------------------------------------

function findNearestAvailableBase(): number {
  if (noBaseMode) return -1

  let nearest = -1
  let nearestDist = Number.MAX_VALUE

  for (let i = 0; i < bases.length; i++) {
    if (!bases[i].available) continue
    const dx = bases[i].position.x - aircraft.position.x
    const dz = bases[i].position.z - aircraft.position.z
    const dist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = i
    }
  }

  return nearest
}

function tickReturning(): boolean {
  if (targetBaseIndex < 0) {
    targetBaseIndex = findNearestAvailableBase()
    if (targetBaseIndex < 0) {
      // No base available - go to circling/flyidle
      if (aircraft.canHover) {
        currentPhase = 'circling'
      } else {
        currentPhase = 'flyidle'
        idleTicks = 0
      }
      return true
    }
  }

  const base = bases[targetBaseIndex]
  const dx = base.position.x - aircraft.position.x
  const dz = base.position.z - aircraft.position.z
  const dist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
  const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024

  flyTickWithAltitude(desiredFacing, aircraft.speed, CRUISE_ALTITUDE)

  if (dist < BASE_RESUPPLY_RANGE) {
    return true  // Arrived at base
  }
  return false
}

function tickLanding(): boolean {
  const base = bases[targetBaseIndex]
  const dx = base.position.x - aircraft.position.x
  const dz = base.position.z - aircraft.position.z
  const horizontalDist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE

  if (aircraft.vTOL) {
    // VTOL: horizontal alignment, then vertical descent
    if (horizontalDist > 64) {
      const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
      flyTick(desiredFacing, aircraft.speed * 0.5)
      return false
    }

    // Vertical descent
    const landAlt = 0
    const currentAlt = aircraft.position.y * WORLD_SCALE
    const delta = landAlt - currentAlt
    if (Math.abs(delta) < 64) {
      aircraft.position.y = 0
      aircraft.position.x = base.position.x
      aircraft.position.z = base.position.z
      return true
    }
    aircraft.position.y += (Math.sign(delta) * 64) / WORLD_SCALE
    return false
  } else {
    // Non-VTOL: gradual descent
    const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
    flyTickWithAltitude(desiredFacing, aircraft.speed * 0.5, 0)

    if (horizontalDist < 128 && aircraft.position.y * WORLD_SCALE < 64) {
      aircraft.position.x = base.position.x
      aircraft.position.z = base.position.z
      aircraft.position.y = 0
      return true
    }
    return false
  }
}

function tickResupplying(): boolean {
  phaseTimer++
  // Resupply for 50 ticks
  if (phaseTimer > 50) {
    return true
  }
  return false
}

function tickCircling(): boolean {
  // Hover aircraft circling near nearest base when no pad available
  let nearestBase = -1
  let nearestDist = Number.MAX_VALUE
  for (let i = 0; i < bases.length; i++) {
    const dx = bases[i].position.x - aircraft.position.x
    const dz = bases[i].position.z - aircraft.position.z
    const dist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
    if (dist < nearestDist) {
      nearestDist = dist
      nearestBase = i
    }
  }

  if (nearestBase >= 0) {
    const base = bases[nearestBase]
    const dx = base.position.x - aircraft.position.x
    const dz = base.position.z - aircraft.position.z
    const dist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE

    // If too far, fly closer; if close enough, circle
    if (dist > 2000) {
      const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
      flyTick(desiredFacing, aircraft.idleSpeed)
    } else {
      // Circle at idle speed
      const desiredFacing = (aircraft.facing + 256) % 1024  // 90° turn per tick
      const facingRad = wAngleToRadians(aircraft.facing)
      const moveX = (aircraft.idleSpeed / WORLD_SCALE) * Math.cos(facingRad)
      const moveZ = (aircraft.idleSpeed / WORLD_SCALE) * Math.sin(facingRad)
      aircraft.facing = tickFacing(aircraft.facing, desiredFacing, aircraft.turnSpeed)
      aircraft.position = new Vector3(
        aircraft.position.x + moveX,
        aircraft.position.y,
        aircraft.position.z + moveZ,
      )
    }
  }

  return false  // Keep circling indefinitely
}

function tickFlyIdle(): boolean {
  // FlyIdle: circle at idle speed for a fixed number of ticks
  idleTicks++
  const desiredFacing = (aircraft.facing + 256) % 1024  // 90° per tick
  const facingRad = wAngleToRadians(aircraft.facing)
  const moveX = (aircraft.idleSpeed / WORLD_SCALE) * Math.cos(facingRad)
  const moveZ = (aircraft.idleSpeed / WORLD_SCALE) * Math.sin(facingRad)
  aircraft.facing = tickFacing(aircraft.facing, desiredFacing, aircraft.turnSpeed)
  aircraft.position = new Vector3(
    aircraft.position.x + moveX,
    aircraft.position.y,
    aircraft.position.z + moveZ,
  )

  if (idleTicks >= idleMaxTicks) {
    return true  // Done idling
  }
  return false
}

// ---------------------------------------------------------------------------
// Visual updates
// ---------------------------------------------------------------------------

function updateAircraftVisuals(): void {
  if (!aircraftMesh) return
  aircraftMesh.position = aircraft.position.clone()
  const facingRad = wAngleToRadians(aircraft.facing)
  aircraftMesh.rotation.y = facingRad + Math.PI / 2
  aircraftMesh.rotation.z = (aircraft.roll * 2 * Math.PI / 1024)

  // Trail
  if (currentPhase !== 'idle' && currentPhase !== 'resupplying') {
    trailPoints.push(aircraft.position.clone())
    if (trailPoints.length > 300) trailPoints.shift()
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
  const isReturn = currentPhase === 'returning' || currentPhase === 'landing'
  trailLine.color = isReturn ? new Color3(0, 1, 0) : new Color3(0.3, 0.5, 0.9)
}

function updateTargetLine(): void {
  if (targetLine) { targetLine.dispose(); targetLine = null }

  if (currentPhase === 'returning' && targetBaseIndex >= 0) {
    const base = bases[targetBaseIndex]
    const endPoint = base.position.clone()
    endPoint.y = aircraft.position.y
    const lines = [[aircraft.position.clone(), endPoint]]
    targetLine = MeshBuilder.CreateLineSystem('targetLine', { lines }, scene)
    targetLine.color = new Color3(0, 1, 0)  // Green for return
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function updateStats(): void {
  const pos = aircraft.position
  document.getElementById('st-pos')!.textContent =
    `${Math.round(pos.x * WORLD_SCALE)}, ${Math.round(pos.z * WORLD_SCALE)}, ${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-state')!.textContent = currentPhase

  const targetBase = targetBaseIndex >= 0 ? bases[targetBaseIndex] : null
  document.getElementById('st-target-base')!.textContent = targetBase
    ? `基地 ${targetBaseIndex + 1} (${targetBase.available ? '可用' : '不可用'})`
    : (noBaseMode ? '无基地' : '-')

  if (targetBase) {
    const dx = targetBase.position.x - pos.x
    const dz = targetBase.position.z - pos.z
    const dist = Math.round(Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE)
    document.getElementById('st-base-dist')!.textContent = `${dist} WDist`
  } else {
    document.getElementById('st-base-dist')!.textContent = '-'
  }

  document.getElementById('st-target-line')!.textContent =
    currentPhase === 'returning' ? '绿色 (返航)' :
    currentPhase === 'idle' ? '-' : '无'
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
  const selAircraft = document.getElementById('sel-aircraft') as HTMLSelectElement
  selAircraft.addEventListener('change', () => {
    const type = selAircraft.value
    aircraft.canHover = type === 'hover'
    aircraft.vTOL = type === 'vtol'
  })

  document.getElementById('btn-return')!.addEventListener('click', () => {
    if (currentPhase === 'idle' || currentPhase === 'circling' || currentPhase === 'flyidle') {
      currentPhase = 'returning'
      targetBaseIndex = -1
      phaseTimer = 0
    }
  })

  document.getElementById('btn-idle')!.addEventListener('click', () => {
    if (currentPhase === 'idle') {
      currentPhase = 'flyidle'
      idleTicks = 0
    }
  })

  document.getElementById('btn-no-base')!.addEventListener('click', () => {
    noBaseMode = !noBaseMode
    const btn = document.getElementById('btn-no-base')!
    btn.classList.toggle('active', noBaseMode)
    btn.textContent = noBaseMode ? '恢复基地' : '模拟无基地'

    // Update base visuals
    for (let i = 0; i < bases.length; i++) {
      const base = bases[i]
      if (base.mesh) {
        const mat = base.mesh.material as StandardMaterial
        if (noBaseMode) {
          mat.diffuseColor = new Color3(0.5, 0.5, 0.5)
          mat.emissiveColor = new Color3(0.05, 0.05, 0.05)
        } else {
          mat.diffuseColor = base.available ? new Color3(0.3, 0.6, 0.3) : new Color3(0.5, 0.5, 0.5)
          mat.emissiveColor = base.available ? new Color3(0.05, 0.15, 0.05) : new Color3(0.05, 0.05, 0.05)
        }
      }
    }
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetAircraft()
  })
}

function resetAircraft(): void {
  aircraft.position = new Vector3(5, CRUISE_ALTITUDE / WORLD_SCALE, 5)
  aircraft.facing = 0
  aircraft.roll = 0
  currentPhase = 'idle'
  targetBaseIndex = -1
  phaseTimer = 0
  idleTicks = 0
  trailPoints = []
  if (trailLine) { trailLine.dispose(); trailLine = null }
  if (targetLine) { targetLine.dispose(); targetLine = null }
  updateAircraftVisuals()
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

    switch (currentPhase) {
      case 'returning': {
        const done = tickReturning()
        if (done) {
          if (targetBaseIndex >= 0) {
            currentPhase = 'landing'
            phaseTimer = 0
          }
          // else: transitioned to circling/flyidle in tickReturning
        }
        break
      }
      case 'landing': {
        const done = tickLanding()
        if (done) {
          currentPhase = 'resupplying'
          phaseTimer = 0
        }
        break
      }
      case 'resupplying': {
        const done = tickResupplying()
        if (done) {
          currentPhase = 'idle'
          // Take off back to cruise altitude
          aircraft.position.y = CRUISE_ALTITUDE / WORLD_SCALE
        }
        break
      }
      case 'circling': {
        tickCircling()
        break
      }
      case 'flyidle': {
        const done = tickFlyIdle()
        if (done) {
          currentPhase = 'idle'
        }
        break
      }
    }
  }

  updateAircraftVisuals()
  updateTargetLine()
  updateStats()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// Expose
;(window as unknown as Record<string, unknown>).__returnToBaseTest = {
  get aircraft() { return aircraft },
  get currentPhase() { return currentPhase },
  get targetBaseIndex() { return targetBaseIndex },
  get bases() { return bases },
  get noBaseMode() { return noBaseMode },
}
