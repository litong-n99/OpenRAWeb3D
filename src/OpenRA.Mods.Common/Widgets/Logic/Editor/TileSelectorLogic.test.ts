/**
 * TileSelectorLogic.test.ts — TileSelectorLogic migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not used.
 * Tests focus on: terrain info validation, category computation, search filtering,
 * and preview initialization.
 */

import { describe, it, expect, vi } from 'vitest'
import { TileSelectorLogic } from './TileSelectorLogic.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { createRecursiveMockWidget } from '../__test_utils.js'

// ---------------------------------------------------------------------------
// Test terrain data
// ---------------------------------------------------------------------------

/** Create a minimal tile template info stub for testing. */
function makeTemplateInfo(
  id: number,
  categories: string[],
  sizeX: number = 1,
  sizeY: number = 1,
) {
  return {
    id,
    categories,
    size: { x: sizeX, y: sizeY },
    contains: (_index: number) => true,
    tileAt: (_index: number) => null,
    pickAny: false,
    tilesCount: 1,
  }
}

/** Create a minimal ITileSelectorTerrainInfo for testing. */
function makeTerrainInfo() {
  const templates = [
    makeTemplateInfo(1, ['Cliff', 'Water']),
    makeTemplateInfo(2, ['Water']),
    makeTemplateInfo(3, ['Grass', 'Road']),
    makeTemplateInfo(4, ['Road', 'Cliff']),
  ]

  const templatesMap = new Map<number, ReturnType<typeof makeTemplateInfo>>()
  for (const t of templates) {
    templatesMap.set(t.id, t)
  }

  return {
    templatesInDefinitionOrder: templates,
    editorTemplateOrder: ['Road', 'Grass', 'Cliff', 'Water'],
    templates: templatesMap,
  }
}

// ---------------------------------------------------------------------------
// Mock setup for TileSelectorLogic widget tree
// ---------------------------------------------------------------------------

function createMockEditor(brushInstance: unknown = null) {
  return {
    defaultBrush: {
      onSelectionChanged: vi.fn(),
      offSelectionChanged: vi.fn(),
    },
    currentBrush: brushInstance,
    setBrush: vi.fn(),
    clearBrush: vi.fn(),
  }
}

function setupTileSelectorWidget(widget: Widget, _terrainInfo: unknown, brushInstance: unknown = null): void {
  const wr = widget as unknown as Record<string, unknown>

  // Panel mock (needs .get for itemTemplate resolution)
  const mockPanel = {
    addChild: vi.fn(),
    removeChildren: vi.fn(),
    children: [] as Widget[],
    bounds: { x: 0, y: 0, width: 400, height: 400 },
    isVisible: () => true,
    layout: null,
    get: vi.fn().mockImplementation((id: string) => {
      if (id === 'TILEPREVIEW_TEMPLATE') return mockItemTemplate
      return null
    }),
    getOrNull: vi.fn().mockImplementation((id: string) => {
      if (id === 'TILEPREVIEW_TEMPLATE') return mockItemTemplate
      return null
    }),
  }
  wr.panelWidget = mockPanel

  // Item template mock
  const mockItemTemplate = {
    id: 'TILEPREVIEW_TEMPLATE',
    bounds: { x: 0, y: 0, width: 120, height: 120 },
    isVisible: () => true,
    clone: vi.fn().mockReturnValue({
      id: 'cloned-tile-item',
      bounds: { x: 0, y: 0, width: 120, height: 120 },
      isVisible: () => true,
      isSelected: () => false,
      onClick: () => {},
      getOrNull: () => null,
      getTooltipText: null as (() => string) | null,
      addChild: vi.fn(),
    }),
  }

  // Search text field
  const stf = {
    _text: '',
    yieldKeyboardFocus: vi.fn(),
    onEscapeKey: null as ((e: unknown) => boolean) | null,
    onTextEdited: null as (() => void) | null,
  }

  // Category dropdown
  const categoryDD = {
    getText: null as (() => string) | null,
    onMouseDown: null as ((e: unknown) => void) | null,
    removePanel: vi.fn(),
    attachPanel: vi.fn(),
    onClick: vi.fn(),
    showDropDown: vi.fn(),
    textColor: '#FFFFFFFF',
  }

  // Override widget.get
  const origGet = widget.get.bind(widget) as (id: string) => unknown
  widget.get = vi.fn().mockImplementation((id: string): unknown => {
    if (id === 'TILETEMPLATE_LIST') return mockPanel
    if (id === 'TILEPREVIEW_TEMPLATE') return mockItemTemplate
    if (id === 'SEARCH_TEXTFIELD') return stf
    if (id === 'CATEGORIES_DROPDOWN') return categoryDD
    return origGet(id)
  })

  // CATEGORY_FILTER_PANEL loading via Ui.loadWidget
  const mockCategoryPanel = createRecursiveMockWidget('CATEGORY_FILTER_PANEL')
  const mockSelectButtons = createRecursiveMockWidget('SELECT_CATEGORIES_BUTTONS')
  mockSelectButtons.bounds = { x: 0, y: 0, width: 200, height: 30 }
  mockCategoryPanel.addChild(mockSelectButtons)
  wr.categoryFilterPanel = mockCategoryPanel

  // MAP_EDITOR parent chain
  const mockEditor = createMockEditor(brushInstance)
  const outerParent = {
    get: vi.fn().mockImplementation(<T>(id: string): T => {
      if (id === 'MAP_EDITOR') return mockEditor as unknown as T
      return null as unknown as T
    }),
    parent: null,
    children: [] as Widget[],
  }
  const innerParent = {
    parent: outerParent,
    children: [] as Widget[],
  }
  ;(widget as unknown as Record<string, unknown>).parent = innerParent
}

function createWorldWithTerrain(terrainInfo: unknown): Record<string, unknown> {
  return {
    map: {
      rules: {
        terrainInfo,
        actors: {},
      },
      tiles: new Map(),
    },
    worldActor: {},
  }
}

function createWorldRenderer(terrainInfo: unknown): {
  world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
} {
  return {
    world: {
      map: createWorldWithTerrain(terrainInfo).map as Record<string, unknown>,
      worldActor: {},
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TileSelectorLogic', () => {
  describe('constructor', () => {
    it('throws when terrain info is not template-based', () => {
      const widget = createRecursiveMockWidget('tile-root')
      setupTileSelectorWidget(widget, { /* no templatesInDefinitionOrder */ })
      const wr = createWorldRenderer({ /* no templatesInDefinitionOrder */ })
      expect(
        () => new TileSelectorLogic(widget, {}, worldWithoutTerrain(), wr),
      ).toThrow('template-based')
    })

    it('initializes successfully with template-based terrain', () => {
      const widget = createRecursiveMockWidget('tile-root')
      const ti = makeTerrainInfo()
      setupTileSelectorWidget(widget, ti)
      const wr = createWorldRenderer(ti)
      const logic = new TileSelectorLogic(widget, {}, worldWithTerrain(ti), wr)
      expect(logic).toBeDefined()
    })

    it('computes allCategories from template categories, ordered by editorTemplateOrder', () => {
      const widget = createRecursiveMockWidget('tile-root')
      const ti = makeTerrainInfo()
      setupTileSelectorWidget(widget, ti)
      const wr = createWorldRenderer(ti)
      const logic = new TileSelectorLogic(widget, {}, worldWithTerrain(ti), wr)

      // Categories should be: Road, Grass, Cliff, Water (per editorTemplateOrder)
      // From templates: Cliff,Water ; Water ; Grass,Road ; Road,Cliff
      // Distinct: Cliff, Water, Grass, Road
      // Ordered by editorTemplateOrder: Road, Grass, Cliff, Water
      const cats = (logic as unknown as Record<string, unknown>).allCategories as string[] | undefined
      expect(cats).toEqual(['Road', 'Grass', 'Cliff', 'Water'])
    })

    it('initializes selectedCategories with all categories', () => {
      const widget = createRecursiveMockWidget('tile-root')
      const ti = makeTerrainInfo()
      setupTileSelectorWidget(widget, ti)
      const wr = createWorldRenderer(ti)
      const logic = new TileSelectorLogic(widget, {}, worldWithTerrain(ti), wr)

      const selCats = (logic as unknown as Record<string, unknown>).selectedCategories as Set<string> | undefined
      expect(selCats?.size).toBe(4)
      expect(selCats?.has('Road')).toBe(true)
      expect(selCats?.has('Grass')).toBe(true)
    })
  })

  describe('initializePreviews', () => {
    it('does not throw with valid terrain', () => {
      const widget = createRecursiveMockWidget('tile-root')
      const ti = makeTerrainInfo()
      setupTileSelectorWidget(widget, ti)
      const wr = createWorldRenderer(ti)
      const logic = new TileSelectorLogic(widget, {}, worldWithTerrain(ti), wr)

      // initializePreviews is called in constructor
      // No crash = test passes
      expect(logic).toBeDefined()
    })
  })

  describe('tick', () => {
    it('is a no-op', () => {
      const widget = createRecursiveMockWidget('tile-root')
      const ti = makeTerrainInfo()
      setupTileSelectorWidget(widget, ti)
      const wr = createWorldRenderer(ti)
      const logic = new TileSelectorLogic(widget, {}, worldWithTerrain(ti), wr)
      expect(() => logic.tick()).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function worldWithTerrain(terrainInfo: unknown): Record<string, unknown> {
  return { map: { rules: { terrainInfo } } }
}

function worldWithoutTerrain(): Record<string, unknown> {
  return { map: { rules: {} } }
}
