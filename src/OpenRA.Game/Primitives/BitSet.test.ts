/**
 * BitSet.test.ts — BitSet migration unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BitSet } from './BitSet'

// Unique type name for each test to avoid cross-test contamination
const TYPE = 'BitSetTest'

describe('BitSet', () => {
  beforeEach(() => {
    BitSet.reset(TYPE)
  })
  it('constructs from string values', () => {
    const bs = new BitSet(TYPE, 'a', 'b', 'c')
    expect(bs.isEmpty).toBe(false)
    expect(bs.contains('a')).toBe(true)
    expect(bs.contains('b')).toBe(true)
    expect(bs.contains('c')).toBe(true)
    expect(bs.contains('d')).toBe(false)
  })

  it('empty set has isEmpty true', () => {
    const bs = new BitSet(TYPE, 0n)
    expect(bs.isEmpty).toBe(true)
  })

  it('fromStringsNoAlloc only uses existing bits', () => {
    // First allocate 'a' and 'b'
    void new BitSet(TYPE, 'a', 'b')
    // Now create with 'a', 'b', 'c' — 'c' should be omitted
    const bs = BitSet.fromStringsNoAlloc(TYPE, ['a', 'b', 'c'])
    expect(bs.contains('a')).toBe(true)
    expect(bs.contains('b')).toBe(true)
    expect(bs.contains('c')).toBe(false) // 'c' was never allocated
  })

  it('isSubsetOf', () => {
    const small = new BitSet(TYPE, 'a')
    const big = new BitSet(TYPE, 'a', 'b')
    expect(small.isSubsetOf(big)).toBe(true)
    expect(big.isSubsetOf(small)).toBe(false)
  })

  it('isProperSubsetOf', () => {
    const small = new BitSet(TYPE, 'a')
    const big = new BitSet(TYPE, 'a', 'b')
    expect(small.isProperSubsetOf(big)).toBe(true)
    expect(big.isProperSubsetOf(big)).toBe(false)
  })

  it('isSupersetOf', () => {
    const small = new BitSet(TYPE, 'a')
    const big = new BitSet(TYPE, 'a', 'b')
    expect(big.isSupersetOf(small)).toBe(true)
    expect(small.isSupersetOf(big)).toBe(false)
  })

  it('isProperSupersetOf', () => {
    const big = new BitSet(TYPE, 'a', 'b')
    const small = new BitSet(TYPE, 'a')
    expect(big.isProperSupersetOf(small)).toBe(true)
    expect(big.isProperSupersetOf(big)).toBe(false)
  })

  it('overlaps', () => {
    const a = new BitSet(TYPE, 'a', 'b')
    const b = new BitSet(TYPE, 'b', 'c')
    expect(a.overlaps(b)).toBe(true)

    const c = new BitSet(TYPE, 'c', 'd')
    expect(a.overlaps(c)).toBe(false)
  })

  it('setEquals', () => {
    const a = new BitSet(TYPE, 'a', 'b')
    const b = new BitSet(TYPE, 'a', 'b')
    expect(a.setEquals(b)).toBe(true)
  })

  it('union', () => {
    const a = new BitSet(TYPE, 'a')
    const b = new BitSet(TYPE, 'b')
    const u = a.union(b)
    expect(u.contains('a')).toBe(true)
    expect(u.contains('b')).toBe(true)
  })

  it('intersect', () => {
    const a = new BitSet(TYPE, 'a', 'b')
    const b = new BitSet(TYPE, 'b', 'c')
    const isect = a.intersect(b)
    expect(isect.contains('a')).toBe(false)
    expect(isect.contains('b')).toBe(true)
    expect(isect.contains('c')).toBe(false)
  })

  it('except', () => {
    const a = new BitSet(TYPE, 'a', 'b')
    const b = new BitSet(TYPE, 'b')
    const diff = a.except(b)
    expect(diff.contains('a')).toBe(true)
    expect(diff.contains('b')).toBe(false)
  })

  it('symmetricExcept', () => {
    const a = new BitSet(TYPE, 'a', 'b')
    const b = new BitSet(TYPE, 'b', 'c')
    const sym = a.symmetricExcept(b)
    expect(sym.contains('a')).toBe(true)
    expect(sym.contains('b')).toBe(false)
    expect(sym.contains('c')).toBe(true)
  })

  it('strings returns all contained values', () => {
    const bs = new BitSet(TYPE, 'x', 'y', 'z')
    const strs = bs.strings().sort()
    expect(strs).toEqual(['x', 'y', 'z'])
  })

  it('equals checks bit equality', () => {
    const a = new BitSet(TYPE, 'a', 'b')
    const b = new BitSet(TYPE, 'a', 'b')
    expect(a.equals(b)).toBe(true)
    expect(a.equals(a.except(b))).toBe(false)
  })

  it('toString joins strings', () => {
    const bs = new BitSet(TYPE, 'x', 'y')
    const str = bs.toString()
    expect(str).toContain('x')
    expect(str).toContain('y')
  })
})
