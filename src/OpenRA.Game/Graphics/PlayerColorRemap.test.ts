/**
 * PlayerColorRemap.test.ts — PlayerColorRemap 单元测试
 *
 * 测试玩家颜色重映射逻辑：构造、索引筛选、HSV 颜色替换、边界情况。
 *
 * PlayerColorRemap 仅使用 Color.ts 中的纯数学函数（无 Babylon.js 依赖）。
 */

import { describe, it, expect } from 'vitest'
import { PlayerColorRemap } from './PlayerColorRemap'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Color {
  r: number
  g: number
  b: number
  a: number
}

/** Create a simple opaque color */
function rgb(r: number, g: number, b: number): Color {
  return { r, g, b, a: 255 }
}

/** Create a color with alpha */
function rgba(r: number, g: number, b: number, a: number): Color {
  return { r, g, b, a }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlayerColorRemap', () => {
  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('creates with remap indices and player color', () => {
      const indices = [1, 2, 3]
      const playerColor = rgb(255, 0, 0) // Red player
      const remap = new PlayerColorRemap(indices, playerColor)
      // Construction should not throw
      expect(remap).toBeDefined()
    })

    it('handles empty remap indices', () => {
      const remap = new PlayerColorRemap([], rgb(255, 0, 0))
      expect(remap).toBeDefined()
    })

    it('stores HSV values from linear player color', () => {
      // Blue player color → HSV in linear space
      const remap = new PlayerColorRemap([1], rgb(0, 0, 255))
      // Construction extracts HSV from linearized color
      // Should not throw for any valid color
      expect(remap).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // getRemappedColor — 索引筛选
  // -----------------------------------------------------------------------

  describe('getRemappedColor index filtering', () => {
    it('returns original color when index is NOT in remapIndices', () => {
      const remap = new PlayerColorRemap([5, 6, 7], rgb(255, 0, 0))
      const original = rgb(100, 150, 200)
      const result = remap.getRemappedColor(original, 0) // index 0 not in [5,6,7]
      expect(result).toEqual(original)
    })

    it('returns remapped color when index IS in remapIndices', () => {
      const remap = new PlayerColorRemap([0, 1, 2], rgb(255, 0, 0))
      const original = rgb(100, 150, 200)
      const result = remap.getRemappedColor(original, 0) // index 0 IS in list
      // Result should be different from original (color was remapped)
      // Check that at least one channel changed
      const changed = result.r !== original.r
        || result.g !== original.g
        || result.b !== original.b
      expect(changed).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // getRemappedColor — 颜色变换（HSV 替换 + 亮度保留）
  // -----------------------------------------------------------------------

  describe('getRemappedColor color transformation', () => {
    it('preserves original alpha', () => {
      const remap = new PlayerColorRemap([0], rgb(255, 0, 0))
      const original = rgba(128, 128, 128, 200)
      const result = remap.getRemappedColor(original, 0)
      // Alpha should be preserved
      expect(result.a).toBe(200)
    })

    it('applies player hue to remapped colors', () => {
      // Red player (hue=0, sat=1)
      const remap = new PlayerColorRemap([0], rgb(255, 0, 0))
      // Green original → should become reddish
      const original = rgb(0, 255, 0)
      const result = remap.getRemappedColor(original, 0)

      // After HSV remap with red player color:
      // Original green (hue≈1/3) is replaced with player hue (hue≈0=red)
      // So result should have more red than green
      // NOTE: The actual values depend on the brightness scaling,
      // but the red channel should be significantly higher than green
      const isReddish = result.r > result.g
      // Not strictly required for all colors, but typical for this test case
      expect(isReddish).toBe(true)
    })

    it('scales value by brightness of original', () => {
      // Red player color
      const remap = new PlayerColorRemap([0], rgb(255, 0, 0))

      // Dark original (low brightness)
      const darkOriginal = rgb(50, 50, 50)
      const darkResult = remap.getRemappedColor(darkOriginal, 0)

      // Bright original (high brightness)
      const brightOriginal = rgb(200, 200, 200)
      const brightResult = remap.getRemappedColor(brightOriginal, 0)

      // Bright result should be brighter than dark result
      const darkBrightness = (darkResult.r + darkResult.g + darkResult.b) / 3
      const brightBrightness = (brightResult.r + brightResult.g + brightResult.b) / 3
      expect(brightBrightness).toBeGreaterThan(darkBrightness)
    })
  })

  // -----------------------------------------------------------------------
  // 边界情况
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles fully transparent original', () => {
      const remap = new PlayerColorRemap([0], rgb(255, 0, 0))
      const original = rgba(0, 0, 0, 0)
      const result = remap.getRemappedColor(original, 0)
      // For zero alpha, toLinear returns {r:0, g:0, b:0}
      // Then value = max(0,0,0) = 0, so result RGB should also be 0
      // But fromLinear with a=0 gives premultiplied zero
      expect(result.a).toBe(0)
      expect(result.r).toBe(0)
      expect(result.g).toBe(0)
      expect(result.b).toBe(0)
    })

    it('handles grayscale original (hue=0, sat=0)', () => {
      const remap = new PlayerColorRemap([0], rgb(255, 0, 0))
      const original = rgb(128, 128, 128) // Grayscale
      const result = remap.getRemappedColor(original, 0)
      // Result should be valid color (no NaN)
      expect(isNaN(result.r)).toBe(false)
      expect(isNaN(result.g)).toBe(false)
      expect(isNaN(result.b)).toBe(false)
    })

    it('handles black original', () => {
      const remap = new PlayerColorRemap([0], rgb(255, 200, 0))
      const original = rgb(0, 0, 0)
      const result = remap.getRemappedColor(original, 0)
      // Black → value=0 → output should be black (or very dark)
      expect(result.r).toBe(0)
      expect(result.g).toBe(0)
      expect(result.b).toBe(0)
    })

    it('handles white original', () => {
      const remap = new PlayerColorRemap([0], rgb(0, 0, 255))
      const original = rgb(255, 255, 255)
      const result = remap.getRemappedColor(original, 0)
      // White → maximum brightness → should take player color at full brightness
      // Result should be valid (not NaN, not out of range)
      expect(result.r).toBeGreaterThanOrEqual(0)
      expect(result.r).toBeLessThanOrEqual(255)
      expect(result.g).toBeGreaterThanOrEqual(0)
      expect(result.g).toBeLessThanOrEqual(255)
      expect(result.b).toBeGreaterThanOrEqual(0)
      expect(result.b).toBeLessThanOrEqual(255)
    })
  })
})
