/**
 * CachedTransform.test.ts — CachedTransform migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { CachedTransform } from './CachedTransform'

describe('CachedTransform', () => {
  it('calls transform on first update', () => {
    const fn = vi.fn((x: number) => x * 2)
    const ct = new CachedTransform(fn)

    expect(ct.update(5)).toBe(10)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns cached result on same input', () => {
    const fn = vi.fn((x: number) => x * 2)
    const ct = new CachedTransform(fn)

    expect(ct.update(5)).toBe(10)
    expect(ct.update(5)).toBe(10)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recomputes on different input', () => {
    const fn = vi.fn((x: number) => x * 2)
    const ct = new CachedTransform(fn)

    expect(ct.update(5)).toBe(10)
    expect(ct.update(7)).toBe(14)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('caches null/undefined inputs correctly', () => {
    const fn = vi.fn((x: string | null) => (x ? x.toUpperCase() : 'NONE'))
    const ct = new CachedTransform(fn)

    expect(ct.update(null)).toBe('NONE')
    expect(ct.update(null)).toBe('NONE')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns to cached value after reverting input', () => {
    const fn = vi.fn((x: number) => x * 3)
    const ct = new CachedTransform(fn)

    expect(ct.update(5)).toBe(15)
    expect(ct.update(7)).toBe(21)
    expect(ct.update(5)).toBe(15)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
