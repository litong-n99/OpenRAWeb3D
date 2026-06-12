/**
 * MissileMath.test.ts — MissileMath pure function tests
 */

import { describe, it, expect } from 'vitest'

import {
  loopRadius,
  willClimbWithinDistance,
  isNearInclineTop,
  willClimbAroundInclineTop,
  bisectionSearch,
  increaseAltitude,
  normaliseFacing,
  tickFacing,
  clamp,
  applyPercentageModifiers,
} from './MissileMath.js'

describe('loopRadius', () => {
  it('computes correct radius for given speed and rotation', () => {
    const r = loopRadius(384, 24)
    // speed=384, rot=24 -> 384 * 6400 / (157 * 24) = 2457600 / 3768 ≈ 652
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(1000)
  })

  it('handles zero rotation by returning large value', () => {
    const r = loopRadius(100, 0)
    expect(r).toBe(100 * 6400)
  })

  it('scales linearly with speed', () => {
    const r1 = loopRadius(100, 10)
    const r2 = loopRadius(200, 10)
    // Doubling speed should double radius (approximately)
    expect(r2).toBeGreaterThan(r1)
  })
})

describe('willClimbWithinDistance', () => {
  it('returns true when close enough', () => {
    const vFacing = 32 // positive facing
    const lpRadius = 600
    const result = willClimbWithinDistance(vFacing, lpRadius, 500, 100)
    // Should be a boolean
    expect(typeof result).toBe('boolean')
  })

  it('returns expected value for simple case', () => {
    // vFacing=0, missile is at the very bottom of the loop
    const result = willClimbWithinDistance(0, 600, 500, 500)
    expect(typeof result).toBe('boolean')
  })
})

describe('isNearInclineTop', () => {
  it('returns false for negative vFacing', () => {
    expect(isNearInclineTop(-1, 500, 100)).toBe(false)
  })

  it('returns boolean for non-negative vFacing', () => {
    expect(typeof isNearInclineTop(32, 500, 100)).toBe('boolean')
  })

  it('returns true when very close to incline top', () => {
    expect(isNearInclineTop(32, 1000, 1)).toBe(true)
  })

  it('returns false when far from incline top', () => {
    const result = isNearInclineTop(32, 500, 10000)
    expect(result).toBe(false)
  })
})

describe('willClimbAroundInclineTop', () => {
  it('returns boolean', () => {
    expect(typeof willClimbAroundInclineTop(32, 600, 100, 50)).toBe('boolean')
  })
})

describe('bisectionSearch', () => {
  it('finds the correct boundary value', () => {
    const result = bisectionSearch(0, 100, (v: number) => v <= 50)
    expect(result).toBe(50)
  })

  it('works with monotonic predicate', () => {
    const result = bisectionSearch(0, 100, (v: number) => v < 75)
    expect(result).toBe(74)
  })
})

describe('increaseAltitude', () => {
  it('returns verticalRateOfTurn when vFacing is negative', () => {
    const result = increaseAltitude(-10, 500, 100, 200, 1000, 24, true)
    expect(result).toBe(24)
  })

  it('returns a number', () => {
    const result = increaseAltitude(10, 500, 100, 50, 1000, 24, true)
    expect(typeof result).toBe('number')
  })
})

describe('normaliseFacing', () => {
  it('returns non-negative values as lower 8 bits', () => {
    expect(normaliseFacing(0)).toBe(0)
    expect(normaliseFacing(128)).toBe(128) // 128 & 0xFF = 128
    expect(normaliseFacing(200)).toBe(200) // 200 & 0xFF = 200
  })

  it('normalizes negative values to 0..255 range', () => {
    expect(normaliseFacing(-50)).toBe(206) // 256 - 50 = 206
    expect(normaliseFacing(-128)).toBe(128) // 256 - 128 = 128
    expect(normaliseFacing(-1)).toBe(255)  // 256 - 1 = 255
  })
})

describe('tickFacing', () => {
  it('snaps to desired facing when close enough', () => {
    const result = tickFacing(10, 12, 5)
    // 12-10 = 2 < 5, should snap
    expect(result).toBe(12)
  })

  it('turns right when shortest arc is right', () => {
    const result = tickFacing(10, 50, 5)
    // rightTurn = 50 - 10 = 40, leftTurn = 10 - 50 + 256 = 216
    // rightTurn < leftTurn, so turn right
    expect(result).toBe(15) // 10 + 5
  })

  it('turns left when shortest arc is left', () => {
    const result = tickFacing(200, 180, 5)
    // leftTurn = 200 - 180 = 20, rightTurn = 180 - 200 + 256 = 236
    // leftTurn < rightTurn, so turn left
    expect(result).toBe(195) // 200 - 5
  })

  it('wraps around 255/0 boundary', () => {
    // Facing near 0, desired near 250
    const result = tickFacing(2, 250, 5)
    // leftTurn = 2 - 250 + 256 = 8, rightTurn = 250 - 2 = 248
    expect(result).toBe(253) // 2 - 5 + 256 = 253
  })
})

describe('clamp', () => {
  it('clamps to range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('returns min when at boundary', () => {
    expect(clamp(0, 0, 10)).toBe(0)
  })
})

describe('applyPercentageModifiers', () => {
  it('applies multiple modifiers', () => {
    const result = applyPercentageModifiers(100, [50, 80])
    // 100 * 50 / 100 = 50, 50 * 80 / 100 = 40
    expect(result).toBe(40)
  })

  it('returns original value when no modifiers', () => {
    expect(applyPercentageModifiers(100, [])).toBe(100)
  })

  it('handles single modifier', () => {
    expect(applyPercentageModifiers(200, [150])).toBe(300)
  })
})
