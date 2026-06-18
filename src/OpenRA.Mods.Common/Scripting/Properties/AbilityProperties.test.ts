/**
 * AbilityProperties.test.ts — Unit tests for Ability/Combat property classes
 *
 * Covers: CaptureProperties, CarryallProperties, DeliversCashProperties,
 * DeliversExperienceProperties, DemolitionProperties, GuardProperties,
 * ConditionProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * method invocation, member descriptor completeness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { CaptureProperties } from './CaptureProperties.js'
import { CarryallProperties } from './CarryallProperties.js'
import { DeliversCashProperties, DeliversExperienceProperties } from './DeliveryProperties.js'
import { DemolitionProperties } from './DemolitionProperties.js'
import { GuardProperties } from './GuardProperties.js'
import { ConditionProperties } from './ConditionProperties.js'

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
    world: {},
    info: { name: 'testActor', traits: [], hasTraitInfo: vi.fn().mockReturnValue(true) },
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
// CaptureProperties
// ---------------------------------------------------------------------------

describe('CaptureProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Ability', () => {
    expect(CaptureProperties.category).toBe('Ability')
  })

  it('requires CaptureManagerInfo', () => {
    expect(CaptureProperties.requiredTraits).toContain('CaptureManagerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(CaptureProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === CaptureProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Ability')
  })

  it('CanCapture returns false when no CaptureManager trait', () => {
    const actor = stubActor()
    const target = stubActor({ actorId: 2 })
    const p = new CaptureProperties(stubContext(), actor)
    expect(p.CanCapture(target)).toBe(false)
  })

  it('CanCapture returns true when both actors have CaptureManager', () => {
    const mgr = { canTarget: vi.fn().mockReturnValue(true) }
    const targetMgr = {}
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'CaptureManager' ? mgr : null),
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn((name: string) => name === 'CaptureManager' ? targetMgr : null),
    })
    const p = new CaptureProperties(stubContext(), actor)
    expect(p.CanCapture(target)).toBe(true)
  })

  it('Capture queues CaptureActor activity', () => {
    const mgr = { canTarget: vi.fn().mockReturnValue(true) }
    const targetMgr = {}
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'CaptureManager' ? mgr : null),
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn((name: string) => name === 'CaptureManager' ? targetMgr : null),
    })
    const p = new CaptureProperties(stubContext(), actor)
    p.Capture(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('CaptureActor')
  })

  it('getOwnMemberDescriptors returns Capture and CanCapture', () => {
    const actor = stubActor()
    const p = new CaptureProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Capture')
    expect(names).toContain('CanCapture')
  })
})

// ---------------------------------------------------------------------------
// CarryallProperties
// ---------------------------------------------------------------------------

describe('CarryallProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Ability', () => {
    expect(CarryallProperties.category).toBe('Ability')
  })

  it('requires CarryallInfo', () => {
    expect(CarryallProperties.requiredTraits).toContain('CarryallInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(CarryallProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === CarryallProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Ability')
  })

  it('PickupCarryable throws when target has no Carryable', () => {
    const carryall = { info: { beforeLoadDelay: 0 } }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Carryall' ? carryall : null),
      info: { name: 'heli' },
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn().mockReturnValue(null),
      info: { name: 'bad_target' },
    })
    const p = new CarryallProperties(stubContext(), actor)
    expect(() => p.PickupCarryable(target)).toThrow("Actor 'heli' cannot carry actor 'bad_target'!")
  })

  it('PickupCarryable queues PickupUnit activity', () => {
    const carryall = { info: { beforeLoadDelay: 5 } }
    const carryable = {}
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Carryall' ? carryall : null),
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn((name: string) => name === 'Carryable' ? carryable : null),
    })
    const p = new CarryallProperties(stubContext(), actor)
    p.PickupCarryable(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('PickupUnit')
    expect(arg.activityParams.delay).toBe(5)
  })

  it('DeliverCarryable queues DeliverUnit activity', () => {
    const carryall = { info: { dropRange: 2 } }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Carryall' ? carryall : null),
    })
    const p = new CarryallProperties(stubContext(), actor)
    p.DeliverCarryable({ x: 5, y: 3 })
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('DeliverUnit')
  })

  it('getOwnMemberDescriptors returns PickupCarryable and DeliverCarryable', () => {
    const actor = stubActor()
    const p = new CarryallProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('PickupCarryable')
    expect(names).toContain('DeliverCarryable')
  })
})

// ---------------------------------------------------------------------------
// DeliversCashProperties
// ---------------------------------------------------------------------------

describe('DeliversCashProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Ability', () => {
    expect(DeliversCashProperties.category).toBe('Ability')
  })

  it('requires IMoveInfo and DeliversCashInfo', () => {
    expect(DeliversCashProperties.requiredTraits).toContain('IMoveInfo')
    expect(DeliversCashProperties.requiredTraits).toContain('DeliversCashInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(DeliversCashProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === DeliversCashProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Ability')
  })

  it('DeliverCash queues DonateCash activity', () => {
    const actor = stubActor({
      info: { traitInfo: vi.fn().mockReturnValue({ payload: 100, playerExperience: 50 }) },
    })
    const target = stubActor({ actorId: 2 })
    const p = new DeliversCashProperties(stubContext(), actor)
    p.DeliverCash(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('DonateCash')
    expect(arg.activityParams.payload).toBe(100)
  })

  it('getOwnMemberDescriptors returns DeliverCash', () => {
    const actor = stubActor()
    const p = new DeliversCashProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('DeliverCash')
  })
})

// ---------------------------------------------------------------------------
// DeliversExperienceProperties
// ---------------------------------------------------------------------------

describe('DeliversExperienceProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Ability', () => {
    expect(DeliversExperienceProperties.category).toBe('Ability')
  })

  it('requires IMoveInfo and DeliversExperienceInfo', () => {
    expect(DeliversExperienceProperties.requiredTraits).toContain('IMoveInfo')
    expect(DeliversExperienceProperties.requiredTraits).toContain('DeliversExperienceInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(DeliversExperienceProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === DeliversExperienceProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Ability')
  })

  it('DeliverExperience throws when target has no GainsExperience', () => {
    const actor = stubActor({
      info: { traitInfo: vi.fn().mockReturnValue({ playerExperience: 50 }) },
      trait: vi.fn().mockReturnValue(null),
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn().mockReturnValue(null),
      info: { name: 'no_exp' },
    })
    const p = new DeliversExperienceProperties(stubContext(), actor)
    expect(() => p.DeliverExperience(target)).toThrow("Actor 'no_exp' cannot gain experience!")
  })

  it('DeliverExperience queues DonateExperience activity', () => {
    const gainsExp = { level: 3, maxLevel: 10 }
    const targetExp = { level: 1, maxLevel: 10 }
    const actor = stubActor({
      info: { traitInfo: vi.fn().mockReturnValue({ playerExperience: 50 }) },
      trait: vi.fn((name: string) => name === 'GainsExperience' ? gainsExp : null),
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn((name: string) => name === 'GainsExperience' ? targetExp : null),
    })
    const p = new DeliversExperienceProperties(stubContext(), actor)
    p.DeliverExperience(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('DonateExperience')
    expect(arg.activityParams.level).toBe(3)
  })

  it('DeliverExperience returns early when target is at max level', () => {
    const gainsExp = { level: 3, maxLevel: 10 }
    const targetExp = { level: 10, maxLevel: 10 }
    const actor = stubActor({
      info: { traitInfo: vi.fn().mockReturnValue({ playerExperience: 50 }) },
      trait: vi.fn((name: string) => name === 'GainsExperience' ? gainsExp : null),
    })
    const target = stubActor({
      actorId: 2,
      trait: vi.fn((name: string) => name === 'GainsExperience' ? targetExp : null),
    })
    const p = new DeliversExperienceProperties(stubContext(), actor)
    p.DeliverExperience(target)
    // Should not queue any activity since target is at max level
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns DeliverExperience', () => {
    const actor = stubActor()
    const p = new DeliversExperienceProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('DeliverExperience')
  })
})

// ---------------------------------------------------------------------------
// DemolitionProperties
// ---------------------------------------------------------------------------

describe('DemolitionProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Combat', () => {
    expect(DemolitionProperties.category).toBe('Combat')
  })

  it('requires IMoveInfo and DemolitionInfo', () => {
    expect(DemolitionProperties.requiredTraits).toContain('IMoveInfo')
    expect(DemolitionProperties.requiredTraits).toContain('DemolitionInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(DemolitionProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === DemolitionProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Combat')
  })

  it('Demolish queues Demolish activity when enabled demolition exists', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([{ isDisabled: false }]),
    })
    const target = stubActor({ actorId: 2 })
    const p = new DemolitionProperties(stubContext(), actor)
    p.Demolish(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('Demolish')
  })

  it('Demolish does nothing when all demolitions are disabled', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([{ isDisabled: true }]),
    })
    const target = stubActor({ actorId: 2 })
    const p = new DemolitionProperties(stubContext(), actor)
    p.Demolish(target)
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns Demolish', () => {
    const actor = stubActor()
    const p = new DemolitionProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Demolish')
  })
})

// ---------------------------------------------------------------------------
// GuardProperties
// ---------------------------------------------------------------------------

describe('GuardProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Combat', () => {
    expect(GuardProperties.category).toBe('Combat')
  })

  it('requires GuardInfo and IMoveInfo', () => {
    expect(GuardProperties.requiredTraits).toContain('GuardInfo')
    expect(GuardProperties.requiredTraits).toContain('IMoveInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(GuardProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === GuardProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Combat')
  })

  it('Guard calls guardTarget when target has GuardableInfo', () => {
    const guardTrait = { guardTarget: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Guard' ? guardTrait : null),
    })
    const target = stubActor({
      actorId: 2,
      info: { hasTraitInfo: vi.fn().mockReturnValue(true) },
    })
    const p = new GuardProperties(stubContext(), actor)
    p.Guard(target)
    expect(guardTrait.guardTarget).toHaveBeenCalledWith(actor, target)
  })

  it('Guard does nothing when target lacks GuardableInfo', () => {
    const guardTrait = { guardTarget: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Guard' ? guardTrait : null),
    })
    const target = stubActor({
      actorId: 2,
      info: { hasTraitInfo: vi.fn().mockReturnValue(false) },
    })
    const p = new GuardProperties(stubContext(), actor)
    p.Guard(target)
    expect(guardTrait.guardTarget).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns Guard', () => {
    const actor = stubActor()
    const p = new GuardProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Guard')
  })
})

// ---------------------------------------------------------------------------
// ConditionProperties
// ---------------------------------------------------------------------------

describe('ConditionProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category General', () => {
    expect(ConditionProperties.category).toBe('General')
  })

  it('requires ExternalConditionInfo', () => {
    expect(ConditionProperties.requiredTraits).toContain('ExternalConditionInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ConditionProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ConditionProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('General')
  })

  it('GrantCondition throws when condition not listed', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([]),
    })
    const p = new ConditionProperties(stubContext(), actor)
    expect(() => p.GrantCondition('nonexistent')).toThrow(
      "Condition 'nonexistent' has not been listed on an enabled ExternalCondition trait",
    )
  })

  it('GrantCondition returns token on success', () => {
    const extCond = {
      info: { condition: 'invulnerable' },
      canGrantCondition: vi.fn().mockReturnValue(true),
      grantCondition: vi.fn().mockReturnValue(42),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([extCond]),
    })
    const p = new ConditionProperties(stubContext(), actor)
    const token = p.GrantCondition('invulnerable')
    expect(token).toBe(42)
    expect(extCond.grantCondition).toHaveBeenCalledWith(actor, p, 0)
  })

  it('AcceptsCondition returns true when condition exists', () => {
    const extCond = {
      info: { condition: 'invulnerable' },
      canGrantCondition: vi.fn().mockReturnValue(true),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([extCond]),
    })
    const p = new ConditionProperties(stubContext(), actor)
    expect(p.AcceptsCondition('invulnerable')).toBe(true)
  })

  it('AcceptsCondition returns false for non-matching condition', () => {
    const extCond = {
      info: { condition: 'invulnerable' },
      canGrantCondition: vi.fn().mockReturnValue(true),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([extCond]),
    })
    const p = new ConditionProperties(stubContext(), actor)
    expect(p.AcceptsCondition('stealth')).toBe(false)
  })

  it('RevokeCondition tries all external conditions', () => {
    const ext1 = { tryRevokeCondition: vi.fn().mockReturnValue(false) }
    const ext2 = { tryRevokeCondition: vi.fn().mockReturnValue(true) }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([ext1, ext2]),
    })
    const p = new ConditionProperties(stubContext(), actor)
    p.RevokeCondition(42)
    expect(ext1.tryRevokeCondition).toHaveBeenCalledWith(actor, p, 42)
    expect(ext2.tryRevokeCondition).toHaveBeenCalledWith(actor, p, 42)
  })

  it('getOwnMemberDescriptors returns all 3 methods', () => {
    const actor = stubActor()
    const p = new ConditionProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('GrantCondition')
    expect(names).toContain('RevokeCondition')
    expect(names).toContain('AcceptsCondition')
  })
})
