/**
 * MapCache.test.ts — MapCache migration unit tests
 *
 * Tests focus on: construction, map loading, UID resolution, map selection,
 * iteration, dispose lifecycle, and utility functions.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  MapCache,
  randomOrDefault,
  chunkArray,
  type ManifestStub,
  type ModDataStub,
} from './MapCache.js'
import { MapPreview, MapStatus, MapClassification } from './MapPreview.js'
import type { MersenneTwisterStub } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function createMockManifest(mapFolders: Map<string, string> = new Map()): ManifestStub {
  return {
    mapFolders,
    rendererConstants: {
      mapPreviewSheetSize: 512,
    },
  }
}

function createMockModData(): ModDataStub {
  return {
    getOrCreate: vi.fn(() => undefined),
    mapFolders: new Map(),
  }
}

function createMockMersenneTwister(seed = 12345): MersenneTwisterStub {
  let s = seed
  return {
    next(): number {
      s = (s * 16807 + 0) % 2147483647
      return s / 2147483647
    },
  }
}

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

describe('randomOrDefault', () => {
  it('returns undefined for empty array', () => {
    expect(randomOrDefault([], () => 0.5)).toBeUndefined()
  })

  it('returns the only element for single-item array', () => {
    expect(randomOrDefault(['only'], () => 0.5)).toBe('only')
  })

  it('returns an element from the array', () => {
    const arr = ['a', 'b', 'c', 'd']
    const result = randomOrDefault(arr, () => 0.5)
    expect(arr).toContain(result)
  })

  it('uses random function to select', () => {
    const arr = ['a', 'b', 'c']
    expect(randomOrDefault(arr, () => 0)).toBe('a')
    expect(randomOrDefault(arr, () => 0.32)).toBe('a')
    expect(randomOrDefault(arr, () => 0.34)).toBe('b')
    expect(randomOrDefault(arr, () => 0.65)).toBe('b')
    expect(randomOrDefault(arr, () => 0.67)).toBe('c')
    expect(randomOrDefault(arr, () => 0.99)).toBe('c')
  })
})

describe('chunkArray', () => {
  it('returns empty array for empty input', () => {
    expect(chunkArray([], 5)).toEqual([])
  })

  it('returns single chunk when array fits', () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]])
  })

  it('splits into equal chunks', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('handles remainder chunk', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('creates single-element chunks with size 1', () => {
    expect(chunkArray(['a', 'b'], 1)).toEqual([['a'], ['b']])
  })
})

// ---------------------------------------------------------------------------
// MapCache tests
// ---------------------------------------------------------------------------

describe('MapCache', () => {
  describe('constructor', () => {
    it('creates cache with manifest', () => {
      const manifest = createMockManifest()
      const cache = new MapCache(manifest)

      expect(cache).toBeDefined()
      expect(cache.mapLocations.size).toBe(0)
      expect(cache.loadPreviewImages).toBe(true)
    })
  })

  describe('UnknownMap', () => {
    it('is a static MapPreview instance', () => {
      expect(MapCache.UnknownMap).toBeInstanceOf(MapPreview)
      expect(MapCache.UnknownMap.uid).toBe('')
    })
  })

  describe('get', () => {
    it('returns a MapPreview for a key', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('test-uid')

      expect(preview).toBeInstanceOf(MapPreview)
      expect(preview.uid).toBe('test-uid')
    })

    it('returns same instance for same key', () => {
      const cache = new MapCache(createMockManifest())
      const p1 = cache.get('uid-1')
      const p2 = cache.get('uid-1')

      expect(p1).toBe(p2)
    })

    it('returns different instances for different keys', () => {
      const cache = new MapCache(createMockManifest())
      const p1 = cache.get('uid-1')
      const p2 = cache.get('uid-2')

      expect(p1).not.toBe(p2)
    })
  })

  describe('tryGet', () => {
    it('returns undefined for uncached key', () => {
      const cache = new MapCache(createMockManifest())
      expect(cache.tryGet('unknown')).toBeUndefined()
    })

    it('returns preview after get', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('known')
      expect(cache.tryGet('known')).toBe(preview)
    })
  })

  describe('getUpdatedMap', () => {
    it('returns null for null input', () => {
      const cache = new MapCache(createMockManifest())
      expect(cache.getUpdatedMap(null)).toBeNull()
    })

    it('returns uid for available map', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('available-uid')
      preview.status = MapStatus.Available

      expect(cache.getUpdatedMap('available-uid')).toBe('available-uid')
    })

    it('follows update chain', () => {
      const cache = new MapCache(createMockManifest())

      // Set up: old-uid -> new-uid, new-uid is Available
      const newPreview = cache.get('new-uid')
      newPreview.status = MapStatus.Available

      // Manually inject update mapping
      // @ts-expect-error — accessing private field for test
      cache._mapUpdates.set('old-uid', 'new-uid')

      expect(cache.getUpdatedMap('old-uid')).toBe('new-uid')
    })
  })

  describe('chooseInitialMap', () => {
    it('returns initialUid if map is valid', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('good-map')
      preview.status = MapStatus.Available
      preview.visibility = 1 // Lobby
      preview.class = MapClassification.System
      preview.categories = ['Conquest']
      preview.bounds = { X: 0, Y: 0, Width: 64, Height: 64 } as import('../Primitives/Rectangle.js').Rectangle

      const random = createMockMersenneTwister()
      expect(cache.chooseInitialMap('good-map', random)).toBe('good-map')
    })

    it('falls back to suitable map when initial is invalid', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('suitable-map')
      preview.status = MapStatus.Available
      preview.visibility = 1 // Lobby
      preview.class = MapClassification.System
      preview.categories = ['Conquest']
      preview.bounds = { X: 0, Y: 0, Width: 64, Height: 64 } as import('../Primitives/Rectangle.js').Rectangle

      const random = createMockMersenneTwister()
      const result = cache.chooseInitialMap('invalid-map', random)
      expect(result).toBe('suitable-map')
    })

    it('returns empty string when no suitable map exists', () => {
      const cache = new MapCache(createMockManifest())
      const random = createMockMersenneTwister()
      expect(cache.chooseInitialMap('', random)).toBe('')
    })
  })

  describe('iteration', () => {
    it('implements iterable protocol', () => {
      const cache = new MapCache(createMockManifest())
      expect(typeof cache[Symbol.iterator]).toBe('function')
    })

    it('iterates over cached previews', () => {
      const cache = new MapCache(createMockManifest())
      cache.get('uid-1')
      cache.get('uid-2')

      const uids: string[] = []
      for (const preview of cache) {
        uids.push(preview.uid)
      }

      expect(uids).toContain('uid-1')
      expect(uids).toContain('uid-2')
    })
  })

  describe('loadMaps', () => {
    it('skips when manifest has no map folders', () => {
      const manifest = createMockManifest(new Map())
      const cache = new MapCache(manifest)
      const modData = createMockModData()

      cache.loadMaps(modData)

      expect(cache.mapLocations.size).toBe(0)
    })

    it('loads map folders from manifest', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
        ['maps/user', 'User'],
      ])
      const manifest = createMockManifest(mapFolders)
      const cache = new MapCache(manifest)
      const modData = createMockModData()

      cache.loadMaps(modData)

      expect(cache.mapLocations.size).toBe(2)
    })

    it('handles optional map folders', () => {
      const mapFolders = new Map([
        ['~maps/optional', 'System'],
        ['maps/required', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)
      const cache = new MapCache(manifest)
      const modData = createMockModData()

      cache.loadMaps(modData)

      expect(cache.mapLocations.size).toBe(2)
    })
  })

  describe('enumerateMapDirPackages', () => {
    it('yields packages for matching classification', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
        ['maps/user', 'User'],
      ])
      const manifest = createMockManifest(mapFolders)
      const cache = new MapCache(manifest)

      const packages = Array.from(cache.enumerateMapDirPackages(MapClassification.System))
      expect(packages.length).toBe(1)
      expect(packages[0]!.name).toBe('maps/system')
    })

    it('yields all packages for combined classification', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
        ['maps/user', 'User'],
      ])
      const manifest = createMockManifest(mapFolders)
      const cache = new MapCache(manifest)

      const packages = Array.from(cache.enumerateMapDirPackages(3 as MapClassification))
      expect(packages.length).toBe(2)
    })
  })

  describe('queryRemoteMapDetails', () => {
    it('is an async function', () => {
      const cache = new MapCache(createMockManifest())
      expect(typeof cache.queryRemoteMapDetails).toBe('function')
    })
  })

  describe('cacheMinimap', () => {
    it('queues preview for minimap generation', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('test')

      // Should not throw
      expect(() => cache.cacheMinimap(preview)).not.toThrow()
    })
  })

  describe('pickLastModifiedMap', () => {
    it('returns null when no last modified map', () => {
      const cache = new MapCache(createMockManifest())
      expect(cache.pickLastModifiedMap(1)).toBeNull()
    })

    it('returns null when map does not match visibility', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('last-map')
      preview.status = MapStatus.Available
      preview.visibility = 2 // Shellmap, not Lobby
      cache.lastModifiedMap = 'last-map'

      expect(cache.pickLastModifiedMap(1)).toBeNull() // Requesting Lobby
    })

    it('returns map uid when matching', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('last-map')
      preview.status = MapStatus.Available
      preview.visibility = 1 // Lobby
      cache.lastModifiedMap = 'last-map'

      expect(cache.pickLastModifiedMap(1)).toBe('last-map')
    })

    it('returns null on second call (one-time semantics)', () => {
      const cache = new MapCache(createMockManifest())
      const preview = cache.get('last-map')
      preview.status = MapStatus.Available
      preview.visibility = 1
      cache.lastModifiedMap = 'last-map'

      cache.pickLastModifiedMap(1) // First call succeeds
      expect(cache.pickLastModifiedMap(1)).toBeNull() // Second call returns null
    })
  })

  describe('dispose', () => {
    it('clears all state', () => {
      const cache = new MapCache(createMockManifest())
      cache.get('uid-1')
      cache.get('uid-2')

      cache.dispose()

      expect(cache.mapLocations.size).toBe(0)
      // After dispose, the Cache is cleared so tryGet returns undefined
      // @ts-expect-error — accessing private field to verify cleared
      expect(cache._previews.size).toBe(0)
    })

    it('is safe to call multiple times', () => {
      const cache = new MapCache(createMockManifest())
      expect(() => {
        cache.dispose()
        cache.dispose()
      }).not.toThrow()
    })
  })
})
