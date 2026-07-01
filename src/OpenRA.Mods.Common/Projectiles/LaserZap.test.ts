/**
 * LaserZap.test.ts — LaserZap unit tests
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
import { InaccuracyType, type WeaponStub, type ProjectileArgs } from './Bullet.js'
import { LaserZap, DEFAULT_LASER_ZAP_INFO } from './LaserZap.js'

function createMockRandom(seed = 42): MersenneTwisterStub {
  let state = seed; return { next: () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state } }
}
function createMockPlayer(name = 'testPlayer'): PlayerStub { return { playerName: name } }
function createMockActor(id = 1): IGameActor {
  return { actorId: id, isInWorld: true, isDead: false, disposed: false, owner: createMockPlayer() }
}

interface MockWorld extends GameWorldManager { drainFrameEndTasks(): void }
function createMockWorld(): MockWorld {
  const effects: unknown[] = []; const tasks: Array<() => void> = []
  return {
    actors: [], effects,
    addEffect(e: unknown): void { effects.push(e) },
    removeEffect(e: unknown): void { const i = effects.indexOf(e); if (i !== -1) effects.splice(i, 1) },
    addFrameEndTask(a: () => void): void { tasks.push(a) },
    drainFrameEndTasks(): void { while (tasks.length > 0) tasks.shift()!() },
    disposed: false, worldType: 'Regular', tickCount: 0, syncHash: 0,
  } as unknown as MockWorld
}

function createProjectileArgs(overrides?: Partial<ProjectileArgs>): ProjectileArgs {
  return {
    sourceActor: createMockActor(1), source: new WPos(0, 0, 0), passiveTarget: new WPos(10240, 0, 0),
    guidedTarget: Target.Invalid, weapon: { impact: () => {} } as WeaponStub,
    facing: WAngle.Zero, inaccuracySource: new WDist(1024), random: createMockRandom(),
    ...overrides,
  }
}

describe('LaserZap', () => {
  it('creates with default config', () => {
    const zap = new LaserZap(DEFAULT_LASER_ZAP_INFO, createProjectileArgs())
    expect(zap.isDestroyed).toBe(false)
    expect(zap.ticks).toBe(0)
  })

  it('applies damage during damageDuration', () => {
    const mockImpact = vi.fn()
    const weapon = { impact: mockImpact } as unknown as WeaponStub
    const args = createProjectileArgs({ weapon })
    const info = { ...DEFAULT_LASER_ZAP_INFO, damageDuration: 3, damageInterval: 1 }
    const zap = new LaserZap(info, args)
    const world = createMockWorld()
    zap.tick(world)
    expect(mockImpact).toHaveBeenCalledTimes(1)
    zap.tick(world)
    expect(mockImpact).toHaveBeenCalledTimes(2)
    zap.tick(world)
    expect(mockImpact).toHaveBeenCalledTimes(3)
    // Fourth tick: no more damage
    zap.tick(world)
    expect(mockImpact).toHaveBeenCalledTimes(3)
  })

  it('does not apply damage after damageDuration', () => {
    const mockImpact = vi.fn()
    const weapon = { impact: mockImpact } as unknown as WeaponStub
    const info = { ...DEFAULT_LASER_ZAP_INFO, damageDuration: 1, damageInterval: 1, duration: 5 }
    const zap = new LaserZap(info, createProjectileArgs({ weapon }))
    const world = createMockWorld()
    zap.tick(world)
    expect(mockImpact).toHaveBeenCalledTimes(1)
    // More ticks, no more damage
    for (let i = 0; i < 5; i++) zap.tick(world)
    world.drainFrameEndTasks()
    // Should still be 1
    expect(mockImpact).toHaveBeenCalledTimes(1)
  })

  it('self-removes after duration when no hit anim', () => {
    const info = { ...DEFAULT_LASER_ZAP_INFO, duration: 3, damageDuration: 0, hitAnim: null }
    const zap = new LaserZap(info, createProjectileArgs())
    const world = createMockWorld()
    world.addEffect(zap)
    for (let i = 0; i < 4; i++) zap.tick(world)
    world.drainFrameEndTasks()
    expect(world.effects).not.toContain(zap)
  })

  it('beamAlpha fades over time', () => {
    const info = { ...DEFAULT_LASER_ZAP_INFO, duration: 10, damageDuration: 0 }
    const zap = new LaserZap(info, createProjectileArgs())
    // Before any ticks, ticks=0, beamAlpha = (10-0)*255/10 = 255
    expect(zap.beamAlpha).toBe(255)
    // After 5 ticks
    for (let i = 0; i < 5; i++) zap.tick(createMockWorld())
    expect(zap.beamAlpha).toBeGreaterThan(0)
    expect(zap.beamAlpha).toBeLessThan(255)
  })

  it('beamAlpha is zero when duration elapsed', () => {
    const info = { ...DEFAULT_LASER_ZAP_INFO, duration: 3, damageDuration: 0 }
    const zap = new LaserZap(info, createProjectileArgs())
    for (let i = 0; i < 3; i++) zap.tick(createMockWorld())
    expect(zap.beamAlpha).toBe(0)
  })

  it('does not tick when destroyed', () => {
    const zap = new LaserZap(DEFAULT_LASER_ZAP_INFO, createProjectileArgs())
    zap.isDestroyed = true
    zap.tick(createMockWorld())
    expect(zap.ticks).toBe(0)
  })

  it('dispose marks destroyed', () => {
    const zap = new LaserZap(DEFAULT_LASER_ZAP_INFO, createProjectileArgs())
    zap.dispose()
    expect(zap.isDestroyed).toBe(true)
  })

  it('applies inaccuracy to target', () => {
    const info = { ...DEFAULT_LASER_ZAP_INFO, inaccuracy: new WDist(10000), inaccuracyType: InaccuracyType.Absolute }
    const zap = new LaserZap(info, createProjectileArgs())
    const origTarget = new WPos(10240, 0, 0)
    const delta = WPos.subtract(zap.target, origTarget)
    const hasOffset = delta.X !== 0 || delta.Y !== 0 || delta.Z !== 0
    expect(hasOffset).toBe(true)
  })

  it('render returns empty array', () => {
    const zap = new LaserZap(DEFAULT_LASER_ZAP_INFO, createProjectileArgs())
    expect(zap.render(null as unknown as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub)).toHaveLength(0)
  })

  it('has correct default color', () => {
    const zap = new LaserZap(DEFAULT_LASER_ZAP_INFO, createProjectileArgs())
    expect(zap.color).toEqual([255, 0, 0, 255])
  })

  // NEGATIVE TESTS — regression guards for B1 (isDestroyed before frame-end task)

  it('BUGFIX: sets isDestroyed=true immediately when duration expires, before frame-end task', () => {
    const info = { ...DEFAULT_LASER_ZAP_INFO, duration: 3, damageDuration: 0, hitAnim: null }
    const zap = new LaserZap(info, createProjectileArgs())
    const world = createMockWorld()
    // Tick to duration — disposal condition triggers at ticks >= duration
    for (let i = 0; i < 3; i++) zap.tick(world)
    // BEFORE frame-end task executes, isDestroyed should already be true
    // (prevents double-tick window between tick() return and frame-end)
    expect(zap.isDestroyed).toBe(true)
    // Subsequent tick() should be no-op
    zap.tick(world)
    expect(zap.ticks).toBe(3) // didn't increment
  })

  it('BUGFIX: LaserZap stops ticking after isDestroyed without frame-end drain (negative)', () => {
    const info = { ...DEFAULT_LASER_ZAP_INFO, duration: 2, damageDuration: 0, hitAnim: null }
    const zap = new LaserZap(info, createProjectileArgs())
    const world = createMockWorld()
    zap.tick(world) // tick 1
    zap.tick(world) // tick 2, should trigger disposal
    expect(zap.isDestroyed).toBe(true)
    // tick 3+ should be no-ops (regression: was silently re-entering before fix)
    zap.tick(world)
    zap.tick(world)
    zap.tick(world)
    expect(zap.ticks).toBe(2) // no further ticks
  })
})
