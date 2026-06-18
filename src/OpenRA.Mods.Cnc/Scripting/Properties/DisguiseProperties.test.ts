/**
 * DisguiseProperties.test.ts — Unit tests for DisguiseProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * DisguiseAs, DisguiseAsType, member descriptors.
 *
 *
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { MethodDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { DisguiseProperties } from './DisguiseProperties.js'

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
    world: {
      map: {
        rules: {
          actors: {
            'e1': { name: 'e1', traits: [] },
            'e2': { name: 'e2', traits: [] },
          },
        },
      },
    },
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
// DisguiseProperties
// ---------------------------------------------------------------------------

describe('DisguiseProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Ability', () => {
    expect(DisguiseProperties.category).toBe('Ability')
  })

  it('requires DisguiseInfo', () => {
    expect(DisguiseProperties.requiredTraits).toContain('DisguiseInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(DisguiseProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === DisguiseProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Ability')
    expect(reg!.requiredTraits).toContain('DisguiseInfo')
  })

  it('DisguiseAs calls _disguiseAs on the disguise trait', () => {
    const disguise = { _disguiseAs: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
    })
    const target = stubActor({ actorId: 2 })
    const p = new DisguiseProperties(stubContext(), actor)
    p.DisguiseAs(target)
    expect(disguise._disguiseAs).toHaveBeenCalledWith(target)
  })

  it('DisguiseAs does nothing when no Disguise trait', () => {
    const actor = stubActor({
      trait: vi.fn().mockReturnValue(null),
    })
    const target = stubActor({ actorId: 2 })
    const p = new DisguiseProperties(stubContext(), actor)
    expect(() => p.DisguiseAs(target)).not.toThrow()
  })

  it('DisguiseAsType looks up actor info from rules and calls _disguiseFromFrozen', () => {
    const disguise = { _disguiseFromFrozen: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
    })
    const newOwner = { playerName: 'Enemy' }
    const p = new DisguiseProperties(stubContext(), actor)
    p.DisguiseAsType('e1', newOwner)
    expect(disguise._disguiseFromFrozen).toHaveBeenCalledWith(
      { name: 'e1', traits: [] },
      newOwner,
    )
  })

  it('DisguiseAsType does nothing when actor type not found', () => {
    const disguise = { _disguiseFromFrozen: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
    })
    const p = new DisguiseProperties(stubContext(), actor)
    p.DisguiseAsType('nonexistent', { playerName: 'Enemy' })
    expect(disguise._disguiseFromFrozen).not.toHaveBeenCalled()
  })

  it('DisguiseAsType does nothing when no Disguise trait', () => {
    const actor = stubActor({
      trait: vi.fn().mockReturnValue(null),
    })
    const p = new DisguiseProperties(stubContext(), actor)
    expect(() => p.DisguiseAsType('e1', { playerName: 'Enemy' })).not.toThrow()
  })

  it('getOwnMemberDescriptors returns DisguiseAs and DisguiseAsType', () => {
    const actor = stubActor()
    const p = new DisguiseProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('DisguiseAs')
    expect(names).toContain('DisguiseAsType')
    expect(names).toHaveLength(2)
  })

  it('DisguiseAs member descriptor invoke calls DisguiseAs', () => {
    const disguise = { _disguiseAs: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
    })
    const target = stubActor({ actorId: 3 })
    const p = new DisguiseProperties(stubContext(), actor)
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'DisguiseAs')
    expect(desc).toBeDefined()
    ;(desc as MethodDescriptor).invoke?.(p, [target])
    expect(disguise._disguiseAs).toHaveBeenCalledWith(target)
  })

  // -------------------------------------------------------------------------
  // Edge cases — P1-E.7
  // -------------------------------------------------------------------------

  it('DisguiseAs does nothing when _disguiseAs is not a function', () => {
    const disguise = { _disguiseAs: 'not a function' }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
    })
    const target = stubActor({ actorId: 2 })
    const p = new DisguiseProperties(stubContext(), actor)
    expect(() => p.DisguiseAs(target)).not.toThrow()
  })

  it('DisguiseAsType does nothing when world has no map', () => {
    const disguise = { _disguiseFromFrozen: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
      world: {}, // no map
    })
    const p = new DisguiseProperties(stubContext(), actor)
    expect(() => p.DisguiseAsType('e1', { playerName: 'Enemy' })).not.toThrow()
    expect(disguise._disguiseFromFrozen).not.toHaveBeenCalled()
  })

  it('DisguiseAsType does nothing when map has no rules', () => {
    const disguise = { _disguiseFromFrozen: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
      world: { map: {} }, // map without rules
    })
    const p = new DisguiseProperties(stubContext(), actor)
    expect(() => p.DisguiseAsType('e1', { playerName: 'Enemy' })).not.toThrow()
    expect(disguise._disguiseFromFrozen).not.toHaveBeenCalled()
  })

  it('DisguiseAsType uses rules from world.map.rules path', () => {
    const disguise = { _disguiseFromFrozen: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
      // Uses world.map.rules path (already set up by stubActor)
    })
    const newOwner = { playerName: 'Enemy2' }
    const p = new DisguiseProperties(stubContext(), actor)
    p.DisguiseAsType('e2', newOwner)
    expect(disguise._disguiseFromFrozen).toHaveBeenCalledWith(
      { name: 'e2', traits: [] },
      newOwner,
    )
  })

  it('DisguiseAs works with multiple calls to same actor', () => {
    const disguise = { _disguiseAs: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'Disguise' ? disguise : null),
    })
    const target1 = stubActor({ actorId: 10 })
    const target2 = stubActor({ actorId: 20 })
    const p = new DisguiseProperties(stubContext(), actor)
    p.DisguiseAs(target1)
    p.DisguiseAs(target2)
    expect(disguise._disguiseAs).toHaveBeenCalledTimes(2)
    expect(disguise._disguiseAs).toHaveBeenNthCalledWith(1, target1)
    expect(disguise._disguiseAs).toHaveBeenNthCalledWith(2, target2)
  })

  it('DisguiseAsDisguiseAsType member descriptors have correct parameters', () => {
    const actor = stubActor()
    const p = new DisguiseProperties(stubContext(), actor)

    const asDesc = p.getOwnMemberDescriptors().find(d => d.name === 'DisguiseAs')
    expect(asDesc).toBeDefined()
    const asMd = asDesc as MethodDescriptor
    expect(asMd.parameters).toHaveLength(1)
    expect(asMd.parameters[0].name).toBe('target')
    expect(asMd.parameters[0].type).toBe('Actor')

    const typeDesc = p.getOwnMemberDescriptors().find(d => d.name === 'DisguiseAsType')
    expect(typeDesc).toBeDefined()
    const typeMd = typeDesc as MethodDescriptor
    expect(typeMd.parameters).toHaveLength(2)
    expect(typeMd.parameters[0].name).toBe('actorType')
    expect(typeMd.parameters[0].type).toBe('string')
    expect(typeMd.parameters[1].name).toBe('newOwner')
    expect(typeMd.parameters[1].type).toBe('Player')
  })
})
