/**
 * PaintMarkerTileEditorAction.ts — Undoable marker tile painting on the marker overlay
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.cs
 *   sealed class PaintMarkerTileEditorAction : IEditorAction (lines 143-189)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 * - C# ImmutableArray<PaintMarkerTile> → readonly PaintMarkerTile[]
 *
 * Migration: TODO-21.B.8 — Chapter 21 Phase B Wave 3
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { PaintMarkerTile } from '../types.js'
import type { IMarkerLayer } from '../MarkerStubs.js'

/**
 * Undoable action for painting marker tiles on the marker overlay.
 *
 * OpenRA 对照: PaintMarkerTileEditorAction
 */
export class PaintMarkerTileEditorAction implements IEditorAction {
  text: string

  private readonly type: number | null
  private readonly paintTiles: readonly PaintMarkerTile[]
  private readonly markerLayerOverlay: IMarkerLayer

  constructor(
    type: number | null,
    paintTiles: readonly PaintMarkerTile[],
    markerLayerOverlay: IMarkerLayer,
  ) {
    this.type = type
    this.paintTiles = paintTiles
    this.markerLayerOverlay = markerLayerOverlay

    // TODO-21.B.2-DEFER-7: FluentProvider for localized + type-labeled strings
    if (type !== null) {
      this.text = `Added ${paintTiles.length} marker tile(s), type ${type}`
    } else {
      this.text = `Removed ${paintTiles.length} marker tile(s)`
    }
  }

  execute(): void {
    // No-op: the preview already applied the changes
  }

  redo(): void {
    for (const paintTile of this.paintTiles) {
      this.markerLayerOverlay.setTile(paintTile.cell, this.type)
    }
  }

  undo(): void {
    for (const paintTile of this.paintTiles) {
      this.markerLayerOverlay.setTile(paintTile.cell, paintTile.previous)
    }
  }
}
