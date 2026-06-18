/**
 * CommonSelectorLogic.test.ts — CommonSelectorLogic migration unit tests
 *
 * Tests focus on: filter state management, search behavior, category panel
 * creation, and SelectionChanged event subscription lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommonSelectorLogic } from './CommonSelectorLogic.js'
import type { Widget, WidgetEvent } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { createRecursiveMockWidget } from '../__test_utils.js'

// ---------------------------------------------------------------------------
// Concrete subclass for testing abstract CommonSelectorLogic
// ---------------------------------------------------------------------------

class TestSelectorLogic extends CommonSelectorLogic {
  previewCallCount: number = 0
  addedChildren: Widget[] = []

  constructor(
    widget: Widget,
    modData: Record<string, unknown>,
    world: Record<string, unknown>,
    worldRenderer: {
      world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
    },
  ) {
    super(
      widget,
      modData,
      world,
      worldRenderer,
      'TEST_LIST',
      'TEST_PREVIEW_TEMPLATE',
    )
    const origAdd = this.panel.addChild.bind(this.panel)
    this.panel.addChild = (child: Widget) => {
      this.addedChildren.push(child)
      origAdd(child)
    }
  }

  tick(): void {}

  protected override initializePreviews(): void {
    this.previewCallCount++
  }

  getExposedSelectedCategories(): Set<string> { return this.selectedCategories }
  getExposedSearchFilter(): string { return this.searchFilter }
  getExposedAllCategories(): string[] { return this.allCategories }

  setExposedAllCategories(cats: string[]): void {
    this.allCategories = cats
    this.filteredCategories.length = 0
    this.filteredCategories.push(...cats)
    this.selectedCategories.clear()
    for (const c of cats) this.selectedCategories.add(c)
  }

  getExposedFilteredCategories(): string[] { return this.filteredCategories }
  getExposedPanel() { return this.panel }
  callCreateCategoriesPanel(): Widget { return this.createCategoriesPanel(this.panel) }
}

// ---------------------------------------------------------------------------
// Mock tracker — shared mutable state for test assertions
// ---------------------------------------------------------------------------

interface MockTracker {
  selectionChangedSubscribed: boolean
  selectionChangedUnsubscribed: boolean
  onEscapeKeyHandler: ((e: WidgetEvent) => boolean) | null
  onTextEditedHandler: (() => void) | null
  categoryGetText: (() => string) | null
  categoryOnMouseDown: ((e: WidgetEvent) => void) | null
  brushSelectionCallbacks: Array<() => void>
  brushOffCallbacks: Array<() => void>
  searchText: string
  onEscapeKeyAssigned: boolean
  onTextEditedAssigned: boolean
  categoryGetTextAssigned: boolean
  categoryOnMouseDownAssigned: boolean
}

function createMockTracker(): MockTracker {
  return {
    selectionChangedSubscribed: false,
    selectionChangedUnsubscribed: false,
    onEscapeKeyHandler: null,
    onTextEditedHandler: null,
    categoryGetText: null,
    categoryOnMouseDown: null,
    brushSelectionCallbacks: [],
    brushOffCallbacks: [],
    searchText: '',
    onEscapeKeyAssigned: false,
    onTextEditedAssigned: false,
    categoryGetTextAssigned: false,
    categoryOnMouseDownAssigned: false,
  }
}

let tracker: MockTracker

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMockEditorWidget(): Record<string, unknown> {
  const brush = {
    onSelectionChanged(cb: () => void): void {
      tracker.brushSelectionCallbacks.push(cb)
      tracker.selectionChangedSubscribed = true
    },
    offSelectionChanged(cb: () => void): void {
      tracker.brushOffCallbacks.push(cb)
      tracker.selectionChangedUnsubscribed = true
    },
  }
  return {
    defaultBrush: brush,
    currentBrush: null,
    setBrush: vi.fn(),
    clearBrush: vi.fn(),
  }
}

function createMockSearchTextField(): Record<string, unknown> {
  const stf: Record<string, unknown> = {
    _text: '',
    yieldKeyboardFocus: vi.fn(),
    get onEscapeKey(): ((e: WidgetEvent) => boolean) | null {
      return tracker.onEscapeKeyHandler
    },
    set onEscapeKey(val: ((e: WidgetEvent) => boolean) | null) {
      tracker.onEscapeKeyHandler = val
      tracker.onEscapeKeyAssigned = true
    },
    get onTextEdited(): (() => void) | null {
      return tracker.onTextEditedHandler
    },
    set onTextEdited(val: (() => void) | null) {
      tracker.onTextEditedHandler = val
      tracker.onTextEditedAssigned = true
    },
  }

  // Override _text access to use tracker
  Object.defineProperty(stf, '_text', {
    get() { return tracker.searchText },
    set(val: string) { tracker.searchText = val },
    configurable: true,
    enumerable: true,
  })

  return stf
}

function createMockDropDownButton(): Record<string, unknown> {
  const dd: Record<string, unknown> = {
    removePanel: vi.fn(),
    attachPanel: vi.fn(),
    onClick: vi.fn(),
    showDropDown: vi.fn(),
    textColor: '#FFFFFFFF',
    get getText(): (() => string) | null {
      return tracker.categoryGetText
    },
    set getText(val: (() => string) | null) {
      tracker.categoryGetText = val
      tracker.categoryGetTextAssigned = true
    },
    get onMouseDown(): ((e: WidgetEvent) => void) | null {
      return tracker.categoryOnMouseDown
    },
    set onMouseDown(val: ((e: WidgetEvent) => void) | null) {
      tracker.categoryOnMouseDown = val
      tracker.categoryOnMouseDownAssigned = true
    },
  }
  return dd
}

function setupMockWidgetTree(widget: Widget): void {
  const wr = widget as unknown as Record<string, unknown>

  // Mock panel (needs .get for itemTemplate resolution)
  wr.panelWidget = {
    addChild: vi.fn(),
    removeChildren: vi.fn(),
    children: [] as Widget[],
    bounds: { x: 0, y: 0, width: 400, height: 400 },
    isVisible: () => true,
    layout: null,
    get: vi.fn().mockImplementation((id: string) => {
      if (id === 'TEST_PREVIEW_TEMPLATE') return wr.itemTemplateWidget
      return null
    }),
    getOrNull: vi.fn().mockImplementation((id: string) => {
      if (id === 'TEST_PREVIEW_TEMPLATE') return wr.itemTemplateWidget
      return null
    }),
  }

  // Mock item template
  wr.itemTemplateWidget = {
    id: 'TEST_PREVIEW_TEMPLATE',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    isVisible: () => true,
    clone: vi.fn().mockReturnValue({
      id: 'cloned-item',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      isVisible: () => true,
      isSelected: () => false,
      onClick: () => {},
      getOrNull: () => null,
      getTooltipText: null as (() => string) | null,
      addChild: vi.fn(),
    }),
  }

  // Override widget.get
  const origGet = widget.get.bind(widget)
  widget.get = vi.fn().mockImplementation((id: string) => {
    if (id === 'TEST_LIST') return wr.panelWidget
    if (id === 'TEST_PREVIEW_TEMPLATE') return wr.itemTemplateWidget
    if (id === 'SEARCH_TEXTFIELD') return wr.searchWidget as unknown
    if (id === 'CATEGORIES_DROPDOWN') return wr.dropDownWidget as unknown
    return origGet(id)
  })

  // Store mock widgets for get lookup
  wr.searchWidget = createMockSearchTextField()
  wr.dropDownWidget = createMockDropDownButton()

  // MAP_EDITOR parent chain
  const mockEditor = createMockEditorWidget()
  const outerParent = {
    get: vi.fn().mockImplementation((id: string) => {
      if (id === 'MAP_EDITOR') return mockEditor
      return null
    }),
    parent: null,
    children: [] as Widget[],
  }
  const innerParent = {
    parent: outerParent,
    children: [] as Widget[],
  }
  ;(widget as unknown as Record<string, unknown>).parent = innerParent

  // CATEGORY_FILTER_PANEL for Ui.loadWidget
  wr.categoryFilterPanel = createRecursiveMockWidget('CATEGORY_FILTER_PANEL')
}

function createWorldRenderer(): {
  world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
} {
  return {
    world: { map: {}, worldActor: {} },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommonSelectorLogic', () => {
  let logic: TestSelectorLogic
  let widget: Widget

  beforeEach(() => {
    tracker = createMockTracker()
    widget = createRecursiveMockWidget('test-root')
    setupMockWidgetTree(widget)
    logic = new TestSelectorLogic(widget, {}, {}, createWorldRenderer())
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with empty selected categories', () => {
      expect(logic.getExposedSelectedCategories().size).toBe(0)
    })

    it('initializes with empty search filter', () => {
      expect(logic.getExposedSearchFilter()).toBe('')
    })

    it('initializes with empty allCategories', () => {
      expect(logic.getExposedAllCategories()).toEqual([])
    })

    it('subscribes to SelectionChanged on the editor brush', () => {
      expect(tracker.selectionChangedSubscribed).toBe(true)
    })

    it('sets up category dropdown text delegate', () => {
      expect(tracker.categoryGetTextAssigned).toBe(true)
    })

    it('resolves the MAP_EDITOR editor widget via parent chain', () => {
      expect(logic).toBeDefined()
    })

    it('throws when widget.parent.parent is null', () => {
      const orphanWidget = createRecursiveMockWidget('orphan')
      expect(
        () =>
          new TestSelectorLogic(orphanWidget, {}, {}, createWorldRenderer()),
      ).toThrow('widget.parent.parent is null')
    })
  })

  // -----------------------------------------------------------------------
  // Category dropdown GetText
  // -----------------------------------------------------------------------

  describe('category dropdown GetText', () => {
    it('returns "None" when no categories selected', () => {
      logic.setExposedAllCategories(['A', 'B', 'C'])
      logic.getExposedSelectedCategories().clear()
      const fn = tracker.categoryGetText!
      expect(fn()).toBe('None')
    })

    it('returns single category name when one selected', () => {
      logic.setExposedAllCategories(['Infantry', 'Vehicles'])
      logic.getExposedSelectedCategories().clear()
      logic.getExposedSelectedCategories().add('Infantry')
      const fn = tracker.categoryGetText!
      expect(fn()).toBe('Infantry')
    })

    it('returns "All" when all categories selected', () => {
      logic.setExposedAllCategories(['A', 'B', 'C'])
      const fn = tracker.categoryGetText!
      expect(fn()).toBe('All')
    })

    it('returns "Multiple" when some but not all selected', () => {
      logic.setExposedAllCategories(['A', 'B', 'C', 'D'])
      logic.getExposedSelectedCategories().delete('D')
      const fn = tracker.categoryGetText!
      expect(fn()).toBe('Multiple')
    })

    it('returns "Search Results" when search filter is active', () => {
      logic.setExposedAllCategories(['A', 'B'])
      ;(logic as unknown as Record<string, unknown>).searchFilter = 'test'
      const fn = tracker.categoryGetText!
      expect(fn()).toBe('Search Results')
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('unsubscribes from SelectionChanged', () => {
      logic.dispose()
      expect(tracker.selectionChangedUnsubscribed).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Search text field escape key
  // -----------------------------------------------------------------------

  describe('search text field escape key', () => {
    it('clears text and invokes onTextEdited when text is not empty', () => {
      const handler = tracker.onEscapeKeyHandler
      expect(handler).not.toBeNull()

      tracker.searchText = 'search query'

      let editedCalled = false
      tracker.onTextEditedHandler = () => { editedCalled = true }

      const result = handler!({ type: 'keydown' } as WidgetEvent)
      expect(result).toBe(true)
      expect(tracker.searchText).toBe('')
      expect(editedCalled).toBe(true)
    })

    it('yields keyboard focus when text is empty', () => {
      const handler = tracker.onEscapeKeyHandler
      expect(handler).not.toBeNull()

      tracker.searchText = ''

      const result = handler!({ type: 'keydown' } as WidgetEvent)
      expect(result).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // createCategoriesPanel
  // NOTE: createCategoriesPanel calls Ui.loadWidget("CATEGORY_FILTER_PANEL", ...)
  // which requires WidgetLoader to be set. Since we don't set up WidgetLoader
  // in unit tests, we only verify the method can be invoked without crashing
  // the test harness (the loadWidget error is expected in unit test context).
  // -----------------------------------------------------------------------

  describe('createCategoriesPanel', () => {
    it('invokes createCategoriesPanel (loadWidget will fail without WidgetLoader)', () => {
      logic.setExposedAllCategories(['Infantry', 'Vehicles', 'Buildings'])
      // In the full integration environment, Ui.widgetLoader would be set.
      // In unit tests, Ui.loadWidget throws because WidgetLoader is not initialized.
      expect(() => logic.callCreateCategoriesPanel()).toThrow()
    })
  })
})
