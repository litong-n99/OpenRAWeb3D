/**
 * WVec.ts — 3D world vector (integer components)
 * OpenRA 对照: OpenRA.Game/WVec.cs
 *
 * 核心范式转换:
 * - C# struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - C# out Int32Matrix4x4 → explicit rotateByMatrix
 * - ISqrt from Exts → private static utility
 * - FromPDF → TODO stub (MersenneTwister deferred)
 * - Cross product → added beyond OpenRA (useful for 3D math)
 */

import { WAngle } from './WAngle'
import { WRot } from './WRot'
import { Int32Matrix4x4 } from './Int32Matrix4x4'
import { isqrt } from './Exts'

// ---------------------------------------------------------------------------
// WVec
// ---------------------------------------------------------------------------

/**
 * 3D world vector with integer components.
 *
 * OpenRA 对照: WVec (readonly struct)
 *
 * Immutable. All arithmetic operations return new WVec instances.
 * Length calculations use integer square root for determinism.
 */
export class WVec {
  /** X component.
   *
   * OpenRA 对照: WVec.X
   */
  readonly X: number

  /** Y component.
   *
   * OpenRA 对照: WVec.Y
   */
  readonly Y: number

  /** Z component.
   *
   * OpenRA 对照: WVec.Z
   */
  readonly Z: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Zero vector.
   *
   * OpenRA 对照: WVec.Zero
   */
  static readonly Zero = new WVec(0, 0, 0)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a WVec from X, Y, Z components.
   *
   * OpenRA 对照: WVec(int x, int y, int z)
   */
  constructor(x: number, y: number, z: number) {
    this.X = x | 0
    this.Y = y | 0
    this.Z = z | 0
  }

  /**
   * Construct a WVec from WDist components.
   *
   * OpenRA 对照: WVec(WDist x, WDist y, WDist z)
   *
   * NOTE: Accepts raw values for simplicity; caller extracts WDist.length.
   */
  static fromDists(x: number, y: number, z: number): WVec {
    return new WVec(x, y, z)
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Add two vectors.
   *
   * OpenRA 对照: WVec.operator+(WVec, WVec)
   */
  static add(a: WVec, b: WVec): WVec {
    return new WVec(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
  }

  /**
   * Subtract b from a.
   *
   * OpenRA 对照: WVec.operator-(WVec, WVec)
   */
  static subtract(a: WVec, b: WVec): WVec {
    return new WVec(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
  }

  /**
   * Negate a vector.
   *
   * OpenRA 对照: WVec.operator-(WVec)
   */
  static negate(a: WVec): WVec {
    return new WVec(-a.X, -a.Y, -a.Z)
  }

  /**
   * Multiply vector by a scalar.
   *
   * OpenRA 对照: WVec.operator*(WVec, int)
   */
  static multiply(a: WVec, b: number): WVec {
    return new WVec(a.X * b, a.Y * b, a.Z * b)
  }

  /**
   * Multiply scalar by vector.
   *
   * OpenRA 对照: WVec.operator*(int, WVec)
   */
  static multiplyScalar(a: number, b: WVec): WVec {
    return new WVec(a * b.X, a * b.Y, a * b.Z)
  }

  /**
   * Divide vector by a scalar.
   *
   * OpenRA 对照: WVec.operator/(WVec, int)
   */
  static divide(a: WVec, b: number): WVec {
    return new WVec(a.X / b, a.Y / b, a.Z / b)
  }

  /**
   * Test two vectors for equality.
   *
   * OpenRA 对照: WVec.operator==
   */
  static equals(a: WVec, b: WVec): boolean {
    return a.X === b.X && a.Y === b.Y && a.Z === b.Z
  }

  /**
   * Dot product.
   *
   * OpenRA 对照: WVec.Dot(WVec, WVec)
   */
  static dot(a: WVec, b: WVec): number {
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z
  }

  /**
   * Cross product.
   *
   * NOTE: Not present in OpenRA WVec. Added for 3D math convenience
   * (e.g., constructing WRot from axis-angle).
   */
  static cross(a: WVec, b: WVec): WVec {
    return new WVec(
      a.Y * b.Z - a.Z * b.Y,
      a.Z * b.X - a.X * b.Z,
      a.X * b.Y - a.Y * b.X,
    )
  }

  // -----------------------------------------------------------------------
  // Length properties
  // -----------------------------------------------------------------------

  /** Square of the vector length.
   *
   * OpenRA 对照: WVec.LengthSquared
   */
  get lengthSquared(): number {
    return this.X * this.X + this.Y * this.Y + this.Z * this.Z
  }

  /** Vector length (integer square root).
   *
   * OpenRA 对照: WVec.Length
   */
  get length(): number {
    return isqrt(this.lengthSquared)
  }

  /** Square of the horizontal (XY) length.
   *
   * OpenRA 对照: WVec.HorizontalLengthSquared
   */
  get horizontalLengthSquared(): number {
    return this.X * this.X + this.Y * this.Y
  }

  /** Horizontal (XY) length.
   *
   * OpenRA 对照: WVec.HorizontalLength
   */
  get horizontalLength(): number {
    return isqrt(this.horizontalLengthSquared)
  }

  /** Square of the vertical (Z) length.
   *
   * OpenRA 对照: WVec.VerticalLengthSquared
   */
  get verticalLengthSquared(): number {
    return this.Z * this.Z
  }

  /** Vertical (Z) length.
   *
   * OpenRA 对照: WVec.VerticalLength
   */
  get verticalLength(): number {
    return isqrt(this.verticalLengthSquared)
  }

  // -----------------------------------------------------------------------
  // Yaw (horizontal direction)
  // -----------------------------------------------------------------------

  /**
   * The yaw angle (direction in the XY plane) of this vector.
   * OpenRA defines north as -y.
   *
   * OpenRA 对照: WVec.Yaw
   */
  get yaw(): WAngle {
    if (this.lengthSquared === 0) return WAngle.Zero
    return WAngle.subtract(WAngle.arcTan(-this.Y, this.X), new WAngle(256))
  }

  // -----------------------------------------------------------------------
  // Rotation
  // -----------------------------------------------------------------------

  /**
   * Rotate this vector by a WRot (quaternion-based rotation).
   *
   * OpenRA 对照: WVec.Rotate(WRot)
   */
  rotate(rot: WRot): WVec {
    const mtx = rot.asMatrix()
    return this.rotateByMatrix(mtx)
  }

  /**
   * Rotate this vector by an Int32Matrix4x4 rotation matrix.
   *
   * OpenRA 对照: WVec.Rotate(ref Int32Matrix4x4)
   */
  rotateByMatrix(mtx: Int32Matrix4x4): WVec {
    const lx = this.X
    const ly = this.Y
    const lz = this.Z
    return new WVec(
      Math.trunc(
        (lx * mtx.m11 + ly * mtx.m21 + lz * mtx.m31) / mtx.m44,
      ),
      Math.trunc(
        (lx * mtx.m12 + ly * mtx.m22 + lz * mtx.m32) / mtx.m44,
      ),
      Math.trunc(
        (lx * mtx.m13 + ly * mtx.m23 + lz * mtx.m33) / mtx.m44,
      ),
    )
  }

  // -----------------------------------------------------------------------
  // Interpolation
  // -----------------------------------------------------------------------

  /**
   * Linear interpolation between two vectors.
   *
   * OpenRA 对照: WVec.Lerp(WVec a, WVec b, int mul, int div)
   */
  static lerp(a: WVec, b: WVec, mul: number, div: number): WVec {
    return WVec.add(a, WVec.divide(WVec.multiply(WVec.subtract(b, a), mul), div))
  }

  /**
   * Quadratic interpolation between two vectors with a pitch variation.
   * Uses bigint for intermediate calculations to avoid overflow.
   *
   * OpenRA 对照: WVec.LerpQuadratic(WVec a, WVec b, WAngle pitch, int mul, int div)
   */
  static lerpQuadratic(
    a: WVec,
    b: WVec,
    pitch: WAngle,
    mul: number,
    div: number,
  ): WVec {
    const ret = WVec.lerp(a, b, mul, div)

    if (pitch.angle === 0) return ret

    // Add an additional quadratic variation to height
    // Uses BigInt to avoid integer overflow
    const deltaLen = WVec.subtract(b, a).length
    const offsetNum =
      BigInt(deltaLen) *
      BigInt(pitch.tan()) *
      BigInt(mul) *
      BigInt(div - mul)
    const offsetDen = BigInt(1024) * BigInt(div) * BigInt(div)
    const offset = Number(offsetNum / offsetDen)

    return new WVec(ret.X, ret.Y, ret.Z + offset)
  }

  // NOTE: fromPDF() is deferred pending MersenneTwister migration.
  // See  in docs/actor_system_migration_plan.md
  // When implemented:
  //   static fromPDF(r: MersenneTwisterLike, samples: number): WVec {
  //     return new WVec(WDist.fromPDF(r, samples).length,
  //                     WDist.fromPDF(r, samples).length, 0);
  //   }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another WVec.
   *
   * OpenRA 对照: WVec.Equals(WVec)
   */
  equals(other: WVec): boolean {
    return WVec.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: WVec.ToString()
   */
  toString(): string {
    return `${this.X},${this.Y},${this.Z}`
  }
}
