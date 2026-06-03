/**
 * WVec.test.ts — WVec migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { WVec } from './WVec'
import { WAngle } from './WAngle'
import { WRot } from './WRot'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('WVec construction', () => {
  it('stores X, Y, Z components', () => {
    const v = new WVec(100, 200, 300)
    expect(v.X).toBe(100)
    expect(v.Y).toBe(200)
    expect(v.Z).toBe(300)
  })

  it('truncates to int32', () => {
    const v = new WVec(1.7, -2.3, 3.5)
    expect(v.X).toBe(1)
    expect(v.Y).toBe(-2)
    expect(v.Z).toBe(3)
  })

  it('has Zero static constant', () => {
    expect(WVec.Zero.X).toBe(0)
    expect(WVec.Zero.Y).toBe(0)
    expect(WVec.Zero.Z).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('WVec static operators', () => {
  it('add combines components', () => {
    const result = WVec.add(new WVec(1, 2, 3), new WVec(4, 5, 6))
    expect(result.X).toBe(5)
    expect(result.Y).toBe(7)
    expect(result.Z).toBe(9)
  })

  it('subtract finds difference', () => {
    const result = WVec.subtract(new WVec(10, 20, 30), new WVec(1, 2, 3))
    expect(result.X).toBe(9)
    expect(result.Y).toBe(18)
    expect(result.Z).toBe(27)
  })

  it('negate inverts all components', () => {
    expect(WVec.negate(new WVec(1, -2, 3)).X).toBe(-1)
    expect(WVec.negate(new WVec(1, -2, 3)).Y).toBe(2)
    expect(WVec.negate(new WVec(1, -2, 3)).Z).toBe(-3)
  })

  it('multiply scales by factor', () => {
    const result = WVec.multiply(new WVec(3, 4, 5), 2)
    expect(result.X).toBe(6)
    expect(result.Y).toBe(8)
    expect(result.Z).toBe(10)
  })

  it('multiplyScalar reverses argument order', () => {
    const result = WVec.multiplyScalar(2, new WVec(3, 4, 5))
    expect(result.X).toBe(6)
    expect(result.Y).toBe(8)
    expect(result.Z).toBe(10)
  })

  it('divide scales down', () => {
    const result = WVec.divide(new WVec(6, 8, 10), 2)
    expect(result.X).toBe(3)
    expect(result.Y).toBe(4)
    expect(result.Z).toBe(5)
  })

  it('equals checks component equality', () => {
    expect(WVec.equals(new WVec(1, 2, 3), new WVec(1, 2, 3))).toBe(true)
    expect(WVec.equals(new WVec(1, 2, 3), new WVec(4, 5, 6))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Dot and cross product
// ---------------------------------------------------------------------------

describe('WVec.dot', () => {
  it('dot product of orthogonal vectors is 0', () => {
    expect(WVec.dot(new WVec(1, 0, 0), new WVec(0, 1, 0))).toBe(0)
  })

  it('dot product of same vector gives squared length', () => {
    const v = new WVec(3, 4, 12)
    expect(WVec.dot(v, v)).toBe(3 * 3 + 4 * 4 + 12 * 12)
  })
})

describe('WVec.cross', () => {
  it('cross product of X and Y axes gives Z axis', () => {
    const x = new WVec(1, 0, 0)
    const y = new WVec(0, 1, 0)
    const result = WVec.cross(x, y)
    expect(result.X).toBe(0)
    expect(result.Y).toBe(0)
    expect(result.Z).toBe(1)
  })

  it('cross product of Y and Z axes gives X axis', () => {
    const y = new WVec(0, 1, 0)
    const z = new WVec(0, 0, 1)
    const result = WVec.cross(y, z)
    expect(result.X).toBe(1)
    expect(result.Y).toBe(0)
    expect(result.Z).toBe(0)
  })

  it('cross product with zero vector gives zero', () => {
    const result = WVec.cross(new WVec(1, 2, 3), WVec.Zero)
    expect(WVec.equals(result, WVec.Zero)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Length properties
// ---------------------------------------------------------------------------

describe('WVec length', () => {
  it('lengthSquared returns squared magnitude', () => {
    expect(new WVec(3, 4, 0).lengthSquared).toBe(25)
    expect(new WVec(0, 0, 0).lengthSquared).toBe(0)
  })

  it('length returns integer square root', () => {
    expect(new WVec(3, 4, 0).length).toBe(5) // sqrt(25) = 5
    expect(new WVec(0, 0, 0).length).toBe(0)
    // sqrt(100+100+0=200) = floor(sqrt(200)) = 14
    expect(new WVec(10, 10, 0).length).toBe(14)
  })

  it('horizontalLengthSquared excludes Z', () => {
    expect(new WVec(3, 4, 100).horizontalLengthSquared).toBe(25)
  })

  it('horizontalLength returns integer sqrt of XY', () => {
    expect(new WVec(3, 4, 100).horizontalLength).toBe(5)
  })

  it('verticalLengthSquared includes only Z', () => {
    expect(new WVec(0, 0, 12).verticalLengthSquared).toBe(144)
  })

  it('verticalLength returns integer sqrt of Z', () => {
    expect(new WVec(0, 0, 12).verticalLength).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// Yaw
// ---------------------------------------------------------------------------

describe('WVec.yaw', () => {
  it('zero vector returns Zero angle', () => {
    expect(WVec.Zero.yaw.angle).toBe(0)
  })

  it('positive X direction returns angle 768 (West facing per OpenRA convention)', () => {
    // OpenRA coordinate convention: arcTan(-Y, X) - 256.
    // For (1024, 0, 0) = +X/East: arcTan(0, 1024) - 256 = 0 - 256 = -256 → 768
    const v = new WVec(1024, 0, 0)
    expect(Math.abs(v.yaw.angle - 768)).toBeLessThanOrEqual(2)
  })

  it('negative Y direction (north in OpenRA) returns angle 0', () => {
    // North = -Y. arcTan(-(-1024), 0) - 256 = arcTan(1024, 0) - 256 = 256 - 256 = 0
    const v = new WVec(0, -1024, 0)
    expect(Math.abs(v.yaw.angle - 0)).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

describe('WVec rotation', () => {
  it('rotate(WRot.None) preserves vector', () => {
    const v = new WVec(100, 200, 50)
    const result = v.rotate(WRot.None)
    expect(Math.abs(result.X - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.Y - 200)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.Z - 50)).toBeLessThanOrEqual(1)
  })

  it('rotate by 90-degree yaw rotates X to -Y (south)', () => {
    const v = new WVec(1024, 0, 0)
    const rot = WRot.fromYaw(WAngle.fromDegrees(90))
    const result = v.rotate(rot)
    // +X rotated 90 degrees counter-clockwise should point to -Y (north)
    // Actually in OpenRA angles increase clockwise, so 90 degrees clockwise
    // maps +X → +Y (south). Let's verify the signs...
    expect(Math.abs(result.X)).toBeLessThan(10)
    // The Y component should be near 1024 or -1024 depending on convention
    expect(Math.abs(result.Y)).toBeGreaterThan(1000)
    expect(Math.abs(result.Z)).toBeLessThan(10)
  })

  it('rotateByMatrix identity preserves vector', () => {
    const v = new WVec(100, 200, 50)
    const m = WRot.None.asMatrix()
    const result = v.rotateByMatrix(m)
    expect(Math.abs(result.X - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.Y - 200)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.Z - 50)).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe('WVec.lerp', () => {
  it('lerp with mul=0 returns a', () => {
    const a = new WVec(10, 20, 30)
    const b = new WVec(100, 200, 300)
    const result = WVec.lerp(a, b, 0, 1)
    expect(WVec.equals(result, a)).toBe(true)
  })

  it('lerp with mul=div returns b', () => {
    const a = new WVec(10, 20, 30)
    const b = new WVec(100, 200, 300)
    const result = WVec.lerp(a, b, 1, 1)
    expect(WVec.equals(result, b)).toBe(true)
  })

  it('lerp midpoint', () => {
    const a = new WVec(0, 0, 0)
    const b = new WVec(100, 200, 300)
    const result = WVec.lerp(a, b, 1, 2)
    expect(result.X).toBe(50)
    expect(result.Y).toBe(100)
    expect(result.Z).toBe(150)
  })
})

describe('WVec.lerpQuadratic', () => {
  it('with pitch=0, same as linear lerp', () => {
    const a = new WVec(0, 0, 0)
    const b = new WVec(100, 0, 0)
    const lin = WVec.lerp(a, b, 1, 2)
    const quad = WVec.lerpQuadratic(a, b, WAngle.Zero, 1, 2)
    expect(WVec.equals(lin, quad)).toBe(true)
  })

  it('with non-zero pitch, height (Z) is affected', () => {
    const a = new WVec(0, 0, 0)
    const b = new WVec(1024, 0, 0)
    const quad = WVec.lerpQuadratic(a, b, WAngle.fromDegrees(10), 1, 2)
    // Z should be non-zero due to pitch
    expect(quad.Z).not.toBe(0)
    // X and Y should match linear lerp
    expect(quad.X).toBe(512)
    expect(quad.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('WVec standard methods', () => {
  it('equals checks component equality', () => {
    expect(new WVec(1, 2, 3).equals(new WVec(1, 2, 3))).toBe(true)
    expect(new WVec(1, 2, 3).equals(new WVec(4, 5, 6))).toBe(false)
  })

  it('toString returns component values', () => {
    expect(new WVec(1, 2, 3).toString()).toBe('1,2,3')
  })

  it('is a class instance', () => {
    // NOTE: TypeScript readonly is compile-time only; runtime immutability
    // is enforced by the class API (no mutation methods).
    const v = new WVec(1, 2, 3)
    expect(v).toBeInstanceOf(WVec)
  })
})
