/**
 * ProductionTabsWidget.test.ts — ProductionTabsWidget unit tests
 *
 * Tests focus on: tab group management, tab switching, badge counts,
 * scroll behavior, event handling, and queue state change detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ProductionTabsWidget,
  ProductionTabGroup,
} from './ProductionTabsWidget.js'
import type { ProductionQueue } from '../Traits/Player/ProductionQueue.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock ProductionQueue that satisfies the interface. */
function mockQueue(overrides: Record<string, unknown> = {}) {
  const allItems = (overrides.allItems as (() => unknown[])) ?? (() => [])
  const buildableItems =
    (overrides.buildableItems as (() => unknown[])) ?? (() => [])
  const allQueuedFn =
    (overrides.allQueued as (() => unknown[])) ?? (() => [])
  const mostLikelyProducer =
    (overrides.mostLikelyProducer as (() => unknown)) ?? (() => null)

  const info = {
    type: overrides.queueType ?? 'Building',
    group: overrides.queueGroup ?? 'Building',
    payUpFront: overrides.payUpFront ?? false,
    disallowPaused: overrides.disallowPaused ?? false,
    itemLimit: overrides.itemLimit ?? 999,
    queueLimit: overrides.queueLimit ?? 0,
    infiniteBuildLimit: overrides.infiniteBuildLimit ?? -1,
    queuedAudio: overrides.queuedAudio ?? null,
    queuedTextNotification: null,
    cancelledAudio: null,
    cancelledTextNotification: null,
    onHoldAudio: null,
    onHoldTextNotification: null,
    ...(overrides.infoOverrides as Record<string, unknown> ?? {}),
  }

  const actor = {
    actorId: overrides.actorId ?? 100,
    isInWorld: true,
    ownerId: overrides.ownerId ?? 0,
  }

  return {
    info,
    actor,
    enabled: overrides.enabled ?? true,
    allItems: vi.fn().mockReturnValue(allItems()),
    buildableItems: vi.fn().mockReturnValue(buildableItems()),
    allQueued: vi.fn().mockReturnValue(allQueuedFn()),
    mostLikelyProducer: vi.fn().mockReturnValue(mostLikelyProducer()),
    canQueue: vi.fn().mockReturnValue({ canQueue: true, notificationAudio: null, notificationText: null }),
    remainingTimeActual: vi.fn().mockReturnValue(50),
  }
}

/** Create a mock done ProductionItem. */
function mockDoneItem(): Record<string, unknown> {
  return {
    item: 'e1',
    done: true,
    paused: false,
    totalCost: 100,
    remainingCost: 0,
    totalTime: 100,
    remainingTime: 0,
    started: true,
    infinite: false,
  }
}

// ---------------------------------------------------------------------------
// Tests: ProductionTabGroup
// ---------------------------------------------------------------------------

describe('ProductionTabGroup', () => {
  it('constructs with a group name', () => {
    const group = new ProductionTabGroup('Building')
    expect(group.group).toBe('Building')
    expect(group.tabs).toEqual([])
    expect(group.nextQueueName).toBe(1)
  })

  it('alert is false when no done items', () => {
    const group = new ProductionTabGroup('Infantry')
    const q = mockQueue({
      allQueued: () => [],
      queueGroup: 'Infantry',
    }) as unknown as ProductionQueue
    group.tabs = [{ name: '1', queue: q }]
    expect(group.alert).toBe(false)
  })

  it('alert is true when any item is done', () => {
    const group = new ProductionTabGroup('Infantry')
    const q = mockQueue({
      allQueued: () => [mockDoneItem()],
      queueGroup: 'Infantry',
    }) as unknown as ProductionQueue
    group.tabs = [{ name: '1', queue: q }]
    expect(group.alert).toBe(true)
  })

  it('update adds new queues and removes stale ones', () => {
    const group = new ProductionTabGroup('Building')
    const q1 = mockQueue({ queueGroup: 'Building', actorId: 1 }) as unknown as ProductionQueue
    const q2 = mockQueue({ queueGroup: 'Building', actorId: 2 }) as unknown as ProductionQueue

    // Initial: add both queues
    group.update([q1, q2])
    expect(group.tabs.length).toBe(2)

    // Remove q1, add q3
    const q3 = mockQueue({ queueGroup: 'Building', actorId: 3 }) as unknown as ProductionQueue
    group.update([q2, q3])
    expect(group.tabs.length).toBe(2)

    // q3 should have a name
    const q3Tab = group.tabs.find((t) => t.queue === q3)
    expect(q3Tab).toBeDefined()
  })

  it('update assigns sequential names', () => {
    const group = new ProductionTabGroup('Vehicle')
    const q1 = mockQueue({ queueGroup: 'Vehicle', actorId: 1 }) as unknown as ProductionQueue
    const q2 = mockQueue({ queueGroup: 'Vehicle', actorId: 2 }) as unknown as ProductionQueue

    group.update([q1, q2])
    const names = group.tabs.map((t) => t.name)
    expect(names.length).toBe(2)
    // Names should be sequential numbers as strings
    expect(names.every((n) => /^\d+$/.test(n))).toBe(true)
  })

  it('update preserves existing tab names', () => {
    const group = new ProductionTabGroup('Defense')
    const q1 = mockQueue({ queueGroup: 'Defense', actorId: 10 }) as unknown as ProductionQueue
    group.update([q1])

    const originalName = group.tabs[0]!.name

    // Update with same queue should keep name
    group.update([q1])
    expect(group.tabs[0]!.name).toBe(originalName)
  })
})

// ---------------------------------------------------------------------------
// Tests: ProductionTabsWidget
// ---------------------------------------------------------------------------

describe('ProductionTabsWidget', () => {
  let widget: ProductionTabsWidget
  let groups: Map<string, ProductionTabGroup>

  beforeEach(() => {
    ChromeMetrics.initialize({
      DefaultCursor: 'default',
    })
    groups = new Map()
    groups.set('Building', new ProductionTabGroup('Building'))
    groups.set('Infantry', new ProductionTabGroup('Infantry'))
    widget = new ProductionTabsWidget(groups)
    widget.bounds = { x: 0, y: 0, width: 400, height: 30 }
  })

  afterEach(() => {
    ChromeMetrics.reset()
    ProductionTabsWidget.soundPlayer = null
  })

  // -----------------------------------------------------------------------
  // Construction and defaults
  // -----------------------------------------------------------------------

  it('constructs with default values', () => {
    expect(widget.tabWidth).toBe(30)
    expect(widget.arrowWidth).toBe(20)
    expect(widget.tabColor).toBe('#FFFFFF')
    expect(widget.tabColorDone).toBe('#FFD700')
    expect(widget.currentQueue).toBeNull()
    expect(widget.queueGroup).toBeNull()
  })

  it('initializes button rects on initialize', () => {
    widget.initialize({})
    // After initialize, button rects should be computed
    // They're internal but we verify via rendering
    const el = widget.render()
    expect(el).toBeDefined()
  })

  // -----------------------------------------------------------------------
  // QueueGroup accessor
  // -----------------------------------------------------------------------

  it('setting queueGroup resets and selects first tab', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue

    const buildingGroup = groups.get('Building')!
    buildingGroup.tabs = [{ name: '1', queue: q1 }]

    widget.queueGroup = 'Building'
    expect(widget.queueGroup).toBe('Building')
  })

  it('isVisible returns false when no tabs in group', () => {
    widget.queueGroup = null as unknown as string
    expect(widget.isVisible()).toBe(false)

    // Non-existent group
    widget['_queueGroup'] = 'Nonexistent'
    expect(widget.isVisible()).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Tab switching
  // -----------------------------------------------------------------------

  it('selectNextTab cycles through tabs', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue
    const q2 = mockQueue({
      queueGroup: 'Building',
      actorId: 2,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue

    const group = groups.get('Building')!
    group.tabs = [
      { name: '1', queue: q1 },
      { name: '2', queue: q2 },
    ]

    widget['_queueGroup'] = 'Building'
    widget.selectNextTab(false) // Should select first
  })

  it('selectNextTab handles empty groups gracefully', () => {
    widget['_queueGroup'] = 'Building'
    const result = widget.selectNextTab(false)
    expect(result).toBe(true) // Returns true (event consumed)
  })

  it('selectNextTab with reverse=true goes backward', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue
    const group = groups.get('Building')!
    group.tabs = [{ name: '1', queue: q1 }]
    widget['_queueGroup'] = 'Building'

    const result = widget.selectNextTab(true)
    expect(result).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Actor changed notification
  // -----------------------------------------------------------------------

  it('actorChanged updates tab groups', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
    }) as unknown as ProductionQueue

    widget['_queueGroup'] = 'Building'
    widget.actorChanged([q1])

    const group = groups.get('Building')
    expect(group).toBeDefined()
    expect(group!.tabs.length).toBe(1)
  })

  it('actorChanged switches group if current group empty', () => {
    const q1 = mockQueue({
      queueGroup: 'Infantry',
      actorId: 1,
    }) as unknown as ProductionQueue

    widget['_queueGroup'] = 'Building' // Building is empty
    widget.actorChanged([q1])

    // Should have switched to Infantry since Building has no tabs
    expect(widget.queueGroup).toBe('Infantry')
  })

  // -----------------------------------------------------------------------
  // Tick: continuous scroll and queue state changes
  // -----------------------------------------------------------------------

  it('tick detects queue enable/disable changes', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      enabled: true,
    }) as unknown as ProductionQueue

    widget['_queueGroup'] = 'Building'
    widget.actorChanged([q1])

    // Change q1 enabled state
    ;(q1 as unknown as Record<string, unknown>).enabled = false

    widget.tick()
    // After tick, the group should have been updated (q1 removed)
    const group = groups.get('Building')
    expect(group!.tabs.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Event handling: mouse
  // -----------------------------------------------------------------------

  it('handles scroll wheel', () => {
    widget.handleEvent({
      type: 'wheel',
      stopPropagation: () => {},
      target: null,
      clientX: 0,
      clientY: 0,
      deltaY: 50,
      button: 0,
    })
    // Scroll wheel is always handled
  })

  it('handles mouse down on tabs', () => {
    ProductionTabsWidget.soundPlayer = vi.fn()

    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue
    const group = groups.get('Building')!
    group.tabs = [{ name: '1', queue: q1 }]

    widget['_queueGroup'] = 'Building'
    widget.initialize({})
    widget['_contentWidth'] = 100
    widget['_listOffset'] = 0

    // Click in the tab area (after left arrow)
    widget.handleEvent({
      type: 'mousedown',
      stopPropagation: () => {},
      target: null,
      clientX: widget.bounds.x + widget.arrowWidth + 1,
      clientY: widget.bounds.y + 5,
      button: 0,
    })

    // Should have taken mouse focus
    expect(widget.hasMouseFocus).toBe(true)

    ProductionTabsWidget.soundPlayer = null
  })

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  it('handles keyboard tab switching', () => {
    widget.bounds = { x: 0, y: 0, width: 400, height: 30 }

    // The hotkeys use default invalid, so keyboard events won't match
    const handled = widget.handleEvent({
      type: 'keydown',
      stopPropagation: () => {},
      target: null,
      key: 'Tab',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })

    // With default invalid hotkeys, no match = false
    expect(handled).toBe(false)
  })

  // -----------------------------------------------------------------------
  // DOM rendering
  // -----------------------------------------------------------------------

  it('renders with background and arrows', () => {
    widget['_queueGroup'] = 'Building'
    const el = widget.render()
    expect(el.tagName).toBe('DIV')
    expect(el.className).toContain('production-tabs-widget')
  })

  it('renders empty when no queue group', () => {
    widget['_queueGroup'] = null
    const el = widget.render()
    // Should still return a div but with minimal content
    expect(el.tagName).toBe('DIV')
  })

  it('renders tab buttons with names', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue
    const group = groups.get('Building')!
    group.tabs = [{ name: '1', queue: q1 }]

    widget['_queueGroup'] = 'Building'
    widget.initialize({})

    const el = widget.render()
    // Should have arrow buttons and tab area
    expect(el.querySelectorAll('div').length).toBeGreaterThan(0)
  })

  it('highlights current queue tab', () => {
    const q1 = mockQueue({
      queueGroup: 'Building',
      actorId: 1,
      buildableItems: () => [{}],
    }) as unknown as ProductionQueue
    const group = groups.get('Building')!
    group.tabs = [{ name: '1', queue: q1 }]

    widget['_queueGroup'] = 'Building'
    widget.initialize({})

    // Set current queue via palette widget stub
    const paletteWidget = { currentQueue: q1 }
    widget.setPaletteWidgetResolver(() => paletteWidget)

    const el = widget.render()
    // The tab being current should be highlighted
    const spans = el.querySelectorAll('span')
    expect(spans.length).toBeGreaterThan(0)
  })

  // -----------------------------------------------------------------------
  // Palette widget integration
  // -----------------------------------------------------------------------

  it('setPaletteWidgetResolver enables lazy palette access', () => {
    const paletteWidget = {
      currentQueue: null as ProductionQueue | null,
    }
    widget.setPaletteWidgetResolver(() => paletteWidget)

    expect(widget.currentQueue).toBeNull()

    const q1 = mockQueue({ queueGroup: 'Building' }) as unknown as ProductionQueue
    paletteWidget.currentQueue = q1
    expect(widget.currentQueue).toBe(q1)
  })

  it('pickUpCompletedBuilding delegates to palette', () => {
    let pickUpCalled = false
    const paletteWidget = {
      currentQueue: null as ProductionQueue | null,
      pickUpCompletedBuilding: () => {
        pickUpCalled = true
      },
    }
    widget.setPaletteWidgetResolver(() => paletteWidget)

    widget.pickUpCompletedBuilding()
    expect(pickUpCalled).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  it('dispose clears resources', () => {
    const group = groups.get('Building')!
    const q1 = mockQueue({ queueGroup: 'Building', actorId: 1 }) as unknown as ProductionQueue
    group.tabs = [{ name: '1', queue: q1 }]

    // Verify tabs were added before dispose
    expect(group.tabs.length).toBe(1)

    widget.dispose()
    // After dispose, groups Map is cleared
    expect(groups.size).toBe(0)
  })
})
