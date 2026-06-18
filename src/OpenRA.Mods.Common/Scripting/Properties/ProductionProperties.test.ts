/**
 * ProductionProperties.test.ts — Unit tests for ProductionProperties (5 classes)
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * method invocation, and member descriptor completeness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import {
  ProductionProperties,
  RallyPointProperties,
  PrimaryBuildingProperties,
  ProductionQueueProperties,
  ClassicProductionQueueProperties,
} from './ProductionProperties.js'

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    isIdle: false,
    owner: { playerName: 'TestPlayer' } as PlayerStub,
    disposed: false,
    traitName: 'test',
    world: { map: { rules: { actors: {} } } },
    info: { name: 'testActor', traits: [] },
    trait: vi.fn().mockReturnValue(null),
    traitsImplementing: vi.fn().mockReturnValue([]),
    queueActivity: vi.fn(),
    ...overrides,
  } as unknown as IGameActor
}

function stubContext() {
  return { world: {}, worldRenderer: {}, fatalErrorOccurred: false, errorMessage: null } as any
}

// ---------------------------------------------------------------------------
// ProductionProperties
// ---------------------------------------------------------------------------

describe('ProductionProperties', () => {
  beforeEach(() => {
    // NOTE: Module-level registration from file import is tested above.
    // This test block uses beforeEach for instance creation only.
  })

  it('has category Production', () => {
    expect(ProductionProperties.category).toBe('Production')
  })

  it('requires ProductionInfo', () => {
    expect(ProductionProperties.requiredTraits).toContain('ProductionInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ProductionProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ProductionProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Production')
    expect(reg!.requiredTraits).toContain('ProductionInfo')
    expect(reg!.exposedForDestroyedActors).toBe(false)
  })

  it('getOwnMemberDescriptors returns Produce method', () => {
    const actor = stubActor()
    const p = new ProductionProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Produce')
  })

  it('Produce throws when map rules not available', () => {
    const actor = stubActor({ world: {} })
    const p = new ProductionProperties(stubContext(), actor)
    expect(() => p.Produce('e1')).toThrow('Map rules not available')
  })

  it('Produce throws for unknown actor type', () => {
    const actor = stubActor()
    const p = new ProductionProperties(stubContext(), actor)
    expect(() => p.Produce('unknown')).toThrow("Unknown actor type 'unknown'")
  })

  it('Produce queues WaitFor activity with valid actor type', () => {
    const actor = stubActor({
      world: {
        map: {
          rules: {
            actors: {
              e1: { name: 'e1', traitInfo: vi.fn().mockReturnValue({ buildAtProductionType: 'Infantry' }) },
            },
          },
        },
      },
      traitsImplementing: vi.fn().mockReturnValue([
        { info: { produces: ['Infantry'] }, produce: vi.fn().mockReturnValue(true), faction: null },
      ]),
    })
    const p = new ProductionProperties(stubContext(), actor)
    p.Produce('e1')
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('WaitFor')
  })
})

// ---------------------------------------------------------------------------
// RallyPointProperties
// ---------------------------------------------------------------------------

describe('RallyPointProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Production', () => {
    expect(RallyPointProperties.category).toBe('Production')
  })

  it('requires RallyPointInfo', () => {
    expect(RallyPointProperties.requiredTraits).toContain('RallyPointInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(RallyPointProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === RallyPointProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Production')
  })

  it('get RallyPoint returns actor location when no RallyPoint trait', () => {
    const actor = stubActor({ location: { x: 5, y: 3 } })
    const p = new RallyPointProperties(stubContext(), actor)
    expect(p.RallyPoint).toEqual({ x: 5, y: 3 })
  })

  it('get RallyPoint returns path last element when path is non-empty', () => {
    const rp = { path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'RallyPoint' ? rp : null),
      location: { x: 0, y: 0 },
    })
    const p = new RallyPointProperties(stubContext(), actor)
    expect(p.RallyPoint).toEqual({ x: 3, y: 4 })
  })

  it('set RallyPoint updates path', () => {
    const rp = { path: [] as unknown[] }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'RallyPoint' ? rp : null),
    })
    const p = new RallyPointProperties(stubContext(), actor)
    p.RallyPoint = { x: 9, y: 9 }
    expect(rp.path).toEqual([{ x: 9, y: 9 }])
  })

  it('getOwnMemberDescriptors returns RallyPoint', () => {
    const actor = stubActor()
    const p = new RallyPointProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('RallyPoint')
  })
})

// ---------------------------------------------------------------------------
// PrimaryBuildingProperties
// ---------------------------------------------------------------------------

describe('PrimaryBuildingProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Production', () => {
    expect(PrimaryBuildingProperties.category).toBe('Production')
  })

  it('requires PrimaryBuildingInfo', () => {
    expect(PrimaryBuildingProperties.requiredTraits).toContain('PrimaryBuildingInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(PrimaryBuildingProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === PrimaryBuildingProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Production')
  })

  it('get IsPrimaryBuilding returns false when no trait', () => {
    const actor = stubActor()
    const p = new PrimaryBuildingProperties(stubContext(), actor)
    expect(p.IsPrimaryBuilding).toBe(false)
  })

  it('get IsPrimaryBuilding returns trait.isPrimary', () => {
    const pb = { isPrimary: true, setPrimaryProducer: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'PrimaryBuilding' ? pb : null),
    })
    const p = new PrimaryBuildingProperties(stubContext(), actor)
    expect(p.IsPrimaryBuilding).toBe(true)
  })

  it('set IsPrimaryBuilding calls setPrimaryProducer', () => {
    const pb = { isPrimary: false, setPrimaryProducer: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'PrimaryBuilding' ? pb : null),
    })
    const p = new PrimaryBuildingProperties(stubContext(), actor)
    p.IsPrimaryBuilding = true
    expect(pb.setPrimaryProducer).toHaveBeenCalledWith(actor, true)
  })

  it('getOwnMemberDescriptors returns IsPrimaryBuilding', () => {
    const actor = stubActor()
    const p = new PrimaryBuildingProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('IsPrimaryBuilding')
  })
})

// ---------------------------------------------------------------------------
// ProductionQueueProperties
// ---------------------------------------------------------------------------

describe('ProductionQueueProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Production', () => {
    expect(ProductionQueueProperties.category).toBe('Production')
  })

  it('requires ProductionQueueInfo and ScriptTriggersInfo', () => {
    expect(ProductionQueueProperties.requiredTraits).toContain('ProductionQueueInfo')
    expect(ProductionQueueProperties.requiredTraits).toContain('ScriptTriggersInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ProductionQueueProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ProductionQueueProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Production')
  })

  it('IsProducing returns false when queues are empty', () => {
    const actor = stubActor({
      world: {
        map: {
          rules: {
            actors: {
              e1: { traitInfo: vi.fn().mockReturnValue({ queue: ['Infantry'] }) },
            },
          },
        },
      },
      traitsImplementing: vi.fn().mockReturnValue([
        { enabled: true, info: { type: 'Infantry' }, allQueued: () => [] },
      ]),
    })
    const p = new ProductionQueueProperties(stubContext(), actor)
    expect(p.IsProducing('e1')).toBe(false)
  })

  it('Build returns false when OnProduction callbacks active', () => {
    const triggers = { hasAnyCallbacksFor: vi.fn().mockReturnValue(true) }
    const actor = stubActor({
      getScriptTriggers: vi.fn().mockReturnValue(triggers),
    })
    const p = new ProductionQueueProperties(stubContext(), actor)
    expect(p.Build(['e1'])).toBe(false)
  })

  it('getOwnMemberDescriptors returns Build and IsProducing', () => {
    const actor = stubActor()
    const p = new ProductionQueueProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Build')
    expect(names).toContain('IsProducing')
  })
})

// ---------------------------------------------------------------------------
// ClassicProductionQueueProperties — Player-scoped
// ---------------------------------------------------------------------------

describe('ClassicProductionQueueProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('is registered with ScriptRegistry as player property', () => {
    const props = ScriptRegistry.getPlayerProperties()
    const reg = props.find(p => p.ctor === ClassicProductionQueueProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Production')
    expect(reg!.requiredTraits).toContain('ClassicProductionQueueInfo')
    expect(reg!.requiredTraits).toContain('ScriptTriggersInfo')
  })

  it('requires ClassicProductionQueueInfo and ScriptTriggersInfo', () => {
    expect(ClassicProductionQueueProperties.requiredTraits).toContain('ClassicProductionQueueInfo')
    expect(ClassicProductionQueueProperties.requiredTraits).toContain('ScriptTriggersInfo')
  })

  it('IsProducing returns true when queue is busy', () => {
    const queue = { enabled: true, info: { type: 'Vehicle' }, allQueued: () => [{ name: '1tnk' }] }
    const player = {
      playerName: 'TestPlayer',
      playerActor: {
        traitsImplementing: vi.fn().mockReturnValue([queue]),
        getScriptTriggers: vi.fn().mockReturnValue(null),
      },
    } as unknown as PlayerStub & { playerActor: any }

    // Patch world access via playerActor for _getBuildableInfo
    (player as any).world = {
      map: {
        rules: {
          actors: {
            '1tnk': {
              traitInfo: vi.fn().mockReturnValue({ queue: ['Vehicle'] }),
            },
          },
        },
      },
    }

    const p = new ClassicProductionQueueProperties(stubContext(), player)
    expect(p.IsProducing('1tnk')).toBe(true)
  })

  it('Build returns true when queue is available and empty', () => {
    const queue = { enabled: true, info: { type: 'Vehicle' }, allQueued: () => [], resolveOrder: vi.fn(), actor: {} }
    const player = {
      playerName: 'TestPlayer',
      playerActor: {
        traitsImplementing: vi.fn().mockReturnValue([queue]),
        getScriptTriggers: vi.fn().mockReturnValue(null),
      },
    } as unknown as PlayerStub & { playerActor: any }
    ;(player as any).world = {
      map: {
        rules: {
          actors: {
            '1tnk': { traitInfo: vi.fn().mockReturnValue({ queue: ['Vehicle'] }) },
          },
        },
      },
    }

    const p = new ClassicProductionQueueProperties(stubContext(), player)
    expect(p.Build(['1tnk'])).toBe(true)
    expect(queue.resolveOrder).toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns Build and IsProducing', () => {
    const player = {
      playerName: 'TestPlayer',
      playerActor: {
        traitsImplementing: vi.fn().mockReturnValue([]),
        getScriptTriggers: vi.fn().mockReturnValue(null),
      },
    } as unknown as PlayerStub & { playerActor: any }

    const p = new ClassicProductionQueueProperties(stubContext(), player)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Build')
    expect(names).toContain('IsProducing')
  })
})
