/**
 * CVec.ts — Cell vector (integer X, Y offsets for grid movement)
 * OpenRA 对照: OpenRA.Game/CVec.cs
 *
 * 核心范式转换:
 * - C# readonly struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - Lua scripting interface → removed (not needed in TS)
 * - ISqrt from Exts → imported
 */

import { Rectangle } from './Primitives/Rectangle'
import { isqrt } from './Exts'

// ---------------------------------------------------------------------------
// CVec
// ---------------------------------------------------------------------------

/**
 * 2D cell vector with integer X, Y components.
 *
 * OpenRA 对照: CVec (readonly struct)
 *
 * Immutable. Represents an offset in cell coordinates.
 * Used for 8-directional RTS movement on the grid.
 *
 * NOTE: Lua scripting interface (ILuaAdditionBinding, etc.) is removed.
 */
export class CVec {
  /** X component (cell offset).
   *
   * OpenRA 对照: CVec.X
   */
  readonly X: number

  /** Y component (cell offset).
   *
   * OpenRA 对照: CVec.Y
   */
  readonly Y: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Zero vector (0, 0).
   *
   * OpenRA 对照: CVec.Zero
   */
  static readonly Zero = new CVec(0, 0)

  /**
   * Eight cardinal and diagonal direction vectors.
   *
   * OpenRA 对照: CVec.Directions
   *
   * Order: (-1,-1), (-1,0), (-1,1), (0,-1), (0,1), (1,-1), (1,0), (1,1)
   */
  static readonly Directions: readonly CVec[] = [
    new CVec(-1, -1),
    new CVec(-1, 0),
    new CVec(-1, 1),
    new CVec(0, -1),
    new CVec(0, 1),
    new CVec(1, -1),
    new CVec(1, 0),
    new CVec(1, 1),
  ]

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a CVec from X, Y components.
   *
   * OpenRA 对照: CVec(int x, int y)
   */
  constructor(x: number, y: number) {
    this.X = x | 0
    this.Y = y | 0
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Add two cell vectors.
   *
   * OpenRA 对照: CVec.operator+(CVec, CVec)
   */
  static add(a: CVec, b: CVec): CVec {
    return new CVec(a.X + b.X, a.Y + b.Y)
  }

  /**
   * Subtract b from a.
   *
   * OpenRA 对照: CVec.operator-(CVec, CVec)
   */
  static subtract(a: CVec, b: CVec): CVec {
    return new CVec(a.X - b.X, a.Y - b.Y)
  }

  /**
   * Negate a cell vector.
   *
   * OpenRA 对照: CVec.operator-(CVec)
   */
  static negate(a: CVec): CVec {
    return new CVec(-a.X, -a.Y)
  }

  /**
   * Multiply scalar by CVec (a * b).
   *
   * OpenRA 对照: CVec.operator*(int, CVec)
   */
  static multiplyScalar(a: number, b: CVec): CVec {
    return new CVec(a * b.X, a * b.Y)
  }

  /**
   * Multiply CVec by scalar (b * a).
   *
   * OpenRA 对照: CVec.operator*(CVec, int)
   */
  static multiply(a: CVec, b: number): CVec {
    return new CVec(a.X * b, a.Y * b)
  }

  /**
   * Divide CVec by scalar.
   *
   * OpenRA 对照: CVec.operator/(CVec, int)
   */
  static divide(a: CVec, b: number): CVec {
    return new CVec(a.X / b, a.Y / b)
  }

  /**
   * Maximum of two CVec coordinates (component-wise).
   *
   * OpenRA 对照: CVec.Max(CVec, CVec)
   */
  static max(a: CVec, b: CVec): CVec {
    return new CVec(Math.max(a.X, b.X), Math.max(a.Y, b.Y))
  }

  /**
   * Minimum of two CVec coordinates (component-wise).
   *
   * OpenRA 对照: CVec.Min(CVec, CVec)
   */
  static min(a: CVec, b: CVec): CVec {
    return new CVec(Math.min(a.X, b.X), Math.min(a.Y, b.Y))
  }

  /**
   * Dot product of two cell vectors.
   *
   * OpenRA 对照: CVec.Dot(CVec, CVec)
   */
  static dot(a: CVec, b: CVec): number {
    return a.X * b.X + a.Y * b.Y
  }

  /**
   * Test two CVec for equality.
   *
   * OpenRA 对照: CVec.operator==
   */
  static equals(a: CVec, b: CVec): boolean {
    return a.X === b.X && a.Y === b.Y
  }

  // -----------------------------------------------------------------------
  // Instance methods
  // -----------------------------------------------------------------------

  /**
   * Get the sign of each component (-1, 0, or 1).
   *
   * OpenRA 对照: CVec.Sign()
   */
  sign(): CVec {
    return new CVec(Math.sign(this.X), Math.sign(this.Y))
  }

  /**
   * Get the absolute value of each component.
   *
   * OpenRA 对照: CVec.Abs()
   */
  abs(): CVec {
    return new CVec(Math.abs(this.X), Math.abs(this.Y))
  }

  /**
   * Clamp this vector to within a rectangle.
   *
   * OpenRA 对照: CVec.Clamp(Rectangle)
   */
  clamp(r: Rectangle): CVec {
    return new CVec(
      Math.min(r.Right, Math.max(this.X, r.Left)),
      Math.min(r.Bottom, Math.max(this.Y, r.Top)),
    )
  }

  // -----------------------------------------------------------------------
  // Length properties
  // -----------------------------------------------------------------------

  /** Squared length of the vector.
   *
   * OpenRA 对照: CVec.LengthSquared
   */
  get lengthSquared(): number {
    return this.X * this.X + this.Y * this.Y
  }

  /** Length of the vector (integer square root).
   *
   * OpenRA 对照: CVec.Length
   */
  get length(): number {
    return isqrt(this.lengthSquared)
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another CVec.
   *
   * OpenRA 对照: CVec.Equals(CVec)
   */
  equals(other: CVec): boolean {
    return CVec.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: CVec.ToString()
   */
  toString(): string {
    return `${this.X},${this.Y}`
  }
}
