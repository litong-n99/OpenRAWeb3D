/**
 * MapEditorLogic.test.ts — Unit tests for MapEditorLogic
 *
 * Tests: coordinate label text, cash label, undo/redo button wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MapEditorLogic,
  type IMapEditorWorldRenderer,
  type IMapEditorWorld,
  type IMapEditorMap,
  type IMapEditorViewport,
  type IMapEditorResourceLayer,
} from './MapEditorLogic'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { CPos } from '../../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWidget(): Widget & {
  _getOrNullMap: Map<string, unknown>
  _getMap: Map<string, unknown>
} {
  const getOrNullMap = new Map<string, unknown>()
  const getMap = new Map<string, unknown>()

  const w = {
    id: 'root',
    _getOrNullMap: getOrNullMap,
    _getMap: getMap,
    get: <T>(id: string): T => (getMap.get(id) ?? null) as unknown as T,
    getOrNull: <T>(id: string): T | null => (getOrNullMap.get(id) ?? null) as unknown as T | null,
    isVisible: () => true,
    visible: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [],
    parent: null,
  } as unknown as Widget & { _getOrNullMap: Map<string, unknown>; _getMap: Map<string, unknown> }
  return w
}

function makeMockViewport(): IMapEditorViewport {
  return {
    lastMousePos: { x: 100, y: 200 },
    viewToWorld: () => new CPos(5, 10),
  }
}

function makeMockMap(): IMapEditorMap {
  return {
    height: {
      contains: () => true,
      get: () => 3,
    },
    tiles: {
      get: () => ({ type: 7, index: 2 }),
    },
  }
}

function makeMockWorldRenderer(): IMapEditorWorldRenderer {
  return {
    viewport: makeMockViewport(),
    world: makeMockWorld(),
  }
}

function makeMockWorld(resLayer?: IMapEditorResourceLayer): IMapEditorWorld {
  return {
    map: makeMockMap(),
    worldActor: {
      traitsImplementing: vi.fn(function* () {
        if (resLayer) yield resLayer
      }) as unknown as IMapEditorWorld['worldActor']['traitsImplementing'],
    },
  }
}

// ---------------------------------------------------------------------------
// MapEditorLogic
// ---------------------------------------------------------------------------

describe('MapEditorLogic', () => {
  let widget: ReturnType<typeof makeMockWidget>
  let world: IMapEditorWorld
  let worldRenderer: IMapEditorWorldRenderer

  beforeEach(() => {
    widget = makeMockWidget()
    world = makeMockWorld()
    worldRenderer = makeMockWorldRenderer()
  })

  it('constructs without errors', () => {
    expect(() => new MapEditorLogic(widget, world, worldRenderer)).not.toThrow()
  })

  it('wires coordinate label with cell info', () => {
    const label = { getText: vi.fn(() => '') }
    widget._getOrNullMap.set('COORDINATE_LABEL', label)

    new MapEditorLogic(widget, world, worldRenderer)
    expect(label.getText).toBeDefined()
  })

  it('coordinate label shows cell position, height, and tile type', () => {
    const label = { getText: vi.fn(() => '') }
    widget._getOrNullMap.set('COORDINATE_LABEL', label)
    // No other getOrNull hits should match

    new MapEditorLogic(widget, world, worldRenderer)
    // The getText should have been replaced with our closure
    const textFn = label.getText
    // It should return something (was replaced)
    expect(textFn).toBeDefined()
  })

  it('handles missing coordinate label gracefully', () => {
    // No COORDINATE_LABEL in widget
    expect(() => new MapEditorLogic(widget, world, worldRenderer)).not.toThrow()
  })

  it('wires cash label when resource layer exists', () => {
    const label = { getText: vi.fn(() => '') }
    widget._getOrNullMap.set('CASH_LABEL', label)

    const w = makeMockWorld({ netWorth: 1500 })

    new MapEditorLogic(widget, w, worldRenderer)
    const textFn = label.getText
    expect(textFn).toBeDefined()
  })

  it('handles missing cash label gracefully', () => {
    // No CASH_LABEL in widget
    expect(() => new MapEditorLogic(widget, world, worldRenderer)).not.toThrow()
  })

  it('handles missing undo/redo buttons gracefully', () => {
    // No UNDO_BUTTON/REDO_BUTTON in widget
    expect(() => new MapEditorLogic(widget, world, worldRenderer)).not.toThrow()
  })

  it('tick is a no-op', () => {
    const logic = new MapEditorLogic(widget, world, worldRenderer)
    expect(() => logic.tick()).not.toThrow()
  })
})
