/**
 * ChronosphereProperties.test.ts — Unit tests for ChronosphereProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * Chronoshift method with actor/cell pairs, Chronoshiftable trait lookup,
 * member descriptors.
 *
 * TODO-20.F.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { MethodDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { ChronosphereProperties } from './ChronosphereProperties.js'

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
// ChronosphereProperties
// ---------------------------------------------------------------------------

describe('ChronosphereProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Support Powers', () => {
    expect(ChronosphereProperties.category).toBe('Support Powers')
  })

  it('requires ChronoshiftPowerInfo', () => {
    expect(ChronosphereProperties.requiredTraits).toContain('ChronoshiftPowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ChronosphereProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ChronosphereProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Support Powers')
    expect(reg!.requiredTraits).toContain('ChronoshiftPowerInfo')
  })

  it('Chronoshift teleports a single actor to a target cell', () => {
    const chronoshiftable = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([chronoshiftable]),
    })
    const targetCell = { x: 5, y: 3 }
    const p = new ChronosphereProperties(stubContext(), stubActor())
    p.Chronoshift([[actor, targetCell]])
    expect(chronoshiftable.canChronoshiftTo).toHaveBeenCalledWith(actor, targetCell)
    expect(chronoshiftable.teleport).toHaveBeenCalledWith(actor, targetCell, 0, false, p['self'])
  })

  it('Chronoshift with custom duration and killCargo', () => {
    const chronoshiftable = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([chronoshiftable]),
    })
    const targetCell = { x: 10, y: 20 }
    const p = new ChronosphereProperties(stubContext(), stubActor())
    p.Chronoshift([[actor, targetCell]], 500, true)
    expect(chronoshiftable.teleport).toHaveBeenCalledWith(actor, targetCell, 500, true, p['self'])
  })

  it('Chronoshift skips actors that cannot chronoshift to target', () => {
    const chronoshiftable = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(false),
      teleport: vi.fn(),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([chronoshiftable]),
    })
    const p = new ChronosphereProperties(stubContext(), stubActor())
    p.Chronoshift([[actor, { x: 5, y: 3 }]])
    expect(chronoshiftable.teleport).not.toHaveBeenCalled()
  })

  it('Chronoshift skips disabled Chronoshiftable traits', () => {
    const disabled = {
      isTraitDisabled: true,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const enabled = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([disabled, enabled]),
    })
    const p = new ChronosphereProperties(stubContext(), stubActor())
    p.Chronoshift([[actor, { x: 5, y: 3 }]])
    expect(disabled.teleport).not.toHaveBeenCalled()
    expect(enabled.teleport).toHaveBeenCalled()
  })

  it('Chronoshift handles multiple actor/cell pairs', () => {
    const cs1 = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const cs2 = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const actor1 = stubActor({
      actorId: 10,
      traitsImplementing: vi.fn().mockReturnValue([cs1]),
    })
    const actor2 = stubActor({
      actorId: 20,
      traitsImplementing: vi.fn().mockReturnValue([cs2]),
    })
    const p = new ChronosphereProperties(stubContext(), stubActor())
    p.Chronoshift([
      [actor1, { x: 1, y: 2 }],
      [actor2, { x: 3, y: 4 }],
    ])
    expect(cs1.teleport).toHaveBeenCalledWith(actor1, { x: 1, y: 2 }, 0, false, p['self'])
    expect(cs2.teleport).toHaveBeenCalledWith(actor2, { x: 3, y: 4 }, 0, false, p['self'])
  })

  it('Chronoshift skips entries with null/undefined actor or cell', () => {
    const chronoshiftable = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([chronoshiftable]),
    })
    const p = new ChronosphereProperties(stubContext(), stubActor())
    // Should not throw for null actor or cell
    expect(() => p.Chronoshift([[null as any, { x: 1, y: 2 }]])).not.toThrow()
    expect(() => p.Chronoshift([[actor, null as any]])).not.toThrow()
    expect(() => p.Chronoshift([[actor, undefined as any]])).not.toThrow()
    expect(chronoshiftable.teleport).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns Chronoshift with correct parameters', () => {
    const actor = stubActor()
    const p = new ChronosphereProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Chronoshift')
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'Chronoshift')
    expect(desc).toBeDefined()
    expect(desc!.memberType).toBe('method')
    expect(desc!.returnType).toBe('nil')
    const md = desc as MethodDescriptor
    expect(md.parameters).toHaveLength(3)
    expect(md.parameters[0].name).toBe('unitLocationPairs')
    expect(md.parameters[0].optional).toBe(false)
    expect(md.parameters[1].name).toBe('duration')
    expect(md.parameters[1].optional).toBe(true)
    expect(md.parameters[2].name).toBe('killCargo')
    expect(md.parameters[2].optional).toBe(true)
  })

  it('member descriptor invoke calls Chronoshift with default params', () => {
    const chronoshiftable = {
      isTraitDisabled: false,
      canChronoshiftTo: vi.fn().mockReturnValue(true),
      teleport: vi.fn(),
    }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([chronoshiftable]),
    })
    const p = new ChronosphereProperties(stubContext(), stubActor())
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'Chronoshift')
    expect(desc).toBeDefined()
    const pairs: [IGameActor, unknown][] = [[actor, { x: 5, y: 3 }]]
    ;(desc as MethodDescriptor).invoke?.(p, [pairs])
    expect(chronoshiftable.teleport).toHaveBeenCalledWith(actor, { x: 5, y: 3 }, 0, false, p['self'])
  })
})
