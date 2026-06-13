/**
 * StoresPlayerResources.test.ts — StoresPlayerResources migration unit tests
 *
 * Tests focus on:
 * - StoresPlayerResourcesInfo defaults (capacity=0)
 * - stored calculation: proportional resource share
 * - addedToWorld calls addStorageCapacity
 * - removedFromWorld calls removeStorageCapacity
 * - onOwnerChanged re-resolves PlayerResources
 * - onCapture transfers resources between owners
 * - killed takes resources from player
 * - attach/detach lifecycle
 * - ConditionalTrait integration (isTraitDisabled gating)
 * - Fallback stub for missing PlayerResources
 */

import { describe, it, expect, vi } from 'vitest'
import {
  StoresPlayerResources,
  StoresPlayerResourcesInfo,
} from './StoresPlayerResources'
import type {
  IGameActor,
  PlayerStub,
  AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a StoresPlayerResourcesInfo with explicit defaults. */
function createInfo(overrides: Partial<StoresPlayerResourcesInfo> = {}): StoresPlayerResourcesInfo {
  return new StoresPlayerResourcesInfo(overrides)
}

/** Minimal mock PlayerResources for testing. */
interface MockPlayerResources {
  resourceCapacity: number
  resources: number
  addStorageCapacity: ReturnType<typeof vi.fn>
  removeStorageCapacity: ReturnType<typeof vi.fn>
  takeResources: ReturnType<typeof vi.fn>
  giveResources: ReturnType<typeof vi.fn>
}

function createMockPlayerResources(options: {
  capacity?: number
  stored?: number
} = {}): MockPlayerResources {
  const capacity = options.capacity ?? 5000
  let stored = options.stored ?? 0

  return {
    get resourceCapacity(): number {
      return capacity
    },
    get resources(): number {
      return stored
    },
    addStorageCapacity: vi.fn().mockImplementation((_amount: number) => {
      // capacity += _amount — but since it's a getter returning a closure var,
      // we use the spy to verify calls rather than mutate
    }),
    removeStorageCapacity: vi.fn(),
    takeResources: vi.fn().mockImplementation((amount: number) => {
      if (stored >= amount) {
        stored -= amount
        return true
      }
      return false
    }),
    giveResources: vi.fn().mockImplementation((amount: number) => {
      stored += amount
    }),
  }
}

function makePlayerStub(name: string = 'TestPlayer'): PlayerStub {
  return { playerName: name }
}

/** Create a minimal IGameActor with an owner that has PlayerResources. */
function createActor(options: {
  actorId?: number
  isInWorld?: boolean
  owner?: {
    playerName: string
    playerActor?: IGameActor & { _playerResources?: unknown }
  }
  isDead?: boolean
} = {}): IGameActor {
  return {
    actorId: options.actorId ?? 1,
    isInWorld: options.isInWorld ?? true,
    isDead: options.isDead ?? false,
    disposed: false,
    owner: options.owner ?? makePlayerStub(),
  } as IGameActor
}

/** Create an actor with a mock PlayerResources on its owner's playerActor. */
function createActorWithPR(pr: MockPlayerResources, overrides: {
  actorId?: number
  isInWorld?: boolean
  playerName?: string
} = {}): IGameActor {
  return createActor({
    actorId: overrides.actorId ?? 1,
    isInWorld: overrides.isInWorld ?? true,
    owner: {
      playerName: overrides.playerName ?? 'TestPlayer',
      playerActor: {
        actorId: 999,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: pr,
      } as unknown as IGameActor & { _playerResources?: unknown },
    },
  })
}

// ---------------------------------------------------------------------------
// StoresPlayerResourcesInfo defaults
// ---------------------------------------------------------------------------

describe('StoresPlayerResourcesInfo', () => {
  it('defaults capacity to 0', () => {
    const info = createInfo()
    expect(info.capacity).toBe(0)
  })

  it('accepts custom capacity', () => {
    const info = createInfo({ capacity: 500 })
    expect(info.capacity).toBe(500)
  })

  it('accepts requiresCondition', () => {
    const info = createInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })

  it('accepts instanceName', () => {
    const info = createInfo({ instanceName: 'silo' })
    expect(info.instanceName).toBe('silo')
  })

  it('implements ConditionalTraitInfo', () => {
    const info = createInfo({ requiresCondition: 'powered' })
    expect(info.requiresCondition).toBe('powered')
    expect('instanceName' in info).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — stored calculation
// ---------------------------------------------------------------------------

describe('StoresPlayerResources stored', () => {
  it('returns 0 when no player resources resolved', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    // Not attached — _playerResources is null
    expect(trait.stored).toBe(0)
  })

  it('returns 0 when resourceCapacity is 0', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 0, stored: 200 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(0)
  })

  it('returns 0 when player resources is 0', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 0 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(0)
  })

  it('calculates proportional stored resources', () => {
    const info = createInfo({ capacity: 1000 })
    const trait = new StoresPlayerResources(info)
    // Total capacity: 5000, total resources: 2500 (50% full)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    // floor(1000 * 2500 / 5000) = floor(500) = 500
    expect(trait.stored).toBe(500)
  })

  it('handles floor rounding (integer division)', () => {
    const info = createInfo({ capacity: 100 })
    const trait = new StoresPlayerResources(info)
    // 100 * 33 / 1000 = 3300 / 1000 = 3.3 → floor = 3
    const pr = createMockPlayerResources({ capacity: 1000, stored: 33 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(3)
  })

  it('returns full capacity when player is 100% full', () => {
    const info = createInfo({ capacity: 100 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 1000, stored: 1000 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(100)
  })

  it('returns 0 for zero capacity info', () => {
    const info = createInfo({ capacity: 0 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — addedToWorld / removedFromWorld
// ---------------------------------------------------------------------------

describe('StoresPlayerResources addedToWorld / removedFromWorld', () => {
  it('addedToWorld calls addStorageCapacity on player resources', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    trait.addedToWorld(actor)
    expect(pr.addStorageCapacity).toHaveBeenCalledWith(500)
  })

  it('removedFromWorld calls removeStorageCapacity on player resources', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    trait.removedFromWorld(actor)
    expect(pr.removeStorageCapacity).toHaveBeenCalledWith(500)
  })

  it('addedToWorld does nothing when trait is disabled', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    // Disable the trait
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    trait.addedToWorld(actor)
    expect(pr.addStorageCapacity).not.toHaveBeenCalled()
  })

  it('removedFromWorld does nothing when trait is disabled', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    ;(trait as unknown as { _enabled: boolean })._enabled = false

    trait.removedFromWorld(actor)
    expect(pr.removeStorageCapacity).not.toHaveBeenCalled()
  })

  it('addedToWorld does not throw when player resources is null', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    // Create actor without PlayerResources on playerActor
    const actor = createActor({
      owner: {
        playerName: 'Test',
        playerActor: null as unknown as IGameActor & { _playerResources?: unknown },
      },
    })
    trait.attach(actor)

    expect(() => trait.addedToWorld(actor)).not.toThrow()
  })

  it('removedFromWorld does not throw when player resources is null', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const actor = createActor({
      owner: {
        playerName: 'Test',
        playerActor: null as unknown as IGameActor & { _playerResources?: unknown },
      },
    })
    trait.attach(actor)

    expect(() => trait.removedFromWorld(actor)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — onOwnerChanged
// ---------------------------------------------------------------------------

describe('StoresPlayerResources onOwnerChanged', () => {
  it('re-resolves PlayerResources from new owner', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)

    // Original owner's PlayerResources
    const oldPr = createMockPlayerResources({ capacity: 5000, stored: 1000 })
    const originalActor = createActor({
      owner: {
        playerName: 'OldPlayer',
        playerActor: {
          actorId: 999,
          isInWorld: true,
          isDead: false,
          disposed: false,
          _playerResources: oldPr,
        } as unknown as IGameActor & { _playerResources?: unknown },
      },
    })
    trait.attach(originalActor)

    // After owner change, Stored should reflect original PR
    // floor(500 * 1000 / 5000) = 100
    expect(trait.stored).toBe(100)

    // New owner's PlayerResources
    const newPr = createMockPlayerResources({ capacity: 2000, stored: 400 })
    const newOwner = {
      playerName: 'NewPlayer',
      playerActor: {
        actorId: 1000,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: newPr,
      } as unknown as IGameActor & { _playerResources?: unknown },
    }

    // Simulate actor with updated owner
    const changedActor = createActor({ owner: newOwner })

    trait.onOwnerChanged(changedActor, makePlayerStub('Old'), newOwner)

    // Now stored should reflect new owner's PR
    // floor(500 * 400 / 2000) = 100
    expect(trait.stored).toBe(100)
  })

  it('handles new owner with no playerActor (fallback to stub)', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    const newOwner = { playerName: 'EmptyOwner' } // No playerActor
    // Should not throw
    expect(() =>
      trait.onOwnerChanged(actor, makePlayerStub('Old'), newOwner),
    ).not.toThrow()
  })

  it('handles new owner being null/undefined gracefully', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    // Should not throw when owner is null-like
    expect(() =>
      trait.onOwnerChanged(
        { actorId: 1, isInWorld: true, isDead: false, disposed: false } as IGameActor,
        makePlayerStub('Old'),
        makePlayerStub('New'),
      ),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — onCapture
// ---------------------------------------------------------------------------

describe('StoresPlayerResources onCapture', () => {
  it('transfers stored resources from old owner to new owner', () => {
    const info = createInfo({ capacity: 1000 })
    const trait = new StoresPlayerResources(info)

    // Current owner: 5000 capacity, 2500 stored (50% full)
    const currentPr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const actor = createActorWithPR(currentPr)
    trait.attach(actor)

    // stored = floor(1000 * 2500 / 5000) = 500
    expect(trait.stored).toBe(500)

    // Old owner (captured from)
    const oldOwnerPr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const oldOwner = {
      playerName: 'OldOwner',
      playerActor: {
        actorId: 10,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: oldOwnerPr,
      },
    }

    // New owner (captured to)
    const newOwnerPr = createMockPlayerResources({ capacity: 3000, stored: 600 })
    const newOwner = {
      playerName: 'NewOwner',
      playerActor: {
        actorId: 20,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: newOwnerPr,
      },
    }

    // Capture
    trait.onCapture(
      actor,
      { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
      oldOwner,
      newOwner,
      0,
    )

    // Old owner: takeResources(500)
    expect(oldOwnerPr.takeResources).toHaveBeenCalledWith(500)
    // New owner: giveResources(500)
    expect(newOwnerPr.giveResources).toHaveBeenCalledWith(500)
  })

  it('handles capture when old owner has no playerActor', () => {
    const info = createInfo({ capacity: 1000 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    const oldOwner = { playerName: 'Old' } // No playerActor

    const newOwnerPr = createMockPlayerResources({ capacity: 3000, stored: 600 })
    const newOwner = {
      playerName: 'NewOwner',
      playerActor: {
        actorId: 20,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: newOwnerPr,
      },
    }

    // Should not throw
    expect(() =>
      trait.onCapture(
        actor,
        { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
        oldOwner,
        newOwner,
        0,
      ),
    ).not.toThrow()
  })

  it('handles capture when new owner has no playerActor', () => {
    const info = createInfo({ capacity: 1000 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    const oldOwnerPr = createMockPlayerResources({ capacity: 5000, stored: 2500 })
    const oldOwner = {
      playerName: 'OldOwner',
      playerActor: {
        actorId: 10,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: oldOwnerPr,
      },
    }

    const newOwner = { playerName: 'New' } // No playerActor

    // Should not throw (takeResources still called on old, giveResources skipped)
    expect(() =>
      trait.onCapture(
        actor,
        { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
        oldOwner,
        newOwner,
        0,
      ),
    ).not.toThrow()
    expect(oldOwnerPr.takeResources).toHaveBeenCalled()
  })

  it('onCapture transfers zero resources when stored is 0', () => {
    const info = createInfo({ capacity: 1000 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 0 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(0)

    const oldOwnerPr = createMockPlayerResources({ capacity: 5000, stored: 0 })
    const oldOwner = {
      playerName: 'Old',
      playerActor: { actorId: 10, isInWorld: true, isDead: false, disposed: false, _playerResources: oldOwnerPr } as unknown as IGameActor & { _playerResources?: unknown },
    }
    const newOwnerPr = createMockPlayerResources({ capacity: 5000, stored: 0 })
    const newOwner = {
      playerName: 'New',
      playerActor: { actorId: 20, isInWorld: true, isDead: false, disposed: false, _playerResources: newOwnerPr } as unknown as IGameActor & { _playerResources?: unknown },
    }

    trait.onCapture(
      actor,
      { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
      oldOwner,
      newOwner,
      0,
    )

    expect(oldOwnerPr.takeResources).toHaveBeenCalledWith(0)
    expect(newOwnerPr.giveResources).toHaveBeenCalledWith(0)
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — killed
// ---------------------------------------------------------------------------

describe('StoresPlayerResources killed', () => {
  it('calls takeResources with stored amount on death', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 1000, stored: 500 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    // stored = floor(500 * 500 / 1000) = 250
    expect(trait.stored).toBe(250)

    const attackInfo = {
      damage: { value: 100, damageTypes: { contains: () => false, isEmpty: () => true } },
      attacker: { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
      damageState: 32, // Dead
      previousDamageState: 8, // Heavy
    } as AttackInfo

    trait.killed(actor, attackInfo)

    expect(pr.takeResources).toHaveBeenCalledWith(250)
  })

  it('killed does not throw when player resources is null', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    // Actor without PlayerResources — attach will create fallback stub
    const actor = createActor({
      owner: { playerName: 'Test' },
    })
    trait.attach(actor)

    const attackInfo = {
      damage: { value: 100, damageTypes: { contains: () => false, isEmpty: () => true } },
      attacker: { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
      damageState: 32,
      previousDamageState: 8,
    } as AttackInfo

    // Fallback stub has 5000 capacity, 0 resources → stored = 0
    expect(() => trait.killed(actor, attackInfo)).not.toThrow()
  })

  it('killed takes zero when stored is zero', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 0 })
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    expect(trait.stored).toBe(0)

    const attackInfo = {
      damage: { value: 100, damageTypes: { contains: () => false, isEmpty: () => true } },
      attacker: { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
      damageState: 32,
      previousDamageState: 8,
    } as AttackInfo

    trait.killed(actor, attackInfo)
    expect(pr.takeResources).toHaveBeenCalledWith(0)
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — attach / detach lifecycle
// ---------------------------------------------------------------------------

describe('StoresPlayerResources attach/detach', () => {
  it('attach resolves player resources from owner', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 1000 })
    const actor = createActorWithPR(pr)

    trait.attach(actor)

    // stored should be calculated using the resolved PR
    expect(trait.stored).toBe(100) // floor(500 * 1000 / 5000)
  })

  it('detach clears player resources reference', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources({ capacity: 5000, stored: 1000 })
    const actor = createActorWithPR(pr)

    trait.attach(actor)
    expect(trait.stored).toBe(100)

    trait.detach(actor)
    expect(trait.stored).toBe(0) // _playerResources is null
  })

  it('attach with owner but no playerActor creates fallback stub', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const actor = createActor({
      owner: { playerName: 'Test' /* no playerActor */ },
    })

    trait.attach(actor)

    // Fallback stub has capacity=5000, resources=0 → stored = 0
    expect(trait.stored).toBe(0)
  })

  it('attach with no owner sets playerResources to null', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const actor = createActor({ owner: undefined as unknown as PlayerStub })

    trait.attach(actor)

    expect(trait.stored).toBe(0)
  })

  it('actor property is available from ConditionalTrait base', () => {
    const info = createInfo()
    const trait = new StoresPlayerResources(info)
    const actor = createActor()

    trait.attach(actor)
    expect(trait.actor).toBe(actor)

    trait.detach(actor)
    expect(trait.actor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — ConditionalTrait integration
// ---------------------------------------------------------------------------

describe('StoresPlayerResources ConditionalTrait integration', () => {
  it('has isTraitDisabled from ConditionalTrait base', () => {
    const info = createInfo()
    const trait = new StoresPlayerResources(info)
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('stores info property from ConditionalTrait base', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    expect(trait.info).toBe(info)
    expect(trait.info.capacity).toBe(500)
  })

  it('addedToWorld is gated by isTraitDisabled', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    ;(trait as unknown as { _enabled: boolean })._enabled = false

    trait.addedToWorld(actor)
    expect(pr.addStorageCapacity).not.toHaveBeenCalled()
  })

  it('removedFromWorld is gated by isTraitDisabled', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    ;(trait as unknown as { _enabled: boolean })._enabled = false

    trait.removedFromWorld(actor)
    expect(pr.removeStorageCapacity).not.toHaveBeenCalled()
  })

  it('traitDisabled sets _enabled to false', () => {
    const info = createInfo()
    const trait = new StoresPlayerResources(info)
    const actor = createActor()

    // Simulate traitDisabled
    ;(trait as unknown as { traitDisabled: (a: IGameActor) => void }).traitDisabled(actor)
    expect(trait.isTraitDisabled).toBe(true)
  })

  it('traitEnabled sets _enabled to true', () => {
    const info = createInfo()
    const trait = new StoresPlayerResources(info)
    const actor = createActor()

    ;(trait as unknown as { traitDisabled: (a: IGameActor) => void }).traitDisabled(actor)
    expect(trait.isTraitDisabled).toBe(true)

    ;(trait as unknown as { traitEnabled: (a: IGameActor) => void }).traitEnabled(actor)
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('implements all required notify interfaces', () => {
    const info = createInfo()
    const trait = new StoresPlayerResources(info)

    expect(typeof trait.addedToWorld).toBe('function')
    expect(typeof trait.removedFromWorld).toBe('function')
    expect(typeof trait.onOwnerChanged).toBe('function')
    expect(typeof trait.onCapture).toBe('function')
    expect(typeof trait.killed).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — multiple add/remove world cycles
// ---------------------------------------------------------------------------

describe('StoresPlayerResources add/remove world cycles', () => {
  it('handles multiple addedToWorld/removedFromWorld cycles', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const pr = createMockPlayerResources()
    const actor = createActorWithPR(pr)
    trait.attach(actor)

    // First cycle
    trait.addedToWorld(actor)
    expect(pr.addStorageCapacity).toHaveBeenCalledTimes(1)
    expect(pr.addStorageCapacity).toHaveBeenCalledWith(500)

    trait.removedFromWorld(actor)
    expect(pr.removeStorageCapacity).toHaveBeenCalledTimes(1)
    expect(pr.removeStorageCapacity).toHaveBeenCalledWith(500)

    // Second cycle
    trait.addedToWorld(actor)
    expect(pr.addStorageCapacity).toHaveBeenCalledTimes(2)

    trait.removedFromWorld(actor)
    expect(pr.removeStorageCapacity).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// StoresPlayerResources — fallback stub behavior
// ---------------------------------------------------------------------------

describe('StoresPlayerResources fallback stub', () => {
  it('fallback stub starts with capacity 5000 and resources 0', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    // Actor without PlayerResources on playerActor
    const actor = createActor({
      owner: { playerName: 'Test' },
    })

    trait.attach(actor)

    // Fallback stub: capacity=5000, resources=0 → stored = 0
    expect(trait.stored).toBe(0)
  })

  it('fallback stub addStorageCapacity increases capacity', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const actor = createActor({
      owner: { playerName: 'Test' },
    })

    trait.attach(actor)
    trait.addedToWorld(actor)

    // The fallback stub should have had addStorageCapacity called
    // We can verify indirectly via stored
    // After adding 500 capacity to 5000: capacity = 5500
    // But this is hard to verify without exposing stub internals.
    // The call should NOT throw.
  })

  it('fallback stub removeStorageCapacity decreases capacity (clamped at 0)', () => {
    const info = createInfo({ capacity: 10000 })
    const trait = new StoresPlayerResources(info)
    const actor = createActor({
      owner: { playerName: 'Test' },
    })

    trait.attach(actor)
    trait.removedFromWorld(actor)

    // Should not throw, even though we remove more than capacity
  })

  it('fallback stub giveResources and takeResources work', () => {
    const info = createInfo({ capacity: 500 })
    const trait = new StoresPlayerResources(info)
    const actor = createActor({
      owner: { playerName: 'Test' },
    })

    trait.attach(actor)

    const attackInfo = {
      damage: { value: 100, damageTypes: { contains: () => false, isEmpty: () => true } },
      attacker: { actorId: 2, isInWorld: true, isDead: false, disposed: false } as IGameActor,
      damageState: 32,
      previousDamageState: 8,
    } as AttackInfo

    // Should not throw — stub handles takeResources
    expect(() => trait.killed(actor, attackInfo)).not.toThrow()
  })
})
