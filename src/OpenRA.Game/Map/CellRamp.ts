/**
 * CellRamp.ts — Single cell slope shape with corner heights, triangle
 *              polygon(s), and barycentric height interpolation
 * OpenRA 对照: OpenRA.Game/Map/MapGrid.cs (CellRamp readonly struct)
 *
 * 核心范式转换:
 * - C# readonly struct CellRamp → immutable TypeScript class
 * - C# enum RampCornerHeight / RampSplit → const-as-enum objects
 * - C# ImmutableArray<T> → readonly T[] (frozen via Object.freeze)
 * - C# integer division → Math.trunc() for truncate-toward-zero semantics
 * - Barycentric formula byte-for-byte from OpenRA HeightOffset()
 */

import { WVec } from '../WVec'
import { WRot } from '../WRot'
import { MapGridType } from './MapGridType'

// ---------------------------------------------------------------------------
// RampCornerHeight (OpenRA 对照: RampCornerHeight enum)
// ---------------------------------------------------------------------------

/**
 * Corner height level for CellRamp construction.
 *
 * OpenRA 对照: RampCornerHeight enum
 *
 * Each corner can be at Low (0), Half (cell-height / 2), or Full (cell-height).
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
 * Flat: single quad treated as triangle (corners 0-1-2)
 * X: split along TL→BR diagonal (tri 0-1-3 + tri 1-2-3)
 * Y: split along TR→BL diagonal (tri 0-1-2 + tri 0-2-3)
 */
export const RampSplit = {
  Flat: 0,
  X: 1,
  Y: 2,
} as const

export type RampSplit = (typeof RampSplit)[keyof typeof RampSplit]

// ---------------------------------------------------------------------------
// CellRampOptions
// ---------------------------------------------------------------------------

/** Options for constructing a CellRamp with named corner heights and split. */
export interface CellRampOptions {
  tl?: RampCornerHeight
  tr?: RampCornerHeight
  br?: RampCornerHeight
  bl?: RampCornerHeight
  split?: RampSplit
}

// ---------------------------------------------------------------------------
// CellRamp (OpenRA 对照: CellRamp readonly struct)
// ---------------------------------------------------------------------------

/**
 * Defines a single cell slope shape with corner heights, triangle polygon(s),
 * and barycentric height interpolation.
 *
 * OpenRA 对照: CellRamp readonly struct
 *
 * Each CellRamp encodes the 3D shape of a terrain slope within one cell.
 * The 4 corners (TL, TR, BR, BL) are at grid-relative coordinates with
 * Z = height. The polygon(s) define 1-2 triangles for barycentric
 * interpolation.
 *
 * Height scale:
 *   Rectangular: scale = 512 (cell is 1024 x 1024)
 *   Isometric:   scale = 724 (cell is 1448 x 1448)
 */
export class CellRamp {
  /** Height at the center of the cell, computed via HeightOffset(0, 0).
   *
   * OpenRA 对照: CellRamp.CenterHeightOffset
   */
  readonly centerHeightOffset: number

  /** Four corners in grid-local space: TL, TR, BR, BL.
   *
   * OpenRA 对照: CellRamp.Corners
   */
  readonly corners: readonly WVec[]

  /** 1-2 triangle polygons, each as an array of 3 vertices.
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
   * @param type — grid type (determines corner XY coordinates and height scale)
   * @param orientation — rotational orientation for slope applications
   * @param options — corner heights (tl, tr, br, bl) and split direction;
   *   all default to Low/Flat
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

    if (type === MapGridType.RectangularIsometric) {
      const s = 724
      this.corners = Object.freeze([
        Object.freeze(new WVec(0, -s, s * tl)),
        Object.freeze(new WVec(s, 0, s * tr)),
        Object.freeze(new WVec(0, s, s * br)),
        Object.freeze(new WVec(-s, 0, s * bl)),
      ]) as readonly WVec[]
    } else {
      const s = 512
      this.corners = Object.freeze([
        Object.freeze(new WVec(-s, -s, s * tl)),
        Object.freeze(new WVec(s, -s, s * tr)),
        Object.freeze(new WVec(s, s, s * br)),
        Object.freeze(new WVec(-s, s, s * bl)),
      ]) as readonly WVec[]
    }

    // Build polygon(s) based on split mode
    const c = this.corners
    if (split === RampSplit.X) {
      // Split along TL→BR diagonal: tri 0-1-3 + tri 1-2-3
      this.polygons = Object.freeze([
        Object.freeze([c[0], c[1], c[3]]),
        Object.freeze([c[1], c[2], c[3]]),
      ]) as readonly (readonly WVec[])[]
    } else if (split === RampSplit.Y) {
      // Split along TR→BL diagonal: tri 0-1-2 + tri 0-2-3
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

    // Initial value must be assigned before HeightOffset can be called
    // (mimicking C#: CenterHeightOffset = 0; CenterHeightOffset = HeightOffset(0, 0))
    this.centerHeightOffset = this.heightOffset(0, 0)
  }

  /**
   * Compute the height offset at a given (dX, dY) within the cell using
   * barycentric interpolation over the ramp's polygon(s).
   *
   * OpenRA 对照: CellRamp.HeightOffset(int dX, int dY)
   *
   * Iterates over polygon triangles, checks if (dX, dY) is inside the
   * triangle (0 <= u, v <= 1024), then interpolates Z using barycentric
   * weights. Uses `Math.trunc()` for C#-compatible integer division
   * (truncate toward zero).
   *
   * @param dX — X offset within cell (grid-local coordinates)
   * @param dY — Y offset within cell (grid-local coordinates)
   * @returns interpolated Z (height) at the point, truncated toward zero
   */
  heightOffset(dX: number, dY: number): number {
    let u: number
    let v: number
    let p: readonly WVec[]
    let i = 0

    do {
      p = this.polygons[i]

      // Barycentric coordinate u for vertex p[1]
      // C#: u = ((p[1].Y - p[2].Y) * (dX - p[2].X) - (p[1].X - p[2].X) * (dY - p[2].Y)) / 1024
      u = Math.trunc(
        ((p[1].Y - p[2].Y) * (dX - p[2].X) -
          (p[1].X - p[2].X) * (dY - p[2].Y)) /
          1024,
      )

      // Barycentric coordinate v for vertex p[0]
      // C#: v = ((p[0].X - p[2].X) * (dY - p[2].Y) - (p[0].Y - p[2].Y) * (dX - p[2].X)) / 1024
      v = Math.trunc(
        ((p[0].X - p[2].X) * (dY - p[2].Y) -
          (p[0].Y - p[2].Y) * (dX - p[2].X)) /
          1024,
      )

      // Point is within the triangle if 0 <= u, v <= 1024
      if (u >= 0 && u <= 1024 && v >= 0 && v <= 1024) break

      i++
    } while (i < this.polygons.length)

    // Calculate w from u,v and interpolate height
    // C#: return (u * p[0].Z + v * p[1].Z + (1024 - u - v) * p[2].Z) / 1024
    return Math.trunc(
      (u * p[0].Z + v * p[1].Z + (1024 - u - v) * p[2].Z) / 1024,
    )
  }
}
