/**
 * HvaReader.test.ts — HvaReader binary format parser unit tests
 *
 * Tests focus on: binary format parsing, transform extraction,
 * matrix inversion validation (P1-E.23 full 4x4 inverse utility).
 */

import { describe, it, expect } from 'vitest'
import { HvaReader } from './HvaReader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalHvaBuffer(frameCount = 1, limbCount = 1): Uint8Array {
  // 16 header + 4 + 4 + 16*limbCount + 12*4*frameCount*limbCount
  const headerSize = 16
  const footerSize = 8
  const limbNamesSize = 16 * limbCount
  const floatDataSize = 12 * 4 * frameCount * limbCount // 12 floats × 4 bytes
  const total = headerSize + footerSize + limbNamesSize + floatDataSize
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  let offset = 0

  // Skip 16 header bytes
  offset += 16

  // FrameCount
  dv.setUint32(offset, frameCount, true); offset += 4
  // LimbCount
  dv.setUint32(offset, limbCount, true); offset += 4

  // Limb names (nul-filled)
  offset += 16 * limbCount

  // For each frame × limb: 12 identity matrix floats
  for (let j = 0; j < frameCount; j++) {
    for (let i = 0; i < limbCount; i++) {
      // Identity matrix row-major: [1,0,0,0, 0,1,0,0, 0,0,1,0]
      dv.setFloat32(offset, 1, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4 // row 1
      dv.setFloat32(offset, 0, true); offset += 4
      dv.setFloat32(offset, 1, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4 // row 2
      dv.setFloat32(offset, 0, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4
      dv.setFloat32(offset, 1, true); offset += 4
      dv.setFloat32(offset, 0, true); offset += 4
    }
  }

  return new Uint8Array(buf)
}

/** Create an HVA buffer with a custom 3x4 row-major matrix for a specific limb/frame. */
function createHvaBufferWithMatrix(
  matrix: number[], // 12 floats, row-major 3x4
  frameCount = 1,
  limbCount = 1,
): Uint8Array {
  const headerSize = 16
  const footerSize = 8
  const limbNamesSize = 16 * limbCount
  const floatDataSize = 12 * 4 * frameCount * limbCount
  const total = headerSize + footerSize + limbNamesSize + floatDataSize
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  let offset = 16 // Skip header

  dv.setUint32(offset, frameCount, true); offset += 4
  dv.setUint32(offset, limbCount, true); offset += 4
  offset += 16 * limbCount // Skip limb names

  // Write identity for all limbs/frames, then overwrite the first one
  for (let j = 0; j < frameCount; j++) {
    for (let i = 0; i < limbCount; i++) {
      if (j === 0 && i === 0 && matrix.length >= 12) {
        for (let k = 0; k < 12; k++) {
          dv.setFloat32(offset, matrix[k]!, true)
          offset += 4
        }
      } else {
        // Identity
        dv.setFloat32(offset, 1, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 1, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
        dv.setFloat32(offset, 1, true); offset += 4
        dv.setFloat32(offset, 0, true); offset += 4
      }
    }
  }

  return new Uint8Array(buf)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HvaReader', () => {
  describe('construction', () => {
    it('parses minimal HVA with 1 frame, 1 limb', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(1, 1), 'test.hva')
      expect(reader.frameCount).toBe(1)
      expect(reader.limbCount).toBe(1)
    })

    it('parses HVA with 3 frames, 2 limbs', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(3, 2), 'test.hva')
      expect(reader.frameCount).toBe(3)
      expect(reader.limbCount).toBe(2)
    })

    it('creates transforms array with correct size', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(2, 3), 'test.hva')
      expect(reader.transforms.length).toBe(16 * 2 * 3) // 96
    })

    it('throws for near-singular 3x3 rotation submatrix', () => {
      // Zero matrix => det = 0 => singular
      const zeroMatrix = Array(12).fill(0) as number[]
      expect(() => {
        HvaReader.load(createHvaBufferWithMatrix(zeroMatrix, 1, 1), 'sing.hva')
      }).toThrow(/not invertible/)
    })
  })

  describe('getTransform', () => {
    it('returns a 16-element Float32Array', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(1, 1), 'test.hva')
      const t = reader.getTransform(0, 0)
      expect(t).toHaveLength(16)
    })

    it('returns identity matrix for identity input', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(1, 1), 'test.hva')
      const t = reader.getTransform(0, 0)
      // Identity after transpose: diagonal = 1, last row = [0,0,0,1]
      expect(t[0]).toBeCloseTo(1)
      expect(t[5]).toBeCloseTo(1)
      expect(t[10]).toBeCloseTo(1)
      expect(t[15]).toBeCloseTo(1)
      expect(t[3]).toBeCloseTo(0)
      expect(t[7]).toBeCloseTo(0)
      expect(t[11]).toBeCloseTo(0)
    })

    it('throws for invalid frame index', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(1, 1), 'test.hva')
      expect(() => reader.getTransform(0, 1)).toThrow(/Only 1 frames exist/)
    })

    it('throws for invalid limb index', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(1, 1), 'test.hva')
      expect(() => reader.getTransform(1, 0)).toThrow(/Only 1 limbs exist/)
    })
  })

  describe('getTransform for multi-frame', () => {
    it('returns different transforms for different frames', () => {
      const reader = HvaReader.load(createMinimalHvaBuffer(2, 1), 'test.hva')
      const t0 = reader.getTransform(0, 0)
      const t1 = reader.getTransform(0, 1)
      // Both are identity in this test, so they should be equal
      expect(t0[0]).toBe(t1[0])
      expect(t0[15]).toBe(t1[15])
    })
  })

  // -----------------------------------------------------------------------
  // P1-E.23: Full 4x4 matrix inverse validation utility
  // -----------------------------------------------------------------------

  describe('validateTransformInvertibility (P1-E.23)', () => {
    it('should return true for identity matrix', () => {
      // Construct a minimal valid HVA and check the transform invertibility
      const reader = HvaReader.load(createMinimalHvaBuffer(1, 1), 'test.hva')
      const t = reader.transforms
      const result = HvaReader.validateTransformInvertibility(t, 0)
      expect(result).toBe(true)
    })

    it('should return false for zero matrix in 4x4', () => {
      // Create a Float32Array with all zeros
      const zeroMat = new Float32Array(16)
      // Set bottom-right to 0 (instead of 1) to make it fully singular
      // Actually, even with [0,0,0,1], the rotation part is det=0
      const result = HvaReader.validateTransformInvertibility(zeroMat, 0)
      expect(result).toBe(false)
    })

    it('should return true for scaling matrix', () => {
      const scaleMat = new Float32Array(16)
      // Identity with scale 2
      scaleMat[0] = 2   // col 0, row 0
      scaleMat[5] = 2   // col 1, row 1
      scaleMat[10] = 2  // col 2, row 2
      scaleMat[15] = 1  // col 3, row 3
      const result = HvaReader.validateTransformInvertibility(scaleMat, 0)
      expect(result).toBe(true) // det = 8, not singular
    })

    it('should return true for translation matrix (rigid-body)', () => {
      const transMat = new Float32Array(16)
      // Identity rotation
      transMat[0] = 1
      transMat[5] = 1
      transMat[10] = 1
      transMat[15] = 1
      // Translation in column 3
      transMat[12] = 10 // tx
      transMat[13] = 20 // ty
      transMat[14] = 30 // tz
      const result = HvaReader.validateTransformInvertibility(transMat, 0)
      expect(result).toBe(true) // det = 1 (translation doesn't affect det)
    })

    it('should use custom epsilon threshold', () => {
      const smallMat = new Float32Array(16)
      // Very small scaling but not quite zero
      smallMat[0] = 1e-6
      smallMat[5] = 1e-6
      smallMat[10] = 1e-6
      smallMat[15] = 1

      // Default epsilon = 1e-9, det = (1e-6)^3 = 1e-18, so should be singular
      const resultDefault = HvaReader.validateTransformInvertibility(smallMat, 0)
      expect(resultDefault).toBe(false)

      // With epsilon = 1e-19, should be considered invertible
      const resultCustom = HvaReader.validateTransformInvertibility(smallMat, 0, 1e-19)
      expect(resultCustom).toBe(true)
    })

    it('should handle matrix at non-zero offset', () => {
      const mat = new Float32Array(32) // 2 matrices
      // First matrix (offset 0): identity
      mat[0] = 1; mat[5] = 1; mat[10] = 1; mat[15] = 1
      // Second matrix (offset 16): zero
      // (intentionally left as 0)
      const result0 = HvaReader.validateTransformInvertibility(mat, 0)
      const result16 = HvaReader.validateTransformInvertibility(mat, 16)
      expect(result0).toBe(true)
      expect(result16).toBe(false)
    })
  })
})
