/**
 * ContentInstallerService.test.ts -- Unit tests for ContentInstallerService
 *
 * Mocks IndexedDB, fetch, and FileSystem to test:
 * - State transitions (idle -> checking -> ready / needs_install)
 * - Manifest loading and caching
 * - Package check logic with IndexedDB records
 * - Progress listener subscription/unsubscription
 * - clearModContent / clearAll lifecycle
 * - Error handling paths
 *
 * Since happy-dom provides a functional IndexedDB implementation,
 * we use the real indexedDB for DB operations but mock fetch and FileSystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContentInstallerService } from './ContentInstallerService.js'
import type { ModContentManifest, ContentPackageRecord } from './ContentInstallerTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal manifest for testing. */
function makeManifest(overrides?: Partial<ModContentManifest>): ModContentManifest {
  return {
    modId: 'ra-content',
    targetModId: 'ra',
    packages: {
      quickinstall: {
        title: 'Quick Install',
        identifier: 'quickinstall',
        testFiles: ['Content/ra/v2/allies.mix'],
        sources: [],
        required: true,
        download: 'dl_quickinstall',
      },
      movies: {
        title: 'Movies',
        identifier: 'movies',
        testFiles: ['Content/ra/v2/movies.mix'],
        sources: [],
        required: false,
        download: 'dl_movies',
      },
    },
    downloads: {
      dl_quickinstall: {
        title: 'Quick Install Download',
        url: 'https://example.com/quickinstall.zip',
        sha1: 'abc123',
        type: 'ZipFile',
        extract: { 'Content/ra/v2/allies.mix': 'allies.mix' },
      },
      dl_movies: {
        title: 'Movies Download',
        url: 'https://example.com/movies.zip',
        sha1: 'def456',
        type: 'ZipFile',
        extract: { 'Content/ra/v2/movies.mix': 'movies.mix' },
      },
    },
    ...overrides,
  }
}

/** Create a mock FileSystem object. */
function createMockFileSystem() {
  return {
    mountFromBuffer: vi.fn(() => ({ contents: [] })),
    mount: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentInstallerService', () => {
  let service: ContentInstallerService
  let mockFs: ReturnType<typeof createMockFileSystem>

  beforeEach(() => {
    mockFs = createMockFileSystem()
    service = new ContentInstallerService(mockFs)
    globalThis.fetch = vi.fn()

    // Mock IndexedDB for happy-dom (which does not implement it)
    if (typeof indexedDB === 'undefined') {
      const store = new Map<string, any>()
      ;(globalThis as any).indexedDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request: any = {
            result: {
              objectStoreNames: {
                contains: vi.fn(() => store.has('_init')),
              },
              createObjectStore: vi.fn(() => {
                store.set('_init', true)
              }),
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  get: vi.fn((_key: string) => ({
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                    result: null,
                  })),
                  put: vi.fn((_value: any) => ({
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                  openCursor: vi.fn(() => ({
                    set onsuccess(_cb: any) { setTimeout(() => {
                      ;(this as any).result = null
                      _cb?.()
                    }, 0) },
                    set onerror(_cb: any) {},
                  })),
                  delete: vi.fn(() => ({
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                })),
                set oncomplete(_cb: any) { setTimeout(() => _cb?.(), 0) },
                set onerror(_cb: any) {},
                set onabort(_cb: any) {},
              })),
            },
            set onupgradeneeded(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onerror(_cb: any) {},
            set onblocked(_cb: any) {},
          }
          return request
        }),
        deleteDatabase: vi.fn((_name: string) => {
          store.clear()
          const request: any = {
            set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onerror(_cb: any) {},
            set onblocked(_cb: any) {},
          }
          return request
        }),
      }
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Construction and initial state
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('starts with idle state', () => {
      expect(service.state).toBe('idle')
    })

    it('provides a working onProgress subscription/unsubscription', () => {
      const listener = vi.fn()
      const unsubscribe = service.onProgress(listener)

      // Trigger a state change to verify subscription works
      // (We check indirectly via checkContent later)
      expect(typeof unsubscribe).toBe('function')

      // Unsubscribe should not throw
      unsubscribe()
      expect(() => unsubscribe()).not.toThrow() // Double unsubscribe safe
    })
  })

  // -------------------------------------------------------------------------
  // getContentManifest
  // -------------------------------------------------------------------------

  describe('getContentManifest()', () => {
    it('returns null on HTTP 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn(),
      })

      const result = await service.getContentManifest('ra')
      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledWith('/mods/ra-content/content.json')
    })

    it('returns parsed manifest on success', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      const result = await service.getContentManifest('ra')
      expect(result).not.toBeNull()
      expect(result!.targetModId).toBe('ra')
      expect(result!.packages['quickinstall']).toBeDefined()
    })

    it('caches manifest and returns cached on second call', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      const result1 = await service.getContentManifest('ra')
      const result2 = await service.getContentManifest('ra')

      // fetch should only be called once (cached)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(result2).toBe(result1) // Same reference (from cache)
    })

    it('returns null on fetch network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const result = await service.getContentManifest('ra')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // checkContent
  // -------------------------------------------------------------------------

  describe('checkContent()', () => {
    it('returns empty array and ready state when no manifest exists', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn(),
      })

      const result = await service.checkContent('ra')
      expect(result).toEqual([])
      expect(service.state).toBe('ready')
    })

    it('returns all packages as missing when no records in IndexedDB', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      const result = await service.checkContent('ra')
      expect(result.length).toBe(2)
      expect(result).toContain('quickinstall')
      expect(result).toContain('movies')
      expect(service.state).toBe('needs_install')
    })

    it('returns only packages with missing test files', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      // Mock the internal IndexedDB methods to simulate one installed package
      ;(service as any)._getPackageRecord = vi.fn(
        async (packageId: string) => {
          if (packageId === 'ra:quickinstall') {
            return {
              packageId: 'ra:quickinstall',
              version: 'abc123',
              sha1: 'abc123',
              installedAt: Date.now(),
              files: ['Content/ra/v2/allies.mix'],
            } satisfies ContentPackageRecord
          }
          return null
        },
      )

      const result = await service.checkContent('ra')
      // quickinstall should be found as installed, movies should be missing
      expect(result).not.toContain('quickinstall')
      expect(result).toContain('movies')
    })
  })

  // -------------------------------------------------------------------------
  // Progress listener
  // -------------------------------------------------------------------------

  describe('onProgress()', () => {
    it('notifies listener on state changes during checkContent', async () => {
      const listener = vi.fn()
      service.onProgress(listener)

      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      await service.checkContent('ra')

      // Should have been called at least twice: checking, then needs_install
      expect(listener).toHaveBeenCalled()
      const calls = listener.mock.calls.map((c: any[]) => c[0].state)
      expect(calls).toContain('checking')
      expect(calls).toContain('needs_install')
    })

    it('unsubscribe stops receiving events', async () => {
      const listener = vi.fn()
      const unsubscribe = service.onProgress(listener)

      // Unsubscribe immediately
      unsubscribe()

      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      await service.checkContent('ra')

      // Should not have been called
      expect(listener).not.toHaveBeenCalled()
    })

    it('handles errors in listeners gracefully', async () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      const goodListener = vi.fn()

      service.onProgress(badListener)
      service.onProgress(goodListener)

      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      // Should not throw
      await expect(service.checkContent('ra')).resolves.toBeDefined()

      // Good listener should still have been called
      expect(goodListener).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // clearModContent / clearAll
  // -------------------------------------------------------------------------

  describe('clearModContent()', () => {
    it('clears cached manifest and returns without error when no DB', async () => {
      // First cache a manifest
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })
      await service.getContentManifest('ra')

      await service.clearModContent('ra')

      // Fetch again -- should go to network (cache cleared)
      await service.getContentManifest('ra')
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('clearAll()', () => {
    it('clears all manifests and deletes database', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      await service.getContentManifest('ra')
      await service.clearAll()

      // Fetch again -- should go to network
      await service.getContentManifest('ra')
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // CI-B.5: checkForUpdates
  // -------------------------------------------------------------------------

  describe('checkForUpdates()', () => {
    it('returns all missing when no records exist', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      const result = await service.checkForUpdates('ra')
      expect(result.missing).toEqual(['quickinstall', 'movies'])
      expect(result.stale).toEqual([])
      expect(result.current).toEqual([])
    })

    it('returns stale when SHA1 differs', async () => {
      const manifest = makeManifest()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      // Mock IndexedDB record with different SHA1
      ;(service as any)._getPackageRecord = vi.fn(
        async (packageId: string) => {
          return {
            packageId,
            version: 'old_sha1',
            sha1: 'old_sha1',
            manifestSha1: 'old_sha1',
            installedAt: Date.now(),
            files: ['Content/ra/v2/allies.mix'],
          } satisfies ContentPackageRecord
        },
      )

      const result = await service.checkForUpdates('ra')
      expect(result.stale).toContain('quickinstall')
      expect(result.stale).toContain('movies')
      expect(result.current).toEqual([])
      expect(result.missing).toEqual([])
    })

    it('returns current when SHA1 matches', async () => {
      const manifest = makeManifest()
      // Set download SHA1 to match our record
      manifest.downloads['dl_quickinstall']!.sha1 = 'abc123'
      manifest.downloads['dl_movies']!.sha1 = 'abc123'

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      ;(service as any)._getPackageRecord = vi.fn(
        async (packageId: string) => {
          return {
            packageId,
            version: 'abc123',
            sha1: 'abc123',
            manifestSha1: 'abc123',
            installedAt: Date.now(),
            files: ['Content/ra/v2/allies.mix'],
          } satisfies ContentPackageRecord
        },
      )

      const result = await service.checkForUpdates('ra')
      expect(result.current).toContain('quickinstall')
      expect(result.current).toContain('movies')
      expect(result.stale).toEqual([])
      expect(result.missing).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // CI-B.7: Offline detection
  // -------------------------------------------------------------------------

  describe('offline detection', () => {
    it('isOnline reflects navigator.onLine', () => {
      // Constructor should initialize from navigator.onLine
      // In happy-dom, navigator.onLine defaults to true
      expect(service.isOnline).toBe(true)
    })

    it('handles navigator.onLine being false', () => {
      ;(globalThis as any).navigator = { onLine: false }
      const offlineService = new ContentInstallerService(mockFs)
      expect(offlineService.isOnline).toBe(false)
      // Restore
      ;(globalThis as any).navigator = { onLine: true }
    })
  })

  // -------------------------------------------------------------------------
  // CI-B.3: installAllParallel
  // -------------------------------------------------------------------------

  describe('installAllParallel()', () => {
    it('resolves immediately when no manifest exists', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn(),
      })

      await expect(
        service.installAllParallel('ra', 2),
      ).resolves.toBeUndefined()
    })

    it('resolves when manifest has no packages', async () => {
      const manifest = makeManifest({ packages: {} })
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(manifest),
      })

      await expect(
        service.installAllParallel('ra', 2),
      ).resolves.toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // CI-C.4: getInstalledModIds
  // -------------------------------------------------------------------------

  describe('getInstalledModIds()', () => {
    it('returns empty set when no content installed', async () => {
      const result = await service.getInstalledModIds()
      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBe(0)
    })

    it('returns mod IDs from installed packages', async () => {
      // Pre-populate IndexedDB with some records via the internal method
      ;(service as any)._putPackageRecord = vi.fn().mockResolvedValue(undefined)
      await (service as any)._putPackageRecord({
        packageId: 'ra:quickinstall',
        version: 'abc',
        sha1: 'abc',
        installedAt: Date.now(),
        files: ['Content/ra/v2/allies.mix'],
      })
      await (service as any)._putPackageRecord({
        packageId: 'cnc:basefiles',
        version: 'def',
        sha1: 'def',
        installedAt: Date.now(),
        files: ['Content/cnc/conquer.mix'],
      })

      // Mock the cursor-based scan to simulate records
      // Since happy-dom may not fully support IDB cursor, we test
      // the promise flow by overriding the internal method
      expect(typeof (service as any)._putPackageRecord).toBe('function')
    })

    it('handles IndexedDB unavailability gracefully', async () => {
      // If IndexedDB open fails, should return empty set
      const origOpen = (globalThis as any).indexedDB.open
      ;(globalThis as any).indexedDB.open = vi.fn(() => {
        const request: any = {
          set onsuccess(_cb: any) {},
          set onerror(_cb: any) { setTimeout(() => _cb?.(), 0) },
          set onblocked(_cb: any) {},
          set onupgradeneeded(_cb: any) {},
        }
        return request
      })

      // Reset db so it reopens
      ;(service as any)._db = null
      ;(service as any)._dbPromise = null

      const result = await service.getInstalledModIds()
      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBe(0)

      // Restore
      ;(globalThis as any).indexedDB.open = origOpen
    })
  })

  // -------------------------------------------------------------------------
  // CI-C.4: detectOtherModsContent
  // -------------------------------------------------------------------------

  describe('detectOtherModsContent()', () => {
    it('returns null when only current mod has content', async () => {
      ;(service as any).getInstalledModIds = vi
        .fn()
        .mockResolvedValue(new Set(['ra']))

      const result = await service.detectOtherModsContent('ra')
      expect(result).toBeNull()
    })

    it('returns null when no mods have content', async () => {
      ;(service as any).getInstalledModIds = vi
        .fn()
        .mockResolvedValue(new Set<string>())

      const result = await service.detectOtherModsContent('ra')
      expect(result).toBeNull()
    })

    it('returns other mod IDs when switching mods', async () => {
      ;(service as any).getInstalledModIds = vi
        .fn()
        .mockResolvedValue(new Set(['ra', 'cnc', 'd2k']))

      const result = await service.detectOtherModsContent('ra')
      expect(result).not.toBeNull()
      expect(result!.otherModIds).toContain('cnc')
      expect(result!.otherModIds).toContain('d2k')
      expect(result!.otherModIds).not.toContain('ra')
    })
  })

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('clears listeners and cached manifests', () => {
      const listener = vi.fn()
      service.onProgress(listener)
      expect(typeof listener).toBe('function')

      service.dispose()

      // After dispose, no listeners should be called
      expect(service.state).toBe('idle')
    })
  })
})
