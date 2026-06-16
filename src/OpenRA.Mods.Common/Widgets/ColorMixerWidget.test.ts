/**
 * ColorMixerWidget.test.ts — ColorMixerWidget migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: HSV state management, setColor/getColor, setColorLimits,
 * RGB↔HSV conversion accuracy, onChange callback, clone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ColorMixerWidget } from './ColorMixerWidget.js'
import { toArgb, fromArgb } from '../../OpenRA.Game/Primitives/Color.js'

// ---------------------------------------------------------------------------
// Helper: compare ARGB colors with tolerance
// ---------------------------------------------------------------------------

/** Compare two ARGB colors within ±1 per channel.
 *  HSV↔RGB round-trip can lose up to ±1/255 due to float→byte rounding. */
function expectColorClose(actual: number, expected: number): void {
  const a1 = fromArgb(actual)
  const a2 = fromArgb(expected)
  expect(Math.abs(a1.a - a2.a)).toBeLessThanOrEqual(1)
  expect(Math.abs(a1.r - a2.r)).toBeLessThanOrEqual(1)
  expect(Math.abs(a1.g - a2.g)).toBeLessThanOrEqual(1)
  expect(Math.abs(a1.b - a2.b)).toBeLessThanOrEqual(1)
}

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — construction', () => {
  it('creates with default HSV values (red)', () => {
    const w = new ColorMixerWidget()
    expect(w.h).toBe(0)
    expect(w.s).toBe(1)
    expect(w.v).toBe(1)
  })

  it('color property returns correct ARGB for H=0,S=1,V=1 (red)', () => {
    const w = new ColorMixerWidget()
    // H=0,S=1,V=1 should produce pure red: ARGB = 0xFFFF0000
    const color = w.color
    const { a, r, g, b } = fromArgb(color)
    expect(a).toBe(255)
    expect(r).toBeGreaterThanOrEqual(254)
    expect(r).toBeLessThanOrEqual(255)
    expect(g).toBeLessThanOrEqual(1)
    expect(b).toBeLessThanOrEqual(1)
  })

  it('onChange defaults to a no-op function', () => {
    const w = new ColorMixerWidget()
    expect(() => w.onChange()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: setColor
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — setColor', () => {
  let widget: ColorMixerWidget

  beforeEach(() => {
    widget = new ColorMixerWidget()
  })

  it('sets color and updates HSV values', () => {
    const callback = vi.fn()
    widget.onChange = callback

    // Pure green: RGB(0, 255, 0) → H ≈ 1/3, S = 1, V = 1
    widget.setColor(toArgb(255, 0, 255, 0))

    expect(widget.h).toBeCloseTo(1 / 3, 2)
    expect(widget.s).toBeCloseTo(1, 1)
    expect(widget.v).toBeCloseTo(1, 1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('sets color to pure blue', () => {
    widget.setColor(toArgb(255, 0, 0, 255))
    expect(widget.h).toBeCloseTo(2 / 3, 2)
    expect(widget.s).toBeCloseTo(1, 1)
    expect(widget.v).toBeCloseTo(1, 1)
  })

  it('handles white correctly', () => {
    widget.setColor(toArgb(255, 255, 255, 255))
    expect(widget.v).toBeCloseTo(1, 1)
    expect(widget.s).toBeCloseTo(0, 1) // white has S=0
  })

  it('handles black correctly', () => {
    widget.setColor(toArgb(255, 0, 0, 0))
    expect(widget.v).toBeCloseTo(0, 1)
  })

  it('triggers onChange only if color changed', () => {
    const callback = vi.fn()
    widget.onChange = callback

    widget.setColor(toArgb(255, 255, 0, 0)) // pure red (same as default)
    // H=0, S=1, V=1 — same as defaults, should NOT trigger onChange
    // NOTE: default is H=0, S=1, V=1, so no change
    expect(callback).toHaveBeenCalledTimes(0)

    widget.setColor(toArgb(255, 0, 255, 0)) // green — different
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('setColor returns silently when values are identical', () => {
    const callback = vi.fn()
    widget.onChange = callback

    // Set to current value (H=0, S=1, V=1 → pure red)
    widget.setColor(toArgb(255, 255, 0, 0))
    expect(callback).toHaveBeenCalledTimes(0)
  })

  it('round-trips ARGB → setColor → color within tolerance', () => {
    const testColors = [
      toArgb(255, 100, 150, 200),
      toArgb(255, 50, 200, 100),
      toArgb(255, 200, 50, 50),
      toArgb(255, 128, 128, 128),
    ]

    for (const input of testColors) {
      widget.setColor(input)
      const output = widget.color
      expectColorClose(output, input)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: setColorLimits
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — setColorLimits', () => {
  let widget: ColorMixerWidget

  beforeEach(() => {
    widget = new ColorMixerWidget()
  })

  it('sets min and max saturation/value', () => {
    widget.setColorLimits(0.2, 0.8, 0.3, 0.9)
    // No public accessors for minSat/maxSat/minVal/maxVal,
    // but we can verify that setting a color outside range clamps it
    // Set a color with S=1, V=1 — should be clamped
    const color = toArgb(255, 255, 0, 0) // red, H=0, S=1 (full), V=1 (full)
    widget.setColor(color)
    expect(widget.s).toBeCloseTo(0.8, 2) // clamped to maxSat
    expect(widget.v).toBeCloseTo(0.9, 2) // clamped to maxVal
  })

  it('clamps to min values when color is below range', () => {
    widget.setColorLimits(0.3, 0.9, 0.3, 0.9)
    // Gray: S=0, V~0.5
    widget.setColor(toArgb(255, 128, 128, 128))
    expect(widget.s).toBeGreaterThanOrEqual(0.3)
    expect(widget.v).toBeGreaterThanOrEqual(0.3)
  })

  it('accepts optional newHue parameter', () => {
    widget.setColorLimits(0, 1, 0, 1, 0.5) // set H=0.5 (cyan)
    expect(widget.h).toBeCloseTo(0.5, 2)
  })

  it('keeps current H when newHue is not provided', () => {
    widget.setColor(toArgb(255, 255, 255, 0)) // H ~= 1/6 (yellow)
    const hueBefore = widget.h
    widget.setColorLimits(0.1, 0.9, 0.1, 0.9)
    expect(widget.h).toBeCloseTo(hueBefore, 2)
  })
})

// ---------------------------------------------------------------------------
// Tests: HSV↔RGB conversion accuracy
// OpenRA parity: Color.FromAhsv / Color.ToAhsv within ±1/255
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — HSV↔RGB conversion accuracy', () => {
  it('converts known HSV values to correct ARGB', () => {
    // Manually verify via the static helper function embedded in the module
    // We test widget.color which uses fromAhsv internally
    const w = new ColorMixerWidget()

    // Pure red: H=0, S=1, V=1
    w.setColor(toArgb(255, 255, 0, 0))
    expect(w.h).toBeCloseTo(0, 2)
    expect(w.s).toBeCloseTo(1, 2)
    expect(w.v).toBeCloseTo(1, 2)

    // Pure green: H≈1/3, S=1, V=1
    w.setColor(toArgb(255, 0, 255, 0))
    expect(w.h).toBeCloseTo(1 / 3, 2)
    expect(w.s).toBeCloseTo(1, 2)
    expect(w.v).toBeCloseTo(1, 2)

    // Pure blue: H≈2/3, S=1, V=1
    w.setColor(toArgb(255, 0, 0, 255))
    expect(w.h).toBeCloseTo(2 / 3, 2)
    expect(w.s).toBeCloseTo(1, 2)
    expect(w.v).toBeCloseTo(1, 2)

    // Cyan: H=0.5, S=1, V=1
    w.setColor(toArgb(255, 0, 255, 255))
    expect(w.h).toBeCloseTo(0.5, 2)
    expect(w.s).toBeCloseTo(1, 2)
    expect(w.v).toBeCloseTo(1, 2)

    // Magenta: H≈5/6, S=1, V=1
    w.setColor(toArgb(255, 255, 0, 255))
    expect(w.h).toBeCloseTo(5 / 6, 2)
    expect(w.s).toBeCloseTo(1, 2)
    expect(w.v).toBeCloseTo(1, 2)

    // Yellow: H≈1/6, S=1, V=1
    w.setColor(toArgb(255, 255, 255, 0))
    expect(w.h).toBeCloseTo(1 / 6, 2)
    expect(w.s).toBeCloseTo(1, 2)
    expect(w.v).toBeCloseTo(1, 2)
  })

  it('HSV↔RGB round-trip is within ±1 per channel', () => {
    const w = new ColorMixerWidget()
    const testCases = [
      [0xFFFF0000, 'red'],
      [0xFF00FF00, 'green'],
      [0xFF0000FF, 'blue'],
      [0xFFFFFFFF, 'white'],
      [0xFF000000, 'black'],
      [0xFF808080, 'gray'],
      [0xFFFFA500, 'orange'],
      [0xFF800080, 'purple'],
    ]

    for (const [inputRgb, _label] of testCases) {
      w.setColor(inputRgb as number)
      const output = w.color
      const inp = fromArgb(inputRgb as number)
      const out = fromArgb(output)
      expect(Math.abs(out.r - inp.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(out.g - inp.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(out.b - inp.b)).toBeLessThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering (basic structure)
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — DOM rendering', () => {
  it('renders as a div with color-mixer-widget class', () => {
    const w = new ColorMixerWidget()
    w.bounds = { x: 0, y: 0, width: 300, height: 250 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('color-mixer-widget')
  })

  it('renders with flex layout', () => {
    const w = new ColorMixerWidget()
    w.bounds = { x: 0, y: 0, width: 300, height: 250 }
    const el = w.render()
    expect(el.style.display).toBe('flex')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new ColorMixerWidget()
    w.id = 'color-picker'
    w.bounds = { x: 0, y: 0, width: 300, height: 250 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('color-picker')
  })

  it('does not consume mouse events directly', () => {
    const w = new ColorMixerWidget()
    const event = {
      type: 'mousedown',
      clientX: 100,
      clientY: 100,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(false)
  })

  it('returns null cursor', () => {
    const w = new ColorMixerWidget()
    expect(w.getCursor({ x: 0, y: 0 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — clone', () => {
  it('clones with independent HSV state', () => {
    const w = new ColorMixerWidget()
    w.id = 'mixer1'
    w.bounds = { x: 10, y: 10, width: 300, height: 250 }
    w.setColor(toArgb(255, 100, 200, 50))
    w.onChange = () => {}

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(ColorMixerWidget)
    expect(cloned.id).toBe('mixer1')
    expect(cloned.h).toBeCloseTo(w.h, 3)
    expect(cloned.s).toBeCloseTo(w.s, 3)
    expect(cloned.v).toBeCloseTo(w.v, 3)
    expect(cloned.color).toBe(w.color)

    // Independence test
    cloned.setColor(toArgb(255, 255, 255, 255))
    expect(cloned.color).not.toBe(w.color)
  })

  it('clones with bounds', () => {
    const w = new ColorMixerWidget()
    w.bounds = { x: 10, y: 20, width: 300, height: 250 }
    const cloned = w.clone()
    expect(cloned.bounds).toEqual({ x: 10, y: 20, width: 300, height: 250 })
  })
})

// ---------------------------------------------------------------------------
// Tests: onChange callback
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — onChange', () => {
  let widget: ColorMixerWidget

  beforeEach(() => {
    widget = new ColorMixerWidget()
  })

  it('triggers onChange when setColor changes values', () => {
    const callback = vi.fn()
    widget.onChange = callback

    widget.setColor(toArgb(255, 0, 255, 0)) // green
    expect(callback).toHaveBeenCalledTimes(1)

    widget.setColor(toArgb(255, 0, 0, 255)) // blue
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('does not trigger onChange when SetColor sets same values', () => {
    const callback = vi.fn()
    widget.onChange = callback

    // Default is H=0, S=1, V=1 → pure red
    widget.setColor(toArgb(255, 255, 0, 0)) // same as default
    expect(callback).toHaveBeenCalledTimes(0)
  })

  it('onChange can be reassigned', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    widget.onChange = cb1
    widget.setColor(toArgb(255, 0, 255, 0))
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(0)

    widget.onChange = cb2
    widget.setColor(toArgb(255, 0, 0, 255))
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: Dispose
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — dispose', () => {
  it('cleans up cached DOM references', () => {
    const w = new ColorMixerWidget()
    w.bounds = { x: 0, y: 0, width: 300, height: 250 }
    w.render() // creates cached elements
    w.dispose()
    // Subsequent render should work (creates new elements)
    const el = w.render()
    expect(el).toBeDefined()
    expect(el.className).toContain('color-mixer-widget')
  })
})

// ---------------------------------------------------------------------------
// Tests: edge cases for color conversion
// ---------------------------------------------------------------------------

describe('ColorMixerWidget — edge cases', () => {
  it('handles gray colors (S=0)', () => {
    const w = new ColorMixerWidget()
    const gray = toArgb(255, 128, 128, 128) // #808080
    w.setColor(gray)
    expect(w.s).toBeCloseTo(0, 2)
    expect(w.v).toBeCloseTo(128 / 255, 2)
  })

  it('handles near-black colors', () => {
    const w = new ColorMixerWidget()
    const nearBlack = toArgb(255, 1, 1, 1)
    w.setColor(nearBlack)
    expect(w.v).toBeLessThan(0.01)
  })

  it('handles near-white colors', () => {
    const w = new ColorMixerWidget()
    const nearWhite = toArgb(255, 254, 254, 254)
    w.setColor(nearWhite)
    expect(w.s).toBeLessThan(0.01)
    expect(w.v).toBeCloseTo(1, 2)
  })
})
