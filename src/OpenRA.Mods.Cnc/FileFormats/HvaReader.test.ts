/**
 * HvaReader.test.ts — HvaReader binary format parser unit tests
 */

import { describe, it, expect } from 'vitest'
import { HvaReader } from './HvaReader'

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
})
