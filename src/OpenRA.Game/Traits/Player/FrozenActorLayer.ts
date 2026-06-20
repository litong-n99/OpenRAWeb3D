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
 * - C# Polygon → src/OpenRA.Game/Primitives/Polygon.ts (P1-C.3 COMPLETE)
 * - C# Flash() tint animation → implemented (P1-C.1 COMPLETE)
 * - C# ITooltipInfo / tooltip delegation → implemented (P1-C.6 COMPLETE)
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
import { Polygon } from '../../Primitives/Polygon'
import type { CellRegion } from '../../Map/CellRegion'
import { CellVisibility } from './Shroud'

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
   * Populated in RefreshState() from the first enabled ITooltip trait.
   * When null (no tooltip trait on live actor), tooltipText returns
   * the fallback "Fogged Unit" string.
   */
  TooltipInfo: ITooltipInfo | null = null

  /** Tooltip owner captured from the live actor.
   *
   * OpenRA 对照: FrozenActor.TooltipOwner
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
  NeedRenderables: boolean = false

  /** Whether to update visibility on next tick.
   *
   * OpenRA 对照: FrozenActor.UpdateVisibilityNextTick
   */
  UpdateVisibilityNextTick: boolean = false

  // -----------------------------------------------------------------------
  // Renderable data
  // -----------------------------------------------------------------------

  /** Captured renderables for rendering the frozen actor.
   *
   * OpenRA 对照: FrozenActor.Renderables
   *
   * Populated by FrozenUnderFog.tickRender() when the live actor
   * transitions from visible to fogged.
   *
   * TODO-12.DEFERRED.13: Full IRenderable integration with
   * IModifyableRenderable.WithTint/WithAlpha for Flash() rendering.
   */
  Renderables: readonly IRenderable[] = []

  /** Captured screen bounds for each renderable.
   *
   * OpenRA 对照: FrozenActor.ScreenBounds
   *
   * Populated by FrozenUnderFog.tickRender().
   */
  ScreenBounds: readonly Rectangle[] = []

  /** Captured mouse bounds for hit-testing.
   *
   * OpenRA 对照: FrozenActor.MouseBounds
   *
   * Populated by FrozenUnderFog.tickRender(). Uses {@link Polygon}
   * (P1-C.3) for point-in-polygon cursor hit-testing.
   */
  MouseBounds: Polygon = Polygon.Empty

  // -----------------------------------------------------------------------
  // Flash state
  // -----------------------------------------------------------------------

  /**
   * Remaining flash ticks. Decremented each Tick().
   *
   * OpenRA 对照: FrozenActor.flashTicks (private)
   *
   * When > 0, the frozen actor is in flash animation mode.
   * On even ticks, tinted copies of Renderables are overlaid.
   */
  private _flashTicks: number = 0

  /**
   * RGB flash tint (normalized 0-1 or 0-255 depending on Flash() overload).
   *
   * OpenRA 对照: FrozenActor.flashTint (private)
   */
  private _flashTint: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }

  /**
   * Optional alpha override for flash overlay.
   *
   * OpenRA 对照: FrozenActor.flashAlpha (private)
   *
   * Set by the Color+alpha Flash() overload. null means no alpha override.
   */
  private _flashAlpha: number | null = null

  /**
   * Flash tint modifier flags.
   *
   * OpenRA 对照: FrozenActor.flashModifiers (TintModifiers)
   *
   * TintModifiers is a flags enum:
   *   None = 0, ReplaceColor = 1, IgnoreWorldTint = 2
   *
   * Set by Flash(): ReplaceColor for the Color+alpha overload,
   * None for the float3 tint overload.
   */
  private _flashModifiers: number = 0

  /**
   * Snapshot of the material's original emissive color captured on the
   * first flash ON cycle. Used to restore emissive during OFF cycles
   * so that multiplicative flash tint works correctly on repeat blinks.
   *
   * null when not flashing, or after flash expiry.
   */
  private _savedEmissive: { r: number; g: number; b: number } | null = null

  // -----------------------------------------------------------------------
  // Static defaults
  // -----------------------------------------------------------------------

  private static readonly _noRenderables: readonly IRenderable[] = []

  /** Frozen black emissive constant (no per-frame allocation). */
  private static readonly _BLACK_EMISSIVE = Object.freeze({ r: 0, g: 0, b: 0 })

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

  /** The player who views this frozen actor (camelCase for IFrozenActorRef).
   *
   * OpenRA 对照: FrozenActor.Viewer
   */
  get viewer(): PlayerStub {
    return this.Viewer
  }

  /** Center position for compatibility with FrozenActorStub.
   *
   * OpenRA 对照: FrozenActor.CenterPosition
   */
  get centerPosition(): WPos {
    return this.CenterPosition
  }

  /** Recompute Hidden flag from visibility modifiers (camelCase for IFrozenActorRef).
   *
   * OpenRA 对照: FrozenActor.RefreshHidden()
   *
   * @returns void
   */
  refreshHidden(): void {
    this.RefreshHidden()
  }

  /** Refresh all state from the live actor (camelCase for IFrozenActorRef).
   *
   * OpenRA 对照: FrozenActor.RefreshState()
   *
   * @returns void
   */
  refreshState(): void {
    this.RefreshState()
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
  // Mouse bounds / screen bounds / tooltip (for ScreenMap + widget compat)
  // -----------------------------------------------------------------------

  /** Mouse bounds for ScreenMap compatibility.
   *
   * OpenRA 对照: FrozenActor.MouseBounds
   *
   * Returns the captured mouse bounds polygon. Populated by
   * FrozenUnderFog.tickRender(). Supports point-in-polygon cursor
   * hit-testing via {@link Polygon.contains}.
   */
  get mouseBounds(): Polygon {
    return this.MouseBounds
  }

  /** Screen bounds for ScreenMap compatibility.
   *
   * OpenRA 对照: FrozenActor.ScreenBounds
   *
   * Returns the captured screen bounds rectangles. Populated by
   * FrozenUnderFog.tickRender().
   */
  get screenBounds(): readonly Rectangle[] {
    return this.ScreenBounds
  }

  /**
   * Tooltip name — the live actor's name used for tooltip display.
   *
   * OpenRA 对照: FrozenActor.Info.Name (via tooltip system)
   *
   * Delegates to the live actor's Info.name. When the live actor has been
   * deleted, returns "Fogged Unit".
   */
  get tooltipName(): string {
    const info = this._actor.info
    if (info && 'name' in (info as unknown as Record<string, unknown>)) {
      return (info as unknown as Record<string, unknown>)['name'] as string
    }
    return 'Fogged Unit'
  }

  /**
   * Tooltip description text for a given player stance.
   *
   * OpenRA 对照: ITooltipInfo.tooltipForPlayerStance(PlayerRelationship)
   *
   * Delegates to the captured TooltipInfo if available. Otherwise returns
   * a generic "Fogged Unit" string.
   *
   * @param stance — the relationship between viewing player and owner
   * @returns tooltip description text
   */
  getTooltipText(stance?: unknown): string {
    if (this.TooltipInfo) {
      return this.TooltipInfo.tooltipForPlayerStance(stance as Parameters<
        ITooltipInfo['tooltipForPlayerStance']
      >[0])
    }
    return 'Fogged Unit'
  }

  /**
   * Whether the frozen actor's tooltip info includes the owner row.
   *
   * OpenRA 对照: ITooltipInfo.IsOwnerRowVisible
   *
   * Delegates to the captured TooltipInfo.isOwnerRowVisible.
   */
  get tooltipOwnerRowVisible(): boolean {
    return this.TooltipInfo?.isOwnerRowVisible ?? false
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
   * Flash ticks are decremented each frame; when they reach zero the
   * flash effect ends.
   *
   * On even-numbered remaining ticks, the flash tint is applied to
   * captured renderables' materials (blink ON phase). On odd-numbered
   * remaining ticks, the tint is reverted (blink OFF phase).
   *
   * @returns void
   */
  Tick(): void {
    if (this._flashTicks > 0) {
      this._flashTicks--

      if (this.isFlashing) {
        // Even ticks — apply flash tint (blink ON)
        this._applyFlashTint()
      } else {
        // Odd ticks or zero — revert flash tint (blink OFF)
        this._revertFlashTint()
      }
    }

    // Reset saved emissive when flash fully expires so the next Flash()
    // call captures a fresh original.
    if (this._flashTicks === 0 && this._savedEmissive !== null) {
      this._savedEmissive = null
    }

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
  // Flash
  // -----------------------------------------------------------------------

  /**
   * Flash the frozen actor with a color tint and alpha.
   *
   * OpenRA 对照: FrozenActor.Flash(Color, float)
   *
   * Sets 5 frames of flash with ReplaceColor tint modifier. The color
   * components are divided by 255 (C# Color range → normalized 0-1).
   * On even-numbered remaining ticks, tinted copies of renderables are
   * overlaid on top of the original renderables.
   *
   * @param color — RGBA color object with r, g, b in 0-255 range
   * @param alpha — alpha override value (0-1)
   */
  Flash(color: { r: number; g: number; b: number }, alpha: number): void

  /**
   * Flash the frozen actor with a multiplicative tint (no alpha).
   *
   * OpenRA 对照: FrozenActor.Flash(float3)
   *
   * Sets 5 frames of flash with TintModifiers.None (multiplicative).
   * The tint values are used as-is (already normalized).
   *
   * @param tint — RGB tint with r, g, b components (normalized 0-1 range)
   */
  Flash(tint: { r: number; g: number; b: number }): void

  /**
   * Implementation — dispatches based on whether alpha is provided.
   *
   * @param arg — color or tint object
   * @param alpha — if provided, treat arg as Color (divide by 255)
   */
  Flash(
    arg: { r: number; g: number; b: number },
    alpha?: number,
  ): void {
    this._savedEmissive = null
    this._flashTicks = 5

    if (alpha !== undefined) {
      // Overload 1: Flash(Color, float alpha)
      this._flashModifiers = 1 // TintModifiers.ReplaceColor
      this._flashTint = {
        r: arg.r / 255,
        g: arg.g / 255,
        b: arg.b / 255,
      }
      this._flashAlpha = alpha
    } else {
      // Overload 2: Flash(float3 tint)
      this._flashModifiers = 0 // TintModifiers.None
      this._flashTint = { r: arg.r, g: arg.g, b: arg.b }
      this._flashAlpha = null
    }
  }

  /**
   * Whether the flash effect is currently active (on-screen).
   *
   * OpenRA 对照: render-time check `flashTicks > 0 && flashTicks % 2 == 0`
   *
   * Flash toggles on off-tick boundaries for a blinking effect.
   */
  get isFlashing(): boolean {
    return this._flashTicks > 0 && this._flashTicks % 2 === 0
  }

  /**
   * Get the current flash tint (or null if not flashing).
   */
  get flashTint(): { r: number; g: number; b: number } | null {
    return this.isFlashing ? this._flashTint : null
  }

  /**
   * Get the current flash alpha (or null if not set).
   */
  get flashAlpha(): number | null {
    return this.isFlashing ? this._flashAlpha : null
  }

  /**
   * Get the current flash tint modifier flags.
   *
   * OpenRA 对照: FrozenActor.flashModifiers (TintModifiers)
   *
   * Returns TintModifiers.ReplaceColor (1) for Flash(Color, alpha),
   * TintModifiers.None (0) for Flash(float3), or 0 if not flashing.
   */
  get flashModifiers(): number {
    return this.isFlashing ? this._flashModifiers : 0
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  /**
   * Get the renderables for this frozen actor.
   *
   * OpenRA 对照: FrozenActor.Render()
   *
   * Returns captured renderables. When the flash effect is active on
   * even-numbered remaining ticks, tinted copies of non-decoration
   * renderables are overlaid on top of the originals (blinking).
   *
   * NOTE: Full IModifyableRenderable.WithTint/WithAlpha integration is
   * deferred to TODO-12.DEFERRED.13. Currently the flash state is
   * tracked and exposed via isFlashing/flashTint/flashAlpha properties
   * so consumers can apply the visual effect externally.
   *
   * @returns captured renderables (possibly with flash overlay)
   */
  Render(): readonly IRenderable[] {
    if (this.Shrouded) {
      return FrozenActor._noRenderables
    }

    const renderables = this.Renderables

    // If flash is active, return renderables + flash indicator.
    // Full IModifyableRenderable integration is deferred; external
    // renderers should check isFlashing/flashTint/flashAlpha.
    if (this.isFlashing) {
      // NOTE: In OpenRA C#, Render() concatenates the original renderables
      // with tinted copies of non-decoration IModifyableRenderable items.
      // The tinted copies use WithTint(flashTint, originalModifiers | flashModifiers)
      // and optionally WithAlpha(flashAlpha).
      //
      // For now, return the captured renderables; the flash state is
      // accessible via the public isFlashing/flashTint/flashAlpha properties.
      return renderables
    }

    return renderables
  }

  // -----------------------------------------------------------------------
  // Flash tinting (private)
  // -----------------------------------------------------------------------

  /**
   * Apply flash tint to captured renderables' materials.
   *
   * OpenRA 对照: FrozenActor.Render() flash overlay logic
   *
   * Uses duck-typing to access material properties on renderables
   * without importing @babylonjs/core. Each renderable is treated as
   * a generic object; if it has a `material` property with
   * `emissiveColor` and `alpha`, those are mutated to show the flash.
   *
   * Called from Tick() on even-numbered remaining flash ticks
   * (blink ON phase).
   */
  private _applyFlashTint(): void {
    const tint = this._flashTint
    const alpha = this._flashAlpha
    const isReplaceColor = this._flashModifiers === 1 // TintModifiers.ReplaceColor
    const isInitialApply = this._savedEmissive === null

    for (const r of this.Renderables) {
      const mesh = r as unknown as Record<string, unknown>
      const material = mesh['material'] as Record<string, unknown> | undefined
      if (!material) continue

      // Snapshot the original emissive on the first ON cycle so that
      // subsequent OFF→ON cycles use the same base value. Without this,
      // a prior _revertFlashTint set emissive to {0,0,0} and the second
      // blink would multiply by zero, producing no visible flash.
      if (isInitialApply) {
        const existing = (material['emissiveColor'] as { r: number; g: number; b: number } | undefined)
          ?? FrozenActor._BLACK_EMISSIVE
        this._savedEmissive = { r: existing.r, g: existing.g, b: existing.b }
      }

      if (isReplaceColor) {
        // ReplaceColor: set emissive directly to tint color
        material['emissiveColor'] = { r: tint.r, g: tint.g, b: tint.b }
      } else {
        // Multiplicative tint: multiply the SAVED original by tint (not
        // the current value, which may have been zeroed by _revertFlashTint).
        material['emissiveColor'] = {
          r: this._savedEmissive!.r * tint.r,
          g: this._savedEmissive!.g * tint.g,
          b: this._savedEmissive!.b * tint.b,
        }
      }

      if (alpha !== null) {
        material['alpha'] = alpha
      }
    }
  }

  /**
   * Revert flash tint on captured renderables' materials.
   *
   * OpenRA 对照: FrozenActor.Render() — flash expiry cleanup
   *
   * Resets material.emissiveColor to black (no emission) and
   * material.alpha to 1.0 (fully opaque). Called from Tick() on
   * odd-numbered remaining flash ticks (blink OFF phase) and when
   * flash expires.
   */
  private _revertFlashTint(): void {
    for (const r of this.Renderables) {
      const mesh = r as unknown as Record<string, unknown>
      const material = mesh['material'] as Record<string, unknown> | undefined
      if (!material) continue

      // Restore original emissive (or black if none was captured).
      // Using the saved original ensures subsequent ON cycles have a
      // non-zero base for multiplicative tinting.
      const restoreColor = this._savedEmissive ?? FrozenActor._BLACK_EMISSIVE
      material['emissiveColor'] = { r: restoreColor.r, g: restoreColor.g, b: restoreColor.b }

      // Only revert alpha if we actually modified it during apply.
      // Unconditionally setting alpha=1 would corrupt a frozen actor's
      // custom alpha when Flash(float3) (no alpha) was used.
      if (this._flashAlpha !== null) {
        material['alpha'] = 1.0
      }
    }
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
    // C# [TraitLocation(SystemActors.Player)] guarantees owner is non-null
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

    // NOTE: Arrow function captures `this` lexically — no need for
    // selfRef + bind(this) pattern.
    this._onShroudChanged = (puv: PPos): void => {
      const frozenAtCell = this._partitionedFrozenActors.at(puv.U, puv.V)
      for (const fa of frozenAtCell) {
        fa.UpdateVisibilityNextTick = true
      }
    }

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
