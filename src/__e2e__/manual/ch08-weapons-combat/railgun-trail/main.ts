/**
 * railgun-trail/main.ts -- Railgun projectile helix trail visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/Railgun.cs
 * GLSL对照: 无直接Shader映射（Railgun使用LinesMesh + StandardMaterial）
 *           颜色调制通过 LinesMesh.color/alpha 实现
 *           Helix几何由 generateHelixPoints() CPU端生成顶点
 *
 * Verifies:
 *   R1. Projectile impacts target in ≤1 tick (instant hit at tick 0)
 *   R2. Helix trail color matches configured beamColor/helixColor
 *   R3. Helix trail is visible from source toward target
 *   R4. Trail fades to alpha=0 within ~5 ticks (configured alphaDelta)
 *   R5. Impact position matches target within tolerance
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
  VertexBuffer,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

import {
  Railgun,
  RailgunFactory,
} from '../../../../OpenRA.Mods.Common/Projectiles/Railgun.js'
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

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function createStubActor(pos?: WPos): IGameActor {
  const cp = pos ?? WPos.Zero
  const owner: PlayerStub = { playerName: 'TestPlayer' }
  const raw = {
    actorId: 1, isInWorld: true, isDead: false, generation: 0, disposed: false,
    owner, world: null as unknown as GameWorldManager, centerPosition: cp,
    isTargetableBy(_t: unknown): boolean { return true },
    tick(): void {}, dispose(): void {},
    get traits(): never { throw new Error('not implemented') },
    trait<T>(): T { throw new Error('not implemented') },
    traitsImplementing<T>(): T[] { return [] },
    getTargetablePositions(): readonly WPos[] { return [cp] },
  }
  return raw as unknown as IGameActor
}

function createStubRandom(seed = 42): { next(): number; get last(): number } {
  let s = seed
  return {
    next(): number { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s },
    get last(): number { return s },
  }
}

function createStubWorld(): {
  world: GameWorldManager; events: string[]; flushFrameEnd: () => void
} {
  const events: string[] = []
  const frameEndActions: (() => void)[] = []
  let effects: unknown[] = []
  const stubActor = createStubActor()
  const testOwner: PlayerStub = { playerName: 'TestPlayer' }
  const world = {
    addFrameEndTask(a: () => void): void { frameEndActions.push(a) },
    removeEffect(e: unknown): void {
      effects = effects.filter(x => x !== e)
      events.push(`removeEffect:${(e as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown'}`)
    },
    add(e: unknown): void { effects.push(e) },
    get worldActor(): IGameActor { return stubActor },
    get localPlayer(): PlayerStub { return testOwner },
    tick(): void {},
    get sharedRandom() { return createStubRandom() },
    get frameNumber(): number { return 0 },
    get paused(): boolean { return false },
  } as unknown as GameWorldManager
  return {
    world,
    events,
    flushFrameEnd() {
      const actions = frameEndActions.splice(0, frameEndActions.length)
      for (const action of actions) action()
    },
  }
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.03, 0.05, 0.09, 1)

const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 3.5, 22, new Vector3(6, 1, 5), scene)
camera.lowerRadiusLimit = 4
camera.upperRadiusLimit = 55
camera.attachControl(canvas, true)

const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
hemi.intensity = 0.9

// Ground
const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 24 }, scene)
ground.position.y = -0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.07, 0.10, 0.15)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.75
ground.material = gmat

// Grid (disposed automatically via Engine.dispose on page unload)
for (let i = -2; i <= 12; i++) {
  const l = MeshBuilder.CreateLines('gx', { points: [new Vector3(i, 0.005, -3), new Vector3(i, 0.005, 11)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = i % 5 === 0 ? 0.3 : 0.07
}
for (let j = -3; j <= 11; j++) {
  const l = MeshBuilder.CreateLines('gz', { points: [new Vector3(-2, 0.005, j), new Vector3(12, 0.005, j)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = j % 5 === 0 ? 0.3 : 0.07
}

// ---------------------------------------------------------------------------
// Shared Marker Materials
// ---------------------------------------------------------------------------

let sharedSrcMat: StandardMaterial | null = null
function getSrcMat(): StandardMaterial {
  if (!sharedSrcMat) {
    sharedSrcMat = new StandardMaterial('srcMat', scene)
    sharedSrcMat.diffuseColor = new Color3(0.2, 1, 0.3)
    sharedSrcMat.emissiveColor = new Color3(0.1, 0.5, 0.15)
    sharedSrcMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedSrcMat
}

let sharedTgtMat: StandardMaterial | null = null
function getTgtMat(): StandardMaterial {
  if (!sharedTgtMat) {
    sharedTgtMat = new StandardMaterial('tgtMat', scene)
    sharedTgtMat.diffuseColor = new Color3(1, 0.25, 0.25)
    sharedTgtMat.emissiveColor = new Color3(0.4, 0.1, 0.1)
    sharedTgtMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedTgtMat
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

function createMarkers(src: WPos, tgt: WPos): void {
  clearMarkers()
  sourceMarker = MeshBuilder.CreateSphere('src', { diameter: 0.3 }, scene)
  sourceMarker.position = wPosToVector3(src.X, src.Y, src.Z); sourceMarker.material = getSrcMat()
  targetMarker = MeshBuilder.CreateSphere('tgt', { diameter: 0.3 }, scene)
  targetMarker.position = wPosToVector3(tgt.X, tgt.Y, tgt.Z); targetMarker.material = getTgtMat()
}

/** Convert [r,g,b,a] 0-255 array to Color3 (m2 fix: extract helper). */
function arrayToColor3(arr: readonly [number, number, number, number]): Color3 {
  return new Color3(arr[0]! / 255, arr[1]! / 255, arr[2]! / 255)
}

// ---------------------------------------------------------------------------
// Helix Trail Visual
// ---------------------------------------------------------------------------

let helixLine: LinesMesh | null = null
let coreBeamLine: LinesMesh | null = null

// Pre-allocated for per-frame helix vertex update (no GC pressure)
const _helixVec = new Vector3()
let _helixBuf = new Float32Array(0)

function clearHelixVisual(): void {
  if (helixLine) { helixLine.dispose(); helixLine = null }
  if (coreBeamLine) { coreBeamLine.dispose(); coreBeamLine = null }
}

function updateHelixVisual(railgun: Railgun): void {
  const beamAlpha = railgun.beamAlpha / 255
  const helixAlpha = railgun.helixAlpha / 255
  const beamVisible = beamAlpha > 0.002
  const helixVisible = helixAlpha > 0.002

  if (!beamVisible && !helixVisible) {
    if (helixLine) helixLine.setEnabled(false)
    if (coreBeamLine) coreBeamLine.setEnabled(false)
    return
  }

  const beamCol = railgun.info.beamColor
  const helixCol = railgun.info.helixColor

  // Core beam line (source → target) — create once, only alpha changes
  const srcV = wPosToVector3(railgun.args.source.X, railgun.args.source.Y, railgun.args.source.Z)
  const tgtV = wPosToVector3(railgun.target.X, railgun.target.Y, railgun.target.Z)

  if (!coreBeamLine) {
    const bc = arrayToColor3(beamCol)
    const bColor = new Color4(bc.r, bc.g, bc.b, 1)
    coreBeamLine = MeshBuilder.CreateLines('coreBeam', {
      points: [srcV, tgtV], colors: [bColor, bColor], updatable: true,
    }, scene)
    coreBeamLine.renderingGroupId = 1
  }
  coreBeamLine.setEnabled(beamVisible)
  coreBeamLine.alpha = beamAlpha

  // Helix trail — updateVerticesData, no per-frame mesh allocation
  const hPoints = railgun.generateHelixPoints(railgun.ticks)
  if (hPoints.length >= 2 && helixVisible) {
    if (!helixLine) {
      const pts = hPoints.map(p => wPosToVector3(p.X, p.Y, p.Z))
      helixLine = MeshBuilder.CreateLines('helix', { points: pts, updatable: true }, scene)
      helixLine.color = arrayToColor3(helixCol)
      helixLine.renderingGroupId = 1
    } else {
      const nFloats = hPoints.length * 3
      if (_helixBuf.length < nFloats) _helixBuf = new Float32Array(nFloats)
      for (let i = 0; i < hPoints.length; i++) {
        const hp = hPoints[i]!
        _helixVec.set(hp.X * WORLD_SCALE, hp.Z * HEIGHT_SCALE, hp.Y * WORLD_SCALE)
        _helixBuf[i * 3] = _helixVec.x
        _helixBuf[i * 3 + 1] = _helixVec.y
        _helixBuf[i * 3 + 2] = _helixVec.z
      }
      helixLine.updateVerticesData(VertexBuffer.PositionKind, _helixBuf, false, false)
    }
    helixLine.setEnabled(true)
    helixLine.alpha = helixAlpha
  } else if (helixLine) {
    helixLine.setEnabled(false)
  }
}

// ---------------------------------------------------------------------------
// Impact Flash
// ---------------------------------------------------------------------------

let impactSphere: Mesh | null = null
let impactMat: StandardMaterial | null = null

function triggerImpactFlash(pos: Vector3): void {
  if (!impactSphere) {
    impactSphere = MeshBuilder.CreateSphere('impact', { diameter: 0.4 }, scene)
    impactMat = new StandardMaterial('impactMat', scene)
    impactMat.diffuseColor = new Color3(0.3, 0.8, 1)
    impactMat.emissiveColor = new Color3(0.6, 1, 1)
    impactMat.specularColor = new Color3(0, 0, 0); impactMat.alpha = 1
    impactSphere.material = impactMat; impactSphere.renderingGroupId = 2
  }
  impactSphere.setEnabled(true); impactSphere.position = pos.clone()
  impactSphere.scaling.setAll(0.5)
}

function updateImpactFlash(ticksSinceImpact: number): void {
  if (!impactSphere || !impactSphere.isEnabled()) return
  if (ticksSinceImpact <= 3) {
    impactSphere.scaling.setAll(0.5 + ticksSinceImpact * 0.5)
    if (impactMat) impactMat.alpha = 1
  } else {
    const fade = Math.max(0, 1 - (ticksSinceImpact - 3) / 8)
    if (impactMat) impactMat.alpha = fade
    impactSphere.scaling.setAll(2 + (1 - fade) * 2)
    if (fade <= 0) impactSphere.setEnabled(false)
  }
}

function hideImpactFlash(): void {
  if (impactSphere) impactSphere.setEnabled(false)
}

// ---------------------------------------------------------------------------
// Railgun State
// ---------------------------------------------------------------------------

interface TestWeapon extends WeaponStub { impactCount: number; lastImpactPos: WPos | null }

let activeRailgun: Railgun | null = null
let railWorld: ReturnType<typeof createStubWorld> | null = null
let activeWeapon: TestWeapon | null = null
let simRunning = false
let ticksSinceFire = 0
let impactTriggered = false
let beamAlpha = 0
let helixAlpha = 0

// Config
let configBeamWidth = 86
let configDuration = 15
let configHelixRadius = 64
let configHelixPitch = 512
let configBeamColor: [number, number, number, number] = [128, 255, 255, 255]
let configHelixColor: [number, number, number, number] = [128, 255, 255, 255]
let configBeamAlphaDelta = -51  // α: 255 → 0 in 5 ticks
let configHelixAlphaDelta = -51

const DEFAULT_SOURCE = new WPos(1536, 5120, 0)
const DEFAULT_TARGET = new WPos(10240, 5120, 0)

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

interface LogEntry { tick: number; text: string }
const logEntries: LogEntry[] = []

function addLog(tick: number, text: string): void {
  logEntries.push({ tick, text }); renderLog()
}

function renderLog(): void {
  const el = document.getElementById('event-log')!
  const recent = logEntries.slice(-30)
  el.innerHTML = recent.length === 0
    ? '<div class="log-row log-info">Ready. Press Fire to launch railgun.</div>'
    : recent.map(e => `<div class="log-row"><span class="log-tick">T${e.tick.toString().padStart(3,'0')}</span>${e.text}</div>`).join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function updateDiagnostics(): void {
  document.getElementById('diag-impacted')!.textContent = impactTriggered ? 'YES' : 'no'
  document.getElementById('diag-beamAlpha')!.textContent = beamAlpha.toFixed(0)
  document.getElementById('diag-helixAlpha')!.textContent = helixAlpha.toFixed(0)
  document.getElementById('diag-ticks')!.textContent = activeRailgun ? String(activeRailgun.ticks) : '-'
  document.getElementById('diag-duration')!.textContent = activeRailgun
    ? `${activeRailgun.ticks}/${activeRailgun.info.duration}` : '-'
  document.getElementById('diag-destroyed')!.textContent = activeRailgun?.isDestroyed ? 'YES' : 'no'
  document.getElementById('diag-impactPos')!.textContent = activeWeapon?.lastImpactPos
    ? `(${activeWeapon.lastImpactPos.X}, ${activeWeapon.lastImpactPos.Y}, ${activeWeapon.lastImpactPos.Z})` : '-'
}

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

function cleanupAll(): void {
  clearHelixVisual(); clearMarkers(); hideImpactFlash()
  activeRailgun = null; railWorld = null; activeWeapon = null
  simRunning = false; ticksSinceFire = 0; impactTriggered = false
  beamAlpha = 0; helixAlpha = 0; frameCounter = 0
}

function fireRailgun(from?: WPos, to?: WPos): void {
  cleanupAll(); logEntries.length = 0
  const src = from ?? DEFAULT_SOURCE
  const tgt = to ?? DEFAULT_TARGET
  createMarkers(src, tgt)

  const rw = createStubWorld(); railWorld = rw

  const weapon: TestWeapon = {
    impactCount: 0,
    lastImpactPos: null,
    impact(_t: Target, wa: WarheadArgsStub): void {
      this.impactCount++
      this.lastImpactPos = wa.impactPosition
    },
  }
  activeWeapon = weapon

  const args: ProjectileArgs = {
    sourceActor: createStubActor(src), source: src, passiveTarget: tgt,
    guidedTarget: Target.fromPos(tgt),
    weapon: weapon as unknown as WeaponStub,
    facing: WAngle.fromFacing(64),
    inaccuracySource: WDist.Zero, random: createStubRandom(42), rangeModifiers: [],
  }

  const rg = RailgunFactory.create(args, {
    beamWidth: new WDist(configBeamWidth),
    duration: configDuration,
    helixRadius: new WDist(configHelixRadius),
    helixPitch: new WDist(configHelixPitch),
    helixThickness: new WDist(32),
    beamColor: configBeamColor,
    helixColor: configHelixColor,
    beamAlphaDeltaPerTick: configBeamAlphaDelta,
    helixAlphaDeltaPerTick: configHelixAlphaDelta,
    helixRadiusDeltaPerTick: 8,
    helixAngleDeltaPerTick: new WAngle(16),
    quantizationCount: 16,
    damageActorsInLine: false,
    blockable: false,
    zOffset: 0,
  })

  activeRailgun = rg; simRunning = true; ticksSinceFire = 0; impactTriggered = false

  addLog(0, `FIRED | beamColor=(${configBeamColor[0]},${configBeamColor[1]},${configBeamColor[2]}) helixColor=(${configHelixColor[0]},${configHelixColor[1]},${configHelixColor[2]})`)
  addLog(0, `alphaDelta: beam=${configBeamAlphaDelta}/t helix=${configHelixAlphaDelta}/t → fade in ${Math.ceil(255/Math.abs(configBeamAlphaDelta))}t`)
  addLog(0, `duration=${configDuration}t | helixRadius=${configHelixRadius}su pitch=${configHelixPitch}su`)

  // Initial visual
  updateHelixVisual(rg)
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const SIM_TICK_INTERVAL = 2
let frameCounter = 0

function simulateTick(): void {
  if (!simRunning || !activeRailgun || !railWorld) return

  if (activeRailgun.isDestroyed) {
    simRunning = false; clearHelixVisual()
    addLog(ticksSinceFire, `DESTROYED | impacts=${activeWeapon?.impactCount ?? 0}`)
    updateDiagnostics(); return
  }

  // Advance tick
  activeRailgun.tick(railWorld.world)
  railWorld.flushFrameEnd()
  ticksSinceFire++

  // Detect impact (tick 0 → tick 1 = impact happened on tick 0)
  if (!impactTriggered && activeWeapon!.impactCount > 0) {
    impactTriggered = true
    const impPos = activeWeapon!.lastImpactPos!
    const impV = wPosToVector3(impPos.X, impPos.Y, impPos.Z)
    triggerImpactFlash(impV)
    addLog(ticksSinceFire, `IMPACT at tick 0! | pos=(${impPos.X}, ${impPos.Y}, ${impPos.Z}) | impacts=${activeWeapon!.impactCount}`)
  }

  // Update alpha values
  beamAlpha = activeRailgun.beamAlpha
  helixAlpha = activeRailgun.helixAlpha

  // Update visuals
  updateHelixVisual(activeRailgun)
  updateImpactFlash(ticksSinceFire)

  // Log fading
  if (ticksSinceFire === 1) addLog(ticksSinceFire, `bα=${beamAlpha} hα=${helixAlpha}`)
  if (ticksSinceFire % 3 === 0 && (beamAlpha > 0 || helixAlpha > 0)) {
    addLog(ticksSinceFire, `bα=${beamAlpha} hα=${helixAlpha} | fading...`)
  }
  if (beamAlpha <= 0 && helixAlpha <= 0 && ticksSinceFire > 1) {
    const prevBothZero = (activeRailgun.beamAlpha + (configBeamAlphaDelta * (ticksSinceFire - 2))) <= 0
    if (!prevBothZero) addLog(ticksSinceFire, `TRAIL FULLY FADED | bα=0 hα=0`)
  }

  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  cleanupAll(); logEntries.length = 0
  renderLog(); updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  frameCounter++
  if (frameCounter >= SIM_TICK_INTERVAL && simRunning) { frameCounter = 0; simulateTick() }
  scene.render(); updateInfoBar()
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

let lastInfoTimeUpdate = 0
let cachedInfoTime = ''
let cachedFps = '0'
let fpsFrameCount = 0

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  // Cache FPS every 10 frames (m5 fix: avoid engine.getFps() per-frame overhead)
  if (++fpsFrameCount >= 10) {
    fpsFrameCount = 0
    cachedFps = String(Math.round(engine.getFps()))
  }
  document.getElementById('info-fps')!.textContent = cachedFps
  const now = Date.now()
  if (now - lastInfoTimeUpdate > 1000) { cachedInfoTime = new Date().toISOString(); lastInfoTimeUpdate = now }
  document.getElementById('info-time')!.textContent = cachedInfoTime
}

window.addEventListener('resize', () => { engine.resize() })
// Engine.dispose() recursively disposes all scene objects
window.addEventListener('beforeunload', () => { engine.dispose() })

// ---------------------------------------------------------------------------
// UI Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-fire')!.addEventListener('click', () => { fireRailgun() })
document.getElementById('btn-reset')!.addEventListener('click', () => { resetAll() })

document.getElementById('config-beamColor')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value.split(',').map(Number)
  configBeamColor = [v[0] ?? 128, v[1] ?? 255, v[2] ?? 255, 255]
})
document.getElementById('config-helixColor')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value.split(',').map(Number)
  configHelixColor = [v[0] ?? 128, v[1] ?? 255, v[2] ?? 255, 255]
})

// ---------------------------------------------------------------------------
// Test Harness — intentional global for Playwright programmatic verification.
// The `any` cast is necessary because __testHarness is not in the Window type.
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene, engine,

  fireRailgun(from?: { x: number; y: number; z: number }, to?: { x: number; y: number; z: number }): void {
    const wFrom = from ? new WPos(Math.round(from.x / WORLD_SCALE), Math.round(from.z / WORLD_SCALE), Math.round(from.y / HEIGHT_SCALE)) : undefined
    const wTo = to ? new WPos(Math.round(to.x / WORLD_SCALE), Math.round(to.z / WORLD_SCALE), Math.round(to.y / HEIGHT_SCALE)) : undefined
    fireRailgun(wFrom, wTo)
  },

  getProjectilePosition(): { x: number; y: number; z: number } | null {
    if (!activeRailgun || activeRailgun.isDestroyed) return null
    const p = activeRailgun.target
    return { x: p.X * WORLD_SCALE, y: p.Z * HEIGHT_SCALE, z: p.Y * WORLD_SCALE }
  },

  getTrailColor(): { beam: number[]; helix: number[] } {
    return {
      beam: [...configBeamColor],
      helix: [...configHelixColor],
    }
  },

  getTrailWidth(): number {
    return activeRailgun ? activeRailgun.info.beamWidth.length * WORLD_SCALE : 0
  },

  isImpacted(): boolean { return impactTriggered },

  getBeamAlpha(): number { return beamAlpha },
  getHelixAlpha(): number { return helixAlpha },

  getActiveRailgun(): Railgun | null { return activeRailgun },
  getImpacts(): number { return activeWeapon?.impactCount ?? 0 },
  getEventLog(): LogEntry[] { return [...logEntries] },

  reset: resetAll,
}
