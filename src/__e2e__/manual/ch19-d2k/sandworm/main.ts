/**
 * ch19-d2k/sandworm/main.ts — Sandworm visual acceptance test
 *
 * Verifies:
 * 1. Sandworm state machine: Burrowed → Emerging → Attacking → Submerging
 * 2. Underground movement (Y < 0, low alpha)
 * 3. Emerge animation (Y-axis rise)
 * 4. Swallow attack (target scales to zero)
 * 5. Noise-based tracking (AttractsWorms sources)
 * 6. ChanceToDisappear fade-out
 *
 * OpenRA coordinate system:
 *   - WAngle 0 = North (negative Z), CCW
 *   - In Babylon.js: X stays X, Z = -Y (north is negative Z), Y = altitude
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
  TransformNode,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Sandworm states (mirrors AttackState + Sandworm movement modes)
// ---------------------------------------------------------------------------

const WormState = {
  Burrowed: 'Burrowed',
  Emerging: 'Emerging',
  Attacking: 'Attacking',
  Submerging: 'Submerging',
  Wandering: 'Wandering',
  MovingToNoise: 'MovingToNoise',
} as const
type WormState = (typeof WormState)[keyof typeof WormState]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const TICK_RATE = 1000 / 25 // 25 ticks/s
const RETURN_DELAY = 60 // ticks
const EMERGE_DURATION = 30 // ticks
const SUBMERGE_DURATION = 30 // ticks
const MOVE_SPEED = 80 // WDist/tick
const BURROW_DEPTH = -2.0 // Babylon units
const SURFACE_HEIGHT = 1.5 // Babylon units
const DEFAULT_SEARCH_RADIUS = 5 // cells
const CLOSE_ATTACK_RANGE = 3 // cells (IgnoreNoiseAttackRange)
const MAX_SEARCH_RADIUS = 20 // cells (MaxSearchRadius)
const DISAPPEAR_DURATION = 20 // ticks

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let wormState: WormState = WormState.Burrowed
let wormPosition = new Vector3(0, BURROW_DEPTH, 0)
let wormFacing = 0 // WAngle (0=North, CCW)
let stateTick = 0
let targetPosition: Vector3 | null = null
let noiseSources: Vector3[] = []
let attackCountdown = 0
let wanderMoveRadius = DEFAULT_SEARCH_RADIUS
let chanceToDisappear = 100 // matches SandwormInfo.ChanceToDisappear default
let isDisappearing = false

// ---------------------------------------------------------------------------
// Babylon.js
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let wormRoot!: TransformNode
let wormHead!: Mesh
let wormSegments: Mesh[] = []
let targetMarker: Mesh | null = null
let noiseMarkers: Mesh[] = []
let searchRing: Mesh | null = null
let closeAttackRing: Mesh | null = null
let groundRipple: Mesh | null = null

function wAngleToRadians(angle: number): number {
  // WAngle 0 = North (-Z), CCW
  // BUGFIX ch14 guard: use + sign — same pattern as ch14/fly, fly-attack,
  // land-takeoff, return-to-base. Negative sign caused reverse direction.
  return -Math.PI / 2 + (angle * 2 * Math.PI / 1024)
}

function wAngleFromVector(dx: number, dz: number): number {
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return 0
  const rad = Math.atan2(dx, -dz)
  return ((Math.round(((rad + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024) + 1024) % 1024
}

function tickFacing(current: number, desired: number, turnSpeed: number): number {
  const diff = ((desired - current + 1024) % 1024 + 512) % 1024 - 512
  if (Math.abs(diff) <= turnSpeed) return desired
  return (current + Math.sign(diff) * turnSpeed + 1024) % 1024
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.15, 0.12, 0.08, 1) // Desert sky

  // Camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3.5, 20, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 50

  // Lights
  new HemisphericLight('hemi', new Vector3(0.3, 1, -0.5), scene)

  // Desert ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.55, 0.42, 0.25)
  groundMat.specularColor = new Color3(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40, subdivisions: 20 }, scene)
  ground.position.y = -0.05
  ground.material = groundMat

  // Grid overlay
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.45, 0.35, 0.2)
  const gridMesh = MeshBuilder.CreateGround('grid', { width: 40, height: 40, subdivisions: 20 }, scene)
  gridMesh.position.y = -0.04
  gridMesh.material = gridMat

  // Sandworm mesh
  wormRoot = new TransformNode('wormRoot', scene)

  // Body segments (5 segments to look like a worm)
  const bodyMat = new StandardMaterial('bodyMat', scene)
  bodyMat.diffuseColor = new Color3(0.55, 0.35, 0.17)
  bodyMat.specularColor = new Color3(0.1, 0.05, 0)
  bodyMat.alpha = 0.2

  // Head
  const headMat = new StandardMaterial('headMat', scene)
  headMat.diffuseColor = new Color3(0.6, 0.15, 0.1)
  headMat.specularColor = new Color3(0.1, 0.05, 0)
  headMat.alpha = 0.2

  wormHead = MeshBuilder.CreateSphere('wormHead', { diameter: 0.7 }, scene)
  wormHead.position.z = -2.0
  wormHead.material = headMat
  wormHead.parent = wormRoot

  for (let i = 0; i < 5; i++) {
    const seg = MeshBuilder.CreateSphere(`wormSeg${i}`, { diameter: 0.6 - i * 0.04 }, scene)
    seg.position.z = -1.5 + i * 0.6
    seg.material = bodyMat
    seg.parent = wormRoot
    wormSegments.push(seg)
  }

  // Tail tip
  const tailMat = new StandardMaterial('tailMat', scene)
  tailMat.diffuseColor = new Color3(0.5, 0.3, 0.15)
  tailMat.specularColor = new Color3(0, 0, 0)
  tailMat.alpha = 0.2
  const tail = MeshBuilder.CreateSphere('wormTail', { diameter: 0.4 }, scene)
  tail.position.z = 1.8
  tail.material = tailMat
  tail.parent = wormRoot
  wormSegments.push(tail)

  // Ground ripple ring (for emerge effect)
  groundRipple = MeshBuilder.CreateTorus('ripple', { diameter: 0, thickness: 0.03 }, scene)
  groundRipple.rotation.x = Math.PI / 2
  groundRipple.position.y = 0.01
  groundRipple.isVisible = false
  const rippleMat = new StandardMaterial('rippleMat', scene)
  rippleMat.diffuseColor = new Color3(0.6, 0.45, 0.25)
  rippleMat.emissiveColor = new Color3(0.2, 0.15, 0.05)
  groundRipple.material = rippleMat

  // Search range ring
  const ringMat = new StandardMaterial('ringMat', scene)
  ringMat.diffuseColor = new Color3(0.3, 0.5, 0.8)
  ringMat.emissiveColor = new Color3(0.1, 0.2, 0.4)
  ringMat.alpha = 0.3
  searchRing = MeshBuilder.CreateTorus('searchRing', {
    diameter: DEFAULT_SEARCH_RADIUS * 2,
    thickness: 0.08,
  }, scene)
  searchRing.rotation.x = Math.PI / 2
  searchRing.position.y = 0.02
  searchRing.material = ringMat

  // Close attack range ring
  const closeRingMat = new StandardMaterial('closeRingMat', scene)
  closeRingMat.diffuseColor = new Color3(0.8, 0.2, 0.1)
  closeRingMat.emissiveColor = new Color3(0.3, 0.05, 0)
  closeRingMat.alpha = 0.25
  closeAttackRing = MeshBuilder.CreateTorus('closeRing', {
    diameter: CLOSE_ATTACK_RANGE * 2,
    thickness: 0.06,
  }, scene)
  closeAttackRing.rotation.x = Math.PI / 2
  closeAttackRing.position.y = 0.03
  closeAttackRing.material = closeRingMat

  updateWormTransform()
  updateSearchRing()
}

// ---------------------------------------------------------------------------
// Worm transform update
// ---------------------------------------------------------------------------

function updateWormTransform(): void {
  wormRoot.position = wormPosition.clone()
  const facingRad = wAngleToRadians(wormFacing)
  wormRoot.rotation.y = -facingRad - Math.PI / 2

  // Alpha based on state
  let alpha = 1.0
  switch (wormState) {
    case WormState.Burrowed:
    case WormState.Wandering:
    case WormState.MovingToNoise:
      alpha = 0.2
      break
    case WormState.Emerging:
      alpha = 0.2 + 0.8 * Math.min(stateTick / EMERGE_DURATION, 1)
      break
    case WormState.Attacking:
      alpha = 1.0
      break
    case WormState.Submerging:
      alpha = 1.0 - 0.8 * Math.min(stateTick / SUBMERGE_DURATION, 1)
      break
  }

  updateWormAlpha(alpha)
  updateWormColor()

  // Update search ring position
  if (searchRing) {
    searchRing.position.x = wormPosition.x
    searchRing.position.z = wormPosition.z
  }
  if (closeAttackRing) {
    closeAttackRing.position.x = wormPosition.x
    closeAttackRing.position.z = wormPosition.z
  }

  // Update ground ripple
  if (groundRipple) {
    groundRipple.position.x = wormPosition.x
    groundRipple.position.z = wormPosition.z
    if (wormState === WormState.Emerging || wormState === WormState.Submerging) {
      groundRipple.isVisible = true
      const progress = wormState === WormState.Emerging
        ? Math.min(stateTick / EMERGE_DURATION, 1)
        : Math.min(stateTick / SUBMERGE_DURATION, 1)
      groundRipple.scaling.x = 1 + progress * 3
      groundRipple.scaling.z = 1 + progress * 3
      ;(groundRipple.material as StandardMaterial).alpha = Math.max(0, 0.6 - progress * 0.6)
    } else {
      groundRipple.isVisible = false
    }
  }
}

function updateWormAlpha(alpha: number): void {
  const mats = [
    wormHead.material as StandardMaterial,
    ...wormSegments.map(s => s.material as StandardMaterial),
  ]
  for (const m of mats) {
    m.alpha = alpha
  }
}

// Pre-allocated colors to avoid per-tick allocation
const WORM_COLOR_BROWN = new Color3(0.55, 0.35, 0.17)
const WORM_COLOR_RED = new Color3(0.55, 0.1, 0.05)
const WORM_COLOR_TRANSITION = new Color3(0.5, 0.3, 0.15)

function updateWormColor(): void {
  let color = WORM_COLOR_BROWN
  switch (wormState) {
    case WormState.Attacking:
      color = WORM_COLOR_RED
      break
    case WormState.Emerging:
    case WormState.Submerging:
      color = WORM_COLOR_TRANSITION
      break
    default:
      color = WORM_COLOR_BROWN
  }

  const headMat = wormHead.material as StandardMaterial
  if (headMat.diffuseColor !== color) {
    headMat.diffuseColor = color
    for (const s of wormSegments) {
      ;(s.material as StandardMaterial).diffuseColor = color
    }
  }
}

function updateSearchRing(): void {
  if (!searchRing) return
  const diameter = wanderMoveRadius * 2
  searchRing.scaling.x = diameter / (DEFAULT_SEARCH_RADIUS * 2)
  searchRing.scaling.z = diameter / (DEFAULT_SEARCH_RADIUS * 2)
}

// ---------------------------------------------------------------------------
// Target & noise markers
// ---------------------------------------------------------------------------

function createTargetMarker(pos: Vector3): void {
  if (targetMarker) targetMarker.dispose()

  const mat = new StandardMaterial('targetMat', scene)
  mat.diffuseColor = new Color3(1, 0.8, 0.2)
  mat.emissiveColor = new Color3(0.5, 0.3, 0)

  targetMarker = MeshBuilder.CreateBox('target', { width: 0.6, height: 1.2, depth: 0.6 }, scene)
  targetMarker.position = pos.clone()
  targetMarker.position.y = 0.5
  targetMarker.material = mat

  // Ground ring at target
  const ring = MeshBuilder.CreateTorus('targetGroundRing', { diameter: 1.0, thickness: 0.04 }, scene)
  ring.rotation.x = Math.PI / 2
  ring.position = new Vector3(pos.x, 0.02, pos.z)
  const ringMat = new StandardMaterial('targetRingMat', scene)
  ringMat.emissiveColor = new Color3(1, 0.8, 0.2)
  ring.material = ringMat
  ring.parent = targetMarker
}

function createNoiseSource(pos: Vector3): void {
  const mat = new StandardMaterial('noiseMat', scene)
  mat.diffuseColor = new Color3(1, 0.4, 0.6)
  mat.emissiveColor = new Color3(0.5, 0.1, 0.2)

  const marker = MeshBuilder.CreateSphere('noiseSrc', { diameter: 0.8 }, scene)
  marker.position = pos.clone()
  marker.position.y = 0.4
  marker.material = mat
  noiseMarkers.push(marker)

  // Pulsing ring
  const ring = MeshBuilder.CreateTorus('noiseRing', { diameter: 1.5, thickness: 0.04 }, scene)
  ring.rotation.x = Math.PI / 2
  ring.position = new Vector3(pos.x, 0.03, pos.z)
  const ringMat = new StandardMaterial('noiseRingMat', scene)
  ringMat.emissiveColor = new Color3(0.6, 0.2, 0.4)
  ring.material = ringMat
  ring.parent = marker

  noiseSources.push(pos.clone())
}

function clearNoiseSources(): void {
  for (const m of noiseMarkers) m.dispose()
  noiseMarkers = []
  noiseSources = []
}

// ---------------------------------------------------------------------------
// Worm state machine
// ---------------------------------------------------------------------------

// AttractsWorms constants (matching OpenRA defaults)
const ATTRACTS_SPREAD = 3072 // WDist (Info.Spread default)
const ATTRACTS_MAX_STEPS = 10 // Info.MaxSpreadSteps default

function computeNoiseVector(): Vector3 | null {
  if (noiseSources.length === 0) return null

  let totalDx = 0
  let totalDz = 0
  for (const src of noiseSources) {
    const dx = src.x - wormPosition.x
    const dz = src.z - wormPosition.z
    const distWorld = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE // WDist
    const maxDistWorld = MAX_SEARCH_RADIUS * WORLD_SCALE // cells → WDist
    if (distWorld > maxDistWorld) continue

    // AttractsWorms.attractionAtPosition: stepped falloff
    // Intensity = 1.0 within Spread, then decreases by 1/MaxSpreadSteps per step
    let intensity = 0
    const spreadWorld = ATTRACTS_SPREAD / WORLD_SCALE
    const distWorldUnits = distWorld / WORLD_SCALE
    if (distWorldUnits <= spreadWorld) {
      intensity = 1.0
    } else {
      for (let step = 1; step <= ATTRACTS_MAX_STEPS; step++) {
        if (distWorldUnits <= spreadWorld * step) {
          intensity = (ATTRACTS_MAX_STEPS - step + 1) / ATTRACTS_MAX_STEPS
          break
        }
      }
    }
    if (intensity <= 0) continue

    const normDist = Math.max(Math.sqrt(dx * dx + dz * dz), 0.01)
    totalDx += (dx / normDist) * intensity
    totalDz += (dz / normDist) * intensity
  }

  if (Math.abs(totalDx) < 0.001 && Math.abs(totalDz) < 0.001) return null
  return new Vector3(totalDx, 0, totalDz)
}

function findClosestTarget(): Vector3 | null {
  if (noiseSources.length === 0) return null

  let closest: Vector3 | null = null
  let closestDist = Infinity

  for (const src of noiseSources) {
    const dx = src.x - wormPosition.x
    const dz = src.z - wormPosition.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < closestDist) {
      closestDist = dist
      closest = src.clone()
    }
  }

  return closest
}

function isInCloseRange(target: Vector3): boolean {
  const dx = target.x - wormPosition.x
  const dz = target.z - wormPosition.z
  return Math.sqrt(dx * dx + dz * dz) <= CLOSE_ATTACK_RANGE * 1.0
}

function triggerScan(): void {
  // If close target exists, attack immediately
  const closestTarget = findClosestTarget()
  if (closestTarget && isInCloseRange(closestTarget)) {
    targetPosition = closestTarget.clone()
    createTargetMarker(closestTarget)
    startEmerging()
    return
  }

  // Compute noise vector
  const noiseVec = computeNoiseVector()
  if (noiseVec) {
    const desired = wAngleFromVector(noiseVec.x, noiseVec.z)
    wormFacing = desired
    wormState = WormState.MovingToNoise
    stateTick = 0
  } else {
    // Random wander
    const randFacing = Math.floor(Math.random() * 1024)
    wormFacing = randFacing
    wormState = WormState.Wandering
    stateTick = 0
  }
}

function startEmerging(): void {
  wormState = WormState.Emerging
  stateTick = 0
}

function startAttack(): void {
  if (!targetPosition) {
    const closest = findClosestTarget()
    if (closest) {
      targetPosition = closest.clone()
      createTargetMarker(closest)
    } else {
      return
    }
  }

  wormState = WormState.Attacking
  stateTick = 0
  attackCountdown = RETURN_DELAY
}

function startSubmerging(): void {
  wormState = WormState.Submerging
  stateTick = 0
}

function triggerDisappear(): void {
  // SwallowActor.tick: random check against ChanceToDisappear
  const roll = Math.floor(Math.random() * 100)
  if (roll < chanceToDisappear) {
    isDisappearing = true
  } else {
    isDisappearing = false
  }
  wormState = WormState.Submerging
  stateTick = 0
}

function resetAll(): void {
  wormState = WormState.Burrowed
  wormPosition = new Vector3(0, BURROW_DEPTH, 0)
  wormFacing = 0
  stateTick = 0
  attackCountdown = 0
  targetPosition = null

  if (targetMarker) { targetMarker.dispose(); targetMarker = null }
  clearNoiseSources()
  updateWormTransform()
}

// ---------------------------------------------------------------------------
// Per-tick logic
// ---------------------------------------------------------------------------

function wormTick(): void {
  stateTick++

  switch (wormState) {
    case WormState.Burrowed:
      // Idle underground — do nothing until scan
      break

    case WormState.Wandering:
    case WormState.MovingToNoise: {
      // Move forward at current facing
      const facingRad = wAngleToRadians(wormFacing)
      const speedWorld = MOVE_SPEED / WORLD_SCALE
      wormPosition.x += speedWorld * Math.cos(facingRad)
      wormPosition.z += speedWorld * Math.sin(facingRad)
      wormPosition.y = BURROW_DEPTH

      // Periodically rescan
      if (stateTick >= 125) {
        triggerScan()
      }
      break
    }

    case WormState.Emerging: {
      // Rise from underground
      const progress = Math.min(stateTick / EMERGE_DURATION, 1)
      wormPosition.y = BURROW_DEPTH + (SURFACE_HEIGHT - BURROW_DEPTH) * progress
      if (stateTick >= EMERGE_DURATION) {
        startAttack()
      }
      break
    }

    case WormState.Attacking: {
      // Face target
      if (targetPosition) {
        const dx = targetPosition.x - wormPosition.x
        const dz = targetPosition.z - wormPosition.z
        const desired = wAngleFromVector(dx, dz)
        wormFacing = tickFacing(wormFacing, desired, 32)

        // Move toward target
        if (Math.sqrt(dx * dx + dz * dz) > 1.0) {
          const facingRad = wAngleToRadians(wormFacing)
          const speedWorld = (MOVE_SPEED * 1.5) / WORLD_SCALE
          wormPosition.x += speedWorld * Math.cos(facingRad)
          wormPosition.z += speedWorld * Math.sin(facingRad)
        }
      }

      wormPosition.y = SURFACE_HEIGHT
      attackCountdown--

      // Target swallow animation
      if (targetMarker && attackCountdown < RETURN_DELAY) {
        const swallowProgress = 1 - attackCountdown / RETURN_DELAY
        const targetScale = Math.max(0, 1 - swallowProgress * 1.5)
        targetMarker.scaling.setAll(Math.max(0.01, targetScale))
        targetMarker.position.y = 0.5 + swallowProgress * SURFACE_HEIGHT
      }

      if (attackCountdown <= 0) {
        // Dispose target
        if (targetMarker) { targetMarker.dispose(); targetMarker = null }

        // Chance to disappear (100% default)
        triggerDisappear()
      }
      break
    }

    case WormState.Submerging: {
      const progress = Math.min(stateTick / SUBMERGE_DURATION, 1)
      wormPosition.y = SURFACE_HEIGHT + (BURROW_DEPTH - SURFACE_HEIGHT) * progress

      // Disappear: also scale down (only when isDisappearing)
      if (isDisappearing && stateTick <= DISAPPEAR_DURATION) {
        const disappearProgress = Math.min(stateTick / DISAPPEAR_DURATION, 1)
        wormRoot.scaling.setAll(Math.max(0.01, 1 - disappearProgress))
      }

      if (stateTick >= SUBMERGE_DURATION) {
        wormState = WormState.Burrowed
        stateTick = 0
        wormRoot.scaling.setAll(1)
        isDisappearing = false
        if (targetMarker) { targetMarker.dispose(); targetMarker = null }
        targetPosition = null
      }
      break
    }
  }

  updateWormTransform()
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateUI(): void {
  const stateLabels: Record<string, string> = {
    [WormState.Burrowed]: 'Burrowed (地下)',
    [WormState.Emerging]: `Emerging (出地中, ${stateTick}/${EMERGE_DURATION})`,
    [WormState.Attacking]: `Attacking (吞食中, ${attackCountdown}/${RETURN_DELAY})`,
    [WormState.Submerging]: `Submerging (下潜中, ${stateTick}/${SUBMERGE_DURATION})`,
    [WormState.Wandering]: 'Wandering (随机移动)',
    [WormState.MovingToNoise]: 'MovingToNoise (追踪噪声)',
  }

  document.getElementById('st-state')!.textContent = stateLabels[wormState] ?? wormState
  document.getElementById('st-pos')!.textContent =
    `${Math.round(wormPosition.x * WORLD_SCALE)}, ${Math.round(wormPosition.z * WORLD_SCALE)}, ${Math.round(wormPosition.y * WORLD_SCALE)}`
  document.getElementById('st-facing')!.textContent = `${wormFacing}`
  document.getElementById('st-depth')!.textContent = `${Math.round(wormPosition.y * WORLD_SCALE)}`
  document.getElementById('st-target')!.textContent = targetPosition
    ? `${Math.round(targetPosition.x * WORLD_SCALE)}, ${Math.round(targetPosition.z * WORLD_SCALE)}`
    : '-'
  document.getElementById('st-countdown')!.textContent = attackCountdown > 0 ? `${attackCountdown}` : '-'
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

  document.getElementById('btn-scan')!.addEventListener('click', () => triggerScan())
  document.getElementById('btn-emerge')!.addEventListener('click', () => startEmerging())
  document.getElementById('btn-attack')!.addEventListener('click', () => startAttack())
  document.getElementById('btn-submerge')!.addEventListener('click', () => startSubmerging())
  document.getElementById('btn-disappear')!.addEventListener('click', () => triggerDisappear())

  const rngRadius = document.getElementById('rng-radius') as HTMLInputElement
  const lblRadius = document.getElementById('lbl-radius')!
  rngRadius.addEventListener('input', () => {
    wanderMoveRadius = parseInt(rngRadius.value, 10)
    lblRadius.textContent = String(wanderMoveRadius)
    updateSearchRing()
  })

  const rngDisappear = document.getElementById('rng-disappear') as HTMLInputElement
  const lblDisappear = document.getElementById('lbl-disappear')!
  rngDisappear.addEventListener('input', () => {
    chanceToDisappear = parseInt(rngDisappear.value, 10)
    lblDisappear.textContent = String(chanceToDisappear)
  })

  document.getElementById('btn-noise')!.addEventListener('click', () => {
    const angle = Math.random() * Math.PI * 2
    const dist = 3 + Math.random() * 10
    const x = Math.cos(angle) * dist
    const z = Math.sin(angle) * dist
    createNoiseSource(new Vector3(x, 0, z))
  })

  document.getElementById('btn-clear-noise')!.addEventListener('click', () => clearNoiseSources())
  document.getElementById('btn-reset')!.addEventListener('click', () => resetAll())

  // Click on ground to set target
  let isSettingTarget = false
  canvas.addEventListener('pointerdown', (e) => {
    if (!isSettingTarget) return
    const rect = canvas.getBoundingClientRect()
    const pickResult = scene.pick(
      e.clientX - rect.left,
      e.clientY - rect.top,
      (mesh) => mesh?.name === 'ground' || mesh?.name === 'grid',
    )
    if (pickResult?.hit && pickResult.pickedPoint) {
      const point = pickResult.pickedPoint.clone()
      point.y = 0
      targetPosition = point
      createTargetMarker(point)
      isSettingTarget = false
      canvas.style.cursor = ''
    }
  })

  // Allow right-click to set target
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const pickResult = scene.pick(
      e.clientX - rect.left,
      e.clientY - rect.top,
      (mesh) => mesh?.name === 'ground' || mesh?.name === 'grid',
    )
    if (pickResult?.hit && pickResult.pickedPoint) {
      const point = pickResult.pickedPoint.clone()
      point.y = 0
      targetPosition = point
      createTargetMarker(point)
    }
  })

  // Add a hint for right-click target setting
  const hint = document.querySelector('.hint')!
  hint.textContent += ' | 右键点击地面直接设置目标'
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0

engine.runRenderLoop(() => {
  const deltaTime = engine.getDeltaTime()
  tickAccumulator += deltaTime

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE
    wormTick()
  }

  // Pulse noise source rings
  for (let i = 0; i < noiseMarkers.length; i++) {
    const marker = noiseMarkers[i]!
    const pulseChildren = marker.getChildMeshes()
    for (const child of pulseChildren) {
      if (child.name.includes('noiseRing')) {
        const pulse = 1 + 0.3 * Math.sin(Date.now() * 0.005 + i)
        child.scaling.x = pulse
        child.scaling.z = pulse
      }
    }
  }

  updateUI()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for dev tools
;(window as unknown as Record<string, unknown>).__wormTest = {
  wormState,
  wormPosition,
  wormFacing,
  triggerScan,
  startEmerging,
  startAttack,
  startSubmerging,
  triggerDisappear,
  resetAll,
}
