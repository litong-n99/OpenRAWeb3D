/**
 * EditorResourceBrush.ts — Resource painting brush for the map editor
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.cs (161 lines C#)
 *
 * 核心范式转换:
 * - C# IResourceLayer + IResourceRenderer traits → stubbed interfaces
 *   (TODO-21.B.2-DEFER-2: IResourceRenderer not migrated)
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[]
 * - C# FluentProvider.GetMessage → template literals (TODO-21.B.2-DEFER-7)
 * - C# action trimExcess() → no-op (TS arrays don't need explicit trimming)
 * - C# explicit interface implementation (IEditorBrush.TickRender) → public method
 * - C# world.WorldActor.Trait<T>() → constructor dependency injection
 *
 * EditorResourceBrush paints resources (tiberium, ore, gems) onto the map.
 * Unlike the tile brush, resources are accumulated across a drag and committed
 * as a single action on mouse up.
 *
 * Key behaviors:
 * - Accumulation pattern: each drag movement adds a CellResource to pending action
 * - Max density: resources always placed at maximum density
 * - Preview suppression: while painting, preview is hidden (returns null)
 * - Undo semantics: restores old resource type or clears if matching
 *
 * Migration: TODO-21.B.5 — Chapter 21 Phase B Wave 2
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { MouseInputEvent, MouseButton } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import type {
  IGameActor,
  IRenderable,
  WorldRendererStub,
  IResourceLayer,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../Editor/IEditorBrush.js'
import type { EditorActionManager, IEditorAction } from '../Traits/World/EditorActionManager.js'
import type { EditorViewportControllerWidget } from '../Widgets/EditorViewportControllerWidget.js'
import type { CellResource } from './types.js'

// ---------------------------------------------------------------------------
// IResourceRenderer stub (对应 OpenRA IResourceRenderer)
// ---------------------------------------------------------------------------

/**
 * Stub: Resource renderer interface.
 *
 * OpenRA 对照: IResourceRenderer
 *
 * Used by EditorResourceBrush to generate preview renderables for a resource
 * type at a given world position.
 *
 * TODO-21.B.2-DEFER-2: Replace with full IResourceRenderer when migrated.
 */
interface IResourceRendererStub {
  readonly resourceTypes: Iterable<string>
  renderPreview(
    _wr: WorldRendererStub,
    _resourceType: string,
    _pos: WPos,
  ): readonly IRenderable[]
}

// ---------------------------------------------------------------------------
// EditorResourceBrush
// ---------------------------------------------------------------------------

/**
 * Brush for painting resources onto the editor map.
 *
 * OpenRA 对照: EditorResourceBrush : IEditorBrush
 *
 * Accumulates cells during drag and commits them as a single AddResourcesEditorAction
 * on mouse up. Preview is suppressed while actively painting.
 */
export class EditorResourceBrush implements IEditorBrush {
  /** The resource type being painted.
   *
   * OpenRA 对照: EditorResourceBrush.ResourceType (public readonly)
   */
  readonly resourceType: string

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** World renderer reference. */
  private readonly worldRenderer: WorldRendererStub

  /** Resource layer for querying and modifying resources. */
  private readonly resourceLayer: IResourceLayer

  /** Editor widget that owns this brush. */
  private readonly editorWidget: EditorViewportControllerWidget

  /** Action manager for undo/redo. */
  private readonly editorActionManager: EditorActionManager

  /** Pending action being built during drag. Null when not painting. */
  private action: AddResourcesEditorAction | null = null

  /** Whether a resource was added during the current stroke. */
  private resourceAdded: boolean = false

  /** Current cursor cell. */
  private cell: CPos

  /** Preview renderables at the cursor position. */
  private readonly preview: IRenderable[] = []

  /** Resource renderers for preview generation. */
  private readonly resourceRenderers: readonly IResourceRendererStub[]

  // -----------------------------------------------------------------------
  // Construction (OpenRA 对照: EditorResourceBrush constructor)
  // -----------------------------------------------------------------------

  /**
   * Create a new EditorResourceBrush.
   *
   * OpenRA 对照: EditorResourceBrush(EditorViewportControllerWidget, string, WorldRenderer)
   *
   * Resolves traits from the world actor. Generates initial preview at the
   * current cursor cell position.
   *
   * @param editorWidget — the editor viewport controller
   * @param resourceType — the resource type name to paint
   * @param wr — the world renderer
   */
  constructor(
    editorWidget: EditorViewportControllerWidget,
    resourceType: string,
    wr: WorldRendererStub,
  ) {
    this.editorWidget = editorWidget
    this.resourceType = resourceType
    this.worldRenderer = wr

    // Resolve traits from world actor
    // NOTE: WorldRendererStub doesn't expose .world directly; use unknown cast
    const wrUnknown = wr as unknown as {
      world: {
        map: { centerOfCell(cell: CPos): WPos }
        worldActor: Record<string, unknown>
      }
    }
    this.resourceLayer = wrUnknown.world.worldActor.resourceLayer as IResourceLayer
    this.editorActionManager = wrUnknown.world.worldActor.editorActionManager as EditorActionManager

    // Collect resource renderers
    const renderers = wrUnknown.world.worldActor.resourceRenderers as IResourceRendererStub[] | undefined
    this.resourceRenderers = renderers ?? []

    // Initial cell from last mouse position
    const viewport = (wr as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
      readonly lastMousePos: { readonly x: number; readonly y: number }
    }
    this.cell = viewport.viewToWorld(
      viewport.worldToViewPx(viewport.lastMousePos),
    )
    this.updatePreview()
  }

  // -----------------------------------------------------------------------
  // IEditorBrush.handleMouseInput
  // OpenRA 对照: EditorResourceBrush.HandleMouseInput(MouseInput mi)
  // -----------------------------------------------------------------------

  /**
   * Handle mouse input for resource painting.
   *
   * OpenRA 对照: IEditorBrush.HandleMouseInput(MouseInput mi)
   *
   * Left button down/drag: accumulate cells into the pending AddResourcesEditorAction.
   * Left button up: commit the pending action to EditorActionManager.
   * Right button up: clear the brush.
   *
   * Only cells where CanAddResource is true are affected.
   *
   * @param mi — the mouse input event
   * @returns true if the brush consumed the event
   */
  handleMouseInput(mi: unknown): boolean {
    const miTyped = mi as MouseInput

    // Exclusively uses left and right mouse buttons
    if (miTyped.button !== MouseButton.Left && miTyped.button !== MouseButton.Right) {
      return false
    }

    if (miTyped.button === MouseButton.Right) {
      if (miTyped.event === MouseInputEvent.Up) {
        this.editorWidget.clearBrush()
        return true
      }
      return false
    }

    const viewport = (this.worldRenderer as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
    }
    const cell = viewport.viewToWorld(miTyped.location)

    if (
      miTyped.button === MouseButton.Left &&
      miTyped.event !== MouseInputEvent.Up &&
      this.resourceLayer.canAddResource(this.resourceType, cell)
    ) {
      if (!this.action) {
        this.action = new AddResourcesEditorAction(
          this.resourceType,
          this.resourceLayer,
        )
      }
      this.action.add({
        cell,
        oldResourceTile: this.resourceLayer.getResource(cell),
      })
      this.resourceAdded = true
    } else if (
      this.resourceAdded &&
      miTyped.button === MouseButton.Left &&
      miTyped.event === MouseInputEvent.Up
    ) {
      if (this.action) {
        this.action.execute()
        this.editorActionManager.Add(this.action)
      }
      this.action = null
      this.resourceAdded = false
    }

    return true
  }

  // -----------------------------------------------------------------------
  // updatePreview (OpenRA 对照: EditorResourceBrush.UpdatePreview)
  // -----------------------------------------------------------------------

  /**
   * Regenerate the preview renderables for the current cursor cell.
   *
   * OpenRA 对照: EditorResourceBrush.UpdatePreview()
   *
   * Clears the preview list and refills it with all resource renderers'
   * RenderPreview outputs for the current resource type at the cell's
   * world position.
   */
  private updatePreview(): void {
    const wr = this.worldRenderer as unknown as {
      world: { map: { centerOfCell(cell: CPos): WPos } }
    }
    const pos = wr.world.map.centerOfCell(this.cell)

    this.preview.length = 0
    for (const renderer of this.resourceRenderers) {
      const items = renderer.renderPreview(this.worldRenderer, this.resourceType, pos)
      for (const item of items) {
        this.preview.push(item)
      }
    }
  }

  // -----------------------------------------------------------------------
  // IEditorBrush interface implementation
  // -----------------------------------------------------------------------

  /**
   * Per-tick render update — updates preview when the cursor cell changes.
   *
   * OpenRA 对照: IEditorBrush.TickRender(WorldRenderer wr, Actor self)
   */
  tickRender(wr: WorldRendererStub, _self: IGameActor): void {
    const viewport = (wr as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
      readonly lastMousePos: { readonly x: number; readonly y: number }
    }
    const currentCell = viewport.viewToWorld(
      viewport.worldToViewPx(viewport.lastMousePos),
    )
    if (this.cell.Bits !== currentCell.Bits) {
      this.cell = currentCell
      this.updatePreview()
    }
  }

  /**
   * Render resource previews above the shroud. Returns null (empty) while painting.
   *
   * OpenRA 对照: IEditorBrush.RenderAboveShroud(Actor self, WorldRenderer wr)
   *
   * C#: `return action == null ? preview : null`
   * While actively painting (action != null), the preview is hidden so the user
   * can see the placed resources without preview overlay interference.
   *
   * @returns the preview renderables, or empty if painting
   */
  renderAboveShroud(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return this.action === null ? this.preview : []
  }

  /**
   * Renders annotations — always returns empty for resource brush.
   *
   * OpenRA 对照: IEditorBrush.RenderAnnotations(Actor self, WorldRenderer wr)
   *
   * @returns empty array (yield break in C#)
   */
  renderAnnotations(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return []
  }

  /**
   * Per-tick logic update — no-op.
   *
   * OpenRA 对照: EditorResourceBrush.Tick()
   */
  tick(): void {
    // No-op
  }

  /**
   * Dispose of brush resources.
   *
   * OpenRA 对照: EditorResourceBrush.Dispose()
   */
  dispose(): void {
    this.preview.length = 0
    this.action = null
  }
}

// ---------------------------------------------------------------------------
// AddResourcesEditorAction
// OpenRA 对照: sealed class AddResourcesEditorAction : IEditorAction
// ---------------------------------------------------------------------------

/**
 * Accumulates resource placements during a brush stroke and applies them
 * all at once.
 *
 * OpenRA 对照: AddResourcesEditorAction (inner class in EditorResourceBrush.cs)
 *
 * Each Add() call immediately applies the resource to the map (for visual
 * feedback) and stores the previous state for undo. On Execute(), trims
 * excess capacity from the internal list (no-op in TS, matched to C# semantics).
 * On Undo(), restores each cell's previous resource state.
 */
export class AddResourcesEditorAction implements IEditorAction {
  /** Human-readable action description.
   *
   * OpenRA 对照: AddResourcesEditorAction.Text
   */
  text: string

  /** The resource layer being modified. */
  private readonly resourceLayer: IResourceLayer

  /** The resource type being painted. */
  private readonly resourceType: string

  /** Accumulated cell undo data. */
  private readonly cellResources: CellResource[] = []

  /**
   * Create a new AddResourcesEditorAction.
   *
   * OpenRA 对照: AddResourcesEditorAction(string, IResourceLayer)
   *
   * @param resourceType — the resource type being painted
   * @param resourceLayer — the resource layer to modify
   */
  constructor(resourceType: string, resourceLayer: IResourceLayer) {
    this.resourceType = resourceType
    this.resourceLayer = resourceLayer

    // NOTE: C# FluentProvider.GetMessage(AddedResource, "count", ..., "type", ...)
    this.text = `Added 0 resource cells of type: ${resourceType}`
  }

  /**
   * Execute the action (first-time application). Trims excess capacity
   * in C# (TrimExcess()), which is a no-op in TypeScript.
   *
   * OpenRA 对照: AddResourcesEditorAction.Execute()
   */
  execute(): void {
    // NOTE: C# calls cellResources.TrimExcess() here.
    // In TypeScript, arrays don't have TrimExcess — this is a no-op.
  }

  /**
   * Apply (or re-apply) all accumulated resource placements.
   *
   * OpenRA 对照: AddResourcesEditorAction.Do()
   *
   * Sets each cell's resource to the paint type at maximum density.
   */
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
   * OpenRA 对照: AddResourcesEditorAction.Undo()
   *
   * For each cell:
   * - If the old tile's type matches the paint type OR the old tile is empty:
   *   clear the cell (simulating a replace command)
   * - If the old tile has a different type: restore the old type and density
   *
   * NOTE: C# has both conditions true for matching types:
   *   if (resourceCell.OldResourceTile.Type == resourceType || resourceCell.OldResourceTile.Type == null)
   *     resourceLayer.ClearResources(resourceCell.Cell);
   *   if (resourceCell.OldResourceTile.Type == resourceType || resourceCell.OldResourceTile.Type != null)
   *     resourceLayer.AddResource(resourceCell.OldResourceTile.Type, resourceCell.Cell, resourceCell.OldResourceTile.Density);
   * The net effect: for matching/empty types, clear then re-add (which restores
   * for matching types and does nothing for empty). For different types, only
   * the second condition fires, restoring the old type.
   */
  undo(): void {
    for (const resourceCell of this.cellResources) {
      const oldType = resourceCell.oldResourceTile.type
      const oldDensity = resourceCell.oldResourceTile.density

      // In TS, empty type is '' (not null as in C#)
      const isEmpty = oldType === '' || oldDensity === 0

      // If old type matches current or cell was empty, clear it first
      if (oldType === this.resourceType || isEmpty) {
        this.resourceLayer.clearResources(resourceCell.cell)
      }

      // If old type matches current or was a different non-empty type, restore it
      if (oldType === this.resourceType || !isEmpty) {
        this.resourceLayer.addResource(oldType, resourceCell.cell, oldDensity)
      }
    }
  }

  /**
   * Add a cell to the accumulated brush stroke.
   *
   * OpenRA 对照: AddResourcesEditorAction.Add(CellResource)
   *
   * Immediately applies the resource to the map (for visual feedback during drag)
   * and stores the previous cell state for undo.
   *
   * @param resourceCell — the cell and its previous resource state
   */
  add(resourceCell: CellResource): void {
    // Immediately place the resource for visual feedback
    this.resourceLayer.addResource(
      this.resourceType,
      resourceCell.cell,
      this.resourceLayer.getMaxDensity(this.resourceType),
    )

    // Store undo data
    this.cellResources.push(resourceCell)

    // Update action text
    // NOTE: C# FluentProvider.GetMessage(AddedResource, "count", cellResources.Count, "type", resourceType)
    this.text = `Added ${this.cellResources.length} resource cell(s) of type: ${this.resourceType}`
  }
}
