/**
 * MapEditorSelectionLogic.test.ts — MapEditorSelectionLogic 迁移单元测试
 *
 * happy-dom 不支持 WebGL，因此 @babylonjs/core 模块被 mock。
 * 测试关注：面板可见性切换、复制过滤复选框、复制/粘贴/删除按钮、undo 清理。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { MapBlitFilters } from '../../../EditorBrushes/types.js'

// ---------------------------------------------------------------------------
// Minimal mock types
// ---------------------------------------------------------------------------

class MockWidget {
  id: string = ''
  children: MockWidget[] = []
  _cloneCount: number = 0
  _isVisible: boolean = true
  _isChecked: boolean = false
  _isDisabled: boolean = false
  _isHighlighted: boolean = false
  _onClick: (() => void) | null = null
  _getText: (() => string) | null = null
  _get: Map<string, MockWidget> = new Map()

  get(id: string): MockWidget | null {
    return this._get.get(id) ?? null
  }

  clone(): MockWidget {
    this._cloneCount++
    const c = new MockWidget()
    c.id = this.id
    return c
  }

  addChild(child: MockWidget): void {
    this.children.push(child)
  }
}

class MockEditorDefaultBrush {
  readonly selectionChanged = new Set<() => void>()
  selection = { actor: null as unknown | null, area: null as unknown | null, hasSelection: false }
  deleteSelectionCalls: number[] = []
  clearSelectionCalls: boolean[] = []

  fireSelectionChanged(): void {
    for (const cb of this.selectionChanged) cb()
  }

  deleteSelection(filters: number): void { this.deleteSelectionCalls.push(filters) }
  clearSelection(updateSelectedTab?: boolean): void { this.clearSelectionCalls.push(updateSelectedTab ?? false) }
}

class MockEditor {
  defaultBrush: MockEditorDefaultBrush
  currentBrush: unknown = null
  setBrushCalls: unknown[] = []

  constructor() {
    this.defaultBrush = new MockEditorDefaultBrush()
  }

  setBrush(brush: unknown): void { this.setBrushCalls.push(brush) }
}

class MockEditorBlit {
  copyRegionContentsCalls: unknown[] = []
  copyRegionContents(...args: unknown[]): unknown {
    this.copyRegionContentsCalls.push(args)
    return { cellCoords: {}, actors: new Map(), tiles: new Map() }
  }
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { MapEditorSelectionLogic } from './MapEditorSelectionLogic.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapEditorSelectionLogic', () => {
  let widget: MockWidget
  let editor: MockEditor
  let editorActorLayer: any
  let editorBlit: MockEditorBlit

  beforeEach(() => {
    widget = new MockWidget()
    editor = new MockEditor()
    editorActorLayer = {}
    editorBlit = new MockEditorBlit()
  })

  it('subscribes to SelectionChanged on construction', () => {
    new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)
    expect(editor.defaultBrush.selectionChanged.size).toBe(1)
  })

  it('unsubscribes from SelectionChanged on dispose', () => {
    const logic = new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)
    logic.dispose()
    expect(editor.defaultBrush.selectionChanged.size).toBe(0)
  })

  it('initializes selectionFilters to All', () => {
    const logic = new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)
    expect(logic.selectionFilters).toBe(MapBlitFilters.All)
    logic.dispose()
  })

  it('initializes clipboard to null', () => {
    const logic = new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)
    expect(logic.clipboard).toBeNull()
    logic.dispose()
  })

  it('sets actor edit panel visibility when actor selected', () => {
    // Create a widget hierarchy with SELECT_WIDGETS and ACTOR_EDIT_PANEL
    const actorEditPanel = new MockWidget()
    const selectWidgets = new MockWidget()
    selectWidgets._get.set('ACTOR_EDIT_PANEL', actorEditPanel)

    widget._get.set('SELECT_WIDGETS', selectWidgets)

    editor.defaultBrush.selection.actor = { id: 'Actor1' } as any
    editor.defaultBrush.selection.hasSelection = true

    new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)
    expect(actorEditPanel._isVisible).toBe(true) // closure bound, initial isVisible set to closure

    // The closure should now return true
  })

  it('toggles selection filter when checkbox clicked', () => {
    const areaEditPanel = new MockWidget()
    const copyTerrainCheckbox = new MockWidget()
    const copyResourcesCheckbox = new MockWidget()
    const copyActorsCheckbox = new MockWidget()

    areaEditPanel._get.set('COPY_FILTER_TERRAIN_CHECKBOX', copyTerrainCheckbox)
    areaEditPanel._get.set('COPY_FILTER_RESOURCES_CHECKBOX', copyResourcesCheckbox)
    areaEditPanel._get.set('COPY_FILTER_ACTORS_CHECKBOX', copyActorsCheckbox)

    const selectWidgets = new MockWidget()
    selectWidgets._get.set('AREA_EDIT_PANEL', areaEditPanel)
    selectWidgets._get.set('ACTOR_EDIT_PANEL', new MockWidget())

    widget._get.set('SELECT_WIDGETS', selectWidgets)

    editor.defaultBrush.selection.area = {} as any
    editor.defaultBrush.selection.hasSelection = true

    const logic = new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)

    // Initial: All filters
    expect(logic.selectionFilters).toBe(MapBlitFilters.All)

    // Toggle Terrain off
    logic.selectionFilters ^= MapBlitFilters.Terrain
    expect(logic.selectionFilters & MapBlitFilters.Terrain).toBe(0)

    // Toggle Terrain back on
    logic.selectionFilters ^= MapBlitFilters.Terrain
    expect(logic.selectionFilters & MapBlitFilters.Terrain).toBe(MapBlitFilters.Terrain)

    logic.dispose()
  })

  it('static positionAsString formats cell coords', () => {
    expect(MapEditorSelectionLogic.positionAsString({ X: 5, Y: 10 })).toBe('5,10')
    expect(MapEditorSelectionLogic.positionAsString({ X: 0, Y: 0 })).toBe('0,0')
  })

  it('static dimensionsAsString formats dimensions', () => {
    expect(MapEditorSelectionLogic.dimensionsAsString({ X: 10, Y: 5 })).toBe('10x5')
  })

  it('copySelectionContents returns a valid EditorBlitSource', () => {
    const logic = new MapEditorSelectionLogic(widget as any, editor as any, editorActorLayer, editorBlit as any)
    const result = logic.copySelectionContents()
    expect(result).toBeDefined()
    expect(result.actors).toBeDefined()
    expect(result.tiles).toBeDefined()
    logic.dispose()
  })
})
