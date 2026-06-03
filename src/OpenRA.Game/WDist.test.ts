/**
 * WDist.test.ts — WDist migration unit tests
 *
 * Tests focus on: arithmetic operations, comparison, tryParse, formatting.
 */

import { describe, it, expect } from 'vitest'
import { WDist } from './WDist'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('WDist construction', () => {
  it('stores length value', () => {
    expect(new WDist(100).length).toBe(100)
    expect(new WDist(0).length).toBe(0)
    expect(new WDist(-100).length).toBe(-100)
  })

  it('truncates to int32', () => {
    expect(new WDist(3.7).length).toBe(3)
    expect(new WDist(-2.3).length).toBe(-2)
  })

  it('has Zero and MaxValue constants', () => {
    expect(WDist.Zero.length).toBe(0)
    expect(WDist.MaxValue.length).toBe(2147483647)
  })
})

// ---------------------------------------------------------------------------
// Factory methods
// ---------------------------------------------------------------------------

describe('WDist.fromCells', () => {
  it('converts cells to distance units (1024 per cell)', () => {
    expect(WDist.fromCells(0).length).toBe(0)
    expect(WDist.fromCells(1).length).toBe(1024)
    expect(WDist.fromCells(5).length).toBe(5120)
    expect(WDist.fromCells(-2).length).toBe(-2048)
  })
})

describe('WDist.tryParse', () => {
  it('parses "XcY" format correctly', () => {
    const result = WDist.tryParse('5c512')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(5 * 1024 + 512)
  })

  it('parses "0c256" format', () => {
    const result = WDist.tryParse('0c256')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(256)
  })

  it('parses simple integer (no cell component)', () => {
    const result = WDist.tryParse('512')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(512)
  })

  it('parses "3" as subcell only', () => {
    const result = WDist.tryParse('3')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(3)
  })

  it('handles negative cell values (propagates sign)', () => {
    const result = WDist.tryParse('-1c512')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(-1024 - 512) // -1536
  })

  it('returns null for empty string', () => {
    expect(WDist.tryParse('')).toBeNull()
  })

  it('returns null for invalid format', () => {
    expect(WDist.tryParse('abc')).toBeNull()
    expect(WDist.tryParse('1c2c3')).toBeNull()
  })

  it('is case insensitive', () => {
    const result = WDist.tryParse('5C512')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(5 * 1024 + 512)
  })
})

// ---------------------------------------------------------------------------
// Derived properties
// ---------------------------------------------------------------------------

describe('WDist.lengthSquared', () => {
  it('returns square of length', () => {
    expect(new WDist(10).lengthSquared).toBe(100)
    expect(new WDist(-10).lengthSquared).toBe(100)
    expect(new WDist(0).lengthSquared).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Arithmetic operators
// ---------------------------------------------------------------------------

describe('WDist arithmetic', () => {
  it('add combines distances', () => {
    const result = WDist.add(new WDist(100), new WDist(200))
    expect(result.length).toBe(300)
  })

  it('subtract finds difference', () => {
    const result = WDist.subtract(new WDist(500), new WDist(200))
    expect(result.length).toBe(300)
  })

  it('negate inverts sign', () => {
    expect(WDist.negate(new WDist(100)).length).toBe(-100)
    expect(WDist.negate(new WDist(-100)).length).toBe(100)
    expect(WDist.negate(new WDist(0)).length).toBe(0)
  })

  it('multiply scales by factor', () => {
    expect(WDist.multiply(new WDist(100), 3).length).toBe(300)
    expect(WDist.multiply(new WDist(100), -2).length).toBe(-200)
  })

  it('multiplyScalar reverses argument order', () => {
    expect(WDist.multiplyScalar(3, new WDist(100)).length).toBe(300)
  })

  it('divide scales down', () => {
    expect(WDist.divide(new WDist(300), 3).length).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Comparison operators
// ---------------------------------------------------------------------------

describe('WDist comparison', () => {
  it('lessThan works correctly', () => {
    expect(WDist.lessThan(new WDist(100), new WDist(200))).toBe(true)
    expect(WDist.lessThan(new WDist(200), new WDist(100))).toBe(false)
    expect(WDist.lessThan(new WDist(100), new WDist(100))).toBe(false)
  })

  it('greaterThan works correctly', () => {
    expect(WDist.greaterThan(new WDist(200), new WDist(100))).toBe(true)
    expect(WDist.greaterThan(new WDist(100), new WDist(200))).toBe(false)
  })

  it('lessThanOrEqual works correctly', () => {
    expect(WDist.lessThanOrEqual(new WDist(100), new WDist(200))).toBe(true)
    expect(WDist.lessThanOrEqual(new WDist(100), new WDist(100))).toBe(true)
    expect(WDist.lessThanOrEqual(new WDist(200), new WDist(100))).toBe(false)
  })

  it('greaterThanOrEqual works correctly', () => {
    expect(WDist.greaterThanOrEqual(new WDist(200), new WDist(100))).toBe(true)
    expect(WDist.greaterThanOrEqual(new WDist(100), new WDist(100))).toBe(true)
    expect(WDist.greaterThanOrEqual(new WDist(100), new WDist(200))).toBe(false)
  })

  it('equals checks length equality', () => {
    expect(WDist.equals(new WDist(100), new WDist(100))).toBe(true)
    expect(WDist.equals(new WDist(100), new WDist(200))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// compareTo
// ---------------------------------------------------------------------------

describe('WDist.compareTo', () => {
  it('returns negative when this < other', () => {
    expect(new WDist(100).compareTo(new WDist(200))).toBeLessThan(0)
  })

  it('returns zero when equal', () => {
    expect(new WDist(100).compareTo(new WDist(100))).toBe(0)
  })

  it('returns positive when this > other', () => {
    expect(new WDist(200).compareTo(new WDist(100))).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('WDist standard methods', () => {
  it('equals checks length equality', () => {
    expect(new WDist(100).equals(new WDist(100))).toBe(true)
    expect(new WDist(100).equals(new WDist(200))).toBe(false)
  })

  it('toString formats as "XcY"', () => {
    expect(new WDist(0).toString()).toBe('0c0')
    expect(new WDist(1024).toString()).toBe('1c0')
    expect(new WDist(5120).toString()).toBe('5c0')
    expect(new WDist(5120 + 512).toString()).toBe('5c512')
    expect(new WDist(256).toString()).toBe('0c256')
  })

  it('toString handles negative values', () => {
    expect(new WDist(-1024).toString()).toBe('-1c0')
    expect(new WDist(-256).toString()).toBe('-0c256')
  })
})
