/**
 * WRot.ts — 3D world rotation (Euler + Quaternion hybrid)
 * OpenRA 对照: OpenRA.Game/WRot.cs
 *
 * 核心范式转换:
 * - C# struct (value type, stack) → immutable TypeScript class
 * - Internal quaternion (x,y,z,w) normalized to 1024=1.0 for integer math
 * - Euler angles (Roll, Pitch, Yaw) for public API
 * - C# operator overloading → static methods
 * - asBabylonQuaternion() converts to BABYLON.Quaternion at render boundary
 * - Rotation math stays in OpenRA's integer space for determinism
 */

import { Quaternion } from '@babylonjs/core'
import type { WVec } from './WVec'
import { WAngle } from './WAngle'
import { Int32Matrix4x4 } from './Int32Matrix4x4'
import { isqrt } from './Exts'

// ---------------------------------------------------------------------------
// Internal — Euler → Quaternion computation
// ---------------------------------------------------------------------------

interface QuaternionComponents {
  x: number
  y: number
  z: number
  w: number
}

/**
 * Compute quaternion components from Euler angles.
 *
 * Angles increase clockwise (OpenRA convention).
 * Result normalized to 1024 = 1.0.
 */
function eulerToQuaternion(
  roll: WAngle,
  pitch: WAngle,
  yaw: WAngle,
): QuaternionComponents {
  const qr = new WAngle(-roll.angle / 2)
  const qp = new WAngle(-pitch.angle / 2)
  const qy = new WAngle(-yaw.angle / 2)
  const cr = qr.cos()
  const sr = qr.sin()
  const cp = qp.cos()
  const sp = qp.sin()
  const cy = qy.cos()
  const sy = qy.sin()

  // Normalized to 1024 == 1.0 (divide by 1024*1024 = 1048576)
  return {
    x: Math.trunc((sr * cp * cy - cr * sp * sy) / 1048576),
    y: Math.trunc((cr * sp * cy + sr * cp * sy) / 1048576),
    z: Math.trunc((cr * cp * sy - sr * sp * cy) / 1048576),
    w: Math.trunc((cr * cp * cy + sr * sp * sy) / 1048576),
  }
}

// ---------------------------------------------------------------------------
// WRot
// ---------------------------------------------------------------------------

/**
 * 3D world rotation stored internally as a quaternion normalized to 1024=1.0.
 *
 * OpenRA 对照: WRot (readonly struct)
 *
 * Public API uses Euler angles (Roll, Pitch, Yaw) for intuitiveness.
 * Internal math uses quaternions for numerical stability and SLerp support.
 * Convert to BABYLON.Quaternion at the render boundary only.
 */
export class WRot {
  /** Roll angle (rotation around forward axis).
   *
   * OpenRA 对照: WRot.Roll
   */
  readonly roll: WAngle

  /** Pitch angle (rotation around right axis).
   *
   * OpenRA 对照: WRot.Pitch
   */
  readonly pitch: WAngle

  /** Yaw angle (rotation around up axis).
   *
   * OpenRA 对照: WRot.Yaw
   */
  readonly yaw: WAngle

  /** Quaternion x component, normalized to 1024=1.0. */
  readonly x: number

  /** Quaternion y component, normalized to 1024=1.0. */
  readonly y: number

  /** Quaternion z component, normalized to 1024=1.0. */
  readonly z: number

  /** Quaternion w component, normalized to 1024=1.0. */
  readonly w: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Identity rotation (no rotation).
   *
   * OpenRA 对照: WRot.None
   */
  static readonly None = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a rotation from Euler angles
   * (public, Euler→Quaternion conversion).
   *
   * Angles increase clockwise (OpenRA convention).
   *
   * OpenRA 对照: WRot(WAngle roll, WAngle pitch, WAngle yaw)
   */
  constructor(roll: WAngle, pitch: WAngle, yaw: WAngle)
  /**
   * Construct a rotation from Euler angles + precomputed quaternion
   * (internal, used by _fromQuaternion).
   *
   * @internal
   */
  constructor(
    roll: WAngle,
    pitch: WAngle,
    yaw: WAngle,
    _qx: number,
    _qy: number,
    _qz: number,
    _qw: number,
  )
  constructor(
    roll: WAngle,
    pitch: WAngle,
    yaw: WAngle,
    _qx?: number,
    _qy?: number,
    _qz?: number,
    _qw?: number,
  ) {
    this.roll = roll
    this.pitch = pitch
    this.yaw = yaw

    if (_qx !== undefined) {
      // Quaternion components provided (internal path)
      this.x = _qx
      this.y = _qy!
      this.z = _qz!
      this.w = _qw!
    } else {
      // Compute quaternion from Euler angles (public path)
      const q = eulerToQuaternion(roll, pitch, yaw)
      this.x = q.x
      this.y = q.y
      this.z = q.z
      this.w = q.w
    }
  }

  // -----------------------------------------------------------------------
  // Construction (from axis + angle) — static factory
  // -----------------------------------------------------------------------

  /**
   * Construct a rotation from an axis and angle.
   * The axis is expected to be normalized to length 1024.
   *
   * OpenRA 对照: WRot(WVec axis, WAngle angle)
   */
  static fromAxisAngle(axis: WVec, angle: WAngle): WRot {
    // Angles increase clockwise
    const halfNeg = new WAngle(-angle.angle / 2)
    const sinHalf = halfNeg.sin()
    const x = Math.trunc((axis.X * sinHalf) / 1024)
    const y = Math.trunc((axis.Y * sinHalf) / 1024)
    const z = Math.trunc((axis.Z * sinHalf) / 1024)
    const w = halfNeg.cos()

    return WRot._fromQuaternion(x, y, z, w)
  }

  // -----------------------------------------------------------------------
  // Internal — construct from quaternion components
  // -----------------------------------------------------------------------

  /**
   * Construct a WRot from quaternion components.
   * Computes Euler angles via QuaternionToEuler.
   *
   * OpenRA 对照: WRot(int x, int y, int z, int w) — private ctor
   *
   * @internal
   */
  static _fromQuaternion(x: number, y: number, z: number, w: number): WRot {
    const { roll, pitch, yaw } = WRot.quaternionToEuler(x, y, z, w)
    return new WRot(roll, pitch, yaw, x, y, z, w)
  }

  // -----------------------------------------------------------------------
  // Factory methods
  // -----------------------------------------------------------------------

  /**
   * Create a rotation from a facing value (yaw only, no roll/pitch).
   *
   * OpenRA 对照: WRot.FromFacing(int facing)
   */
  static fromFacing(facing: number): WRot {
    return new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(facing))
  }

  /**
   * Create a rotation from a yaw angle (no roll/pitch).
   *
   * OpenRA 对照: WRot.FromYaw(WAngle yaw)
   */
  static fromYaw(yaw: WAngle): WRot {
    return new WRot(WAngle.Zero, WAngle.Zero, yaw)
  }

  // -----------------------------------------------------------------------
  // Quaternion → Euler conversion
  // -----------------------------------------------------------------------

  /**
   * Convert quaternion components (normalized to 1024=1.0) to Euler angles.
   *
   * OpenRA 对照: WRot.QuaternionToEuler(int x, int y, int z, int w)
   */
  static quaternionToEuler(
    x: number,
    y: number,
    z: number,
    w: number,
  ): { roll: WAngle; pitch: WAngle; yaw: WAngle } {
    // Theoretically 1024 squared, but may differ slightly due to rounding
    const lsq = x * x + y * y + z * z + w * w

    const srcp = 2 * (w * x + y * z)
    const crcp = lsq - 2 * (x * x + y * y)
    const sp = Math.trunc((w * y - z * x) / 512)
    const sycp = 2 * (w * z + x * y)
    const cycp = lsq - 2 * (y * y + z * z)

    const roll = WAngle.negate(WAngle.arcTan(srcp, crcp))
    const pitch = WAngle.negate(
      Math.abs(sp) >= 1024
        ? new WAngle(Math.sign(sp) * 256)
        : WAngle.arcSin(sp),
    )
    const yaw = WAngle.negate(WAngle.arcTan(sycp, cycp))

    return { roll, pitch, yaw }
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Add two rotations (adds Euler angles component-wise).
   *
   * OpenRA 对照: WRot.operator+(WRot, WRot)
   */
  static add(a: WRot, b: WRot): WRot {
    return new WRot(
      WAngle.add(a.roll, b.roll),
      WAngle.add(a.pitch, b.pitch),
      WAngle.add(a.yaw, b.yaw),
    )
  }

  /**
   * Subtract b from a (subtracts Euler angles component-wise).
   *
   * OpenRA 对照: WRot.operator-(WRot, WRot)
   */
  static subtract(a: WRot, b: WRot): WRot {
    return new WRot(
      WAngle.subtract(a.roll, b.roll),
      WAngle.subtract(a.pitch, b.pitch),
      WAngle.subtract(a.yaw, b.yaw),
    )
  }

  /**
   * Negate a rotation.
   *
   * OpenRA 对照: WRot.operator-(WRot)
   *
   * NOTE: Negates the quaternion x/y/z while preserving w (scalar component).
   * Euler angles are recomputed via QuaternionToEuler, which may introduce
   * a 1-2 unit difference vs the direct Euler negation used in C#. This is
   * within acceptable precision for integer-math rotations.
   */
  static negate(a: WRot): WRot {
    return WRot._fromQuaternion(-a.x, -a.y, -a.z, a.w)
  }

  /**
   * Test two WRot instances for equality (compares Euler angles).
   *
   * OpenRA 对照: WRot.operator==
   */
  static equals(a: WRot, b: WRot): boolean {
    return (
      WAngle.equals(a.roll, b.roll) &&
      WAngle.equals(a.pitch, b.pitch) &&
      WAngle.equals(a.yaw, b.yaw)
    )
  }

  // -----------------------------------------------------------------------
  // Quaternion composition
  // -----------------------------------------------------------------------

  /**
   * Compose this rotation with another (quaternion multiplication).
   *
   * OpenRA 对照: WRot.Rotate(WRot)
   */
  rotate(rot: WRot): WRot {
    // Identity short-circuit
    if (WRot.equals(this, WRot.None)) return rot
    if (WRot.equals(rot, WRot.None)) return this

    const rx = Math.trunc(
      (rot.w * this.x + rot.x * this.w + rot.y * this.z - rot.z * this.y) /
        1024,
    )
    const ry = Math.trunc(
      (rot.w * this.y - rot.x * this.z + rot.y * this.w + rot.z * this.x) /
        1024,
    )
    const rz = Math.trunc(
      (rot.w * this.z + rot.x * this.y - rot.y * this.x + rot.z * this.w) /
        1024,
    )
    const rw = Math.trunc(
      (rot.w * this.w - rot.x * this.x - rot.y * this.y - rot.z * this.z) /
        1024,
    )

    return WRot._fromQuaternion(rx, ry, rz, rw)
  }

  // -----------------------------------------------------------------------
  // Component replacement (create new WRot with one Euler angle changed)
  // -----------------------------------------------------------------------

  /**
   * Create a new WRot with the given roll, keeping pitch and yaw.
   *
   * OpenRA 对照: WRot.WithRoll(WAngle)
   */
  withRoll(roll: WAngle): WRot {
    return new WRot(roll, this.pitch, this.yaw)
  }

  /**
   * Create a new WRot with the given pitch, keeping roll and yaw.
   *
   * OpenRA 对照: WRot.WithPitch(WAngle)
   */
  withPitch(pitch: WAngle): WRot {
    return new WRot(this.roll, pitch, this.yaw)
  }

  /**
   * Create a new WRot with the given yaw, keeping roll and pitch.
   *
   * OpenRA 对照: WRot.WithYaw(WAngle)
   */
  withYaw(yaw: WAngle): WRot {
    return new WRot(this.roll, this.pitch, yaw)
  }

  // -----------------------------------------------------------------------
  // Matrix conversion
  // -----------------------------------------------------------------------

  /**
   * Convert this rotation to a 4x4 integer rotation matrix.
   *
   * OpenRA 对照: WRot.AsMatrix(out Int32Matrix4x4)
   */
  asMatrix(): Int32Matrix4x4 {
    // Theoretically 1024 squared, but may differ slightly due to rounding
    const lsq =
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w

    // Quaternion components use 10 bits, so there's no risk of overflow
    return new Int32Matrix4x4(
      lsq - 2 * (this.y * this.y + this.z * this.z),
      2 * (this.x * this.y + this.z * this.w),
      2 * (this.x * this.z - this.y * this.w),
      0,
      /* row 2 */
      2 * (this.x * this.y - this.z * this.w),
      lsq - 2 * (this.x * this.x + this.z * this.z),
      2 * (this.y * this.z + this.x * this.w),
      0,
      /* row 3 */
      2 * (this.x * this.z + this.y * this.w),
      2 * (this.y * this.z - this.x * this.w),
      lsq - 2 * (this.x * this.x + this.y * this.y),
      0,
      /* row 4 */
      0,
      0,
      0,
      lsq,
    )
  }

  // -----------------------------------------------------------------------
  // Babylon.js conversion (render boundary)
  // -----------------------------------------------------------------------

  /**
   * Convert this rotation to a BABYLON.Quaternion for rendering.
   * Converts from OpenRA's 1024=1.0 integer normalization to Babylon's
   * float (1.0=1.0) representation.
   *
   * MUST NOT be used in game logic (floating-point, non-deterministic).
   *
   * NOTE: This is the ONLY place where Babylon.js types are used in WRot.
   */
  asBabylonQuaternion(): Quaternion {
    return new Quaternion(
      this.x / 1024,
      this.y / 1024,
      this.z / 1024,
      this.w / 1024,
    )
  }

  // -----------------------------------------------------------------------
  // Spherical linear interpolation
  // -----------------------------------------------------------------------

  /**
   * Spherical linear interpolation between two rotations.
   *
   * OpenRA 对照: WRot.SLerp(WRot a, WRot b, int mul, int div)
   */
  static slerp(a: WRot, b: WRot, mul: number, div: number): WRot {
    // This implements the standard spherical linear interpolation
    // between two quaternions, accounting for OpenRA's integer math
    // conventions and WRot always using (nearly) normalized quaternions
    const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
    const flip = dot >= 0 ? 1 : -1

    // a and b describe the same rotation
    if (flip * dot >= 1024 * 1024) return a

    const theta = WAngle.arcCos(Math.trunc(dot / 1024))
    const s1 = new WAngle(Math.trunc(((div - mul) * theta.angle) / div)).sin()
    const s2 = new WAngle(Math.trunc((mul * theta.angle) / div)).sin()
    const s3 = theta.sin()

    const x = Math.trunc((a.x * s1 + flip * b.x * s2) / s3)
    const y = Math.trunc((a.y * s1 + flip * b.y * s2) / s3)
    const z = Math.trunc((a.z * s1 + flip * b.z * s2) / s3)
    const w = Math.trunc((a.w * s1 + flip * b.w * s2) / s3)

    // Normalize to 1024 == 1.0
    const l = isqrt(x * x + y * y + z * z + w * w)
    return WRot._fromQuaternion(
      Math.trunc((1024 * x) / l),
      Math.trunc((1024 * y) / l),
      Math.trunc((1024 * z) / l),
      Math.trunc((1024 * w) / l),
    )
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another WRot.
   *
   * OpenRA 对照: WRot.Equals(WRot)
   */
  equals(other: WRot): boolean {
    return WRot.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: WRot.ToString()
   */
  toString(): string {
    return `${this.roll},${this.pitch},${this.yaw}`
  }
}
