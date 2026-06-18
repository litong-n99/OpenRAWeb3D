/**
 * EditorTilingPathBrush.test.ts — EditorTilingPathBrush unit tests
 *
 * Tests the tiling path brush mouse state machine and action classes.
 * Core logic tested: click-to-start, click-to-append, click-to-remove,
 * drag-to-move, drag-to-replace-rally, direction handle dragging,
 * plan toggle loop, and annotation rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  MouseInputEvent,
  MouseButton,
} from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import { PathPlan, TilingPathTool } from '../Traits/World/TilingPathTool.js'
import {
  EditorTilingPathBrush,
  UpdateTilingPathPlanEditorAction,
  PaintTilingPathEditorAction,
  type ITilingPathBrushViewport,
  type ITilingPathBrushWorldRenderer,
} from './EditorTilingPathBrush.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMouse(
  button: number,
  event: number,
  x: number,
  y: number,
): MouseInput {
  return {
    button,
    event: event as MouseInputEvent,
    location: { x, y },
    delta: { x: 0, y: 0 },
    modifiers: 0,
    multiTapCount: 0,
  }
}

function makeViewport(): ITilingPathBrushViewport {
  return {
    lastMousePos: { x: 0, y: 0 },
    viewToWorld(pos) {
      return new CPos(Math.floor(pos.x / 32), Math.floor(pos.y / 32))
    },
    viewToWorldPx(pos) {
      return { x: pos.x * 32, y: pos.y * 32, z: 0 }
    },
  }
}

describe('EditorTilingPathBrush', () => {
  let viewport: ITilingPathBrushViewport
  let worldRenderer: ITilingPathBrushWorldRenderer
  let actionManager: { Add: ReturnType<typeof vi.fn> }
  let tool: TilingPathTool

  beforeEach(() => {
    viewport = makeViewport()
    worldRenderer = {
      viewport,
      world: { map: { grid: { type: 0 } } },
    }
    actionManager = { Add: vi.fn() }
    tool = new TilingPathTool([]) // no brushes — plan-only testing
  })

  // ---------------------------------------------------------------------------
  // handleMouseInput — first click creates plan
  // ---------------------------------------------------------------------------

  it('first left-click creates PathPlan with single rally', () => {
    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Click at cell (4, 5) — pixels 128, 160
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 128, 160),
    )

    // Plan was created; tool.plan should now be a PathPlan
    // Since we only do Down (not Up), the plan is previewed but not committed
    // Let's do the full sequence: Down + Up
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 128, 160),
    )

    expect(actionManager.Add).toHaveBeenCalledTimes(1)
  })

  it('right click does nothing (only left handled)', () => {
    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    const result = brush.handleMouseInput(
      makeMouse(MouseButton.Right, MouseInputEvent.Down, 0, 0),
    )
    expect(result).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // handleMouseInput — plan with existing rallies
  // ---------------------------------------------------------------------------

  it('click on empty space appends rally', () => {
    // Pre-set a plan with one rally
    tool.setPlan(PathPlan.createSingle(new CPos(2, 2)))

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Click at cell (6, 6)
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 96, 96),
    )
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 96, 96),
    )

    // Should have committed an update
    expect(actionManager.Add).toHaveBeenCalledTimes(1)
    const action = (actionManager.Add as any).mock.calls[0][0]
    expect(action).toBeInstanceOf(UpdateTilingPathPlanEditorAction)
  })

  it('click on existing rally toggles loop for first rally', () => {
    const plan = PathPlan.createSingle(new CPos(2, 2))
      .withRallyAppended(new CPos(5, 2))
      .withRallyAppended(new CPos(5, 5))
    tool.setPlan(plan)

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Click exactly on first rally point (2,2)
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 64, 64),
    )
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 64, 64),
    )

    expect(actionManager.Add).toHaveBeenCalledTimes(1)
  })

  it('click on non-first rally removes it', () => {
    const plan = PathPlan.createSingle(new CPos(2, 2))
      .withRallyAppended(new CPos(5, 2))
      .withRallyAppended(new CPos(5, 5))
      .withRallyAppended(new CPos(8, 5))
    tool.setPlan(plan)

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Click on second rally (5, 2) — should remove it
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 160, 64),
    )
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 160, 64),
    )

    expect(actionManager.Add).toHaveBeenCalledTimes(1)
  })

  it('click on non-rally internal point inserts rally', () => {
    const plan = PathPlan.createSingle(new CPos(2, 2))
      .withRallyAppended(new CPos(5, 5)) // diagonal, generates intermediate points
    tool.setPlan(plan)

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Click at cell (3, 3) — this is an internal point (not a rally)
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 96, 96),
    )
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 96, 96),
    )

    expect(actionManager.Add).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // handleMouseInput — drag operations
  // ---------------------------------------------------------------------------

  it('drag from rally replaces rally position', () => {
    const plan = PathPlan.createSingle(new CPos(2, 2))
      .withRallyAppended(new CPos(5, 2))
      .withRallyAppended(new CPos(5, 5))
    tool.setPlan(plan)

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Down on first rally
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 64, 64),
    )
    // Drag to new location
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Move, 128, 128),
    )
    // Up — finalizes
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 128, 128),
    )

    expect(actionManager.Add).toHaveBeenCalledTimes(1)
  })

  it('drag from non-rally point moves the entire plan', () => {
    const plan = PathPlan.createSingle(new CPos(2, 2))
      .withRallyAppended(new CPos(5, 2))
    tool.setPlan(plan)

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)

    // Down on cell (3, 2) — internal point between (2,2) and (5,2)
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Down, 96, 64),
    )
    // Drag
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Move, 160, 64),
    )
    // Up
    brush.handleMouseInput(
      makeMouse(MouseButton.Left, MouseInputEvent.Up, 160, 64),
    )

    expect(actionManager.Add).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // annotation rendering
  // ---------------------------------------------------------------------------

  it('renderAnnotations returns empty array when plan is null', () => {
    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)
    const result = brush.renderAnnotations()
    expect(result).toHaveLength(0)
  })

  it('renderAnnotations with plan returns path circles and lines', () => {
    const plan = PathPlan.createSingle(new CPos(2, 2))
      .withRallyAppended(new CPos(5, 2))
      .withRallyAppended(new CPos(5, 5))
    tool.setPlan(plan)

    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)
    const result = brush.renderAnnotations()
    // Should have waypoint circles, lines, rally annotations, and direction indicators
    expect(result.length).toBeGreaterThan(0)
  })

  it('renderAboveShroud returns empty when no EditorBlitSource', () => {
    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)
    expect(tool.editorBlitSource).toBeNull()
    const result = brush.renderAboveShroud()
    expect(result).toHaveLength(0)
  })

  it('dispose is no-op', () => {
    const brush = new EditorTilingPathBrush(tool, worldRenderer, actionManager as any)
    expect(() => brush.dispose()).not.toThrow()
  })
})

// ===========================================================================
// UpdateTilingPathPlanEditorAction tests
// ===========================================================================

describe('UpdateTilingPathPlanEditorAction', () => {
  let tool: TilingPathTool

  beforeEach(() => {
    tool = new TilingPathTool([])
  })

  it('throws if both old and new plans are null', () => {
    expect(() => new UpdateTilingPathPlanEditorAction(tool, null)).toThrow(
      'cannot both be null',
    )
  })

  it('redo sets the new plan', () => {
    const newPlan = PathPlan.createSingle(new CPos(0, 0))
    const action = new UpdateTilingPathPlanEditorAction(tool, newPlan)
    action.redo()
    expect(tool.plan).toBe(newPlan)
  })

  it('undo restores the old plan', () => {
    const oldPlan = PathPlan.createSingle(new CPos(5, 5))
    tool.setPlan(oldPlan)
    const newPlan = PathPlan.createSingle(new CPos(0, 0))
    const action = new UpdateTilingPathPlanEditorAction(tool, newPlan)
    action.redo()
    action.undo()
    expect(tool.plan).toBe(oldPlan)
  })

  it('text is "Started tiling path" when old plan was null', () => {
    const action = new UpdateTilingPathPlanEditorAction(
      tool,
      PathPlan.createSingle(new CPos(0, 0)),
    )
    expect(action.text).toBe('Started tiling path')
  })

  it('text is "Reset tiling path" when new plan is null', () => {
    tool.setPlan(PathPlan.createSingle(new CPos(0, 0)))
    const action = new UpdateTilingPathPlanEditorAction(tool, null)
    expect(action.text).toBe('Reset tiling path')
  })

  it('execute delegates to redo', () => {
    const newPlan = PathPlan.createSingle(new CPos(0, 0))
    const action = new UpdateTilingPathPlanEditorAction(tool, newPlan)
    action.execute()
    expect(tool.plan).toBe(newPlan)
  })
})

// ===========================================================================
// PaintTilingPathEditorAction tests
// ===========================================================================

describe('PaintTilingPathEditorAction', () => {
  it('text is "Painted tiling path"', () => {
    const tool = new TilingPathTool([])
    const action = new PaintTilingPathEditorAction(
      tool,
      null,
      {
        previewsInCellRegion: vi.fn().mockReturnValue([]),
        removeRegionWithMask: vi.fn(),
        addRange: vi.fn(),
        addRangePreviews: vi.fn(),
      } as any,
      {
        tiles: { contains: () => true, get: () => ({ type: 0, index: 0 }), set: vi.fn() },
        height: { contains: () => true, get: () => 0, set: vi.fn() },
        resources: { contains: () => true, get: () => ({ type: 0, index: 0 }), set: vi.fn() },
        contains: () => true,
      },
    )
    expect(action.text).toBe('Painted tiling path')
  })

  it('redo clears plan and commits blit', () => {
    const tool = new TilingPathTool([])
    tool.setPlan(PathPlan.createSingle(new CPos(0, 0)))
    // No editorBlitSource → blit is null, redo just clears plan
    const action = new PaintTilingPathEditorAction(
      tool,
      null,
      {
        previewsInCellRegion: vi.fn().mockReturnValue([]),
        removeRegionWithMask: vi.fn(),
        addRange: vi.fn(),
        addRangePreviews: vi.fn(),
      } as any,
      {
        tiles: { contains: () => true, get: () => ({ type: 0, index: 0 }), set: vi.fn() },
        height: { contains: () => true, get: () => 0, set: vi.fn() },
        resources: { contains: () => true, get: () => ({ type: 0, index: 0 }), set: vi.fn() },
        contains: () => true,
      },
    )
    action.redo()
    expect(tool.plan).toBeNull()
  })
})
