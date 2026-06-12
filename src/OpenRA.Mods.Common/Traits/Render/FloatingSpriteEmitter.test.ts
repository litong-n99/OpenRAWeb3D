/**
 * FloatingSpriteEmitter.test.ts — FloatingSpriteEmitter migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, tick behavior, duration management,
 * damage response, condition enable/disable, LOD tiers, and dispose behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — mock only the modules used by the file under test
// (FloatingSpriteEmitter only imports types from @babylonjs/core)
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Particles/gpuParticleSystem', () => ({
  GPUParticleSystem: class MockGPUParticleSystem {
    dispose = vi.fn()
    start = vi.fn()
    stop = vi.fn()
  },
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  FloatingSpriteEmitter,
  DEFAULT_EMITTER_INFO,
  type FloatingSpriteEmitterInfo,
  type INotifyDamage,
  type AttackInfo,
} from './FloatingSpriteEmitter'

import { WVec } from '../../../OpenRA.Game/WVec'
import { WDist } from '../../../OpenRA.Game/WDist'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock IGameActor for FloatingSpriteEmitter tests.
 */
function createMockActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: { internalName: 'test_player' } as any,
    world: {
      localRandom: Math.random,
      sharedRandom: Math.random,
    } as any,
    info: { name: 'test_actor' } as any,
    ...overrides,
  } as IGameActor
}

/**
 * Create a minimal mock AttackInfo for INotifyDamage tests.
 */
function createMockAttackInfo(overrides: Partial<AttackInfo> = {}): AttackInfo {
  return {
    damage: { value: 10 },
    attacker: createMockActor({ actorId: 999 }) as IGameActor,
    damageState: 2,
    previousDamageState: 1,
    ...overrides,
  }
}

/**
 * Create default emitter info for testing.
 */
function createTestInfo(overrides: Partial<FloatingSpriteEmitterInfo> = {}): FloatingSpriteEmitterInfo {
  return {
    ...DEFAULT_EMITTER_INFO,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests: FloatingSpriteEmitterInfo defaults
// ---------------------------------------------------------------------------

describe('FloatingSpriteEmitterInfo', () => {
  it('should have correct defaults', () => {
    const info = createTestInfo()
    expect(info.lifetime).toEqual([25])
    expect(info.duration).toBe(-1)
    expect(info.resetOnDamaged).toBe(true)
    expect(info.offset).toEqual([WVec.Zero])
    expect(info.speed).toEqual([WDist.Zero])
    expect(info.gravity).toEqual([WDist.Zero])
    expect(info.randomFacing).toBe(true)
    expect(info.turnRate).toBe(0)
    expect(info.randomRate).toBe(4)
    expect(info.spawnFrequency).toEqual([1])
    expect(info.image).toBe('smoke')
    expect(info.sequences).toEqual(['particles'])
    expect(info.palette).toBe('effect')
    expect(info.isPlayerPalette).toBe(false)
  })

  it('should allow overriding defaults', () => {
    const info = createTestInfo({
      duration: 100,
      randomFacing: false,
      image: 'fire',
      palette: 'player',
    })
    expect(info.duration).toBe(100)
    expect(info.randomFacing).toBe(false)
    expect(info.image).toBe('fire')
    expect(info.palette).toBe('player')
  })
})

// ---------------------------------------------------------------------------
// Tests: FloatingSpriteEmitter construction
// ---------------------------------------------------------------------------

describe('FloatingSpriteEmitter', () => {
  let info: FloatingSpriteEmitterInfo

  beforeEach(() => {
    info = createTestInfo()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create with default info', () => {
      const emitter = new FloatingSpriteEmitter(info)
      expect(emitter).toBeInstanceOf(FloatingSpriteEmitter)
      expect(emitter.info).toBe(info)
    })

    it('should initialize with random offset', () => {
      const multiOffset = createTestInfo({
        offset: [new WVec(10, 0, 0), new WVec(20, 0, 0), new WVec(30, 0, 0)],
      })
      const emitter = new FloatingSpriteEmitter(multiOffset)
      expect(emitter.offset).toBeInstanceOf(WVec)
    })

    it('should initialize with duration from info', () => {
      const limitedDuration = createTestInfo({ duration: 50 })
      const emitter = new FloatingSpriteEmitter(limitedDuration)
      expect(emitter.remainingDuration).toBe(50)
    })

    it('should initialize with infinite duration (-1)', () => {
      const infiniteDuration = createTestInfo({ duration: -1 })
      const emitter = new FloatingSpriteEmitter(infiniteDuration)
      expect(emitter.remainingDuration).toBe(-1)
    })

    it('should start with not-enabled state (disposed=false, enabled=true by default)', () => {
      const emitter = new FloatingSpriteEmitter(info)
      expect(emitter.disposed).toBe(false)
      // Without conditions, trait is enabled by default (ConditionalTrait default)
    })
  })

  // -----------------------------------------------------------------------
  // Tick behavior
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('should skip tick when actor is not in world', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor({ isInWorld: false })
      const durationBefore = emitter.remainingDuration

      emitter.tick(actor)
      expect(emitter.remainingDuration).toBe(durationBefore) // Should not change
    })

    it('should skip tick when trait is disabled', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor()
      // Force disable
      ;(emitter as any)._enabled = false

      const durationBefore = emitter.remainingDuration
      emitter.tick(actor)
      expect(emitter.remainingDuration).toBe(durationBefore)
    })

    it('should decrement duration on tick when duration > 0', () => {
      const limitedInfo = createTestInfo({ duration: 10 })
      const emitter = new FloatingSpriteEmitter(limitedInfo)
      const actor = createMockActor()

      emitter.tick(actor)
      expect(emitter.remainingDuration).toBe(9)
    })

    it('should stop ticking when duration expires', () => {
      const limitedInfo = createTestInfo({ duration: 3 })
      const emitter = new FloatingSpriteEmitter(limitedInfo)
      const actor = createMockActor()

      // duration=3: tick1: --3<0 = 2<0 = false, continue
      // tick2: --2<0 = 1<0 = false, continue
      // tick3: --1<0 = 0<0 = false, continue
      // tick4: --0<0 = -1<0 = true, return early (stops)
      emitter.tick(actor) // duration: 2
      emitter.tick(actor) // duration: 1
      emitter.tick(actor) // duration: 0
      emitter.tick(actor) // duration: -1 → stops, returns early
      expect(emitter.remainingDuration).toBe(-1)
    })

    it('should not decrement duration when duration is -1 (infinite)', () => {
      const infiniteInfo = createTestInfo({ duration: -1 })
      const emitter = new FloatingSpriteEmitter(infiniteInfo)
      const actor = createMockActor()

      emitter.tick(actor)
      expect(emitter.remainingDuration).toBe(-1) // -1 stays -1, check: duration > 0 is false
    })

    it('should decrement ticks counter on each tick when ticks > 0', () => {
      const quickInfo = createTestInfo({ spawnFrequency: [10] })
      const emitter = new FloatingSpriteEmitter(quickInfo)
      const actor = createMockActor()

      // Set ticks to a known value > 0 (avoiding respawn at 0)
      ;(emitter as any)._ticks = 5
      emitter.tick(actor)
      expect(emitter.ticksUntilSpawn).toBe(4)
    })

    it('should respawn when ticks counter reaches zero', () => {
      const quickInfo = createTestInfo({ spawnFrequency: [1] })
      const emitter = new FloatingSpriteEmitter(quickInfo)
      const actor = createMockActor()

      // First tick: ticks goes from 0 to -1, spawn triggers, ticks reset
      emitter.tick(actor)
      // ticks should be reset to a new random value
      expect(emitter.ticksUntilSpawn).toBeGreaterThanOrEqual(0)
    })
  })

  // -----------------------------------------------------------------------
  // Trait lifecycle
  // -----------------------------------------------------------------------

  describe('traitEnabled', () => {
    it('should reset duration when trait is re-enabled', () => {
      const limitedInfo = createTestInfo({ duration: 100 })
      const emitter = new FloatingSpriteEmitter(limitedInfo)
      const actor = createMockActor()

      // Deplete some duration
      emitter.tick(actor)
      emitter.tick(actor) // duration now 98

      // Re-enable (access protected method via bracket notation for testing)
      ;(emitter as any).traitEnabled(actor)
      expect(emitter.remainingDuration).toBe(100)
    })

    it('should reset offset when trait is re-enabled', () => {
      const multiOffset = createTestInfo({
        offset: [new WVec(10, 0, 0), new WVec(20, 0, 0)],
      })
      const emitter = new FloatingSpriteEmitter(multiOffset)
      const actor = createMockActor()

      ;(emitter as any).traitEnabled(actor)
      // Offset should be re-randomized
      expect(emitter.offset).toBeInstanceOf(WVec)
    })

    it('should reset ticks when trait is re-enabled', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor()

      emitter.tick(actor) // ticks decreases
      ;(emitter as any).traitEnabled(actor)
      expect(emitter.ticksUntilSpawn).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyDamage
  // -----------------------------------------------------------------------

  describe('damaged', () => {
    it('should reset duration when damaged and resetOnDamaged is true', () => {
      const limitedInfo = createTestInfo({ duration: 100, resetOnDamaged: true })
      const emitter = new FloatingSpriteEmitter(limitedInfo)
      const actor = createMockActor()
      const attackInfo = createMockAttackInfo()

      // Deplete some duration
      emitter.tick(actor) // 99
      emitter.tick(actor) // 98

      emitter.damaged(actor, attackInfo)
      expect(emitter.remainingDuration).toBe(100)
    })

    it('should not reset duration when resetOnDamaged is false', () => {
      const noResetInfo = createTestInfo({ duration: 100, resetOnDamaged: false })
      const emitter = new FloatingSpriteEmitter(noResetInfo)
      const actor = createMockActor()
      const attackInfo = createMockAttackInfo()

      emitter.tick(actor) // 99
      emitter.tick(actor) // 98

      emitter.damaged(actor, attackInfo)
      expect(emitter.remainingDuration).toBe(98) // Should NOT reset
    })

    it('should reset offset only (not duration) when duration is -1', () => {
      const infiniteInfo = createTestInfo({ duration: -1, resetOnDamaged: true })
      const emitter = new FloatingSpriteEmitter(infiniteInfo)
      const actor = createMockActor()
      const attackInfo = createMockAttackInfo()

      emitter.damaged(actor, attackInfo)
      expect(emitter.remainingDuration).toBe(-1) // Duration stays -1
    })
  })

  // -----------------------------------------------------------------------
  // Attach / detach
  // -----------------------------------------------------------------------

  describe('attach', () => {
    it('should set actor reference on attach', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor()

      emitter.attach(actor)
      expect(emitter.actor).toBe(actor)
      expect(emitter.disposed).toBe(false)
    })

    it('should handle attach with actor that has no IFacing', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor()

      expect(() => emitter.attach(actor)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should set disposed flag', () => {
      const emitter = new FloatingSpriteEmitter(info)
      expect(emitter.disposed).toBe(false)

      emitter.dispose()
      expect(emitter.disposed).toBe(true)
    })

    it('should clear actor reference on dispose', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor()
      emitter.attach(actor)

      emitter.dispose()
      expect(emitter.actor).toBeNull()
    })

    it('should not throw when called twice', () => {
      const emitter = new FloatingSpriteEmitter(info)
      emitter.dispose()
      expect(() => emitter.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // LOD tiers
  // -----------------------------------------------------------------------

  describe('LOD tiers', () => {
    it('should start at LOD tier 0 (full)', () => {
      const emitter = new FloatingSpriteEmitter(info)
      expect(emitter.currentLodTier).toBe(0)
    })

    it('should evaluate LOD every ~25 ticks', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor()

      // Tick 24 times — should still be tier 0
      for (let i = 0; i < 24; i++) {
        emitter.tick(actor)
      }
      // LOD evaluation doesn't change without camera distance check
      expect(emitter.currentLodTier).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Particle system state
  // -----------------------------------------------------------------------

  describe('particleSystem', () => {
    it('should start with no particle system', () => {
      const emitter = new FloatingSpriteEmitter(info)
      expect(emitter.particleSystem).toBeNull()
      expect(emitter.particleSystemStarted).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle disposed actor gracefully', () => {
      const emitter = new FloatingSpriteEmitter(info)
      const actor = createMockActor({ disposed: true, isInWorld: true })

      // Tick should check isInWorld first, but disposed actor can still be ticked
      // The trait doesn't check disposed explicitly (that's up to the world)
      emitter.tick(actor)
    })

    it('should handle zero spawn frequency range (min === max)', () => {
      const sameFreq = createTestInfo({ spawnFrequency: [3, 3] })
      const emitter = new FloatingSpriteEmitter(sameFreq)
      const actor = createMockActor()

      // Force ticks to trigger spawn
      ;(emitter as any)._ticks = -1
      emitter.tick(actor)
      // ticks should be reset to exactly 3
      expect(emitter.ticksUntilSpawn).toBe(3)
    })

    it('should handle empty offset array', () => {
      const emptyOffset = createTestInfo({ offset: [] })
      const emitter = new FloatingSpriteEmitter(emptyOffset)
      expect(emitter.offset).toEqual(WVec.Zero)
    })

    it('should handle single element arrays for all range params', () => {
      const singleInfo = createTestInfo({
        lifetime: [30],
        spawnFrequency: [2],
        offset: [new WVec(5, 5, 0)],
        speed: [new WDist(100)],
        gravity: [new WDist(10)],
      })
      const emitter = new FloatingSpriteEmitter(singleInfo)
      expect(emitter).toBeInstanceOf(FloatingSpriteEmitter)
    })

    it('should implement INotifyDamage', () => {
      const emitter = new FloatingSpriteEmitter(info)
      expect(typeof emitter.damaged).toBe('function')
    })

    it('should have static interfaces array', () => {
      expect(FloatingSpriteEmitter.interfaces).toContain('ITick')
      expect(FloatingSpriteEmitter.interfaces).toContain('INotifyDamage')
      expect(FloatingSpriteEmitter.interfaces).toContain('FloatingSpriteEmitter')
      expect(FloatingSpriteEmitter.interfaces).toContain('component')
    })
  })

  // -----------------------------------------------------------------------
  // Random utility methods
  // -----------------------------------------------------------------------

  describe('random utilities', () => {
    it('should produce consistent results for single-element offset', () => {
      const singleOffset = createTestInfo({ offset: [new WVec(42, 42, 0)] })
      const emitter = new FloatingSpriteEmitter(singleOffset)
      expect(emitter.offset.X).toBe(42)
      expect(emitter.offset.Y).toBe(42)
      expect(emitter.offset.Z).toBe(0)
    })

    it('should pick one of multiple offsets', () => {
      const offsets = [
        new WVec(1, 0, 0),
        new WVec(2, 0, 0),
        new WVec(3, 0, 0),
      ]
      const multiOffset = createTestInfo({ offset: offsets })
      const emitter = new FloatingSpriteEmitter(multiOffset)
      // Offset should be one of the candidates
      const validXValues = [1, 2, 3]
      expect(validXValues).toContain(emitter.offset.X)
      expect(emitter.offset.Y).toBe(0)
      expect(emitter.offset.Z).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: INotifyDamage interface (compile-time + runtime check)
// ---------------------------------------------------------------------------

describe('INotifyDamage', () => {
  it('should be implementable', () => {
    const handler: INotifyDamage = {
      damaged(_actor: IGameActor, _attackInfo: AttackInfo): void {
        // no-op
      },
    }
    expect(typeof handler.damaged).toBe('function')
  })
})
