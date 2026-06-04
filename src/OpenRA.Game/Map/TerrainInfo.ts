/**
 * TerrainInfo.ts — Terrain type system: Riser, TerrainTile, TerrainTypeInfo, TerrainTileInfo, TileSet
 * OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs (197 lines, single file)
 *               + OpenRA.Game/Map/TileReference.cs (TerrainTile struct, 46 lines)
 *               + OpenRA.Mods.Common/Terrain/DefaultTerrain.cs (registries, merged into TileSet per ADR)
 *
 * 核心范式转换:
 * - C# Riser readonly struct (ulong bits) → TS class wrapping Uint8Array(8)
 * - C# this[Connection c] indexer → direct arr[RiserConnection.UL] access
 * - C# TerrainTile (ushort type, byte index) → TS class (number, number)
 * - C# BitSet<TargetableType> → Set<string>
 * - C# ImmutableArray<string> → Set<string>
 * - C# Color struct (uint ARGB) → number (ARGB uint32) with hex parse/emit
 * - C# MersenneTwister → randomFloat parameter (0..1)
 * - C# FrozenDictionary → Map
 * - C# DefaultTerrain registries → merged into TileSet per ADR (architectural deviation)
 *
 * Architectural deviation:
 *   OpenRA's base TerrainTypeInfo class has NO static registry. The Mod layer
 *   (DefaultTerrain.cs) adds TerrainInfo[] and terrainIndexByType. Per the ADR,
 *   Phase C merges this into a static `TerrainTypeInfo.types: Map<string, ...>`
 *   for simplicity, avoiding a separate TerrainInfo registry class.
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
 * Names: neighbour cell (U=upper, R=right, D=down, L=left) +
 *        corner within that cell (L=left, R=right, U=upper, D=down).
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
 * Default Riser height value (0xFF = 255) — signals "use template height".
 *
 * OpenRA 对照: Riser.Default = byte.MaxValue
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
 * Wraps a Uint8Array(8) — one byte per RiserConnection direction.
 * Two parse formats:
 *   Long:  "6,6,0,0,0,0,6,6" — explicit byte per connection
 *   Short: "LU=6" — set all corners at the named sides, rest 0xFF (default)
 *
 * Direct access: `riser.values[RiserConnection.UL]` returns 0-255.
 * Check `value === RISER_DEFAULT` (0xFF) for unspecified connections.
 */
export class Riser {
  /** Height values indexed by RiserConnection (0-7), each 0–255.
   *
   * OpenRA 对照: Riser.bits indexed by byte position
   *
   * 0xFF (RISER_DEFAULT) = unspecified, use template height instead.
   */
  readonly values: Uint8Array

  // ---- Construction ----------------------------------------------------------

  /**
   * Create a Riser, optionally parsing a definition string.
   *
   * OpenRA 对照: Riser(MiniYaml my)
   *
   * @param definition — "6,6,0,0,0,0,6,6" (long), "LU=6" (short), or empty
   * @throws Error if the definition string is malformed
   */
  constructor(definition?: string) {
    if (!definition || definition.trim().length === 0) {
      this.values = new Uint8Array(RISER_CONNECTION_COUNT)
      this.values.fill(RISER_DEFAULT)
      return
    }

    // Try long form: 8 comma-separated values
    const commaParts = definition.split(',')
    if (commaParts.length === RISER_CONNECTION_COUNT) {
      this.values = Riser._parseLong(commaParts)
      return
    }

    // Try short form: KEY=VALUE
    const eqParts = definition.split('=')
    if (eqParts.length === 2) {
      this.values = Riser._parseShort(
        eqParts[0]!.trim().toUpperCase(),
        eqParts[1]!.trim(),
      )
      return
    }

    throw new Error(`"${definition}" is not a valid Riser definition`)
  }

  // ---- Convenience Access ----------------------------------------------------

  /**
   * Get the height value for a connection direction.
   *
   * OpenRA 对照: Riser.this[Connection c]
   *
   * @param direction — 0-7, maps to RiserConnection enum
   * @returns byte value (0-255); 0xFF = unspecified
   */
  getConnection(direction: number): number {
    return this.values[direction]!
  }

  // ---- Parsing (private) -----------------------------------------------------

  /**
   * Parse long form: "6,6,0,0,0,0,6,6".
   *
   * OpenRA 对照: Riser — 8 comma-separated path
   */
  private static _parseLong(parts: string[]): Uint8Array {
    const arr = new Uint8Array(RISER_CONNECTION_COUNT)
    for (let i = 0; i < RISER_CONNECTION_COUNT; i++) {
      const parsed = parseInt(parts[i]!.trim(), 10)
      if (!Number.isInteger(parsed)) {
        throw new Error(`"${parts.join(',')}" is not a valid Riser definition`)
      }
      arr[i] = parsed & 0xff
    }
    return arr
  }

  /**
   * Parse short form: "LU=6" → L+U connections = 6, rest 0xFF.
   *
   * OpenRA 对照: Riser — KEY=VALUE split path
   *
   * Set all slots to the value, then fill non-mentioned direction slots
   * with 0xFF. Direction letters: U (UL,UR), R (RU,RD), D (DR,DL), L (LD,LU).
   */
  private static _parseShort(key: string, valueStr: string): Uint8Array {
    const b = parseInt(valueStr, 10)
    if (!Number.isInteger(b)) {
      throw new Error(`"${key}=${valueStr}" is not a valid Riser definition`)
    }

    const arr = new Uint8Array(RISER_CONNECTION_COUNT)
    arr.fill(b & 0xff)

    // Revert non-mentioned direction slots to 0xFF.
    if (!key.includes('U')) {
      arr[RiserConnection.UL] = RISER_DEFAULT
      arr[RiserConnection.UR] = RISER_DEFAULT
    }
    if (!key.includes('R')) {
      arr[RiserConnection.RU] = RISER_DEFAULT
      arr[RiserConnection.RD] = RISER_DEFAULT
    }
    if (!key.includes('D')) {
      arr[RiserConnection.DR] = RISER_DEFAULT
      arr[RiserConnection.DL] = RISER_DEFAULT
    }
    if (!key.includes('L')) {
      arr[RiserConnection.LD] = RISER_DEFAULT
      arr[RiserConnection.LU] = RISER_DEFAULT
    }

    return arr
  }
}

// ---------------------------------------------------------------------------
// TerrainTile — minimal stub (from Phase E TileReference.cs, needed early)
// ---------------------------------------------------------------------------

/**
 * Minimal TerrainTile (ushort Type, byte Index) — stub extracted early
 * from Phase E (TileReference.cs, 46 lines).
 *
 * OpenRA 对照: TerrainTile readonly struct
 *
 * Identifies a specific tile within a template.
 * Full implementation (TryParse, ToString, GetHashCode) deferred to Phase E.
 */
export class TerrainTile {
  /** Template ID (ushort, 0-65535).
   *
   * OpenRA 对照: TerrainTile.Type
   */
  readonly type: number

  /** Index within the template (byte, 0-255).
   *
   * OpenRA 对照: TerrainTile.Index
   */
  readonly index: number

  constructor(type: number, index: number) {
    this.type = type & 0xffff
    this.index = index & 0xff
  }

  toString(): string {
    return `${this.type},${this.index}`
  }

  static tryParse(s: string): TerrainTile | null {
    const split = s.split(',')
    if (split.length !== 2) return null
    const type = parseInt(split[0]!, 10)
    const index = parseInt(split[1]!, 10)
    if (!Number.isInteger(type) || !Number.isInteger(index)) return null
    return new TerrainTile(type, index)
  }
}

// ---------------------------------------------------------------------------
// Color — utility functions for ARGB uint32
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string to ARGB uint32 (normalized to unsigned).
 *
 * OpenRA 对照: FieldLoader color parsing (hex string → Color(uint argb))
 *
 * "RRGGBB" → 0xFFRRGGBB, "AARRGGBB" → 0xAARRGGBB.
 */
export function parseColorHex(hex: string): number {
  const h = hex.replace(/^#/, '')
  if (h.length === 6) return ((0xff << 24) | parseInt(h, 16)) >>> 0
  if (h.length === 8) return parseInt(h, 16) >>> 0
  throw new Error(`Invalid color hex: "${hex}"`)
}

/**
 * Extract [A, R, G, B] components from ARGB uint32 (each 0-255).
 */
export function colorToComponents(argb: number): [number, number, number, number] {
  const u = argb >>> 0
  return [(u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff]
}

/**
 * Linear interpolation between two ARGB uint32 colors.
 *
 * OpenRA 对照: Exts.ColorLerp(float t, Color c1, Color c2)
 */
export function colorLerp(t: number, c1: number, c2: number): number {
  const [a1, r1, g1, b1] = colorToComponents(c1)
  const [a2, r2, g2, b2] = colorToComponents(c2)
  return (
    ((Math.round(t * a2 + (1 - t) * a1) & 0xff) << 24) |
    ((Math.round(t * r2 + (1 - t) * r1) & 0xff) << 16) |
    ((Math.round(t * g2 + (1 - t) * g1) & 0xff) << 8) |
    (Math.round(t * b2 + (1 - t) * b1) & 0xff)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// JSON import interfaces
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

/** JSON shape for a single tile template. */
export interface TileTemplateJson {
  id: number
  size: { x: number; y: number }
  pickAny?: boolean
  categories?: string[]
  tiles: (TerrainTileInfoJson | null)[]
}

/** Top-level JSON shape for a compiled tileset. */
export interface TileSetJson {
  terrainTypes: TerrainTypeInfoJson[]
  templates: TileTemplateJson[]
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
 * NOTE (architectural deviation): OpenRA's base TerrainTypeInfo has NO static
 * registry. The `static types` Map is added per the ADR, merging the Mod-layer
 * `DefaultTerrain.TerrainInfo[]` + `terrainIndexByType` into Phase C for
 * simplicity. This avoids a separate TerrainInfo registry class.
 */
export class TerrainTypeInfo {
  readonly type: string
  readonly targetTypes: Set<string>
  readonly acceptsSmudgeType: Set<string>
  /** ARGB uint32 — editor/minimap color for this terrain type. */
  readonly color: number
  readonly restrictPlayerColor: boolean

  /**
   * Static registry of all loaded terrain types, keyed by name.
   *
   * OpenRA 对照: DefaultTerrain.terrainIndexByType + TerrainInfo[] (merged per ADR)
   *
   * Populated during TileSet.fromJSON().
   */
  static readonly types: Map<string, TerrainTypeInfo> = new Map()

  /** Look up a terrain type by name. */
  static byName(name: string): TerrainTypeInfo | undefined {
    return this.types.get(name)
  }

  constructor(json: TerrainTypeInfoJson) {
    this.type = json.type
    this.targetTypes = new Set(json.targetTypes ?? [])
    this.acceptsSmudgeType = new Set(json.acceptsSmudgeType ?? [])
    this.color = parseColorHex(json.color)
    this.restrictPlayerColor = json.restrictPlayerColor ?? false
  }

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
 * terrainType is a **byte index** into the terrain type list. TileSet
 * provides the lookup to get the TerrainTypeInfo from this index.
 */
export class TerrainTileInfo {
  /** Byte index into the terrain type list (0-254).
   *
   * OpenRA 对照: TerrainTileInfo.TerrainType
   */
  readonly terrainType: number

  /** Base height (0-255).
   *
   * OpenRA 对照: TerrainTileInfo.Height
   */
  readonly height: number

  /** Index into the ramp array for slope shape.
   *
   * OpenRA 对照: TerrainTileInfo.RampType
   */
  readonly rampType: number

  /** Minimum color tint (ARGB uint32).
   *
   * OpenRA 对照: TerrainTileInfo.MinColor
   */
  readonly minColor: number

  /** Maximum color tint (ARGB uint32).
   *
   * OpenRA 对照: TerrainTileInfo.MaxColor
   */
  readonly maxColor: number

  /** Neighbour-corner height offsets.
   *
   * OpenRA 对照: TerrainTileInfo.Riser
   */
  readonly riser: Riser

  /**
   * Create from JSON tile data.
   *
   * OpenRA 对照: FieldLoader.Load(tile, my) + terrain type name → byte index
   *
   * @param json — JSON tile entry (terrainType = type name, resolved to index)
   * @param terrainIndexByName — terrain type name → byte index
   * @param defaultColor — fallback ARGB color from the terrain type
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

    this.minColor = json.minColor ? parseColorHex(json.minColor) : defaultColor
    this.maxColor = json.maxColor ? parseColorHex(json.maxColor) : defaultColor

    this.riser = new Riser(json.riser)
  }

  // ---- Color Interpolation -------------------------------------------------

  /**
   * Get a randomised color tint.
   *
   * OpenRA 对照: TerrainTileInfo.GetColor(MersenneTwister random)
   *
   * Linearly interpolates between minColor and maxColor when they differ.
   *
   * @param randomFloat — random value in [0, 1]
   * @returns ARGB uint32
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
// OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs TileSet (constant)
//               + DefaultTerrain registries (merged per ADR)
// ---------------------------------------------------------------------------

/**
 * Static registry for terrain types, tiles, and palette constants.
 *
 * OpenRA 对照: TileSet + DefaultTerrain (merged per ADR)
 *
 * Lookup chain:
 *   TerrainTile(Type, Index) → TileSet.getTileInfo(tile) → TerrainTileInfo
 *   → .terrainType (byte) → TileSet.terrainTypes[byte] → TerrainTypeInfo
 */
export class TileSet {
  /** Palette name for terrain rendering.
   *
   * OpenRA 对照: TileSet.TerrainPaletteInternalName
   */
  static readonly TerrainPaletteInternalName = 'terrain'

  /** All terrain types, keyed by name (e.g. "Clear").
   *
   * OpenRA 对照: DefaultTerrain.TerrainInfo (ImmutableArray) + terrainIndexByType
   *
   * Maximum 254 entries (byte.MaxValue - 1).
   */
  static readonly terrainTypes: Map<string, TerrainTypeInfo> = new Map()

  /**
   * All individual tiles, keyed by combined (templateId << 8 | tileIndex).
   *
   * OpenRA 对照: flattened Templates[type][index] lookup
   */
  static readonly tiles: Map<number, TerrainTileInfo> = new Map()

  /** Terrain type name → byte index (internal). */
  private static _terrainIndexByName: Map<string, number> = new Map()

  // ---- Lookup Methods -------------------------------------------------------

  /**
   * Look up TerrainTileInfo from a TerrainTile.
   *
   * OpenRA 对照: DefaultTerrain.GetTileInfo(TerrainTile r)
   *
   * @param tile — TerrainTile (type = template ID, index = tile index)
   * @throws Error if not found
   */
  static getTileInfo(tile: TerrainTile): TerrainTileInfo {
    const key = makeTileKey(tile.type, tile.index)
    const info = this.tiles.get(key)
    if (!info) throw new Error(`Tile ${tile} not found in TileSet`)
    return info
  }

  /**
   * Look up TerrainTypeInfo by name.
   *
   * OpenRA 对照: DefaultTerrain this[byte index] + TerrainInfo[index]
   *
   * @param name — terrain type name (e.g. "Clear")
   * @returns TerrainTypeInfo
   * @throws Error if not found
   */
  static getTerrainType(name: string): TerrainTypeInfo {
    const info = this.terrainTypes.get(name)
    if (!info) throw new Error(`Terrain type "${name}" not found in TileSet`)
    return info
  }

  /**
   * Get the byte index for a terrain type name.
   *
   * OpenRA 对照: DefaultTerrain.GetTerrainIndex(string type)
   */
  static getTerrainIndex(name: string): number {
    const idx = this._terrainIndexByName.get(name)
    if (idx === undefined)
      throw new Error(`Terrain type "${name}" not found in TileSet`)
    return idx
  }

  // ---- Loading --------------------------------------------------------------

  /**
   * Factory: load the TileSet from compiled JSON.
   *
   * OpenRA 对照: new DefaultTerrain(fileSystem, filepath)
   *
   * @param json — compiled tileset JSON (build-time YAML→JSON)
   * @returns TileSet class for fluent chaining
   * @throws Error on duplicates, too many types, or invalid references
   */
  static fromJSON(json: TileSetJson): typeof TileSet {
    this.clear()

    // Phase 1: Load terrain types
    if (json.terrainTypes.length >= 255) {
      throw new Error('Too many terrain types (max 254)')
    }

    const terrainIndexByName = new Map<string, number>()
    for (let i = 0; i < json.terrainTypes.length; i++) {
      const entry = json.terrainTypes[i]!
      const tt = TerrainTypeInfo.fromJSON(entry)

      if (this.terrainTypes.has(tt.type)) {
        throw new Error(`Duplicate terrain type "${tt.type}"`)
      }
      if (TerrainTypeInfo.types.has(tt.type)) {
        throw new Error(`Duplicate terrain type "${tt.type}"`)
      }

      this.terrainTypes.set(tt.type, tt)
      TerrainTypeInfo.types.set(tt.type, tt)
      terrainIndexByName.set(tt.type, i)
    }
    this._terrainIndexByName = terrainIndexByName

    // Phase 2: Load templates and their tiles
    for (const tplJson of json.templates) {
      for (let ti = 0; ti < tplJson.tiles.length; ti++) {
        const tileJson = tplJson.tiles[ti]
        if (!tileJson) continue

        const tt = this.terrainTypes.get(tileJson.terrainType)
        const defaultColor = tt ? tt.color : 0xff000000

        const tileInfo = new TerrainTileInfo(
          tileJson,
          terrainIndexByName,
          defaultColor,
        )

        const key = makeTileKey(tplJson.id, ti)
        if (this.tiles.has(key)) {
          throw new Error(`Duplicate tile key ${tplJson.id},${ti} in tileset`)
        }
        this.tiles.set(key, tileInfo)
      }
    }

    return this
  }

  /** Clear all loaded data. */
  static clear(): void {
    this.terrainTypes.clear()
    this.tiles.clear()
    this._terrainIndexByName.clear()
    TerrainTypeInfo.types.clear()
  }
}

// ---------------------------------------------------------------------------
// makeTileKey — combine template ID and tile index into a single key
// ---------------------------------------------------------------------------

/** Pack (templateId:ushort, tileIndex:byte) into a single number. */
export function makeTileKey(templateId: number, tileIndex: number): number {
  return ((templateId & 0xffff) << 8) | (tileIndex & 0xff)
}

/** Extract template ID from combined key. */
export function templateIdFromKey(key: number): number {
  return (key >> 8) & 0xffff
}

/** Extract tile index from combined key. */
export function tileIndexFromKey(key: number): number {
  return key & 0xff
}
