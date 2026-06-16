/**
 * ImageWidget.test.ts -- ImageWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and default values
 * - Image URL resolution (ChromeProvider collection vs direct URL)
 * - GetImageName/GetImageCollection delegate behavior
 * - ClickThrough event handling
 * - Clone copy constructor
 * - Tooltip integration (mouse enter/exit)
 * - scaleTexture property
 * - DOM rendering (CSS background-image)
 * - No-image state (empty collection/image)
 */

import { describe, it, expect, vi } from 'vitest'
import { ImageWidget } from './ImageWidget.js'

// ---------------------------------------------------------------------------
// Mock ChromeProvider
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Graphics/ChromeProvider.js', () => ({
  ChromeProvider: {
    getImage: vi.fn((collection: string) => {
      if (collection === 'test-collection') return '/assets/test-collection.png'
      if (collection === 'icons') return '/assets/icons.png'
      return ''
    }),
  },
}))

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('ImageWidget -- construction', () => {
  it('creates with default values', () => {
    const w = new ImageWidget()
    expect(w.imageCollection).toBe('')
    expect(w.imageName).toBe('')
    expect(w.clickThrough).toBe(true)
    expect(w.scaleTexture).toBe(false)
    expect(w.tooltipTemplate).toBeNull()
    expect(w.tooltipContainerId).toBeNull()
    expect(w.tooltipText).toBeNull()
  })

  it('sets up getImageName delegate returning imageName by default', () => {
    const w = new ImageWidget()
    w.imageName = 'test.png'
    expect(w.getImageName()).toBe('test.png')
  })

  it('sets up getImageCollection delegate returning imageCollection by default', () => {
    const w = new ImageWidget()
    w.imageCollection = 'sprites'
    expect(w.getImageCollection()).toBe('sprites')
  })

  it('sets up getSprite delegate (initially null for no image)', () => {
    const w = new ImageWidget()
    // No collection -> no sprite
    expect(w.getSprite()).toBeNull()
  })

  it('sets up getTooltipText delegate with caching behavior', () => {
    const w = new ImageWidget()
    expect(w.getTooltipText!()).toBe('')

    w.tooltipText = 'Hello tooltip'
    expect(w.getTooltipText!()).toBe('Hello tooltip')

    w.tooltipText = ''
    expect(w.getTooltipText!()).toBe('')
  })

  it('getImageUrl returns empty string when no collection or name', () => {
    const w = new ImageWidget()
    expect(w.getImageUrl()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Tests: Image URL resolution
// ---------------------------------------------------------------------------

describe('ImageWidget -- image URL resolution', () => {
  it('resolves ChromeProvider collection image URL', () => {
    const w = new ImageWidget()
    w.imageCollection = 'test-collection'
    w.imageName = 'my-sprite'
    const url = w.getImageUrl()
    expect(url).toBe('/assets/test-collection.png')
  })

  it('returns empty string for unknown collection', () => {
    const w = new ImageWidget()
    w.imageCollection = 'non-existent'
    const url = w.getImageUrl()
    expect(url).toBe('')
  })

  it('uses imageName as direct URL when collection is empty', () => {
    const w = new ImageWidget()
    w.imageCollection = ''
    w.imageName = '/assets/direct-image.png'
    const url = w.getImageUrl()
    expect(url).toBe('/assets/direct-image.png')
  })

  it('caches URL until collection or name changes', () => {
    const w = new ImageWidget()
    w.imageCollection = 'icons'
    const url1 = w.getImageUrl()
    const url2 = w.getImageUrl()
    expect(url1).toBe(url2) // Cached

    // Change triggers cache invalidation
    w.imageCollection = 'test-collection'
    const url3 = w.getImageUrl()
    expect(url3).not.toBe(url1)
  })

  it('supports dynamic delegates for URL resolution', () => {
    const w = new ImageWidget()
    w.getImageCollection = () => 'icons'
    w.getImageName = () => 'star'
    const url = w.getImageUrl()
    expect(url).toBe('/assets/icons.png')
  })
})

// ---------------------------------------------------------------------------
// Tests: ClickThrough handling
// ---------------------------------------------------------------------------

describe('ImageWidget -- ClickThrough', () => {
  it('returns false from handleEvent when ClickThrough is true (default)', () => {
    const w = new ImageWidget()
    w.bounds = { x: 10, y: 10, width: 100, height: 100 }
    const event = {
      type: 'mousedown',
      clientX: 50,
      clientY: 50,
      button: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(false)
  })

  it('returns true when ClickThrough is false and click is inside bounds', () => {
    const w = new ImageWidget()
    w.clickThrough = false
    w.bounds = { x: 10, y: 10, width: 100, height: 100 }
    const event = {
      type: 'mousedown',
      clientX: 50,
      clientY: 50,
      button: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(true)
  })

  it('returns false when ClickThrough is false but click is outside bounds', () => {
    const w = new ImageWidget()
    w.clickThrough = false
    w.bounds = { x: 10, y: 10, width: 100, height: 100 }
    const event = {
      type: 'mousedown',
      clientX: 200,
      clientY: 200,
      button: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: Tooltip integration
// ---------------------------------------------------------------------------

describe('ImageWidget -- tooltip integration', () => {
  it('does nothing on mouseEntered when tooltipContainerId is null', () => {
    const w = new ImageWidget()
    w.tooltipContainerId = null
    w.getTooltipText = () => 'tip'

    // Should not throw
    expect(() => w.mouseEntered()).not.toThrow()
  })

  it('does nothing on mouseEntered when getTooltipText is null', () => {
    const w = new ImageWidget()
    w.tooltipContainerId = 'tooltip-panel'
    w.getTooltipText = null

    // Should not throw
    expect(() => w.mouseEntered()).not.toThrow()
  })

  it('calls tooltip container on mouseEntered when configured', () => {
    const w = new ImageWidget()
    w.tooltipContainerId = 'tooltip-panel'
    w.tooltipTemplate = 'MY_TOOLTIP'
    w.getTooltipText = () => 'Custom tip text'

    const mockContainer = {
      setTooltip: vi.fn(),
      removeTooltip: vi.fn(),
    }

    w.setTooltipContainerResolver(() => mockContainer)
    w.mouseEntered()

    expect(mockContainer.setTooltip).toHaveBeenCalledWith(
      'MY_TOOLTIP',
      expect.objectContaining({ getText: expect.any(Function) }),
    )
  })

  it('does nothing on mouseExited when tooltipContainerId is null', () => {
    const w = new ImageWidget()
    w.tooltipContainerId = null
    expect(() => w.mouseExited()).not.toThrow()
  })

  it('calls removeTooltip on mouseExited when container was created', () => {
    const w = new ImageWidget()
    w.tooltipContainerId = 'tooltip-panel'
    w.getTooltipText = () => 'tip'

    const mockContainer = {
      setTooltip: vi.fn(),
      removeTooltip: vi.fn(),
    }

    w.setTooltipContainerResolver(() => mockContainer)
    w.mouseEntered()
    w.mouseExited()

    expect(mockContainer.removeTooltip).toHaveBeenCalled()
  })

  it('does not call removeTooltip on mouseExited if container not yet created', () => {
    const w = new ImageWidget()
    w.tooltipContainerId = 'tooltip-panel'
    w.getTooltipText = () => 'tip'

    const mockContainer = {
      setTooltip: vi.fn(),
      removeTooltip: vi.fn(),
    }

    w.setTooltipContainerResolver(() => mockContainer)
    // Don't call mouseEntered first
    w.mouseExited()

    expect(mockContainer.removeTooltip).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('ImageWidget -- Clone', () => {
  it('creates a deep copy with independent properties', () => {
    const w = new ImageWidget()
    w.id = 'img1'
    w.imageCollection = 'sprites'
    w.imageName = 'hero'
    w.clickThrough = false
    w.scaleTexture = true
    w.tooltipText = 'Click me'
    w.bounds = { x: 10, y: 20, width: 64, height: 64 }

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(ImageWidget)
    expect(cloned.id).toBe('img1')
    expect(cloned.imageCollection).toBe('sprites')
    expect(cloned.imageName).toBe('hero')
    expect(cloned.clickThrough).toBe(false)
    expect(cloned.scaleTexture).toBe(true)
    expect(cloned.bounds).toEqual({ x: 10, y: 20, width: 64, height: 64 })

    // Independence: modifying clone does not affect original
    cloned.imageName = 'villain'
    expect(w.imageName).toBe('hero')
    expect(cloned.imageName).toBe('villain')
  })

  it('clones with child widgets', () => {
    const parent = new ImageWidget()
    const child = new ImageWidget()
    child.id = 'child-img'
    parent.addChild(child)

    const cloned = parent.clone()
    expect(cloned.children.length).toBe(1)
    expect(cloned.children[0].id).toBe('child-img')
    expect(cloned.children[0]).toBeInstanceOf(ImageWidget)
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('ImageWidget -- DOM rendering', () => {
  it('renders as a div with image-widget class', () => {
    const w = new ImageWidget()
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('image-widget')
  })

  it('sets pointer-events: none when ClickThrough is true', () => {
    const w = new ImageWidget()
    w.clickThrough = true
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.style.pointerEvents).toBe('none')
  })

  it('clears pointer-events when ClickThrough is false', () => {
    const w = new ImageWidget()
    w.clickThrough = false
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.style.pointerEvents).toBe('')
  })

  it('applies background-image CSS when image URL is available', () => {
    const w = new ImageWidget()
    w.imageCollection = 'test-collection'
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.style.backgroundImage).toContain('test-collection.png')
    expect(el.style.backgroundRepeat).toBe('no-repeat')
    // happy-dom may expand 'center' to 'center center'
    expect(el.style.backgroundPosition).toContain('center')
  })

  it('uses background-size: cover when scaleTexture is true', () => {
    const w = new ImageWidget()
    w.imageCollection = 'test-collection'
    w.scaleTexture = true
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.style.backgroundSize).toBe('cover')
  })

  it('uses background-size: contain when scaleTexture is false', () => {
    const w = new ImageWidget()
    w.imageCollection = 'test-collection'
    w.scaleTexture = false
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.style.backgroundSize).toBe('contain')
  })

  it('clears background-image when no image is available', () => {
    const w = new ImageWidget()
    w.imageCollection = ''
    w.imageName = ''
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.style.backgroundImage).toBe('')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new ImageWidget()
    w.id = 'my-image'
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('my-image')
  })
})
