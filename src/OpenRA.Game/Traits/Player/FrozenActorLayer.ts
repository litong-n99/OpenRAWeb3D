/**
 * FrozenActorLayer.ts — Per-player frozen actor snapshot system
 * OpenRA 对照: OpenRA.Game/Traits/Player/FrozenActorLayer.cs
 *
 * 核心范式转换:
 * - C# FrozenActor capturing live Actor state → TypeScript FrozenActor snapshotting
 *   IGameActor properties
 * - C# Dictionary<uint, FrozenActor> → TypeScript Map<number, FrozenActor>
 * - C# SpatiallyPartitioned<FrozenActor> → TypeScript SpatiallyPartitioned<FrozenActor>
 *   (already migrated)
 * - C# IRenderable[] rendered by ScreenMap → deferred (TODO-12.DEFERRED.13)
 * - C# Polygon/Rectangle screen bounds → deferred (TODO-12.DEFERRED.12)
 * - C# Flash() tint animation → deferred (TODO-12.DEFERRED.11)
 * - C# ITooltipInfo / tooltip delegation → deferred (TODO-12.DEFERRED.14)
 */

import type {
  IGameActor,
  IRender,
  ITick,
  ISync,
  IRenderable,
  ITooltipInfo,
  IHealth,
  IVisibilityModifier,
  ICreatesFrozenActors,
  PlayerStub,
  WorldStub,
  DamageState,
  WorldRendererStub,
  RectangleStub,
} from '../TraitsInterfaces'
import { DamageState as DamageStateConst } from '../TraitsInterfaces'
import { PPos } from '../../MPos'
import { WPos } from '../../WPos'
import { WDist } from '../../WDist'
import { Rectangle } from '../../Primitives/Rectangle'
import { SpatiallyPartitioned } from '../../Primitives/SpatiallyPartitioned'
import type { CellRegion } from '../../Map/CellRegion'
import { CellVisibility } from './Shroud'

// ---------------------------------------------------------------------------
// Forward / deferred type stubs
// ---------------------------------------------------------------------------

/** Minimal polygon stub for mouse hit-test bounds (deferred).
 *
 * TODO-12.DEFERRED.12: Replace with real Polygon class when migrated.
 */
interface PolygonStub {
  readonly isEmpty: boolean
}

/** Empty polygon singleton. */
const EmptyPolygon: PolygonStub = { isEmpty: true }

// ---------------------------------------------------------------------------
// IWorldWithScreenMap — extended world interface for FrozenActorLayer
// ---------------------------------------------------------------------------

/**
 * Extended world interface that exposes ScreenMap and Map for spatial queries.
 *
 * FrozenActorLayer accesses `world.ScreenMap.AddOrUpdate/Remove` and
 * `world.Map.CellContaining/MapSize`. This interface bridges the gap
 * between WorldStub and the concrete World implementation.
 */
interface IWorldWithScreenMap extends WorldStub {
  readonly screenMap: IScreenMapForFrozenActors
  readonly map: IMapForFrozenActors
}

interface IScreenMapForFrozenActors {
  addOrUpdate(viewer: PlayerStub, fa: FrozenActor): void
  remove(viewer: PlayerStub, fa: FrozenActor): void
  renderableFrozenActorsInBox(
    viewer: PlayerStub,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): readonly FrozenActor[]
}

interface IMapForFrozenActors {
  readonly mapSize: { width: number; height: number }
  cellContaining(pos: WPos): { X: number; Y: number }
}

// ---------------------------------------------------------------------------
// FrozenActorLayerInfo (corresponds to OpenRA FrozenActorLayerInfo)
// ---------------------------------------------------------------------------

/**
 * Trait info for FrozenActorLayer.
 *
 * OpenRA 对照: FrozenActorLayerInfo
 *
 * Requires ShroudInfo on the same actor. Attach this to the player actor.
 */
export class FrozenActorLayerInfo {
  /** Size of partition bins in cells.
   *
   * OpenRA 对照: FrozenActorLayerInfo.BinSize
   */
  readonly binSize: number

  constructor(binSize: number = 10) {
    this.binSize = binSize
  }
}

// ---------------------------------------------------------------------------
// FrozenActor (corresponds to OpenRA FrozenActor)
// ---------------------------------------------------------------------------

/**
 * Snapshot of an enemy actor captured when it leaves visible range.
 *
 * OpenRA 对照: FrozenActor
 *
 * Frozen actors retain the last-known state (position, owner, health, target
 * types) of live actors that are no longer visible to the viewing player.
 * They are rendered with reduced opacity until the actor re-enters visible
 * range or is destroyed.
 */
export class FrozenActor {
  // -----------------------------------------------------------------------
  // Public readonly fields (set at construction)
  // -----------------------------------------------------------------------

  /** The actor's projected cell footprint, filtered to shroud bounds.
   *
   * OpenRA 对照: FrozenActor.Footprint
   */
  readonly Footprint: readonly PPos[]

  /** The actor's center position at snapshot time.
   *
   * OpenRA 对照: FrozenActor.CenterPosition
   */
  readonly CenterPosition: WPos

  /** The player who views this frozen actor.
   *
   * OpenRA 对照: FrozenActor.Viewer
   */
  readonly Viewer: PlayerStub

  // -----------------------------------------------------------------------
  // Internal fields (set at construction from live actor)
  // -----------------------------------------------------------------------

  /** Reference to the live actor (may become dead/disposed).
   *
   * OpenRA 对照: FrozenActor.actor (private)
   */
  private readonly _actor: IGameActor

  /** The trait that created this frozen actor.
   *
   * OpenRA 对照: FrozenActor.frozenTrait (private)
   */
  private readonly _frozenTrait: ICreatesFrozenActors

  /** Reference to the viewer's Shroud for visibility queries.
   *
   * OpenRA 对照: FrozenActor.shroud (private)
   */
  private readonly _shroud: IShroudForFrozenActor

  // -----------------------------------------------------------------------
  // Tooltips (captured from live actor)
  // -----------------------------------------------------------------------

  /** Tooltips captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.tooltips (private)
   */
  private readonly _tooltips: readonly ITooltipForFrozenActor[]

  // -----------------------------------------------------------------------
  // Health (captured from live actor)
  // -----------------------------------------------------------------------

  /** Health trait reference (may be null if actor has no health).
   *
   * OpenRA 对照: FrozenActor.health (private)
   */
  private readonly _health: IHealth | null

  // -----------------------------------------------------------------------
  // Visibility modifiers (captured from live actor)
  // -----------------------------------------------------------------------

  /** Visibility modifiers for refreshHidden().
   *
   * OpenRA 对照: FrozenActor.visibilityModifiers (private)
   */
  private readonly _visibilityModifiers: readonly IVisibilityModifier[]

  // -----------------------------------------------------------------------
  // Mutable state
  // -----------------------------------------------------------------------

  /** The actor's owner at snapshot time, or null if invalidated.
   *
   * OpenRA 对照: FrozenActor.Owner
   */
  Owner: PlayerStub | null = null

  /** Target types captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.TargetTypes
   */
  TargetTypes: ReadonlySet<string> = new Set()

  /** Targetable positions captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.targetablePositions (private)
   */
  private readonly _targetablePositions: WPos[] = []

  /** Tooltip info captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.TooltipInfo
   *
   * TODO-12.DEFERRED.14: Full ITooltipInfo integration.
   */
  TooltipInfo: ITooltipInfo | null = null

  /** Tooltip owner captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.TooltipOwner
   *
   * TODO-12.DEFERRED.14: Full tooltip owner integration.
   */
  TooltipOwner: PlayerStub | null = null

  /** Health points at snapshot time.
   *
   * OpenRA 对照: FrozenActor.HP
   */
  HP: number = 0

  /** Damage state at snapshot time.
   *
   * OpenRA 对照: FrozenActor.DamageState
   */
  DamageState: DamageState = DamageStateConst.Undamaged

  // -----------------------------------------------------------------------
  // Visibility state
  // -----------------------------------------------------------------------

  /** Whether the frozen actor is currently "visible" (under fog = not visible).
   *
   * OpenRA 对照: FrozenActor.Visible
   *
   * When Visible is true, the live actor is hidden by FrozenUnderFog and the
   * frozen copy is rendered instead. When Visible is false, the live actor
   * is currently in visible range and the frozen copy is not rendered.
   */
  Visible: boolean = true

  /** Whether the actor is hidden by a visibility modifier.
   *
   * OpenRA 对照: FrozenActor.Hidden
   *
   * Covers the edge case where the backing actor was last "seen" but not
   * actually visible because a visibility modifier hid it.
   */
  Hidden: boolean = false

  /** Whether the frozen actor is fully shrouded (all cells hidden).
   *
   * OpenRA 对照: FrozenActor.Shrouded
   */
  Shrouded: boolean = false

  /** Whether renderables need to be captured on next update.
   *
   * OpenRA 对照: FrozenActor.NeedRenderables
   */
  NeedRenderables: boolean

  /** Whether to update visibility on next tick.
   *
   * OpenRA 对照: FrozenActor.UpdateVisibilityNextTick
   */
  UpdateVisibilityNextTick: boolean = false

  // -----------------------------------------------------------------------
  // Renderable data (deferred)
  // -----------------------------------------------------------------------

  /** Captured renderables for rendering the frozen actor.
   *
   * OpenRA 对照: FrozenActor.Renderables
   *
   * TODO-12.DEFERRED.13: Renderable capture and rendering.
   */
  Renderables: readonly IRenderable[] = []

  /** Captured screen bounds.
   *
   * OpenRA 对照: FrozenActor.ScreenBounds
   *
   * TODO-12.DEFERRED.12: Screen bounds computation.
   */
  ScreenBounds: readonly Rectangle[] = []

  /** Captured mouse bounds.
   *
   * OpenRA 对照: FrozenActor.MouseBounds
   *
   * TODO-12.DEFERRED.12: Polygon migration.
   */
  MouseBounds: PolygonStub = EmptyPolygon

  // -----------------------------------------------------------------------
  // Flash state (deferred)
  // -----------------------------------------------------------------------

  // TODO-12.DEFERRED.11: Flash() tint animation.
  // When implemented:
  //   private _flashTicks: number = 0
  //   private _flashModifiers: TintModifiers
  //   private _flashTint: { r: number; g: number; b: number }
  //   private _flashAlpha: number | null

  // -----------------------------------------------------------------------
  // Static defaults
  // -----------------------------------------------------------------------

  private static readonly _noRenderables: readonly IRenderable[] = []

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Create a FrozenActor snapshot from a live actor.
   *
   * OpenRA 对照: FrozenActor(Actor, ICreatesFrozenActors, PPos[], Player, bool)
   *
   * @param actor — the live actor to snapshot
   * @param frozenTrait — the trait that created this frozen actor
   * @param footprint — the actor's projected cell footprint
   * @param viewer — the player who will view this frozen actor
   * @param startsRevealed — whether the actor starts in revealed state
   * @throws Error if the footprint is empty after filtering to shroud bounds
   */
  constructor(
    actor: IGameActor,
    frozenTrait: ICreatesFrozenActors,
    footprint: readonly PPos[],
    viewer: PlayerStub,
    startsRevealed: boolean,
  ) {
    this._actor = actor
    this._frozenTrait = frozenTrait
    this.Viewer = viewer
    this.NeedRenderables = startsRevealed

    // Get the viewer's shroud for visibility queries
    const viewerAny = viewer as unknown as Record<string, unknown>
    this._shroud = (viewerAny['shroud'] as IShroudForFrozenActor | undefined) ?? {
      contains: () => true,
      getVisibility: () => CellVisibility.Hidden,
    }

    // Consider all cells inside the map area
    this.Footprint = footprint.filter((m) => this._shroud.contains(m))

    if (this.Footprint.length === 0) {
      const actorInfo = actor.info
      const actorName = (actorInfo && 'name' in actorInfo
        ? (actorInfo as unknown as Record<string, unknown>)['name']
        : String(actor.actorId)) as string
      const footprintStr = footprint.map((p) => `${p.U},${p.V}`).join('|')
      throw new Error(
        `This frozen actor has no footprint.\n` +
        `Actor Name: ${actorName}\n` +
        `Actor Location: (unknown)\n` +
        `Input footprint: [${footprintStr}]`,
      )
    }

    this.CenterPosition = (actor as unknown as Record<string, unknown>)['centerPosition'] as WPos ?? WPos.Zero

    // Capture tooltips from live actor
    const tooltipTraits = (actor.traitsImplementing?.('ITooltip') as ITooltipForFrozenActor[] | undefined) ?? []
    this._tooltips = tooltipTraits

    // Capture health from live actor
    const healthTraits = (actor.traitsImplementing?.('IHealth') as IHealth[] | undefined) ?? []
    this._health = healthTraits.length > 0 ? healthTraits[0] : null

    // Capture visibility modifiers from live actor
    this._visibilityModifiers = (actor.traitsImplementing?.('IVisibilityModifier') as IVisibilityModifier[] | undefined) ?? []

    // Compute initial visibility
    this._updateVisibility()
  }

  // -----------------------------------------------------------------------
  // Computed properties
  // -----------------------------------------------------------------------

  /** Globally unique actor identifier.
   *
   * OpenRA 对照: FrozenActor.ID
   */
  get ID(): number {
    return this._actor.actorId
  }

  /** Whether this frozen actor is valid (has a non-null Owner).
   *
   * OpenRA 对照: FrozenActor.IsValid
   */
  get IsValid(): boolean {
    return this.Owner !== null
  }

  /** Convenience alias for IsValid (used by ScreenMap compatibility).
   *
   * OpenRA 对照: FrozenActor.IsValid (via ScreenMap FrozenActorStub)
   */
  get isValid(): boolean {
    return this.IsValid
  }

  /** Whether the frozen actor is currently visible.
   *
   * OpenRA 对照: FrozenActor.Visible (via ScreenMap FrozenActorStub)
   */
  get visible(): boolean {
    return this.Visible
  }

  /** Whether the frozen actor is hidden by a modifier.
   *
   * OpenRA 对照: FrozenActor.Hidden (via TraitsInterfaces FrozenActorStub)
   */
  get hidden(): boolean {
    return this.Hidden
  }

  /** Center position for compatibility with FrozenActorStub.
   *
   * OpenRA 对照: FrozenActor.CenterPosition
   */
  get centerPosition(): WPos {
    return this.CenterPosition
  }

  /** The actor's static type info.
   *
   * OpenRA 对照: FrozenActor.Info
   */
  get Info(): unknown {
    return this._actor.info
  }

  /** The live actor, or null if dead.
   *
   * OpenRA 对照: FrozenActor.Actor
   */
  get Actor(): IGameActor | null {
    return !this._actor.isDead ? this._actor : null
  }

  /** Whether this frozen actor has renderables to draw.
   *
   * OpenRA 对照: FrozenActor.HasRenderables
   */
  get HasRenderables(): boolean {
    return !this.Shrouded && this.Renderables.length > 0
  }

  /** Targetable positions captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.TargetablePositions
   */
  get TargetablePositions(): readonly WPos[] {
    return this._targetablePositions
  }

  // -----------------------------------------------------------------------
  // Mouse bounds / screen bounds (deferred stubs for ScreenMap compat)
  // -----------------------------------------------------------------------

  /** Mouse bounds for ScreenMap compatibility.
   *
   * OpenRA 对照: FrozenActor.MouseBounds
   *
   * TODO-12.DEFERRED.12: Real polygon implementation.
   */
  get mouseBounds(): PolygonStub {
    return this.MouseBounds
  }

  /** Screen bounds for ScreenMap compatibility.
   *
   * OpenRA 对照: FrozenActor.ScreenBounds
   *
   * TODO-12.DEFERRED.12: Real screen bounds computation.
   */
  get screenBounds(): readonly Rectangle[] {
    return this.ScreenBounds
  }

  // -----------------------------------------------------------------------
  // RefreshState
  // -----------------------------------------------------------------------

  /**
   * Refresh all state from the live actor.
   *
   * OpenRA 对照: FrozenActor.RefreshState()
   *
   * Updates Owner, TargetTypes, targetable positions, HP, DamageState,
   * and TooltipInfo from the live actor.
   */
  RefreshState(): void {
    const actor = this._actor

    // Update owner
    this.Owner = (actor as unknown as Record<string, unknown>)['owner'] as PlayerStub | null ?? null

    // Update target types
    const getEnabledTargetTypes = (actor as unknown as Record<string, unknown>)['getEnabledTargetTypes'] as
      (() => Set<string>) | undefined
    if (getEnabledTargetTypes) {
      this.TargetTypes = getEnabledTargetTypes.call(actor)
    }

    // Update targetable positions
    this._targetablePositions.length = 0
    const getTargetablePositions = (actor as unknown as Record<string, unknown>)['getTargetablePositions'] as
      (() => WPos[]) | undefined
    if (getTargetablePositions) {
      const positions = getTargetablePositions.call(actor)
      for (const pos of positions) {
        this._targetablePositions.push(pos)
      }
    }

    // Update health
    if (this._health) {
      this.HP = this._health.hp
      this.DamageState = this._health.damageState
    }

    // Update tooltip
    const firstEnabledTooltip = this._findFirstEnabledTooltip()
    if (firstEnabledTooltip) {
      this.TooltipInfo = firstEnabledTooltip.tooltipInfo ?? null
      this.TooltipOwner = firstEnabledTooltip.owner ?? null
    }
  }

  // -----------------------------------------------------------------------
  // RefreshHidden
  // -----------------------------------------------------------------------

  /**
   * Update the Hidden flag from visibility modifiers.
   *
   * OpenRA 对照: FrozenActor.RefreshHidden()
   *
   * Iterates all IVisibilityModifier traits on the live actor. If any
   * modifier reports the actor as invisible to the viewer, Hidden is set
   * to true.
   */
  RefreshHidden(): void {
    this.Hidden = false
    for (const modifier of this._visibilityModifiers) {
      if (!modifier.isVisible(this._actor, this.Viewer)) {
        this.Hidden = true
        break
      }
    }
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  /**
   * Per-tick update.
   *
   * OpenRA 对照: FrozenActor.Tick()
   *
   * Advances flash timer and processes deferred visibility updates.
   */
  Tick(): void {
    // TODO-12.DEFERRED.11: Flash tick advancement.
    // if (this._flashTicks > 0) this._flashTicks--

    if (this.UpdateVisibilityNextTick) {
      this._updateVisibility()
    }
  }

  // -----------------------------------------------------------------------
  // UpdateVisibility (private)
  // -----------------------------------------------------------------------

  /**
   * Recompute visibility state from the viewer's shroud.
   *
   * OpenRA 对照: FrozenActor.UpdateVisibility() (private)
   *
   * Iterates the footprint cells and checks their visibility in the viewer's
   * shroud. If any cell is Visible, the live actor is visible and the frozen
   * copy should be hidden (Visible = false). If no cell is Visible but at
   * least one is Explored, the frozen actor is not Shrouded.
   */
  private _updateVisibility(): void {
    this.UpdateVisibilityNextTick = false

    const wasVisible = this.Visible
    this.Shrouded = true
    this.Visible = true

    // PERF: Avoid LINQ — direct for loop.
    for (const puv of this.Footprint) {
      const cv = this._shroud.getVisibility(puv)
      if (cv & CellVisibility.Visible) {
        // Live actor is visible — hide the frozen copy
        this.Visible = false
        this.Shrouded = false
        break
      }

      if (this.Shrouded && (cv & CellVisibility.Explored)) {
        this.Shrouded = false
      }
    }

    // Force the backing trait to update so other actors can't
    // query inconsistent state (both hidden or both visible)
    if (this.Visible !== wasVisible) {
      this._frozenTrait.onVisibilityChanged(this)
    }

    this.NeedRenderables ||= this.Visible && !wasVisible
  }

  // -----------------------------------------------------------------------
  // Invalidate
  // -----------------------------------------------------------------------

  /**
   * Invalidate this frozen actor (actor destroyed or captured).
   *
   * OpenRA 对照: FrozenActor.Invalidate()
   *
   * Sets Owner to null, marking this frozen actor as invalid. Invalid
   * frozen actors are cleaned up in the next ITick.Tick() cycle.
   */
  Invalidate(): void {
    this.Owner = null
  }

  // -----------------------------------------------------------------------
  // Flash (deferred)
  // -----------------------------------------------------------------------

  /**
   * Flash the frozen actor with a color tint.
   *
   * OpenRA 对照: FrozenActor.Flash(Color, float)
   *
   * TODO-12.DEFERRED.11: Flash() tint animation.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Flash(_color: unknown, _alpha?: number): void {
    // TODO-12.DEFERRED.11: Implement flash effect.
  }

  // -----------------------------------------------------------------------
  // Render (deferred)
  // -----------------------------------------------------------------------

  /**
   * Get the renderables for this frozen actor.
   *
   * OpenRA 对照: FrozenActor.Render()
   *
   * TODO-12.DEFERRED.13: Renderable capture and rendering.
   * When implemented, this will return captured renderables with optional
   * flash tint applied on alternating ticks.
   */
  Render(): readonly IRenderable[] {
    // TODO-12.DEFERRED.13: Implement renderable capture.
    return FrozenActor._noRenderables
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Find the first enabled ITooltip trait on the live actor.
   *
   * OpenRA 对照: tooltips.FirstEnabledTraitOrDefault()
   */
  private _findFirstEnabledTooltip(): ITooltipForFrozenActor | null {
    for (const tooltip of this._tooltips) {
      // Check if the tooltip is enabled (not disabled)
      if (!tooltip.isTraitDisabled) {
        return tooltip
      }
    }
    return null
  }

  /**
   * String representation.
   *
   * OpenRA 对照: FrozenActor.ToString()
   */
  toString(): string {
    const info = this._actor.info
    const name = (info && 'name' in (info as unknown as Record<string, unknown>)
      ? (info as unknown as Record<string, unknown>)['name']
      : 'Unknown') as string
    return `${name} ${this.ID}${this.IsValid ? '' : ' (invalid)'}`
  }
}

// ---------------------------------------------------------------------------
// FrozenActorLayer (corresponds to OpenRA FrozenActorLayer)
// ---------------------------------------------------------------------------

/**
 * Per-player layer managing frozen actor snapshots.
 *
 * OpenRA 对照: FrozenActorLayer
 *
 * Implements IRender, ITick, ISync. Maintains a spatial index of frozen
 * actors and processes visibility updates driven by shroud changes.
 *
 * 3D migration: Frozen actors are rendered as static TransformNode clones
 * with StandardMaterial at alpha=0.5 (deferred to TODO-12.DEFERRED.13).
 */
export class FrozenActorLayer implements IRender, ITick, ISync {
  // -----------------------------------------------------------------------
  // ISync fields
  // -----------------------------------------------------------------------

  /** Sync hash for visibility state.
   *
   * OpenRA 对照: FrozenActorLayer.VisibilityHash ([VerifySync])
   */
  VisibilityHash: number = 0

  /** Sync hash for frozen actor count/state.
   *
   * OpenRA 对照: FrozenActorLayer.FrozenHash ([VerifySync])
   */
  FrozenHash: number = 0

  // -----------------------------------------------------------------------
  // Private fields
  // -----------------------------------------------------------------------

  private readonly _binSize: number
  private readonly _world: IWorldWithScreenMap
  private readonly _owner: PlayerStub
  private readonly _frozenActorsById = new Map<number, FrozenActor>()
  private readonly _partitionedFrozenActors: SpatiallyPartitioned<FrozenActor>

  /** Callback registered on Shroud.addOnShroudChanged. */
  private readonly _onShroudChanged: (puv: PPos) => void

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Create a FrozenActorLayer for a player actor.
   *
   * OpenRA 对照: FrozenActorLayer(Actor, FrozenActorLayerInfo)
   *
   * Subscribes to the player's Shroud.OnShroudChanged event. When a
   * shroud cell changes, all frozen actors at that cell are flagged
   * for visibility update on the next tick.
   *
   * @param self — the player actor
   * @param info — trait configuration
   */
  constructor(
    self: IGameActor,
    info: FrozenActorLayerInfo,
  ) {
    this._binSize = info.binSize
    this._owner = self.owner!

    // Access world with screenMap and map
    const worldAny = self.world as unknown as Record<string, unknown> | null | undefined
    this._world = (worldAny ?? {}) as unknown as IWorldWithScreenMap

    const mapSize = this._world.map?.mapSize ?? { width: 1, height: 1 }
    this._partitionedFrozenActors = new SpatiallyPartitioned<FrozenActor>(
      mapSize.width,
      mapSize.height,
      this._binSize,
    )

    // Subscribe to shroud changes
    const actorAny = self as unknown as Record<string, unknown>
    const shroudUntyped = actorAny['shroud'] as Record<string, unknown> | undefined
    const selfRef = this

    this._onShroudChanged = function (this: FrozenActorLayer, puv: PPos): void {
      const frozenAtCell = selfRef._partitionedFrozenActors.at(puv.U, puv.V)
      for (const fa of frozenAtCell) {
        fa.UpdateVisibilityNextTick = true
      }
    }.bind(this)

    if (shroudUntyped && typeof shroudUntyped['addOnShroudChanged'] === 'function') {
      ;(shroudUntyped['addOnShroudChanged'] as (cb: (puv: PPos) => void) => void)(this._onShroudChanged)
    }
  }

  // -----------------------------------------------------------------------
  // Add / Remove
  // -----------------------------------------------------------------------

  /**
   * Add a frozen actor to this layer.
   *
   * OpenRA 对照: FrozenActorLayer.Add(FrozenActor)
   *
   * Registers the frozen actor in the ID lookup, ScreenMap spatial index,
   * and internal partitioned index.
   *
   * @param fa — the frozen actor to add
   */
  Add(fa: FrozenActor): void {
    this._frozenActorsById.set(fa.ID, fa)
    this._world.screenMap.addOrUpdate(this._owner, fa)
    this._partitionedFrozenActors.add(fa, FrozenActorLayer.FootprintBounds(fa))
  }

  /**
   * Remove a frozen actor from this layer.
   *
   * OpenRA 对照: FrozenActorLayer.Remove(FrozenActor)
   *
   * Removes the frozen actor from the partitioned index, ScreenMap, and
   * ID lookup.
   *
   * @param fa — the frozen actor to remove
   */
  Remove(fa: FrozenActor): void {
    this._partitionedFrozenActors.remove(fa)
    this._world.screenMap.remove(this._owner, fa)
    this._frozenActorsById.delete(fa.ID)
  }

  // -----------------------------------------------------------------------
  // FootprintBounds (static)
  // -----------------------------------------------------------------------

  /**
   * Compute the bounding rectangle of a frozen actor's footprint.
   *
   * OpenRA 对照: FrozenActorLayer.FootprintBounds(FrozenActor)
   *
   * Computes the min/max U/V from the footprint PPos array and returns
   * a Rectangle covering those cells (with max+1 for exclusive bounds).
   *
   * @param fa — the frozen actor
   * @returns bounding rectangle in projected cell coordinates
   */
  static FootprintBounds(fa: FrozenActor): Rectangle {
    const footprint = fa.Footprint
    const p0 = footprint[0]
    let minU = p0.U
    let maxU = p0.U
    let minV = p0.V
    let maxV = p0.V

    // PERF: Direct loop, no LINQ/forEach allocation.
    for (const p of footprint) {
      if (minU > p.U) minU = p.U
      else if (maxU < p.U) maxU = p.U

      if (minV > p.V) minV = p.V
      else if (maxV < p.V) maxV = p.V
    }

    return Rectangle.fromLTRB(minU, minV, maxU + 1, maxV + 1)
  }

  // -----------------------------------------------------------------------
  // ITick (tick)
  // -----------------------------------------------------------------------

  /**
   * Per-tick update for the frozen actor layer.
   *
   * OpenRA 对照: ITick.Tick(Actor) (explicit implementation)
   *
   * Iterates all frozen actors, calls Tick() on each, computes sync hashes,
   * and removes invalidated frozen actors whose live actor is dead.
   *
   * @param self — the player actor
   */
  tick(self: IGameActor): void {
    void self as unknown // suppress TS6133 (ITick interface requires parameter)

    const frozenActorsToRemove: FrozenActor[] = []

    let visibilityHash = 0
    let frozenHash = 0

    for (const [id, frozenActor] of this._frozenActorsById) {
      const hash = (id & 0xffffffff) >>> 0
      frozenHash += hash

      frozenActor.Tick()

      if (frozenActor.Visible) {
        visibilityHash += hash
      } else if (frozenActor.Actor === null) {
        frozenActorsToRemove.push(frozenActor)
      }
    }

    this.VisibilityHash = visibilityHash
    this.FrozenHash = frozenHash

    for (const fa of frozenActorsToRemove) {
      this.Remove(fa)
    }
  }

  // -----------------------------------------------------------------------
  // IRender (render)
  // -----------------------------------------------------------------------

  /**
   * Render all visible frozen actors.
   *
   * OpenRA 对照: IRender.Render(Actor, WorldRenderer)
   *
   * Queries the ScreenMap for frozen actors within the current viewport
   * and returns their renderables. Only Visible frozen actors are included.
   *
   * @param self — the player actor
   * @param wr — the world renderer (provides viewport bounds)
   * @returns renderables for all visible frozen actors in the viewport
   */
  render(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[] {
    void self as unknown // suppress TS6133 (IRender interface requires parameter)

    const wrAny = wr as unknown as Record<string, unknown>
    const viewport = wrAny['viewport'] as Record<string, unknown> | undefined
    const topLeft = (viewport?.['topLeft'] ?? { x: 0, y: 0 }) as { x: number; y: number }
    const bottomRight = (viewport?.['bottomRight'] ?? { x: 0, y: 0 }) as { x: number; y: number }

    const results: IRenderable[] = []

    // Query ScreenMap for frozen actors in the current viewport
    const frozenInBox = this._world.screenMap.renderableFrozenActorsInBox(
      this._owner,
      topLeft,
      bottomRight,
    )

    for (const fa of frozenInBox) {
      if (!fa.Visible) continue
      const faRender = fa.Render()
      for (const r of faRender) {
        results.push(r)
      }
    }

    return results
  }

  /**
   * Get screen bounds for the layer (empty — player traits don't need them).
   *
   * OpenRA 对照: IRender.ScreenBounds(Actor, WorldRenderer)
   */
  screenBounds(_self: IGameActor, _wr: WorldRendererStub): readonly RectangleStub[] {
    // Player-actor render traits don't require screen bounds
    return FrozenActorLayer._emptyBounds
  }

  private static readonly _emptyBounds: readonly RectangleStub[] = []

  // -----------------------------------------------------------------------
  // FromID
  // -----------------------------------------------------------------------

  /**
   * Look up a frozen actor by its live actor's ID.
   *
   * OpenRA 对照: FrozenActorLayer.FromID(uint)
   *
   * @param id — the actor ID to look up
   * @returns the FrozenActor if found, null otherwise
   */
  FromID(id: number): FrozenActor | null {
    return this._frozenActorsById.get(id) ?? null
  }

  // -----------------------------------------------------------------------
  // FrozenActorsInRegion
  // -----------------------------------------------------------------------

  /**
   * Get all frozen actors in a cell region.
   *
   * OpenRA 对照: FrozenActorLayer.FrozenActorsInRegion(CellRegion, bool)
   *
   * Queries the spatial partition for frozen actors whose footprint
   * intersects the given cell region.
   *
   * @param region — the cell region to query
   * @param onlyVisible — if true (default), only return visible frozen actors
   * @returns frozen actors in the region
   */
  FrozenActorsInRegion(
    region: CellRegion,
    onlyVisible: boolean = true,
  ): FrozenActor[] {
    const tl = region.TopLeft
    const br = region.BottomRight
    const box = Rectangle.fromLTRB(tl.X, tl.Y, br.X, br.Y)
    return this._partitionedFrozenActors
      .inBox(box)
      .filter((fa) => fa.IsValid && (!onlyVisible || fa.Visible))
  }

  // -----------------------------------------------------------------------
  // FrozenActorsInCircle
  // -----------------------------------------------------------------------

  /**
   * Get all frozen actors within a circular range of a world position.
   *
   * OpenRA 对照: FrozenActorLayer.FrozenActorsInCircle(World, WPos, WDist, bool)
   *
   * Target ranges are calculated in 2D (ignoring height differences).
   *
   * @param world — the world (provides map cell lookup)
   * @param origin — the center of the search circle
   * @param r — the search radius
   * @param onlyVisible — if true (default), only return visible frozen actors
   * @returns frozen actors within the circle
   */
  FrozenActorsInCircle(
    world: WorldStub,
    origin: WPos,
    r: WDist,
    onlyVisible: boolean = true,
  ): FrozenActor[] {
    // NOTE: Accessing map.cellContaining via untyped world reference.
    const worldAny = world as unknown as Record<string, unknown>
    const map = worldAny['map'] as Record<string, unknown> | undefined

    // Compute the cell containing the origin, then expand by radius in cells
    let centerCellX = 0
    let centerCellY = 0
    if (map && typeof map['cellContaining'] === 'function') {
      const cell = (map['cellContaining'] as (pos: WPos) => { X: number; Y: number })(origin)
      centerCellX = cell.X
      centerCellY = cell.Y
    }

    const cellRange = ((r.length + 1023) / 1024) | 0
    const tl = { X: centerCellX - cellRange, Y: centerCellY - cellRange }
    const br = { X: centerCellX + cellRange, Y: centerCellY + cellRange }

    // Target ranges are calculated in 2D, so ignore height differences
    const rSquared = r.lengthSquared

    return this._partitionedFrozenActors
      .inBox(Rectangle.fromLTRB(tl.X, tl.Y, br.X, br.Y))
      .filter((fa) => {
        if (!fa.IsValid) return false
        if (onlyVisible && !fa.Visible) return false

        // 2D distance check (ignoring Z height)
        const dx = fa.CenterPosition.X - origin.X
        const dy = fa.CenterPosition.Y - origin.Y
        return (dx * dx + dy * dy) <= rSquared
      })
  }
}

// ---------------------------------------------------------------------------
// Internal interface: IShroudForFrozenActor
// ---------------------------------------------------------------------------

/**
 * Minimal shroud interface for FrozenActor visibility queries.
 *
 * OpenRA 对照: Shroud (subset used by FrozenActor)
 */
interface IShroudForFrozenActor {
  contains(puv: PPos): boolean
  getVisibility(puv: PPos): number
}

// ---------------------------------------------------------------------------
// Internal interface: ITooltipForFrozenActor
// ---------------------------------------------------------------------------

/**
 * Minimal tooltip interface for FrozenActor.
 *
 * OpenRA 对照: ITooltip (subset used by FrozenActor)
 *
 * TODO-12.DEFERRED.14: Full ITooltip integration.
 */
interface ITooltipForFrozenActor {
  readonly tooltipInfo: ITooltipInfo | null
  readonly owner: PlayerStub | null
  readonly isTraitDisabled: boolean
}
