/**
 * TerrainInfo.test.ts — TerrainInfo unit tests
 *
 * Tests focus on:
 * - RiserConnection enum values match OpenRA
 * - parseColorHex for all supported formats
 * - colorToComponents and colorLerp correctness
 * - TerrainTypeInfo construction, defaults, static registry
 * - TerrainTileInfo.parseRiser: long form, short form, empty, error cases
 * - TerrainTileInfo construction, getRiserHeight, getColor
 * - TileTemplate interface structure
 * - TileSet fromJSON, lookups, duplicate detection, error paths
 * - makeTileKey, templateIdFromKey, tileIndexFromKey
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Constants
  RiserConnection,
  RISER_CONNECTION_COUNT,
  RISER_DEFAULT,

  // Color utilities
  parseColorHex,
  colorToComponents,
  colorLerp,

  // Tile key utilities
  makeTileKey,
  templateIdFromKey,
  tileIndexFromKey,

  // Classes
  TerrainTypeInfo,
  TerrainTileInfo,
  TileSet,
} from './TerrainInfo'

import type {
  TerrainTypeInfoJson,
  TileSetJson,
  TileTemplate,
} from './TerrainInfo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RiserConnection
// ---------------------------------------------------------------------------

describe('RiserConnection', () => {
  it('has exactly 8 values matching OpenRA', () => {
    expect(RiserConnection.UL).toBe(0)
    expect(RiserConnection.UR).toBe(1)
    expect(RiserConnection.RU).toBe(2)
    expect(RiserConnection.RD).toBe(3)
    expect(RiserConnection.DR).toBe(4)
    expect(RiserConnection.DL).toBe(5)
    expect(RiserConnection.LD).toBe(6)
    expect(RiserConnection.LU).toBe(7)
  })

  it('RISER_CONNECTION_COUNT is 8', () => {
    expect(RISER_CONNECTION_COUNT).toBe(8)
  })

  it('RISER_DEFAULT matches OpenRA byte.MaxValue as signed int8 (-1)', () => {
    expect(RISER_DEFAULT).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// parseColorHex
// ---------------------------------------------------------------------------

describe('parseColorHex', () => {
  it('parses 6-digit hex with implicit alpha=255', () => {
    expect(parseColorHex('FFDDB0')).toBe(0xFFFFDDB0)
  })

  it('parses 8-digit hex with explicit alpha', () => {
    expect(parseColorHex('80FF0000')).toBe(0x80FF0000)
  })

  it('parses black', () => {
    expect(parseColorHex('000000')).toBe(0xFF000000)
  })

  it('parses white', () => {
    expect(parseColorHex('FFFFFF')).toBe(0xFFFFFFFF)
  })

  it('strips leading #', () => {
    expect(parseColorHex('#FFDDB0')).toBe(0xFFFFDDB0)
  })

  it('throws on invalid hex string', () => {
    expect(() => parseColorHex('notahex')).toThrow()
  })

  it('throws on empty string', () => {
    expect(() => parseColorHex('')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// colorToComponents
// ---------------------------------------------------------------------------

describe('colorToComponents', () => {
  it('decomposes ARGB = 0xAARRGGBB', () => {
    const [a, r, g, b] = colorToComponents(0x80FFDDB0)
    expect(a).toBe(0x80)
    expect(r).toBe(0xFF)
    expect(g).toBe(0xDD)
    expect(b).toBe(0xB0)
  })

  it('decomposes opaque black', () => {
    expect(colorToComponents(0xFF000000)).toEqual([255, 0, 0, 0])
  })

  it('decomposes opaque white', () => {
    expect(colorToComponents(0xFFFFFFFF)).toEqual([255, 255, 255, 255])
  })

  it('decomposes fully transparent', () => {
    expect(colorToComponents(0x00000000)).toEqual([0, 0, 0, 0])
  })
})

// ---------------------------------------------------------------------------
// colorLerp
// ---------------------------------------------------------------------------

describe('colorLerp', () => {
  const black = 0xFF000000
  const white = 0xFFFFFFFF

  it('t=0 returns c1', () => {
    expect(colorLerp(0, black, white)).toBe(black)
  })

  it('t=1 returns c2', () => {
    expect(colorLerp(1, black, white)).toBe(white)
  })

  it('t=0.5 interpolates to midpoint', () => {
    const mid = colorLerp(0.5, black, white)
    const [a, r, g, b] = colorToComponents(mid)
    expect(a).toBe(255)
    expect(r).toBe(128)
    expect(g).toBe(128)
    expect(b).toBe(128)
  })

  it('interpolates between different alpha values', () => {
    const result = colorLerp(0.5, 0x00000000, 0xFFFF0000)
    const [a] = colorToComponents(result)
    // (0.5 * 255 + 0.5 * 0) rounded = 128
    expect(a).toBe(128)
  })

  it('rounds to nearest integer', () => {
    // 0.3 * 100 + 0.7 * 0 = 30, but with 255 it's different
    // t * 128 + (1-t) * 0 at t=0.3 → 38.4 → 38
    const c1 = 0xFF000000
    const c2 = 0xFF808080
    const result = colorLerp(0.3, c1, c2)
    const [, r] = colorToComponents(result)
    // 0.3 * 128 + 0.7 * 0 = 38.4 → 38
    expect(r).toBe(38)
  })
})

// ---------------------------------------------------------------------------
// makeTileKey / templateIdFromKey / tileIndexFromKey
// ---------------------------------------------------------------------------

describe('makeTileKey', () => {
  it('combines template ID and tile index', () => {
    const key = makeTileKey(255, 3)
    expect(templateIdFromKey(key)).toBe(255)
    expect(tileIndexFromKey(key)).toBe(3)
  })

  it('handles template ID 0', () => {
    const key = makeTileKey(0, 0)
    expect(templateIdFromKey(key)).toBe(0)
    expect(tileIndexFromKey(key)).toBe(0)
  })

  it('handles maximum values', () => {
    const key = makeTileKey(65535, 255)
    expect(templateIdFromKey(key)).toBe(65535)
    expect(tileIndexFromKey(key)).toBe(255)
  })

  it('masks template ID to 16 bits', () => {
    const key = makeTileKey(0x1FFFF, 5)
    // 0x1FFFF & 0xFFFF = 0xFFFF = 65535
    expect(templateIdFromKey(key)).toBe(65535)
  })

  it('masks tile index to 8 bits', () => {
    const key = makeTileKey(10, 0x1FF)
    // 0x1FF & 0xFF = 0xFF = 255
    expect(tileIndexFromKey(key)).toBe(255)
  })

  it('keys are unique for different template/tile combos', () => {
    const keys = new Set<number>()
    for (let tid = 0; tid < 256; tid++) {
      for (let ti = 0; ti < 256; ti++) {
        keys.add(makeTileKey(tid, ti))
      }
    }
    // Should be 65536 unique keys
    expect(keys.size).toBe(65536)
  })
})

// ---------------------------------------------------------------------------
// TerrainTypeInfo
// ---------------------------------------------------------------------------

describe('TerrainTypeInfo', () => {
  beforeEach(() => {
    TerrainTypeInfo.types.clear()
  })

  it('constructs from JSON with all fields', () => {
    const tt = new TerrainTypeInfo({
      type: 'Clear',
      targetTypes: ['Ground', 'Water'],
      acceptsSmudgeType: ['Scorch', 'Crater'],
      color: 'FFDDB0',
      restrictPlayerColor: true,
    })

    expect(tt.type).toBe('Clear')
    expect(tt.targetTypes.has('Ground')).toBe(true)
    expect(tt.targetTypes.has('Water')).toBe(true)
    expect(tt.targetTypes.size).toBe(2)
    expect(tt.acceptsSmudgeType.has('Scorch')).toBe(true)
    expect(tt.acceptsSmudgeType.has('Crater')).toBe(true)
    expect(tt.acceptsSmudgeType.size).toBe(2)
    expect(tt.color).toBe(0xFFFFDDB0)
    expect(tt.restrictPlayerColor).toBe(true)
  })

  it('uses defaults for optional fields', () => {
    const tt = new TerrainTypeInfo({ type: 'Clear', color: '000000' })

    expect(tt.targetTypes.size).toBe(0)
    expect(tt.acceptsSmudgeType.size).toBe(0)
    expect(tt.restrictPlayerColor).toBe(false)
  })

  it('has empty targetTypes set by default', () => {
    const tt = new TerrainTypeInfo({ type: 'Rough', color: '886600' })
    expect(tt.targetTypes).toBeInstanceOf(Set)
    expect(tt.targetTypes.size).toBe(0)
  })

  it('has empty acceptsSmudgeType set by default', () => {
    const tt = new TerrainTypeInfo({ type: 'Rough', color: '886600' })
    expect(tt.acceptsSmudgeType).toBeInstanceOf(Set)
    expect(tt.acceptsSmudgeType.size).toBe(0)
  })

  it('static .types registry is initially empty', () => {
    expect(TerrainTypeInfo.types.size).toBe(0)
  })

  it('static .byName returns undefined for missing type', () => {
    expect(TerrainTypeInfo.byName('Nonexistent')).toBeUndefined()
  })

  it('static .byName returns the registered type after adding', () => {
    const tt = new TerrainTypeInfo({ type: 'Clear', color: 'FFDDB0' })
    TerrainTypeInfo.types.set('Clear', tt)
    expect(TerrainTypeInfo.byName('Clear')).toBe(tt)
  })

  it('color parse supports 8-digit hex', () => {
    const tt = new TerrainTypeInfo({ type: 'Water', color: '800000FF' })
    expect(tt.color).toBe(0x800000FF)
  })

  it('fromJSON factory creates an equivalent instance', () => {
    const json: TerrainTypeInfoJson = {
      type: 'Clear',
      targetTypes: ['Ground'],
      acceptsSmudgeType: ['Scorch'],
      color: 'FFDDB0',
      restrictPlayerColor: true,
    }
    const fromCtor = new TerrainTypeInfo(json)
    const fromFactory = TerrainTypeInfo.fromJSON(json)

    expect(fromFactory.type).toBe(fromCtor.type)
    expect(fromFactory.color).toBe(fromCtor.color)
    expect(fromFactory.restrictPlayerColor).toBe(fromCtor.restrictPlayerColor)
    expect(fromFactory.targetTypes.has('Ground')).toBe(true)
    expect(fromFactory.acceptsSmudgeType.has('Scorch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TerrainTileInfo.parseRiser
// ---------------------------------------------------------------------------

describe('TerrainTileInfo.parseRiser', () => {
  it('empty string returns all RISER_DEFAULT', () => {
    const riser = TerrainTileInfo.parseRiser('')
    for (let i = 0; i < 8; i++) {
      expect(riser[i]).toBe(RISER_DEFAULT)
    }
  })

  it('whitespace-only returns all RISER_DEFAULT', () => {
    const riser = TerrainTileInfo.parseRiser('   ')
    for (let i = 0; i < 8; i++) {
      expect(riser[i]).toBe(RISER_DEFAULT)
    }
  })

  describe('long form (8 comma-separated values)', () => {
    it('parses explicit values in order UL..LU', () => {
      // UL,UR,RU,RD,DR,DL,LD,LU
      const riser = TerrainTileInfo.parseRiser('6,6,0,0,0,0,6,6')
      expect(riser[RiserConnection.UL]).toBe(6)
      expect(riser[RiserConnection.UR]).toBe(6)
      expect(riser[RiserConnection.RU]).toBe(0)
      expect(riser[RiserConnection.RD]).toBe(0)
      expect(riser[RiserConnection.DR]).toBe(0)
      expect(riser[RiserConnection.DL]).toBe(0)
      expect(riser[RiserConnection.LD]).toBe(6)
      expect(riser[RiserConnection.LU]).toBe(6)
    })

    it('handles all zeros', () => {
      const riser = TerrainTileInfo.parseRiser('0,0,0,0,0,0,0,0')
      for (let i = 0; i < 8; i++) {
        expect(riser[i]).toBe(0)
      }
    })

    it('handles negative values (cliffs below template height)', () => {
      const riser = TerrainTileInfo.parseRiser('-1,-1,0,0,0,0,-1,-1')
      expect(riser[RiserConnection.UL]).toBe(-1)
      expect(riser[RiserConnection.UR]).toBe(-1)
      expect(riser[RiserConnection.LD]).toBe(-1)
      expect(riser[RiserConnection.LU]).toBe(-1)
    })

    it('handles values up to 127', () => {
      const riser = TerrainTileInfo.parseRiser(
        '127,127,127,127,127,127,127,127',
      )
      for (let i = 0; i < 8; i++) {
        expect(riser[i]).toBe(127)
      }
    })

    it('throws on invalid integer in long form', () => {
      expect(() =>
        TerrainTileInfo.parseRiser('6,6,abc,0,0,0,6,6'),
      ).toThrow('is not a valid Riser definition')
    })

    it('throws on wrong number of values', () => {
      expect(() =>
        TerrainTileInfo.parseRiser('6,6,0'),
      ).toThrow('is not a valid Riser definition')
    })
  })

  describe('short form (DIR=value)', () => {
    it('"LU=6" sets all L and U corners to 6, rest default', () => {
      const riser = TerrainTileInfo.parseRiser('LU=6')
      // U connections (UL, UR): value 6
      expect(riser[RiserConnection.UL]).toBe(6)
      expect(riser[RiserConnection.UR]).toBe(6)
      // R connections (RU, RD): NOT in "LU" → default
      expect(riser[RiserConnection.RU]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RD]).toBe(RISER_DEFAULT)
      // D connections (DR, DL): NOT in "LU" → default
      expect(riser[RiserConnection.DR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DL]).toBe(RISER_DEFAULT)
      // L connections (LD, LU): value 6
      expect(riser[RiserConnection.LD]).toBe(6)
      expect(riser[RiserConnection.LU]).toBe(6)
    })

    it('"U=4" sets only upper corners', () => {
      const riser = TerrainTileInfo.parseRiser('U=4')
      expect(riser[RiserConnection.UL]).toBe(4)
      expect(riser[RiserConnection.UR]).toBe(4)
      expect(riser[RiserConnection.RU]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RD]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DL]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.LD]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.LU]).toBe(RISER_DEFAULT)
    })

    it('"R=3" sets only right corners', () => {
      const riser = TerrainTileInfo.parseRiser('R=3')
      expect(riser[RiserConnection.UL]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.UR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RU]).toBe(3)
      expect(riser[RiserConnection.RD]).toBe(3)
      expect(riser[RiserConnection.DR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DL]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.LD]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.LU]).toBe(RISER_DEFAULT)
    })

    it('"D=2" sets only down corners', () => {
      const riser = TerrainTileInfo.parseRiser('D=2')
      expect(riser[RiserConnection.UL]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.UR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RU]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RD]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DR]).toBe(2)
      expect(riser[RiserConnection.DL]).toBe(2)
      expect(riser[RiserConnection.LD]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.LU]).toBe(RISER_DEFAULT)
    })

    it('"L=1" sets only left corners', () => {
      const riser = TerrainTileInfo.parseRiser('L=1')
      expect(riser[RiserConnection.UL]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.UR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RU]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.RD]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DR]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.DL]).toBe(RISER_DEFAULT)
      expect(riser[RiserConnection.LD]).toBe(1)
      expect(riser[RiserConnection.LU]).toBe(1)
    })

    it('"URDL=0" sets all corners to 0', () => {
      const riser = TerrainTileInfo.parseRiser('URDL=0')
      for (let i = 0; i < 8; i++) {
        expect(riser[i]).toBe(0)
      }
    })

    it('is case-insensitive for direction letters', () => {
      const riser = TerrainTileInfo.parseRiser('lu=5')
      expect(riser[RiserConnection.UL]).toBe(5)
      expect(riser[RiserConnection.UR]).toBe(5)
      expect(riser[RiserConnection.LD]).toBe(5)
      expect(riser[RiserConnection.LU]).toBe(5)
      expect(riser[RiserConnection.RU]).toBe(RISER_DEFAULT)
    })

    it('throws on invalid value in short form', () => {
      expect(() =>
        TerrainTileInfo.parseRiser('U=xyz'),
      ).toThrow('is not a valid Riser definition')
    })

    it('throws on malformed short form (missing =)', () => {
      expect(() =>
        TerrainTileInfo.parseRiser('U6'),
      ).toThrow('is not a valid Riser definition')
    })
  })
})

// ---------------------------------------------------------------------------
// TerrainTileInfo — construction
// ---------------------------------------------------------------------------

describe('TerrainTileInfo', () => {
  const terrainIndexByName = new Map([
    ['Clear', 0],
    ['Rough', 1],
    ['Water', 2],
  ])

  it('constructs a basic tile from JSON', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear' },
      terrainIndexByName,
      0xFF000000,
    )

    expect(tile.terrainType).toBe(0)
    expect(tile.height).toBe(0)
    expect(tile.rampType).toBe(0)
    expect(tile.minColor).toBe(0xFF000000) // default color fallback
    expect(tile.maxColor).toBe(0xFF000000)
  })

  it('constructs a tile with all fields specified', () => {
    const tile = new TerrainTileInfo(
      {
        terrainType: 'Water',
        height: 4,
        rampType: 5,
        minColor: '0000FF',
        maxColor: '80FFFFFF',
        riser: '6,6,0,0,0,0,6,6',
      },
      terrainIndexByName,
      0xFF000000,
    )

    expect(tile.terrainType).toBe(2)
    expect(tile.height).toBe(4)
    expect(tile.rampType).toBe(5)
    expect(tile.minColor).toBe(0xFF0000FF)
    expect(tile.maxColor).toBe(0x80FFFFFF)
    expect(tile.riser[RiserConnection.UL]).toBe(6)
    expect(tile.riser[RiserConnection.UR]).toBe(6)
  })

  it('uses terrain type color as default when min/max not specified', () => {
    const defaultColor = parseColorHex('8080FF')
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear' },
      terrainIndexByName,
      defaultColor,
    )

    expect(tile.minColor).toBe(defaultColor)
    expect(tile.maxColor).toBe(defaultColor)
  })

  it('overrides default color when minColor specified in JSON', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF0000', maxColor: '00FF00' },
      terrainIndexByName,
      0xFF808080,
    )

    expect(tile.minColor).toBe(0xFFFF0000)
    expect(tile.maxColor).toBe(0xFF00FF00)
  })

  it('partially overrides: only minColor specified, maxColor uses default', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF0000' },
      terrainIndexByName,
      0xFF808080,
    )

    expect(tile.minColor).toBe(0xFFFF0000)
    expect(tile.maxColor).toBe(0xFF808080) // default
  })

  it('throws on unknown terrain type', () => {
    expect(
      () =>
        new TerrainTileInfo(
          { terrainType: 'Nonexistent' },
          terrainIndexByName,
          0xFF000000,
        ),
    ).toThrow('Unknown terrain type "Nonexistent"')
  })

  it('default riser is all RISER_DEFAULT when not specified', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear' },
      terrainIndexByName,
      0xFF000000,
    )

    for (let i = 0; i < 8; i++) {
      expect(tile.riser[i]).toBe(RISER_DEFAULT)
    }
  })

  it('getRiserHeight returns correct value for connection', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', riser: 'U=5' },
      terrainIndexByName,
      0xFF000000,
    )

    expect(tile.getRiserHeight(RiserConnection.UL)).toBe(5)
    expect(tile.getRiserHeight(RiserConnection.UR)).toBe(5)
    expect(tile.getRiserHeight(RiserConnection.RD)).toBe(RISER_DEFAULT)
  })
})

// ---------------------------------------------------------------------------
// TerrainTileInfo.getColor
// ---------------------------------------------------------------------------

describe('TerrainTileInfo.getColor', () => {
  const terrainIndexByName = new Map([['Clear', 0]])

  it('returns minColor when min equals max', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF8040', maxColor: 'FF8040' },
      terrainIndexByName,
      0xFF000000,
    )

    expect(tile.getColor(0)).toBe(tile.minColor)
    expect(tile.getColor(0.5)).toBe(tile.minColor)
    expect(tile.getColor(1)).toBe(tile.minColor)
  })

  it('interpolates between minColor and maxColor', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: '000000', maxColor: 'FFFFFF' },
      terrainIndexByName,
      0xFF000000,
    )

    expect(tile.getColor(0)).toBe(0xFF000000)
    expect(tile.getColor(1)).toBe(0xFFFFFFFF)

    const mid = tile.getColor(0.5)
    const [, r] = colorToComponents(mid)
    expect(r).toBe(128) // midpoint of 0→255
  })

  it('returns minColor for randomFloat=0 regardless of difference', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: '000000', maxColor: 'FFFFFF' },
      terrainIndexByName,
      0xFF000000,
    )
    expect(tile.getColor(0)).toBe(0xFF000000)
  })
})

// ---------------------------------------------------------------------------
// TileSet — TerrainPaletteInternalName
// ---------------------------------------------------------------------------

describe('TileSet.TerrainPaletteInternalName', () => {
  it('equals "terrain" (matches OpenRA)', () => {
    expect(TileSet.TerrainPaletteInternalName).toBe('terrain')
  })
})

// ---------------------------------------------------------------------------
// TileSet — empty / initial state
// ---------------------------------------------------------------------------

describe('TileSet — initial state', () => {
  beforeEach(() => {
    TileSet.clear()
  })

  it('is empty before fromJSON', () => {
    expect(TileSet.templates.size).toBe(0)
    expect(TileSet.tiles.size).toBe(0)
    expect(TileSet.terrainTypes.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TileSet.fromJSON — basic loading
// ---------------------------------------------------------------------------

describe('TileSet.fromJSON', () => {
  beforeEach(() => {
    TileSet.clear()
  })

  it('loads a single terrain type', () => {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
      ],
      templates: [],
    })

    expect(TileSet.terrainTypes.size).toBe(1)
    expect(TileSet.terrainTypes.has('Clear')).toBe(true)
  })

  it('loads multiple terrain types in order (index = position)', () => {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
        { type: 'Water', color: '0000FF' },
      ],
      templates: [],
    })

    expect(TileSet.getTerrainIndex('Clear')).toBe(0)
    expect(TileSet.getTerrainIndex('Rough')).toBe(1)
    expect(TileSet.getTerrainIndex('Water')).toBe(2)
  })

  it('loads a template with tiles', () => {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
      ],
      templates: [
        {
          id: 255,
          size: { x: 1, y: 1 },
          tiles: [{ terrainType: 'Clear' }],
        },
      ],
    })

    expect(TileSet.templates.size).toBe(1)
    const tpl = TileSet.templates.get('255')
    expect(tpl).toBeDefined()
    expect(tpl!.id).toBe(255)
    expect(tpl!.size).toEqual({ x: 1, y: 1 })
    expect(tpl!.tilesCount).toBe(1)
    expect(tpl!.tiles.length).toBe(1)
    expect(tpl!.tiles[0]!.terrainType).toBe(0)
  })

  it('loads a template with multiple tiles (2×2)', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        {
          id: 10,
          size: { x: 2, y: 2 },
          tiles: [
            { terrainType: 'Clear' },
            { terrainType: 'Clear' },
            { terrainType: 'Clear' },
            { terrainType: 'Clear' },
          ],
        },
      ],
    })

    const tpl = TileSet.templates.get('10')!
    expect(tpl.tilesCount).toBe(4)
    expect(tpl.tiles.length).toBe(4)
  })

  it('supports null entries in template tiles array', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        {
          id: 1,
          size: { x: 2, y: 2 },
          tiles: [
            { terrainType: 'Clear' },
            null,
            null,
            { terrainType: 'Clear' },
          ],
        },
      ],
    })

    const tpl = TileSet.templates.get('1')!
    expect(tpl.tiles[0]).not.toBeNull()
    expect(tpl.tiles[1]).toBeNull()
    expect(tpl.tiles[2]).toBeNull()
    expect(tpl.tiles[3]).not.toBeNull()
    // tilesCount is size.x * size.y when not PickAny
    expect(tpl.tilesCount).toBe(4)
  })

  it('PickAny template counts only non-null tiles', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        {
          id: 5,
          size: { x: 1, y: 1 },
          pickAny: true,
          tiles: [
            { terrainType: 'Clear' },
            { terrainType: 'Clear' },
            null,
            { terrainType: 'Clear' },
          ],
        },
      ],
    })

    const tpl = TileSet.templates.get('5')!
    expect(tpl.pickAny).toBe(true)
    expect(tpl.tilesCount).toBe(3) // 3 non-null
  })

  it('populates the global tiles map', () => {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
      ],
      templates: [
        {
          id: 0,
          size: { x: 2, y: 1 },
          tiles: [
            { terrainType: 'Clear' },
            { terrainType: 'Rough' },
          ],
        },
      ],
    })

    expect(TileSet.tiles.size).toBe(2)
    // Template 0, tile 0
    expect(TileSet.tiles.has(makeTileKey(0, 0))).toBe(true)
    // Template 0, tile 1
    expect(TileSet.tiles.has(makeTileKey(0, 1))).toBe(true)
  })

  it('populates TerrainTypeInfo.types static registry', () => {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
      ],
      templates: [],
    })

    expect(TerrainTypeInfo.types.has('Clear')).toBe(true)
    expect(TerrainTypeInfo.types.has('Rough')).toBe(true)
    expect(TerrainTypeInfo.byName('Clear')).toBeDefined()
    expect(TerrainTypeInfo.byName('Rough')).toBeDefined()
  })

  it('loads categories on templates', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        {
          id: 1,
          size: { x: 1, y: 1 },
          categories: ['Cliff', 'Shore'],
          tiles: [{ terrainType: 'Clear' }],
        },
      ],
    })

    const tpl = TileSet.templates.get('1')!
    expect(tpl.categories).toContain('Cliff')
    expect(tpl.categories).toContain('Shore')
  })

  it('fromJSON returns TileSet class for fluent chaining', () => {
    const result = TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
      ],
      templates: [
        { id: 0, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Clear' }] },
      ],
    })

    expect(result).toBe(TileSet)
    expect(TileSet.terrainTypes.has('Clear')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TileSet — lookup methods
// ---------------------------------------------------------------------------

describe('TileSet — lookups', () => {
  beforeEach(() => {
    TileSet.clear()
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
      ],
      templates: [
        {
          id: 10,
          size: { x: 2, y: 1 },
          tiles: [
            { terrainType: 'Clear' },
            { terrainType: 'Rough' },
          ],
        },
      ],
    })
  })

  it('getTileInfo returns correct tile by key', () => {
    const key = makeTileKey(10, 0)
    const tile = TileSet.getTileInfo(key)
    expect(tile.terrainType).toBe(0) // Clear
  })

  it('getTileInfo throws for unknown key', () => {
    expect(() => TileSet.getTileInfo(makeTileKey(99, 0))).toThrow(
      'not found in TileSet',
    )
  })

  it('getTileInfoByTemplate returns correct tile', () => {
    const tile = TileSet.getTileInfoByTemplate(10, 1)
    expect(tile.terrainType).toBe(1) // Rough
  })

  it('getTileInfoByTemplate throws for unknown template', () => {
    expect(() => TileSet.getTileInfoByTemplate(99, 0)).toThrow(
      'not found in TileSet',
    )
  })

  it('tryGetTileInfo returns tile for valid key', () => {
    const tile = TileSet.tryGetTileInfo(makeTileKey(10, 1))
    expect(tile).not.toBeNull()
    expect(tile!.terrainType).toBe(1)
  })

  it('tryGetTileInfo returns null for unknown key', () => {
    const tile = TileSet.tryGetTileInfo(makeTileKey(99, 0))
    expect(tile).toBeNull()
  })

  it('getTerrainType returns correct type', () => {
    const tt = TileSet.getTerrainType('Clear')
    expect(tt.type).toBe('Clear')
    expect(tt.color).toBe(0xFFFFDDB0)
  })

  it('getTerrainType throws for unknown type', () => {
    expect(() => TileSet.getTerrainType('Nonexistent')).toThrow(
      'not found in TileSet',
    )
  })

  it('getTerrainIndex returns correct byte index', () => {
    expect(TileSet.getTerrainIndex('Clear')).toBe(0)
    expect(TileSet.getTerrainIndex('Rough')).toBe(1)
  })

  it('getTerrainIndex throws for unknown type', () => {
    expect(() => TileSet.getTerrainIndex('Nonexistent')).toThrow(
      'not found in TileSet',
    )
  })
})

// ---------------------------------------------------------------------------
// TileSet — error handling
// ---------------------------------------------------------------------------

describe('TileSet — error handling', () => {
  beforeEach(() => {
    TileSet.clear()
  })

  it('rejects too many terrain types (>= 255)', () => {
    const types: TerrainTypeInfoJson[] = []
    for (let i = 0; i < 255; i++) {
      types.push({ type: `T${i}`, color: '000000' })
    }

    expect(() =>
      TileSet.fromJSON({ terrainTypes: types, templates: [] }),
    ).toThrow('Too many terrain types')
  })

  it('rejects duplicate terrain type names', () => {
    expect(() =>
      TileSet.fromJSON({
        terrainTypes: [
          { type: 'Clear', color: 'FFDDB0' },
          { type: 'Clear', color: '886600' },
        ],
        templates: [],
      }),
    ).toThrow('Duplicate terrain type "Clear"')
  })

  it('rejects duplicate tile keys', () => {
    expect(() =>
      TileSet.fromJSON({
        terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
        templates: [
          {
            id: 0,
            size: { x: 2, y: 1 },
            tiles: [
              { terrainType: 'Clear' },
              { terrainType: 'Clear' },
            ],
          },
          {
            id: 0, // Same ID = same tile keys
            size: { x: 1, y: 1 },
            tiles: [{ terrainType: 'Clear' }],
          },
        ],
      }),
    ).toThrow('Duplicate tile key')
  })

  it('clear() resets all state', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        {
          id: 1,
          size: { x: 1, y: 1 },
          tiles: [{ terrainType: 'Clear' }],
        },
      ],
    })

    TileSet.clear()

    expect(TileSet.templates.size).toBe(0)
    expect(TileSet.tiles.size).toBe(0)
    expect(TileSet.terrainTypes.size).toBe(0)
    expect(TerrainTypeInfo.types.size).toBe(0)
    expect(() => TileSet.getTerrainType('Clear')).toThrow()
  })

  it('reload after clear works correctly', () => {
    // First load
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [],
    })
    expect(TileSet.terrainTypes.size).toBe(1)

    // Clear
    TileSet.clear()
    expect(TileSet.terrainTypes.size).toBe(0)

    // Second load
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Water', color: '0000FF' }],
      templates: [],
    })
    expect(TileSet.terrainTypes.size).toBe(1)
    expect(TileSet.getTerrainType('Water').type).toBe('Water')
  })
})

// ---------------------------------------------------------------------------
// TileTemplate interface — structure validation
// ---------------------------------------------------------------------------

describe('TileTemplate', () => {
  beforeEach(() => {
    TileSet.clear()
  })

  it('loaded template satisfies TileTemplate interface', () => {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
      ],
      templates: [
        {
          id: 255,
          size: { x: 2, y: 2 },
          pickAny: false,
          categories: ['Basic'],
          tiles: [
            { terrainType: 'Clear', height: 1 },
            { terrainType: 'Clear', height: 1 },
            { terrainType: 'Rough', height: 2 },
            { terrainType: 'Rough', height: 2 },
          ],
        },
      ],
    })

    const tpl: TileTemplate = TileSet.templates.get('255')!
    expect(tpl.id).toBe(255)
    expect(tpl.size.x).toBe(2)
    expect(tpl.size.y).toBe(2)
    expect(tpl.pickAny).toBe(false)
    expect(tpl.categories).toContain('Basic')
    expect(tpl.tiles.length).toBe(4)
    expect(tpl.tilesCount).toBe(4)

    // Verify tile data
    expect(tpl.tiles[0]!.terrainType).toBe(0)
    expect(tpl.tiles[0]!.height).toBe(1)
    expect(tpl.tiles[2]!.terrainType).toBe(1)
    expect(tpl.tiles[2]!.height).toBe(2)
  })

  it('template categories default to empty array', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        { id: 1, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Clear' }] },
      ],
    })

    const tpl = TileSet.templates.get('1')!
    expect(tpl.categories).toEqual([])
  })

  it('template tiles and categories are frozen/immutable', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: 'FFDDB0' }],
      templates: [
        { id: 1, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Clear' }] },
      ],
    })

    const tpl = TileSet.templates.get('1')!
    expect(Object.isFrozen(tpl.tiles)).toBe(true)
    expect(Object.isFrozen(tpl.categories)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Integration — full tileset load and query workflow
// ---------------------------------------------------------------------------

describe('Integration — full tileset workflow', () => {
  beforeEach(() => {
    TileSet.clear()
  })

  it('loads a realistic multi-type, multi-template tileset', () => {
    const json: TileSetJson = {
      terrainTypes: [
        { type: 'Clear', targetTypes: ['Ground'], color: 'FFDDB0' },
        { type: 'Rough', targetTypes: ['Ground'], color: '886600' },
        { type: 'Water', targetTypes: ['Water'], acceptsSmudgeType: ['Wake'], color: '0000FF' },
      ],
      templates: [
        {
          id: 255,
          size: { x: 1, y: 1 },
          categories: ['Basic'],
          tiles: [
            { terrainType: 'Clear' },
          ],
        },
        {
          id: 256,
          size: { x: 1, y: 1 },
          categories: ['Basic'],
          tiles: [
            { terrainType: 'Rough', height: 1 },
          ],
        },
        {
          id: 512,
          size: { x: 2, y: 2 },
          categories: ['Cliff'],
          tiles: [
            { terrainType: 'Water', height: 0 },
            { terrainType: 'Water', height: 0 },
            { terrainType: 'Water', height: 0 },
            { terrainType: 'Water', height: 0 },
          ],
        },
      ],
    }

    TileSet.fromJSON(json)

    // Terrain types registered
    expect(TileSet.terrainTypes.size).toBe(3)
    expect(TerrainTypeInfo.types.size).toBe(3)

    // Indices
    expect(TileSet.getTerrainIndex('Clear')).toBe(0)
    expect(TileSet.getTerrainIndex('Rough')).toBe(1)
    expect(TileSet.getTerrainIndex('Water')).toBe(2)

    // Templates
    expect(TileSet.templates.size).toBe(3)
    expect(TileSet.templates.get('255')!.categories).toContain('Basic')
    expect(TileSet.templates.get('512')!.size).toEqual({ x: 2, y: 2 })

    // Tiles map
    // Template 255: 1 tile, Template 256: 1 tile, Template 512: 4 tiles
    expect(TileSet.tiles.size).toBe(6)

    // Query a specific tile
    const waterTile = TileSet.getTileInfoByTemplate(512, 0)
    expect(waterTile.terrainType).toBe(2)
    expect(waterTile.height).toBe(0)

    // Terrain type details
    const clear = TileSet.getTerrainType('Clear')
    expect(clear.targetTypes.has('Ground')).toBe(true)
    expect(clear.targetTypes.has('Water')).toBe(false)

    const water = TileSet.getTerrainType('Water')
    expect(water.acceptsSmudgeType.has('Wake')).toBe(true)
    expect(water.color).toBe(0xFF0000FF)
  })
})
