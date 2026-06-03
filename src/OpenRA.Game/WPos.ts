/**
 * WPos.ts — 3D world position (1024 sub-units per cell)
 * OpenRA 对照: OpenRA.Game/WPos.cs
 *
 * 核心范式转换:
 * - C# struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - IEnumerable<WPos>.Average() extension → static method
 * - OpenRA's Z dimension used for height in Babylon.js 3D scene
 */

import { WAngle } from './WAngle'
import { WVec } from './WVec'

// ---------------------------------------------------------------------------
// WPos
// ---------------------------------------------------------------------------

/**
 * 3D world position with integer coordinates (1024 sub-units = 1 cell).
 *
 * OpenRA 对照: WPos (readonly struct)
 *
 * Immutable. All operations return new WPos instances.
 * Map X/Y/Z to Babylon.js position at render boundary via CoordinateTransformer.
 */
export class WPos {
  /** X coordinate.
   *
   * OpenRA 对照: WPos.X
   */
  readonly X: number

  /** Y coordinate.
   *
   * OpenRA 对照: WPos.Y
   */
  readonly Y: number

  /** Z coordinate (height).
   *
   * OpenRA 对照: WPos.Z
   */
  readonly Z: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Origin position (0, 0, 0).
   *
   * OpenRA 对照: WPos.Zero
   */
  static readonly Zero = new WPos(0, 0, 0)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a WPos from X, Y, Z coordinates.
   *
   * OpenRA 对照: WPos(int x, int y, int z)
   */
  constructor(x: number, y: number, z: number) {
    this.X = x | 0
    this.Y = y | 0
    this.Z = z | 0
  }

  // -----------------------------------------------------------------------
  // Vector conversion
  // -----------------------------------------------------------------------

  /**
   * Convert this position to a WVec (relative position from origin).
   *
   * OpenRA 对照: (WVec)cast → explicit operator WVec(in WPos)
   */
  toWVec(): WVec {
    return new WVec(this.X, this.Y, this.Z)
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Add a vector to a position (displace the position).
   *
   * OpenRA 对照: WPos.operator+(WPos, WVec)
   */
  static add(a: WPos, b: WVec): WPos {
    return new WPos(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
  }

  /**
   * Subtract a vector from a position (displace in opposite direction).
   *
   * OpenRA 对照: WPos.operator-(WPos, WVec)
   */
  static subtractVec(a: WPos, b: WVec): WPos {
    return new WPos(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
  }

  /**
   * Subtract two positions to get a vector (displacement from b to a).
   *
   * OpenRA 对照: WPos.operator-(WPos, WPos) → WVec
   */
  static subtract(a: WPos, b: WPos): WVec {
    return new WVec(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
  }

  /**
   * Test two positions for equality.
   *
   * OpenRA 对照: WPos.operator==
   */
  static equals(a: WPos, b: WPos): boolean {
    return a.X === b.X && a.Y === b.Y && a.Z === b.Z
  }

  // -----------------------------------------------------------------------
  // Interpolation
  // -----------------------------------------------------------------------

  /**
   * Linear interpolation between two positions (int version).
   *
   * OpenRA 对照: WPos.Lerp(WPos a, WPos b, int mul, int div)
   */
  static lerp(a: WPos, b: WPos, mul: number, div: number): WPos {
    return WPos.add(a, WVec.divide(WVec.multiply(WPos.subtract(b, a), mul), div))
  }

  /**
   * Linear interpolation between two positions (long/BigInt version,
   * for higher precision in intermediate calculations).
   *
   * OpenRA 对照: WPos.Lerp(WPos a, WPos b, long mul, long div)
   */
  static lerpLong(a: WPos, b: WPos, mul: number, div: number): WPos {
    // The intermediate variables may need more precision than
    // an int can provide, so we use BigInt for intermediate math
    const x = Number(
      BigInt(a.X) + ((BigInt(b.X - a.X) * BigInt(mul)) / BigInt(div)),
    )
    const y = Number(
      BigInt(a.Y) + ((BigInt(b.Y - a.Y) * BigInt(mul)) / BigInt(div)),
    )
    const z = Number(
      BigInt(a.Z) + ((BigInt(b.Z - a.Z) * BigInt(mul)) / BigInt(div)),
    )
    return new WPos(x, y, z)
  }

  /**
   * Quadratic interpolation between two positions with a pitch variation.
   * Uses BigInt for intermediate calculations to avoid overflow.
   *
   * OpenRA 对照: WPos.LerpQuadratic(WPos a, WPos b, WAngle pitch, int mul, int div)
   */
  static lerpQuadratic(
    a: WPos,
    b: WPos,
    pitch: WAngle,
    mul: number,
    div: number,
  ): WPos {
    // Start with a linear lerp between the points
    const ret = WPos.lerpLong(a, b, mul, div)

    if (pitch.angle === 0) return ret

    // Add an additional quadratic variation to height
    // Uses BigInt to avoid integer overflow
    const deltaLen = WPos.subtract(b, a).length
    const offsetNum =
      BigInt(deltaLen) *
      BigInt(pitch.tan()) *
      BigInt(mul) *
      BigInt(div - mul)
    const offsetDen = BigInt(1024) * BigInt(div) * BigInt(div)
    const offset = Number(offsetNum / offsetDen)
    const clampedZ = (offset + ret.Z) | 0

    return new WPos(ret.X, ret.Y, clampedZ)
  }

  // -----------------------------------------------------------------------
  // Utility: Average
  // -----------------------------------------------------------------------

  /**
   * Compute the average position from an array of positions.
   * Returns WPos.Zero for an empty array.
   *
   * OpenRA 对照: IEnumerableExtensions.Average(this IEnumerable<WPos>)
   */
  static average(positions: readonly WPos[]): WPos {
    if (positions.length === 0) return WPos.Zero

    let x = 0
    let y = 0
    let z = 0
    for (const pos of positions) {
      x += pos.X
      y += pos.Y
      z += pos.Z
    }

    return new WPos(
      Math.trunc(x / positions.length),
      Math.trunc(y / positions.length),
      Math.trunc(z / positions.length),
    )
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another WPos.
   *
   * OpenRA 对照: WPos.Equals(WPos)
   */
  equals(other: WPos): boolean {
    return WPos.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: WPos.ToString()
   */
  toString(): string {
    return `${this.X},${this.Y},${this.Z}`
  }
}
