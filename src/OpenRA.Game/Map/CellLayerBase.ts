/**
 * CellLayerBase.ts — Abstract generic cell layer base class
 * OpenRA 对照: OpenRA.Game/Map/CellLayerBase.cs
 *
 * 核心范式转换:
 * - C# abstract generic class with T[] → TypeScript abstract generic class with T[]
 * - C# IEnumerable<T> → TypeScript Iterable<T> (Symbol.iterator)
 * - C# Memory<T>/Span<T> → TypeScript Array (no Span API in TS)
 * - C# ReadOnlyMemory<T> → readonly T[]
 * - CellLayerBase(Map) → CellLayerBase(MapGridType, Size) — decomposed params
 *   since Map class is not yet migrated (same approach as MPos)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { type MapGridType as MapGridTypeEnum } from './MapGridType'
import { Rectangle } from '../Primitives/Rectangle'
import type { Size } from '../Primitives/Size'

// Re-export Size for convenience (many consumers import it from CellLayerBase)
export type { Size } from '../Primitives/Size'

// ---------------------------------------------------------------------------
// CellLayerBase<T>
// ---------------------------------------------------------------------------

// NOTE: TypedArray optimization for numeric layers (Architect WR item 5):
// OpenRA CellLayer<byte/int/float> stores value types inline. TypeScript
// Array<number> always boxes as double, which is less memory-efficient.
// For numeric layers (especially Height: CellLayer<byte>), consider using
// a TypedArray-backed subclass (e.g., Int8Array for byte, Int32Array for
// int). This is deferred to Phase D when Map.Height/Map.Ramp are migrated.
//
// Suggested pattern:
//   class NumericCellLayer extends CellLayerBase<number> {
//     protected readonly Entries: Int8Array | Int32Array | Float64Array
//   }
// For now, Array<T> provides correctness; TypedArray provides efficiency.

/**
 * Abstract generic base for cell-based data layers.
 *
 * OpenRA 对照: CellLayerBase<T>
 *
 * Stores a flat array of T entries indexed by map coordinates.
 * The underlying `Entries` array has `Size.width * Size.height` elements
 * in row-major (V-major) order.
 *
 * Concrete subclasses (CellLayer, ProjectedCellLayer) provide the
 * coordinate-to-index mapping methods.
 *
 * @typeParam T — the type of data stored per cell
 */
export abstract class CellLayerBase<T> implements Iterable<T> {
  /** Size of the layer (width × height in map cells).
   *
   * OpenRA 对照: CellLayerBase<T>.Size
   */
  readonly Size: Size

  /** Grid type determining coordinate mapping.
   *
   * OpenRA 对照: CellLayerBase<T>.GridType
   */
  readonly GridType: MapGridTypeEnum

  /** Bounding rectangle covering all valid cell indices.
   *
   * OpenRA 对照: CellLayerBase<T>.Bounds
   */
  protected readonly Bounds: Rectangle

  /** Flat storage array.
   *
   * OpenRA 对照: CellLayerBase<T>.Entries
   *
   * Index i corresponds to map position (U, V) where
   * i = V * Size.Width + U for Rectangular grids.
   * See CellLayer.Index() for isometric formulas.
   */
  protected readonly Entries: T[]

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Construct a cell layer base.
   *
   * OpenRA 对照: CellLayerBase(MapGridType, Size)
   *
   * NOTE: OpenRA also has CellLayerBase(Map) which delegates to this
   * constructor via `map.Grid.Type` and `map.MapSize`. Since Map is not
   * yet migrated, we use the decomposed form. When Map is available
   * (Phase D), a Map-taking convenience constructor can be added.
   *
   * @param gridType — the map's grid type (Rectangular or RectangularIsometric)
   * @param size — the map's size in cells (width × height)
   */
  protected constructor(gridType: MapGridTypeEnum, size: Size) {
    this.GridType = gridType
    this.Size = { width: size.width, height: size.height }
    this.Bounds = new Rectangle(0, 0, size.width, size.height)
    this.Entries = new Array<T>(size.width * size.height)
  }

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------

  /**
   * Copy all values from another layer.
   *
   * OpenRA 对照: CellLayerBase<T>.CopyValuesFrom(CellLayerBase<T>)
   *
   * Both layers must have the same size and grid type.
   *
   * @param anotherLayer — the source layer to copy from
   * @throws if sizes or grid types differ
   */
  copyValuesFrom(anotherLayer: CellLayerBase<T>): void {
    if (
      this.Size.width !== anotherLayer.Size.width ||
      this.Size.height !== anotherLayer.Size.height ||
      this.GridType !== anotherLayer.GridType
    ) {
      throw new Error(
        'Layers must have a matching size and shape (grid type).',
      )
    }

    const src = anotherLayer.Entries
    const dst = this.Entries
    for (let i = 0; i < dst.length; i++) {
      dst[i] = src[i]
    }
  }

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  /**
   * Clear the layer contents with their default value (undefined).
   *
   * OpenRA 对照: CellLayerBase<T>.Clear()
   *
   * NOTE: C# `Span<T>.Clear()` sets to `default(T)` which is 0 for
   * value types and null for reference types. TypeScript has no
   * runtime generic default, so we use `undefined`. For numeric
   * layers, use `clear(0)` explicitly.
   */
  clear(): void
  /**
   * Clear the layer contents with a known value.
   *
   * OpenRA 对照: CellLayerBase<T>.Clear(T clearValue)
   *
   * @param clearValue — value to fill all entries with
   */
  clear(clearValue: T): void
  clear(clearValue?: T): void {
    if (arguments.length === 0) {
      const dst = this.Entries
      for (let i = 0; i < dst.length; i++) {
        dst[i] = undefined as unknown as T
      }
      return
    }
    const val = clearValue!
    const dst = this.Entries
    for (let i = 0; i < dst.length; i++) {
      dst[i] = val
    }
  }

  // -------------------------------------------------------------------------
  // Iterable
  // -------------------------------------------------------------------------

  /**
   * Get an iterator over all entries in row-major order.
   *
   * OpenRA 对照: CellLayerBase<T>.GetEnumerator()
   */
  [Symbol.iterator](): Iterator<T> {
    return this.Entries[Symbol.iterator]()
  }

  // -------------------------------------------------------------------------
  // Memory access (OpenRA compatibility)
  // -------------------------------------------------------------------------

  /**
   * Get a read-only reference to the underlying array.
   *
   * OpenRA 对照: CellLayerBase<T>.AsReadOnlyMemory()
   */
  asReadOnlyMemory(): readonly T[] {
    return this.Entries
  }

  /**
   * Get a mutable reference to the underlying array.
   *
   * OpenRA 对照: CellLayerBase<T>.AsMemory()
   */
  asMemory(): T[] {
    return this.Entries
  }
}
