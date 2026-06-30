/**
 * nuke-launch/main.ts -- NukeLaunch projectile visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/NukeLaunch.ts
 *
 * Verifies 3 flight phases visually:
 *   N1. Ascent — vertical climb with trail (linear lerp, WAngle.Zero)
 *   N2. Descent — diagonal descent toward target
 *   N3. Detonation — flash at detonationAltitude, peak→fade over 20 ticks
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
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import type { IGameActor, PlayerStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

import {
  NukeLaunch,
  NukeLaunchFactory,
  defaultNukeLaunchConfig,
  type NukeLaunchConfig,
} from '../../../../OpenRA.Mods.Common/Projectiles/NukeLaunch.js'
import type {
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

// ---------------------------------------------------------------------------
// Stubs
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
    get sharedRandom(): { next(): number; get last(): number } {
      let s = 12345
      return {
        next(): number { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s },
        get last(): number { return s },
      }
    },
    get frameNumber(): number { return 0 },
    get paused(): boolean { return false },
  } as unknown as GameWorldManager

  return { world, events, flushFrameEnd() {
    const actions = [...frameEndActions]; frameEndActions.length = 0
    for (const action of actions) action()
  }}
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.06, 0.10, 1)

const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2.3,
  Math.PI / 3.5,
  28,
  new Vector3(6, 2, 5),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 70
camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.9

// Ground
const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene)
ground.position.y = -0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.08, 0.11, 0.16)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.75
ground.material = gmat

// Grid
for (let i = -2; i <= 14; i++) {
  const l = MeshBuilder.CreateLines('gx', { points: [new Vector3(i, 0.005, -3), new Vector3(i, 0.005, 13)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = i % 5 === 0 ? 0.3 : 0.07
}
for (let j = -3; j <= 13; j++) {
  const l = MeshBuilder.CreateLines('gz', { points: [new Vector3(-2, 0.005, j), new Vector3(14, 0.005, j)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = j % 5 === 0 ? 0.3 : 0.07
}

// ---------------------------------------------------------------------------
// Scene Markers (MAJOR 3: shared materials pre-created, no per-fire allocation)
// ---------------------------------------------------------------------------

let sourceMarker: Mesh | null = null
let targetMarker: Mesh | null = null

/** Shared material for source marker (green) — reused across fire cycles. */
let sharedSrcMarkerMat: StandardMaterial | null = null
function getSrcMarkerMat(): StandardMaterial {
  if (!sharedSrcMarkerMat) {
    sharedSrcMarkerMat = new StandardMaterial('srcMarkerMat', scene)
    sharedSrcMarkerMat.diffuseColor = new Color3(0.2, 1, 0.3)
    sharedSrcMarkerMat.emissiveColor = new Color3(0.1, 0.5, 0.15)
    sharedSrcMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedSrcMarkerMat
}

/** Shared material for target marker (red) — reused across fire cycles. */
let sharedTgtMarkerMat: StandardMaterial | null = null
function getTgtMarkerMat(): StandardMaterial {
  if (!sharedTgtMarkerMat) {
    sharedTgtMarkerMat = new StandardMaterial('tgtMarkerMat', scene)
    sharedTgtMarkerMat.diffuseColor = new Color3(1, 0.25, 0.25)
    sharedTgtMarkerMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
    sharedTgtMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedTgtMarkerMat
}

function clearMarkers(): void {
  if (sourceMarker) { sourceMarker.dispose(); sourceMarker = null }
  if (targetMarker) { targetMarker.dispose(); targetMarker = null }
}

function createMarkers(launchPos: WPos, targetPos: WPos): void {
  clearMarkers()

  sourceMarker = MeshBuilder.CreateSphere('srcMarker', { diameter: 0.35 }, scene)
  sourceMarker.position = wPosToVector3(launchPos.X, launchPos.Y, launchPos.Z)
  sourceMarker.material = getSrcMarkerMat()

  targetMarker = MeshBuilder.CreateSphere('tgtMarker', { diameter: 0.35 }, scene)
  targetMarker.position = wPosToVector3(targetPos.X, targetPos.Y, targetPos.Z)
  targetMarker.material = getTgtMarkerMat()
}

// ---------------------------------------------------------------------------
// Nuke Missile Visual
// ---------------------------------------------------------------------------

let missileSphere: Mesh | null = null
let missileGlowMat: StandardMaterial | null = null

/** Pre-allocated mutable Color3 for glow updates (MAJOR 4: no per-frame allocation). */
const _glowPulseColor = new Color3()

function createMissileVisual(): void {
  if (missileSphere) return
  missileSphere = MeshBuilder.CreateSphere('nukeMissile', { diameter: 0.35 }, scene)
  missileGlowMat = new StandardMaterial('missileMat', scene)
  missileGlowMat.diffuseColor = new Color3(1, 0.9, 0.2)
  missileGlowMat.emissiveColor = new Color3(1, 0.5, 0.05)
  missileGlowMat.specularColor = new Color3(0, 0, 0)
  missileSphere.material = missileGlowMat
  missileSphere.setEnabled(false)
  missileSphere.renderingGroupId = 1
}

function updateMissileVisual(pos: WPos, phase: 'ascent' | 'descent'): void {
  if (!missileSphere) createMissileVisual()
  missileSphere!.setEnabled(true)
  missileSphere!.position = wPosToVector3(pos.X, pos.Y, pos.Z)

  // Emissive intensity increases as nuke approaches target
  const intensity = phase === 'descent' ? 0.6 + 0.4 * (1 - pos.Z / 6000) : 0.5
  if (missileGlowMat) {
    _glowPulseColor.set(intensity, intensity * 0.35, intensity * 0.05)
    missileGlowMat.emissiveColor = _glowPulseColor
  }
}

function hideMissileVisual(): void {
  if (missileSphere) missileSphere.setEnabled(false)
}

// ---------------------------------------------------------------------------
// Trail System
// ---------------------------------------------------------------------------

let trailDots: Mesh[] = []
let trailLine: LinesMesh | null = null
const trailPositions: Vector3[] = []

/** Shared trail dot material — emissive orange-yellow */
let trailDotMat: StandardMaterial | null = null
function getTrailDotMat(): StandardMaterial {
  if (!trailDotMat) {
    trailDotMat = new StandardMaterial('trailDot', scene)
    trailDotMat.diffuseColor = new Color3(1, 0.6, 0.1)
    trailDotMat.emissiveColor = new Color3(0.8, 0.3, 0.05)
    trailDotMat.specularColor = new Color3(0, 0, 0)
  }
  return trailDotMat
}

function clearTrail(): void {
  for (const dot of trailDots) dot.dispose()
  trailDots.length = 0
  if (trailLine) { trailLine.dispose(); trailLine = null }
  trailPositions.length = 0
}

function addTrailDot(pos: WPos): void {
  const v = wPosToVector3(pos.X, pos.Y, pos.Z)
  const dot = MeshBuilder.CreateSphere('trailDot', { diameter: 0.08 }, scene)
  dot.position = v
  dot.material = getTrailDotMat()
  dot.renderingGroupId = 1
  trailDots.push(dot)
  trailPositions.push(v)
}

function rebuildTrailLine(): void {
  if (trailPositions.length < 2) {
    if (trailLine) { trailLine.setEnabled(false) }
    return
  }
  if (!trailLine) {
    trailLine = MeshBuilder.CreateLines('trailPath', {
      points: trailPositions, updatable: true,
    }, scene)
    trailLine.color = new Color3(1, 0.7, 0.2)
    trailLine.alpha = 0.7
    trailLine.renderingGroupId = 1
  } else {
    trailLine = MeshBuilder.CreateLines('trailPath', {
      points: trailPositions, instance: trailLine,
    }, scene)
    trailLine.setEnabled(true)
    trailLine.alpha = 0.7
  }
}

// ---------------------------------------------------------------------------
// Flash Effect (detonation)
// ---------------------------------------------------------------------------

let flashOverlay: HTMLDivElement | null = null
let flashSphere: Mesh | null = null
let flashSphereMat: StandardMaterial | null = null

function createFlashOverlay(): void {
  if (flashOverlay) return
  flashOverlay = document.createElement('div')
  flashOverlay.id = 'nuke-flash'
  flashOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 1000;
    background: white; opacity: 0;
    transition: none;
  `
  document.body.appendChild(flashOverlay)
}

function setFlashIntensity(intensity: number): void {
  if (!flashOverlay) createFlashOverlay()
  flashOverlay!.style.opacity = String(Math.max(0, Math.min(1, intensity)))
}

function triggerFlash(detonationPos: Vector3): void {
  // Create expanding blast sphere
  if (!flashSphere) {
    flashSphere = MeshBuilder.CreateSphere('blastSphere', { diameter: 0.5 }, scene)
    flashSphereMat = new StandardMaterial('blastMat', scene)
    flashSphereMat.diffuseColor = new Color3(1, 1, 1)
    flashSphereMat.emissiveColor = new Color3(2, 2, 2)
    flashSphereMat.specularColor = new Color3(0, 0, 0)
    flashSphereMat.alpha = 1
    flashSphere.material = flashSphereMat
    flashSphere.renderingGroupId = 2
  }
  flashSphere.setEnabled(true)
  flashSphere.position = detonationPos.clone()
  flashSphere.scaling.setAll(0.5)

  setFlashIntensity(1)
}

function updateFlashVisual(ticksSinceDet: number): number {
  // ticksSinceDet: 0 = detonation, 1+ = post-detonation
  let intensity: number

  if (ticksSinceDet <= 3) {
    // Peak phase: 100% for first 3 ticks
    intensity = 1.0
    // Expand blast sphere
    if (flashSphere) {
      const scale = 0.5 + (ticksSinceDet / 3) * 4.5  // 0.5 → 5.0 diameter
      flashSphere.scaling.setAll(scale)
      if (flashSphereMat) flashSphereMat.alpha = 1.0
    }
  } else {
    // Fade phase: linear 1→0 over 20 ticks
    const fadeT = Math.min(1, (ticksSinceDet - 3) / 20)
    intensity = 1.0 - fadeT
    if (flashSphere) {
      if (flashSphereMat) flashSphereMat.alpha = intensity
      const scale = 5.0 + fadeT * 10.0  // 5→15 diameter
      flashSphere.scaling.setAll(scale)
    }
  }

  setFlashIntensity(intensity)
  return intensity
}

function hideFlash(): void {
  setFlashIntensity(0)
  if (flashSphere) flashSphere.setEnabled(false)
}

// ---------------------------------------------------------------------------
// Nuke State
// ---------------------------------------------------------------------------

interface TestWeapon extends WeaponStub {
  impactCount: number
  lastImpactPos: WPos | null
}

let activeNuke: NukeLaunch | null = null
let nukeWorld: ReturnType<typeof createStubWorld> | null = null
let activeWeapon: TestWeapon | null = null
let simRunning = false
let nukeDisposed = false
let detonationTriggered = false
let ticksSinceFire = 0
let ticksSinceDetonation = 0
let currentPhase: 'ascent' | 'descent' | 'detonation' | 'done' = 'done'
let currentFlashIntensity = 0

// Default config (mutable via UI sliders)
let configVelocity = 200
let configImpactDelay = 60
let configDetonationAlt = 1024
let configLaunchDelay = 0

// Computed: turn = Math.trunc(impactDelay / 2)
function getTurn(): number { return Math.trunc(configImpactDelay / 2) }

// Fixed positions for default launch
const DEFAULT_LAUNCH = new WPos(2048, 5120, 0)
const DEFAULT_TARGET = new WPos(10240, 5120, 0)

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
  const recent = logEntries.slice(-40)
  el.innerHTML = recent.length === 0
    ? '<div class="log-row log-info">Ready. Press Launch Nuke to fire.</div>'
    : recent.map(e =>
      `<div class="log-row">
        <span class="log-tick">T${e.tick.toString().padStart(3, '0')}</span>
        <span class="log-phase">[${e.phase}]</span> ${e.text}
      </div>`
    ).join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function updateDiagnostics(): void {
  document.getElementById('diag-phase')!.textContent = currentPhase
  document.getElementById('diag-launched')!.textContent = activeNuke?.isLaunched ? 'YES' : 'no'
  document.getElementById('diag-detonated')!.textContent = activeNuke?.detonated ? 'YES' : 'no'
  document.getElementById('diag-flash')!.textContent = currentFlashIntensity.toFixed(3)
  document.getElementById('diag-trail')!.textContent = `${trailDots.length} dots`

  if (activeNuke) {
    const alt = activeNuke.pos.Z * HEIGHT_SCALE  // world units
    document.getElementById('diag-altitude')!.textContent =
      `${activeNuke.pos.Z} su (${alt.toFixed(2)} wu)`
    document.getElementById('diag-pos')!.textContent =
      `(${activeNuke.pos.X}, ${activeNuke.pos.Y}, ${activeNuke.pos.Z})`
    document.getElementById('diag-ticks')!.textContent = String(activeNuke.ticks)
    document.getElementById('diag-turn')!.textContent =
      `${activeNuke.turn} (T${ticksSinceFire})`
  } else {
    document.getElementById('diag-altitude')!.textContent = '-'
    document.getElementById('diag-pos')!.textContent = '-'
    document.getElementById('diag-ticks')!.textContent = '-'
    document.getElementById('diag-turn')!.textContent = '-'
  }

  document.getElementById('diag-config')!.textContent =
    `v=${configVelocity}su/t delay=${configImpactDelay}t detAlt=${configDetonationAlt}su`
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

function cleanupAll(): void {
  clearTrail()
  clearMarkers()
  hideMissileVisual()
  hideFlash()
  activeNuke = null
  nukeWorld = null
  activeWeapon = null
  simRunning = false
  nukeDisposed = false
  detonationTriggered = false
  ticksSinceFire = 0
  ticksSinceDetonation = 0
  currentPhase = 'done'
  currentFlashIntensity = 0
  frameCounter = 0
}

function launchNuke(targetPos?: WPos): void {
  cleanupAll()
  logEntries.length = 0

  const tp = targetPos ?? DEFAULT_TARGET
  const lp = DEFAULT_LAUNCH

  // Create stub world
  const nw = createStubWorld()
  nukeWorld = nw

  // Create weapon stub
  const weapon: TestWeapon = {
    impactCount: 0,
    lastImpactPos: null,
    impact(_target: unknown, warheadArgs: WarheadArgsStub): void {
      this.impactCount++
      this.lastImpactPos = warheadArgs.impactPosition
    },
  }
  activeWeapon = weapon

  // Create markers
  createMarkers(lp, tp)

  // Build config
  const nukeConfig: NukeLaunchConfig = {
    ...defaultNukeLaunchConfig(),
    firedBy: { playerName: 'TestPlayer' } as PlayerStub,
    launchPos: lp,
    targetPos: tp,
    detonationAltitude: new WDist(configDetonationAlt),
    removeOnDetonation: true,
    velocity: new WDist(configVelocity),
    launchDelay: configLaunchDelay,
    impactDelay: configImpactDelay,
    skipAscent: false,
    trailImage: null,  // no trail sprites for visual test
    trailSequences: [],
    trailPalette: 'effect',
    trailUsePlayerPalette: false,
    trailDelay: 0,
    trailInterval: 2,
    weapon: weapon as unknown as WeaponStub,
    weaponPalette: 'effect',
    upSequence: 'up',
    downSequence: 'down',
    image: null,
  }

  const nuke = NukeLaunchFactory.create(nukeConfig)
  activeNuke = nuke
  simRunning = true
  nukeDisposed = false
  detonationTriggered = false
  ticksSinceFire = 0
  ticksSinceDetonation = 0
  currentPhase = nuke.config.skipAscent ? 'descent' : 'ascent'
  currentFlashIntensity = 0

  const turn = nuke.turn
  const maxAlt = nuke.config.velocity.length * turn
  addLog(0, currentPhase,
    `LAUNCHED | pos=(${lp.X},${lp.Y},${lp.Z}) → target=(${tp.X},${tp.Y},${tp.Z})`)
  addLog(0, currentPhase,
    `turn=${turn}t | maxAlt=${maxAlt}su | impactDelay=${configImpactDelay}t | detAlt=${configDetonationAlt}su`)
  addLog(0, currentPhase,
    `velocity=${configVelocity}su/t | descendSource=(${nuke.descendSource.X},${nuke.descendSource.Y},${nuke.descendSource.Z})`)

  // Create missile visual
  createMissileVisual()
  addTrailDot(nuke.pos)
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const SIM_TICK_INTERVAL = 2  // 1 logic tick every N render frames
let frameCounter = 0

function simulateTick(): void {
  if (!simRunning || !activeNuke || !nukeWorld) return

  // If nuke was disposed by removal
  if (activeNuke.isDestroyed && !nukeDisposed) {
    nukeDisposed = true
    simRunning = false
    currentPhase = 'done'
    rebuildTrailLine()
    addLog(ticksSinceFire, 'done', `EFFECT REMOVED — impacts=${activeWeapon?.impactCount ?? 0}`)
    updateDiagnostics()
    return
  }

  // Post-detonation: manage flash fade
  if (detonationTriggered) {
    ticksSinceDetonation++
    const intensity = updateFlashVisual(ticksSinceDetonation)
    currentFlashIntensity = intensity

    if (ticksSinceDetonation > 23) {
      // Flash fully faded, hide
      hideFlash()
      simRunning = false
      currentPhase = 'done'
      currentFlashIntensity = 0
      addLog(ticksSinceFire, 'done', `FLASH FADED — test complete`)
    }
    updateDiagnostics()
    return
  }

  // Advance one game tick
  const prevPhase = currentPhase
  const turn = activeNuke.turn
  const prevDetonated = activeNuke.detonated

  activeNuke.tick(nukeWorld.world)
  nukeWorld.flushFrameEnd()
  ticksSinceFire++

  // Detect phase changes
  if (!activeNuke.detonated) {
    currentPhase = activeNuke.ticks >= turn ? 'descent' : 'ascent'
  }

  if (currentPhase !== prevPhase && !activeNuke.detonated) {
    const alt = activeNuke.pos.Z
    addLog(ticksSinceFire, currentPhase,
      `Phase: ${prevPhase} → ${currentPhase} | alt=${alt}su (${(alt * HEIGHT_SCALE).toFixed(2)}wu)`)
  }

  // Detect detonation
  if (!prevDetonated && activeNuke.detonated) {
    detonationTriggered = true
    ticksSinceDetonation = 0
    currentPhase = 'detonation'
    const detAlt = activeNuke.pos.Z * HEIGHT_SCALE
    addLog(ticksSinceFire, 'detonation',
      `DETONATED! | pos=(${activeNuke.pos.X},${activeNuke.pos.Y},${activeNuke.pos.Z}) | alt=${detAlt.toFixed(2)}wu`)
    addLog(ticksSinceFire, 'detonation',
      `Impact count=${activeWeapon?.impactCount ?? 0} | flash peak=100% for 3t, fade=20t`)

    const detPos = wPosToVector3(activeNuke.pos.X, activeNuke.pos.Y, activeNuke.pos.Z)
    triggerFlash(detPos)
    currentFlashIntensity = 1  // BLOCKER: sync JS variable with CSS overlay opacity
    hideMissileVisual()
    rebuildTrailLine()
    updateDiagnostics()
    return
  }

  // Update missile visual
  if (!activeNuke.detonated) {
    updateMissileVisual(activeNuke.pos, currentPhase as 'ascent' | 'descent')
  }

  // Add trail dot every N ticks
  const trailInterval = 3
  if (ticksSinceFire % trailInterval === 0 && !activeNuke.detonated) {
    addTrailDot(activeNuke.pos)
    if (trailDots.length % 6 === 0) rebuildTrailLine()
  }

  // Log status every 10 ticks
  if (ticksSinceFire % 10 === 0 && !activeNuke.detonated) {
    addLog(ticksSinceFire, currentPhase,
      `alt=${activeNuke.pos.Z}su | ticks=${activeNuke.ticks}/${configImpactDelay} | progress=${(activeNuke.fractionComplete * 100).toFixed(0)}%`)
  }

  // Check if flight exceeded impactDelay without detonating (shouldn't happen)
  if (ticksSinceFire > configImpactDelay + 5 && !activeNuke.detonated) {
    addLog(ticksSinceFire, 'error', `WARNING: exceeded impactDelay+5 without detonation`)
  }

  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  cleanupAll()
  logEntries.length = 0
  currentPhase = 'done'
  renderLog()
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  frameCounter++
  if (frameCounter >= SIM_TICK_INTERVAL && simRunning) {
    frameCounter = 0
    simulateTick()
  }

  // Animate missile glow pulsing (MAJOR 4: mutate pre-allocated Color3)
  if (missileGlowMat && missileSphere?.isEnabled()) {
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.01)
    _glowPulseColor.set(pulse, pulse * 0.4, pulse * 0.08)
    missileGlowMat.emissiveColor = _glowPulseColor
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
  if (now - lastInfoTimeUpdate > 1000) {
    cachedInfoTime = new Date().toISOString()
    lastInfoTimeUpdate = now
  }
  document.getElementById('info-time')!.textContent = cachedInfoTime
}

/** Stored handler references for potential cleanup on page unload. */
const resizeHandler = () => { engine.resize() }
window.addEventListener('resize', resizeHandler)
window.addEventListener('beforeunload', () => { engine.dispose() })

// ---------------------------------------------------------------------------
// UI Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-launch')!.addEventListener('click', () => {
  launchNuke()
})

document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetAll()
})

// Config sliders
const velSlider = document.getElementById('config-velocity') as HTMLInputElement
velSlider.addEventListener('input', () => {
  configVelocity = parseInt(velSlider.value)
  document.getElementById('val-velocity')!.textContent = `${configVelocity} su/t`
  document.getElementById('val-maxalt')!.textContent =
    `${configVelocity * getTurn()} su`
})

const delaySlider = document.getElementById('config-delay') as HTMLInputElement
delaySlider.addEventListener('input', () => {
  configImpactDelay = parseInt(delaySlider.value)
  document.getElementById('val-delay')!.textContent = `${configImpactDelay} t`
  document.getElementById('val-turn')!.textContent = `${getTurn()} t`
  document.getElementById('val-maxalt')!.textContent =
    `${configVelocity * getTurn()} su`
})

const detAltSlider = document.getElementById('config-detalt') as HTMLInputElement
detAltSlider.addEventListener('input', () => {
  configDetonationAlt = parseInt(detAltSlider.value)
  document.getElementById('val-detalt')!.textContent = `${configDetonationAlt} su`
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

// Test harness — intentional global for Playwright programmatic verification.
// The `any` cast is necessary because __testHarness is not in the Window type.
;(window as any).__testHarness = {
  scene,
  engine,

  /** Launch nuke at a target position (Babylon world coords). */
  launchNuke(targetPos?: { x: number; y: number; z: number }): void {
    if (targetPos) {
      const wp = vector3ToWPos(new Vector3(targetPos.x, targetPos.y, targetPos.z))
      launchNuke(wp)
    } else {
      launchNuke()
    }
  },

  /** Get current missile altitude in world units (Vector3 y = WPos.Z/512). */
  getMissileAltitude(): number {
    if (!activeNuke || activeNuke.detonated) return 0
    return activeNuke.pos.Z * HEIGHT_SCALE
  },

  /** Get current flight phase. */
  getFlightPhase(): 'ascent' | 'descent' | 'detonation' | 'done' {
    return currentPhase
  },

  /** Get current flash screen intensity (0–1). */
  getFlashIntensity(): number {
    return currentFlashIntensity
  },

  /** Get all trail positions as Vector3 clones. */
  getTrailPositions(): { x: number; y: number; z: number }[] {
    return trailPositions.map(p => ({ x: p.x, y: p.y, z: p.z }))
  },

  /** Get the active NukeLaunch instance. */
  getActiveNuke(): NukeLaunch | null {
    return activeNuke
  },

  /** Get nuke world position in Babylon coords. */
  getNukePosition(): { x: number; y: number; z: number } | null {
    if (!activeNuke) return null
    return {
      x: activeNuke.pos.X * WORLD_SCALE,
      y: activeNuke.pos.Z * HEIGHT_SCALE,
      z: activeNuke.pos.Y * WORLD_SCALE,
    }
  },

  /** Get impact count. */
  getImpacts(): number {
    return activeWeapon?.impactCount ?? 0
  },

  /** Get event log. */
  getEventLog(): LogEntry[] {
    return [...logEntries]
  },

  /** Get current config values. */
  getConfig(): { velocity: number; impactDelay: number; detonationAlt: number; turn: number } {
    return {
      velocity: configVelocity,
      impactDelay: configImpactDelay,
      detonationAlt: configDetonationAlt,
      turn: getTurn(),
    }
  },

  /** Reset the scene. */
  reset: resetAll,
}
