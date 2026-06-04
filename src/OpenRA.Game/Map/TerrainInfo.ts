/**
 * TerrainInfo.ts — Terrain type system: TerrainTypeInfo, TerrainTileInfo, TileSet
 * OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs (Riser, TerrainTileInfo, TerrainTypeInfo, TileSet)
 *               + OpenRA.Mods.Common/Terrain/TerrainInfo.cs (TerrainTemplateInfo)
 *               + OpenRA.Mods.Common/Terrain/DefaultTerrain.cs (DefaultTerrain)
 *
 * 核心范式转换:
 * - C# Riser readonly struct (ulong bits) → Int8Array (8 signed byte directions)
 * - C# BitSet<TargetableType> → Set<string>
 * - C# ImmutableArray<string> (acceptsSmudgeType) → Set<string>
 * - C# FrozenDictionary → Map
 * - C# MiniYaml parsing → JSON parsing (build-time YAML→JSON)
 * - C# FieldLoader.Load() + reflection → explicit JSON property extraction
 * - C# Color struct (uint ARGB) → number (ARGB uint32) with hex parse/emit
 * - C# MersenneTwister → randomFloat parameter (0..1)
 * - C# object initializer → no parameterless construction
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
 *
 * Example: UL means "Upper neighbour cell, Leftward adjoining corner"
 * Example: LU means "Leftward neighbour cell, Upper adjoining corner"
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
 * OpenRA 对照: Riser.Default = byte.MaxValue (255 unsigned → -1 signed in Int8)
 */
export const RISER_DEFAULT = -1

// ---------------------------------------------------------------------------
// Color — utility functions for ARGB uint32 used by TerrainInfo
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
 * @returns ARGB uint32
 */
export function parseColorHex(hex: string): number {
  const h = hex.replace(/^#/, '')
  if (h.length === 6) {
    // >>> 0 normalizes to unsigned 32-bit (JS bitwise ops produce signed int32)
    return ((0xff << 24) | parseInt(h, 16)) >>> 0
  }
  if (h.length === 8) {
    return parseInt(h, 16) >>> 0
  }
  throw new Error(`Invalid color hex: "${hex}"`)
}

/**
 * Extract ARGB components from a uint32 ARGB color.
 *
 * @param argb — ARGB uint32 color
 * @returns [A, R, G, B] tuple (each 0-255)
 */
export function colorToComponents(argb: number): [number, number, number, number] {
  // Normalize to unsigned 32-bit before extracting components
  const u = argb >>> 0
  const a = (u >>> 24) & 0xff
  const r = (u >>> 16) & 0xff
  const g = (u >>> 8) & 0xff
  const b = u & 0xff
  return [a, r, g, b]
}

/**
 * Linear interpolation between two ARGB uint32 colors.
 *
 * OpenRA 对照: Exts.ColorLerp(float t, Color c1, Color c2)
 *
 * @param t — interpolation factor (0..1)
 * @param c1 — start color (ARGB uint32)
 * @param c2 — end color (ARGB uint32)
 * @returns interpolated color (ARGB uint32)
 */
export function colorLerp(t: number, c1: number, c2: number): number {
  const [a1, r1, g1, b1] = colorToComponents(c1)
  const [a2, r2, g2, b2] = colorToComponents(c2)
  const a = Math.round(t * a2 + (1 - t) * a1)
  const r = Math.round(t * r2 + (1 - t) * r1)
  const g = Math.round(t * g2 + (1 - t) * g1)
  const b = Math.round(t * b2 + (1 - t) * b1)
  // >>> 0 normalizes to unsigned 32-bit
  return (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0
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
 * Terrain types define the classification of map cells. Each type has a unique
 * string name, visual color for the minimap/editor, and optional gameplay
 * flags: what target types can pass, and what smudge types the terrain accepts.
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
   * Populated during TileSet.loadFromJson().
   */
  static readonly types: Map<string, TerrainTypeInfo> = new Map()

  /**
   * Look up a terrain type by name, or undefined if not registered.
   *
   * @param name — terrain type name (e.g. "Clear")
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
   * Factory: create a TerrainTypeInfo from a JSON entry.
   *
   * OpenRA 对照: new TerrainTypeInfo(MiniYaml my)
   *
   * @param json — JSON terrain type data
   * @returns new TerrainTypeInfo instance
   */
  static fromJSON(json: TerrainTypeInfoJson): TerrainTypeInfo {
    return new TerrainTypeInfo(json)
  }
}

// ---------------------------------------------------------------------------
// TerrainTileInfo
// OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs TerrainTileInfo class
//               + OpenRA.Mods.Common/Terrain/DefaultTerrain.cs DefaultTerrainTileInfo
// ---------------------------------------------------------------------------

/**
 * Metadata for a single tile within a tile template.
 *
 * OpenRA 对照: TerrainTileInfo
 *
 * Each tile in a template has its own terrain type classification, height,
 * ramp shape index, per-vertex color tint range, and optional Riser heights
 * for cliff/wall discontinuities with neighbouring cells.
 */
export class TerrainTileInfo {
  /** Index into TileSet.terrainTypes for this tile's terrain classification.
   *
   * OpenRA 对照: TerrainTileInfo.TerrainType
   */
  readonly terrainType: number

  /** Base height of this tile (0-255, scaled in the 3D mesh).
   *
   * OpenRA 对照: TerrainTileInfo.Height
   */
  readonly height: number

  /** Index into MapGrid.ramps[] array for this tile's slope shape.
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
   * Eight neighbour-corner height offsets relative to template height.
   *
   * OpenRA 对照: TerrainTileInfo.Riser (Riser struct → Int8Array)
   *
   * Indices follow RiserConnection enum order:
   *   [UL, UR, RU, RD, DR, DL, LD, LU]
   *
   * Each value is the expected height of the neighbouring cell's
   * connecting corner. A value of RISER_DEFAULT (-1) means "use the
   * tile's Height value instead".
   */
  readonly riser: Int8Array

  /**
   * Create a TerrainTileInfo.
   *
   * OpenRA 对照: FieldLoader.Load(tile, my) + terrain type resolution
   *
   * @param json — JSON tile data
   * @param terrainIndexByName — map from terrain type name → byte index
   * @param defaultColor — fallback ARGB color from TerrainTypeInfo (if
   *   minColor/maxColor not specified in JSON)
   */
  constructor(
    json: TerrainTileInfoJson,
    terrainIndexByName: ReadonlyMap<string, number>,
    defaultColor: number,
  ) {
    // Resolve terrain type name → index
    const idx = terrainIndexByName.get(json.terrainType)
    if (idx === undefined) {
      throw new Error(
        `Unknown terrain type "${json.terrainType}" in tile definition`,
      )
    }
    this.terrainType = idx

    this.height = json.height ?? 0
    this.rampType = json.rampType ?? 0

    // Parse color overrides, falling back to terrain type default color.
    // OpenRA uses `default` struct comparison (Color(uint) == 0 → false,
    // since default Color has ARGB=0).
    this.minColor = json.minColor ? parseColorHex(json.minColor) : defaultColor
    this.maxColor = json.maxColor ? parseColorHex(json.maxColor) : defaultColor

    // Parse Riser definition
    this.riser = TerrainTileInfo.parseRiser(json.riser ?? '')
  }

  // ---- Riser Parsing -------------------------------------------------------

  /**
   * Parse a Riser definition string to an Int8Array of 8 signed byte heights.
   *
   * OpenRA 对照: Riser(MiniYaml my) constructor
   *
   * Two formats are accepted:
   *
   * **Long form** (8 comma-separated values):
   *   `"6,6,0,0,0,0,6,6"` — each value at RiserConnection index order
   *   (UL=0, UR=1, RU=2, RD=3, DR=4, DL=5, LD=6, LU=7).
   *
   * **Short form** (direction letters + value):
   *   `"LU=6"` — set all corners at the specified direction sides to value 6,
   *   leaving non-mentioned sides as RISER_DEFAULT (-1).
   *   U = upper side (UL, UR), R = right side (RU, RD),
   *   D = down side (DR, DL), L = left side (LD, LU).
   *
   * Empty string → all RISER_DEFAULT.
   *
   * @param definition — Riser definition string (may be empty)
   * @returns Int8Array of 8 signed byte heights
   * @throws Error if the definition is malformed
   */
  static parseRiser(definition: string): Int8Array {
    // Create result pre-filled with RISER_DEFAULT
    const result = new Int8Array(RISER_CONNECTION_COUNT)
    result.fill(RISER_DEFAULT)

    if (!definition || definition.trim().length === 0) return result

    // Try long form: 8 comma-separated values
    const commaParts = definition.split(',')
    if (commaParts.length === RISER_CONNECTION_COUNT) {
      for (let i = 0; i < RISER_CONNECTION_COUNT; i++) {
        const parsed = parseInt(commaParts[i]!.trim(), 10)
        if (!Number.isInteger(parsed)) {
          throw new Error(
            `"${definition}" is not a valid Riser definition`,
          )
        }
        result[i] = parsed
      }
      return result
    }

    // Try short form: KEY=VALUE
    const eqParts = definition.split('=')
    if (eqParts.length === 2) {
      const key = eqParts[0]!.trim().toUpperCase()
      const value = parseInt(eqParts[1]!.trim(), 10)
      if (!Number.isInteger(value)) {
        throw new Error(
          `"${definition}" is not a valid Riser definition`,
        )
      }

      // Set all 8 positions to the value
      result.fill(value)

      // OpenRA 对照:
      //   If key doesn't contain 'U' → UL, UR revert to default (0xFF)
      //   If key doesn't contain 'R' → RU, RD revert to default
      //   If key doesn't contain 'D' → DR, DL revert to default
      //   If key doesn't contain 'L' → LD, LU revert to default
      if (!key.includes('U')) {
        result[RiserConnection.UL] = RISER_DEFAULT
        result[RiserConnection.UR] = RISER_DEFAULT
      }
      if (!key.includes('R')) {
        result[RiserConnection.RU] = RISER_DEFAULT
        result[RiserConnection.RD] = RISER_DEFAULT
      }
      if (!key.includes('D')) {
        result[RiserConnection.DR] = RISER_DEFAULT
        result[RiserConnection.DL] = RISER_DEFAULT
      }
      if (!key.includes('L')) {
        result[RiserConnection.LD] = RISER_DEFAULT
        result[RiserConnection.LU] = RISER_DEFAULT
      }

      return result
    }

    throw new Error(`"${definition}" is not a valid Riser definition`)
  }

  /**
   * Get the Riser height for a specific connection direction.
   *
   * OpenRA 对照: Riser.this[Connection c]
   *
   * @param connection — connection direction index (0-7)
   * @returns height value, or RISER_DEFAULT (-1) if not specified
   */
  getRiserHeight(connection: RiserConnection): number {
    return this.riser[connection]!
  }

  // ---- Color Interpolation -------------------------------------------------

  /**
   * Get a randomised color tint for this tile.
   *
   * OpenRA 对照: TerrainTileInfo.GetColor(MersenneTwister random)
   *
   * If minColor and maxColor differ, linearly interpolate between them.
   * Otherwise return minColor.
   *
   * @param randomFloat — random value in [0, 1] (replaces MersenneTwister.NextFloat())
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
// TileTemplate
// OpenRA 对照: TerrainTemplateInfo (OpenRA.Mods.Common/Terrain/TerrainInfo.cs)
// ---------------------------------------------------------------------------

/**
 * A tile template defining a multi-tile shape from a tileset.
 *
 * OpenRA 对照: TerrainTemplateInfo
 *
 * Each template has a unique numeric ID, a rectangular Size (e.g. 1×1, 2×2),
 * and an array of TerrainTileInfo for each cell in the template.
 * If `pickAny` is true, any single tile from the template can be chosen
 * at random for placement.
 */
export interface TileTemplate {
  /** Unique template ID (ushort in OpenRA).
   *
   * OpenRA 对照: TerrainTemplateInfo.Id
   */
  readonly id: number

  /** Width and height of the template in cells.
   *
   * OpenRA 对照: TerrainTemplateInfo.Size (int2)
   */
  readonly size: { x: number; y: number }

  /** If true, a random single tile is chosen instead of the full shape.
   *
   * OpenRA 对照: TerrainTemplateInfo.PickAny
   */
  readonly pickAny: boolean

  /** Optional editor categories for grouping templates.
   *
   * OpenRA 对照: TerrainTemplateInfo.Categories
   */
  readonly categories: readonly string[]

  /**
   * Tile info for each cell in row-major order.
   *
   * OpenRA 对照: TerrainTemplateInfo.tileInfo[]
   *
   * Length = size.x * size.y (or tiles.length for PickAny).
   * May contain null entries for un-filled cells.
   */
  readonly tiles: readonly (TerrainTileInfo | null)[]

  /** Number of tiles in this template.
   *
   * OpenRA 对照: TerrainTemplateInfo.TilesCount
   */
  readonly tilesCount: number
}

// ---------------------------------------------------------------------------
// TileSet
// OpenRA 对照: OpenRA.Game/Map/TerrainInfo.cs TileSet (constant)
//               + DefaultTerrain (ITerrainInfo + ITemplatedTerrainInfo impl)
// ---------------------------------------------------------------------------

/**
 * Static registry indexing terrain templates, tiles, and types from a
 * compiled JSON tileset.
 *
 * OpenRA 对照: TileSet static class + DefaultTerrain
 *
 * The TileSet is loaded once at startup from a build-time compiled JSON
 * version of the original YAML tileset definition. After loading, terrain
 * types, templates, and individual tiles can be looked up by their keys.
 *
 * NOTE: OpenRA's TileSet is a static class with only a single constant
 * (`TerrainPaletteInternalName = "terrain"`). The migration plan merges
 * `DefaultTerrain`'s indexing responsibilities into TileSet for simplicity,
 * since DefaultTerrain depends on MiniYaml loading and mod infrastructure
 * that will be migrated later (Phase H).
 */
export class TileSet {
  /** Palette name for terrain rendering.
   *
   * OpenRA 对照: TileSet.TerrainPaletteInternalName
   */
  static readonly TerrainPaletteInternalName = 'terrain'

  /** All loaded tile templates, keyed by template ID as a string.
   *
   * OpenRA 对照: DefaultTerrain.Templates (FrozenDictionary<ushort, TerrainTemplateInfo>)
   *
   * NOTE: OpenRA keys templates by ushort ID. The migration stores IDs as
   * strings for JSON compatibility (build-time YAML -> JSON preserves template
   * IDs as string keys from `Template@255` syntax).
   */
  static readonly templates: Map<string, TileTemplate> = new Map()

  /**
   * All individual tiles, keyed by combined (templateId << 8 | tileIndex).
   *
   * OpenRA 对照: flattened view of DefaultTerrain.Templates[...].tileInfo[i]
   *
   * This allows O(1) lookup of any tile given its TerrainTile (type, index).
   */
  static readonly tiles: Map<number, TerrainTileInfo> = new Map()

  /** All terrain types, keyed by type name.
   *
   * OpenRA 对照: DefaultTerrain.TerrainInfo + terrainIndexByType
   */
  static readonly terrainTypes: Map<string, TerrainTypeInfo> = new Map()

  /** Terrain type name → byte index (internal, for tile construction).
   *
   * OpenRA 对照: DefaultTerrain.terrainIndexByType
   */
  private static _terrainIndexByName: Map<string, number> = new Map()

  // ---- Lookup Methods -------------------------------------------------------

  /**
   * Look up the TerrainTileInfo for a given combined tile key.
   *
   * OpenRA 对照: DefaultTerrain.GetTileInfo(TerrainTile r)
   *
   * @param tileKey — combined key: (templateId << 8) | tileIndex
   * @returns the tile info
   * @throws Error if the tile is not found
   */
  static getTileInfo(tileKey: number): TerrainTileInfo {
    const info = this.tiles.get(tileKey)
    if (!info) {
      throw new Error(`Tile ${tileKey >> 8},${tileKey & 0xff} not found in TileSet`)
    }
    return info
  }

  /**
   * Look up the TerrainTileInfo for a given template and tile index.
   *
   * OpenRA 对照: DefaultTerrain.Templates[r.Type][r.Index]
   *
   * @param templateId — template ID (ushort in OpenRA)
   * @param tileIndex — index within the template
   * @returns the tile info
   * @throws Error if not found
   */
  static getTileInfoByTemplate(
    templateId: number,
    tileIndex: number,
  ): TerrainTileInfo {
    return this.getTileInfo(makeTileKey(templateId, tileIndex))
  }

  /**
   * Try to look up a TerrainTileInfo, returning null if not found.
   *
   * OpenRA 对照: DefaultTerrain.TryGetTileInfo(TerrainTile r, out info)
   *
   * @param tileKey — combined key
   * @returns tile info or null
   */
  static tryGetTileInfo(tileKey: number): TerrainTileInfo | null {
    return this.tiles.get(tileKey) ?? null
  }

  /**
   * Look up a TerrainTypeInfo by name.
   *
   * OpenRA 对照: DefaultTerrain.GetTerrainIndex(string type) (returns index)
   *
   * @param name — terrain type name (e.g. "Clear")
   * @returns the TerrainTypeInfo
   * @throws Error if the type is not found
   */
  static getTerrainType(name: string): TerrainTypeInfo {
    const info = this.terrainTypes.get(name)
    if (!info) {
      throw new Error(`Terrain type "${name}" not found in TileSet`)
    }
    return info
  }

  /**
   * Get the byte index for a terrain type name.
   *
   * OpenRA 对照: DefaultTerrain.GetTerrainIndex(string type)
   *
   * @param name — terrain type name
   * @returns byte index (0-254)
   * @throws Error if the type is not found
   */
  static getTerrainIndex(name: string): number {
    const idx = this._terrainIndexByName.get(name)
    if (idx === undefined) {
      throw new Error(`Terrain type "${name}" not found in TileSet`)
    }
    return idx
  }

  // ---- Loading --------------------------------------------------------------

  /**
   * Factory: load the TileSet from a compiled JSON tileset definition.
   *
   * OpenRA 对照: DefaultTerrain(IReadOnlyFileSystem, string filepath)
   *
   * This replaces the YAML parsing pipeline. The JSON is expected to be
   * pre-compiled at build time by the MiniYAML→JSON pipeline (Phase H).
   *
   * @param json — compiled tileset JSON
   * @returns the TileSet class (for fluent chaining)
   * @throws Error if there are duplicate terrain types or invalid references
   */
  static fromJSON(json: TileSetJson): typeof TileSet {
    // Clear existing state
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
      // Build tiles array
      const tiles: (TerrainTileInfo | null)[] = []

      for (let ti = 0; ti < tplJson.tiles.length; ti++) {
        const tileJson = tplJson.tiles[ti]
        if (!tileJson) {
          tiles.push(null)
          continue
        }

        // Determine default color from the terrain type
        const tt = this.terrainTypes.get(tileJson.terrainType)
        const defaultColor = tt ? tt.color : 0xff000000

        const tileInfo = new TerrainTileInfo(
          tileJson,
          terrainIndexByName,
          defaultColor,
        )
        tiles.push(tileInfo)

        // Register in the global tiles map
        const key = makeTileKey(tplJson.id, ti)
        if (this.tiles.has(key)) {
          throw new Error(
            `Duplicate tile key ${tplJson.id},${ti} in tileset`,
          )
        }
        this.tiles.set(key, tileInfo)
      }

      const tpl: TileTemplate = {
        id: tplJson.id,
        size: tplJson.size,
        pickAny: tplJson.pickAny ?? false,
        categories: Object.freeze(
          (tplJson.categories ?? []).slice(),
        ) as readonly string[],
        tiles: Object.freeze(tiles) as readonly (TerrainTileInfo | null)[],
        tilesCount: tplJson.pickAny
          ? tiles.filter((t) => t !== null).length
          : tplJson.size.x * tplJson.size.y,
      }

      this.templates.set(String(tpl.id), tpl)
    }

    return this
  }

  /** Clear all loaded data. Useful for tests. */
  static clear(): void {
    this.templates.clear()
    this.tiles.clear()
    this.terrainTypes.clear()
    this._terrainIndexByName.clear()
    TerrainTypeInfo.types.clear()
  }
}

// ---------------------------------------------------------------------------
// makeTileKey — combine template ID and tile index into a single key
// ---------------------------------------------------------------------------

/**
 * Create a combined tile key from template ID and tile index.
 *
 * OpenRA 对照: None (utility, replaces TerrainTile struct as lookup key)
 *
 * Uses `(templateId << 8) | tileIndex` to pack both values into a single
 * number. templateId is ushort (0-65535, uses lower 16 bits); tileIndex is
 * byte (0-255, uses lower 8 bits).
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
 *
 * @param key — combined key from makeTileKey()
 * @returns template ID
 */
export function templateIdFromKey(key: number): number {
  return (key >> 8) & 0xffff
}

/**
 * Extract the tile index from a combined tile key.
 *
 * @param key — combined key from makeTileKey()
 * @returns tile index within the template
 */
export function tileIndexFromKey(key: number): number {
  return key & 0xff
}
