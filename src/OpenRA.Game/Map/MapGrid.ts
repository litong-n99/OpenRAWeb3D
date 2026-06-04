/**
 * MapGrid.ts — Map grid geometry with deterministic tile distance lookup tables
 * OpenRA 对照: OpenRA.Game/Map/MapGrid.cs (256 lines C#)
 *
 * 核心范式转换:
 * - C# ImmutableArray<T> → readonly T[] (frozen via Object.freeze)
 * - C# MiniYaml constructor (FieldLoader.Load) → plain config object
 * - C# ISqrt(…, Ceiling) → Exts.isqrtCeiling()
 * - C# CVec.GetHashCode() → CVec.hashCode()
 * - CellRamp, RampCornerHeight, RampSplit extracted → CellRamp.ts
 */

import { WVec } from '../WVec'
import { WRot } from '../WRot'
import { WAngle } from '../WAngle'
import { CVec } from '../CVec'
import { isqrtCeiling } from '../Exts'
import { MapGridType } from './MapGridType'
import { SubCell } from '../Traits/SubCell'
import { CellRamp, RampCornerHeight, RampSplit } from './CellRamp'

// ---------------------------------------------------------------------------
// Re-export ramp types for backward compatibility
// ---------------------------------------------------------------------------

export { CellRamp, RampCornerHeight, RampSplit, type CellRampOptions } from './CellRamp'

// ---------------------------------------------------------------------------
// MapGrid configuration interface (MiniYaml replacement)
// ---------------------------------------------------------------------------

/**
 * Configuration object for MapGrid construction.
 *
 * OpenRA 对照: MiniYaml map grid node parsed by FieldLoader.Load()
 *
 * NOTE: MiniYaml preprocessing pipeline is deferred to Phase H.
 *   For now, MapGrid accepts a plain config object.
 */
export interface MapGridConfig {
  /** Grid type. Default: Rectangular. */
  type?: MapGridType
  /** Maximum terrain height in cell-heights. Default: 0. */
  maximumTerrainHeight?: number
  /** Default sub-cell index for targeting. Default: middle sub-cell (3).
   *
   * NOTE: Accepts `number` rather than `SubCell` to allow indices 2-5
   *   which are valid sub-cell positions but not members of the SubCell enum.
   */
  defaultSubCell?: number
  /** Maximum tile search range for TilesByDistance. Default: 50. */
  maximumTileSearchRange?: number
  /** Whether depth buffer is enabled for this grid. Default: false. */
  enableDepthBuffer?: boolean
}

// ---------------------------------------------------------------------------
// MapGrid (OpenRA 对照: MapGrid class : IGlobalModData)
// ---------------------------------------------------------------------------

/**
 * Grid geometry configuration for a map.
 *
 * OpenRA 对照: MapGrid class : IGlobalModData
 *
 * Defines the grid type, sub-cell offsets, ramp shapes, and precomputed
 * tile-by-distance lookup tables for ordered deterministic cell iteration.
 *
 * NOTE: IGlobalModData interface is not yet migrated. MapGrid functions
 *   as a standalone configuration class.
 */
export class MapGrid {
  /** Grid type (rectangular or isometric).
   *
   * OpenRA 对照: MapGrid.Type
   */
  readonly type: MapGridType

  /** Scale factor for tile dimensions (1024 rectangular, 1448 isometric).
   *
   * OpenRA 对照: MapGrid.TileScale
   */
  readonly tileScale: number

  /** Maximum terrain height in cell-height units.
   *
   * OpenRA 对照: MapGrid.MaximumTerrainHeight
   */
  readonly maximumTerrainHeight: number

  /** Default sub-cell position for targeting.
   *
   * OpenRA 对照: MapGrid.DefaultSubCell
   *
   * NOTE: Stored as `number` because valid sub-cell indices (0-5) extend
   *   beyond the SubCell enum named values. C# byte enum holds 0-255.
   */
  readonly defaultSubCell: number

  /** Maximum tile search range for TilesByDistance generation.
   *
   * OpenRA 对照: MapGrid.MaximumTileSearchRange
   */
  readonly maximumTileSearchRange: number

  /** Whether depth buffer rendering is enabled.
   *
   * OpenRA 对照: MapGrid.EnableDepthBuffer
   */
  readonly enableDepthBuffer: boolean

  /** Precomputed sub-cell position offsets.
   *
   * OpenRA 对照: MapGrid.SubCellOffsets
   *
   * 6 offsets (indices 0-5):
   *   0: (0,0,0)     — full cell center
   *   1: (-299,-256,0) — top-left
   *   2: (256,-256,0)  — top-right
   *   3: (0,0,0)     — center
   *   4: (-299,256,0)  — bottom-left
   *   5: (256,256,0)   — bottom-right
   *
   * NOTE: Indices 0 and 3 are BOTH (0,0,0) — matches OpenRA.
   */
  readonly subCellOffsets: readonly WVec[]

  /** The 21 predefined ramp shapes.
   *
   * OpenRA 对照: MapGrid.Ramps
   */
  readonly ramps: readonly CellRamp[]

  /** Cells grouped by integer ceiling distance from origin, deterministically
   * sorted within each group.
   *
   * OpenRA 对照: MapGrid.TilesByDistance
   *
   * Index N contains all CVec within maximumTileSearchRange whose
   * ceiling euclidean distance equals N.
   */
  readonly tilesByDistance: readonly (readonly CVec[])[]

  /**
   * Construct a MapGrid from configuration.
   *
   * OpenRA 对照: MapGrid(MiniYaml yaml) + FieldLoader.Load()
   *
   * @param config — grid configuration (MiniYaml replacement)
   */
  constructor(config: MapGridConfig = {}) {
    this.type = config.type ?? MapGridType.Rectangular
    this.maximumTerrainHeight = config.maximumTerrainHeight ?? 0
    this.enableDepthBuffer = config.enableDepthBuffer ?? false
    this.maximumTileSearchRange = config.maximumTileSearchRange ?? 50

    // TileScale: 1024 rectangular, 1448 isometric
    this.tileScale =
      this.type === MapGridType.RectangularIsometric ? 1448 : 1024

    // SubCellOffsets — exact OpenRA values
    this.subCellOffsets = Object.freeze([
      Object.freeze(new WVec(0, 0, 0)), // full cell - index 0
      Object.freeze(new WVec(-299, -256, 0)), // top left - index 1
      Object.freeze(new WVec(256, -256, 0)), // top right - index 2
      Object.freeze(new WVec(0, 0, 0)), // center - index 3
      Object.freeze(new WVec(-299, 256, 0)), // bottom left - index 4
      Object.freeze(new WVec(256, 256, 0)), // bottom right - index 5
    ]) as readonly WVec[]

    // DefaultSubCell handling
    const rawDefault = config.defaultSubCell ?? SubCell.Invalid
    if (rawDefault === SubCell.Invalid) {
      // Default to middle sub-cell (index = SubCellOffsets.length / 2 = 3)
      this.defaultSubCell = this.subCellOffsets.length / 2
    } else {
      const minSubCellOffset = this.subCellOffsets.length > 1 ? 1 : 0
      if (
        rawDefault < minSubCellOffset ||
        rawDefault >= this.subCellOffsets.length
      ) {
        throw new Error(
          'Subcell default index must be a valid index into the offset triples' +
            ' and must be greater than 0 for mods with subcells',
        )
      }
      this.defaultSubCell = rawDefault
    }

    // Build the 21 predefined ramps
    this.ramps = Object.freeze(createRamps(this.type))

    // Precompute TilesByDistance
    this.tilesByDistance = Object.freeze(
      createTilesByDistance(this.maximumTileSearchRange),
    )
  }

  /**
   * Get the world-vector offset for a sub-cell position.
   *
   * OpenRA 对照: MapGrid.OffsetOfSubCell(SubCell)
   *
   * @param subCell — sub-cell index (0-5 valid, others return WVec.Zero)
   * @returns the WVec offset for the sub-cell, or WVec.Zero for invalid/any
   */
  offsetOfSubCell(subCell: number): WVec {
    if (subCell === SubCell.Invalid || subCell === SubCell.Any) {
      return WVec.Zero
    }

    if (subCell >= 0 && subCell < this.subCellOffsets.length) {
      return this.subCellOffsets[subCell]
    }

    return WVec.Zero
  }
}

// ---------------------------------------------------------------------------
// createRamps — 21 predefined CellRamp shapes (OpenRA hardcoded array)
// ---------------------------------------------------------------------------

/**
 * Create the 21 predefined CellRamp shapes.
 *
 * OpenRA 对照: MapGrid.Ramps = [ … ] in constructor
 *
 * Rotation axes and amounts match OpenRA byte-for-byte:
 *   southEast = new WVec(724, 724, 0)
 *   southWest  = new WVec(-724, 724, 0)
 *   south      = new WVec(0, 1024, 0)
 *   east       = new WVec(1024, 0, 0)
 *   forward    = new WAngle(64)
 *   backward   = WAngle.negate(forward)
 *   halfForward  = new WAngle(48)
 *   halfBackward = WAngle.negate(halfForward)
 *
 * @param type — MapGridType for corner coordinate computation
 * @returns frozen array of 21 CellRamp instances
 */
function createRamps(type: MapGridType): readonly CellRamp[] {
  // Rotation axes
  const southEast = new WVec(724, 724, 0)
  const southWest = new WVec(-724, 724, 0)
  const south = new WVec(0, 1024, 0)
  const east = new WVec(1024, 0, 0)

  // Rotation amounts
  const forward = new WAngle(64)
  const backward = WAngle.negate(forward)
  const halfForward = new WAngle(48)
  const halfBackward = WAngle.negate(halfForward)

  const { Half, Full } = RampCornerHeight
  const { X: SplitX, Y: SplitY } = RampSplit

  const ramps = [
    // -------------------------------------------------------------------
    // 0: Flat
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.None),

    // -------------------------------------------------------------------
    // 1-4: Two adjacent corners raised by half a cell
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.fromAxisAngle(southEast, backward), {
      tr: Half,
      br: Half,
    }),
    new CellRamp(type, WRot.fromAxisAngle(southWest, backward), {
      br: Half,
      bl: Half,
    }),
    new CellRamp(type, WRot.fromAxisAngle(southEast, forward), {
      tl: Half,
      bl: Half,
    }),
    new CellRamp(type, WRot.fromAxisAngle(southWest, forward), {
      tl: Half,
      tr: Half,
    }),

    // -------------------------------------------------------------------
    // 5-8: One corner raised by half a cell
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.fromAxisAngle(south, halfBackward), {
      br: Half,
      split: SplitX,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, halfForward), {
      bl: Half,
      split: SplitY,
    }),
    new CellRamp(type, WRot.fromAxisAngle(south, halfForward), {
      tl: Half,
      split: SplitX,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, halfBackward), {
      tr: Half,
      split: SplitY,
    }),

    // -------------------------------------------------------------------
    // 9-12: Three corners raised by half a cell
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.fromAxisAngle(south, halfBackward), {
      tr: Half,
      br: Half,
      bl: Half,
      split: SplitX,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, halfForward), {
      tl: Half,
      br: Half,
      bl: Half,
      split: SplitY,
    }),
    new CellRamp(type, WRot.fromAxisAngle(south, halfForward), {
      tl: Half,
      tr: Half,
      bl: Half,
      split: SplitX,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, halfBackward), {
      tl: Half,
      tr: Half,
      br: Half,
      split: SplitY,
    }),

    // -------------------------------------------------------------------
    // 13-16: Full tile sloped (mid corners half, far corner full)
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.fromAxisAngle(south, backward), {
      tr: Half,
      br: Full,
      bl: Half,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, forward), {
      tl: Half,
      br: Half,
      bl: Full,
    }),
    new CellRamp(type, WRot.fromAxisAngle(south, forward), {
      tl: Full,
      tr: Half,
      bl: Half,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, backward), {
      tl: Half,
      tr: Full,
      br: Half,
    }),

    // -------------------------------------------------------------------
    // 17-21: Two opposite corners raised by half a cell
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.None, {
      tr: Half,
      bl: Half,
      split: SplitY,
    }),
    new CellRamp(type, WRot.None, {
      tl: Half,
      br: Half,
      split: SplitY,
    }),
    new CellRamp(type, WRot.None, {
      tr: Half,
      bl: Half,
      split: SplitX,
    }),
    new CellRamp(type, WRot.None, {
      tl: Half,
      br: Half,
      split: SplitX,
    }),
  ]

  return ramps
}

// ---------------------------------------------------------------------------
// createTilesByDistance (OpenRA 对照: MapGrid.CreateTilesByDistance())
// ---------------------------------------------------------------------------

/**
 * Generate the deterministic TilesByDistance lookup table.
 *
 * OpenRA 对照: MapGrid.CreateTilesByDistance()
 *
 * Cells within maximumTileSearchRange are grouped by integer ceiling distance
 * (via isqrtCeiling). Within each group, cells are sorted by:
 *   LengthSquared → hashCode() → X → Y
 *
 * @param range — maximum tile search range
 * @returns frozen array of groups, indexed by ceiling distance
 */
function createTilesByDistance(range: number): readonly (readonly CVec[])[] {
  const groups: CVec[][] = []
  for (let i = 0; i < range + 1; i++) {
    groups.push([])
  }

  // Collect all cells within range
  for (let j = -range; j <= range; j++) {
    for (let i = -range; i <= range; i++) {
      if (range * range >= i * i + j * j) {
        const distCeil = isqrtCeiling(i * i + j * j)
        groups[distCeil].push(new CVec(i, j))
      }
    }
  }

  // Sort each distance group deterministically
  for (const group of groups) {
    group.sort((a, b) => {
      // Primary: length squared (actual distance)
      const lsResult = a.lengthSquared - b.lengthSquared
      if (lsResult !== 0) return lsResult

      // Secondary: hash code (random-appearing tiebreaker)
      const hashResult = a.hashCode() - b.hashCode()
      if (hashResult !== 0) return hashResult

      // Tertiary: X coordinate
      if (a.X !== b.X) return a.X - b.X

      // Quaternary: Y coordinate
      return a.Y - b.Y
    })
  }

  return groups.map((g) => Object.freeze(g))
}
