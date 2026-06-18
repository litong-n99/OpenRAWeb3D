/**
 * RemoveResourceAction.ts — Editor undo/redo action for removing resources at a cell
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs
 *   sealed class RemoveResourceAction : IEditorAction (lines 590-626)
 *
 * 核心范式转换:
 * - C# ResourceLayerContents struct → TypeScript ResourceLayerContents interface
 * - C# FluentProvider.GetMessage → template literal string
 * - C# readonly record struct snapshot → TypeScript value save/restore
 *
 * Migration: TODO-21.B.2 — Chapter 21 Phase B
 */

import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { IResourceLayer, ResourceLayerContents } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ResourceLayerContentsEmpty } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

/**
 * Removes resources from a single cell, with undo support.
 *
 * OpenRA 对照: sealed class RemoveResourceAction : IEditorAction
 *
 * Do() clears resources and saves the previous contents for undo.
 * Undo() restores the saved contents.
 */
export class RemoveResourceAction implements IEditorAction {
  /** Human-readable description.
   *
   * OpenRA 对照: RemoveResourceAction.Text { get; }
   */
  readonly text: string

  /** The resource layer. */
  private readonly resourceLayer: IResourceLayer

  /** The target cell. */
  private readonly cell: CPos

  /** Saved resource contents before removal (for undo). */
  private resourceContents: ResourceLayerContents = ResourceLayerContentsEmpty

  /**
   * Create a RemoveResourceAction.
   *
   * OpenRA 对照: RemoveResourceAction(IResourceLayer, CPos, string)
   *
   * Saves the cell position and resource type name for display.
   * The actual contents are snapshotted in Do(), not in the constructor,
   * to match C# behavior (snapshot at execution time, not construction time).
   *
   * @param resourceLayer — the resource layer
   * @param cell — the target cell
   * @param resourceType — the resource type name (for display text)
   */
  constructor(
    resourceLayer: IResourceLayer,
    cell: CPos,
    resourceType: string,
  ) {
    this.resourceLayer = resourceLayer
    this.cell = cell

    // NOTE: C# uses FluentProvider.GetMessage("notification-removed-resource", "type", resourceType)
    // Since FluentProvider is not yet migrated, hardcoded English strings are used.
    // TODO-21.B.1-DEFER-1: Replace with FluentProvider when migrated.
    this.text = `Removed resource: ${resourceType}`
  }

  /**
   * Execute the removal for the first time.
   *
   * OpenRA 对照: RemoveResourceAction.Execute() → Do()
   */
  execute(): void {
    this.redo()
  }

  /**
   * Clear resources and save previous contents.
   *
   * OpenRA 对照: RemoveResourceAction.Do()
   *
   * Snapshots the current resource contents before clearing, so Undo() can
   * restore them.
   */
  redo(): void {
    this.resourceContents = this.resourceLayer.getResource(this.cell)
    this.resourceLayer.clearResources(this.cell)
  }

  /**
   * Restore the saved resource contents.
   *
   * OpenRA 对照: RemoveResourceAction.Undo()
   *
   * First clears whatever is currently at the cell, then restores the
   * original resource type and density.
   */
  undo(): void {
    this.resourceLayer.clearResources(this.cell)
    if (this.resourceContents.type) {
      this.resourceLayer.addResource(
        this.resourceContents.type,
        this.cell,
        this.resourceContents.density,
      )
    }
  }
}
