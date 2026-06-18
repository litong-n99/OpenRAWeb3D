/**
 * UpdateTilingPathPlanEditorAction.ts — Undoable tiling path plan update (create/modify/reset)
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.cs
 *   sealed class UpdateTilingPathPlanEditorAction : IEditorAction (lines 283-329)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 *
 * Migration:  — Chapter 21 Phase B Wave 3
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import { PathPlan, type TilingPathTool } from '../../Traits/World/TilingPathTool.js'

/**
 * Undoable action for updating (or creating/removing) a tiling path plan.
 *
 * OpenRA 对照: UpdateTilingPathPlanEditorAction
 */
export class UpdateTilingPathPlanEditorAction implements IEditorAction {
  text: string

  private readonly tool: TilingPathTool
  private readonly oldPlan: PathPlan | null
  private readonly newPlan: PathPlan | null

  /**
   * Create an action to swap the tool's plan.
   *
   * @throws if both oldPlan and newPlan are null
   */
  constructor(tool: TilingPathTool, newPlan: PathPlan | null) {
    this.tool = tool
    this.oldPlan = tool.plan
    this.newPlan = newPlan

    if (this.oldPlan === null && this.newPlan === null) {
      throw new Error('oldPlan and newPlan cannot both be null')
    } else if (this.oldPlan === null) {
      // TODO-21.B.2-DEFER-7: FluentProvider
      this.text = 'Started tiling path'
    } else if (this.newPlan === null) {
      this.text = 'Reset tiling path'
    } else {
      this.text = 'Updated tiling path'
    }
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.tool.setPlan(this.newPlan)
  }

  undo(): void {
    this.tool.setPlan(this.oldPlan)
  }
}
