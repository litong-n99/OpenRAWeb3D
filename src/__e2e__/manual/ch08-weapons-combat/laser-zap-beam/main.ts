/**
 * laser-zap-beam/main.ts -- LaserZap projectile visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/LaserZap.cs
 *
 * Verifies:
 *   L1. Instant beam appearance (within 1 frame of fire)
 *   L2. Beam color matches player color (≤ 5% RGB tolerance)
 *   L3. Beam visible for exactly `duration` ticks (±1 tick)
 *   L4. Beam width at 10 wu distance matches configured WDist (≤ 3px)
 *   L5. Tracking mode: beam endpoint follows moving target each tick
 *
 * 坐标系约定: WAngle 0=North (WPos -Y), CCW. Babylon: x=WX/1024, y=WZ/512, z=WY/1024
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
  Quaternion,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { MersenneTwisterStub } from '../../../../OpenRA.Game/World.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

import { BeamRenderableShape } from '../../../../OpenRA.Mods.Common/Projectiles/BeamRenderableShape.js'
import {
  LaserZap,
  LaserZapFactory,
  type LaserZapInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/LaserZap.js'
import type {
  ProjectileArgs,
  WeaponStub,
  WarheadArgsStub,
} from '../../../../OpenRA.Mods.Common/Projectiles/Bullet.js'

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

function wPosToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

function vector3ToWPos(v: Vector3): WPos {
  return new WPos(Math.round(v.x / WORLD_SCALE), Math.round(v.z / WORLD_SCALE), Math.round(v.y / HEIGHT_SCALE))
}

/**
 * Estimate screen pixel width of beam at a given world position.
 * For ArcRotateCamera (perspective): pixelWidth = (worldWidth / worldHeightAtDistance) * canvasHeight
 * where worldHeightAtDistance = 2 * tan(fov/2) * distance
 */
function estimatePixelWidth(worldWidth: number, worldPos: Vector3, cameraPos: Vector3): number {
  const dist = Vector3.Distance(worldPos, cameraPos)
  if (dist < 0.01) return 0
  const canvasHeight = engine.getRenderHeight()
  const fov = camera.fov // radians, native ArcRotateCamera field
  const worldHeightAtDistance = 2 * Math.tan(fov / 2) * dist
  if (worldHeightAtDistance < 0.0001) return 0
  const pxPerWu = canvasHeight / worldHeightAtDistance
  return worldWidth * pxPerWu
}

// ---------------------------------------------------------------------------
// Stubs (pattern from projectile-lifecycle)
// ---------------------------------------------------------------------------

function createStubActor(): IGameActor {
  const owner: PlayerStub = { playerName: 'TestPlayer' }
  const raw = {
    actorId: 1, isInWorld: true, isDead: false, generation: 0, disposed: false,
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

function createStubRandom(seed: number = 42): MersenneTwisterStub {
  let s = seed
  return {
    next(): number { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s },
    get last(): number { return s },
  }
}

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
    addFrameEndTask(action: () => void): void { frameEndActions.push(action) },
    removeEffect(effect: unknown): void {
      effects = effects.filter(e => e !== effect)
      events.push(`removeEffect:${(effect as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown'}`)
    },
    add(effect: unknown): void { effects.push(effect) },
    get worldActor(): IGameActor { return stubActor },
    get localPlayer(): PlayerStub { return testOwner },
    tick(): void {},
    get sharedRandom(): MersenneTwisterStub { return createStubRandom() },
    get frameNumber(): number { return 0 },
    get paused(): boolean { return false },
  } as unknown as GameWorldManager

  return { world, events, flushFrameEnd() {
    const actions = [...frameEndActions]; frameEndActions.length = 0
    for (const action of actions) action()
  }}
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.07, 0.11, 1)

const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2.2,
  Math.PI / 3,
  22,
  new Vector3(5, 0.5, 5),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 60
camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.85

// Ground
const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene)
ground.position.y = -0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.08, 0.11, 0.16)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.75
ground.material = gmat

// Grid
for (let i = -5; i <= 15; i++) {
  const l = MeshBuilder.CreateLines('gx', { points: [new Vector3(i, 0.005, -5), new Vector3(i, 0.005, 15)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = i % 5 === 0 ? 0.3 : 0.07
}
for (let j = -5; j <= 15; j++) {
  const l = MeshBuilder.CreateLines('gz', { points: [new Vector3(-5, 0.005, j), new Vector3(15, 0.005, j)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = j % 5 === 0 ? 0.3 : 0.07
}

// ---------------------------------------------------------------------------
// Beam Meshes (MAJOR 4+5: shared material, update-in-place instead of dispose+recreate)
// ---------------------------------------------------------------------------

let beamLine: LinesMesh | null = null
let beamCylinder: Mesh | null = null
let beamSecondLine: LinesMesh | null = null
let beamSecondCylinder: Mesh | null = null
let sourceMarker: Mesh | null = null
let targetMarker: Mesh | null = null

/** M5: Track previous beam endpoints to avoid redundant per-frame geometry rebuilds */
let currentBeamPoints: Vector3[] | null = null
let currentSecondBeamPoints: Vector3[] | null = null

/** Shared cylinder material — reused across all beam updates (MAJOR 4) */
let sharedCylinderMat: StandardMaterial | null = null
function getSharedCylinderMat(): StandardMaterial {
  if (!sharedCylinderMat) {
    sharedCylinderMat = new StandardMaterial('sharedCylMat', scene)
    sharedCylinderMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedCylinderMat
}

/** Shared secondary cylinder material */
let sharedSecondCylinderMat: StandardMaterial | null = null
function getSharedSecondCylinderMat(): StandardMaterial {
  if (!sharedSecondCylinderMat) {
    sharedSecondCylinderMat = new StandardMaterial('sharedSecCylMat', scene)
    sharedSecondCylinderMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedSecondCylinderMat
}

function hideAllBeamMeshes(): void {
  if (beamLine) beamLine.setEnabled(false)
  if (beamCylinder) beamCylinder.setEnabled(false)
  if (beamSecondLine) beamSecondLine.setEnabled(false)
  if (beamSecondCylinder) beamSecondCylinder.setEnabled(false)
}

function disposeBeamMeshes(): void {
  if (beamLine) { beamLine.dispose(); beamLine = null }
  if (beamCylinder) { beamCylinder.dispose(); beamCylinder = null }
  if (beamSecondLine) { beamSecondLine.dispose(); beamSecondLine = null }
  if (beamSecondCylinder) { beamSecondCylinder.dispose(); beamSecondCylinder = null }
  currentBeamPoints = null
  currentSecondBeamPoints = null
}

function disposeMarkers(): void {
  if (sourceMarker) { sourceMarker.dispose(); sourceMarker = null }
  if (targetMarker) { targetMarker.dispose(); targetMarker = null }
}

/**
 * Update beam visual meshes in-place (M5: updatable + instance pattern, no hot-path allocation).
 *
 * Beam line meshes: created with `updatable: true` on first call; subsequent calls use
 * `instance:` to reuse the LinesMesh, only rebuilding geometry when endpoints change.
 * Cylinder meshes: repositioned/rescaled/reoriented in-place (no recreation).
 * Materials: shared module-scope StandardMaterial instances (M4).
 */
function updateBeamVisual(
  from: Vector3,
  to: Vector3,
  widthWorld: number,
  color: Color3,
  alpha: number,
  secondColor?: Color3,
): void {
  if (alpha <= 0) {
    hideAllBeamMeshes()
    return
  }

  const alphaClamped = Math.min(1, alpha / 255)
  const color4 = new Color4(color.r, color.g, color.b, alphaClamped)

  // ---- Core beam line (M5: updatable + instance pattern, no per-frame dispose) ----
  const newPoints = [from.clone(), to.clone()]
  const pointsChanged = !currentBeamPoints
    || !currentBeamPoints[0]!.equals(newPoints[0]!)
    || !currentBeamPoints[1]!.equals(newPoints[1]!)

  if (!beamLine) {
    beamLine = MeshBuilder.CreateLines('beamCore', {
      points: newPoints,
      colors: [color4, color4],
      updatable: true,
    }, scene)
    beamLine.renderingGroupId = 1
    currentBeamPoints = newPoints.map(p => p.clone())
  } else if (pointsChanged) {
    beamLine = MeshBuilder.CreateLines('beamCore', {
      points: newPoints,
      colors: [color4, color4],
      instance: beamLine,
    }, scene)
    currentBeamPoints = newPoints.map(p => p.clone())
  }
  beamLine.setEnabled(true)
  beamLine.alpha = alphaClamped

  // ---- Width cylinder (update or create) ----
  const direction = to.subtract(from)
  const length = direction.length()
  const midpoint = from.add(to).scale(0.5)
  const dir = direction.normalize()

  if (length > 0.001 && widthWorld > 0.001) {
    const mat = getSharedCylinderMat()
    mat.diffuseColor = color
    mat.emissiveColor = color.scale(0.7)
    mat.alpha = alphaClamped * 0.3

    if (beamCylinder) {
      beamCylinder.setEnabled(true)
    } else {
      beamCylinder = MeshBuilder.CreateCylinder('beamBody', {
        height: 1,
        diameter: 1,
        tessellation: 10,
      }, scene)
      beamCylinder.material = mat
      beamCylinder.renderingGroupId = 0
    }

    // Scale unit cylinder to target dimensions (diameter=XZ, height=Y)
    beamCylinder.scaling.set(widthWorld, length, widthWorld)
    beamCylinder.position = midpoint
    const quat = new Quaternion()
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, quat)
    beamCylinder.rotationQuaternion = quat
  } else if (beamCylinder) {
    beamCylinder.setEnabled(false)
  }

  // ---- Secondary beam (update or create) ----
  if (secondColor) {
    const offset = dir.scale(widthWorld * 0.7)
    const perpX = new Vector3(1, 0, 0)
    const perp = Vector3.Cross(dir, perpX).normalize().scale(widthWorld * 0.8)
    const sFrom = from.add(perp).add(offset.scale(0.1))
    const sTo = to.add(perp).add(offset.scale(-0.1))
    const secAlpha = alphaClamped * 0.7
    const secColor4 = new Color4(secondColor.r, secondColor.g, secondColor.b, secAlpha)
    const sNewPoints = [sFrom.clone(), sTo.clone()]
    const sPointsChanged = !currentSecondBeamPoints
      || !currentSecondBeamPoints[0]!.equals(sNewPoints[0]!)
      || !currentSecondBeamPoints[1]!.equals(sNewPoints[1]!)

    if (!beamSecondLine) {
      beamSecondLine = MeshBuilder.CreateLines('beamSec', {
        points: sNewPoints,
        colors: [secColor4, secColor4],
        updatable: true,
      }, scene)
      beamSecondLine.renderingGroupId = 1
      currentSecondBeamPoints = sNewPoints.map(p => p.clone())
    } else if (sPointsChanged) {
      beamSecondLine = MeshBuilder.CreateLines('beamSec', {
        points: sNewPoints,
        colors: [secColor4, secColor4],
        instance: beamSecondLine,
      }, scene)
      currentSecondBeamPoints = sNewPoints.map(p => p.clone())
    }
    beamSecondLine.setEnabled(true)
    beamSecondLine.alpha = secAlpha

    // Secondary cylinder
    const secWidth = widthWorld * 0.6
    if (secWidth > 0.001) {
      const secMat = getSharedSecondCylinderMat()
      secMat.diffuseColor = secondColor
      secMat.emissiveColor = secondColor.scale(0.5)
      secMat.alpha = secAlpha * 0.25

      if (beamSecondCylinder) {
        beamSecondCylinder.setEnabled(true)
      } else {
        beamSecondCylinder = MeshBuilder.CreateCylinder('beamSecBody', {
          height: 1, diameter: 1, tessellation: 8,
        }, scene)
        beamSecondCylinder.material = secMat
        beamSecondCylinder.renderingGroupId = 0
      }
      beamSecondCylinder.scaling.set(secWidth, length * 0.95, secWidth)
      beamSecondCylinder.position = midpoint.add(perp.scale(0.5)).add(offset.scale(0.05))
      const secQuat = new Quaternion()
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, secQuat)
      beamSecondCylinder.rotationQuaternion = secQuat
    } else if (beamSecondCylinder) {
      beamSecondCylinder.setEnabled(false)
    }
  } else {
    if (beamSecondLine) beamSecondLine.setEnabled(false)
    if (beamSecondCylinder) beamSecondCylinder.setEnabled(false)
  }
}

// ---------------------------------------------------------------------------
// Target Actor (movable)
// ---------------------------------------------------------------------------

const targetMesh = MeshBuilder.CreateBox('target', { width: 0.4, height: 0.4, depth: 0.4 }, scene)
targetMesh.position = new Vector3(10, 0.2, 4)
const tmat = new StandardMaterial('tmat', scene)
tmat.diffuseColor = new Color3(1, 0.25, 0.25)
tmat.emissiveColor = new Color3(0.4, 0.1, 0.1)
tmat.specularColor = new Color3(0, 0, 0)
targetMesh.material = tmat

let targetTime = 0
let movingTarget = false
function updateTarget(dt: number): void {
  if (!movingTarget) {
    targetMesh.position.set(10, 0.2, 4)
    return
  }
  targetTime += dt * 1.2
  const x = 10 + Math.sin(targetTime * 0.8) * 2.5
  const z = 4 + Math.cos(targetTime * 0.6) * 1.8
  targetMesh.position.set(x, 0.2, z)
}

function getTargetWPos(): WPos { return vector3ToWPos(targetMesh.position) }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TestWeapon extends WeaponStub {
  impactCount: number
  lastImpactPos: WPos | null
}

let activeLaser: LaserZap | null = null
let activeWorld: GameWorldManager | null = null
let activeFlushFrameEnd: (() => void) | null = null
let activeArgs: (ProjectileArgs & { weapon: TestWeapon }) | null = null
let simRunning = false
let ticksElapsed = 0
let beamDisposed = false

const SOURCE_POS = new WPos(1536, 4096, 0)  // (1.5, 4, 0) in world

// Beam config (mutable via UI)
let beamColorStr = '255,0,0'
let trackingEnabled = true
let secondaryEnabled = false
let beamWidthWDist = 86
let beamDuration = 15

function parseColor(str: string): [number, number, number, number] {
  const parts = str.split(',').map(Number)
  return [parts[0] ?? 255, parts[1] ?? 0, parts[2] ?? 0, 255]
}

function rgbStr(color: readonly [number, number, number, number]): string {
  return `${color[0]},${color[1]},${color[2]}`
}

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

const stubActor = createStubActor()
const stubRandom = createStubRandom(12345)

function makeArgs(source: WPos, target: WPos): ProjectileArgs & { weapon: TestWeapon } {
  const weapon: TestWeapon = {
    impactCount: 0,
    lastImpactPos: null,
    impact(_t: Target, wa: WarheadArgsStub): void {
      this.impactCount++
      this.lastImpactPos = wa.impactPosition
    },
  }
  return {
    sourceActor: stubActor as unknown as IGameActor,
    source,
    passiveTarget: target,
    guidedTarget: Target.fromPos(target),
    weapon,
    facing: WAngle.fromFacing(64),
    inaccuracySource: WDist.Zero,
    random: stubRandom,
    rangeModifiers: [],
  }
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

interface LogEntry { tick: number; text: string }
const logEntries: LogEntry[] = []

function addLog(tick: number, text: string): void {
  logEntries.push({ tick, text })
  renderLog()
}

function renderLog(): void {
  const el = document.getElementById('event-log')!
  const recent = logEntries.slice(-35)
  el.innerHTML = recent.length === 0
    ? '<div class="log-row log-info">Ready. Configure beam settings and press Fire.</div>'
    : recent.map(e => `<div class="log-row"><span class="log-tick">T${e.tick.toString().padStart(3,'0')}</span>${e.text}</div>`).join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function updateDiagnostics(): void {
  const vis = beamLine !== null
  document.getElementById('diag-visible')!.textContent = vis ? 'YES' : 'no'
  document.getElementById('diag-alpha')!.textContent = activeLaser ? String(activeLaser.beamAlpha) : '-'
  document.getElementById('diag-remaining')!.textContent = activeLaser && !activeLaser.isDestroyed
    ? `${Math.max(0, beamDuration - ticksElapsed)} / ${beamDuration}` : '-'
  document.getElementById('diag-width')!.textContent = activeLaser
    ? `${activeLaser.info.width.length} su / ${beamWidthWDist} su` : '-'
  document.getElementById('diag-color')!.textContent = activeLaser ? rgbStr(activeLaser.color) : '-'
  document.getElementById('diag-tracking')!.textContent = trackingEnabled ? 'ON' : 'OFF'
  document.getElementById('diag-impacts')!.textContent = activeArgs ? String(activeArgs.weapon.impactCount) : '-'
  document.getElementById('diag-destroyed')!.textContent = activeLaser?.isDestroyed ? 'YES' : 'no'

  if (activeLaser) {
    document.getElementById('diag-endpoints')!.textContent =
      `(${activeLaser.source.X},${activeLaser.source.Y}) → (${activeLaser.target.X},${activeLaser.target.Y})`
  } else {
    document.getElementById('diag-endpoints')!.textContent = '-'
  }
}

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

function cleanupAll(): void {
  disposeBeamMeshes()
  disposeMarkers()
  activeLaser = null
  activeWorld = null
  activeFlushFrameEnd = null
  activeArgs = null
  simRunning = false
  ticksElapsed = 0
  beamDisposed = false
}

function fireLaser(): void {
  cleanupAll()
  logEntries.length = 0

  const { world, flushFrameEnd } = createStubWorld()
  activeWorld = world
  activeFlushFrameEnd = flushFrameEnd

  const targetWP = getTargetWPos()
  const args = makeArgs(SOURCE_POS, targetWP)
  activeArgs = args

  const color: [number, number, number, number] = parseColor(beamColorStr)

  const laser = LaserZapFactory.create(args, {
    duration: beamDuration,
    damageDuration: 3,
    damageInterval: 1,
    trackTarget: trackingEnabled,
    blockable: false,
    width: new WDist(beamWidthWDist),
    shape: BeamRenderableShape.Cylindrical,
    color,
    usePlayerColor: true,
    secondaryBeam: secondaryEnabled,
    secondaryBeamWidth: new WDist(Math.max(1, Math.round(beamWidthWDist * 0.6))),
    secondaryBeamShape: BeamRenderableShape.Cylindrical,
    secondaryBeamColor: [Math.min(255, color[0]! + 80), Math.min(255, color[1]! + 80), Math.min(255, color[2]! + 80), 200],
    zOffset: 0,
    secondaryBeamZOffset: 64,
    secondaryBeamUsePlayerColor: false,
    inaccuracy: WDist.Zero,
  } satisfies Partial<LaserZapInfo>)

  activeLaser = laser
  simRunning = true
  ticksElapsed = 0
  beamDisposed = false

  addLog(0, `FIRED | color=(${color[0]},${color[1]},${color[2]}) | width=${beamWidthWDist}su | duration=${beamDuration}t | tracking=${trackingEnabled}`)
  addLog(0, `beamAlpha=${laser.beamAlpha} | ticks=${laser.ticks}`)

  // Render initial beam visual
  renderBeamFromLaser()
  updateDiagnostics()
}

function renderBeamFromLaser(): void {
  if (!activeLaser) return

  const from = wPosToVector3(activeLaser.source.X, activeLaser.source.Y, activeLaser.source.Z)
  const to = wPosToVector3(activeLaser.target.X, activeLaser.target.Y, activeLaser.target.Z)
  const widthWorld = activeLaser.info.width.length * WORLD_SCALE
  const alpha = activeLaser.beamAlpha
  const color = new Color3(activeLaser.color[0]! / 255, activeLaser.color[1]! / 255, activeLaser.color[2]! / 255)
  const secColor = secondaryEnabled
    ? new Color3(activeLaser.secondaryColor[0]! / 255, activeLaser.secondaryColor[1]! / 255, activeLaser.secondaryColor[2]! / 255)
    : undefined

  updateBeamVisual(from, to, widthWorld, color, alpha, secColor)

  // Source and target markers
  if (!sourceMarker) {
    const sm = MeshBuilder.CreateSphere('src', { diameter: 0.3 }, scene)
    sm.position = from
    const m = new StandardMaterial('sm', scene)
    m.diffuseColor = new Color3(0.2, 1, 0.3); m.emissiveColor = new Color3(0.1, 0.5, 0.15)
    m.specularColor = new Color3(0, 0, 0)
    sm.material = m
    sourceMarker = sm
  }
  if (!targetMarker) {
    const tm = MeshBuilder.CreateSphere('tgt', { diameter: 0.3 }, scene)
    tm.position = to
    const m = new StandardMaterial('tm', scene)
    m.diffuseColor = new Color3(1, 0.3, 0.3); m.emissiveColor = new Color3(0.4, 0.1, 0.1)
    m.specularColor = new Color3(0, 0, 0)
    tm.material = m
    targetMarker = tm
  } else {
    targetMarker.position = to
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

let frameCounter = 0
const SIM_INTERVAL = 2  // 1 logic tick per N render frames

function simulateTick(): void {
  if (!simRunning || !activeLaser || !activeWorld || !activeFlushFrameEnd) return
  if (beamDisposed) return

  // Update guidedTarget so LaserZap.tick() reads fresh position (BLOCKER fix:
  // .target is always overwritten by tick() line 157-171 from guidedTarget)
  if (trackingEnabled && !activeLaser.isDestroyed) {
    const twp = getTargetWPos()
    activeLaser.args.guidedTarget = Target.fromPos(twp)
  }

  // Advance one tick
  activeLaser.tick(activeWorld)
  activeFlushFrameEnd()
  ticksElapsed++

  // Log significant events
  if (ticksElapsed === 1) {
    addLog(ticksElapsed, `T1: beamAlpha=${activeLaser.beamAlpha} | impacts=${activeArgs?.weapon.impactCount ?? 0}`)
  }
  if (ticksElapsed === activeLaser.info.damageDuration) {
    addLog(ticksElapsed, `Damage window ended | total impacts=${activeArgs?.weapon.impactCount ?? 0}`)
  }
  if (ticksElapsed === activeLaser.info.duration) {
    addLog(ticksElapsed, `Duration reached | beamAlpha=${activeLaser.beamAlpha}`)
  }

  // Check if beam should be disposed (alpha reached 0 and past duration)
  if (ticksElapsed >= activeLaser.info.duration && activeLaser.beamAlpha <= 0) {
    disposeBeamMeshes()
    beamDisposed = true
    simRunning = false
    addLog(ticksElapsed, `BEAM FADED — alpha=0, total impacts=${activeArgs?.weapon.impactCount ?? 0}`)
  }

  // Update beam visual
  renderBeamFromLaser()

  // Log every 5 ticks for tracking
  if (ticksElapsed % 5 === 0 && !beamDisposed && ticksElapsed > 0) {
    addLog(ticksElapsed, `beamAlpha=${activeLaser.beamAlpha} | remaining=${Math.max(0, beamDuration - ticksElapsed)}`)
  }

  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  cleanupAll()
  logEntries.length = 0
  targetTime = 0
  targetMesh.position.set(10, 0.2, 4)
  renderLog()
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  updateTarget(engine.getDeltaTime() / 1000)

  frameCounter++
  if (frameCounter >= SIM_INTERVAL && simRunning && !beamDisposed) {
    frameCounter = 0
    simulateTick()
  }

  scene.render()
  updateInfoBar()
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

window.addEventListener('resize', () => { engine.resize() })

// ---------------------------------------------------------------------------
// UI Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-fire')!.addEventListener('click', fireLaser)
document.getElementById('btn-reset')!.addEventListener('click', resetAll)

const colorSelect = document.getElementById('player-color') as HTMLSelectElement
colorSelect.addEventListener('change', () => { beamColorStr = colorSelect.value })

const trackToggle = document.getElementById('toggle-track') as HTMLInputElement
trackToggle.addEventListener('change', () => { trackingEnabled = trackToggle.checked })

const movingToggle = document.getElementById('toggle-moving') as HTMLInputElement
movingToggle.addEventListener('change', () => { movingTarget = movingToggle.checked })

const secondaryToggle = document.getElementById('toggle-secondary') as HTMLInputElement
secondaryToggle.addEventListener('change', () => { secondaryEnabled = secondaryToggle.checked })

const widthSlider = document.getElementById('beam-width') as HTMLInputElement
widthSlider.addEventListener('input', () => {
  beamWidthWDist = Math.round(parseFloat(widthSlider.value) * 10.75)
  document.getElementById('beam-width-val')!.textContent = `${beamWidthWDist} wu`
})

const durationSlider = document.getElementById('beam-duration') as HTMLInputElement
durationSlider.addEventListener('input', () => {
  beamDuration = parseInt(durationSlider.value)
  document.getElementById('beam-duration-val')!.textContent = `${beamDuration} t`
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene,
  engine,

  fireLaser(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, playerColor?: string): void {
    // MAJOR 3: respect playerColor parameter instead of ignoring it
    // Override source position
    const source = new WPos(
      Math.round(from.x / WORLD_SCALE),
      Math.round(from.z / WORLD_SCALE),
      Math.round(from.y / HEIGHT_SCALE),
    )
    const target = new WPos(
      Math.round(to.x / WORLD_SCALE),
      Math.round(to.z / WORLD_SCALE),
      Math.round(to.y / HEIGHT_SCALE),
    )

    cleanupAll()
    logEntries.length = 0

    const { world, flushFrameEnd } = createStubWorld()
    activeWorld = world
    activeFlushFrameEnd = flushFrameEnd

    const args = makeArgs(source, target)
    activeArgs = args

    // Use passed playerColor, or fall back to UI color selector
    const colorStr = playerColor ?? beamColorStr
    const color: [number, number, number, number] = parseColor(colorStr)

    activeLaser = LaserZapFactory.create(args, {
      duration: beamDuration,
      damageDuration: 3,
      damageInterval: 1,
      trackTarget: trackingEnabled,
      blockable: false,
      width: new WDist(beamWidthWDist),
      shape: BeamRenderableShape.Cylindrical,
      color,
      secondaryBeam: secondaryEnabled,
      secondaryBeamWidth: new WDist(Math.round(beamWidthWDist * 0.6)),
      secondaryBeamColor: [255, 255, 255, 180],
      inaccuracy: WDist.Zero,
    } satisfies Partial<LaserZapInfo>)

    simRunning = true
    ticksElapsed = 0
    beamDisposed = false
    addLog(0, `Harness fire | color=(${color[0]},${color[1]},${color[2]}) | playerColor=${playerColor ?? '(none)'}`)
    renderBeamFromLaser()
    updateDiagnostics()
  },

  getBeamWidth(): number {
    if (!activeLaser) return 0
    const mid = wPosToVector3(
      (activeLaser.source.X + activeLaser.target.X) / 2,
      (activeLaser.source.Y + activeLaser.target.Y) / 2,
      (activeLaser.source.Z + activeLaser.target.Z) / 2,
    )
    return estimatePixelWidth(activeLaser.info.width.length * WORLD_SCALE, mid, camera.position)
  },

  getBeamColor(): { r: number; g: number; b: number } | null {
    if (!activeLaser) return null
    return { r: activeLaser.color[0]!, g: activeLaser.color[1]!, b: activeLaser.color[2]! }
  },

  isBeamVisible(): boolean {
    return beamLine !== null && (activeLaser?.beamAlpha ?? 0) > 0
  },

  getBeamDuration(): number {
    if (!activeLaser) return 0
    return Math.max(0, beamDuration - ticksElapsed)
  },

  getBeamEndpoints(): { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null {
    if (!activeLaser) return null
    return {
      from: {
        x: activeLaser.source.X * WORLD_SCALE,
        y: activeLaser.source.Z * HEIGHT_SCALE,
        z: activeLaser.source.Y * WORLD_SCALE,
      },
      to: {
        x: activeLaser.target.X * WORLD_SCALE,
        y: activeLaser.target.Z * HEIGHT_SCALE,
        z: activeLaser.target.Y * WORLD_SCALE,
      },
    }
  },

  getActiveLaser(): LaserZap | null { return activeLaser },
  getBeamAlpha(): number { return activeLaser?.beamAlpha ?? 0 },
  getImpacts(): number { return activeArgs?.weapon.impactCount ?? 0 },
  getEventLog(): LogEntry[] { return [...logEntries] },
  reset: resetAll,
}
