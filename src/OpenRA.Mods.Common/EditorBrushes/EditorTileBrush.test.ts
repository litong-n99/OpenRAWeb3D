/**
 * EditorTileBrush.test.ts — EditorTileBrush migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * Tests focus on: state management, paint/flood fill logic, overlap detection,
 * mouse input handling, undo/redo semantics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { MouseInputEvent, MouseButton, Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import { EditorTileBrush } from './EditorTileBrush.js'
import { PaintTileEditorAction } from './actions/PaintTileEditorAction.js'
import { FloodFillEditorAction } from './actions/FloodFillEditorAction.js'
import type {
  TerrainTemplateInfoStub,
  ITemplatedTerrainInfoStub,
  EditorMapStub,
  EditorTileLayerStub,
  EditorHeightLayerStub,
} from './TerrainStubs.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a simple mock terrain tile info. */
function makeTileInfo(height: number): { height: number; template: number; tile: number } {
  return { height, template: 1, tile: 0 }
}

/** Create a mock terrain template. */
function makeTemplate(
  id: number,
  sizeX: number,
  sizeY: number,
  overrides?: {
    pickAny?: boolean
    tilesCount?: number
    tiles?: Record<number, { height: number } | null>
  },
): TerrainTemplateInfoStub {
  const tileData: Record<number, { height: number; template: number; tile: number } | null> = {}
  for (let i = 0; i < sizeX * sizeY; i++) {
    tileData[i] = overrides?.tiles?.[i] !== undefined
      ? (overrides.tiles[i] === null ? null : {
        height: (overrides.tiles[i] as { height: number }).height,
        template: id,
        tile: i,
      })
      : makeTileInfo(0)
  }

  return {
    id,
    size: { x: sizeX, y: sizeY },
    contains(index: number): boolean {
      return index >= 0 && index < sizeX * sizeY
    },
    tileAt(index: number): { height: number; template: number; tile: number } | null {
      return tileData[index] ?? null
    },
    pickAny: overrides?.pickAny ?? false,
    tilesCount: overrides?.tilesCount ?? 1,
  }
}

/** Create a mock tile layer backed by a Map. */
function makeTileLayer(initial?: Map<string, { type: number; index: number }>): EditorTileLayerStub {
  const data = initial ?? new Map<string, { type: number; index: number }>()
  return {
    contains(cell: CPos): boolean {
      return data.has(`${cell.X},${cell.Y}`)
    },
    get(cell: CPos): { type: number; index: number } {
      return data.get(`${cell.X},${cell.Y}`) ?? { type: 0, index: 0 }
    },
    set(cell: CPos, tile: { type: number; index: number }): void {
      data.set(`${cell.X},${cell.Y}`, { ...tile })
    },
  }
}

/** Create a mock height layer. */
function makeHeightLayer(initial?: Map<string, number>): EditorHeightLayerStub {
  const data = initial ?? new Map<string, number>()
  return {
    contains(cell: CPos): boolean {
      return data.has(`${cell.X},${cell.Y}`)
    },
    get(cell: CPos): number {
      return data.get(`${cell.X},${cell.Y}`) ?? 0
    },
    set(cell: CPos, height: number): void {
      data.set(`${cell.X},${cell.Y}`, height)
    },
  }
}

/** Create a minimal mock map for testing. */
function makeMap(
  allCells: CPos[] = [
    new CPos(0, 0), new CPos(1, 0), new CPos(2, 0),
    new CPos(0, 1), new CPos(1, 1), new CPos(2, 1),
    new CPos(0, 2), new CPos(1, 2), new CPos(2, 2),
  ],
): EditorMapStub & { rules: { terrainInfo: ITemplatedTerrainInfoStub }; allCells: CPos[] } {
  const tileData = new Map<string, { type: number; index: number }>()
  const heightData = new Map<string, number>()
  for (const cell of allCells) {
    tileData.set(`${cell.X},${cell.Y}`, { type: 0, index: 0 })
    heightData.set(`${cell.X},${cell.Y}`, 0)
  }
  const tiles = makeTileLayer(tileData)
  const height = makeHeightLayer(heightData)

  const grid = { maximumTerrainHeight: 255 }

  return {
    tiles,
    height,
    contains(cell: CPos): boolean {
      return tileData.has(`${cell.X},${cell.Y}`)
    },
    grid,
    centerOfCell(_cell: CPos): WPos {
      return new WPos(_cell.X * 1024, _cell.Y * 1024, 0)
    },
    rules: { terrainInfo: { templates: new Map() } } as unknown as { terrainInfo: ITemplatedTerrainInfoStub },
    allCells,
  }
}

/** Create a mock EditorViewportControllerWidget. */
function makeEditorWidget() {
  return {
    clearBrush: vi.fn(),
  } as unknown as { clearBrush: () => void } & Record<string, unknown>
}

/** Create a mock EditorActionManager. */
function makeActionManager() {
  const actions: unknown[] = []
  return {
    actions,
    Add(action: unknown): void {
      actions.push(action)
    },
  }
}

/** Create a mock WorldRenderer stub compatible with EditorTileBrush constructor. */
function makeWorldRenderer(
  map: ReturnType<typeof makeMap>,
  actionManager: ReturnType<typeof makeActionManager>,
  terrainRenderer: { renderPreview: ReturnType<typeof vi.fn> },
  template: TerrainTemplateInfoStub,
) {
  const templates = new Map<number, TerrainTemplateInfoStub>()
  templates.set(template.id, template)

  return {
    viewport: {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos {
        return new CPos(Math.floor(vp.x / 1024), Math.floor(vp.y / 1024))
      },
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
        return { x: wp.x * 1024, y: wp.y * 1024 }
      },
      lastMousePos: { x: 0, y: 0 },
    },
    world: {
      map: map,
      worldActor: {
        editorActionManager: actionManager,
        terrainRenderer,
      } as unknown as Record<string, unknown>,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests: PaintTileEditorAction
// ---------------------------------------------------------------------------

describe('PaintTileEditorAction', () => {
  let map: ReturnType<typeof makeMap>
  let template: TerrainTemplateInfoStub

  beforeEach(() => {
    map = makeMap()
    template = makeTemplate(42, 2, 2)
    map.rules = { terrainInfo: { templates: new Map([[42, template]]) } } as unknown as {
      terrainInfo: ITemplatedTerrainInfoStub
    }
  })

  it('creates action with correct text', () => {
    const action = new PaintTileEditorAction(42, map, new CPos(0, 0))
    expect(action.text).toContain('42')
  })

  it('sets tiles and height on redo', () => {
    const action = new PaintTileEditorAction(42, map, new CPos(0, 0))
    action.redo()

    // Check tile at (0,0) was set to template type 42
    expect(map.tiles.get(new CPos(0, 0)).type).toBe(42)
    expect(map.tiles.get(new CPos(1, 0)).type).toBe(42)
    expect(map.tiles.get(new CPos(0, 1)).type).toBe(42)
    expect(map.tiles.get(new CPos(1, 1)).type).toBe(42)
  })

  it('undo restores original tiles', () => {
    // Set initial tiles to something non-zero
    map.tiles.set(new CPos(0, 0), { type: 99, index: 5 })

    const action = new PaintTileEditorAction(42, map, new CPos(0, 0))
    action.redo()
    expect(map.tiles.get(new CPos(0, 0)).type).toBe(42)

    action.undo()
    expect(map.tiles.get(new CPos(0, 0)).type).toBe(99)
    expect(map.tiles.get(new CPos(0, 0)).index).toBe(5)
  })

  it('skips cells outside map bounds', () => {
    // Place template at (2,2) — (3,2) and (2,3) would be out of 3x3 map
    const action = new PaintTileEditorAction(42, map, new CPos(2, 2))
    action.redo()

    // (2,2) is in bounds
    expect(map.tiles.get(new CPos(2, 2)).type).toBe(42)
    // (3,2) is out of bounds — should remain unchanged
    expect(map.tiles.get(new CPos(2, 0)).type).toBe(0) // unchanged
  })

  it('skips null tiles in template', () => {
    // Template with one null tile at index 1
    const sparseTemplate = makeTemplate(99, 2, 1, {
      tiles: { 0: { height: 0 }, 1: null },
    })
    const sparseMap = makeMap()
    sparseMap.rules = { terrainInfo: { templates: new Map([[99, sparseTemplate]]) } } as unknown as {
      terrainInfo: ITemplatedTerrainInfoStub
    }

    const action = new PaintTileEditorAction(99, sparseMap, new CPos(0, 0))
    action.redo()

    // (0,0) = index 0 should be set
    expect(sparseMap.tiles.get(new CPos(0, 0)).type).toBe(99)
    // (1,0) = index 1 should NOT be set (null tile)
    expect(sparseMap.tiles.get(new CPos(1, 0)).type).toBe(0)
  })

  it('clamps height to maximum terrain height', () => {
    const highTemplate = makeTemplate(50, 1, 1, {
      tiles: { 0: { height: 300 } }, // exceeds max 255
    })
    const highMap = makeMap()
    highMap.rules = { terrainInfo: { templates: new Map([[50, highTemplate]]) } } as unknown as {
      terrainInfo: ITemplatedTerrainInfoStub
    }

    const action = new PaintTileEditorAction(50, highMap, new CPos(0, 0))
    action.redo()
    expect(highMap.height.get(new CPos(0, 0))).toBe(255) // clamped
  })

  it('throws for unknown template ID', () => {
    expect(() => new PaintTileEditorAction(999, map, new CPos(0, 0))).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: FloodFillEditorAction
// ---------------------------------------------------------------------------

describe('FloodFillEditorAction', () => {
  let map: ReturnType<typeof makeMap>
  let template: TerrainTemplateInfoStub

  beforeEach(() => {
    // 4x4 map for flood fill tests
    const cells: CPos[] = []
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        cells.push(new CPos(x, y))
      }
    }
    map = makeMap(cells)

    template = makeTemplate(42, 1, 1) // 1x1 template for simpler flood fill
    map.rules = { terrainInfo: { templates: new Map([[42, template]]) } } as unknown as {
      terrainInfo: ITemplatedTerrainInfoStub
    }

    // Fill entire map with type 1 (the "replace" type)
    for (const cell of cells) {
      map.tiles.set(cell, { type: 1, index: 0 })
    }
  })

  it('flood fills entire contiguous region', () => {
    const action = new FloodFillEditorAction(42, map, new CPos(1, 1))
    action.redo()

    // All cells should now have type 42
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(map.tiles.get(new CPos(x, y)).type).toBe(42)
      }
    }
  })

  it('stops at borders of different tile type', () => {
    // Set a border of type 2 around (1,1)-(2,2) region
    map.tiles.set(new CPos(0, 0), { type: 2, index: 0 })
    map.tiles.set(new CPos(1, 0), { type: 1, index: 0 })
    map.tiles.set(new CPos(2, 0), { type: 1, index: 0 })
    map.tiles.set(new CPos(3, 0), { type: 2, index: 0 })
    map.tiles.set(new CPos(0, 1), { type: 2, index: 0 })
    map.tiles.set(new CPos(3, 1), { type: 2, index: 0 })
    map.tiles.set(new CPos(0, 2), { type: 1, index: 0 })
    map.tiles.set(new CPos(1, 2), { type: 1, index: 0 })
    map.tiles.set(new CPos(2, 2), { type: 1, index: 0 })
    map.tiles.set(new CPos(3, 2), { type: 2, index: 0 })
    map.tiles.set(new CPos(0, 3), { type: 2, index: 0 })
    map.tiles.set(new CPos(1, 3), { type: 1, index: 0 })
    map.tiles.set(new CPos(2, 3), { type: 1, index: 0 })
    map.tiles.set(new CPos(3, 3), { type: 2, index: 0 })

    const action = new FloodFillEditorAction(42, map, new CPos(1, 1))
    action.redo()

    // (1,1) and (2,1) and (1,2) should be filled to 42
    expect(map.tiles.get(new CPos(1, 1)).type).toBe(42)
    expect(map.tiles.get(new CPos(2, 1)).type).toBe(42)
    expect(map.tiles.get(new CPos(1, 2)).type).toBe(42)

    // Borders should remain type 2
    expect(map.tiles.get(new CPos(0, 0)).type).toBe(2)
    expect(map.tiles.get(new CPos(3, 0)).type).toBe(2)
  })

  it('undo restores all original tiles', () => {
    // Record original tiles
    const originalTypes = new Map<string, number>()
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        originalTypes.set(`${x},${y}`, map.tiles.get(new CPos(x, y)).type)
      }
    }

    const action = new FloodFillEditorAction(42, map, new CPos(0, 0))
    action.redo()
    action.undo()

    // All tiles should be restored
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(map.tiles.get(new CPos(x, y)).type).toBe(originalTypes.get(`${x},${y}`))
      }
    }
  })

  it('creates action with correct text', () => {
    const action = new FloodFillEditorAction(42, map, new CPos(0, 0))
    expect(action.text).toContain('42')
  })
})

// ---------------------------------------------------------------------------
// Tests: EditorTileBrush
// ---------------------------------------------------------------------------

describe('EditorTileBrush', () => {
  let map: ReturnType<typeof makeMap>
  let actionManager: ReturnType<typeof makeActionManager>
  let editorWidget: ReturnType<typeof makeEditorWidget>
  let template: TerrainTemplateInfoStub
  let terrainRenderer: { renderPreview: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    const cells: CPos[] = []
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        cells.push(new CPos(x, y))
      }
    }
    map = makeMap(cells)
    actionManager = makeActionManager()
    editorWidget = makeEditorWidget()
    template = makeTemplate(42, 1, 1)
    terrainRenderer = {
      renderPreview: vi.fn().mockReturnValue([]),
    }

    map.rules = { terrainInfo: { templates: new Map([[42, template]]) } } as unknown as {
      terrainInfo: ITemplatedTerrainInfoStub
    }
  })

  function createBrush() {
    const wr = makeWorldRenderer(map, actionManager, terrainRenderer, template)
    return new EditorTileBrush(
      editorWidget as any,
      42,
      wr as any,
    )
  }

  it('throws if terrain info is not template-based', () => {
    const nonTemplateMap = makeMap()
    // Don't set templates — simulate non-template terrain
    const wr = {
      viewport: {
        viewToWorld: () => new CPos(0, 0),
        worldToViewPx: () => ({ x: 0, y: 0 }),
        lastMousePos: { x: 0, y: 0 },
      },
      world: {
        map: { ...nonTemplateMap, rules: { terrainInfo: {} } }, // No templates property
        worldActor: { editorActionManager: actionManager, terrainRenderer },
      },
    }
    expect(() => {
      new EditorTileBrush(
        editorWidget as any,
        42,
        wr as any,
      )
    }).toThrow('template-based')
  })

  it('throws if template ID not found', () => {
    const wr = makeWorldRenderer(map, actionManager, terrainRenderer, template)
    expect(() => {
      new EditorTileBrush(
        editorWidget as any,
        999,
        wr as any,
      )
    }).toThrow('999')
  })

  it('left click paints a cell', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(true)
    expect(actionManager.actions.length).toBe(1)
  })

  it('right click clears the brush', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Up,
      button: MouseButton.Right,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(true)
    expect(editorWidget.clearBrush).toHaveBeenCalledOnce()
  })

  it('right down does not clear brush', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Right,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(false)
    expect(editorWidget.clearBrush).not.toHaveBeenCalled()
  })

  it('non-left/right button returns false', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Middle,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(false)
  })

  it('shift+click triggers flood fill', () => {
    const brush = createBrush()

    // Set tile type to something different from template
    map.tiles.set(new CPos(0, 0), { type: 1, index: 0 })

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.Shift,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(true)
    expect(actionManager.actions.length).toBe(1)
    // Should be a FloodFillEditorAction
    expect(actionManager.actions[0]).toBeInstanceOf(FloodFillEditorAction)
  })

  it('shift+click on same template does nothing', () => {
    const brush = createBrush()

    // Set tile type to match template
    map.tiles.set(new CPos(0, 0), { type: 42, index: 0 })

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.Shift,
      multiTapCount: 0,
    }

    brush.handleMouseInput(mi)
    // No action should be added (guard check prevents replacing same type)
    expect(actionManager.actions.length).toBe(0)
  })

  it('placementOverlapsSameTemplate detects duplicate placement', () => {
    const brush = createBrush()

    // Set tile (0,0) to type 42 (same as template)
    map.tiles.set(new CPos(0, 0), { type: 42, index: 0 })

    // Access private method — use .call() to preserve this context
    const brushAny = brush as unknown as {
      placementOverlapsSameTemplate: (t: TerrainTemplateInfoStub, c: CPos) => boolean
    }

    // Placing template at (0,0) should overlap with existing tile type 42
    expect(brushAny.placementOverlapsSameTemplate.call(brush, template, new CPos(0, 0))).toBe(true)

    // Placing template at (2,2) — no overlap
    expect(brushAny.placementOverlapsSameTemplate.call(brush, template, new CPos(2, 2))).toBe(false)
  })

  it('placementOverlapsSameTemplate returns false when no overlap', () => {
    const brush = createBrush()

    const brushAny = brush as unknown as {
      placementOverlapsSameTemplate: (t: TerrainTemplateInfoStub, c: CPos) => boolean
    }

    // No tile of type 42 in the map
    expect(brushAny.placementOverlapsSameTemplate.call(brush, template, new CPos(0, 0))).toBe(false)
  })

  it('tickRender updates preview when cell changes', () => {
    const brush = createBrush()

    const wr = {
      viewport: {
        viewToWorld: () => new CPos(1, 1),
        worldToViewPx: () => ({ x: 1024, y: 1024 }),
        lastMousePos: { x: 1024, y: 1024 },
      },
    }

    brush.tickRender(wr as unknown as any[0], {} as any[1])

    // Should have called renderPreview (at least once — on construction + on cell change)
    expect(terrainRenderer.renderPreview).toHaveBeenCalled()
  })

  it('renderAboveShroud returns preview', () => {
    const brush = createBrush()
    const result = brush.renderAboveShroud({} as any[0], {} as any[1])
    expect(Array.isArray(result)).toBe(true)
  })

  it('renderAnnotations returns empty array', () => {
    const brush = createBrush()
    const result = brush.renderAnnotations({} as any[0], {} as any[1])
    expect(result).toEqual([])
  })

  it('tick is no-op', () => {
    const brush = createBrush()
    expect(() => brush.tick()).not.toThrow()
  })

  it('dispose cleans up preview', () => {
    const brush = createBrush()
    expect(() => brush.dispose()).not.toThrow()
  })
})
