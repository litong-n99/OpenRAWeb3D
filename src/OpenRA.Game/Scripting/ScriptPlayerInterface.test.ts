/**
 * ScriptPlayerInterface.test.ts — ScriptPlayerInterface unit tests
 *
 * Tests focus on: player-scoped property binding, error message formatting,
 * get/set operations on player properties, member descriptor resolution.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ScriptPlayerInterface, ScriptPlayerProperties } from './ScriptPlayerInterface'
import { ScriptRegistry } from './ScriptRegistry'
import type { IScriptContext, MemberDescriptor } from './ScriptMemberDescriptor'
import type { PlayerStub } from '../Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubContext: IScriptContext = {
  world: { actors: [] } as any,
  worldRenderer: {},
  fatalErrorOccurred: false,
  errorMessage: null,
  getActorCommands: () => [],
  playerCommands: ScriptRegistry.getPlayerProperties(),
  registerMapActor: () => {},
  fatalError: () => {},
  logDebug: () => {},
  get namedActors() { return new Map() },
}

function createPlayer(overrides: Partial<PlayerStub> = {}): PlayerStub {
  return {
    playerName: 'test-player',
    ...overrides,
  }
}

// Concrete ScriptPlayerProperties subclass for testing
class TestPlayerProps extends ScriptPlayerProperties {
  static readonly requiredTraits: readonly string[] = []

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [{
      memberType: 'property',
      name: 'testProp',
      returnType: 'string',
      get: () => 'hello',
    }]
  }
}

class ValuePlayerProps extends ScriptPlayerProperties {
  static readonly requiredTraits: readonly string[] = []

  private _val = 0

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [{
      memberType: 'property',
      name: 'score',
      returnType: 'number',
      get: () => this._val,
      set: (_t, v) => { this._val = v as number },
    }]
  }
}

class MultiPlayerProps extends ScriptPlayerProperties {
  static readonly requiredTraits: readonly string[] = []

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property',
        name: 'name',
        returnType: 'string',
        get: () => this.player.playerName,
      },
      {
        memberType: 'method',
        name: 'echo',
        returnType: 'string',
        parameters: [{ name: 'msg', type: 'string', optional: false }],
        invoke: (_t, args) => `echo: ${args[0] as string}`,
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptPlayerInterface', () => {
  let player: PlayerStub

  beforeEach(() => {
    ScriptRegistry._resetForTest()
    player = createPlayer()
  })

  it('creates interface with no property classes', () => {
    const iface = new ScriptPlayerInterface(stubContext, player)
    expect(iface.player).toBe(player)
    expect(iface.containsKey('nonexistent')).toBe(false)
  })

  it('creates interface with bound property classes', () => {
    ScriptRegistry.registerPlayerProperty({
      category: 'Test',
      ctor: TestPlayerProps,
      requiredTraits: [],
      description: 'Test property group',
    })

    // Rebuild context so playerCommands picks up registration
    const ctx = { ...stubContext, playerCommands: ScriptRegistry.getPlayerProperties() }
    const iface = new ScriptPlayerInterface(ctx, player)
    expect(iface.containsKey('testProp')).toBe(true)
    expect(iface.get('testProp')).toBe('hello')
  })

  it('duplicateKeyError formatting includes player name', () => {
    const p1 = createPlayer({ playerName: 'Commander' })
    const iface = new ScriptPlayerInterface(stubContext, p1)

    // Access protected method via type cast
    const msg = (iface as any)['duplicateKeyError']('foo')
    expect(msg).toContain('Commander')
    expect(msg).toContain('foo')
  })

  it('memberNotFoundError formatting includes player name', () => {
    const p1 = createPlayer({ playerName: 'General' })
    const iface = new ScriptPlayerInterface(stubContext, p1)

    expect(() => iface.get('missingProp')).toThrow(/General/)
    expect(() => iface.get('missingProp')).toThrow(/does not define a property/)
  })

  it('get/set works on bound player properties', () => {
    ScriptRegistry.registerPlayerProperty({
      category: 'Value',
      ctor: ValuePlayerProps,
      requiredTraits: [],
      description: 'Score property',
    })

    const ctx = { ...stubContext, playerCommands: ScriptRegistry.getPlayerProperties() }
    const iface = new ScriptPlayerInterface(ctx, player)

    expect(iface.get('score')).toBe(0)
    iface.set('score', 100)
    expect(iface.get('score')).toBe(100)
  })

  it('getMemberDescriptors returns descriptors for ScriptPlayerProperties instances', () => {
    ScriptRegistry.registerPlayerProperty({
      category: 'Multi',
      ctor: MultiPlayerProps,
      requiredTraits: [],
      description: 'Multi property group',
    })

    const ctx = { ...stubContext, playerCommands: ScriptRegistry.getPlayerProperties() }
    const iface = new ScriptPlayerInterface(ctx, createPlayer({ playerName: 'Multi' }))

    expect(iface.containsKey('name')).toBe(true)
    expect(iface.get('name')).toBe('Multi')

    // Method binding
    expect(iface.containsKey('echo')).toBe(true)
    const fn = iface.get('echo') as Function
    expect(fn('world')).toBe('echo: world')
  })

  it('uses resolvedPlayerName when available for error messages', () => {
    const p1 = createPlayer({ playerName: 'fallbackName' }) as any
    p1.resolvedPlayerName = 'DisplayName'

    const iface = new ScriptPlayerInterface(stubContext, p1)
    const msg = (iface as any)['duplicateKeyError']('bar')
    expect(msg).toContain('DisplayName')
    expect(msg).not.toContain('fallbackName')
  })

  it('falls back to "unknown" when no player name available', () => {
    const p1 = {} as PlayerStub // no playerName property
    const iface = new ScriptPlayerInterface(stubContext, p1)

    const msg = (iface as any)['duplicateKeyError']('baz')
    expect(msg).toContain('unknown')
  })
})

describe('ScriptPlayerProperties', () => {
  it('has static requiredTraits placeholder', () => {
    // ScriptPlayerProperties is abstract — can't instantiate directly
    // but can check static properties
    expect(ScriptPlayerProperties.requiredTraits).toBeUndefined() // placeholder from abstract
  })
})
