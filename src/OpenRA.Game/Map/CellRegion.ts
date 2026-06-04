/**
 * CellRegion.ts — Rectangular region of cell coordinates with map-coordinate iteration
 * OpenRA 对照: OpenRA.Game/Map/CellRegion.cs
 *
 * 核心范式转换:
 * - C# class with struct enumerator (IEnumerable<CPos>) → TypeScript Iterable<CPos>
 * - Internal mapTopLeft/mapBottomRight stored for correct isometric iteration
 * - MapCoordsRegion / CellCoordsRegion properties for typed access
 */

import { CPos } from '../CPos'
import { MPos } from '../MPos'
import { type MapGridType as MapGridTypeEnum } from './MapGridType'
import { MapCoordsRegion } from './MapCoordsRegion'
import { CellCoordsRegion } from './CellCoordsRegion'

// ---------------------------------------------------------------------------
// CellRegion
// ---------------------------------------------------------------------------

/**
 * Represents a (on-screen) rectangular collection of tiles.
 *
 * OpenRA 对照: CellRegion
 *
 * Both TopLeft and BottomRight are inclusive.
 * Iteration uses map coordinates (MPos) internally for correct behavior
 * with RectangularIsometric grids, then converts back to CPos for each step.
 */
export class CellRegion implements Iterable<CPos> {
  /** Top-left corner in cell coordinates (inclusive).
   *
   * OpenRA 对照: CellRegion.TopLeft
   */
  readonly TopLeft: CPos

  /** Bottom-right corner in cell coordinates (inclusive).
   *
   * OpenRA 对照: CellRegion.BottomRight
   */
  readonly BottomRight: CPos

  /** Grid type used for coordinate conversion.
   *
   * OpenRA 对照: CellRegion.gridType (private)
   */
  readonly gridType: MapGridTypeEnum

  /** Top-left corner in map coordinates.
   *
   * OpenRA 对照: CellRegion.mapTopLeft (private)
   *
   * Will only equal TopLeft for MapGridType.Rectangular.
   */
  readonly mapTopLeft: MPos

  /** Bottom-right corner in map coordinates.
   *
   * OpenRA 对照: CellRegion.mapBottomRight (private)
   *
   * Will only equal BottomRight for MapGridType.Rectangular.
   */
  readonly mapBottomRight: MPos

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Construct a CellRegion from cell coordinates.
   *
   * OpenRA 对照: CellRegion(MapGridType, CPos, CPos)
   */
  constructor(gridType: MapGridTypeEnum, topLeft: CPos, bottomRight: CPos)

  /**
   * Construct a CellRegion from map coordinates.
   *
   * OpenRA 对照: CellRegion(MapGridType, MPos, MPos)
   */
  constructor(gridType: MapGridTypeEnum, topLeft: MPos, bottomRight: MPos)

  constructor(
    gridType: MapGridTypeEnum,
    topLeft: CPos | MPos,
    bottomRight: CPos | MPos,
  ) {
    this.gridType = gridType

    if (topLeft instanceof CPos) {
      this.TopLeft = topLeft
      this.BottomRight = bottomRight as CPos
      this.mapTopLeft = topLeft.toMPos(gridType)
      this.mapBottomRight = (bottomRight as CPos).toMPos(gridType)
    } else {
      this.mapTopLeft = topLeft as MPos
      this.mapBottomRight = bottomRight as MPos
      this.TopLeft = (topLeft as MPos).toCPos(gridType)
      this.BottomRight = (bottomRight as MPos).toCPos(gridType)
    }
  }

  // -------------------------------------------------------------------------
  // ToString
  // -------------------------------------------------------------------------

  /**
   * String representation.
   *
   * OpenRA 对照: CellRegion.ToString()
   */
  toString(): string {
    return `${this.TopLeft.toString()}->${this.BottomRight.toString()}`
  }

  // -------------------------------------------------------------------------
  // Contains
  // -------------------------------------------------------------------------

  /**
   * Check whether this region fully contains another region.
   *
   * OpenRA 对照: CellRegion.Contains(CellRegion)
   */
  containsRegion(region: CellRegion): boolean {
    return (
      this.TopLeft.X <= region.TopLeft.X &&
      this.TopLeft.Y <= region.TopLeft.Y &&
      this.BottomRight.X >= region.BottomRight.X &&
      this.BottomRight.Y >= region.BottomRight.Y
    )
  }

  /**
   * Check whether this region contains a cell position.
   *
   * OpenRA 对照: CellRegion.Contains(CPos)
   *
   * Uses map coordinates (U,V) for correct isometric containment.
   */
  contains(cell: CPos): boolean {
    const uv = cell.toMPos(this.gridType)
    return (
      uv.U >= this.mapTopLeft.U &&
      uv.U <= this.mapBottomRight.U &&
      uv.V >= this.mapTopLeft.V &&
      uv.V <= this.mapBottomRight.V
    )
  }

  // -------------------------------------------------------------------------
  // Sub-regions
  // -------------------------------------------------------------------------

  /**
   * Map coordinates version of this region.
   *
   * OpenRA 对照: CellRegion.MapCoords
   */
  get MapCoords(): MapCoordsRegion {
    return new MapCoordsRegion(this.mapTopLeft, this.mapBottomRight)
  }

  /**
   * Cell coordinates version of this region.
   *
   * OpenRA 对照: CellRegion.CellCoords
   */
  get CellCoords(): CellCoordsRegion {
    return new CellCoordsRegion(this.TopLeft, this.BottomRight)
  }

  // -------------------------------------------------------------------------
  // Iterable
  // -------------------------------------------------------------------------

  /**
   * Get a row-major enumerator that iterates in map coordinate space
   * and converts each step back to CPos.
   *
   * OpenRA 对照: CellRegion.GetEnumerator()
   */
  [Symbol.iterator](): Iterator<CPos> {
    return new CellRegionEnumerator(this)
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  /**
   * Expand the specified region with an additional cordon.
   *
   * OpenRA 对照: CellRegion.Expand(CellRegion, int)
   *
   * This may expand the region outside the map borders.
   *
   * @param region — the region to expand
   * @param cordon — number of cells to expand by on all sides
   */
  static expand(region: CellRegion, cordon: number): CellRegion {
    const tl = new MPos(
      region.mapTopLeft.U - cordon,
      region.mapTopLeft.V - cordon,
    ).toCPos(region.gridType)
    const br = new MPos(
      region.mapBottomRight.U + cordon,
      region.mapBottomRight.V + cordon,
    ).toCPos(region.gridType)
    return new CellRegion(region.gridType, tl, br)
  }

  /**
   * Returns the minimal region that covers at least the specified cells.
   *
   * OpenRA 对照: CellRegion.BoundingRegion(MapGridType, IReadOnlyCollection<CPos>)
   *
   * @param shape — grid type for coordinate conversion
   * @param cells — non-empty collection of cell positions
   * @throws if cells is null or empty
   */
  static boundingRegion(
    shape: MapGridTypeEnum,
    cells: readonly CPos[],
  ): CellRegion {
    if (!cells || cells.length === 0) {
      throw new Error('cells must not be null or empty.')
    }

    let minU = Number.MAX_SAFE_INTEGER
    let minV = Number.MAX_SAFE_INTEGER
    let maxU = Number.MIN_SAFE_INTEGER
    let maxV = Number.MIN_SAFE_INTEGER

    for (const cell of cells) {
      const uv = cell.toMPos(shape)
      if (minU > uv.U) minU = uv.U
      if (maxU < uv.U) maxU = uv.U
      if (minV > uv.V) minV = uv.V
      if (maxV < uv.V) maxV = uv.V
    }

    return new CellRegion(
      shape,
      new MPos(minU, minV).toCPos(shape),
      new MPos(maxU, maxV).toCPos(shape),
    )
  }
}

// ---------------------------------------------------------------------------
// CellRegionEnumerator
// ---------------------------------------------------------------------------

/**
 * Row-major enumerator over a CellRegion.
 *
 * OpenRA 对照: CellRegion.CellRegionEnumerator
 *
 * Iterates in map coordinate space (U then V) and converts each position
 * back to CPos using the region's grid type. This ensures correct iteration
 * order for RectangularIsometric grids.
 *
 * Corresponding map-coordinate-only iteration uses MapCoordsRegion.
 */
export class CellRegionEnumerator implements Iterator<CPos> {
  private readonly r: CellRegion
  private u: number
  private v: number

  /**
   * Construct the enumerator, positioned before the first element.
   *
   * OpenRA 对照: CellRegionEnumerator(CellRegion)
   *
   * NOTE: OpenRA initializes Current in the constructor after Reset.
   * We defer CPos creation to next() to avoid allocation in constructor.
   */
  constructor(region: CellRegion) {
    this.r = region
    // Enumerator starts *before* the first element.
    this.u = region.mapTopLeft.U - 1
    this.v = region.mapTopLeft.V
  }

  /**
   * Advance to the next position. Returns false when exhausted.
   *
   * OpenRA 对照: CellRegionEnumerator.MoveNext()
   */
  next(): IteratorResult<CPos> {
    this.u++

    // Check for column overflow
    if (this.u > this.r.mapBottomRight.U) {
      this.v++
      this.u = this.r.mapTopLeft.U

      // Check for row overflow
      if (this.v > this.r.mapBottomRight.V) {
        return { done: true, value: undefined as unknown as CPos }
      }
    }

    // Current position, in cell coordinates
    const current = new MPos(this.u, this.v).toCPos(this.r.gridType)
    return { done: false, value: current }
  }
}
