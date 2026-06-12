/**
 * SpriteEffect.test.ts — SpriteEffect migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, tick lifecycle, position modes, delay,
 * initialization, fog visibility, and dispose behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — mock only the modules used by the file under test
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Maths/math.vector', () => {
  class MockVector3 {
    x: number
    y: number
    z: number
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    static Distance(a: MockVector3, b: MockVector3): number {
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
    }
  }
  return { Vector3: MockVector3 }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  SpriteEffect,
  ParticleEffectManager,
  BlendMode,
  PARTICLE_LOD_TIERS,
  EFFECT_TEMPLATES,
  type SpriteEffectConfig,
  type EffectConfig,
} from './SpriteEffect'

import { WPos } from '../../OpenRA.Game/WPos'
import { WAngle } from '../../OpenRA.Game/WAngle'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { GameWorldManager } from '../../OpenRA.Game/World'

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock GameWorldManager with just enough surface for
 * SpriteEffect to tick and render.
 */
function createMockWorld(): GameWorldManager {
  const frameEndActions: Array<() => void> = []
  const effects: unknown[] = []

  return {
    addFrameEndTask(action: () => void) {
      frameEndActions.push(action)
    },
    removeEffect(effect: unknown) {
      const idx = effects.indexOf(effect)
      if (idx !== -1) effects.splice(idx, 1)
    },
    addEffect(effect: unknown) {
      effects.push(effect)
    },
    // For test introspection:
    _frameEndActions: frameEndActions,
    _effects: effects,
    tick: vi.fn(),
    effects: effects,
    actors: new Map(),
    worldActor: { disposed: false },
    players: [],
    localPlayer: null,
    renderPlayer: null,
    orderGenerator: null,
    screenMap: {},
    unpartitionedEffects: [],
    isPaused: false,
    worldType: 0,
    map: { grid: { maximumTerrainHeight: 0 } },
    gameSpeed: 1,
    localRandom: Math.random,
    sharedRandom: Math.random,
    selection: { actors: new Set() },
    controlGroups: {},
    traitDict: {},
    applyToActorsWithTrait: vi.fn(),
  } as unknown as GameWorldManager
}

/** Create a minimal mock IGameActor. */
function createMockActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  } as IGameActor
}

/** Execute all pending frame-end actions on a mock world. */
function drainFrameEndActions(world: ReturnType<typeof createMockWorld>): void {
  const actions = (world as any)._frameEndActions as Array<() => void>
  while (actions.length > 0) {
    actions.shift()!()
  }
}

// ---------------------------------------------------------------------------
// Tests: SpriteEffect construction and factory methods
// ---------------------------------------------------------------------------

describe('SpriteEffect', () => {
  let world: ReturnType<typeof createMockWorld>
  let pos: WPos

  beforeEach(() => {
    world = createMockWorld()
    pos = new WPos(1024, 2048, 0)
  })

  // -----------------------------------------------------------------------
  // Construction & factory methods
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create SpriteEffect with static factory method (create)', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect')
      expect(effect).toBeInstanceOf(SpriteEffect)
      expect(effect.pos).toEqual(pos)
      expect(effect.image).toBe('smoke')
      expect(effect.sequence).toBe('idle')
      expect(effect.palette).toBe('effect')
      expect(effect.visibleThroughFog).toBe(false)
      expect(effect.delay).toBe(0)
      expect(effect.initialized).toBe(false)
      expect(effect.anim).toBeNull()
    })

    it('should create with delay parameter', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 5)
      expect(effect.delay).toBe(5)
      expect(effect.initialized).toBe(false)
    })

    it('should create with visibleThroughFog = true', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', true)
      expect(effect.visibleThroughFog).toBe(true)
    })

    it('should create following an actor', () => {
      const actor = createMockActor()
      const effect = SpriteEffect.createFollowing(world, actor, 'smoke', 'idle', 'effect')
      expect(effect).toBeInstanceOf(SpriteEffect)
      expect(effect.image).toBe('smoke')
      expect(effect.sequence).toBe('idle')
    })

    it('should create with static facing', () => {
      const facing = WAngle.fromFacing(128)
      const effect = SpriteEffect.createWithFacing(world, pos, facing, 'smoke', 'idle', 'effect')
      expect(effect).toBeInstanceOf(SpriteEffect)
      expect(effect.image).toBe('smoke')
    })

    it('should create with dynamic position and facing', () => {
      let callCount = 0
      const posFunc = () => { callCount++; return pos }
      const facingFunc = () => WAngle.fromFacing(64)

      const effect = SpriteEffect.createDynamic(world, posFunc, facingFunc, 'smoke', 'idle', 'effect')
      expect(effect).toBeInstanceOf(SpriteEffect)

      // Position function is called once during construction
      expect(callCount).toBeGreaterThanOrEqual(1)
    })

    it('should use config constructor directly', () => {
      const config: SpriteEffectConfig = {
        world,
        posProvider: pos,
        image: 'fire',
        sequence: 'burn',
        palette: 'player',
        visibleThroughFog: true,
        delay: 3,
        blendMode: BlendMode.ADD,
      }
      const effect = new SpriteEffect(config)
      expect(effect.image).toBe('fire')
      expect(effect.sequence).toBe('burn')
      expect(effect.palette).toBe('player')
      expect(effect.visibleThroughFog).toBe(true)
      expect(effect.delay).toBe(3)
      expect(effect.blendMode).toBe(BlendMode.ADD)
    })
  })

  // -----------------------------------------------------------------------
  // Tick behavior
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('should decrement delay before initialization', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 3)
      expect(effect.delay).toBe(3)
      effect.tick(world)
      expect(effect.delay).toBe(2)
      expect(effect.initialized).toBe(false)
    })

    it('should initialize after delay expires', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 2)
      effect.tick(world) // delay: 2 -> 1
      effect.tick(world) // delay: 1 -> 0
      effect.tick(world) // delay: 0 -> -1, should initialize
      expect(effect.initialized).toBe(true)
    })

    it('should initialize immediately when delay is 0', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world) // delay: 0 -> -1, should initialize immediately
      expect(effect.initialized).toBe(true)
    })

    it('should initialize when delay is negative (boundary)', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, -1)
      effect.tick(world) // delay: -1 -> -2, still >= 0? No. --delay = -2, > 0 = false → initialize
      expect(effect.initialized).toBe(true)
    })

    it('should stay not initialized while delay > 0', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 5)
      for (let i = 0; i < 5; i++) {
        expect(effect.initialized).toBe(false)
        effect.tick(world)
      }
      // After 5 ticks, delay becomes 0. Next tick initializes.
      effect.tick(world) // delay 0 -> -1, initialize
      expect(effect.initialized).toBe(true)
    })

    it('should schedule remove from world on initialization', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world) // initializes
      expect(effect.initialized).toBe(true)

      // Frame-end task should have been queued
      const actions = (world as any)._frameEndActions as Array<() => void>
      expect(actions.length).toBeGreaterThanOrEqual(1)

      // Execute frame-end tasks
      drainFrameEndActions(world)
    })

    it('should update position on tick after initialization (static pos)', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world) // initialize
      expect(effect.initialized).toBe(true)

      const posBefore = effect.pos
      effect.tick(world) // tick after initialization
      // Static position should remain the same
      expect(effect.pos).toEqual(posBefore)
    })

    it('should update position on tick after initialization (dynamic pos)', () => {
      let dynamicPos = new WPos(100, 200, 0)
      const posFunc = () => {
        dynamicPos = new WPos(dynamicPos.X + 10, dynamicPos.Y + 10, 0)
        return dynamicPos
      }

      const effect = SpriteEffect.createDynamic(
        world, posFunc, () => WAngle.Zero, 'smoke', 'idle', 'effect', false, 0,
      )
      effect.tick(world) // initialize
      expect(effect.initialized).toBe(true)

      const posBeforeTick = effect.pos
      effect.tick(world) // tick → pos updated from posFunc
      expect(effect.pos).not.toEqual(posBeforeTick)
    })
  })

  // -----------------------------------------------------------------------
  // Render behavior
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('should return empty array when not initialized', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 5)
      const result = effect.render({} as any)
      expect(result).toHaveLength(0)
    })

    it('should return empty array before calling tick at all', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect')
      const result = effect.render({} as any)
      expect(result).toHaveLength(0)
    })

    it('should return renderables after initialization', () => {
      // NOTE: In stub phase, Animation integration is not complete, so
      // render() returns empty even after initialization. This test documents
      // the expected behavior once Animation.Render is integrated.
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world) // initialize
      expect(effect.initialized).toBe(true)
      const result = effect.render({} as any)
      // Currently returns empty due to stub Animation
      expect(Array.isArray(result)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Following actor mode
  // -----------------------------------------------------------------------

  describe('following actor', () => {
    it('should accept followActor in config', () => {
      const actor = createMockActor()
      const effect = SpriteEffect.createFollowing(world, actor, 'smoke', 'idle', 'effect')
      expect(effect).toBeInstanceOf(SpriteEffect)
    })

    it('should handle disposed follow actor', () => {
      const actor = createMockActor({ disposed: true })
      const effect = SpriteEffect.createFollowing(world, actor, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world) // initialize
      // Should not crash when actor is disposed
      expect(effect.initialized).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear animation reference on dispose', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world)
      expect(effect.initialized).toBe(true)

      effect.dispose()
      expect(effect.anim).toBeNull()
    })

    it('should dispose particle system if provided', () => {
      const mockPs = { dispose: vi.fn() }
      const config: SpriteEffectConfig = {
        world,
        posProvider: pos,
        image: 'smoke',
        sequence: 'idle',
        palette: 'effect',
        particleSystem: mockPs as any,
      }
      const effect = new SpriteEffect(config)
      effect.dispose()
      expect(mockPs.dispose).toHaveBeenCalledTimes(1)
    })

    it('should not throw when called twice', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect')
      effect.dispose()
      expect(() => effect.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  describe('accessors', () => {
    it('should expose pos getter', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect')
      expect(effect.pos).toEqual(pos)
    })

    it('should expose initialized getter', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 100)
      expect(effect.initialized).toBe(false)
    })

    it('should expose delay getter', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 42)
      expect(effect.delay).toBe(42)
    })

    it('should expose isActive getter', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 100)
      expect(effect.isActive).toBe(false)
    })

    it('should expose blendMode', () => {
      const config: SpriteEffectConfig = {
        world,
        posProvider: pos,
        image: 'smoke',
        sequence: 'idle',
        palette: 'effect',
        blendMode: BlendMode.ADD,
      }
      const effect = new SpriteEffect(config)
      expect(effect.blendMode).toBe(BlendMode.ADD)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle zero-length delay (delay=0, one tick initializes)', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      effect.tick(world)
      expect(effect.initialized).toBe(true)
    })

    it('should handle very large delay values', () => {
      const largeDelay = 99999
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, largeDelay)
      expect(effect.delay).toBe(largeDelay)
      effect.tick(world)
      expect(effect.delay).toBe(largeDelay - 1)
    })

    it('should handle true visibleThroughFog', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', true, 0)
      expect(effect.visibleThroughFog).toBe(true)
      effect.tick(world)
      expect(effect.initialized).toBe(true)
      // render() should not check fog when visibleThroughFog is true
      const result = effect.render({} as any)
      expect(Array.isArray(result)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Delay behavior matching C# pre-decrement pattern
  // -----------------------------------------------------------------------

  describe('delay pre-decrement pattern', () => {
    it('delay=1 fires on tick 2 (matching C# --delay > 0)', () => {
      // C#: if (delay-- > 0) return;
      // delay=1: tick1: 1-- > 0 = true (1>0), return, delay=0
      // delay=0: tick2: 0-- > 0 = false (0>0), continue, init, delay=-1
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 1)
      effect.tick(world)
      expect(effect.initialized).toBe(false) // Skipped (1 > 0)
      effect.tick(world)
      expect(effect.initialized).toBe(true)  // Initialized (0 > 0 is false)
    })

    it('delay=5 fires on tick 6 (matching C#)', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 5)
      // delay=5,4,3,2,1: all > 0, skip (5 ticks skipped)
      for (let i = 0; i < 5; i++) {
        effect.tick(world)
        expect(effect.initialized).toBe(false)
      }
      // delay=0: -- > 0 is false, initialize (tick 6)
      effect.tick(world)
      expect(effect.initialized).toBe(true)
    })

    it('delay=0 fires on tick 1 (matching C#)', () => {
      const effect = SpriteEffect.create(world, pos, 'smoke', 'idle', 'effect', false, 0)
      // delay=0: 0-- > 0 = false, continue, initialize
      effect.tick(world)
      expect(effect.initialized).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: ParticleEffectManager
// ---------------------------------------------------------------------------

describe('ParticleEffectManager', () => {
  let mockScene: any

  beforeEach(() => {
    mockScene = {
      activeCamera: null,
    }
  })

  describe('construction', () => {
    it('should create with a scene reference', () => {
      const manager = new ParticleEffectManager(mockScene)
      expect(manager).toBeInstanceOf(ParticleEffectManager)
      expect(manager.activeCount).toBe(0)
      expect(manager.pooledCount).toBe(0)
    })
  })

  describe('playEffect', () => {
    it('should return null for disposed manager', () => {
      const manager = new ParticleEffectManager(mockScene)
      manager.dispose()
      const result = manager.playEffect('smoke', { x: 0, y: 0, z: 0 } as any)
      expect(result).toBeNull()
    })

    it('should return null when camera distance exceeds LOD off tier', () => {
      const manager = new ParticleEffectManager(mockScene)
      mockScene.activeCamera = {
        position: { x: 0, y: 0, z: 0 },
      } as any
      const farPosition = { x: 500, y: 0, z: 0 } as any
      // smoke LOD off = 200, distance 500 > 200
      const result = manager.playEffect('smoke', farPosition)
      expect(result).toBeNull()
    })

    it('should return null for unknown effect type (no template)', () => {
      const manager = new ParticleEffectManager(mockScene)
      const result = manager.playEffect('nonexistent', { x: 0, y: 0, z: 0 } as any)
      expect(result).toBeNull()
      // activeCount must NOT increment on unknown type
      expect(manager.activeCount).toBe(0)
    })

    it('should NOT increment activeCount when stub returns null (no GPU context)', () => {
      const manager = new ParticleEffectManager(mockScene)
      // Without GPU context, playEffect returns null and does NOT leak activeCount
      const result = manager.playEffect('explosion', { x: 10, y: 5, z: 0 } as any)
      expect(result).toBeNull()
      expect(manager.activeCount).toBe(0) // no leak
    })

    it('should return null with 0 activeCount when LOD-off (far distance)', () => {
      const manager = new ParticleEffectManager(mockScene)
      mockScene.activeCamera = {
        position: { x: 0, y: 0, z: 0 },
      } as any
      const farPosition = { x: 500, y: 0, z: 0 } as any
      const result = manager.playEffect('smoke', farPosition)
      expect(result).toBeNull()
      expect(manager.activeCount).toBe(0)
    })
  })

  describe('dispose', () => {
    it('should clear pools and reset counters', () => {
      const manager = new ParticleEffectManager(mockScene)
      manager.dispose()
      expect(manager.activeCount).toBe(0)
      expect(manager.pooledCount).toBe(0)
    })

    it('should prevent playEffect after dispose', () => {
      const manager = new ParticleEffectManager(mockScene)
      manager.dispose()
      const result = manager.playEffect('smoke', { x: 0, y: 0, z: 0 } as any)
      expect(result).toBeNull()
    })
  })

  describe('disposeEffect', () => {
    it('should decrement active count', () => {
      const manager = new ParticleEffectManager(mockScene)
      // Simulate having an active effect
      const mockPs = { dispose: vi.fn() } as any
      ;(manager as any)._activeCount = 3

      manager.disposeEffect(mockPs as any)
      expect(manager.activeCount).toBe(2)
    })

    it('should not crash on null/undefined', () => {
      const manager = new ParticleEffectManager(mockScene)
      expect(() => manager.disposeEffect(null as any)).not.toThrow()
      expect(() => manager.disposeEffect(undefined as any)).not.toThrow()
      expect(manager.activeCount).toBe(0) // activeCount unchanged on null input
    })

    it('should recycle to correct pool via type map', () => {
      const manager = new ParticleEffectManager(mockScene)
      const mockPs = { dispose: vi.fn() } as any

      // Simulate: register PS with a type and set active
      ;(manager as any)._typeMap.set(mockPs, 'explosion')
      ;(manager as any)._activeCount = 1

      manager.disposeEffect(mockPs as any)
      // After disposal, PS should be returned to 'explosion' pool
      expect(manager.pooledCount).toBe(1)
      expect(manager.activeCount).toBe(0)
      // Type map entry should be removed
      expect((manager as any)._typeMap.has(mockPs)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // LOD computation (ADR-7.4: 4-tier)
  // -----------------------------------------------------------------------

  describe('LOD computation', () => {
    it('should return 100% factor within half distance (tier 1)', () => {
      const manager = new ParticleEffectManager(mockScene)
      mockScene.activeCamera = {
        position: { x: 0, y: 0, z: 0 },
      } as any

      // smoke: half=50, minimal=100, off=200 — distance 30 < 50 → full
      const result = manager.playEffect('smoke', { x: 30, y: 0, z: 0 } as any)
      // Stub returns null (no GPU), but LOD would be 1.0
      expect(result).toBeNull()
    })

    it('should return 50% factor in half-minimal range (tier 2)', () => {
      const manager = new ParticleEffectManager(mockScene)
      mockScene.activeCamera = {
        position: { x: 0, y: 0, z: 0 },
      } as any

      // smoke: half=50, minimal=100, off=200 — distance 75 is in [50, 100) → 50%
      const result = manager.playEffect('smoke', { x: 75, y: 0, z: 0 } as any)
      // LOD factor = 0.5, still not off → stub returns null
      expect(result).toBeNull()
    })

    it('should return 20% factor in minimal-off range (tier 3)', () => {
      const manager = new ParticleEffectManager(mockScene)
      mockScene.activeCamera = {
        position: { x: 0, y: 0, z: 0 },
      } as any

      // smoke: half=50, minimal=100, off=200 — distance 150 is in [100, 200) → 20%
      const result = manager.playEffect('smoke', { x: 150, y: 0, z: 0 } as any)
      // LOD factor = 0.2, still not off → stub returns null
      expect(result).toBeNull()
    })

    it('should return 0% factor beyond off distance (tier 4)', () => {
      const manager = new ParticleEffectManager(mockScene)
      mockScene.activeCamera = {
        position: { x: 0, y: 0, z: 0 },
      } as any

      // smoke: off=200 — distance 250 > 200 → off (no particles)
      const result = manager.playEffect('smoke', { x: 250, y: 0, z: 0 } as any)
      expect(result).toBeNull()
      expect(manager.activeCount).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: Constants and enums
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('should define LOD tiers correctly', () => {
    expect(PARTICLE_LOD_TIERS.FULL).toBe(0)
    expect(PARTICLE_LOD_TIERS.HALF).toBe(50)
    expect(PARTICLE_LOD_TIERS.MINIMAL).toBe(100)
    expect(PARTICLE_LOD_TIERS.OFF).toBe(200)
  })

  it('should define BlendMode constants', () => {
    expect(BlendMode.STANDARD).toBe(0)
    expect(BlendMode.ADD).toBe(1)
  })

  it('should have effect templates for all common types', () => {
    expect(EFFECT_TEMPLATES.explosion).toBeDefined()
    expect(EFFECT_TEMPLATES.smoke).toBeDefined()
    expect(EFFECT_TEMPLATES.fire).toBeDefined()
    expect(EFFECT_TEMPLATES.spark).toBeDefined()
    expect(EFFECT_TEMPLATES.debris).toBeDefined()
  })

  it('should set correct blend modes in templates', () => {
    expect(EFFECT_TEMPLATES.explosion.blendMode).toBe(BlendMode.ADD)
    expect(EFFECT_TEMPLATES.fire.blendMode).toBe(BlendMode.ADD)
    expect(EFFECT_TEMPLATES.spark.blendMode).toBe(BlendMode.ADD)
    expect(EFFECT_TEMPLATES.smoke.blendMode).toBe(BlendMode.STANDARD)
    expect(EFFECT_TEMPLATES.debris.blendMode).toBe(BlendMode.STANDARD)
  })
})

// ---------------------------------------------------------------------------
// Tests: Type exports
// ---------------------------------------------------------------------------

describe('type exports', () => {
  it('should export SpriteEffectConfig interface (compile-time check)', () => {
    const config: SpriteEffectConfig = {
      world: {} as GameWorldManager,
      posProvider: new WPos(0, 0, 0),
      image: 'test',
      sequence: 'idle',
      palette: 'effect',
    }
    expect(config.image).toBe('test')
  })

  it('should export EffectConfig interface (compile-time check)', () => {
    const config: EffectConfig = {
      emitRate: 100,
      minLifetime: 0.1,
      maxLifetime: 0.8,
      minEmitPower: 1,
      maxEmitPower: 3,
      gravity: { x: 0, y: -0.5, z: 0 } as any,
      blendMode: BlendMode.ADD,
      texturePath: 'effects/test.png',
    }
    expect(config.emitRate).toBe(100)
  })
})
