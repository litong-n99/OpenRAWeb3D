/**
 * ChromeProvider.test.ts — ChromeProvider UI 皮肤资源管理器 单元测试
 *
 * 测试覆盖:
 * - PanelSides bitmask + hasSide 函数
 * - Collection 从 JSON 构造
 * - Collection 带 PanelRegion
 * - Collection 带 Regions
 * - ChromeProvider.initialize / deinitialize
 * - resolveImage DPI 选择
 * - getImage 返回 DPI 解析后的 URL
 * - getPanelRegion 返回区域或 null
 * - getPanelSliceCss 生成 CSS border-image-slice
 * - getPanelCss 生成 CSS border-image
 * - getMinimumPanelSize 计算最小尺寸
 * - setDPIScale 更新缩放
 * - 边界情况: 无效输入、缺失集合
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  PanelSides,
  hasSide,
  Collection,
  ChromeProvider,
} from './ChromeProvider.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  ChromeProvider.deinitialize()
})

afterEach(() => {
  ChromeProvider.deinitialize()
})

// ===========================================================================
// PanelSides & hasSide
// ===========================================================================

describe('PanelSides and hasSide', () => {
  it('PanelSides has correct values', () => {
    expect(PanelSides.Left).toBe(1)
    expect(PanelSides.Top).toBe(2)
    expect(PanelSides.Right).toBe(4)
    expect(PanelSides.Bottom).toBe(8)
    expect(PanelSides.Center).toBe(16)
    expect(PanelSides.Edges).toBe(15) // 1|2|4|8
    expect(PanelSides.All).toBe(31) // 1|2|4|8|16
  })

  it('hasSide returns true when side is present', () => {
    expect(hasSide(PanelSides.All, PanelSides.Left)).toBe(true)
    expect(hasSide(PanelSides.All, PanelSides.Top)).toBe(true)
    expect(hasSide(PanelSides.All, PanelSides.Right)).toBe(true)
    expect(hasSide(PanelSides.All, PanelSides.Bottom)).toBe(true)
    expect(hasSide(PanelSides.All, PanelSides.Center)).toBe(true)
  })

  it('hasSide returns true for Edges (composed bitmask)', () => {
    expect(hasSide(PanelSides.Edges, PanelSides.Left)).toBe(true)
    expect(hasSide(PanelSides.Edges, PanelSides.Center)).toBe(false)
  })

  it('hasSide returns false when side is not present', () => {
    expect(hasSide(PanelSides.Left, PanelSides.Right)).toBe(false)
    expect(hasSide(PanelSides.Top, PanelSides.Bottom)).toBe(false)
    expect(hasSide(PanelSides.Edges, PanelSides.Center)).toBe(false)
  })

  it('hasSide works with custom bitmask', () => {
    const custom = PanelSides.Left | PanelSides.Right // 5
    expect(hasSide(custom, PanelSides.Left)).toBe(true)
    expect(hasSide(custom, PanelSides.Right)).toBe(true)
    expect(hasSide(custom, PanelSides.Top)).toBe(false)
    expect(hasSide(custom, PanelSides.Bottom)).toBe(false)
  })

  it('hasSide returns true for empty side check (side=0)', () => {
    expect(hasSide(PanelSides.All, 0)).toBe(true)
    expect(hasSide(0, 0)).toBe(true)
  })
})

// ===========================================================================
// Collection
// ===========================================================================

describe('Collection', () => {
  it('constructs from JSON with basic properties', () => {
    const c = new Collection({
      Image: 'chrome/panel.png',
      Image2x: 'chrome/panel@2x.png',
      Image3x: 'chrome/panel@3x.png',
    })

    expect(c.image).toBe('chrome/panel.png')
    expect(c.image2x).toBe('chrome/panel@2x.png')
    expect(c.image3x).toBe('chrome/panel@3x.png')
    expect(c.panelRegion).toBeNull()
    expect(c.panelSides).toBe(PanelSides.All)
    expect(c.regions.size).toBe(0)
  })

  it('constructs with null images', () => {
    const c = new Collection({})
    expect(c.image).toBeNull()
    expect(c.image2x).toBeNull()
    expect(c.image3x).toBeNull()
  })

  it('constructs with PanelRegion array', () => {
    const c = new Collection({
      Image: 'dialog.png',
      PanelRegion: [0, 0, 50, 20, 100, 60, 50, 20],
      PanelSides: PanelSides.Edges,
    })

    expect(c.panelRegion).not.toBeNull()
    expect(c.panelRegion!.region).toEqual([0, 0, 50, 20, 100, 60, 50, 20])
    expect(c.panelRegion!.sides).toBe(PanelSides.Edges)
    expect(c.panelSides).toBe(PanelSides.Edges)
  })

  it('constructs with PanelRegion but defaults sides to All', () => {
    const c = new Collection({
      PanelRegion: [0, 0, 10, 10, 20, 20, 10, 10],
    })

    expect(c.panelSides).toBe(PanelSides.All)
    expect(c.panelRegion!.sides).toBe(PanelSides.All)
  })

  it('constructs with invalid PanelRegion length → null', () => {
    const c = new Collection({
      PanelRegion: [0, 0, 10, 10, 20], // Only 5 elements
    })

    expect(c.panelRegion).toBeNull()
  })

  it('constructs with Regions', () => {
    const c = new Collection({
      Regions: {
        'corner-tl': { X: 0, Y: 0, Width: 10, Height: 10 },
        'border-t': { X: 10, Y: 0, Width: 80, Height: 10 },
        'background': { X: 10, Y: 10, Width: 80, Height: 60 },
      },
    })

    expect(c.regions.size).toBe(3)
    expect(c.regions.get('corner-tl')).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    })
    expect(c.regions.get('border-t')!.width).toBe(80)
    expect(c.regions.get('background')!.height).toBe(60)
  })

  it('constructs with lowercase region keys', () => {
    const c = new Collection({
      Regions: {
        test: { x: 5, y: 10, width: 20, height: 30 },
      },
    })

    expect(c.regions.get('test')).toEqual({
      x: 5,
      y: 10,
      width: 20,
      height: 30,
    })
  })
})

// ===========================================================================
// ChromeProvider.initialize & deinitialize
// ===========================================================================

describe('ChromeProvider.initialize / deinitialize', () => {
  it('initialized is false before initialize', () => {
    expect(ChromeProvider.initialized).toBe(false)
  })

  it('deinitialize clears collections', () => {
    ChromeProvider.deinitialize()
    expect(ChromeProvider.collections.size).toBe(0)
    expect(ChromeProvider.dpiScale).toBe(1)
    expect(ChromeProvider.initialized).toBe(false)
  })

  it('deinitialize is safe when not initialized', () => {
    expect(() => ChromeProvider.deinitialize()).not.toThrow()
  })
})

// ===========================================================================
// resolveImage (DPI selection)
// ===========================================================================

describe('ChromeProvider.resolveImage', () => {
  beforeEach(() => {
    ChromeProvider.setDPIScale(1)
  })

  it('returns image1x when dpiScale=1', () => {
    const result = ChromeProvider.resolveImage('img.png', 'img@2x.png', 'img@3x.png')
    expect(result).toBe('img.png')
  })

  it('returns image2x when dpiScale>1 and <=2', () => {
    ChromeProvider.setDPIScale(1.5)
    const result = ChromeProvider.resolveImage('img.png', 'img@2x.png', 'img@3x.png')
    expect(result).toBe('img@2x.png')
  })

  it('returns image3x when dpiScale>2', () => {
    ChromeProvider.setDPIScale(2.5)
    const result = ChromeProvider.resolveImage('img.png', 'img@2x.png', 'img@3x.png')
    expect(result).toBe('img@3x.png')
  })

  it('falls back to image1x when image2x is null', () => {
    ChromeProvider.setDPIScale(2)
    const result = ChromeProvider.resolveImage('img.png', null, null)
    expect(result).toBe('img.png')
  })

  it('falls back to image2x when image3x is null at scale>2', () => {
    ChromeProvider.setDPIScale(3)
    const result = ChromeProvider.resolveImage('img.png', 'img@2x.png', null)
    expect(result).toBe('img@2x.png')
  })

  it('returns empty string when all images are null', () => {
    const result = ChromeProvider.resolveImage(null, null, null)
    expect(result).toBe('')
  })
})

// ===========================================================================
// getImage
// ===========================================================================

describe('ChromeProvider.getImage', () => {
  it('returns empty string for non-existent collection', () => {
    expect(ChromeProvider.getImage('nonexistent')).toBe('')
  })

  it('returns resolved image URL for existing collection', async () => {
    // Manually add a collection for testing
    const c = new Collection({
      Image: 'chrome/test.png',
      Image2x: 'chrome/test@2x.png',
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'test',
      c,
    )

    ChromeProvider.setDPIScale(1)
    expect(ChromeProvider.getImage('test')).toBe('chrome/test.png')

    ChromeProvider.setDPIScale(1.5)
    expect(ChromeProvider.getImage('test')).toBe('chrome/test@2x.png')
  })
})

// ===========================================================================
// getPanelRegion
// ===========================================================================

describe('ChromeProvider.getPanelRegion', () => {
  it('returns null for non-existent collection', () => {
    expect(ChromeProvider.getPanelRegion('missing')).toBeNull()
  })

  it('returns null for collection without PanelRegion', () => {
    const c = new Collection({ Image: 'test.png' })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'noPanel',
      c,
    )

    expect(ChromeProvider.getPanelRegion('noPanel')).toBeNull()
  })

  it('returns PanelRegion for collection with PanelRegion', () => {
    const c = new Collection({
      Image: 'dialog.png',
      PanelRegion: [0, 0, 50, 20, 100, 60, 50, 20],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'dialog',
      c,
    )

    const region = ChromeProvider.getPanelRegion('dialog')
    expect(region).not.toBeNull()
    expect(region!.region).toEqual([0, 0, 50, 20, 100, 60, 50, 20])
  })
})

// ===========================================================================
// getPanelSliceCss
// ===========================================================================

describe('ChromeProvider.getPanelSliceCss', () => {
  it('returns null for non-existent collection', () => {
    expect(ChromeProvider.getPanelSliceCss('missing')).toBeNull()
  })

  it('generates CSS border-image-slice from PanelRegion', () => {
    const c = new Collection({
      Image: 'dialog.png',
      // PanelRegion: [x, y, wTop, hTop, wCenter, hCenter, wBottom, hBottom]
      PanelRegion: [0, 0, 50, 20, 100, 60, 50, 20],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'dialog',
      c,
    )

    const css = ChromeProvider.getPanelSliceCss('dialog')
    // hTop=20, wRight=50(wBottom), hBottom=20, wLeft=50(wTop)
    expect(css).toBe('20 50 20 50 fill')
  })

  it('returns null for collection without PanelRegion', () => {
    const c = new Collection({ Image: 'test.png' })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'noRegion',
      c,
    )

    expect(ChromeProvider.getPanelSliceCss('noRegion')).toBeNull()
  })
})

// ===========================================================================
// getPanelCss
// ===========================================================================

describe('ChromeProvider.getPanelCss', () => {
  it('returns null for non-existent collection', () => {
    expect(ChromeProvider.getPanelCss('missing')).toBeNull()
  })

  it('generates full CSS border-image property', () => {
    const c = new Collection({
      Image: 'chrome/dialog.png',
      PanelRegion: [0, 0, 40, 15, 120, 80, 40, 15],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'dialog',
      c,
    )

    const css = ChromeProvider.getPanelCss('dialog')
    expect(css).toContain('url("chrome/dialog.png")')
    expect(css).toContain('15 40 15 40 fill') // hTop=15, wRight=40, hBottom=15, wLeft=40
    expect(css).toContain('stretch')
  })

  it('returns null when no image is set', () => {
    const c = new Collection({
      PanelRegion: [0, 0, 40, 15, 120, 80, 40, 15],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'noImage',
      c,
    )

    expect(ChromeProvider.getPanelCss('noImage')).toBeNull()
  })
})

// ===========================================================================
// getMinimumPanelSize
// ===========================================================================

describe('ChromeProvider.getMinimumPanelSize', () => {
  it('returns {0,0} for empty string', () => {
    expect(ChromeProvider.getMinimumPanelSize('')).toEqual({
      width: 0,
      height: 0,
    })
  })

  it('returns {0,0} for non-existent collection', () => {
    expect(ChromeProvider.getMinimumPanelSize('missing')).toEqual({
      width: 0,
      height: 0,
    })
  })

  it('returns {0,0} for collection without PanelRegion', () => {
    const c = new Collection({ Image: 'test.png' })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'noPanel',
      c,
    )

    expect(ChromeProvider.getMinimumPanelSize('noPanel')).toEqual({
      width: 0,
      height: 0,
    })
  })

  it('calculates minimum size from PanelRegion', () => {
    const c = new Collection({
      // PanelRegion: [x, y, wTop, hTop, wCenter, hCenter, wBottom, hBottom]
      PanelRegion: [0, 0, 50, 20, 100, 60, 50, 20],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'dialog',
      c,
    )

    const size = ChromeProvider.getMinimumPanelSize('dialog')
    // width = wTop + wBottom = 50 + 50 = 100
    // height = hTop + hBottom = 20 + 20 = 40
    expect(size).toEqual({ width: 100, height: 40 })
  })

  it('calculates minimum size for asymmetric borders', () => {
    const c = new Collection({
      PanelRegion: [0, 0, 30, 10, 200, 100, 60, 25],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'asymmetric',
      c,
    )

    const size = ChromeProvider.getMinimumPanelSize('asymmetric')
    expect(size).toEqual({ width: 90, height: 35 }) // 30+60, 10+25
  })
})

// ===========================================================================
// setDPIScale
// ===========================================================================

describe('ChromeProvider.setDPIScale', () => {
  it('updates dpiScale', () => {
    ChromeProvider.setDPIScale(2)
    expect(ChromeProvider.dpiScale).toBe(2)
  })

  it('skips if same scale', () => {
    ChromeProvider.setDPIScale(1.5)
    expect(ChromeProvider.dpiScale).toBe(1.5)
    // Setting same value should be a no-op
    ChromeProvider.setDPIScale(1.5)
    expect(ChromeProvider.dpiScale).toBe(1.5)
  })

  it('default dpiScale is 1', () => {
    expect(ChromeProvider.dpiScale).toBe(1)
  })
})

// ===========================================================================
// Edge cases
// ===========================================================================

describe('ChromeProvider edge cases', () => {
  it('getPanelSliceCss handles custom PanelRegion dimensions', () => {
    const c = new Collection({
      Image: 'custom.png',
      PanelRegion: [10, 5, 25, 12, 150, 80, 35, 18],
    })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set(
      'custom',
      c,
    )

    const css = ChromeProvider.getPanelSliceCss('custom')
    // hTop=12, wRight=35(wBottom), hBottom=18, wLeft=25(wTop)
    expect(css).toBe('12 35 18 25 fill')
  })

  it('collections is a readonly map after initialize', async () => {
    // Manual setup
    const c = new Collection({ Image: 'test.png' })
    ;(ChromeProvider as unknown as { _collections: Map<string, Collection> })._collections.set('a', c)

    expect(ChromeProvider.collections.size).toBe(1)
    expect(ChromeProvider.collections.get('a')).toBe(c)
    expect(ChromeProvider.collections.get('missing')).toBeUndefined()
  })
})
