/**
 * GradientColorBlockWidget.test.ts -- GradientColorBlockWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and default values
 * - Four-corner color delegates
 * - Clone copy constructor
 * - DOM rendering (canvas-based gradient vs CSS fallback)
 * - Color parsing (_parseColor for hex, rgb, rgba)
 * - Simple gradient optimization (single color -> CSS background-color)
 * - Vertical gradient optimization (CSS linear-gradient)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GradientColorBlockWidget } from './GradientColorBlockWidget.js'

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('GradientColorBlockWidget -- construction', () => {
  it('creates with default values', () => {
    const w = new GradientColorBlockWidget()
    expect(w.topLeftColor).toBe('#000000')
    expect(w.topRightColor).toBe('#000000')
    expect(w.bottomRightColor).toBe('#000000')
    expect(w.bottomLeftColor).toBe('#000000')
  })

  it('sets up delegates returning colors by default', () => {
    const w = new GradientColorBlockWidget()
    w.topLeftColor = '#FF0000'
    w.topRightColor = '#00FF00'
    w.bottomRightColor = '#0000FF'
    w.bottomLeftColor = '#FFFF00'

    expect(w.getTopLeftColor()).toBe('#FF0000')
    expect(w.getTopRightColor()).toBe('#00FF00')
    expect(w.getBottomRightColor()).toBe('#0000FF')
    expect(w.getBottomLeftColor()).toBe('#FFFF00')
  })
})

// ---------------------------------------------------------------------------
// Tests: Color parsing (_parseColor)
// ---------------------------------------------------------------------------

describe('GradientColorBlockWidget -- color parsing', () => {
  let w: GradientColorBlockWidget

  beforeEach(() => {
    w = new GradientColorBlockWidget()
  })

  it('parses 6-digit hex colors', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('#FF8040')
    expect(result).toEqual({ r: 255, g: 128, b: 64, a: 255 })
  })

  it('parses 8-digit hex colors with alpha', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('#FF804080')
    expect(result).toEqual({ r: 255, g: 128, b: 64, a: 128 })
  })

  it('parses 3-digit hex colors (short form)', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('#F80')
    // #F80 -> #FF8800
    expect(result).toEqual({ r: 255, g: 136, b: 0, a: 255 })
  })

  it('parses 4-digit hex colors with alpha', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('#F808')
    // #F808 -> #FF880088 -> r=255, g=136, b=0, a=136
    expect(result).toEqual({ r: 255, g: 136, b: 0, a: 136 })
  })

  it('parses rgb() format', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('rgb(10, 20, 30)')
    expect(result).toEqual({ r: 10, g: 20, b: 30, a: 255 })
  })

  it('parses rgba() format', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('rgba(10, 20, 30, 0.5)')
    // alpha 0.5 * 255 = 128 (rounded)
    expect(result).toEqual({ r: 10, g: 20, b: 30, a: 128 })
  })

  it('returns black for null/empty color', () => {
    const result = (w as unknown as Record<string, Function>)['_parseColor']('')
    expect(result).toEqual({ r: 0, g: 0, b: 0, a: 255 })
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('GradientColorBlockWidget -- Clone', () => {
  it('creates a deep copy with independent properties', () => {
    const w = new GradientColorBlockWidget()
    w.id = 'grad1'
    w.topLeftColor = '#FF0000'
    w.topRightColor = '#00FF00'
    w.bottomRightColor = '#0000FF'
    w.bottomLeftColor = '#FFFF00'
    w.bounds = { x: 10, y: 10, width: 200, height: 100 }

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(GradientColorBlockWidget)
    expect(cloned.id).toBe('grad1')
    expect(cloned.topLeftColor).toBe('#FF0000')
    expect(cloned.topRightColor).toBe('#00FF00')
    expect(cloned.bottomRightColor).toBe('#0000FF')
    expect(cloned.bottomLeftColor).toBe('#FFFF00')
    expect(cloned.bounds).toEqual({ x: 10, y: 10, width: 200, height: 100 })

    // Independence
    cloned.topLeftColor = '#AAAAAA'
    expect(w.topLeftColor).toBe('#FF0000')
    expect(cloned.topLeftColor).toBe('#AAAAAA')
  })

  it('clones with delegate functions preserved', () => {
    const w = new GradientColorBlockWidget()
    w.getTopLeftColor = () => '#123456'

    const cloned = w.clone()
    expect(cloned.getTopLeftColor()).toBe('#123456')
  })

  it('clones with child widgets', () => {
    const parent = new GradientColorBlockWidget()
    const child = new GradientColorBlockWidget()
    child.id = 'child-grad'
    parent.addChild(child)

    const cloned = parent.clone()
    expect(cloned.children.length).toBe(1)
    expect(cloned.children[0].id).toBe('child-grad')
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('GradientColorBlockWidget -- DOM rendering', () => {
  it('renders as a div with gradient-color-block-widget class', () => {
    const w = new GradientColorBlockWidget()
    w.bounds = { x: 0, y: 0, width: 100, height: 100 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('gradient-color-block-widget')
  })

  it('uses CSS background-color when all four corners are the same', () => {
    const w = new GradientColorBlockWidget()
    w.topLeftColor = '#FF0000'
    w.topRightColor = '#FF0000'
    w.bottomRightColor = '#FF0000'
    w.bottomLeftColor = '#FF0000'
    w.bounds = { x: 0, y: 0, width: 100, height: 50 }
    const el = w.render()
    // happy-dom may store hex directly or as rgb(); accept either
    expect(el.style.backgroundColor).toMatch(/#FF0000|rgb\(255,\s*0,\s*0\)/i)
    expect(el.style.backgroundImage).toBe('')
  })

  it('uses CSS linear-gradient for vertical gradient (top=bottom colors)', () => {
    const w = new GradientColorBlockWidget()
    w.topLeftColor = '#FF0000'
    w.topRightColor = '#FF0000'
    w.bottomRightColor = '#0000FF'
    w.bottomLeftColor = '#0000FF'
    w.bounds = { x: 0, y: 0, width: 100, height: 50 }
    const el = w.render()
    expect(el.style.backgroundImage).toContain('linear-gradient')
    expect(el.style.backgroundColor).toBe('')
  })

  it('uses canvas for general four-corner gradient', () => {
    const w = new GradientColorBlockWidget()
    w.topLeftColor = '#FF0000'
    w.topRightColor = '#00FF00'
    w.bottomRightColor = '#0000FF'
    w.bottomLeftColor = '#FFFF00'
    w.bounds = { x: 0, y: 0, width: 64, height: 64 }
    const el = w.render()

    // Should contain a canvas child element
    const canvas = el.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.width).toBe(64)
    expect(canvas!.height).toBe(64)
  })

  it('uses getColor delegates for dynamic color resolution', () => {
    const w = new GradientColorBlockWidget()
    w.getTopLeftColor = () => '#111111'
    w.getTopRightColor = () => '#111111'
    w.getBottomRightColor = () => '#222222'
    w.getBottomLeftColor = () => '#222222'
    w.bounds = { x: 0, y: 0, width: 50, height: 50 }
    const el = w.render()
    // Should be a vertical gradient from #111111 to #222222
    expect(el.style.backgroundImage).toContain('linear-gradient')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new GradientColorBlockWidget()
    w.id = 'header-grad'
    w.bounds = { x: 0, y: 0, width: 100, height: 30 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('header-grad')
  })
})
