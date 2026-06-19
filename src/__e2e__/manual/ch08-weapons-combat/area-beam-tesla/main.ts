/**
 * area-beam-tesla/main.ts -- AreaBeam projectile visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/AreaBeam.cs
 * GLSL对照: 无直接Shader映射（Beam使用StandardMaterial + emissive）
 *           颜色调制通过 StandardMaterial.diffuseColor/emissiveColor/alpha 实现
 *           透明度渐变（fadeIn/fadeOut）等效于 OpenRA 的 alpha 调制
 *
 * Verifies:
 *   A1. Beam opacity reaches 1.0 within fadeIn (head travel) ±1 tick
 *   A2. Beam midpoint width matches configured WDist (≤5% error)
 *   A3. Actors within width/2 of beam centerline receive damage
 *   A4. Actors outside width/2 receive no damage
 *   A5. Beam fully disposed after fadeOut (tail travel) completes
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
  VertexBuffer,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

import { BeamRenderableShape } from '../../../../OpenRA.Mods.Common/Projectiles/BeamRenderableShape.js'
import {
  AreaBeam,
  AreaBeamFactory,
  type FindActorsOnLineCallback,
} from '../../../../OpenRA.Mods.Common/Projectiles/AreaBeam.js'
import type {
  ProjectileArgs,
  WeaponStub,
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

// ---------------------------------------------------------------------------
// 2D point-to-segment distance (OpenRA XY ground plane)
// ---------------------------------------------------------------------------

function pointToSegmentDist2D(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const abx = bx - ax, aby = by - ay
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = ax + t * abx, projY = ay + t * aby
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function createStubActor(pos?: WPos): IGameActor {
  const centerPos = pos ?? WPos.Zero
  const owner: PlayerStub = { playerName: 'TestPlayer' }
  const raw = {
    actorId: Math.floor(Math.random() * 10000),
    isInWorld: true, isDead: false, generation: 0, disposed: false,
    owner,
    world: null as unknown as GameWorldManager,
    centerPosition: centerPos,
    isTargetableBy(_targeter: unknown): boolean { return true },
    tick(_world: GameWorldManager): void {},
    dispose(): void {},
    get traits(): never { throw new Error('not implemented') },
    trait<T>(): T { throw new Error('not implemented') },
    traitsImplementing<T>(): T[] { return [] },
    getTargetablePositions(): readonly WPos[] { return [centerPos] },
  }
  return raw as unknown as IGameActor
}

function createStubRandom(seed: number = 42): { next(): number; get last(): number } {
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
    get sharedRandom(): { next(): number; get last(): number } { return createStubRandom() },
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
scene.clearColor = new Color4(0.04, 0.07, 0.12, 1)

const camera = new ArcRotateCamera(
  'cam', -Math.PI / 2, Math.PI / 3.5, 18,
  new Vector3(6, 0.5, 5), scene,
)
camera.lowerRadiusLimit = 4
camera.upperRadiusLimit = 50
camera.attachControl(canvas, true)

const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
hemi.intensity = 0.9

// Ground
const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 24 }, scene)
ground.position.y = -0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.08, 0.11, 0.16)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.75
ground.material = gmat

// Grid (disposed automatically via Engine.dispose on page unload)
for (let i = -3; i <= 13; i++) {
  const l = MeshBuilder.CreateLines('gx', { points: [new Vector3(i, 0.005, -3), new Vector3(i, 0.005, 11)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = i % 5 === 0 ? 0.3 : 0.07
}
for (let j = -3; j <= 11; j++) {
  const l = MeshBuilder.CreateLines('gz', { points: [new Vector3(-3, 0.005, j), new Vector3(13, 0.005, j)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = j % 5 === 0 ? 0.3 : 0.07
}

// ---------------------------------------------------------------------------
// Scene Markers
// ---------------------------------------------------------------------------

let sourceMarker: Mesh | null = null
let targetMarker: Mesh | null = null

function clearMarkers(): void {
  if (sourceMarker) { sourceMarker.dispose(); sourceMarker = null }
  if (targetMarker) { targetMarker.dispose(); targetMarker = null }
}

// Shared marker materials (MAJOR 2 fix: pre-create, no per-launch allocation)
let sharedSrcMarkerMat: StandardMaterial | null = null
let sharedTgtMarkerMat: StandardMaterial | null = null
function getSrcMarkerMat(): StandardMaterial {
  if (!sharedSrcMarkerMat) {
    sharedSrcMarkerMat = new StandardMaterial('srcMarkerMat', scene)
    sharedSrcMarkerMat.diffuseColor = new Color3(0.2, 1, 0.3)
    sharedSrcMarkerMat.emissiveColor = new Color3(0.1, 0.5, 0.15)
    sharedSrcMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedSrcMarkerMat
}
function getTgtMarkerMat(): StandardMaterial {
  if (!sharedTgtMarkerMat) {
    sharedTgtMarkerMat = new StandardMaterial('tgtMarkerMat', scene)
    sharedTgtMarkerMat.diffuseColor = new Color3(1, 0.25, 0.25)
    sharedTgtMarkerMat.emissiveColor = new Color3(0.4, 0.1, 0.1)
    sharedTgtMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedTgtMarkerMat
}

function createMarkers(source: WPos, target: WPos): void {
  clearMarkers()
  sourceMarker = MeshBuilder.CreateSphere('srcM', { diameter: 0.3 }, scene)
  sourceMarker.position = wPosToVector3(source.X, source.Y, source.Z)
  sourceMarker.material = getSrcMarkerMat()

  targetMarker = MeshBuilder.CreateSphere('tgtM', { diameter: 0.3 }, scene)
  targetMarker.position = wPosToVector3(target.X, target.Y, target.Z)
  targetMarker.material = getTgtMarkerMat()
}

// ---------------------------------------------------------------------------
// Mock Actors (visual + damage tracking for AOE verification)
// ---------------------------------------------------------------------------

interface MockActor {
  id: number
  label: string
  mesh: Mesh
  wPos: WPos
  hit: boolean
  hitCount: number
}

const mockActors: MockActor[] = []
let actorIdCounter = 0

let actorNormalMat: StandardMaterial | null = null
let actorHitMat: StandardMaterial | null = null

function getActorNormalMat(): StandardMaterial {
  if (!actorNormalMat) {
    actorNormalMat = new StandardMaterial('actorNorm', scene)
    actorNormalMat.diffuseColor = new Color3(0.3, 0.5, 0.9)
    actorNormalMat.emissiveColor = new Color3(0.05, 0.1, 0.25)
    actorNormalMat.specularColor = new Color3(0, 0, 0)
  }
  return actorNormalMat
}

function getActorHitMat(): StandardMaterial {
  if (!actorHitMat) {
    actorHitMat = new StandardMaterial('actorHit', scene)
    actorHitMat.diffuseColor = new Color3(0.95, 0.15, 0.15)
    actorHitMat.emissiveColor = new Color3(0.5, 0.05, 0.05)
    actorHitMat.specularColor = new Color3(0, 0, 0)
  }
  return actorHitMat
}

function createMockActor(wp: WPos, label: string): MockActor {
  const v = wPosToVector3(wp.X, wp.Y, wp.Z)
  const id = ++actorIdCounter
  const mesh = MeshBuilder.CreateBox(`actor${id}`, { width: 0.22, height: 0.5, depth: 0.22 }, scene)
  mesh.position = v.clone()
  mesh.material = getActorNormalMat()

  const actor: MockActor = { id, label, mesh, wPos: wp, hit: false, hitCount: 0 }
  mockActors.push(actor)
  return actor
}

function resetMockActors(): void {
  for (const a of mockActors) {
    a.hit = false; a.hitCount = 0
    a.mesh.material = getActorNormalMat()
  }
}

function markActorHit(actor: MockActor): void {
  actor.hit = true; actor.hitCount++
  actor.mesh.material = getActorHitMat()
}

function clearMockActors(): void {
  for (const a of mockActors) a.mesh.dispose()
  mockActors.length = 0; actorIdCounter = 0
}

// ---------------------------------------------------------------------------
// Beam Visual (cylinder + glow line + width indicator ring)
// ---------------------------------------------------------------------------

let beamCylinder: Mesh | null = null
let beamGlowLine: LinesMesh | null = null
let beamWidthRing: Mesh | null = null
let beamCylinderMat: StandardMaterial | null = null

function createBeamMaterials(): void {
  if (!beamCylinderMat) {
    beamCylinderMat = new StandardMaterial('beamCylMat', scene)
    beamCylinderMat.specularColor = new Color3(0, 0, 0)
  }
}

function updateBeamVisual(
  from: Vector3, to: Vector3, widthWorld: number,
  opacity: number, color: Color3,
): void {
  createBeamMaterials()
  const alpha = Math.max(0, Math.min(1, opacity))

  if (alpha <= 0.002) {
    if (beamCylinder) beamCylinder.setEnabled(false)
    if (beamGlowLine) beamGlowLine.setEnabled(false)
    if (beamWidthRing) beamWidthRing.setEnabled(false)
    return
  }

  const dir = to.subtract(from)
  const len = dir.length()
  if (len < 0.001) return
  const dirNorm = dir.normalize()
  const mid = from.add(to).scale(0.5)

  // ---- Cylinder ----
  if (!beamCylinder) {
    beamCylinder = MeshBuilder.CreateCylinder('beamBody', { height: 1, diameter: 1, tessellation: 18 }, scene)
    beamCylinder.material = beamCylinderMat
    beamCylinder.renderingGroupId = 1
  }
  beamCylinder.setEnabled(true)
  beamCylinder.scaling.set(widthWorld, len, widthWorld)
  beamCylinder.position = mid
  const quat = new Quaternion()
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), dirNorm, quat)
  beamCylinder.rotationQuaternion = quat
  if (beamCylinderMat) {
    beamCylinderMat.diffuseColor = color
    beamCylinderMat.emissiveColor = color.scale(0.5)
    beamCylinderMat.alpha = alpha * 0.3
  }

  // ---- Glow core line ----
  const glowColor = new Color4(
    Math.min(1, color.r * 1.3), Math.min(1, color.g * 1.3), Math.min(1, color.b * 1.3), alpha * 0.9,
  )
  if (!beamGlowLine) {
    beamGlowLine = MeshBuilder.CreateLines('beamCore', {
      points: [from, to], colors: [glowColor, glowColor], updatable: true,
    }, scene)
    beamGlowLine.renderingGroupId = 1
  } else {
    // MAJOR 1 fix: update in-place instead of per-frame mesh allocation
    const posData = new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z])
    const colData = new Float32Array([glowColor.r, glowColor.g, glowColor.b, glowColor.a,
                                       glowColor.r, glowColor.g, glowColor.b, glowColor.a])
    beamGlowLine.updateVerticesData(VertexBuffer.PositionKind, posData, false, false)
    beamGlowLine.updateVerticesData(VertexBuffer.ColorKind, colData, false, false)
  }
  beamGlowLine.setEnabled(true)
  beamGlowLine.alpha = alpha

  // ---- Width indicator ring at midpoint ----
  if (!beamWidthRing) {
    beamWidthRing = MeshBuilder.CreateTorus('widthRing', {
      diameter: 1, thickness: 0.025, tessellation: 32,
    }, scene)
    const wrmat = new StandardMaterial('wrMat', scene)
    wrmat.diffuseColor = new Color3(0.3, 0.8, 1)
    wrmat.emissiveColor = new Color3(0.15, 0.4, 0.6)
    wrmat.specularColor = new Color3(0, 0, 0)
    wrmat.alpha = alpha * 0.5
    beamWidthRing.material = wrmat
    beamWidthRing.renderingGroupId = 1
  }
  beamWidthRing.setEnabled(true)
  beamWidthRing.position = mid
  beamWidthRing.scaling.setAll(widthWorld)
  const ringQ = new Quaternion()
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), dirNorm, ringQ)
  beamWidthRing.rotationQuaternion = ringQ
  if (beamWidthRing.material) {
    (beamWidthRing.material as StandardMaterial).alpha = alpha * 0.5
  }
}

function hideBeamVisual(): void {
  if (beamCylinder) beamCylinder.setEnabled(false)
  if (beamGlowLine) beamGlowLine.setEnabled(false)
  if (beamWidthRing) beamWidthRing.setEnabled(false)
}

function disposeBeamVisual(): void {
  if (beamCylinder) { beamCylinder.dispose(); beamCylinder = null }
  if (beamGlowLine) { beamGlowLine.dispose(); beamGlowLine = null }
  if (beamWidthRing) { beamWidthRing.dispose(); beamWidthRing = null }
  beamCylinderMat = null
}

// ---------------------------------------------------------------------------
// AreaBeam State
// ---------------------------------------------------------------------------

interface TestWeapon extends WeaponStub {
  impactCount: number
  hitActorIds: number[]
}

let activeBeam: AreaBeam | null = null
let beamWorld: ReturnType<typeof createStubWorld> | null = null
let activeWeapon: TestWeapon | null = null
let simRunning = false
let beamDisposed = false
let ticksSinceFire = 0
let currentFadePhase: 'fadeIn' | 'sustain' | 'fadeOut' | 'done' = 'done'
let currentOpacity = 0

// Default config
// Beam distance = 9216 su. With speed=512, length = 9216/512 ≈ 18 ticks.
// Timeline: fadeIn(0-17) → sustain(18-29) → fadeOut(30-47) → done(48+)
let configSpeed = 512
let configDuration = 30
let configWidth = 512
let configColor: [number, number, number, number] = [100, 180, 255, 255]

const DEFAULT_SOURCE = new WPos(1536, 5120, 0)
const DEFAULT_TARGET = new WPos(10752, 5120, 0)

// ---------------------------------------------------------------------------
// findActorsOnLine — mock implementation for AOE verification
// ---------------------------------------------------------------------------

const findActorsOnLine: FindActorsOnLineCallback = (
  _world: GameWorldManager,
  from: WPos,
  to: WPos,
  width: WDist,
): IGameActor[] => {
  const halfWidth = width.length / 2
  const result: IGameActor[] = []

  for (const ma of mockActors) {
    const dist = pointToSegmentDist2D(ma.wPos.X, ma.wPos.Y, from.X, from.Y, to.X, to.Y)
    if (dist <= halfWidth) {
      result.push(createStubActor(ma.wPos))
      markActorHit(ma)
      activeWeapon?.hitActorIds.push(ma.id)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

interface LogEntry { tick: number; phase: string; text: string }
const logEntries: LogEntry[] = []

function addLog(tick: number, phase: string, text: string): void {
  logEntries.push({ tick, phase, text })
  renderLog()
}

function renderLog(): void {
  const el = document.getElementById('event-log')!
  const recent = logEntries.slice(-35)
  el.innerHTML = recent.length === 0
    ? '<div class="log-row log-info">Ready. Configure beam and press Fire.</div>'
    : recent.map(e =>
      `<div class="log-row">
        <span class="log-tick">T${e.tick.toString().padStart(3, '0')}</span>
        <span class="log-phase">[${e.phase}]</span> ${e.text}
      </div>`).join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function updateDiagnostics(): void {
  document.getElementById('diag-phase')!.textContent = currentFadePhase
  document.getElementById('diag-opacity')!.textContent = currentOpacity.toFixed(3)
  document.getElementById('diag-head')!.textContent = activeBeam
    ? `${activeBeam.headTicks}/${activeBeam.length} (travelling=${activeBeam.isHeadTravelling})` : '-'
  document.getElementById('diag-tail')!.textContent = activeBeam
    ? `${activeBeam.tailTicks}/${activeBeam.length} (travelling=${activeBeam.isTailTravelling})` : '-'
  document.getElementById('diag-complete')!.textContent = activeBeam?.isBeamComplete ? 'YES' : 'no'
  document.getElementById('diag-width-display')!.textContent = activeBeam
    ? `${activeBeam.info.width.length} su (r=${(activeBeam.info.width.length / 2048).toFixed(3)} wu)` : '-'

  const hitIds = activeWeapon?.hitActorIds ?? []
  document.getElementById('diag-hits')!.textContent = hitIds.length > 0
    ? `[${hitIds.join(', ')}] — ${hitIds.length} actors` : '-'

  document.getElementById('diag-ticks')!.textContent = activeBeam ? String(ticksSinceFire) : '-'
  document.getElementById('diag-speed-display')!.textContent = activeBeam
    ? `${activeBeam.speed.length} su/t (beamLength=${activeBeam.length}t)` : '-'
}

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

function cleanupAll(): void {
  hideBeamVisual()
  clearMarkers()
  resetMockActors()
  activeBeam = null; beamWorld = null; activeWeapon = null
  simRunning = false; beamDisposed = false; ticksSinceFire = 0
  currentFadePhase = 'done'; currentOpacity = 0; frameCounter = 0
}

function fireBeam(source?: WPos, target?: WPos): void {
  cleanupAll()
  logEntries.length = 0

  const src = source ?? DEFAULT_SOURCE
  const tgt = target ?? DEFAULT_TARGET
  createMarkers(src, tgt)

  // Place mock actors for AOE verification
  clearMockActors()
  const halfW = configWidth / 2 // su
  const midX = Math.trunc((src.X + tgt.X) / 2)
  const midY = Math.trunc((src.Y + tgt.Y) / 2)

  // A_center: on beam centerline → SHOULD be hit (dist = 0 < halfW)
  createMockActor(new WPos(midX, midY, 0), 'A_center')
  // B_inside: offset 0.6 * halfW north → SHOULD be hit
  createMockActor(new WPos(midX + 1024, midY + Math.trunc(halfW * 0.6), 0), 'B_inside')
  // C_outside: offset 1.5 * halfW north → should NOT be hit
  createMockActor(new WPos(midX + 1024, midY + Math.trunc(halfW * 1.5), 0), 'C_outside')
  // D_edge: offset 0.98 * halfW south → borderline inside → SHOULD be hit
  createMockActor(new WPos(midX - 512, midY - Math.trunc(halfW * 0.98), 0), 'D_edge')
  // E_farOutside: offset 3 * halfW → definitely NOT hit
  createMockActor(new WPos(midX, midY + Math.trunc(halfW * 3), 0), 'E_farOutside')

  const beamWorldData = createStubWorld()
  beamWorld = beamWorldData
  const stubSource = createStubActor(src)

  const weapon: TestWeapon = { impactCount: 0, hitActorIds: [], impact(): void { this.impactCount++ } }
  activeWeapon = weapon

  const args: ProjectileArgs = {
    sourceActor: stubSource, source: src, passiveTarget: tgt,
    guidedTarget: Target.fromPos(tgt),
    weapon: weapon as unknown as WeaponStub,
    facing: WAngle.fromFacing(64),
    inaccuracySource: WDist.Zero,
    random: createStubRandom(42),
    rangeModifiers: [],
  }

  const beam = AreaBeamFactory.create(args, {
    speed: [new WDist(configSpeed)],
    duration: configDuration,
    damageInterval: 2,
    width: new WDist(configWidth),
    shape: BeamRenderableShape.Cylindrical,
    beyondTargetRange: WDist.Zero,
    falloff: [100, 100],
    range: [WDist.Zero, new WDist(100000)],
    inaccuracy: WDist.Zero,
    trackTarget: false,
    color: configColor,
  }, null, findActorsOnLine)

  activeBeam = beam
  simRunning = true; beamDisposed = false; ticksSinceFire = 0
  currentFadePhase = 'fadeIn'; currentOpacity = 0

  addLog(0, 'init', `FIRED | length=${beam.length}t speed=${beam.speed.length}su/t duration=${configDuration}t`)
  addLog(0, 'init', `width=${configWidth}su (half=${halfW}su, radius=${(halfW/1024).toFixed(3)}wu)`)
  addLog(0, 'init', `mockActors=${mockActors.length}: A_center B_inside C_outside D_edge E_farOutside`)

  // Show faint initial beam
  const fromV = wPosToVector3(src.X, src.Y, src.Z)
  const toV = wPosToVector3(beam.target.X, beam.target.Y, beam.target.Z)
  const color = new Color3(configColor[0]! / 255, configColor[1]! / 255, configColor[2]! / 255)
  updateBeamVisual(fromV, toV, beam.info.width.length * WORLD_SCALE, 0.02, color)
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const SIM_TICK_INTERVAL = 2
let frameCounter = 0

function simulateTick(): void {
  if (!simRunning || !activeBeam || !beamWorld) return

  if (activeBeam.isDestroyed && !beamDisposed) {
    beamDisposed = true; simRunning = false
    currentFadePhase = 'done'; currentOpacity = 0
    hideBeamVisual()
    addLog(ticksSinceFire, 'done', `DESTROYED | totalImpacts=${activeWeapon?.impactCount ?? 0}`)
    updateDiagnostics()
    return
  }
  if (beamDisposed) return

  // Advance
  activeBeam.tick(beamWorld.world)
  beamWorld.flushFrameEnd()
  ticksSinceFire++

  const L = activeBeam.length
  const headArrived = !activeBeam.isHeadTravelling && activeBeam.headTicks >= L
  const tailStarted = activeBeam.isTailTravelling
  const tailArrived = !activeBeam.isTailTravelling && activeBeam.tailTicks >= L

  if (tailArrived || activeBeam.isBeamComplete) {
    currentFadePhase = 'done'
    currentOpacity = 0
  } else if (tailStarted) {
    currentFadePhase = 'fadeOut'
    currentOpacity = Math.max(0, 1 - activeBeam.tailTicks / Math.max(1, L))
  } else if (headArrived) {
    currentFadePhase = 'sustain'
    currentOpacity = 1.0
  } else {
    currentFadePhase = 'fadeIn'
    currentOpacity = Math.min(1, activeBeam.headTicks / Math.max(1, L))
  }

  // Update visual
  const fromV = wPosToVector3(activeBeam.tailPos.X, activeBeam.tailPos.Y, activeBeam.tailPos.Z)
  const toV = wPosToVector3(activeBeam.headPos.X, activeBeam.headPos.Y, activeBeam.headPos.Z)
  const widthW = activeBeam.info.width.length * WORLD_SCALE
  const col = new Color3(configColor[0]! / 255, configColor[1]! / 255, configColor[2]! / 255)
  updateBeamVisual(fromV, toV, widthW, currentOpacity, col)

  // Log events
  if (currentFadePhase === 'fadeIn' && currentOpacity >= 0.98) {
    addLog(ticksSinceFire, 'sustain', `OPACITY REACHED 1.0 | head=${activeBeam.headTicks}/${L} | hits=${activeWeapon?.hitActorIds.length ?? 0}`)
  }
  if (tailStarted && activeBeam.tailTicks === 1) {
    addLog(ticksSinceFire, 'fadeOut', `TAIL STARTED | fadeOut over ${L} ticks`)
  }
  if (ticksSinceFire % 5 === 0) {
    addLog(ticksSinceFire, currentFadePhase,
      `op=${currentOpacity.toFixed(2)} head=${activeBeam.headTicks}/${L} tail=${activeBeam.tailTicks}/${L} hits=${activeWeapon?.hitActorIds.length ?? 0}`)
  }

  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  cleanupAll()
  clearMockActors()
  disposeBeamVisual()
  logEntries.length = 0
  renderLog()
  updateDiagnostics()
}

// Engine.dispose() recursively disposes all scene objects (meshes, materials, etc.)
window.addEventListener('beforeunload', () => { engine.dispose() })

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  frameCounter++
  if (frameCounter >= SIM_TICK_INTERVAL && simRunning && !beamDisposed) {
    frameCounter = 0
    simulateTick()
  }
  scene.render()
  updateInfoBar()
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

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
  if (now - lastInfoTimeUpdate > 1000) { cachedInfoTime = new Date().toISOString(); lastInfoTimeUpdate = now }
  document.getElementById('info-time')!.textContent = cachedInfoTime
}

window.addEventListener('resize', () => { engine.resize() })

// ---------------------------------------------------------------------------
// UI Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-fire')!.addEventListener('click', () => { fireBeam() })
document.getElementById('btn-reset')!.addEventListener('click', () => { resetAll() })

document.getElementById('config-speed')!.addEventListener('input', (e) => {
  configSpeed = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('val-speed')!.textContent = `${configSpeed} su/t`
})
document.getElementById('config-duration')!.addEventListener('input', (e) => {
  configDuration = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('val-duration')!.textContent = `${configDuration} t`
})
document.getElementById('config-width')!.addEventListener('input', (e) => {
  configWidth = parseInt((e.target as HTMLInputElement).value)
  document.getElementById('val-width')!.textContent =
    `${configWidth} su (r=${(configWidth / 2048).toFixed(3)}wu)`
})
document.getElementById('config-color')!.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value.split(',').map(Number)
  configColor = [val[0] ?? 100, val[1] ?? 180, val[2] ?? 255, 255]
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene, engine,

  fireBeam(
    from?: { x: number; y: number; z: number },
    to?: { x: number; y: number; z: number },
    width?: number,
  ): void {
    if (width !== undefined) configWidth = width
    const src = from ? vector3ToWPos(new Vector3(from.x, from.y, from.z)) : undefined
    const tgt = to ? vector3ToWPos(new Vector3(to.x, to.y, to.z)) : undefined
    fireBeam(src, tgt)
  },

  getBeamOpacity(): number { return currentOpacity },

  getActorsInBeam(): number[] { return [...(activeWeapon?.hitActorIds ?? [])] },

  getBeamWidth(): number {
    if (!activeBeam) return 0
    return activeBeam.info.width.length * WORLD_SCALE
  },

  isFadingIn(): boolean { return currentFadePhase === 'fadeIn' },
  isFadingOut(): boolean { return currentFadePhase === 'fadeOut' },
  getFadePhase(): string { return currentFadePhase },

  getActiveBeam(): AreaBeam | null { return activeBeam },
  getImpacts(): number { return activeWeapon?.impactCount ?? 0 },

  getMockActorStates(): { id: number; label: string; hit: boolean; hitCount: number }[] {
    return mockActors.map(a => ({ id: a.id, label: a.label, hit: a.hit, hitCount: a.hitCount }))
  },

  getBeamEndpoints(): { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null {
    if (!activeBeam || activeBeam.isDestroyed) return null
    return {
      from: {
        x: activeBeam.tailPos.X * WORLD_SCALE, y: activeBeam.tailPos.Z * HEIGHT_SCALE, z: activeBeam.tailPos.Y * WORLD_SCALE,
      },
      to: {
        x: activeBeam.headPos.X * WORLD_SCALE, y: activeBeam.headPos.Z * HEIGHT_SCALE, z: activeBeam.headPos.Y * WORLD_SCALE,
      },
    }
  },

  getEventLog(): LogEntry[] { return [...logEntries] },
  reset: resetAll,
}
