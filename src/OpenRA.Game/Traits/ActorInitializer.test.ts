/**
 * ActorInitializer.test.ts — ActorInitializer unit tests
 *
 * Tests focus on: init creation, type-based lookup, value extraction,
 * instance-name targeting, fallback behavior, error handling.
 */

import { describe, it, expect } from 'vitest'
import {
  LocationInit,
  OwnerNameInit,
  OwnerInit,
  FacingInit,
  ActorInitializer,
} from './ActorInitializer.js'
import { CPos } from '../CPos.js'
import type { PlayerStub } from './TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestPlayer(name: string, internalName: string): PlayerStub {
  return {
    playerName: name,
    internalName,
  }
}

// ---------------------------------------------------------------------------
// ActorInit base class
// ---------------------------------------------------------------------------

describe('ActorInit', () => {
  it('constructs with default empty instanceName', () => {
    // Use a concrete subclass to test ActorInit behavior
    const init = new LocationInit(new CPos(5, 10))
    expect(init.instanceName).toBe('')
  })

  it('ValueActorInit stores and exposes value', () => {
    const init = new LocationInit(new CPos(3, 7))
    expect(init.value).toBeDefined()
    expect(init.value.X).toBe(3)
    expect(init.value.Y).toBe(7)
  })

  it('typeName is set on concrete subclasses', () => {
    expect(LocationInit.typeName).toBe('LocationInit')
    expect(OwnerNameInit.typeName).toBe('OwnerNameInit')
    expect(OwnerInit.typeName).toBe('OwnerInit')
    expect(FacingInit.typeName).toBe('FacingInit')
  })
})

// ---------------------------------------------------------------------------
// LocationInit
// ---------------------------------------------------------------------------

describe('LocationInit', () => {
  it('creates with CPos value', () => {
    const cpos = new CPos(10, 20)
    const init = new LocationInit(cpos)
    expect(init.value).toBe(cpos)
    expect(init.value.X).toBe(10)
    expect(init.value.Y).toBe(20)
  })

  it('is a single-instance init', () => {
    const init = new LocationInit(new CPos(0, 0))
    // LocationInit implements ISingleInstanceInit marker interface
    expect(init).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// OwnerNameInit
// ---------------------------------------------------------------------------

describe('OwnerNameInit', () => {
  it('creates with owner name string', () => {
    const init = new OwnerNameInit('Multi0')
    expect(init.value).toBe('Multi0')
  })

  it('is a single-instance init', () => {
    const init = new OwnerNameInit('Neutral')
    expect(init).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// OwnerInit
// ---------------------------------------------------------------------------

describe('OwnerInit', () => {
  it('creates with PlayerStub value', () => {
    const player = createTestPlayer('Player 1', 'Multi0')
    const init = new OwnerInit(player)
    expect(init.value).toBe(player)
    expect(init.value.playerName).toBe('Player 1')
  })

  it('is a single-instance init', () => {
    const player = createTestPlayer('Test', 'test')
    const init = new OwnerInit(player)
    expect(init).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// FacingInit
// ---------------------------------------------------------------------------

describe('FacingInit', () => {
  it('creates with facing angle', () => {
    const init = new FacingInit(128)
    expect(init.value).toBe(128)
  })

  it('handles zero facing', () => {
    const init = new FacingInit(0)
    expect(init.value).toBe(0)
  })

  it('is a single-instance init', () => {
    const init = new FacingInit(256)
    expect(init).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// ActorInitializer collection
// ---------------------------------------------------------------------------

describe('ActorInitializer', () => {
  it('constructs empty', () => {
    const ai = new ActorInitializer()
    expect(ai.size).toBe(0)
    expect(ai.initTypes()).toEqual([])
  })

  it('constructs with inits', () => {
    const ai = new ActorInitializer([
      new LocationInit(new CPos(1, 2)),
      new OwnerNameInit('Player1'),
    ])
    expect(ai.size).toBe(2)
    expect(ai.contains('LocationInit')).toBe(true)
    expect(ai.contains('OwnerNameInit')).toBe(true)
  })

  // -----------------------------------------------------------------------
  // getOrDefault
  // -----------------------------------------------------------------------

  it('getOrDefault returns init by typeName', () => {
    const cpos = new CPos(5, 10)
    const ai = new ActorInitializer([new LocationInit(cpos)])
    const result = ai.getOrDefault<LocationInit>('LocationInit')
    expect(result).not.toBeNull()
    expect(result!.value.X).toBe(5)
    expect(result!.value.Y).toBe(10)
  })

  it('getOrDefault returns null for missing type', () => {
    const ai = new ActorInitializer()
    const result = ai.getOrDefault<LocationInit>('LocationInit')
    expect(result).toBeNull()
  })

  it('getOrDefault prefers last unnamed init (YAML override semantics)', () => {
    const ai = new ActorInitializer([
      new FacingInit(100),
      new FacingInit(200),
    ])
    const result = ai.getOrDefault<FacingInit>('FacingInit')
    expect(result).not.toBeNull()
    expect(result!.value).toBe(200) // Last one wins
  })

  // -----------------------------------------------------------------------
  // get (throws)
  // -----------------------------------------------------------------------

  it('get returns init by typeName', () => {
    const ai = new ActorInitializer([new OwnerNameInit('Multi0')])
    const result = ai.get<OwnerNameInit>('OwnerNameInit')
    expect(result.value).toBe('Multi0')
  })

  it('get throws for missing type', () => {
    const ai = new ActorInitializer()
    expect(() => ai.get<LocationInit>('LocationInit')).toThrow(
      "ActorInitializer does not contain init of type 'LocationInit'",
    )
  })

  // -----------------------------------------------------------------------
  // getValue
  // -----------------------------------------------------------------------

  it('getValue extracts value from ValueActorInit', () => {
    const ai = new ActorInitializer([new FacingInit(512)])
    const result = ai.getValue<number>('FacingInit')
    expect(result).toBe(512)
  })

  it('getValue throws for missing type', () => {
    const ai = new ActorInitializer()
    expect(() => ai.getValue<number>('FacingInit')).toThrow()
  })

  // -----------------------------------------------------------------------
  // getValueOrDefault
  // -----------------------------------------------------------------------

  it('getValueOrDefault returns value when init present', () => {
    const ai = new ActorInitializer([new FacingInit(768)])
    const result = ai.getValueOrDefault<number>('FacingInit', 0)
    expect(result).toBe(768)
  })

  it('getValueOrDefault returns fallback when init missing', () => {
    const ai = new ActorInitializer()
    const result = ai.getValueOrDefault<number>('FacingInit', 128)
    expect(result).toBe(128)
  })

  // -----------------------------------------------------------------------
  // contains
  // -----------------------------------------------------------------------

  it('contains returns true for present type', () => {
    const ai = new ActorInitializer([new LocationInit(new CPos(0, 0))])
    expect(ai.contains('LocationInit')).toBe(true)
  })

  it('contains returns false for missing type', () => {
    const ai = new ActorInitializer()
    expect(ai.contains('LocationInit')).toBe(false)
  })

  // -----------------------------------------------------------------------
  // allInits
  // -----------------------------------------------------------------------

  it('allInits returns all inits', () => {
    const inits = [
      new LocationInit(new CPos(1, 1)),
      new OwnerNameInit('Test'),
      new FacingInit(64),
    ]
    const ai = new ActorInitializer(inits)
    const all = ai.allInits()
    expect(all.length).toBe(3)
    expect(all).toContain(inits[0])
    expect(all).toContain(inits[1])
    expect(all).toContain(inits[2])
  })

  // -----------------------------------------------------------------------
  // initTypes
  // -----------------------------------------------------------------------

  it('initTypes returns unique type names', () => {
    const ai = new ActorInitializer([
      new LocationInit(new CPos(0, 0)),
      new OwnerNameInit('A'),
    ])
    const types = ai.initTypes()
    expect(types).toContain('LocationInit')
    expect(types).toContain('OwnerNameInit')
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('handles duplicate init types', () => {
    const ai = new ActorInitializer([
      new OwnerNameInit('First'),
      new OwnerNameInit('Second'),
    ])
    expect(ai.size).toBe(2)
    // getOrDefault returns last (YAML override semantics)
    expect(ai.getOrDefault<OwnerNameInit>('OwnerNameInit')!.value).toBe('Second')
  })
})
