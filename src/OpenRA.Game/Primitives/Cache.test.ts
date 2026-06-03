/**
 * Cache.test.ts — Cache migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { Cache } from './Cache'

describe('Cache', () => {
  it('calls loader on first access', () => {
    const loader = vi.fn((k: string) => `value-${k}`)
    const cache = new Cache(loader)

    expect(cache.get('a')).toBe('value-a')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(loader).toHaveBeenCalledWith('a')
  })

  it('returns cached value on second access', () => {
    const loader = vi.fn((k: string) => `value-${k}`)
    const cache = new Cache(loader)

    cache.get('a')
    const result = cache.get('a')

    expect(result).toBe('value-a')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('has returns false for missing key', () => {
    const cache = new Cache((k: string) => k)
    expect(cache.has('missing')).toBe(false)
  })

  it('has returns true after get', () => {
    const cache = new Cache((k: string) => `value-${k}`)
    cache.get('a')
    expect(cache.has('a')).toBe(true)
  })

  it('tryGet returns undefined for missing key', () => {
    const cache = new Cache((k: string) => `value-${k}`)
    expect(cache.tryGet('missing')).toBeUndefined()
  })

  it('tryGet returns value without invoking loader', () => {
    const loader = vi.fn((k: string) => `value-${k}`)
    const cache = new Cache(loader)
    cache.get('a')
    expect(cache.tryGet('a')).toBe('value-a')
    // Loader was called once during get(), tryGet doesn't call it
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('size tracks cached entries', () => {
    const cache = new Cache((k: string) => k)
    expect(cache.size).toBe(0)
    cache.get('a')
    expect(cache.size).toBe(1)
    cache.get('b')
    expect(cache.size).toBe(2)
    cache.get('a') // duplicate
    expect(cache.size).toBe(2)
  })

  it('clear removes all entries', () => {
    const cache = new Cache((k: string) => k)
    cache.get('a')
    cache.get('b')
    expect(cache.size).toBe(2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.has('a')).toBe(false)
  })

  it('keys and values iterate cached entries', () => {
    const cache = new Cache((k: string) => `val-${k}`)
    cache.get('a')
    cache.get('b')
    const keys = Array.from(cache.keys()).sort()
    const values = Array.from(cache.values()).sort()
    expect(keys).toEqual(['a', 'b'])
    expect(values).toEqual(['val-a', 'val-b'])
  })

  it('iterator yields key-value pairs', () => {
    const cache = new Cache((k: string) => `val-${k}`)
    cache.get('x')
    const pairs = Array.from(cache)
    expect(pairs).toEqual([['x', 'val-x']])
  })

  it('factory receives the key as argument', () => {
    const seen: string[] = []
    const cache = new Cache((k: string) => {
      seen.push(k)
      return k.toUpperCase()
    })
    expect(cache.get('hello')).toBe('HELLO')
    expect(seen).toEqual(['hello'])
  })

  it('loader returning undefined does not cause re-invocation', () => {
    // Verifies fix: get() uses has() not get()===undefined to avoid
    // infinite re-invocation when the loader legitimately returns undefined.
    const loader = vi.fn((_k: string): string | undefined => undefined)
    const cache = new Cache(loader)

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('a')).toBeUndefined()
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
