/**
 * ProjectedCellRegion.ts — Rectangular region of PPos coordinates with iteration
 * OpenRA 对照: OpenRA.Game/Map/ProjectedCellRegion.cs
 *
 * 核心范式转换:
 * - C# class (reference type) → TypeScript class
 * - C# IEnumerator<PPos> with struct enumerator → TypeScript Iterable<PPos>
 * - ProjectedCellRegion(Map, PPos, PPos) → decomposed params (gridType, size, maxTerrainHeight)
 *   since Map is not yet migrated (Phase D)
 */

import { PPos } from '../MPos'
import { MPos } from '../MPos'
import { MapGridType, type MapGridType as MapGridTypeEnum } from './MapGridType'
import type { Size } from '../Primitives/Size'
import { MapCoordsRegion } from './MapCoordsRegion'
import { Rectangle } from '../Primitives/Rectangle'

// ---------------------------------------------------------------------------
// GridConfig (Architect WR)
// ---------------------------------------------------------------------------

/**
 * Grid configuration for ProjectedCellRegion.
 *
 * Architect WR item: GridConfig pattern replacing the decomposed
 * (gridType, mapSize, maximumTerrainHeight) parameters.
 *
 * When Map is migrated (Phase D), GridConfig can be sourced from a Map
 * instance via `{ gridType: map.gridType, maximumTerrainHeight: map.grid.maximumTerrainHeight }`.
 */
export interface GridConfig {
  gridType: MapGridTypeEnum
  maximumTerrainHeight: number
}

// ---------------------------------------------------------------------------
// ProjectedCellRegion
// ---------------------------------------------------------------------------

/**
 * Represents a (on-screen) rectangular collection of tiles in projected space.
 *
 * OpenRA 对照: ProjectedCellRegion
 *
 * Both TopLeft and BottomRight are inclusive.
 * Iterates in PPos (projected position) space.
 *
 * The CandidateMapCoords property provides the bounding MPos region that
 * contains all cells potentially projected within this region, accounting
 * for terrain height offsets.
 */
export class ProjectedCellRegion implements Iterable<PPos> {
  /** Top-left corner in projected coordinates (inclusive).
   *
   * OpenRA 对照: ProjectedCellRegion.TopLeft
   */
  readonly TopLeft: PPos

  /** Bottom-right corner in projected coordinates (inclusive).
   *
   * OpenRA 对照: ProjectedCellRegion.BottomRight
   */
  readonly BottomRight: PPos

  /** Top-left corner of the bounding map region.
   *
   * OpenRA 对照: ProjectedCellRegion.mapTopLeft (private)
   */
  readonly mapTopLeft: MPos

  /** Bottom-right corner of the bounding map region (height-aware).
   *
   * OpenRA 对照: ProjectedCellRegion.mapBottomRight (private)
   */
  readonly mapBottomRight: MPos

  /**
   * Construct a ProjectedCellRegion.
   *
   * OpenRA 对照: ProjectedCellRegion(Map, PPos, PPos)
   *
   * Architect WR: uses GridConfig pattern instead of raw (gridType, maxHeight)
   * params. When Map is migrated (Phase D), GridConfig can be sourced from
   * a Map instance.
   *
   * Height offset calculation (Architect WR item 4):
   *   Isometric: offset = maxHeight (1 MPos step per height unit)
   *   Rectangular: offset = maxHeight >> 1 (half MPos step per height unit)
   * Each height step is 512 WDist units.
   *
   * @param gridConfig — grid type and maximum terrain height
   * @param mapSize — the map's size in cells (for clamping)
   * @param topLeft — inclusive top-left corner in projected coordinates
   * @param bottomRight — inclusive bottom-right corner in projected coordinates
   */
  constructor(
    gridConfig: GridConfig,
    mapSize: Size,
    topLeft: PPos,
    bottomRight: PPos,
  ) {
    this.TopLeft = topLeft
    this.BottomRight = bottomRight

    // The projection from MPos -> PPos cannot produce a larger V coordinate
    // so the top edge of the MPos region is the same as the PPos region.
    this.mapTopLeft = topLeft.toMPos()

    // The bottom edge is trickier: cells at MPos.V > bottomRight.V may have
    // been projected into this region if they have height > 0.
    // Each height step is equivalent to 512 WDist units, which is one MPos
    // step for isometric cells, but only half a MPos step for classic cells.
    // Architect WR item 4: >> 1 for Rectangular (positive-only, fast).
    const heightOffset =
      gridConfig.gridType === MapGridType.RectangularIsometric
        ? gridConfig.maximumTerrainHeight
        : gridConfig.maximumTerrainHeight >> 1

    // Clamp the bottom coordinate so it doesn't overflow the map
    const br = new MPos(
      bottomRight.U,
      bottomRight.V + heightOffset,
    )
    const clampRect = new Rectangle(
      0,
      0,
      mapSize.width - 1,
      mapSize.height - 1,
    )
    this.mapBottomRight = br.clamp(clampRect)
  }

  // -------------------------------------------------------------------------
  // Contains
  // -------------------------------------------------------------------------

  /**
   * Check whether this region contains a projected position.
   *
   * OpenRA 对照: ProjectedCellRegion.Contains(PPos)
   *
   * @param puv — projected map position
   */
  contains(puv: PPos): boolean {
    return (
      puv.U >= this.TopLeft.U &&
      puv.U <= this.BottomRight.U &&
      puv.V >= this.TopLeft.V &&
      puv.V <= this.BottomRight.V
    )
  }

  // -------------------------------------------------------------------------
  // CandidateMapCoords
  // -------------------------------------------------------------------------

  /**
   * The region in map coordinates that contains all the cells that
   * may be projected inside this region.
   *
   * OpenRA 对照: ProjectedCellRegion.CandidateMapCoords
   *
   * For increased performance, this does not validate whether individual
   * map cells are actually projected inside the region.
   */
  get CandidateMapCoords(): MapCoordsRegion {
    return new MapCoordsRegion(this.mapTopLeft, this.mapBottomRight)
  }

  // -------------------------------------------------------------------------
  // Iterable
  // -------------------------------------------------------------------------

  /**
   * Get an enumerator over all PPos in this projected region.
   *
   * OpenRA 对照: ProjectedCellRegion.GetEnumerator()
   */
  [Symbol.iterator](): Iterator<PPos> {
    return new ProjectedCellRegionEnumerator(this)
  }
}

// ---------------------------------------------------------------------------
// ProjectedCellRegionEnumerator
// ---------------------------------------------------------------------------

/**
 * Row-major enumerator over a ProjectedCellRegion.
 *
 * OpenRA 对照: ProjectedCellRegion.ProjectedCellRegionEnumerator
 *
 * Iterates U then V in projected space.
 */
export class ProjectedCellRegionEnumerator implements Iterator<PPos> {
  private readonly r: ProjectedCellRegion
  private u: number
  private v: number

  /**
   * Construct the enumerator, positioned before the first element.
   *
   * OpenRA 对照: ProjectedCellRegionEnumerator(ProjectedCellRegion)
   */
  constructor(region: ProjectedCellRegion) {
    this.r = region
    // Enumerator starts *before* the first element.
    this.u = region.TopLeft.U - 1
    this.v = region.TopLeft.V
  }

  /**
   * Advance to the next position. Returns false when exhausted.
   *
   * OpenRA 对照: ProjectedCellRegionEnumerator.MoveNext()
   */
  next(): IteratorResult<PPos> {
    this.u++

    // Check for column overflow
    if (this.u > this.r.BottomRight.U) {
      this.v++
      this.u = this.r.TopLeft.U

      // Check for row overflow
      if (this.v > this.r.BottomRight.V) {
        return { done: true, value: undefined as unknown as PPos }
      }
    }

    return { done: false, value: new PPos(this.u, this.v) }
  }
}
