/**
 * PlayerConditionProperties.test.ts — Unit tests for PlayerConditionProperties
 *
 * Tests: registration, category, requiredTraits, 3 methods,
 * error paths for invalid conditions, null trait handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { PlayerConditionProperties } from './PlayerConditionProperties.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubPlayer(overrides: Record<string, unknown> = {}): PlayerStub {
  return {
    playerName: 'TestPlayer',
    playerActor: {
      traitsImplementing: vi.fn().mockReturnValue([]),
      trait: vi.fn().mockReturnValue(null),
    },
    ...overrides,
  } as unknown as PlayerStub
}

function stubContext(): any {
  return {
    world: { actors: [], map: { rules: { actors: new Map() } } },
    worldRenderer: {},
    fatalErrorOccurred: false,
    errorMessage: null,
  }
}

describe('PlayerConditionProperties', () => {
  beforeEach(() => {
    // Module import handles registration
  })

  // ---- Category & Registration ----

  it('has category Player via ScriptRegistry', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerConditionProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Player')
  })

  it('requires ExternalConditionInfo', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerConditionProperties,
    )
    expect(reg!.requiredTraits).toContain('ExternalConditionInfo')
  })

  it('is registered with ScriptRegistry.registerPlayerProperty', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerConditionProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.description).toContain('GrantCondition')
  })

  // ---- GrantCondition ----

  it('GrantCondition finds matching ExternalCondition and grants it', () => {
    const externalCond = {
      info: { condition: 'overpowered' },
      canGrantCondition: vi.fn().mockReturnValue(true),
      grantCondition: vi.fn().mockReturnValue(42),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([externalCond]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    const token = props.GrantCondition('overpowered', 100)
    expect(token).toBe(42)
    expect(externalCond.grantCondition).toHaveBeenCalledWith(playerActor, expect.anything(), 100)
  })

  it('GrantCondition throws for unknown condition', () => {
    const externalCond = {
      info: { condition: 'fast' },
      canGrantCondition: vi.fn().mockReturnValue(true),
      grantCondition: vi.fn().mockReturnValue(1),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([externalCond]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    expect(() => props.GrantCondition('unknown')).toThrow(
      'has not been listed on an enabled ExternalCondition trait',
    )
  })

  it('GrantCondition throws when canGrantCondition returns false', () => {
    const externalCond = {
      info: { condition: 'invulnerable' },
      canGrantCondition: vi.fn().mockReturnValue(false),
      grantCondition: vi.fn(),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([externalCond]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    expect(() => props.GrantCondition('invulnerable')).toThrow(
      'has not been listed on an enabled ExternalCondition trait',
    )
  })

  // ---- RevokeCondition ----

  it('RevokeCondition iterates externalConditions and revokes on first match', () => {
    const cond1 = {
      info: { condition: 'fast' },
      canGrantCondition: vi.fn().mockReturnValue(true),
      tryRevokeCondition: vi.fn().mockReturnValue(false),
    }
    const cond2 = {
      info: { condition: 'strong' },
      canGrantCondition: vi.fn().mockReturnValue(true),
      tryRevokeCondition: vi.fn().mockReturnValue(true),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([cond1, cond2]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    props.RevokeCondition(42)
    expect(cond1.tryRevokeCondition).toHaveBeenCalledWith(playerActor, expect.anything(), 42)
    expect(cond2.tryRevokeCondition).toHaveBeenCalledWith(playerActor, expect.anything(), 42)
  })

  // ---- AcceptsCondition ----

  it('AcceptsCondition returns true when condition is accepted', () => {
    const externalCond = {
      info: { condition: 'fast' },
      canGrantCondition: vi.fn().mockReturnValue(true),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([externalCond]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    expect(props.AcceptsCondition('fast')).toBe(true)
  })

  it('AcceptsCondition returns false when condition is not accepted', () => {
    const externalCond = {
      info: { condition: 'fast' },
      canGrantCondition: vi.fn().mockReturnValue(false),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([externalCond]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    expect(props.AcceptsCondition('fast')).toBe(false)
  })

  it('AcceptsCondition returns false for unknown condition', () => {
    const externalCond = {
      info: { condition: 'fast' },
      canGrantCondition: vi.fn().mockReturnValue(true),
    }
    const playerActor = {
      traitsImplementing: vi.fn().mockReturnValue([externalCond]),
      trait: vi.fn().mockReturnValue(null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerConditionProperties(stubContext(), player)
    expect(props.AcceptsCondition('unknown')).toBe(false)
  })

  // ---- Null trait handling ----

  it('handles missing playerActor gracefully', () => {
    const player = stubPlayer({ playerActor: undefined })
    const props = new PlayerConditionProperties(stubContext(), player)
    expect(props.AcceptsCondition('test')).toBe(false)
    expect(() => props.GrantCondition('test')).toThrow(
      'has not been listed on an enabled ExternalCondition trait',
    )
  })

  // ---- Member Descriptors ----

  it('getOwnMemberDescriptors returns all 3 methods', () => {
    const player = stubPlayer()
    const props = new PlayerConditionProperties(stubContext(), player)
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('GrantCondition')
    expect(names).toContain('RevokeCondition')
    expect(names).toContain('AcceptsCondition')
  })
})
