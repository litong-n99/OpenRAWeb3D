/**
 * RemoveActorAction.ts — Editor undo/redo action for removing an actor
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs
 *   sealed class RemoveActorAction : IEditorAction (lines 509-541)
 *   sealed class RemoveSelectedActorAction : IEditorAction (lines 463-508)
 *
 * 核心范式转换:
 * - C# two separate classes (RemoveActorAction, RemoveSelectedActorAction)
 *   → unified into one class with optional ISelectionController parameter
 * - C# FluentProvider.GetMessage → template literal string
 * - C# direct EditorDefaultBrush dependency → ISelectionController interface
 *
 * Migration:  — Chapter 21 Phase B
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import { EditorSelection, type ISelectionController } from '../types.js'
import type { EditorActorLayer } from '../../Traits/World/EditorActorLayer.js'
import type { EditorActorPreview } from '../../Traits/World/EditorActorPreview.js'

/**
 * Removes a single actor from the editor layer, with undo support.
 *
 * OpenRA 对照: sealed class RemoveActorAction : IEditorAction
 *   + sealed class RemoveSelectedActorAction : IEditorAction
 *
 * Do() removes the actor from the layer. Undo() adds it back.
 *
 * If a selectionController is provided, the action also clears the brush's
 * selection on Do() and restores it on Undo(). This combines the C#
 * RemoveActorAction (no selection change) with RemoveSelectedActorAction
 * (also clears selection) into one unified class.
 */
export class RemoveActorAction implements IEditorAction {
  /** Human-readable description.
   *
   * OpenRA 对照: RemoveActorAction.Text { get; }
   */
  readonly text: string

  /** The editor actor layer. */
  private readonly editorActorLayer: EditorActorLayer

  /** The actor being removed. */
  private readonly actor: EditorActorPreview

  /** Optional selection controller for clearing/restoring selection. */
  private readonly selectionController: ISelectionController | null

  /** Saved selection for undo (if selectionController is provided). */
  private readonly savedSelection: EditorSelection | null

  /**
   * Create a RemoveActorAction.
   *
   * OpenRA 对照: RemoveActorAction(EditorActorLayer, EditorActorPreview)
   *   or RemoveSelectedActorAction(EditorDefaultBrush, EditorActorLayer, EditorActorPreview)
   *
   * @param editorActorLayer — the editor actor layer
   * @param actor — the actor to remove
   * @param selectionController — optional selection controller whose selection should be cleared/restored
   */
  constructor(
    editorActorLayer: EditorActorLayer,
    actor: EditorActorPreview,
    selectionController?: ISelectionController,
  ) {
    this.editorActorLayer = editorActorLayer
    this.actor = actor
    this.selectionController = selectionController ?? null

    // Save brush selection for undo if appropriate
    if (this.selectionController) {
      const sel = new EditorSelection()
      sel.actor = this.selectionController.selection.actor
      sel.area = this.selectionController.selection.area
      this.savedSelection = sel
    } else {
      this.savedSelection = null
    }

    // NOTE: C# uses FluentProvider.GetMessage("notification-removed-actor", ...)
    // Since FluentProvider is not yet migrated, hardcoded English strings are used.
    // TODO-21.B.1-DEFER-1: Replace with FluentProvider when migrated.
    this.text = `Removed actor: ${actor.info.name} (${actor.id})`
  }

  /**
   * Execute the removal for the first time.
   *
   * OpenRA 对照: RemoveActorAction.Execute() → Do()
   */
  execute(): void {
    this.redo()
  }

  /**
   * Remove the actor from the layer. Also clears selection if applicable.
   *
   * OpenRA 对照: RemoveActorAction.Do()
   *   RemoveSelectedActorAction.Do() — also calls defaultBrush.SetSelection(new EditorSelection())
   */
  redo(): void {
    if (this.selectionController) {
      this.selectionController.setSelection(new EditorSelection())
    }
    this.editorActorLayer.remove(this.actor)
  }

  /**
   * Restore the actor to the layer. Also restores selection if applicable.
   *
   * OpenRA 对照: RemoveActorAction.Undo()
   *   RemoveSelectedActorAction.Undo() — also calls defaultBrush.SetSelection(selection)
   */
  undo(): void {
    this.editorActorLayer.addPreview(this.actor)
    if (this.selectionController && this.savedSelection) {
      this.selectionController.setSelection(this.savedSelection)
    }
  }
}
