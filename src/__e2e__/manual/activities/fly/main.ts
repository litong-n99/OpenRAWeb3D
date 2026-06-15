/**
 * activities/fly/main.ts — Fly + FlyForward acceptance test
 *
 * Verifies:
 * 1. Aircraft flies toward target, maintains cruise altitude, facing rotates
 *    toward desired facing via WAngle.tickFacing()
 * 2. VTOL vs non-VTOL altitude handling (vertical vs forward+up)
 * 3. Turn radius calculation: r = 180 * speed / turnSpeed
 * 4. Target line rendering (red line from aircraft to target)
 * 5. FlyForward: flies straight at current facing for N ticks / distance
 *
 * OpenRA coordinate system:
 *   - WAngle 0 = North (negative Z in world space), increases CCW
 *   - WPos: X (east), Y (north), Z (altitude)
 *   - In Babylon.js: X -> X, Z -> -Y (so north is negative Z on screen)
 *   - Altitude Z -> Babylon Y (up)
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

/** Cruise altitude in WDist units. */
const CRUISE_ALTITUDE = 1280
/** Land altitude (ground level). */
const LAND_ALTITUDE = 0
/** Aircraft movement speed (world units per tick). */
const MOVEMENT_SPEED = 80
/** Idle movement speed. */
const IDLE_SPEED = 40
/** Turn speed (WAngle per tick). */
const TURN_SPEED = 32
/** World scale: 1 Babylon unit = 1024 WDist. */
const WORLD_SCALE = 1024

// ---------------------------------------------------------------------------
// Aircraft state (mirrors AircraftLike duck type)
// ---------------------------------------------------------------------------

interface AircraftState {
  position: Vector3       // Babylon world position (X, Y=altitude, Z)
  facing: number          // WAngle (0-1023, 0=North, CCW)
  pitch: number           // WAngle
  roll: number           // WAngle
  speed: number          // movement speed (WDist per tick)
  idleSpeed: number       // idle movement speed
  turnSpeed: number       // turn speed (WAngle per tick)
  canHover: boolean
  canSlide: boolean
  vTOL: boolean
  cruiseAltitude: number // WDist
  landAltitude: number    // WDist
}

let aircraft: AircraftState = {
  position: new Vector3(0, 0, 0),
  facing: 0,
  pitch: 0,
  roll: 0,
  speed: MOVEMENT_SPEED,
  idleSpeed: IDLE_SPEED,
  turnSpeed: TURN_SPEED,
  canHover: false,
  canSlide: false,
  vTOL: false,
  cruiseAltitude: CRUISE_ALTITUDE,
  landAltitude: LAND_ALTITUDE,
}

// Target position (Babylon coordinates)
let targetPosition: Vector3 | null = null
let isFlying = false
let flyMode: 'fly' | 'flyforward' = 'fly'
let flyForwardTicks = 0
let flyForwardMaxTicks = 50
let flyForwardDistance = 0
let flyForwardMaxDistance = 3000

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let aircraftMesh!: TransformNode
let aircraftBody!: Mesh
let targetMarker: Mesh | null = null
let targetLine!: LinesMesh | null
let trailLine: LinesMesh | null = null
const trailPoints: Vector3[] = []
const MAX_TRAIL_POINTS = 200

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  // Camera: angled top-down view
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 25, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 60
  camera.panningSensibility = 50

  // Lights
  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Ground plane with grid
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  groundMat.specularColor = new Color3(0, 0, 0)

  const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40, subdivisions: 20 }, scene)
  ground.position.y = -0.05
  ground.material = groundMat

  // Grid lines on ground
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.3, 0.35, 0.3)
  const gridMesh = MeshBuilder.CreateGround('grid', { width: 40, height: 40, subdivisions: 20 }, scene)
  gridMesh.position.y = -0.04
  gridMesh.material = gridMat

  // Aircraft mesh (procedural: body + wings)
  aircraftMesh = new TransformNode('aircraftRoot', scene)

  // Body
  const bodyMat = new StandardMaterial('bodyMat', scene)
  bodyMat.diffuseColor = new Color3(0.7, 0.7, 0.75)
  bodyMat.specularColor = new Color3(0.2, 0.2, 0.2)

  aircraftBody = MeshBuilder.CreateBox('aircraftBody', { width: 0.6, height: 0.3, depth: 1.2 }, scene)
  aircraftBody.material = bodyMat
  aircraftBody.parent = aircraftMesh

  // Wings
  const wingMat = new StandardMaterial('wingMat', scene)
  wingMat.diffuseColor = new Color3(0.5, 0.5, 0.55)
  const leftWing = MeshBuilder.CreateBox('leftWing', { width: 1.2, height: 0.1, depth: 0.4 }, scene)
  leftWing.position.x = -0.6
  leftWing.position.z = -0.1
  leftWing.material = wingMat
  leftWing.parent = aircraftMesh

  const rightWing = MeshBuilder.CreateBox('rightWing', { width: 1.2, height: 0.1, depth: 0.4 }, scene)
  rightWing.position.x = 0.6
  rightWing.position.z = -0.1
  rightWing.material = wingMat
  rightWing.parent = aircraftMesh

  // Nose (direction indicator)
  const noseMat = new StandardMaterial('noseMat', scene)
  noseMat.diffuseColor = new Color3(0.9, 0.3, 0.3)
  const nose = MeshBuilder.CreateBox('nose', { width: 0.3, height: 0.25, depth: 0.4 }, scene)
  nose.position.z = -0.8
  nose.material = noseMat
  nose.parent = aircraftMesh

  // Engine glow (rear)
  const glowMat = new StandardMaterial('glowMat', scene)
  glowMat.diffuseColor = new Color3(0.9, 0.6, 0.1)
  glowMat.emissiveColor = new Color3(0.5, 0.3, 0.05)
  const glow = MeshBuilder.CreateBox('glow', { width: 0.4, height: 0.2, depth: 0.2 }, scene)
  glow.position.z = 0.65
  glow.material = glowMat
  glow.parent = aircraftMesh

  updateAircraftPosition()
}

// ---------------------------------------------------------------------------
// WAngle helpers
// ---------------------------------------------------------------------------

/** Convert WAngle to radians (0=North, CCW). In Babylon, North is -Z, so rotate. */
function wAngleToRadians(angle: number): number {
  // WAngle 0 = North (negative Z). In Babylon standard: 0 = positive X.
  // We need: WAngle 0 -> -Z direction -> Babylon rotation = -PI/2 (or 3*PI/2)
  // WAngle increases CCW. Babylon Y-up rotation is CCW when looking down.
  // So: rad = -PI/2 - (angle * 2 * PI / 1024)
  return -Math.PI / 2 - (angle * 2 * Math.PI / 1024)
}

/** Tick facing toward desired facing (mirrors WAngle.tickFacing). */
function tickFacing(current: number, desired: number, turnSpeed: number): number {
  const diff = ((desired - current + 1024) % 1024 + 512) % 1024 - 512
  if (Math.abs(diff) <= turnSpeed) return desired
  return (current + Math.sign(diff) * turnSpeed + 1024) % 1024
}

/** Get turn direction: +1 = clockwise (right turn), -1 = counter-clockwise (left turn). */
function getTurnDirection(current: number, desired: number): number {
  const diff = ((desired - current + 1024) % 1024 + 512) % 1024 - 512
  return diff <= 0 ? 1 : -1  // diff <= 0 means desired is clockwise from current
}

/** Calculate turn radius: r = 180 * speed / turnSpeed. */
function calculateTurnRadius(speed: number, turnSpeed: number): number {
  return turnSpeed > 0 ? Math.trunc((180 * speed) / turnSpeed) : 0
}

// ---------------------------------------------------------------------------
// Flight physics (mirrors AircraftFlightUtils.flyTick)
// ---------------------------------------------------------------------------

/**
 * Fly one tick toward the target.
 * Returns true when reached target.
 */
function flyTick(): boolean {
  if (!targetPosition) return true

  const pos = aircraft.position
  const target = targetPosition

  // Calculate delta to target
  const dx = target.x - pos.x
  const dz = target.z - pos.z
  const horizontalDist = Math.sqrt(dx * dx + dz * dz)

  // Desired facing: atan2(dx, -dz) gives angle from North (negative Z)
  // WAngle 0 = North, CCW. dx>0, dz<0 (target is northeast) -> facing < 256 (between 0 and 90 deg)
  let desiredFacing = 0
  if (horizontalDist > 0.01) {
    const rad = Math.atan2(dx, -dz)  // angle from North, CCW
    desiredFacing = Math.round(((rad + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
  }

  // Turn radius check for non-sliders
  if (!aircraft.canSlide && horizontalDist > 0.01) {
    const turnRadius = calculateTurnRadius(aircraft.speed, aircraft.turnSpeed) / WORLD_SCALE
    if (turnRadius > 0.01) {
      const turnDir = getTurnDirection(aircraft.facing, desiredFacing)
      const turnCenterFacing = (aircraft.facing + turnDir * 256 + 1024) % 1024
      const centerRad = wAngleToRadians(turnCenterFacing)
      const centerX = pos.x + (turnRadius * 1024 / WORLD_SCALE) * Math.cos(centerRad)
      const centerZ = pos.z + (turnRadius * 1024 / WORLD_SCALE) * Math.sin(centerRad)
      const distToCenterSq = (target.x - centerX) ** 2 + (target.z - centerZ) ** 2
      if (distToCenterSq < turnRadius * turnRadius) {
        // Target inside turn circle — keep current facing
        desiredFacing = aircraft.facing
      }
    }
  }

  // Update facing
  aircraft.facing = tickFacing(aircraft.facing, desiredFacing, aircraft.turnSpeed)

  // Roll animation when turning
  const facingDiff = Math.abs(((desiredFacing - aircraft.facing + 1024) % 1024 + 512) % 1024 - 512)
  const targetRoll = facingDiff > 8 ? (desiredFacing > aircraft.facing ? -64 : 64) : 0
  aircraft.roll = tickFacing(aircraft.roll, targetRoll, 8)

  // Move forward at current facing
  const facingRad = wAngleToRadians(aircraft.facing)
  const moveX = (aircraft.speed / WORLD_SCALE) * Math.cos(facingRad)
  const moveZ = (aircraft.speed / WORLD_SCALE) * Math.sin(facingRad)

  // Altitude adjustment
  let newY = pos.y
  const targetAltitude = aircraft.cruiseAltitude / WORLD_SCALE
  const altitudeDiff = targetAltitude - pos.y
  const maxClimb = (aircraft.speed * 0.3) / WORLD_SCALE  // max climb rate

  if (aircraft.vTOL) {
    // VTOL: vertical movement only for altitude
    newY = pos.y + Math.sign(altitudeDiff) * Math.min(Math.abs(altitudeDiff), maxClimb)
  } else {
    // Non-VTOL: gradual altitude change while moving
    newY = pos.y + Math.sign(altitudeDiff) * Math.min(Math.abs(altitudeDiff), maxClimb * 0.5)
  }

  aircraft.position = new Vector3(pos.x + moveX, newY, pos.z + moveZ)

  // Check if close enough to target
  const newDx = target.x - aircraft.position.x
  const newDz = target.z - aircraft.position.z
  const newHorizontalDist = Math.sqrt(newDx * newDx + newDz * newDz)

  return newHorizontalDist < (aircraft.speed / WORLD_SCALE) * 1.5
}

/**
 * FlyForward tick: fly straight at current facing.
 * Returns true when completed.
 */
function flyForwardTick(): boolean {
  flyForwardTicks++

  const facingRad = wAngleToRadians(aircraft.facing)
  const moveX = (aircraft.speed / WORLD_SCALE) * Math.cos(facingRad)
  const moveZ = (aircraft.speed / WORLD_SCALE) * Math.sin(facingRad)

  // Altitude to cruise
  const targetAltitude = aircraft.cruiseAltitude / WORLD_SCALE
  const altitudeDiff = targetAltitude - aircraft.position.y
  const maxClimb = (aircraft.speed * 0.3) / WORLD_SCALE
  const newY = aircraft.position.y + Math.sign(altitudeDiff) * Math.min(Math.abs(altitudeDiff), maxClimb)

  aircraft.position = new Vector3(aircraft.position.x + moveX, newY, aircraft.position.z + moveZ)

  // Distance tracking
  const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ) * WORLD_SCALE
  flyForwardDistance += moveDist

  // Check completion
  if (flyForwardTicks >= flyForwardMaxTicks || flyForwardDistance >= flyForwardMaxDistance) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Visual updates
// ---------------------------------------------------------------------------

function updateAircraftPosition(): void {
  if (!aircraftMesh) return

  aircraftMesh.position = aircraft.position.clone()

  // Rotation: facing (yaw) + roll + pitch
  const facingRad = wAngleToRadians(aircraft.facing)
  const rollRad = (aircraft.roll * 2 * Math.PI / 1024)
  const pitchRad = (aircraft.pitch * 2 * Math.PI / 1024)

  aircraftMesh.rotation.y = -facingRad - Math.PI / 2  // Adjust for Babylon coordinate system
  aircraftMesh.rotation.z = rollRad
  aircraftMesh.rotation.x = pitchRad

  // Update trail
  if (isFlying && scene) {
    trailPoints.push(aircraft.position.clone())
    if (trailPoints.length > MAX_TRAIL_POINTS) {
      trailPoints.shift()
    }
    updateTrailLine()
  }
}

function updateTrailLine(): void {
  if (trailLine) {
    trailLine.dispose()
    trailLine = null
  }
  if (trailPoints.length < 2) return

  const lines = []
  for (let i = 1; i < trailPoints.length; i++) {
    lines.push([trailPoints[i - 1], trailPoints[i]])
  }

  trailLine = MeshBuilder.CreateLineSystem('trail', { lines }, scene)
  const trailMat = new StandardMaterial('trailMat', scene)
  trailMat.emissiveColor = new Color3(0.3, 0.5, 0.9)
  trailLine.color = new Color3(0.3, 0.5, 0.9)
}

function updateTargetLine(): void {
  if (targetLine) {
    targetLine.dispose()
    targetLine = null
  }
  if (!targetPosition || !isFlying) return

  const lines = [[aircraft.position.clone(), targetPosition.clone()]]
  targetLine = MeshBuilder.CreateLineSystem('targetLine', { lines }, scene)
  targetLine.color = new Color3(1, 0, 0)  // Red target line
}

function createTargetMarker(pos: Vector3): void {
  if (targetMarker) {
    targetMarker.dispose()
  }

  const mat = new StandardMaterial('targetMat', scene)
  mat.diffuseColor = new Color3(1, 0, 0)
  mat.emissiveColor = new Color3(0.5, 0, 0)

  targetMarker = MeshBuilder.CreateSphere('target', { diameter: 0.5 }, scene)
  targetMarker.position = pos
  targetMarker.material = mat

  // Ring around target
  const ring = MeshBuilder.CreateTorus('targetRing', { diameter: 1.5, thickness: 0.05 }, scene)
  ring.position = pos.clone()
  ring.scaling.y = 0.01  // Flatten to ground
  const ringMat = new StandardMaterial('ringMat', scene)
  ringMat.emissiveColor = new Color3(1, 0, 0)
  ring.material = ringMat
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateFlightStats(): void {
  const pos = aircraft.position
  document.getElementById('st-pos')!.textContent =
    `${Math.round(pos.x * WORLD_SCALE)}, ${Math.round(pos.z * WORLD_SCALE)}, ${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-facing')!.textContent = `${aircraft.facing}`
  document.getElementById('st-alt')!.textContent = `${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-speed')!.textContent = `${isFlying ? aircraft.speed : 0}`
  document.getElementById('st-state')!.textContent = isFlying
    ? (flyMode === 'fly' ? '追踪目标中' : `直飞中 (${flyForwardTicks}/${flyForwardMaxTicks})`)
    : '待机'
  document.getElementById('st-target')!.textContent = targetPosition
    ? `${Math.round(targetPosition.x * WORLD_SCALE)}, ${Math.round(targetPosition.z * WORLD_SCALE)}`
    : '-'
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
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

  // Mode buttons
  const btnFly = document.getElementById('btn-mode-fly')!
  const btnFlyForward = document.getElementById('btn-mode-flyforward')!

  btnFly.addEventListener('click', () => {
    flyMode = 'fly'
    btnFly.classList.add('active')
    btnFlyForward.classList.remove('active')
  })

  btnFlyForward.addEventListener('click', () => {
    flyMode = 'flyforward'
    btnFlyForward.classList.add('active')
    btnFly.classList.remove('active')
  })

  // Aircraft type selector
  const selAircraft = document.getElementById('sel-aircraft') as HTMLSelectElement
  selAircraft.addEventListener('change', () => {
    const type = selAircraft.value
    aircraft.canHover = type === 'hover'
    aircraft.canSlide = type === 'hover' || type === 'vtol'
    aircraft.vTOL = type === 'vtol'
    if (type === 'hover') {
      aircraft.speed = 60
      aircraft.idleSpeed = 30
    } else {
      aircraft.speed = MOVEMENT_SPEED
      aircraft.idleSpeed = IDLE_SPEED
    }
  })

  // Set target button + canvas click
  const btnSetTarget = document.getElementById('btn-set-target')!
  let isSettingTarget = false

  btnSetTarget.addEventListener('click', () => {
    isSettingTarget = !isSettingTarget
    btnSetTarget.classList.toggle('active', isSettingTarget)
    btnSetTarget.textContent = isSettingTarget ? '点击画布设置目标...' : '点击设置目标'
    canvas.style.cursor = isSettingTarget ? 'crosshair' : ''
  })

  canvas.addEventListener('pointerdown', (e) => {
    if (!isSettingTarget) return
    const rect = canvas.getBoundingClientRect()
    const pickResult = scene.pick(
      e.clientX - rect.left,
      e.clientY - rect.top,
      (mesh) => mesh.name === 'ground' || mesh.name === 'grid',
    )
    if (pickResult.hit && pickResult.pickedPoint) {
      const point = pickResult.pickedPoint
      point.y = aircraft.cruiseAltitude / WORLD_SCALE
      targetPosition = point
      createTargetMarker(point)
      isSettingTarget = false
      btnSetTarget.classList.remove('active')
      btnSetTarget.textContent = '点击设置目标'
      canvas.style.cursor = ''

      // Start flying
      if (!isFlying) {
        startFlying()
      }
    }
  })

  // Reset button
  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetAircraft()
  })
}

function startFlying(): void {
  isFlying = true
  flyForwardTicks = 0
  flyForwardDistance = 0
  trailPoints.length = 0

  // If FlyForward mode, set a forward target based on current facing
  if (flyMode === 'flyforward') {
    const facingRad = wAngleToRadians(aircraft.facing)
    const dist = flyForwardMaxDistance / WORLD_SCALE
    const forwardX = aircraft.position.x + dist * Math.cos(facingRad)
    const forwardZ = aircraft.position.z + dist * Math.sin(facingRad)
    targetPosition = new Vector3(forwardX, aircraft.cruiseAltitude / WORLD_SCALE, forwardZ)
    createTargetMarker(targetPosition)
  }
}

function resetAircraft(): void {
  isFlying = false
  aircraft.position = new Vector3(0, aircraft.vTOL ? 0 : aircraft.cruiseAltitude / WORLD_SCALE, 0)
  aircraft.facing = 0
  aircraft.pitch = 0
  aircraft.roll = 0
  flyForwardTicks = 0
  flyForwardDistance = 0
  targetPosition = null
  trailPoints.length = 0

  if (targetMarker) {
    targetMarker.dispose()
    targetMarker = null
  }
  if (targetLine) {
    targetLine.dispose()
    targetLine = null
  }
  if (trailLine) {
    trailLine.dispose()
    trailLine = null
  }

  updateAircraftPosition()
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

// Scene render loop with flight physics
let tickAccumulator = 0
const TICK_RATE = 1000 / 25  // 25 ticks per second (OpenRA standard)

engine.runRenderLoop(() => {
  const deltaTime = engine.getDeltaTime()
  tickAccumulator += deltaTime

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE

    if (isFlying) {
      let done = false
      if (flyMode === 'fly') {
        done = flyTick()
      } else {
        done = flyForwardTick()
      }

      if (done) {
        isFlying = false
      }
    }
  }

  updateAircraftPosition()
  updateTargetLine()
  updateFlightStats()
  updateInfoBar()

  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for dev tools
;(window as unknown as Record<string, unknown>).__flyTest = {
  aircraft,
  targetPosition,
  isFlying,
  flyMode,
  tickFacing,
  getTurnDirection,
  calculateTurnRadius,
  wAngleToRadians,
}
