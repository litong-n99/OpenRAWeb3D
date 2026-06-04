/**
 * TerrainInfo.ts — Terrain type system: Riser, TerrainTypeInfo, TerrainTileInfo, TileSet
 * OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs (197 lines, single file)
 *
 * 核心范式转换:
 * - C# Riser readonly struct (ulong bits) → TS class (bigint _bits)
 * - C# this[int i] / this[Connection c] indexers → getConnection(direction)
 * - C# BitSet<TargetableType> → Set<string>
 * - C# ImmutableArray<string> → Set<string>
 * - C# Color struct (uint ARGB) → number (ARGB uint32) with hex parse/emit
 * - C# MersenneTwister → randomFloat parameter (0..1)
 * - C# FieldLoader.Load() + reflection → explicit constructor / fromJSON()
 *
 * NOTE: The TileSet class is exactly matching the C# TileSet — just a
 * single static constant. Templates, tiles, and terrain type indexing
 * (via DefaultTerrain) are deferred to Phase D/E.
 * NOTE: ITerrainInfo / ITerrainLoader interfaces are deferred to Phase E/Chapter 7.
 */

// ---------------------------------------------------------------------------
// RiserConnection — 8-direction neighbour corner connection enum
// OpenRA 对照: Riser.Connection enum
// ---------------------------------------------------------------------------

/**
 * Corner connection directions for Riser height encoding.
 *
 * OpenRA 对照: Riser.Connection enum
 *
 * Each tile has eight outgoing riser connections in a hash-symbol (#) formation.
 * The two-letter code names the neighbour cell (first letter: U=upper, R=right,
 * D=down, L=left) and the corner within that cell (second letter: L=left, R=right,
 * U=upper, D=down).
 */
export const RiserConnection = {
  UL: 0,
  UR: 1,
  RU: 2,
  RD: 3,
  DR: 4,
  DL: 5,
  LD: 6,
  LU: 7,
} as const

export type RiserConnection =
  (typeof RiserConnection)[keyof typeof RiserConnection]

/** Number of Riser connection directions. */
export const RISER_CONNECTION_COUNT = 8

/**
 * Default Riser height value — signals "use template height instead".
 *
 * OpenRA 对照: Riser.Default = byte.MaxValue = 0xFF
 */
export const RISER_DEFAULT = 0xff

// ---------------------------------------------------------------------------
// Riser — height discontinuities with neighbouring cells
// OpenRA 对照: Riser readonly struct
// ---------------------------------------------------------------------------

/**
 * Describes expected discontinuities in height with neighbouring tiles.
 *
 * OpenRA 对照: Riser readonly struct
 *
 * Each tile has eight outgoing connections. The two accepted formats are:
 *   Long:  "6,6,0,0,0,0,6,6" — explicit byte per connection
 *   Short: "LU=6" — set all corners at the named sides to value 6, rest default
 *
 * Internally stored as a 64-bit bigint bitfield (8 bytes), byte-for-byte
 * identical to the OpenRA C# `ulong bits` field.
 */
export class Riser {
  /** 64-bit bitfield: byte i holds the height for RiserConnection i.
   *
   * OpenRA 对照: Riser.bits (ulong)
   *
   * Default: 0xFFFFFFFF_FFFFFFFFn (all bytes = 0xFF = unspecified).
   */
  private readonly _bits: bigint

  // ---- Construction ----------------------------------------------------------

  /**
   * Create a Riser, optionally parsing a definition string.
   *
   * OpenRA 对照: Riser(MiniYaml my)
   *
   * @param definition — "6,6,0,0,0,0,6,6" (long), "LU=6" (short), or empty
   */
  constructor(definition?: string) {
    if (!definition || definition.trim().length === 0) {
      this._bits = Riser._ALL_DEFAULT
      return
    }

    // Try long form: 8 comma-separated values
    const commaParts = definition.split(',')
    if (commaParts.length === RISER_CONNECTION_COUNT) {
      this._bits = Riser._parseLong(commaParts)
      return
    }

    // Try short form: KEY=VALUE
    const eqParts = definition.split('=')
    if (eqParts.length === 2) {
      this._bits = Riser._parseShort(
        eqParts[0]!.trim().toUpperCase(),
        eqParts[1]!.trim(),
      )
      return
    }

    throw new Error(`"${definition}" is not a valid Riser definition`)
  }

  /** Default constructor: all connections unspecified (0xFF in every byte). */
  static default(): Riser {
    return new Riser()
  }

  // ---- Access ----------------------------------------------------------------

  /**
   * Get the height value for a connection direction.
   *
   * OpenRA 对照: Riser.this[Connection c]
   *
   * Returns the raw byte value (0-255). Callers check `value === RISER_DEFAULT`
   * (0xFF) to determine if the connection is unspecified.
   *
   * @param direction — RiserConnection enum value (0-7)
   * @returns the height byte (0-255, 0xFF = unspecified)
   */
  getConnection(direction: number): number {
    return Number((this._bits >> BigInt(direction * 8)) & 0xffn)
  }

  // ---- Parsing (private) -----------------------------------------------------

  /** All 8 bytes = 0xFF: the fully-unspecified bitfield. */
  private static readonly _ALL_DEFAULT = 0xffffffffffffffffn

  /** Multiplier for setting all 8 bytes to the same value. */
  private static readonly _BROADCAST = 0x0101010101010101n

  /**
   * Parse long form: "6,6,0,0,0,0,6,6".
   *
   * OpenRA 对照: Riser — 8-part comma split path
   */
  private static _parseLong(parts: string[]): bigint {
    let bits = 0n
    for (let i = 0; i < RISER_CONNECTION_COUNT; i++) {
      const parsed = parseInt(parts[i]!.trim(), 10)
      if (!Number.isInteger(parsed)) {
        throw new Error(`"${parts.join(',')}" is not a valid Riser definition`)
      }
      bits |= BigInt(parsed & 0xff) << BigInt(i * 8)
    }
    return bits
  }

  /**
   * Parse short form: "LU=6" → all L and U connections = 6, rest default.
   *
   * OpenRA 对照: Riser — KEY=VALUE split path
   *
   * Start with all bytes = value. Then for each direction NOT in the key,
   * OR 0xFF back into the corresponding byte slots, reverting them to default.
   */
  private static _parseShort(key: string, valueStr: string): bigint {
    const b = parseInt(valueStr, 10)
    if (!Number.isInteger(b)) {
      throw new Error(`"${key}=${valueStr}" is not a valid Riser definition`)
    }

    // Set all 8 bytes to b
    let bits = BigInt(b & 0xff) * Riser._BROADCAST

    // For each direction NOT mentioned in the key, revert bytes to 0xFF.
    // Byte pairs: U={UL,UR}, R={RU,RD}, D={DR,DL}, L={LD,LU}
    if (!key.includes('U')) bits |= 0x000000000000ffffn // bytes 0,1
    if (!key.includes('R')) bits |= 0x00000000ffff0000n // bytes 2,3
    if (!key.includes('D')) bits |= 0x0000ffff00000000n // bytes 4,5
    if (!key.includes('L')) bits |= 0xffff000000000000n // bytes 6,7

    return bits
  }
}

// ---------------------------------------------------------------------------
// Color — utility functions for ARGB uint32
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string to ARGB uint32.
 *
 * OpenRA 对照: FieldLoader color parsing (hex string → Color(uint argb))
 *
 * Supported formats:
 *   "RRGGBB"   → 0xFFRRGGBB (alpha = 255)
 *   "AARRGGBB" → 0xAARRGGBB
 *
 * @param hex — hex color string, with or without alpha
 * @returns ARGB uint32 (normalized to unsigned via >>> 0)
 */
export function parseColorHex(hex: string): number {
  const h = hex.replace(/^#/, '')
  if (h.length === 6) return ((0xff << 24) | parseInt(h, 16)) >>> 0
  if (h.length === 8) return parseInt(h, 16) >>> 0
  throw new Error(`Invalid color hex: "${hex}"`)
}

/**
 * Extract ARGB components from a uint32 ARGB color.
 *
 * @param argb — ARGB uint32 color
 * @returns [A, R, G, B] tuple (each 0-255)
 */
export function colorToComponents(argb: number): [number, number, number, number] {
  const u = argb >>> 0
  return [
    (u >>> 24) & 0xff,
    (u >>> 16) & 0xff,
    (u >>> 8) & 0xff,
    u & 0xff,
  ]
}

/**
 * Linear interpolation between two ARGB uint32 colors.
 *
 * OpenRA 对照: Exts.ColorLerp(float t, Color c1, Color c2)
 *
 * @param t — interpolation factor (0..1)
 * @param c1 — start color (ARGB uint32)
 * @param c2 — end color (ARGB uint32)
 * @returns interpolated color (ARGB uint32, normalized to unsigned)
 */
export function colorLerp(t: number, c1: number, c2: number): number {
  const [a1, r1, g1, b1] = colorToComponents(c1)
  const [a2, r2, g2, b2] = colorToComponents(c2)
  const a = Math.round(t * a2 + (1 - t) * a1)
  const r = Math.round(t * r2 + (1 - t) * r1)
  const g = Math.round(t * g2 + (1 - t) * g1)
  const b = Math.round(t * b2 + (1 - t) * b1)
  return (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0
}

// ---------------------------------------------------------------------------
// JSON import interfaces (used by Phase D tile loading)
// ---------------------------------------------------------------------------

/** JSON shape for a single TerrainTypeInfo entry. */
export interface TerrainTypeInfoJson {
  type: string
  targetTypes?: string[]
  acceptsSmudgeType?: string[]
  color: string
  restrictPlayerColor?: boolean
}

/** JSON shape for a single TerrainTileInfo entry within a template. */
export interface TerrainTileInfoJson {
  terrainType: string
  height?: number
  rampType?: number
  minColor?: string
  maxColor?: string
  riser?: string
}

// ---------------------------------------------------------------------------
// TerrainTypeInfo
// OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs TerrainTypeInfo class
// ---------------------------------------------------------------------------

/**
 * Metadata for a single terrain type (Clear, Rough, Water, etc.).
 *
 * OpenRA 对照: TerrainTypeInfo
 *
 * Terrain types define the classification of map cells. Each type has a
 * unique string name, visual color, and optional gameplay flags.
 */
export class TerrainTypeInfo {
  /** Unique terrain type identifier (e.g. "Clear", "Rough", "Water").
   *
   * OpenRA 对照: TerrainTypeInfo.Type
   */
  readonly type: string

  /** Target types that can traverse this terrain.
   *
   * OpenRA 对照: TerrainTypeInfo.TargetTypes (BitSet<TargetableType>)
   */
  readonly targetTypes: Set<string>

  /** Smudge types this terrain can accept (e.g. crater scorch marks).
   *
   * OpenRA 对照: TerrainTypeInfo.AcceptsSmudgeType (ImmutableArray<string>)
   */
  readonly acceptsSmudgeType: Set<string>

  /** Debug/editor color for this terrain type (ARGB uint32).
   *
   * OpenRA 对照: TerrainTypeInfo.Color
   */
  readonly color: number

  /** Whether player colours should not be applied to actors on this terrain.
   *
   * OpenRA 对照: TerrainTypeInfo.RestrictPlayerColor
   */
  readonly restrictPlayerColor: boolean

  /** Static registry of all loaded terrain types, keyed by type name.
   *
   * OpenRA 对照: DefaultTerrain.terrainIndexByType + TerrainInfo array
   *
   * Populated during tile set loading (Phase D).
   */
  static readonly types: Map<string, TerrainTypeInfo> = new Map()

  /**
   * Look up a terrain type by name.
   *
   * @param name — terrain type name (e.g. "Clear")
   * @returns TerrainTypeInfo or undefined if not registered
   */
  static byName(name: string): TerrainTypeInfo | undefined {
    return TerrainTypeInfo.types.get(name)
  }

  /**
   * Create from JSON data.
   *
   * OpenRA 对照: TerrainTypeInfo(MiniYaml my) + FieldLoader.Load(this, my)
   */
  constructor(json: TerrainTypeInfoJson) {
    this.type = json.type
    this.targetTypes = new Set(json.targetTypes ?? [])
    this.acceptsSmudgeType = new Set(json.acceptsSmudgeType ?? [])
    this.color = parseColorHex(json.color)
    this.restrictPlayerColor = json.restrictPlayerColor ?? false
  }

  /**
   * Factory: create from a JSON entry.
   *
   * OpenRA 对照: new TerrainTypeInfo(MiniYaml my)
   */
  static fromJSON(json: TerrainTypeInfoJson): TerrainTypeInfo {
    return new TerrainTypeInfo(json)
  }
}

// ---------------------------------------------------------------------------
// TerrainTileInfo
// OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs TerrainTileInfo class
// ---------------------------------------------------------------------------

/**
 * Metadata for a single tile within a tile template.
 *
 * OpenRA 对照: TerrainTileInfo
 *
 * Each tile has a terrain type classification, base height, ramp slope
 * index, per-vertex color tint range, and optional Riser heights for
 * cliff/wall discontinuities with neighbouring cells.
 */
export class TerrainTileInfo {
  /** Index into the terrain type list for this tile's classification.
   *
   * OpenRA 对照: TerrainTileInfo.TerrainType
   */
  readonly terrainType: number

  /** Base height of this tile (0-255).
   *
   * OpenRA 对照: TerrainTileInfo.Height
   */
  readonly height: number

  /** Index into the ramp array for this tile's slope shape.
   *
   * OpenRA 对照: TerrainTileInfo.RampType
   */
  readonly rampType: number

  /** Minimum color tint for this tile (ARGB uint32).
   *
   * OpenRA 对照: TerrainTileInfo.MinColor
   */
  readonly minColor: number

  /** Maximum color tint for this tile (ARGB uint32).
   *
   * OpenRA 对照: TerrainTileInfo.MaxColor
   */
  readonly maxColor: number

  /**
   * Neighbour-corner height offsets (8 directions).
   *
   * OpenRA 对照: TerrainTileInfo.Riser
   *
   * Indices follow RiserConnection enum order: UL, UR, RU, RD, DR, DL, LD, LU.
   * Use `riser.getConnection(direction)` to read individual heights.
   */
  readonly riser: Riser

  /**
   * Create a TerrainTileInfo.
   *
   * OpenRA 对照: FieldLoader.Load(tile, my) + terrain type name → index resolution
   *
   * @param json — JSON tile data (terrainType is the type **name**, resolved to index via terrainIndexByName)
   * @param terrainIndexByName — map from terrain type name → byte index
   * @param defaultColor — fallback ARGB color used when minColor/maxColor are not specified
   */
  constructor(
    json: TerrainTileInfoJson,
    terrainIndexByName: ReadonlyMap<string, number>,
    defaultColor: number,
  ) {
    const idx = terrainIndexByName.get(json.terrainType)
    if (idx === undefined) {
      throw new Error(
        `Unknown terrain type "${json.terrainType}" in tile definition`,
      )
    }
    this.terrainType = idx
    this.height = json.height ?? 0
    this.rampType = json.rampType ?? 0

    // Parse color overrides, falling back to terrain type default.
    // OpenRA: checks `tile.MinColor == default` (Color(uint) 0 ≠ default struct).
    this.minColor = json.minColor ? parseColorHex(json.minColor) : defaultColor
    this.maxColor = json.maxColor ? parseColorHex(json.maxColor) : defaultColor

    this.riser = new Riser(json.riser)
  }

  // ---- Color Interpolation -------------------------------------------------

  /**
   * Get a randomised color tint for this tile.
   *
   * OpenRA 对照: TerrainTileInfo.GetColor(MersenneTwister random)
   *
   * Linearly interpolates between minColor and maxColor when they differ.
   *
   * @param randomFloat — random value in [0, 1]
   * @returns ARGB uint32 color
   */
  getColor(randomFloat: number): number {
    if (this.minColor !== this.maxColor) {
      return colorLerp(randomFloat, this.minColor, this.maxColor)
    }
    return this.minColor
  }
}

// ---------------------------------------------------------------------------
// TileSet
// OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs TileSet static class
// ---------------------------------------------------------------------------

/**
 * TileSet constants — exactly matching the C# TileSet static class.
 *
 * OpenRA 对照: TileSet
 *
 * NOTE: OpenRA's TileSet is a static class with only a single constant.
 * Template, tile, and terrain type indexing (from DefaultTerrain) are
 * deferred to Phase D/E.
 */
export class TileSet {
  /** Palette name for terrain rendering.
   *
   * OpenRA 对照: TileSet.TerrainPaletteInternalName
   */
  static readonly TerrainPaletteInternalName = 'terrain'
}

// ---------------------------------------------------------------------------
// makeTileKey — combine template ID and tile index into a single key
// (utility used by Phase D tile lookup)
// ---------------------------------------------------------------------------

/**
 * Create a combined tile key from template ID and tile index.
 *
 * Uses `(templateId << 8) | tileIndex` to pack ushort + byte into a number.
 * templateId is 16-bit (0-65535); tileIndex is 8-bit (0-255).
 *
 * @param templateId — template ID (ushort, 0-65535)
 * @param tileIndex — index within the template (byte, 0-255)
 * @returns combined key
 */
export function makeTileKey(templateId: number, tileIndex: number): number {
  return ((templateId & 0xffff) << 8) | (tileIndex & 0xff)
}

/**
 * Extract the template ID from a combined tile key.
 */
export function templateIdFromKey(key: number): number {
  return (key >> 8) & 0xffff
}

/**
 * Extract the tile index from a combined tile key.
 */
export function tileIndexFromKey(key: number): number {
  return key & 0xff
}
