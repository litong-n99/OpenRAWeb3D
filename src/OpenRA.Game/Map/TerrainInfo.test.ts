/**
 * TerrainInfo.test.ts — TerrainInfo unit tests (Phase C, pre-review revision)
 *
 * Tests focus on:
 * - RiserConnection enum values match OpenRA
 * - Riser class (40+ tests): default, long-form, short-form, direct access, errors
 * - TerrainTile stub
 * - parseColorHex, colorToComponents, colorLerp correctness
 * - TerrainTypeInfo construction, fromJSON factory, static registry
 * - TerrainTileInfo construction, getColor
 * - TileSet registries, lookups, fromJSON factory, error handling
 * - makeTileKey utilities
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RiserConnection,
  RISER_CONNECTION_COUNT,
  RISER_DEFAULT,
  Riser,
  TerrainTile,
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

// ===========================================================================
// RiserConnection
// ===========================================================================

describe('RiserConnection', () => {
  it('UL=0, UR=1, RU=2, RD=3, DR=4, DL=5, LD=6, LU=7', () => {
    expect(RiserConnection.UL).toBe(0)
    expect(RiserConnection.UR).toBe(1)
    expect(RiserConnection.RU).toBe(2)
    expect(RiserConnection.RD).toBe(3)
    expect(RiserConnection.DR).toBe(4)
    expect(RiserConnection.DL).toBe(5)
    expect(RiserConnection.LD).toBe(6)
    expect(RiserConnection.LU).toBe(7)
  })

  it('RISER_CONNECTION_COUNT = 8', () => {
    expect(RISER_CONNECTION_COUNT).toBe(8)
  })

  it('RISER_DEFAULT = 0xFF matching OpenRA byte.MaxValue', () => {
    expect(RISER_DEFAULT).toBe(0xff)
  })
})

// ===========================================================================
// Riser — 40+ tests
// ===========================================================================

// ---- Riser — default construction (5 tests) -------------------------------

describe('Riser — default', () => {
  it('no-arg: values is Uint8Array(8) filled with 0xFF', () => {
    const r = new Riser()
    expect(r.values).toBeInstanceOf(Uint8Array)
    expect(r.values.length).toBe(8)
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(RISER_DEFAULT)
  })

  it('no-arg: all getConnection(i) return RISER_DEFAULT', () => {
    const r = new Riser()
    for (let i = 0; i < 8; i++) expect(r.getConnection(i)).toBe(RISER_DEFAULT)
  })

  it('empty string: all RISER_DEFAULT', () => {
    const r = new Riser('')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(RISER_DEFAULT)
  })

  it('whitespace-only: all RISER_DEFAULT', () => {
    const r = new Riser('   ')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(RISER_DEFAULT)
  })

  it('values is a fresh Uint8Array (not shared)', () => {
    const r1 = new Riser()
    const r2 = new Riser()
    r1.values[0] = 0
    expect(r2.values[0]).toBe(RISER_DEFAULT)
  })
})

// ---- Riser — long form (12 tests) -----------------------------------------

describe('Riser — long form', () => {
  it('"6,6,0,0,0,0,6,6" — UL,UR,LD,LU = 6, rest 0', () => {
    const r = new Riser('6,6,0,0,0,0,6,6')
    expect(r.values[RiserConnection.UL]).toBe(6)
    expect(r.values[RiserConnection.UR]).toBe(6)
    expect(r.values[RiserConnection.RU]).toBe(0)
    expect(r.values[RiserConnection.RD]).toBe(0)
    expect(r.values[RiserConnection.DR]).toBe(0)
    expect(r.values[RiserConnection.DL]).toBe(0)
    expect(r.values[RiserConnection.LD]).toBe(6)
    expect(r.values[RiserConnection.LU]).toBe(6)
  })

  it('"0,0,0,0,0,0,0,0" — all zero', () => {
    const r = new Riser('0,0,0,0,0,0,0,0')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(0)
  })

  it('"255,255,255,255,255,255,255,255" — all 0xFF', () => {
    const r = new Riser('255,255,255,255,255,255,255,255')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(255)
  })

  it('handles negative values (stored as unsigned byte)', () => {
    const r = new Riser('-1,0,0,0,0,0,0,0')
    expect(r.values[0]).toBe(0xff) // -1 & 0xFF = 0xFF
  })

  it('handles values >255 (masked to 0xFF)', () => {
    const r = new Riser('256,256,256,256,256,256,256,256')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(0)
  })

  it('handles spaced values', () => {
    const r = new Riser(' 1 , 2 , 3 , 4 , 5 , 6 , 7 , 8 ')
    expect(r.values[0]).toBe(1)
    expect(r.values[7]).toBe(8)
  })

  it('getConnection matches values[index]', () => {
    const r = new Riser('10,20,30,40,50,60,70,80')
    for (let i = 0; i < 8; i++) {
      expect(r.getConnection(i)).toBe(r.values[i])
      expect(r.getConnection(i)).toBe((i + 1) * 10)
    }
  })

  it('preserves all 8 positions independently', () => {
    const r = new Riser('0,1,2,3,4,5,6,7')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(i)
  })

  it('throws on non-integer: "6,6,abc,0,0,0,6,6"', () => {
    expect(() => new Riser('6,6,abc,0,0,0,6,6')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('throws on too few values: "6,6,0"', () => {
    expect(() => new Riser('6,6,0')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('throws on too many values: "0,0,0,0,0,0,0,0,0"', () => {
    expect(() => new Riser('0,0,0,0,0,0,0,0,0')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('throws on empty parts: "6,,0,0,0,0,6,6"', () => {
    expect(() => new Riser('6,,0,0,0,0,6,6')).toThrow(
      'is not a valid Riser definition',
    )
  })
})

// ---- Riser — short form (18 tests) ----------------------------------------

describe('Riser — short form', () => {
  it('"LU=6": L+U corners = 6, rest 0xFF', () => {
    const r = new Riser('LU=6')
    expect(r.values[RiserConnection.UL]).toBe(6)
    expect(r.values[RiserConnection.UR]).toBe(6)
    expect(r.values[RiserConnection.RU]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.RD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DR]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DL]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LD]).toBe(6)
    expect(r.values[RiserConnection.LU]).toBe(6)
  })

  it('"U=4": only UL,UR = 4', () => {
    const r = new Riser('U=4')
    expect(r.values[RiserConnection.UL]).toBe(4)
    expect(r.values[RiserConnection.UR]).toBe(4)
    expect(r.values[RiserConnection.RU]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.RD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DR]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DL]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LU]).toBe(RISER_DEFAULT)
  })

  it('"R=3": only RU,RD = 3', () => {
    const r = new Riser('R=3')
    expect(r.values[RiserConnection.RU]).toBe(3)
    expect(r.values[RiserConnection.RD]).toBe(3)
    expect(r.values[RiserConnection.UL]).toBe(RISER_DEFAULT)
  })

  it('"D=2": only DR,DL = 2', () => {
    const r = new Riser('D=2')
    expect(r.values[RiserConnection.DR]).toBe(2)
    expect(r.values[RiserConnection.DL]).toBe(2)
    expect(r.values[RiserConnection.UL]).toBe(RISER_DEFAULT)
  })

  it('"L=1": only LD,LU = 1', () => {
    const r = new Riser('L=1')
    expect(r.values[RiserConnection.LD]).toBe(1)
    expect(r.values[RiserConnection.LU]).toBe(1)
    expect(r.values[RiserConnection.UL]).toBe(RISER_DEFAULT)
  })

  it('"URDL=0": all 8 corners = 0', () => {
    const r = new Riser('URDL=0')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(0)
  })

  it('"UR=10": U+R corners = 10, rest 0xFF', () => {
    const r = new Riser('UR=10')
    expect(r.values[RiserConnection.UL]).toBe(10)
    expect(r.values[RiserConnection.UR]).toBe(10)
    expect(r.values[RiserConnection.RU]).toBe(10)
    expect(r.values[RiserConnection.RD]).toBe(10)
    expect(r.values[RiserConnection.DR]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DL]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LU]).toBe(RISER_DEFAULT)
  })

  it('"DL=5": D+L corners = 5', () => {
    const r = new Riser('DL=5')
    expect(r.values[RiserConnection.DR]).toBe(5)
    expect(r.values[RiserConnection.DL]).toBe(5)
    expect(r.values[RiserConnection.LD]).toBe(5)
    expect(r.values[RiserConnection.LU]).toBe(5)
  })

  it('case-insensitive: "lu=5" same as "LU=5"', () => {
    const r = new Riser('lu=5')
    expect(r.values[RiserConnection.UL]).toBe(5)
    expect(r.values[RiserConnection.UR]).toBe(5)
    expect(r.values[RiserConnection.LD]).toBe(5)
    expect(r.values[RiserConnection.LU]).toBe(5)
    expect(r.values[RiserConnection.RU]).toBe(RISER_DEFAULT)
  })

  it('"rd=7": R+D corners = 7', () => {
    const r = new Riser('rd=7')
    expect(r.values[RiserConnection.RU]).toBe(7)
    expect(r.values[RiserConnection.RD]).toBe(7)
    expect(r.values[RiserConnection.DR]).toBe(7)
    expect(r.values[RiserConnection.DL]).toBe(7)
  })

  it('handles value 0 correctly (not falsy)', () => {
    const r = new Riser('UR=0')
    expect(r.values[RiserConnection.UL]).toBe(0)
    expect(r.values[RiserConnection.UR]).toBe(0)
    expect(r.values[RiserConnection.RU]).toBe(0)
    expect(r.values[RiserConnection.RD]).toBe(0)
  })

  it('handles value 255 correctly', () => {
    const r = new Riser('U=255')
    expect(r.values[RiserConnection.UL]).toBe(255)
    expect(r.values[RiserConnection.UR]).toBe(255)
  })

  it('value >255 masked to 0xFF', () => {
    const r = new Riser('U=256')
    expect(r.values[RiserConnection.UL]).toBe(0)
  })

  it('negative value stored as unsigned', () => {
    const r = new Riser('U=-1')
    expect(r.values[RiserConnection.UL]).toBe(0xff)
  })

  it('throws on invalid value: "U=xyz"', () => {
    expect(() => new Riser('U=xyz')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('throws on malformed: "U6" (no = sign)', () => {
    expect(() => new Riser('U6')).toThrow(
      'is not a valid Riser definition',
    )
  })

  it('unknown letters in key are ignored (only U,R,D,L matter)', () => {
    const r = new Riser('UX=3')
    expect(r.values[RiserConnection.UL]).toBe(3)
    expect(r.values[RiserConnection.UR]).toBe(3)
    expect(r.values[RiserConnection.RD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LU]).toBe(RISER_DEFAULT)
  })

  it('"UD=7": upper + down corners = 7, rest 0xFF', () => {
    const r = new Riser('UD=7')
    expect(r.values[RiserConnection.UL]).toBe(7)
    expect(r.values[RiserConnection.UR]).toBe(7)
    expect(r.values[RiserConnection.DR]).toBe(7)
    expect(r.values[RiserConnection.DL]).toBe(7)
    expect(r.values[RiserConnection.RU]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.RD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LD]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.LU]).toBe(RISER_DEFAULT)
  })

  it('"RL=8": right + left corners = 8, rest 0xFF', () => {
    const r = new Riser('RL=8')
    expect(r.values[RiserConnection.RU]).toBe(8)
    expect(r.values[RiserConnection.RD]).toBe(8)
    expect(r.values[RiserConnection.LD]).toBe(8)
    expect(r.values[RiserConnection.LU]).toBe(8)
    expect(r.values[RiserConnection.UL]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.UR]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DR]).toBe(RISER_DEFAULT)
    expect(r.values[RiserConnection.DL]).toBe(RISER_DEFAULT)
  })

  it('empty key "=5" produces all-default (matches C# silently-valid behavior)', () => {
    const r = new Riser('=5')
    for (let i = 0; i < 8; i++) expect(r.values[i]).toBe(RISER_DEFAULT)
  })
})

// ---- Riser — direct Uint8Array access (2 tests) ---------------------------

describe('Riser — direct values access', () => {
  it('values provides direct indexed access', () => {
    const r = new Riser('1,2,3,4,5,6,7,8')
    // Direct mutation is possible (Uint8Array is mutable)
    r.values[0] = 99
    expect(r.getConnection(0)).toBe(99)
    expect(r.values[0]).toBe(99)
  })

  it('values.length is always 8', () => {
    expect(new Riser().values.length).toBe(8)
    expect(new Riser('0,0,0,0,0,0,0,0').values.length).toBe(8)
    expect(new Riser('U=4').values.length).toBe(8)
  })
})

// ===========================================================================
// TerrainTile — minimal stub
// ===========================================================================

describe('TerrainTile', () => {
  it('constructs with type and index', () => {
    const tt = new TerrainTile(255, 3)
    expect(tt.type).toBe(255)
    expect(tt.index).toBe(3)
  })

  it('masks type to 16 bits, index to 8 bits', () => {
    const tt = new TerrainTile(0x1FFFF, 0x1FF)
    expect(tt.type).toBe(65535)
    expect(tt.index).toBe(255)
  })

  it('toString returns "type,index"', () => {
    expect(new TerrainTile(255, 3).toString()).toBe('255,3')
  })

  it('tryParse returns TerrainTile for valid input', () => {
    const tt = TerrainTile.tryParse('255,3')
    expect(tt).not.toBeNull()
    expect(tt!.type).toBe(255)
    expect(tt!.index).toBe(3)
  })

  it('tryParse returns null for invalid format', () => {
    expect(TerrainTile.tryParse('not,a,tile')).toBeNull()
    expect(TerrainTile.tryParse('')).toBeNull()
    expect(TerrainTile.tryParse('123')).toBeNull()
  })

  it('tryParse returns null for non-integer values', () => {
    expect(TerrainTile.tryParse('abc,1')).toBeNull()
  })
})

// ===========================================================================
// Color utilities
// ===========================================================================

describe('parseColorHex', () => {
  it('6-digit hex → 0xFFRRGGBB', () => {
    expect(parseColorHex('FFDDB0')).toBe(0xFFFFDDB0)
  })

  it('8-digit hex → 0xAARRGGBB', () => {
    expect(parseColorHex('80FF0000')).toBe(0x80FF0000)
  })

  it('strips leading #', () => {
    expect(parseColorHex('#FFDDB0')).toBe(0xFFFFDDB0)
  })

  it('throws on invalid', () => {
    expect(() => parseColorHex('notahex')).toThrow()
    expect(() => parseColorHex('')).toThrow()
  })
})

describe('colorToComponents', () => {
  it('0x80FFDDB0 → [128,255,221,176]', () => {
    const [a, r, g, b] = colorToComponents(0x80FFDDB0)
    expect(a).toBe(0x80)
    expect(r).toBe(0xFF)
    expect(g).toBe(0xDD)
    expect(b).toBe(0xB0)
  })
})

describe('colorLerp', () => {
  const black = 0xFF000000
  const white = 0xFFFFFFFF

  it('t=0 → c1, t=1 → c2, t=0.5 midpoint', () => {
    expect(colorLerp(0, black, white)).toBe(black)
    expect(colorLerp(1, black, white)).toBe(white)
    const [, r] = colorToComponents(colorLerp(0.5, black, white))
    expect(r).toBe(128)
  })
})

// ===========================================================================
// makeTileKey
// ===========================================================================

describe('makeTileKey', () => {
  it('round-trips: templateId=255, tileIndex=3', () => {
    const k = makeTileKey(255, 3)
    expect(templateIdFromKey(k)).toBe(255)
    expect(tileIndexFromKey(k)).toBe(3)
  })

  it('65536 unique keys for 256x256 combos', () => {
    const s = new Set<number>()
    for (let t = 0; t < 256; t++)
      for (let i = 0; i < 256; i++) s.add(makeTileKey(t, i))
    expect(s.size).toBe(65536)
  })
})

// ===========================================================================
// TerrainTypeInfo
// ===========================================================================

describe('TerrainTypeInfo', () => {
  beforeEach(() => TerrainTypeInfo.types.clear())

  it('constructs from JSON with all fields', () => {
    const tt = new TerrainTypeInfo({
      type: 'Clear',
      targetTypes: ['Ground'],
      acceptsSmudgeType: ['Scorch'],
      color: 'FFDDB0',
      restrictPlayerColor: true,
    })
    expect(tt.type).toBe('Clear')
    expect(tt.targetTypes.has('Ground')).toBe(true)
    expect(tt.acceptsSmudgeType.has('Scorch')).toBe(true)
    expect(tt.color).toBe(0xFFFFDDB0)
    expect(tt.restrictPlayerColor).toBe(true)
  })

  it('defaults: empty sets, restrictPlayerColor=false', () => {
    const tt = new TerrainTypeInfo({ type: 'Clear', color: '000000' })
    expect(tt.targetTypes.size).toBe(0)
    expect(tt.acceptsSmudgeType.size).toBe(0)
    expect(tt.restrictPlayerColor).toBe(false)
  })

  it('static .byName returns undefined for missing', () => {
    expect(TerrainTypeInfo.byName('Missing')).toBeUndefined()
  })

  it('static .types populates and .byName resolves', () => {
    const tt = new TerrainTypeInfo({ type: 'Clear', color: 'FFDDB0' })
    TerrainTypeInfo.types.set('Clear', tt)
    expect(TerrainTypeInfo.byName('Clear')).toBe(tt)
  })

  it('fromJSON factory creates equivalent instance', () => {
    const json: TerrainTypeInfoJson = {
      type: 'Clear', targetTypes: ['Ground'], color: 'FFDDB0',
    }
    const f = TerrainTypeInfo.fromJSON(json)
    expect(f.type).toBe('Clear')
    expect(f.targetTypes.has('Ground')).toBe(true)
  })
})

// ===========================================================================
// TerrainTileInfo
// ===========================================================================

describe('TerrainTileInfo', () => {
  const byName = new Map([['Clear', 0], ['Rough', 1], ['Water', 2]])

  it('basic tile: terrainType resolved from name', () => {
    const t = new TerrainTileInfo({ terrainType: 'Clear' }, byName, 0xFF000000)
    expect(t.terrainType).toBe(0)
    expect(t.height).toBe(0)
    expect(t.rampType).toBe(0)
  })

  it('full tile with all fields and riser', () => {
    const t = new TerrainTileInfo(
      {
        terrainType: 'Water', height: 4, rampType: 5,
        minColor: '0000FF', maxColor: '80FFFFFF', riser: '6,6,0,0,0,0,6,6',
      },
      byName, 0xFF000000,
    )
    expect(t.terrainType).toBe(2)
    expect(t.height).toBe(4)
    expect(t.riser.values[RiserConnection.UL]).toBe(6)
  })

  it('falls back to defaultColor when min/max not in JSON', () => {
    const dc = parseColorHex('8080FF')
    const t = new TerrainTileInfo({ terrainType: 'Clear' }, byName, dc)
    expect(t.minColor).toBe(dc)
    expect(t.maxColor).toBe(dc)
  })

  it('partial override: only minColor, maxColor uses default', () => {
    const t = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF0000' }, byName, 0xFF808080)
    expect(t.minColor).toBe(0xFFFF0000)
    expect(t.maxColor).toBe(0xFF808080)
  })

  it('throws on unknown terrain type name', () => {
    expect(
      () => new TerrainTileInfo({ terrainType: 'Bad' }, byName, 0),
    ).toThrow('Unknown terrain type "Bad"')
  })

  it('getColor returns min when equal', () => {
    const t = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: 'FF8040', maxColor: 'FF8040' },
      byName, 0,
    )
    expect(t.getColor(0)).toBe(t.minColor)
    expect(t.getColor(0.5)).toBe(t.minColor)
  })

  it('getColor interpolates when min ≠ max', () => {
    const t = new TerrainTileInfo(
      { terrainType: 'Clear', minColor: '000000', maxColor: 'FFFFFF' },
      byName, 0,
    )
    expect(t.getColor(0)).toBe(0xFF000000)
    expect(t.getColor(1)).toBe(0xFFFFFFFF)
  })
})

// ===========================================================================
// TileSet
// ===========================================================================

describe('TileSet', () => {
  it('TerrainPaletteInternalName = "terrain"', () => {
    expect(TileSet.TerrainPaletteInternalName).toBe('terrain')
  })
})

describe('TileSet — registries and lookups', () => {
  beforeEach(() => TileSet.clear())

  function loadBasic() {
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: 'FFDDB0' },
        { type: 'Rough', color: '886600' },
      ],
      templates: [{
        id: 10, size: { x: 2, y: 1 },
        tiles: [
          { terrainType: 'Clear' },
          { terrainType: 'Rough' },
        ],
      }],
    })
  }

  it('fromJSON populates terrainTypes', () => {
    loadBasic()
    expect(TileSet.terrainTypes.size).toBe(2)
    expect(TileSet.terrainTypes.has('Clear')).toBe(true)
  })

  it('fromJSON populates TerrainTypeInfo.types', () => {
    loadBasic()
    expect(TerrainTypeInfo.types.has('Clear')).toBe(true)
    expect(TerrainTypeInfo.byName('Rough')).toBeDefined()
  })

  it('terrain type indices match JSON array order', () => {
    loadBasic()
    expect(TileSet.getTerrainIndex('Clear')).toBe(0)
    expect(TileSet.getTerrainIndex('Rough')).toBe(1)
  })

  it('getTerrainType returns correct info', () => {
    loadBasic()
    const clear = TileSet.getTerrainType('Clear')
    expect(clear.type).toBe('Clear')
    expect(clear.color).toBe(0xFFFFDDB0)
  })

  it('getTerrainType throws for unknown', () => {
    loadBasic()
    expect(() => TileSet.getTerrainType('Bad')).toThrow('not found')
  })

  it('getTerrainIndex throws for unknown', () => {
    loadBasic()
    expect(() => TileSet.getTerrainIndex('Bad')).toThrow('not found')
  })

  it('tiles map populated', () => {
    loadBasic()
    expect(TileSet.tiles.size).toBe(2)
  })

  it('getTileInfo returns correct tile from TerrainTile', () => {
    loadBasic()
    const tile = new TerrainTile(10, 0)
    const info = TileSet.getTileInfo(tile)
    expect(info.terrainType).toBe(0)
  })

  it('getTileInfo throws for unknown tile', () => {
    loadBasic()
    expect(() => TileSet.getTileInfo(new TerrainTile(99, 0))).toThrow(
      'not found',
    )
  })

  it('null tiles in JSON are skipped', () => {
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: '000000' }],
      templates: [{
        id: 1, size: { x: 2, y: 2 },
        tiles: [
          { terrainType: 'Clear' }, null, null, { terrainType: 'Clear' },
        ],
      }],
    })
    expect(TileSet.tiles.size).toBe(2)
    expect(
      TileSet.getTileInfo(new TerrainTile(1, 0)),
    ).toBeDefined()
    expect(() => TileSet.getTileInfo(new TerrainTile(1, 1))).toThrow()
  })

  it('fromJSON returns TileSet class for chaining', () => {
    const r = TileSet.fromJSON({
      terrainTypes: [{ type: 'Clear', color: '000000' }],
      templates: [],
    })
    expect(r).toBe(TileSet)
  })

  it('rejects >=255 terrain types', () => {
    const types = Array.from({ length: 255 }, (_, i) => ({
      type: `T${i}`, color: '000000',
    }))
    expect(() =>
      TileSet.fromJSON({ terrainTypes: types, templates: [] }),
    ).toThrow('Too many terrain types')
  })

  it('rejects duplicate terrain types', () => {
    expect(() =>
      TileSet.fromJSON({
        terrainTypes: [
          { type: 'Clear', color: '000000' },
          { type: 'Clear', color: '000000' },
        ],
        templates: [],
      }),
    ).toThrow('Duplicate terrain type "Clear"')
  })

  it('rejects duplicate tile keys', () => {
    expect(() =>
      TileSet.fromJSON({
        terrainTypes: [{ type: 'Clear', color: '000000' }],
        templates: [
          { id: 0, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Clear' }] },
          { id: 0, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Clear' }] },
        ],
      }),
    ).toThrow('Duplicate tile key')
  })

  it('clear() resets all state', () => {
    loadBasic()
    TileSet.clear()
    expect(TileSet.terrainTypes.size).toBe(0)
    expect(TileSet.tiles.size).toBe(0)
    expect(TerrainTypeInfo.types.size).toBe(0)
    expect(() => TileSet.getTerrainType('Clear')).toThrow()
  })

  it('reload after clear works', () => {
    loadBasic()
    TileSet.clear()
    TileSet.fromJSON({
      terrainTypes: [{ type: 'Water', color: '0000FF' }],
      templates: [],
    })
    expect(TileSet.terrainTypes.size).toBe(1)
    expect(TileSet.getTerrainType('Water').type).toBe('Water')
  })
})
