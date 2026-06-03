/**
 * WPos.test.ts — WPos migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { WPos } from './WPos'
import { WVec } from './WVec'
import { WAngle } from './WAngle'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('WPos construction', () => {
  it('stores X, Y, Z components', () => {
    const pos = new WPos(1000, 2000, 3000)
    expect(pos.X).toBe(1000)
    expect(pos.Y).toBe(2000)
    expect(pos.Z).toBe(3000)
  })

  it('truncates to int32', () => {
    const pos = new WPos(1.7, -2.3, 3.5)
    expect(pos.X).toBe(1)
    expect(pos.Y).toBe(-2)
    expect(pos.Z).toBe(3)
  })

  it('has Zero static constant', () => {
    expect(WPos.Zero.X).toBe(0)
    expect(WPos.Zero.Y).toBe(0)
    expect(WPos.Zero.Z).toBe(0)
  })

  it('toWVec converts to vector', () => {
    const pos = new WPos(10, 20, 30)
    const vec = pos.toWVec()
    expect(vec.X).toBe(10)
    expect(vec.Y).toBe(20)
    expect(vec.Z).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('WPos static operators', () => {
  it('add(WPos, WVec) displaces position', () => {
    const pos = new WPos(100, 200, 300)
    const vec = new WVec(10, 20, 30)
    const result = WPos.add(pos, vec)
    expect(result.X).toBe(110)
    expect(result.Y).toBe(220)
    expect(result.Z).toBe(330)
  })

  it('subtractVec(WPos, WVec) displaces in opposite direction', () => {
    const pos = new WPos(100, 200, 300)
    const vec = new WVec(10, 20, 30)
    const result = WPos.subtractVec(pos, vec)
    expect(result.X).toBe(90)
    expect(result.Y).toBe(180)
    expect(result.Z).toBe(270)
  })

  it('subtract(WPos, WPos) returns WVec displacement', () => {
    const a = new WPos(100, 200, 300)
    const b = new WPos(10, 20, 30)
    const result = WPos.subtract(a, b)
    expect(result.X).toBe(90)
    expect(result.Y).toBe(180)
    expect(result.Z).toBe(270)
    expect(result).toBeInstanceOf(WVec)
  })

  it('equals checks component equality', () => {
    const a = new WPos(1, 2, 3)
    const b = new WPos(1, 2, 3)
    expect(WPos.equals(a, b)).toBe(true)
    expect(WPos.equals(a, WPos.Zero)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe('WPos.lerp', () => {
  it('lerp with mul=0 returns a', () => {
    const a = new WPos(10, 20, 30)
    const b = new WPos(100, 200, 300)
    const result = WPos.lerp(a, b, 0, 1)
    expect(WPos.equals(result, a)).toBe(true)
  })

  it('lerp with mul=div returns b', () => {
    const a = new WPos(10, 20, 30)
    const b = new WPos(100, 200, 300)
    const result = WPos.lerp(a, b, 1, 1)
    expect(WPos.equals(result, b)).toBe(true)
  })

  it('lerp midpoint', () => {
    const a = new WPos(0, 0, 0)
    const b = new WPos(100, 200, 300)
    const result = WPos.lerp(a, b, 1, 2)
    expect(result.X).toBe(50)
    expect(result.Y).toBe(100)
    expect(result.Z).toBe(150)
  })
})

describe('WPos.lerpLong', () => {
  it('matches lerp for small values', () => {
    const a = new WPos(10, 20, 30)
    const b = new WPos(100, 200, 300)
    const r1 = WPos.lerp(a, b, 3, 7)
    const r2 = WPos.lerpLong(a, b, 3, 7)
    expect(WPos.equals(r1, r2)).toBe(true)
  })

  it('handles large values without overflow', () => {
    // Values near int32 max where addition might overflow
    const a = new WPos(2000000000, 0, 0)
    const b = new WPos(-2000000000, 0, 0)
    const result = WPos.lerpLong(a, b, 1, 2)
    // Should give a reasonable midpoint without overflow
    expect(result.X).toBe(0)
  })
})

describe('WPos.lerpQuadratic', () => {
  it('with pitch=0, same as linear lerp', () => {
    const a = new WPos(0, 0, 0)
    const b = new WPos(1024, 0, 0)
    const lin = WPos.lerp(a, b, 1, 2)
    const quad = WPos.lerpQuadratic(a, b, WAngle.Zero, 1, 2)
    expect(WPos.equals(lin, quad)).toBe(true)
  })

  it('with non-zero pitch, Z is affected (arc trajectory)', () => {
    const a = new WPos(0, 0, 0)
    const b = new WPos(1024, 0, 0)
    const quad = WPos.lerpQuadratic(a, b, WAngle.fromDegrees(10), 1, 2)
    // Z should be non-zero due to pitch (quadratic arc)
    expect(quad.Z).not.toBe(0)
    // X and Y should match linear lerp
    expect(quad.X).toBe(512)
    expect(quad.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Average
// ---------------------------------------------------------------------------

describe('WPos.average', () => {
  it('returns Zero for empty array', () => {
    expect(WPos.equals(WPos.average([]), WPos.Zero)).toBe(true)
  })

  it('returns position itself for single element', () => {
    const pos = new WPos(100, 200, 300)
    expect(WPos.equals(WPos.average([pos]), pos)).toBe(true)
  })

  it('computes arithmetic mean of positions', () => {
    const positions = [
      new WPos(10, 20, 30),
      new WPos(20, 30, 40),
      new WPos(30, 40, 50),
    ]
    const avg = WPos.average(positions)
    expect(avg.X).toBe(20)
    expect(avg.Y).toBe(30)
    expect(avg.Z).toBe(40)
  })

  it('truncates fractional average', () => {
    const positions = [
      new WPos(1, 1, 1),
      new WPos(2, 2, 2),
    ]
    // Average is (1+2)/2 = 1.5 → truncates to 1
    const avg = WPos.average(positions)
    expect(avg.X).toBe(1)
    expect(avg.Y).toBe(1)
    expect(avg.Z).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('WPos standard methods', () => {
  it('equals checks component equality', () => {
    expect(new WPos(1, 2, 3).equals(new WPos(1, 2, 3))).toBe(true)
    expect(new WPos(1, 2, 3).equals(new WPos(4, 5, 6))).toBe(false)
  })

  it('toString returns component values', () => {
    expect(new WPos(1, 2, 3).toString()).toBe('1,2,3')
  })

  it('is a class instance', () => {
    // NOTE: TypeScript readonly is compile-time only; runtime immutability
    // is enforced by the class API (no mutation methods).
    const pos = new WPos(1, 2, 3)
    expect(pos).toBeInstanceOf(WPos)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: Position - Vector - Position
// ---------------------------------------------------------------------------

describe('WPos round-trip', () => {
  it('add then subtract returns original position', () => {
    const pos = new WPos(100, 200, 300)
    const vec = new WVec(50, 60, 70)
    const displaced = WPos.add(pos, vec)
    const back = WPos.subtractVec(displaced, vec)
    expect(WPos.equals(back, pos)).toBe(true)
  })

  it('P2 - P1 + P1 = P2', () => {
    const p1 = new WPos(10, 20, 30)
    const p2 = new WPos(100, 200, 300)
    const delta = WPos.subtract(p2, p1)
    const reconstructed = WPos.add(p1, delta)
    expect(WPos.equals(reconstructed, p2)).toBe(true)
  })
})
