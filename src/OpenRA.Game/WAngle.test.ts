/**
 * WAngle.test.ts — WAngle migration unit tests
 *
 * Tests focus on: angle normalization, trig table accuracy,
 * arc functions, interpolation, and cross-browser determinism.
 */

import { describe, it, expect } from 'vitest'
import { WAngle } from './WAngle'

// ---------------------------------------------------------------------------
// Construction & normalization
// ---------------------------------------------------------------------------

describe('WAngle construction', () => {
  it('normalizes positive angle within 0-1024', () => {
    expect(new WAngle(0).angle).toBe(0)
    expect(new WAngle(256).angle).toBe(256)
    expect(new WAngle(1023).angle).toBe(1023)
  })

  it('wraps angles >= 1024', () => {
    expect(new WAngle(1024).angle).toBe(0)
    expect(new WAngle(1025).angle).toBe(1)
    expect(new WAngle(2048).angle).toBe(0)
  })

  it('normalizes negative angles to positive range', () => {
    expect(new WAngle(-1).angle).toBe(1023)
    expect(new WAngle(-256).angle).toBe(768)
    expect(new WAngle(-1024).angle).toBe(0)
    expect(new WAngle(-1025).angle).toBe(1023)
  })

  it('has Zero static constant', () => {
    expect(WAngle.Zero.angle).toBe(0)
    expect(WAngle.Zero).toBeInstanceOf(WAngle)
  })
})

// ---------------------------------------------------------------------------
// Factory methods
// ---------------------------------------------------------------------------

describe('WAngle.fromFacing', () => {
  it('converts facing to angle (4 * facing)', () => {
    expect(WAngle.fromFacing(0).angle).toBe(0)
    expect(WAngle.fromFacing(64).angle).toBe(256) // 90 degrees
    expect(WAngle.fromFacing(128).angle).toBe(512) // 180 degrees
    expect(WAngle.fromFacing(192).angle).toBe(768) // 270 degrees
    expect(WAngle.fromFacing(255).angle).toBe(1020)
  })

  it('wraps facing >= 256', () => {
    expect(WAngle.fromFacing(256).angle).toBe(0) // 256*4 = 1024 wraps to 0
  })
})

describe('WAngle.fromDegrees', () => {
  it('converts degrees to angle units', () => {
    expect(WAngle.fromDegrees(0).angle).toBe(0)
    expect(WAngle.fromDegrees(90).angle).toBe(256)
    expect(WAngle.fromDegrees(180).angle).toBe(512)
    expect(WAngle.fromDegrees(270).angle).toBe(768)
    expect(WAngle.fromDegrees(360).angle).toBe(0) // wraps
  })
})

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('WAngle properties', () => {
  it('angleSquared returns square of angle', () => {
    expect(new WAngle(10).angleSquared).toBe(100)
    expect(new WAngle(0).angleSquared).toBe(0)
  })

  it('facing returns integer division of angle by 4', () => {
    expect(new WAngle(0).facing).toBe(0)
    expect(new WAngle(256).facing).toBe(64)
    expect(new WAngle(512).facing).toBe(128)
    expect(new WAngle(7).facing).toBe(1)
    expect(new WAngle(3).facing).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('WAngle static operators', () => {
  it('add wraps correctly', () => {
    const result = WAngle.add(new WAngle(100), new WAngle(200))
    expect(result.angle).toBe(300)

    const wrapped = WAngle.add(new WAngle(600), new WAngle(500))
    expect(wrapped.angle).toBe(76) // 1100 -> 76
  })

  it('subtract wraps correctly', () => {
    const result = WAngle.subtract(new WAngle(500), new WAngle(200))
    expect(result.angle).toBe(300)

    const wrapped = WAngle.subtract(new WAngle(100), new WAngle(200))
    expect(wrapped.angle).toBe(924) // -100 -> 924
  })

  it('negate returns inverted angle', () => {
    expect(WAngle.negate(new WAngle(0)).angle).toBe(0)
    expect(WAngle.negate(new WAngle(100)).angle).toBe(924)
    expect(WAngle.negate(new WAngle(512)).angle).toBe(512)
  })

  it('equals checks angle equality', () => {
    expect(WAngle.equals(new WAngle(100), new WAngle(100))).toBe(true)
    expect(WAngle.equals(new WAngle(100), new WAngle(200))).toBe(false)
    // Normalized representation matters
    expect(WAngle.equals(new WAngle(1124), new WAngle(100))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Trigonometric functions (deterministic, lookup table based)
// ---------------------------------------------------------------------------

describe('WAngle.cos', () => {
  it('cos(0) = 1024 (full scale)', () => {
    expect(new WAngle(0).cos()).toBe(1024)
  })

  it('cos(256) = 0 (90 degrees)', () => {
    expect(new WAngle(256).cos()).toBe(0)
  })

  it('cos(512) = -1024 (180 degrees)', () => {
    expect(new WAngle(512).cos()).toBe(-1024)
  })

  it('cos(768) = 0 (270 degrees)', () => {
    expect(new WAngle(768).cos()).toBe(0)
  })

  it('cos is symmetric: cos(a) = cos(-a)', () => {
    expect(new WAngle(100).cos()).toBe(new WAngle(924).cos())
  })

  it('cos wraps correctly for angles > 1024', () => {
    expect(new WAngle(1024 + 256).cos()).toBe(0) // same as angle 256
  })
})

describe('WAngle.sin', () => {
  it('sin(0) = 0', () => {
    expect(new WAngle(0).sin()).toBe(0)
  })

  it('sin(256) = 1024 (90 degrees)', () => {
    expect(new WAngle(256).sin()).toBe(1024)
  })

  it('sin(512) = 0 (180 degrees)', () => {
    expect(new WAngle(512).sin()).toBe(0)
  })

  it('sin(768) = -1024 (270 degrees)', () => {
    expect(new WAngle(768).sin()).toBe(-1024)
  })
})

describe('WAngle.tan', () => {
  it('tan(0) = 0', () => {
    expect(new WAngle(0).tan()).toBe(0)
  })

  it('tan(128) = 1023 (45 degrees, from C# TanTable)', () => {
    // C# TanTable[128] = 1023, not exactly 1024 due to integer quantization
    expect(new WAngle(128).tan()).toBe(1023)
  })

  it('tan(256) = large value (90 degrees)', () => {
    const t = new WAngle(256).tan()
    expect(t).toBe(2147483647) // int.MaxValue from C#
  })

  it('tan(512) = 0 (180 degrees)', () => {
    expect(new WAngle(512).tan()).toBe(0)
  })

  it('tan wraps correctly for angles > 1024', () => {
    expect(new WAngle(1024 + 128).tan()).toBe(1023)
  })
})

// ---------------------------------------------------------------------------
// Inverse trigonometric functions
// ---------------------------------------------------------------------------

describe('WAngle.arcSin', () => {
  it('arcSin(0) = 0', () => {
    const result = WAngle.arcSin(0)
    expect(result.angle).toBe(0)
  })

  it('arcSin(1024) = 256 (90 degrees)', () => {
    const result = WAngle.arcSin(1024)
    expect(result.angle).toBe(256)
  })

  it('arcSin(-1024) = 768 (270 degrees / -90 degrees)', () => {
    const result = WAngle.arcSin(-1024)
    expect(result.angle).toBe(768)
  })

  it('throws for values outside [-1024, 1024]', () => {
    expect(() => WAngle.arcSin(1025)).toThrow()
    expect(() => WAngle.arcSin(-1025)).toThrow()
  })

  it('arcSin(sin(x)) is approximately x for angles in range [-90, 90]', () => {
    // arcSin only returns angles in [-90°, +90°] i.e. [768, 0, 256]
    // Angles outside this range cannot be recovered
    for (const angle of [0, 64, 128, 192, 256]) {
      const w = new WAngle(angle)
      const recovered = WAngle.arcSin(w.sin())
      // Due to lookup table quantization, error within 2 units
      expect(Math.abs(recovered.angle - angle) <= 2).toBe(true)
    }
  })
})

describe('WAngle.arcCos', () => {
  it('arcCos(1024) = 0', () => {
    const result = WAngle.arcCos(1024)
    expect(result.angle).toBe(0)
  })

  it('arcCos(0) = 256 (90 degrees)', () => {
    const result = WAngle.arcCos(0)
    expect(result.angle).toBe(256)
  })

  it('arcCos(-1024) = 512 (180 degrees)', () => {
    const result = WAngle.arcCos(-1024)
    expect(result.angle).toBe(512)
  })

  it('throws for values outside [-1024, 1024]', () => {
    expect(() => WAngle.arcCos(1025)).toThrow()
    expect(() => WAngle.arcCos(-1025)).toThrow()
  })
})

describe('WAngle.arcTan', () => {
  it('arcTan(0, positive) = 0', () => {
    expect(WAngle.arcTan(0, 5).angle).toBe(0)
  })

  it('arcTan(0, negative) = 512 (180 degrees)', () => {
    expect(WAngle.arcTan(0, -5).angle).toBe(512)
  })

  it('arcTan(positive, 0) = 256 (90 degrees)', () => {
    expect(WAngle.arcTan(5, 0).angle).toBe(256)
  })

  it('arcTan(negative, 0) = 768 (270 degrees)', () => {
    expect(WAngle.arcTan(-5, 0).angle).toBe(768)
  })

  it('arcTan(0, 0) = 0 (guarded)', () => {
    expect(WAngle.arcTan(0, 0).angle).toBe(0)
  })

  it('quadrant I: x > 0, y > 0 gives angle 0-256', () => {
    const result = WAngle.arcTan(1024, 1024) // 45 degrees
    expect(result.angle).toBeGreaterThan(0)
    expect(result.angle).toBeLessThan(256)
    // tan(128) ≈ 1024, so arctan(1024, 1024) ≈ 128
    expect(Math.abs(result.angle - 128) <= 2).toBe(true)
  })

  it('quadrant II: x < 0, y > 0 gives angle 256-512', () => {
    const result = WAngle.arcTan(1024, -1024)
    expect(result.angle).toBeGreaterThan(256)
    expect(result.angle).toBeLessThan(512)
  })

  it('quadrant III: x < 0, y < 0 gives angle 512-768', () => {
    const result = WAngle.arcTan(-1024, -1024)
    expect(result.angle).toBeGreaterThan(512)
    expect(result.angle).toBeLessThan(768)
  })

  it('quadrant IV: x > 0, y < 0 gives angle 768-1024', () => {
    const result = WAngle.arcTan(-1024, 1024)
    expect(result.angle).toBeGreaterThan(768)
    expect(result.angle).toBeLessThan(1024)
  })
})

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe('WAngle.lerp', () => {
  it('lerp with mul=0 returns a', () => {
    const a = new WAngle(100)
    const b = new WAngle(500)
    const result = WAngle.lerp(a, b, 0, 1)
    expect(result.angle).toBe(100)
  })

  it('lerp with mul=div returns b', () => {
    const a = new WAngle(100)
    const b = new WAngle(500)
    const result = WAngle.lerp(a, b, 1, 1)
    expect(result.angle).toBe(500)
  })

  it('lerp midpoint', () => {
    const a = new WAngle(0)
    const b = new WAngle(512)
    const result = WAngle.lerp(a, b, 1, 2)
    expect(result.angle).toBe(256)
  })

  it('lerp handles angle wrap (shortest path)', () => {
    // 100 to 900: shortest path crosses the 0/1024 boundary
    const a = new WAngle(900)
    const b = new WAngle(100)
    // shortest path: 900 → 1024→0 → 100 (distance = 224)
    const result = WAngle.lerp(a, b, 1, 2)
    // Expect angle near 1012 (midpoint of shortest path from 900 through 0 to 100)
    expect(result.angle).toBe(1012)
  })
})

// ---------------------------------------------------------------------------
// Render boundary conversion
// ---------------------------------------------------------------------------

describe('WAngle renderer conversions', () => {
  it('rendererRadians converts correctly', () => {
    expect(new WAngle(0).rendererRadians()).toBeCloseTo(0, 5)
    expect(new WAngle(256).rendererRadians()).toBeCloseTo(Math.PI / 2, 5)
    expect(new WAngle(512).rendererRadians()).toBeCloseTo(Math.PI, 5)
    expect(new WAngle(768).rendererRadians()).toBeCloseTo(3 * Math.PI / 2, 5)
    // angle 1024 normalizes to 0, so 0 radians
    expect(new WAngle(1024).rendererRadians()).toBe(0)
  })

  it('rendererDegrees converts correctly', () => {
    expect(new WAngle(0).rendererDegrees()).toBeCloseTo(0, 5)
    expect(new WAngle(256).rendererDegrees()).toBeCloseTo(90, 5)
    expect(new WAngle(512).rendererDegrees()).toBeCloseTo(180, 5)
    expect(new WAngle(768).rendererDegrees()).toBeCloseTo(270, 5)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('WAngle standard methods', () => {
  it('equals checks angle equality', () => {
    expect(new WAngle(100).equals(new WAngle(100))).toBe(true)
    expect(new WAngle(100).equals(new WAngle(200))).toBe(false)
  })

  it('toString returns numeric string', () => {
    expect(new WAngle(100).toString()).toBe('100')
    expect(new WAngle(1024).toString()).toBe('0') // normalized
  })
})
