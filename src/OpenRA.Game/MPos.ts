/**
 * MPos.ts — Map position (U, V integer grid coordinates)
 * OpenRA 对照: OpenRA.Game/MPos.cs
 *
 * 核心范式转换:
 * - C# readonly struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - ToCPos(Map) → ToCPos(MapGridType) (Map type not yet migrated)
 * - Also includes PPos (projected map position)
 */

import { CPos } from './CPos'
import { MapGridType, type MapGridType as MapGridTypeEnum } from './Map/MapGridType'
import { Rectangle } from './Primitives/Rectangle'

// ---------------------------------------------------------------------------
// MPos
// ---------------------------------------------------------------------------

/**
 * Map position using U, V integer grid coordinates.
 *
 * OpenRA 对照: MPos (readonly struct)
 *
 * Immutable. Represents a position in the map's coordinate grid.
 * Converts to/from CPos via the map's grid type.
 */
export class MPos {
  /** U coordinate (horizontal grid index).
   *
   * OpenRA 对照: MPos.U
   */
  readonly U: number

  /** V coordinate (vertical grid index).
   *
   * OpenRA 对照: MPos.V
   */
  readonly V: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Zero position (0, 0).
   *
   * OpenRA 对照: MPos.Zero
   */
  static readonly Zero = new MPos(0, 0)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct an MPos from U, V coordinates.
   *
   * OpenRA 对照: MPos(int u, int v)
   */
  constructor(u: number, v: number) {
    this.U = u | 0
    this.V = v | 0
  }

  // -----------------------------------------------------------------------
  // Conversion
  // -----------------------------------------------------------------------

  /**
   * Convert this map position to a cell position.
   *
   * OpenRA 对照: MPos.ToCPos(MapGridType)
   *
   * For Rectangular grids: direct (U, V) → (X, Y) mapping.
   * For RectangularIsometric grids: staggered row conversion:
   *   y = (V - (V & 1)) / 2 - U
   *   x = V - y
   */
  toCPos(gridType: MapGridTypeEnum): CPos {
    if (gridType === MapGridType.Rectangular) return new CPos(this.U, this.V)

    // Convert from rectangular map position to RectangularIsometric cell position
    // - The staggered rows make this fiddly (hint: draw a diagram!)
    // (a) Consider the relationships:
    //  - +1u (even -> odd) adds (1, -1) to (x, y)
    //  - +1v (even -> odd) adds (1, 0) to (x, y)
    //  - +1v (odd -> even) adds (0, 1) to (x, y)
    // (b) Therefore:
    //  - au + 2bv adds (a + b) to (x, y)
    //  - a correction factor is added if v is odd
    const y = ((this.V - (this.V & 1)) / 2) - this.U
    const x = this.V - y
    return new CPos(x, y)
  }

  // -----------------------------------------------------------------------
  // Clamp
  // -----------------------------------------------------------------------

  /**
   * Clamp this map position to within a rectangle.
   *
   * OpenRA 对照: MPos.Clamp(Rectangle)
   */
  clamp(r: Rectangle): MPos {
    return new MPos(
      Math.min(r.Right, Math.max(this.U, r.Left)),
      Math.min(r.Bottom, Math.max(this.V, r.Top)),
    )
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Test two MPos for equality.
   *
   * OpenRA 对照: MPos.operator==
   */
  static equals(a: MPos, b: MPos): boolean {
    return a.U === b.U && a.V === b.V
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another MPos.
   *
   * OpenRA 对照: MPos.Equals(MPos)
   */
  equals(other: MPos): boolean {
    return MPos.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: MPos.ToString()
   */
  toString(): string {
    return `${this.U},${this.V}`
  }
}

// ---------------------------------------------------------------------------
// PPos — Projected map position
// ---------------------------------------------------------------------------

/**
 * Projected map position.
 *
 * OpenRA 对照: PPos (readonly struct)
 *
 * Used for screen-space projection of map coordinates.
 * Has explicit casts to/from MPos (provided as static conversion methods).
 */
export class PPos {
  /** U coordinate.
   *
   * OpenRA 对照: PPos.U
   */
  readonly U: number

  /** V coordinate.
   *
   * OpenRA 对照: PPos.V
   */
  readonly V: number

  /** Zero projected position.
   *
   * OpenRA 对照: PPos.Zero
   */
  static readonly Zero = new PPos(0, 0)

  /**
   * Construct a PPos from U, V coordinates.
   *
   * OpenRA 对照: PPos(int u, int v)
   */
  constructor(u: number, v: number) {
    this.U = u | 0
    this.V = v | 0
  }

  /**
   * Convert from MPos to PPos.
   *
   * OpenRA 对照: explicit operator PPos(MPos)
   */
  static fromMPos(uv: MPos): PPos {
    return new PPos(uv.U, uv.V)
  }

  /**
   * Convert from PPos to MPos.
   *
   * OpenRA 对照: explicit operator MPos(PPos)
   */
  toMPos(): MPos {
    return new MPos(this.U, this.V)
  }

  /**
   * Clamp this projected position to within a rectangle.
   *
   * OpenRA 对照: PPos.Clamp(Rectangle)
   */
  clamp(r: Rectangle): PPos {
    return new PPos(
      Math.min(r.Right, Math.max(this.U, r.Left)),
      Math.min(r.Bottom, Math.max(this.V, r.Top)),
    )
  }

  /**
   * Test two PPos for equality.
   *
   * OpenRA 对照: PPos.operator==
   */
  static equals(a: PPos, b: PPos): boolean {
    return a.U === b.U && a.V === b.V
  }

  /**
   * Check equality with another PPos.
   *
   * OpenRA 对照: PPos.Equals(PPos)
   */
  equals(other: PPos): boolean {
    return PPos.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: PPos.ToString()
   */
  toString(): string {
    return `${this.U},${this.V}`
  }
}
