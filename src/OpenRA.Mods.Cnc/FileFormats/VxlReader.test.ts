/**
 * VxlReader.test.ts — VxlReader binary format parser unit tests
 */

import { describe, it, expect } from 'vitest'
import { VxlReader, NormalType, VxlLimb } from './VxlReader'

describe('VxlReader', () => {
  describe('construction', () => {
    it('throws on invalid header', () => {
      const buf = new Uint8Array(100)
      expect(() => VxlReader.load(buf)).toThrow(/Invalid vxl header/)
    })
  })

  describe('VxlLimb structure', () => {
    it('creates empty VxlLimb with defaults', () => {
      const limb = new VxlLimb()
      expect(limb.name).toBe('')
      expect(limb.scale).toBe(0)
      expect(limb.voxelCount).toBe(0)
      expect(limb.type).toBe(NormalType.TiberianSun)
      expect(limb.bounds).toBeInstanceOf(Float32Array)
      expect(limb.bounds).toHaveLength(6)
      expect(limb.size).toBeInstanceOf(Uint8Array)
      expect(limb.size).toHaveLength(3)
    })

    it('allows setting limb properties', () => {
      const limb = new VxlLimb()
      limb.name = 'body'
      limb.scale = 2.5
      limb.type = NormalType.RedAlert2
      limb.voxelCount = 42
      limb.bounds[0] = -5
      limb.bounds[3] = 5
      limb.size[0] = 20
      expect(limb.name).toBe('body')
      expect(limb.scale).toBe(2.5)
      expect(limb.type).toBe(4)
      expect(limb.voxelCount).toBe(42)
      expect(limb.bounds[0]).toBe(-5)
      expect(limb.size[0]).toBe(20)
    })

    it('voxelMap starts as empty array', () => {
      const limb = new VxlLimb()
      expect(limb.voxelMap).toEqual([])
    })
  })

  describe('NormalType', () => {
    it('TiberianSun is 2', () => {
      expect(NormalType.TiberianSun).toBe(2)
    })

    it('RedAlert2 is 4', () => {
      expect(NormalType.RedAlert2).toBe(4)
    })
  })
})
