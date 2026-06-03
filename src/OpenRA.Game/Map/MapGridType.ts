/**
 * MapGridType.ts — Map grid type enumeration
 * OpenRA 对照: OpenRA.Game/Map/MapGrid.cs (MapGridType enum)
 *
 * 核心范式转换:
 * - C# enum → TypeScript const enum-like object
 */

// ---------------------------------------------------------------------------
// MapGridType
// ---------------------------------------------------------------------------

/**
 * Map grid type enumeration.
 *
 * OpenRA 对照: MapGridType enum
 *
 * Rectangular: standard orthogonal grid (TD/RA style)
 * RectangularIsometric: staggered isometric grid (C&C/TS style)
 */
export const MapGridType = {
  /** Standard orthogonal grid (TD/RA style). */
  Rectangular: 0,
  /** Staggered isometric grid (C&C/TS style). */
  RectangularIsometric: 1,
} as const

export type MapGridType = (typeof MapGridType)[keyof typeof MapGridType]
