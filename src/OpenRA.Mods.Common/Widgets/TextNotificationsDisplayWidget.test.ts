/**
 * TextNotificationsDisplayWidget.test.ts — TextNotificationsDisplayWidget migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: notification state management, DOM rendering, add/remove logic,
 * expiration behavior, fade-out animation triggering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TextNotificationsDisplayWidget,
  TextNotificationPool,
  type TextNotification,
} from './TextNotificationsDisplayWidget.js'

// ---------------------------------------------------------------------------
// Helper: create and configure widget for testing (avoids ChromeMetrics)
// ---------------------------------------------------------------------------

function createWidget(): TextNotificationsDisplayWidget {
  const w = new TextNotificationsDisplayWidget()
  w.bounds = { x: 0, y: 0, width: 400, height: 200 }
  // Set default cursor to avoid ChromeMetrics lookup in Widget.initialize()
  // Just set bounds directly (like other widget tests do)
  return w
}

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — construction', () => {
  it('creates with default configuration values', () => {
    const w = createWidget()
    expect(w.displayDurationMs).toBe(0)
    expect(w.itemSpacing).toBe(4)
    expect(w.bottomSpacing).toBe(0)
    expect(w.logLength).toBe(8)
    expect(w.hideOverflow).toBe(true)
  })

  it('can be constructed with custom logLength', () => {
    const w = createWidget()
    w.logLength = 6
    expect(w.logLength).toBe(6)
  })

  it('can be constructed with a display duration', () => {
    const w = createWidget()
    w.displayDurationMs = 5000
    expect(w.displayDurationMs).toBe(5000)
  })
})

// ---------------------------------------------------------------------------
// Tests: addNotification
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — addNotification', () => {
  let widget: TextNotificationsDisplayWidget

  beforeEach(() => {
    widget = createWidget()
  })

  afterEach(() => {
    widget.dispose()
  })

  it('adds a notification and creates a DOM element', () => {
    const notification: TextNotification = {
      text: 'Player joined the game',
      pool: 'chat' as TextNotificationPool,
    }
    widget.addNotification(notification)

    const el = widget.render()
    const container = el.querySelector('.notification-list')
    expect(container).not.toBeNull()
    const items = container!.querySelectorAll('.notification-item')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('Player joined the game')
  })

  it('adds multiple notifications', () => {
    for (let i = 0; i < 3; i++) {
      widget.addNotification({
        text: `Message ${i}`,
        pool: 'system' as TextNotificationPool,
      })
    }

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(3)
  })

  it('applies pool-based CSS class', () => {
    widget.addNotification({
      text: 'System message',
      pool: 'system' as TextNotificationPool,
    })

    const el = widget.render()
    const item = el.querySelector('.notification-item')!
    expect(item.classList.contains('notification-pool-system')).toBe(true)
  })

  it('enforces logLength limit by removing oldest notifications', () => {
    widget.logLength = 3

    for (let i = 0; i < 6; i++) {
      widget.addNotification({
        text: `Message ${i}`,
        pool: 'chat' as TextNotificationPool,
      })
    }

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('Message 3')
    expect(items[2].textContent).toBe('Message 5')
  })

  it('sets opacity transition for fade-in', () => {
    widget.addNotification({
      text: 'Test',
      pool: 'chat' as TextNotificationPool,
    })

    const el = widget.render()
    const item = el.querySelector('.notification-item') as HTMLElement
    expect(item.style.transition).toContain('opacity')
  })
})

// ---------------------------------------------------------------------------
// Tests: removeMostRecentNotification
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — removeMostRecentNotification', () => {
  let widget: TextNotificationsDisplayWidget

  beforeEach(() => {
    widget = createWidget()
  })

  afterEach(() => {
    widget.dispose()
  })

  it('removes the most recently added notification', () => {
    widget.addNotification({ text: 'First', pool: 'chat' as TextNotificationPool })
    widget.addNotification({ text: 'Second', pool: 'chat' as TextNotificationPool })

    widget.removeMostRecentNotification()

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('First')
  })

  it('handles empty state gracefully', () => {
    // Should not throw
    expect(() => widget.removeMostRecentNotification()).not.toThrow()
  })

  it('can be called multiple times', () => {
    widget.addNotification({ text: 'A', pool: 'chat' as TextNotificationPool })
    widget.addNotification({ text: 'B', pool: 'chat' as TextNotificationPool })
    widget.addNotification({ text: 'C', pool: 'chat' as TextNotificationPool })

    widget.removeMostRecentNotification()
    widget.removeMostRecentNotification()

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// Tests: expiration (tick-based)
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — expiration', () => {
  let widget: TextNotificationsDisplayWidget

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    widget = new TextNotificationsDisplayWidget()
    widget.bounds = { x: 0, y: 0, width: 400, height: 200 }
    widget.displayDurationMs = 5000
    // bounds are set directly; Widget.initialize() not called to avoid ChromeMetrics dependency
  })

  afterEach(() => {
    widget.dispose()
    vi.useRealTimers()
  })

  it('does not expire when displayDurationMs is 0', () => {
    widget.displayDurationMs = 0
    widget.addNotification({ text: 'No expiry', pool: 'chat' as TextNotificationPool })

    // Should NOT create an expiry timer for durationMs=0
    expect(widget.displayDurationMs).toBe(0)

    // Advance tick many times
    for (let i = 0; i < 100; i++) {
      widget.tick()
    }

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(1)
  })

  it('removes notification after displayDurationMs via tick', () => {
    widget.addNotification({ text: 'Expiring', pool: 'chat' as TextNotificationPool })

    // Initially present
    let el = widget.render()
    expect(el.querySelectorAll('.notification-item').length).toBe(1)

    // Advance time past expiration
    vi.advanceTimersByTime(6000)
    widget.tick()

    el = widget.render()
    expect(el.querySelectorAll('.notification-item').length).toBe(0)
  })

  it('removes only expired notifications (oldest first)', () => {
    widget.addNotification({ text: 'First', pool: 'chat' as TextNotificationPool })

    vi.advanceTimersByTime(2000)
    widget.addNotification({ text: 'Second', pool: 'chat' as TextNotificationPool })

    // Advance to expire First but not Second
    vi.advanceTimersByTime(4000) // Total: 6000ms from First, 4000ms from Second
    widget.tick()

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('Second')
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — DOM rendering', () => {
  let widget: TextNotificationsDisplayWidget

  beforeEach(() => {
    widget = createWidget()
  })

  afterEach(() => {
    widget.dispose()
  })

  it('renders as a div with text-notifications-display-widget class', () => {
    const el = widget.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('text-notifications-display-widget')
  })

  it('uses overflow: hidden when hideOverflow is true', () => {
    widget.hideOverflow = true
    const el = widget.render()
    expect(el.style.overflow).toBe('hidden')
  })

  it('uses overflow: visible when hideOverflow is false', () => {
    widget.hideOverflow = false
    const el = widget.render()
    expect(el.style.overflow).toBe('visible')
  })

  it('sets data-widget-id when id is set', () => {
    widget.id = 'notifications-panel'
    const el = widget.render()
    expect(el.getAttribute('data-widget-id')).toBe('notifications-panel')
  })

  it('renders notification container with column-reverse for bottom alignment', () => {
    widget.addNotification({ text: 'Test', pool: 'chat' as TextNotificationPool })
    const el = widget.render()
    const container = el.querySelector('.notification-list') as HTMLElement
    expect(container).not.toBeNull()
    expect(container.style.flexDirection).toBe('column-reverse')
  })

  it('does not consume mouse events (returns false from handleEvent)', () => {
    const event = {
      type: 'mousedown',
      clientX: 100,
      clientY: 100,
      stopPropagation: () => {},
      target: null,
    }
    expect(widget.handleEvent(event)).toBe(false)
  })

  it('returns null cursor', () => {
    expect(widget.getCursor({ x: 0, y: 0 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: data-pool attribute on DOM
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — pool classification', () => {
  let widget: TextNotificationsDisplayWidget

  beforeEach(() => {
    widget = createWidget()
  })

  afterEach(() => {
    widget.dispose()
  })

  it('sets data-pool attribute for each notification', () => {
    widget.addNotification({ text: 'Chat msg', pool: 'chat' as TextNotificationPool })
    widget.addNotification({ text: 'System msg', pool: 'system' as TextNotificationPool })

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items[0].getAttribute('data-pool')).toBe('chat')
    expect(items[1].getAttribute('data-pool')).toBe('system')
  })
})

// ---------------------------------------------------------------------------
// Tests: dispose cleanup
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — dispose', () => {
  it('clears all entries and timer on dispose', () => {
    const widget = createWidget()
    widget.displayDurationMs = 5000
    widget.addNotification({ text: 'Test', pool: 'chat' as TextNotificationPool })

    // Verify notification was added
    let el = widget.render()
    expect(el.querySelectorAll('.notification-item').length).toBe(1)

    widget.dispose()

    // After dispose, entries are cleared; render recreates container but no items
    el = widget.render()
    expect(el.querySelectorAll('.notification-item').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Concurrent operations
// ---------------------------------------------------------------------------

describe('TextNotificationsDisplayWidget — edge cases', () => {
  let widget: TextNotificationsDisplayWidget

  beforeEach(() => {
    widget = createWidget()
  })

  afterEach(() => {
    widget.dispose()
  })

  it('handles zero logLength gracefully', () => {
    widget.logLength = 0
    widget.addNotification({ text: 'Should be removed', pool: 'chat' as TextNotificationPool })

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    expect(items.length).toBe(0)
  })

  it('handles empty text notification', () => {
    widget.addNotification({ text: '', pool: 'system' as TextNotificationPool })

    const el = widget.render()
    const item = el.querySelector('.notification-item')!
    expect(item.textContent).toBe('')
  })

  it('maintains notification order (oldest first in entries)', () => {
    widget.addNotification({ text: '1', pool: 'chat' as TextNotificationPool })
    widget.addNotification({ text: '2', pool: 'chat' as TextNotificationPool })
    widget.addNotification({ text: '3', pool: 'chat' as TextNotificationPool })

    const el = widget.render()
    const items = el.querySelectorAll('.notification-item')
    // 在 DOM 中，由于 column-reverse，最后一个添加的（3）应该显示在底部
    expect(items[items.length - 1].textContent).toBe('3')
  })
})
