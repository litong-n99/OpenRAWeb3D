/**
 * EditorResourceBrush.test.ts — EditorResourceBrush migration unit tests
 *
 * Tests focus on: accumulation pattern, preview suppression, mouse input handling,
 * AddResourcesEditorAction do/undo with type matching, cell resource accumulation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { MouseInputEvent, MouseButton } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import {
  EditorResourceBrush,
  AddResourcesEditorAction,
} from './EditorResourceBrush.js'
import type {
  IResourceLayer,
  ResourceLayerContents,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CellResource } from './types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEditorWidget() {
  return {
    clearBrush: vi.fn(),
  } as unknown as { clearBrush: () => void } & Record<string, unknown>
}

function makeActionManager() {
  const actions: unknown[] = []
  return {
    actions,
    Add(action: unknown): void {
      actions.push(action)
    },
  }
}

function makeResourceLayer() {
  const cells = new Map<string, { type: string; density: number }>()

  return {
    getResource(cell: CPos): ResourceLayerContents {
      const key = `${cell.X},${cell.Y}`
      const data = cells.get(key)
      if (!data || !data.type) return { type: '', density: 0 }
      return { type: data.type, density: data.density }
    },
    getMaxDensity(_resourceType: string): number {
      return 12
    },
    canAddResource(resourceType: string, _cell: CPos, _amount?: number): boolean {
      return resourceType === 'ore' || resourceType === 'gems'
    },
    addResource(resourceType: string, cell: CPos, amount?: number): number {
      const key = `${cell.X},${cell.Y}`
      const existing = cells.get(key)
      const oldDensity = existing && existing.type === resourceType ? existing.density : 0
      const density = Math.min(this.getMaxDensity(resourceType), oldDensity + (amount ?? 1))
      cells.set(key, { type: resourceType, density })
      return density - oldDensity
    },
    clearResources(cell: CPos): void {
      const key = `${cell.X},${cell.Y}`
      cells.delete(key)
    },
    isVisible(_cell: CPos): boolean {
      return true
    },
    onCellChanged(_cell: CPos, _resourceType: string | null): void {
      // No-op for tests
    },
    // For test assertions
    getAllCells(): Array<[CPos, { type: string; density: number }]> {
      return Array.from(cells.entries()).map(([key, data]) => {
        const [x, y] = key.split(',').map(Number)
        return [new CPos(x, y), data]
      })
    },
  } as IResourceLayer & { getAllCells(): Array<[CPos, { type: string; density: number }]> }
}

function makeResourceRenderers() {
  return [{
    resourceTypes: ['ore', 'gems'],
    renderPreview: vi.fn().mockReturnValue([]),
  }]
}

function makeWorldRenderer(
  resourceLayer: ReturnType<typeof makeResourceLayer>,
  actionMgr: ReturnType<typeof makeActionManager>,
  renderers: ReturnType<typeof makeResourceRenderers>,
) {
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
      map: {
        centerOfCell(cell: CPos): WPos {
          return new WPos(cell.X * 1024, cell.Y * 1024, 0)
        },
      },
      worldActor: {
        resourceLayer,
        editorActionManager: actionMgr,
        resourceRenderers: renderers,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests: AddResourcesEditorAction
// ---------------------------------------------------------------------------

describe('AddResourcesEditorAction', () => {
  let resourceLayer: ReturnType<typeof makeResourceLayer>

  beforeEach(() => {
    resourceLayer = makeResourceLayer()
  })

  it('add applies resource immediately and stores undo data', () => {
    const action = new AddResourcesEditorAction('ore', resourceLayer)

    const cellResource: CellResource = {
      cell: new CPos(0, 0),
      oldResourceTile: { type: '', density: 0 },
    }
    action.add(cellResource)

    // Resource should be placed immediately
    const contents = resourceLayer.getResource(new CPos(0, 0))
    expect(contents.type).toBe('ore')
    expect(contents.density).toBe(12) // max density

    // Text should include count
    expect(action.text).toContain('1')
    expect(action.text).toContain('ore')
  })

  it('accumulates multiple cells', () => {
    const action = new AddResourcesEditorAction('ore', resourceLayer)

    action.add({ cell: new CPos(0, 0), oldResourceTile: { type: '', density: 0 } })
    action.add({ cell: new CPos(1, 0), oldResourceTile: { type: '', density: 0 } })

    const c1 = resourceLayer.getResource(new CPos(0, 0))
    const c2 = resourceLayer.getResource(new CPos(1, 0))
    expect(c1.type).toBe('ore')
    expect(c2.type).toBe('ore')
    expect(action.text).toContain('2')
  })

  it('undo restores old resource when matching type', () => {
    const action = new AddResourcesEditorAction('ore', resourceLayer)

    action.add({
      cell: new CPos(0, 0),
      oldResourceTile: { type: 'ore', density: 6 }, // same type, had some before
    })

    action.undo()

    // Should restore old density
    const contents = resourceLayer.getResource(new CPos(0, 0))
    expect(contents.type).toBe('ore')
    expect(contents.density).toBe(6)
  })

  it('undo restores old resource when different type', () => {
    const action = new AddResourcesEditorAction('ore', resourceLayer)

    action.add({
      cell: new CPos(0, 0),
      oldResourceTile: { type: 'gems', density: 8 }, // different type
    })

    action.undo()

    // Should restore the old gems type
    const contents = resourceLayer.getResource(new CPos(0, 0))
    expect(contents.type).toBe('gems')
    expect(contents.density).toBe(8)
  })

  it('undo clears when old resource was null/empty', () => {
    const action = new AddResourcesEditorAction('ore', resourceLayer)

    action.add({
      cell: new CPos(0, 0),
      oldResourceTile: { type: '', density: 0 } as ResourceLayerContents,
    })

    action.undo()

    // Cell should be cleared
    const contents = resourceLayer.getResource(new CPos(0, 0))
    expect(contents.type).toBe('')
    expect(contents.density).toBe(0)
  })

  it('execute is no-op (trimExcess stub)', () => {
    const action = new AddResourcesEditorAction('ore', resourceLayer)
    action.add({ cell: new CPos(0, 0), oldResourceTile: { type: '', density: 0 } as ResourceLayerContents })
    expect(() => action.execute()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: EditorResourceBrush
// ---------------------------------------------------------------------------

describe('EditorResourceBrush', () => {
  let resourceLayer: ReturnType<typeof makeResourceLayer>
  let actionMgr: ReturnType<typeof makeActionManager>
  let editorWidget: ReturnType<typeof makeEditorWidget>
  let renderers: ReturnType<typeof makeResourceRenderers>

  beforeEach(() => {
    resourceLayer = makeResourceLayer()
    actionMgr = makeActionManager()
    editorWidget = makeEditorWidget()
    renderers = makeResourceRenderers()
  })

  function createBrush(resourceType = 'ore') {
    const wr = makeWorldRenderer(resourceLayer, actionMgr, renderers)
    return new EditorResourceBrush(
      editorWidget as unknown as any,
      resourceType,
      wr as unknown as any,
    )
  }

  it('left down adds cell to pending action', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(true)

    // Resource should be placed immediately
    const contents = resourceLayer.getResource(new CPos(0, 0))
    expect(contents.type).toBe('ore')
    expect(contents.density).toBe(12)

    // But action should NOT be committed yet (pending)
    expect(actionMgr.actions.length).toBe(0)
  })

  it('left up commits pending action', () => {
    const brush = createBrush()

    // First, add a cell
    brush.handleMouseInput({
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    })

    // No action committed yet
    expect(actionMgr.actions.length).toBe(0)

    // Now release mouse
    brush.handleMouseInput({
      event: MouseInputEvent.Up,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    })

    // Action should be committed
    expect(actionMgr.actions.length).toBe(1)
  })

  it('skips cells where CanAddResource is false', () => {
    const brush = createBrush('uranium') // Not in canAddResource check

    brush.handleMouseInput({
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    })

    // No resource should be placed (canAddResource returns false)
    const contents = resourceLayer.getResource(new CPos(0, 0))
    expect(contents.type).toBe('')
  })

  it('right click clears brush', () => {
    const brush = createBrush()

    brush.handleMouseInput({
      event: MouseInputEvent.Up,
      button: MouseButton.Right,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    })

    expect(editorWidget.clearBrush).toHaveBeenCalledOnce()
  })

  it('non-left/right button returns false', () => {
    const brush = createBrush()

    const consumed = brush.handleMouseInput({
      event: MouseInputEvent.Down,
      button: MouseButton.Middle,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    })

    expect(consumed).toBe(false)
  })

  it('renderAboveShroud returns preview when not painting', () => {
    const brush = createBrush()
    const result = brush.renderAboveShroud({} as Parameters<typeof brush.renderAboveShroud>[0], {} as Parameters<typeof brush.renderAboveShroud>[1])
    expect(Array.isArray(result)).toBe(true)
  })

  it('renderAboveShroud returns empty when painting', () => {
    const brush = createBrush()

    // Start painting (this creates a pending action)
    brush.handleMouseInput({
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    })

    // Preview should be suppressed while painting
    const result = brush.renderAboveShroud({} as Parameters<typeof brush.renderAboveShroud>[0], {} as Parameters<typeof brush.renderAboveShroud>[1])
    expect(result).toEqual([])
  })

  it('renderAnnotations returns empty', () => {
    const brush = createBrush()
    const result = brush.renderAnnotations({} as Parameters<typeof brush.renderAnnotations>[0], {} as Parameters<typeof brush.renderAnnotations>[1])
    expect(result).toEqual([])
  })

  it('tick is no-op', () => {
    const brush = createBrush()
    expect(() => brush.tick()).not.toThrow()
  })

  it('dispose does not throw', () => {
    const brush = createBrush()
    expect(() => brush.dispose()).not.toThrow()
  })
})
