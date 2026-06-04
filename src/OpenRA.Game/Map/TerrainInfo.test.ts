/**
 * TerrainInfo.test.ts — TerrainInfo unit tests (Phase C reduced scope)
 *
 * Tests focus on:
 * - RiserConnection enum values match OpenRA
 * - Riser class: default, long-form, short-form parsing, getConnection, errors
 * - parseColorHex, colorToComponents, colorLerp correctness
 * - TerrainTypeInfo construction, defaults, fromJSON factory, static registry
 * - TerrainTileInfo construction, getColor
 * - TileSet.TerrainPaletteInternalName
 * - makeTileKey utilities
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RiserConnection,
  RISER_CONNECTION_COUNT,
  RISER_DEFAULT,
  Riser,
  parseColorHex,
  colorToComponents,
  colorLerp,
  TerrainTypeInfo,
  TerrainTileInfo,
  TileSet,
  makeTileKey,
  templateIdFromKey,
  tileIndexFromKey,
} from './TerrainInfo'

import type { TerrainTypeInfoJson } from './TerrainInfo'

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

  it('RISER_DEFAULT = 0xFF matches OpenRA byte.MaxValue', () => {
    expect(RISER_DEFAULT).toBe(0xff)
  })
})

// ---------------------------------------------------------------------------
// Riser — default construction
// ---------------------------------------------------------------------------

describe('Riser — default', () => {
  it('all connections return RISER_DEFAULT', () => {
    const r = new Riser()
    for (let i = 0; i < 8; i++) {
      expect(r.getConnection(i)).toBe(RISER_DEFAULT)
    }
  })

  it('Riser.default() is equivalent to new Riser()', () => {
    const r1 = new Riser()
    const r2 = Riser.default()
    for (let i = 0; i < 8; i++) {
      expect(r2.getConnection(i)).toBe(r1.getConnection(i))
    }
  })

  it('empty string produces all-default', () => {
    const r = new Riser('')
    for (let i = 0; i < 8; i++) {
      expect(r.getConnection(i)).toBe(RISER_DEFAULT)
    }
  })

  it('whitespace-only string produces all-default', () => {
    const r = new Riser('   ')
    for (let i = 0; i < 8; i++) {
      expect(r.getConnection(i)).toBe(RISER_DEFAULT)
    }
  })
})

// ---------------------------------------------------------------------------
// Riser — long form (8 comma-separated values)
// ---------------------------------------------------------------------------

describe('Riser — long form', () => {
  it('parses explicit values in UL..LU order', () => {
    const r = new Riser('6,6,0,0,0,0,6,6')
    expect(r.getConnection(RiserConnection.UL)).toBe(6)
    expect(r.getConnection(RiserConnection.UR)).toBe(6)
    expect(r.getConnection(RiserConnection.RU)).toBe(0)
    expect(r.getConnection(RiserConnection.RD)).toBe(0)
    expect(r.getConnection(RiserConnection.DR)).toBe(0)
    expect(r.getConnection(RiserConnection.DL)).toBe(0)
    expect(r.getConnection(RiserConnection.LD)).toBe(6)
    expect(r.getConnection(RiserConnection.LU)).toBe(6)
  })

  it('handles all zeros', () => {
    const r = new Riser('0,0,0,0,0,0,0,0')
    for (let i = 0; i < 8; i++) expect(r.getConnection(i)).toBe(0)
  })

  it('handles negative values as unsigned bytes', () => {
    // -1 as signed byte = 0xFF unsigned = RISER_DEFAULT
    const r = new Riser('-1,-1,0,0,0,0,-1,-1')
    expect(r.getConnection(RiserConnection.UL)).toBe(0xff)
    expect(r.getConnection(RiserConnection.UR)).toBe(0xff)
    expect(r.getConnection(RiserConnection.LD)).toBe(0xff)
    expect(r.getConnection(RiserConnection.LU)).toBe(0xff)
  })

  it('handles values up to 255', () => {
    const r = new Riser('255,255,255,255,255,255,255,255')
    for (let i = 0; i < 8; i++) expect(r.getConnection(i)).toBe(255)
  })

  it('handles values that overflow byte range (masked to 0xFF)', () => {
    const r = new Riser('256,256,256,256,256,256,256,256')
    // 256 & 0xFF = 0
    for (let i = 0; i < 8; i++) expect(r.getConnection(i)).toBe(0)
  })

  it('throws on non-integer value', () => {
    expect(() => new Riser('6,6,abc,0,0,0,6,6')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('throws on wrong number of values', () => {
    expect(() => new Riser('6,6,0')).toThrow(
      'is not a valid Riser definition',
    )
  })
})

// ---------------------------------------------------------------------------
// Riser — short form (DIR=value)
// ---------------------------------------------------------------------------

describe('Riser — short form', () => {
  it('"LU=6" sets L and U corners to 6, rest default', () => {
    const r = new Riser('LU=6')
    // U connections (UL, UR)
    expect(r.getConnection(RiserConnection.UL)).toBe(6)
    expect(r.getConnection(RiserConnection.UR)).toBe(6)
    // R connections (RU, RD) — NOT in "LU"
    expect(r.getConnection(RiserConnection.RU)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RD)).toBe(RISER_DEFAULT)
    // D connections (DR, DL) — NOT in "LU"
    expect(r.getConnection(RiserConnection.DR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DL)).toBe(RISER_DEFAULT)
    // L connections (LD, LU)
    expect(r.getConnection(RiserConnection.LD)).toBe(6)
    expect(r.getConnection(RiserConnection.LU)).toBe(6)
  })

  it('"U=4" sets only upper corners', () => {
    const r = new Riser('U=4')
    expect(r.getConnection(RiserConnection.UL)).toBe(4)
    expect(r.getConnection(RiserConnection.UR)).toBe(4)
    expect(r.getConnection(RiserConnection.RU)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RD)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DL)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.LD)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.LU)).toBe(RISER_DEFAULT)
  })

  it('"R=3" sets only right corners', () => {
    const r = new Riser('R=3')
    expect(r.getConnection(RiserConnection.UL)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.UR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RU)).toBe(3)
    expect(r.getConnection(RiserConnection.RD)).toBe(3)
    expect(r.getConnection(RiserConnection.DR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DL)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.LD)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.LU)).toBe(RISER_DEFAULT)
  })

  it('"D=2" sets only down corners', () => {
    const r = new Riser('D=2')
    expect(r.getConnection(RiserConnection.UL)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.UR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RU)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RD)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DR)).toBe(2)
    expect(r.getConnection(RiserConnection.DL)).toBe(2)
    expect(r.getConnection(RiserConnection.LD)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.LU)).toBe(RISER_DEFAULT)
  })

  it('"L=1" sets only left corners', () => {
    const r = new Riser('L=1')
    expect(r.getConnection(RiserConnection.UL)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.UR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RU)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.RD)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DR)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.DL)).toBe(RISER_DEFAULT)
    expect(r.getConnection(RiserConnection.LD)).toBe(1)
    expect(r.getConnection(RiserConnection.LU)).toBe(1)
  })

  it('"URDL=0" sets all corners to 0', () => {
    const r = new Riser('URDL=0')
    for (let i = 0; i < 8; i++) expect(r.getConnection(i)).toBe(0)
  })

  it('is case-insensitive for direction letters', () => {
    const r = new Riser('lu=5')
    expect(r.getConnection(RiserConnection.UL)).toBe(5)
    expect(r.getConnection(RiserConnection.UR)).toBe(5)
    expect(r.getConnection(RiserConnection.LD)).toBe(5)
    expect(r.getConnection(RiserConnection.LU)).toBe(5)
    expect(r.getConnection(RiserConnection.RU)).toBe(RISER_DEFAULT)
  })

  it('throws on invalid value', () => {
    expect(() => new Riser('U=xyz')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('throws on malformed short form (missing =)', () => {
    expect(() => new Riser('U6')).toThrow(
      'is not a valid Riser definition',
    )
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

  it('throws on invalid hex', () => {
    expect(() => parseColorHex('notahex')).toThrow()
  })

  it('throws on empty', () => {
    expect(() => parseColorHex('')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// colorToComponents
// ---------------------------------------------------------------------------

describe('colorToComponents', () => {
  it('decomposes 0xAARRGGBB', () => {
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
    const [, r, g, b] = colorToComponents(mid)
    expect(r).toBe(128)
    expect(g).toBe(128)
    expect(b).toBe(128)
  })

  it('interpolates alpha', () => {
    const result = colorLerp(0.5, 0x00000000, 0xFFFF0000)
    const [a] = colorToComponents(result)
    expect(a).toBe(128)
  })

  it('rounds to nearest integer', () => {
    const c1 = 0xFF000000
    const c2 = 0xFF808080
    const result = colorLerp(0.3, c1, c2)
    const [, r] = colorToComponents(result)
    // 0.3 * 128 = 38.4 → 38
    expect(r).toBe(38)
  })
})

// ---------------------------------------------------------------------------
// makeTileKey utilities
// ---------------------------------------------------------------------------

describe('makeTileKey', () => {
  it('combines template ID and tile index', () => {
    const key = makeTileKey(255, 3)
    expect(templateIdFromKey(key)).toBe(255)
    expect(tileIndexFromKey(key)).toBe(3)
  })

  it('handles maximum values', () => {
    const key = makeTileKey(65535, 255)
    expect(templateIdFromKey(key)).toBe(65535)
    expect(tileIndexFromKey(key)).toBe(255)
  })

  it('masks to 16-bit template ID and 8-bit tile index', () => {
    expect(templateIdFromKey(makeTileKey(0x1FFFF, 5))).toBe(65535)
    expect(tileIndexFromKey(makeTileKey(10, 0x1FF))).toBe(255)
  })

  it('produces unique keys for all 65536 combos', () => {
    const keys = new Set<number>()
    for (let tid = 0; tid < 256; tid++)
      for (let ti = 0; ti < 256; ti++)
        keys.add(makeTileKey(tid, ti))
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
    expect(tt.color).toBe(0xFFFFDDB0)
    expect(tt.restrictPlayerColor).toBe(true)
  })

  it('uses defaults for optional fields', () => {
    const tt = new TerrainTypeInfo({ type: 'Clear', color: '000000' })
    expect(tt.targetTypes.size).toBe(0)
    expect(tt.acceptsSmudgeType.size).toBe(0)
    expect(tt.restrictPlayerColor).toBe(false)
  })

  it('static .types registry is initially empty', () => {
    expect(TerrainTypeInfo.types.size).toBe(0)
  })

  it('static .byName returns undefined for missing type', () => {
    expect(TerrainTypeInfo.byName('Nonexistent')).toBeUndefined()
  })

  it('static .byName returns registered type', () => {
    const tt = new TerrainTypeInfo({ type: 'Clear', color: 'FFDDB0' })
    TerrainTypeInfo.types.set('Clear', tt)
    expect(TerrainTypeInfo.byName('Clear')).toBe(tt)
  })

  it('fromJSON factory creates equivalent instance', () => {
    const json: TerrainTypeInfoJson = {
      type: 'Clear',
      targetTypes: ['Ground'],
      color: 'FFDDB0',
    }
    const fromCtor = new TerrainTypeInfo(json)
    const fromFactory = TerrainTypeInfo.fromJSON(json)
    expect(fromFactory.type).toBe(fromCtor.type)
    expect(fromFactory.color).toBe(fromCtor.color)
    expect(fromFactory.targetTypes.has('Ground')).toBe(true)
  })

  it('color parse supports 8-digit hex', () => {
    const tt = new TerrainTypeInfo({ type: 'Water', color: '800000FF' })
    expect(tt.color).toBe(0x800000FF)
  })
})

// ---------------------------------------------------------------------------
// TerrainTileInfo
// ---------------------------------------------------------------------------

describe('TerrainTileInfo', () => {
  const terrainIndexByName = new Map([
    ['Clear', 0],
    ['Rough', 1],
    ['Water', 2],
  ])

  it('constructs basic tile from JSON', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear' },
      terrainIndexByName,
      0xFF000000,
    )

    expect(tile.terrainType).toBe(0)
    expect(tile.height).toBe(0)
    expect(tile.rampType).toBe(0)
    expect(tile.minColor).toBe(0xFF000000)
    expect(tile.maxColor).toBe(0xFF000000)
    // Default riser — all unspecified
    for (let i = 0; i < 8; i++) {
      expect(tile.riser.getConnection(i)).toBe(RISER_DEFAULT)
    }
  })

  it('constructs tile with all fields', () => {
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
    expect(tile.riser.getConnection(RiserConnection.UL)).toBe(6)
    expect(tile.riser.getConnection(RiserConnection.UR)).toBe(6)
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

  it('overrides default color when JSON specifies colors', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF0000', maxColor: '00FF00' },
      terrainIndexByName,
      0xFF808080,
    )
    expect(tile.minColor).toBe(0xFFFF0000)
    expect(tile.maxColor).toBe(0xFF00FF00)
  })

  it('partial override: only minColor, maxColor uses default', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF0000' },
      terrainIndexByName,
      0xFF808080,
    )
    expect(tile.minColor).toBe(0xFFFF0000)
    expect(tile.maxColor).toBe(0xFF808080)
  })

  it('throws on unknown terrain type name', () => {
    expect(
      () =>
        new TerrainTileInfo(
          { terrainType: 'Nonexistent' },
          terrainIndexByName,
          0xFF000000,
        ),
    ).toThrow('Unknown terrain type "Nonexistent"')
  })

  it('short-form riser: "U=4" on a tile', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', riser: 'U=4' },
      terrainIndexByName,
      0xFF000000,
    )
    expect(tile.riser.getConnection(RiserConnection.UL)).toBe(4)
    expect(tile.riser.getConnection(RiserConnection.UR)).toBe(4)
    expect(tile.riser.getConnection(RiserConnection.RD)).toBe(RISER_DEFAULT)
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

  it('interpolates between min and max', () => {
    const tile = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: '000000', maxColor: 'FFFFFF' },
      terrainIndexByName,
      0xFF000000,
    )
    expect(tile.getColor(0)).toBe(0xFF000000)
    expect(tile.getColor(1)).toBe(0xFFFFFFFF)
    const [, r] = colorToComponents(tile.getColor(0.5))
    expect(r).toBe(128)
  })
})

// ---------------------------------------------------------------------------
// TileSet
// ---------------------------------------------------------------------------

describe('TileSet', () => {
  it('TerrainPaletteInternalName equals "terrain" (matches OpenRA)', () => {
    expect(TileSet.TerrainPaletteInternalName).toBe('terrain')
  })
})
