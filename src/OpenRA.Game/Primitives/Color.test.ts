/**
 * Color.test.ts — Color 数学工具函数单元测试
 *
 * 测试 srgbToLinear, linearToSrgb, fromArgb, toArgb, toLinear,
 * fromLinear, rgbToHsv, hsvToRgb, premultiplyAlpha。
 *
 * 由于 Color.ts 是纯数学函数（无 Babylon.js 依赖），无需 mock。
 */

import { describe, it, expect } from 'vitest'
import {
  srgbToLinear,
  linearToSrgb,
  fromArgb,
  toArgb,
  toLinear,
  fromLinear,
  rgbToHsv,
  hsvToRgb,
  premultiplyAlpha,
} from './Color'

// ---------------------------------------------------------------------------
// srgbToLinear
// ---------------------------------------------------------------------------

describe('srgbToLinear', () => {
  it('converts 0.0 (black) to linear 0', () => {
    expect(srgbToLinear(0)).toBe(0)
  })

  it('converts 1.0 (white) to linear 1.0', () => {
    expect(srgbToLinear(1)).toBeCloseTo(1.0, 5)
  })

  it('uses linear segment for values <= 0.04045', () => {
    // sRGB linear segment: c / 12.92
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 6)
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 6)
  })

  it('uses gamma 2.4 for values > 0.04045', () => {
    // Known reference: 0.5 sRGB ≈ 0.214 linear
    const result = srgbToLinear(0.5)
    expect(result).toBeGreaterThan(0.2)
    expect(result).toBeLessThan(0.25)
  })

  it('round-trips with linearToSrgb', () => {
    for (const c of [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 4)
    }
  })
})

// ---------------------------------------------------------------------------
// linearToSrgb
// ---------------------------------------------------------------------------

describe('linearToSrgb', () => {
  it('converts 0.0 (linear black) to sRGB 0', () => {
    expect(linearToSrgb(0)).toBe(0)
  })

  it('converts 1.0 (linear white) to sRGB 1.0', () => {
    expect(linearToSrgb(1)).toBeCloseTo(1.0, 5)
  })

  it('uses linear segment for values <= 0.0031308', () => {
    expect(linearToSrgb(0.0031308)).toBeCloseTo(0.0031308 * 12.92, 5)
    expect(linearToSrgb(0.001)).toBeCloseTo(0.001 * 12.92, 5)
  })

  it('round-trips with srgbToLinear', () => {
    for (const c of [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      expect(srgbToLinear(linearToSrgb(c))).toBeCloseTo(c, 4)
    }
  })
})

// ---------------------------------------------------------------------------
// fromArgb / toArgb
// ---------------------------------------------------------------------------

describe('fromArgb', () => {
  it('extracts RGBA components from ARGB uint32', () => {
    // 0xAARRGGBB → ARGB=0xFF102030
    const argb = 0xff102030
    const c = fromArgb(argb)
    expect(c.a).toBe(0xff)
    expect(c.r).toBe(0x10)
    expect(c.g).toBe(0x20)
    expect(c.b).toBe(0x30)
  })

  it('handles zero (fully transparent black)', () => {
    const c = fromArgb(0)
    expect(c).toEqual({ a: 0, r: 0, g: 0, b: 0 })
  })

  it('handles fully opaque white', () => {
    const c = fromArgb(0xffffffff)
    expect(c).toEqual({ a: 255, r: 255, g: 255, b: 255 })
  })
})

describe('toArgb', () => {
  it('encodes RGBA to ARGB uint32', () => {
    expect(toArgb(0xff, 0x10, 0x20, 0x30)).toBe(0xff102030)
  })

  it('round-trips with fromArgb', () => {
    const original = { a: 128, r: 64, g: 32, b: 16 }
    const argb = toArgb(original.a, original.r, original.g, original.b)
    const decoded = fromArgb(argb)
    expect(decoded).toEqual(original)
  })

  it('clamps values > 255 to 8 bits', () => {
    const argb = toArgb(300, 300, 300, 300)
    const c = fromArgb(argb)
    // 300 & 0xff = 44
    expect(c.a).toBe(44)
    expect(c.r).toBe(44)
    expect(c.g).toBe(44)
    expect(c.b).toBe(44)
  })
})

// ---------------------------------------------------------------------------
// toLinear
// ---------------------------------------------------------------------------

describe('toLinear', () => {
  it('undoes premultiplied alpha and gamma for opaque white', () => {
    const result = toLinear(255, 255, 255, 255)
    expect(result.r).toBeCloseTo(1.0, 5)
    expect(result.g).toBeCloseTo(1.0, 5)
    expect(result.b).toBeCloseTo(1.0, 5)
  })

  it('returns zero for zero alpha', () => {
    const result = toLinear(0, 128, 128, 128)
    expect(result.r).toBe(0)
    expect(result.g).toBe(0)
    expect(result.b).toBe(0)
  })

  it('handles semi-transparent colors by dividing out alpha', () => {
    // Semi-transparent white: (a=128, r=128, g=128, b=128)
    // After dividing by alpha (128/255 ≈ 0.502), normalized channels = 1.0
    const result = toLinear(128, 128, 128, 128)
    expect(result.r).toBeCloseTo(1.0, 3)
    expect(result.g).toBeCloseTo(1.0, 3)
    expect(result.b).toBeCloseTo(1.0, 3)
  })
})

// ---------------------------------------------------------------------------
// fromLinear
// ---------------------------------------------------------------------------

describe('fromLinear', () => {
  it('applies gamma and premultiplied alpha for opaque white', () => {
    const result = fromLinear(255, 1.0, 1.0, 1.0)
    expect(result.a).toBe(255)
    expect(result.r).toBe(255)
    expect(result.g).toBe(255)
    expect(result.b).toBe(255)
  })

  it('round-trips with toLinear for opaque colors', () => {
    const original = { a: 255, r: 200, g: 100, b: 50 }
    const linear = toLinear(original.a, original.r, original.g, original.b)
    const result = fromLinear(original.a, linear.r, linear.g, linear.b)
    // Allow some floating point error
    expect(result.r).toBeCloseTo(original.r, -1)
    expect(result.g).toBeCloseTo(original.g, -1)
    expect(result.b).toBeCloseTo(original.b, -1)
  })

  it('produces premultiplied values for semi-transparent colors', () => {
    // Opaque gray (r=128, g=128, b=128) with alpha=128
    // Linear value ≈ 0.216
    // After fromLinear: r ≈ linearToSrgb(0.216) * 128 ≈ 55
    const result = fromLinear(128, 0.216, 0.216, 0.216)
    expect(result.a).toBe(128)
    expect(result.r).toBeLessThan(128) // premultiplied
    expect(result.g).toBeLessThan(128)
    expect(result.b).toBeLessThan(128)
  })
})

// ---------------------------------------------------------------------------
// rgbToHsv
// ---------------------------------------------------------------------------

describe('rgbToHsv', () => {
  it('converts pure red (1,0,0) to HSV', () => {
    const hsv = rgbToHsv(1, 0, 0)
    expect(hsv.h).toBeCloseTo(0, 1)
    expect(hsv.s).toBeCloseTo(1, 1)
    expect(hsv.v).toBeCloseTo(1, 1)
  })

  it('converts pure green (0,1,0) to HSV', () => {
    const hsv = rgbToHsv(0, 1, 0)
    expect(hsv.h).toBeCloseTo(1 / 3, 1)
    expect(hsv.s).toBeCloseTo(1, 1)
    expect(hsv.v).toBeCloseTo(1, 1)
  })

  it('converts pure blue (0,0,1) to HSV', () => {
    const hsv = rgbToHsv(0, 0, 1)
    expect(hsv.h).toBeCloseTo(2 / 3, 1)
    expect(hsv.s).toBeCloseTo(1, 1)
    expect(hsv.v).toBeCloseTo(1, 1)
  })

  it('returns h=0, s=0 for grayscale (delta=0)', () => {
    const hsv = rgbToHsv(0.5, 0.5, 0.5)
    expect(hsv.h).toBe(0)
    expect(hsv.s).toBe(0)
    expect(hsv.v).toBeCloseTo(0.5, 1)
  })

  it('wraps negative hue to [0, 1)', () => {
    // Blue should wrap: hue ≈ 2/3, not negative
    const hsv = rgbToHsv(0, 0, 0.5)
    expect(hsv.h).toBeGreaterThanOrEqual(0)
    expect(hsv.h).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// hsvToRgb
// ---------------------------------------------------------------------------

describe('hsvToRgb', () => {
  it('converts HSV (0, 1, 1) to pure red', () => {
    const rgb = hsvToRgb(0, 1, 1)
    expect(rgb.r).toBeCloseTo(1, 3)
    expect(rgb.g).toBeCloseTo(0, 3)
    expect(rgb.b).toBeCloseTo(0, 3)
  })

  it('converts HSV (1/3, 1, 1) to pure green', () => {
    const rgb = hsvToRgb(1 / 3, 1, 1)
    expect(rgb.r).toBeCloseTo(0, 3)
    expect(rgb.g).toBeCloseTo(1, 3)
    expect(rgb.b).toBeCloseTo(0, 3)
  })

  it('converts HSV (2/3, 1, 1) to pure blue', () => {
    const rgb = hsvToRgb(2 / 3, 1, 1)
    expect(rgb.r).toBeCloseTo(0, 3)
    expect(rgb.g).toBeCloseTo(0, 3)
    expect(rgb.b).toBeCloseTo(1, 3)
  })

  it('converts HSV with 0 saturation to gray', () => {
    const rgb = hsvToRgb(0.5, 0, 0.5)
    expect(rgb.r).toBeCloseTo(0.5, 3)
    expect(rgb.g).toBeCloseTo(0.5, 3)
    expect(rgb.b).toBeCloseTo(0.5, 3)
  })

  it('round-trips with rgbToHsv', () => {
    const testCases = [
      { r: 1, g: 0, b: 0 },
      { r: 0, g: 1, b: 0 },
      { r: 0, g: 0, b: 1 },
      { r: 0.5, g: 0.5, b: 0.5 },
      { r: 1, g: 1, b: 0 },
      { r: 0, g: 1, b: 1 },
    ]
    for (const c of testCases) {
      const hsv = rgbToHsv(c.r, c.g, c.b)
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v)
      expect(rgb.r).toBeCloseTo(c.r, 3)
      expect(rgb.g).toBeCloseTo(c.g, 3)
      expect(rgb.b).toBeCloseTo(c.b, 3)
    }
  })
})

// ---------------------------------------------------------------------------
// premultiplyAlpha
// ---------------------------------------------------------------------------

describe('premultiplyAlpha', () => {
  it('returns unchanged for fully opaque (a=255)', () => {
    const result = premultiplyAlpha(100, 150, 200, 255)
    expect(result).toEqual({ r: 100, g: 150, b: 200, a: 255 })
  })

  it('premultiplies for a=128 (50% alpha)', () => {
    const result = premultiplyAlpha(200, 100, 50, 128)
    // factor = 128/255 ≈ 0.502
    // r: 200 * 0.502 ≈ 100
    expect(result.r).toBeCloseTo(100, 0)
    expect(result.g).toBeCloseTo(50, 0)
    expect(result.b).toBeCloseTo(25, 0)
    expect(result.a).toBe(128)
  })

  it('returns zero RGB for a=0', () => {
    const result = premultiplyAlpha(255, 255, 255, 0)
    expect(result).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('handles a=1 (nearly transparent)', () => {
    const result = premultiplyAlpha(255, 128, 64, 1)
    expect(result.r).toBeLessThanOrEqual(1)
    expect(result.g).toBeLessThanOrEqual(1)
    expect(result.b).toBeLessThanOrEqual(1)
    expect(result.a).toBe(1)
  })
})
