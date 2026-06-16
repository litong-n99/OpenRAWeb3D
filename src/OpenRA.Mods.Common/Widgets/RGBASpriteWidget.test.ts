/**
 * RGBASpriteWidget.test.ts -- RGBASpriteWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and default values
 * - GetSprite delegate behavior (defaults to null)
 * - Clone copy constructor
 * - DOM rendering (canvas element for RGBA sprite)
 * - No-sprite state (clears canvas)
 * - Cursor return value
 */

import { describe, it, expect } from 'vitest'
import { RGBASpriteWidget } from './RGBASpriteWidget.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'
import { Sheet } from '../../OpenRA.Game/Graphics/Sheet.js'
import { TextureChannel } from '../../OpenRA.Game/Graphics/Sprite.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMockSprite(overrides: Partial<{
  bounds: { x: number; y: number; width: number; height: number }
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
    size: { x: 64, y: 64, z: 0 },
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

describe('RGBASpriteWidget -- construction', () => {
  it('creates with default null sprite', () => {
    const w = new RGBASpriteWidget()
    expect(w.getSprite()).toBeNull()
  })

  it('getSprite can be replaced with a custom delegate', () => {
    const w = new RGBASpriteWidget()
    const mockSprite = makeMockSprite()
    w.getSprite = () => mockSprite
    expect(w.getSprite()).toBe(mockSprite)
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('RGBASpriteWidget -- Clone', () => {
  it('creates a deep copy with independent properties', () => {
    const w = new RGBASpriteWidget()
    w.id = 'rgba1'
    w.bounds = { x: 10, y: 20, width: 100, height: 100 }

    const mockSprite = makeMockSprite()
    w.getSprite = () => mockSprite

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(RGBASpriteWidget)
    expect(cloned.id).toBe('rgba1')
    expect(cloned.bounds).toEqual({ x: 10, y: 20, width: 100, height: 100 })
    expect(cloned.getSprite()).toBe(mockSprite)
  })

  it('clones with delegate function preserved', () => {
    const w = new RGBASpriteWidget()
    let callCount = 0
    w.getSprite = () => {
      callCount++
      return makeMockSprite()
    }

    const cloned = w.clone()
    cloned.getSprite()
    cloned.getSprite()
    expect(callCount).toBe(2) // Delegate is shared (same function reference)
  })

  it('clones with child widgets', () => {
    const parent = new RGBASpriteWidget()
    const child = new RGBASpriteWidget()
    child.id = 'child-rgba'
    parent.addChild(child)

    const cloned = parent.clone()
    expect(cloned.children.length).toBe(1)
    expect(cloned.children[0].id).toBe('child-rgba')
    expect(cloned.children[0]).toBeInstanceOf(RGBASpriteWidget)
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('RGBASpriteWidget -- DOM rendering', () => {
  it('renders as a div with rgba-sprite-widget class', () => {
    const w = new RGBASpriteWidget()
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('rgba-sprite-widget')
  })

  it('does not create canvas when getSprite returns null', () => {
    const w = new RGBASpriteWidget()
    w.getSprite = () => null
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    const canvas = el.querySelector('canvas')
    expect(canvas).toBeNull()
  })

  it('creates canvas when sprite is available', () => {
    const w = new RGBASpriteWidget()
    w.getSprite = () => makeMockSprite()
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    const canvas = el.querySelector('canvas')
    expect(canvas).not.toBeNull()
  })

  it('sizes canvas to match sprite bounds', () => {
    const w = new RGBASpriteWidget()
    w.getSprite = () =>
      makeMockSprite({
        bounds: { x: 10, y: 20, width: 48, height: 32 },
      })
    w.bounds = { x: 0, y: 0, width: 200, height: 200 }
    const el = w.render()
    const canvas = el.querySelector('canvas') as HTMLCanvasElement
    expect(canvas).not.toBeNull()
    expect(canvas.width).toBe(48)
    expect(canvas.height).toBe(32)
    expect(canvas.style.width).toBe('48px')
    expect(canvas.style.height).toBe('32px')
  })

  it('removes canvas when sprite changes from valid to null', () => {
    const w = new RGBASpriteWidget()
    const sprite = makeMockSprite()
    w.getSprite = () => sprite
    w.bounds = { x: 0, y: 0, width: 64, height: 64 }

    // First render: create canvas
    let el = w.render()
    let canvas = el.querySelector('canvas')
    expect(canvas).not.toBeNull()

    // Second render: null sprite
    w.getSprite = () => null
    el = w.render()
    canvas = el.querySelector('canvas')
    expect(canvas).toBeNull()
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new RGBASpriteWidget()
    w.id = 'rgba-icon'
    w.bounds = { x: 0, y: 0, width: 64, height: 64 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('rgba-icon')
  })

  it('has overflow: visible to allow sprite to exceed bounds', () => {
    const w = new RGBASpriteWidget()
    w.bounds = { x: 0, y: 0, width: 16, height: 16 }
    const el = w.render()
    expect(el.style.overflow).toBe('visible')
  })

  it('returns null from getCursor', () => {
    const w = new RGBASpriteWidget()
    expect(w.getCursor({ x: 0, y: 0 })).toBeNull()
  })

  it('canvas is positioned at 0,0 within widget', () => {
    const w = new RGBASpriteWidget()
    w.getSprite = () => makeMockSprite()
    w.bounds = { x: 0, y: 0, width: 64, height: 64 }
    const el = w.render()
    const canvas = el.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.left).toBe('0px')
    expect(canvas.style.top).toBe('0px')
  })
})

// ---------------------------------------------------------------------------
// Tests: Multiple render cycles
// ---------------------------------------------------------------------------

describe('RGBASpriteWidget -- multiple renders', () => {
  it('reuses canvas across renders with same sprite', () => {
    const w = new RGBASpriteWidget()
    w.getSprite = () => makeMockSprite()
    w.bounds = { x: 0, y: 0, width: 64, height: 64 }

    const el1 = w.render()
    const canvas1 = el1.querySelector('canvas')

    const el2 = w.render()
    const canvas2 = el2.querySelector('canvas')

    // Same element should be reused
    expect(canvas1).toBe(canvas2)
  })
})
