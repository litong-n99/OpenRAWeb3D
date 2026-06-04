/**
 * MapCoordsRegion.ts — Rectangular region of MPos coordinates with row-major iteration
 * OpenRA 对照: OpenRA.Game/Map/MapCoordsRegion.cs
 *
 * 核心范式转换:
 * - C# readonly struct → immutable TypeScript class
 * - C# IEnumerator<MPos> with struct enumerator → TypeScript Iterable<MPos>
 *   (nested MapCoordsEnumerator)
 */

import { MPos } from '../MPos'

// ---------------------------------------------------------------------------
// MapCoordsRegion
// ---------------------------------------------------------------------------

/**
 * Rectangular region of map coordinates (MPos) with row-major iteration.
 *
 * OpenRA 对照: MapCoordsRegion
 *
 * Both TopLeft and BottomRight are inclusive.
 */
export class MapCoordsRegion implements Iterable<MPos> {
  /** Top-left corner (inclusive).
   *
   * OpenRA 对照: MapCoordsRegion.TopLeft
   */
  readonly TopLeft: MPos

  /** Bottom-right corner (inclusive).
   *
   * OpenRA 对照: MapCoordsRegion.BottomRight
   */
  readonly BottomRight: MPos

  /**
   * Construct a map coords region.
   *
   * OpenRA 对照: MapCoordsRegion(MPos mapTopLeft, MPos mapBottomRight)
   *
   * @param mapTopLeft — inclusive top-left corner in map coordinates
   * @param mapBottomRight — inclusive bottom-right corner in map coordinates
   */
  constructor(mapTopLeft: MPos, mapBottomRight: MPos) {
    this.TopLeft = mapTopLeft
    this.BottomRight = mapBottomRight
  }

  /**
   * String representation.
   *
   * OpenRA 对照: MapCoordsRegion.ToString()
   */
  toString(): string {
    return `${this.TopLeft.toString()}->${this.BottomRight.toString()}`
  }

  /**
   * Get a row-major enumerator.
   *
   * OpenRA 对照: MapCoordsRegion.GetEnumerator()
   */
  [Symbol.iterator](): Iterator<MPos> {
    return new MapCoordsEnumerator(this)
  }
}

// ---------------------------------------------------------------------------
// MapCoordsEnumerator
// ---------------------------------------------------------------------------

/**
 * Row-major enumerator over a MapCoordsRegion.
 *
 * OpenRA 对照: MapCoordsRegion.MapCoordsEnumerator
 *
 * Iterates U then V: for each V from TopLeft.V to BottomRight.V,
 * for each U from TopLeft.U to BottomRight.U.
 */
export class MapCoordsEnumerator implements Iterator<MPos> {
  private readonly r: MapCoordsRegion
  private u: number
  private v: number
  private _current: MPos

  /**
   * Construct the enumerator, positioned before the first element.
   *
   * OpenRA 对照: MapCoordsEnumerator(MapCoordsRegion)
   */
  constructor(region: MapCoordsRegion) {
    this.r = region
    // Enumerator starts *before* the first element.
    this.u = region.TopLeft.U - 1
    this.v = region.TopLeft.V
    this._current = new MPos(this.u, this.v)
  }

  /**
   * Advance to the next position. Returns false when exhausted.
   *
   * OpenRA 对照: MapCoordsEnumerator.MoveNext()
   */
  next(): IteratorResult<MPos> {
    this.u++

    // Check for column overflow
    if (this.u > this.r.BottomRight.U) {
      this.v++
      this.u = this.r.TopLeft.U

      // Check for row overflow
      if (this.v > this.r.BottomRight.V) {
        return { done: true, value: undefined as unknown as MPos }
      }
    }

    this._current = new MPos(this.u, this.v)
    return { done: false, value: this._current }
  }
}
