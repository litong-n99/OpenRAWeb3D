/**
 * Grid.ts — Simplistic grid of cells for pathfinding region queries
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/Grid.cs
 *
 * 核心范式转换:
 * - C# readonly struct Grid → TypeScript class with readonly fields
 * - C# int2 → inline X/Y arithmetic (no int2 struct needed)
 * - C# Exts.LinesIntersect → inline line intersection algorithm
 * - C# properties Width, Height → TypeScript getter methods
 */

import { CPos } from '../../OpenRA.Game/CPos'

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * Represents a simplistic grid of cells, where everything in the
 * top-to-bottom and left-to-right range is within the grid.
 * The grid can be restricted to a single layer, or allowed to span all layers.
 *
 * OpenRA 对照: Grid (readonly struct)
 *
 * This means in RectangularIsometric some cells within a grid may lay off the map.
 * Contrast this with CellRegion which maintains the simplistic grid in map space -
 * ensuring the cells are therefore always within the map area.
 * The advantage of Grid is that it has straight edges, making logic for adjacent grids easy.
 * A CellRegion has jagged edges in RectangularIsometric, which makes that more difficult.
 */
export class Grid {
  /**
   * Inclusive top-left corner.
   *
   * OpenRA 对照: Grid.TopLeft
   */
  readonly TopLeft: CPos

  /**
   * Exclusive bottom-right corner.
   *
   * OpenRA 对照: Grid.BottomRight
   */
  readonly BottomRight: CPos

  /**
   * When true, the grid spans only the single layer given by the cells.
   * When false, it spans all layers.
   *
   * OpenRA 对照: Grid.SingleLayer
   */
  readonly SingleLayer: boolean

  /**
   * Create a new Grid.
   *
   * OpenRA 对照: Grid(CPos, CPos, bool)
   *
   * @param topLeft — inclusive top-left corner
   * @param bottomRight — exclusive bottom-right corner
   * @param singleLayer — whether to restrict to a single layer
   * @throws if topLeft and bottomRight have different layers
   */
  constructor(topLeft: CPos, bottomRight: CPos, singleLayer: boolean) {
    if (topLeft.Layer !== bottomRight.Layer) {
      throw new Error(
        `topLeft and bottomRight must have the same Layer ` +
          `(got ${topLeft.Layer} and ${bottomRight.Layer})`,
      )
    }

    this.TopLeft = topLeft
    this.BottomRight = bottomRight
    this.SingleLayer = singleLayer
  }

  /**
   * Width of the grid in cells.
   *
   * OpenRA 对照: Grid.Width
   */
  get Width(): number {
    return this.BottomRight.X - this.TopLeft.X
  }

  /**
   * Height of the grid in cells.
   *
   * OpenRA 对照: Grid.Height
   */
  get Height(): number {
    return this.BottomRight.Y - this.TopLeft.Y
  }

  /**
   * Checks if the cell X and Y lie within the grid bounds.
   * The cell layer must also match when SingleLayer is true.
   *
   * OpenRA 对照: Grid.Contains(CPos)
   *
   * @param cell — cell position to check
   * @returns true if the cell is within the grid bounds
   */
  contains(cell: CPos): boolean {
    return (
      cell.X >= this.TopLeft.X &&
      cell.X < this.BottomRight.X &&
      cell.Y >= this.TopLeft.Y &&
      cell.Y < this.BottomRight.Y &&
      (!this.SingleLayer || cell.Layer === this.TopLeft.Layer)
    )
  }

  /**
   * Checks if the line segment from start to end passes through the grid boundary.
   * The cell layers are ignored.
   * A line contained wholly within the grid that doesn't cross the boundary is not counted as intersecting.
   *
   * OpenRA 对照: Grid.IntersectsLine(CPos, CPos)
   *
   * @param start — start of the line segment
   * @param end — end of the line segment
   * @returns true if the line intersects any grid edge
   */
  intersectsLine(start: CPos, end: CPos): boolean {
    const sx = start.X
    const sy = start.Y
    const ex = end.X
    const ey = end.Y
    const tlx = this.TopLeft.X
    const tly = this.TopLeft.Y
    const brx = this.BottomRight.X
    const bry = this.BottomRight.Y

    // Check intersection with each of the 4 grid edges
    return (
      linesIntersect(sx, sy, ex, ey, tlx, tly, brx, tly) || // top edge
      linesIntersect(sx, sy, ex, ey, tlx, tly, tlx, bry) || // left edge
      linesIntersect(sx, sy, ex, ey, tlx, bry, brx, bry) || // bottom edge
      linesIntersect(sx, sy, ex, ey, brx, tly, brx, bry) // right edge
    )
  }

  /**
   * String representation.
   *
   * OpenRA 对照: Grid.ToString()
   */
  toString(): string {
    return `${this.TopLeft.toString()}->${this.BottomRight.toString()}`
  }
}

// ---------------------------------------------------------------------------
// Line intersection helper (inline, no int2 struct needed)
// ---------------------------------------------------------------------------

/**
 * Check if two line segments intersect.
 *
 * OpenRA 对照: Exts.LinesIntersect(int2, int2, int2, int2)
 *
 * Uses the standard orientation-based line segment intersection test.
 *
 * @param x1 — first point of line 1
 * @param y1 — first point of line 1
 * @param x2 — second point of line 1
 * @param y2 — second point of line 1
 * @param x3 — first point of line 2
 * @param y3 — first point of line 2
 * @param x4 — second point of line 2
 * @param y4 — second point of line 2
 * @returns true if the line segments intersect
 */
function linesIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): boolean {
  const o1 = orientation(x1, y1, x2, y2, x3, y3)
  const o2 = orientation(x1, y1, x2, y2, x4, y4)
  const o3 = orientation(x3, y3, x4, y4, x1, y1)
  const o4 = orientation(x3, y3, x4, y4, x2, y2)

  // General case: orientations differ
  if (o1 !== o2 && o3 !== o4) return true

  // Special cases: collinear points on segments
  if (o1 === 0 && onSegment(x1, y1, x3, y3, x2, y2)) return true
  if (o2 === 0 && onSegment(x1, y1, x4, y4, x2, y2)) return true
  if (o3 === 0 && onSegment(x3, y3, x1, y1, x4, y4)) return true
  if (o4 === 0 && onSegment(x3, y3, x2, y2, x4, y4)) return true

  return false
}

/**
 * Compute the orientation of an ordered triplet of points.
 *
 * @returns 0 = collinear, 1 = clockwise, 2 = counter-clockwise
 */
function orientation(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): number {
  const val = (qy - py) * (rx - qx) - (qx - px) * (ry - qy)
  if (val === 0) return 0
  return val > 0 ? 1 : 2
}

/**
 * Check if point q lies on segment pr.
 */
function onSegment(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean {
  return (
    qx <= Math.max(px, rx) &&
    qx >= Math.min(px, rx) &&
    qy <= Math.max(py, ry) &&
    qy >= Math.min(py, ry)
  )
}
