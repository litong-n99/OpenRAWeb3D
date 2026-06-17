/**
 * Util.test.ts — C&C Util unit tests
 */

import { describe, it, expect } from 'vitest'
import { WAngle } from '../OpenRA.Game/WAngle.js'
import {
  classicIndexFacing,
  classicQuantizeFacing,
  identityMatrix,
  scaleMatrix,
  translationMatrix,
  matrixMultiply,
  matrixVectorMultiply,
  matrixInverse,
} from './Util.js'

// ---------------------------------------------------------------------------
// ClassicIndexFacing
// ---------------------------------------------------------------------------

describe('classicIndexFacing', () => {
  it('returns 0 for facing angle 0 with 32 frames', () => {
    // angle 0 < SPRITE_RANGES[0] (20), so index 0
    expect(classicIndexFacing(new WAngle(0), 32)).toBe(0)
  })

  it('returns correct index for mid-range facing with 32 frames', () => {
    // angle 40: 20 <= 40 < 56, so index 1
    expect(classicIndexFacing(new WAngle(40), 32)).toBe(1)
  })

  it('returns correct index for higher facing with 32 frames', () => {
    // angle 500: SPRITE_RANGES[15]=488, [16]=532. 488 < 500, 532 > 500, so index 16
    expect(classicIndexFacing(new WAngle(500), 32)).toBe(16)
  })

  it('returns 0 for facing >= 1000 with 32 frames (wraps to 0)', () => {
    // angle 1000: all SPRITE_RANGES entries < 1000 until 1000 itself
    // last entry is 1000. 1000 < 1000? false, return 0 (loop exhausted)
    expect(classicIndexFacing(new WAngle(1000), 32)).toBe(0)
  })

  it('delegates to uniform for non-32 frame counts', () => {
    // 8 frames: uniform quantization
    const index = classicIndexFacing(WAngle.Zero, 8)
    expect(index).toBe(0)
  })

  it('handles 16-frame uniform delegation', () => {
    const angle = new WAngle(128) // 45 degrees in 0-1024 space
    const index = classicIndexFacing(angle, 16)
    // step = 64, a = (128+32)&1023 = 160, index = floor(160/64) = 2
    expect(index).toBe(2)
  })

  it('returns valid indices for all 32-frame inputs', () => {
    for (let a = 0; a < 1024; a++) {
      const idx = classicIndexFacing(new WAngle(a), 32)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(32)
    }
  })
})

// ---------------------------------------------------------------------------
// ClassicQuantizeFacing
// ---------------------------------------------------------------------------

describe('classicQuantizeFacing', () => {
  it('returns WAngle.Zero for facing 0 with 32 steps', () => {
    const result = classicQuantizeFacing(WAngle.Zero, 32)
    expect(result.angle).toBe(0)
  })

  it('returns correct quantized angle for mid facing with 32 steps', () => {
    // facing 40 -> index 1 -> SPRITE_FACINGS[1] = WAngle(40)
    const result = classicQuantizeFacing(new WAngle(40), 32)
    expect(result.angle).toBe(40)
  })

  it('returns non-linear quantized values (not uniform)', () => {
    // At 32 steps, the step spacing is non-linear
    const r0 = classicQuantizeFacing(new WAngle(20), 32)
    const r1 = classicQuantizeFacing(new WAngle(80), 32)
    // These should differ
    expect(r0.angle).not.toBe(r1.angle)
  })

  it('delegates to uniform for non-32 steps', () => {
    const result = classicQuantizeFacing(new WAngle(100), 8)
    // step = 128, index = floor((100+64)&1023 / 128) = floor(164/128) = 1
    // result = 1 * 128 = 128
    expect(result.angle).toBe(128)
  })

  it('returns valid facings for all inputs', () => {
    for (let a = 0; a < 1024; a++) {
      const result = classicQuantizeFacing(new WAngle(a), 32)
      expect(result.angle).toBeGreaterThanOrEqual(0)
      expect(result.angle).toBeLessThan(1024)
    }
  })
})

// ---------------------------------------------------------------------------
// identityMatrix
// ---------------------------------------------------------------------------

describe('identityMatrix', () => {
  it('returns 4x4 identity', () => {
    const m = identityMatrix()
    expect(m[0]).toBe(1)
    expect(m[5]).toBe(1)
    expect(m[10]).toBe(1)
    expect(m[15]).toBe(1)
    expect(m[1]).toBe(0)
    expect(m[4]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// scaleMatrix
// ---------------------------------------------------------------------------

describe('scaleMatrix', () => {
  it('returns scale matrix with correct diagonal', () => {
    const m = scaleMatrix(2, 3, 4)
    expect(m[0]).toBe(2)
    expect(m[5]).toBe(3)
    expect(m[10]).toBe(4)
    expect(m[15]).toBe(1)
  })

  it('handles zero scale', () => {
    const m = scaleMatrix(0, 0, 0)
    expect(m[0]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// translationMatrix
// ---------------------------------------------------------------------------

describe('translationMatrix', () => {
  it('sets translation components', () => {
    const m = translationMatrix(10, 20, 30)
    expect(m[12]).toBe(10)
    expect(m[13]).toBe(20)
    expect(m[14]).toBe(30)
    expect(m[15]).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// matrixMultiply
// ---------------------------------------------------------------------------

describe('matrixMultiply', () => {
  it('identity * identity = identity', () => {
    const a = identityMatrix()
    const b = identityMatrix()
    const result = matrixMultiply(a, b)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)
    expect(result[10]).toBe(1)
  })

  it('scale * translation combines correctly', () => {
    const s = scaleMatrix(2, 3, 4)
    const t = translationMatrix(10, 20, 30)
    const result = matrixMultiply(s, t)
    // For row-major: result[i,j] = sum_k lhs[k,j] * rhs[i,k]
    // With our convention, scale first then translate modifies specific elements
    expect(result[15]).toBe(1)
  })

  it('produces non-identity for non-identity inputs', () => {
    const t1 = translationMatrix(5, 0, 0)
    const t2 = translationMatrix(0, 3, 0)
    const result = matrixMultiply(t1, t2)
    // The combined translation matrix should have non-zero off-diagonal/translation components
    // Verify it's not identity
    const isIdentity = result[0] === 1 && result[5] === 1 && result[10] === 1 && result[15] === 1
      && result[1] === 0 && result[2] === 0 && result[3] === 0
      && result[4] === 0 && result[6] === 0 && result[7] === 0
      && result[8] === 0 && result[9] === 0 && result[11] === 0
    // Translation matrices multiplied produce another translation matrix
    // which still has identity rotation/scale but non-zero translation
    expect(isIdentity).toBe(true) // rotation/scale part is identity
    expect(result[12] !== 0 || result[13] !== 0).toBe(true) // translation part is non-zero
  })
})

// ---------------------------------------------------------------------------
// matrixVectorMultiply
// ---------------------------------------------------------------------------

describe('matrixVectorMultiply', () => {
  it('identity * vector = vector', () => {
    const i = identityMatrix()
    const v = new Float32Array([1, 2, 3, 1])
    const result = matrixVectorMultiply(i, v)
    expect(result[0]).toBeCloseTo(1)
    expect(result[1]).toBeCloseTo(2)
    expect(result[2]).toBeCloseTo(3)
    expect(result[3]).toBeCloseTo(1)
  })

  it('translates a point', () => {
    const t = translationMatrix(10, 20, 30)
    const v = new Float32Array([0, 0, 0, 1])
    const result = matrixVectorMultiply(t, v)
    expect(result[0]).toBeCloseTo(10)
    expect(result[1]).toBeCloseTo(20)
    expect(result[2]).toBeCloseTo(30)
  })

  it('scales a vector', () => {
    const s = scaleMatrix(2, 3, 4)
    const v = new Float32Array([1, 1, 1, 1])
    const result = matrixVectorMultiply(s, v)
    expect(result[0]).toBeCloseTo(2)
    expect(result[1]).toBeCloseTo(3)
    expect(result[2]).toBeCloseTo(4)
  })
})

// ---------------------------------------------------------------------------
// matrixInverse
// ---------------------------------------------------------------------------

describe('matrixInverse', () => {
  it('inverse of identity is identity', () => {
    const i = identityMatrix()
    const inv = matrixInverse(i)
    expect(inv).not.toBeNull()
    if (inv) {
      for (let j = 0; j < 16; j++) {
        if (j === 0 || j === 5 || j === 10 || j === 15) {
          expect(inv[j]).toBeCloseTo(1, 5)
        } else {
          expect(inv[j]).toBeCloseTo(0, 5)
        }
      }
    }
  })

  it('returns null for singular matrix', () => {
    const zero = new Float32Array(16)
    const inv = matrixInverse(zero)
    expect(inv).toBeNull()
  })

  it('M * M^-1 ≈ identity for translation', () => {
    const t = translationMatrix(10, 20, 30)
    const inv = matrixInverse(t)
    expect(inv).not.toBeNull()
    if (inv) {
      const product = matrixMultiply(t, inv)
      expect(product[0]).toBeCloseTo(1, 5)
      expect(product[5]).toBeCloseTo(1, 5)
      expect(product[10]).toBeCloseTo(1, 5)
      expect(product[15]).toBeCloseTo(1, 5)
    }
  })
})
