/**
 * activities/land-takeoff/main.ts — TakeOff + Land acceptance test
 *
 * Verifies:
 * 1. VTOL takeoff: vertical ascent to cruise altitude, no horizontal movement
 * 2. VTOL landing: horizontal alignment → turn → vertical descent, precise landing
 * 3. Non-VTOL takeoff: forward movement while ascending
 * 4. Non-VTOL landing: approach trajectory with waypoints w1/w2/w3
 * 5. Landing sound notification on touchdown
 *
 * OpenRA coordinate system:
 *   - WAngle 0 = North (negative Z), increases CCW
 *   - WPos: X (east), Y (north), Z (altitude)
 *   - Babylon: X -> X, Z -> -Y, altitude Z -> Y (up)
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
const LAND_ALTITUDE = 0
const MOVEMENT_SPEED = 80
const TURN_SPEED = 32
const WORLD_SCALE = 1024
const ALTITUDE_VELOCITY = 64  // WDist per tick for VTOL vertical movement

// ---------------------------------------------------------------------------
// Aircraft state
// ---------------------------------------------------------------------------

interface AircraftState {
  position: Vector3
  facing: number
  pitch: number
  roll: number
  speed: number
  turnSpeed: number
  vTOL: boolean
  cruiseAltitude: number
  landAltitude: number
}

let aircraft: AircraftState = {
  position: new Vector3(0, 0, 0),
  facing: 0,
  pitch: 0,
  roll: 0,
  speed: MOVEMENT_SPEED,
  turnSpeed: TURN_SPEED,
  vTOL: false,
  cruiseAltitude: CRUISE_ALTITUDE,
  landAltitude: LAND_ALTITUDE,
}

// Flight state machine
type FlightPhase = 'ground' | 'takeoff' | 'cruise' | 'approach' | 'landing' | 'landed'
let currentPhase: FlightPhase = 'ground'
let phaseTimer = 0
let landingPadPosition: Vector3 = new Vector3(5, 0, -5)  // Default landing pad
let approachWaypoints: Vector3[] = []
let currentWaypointIndex = 0

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let aircraftMesh!: TransformNode
let landingPad!: Mesh
let waypointMarkers: Mesh[] = []
let approachLine: LinesMesh | null = null
let trailPoints: Vector3[] = []
let trailLine: LinesMesh | null = null

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

  // Landing pad (green square)
  const padMat = new StandardMaterial('padMat', scene)
  padMat.diffuseColor = new Color3(0.2, 0.6, 0.2)
  padMat.emissiveColor = new Color3(0.05, 0.2, 0.05)
  landingPad = MeshBuilder.CreateBox('landingPad', { width: 2, height: 0.1, depth: 2 }, scene)
  landingPad.position = landingPadPosition.clone()
  landingPad.position.y = 0.05
  landingPad.material = padMat

  // Pad marker ring
  const padRing = MeshBuilder.CreateTorus('padRing', { diameter: 2.5, thickness: 0.08 }, scene)
  padRing.position = landingPadPosition.clone()
  padRing.position.y = 0.06
  padRing.scaling.y = 0.01
  const ringMat = new StandardMaterial('ringMat', scene)
  ringMat.emissiveColor = new Color3(0, 0.8, 0)
  padRing.material = ringMat

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

  const glowMat = new StandardMaterial('glowMat', scene)
  glowMat.diffuseColor = new Color3(0.9, 0.6, 0.1)
  glowMat.emissiveColor = new Color3(0.5, 0.3, 0.05)
  const glow = MeshBuilder.CreateBox('glow', { width: 0.4, height: 0.2, depth: 0.2 }, scene)
  glow.position.z = 0.65
  glow.material = glowMat
  glow.parent = aircraftMesh

  updateAircraftVisuals()
}

// ---------------------------------------------------------------------------
// WAngle helpers
// ---------------------------------------------------------------------------

function wAngleToRadians(angle: number): number {
  return -Math.PI / 2 - (angle * 2 * Math.PI / 1024)
}

function tickFacing(current: number, desired: number, turnSpeed: number): number {
  const diff = ((desired - current + 1024) % 1024 + 512) % 1024 - 512
  if (Math.abs(diff) <= turnSpeed) return desired
  return (current + Math.sign(diff) * turnSpeed + 1024) % 1024
}

function calculateTurnRadius(speed: number, turnSpeed: number): number {
  return turnSpeed > 0 ? Math.trunc((180 * speed) / turnSpeed) : 0
}

// ---------------------------------------------------------------------------
// Flight physics
// ---------------------------------------------------------------------------

function verticalTakeOffOrLandTick(desiredAltitude: number): boolean {
  const currentAlt = aircraft.position.y * WORLD_SCALE
  const delta = desiredAltitude - currentAlt
  const maxDelta = ALTITUDE_VELOCITY

  if (Math.abs(delta) < maxDelta) {
    aircraft.position.y = desiredAltitude / WORLD_SCALE
    return false  // Done
  }

  aircraft.position.y += (Math.sign(delta) * maxDelta) / WORLD_SCALE
  return true  // Still moving
}

function flyTick(desiredFacing: number, desiredAltitude: number): void {
  // Update facing
  aircraft.facing = tickFacing(aircraft.facing, desiredFacing, aircraft.turnSpeed)

  // Move forward
  const facingRad = wAngleToRadians(aircraft.facing)
  const moveX = (aircraft.speed / WORLD_SCALE) * Math.cos(facingRad)
  const moveZ = (aircraft.speed / WORLD_SCALE) * Math.sin(facingRad)

  // Altitude
  const targetAlt = desiredAltitude / WORLD_SCALE
  const altDiff = targetAlt - aircraft.position.y
  const maxClimb = (aircraft.speed * 0.3) / WORLD_SCALE
  const newY = aircraft.position.y + Math.sign(altDiff) * Math.min(Math.abs(altDiff), maxClimb)

  aircraft.position = new Vector3(aircraft.position.x + moveX, newY, aircraft.position.z + moveZ)
}

// ---------------------------------------------------------------------------
// Phase logic
// ---------------------------------------------------------------------------

function tickTakeOff(): boolean {
  const cruiseAlt = aircraft.cruiseAltitude
  const currentAlt = aircraft.position.y * WORLD_SCALE

  if (currentAlt >= cruiseAlt - 32) {
    aircraft.position.y = cruiseAlt / WORLD_SCALE
    return true  // Done
  }

  if (aircraft.vTOL) {
    // VTOL: vertical only
    verticalTakeOffOrLandTick(cruiseAlt)
  } else {
    // Non-VTOL: fly forward while ascending
    flyTick(aircraft.facing, cruiseAlt)
  }
  return false
}

function calculateApproachWaypoints(startPos: Vector3, padPos: Vector3): Vector3[] {
  // Non-VTOL approach trajectory calculation
  // Mirrors Land.ts approach trajectory math
  const altitude = aircraft.cruiseAltitude / WORLD_SCALE
  const landDistance = (altitude * WORLD_SCALE * 1024) / 512  // Simplified: maxPitch.tan() ~ 512 at 45deg

  // Approach from opposite direction of landing pad
  const dx = padPos.x - startPos.x
  const dz = padPos.z - startPos.z
  const approachFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024

  // Approach start point (opposite direction, at cruise altitude)
  const approachRad = wAngleToRadians(approachFacing)
  const approachStart = new Vector3(
    padPos.x - (landDistance / WORLD_SCALE) * Math.cos(approachRad),
    altitude,
    padPos.z - (landDistance / WORLD_SCALE) * Math.sin(approachRad),
  )

  // Turn radius
  const turnRadius = calculateTurnRadius(aircraft.speed, aircraft.turnSpeed) / WORLD_SCALE

  // Waypoints: w1 = entry to turn, w2 = exit turn, w3 = approach start
  const w3 = approachStart
  const w2 = new Vector3(
    w3.x + (turnRadius * 0.5) * Math.cos(approachRad + Math.PI / 2),
    altitude,
    w3.z + (turnRadius * 0.5) * Math.sin(approachRad + Math.PI / 2),
  )
  const w1 = new Vector3(
    startPos.x + (turnRadius * 0.3) * Math.cos(approachRad - Math.PI / 2),
    altitude,
    startPos.z + (turnRadius * 0.3) * Math.sin(approachRad - Math.PI / 2),
  )

  return [w1, w2, w3]
}

function tickApproach(): boolean {
  if (approachWaypoints.length === 0) {
    // Calculate waypoints
    approachWaypoints = calculateApproachWaypoints(aircraft.position, landingPadPosition)
    currentWaypointIndex = 0
    showApproachWaypoints()
  }

  if (currentWaypointIndex >= approachWaypoints.length) {
    return true  // Done approach
  }

  const waypoint = approachWaypoints[currentWaypointIndex]
  const dx = waypoint.x - aircraft.position.x
  const dz = waypoint.z - aircraft.position.z
  const dist = Math.sqrt(dx * dx + dz * dz)

  if (dist < 0.5) {
    currentWaypointIndex++
    if (currentWaypointIndex >= approachWaypoints.length) {
      return true
    }
    return false
  }

  // Fly toward waypoint
  const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
  flyTick(desiredFacing, aircraft.cruiseAltitude)
  return false
}

function tickLanding(): boolean {
  const padPos = landingPadPosition
  const dx = padPos.x - aircraft.position.x
  const dz = padPos.z - aircraft.position.z
  const horizontalDist = Math.sqrt(dx * dx + dz * dz)

  if (aircraft.vTOL) {
    // VTOL: horizontal alignment first, then vertical descent
    if (horizontalDist > 0.3) {
      const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
      flyTick(desiredFacing, aircraft.cruiseAltitude)
      return false
    }

    // Vertical descent
    const done = !verticalTakeOffOrLandTick(aircraft.landAltitude)
    if (done) {
      aircraft.position.x = padPos.x
      aircraft.position.z = padPos.z
      onLandingComplete()
    }
    return done
  } else {
    // Non-VTOL: gradual descent while approaching
    const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
    const landingAlt = aircraft.landAltitude / WORLD_SCALE

    if (horizontalDist < 0.3) {
      // Final approach - set down
      aircraft.position.x = padPos.x
      aircraft.position.z = padPos.z
      aircraft.position.y = landingAlt
      onLandingComplete()
      return true
    }

    flyTick(desiredFacing, aircraft.landAltitude)
    return false
  }
}

function onLandingComplete(): void {
  console.log('[Land] Landing sound triggered')
  currentPhase = 'landed'
  phaseTimer = 0
}

// ---------------------------------------------------------------------------
// Visual updates
// ---------------------------------------------------------------------------

function updateAircraftVisuals(): void {
  if (!aircraftMesh) return
  aircraftMesh.position = aircraft.position.clone()
  const facingRad = wAngleToRadians(aircraft.facing)
  aircraftMesh.rotation.y = -facingRad - Math.PI / 2
  aircraftMesh.rotation.z = (aircraft.roll * 2 * Math.PI / 1024)
  aircraftMesh.rotation.x = (aircraft.pitch * 2 * Math.PI / 1024)

  // Trail
  if (currentPhase !== 'ground' && currentPhase !== 'landed') {
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
  trailLine.color = new Color3(0.3, 0.5, 0.9)
}

function showApproachWaypoints(): void {
  // Clear old markers
  for (const m of waypointMarkers) { m.dispose() }
  waypointMarkers = []
  if (approachLine) { approachLine.dispose(); approachLine = null }

  // Create markers
  const colors = [new Color3(1, 1, 0), new Color3(1, 0.5, 0), new Color3(1, 0, 0)]
  for (let i = 0; i < approachWaypoints.length; i++) {
    const mat = new StandardMaterial(`wpMat${i}`, scene)
    mat.diffuseColor = colors[i]
    mat.emissiveColor = colors[i].scale(0.5)
    const sphere = MeshBuilder.CreateSphere(`wp${i}`, { diameter: 0.4 }, scene)
    sphere.position = approachWaypoints[i].clone()
    sphere.material = mat
    waypointMarkers.push(sphere)
  }

  // Draw approach line
  if (approachWaypoints.length >= 2) {
    const lines: Vector3[][] = []
    for (let i = 1; i < approachWaypoints.length; i++) {
      lines.push([approachWaypoints[i - 1], approachWaypoints[i]])
    }
    approachLine = MeshBuilder.CreateLineSystem('approach', { lines }, scene)
    approachLine.color = new Color3(1, 0.8, 0.2)
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function updateStats(): void {
  const pos = aircraft.position
  document.getElementById('st-pos')!.textContent =
    `${Math.round(pos.x * WORLD_SCALE)}, ${Math.round(pos.z * WORLD_SCALE)}, ${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-alt')!.textContent = `${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-state')!.textContent = currentPhase
  document.getElementById('st-phase')!.textContent =
    currentPhase === 'approach' ? `waypoint ${currentWaypointIndex + 1}/${approachWaypoints.length}` :
    currentPhase === 'takeoff' ? `alt: ${Math.round(pos.y * WORLD_SCALE)}/${aircraft.cruiseAltitude}` :
    currentPhase === 'landing' ? `h-dist: ${landingPadPosition ? Math.round(Vector3.Distance(new Vector3(pos.x, 0, pos.z), new Vector3(landingPadPosition.x, 0, landingPadPosition.z)) * WORLD_SCALE) : 0}` :
    '-'
  document.getElementById('st-target')!.textContent =
    landingPadPosition ? `${Math.round(landingPadPosition.x * WORLD_SCALE)}, ${Math.round(landingPadPosition.z * WORLD_SCALE)}` : '-'
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
    aircraft.vTOL = selAircraft.value === 'vtol'
  })

  document.getElementById('btn-takeoff')!.addEventListener('click', () => {
    if (currentPhase === 'ground' || currentPhase === 'landed') {
      currentPhase = 'takeoff'
      phaseTimer = 0
    }
  })

  document.getElementById('btn-land')!.addEventListener('click', () => {
    if (currentPhase === 'cruise' || currentPhase === 'ground') {
      currentPhase = 'approach'
      approachWaypoints = []
      currentWaypointIndex = 0
    }
  })

  document.getElementById('btn-cycle')!.addEventListener('click', () => {
    resetAircraft()
    currentPhase = 'takeoff'
    // After takeoff, will auto-transition to cruise, then approach, then landing
    setTimeout(() => { if (currentPhase === 'takeoff') currentPhase = 'cruise' }, 3000)
    setTimeout(() => { if (currentPhase === 'cruise') { currentPhase = 'approach'; approachWaypoints = []; currentWaypointIndex = 0 } }, 5000)
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetAircraft()
  })

  // Canvas click to set landing pad
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  canvas.addEventListener('pointerdown', (e) => {
    if (currentPhase !== 'ground' && currentPhase !== 'landed') return
    const rect = canvas.getBoundingClientRect()
    const pick = scene.pick(e.clientX - rect.left, e.clientY - rect.top, (m) => m.name === 'ground' || m.name === 'grid')
    if (pick.hit && pick.pickedPoint) {
      landingPadPosition = new Vector3(pick.pickedPoint.x, 0, pick.pickedPoint.z)
      landingPad.position.x = landingPadPosition.x
      landingPad.position.z = landingPadPosition.z
      // Update ring
      const ring = scene.getMeshByName('padRing')
      if (ring) {
        ring.position.x = landingPadPosition.x
        ring.position.z = landingPadPosition.z
      }
    }
  })
}

function resetAircraft(): void {
  aircraft.position = new Vector3(0, 0, 0)
  aircraft.facing = 0
  aircraft.pitch = 0
  aircraft.roll = 0
  currentPhase = 'ground'
  phaseTimer = 0
  approachWaypoints = []
  currentWaypointIndex = 0
  trailPoints = []
  if (trailLine) { trailLine.dispose(); trailLine = null }
  if (approachLine) { approachLine.dispose(); approachLine = null }
  for (const m of waypointMarkers) { m.dispose() }
  waypointMarkers = []
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
    phaseTimer++

    switch (currentPhase) {
      case 'takeoff': {
        const done = tickTakeOff()
        if (done) {
          currentPhase = 'cruise'
          phaseTimer = 0
        }
        break
      }
      case 'cruise': {
        // Just hover at cruise altitude
        const cruiseAlt = aircraft.cruiseAltitude / WORLD_SCALE
        if (Math.abs(aircraft.position.y - cruiseAlt) > 0.05) {
          aircraft.position.y += Math.sign(cruiseAlt - aircraft.position.y) * 0.02
        }
        break
      }
      case 'approach': {
        const done = tickApproach()
        if (done) {
          currentPhase = 'landing'
          phaseTimer = 0
        }
        break
      }
      case 'landing': {
        const done = tickLanding()
        if (done) {
          // Landed - handled in tickLanding
        }
        break
      }
    }
  }

  updateAircraftVisuals()
  updateStats()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// Expose
;(window as unknown as Record<string, unknown>).__landTakeoffTest = {
  aircraft,
  currentPhase,
  landingPadPosition,
  approachWaypoints,
}
