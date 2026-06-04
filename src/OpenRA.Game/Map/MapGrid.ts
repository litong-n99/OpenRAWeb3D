/**
 * MapGrid.ts — Map grid geometry with CellRamp height interpolation and
 *             deterministic tile distance lookup tables
 * OpenRA 对照: OpenRA.Game/Map/MapGrid.cs (256 lines)
 *
 * 核心范式转换:
 * - C# readonly struct CellRamp → immutable TypeScript class
 * - C# enum RampCornerHeight / RampSplit → const-as-enum objects
 * - C# ImmutableArray<T> → readonly T[] (frozen via Object.freeze)
 * - C# MiniYaml constructor (FieldLoader.Load) → plain config object
 * - ISqrt(…, Ceiling) → private isqrtCeiling() helper (Exts.isqrt only has Floor)
 * - CVec.GetHashCode() sort tiebreaker → deterministic hashCVec() helper
 * - 21 hardcoded CellRamp definitions byte-for-byte from OpenRA source
 */

import { WVec } from '../WVec'
import { WRot } from '../WRot'
import { WAngle } from '../WAngle'
import { CVec } from '../CVec'
import { isqrt } from '../Exts'
import { MapGridType } from './MapGridType'
import { SubCell } from '../Traits/SubCell'

// ---------------------------------------------------------------------------
// Private helpers (mirror OpenRA Exts / ValueType functionality)
// ---------------------------------------------------------------------------

/**
 * Integer square root with ceiling rounding.
 *
 * OpenRA 对照: Exts.ISqrt(n, ISqrtRoundMode.Ceiling)
 */
function isqrtCeiling(n: number): number {
  const root = isqrt(n)
  return root * root < n ? root + 1 : root
}

/**
 * Deterministic hash for CVec tiebreaker sorting.
 *
 * OpenRA 对照: CVec.GetHashCode() — used as secondary sort key in
 * TilesByDistance generation to produce "random-appearing" ordering
 * within same-distance groups.
 *
 * NOTE: .NET ValueType.GetHashCode() uses runtime-random seeds in
 * .NET 6+. We use a stable FNV-1a-like hash for cross-browser determinism.
 */
function hashCVec(v: CVec): number {
  // Constants chosen to produce reasonable distribution for typical
  // cell coordinate ranges [-50, 50]
  return (v.X * 397) ^ v.Y
}

// ---------------------------------------------------------------------------
// RampCornerHeight (OpenRA 对照: RampCornerHeight enum)
// ---------------------------------------------------------------------------

/**
 * Corner height level for CellRamp construction.
 *
 * OpenRA 对照: RampCornerHeight enum
 *
 * Each corner can be at Low (0), Half (self height), or Full (cell height).
 */
export const RampCornerHeight = {
  Low: 0,
  Half: 1,
  Full: 2,
} as const

export type RampCornerHeight =
  (typeof RampCornerHeight)[keyof typeof RampCornerHeight]

// ---------------------------------------------------------------------------
// RampSplit (OpenRA 对照: RampSplit enum)
// ---------------------------------------------------------------------------

/**
 * Polygon split direction for CellRamp.
 *
 * OpenRA 对照: RampSplit enum
 *
 * Flat: single quad (4 vertices = 1 polygon)
 * X: split along diagonal from TL→BR (tri 0-1-3 + tri 1-2-3)
 * Y: split along diagonal from TR→BL (tri 0-1-2 + tri 0-2-3)
 */
export const RampSplit = {
  Flat: 0,
  X: 1,
  Y: 2,
} as const

export type RampSplit = (typeof RampSplit)[keyof typeof RampSplit]

// ---------------------------------------------------------------------------
// CellRamp (OpenRA 对照: CellRamp readonly struct)
// ---------------------------------------------------------------------------

/** Options for constructing a CellRamp with named corner heights and split. */
export interface CellRampOptions {
  tl?: RampCornerHeight
  tr?: RampCornerHeight
  br?: RampCornerHeight
  bl?: RampCornerHeight
  split?: RampSplit
}

/**
 * Defines a single cell slope shape with corner heights, triangle polygon(s),
 * and barycentric height interpolation.
 *
 * OpenRA 对照: CellRamp readonly struct
 *
 * Each CellRamp encodes the 3D shape of a terrain slope within one cell.
 * The 4 corners are at grid-relative coordinates with Z = height.
 * The polygon(s) define 1-2 triangles for barycentric interpolation.
 */
export class CellRamp {
  /** Height at the center of the cell (computed via HeightOffset(0, 0)).
   *
   * OpenRA 对照: CellRamp.CenterHeightOffset
   */
  readonly centerHeightOffset: number

  /** Four corners in grid-local space: TL, TR, BR, BL.
   *
   * OpenRA 对照: CellRamp.Corners
   */
  readonly corners: readonly WVec[]

  /** 1-2 triangle polygons, each as an array of 3 corner references.
   *
   * OpenRA 对照: CellRamp.Polygons
   */
  readonly polygons: readonly (readonly WVec[])[]

  /** Rotational orientation of the ramp.
   *
   * OpenRA 对照: CellRamp.Orientation
   */
  readonly orientation: WRot

  /**
   * Construct a CellRamp for the given grid type.
   *
   * OpenRA 对照: CellRamp(MapGridType, WRot, RampCornerHeight…, RampSplit)
   *
   * Corner indices: 0=TL, 1=TR, 2=BR, 3=BL
   *
   * @param type — grid type (determines corner XY coordinates and height scale)
   * @param orientation — rotational orientation for slope applications
   * @param options — corner heights (tl, tr, br, bl) and split direction
   */
  constructor(
    type: MapGridType,
    orientation: WRot,
    options: CellRampOptions = {},
  ) {
    const {
      tl = RampCornerHeight.Low,
      tr = RampCornerHeight.Low,
      br = RampCornerHeight.Low,
      bl = RampCornerHeight.Low,
      split = RampSplit.Flat,
    } = options

    this.orientation = orientation

    // Height scale: 512 for rectangular, 724 for isometric
    const scale = type === MapGridType.RectangularIsometric ? 724 : 512

    if (type === MapGridType.RectangularIsometric) {
      this.corners = Object.freeze([
        Object.freeze(new WVec(0, -724, 724 * tl)),
        Object.freeze(new WVec(724, 0, 724 * tr)),
        Object.freeze(new WVec(0, 724, 724 * br)),
        Object.freeze(new WVec(-724, 0, 724 * bl)),
      ]) as readonly WVec[]
    } else {
      this.corners = Object.freeze([
        Object.freeze(new WVec(-scale, -scale, scale * tl)),
        Object.freeze(new WVec(scale, -scale, scale * tr)),
        Object.freeze(new WVec(scale, scale, scale * br)),
        Object.freeze(new WVec(-scale, scale, scale * bl)),
      ]) as readonly WVec[]
    }

    // Build polygon(s) based on split mode
    const c = this.corners
    if (split === RampSplit.X) {
      // Split along TL→BR diagonal: two triangles
      this.polygons = Object.freeze([
        Object.freeze([c[0], c[1], c[3]]),
        Object.freeze([c[1], c[2], c[3]]),
      ]) as readonly (readonly WVec[])[]
    } else if (split === RampSplit.Y) {
      // Split along TR→BL diagonal: two triangles
      this.polygons = Object.freeze([
        Object.freeze([c[0], c[1], c[2]]),
        Object.freeze([c[0], c[2], c[3]]),
      ]) as readonly (readonly WVec[])[]
    } else {
      // Flat: single quad (first 3 vertices used as triangle for interpolation)
      this.polygons = Object.freeze([
        Object.freeze([c[0], c[1], c[2]]),
      ]) as readonly (readonly WVec[])[]
    }

    // Compute center height via barycentric interpolation at (0, 0)
    this.centerHeightOffset = this.heightOffset(0, 0)
  }

  /**
   * Compute the height offset at a given (dx, dy) within the cell using
   * barycentric interpolation over the ramp's polygon(s).
   *
   * OpenRA 对照: CellRamp.HeightOffset(int dX, int dY)
   *
   * Iterates over polygon triangles, checks if (dx,dy) is inside the triangle
   * (0 <= u,v <= 1024), then interpolates Z using barycentric weights.
   *
   * @param dX — X offset within cell (grid-local coordinates)
   * @param dY — Y offset within cell (grid-local coordinates)
   * @returns interpolated Z (height) at the point
   */
  heightOffset(dX: number, dY: number): number {
    // Iterate over polygons — each is assumed to be a triangle
    let u: number
    let v: number
    let p: readonly WVec[]
    let i = 0

    do {
      p = this.polygons[i]

      // Barycentric coordinate u for vertex p[1]
      u =
        ((p[1].Y - p[2].Y) * (dX - p[2].X) -
          (p[1].X - p[2].X) * (dY - p[2].Y)) /
        1024

      // Barycentric coordinate v for vertex p[0]
      v =
        ((p[0].X - p[2].X) * (dY - p[2].Y) -
          (p[0].Y - p[2].Y) * (dX - p[2].X)) /
        1024

      // Point is within the triangle if 0 <= u,v <= 1024
      if (u >= 0 && u <= 1024 && v >= 0 && v <= 1024) break

      i++
    } while (i < this.polygons.length)

    // Calculate w from u,v and interpolate height
    return (u * p[0].Z + v * p[1].Z + (1024 - u - v) * p[2].Z) / 1024
  }
}

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
   *   beyond the SubCell enum values (which only covers Invalid/Any/FullCell/First).
   *   The SubCell enum in C# is `byte` and can hold any value 0-255.
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
   */
  readonly subCellOffsets: readonly WVec[]

  /** The 21 predefined ramp shapes.
   *
   * OpenRA 对照: MapGrid.Ramps
   *
   * See the hardcoded array in createRamps() — byte-for-byte from OpenRA.
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
    this.tileScale = this.type === MapGridType.RectangularIsometric ? 1448 : 1024

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
      this.defaultSubCell = Math.floor(
        this.subCellOffsets.length / 2,
      )
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
   * @param subCell — sub-cell index (0-5 valid, others return Zero)
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
 *   southEast = new WVec(724, 724, 0) — used with backward for SE slope
 *   southWest  = new WVec(-724, 724, 0) — used with backward for SW slope
 *   south      = new WVec(0, 1024, 0)
 *   east       = new WVec(1024, 0, 0)
 *   forward    = new WAngle(64)
 *   backward   = -forward = new WAngle(-64)
 *   halfForward  = new WAngle(48)
 *   halfBackward = -halfForward = new WAngle(-48)
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
  const backward = WAngle.negate(forward) // new WAngle(-64)
  const halfForward = new WAngle(48)
  const halfBackward = WAngle.negate(halfForward) // new WAngle(-48)

  const { Low, Half, Full } = RampCornerHeight
  const { Flat, X: SplitX, Y: SplitY } = RampSplit

  const ramps = [
    // -------------------------------------------------------------------
    // 0: Flat
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.None, {
      tl: Low,
      tr: Low,
      br: Low,
      bl: Low,
      split: Flat,
    }),

    // -------------------------------------------------------------------
    // 1-4: Two adjacent corners raised by half a cell
    // -------------------------------------------------------------------
    new CellRamp(type, WRot.fromAxisAngle(southEast, backward), {
      tr: Half,
      br: Half,
      split: Flat,
    }),
    new CellRamp(type, WRot.fromAxisAngle(southWest, backward), {
      br: Half,
      bl: Half,
      split: Flat,
    }),
    new CellRamp(type, WRot.fromAxisAngle(southEast, forward), {
      tl: Half,
      bl: Half,
      split: Flat,
    }),
    new CellRamp(type, WRot.fromAxisAngle(southWest, forward), {
      tl: Half,
      tr: Half,
      split: Flat,
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
      split: Flat,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, forward), {
      tl: Half,
      br: Half,
      bl: Full,
      split: Flat,
    }),
    new CellRamp(type, WRot.fromAxisAngle(south, forward), {
      tl: Full,
      tr: Half,
      bl: Half,
      split: Flat,
    }),
    new CellRamp(type, WRot.fromAxisAngle(east, backward), {
      tl: Half,
      tr: Full,
      br: Half,
      split: Flat,
    }),

    // -------------------------------------------------------------------
    // 17-20: Two opposite corners raised by half a cell
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
 * Cells within maximumTileSearchRange are grouped by integer ceiling distance.
 * Within each group, cells are sorted by: LengthSquared → hash → X → Y.
 *
 * @param range — maximum tile search range
 * @returns frozen array of groups, indexed by ceiling distance
 */
function createTilesByDistance(
  range: number,
): readonly (readonly CVec[])[] {
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
      const hashResult = hashCVec(a) - hashCVec(b)
      if (hashResult !== 0) return hashResult

      // Tertiary: X coordinate
      if (a.X !== b.X) return a.X - b.X

      // Quaternary: Y coordinate
      return a.Y - b.Y
    })
  }

  return groups.map((g) => Object.freeze(g))
}
