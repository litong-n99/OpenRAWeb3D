/**
 * EditorDefaultBrush.ts — Primary editor selection and manipulation brush
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs (627 lines C#)
 *
 * 核心范式转换:
 * - C# event Action SelectionChanged / UpdateSelectedTab → TypeScript callback arrays
 * - C# explicit interface implementation (ITickRender.TickRender) → public method
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[]
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.1-DEFER-1)
 * - C# MinByOrDefault(CalculateActorSelectionPriority) → manual find with reduce
 * - C# int2 / float2 structs → TypeScript {x, y} objects
 * - C# WPos struct → TypeScript {x, y, z} objects (lowercase for common 3D convention)
 * - C# EditorBlit.CopyRegionContents → stubbed in DeleteAreaAction (TODO-21.B.3)
 * - C# world.WorldActor.Trait<T>() → constructor dependency injection
 *
 * EditorDefaultBrush is THE foundation brush. All other brushes follow its pattern.
 * It handles click-to-select, drag-to-select, drag-to-move actors, right-click
 * delete, and selection event management.
 *
 * Migration: TODO-21.B.2 — Chapter 21 Phase B
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import { MouseInputEvent, MouseButton, Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import type {
  IGameActor,
  IRenderable,
  WorldRendererStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../Editor/IEditorBrush.js'
import type { EditorActorLayer } from '../Traits/World/EditorActorLayer.js'
import type { EditorActorPreview } from '../Traits/World/EditorActorPreview.js'
import type { EditorActionManager } from '../Traits/World/EditorActionManager.js'
import type { IResourceLayer } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { EditorViewportControllerWidget } from '../Widgets/EditorViewportControllerWidget.js'
import { EditorSelection, MapBlitFilters, type ISelectionController } from './types.js'
import { ChangeSelectionAction } from './actions/ChangeSelectionAction.js'
import { DeleteAreaAction } from './actions/DeleteAreaAction.js'
import { MoveActorAction } from './actions/MoveActorAction.js'
import { RemoveActorAction } from './actions/RemoveActorAction.js'
import { RemoveResourceAction } from './actions/RemoveResourceAction.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum mouse movement in screen pixels (squared) before a drag is initiated.
 *
 * OpenRA 对照: const int MinMouseMoveBeforeDrag = 32
 *
 * The C# code compares (mi.Location - selectionStartLocation).LengthSquared
 * against this squared threshold.
 */
const MIN_MOUSE_MOVE_BEFORE_DRAG_SQ = 32 * 32 // = 1024

// ---------------------------------------------------------------------------
// Minimal WorldRenderer / World / Map interfaces needed by EditorDefaultBrush
// ---------------------------------------------------------------------------

/**
 * The subset of WorldRenderer APIs required by EditorDefaultBrush.
 *
 * This avoids depending on the full WorldRenderer during testing while
 * providing clear type documentation of exactly what the brush needs.
 *
 * OpenRA 对照: WorldRenderer class fields used by EditorDefaultBrush
 */
export interface IBrushWorldRenderer {
  readonly viewport: IBrushViewport
  screenPosition(pos: { readonly x: number; readonly y: number; readonly z: number }): { readonly x: number; readonly y: number }
  readonly world: IBrushWorld
}

/** Viewport subset needed for coordinate transforms.
 *
 * OpenRA 对照: Viewport.ViewToWorldPx, Viewport.ViewToWorld, Viewport.WorldToViewPx
 */
export interface IBrushViewport {
  viewToWorldPx(viewPos: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number; readonly z: number }
  viewToWorld(view: { readonly x: number; readonly y: number }): CPos
  worldToViewPx(worldPos: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
}

/**
 * World subset needed for map cell center calculation.
 *
 * OpenRA 对照: World.Map.CenterOfCell(CPos)
 */
export interface IBrushWorld {
  readonly map: IBrushMap
}

/**
 * Map subset for terrain tile access, height, and center calculations.
 *
 * OpenRA 对照: Map.Tiles, Map.Height, Map.Rules, Map.Grid, Map.CenterOfCell
 */
export interface IBrushMap {
  readonly tiles: {
    readonly contains: (pos: CPos) => boolean
    readonly get: (pos: CPos) => { readonly type: number; readonly index: number }
    readonly set: (pos: CPos, tile: { readonly type: number; readonly index: number }) => void
  }
  readonly height: {
    readonly get: (cell: CPos) => number
    readonly set: (cell: CPos, h: number) => void
  }
  readonly rules: {
    readonly terrainInfo: {
      readonly defaultTerrainTile: { readonly type: number; readonly index: number }
    }
  }
  readonly grid: { readonly type: unknown }
  centerOfCell(cell: CPos): { readonly x: number; readonly y: number; readonly z: number }
}

// ---------------------------------------------------------------------------
// EditorDefaultBrush
// ---------------------------------------------------------------------------

/**
 * The primary editor brush for selection and manipulation.
 *
 * OpenRA 对照: sealed class EditorDefaultBrush : IEditorBrush
 *
 * This brush handles:
 * - Click-to-select actors / drag-to-select cell regions
 * - Drag-to-move actors (Shift-click or click on already-selected actor)
 * - Right-click to delete actors or resources under cursor
 * - Selection-based delete via DeleteSelection()
 * - Clipboard source for EditorCopyPasteBrush
 *
 * Mouse state machine:
 *   IDLE → POTENTIAL_DRAG (left-down on empty, selectionStartLocation set)
 *        → DRAGGING_SELECTION (mouse moved > 32px, selectionBounds created)
 *        → selection committed on mouse up
 *   IDLE → DRAGGING_ACTOR (left-down on actor + Shift, moveAction created)
 *        → actor moved on mouse move
 *        → action committed (if HasMoved) on mouse up
 */
export class EditorDefaultBrush implements IEditorBrush, ISelectionController {
  // ---------------------------------------------------------------------------
  // Dependencies (对应 OpenRA readonly fields)
  // ---------------------------------------------------------------------------

  private readonly worldRenderer: IBrushWorldRenderer

  private readonly world: IBrushWorld

  readonly editorWidget: EditorViewportControllerWidget

  private readonly editorLayer: EditorActorLayer

  readonly editorActionManager: EditorActionManager

  private readonly resourceLayer: IResourceLayer | null

  private readonly actorLayer: EditorActorLayer

  // ---------------------------------------------------------------------------
  // Selection state (对应 OpenRA public properties)
  // ---------------------------------------------------------------------------

  /**
   * The current editor selection (area and/or actor).
   *
   * OpenRA 对照: EditorDefaultBrush.Selection { get; private set; }
   */
  get selection(): EditorSelection {
    return this._selection
  }

  private _selection: EditorSelection = new EditorSelection()

  /**
   * The current drag bounds, or the selection area if not dragging.
   *
   * OpenRA 对照: EditorDefaultBrush.CurrentDragBounds => selectionBounds ?? Selection.Area
   */
  get currentDragBounds(): CellCoordsRegion | null {
    return this._selectionBounds ?? this._selection.area
  }

  // ---------------------------------------------------------------------------
  // Previous selection for undo (对应 OpenRA EditorSelection previousSelection)
  // ---------------------------------------------------------------------------

  /** Saved previous selection for ChangeSelectionAction undo.
   *
   * OpenRA 对照: EditorSelection previousSelection
   */
  private _previousSelection: EditorSelection = new EditorSelection()

  // ---------------------------------------------------------------------------
  // Drag state (对应 OpenRA drag fields)
  // ---------------------------------------------------------------------------

  /** Current drag selection bounds (null when not dragging). */
  private _selectionBounds: CellCoordsRegion | null = null

  /** The screen pixel location where the most recent left-down occurred. */
  private _selectionStartLocation: { x: number; y: number } | null = null

  /** The cell at selectionStartLocation, captured on first drag movement. */
  private _selectionStartCell: CPos | null = null

  /** Current mouse position in world pixel coordinates (x, y only). */
  private _worldPixel: { x: number; y: number } = { x: 0, y: 0 }

  // ---------------------------------------------------------------------------
  // Actor drag state
  // ---------------------------------------------------------------------------

  /** Whether an actor drag-move is in progress. */
  private _draggingActor: boolean = false

  /** The move action being built during a drag. */
  private _moveAction: MoveActorAction | null = null

  /** Screen-pixel offset between the click point and the actor's origin cell. */
  private _dragPixelOffset: { x: number; y: number } = { x: 0, y: 0 }

  /** Cell offset between the actor's location and the cell under the cursor. */
  private _dragCellOffset: CPos = new CPos(0, 0)

  // ---------------------------------------------------------------------------
  // Event callbacks (对应 OpenRA event Action)
  // ---------------------------------------------------------------------------

  /** Callbacks invoked when the selection changes.
   *
   * OpenRA 对照: event Action SelectionChanged
   */
  private _selectionChangedCallbacks: Array<() => void> = []

  /** Callbacks invoked when the selected tab should update.
   *
   * OpenRA 对照: event Action UpdateSelectedTab
   */
  private _updateSelectedTabCallbacks: Array<() => void> = []

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA EditorDefaultBrush constructor)
  // ---------------------------------------------------------------------------

  /**
   * Create a new EditorDefaultBrush.
   *
   * OpenRA 对照: EditorDefaultBrush(EditorViewportControllerWidget, WorldRenderer)
   *
   * In C#, trait dependencies are resolved from the world actor via
   * TraitDictionary. In TypeScript, they are injected directly via
   * constructor parameters for testability.
   *
   * @param editorWidget — the editor viewport controller widget
   * @param wr — the world renderer (IBrushWorldRenderer)
   * @param editorLayer — the editor actor layer (from world actor trait)
   * @param editorActionManager — the editor action manager (from world actor trait)
   * @param resourceLayer — the resource layer, or null if no resources (from world actor trait)
   */
  constructor(
    editorWidget: EditorViewportControllerWidget,
    wr: IBrushWorldRenderer,
    editorLayer: EditorActorLayer,
    editorActionManager: EditorActionManager,
    resourceLayer?: IResourceLayer | null,
  ) {
    this.editorWidget = editorWidget
    this.worldRenderer = wr
    this.world = wr.world

    this.editorLayer = editorLayer
    this.actorLayer = editorLayer
    this.editorActionManager = editorActionManager
    this.resourceLayer = resourceLayer ?? null
  }

  // ---------------------------------------------------------------------------
  // CalculateActorSelectionPriority (对应 OpenRA CalculateActorSelectionPriority)
  // ---------------------------------------------------------------------------

  /**
   * Calculate a priority value for click-targeting an actor.
   *
   * OpenRA 对照: EditorDefaultBrush.CalculateActorSelectionPriority(EditorActorPreview)
   *
   * Actors are sorted by pixel distance from the cursor (lower is closer),
   * then by world Z position (higher renders on top). The combined priority
   * packs pixel distance in the upper 32 bits and Z in the lower 32 bits,
   * mimicking the C# `((long)pixelDistance << 32) + worldZPosition`.
   *
   * Since JavaScript numbers are IEEE 754 doubles, we use a scaled multiplication
   * instead of bit shifting:
   *   priority = pixelDistance * 2^32 + |zPosition|
   *
   * Lower priority = better candidate (closer pixel distance).
   *
   * @param actor — the actor to evaluate
   * @returns the combined priority value (lower is closer/better)
   */
  calculateActorSelectionPriority(actor: EditorActorPreview): number {
    const bounds = actor.bounds
    const centerPixel = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }
    const dx = centerPixel.x - this._worldPixel.x
    const dy = centerPixel.y - this._worldPixel.y
    const pixelDistance = Math.sqrt(dx * dx + dy * dy)

    // Convert to integer distance for packing (avoid float precision issues)
    const intDist = Math.trunc(pixelDistance)

    // If 2+ actors have the same pixel position, the highest-appearing wins
    // (higher Z = closer to camera in OpenRA view)
    const worldZPosition = actor.centerPosition.Z

    // Pack: (pixelDistance << 32) + worldZPosition
    return intDist * 4294967296 + Math.abs(worldZPosition)
  }

  // ---------------------------------------------------------------------------
  // SetSelection (对应 OpenRA SetSelection(EditorSelection))
  // ---------------------------------------------------------------------------

  /**
   * Change the editor selection.
   *
   * OpenRA 对照: EditorDefaultBrush.SetSelection(EditorSelection selection)
   *
   * If the new selection is the same instance as the current one, this is a
   * no-op. Otherwise, deselects the previous actor (if any), updates to the
   * new selection, selects the new actor (if any), and fires SelectionChanged.
   *
   * @param selection — the new selection state
   */
  setSelection(selection: EditorSelection): void {
    // C#: if (Selection == selection) return;
    if (this._selection === selection) return

    // Deselect previous actor
    if (this._selection.actor !== null) {
      this._selection.actor.selected = false
    }

    this._selection = selection

    // Select new actor
    if (this._selection.actor !== null) {
      this._selection.actor.selected = true
    }

    // Fire SelectionChanged
    this._fireSelectionChanged()
  }

  // ---------------------------------------------------------------------------
  // ClearSelection (对应 OpenRA ClearSelection(bool updateSelectedTab))
  // ---------------------------------------------------------------------------

  /**
   * Clear the current selection, with undo support.
   *
   * OpenRA 对照: EditorDefaultBrush.ClearSelection(bool updateSelectedTab = false)
   *
   * If there is a current selection, saves it as previousSelection, clears
   * the selection, creates a ChangeSelectionAction for undo, and optionally
   * fires UpdateSelectedTab.
   *
   * @param updateSelectedTab — if true, fire UpdateSelectedTab event
   */
  clearSelection(updateSelectedTab: boolean = false): void {
    if (this._selection.hasSelection) {
      this._previousSelection = this._selection
      this.setSelection(new EditorSelection())
      this.editorActionManager.Add(
        new ChangeSelectionAction(this, this._selection, this._previousSelection),
      )

      if (updateSelectedTab) {
        this._fireUpdateSelectedTab()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DeleteSelection (对应 OpenRA DeleteSelection(MapBlitFilters))
  // ---------------------------------------------------------------------------

  /**
   * Delete the contents of the current selection area.
   *
   * OpenRA 对照: EditorDefaultBrush.DeleteSelection(MapBlitFilters filters)
   *
   * Creates a DeleteAreaAction that covers the current selection area,
   * respecting the given filters (terrain, resources, actors).
   * Does nothing if there is no area selection.
   *
   * @param filters — which categories to delete (MapBlitFilters flags)
   */
  deleteSelection(filters: MapBlitFilters): void {
    if (this._selection.area !== null) {
      this.editorActionManager.Add(
        new DeleteAreaAction(
          this.world.map,
          filters,
          this._selection.area,
          this.resourceLayer,
          this.actorLayer,
        ),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // HandleMouseInput (对应 OpenRA HandleMouseInput(MouseInput mi))
  // ---------------------------------------------------------------------------

  /**
   * Handle mouse input events from the editor viewport.
   *
   * OpenRA 对照: EditorDefaultBrush.HandleMouseInput(MouseInput mi)
   *
   * Implements a state machine for selection, drag-selection, actor drag-move,
   * right-click delete, and tooltip display.
   *
   * @param mi — the mouse input event (unknown for IEditorBrush, cast to MouseInput)
   * @returns true if the event was consumed by this brush
   */
  handleMouseInput(mi: unknown): boolean {
    const mouse = mi as MouseInput | null
    if (!mouse) return false

    // Exclusively uses mouse wheel and both mouse buttons, but nothing else.
    // Mouse move events are important for tooltips, so we always allow these through.
    if (
      mouse.button !== MouseButton.Left &&
      mouse.button !== MouseButton.Right &&
      mouse.event !== MouseInputEvent.Move &&
      mouse.event !== MouseInputEvent.Scroll
    ) {
      return false
    }

    // Update world pixel position (used for tooltip hit testing)
    const worldPx = this.worldRenderer.viewport.viewToWorldPx(mouse.location)
    this._worldPixel = { x: worldPx.x, y: worldPx.y }

    // Convert screen pixel to cell coordinate
    const cell = this.worldRenderer.viewport.viewToWorld(mouse.location)

    // Find actor under cursor (lowest priority = closest)
    const underCursor = this.findActorUnderCursor()

    // Check resource under cursor
    const resourceUnderCursor = this.resourceLayer?.getResource(cell).type

    // Update tooltip
    if (underCursor !== null) {
      this.editorWidget.setTooltip(underCursor.tooltip)
    } else if (resourceUnderCursor) {
      this.editorWidget.setTooltip(resourceUnderCursor)
    } else {
      this.editorWidget.setTooltip(null)
    }

    // ---- Actor drag handling ----
    if (mouse.button === MouseButton.Left) {
      if (
        mouse.event === MouseInputEvent.Down &&
        underCursor !== null &&
        ((mouse.modifiers & Modifiers.Shift) !== 0 || underCursor === this._selection.actor)
      ) {
        // Begin actor drag
        const centerWPos = this.world.map.centerOfCell(cell)
        const cellViewPx = this.worldRenderer.viewport.worldToViewPx(
          this.worldRenderer.screenPosition(centerWPos),
        )
        this._dragPixelOffset = {
          x: cellViewPx.x - mouse.location.x,
          y: cellViewPx.y - mouse.location.y,
        }
        this._dragCellOffset = new CPos(
          underCursor.location.X - cell.X,
          underCursor.location.Y - cell.Y,
        )
        this._moveAction = new MoveActorAction(underCursor, this.actorLayer)
        this._draggingActor = true
        return false
      } else if (mouse.event === MouseInputEvent.Up && this._draggingActor) {
        // End actor drag
        this.editorWidget.setTooltip(null)
        this._draggingActor = false
        if (this._moveAction && this._moveAction.hasMoved) {
          this.editorActionManager.Add(this._moveAction)
        }
        this._moveAction = null
        return false
      } else if (mouse.event === MouseInputEvent.Move && this._draggingActor) {
        // Continue actor drag
        this.editorWidget.setTooltip(null)
        const offsetLoc = {
          x: mouse.location.x + this._dragPixelOffset.x,
          y: mouse.location.y + this._dragPixelOffset.y,
        }
        const to = this.worldRenderer.viewport.viewToWorld(offsetLoc)
        const adjustedTo = new CPos(
          to.X + this._dragCellOffset.X,
          to.Y + this._dragCellOffset.Y,
        )
        this._moveAction?.move(adjustedTo)
        return false
      }
    }

    // ---- Selection box drag ----
    if (
      mouse.event === MouseInputEvent.Move &&
      this._selectionStartLocation !== null &&
      (this._selectionBounds !== null ||
        distSq(mouse.location, this._selectionStartLocation) > MIN_MOUSE_MOVE_BEFORE_DRAG_SQ)
    ) {
      // Lazy-init selectionStartCell on first drag movement
      if (this._selectionStartCell === null) {
        this._selectionStartCell =
          this.worldRenderer.viewport.viewToWorld(this._selectionStartLocation)
      }

      const sc = this._selectionStartCell!
      const topLeft = new CPos(
        Math.min(sc.X, cell.X),
        Math.min(sc.Y, cell.Y),
      )
      const bottomRight = new CPos(
        Math.max(sc.X, cell.X),
        Math.max(sc.Y, cell.Y),
      )

      this._selectionBounds = new CellCoordsRegion(topLeft, bottomRight)

      // NOTE: C# calls Ui.KeyboardFocusWidget = null to lose focus for
      // copy/paste keyboard shortcuts. In TypeScript/browser this is:
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }

    // Finished with mouse move events — let them bubble up the widget tree.
    // NOTE: Unlike OpenRA C# which returns true for scroll events, we return
    // false so the viewport controller can handle mouse wheel zoom. In the
    // web/3D context, scroll/zoom is managed by the viewport, not the brush.
    if (mouse.event === MouseInputEvent.Move || mouse.event === MouseInputEvent.Scroll) {
      return false
    }

    // ---- Left-down on empty space: start potential drag ----
    if (
      mouse.event === MouseInputEvent.Down &&
      mouse.button === MouseButton.Left &&
      this._selectionStartLocation === null
    ) {
      this._selectionStartLocation = {
        x: mouse.location.x,
        y: mouse.location.y,
      }
    }

    // ---- Mouse up ----
    if (mouse.event === MouseInputEvent.Up) {
      if (mouse.button === MouseButton.Left) {
        this.editorWidget.setTooltip(null)
        this._selectionStartLocation = null
        this._selectionStartCell = null

        // If we've released a bounds drag
        if (this._selectionBounds !== null) {
          // Set this as the editor selection
          this._previousSelection = this._selection
          const newSel = new EditorSelection()
          newSel.area = this._selectionBounds
          this.setSelection(newSel)

          this._selectionBounds = null
          this.editorActionManager.Add(
            new ChangeSelectionAction(this, this._selection, this._previousSelection),
          )
          this._fireUpdateSelectedTab()
        } else if (underCursor !== null) {
          // We've clicked on an actor
          if (this._selection.actor !== underCursor) {
            this._previousSelection = this._selection
            const newSel = new EditorSelection()
            newSel.actor = underCursor
            this.setSelection(newSel)

            this.editorActionManager.Add(
              new ChangeSelectionAction(this, this._selection, this._previousSelection),
            )
            this._fireUpdateSelectedTab()
          }
        } else if (this._selection.hasSelection) {
          // Released left mouse without dragging or selecting an actor — deselect
          this.clearSelection(true)
        }
      } else if (mouse.button === MouseButton.Right) {
        this.editorWidget.setTooltip(null)

        // Delete actor under cursor (but not the currently-selected actor itself)
        if (
          underCursor !== null &&
          underCursor !== this._selection.actor &&
          !this._draggingActor
        ) {
          this.editorActionManager.Add(
            new RemoveActorAction(this.editorLayer, underCursor),
          )
        }

        // Delete resource under cursor
        if (resourceUnderCursor) {
          this.editorActionManager.Add(
            new RemoveResourceAction(this.resourceLayer!, cell, resourceUnderCursor),
          )
        }
      }
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // ITickRender.TickRender (对应 OpenRA IEditorBrush.TickRender)
  // ---------------------------------------------------------------------------

  /**
   * Per-frame render update. No-op for EditorDefaultBrush.
   *
   * OpenRA 对照: void IEditorBrush.TickRender(WorldRenderer wr, Actor self) { }
   */
  tickRender(_wr: WorldRendererStub, _self: IGameActor): void {
    // EditorDefaultBrush has no per-frame render updates
  }

  // ---------------------------------------------------------------------------
  // RenderAboveShroud (对应 OpenRA IEditorBrush.RenderAboveShroud)
  // ---------------------------------------------------------------------------

  /**
   * Render above the shroud layer. No-op for EditorDefaultBrush.
   *
   * OpenRA 对照: IEnumerable<IRenderable> IEditorBrush.RenderAboveShroud(...) { yield break; }
   */
  renderAboveShroud(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return []
  }

  // ---------------------------------------------------------------------------
  // RenderAnnotations (对应 OpenRA IEditorBrush.RenderAnnotations)
  // ---------------------------------------------------------------------------

  /**
   * Render annotation overlays (selection box, drag bounds).
   *
   * OpenRA 对照: IEnumerable<IRenderable> IEditorBrush.RenderAnnotations(...)
   *
   * When a drag selection is in progress, renders two selection annotation
   * rectangles: one with the alt color (offset) and one with the main color.
   *
   * NOTE: EditorSelectionAnnotationRenderable requires a WebGL context.
   * For now, return empty array. TODO-21.B.2-DEFER-1: Integrate
   * EditorSelectionAnnotationRenderable when the 3D rendering pipeline
   * for editor overlays is complete.
   */
  renderAnnotations(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    const bounds = this.currentDragBounds
    if (!bounds) return []

    // TODO-21.B.2-DEFER-1: Create EditorSelectionAnnotationRenderable instances
    // that render in the Babylon.js scene. The C# code creates:
    //   yield return new EditorSelectionAnnotationRenderable(bounds, altColor, altOffset, CVec.Zero)
    //   yield return new EditorSelectionAnnotationRenderable(bounds, mainColor, int2.Zero, CVec.Zero)
    //
    // In Babylon.js, this would create LinesMesh instances at the region's
    // world-space corners. Deferred until the annotation renderable is adapted
    // for 3D rendering.
    return []
  }

  // ---------------------------------------------------------------------------
  // Tick (对应 OpenRA IEditorBrush.Tick)
  // ---------------------------------------------------------------------------

  /**
   * Per-tick logic update. No-op for EditorDefaultBrush.
   *
   * OpenRA 对照: public void Tick() { }
   */
  tick(): void {
    // EditorDefaultBrush has no per-tick logic
  }

  // ---------------------------------------------------------------------------
  // Dispose (对应 OpenRA IEditorBrush.Dispose)
  // ---------------------------------------------------------------------------

  /**
   * Clean up resources.
   *
   * OpenRA 对照: public void Dispose() { }
   *
   * EditorDefaultBrush has no GPU resources directly, but clears callbacks
   * and drag state to prevent memory leaks.
   */
  dispose(): void {
    // Clear event callbacks
    this._selectionChangedCallbacks = []
    this._updateSelectedTabCallbacks = []

    // Clear drag state
    this._selectionBounds = null
    this._selectionStartLocation = null
    this._selectionStartCell = null
    this._draggingActor = false
    this._moveAction = null

    // Clear selection
    if (this._selection.actor !== null) {
      this._selection.actor.selected = false
    }
    this._selection = new EditorSelection()
  }

  // ---------------------------------------------------------------------------
  // Event subscription (对应 OpenRA event += / -=)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to the SelectionChanged event.
   *
   * OpenRA 对照: SelectionChanged += callback
   */
  onSelectionChanged(callback: () => void): void {
    this._selectionChangedCallbacks.push(callback)
  }

  /**
   * Unsubscribe from the SelectionChanged event.
   *
   * OpenRA 对照: SelectionChanged -= callback
   */
  offSelectionChanged(callback: () => void): void {
    const idx = this._selectionChangedCallbacks.indexOf(callback)
    if (idx !== -1) this._selectionChangedCallbacks.splice(idx, 1)
  }

  /**
   * Subscribe to the UpdateSelectedTab event.
   *
   * OpenRA 对照: UpdateSelectedTab += callback
   */
  onUpdateSelectedTab(callback: () => void): void {
    this._updateSelectedTabCallbacks.push(callback)
  }

  /**
   * Unsubscribe from the UpdateSelectedTab event.
   *
   * OpenRA 对照: UpdateSelectedTab -= callback
   */
  offUpdateSelectedTab(callback: () => void): void {
    const idx = this._updateSelectedTabCallbacks.indexOf(callback)
    if (idx !== -1) this._updateSelectedTabCallbacks.splice(idx, 1)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Find the closest actor under the current world pixel, using the
   * CalculateActorSelectionPriority ordering (lower priority = closer).
   *
   * @returns the closest actor, or null if none found
   */
  private findActorUnderCursor(): EditorActorPreview | null {
    const previews = this.editorLayer.previewsAtWorldPixel(this._worldPixel)
    if (previews.length === 0) return null

    // Find the actor with the lowest priority (closest/front-most)
    let best: EditorActorPreview | null = null
    let bestPriority = Number.MAX_SAFE_INTEGER
    for (const p of previews) {
      const priority = this.calculateActorSelectionPriority(p)
      if (priority < bestPriority) {
        bestPriority = priority
        best = p
      }
    }
    return best
  }

  /**
   * Fire all SelectionChanged callbacks.
   */
  private _fireSelectionChanged(): void {
    for (const cb of this._selectionChangedCallbacks) {
      cb()
    }
  }

  /**
   * Fire all UpdateSelectedTab callbacks.
   */
  private _fireUpdateSelectedTab(): void {
    for (const cb of this._updateSelectedTabCallbacks) {
      cb()
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helper: squared Euclidean distance between two 2D points
// ---------------------------------------------------------------------------

/** Calculate squared Euclidean distance between two 2D points.
 *
 * OpenRA 对照: (location - selectionStartLocation).LengthSquared
 *
 * @param a — first point
 * @param b — second point
 * @returns squared distance
 */
function distSq(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}
