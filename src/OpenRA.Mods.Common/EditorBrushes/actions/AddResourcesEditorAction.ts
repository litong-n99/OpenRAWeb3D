/**
 * AddResourcesEditorAction.ts — Accumulated resource placement undo/redo action
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.cs
 *   sealed class AddResourcesEditorAction : IEditorAction (lines 113-160)
 *
 * 核心范式转换:
 * - C# List<CellResource>.TrimExcess() → no-op (TS arrays don't have this)
 * - C# FluentProvider.GetMessage → template literal
 * - C# null checks on resource type → TS '' (empty string) for no resource
 *
 * Migration: TODO-21.B.5 — Chapter 21 Phase B Wave 2
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { IResourceLayer } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CellResource } from '../types.js'

/**
 * Accumulates resource placements during a brush stroke and applies them
 * all at once.
 *
 * OpenRA 对照: AddResourcesEditorAction (inner class in EditorResourceBrush.cs)
 *
 * Each Add() call immediately applies the resource to the map (for visual
 * feedback) and stores the previous state for undo. On Undo(), restores
 * each cell's previous resource state.
 */
export class AddResourcesEditorAction implements IEditorAction {
  text: string

  private readonly resourceLayer: IResourceLayer
  private readonly resourceType: string
  private readonly cellResources: CellResource[] = []

  /**
   * Create a new AddResourcesEditorAction.
   *
   * @param resourceType — the resource type being painted
   * @param resourceLayer — the resource layer to modify
   */
  constructor(resourceType: string, resourceLayer: IResourceLayer) {
    this.resourceType = resourceType
    this.resourceLayer = resourceLayer
    this.text = `Added 0 resource cells of type: ${resourceType}`
  }

  /**
   * Execute the action. C# calls cellResources.TrimExcess() here;
   * no-op in TypeScript.
   */
  execute(): void {
    // NOTE: C# TrimExcess() is a no-op in TS
  }

  redo(): void {
    for (const resourceCell of this.cellResources) {
      this.resourceLayer.addResource(
        this.resourceType,
        resourceCell.cell,
        this.resourceLayer.getMaxDensity(this.resourceType),
      )
    }
  }

  /**
   * Undo all resource placements — restores each cell's previous resource state.
   *
   * For each cell:
   * - Same type as painted: clear then re-add at original density
   * - Different non-empty type: only re-add (restores old type)
   * - Was empty ('', density 0): clear only
   */
  undo(): void {
    for (const resourceCell of this.cellResources) {
      const oldType = resourceCell.oldResourceTile.type
      const oldDensity = resourceCell.oldResourceTile.density
      const isEmpty = oldType === '' || oldDensity === 0

      // Clear if old type matches paint type or cell was empty
      if (oldType === this.resourceType || isEmpty) {
        this.resourceLayer.clearResources(resourceCell.cell)
      }

      // Restore if old type matches or was a different non-empty type
      if (oldType === this.resourceType || !isEmpty) {
        this.resourceLayer.addResource(oldType, resourceCell.cell, oldDensity)
      }
    }
  }

  /**
   * Add a cell to the accumulated brush stroke.
   *
   * Immediately applies the resource to the map (for visual feedback during
   * drag) and stores the previous cell state for undo.
   *
   * @param resourceCell — the cell and its previous resource state
   */
  add(resourceCell: CellResource): void {
    this.resourceLayer.addResource(
      this.resourceType,
      resourceCell.cell,
      this.resourceLayer.getMaxDensity(this.resourceType),
    )
    this.cellResources.push(resourceCell)
    this.text = `Added ${this.cellResources.length} resource cell(s) of type: ${this.resourceType}`
  }
}
