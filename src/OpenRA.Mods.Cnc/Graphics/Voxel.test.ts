/**
 * Voxel.test.ts — Voxel model unit tests
 */

import { describe, it, expect } from 'vitest'
import { Voxel } from './Voxel'
import { HvaReader } from '../FileFormats/HvaReader'
import { Rectangle } from '../../OpenRA.Game/Primitives/Rectangle'

function createTestHva(): HvaReader {
  // Create a valid rigid-body transform (3x3 identity rotation + zero translation)
  // 12 floats in row-major 3x4 layout: [1,0,0,0, 0,1,0,0, 0,0,1,0]
  const buf = new ArrayBuffer(16 + 8 + 16 + 12 * 4) // 88 bytes
  const dv = new DataView(buf)
  let offset = 16
  dv.setUint32(offset, 1, true); offset += 4  // frameCount = 1
  dv.setUint32(offset, 1, true); offset += 4  // limbCount = 1
  offset += 16  // skip limb names (16 bytes)
  // Row-major 3x4 identity: row0=[1,0,0,0], row1=[0,1,0,0], row2=[0,0,1,0]
  dv.setFloat32(offset, 1, true); offset += 4  // row0col0 = 1
  dv.setFloat32(offset, 0, true); offset += 4  // row0col1 = 0
  dv.setFloat32(offset, 0, true); offset += 4  // row0col2 = 0
  dv.setFloat32(offset, 0, true); offset += 4  // row0col3 = 0
  dv.setFloat32(offset, 0, true); offset += 4  // row1col0 = 0
  dv.setFloat32(offset, 1, true); offset += 4  // row1col1 = 1
  dv.setFloat32(offset, 0, true); offset += 4  // row1col2 = 0
  dv.setFloat32(offset, 0, true); offset += 4  // row1col3 = 0
  dv.setFloat32(offset, 0, true); offset += 4  // row2col0 = 0
  dv.setFloat32(offset, 0, true); offset += 4  // row2col1 = 0
  dv.setFloat32(offset, 1, true); offset += 4  // row2col2 = 1
  dv.setFloat32(offset, 0, true); offset += 4  // row2col3 = 0
  return HvaReader.load(new Uint8Array(buf), 'test.hva')
}

describe('Voxel', () => {
  describe('construction', () => {
    it('creates with single limb', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )
      expect(voxel.frames).toBe(1)
      expect(voxel.sections).toBe(1)
    })

    it('throws if limb counts mismatch', () => {
      const hva = createTestHva()
      expect(() => new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1]), new Float32Array([0, 0, 0, 2, 2, 2])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )).toThrow(/doesn't match/)
    })
  })

  describe('frames and sections', () => {
    it('reports correct frame and section counts', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )
      expect(voxel.frames).toBe(1)
      expect(voxel.sections).toBe(1)
    })
  })

  describe('transformationMatrix', () => {
    it('returns 16-element Float32Array', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )
      const t = voxel.transformationMatrix(0, 0)
      expect(t).toHaveLength(16)
    })

    it('throws for invalid frame index', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )
      expect(() => voxel.transformationMatrix(0, 1)).toThrow(/Only 1 frames exist/)
    })

    it('throws for invalid limb index', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )
      expect(() => voxel.transformationMatrix(1, 0)).toThrow(/Only 1 limbs exist/)
    })
  })

  describe('size', () => {
    it('computes size as max of scaled limb dimensions', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 3, 4])],
        [2],
        [{ start: 0, count: 4 }],
      )
      const s = voxel.size
      expect(s[0]).toBe(4) // 2 * 2
      expect(s[1]).toBe(6) // 2 * 3
      expect(s[2]).toBe(8) // 2 * 4
    })

    it('memoizes size result', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([1, 1, 1])],
        [1],
        [{ start: 0, count: 4 }],
      )
      const s1 = voxel.size
      const s2 = voxel.size
      expect(s1).toBe(s2) // Same reference (memoized)
    })
  })

  describe('bounds', () => {
    it('returns 6-element Float32Array', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([2, 2, 2])],
        [1],
        [{ start: 0, count: 4 }],
      )
      const b = voxel.bounds(0)
      expect(b).toHaveLength(6)
    })
  })

  describe('renderData', () => {
    it('returns the render data for the limb', () => {
      const hva = createTestHva()
      const rd = { start: 10, count: 6 }
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([1, 1, 1])],
        [1],
        [rd],
      )
      const result = voxel.renderData(0)
      expect(result.start).toBe(10)
      expect(result.count).toBe(6)
    })
  })

  describe('aggregateBounds', () => {
    it('returns a Rectangle', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([1, 1, 1])],
        [1],
        [{ start: 0, count: 4 }],
      )
      const bounds = voxel.aggregateBounds
      expect(bounds).toBeInstanceOf(Rectangle)
    })

    it('memoizes aggregateBounds', () => {
      const hva = createTestHva()
      const voxel = new Voxel(
        hva,
        [new Float32Array([-1, -1, -1, 1, 1, 1])],
        [new Uint8Array([1, 1, 1])],
        [1],
        [{ start: 0, count: 4 }],
      )
      const b1 = voxel.aggregateBounds
      const b2 = voxel.aggregateBounds
      expect(b1).toBe(b2)
    })
  })
})
