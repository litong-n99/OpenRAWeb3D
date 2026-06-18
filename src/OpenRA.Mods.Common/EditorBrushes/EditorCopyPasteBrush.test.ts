/**
 * EditorCopyPasteBrush.test.ts — EditorCopyPasteBrush unit tests
 *
 * Tests the copy-paste brush logic: mouse handling, preview position tracking,
 * render piping, and CopyPasteEditorAction commit/revert delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  MouseInputEvent,
  MouseButton,
} from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import { ResourceLayerContentsEmpty } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { EditorBlit } from './EditorBlit.js'
import type { MapBlitData, EditorActorLayerBlitInterface } from './EditorBlit.js'
import { MapBlitFilters, type EditorBlitSource, type BlitTile, cposKey } from './types.js'
import {
  EditorCopyPasteBrush,
  CopyPasteEditorAction,
  type ICopyPasteBrushWidget,
  type ICopyPasteBrushViewport,
  type ICopyPasteBrushWorldRenderer,
} from './EditorCopyPasteBrush.js'

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

function makeClipboard(region: CellCoordsRegion): EditorBlitSource {
  const tiles = new Map<string, BlitTile>()
  for (const cell of region) {
    tiles.set(cposKey(cell), {
      terrainTile: { type: 1, index: 0 },
      resourceTile: { type: 0, index: 0 },
      resourceLayerContents: ResourceLayerContentsEmpty,
      height: 0,
    })
  }
  return {
    cellCoords: region,
    actors: new Map(),
    tiles,
  }
}

describe('EditorCopyPasteBrush', () => {
  let editorWidget: ICopyPasteBrushWidget
  let viewport: ICopyPasteBrushViewport
  let worldRenderer: ICopyPasteBrushWorldRenderer
  let mapData: MapBlitData
  let actorLayer: EditorActorLayerBlitInterface
  let actionManager: { Add: ReturnType<typeof vi.fn> }
  let getCopyFilters: () => MapBlitFilters

  beforeEach(() => {
    viewport = {
      lastMousePos: { x: 100, y: 100 },
      viewToWorld(pos) {
        return new CPos(Math.floor(pos.x / 32), Math.floor(pos.y / 32))
      },
    }

    editorWidget = {
      clearBrush: vi.fn(),
      selectionAltColor: { r: 0, g: 0, b: 0, a: 255 },
      selectionAltOffset: 0,
      pasteColor: { r: 76, g: 255, b: 0, a: 255 },
    }

    worldRenderer = { viewport }
    actionManager = { Add: vi.fn() }
    getCopyFilters = () => MapBlitFilters.All

    // In-memory map data
    const cellTiles = new Map<string, { type: number; index: number }>()
    const heights = new Map<string, number>()
    const resources = new Map<string, { type: number; index: number }>()

    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const key = `${x},${y}`
        cellTiles.set(key, { type: 0, index: 0 })
        heights.set(key, 0)
        resources.set(key, { type: 0, index: 0 })
      }
    }

    mapData = {
      tiles: {
        contains(c: CPos): boolean { return cellTiles.has(cposKey(c)) },
        get(c: CPos) { return cellTiles.get(cposKey(c)) ?? { type: 0, index: 0 } },
        set(c: CPos, tile) { cellTiles.set(cposKey(c), tile) },
      },
      height: {
        contains(c: CPos): boolean { return heights.has(cposKey(c)) },
        get(c: CPos) { return heights.get(cposKey(c)) ?? 0 },
        set(c: CPos, h) { heights.set(cposKey(c), h) },
      },
      resources: {
        contains(c: CPos): boolean { return resources.has(cposKey(c)) },
        get(c: CPos) { return resources.get(cposKey(c)) ?? { type: 0, index: 0 } },
        set(c: CPos, r) { resources.set(cposKey(c), r) },
      },
      contains(_c: CPos): boolean { return true },
    }

    actorLayer = {
      previewsInCellRegion: vi.fn().mockReturnValue([]),
      removeRegionWithMask: vi.fn(),
      addRange: vi.fn(),
      addRangePreviews: vi.fn(),
    }
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes pastePreviewPosition from lastMousePos', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )
      // lastMousePos is (100, 100) → viewToWorld gives (3, 3)
      expect(brush.pastePreviewPosition).toEqual(new CPos(3, 3))
    })
  })

  // ---------------------------------------------------------------------------
  // HandleMouseInput
  // ---------------------------------------------------------------------------

  describe('handleMouseInput', () => {
    it('left click creates CopyPasteEditorAction', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Left, MouseInputEvent.Down, 96, 128),
      )
      expect(result).toBe(true)
      expect(actionManager.Add).toHaveBeenCalledTimes(1)
      const added = (actionManager.Add as any).mock.calls[0][0]
      expect(added).toBeInstanceOf(CopyPasteEditorAction)
    })

    it('right click clears brush', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Right, MouseInputEvent.Up, 0, 0),
      )
      expect(result).toBe(true)
      expect(editorWidget.clearBrush).toHaveBeenCalledTimes(1)
    })

    it('non-left/right button returns false', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Middle, MouseInputEvent.Down, 0, 0),
      )
      expect(result).toBe(false)
    })

    it('right button down returns false (only up triggers clear)', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      const result = brush.handleMouseInput(
        makeMouse(MouseButton.Right, MouseInputEvent.Down, 0, 0),
      )
      expect(result).toBe(false)
      expect(editorWidget.clearBrush).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Paste preview position
  // ---------------------------------------------------------------------------

  describe('paste preview position', () => {
    it('tick updates pastePreviewPosition from cursor', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      viewport.lastMousePos = { x: 160, y: 200 }
      brush.tick()

      expect(brush.pastePreviewPosition).toEqual(new CPos(5, 6))
    })

    it('region returns clipboard cellCoords', () => {
      const region = new CellCoordsRegion(new CPos(2, 3), new CPos(5, 7))
      const clipboard = makeClipboard(region)
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      expect(brush.region).toBe(region)
    })
  })

  // ---------------------------------------------------------------------------
  // Render methods
  // ---------------------------------------------------------------------------

  describe('render methods', () => {
    it('renderAboveShroud returns empty array (preview stubbed)', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      const result = brush.renderAboveShroud()
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0) // stubbed
    })

    it('renderAnnotations returns 2 annotation renderables', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )

      const result = brush.renderAnnotations()
      expect(result).toHaveLength(2)
    })

    it('dispose is no-op', () => {
      const clipboard = makeClipboard(
        new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
      )
      const brush = new EditorCopyPasteBrush(
        editorWidget,
        worldRenderer,
        clipboard,
        { getResource: () => null, clearResources: vi.fn(), addResource: vi.fn(), canAddResource: vi.fn(), getMaxDensity: vi.fn() } as any,
        getCopyFilters,
        actionManager as any,
        actorLayer as any,
        mapData,
      )
      expect(() => brush.dispose()).not.toThrow()
    })
  })
})

// ===========================================================================
// CopyPasteEditorAction tests
// ===========================================================================

describe('CopyPasteEditorAction', () => {
  it('text includes tile and actor counts', () => {
    const clipboard = makeClipboard(
      new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1)),
    )
    const blit = new EditorBlit(
      MapBlitFilters.All,
      {
        clearResources: vi.fn(),
        addResource: vi.fn(),
        canAddResource: vi.fn().mockReturnValue(true),
        getResource: vi.fn().mockReturnValue(null),
        getMaxDensity: vi.fn().mockReturnValue(12),
        info: { tryGetTerrainType: vi.fn(), tryGetResourceIndex: vi.fn() },
        isEmpty: false,
      } as any,
      new CPos(5, 5),
      {
        tiles: {
          contains: () => true,
          get: () => ({ type: 0, index: 0 }),
          set: vi.fn(),
        },
        height: {
          contains: () => true,
          get: () => 0,
          set: vi.fn(),
        },
        resources: {
          contains: () => true,
          get: () => ({ type: 0, index: 0 }),
          set: vi.fn(),
        },
        contains: () => true,
      },
      clipboard,
      {
        previewsInCellRegion: vi.fn().mockReturnValue([]),
        removeRegionWithMask: vi.fn(),
        addRange: vi.fn(),
        addRangePreviews: vi.fn(),
      },
      true,
    )
    const action = new CopyPasteEditorAction(blit)
    // 4 cells in 2x2 region (0-1,0-1)
    expect(action.text).toContain('4 tile')
  })

  it('redo calls EditorBlit.commit', () => {
    const commitSpy = vi.fn()
    const blit = {
      commit: commitSpy,
      revert: vi.fn(),
      tileCount: () => 1,
      actorCount: () => 0,
    } as unknown as EditorBlit

    const action = new CopyPasteEditorAction(blit)
    action.redo()
    expect(commitSpy).toHaveBeenCalledTimes(1)
  })

  it('undo calls EditorBlit.revert', () => {
    const revertSpy = vi.fn()
    const blit = {
      commit: vi.fn(),
      revert: revertSpy,
      tileCount: () => 1,
      actorCount: () => 0,
    } as unknown as EditorBlit

    const action = new CopyPasteEditorAction(blit)
    action.undo()
    expect(revertSpy).toHaveBeenCalledTimes(1)
  })
})
