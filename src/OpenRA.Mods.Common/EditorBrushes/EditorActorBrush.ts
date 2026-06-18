/**
 * EditorActorBrush.ts — Actor placement brush for the map editor
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.cs (180 lines C#)
 *
 * 核心范式转换:
 * - C# ActorInfo + TraitInfoOrDefault<T> → TypeScript ActorInfoStub with optional properties
 * - C# WVec.Zero / BuildingInfo.CenterOffset → number-based center offset (stub)
 * - C# ActorReference (Dictionary<Type, ActorInit>) → Map<string, unknown> (ActorReferenceMap)
 * - C# explicit interface implementation (IEditorBrush.TickRender) → public method
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[]
 * - C# FluentProvider.GetMessage → template literals (TODO-21.B.2-DEFER-7)
 * - C# Preview.Export() → shallow Map copy (already implemented in EditorActorPreview)
 * - C# Footprint.All(c => map.Tiles.Contains(c.Key)) → manual iterate with map.contains
 *
 * EditorActorBrush places actors onto the map. Maintains a preview EditorActorPreview
 * that follows the cursor. On left-click, creates an AddActorAction and commits
 * the actor to EditorActorLayer.
 *
 * Key behaviors:
 * - Center offset: buildings with center offset shift the preview position
 * - SubCell sharing: actors with SharesCell get a free SubCell assigned
 * - Owner resolution: validates or auto-selects owner from RequiresSpecificOwners
 * - Facing initialization: applies default facing from EditorActorLayer
 * - Footprint validation: prevents placement outside map bounds
 *
 * Migration: TODO-21.B.4 — Chapter 21 Phase B Wave 2
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { MouseInputEvent, MouseButton } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import type {
  IGameActor,
  IRenderable,
  WorldRendererStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../Editor/IEditorBrush.js'
import type { EditorActionManager } from '../Traits/World/EditorActionManager.js'
import type { EditorActorLayer } from '../Traits/World/EditorActorLayer.js'
import { EditorActorPreview } from '../Traits/World/EditorActorPreview.js'
import type { ActorReferenceMap } from '../Traits/World/EditorActorPreview.js'
import type { EditorViewportControllerWidget } from '../Widgets/EditorViewportControllerWidget.js'
import { SubCell } from '../../OpenRA.Game/Traits/SubCell.js'
import type { SubCell as SubCellEnum } from '../../OpenRA.Game/Traits/SubCell.js'
import { PlayerReference } from '../../OpenRA.Game/Map/PlayerReference.js'
import { AddActorAction } from './actions/AddActorAction.js'

// ---------------------------------------------------------------------------
// Stub types for actor info traits
// ---------------------------------------------------------------------------

/**
 * Stub: Actor info interface. Provides trait info lookup similar to
 * C# ActorInfo.TraitInfoOrDefault<T>().
 *
 * OpenRA 对照: ActorInfo class
 *
 * TODO-21.B.4-DEFER-1: Replace with full ActorInfo class when migrated.
 */
interface ActorInfoStub {
  readonly name: string
  traitInfoOrDefault<T>(name: string): T | undefined
  hasTraitInfo(name: string): boolean
}

/**
 * Stub: IOccupySpaceInfo — whether the actor occupies grid cells.
 *
 * OpenRA 对照: IOccupySpaceInfo
 */
interface IOccupySpaceInfoStub {
  readonly sharesCell: boolean
}

/**
 * Stub: BuildingInfo — building-specific info including center offset.
 *
 * OpenRA 对照: BuildingInfo : IOccupySpaceInfo
 */
interface BuildingInfoStub {
  readonly sharesCell: boolean
  /** Center offset of the building in world units. */
  centerOffset?: number
}

/**
 * Stub: RequiresSpecificOwnersInfo — enforces valid owner names.
 *
 * OpenRA 对照: RequiresSpecificOwnersInfo
 */
interface RequiresSpecificOwnersInfoStub {
  readonly validOwnerNames: readonly string[]
}

// NOTE: IFacingInfo presence is checked via actorInfo.hasTraitInfo('IFacingInfo')
// No stub interface needed — the name string is sufficient.

// ---------------------------------------------------------------------------
// EditorActorBrush
// ---------------------------------------------------------------------------

/**
 * Brush for placing actors onto the editor map.
 *
 * OpenRA 对照: EditorActorBrush : IEditorBrush
 *
 * Creates and maintains a preview EditorActorPreview that follows the cursor.
 * On left-click, the preview actor is committed as a new AddActorAction.
 */
export class EditorActorBrush implements IEditorBrush {
  /** The preview actor that follows the cursor.
   *
   * OpenRA 对照: EditorActorBrush.Preview (public readonly)
   */
  readonly preview: EditorActorPreview

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** Editor actor layer for preview/placement management. */
  private readonly editorLayer: EditorActorLayer

  /** Action manager for undo/redo. */
  private readonly editorActionManager: EditorActionManager

  /** Editor widget that owns this brush. */
  private readonly editorWidget: EditorViewportControllerWidget

  /** Whether this actor shares cells (e.g., infantry stacking). */
  private readonly sharesCell: boolean

  /** Map for footprint validation. */
  private readonly _map: { contains(cell: CPos): boolean }

  /** Current cursor cell. */
  private cell: CPos

  /** Building center offset in world units (0 if not a building). */
  private readonly centerOffset: number

  /** Current subcell assignment (SubCell.Invalid if not sharing). */
  private subcell: SubCellEnum = SubCell.Invalid

  // -----------------------------------------------------------------------
  // Construction (OpenRA 对照: EditorActorBrush constructor)
  // -----------------------------------------------------------------------

  /**
   * Create a new EditorActorBrush.
   *
   * OpenRA 对照: EditorActorBrush(EditorViewportControllerWidget, ActorInfo, PlayerReference, WorldRenderer)
   *
   * Resolves the owner (with RequiresSpecificOwners validation), creates the
   * initial preview actor with center offset adjustment, and assigns a free
   * SubCell if the actor supports cell sharing.
   *
   * @param editorWidget — the editor viewport controller
   * @param actorInfo — the actor type metadata
   * @param owner — the owning player reference
   * @param wr — the world renderer
   */
  constructor(
    editorWidget: EditorViewportControllerWidget,
    actorInfo: ActorInfoStub,
    owner: PlayerReference,
    wr: WorldRendererStub,
  ) {
    this.editorWidget = editorWidget

    // Resolve traits from world actor
    // NOTE: WorldRendererStub doesn't expose .world directly; use unknown cast
    const wrUnknown = wr as unknown as {
      world: {
        worldActor: Record<string, unknown>
        map: { contains(cell: CPos): boolean }
      }
    }
    this.editorLayer = wrUnknown.world.worldActor.editorActorLayer as EditorActorLayer
    this.editorActionManager = wrUnknown.world.worldActor.editorActionManager as EditorActionManager
    this._map = wrUnknown.world.map

    // Check IOccupySpaceInfo for sharesCell and center offset
    const ios = actorInfo.traitInfoOrDefault<IOccupySpaceInfoStub>('IOccupySpaceInfo')
    const buildingInfo = actorInfo.traitInfoOrDefault<BuildingInfoStub>('BuildingInfo')
    this.centerOffset = buildingInfo?.centerOffset ?? 0
    this.sharesCell = (ios?.sharesCell) ?? false

    // Enforce first entry of ValidOwnerNames as owner if the actor has RequiresSpecificOwners
    let ownerName = owner.name
    const specificOwnerInfo = actorInfo.traitInfoOrDefault<RequiresSpecificOwnersInfoStub>(
      'RequiresSpecificOwnersInfo',
    )
    if (
      specificOwnerInfo &&
      specificOwnerInfo.validOwnerNames.length > 0 &&
      !specificOwnerInfo.validOwnerNames.includes(ownerName)
    ) {
      ownerName = specificOwnerInfo.validOwnerNames[0]
    }

    // Build actor reference (inits)
    const reference: ActorReferenceMap = new Map<string, unknown>()
    reference.set('OwnerInit', { type: 'OwnerInit', value: ownerName })
    reference.set('FactionInit', { type: 'FactionInit', value: owner.faction })

    // Calculate initial cell position with center offset
    const viewport = (wr as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
      viewToWorldPx(vp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number; readonly z: number }
      readonly lastMousePos: { readonly x: number; readonly y: number }
    }
    const screenPxOffset = (wr as Record<string, unknown>).screenPxOffset as
      | ((offset: { readonly x: number; readonly y: number; readonly z: number }) => { readonly x: number; readonly y: number })
      | undefined

    // NOTE: In C#: worldPx = ViewToWorldPx(LastMousePos) - ScreenPxOffset(centerOffset)
    // This adjusts the cursor by the building's center offset in world pixels.
    const lastMouseWorldPx = viewport.viewToWorldPx(viewport.lastMousePos)
    let adjustedX = lastMouseWorldPx.x
    let adjustedY = lastMouseWorldPx.y
    if (this.centerOffset !== 0) {
      if (screenPxOffset) {
        const offsetPx = screenPxOffset({ x: this.centerOffset, y: 0, z: 0 })
        adjustedX -= offsetPx.x
        adjustedY -= offsetPx.y
      } else {
        // NOTE: screenPxOffset is unavailable — this is typically the case
        // when the WorldRenderer is a stub in tests or early integration.
        // The center offset is silently skipped; the actor preview position
        // will not be adjusted.
      }
    }
    const worldPx = { x: adjustedX, y: adjustedY }
    this.cell = viewport.viewToWorld(viewport.worldToViewPx(worldPx))

    reference.set('LocationInit', { type: 'LocationInit', value: this.cell })

    // Assign free subcell if sharing
    if (this.sharesCell) {
      this.subcell = this.editorLayer.freeSubCellAt(this.cell)
      if (this.subcell !== SubCell.Invalid) {
        reference.set('SubCellInit', { type: 'SubCellInit', value: this.subcell })
      }
    }

    // Apply default facing if the actor supports it
    if (actorInfo.hasTraitInfo('IFacingInfo')) {
      reference.set('FacingInit', {
        type: 'FacingInit',
        value: this.editorLayer.Info.DefaultActorFacing,
      })
    }

    // Create the preview actor
    this.preview = new EditorActorPreview(
      wr,
      'ActorPreview', // temporary ID (C# passes null — previews aren't tracked by ID)
      reference,
      new PlayerReference({ name: ownerName, faction: owner.faction }),
      { name: actorInfo.name },
    )
  }

  // -----------------------------------------------------------------------
  // IEditorBrush.handleMouseInput
  // OpenRA 对照: EditorActorBrush.HandleMouseInput(MouseInput mi)
  // -----------------------------------------------------------------------

  /**
   * Handle mouse input for actor placement.
   *
   * OpenRA 对照: IEditorBrush.HandleMouseInput(MouseInput mi)
   *
   * Left button down: places the actor (if within map bounds).
   * Right button up: clears the brush.
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

    if (miTyped.button === MouseButton.Left && miTyped.event === MouseInputEvent.Down) {
      // Check the actor is inside the map
      // NOTE: C# uses world.Map.Tiles.Contains(c.Key).
      // We use our stored map reference.
      for (const [cell] of this.preview.footprint) {
        if (!this._map.contains(cell)) return true
      }

      const action = new AddActorAction(this.editorLayer, this.preview.export())
      this.editorActionManager.Add(action)
    }

    return true
  }

  // -----------------------------------------------------------------------
  // IEditorBrush.tickRender
  // OpenRA 对照: IEditorBrush.TickRender(WorldRenderer wr, Actor self)
  // -----------------------------------------------------------------------

  /**
   * Update the preview position when the cursor cell or subcell changes.
   *
   * OpenRA 对照: IEditorBrush.TickRender(WorldRenderer wr, Actor self)
   *
   * Offsets the mouse position by the center offset, computes the current cell
   * and free subcell, and updates the preview actor if changed.
   */
  tickRender(wr: WorldRendererStub, _self: IGameActor): void {
    const viewport = (wr as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
      viewToWorldPx(vp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number; readonly z: number }
      readonly lastMousePos: { readonly x: number; readonly y: number }
    }
    const screenPxOffset = (wr as Record<string, unknown>).screenPxOffset as
      | ((offset: { readonly x: number; readonly y: number; readonly z: number }) => { readonly x: number; readonly y: number })
      | undefined

    // Offset mouse position by center offset (in world pixels)
    const lastMouseWorldPx = viewport.viewToWorldPx(viewport.lastMousePos)
    // NOTE: C#: worldPx = ViewToWorldPx(LastMousePos) - ScreenPxOffset(centerOffset)
    let adjustedX = lastMouseWorldPx.x
    let adjustedY = lastMouseWorldPx.y
    if (this.centerOffset !== 0) {
      if (screenPxOffset) {
        const offsetPx = screenPxOffset({ x: this.centerOffset, y: 0, z: 0 })
        adjustedX -= offsetPx.x
        adjustedY -= offsetPx.y
      }
      // NOTE: when screenPxOffset is unavailable, center offset is silently
      // skipped. This matches the constructor's behavior for test stubs.
    }
    const worldPx = { x: adjustedX, y: adjustedY }
    const currentCell = viewport.viewToWorld(viewport.worldToViewPx(worldPx))

    const currentSubcell = this.sharesCell
      ? this.editorLayer.freeSubCellAt(currentCell)
      : SubCell.Invalid

    if (this.cell.Bits !== currentCell.Bits || this.subcell !== currentSubcell) {
      this.cell = currentCell

      this.preview.replaceInit('LocationInit', {
        type: 'LocationInit',
        value: currentCell,
      })

      if (this.sharesCell) {
        this.subcell = this.editorLayer.freeSubCellAt(this.cell)
        if (this.subcell === SubCell.Invalid) {
          this.preview.removeInit('SubCellInit')
        } else {
          this.preview.replaceInit('SubCellInit', {
            type: 'SubCellInit',
            value: this.subcell,
          })
        }
      }

      this.preview.updateFromMove()
    }
  }

  // -----------------------------------------------------------------------
  // IEditorBrush.renderAboveShroud
  // OpenRA 对照: IEditorBrush.RenderAboveShroud(Actor self, WorldRenderer wr)
  // -----------------------------------------------------------------------

  /**
   * Render the preview actor above the shroud, sorted by Z position.
   *
   * OpenRA 对照: IEditorBrush.RenderAboveShroud(Actor self, WorldRenderer wr)
   *
   * In C#: `return Preview.Render().OrderBy(WorldRenderer.RenderableZPositionComparisonKey)`
   * In TypeScript, we return unsorted (Z sorting requires full WorldRenderer integration).
   *
   * @returns renderables for the preview actor
   */
  renderAboveShroud(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return this.preview.render()
  }

  /**
   * Render annotations for the preview actor.
   *
   * OpenRA 对照: IEditorBrush.RenderAnnotations(Actor self, WorldRenderer wr)
   *
   * @returns annotation renderables for the preview actor
   */
  renderAnnotations(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return this.preview.renderAnnotations()
  }

  /**
   * Per-tick logic update — no-op.
   *
   * OpenRA 对照: EditorActorBrush.Tick()
   */
  tick(): void {
    // No-op
  }

  /**
   * Dispose of brush resources.
   *
   * OpenRA 对照: EditorActorBrush.Dispose()
   */
  dispose(): void {
    // No explicit dispose needed — preview is cleaned up by EditorActorLayer
  }
}
