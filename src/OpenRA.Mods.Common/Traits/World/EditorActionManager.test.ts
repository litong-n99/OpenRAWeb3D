/**
 * EditorActionManager.test.ts — EditorActionManager migration unit tests
 *
 * Since EditorActionManager has no @babylonjs/core dependency, no mocks
 * are needed. Tests focus on: undo/redo stack behavior, event callbacks,
 * OpenMapAction guard, HasUnsavedItems, state transitions, edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  EditorActionManager,
  EditorActionManagerInfo,
  EditorActionStatus,
  EditorActionContainer,
  type IEditorAction,
} from './EditorActionManager.js'

// ---------------------------------------------------------------------------
// Test doubles — a simple IEditorAction that tracks calls
// ---------------------------------------------------------------------------

interface SpyAction {
  executeCount: number
  undoCount: number
  redoCount: number
  execute(): void
  undo(): void
  redo(): void
}

function makeSpyAction(
  text: string = 'test action',
): IEditorAction & SpyAction {
  const self: IEditorAction & SpyAction = {
    text,
    executeCount: 0,
    undoCount: 0,
    redoCount: 0,
    execute() {
      self.executeCount++
    },
    undo() {
      self.undoCount++
    },
    redo() {
      self.redoCount++
    },
  }
  return self
}

// ---------------------------------------------------------------------------
// Helpers for constructing worldLoaded stubs
// ---------------------------------------------------------------------------

import type { WorldStub, WorldRendererStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeWorldStub(): WorldStub {
  return { actors: [] as unknown as WorldStub['actors'] }
}

function makeWRStub(): WorldRendererStub {
  return {}
}

// ---------------------------------------------------------------------------
// EditorActionManagerInfo tests
// ---------------------------------------------------------------------------

describe('EditorActionManagerInfo', () => {
  it('creates an EditorActionManager instance via create()', () => {
    const info = new EditorActionManagerInfo()
    const mgr = info.create({ self: {} as any })
    expect(mgr).toBeInstanceOf(EditorActionManager)
  })
})

// ---------------------------------------------------------------------------
// IEditorAction / EditorActionContainer
// ---------------------------------------------------------------------------

describe('EditorActionContainer', () => {
  it('assigns id and action, defaults status to Active', () => {
    const action = makeSpyAction()
    const container = new EditorActionContainer(42, action)
    expect(container.id).toBe(42)
    expect(container.action).toBe(action)
    expect(container.status).toBe(EditorActionStatus.Active)
  })

  it('allows status to be changed', () => {
    const action = makeSpyAction()
    const container = new EditorActionContainer(1, action)
    container.status = EditorActionStatus.History
    expect(container.status).toBe(EditorActionStatus.History)
    container.status = EditorActionStatus.Future
    expect(container.status).toBe(EditorActionStatus.Future)
  })
})

// ---------------------------------------------------------------------------
// EditorActionManager core tests
// ---------------------------------------------------------------------------

describe('EditorActionManager', () => {
  let mgr: EditorActionManager

  beforeEach(() => {
    mgr = new EditorActionManager()
  })

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('has empty stacks and default flags', () => {
      expect(mgr.undoStack).toHaveLength(0)
      expect(mgr.redoStack).toHaveLength(0)
      expect(mgr.Modified).toBe(false)
      expect(mgr.SaveFailed).toBe(false)
      expect(mgr.HasUndos()).toBe(false)
      expect(mgr.HasRedos()).toBe(false)
    })

    it('HasUnsavedItems returns false initially', () => {
      expect(mgr.HasUnsavedItems()).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // worldLoaded
  // -----------------------------------------------------------------------

  describe('worldLoaded', () => {
    it('adds OpenMapAction and resets Modified to false', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())

      expect(mgr.undoStack).toHaveLength(1)
      expect(mgr.Modified).toBe(false)
      expect(mgr.HasUndos()).toBe(false) // only OpenMapAction, so no undo available
      expect(mgr.HasRedos()).toBe(false)
    })

    it('OpenMapAction text is descriptive', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const container = mgr.undoStack[0]
      expect(container.action.text).toBe('Map opened')
    })
  })

  // -----------------------------------------------------------------------
  // Add
  // -----------------------------------------------------------------------

  describe('Add', () => {
    it('sets Modified to true', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('place actor')
      mgr.Add(action)
      expect(mgr.Modified).toBe(true)
    })

    it('calls execute() on the action', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('place actor')
      mgr.Add(action)
      expect(action.executeCount).toBe(1)
      expect(action.undoCount).toBe(0)
      expect(action.redoCount).toBe(0)
    })

    it('pushes action onto undo stack', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('place actor')
      mgr.Add(action)
      expect(mgr.undoStack).toHaveLength(2) // OpenMapAction + new action
      expect(mgr.undoStack[1].action).toBe(action)
      expect(mgr.HasUndos()).toBe(true)
    })

    it('clears redo stack when new action is added', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action1 = makeSpyAction('action 1')
      mgr.Add(action1)
      mgr.Undo() // action1 → redo stack
      expect(mgr.HasRedos()).toBe(true)

      const action2 = makeSpyAction('action 2')
      mgr.Add(action2) // should clear redo
      expect(mgr.HasRedos()).toBe(false)
    })

    it('fires ItemAdded callback', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const callback = vi.fn()
      mgr.onItemAdded(callback)

      const action = makeSpyAction('test')
      mgr.Add(action)

      expect(callback).toHaveBeenCalledTimes(1)
      const container = callback.mock.calls[0][0] as EditorActionContainer
      expect(container.action).toBe(action)
    })

    it('sets previous top-of-stack status to History', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.Active)

      const action = makeSpyAction('new action')
      mgr.Add(action)

      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.History) // OpenMapAction now History
      expect(mgr.undoStack[1].status).toBe(EditorActionStatus.Active) // new action is Active
    })

    it('assigns auto-incrementing IDs', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      // OpenMapAction gets id 0
      expect(mgr.undoStack[0].id).toBe(0)

      mgr.Add(makeSpyAction('action 1'))
      expect(mgr.undoStack[1].id).toBe(1)

      mgr.Add(makeSpyAction('action 2'))
      expect(mgr.undoStack[2].id).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // Undo
  // -----------------------------------------------------------------------

  describe('Undo', () => {
    it('calls undo() on the top action', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('test')
      mgr.Add(action)

      mgr.Undo()
      expect(action.undoCount).toBe(1)
    })

    it('moves action from undo to redo stack', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))

      expect(mgr.undoStack).toHaveLength(2)
      expect(mgr.redoStack).toHaveLength(0)

      mgr.Undo()

      expect(mgr.undoStack).toHaveLength(1) // only OpenMapAction remains
      expect(mgr.redoStack).toHaveLength(1)
    })

    it('sets undone action status to Future', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()

      expect(mgr.redoStack[0].status).toBe(EditorActionStatus.Future)
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.Active)
    })

    it('sets Modified to true on undo', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('test')
      mgr.Add(action)
      mgr.Modified = false // simulate save
      mgr.Undo()
      expect(mgr.Modified).toBe(true)
    })

    it('does nothing when HasUndos is false (only OpenMapAction)', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      // Only OpenMapAction exists
      expect(mgr.HasUndos()).toBe(false)

      mgr.Undo() // should not throw
      expect(mgr.undoStack).toHaveLength(1) // OpenMapAction is preserved
      expect(mgr.redoStack).toHaveLength(0)
    })

    it('fires OnChange callback', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))

      const callback = vi.fn()
      mgr.onChange(callback)
      mgr.Undo()

      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Redo
  // -----------------------------------------------------------------------

  describe('Redo', () => {
    it('calls redo() on the undone action', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('test')
      mgr.Add(action)
      mgr.Undo()

      mgr.Redo()
      expect(action.redoCount).toBe(1)
    })

    it('moves action from redo back to undo stack', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()

      expect(mgr.redoStack).toHaveLength(1)

      mgr.Redo()

      expect(mgr.undoStack).toHaveLength(2)
      expect(mgr.redoStack).toHaveLength(0)
    })

    it('sets redone action status to Active', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()
      mgr.Redo()

      // After redo, the action is on top of undo stack with Active status
      // and the OpenMapAction below it has History status
      expect(mgr.undoStack[1].status).toBe(EditorActionStatus.Active)
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.History)
    })

    it('does nothing when HasRedos is false', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      expect(mgr.HasRedos()).toBe(false)

      mgr.Redo() // should not throw
      expect(mgr.undoStack).toHaveLength(1)
      expect(mgr.redoStack).toHaveLength(0)
    })

    it('fires OnChange callback', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()

      const callback = vi.fn()
      mgr.onChange(callback)
      mgr.Redo()

      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Multiple undo/redo cycles
  // -----------------------------------------------------------------------

  describe('multiple undo/redo cycles', () => {
    it('handles 3 actions → undo all → redo all', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())

      const a1 = makeSpyAction('action 1')
      const a2 = makeSpyAction('action 2')
      const a3 = makeSpyAction('action 3')

      mgr.Add(a1)
      mgr.Add(a2)
      mgr.Add(a3)

      expect(mgr.undoStack).toHaveLength(4) // OpenMapAction + 3
      expect(mgr.HasUndos()).toBe(true)

      // Undo all 3
      mgr.Undo()
      mgr.Undo()
      mgr.Undo()

      expect(mgr.undoStack).toHaveLength(1) // only OpenMapAction
      expect(mgr.redoStack).toHaveLength(3)
      expect(mgr.HasUndos()).toBe(false)

      expect(a3.undoCount).toBe(1)
      expect(a2.undoCount).toBe(1)
      expect(a1.undoCount).toBe(1)

      // Redo all 3
      mgr.Redo()
      mgr.Redo()
      mgr.Redo()

      expect(mgr.undoStack).toHaveLength(4)
      expect(mgr.redoStack).toHaveLength(0)
      expect(mgr.HasRedos()).toBe(false)

      expect(a1.redoCount).toBe(1)
      expect(a2.redoCount).toBe(1)
      expect(a3.redoCount).toBe(1)
    })

    it('partial undo → new Add → redo cleared', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())

      const a1 = makeSpyAction('action 1')
      const a2 = makeSpyAction('action 2')
      const a3 = makeSpyAction('action 3')

      mgr.Add(a1)
      mgr.Add(a2)
      mgr.Add(a3)

      // Undo 2 actions
      mgr.Undo()
      mgr.Undo()

      expect(mgr.redoStack).toHaveLength(2)

      // Add a new action (simulates different edit path)
      const a4 = makeSpyAction('action 4')
      mgr.Add(a4)

      // Redo stack should be cleared
      expect(mgr.redoStack).toHaveLength(0)
      expect(mgr.HasRedos()).toBe(false)

      // undo stack has: OpenMapAction + a1 + a4
      expect(mgr.undoStack).toHaveLength(3)
    })
  })

  // -----------------------------------------------------------------------
  // HasUndos / HasRedos
  // -----------------------------------------------------------------------

  describe('HasUndos / HasRedos', () => {
    it('HasUndos returns false when only OpenMapAction exists', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      expect(mgr.HasUndos()).toBe(false)
    })

    it('HasUndos returns true after adding an action', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      expect(mgr.HasUndos()).toBe(true)
    })

    it('HasRedos returns false initially', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      expect(mgr.HasRedos()).toBe(false)
    })

    it('HasRedos returns true after undo', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()
      expect(mgr.HasRedos()).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Rewind / Forward
  // -----------------------------------------------------------------------

  describe('Rewind and Forward', () => {
    it('Rewind calls Undo until top matches target id', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      // OpenMapAction id=0
      const a1 = makeSpyAction('action 1')
      const a2 = makeSpyAction('action 2')
      mgr.Add(a1) // id=1
      mgr.Add(a2) // id=2

      mgr.Rewind(0) // rewind to OpenMapAction

      // Should have undone both a2 and a1
      expect(mgr.undoStack).toHaveLength(1) // only OpenMapAction
      expect(mgr.undoStack[0].id).toBe(0)
      expect(mgr.redoStack).toHaveLength(2)
      expect(a2.undoCount).toBe(1)
      expect(a1.undoCount).toBe(1)
    })

    it('Forward calls Redo until top matches target id', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const a1 = makeSpyAction('action 1')
      const a2 = makeSpyAction('action 2')
      mgr.Add(a1) // id=1
      mgr.Add(a2) // id=2
      mgr.Rewind(0) // undo both

      mgr.Forward(2) // redo to id=2

      expect(mgr.undoStack).toHaveLength(3) // OpenMapAction + a1 + a2
      expect(mgr.undoStack[2].id).toBe(2)
      expect(mgr.redoStack).toHaveLength(0)
    })

    it('Rewind guards against infinite loop when target ID is unreachable (in redo stack)', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const a1 = makeSpyAction('action 1')
      mgr.Add(a1) // id=1
      mgr.Undo()  // a1 is now in redo stack, undo stack has only OpenMapAction (id=0)

      // id=1 is now in the redo stack — unreachable via Rewind
      // Without the guard, this would loop forever
      expect(() => mgr.Rewind(1)).not.toThrow()
      // Should stop at OpenMapAction (id=0), unable to find id=1
      expect(mgr.undoStack).toHaveLength(1)
      expect(mgr.undoStack[0].id).toBe(0)
    })

    it('Forward guards against infinite loop when target ID is unreachable (not in redo)', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const a1 = makeSpyAction('action 1')
      mgr.Add(a1) // id=1

      // id=99 does not exist anywhere — unreachable via Forward
      // Without the guard, this would loop forever
      expect(() => mgr.Forward(99)).not.toThrow()
      // Redo stack is empty, so HasRedos is false, loop breaks immediately
      expect(mgr.redoStack).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // HasUnsavedItems
  // -----------------------------------------------------------------------

  describe('HasUnsavedItems', () => {
    it('returns false when called before worldLoaded (null safety guard)', () => {
      // No worldLoaded() called — undoStack is empty
      mgr.Modified = true
      expect(() => mgr.HasUnsavedItems()).not.toThrow()
      expect(mgr.HasUnsavedItems()).toBe(false)
    })

    it('returns false when Modified is false', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      expect(mgr.HasUnsavedItems()).toBe(false)
    })

    it('returns true after adding an action', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      expect(mgr.HasUnsavedItems()).toBe(true)
    })

    it('returns true after undo (Modified = true)', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Modified = false // simulate save
      mgr.Undo()
      expect(mgr.HasUnsavedItems()).toBe(true)
    })

    it('returns true after redo (Modified = true)', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()
      mgr.Modified = false // simulate save
      mgr.Redo()
      expect(mgr.HasUnsavedItems()).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // SaveFailed flag
  // -----------------------------------------------------------------------

  describe('SaveFailed', () => {
    it('defaults to false', () => {
      expect(mgr.SaveFailed).toBe(false)
    })

    it('can be set to true', () => {
      mgr.SaveFailed = true
      expect(mgr.SaveFailed).toBe(true)
    })

    it('can be set back to false', () => {
      mgr.SaveFailed = true
      mgr.SaveFailed = false
      expect(mgr.SaveFailed).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Event subscription / unsubscription
  // -----------------------------------------------------------------------

  describe('event callbacks', () => {
    it('onItemAdded → offItemAdded unsubscribes correctly', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const cb = vi.fn()
      mgr.onItemAdded(cb)
      mgr.Add(makeSpyAction('test 1'))
      expect(cb).toHaveBeenCalledTimes(1)

      mgr.offItemAdded(cb)
      mgr.Add(makeSpyAction('test 2'))
      expect(cb).toHaveBeenCalledTimes(1) // no additional calls
    })

    it('onItemRemoved fires during ClearRedo', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('test')
      mgr.Add(action)
      mgr.Undo() // action is now in redo stack

      // Add a new action, which clears redo stack
      const removedCb = vi.fn()
      mgr.onItemRemoved(removedCb)
      mgr.Add(makeSpyAction('another action'))

      expect(removedCb).toHaveBeenCalledTimes(1)
    })

    it('offItemRemoved unsubscribes correctly', () => {
      const cb = vi.fn()
      mgr.onItemRemoved(cb)
      mgr.offItemRemoved(cb)

      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      const action = makeSpyAction('test')
      mgr.Add(action)
      mgr.Undo()
      mgr.Add(makeSpyAction('another action')) // should clear redo but cb was removed

      expect(cb).toHaveBeenCalledTimes(0)
    })

    it('offChange unsubscribes correctly', () => {
      const cb = vi.fn()
      mgr.onChange(cb)
      mgr.offChange(cb)

      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()

      expect(cb).toHaveBeenCalledTimes(0)
    })

    it('offItemAdded with non-existent callback does nothing', () => {
      const cb = vi.fn()
      expect(() => mgr.offItemAdded(cb)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('clears all stacks and resets state', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('action 1'))
      mgr.Add(makeSpyAction('action 2'))
      mgr.Modified = true
      mgr.SaveFailed = true

      mgr.dispose()

      expect(mgr.undoStack).toHaveLength(0)
      expect(mgr.redoStack).toHaveLength(0)
      expect(mgr.Modified).toBe(false)
      expect(mgr.SaveFailed).toBe(false)
      expect(mgr.HasUndos()).toBe(false)
      expect(mgr.HasRedos()).toBe(false)
    })

    it('callbacks are cleared on dispose', () => {
      const cb = vi.fn()
      mgr.onItemAdded(cb)
      mgr.onChange(cb)

      mgr.dispose()

      // After dispose, new actions should not fire callbacks
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('test'))
      mgr.Undo()

      expect(cb).toHaveBeenCalledTimes(0)
    })
  })

  // -----------------------------------------------------------------------
  // OpenMapAction guard — cannot undo past initial state
  // -----------------------------------------------------------------------

  describe('OpenMapAction guard', () => {
    it('prevents undoing the OpenMapAction', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      // Only OpenMapAction exists
      expect(mgr.HasUndos()).toBe(false)

      // Undo should be a no-op
      mgr.Undo()
      expect(mgr.undoStack).toHaveLength(1)
      expect(mgr.undoStack[0].action.text).toBe('Map opened')
    })

    it('allows undoing down to but not past OpenMapAction', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('only action'))
      mgr.Undo()

      // Back to just OpenMapAction
      expect(mgr.undoStack).toHaveLength(1)
      expect(mgr.HasUndos()).toBe(false)

      // Cannot undo further
      mgr.Undo()
      expect(mgr.undoStack).toHaveLength(1)
      expect(mgr.redoStack).toHaveLength(1) // our action is still in redo
    })
  })

  // -----------------------------------------------------------------------
  // Status transitions
  // -----------------------------------------------------------------------

  describe('status transitions', () => {
    it('new actions start as Active, previous becomes History', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      // OpenMapAction is Active
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.Active)

      mgr.Add(makeSpyAction('action 1'))
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.History)
      expect(mgr.undoStack[1].status).toBe(EditorActionStatus.Active)
    })

    it('Undo sets popped action to Future, new top to Active', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('action 1'))
      mgr.Undo()

      expect(mgr.redoStack[0].status).toBe(EditorActionStatus.Future)
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.Active)
    })

    it('Redo sets popped action to Active, previous top to History', () => {
      mgr.worldLoaded(makeWorldStub(), makeWRStub())
      mgr.Add(makeSpyAction('action 1'))
      mgr.Undo()
      mgr.Redo()

      expect(mgr.undoStack[1].status).toBe(EditorActionStatus.Active)
      expect(mgr.undoStack[0].status).toBe(EditorActionStatus.History)
    })
  })
})
