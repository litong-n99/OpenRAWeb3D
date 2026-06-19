/**
 * StorageManager.test.ts — Unit tests for StorageManager
 *
 * Mocks navigator.storage and IndexedDB to test:
 * - getQuota() with storage estimate API
 * - getQuota() fallback when API unavailable
 * - hasSpaceFor() with sufficient space
 * - hasSpaceFor() with insufficient space
 * - formatBytes() for all ranges
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StorageManager } from './StorageManager.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageManager', () => {
  beforeEach(() => {
    // Mock navigator.storage.estimate
    const storageEstimate = vi.fn().mockResolvedValue({
      usage: 500 * 1024 * 1024, // 500 MB
      quota: 2 * 1024 * 1024 * 1024, // 2 GB
    })

    vi.stubGlobal('navigator', {
      storage: {
        estimate: storageEstimate,
      },
      onLine: true,
    })

    // Mock IndexedDB with empty store
    const store = new Map<string, any>()
    ;(globalThis as any).indexedDB = {
      open: vi.fn((_name: string, _version?: number) => {
        const request: any = {
          result: {
            objectStoreNames: {
              contains: vi.fn(() => false),
            },
            createObjectStore: vi.fn(),
            transaction: vi.fn((_storeName: string, _mode: string) => ({
              objectStore: vi.fn(() => ({
                getAll: vi.fn(() => ({
                  result: Array.from(store.values()),
                  set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                  set onerror(_cb: any) {},
                })),
              })),
            })),
            close: vi.fn(),
          },
          set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
          set onerror(_cb: any) {},
          set onblocked(_cb: any) {},
        }
        return request
      }),
      deleteDatabase: vi.fn(),
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // getQuota
  // -------------------------------------------------------------------------

  describe('getQuota()', () => {
    it('returns quota info from navigator.storage.estimate', async () => {
      const result = await StorageManager.getQuota()
      expect(result.usage).toBe(500 * 1024 * 1024)
      expect(result.quota).toBe(2 * 1024 * 1024 * 1024)
      expect(result.percentage).toBeGreaterThanOrEqual(24)
      expect(result.percentage).toBeLessThanOrEqual(25)
    })

    it('returns default values when estimate API is unavailable', async () => {
      ;(navigator as any).storage = undefined
      const result = await StorageManager.getQuota()
      expect(result.usage).toBe(0)
      expect(result.quota).toBe(Infinity)
      expect(result.percentage).toBe(0)
    })

    it('handles estimate throwing an error', async () => {
      ;(navigator as any).storage = {
        estimate: vi.fn().mockRejectedValue(new Error('Not available')),
      }
      const result = await StorageManager.getQuota()
      expect(result.usage).toBe(0)
      expect(result.quota).toBe(Infinity)
    })
  })

  // -------------------------------------------------------------------------
  // hasSpaceFor
  // -------------------------------------------------------------------------

  describe('hasSpaceFor()', () => {
    it('returns hasSpace=true when quota is infinite', async () => {
      ;(navigator as any).storage = undefined
      const result = await StorageManager.hasSpaceFor(10 * 1024 * 1024 * 1024) // 10 GB
      expect(result.hasSpace).toBe(true)
      expect(result.shortage).toBe(0)
    })

    it('returns hasSpace=true when projected usage fits with 20% margin', async () => {
      // Current: 500MB, Quota: 2GB, maxAllowed: 2GB * 0.8 = 1.6GB
      // Download: 200MB → 500 + 200 = 700 < 1600 → OK
      const result = await StorageManager.hasSpaceFor(200 * 1024 * 1024)
      expect(result.hasSpace).toBe(true)
      expect(result.shortage).toBe(0)
    })

    it('returns hasSpace=false when projected usage exceeds margin', async () => {
      // Current: 500MB, Quota: 2GB, maxAllowed: 1.6GB
      // Download: 1.5GB → 500 + 1500 = 2000 > 1600 → fail
      const result = await StorageManager.hasSpaceFor(1500 * 1024 * 1024)
      expect(result.hasSpace).toBe(false)
      expect(result.shortage).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // formatBytes
  // -------------------------------------------------------------------------

  describe('formatBytes()', () => {
    it('formats 0 as "0 B"', () => {
      expect(StorageManager.formatBytes(0)).toBe('0 B')
    })

    it('formats bytes < 1024', () => {
      expect(StorageManager.formatBytes(500)).toBe('500 B')
    })

    it('formats KB', () => {
      expect(StorageManager.formatBytes(1536)).toBe('1.5 KB')
    })

    it('formats MB', () => {
      expect(StorageManager.formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    })

    it('formats GB', () => {
      expect(StorageManager.formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB')
    })
  })
})
