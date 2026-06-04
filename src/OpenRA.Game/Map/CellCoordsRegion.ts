/**
 * CellCoordsRegion.ts — Rectangular region of CPos coordinates with row-major iteration
 * OpenRA 对照: OpenRA.Game/Map/CellCoordsRegion.cs
 *
 * 核心范式转换:
 * - C# readonly struct → immutable TypeScript class
 * - C# IEnumerator<CPos> with struct enumerator → TypeScript Iterable<CPos>
 *   (nested CellCoordsEnumerator)
 */

import { CPos } from '../CPos'

// ---------------------------------------------------------------------------
// CellCoordsRegion
// ---------------------------------------------------------------------------

/**
 * Rectangular region of cell coordinates (CPos) with row-major iteration.
 *
 * OpenRA 对照: CellCoordsRegion
 *
 * Both TopLeft and BottomRight are inclusive.
 * Iteration is in cell coordinates (X, Y), NOT map coordinates.
 */
export class CellCoordsRegion implements Iterable<CPos> {
  /** Top-left corner in cell coordinates (inclusive).
   *
   * OpenRA 对照: CellCoordsRegion.TopLeft
   */
  readonly TopLeft: CPos

  /** Bottom-right corner in cell coordinates (inclusive).
   *
   * OpenRA 对照: CellCoordsRegion.BottomRight
   */
  readonly BottomRight: CPos

  /**
   * Construct a cell coords region.
   *
   * OpenRA 对照: CellCoordsRegion(CPos topLeft, CPos bottomRight)
   *
   * @param topLeft — inclusive top-left corner in cell coordinates
   * @param bottomRight — inclusive bottom-right corner in cell coordinates
   */
  constructor(topLeft: CPos, bottomRight: CPos) {
    this.TopLeft = topLeft
    this.BottomRight = bottomRight
  }

  /**
   * Check whether this region contains a cell position.
   *
   * OpenRA 对照: CellCoordsRegion.Contains(CPos)
   *
   * Checks in cell coordinate space (X, Y directly).
   */
  contains(cell: CPos): boolean {
    return (
      cell.X >= this.TopLeft.X &&
      cell.X <= this.BottomRight.X &&
      cell.Y >= this.TopLeft.Y &&
      cell.Y <= this.BottomRight.Y
    )
  }

  /**
   * String representation.
   *
   * OpenRA 对照: CellCoordsRegion.ToString()
   */
  toString(): string {
    return `${this.TopLeft.toString()}->${this.BottomRight.toString()}`
  }

  /**
   * Get a row-major enumerator.
   *
   * OpenRA 对照: CellCoordsRegion.GetEnumerator()
   */
  [Symbol.iterator](): Iterator<CPos> {
    return new CellCoordsEnumerator(this)
  }

  // -------------------------------------------------------------------------
  // Static factory
  // -------------------------------------------------------------------------

  /**
   * Returns the minimal region that covers at least the specified cells.
   *
   * OpenRA 对照: CellCoordsRegion.BoundingRegion(IReadOnlyCollection<CPos>)
   *
   * @param cells — non-empty collection of cell positions
   * @throws if cells is null or empty
   */
  static boundingRegion(cells: readonly CPos[]): CellCoordsRegion {
    if (!cells || cells.length === 0) {
      throw new Error('cells must not be null or empty.')
    }

    let minX = Number.MAX_SAFE_INTEGER
    let minY = Number.MAX_SAFE_INTEGER
    let maxX = Number.MIN_SAFE_INTEGER
    let maxY = Number.MIN_SAFE_INTEGER

    for (const cell of cells) {
      if (minX > cell.X) minX = cell.X
      if (maxX < cell.X) maxX = cell.X
      if (minY > cell.Y) minY = cell.Y
      if (maxY < cell.Y) maxY = cell.Y
    }

    return new CellCoordsRegion(new CPos(minX, minY), new CPos(maxX, maxY))
  }
}

// ---------------------------------------------------------------------------
// CellCoordsEnumerator
// ---------------------------------------------------------------------------

/**
 * Row-major enumerator over a CellCoordsRegion.
 *
 * OpenRA 对照: CellCoordsRegion.CellCoordsEnumerator
 *
 * Iterates Y then X: for each Y from TopLeft.Y to BottomRight.Y,
 * for each X from TopLeft.X to BottomRight.X.
 */
export class CellCoordsEnumerator implements Iterator<CPos> {
  private readonly r: CellCoordsRegion
  private x: number
  private y: number
  private _current: CPos

  /**
   * Construct the enumerator, positioned before the first element.
   *
   * OpenRA 对照: CellCoordsEnumerator(CellCoordsRegion)
   */
  constructor(region: CellCoordsRegion) {
    this.r = region
    // Enumerator starts *before* the first element.
    this.x = region.TopLeft.X - 1
    this.y = region.TopLeft.Y
    this._current = new CPos(this.x, this.y)
  }

  /**
   * Advance to the next position. Returns false when exhausted.
   *
   * OpenRA 对照: CellCoordsEnumerator.MoveNext()
   */
  next(): IteratorResult<CPos> {
    this.x++

    // Check for column overflow
    if (this.x > this.r.BottomRight.X) {
      this.y++
      this.x = this.r.TopLeft.X

      // Check for row overflow
      if (this.y > this.r.BottomRight.Y) {
        return { done: true, value: undefined as unknown as CPos }
      }
    }

    this._current = new CPos(this.x, this.y)
    return { done: false, value: this._current }
  }
}
