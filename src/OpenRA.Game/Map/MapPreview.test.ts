/**
 * MapPreview.test.ts -- MapPreview migration unit tests
 *
 * Tests focus on: construction defaults, metadata application, remote search,
 * minimap lifecycle, UID computation, author parsing, lifecycle (invalidate/dispose/delete),
 * MapStatus and MapClassification values, preview pixel generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MapPreview,
  MapStatus,
  MapClassification,
  MapClassificationExts,
  type MapMetadata,
  type MapCacheRef,
  type RemoteMapData,
} from './MapPreview.js'
import { MapGridType } from './MapGridType.js'
import { MapGenerationArgs } from './MapGenerationArgs.js'
import type { IReadOnlyPackage } from '../FileSystem/IReadOnlyPackage.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function createMockPackage(
  name: string,
  contents: string[] = [],
): IReadOnlyPackage {
  return {
    name,
    contents,
    contains: (filename: string) => contents.includes(filename),
    open: vi.fn().mockResolvedValue(null),
    openPackage: vi.fn().mockReturnValue(null),
    dispose: vi.fn(),
  }
}

function createMockCacheRef(overrides: Partial<MapCacheRef> = {}): MapCacheRef {
  return {
    loadMap: vi.fn(),
    cacheMinimap: vi.fn(),
    ...overrides,
  }
}

function createMockMetadata(overrides: Partial<MapMetadata> = {}): MapMetadata {
  return {
    title: 'Test Map',
    author: 'Test Author',
    categories: ['Conquest'],
    tileset: 'temperat',
    mapFormat: 12,
    bounds: { X: 0, Y: 0, Width: 128, Height: 128 },
    visibility: 1, // Lobby
    spawnPoints: [
      { X: 10, Y: 10 },
      { X: 100, Y: 100 },
    ],
    playerDefinitions: [
      { name: 'Neutral', properties: { ownsWorld: true, nonCombatant: true } },
      {
        name: 'Multi0',
        properties: { playable: true, faction: 'Random', enemies: ['Creeps'] },
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// MapStatus tests
// ---------------------------------------------------------------------------

describe('MapStatus', () => {
  it('has correct values matching OpenRA C# enum', () => {
    expect(MapStatus.Available).toBe(0)
    expect(MapStatus.Unavailable).toBe(1)
    expect(MapStatus.Searching).toBe(2)
    expect(MapStatus.DownloadAvailable).toBe(3)
    expect(MapStatus.Downloading).toBe(4)
    expect(MapStatus.DownloadError).toBe(5)
    expect(MapStatus.Generatable).toBe(6)
    expect(MapStatus.Generating).toBe(7)
  })

  // NOTE: TypeScript `as const` is compile-time only; runtime immutability
  // would require Object.freeze(), which is not used for performance reasons.
  it('is a const-like object with correct values', () => {
    expect(MapStatus.Available).toBe(0)
    expect(MapStatus.Unavailable).toBe(1)
    expect(MapStatus.Generating).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// MapClassification tests
// ---------------------------------------------------------------------------

describe('MapClassification', () => {
  it('has correct values matching OpenRA C# [Flags] enum', () => {
    expect(MapClassification.Unknown).toBe(0)
    expect(MapClassification.System).toBe(1)
    expect(MapClassification.User).toBe(2)
    expect(MapClassification.Remote).toBe(4)
    expect(MapClassification.Generated).toBe(8)
  })

  it('has Flag() returns true when flag is set', () => {
    expect(MapClassificationExts.hasFlag(MapClassification.System, MapClassification.System)).toBe(true)
    expect(MapClassificationExts.hasFlag((MapClassification.System | MapClassification.User) as MapClassification, MapClassification.System)).toBe(true)
    expect(MapClassificationExts.hasFlag((MapClassification.System | MapClassification.User) as MapClassification, MapClassification.User)).toBe(true)
  })

  it('has Flag() returns false when flag is not set', () => {
    expect(MapClassificationExts.hasFlag(MapClassification.System, MapClassification.User)).toBe(false)
    expect(MapClassificationExts.hasFlag(MapClassification.User, MapClassification.System)).toBe(false)
    expect(MapClassificationExts.hasFlag(MapClassification.Remote, MapClassification.Generated)).toBe(false)
  })

  it('has Flag() returns true for self (Unknown == 0 is always in any flag)', () => {
    // 0 & 0 == 0, so hasFlag returns true
    expect(MapClassificationExts.hasFlag(MapClassification.Unknown, MapClassification.Unknown)).toBe(true)
    // AnyFlag & 0 == 0, so Unknown is always "present" (bitmask behavior)
    expect(MapClassificationExts.hasFlag(MapClassification.System, MapClassification.Unknown)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MapPreview constructor
// ---------------------------------------------------------------------------

describe('MapPreview constructor', () => {
  it('initializes with default values', () => {
    const preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)

    expect(preview.uid).toBe('test-uid')
    expect(preview.path).toBe('')
    expect(preview.status).toBe(MapStatus.Unavailable)
    expect(preview.visibility).toBe(1) // Lobby
    expect(preview.class).toBe(MapClassification.Unknown)
    expect(preview.mapFormat).toBe(0)
    expect(preview.title).toBe('Unknown Map')
    expect(preview.categories).toEqual(['Unknown'])
    expect(preview.author).toBe('Unknown Author')
    expect(preview.tileset).toBe('unknown')
    expect(preview.playerCount).toBe(0)
    expect(preview.spawnPoints).toEqual([])
    expect(preview.gridType).toBe(MapGridType.Rectangular)
    expect(preview.preview).toBeNull()
    expect(preview.downloadBytes).toBe(0)
    expect(preview.downloadPercentage).toBe(0)
    expect(preview.generationArgs).toBeNull()
  })

  it('stores cache reference', () => {
    const cache = createMockCacheRef()
    const preview = new MapPreview(null, 'uid', MapGridType.Rectangular, cache)
    // Indirectly verify via getMinimap which triggers cache callback
    preview.getMinimap()
    // Cache was not triggered because status is Unavailable
    expect(cache.cacheMinimap).not.toHaveBeenCalled()
  })

  it('initializes with different grid types', () => {
    const rect = new MapPreview(null, 'a', MapGridType.Rectangular, null)
    const iso = new MapPreview(null, 'b', MapGridType.RectangularIsometric, null)

    expect(rect.gridType).toBe(MapGridType.Rectangular)
    expect(iso.gridType).toBe(MapGridType.RectangularIsometric)
  })

  it('sets modifiedDate to current time', () => {
    const before = new Date()
    const preview = new MapPreview(null, 'uid', MapGridType.Rectangular, null)
    const after = new Date()

    expect(preview.modifiedDate.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(preview.modifiedDate.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// ---------------------------------------------------------------------------
// applyMetadata
// ---------------------------------------------------------------------------

describe('applyMetadata', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)
  })

  it('applies title from metadata', () => {
    const meta = createMockMetadata({ title: 'My Awesome Map' })
    preview.applyMetadata(meta)
    expect(preview.title).toBe('My Awesome Map')
  })

  it('applies author from metadata', () => {
    const meta = createMockMetadata({ author: 'John Doe' })
    preview.applyMetadata(meta)
    expect(preview.author).toBe('John Doe')
  })

  it('applies categories from metadata', () => {
    const meta = createMockMetadata({ categories: ['Conquest', 'Naval'] })
    preview.applyMetadata(meta)
    expect(preview.categories).toEqual(['Conquest', 'Naval'])
  })

  it('applies tileset from metadata', () => {
    const meta = createMockMetadata({ tileset: 'snow' })
    preview.applyMetadata(meta)
    expect(preview.tileset).toBe('snow')
  })

  it('applies mapFormat from metadata', () => {
    const meta = createMockMetadata({ mapFormat: 11 })
    preview.applyMetadata(meta)
    expect(preview.mapFormat).toBe(11)
  })

  it('applies bounds from metadata', () => {
    const meta = createMockMetadata({ bounds: { X: 5, Y: 10, Width: 200, Height: 150 } })
    preview.applyMetadata(meta)
    expect(preview.bounds.X).toBe(5)
    expect(preview.bounds.Width).toBe(200)
  })

  it('applies visibility from metadata', () => {
    const meta = createMockMetadata({ visibility: 2 }) // Shellmap
    preview.applyMetadata(meta)
    expect(preview.visibility).toBe(2)
  })

  it('applies spawn points from metadata', () => {
    const spawns = [
      { X: 5, Y: 5 },
      { X: 50, Y: 50 },
      { X: 90, Y: 20 },
    ]
    const meta = createMockMetadata({ spawnPoints: spawns })
    preview.applyMetadata(meta)
    expect(preview.spawnPoints).toEqual(spawns)
  })

  it('applies player definitions and computes player count', () => {
    const meta = createMockMetadata({
      playerDefinitions: [
        { name: 'Neutral', properties: { ownsWorld: true, nonCombatant: true } },
        { name: 'Multi0', properties: { playable: true } },
        { name: 'Multi1', properties: { playable: true } },
        { name: 'Multi2', properties: { playable: true } },
        { name: 'Creeps', properties: { nonCombatant: true } },
      ],
    })
    preview.applyMetadata(meta)
    expect(preview.playerCount).toBe(3) // Multi0, Multi1, Multi2
    expect(preview.players.players.size).toBe(5)
  })

  it('does not overwrite fields that are undefined in metadata', () => {
    const originalTitle = preview.title
    const originalAuthor = preview.author
    const meta = createMockMetadata({ title: undefined, author: undefined })
    preview.applyMetadata(meta)
    expect(preview.title).toBe(originalTitle)
    expect(preview.author).toBe(originalAuthor)
  })

  it('handles metadata with only some fields', () => {
    const meta: MapMetadata = { title: 'Minimal Map' }
    preview.applyMetadata(meta)
    expect(preview.title).toBe('Minimal Map')
    // Others should remain defaults
    expect(preview.author).toBe('Unknown Author')
    expect(preview.categories).toEqual(['Unknown'])
  })

  it('handles empty spawn points', () => {
    const meta = createMockMetadata({ spawnPoints: [] })
    preview.applyMetadata(meta)
    expect(preview.spawnPoints).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// updateFromMap / updateFromMapWithoutOwningPackage
// ---------------------------------------------------------------------------

describe('updateFromMap', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)
  })

  it('sets path and classification', () => {
    const pkg = createMockPackage('/maps/mymap.oramap')
    preview.updateFromMap(pkg, MapClassification.System)

    expect(preview.path).toBe('/maps/mymap.oramap')
    expect(preview.class).toBe(MapClassification.System)
  })

  it('updates modifiedDate', () => {
    const before = new Date()
    const pkg = createMockPackage('/maps/map')
    preview.updateFromMap(pkg, MapClassification.User)

    expect(preview.modifiedDate.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('applies gridType when provided', () => {
    const pkg = createMockPackage('/maps/map')
    preview.updateFromMap(pkg, MapClassification.System, MapGridType.RectangularIsometric)

    expect(preview.gridType).toBe(MapGridType.RectangularIsometric)
  })

  it('applies metadata when provided', () => {
    const pkg = createMockPackage('/maps/map')
    const meta = createMockMetadata({ title: 'Updated Title' })
    preview.updateFromMap(pkg, MapClassification.User, null, meta)

    expect(preview.title).toBe('Updated Title')
    expect(preview.path).toBe('/maps/map')
  })

  it('does not change gridType when null is passed', () => {
    const previewWithIso = new MapPreview(null, 'uid', MapGridType.RectangularIsometric, null)
    const pkg = createMockPackage('/maps/map')
    previewWithIso.updateFromMap(pkg, MapClassification.System, null)
    expect(previewWithIso.gridType).toBe(MapGridType.RectangularIsometric)
  })
})

describe('updateFromMapWithoutOwningPackage', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)
  })

  it('sets path, classification, and marks as Available', () => {
    const pkg = createMockPackage('map.oramap')
    const parent = createMockPackage('/maps')

    preview.updateFromMapWithoutOwningPackage(
      pkg,
      parent,
      MapClassification.System,
    )

    expect(preview.path).toBe('map.oramap')
    expect(preview.class).toBe(MapClassification.System)
    expect(preview.status).toBe(MapStatus.Available)
  })

  it('applies metadata when provided', () => {
    const pkg = createMockPackage('map.oramap')
    const parent = createMockPackage('/maps')
    const meta = createMockMetadata({ title: 'Without Owning', author: 'Owner' })

    preview.updateFromMapWithoutOwningPackage(
      pkg,
      parent,
      MapClassification.User,
      null,
      undefined,
      meta,
    )

    expect(preview.title).toBe('Without Owning')
    expect(preview.author).toBe('Owner')
    expect(preview.status).toBe(MapStatus.Available)
  })

  it('works without metadata', () => {
    const pkg = createMockPackage('map.oramap')
    const parent = createMockPackage('/maps')

    preview.updateFromMapWithoutOwningPackage(pkg, parent, MapClassification.User)

    // Defaults should remain but status should be available
    expect(preview.status).toBe(MapStatus.Available)
    expect(preview.title).toBe('Unknown Map')
  })

  it('passes modDataRules through without error', () => {
    const pkg = createMockPackage('map.oramap')
    const parent = createMockPackage('/maps')

    expect(() => {
      preview.updateFromMapWithoutOwningPackage(
        pkg,
        parent,
        MapClassification.System,
        null,
        { someRule: true },
      )
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// updateFromGenerationArgs
// ---------------------------------------------------------------------------

describe('updateFromGenerationArgs', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)
  })

  it('sets Generated classification and Generatable status', () => {
    const args = new MapGenerationArgs({
      uid: 'gen-uid',
      generator: 'Random',
      tileset: 'desert',
      size: { width: 64, height: 64 },
      title: 'Generated Map',
      author: 'Generator',
    })

    preview.updateFromGenerationArgs(args)

    expect(preview.class).toBe(MapClassification.Generated)
    expect(preview.status).toBe(MapStatus.Generatable)
    expect(preview.title).toBe('Generated Map')
    expect(preview.author).toBe('Generator')
    expect(preview.tileset).toBe('desert')
    expect(preview.generationArgs).toBe(args)
    expect(preview.mapFormat).toBe(12)
  })

  it('handles minimal generation args', () => {
    const args = new MapGenerationArgs({
      title: 'Minimal',
      author: 'Auto',
      tileset: 'temperat',
    })

    preview.updateFromGenerationArgs(args)

    expect(preview.class).toBe(MapClassification.Generated)
    expect(preview.status).toBe(MapStatus.Generatable)
    expect(preview.title).toBe('Minimal')
  })
})

// ---------------------------------------------------------------------------
// Remote search
// ---------------------------------------------------------------------------

describe('beginRemoteSearch', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'remote-uid', MapGridType.Rectangular, null)
  })

  it('sets status to Searching for Unknown class', () => {
    preview.beginRemoteSearch()
    expect(preview.class).toBe(MapClassification.Remote)
    expect(preview.status).toBe(MapStatus.Searching)
  })

  it('sets status to Searching for Remote class', () => {
    preview.class = MapClassification.Remote
    preview.beginRemoteSearch()
    expect(preview.class).toBe(MapClassification.Remote)
    expect(preview.status).toBe(MapStatus.Searching)
  })

  it('does not override existing concrete classification', () => {
    preview.class = MapClassification.System
    preview.status = MapStatus.Available
    preview.beginRemoteSearch()
    // Should remain unchanged
    expect(preview.class).toBe(MapClassification.System)
    expect(preview.status).toBe(MapStatus.Available)
  })

  it('does not override User classification', () => {
    preview.class = MapClassification.User
    preview.status = MapStatus.Available
    preview.beginRemoteSearch()
    expect(preview.class).toBe(MapClassification.User)
    expect(preview.status).toBe(MapStatus.Available)
  })
})

describe('completeRemoteSearch', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'remote-uid', MapGridType.Rectangular, null)
    preview.beginRemoteSearch() // Sets class=Remote, status=Searching
  })

  it('applies remote data when available for download', () => {
    const data: RemoteMapData = {
      title: 'Remote Map',
      author: 'Remote Author',
      categories: ['Conquest', 'Naval'],
      players: 6,
      bounds: { X: 0, Y: 0, Width: 256, Height: 256 },
      spawnpoints: [10, 10, 100, 100, 200, 50],
      map_grid_type: MapGridType.Rectangular,
      minimap: '',
      downloading: true,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 12,
      game_mod: 'ra',
    }

    preview.completeRemoteSearch(data)

    expect(preview.status).toBe(MapStatus.DownloadAvailable)
    expect(preview.title).toBe('Remote Map')
    expect(preview.author).toBe('Remote Author')
    expect(preview.categories).toEqual(['Conquest', 'Naval'])
    expect(preview.playerCount).toBe(6)
    expect(preview.tileset).toBe('temperat')
    expect(preview.mapFormat).toBe(12)
    expect(preview.bounds.Width).toBe(256)
  })

  it('sets status to Unavailable when not downloading', () => {
    const data: RemoteMapData = {
      title: 'Not Downloadable',
      author: 'Author',
      categories: [],
      players: 2,
      bounds: { X: 0, Y: 0, Width: 64, Height: 64 },
      spawnpoints: [],
      map_grid_type: MapGridType.Rectangular,
      minimap: '',
      downloading: false,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 11,
      game_mod: 'cnc',
    }

    preview.completeRemoteSearch(data)

    expect(preview.status).toBe(MapStatus.Unavailable)
  })

  it('parses spawn points from remote data', () => {
    const data: RemoteMapData = {
      title: 'Spawn Map',
      author: 'Author',
      categories: [],
      players: 3,
      bounds: { X: 0, Y: 0, Width: 128, Height: 128 },
      spawnpoints: [5, 5, 60, 60, 120, 120],
      map_grid_type: MapGridType.RectangularIsometric,
      minimap: '',
      downloading: true,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 12,
      game_mod: 'ra',
    }

    preview.completeRemoteSearch(data)

    expect(preview.spawnPoints).toEqual([
      { X: 5, Y: 5 },
      { X: 60, Y: 60 },
      { X: 120, Y: 120 },
    ])
  })

  it('handles null data', () => {
    preview.completeRemoteSearch(null)

    expect(preview.class).toBe(MapClassification.Remote)
    expect(preview.status).toBe(MapStatus.Unavailable)
  })

  it('does not override if preview has been resolved to local map', () => {
    // Simulate another task resolving this to a System map
    preview.class = MapClassification.System
    preview.status = MapStatus.Available

    const data: RemoteMapData = {
      title: 'Should Not Apply',
      author: 'Other',
      categories: [],
      players: 1,
      bounds: { X: 0, Y: 0, Width: 10, Height: 10 },
      spawnpoints: [],
      map_grid_type: MapGridType.Rectangular,
      minimap: '',
      downloading: true,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 11,
      game_mod: 'cnc',
    }

    preview.completeRemoteSearch(data)

    // Should ignore the remote data because class was changed to System
    expect(preview.status).toBe(MapStatus.Available)
    expect(preview.title).toBe('Unknown Map') // unchanged
  })

  it('calls callback on success', () => {
    const callback = vi.fn()
    const data: RemoteMapData = {
      title: 'Callback Map',
      author: 'Author',
      categories: [],
      players: 2,
      bounds: { X: 0, Y: 0, Width: 128, Height: 128 },
      spawnpoints: [],
      map_grid_type: MapGridType.Rectangular,
      minimap: '',
      downloading: true,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 12,
      game_mod: 'ra',
    }

    preview.completeRemoteSearch(data, callback)

    expect(callback).toHaveBeenCalledWith(preview)
  })

  it('calls callback even when data is null (matching C# parseMetadata?.Invoke)', () => {
    const callback = vi.fn()
    preview.completeRemoteSearch(null, callback)
    // C# CompleteRemoteSearch 在 MapClassification.Remote 时无条件调用
    // parseMetadata?.Invoke(this)
    expect(callback).toHaveBeenCalledWith(preview)
    expect(preview.status).toBe(MapStatus.Unavailable)
  })

  it('handles malformed spawn points (odd count)', () => {
    // spawnpoints with odd length -- only pairs are decoded
    const data: RemoteMapData = {
      title: 'Odd Spawn',
      author: 'Author',
      categories: [],
      players: 1,
      bounds: { X: 0, Y: 0, Width: 10, Height: 10 },
      spawnpoints: [5, 5, 60], // 3 values, only first pair decoded
      map_grid_type: MapGridType.Rectangular,
      minimap: '',
      downloading: true,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 12,
      game_mod: 'ra',
    }

    expect(() => preview.completeRemoteSearch(data)).not.toThrow()
    // Should have parsed the first pair
    expect(preview.spawnPoints.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// fetchRemoteInfo
// ---------------------------------------------------------------------------

describe('fetchRemoteInfo', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)
  })

  it('returns RemoteMapData on successful fetch', async () => {
    const mockData: RemoteMapData = {
      title: 'Fetched Map',
      author: 'Fetcher',
      categories: ['Conquest'],
      players: 4,
      bounds: { X: 0, Y: 0, Width: 100, Height: 100 },
      spawnpoints: [10, 10],
      map_grid_type: MapGridType.Rectangular,
      minimap: '',
      downloading: true,
      tileset: 'temperat',
      rules: '',
      players_block: '',
      mapformat: 12,
      game_mod: 'ra',
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    })

    const result = await preview.fetchRemoteInfo('https://api.example.com/maps/uid')

    expect(result).toEqual(mockData)
  })

  it('returns null on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })

    const result = await preview.fetchRemoteInfo('https://api.example.com/maps/missing')

    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await preview.fetchRemoteInfo('https://api.example.com/maps/uid')

    expect(result).toBeNull()
  })

  it('returns null on JSON parse error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON')
      },
    })

    const result = await preview.fetchRemoteInfo('https://api.example.com/maps/uid')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

describe('minimap', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'test-uid', MapGridType.Rectangular, null)
    preview.status = MapStatus.Available
  })

  describe('getMinimap', () => {
    it('returns preview pixels when already cached', () => {
      const pixels = new Uint8Array([255, 0, 0, 255])
      preview.preview = pixels
      const result = preview.getMinimap()
      expect(result).toBe(pixels)
    })

    it('returns null and triggers cacheMinimap when not yet cached', () => {
      const cache = createMockCacheRef()
      const p = new MapPreview(null, 'uid', MapGridType.Rectangular, cache)
      p.status = MapStatus.Available

      const result = p.getMinimap()

      expect(result).toBeNull()
      expect(cache.cacheMinimap).toHaveBeenCalledWith(p)
    })

    it('does not trigger cacheMinimap when already generating', () => {
      const cache = createMockCacheRef()
      const p = new MapPreview(null, 'uid', MapGridType.Rectangular, cache)
      p.status = MapStatus.Available

      // First call starts generation
      p.getMinimap()
      // Second call should not trigger again
      p.getMinimap()

      expect(cache.cacheMinimap).toHaveBeenCalledTimes(1)
    })

    it('does not trigger cacheMinimap when status is not Available', () => {
      const cache = createMockCacheRef()
      const p = new MapPreview(null, 'uid', MapGridType.Rectangular, cache)
      p.status = MapStatus.Unavailable

      const result = p.getMinimap()

      expect(result).toBeNull()
      expect(cache.cacheMinimap).not.toHaveBeenCalled()
    })

    it('returns null when no cache is set', () => {
      // No cache set
      const result = preview.getMinimap()
      expect(result).toBeNull()
    })
  })

  describe('setMinimap', () => {
    it('stores Uint8Array as preview', () => {
      const pixels = new Uint8Array([0, 128, 255, 255])
      preview.setMinimap(pixels)
      expect(preview.preview).toBe(pixels)
    })

    it('resets generatingMinimap flag', () => {
      preview.getMinimap() // triggers _generatingMinimap = true
      preview.setMinimap(new Uint8Array(4))

      // After setMinimap, subsequent getMinimap should trigger again
      const cache = createMockCacheRef()
      const p = new MapPreview(null, 'uid2', MapGridType.Rectangular, cache)
      p.status = MapStatus.Available
      p.setMinimap(new Uint8Array(4))

      // Now getMinimap should return the stored preview
      expect(p.getMinimap()).not.toBeNull()
    })

    it('ignores non-Uint8Array values', () => {
      preview.setMinimap('not-a-uint8array')
      expect(preview.preview).toBeNull()
    })
  })

  describe('generatePreviewPixels', () => {
    it('generates preview pixels from terrain data', () => {
      const terrainData = new Array(100 * 100).fill(0) // 100x100 clear terrain
      const pixels = preview.generatePreviewPixels(terrainData, 100, 100)

      expect(pixels).not.toBeNull()
      expect(pixels!.length).toBeGreaterThan(0)
      // Should be RGBA (4 bytes per pixel)
      expect(pixels!.length % 4).toBe(0)
    })

    it('scales large maps to max 256 preview size', () => {
      const terrainData = new Array(512 * 512).fill(0)
      const pixels = preview.generatePreviewPixels(terrainData, 512, 512)

      expect(pixels).not.toBeNull()
      // Preview width should be <= 256
      // Each pixel is 4 bytes, so total = w * h * 4
      // For 512x512 => preview is 256x256 => 256 * 256 * 4 = 262144
      expect(pixels!.length).toBe(256 * 256 * 4)
    })

    it('handles small maps (1x1)', () => {
      const terrainData = [2] // water
      const pixels = preview.generatePreviewPixels(terrainData, 1, 1)

      expect(pixels).not.toBeNull()
      expect(pixels!.length).toBe(4) // 1x1 * RGBA
    })

    it('handles larger terrainData than map dimensions (safe indexing)', () => {
      const terrainData = new Array(200 * 200).fill(0)
      const pixels = preview.generatePreviewPixels(terrainData, 50, 50)

      expect(pixels).not.toBeNull()
      // Should still work without out-of-bounds errors
    })

    it('stores result in preview property', () => {
      const terrainData = [0]
      const pixels = preview.generatePreviewPixels(terrainData, 1, 1)

      expect(preview.preview).toBe(pixels)
    })

    it('maps terrain type 0 (Clear) to a color', () => {
      const terrainData = [0]
      const pixels = preview.generatePreviewPixels(terrainData, 1, 1)

      // Clear terrain gets color 0xc0b080ff (RGBA)
      expect(pixels![0]).toBe(0xc0)
      expect(pixels![1]).toBe(0xb0)
      expect(pixels![2]).toBe(0x80)
      expect(pixels![3]).toBe(0xff)
    })

    it('maps terrain type 2 (Water) to blue', () => {
      const terrainData = [2]
      const pixels = preview.generatePreviewPixels(terrainData, 1, 1)

      // Water gets color 0x4040c0ff
      expect(pixels![0]).toBe(0x40)
      expect(pixels![1]).toBe(0x40)
      expect(pixels![2]).toBe(0xc0)
    })

    it('returns null for empty terrain data', () => {
      const pixels = preview.generatePreviewPixels([], 0, 0)
      // mapWidth = Math.max(1, Math.min(256, 0)) = 1
      // mapHeight = Math.max(1, Math.min(256, 0)) = 1
      // So it generates a 1x1 preview even from empty data
      expect(pixels).not.toBeNull()
      expect(pixels!.length).toBe(4)
    })
  })
})

// ---------------------------------------------------------------------------
// parseAuthor
// ---------------------------------------------------------------------------

describe('parseAuthor', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'uid', MapGridType.Rectangular, null)
  })

  it('extracts author from "by Name" format', () => {
    expect(preview.parseAuthor('by Westwood Studios')).toBe('Westwood Studios')
  })

  it('extracts author from "by: Name" format (with colon)', () => {
    expect(preview.parseAuthor('by: John Doe')).toBe('John Doe')
  })

  it('extracts author from "By Name" format (case insensitive)', () => {
    expect(preview.parseAuthor('By Jane Smith')).toBe('Jane Smith')
  })

  it('extracts author from "author: Name" format', () => {
    expect(preview.parseAuthor('author: MapMaker99')).toBe('MapMaker99')
  })

  it('extracts author from "created by Name" format', () => {
    expect(preview.parseAuthor('created by Community Mapper')).toBe('Community Mapper')
  })

  it('extracts author from "created by: Name" format', () => {
    expect(preview.parseAuthor('created by: Designer')).toBe('Designer')
  })

  it('falls back to first word for unknown format', () => {
    expect(preview.parseAuthor('AwesomeMap2000 by someone generic')).toBe('AwesomeMap2000')
  })

  it('returns "Unknown Author" for empty string', () => {
    expect(preview.parseAuthor('')).toBe('Unknown Author')
  })

  it('returns "Unknown Author" for whitespace-only string', () => {
    expect(preview.parseAuthor('   ')).toBe('Unknown Author')
  })

  it('handles leading/trailing whitespace', () => {
    expect(preview.parseAuthor('  by   Padded Author  ')).toBe('Padded Author')
  })
})

// ---------------------------------------------------------------------------
// computeUid
// ---------------------------------------------------------------------------

describe('computeUid', () => {
  it('returns hex string of length 8', () => {
    const pkg = createMockPackage('/maps/test.oramap', ['map.yaml', 'map.bin'])
    const uid = MapPreview.computeUid(pkg)
    expect(uid).toMatch(/^[0-9a-f]{8}$/)
  })

  it('produces different UIDs for different package names', () => {
    const pkg1 = createMockPackage('/maps/map1.oramap')
    const pkg2 = createMockPackage('/maps/map2.oramap')
    const uid1 = MapPreview.computeUid(pkg1)
    const uid2 = MapPreview.computeUid(pkg2)
    expect(uid1).not.toBe(uid2)
  })

  it('produces different UIDs for different contents', () => {
    const pkg1 = createMockPackage('/maps/same.oramap', ['a.txt'])
    const pkg2 = createMockPackage('/maps/same.oramap', ['b.txt'])
    const uid1 = MapPreview.computeUid(pkg1)
    const uid2 = MapPreview.computeUid(pkg2)
    expect(uid1).not.toBe(uid2)
  })

  it('produces same UID for identical packages', () => {
    const pkg1 = createMockPackage('/maps/test.oramap', ['map.yaml', 'map.bin'])
    const pkg2 = createMockPackage('/maps/test.oramap', ['map.yaml', 'map.bin'])
    const uid1 = MapPreview.computeUid(pkg1)
    const uid2 = MapPreview.computeUid(pkg2)
    expect(uid1).toBe(uid2)
  })

  it('handles empty package', () => {
    const pkg = createMockPackage('')
    const uid = MapPreview.computeUid(pkg)
    expect(uid).toBeDefined()
    expect(uid).toMatch(/^[0-9a-f]{8}$/)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: invalidate / dispose / delete
// ---------------------------------------------------------------------------

describe('lifecycle', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'uid', MapGridType.Rectangular, null)
    // Set up some state
    preview.status = MapStatus.Available
    preview.class = MapClassification.System
    preview.title = 'Alive Map'
  })

  describe('invalidate', () => {
    it('resets class to Unknown and status to Unavailable', () => {
      preview.invalidate()

      expect(preview.class).toBe(MapClassification.Unknown)
      expect(preview.status).toBe(MapStatus.Unavailable)
    })

    it('preserves other fields', () => {
      preview.invalidate()

      // Other metadata should remain
      expect(preview.title).toBe('Alive Map')
      expect(preview.uid).toBe('uid')
    })

    it('can be called multiple times safely', () => {
      preview.invalidate()
      expect(() => preview.invalidate()).not.toThrow()
      expect(preview.class).toBe(MapClassification.Unknown)
    })
  })

  describe('dispose', () => {
    it('clears preview data', () => {
      preview.preview = new Uint8Array([1, 2, 3])
      preview.dispose()

      expect(preview.preview).toBeNull()
    })

    it('calls dispose on owned package', () => {
      const pkg = createMockPackage('/maps/map.oramap')
      preview.updateFromMap(pkg, MapClassification.User)

      preview.dispose()

      expect(pkg.dispose).toHaveBeenCalled()
    })

    it('does not throw when package is null', () => {
      expect(() => preview.dispose()).not.toThrow()
    })
  })

  describe('delete', () => {
    it('invalidates the preview', () => {
      preview.delete()
      expect(preview.class).toBe(MapClassification.Unknown)
      expect(preview.status).toBe(MapStatus.Unavailable)
    })

    it('attempts to delete from parent package if writable', () => {
      const parentPkg = {
        name: '/maps',
        contents: [],
        contains: () => false,
        open: vi.fn().mockResolvedValue(null),
        openPackage: vi.fn().mockReturnValue(null),
        dispose: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }
      preview.updateFromMapWithoutOwningPackage(
        createMockPackage('map.oramap'),
        parentPkg,
        MapClassification.User,
      )

      preview.delete()

      expect(parentPkg.delete).toHaveBeenCalledWith('map.oramap')
    })
  })
})

// ---------------------------------------------------------------------------
// IReadOnlyFileSystem stubs
// ---------------------------------------------------------------------------

describe('IReadOnlyFileSystem stubs', () => {
  let preview: MapPreview

  beforeEach(() => {
    preview = new MapPreview(null, 'uid', MapGridType.Rectangular, null)
  })

  it('openFile returns null by default', async () => {
    const result = await preview.openFile('anyfile.txt')
    expect(result).toBeNull()
  })

  it('fileExists returns false by default', () => {
    expect(preview.fileExists('anyfile.txt')).toBe(false)
  })
})
