/**
 * CombatProperties.test.ts — Unit tests for CombatProperties (2 classes)
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * method invocation, and member descriptor completeness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { CombatProperties, GeneralCombatProperties } from './CombatProperties.js'

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
// CombatProperties
// ---------------------------------------------------------------------------

describe('CombatProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Combat', () => {
    expect(CombatProperties.category).toBe('Combat')
  })

  it('requires AttackBaseInfo and IMoveInfo', () => {
    expect(CombatProperties.requiredTraits).toContain('AttackBaseInfo')
    expect(CombatProperties.requiredTraits).toContain('IMoveInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(CombatProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === CombatProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Combat')
    expect(reg!.requiredTraits).toContain('AttackBaseInfo')
    expect(reg!.exposedForDestroyedActors).toBe(false)
  })

  it('Hunt queues Hunt activity', () => {
    const actor = stubActor()
    const p = new CombatProperties(stubContext(), actor)
    p.Hunt()
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('Hunt')
  })

  it('AttackMove queues AttackMoveActivity', () => {
    const move = { moveTo: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'IMove' ? move : null),
    })
    const p = new CombatProperties(stubContext(), actor)
    p.AttackMove({ x: 5, y: 3 })
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('AttackMoveActivity')
  })

  it('Patrol queues AttackMoveActivity for each waypoint', () => {
    const move = { moveTo: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'IMove' ? move : null),
    })
    const p = new CombatProperties(stubContext(), actor)
    p.Patrol([{ x: 1, y: 1 }, { x: 2, y: 2 }], false)
    // 2 waypoints * 2 activities (AttackMove + Wait) = 4
    expect((actor.queueActivity as any).mock.calls.length).toBe(4)
  })

  it('PatrolUntil calls Patrol with loop=false', () => {
    const move = { moveTo: vi.fn() }
    const actor = stubActor({
      trait: vi.fn((name: string) => name === 'IMove' ? move : null),
    })
    const p = new CombatProperties(stubContext(), actor)
    // func returns false so no recursion
    p.PatrolUntil([{ x: 1, y: 1 }], () => false)
    // 1 waypoint: AttackMove + Wait = 2 activities
    expect((actor.queueActivity as any).mock.calls.length).toBe(2)
  })

  it('getOwnMemberDescriptors returns all 4 methods', () => {
    const actor = stubActor()
    const p = new CombatProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Hunt')
    expect(names).toContain('AttackMove')
    expect(names).toContain('Patrol')
    expect(names).toContain('PatrolUntil')
  })
})

// ---------------------------------------------------------------------------
// GeneralCombatProperties
// ---------------------------------------------------------------------------

describe('GeneralCombatProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Combat', () => {
    expect(GeneralCombatProperties.category).toBe('Combat')
  })

  it('requires AttackBaseInfo', () => {
    expect(GeneralCombatProperties.requiredTraits).toContain('AttackBaseInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(GeneralCombatProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === GeneralCombatProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Combat')
  })

  it('Attack calls attackTarget on all attack bases', () => {
    const attackBase = { attackTarget: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([attackBase]),
    })
    const target = stubActor({ actorId: 2 })
    const p = new GeneralCombatProperties(stubContext(), actor)
    p.Attack(target)
    expect(attackBase.attackTarget).toHaveBeenCalledWith(target, 'Default', true, true, false)
  })

  it('CanTarget returns false for null target', () => {
    const actor = stubActor()
    const p = new GeneralCombatProperties(stubContext(), actor)
    expect(p.CanTarget(null as unknown as IGameActor)).toBe(false)
  })

  it('CanTarget delegates to actor.canTarget', () => {
    const actor = stubActor({ canTarget: vi.fn().mockReturnValue(true) })
    const target = stubActor({ actorId: 2 })
    const p = new GeneralCombatProperties(stubContext(), actor)
    expect(p.CanTarget(target)).toBe(true)
    expect((actor as any).canTarget).toHaveBeenCalledWith(target)
  })

  it('getOwnMemberDescriptors returns Attack and CanTarget', () => {
    const actor = stubActor()
    const p = new GeneralCombatProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Attack')
    expect(names).toContain('CanTarget')
  })
})
