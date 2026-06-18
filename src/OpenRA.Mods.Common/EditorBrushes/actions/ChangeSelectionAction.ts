/**
 * ChangeSelectionAction.ts — Editor undo/redo action for selection changes
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs
 *   sealed class ChangeSelectionAction : IEditorAction (lines 294-350)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings
 * - C# class inside EditorDefaultBrush → standalone class in own file
 * - C# direct EditorDefaultBrush dependency → ISelectionController interface
 *   (Dependency Inversion, enables unit testing)
 *
 * Migration: TODO-21.B.2 — Chapter 21 Phase B
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import { EditorSelection, type ISelectionController } from '../types.js'

/**
 * Records selection changes for undo/redo support.
 *
 * OpenRA 对照: sealed class ChangeSelectionAction : IEditorAction
 *
 * Snapshots the previous selection and applies the new one on execute/redo.
 * On undo, restores the previous selection.
 * The text message describes what was selected (area coordinates, actor ID,
 * or "cleared selection").
 */
export class ChangeSelectionAction implements IEditorAction {
  // -------------------------------------------------------------------------
  // Constants (对应 OpenRA FluentReference const strings)
  // -------------------------------------------------------------------------

  // NOTE: C# uses FluentProvider.GetMessage("notification-selected-area", ...)
  // Since FluentProvider is not yet migrated, hardcoded English strings are used.
  // TODO-21.B.1-DEFER-1: Replace with FluentProvider when migrated.

  /**
   * Human-readable description of this action.
   *
   * OpenRA 对照: IEditorAction.Text { get; }
   */
  readonly text: string

  /** The destination selection to apply on execute/redo. */
  private readonly selection: EditorSelection

  /** The previous selection to restore on undo. */
  private readonly previousSelection: EditorSelection

  /** Reference to the brush that owns the selection state. */
  private readonly selectionController: ISelectionController

  /**
   * Create a ChangeSelectionAction.
   *
   * OpenRA 对照: ChangeSelectionAction(EditorDefaultBrush, EditorSelection, EditorSelection)
   *
   * Deep-copies the selection and previousSelection to prevent external mutation.
   *
   * @param selectionController — the selection controller (EditorDefaultBrush in OpenRA)
   * @param selection — the new selection state
   * @param previousSelection — the prior selection state (for undo)
   */
  constructor(
    selectionController: ISelectionController,
    selection: EditorSelection,
    previousSelection: EditorSelection,
  ) {
    this.selectionController = selectionController

    // Deep-copy selections to prevent mutation
    this.selection = new EditorSelection()
    this.selection.area = selection.area
    this.selection.actor = selection.actor

    this.previousSelection = new EditorSelection()
    this.previousSelection.area = previousSelection.area
    this.previousSelection.actor = previousSelection.actor

    // Build human-readable text
    if (selection.area !== null) {
      const a = selection.area
      this.text =
        `Selected area: (${a.TopLeft.X},${a.TopLeft.Y}) ` +
        `${a.BottomRight.X - a.TopLeft.X}x` +
        `${a.BottomRight.Y - a.TopLeft.Y}`
    } else if (selection.actor !== null) {
      this.text = `Selected actor: ${selection.actor.id}`
    } else {
      this.text = 'Cleared selection'
    }
  }

  /**
   * Execute the action for the first time.
   *
   * OpenRA 对照: ChangeSelectionAction.Execute() → Do()
   */
  execute(): void {
    this.redo()
  }

  /**
   * Apply the new selection.
   *
   * OpenRA 对照: ChangeSelectionAction.Do()
   */
  redo(): void {
    this.selectionController.setSelection(this.selection)
  }

  /**
   * Restore the previous selection.
   *
   * OpenRA 对照: ChangeSelectionAction.Undo()
   */
  undo(): void {
    this.selectionController.setSelection(this.previousSelection)
  }
}
