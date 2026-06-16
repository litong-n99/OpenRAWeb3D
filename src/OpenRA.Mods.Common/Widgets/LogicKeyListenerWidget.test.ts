/**
 * LogicKeyListenerWidget.test.ts — LogicKeyListenerWidget migration unit tests
 *
 * Tests focus on: handler registration/removal, key event processing,
 * handler ordering, invisible rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogicKeyListenerWidget } from './LogicKeyListenerWidget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createKeydownEvent(key: string): WidgetEvent {
  return {
    type: 'keydown',
    key,
    stopPropagation: () => {},
    target: null,
  }
}

function createMouseEvent(): WidgetEvent {
  return {
    type: 'mousedown',
    clientX: 100,
    clientY: 100,
    stopPropagation: () => {},
    target: null,
  }
}

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('LogicKeyListenerWidget — construction', () => {
  it('creates with empty handler list', () => {
    const w = new LogicKeyListenerWidget()
    expect(w.handlerCount).toBe(0)
  })

  it('sets ignoreMouseOver to true by default', () => {
    const w = new LogicKeyListenerWidget()
    expect(w.ignoreMouseOver).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: addHandler
// ---------------------------------------------------------------------------

describe('LogicKeyListenerWidget — addHandler', () => {
  let widget: LogicKeyListenerWidget

  beforeEach(() => {
    widget = new LogicKeyListenerWidget()
  })

  it('registers a handler and increments count', () => {
    const handler = vi.fn(() => false)
    widget.addHandler(handler)
    expect(widget.handlerCount).toBe(1)
  })

  it('registers multiple handlers', () => {
    widget.addHandler(vi.fn(() => false))
    widget.addHandler(vi.fn(() => false))
    widget.addHandler(vi.fn(() => false))
    expect(widget.handlerCount).toBe(3)
  })

  it('allows adding the same handler reference multiple times', () => {
    const handler = vi.fn(() => false)
    widget.addHandler(handler)
    widget.addHandler(handler)
    expect(widget.handlerCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Tests: removeHandler
// ---------------------------------------------------------------------------

describe('LogicKeyListenerWidget — removeHandler', () => {
  it('removes a previously added handler', () => {
    const widget = new LogicKeyListenerWidget()
    const handler = vi.fn(() => false)
    widget.addHandler(handler)
    expect(widget.handlerCount).toBe(1)

    widget.removeHandler(handler)
    expect(widget.handlerCount).toBe(0)
  })

  it('does nothing when removing nonexistent handler', () => {
    const widget = new LogicKeyListenerWidget()
    const handler = vi.fn(() => false)
    // No error, handlerCount stays 0
    widget.removeHandler(handler)
    expect(widget.handlerCount).toBe(0)
  })

  it('removes only the specified handler', () => {
    const widget = new LogicKeyListenerWidget()
    const h1 = vi.fn(() => false)
    const h2 = vi.fn(() => false)
    widget.addHandler(h1)
    widget.addHandler(h2)

    widget.removeHandler(h1)
    expect(widget.handlerCount).toBe(1)

    // h2 should still be callable
    const event = createKeydownEvent('Enter')
    expect(widget.handleEvent(event)).toBe(false)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  it('clearHandlers removes all handlers', () => {
    const widget = new LogicKeyListenerWidget()
    widget.addHandler(vi.fn(() => false))
    widget.addHandler(vi.fn(() => false))
    widget.clearHandlers()
    expect(widget.handlerCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: handleEvent (key events)
// ---------------------------------------------------------------------------

describe('LogicKeyListenerWidget — handleEvent', () => {
  let widget: LogicKeyListenerWidget

  beforeEach(() => {
    widget = new LogicKeyListenerWidget()
  })

  it('calls registered handlers in order', () => {
    const order: number[] = []
    widget.addHandler(() => {
      order.push(1)
      return false
    })
    widget.addHandler(() => {
      order.push(2)
      return false
    })

    widget.handleEvent(createKeydownEvent('Escape'))
    expect(order).toEqual([1, 2])
  })

  it('stops calling handlers after first true return', () => {
    const h1 = vi.fn(() => true)
    const h2 = vi.fn(() => false)

    widget.addHandler(h1)
    widget.addHandler(h2)

    const result = widget.handleEvent(createKeydownEvent('Escape'))
    expect(result).toBe(true)
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(0)
  })

  it('returns false when all handlers return false', () => {
    widget.addHandler(() => false)
    widget.addHandler(() => false)

    const result = widget.handleEvent(createKeydownEvent('Enter'))
    expect(result).toBe(false)
  })

  it('returns false for non-keydown events', () => {
    widget.addHandler(vi.fn(() => true))
    const result = widget.handleEvent(createMouseEvent())
    expect(result).toBe(false)
  })

  it('returns false when no handlers registered', () => {
    const result = widget.handleEvent(createKeydownEvent('Escape'))
    expect(result).toBe(false)
  })

  it('passes correct key string to handler', () => {
    const handler = vi.fn(() => false)
    widget.addHandler(handler)

    widget.handleEvent(createKeydownEvent('F12'))
    expect(handler).toHaveBeenCalledWith('F12')
  })

  it('returns false for keydown event with empty key', () => {
    widget.addHandler(vi.fn(() => true))
    const event: WidgetEvent = {
      type: 'keydown',
      key: '',
      stopPropagation: () => {},
      target: null,
    }
    expect(widget.handleEvent(event)).toBe(false)
  })

  it('handles keydown with undefined key field', () => {
    widget.addHandler(vi.fn(() => true))
    const event: WidgetEvent = {
      type: 'keydown',
      stopPropagation: () => {},
      target: null,
    }
    expect(widget.handleEvent(event)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering (invisible)
// ---------------------------------------------------------------------------

describe('LogicKeyListenerWidget — DOM rendering', () => {
  it('renders as a hidden div', () => {
    const w = new LogicKeyListenerWidget()
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.style.display).toBe('none')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new LogicKeyListenerWidget()
    w.id = 'global-hotkey-listener'
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('global-hotkey-listener')
  })

  it('does not consume mouse events', () => {
    const w = new LogicKeyListenerWidget()
    w.addHandler(vi.fn(() => true))
    // Mouse events should be ignored (not even checked)
    expect(w.handleEvent(createMouseEvent())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: Edge cases
// ---------------------------------------------------------------------------

describe('LogicKeyListenerWidget — edge cases', () => {
  it('works with a complex handler chain', () => {
    const w = new LogicKeyListenerWidget()
    const captured: string[] = []

    w.addHandler((key) => {
      captured.push(`global:${key}`)
      return false // never consumes, lets everyone see
    })
    w.addHandler((key) => {
      if (key === 'Escape') {
        captured.push('escape-handled')
        return true
      }
      return false
    })
    w.addHandler((key) => {
      captured.push(`after:${key}`)
      return false
    })

    // Non-Escape key: all three fire
    w.handleEvent(createKeydownEvent('F1'))
    expect(captured).toEqual(['global:F1', 'after:F1'])

    // Escape key: first fires, second fires and returns true, third skipped
    captured.length = 0
    w.handleEvent(createKeydownEvent('Escape'))
    expect(captured).toEqual(['global:Escape', 'escape-handled'])
  })

  it('clearHandlers then addHandler works correctly', () => {
    const w = new LogicKeyListenerWidget()
    w.addHandler(vi.fn(() => true))
    w.clearHandlers()
    w.addHandler(vi.fn(() => false))

    expect(w.handlerCount).toBe(1)
    expect(w.handleEvent(createKeydownEvent('a'))).toBe(false)
  })
})
