/**
 * LongBitSet.test.ts — LongBitSet migration unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LongBitSet } from './LongBitSet'

const TYPE = 'LongBitSetTest'

describe('LongBitSet', () => {
  beforeEach(() => {
    LongBitSet.reset(TYPE)
  })

  it('constructs from string values', () => {
    const lbs = new LongBitSet(TYPE, 'a', 'b', 'c')
    expect(lbs.isEmpty).toBe(false)
    expect(lbs.contains('a')).toBe(true)
    expect(lbs.contains('b')).toBe(true)
    expect(lbs.contains('c')).toBe(true)
    expect(lbs.contains('d')).toBe(false)
  })

  it('empty set has isEmpty true', () => {
    const lbs = new LongBitSet(TYPE, 0n)
    expect(lbs.isEmpty).toBe(true)
  })

  it('fromStringsNoAlloc only uses existing bits', () => {
    void new LongBitSet(TYPE, 'a', 'b')
    const lbs = LongBitSet.fromStringsNoAlloc(TYPE, ['a', 'b', 'c'])
    expect(lbs.contains('a')).toBe(true)
    expect(lbs.contains('b')).toBe(true)
    expect(lbs.contains('c')).toBe(false)
  })

  it('reset clears all allocated bits', () => {
    new LongBitSet(TYPE, 'a', 'b')
    LongBitSet.reset(TYPE)
    // After reset, 'a' should not be recognized
    const lbs = LongBitSet.fromStringsNoAlloc(TYPE, ['a'])
    expect(lbs.contains('a')).toBe(false)
  })

  it('throws on allocating beyond 64 values', () => {
    // Allocate 64 values
    for (let i = 0; i < 64; i++) {
      new LongBitSet(TYPE, `value_${i}`)
    }
    // The 65th should throw
    expect(() => new LongBitSet(TYPE, 'overflow')).toThrow(
      /index 64/,
    )
  })

  it('supports 64 players without error', () => {
    const names = Array.from({ length: 64 }, (_, i) => `player_${i}`)
    const lbs = new LongBitSet(TYPE, ...names)
    for (const name of names) {
      expect(lbs.contains(name)).toBe(true)
    }
  })

  it('isSubsetOf', () => {
    const small = new LongBitSet(TYPE, 'a')
    const big = new LongBitSet(TYPE, 'a', 'b')
    expect(small.isSubsetOf(big)).toBe(true)
    expect(big.isSubsetOf(small)).toBe(false)
  })

  it('isProperSubsetOf', () => {
    const small = new LongBitSet(TYPE, 'a')
    const big = new LongBitSet(TYPE, 'a', 'b')
    expect(small.isProperSubsetOf(big)).toBe(true)
    expect(big.isProperSubsetOf(big)).toBe(false)
  })

  it('overlaps', () => {
    const a = new LongBitSet(TYPE, 'a', 'b')
    const b = new LongBitSet(TYPE, 'b', 'c')
    expect(a.overlaps(b)).toBe(true)

    const c = new LongBitSet(TYPE, 'c')
    expect(a.overlaps(c)).toBe(false)
  })

  it('union', () => {
    const a = new LongBitSet(TYPE, 'a')
    const b = new LongBitSet(TYPE, 'b')
    const u = a.union(b)
    expect(u.contains('a')).toBe(true)
    expect(u.contains('b')).toBe(true)
  })

  it('intersect', () => {
    const a = new LongBitSet(TYPE, 'a', 'b')
    const b = new LongBitSet(TYPE, 'b', 'c')
    const isect = a.intersect(b)
    expect(isect.contains('b')).toBe(true)
    expect(isect.contains('a')).toBe(false)
  })

  it('except', () => {
    const a = new LongBitSet(TYPE, 'a', 'b')
    const b = new LongBitSet(TYPE, 'b')
    const diff = a.except(b)
    expect(diff.contains('a')).toBe(true)
    expect(diff.contains('b')).toBe(false)
  })

  it('symmetricExcept', () => {
    const a = new LongBitSet(TYPE, 'a', 'b')
    const b = new LongBitSet(TYPE, 'b', 'c')
    const sym = a.symmetricExcept(b)
    expect(sym.contains('a')).toBe(true)
    expect(sym.contains('c')).toBe(true)
    expect(sym.contains('b')).toBe(false)
  })

  it('strings returns all contained values', () => {
    const lbs = new LongBitSet(TYPE, 'x', 'y')
    const strs = lbs.strings().sort()
    expect(strs).toEqual(['x', 'y'])
  })
})
