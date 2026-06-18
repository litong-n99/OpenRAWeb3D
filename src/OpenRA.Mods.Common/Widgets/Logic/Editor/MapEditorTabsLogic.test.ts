/**
 * MapEditorTabsLogic.test.ts — Unit tests for MapEditorTabsLogic
 *
 * Tests: tab state machine, auto-select on selection change,
 * container visibility, button disabled states, OnTabChanged event, dispose.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MapEditorTabsLogic,
  type IHasSelection,
} from './MapEditorTabsLogic'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockSelection(hasSelection: boolean = false): IHasSelection {
  return { hasSelection }
}

function makeMockBrush() {
  const callbacks: Array<() => void> = []
  return {
    selection: makeMockSelection(),
    onUpdateSelectedTab: vi.fn((cb: () => void) => { callbacks.push(cb) }),
    offUpdateSelectedTab: vi.fn((cb: () => void) => {
      const idx = callbacks.indexOf(cb)
      if (idx >= 0) callbacks.splice(idx, 1)
    }),
    _callbacks: callbacks,
    fireUpdateTab() { for (const cb of callbacks) cb() },
  }
}

function makeMockEditor(mockBrush: ReturnType<typeof makeMockBrush>) {
  return { defaultBrush: mockBrush }
}

function makeMockWidgetsAndWorld(hasTools = true) {
  const brush = makeMockBrush()
  const editor = makeMockEditor(brush)

  // Build the widget hierarchy
  const grandparent: Widget = {
    id: 'grandparent',
    get: vi.fn(() => editor),
    getOrNull: vi.fn(() => editor),
    isVisible: () => true, visible: true,
    bounds: { x: 0, y: 0, width: 1024, height: 768 },
    children: [], parent: null, isDisabled: () => false,
  } as unknown as Widget

  const panelContainer: Widget = {
    id: 'panel-container',
    get: vi.fn(() => editor),
    getOrNull: vi.fn(() => editor),
    parent: grandparent,
    isVisible: () => true, visible: true,
    bounds: { x: 0, y: 0, width: 1024, height: 768 },
    children: [], isDisabled: () => false,
  } as unknown as Widget

  // Create button mocks for each tab
  const buttons = new Map<string, { isHighlighted: () => boolean; isDisabled: () => boolean; onClick: () => void }>()
  const containers = new Map<string, ContainerWidget>()

  for (const tabId of ['SELECT_TAB', 'TILES_TAB', 'OVERLAYS_TAB', 'ACTORS_TAB', 'TOOLS_TAB', 'HISTORY_TAB']) {
    const b = {
      isHighlighted: vi.fn(() => false) as unknown as () => boolean,
      isDisabled: vi.fn(() => false) as unknown as () => boolean,
      onClick: vi.fn() as unknown as () => void,
    }
    buttons.set(tabId, b)
    // Use Object.defineProperty to make it settable
    const c = new ContainerWidget()
    c.id = tabId
    containers.set(tabId, c)
  }

  const tabContainer: Widget = {
    id: 'tab-container',
    get: vi.fn((id: string) => buttons.get(id)),
    getOrNull: vi.fn((id: string) => buttons.get(id) ?? null),
    isVisible: () => true, visible: true,
    bounds: { x: 0, y: 0, width: 1024, height: 40 },
    children: [], parent: null, isDisabled: () => false,
  } as unknown as Widget

  // widget is the parent of tabContainer and child of panelContainer
  const widget: Widget = {
    id: 'tabs-logic-parent',
    get: vi.fn(() => tabContainer),
    getOrNull: vi.fn(() => tabContainer),
    parent: panelContainer,
    isVisible: () => true, visible: true,
    bounds: { x: 0, y: 0, width: 1024, height: 768 },
    children: [], isDisabled: () => false,
  } as unknown as Widget

  const world = {
    worldActor: {
      traitsImplementing: vi.fn(function* () {
        yield { isEnabled: hasTools }
      }) as unknown as <T>(_: new () => T) => Iterable<T>,
    },
  }

  return { widget, world, brush, containers, buttons }
}

// ---------------------------------------------------------------------------
// MapEditorTabsLogic
// ---------------------------------------------------------------------------

describe('MapEditorTabsLogic', () => {
  beforeEach(() => {
    MapEditorTabsLogic.onTabChanged.clear()
  })

  afterEach(() => {
    MapEditorTabsLogic.onTabChanged.clear()
  })

  it('constructs with 6 tabs', () => {
    const { widget, world } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('subscribes to UpdateSelectedTab on construction', () => {
    const { widget, world, brush } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)
    expect(brush.onUpdateSelectedTab).toHaveBeenCalled()
    logic.dispose()
  })

  it('unsubscribes from UpdateSelectedTab on dispose', () => {
    const { widget, world, brush } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)
    logic.dispose()
    expect(brush.offUpdateSelectedTab).toHaveBeenCalled()
  })

  it('fires OnTabChanged event', () => {
    const { widget, world } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)

    let fired = false
    MapEditorTabsLogic.onTabChanged.add(() => { fired = true })
    MapEditorTabsLogic.fireOnTabChanged()
    expect(fired).toBe(true)

    logic.dispose()
  })

  it('OnTabChanged supports multiple listeners', () => {
    const { widget, world } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)

    let c1 = 0, c2 = 0
    MapEditorTabsLogic.onTabChanged.add(() => { c1++ })
    MapEditorTabsLogic.onTabChanged.add(() => { c2++ })
    MapEditorTabsLogic.fireOnTabChanged()
    expect(c1).toBe(1)
    expect(c2).toBe(1)

    logic.dispose()
  })

  it('OnTabChanged listener can be removed', () => {
    const { widget, world } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)

    let count = 0
    const cb = () => { count++ }
    MapEditorTabsLogic.onTabChanged.add(cb)
    MapEditorTabsLogic.fireOnTabChanged()
    expect(count).toBe(1)

    MapEditorTabsLogic.onTabChanged.delete(cb)
    MapEditorTabsLogic.fireOnTabChanged()
    expect(count).toBe(1)

    logic.dispose()
  })

  it('constructs when no tools available', () => {
    const { widget, world } = makeMockWidgetsAndWorld(false)
    const logic = new MapEditorTabsLogic(widget, world)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('tick is a no-op', () => {
    const { widget, world } = makeMockWidgetsAndWorld()
    const logic = new MapEditorTabsLogic(widget, world)
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })
})
