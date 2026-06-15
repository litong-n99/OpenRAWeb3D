/**
 * FrozenUnderFog.ts — Building freeze-under-fog behavior (creates frozen actor snapshots)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.cs
 *
 * 核心范式转换:
 * - C# PlayerDictionary<FrozenState> → Map<PlayerStub, FrozenState> (O(1) lookup)
 * - C# IRenderable capture (self.Render(wr).ToArray()) → deferred (TODO-12.DEFERRED.13)
 * - C# SpriteRenderable.None render modifier → empty renderables (TODO-12.DEFERRED.13)
 * - C# ShroudExts.AnyExplored(footprint) → inline _anyExplored() helper
 * - C# event-driven visibility → direct FrozenActorLayer interaction
 * - C# startsRevealed exploration check → deferred (TODO-12.A.6.1)
 */

import { PPos, MPos } from '../../../OpenRA.Game/MPos'
import { CPos } from '../../../OpenRA.Game/CPos'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import {
  PlayerRelationship,
  PlayerRelationshipExts,
  type IGameActor,
  type PlayerStub,
  type ISync,
  type INotifyCreated,
  type INotifyActorDisposing,
  type INotifyOwnerChanged,
  type IDefaultVisibility,
  type IDefaultVisibilityInfo,
  type ITickRender,
  type IRenderModifier,
  type ICreatesFrozenActors,
  type IFrozenActorRef,
  type IRenderable,
  type WorldRendererStub,
  type RectangleStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import { FrozenActor, type FrozenActorLayer } from '../../../OpenRA.Game/Traits/Player/FrozenActorLayer'
import type { Shroud } from '../../../OpenRA.Game/Traits/Player/Shroud'

// ---------------------------------------------------------------------------
// FrozenState — nested class for per-player frozen actor + visibility
// ---------------------------------------------------------------------------

/**
 * Per-player state for a frozen-under-fog building.
 *
 * OpenRA 对照: FrozenUnderFog.FrozenState (sealed class)
 */
class FrozenState {
  /** The frozen actor snapshot for this player.
   *
   * OpenRA 对照: FrozenState.FrozenActor
   */
  readonly frozenActor: FrozenActor

  /** The player's index in the world players array (for VisibilityHash bit).
   *
   * Stored at construction time to enable O(1) Map lookup while retaining
   * the player index needed for sync hash computation.
   */
  readonly playerIndex: number

  /** Whether the live actor is currently visible to this player.
   *
   * OpenRA 对照: FrozenState.IsVisible
   *
   * NOTE: This is the INVERSE of FrozenActor.Visible. When IsVisible is true,
   * the live actor is visible and the frozen copy should be hidden. When
   * IsVisible is false, the live actor is hidden (under fog) and the frozen
   * copy should be rendered.
   */
  isVisible: boolean = false

  constructor(frozenActor: FrozenActor, playerIndex: number) {
    this.frozenActor = frozenActor
    this.playerIndex = playerIndex
    this.isVisible = !frozenActor.Visible
  }
}

// ---------------------------------------------------------------------------
// FrozenUnderFogInfo (对应 OpenRA FrozenUnderFogInfo)
// ---------------------------------------------------------------------------

/**
 * Trait info for FrozenUnderFog.
 *
 * OpenRA 对照: FrozenUnderFogInfo (TraitInfo, Requires<BuildingInfo>, IDefaultVisibilityInfo)
 *
 * This trait requires BuildingInfo — it only works on buildings (Requires<BuildingInfo>).
 */
export class FrozenUnderFogInfo implements IDefaultVisibilityInfo {
  /** Players with these relationships can always see the actor.
   *
   * OpenRA 对照: FrozenUnderFogInfo.AlwaysVisibleRelationships
   *
   * Default: Ally (allies can always see the building, even under fog).
   */
  readonly alwaysVisibleRelationships: PlayerRelationship = PlayerRelationship.Ally
}

// ---------------------------------------------------------------------------
// FrozenUnderFog (对应 OpenRA FrozenUnderFog)
// ---------------------------------------------------------------------------

/**
 * Trait for buildings that freeze when they enter fog of war.
 *
 * OpenRA 对照: FrozenUnderFog
 *
 * This trait bridges live actors and the {@link FrozenActorLayer}. When an
 * enemy building leaves a player's visible range, its last-known state is
 * captured in a {@link FrozenActor} and rendered with reduced opacity.
 *
 * Implements:
 * - {@link ICreatesFrozenActors}: callback from FrozenActorLayer on visibility change
 * - {@link IRenderModifier}: hides live actor when frozen copy is visible
 * - {@link IDefaultVisibility}: determines if the actor is visible to a given player
 * - {@link ITickRender}: captures renderables for frozen actor snapshots
 * - {@link ISync}: participates in network sync hash via VisibilityHash
 * - {@link INotifyCreated}: initializes frozen actors on creation
 * - {@link INotifyOwnerChanged}: updates frozen actor on ownership change
 * - {@link INotifyActorDisposing}: invalidates frozen actor on disposal
 */
export class FrozenUnderFog
  implements
    ICreatesFrozenActors,
    IRenderModifier,
    IDefaultVisibility,
    ITickRender,
    ISync,
    INotifyCreated,
    INotifyOwnerChanged,
    INotifyActorDisposing
{
  // -------------------------------------------------------------------------
  // ISync: VisibilityHash
  // -------------------------------------------------------------------------

  /**
   * Bit hash of visibility per player (for network sync).
   *
   * OpenRA 对照: FrozenUnderFog.VisibilityHash ([VerifySync])
   *
   * Each player sets their bit via: `VisibilityHash |= 1 << (playerIndex % 32)`
   */
  VisibilityHash: number = 0

  // -------------------------------------------------------------------------
  // Private fields
  // -------------------------------------------------------------------------

  /** Trait configuration. */
  private readonly _info: FrozenUnderFogInfo

  /**
   * Whether the actor starts revealed.
   *
   * TODO-12.A.6.1: Implement startsRevealed when SpawnedByMapInit/HiddenUnderFogInit
   * and LobbyInfo are migrated. Currently always false.
   */
  private readonly _startsRevealed: boolean = false

  /** The actor's projected cell footprint. */
  private readonly _footprint: readonly PPos[]

  /** Per-player frozen state, keyed by player for O(1) lookup. */
  private _frozenStates: Map<PlayerStub, FrozenState> | null = null

  /** Guard flag — true while capturing renderables in tickRender. */
  private _isRendering: boolean = false

  /** Whether created() has been called. */
  private _created: boolean = false

  // -------------------------------------------------------------------------
  // Static constants
  // -------------------------------------------------------------------------

  /** Pre-allocated empty renderable array — avoids per-frame allocation. */
  private static readonly _emptyRenderables: readonly IRenderable[] = []

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA FrozenUnderFog constructor)
  // -------------------------------------------------------------------------

  /**
   * Create the FrozenUnderFog trait.
   *
   * OpenRA 对照: FrozenUnderFog(ActorInitializer, FrozenUnderFogInfo)
   *
   * Computes the actor's projected cell footprint from the BuildingInfo
   * footprint and the map's cell projection.
   *
   * @param info — trait configuration
   * @param self — the actor this trait is attached to
   */
  constructor(info: FrozenUnderFogInfo, self: IGameActor) {
    this._info = info

    const actorAny = self as unknown as Record<string, unknown>
    const worldAny = actorAny['world'] as Record<string, unknown> | undefined
    const map = worldAny?.['map'] as Record<string, unknown> | undefined

    // Get BuildingInfo from the actor's trait infos
    const actorInfo = actorAny['info'] as Record<string, unknown> | undefined
    const traitInfoOrDefault = actorInfo?.['traitInfoOrDefault'] as
      | ((name: string) => unknown)
      | undefined
    const buildingInfo = traitInfoOrDefault?.('BuildingInfo') as Record<string, unknown> | undefined

    // Get the actor's location (top-left cell)
    const location = actorAny['location'] as CPos | undefined

    // Compute footprint cells from BuildingInfo or use actor location
    let footprintCells: CPos[]
    if (buildingInfo && location) {
      const frozenUnderFogTiles = buildingInfo['frozenUnderFogTiles'] as
        | ((loc: CPos) => CPos[])
        | undefined
      footprintCells = frozenUnderFogTiles?.(location) ?? [location]
    } else if (location) {
      footprintCells = [location]
    } else {
      footprintCells = []
    }

    // Uncomment when startsRevealed migration is complete:
    // TODO-12.A.6.1: Compute startsRevealed from lobby settings and init flags.
    //
    // const shroudInfo = worldAny?.['map']?.['rules']?.actors?.[SystemActors.Player]?.traitInfo?.('ShroudInfo')
    // const exploredMap = worldAny?.['lobbyInfo']?.globalSettings?.optionOrDefault?.('explored', shroudInfo?.exploredMapCheckboxEnabled)
    // this._startsRevealed = exploredMap && init.contains('SpawnedByMapInit') && !init.contains('HiddenUnderFogInit')

    // Convert CPos footprint to PPos via Map.ProjectedCellsCovering
    const projectedCellsCovering = map?.['projectedCellsCovering'] as
      | ((uv: MPos) => readonly PPos[])
      | undefined

    if (projectedCellsCovering && footprintCells.length > 0) {
      const mapGrid = map?.['grid'] as Record<string, unknown> | undefined
      const gridType = ((mapGrid?.['type'] as number) ?? MapGridType.Rectangular) as MapGridType
      const allProjected: PPos[] = []
      for (const cell of footprintCells) {
        const uv = cell.toMPos(gridType)
        const projected = projectedCellsCovering(uv)
        for (const puv of projected) {
          allProjected.push(puv)
        }
      }
      this._footprint = allProjected
    } else {
      this._footprint = []
    }
  }

  // -------------------------------------------------------------------------
  // INotifyCreated
  // -------------------------------------------------------------------------

  /**
   * Called after the actor has been fully created.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor)
   *
   * Creates a FrozenActor for each player and adds it to the player's
   * FrozenActorLayer. Defers initial visibility update by one frame via
   * addFrameEndTask to ensure all traits have finished their created()
   * callbacks.
   *
   * @param self — the actor this trait is attached to
   */
  created(self: IGameActor): void {
    const world = this._getWorld(self)
    const players = world?.['players'] as readonly PlayerStub[] | undefined
    if (!players) return

    const states = new Map<PlayerStub, FrozenState>()

    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      const player = players[playerIndex]
      const frozenActor = new FrozenActor(
        self,
        this as unknown as ICreatesFrozenActors,
        this._footprint,
        player as PlayerStub,
        this._startsRevealed,
      )

      // Add to player's FrozenActorLayer via PlayerActor
      const playerAny = player as unknown as Record<string, unknown>
      const playerActor = playerAny['playerActor'] as IGameActor | undefined
      const playerActorAny = playerActor as unknown as Record<string, unknown> | undefined
      const traitOrDefault = playerActorAny?.['traitOrDefault'] as
        | ((name: string) => unknown)
        | undefined
      const frozenActorLayer = traitOrDefault?.('FrozenActorLayer') as FrozenActorLayer | undefined
      frozenActorLayer?.Add(frozenActor)

      states.set(player as PlayerStub, new FrozenState(frozenActor, playerIndex))
    }

    this._frozenStates = states

    // Defer initial visibility update by one frame.
    // This relies on actor.GetTargetablePositions(), which is also set up
    // in created() callbacks. Since we can't be sure our method runs after
    // theirs, defer by a frame.
    const addFrameEndTask = world?.['addFrameEndTask'] as
      | ((action: () => void) => void)
      | undefined
    addFrameEndTask?.(() => {
      if (!this._frozenStates) return
      for (const state of this._frozenStates.values()) {
        const frozen = state.frozenActor
        if (this._startsRevealed || state.isVisible) {
          this._updateFrozenActorCore(frozen, state.playerIndex)
        }
        frozen.RefreshHidden()
      }
    })

    this._created = true
  }

  // -------------------------------------------------------------------------
  // ICreatesFrozenActors
  // -------------------------------------------------------------------------

  /**
   * Called by FrozenActorLayer when a frozen actor's visibility changes.
   *
   * OpenRA 对照: ICreatesFrozenActors.OnVisibilityChanged(FrozenActor)
   *
   * Synchronizes FrozenState.isVisible with the frozen actor's Visible flag
   * and updates the VisibilityHash. If the frozen actor becomes visible
   * (live actor hidden), calls RefreshState to capture current state.
   *
   * @param frozen — the frozen actor whose visibility changed
   */
  onVisibilityChanged(frozen: IFrozenActorRef): void {
    // Ignore callbacks during initial setup
    if (!this._created || !this._frozenStates) return

    const state = this._frozenStates.get(frozen.viewer)
    if (!state) return

    const isVisible = !frozen.visible
    state.isVisible = isVisible

    if (isVisible) {
      // NOTE: Uses IFrozenActorRef.refreshState() — no unsafe cast to FrozenActor
      this._updateFrozenActorCore(frozen, state.playerIndex)
    }

    frozen.refreshHidden()
  }

  // -------------------------------------------------------------------------
  // IDefaultVisibility
  // -------------------------------------------------------------------------

  /**
   * Determine whether this actor is visible to the given player.
   *
   * OpenRA 对照: IDefaultVisibility.IsVisible(Actor, Player)
   *
   * @param self — the actor this trait is attached to
   * @param byPlayer — the player viewing the actor, or null (observer)
   * @returns true if the actor is visible to byPlayer
   */
  isVisible(self: IGameActor, byPlayer: PlayerStub | null): boolean {
    // Null player means observer — always visible
    if (byPlayer === null || byPlayer === undefined) {
      return true
    }

    // Check always-visible relationships first
    const owner = this._getOwner(self)
    if (owner) {
      const ownerAny = owner as unknown as Record<string, unknown>
      const relationshipWith = ownerAny['relationshipWith'] as
        | ((other: PlayerStub) => PlayerRelationship)
        | undefined
      const rel = relationshipWith?.call(owner, byPlayer)
      if (rel !== undefined && PlayerRelationshipExts.hasRelationship(rel, this._info.alwaysVisibleRelationships)) {
        return true
      }
    }

    return this._isVisibleInner(byPlayer)
  }

  // -------------------------------------------------------------------------
  // ITickRender
  // -------------------------------------------------------------------------

  /**
   * Called every render frame to capture renderables for frozen actors.
   *
   * OpenRA 对照: ITickRender.TickRender(WorldRenderer, Actor)
   *
   * For each player whose FrozenActor needs renderables, captures the live
   * actor's renderables, screen bounds, and mouse bounds. The _isRendering
   * guard ensures modifyRender returns the original renderables during capture.
   *
   * TODO-12.DEFERRED.13: Renderable capture. Renderables, ScreenBounds, and
   * MouseBounds are deferred. Currently only updates NeedRenderables flag
   * and marks frozen actors for ScreenMap updates.
   *
   * @param wr — the world renderer (unused until renderable capture)
   * @param self — the actor this trait is attached to
   */
  tickRender(wr: WorldRendererStub, self: IGameActor): void {
    void wr // unused until TODO-12.DEFERRED.13

    if (!this._frozenStates) return

    let renderables: readonly IRenderable[] | null = null

    for (const [player, state] of this._frozenStates) {
      const frozen = state.frozenActor
      if (!frozen.NeedRenderables) continue

      if (renderables === null) {
        this._isRendering = true
        try {
          // TODO-12.DEFERRED.13: Capture live actor renderables
          // renderables = self.render(wr).slice()
          // bounds = self.screenBounds(wr).slice()
          // mouseBounds = self.mouseBounds(wr)
          renderables = FrozenUnderFog._emptyRenderables
        } finally {
          this._isRendering = false
        }
      }

      frozen.NeedRenderables = false
      frozen.Renderables = renderables
      // TODO-12.DEFERRED.12/13: Capture screen bounds and mouse bounds
      // frozen.ScreenBounds = bounds
      // frozen.MouseBounds = mouseBounds

      // Add to ScreenMap for spatial query
      const world = this._getWorld(self)
      if (world) {
        const screenMap = world['screenMap'] as Record<string, unknown> | undefined
        const addOrUpdate = screenMap?.['addOrUpdate'] as
          | ((viewer: PlayerStub, fa: FrozenActor) => void)
          | undefined
        if (addOrUpdate) {
          addOrUpdate(player, frozen)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // IRenderModifier.modifyRender
  // -------------------------------------------------------------------------

  /**
   * Modify the actor's renderables before rendering.
   *
   * OpenRA 对照: IRenderModifier.ModifyRender(Actor, WorldRenderer, IEnumerable<IRenderable>)
   *
   * Hides the live actor's renderables when the frozen copy is visible to the
   * render player (to prevent double-rendering). During renderable capture
   * (_isRendering), the original renderables are always returned.
   *
   * TODO-12.DEFERRED.13: When renderable system is fully migrated, return
   * SpriteRenderable.None instead of empty array for consistency with OpenRA.
   *
   * @param self — the actor this trait is attached to
   * @param wr — the world renderer (unused)
   * @param r — the actor's renderables
   * @returns the modified renderables
   */
  modifyRender(
    self: IGameActor,
    wr: WorldRendererStub,
    r: readonly IRenderable[],
  ): readonly IRenderable[] {
    void wr // unused

    // During renderable capture, always return original
    if (this._isRendering) return r

    // Check if visible to the render player
    // NOTE: C# calls IsVisible(self, self.World.RenderPlayer) || isRendering.
    // When RenderPlayer is null, IsVisible returns true (observer = always
    // visible), so the live actor's renderables are returned.
    const world = this._getWorld(self)
    const renderPlayer = world?.['renderPlayer'] as PlayerStub | undefined

    if (!renderPlayer || this.isVisible(self, renderPlayer)) return r

    // Live actor is not visible to render player — hide it
    // The frozen copy in FrozenActorLayer renders instead
    return FrozenUnderFog._emptyRenderables
  }

  // -------------------------------------------------------------------------
  // IRenderModifier.modifyScreenBounds (pass-through)
  // -------------------------------------------------------------------------

  /**
   * Modify screen bounds before rendering.
   *
   * OpenRA 对照: IRenderModifier.ModifyScreenBounds(Actor, WorldRenderer,
   *   IEnumerable<Rectangle>)
   *
   * Pass-through — FrozenUnderFog does not modify screen bounds. The frozen
   * copy's bounds are handled independently by the FrozenActorLayer.
   *
   * @param self — the actor this trait is attached to
   * @param wr — the world renderer
   * @param bounds — the actor's screen bounds
   * @returns unmodified bounds
   */
  modifyScreenBounds(
    self: IGameActor,
    wr: WorldRendererStub,
    bounds: readonly RectangleStub[],
  ): readonly RectangleStub[] {
    void self, void wr // pass-through
    return bounds
  }

  // -------------------------------------------------------------------------
  // INotifyOwnerChanged
  // -------------------------------------------------------------------------

  /**
   * Called when the actor's owner changes.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   *
   * Forces a state update for the old owner so tooltips etc don't show
   * the old owner incorrectly. Updates the frozen actor's state and
   * triggers RefreshHidden.
   *
   * @param self — the actor this trait is attached to
   * @param oldOwner — the previous owner
   * @param newOwner — the new owner
   */
  onOwnerChanged(self: IGameActor, oldOwner: PlayerStub, newOwner: PlayerStub): void {
    void self, void newOwner // suppress TS6133 (interface compliance)

    if (!this._frozenStates) return

    const state = this._frozenStates.get(oldOwner)
    if (!state) return

    const frozen = state.frozenActor
    this._updateFrozenActorCore(frozen, state.playerIndex)
    frozen.RefreshHidden()
  }

  // -------------------------------------------------------------------------
  // INotifyActorDisposing
  // -------------------------------------------------------------------------

  /**
   * Called when the actor is being disposed.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
   *
   * Invalidates the frozen actor for the current owner (covers the case
   * where the actor was captured from an enemy).
   *
   * @param self — the actor being disposed
   */
  disposing(self: IGameActor): void {
    if (!this._frozenStates) return

    const owner = this._getOwner(self)
    if (!owner) return

    const state = this._frozenStates.get(owner)
    if (!state) return

    state.frozenActor.Invalidate()
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Check whether the live actor is visible to a given player.
   *
   * OpenRA 对照: FrozenUnderFog.IsVisibleInner(Player)
   *
   * If fog is disabled, visibility is determined by shroud exploration state.
   * If fog is enabled, visibility is determined by the FrozenState.
   *
   * @param byPlayer — the player to check visibility for
   * @returns true if the actor is visible to byPlayer
   */
  private _isVisibleInner(byPlayer: PlayerStub): boolean {
    const playerAny = byPlayer as unknown as Record<string, unknown>
    const shroud = playerAny['shroud'] as Shroud | undefined

    if (!shroud) {
      // No shroud — always visible
      return true
    }

    if (!shroud.fogEnabled) {
      // Fog disabled — visibility determined by shroud exploration
      return this._anyExplored(shroud)
    }

    // Fog enabled — check per-player frozen state (O(1) Map lookup)
    if (!this._frozenStates) return false

    const state = this._frozenStates.get(byPlayer)
    if (!state) return false

    return state.isVisible
  }

  /**
   * Check if any cell in the footprint is explored by the shroud.
   *
   * OpenRA 对照: ShroudExts.AnyExplored(Shroud, PPos[])
   *
   * PERF: Inline implementation avoids LINQ/functional allocation.
   * Returns true on first explored cell found (early exit).
   *
   * @param shroud — the shroud to query
   * @returns true if any footprint cell is explored
   */
  private _anyExplored(shroud: Shroud): boolean {
    // PERF: numeric for-loop avoids iterator allocation on hot path
    for (let i = 0; i < this._footprint.length; i++) {
      if (shroud.isExplored(this._footprint[i])) {
        return true
      }
    }
    return false
  }

  /**
   * Update the frozen actor's state and sync hash.
   *
   * OpenRA 对照: FrozenUnderFog.UpdateFrozenActor(FrozenActor, int)
   *
   * Sets the VisibilityHash bit for the given player and calls
   * refreshState() on the frozen actor.
   *
   * @param frozen — the frozen actor to update (IFrozenActorRef — no unsafe cast)
   * @param playerIndex — the player index (for bit hash)
   */
  private _updateFrozenActorCore(frozen: IFrozenActorRef, playerIndex: number): void {
    this.VisibilityHash |= 1 << (playerIndex % 32)
    frozen.refreshState()
  }

  /**
   * Get the world from an actor.
   *
   * @param self — the actor
   * @returns the world object, or null
   */
  private _getWorld(self: IGameActor): Record<string, unknown> | null {
    return (self as unknown as Record<string, unknown>)['world'] as Record<string, unknown> | null
  }

  /**
   * Get the owner of an actor.
   *
   * @param self — the actor
   * @returns the owner player, or null
   */
  private _getOwner(self: IGameActor): PlayerStub | null {
    return ((self as unknown as Record<string, unknown>)['owner'] as PlayerStub | null) ?? null
  }
}

// ---------------------------------------------------------------------------
// HiddenUnderFogInit (对应 OpenRA HiddenUnderFogInit)
// ---------------------------------------------------------------------------

/**
 * HiddenUnderFogInit — deferred. This class is referenced by FrozenUnderFog
 * but its initialization behavior (startsRevealed) depends on integration with
 * the actor creation pipeline.
 *
 * OpenRA 对照: HiddenUnderFogInit (FrozenUnderFog.cs:189)
 *
 * TODO-12.A.6.1: Implement startsRevealed behavior when actor init pipeline is mature.
 */
export class HiddenUnderFogInit {
  /** Placeholder for C# readonly string value — always empty for now. */
  readonly value: string = ''
}
