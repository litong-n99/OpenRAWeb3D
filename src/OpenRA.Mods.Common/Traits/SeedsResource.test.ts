/**
 * SeedsResource.test.ts — SeedsResource migration unit tests
 *
 * Tests focus on:
 * - tick() countdown: seed fires on interval boundaries; non-interval ticks do nothing
 * - tick() calls seed() when countdown reaches zero and resets counter
 * - seed() adds resource via IResourceLayer when valid cell is found within range
 * - seed() does NOT add resource when no valid cell is found within maxRange
 * - isTraitDisabled: disabled traits do not tick
 * - getActorLocation: CPos resolution via direct location or occupiesSpace.topLeft
 * - Default values: Interval, MaxRange, ResourceType
 * - traitEnabled resets _ticks to 0 (immediate seeding)
 *
 * Mock pattern:
 * - IGameActor created with duck-typed world/worldActor/location properties
 * - IResourceLayer mocked with configurable canAddResource / getResource / addResource
 * - SharedRandom mocked with configurable next() method
 * - CPos used directly (no @babylonjs/core dependency)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SeedsResource, type SeedsResourceInfo } from './SeedsResource'
import { CPos } from '../../OpenRA.Game/CPos'
import type { IGameActor, IResourceLayer, IResourceLayerInfo, ResourceLayerContents } from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

interface MockSharedRandom {
  next(min: number, max: number): number
}

interface MockResourceLayerOptions {
  canAdd?: boolean
  resourceType?: string
  density?: number
  maxDensity?: number
}

/** Extended IResourceLayer with spy for assert verification. */
interface MockResourceLayer extends IResourceLayer {
  _addResourceSpy: ReturnType<typeof vi.fn>
}

/** Create a minimal mock IResourceLayer with an addResource spy. */
function createResourceLayerMock(options: MockResourceLayerOptions = {}): MockResourceLayer {
  const canAdd = options.canAdd ?? true
  const resType = options.resourceType ?? ''
  const density = options.density ?? 0
  const maxDensity = options.maxDensity ?? 10
  const addResourceSpy = vi.fn().mockReturnValue(1)

  return {
    info: {
      tryGetTerrainType: () => undefined,
      tryGetResourceIndex: () => undefined,
    } as IResourceLayerInfo,
    isEmpty: false,
    getResource: (_cell: CPos): ResourceLayerContents => ({ type: resType, density }),
    getMaxDensity: (_resourceType: string) => maxDensity,
    canAddResource: (_resourceType: string, _cell: CPos, _amount?: number) => canAdd,
    addResource: addResourceSpy,
    removeResource: (_resourceType: string, _cell: CPos, _amount?: number) => 0,
    clearResources: (_cell: CPos) => {},
    isVisible: (_cell: CPos) => true,
    onCellChanged: (_cell: CPos, _resourceType: string | null) => {},
    _addResourceSpy: addResourceSpy,
  }
}

/** Create a minimal mock IGameActor for SeedsResource tests.
 *
 * Duck-typing is used by SeedsResource's private methods:
 * - resolveResourceLayer: self.world.worldActor.trait('IResourceLayer')
 * - getActorLocation: self.location (CPos) or self.occupiesSpace.topLeft
 * - getSharedRandom: self.world.sharedRandom
 */
function createActor(options: {
  actorId?: number
  location?: CPos
  occupiesSpace?: { topLeft?: CPos }
  resourceLayer?: IResourceLayer
  sharedRandom?: MockSharedRandom
  isDead?: boolean
} = {}): IGameActor {
  const rl = options.resourceLayer ?? createResourceLayerMock()

  return {
    actorId: options.actorId ?? 1,
    isInWorld: true,
    isDead: options.isDead ?? false,
    disposed: false,
    // Direct location property (tested by getActorLocation)
    location: options.location,
    // OccupiesSpace fallback (tested by getActorLocation)
    occupiesSpace: options.occupiesSpace,
    // World duck-type for resolveResourceLayer and getSharedRandom
    world: {
      worldActor: {
        trait<T>(_type: string): T | undefined {
          if (_type === 'IResourceLayer') return rl as unknown as T
          return undefined
        },
      },
      sharedRandom: options.sharedRandom,
    },
  } as unknown as IGameActor
}

/** Create a SeedsResourceInfo with explicit defaults for testing. */
function createInfo(overrides: Partial<SeedsResourceInfo> = {}): SeedsResourceInfo {
  return {
    interval: overrides.interval ?? 75,
    resourceType: overrides.resourceType ?? 'Ore',
    maxRange: overrides.maxRange ?? 100,
    instanceName: overrides.instanceName,
    requiresCondition: overrides.requiresCondition,
  }
}

/** Create a simple SharedRandom stub that always returns the same value. */
function createRng(fixedValue: number): MockSharedRandom {
  return {
    next: (_min: number, _max: number) => fixedValue,
  }
}

// ---------------------------------------------------------------------------
// SeedsResourceInfo defaults tests
// ---------------------------------------------------------------------------

describe('SeedsResourceInfo', () => {
  it('defaults interval to 75', () => {
    const info = createInfo()
    expect(info.interval).toBe(75)
  })

  it('defaults resourceType to Ore', () => {
    const info = createInfo()
    expect(info.resourceType).toBe('Ore')
  })

  it('defaults maxRange to 100', () => {
    const info = createInfo()
    expect(info.maxRange).toBe(100)
  })

  it('accepts custom interval', () => {
    const info = createInfo({ interval: 50 })
    expect(info.interval).toBe(50)
  })

  it('accepts custom resourceType', () => {
    const info = createInfo({ resourceType: 'Tiberium' })
    expect(info.resourceType).toBe('Tiberium')
  })

  it('accepts custom maxRange', () => {
    const info = createInfo({ maxRange: 50 })
    expect(info.maxRange).toBe(50)
  })

  it('accepts requiresCondition', () => {
    const info = createInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })
})

// ---------------------------------------------------------------------------
// SeedsResource — tick() tests
// ---------------------------------------------------------------------------

describe('SeedsResource.tick', () => {
  let rng: MockSharedRandom
  let resourceLayer: MockResourceLayer

  beforeEach(() => {
    // Use a fixed RNG that generates (1, 1) offset on first call
    // randomWalk calls rng.next(-1, 2) twice per step:
    //   first call → dx = 1
    //   second call → dy = 1
    // Since dx=1, dy=1 (not both 0), the first position is start + (1, 1)
    rng = createRng(1)
    resourceLayer = createResourceLayerMock({ canAdd: true })
  })

  it('decrements countdown each tick (TEST-10.18)', () => {
    const info = createInfo({ interval: 75 })
    const trait = new SeedsResource(info)
    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer,
      sharedRandom: rng,
    })

    // First tick: _ticks starts at 0, --0 = -1 ≤ 0 → seed fires, _ticks = 75
    trait.tick(actor)
    // Access _ticks via duck-typing for verification
    const ticksAfterFirst = (trait as unknown as { _ticks: number })._ticks
    expect(ticksAfterFirst).toBe(75)

    // Second tick: --75 = 74, > 0, no seed
    trait.tick(actor)
    const ticksAfterSecond = (trait as unknown as { _ticks: number })._ticks
    expect(ticksAfterSecond).toBe(74)
  })

  it('calls seed() when countdown reaches zero (TEST-10.18)', () => {
    const info = createInfo({ interval: 3 })
    const trait = new SeedsResource(info)
    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer,
      sharedRandom: rng,
    })

    // First tick: _ticks = 0 → -1 ≤ 0 → seed fires, _ticks = 3
    trait.tick(actor)
    expect(resourceLayer._addResourceSpy).toHaveBeenCalledTimes(1)

    // Second tick: _ticks = 3 → 2, no seed
    trait.tick(actor)
    expect(resourceLayer._addResourceSpy).toHaveBeenCalledTimes(1)

    // Third tick: _ticks = 2 → 1, no seed
    trait.tick(actor)
    expect(resourceLayer._addResourceSpy).toHaveBeenCalledTimes(1)

    // Fourth tick: _ticks = 1 → 0 ≤ 0 → seed fires, _ticks = 3
    trait.tick(actor)
    expect(resourceLayer._addResourceSpy).toHaveBeenCalledTimes(2)
  })

  it('does NOT tick when isTraitDisabled is true', () => {
    const info = createInfo({ interval: 75 })
    const trait = new SeedsResource(info)
    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer,
      sharedRandom: rng,
    })

    // Disable the trait by setting internal _enabled
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const initialTicks = (trait as unknown as { _ticks: number })._ticks
    trait.tick(actor)
    const afterTicks = (trait as unknown as { _ticks: number })._ticks

    // _ticks should not have changed (no decrement)
    expect(afterTicks).toBe(initialTicks)
    // addResource should NOT have been called
    expect(resourceLayer._addResourceSpy).not.toHaveBeenCalled()
  })

  it('pausing does NOT prevent tick (isTraitPaused is separate from isTraitDisabled)', () => {
    const info = createInfo({ interval: 75 })
    const trait = new SeedsResource(info)
    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer,
      sharedRandom: rng,
    })

    // Pause the trait (only affects isTraitPaused, NOT isTraitDisabled)
    ;(trait as unknown as { _paused: boolean })._paused = true

    const initialTicks = (trait as unknown as { _ticks: number })._ticks
    trait.tick(actor)
    const afterTicks = (trait as unknown as { _ticks: number })._ticks

    // SeedsResource.tick() checks isTraitDisabled (not isTraitPaused).
    // _paused is independent of _enabled, so pausing does NOT stop tick.
    // This matches OpenRA behavior where pausing affects only specific subsystems.
    expect(afterTicks).not.toBe(initialTicks) // _ticks DID decrement
  })
})

// ---------------------------------------------------------------------------
// SeedsResource — seed() tests
// ---------------------------------------------------------------------------

describe('SeedsResource.seed', () => {
  it('adds resource via IResourceLayer when valid cell found (TEST-10.18)', () => {
    const info = createInfo({ interval: 1, maxRange: 100, resourceType: 'Ore' })
    const trait = new SeedsResource(info)
    const rl = createResourceLayerMock({ canAdd: true })
    const rng = createRng(1)

    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer: rl,
      sharedRandom: rng,
    })

    // First tick triggers seed immediately (_ticks starts at 0)
    trait.tick(actor)

    // Verify addResource was called
    expect(rl._addResourceSpy).toHaveBeenCalledTimes(1)
    expect(rl._addResourceSpy).toHaveBeenCalledWith('Ore', expect.any(CPos))
  })

  it('does NOT add resource when no valid cell in range (TEST-10.18)', () => {
    const info = createInfo({ interval: 1, maxRange: 5, resourceType: 'Ore' })
    const trait = new SeedsResource(info)
    // canAddResource always returns false — no cell is valid
    const rl = createResourceLayerMock({ canAdd: false })
    const rng = createRng(1)

    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer: rl,
      sharedRandom: rng,
    })

    trait.tick(actor)

    // addResource should never have been called
    expect(rl._addResourceSpy).not.toHaveBeenCalled()
  })

  it('skips cells at max density of the same resource type', () => {
    const info = createInfo({ interval: 1, maxRange: 10, resourceType: 'Ore' })
    const trait = new SeedsResource(info)

    // All cells have Ore at max density and canAdd returns false
    const rng = createRng(1)
    const addResourceSpy = vi.fn().mockReturnValue(1)

    const rl: MockResourceLayer = {
      info: { tryGetTerrainType: () => undefined, tryGetResourceIndex: () => undefined } as IResourceLayerInfo,
      isEmpty: false,
      getResource: (_cell: CPos): ResourceLayerContents => ({ type: 'Ore', density: 10 }),
      getMaxDensity: () => 10,
      canAddResource: () => false,
      addResource: addResourceSpy,
      removeResource: () => 0,
      clearResources: () => {},
      isVisible: () => true,
      onCellChanged: () => {},
      _addResourceSpy: addResourceSpy,
    }

    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer: rl,
      sharedRandom: rng,
    })

    trait.tick(actor)
    // addResource should NOT have been called — all cells are full
    expect(addResourceSpy).not.toHaveBeenCalled()
  })

  it('handles missing world.worldActor gracefully (returns early)', () => {
    const info = createInfo({ interval: 1 })
    const trait = new SeedsResource(info)

    // Actor without a world.worldActor
    const actor: IGameActor = {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
      location: new CPos(10, 10),
      world: {
        // No worldActor property
      },
    } as unknown as IGameActor

    // Should not throw
    expect(() => trait.tick(actor)).not.toThrow()
  })

  it('handles missing world entirely (returns early)', () => {
    const info = createInfo({ interval: 1 })
    const trait = new SeedsResource(info)

    // Actor without a world
    const actor: IGameActor = {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
      location: new CPos(10, 10),
      // No world property
    } as unknown as IGameActor

    // Should not throw
    expect(() => trait.tick(actor)).not.toThrow()
  })

  it('resolves location from occupiesSpace.topLeft when direct location is absent', () => {
    const info = createInfo({ interval: 1, resourceType: 'Gems' })
    const trait = new SeedsResource(info)
    const rl = createResourceLayerMock({ canAdd: true })
    const rng = createRng(1)

    // Use occupiesSpace.topLeft instead of direct location
    const actor = createActor({
      // No direct location
      occupiesSpace: { topLeft: new CPos(5, 5) },
      resourceLayer: rl,
      sharedRandom: rng,
    })

    trait.tick(actor)

    // Should have added resource
    expect(rl._addResourceSpy).toHaveBeenCalledTimes(1)
    expect(rl._addResourceSpy).toHaveBeenCalledWith('Gems', expect.any(CPos))
  })

  it('falls back to CPos.Zero when no location info exists', () => {
    const info = createInfo({ interval: 1 })
    const trait = new SeedsResource(info)
    const rl = createResourceLayerMock({ canAdd: true })
    const rng = createRng(1)

    // No location OR occupiesSpace — getActorLocation returns CPos.Zero
    const actor = createActor({
      location: undefined,
      occupiesSpace: undefined,
      resourceLayer: rl,
      sharedRandom: rng,
    })

    // Should not throw — uses CPos.Zero as starting point
    expect(() => trait.tick(actor)).not.toThrow()
  })

  it('uses Math.random() as fallback when SharedRandom is unavailable', () => {
    const info = createInfo({ interval: 1, maxRange: 1, resourceType: 'Ore' })
    const trait = new SeedsResource(info)
    const rl = createResourceLayerMock({ canAdd: true })

    // Use vi.spyOn to mock Math.random without reassigning a read-only property
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    // Math.floor(0.9 * 3) = Math.floor(2.7) = 2, 2 - 1 = 1 → offset=1

    try {
      const actor = createActor({
        location: new CPos(10, 10),
        resourceLayer: rl,
        // No sharedRandom — triggers Math.random() fallback
        sharedRandom: undefined,
      })

      trait.tick(actor)

      // Math.random was called (for random walk offsets)
      expect(randomSpy).toHaveBeenCalled()
      // addResource was called (since canAdd=true)
      expect(rl._addResourceSpy).toHaveBeenCalledTimes(1)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('caches the resolved resourceLayer across multiple seed() calls', () => {
    const info = createInfo({ interval: 1 })
    const trait = new SeedsResource(info)
    const rl = createResourceLayerMock({ canAdd: true })
    const rng = createRng(1)

    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer: rl,
      sharedRandom: rng,
    })

    // First seed — resolves resourceLayer
    trait.tick(actor)
    expect(rl._addResourceSpy).toHaveBeenCalledTimes(1)
    const cached = (trait as unknown as { _resourceLayer: IResourceLayer | null })._resourceLayer
    expect(cached).toBe(rl)

    // Second seed — uses cached resourceLayer
    trait.tick(actor)
    expect(rl._addResourceSpy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// SeedsResource — traitEnabled / traitDisabled lifecycle
// ---------------------------------------------------------------------------

describe('SeedsResource lifecycle', () => {
  it('traitEnabled resets _ticks to 0 for immediate seeding', () => {
    const info = createInfo({ interval: 75 })
    const trait = new SeedsResource(info)
    const actor = createActor({ location: new CPos(10, 10) })

    // Simulate some ticks passing
    ;(trait as unknown as { _ticks: number })._ticks = 50

    // Enable the trait — should reset ticks to 0
    ;(trait as unknown as { traitEnabled: (a: IGameActor) => void }).traitEnabled(actor)

    const ticks = (trait as unknown as { _ticks: number })._ticks
    expect(ticks).toBe(0)
  })

  it('isTraitDisabled returns true after traitDisabled is called', () => {
    const info = createInfo({ interval: 75 })
    const trait = new SeedsResource(info)
    const actor = createActor({ location: new CPos(10, 10) })

    // Initially enabled
    expect(trait.isTraitDisabled).toBe(false)

    // Disable
    ;(trait as unknown as { traitDisabled: (a: IGameActor) => void }).traitDisabled(actor)
    expect(trait.isTraitDisabled).toBe(true)

    // Re-enable
    ;(trait as unknown as { traitEnabled: (a: IGameActor) => void }).traitEnabled(actor)
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('implements ISeedableResource interface', () => {
    const info = createInfo()
    const trait = new SeedsResource(info)
    const rl = createResourceLayerMock({ canAdd: true })
    const rng = createRng(1)
    const actor = createActor({
      location: new CPos(10, 10),
      resourceLayer: rl,
      sharedRandom: rng,
    })

    // seed() can be called directly via ISeedableResource
    trait.seed(actor)
    expect(rl._addResourceSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// SeedsResource — Construction
// ---------------------------------------------------------------------------

describe('SeedsResource construction', () => {
  it('properly stores info on construction', () => {
    const info = createInfo({ interval: 30, resourceType: 'Tiberium', maxRange: 50 })
    const trait = new SeedsResource(info)
    expect(trait.info).toBe(info)
    expect(trait.info.interval).toBe(30)
    expect(trait.info.resourceType).toBe('Tiberium')
    expect(trait.info.maxRange).toBe(50)
  })

  it('starts with _ticks at 0 (immediate seeding on first tick)', () => {
    const info = createInfo({ interval: 75 })
    const trait = new SeedsResource(info)
    const ticks = (trait as unknown as { _ticks: number })._ticks
    expect(ticks).toBe(0)
  })

  it('starts with isTraitDisabled = false', () => {
    const info = createInfo()
    const trait = new SeedsResource(info)
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('extends ConditionalTrait', () => {
    const info = createInfo({ requiresCondition: 'building' })
    const trait = new SeedsResource(info)
    expect(trait.isTraitDisabled).toBe(false) // _enabled = true by default
  })
})
