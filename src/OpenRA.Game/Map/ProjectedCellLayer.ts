/**
 * ProjectedCellLayer.ts — Cell layer indexed by projected map coordinates (PPos)
 * OpenRA 对照: OpenRA.Game/Map/ProjectedCellLayer.cs
 *
 * 核心范式转换:
 * - C# this[PPos]/this[int] indexers → TypeScript get()/set()/getByIndex() methods
 * - C# ref return (not applicable) → direct value read/write
 * - PPos indexing: flat (U, V) → i = V * Width + U (no isometric conversion)
 *
 * ProjectedCellLayer is used for screen-space projection layers where cells
 * are indexed by PPos (projected position) rather than CPos/MPos.
 */

import { PPos } from '../MPos'
import { type MapGridType as MapGridTypeEnum } from './MapGridType'
import { CellLayerBase } from './CellLayerBase'
import type { Size } from './CellLayerBase'

// ---------------------------------------------------------------------------
// ProjectedCellLayer<T>
// ---------------------------------------------------------------------------

/**
 * Cell layer indexed by projected map coordinates (PPos).
 *
 * OpenRA 对照: ProjectedCellLayer<T>
 *
 * Unlike CellLayer<T> which uses CPos/MPos with isometric index formulas,
 * ProjectedCellLayer uses direct (U, V) → index mapping:
 *   index = V * Width + U
 *
 * @typeParam T — the type of data stored per cell
 */
export class ProjectedCellLayer<T> extends CellLayerBase<T> {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Construct a ProjectedCellLayer.
   *
   * OpenRA 对照: ProjectedCellLayer(Map) or ProjectedCellLayer(MapGridType, Size)
   *
   * NOTE: OpenRA also has ProjectedCellLayer(Map) which is deferred until
   * Map is migrated (Phase D). Use the decomposed form.
   *
   * @param gridType — the map's grid type
   * @param size — the map's size in cells (width × height)
   */
  constructor(gridType: MapGridTypeEnum, size: Size) {
    super(gridType, size)
  }

  // -------------------------------------------------------------------------
  // MaxIndex
  // -------------------------------------------------------------------------

  /**
   * Maximum valid index (Size.Width * Size.Height).
   *
   * OpenRA 对照: ProjectedCellLayer<T>.MaxIndex
   */
  get MaxIndex(): number {
    return this.Size.width * this.Size.height
  }

  // -------------------------------------------------------------------------
  // Index resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve an array index from projected map coordinates.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.Index(PPos)
   *
   * Simple row-major: index = V * Width + U.
   * No bounds check — callers must ensure PPos is within bounds.
   *
   * @param uv — projected map position
   */
  index(uv: PPos): number {
    return uv.V * this.Size.width + uv.U
  }

  /**
   * Get the PPos from a flat array index.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.PPosFromIndex(int)
   *
   * Inverse of Index: U = index % Width, V = index / Width.
   *
   * @param index — flat array index
   */
  pposFromIndex(index: number): PPos {
    return new PPos(index % this.Size.width, (index / this.Size.width) | 0)
  }

  // -------------------------------------------------------------------------
  // Integer index accessor
  // -------------------------------------------------------------------------

  /**
   * Get value by raw integer index.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.this[int] get
   *
   * @param index — flat array index (0 to MaxIndex-1)
   */
  getByIndex(index: number): T {
    return this.Entries[index]
  }

  /**
   * Set value by raw integer index.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.this[int] set
   *
   * @param index — flat array index (0 to MaxIndex-1)
   * @param value — new value
   */
  setByIndex(index: number, value: T): void {
    this.Entries[index] = value
  }

  // -------------------------------------------------------------------------
  // PPos accessor
  // -------------------------------------------------------------------------

  /**
   * Get value by projected map position.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.this[PPos] get
   *
   * @param uv — projected map position
   */
  get(uv: PPos): T {
    return this.Entries[this.index(uv)]
  }

  /**
   * Set value by projected map position.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.this[PPos] set
   *
   * @param uv — projected map position
   * @param value — new value
   */
  set(uv: PPos, value: T): void {
    this.Entries[this.index(uv)] = value
  }

  // -------------------------------------------------------------------------
  // Contains
  // -------------------------------------------------------------------------

  /**
   * Check whether this layer contains a projected map position.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.Contains(PPos)
   *
   * Checks U, V against Bounds (0, 0, width, height).
   */
  contains(uv: PPos): boolean {
    return this.Bounds.contains(uv.U, uv.V)
  }

  // -------------------------------------------------------------------------
  // SetAll
  // -------------------------------------------------------------------------

  /**
   * Set all entries to the same value.
   *
   * OpenRA 对照: ProjectedCellLayer<T>.SetAll(T)
   *
   * Uses the base class Clear(value) for efficiency.
   *
   * @param value — value to set all entries to
   */
  setAll(value: T): void {
    super.clear(value)
  }
}
