/**
 * EditorCopyPasteBrush.ts — Paste clipboard contents (actors + terrain + resources) at cursor position
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.cs (174 lines C#)
 *
 * 核心范式转换:
 * - C# Func<MapBlitFilters> getCopyFilters → TypeScript callback () => MapBlitFilters
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[]
 * - C# explicit interface implementation → public methods on a class implementing IEditorBrush
 * - C# EditorBlit.PreviewBlitSource → stubbed (TODO-21.B.6-DEFER-1/2/3)
 * - C# EditorSelectionAnnotationRenderable → stubbed annotation objects
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 * - C# Viewport.LastMousePos → editorWidget viewport access
 *
 * The brush wraps an EditorBlitSource (clipboard) and places it at the cursor position.
 * Left-click commits a paste via EditorBlit; right-click cancels.
 * Preview shows clipboard contents at the target position.
 *
 * Migration: TODO-21.B.7 — Chapter 21 Phase B Wave 3
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
import type { EditorActorLayer } from '../Traits/World/EditorActorLayer.js'
import type { IResourceLayer } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { EditorBlit, type MapBlitData, type EditorActorLayerBlitInterface } from './EditorBlit.js'
import type { EditorBlitSource } from './types.js'
import { MapBlitFilters } from './types.js'

// ---------------------------------------------------------------------------
// Minimal editor widget interface needed by brush
// ---------------------------------------------------------------------------

/** The subset of EditorViewportControllerWidget needed by EditorCopyPasteBrush. */
export interface ICopyPasteBrushWidget {
  clearBrush(): void
  readonly selectionAltColor: Readonly<{ r: number; g: number; b: number; a: number }>
  readonly selectionAltOffset: number
  readonly pasteColor: Readonly<{ r: number; g: number; b: number; a: number }>
}

/** Viewport subset for coordinate transforms. */
export interface ICopyPasteBrushViewport {
  viewToWorld(viewPos: { readonly x: number; readonly y: number }): CPos
  lastMousePos: { readonly x: number; readonly y: number }
}

/** World renderer subset needed by the brush. */
export interface ICopyPasteBrushWorldRenderer {
  readonly viewport: ICopyPasteBrushViewport
}

// ---------------------------------------------------------------------------
// EditorCopyPasteBrush
// OpenRA 对照: public sealed class EditorCopyPasteBrush : IEditorBrush
// ---------------------------------------------------------------------------

/**
 * Editor brush for pasting copied clipboard contents at the cursor position.
 *
 * OpenRA 对照: EditorCopyPasteBrush
 *
 * Shows a preview of the clipboard at the cursor position. Left-click commits
 * via EditorBlit; right-click cancels. Uses getCopyFilters callback to read
 * current filter UI state at paste time.
 */
export class EditorCopyPasteBrush implements IEditorBrush {
  private readonly worldRenderer: ICopyPasteBrushWorldRenderer
  private readonly editorWidget: ICopyPasteBrushWidget
  private readonly editorActionManager: EditorActionManager
  private readonly editorActorLayer: EditorActorLayer & EditorActorLayerBlitInterface
  private readonly clipboard: EditorBlitSource
  private readonly resourceLayer: IResourceLayer
  private readonly getCopyFilters: () => MapBlitFilters
  private readonly mapData: MapBlitData

  /** Current paste preview position (updated each tick from cursor). */
  pastePreviewPosition: CPos

  // -------------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: EditorCopyPasteBrush(editorWidget, wr, clipboard, resourceLayer, getCopyFilters)
  // -------------------------------------------------------------------------

  /**
   * Create a copy-paste brush.
   *
   * @param editorWidget — the editor viewport controller widget
   * @param wr — the world renderer
   * @param clipboard — the copied blit source (from EditorDefaultBrush selection)
   * @param resourceLayer — the resource layer for resource operations
   * @param getCopyFilters — callback returning current filter UI state
   * @param editorActionManager — the action manager for undo/redo
   * @param editorActorLayer — the editor actor layer
   * @param mapData — the map data for terrain/height/resource access
   */
  constructor(
    editorWidget: ICopyPasteBrushWidget,
    wr: ICopyPasteBrushWorldRenderer,
    clipboard: EditorBlitSource,
    resourceLayer: IResourceLayer,
    getCopyFilters: () => MapBlitFilters,
    editorActionManager: EditorActionManager,
    editorActorLayer: EditorActorLayer & EditorActorLayerBlitInterface,
    mapData: MapBlitData,
  ) {
    this.editorWidget = editorWidget
    this.worldRenderer = wr
    this.clipboard = clipboard
    this.resourceLayer = resourceLayer
    this.getCopyFilters = getCopyFilters
    this.editorActionManager = editorActionManager
    this.editorActorLayer = editorActorLayer
    this.mapData = mapData

    this.pastePreviewPosition = wr.viewport.viewToWorld(
      wr.viewport.lastMousePos,
    )
  }

  // -------------------------------------------------------------------------
  // Region — clipboard bounds
  // OpenRA 对照: EditorCopyPasteBrush.Region => clipboard.CellCoords
  // -------------------------------------------------------------------------

  /** The clipboard region bounds.
   *
   * OpenRA 对照: EditorCopyPasteBrush.Region => clipboard.CellCoords
   */
  get region() {
    return this.clipboard.cellCoords
  }

  // -------------------------------------------------------------------------
  // HandleMouseInput
  // OpenRA 对照: EditorCopyPasteBrush.HandleMouseInput(MouseInput mi)
  // -------------------------------------------------------------------------

  handleMouseInput(mi: unknown): boolean {
    const m = mi as MouseInput

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

    if (m.button === MouseButton.Left && m.event === MouseInputEvent.Down) {
      const pastePosition = this.worldRenderer.viewport.viewToWorld(
        this.worldRenderer.viewport.lastMousePos,
      )
      const editorBlit = new EditorBlit(
        this.getCopyFilters(),
        this.resourceLayer,
        pastePosition,
        this.mapData,
        this.clipboard,
        this.editorActorLayer,
        true,
      )
      const action = new CopyPasteEditorAction(editorBlit)
      this.editorActionManager.Add(action)
      return true
    }

    return false
  }

  // -------------------------------------------------------------------------
  // TickRender / RenderAboveShroud / RenderAnnotations / Tick / Dispose
  // -------------------------------------------------------------------------

  tickRender(): void {
    // No per-frame render update needed
  }

  renderAboveShroud(): readonly IRenderable[] {
    const filters = this.getCopyFilters()
    const stickToGround = (filters & MapBlitFilters.Terrain) === 0
    const offset = CPos.subtract(
      this.pastePreviewPosition,
      this.clipboard.cellCoords.TopLeft,
    )
    // TODO-21.B.6-DEFER-1/2/3: Full preview pipeline
    // EditorBlit.PreviewBlitSource is currently stubbed to return []
    return EditorBlit.previewBlitSource(
      this.clipboard,
      filters,
      offset,
      this.worldRenderer,
      stickToGround,
    ) as readonly IRenderable[]
  }

  renderAnnotations(): readonly IRenderable[] {
    const offset = CPos.subtract(
      this.pastePreviewPosition,
      this.clipboard.cellCoords.TopLeft,
    )

    // NOTE: EditorSelectionAnnotationRenderable is not yet migrated.
    // Return stubbed annotation objects with the cursor-offset region.
    // TODO-21.A.5-DEFER-3: Full annotation rendering pipeline
    return [
      {
        region: this.clipboard.cellCoords,
        color: this.editorWidget.selectionAltColor,
        offset: this.editorWidget.selectionAltOffset,
        posOffset: offset,
      } as unknown as IRenderable,
      {
        region: this.clipboard.cellCoords,
        color: this.editorWidget.pasteColor,
        offset: 0,
        posOffset: offset,
      } as unknown as IRenderable,
    ]
  }

  tick(): void {
    this.pastePreviewPosition = this.worldRenderer.viewport.viewToWorld(
      this.worldRenderer.viewport.lastMousePos,
    )
  }

  dispose(): void {
    // No GPU resources to dispose
  }
}

// ---------------------------------------------------------------------------
// CopyPasteEditorAction
// OpenRA 对照: sealed class CopyPasteEditorAction : IEditorAction (lines 129-173)
// ---------------------------------------------------------------------------

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
