/**
 * ChangeSelectionAction.test.ts — ChangeSelectionAction migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs
 *   sealed class ChangeSelectionAction : IEditorAction (lines 294-350)
 *
 * 核心范式转换:
 * - C# Selection object equality → TypeScript EditorSelection deep-copy protection
 * - C# FluentProvider.GetMessage → template literal strings in test assertions
 * - C# IEditorAction.Do() → TypeScript IEditorAction.redo()
 *
 * Since ChangeSelectionAction has no Babylon.js dependency, no mocks are
 * needed. Tests focus on: execute/redo/undo behavior, text message formatting,
 * deep-copy protection against external mutation, and ISelectionController
 * integration.
 *
 * Migration:  — Chapter 21 Phase B
 */

import { describe, it, expect } from 'vitest'

import { ChangeSelectionAction } from './ChangeSelectionAction.js'
import {
  EditorSelection,
  type ISelectionController,
} from '../types.js'
import type { CellCoordsRegion } from '../../../OpenRA.Game/Map/CellCoordsRegion.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function mockCellCoordsRegion(): CellCoordsRegion {
  return {
    TopLeft: { X: 10, Y: 20 } as CPos,
    BottomRight: { X: 15, Y: 25 } as CPos,
    [Symbol.iterator]: () => [][Symbol.iterator](),
  } as unknown as CellCoordsRegion
}

function mockActorPreview(id: string) {
  return { id, info: { name: `Actor${id}` } } as any
}

interface SelectionControllerState {
  setSelectionCallCount: number
  lastSetSelection: EditorSelection | null
}

function makeSelectionController(
  initial?: EditorSelection,
): {
  controller: ISelectionController
  state: SelectionControllerState
} {
  let sel = initial ?? new EditorSelection()
  const state: SelectionControllerState = {
    setSelectionCallCount: 0,
    lastSetSelection: null,
  }

  const controller: ISelectionController = {
    setSelection(s: EditorSelection) {
      sel = s
      state.setSelectionCallCount++
      state.lastSetSelection = s
    },
    get selection() {
      return sel
    },
  }

  return { controller, state }
}

// ---------------------------------------------------------------------------
// ChangeSelectionAction
// ---------------------------------------------------------------------------

describe('ChangeSelectionAction', () => {
  describe('execute / redo', () => {
    it('calls setSelection with the new selection on execute', () => {
      const { controller, state } = makeSelectionController()
      const newSel = new EditorSelection()
      const prevSel = new EditorSelection()

      const action = new ChangeSelectionAction(controller, newSel, prevSel)
      action.execute()

      expect(state.lastSetSelection).not.toBeNull()
      expect(state.setSelectionCallCount).toBe(1)
    })

    it('calls setSelection with the new selection on redo', () => {
      const { controller, state } = makeSelectionController()
      const newSel = new EditorSelection()
      const prevSel = new EditorSelection()

      const action = new ChangeSelectionAction(controller, newSel, prevSel)
      action.redo()

      expect(state.lastSetSelection).not.toBeNull()
      expect(state.setSelectionCallCount).toBe(1)
    })
  })

  describe('undo', () => {
    it('restores the previous selection on undo', () => {
      const oldSel = new EditorSelection()
      const newSel = new EditorSelection()
      oldSel.area = mockCellCoordsRegion()

      const { controller, state } = makeSelectionController(newSel)
      const action = new ChangeSelectionAction(controller, newSel, oldSel)

      action.execute()
      // Now selection is newSel; undo should restore to oldSel
      action.undo()

      const restored = state.lastSetSelection
      expect(restored).not.toBeNull()
      expect(restored!.area).not.toBeNull()
      expect(restored!.area!.TopLeft.X).toBe(10)
      expect(restored!.area!.TopLeft.Y).toBe(20)
    })
  })

  it('redo after undo re-applies new selection', () => {
    const oldSel = new EditorSelection()
    const newSel = new EditorSelection()
    newSel.actor = mockActorPreview('redoSel')

    const { controller, state } = makeSelectionController()
    const action = new ChangeSelectionAction(controller, newSel, oldSel)

    action.execute()
    action.undo()
    action.redo()

    const finalSel = state.lastSetSelection
    expect(finalSel).not.toBeNull()
    expect(finalSel!.actor).not.toBeNull()
    expect(finalSel!.actor!.id).toBe('redoSel')
  })

  describe('deep-copy protection', () => {
    it('does not reference the original selection objects', () => {
      const originalNew = new EditorSelection()
      originalNew.actor = mockActorPreview('original')

      const originalPrev = new EditorSelection()
      originalPrev.area = mockCellCoordsRegion()

      const { controller, state } = makeSelectionController()
      const action = new ChangeSelectionAction(controller, originalNew, originalPrev)

      // Mutate the original objects
      originalNew.actor = null
      originalNew.area = mockCellCoordsRegion()

      // Execute — should still use the captured actor selection, not the mutated one
      action.execute()
      const applied = state.lastSetSelection
      expect(applied).not.toBeNull()
      expect(applied!.actor).not.toBeNull()
      expect(applied!.actor!.id).toBe('original')
      expect(applied!.area).toBeNull()
    })

    it('undo restores deep-copied previous selection', () => {
      const prevSel = new EditorSelection()
      prevSel.area = mockCellCoordsRegion()

      const newSel = new EditorSelection()
      const { controller, state } = makeSelectionController(newSel)

      const action = new ChangeSelectionAction(controller, newSel, prevSel)

      // Mutate prevSel after construction
      prevSel.area = null

      action.execute()
      action.undo()

      const restored = state.lastSetSelection
      expect(restored).not.toBeNull()
      // Should have the original area, not null
      expect(restored!.area).not.toBeNull()
      expect(restored!.area!.TopLeft.X).toBe(10)
    })
  })

  describe('text message', () => {
    it('describes area selection with coordinates', () => {
      const sel = new EditorSelection()
      sel.area = mockCellCoordsRegion()
      const prev = new EditorSelection()
      const { controller } = makeSelectionController()

      const action = new ChangeSelectionAction(controller, sel, prev)
      expect(action.text).toContain('Selected area')
      expect(action.text).toContain('(10,20)')
      expect(action.text).toContain('5x5')
    })

    it('describes actor selection with ID', () => {
      const sel = new EditorSelection()
      sel.actor = mockActorPreview('actor42')
      const prev = new EditorSelection()
      const { controller } = makeSelectionController()

      const action = new ChangeSelectionAction(controller, sel, prev)
      expect(action.text).toContain('Selected actor')
      expect(action.text).toContain('actor42')
    })

    it('describes cleared selection', () => {
      const sel = new EditorSelection()
      const prev = new EditorSelection()
      prev.actor = mockActorPreview('wasSelected')
      const { controller } = makeSelectionController()

      const action = new ChangeSelectionAction(controller, sel, prev)
      expect(action.text).toBe('Cleared selection')
    })
  })

  describe('state transitions', () => {
    it('area → area selection change', () => {
      const oldSel = new EditorSelection()
      oldSel.area = mockCellCoordsRegion()

      const newSel = new EditorSelection()
      const region2 = {
        TopLeft: { X: 30, Y: 40 } as CPos,
        BottomRight: { X: 35, Y: 45 } as CPos,
        [Symbol.iterator]: () => [][Symbol.iterator](),
      } as unknown as CellCoordsRegion
      newSel.area = region2

      const { controller } = makeSelectionController(oldSel)
      const action = new ChangeSelectionAction(controller, newSel, oldSel)

      action.execute()
      expect(controller.selection.area!.TopLeft.X).toBe(30)
      expect(controller.selection.actor).toBeNull()

      action.undo()
      expect(controller.selection.area!.TopLeft.X).toBe(10)
      expect(controller.selection.actor).toBeNull()
    })

    it('actor → cleared selection', () => {
      const oldSel = new EditorSelection()
      oldSel.actor = mockActorPreview('removeMe')

      const newSel = new EditorSelection()

      const { controller } = makeSelectionController(oldSel)
      const action = new ChangeSelectionAction(controller, newSel, oldSel)

      action.execute()
      expect(controller.selection.hasSelection).toBe(false)

      action.undo()
      expect(controller.selection.actor).not.toBeNull()
    })

    it('cleared → actor selection', () => {
      const oldSel = new EditorSelection()

      const newSel = new EditorSelection()
      newSel.actor = mockActorPreview('newActor')

      const { controller } = makeSelectionController()
      const action = new ChangeSelectionAction(controller, newSel, oldSel)

      action.execute()
      expect(controller.selection.actor).not.toBeNull()
      expect(controller.selection.actor!.id).toBe('newActor')
    })
  })
})
