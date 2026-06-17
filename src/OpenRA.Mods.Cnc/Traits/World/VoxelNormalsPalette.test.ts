/**
 * VoxelNormalsPalette.test.ts — VoxelNormalsPalette unit tests
 */

import { describe, it, expect } from 'vitest'
import { VoxelNormalsPalette, PALETTE_SIZE, TS_NORMALS, RA2_NORMALS } from './VoxelNormalsPalette'
import { NormalType } from '../../FileFormats/VxlReader'

describe('VoxelNormalsPalette', () => {
  describe('construction', () => {
    it('creates TiberianSun palette', () => {
      const palette = new VoxelNormalsPalette('normals', NormalType.TiberianSun)
      expect(palette.name).toBe('normals')
      expect(palette.normalType).toBe(NormalType.TiberianSun)
      expect(palette.data).toHaveLength(PALETTE_SIZE)
    })

    it('creates RedAlert2 palette', () => {
      const palette = new VoxelNormalsPalette('normals', NormalType.RedAlert2)
      expect(palette.normalType).toBe(NormalType.RedAlert2)
      expect(palette.data).toHaveLength(PALETTE_SIZE)
    })
  })

  describe('getColor', () => {
    it('returns ARGB values for valid indices', () => {
      const palette = VoxelNormalsPalette.createTS()
      for (let i = 0; i < TS_NORMALS.length / 3; i++) {
        const color = palette.getColor(i)
        // Alpha should be 0xFF (fully opaque)
        expect((color >>> 24) & 0xff).toBe(0xff)
      }
    })

    it('returns 0xFF000000 for out-of-range indices (filled with black)', () => {
      const palette = VoxelNormalsPalette.createTS()
      const tsCount = TS_NORMALS.length / 3
      // Remaining palette entries should be 0xFF000000
      if (tsCount < PALETTE_SIZE) {
        const color = palette.getColor(tsCount)
        expect(color).toBe(0xff000000)
      }
    })

    it('throws for negative index', () => {
      const palette = VoxelNormalsPalette.createTS()
      expect(() => palette.getColor(-1)).toThrow(/out of range/)
    })

    it('throws for index >= PALETTE_SIZE', () => {
      const palette = VoxelNormalsPalette.createTS()
      expect(() => palette.getColor(PALETTE_SIZE)).toThrow(/out of range/)
    })
  })

  describe('factory methods', () => {
    it('createTS creates TiberianSun palette', () => {
      const palette = VoxelNormalsPalette.createTS()
      expect(palette.normalType).toBe(NormalType.TiberianSun)
    })

    it('createTS uses default name', () => {
      const palette = VoxelNormalsPalette.createTS()
      expect(palette.name).toBe('normals')
    })

    it('createTS accepts custom name', () => {
      const palette = VoxelNormalsPalette.createTS('customNormals')
      expect(palette.name).toBe('customNormals')
    })

    it('createRA2 creates RedAlert2 palette', () => {
      const palette = VoxelNormalsPalette.createRA2()
      expect(palette.normalType).toBe(NormalType.RedAlert2)
    })
  })

  describe('palette data', () => {
    it('TS palette has correct data length', () => {
      const palette = VoxelNormalsPalette.createTS()
      expect(palette.data).toHaveLength(PALETTE_SIZE)
    })

    it('RA2 palette has correct data length', () => {
      const palette = VoxelNormalsPalette.createRA2()
      expect(palette.data).toHaveLength(PALETTE_SIZE)
    })

    it('TS and RA2 palettes are different', () => {
      const ts = VoxelNormalsPalette.createTS()
      const ra2 = VoxelNormalsPalette.createRA2()
      // At least one entry should differ
      let different = false
      for (let i = 0; i < Math.min(TS_NORMALS.length, RA2_NORMALS.length) / 3; i++) {
        if (ts.data[i] !== ra2.data[i]) {
          different = true
          break
        }
      }
      expect(different).toBe(true)
    })
  })

  describe('PALETTE_SIZE constant', () => {
    it('is 256', () => {
      expect(PALETTE_SIZE).toBe(256)
    })
  })

  describe('normal vector tables', () => {
    it('TS_NORMALS has 36 entries (108 floats)', () => {
      expect(TS_NORMALS.length).toBe(108)
    })

    it('RA2_NORMALS has 244 entries (732 floats)', () => {
      expect(RA2_NORMALS.length).toBe(732)
    })
  })
})
