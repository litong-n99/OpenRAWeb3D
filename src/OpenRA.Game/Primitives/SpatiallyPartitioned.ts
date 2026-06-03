/**
 * SpatiallyPartitioned.ts — Generic grid-based spatial hash
 * OpenRA 对照: OpenRA.Game/Primitives/SpatiallyPartitioned.cs
 *
 * 核心范式转换:
 * - C# Dictionary<T, Rectangle>[] bins → TypeScript Map<T, Rectangle>[]
 * - C# ref return (CollectionsMarshal) → direct Map access
 * - Implements IDictionary<T, Rectangle> API
 * - Thread safety: not needed in single-threaded JS
 */

import { Rectangle } from './Rectangle'

// ---------------------------------------------------------------------------
// SpatiallyPartitioned<T>
// ---------------------------------------------------------------------------

/**
 * Generic spatial partitioning using a grid of bins.
 *
 * OpenRA 对照: SpatiallyPartitioned<T>
 *
 * Divides space into a grid of equal-sized bins. Items are stored in all
 * bins that intersect their bounding rectangle. Supports O(1) point queries
 * (At) and efficient rectangular region queries (InBox).
 *
 * @typeParam T — the type of items stored (must be usable as Map key)
 */
export class SpatiallyPartitioned<T> {
  /** Number of bin rows. */
  readonly rows: number

  /** Number of bin columns. */
  readonly cols: number

  /** Size of each bin edge. */
  readonly binSize: number

  /** Grid of bins, each bin is a Map<T, Rectangle>. */
  private readonly bins: Map<T, Rectangle>[]

  /** Master dictionary tracking all items and their bounds. */
  private readonly itemBounds = new Map<T, Rectangle>()

  /**
   * Create a SpatiallyPartitioned grid.
   *
   * OpenRA 对照: SpatiallyPartitioned(int width, int height, int binSize)
   *
   * @param width — total width of the partitioned area
   * @param height — total height of the partitioned area
   * @param binSize — size of each bin edge (area divided into binSize×binSize cells)
   */
  constructor(width: number, height: number, binSize: number) {
    this.binSize = binSize
    this.rows = Math.ceil(height / binSize)
    this.cols = Math.ceil(width / binSize)
    this.bins = new Array(this.rows * this.cols)
    for (let i = 0; i < this.bins.length; i++) {
      this.bins[i] = new Map<T, Rectangle>()
    }
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  private static validateBounds<T>(item: T, bounds: Rectangle): void {
    if (bounds.Width === 0 || bounds.Height === 0) {
      throw new Error(`Bounds of ${String(item)} are empty.`)
    }
  }

  // -----------------------------------------------------------------------
  // Add / Remove / Update
  // -----------------------------------------------------------------------

  /**
   * Add an item with its bounding rectangle.
   *
   * OpenRA 对照: SpatiallyPartitioned.Add(T, Rectangle)
   */
  add(item: T, bounds: Rectangle): void {
    SpatiallyPartitioned.validateBounds(item, bounds)
    this.itemBounds.set(item, bounds)
    this.mutateBins(item, bounds, (bin, i, b) => bin.set(i, b))
  }

  /**
   * Remove an item.
   *
   * OpenRA 对照: SpatiallyPartitioned.Remove(T)
   *
   * @returns true if the item was found and removed
   */
  remove(item: T): boolean {
    const bounds = this.itemBounds.get(item)
    if (bounds === undefined) return false

    this.mutateBins(item, bounds, (bin, i, _b) => void bin.delete(i))
    this.itemBounds.delete(item)
    return true
  }

  /**
   * Get or set the bounds of an item.
   *
   * OpenRA 对照: SpatiallyPartitioned.this[T]
   */
  getItemBounds(item: T): Rectangle | undefined {
    return this.itemBounds.get(item)
  }

  /**
   * Update the bounds of an item.
   *
   * OpenRA 对照: SpatiallyPartitioned.this[T] setter
   */
  setItemBounds(item: T, bounds: Rectangle): void {
    SpatiallyPartitioned.validateBounds(item, bounds)

    const oldBounds = this.itemBounds.get(item)
    if (oldBounds !== undefined) {
      this.mutateBins(item, oldBounds, (bin, i, _b) => void bin.delete(i))
    }
    this.itemBounds.set(item, bounds)
    this.mutateBins(item, bounds, (bin, i, b) => bin.set(i, b))
  }

  // -----------------------------------------------------------------------
  // Bin lookup
  // -----------------------------------------------------------------------

  private binAt(row: number, col: number): Map<T, Rectangle> {
    return this.bins[row * this.cols + col]
  }

  private binBounds(row: number, col: number): Rectangle {
    return new Rectangle(col * this.binSize, row * this.binSize, this.binSize, this.binSize)
  }

  private boundsToBinRowsAndCols(
    bounds: Rectangle,
  ): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
    const top = Math.min(bounds.Top, bounds.Bottom)
    const bottom = Math.max(bounds.Top, bounds.Bottom)
    const left = Math.min(bounds.Left, bounds.Right)
    const right = Math.max(bounds.Left, bounds.Right)

    return {
      minRow: Math.max(0, Math.trunc(top / this.binSize)),
      minCol: Math.max(0, Math.trunc(left / this.binSize)),
      maxRow: Math.min(this.rows, Math.ceil(bottom / this.binSize)),
      maxCol: Math.min(this.cols, Math.ceil(right / this.binSize)),
    }
  }

  private mutateBins(
    item: T,
    bounds: Rectangle,
    action: (bin: Map<T, Rectangle>, item: T, bounds: Rectangle) => void,
  ): void {
    const { minRow, maxRow, minCol, maxCol } = this.boundsToBinRowsAndCols(bounds)

    for (let row = minRow; row < maxRow; row++) {
      for (let col = minCol; col < maxCol; col++) {
        action(this.binAt(row, col), item, bounds)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Spatial queries
  // -----------------------------------------------------------------------

  /**
   * Find all items at a specific point location.
   *
   * OpenRA 对照: SpatiallyPartitioned.At(int2 location)
   *
   * @param x — X coordinate
   * @param y — Y coordinate
   */
  at(x: number, y: number): T[] {
    const col = Math.max(0, Math.min(this.cols - 1, Math.trunc(x / this.binSize)))
    const row = Math.max(0, Math.min(this.rows - 1, Math.trunc(y / this.binSize)))
    const results: T[] = []
    for (const [key, bounds] of this.binAt(row, col)) {
      if (bounds.contains(x, y)) {
        results.push(key)
      }
    }
    return results
  }

  /**
   * Find all items intersecting a rectangular box.
   *
   * OpenRA 对照: SpatiallyPartitioned.InBox(Rectangle)
   */
  inBox(box: Rectangle): T[] {
    const { minRow, maxRow, minCol, maxCol } = this.boundsToBinRowsAndCols(box)

    // Fast path: single bin, no need for dedup set
    if (minRow >= maxRow || minCol >= maxCol) {
      const results: T[] = []
      return results
    }

    const isSingleBin = (maxRow - minRow) === 1 && (maxCol - minCol) === 1

    if (isSingleBin) {
      const results: T[] = []
      for (const [key, bounds] of this.binAt(minRow, minCol)) {
        if (bounds.intersectsWith(box) && this.itemBounds.has(key)) {
          results.push(key)
        }
      }
      return results
    }

    // Multiple bins: use a Set to avoid returning duplicates
    const seen = new Set<T>()
    const results: T[] = []
    for (let row = minRow; row < maxRow; row++) {
      for (let col = minCol; col < maxCol; col++) {
        const binBounds = this.binBounds(row, col)
        for (const [key, bounds] of this.binAt(row, col)) {
          if (!bounds.intersectsWith(box)) continue
          // Safety: ensure item is still tracked in itemBounds
          if (!this.itemBounds.has(key)) continue
          // If the item is wholly contained within the bin, skip dedup tracking
          if (!binBounds.containsRect(bounds)) {
            if (seen.has(key)) continue
            seen.add(key)
          }
          results.push(key)
        }
      }
    }
    return results
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /** Clear all items.
   *
   * OpenRA 对照: SpatiallyPartitioned.Clear()
   */
  clear(): void {
    this.itemBounds.clear()
    for (const bin of this.bins) {
      bin.clear()
    }
  }

  /** All tracked items.
   *
   * OpenRA 对照: SpatiallyPartitioned.Keys
   */
  keys(): IterableIterator<T> {
    return this.itemBounds.keys()
  }

  /** All tracked bounds.
   *
   * OpenRA 对照: SpatiallyPartitioned.Values
   */
  values(): IterableIterator<Rectangle> {
    return this.itemBounds.values()
  }

  /** Number of items.
   *
   * OpenRA 对照: SpatiallyPartitioned.Count
   */
  get count(): number {
    return this.itemBounds.size
  }

  /**
   * Check if an item is tracked.
   *
   * OpenRA 对照: SpatiallyPartitioned.ContainsKey(T)
   */
  containsKey(item: T): boolean {
    return this.itemBounds.has(item)
  }

  /**
   * Try to get the bounds of an item.
   *
   * OpenRA 对照: SpatiallyPartitioned.TryGetValue(T, out Rectangle)
   */
  tryGetValue(key: T): { value: Rectangle } | undefined {
    const value = this.itemBounds.get(key)
    if (value === undefined) return undefined
    return { value }
  }

  /**
   * Iterate over all items and their bounds.
   *
   * OpenRA 对照: SpatiallyPartitioned.GetEnumerator()
   */
  [Symbol.iterator](): IterableIterator<[T, Rectangle]> {
    return this.itemBounds[Symbol.iterator]()
  }
}
