/**
 * ActorInitializer.test.ts — ActorInitializer migration unit tests
 *
 * Tests focus on: init bag storage, get/set/contains, convenience classes,
 * Map cloning, ValueActorInit value retrieval.
 */

import { describe, it, expect } from 'vitest'
import {
  ActorInitializer,
  ValueActorInit,
  LocationInit,
  CenterPositionInit,
  FacingInit,
  CreationActivityDelayInit,
  RallyPointInit,
  OwnerInit,
} from './ActorInitializer.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Simple concrete ActorInit for testing. */
class TestInit extends ValueActorInit<string> {
  readonly key = 'test'

  constructor(value: string) {
    super(value)
  }
}

/** Numeric init for testing. */
class NumberInit extends ValueActorInit<number> {
  readonly key = 'number'

  constructor(value: number) {
    super(value)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActorInit', () => {
  it('stores value through ValueActorInit', () => {
    const init = new TestInit('hello')
    expect(init.key).toBe('test')
    expect(init.value).toBe('hello')
  })
})

describe('ValueActorInit', () => {
  it('implements ISingleInstanceInit', () => {
    const init = new TestInit('x')
    // ISingleInstanceInit is a marker interface — no runtime check needed
    expect(init.value).toBe('x')
  })

  it('value is immutable', () => {
    const init = new NumberInit(42)
    expect(init.value).toBe(42)
  })
})

describe('ActorInitializer', () => {
  it('creates empty bag by default', () => {
    const init = new ActorInitializer()
    expect(init.count).toBe(0)
    expect(init.contains('anything')).toBe(false)
  })

  it('populates bag from ActorInit array', () => {
    const init = new ActorInitializer([
      new TestInit('hello'),
      new NumberInit(42),
    ])
    expect(init.count).toBe(2)
    expect(init.get<string>('test')).toBe('hello')
    expect(init.get<number>('number')).toBe(42)
  })

  it('get returns undefined for missing key', () => {
    const init = new ActorInitializer()
    expect(init.get('missing')).toBeUndefined()
  })

  it('contains returns true for existing key', () => {
    const init = new ActorInitializer([new TestInit('hello')])
    expect(init.contains('test')).toBe(true)
    expect(init.contains('missing')).toBe(false)
  })

  it('set adds new value', () => {
    const init = new ActorInitializer()
    init.set('custom', 'value')
    expect(init.get('custom')).toBe('value')
    expect(init.count).toBe(1)
  })

  it('set overwrites existing value', () => {
    const init = new ActorInitializer([new TestInit('old')])
    init.set('test', 'new')
    expect(init.get('test')).toBe('new')
    expect(init.count).toBe(1)
  })

  it('inits returns a clone of the internal map', () => {
    const init = new ActorInitializer([new TestInit('hello')])
    const map = init.inits
    expect(map.get('test')).toBe('hello')
    // Modifying the returned map should not affect the original
    map.set('test', 'modified')
    expect(init.get('test')).toBe('hello')
  })

  it('fromMap clones an existing Map', () => {
    const source = new Map<string, unknown>()
    source.set('a', 1)
    source.set('b', 2)
    const init = ActorInitializer.fromMap(source)
    expect(init.count).toBe(2)
    expect(init.get('a')).toBe(1)
    expect(init.get('b')).toBe(2)
  })

  it('fromMap creates independent copy', () => {
    const source = new Map<string, unknown>()
    source.set('a', 1)
    const init = ActorInitializer.fromMap(source)
    source.set('a', 999)
    expect(init.get('a')).toBe(1)
  })
})

describe('LocationInit', () => {
  it('has correct key and stores CPos', () => {
    const cpos = { x: 5, y: 10 } // CPos stub
    const init = new LocationInit(cpos as any)
    expect(init.key).toBe('location')
    expect(init.value).toBe(cpos)
  })
})

describe('CenterPositionInit', () => {
  it('has correct key and stores WPos', () => {
    const wpos = { x: 100, y: 200, z: 0 } // WPos stub
    const init = new CenterPositionInit(wpos as any)
    expect(init.key).toBe('centerPosition')
    expect(init.value).toBe(wpos)
  })
})

describe('FacingInit', () => {
  it('has correct key and stores WAngle', () => {
    const wangle = { angle: 128 } // WAngle stub
    const init = new FacingInit(wangle as any)
    expect(init.key).toBe('facing')
    expect(init.value).toBe(wangle)
  })
})

describe('CreationActivityDelayInit', () => {
  it('has correct key and stores number', () => {
    const init = new CreationActivityDelayInit(10)
    expect(init.key).toBe('creationActivityDelay')
    expect(init.value).toBe(10)
  })
})

describe('RallyPointInit', () => {
  it('has correct key and stores CPos array', () => {
    const path = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    const init = new RallyPointInit(path as any)
    expect(init.key).toBe('rallyPoint')
    expect(init.value).toEqual(path)
  })
})

describe('OwnerInit', () => {
  it('has correct key and stores Player', () => {
    const player = { playerName: 'test-player' }
    const init = new OwnerInit(player as any)
    expect(init.key).toBe('owner')
    expect(init.value).toBe(player)
  })
})

describe('ActorInitializer with convenience inits', () => {
  it('stores all init types in a single bag', () => {
    const cpos = { x: 5, y: 10 }
    const wpos = { x: 100, y: 200, z: 0 }
    const wangle = { angle: 128 }
    const player = { playerName: 'test' }

    const init = new ActorInitializer([
      new LocationInit(cpos as any),
      new CenterPositionInit(wpos as any),
      new FacingInit(wangle as any),
      new CreationActivityDelayInit(5),
      new RallyPointInit([cpos] as any),
      new OwnerInit(player as any),
    ])

    expect(init.count).toBe(6)
    expect(init.get('location')).toBe(cpos)
    expect(init.get('centerPosition')).toBe(wpos)
    expect(init.get('facing')).toBe(wangle)
    expect(init.get('creationActivityDelay')).toBe(5)
    expect(init.get('rallyPoint')).toEqual([cpos])
    expect(init.get('owner')).toBe(player)
  })
})
