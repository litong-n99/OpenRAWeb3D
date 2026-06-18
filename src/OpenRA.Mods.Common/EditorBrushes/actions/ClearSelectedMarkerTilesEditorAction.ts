/**
 * ClearSelectedMarkerTilesEditorAction.ts — Undoable clear of all markers of a specific type
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.cs
 *   sealed class ClearSelectedMarkerTilesEditorAction : IEditorAction (lines 191-228)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 * - C# ImmutableArray<CPos> → readonly CPos[]
 *
 * Migration: TODO-21.B.8 — Chapter 21 Phase B Wave 3
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { IMarkerLayer } from '../MarkerStubs.js'

/**
 * Undoable action for clearing all markers of a specific type.
 *
 * OpenRA 对照: ClearSelectedMarkerTilesEditorAction
 */
export class ClearSelectedMarkerTilesEditorAction implements IEditorAction {
  text: string

  private readonly markerLayerOverlay: IMarkerLayer
  private readonly tile: number
  private readonly tiles: readonly CPos[]

  constructor(tile: number, markerLayerOverlay: IMarkerLayer) {
    this.tile = tile
    this.markerLayerOverlay = markerLayerOverlay
    this.tiles = [...(markerLayerOverlay.tiles.get(tile) ?? [])]

    // TODO-21.B.2-DEFER-7: FluentProvider for localized strings
    this.text = `Cleared ${this.tiles.length} marker tile(s), type ${tile}`
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.markerLayerOverlay.clearSelected(this.tile)
  }

  undo(): void {
    this.markerLayerOverlay.setSelected(this.tile, this.tiles)
  }
}
