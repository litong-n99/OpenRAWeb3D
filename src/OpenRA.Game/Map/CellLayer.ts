/**
 * CellLayer.ts — Concrete cell layer with CPos/MPos indexing and observer pattern
 * OpenRA 对照: OpenRA.Game/Map/CellLayer.cs
 *
 * 核心范式转换:
 * - C# event Action<CPos> CellEntryChanged → TypeScript observer callback array
 * - C# this[CPos]/this[MPos] indexers → TypeScript get()/set() methods (no [] override)
 * - C# static CellLayer class with Resize → static method on CellLayer
 * - Index formulas MUST match OpenRA exactly (CRITICAL for data integrity)
 *
 * Index formulas (from OpenRA C# source, refined per Architect WR):
 *   Rectangular: index = y * width + x  (direct)
 *   Isometric:   u = (x-y) >> 1 (non-negative), Math.floor((x-y)/2) (negative)
 *                v = x + y, index = v * width + u
 */

import { CPos } from '../CPos'
import { MPos } from '../MPos'
import { MapGridType, type MapGridType as MapGridTypeEnum } from './MapGridType'
import { Rectangle } from '../Primitives/Rectangle'
import { CellLayerBase } from './CellLayerBase'
import { CellRegion } from './CellRegion'
import type { Size } from '../Primitives/Size'

// ---------------------------------------------------------------------------
// CellEntryChanged callback type
// ---------------------------------------------------------------------------

/** Observer callback type for cell entry changes.
 *
 * OpenRA 对照: Action<CPos> event
 *
 * Called with the cell position (CPos) that changed.
 */
export type CellEntryChangedCallback = (cell: CPos) => void

// ---------------------------------------------------------------------------
// CellLayer<T>
// ---------------------------------------------------------------------------

/**
 * Represents a layer of "something" that covers the map.
 *
 * OpenRA 对照: CellLayer<T> (sealed class)
 *
 * Extends CellLayerBase<T> with CPos/MPos indexing, observer notification
 * on mutation, containment checks, and coordinate clamping.
 *
 * The CellEntryChanged observer pattern mirrors OpenRA's C# event:
 * - Observers are notified when a cell value is set via CPos or MPos indexer
 * - Copy/Clear operations are blocked when observers are attached
 *
 * @typeParam T — the type of data stored per cell
 */
export class CellLayer<T> extends CellLayerBase<T> {
  /** Observer callbacks registered for cell change notifications.
   *
   * OpenRA 对照: CellEntryChanged (event Action<CPos>)
   *
   * NOTE: OpenRA uses a C# event (multicast delegate). In TypeScript,
   * we use a callback array. The check is `observerCallbacks.length > 0`
   * (not null), matching the reviewer pre-audit finding.
   */
  private observerCallbacks: CellEntryChangedCallback[] = []

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Construct a CellLayer.
   *
   * OpenRA 对照: CellLayer(Map) or CellLayer(MapGridType, Size)
   *
   * NOTE: OpenRA also has CellLayer(Map) which is deferred until Map is
   * migrated (Phase D). Use the decomposed form with MapGridType + Size.
   *
   * @param gridType — the map's grid type
   * @param size — the map's size in cells (width × height)
   */
  constructor(gridType: MapGridTypeEnum, size: Size) {
    super(gridType, size)
  }

  // -------------------------------------------------------------------------
  // Observer management
  // -------------------------------------------------------------------------

  /**
   * Register an observer for cell entry changes.
   *
   * OpenRA 对照: CellEntryChanged += handler
   *
   * @param callback — called with CPos whenever a cell value is set
   */
  onCellEntryChanged(callback: CellEntryChangedCallback): void {
    this.observerCallbacks.push(callback)
  }

  /**
   * Unregister an observer.
   *
   * OpenRA 对照: CellEntryChanged -= handler
   */
  offCellEntryChanged(callback: CellEntryChangedCallback): void {
    const idx = this.observerCallbacks.indexOf(callback)
    if (idx >= 0) {
      this.observerCallbacks.splice(idx, 1)
    }
  }

  // -------------------------------------------------------------------------
  // Index resolution (CRITICAL: must match OpenRA formulas exactly)
  // -------------------------------------------------------------------------

  /**
   * Resolve an array index from cell coordinates.
   *
   * OpenRA 对照: CellLayer<T>.Index(CPos)
   *
   * PERF: Inline CPos.ToMPos to avoid MPos allocation on the hot path.
   * Architect WR item 1: use >> 1 for non-negative deltas, Math.floor
   * for negative deltas to ensure invalid cells fail the Bounds check.
   *
   * For Rectangular grids: direct (X, Y) → (U, V) mapping, index = Y * W + X.
   * For RectangularIsometric grids:
   *   u = delta >= 0 ? delta >> 1 : Math.floor(delta / 2)
   *   v = x + y
   *   index = v * width + u
   */
  private indexFromCPos(cell: CPos): number {
    // PERF: Inline CPos.ToMPos to avoid MPos allocation
    const x = cell.X
    const y = cell.Y

    if (this.GridType === MapGridType.Rectangular) {
      // NOTE: OpenRA omits bounds check for Rectangular (relies on C#
      // array bounds check throwing IndexOutOfRangeException). Since
      // JavaScript silently returns undefined for out-of-bounds array
      // access, we add an explicit bounds check to match the C# behavior
      // of throwing on invalid coordinates.
      if (x < 0 || x >= this.Size.width || y < 0 || y >= this.Size.height) {
        throw new RangeError(
          `Cell coordinate ${cell.toString()} is outside map bounds`,
        )
      }
      return y * this.Size.width + x
    }

    // RectangularIsometric — Architect WR item 1:
    // Use >> 1 for non-negative deltas, Math.floor for negative deltas.
    // This ensures invalid cells (X < Y for isometric) produce a negative u
    // that fails the Bounds check, preventing silent incorrect data access.
    const delta = x - y
    const u = delta >= 0 ? delta >> 1 : Math.floor(delta / 2)
    const v = x + y

    if (!this.Bounds.contains(u, v)) {
      throw new RangeError(
        `Cell coordinate ${cell.toString()} is outside map bounds`,
      )
    }
    return v * this.Size.width + u
  }

  /**
   * Resolve an array index from map coordinates.
   *
   * OpenRA 对照: CellLayer<T>.Index(MPos)
   */
  private indexFromMPos(uv: MPos): number {
    if (!this.Bounds.contains(uv.U, uv.V)) {
      throw new RangeError(
        `Map coordinate ${uv.toString()} is outside map bounds`,
      )
    }
    return uv.V * this.Size.width + uv.U
  }

  // -------------------------------------------------------------------------
  // CPos accessor (get/set by cell coordinates)
  // -------------------------------------------------------------------------

  /**
   * Get the value at the given cell position.
   *
   * OpenRA 对照: CellLayer<T>.this[CPos] get
   *
   * @param cell — cell position
   * @returns the stored value
   */
  get(cell: CPos): T {
    return this.Entries[this.indexFromCPos(cell)]
  }

  /**
   * Set the value at the given cell position and notify observers.
   *
   * OpenRA 对照: CellLayer<T>.this[CPos] set
   *
   * Notifies all registered CellEntryChanged observers after the value
   * is written.
   *
   * @param cell — cell position
   * @param value — new value
   */
  set(cell: CPos, value: T): void {
    this.Entries[this.indexFromCPos(cell)] = value

    // Notify observers
    if (this.observerCallbacks.length > 0) {
      for (const cb of this.observerCallbacks) {
        cb(cell)
      }
    }
  }

  // -------------------------------------------------------------------------
  // MPos accessor (get/set by map coordinates)
  // -------------------------------------------------------------------------

  /**
   * Get the value at the given map position.
   *
   * OpenRA 对照: CellLayer<T>.this[MPos] get
   *
   * @param uv — map position (U, V)
   * @returns the stored value
   */
  getMPos(uv: MPos): T {
    return this.Entries[this.indexFromMPos(uv)]
  }

  /**
   * Set the value at the given map position and notify observers.
   *
   * OpenRA 对照: CellLayer<T>.this[MPos] set
   *
   * CRITICAL: Converts MPos→CPos before firing observer callback,
   * matching OpenRA's `CellEntryChanged?.Invoke(uv.ToCPos(GridType))`.
   *
   * @param uv — map position (U, V)
   * @param value — new value
   */
  setMPos(uv: MPos, value: T): void {
    this.Entries[this.indexFromMPos(uv)] = value

    // Notify observers — convert MPos→CPos for callback (matching OpenRA)
    if (this.observerCallbacks.length > 0) {
      const cell = uv.toCPos(this.GridType)
      for (const cb of this.observerCallbacks) {
        cb(cell)
      }
    }
  }

  // -------------------------------------------------------------------------
  // TryGetValue
  // -------------------------------------------------------------------------

  /**
   * Try to get a value at the given cell position.
   *
   * OpenRA 对照: CellLayer<T>.TryGetValue(CPos, out T)
   *
   * Returns null if the cell is outside bounds or invalid for the grid type.
   * For RectangularIsometric grids, cells with X < Y are pre-filtered.
   *
   * NOTE: X==Y is NOT rejected (boundary case per reviewer pre-audit).
   * Only X < Y is invalid for RectangularIsometric.
   *
   * @param cell — cell position to look up
   * @returns the value, or null if the cell is invalid/out of bounds
   */
  tryGetValue(cell: CPos): T | null {
    // .ToMPos() returns the same result if the X and Y coordinates
    // are switched. X < Y is invalid in the RectangularIsometric coordinate system,
    // so we pre-filter these to avoid returning the wrong result.
    // NOTE: X==Y is valid (reviewer pre-audit finding).
    if (this.GridType === MapGridType.RectangularIsometric && cell.X < cell.Y) {
      return null
    }

    const uv = cell.toMPos(this.GridType)
    if (this.Bounds.contains(uv.U, uv.V)) {
      return this.Entries[uv.V * this.Size.width + uv.U]
    }

    return null
  }

  // -------------------------------------------------------------------------
  // Contains
  // -------------------------------------------------------------------------

  /**
   * Check whether this layer contains a cell position.
   *
   * OpenRA 对照: CellLayer<T>.Contains(CPos)
   *
   * For RectangularIsometric grids, cells with X < Y are pre-filtered
   * (same logic as TryGetValue).
   *
   * NOTE: X==Y is NOT rejected (boundary case).
   */
  contains(cell: CPos): boolean
  /**
   * Check whether this layer contains a map position.
   *
   * OpenRA 对照: CellLayer<T>.Contains(MPos)
   */
  contains(uv: MPos): boolean
  contains(cellOrUV: CPos | MPos): boolean {
    if (cellOrUV instanceof CPos) {
      const cell = cellOrUV
      if (
        this.GridType === MapGridType.RectangularIsometric &&
        cell.X < cell.Y
      ) {
        return false
      }
      return this.contains(cell.toMPos(this.GridType))
    }

    const uv = cellOrUV as MPos
    return this.Bounds.contains(uv.U, uv.V)
  }

  // -------------------------------------------------------------------------
  // Clamp
  // -------------------------------------------------------------------------

  /**
   * Clamp a cell position to within this layer's bounds.
   *
   * OpenRA 对照: CellLayer<T>.Clamp(CPos)
   *
   * @param cell — cell position to clamp
   * @returns the closest valid cell position
   */
  clamp(cell: CPos): CPos {
    return this.clampMPos(cell.toMPos(this.GridType)).toCPos(this.GridType)
  }

  /**
   * Clamp a map position to within this layer's bounds.
   *
   * OpenRA 对照: CellLayer<T>.Clamp(MPos)
   *
   * @param uv — map position to clamp
   * @returns the closest valid map position
   */
  clampMPos(uv: MPos): MPos {
    return uv.clamp(
      new Rectangle(0, 0, this.Size.width - 1, this.Size.height - 1),
    )
  }

  // -------------------------------------------------------------------------
  // CellRegion
  // -------------------------------------------------------------------------

  /**
   * Get the full cell region covered by this layer.
   *
   * OpenRA 对照: CellLayer<T>.CellRegion
   *
   * Returns a CellRegion spanning from (0, 0) to (Size.Width-1, Size.Height-1)
   * in map coordinates, converted to cell coordinates per the grid type.
   */
  get layerCellRegion(): CellRegion {
    return new CellRegion(
      this.GridType,
      new MPos(0, 0),
      new MPos(this.Size.width - 1, this.Size.height - 1),
    )
  }

  // -------------------------------------------------------------------------
  // Overridden: CopyValuesFrom, Clear (with observer guard)
  // -------------------------------------------------------------------------

  /**
   * Copy all values from another layer.
   *
   * OpenRA 对照: CellLayer<T>.CopyValuesFrom(CellLayerBase<T>)
   *
   * Blocked when observers are attached (matching OpenRA).
   *
   * @throws if observers are attached
   */
  override copyValuesFrom(anotherLayer: CellLayerBase<T>): void {
    if (this.observerCallbacks.length > 0) {
      throw new Error(
        'Cannot copy values when there are listeners attached to the CellEntryChanged event.',
      )
    }
    super.copyValuesFrom(anotherLayer)
  }

  /**
   * Clear the layer contents with their default value.
   *
   * OpenRA 对照: CellLayer<T>.Clear()
   *
   * Blocked when observers are attached (matching OpenRA).
   *
   * @throws if observers are attached
   */
  override clear(): void
  /**
   * Clear the layer contents with a known value.
   *
   * OpenRA 对照: CellLayer<T>.Clear(T clearValue)
   *
   * Blocked when observers are attached (matching OpenRA).
   *
   * @throws if observers are attached
   */
  override clear(clearValue: T): void
  override clear(clearValue?: T): void {
    if (this.observerCallbacks.length > 0) {
      throw new Error(
        'Cannot clear values when there are listeners attached to the CellEntryChanged event.',
      )
    }
    if (arguments.length === 0) {
      super.clear()
    } else {
      super.clear(clearValue!)
    }
  }

  // -------------------------------------------------------------------------
  // Static: Resize
  // -------------------------------------------------------------------------

  /**
   * Create a new layer by resizing another layer.
   *
   * OpenRA 对照: CellLayer.Resize<T>(CellLayer<T>, Size, T)
   *
   * New cells are filled with defaultValue. Existing values are copied
   * for the overlapping region.
   *
   * @param layer — source layer
   * @param newSize — target size (must have same grid type)
   * @param defaultValue — fill value for new cells
   * @returns a new resized CellLayer
   */
  static resize<T>(
    layer: CellLayer<T>,
    newSize: Size,
    defaultValue: T,
  ): CellLayer<T> {
    const result = new CellLayer<T>(layer.GridType, newSize)
    const width = Math.min(layer.Size.width, newSize.width)
    const height = Math.min(layer.Size.height, newSize.height)

    result.clear(defaultValue)
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        result.setMPos(new MPos(i, j), layer.getMPos(new MPos(i, j)))
      }
    }

    return result
  }
}
