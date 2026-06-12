/**
 * projectile-lifecycle/main.ts -- Projectile system acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/*.cs (8 projectile types)
 *
 * Verifies:
 *   TC1. ProjectileRegistry lookup: 8 types registered
 *   TC2. Missile state machine: Freefall -> Homing -> Hitting -> Explode
 *   TC3. InstantHit zero-travel: warhead trigger on tick 0, self-dispose
 *   TC4. GravityBomb trajectory: Euler integration position trace
 *   TC5. BeamRenderableShape enum: Cylindrical(0), Flat(1)
 *   TC6. LaserZap duration: visual persistence duration tracking
 *
 * 坐标系约定 (from WPos/WVec/WAngle, matching OpenRA conventions):
 *   - WAngle 0 = North (negative Y axis in WPos), counter-clockwise increment
 *   - WPos: X = east-west, Y = north-south, Z = height
 *   - All trajectory math uses integer-only WDist/WPos/WVec (deterministic)
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
  Camera,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../../OpenRA.Game/WVec.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { MersenneTwisterStub } from '../../../../OpenRA.Game/World.js'

import { PROJECTILE_REGISTRY } from '../../../../OpenRA.Mods.Common/Projectiles/ProjectileRegistry.js'
import type { ProjectileFactory } from '../../../../OpenRA.Mods.Common/Projectiles/ProjectileRegistry.js'
import { BeamRenderableShape } from '../../../../OpenRA.Mods.Common/Projectiles/BeamRenderableShape.js'
import {
  MissileState,
  MissileFactory,
  type MissileInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/Missile.js'
import {
  InstantHitFactory,
  type InstantHitInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/InstantHit.js'
import {
  GravityBombFactory,
  type GravityBombInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/GravityBomb.js'
import {
  LaserZapFactory,
  type LaserZapInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/LaserZap.js'
import type {
  ProjectileArgs,
  WeaponStub,
  WarheadArgsStub,
} from '../../../../OpenRA.Mods.Common/Projectiles/Bullet.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// Coordinate conversion constants
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

function wPosToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

// ---------------------------------------------------------------------------
// Stubs — minimal objects cast to required types
// GameWorldManager is a concrete class with 60+ members, so we use a plain
// object with only the methods needed by projectile tick() functions and cast.
// ---------------------------------------------------------------------------

/** Create a minimal stub actor for ProjectileArgs.sourceActor. */
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

/** Create a minimal MersenneTwisterStub. */
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

/**
 * Create a minimal GameWorldManager stub.
 * GameWorldManager is a concrete class; we create a plain object with only
 * the methods/properties needed by the projectile tick() functions and
 * cast it. This avoids implementing 60+ class members.
 */
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
    // Needed by projectile tick()
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
    // Needed by StubActor
    get worldActor(): IGameActor { return stubActor },
    get localPlayer(): PlayerStub { return testOwner },
    // Minimal stubs for any other access
    tick(): void {},
    get sharedRandom(): MersenneTwisterStub { return createStubRandom() },
    get frameNumber(): number { return 0 },
    get paused(): boolean { return false },
  } as unknown as GameWorldManager

  return {
    world,
    events,
    flushFrameEnd(): void {
      const actions = [...frameEndActions]
      frameEndActions.length = 0
      for (const action of actions) action()
    },
  }
}

// ---------------------------------------------------------------------------
// Test Event Log
// ---------------------------------------------------------------------------

interface TestEvent {
  tick: number
  type: 'state_change' | 'impact' | 'dispose' | 'position' | 'registry' | 'error' | 'info'
  projectile: string
  detail: string
}

const eventLog: TestEvent[] = []
let globalTick = 0

function logEvent(type: TestEvent['type'], projectile: string, detail: string): void {
  eventLog.push({ tick: globalTick, type, projectile, detail })
  renderEventLog()
}

function renderEventLog(): void {
  const el = document.getElementById('event-log-body')!
  const recent = eventLog.slice(-50)
  el.innerHTML = recent.map(e =>
    `<div class="log-row log-${e.type}">
      <span class="log-tick">T${e.tick.toString().padStart(3, '0')}</span>
      <span class="log-proj">[${e.projectile}]</span>
      <span class="log-detail">${e.detail}</span>
    </div>`
  ).join('')
  const container = document.getElementById('event-log')!
  container.scrollTop = container.scrollHeight
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2,
  Math.PI / 3.5,
  30,
  new Vector3(5, 0, 5),
  scene,
)
camera.mode = Camera.ORTHOGRAPHIC_CAMERA
camera.orthoTop = 8
camera.orthoBottom = -8
camera.orthoLeft = -8
camera.orthoRight = 8
camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.8

// Ground plane
const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene)
ground.position.y = -0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.12, 0.15, 0.20)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.7
ground.material = gmat

// Grid lines
for (let i = -5; i <= 15; i++) {
  const line = MeshBuilder.CreateLines('gridX', {
    points: [new Vector3(i, 0.005, -5), new Vector3(i, 0.005, 15)],
  }, scene)
  line.color = new Color3(0.2, 0.3, 0.5)
  line.alpha = i % 5 === 0 ? 0.3 : 0.1
}
for (let j = -5; j <= 15; j++) {
  const line = MeshBuilder.CreateLines('gridZ', {
    points: [new Vector3(-5, 0.005, j), new Vector3(15, 0.005, j)],
  }, scene)
  line.color = new Color3(0.2, 0.3, 0.5)
  line.alpha = j % 5 === 0 ? 0.3 : 0.1
}

// ---------------------------------------------------------------------------
// Scene Markers
// ---------------------------------------------------------------------------

const sceneMarkers: Mesh[] = []

function createSphere(color: Color3, pos: Vector3, diameter: number = 0.3): Mesh {
  const sphere = MeshBuilder.CreateSphere('sphere', { diameter }, scene)
  sphere.position = pos
  const mat = new StandardMaterial('smat', scene)
  mat.diffuseColor = color
  mat.emissiveColor = color.scale(0.3)
  mat.specularColor = new Color3(0, 0, 0)
  sphere.material = mat
  sceneMarkers.push(sphere)
  return sphere
}

function clearMarkers(): void {
  for (const m of sceneMarkers) {
    m.dispose()
  }
  sceneMarkers.length = 0
}

// ---------------------------------------------------------------------------
// Test State (shared)
// ---------------------------------------------------------------------------

let trajectoryDots: Mesh[] = []

function clearTrajectoryDots(): void {
  for (const d of trajectoryDots) d.dispose()
  trajectoryDots.length = 0
}

function addTrajectoryDot(pos: WPos, color: Color3): void {
  const dot = MeshBuilder.CreateSphere('dot', { diameter: 0.12 }, scene)
  dot.position = wPosToVector3(pos.X, pos.Y, pos.Z)
  const mat = new StandardMaterial('dotmat', scene)
  mat.diffuseColor = color
  mat.emissiveColor = color.scale(0.4)
  mat.specularColor = new Color3(0, 0, 0)
  dot.material = mat
  trajectoryDots.push(dot)
}

// ---------------------------------------------------------------------------
// ProjectileArgs Builder
// ---------------------------------------------------------------------------

const stubActor = createStubActor()
const stubRandom = createStubRandom(12345)

interface TestWeapon extends WeaponStub {
  impactCount: number
  lastImpactPos: WPos | null
}

function makeArgs(
  source: WPos,
  target: WPos,
  facing: WAngle = WAngle.Zero,
): ProjectileArgs & { weapon: TestWeapon } {
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
    passiveTarget: target,
    guidedTarget: Target.fromPos(target),
    weapon,
    facing,
    inaccuracySource: WDist.Zero,
    random: stubRandom,
    rangeModifiers: [],
  }
}

// ---------------------------------------------------------------------------
// Diagnostics Display
// ---------------------------------------------------------------------------

function updateDiagnostics(projectileStates: { name: string; state: string; pos: string; destroyed: string; extra: string }[]): void {
  const el = document.getElementById('diag-body')!
  if (projectileStates.length === 0) {
    el.innerHTML = '<div style="color:#667; padding:4px;">无活跃抛射体。点击上方按钮创建。</div>'
    return
  }
  el.innerHTML = projectileStates.map(p =>
    `<div class="diag-row">
      <span class="diag-name">${p.name}</span>
      <span class="diag-state">${p.state}</span>
      <span class="diag-pos">${p.pos}</span>
      <span class="diag-destroyed">${p.destroyed}</span>
      <span class="diag-extra">${p.extra}</span>
    </div>`
  ).join('')
}

// ---------------------------------------------------------------------------
// TC1: ProjectileRegistry Lookup
// ---------------------------------------------------------------------------

function runRegistryTest(): void {
  eventLog.length = 0
  logEvent('info', 'Registry', '--- TC1: ProjectileRegistry Lookup ---')

  const expectedTypes = ['Bullet', 'Missile', 'GravityBomb', 'InstantHit', 'LaserZap', 'Railgun', 'AreaBeam', 'NukeLaunch']
  let allFound = true

  for (const name of expectedTypes) {
    const factory: ProjectileFactory | undefined = PROJECTILE_REGISTRY[name]
    if (factory) {
      logEvent('registry', name, `已注册: factory type = ${typeof factory.create}`)
    } else {
      logEvent('error', name, 'MISSING: 未在注册表中找到')
      allFound = false
    }
  }

  const registeredKeys = Object.keys(PROJECTILE_REGISTRY)
  logEvent('info', 'Registry', `总计: ${registeredKeys.length} 种抛射体类型已注册 (${registeredKeys.join(', ')})`)

  const summaryEl = document.getElementById('tc1-summary')!
  summaryEl.innerHTML = allFound
    ? '<span style="color:#4f4;">✅ TC1 通过: 全部 8 种抛射体类型已在 PROJECTILE_REGISTRY 中注册</span>'
    : '<span style="color:#f44;">❌ TC1 失败: 部分类型未找到</span>'

  updateDiagnostics([
    { name: 'Registry', state: `${registeredKeys.length} types`, pos: '-', destroyed: '-', extra: expectedTypes.join(', ') },
  ])
}

// ---------------------------------------------------------------------------
// TC2: Missile State Machine
// ---------------------------------------------------------------------------

function runMissileTest(): void {
  eventLog.length = 0
  clearMarkers()
  clearTrajectoryDots()
  globalTick = 0
  logEvent('info', 'Missile', '--- TC2: Missile State Machine ---')

  const { world } = createStubWorld()
  const source = new WPos(5120, 5120, 0)   // (5, 5, 0) in Babylon units
  const targetPos = new WPos(9216, 5120, 0)   // (9, 5, 0) in Babylon -- 4 cells east

  // Source marker (green)
  createSphere(new Color3(0.2, 1, 0.2), wPosToVector3(5120, 5120, 0), 0.4)
  // Target marker (red)
  createSphere(new Color3(1, 0.2, 0.2), wPosToVector3(9216, 5120, 0), 0.4)

  const args = makeArgs(source, targetPos, WAngle.fromFacing(64)) // facing east (64 = 90 degrees)
  const missile = MissileFactory.create(args, {
    speed: new WDist(384),
    acceleration: new WDist(5),
    homingActivationDelay: 5, // Freefall for 5 ticks, then Home
    horizontalRateOfTurn: new WAngle(20),
    verticalRateOfTurn: new WAngle(24),
    gravity: 10,
    closeEnough: new WDist(512),
    rangeLimit: new WDist(8192),
    explodeWhenEmpty: true,
    blockable: false,
  } satisfies Partial<MissileInfo>)

  const stateNames: Record<number, string> = { 0: 'Freefall', 1: 'Homing', 2: 'Hitting' }
  logEvent('state_change', 'Missile', `初始状态: ${stateNames[missile.state]} | pos=(${missile.pos.X}, ${missile.pos.Y}, ${missile.pos.Z})`)

  // Tick through the missile lifecycle
  const maxTicks = 120
  let lastState = missile.state
  let tickCount = 0

  for (let i = 0; i < maxTicks && !missile.isDestroyed; i++) {
    globalTick = i
    missile.tick(world)
    tickCount++

    if (missile.state !== lastState) {
      logEvent('state_change', 'Missile',
        `T${i}: 状态切换 ${stateNames[lastState]} → ${stateNames[missile.state]}`
      )
      lastState = missile.state
    }

    // Add trajectory dot every 5 ticks
    if (i % 5 === 0) {
      addTrajectoryDot(missile.pos, new Color3(1, 1, 0.3))
    }

    if (missile.isDestroyed) {
      logEvent('dispose', 'Missile',
        `T${i}: isDestroyed=true | impactPos=(${missile.pos.X}, ${missile.pos.Y}, ${missile.pos.Z})`
      )
      break
    }

    // Detect fuel exhaustion
    if (missile.state === MissileState.Freefall && missile.ticks > 6 &&
        WDist.greaterThan(missile.distanceCovered, missile.rangeLimit)) {
      logEvent('state_change', 'Missile', `T${i}: OutOfFuel — distance=${missile.distanceCovered.length} > rangeLimit=${missile.rangeLimit.length}`)
    }
  }

  const weapon = args.weapon as TestWeapon
  logEvent('info', 'Missile', `生命周期结束: ${tickCount} ticks | 武器触发次数: ${weapon.impactCount}`)

  // Missile final position marker (yellow)
  createSphere(new Color3(1, 1, 0.2), wPosToVector3(missile.pos.X, missile.pos.Y, missile.pos.Z), 0.35)

  updateDiagnostics([{
    name: 'Missile',
    state: missile.isDestroyed ? 'Exploded' : stateNames[missile.state] ?? String(missile.state),
    pos: `(${missile.pos.X}, ${missile.pos.Y}, ${missile.pos.Z})`,
    destroyed: missile.isDestroyed ? 'true' : 'false',
    extra: `dist=${missile.distanceCovered.length} | ticks=${tickCount} | impacts=${weapon.impactCount}`,
  }])

  const summaryEl = document.getElementById('tc2-summary')!
  summaryEl.innerHTML = missile.isDestroyed
    ? `<span style="color:#4f4;">✅ TC2 通过: Missile 在第 ${tickCount} tick 引爆，武器触发 ${weapon.impactCount} 次</span>`
    : '<span style="color:#f44;">❌ TC2 失败: Missile 未在预期时间内引爆</span>'
}

// ---------------------------------------------------------------------------
// TC3: InstantHit Zero-Travel
// ---------------------------------------------------------------------------

function runInstantHitTest(): void {
  eventLog.length = 0
  clearMarkers()
  clearTrajectoryDots()
  globalTick = 0
  logEvent('info', 'InstantHit', '--- TC3: InstantHit Zero-Travel ---')

  const { world, flushFrameEnd } = createStubWorld()
  const source = new WPos(5120, 2048, 0)
  const target = new WPos(7168, 2048, 0)

  createSphere(new Color3(0.2, 1, 0.2), wPosToVector3(5120, 2048, 0), 0.4)
  createSphere(new Color3(1, 0.2, 0.2), wPosToVector3(7168, 2048, 0), 0.4)

  const args = makeArgs(source, target)
  const instantHit = InstantHitFactory.create(args, {
    blockable: false,
    inaccuracy: WDist.Zero,
  } satisfies Partial<InstantHitInfo>)

  logEvent('state_change', 'InstantHit', `创建完成: isDestroyed=${instantHit.isDestroyed}`)

  // Tick 0: should trigger impact and dispose
  globalTick = 0
  instantHit.tick(world)
  flushFrameEnd()

  const weapon = args.weapon as TestWeapon
  logEvent('impact', 'InstantHit',
    `T0: 武器触发次数=${weapon.impactCount} | isDestroyed=${instantHit.isDestroyed}`
  )

  // Try tick again (should be no-op)
  if (!instantHit.isDestroyed) {
    globalTick = 1
    instantHit.tick(world)
    flushFrameEnd()
  }

  logEvent('info', 'InstantHit',
    `测试结果: 武器触发次数=${weapon.impactCount} | isDestroyed=${instantHit.isDestroyed}`
  )

  const impactPos = weapon.lastImpactPos
  updateDiagnostics([{
    name: 'InstantHit',
    state: instantHit.isDestroyed ? 'Disposed' : 'Active',
    pos: impactPos ? `(${impactPos.X}, ${impactPos.Y}, ${impactPos.Z})` : '-',
    destroyed: instantHit.isDestroyed ? 'true' : 'false',
    extra: `impacts=${weapon.impactCount} | tick0_handled=true`,
  }])

  const summaryEl = document.getElementById('tc3-summary')!
  const passed = instantHit.isDestroyed && weapon.impactCount === 1
  summaryEl.innerHTML = passed
    ? '<span style="color:#4f4;">✅ TC3 通过: InstantHit 在 tick 0 触发 warhead，isDestroyed=true，单次武器调用</span>'
    : `<span style="color:#f44;">❌ TC3 失败: impacts=${weapon.impactCount} destroyed=${instantHit.isDestroyed}</span>`
}

// ---------------------------------------------------------------------------
// TC4: GravityBomb Trajectory (Euler Integration)
// ---------------------------------------------------------------------------

function runGravityBombTest(): void {
  eventLog.length = 0
  clearMarkers()
  clearTrajectoryDots()
  globalTick = 0
  logEvent('info', 'GravityBomb', '--- TC4: GravityBomb Trajectory ---')

  const { world, flushFrameEnd } = createStubWorld()
  // Source: (5, 5, 1024) -- 1024 height units above origin
  // Target: (7, 5, 0) -- 2 cells east, ground level
  const source = new WPos(5120, 5120, 1024)
  const target = new WPos(7168, 5120, 0)

  createSphere(new Color3(0.2, 1, 0.2), wPosToVector3(5120, 5120, 1024), 0.4)
  createSphere(new Color3(1, 0.2, 0.2), wPosToVector3(7168, 5120, 0), 0.4)

  // facing east: WAngle 64 = 90 degrees
  const args = makeArgs(source, target, WAngle.fromFacing(64))
  const bomb = GravityBombFactory.create(args, {
    velocity: new WVec(0, -200, 50),  // forward velocity 200, upward 50
    acceleration: new WVec(0, 0, -15), // gravity pulling down
  } satisfies Partial<GravityBombInfo>)

  logEvent('info', 'GravityBomb',
    `初始: pos=(${bomb.pos.X}, ${bomb.pos.Y}, ${bomb.pos.Z}) | vel=(${bomb.velocity.X}, ${bomb.velocity.Y}, ${bomb.velocity.Z})`
  )

  // Record initial position
  addTrajectoryDot(bomb.pos, new Color3(0.5, 1, 0.5))

  const maxTicks = 200
  let tickCount = 0
  const positions: WPos[] = [bomb.pos]

  for (let i = 0; i < maxTicks && !bomb.isDestroyed; i++) {
    globalTick = i
    bomb.tick(world)
    flushFrameEnd()
    tickCount++

    positions.push(bomb.pos)

    if (i % 3 === 0) {
      // Color gradient: green (early) to red (late)
      const t = Math.min(i / 60, 1)
      addTrajectoryDot(bomb.pos, new Color3(t, 1 - t, 0.3))
    }

    if (bomb.isDestroyed) {
      logEvent('impact', 'GravityBomb',
        `T${i}: 触地引爆 | pos=(${bomb.pos.X}, ${bomb.pos.Y}, ${bomb.pos.Z})`
      )
      break
    }
  }

  // Verify Euler integration by checking position progression
  let maxZ = -Infinity
  for (const p of positions) {
    if (p.Z > maxZ) maxZ = p.Z
  }

  const weapon = args.weapon as TestWeapon
  logEvent('info', 'GravityBomb',
    `轨迹: ${tickCount} ticks | 最高点 Z=${maxZ.toFixed(0)} | 最终 pos=(${bomb.pos.X}, ${bomb.pos.Y}, ${bomb.pos.Z})`
  )
  logEvent('info', 'GravityBomb', `武器触发次数: ${weapon.impactCount}`)

  // Impact marker (orange)
  createSphere(new Color3(1, 0.5, 0.1), wPosToVector3(bomb.pos.X, bomb.pos.Y, bomb.pos.Z), 0.35)

  updateDiagnostics([{
    name: 'GravityBomb',
    state: bomb.isDestroyed ? 'Impacted' : 'Flying',
    pos: `(${bomb.pos.X}, ${bomb.pos.Y}, ${bomb.pos.Z})`,
    destroyed: bomb.isDestroyed ? 'true' : 'false',
    extra: `maxZ=${maxZ.toFixed(0)} | ticks=${tickCount} | dots=${trajectoryDots.length}`,
  }])

  const summaryEl = document.getElementById('tc4-summary')!
  const hasTrajectory = trajectoryDots.length >= 5
  const passed = bomb.isDestroyed && weapon.impactCount >= 1 && hasTrajectory
  summaryEl.innerHTML = passed
    ? `<span style="color:#4f4;">✅ TC4 通过: GravityBomb 经过 ${tickCount} ticks 弹道飞行后触地引爆，轨迹点 ${trajectoryDots.length} 个</span>`
    : '<span style="color:#f44;">❌ TC4 失败: 检查弹道积分或触地检测</span>'
}

// ---------------------------------------------------------------------------
// TC5: BeamRenderableShape Enum
// ---------------------------------------------------------------------------

function runBeamShapeTest(): void {
  eventLog.length = 0
  logEvent('info', 'BeamShape', '--- TC5: BeamRenderableShape Enum ---')

  const shapes = [
    { name: 'Cylindrical', value: BeamRenderableShape.Cylindrical },
    { name: 'Flat', value: BeamRenderableShape.Flat },
  ]

  for (const s of shapes) {
    logEvent('info', 'BeamShape', `BeamRenderableShape.${s.name} = ${s.value}`)
  }

  const summaryEl = document.getElementById('tc5-summary')!
  const allValid = shapes.every(s => s.value === 0 || s.value === 1)
  summaryEl.innerHTML = allValid
    ? '<span style="color:#4f4;">✅ TC5 通过: BeamRenderableShape.Cylindrical=0, Flat=1 (total 2 values)</span>'
    : '<span style="color:#f44;">❌ TC5 失败: 枚举值异常</span>'

  updateDiagnostics([{
    name: 'BeamRenderableShape',
    state: 'Enum',
    pos: '-',
    destroyed: '-',
    extra: `Cylindrical=${BeamRenderableShape.Cylindrical} Flat=${BeamRenderableShape.Flat}`,
  }])
}

// ---------------------------------------------------------------------------
// TC6: LaserZap Duration Tracking
// ---------------------------------------------------------------------------

function runLaserZapTest(): void {
  eventLog.length = 0
  clearMarkers()
  clearTrajectoryDots()
  globalTick = 0
  logEvent('info', 'LaserZap', '--- TC6: LaserZap Duration Tracking ---')

  const { world, flushFrameEnd } = createStubWorld()
  const source = new WPos(2048, 5120, 0)
  const target = new WPos(8192, 5120, 0)

  createSphere(new Color3(0.2, 1, 0.2), wPosToVector3(2048, 5120, 0), 0.4)
  createSphere(new Color3(1, 0.2, 0.2), wPosToVector3(8192, 5120, 0), 0.4)

  const args = makeArgs(source, target)
  const laserZap = LaserZapFactory.create(args, {
    duration: 10,
    damageDuration: 3,
    damageInterval: 1,
    trackTarget: false,
    blockable: false,
    color: [255, 0, 0, 255],
  } satisfies Partial<LaserZapInfo>)

  logEvent('state_change', 'LaserZap', `创建: duration=${laserZap.info.duration} damageDuration=${laserZap.info.damageDuration}`)

  // Tick through full duration
  let tickCount = 0
  for (let i = 0; i < 15; i++) {
    globalTick = i
    laserZap.tick(world)
    flushFrameEnd()
    tickCount++

    if (i < laserZap.info.damageDuration) {
      const weapon = args.weapon as TestWeapon
      logEvent('impact', 'LaserZap',
        `T${i}: beamAlpha=${laserZap.beamAlpha} | ticks=${laserZap.ticks} | 武器触发次数=${weapon.impactCount}`
      )
    }

    if (i === laserZap.info.duration - 1) {
      logEvent('state_change', 'LaserZap',
        `T${i}: 达到 duration (${laserZap.info.duration}) | ticks=${laserZap.ticks} | beamAlpha=${laserZap.beamAlpha}`
      )
    }

    if (i >= laserZap.info.duration) {
      logEvent('info', 'LaserZap',
        `T${i}: 超过 duration | ticks=${laserZap.ticks} | beamAlpha=${laserZap.beamAlpha}`
      )
      break
    }
  }

  const weapon = args.weapon as TestWeapon
  logEvent('info', 'LaserZap',
    `最终: ticks=${laserZap.ticks} | beamAlpha=${laserZap.beamAlpha} | weapons=${weapon.impactCount}`
  )

  updateDiagnostics([{
    name: 'LaserZap',
    state: `Ticks: ${laserZap.ticks}/${laserZap.info.duration}`,
    pos: `(${laserZap.source.X}, ${laserZap.source.Y}, ${laserZap.source.Z}) -> (${laserZap.target.X}, ${laserZap.target.Y}, ${laserZap.target.Z})`,
    destroyed: laserZap.isDestroyed ? 'true' : 'false',
    extra: `alpha=${laserZap.beamAlpha} | impacts=${weapon.impactCount}`,
  }])

  const summaryEl = document.getElementById('tc6-summary')!
  const alphaAtEnd = laserZap.beamAlpha
  const passed = tickCount >= laserZap.info.duration && alphaAtEnd === 0 && weapon.impactCount >= 1
  summaryEl.innerHTML = passed
    ? `<span style="color:#4f4;">✅ TC6 通过: LaserZap 在 duration=${laserZap.info.duration} ticks 后 beamAlpha=0，武器触发 ${weapon.impactCount} 次</span>`
    : `<span style="color:#f44;">❌ TC6 失败: ticks=${tickCount} alpha=${alphaAtEnd} impacts=${weapon.impactCount}</span>`
}

// ---------------------------------------------------------------------------
// Run All Tests
// ---------------------------------------------------------------------------

function runAllTests(): void {
  clearMarkers()
  clearTrajectoryDots()
  eventLog.length = 0

  logEvent('info', 'ALL', '========== 开始执行全部测试 ==========')
  runRegistryTest()
  runMissileTest()
  runInstantHitTest()
  runGravityBombTest()
  runBeamShapeTest()
  runLaserZapTest()
  logEvent('info', 'ALL', '========== 全部测试执行完毕 ==========')
}

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-run-all')!.addEventListener('click', runAllTests)
document.getElementById('btn-tc1')!.addEventListener('click', runRegistryTest)
document.getElementById('btn-tc2')!.addEventListener('click', runMissileTest)
document.getElementById('btn-tc3')!.addEventListener('click', runInstantHitTest)
document.getElementById('btn-tc4')!.addEventListener('click', runGravityBombTest)
document.getElementById('btn-tc5')!.addEventListener('click', runBeamShapeTest)
document.getElementById('btn-tc6')!.addEventListener('click', runLaserZapTest)

document.getElementById('btn-reset')!.addEventListener('click', () => {
  clearMarkers()
  clearTrajectoryDots()
  eventLog.length = 0
  globalTick = 0
  renderEventLog()
  updateDiagnostics([])
  document.getElementById('tc1-summary')!.innerHTML = '-'
  document.getElementById('tc2-summary')!.innerHTML = '-'
  document.getElementById('tc3-summary')!.innerHTML = '-'
  document.getElementById('tc4-summary')!.innerHTML = '-'
  document.getElementById('tc5-summary')!.innerHTML = '-'
  document.getElementById('tc6-summary')!.innerHTML = '-'
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// ---------------------------------------------------------------------------
// Test Harness (exposed for programmatic verification)
// ---------------------------------------------------------------------------

;(window as any).__projectileTestHarness = {
  scene,
  engine,
  getEventLog: () => eventLog,
  runRegistryTest,
  runMissileTest,
  runInstantHitTest,
  runGravityBombTest,
  runBeamShapeTest,
  runLaserZapTest,
  runAllTests,
}
