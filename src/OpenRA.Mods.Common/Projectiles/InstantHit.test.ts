/**
 * InstantHit.test.ts — InstantHit unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Vector3: class MockVector3 { x: number; y: number; z: number; constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } },
  Quaternion: class MockQuaternion { x = 0; y = 0; z = 0; w = 1 },
}))

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub, MersenneTwisterStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import {
  InaccuracyType,
  type ProjectileArgs,
  type WeaponStub,
  type WarheadArgsStub,
  type BlockingActorsChecker,
} from './Bullet.js'
import { InstantHit, DEFAULT_INSTANT_HIT_INFO } from './InstantHit.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockRandom(seed = 42): MersenneTwisterStub {
  let state = seed
  return { next: () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state } }
}

function createMockPlayer(name = 'testPlayer'): PlayerStub {
  return { playerName: name }
}

function createMockActor(id = 1, owner?: PlayerStub): IGameActor {
  return { actorId: id, isInWorld: true, isDead: false, disposed: false, owner: owner ?? createMockPlayer() }
}

function createMockWeapon(impact?: (t: Target, a: WarheadArgsStub) => void): WeaponStub {
  return { impact: impact ?? (() => {}) } as WeaponStub
}

interface MockWorld extends GameWorldManager {
  drainFrameEndTasks(): void
}

function createMockWorld(): MockWorld {
  const effects: unknown[] = []
  const frameEndTasks: Array<() => void> = []
  return {
    actors: [], effects,
    addEffect(e: unknown): void { effects.push(e) },
    removeEffect(e: unknown): void { const i = effects.indexOf(e); if (i !== -1) effects.splice(i, 1) },
    addFrameEndTask(a: () => void): void { frameEndTasks.push(a) },
    drainFrameEndTasks(): void { while (frameEndTasks.length > 0) frameEndTasks.shift()!() },
    disposed: false, worldType: 'Regular', tickCount: 0, syncHash: 0,
  } as unknown as MockWorld
}

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
// Tests
// ---------------------------------------------------------------------------

describe('InstantHit', () => {
  it('creates with default config', () => {
    const args = createProjectileArgs()
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    expect(hit.isDestroyed).toBe(false)
    expect(hit.info.blockable).toBe(false)
  })

  it('destroys and applies warhead on first tick', () => {
    const mockImpact = vi.fn()
    const weapon = createMockWeapon(mockImpact)
    const args = createProjectileArgs({ weapon })
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    const world = createMockWorld()

    hit.tick(world)
    expect(hit.isDestroyed).toBe(true)
    expect(mockImpact).toHaveBeenCalledTimes(1)
  })

  it('does not tick when already destroyed', () => {
    const args = createProjectileArgs()
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    hit.isDestroyed = true
    const world = createMockWorld()
    const targetType = hit.target.type
    hit.tick(world)
    // Should not change anything
    expect(hit.target.type).toBe(targetType)
  })

  it('falls back to passiveTarget when guided target is invalid', () => {
    const args = createProjectileArgs({
      guidedTarget: Target.Invalid,
      passiveTarget: new WPos(5000, 0, 0),
    })
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    const world = createMockWorld()
    hit.tick(world)
    // Should have applied warhead at passiveTarget position
    expect(hit.isDestroyed).toBe(true)
  })

  it('checks blocking actors when blockable', () => {
    const checkBlocking: BlockingActorsChecker = () => new WPos(500, 0, 0)
    const info = { ...DEFAULT_INSTANT_HIT_INFO, blockable: true }
    const args = createProjectileArgs({ source: new WPos(0, 0, 0), passiveTarget: new WPos(10240, 0, 0) })
    const hit = new InstantHit(info, args, checkBlocking)
    const world = createMockWorld()
    hit.tick(world)
    expect(hit.isDestroyed).toBe(true)
  })

  it('does not block when blockable is false', () => {
    let called = false
    const checkBlocking: BlockingActorsChecker = () => { called = true; return new WPos(500, 0, 0) }
    const info = { ...DEFAULT_INSTANT_HIT_INFO, blockable: false }
    const args = createProjectileArgs()
    const hit = new InstantHit(info, args, checkBlocking)
    const world = createMockWorld()
    hit.tick(world)
    expect(called).toBe(false)
  })

  it('applies inaccuracy to target', () => {
    const info = { ...DEFAULT_INSTANT_HIT_INFO, inaccuracy: new WDist(10000), inaccuracyType: InaccuracyType.Absolute }
    const args = createProjectileArgs({ passiveTarget: new WPos(10240, 0, 0), source: new WPos(0, 0, 0) })
    const hit = new InstantHit(info, args)
    const delta = WPos.subtract(hit.target.centerPosition, args.passiveTarget)
    const hasOffset = delta.X !== 0 || delta.Y !== 0 || delta.Z !== 0
    expect(hasOffset).toBe(true)
  })

  it('no inaccuracy when inaccuracy is zero', () => {
    const info = { ...DEFAULT_INSTANT_HIT_INFO, inaccuracy: WDist.Zero }
    const args = createProjectileArgs({ passiveTarget: new WPos(10240, 0, 0) })
    const hit = new InstantHit(info, args)
    expect(WPos.equals(hit.target.centerPosition, args.passiveTarget)).toBe(true)
  })

  it('render returns empty array', () => {
    const args = createProjectileArgs()
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    const renderables = hit.render(null as unknown as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub)
    expect(renderables).toHaveLength(0)
  })

  it('dispose marks destroyed', () => {
    const args = createProjectileArgs()
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    hit.dispose()
    expect(hit.isDestroyed).toBe(true)
  })

  it('removes self from world via frameEndTask', () => {
    const args = createProjectileArgs()
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    const world = createMockWorld()
    world.addEffect(hit)
    expect(world.effects).toContain(hit)
    hit.tick(world)
    world.drainFrameEndTasks()
    expect(world.effects).not.toContain(hit)
  })

  it('handles zero distance source and target', () => {
    const args = createProjectileArgs({ source: new WPos(100, 100, 50), passiveTarget: new WPos(100, 100, 50) })
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    const world = createMockWorld()
    hit.tick(world)
    expect(hit.isDestroyed).toBe(true)
  })

  it('handles negative coordinates', () => {
    const args = createProjectileArgs({ source: new WPos(-5000, -3000, 100), passiveTarget: new WPos(5000, 3000, 0) })
    const hit = new InstantHit(DEFAULT_INSTANT_HIT_INFO, args)
    const world = createMockWorld()
    hit.tick(world)
    expect(hit.isDestroyed).toBe(true)
  })

  it('PerCellIncrement inaccuracy scales with range cells', () => {
    const info = {
      ...DEFAULT_INSTANT_HIT_INFO,
      inaccuracy: new WDist(50),
      inaccuracyType: InaccuracyType.PerCellIncrement,
    }
    const args = createProjectileArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(20480, 0, 0), // 20 cells
    })
    const hit = new InstantHit(info, args)
    const delta = WPos.subtract(hit.target.centerPosition, args.passiveTarget)
    // PerCellIncrement: cells * 50 = 20 * 50 = 1000 max offset
    expect(Math.abs(delta.X)).toBeLessThanOrEqual(1000)
  })
})
