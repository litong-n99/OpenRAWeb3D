/**
 * SupportPowerProperties.test.ts — Unit tests for support power property classes
 *
 * Covers: NukeProperties, ParadropProperties, ParatroopersProperties,
 * AirstrikeProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * method invocation, member descriptor completeness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { NukeProperties } from './NukeProperties.js'
import { ParadropProperties } from './ParadropProperties.js'
import { ParatroopersProperties } from './ParatroopersProperties.js'
import { AirstrikeProperties } from './AirstrikeProperties.js'

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
    world: { map: { centerOfCell: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }) } },
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
// NukeProperties
// ---------------------------------------------------------------------------

describe('NukeProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Support Powers', () => {
    expect(NukeProperties.category).toBe('Support Powers')
  })

  it('requires NukePowerInfo', () => {
    expect(NukeProperties.requiredTraits).toContain('NukePowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(NukeProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === NukeProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Support Powers')
  })

  it('ActivateNukePower activates the nuke power', () => {
    const nukePower = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'NukePower') return [nukePower]
        if (name === 'INotifySupportPower') return [{ activated: vi.fn() }]
        return []
      }),
    })
    const p = new NukeProperties(stubContext(), actor)
    p.ActivateNukePower({ x: 5, y: 3 })
    expect(nukePower.activate).toHaveBeenCalled()
  })

  it('ActivateNukePower notifies support power listeners', () => {
    const nukePower = { activate: vi.fn() }
    const notify = { activated: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'NukePower') return [nukePower]
        if (name === 'INotifySupportPower') return [notify]
        return []
      }),
    })
    const p = new NukeProperties(stubContext(), actor)
    p.ActivateNukePower({ x: 5, y: 3 })
    expect(notify.activated).toHaveBeenCalledWith(actor)
  })

  it('ActivateNukePower does nothing when no nuke power', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([]),
    })
    const p = new NukeProperties(stubContext(), actor)
    // Should not throw
    p.ActivateNukePower({ x: 5, y: 3 })
  })

  it('getOwnMemberDescriptors returns ActivateNukePower', () => {
    const actor = stubActor()
    const p = new NukeProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('ActivateNukePower')
  })
})

// ---------------------------------------------------------------------------
// ParadropProperties
// ---------------------------------------------------------------------------

describe('ParadropProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Transports', () => {
    expect(ParadropProperties.category).toBe('Transports')
  })

  it('requires CargoInfo and ParaDropInfo', () => {
    expect(ParadropProperties.requiredTraits).toContain('CargoInfo')
    expect(ParadropProperties.requiredTraits).toContain('ParaDropInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ParadropProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ParadropProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Transports')
  })

  it('Paradrop sets LZ and queues activities', () => {
    const paradrop = { setLZ: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'ParaDrop' ? paradrop : null),
    })
    const p = new ParadropProperties(stubContext(), actor)
    p.Paradrop({ x: 5, y: 3 })
    expect(paradrop.setLZ).toHaveBeenCalledWith({ x: 5, y: 3 }, true)
    // Should queue Fly, FlyOffMap, RemoveSelf
    expect((actor.queueActivity as any).mock.calls.length).toBe(3)
    const names = (actor.queueActivity as any).mock.calls.map((c: any[]) => c[0].activityName)
    expect(names).toContain('Fly')
    expect(names).toContain('FlyOffMap')
    expect(names).toContain('RemoveSelf')
  })

  it('Paradrop does nothing when no ParaDrop trait', () => {
    const actor = stubActor()
    const p = new ParadropProperties(stubContext(), actor)
    p.Paradrop({ x: 5, y: 3 })
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns Paradrop', () => {
    const actor = stubActor()
    const p = new ParadropProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Paradrop')
  })
})

// ---------------------------------------------------------------------------
// ParatroopersProperties
// ---------------------------------------------------------------------------

describe('ParatroopersProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Support Powers', () => {
    expect(ParatroopersProperties.category).toBe('Support Powers')
  })

  it('requires ParatroopersPowerInfo', () => {
    expect(ParatroopersProperties.requiredTraits).toContain('ParatroopersPowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ParatroopersProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ParatroopersProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Support Powers')
  })

  it('TargetParatroopers returns aircraft from sendParatroopers', () => {
    const aircraft = { actorId: 99 }
    const pp = { sendParatroopers: vi.fn().mockReturnValue({ aircraft: [aircraft] }) }
    const notify = { activated: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'ParatroopersPower') return [pp]
        if (name === 'INotifySupportPower') return [notify]
        return []
      }),
    })
    const p = new ParatroopersProperties(stubContext(), actor)
    const result = p.TargetParatroopers({ x: 0, y: 0 })
    expect(result).toEqual([aircraft])
    expect(notify.activated).toHaveBeenCalled()
  })

  it('TargetParatroopers returns empty array when no power', () => {
    const actor = stubActor()
    const p = new ParatroopersProperties(stubContext(), actor)
    expect(p.TargetParatroopers({ x: 0, y: 0 })).toEqual([])
  })

  it('getOwnMemberDescriptors returns TargetParatroopers', () => {
    const actor = stubActor()
    const p = new ParatroopersProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('TargetParatroopers')
  })
})

// ---------------------------------------------------------------------------
// AirstrikeProperties
// ---------------------------------------------------------------------------

describe('AirstrikeProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Support Powers', () => {
    expect(AirstrikeProperties.category).toBe('Support Powers')
  })

  it('requires AirstrikePowerInfo', () => {
    expect(AirstrikeProperties.requiredTraits).toContain('AirstrikePowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(AirstrikeProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === AirstrikeProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Support Powers')
  })

  it('TargetAirstrike returns aircraft from sendAirstrike', () => {
    const aircraft = { actorId: 100 }
    const ap = { sendAirstrike: vi.fn().mockReturnValue([aircraft]) }
    const notify = { activated: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'AirstrikePower') return [ap]
        if (name === 'INotifySupportPower') return [notify]
        return []
      }),
    })
    const p = new AirstrikeProperties(stubContext(), actor)
    const result = p.TargetAirstrike({ x: 0, y: 0 })
    expect(result).toEqual([aircraft])
    expect(notify.activated).toHaveBeenCalled()
  })

  it('TargetAirstrike returns empty array when no power', () => {
    const actor = stubActor()
    const p = new AirstrikeProperties(stubContext(), actor)
    expect(p.TargetAirstrike({ x: 0, y: 0 })).toEqual([])
  })

  it('getOwnMemberDescriptors returns TargetAirstrike', () => {
    const actor = stubActor()
    const p = new AirstrikeProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('TargetAirstrike')
  })
})
