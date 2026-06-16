/**
 * SpriteWidget.test.ts -- SpriteWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and default values
 * - GetSprite/GetScale/GetPalette delegate behavior
 * - Clone copy constructor
 * - Offset calculation when sprite or scale changes
 * - Palette resolution caching
 * - DOM rendering (canvas element creation)
 * - No-sprite state (clears canvas)
 * - Cursor return value
 */

import { describe, it, expect } from 'vitest'
import { SpriteWidget } from './SpriteWidget.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'
import { Sheet } from '../../OpenRA.Game/Graphics/Sheet.js'
import { TextureChannel } from '../../OpenRA.Game/Graphics/Sprite.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMockSprite(overrides: Partial<{
  bounds: { x: number; y: number; width: number; height: number }
  size: { x: number; y: number; z: number }
  sheet: Partial<Sheet>
}> = {}): Sprite {
  const mockSheet = {
    getTexture: () => ({ url: 'data:image/png;base64,test' }),
    ...(overrides.sheet || {}),
  } as unknown as Sheet

  return {
    sheet: mockSheet,
    bounds: overrides.bounds || { x: 0, y: 0, width: 64, height: 64 },
    blendMode: 0,
    channel: TextureChannel.RGBA,
    zRamp: 0,
    size: overrides.size || { x: 64, y: 64, z: 0 },
    offset: { x: 0, y: 0, z: 0 },
    top: 0,
    left: 0,
    bottom: 1,
    right: 1,
  } as unknown as Sprite
}

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('SpriteWidget -- construction', () => {
  it('creates with default values', () => {
    const w = new SpriteWidget()
    expect(w.scale).toBe(1.0)
    expect(w.palette).toBe('chrome')
  })

  it('sets up getScale delegate returning scale by default', () => {
    const w = new SpriteWidget()
    w.scale = 2.5
    expect(w.getScale()).toBe(2.5)
  })

  it('sets up getPalette delegate returning palette by default', () => {
    const w = new SpriteWidget()
    w.palette = 'terrain'
    expect(w.getPalette()).toBe('terrain')
  })

  it('sets up getSprite delegate returning null by default', () => {
    const w = new SpriteWidget()
    expect(w.getSprite()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('SpriteWidget -- Clone', () => {
  it('creates a deep copy with independent properties', () => {
    const w = new SpriteWidget()
    w.id = 'sprite1'
    w.scale = 1.5
    w.palette = 'effect'
    w.bounds = { x: 100, y: 100, width: 128, height: 128 }

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(SpriteWidget)
    expect(cloned.id).toBe('sprite1')
    expect(cloned.scale).toBe(1.5)
    expect(cloned.palette).toBe('effect')
    expect(cloned.bounds).toEqual({ x: 100, y: 100, width: 128, height: 128 })

    // Independence
    cloned.scale = 2.0
    expect(w.scale).toBe(1.5)
    expect(cloned.scale).toBe(2.0)
  })

  it('clones with delegate functions preserved', () => {
    const w = new SpriteWidget()
    w.getScale = () => 3.0
    const cloned = w.clone()
    expect(cloned.getScale()).toBe(3.0)
  })

  it('clones with child widgets', () => {
    const parent = new SpriteWidget()
    const child = new SpriteWidget()
    child.id = 'child-sprite'
    parent.addChild(child)

    const cloned = parent.clone()
    expect(cloned.children.length).toBe(1)
    expect(cloned.children[0].id).toBe('child-sprite')
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('SpriteWidget -- DOM rendering', () => {
  it('renders as a div with sprite-widget class', () => {
    const w = new SpriteWidget()
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('sprite-widget')
  })

  it('handles null sprite by not creating a canvas', () => {
    const w = new SpriteWidget()
    w.getSprite = () => null
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    const canvas = el.querySelector('canvas')
    expect(canvas).toBeNull()
  })

  it('handles empty palette name by not creating a canvas', () => {
    const w = new SpriteWidget()
    w.getSprite = () => makeMockSprite()
    w.getPalette = () => ''
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    const canvas = el.querySelector('canvas')
    expect(canvas).toBeNull()
  })

  it('creates canvas when sprite and palette are available', () => {
    const w = new SpriteWidget()
    w.getSprite = () => makeMockSprite()
    w.getPalette = () => 'chrome'
    w.bounds = { x: 0, y: 0, width: 128, height: 128 }
    const el = w.render()
    const canvas = el.querySelector('canvas')
    expect(canvas).not.toBeNull()
  })

  it('positions canvas according to offset calculation', () => {
    const w = new SpriteWidget()
    // Sprite size: 64x64, bounds: 128x128, scale: 1.0
    // offset = 0.5 * (128 - 64) = 32 in each direction
    w.getSprite = () => makeMockSprite({
      size: { x: 64, y: 64, z: 0 },
      bounds: { x: 0, y: 0, width: 64, height: 64 },
    })
    w.getPalette = () => 'chrome'
    w.scale = 1.0
    w.bounds = { x: 0, y: 0, width: 128, height: 128 }
    const el = w.render()
    const canvas = el.querySelector('canvas') as HTMLCanvasElement
    expect(canvas).not.toBeNull()
    expect(canvas.style.left).toBe('32px')
    expect(canvas.style.top).toBe('32px')
  })

  it('scales canvas when scale is not 1.0', () => {
    const w = new SpriteWidget()
    // Sprite 64x64, scale 2.0 -> canvas 128x128
    // bounds 256x256 -> offset = 0.5 * (256 - 128) = 64
    w.getSprite = () => makeMockSprite({
      size: { x: 64, y: 64, z: 0 },
      bounds: { x: 0, y: 0, width: 64, height: 64 },
    })
    w.getPalette = () => 'chrome'
    w.scale = 2.0
    w.bounds = { x: 0, y: 0, width: 256, height: 256 }
    const el = w.render()
    const canvas = el.querySelector('canvas') as HTMLCanvasElement
    expect(canvas).not.toBeNull()
    expect(canvas.width).toBe(128) // 64 * 2
    expect(canvas.height).toBe(128)
    expect(canvas.style.left).toBe('64px')
    expect(canvas.style.top).toBe('64px')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new SpriteWidget()
    w.id = 'my-sprite'
    w.bounds = { x: 0, y: 0, width: 64, height: 64 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('my-sprite')
  })

  it('has overflow: visible to allow sprite to exceed bounds', () => {
    const w = new SpriteWidget()
    w.bounds = { x: 0, y: 0, width: 32, height: 32 }
    const el = w.render()
    expect(el.style.overflow).toBe('visible')
  })

  it('returns null from getCursor', () => {
    const w = new SpriteWidget()
    expect(w.getCursor({ x: 0, y: 0 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: Offset recalculation on change
// ---------------------------------------------------------------------------

describe('SpriteWidget -- cache invalidation', () => {
  it('recalculates offset when sprite changes', () => {
    const w = new SpriteWidget()
    w.getSprite = () => makeMockSprite({
      size: { x: 32, y: 32, z: 0 },
      bounds: { x: 0, y: 0, width: 32, height: 32 },
    })
    w.getPalette = () => 'chrome'
    w.scale = 1.0
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    let el = w.render()
    let canvas = el.querySelector('canvas') as HTMLCanvasElement
    // offset = 0.5 * (100 - 32) = 34
    expect(canvas.style.left).toBe('34px')
    expect(canvas.style.top).toBe('34px')

    // Change sprite to larger size
    const sprite2 = makeMockSprite({
      size: { x: 80, y: 80, z: 0 },
      bounds: { x: 0, y: 0, width: 80, height: 80 },
    })
    w.getSprite = () => sprite2
    el = w.render()
    canvas = el.querySelector('canvas') as HTMLCanvasElement
    // offset = 0.5 * (100 - 80) = 10
    expect(canvas.style.left).toBe('10px')
    expect(canvas.style.top).toBe('10px')
  })

  it('recalculates offset when scale changes', () => {
    const w = new SpriteWidget()
    const sprite = makeMockSprite({
      size: { x: 64, y: 64, z: 0 },
      bounds: { x: 0, y: 0, width: 64, height: 64 },
    })
    w.getSprite = () => sprite
    w.getPalette = () => 'chrome'
    w.scale = 1.0
    w.bounds = { x: 0, y: 0, width: 200, height: 200 }
    let el = w.render()
    let canvas = el.querySelector('canvas') as HTMLCanvasElement
    // offset = 0.5 * (200 - 64) = 68
    expect(canvas.style.left).toBe('68px')

    // Change scale
    w.scale = 2.0
    el = w.render()
    canvas = el.querySelector('canvas') as HTMLCanvasElement
    // offset = 0.5 * (200 - 128) = 36
    expect(canvas.style.left).toBe('36px')
  })
})
