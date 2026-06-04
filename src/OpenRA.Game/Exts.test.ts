/**
 * Exts.test.ts — Exts utility functions unit tests
 */

import { describe, it, expect } from 'vitest'
import { isqrt, isqrtCeiling } from './Exts'

describe('isqrt', () => {
  it('isqrt(0) = 0', () => {
    expect(isqrt(0)).toBe(0)
  })

  it('isqrt(1) = 1', () => {
    expect(isqrt(1)).toBe(1)
  })

  it('isqrt(4) = 2', () => {
    expect(isqrt(4)).toBe(2)
  })

  it('isqrt(9) = 3', () => {
    expect(isqrt(9)).toBe(3)
  })

  it('isqrt(100) = 10', () => {
    expect(isqrt(100)).toBe(10)
  })

  it('isqrt(2) = 1 (floor)', () => {
    expect(isqrt(2)).toBe(1)
  })

  it('isqrt(3) = 1 (floor)', () => {
    expect(isqrt(3)).toBe(1)
  })

  it('isqrt(1024*1024) = 1024', () => {
    expect(isqrt(1024 * 1024)).toBe(1024)
  })

  it('throws for negative input', () => {
    expect(() => isqrt(-1)).toThrow()
  })

  it('handles large numbers', () => {
    // sqrt of 2^31 - 1
    const result = isqrt(2147483647)
    expect(result).toBe(46340) // floor(sqrt(2147483647)) = 46340
  })
})

// ---------------------------------------------------------------------------
// isqrtCeiling
// ---------------------------------------------------------------------------

describe('isqrtCeiling', () => {
  it('isqrtCeiling(0) = 0', () => {
    expect(isqrtCeiling(0)).toBe(0)
  })

  it('isqrtCeiling(1) = 1', () => {
    expect(isqrtCeiling(1)).toBe(1)
  })

  it('isqrtCeiling(4) = 2', () => {
    expect(isqrtCeiling(4)).toBe(2)
  })

  it('isqrtCeiling(2) = 2 (ceiling)', () => {
    expect(isqrtCeiling(2)).toBe(2)
  })

  it('isqrtCeiling(3) = 2 (ceiling)', () => {
    expect(isqrtCeiling(3)).toBe(2)
  })

  it('isqrtCeiling(5) = 3 (ceiling)', () => {
    expect(isqrtCeiling(5)).toBe(3)
  })

  it('isqrtCeiling of perfect square = floor', () => {
    expect(isqrtCeiling(100)).toBe(10)
    expect(isqrtCeiling(1024 * 1024)).toBe(1024)
  })

  it('throws for negative input', () => {
    expect(() => isqrtCeiling(-1)).toThrow()
  })
})
