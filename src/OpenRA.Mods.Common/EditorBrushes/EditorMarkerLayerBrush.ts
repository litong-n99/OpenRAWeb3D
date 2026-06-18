/**
 * EditorMarkerLayerBrush.ts — Paint marker overlay cells with symmetric mirror support
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.cs (265 lines C#)
 *
 * 核心范式转换:
 * - C# MarkerLayerOverlay trait → TypeScript IMarkerLayer stub interface
 * - C# IEnumerable<IRenderable> yield break → empty readonly IRenderable[] array
 * - C# FrozenDictionary / ImmutableArray → ReadonlyMap / readonly CPos[]
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 * - C# CalculateMirrorPositions → stub returning [cell] (mirror mode deferred)
 *
 * This brush paints marker tiles (spawn points, objectives, waypoints) on the
 * marker overlay layer. It supports:
 * - Mirror painting via CalculateMirrorPositions (stubbed for Phase B)
 * - Accumulation pattern (collect cells during drag, commit on mouse-up)
 * - Template-based colors (each marker index maps to a distinct color)
 * - Dispose cleanup (pending cells reverted on cancel)
 *
 * Migration: TODO-21.B.8 — Chapter 21 Phase B Wave 3
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  MouseInputEvent,
  MouseButton,
} from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../Editor/IEditorBrush.js'
import type { IEditorAction } from '../Traits/World/EditorActionManager.js'
import type { EditorActionManager } from '../Traits/World/EditorActionManager.js'
import type { IMarkerLayer } from './MarkerStubs.js'

// ---------------------------------------------------------------------------
// PaintMarkerTile data (defined in types.ts)
// ---------------------------------------------------------------------------

import type { PaintMarkerTile } from './types.js'

// ---------------------------------------------------------------------------
// Minimal editor widget interface needed by brush
// ---------------------------------------------------------------------------

/** Viewport subset for coordinate transforms. */
export interface IMarkerBrushViewport {
  viewToWorld(viewPos: { readonly x: number; readonly y: number }): CPos
  lastMousePos: { readonly x: number; readonly y: number }
}

/** World renderer subset needed by marker brush. */
export interface IMarkerBrushWorldRenderer {
  readonly viewport: IMarkerBrushViewport
}

/** Editor widget methods needed by marker brush. */
export interface IMarkerBrushWidget {
  clearBrush(): void
}

// ---------------------------------------------------------------------------
// EditorMarkerLayerBrush
// OpenRA 对照: public sealed class EditorMarkerLayerBrush : IEditorBrush
// ---------------------------------------------------------------------------

/**
 * Editor brush for painting markers on the marker overlay layer.
 *
 * OpenRA 对照: EditorMarkerLayerBrush
 *
 * Accumulates marker cells during a left-drag and commits them as a single
 * PaintMarkerTileEditorAction on mouse-up. Supports mirror painting via
 * IMarkerLayer.calculateMirrorPositions().
 */
export class EditorMarkerLayerBrush implements IEditorBrush {
  /** Marker template ID (null = erase). */
  template: number | null

  private readonly worldRenderer: IMarkerBrushWorldRenderer
  private readonly editorActionManager: EditorActionManager
  private readonly markerLayerOverlay: IMarkerLayer
  private readonly editorWidget: IMarkerBrushWidget

  /** Accumulated paint tiles during current drag. */
  private readonly paintTiles: PaintMarkerTile[] = []
  /** Whether a drag operation is in progress. */
  private painting = false
  /** Last cursor cell for change detection. */
  private cell: CPos

  // -------------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: EditorMarkerLayerBrush(editorWidget, int? id, wr)
  // -------------------------------------------------------------------------

  /**
   * Create a marker layer brush.
   *
   * @param editorWidget — the editor viewport controller widget
   * @param templateId — the marker template ID to paint (null = erase)
   * @param wr — the world renderer
   * @param editorActionManager — the action manager for undo/redo
   * @param markerLayerOverlay — the marker layer for reading/writing markers
   */
  constructor(
    editorWidget: IMarkerBrushWidget,
    templateId: number | null,
    wr: IMarkerBrushWorldRenderer,
    editorActionManager: EditorActionManager,
    markerLayerOverlay: IMarkerLayer,
  ) {
    this.editorWidget = editorWidget
    this.worldRenderer = wr
    this.editorActionManager = editorActionManager
    this.markerLayerOverlay = markerLayerOverlay
    this.template = templateId

    this.cell = wr.viewport.viewToWorld(wr.viewport.lastMousePos)
  }

  // -------------------------------------------------------------------------
  // HandleMouseInput
  // OpenRA 对照: EditorMarkerLayerBrush.HandleMouseInput(MouseInput mi)
  // -------------------------------------------------------------------------

  handleMouseInput(mi: unknown): boolean {
    const m = mi as MouseInput

    // Exclusively uses left and right mouse buttons
    if (m.button !== MouseButton.Left && m.button !== MouseButton.Right) {
      return false
    }

    if (m.button === MouseButton.Right) {
      if (m.event === MouseInputEvent.Up) {
        this.editorWidget.clearBrush()
        return true
      }
      return false
    }

    // Left button down/up/move
    if (m.button !== MouseButton.Left) return true

    if (m.event === MouseInputEvent.Up) {
      this.updatePreview()
      if (this.paintTiles.length !== 0) {
        this.editorActionManager.Add(
          new PaintMarkerTileEditorAction(
            this.template,
            [...this.paintTiles],
            this.markerLayerOverlay,
          ),
        )
        this.paintTiles.length = 0
        this.updatePreview(true)
      }
      this.painting = false
    } else {
      // Down or Move
      this.painting = true
      this.updatePreview()
    }

    return true
  }

  // -------------------------------------------------------------------------
  // UpdatePreview — accumulate/revert cells based on cursor position
  // OpenRA 对照: EditorMarkerLayerBrush.UpdatePreview(bool forceRefresh)
  // -------------------------------------------------------------------------

  /**
   * Update the painting preview based on the current cursor cell.
   *
   * OpenRA 对照: EditorMarkerLayerBrush.UpdatePreview(bool forceRefresh = false)
   *
   * During painting: adds marker cells at mirrored positions.
   * When not painting: reverts pending cells and clears the list.
   * Skips cells that already have the target marker value.
   *
   * @param forceRefresh — if true, skip cell-change check and force update
   */
  updatePreview(forceRefresh = false): void {
    const currentCell = this.worldRenderer.viewport.viewToWorld(
      this.worldRenderer.viewport.lastMousePos,
    )

    if (!forceRefresh && CPos.equals(this.cell, currentCell)) {
      return
    }

    this.cell = currentCell

    if (!this.painting) {
      // Revert any pending paint tiles
      for (const paintTile of this.paintTiles) {
        this.markerLayerOverlay.setTile(paintTile.cell, paintTile.previous)
      }
      this.paintTiles.length = 0
      return
    }

    // Accumulate mirror positions
    for (const cell of this.markerLayerOverlay.calculateMirrorPositions(this.cell)) {
      // Skip if already in paintTiles
      if (this.paintTiles.some((t) => t.cell.Bits === cell.Bits)) {
        continue
      }

      // Skip if the cell already has the template value
      const existing = this.markerLayerOverlay.getTile(cell)
      if (existing === this.template) {
        continue
      }

      this.paintTiles.push({ cell, previous: existing })
      this.markerLayerOverlay.setTile(cell, this.template)
    }
  }

  // -------------------------------------------------------------------------
  // TickRender / RenderAboveShroud / RenderAnnotations / Tick / Dispose
  // -------------------------------------------------------------------------

  tickRender(): void {
    this.updatePreview()
  }

  renderAboveShroud(): readonly IRenderable[] {
    return []
  }

  renderAnnotations(): readonly IRenderable[] {
    return []
  }

  tick(): void {
    // No per-frame logic needed
  }

  /**
   * Clean up by reverting any uncommitted paint cells.
   *
   * OpenRA 对照: EditorMarkerLayerBrush.Dispose()
   */
  dispose(): void {
    for (const paintTile of this.paintTiles) {
      this.markerLayerOverlay.setTile(paintTile.cell, paintTile.previous)
    }
  }
}

// ---------------------------------------------------------------------------
// PaintMarkerTileEditorAction
// OpenRA 对照: sealed class PaintMarkerTileEditorAction : IEditorAction (lines 143-189)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ClearSelectedMarkerTilesEditorAction
// OpenRA 对照: sealed class ClearSelectedMarkerTilesEditorAction : IEditorAction (lines 191-228)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ClearAllMarkerTilesEditorAction
// OpenRA 对照: sealed class ClearAllMarkerTilesEditorAction : IEditorAction (lines 230-264)
// ---------------------------------------------------------------------------

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
