/**
 * ResourcePreviewWidget.test.ts — ResourcePreviewWidget migration unit tests
 *
 * Tests focus on: resource type assignment, density clamping, canvas rendering,
 * clone correctness, and state management.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ResourcePreviewWidget,
  type IResourceRenderer,
  type IResourceSpriteInfo,
} from './ResourcePreviewWidget.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock resource renderer for testing. */
function createMockRenderer(
  resourceTypes: string[],
  spriteInfo?: IResourceSpriteInfo,
): IResourceRenderer {
  return {
    resourceTypes,
    renderPreview(_renderer: unknown, _resourceType: string, _scale: number) {
      return spriteInfo ?? null
    },
  }
}

/** Create a minimal mock HTMLImageElement-like object. */
function createMockImage(): HTMLImageElement {
  // In happy-dom, HTMLImageElement exists but width/height need to be set
  const img = new Image()
  Object.defineProperty(img, 'width', { value: 24, writable: true })
  Object.defineProperty(img, 'height', { value: 24, writable: true })
  return img
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResourcePreviewWidget', () => {
  let widget: ResourcePreviewWidget

  beforeEach(() => {
    widget = new ResourcePreviewWidget()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create with default values', () => {
      expect(widget.scale).toBe(1)
      expect(widget.resourceType).toBeNull()
      expect(widget.density).toBe(0)
      expect(widget.idealPreviewSize.width).toBe(32)
      expect(widget.idealPreviewSize.height).toBe(32)
      expect(widget.resourceRenderers).toEqual([])
    })

    it('should accept constructor parameters', () => {
      const renderers = [createMockRenderer(['ore'])]
      const tileSize = { width: 32, height: 32 }
      const widget2 = new ResourcePreviewWidget(renderers, tileSize, 2)

      expect(widget2.resourceRenderers).toEqual(renderers)
      expect(widget2.tileSize).toEqual(tileSize)
      expect(widget2.defaultScale).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // setResourceType
  // -----------------------------------------------------------------------

  describe('setResourceType', () => {
    it('should set resourceType to null (no renderer)', () => {
      widget.setResourceType(null)
      expect(widget.resourceType).toBeNull()
    })

    it('should set resourceType to null and reset renderer', () => {
      // First set a resource type
      const renderers = [createMockRenderer(['ore'])]
      widget.resourceRenderers = renderers
      widget.setResourceType('ore')
      expect(widget.resourceType).toBe('ore')

      // Then clear it
      widget.setResourceType(null)
      expect(widget.resourceType).toBeNull()
    })

    it('should find matching renderer for resource type', () => {
      const mockImg = createMockImage()
      const spriteInfo: IResourceSpriteInfo = {
        image: mockImg,
        srcX: 0,
        srcY: 0,
        srcWidth: 24,
        srcHeight: 24,
      }
      const renderers = [createMockRenderer(['ore', 'gems'], spriteInfo)]
      widget.resourceRenderers = renderers
      widget.setResourceType('ore')

      expect(widget.resourceType).toBe('ore')
    })

    it('should not find renderer for unknown resource type', () => {
      const renderers = [createMockRenderer(['ore'])]
      widget.resourceRenderers = renderers
      widget.setResourceType('gems')

      expect(widget.resourceType).toBe('gems')
      // idealPreviewSize should default to tileSize * defaultScale
      expect(widget.idealPreviewSize.width).toBe(
        widget.tileSize.width * widget.defaultScale,
      )
    })

    it('should update idealPreviewSize from sprite info', () => {
      const mockImg = createMockImage()
      const spriteInfo: IResourceSpriteInfo = {
        image: mockImg,
        srcX: 0,
        srcY: 0,
        srcWidth: 48,
        srcHeight: 48,
      }
      const renderers = [createMockRenderer(['ore'], spriteInfo)]
      widget.resourceRenderers = renderers
      widget.setResourceType('ore')

      // Should match or exceed tileSize * defaultScale
      expect(widget.idealPreviewSize.width).toBeGreaterThanOrEqual(24)
      expect(widget.idealPreviewSize.height).toBeGreaterThanOrEqual(24)
    })
  })

  // -----------------------------------------------------------------------
  // setDensity
  // -----------------------------------------------------------------------

  describe('setDensity', () => {
    it('should set density value', () => {
      widget.setDensity(50)
      expect(widget.density).toBe(50)
    })

    it('should clamp density to 0-100', () => {
      widget.setDensity(-10)
      expect(widget.density).toBe(0)

      widget.setDensity(150)
      expect(widget.density).toBe(100)

      widget.setDensity(33.7)
      expect(widget.density).toBe(34) // rounds
    })

    it('should accept 0', () => {
      widget.setDensity(0)
      expect(widget.density).toBe(0)
    })

    it('should accept 100', () => {
      widget.setDensity(100)
      expect(widget.density).toBe(100)
    })
  })

  // -----------------------------------------------------------------------
  // render
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('should return a div element', () => {
      const el = widget.render()
      expect(el.tagName).toBe('DIV')
      expect(el.className).toBe('resource-preview-widget')
    })

    it('should return a canvas when resource type is set', () => {
      const mockImg = createMockImage()
      const spriteInfo: IResourceSpriteInfo = {
        image: mockImg,
        srcX: 0,
        srcY: 0,
        srcWidth: 24,
        srcHeight: 24,
      }
      widget.resourceRenderers = [createMockRenderer(['ore'], spriteInfo)]
      widget.setResourceType('ore')
      widget.setDensity(50)

      const el = widget.render()
      const canvas = el.querySelector('canvas')
      expect(canvas).not.toBeNull()
      expect(canvas!.width).toBeGreaterThan(0)
      expect(canvas!.height).toBeGreaterThan(0)
    })

    it('should return a canvas even without resource renderer (fallback)', () => {
      widget.setResourceType('unknown')
      widget.setDensity(50)

      const el = widget.render()
      const canvas = el.querySelector('canvas')
      expect(canvas).not.toBeNull()
    })

    it('should use getOrCreateElement for caching', () => {
      const el1 = widget.render()
      const el2 = widget.render()
      expect(el1).toBe(el2) // Same element reference
    })
  })

  // -----------------------------------------------------------------------
  // clone
  // -----------------------------------------------------------------------

  describe('clone', () => {
    it('should create a clone with same properties', () => {
      const mockImg = createMockImage()
      const spriteInfo: IResourceSpriteInfo = {
        image: mockImg,
        srcX: 0,
        srcY: 0,
        srcWidth: 24,
        srcHeight: 24,
      }
      widget.resourceRenderers = [createMockRenderer(['ore'], spriteInfo)]
      widget.id = 'test-preview'
      widget.scale = 2
      widget.setResourceType('ore')
      widget.setDensity(75)

      const clone = widget.clone()
      expect(clone).toBeInstanceOf(ResourcePreviewWidget)
      expect(clone.id).toBe('test-preview')
      expect(clone.scale).toBe(2)
      expect(clone.resourceType).toBe('ore')
      expect(clone.density).toBe(75)
    })

    it('should clone with null resource type', () => {
      widget.id = 'empty-preview'
      widget.setResourceType(null)

      const clone = widget.clone()
      expect(clone.resourceType).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear internal state', () => {
      widget.setResourceType('ore')
      widget.setDensity(50)
      widget.render()
      widget.dispose()

      // After dispose, render should create a new canvas
      const el = widget.render()
      // It should still render (the fallback) since we call render again
      expect(el).not.toBeNull()
      const canvas = el.querySelector('canvas')
      expect(canvas).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Resource type transition
  // -----------------------------------------------------------------------

  describe('resource type transitions', () => {
    it('should handle switching resource types', () => {
      const mockImg = createMockImage()
      const spriteInfo: IResourceSpriteInfo = {
        image: mockImg,
        srcX: 0,
        srcY: 0,
        srcWidth: 24,
        srcHeight: 24,
      }
      widget.resourceRenderers = [
        createMockRenderer(['ore'], spriteInfo),
        createMockRenderer(['gems'], spriteInfo),
      ]

      widget.setResourceType('ore')
      expect(widget.resourceType).toBe('ore')

      widget.setResourceType('gems')
      expect(widget.resourceType).toBe('gems')

      widget.setResourceType(null)
      expect(widget.resourceType).toBeNull()
    })
  })
})
