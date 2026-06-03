/**
 * Int32Matrix4x4.ts — 4x4 integer matrix for OpenRA rotation math
 * OpenRA 对照: OpenRA.Game/Primitives/Int32Matrix4x4.cs
 *
 * 核心范式转换:
 * - C# readonly struct (value type) → immutable TypeScript class
 * - Used for CPU-side rotation transforms (WRot.AsMatrix, WVec.Rotate)
 * - NOT used for GPU rendering (BABYLON.Matrix is used there)
 */

// ---------------------------------------------------------------------------
// Int32Matrix4x4
// ---------------------------------------------------------------------------

/**
 * 4x4 matrix of 32-bit integers.
 *
 * OpenRA 对照: Int32Matrix4x4 (readonly struct)
 *
 * Immutable. Used internally by WRot and WVec for rotation calculations.
 * Fields are named M[row][col] following the OpenRA convention.
 */
export class Int32Matrix4x4 {
  /** Row 1, Column 1 */
  readonly m11: number
  /** Row 1, Column 2 */
  readonly m12: number
  /** Row 1, Column 3 */
  readonly m13: number
  /** Row 1, Column 4 */
  readonly m14: number

  /** Row 2, Column 1 */
  readonly m21: number
  /** Row 2, Column 2 */
  readonly m22: number
  /** Row 2, Column 3 */
  readonly m23: number
  /** Row 2, Column 4 */
  readonly m24: number

  /** Row 3, Column 1 */
  readonly m31: number
  /** Row 3, Column 2 */
  readonly m32: number
  /** Row 3, Column 3 */
  readonly m33: number
  /** Row 3, Column 4 */
  readonly m34: number

  /** Row 4, Column 1 */
  readonly m41: number
  /** Row 4, Column 2 */
  readonly m42: number
  /** Row 4, Column 3 */
  readonly m43: number
  /** Row 4, Column 4 */
  readonly m44: number

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a 4x4 integer matrix.
   *
   * OpenRA 对照: Int32Matrix4x4(int m11, ..., int m44)
   */
  constructor(
    m11: number,
    m12: number,
    m13: number,
    m14: number,
    m21: number,
    m22: number,
    m23: number,
    m24: number,
    m31: number,
    m32: number,
    m33: number,
    m34: number,
    m41: number,
    m42: number,
    m43: number,
    m44: number,
  ) {
    this.m11 = m11 | 0
    this.m12 = m12 | 0
    this.m13 = m13 | 0
    this.m14 = m14 | 0
    this.m21 = m21 | 0
    this.m22 = m22 | 0
    this.m23 = m23 | 0
    this.m24 = m24 | 0
    this.m31 = m31 | 0
    this.m32 = m32 | 0
    this.m33 = m33 | 0
    this.m34 = m34 | 0
    this.m41 = m41 | 0
    this.m42 = m42 | 0
    this.m43 = m43 | 0
    this.m44 = m44 | 0
  }

  // -----------------------------------------------------------------------
  // Operators
  // -----------------------------------------------------------------------

  /**
   * Test two Int32Matrix4x4 instances for equality.
   *
   * OpenRA 对照: Int32Matrix4x4.operator==
   */
  static equals(a: Int32Matrix4x4, b: Int32Matrix4x4): boolean {
    return (
      a.m11 === b.m11 &&
      a.m12 === b.m12 &&
      a.m13 === b.m13 &&
      a.m14 === b.m14 &&
      a.m21 === b.m21 &&
      a.m22 === b.m22 &&
      a.m23 === b.m23 &&
      a.m24 === b.m24 &&
      a.m31 === b.m31 &&
      a.m32 === b.m32 &&
      a.m33 === b.m33 &&
      a.m34 === b.m34 &&
      a.m41 === b.m41 &&
      a.m42 === b.m42 &&
      a.m43 === b.m43 &&
      a.m44 === b.m44
    )
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another Int32Matrix4x4.
   *
   * OpenRA 对照: Int32Matrix4x4.Equals(Int32Matrix4x4)
   */
  equals(other: Int32Matrix4x4): boolean {
    return Int32Matrix4x4.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: Int32Matrix4x4.ToString()
   */
  toString(): string {
    return (
      `[${this.m11} ${this.m12} ${this.m13} ${this.m14}],` +
      `[${this.m21} ${this.m22} ${this.m23} ${this.m24}],` +
      `[${this.m31} ${this.m32} ${this.m33} ${this.m34}],` +
      `[${this.m41} ${this.m42} ${this.m43} ${this.m44}]`
    )
  }
}
