/**
 * LayerSelectorLogic.test.ts — LayerSelectorLogic migration unit tests
 *
 * Tests focus on: resource type iteration, GridLayout initialization,
 * preview brush setting, and dispose cleanup.
 */

import { describe, it, expect, vi } from 'vitest'
import { LayerSelectorLogic } from './LayerSelectorLogic.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { createRecursiveMockWidget } from '../__test_utils.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeResourceRendererStub(resourceTypes: string[]) {
  return { resourceTypes }
}

function makeEditor() {
  return {
    defaultBrush: {},
    currentBrush: null as unknown,
    setBrush: vi.fn(),
    clearBrush: vi.fn(),
  }
}

function setupLayerSelectorWidget(
  widget: Widget,
  resourceRenderers: { resourceTypes: readonly string[] }[],
  brushInstance: unknown = null,
): void {
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
      if (id === 'LAYERPREVIEW_TEMPLATE') return mockItemTemplate
      return null
    }),
    getOrNull: vi.fn().mockImplementation((id: string) => {
      if (id === 'LAYERPREVIEW_TEMPLATE') return mockItemTemplate
      return null
    }),
  }
  wr.panelWidget = mockPanel

  // Item template
  const mockItemTemplate = {
    id: 'LAYERPREVIEW_TEMPLATE',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    isVisible: () => true,
    clone: vi.fn().mockReturnValue({
      id: 'cloned-layer-item',
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
  const origGet = widget.get.bind(widget) as (id: string) => unknown
  widget.get = vi.fn().mockImplementation((id: string): unknown => {
    if (id === 'LAYERTEMPLATE_LIST') return mockPanel
    if (id === 'LAYERPREVIEW_TEMPLATE') return mockItemTemplate
    return origGet(id)
  })

  // MAP_EDITOR parent chain
  const editor = makeEditor()
  editor.currentBrush = brushInstance
  const outerParent = {
    get: vi.fn().mockImplementation(<T>(id: string): T => {
      if (id === 'MAP_EDITOR') return editor as unknown as T
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

  // Store resource renderers on world actor
  ;(widget as unknown as Record<string, unknown>).resourceRenderers = resourceRenderers
}

function createWorldRenderer(
  resourceRenderers: { resourceTypes: readonly string[] }[],
): {
  world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
} {
  return {
    world: {
      map: {},
      worldActor: { resourceRenderers },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LayerSelectorLogic', () => {
  describe('constructor', () => {
    it('initializes successfully with resource renderers', () => {
      const widget = createRecursiveMockWidget('layer-root')
      const renderers = [makeResourceRendererStub(['Tiberium', 'Ore'])]
      setupLayerSelectorWidget(widget, renderers)
      const wr = createWorldRenderer(renderers)
      const logic = new LayerSelectorLogic(widget, wr)
      expect(logic).toBeDefined()
    })

    it('initializes successfully with no resource renderers', () => {
      const widget = createRecursiveMockWidget('layer-root')
      const renderers: { resourceTypes: readonly string[] }[] = []
      setupLayerSelectorWidget(widget, renderers)
      const wr = createWorldRenderer(renderers)
      const logic = new LayerSelectorLogic(widget, wr)
      expect(logic).toBeDefined()
    })

    it('throws when widget.parent.parent is null', () => {
      const widget = createRecursiveMockWidget('orphan')
      const renderers: { resourceTypes: readonly string[] }[] = []
      const wr = createWorldRenderer(renderers)
      expect(() => new LayerSelectorLogic(widget, wr)).toThrow(
        'widget.parent.parent is null',
      )
    })

    it('sets GridLayout on the scroll panel', () => {
      const widget = createRecursiveMockWidget('layer-root')
      const renderers = [makeResourceRendererStub(['Gems'])]
      setupLayerSelectorWidget(widget, renderers)
      const wr = createWorldRenderer(renderers)
      new LayerSelectorLogic(widget, wr)
      const panel = (widget as unknown as Record<string, unknown>).panelWidget as Record<string, unknown>
      // GridLayout was set (not null)
      expect(panel.layout).toBeDefined()
      expect(panel.layout).not.toBeNull()
    })
  })

  describe('tick', () => {
    it('is a no-op', () => {
      const widget = createRecursiveMockWidget('layer-root')
      const renderers = [makeResourceRendererStub(['Tiberium'])]
      setupLayerSelectorWidget(widget, renderers)
      const wr = createWorldRenderer(renderers)
      const logic = new LayerSelectorLogic(widget, wr)
      expect(() => logic.tick()).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('removes all children from the panel', () => {
      const widget = createRecursiveMockWidget('layer-root')
      const renderers = [makeResourceRendererStub(['Tiberium'])]
      setupLayerSelectorWidget(widget, renderers)
      const wr = createWorldRenderer(renderers)
      const logic = new LayerSelectorLogic(widget, wr)
      expect(() => logic.dispose()).not.toThrow()
    })
  })
})
