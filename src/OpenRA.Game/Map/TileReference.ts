/**
 * TileReference.ts — TerrainTile and ResourceTile value types
 * OpenRA 对照: OpenRA.Game/Map/TileReference.cs (46 lines)
 *
 * 核心范式转换:
 * - C# readonly struct → TypeScript interface (structural typing)
 * - C# GetHashCode / TryParse → TypeScript utility functions
 * - C# default(TerrainTile) → DEFAULT_TERRAIN_TILE const
 *
 * NOTE: TryParse is deferred — YAML string→tile conversion requires
 *       Exts.TryParseUshortInvariant (Phase E or Chapter 5).
 */

// ---------------------------------------------------------------------------
// TerrainTile — tile type + variant index (value type)
// OpenRA 对照: TerrainTile(ushort type, byte index) readonly struct
// ---------------------------------------------------------------------------

/** Terrain tile reference: combined template+tile key and variant index.
 *
 * OpenRA 对照: TerrainTile(ushort Type, byte Index)
 *
 * The Type field encodes (TemplateId << 8) | TileIndex, identifying the
 * specific terrain template and which tile within that template to use.
 * The Index field is the PickAny variant selector.
 */
export interface TerrainTile {
  /** Combined template+tile key (templateId << 8) | tileIndex. */
  readonly type: number
  /** Variant / PickAny index within the template. */
  readonly index: number
}

/** Default zero terrain tile.
 *
 * OpenRA 对照: default(TerrainTile) = (Type: 0, Index: 0)
 */
export const DEFAULT_TERRAIN_TILE: TerrainTile = { type: 0, index: 0 }

// ---------------------------------------------------------------------------
// ResourceTile — resource type + density (value type)
// OpenRA 对照: ResourceTile(byte type, byte index) readonly struct
// ---------------------------------------------------------------------------

/** Resource deposit on a cell.
 *
 * OpenRA 对照: ResourceTile(byte Type, byte Index)
 *
 * Type 0 indicates no resource. Non-zero types correspond to resource
 * definitions in the map rules.
 */
export interface ResourceTile {
  /** Resource type ID (0 = no resource). */
  readonly type: number
  /** Resource density/amount. */
  readonly index: number
}

/** Default zero resource tile.
 *
 * OpenRA 对照: default(ResourceTile) = (Type: 0, Index: 0)
 */
export const DEFAULT_RESOURCE_TILE: ResourceTile = { type: 0, index: 0 }

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Create a TerrainTile.
 *
 * OpenRA 对照: new TerrainTile(type, index)
 */
export function createTerrainTile(type: number, index: number): TerrainTile {
  return { type, index }
}

/**
 * Create a ResourceTile.
 *
 * OpenRA 对照: new ResourceTile(type, index)
 */
export function createResourceTile(type: number, index: number): ResourceTile {
  return { type, index }
}

/**
 * Check if two TerrainTiles are equal.
 *
 * OpenRA 对照: TerrainTile.Equals() via GetHashCode
 */
export function terrainTileEquals(a: TerrainTile, b: TerrainTile): boolean {
  return a.type === b.type && a.index === b.index
}

/**
 * Check if two ResourceTiles are equal.
 *
 * OpenRA 对照: ResourceTile.Equals() via GetHashCode
 */
export function resourceTileEquals(a: ResourceTile, b: ResourceTile): boolean {
  return a.type === b.type && a.index === b.index
}
