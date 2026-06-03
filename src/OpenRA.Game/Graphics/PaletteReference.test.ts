/**
 * PaletteReference.test.ts — PaletteReference 单元测试
 *
 * 测试 PaletteReference 的创建、属性访问和 hasColorShift 查询。
 */

import { describe, it, expect } from 'vitest'
import { PaletteReference } from './PaletteReference'
import type { IPalette } from './Palette'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createTestPalette(): IPalette {
  return {
    at(_index: number): number { return 0xffffffff },
    copyToArray(_destination: Uint32Array, _destinationOffset: number): void {
      // no-op for tests
    },
  }
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

describe('PaletteReference construction', () => {
  it('stores name, textureIndex, and palette', () => {
    const palette = createTestPalette()
    const ref = new PaletteReference('testPal', 1, palette)
    expect(ref.name).toBe('testPal')
    expect(ref.textureIndex).toBe(1)
    expect(ref.palette).toBe(palette)
  })

  it('accepts hardwarePalette as fourth parameter', () => {
    const palette = createTestPalette()
    // Use a minimal mock for HardwarePalette
    const mockHP = {
      hasColorShift: () => true,
    } as any

    // HACK: cast mock hardwarePalette — only need hasColorShift for tests
    const ref = new PaletteReference('colorShiftPal', 2, palette, mockHP as any)
    expect(ref.name).toBe('colorShiftPal')
    expect(ref.textureIndex).toBe(2)
  })

  it('allows palette to be replaced', () => {
    const palette1 = createTestPalette()
    const palette2 = createTestPalette()
    const ref = new PaletteReference('replaceable', 3, palette1)

    expect(ref.palette).toBe(palette1)
    ref.palette = palette2
    expect(ref.palette).toBe(palette2)
  })
})

// ---------------------------------------------------------------------------
// hasColorShift
// ---------------------------------------------------------------------------

describe('PaletteReference.hasColorShift', () => {
  it('returns false when hardwarePalette is null', () => {
    const palette = createTestPalette()
    const ref = new PaletteReference('noHp', 0, palette, null)
    expect(ref.hasColorShift).toBe(false)
  })

  it('returns false when hardwarePalette reports no color shift', () => {
    const palette = createTestPalette()
    const mockHP = {
      hasColorShift: (_name: string) => false,
    }
    const ref = new PaletteReference('noShift', 1, palette, mockHP as any)
    expect(ref.hasColorShift).toBe(false)
  })

  it('returns true when hardwarePalette reports color shift', () => {
    const palette = createTestPalette()
    const mockHP = {
      hasColorShift: (_name: string) => true,
    }
    const ref = new PaletteReference('hasShift', 2, palette, mockHP as any)
    expect(ref.hasColorShift).toBe(true)
  })
})
