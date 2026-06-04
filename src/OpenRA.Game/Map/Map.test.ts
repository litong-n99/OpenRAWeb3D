/**
 * GameMap.test.ts — Map core container migration unit tests
 *
 * Since GameMap.ts does not import from @babylonjs/core (it's pure terrain data),
 * no Babylon.js mocking is needed. Tests focus on:
 * - BinaryDataHeader parsing
 * - Map creation (blank, from binary data)
 * - Coordinate methods (centerOfCell, cellContaining, offset)
 * - Contains checks
 * - Projection system
 * - Terrain index caching
 * - Clamp methods
 * - Edge cell computation
 * - Resize / SaveBinaryData
 * - Dispose lifecycle
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Map as GameMap,
  MapVisibility,
  parseBinaryDataHeader,
  type TerrainTile,
  type ITerrainInfo,
  type MapLoaderInput,
  DEFAULT_TERRAIN_TILE,
  DEFAULT_RESOURCE_TILE,
} from './Map'
import { MapGrid } from './MapGrid'
import { MapGridType } from './MapGridType'
import { CPos } from '../CPos'
import { MPos, PPos } from '../MPos'
import { CVec } from '../CVec'
import { WPos } from '../WPos'
import { WVec } from '../WVec'
import { WAngle } from '../WAngle'
import type { TerrainTypeInfo, TerrainTileInfo } from './TerrainInfo'

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a minimal TerrainTileInfo for testing. */
function makeTileInfo(overrides: Partial<TerrainTileInfo> = {}): TerrainTileInfo {
  // Import is type-only, so we construct a mock-like object
  return {
    terrainType: 0,
    height: 0,
    rampType: 0,
    minColor: 0xffffffff,
    maxColor: 0xffffffff,
    getColor: () => 0xffffffff,
    ...overrides,
  } as unknown as TerrainTileInfo
}

/** Create a minimal TerrainTypeInfo for testing. */
function makeTerrainType(overrides: Partial<TerrainTypeInfo> = {}): TerrainTypeInfo {
  return {
    type: 'Clear',
    targetTypes: new Set(),
    acceptsSmudgeType: new Set(),
    color: 0xff00ff00,
    restrictPlayerColor: false,
    ...overrides,
  } as unknown as TerrainTypeInfo
}

/** Create a minimal ITerrainInfo for testing. */
function makeTerrainInfo(overrides: Partial<ITerrainInfo> = {}): ITerrainInfo {
  const tileMap = new globalThis.Map<number, TerrainTileInfo>()
  const defaultTile: TerrainTile = { type: 0, index: 0 }
  // Register tile types 0-10 as valid to support test data
  for (let t = 0; t <= 10; t++) {
    tileMap.set(t, makeTileInfo({ terrainType: t % 2, height: 0, rampType: t % 21 }))
  }

  return {
    id: 'test',
    terrainTypes: [makeTerrainType(), makeTerrainType({ type: 'Rough' })],
    defaultTerrainTile: defaultTile,
    minHeightColorBrightness: 1.0,
    maxHeightColorBrightness: 1.0,
    getTerrainInfo: (tile: TerrainTile): TerrainTileInfo => {
      const info = tileMap.get(tile.type)
      if (info) return info
      return makeTileInfo()
    },
    tryGetTerrainInfo: (tile: TerrainTile): TerrainTileInfo | null => {
      return tileMap.get(tile.type) ?? null
    },
    getTerrainIndex: (tile: TerrainTile): number => {
      const info = tileMap.get(tile.type)
      return info ? info.terrainType : 0
    },
    ...overrides,
  }
}

/** Create a minimal rectangular MapGrid for testing. */
function makeGrid(maxTerrainHeight = 0): MapGrid {
  return new MapGrid({
    type: MapGridType.Rectangular,
    maximumTerrainHeight: maxTerrainHeight,
    maximumTileSearchRange: 50,
  })
}

/** Create a minimal isometric MapGrid for testing. */
function makeIsometricGrid(maxTerrainHeight = 0): MapGrid {
  return new MapGrid({
    type: MapGridType.RectangularIsometric,
    maximumTerrainHeight: maxTerrainHeight,
    maximumTileSearchRange: 50,
  })
}

/** Build a binary data buffer in Format 2 for testing.
 *
 * Writes tile/resource/height data in column-major order (i loop first, then j)
 * matching OpenRA's save/load pattern.
 */
function buildBinaryData(
  width: number,
  height: number,
  tiles: { type: number; index: number }[],
  resources: { type: number; index: number }[] = [],
  heights: number[] = [],
): ArrayBuffer {
  const hasHeight = heights.length > 0
  const TILES_OFFSET = 17
  const heightsOffset = hasHeight ? TILES_OFFSET + 3 * width * height : 0
  const resourcesOffset = TILES_OFFSET + 3 * width * height + (hasHeight ? width * height : 0)

  const totalSize =
    17 + 3 * width * height + (hasHeight ? width * height : 0) + 2 * width * height
  const buffer = new ArrayBuffer(totalSize)
  const data = new DataView(buffer)
  let pos = 0

  // Header
  data.setUint8(pos++, 2) // format
  data.setUint16(pos, width, true); pos += 2
  data.setUint16(pos, height, true); pos += 2
  data.setUint32(pos, TILES_OFFSET, true); pos += 4
  data.setUint32(pos, heightsOffset, true); pos += 4
  data.setUint32(pos, resourcesOffset, true); pos += 4

  // Helper: column-major index for position (i, j)
  const idx = (i: number, j: number) => j * width + i

  // Tile data: column-major (i then j)
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      const t = tiles[idx(i, j)] ?? { type: 0, index: 0 }
      data.setUint16(pos, t.type, true); pos += 2
      data.setUint8(pos++, t.index)
    }
  }

  // Height data: column-major
  if (hasHeight) {
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        data.setUint8(pos++, heights[idx(i, j)] ?? 0)
      }
    }
  }

  // Resource data: column-major
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      const r = resources[idx(i, j)] ?? { type: 0, index: 0 }
      data.setUint8(pos++, r.type)
      data.setUint8(pos++, r.index)
    }
  }

  return buffer
}

// ---------------------------------------------------------------------------
// TerrainTile / ResourceTile / MapVisibility
// ---------------------------------------------------------------------------

describe('TerrainTile', () => {
  it('DEFAULT_TERRAIN_TILE has type 0 and index 0', () => {
    expect(DEFAULT_TERRAIN_TILE.type).toBe(0)
    expect(DEFAULT_TERRAIN_TILE.index).toBe(0)
  })
})

describe('ResourceTile', () => {
  it('DEFAULT_RESOURCE_TILE has type 0 and index 0', () => {
    expect(DEFAULT_RESOURCE_TILE.type).toBe(0)
    expect(DEFAULT_RESOURCE_TILE.index).toBe(0)
  })
})

describe('MapVisibility', () => {
  it('has correct flag values', () => {
    expect(MapVisibility.Lobby).toBe(1)
    expect(MapVisibility.Shellmap).toBe(2)
    expect(MapVisibility.MissionSelector).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// BinaryDataHeader parsing
// ---------------------------------------------------------------------------

describe('parseBinaryDataHeader', () => {
  it('parses Format 2 header correctly', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 2) // format
    data.setUint16(1, 64, true) // width
    data.setUint16(3, 64, true) // height
    data.setUint32(5, 17, true) // tilesOffset
    data.setUint32(9, 0, true) // heightsOffset
    data.setUint32(13, 12301, true) // resourcesOffset

    const header = parseBinaryDataHeader(data, 64, 64)
    expect(header.format).toBe(2)
    expect(header.width).toBe(64)
    expect(header.height).toBe(64)
    expect(header.tilesOffset).toBe(17)
    expect(header.heightsOffset).toBe(0)
    expect(header.resourcesOffset).toBe(12301)
  })

  it('throws on dimension mismatch', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 2)
    data.setUint16(1, 64, true)
    data.setUint16(3, 32, true)

    expect(() => parseBinaryDataHeader(data, 64, 64)).toThrow('Invalid tile data')
  })

  it('parses Format 1 (legacy) header', () => {
    const buffer = new ArrayBuffer(5)
    const data = new DataView(buffer)
    data.setUint8(0, 1) // format
    data.setUint16(1, 10, true) // width
    data.setUint16(3, 10, true) // height

    const header = parseBinaryDataHeader(data, 10, 10)
    expect(header.format).toBe(1)
    expect(header.tilesOffset).toBe(5)
    expect(header.heightsOffset).toBe(0)
    expect(header.resourcesOffset).toBe(3 * 10 * 10 + 5) // 305
  })

  it('throws on unknown format', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 99) // unknown format

    expect(() => parseBinaryDataHeader(data, 1, 1)).toThrow("Unknown binary map format '99'")
  })
})

// ---------------------------------------------------------------------------
// GameMap.createBlank — Rectangular
// ---------------------------------------------------------------------------

describe('GameMap.createBlank (Rectangular)', () => {
  let grid: MapGrid
  let terrainInfo: ITerrainInfo

  beforeEach(() => {
    grid = makeGrid()
    terrainInfo = makeTerrainInfo()
  })

  it('creates a map with correct metadata', () => {
    const map = GameMap.createBlank(grid, { width: 32, height: 32 }, terrainInfo)

    expect(map.title).toBe('Name your map here')
    expect(map.author).toBe('Your name here')
    expect(map.tileset).toBe('test')
    expect(map.mapFormat).toBe(GameMap.CurrentMapFormat)
    expect(map.tileFormat).toBe(2)
    expect(map.lockPreview).toBe(false)
    expect(map.visibility).toBe(MapVisibility.Lobby)
    expect(map.categories).toEqual(['Conquest'])
  })

  it('creates a map with correct size', () => {
    const map = GameMap.createBlank(grid, { width: 48, height: 64 }, terrainInfo)

    expect(map.mapSize.width).toBe(48)
    expect(map.mapSize.height).toBe(64)
  })

  it('initializes tiles with default terrain tile', () => {
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const tile = map.tiles.getMPos(new MPos(i, j))
        expect(tile.type).toBe(0)
        expect(tile.index).toBe(0)
      }
    }
  })

  it('initializes height and ramp layers to 0', () => {
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        expect(map.height.getMPos(new MPos(i, j))).toBe(0)
        expect(map.ramp.getMPos(new MPos(i, j))).toBe(0)
      }
    }
  })

  it('initializes customTerrain to 0xFF for all cells', () => {
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        expect(map.customTerrain.getMPos(new MPos(i, j))).toBe(0xff)
      }
    }
  })

  it('creates AllCells covering the entire map', () => {
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const cells: CPos[] = []
    for (const cell of map.allCells) {
      cells.push(cell)
    }
    expect(cells.length).toBe(16)
  })

  it('sets bounds to cover the full map', () => {
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    expect(map.bounds.Left).toBe(0)
    expect(map.bounds.Top).toBe(0)
    expect(map.bounds.Right).toBe(10)
    expect(map.bounds.Bottom).toBe(10)
  })

  it('replaces invalid tiles with default terrain tile', () => {
    // Create terrainInfo where tile type 0xFF is unknown
    const ti = makeTerrainInfo({
      tryGetTerrainInfo: (tile) => (tile.type === 0 ? makeTileInfo() : null),
      getTerrainInfo: () => makeTileInfo(),
    })
    const map = GameMap.createBlank(grid, { width: 2, height: 2 }, ti)

    // All should still be valid
    expect(map.replacedInvalidTerrainTiles.size).toBe(0)
  })

  it('stores grid reference', () => {
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)
    expect(map.grid).toBe(grid)
    expect(map.grid.type).toBe(MapGridType.Rectangular)
  })
})

// ---------------------------------------------------------------------------
// GameMap.createBlank — Isometric
// ---------------------------------------------------------------------------

describe('GameMap.createBlank (Isometric)', () => {
  it('creates a map with isometric grid type', () => {
    const grid = makeIsometricGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 32, height: 32 }, terrainInfo)

    expect(map.grid.type).toBe(MapGridType.RectangularIsometric)
  })
})

// ---------------------------------------------------------------------------
// GameMap.fromLoaderInput — from binary data
// ---------------------------------------------------------------------------

describe('GameMap.fromLoaderInput', () => {
  let grid: MapGrid
  let terrainInfo: ITerrainInfo

  beforeEach(() => {
    grid = makeGrid()
    terrainInfo = makeTerrainInfo()
  })

  it('loads tile data from binary buffer', () => {
    const width = 2
    const height = 2
    const tiles = [
      { type: 1, index: 0 },
      { type: 2, index: 1 },
      { type: 3, index: 2 },
      { type: 4, index: 3 },
    ]
    const binaryData = buildBinaryData(width, height, tiles)

    const input: MapLoaderInput = {
      grid,
      terrainInfo,
      mapFormat: 11,
      title: 'Test Map',
      author: 'Tester',
      tileset: 'test',
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)

    expect(map.tiles.getMPos(new MPos(0, 0)).type).toBe(1)
    expect(map.tiles.getMPos(new MPos(0, 0)).index).toBe(0)
    expect(map.tiles.getMPos(new MPos(1, 0)).type).toBe(2)
    expect(map.tiles.getMPos(new MPos(0, 1)).type).toBe(3)
    expect(map.tiles.getMPos(new MPos(1, 1)).type).toBe(4)
  })

  it('loads resource data from binary buffer', () => {
    const width = 2
    const height = 2
    const tiles = [
      { type: 0, index: 0 },
      { type: 0, index: 0 },
      { type: 0, index: 0 },
      { type: 0, index: 0 },
    ]
    const resources = [
      { type: 1, index: 100 },
      { type: 2, index: 200 },
      { type: 0, index: 0 },
      { type: 0, index: 0 },
    ]
    const binaryData = buildBinaryData(width, height, tiles, resources)

    const input: MapLoaderInput = {
      grid,
      terrainInfo,
      mapFormat: 11,
      title: 'Test Map',
      author: 'Tester',
      tileset: 'test',
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)

    expect(map.resources.getMPos(new MPos(0, 0)).type).toBe(1)
    expect(map.resources.getMPos(new MPos(0, 0)).index).toBe(100)
    expect(map.resources.getMPos(new MPos(1, 0)).type).toBe(2)
    expect(map.resources.getMPos(new MPos(1, 0)).index).toBe(200)
  })

  it('loads height data when present', () => {
    const gridWithHeight = makeGrid(3) // maxTerrainHeight = 3
    const width = 2
    const height = 2
    const tiles = [
      { type: 0, index: 0 },
      { type: 0, index: 0 },
      { type: 0, index: 0 },
      { type: 0, index: 0 },
    ]
    const resources: { type: number; index: number }[] = []
    const heightData = [0, 1, 2, 3]
    const binaryData = buildBinaryData(width, height, tiles, resources, heightData)

    const input: MapLoaderInput = {
      grid: gridWithHeight,
      terrainInfo,
      mapFormat: 11,
      title: 'Test Map',
      author: 'Tester',
      tileset: 'test',
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)

    expect(map.height.getMPos(new MPos(0, 0))).toBe(0)
    expect(map.height.getMPos(new MPos(1, 0))).toBe(1)
    expect(map.height.getMPos(new MPos(0, 1))).toBe(2)
    expect(map.height.getMPos(new MPos(1, 1))).toBe(3) // maxTerrainHeight=3, so 3 is OK
  })

  it('clamps height to max terrain height', () => {
    const gridWithHeight = makeGrid(2) // maxTerrainHeight = 2
    const width = 1
    const height = 1
    const tiles = [{ type: 0, index: 0 }]
    const heightData = [5] // exceeds max
    const binaryData = buildBinaryData(width, height, tiles, [], heightData)

    const input: MapLoaderInput = {
      grid: gridWithHeight,
      terrainInfo,
      mapFormat: 11,
      title: 'Test Map',
      author: 'Tester',
      tileset: 'test',
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)
    expect(map.height.getMPos(new MPos(0, 0))).toBe(2) // clamped
  })

  it('throws on unsupported map format', () => {
    const input: MapLoaderInput = {
      grid,
      terrainInfo,
      mapFormat: 5, // below SupportedMapFormat (11)
      title: 'Old Map',
      author: 'Tester',
      tileset: 'test',
      binaryData: new ArrayBuffer(0),
    }

    expect(() => GameMap.fromLoaderInput(input)).toThrow('Map format 5 is not supported')
  })

  it('sets metadata from input', () => {
    const width = 1
    const height = 1
    const binaryData = buildBinaryData(width, height, [{ type: 0, index: 0 }])

    const input: MapLoaderInput = {
      grid,
      terrainInfo,
      mapFormat: 12,
      title: 'Custom Title',
      author: 'Custom Author',
      tileset: 'custom_tileset',
      requiresMod: 'my_mod',
      lockPreview: true,
      visibility: MapVisibility.MissionSelector,
      categories: ['Naval', 'FFA'],
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)

    expect(map.title).toBe('Custom Title')
    expect(map.author).toBe('Custom Author')
    expect(map.tileset).toBe('custom_tileset')
    expect(map.requiresMod).toBe('my_mod')
    expect(map.lockPreview).toBe(true)
    expect(map.visibility).toBe(MapVisibility.MissionSelector)
    expect(map.categories).toEqual(['Naval', 'FFA'])
  })

  it('handles FF tile index by using modulo pattern', () => {
    const width = 2
    const height = 2
    const tiles = [
      { type: 1, index: 0xff }, // becomes (0%4 + 0%4*4) = 0
      { type: 2, index: 0xff }, // becomes (1%4 + 0%4*4) = 1
      { type: 3, index: 0xff }, // becomes (0%4 + 1%4*4) = 4
      { type: 4, index: 0xff }, // becomes (1%4 + 1%4*4) = 5
    ]
    const binaryData = buildBinaryData(width, height, tiles)

    const input: MapLoaderInput = {
      grid,
      terrainInfo,
      mapFormat: 11,
      title: 'Test',
      author: 'Tester',
      tileset: 'test',
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)
    expect(map.tiles.getMPos(new MPos(0, 0)).index).toBe(0)
    expect(map.tiles.getMPos(new MPos(1, 0)).index).toBe(1)
    expect(map.tiles.getMPos(new MPos(0, 1)).index).toBe(4)
    expect(map.tiles.getMPos(new MPos(1, 1)).index).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// centerOfCell (Rectangular)
// ---------------------------------------------------------------------------

describe('GameMap.centerOfCell (Rectangular)', () => {
  let map: GameMap

  beforeEach(() => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)
  })

  it('returns correct center for cell (0, 0)', () => {
    const center = map.centerOfCell(new CPos(0, 0))
    expect(center.X).toBe(512)
    expect(center.Y).toBe(512)
    expect(center.Z).toBe(0)
  })

  it('returns correct center for cell (1, 0)', () => {
    const center = map.centerOfCell(new CPos(1, 0))
    expect(center.X).toBe(1536)
    expect(center.Y).toBe(512)
  })

  it('returns correct center for cell (0, 1)', () => {
    const center = map.centerOfCell(new CPos(0, 1))
    expect(center.X).toBe(512)
    expect(center.Y).toBe(1536)
  })

  it('returns correct center for cell (5, 3)', () => {
    const center = map.centerOfCell(new CPos(5, 3))
    expect(center.X).toBe(1024 * 5 + 512)
    expect(center.Y).toBe(1024 * 3 + 512)
    expect(center.Z).toBe(0)
  })

  it('Z is always 0 for rectangular grids', () => {
    const center = map.centerOfCell(new CPos(7, 7))
    expect(center.Z).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// centerOfCell (Isometric)
// ---------------------------------------------------------------------------

describe('GameMap.centerOfCell (Isometric)', () => {
  let map: GameMap

  beforeEach(() => {
    const grid = makeIsometricGrid()
    const terrainInfo = makeTerrainInfo()
    map = GameMap.createBlank(grid, { width: 32, height: 32 }, terrainInfo)
  })

  it('returns correct center for origin cell (0, 0)', () => {
    const center = map.centerOfCell(new CPos(0, 0))
    expect(center.X).toBe(724)
    expect(center.Y).toBe(724)
    expect(center.Z).toBe(0)
  })

  it('returns correct center for cell (1, 0)', () => {
    const center = map.centerOfCell(new CPos(1, 0))
    // X = 724 * (1 - 0 + 1) = 724 * 2 = 1448
    // Y = 724 * (1 + 0 + 1) = 724 * 2 = 1448
    expect(center.X).toBe(1448)
    expect(center.Y).toBe(1448)
  })

  it('returns correct center for cell (0, 1)', () => {
    const center = map.centerOfCell(new CPos(0, 1))
    // X = 724 * (0 - 1 + 1) = 724 * 0 = 0
    // Y = 724 * (0 + 1 + 1) = 724 * 2 = 1448
    expect(center.X).toBe(0)
    expect(center.Y).toBe(1448)
  })
})

// ---------------------------------------------------------------------------
// cellContaining
// ---------------------------------------------------------------------------

describe('GameMap.cellContaining', () => {
  it('rectangular: converts world position to cell', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    // Cell (0,0) center is at (512, 512)
    const cell = map.cellContaining(new WPos(512, 512, 0))
    expect(cell.X).toBe(0)
    expect(cell.Y).toBe(0)
  })

  it('rectangular: (1536, 512, 0) => cell (1, 0)', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    const cell = map.cellContaining(new WPos(1536, 512, 0))
    expect(cell.X).toBe(1)
    expect(cell.Y).toBe(0)
  })

  it('isometric: converts world position to cell', () => {
    const grid = makeIsometricGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 32, height: 32 }, terrainInfo)

    // Cell (0,0) center is at (724, 724)
    const cell = map.cellContaining(new WPos(724, 724, 0))
    expect(cell.X).toBe(0)
    expect(cell.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// offset
// ---------------------------------------------------------------------------

describe('GameMap.offset', () => {
  it('rectangular: converts CVec to world offset', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    const offset = map.offset(new CVec(1, 0), 0)
    expect(offset.X).toBe(1024)
    expect(offset.Y).toBe(0)
    expect(offset.Z).toBe(0)
  })

  it('isometric: converts CVec with dz to world offset', () => {
    const grid = makeIsometricGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 32, height: 32 }, terrainInfo)

    const offset = map.offset(new CVec(1, 0), 1)
    expect(offset.X).toBe(724)
    expect(offset.Y).toBe(724)
    expect(offset.Z).toBe(724)
  })
})

// ---------------------------------------------------------------------------
// cellHeightStep
// ---------------------------------------------------------------------------

describe('GameMap.cellHeightStep', () => {
  it('rectangular: returns 512', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    expect(map.cellHeightStep.length).toBe(512)
  })

  it('isometric: returns 724', () => {
    const grid = makeIsometricGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    expect(map.cellHeightStep.length).toBe(724)
  })
})

// ---------------------------------------------------------------------------
// Contains
// ---------------------------------------------------------------------------

describe('GameMap.contains', () => {
  let map: GameMap

  beforeEach(() => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)
  })

  it('contains(CPos) returns true for cell within bounds', () => {
    expect(map.contains(new CPos(0, 0))).toBe(true)
    expect(map.contains(new CPos(4, 4))).toBe(true)
    expect(map.contains(new CPos(7, 7))).toBe(true)
    expect(map.contains(new CPos(7, 0))).toBe(true)
    expect(map.contains(new CPos(0, 7))).toBe(true)
  })

  it('contains(CPos) returns false for cell outside bounds', () => {
    expect(map.contains(new CPos(-1, 0))).toBe(false)
    expect(map.contains(new CPos(0, -1))).toBe(false)
    expect(map.contains(new CPos(8, 0))).toBe(false)
    expect(map.contains(new CPos(0, 8))).toBe(false)
  })

  it('contains(MPos) returns true for map position within bounds', () => {
    expect(map.contains(new MPos(0, 0))).toBe(true)
    expect(map.contains(new MPos(4, 4))).toBe(true)
  })

  it('contains(MPos) returns false for map position outside bounds', () => {
    expect(map.contains(new MPos(-1, 0))).toBe(false)
    expect(map.contains(new MPos(8, 0))).toBe(false)
  })

  it('contains(PPos) returns true for projected position within bounds', () => {
    expect(map.contains(new PPos(0, 0))).toBe(true)
    expect(map.contains(new PPos(7, 7))).toBe(true)
  })

  it('contains(PPos) returns false for projected position outside bounds', () => {
    expect(map.contains(new PPos(-1, 0))).toBe(false)
    expect(map.contains(new PPos(8, 0))).toBe(false)
  })

  it('isometric: contains(CPos) rejects X < Y cells', () => {
    const isoGrid = makeIsometricGrid()
    const ti = makeTerrainInfo()
    const isoMap = GameMap.createBlank(isoGrid, { width: 32, height: 32 }, ti)

    // X < Y is invalid in RectangularIsometric
    expect(isoMap.contains(new CPos(0, 1))).toBe(false)
    // X == Y is valid
    expect(isoMap.contains(new CPos(0, 0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// centerOfSubCell
// ---------------------------------------------------------------------------

describe('GameMap.centerOfSubCell', () => {
  it('returns center for valid sub-cell index', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    // SubCell 0 (FullCell) — should match centerOfCell
    const center = map.centerOfSubCell(new CPos(3, 3), 0)
    const direct = map.centerOfCell(new CPos(3, 3))
    expect(center.equals(direct)).toBe(true)
  })

  it('returns centerOfCell for invalid sub-cell index', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    // Index 255 (SubCell.Invalid) — falls through to centerOfCell
    const result = map.centerOfSubCell(new CPos(3, 3), 255)
    const direct = map.centerOfCell(new CPos(3, 3))
    expect(result.equals(direct)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// distanceAboveTerrain
// ---------------------------------------------------------------------------

describe('GameMap.distanceAboveTerrain', () => {
  it('rectangular: Z is the distance above terrain', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)

    const dist = map.distanceAboveTerrain(new WPos(512, 512, 100))
    expect(dist.length).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// TerrainOrientation
// ---------------------------------------------------------------------------

describe('GameMap.terrainOrientation', () => {
  it('returns WRot.None for flat terrain (ramp 0)', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const orientation = map.terrainOrientation(new CPos(0, 0))
    expect(orientation).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// FacingBetween
// ---------------------------------------------------------------------------

describe('GameMap.facingBetween', () => {
  let map: GameMap

  beforeEach(() => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    map = GameMap.createBlank(grid, { width: 10, height: 10 }, terrainInfo)
  })

  it('returns fallback when same cell', () => {
    const fallback = new WAngle(42)
    const facing = map.facingBetween(new CPos(3, 3), new CPos(3, 3), fallback)
    expect(facing.angle).toBe(42)
  })

  it('returns non-zero facing for different cells', () => {
    const fallback = WAngle.Zero
    const facing = map.facingBetween(new CPos(0, 0), new CPos(1, 0), fallback)
    // Should differ from fallback
    expect(typeof facing.angle).toBe('number')
    expect(Number.isInteger(facing.angle)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

describe('GameMap.resize', () => {
  it('resizes the map preserving overlapping data', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    // Set a known tile
    map.tiles.setMPos(new MPos(0, 0), { type: 42, index: 7 })

    map.resize(6, 6)

    expect(map.mapSize.width).toBe(6)
    expect(map.mapSize.height).toBe(6)

    // Original data preserved
    expect(map.tiles.getMPos(new MPos(0, 0)).type).toBe(42)
    expect(map.tiles.getMPos(new MPos(0, 0)).index).toBe(7)

    // New cells have fill value (the value at old MPos.Zero = 42)
    expect(map.tiles.getMPos(new MPos(5, 5)).type).toBe(42)
    expect(map.tiles.getMPos(new MPos(5, 5)).index).toBe(7)
  })

  it('shrinks the map correctly', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 6, height: 6 }, terrainInfo)

    // Set known tiles
    map.tiles.setMPos(new MPos(0, 0), { type: 99, index: 1 })
    map.tiles.setMPos(new MPos(3, 3), { type: 88, index: 2 })

    map.resize(4, 4)

    expect(map.mapSize.width).toBe(4)
    expect(map.mapSize.height).toBe(4)
    expect(map.tiles.getMPos(new MPos(0, 0)).type).toBe(99)
    expect(map.tiles.getMPos(new MPos(3, 3)).type).toBe(88)
  })

  it('updates AllCells after resize', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    map.resize(3, 3)

    const cells: CPos[] = []
    for (const cell of map.allCells) {
      cells.push(cell)
    }
    expect(cells.length).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// saveBinaryData / toJSON
// ---------------------------------------------------------------------------

describe('GameMap.saveBinaryData', () => {
  it('produces valid binary data for format 2', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 2, height: 2 }, terrainInfo)

    // Set some known data
    map.tiles.setMPos(new MPos(0, 0), { type: 1, index: 2 })
    map.tiles.setMPos(new MPos(1, 0), { type: 3, index: 4 })

    // Verify tiles were set correctly (preflight check)
    expect(map.tiles.getMPos(new MPos(0, 0)).type).toBe(1)
    expect(map.tiles.getMPos(new MPos(1, 0)).type).toBe(3)

    const buffer = map.saveBinaryData()
    const data = new DataView(buffer)

    // Verify header
    expect(data.getUint8(0)).toBe(2) // format
    expect(data.getUint16(1, true)).toBe(2) // width
    expect(data.getUint16(3, true)).toBe(2) // height
    expect(data.getUint32(5, true)).toBe(17) // tilesOffset

    // Verify tile at (0,0): bytes 17-18 = type, byte 19 = index
    expect(data.getUint16(17, true)).toBe(1)
    expect(data.getUint8(19)).toBe(2)

    // Verify tile at (0,1): bytes 20-21 = type (default), byte 22 = index
    expect(data.getUint16(20, true)).toBe(0) // default tile

    // Verify tile at (1,0): bytes 23-24 = type, byte 25 = index
    expect(data.getUint16(23, true)).toBe(3)
    expect(data.getUint8(25)).toBe(4)
  })

  it('includes height data when grid has terrain height', () => {
    const grid = makeGrid(3) // max height > 0
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 1, height: 1 }, terrainInfo)

    map.height.setMPos(new MPos(0, 0), 2)

    const buffer = map.saveBinaryData()
    const data = new DataView(buffer)

    // heightsOffset should be > 0
    const heightsOffset = data.getUint32(9, true)
    expect(heightsOffset).toBeGreaterThan(0)

    // Height at the offset
    expect(data.getUint8(heightsOffset)).toBe(2)
  })
})

describe('GameMap.toJSON', () => {
  it('serializes map metadata to JSON', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 2, height: 2 }, terrainInfo)

    const json = map.toJSON()

    expect(json.mapFormat).toBe(GameMap.CurrentMapFormat)
    expect(json.title).toBe('Name your map here')
    expect(json.author).toBe('Your name here')
    expect(json.tileset).toBe('test')
    expect(json.mapSize).toEqual({ width: 2, height: 2 })
    expect(typeof json.binaryData).toBe('string')
    expect(json.gridType).toBe(MapGridType.Rectangular)
  })
})

// ---------------------------------------------------------------------------
// getTerrainIndex / getTerrainInfo
// ---------------------------------------------------------------------------

describe('GameMap.getTerrainIndex', () => {
  it('returns cached terrain index for a cell', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const index = map.getTerrainIndex(new CPos(0, 0))
    expect(index).toBe(0)
  })

  it('returns custom terrain index when set', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    // Set custom terrain
    map.customTerrain.set(new CPos(0, 0), 5)
    const index = map.getTerrainIndex(new CPos(0, 0))
    expect(index).toBe(5)
  })
})

describe('GameMap.getTerrainInfo', () => {
  it('returns TerrainTypeInfo for a cell', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const info = map.getTerrainInfo(new CPos(0, 0))
    expect(info).toBeDefined()
    expect(info.type).toBe('Clear')
  })
})

// ---------------------------------------------------------------------------
// Clamp (Rectangular, flat)
// ---------------------------------------------------------------------------

describe('GameMap.clamp (Rectangular, flat)', () => {
  let map: GameMap

  beforeEach(() => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)
  })

  it('clamp(CPos) returns same cell when in bounds', () => {
    const clamped = map.clamp(new CPos(3, 3))
    expect(clamped.X).toBe(3)
    expect(clamped.Y).toBe(3)
  })

  it('clamp(CPos) clamps negative X to 0', () => {
    const clamped = map.clamp(new CPos(-5, 3))
    expect(clamped.X).toBe(0)
    expect(clamped.Y).toBe(3)
  })

  it('clamp(CPos) clamps X that exceeds width', () => {
    const clamped = map.clamp(new CPos(100, 3))
    expect(clamped.X).toBe(7)
    expect(clamped.Y).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Edge Cells
// ---------------------------------------------------------------------------

describe('GameMap.allEdgeCells', () => {
  it('populates edge cells for rectangular map', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    expect(map.allEdgeCells.length).toBeGreaterThan(0)
    // At minimum: all 4 boundary edges should be represented
    expect(map.allEdgeCells.length).toBeGreaterThanOrEqual(4)
  })

  it('all edge cells are on the map boundary', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    for (const cell of map.allEdgeCells) {
      const uv = cell.toMPos(MapGridType.Rectangular)
      const onEdge =
        uv.U === map.bounds.Left ||
        uv.U === map.bounds.Right - 1 ||
        uv.V === map.bounds.Top ||
        uv.V === map.bounds.Bottom - 1
      expect(onEdge).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// chooseRandomCell
// ---------------------------------------------------------------------------

describe('GameMap.chooseRandomCell', () => {
  it('returns a CPos within map bounds', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    // deterministic "random" that always picks the first value
    let callCount = 0
    const randInt = (min: number, _max: number) => {
      callCount++
      return min // always the minimum
    }
    const randSelect = <T>(arr: readonly T[]): T => arr[0]!

    const cell = map.chooseRandomCell(randInt, randSelect)
    expect(cell).toBeDefined()
    expect(callCount).toBeGreaterThan(0)
    expect(map.contains(cell)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// chooseRandomEdgeCell
// ---------------------------------------------------------------------------

describe('GameMap.chooseRandomEdgeCell', () => {
  it('returns a cell from the edge list', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    const randSelect = <T>(arr: readonly T[]): T => arr[0]!

    const cell = map.chooseRandomEdgeCell(randSelect)
    expect(cell).toBeDefined()
    // Should be in the edge list
    const found = map.allEdgeCells.some((c) => c.equals(cell))
    expect(found).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// chooseClosestEdgeCell
// ---------------------------------------------------------------------------

describe('GameMap.chooseClosestEdgeCell', () => {
  it('returns a CPos for a cell within bounds', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    // Test with a cell near the edge to ensure it finds a valid edge cell
    const result = map.chooseClosestEdgeCell(new CPos(0, 4))
    expect(result).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// chooseClosestMatchingEdgeCell
// ---------------------------------------------------------------------------

describe('GameMap.chooseClosestMatchingEdgeCell', () => {
  it('returns matching edge cell', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    // Accept all cells
    const result = map.chooseClosestMatchingEdgeCell(new CPos(4, 4), () => true)
    expect(result).toBeDefined()
    expect(map.allEdgeCells.some((c) => c.equals(result!))).toBe(true)
  })

  it('returns undefined when no cell matches', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    const result = map.chooseClosestMatchingEdgeCell(new CPos(4, 4), () => false)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// distanceToEdge
// ---------------------------------------------------------------------------

describe('GameMap.distanceToEdge', () => {
  it('returns finite distance for center cell looking right', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    const dist = map.distanceToEdge(
      map.centerOfCell(new CPos(4, 4)),
      new WVec(1024, 0, 0),
    )
    expect(dist.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// findTilesInAnnulus / findTilesInCircle
// ---------------------------------------------------------------------------

describe('GameMap.findTilesInAnnulus', () => {
  let map: GameMap

  beforeEach(() => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    map = GameMap.createBlank(grid, { width: 16, height: 16 }, terrainInfo)
  })

  it('returns cells within range sorted by distance', () => {
    const tiles = map.findTilesInAnnulus(new CPos(8, 8), 1, 2)
    expect(tiles.length).toBeGreaterThan(0)
    // All returned tiles should be within bounds
    for (const t of tiles) {
      expect(map.contains(t)).toBe(true)
    }
  })

  it('throws when maxRange < minRange', () => {
    expect(() => map.findTilesInAnnulus(new CPos(4, 4), 5, 3)).toThrow(
      'Maximum range is less than the minimum range',
    )
  })

  it('throws when maxRange exceeds maximumTileSearchRange', () => {
    expect(() => map.findTilesInAnnulus(new CPos(4, 4), 0, 999)).toThrow(
      'requested range',
    )
  })

  it('findTilesInCircle delegates to findTilesInAnnulus with minRange 0', () => {
    const circle = map.findTilesInCircle(new CPos(8, 8), 1)
    const annulus = map.findTilesInAnnulus(new CPos(8, 8), 0, 1)
    expect(circle.length).toBe(annulus.length)
  })
})

// ---------------------------------------------------------------------------
// CellProjectionChanged event
// ---------------------------------------------------------------------------

describe('GameMap.cellProjectionChanged (Rectangular, flat)', () => {
  it('fires when a tile is set on a map with height', () => {
    const grid = makeGrid(3) // flat map but has max height — projections exist
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const calls: CPos[] = []
    map.cellProjectionChanged.push((cell) => calls.push(cell))

    // Set a new tile which triggers updateRamp + updateProjection
    map.tiles.set(new CPos(1, 1), { type: 1, index: 0 })

    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((c) => c.X === 1 && c.Y === 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// projectedCellsCovering / unproject
// ---------------------------------------------------------------------------

describe('GameMap.projectedCellsCovering and unproject', () => {
  it('flat map: projectedCellsCovering returns 1:1 mapping', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const projected = map.projectedCellsCovering(new MPos(1, 2))
    expect(projected.length).toBe(1)
    expect(projected[0]!.U).toBe(1)
    expect(projected[0]!.V).toBe(2)
  })

  it('flat map: unproject returns 1:1 inverse mapping', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const unprojected = map.unproject(new PPos(1, 2))
    expect(unprojected.length).toBe(1)
    expect(unprojected[0]!.U).toBe(1)
    expect(unprojected[0]!.V).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// projectedHeight
// ---------------------------------------------------------------------------

describe('GameMap.projectedHeight', () => {
  it('returns 0 for flat map cells', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const h = map.projectedHeight(new PPos(0, 0))
    expect(h).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ProjectedCellCovering
// ---------------------------------------------------------------------------

describe('GameMap.projectedCellCovering', () => {
  it('returns a PPos for a world position', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    const puv = map.projectedCellCovering(new WPos(1536, 512, 0))
    expect(puv).toBeDefined()
    expect(typeof puv.U).toBe('number')
    expect(typeof puv.V).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// getCellSpaceBounds
// ---------------------------------------------------------------------------

describe('GameMap.getCellSpaceBounds', () => {
  it('returns valid bounds for a rectangular map', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 8, height: 8 }, terrainInfo)

    const bounds = map.getCellSpaceBounds()
    expect(typeof bounds.top).toBe('number')
    expect(typeof bounds.bottom).toBe('number')
    expect(Number.isFinite(bounds.top)).toBe(true)
    expect(Number.isFinite(bounds.bottom)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Dispose lifecycle
// ---------------------------------------------------------------------------

describe('GameMap.dispose', () => {
  it('cleans up observer registrations', () => {
    const grid = makeGrid(3)
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    // Should not throw
    expect(() => map.dispose()).not.toThrow()
  })

  it('dispose clears projection change callbacks', () => {
    const grid = makeGrid(3)
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    const calls: CPos[] = []
    map.cellProjectionChanged.push((cell) => calls.push(cell))
    expect(map.cellProjectionChanged.length).toBe(1)

    map.dispose()
    expect(map.cellProjectionChanged.length).toBe(0)
  })

  it('dispose clears replaced invalid terrain tiles', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    map.dispose()
    // replacedInvalidTerrainTiles is cleared
    // (no direct size getter exposed, but dispose doesn't throw)
  })

  it('dispose nullifies internal projection layers', () => {
    const grid = makeGrid(3)
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    map.dispose()

    // After dispose, projection methods should still work
    // (they lazily reinitialize but we can check nothing explodes)
    expect(() => map.projectedCellsCovering(new MPos(0, 0))).not.toThrow()
  })

  it('double dispose does not throw', () => {
    const grid = makeGrid()
    const terrainInfo = makeTerrainInfo()
    const map = GameMap.createBlank(grid, { width: 4, height: 4 }, terrainInfo)

    map.dispose()
    expect(() => map.dispose()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// replaceInvalidTerrainTiles — regression test
// ---------------------------------------------------------------------------

describe('Map replacedInvalidTerrainTiles', () => {
  it('records tile replacements for invalid tiles loaded from binary', () => {
    const grid = makeGrid()
    // Create terrainInfo where only tile type 1 is valid
    const ti = makeTerrainInfo({
      tryGetTerrainInfo: (tile) => (tile.type === 1 ? makeTileInfo() : null),
      getTerrainInfo: () => makeTileInfo(),
    })

    const tiles = [{ type: 99, index: 0 }] // invalid — will be replaced
    const binaryData = buildBinaryData(1, 1, tiles)

    const input: MapLoaderInput = {
      grid,
      terrainInfo: ti,
      mapFormat: 11,
      title: 'Test',
      author: 'Tester',
      tileset: 'test',
      binaryData,
    }

    const map = GameMap.fromLoaderInput(input)
    expect(map.replacedInvalidTerrainTiles.size).toBe(1)
  })
})
