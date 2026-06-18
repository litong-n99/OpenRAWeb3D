/**
 * IonCannonProperties.test.ts — Unit tests for IonCannonProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * method invocation, member descriptor completeness.
 *
 * TODO-20.F.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { MethodDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { IonCannonProperties } from './IonCannonProperties.js'

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
// IonCannonProperties
// ---------------------------------------------------------------------------

describe('IonCannonProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Support Powers', () => {
    expect(IonCannonProperties.category).toBe('Support Powers')
  })

  it('requires IonCannonPowerInfo', () => {
    expect(IonCannonProperties.requiredTraits).toContain('IonCannonPowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(IonCannonProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === IonCannonProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Support Powers')
    expect(reg!.requiredTraits).toContain('IonCannonPowerInfo')
  })

  it('ActivateIonCannon calls activate on the ion cannon power trait', () => {
    const icp = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp]
        return []
      }),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    const target = { x: 5, y: 3 }
    p.ActivateIonCannon(target)
    expect(icp.activate).toHaveBeenCalledWith(actor, target)
  })

  it('ActivateIonCannon does nothing when no IonCannonPower trait', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([]),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    // Should not throw
    expect(() => p.ActivateIonCannon({ x: 5, y: 3 })).not.toThrow()
  })

  it('ActivateIonCannon uses first power when multiple traits exist', () => {
    const icp1 = { activate: vi.fn() }
    const icp2 = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp1, icp2]
        return []
      }),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    const target = { x: 10, y: 20 }
    p.ActivateIonCannon(target)
    expect(icp1.activate).toHaveBeenCalledWith(actor, target)
    expect(icp2.activate).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns ActivateIonCannon', () => {
    const actor = stubActor()
    const p = new IonCannonProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('ActivateIonCannon')
    // Verify descriptor structure
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'ActivateIonCannon')
    expect(desc).toBeDefined()
    expect(desc!.memberType).toBe('method')
    expect(desc!.returnType).toBe('nil')
    expect((desc as MethodDescriptor).parameters).toHaveLength(1)
    expect((desc as MethodDescriptor).parameters[0].name).toBe('target')
  })

  it('member descriptor invoke calls ActivateIonCannon', () => {
    const icp = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp]
        return []
      }),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'ActivateIonCannon')
    expect(desc).toBeDefined()
    const target = { x: 7, y: 8 }
    ;(desc as MethodDescriptor).invoke?.(p, [target])
    expect(icp.activate).toHaveBeenCalledWith(actor, target)
  })
})
