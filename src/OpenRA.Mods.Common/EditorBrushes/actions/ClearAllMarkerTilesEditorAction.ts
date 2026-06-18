/**
 * ClearAllMarkerTilesEditorAction.ts — Undoable clear of all markers of all types
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.cs
 *   sealed class ClearAllMarkerTilesEditorAction : IEditorAction (lines 230-264)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 * - C# FrozenDictionary<int, ImmutableArray<CPos>> → ReadonlyMap<number, readonly CPos[]>
 *
 * Migration: TODO-21.B.8 — Chapter 21 Phase B Wave 3
 */

import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { IMarkerLayer } from '../MarkerStubs.js'

/**
 * Undoable action for clearing all markers of all types.
 *
 * OpenRA 对照: ClearAllMarkerTilesEditorAction
 */
export class ClearAllMarkerTilesEditorAction implements IEditorAction {
  text: string

  private readonly markerLayerOverlay: IMarkerLayer
  private readonly tiles: ReadonlyMap<number, readonly CPos[]>

  constructor(markerLayerOverlay: IMarkerLayer) {
    this.markerLayerOverlay = markerLayerOverlay

    // Deep-copy the tiles dictionary for undo
    const snapshot = new Map<number, readonly CPos[]>()
    for (const [tile, cells] of markerLayerOverlay.tiles) {
      snapshot.set(tile, [...cells])
    }
    this.tiles = snapshot

    let allTilesCount = 0
    for (const cells of snapshot.values()) {
      allTilesCount += cells.length
    }

    // TODO-21.B.2-DEFER-7: FluentProvider for localized strings
    this.text = `Cleared all marker tile(s) (${allTilesCount} total)`
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.markerLayerOverlay.clearAll()
  }

  undo(): void {
    this.markerLayerOverlay.setAll(this.tiles)
  }
}
