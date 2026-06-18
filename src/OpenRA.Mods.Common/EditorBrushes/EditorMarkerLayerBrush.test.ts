/**
 * EditorMarkerLayerBrush.test.ts — EditorMarkerLayerBrush unit tests
 *
 * Tests the marker layer brush: accumulation during drag, mirror position
 * calculation, commit on mouse-up, and inner action classes (PaintMarkerTile,
 * ClearSelected, ClearAll).
 *
 * Uses InMemoryMarkerLayer for IMarkerLayer — no babylonjs dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  MouseInputEvent,
  MouseButton,
} from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import { InMemoryMarkerLayer, type IMarkerLayer } from './MarkerStubs.js'
import {
  EditorMarkerLayerBrush,
  PaintMarkerTileEditorAction,
  ClearSelectedMarkerTilesEditorAction,
  ClearAllMarkerTilesEditorAction,
  type IMarkerBrushViewport,
  type IMarkerBrushWorldRenderer,
  type IMarkerBrushWidget,
} from './EditorMarkerLayerBrush.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMouse(
  button: number,
  eventVal: number,
  x: number,
  y: number,
): MouseInput {
  return {
    button,
    event: eventVal as MouseInputEvent,
    location: { x, y },
    delta: { x: 0, y: 0 },
    modifiers: 0,
    multiTapCount: 0,
  }
}

describe('EditorMarkerLayerBrush', () => {
  let editorWidget: IMarkerBrushWidget
  let viewport: IMarkerBrushViewport
  let worldRenderer: IMarkerBrushWorldRenderer
  let actionManager: { Add: ReturnType<typeof vi.fn> }
  let markerLayer: IMarkerLayer

  /**
   * Simulate a mouse event by first updating the viewport's lastMousePos,
   * then calling brush.handleMouseInput. In the real engine,
   * Viewport.LastMousePos is updated by the game loop before brush input.
   */
  function doMouseEvent(
    brush: EditorMarkerLayerBrush,
    button: number,
    event: number,
    x: number,
    y: number,
  ): boolean {
    viewport.lastMousePos = { x, y }
    return brush.handleMouseInput(makeMouse(button, event, x, y))
  }

  beforeEach(() => {
    editorWidget = {
      clearBrush: vi.fn(),
    }

    viewport = {
      lastMousePos: { x: 0, y: 0 },
      viewToWorld(pos) {
        return new CPos(Math.floor(pos.x / 32), Math.floor(pos.y / 32))
      },
    }

    worldRenderer = { viewport }
    actionManager = { Add: vi.fn() }
    markerLayer = new InMemoryMarkerLayer()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with template and cursor cell', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        5,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )
      expect(brush.template).toBe(5)
    })

    it('template null means erase mode', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        null,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )
      expect(brush.template).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // HandleMouseInput
  // ---------------------------------------------------------------------------

  describe('handleMouseInput', () => {
    it('left down at (4,4) sets marker, move to (5,5) accumulates, up commits', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      // Constructor sets this.cell = viewToWorld(0,0) = CPos(0,0)
      // Down at (128,128) → CPos(4,4): different from (0,0), triggers accumulation
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Down, 128, 128)
      expect(markerLayer.getTile(new CPos(4, 4))).toBe(1)

      // Move to (160,160) → CPos(5,5): different from (4,4), accumulates another
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Move, 160, 160)
      expect(markerLayer.getTile(new CPos(5, 5))).toBe(1)

      // Up at (5,5): commits the accumulated cells
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Up, 160, 160)
      expect(actionManager.Add).toHaveBeenCalledTimes(1)
      const action = (actionManager.Add as any).mock.calls[0][0]
      expect(action).toBeInstanceOf(PaintMarkerTileEditorAction)
    })

    it('right click clears brush', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Right, MouseInputEvent.Up, 0, 0),
      )
      expect(result).toBe(true)
      expect(editorWidget.clearBrush).toHaveBeenCalledTimes(1)
    })

    it('right button down returns false (only up triggers clear)', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Right, MouseInputEvent.Down, 0, 0),
      )
      expect(result).toBe(false)
      expect(editorWidget.clearBrush).not.toHaveBeenCalled()
    })

    it('non-left/right button returns false', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Middle, MouseInputEvent.Down, 0, 0),
      )
      expect(result).toBe(false)
    })

    it('down then up at same cell commits exactly one action', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      // Down at (4,4) → accumulates cell (4,4)
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Down, 128, 128)
      // Up at (4,4) → updatePreview returns early (cell unchanged), commits
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Up, 128, 128)

      expect(actionManager.Add).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // UpdatePreview — marker accumulation behavior
  // ---------------------------------------------------------------------------

  describe('updatePreview', () => {
    it('cell already having the template value is skipped (no action)', () => {
      // Pre-set the cell to template 1
      const cell = new CPos(4, 4)
      markerLayer.setTile(cell, 1)

      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      // Try to paint at (4,4) — existing matches template, skipped
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Down, 128, 128)
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Up, 128, 128)

      // No action because the cell already has the target value
      expect(actionManager.Add).not.toHaveBeenCalled()
    })

    it('down sets marker; dispose reverts uncommitted markers', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      // Down at (5,5): painting set to true, cell accumulated
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Down, 160, 160)
      expect(markerLayer.getTile(new CPos(5, 5))).toBe(1)

      // Dispose reverts pending paint tiles
      brush.dispose()
      expect(markerLayer.getTile(new CPos(5, 5))).toBeNull()
    })

    it('changing cell during painting accumulates both cells', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      // Down at (4,4)
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Down, 128, 128)
      // Move to (5,5)
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Move, 160, 160)
      // Up
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Up, 160, 160)

      // Both cells should have the marker
      expect(markerLayer.getTile(new CPos(4, 4))).toBe(1)
      expect(markerLayer.getTile(new CPos(5, 5))).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  describe('dispose', () => {
    it('reverts pending paint tiles on dispose', () => {
      const brush = new EditorMarkerLayerBrush(
        editorWidget,
        1,
        worldRenderer,
        actionManager as any,
        markerLayer,
      )

      // Start painting at (4,4) but don't commit
      doMouseEvent(brush, MouseButton.Left, MouseInputEvent.Down, 128, 128)

      // Verify marker was set
      expect(markerLayer.getTile(new CPos(4, 4))).toBe(1)

      // Dispose should revert
      brush.dispose()
      expect(markerLayer.getTile(new CPos(4, 4))).toBeNull()
    })
  })
})

// ===========================================================================
// Inner action classes
// ===========================================================================

describe('PaintMarkerTileEditorAction', () => {
  let markerLayer: IMarkerLayer

  beforeEach(() => {
    markerLayer = new InMemoryMarkerLayer()
  })

  it('redo sets all tiles to the type', () => {
    const paintTiles = [
      { cell: new CPos(1, 1), previous: null },
      { cell: new CPos(2, 2), previous: null },
    ]
    const action = new PaintMarkerTileEditorAction(5, paintTiles, markerLayer)
    action.redo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBe(5)
    expect(markerLayer.getTile(new CPos(2, 2))).toBe(5)
  })

  it('undo restores previous values', () => {
    markerLayer.setTile(new CPos(1, 1), 3)
    const paintTiles = [
      { cell: new CPos(1, 1), previous: 3 },
    ]
    const action = new PaintMarkerTileEditorAction(5, paintTiles, markerLayer)
    action.redo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBe(5)
    action.undo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBe(3)
  })

  it('execute is no-op', () => {
    const paintTiles: { cell: CPos; previous: number | null }[] = []
    const action = new PaintMarkerTileEditorAction(5, paintTiles, markerLayer)
    expect(() => action.execute()).not.toThrow()
  })
})

describe('ClearSelectedMarkerTilesEditorAction', () => {
  let markerLayer: IMarkerLayer

  beforeEach(() => {
    markerLayer = new InMemoryMarkerLayer()
    markerLayer.setTile(new CPos(1, 1), 2)
    markerLayer.setTile(new CPos(2, 2), 2)
    markerLayer.setTile(new CPos(3, 3), 2)
  })

  it('redo clears all tiles of the given type', () => {
    const action = new ClearSelectedMarkerTilesEditorAction(2, markerLayer)
    action.redo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBeNull()
    expect(markerLayer.getTile(new CPos(2, 2))).toBeNull()
    expect(markerLayer.getTile(new CPos(3, 3))).toBeNull()
  })

  it('undo restores all tiles', () => {
    const action = new ClearSelectedMarkerTilesEditorAction(2, markerLayer)
    action.redo()
    action.undo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBe(2)
    expect(markerLayer.getTile(new CPos(2, 2))).toBe(2)
    expect(markerLayer.getTile(new CPos(3, 3))).toBe(2)
  })

  it('execute delegates to redo', () => {
    const action = new ClearSelectedMarkerTilesEditorAction(2, markerLayer)
    action.execute()
    expect(markerLayer.getTile(new CPos(1, 1))).toBeNull()
  })
})

describe('ClearAllMarkerTilesEditorAction', () => {
  let markerLayer: IMarkerLayer

  beforeEach(() => {
    markerLayer = new InMemoryMarkerLayer()
    markerLayer.setTile(new CPos(1, 1), 2)
    markerLayer.setTile(new CPos(2, 2), 3)
  })

  it('redo clears all marker types', () => {
    const action = new ClearAllMarkerTilesEditorAction(markerLayer)
    action.redo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBeNull()
    expect(markerLayer.getTile(new CPos(2, 2))).toBeNull()
  })

  it('undo restores all tiles', () => {
    const action = new ClearAllMarkerTilesEditorAction(markerLayer)
    action.redo()
    action.undo()
    expect(markerLayer.getTile(new CPos(1, 1))).toBe(2)
    expect(markerLayer.getTile(new CPos(2, 2))).toBe(3)
  })
})
