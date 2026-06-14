/**
 * Pluggable.test.ts — Pluggable migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: PluggableInfo configuration, default values, Conditions/Requirements
 * map semantics, accept/disable/enable lifecycle, variable observers,
 * BooleanExpression evaluation.
 */

import { describe, it, expect } from 'vitest'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { PluggableInfo, Pluggable } from './Pluggable.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock IGameActor with grantCondition/revokeCondition support. */
function createMockActor(): IGameActor & {
  grantCondition: (cond: string) => number
  revokeCondition: (token: number) => number
} {
  let nextToken = 100
  const activeConditions = new Map<number, string>()

  return {
    actorId: 1,
    displayName: 'test-actor',
    world: null,
    owner: null,
    centerPosition: { X: 0, Y: 0, Z: 0 },
    grantedConditions: activeConditions,

    grantCondition(cond: string): number {
      const token = nextToken++
      activeConditions.set(token, cond)
      return token
    },

    revokeCondition(token: number): number {
      activeConditions.delete(token)
      return -1
    },
  } as unknown as IGameActor & {
    grantCondition: (cond: string) => number
    revokeCondition: (token: number) => number
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluggableInfo', () => {
  it('has correct default values', () => {
    const info = new PluggableInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.offset).toEqual(CVec.Zero)
    expect(info.conditions).toEqual(new Map())
    expect(info.requirements).toEqual(new Map())
    expect(info.editorOptions).toEqual(new Map())
    expect(info.emptyOption).toBe('Empty')
    expect(info.editorDisplayOrder).toBe(5)
  })

  it('accepts conditions as Map', () => {
    const conditions = new Map([['turret', 'has-turret'], ['radar', 'has-radar']])
    const info = new PluggableInfo({ conditions })
    expect(info.conditions.get('turret')).toBe('has-turret')
    expect(info.conditions.get('radar')).toBe('has-radar')
    expect(info.conditions.has('unknown')).toBe(false)
  })

  it('accepts conditions as plain object', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret', radar: 'has-radar' },
    })
    expect(info.conditions.get('turret')).toBe('has-turret')
    expect(info.conditions.get('radar')).toBe('has-radar')
    expect(info.conditions.size).toBe(2)
  })

  it('accepts requirements as Map', () => {
    const requirements = new Map([['turret', 'powered && !disabled']])
    const info = new PluggableInfo({ requirements })
    expect(info.requirements.get('turret')).toBe('powered && !disabled')
    expect(info.requirements.has('unknown')).toBe(false)
  })

  it('accepts requirements as plain object', () => {
    const info = new PluggableInfo({
      requirements: { turret: 'powered && !disabled' },
    })
    expect(info.requirements.get('turret')).toBe('powered && !disabled')
  })

  it('accepts editorOptions', () => {
    const info = new PluggableInfo({
      editorOptions: { turret: 'Turret Upgrade', radar: 'Radar Dish' },
    })
    expect(info.editorOptions.get('turret')).toBe('Turret Upgrade')
    expect(info.editorOptions.get('radar')).toBe('Radar Dish')
  })

  it('accepts custom offset', () => {
    const offset = new CVec(1, 2)
    const info = new PluggableInfo({ offset })
    expect(info.offset).toBe(offset)
    expect(info.offset.X).toBe(1)
    expect(info.offset.Y).toBe(2)
  })

  it('accepts custom emptyOption and editorDisplayOrder', () => {
    const info = new PluggableInfo({ emptyOption: 'None', editorDisplayOrder: 10 })
    expect(info.emptyOption).toBe('None')
    expect(info.editorDisplayOrder).toBe(10)
  })

  it('conditions map is independent per instance', () => {
    const info1 = new PluggableInfo({ conditions: { a: 'cond-a' } })
    const info2 = new PluggableInfo({ conditions: { b: 'cond-b' } })
    expect(info1.conditions.has('a')).toBe(true)
    expect(info2.conditions.has('b')).toBe(true)
    expect(info1.conditions.has('b')).toBe(false)
  })
})

describe('Pluggable', () => {
  it('is constructible with info', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable).toBeInstanceOf(Pluggable)
    expect(pluggable.info).toBe(info)
  })

  it('is constructible with initialPlug', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info, 'turret')
    expect(pluggable).toBeInstanceOf(Pluggable)
  })

  it('active is null by default', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable.active).toBeNull()
  })

  it('conditionToken is -1 by default', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable.conditionToken).toBe(-1)
  })

  it('self is null before created()', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable.self).toBeNull()
  })
})

describe('Pluggable — AcceptsPlug', () => {
  it('returns false for unknown plug type', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable.acceptsPlug('unknown')).toBe(false)
  })

  it('returns true for known type with no requirements when no active plug', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable.acceptsPlug('turret')).toBe(true)
  })

  it('returns false for known type when another plug is already active', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret', radar: 'has-radar' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)
    pluggable.enablePlug(actor, 'turret')

    // Now radar can't be accepted since turret is active
    expect(pluggable.acceptsPlug('radar')).toBe(false)
    // But turret itself can still be checked
    expect(pluggable.acceptsPlug('turret')).toBe(false) // also false because no requirements
  })

  it('returns false when conditions is empty', () => {
    const info = new PluggableInfo()
    const pluggable = new Pluggable(info)
    expect(pluggable.acceptsPlug('anything')).toBe(false)
  })
})

describe('Pluggable — EnablePlug / DisablePlug', () => {
  it('enables a plug and grants condition', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    pluggable.enablePlug(actor, 'turret')

    expect(pluggable.active).toBe('turret')
    expect(pluggable.conditionToken).toBeGreaterThan(0)
    expect(pluggable.conditionToken).not.toBe(-1)
  })

  it('disabling an active plug revokes condition and clears active', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    pluggable.enablePlug(actor, 'turret')
    const token = pluggable.conditionToken
    expect(pluggable.active).toBe('turret')

    pluggable.disablePlug(actor, 'turret')
    expect(pluggable.active).toBeNull()
    expect(pluggable.conditionToken).toBe(-1)
    // Verify the old token was returned (revokeCondition returns -1 on success)
    expect(token).toBeGreaterThan(0)
  })

  it('disabling a non-active plug type does nothing', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret', radar: 'has-radar' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    pluggable.enablePlug(actor, 'turret')
    expect(pluggable.active).toBe('turret')

    // Try to disable a different type — should be a no-op
    pluggable.disablePlug(actor, 'radar')
    expect(pluggable.active).toBe('turret') // still turret
  })

  it('enables plug via initialPlug on created()', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info, 'turret')
    pluggable.created(actor)

    expect(pluggable.active).toBe('turret')
    expect(pluggable.conditionToken).toBeGreaterThan(0)
  })

  it('enablePlug with unknown type does nothing', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    pluggable.enablePlug(actor, 'unknown')
    expect(pluggable.active).toBeNull()
    expect(pluggable.conditionToken).toBe(-1)
  })

  it('enabling a new plug replaces the old one', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret', radar: 'has-radar' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    pluggable.enablePlug(actor, 'turret')
    const turretToken = pluggable.conditionToken
    expect(pluggable.active).toBe('turret')

    pluggable.enablePlug(actor, 'radar')
    const radarToken = pluggable.conditionToken
    expect(pluggable.active).toBe('radar')
    // Tokens should be different (new grant, old revoked)
    expect(radarToken).not.toBe(turretToken)
  })
})

describe('Pluggable — Variable Observers', () => {
  it('returns empty array when no requirements', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    expect(pluggable.getVariableObservers()).toEqual([])
  })

  it('returns observers for requirements', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: 'powered && !disabled' },
    })
    const pluggable = new Pluggable(info)

    const observers = pluggable.getVariableObservers()
    expect(observers.length).toBe(1)

    const obs = observers[0]
    expect(obs.variables).toContain('powered')
    expect(obs.variables).toContain('disabled')
    expect(typeof obs.notifier).toBe('function')
  })

  it('multiple requirements produce multiple observers', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret', radar: 'has-radar' },
      requirements: {
        turret: 'powered && !disabled',
        radar: 'radar_available || !jammed',
      },
    })
    const pluggable = new Pluggable(info)

    const observers = pluggable.getVariableObservers()
    expect(observers.length).toBe(2)
  })

  it('observer notifier updates plug type availability', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: 'powered' },
    })
    const pluggable = new Pluggable(info)
    const actor = createMockActor()
    pluggable.created(actor)

    const observers = pluggable.getVariableObservers()
    expect(observers.length).toBe(1)

    // When powered > 0, turret is available
    const conditionsPowered = new Map([['powered', 1]])
    observers[0].notifier(actor, conditionsPowered)
    expect(pluggable.acceptsPlug('turret')).toBe(true)

    // When powered <= 0, turret is not available
    const conditionsUnpowered = new Map([['powered', 0]])
    observers[0].notifier(actor, conditionsUnpowered)
    expect(pluggable.acceptsPlug('turret')).toBe(false)
  })

  it('observer notifier handles negation correctly', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: '!disabled' },
    })
    const pluggable = new Pluggable(info)
    const actor = createMockActor()
    pluggable.created(actor)

    const observers = pluggable.getVariableObservers()
    expect(observers[0].variables).toContain('disabled')

    // When disabled is 0, !disabled is true → turret available
    observers[0].notifier(actor, new Map([['disabled', 0]]))
    expect(pluggable.acceptsPlug('turret')).toBe(true)

    // When disabled is 1, !disabled is false → turret not available
    observers[0].notifier(actor, new Map([['disabled', 1]]))
    expect(pluggable.acceptsPlug('turret')).toBe(false)
  })

  it('observer notifier handles AND logic', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: 'powered && upgraded' },
    })
    const pluggable = new Pluggable(info)
    const actor = createMockActor()
    pluggable.created(actor)

    const observers = pluggable.getVariableObservers()

    // Both true → available
    observers[0].notifier(actor, new Map([['powered', 1], ['upgraded', 1]]))
    expect(pluggable.acceptsPlug('turret')).toBe(true)

    // Only one true → not available
    observers[0].notifier(actor, new Map([['powered', 1], ['upgraded', 0]]))
    expect(pluggable.acceptsPlug('turret')).toBe(false)
  })

  it('observer notifier handles OR logic', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: 'powered || backup' },
    })
    const pluggable = new Pluggable(info)
    const actor = createMockActor()
    pluggable.created(actor)

    const observers = pluggable.getVariableObservers()

    // Either true → available
    observers[0].notifier(actor, new Map([['powered', 1], ['backup', 0]]))
    expect(pluggable.acceptsPlug('turret')).toBe(true)

    observers[0].notifier(actor, new Map([['powered', 0], ['backup', 1]]))
    expect(pluggable.acceptsPlug('turret')).toBe(true)

    // Neither true → not available
    observers[0].notifier(actor, new Map([['powered', 0], ['backup', 0]]))
    expect(pluggable.acceptsPlug('turret')).toBe(false)
  })

  it('observer notifier handles parenthesized expressions', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: '(powered || backup) && !destroyed' },
    })
    const pluggable = new Pluggable(info)
    const actor = createMockActor()
    pluggable.created(actor)

    const observers = pluggable.getVariableObservers()
    expect(observers.length).toBe(1)
    // Parenthesized groups should extract variables correctly
    expect(observers[0].variables).toContain('powered')
    expect(observers[0].variables).toContain('backup')
    expect(observers[0].variables).toContain('destroyed')

    // (powered=true || backup=false) && !destroyed=true → true
    observers[0].notifier(
      actor,
      new Map([['powered', 1], ['backup', 0], ['destroyed', 0]]),
    )
    expect(pluggable.acceptsPlug('turret')).toBe(true)
  })

  it('observer variables exclude empty expressions', () => {
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: '  ' }, // whitespace-only expression
    })
    const pluggable = new Pluggable(info)
    const actors = pluggable.getVariableObservers()
    expect(actors.length).toBe(0) // no variables to observe
  })
})

describe('Pluggable — Lifecycle', () => {
  it('created sets self reference', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)
    expect(pluggable.self).toBe(actor)
  })

  it('full lifecycle: created → enable → disable', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    // Enable
    pluggable.enablePlug(actor, 'turret')
    expect(pluggable.active).toBe('turret')
    expect(pluggable.conditionToken).not.toBe(-1)

    // Disable
    pluggable.disablePlug(actor, 'turret')
    expect(pluggable.active).toBeNull()
    expect(pluggable.conditionToken).toBe(-1)
  })

  it('full lifecycle with requirements and variable observers', () => {
    const actor = createMockActor()
    const info = new PluggableInfo({
      conditions: { turret: 'has-turret' },
      requirements: { turret: 'powered' },
    })
    const pluggable = new Pluggable(info)
    pluggable.created(actor)

    const observers = pluggable.getVariableObservers()

    // Initially not powered → cannot accept
    observers[0].notifier(actor, new Map([['powered', 0]]))
    expect(pluggable.acceptsPlug('turret')).toBe(false)

    // Power comes online
    observers[0].notifier(actor, new Map([['powered', 1]]))
    expect(pluggable.acceptsPlug('turret')).toBe(true)

    // Enable
    pluggable.enablePlug(actor, 'turret')
    expect(pluggable.active).toBe('turret')
  })
})
