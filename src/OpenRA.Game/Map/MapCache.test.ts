/**
 * MapCache.test.ts — MapCache migration unit tests
 *
 * Tests focus on: construction, map loading, UID resolution, map selection,
 * iteration, dispose lifecycle, and utility functions.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @openra/HttpClient — replace fetchWithRetry for integration tests
// ---------------------------------------------------------------------------

vi.mock('../Net/HttpClient.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../Net/HttpClient.js'
import {
  MapCache,
  randomOrDefault,
  chunkArray,
  type ManifestStub,
  type ModDataStub,
} from './MapCache.js'
import { MapPreview, MapStatus, MapClassification } from './MapPreview.js'
import type { IReadOnlyPackage, IReadWritePackage } from '../FileSystem/IReadOnlyPackage.js'
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

/** 创建一个 mock Response 对象，用于 fetchWithRetry 集成测试。 */
function createMockResponse(
  ok: boolean,
  status: number,
  textBody: string,
): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => textBody,
    json: async () => JSON.parse(textBody),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockResponse(ok, status, textBody),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response
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

  describe('computeUid determinism', () => {
    it('generates same UID for same package name and contents', () => {
      const cache = new MapCache(createMockManifest())
      const pkg: IReadOnlyPackage = { name: '/maps/test.oramap', contents: ['map.yaml', 'map.bin'], contains: () => false, open: async () => null, openPackage: () => null, dispose: () => {} }

      // @ts-expect-error — accessing private method
      const uid1 = cache.computeUid(pkg)
      // @ts-expect-error — accessing private method
      const uid2 = cache.computeUid(pkg)

      expect(uid1).toBe(uid2)
      // Delegates to MapPreview.computeUid which returns djb2 hex hash
      expect(uid1).toMatch(/^[0-9a-f]+$/)
    })

    it('generates different UIDs for different package names', () => {
      const cache = new MapCache(createMockManifest())
      const pkg1: IReadOnlyPackage = { name: '/maps/a.oramap', contents: [], contains: () => false, open: async () => null, openPackage: () => null, dispose: () => {} }
      const pkg2: IReadOnlyPackage = { name: '/maps/b.oramap', contents: [], contains: () => false, open: async () => null, openPackage: () => null, dispose: () => {} }

      // @ts-expect-error — accessing private method
      const uid1 = cache.computeUid(pkg1)
      // @ts-expect-error — accessing private method
      const uid2 = cache.computeUid(pkg2)

      expect(uid1).not.toBe(uid2)
    })

    it('generates different UIDs for same name but different contents', () => {
      const cache = new MapCache(createMockManifest())
      const pkg1: IReadOnlyPackage = { name: '/maps/same.oramap', contents: ['map.yaml'], contains: () => false, open: async () => null, openPackage: () => null, dispose: () => {} }
      const pkg2: IReadOnlyPackage = { name: '/maps/same.oramap', contents: ['map.bin'], contains: () => false, open: async () => null, openPackage: () => null, dispose: () => {} }

      // @ts-expect-error — accessing private method
      const uid1 = cache.computeUid(pkg1)
      // @ts-expect-error — accessing private method
      const uid2 = cache.computeUid(pkg2)

      expect(uid1).not.toBe(uid2)
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

    it('uses real modFiles package when openPackage returns object with update and delete', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      // 创建真实可写包——同时实现 IReadOnlyPackage 和 IReadWritePackage
      const realPkg: IReadWritePackage = {
        name: 'maps/system',
        contents: ['map1.oramap', 'map2.oramap'],
        contains: (f: string) => f === 'map1.oramap',
        open: async () => null,
        openPackage: () => null,
        update: vi.fn(),
        delete: vi.fn(),
        dispose: vi.fn(),
      }

      const openPackageSpy = vi.fn().mockReturnValue(realPkg)
      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system'],
        contains: () => false,
        open: async () => null,
        openPackage: openPackageSpy,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)

      const packages = Array.from(cache.enumerateMapDirPackages(MapClassification.System))
      expect(packages.length).toBe(1)
      // 应返回真实的包对象（通过类型守卫）
      expect(packages[0]).toBe(realPkg)
      expect(openPackageSpy).toHaveBeenCalledWith('maps/system')
    })

    it('falls back to mock when openPackage returns object without update', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      // 只读包——缺少 update() 方法
      const readOnlyPkg: IReadOnlyPackage = {
        name: 'maps/system',
        contents: ['map1.oramap'],
        contains: () => false,
        open: async () => null,
        openPackage: () => null,
        dispose: () => {},
      }

      const openPackageSpy = vi.fn().mockReturnValue(readOnlyPkg)
      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system'],
        contains: () => false,
        open: async () => null,
        openPackage: openPackageSpy,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)

      const packages = Array.from(cache.enumerateMapDirPackages(MapClassification.System))
      expect(packages.length).toBe(1)
      // 应回退到模拟包（包含 update/delete 存根）
      expect(packages[0]).not.toBe(readOnlyPkg)
      expect(packages[0]!.name).toBe('maps/system')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (packages[0]! as unknown as Record<string, unknown>).update).toBe('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (packages[0]! as unknown as Record<string, unknown>).delete).toBe('function')
    })

    it('falls back to mock when openPackage returns object with update but no delete', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      // 部分可写包——有 update() 但缺少 delete() 方法
      const partialPkg = {
        name: 'maps/system',
        contents: ['map1.oramap'],
        contains: () => false,
        open: async () => null,
        openPackage: () => null,
        update: () => {},
        // 缺少 delete
        dispose: () => {},
      } as unknown as IReadOnlyPackage

      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system'],
        contains: () => false,
        open: async () => null,
        openPackage: () => partialPkg,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)

      const packages = Array.from(cache.enumerateMapDirPackages(MapClassification.System))
      expect(packages.length).toBe(1)
      // 应回退到模拟包，因为缺少 delete
      expect(packages[0]).not.toBe(partialPkg)
    })

    it('falls back to mock when openPackage returns null', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system'],
        contains: () => false,
        open: async () => null,
        openPackage: () => null, // 返回 null
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)

      const packages = Array.from(cache.enumerateMapDirPackages(MapClassification.System))
      expect(packages.length).toBe(1)
      // 应创建模拟包
      expect(packages[0]!.name).toBe('maps/system')
      expect(packages[0]!.contents).toEqual([])
    })

    it('yields mock packages when no modFiles provided', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)
      const cache = new MapCache(manifest) // 无 modFiles

      const packages = Array.from(cache.enumerateMapDirPackages(MapClassification.System))
      expect(packages.length).toBe(1)
      expect(packages[0]!.name).toBe('maps/system')
      // 所有方法都应存在（空存根）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (packages[0]! as unknown as Record<string, unknown>).update).toBe('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (packages[0]! as unknown as Record<string, unknown>).delete).toBe('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (packages[0]! as unknown as Record<string, unknown>).dispose).toBe('function')
    })
  })

  describe('enumerateMapPackagesWithoutCaching', () => {
    it('yields packages that pass the type guard', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      // 创建真实可写包——所有方法都存在
      const innerPkg: IReadWritePackage = {
        name: 'map1.oramap',
        contents: ['map.yaml', 'map.bin'],
        contains: () => true,
        open: async () => null,
        openPackage: () => null,
        update: vi.fn(),
        delete: vi.fn(),
        dispose: vi.fn(),
      }

      const dirPkg: IReadWritePackage = {
        name: 'maps/system',
        contents: ['map1.oramap'],
        contains: () => true,
        open: async () => null,
        openPackage: () => innerPkg,
        update: vi.fn(),
        delete: vi.fn(),
        dispose: vi.fn(),
      }

      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system'],
        contains: () => false,
        open: async () => null,
        openPackage: () => dirPkg,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)

      const packages = Array.from(cache.enumerateMapPackagesWithoutCaching(MapClassification.System))
      expect(packages.length).toBe(1)
      expect(packages[0]).toBe(innerPkg)
    })

    it('skips sub-packages that fail the type guard', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      // 只读子包——缺少 update/delete
      const readOnlyInner: IReadOnlyPackage = {
        name: 'map1.oramap',
        contents: ['map.yaml'],
        contains: () => true,
        open: async () => null,
        openPackage: () => null,
        dispose: () => {},
      }

      const dirPkg: IReadWritePackage = {
        name: 'maps/system',
        contents: ['map1.oramap'],
        contains: () => true,
        open: async () => null,
        openPackage: () => readOnlyInner as IReadWritePackage,
        update: vi.fn(),
        delete: vi.fn(),
        dispose: vi.fn(),
      }

      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system'],
        contains: () => false,
        open: async () => null,
        openPackage: () => dirPkg,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)

      const packages = Array.from(cache.enumerateMapPackagesWithoutCaching(MapClassification.System))
      // 只读子包应被 tryAsReadWritePackage 跳过
      expect(packages.length).toBe(0)
    })

    it('yields nothing when mock packages have no contents', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)
      const cache = new MapCache(manifest)

      const packages = Array.from(cache.enumerateMapPackagesWithoutCaching(MapClassification.System))
      // 模拟包 contents 为空，因此没有内部包可枚举
      expect(packages.length).toBe(0)
    })
  })

  describe('queryRemoteMapDetails', () => {
    let cache: MapCache
    let mockFetchWithRetry: ReturnType<typeof vi.fn>

    beforeEach(() => {
      vi.clearAllMocks()
      mockFetchWithRetry = fetchWithRetry as ReturnType<typeof vi.fn>
      cache = new MapCache(createMockManifest())
    })

    // -----------------------------------------------------------------------
    // Helper: register N unseen UIDs for batch testing
    // -----------------------------------------------------------------------

    function registerUnseenUids(count: number): string[] {
      const uids: string[] = []
      for (let i = 0; i < count; i++) {
        const uid = `uid-${i.toString().padStart(8, '0')}`
        const preview = cache.get(uid)
        preview.status = MapStatus.Unavailable
        uids.push(uid)
      }
      return uids
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    it('is an async function', () => {
      expect(typeof cache.queryRemoteMapDetails).toBe('function')
    })

    it('batches >50 UIDs into multiple requests', async () => {
      mockFetchWithRetry.mockResolvedValue(
        createMockResponse(true, 200, '{}'),
      )

      const uids = registerUnseenUids(120)

      await cache.queryRemoteMapDetails('https://example.com/', uids)

      // 120 UIDs / 50 per batch = 3 batches
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(3)
    })

    it('batches exactly 50 UIDs into a single request', async () => {
      mockFetchWithRetry.mockResolvedValue(
        createMockResponse(true, 200, '{}'),
      )

      const uids = registerUnseenUids(50)

      await cache.queryRemoteMapDetails('https://example.com/', uids)

      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
    })

    it('invokes mapDetailsReceived callback on successful remote data', async () => {
      const uid = 'uid-00000001'
      const preview = cache.get(uid)
      preview.status = MapStatus.Unavailable

      const responseData = {
        [uid]: {
          title: 'Test Map',
          author: 'Test Author',
          categories: ['Conquest'],
          players: 4,
          bounds: { X: 0, Y: 0, Width: 64, Height: 64 },
          spawnpoints: [0, 0],
          minimap: '',
          tileset: 'desert',
          mapformat: 12,
          downloading: true,
          map_grid_type: 0, // Rectangular
          rules: '',
          players_block: '',
          game_mod: 'ra',
        },
      }

      mockFetchWithRetry.mockResolvedValue(
        createMockResponse(true, 200, JSON.stringify(responseData)),
      )

      const callback = vi.fn()

      await cache.queryRemoteMapDetails(
        'https://example.com/',
        [uid],
        callback,
      )

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(preview)
      expect(preview.status).toBe(MapStatus.DownloadAvailable)
      expect(preview.title).toBe('Test Map')
    })

    it('invokes mapQueryFailed for maps still in Searching after batch failure', async () => {
      mockFetchWithRetry.mockRejectedValue(new Error('Network error'))

      const uid = 'uid-failed'
      const preview = cache.get(uid)
      preview.status = MapStatus.Unavailable
      const failureCallback = vi.fn()

      await cache.queryRemoteMapDetails(
        'https://example.com/',
        [uid],
        undefined,
        failureCallback,
      )

      // After batch failure, maps still in Searching should have
      // completeRemoteSearch(null, mapQueryFailed) called, which sets
      // status to Unavailable and invokes the callback (matching C#)
      expect(failureCallback).toHaveBeenCalledWith(preview)
      expect(preview.status).toBe(MapStatus.Unavailable)
    })

    it('propagates _previewLoaderCancelled as aborted signal', async () => {
      mockFetchWithRetry.mockResolvedValue(
        createMockResponse(true, 200, '{}'),
      )

      const uid = 'uid-signal'
      const preview = cache.get(uid)
      preview.status = MapStatus.Unavailable

      // Set cancellation flag via private field access for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._previewLoaderCancelled = true

      await cache.queryRemoteMapDetails('https://example.com/', [uid])

      // fetchWithRetry should have been called with an aborted signal (4th arg)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs = mockFetchWithRetry.mock.calls[0] as any[]
      const signalArg = callArgs[3]
      expect(signalArg).toBeDefined()
      expect(signalArg.aborted).toBe(true)
    })

    it('filters null and undefined UIDs', async () => {
      mockFetchWithRetry.mockResolvedValue(
        createMockResponse(true, 200, '{}'),
      )

      const validUid = 'uid-valid'
      const preview = cache.get(validUid)
      preview.status = MapStatus.Unavailable

      await cache.queryRemoteMapDetails('https://example.com/', [
        validUid,
        null as unknown as string,
        undefined as unknown as string,
      ])

      // Should only query valid UIDs
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs = mockFetchWithRetry.mock.calls[0] as any[]
      const url = callArgs[0] as string
      expect(url).toContain(validUid)
      expect(url).not.toContain('null')
      expect(url).not.toContain('undefined')
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

  // -------------------------------------------------------------------------
  // Minimap rendering pipeline tests (TODO-4.E.4)
  // -------------------------------------------------------------------------

  describe('runMinimapLoader', () => {
    /**
     * Helper: configure cache for minimap loader testing.
     *
     * Mocks addSimple on the sheetBuilder and overrides getMinimap() on each
     * preview to return null (simulating "not yet cached" state) so the filter
     * in runMinimapLoader passes.
     */
    function setupMinimapLoaderTest(
      cache: MapCache,
      previews: MapPreview[],
      addSimpleImpl?: () => Uint8Array,
    ): {
      addSimpleSpy: ReturnType<typeof vi.fn>
      releaseBufferSpy: ReturnType<typeof vi.fn>
    } {
      const addSimpleSpy = vi.fn(
        addSimpleImpl ?? (() => new Uint8Array(4)),
      )
      const releaseBufferSpy = vi.fn()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sheetBuilder = (cache as any)._sheetBuilder
      sheetBuilder.addSimple = addSimpleSpy
      sheetBuilder.current = { releaseBuffer: releaseBufferSpy }

      // Override getMinimap() on each preview to return null, so the runMinimapLoader
      // filter includes them. (By default getMinimap() returns preview, which is
      // non-null raw pixel data, incorrectly making the filter skip the preview.)
      for (const p of previews) {
        p.getMinimap = () => null
      }

      return { addSimpleSpy, releaseBufferSpy }
    }

    it('uses SpriteFrameType.Rgba32 for minimap data', async () => {
      const cache = new MapCache(createMockManifest())

      const preview = cache.get('test-minimap-uid')
      preview.status = MapStatus.Available
      preview.preview = new Uint8Array(128 * 128 * 4)
      preview.previewSize = { width: 128, height: 128 }

      const { addSimpleSpy } = setupMinimapLoaderTest(cache, [preview], () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(cache as any)._previewLoaderCancelled = true
        return new Uint8Array(4)
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._generateMinimap.push(preview)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cache as any).runMinimapLoader()

      expect(addSimpleSpy).toHaveBeenCalledTimes(1)
      const callArgs = addSimpleSpy.mock.calls[0] as unknown[]
      expect(callArgs[1]).toBe(3) // SpriteFrameType.Rgba32
      expect(callArgs[2]).toEqual({ width: 128, height: 128 })
    })

    it('passes previewSize as dimensions to addSimple', async () => {
      const cache = new MapCache(createMockManifest())

      const preview = cache.get('uid-size-test')
      preview.status = MapStatus.Available
      preview.preview = new Uint8Array(64 * 48 * 4)
      preview.previewSize = { width: 64, height: 48 }

      const { addSimpleSpy } = setupMinimapLoaderTest(cache, [preview], () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(cache as any)._previewLoaderCancelled = true
        return new Uint8Array(4)
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._generateMinimap.push(preview)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cache as any).runMinimapLoader()

      expect(addSimpleSpy).toHaveBeenCalledTimes(1)
      const callArgs = addSimpleSpy.mock.calls[0] as unknown[]
      expect(callArgs[2]).toEqual({ width: 64, height: 48 })
    })

    it('skips previews with null previewSize', async () => {
      const cache = new MapCache(createMockManifest())

      const preview = cache.get('uid-no-size')
      preview.status = MapStatus.Available
      preview.preview = new Uint8Array(100)
      preview.previewSize = null

      const { addSimpleSpy } = setupMinimapLoaderTest(cache, [preview])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._generateMinimap.push(preview)
      // Set cancelled BEFORE the loader runs so the loop exits immediately.
      // The preview has null previewSize so it would be skipped regardless;
      // we cancel early to avoid the 5s keepAlive empty-loop wait.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._previewLoaderCancelled = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cache as any).runMinimapLoader()

      expect(addSimpleSpy).not.toHaveBeenCalled()
    })

    it('calls releaseBuffer after batch processing', async () => {
      const cache = new MapCache(createMockManifest())

      const preview = cache.get('uid-release-test')
      preview.status = MapStatus.Available
      preview.preview = new Uint8Array(32 * 32 * 4)
      preview.previewSize = { width: 32, height: 32 }

      const { releaseBufferSpy } = setupMinimapLoaderTest(
        cache,
        [preview],
        () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(cache as any)._previewLoaderCancelled = true
          return new Uint8Array(4)
        },
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._generateMinimap.push(preview)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cache as any).runMinimapLoader()

      expect(releaseBufferSpy).toHaveBeenCalledTimes(1)
    })

    it('handles addSimple exception gracefully', async () => {
      const cache = new MapCache(createMockManifest())

      const preview1 = cache.get('uid-fail-1')
      preview1.status = MapStatus.Available
      preview1.preview = new Uint8Array(16 * 16 * 4)
      preview1.previewSize = { width: 16, height: 16 }

      const preview2 = cache.get('uid-fail-2')
      preview2.status = MapStatus.Available
      preview2.preview = new Uint8Array(8 * 8 * 4)
      preview2.previewSize = { width: 8, height: 8 }

      let callCount = 0
      const { addSimpleSpy } = setupMinimapLoaderTest(
        cache,
        [preview1, preview2],
        () => {
          callCount++
          if (callCount === 2) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(cache as any)._previewLoaderCancelled = true
          }
          throw new Error('SheetOverflowException')
        },
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._generateMinimap.push(preview1, preview2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((cache as any).runMinimapLoader()).resolves.toBeUndefined()

      expect(addSimpleSpy).toHaveBeenCalledTimes(2)
    })

    it('validates pixel data size matches previewSize', async () => {
      const cache = new MapCache(createMockManifest())

      const preview = cache.get('uid-mismatch')
      preview.status = MapStatus.Available
      preview.preview = new Uint8Array(100)
      preview.previewSize = { width: 32, height: 32 } // expects 4096 bytes

      const { addSimpleSpy } = setupMinimapLoaderTest(cache, [preview])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._generateMinimap.push(preview)
      // Set cancelled BEFORE the loader runs so the loop exits immediately.
      // The preview has mismatched size so it would be skipped regardless;
      // we cancel early to avoid the 5s keepAlive empty-loop wait.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._previewLoaderCancelled = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cache as any).runMinimapLoader()

      expect(addSimpleSpy).not.toHaveBeenCalled()
    })

    it('cacheMinimap starts loader on first call', async () => {
      const cache = new MapCache(createMockManifest())

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cache as any)._previewLoaderShutdown).toBe(true)

      const preview = cache.get('uid-startup')
      preview.status = MapStatus.Available
      preview.preview = new Uint8Array(4 * 4 * 4)
      preview.previewSize = { width: 4, height: 4 }

      const { addSimpleSpy } = setupMinimapLoaderTest(cache, [preview], () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(cache as any)._previewLoaderCancelled = true
        return new Uint8Array(4)
      })

      cache.cacheMinimap(preview)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cache as any)._previewLoaderShutdown).toBe(false)

      // Wait for the setTimeout(0) -> runMinimapLoader to complete
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loaderPromise = (cache as any)._previewLoaderPromise as Promise<void>
      if (loaderPromise) await loaderPromise

      expect(addSimpleSpy).toHaveBeenCalledTimes(1)
    })

    it('stops early when cancelled', async () => {
      const cache = new MapCache(createMockManifest())

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any)._previewLoaderCancelled = true

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cache as any).runMinimapLoader()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cache as any)._previewLoaderShutdown).toBe(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cache as any)._previewLoaderRunning).toBe(false)
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

    it('sets cancellation flag to stop loader', () => {
      const cache = new MapCache(createMockManifest())
      // @ts-expect-error — accessing private field
      expect(cache._previewLoaderCancelled).toBe(false)
      cache.dispose()
      // @ts-expect-error — accessing private field
      expect(cache._previewLoaderCancelled).toBe(true)
    })
  })

  describe('disposeAsync', () => {
    it('returns a promise', async () => {
      const cache = new MapCache(createMockManifest())
      const result = cache.disposeAsync()
      expect(result).toBeInstanceOf(Promise)
      await result
    })

    it('resolves after cleanup', async () => {
      const cache = new MapCache(createMockManifest())
      cache.get('uid-1')

      await cache.disposeAsync()

      expect(cache.mapLocations.size).toBe(0)
    })

    it('sets cancellation flag', async () => {
      const cache = new MapCache(createMockManifest())
      // @ts-expect-error — accessing private field
      expect(cache._previewLoaderCancelled).toBe(false)
      await cache.disposeAsync()
      // @ts-expect-error — accessing private field
      expect(cache._previewLoaderCancelled).toBe(true)
    })
  })

  describe('constructor with modFiles', () => {
    it('accepts optional modFiles parameter', () => {
      const manifest = createMockManifest()
      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: ['maps/system', 'maps/user'],
        contains: () => false,
        open: async () => null,
        openPackage: () => null,
        dispose: () => {},
      }
      const cache = new MapCache(manifest, modFiles)
      expect(cache).toBeDefined()
    })

    it('uses modFiles.openPackage when loading maps', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      const openPackageSpy = vi.fn().mockReturnValue(null)
      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: [],
        contains: () => false,
        open: async () => null,
        openPackage: openPackageSpy,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)
      const modData = createMockModData()
      cache.loadMaps(modData)

      expect(openPackageSpy).toHaveBeenCalledWith('maps/system')
    })

    it('falls back to mock package when modFiles.openPackage returns null', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: [],
        contains: () => false,
        open: async () => null,
        openPackage: () => null,
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)
      const modData = createMockModData()

      // Should not throw when openPackage returns null
      expect(() => cache.loadMaps(modData)).not.toThrow()
      expect(cache.mapLocations.size).toBe(1)
    })

    it('handles modFiles.openPackage throwing', () => {
      const mapFolders = new Map([
        ['maps/system', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: [],
        contains: () => false,
        open: async () => null,
        openPackage: () => { throw new Error('Not found') },
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)
      const modData = createMockModData()

      // Should throw for non-optional folder
      expect(() => cache.loadMaps(modData)).toThrow('Not found')
    })

    it('continues past optional folder when modFiles.openPackage throws', () => {
      const mapFolders = new Map([
        ['~maps/optional', 'System'],
        ['maps/required', 'System'],
      ])
      const manifest = createMockManifest(mapFolders)

      let callCount = 0
      const modFiles: IReadOnlyPackage = {
        name: '/mods/ra',
        contents: [],
        contains: () => false,
        open: async () => null,
        openPackage: (name) => {
          callCount++
          if (name === 'maps/optional') throw new Error('Optional folder not found')
          return null // Return null for required, which creates mock
        },
        dispose: () => {},
      }

      const cache = new MapCache(manifest, modFiles)
      const modData = createMockModData()
      cache.loadMaps(modData)

      // Both folders should have been attempted
      expect(callCount).toBe(2)
      expect(cache.mapLocations.size).toBe(1) // Only required folder
    })
  })
})
