/**
 * missile-trajectory/main.ts -- Missile projectile visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/Missile.cs
 *
 * Verifies 3 flight modes visually:
 *   M1. Straight flight (no homing, zero gravity) — line trajectory
 *   M2. Homing (tracking moving target, turn rate limited) — curved pursuit
 *   M3. Arcing (ballistic parabola, gravity=10, high launch angle) — arc trajectory
 *
 * 坐标系约定 (from WPos/WVec/WAngle, matching OpenRA conventions):
 *   - WAngle 0 = North (WPos -Y direction), counter-clockwise increment
 *   - WPos: X = east-west, Y = north-south, Z = height
 *   - Babylon mapping: Vector3(x = WPos.X/1024, y = WPos.Z/512, z = WPos.Y/1024)
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  LinesMesh,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../../OpenRA.Game/WVec.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { WRot } from '../../../../OpenRA.Game/WRot.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { MersenneTwisterStub } from '../../../../OpenRA.Game/World.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

import {
  Missile,
  MissileFactory,
  type MissileInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/Missile.js'
import type {
  ProjectileArgs,
  WeaponStub,
  WarheadArgsStub,
} from '../../../../OpenRA.Mods.Common/Projectiles/Bullet.js'

// ---------------------------------------------------------------------------
// Coordinate conversion constants
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

/**
 * Convert OpenRA WPos (integer su) to Babylon Vector3 (world units).
 * Mapping: WPos.X → Vector3.x (east), WPos.Y → Vector3.z (south), WPos.Z → Vector3.y (height)
 */
function wPosToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

/**
 * Convert Babylon Vector3 back to OpenRA WPos (inverse of wPosToVector3).
 */
function vector3ToWPos(v: Vector3): WPos {
  return new WPos(Math.round(v.x / WORLD_SCALE), Math.round(v.z / WORLD_SCALE), Math.round(v.y / HEIGHT_SCALE))
}

// ---------------------------------------------------------------------------
// Stubs — minimal objects to satisfy projectile constructor signatures
// Pattern follows projectile-lifecycle/main.ts
// ---------------------------------------------------------------------------

/** Create a minimal IGameActor stub for ProjectileArgs.sourceActor. */
function createStubActor(): IGameActor {
  const owner: PlayerStub = { playerName: 'TestPlayer' }
  const raw = {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    generation: 0,
    disposed: false,
    owner,
    world: null as unknown as GameWorldManager,
    centerPosition: WPos.Zero,
    isTargetableBy(_targeter: unknown): boolean { return true },
    tick(_world: GameWorldManager): void {},
    dispose(): void {},
    get traits(): never { throw new Error('not implemented') },
    trait<T>(): T { throw new Error('not implemented') },
    traitsImplementing<T>(): T[] { return [] },
    getTargetablePositions(): readonly WPos[] { return [WPos.Zero] },
  }
  return raw as unknown as IGameActor
}

/** Create a simple PRNG stub matching MersenneTwisterStub interface. */
function createStubRandom(seed: number = 42): MersenneTwisterStub {
  let s = seed
  return {
    next(): number {
      s = (s * 1664525 + 1013904223) & 0x7fffffff
      return s
    },
    get last(): number { return s },
  }
}

/** Create a minimal GameWorldManager stub with frame-end task queue. */
function createStubWorld(): {
  world: GameWorldManager
  events: string[]
  flushFrameEnd: () => void
} {
  const events: string[] = []
  const frameEndActions: (() => void)[] = []
  let effects: unknown[] = []
  const stubActor = createStubActor()
  const testOwner: PlayerStub = { playerName: 'TestPlayer' }

  const world = {
    addFrameEndTask(action: () => void): void {
      frameEndActions.push(action)
    },
    removeEffect(effect: unknown): void {
      effects = effects.filter(e => e !== effect)
      events.push(`removeEffect:${(effect as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown'}`)
    },
    add(effect: unknown): void {
      effects.push(effect)
    },
    get worldActor(): IGameActor { return stubActor },
    get localPlayer(): PlayerStub { return testOwner },
    tick(): void {},
    get sharedRandom(): MersenneTwisterStub { return createStubRandom() },
    get frameNumber(): number { return 0 },
    get paused(): boolean { return false },
  } as unknown as GameWorldManager

  return { world, events, flushFrameEnd() {
    const actions = [...frameEndActions]
    frameEndActions.length = 0
    for (const action of actions) action()
  }}
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.06, 0.08, 0.12, 1)

const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2,
  Math.PI / 3.5,
  25,
  new Vector3(5, 0, 5),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 60
camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.85

// Ground plane
const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene)
ground.position.y = -0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.10, 0.13, 0.18)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.8
ground.material = gmat

// Grid lines
for (let i = -5; i <= 15; i++) {
  const line = MeshBuilder.CreateLines('gridX', {
    points: [new Vector3(i, 0.005, -5), new Vector3(i, 0.005, 15)],
  }, scene)
  line.color = new Color3(0.15, 0.25, 0.4)
  line.alpha = i % 5 === 0 ? 0.35 : 0.08
}
for (let j = -5; j <= 15; j++) {
  const line = MeshBuilder.CreateLines('gridZ', {
    points: [new Vector3(-5, 0.005, j), new Vector3(15, 0.005, j)],
  }, scene)
  line.color = new Color3(0.15, 0.25, 0.4)
  line.alpha = j % 5 === 0 ? 0.35 : 0.08
}

// ---------------------------------------------------------------------------
// Shared Materials (pre-created to avoid per-frame allocation — MAJOR 1,3)
// ---------------------------------------------------------------------------

/** Number of gradient steps in the pre-created trail material pool. */
const TRAIL_GRADIENT_STEPS = 10

/**
 * Pre-created gradient materials for trail dots.
 *
 * Color gradient (MAJOR 6 fix — piecewise for accurate cyan→white→red):
 *   Phase 1 (t ≤ 0.5): cyan(0,1,1) → white(1,1,1) — R rises, G/B stay
 *   Phase 2 (t > 0.5): white(1,1,1) → red(1,0,0) — G/B drop, R stays
 */
const trailMaterials: StandardMaterial[] = []
for (let i = 0; i < TRAIL_GRADIENT_STEPS; i++) {
  const t = i / (TRAIL_GRADIENT_STEPS - 1)
  let r: number, g: number, b: number
  if (t <= 0.5) {
    const s = t / 0.5  // 0→1 in first half
    r = s; g = 1; b = 1
  } else {
    const s = (t - 0.5) / 0.5  // 0→1 in second half
    r = 1; g = 1 - s; b = 1 - s
  }
  const mat = new StandardMaterial(`trail${i}`, scene)
  mat.diffuseColor = new Color3(r, g, b)
  mat.emissiveColor = new Color3(r * 0.5, g * 0.3, b * 0.2)
  mat.specularColor = new Color3(0, 0, 0)
  trailMaterials.push(mat)
}

/** Shared marker materials — reused across fire cycles. */
const sourceMarkerMat = new StandardMaterial('srcMat', scene)
sourceMarkerMat.diffuseColor = new Color3(0.2, 1, 0.2)
sourceMarkerMat.emissiveColor = new Color3(0.1, 0.5, 0.1)
sourceMarkerMat.specularColor = new Color3(0, 0, 0)

const targetMarkerMat = new StandardMaterial('tgtMat', scene)
targetMarkerMat.diffuseColor = new Color3(1, 0.2, 0.2)
targetMarkerMat.emissiveColor = new Color3(0.4, 0.1, 0.1)
targetMarkerMat.specularColor = new Color3(0, 0, 0)

// ---------------------------------------------------------------------------
// Scene Markers & Trail System
// ---------------------------------------------------------------------------

const trailDots: Mesh[] = []
let trailLine: LinesMesh | null = null
const trailPositions: Vector3[] = []

/** Explicit references to source/target markers (MINOR 7 — avoids fragile index checks). */
let sourceMarkerRef: Mesh | null = null
let targetMarkerRef: Mesh | null = null

/**
 * Create a scene marker sphere at the given position.
 * Uses shared materials: green for source, red for target.
 */
function createMarker(role: 'source' | 'target', pos: Vector3): Mesh {
  const diameter = role === 'source' ? 0.4 : 0.3
  const sphere = MeshBuilder.CreateSphere(`marker_${role}`, { diameter }, scene)
  sphere.position = pos
  sphere.material = role === 'source' ? sourceMarkerMat : targetMarkerMat
  if (role === 'source') sourceMarkerRef = sphere
  else targetMarkerRef = sphere
  return sphere
}

/** Dispose and clear all scene markers. */
function clearMarkers(): void {
  if (sourceMarkerRef) { sourceMarkerRef.dispose(); sourceMarkerRef = null }
  if (targetMarkerRef) { targetMarkerRef.dispose(); targetMarkerRef = null }
}

/** Dispose and clear all trail dots and line. */
function clearTrail(): void {
  for (const d of trailDots) { d.dispose() }
  trailDots.length = 0
  if (trailLine) { trailLine.dispose(); trailLine = null }
  trailPositions.length = 0
}

/**
 * Add a trail dot at the given WPos.
 * Uses pre-created gradient materials (MAJOR 1 fix — no per-dot allocation).
 * Color: cyan(0,1,1) → white(1,1,1) → red(1,0,0) (MAJOR 6 fix — piecewise).
 */
function addTrailDot(pos: WPos, t: number): void {
  const v = wPosToVector3(pos.X, pos.Y, pos.Z)
  const dot = MeshBuilder.CreateSphere('trail', { diameter: 0.10 }, scene)
  dot.position = v
  const idx = Math.min(TRAIL_GRADIENT_STEPS - 1, Math.floor(t * TRAIL_GRADIENT_STEPS))
  dot.material = trailMaterials[idx]!
  trailDots.push(dot)
  trailPositions.push(v)
}

/**
 * Rebuild the trail LinesMesh from accumulated positions.
 * Called every N dots (not every dot) to reduce mesh churn (MAJOR 2 fix).
 */
function updateTrailLine(): void {
  if (trailLine) { trailLine.dispose(); trailLine = null }
  if (trailPositions.length < 2) return
  trailLine = MeshBuilder.CreateLines('trailLine', { points: trailPositions }, scene)
  trailLine.color = new Color3(0.8, 0.8, 1.0)
  trailLine.alpha = 0.6
}

// ---------------------------------------------------------------------------
// Moving Target Actor (for homing mode)
// ---------------------------------------------------------------------------

const targetMesh = MeshBuilder.CreateBox('targetBox', { width: 0.4, height: 0.4, depth: 0.4 }, scene)
targetMesh.position = new Vector3(8, 0.2, 5)
const tmat = new StandardMaterial('tmat2', scene)
tmat.diffuseColor = new Color3(1, 0.2, 0.2)
tmat.emissiveColor = new Color3(0.5, 0.1, 0.1)
tmat.specularColor = new Color3(0, 0, 0)
targetMesh.material = tmat
targetMesh.visibility = 1

// Target oscillation state
let targetSpeed = 0.8
let targetTime = 0
const TARGET_CENTER_X = 10
const TARGET_CENTER_Z = 5
const TARGET_AMPLITUDE_X = 2
const TARGET_AMPLITUDE_Z = 1.5

/** Update the moving target position for oscilating homing tests. */
function updateTargetPosition(deltaTime: number): void {
  targetTime += deltaTime * targetSpeed
  const x = TARGET_CENTER_X + Math.sin(targetTime * 0.7) * TARGET_AMPLITUDE_X
  const z = TARGET_CENTER_Z + Math.cos(targetTime * 0.5) * TARGET_AMPLITUDE_Z
  targetMesh.position.x = x
  targetMesh.position.z = z
  targetMesh.position.y = 0.2
}

/** Get current target position as WPos. */
function getTargetWPos(): WPos {
  return vector3ToWPos(targetMesh.position)
}

// ---------------------------------------------------------------------------
// Missile & ProjectileArgs Builder
// ---------------------------------------------------------------------------

const stubActor = createStubActor()
const stubRandom = createStubRandom(12345)

interface TestWeapon extends WeaponStub {
  impactCount: number
  lastImpactPos: WPos | null
}

/** Build ProjectileArgs with test weapon for tracking impacts. */
function makeArgs(source: WPos, passiveTarget: WPos, facing: WAngle = WAngle.Zero): ProjectileArgs & { weapon: TestWeapon } {
  const weapon: TestWeapon = {
    impactCount: 0,
    lastImpactPos: null,
    impact(_target: Target, warheadArgs: WarheadArgsStub): void {
      this.impactCount++
      this.lastImpactPos = warheadArgs.impactPosition
    },
  }
  return {
    sourceActor: stubActor as unknown as IGameActor,
    source,
    passiveTarget,
    guidedTarget: Target.fromPos(passiveTarget),
    weapon,
    facing,
    inaccuracySource: WDist.Zero,
    random: stubRandom,
    rangeModifiers: [],
  }
}

// ---------------------------------------------------------------------------
// Active Missile State
// ---------------------------------------------------------------------------

let activeMissile: Missile | null = null
let activeMode: 'straight' | 'homing' | 'arcing' | null = null
let activeWorld: GameWorldManager | null = null
let activeFlushFrameEnd: (() => void) | null = null
let activeArgs: (ProjectileArgs & { weapon: TestWeapon }) | null = null
let ticksSinceFire = 0
let simulationRunning = false
let missileDisposed = false

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

interface LogEntry {
  tick: number
  mode: string
  text: string
}

const logEntries: LogEntry[] = []
function addLog(tick: number, mode: string, text: string): void {
  logEntries.push({ tick, mode, text })
  renderLog()
}

function renderLog(): void {
  const el = document.getElementById('event-log')!
  const recent = logEntries.slice(-40)
  el.innerHTML = recent.length === 0
    ? '<div class="log-row log-info">Ready. Press a fire button to launch missile.</div>'
    : recent.map(e =>
      `<div class="log-row">
        <span class="log-tick">T${e.tick.toString().padStart(3, '0')}</span>
        <span>[${e.mode}]</span> ${e.text}
      </div>`
    ).join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Diagnostics Update
// ---------------------------------------------------------------------------

function updateDiagnostics(): void {
  const modeStr = activeMode ?? '-'
  document.getElementById('diag-mode')!.textContent = modeStr

  if (!activeMissile) {
    document.getElementById('diag-state')!.textContent = '-'
    document.getElementById('diag-pos')!.textContent = '-'
    document.getElementById('diag-angle')!.textContent = '-'
    document.getElementById('diag-dist')!.textContent = '-'
    document.getElementById('diag-trail')!.textContent = '-'
    document.getElementById('diag-ticks')!.textContent = '-'
    document.getElementById('diag-destroyed')!.textContent = '-'
    return
  }

  const m = activeMissile
  const stateNames: Record<number, string> = { 0: 'Freefall', 1: 'Homing', 2: 'Hitting' }
  document.getElementById('diag-state')!.textContent = stateNames[m.state] ?? String(m.state)
  document.getElementById('diag-pos')!.textContent =
    `(${m.pos.X.toFixed(0)}, ${m.pos.Y.toFixed(0)}, ${m.pos.Z.toFixed(0)})`
  document.getElementById('diag-angle')!.textContent =
    `h=${m.hFacing} (${(m.hFacing * 360 / 256).toFixed(1)}°) / v=${m.vFacing}`
  document.getElementById('diag-dist')!.textContent = `${m.distanceCovered.length} su`
  document.getElementById('diag-trail')!.textContent = `${trailDots.length} dots`
  document.getElementById('diag-ticks')!.textContent = `${m.ticks}`
  document.getElementById('diag-destroyed')!.textContent = m.isDestroyed ? 'YES' : 'no'
}

// ---------------------------------------------------------------------------
// Fire Functions
// ---------------------------------------------------------------------------

/** Clean up all state from the previous fire cycle. */
function cleanupActiveMissile(): void {
  clearTrail()
  clearMarkers()
  activeMissile = null
  activeWorld = null
  activeFlushFrameEnd = null
  activeArgs = null
  ticksSinceFire = 0
  simulationRunning = false
  missileDisposed = false
  frameCounter = 0  // MINOR 8: reset frame counter on cleanup
}

/** Core fire function — creates missile and starts simulation. */
function fireMissile(
  mode: 'straight' | 'homing' | 'arcing',
  source: WPos,
  target: WPos,
  configOverrides: Partial<MissileInfo>,
): void {
  cleanupActiveMissile()
  logEntries.length = 0
  activeMode = mode

  const { world, flushFrameEnd } = createStubWorld()
  activeWorld = world
  activeFlushFrameEnd = flushFrameEnd

  const facing = WAngle.fromFacing(64) // 64 = east (90 degrees)
  const args = makeArgs(source, target, facing)
  activeArgs = args

  // Source marker (green) — uses shared material
  createMarker('source', wPosToVector3(source.X, source.Y, source.Z))

  // Target marker (red) — uses shared material
  createMarker('target', wPosToVector3(target.X, target.Y, target.Z))

  const missile = MissileFactory.create(args, configOverrides)
  activeMissile = missile

  addLog(0, mode, `Fired from (${source.X}, ${source.Y}, ${source.Z}) to (${target.X}, ${target.Y}, ${target.Z})`)
  const stateNames: Record<number, string> = { 0: 'Freefall', 1: 'Homing', 2: 'Hitting' }
  addLog(0, mode, `Initial state: ${stateNames[missile.state]} | hFacing=${missile.hFacing} | speed=${missile.speed}`)

  if (mode === 'homing') {
    addLog(0, mode, `Homing enabled — activation delay: ${configOverrides.homingActivationDelay ?? 0} ticks`)
  }

  simulationRunning = true
  addTrailDot(missile.pos, 0)
  updateDiagnostics()
}

function fireStraight(): void {
  const source = new WPos(1024, 5120, 0)    // (1, 5, 0)
  const target = new WPos(9216, 5120, 0)     // (9, 5, 0) — 8 cells east
  fireMissile('straight', source, target, {
    homingActivationDelay: 999,  // Never enter homing
    gravity: 0,
    speed: new WDist(300),
    acceleration: new WDist(0),
    contrailLength: 30,
    contrailDelay: 1,
    contrailStartWidth: new WDist(48),
    contrailStartColor: [100, 200, 255, 200],
    contrailStartColorAlpha: 200,
    contrailEndColor: [50, 100, 200, 60],
    contrailEndColorAlpha: 60,
    rangeLimit: new WDist(12288),
    explodeWhenEmpty: true,
    closeEnough: new WDist(256),
    blockable: false,
  })
}

function fireHoming(): void {
  const source = new WPos(1024, 2048, 512)   // (1, 2, 512 height)
  const target = vector3ToWPos(targetMesh.position)
  fireMissile('homing', source, target, {
    homingActivationDelay: 5,
    gravity: 0,
    speed: new WDist(340),
    acceleration: new WDist(3),
    horizontalRateOfTurn: new WAngle(25),
    verticalRateOfTurn: new WAngle(20),
    contrailLength: 25,
    contrailDelay: 1,
    contrailStartWidth: new WDist(44),
    contrailStartColor: [255, 200, 80, 220],
    contrailStartColorAlpha: 220,
    contrailEndColor: [200, 100, 40, 50],
    contrailEndColorAlpha: 50,
    rangeLimit: new WDist(20480),
    explodeWhenEmpty: true,
    closeEnough: new WDist(350),
    blockable: false,
    lockOnProbability: 100,
  })
}

function fireArcing(): void {
  const source = new WPos(1024, 3072, 0)     // (1, 3, 0)
  const target = new WPos(8192, 3072, 0)      // (8, 3, 0) — 7 cells east
  fireMissile('arcing', source, target, {
    homingActivationDelay: 999,  // Never enter homing — pure ballistic
    gravity: 10,
    speed: new WDist(250),
    acceleration: new WDist(0),
    minimumLaunchAngle: new WAngle(0),
    maximumLaunchAngle: new WAngle(192),  // Allow high-angle launch
    contrailLength: 35,
    contrailDelay: 1,
    contrailStartWidth: new WDist(50),
    contrailStartColor: [255, 100, 100, 200],
    contrailStartColorAlpha: 200,
    contrailEndColor: [200, 60, 60, 40],
    contrailEndColorAlpha: 40,
    rangeLimit: new WDist(12288),
    explodeWhenEmpty: true,
    closeEnough: new WDist(300),
    blockable: false,
  })

  // For arcing mode, override vFacing to get a deliberate high-angle lob.
  // The constructor's _determineLaunchSpeedAndAngle() computes a near-horizontal
  // vFacing for same-height targets, so we override it here for the ballistic arc test.
  if (activeMissile) {
    activeMissile.vFacing = 64 // Facing 64 = 90 deg upward
    activeMissile.speed = 250
    const preRotV = new WRot(WAngle.fromFacing(64), WAngle.Zero, WAngle.Zero)
    const preRotH = new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(activeMissile.hFacing))
    activeMissile.velocity = new WVec(0, -250, 0)
      .rotate(preRotV)
      .rotate(preRotH)
  }
}

// ---------------------------------------------------------------------------
// Simulation Tick — called from render loop
// ---------------------------------------------------------------------------

const SIM_TICK_INTERVAL = 3 // Run 1 logic tick every N render frames
let frameCounter = 0

function simulateTick(): void {
  if (!simulationRunning || !activeMissile || !activeWorld || !activeFlushFrameEnd) return
  if (activeMissile.isDestroyed) {
    if (!missileDisposed) {
      missileDisposed = true
      simulationRunning = false
      addLog(ticksSinceFire, activeMode ?? '?', `MISSILE DESTROYED — impacts=${activeArgs?.weapon.impactCount ?? 0}`)
      // Final trail line rebuild
      updateTrailLine()
      updateDiagnostics()
    }
    return
  }

  // For homing mode: update missile's target to follow the moving target mesh
  if (activeMode === 'homing') {
    const twp = getTargetWPos()
    activeMissile.targetPosition = twp
    // Update visual target marker position using explicit reference (MINOR 7 fix)
    if (targetMarkerRef) {
      targetMarkerRef.position = wPosToVector3(twp.X, twp.Y, twp.Z)
    }
  }

  // Record state before tick
  const prevState = activeMissile.state

  // Advance one game tick
  activeMissile.tick(activeWorld)
  activeFlushFrameEnd()
  ticksSinceFire++

  // Log state changes
  const stateNames: Record<number, string> = { 0: 'Freefall', 1: 'Homing', 2: 'Hitting' }
  if (activeMissile.state !== prevState) {
    addLog(ticksSinceFire, activeMode ?? '?',
      `State: ${stateNames[prevState]} → ${stateNames[activeMissile.state]}`
    )
  }

  // Add trail dot every few ticks
  const trailInterval = activeMode === 'straight' ? 3 : activeMode === 'arcing' ? 2 : 3
  if (ticksSinceFire % trailInterval === 0 && !activeMissile.isDestroyed) {
    const progress = Math.min(1, ticksSinceFire / 120)
    addTrailDot(activeMissile.pos, progress)
    // MAJOR 2 fix: rebuild trail line every 5 dots instead of every dot
    if (trailDots.length % 5 === 0) {
      updateTrailLine()
    }
  }

  // Log every 15 ticks
  if (ticksSinceFire % 15 === 0) {
    addLog(ticksSinceFire, activeMode ?? '?',
      `pos=(${activeMissile.pos.X.toFixed(0)},${activeMissile.pos.Y.toFixed(0)},${activeMissile.pos.Z.toFixed(0)}) ` +
      `hFac=${activeMissile.hFacing} dist=${activeMissile.distanceCovered.length}`
    )
  }

  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetScene(): void {
  cleanupActiveMissile()
  logEntries.length = 0
  activeMode = null
  renderLog()
  updateDiagnostics()
  // Reset target position
  targetMesh.position.set(TARGET_CENTER_X, 0.2, TARGET_CENTER_Z)
  targetTime = 0
  frameCounter = 0  // MINOR 8: reset on manual reset too
  // Reset button styles
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active-mode'))
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  // Update moving target
  updateTargetPosition(engine.getDeltaTime() / 1000)

  // Run simulation tick every N frames
  frameCounter++
  if (frameCounter >= SIM_TICK_INTERVAL && simulationRunning) {
    frameCounter = 0
    simulateTick()
  }

  scene.render()
  updateInfoBar()
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

/** Throttle timestamp to update at most once per second (MINOR 9 fix). */
let lastInfoTimeUpdate = 0
let cachedInfoTime = ''

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))

  const now = Date.now()
  if (now - lastInfoTimeUpdate > 1000) {
    cachedInfoTime = new Date().toISOString()
    lastInfoTimeUpdate = now
  }
  document.getElementById('info-time')!.textContent = cachedInfoTime
}

/** Stored resize handler reference for potential cleanup (MINOR 10 fix). */
const resizeHandler = () => { engine.resize() }
window.addEventListener('resize', resizeHandler)

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

function setActiveButton(mode: string): void {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active-mode'))
  const btn = document.querySelector(`.mode-btn[data-mode="${mode}"]`)
  if (btn) btn.classList.add('active-mode')
}

document.getElementById('btn-straight')!.addEventListener('click', () => {
  setActiveButton('straight')
  fireStraight()
})

document.getElementById('btn-homing')!.addEventListener('click', () => {
  setActiveButton('homing')
  fireHoming()
})

document.getElementById('btn-arcing')!.addEventListener('click', () => {
  setActiveButton('arcing')
  fireArcing()
})

document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetScene()
})

const targetSpeedSlider = document.getElementById('target-speed') as HTMLInputElement
const targetSpeedVal = document.getElementById('target-speed-val')!
targetSpeedSlider.addEventListener('input', () => {
  targetSpeed = parseFloat(targetSpeedSlider.value)
  targetSpeedVal.textContent = targetSpeed.toFixed(1)
})

// ---------------------------------------------------------------------------
// Test Harness — exposed on window for Playwright programmatic verification
// (MINOR 12: comment explains why we cast to any — test harness is an
//  intentional global for Playwright script access, not production code.)
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene,
  engine,

  /** Fire straight-flight missile at target position (Babylon world coords). */
  fireStraight(targetPos: { x: number; y: number; z: number }): void {
    const wp = new WPos(
      Math.round(targetPos.x / WORLD_SCALE),
      Math.round(targetPos.z / WORLD_SCALE),
      Math.round(targetPos.y / HEIGHT_SCALE),
    )
    setActiveButton('straight')
    const source = new WPos(1024, 5120, 0)
    fireMissile('straight', source, wp, {
      homingActivationDelay: 999,
      gravity: 0,
      speed: new WDist(300),
      rangeLimit: new WDist(12288),
      explodeWhenEmpty: true,
      closeEnough: new WDist(256),
      blockable: false,
    })
  },

  /** Fire homing missile targeting the moving actor. */
  fireHoming(_targetActor: { getId: () => string }): void {
    setActiveButton('homing')
    fireHoming()
  },

  /** Fire arcing missile at target position. */
  fireArcing(targetPos: { x: number; y: number; z: number }): void {
    const wp = new WPos(
      Math.round(targetPos.x / WORLD_SCALE),
      Math.round(targetPos.z / WORLD_SCALE),
      Math.round(targetPos.y / HEIGHT_SCALE),
    )
    setActiveButton('arcing')
    const source = new WPos(1024, 3072, 0)
    fireMissile('arcing', source, wp, {
      homingActivationDelay: 999,
      gravity: 10,
      speed: new WDist(250),
      rangeLimit: new WDist(12288),
      explodeWhenEmpty: true,
      closeEnough: new WDist(300),
      blockable: false,
    })
  },

  /** Get current missile position in Babylon world coordinates. */
  getMissilePosition(): { x: number; y: number; z: number } | null {
    if (!activeMissile) return null
    return {
      x: activeMissile.pos.X * WORLD_SCALE,
      y: activeMissile.pos.Z * HEIGHT_SCALE,
      z: activeMissile.pos.Y * WORLD_SCALE,
    }
  },

  /** Get current missile facing angles in radians. */
  getMissileAngle(): { yaw: number; pitch: number } | null {
    if (!activeMissile) return null
    const yawRad = (activeMissile.hFacing * Math.PI * 2) / 256
    const pitchRad = (activeMissile.vFacing * Math.PI * 2) / 256
    return { yaw: yawRad, pitch: pitchRad }
  },

  /** Get number of trail dots rendered. */
  getTrailLength(): number {
    return trailDots.length
  },

  /** Get the active missile instance (for direct state inspection). */
  getActiveMissile(): Missile | null {
    return activeMissile
  },

  /** Get missile state as string. */
  getMissileState(): string {
    if (!activeMissile) return 'none'
    const stateNames: Record<number, string> = { 0: 'Freefall', 1: 'Homing', 2: 'Hitting' }
    return activeMissile.isDestroyed ? 'Destroyed' : stateNames[activeMissile.state] ?? String(activeMissile.state)
  },

  /** Get event log entries. */
  getEventLog(): LogEntry[] {
    return [...logEntries]
  },

  /** Reset the test scene. */
  reset: resetScene,
}
