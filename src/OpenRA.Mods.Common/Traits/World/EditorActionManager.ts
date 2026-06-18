/**
 * EditorActionManager.ts — 编辑器撤销/重做命令堆栈
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/EditorActionManager.cs (189 lines C#)
 *
 * 核心范式转换:
 * - C# Stack<EditorActionContainer> undo/redo → TypeScript Array<EditorActionContainer>
 *   with push()/pop() matching C# semantics
 * - C# event Action<T> → TypeScript callback arrays
 * - C# IEditorAction.Do() → TypeScript redo() (avoids reserved word 'do')
 * - C# FluentProvider.GetMessage → hardcoded string (FluentProvider not yet migrated)
 * - C# [TraitLocation(SystemActors.EditorWorld)] → JSDoc annotation
 *
 * Migration: TODO-21.A.1 — Chapter 21 Phase A
 */

import type {
  ITraitInfo,
  IWorldLoaded,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WorldStub, WorldRendererStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IEditorAction interface (对应 OpenRA IEditorAction)
// ---------------------------------------------------------------------------

/**
 * A reversible editor action that can be executed, undone, and redone.
 *
 * OpenRA 对照: IEditorAction { void Execute(); void Do(); void Undo(); string Text { get; } }
 *
 * NOTE: C# `Do()` is renamed to `redo()` in TypeScript because `do` is a
 * reserved keyword. The semantics are identical: `execute()` is called on
 * first add, `redo()` is called on redo (after undo). By default, `redo()`
 * simply calls `execute()` again.
 */
export interface IEditorAction {
  /** Execute the action for the first time.
   *
   * OpenRA 对照: IEditorAction.Execute()
   */
  execute(): void

  /** Reverse the action.
   *
   * OpenRA 对照: IEditorAction.Undo()
   */
  undo(): void

  /** Re-apply the action after it was undone.
   *
   * OpenRA 对照: IEditorAction.Do()
   *
   * NOTE: Renamed from `Do` to `redo` to avoid the TypeScript `do` keyword.
   */
  redo(): void

  /** Human-readable description of this action.
   *
   * OpenRA 对照: IEditorAction.Text { get; }
   */
  readonly text: string
}

// ---------------------------------------------------------------------------
// EditorActionStatus enum (对应 OpenRA EditorActionStatus)
// ---------------------------------------------------------------------------

/**
 * Status of an editor action in the undo/redo stacks.
 *
 * OpenRA 对照: EditorActionStatus { History, Active, Future }
 */
export const EditorActionStatus = {
  /** Action is in the undo stack (was executed, not currently active). */
  History: 0,
  /** Action is the current active state (top of undo stack). */
  Active: 1,
  /** Action is in the redo stack (was undone, can be redone). */
  Future: 2,
} as const

export type EditorActionStatus = (typeof EditorActionStatus)[keyof typeof EditorActionStatus]

// ---------------------------------------------------------------------------
// EditorActionContainer (对应 OpenRA EditorActionContainer)
// ---------------------------------------------------------------------------

/**
 * Wrapper that associates an IEditorAction with a unique ID and status.
 *
 * OpenRA 对照: EditorActionContainer
 */
export class EditorActionContainer {
  /** Unique sequential identifier for this action.
   *
   * OpenRA 对照: EditorActionContainer.Id
   */
  readonly id: number

  /** The editor action.
   *
   * OpenRA 对照: EditorActionContainer.Action
   */
  readonly action: IEditorAction

  /** Current status in the undo/redo stacks.
   *
   * OpenRA 对照: EditorActionContainer.Status
   */
  status: EditorActionStatus

  constructor(id: number, action: IEditorAction) {
    this.id = id
    this.action = action
    this.status = EditorActionStatus.Active
  }
}

// ---------------------------------------------------------------------------
// OpenMapAction (对应 OpenRA OpenMapAction : IEditorAction, sealed)
// ---------------------------------------------------------------------------

/**
 * Marks the initial map load state. Cannot undo past this action.
 *
 * OpenRA 对照: OpenMapAction (sealed class, private to EditorActionManager)
 *
 * Execute and Redo are no-ops — this action represents the baseline state
 * of the map when it was first opened. Undo is also a no-op, which prevents
 * the user from undoing past the initial state.
 *
 * NOTE: C# uses FluentProvider.GetMessage("notification-opened") for the
 * text. Since FluentProvider is not yet migrated, a hardcoded string is used.
 */
class OpenMapAction implements IEditorAction {
  readonly text: string

  // C# has: [FluentReference] const string Opened = "notification-opened";
  // text = FluentProvider.GetMessage(Opened);
  constructor() {
    this.text = 'Map opened'
  }

  execute(): void {
    // C#: Execute() calls Do() which is a no-op
    this.redo()
  }

  undo(): void {
    // Cannot undo past the initial map load state
  }

  redo(): void {
    // No-op: initial state has nothing to re-apply
  }
}

// ---------------------------------------------------------------------------
// Callback type aliases
// ---------------------------------------------------------------------------

/** Signature for ItemAdded / ItemRemoved event callbacks.
 *
 * OpenRA 对照: event Action<EditorActionContainer>
 */
export type EditorActionContainerCallback = (container: EditorActionContainer) => void

/** Signature for OnChange event callbacks.
 *
 * OpenRA 对照: event Action
 */
export type EditorActionChangeCallback = () => void

// ---------------------------------------------------------------------------
// EditorActionManagerInfo (对应 OpenRA EditorActionManagerInfo : TraitInfo<EditorActionManager>)
// ---------------------------------------------------------------------------

/**
 * Trait info for EditorActionManager.
 *
 * OpenRA 对照: EditorActionManagerInfo
 *
 * @TraitLocation SystemActors.EditorWorld
 */
export class EditorActionManagerInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Create the EditorActionManager trait instance.
   *
   * OpenRA 对照: TraitInfo<EditorActionManager>.Create(ActorInitializer)
   *
   * @param _init — actor initializer (unused by this trait)
   * @returns a new EditorActionManager instance
   */
  create(_init: { self: IGameActor }): EditorActionManager {
    return new EditorActionManager()
  }
}

// ---------------------------------------------------------------------------
// EditorActionManager (对应 OpenRA EditorActionManager : IWorldLoaded)
// ---------------------------------------------------------------------------

/**
 * Manages the undo/redo command stack for the map editor.
 *
 * OpenRA 对照: EditorActionManager : IWorldLoaded
 *
 * Every mutation to the map goes through EditorActionManager.add(action).
 * Actions are serializable and reversible. The undo stack is initialized
 * with an OpenMapAction that prevents undoing past the initial map state.
 *
 * Event hooks (onItemAdded, onItemRemoved, onChange) allow UI panels to
 * react to stack changes (e.g., updating undo/redo button states).
 */
export class EditorActionManager implements IWorldLoaded {
  // ---------------------------------------------------------------------------
  // Stacks (对应 OpenRA Stack<EditorActionContainer>)
  // ---------------------------------------------------------------------------

  /** Undo stack — oldest action at bottom, most recent at top.
   *
   * OpenRA 对照: Stack<EditorActionContainer> undoStack
   */
  readonly undoStack: EditorActionContainer[] = []

  /** Redo stack — most recently undone action at top.
   *
   * OpenRA 对照: Stack<EditorActionContainer> redoStack
   */
  readonly redoStack: EditorActionContainer[] = []

  // ---------------------------------------------------------------------------
  // State (对应 OpenRA fields)
  // ---------------------------------------------------------------------------

  /** Auto-incrementing ID counter for new actions.
   *
   * OpenRA 对照: int nextId
   */
  private _nextId: number = 0

  /** Whether the map has been modified since last save.
   *
   * OpenRA 对照: bool Modified
   */
  Modified: boolean = false

  /** Whether the last save attempt failed.
   *
   * OpenRA 对照: bool SaveFailed
   */
  SaveFailed: boolean = false

  // ---------------------------------------------------------------------------
  // Event callbacks (对应 OpenRA event Action<>)
  // ---------------------------------------------------------------------------

  /** Callbacks invoked when an action container is added to the undo stack.
   *
   * OpenRA 对照: event Action<EditorActionContainer> ItemAdded
   */
  private _itemAddedCallbacks: EditorActionContainerCallback[] = []

  /** Callbacks invoked when an action container is removed from the redo stack.
   *
   * OpenRA 对照: event Action<EditorActionContainer> ItemRemoved
   */
  private _itemRemovedCallbacks: EditorActionContainerCallback[] = []

  /** Callbacks invoked when the stack state changes (undo/redo executed).
   *
   * OpenRA 对照: event Action OnChange
   */
  private _onChangeCallbacks: EditorActionChangeCallback[] = []

  // ---------------------------------------------------------------------------
  // IWorldLoaded.worldLoaded (对应 OpenRA WorldLoaded)
  // ---------------------------------------------------------------------------

  /**
   * Initialize the undo stack with the initial map state.
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World w, WorldRenderer wr)
   *
   * Adds an OpenMapAction as the first item in the undo stack. This ensures
   * the user cannot undo past the initial map state (HasUndos returns false
   * when only the OpenMapAction remains).
   *
   * @param _w — the world (unused)
   * @param _wr — the world renderer (unused)
   */
  worldLoaded(_w: WorldStub, _wr: WorldRendererStub): void {
    this.Add(new OpenMapAction())
    this.Modified = false
  }

  // ---------------------------------------------------------------------------
  // Add (对应 OpenRA Add(IEditorAction editorAction))
  // ---------------------------------------------------------------------------

  /**
   * Execute an action and push it onto the undo stack.
   *
   * OpenRA 对照: EditorActionManager.Add(IEditorAction editorAction)
   *
   * Marks the map as modified, executes the action, clears the redo stack
   * (since new actions invalidate the redo history), and pushes the action
   * onto the undo stack. Fires the ItemAdded event.
   *
   * @param editorAction — the action to execute and record
   */
  Add(editorAction: IEditorAction): void {
    this.Modified = true
    editorAction.execute()

    if (this.undoStack.length > 0) {
      this.undoStack[this.undoStack.length - 1].status = EditorActionStatus.History
    }

    const actionContainer = new EditorActionContainer(
      this._nextId++,
      editorAction,
    )

    this._clearRedo()
    this.undoStack.push(actionContainer)

    this._fireItemAdded(actionContainer)
  }

  // ---------------------------------------------------------------------------
  // Undo (对应 OpenRA Undo())
  // ---------------------------------------------------------------------------

  /**
   * Undo the most recent action.
   *
   * OpenRA 对照: EditorActionManager.Undo()
   *
   * Pops the top action from the undo stack, calls its undo() method,
   * and pushes it onto the redo stack. Fires the OnChange event.
   * Does nothing if there are no undos available.
   */
  Undo(): void {
    if (!this.HasUndos()) {
      return
    }

    this.Modified = true

    const editorAction = this.undoStack.pop()!
    this.undoStack[this.undoStack.length - 1].status = EditorActionStatus.Active
    editorAction.action.undo()
    editorAction.status = EditorActionStatus.Future
    this.redoStack.push(editorAction)

    this._fireOnChange()
  }

  // ---------------------------------------------------------------------------
  // Redo (对应 OpenRA Redo())
  // ---------------------------------------------------------------------------

  /**
   * Redo the most recently undone action.
   *
   * OpenRA 对照: EditorActionManager.Redo()
   *
   * Pops the top action from the redo stack, calls its redo() method,
   * and pushes it back onto the undo stack. Fires the OnChange event.
   * Does nothing if there are no redos available.
   */
  Redo(): void {
    if (!this.HasRedos()) {
      return
    }

    this.Modified = true

    const editorAction = this.redoStack.pop()!
    editorAction.status = EditorActionStatus.Active
    editorAction.action.redo()
    this.undoStack[this.undoStack.length - 1].status = EditorActionStatus.History
    this.undoStack.push(editorAction)

    this._fireOnChange()
  }

  // ---------------------------------------------------------------------------
  // HasUndos (对应 OpenRA HasUndos())
  // ---------------------------------------------------------------------------

  /**
   * Check whether there are actions available to undo.
   *
   * OpenRA 对照: EditorActionManager.HasUndos()
   *
   * Returns true if the undo stack has more than 1 entry. The bottom entry
   * is always an OpenMapAction which cannot be undone past.
   *
   * @returns true if undo is available
   */
  HasUndos(): boolean {
    // Preserve the initial OpenMapAction
    return this.undoStack.length > 1
  }

  // ---------------------------------------------------------------------------
  // HasRedos (对应 OpenRA HasRedos())
  // ---------------------------------------------------------------------------

  /**
   * Check whether there are actions available to redo.
   *
   * OpenRA 对照: EditorActionManager.HasRedos()
   *
   * @returns true if redo is available
   */
  HasRedos(): boolean {
    return this.redoStack.length > 0
  }

  // ---------------------------------------------------------------------------
  // Rewind (对应 OpenRA Rewind(int id))
  // ---------------------------------------------------------------------------

  /**
   * Undo actions until the top of the undo stack has the given ID.
   *
   * OpenRA 对照: EditorActionManager.Rewind(int id)
   *
   * Repeatedly calls Undo() until the undo stack top's ID matches the target.
   * This allows jumping to a specific point in the action history.
   *
   * @param id — the target action ID to rewind to
   */
  Rewind(id: number): void {
    while (this.undoStack[this.undoStack.length - 1].id !== id) {
      this.Undo()
    }
  }

  // ---------------------------------------------------------------------------
  // Forward (对应 OpenRA Forward(int id))
  // ---------------------------------------------------------------------------

  /**
   * Redo actions until the top of the undo stack has the given ID.
   *
   * OpenRA 对照: EditorActionManager.Forward(int id)
   *
   * Repeatedly calls Redo() until the undo stack top's ID matches the target.
   *
   * @param id — the target action ID to forward to
   */
  Forward(id: number): void {
    while (this.undoStack[this.undoStack.length - 1].id !== id) {
      this.Redo()
    }
  }

  // ---------------------------------------------------------------------------
  // HasUnsavedItems (对应 OpenRA HasUnsavedItems())
  // ---------------------------------------------------------------------------

  /**
   * Check if there are unsaved changes.
   *
   * OpenRA 对照: EditorActionManager.HasUnsavedItems()
   *
   * Returns true if the map is modified AND the current state is not the
   * initial OpenMapAction. A map with only the OpenMapAction (and no redos)
   * is considered unchanged.
   *
   * @returns true if there are unsaved changes
   */
  HasUnsavedItems(): boolean {
    // Modified and last action isn't the OpenMapAction (+ no redos)
    return (
      this.Modified &&
      !(
        this.undoStack[this.undoStack.length - 1].action instanceof
          OpenMapAction && !this.HasRedos()
      )
    )
  }

  // ---------------------------------------------------------------------------
  // Event subscription (对应 OpenRA event += / -=)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to the ItemAdded event.
   *
   * OpenRA 对照: ItemAdded += callback
   *
   * @param callback — invoked when a new action is added to the undo stack
   */
  onItemAdded(callback: EditorActionContainerCallback): void {
    this._itemAddedCallbacks.push(callback)
  }

  /**
   * Unsubscribe from the ItemAdded event.
   *
   * OpenRA 对照: ItemAdded -= callback
   *
   * @param callback — the callback to remove
   */
  offItemAdded(callback: EditorActionContainerCallback): void {
    const idx = this._itemAddedCallbacks.indexOf(callback)
    if (idx !== -1) {
      this._itemAddedCallbacks.splice(idx, 1)
    }
  }

  /**
   * Subscribe to the ItemRemoved event.
   *
   * OpenRA 对照: ItemRemoved += callback
   *
   * @param callback — invoked when an action is removed from the redo stack
   */
  onItemRemoved(callback: EditorActionContainerCallback): void {
    this._itemRemovedCallbacks.push(callback)
  }

  /**
   * Unsubscribe from the ItemRemoved event.
   *
   * OpenRA 对照: ItemRemoved -= callback
   *
   * @param callback — the callback to remove
   */
  offItemRemoved(callback: EditorActionContainerCallback): void {
    const idx = this._itemRemovedCallbacks.indexOf(callback)
    if (idx !== -1) {
      this._itemRemovedCallbacks.splice(idx, 1)
    }
  }

  /**
   * Subscribe to the OnChange event.
   *
   * OpenRA 对照: OnChange += callback
   *
   * @param callback — invoked after undo or redo
   */
  onChange(callback: EditorActionChangeCallback): void {
    this._onChangeCallbacks.push(callback)
  }

  /**
   * Unsubscribe from the OnChange event.
   *
   * OpenRA 对照: OnChange -= callback
   *
   * @param callback — the callback to remove
   */
  offChange(callback: EditorActionChangeCallback): void {
    const idx = this._onChangeCallbacks.indexOf(callback)
    if (idx !== -1) {
      this._onChangeCallbacks.splice(idx, 1)
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Dispose the action manager, clearing all stacks and callbacks.
   */
  dispose(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this._itemAddedCallbacks = []
    this._itemRemovedCallbacks = []
    this._onChangeCallbacks = []
    this.Modified = false
    this.SaveFailed = false
    this._nextId = 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Clear the redo stack, firing ItemRemoved for each removed action.
   *
   * OpenRA 对照: ClearRedo() (private)
   */
  private _clearRedo(): void {
    while (this.HasRedos()) {
      const item = this.redoStack.pop()!
      this._fireItemRemoved(item)
    }
  }

  /**
   * Fire all ItemAdded callbacks.
   *
   * OpenRA 对照: ItemAdded?.Invoke(container)
   */
  private _fireItemAdded(container: EditorActionContainer): void {
    for (const cb of this._itemAddedCallbacks) {
      cb(container)
    }
  }

  /**
   * Fire all ItemRemoved callbacks.
   *
   * OpenRA 对照: ItemRemoved?.Invoke(item)
   */
  private _fireItemRemoved(container: EditorActionContainer): void {
    for (const cb of this._itemRemovedCallbacks) {
      cb(container)
    }
  }

  /**
   * Fire all OnChange callbacks.
   *
   * OpenRA 对照: OnChange?.Invoke()
   */
  private _fireOnChange(): void {
    for (const cb of this._onChangeCallbacks) {
      cb()
    }
  }
}
