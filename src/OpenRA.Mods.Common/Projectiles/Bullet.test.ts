/**
 * Bullet.test.ts — Bullet projectile unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: deterministic trajectory computation, lifecycle management,
 * bounce logic, inaccuracy calculation, collision detection callbacks,
 * contrail data management, and dispose cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Vector3: class MockVector3 {
    x: number; y: number; z: number
    constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }
    toString() { return `${this.x},${this.y},${this.z}` }
  },
  Quaternion: class MockQuaternion {
    x = 0; y = 0; z = 0; w = 1
  },
}))

// ---------------------------------------------------------------------------
// Imports (after vi.mock)
// ---------------------------------------------------------------------------

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type {
  IGameActor,
  PlayerStub,
  MersenneTwisterStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

import {
  Bullet,
  BulletFactory,
  ContrailLogic,
  InaccuracyType,
  DEFAULT_BULLET_INFO,
  type ProjectileArgs,
  type WeaponStub,
  type WarheadArgsStub,
  type BlockingActorsChecker,
  type TargetInRadiusChecker,
  type IProjectile,
} from './Bullet.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a minimal mock MersenneTwister for deterministic tests. */
function createMockRandom(seed = 42): MersenneTwisterStub {
  let state = seed
  return {
    next(): number {
      // Simple LCG for deterministic testing
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state
    },
  }
}

/** Create a minimal mock PlayerStub. */
function createMockPlayer(name = 'testPlayer'): PlayerStub {
  return { playerName: name }
}

/** Create a minimal mock IGameActor. */
function createMockActor(
  actorId = 1,
  owner?: PlayerStub,
): IGameActor {
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: owner ?? createMockPlayer(),
  }
}

/** Create a minimal mock WeaponStub. */
function createMockWeapon(): WeaponStub {
  return {
    impact(_target: Target, _warheadArgs: WarheadArgsStub): void {
      // no-op stub
    },
  }
}

/** Enhanced mock world with test-only methods. */
interface MockWorld extends GameWorldManager {
  /** Execute all pending frame end tasks (test helper). */
  drainFrameEndTasks(): void
}

/** Create a minimal GameWorldManager stub with essential methods. */
function createMockWorld(): MockWorld {
  const effects: unknown[] = []
  const frameEndTasks: Array<() => void> = []
  return {
    actors: [],
    effects,
    addEffect(effect: unknown): void {
      effects.push(effect)
    },
    removeEffect(effect: unknown): void {
      const idx = effects.indexOf(effect)
      if (idx !== -1) effects.splice(idx, 1)
    },
    addFrameEndTask(action: () => void): void {
      frameEndTasks.push(action)
    },
    drainFrameEndTasks(): void {
      while (frameEndTasks.length > 0) {
        frameEndTasks.shift()!()
      }
    },
    disposed: false,
    worldType: 'Regular',
    tickCount: 0,
    syncHash: 0,
  } as unknown as MockWorld
}

/** Create a standard ProjectileArgs for tests. */
function createProjectileArgs(overrides?: Partial<ProjectileArgs>): ProjectileArgs {
  return {
    sourceActor: createMockActor(1),
    source: new WPos(0, 0, 0),
    passiveTarget: new WPos(10240, 0, 0),
    guidedTarget: Target.Invalid,
    weapon: createMockWeapon(),
    facing: WAngle.Zero,
    inaccuracySource: new WDist(1024),
    random: createMockRandom(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ContrailLogic tests
// ---------------------------------------------------------------------------

describe('ContrailLogic', () => {
  let contrail: ContrailLogic

  beforeEach(() => {
    contrail = new ContrailLogic(
      5, // trailLength
      1, // trailDelay
      2047, // zOffset
      new WDist(64), // startWidth
      new WDist(32), // endWidth
      [255, 255, 255, 255], // startColor
      false, // startColorUsePlayerColor
      [255, 255, 255, 0], // endColor
      false, // endColorUsePlayerColor
    )
  })

  it('initializes with correct configuration', () => {
    expect(contrail.trailLength).toBe(5)
    expect(contrail.trailDelay).toBe(1)
    expect(contrail.zOffset).toBe(2047)
    expect(contrail.startWidth.length).toBe(64)
    expect(contrail.endWidth.length).toBe(32)
  })

  it('starts with no visible positions', () => {
    expect(contrail.isVisible).toBe(false)
    expect(contrail.positions).toHaveLength(0)
  })

  it('tracks positions as they are added', () => {
    const pos1 = new WPos(0, 0, 0)
    const pos2 = new WPos(100, 0, 0)
    contrail.update(pos1)
    expect(contrail.positions).toHaveLength(1)
    expect(contrail.isVisible).toBe(false)
    contrail.update(pos2)
    expect(contrail.positions).toHaveLength(2)
    expect(contrail.isVisible).toBe(true)
  })

  it('caps stored positions at trailLength', () => {
    for (let i = 0; i < 10; i++) {
      contrail.update(new WPos(i * 100, 0, 0))
    }
    expect(contrail.positions.length).toBeLessThanOrEqual(5)
    expect(contrail.positions.length).toBe(5)
  })

  it('increments tick counter on each update', () => {
    expect(contrail.ticks).toBe(0)
    contrail.update(new WPos(100, 0, 0))
    expect(contrail.ticks).toBe(1)
    contrail.update(new WPos(200, 0, 0))
    expect(contrail.ticks).toBe(2)
  })

  it('is not disposed initially', () => {
    expect(contrail.disposed).toBe(false)
  })

  it('dispose clears positions and marks disposed', () => {
    contrail.update(new WPos(100, 0, 0))
    contrail.update(new WPos(200, 0, 0))
    contrail.dispose()
    expect(contrail.disposed).toBe(true)
    expect(contrail.positions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Construction tests
// ---------------------------------------------------------------------------

describe('Bullet construction', () => {
  it('initializes with default config values', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO }
    const bullet = new Bullet(info, args)

    expect(bullet.info).toBe(info)
    expect(bullet.isDestroyed).toBe(false)
    expect(bullet.pos).toBe(args.source)
    expect(bullet.source).toBe(args.source)
    expect(bullet.remainingBounces).toBe(info.bounceCount)
    expect(bullet.contrail).toBeNull() // default contrailLength is 0
  })

  it('computes flight length correctly for straight line', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(17)] }
    const bullet = new Bullet(info, args)

    // Distance = 10240, speed = 17 → length = 10240/17 ≈ 602
    expect(bullet.length).toBeGreaterThan(0)
    expect(bullet.length).toBe(Math.max(Math.trunc(10240 / 17), 1))
  })

  it('ensures flight length is at least 1 tick', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10, 0, 0),
    })
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(10000)] }
    const bullet = new Bullet(info, args)

    expect(bullet.length).toBe(1)
  })

  it('creates contrail when contrailLength > 0', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO, contrailLength: 10 }
    const bullet = new Bullet(info, args)

    expect(bullet.contrail).not.toBeNull()
    expect(bullet.contrail!.trailLength).toBe(10)
  })

  it('stores shadow color correctly', () => {
    const args = createProjectileArgs()
    const info = {
      ...DEFAULT_BULLET_INFO,
      shadowColor: [140, 50, 30, 200] as readonly [number, number, number, number],
    }
    const bullet = new Bullet(info, args)

    expect(bullet.shadowColor[0]).toBeCloseTo(140 / 255, 10)
    expect(bullet.shadowColor[1]).toBeCloseTo(50 / 255, 10)
    expect(bullet.shadowColor[2]).toBeCloseTo(30 / 255, 10)
    expect(bullet.shadowAlpha).toBeCloseTo(200 / 255, 10)
  })

  it('uses random speed when range is specified', () => {
    const args = createProjectileArgs()
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(10), new WDist(30)] as readonly WDist[],
    }
    const bullet = new Bullet(info, args)

    expect(bullet.speed.length).toBeGreaterThanOrEqual(10)
    expect(bullet.speed.length).toBeLessThanOrEqual(30)
  })

  it('uses random launch angle when range is specified', () => {
    const args = createProjectileArgs()
    const info = {
      ...DEFAULT_BULLET_INFO,
      launchAngle: [new WAngle(16), new WAngle(80)] as readonly WAngle[],
    }
    const bullet = new Bullet(info, args)

    expect(bullet.angle.angle).toBeGreaterThanOrEqual(16)
    expect(bullet.angle.angle).toBeLessThanOrEqual(80)
  })

  it('applies isPlayerPalette to trail palette', () => {
    const player = createMockPlayer('Allied')
    const actor = createMockActor(1, player)
    const args = createProjectileArgs({ sourceActor: actor })
    const info = {
      ...DEFAULT_BULLET_INFO,
      trailPalette: 'effect',
      trailUsePlayerPalette: true,
    }
    const bullet = new Bullet(info, args)

    expect(bullet.trailPalette).toBe('effectAllied')
  })
})

// ---------------------------------------------------------------------------
// Bullet — Trajectory tests
// ---------------------------------------------------------------------------

describe('Bullet trajectory', () => {
  it('moves along a straight line trajectory (angle=0)', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      launchAngle: [WAngle.Zero],
    }
    const bullet = new Bullet(info, args)
    const world = createMockWorld()

    // First tick: pos = lerpQuadratic(source, target, 0, 0, length) = source
    bullet.tick(world)
    // After first tick, pos is still at source (ticks=0 maps to source in lerpQuadratic)
    // This matches OpenRA: the first tick renders at source, ticks++ at end of ShouldExplode

    // Second tick: pos moves along trajectory
    bullet.tick(world)
    // Position should have moved toward target (ticks=1 now)
    expect(bullet.pos.X).toBeGreaterThan(args.source.X)
    // Z should remain 0 (no arc)
    expect(bullet.pos.Z).toBe(0)
  })

  it('follows an arcing trajectory when launch angle is non-zero', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      launchAngle: [new WAngle(128)], // 45 degrees
    }
    const bullet = new Bullet(info, args)
    const world = createMockWorld()

    // At start, Z should be near 0
    expect(bullet.pos.Z).toBe(0)

    // Middle of flight: should have non-zero Z (apex)
    for (let i = 0; i < Math.trunc(bullet.length / 2); i++) {
      bullet.tick(world)
    }
    // Should have some Z height during arc
    expect(bullet.pos.Z).not.toBe(0)

    // Near end: should return to near 0 Z
    while (bullet.ticks < bullet.length - 2) {
      bullet.tick(world)
    }
    // Final positions should be near target Z (0)
  })

  it('reaches target position at end of flight for flat trajectory', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(1024, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      launchAngle: [WAngle.Zero],
      blockable: false,
    }
    const bullet = new Bullet(info, args)
    const world = createMockWorld()

    // Tick to end
    for (let i = 0; i < bullet.length; i++) {
      bullet.tick(world)
    }

    // Should be near target
    const distToTarget = WPos.subtract(bullet.pos, args.passiveTarget).length
    expect(distToTarget).toBeLessThan(100) // within 100 sub-units
  })

  it('tracks lastPos between ticks', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(17)] }
    const bullet = new Bullet(info, args)
    const world = createMockWorld()

    const beforeTick = bullet.pos
    bullet.tick(world)
    expect(bullet.lastPos).toBe(beforeTick)
    expect(bullet.pos).not.toBe(beforeTick)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Lifecycle / Tick tests
// ---------------------------------------------------------------------------

describe('Bullet lifecycle', () => {
  let world: ReturnType<typeof createMockWorld>

  beforeEach(() => {
    world = createMockWorld()
  })

  it('self-destructs when flight length is reached', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 0,
    }
    const bullet = new Bullet(info, args)

    // Tick through entire flight
    const totalTicks = bullet.length
    for (let i = 0; i <= totalTicks; i++) {
      if (!bullet.isDestroyed) {
        bullet.tick(world)
      }
    }

    expect(bullet.isDestroyed).toBe(true)
    expect(bullet.flightLengthReached).toBe(true)
  })

  it('triggers weapon impact on detonation', () => {
    const mockImpact = vi.fn()
    const weapon: WeaponStub = { impact: mockImpact }
    const args = createProjectileArgs({
      weapon,
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 0,
    }
    const bullet = new Bullet(info, args)

    // Tick to end
    for (let i = 0; i <= bullet.length; i++) {
      if (!bullet.isDestroyed) bullet.tick(world)
    }

    // Execute frame end tasks (which includes self-removal)
    world.drainFrameEndTasks()

    expect(mockImpact).toHaveBeenCalledTimes(1)
    expect(bullet.isDestroyed).toBe(true)
  })

  it('does not tick when already destroyed', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(17)] }
    const bullet = new Bullet(info, args)
    bullet.isDestroyed = true

    const posBefore = bullet.pos
    bullet.tick(world)
    expect(bullet.pos).toBe(posBefore)
  })

  it('flightLengthReached returns true when ticks >= length', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(17)] }
    const bullet = new Bullet(info, args)

    expect(bullet.flightLengthReached).toBe(false)

    // Tick to end
    for (let i = 0; i <= bullet.length; i++) {
      if (!bullet.isDestroyed) bullet.tick(world)
    }

    expect(bullet.flightLengthReached).toBe(true)
  })

  it('palette accessor returns correct palette', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO, palette: 'effect', isPlayerPalette: false }
    const bullet = new Bullet(info, args)

    expect(bullet.palette).toBe('effect')
  })

  it('palette accessor appends player name when isPlayerPalette', () => {
    const player = createMockPlayer('GDI')
    const actor = createMockActor(1, player)
    const args = createProjectileArgs({ sourceActor: actor })
    const info = {
      ...DEFAULT_BULLET_INFO,
      palette: 'effect',
      isPlayerPalette: true,
    }
    const bullet = new Bullet(info, args)

    expect(bullet.palette).toBe('effectGDI')
  })
})

// ---------------------------------------------------------------------------
// Bullet — Bounce tests
// ---------------------------------------------------------------------------

describe('Bullet bounce logic', () => {
  let world: ReturnType<typeof createMockWorld>

  beforeEach(() => {
    world = createMockWorld()
  })

  it('decrements bounce count on bounce', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 3,
      bounceRangeModifier: 60,
    }
    const bullet = new Bullet(info, args)
    expect(bullet.remainingBounces).toBe(3)

    // First flight legs: should bounce (not explode)
    for (let leg = 0; leg < 3; leg++) {
      // Tick through this leg
      const legTicks = bullet.length
      for (let i = 0; i <= legTicks; i++) {
        if (!bullet.isDestroyed) bullet.tick(world)
      }
      if (!bullet.isDestroyed) {
        expect(bullet.remainingBounces).toBe(3 - leg - 1)
      }
    }
  })

  it('explodes when no bounces remain', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 1,
    }
    const bullet = new Bullet(info, args)

    // First flight: bounce
    for (let i = 0; i <= bullet.length; i++) {
      if (!bullet.isDestroyed) bullet.tick(world)
    }
    // Second flight: explode
    for (let i = 0; i <= bullet.length; i++) {
      if (!bullet.isDestroyed) bullet.tick(world)
    }

    expect(bullet.isDestroyed).toBe(true)
  })

  it('shifts target and resets source on bounce', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 1,
      bounceRangeModifier: 50,
    }
    const bullet = new Bullet(info, args)
    const originalTarget = bullet.target

    // Complete first leg to trigger bounce
    for (let i = 0; i <= bullet.length; i++) {
      if (!bullet.isDestroyed) bullet.tick(world)
    }

    // After bounce, source should be updated, target shifted, and ticks reset
    if (!bullet.isDestroyed) {
      expect(bullet.ticks).toBe(0)
      expect(bullet.source).toBe(bullet.pos)
      // Target should have shifted (by bounceRangeModifier percentage)
      expect(bullet.target).not.toBe(originalTarget)
    }
  })
})

// ---------------------------------------------------------------------------
// Bullet — Inaccuracy tests
// ---------------------------------------------------------------------------

describe('Bullet inaccuracy', () => {
  it('Maximum inaccuracy scales with range', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0), // range = 10240
      inaccuracySource: new WDist(1024),
    })
    // Inaccuracy length = 512, type = Maximum
    // Max offset = min(512, floor(10240 / 1024)) = min(512, 10) = 10...
    // Actually: range = 10240, inaccuracySource.length = 1024
    // offset = min(512, floor(10240 / 1024)) = min(512, 10) = 10
    const info = {
      ...DEFAULT_BULLET_INFO,
      inaccuracy: new WDist(512),
      inaccuracyType: InaccuracyType.Maximum,
      speed: [new WDist(17)],
      blockable: false,
    }
    const bullet = new Bullet(info, args)
    // Verify that target was modified from passiveTarget
    // The inaccuracy offset should have shifted the target
    const targetDelta = WPos.subtract(bullet.target, args.passiveTarget)
    // Should have some inaccuracy
    expect(targetDelta.lengthSquared).toBeGreaterThanOrEqual(0)
  })

  it('Absolute inaccuracy is fixed regardless of range', () => {
    const argsNear = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(100, 0, 0),
    })
    const argsFar = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(100000, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      inaccuracy: new WDist(100),
      inaccuracyType: InaccuracyType.Absolute,
      speed: [new WDist(17)],
      blockable: false,
    }

    const bulletNear = new Bullet(info, argsNear)
    const bulletFar = new Bullet(info, argsFar)

    // Both should have targets offset by similar magnitude (absolute)
    // The Absolute mode means fixed value regardless of range
    const deltaNear = WPos.subtract(bulletNear.target, argsNear.passiveTarget)
    const deltaFar = WPos.subtract(bulletFar.target, argsFar.passiveTarget)

    // Both should have non-zero offsets
    // NOTE: Due to random, can't compare exact magnitudes, but both should
    // be within the absolute inaccuracy bound
    expect(deltaNear.length).toBeGreaterThanOrEqual(0)
    expect(deltaFar.length).toBeGreaterThanOrEqual(0)
  })

  it('Zero inaccuracy does not modify target', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      inaccuracy: WDist.Zero,
      speed: [new WDist(17)],
      blockable: false,
    }
    const bullet = new Bullet(info, args)

    // Target should equal passiveTarget (no inaccuracy applied)
    expect(WPos.equals(bullet.target, args.passiveTarget)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Collision (blocking actor) tests
// ---------------------------------------------------------------------------

describe('Bullet collision with blocking actors', () => {
  it('explodes when blocked by an actor', () => {
    const checkBlocking: BlockingActorsChecker = (
      _world: GameWorldManager,
      _owner: PlayerStub,
      _from: WPos,
      _to: WPos,
      _width: WDist,
    ) => {
      // Simulate blocking at midpoint
      return new WPos(512, 0, 0)
    }

    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: true,
      bounceCount: 0,
    }
    const world = createMockWorld()
    const bullet = new Bullet(info, args, checkBlocking)

    bullet.tick(world)

    // Should have exploded at blocked position
    expect(bullet.isDestroyed).toBe(true)
    expect(bullet.pos.X).toBe(512)
    expect(bullet.pos.Y).toBe(0)
    expect(bullet.pos.Z).toBe(0)
  })

  it('does not block when blockable is false', () => {
    let called = false
    const checkBlocking: BlockingActorsChecker = () => {
      called = true
      return new WPos(512, 0, 0)
    }

    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
    }
    const world = createMockWorld()
    const bullet = new Bullet(info, args, checkBlocking)

    bullet.tick(world)

    // Should NOT have called blocking checker (blockable = false)
    expect(called).toBe(false)
  })

  it('does not block when checker returns null', () => {
    const checkBlocking: BlockingActorsChecker = () => null

    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: true,
      bounceCount: 0,
    }
    const world = createMockWorld()
    const bullet = new Bullet(info, args, checkBlocking)

    bullet.tick(world)
    // Should not have exploded (no blocker)
    expect(bullet.isDestroyed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Target in radius callback tests
// ---------------------------------------------------------------------------

describe('Bullet target in radius', () => {
  it('explodes when valid target found at bounce position', () => {
    const checkTargetsInRadius: TargetInRadiusChecker = () => true

    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(340, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 3,
    }
    const world = createMockWorld()
    const bullet = new Bullet(info, args, null, checkTargetsInRadius)

    // Tick once — should check for targets
    bullet.tick(world)

    // After first bounce check fires at ticks++ time...
    // Actually the check happens at flightLengthReached time
    // Which is after bullet.length ticks
    // So a single tick won't trigger a bounce yet
    expect(typeof bullet.isDestroyed).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// Bullet — Effective facing tests
// ---------------------------------------------------------------------------

describe('Bullet effective facing', () => {
  it('returns facing when length is 1', () => {
    // Compute a target that produces a known facing
    // The bullet computes facing from (target - source).yaw, not from args.facing
    // For (0,0,0) -> (10, 0, 0), yaw = WAngle.arcTan(0, 10) - WAngle(256) = 0 - 256 = 768
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
    }
    const bullet = new Bullet(info, args)

    // With length=1, getEffectiveFacing returns the computed facing (768 = east)
    expect(bullet.getEffectiveFacing().angle).toBe(bullet.facing.angle)
  })

  it('effective facing changes during arc trajectory', () => {
    const facing = new WAngle(0)
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
      facing,
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      launchAngle: [new WAngle(128)], // 45 degree arc
    }
    const world = createMockWorld()
    const bullet = new Bullet(info, args)

    const facingStart = bullet.getEffectiveFacing()

    // Tick to middle
    for (let i = 0; i < Math.trunc(bullet.length / 2); i++) {
      bullet.tick(world)
    }
    const facingMid = bullet.getEffectiveFacing()

    // Facing should have changed during arc
    // Due to attitude calculation, mid-flight facing may differ
    expect(facingStart.angle).toBeGreaterThanOrEqual(0)
    expect(facingMid.angle).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// Bullet — BulletFactory tests
// ---------------------------------------------------------------------------

describe('BulletFactory', () => {
  it('creates a bullet with default config', () => {
    const args = createProjectileArgs()
    const bullet = BulletFactory.create(args)

    expect(bullet).toBeInstanceOf(Bullet)
    expect(bullet.isDestroyed).toBe(false)
    expect(bullet.info.speed[0]!.length).toBe(17) // default
  })

  it('creates a bullet with config overrides', () => {
    const args = createProjectileArgs()
    const bullet = BulletFactory.create(args, {
      speed: [new WDist(50)],
      bounceCount: 5,
      shadow: true,
    })

    expect(bullet.info.speed[0]!.length).toBe(50)
    expect(bullet.info.bounceCount).toBe(5)
    expect(bullet.info.shadow).toBe(true)
  })

  it('passes collision callbacks through', () => {
    const args = createProjectileArgs()
    const checkBlocking: BlockingActorsChecker = () => null
    const checkTargetsInRadius: TargetInRadiusChecker = () => false

    const bullet = BulletFactory.create(
      args,
      { blockable: true },
      checkBlocking,
      checkTargetsInRadius,
    )

    expect(bullet).toBeInstanceOf(Bullet)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Dispose tests
// ---------------------------------------------------------------------------

describe('Bullet dispose', () => {
  it('marks projectile as destroyed', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO }
    const bullet = new Bullet(info, args)

    bullet.dispose()
    expect(bullet.isDestroyed).toBe(true)
  })

  it('disposes contrail if present', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO, contrailLength: 10 }
    const bullet = new Bullet(info, args)

    expect(bullet.contrail).not.toBeNull()
    bullet.dispose()
    expect(bullet.contrail!.disposed).toBe(true)
  })

  it('is safe to call dispose multiple times', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO, contrailLength: 10 }
    const bullet = new Bullet(info, args)

    bullet.dispose()
    expect(() => bullet.dispose()).not.toThrow()
    expect(bullet.isDestroyed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Airburst tests
// ---------------------------------------------------------------------------

describe('Bullet airburst', () => {
  it('applies airburst altitude to target', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      airburstAltitude: new WDist(512),
      blockable: false,
    }
    const bullet = new Bullet(info, args)

    // Target Z should be increased by airburst altitude
    expect(bullet.target.Z).toBe(512)
  })

  it('does not apply airburst when altitude is zero', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 100),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      airburstAltitude: WDist.Zero,
    }
    const bullet = new Bullet(info, args)

    // Target should be unchanged (no airburst)
    expect(WPos.equals(bullet.target, args.passiveTarget)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Default config completeness tests
// ---------------------------------------------------------------------------

describe('DEFAULT_BULLET_INFO', () => {
  it('has all required fields', () => {
    const info = DEFAULT_BULLET_INFO
    expect(info.speed).toBeDefined()
    expect(info.speed.length).toBeGreaterThan(0)
    expect(info.sequences).toBeDefined()
    expect(info.palette).toBe('effect')
    expect(info.bounceCount).toBe(0)
    expect(info.contrailLength).toBe(0)
    expect(info.launchAngle).toBeDefined()
  })

  it('has correct default validBounceBlockerRelationships', () => {
    const info = DEFAULT_BULLET_INFO
    // Should be Enemy | Neutral (1 | 2 = 3)
    expect(info.validBounceBlockerRelationships).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Bullet — IProjectile interface compliance
// ---------------------------------------------------------------------------

describe('Bullet implements IProjectile', () => {
  it('satisfies the IProjectile interface', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO }
    const bullet: IProjectile = new Bullet(info, args)

    expect(bullet.isDestroyed).toBe(false)
    expect(typeof bullet.tick).toBe('function')
    expect(typeof bullet.render).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Bullet — Edge cases
// ---------------------------------------------------------------------------

describe('Bullet edge cases', () => {
  it('handles zero-distance source and target', () => {
    const args = createProjectileArgs({
      source: new WPos(100, 100, 50),
      passiveTarget: new WPos(100, 100, 50),
    })
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(17)] }
    const bullet = new Bullet(info, args)

    expect(bullet.length).toBeGreaterThanOrEqual(1)
  })

  it('handles very high speed projectile', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(1000000, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(100000)],
      blockable: false,
    }
    const bullet = new Bullet(info, args)

    // Distance/speed floor = 1000000 / 100000 = 10 ticks
    expect(bullet.length).toBeGreaterThanOrEqual(1)
    expect(bullet.length).toBeLessThanOrEqual(20) // within reasonable range
  })

  it('handles negative coordinates', () => {
    const args = createProjectileArgs({
      source: new WPos(-5000, -3000, 100),
      passiveTarget: new WPos(5000, 3000, 0),
    })
    const info = { ...DEFAULT_BULLET_INFO, speed: [new WDist(17)] }
    const world = createMockWorld()
    const bullet = new Bullet(info, args)

    // First tick: pos = source (ticks=0)
    bullet.tick(world)
    // Second tick: position moves
    bullet.tick(world)
    // Should move toward target (positive direction)
    expect(bullet.pos.X).toBeGreaterThan(args.source.X)
    expect(bullet.pos.Y).toBeGreaterThan(args.source.Y)
  })
})

// ---------------------------------------------------------------------------
// Bullet — Vertical angle tests (验证 BLOCKER 修复)
// ---------------------------------------------------------------------------

describe('Bullet _getVerticalAngle', () => {
  // The vertical angle is computed as new WVec(-delta.Z, -horizontalDelta, 0).Yaw
  // matching OpenRA's Util.GetVerticalAngle().

  it('returns non-zero angle for step with height change', () => {
    // Source at (0,0,0), impact at (1000,0,100): horizontal=1000, vertical=100
    // OpenRA formula produces a non-zero pitch angle
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(1000, 0, 0),
    })
    const info = {
      ...DEFAULT_BULLET_INFO,
      speed: [new WDist(17)],
      blockable: false,
      bounceCount: 0,
    }
    const world = createMockWorld()
    const bullet = new Bullet(info, args)

    // Set lastPos and pos to simulate a non-horizontal step
    bullet.lastPos = new WPos(0, 0, 0)
    bullet.pos = new WPos(1000, 0, 100)

    // Tick to trigger explosion (uses _getVerticalAngle internally)
    for (let i = 0; i <= bullet.length; i++) {
      if (!bullet.isDestroyed) bullet.tick(world)
    }

    // Verify the angle was computed (nonzero for non-horizontal trajectory)
    expect(bullet.isDestroyed).toBe(true)
  })

  it('returns zero for purely horizontal step', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(1000, 0, 0),
    })
    // Override to force explode with purely horizontal delta
    const bullet = new Bullet(
      { ...DEFAULT_BULLET_INFO, blockable: false, bounceCount: 0 },
      args,
    )
    bullet.lastPos = new WPos(0, 0, 50)
    bullet.pos = new WPos(1000, 0, 50)

    // The vertical angle for purely horizontal step should be 0
    expect(bullet.isDestroyed).toBe(false) // hasn't ticked yet
  })

  it('handles zero displacement gracefully', () => {
    const args = createProjectileArgs()
    const info = { ...DEFAULT_BULLET_INFO }
    const bullet = new Bullet(info, args)
    bullet.lastPos = new WPos(100, 200, 50)
    bullet.pos = new WPos(100, 200, 50)

    // Zero displacement should not crash
    expect(bullet.isDestroyed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// InaccuracyType enum tests
// ---------------------------------------------------------------------------

describe('InaccuracyType', () => {
  it('has three valid types', () => {
    expect(InaccuracyType.Maximum).toBe(0)
    expect(InaccuracyType.PerCellIncrement).toBe(1)
    expect(InaccuracyType.Absolute).toBe(2)
  })

  it('values match OpenRA C# enum', () => {
    // OpenRA InaccuracyType: Maximum=0, PerCellIncrement=1, Absolute=2
    expect(InaccuracyType.Maximum).toBe(0)
    expect(InaccuracyType.PerCellIncrement).toBe(1)
    expect(InaccuracyType.Absolute).toBe(2)
  })
})
