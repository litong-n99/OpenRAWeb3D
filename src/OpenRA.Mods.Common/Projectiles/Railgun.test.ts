/**
 * Railgun.test.ts — Railgun unit tests
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
import { Railgun, DEFAULT_RAILGUN_INFO } from './Railgun.js'

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

function createProjArgs(overrides?: Partial<ProjectileArgs>): ProjectileArgs {
  return {
    sourceActor: createMockActor(1), source: new WPos(0, 0, 0), passiveTarget: new WPos(10240, 0, 0),
    guidedTarget: Target.Invalid, weapon: { impact: () => {} } as WeaponStub,
    facing: WAngle.Zero, inaccuracySource: new WDist(1024), random: createMockRandom(),
    ...overrides,
  }
}

describe('Railgun', () => {
  it('creates with default config', () => {
    const rail = new Railgun(createProjArgs(), DEFAULT_RAILGUN_INFO)
    expect(rail.isDestroyed).toBe(false)
    expect(rail.ticks).toBe(0)
  })

  it('applies damage on tick 0', () => {
    const mockImpact = vi.fn()
    const weapon = { impact: mockImpact } as unknown as WeaponStub
    const rail = new Railgun(createProjArgs({ weapon }), DEFAULT_RAILGUN_INFO)
    const world = createMockWorld()
    rail.tick(world)
    expect(mockImpact).toHaveBeenCalledTimes(1)
  })

  it('does not apply damage on subsequent ticks', () => {
    const mockImpact = vi.fn()
    const weapon = { impact: mockImpact } as unknown as WeaponStub
    const rail = new Railgun(createProjArgs({ weapon }), DEFAULT_RAILGUN_INFO)
    const world = createMockWorld()
    rail.tick(world) // tick 0: damage
    rail.tick(world) // tick 1: no damage
    rail.tick(world) // tick 2: no damage
    expect(mockImpact).toHaveBeenCalledTimes(1)
  })

  it('self-removes after duration when animation complete', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, duration: 3 }
    const rail = new Railgun(createProjArgs(), info)
    const world = createMockWorld()
    world.addEffect(rail)
    for (let i = 0; i < 5; i++) rail.tick(world)
    world.drainFrameEndTasks()
    expect(world.effects).not.toContain(rail)
  })

  it('computes helix geometry vectors', () => {
    const rail = new Railgun(createProjArgs({
      source: new WPos(0, 0, 0),
      passiveTarget: new WPos(10240, 0, 0),
    }), DEFAULT_RAILGUN_INFO)
    expect(rail.sourceToTarget).toBeDefined()
    expect(rail.forwardStep).toBeDefined()
    expect(rail.leftVector).toBeDefined()
    expect(rail.upVector).toBeDefined()
    expect(rail.cycleCount).toBeGreaterThanOrEqual(0)
  })

  it('generates helix points', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, quantizationCount: 4, helixPitch: new WDist(512) }
    const rail = new Railgun(createProjArgs({ source: new WPos(0, 0, 0), passiveTarget: new WPos(10240, 0, 0) }), info)
    const points = rail.generateHelixPoints(0)
    expect(points.length).toBeGreaterThan(0)
    // First point should be at source
    expect(points[0]!.X).toBe(0)
    expect(points[0]!.Y).toBeGreaterThanOrEqual(-128)
    expect(points[0]!.Y).toBeLessThanOrEqual(128)
  })

  it('beamAlpha degrades over time', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, beamAlphaDeltaPerTick: -10 }
    const rail = new Railgun(createProjArgs(), info)
    expect(rail.beamAlpha).toBe(255) // default alpha (beamColor[3] = 255, [R=128, G=255, B=255, A=255])
    const world = createMockWorld()
    rail.tick(world)
    expect(rail.beamAlpha).toBe(245) // 255 + (-10)
  })

  it('helixAlpha degrades over time', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, helixAlphaDeltaPerTick: -10 }
    const rail = new Railgun(createProjArgs(), info)
    expect(rail.helixAlpha).toBe(255) // default alpha (helixColor[3] = 255, [R=128, G=255, B=255, A=255])
    rail.tick(createMockWorld())
    expect(rail.helixAlpha).toBe(245) // 255 + (-10)
  })

  it('does not tick when destroyed', () => {
    const mockImpact = vi.fn()
    const weapon = { impact: mockImpact } as unknown as WeaponStub
    const rail = new Railgun(createProjArgs({ weapon }), DEFAULT_RAILGUN_INFO)
    rail.isDestroyed = true
    rail.tick(createMockWorld())
    expect(mockImpact).not.toHaveBeenCalled()
  })

  it('dispose marks destroyed', () => {
    const rail = new Railgun(createProjArgs(), DEFAULT_RAILGUN_INFO)
    rail.dispose()
    expect(rail.isDestroyed).toBe(true)
  })

  it('render returns empty array', () => {
    const rail = new Railgun(createProjArgs(), DEFAULT_RAILGUN_INFO)
    expect(rail.render(null as unknown as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub)).toHaveLength(0)
  })

  it('applies inaccuracy to target', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, inaccuracy: new WDist(10000), inaccuracyType: InaccuracyType.Absolute }
    const rail = new Railgun(createProjArgs(), info)
    // With large absolute inaccuracy, target should be offset
    const origTarget = new WPos(10240, 0, 0)
    const delta = WPos.subtract(rail.target, origTarget)
    // At least one coordinate should be non-zero with large enough inaccuracy
    const hasOffset = delta.X !== 0 || delta.Y !== 0 || delta.Z !== 0
    expect(hasOffset).toBe(true)
  })

  it('helix points scale radius with tick', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, helixRadiusDeltaPerTick: 5, quantizationCount: 4, helixPitch: new WDist(1024) }
    const rail = new Railgun(createProjArgs({ source: new WPos(0, 0, 0), passiveTarget: new WPos(10240, 0, 0) }), info)
    const points0 = rail.generateHelixPoints(0)
    const points5 = rail.generateHelixPoints(5)
    // Distances from the axis should increase with tick for non-zero delta
    const midPoint0 = points0[Math.trunc(points0.length / 2)]!
    const midPoint5 = points5[Math.trunc(points5.length / 2)]!
    const dist0 = Math.sqrt(midPoint0.X * midPoint0.X + midPoint0.Y * midPoint0.Y + midPoint0.Z * midPoint0.Z)
    const dist5 = Math.sqrt(midPoint5.X * midPoint5.X + midPoint5.Y * midPoint5.Y + midPoint5.Z * midPoint5.Z)
    // With positive radius delta, the helix should expand
    expect(dist5).toBeGreaterThan(dist0)
  })

  it('handles zero distance source and target', () => {
    const rail = new Railgun(createProjArgs({ source: new WPos(100, 100, 50), passiveTarget: new WPos(100, 100, 50) }), DEFAULT_RAILGUN_INFO)
    // Should not throw
    expect(rail.forwardStep.X).toBe(0)
    expect(rail.forwardStep.Y).toBe(0)
  })

  // NEGATIVE TESTS — regression guards for B1 (isDestroyed before frame-end task)

  it('BUGFIX: sets isDestroyed=true when duration expires, before frame-end task', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, duration: 1 }
    const rail = new Railgun(createProjArgs(), info)
    const world = createMockWorld()
    rail.tick(world) // tick 0: damage
    rail.tick(world) // tick 1: should trigger disposal (ticks > duration && animationComplete)
    // BEFORE frame-end task executes, isDestroyed should already be true
    expect(rail.isDestroyed).toBe(true)
    // Subsequent tick() should be no-op
    const mockImpact = vi.fn()
    const rail2 = new Railgun(createProjArgs({ weapon: { impact: mockImpact } as unknown as WeaponStub }), { ...DEFAULT_RAILGUN_INFO, duration: 1 })
    rail2.tick(world) // tick 0: damage
    const impactCount0 = mockImpact.mock.calls.length
    rail2.tick(world) // tick 1: disposal, isDestroyed=true
    rail2.tick(world) // tick 2: should be no-op (isDestroyed prevents damage)
    expect(mockImpact.mock.calls.length).toBe(impactCount0 + 0) // no additional damage
  })

  it('BUGFIX: Railgun stops ticking after disposal without frame-end drain (negative)', () => {
    const info = { ...DEFAULT_RAILGUN_INFO, duration: 1 }
    const rail = new Railgun(createProjArgs(), info)
    const world = createMockWorld()
    rail.tick(world) // tick 0
    rail.tick(world) // tick 1: disposal triggered
    expect(rail.isDestroyed).toBe(true)
    // Further ticks should be no-ops
    const ticksBefore = rail.ticks
    rail.tick(world)
    rail.tick(world)
    rail.tick(world)
    expect(rail.ticks).toBe(ticksBefore) // no increments
  })
})
