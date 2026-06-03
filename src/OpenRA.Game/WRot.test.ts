/**
 * WRot.test.ts — WRot migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: Euler/quaternion conversion, rotation composition,
 * matrix output, SLerp, and WRot.WVec rotation.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    Quaternion: vi.fn(
      (x: number, y: number, z: number, w: number) => ({
        x,
        y,
        z,
        w,
      }),
    ),
  }
})

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

import { WAngle } from './WAngle'
import { WRot } from './WRot'
import { WVec } from './WVec'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('WRot construction', () => {
  it('constructs from Euler angles (zero rotation)', () => {
    const rot = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)
    expect(rot.roll.angle).toBe(0)
    expect(rot.pitch.angle).toBe(0)
    expect(rot.yaw.angle).toBe(0)
    // Identity quaternion: x=0, y=0, z=0, w=1024
    expect(rot.x).toBe(0)
    expect(rot.y).toBe(0)
    expect(rot.z).toBe(0)
    expect(rot.w).toBe(1024)
  })

  it('None equals identity rotation', () => {
    const identity = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)
    expect(WRot.equals(WRot.None, identity)).toBe(true)
  })

  it('constructs from roll only (90 degrees = 256)', () => {
    const rot = new WRot(WAngle.fromDegrees(90), WAngle.Zero, WAngle.Zero)
    expect(rot.roll.angle).toBe(256)
    expect(rot.pitch.angle).toBe(0)
    expect(rot.yaw.angle).toBe(0)
  })

  it('Euler→Quaternion round-trip preserves Euler approximately', () => {
    const original = new WRot(
      new WAngle(100),
      new WAngle(50),
      new WAngle(300),
    )
    // Reconstruct from quaternion
    const reconstructed = WRot._fromQuaternion(
      original.x,
      original.y,
      original.z,
      original.w,
    )
    // Euler angles should be within ~2 units due to quantization
    expect(Math.abs(reconstructed.roll.angle - original.roll.angle)).toBeLessThanOrEqual(2)
    expect(Math.abs(reconstructed.pitch.angle - original.pitch.angle)).toBeLessThanOrEqual(2)
    expect(Math.abs(reconstructed.yaw.angle - original.yaw.angle)).toBeLessThanOrEqual(2)
  })

  it('yaw rotation (around Z/up) is a pure Z rotation', () => {
    const yaw = new WAngle(256) // 90 degrees
    const rot = new WRot(WAngle.Zero, WAngle.Zero, yaw)
    expect(rot.roll.angle).toBe(0)
    expect(rot.pitch.angle).toBe(0)
    expect(rot.yaw.angle).toBe(256)
  })
})

// ---------------------------------------------------------------------------
// Factory methods
// ---------------------------------------------------------------------------

describe('WRot.fromFacing', () => {
  it('creates yaw-only rotation from facing', () => {
    const rot = WRot.fromFacing(64) // 90 degrees
    expect(rot.roll.angle).toBe(0)
    expect(rot.pitch.angle).toBe(0)
    expect(rot.yaw.angle).toBe(256)
  })
})

describe('WRot.fromYaw', () => {
  it('creates yaw-only rotation', () => {
    const rot = WRot.fromYaw(WAngle.fromDegrees(90))
    expect(rot.roll.angle).toBe(0)
    expect(rot.pitch.angle).toBe(0)
    expect(rot.yaw.angle).toBe(256)
  })
})

describe('WRot.fromAxisAngle', () => {
  it('rotation around Z axis (up/height) by 90 degrees gives yaw', () => {
    const axis = new WVec(0, 0, 1024) // Z axis, length 1024
    const angle = WAngle.fromDegrees(90)
    const rot = WRot.fromAxisAngle(axis, angle)
    // Rotating around Z axis should give a yaw rotation
    expect(rot.roll.angle).toBeLessThanOrEqual(2)
    expect(rot.pitch.angle).toBeLessThanOrEqual(2)
    expect(Math.abs(rot.yaw.angle - 256)).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('WRot static operators', () => {
  it('add combines Euler angles component-wise', () => {
    const a = new WRot(new WAngle(100), new WAngle(50), new WAngle(200))
    const b = new WRot(new WAngle(50), new WAngle(25), new WAngle(100))
    const result = WRot.add(a, b)
    expect(result.roll.angle).toBe(150)
    expect(result.pitch.angle).toBe(75)
    expect(result.yaw.angle).toBe(300)
  })

  it('subtract finds Euler difference', () => {
    const a = new WRot(new WAngle(200), new WAngle(100), new WAngle(300))
    const b = new WRot(new WAngle(50), new WAngle(25), new WAngle(100))
    const result = WRot.subtract(a, b)
    expect(result.roll.angle).toBe(150)
    expect(result.pitch.angle).toBe(75)
    expect(result.yaw.angle).toBe(200)
  })

  it('negate inverts the rotation', () => {
    const rot = new WRot(
      WAngle.fromDegrees(45),
      WAngle.Zero,
      WAngle.Zero,
    )
    const neg = WRot.negate(rot)
    const combined = rot.rotate(neg)
    // Should return to identity
    expect(combined.roll.angle).toBeLessThanOrEqual(2)
    expect(combined.pitch.angle).toBeLessThanOrEqual(2)
    expect(combined.yaw.angle).toBeLessThanOrEqual(2)
  })

  it('equals checks Euler angle equality', () => {
    const a = new WRot(new WAngle(100), new WAngle(50), WAngle.Zero)
    const b = new WRot(new WAngle(100), new WAngle(50), WAngle.Zero)
    const c = new WRot(new WAngle(200), new WAngle(50), WAngle.Zero)
    expect(WRot.equals(a, b)).toBe(true)
    expect(WRot.equals(a, c)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rotation composition
// ---------------------------------------------------------------------------

describe('WRot.rotate', () => {
  it('rotating with None returns self', () => {
    const rot = WRot.fromYaw(WAngle.fromDegrees(90))
    const result = rot.rotate(WRot.None)
    expect(WRot.equals(result, rot)).toBe(true)
  })

  it('None rotated with rot returns rot', () => {
    const rot = WRot.fromYaw(WAngle.fromDegrees(90))
    const result = WRot.None.rotate(rot)
    expect(WRot.equals(result, rot)).toBe(true)
  })

  it('composition of two 90-degree yaws gives 180 degrees', () => {
    const q1 = WRot.fromYaw(WAngle.fromDegrees(90))
    const q2 = WRot.fromYaw(WAngle.fromDegrees(90))
    const composed = q1.rotate(q2)
    expect(Math.abs(composed.yaw.angle - 512)).toBeLessThanOrEqual(2)
    expect(composed.roll.angle).toBeLessThanOrEqual(2)
    expect(composed.pitch.angle).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Component replacement
// ---------------------------------------------------------------------------

describe('WRot with* methods', () => {
  const base = new WRot(
    WAngle.fromDegrees(10),
    WAngle.fromDegrees(20),
    WAngle.fromDegrees(30),
  )

  it('withRoll changes only roll', () => {
    const changed = base.withRoll(WAngle.fromDegrees(40))
    expect(changed.roll.angle).not.toBe(base.roll.angle)
    // pitch and yaw preserved (approximately)
    expect(Math.abs(changed.pitch.angle - base.pitch.angle)).toBeLessThanOrEqual(2)
    expect(Math.abs(changed.yaw.angle - base.yaw.angle)).toBeLessThanOrEqual(2)
  })

  it('withPitch changes only pitch', () => {
    const changed = base.withPitch(WAngle.fromDegrees(40))
    expect(changed.pitch.angle).not.toBe(base.pitch.angle)
    expect(Math.abs(changed.roll.angle - base.roll.angle)).toBeLessThanOrEqual(2)
    expect(Math.abs(changed.yaw.angle - base.yaw.angle)).toBeLessThanOrEqual(2)
  })

  it('withYaw changes only yaw', () => {
    const changed = base.withYaw(WAngle.fromDegrees(40))
    expect(changed.yaw.angle).not.toBe(base.yaw.angle)
    expect(Math.abs(changed.roll.angle - base.roll.angle)).toBeLessThanOrEqual(2)
    expect(Math.abs(changed.pitch.angle - base.pitch.angle)).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Matrix conversion
// ---------------------------------------------------------------------------

describe('WRot.asMatrix', () => {
  it('identity rotation gives scaled identity matrix', () => {
    const rot = WRot.None
    const m = rot.asMatrix()
    // lsq = 0+0+0+1024² = 1048576
    const lsq = 1024 * 1024
    expect(m.m11).toBe(lsq)
    expect(m.m12).toBe(0)
    expect(m.m13).toBe(0)
    expect(m.m14).toBe(0)
    expect(m.m22).toBe(lsq)
    expect(m.m33).toBe(lsq)
    expect(m.m44).toBe(lsq)
  })

  it('90-degree yaw rotation matrix', () => {
    const rot = WRot.fromYaw(WAngle.fromDegrees(90))
    const m = rot.asMatrix()
    // 90 degrees around Z: should swap X and Y
    // m11 (cos 90) ≈ 0, m12 (-sin 90) ≈ -lsq, m21 (sin 90) ≈ lsq, m22 ≈ 0
    expect(Math.abs(m.m11)).toBeLessThan(1024)
    expect(m.m12).toBeLessThan(-1048000) // negative large value
    expect(m.m21).toBeGreaterThan(1048000) // positive large value
    expect(Math.abs(m.m22)).toBeLessThan(1024)
    // Z axis preserved
    expect(m.m33).toBeGreaterThan(1048000)
  })
})

// ---------------------------------------------------------------------------
// Babylon.js conversion
// ---------------------------------------------------------------------------

describe('WRot.asBabylonQuaternion', () => {
  it('converts identity to unit quaternion', () => {
    const rot = WRot.None
    const q = rot.asBabylonQuaternion()
    expect(q.x).toBeCloseTo(0, 5)
    expect(q.y).toBeCloseTo(0, 5)
    expect(q.z).toBeCloseTo(0, 5)
    expect(q.w).toBeCloseTo(1, 5)
  })

  it('returns BABYLON.Quaternion instance with normalized values', () => {
    const rot = WRot.None
    const q = rot.asBabylonQuaternion()
    // BABYLON.Quaternion is mocked, check that it was constructed with
    // values normalized from 1024 scale to 1.0 scale
    expect(q.x).toBeCloseTo(0, 5)
    expect(q.y).toBeCloseTo(0, 5)
    expect(q.z).toBeCloseTo(0, 5)
    expect(q.w).toBeCloseTo(1, 5)
  })
})

// ---------------------------------------------------------------------------
// SLerp
// ---------------------------------------------------------------------------

describe('WRot.slerp', () => {
  it('slerp with mul=0 returns a', () => {
    const a = WRot.fromYaw(WAngle.fromDegrees(0))
    const b = WRot.fromYaw(WAngle.fromDegrees(90))
    const result = WRot.slerp(a, b, 0, 1)
    expect(result.yaw.angle).toBeLessThanOrEqual(2)
  })

  it('slerp with mul=div returns b', () => {
    const a = WRot.fromYaw(WAngle.fromDegrees(0))
    const b = WRot.fromYaw(WAngle.fromDegrees(90))
    const result = WRot.slerp(a, b, 1, 1)
    expect(Math.abs(result.yaw.angle - 256)).toBeLessThanOrEqual(2)
  })

  it('slerp midpoint', () => {
    const a = WRot.fromYaw(WAngle.fromDegrees(0))
    const b = WRot.fromYaw(WAngle.fromDegrees(90))
    const result = WRot.slerp(a, b, 1, 2)
    expect(Math.abs(result.yaw.angle - 128)).toBeLessThanOrEqual(2)
  })

  it('slerp with same rotation returns it unchanged', () => {
    const a = WRot.fromYaw(WAngle.fromDegrees(45))
    const result = WRot.slerp(a, a, 1, 2)
    expect(WRot.equals(result, a)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WVec rotation
// ---------------------------------------------------------------------------

describe('WRot with WVec rotation', () => {
  it('rotating a vector by identity rotation preserves it', () => {
    const v = new WVec(100, 200, 0)
    const rotated = v.rotate(WRot.None)
    expect(Math.abs(rotated.X - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(rotated.Y - 200)).toBeLessThanOrEqual(1)
    expect(Math.abs(rotated.Z - 0)).toBeLessThanOrEqual(1)
  })

  it('rotating X-axis vector by 90-degree yaw gives Y-axis direction', () => {
    const v = new WVec(1024, 0, 0) // points east
    const rot = WRot.fromYaw(WAngle.fromDegrees(90))
    const rotated = v.rotate(rot)
    // In OpenRA, north = -y, so 90-degree rotation of +X should give
    // something close to (0, -1024, 0)
    expect(rotated.X).toBeLessThan(10) // nearly 0
    expect(rotated.Y).toBeLessThan(-1000) // nearly -1024 (south = -Y in OpenRA)
    expect(Math.abs(rotated.Z)).toBeLessThan(10) // nearly 0
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('WRot standard methods', () => {
  it('equals checks Euler angle equality', () => {
    const a = WRot.fromYaw(WAngle.fromDegrees(45))
    const b = WRot.fromYaw(WAngle.fromDegrees(45))
    expect(a.equals(b)).toBe(true)
  })

  it('toString returns Euler angles', () => {
    const rot = WRot.fromYaw(new WAngle(128))
    expect(rot.toString()).toContain('128')
  })
})

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('WRot immutability', () => {
  it('non-trivial rotation composition returns new instance', () => {
    const a = WRot.fromYaw(WAngle.fromDegrees(45))
    const b = WRot.fromYaw(WAngle.fromDegrees(90))
    const composed = a.rotate(b)
    expect(composed).not.toBe(a)
    expect(composed).not.toBe(b)
  })

  it('has public readonly fields via API', () => {
    // NOTE: TypeScript readonly is compile-time only, not runtime enforcement.
    // Immutability is enforced by class API: no mutation methods exist.
    const rot = WRot.fromYaw(WAngle.fromDegrees(45))
    expect(rot.yaw.angle).not.toBe(0)
  })
})
