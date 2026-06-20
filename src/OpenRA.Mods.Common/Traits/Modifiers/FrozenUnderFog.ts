/**
 * FrozenUnderFog.ts — Building freeze-under-fog behavior (creates frozen actor snapshots)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.cs
 *
 * 核心范式转换:
 * - C# PlayerDictionary<FrozenState> → Map<PlayerStub, FrozenState> (O(1) lookup)
 * - C# IRenderable capture (self.Render(wr).ToArray()) → _captureRenderables/_captureScreenBounds/_captureMouseBounds (P1-C.2)
 * - C# SpriteRenderable.None render modifier → empty renderables
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
import { Rectangle } from '../../../OpenRA.Game/Primitives/Rectangle'
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

  /**
   * Previous visibility state per player, keyed by PlayerStub.
   *
   * Used in tickRender() to detect transitions between visible/fogged
   * states so ScreenMap add/remove can be performed.
   *
   * OpenRA 对照: FrozenUnderFog.TickRender() — transition detection
   */
  private _prevIsVisible = new Map<PlayerStub, boolean>()

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
   * Visibility transitions:
   * - visible→fogged (_isVisible=false, wasVisible=true):
   *   Remove live actor from ScreenMap, capture renderables for frozen copy.
   * - fogged→visible (_isVisible=true, wasVisible=false):
   *   Remove frozen actor from ScreenMap, re-add live actor to ScreenMap.
   *
   * The _prevIsVisible map tracks previous per-player visibility for
   * transition detection.
   *
   * @param wr — the world renderer (used for capturing renderables)
   * @param self — the actor this trait is attached to
   */
  tickRender(wr: WorldRendererStub, self: IGameActor): void {
    if (!this._frozenStates) return

    let renderables: readonly IRenderable[] | null = null
    let bounds: readonly RectangleStub[] | null = null
    let mouseBounds: unknown = null

    for (const [player, state] of this._frozenStates) {
      const frozen = state.frozenActor
      const prevVisible = this._prevIsVisible.get(player) ?? state.isVisible

      // ------------------------------------------------------------------
      // Detect visibility transitions
      // ------------------------------------------------------------------

      // Transition: live actor becomes hidden (goes under fog)
      // frozen becomes visible → remove live actor from ScreenMap
      if (!state.isVisible && prevVisible) {
        this._removeLiveFromScreenMap(player, self)
      }

      // Transition: live actor becomes visible again (exits fog)
      // frozen becomes hidden → remove frozen from ScreenMap, re-add live
      if (state.isVisible && !prevVisible) {
        this._removeFrozenFromScreenMap(player, frozen)
        this._addLiveToScreenMap(player, self)
      }

      // Update previous visibility for next frame
      this._prevIsVisible.set(player, state.isVisible)

      // ------------------------------------------------------------------
      // Renderable capture for frozen actors needing it
      // ------------------------------------------------------------------

      if (!frozen.NeedRenderables) continue

      // Lazy-init: capture renderables from live actor once per frame
      // (all frozen actors share the same captured output).
      if (renderables === null) {
        this._isRendering = true
        try {
          // Capture renderable output from the live actor via IRender traits.
          // The actor exposes renderables through traitsImplementing('IRender')
          // which each produce their renderables using the WorldRenderer.
          renderables = this._captureRenderables(self, wr)
          bounds = this._captureScreenBounds(self, wr)
          mouseBounds = this._captureMouseBounds(self, wr)
        } finally {
          this._isRendering = false
        }
      }

      frozen.NeedRenderables = false
      frozen.Renderables = renderables

      // Store captured screen bounds
      if (bounds && bounds.length > 0) {
        const screenRects = bounds.map((b) =>
          Rectangle.fromLTRB(b.x, b.y, b.x + b.width, b.y + b.height),
        )
        ;(frozen as unknown as Record<string, unknown>)['ScreenBounds'] = screenRects
      }

      // Store captured mouse bounds
      if (mouseBounds) {
        ;(frozen as unknown as Record<string, unknown>)['MouseBounds'] = mouseBounds
      }

      // Add to ScreenMap for spatial query.
      // When frozen becomes visible (live actor hidden by fog), the frozen
      // actor is added to ScreenMap so it can be picked up by spatial
      // queries (render, mouse hit-test, etc.).
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
  // Renderable capture helpers
  // -------------------------------------------------------------------------

  /**
   * Capture renderables from the live actor for frozen snapshot storage.
   *
   * OpenRA 对照: FrozenUnderFog.TickRender — renderable capture
   *
   * Iterates actor traits implementing 'IRender' and collects their
   * renderable output. Uses the WorldRenderer for viewport-dependent
   * rendering (e.g., culling, LOD).
   *
   * NOTE: Full renderable capture depends on the IRender system being
   * fully wired (TODO-12.DEFERRED.13). Currently attempts to call
   * traitsImplementing('IRender') and fall back to empty array.
   *
   * @param self — the actor to capture from
   * @param wr — the world renderer for context
   * @returns captured renderables (may be empty if system not yet wired)
   */
  private _captureRenderables(
    self: IGameActor,
    wr: WorldRendererStub,
  ): readonly IRenderable[] {
    const actorAny = self as unknown as Record<string, unknown>
    const result: IRenderable[] = []

    // Attempt to collect renderables from IRender traits
    const renderTraits = actorAny['traitsImplementing'] as
      | ((name: string) => readonly Record<string, unknown>[])
      | undefined

    if (renderTraits) {
      const irTraits = renderTraits('IRender')
      for (const trait of irTraits) {
        const renderFn = trait['render'] as
          | ((a: IGameActor, w: WorldRendererStub) => readonly IRenderable[])
          | undefined
        if (renderFn) {
          const r = renderFn(self, wr)
          for (const item of r) {
            result.push(item)
          }
        }
      }
    }

    // If IRender traits not available, try direct actor render method
    if (result.length === 0) {
      const directRender = actorAny['render'] as
        | ((wr: WorldRendererStub) => readonly IRenderable[])
        | undefined
      if (directRender) {
        const r = directRender(wr)
        for (const item of r) {
          result.push(item)
        }
      }
    }

    return result.length > 0 ? result : FrozenUnderFog._emptyRenderables
  }

  /**
   * Capture screen bounds from the live actor.
   *
   * OpenRA 对照: FrozenUnderFog.TickRender — screen bounds capture
   *
   * Iterates actor traits implementing 'IRender' and collects their
   * screen bounds. Falls back to direct actor.screenBounds(wr) if
   * traits are not available.
   *
   * @param self — the actor to capture from
   * @param wr — the world renderer for context
   * @returns captured screen bounds (may be empty)
   */
  private _captureScreenBounds(
    self: IGameActor,
    wr: WorldRendererStub,
  ): readonly RectangleStub[] {
    const actorAny = self as unknown as Record<string, unknown>
    const result: RectangleStub[] = []

    const renderTraits = actorAny['traitsImplementing'] as
      | ((name: string) => readonly Record<string, unknown>[])
      | undefined

    if (renderTraits) {
      const irTraits = renderTraits('IRender')
      for (const trait of irTraits) {
        const sbFn = trait['screenBounds'] as
          | ((a: IGameActor, w: WorldRendererStub) => readonly RectangleStub[])
          | undefined
        if (sbFn) {
          const sb = sbFn(self, wr)
          for (const b of sb) {
            result.push(b)
          }
        }
      }
    }

    if (result.length === 0) {
      const directBounds = actorAny['screenBounds'] as
        | ((wr: WorldRendererStub) => readonly RectangleStub[])
        | undefined
      if (directBounds) {
        const sb = directBounds(wr)
        for (const b of sb) {
          result.push(b)
        }
      }
    }

    return result
  }

  /**
   * Capture mouse bounds from the live actor.
   *
   * OpenRA 对照: FrozenUnderFog.TickRender — mouse bounds capture
   *
   * Looks for IMouseBounds trait on the actor. Falls back to
   * IAutoMouseBounds if IMouseBounds is not available.
   *
   * @param self — the actor to capture from
   * @param wr — the world renderer for context
   * @returns captured mouse bounds polygon, or null if not available
   */
  private _captureMouseBounds(
    self: IGameActor,
    wr: WorldRendererStub,
  ): unknown {
    const actorAny = self as unknown as Record<string, unknown>

    // Try IMouseBounds trait first
    const mouseBoundsTraits = actorAny['traitsImplementing'] as
      | ((name: string) => readonly Record<string, unknown>[])
      | undefined

    if (mouseBoundsTraits) {
      const mbTraits = mouseBoundsTraits('IMouseBounds')
      for (const trait of mbTraits) {
        const mbFn = trait['mouseoverBounds'] as
          | ((a: IGameActor, w: WorldRendererStub) => unknown)
          | undefined
        if (mbFn) {
          return mbFn(self, wr)
        }
      }
    }

    // Try IAutoMouseBounds
    if (mouseBoundsTraits) {
      const ambTraits = mouseBoundsTraits('IAutoMouseBounds')
      for (const trait of ambTraits) {
        const ambFn = trait['autoMouseoverBounds'] as
          | ((a: IGameActor, w: WorldRendererStub) => unknown)
          | undefined
        if (ambFn) {
          return ambFn(self, wr)
        }
      }
    }

    // Fall back to direct actor method
    const directMouseBounds = actorAny['mouseBounds'] as
      | ((wr: WorldRendererStub) => unknown)
      | undefined
    if (directMouseBounds) {
      return directMouseBounds(wr)
    }

    return null
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

  // -------------------------------------------------------------------------
  // ScreenMap transition helpers
  // -------------------------------------------------------------------------

  /**
   * Remove the live actor from ScreenMap for a given viewer.
   *
   * OpenRA 对照: ScreenMap.Remove(Player, Actor)
   *
   * Called when the actor transitions visible→fogged. The live actor
   * should no longer participate in spatial queries for this viewer
   * because the frozen copy handles rendering and hit-testing.
   *
   * @param viewer — the player whose ScreenMap to remove from
   * @param self — the live actor to remove
   */
  private _removeLiveFromScreenMap(viewer: PlayerStub, self: IGameActor): void {
    const world = this._getWorld(self)
    if (!world) return

    const screenMap = world['screenMap'] as Record<string, unknown> | undefined
    const remove = screenMap?.['remove'] as
      | ((viewer: PlayerStub, actor: IGameActor) => void)
      | undefined
    if (remove) {
      remove(viewer, self)
    }
  }

  /**
   * Remove a frozen actor from ScreenMap for a given viewer.
   *
   * OpenRA 对照: ScreenMap.Remove(Player, FrozenActor)
   *
   * Called when the actor transitions fogged→visible. The frozen copy
   * should be removed from spatial queries since the live actor is now
   * visible and handles its own rendering.
   *
   * Tries the frozen actor's world first (via live actor reference),
   * then falls back to the viewer's world (via playerActor).
   *
   * @param viewer — the player whose ScreenMap to remove from
   * @param frozen — the frozen actor to remove
   */
  private _removeFrozenFromScreenMap(viewer: PlayerStub, frozen: FrozenActor): void {
    // Try frozen actor's world first (via live actor)
    let world: Record<string, unknown> | null = null
    if (frozen.Actor) {
      world = this._getWorld(frozen.Actor)
    }

    // Fallback: viewer's world (via playerActor)
    if (!world) {
      const viewerAny = viewer as unknown as Record<string, unknown>
      const playerActor = viewerAny['playerActor'] as Record<string, unknown> | undefined
      world = (playerActor?.['world'] as Record<string, unknown> | undefined) ?? null
    }

    if (!world) return

    const screenMap = world['screenMap'] as Record<string, unknown> | undefined
    const remove = screenMap?.['remove'] as
      | ((viewer: PlayerStub, fa: FrozenActor) => void)
      | undefined
    if (remove) {
      remove(viewer, frozen)
    }
  }

  /**
   * Re-add the live actor to ScreenMap for a given viewer.
   *
   * OpenRA 对照: ScreenMap.AddOrUpdate(Player, Actor)
   *
   * Called when the actor transitions fogged→visible. The live actor
   * should be re-added to spatial queries so its renderables and
   * hit-testing work correctly.
   *
   * @param viewer — the player whose ScreenMap to add to
   * @param self — the live actor to re-add
   */
  private _addLiveToScreenMap(viewer: PlayerStub, self: IGameActor): void {
    const world = this._getWorld(self)
    if (!world) return

    const screenMap = world['screenMap'] as Record<string, unknown> | undefined
    const addOrUpdate = screenMap?.['addOrUpdate'] as
      | ((viewer: PlayerStub, actor: IGameActor) => void)
      | undefined
    if (addOrUpdate) {
      addOrUpdate(viewer, self)
    }
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
