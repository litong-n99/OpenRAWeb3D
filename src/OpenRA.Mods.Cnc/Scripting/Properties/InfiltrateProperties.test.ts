/**
 * InfiltrateProperties.test.ts — Unit tests for InfiltrateProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * Infiltrate method, trait filter logic, member descriptors.
 *
 *
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { MethodDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { InfiltrateProperties } from './InfiltrateProperties.js'

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
// InfiltrateProperties
// ---------------------------------------------------------------------------

describe('InfiltrateProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Ability', () => {
    expect(InfiltrateProperties.category).toBe('Ability')
  })

  it('requires InfiltratesInfo', () => {
    expect(InfiltrateProperties.requiredTraits).toContain('InfiltratesInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(InfiltrateProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === InfiltrateProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Ability')
    expect(reg!.requiredTraits).toContain('InfiltratesInfo')
  })

  it('Infiltrate queues activity when target types overlap', () => {
    const infiltrates = {
      isTraitDisabled: false,
      info: { types: ['Building'], targetLineColor: 'Crimson' },
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
    })
    const target = stubActor({
      actorId: 2,
      getEnabledTargetTypes: vi.fn().mockReturnValue(['Building', 'Structure']),
    })
    const p = new InfiltrateProperties(stubContext(), actor)
    p.Infiltrate(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const callArgs = (actor.queueActivity as any).mock.calls[0]
    expect(callArgs[0]).toBe(false) // queued = false
    expect(callArgs[1].__type).toBe('Infiltrate')
    expect(callArgs[1].infiltrates).toBe(infiltrates)
  })

  it('Infiltrate does nothing when no matching target types', () => {
    const infiltrates = {
      isTraitDisabled: false,
      info: { types: ['Vehicle'] },
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
    })
    const target = stubActor({
      actorId: 2,
      getEnabledTargetTypes: vi.fn().mockReturnValue(['Building', 'Infantry']),
    })
    const p = new InfiltrateProperties(stubContext(), actor)
    p.Infiltrate(target)
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })

  it('Infiltrate skips disabled traits', () => {
    const disabled = {
      isTraitDisabled: true,
      info: { types: ['Building'] },
    }
    const enabled = {
      isTraitDisabled: false,
      info: { types: ['Building'] },
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([disabled, enabled]),
    })
    const target = stubActor({
      actorId: 2,
      getEnabledTargetTypes: vi.fn().mockReturnValue(['Building']),
    })
    const p = new InfiltrateProperties(stubContext(), actor)
    p.Infiltrate(target)
    expect(actor.queueActivity).toHaveBeenCalled()
    const callArgs = (actor.queueActivity as any).mock.calls[0]
    expect(callArgs[1].infiltrates).toBe(enabled)
  })

  it('Infiltrate does nothing when no Infiltrates traits', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([]),
    })
    const target = stubActor({ actorId: 2 })
    const p = new InfiltrateProperties(stubContext(), actor)
    expect(() => p.Infiltrate(target)).not.toThrow()
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns Infiltrate', () => {
    const actor = stubActor()
    const p = new InfiltrateProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Infiltrate')
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'Infiltrate')
    expect(desc).toBeDefined()
    expect(desc!.memberType).toBe('method')
    expect((desc as MethodDescriptor).parameters).toHaveLength(1)
    expect((desc as MethodDescriptor).parameters[0].name).toBe('target')
  })

  it('getOwnMemberDescriptors returns all five infiltration methods', () => {
    const actor = stubActor()
    const p = new InfiltrateProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Infiltrate')
    expect(names).toContain('InfiltrateForCash')
    expect(names).toContain('InfiltrateForExploration')
    expect(names).toContain('InfiltrateForPowerOutage')
    expect(names).toContain('InfiltrateForSupportPower')
    expect(names).toHaveLength(5)
  })

  it('member descriptor invoke calls Infiltrate', () => {
    const infiltrates = {
      isTraitDisabled: false,
      info: { types: ['Building'] },
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
    })
    const target = stubActor({
      actorId: 3,
      getEnabledTargetTypes: vi.fn().mockReturnValue(['Building']),
    })
    const p = new InfiltrateProperties(stubContext(), actor)
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'Infiltrate')
    expect(desc).toBeDefined()
    ;(desc as MethodDescriptor).invoke?.(p, [target])
    expect(actor.queueActivity).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Convenience infiltration methods — P1-E.8
  // -------------------------------------------------------------------------

  describe('InfiltrateForCash', () => {
    it('queues activity when types match Cash', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Cash'], targetLineColor: 'Gold' },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['Cash']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForCash(target)
      expect(actor.queueActivity).toHaveBeenCalled()
      const callArgs = (actor.queueActivity as any).mock.calls[0]
      expect(callArgs[0]).toBe(false)
      expect(callArgs[1].__type).toBe('Infiltrate')
      expect(callArgs[1].infiltrates).toBe(infiltrates)
    })

    it('no-ops when no Cash type in infiltrates', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Building'] },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['Cash']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForCash(target)
      expect(actor.queueActivity).not.toHaveBeenCalled()
    })

    it('no-ops when target does not accept Cash type', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Cash'] },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['Building', 'Structure']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForCash(target)
      expect(actor.queueActivity).not.toHaveBeenCalled()
    })
  })

  describe('InfiltrateForExploration', () => {
    it('queues activity when types match Exploration', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Exploration'], targetLineColor: 'Blue' },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['Exploration']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForExploration(target)
      expect(actor.queueActivity).toHaveBeenCalled()
      const callArgs = (actor.queueActivity as any).mock.calls[0]
      expect(callArgs[1].infiltrates).toBe(infiltrates)
    })

    it('no-ops when no Exploration type match', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Cash'] },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['Exploration']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForExploration(target)
      expect(actor.queueActivity).not.toHaveBeenCalled()
    })
  })

  describe('InfiltrateForPowerOutage', () => {
    it('queues activity when types match PowerOutage', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['PowerOutage'], targetLineColor: 'DarkRed' },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['PowerOutage']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForPowerOutage(target)
      expect(actor.queueActivity).toHaveBeenCalled()
      const callArgs = (actor.queueActivity as any).mock.calls[0]
      expect(callArgs[1].infiltrates).toBe(infiltrates)
    })

    it('no-ops when no PowerOutage type match', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Exploration'] },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['PowerOutage']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForPowerOutage(target)
      expect(actor.queueActivity).not.toHaveBeenCalled()
    })
  })

  describe('InfiltrateForSupportPower', () => {
    it('queues activity when types match SupportPower', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['SupportPower'], targetLineColor: 'Purple' },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['SupportPower']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForSupportPower(target)
      expect(actor.queueActivity).toHaveBeenCalled()
      const callArgs = (actor.queueActivity as any).mock.calls[0]
      expect(callArgs[1].infiltrates).toBe(infiltrates)
    })

    it('no-ops when no SupportPower type match', () => {
      const infiltrates = {
        isTraitDisabled: false,
        info: { types: ['Cash'] },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([infiltrates]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['SupportPower']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      p.InfiltrateForSupportPower(target)
      expect(actor.queueActivity).not.toHaveBeenCalled()
    })
  })

  describe('Convenience methods with disabled traits', () => {
    it('skips disabled traits for convenience methods', () => {
      const disabledCash = {
        isTraitDisabled: true,
        info: { types: ['Cash'] },
      }
      const enabledExploration = {
        isTraitDisabled: false,
        info: { types: ['Exploration'] },
      }
      const actor = stubActor({
        traitsImplementing: vi.fn().mockReturnValue([disabledCash, enabledExploration]),
      })
      const target = stubActor({
        actorId: 2,
        getEnabledTargetTypes: vi.fn().mockReturnValue(['Cash', 'Exploration']),
      })
      const p = new InfiltrateProperties(stubContext(), actor)
      // InfiltrateForCash should no-op because the Cash trait is disabled
      p.InfiltrateForCash(target)
      expect(actor.queueActivity).not.toHaveBeenCalled()
      // InfiltrateForExploration should succeed because its trait is enabled
      p.InfiltrateForExploration(target)
      expect(actor.queueActivity).toHaveBeenCalledTimes(1)
    })
  })
})
