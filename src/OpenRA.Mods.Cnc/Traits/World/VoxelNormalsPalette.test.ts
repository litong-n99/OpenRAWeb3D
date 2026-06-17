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

  // -----------------------------------------------------------------------
  // Audit tests (MAJOR 9 — R1 review)
  // Verifies the generated ARGB palette values match C# computation
  // -----------------------------------------------------------------------

  describe('palette generation audit (MAJOR 9)', () => {
    it('generates correct ARGB for first TS normal',
      () => {
        const palette = VoxelNormalsPalette.createTS()
        // TS_NORMALS[0..2] = [0.671214, 0.198492, -0.714194]
        // channel: R=Z=-0.714194 → ( -0.714194+1)/2*255=36.44 → 36 → 0x24
        // channel: G=Y= 0.198492 → (  0.198492+1)/2*255=152.81→153 → 0x99
        // channel: B=X= 0.671214 → (  0.671214+1)/2*255=213.08→213 → 0xD5
        // ARGB: 0xFF << 24 | 0x24 << 16 | 0x99 << 8 | 0xD5 = 0xFF2499D5
        const color = palette.getColor(0)
        const a = (color >>> 24) & 0xff
        const r = (color >>> 16) & 0xff
        const g = (color >>> 8) & 0xff
        const b = color & 0xff
        expect(a).toBe(0xff)
        expect(r).toBe(36)   // Z component → R
        expect(g).toBe(153)  // Y component → G
        expect(b).toBe(213)  // X component → B
      })

    it('all generated entries have alpha = 0xFF', () => {
      const palette = VoxelNormalsPalette.createRA2()
      for (let i = 0; i < PALETTE_SIZE; i++) {
        expect((palette.data[i] >>> 24) & 0xff).toBe(0xff)
      }
    })

    it('all generated entries have R,G,B in valid range', () => {
      const palette = VoxelNormalsPalette.createTS()
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const r = (palette.data[i] >>> 16) & 0xff
        const g = (palette.data[i] >>> 8) & 0xff
        const b = palette.data[i] & 0xff
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThanOrEqual(255)
        expect(g).toBeGreaterThanOrEqual(0)
        expect(g).toBeLessThanOrEqual(255)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThanOrEqual(255)
      }
    })

    it('unused palette entries are opaque black (0xFF000000)', () => {
      const palette = VoxelNormalsPalette.createTS()
      const tsCount = TS_NORMALS.length / 3 // 36
      for (let i = tsCount; i < PALETTE_SIZE; i++) {
        expect(palette.data[i]).toBe(0xff000000)
      }
    })

    it('unused RA2 palette entries are opaque black', () => {
      const palette = VoxelNormalsPalette.createRA2()
      const ra2Count = RA2_NORMALS.length / 3 // 244
      for (let i = ra2Count; i < PALETTE_SIZE; i++) {
        expect(palette.data[i]).toBe(0xff000000)
      }
    })

    it('last 4 RA2 normals are the same (padding duplicates)', () => {
      // The last 4 entries repeat [-0.328188, 0.140251, 0.934143]
      const palette = VoxelNormalsPalette.createRA2()
      // Entries 240-243 (last 4) should produce the same color
      const c240 = palette.getColor(240)
      const c241 = palette.getColor(241)
      const c242 = palette.getColor(242)
      const c243 = palette.getColor(243)
      expect(c240).toBe(c241)
      expect(c241).toBe(c242)
      expect(c242).toBe(c243)
    })
  })
})
