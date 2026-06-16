/**
 * LogicTickerWidget.test.ts — LogicTickerWidget migration unit tests
 *
 * Tests focus on: callback invocation, tick lifecycle, invisible rendering.
 */

import { describe, it, expect, vi } from 'vitest'
import { LogicTickerWidget } from './LogicTickerWidget.js'

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('LogicTickerWidget — construction', () => {
  it('creates with default empty onTick callback', () => {
    const w = new LogicTickerWidget()
    expect(w.onTick).toBeDefined()
    // default onTick is a no-op function
    expect(() => w.onTick()).not.toThrow()
    expect(w.onTick()).toBeUndefined()
  })

  it('sets ignoreMouseOver to true by default', () => {
    const w = new LogicTickerWidget()
    expect(w.ignoreMouseOver).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: tick invocation
// ---------------------------------------------------------------------------

describe('LogicTickerWidget — tick', () => {
  it('invokes the onTick callback on each tick', () => {
    const w = new LogicTickerWidget()
    const callback = vi.fn()
    w.onTick = callback

    w.tick()
    expect(callback).toHaveBeenCalledTimes(1)

    w.tick()
    w.tick()
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('invokes onTick even if assigned after construction', () => {
    const w = new LogicTickerWidget()

    // First tick with default (no-op) callback — should not throw
    w.tick()

    const callback = vi.fn()
    w.onTick = callback
    w.tick()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('supports reassigning onTick between ticks', () => {
    const w = new LogicTickerWidget()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    w.onTick = cb1
    w.tick()
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(0)

    w.onTick = cb2
    w.tick()
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('works with tickOuter lifecycle', () => {
    const w = new LogicTickerWidget()
    const callback = vi.fn()
    w.onTick = callback

    // tickOuter calls tick() internally
    w.tickOuter()
    expect(callback).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering (invisible)
// ---------------------------------------------------------------------------

describe('LogicTickerWidget — DOM rendering', () => {
  it('renders as a hidden div', () => {
    const w = new LogicTickerWidget()
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.style.display).toBe('none')
    expect(el.style.width).toBe('0px')
    expect(el.style.height).toBe('0px')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new LogicTickerWidget()
    w.id = 'game-ticker'
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('game-ticker')
  })

  it('does not consume mouse events', () => {
    const w = new LogicTickerWidget()
    const event = {
      type: 'mousedown',
      clientX: 0,
      clientY: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(false)
  })

  it('returns null cursor', () => {
    const w = new LogicTickerWidget()
    expect(w.getCursor({ x: 0, y: 0 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: visible / isVisible interaction
// ---------------------------------------------------------------------------

describe('LogicTickerWidget — visibility and tick', () => {
  it('tickOuter respects isVisible and skips tick when not visible', () => {
    const w = new LogicTickerWidget()
    const callback = vi.fn()
    w.onTick = callback
    w.visible = false
    w.isVisible = () => false

    w.tickOuter()
    expect(callback).toHaveBeenCalledTimes(0)
  })

  it('tickOuter calls tick when visible', () => {
    const w = new LogicTickerWidget()
    const callback = vi.fn()
    w.onTick = callback
    w.visible = true
    w.isVisible = () => true

    w.tickOuter()
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
