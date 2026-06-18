/**
 * EditorActorPreview.ts — 编辑器轻量级渲染代理（非完整 GameActor）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/EditorActorPreview.cs (333 lines C#)
 *
 * 核心范式转换:
 * - C# render-only proxy (IEquatable<EditorActorPreview>) → TypeScript 独立类
 *   （不是 TraitDictionary，不参与 ITick/Activity/网络同步）
 * - C# ActorReference (Dictionary<Type, ActorInit>) → Map<string, unknown>
 *   + 类型化的辅助访问方法
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[] 数组
 * - C# IActorPreview/IRenderActorPreviewInfo 预览管线 → 延迟到 TODO-21.A.5-DEFER-2
 * - C# SelectionBoxAnnotationRenderable → 延迟到 TODO-21.A.5-DEFER-3
 * - C# 2D 精灵渲染 → Babylon.js Billboard/Mesh（延迟到预览管线迁移）
 *
 * 编辑器世界中的 actor 是轻量级预览代理，而非完整 GameActor 实例。
 * 它们渲染为精灵/billboard，但没有游戏逻辑、AI 或网络状态。
 *
 * Migration: TODO-21.A.5 — Chapter 21 Phase A
 */

import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'
import type { SubCell as SubCellEnum } from '../../../OpenRA.Game/Traits/SubCell.js'
import type { IOccupySpaceInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ActorInfoStub,
  WorldRendererStub,
  IRenderable,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerReference } from '../../../OpenRA.Game/Map/PlayerReference.js'

// ---------------------------------------------------------------------------
// ActorInit stub types (TODO-21.A.3-DEFER: replace with real ActorInit classes)
// ---------------------------------------------------------------------------

/**
 * Stub for LocationInit — the initial map cell position of an actor.
 *
 * OpenRA 对照: LocationInit : ActorInit
 *
 * TODO-21.A.3-DEFER-1: Replace with full ActorInit class hierarchy.
 */
export interface LocationInit {
  readonly type: 'LocationInit'
  readonly value: CPos
}

/**
 * Stub for OwnerInit — the initial owning player.
 *
 * OpenRA 对照: OwnerInit : ActorInit
 */
export interface OwnerInit {
  readonly type: 'OwnerInit'
  readonly value: string
}

/**
 * Stub for FactionInit — the initial faction override.
 *
 * OpenRA 对照: FactionInit : ActorInit
 */
export interface FactionInit {
  readonly type: 'FactionInit'
  readonly value: string
}

/**
 * Stub for HealthInit — the initial health percentage.
 *
 * OpenRA 对照: HealthInit : ActorInit
 */
export interface HealthInit {
  readonly type: 'HealthInit'
  readonly value: number
}

/**
 * Stub for SubCellInit — the sub-cell position override.
 *
 * OpenRA 对照: SubCellInit : ActorInit
 */
export interface SubCellInit {
  readonly type: 'SubCellInit'
  readonly value: SubCellEnum
}

/**
 * Stub for CenterPositionInit — direct world position override.
 *
 * OpenRA 对照: CenterPositionInit : ActorInit
 */
export interface CenterPositionInit {
  readonly type: 'CenterPositionInit'
  readonly value: WPos
}

/**
 * Union of all ActorInit types used by EditorActorPreview.
 */
export type EditorActorInit =
  | LocationInit
  | OwnerInit
  | FactionInit
  | HealthInit
  | SubCellInit
  | CenterPositionInit

// ---------------------------------------------------------------------------
// Actor reference helpers
// ---------------------------------------------------------------------------

/**
 * A lightweight actor configuration (ActorReference) for editor previews.
 *
 * OpenRA 对照: ActorReference (class extending Dictionary<Type, ActorInit>)
 *
 * Stores init key-value pairs as a Map<string, unknown>. In OpenRA's C# the
 * key is `typeof(ActorInit)`, but in TypeScript we use the init's `type`
 * discriminant string as the key.
 */
export type ActorReferenceMap = Map<string, unknown>

// ---------------------------------------------------------------------------
// EditorActorPreview (OpenRA 对照: EditorActorPreview : IEquatable<EditorActorPreview>)
// ---------------------------------------------------------------------------

/**
 * Lightweight render-only actor preview for the map editor.
 *
 * OpenRA 对照: EditorActorPreview : IEquatable<EditorActorPreview>
 *
 * This is NOT a full GameActor. It has no TraitDictionary, no ITick processing,
 * no Activity graph, and no AI or network state. It exists purely for visual
 * representation in the map editor.
 *
 * Key characteristics:
 * - Stores actor configuration as a dictionary of inits (ActorReference)
 * - Generates preview renderables from IRenderActorPreviewInfo trait infos
 * - Manages footprint, position, bounds, selection state
 * - Supports init manipulation (add, replace, remove)
 * - Implements IEquatable for deterministic preview management
 * - Supports save/export to serialize editor state
 *
 * NOTE: Many rendering subsystems are not yet migrated (see TODO markers).
 *   The core data model and init management are fully functional.
 */
export class EditorActorPreview {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Default tile scale for rectangular grids. */
  private static readonly DEFAULT_TILE_SCALE = 1024

  // ---------------------------------------------------------------------------
  // Properties (OpenRA 对照: public readonly / properties)
  // ---------------------------------------------------------------------------

  /** Actor type name from the ruleset.
   *
   * OpenRA 对照: EditorActorPreview.Type
   */
  readonly type: string

  /** Unique identifier for this preview actor.
   *
   * OpenRA 对照: EditorActorPreview.ID
   */
  readonly id: string

  /** Actor type metadata from the ruleset.
   *
   * OpenRA 对照: EditorActorPreview.Info
   */
  readonly info: ActorInfoStub

  /** Human-readable display name.
   *
   * OpenRA 对照: EditorActorPreview.DescriptiveName
   */
  readonly descriptiveName: string

  /**
   * Whether this preview is currently selected in the editor.
   *
   * OpenRA 对照: EditorActorPreview.Selected
   */
  selected: boolean = false

  /**
   * The owning player reference for faction-specific rendering.
   *
   * OpenRA 对照: EditorActorPreview.Owner
   *
   * Setting this invalidates the cached tooltip.
   */
  private _owner!: PlayerReference

  get owner(): PlayerReference {
    return this._owner
  }

  set owner(value: PlayerReference) {
    this._owner = value
    this._tooltipCache = null
  }

  /**
   * The world-space center position of this preview.
   *
   * OpenRA 对照: EditorActorPreview.CenterPosition
   */
  centerPosition: WPos

  /**
   * The map cell position (top-left of footprint).
   *
   * OpenRA 对照: EditorActorPreview.Location
   */
  location: CPos

  /**
   * The cells occupied by this actor, keyed by cell with sub-cell occupancy.
   *
   * OpenRA 对照: EditorActorPreview.Footprint
   */
  footprint: ReadonlyMap<CPos, SubCellEnum>

  /**
   * Radar/minimap color.
   *
   * OpenRA 对照: EditorActorPreview.RadarColor
   *
   * NOTE: Stored as ARGB number (TS has no Color struct). Default = owner color.
   */
  radarColor: number

  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  /**
   * The actor configuration dictionary (ActorReference).
   *
   * OpenRA 对照: ActorReference reference
   *
   * Key = init type discriminant string (e.g., 'LocationInit', 'OwnerInit').
   * Value = the init instance.
   */
  private _reference: ActorReferenceMap

  /**
   * Reference to the world renderer (for position/rendering calculations).
   *
   * OpenRA 对照: WorldRenderer worldRenderer
   */
  private readonly _worldRenderer: WorldRendererStub

  /**
   * Optional owner init lookup for IOccupySpaceInfo.
   */
  private _occupySpaceInfo: IOccupySpaceInfo | null = null

  /**
   * Cached tooltip string. Cleared when owner changes.
   * null = dirty, needs recomputation.
   */
  private _tooltipCache: string | null = null

  // ---------------------------------------------------------------------------
  // Constructor (OpenRA 对照: EditorActorPreview constructor)
  // ---------------------------------------------------------------------------

  /**
   * Create a new editor actor preview.
   *
   * OpenRA 对照: EditorActorPreview(WorldRenderer wr, string id,
   *   ActorReference reference, PlayerReference owner)
   *
   * In C#, the constructor also:
   * - Inserts FactionInit and OwnerInit if not present
   * - Looks up ActorInfo from the ruleset
   * - Computes footprint and center position
   * - Resolves tooltip / descriptive name
   * - Resolves radar color
   *
   * @param worldRenderer — the world renderer for coordinate transforms
   * @param id — unique actor identifier
   * @param reference — init map (ActorReference equivalent)
   * @param owner — owning player reference
   * @param info — actor type metadata (ruleset lookup)
   * @param descriptiveName — optional display name override
   */
  constructor(
    worldRenderer: WorldRendererStub,
    id: string,
    reference: ActorReferenceMap,
    owner: PlayerReference,
    info: ActorInfoStub,
    descriptiveName?: string,
  ) {
    this._worldRenderer = worldRenderer
    this.id = id
    this._reference = new Map(reference)
    this.owner = owner
    this.info = info
    this.type = info.name
    this.descriptiveName = descriptiveName ?? info.name

    // Ensure owner + faction inits exist (matching C# behavior)
    if (!this._reference.has('OwnerInit')) {
      this._reference.set('OwnerInit', {
        type: 'OwnerInit',
        value: owner.name,
      } satisfies OwnerInit)
    }
    if (!this._reference.has('FactionInit')) {
      this._reference.set('FactionInit', {
        type: 'FactionInit',
        value: owner.faction,
      } satisfies FactionInit)
    }

    // Compute initial footprint and center position
    const locInit = this._reference.get('LocationInit') as LocationInit | undefined
    if (locInit) {
      this.location = locInit.value
    } else {
      this.location = CPos.Zero
    }

    this.footprint = this._computeFootprint()
    this.centerPosition = this._computeCenterPosition()
    this.radarColor = owner.color
  }

  // ---------------------------------------------------------------------------
  // Computed getter: Tooltip (OpenRA 对照: EditorActorPreview.Tooltip)
  // ---------------------------------------------------------------------------

  /**
   * Multi-line tooltip text for hover display.
   *
   * OpenRA 对照: EditorActorPreview.Tooltip
   *
   * Format:
   *   "<DescriptiveName>\n<OwnerName> (<Faction>)\nID: <ID>\nType: <Type>"
   *
   * NOTE: In C# this uses FluentProvider.GetMessage(tooltip.Name) for the
   *   first line. Since FluentProvider is not yet migrated, we use
   *   DescriptiveName directly. TODO-21.A.5-DEFER-5.
   */
  get tooltip(): string {
    if (this._tooltipCache !== null) {
      return this._tooltipCache
    }
    const nameLine = ` < ${this.info.name} >`
    const ownerLine = `${this.owner.name} (${this.owner.faction})`
    this._tooltipCache = `${nameLine}\n${ownerLine}\nID: ${this.id}\nType: ${this.info.name}`
    return this._tooltipCache
  }

  // ---------------------------------------------------------------------------
  // WithId (OpenRA 对照: EditorActorPreview WithId(string id))
  // ---------------------------------------------------------------------------

  /**
   * Clone this preview with a new ID.
   *
   * OpenRA 对照: EditorActorPreview.WithId(string id)
   *
   * This is used during copy/paste operations where a new unique ID is needed
   * for the pasted actor. The clone shares the same init configuration but
   * gets a fresh ID.
   *
   * @param newId — the new unique identifier
   * @returns a new EditorActorPreview with the same config and new ID
   */
  withId(newId: string): EditorActorPreview {
    const clonedRef = new Map(this._reference)
    // Override the FactionInit to match current owner (C# behavior)
    if (clonedRef.has('FactionInit')) {
      clonedRef.set('FactionInit', {
        type: 'FactionInit',
        value: this.owner.faction,
      } satisfies FactionInit)
    }
    return new EditorActorPreview(
      this._worldRenderer,
      newId,
      clonedRef,
      this.owner,
      this.info,
      this.descriptiveName,
    )
  }

  // ---------------------------------------------------------------------------
  // position / footprint / bounds recalculation
  // ---------------------------------------------------------------------------

  /**
   * Recalculate center position and preview bounds when the terrain changes.
   *
   * OpenRA 对照: EditorActorPreview.UpdateFromCellChange()
   *
   * Called when the map terrain is modified (elevation change, tile change)
   * to ensure the preview actor stays correctly positioned on the terrain.
   */
  updateFromCellChange(): void {
    this.centerPosition = this._computeCenterPosition()
    // TODO-21.A.5-DEFER-2: regenerate previews when IRenderActorPreviewInfo
    //   pipeline is migrated — C# calls GeneratePreviews() + GenerateBounds()
  }

  /**
   * Recalculate center position and footprint when the actor is moved.
   *
   * OpenRA 对照: EditorActorPreview.UpdateFromMove()
   *
   * Called after a move operation to update the world position, cell footprint,
   * and screen-space bounds.
   */
  updateFromMove(): void {
    const locInit = this._reference.get('LocationInit') as LocationInit | undefined
    if (locInit) {
      this.location = locInit.value
    }
    this.centerPosition = this._computeCenterPosition()
    this.footprint = this._computeFootprint()
    // TODO-21.A.5-DEFER-2: regenerate bounds when preview pipeline is migrated
  }

  // ---------------------------------------------------------------------------
  // Tick (OpenRA 对照: EditorActorPreview.Tick())
  // ---------------------------------------------------------------------------

  /**
   * Advance preview animations.
   *
   * OpenRA 对照: EditorActorPreview.Tick()
   *
   * NOTE: In C# this iterates over previews[] and calls p.Tick() on each
   *   IActorPreview. Since the preview pipeline is deferred, this is a no-op.
   *   TODO-21.A.5-DEFER-2.
   */
  tick(): void {
    // TODO-21.A.5-DEFER-2: Call preview.Tick() on each IActorPreview
  }

  // ---------------------------------------------------------------------------
  // Render (OpenRA 对照: EditorActorPreview.Render())
  // ---------------------------------------------------------------------------

  /**
   * Collect renderables at the current center position.
   *
   * OpenRA 对照: EditorActorPreview.Render()
   *
   * @returns array of IRenderable for the render pipeline
   */
  render(): readonly IRenderable[] {
    return this._renderAt(this.centerPosition)
  }

  /**
   * Collect renderables at an offset from center position.
   *
   * OpenRA 对照: EditorActorPreview.RenderWithOffset(WVec offset)
   *
   * @param offset — world-space offset from center
   * @returns array of IRenderable for the render pipeline
   */
  renderWithOffset(offset: WVec): readonly IRenderable[] {
    return this._renderAt(WPos.add(this.centerPosition, offset))
  }

  /**
   * Collect renderables at a specific world position.
   *
   * OpenRA 对照: EditorActorPreview.RenderAt(WPos centerPosition)
   *
   * When selected, renders each preview twice: once normally, once tinted
   * white with 50% alpha (the selection highlight effect from C#).
   *
   * @param _centerPos — the world position to render at
   * @returns array of IRenderable for the render pipeline
   */
  private _renderAt(_centerPos: WPos): readonly IRenderable[] {
    // TODO-21.A.5-DEFER-2: Implement when IRenderActorPreviewInfo pipeline
    //   is migrated. C# behavior:
    //   1. Generate previews from IRenderActorPreviewInfo.RenderPreview()
    //   2. If Selected: render each preview normally, then again with
    //      WithTint(float3.Ones, ReplaceColor).WithAlpha(0.5f)
    return []
  }

  /**
   * Collect annotation renderables (selection box when selected).
   *
   * OpenRA 对照: EditorActorPreview.RenderAnnotations()
   *
   * @returns array of IRenderable for the annotation pass
   */
  renderAnnotations(): readonly IRenderable[] {
    // TODO-21.A.5-DEFER-3: When SelectionBoxAnnotationRenderable is migrated,
    //   render the selection box around Bounds when Selected
    return []
  }

  // ---------------------------------------------------------------------------
  // Bounds (OpenRA 对照: EditorActorPreview.Bounds — Rectangle)
  // ---------------------------------------------------------------------------

  /**
   * Get the screen-space bounding rectangle.
   *
   * OpenRA 对照: EditorActorPreview.Bounds
   *
   * NOTE: Computed from preview screen bounds. Returns a default rectangle
   *   until the preview pipeline is migrated.
   *   TODO-21.A.5-DEFER-2.
   */
  get bounds(): { x: number; y: number; width: number; height: number } {
    // Default: a small rectangle around a projected center
    return { x: 0, y: 0, width: 64, height: 64 }
  }

  // ---------------------------------------------------------------------------
  // Init management (OpenRA 对照: AddInit / ReplaceInit / RemoveInit / etc.)
  // ---------------------------------------------------------------------------

  /**
   * Add a typed init to the actor configuration.
   *
   * OpenRA 对照: EditorActorPreview.AddInit<T>(T init) where T : ActorInit
   *
   * @param initType — the init type discriminant string
   * @param init — the init instance
   */
  addInit(initType: string, init: unknown): void {
    this._reference.set(initType, init)
    // NOTE: C# calls GeneratePreviews() after every init mutation.
    // TODO-21.A.5-DEFER-2: Regenerate previews
  }

  /**
   * Replace a typed init, removing the previous value of the same type first.
   *
   * OpenRA 对照: EditorActorPreview.ReplaceInit<T>(T init, TraitInfo info)
   *
   * In C#, the overload with TraitInfo removes the specific init associated
   * with that trait info. In TS, we use the initType as the key.
   *
   * @param initType — the init type discriminant string
   * @param init — the new init instance
   */
  replaceInit(initType: string, init: unknown): void {
    this._reference.set(initType, init)
    // NOTE: C# ReplaceInit also calls UpdateRadarColor() when the init
    //   implements ISingleInstanceInit (e.g., FactionInit changes faction
    //   which may change radar color via RadarColorFromTerrainInfo).
    //   TODO-21.A.5-DEFER-4: Call UpdateRadarColor() after faction/owner
    //   init changes when RadarColorFromTerrainInfo is migrated.
    // TODO-21.A.5-DEFER-2: Regenerate previews
  }

  /**
   * Remove a typed init.
   *
   * OpenRA 对照: EditorActorPreview.RemoveInit<T>(TraitInfo info)
   *
   * @param initType — the init type discriminant string
   */
  removeInit(initType: string): void {
    this._reference.delete(initType)
    // TODO-21.A.5-DEFER-2: Regenerate previews
  }

  /**
   * Remove all inits of a given type.
   *
   * OpenRA 对照: EditorActorPreview.RemoveInits<T>() where T : ActorInit
   *
   * @param initType — the init type discriminant string
   * @returns the number of inits removed
   */
  removeInits(initType: string): number {
    let count = 0
    for (const key of this._reference.keys()) {
      if (key === initType) {
        this._reference.delete(key)
        count++
      }
    }
    // TODO-21.A.5-DEFER-2: Regenerate previews
    return count
  }

  /**
   * Get a typed init value, returning undefined if not present.
   *
   * OpenRA 对照: EditorActorPreview.GetInitOrDefault<T>(TraitInfo info)
   *   and GetInitOrDefault<T>() where T : ISingleInstanceInit
   *
   * @param initType — the init type discriminant string
   * @returns the init value, or undefined
   */
  getInitOrDefault<T = unknown>(initType: string): T | undefined {
    return this._reference.get(initType) as T | undefined
  }

  /**
   * Get all inits of a given type.
   *
   * OpenRA 对照: EditorActorPreview.GetInits<T>() where T : ActorInit
   *
   * Since we use type discriminants as keys, there is at most one init per type.
   *
   * @param initType — the init type discriminant string
   * @returns array of matching inits (0 or 1 element)
   */
  getInits<T = unknown>(initType: string): T[] {
    const value = this._reference.get(initType)
    return value !== undefined ? [value as T] : []
  }

  /**
   * Get the raw init map (for serialization/testing).
   *
   * @returns the internal init map
   */
  getReference(): ActorReferenceMap {
    return new Map(this._reference)
  }

  // ---------------------------------------------------------------------------
  // Editor lifecycle notifications
  // ---------------------------------------------------------------------------

  /**
   * Called when this preview actor is added to the editor.
   *
   * OpenRA 对照: EditorActorPreview.AddedToEditor()
   *
   * Notifies all INotifyEditorPlacementInfo traits. Deferred until the
   * INotifyEditorPlacement callback system is migrated.
   *
   * TODO-21.A.5-DEFER-1: Implement INotifyEditorPlacement callbacks
   */
  addedToEditor(): void {
    // TODO-21.A.5-DEFER-1
  }

  /**
   * Called when this preview actor is removed from the editor.
   *
   * OpenRA 对照: EditorActorPreview.RemovedFromEditor()
   *
   * TODO-21.A.5-DEFER-1: Implement INotifyEditorPlacement callbacks
   */
  removedFromEditor(): void {
    // TODO-21.A.5-DEFER-1
  }

  // ---------------------------------------------------------------------------
  // Save / Export (OpenRA 对照: Save() / Export())
  // ---------------------------------------------------------------------------

  /**
   * Serialize this actor to save format.
   *
   * OpenRA 对照: EditorActorPreview.Save() → MiniYaml
   *
   * In C#, SaveInit filters out default-value inits (FactionInit matching
   * owner faction, HealthInit == 100). Returns the serialized reference.
   *
   * NOTE: Full MiniYaml serialization is deferred.
   *   Returns a JSON-serializable object for now.
   *
   * @returns a JSON-compatible save object
   */
  save(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    // Save each init, filtering default values as C# does
    for (const [key, value] of this._reference) {
      // Filter FactionInit if it matches owner faction (C# behavior)
      if (key === 'FactionInit') {
        const fi = value as FactionInit
        if (fi.value === this.owner.faction) {
          continue
        }
      }
      // Filter HealthInit if value == 100 (C# behavior)
      if (key === 'HealthInit') {
        const hi = value as HealthInit
        if (hi.value === 100) {
          continue
        }
      }
      result[key] = value
    }
    return result
  }

  /**
   * Export the actor reference for copy/paste.
   *
   * OpenRA 对照: EditorActorPreview.Export() → ActorReference
   *
   * Returns a shallow copy of the init map. The init values themselves are
   * shared with the source — callers that need to mutate individual inits
   * should clone them first. The map structure is independent.
   *
   * @returns a shallow-copied init map
   */
  export(): ActorReferenceMap {
    return new Map(this._reference)
  }

  // ---------------------------------------------------------------------------
  // Equality (OpenRA 对照: IEquatable<EditorActorPreview>)
  // ---------------------------------------------------------------------------

  /**
   * Compare with another EditorActorPreview by ID (case-insensitive).
   *
   * OpenRA 对照: EditorActorPreview.Equals(EditorActorPreview other)
   *
   * Two previews are equal if they have the same ID, compared using
   * ordinal (case-insensitive) comparison.
   *
   * @param other — the other preview to compare with
   * @returns true if both have the same ID
   */
  equals(other: EditorActorPreview | null | undefined): boolean {
    if (!other) return false
    if (this === other) return true
    return this.id.toLowerCase() === other.id.toLowerCase()
  }

  /**
   * Hash code based on the lowercase ID.
   *
   * OpenRA 对照: EditorActorPreview.GetHashCode()
   *
   * @returns hash code for dictionary/set keys
   */
  getHashCode(): number {
    const lower = this.id.toLowerCase()
    let hash = 0
    for (let i = 0; i < lower.length; i++) {
      const ch = lower.charCodeAt(i)
      hash = ((hash << 5) - hash) + ch
      hash |= 0 // 32-bit int
    }
    return hash
  }

  // ---------------------------------------------------------------------------
  // ToString (OpenRA 对照: EditorActorPreview.ToString())
  // ---------------------------------------------------------------------------

  /**
   * String representation: "{Info.Name} {ID}"
   *
   * OpenRA 对照: EditorActorPreview.ToString()
   *
   * @returns human-readable string
   */
  toString(): string {
    return `${this.info.name} ${this.id}`
  }

  // ---------------------------------------------------------------------------
  // Setter for IOccupySpaceInfo (for footprint computation)
  // ---------------------------------------------------------------------------

  /**
   * Set the IOccupySpaceInfo reference for footprint computation.
   *
   * OpenRA 对照: Info.TraitInfoOrDefault<IOccupySpaceInfo>()
   *
   * In C# this is looked up from ActorInfo at construction time. In TS,
   * we allow it to be injected after construction since ActorInfo doesn't
   * yet support TraitInfoOrDefault queries.
   *
   * @param info — the IOccupySpaceInfo to use for footprint calculation
   */
  setOccupySpaceInfo(info: IOccupySpaceInfo | null): void {
    this._occupySpaceInfo = info
  }

  // ---------------------------------------------------------------------------
  // Internal: footprint calculation
  // ---------------------------------------------------------------------------

  /**
   * Compute the occupied cells for this actor.
   *
   * OpenRA 对照: EditorActorPreview.GenerateFootprint()
   *
   * Uses IOccupySpaceInfo.occupiedCells() if available, otherwise falls back
   * to a single-cell footprint at Location.
   *
   * @returns map of cell position → sub-cell occupancy
   */
  private _computeFootprint(): ReadonlyMap<CPos, SubCellEnum> {
    const locInit = this._reference.get('LocationInit') as LocationInit | undefined
    const location = locInit?.value ?? CPos.Zero

    if (this._occupySpaceInfo) {
      const sclInit = this._reference.get('SubCellInit') as SubCellInit | undefined
      const subCell = sclInit?.value ?? SubCell.Any
      const cells = this._occupySpaceInfo.occupiedCells(this.info, location, subCell)
      if (cells && cells.size > 0) {
        return cells
      }
    }

    // Fallback: single cell at full-cell sub-cell
    return new Map([[location, SubCell.FullCell]])
  }

  /**
   * Compute the world-space center position.
   *
   * OpenRA 对照: EditorActorPreview.PreviewPosition(World, ActorReference)
   *
   * Logic:
   * 1. If CenterPositionInit exists → use its value
   * 2. If LocationInit exists → compute from cell + sub-cell center
   * 3. Otherwise → throw (must have one or the other)
   *
   * NOTE: BuildingInfo.CenterOffset() is deferred (TODO-21.A.5-DEFER-6).
   *   When BuildingInfo is migrated, add the building center offset
   *   to the computed position.
   *
   * @returns the world-space center position
   * @throws Error if neither CenterPositionInit nor LocationInit is present
   */
  private _computeCenterPosition(): WPos {
    // Priority 1: Check CenterPositionInit
    const cpInit = this._reference.get('CenterPositionInit') as CenterPositionInit | undefined
    if (cpInit) {
      return cpInit.value
    }

    // Priority 2: Compute from LocationInit
    const locInit = this._reference.get('LocationInit') as LocationInit | undefined
    if (locInit) {
      const cell = locInit.value
      const sclInit = this._reference.get('SubCellInit') as SubCellInit | undefined
      const subCell = sclInit?.value ?? SubCell.Any

      // Compute cell center in world space
      // CenterOfSubCell: cell * tileScale + subCellOffset
      // For rectangular grid at full cell: center is at (x*1024 + 512, y*1024 + 512)
      const tileScale = EditorActorPreview.DEFAULT_TILE_SCALE
      const halfTile = tileScale / 2
      let offsetX = halfTile
      let offsetY = halfTile

      // Sub-cell offset (simplified — uses center for Any/FullCell)
      if (subCell !== SubCell.Any && subCell !== SubCell.FullCell) {
        // Map sub-cell index to a small offset
        // Sub-cell 0: center (0,0), 1: top-left, 2: top-right, 3: center, 4: bottom-left, 5: bottom-right
        // NOTE: These sub-cell offsets are for Rectangular grids.
        //   Isometric grids use a different staggered-diamond offset
        //   scheme. The offsets below are ported from OpenRA's
        //   MapGrid.SubCellOffsets. See MapGrid.ts lines 113-126.
        //   TODO-21.A.5-DEFER-7: Grid-type-dependent sub-cell offsets
        //   for isometric maps.
        const subCellShifts: Record<number, [number, number]> = {
          0: [0, 0],
          1: [-tileScale / 4, -tileScale / 4],
          2: [tileScale / 4, -tileScale / 4],
          3: [0, 0],
          4: [-tileScale / 4, tileScale / 4],
          5: [tileScale / 4, tileScale / 4],
        }
        const [sx, sy] = subCellShifts[subCell] ?? [0, 0]
        offsetX += sx
        offsetY += sy
      }

      // TODO-21.A.5-DEFER-6: Add BuildingInfo.CenterOffset(world) offset
      //   when BuildingInfo is migrated.

      const worldX = cell.X * tileScale + offsetX
      const worldY = cell.Y * tileScale + offsetY
      return new WPos(worldX, worldY, 0)
    }

    throw new Error(
      `EditorActorPreview "${this.id}": ` +
      `must define LocationInit or CenterPositionInit`,
    )
  }
}
