/**
 * EditorDefaultBrush.test.ts — EditorDefaultBrush migration unit tests
 *
 * Tests the primary editor brush: selection, drag, actor movement, and
 * right-click deletion. Focuses on the mouse input state machine, selection
 * logic, action production, and event callback management.
 *
 * Since happy-dom does not support WebGL, @babylonjs/core is not needed.
 * All dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import { MouseInputEvent, MouseButton, Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import { EditorSelection, MapBlitFilters } from './types.js'
import { EditorDefaultBrush } from './EditorDefaultBrush.js'
import type {
  WorldRendererStub,
  IGameActor,
  ResourceLayerContents,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ResourceLayerContentsEmpty } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBrushWorldRenderer,
  IBrushViewport,
  IBrushWorld,
  IBrushMap,
} from './EditorDefaultBrush.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Create a mock EditorActorPreview. */
function mockActor(id: string, location: CPos, bounds?: { x: number; y: number; width: number; height: number }) {
  const a = {
    id,
    type: 'testActor',
    info: { name: 'TestActor' },
    location,
    centerPosition: { X: 512, Y: 512, Z: 0 },
    selected: false,
    bounds: bounds ?? { x: 100, y: 100, width: 64, height: 64 },
    tooltip: `Tooltip: ${id}`,
    footprint: new Map<CPos, number>() as ReadonlyMap<CPos, number>,
    export: vi.fn().mockReturnValue(
      new Map([['LocationInit', { type: 'LocationInit', value: location }]]),
    ),
    addToEditor: vi.fn(),
    addedToEditor: vi.fn(),
    removedFromEditor: vi.fn(),
    replaceInit: vi.fn(),
    removeInit: vi.fn(),
    getInitOrDefault: vi.fn().mockReturnValue(undefined),
  } as unknown as {
    id: string
    type: string
    info: { name: string }
    location: CPos
    centerPosition: { X: number; Y: number; Z: number }
    selected: boolean
    bounds: { x: number; y: number; width: number; height: number }
    tooltip: string
    footprint: ReadonlyMap<CPos, number>
    export: ReturnType<typeof vi.fn>
    addedToEditor: ReturnType<typeof vi.fn>
    removedFromEditor: ReturnType<typeof vi.fn>
    replaceInit: ReturnType<typeof vi.fn>
    removeInit: ReturnType<typeof vi.fn>
    getInitOrDefault: ReturnType<typeof vi.fn>
  }
  return a
}

/** Create a mock EditorActorLayer. */
function mockActorLayer() {
  const previews: ReturnType<typeof mockActor>[] = []
  return {
    previewsAtWorldPixel: vi.fn().mockImplementation(() => previews),
    previewsAtCell: vi.fn().mockReturnValue([]),
    previewsInCellRegion: vi.fn().mockReturnValue([]),
    add: vi.fn(),
    addRange: vi.fn(),
    addPreview: vi.fn(),
    addRangePreviews: vi.fn(),
    remove: vi.fn(),
    removeRange: vi.fn(),
    removeRegion: vi.fn(),
    removeRegionWithMask: vi.fn(),
    moveActor: vi.fn(),
    freeSubCellAt: vi.fn().mockReturnValue(0),
    getById: vi.fn().mockReturnValue(undefined),
    all: [] as readonly ReturnType<typeof mockActor>[],
    _setPreviews: (p: ReturnType<typeof mockActor>[]) => {
      // Replace the array in-place for mock returns
      previews.length = 0
      previews.push(...p)
    },
  }
}

type MockActorLayer = ReturnType<typeof mockActorLayer>

/** Create a mock EditorActionManager. */
function mockActionManager() {
  return {
    Add: vi.fn(),
    Undo: vi.fn(),
    Redo: vi.fn(),
    HasUndos: vi.fn().mockReturnValue(false),
    HasRedos: vi.fn().mockReturnValue(false),
    undoStack: [],
    redoStack: [],
  }
}

type MockActionManager = ReturnType<typeof mockActionManager>

/** Create a mock EditorViewportControllerWidget. */
function mockEditorWidget() {
  return {
    setTooltip: vi.fn(),
    clearBrush: vi.fn(),
  }
}

type MockEditorWidget = ReturnType<typeof mockEditorWidget>

/** Create a mock IResourceLayer. */
function mockResourceLayer() {
  const cells = new Map<string, ResourceLayerContents>()
  return {
    get info() { return { resourceTypes: new Map() } },
    get isEmpty() { return cells.size === 0 },
    get netWorth() { return 0 },
    getResource: vi.fn().mockImplementation((cell: CPos): ResourceLayerContents => {
      const key = `${cell.X},${cell.Y}`
      return cells.get(key) ?? ResourceLayerContentsEmpty
    }),
    getMaxDensity: vi.fn().mockReturnValue(10),
    getDensity: vi.fn().mockReturnValue(0),
    isVisible: vi.fn().mockReturnValue(true),
    canAddResource: vi.fn().mockReturnValue(true),
    addResource: vi.fn().mockReturnValue(1),
    removeResource: vi.fn().mockReturnValue(1),
    clearResources: vi.fn(),
    _setResource: (cell: CPos, type: string, density: number) => {
      cells.set(`${cell.X},${cell.Y}`, { type, density })
    },
  }
}

type MockResourceLayer = ReturnType<typeof mockResourceLayer>

/** Create a mock IBrushWorldRenderer + IBrushWorld + IBrushMap. */
function mockWorldRenderer() {
  const mapTiles = new Map<string, { type: number; index: number }>()
  const mapHeight = new Map<string, number>()

  const map: IBrushMap = {
    tiles: {
      contains: vi.fn().mockReturnValue(true),
      get: vi.fn().mockImplementation((pos: CPos) => {
        const key = `${pos.X},${pos.Y}`
        return mapTiles.get(key) ?? { type: 0, index: 0 }
      }),
      set: vi.fn().mockImplementation((pos: CPos, tile: { type: number; index: number }) => {
        const key = `${pos.X},${pos.Y}`
        mapTiles.set(key, tile)
      }),
    },
    height: {
      get: vi.fn().mockImplementation((cell: CPos) => {
        const key = `${cell.X},${cell.Y}`
        return mapHeight.get(key) ?? 0
      }),
      set: vi.fn().mockImplementation((cell: CPos, h: number) => {
        const key = `${cell.X},${cell.Y}`
        mapHeight.set(key, h)
      }),
    },
    rules: {
      terrainInfo: {
        defaultTerrainTile: { type: 255, index: 0 },
      },
    },
    grid: { type: 'Rectangular' },
    centerOfCell: vi.fn().mockImplementation((cell: CPos) => ({
      x: cell.X * 1024 + 512,
      y: cell.Y * 1024 + 512,
      z: 0,
    })),
  }

  const viewport: IBrushViewport = {
    viewToWorldPx: vi.fn().mockImplementation((viewPos: { x: number; y: number }) => ({
      x: viewPos.x * 2,
      y: viewPos.y * 2,
      z: 0,
    })),
    viewToWorld: vi.fn().mockImplementation((viewPos: { x: number; y: number }) => {
      return new CPos(Math.floor(viewPos.x / 24), Math.floor(viewPos.y / 24))
    }),
    worldToViewPx: vi.fn().mockImplementation((worldPos: { x: number; y: number }) => ({
      x: worldPos.x / 2,
      y: worldPos.y / 2,
    })),
  }

  const world: IBrushWorld = { map }

  const wr: IBrushWorldRenderer = {
    viewport,
    screenPosition: vi.fn().mockImplementation(
      (pos: { x: number; y: number; z: number }) => ({ x: pos.x / 42.667, y: pos.y / 42.667 }),
    ),
    world,
  }

  return { wr, viewport, world, map }
}

// ---------------------------------------------------------------------------
// Helper: create MouseInput
// ---------------------------------------------------------------------------

function makeMouse(
  event: MouseInputEvent,
  button: MouseButton,
  x: number,
  y: number,
  modifiers: Modifiers = Modifiers.None,
): MouseInput {
  return {
    event,
    button,
    location: { x, y },
    delta: { x: 0, y: 0 },
    modifiers,
    multiTapCount: 1,
  }
}

// ---------------------------------------------------------------------------
// EditorSelection tests
// ---------------------------------------------------------------------------

describe('EditorSelection', () => {
  it('has no selection by default', () => {
    const sel = new EditorSelection()
    expect(sel.area).toBeNull()
    expect(sel.actor).toBeNull()
    expect(sel.hasSelection).toBe(false)
  })

  it('hasSelection is true with area', () => {
    const sel = new EditorSelection()
    sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))
    expect(sel.hasSelection).toBe(true)
  })

  it('hasSelection is true with actor', () => {
    const sel = new EditorSelection()
    sel.actor = mockActor('Actor1', new CPos(3, 3)) as never
    expect(sel.hasSelection).toBe(true)
  })

  it('hasSelection is true with both area and actor', () => {
    const sel = new EditorSelection()
    sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))
    sel.actor = mockActor('Actor1', new CPos(3, 3)) as never
    expect(sel.hasSelection).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// EditorDefaultBrush tests
// ---------------------------------------------------------------------------

describe('EditorDefaultBrush', () => {
  let brush: EditorDefaultBrush
  let editorWidget: MockEditorWidget
  let actorLayer: MockActorLayer
  let actionManager: MockActionManager
  let resourceLayer: MockResourceLayer
    beforeEach(() => {
    editorWidget = mockEditorWidget()
    actorLayer = mockActorLayer()
    actionManager = mockActionManager()
    resourceLayer = mockResourceLayer()
    const { wr } = mockWorldRenderer()

    brush = new EditorDefaultBrush(
      editorWidget as any,
      wr,
      actorLayer as any,
      actionManager as any,
      resourceLayer as any,
    )
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with empty selection', () => {
      expect(brush.selection.area).toBeNull()
      expect(brush.selection.actor).toBeNull()
      expect(brush.selection.hasSelection).toBe(false)
    })

    it('has null currentDragBounds initially', () => {
      expect(brush.currentDragBounds).toBeNull()
    })

    it('accepts null resourceLayer', () => {
      const { wr } = mockWorldRenderer()
      const b = new EditorDefaultBrush(
        editorWidget as any,
        wr,
        actorLayer as any,
        actionManager as any,
        null,
      )
      expect(b.selection.hasSelection).toBe(false)
      b.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // CalculateActorSelectionPriority
  // -----------------------------------------------------------------------

  describe('calculateActorSelectionPriority', () => {
    it('lower pixel distance = lower priority = better candidate', () => {
      const actor1 = mockActor('A1', new CPos(1, 1), { x: 100, y: 50, width: 64, height: 64 })
      const actor2 = mockActor('A2', new CPos(10, 10), { x: 500, y: 500, width: 64, height: 64 })

      const p1 = brush.calculateActorSelectionPriority(actor1 as never)
      const p2 = brush.calculateActorSelectionPriority(actor2 as never)

      expect(p1).toBeLessThan(p2)
    })

    it('with equal pixel distance, higher Z position has lower priority', () => {
      const actor1 = mockActor('A1', new CPos(1, 1), { x: 100, y: 50, width: 64, height: 64 })
      const actor2 = mockActor('A2', new CPos(1, 1), { x: 100, y: 50, width: 64, height: 64 })
      ;(actor1.centerPosition as { X: number; Y: number; Z: number }).Z = 100
      ;(actor2.centerPosition as { X: number; Y: number; Z: number }).Z = 200

      const p1 = brush.calculateActorSelectionPriority(actor1 as never)
      const p2 = brush.calculateActorSelectionPriority(actor2 as never)

      expect(p1).toBeLessThan(p2)
    })
  })

  // -----------------------------------------------------------------------
  // SetSelection
  // -----------------------------------------------------------------------

  describe('setSelection', () => {
    it('updates selection to a new area', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))

      brush.setSelection(sel)
      expect(brush.selection.area).not.toBeNull()
      expect(brush.selection.area!.TopLeft.X).toBe(0)
      expect(brush.selection.hasSelection).toBe(true)
    })

    it('updates selection to a new actor', () => {
      const actor = mockActor('ActorX', new CPos(3, 3))
      const sel = new EditorSelection()
      sel.actor = actor as never

      brush.setSelection(sel)
      expect(brush.selection.actor).toBe(actor as never)
      expect(actor.selected).toBe(true)
    })

    it('deselects previous actor when changing selection', () => {
      const actor1 = mockActor('Actor1', new CPos(1, 1))
      const actor2 = mockActor('Actor2', new CPos(2, 2))

      const sel1 = new EditorSelection()
      sel1.actor = actor1 as never
      brush.setSelection(sel1)
      expect(actor1.selected).toBe(true)

      const sel2 = new EditorSelection()
      sel2.actor = actor2 as never
      brush.setSelection(sel2)
      expect(actor1.selected).toBe(false)
      expect(actor2.selected).toBe(true)
    })

    it('is no-op when setting the same selection instance', () => {
      const sel = new EditorSelection()
      sel.actor = mockActor('Actor1', new CPos(1, 1)) as never

      brush.setSelection(sel)
      const cb = vi.fn()
      brush.onSelectionChanged(cb)

      // Set same instance again — should be no-op
      brush.setSelection(sel)
      expect(cb).not.toHaveBeenCalled()
    })

    it('fires SelectionChanged callback', () => {
      const cb = vi.fn()
      brush.onSelectionChanged(cb)

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)

      expect(cb).toHaveBeenCalledOnce()
    })
  })

  // -----------------------------------------------------------------------
  // ClearSelection
  // -----------------------------------------------------------------------

  describe('clearSelection', () => {
    it('clears area selection and creates ChangeSelectionAction', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))
      brush.setSelection(sel)

      brush.clearSelection(true)
      expect(brush.selection.hasSelection).toBe(false)
      expect(actionManager.Add).toHaveBeenCalled()
    })

    it('does nothing when no selection exists', () => {
      brush.clearSelection()
      expect(actionManager.Add).not.toHaveBeenCalled()
    })

    it('fires UpdateSelectedTab when updateSelectedTab=true', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))
      brush.setSelection(sel)

      const cb = vi.fn()
      brush.onUpdateSelectedTab(cb)

      brush.clearSelection(true)
      expect(cb).toHaveBeenCalledOnce()
    })

    it('does not fire UpdateSelectedTab when updateSelectedTab=false', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))
      brush.setSelection(sel)

      const cb = vi.fn()
      brush.onUpdateSelectedTab(cb)

      brush.clearSelection(false)
      expect(cb).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // DeleteSelection
  // -----------------------------------------------------------------------

  describe('deleteSelection', () => {
    it('creates DeleteAreaAction when area is selected', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 5))
      brush.setSelection(sel)

      brush.deleteSelection(MapBlitFilters.All)
      expect(actionManager.Add).toHaveBeenCalledOnce()
    })

    it('does nothing when no area is selected', () => {
      brush.deleteSelection(MapBlitFilters.All)
      expect(actionManager.Add).not.toHaveBeenCalled()
    })

    it('does nothing when only actor is selected', () => {
      const sel = new EditorSelection()
      sel.actor = mockActor('Actor1', new CPos(1, 1)) as never
      brush.setSelection(sel)

      brush.deleteSelection(MapBlitFilters.All)
      expect(actionManager.Add).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // HandleMouseInput — click-to-select actor
  // -----------------------------------------------------------------------

  describe('handleMouseInput — actor selection', () => {
    it('left click on actor selects it', () => {
      const actor = mockActor('ActorX', new CPos(3, 3))
      actorLayer._setPreviews([actor])

      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 72, 72))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Left, 72, 72))

      expect(brush.selection.actor).toBe(actor as never)
      expect(actionManager.Add).toHaveBeenCalled()
    })

    it('left click on empty space clears selection', () => {
      const sel = new EditorSelection()
      sel.actor = mockActor('ActorX', new CPos(3, 3)) as never
      brush.setSelection(sel)

      actorLayer._setPreviews([])
      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 72, 72))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Left, 72, 72))

      expect(brush.selection.hasSelection).toBe(false)
    })

    it('click on already-selected actor does not change selection', () => {
      const actor = mockActor('ActorX', new CPos(3, 3))
      const sel = new EditorSelection()
      sel.actor = actor as never
      brush.setSelection(sel)

      actionManager.Add.mockClear()

      actorLayer._setPreviews([actor])
      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 72, 72))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Left, 72, 72))

      // Should not create a ChangeSelectionAction for the same actor
      // The brush detects that Selection.Actor == underCursor
      expect(actionManager.Add).not.toHaveBeenCalled()
    })

    it('click on different actor switches selection', () => {
      const actor1 = mockActor('Actor1', new CPos(1, 1))
      const actor2 = mockActor('Actor2', new CPos(10, 10))
      const sel = new EditorSelection()
      sel.actor = actor1 as never
      brush.setSelection(sel)

      actionManager.Add.mockClear()

      actorLayer._setPreviews([actor2])
      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 240, 240))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Left, 240, 240))

      expect(brush.selection.actor).toBe(actor2 as never)
      expect(actionManager.Add).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // HandleMouseInput — drag selection
  // -----------------------------------------------------------------------

  describe('handleMouseInput — drag selection', () => {
    /**
     * OpenRA 对照: MinMouseMoveBeforeDrag = 32. With LengthSquared already
     * squared, threshold is sqrt(32) ≈ 5.66 pixels. Move of 100px easily exceeds.
     */
    it('drag beyond threshold creates selectionBounds', () => {
      actorLayer._setPreviews([])

      // Initial click at (100, 100)
      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
      // Move more than the threshold (squared 10000 >> 32)
      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 200, 200))

      expect(brush.currentDragBounds).not.toBeNull()
    })

    /**
     * OpenRA 对照: MinMouseMoveBeforeDrag = 32 compared to LengthSquared.
     * Threshold is sqrt(32) ≈ 5.66 pixels. Moving only 4px (squared 16 < 32)
     * should NOT trigger a drag — treated as a click.
     */
    it('drag < sqrt(32) pixels does not create selectionBounds', () => {
      actorLayer._setPreviews([])

      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
      // Move only 4px (squared 16 < 32)
      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 104, 100))

      expect(brush.currentDragBounds).toBeNull()
    })

    it('drag release sets area selection', () => {
      actorLayer._setPreviews([])

      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 200, 200))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Left, 200, 200))

      expect(brush.selection.area).not.toBeNull()
      // After release, selectionBounds is cleared, but currentDragBounds
      // returns Selection.Area (OpenRA: selectionBounds ?? Selection.Area)
      expect(brush.currentDragBounds).toBe(brush.selection.area)
      expect(actionManager.Add).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // HandleMouseInput — actor drag-move
  // -----------------------------------------------------------------------

  describe('handleMouseInput — actor drag-move', () => {
    it('Shift+click on actor starts drag', () => {
      const actor = mockActor('ActorX', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      actorLayer._setPreviews([actor])

      brush.handleMouseInput(
        makeMouse(MouseInputEvent.Down, MouseButton.Left, 120, 120, Modifiers.Shift),
      )

      // Should return false (not consumed — starts drag state)
      const result = brush.handleMouseInput(
        makeMouse(MouseInputEvent.Down, MouseButton.Left, 120, 120, Modifiers.Shift),
      )
      expect(result).toBe(false)
    })

    it('drag move updates actor position', () => {
      const actor = mockActor('ActorX', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      actorLayer._setPreviews([actor])

      // Start drag with Shift
      brush.handleMouseInput(
        makeMouse(MouseInputEvent.Down, MouseButton.Left, 120, 120, Modifiers.Shift),
      )

      // Drag move
      const result = brush.handleMouseInput(
        makeMouse(MouseInputEvent.Move, MouseButton.Left, 300, 300, Modifiers.Shift),
      )
      expect(result).toBe(false)

      // Actor should have been moved
      expect(actorLayer.moveActor).toHaveBeenCalled()
    })

    it('drag release commits MoveActorAction if moved', () => {
      const actor = mockActor('ActorX', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      actorLayer._setPreviews([actor])

      actionManager.Add.mockClear()

      // Start drag
      brush.handleMouseInput(
        makeMouse(MouseInputEvent.Down, MouseButton.Left, 120, 120, Modifiers.Shift),
      )
      // Move to drag
      brush.handleMouseInput(
        makeMouse(MouseInputEvent.Move, MouseButton.Left, 300, 300, Modifiers.Shift),
      )
      // Release
      brush.handleMouseInput(
        makeMouse(MouseInputEvent.Up, MouseButton.Left, 300, 300, Modifiers.Shift),
      )

      expect(actionManager.Add).toHaveBeenCalled()
    })

    it('click on already-selected actor starts drag without Shift', () => {
      const actor = mockActor('ActorX', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      const sel = new EditorSelection()
      sel.actor = actor as never
      brush.setSelection(sel)

      actorLayer._setPreviews([actor])

      // Click on selected actor without Shift should start drag
      const result = brush.handleMouseInput(
        makeMouse(MouseInputEvent.Down, MouseButton.Left, 120, 120, Modifiers.None),
      )
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // HandleMouseInput — right-click delete
  // -----------------------------------------------------------------------

  describe('handleMouseInput — right-click delete', () => {
    it('right-click on non-selected actor removes it', () => {
      const actor = mockActor('ActorToRemove', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      actorLayer._setPreviews([actor])

      actionManager.Add.mockClear()

      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Right, 120, 120))

      expect(actionManager.Add).toHaveBeenCalledOnce()
    })

    it('right-click on selected actor does not remove it', () => {
      const actor = mockActor('ActorSelected', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      const sel = new EditorSelection()
      sel.actor = actor as never
      brush.setSelection(sel)

      actorLayer._setPreviews([actor])
      actionManager.Add.mockClear()

      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Right, 120, 120))

      // Should NOT remove the selected actor — only non-selected actors
      expect(actionManager.Add).not.toHaveBeenCalled()
    })

    it('right-click on resource removes it', () => {
      actorLayer._setPreviews([])
      resourceLayer._setResource(new CPos(2, 2), 'Tiberium', 5)

      actionManager.Add.mockClear()

      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Right, 48, 48))

      expect(actionManager.Add).toHaveBeenCalledOnce()
    })

    it('right-click on empty space does nothing', () => {
      actorLayer._setPreviews([])

      actionManager.Add.mockClear()

      brush.handleMouseInput(makeMouse(MouseInputEvent.Up, MouseButton.Right, 100, 100))

      expect(actionManager.Add).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // HandleMouseInput — pass-through events
  // -----------------------------------------------------------------------

  describe('handleMouseInput — event pass-through', () => {
    it('mouse move events always return false', () => {
      const result = brush.handleMouseInput(
        makeMouse(MouseInputEvent.Move, MouseButton.Left, 100, 100),
      )
      expect(result).toBe(false)
    })

    it('scroll events return false', () => {
      const result = brush.handleMouseInput(
        { event: MouseInputEvent.Scroll, button: MouseButton.None, location: { x: 100, y: 100 }, delta: { x: 0, y: 10 }, modifiers: Modifiers.None, multiTapCount: 1 },
      )
      expect(result).toBe(false)
    })

    it('non-left/right button returns false', () => {
      const result = brush.handleMouseInput(
        makeMouse(MouseInputEvent.Down, MouseButton.Middle, 100, 100),
      )
      expect(result).toBe(false)
    })

    it('left click is consumed (returns true)', () => {
      actorLayer._setPreviews([])
      const result = brush.handleMouseInput(
        makeMouse(MouseInputEvent.Up, MouseButton.Left, 100, 100),
      )
      expect(result).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // HandleMouseInput — tooltip display
  // -----------------------------------------------------------------------

  describe('handleMouseInput — tooltip', () => {
    it('sets tooltip to actor tooltip when hovering over actor', () => {
      const actor = mockActor('TooltipActor', new CPos(5, 5), { x: 120, y: 120, width: 64, height: 64 })
      actorLayer._setPreviews([actor])

      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.None, 120, 120))

      expect(editorWidget.setTooltip).toHaveBeenCalledWith(actor.tooltip)
    })

    it('sets tooltip to resource type when hovering over resource', () => {
      actorLayer._setPreviews([])
      resourceLayer._setResource(new CPos(2, 2), 'Tiberium', 5)

      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.None, 48, 48))

      expect(editorWidget.setTooltip).toHaveBeenCalledWith('Tiberium')
    })

    it('clears tooltip when hovering over empty space', () => {
      actorLayer._setPreviews([])

      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.None, 500, 500))

      expect(editorWidget.setTooltip).toHaveBeenCalledWith(null)
    })
  })

  // -----------------------------------------------------------------------
  // Event subscription / unsubscription
  // -----------------------------------------------------------------------

  describe('event callbacks', () => {
    it('SelectionChanged callbacks fire on setSelection', () => {
      const cb = vi.fn()
      brush.onSelectionChanged(cb)

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)

      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('offSelectionChanged unsubscribes callback', () => {
      const cb = vi.fn()
      brush.onSelectionChanged(cb)
      brush.offSelectionChanged(cb)

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)

      expect(cb).not.toHaveBeenCalled()
    })

    it('UpdateSelectedTab callbacks fire on clearSelection(true)', () => {
      const cb = vi.fn()
      brush.onUpdateSelectedTab(cb)

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)
      brush.clearSelection(true)

      expect(cb).toHaveBeenCalledOnce()
    })

    it('offUpdateSelectedTab unsubscribes callback', () => {
      const cb = vi.fn()
      brush.onUpdateSelectedTab(cb)
      brush.offUpdateSelectedTab(cb)

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)
      brush.clearSelection(true)

      expect(cb).not.toHaveBeenCalled()
    })

    it('multiple SelectionChanged callbacks all fire', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      brush.onSelectionChanged(cb1)
      brush.onSelectionChanged(cb2)

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)

      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('clears all callbacks', () => {
      const cb = vi.fn()
      brush.onSelectionChanged(cb)

      brush.dispose()

      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      brush.setSelection(sel)

      expect(cb).not.toHaveBeenCalled()
    })

    it('deselects the current actor', () => {
      const actor = mockActor('ActorX', new CPos(1, 1))
      const sel = new EditorSelection()
      sel.actor = actor as never
      brush.setSelection(sel)

      brush.dispose()

      expect(actor.selected).toBe(false)
      expect(brush.selection.hasSelection).toBe(false)
    })

    it('clears drag state', () => {
      actorLayer._setPreviews([])

      // Start a drag
      brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
      brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 200, 200))
      expect(brush.currentDragBounds).not.toBeNull()

      brush.dispose()
      expect(brush.currentDragBounds).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // No-op methods
  // -----------------------------------------------------------------------

  describe('no-op methods', () => {
    it('tick is a no-op', () => {
      expect(() => brush.tick()).not.toThrow()
    })

    it('tickRender is a no-op', () => {
      expect(() => brush.tickRender({} as WorldRendererStub, {} as IGameActor)).not.toThrow()
    })

    it('renderAboveShroud returns empty array', () => {
      const result = brush.renderAboveShroud({} as IGameActor, {} as WorldRendererStub)
      expect(result).toEqual([])
    })

    it('renderAnnotations returns empty array when no drag bounds', () => {
      const result = brush.renderAnnotations({} as IGameActor, {} as WorldRendererStub)
      expect(result).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // ISelectionController interface
  // -----------------------------------------------------------------------

  describe('ISelectionController', () => {
    it('setSelection changes selection', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(0, 0), new CPos(3, 3))
      brush.setSelection(sel)
      expect(brush.selection).toBe(sel)
    })

    it('selection property reflects current state', () => {
      const sel = new EditorSelection()
      sel.area = new CellCoordsRegion(new CPos(1, 1), new CPos(2, 2))
      brush.setSelection(sel)
      expect(brush.selection.area).not.toBeNull()
      expect(brush.selection.area!.TopLeft.X).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// distSq module-level function test (via handleMouseInput behavior)
// ---------------------------------------------------------------------------

describe('drag threshold', () => {
  /**
   * OpenRA 对照: MinMouseMoveBeforeDrag = 32 compared to LengthSquared
   * (which already returns X*X + Y*Y). So drag starts at sqrt(32) ≈ 5.66 px.
   */
  it('movement of 6px triggers selection drag (squared 36 > 32)', () => {
    const editorWidget = mockEditorWidget()
    const actorLayer = mockActorLayer()
    const actionManager = mockActionManager()
    const resourceLayer = mockResourceLayer()
    const { wr } = mockWorldRenderer()

    actorLayer._setPreviews([])

    const brush = new EditorDefaultBrush(
      editorWidget as any,
      wr,
      actorLayer as any,
      actionManager as any,
      resourceLayer as any,
    )

    // Move 6px — squared distance 36 > 32 triggers drag
    brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
    brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 106, 100))
    expect(brush.currentDragBounds).not.toBeNull()
    brush.dispose()
  })

  it('movement of 5px does NOT trigger selection drag (squared 25 < 32)', () => {
    const editorWidget = mockEditorWidget()
    const actorLayer = mockActorLayer()
    const actionManager = mockActionManager()
    const resourceLayer = mockResourceLayer()
    const { wr } = mockWorldRenderer()

    actorLayer._setPreviews([])

    const brush = new EditorDefaultBrush(
      editorWidget as any,
      wr,
      actorLayer as any,
      actionManager as any,
      resourceLayer as any,
    )

    // Move 5px — squared distance 25 < 32, treated as a click, no drag
    brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
    brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 105, 100))
    expect(brush.currentDragBounds).toBeNull()
    brush.dispose()
  })

  it('already-dragging does not re-check threshold (selectionBounds exists)', () => {
    const editorWidget = mockEditorWidget()
    const actorLayer = mockActorLayer()
    const actionManager = mockActionManager()
    const resourceLayer = mockResourceLayer()
    const { wr } = mockWorldRenderer()

    actorLayer._setPreviews([])

    const brush = new EditorDefaultBrush(
      editorWidget as any,
      wr,
      actorLayer as any,
      actionManager as any,
      resourceLayer as any,
    )

    // Drag past threshold to create selectionBounds
    brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
    brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 106, 100))
    expect(brush.currentDragBounds).not.toBeNull()

    // Further movement within the bounds will still update bounds
    // (the || selectionBounds != null short-circuit)
    brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 106, 102))
    expect(brush.currentDragBounds).not.toBeNull()
    brush.dispose()
  })

  it('drag distance applies diagonally (dx² + dy² > 32)', () => {
    const editorWidget = mockEditorWidget()
    const actorLayer = mockActorLayer()
    const actionManager = mockActionManager()
    const resourceLayer = mockResourceLayer()
    const { wr } = mockWorldRenderer()

    actorLayer._setPreviews([])

    const brush = new EditorDefaultBrush(
      editorWidget as any,
      wr,
      actorLayer as any,
      actionManager as any,
      resourceLayer as any,
    )

    // Move 4px X + 4px Y: squared = 4² + 4² = 32 (NOT > 32, no drag)
    brush.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
    brush.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 104, 104))
    expect(brush.currentDragBounds).toBeNull()

    // Move 5px X + 5px Y: squared = 5² + 5² = 50 > 32 (drag triggers)
    brush.dispose()
    const brush2 = new EditorDefaultBrush(
      editorWidget as any,
      wr,
      actorLayer as any,
      actionManager as any,
      resourceLayer as any,
    )
    brush2.handleMouseInput(makeMouse(MouseInputEvent.Down, MouseButton.Left, 100, 100))
    brush2.handleMouseInput(makeMouse(MouseInputEvent.Move, MouseButton.Left, 105, 105))
    expect(brush2.currentDragBounds).not.toBeNull()
    brush2.dispose()
  })
})
