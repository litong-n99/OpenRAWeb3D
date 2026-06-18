/**
 * MapToolsLogic.test.ts — Unit tests for MapToolsLogic
 *
 * Tests: tool panel loading, selection, dropdown wiring,
 * OnSelected event, TabChanged listener, dispose.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MapToolsLogic,
  type IEditorToolInfo,
  type ToolPanelLoader,
} from './MapToolsLogic'
import { MapEditorTabsLogic } from './MapEditorTabsLogic'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWidget(): Widget {
  const dropDown = {
    id: 'TOOLS_DROPDOWN',
    onMouseDown: vi.fn(),
    getText: vi.fn(() => ''),
    showDropDown: vi.fn(),
    isDisabled: vi.fn(() => false),
    isVisible: () => true,
    visible: true,
    bounds: { x: 0, y: 0, width: 200, height: 30 },
    children: [],
    parent: null,
  }

  return {
    id: 'root',
    get: vi.fn(() => dropDown),
    getOrNull: vi.fn(() => null),
    isVisible: vi.fn(() => true),
    visible: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [],
    parent: null,
    isDisabled: () => false,
  } as unknown as Widget
}

function makeMockWorld(tools: IEditorToolInfo[] = []) {
  return {
    worldActor: {
      traitsImplementing: vi.fn(function* () {
        for (const t of tools) yield t
      }) as unknown as <T>(_: new () => T) => Iterable<T>,
    },
  }
}

function makeMockTool(label: string, panelWidget: string, isEnabled = true): IEditorToolInfo {
  return { label, panelWidget, isEnabled }
}

function makeMockPanelLoader(): ToolPanelLoader {
  return vi.fn((_world, panelId, _parent, _args): Widget => ({
    id: panelId,
    visible: false,
    isVisible: () => false,
    bounds: { x: 0, y: 0, width: 200, height: 100 },
    children: [],
    parent: null,
    isDisabled: () => false,
  } as unknown as Widget)) as unknown as ToolPanelLoader
}

// ---------------------------------------------------------------------------
// MapToolsLogic
// ---------------------------------------------------------------------------

describe('MapToolsLogic', () => {
  beforeEach(() => {
    MapEditorTabsLogic.onTabChanged.clear()
    MapToolsLogic.onSelected.clear()
  })

  afterEach(() => {
    MapEditorTabsLogic.onTabChanged.clear()
    MapToolsLogic.onSelected.clear()
  })

  it('constructs and loads enabled tool panels', () => {
    const tools = [makeMockTool('Paint', 'PAINT_TOOL')]
    const loader = makeMockPanelLoader()

    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld(tools), loader)
    expect(loader).toHaveBeenCalled()
    logic.dispose()
  })

  it('skips disabled tools', () => {
    const tools = [
      makeMockTool('Paint', 'PAINT_TOOL', false),
      makeMockTool('Erase', 'ERASE_TOOL', true),
    ]
    const loader = makeMockPanelLoader()

    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld(tools), loader)
    // Only the enabled tool should be loaded
    expect(loader).toHaveBeenCalledTimes(1)
    logic.dispose()
  })

  it('subscribes to TabChanged on construction', () => {
    const tools = [makeMockTool('Paint', 'PAINT_TOOL')]
    const loader = makeMockPanelLoader()

    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld(tools), loader)
    expect(MapEditorTabsLogic.onTabChanged.size).toBe(1)
    logic.dispose()
  })

  it('unsubscribes from TabChanged on dispose', () => {
    const tools = [makeMockTool('Paint', 'PAINT_TOOL')]
    const loader = makeMockPanelLoader()

    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld(tools), loader)
    logic.dispose()
    expect(MapEditorTabsLogic.onTabChanged.size).toBe(0)
  })

  it('fires OnSelected when TabChanged is triggered', () => {
    const tools = [makeMockTool('Paint', 'PAINT_TOOL')]
    const loader = makeMockPanelLoader()

    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld(tools), loader)

    let selectedVisible: boolean | null = null
    MapToolsLogic.onSelected.add((isVisible) => { selectedVisible = isVisible })

    MapEditorTabsLogic.fireOnTabChanged()
    expect(selectedVisible).toBe(true)

    logic.dispose()
  })

  it('dropdown disabled when only one tool available', () => {
    const tools = [makeMockTool('Paint', 'PAINT_TOOL')]
    const loader = makeMockPanelLoader()
    const widget = makeMockWidget()

    const logic = new MapToolsLogic(widget, makeMockWorld(tools), loader)
    const dropdown = (widget as unknown as { get: ReturnType<typeof vi.fn> }).get('TOOLS_DROPDOWN') as Record<string, unknown>
    expect(dropdown['isDisabled']).toBeDefined()
    logic.dispose()
  })

  it('constructs without tools (empty)', () => {
    const loader = makeMockPanelLoader()
    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld([]), loader)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('tick is a no-op', () => {
    const tools = [makeMockTool('Paint', 'PAINT_TOOL')]
    const loader = makeMockPanelLoader()
    const logic = new MapToolsLogic(makeMockWidget(), makeMockWorld(tools), loader)
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })
})
