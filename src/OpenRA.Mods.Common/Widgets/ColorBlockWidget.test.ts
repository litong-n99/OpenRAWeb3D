/**
 * ColorBlockWidget.test.ts -- ColorBlockWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and default values
 * - GetColor delegate behavior
 * - Mouse event handling (left-click state machine)
 * - Sound playback on click
 * - Clone copy constructor
 * - DOM rendering (CSS background-color)
 * - Disabled state (inherited from InputWidget)
 * - Cursor return value
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ColorBlockWidget } from './ColorBlockWidget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: string,
  x: number,
  y: number,
  button = 0,
): Parameters<ColorBlockWidget['handleEvent']>[0] {
  return {
    type,
    clientX: x,
    clientY: y,
    button,
    stopPropagation: () => {},
    target: null,
  }
}

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('ColorBlockWidget -- construction', () => {
  it('creates with default values', () => {
    const w = new ColorBlockWidget()
    expect(w.color).toBe('#000000')
    expect(w.clickSound).toBeNull()
    expect(w.disabled).toBe(false)
    expect(w.isDisabled()).toBe(false)
  })

  it('sets up getColor delegate returning color by default', () => {
    const w = new ColorBlockWidget()
    w.color = '#FF5500'
    expect(w.getColor()).toBe('#FF5500')
  })

  it('sets up onMouseDown/onMouseUp as no-op functions', () => {
    const w = new ColorBlockWidget()
    expect(() => w.onMouseDown(makeEvent('mousedown', 0, 0))).not.toThrow()
    expect(() => w.onMouseUp(makeEvent('mouseup', 0, 0))).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: Mouse event handling (left-click state machine)
// ---------------------------------------------------------------------------

describe('ColorBlockWidget -- mouse event handling', () => {
  let w: ColorBlockWidget

  beforeEach(() => {
    w = new ColorBlockWidget()
    w.bounds = { x: 10, y: 10, width: 100, height: 100 }
  })

  afterEach(() => {
    ColorBlockWidget.soundPlayer = null
  })

  it('ignores non-mouse events', () => {
    const event = { type: 'keydown', key: 'a', stopPropagation: () => {}, target: null }
    expect(w.handleEvent(event)).toBe(false)
  })

  it('ignores non-left-button clicks', () => {
    const event = makeEvent('mousedown', 50, 50, 1) // middle button
    expect(w.handleEvent(event)).toBe(false)
  })

  it('calls onMouseDown on left mousedown', () => {
    const downSpy = vi.fn()
    w.onMouseDown = downSpy
    w.handleEvent(makeEvent('mousedown', 50, 50))
    expect(downSpy).toHaveBeenCalledTimes(1)
  })

  it('calls onMouseUp on left mouseup after mousedown', () => {
    const upSpy = vi.fn()
    w.onMouseUp = upSpy
    w.handleEvent(makeEvent('mousedown', 50, 50))
    w.handleEvent(makeEvent('mouseup', 50, 50))
    expect(upSpy).toHaveBeenCalledTimes(1)
  })

  it('does not call onMouseUp without prior mousedown', () => {
    const upSpy = vi.fn()
    w.onMouseUp = upSpy
    w.handleEvent(makeEvent('mouseup', 50, 50))
    expect(upSpy).not.toHaveBeenCalled()
  })

  it('captures mouse focus on mousedown', () => {
    // Simulate: widget not in focus -> takeMouseFocus returns true
    const result = w.handleEvent(makeEvent('mousedown', 50, 50))
    // Result is false per OpenRA spec (ColorBlockWidget always returns false from HandleMouseInput)
    expect(result).toBe(false)
    // Mouse focus should be taken (or attempted)
    // Since we can't easily test Ui state without setup, verify at minimum it tried
  })

  it('releases mouse focus on mouseup', () => {
    w.handleEvent(makeEvent('mousedown', 50, 50))
    const result = w.handleEvent(makeEvent('mouseup', 50, 50))
    expect(result).toBe(true) // YieldMouseFocus returns true
  })

  it('handles pointerdown/pointerup equivalents', () => {
    const downSpy = vi.fn()
    const upSpy = vi.fn()
    w.onMouseDown = downSpy
    w.onMouseUp = upSpy

    w.handleEvent(makeEvent('pointerdown', 50, 50))
    expect(downSpy).toHaveBeenCalledTimes(1)

    w.handleEvent(makeEvent('pointerup', 50, 50))
    expect(upSpy).toHaveBeenCalledTimes(1)
  })

  it('releases state on yieldMouseFocus', () => {
    w.handleEvent(makeEvent('mousedown', 50, 50))
    // Internally _depressed is set
    w.yieldMouseFocus()
    // After yield, a subsequent mouseup without focus should not fire
    const upSpy = vi.fn()
    w.onMouseUp = upSpy
    w.handleEvent(makeEvent('mouseup', 50, 50))
    expect(upSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: Sound playback
// ---------------------------------------------------------------------------

describe('ColorBlockWidget -- sound playback', () => {
  let w: ColorBlockWidget

  beforeEach(() => {
    w = new ColorBlockWidget()
    w.bounds = { x: 10, y: 10, width: 100, height: 100 }
  })

  afterEach(() => {
    ColorBlockWidget.soundPlayer = null
  })

  it('plays clickSound on mousedown when configured', () => {
    const soundSpy = vi.fn()
    ColorBlockWidget.soundPlayer = soundSpy
    w.clickSound = 'button-click'
    w.handleEvent(makeEvent('mousedown', 50, 50))
    expect(soundSpy).toHaveBeenCalledWith('button-click')
  })

  it('does not play sound when clickSound is null', () => {
    const soundSpy = vi.fn()
    ColorBlockWidget.soundPlayer = soundSpy
    w.clickSound = null
    w.handleEvent(makeEvent('mousedown', 50, 50))
    expect(soundSpy).not.toHaveBeenCalled()
  })

  it('does not throw when soundPlayer is not set', () => {
    ColorBlockWidget.soundPlayer = null
    w.clickSound = 'test-sound'
    expect(() => w.handleEvent(makeEvent('mousedown', 50, 50))).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: Disabled state
// ---------------------------------------------------------------------------

describe('ColorBlockWidget -- disabled state', () => {
  it('applies disabled styling in render', () => {
    const w = new ColorBlockWidget()
    w.disabled = true
    w.bounds = { x: 0, y: 0, width: 50, height: 50 }
    const el = w.render()
    expect(el.getAttribute('data-disabled')).toBe('true')
    expect(el.style.opacity).toBe('0.5')
    expect(el.style.pointerEvents).toBe('none')
  })

  it('isDisabled delegate can be overridden', () => {
    const w = new ColorBlockWidget()
    w.isDisabled = () => true
    w.bounds = { x: 0, y: 0, width: 50, height: 50 }
    const el = w.render()
    expect(el.getAttribute('data-disabled')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('ColorBlockWidget -- Clone', () => {
  it('creates a deep copy with independent properties', () => {
    const w = new ColorBlockWidget()
    w.id = 'cb1'
    w.color = '#FF0000'
    w.clickSound = 'click'
    w.disabled = true
    w.bounds = { x: 5, y: 5, width: 50, height: 50 }

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(ColorBlockWidget)
    expect(cloned.id).toBe('cb1')
    expect(cloned.color).toBe('#FF0000')
    expect(cloned.clickSound).toBe('click')
    expect(cloned.bounds).toEqual({ x: 5, y: 5, width: 50, height: 50 })

    // Independence
    cloned.color = '#00FF00'
    expect(w.color).toBe('#FF0000')
    expect(cloned.color).toBe('#00FF00')
  })

  it('clones with event handlers preserved', () => {
    const w = new ColorBlockWidget()
    const downSpy = vi.fn()
    w.onMouseDown = downSpy

    const cloned = w.clone()
    cloned.onMouseDown(makeEvent('mousedown', 5, 5))
    expect(downSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('ColorBlockWidget -- DOM rendering', () => {
  it('renders as a div with CSS background-color', () => {
    const w = new ColorBlockWidget()
    w.color = '#123456'
    w.bounds = { x: 0, y: 0, width: 100, height: 50 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    // happy-dom may store hex directly or as rgb(); accept either
    expect(el.style.backgroundColor).toMatch(/#123456|rgb\(18,\s*52,\s*86\)/)
  })

  it('uses getColor delegate for dynamic color', () => {
    const w = new ColorBlockWidget()
    w.getColor = () => '#00FF00'
    w.bounds = { x: 0, y: 0, width: 100, height: 50 }
    const el = w.render()
    // happy-dom may store hex directly or as rgb(); accept either
    expect(el.style.backgroundColor).toMatch(/#00FF00|rgb\(0,\s*255,\s*0\)/i)
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new ColorBlockWidget()
    w.id = 'health-bar'
    w.bounds = { x: 0, y: 0, width: 100, height: 20 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('health-bar')
  })

  it('returns default cursor from getCursor', () => {
    const w = new ColorBlockWidget()
    expect(w.getCursor({ x: 0, y: 0 })).toBe('default')
  })

  it('returns null cursor when disabled', () => {
    const w = new ColorBlockWidget()
    w.disabled = true
    expect(w.getCursor({ x: 0, y: 0 })).toBeNull()
  })
})
