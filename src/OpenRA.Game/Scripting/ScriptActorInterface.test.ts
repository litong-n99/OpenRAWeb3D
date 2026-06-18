/**
 * ScriptActorInterface.test.ts — ScriptActorInterface unit tests
 *
 * Tests focus on: trait-filtered command availability, destroyed actor
 * command restriction, reinitializeBindings, exposeForDestroyedActors.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ScriptActorInterface, ScriptActorProperties } from './ScriptActorInterface'
import { ScriptRegistry } from './ScriptRegistry'
import type { IScriptContext, MemberDescriptor } from './ScriptMemberDescriptor'
import type { IGameActor } from '../Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubContext: IScriptContext = {
  world: { actors: [] } as any,
  worldRenderer: {},
  fatalErrorOccurred: false,
  errorMessage: null,
  getActorCommands: (_info) => ScriptRegistry.getActorProperties(),
  playerCommands: [],
  registerMapActor: () => {},
  fatalError: () => {},
  logDebug: () => {},
  get namedActors() { return new Map() },
}

function createActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name: 'test-actor' },
    traitsImplementing: (_interfaceId: string) => [],
    ...overrides,
  }
}

// Concrete ScriptActorProperties subclass for testing
class TestActorProps extends ScriptActorProperties {
  static readonly category = 'Test'
  static readonly requiredTraits: readonly string[] = []
  static readonly exposedForDestroyedActors = false

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [{
      memberType: 'property',
      name: 'testProp',
      returnType: 'number',
      get: () => 42,
    }]
  }
}

class SafeActorProps extends ScriptActorProperties {
  static readonly category = 'Safe'
  static readonly requiredTraits: readonly string[] = []
  static readonly exposedForDestroyedActors = true

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [{
      memberType: 'property',
      name: 'safeProp',
      returnType: 'string',
      get: () => 'safe',
    }]
  }
}

class TraitActorProps extends ScriptActorProperties {
  static readonly category = 'Trait'
  static readonly requiredTraits = ['IHealthInfo']
  static readonly exposedForDestroyedActors = false

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [{
      memberType: 'property',
      name: 'hp',
      returnType: 'number',
      get: () => 100,
    }]
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptActorInterface', () => {
  beforeEach(() => {
    ScriptRegistry._resetForTest()
  })

  it('creates interface with no property classes', () => {
    const actor = createActor()
    const iface = new ScriptActorInterface(stubContext, actor)
    expect(iface.actor).toBe(actor)
    expect(iface.containsKey('nonexistent')).toBe(false)
  })

  it('creates interface with bound property classes', () => {
    ScriptRegistry.registerActorProperty({
      category: 'Test',
      ctor: TestActorProps,
      requiredTraits: [],
      exposedForDestroyedActors: false,
    })

    const actor = createActor()
    const iface = new ScriptActorInterface(stubContext, actor)
    expect(iface.containsKey('testProp')).toBe(true)
  })

  it('provides trait-filtered command availability', () => {
    ScriptRegistry.registerActorProperty({
      category: 'Trait',
      ctor: TraitActorProps,
      requiredTraits: ['IHealthInfo'],
      exposedForDestroyedActors: false,
    })
    ScriptRegistry.registerActorProperty({
      category: 'Test',
      ctor: TestActorProps,
      requiredTraits: [],
      exposedForDestroyedActors: false,
    })

    const actor = createActor({
      traitsImplementing: (id: string) => id === 'IHealthInfo' ? [{}] : [],
    })

    const iface = new ScriptActorInterface(stubContext, actor)
    // Both should be available because getActorCommands uses the cached
    // function from the context. The actual trait filtering happens via
    // ScriptRegistry.getActorCommands which uses hasTraitInfo.
    // We need to set the hasTraitInfoFn on the interface.
    iface.setHasTraitInfoFn((trait) => trait === 'IHealthInfo')

    // Re-initialize to apply the trait filter
    iface.reinitializeBindings()

    expect(iface.containsKey('testProp')).toBe(true)
    expect(iface.containsKey('hp')).toBe(true)
  })

  it('onActorDestroyed removes non-exposed properties', () => {
    ScriptRegistry.registerActorProperty({
      category: 'Test',
      ctor: TestActorProps,
      requiredTraits: [],
      exposedForDestroyedActors: false,
    })
    ScriptRegistry.registerActorProperty({
      category: 'Safe',
      ctor: SafeActorProps,
      requiredTraits: [],
      exposedForDestroyedActors: true,
    })

    const actor = createActor()
    const iface = new ScriptActorInterface(stubContext, actor)
    expect(iface.containsKey('testProp')).toBe(true)
    expect(iface.containsKey('safeProp')).toBe(true)

    iface.onActorDestroyed()

    expect(iface.containsKey('testProp')).toBe(false)
    expect(iface.containsKey('safeProp')).toBe(true) // exposedForDestroyedActors
  })

  it('formats error messages with actor name', () => {
    const actor = createActor({ info: { name: 'e1' } })
    const iface = new ScriptActorInterface(stubContext, actor)

    expect(() => iface.get('nonexistent')).toThrow(/e1/)
  })

  it('formats error messages with (dead) suffix for dead actors', () => {
    const actor = createActor({ info: { name: 'e1' }, isDead: true })
    const iface = new ScriptActorInterface(stubContext, actor)

    expect(() => iface.get('nonexistent')).toThrow(/e1.*dead/)
  })

  it('handles destroyed actor with only exposed properties', () => {
    ScriptRegistry.registerActorProperty({
      category: 'Safe',
      ctor: SafeActorProps,
      requiredTraits: [],
      exposedForDestroyedActors: true,
    })

    // Create an already-disposed actor
    const actor = createActor({ disposed: true })
    const iface = new ScriptActorInterface(stubContext, actor)

    // Only exposedForDestroyedActors properties should be bound
    expect(iface.containsKey('safeProp')).toBe(true)
  })

  it('reinitializeBindings clears and rebinds', () => {
    ScriptRegistry.registerActorProperty({
      category: 'Test',
      ctor: TestActorProps,
      requiredTraits: [],
      exposedForDestroyedActors: false,
    })

    const actor = createActor()
    const iface = new ScriptActorInterface(stubContext, actor)
    expect(iface.containsKey('testProp')).toBe(true)

    iface.reinitializeBindings()
    expect(iface.containsKey('testProp')).toBe(true)
  })
})

describe('ScriptActorProperties', () => {
  it('has static category placeholder', () => {
    // ScriptActorProperties is abstract — can't instantiate directly
    // but can check static properties
    expect(ScriptActorProperties.category).toBeUndefined() // placeholder from abstract
  })
})
