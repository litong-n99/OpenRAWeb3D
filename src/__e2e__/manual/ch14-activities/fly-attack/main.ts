/**
 * activities/fly-attack/main.ts — FlyAttack + FlyAttackRun + StrafeAttackRun acceptance test
 *
 * Verifies:
 * 1. Default attack: aircraft approaches, flies past target, fires, exits range
 * 2. Strafe attack: aircraft flies through target area, continuous fire, exit range
 * 3. Hover attack: aircraft holds position, turns to face target, fires
 * 4. Ammo depletion: triggers ReturnToBase with green target line
 * 5. Target line color changes: red for attack, green for return-to-base
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
const TURN_SPEED = 32
const WORLD_SCALE = 1024
const ATTACK_RANGE = 2500  // WDist
const MIN_RANGE = 500      // WDist
const STRAFE_EXIT_RANGE = 2000  // WDist

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
  canHover: boolean
  ammoPercent: number
}

let attacker: AircraftState = {
  position: new Vector3(-8, CRUISE_ALTITUDE / WORLD_SCALE, 0),
  facing: 256,  // East (facing toward target at origin)
  pitch: 0,
  roll: 0,
  speed: MOVEMENT_SPEED,
  turnSpeed: TURN_SPEED,
  canHover: false,
  ammoPercent: 100,
}

// Target building
let targetPosition: Vector3 = new Vector3(0, 0, 0)
let basePosition: Vector3 = new Vector3(-12, 0, -8)

// Attack state machine
type AttackPhase = 'idle' | 'approach' | 'attack_run' | 'strafe' | 'hover' | 'exit' | 'return_to_base'
let currentPhase: AttackPhase = 'idle'
let attackType: 'default' | 'strafe' | 'hover' = 'default'
let phaseTimer = 0
let attackRunCount = 0

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let attackerMesh!: TransformNode
let targetMesh!: Mesh
let baseMesh!: Mesh
let targetLine: LinesMesh | null = null
let attackTrail: LinesMesh | null = null
let attackTrailPoints: Vector3[] = []
let fireEffect: Mesh | null = null
let fireTimer = 0

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

  // Target building (blue box)
  const targetMat = new StandardMaterial('targetMat', scene)
  targetMat.diffuseColor = new Color3(0.3, 0.4, 0.7)
  targetMat.specularColor = new Color3(0.1, 0.1, 0.2)
  targetMesh = MeshBuilder.CreateBox('target', { width: 2, height: 2, depth: 2 }, scene)
  targetMesh.position = targetPosition.clone()
  targetMesh.position.y = 1
  targetMesh.material = targetMat

  // Target marker ring
  const targetRing = MeshBuilder.CreateTorus('targetRing', { diameter: 3, thickness: 0.08 }, scene)
  targetRing.position = targetPosition.clone()
  targetRing.position.y = 0.05
  targetRing.scaling.y = 0.01
  const targetRingMat = new StandardMaterial('targetRingMat', scene)
  targetRingMat.emissiveColor = new Color3(0.2, 0.4, 0.8)
  targetRing.material = targetRingMat

  // Attack range ring (visual indicator)
  const rangeRing = MeshBuilder.CreateTorus('rangeRing', { diameter: (ATTACK_RANGE / WORLD_SCALE) * 2, thickness: 0.05 }, scene)
  rangeRing.position = targetPosition.clone()
  rangeRing.position.y = 0.03
  rangeRing.scaling.y = 0.01
  const rangeMat = new StandardMaterial('rangeMat', scene)
  rangeMat.emissiveColor = new Color3(0.8, 0.2, 0.2)
  rangeRing.material = rangeMat

  // Base building (green - resupply point)
  const baseMat = new StandardMaterial('baseMat', scene)
  baseMat.diffuseColor = new Color3(0.3, 0.6, 0.3)
  baseMesh = MeshBuilder.CreateBox('base', { width: 2.5, height: 1.5, depth: 2.5 }, scene)
  baseMesh.position = basePosition.clone()
  baseMesh.position.y = 0.75
  baseMesh.material = baseMat

  // Base marker
  const baseRing = MeshBuilder.CreateTorus('baseRing', { diameter: 3.5, thickness: 0.08 }, scene)
  baseRing.position = basePosition.clone()
  baseRing.position.y = 0.05
  baseRing.scaling.y = 0.01
  const baseRingMat = new StandardMaterial('baseRingMat', scene)
  baseRingMat.emissiveColor = new Color3(0.2, 0.7, 0.2)
  baseRing.material = baseRingMat

  // Attacker aircraft (red - enemy)
  attackerMesh = new TransformNode('attackerRoot', scene)

  const bodyMat = new StandardMaterial('attackerBodyMat', scene)
  bodyMat.diffuseColor = new Color3(0.8, 0.3, 0.3)
  const body = MeshBuilder.CreateBox('abody', { width: 0.6, height: 0.3, depth: 1.2 }, scene)
  body.material = bodyMat
  body.parent = attackerMesh

  const wingMat = new StandardMaterial('attackerWingMat', scene)
  wingMat.diffuseColor = new Color3(0.7, 0.2, 0.2)
  const leftWing = MeshBuilder.CreateBox('alw', { width: 1.2, height: 0.1, depth: 0.4 }, scene)
  leftWing.position.x = -0.6
  leftWing.position.z = -0.1
  leftWing.material = wingMat
  leftWing.parent = attackerMesh

  const rightWing = MeshBuilder.CreateBox('arw', { width: 1.2, height: 0.1, depth: 0.4 }, scene)
  rightWing.position.x = 0.6
  rightWing.position.z = -0.1
  rightWing.material = wingMat
  rightWing.parent = attackerMesh

  const noseMat = new StandardMaterial('attackerNoseMat', scene)
  noseMat.diffuseColor = new Color3(0.9, 0.5, 0.1)
  const nose = MeshBuilder.CreateBox('anose', { width: 0.3, height: 0.25, depth: 0.4 }, scene)
  nose.position.z = -0.8
  nose.material = noseMat
  nose.parent = attackerMesh

  updateAttackerVisuals()
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

// ---------------------------------------------------------------------------
// Flight physics
// ---------------------------------------------------------------------------

function flyTick(desiredFacing: number, speed: number): void {
  attacker.facing = tickFacing(attacker.facing, desiredFacing, attacker.turnSpeed)
  const facingRad = wAngleToRadians(attacker.facing)
  const moveX = (speed / WORLD_SCALE) * Math.cos(facingRad)
  const moveZ = (speed / WORLD_SCALE) * Math.sin(facingRad)
  attacker.position = new Vector3(
    attacker.position.x + moveX,
    attacker.position.y,
    attacker.position.z + moveZ,
  )
}

function getDistanceToTarget(): number {
  const dx = attacker.position.x - targetPosition.x
  const dz = attacker.position.z - targetPosition.z
  return Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
}

function getFacingToTarget(): number {
  const dx = targetPosition.x - attacker.position.x
  const dz = targetPosition.z - attacker.position.z
  return Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
}

function getFacingAwayFromTarget(): number {
  return (getFacingToTarget() + 512) % 1024
}

// ---------------------------------------------------------------------------
// Attack phase logic
// ---------------------------------------------------------------------------

function tickApproach(): boolean {
  const dist = getDistanceToTarget()
  const desiredFacing = getFacingToTarget()
  flyTick(desiredFacing, attacker.speed)

  // Check if in attack range
  if (dist <= ATTACK_RANGE && dist >= MIN_RANGE) {
    return true  // Ready to attack
  }
  return false
}

function tickAttackRun(): boolean {
  // FlyAttackRun: fly past target, fire, exit range
  phaseTimer++
  const desiredFacing = getFacingToTarget()
  flyTick(desiredFacing, attacker.speed)

  // Fire when close
  const dist = getDistanceToTarget()
  if (dist < ATTACK_RANGE * 0.5) {
    showFireEffect()
    attacker.ammoPercent = Math.max(0, attacker.ammoPercent - 0.5)
  }

  // Exit when past target (distance starts increasing)
  if (phaseTimer > 20 && dist > ATTACK_RANGE * 0.8) {
    return true
  }
  return false
}

function tickStrafe(): boolean {
  // StrafeAttackRun: fly through target area, continuous fire
  phaseTimer++
  const desiredFacing = getFacingToTarget()
  flyTick(desiredFacing, attacker.speed)

  // Continuous fire while in range
  const dist = getDistanceToTarget()
  if (dist < ATTACK_RANGE) {
    showFireEffect()
    attacker.ammoPercent = Math.max(0, attacker.ammoPercent - 1)
  }

  // Exit after passing through
  if (phaseTimer > 40 || dist > STRAFE_EXIT_RANGE) {
    return true
  }
  return false
}

function tickHover(): boolean {
  // Hover attack: hold position, turn to face, fire
  phaseTimer++
  const desiredFacing = getFacingToTarget()
  attacker.facing = tickFacing(attacker.facing, desiredFacing, attacker.turnSpeed)

  // Stay in position (small drift allowed)
  const dist = getDistanceToTarget()
  if (dist > ATTACK_RANGE * 0.3) {
    // Move closer
    flyTick(desiredFacing, attacker.speed * 0.3)
  }

  // Fire when facing target
  const facingDiff = Math.abs(((desiredFacing - attacker.facing + 1024) % 1024 + 512) % 1024 - 512)
  if (facingDiff < 64) {
    showFireEffect()
    attacker.ammoPercent = Math.max(0, attacker.ammoPercent - 0.3)
  }

  // Attack for a while then exit
  if (phaseTimer > 60) {
    return true
  }
  return false
}

function tickExit(): boolean {
  // Fly away from target
  const desiredFacing = getFacingAwayFromTarget()
  flyTick(desiredFacing, attacker.speed)
  const dist = getDistanceToTarget()
  if (dist > ATTACK_RANGE * 1.5) {
    return true
  }
  return false
}

function tickReturnToBase(): boolean {
  // Return to base (green target line)
  const dx = basePosition.x - attacker.position.x
  const dz = basePosition.z - attacker.position.z
  const dist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
  const desiredFacing = Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
  flyTick(desiredFacing, attacker.speed)

  if (dist < 500) {
    return true  // Arrived at base
  }
  return false
}

// ---------------------------------------------------------------------------
// Visual effects
// ---------------------------------------------------------------------------

function showFireEffect(): void {
  if (fireTimer > 0) return
  fireTimer = 5

  if (fireEffect) {
    fireEffect.dispose()
    fireEffect = null
  }

  // Muzzle flash at aircraft nose
  const facingRad = wAngleToRadians(attacker.facing)
  const noseOffset = 1.0
  const flashPos = new Vector3(
    attacker.position.x + noseOffset * Math.cos(facingRad),
    attacker.position.y,
    attacker.position.z + noseOffset * Math.sin(facingRad),
  )

  const flashMat = new StandardMaterial('flashMat', scene)
  flashMat.emissiveColor = new Color3(1, 0.8, 0.2)
  fireEffect = MeshBuilder.CreateSphere('flash', { diameter: 0.3 }, scene)
  fireEffect.position = flashPos
  fireEffect.material = flashMat
}

function updateFireEffect(): void {
  if (fireTimer > 0) {
    fireTimer--
    if (fireTimer <= 0 && fireEffect) {
      fireEffect.dispose()
      fireEffect = null
    }
  }
}

function updateAttackerVisuals(): void {
  if (!attackerMesh) return
  attackerMesh.position = attacker.position.clone()
  const facingRad = wAngleToRadians(attacker.facing)
  attackerMesh.rotation.y = -facingRad - Math.PI / 2
  attackerMesh.rotation.z = (attacker.roll * 2 * Math.PI / 1024)

  // Trail
  if (currentPhase !== 'idle') {
    attackTrailPoints.push(attacker.position.clone())
    if (attackTrailPoints.length > 400) attackTrailPoints.shift()
    updateAttackTrail()
  }
}

function updateAttackTrail(): void {
  if (attackTrail) { attackTrail.dispose(); attackTrail = null }
  if (attackTrailPoints.length < 2) return

  // Color based on phase: red for attack, green for return
  const isReturn = currentPhase === 'return_to_base'
  const lines: Vector3[][] = []
  for (let i = 1; i < attackTrailPoints.length; i++) {
    lines.push([attackTrailPoints[i - 1], attackTrailPoints[i]])
  }
  attackTrail = MeshBuilder.CreateLineSystem('attackTrail', { lines }, scene)
  attackTrail.color = isReturn ? new Color3(0, 1, 0) : new Color3(0.9, 0.3, 0.3)
}

function updateTargetLine(): void {
  if (targetLine) { targetLine.dispose(); targetLine = null }

  if (currentPhase === 'idle') return

  let endPoint: Vector3
  let color: Color3

  if (currentPhase === 'return_to_base') {
    endPoint = basePosition.clone()
    endPoint.y = attacker.position.y
    color = new Color3(0, 1, 0)  // Green for return
  } else {
    endPoint = targetPosition.clone()
    endPoint.y = attacker.position.y
    color = new Color3(1, 0, 0)  // Red for attack
  }

  const lines = [[attacker.position.clone(), endPoint]]
  targetLine = MeshBuilder.CreateLineSystem('targetLine', { lines }, scene)
  targetLine.color = color
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function updateStats(): void {
  const pos = attacker.position
  document.getElementById('st-attacker-pos')!.textContent =
    `${Math.round(pos.x * WORLD_SCALE)}, ${Math.round(pos.z * WORLD_SCALE)}, ${Math.round(pos.y * WORLD_SCALE)}`
  document.getElementById('st-attack-state')!.textContent = currentPhase
  document.getElementById('st-attack-type')!.textContent = attackType
  document.getElementById('st-ammo')!.textContent = `${Math.round(attacker.ammoPercent)}%`
  document.getElementById('st-target-line')!.textContent =
    currentPhase === 'return_to_base' ? '绿色 (返航)' :
    currentPhase === 'idle' ? '-' : '红色 (攻击)'
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
  const selAttack = document.getElementById('sel-attack') as HTMLSelectElement

  document.getElementById('btn-attack')!.addEventListener('click', () => {
    const type = selAttack.value as 'default' | 'strafe' | 'hover'
    startAttack(type)
  })

  document.getElementById('btn-ammo-empty')!.addEventListener('click', () => {
    attacker.ammoPercent = 0
    if (currentPhase !== 'idle' && currentPhase !== 'return_to_base') {
      currentPhase = 'return_to_base'
      phaseTimer = 0
    }
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetAttacker()
  })

  // Canvas click to set target
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect()
    const pick = scene.pick(e.clientX - rect.left, e.clientY - rect.top, (m) => m.name === 'ground' || m.name === 'grid')
    if (pick.hit && pick.pickedPoint) {
      targetPosition = new Vector3(pick.pickedPoint.x, 0, pick.pickedPoint.z)
      targetMesh.position.x = targetPosition.x
      targetMesh.position.z = targetPosition.z

      // Update range ring
      const rangeRing = scene.getMeshByName('rangeRing')
      if (rangeRing) {
        rangeRing.position.x = targetPosition.x
        rangeRing.position.z = targetPosition.z
      }

      // Update target ring
      const targetRing = scene.getMeshByName('targetRing')
      if (targetRing) {
        targetRing.position.x = targetPosition.x
        targetRing.position.z = targetPosition.z
      }
    }
  })
}

function startAttack(type: 'default' | 'strafe' | 'hover'): void {
  attackType = type
  attacker.canHover = type === 'hover'
  currentPhase = 'approach'
  phaseTimer = 0
  attackRunCount = 0
  attackTrailPoints = []
  if (attackTrail) { attackTrail.dispose(); attackTrail = null }
}

function resetAttacker(): void {
  attacker.position = new Vector3(-8, CRUISE_ALTITUDE / WORLD_SCALE, 0)
  attacker.facing = 256
  attacker.pitch = 0
  attacker.roll = 0
  attacker.ammoPercent = 100
  currentPhase = 'idle'
  phaseTimer = 0
  attackRunCount = 0
  attackTrailPoints = []
  if (attackTrail) { attackTrail.dispose(); attackTrail = null }
  if (targetLine) { targetLine.dispose(); targetLine = null }
  if (fireEffect) { fireEffect.dispose(); fireEffect = null }
  updateAttackerVisuals()
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

    if (currentPhase !== 'idle') {
      let done = false
      switch (currentPhase) {
        case 'approach':
          done = tickApproach()
          if (done) {
            if (attackType === 'default') {
              currentPhase = 'attack_run'
            } else if (attackType === 'strafe') {
              currentPhase = 'strafe'
            } else {
              currentPhase = 'hover'
            }
            phaseTimer = 0
          }
          break
        case 'attack_run':
          done = tickAttackRun()
          if (done) {
            attackRunCount++
            if (attackRunCount >= 2 || attacker.ammoPercent <= 0) {
              currentPhase = 'exit'
            } else {
              currentPhase = 'approach'
            }
            phaseTimer = 0
          }
          break
        case 'strafe':
          done = tickStrafe()
          if (done) {
            currentPhase = 'exit'
            phaseTimer = 0
          }
          break
        case 'hover':
          done = tickHover()
          if (done) {
            currentPhase = 'exit'
            phaseTimer = 0
          }
          break
        case 'exit':
          done = tickExit()
          if (done) {
            if (attacker.ammoPercent <= 0) {
              currentPhase = 'return_to_base'
            } else {
              currentPhase = 'approach'
            }
            phaseTimer = 0
          }
          break
        case 'return_to_base':
          done = tickReturnToBase()
          if (done) {
            currentPhase = 'idle'
            attacker.ammoPercent = 100  // Resupplied
          }
          break
      }
    }

    updateFireEffect()
  }

  updateAttackerVisuals()
  updateTargetLine()
  updateStats()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// Expose
;(window as unknown as Record<string, unknown>).__flyAttackTest = {
  attacker,
  currentPhase,
  attackType,
  targetPosition,
  basePosition,
}
