/**
 * CVec.test.ts — CVec migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { CVec } from './CVec'
import { Rectangle } from './Primitives/Rectangle'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('CVec construction', () => {
  it('stores X, Y components', () => {
    const cv = new CVec(10, 20)
    expect(cv.X).toBe(10)
    expect(cv.Y).toBe(20)
  })

  it('truncates to int32', () => {
    const cv = new CVec(1.7, -2.3)
    expect(cv.X).toBe(1)
    expect(cv.Y).toBe(-2)
  })

  it('has Zero static constant', () => {
    expect(CVec.Zero.X).toBe(0)
    expect(CVec.Zero.Y).toBe(0)
  })

  it('Directions has 8 entries', () => {
    expect(CVec.Directions.length).toBe(8)
  })

  it('Directions are all unique', () => {
    const dirs = CVec.Directions.map(d => `${d.X},${d.Y}`)
    const unique = new Set(dirs)
    expect(unique.size).toBe(8)
  })

  it('Directions include all 8 neighbors (no (0,0))', () => {
    const hasOrigin = CVec.Directions.some(d => d.X === 0 && d.Y === 0)
    expect(hasOrigin).toBe(false)
    // Check each direction is one step away
    for (const d of CVec.Directions) {
      expect(Math.abs(d.X)).toBeLessThanOrEqual(1)
      expect(Math.abs(d.Y)).toBeLessThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('CVec static operators', () => {
  it('add combines components', () => {
    const result = CVec.add(new CVec(1, 2), new CVec(3, 4))
    expect(result.X).toBe(4)
    expect(result.Y).toBe(6)
  })

  it('subtract finds difference', () => {
    const result = CVec.subtract(new CVec(5, 8), new CVec(1, 3))
    expect(result.X).toBe(4)
    expect(result.Y).toBe(5)
  })

  it('negate inverts both components', () => {
    const result = CVec.negate(new CVec(3, -4))
    expect(result.X).toBe(-3)
    expect(result.Y).toBe(4)
  })

  it('multiply scales by factor', () => {
    const result = CVec.multiply(new CVec(3, 4), 2)
    expect(result.X).toBe(6)
    expect(result.Y).toBe(8)
  })

  it('multiplyScalar reverses argument order', () => {
    const result = CVec.multiplyScalar(2, new CVec(3, 4))
    expect(result.X).toBe(6)
    expect(result.Y).toBe(8)
  })

  it('divide scales down', () => {
    const result = CVec.divide(new CVec(6, 8), 2)
    expect(result.X).toBe(3)
    expect(result.Y).toBe(4)
  })

  it('max takes component-wise maximum', () => {
    const result = CVec.max(new CVec(1, 5), new CVec(3, 2))
    expect(result.X).toBe(3)
    expect(result.Y).toBe(5)
  })

  it('min takes component-wise minimum', () => {
    const result = CVec.min(new CVec(1, 5), new CVec(3, 2))
    expect(result.X).toBe(1)
    expect(result.Y).toBe(2)
  })

  it('dot computes dot product', () => {
    expect(CVec.dot(new CVec(1, 2), new CVec(3, 4))).toBe(1 * 3 + 2 * 4)
  })

  it('equals checks component equality', () => {
    expect(CVec.equals(new CVec(1, 2), new CVec(1, 2))).toBe(true)
    expect(CVec.equals(new CVec(1, 2), CVec.Zero)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

describe('CVec instance methods', () => {
  it('sign returns -1, 0, or 1 for each component', () => {
    expect(new CVec(5, -3).sign().X).toBe(1)
    expect(new CVec(5, -3).sign().Y).toBe(-1)
    expect(new CVec(0, 0).sign().X).toBe(0)
  })

  it('abs returns absolute values', () => {
    const result = new CVec(-5, -3).abs()
    expect(result.X).toBe(5)
    expect(result.Y).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Clamp
// ---------------------------------------------------------------------------

describe('CVec.clamp', () => {
  const bounds = new Rectangle(0, 0, 10, 10)

  it('vector inside bounds is unchanged', () => {
    const cv = new CVec(5, 5)
    const clamped = cv.clamp(bounds)
    expect(clamped.X).toBe(5)
    expect(clamped.Y).toBe(5)
  })

  it('vector outside bounds is clamped', () => {
    const cv = new CVec(20, -5)
    const clamped = cv.clamp(bounds)
    expect(clamped.X).toBe(10)
    expect(clamped.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------

describe('CVec length', () => {
  it('lengthSquared = X*X + Y*Y', () => {
    expect(new CVec(3, 4).lengthSquared).toBe(25)
  })

  it('length = integer sqrt', () => {
    expect(new CVec(3, 4).length).toBe(5)
  })

  it('length of zero is 0', () => {
    expect(CVec.Zero.length).toBe(0)
    expect(CVec.Zero.lengthSquared).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('CVec standard methods', () => {
  it('instance equals matches static', () => {
    expect(new CVec(1, 2).equals(new CVec(1, 2))).toBe(true)
    expect(new CVec(1, 2).equals(new CVec(3, 4))).toBe(false)
  })

  it('toString returns X,Y', () => {
    expect(new CVec(1, 2).toString()).toBe('1,2')
  })
})
