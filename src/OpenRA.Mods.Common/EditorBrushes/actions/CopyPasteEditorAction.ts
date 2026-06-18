/**
 * CopyPasteEditorAction.ts — Paste clipboard contents as an undoable editor action
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.cs
 *   sealed class CopyPasteEditorAction : IEditorAction (lines 129-173)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 *
 * Migration:  — Chapter 21 Phase B Wave 3
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { EditorBlit } from '../EditorBlit.js'

/**
 * Editor action wrapping an EditorBlit commit/revert as an undoable paste.
 *
 * OpenRA 对照: CopyPasteEditorAction
 */
export class CopyPasteEditorAction implements IEditorAction {
  text: string

  private readonly editorBlit: EditorBlit

  /**
   * Create a CopyPasteEditorAction.
   *
   * @param editorBlit — the configured EditorBlit for this paste
   */
  constructor(editorBlit: EditorBlit) {
    this.editorBlit = editorBlit

    const actors = editorBlit.actorCount()
    const tiles = editorBlit.tileCount()

    // TODO-21.B.2-DEFER-7: FluentProvider for localized strings
    if (tiles > 0 && actors === 0) {
      this.text = `Copied ${tiles} tile(s)`
    } else if (tiles === 0 && actors > 0) {
      this.text = `Copied ${actors} actor(s)`
    } else {
      this.text = `Copied ${tiles} tile(s), ${actors} actor(s)`
    }
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.editorBlit.commit()
  }

  undo(): void {
    this.editorBlit.revert()
  }
}
