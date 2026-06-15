/**
 * HiddenUnderShroud.ts — Hides an actor when it is under unexplored shroud
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.cs
 *
 * 核心范式转换:
 * - C# Actor.OccupiesSpace / Actor.CenterPosition → traitOrDefault('IOccupySpace')
 *   runtime lookup
 * - C# ShroudExts.AnyExplored(occupiedCells) → anyExplored() from ../../ShroudExts
 * - C# SpriteRenderable.None → pre-allocated empty IRenderable[] (no per-frame allocation)
 * - C# Player.Shroud → (byPlayer as any).shroud runtime access
 * - C# self.World.Map.DistanceAboveTerrain() → (self as any).world.map.distanceAboveTerrain()
 *
 * 使用者:
 * - HiddenUnderFog.ts (TODO-12.A.12) — subclass that extends for fog visibility
 */

import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import {
  PlayerRelationship,
  PlayerRelationshipExts,
  type IGameActor,
  type PlayerStub,
  type IDefaultVisibility,
  type IDefaultVisibilityInfo,
  type IRenderModifier,
  type IRenderable,
  type WorldRendererStub,
  type RectangleStub,
  type IOccupySpace,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Shroud } from '../../../OpenRA.Game/Traits/Player/Shroud.js'
import type { Map as GameMap } from '../../../OpenRA.Game/Map/Map.js'
import { VisibilityType } from '../AffectsShroud.js'
import { anyExplored } from '../../ShroudExts.js'

// ---------------------------------------------------------------------------
// Pre-allocated constants
// ---------------------------------------------------------------------------

/** Pre-allocated zero vector to avoid per-frame WVec allocation on hot paths. */
export const WVecZero = new WVec(0, 0, 0)

// ---------------------------------------------------------------------------
// HiddenUnderShroudInfo (对应 OpenRA HiddenUnderShroudInfo)
// ---------------------------------------------------------------------------

/**
 * Narrow interface for runtime access to Player.relationshipWith().
 *
 * PlayerStub does not expose relationshipWith in its type definition,
 * but the runtime Player class provides it. This interface allows a
 * single cast instead of double-cast + bracket notation.
 */
interface IHasPlayerRelationship {
  relationshipWith(other: PlayerStub): PlayerRelationship
}

/**
 * Trait info for HiddenUnderShroud. Controls which players can always see
 * an actor and how visibility is measured.
 *
 * OpenRA 对照: HiddenUnderShroudInfo : TraitInfo, IDefaultVisibilityInfo
 */
export class HiddenUnderShroudInfo implements IDefaultVisibilityInfo {
  /**
   * Players with these relationships can always see the actor.
   *
   * OpenRA 对照: HiddenUnderShroudInfo.AlwaysVisibleRelationships
   *
   * Default: Ally (allies can always see the actor, even under shroud).
   */
  readonly alwaysVisibleRelationships: PlayerRelationship = PlayerRelationship.Ally

  /**
   * Possible values are CenterPosition (reveal when the center is visible),
   * GroundPosition (reveal when the ground position is visible), and
   * Footprint (reveal when any footprint cell is visible).
   *
   * OpenRA 对照: HiddenUnderShroudInfo.Type
   *
   * Default: Footprint
   */
  readonly type: VisibilityType = VisibilityType.Footprint

  constructor(params: {
    alwaysVisibleRelationships?: PlayerRelationship
    type?: VisibilityType
  } = {}) {
    if (params.alwaysVisibleRelationships !== undefined) {
      this.alwaysVisibleRelationships = params.alwaysVisibleRelationships
    }
    if (params.type !== undefined) {
      this.type = params.type
    }
  }
}

// ---------------------------------------------------------------------------
// HiddenUnderShroud (对应 OpenRA HiddenUnderShroud)
// ---------------------------------------------------------------------------

/**
 * Trait that hides an actor when it is under unexplored shroud.
 *
 * OpenRA 对照: HiddenUnderShroud : IDefaultVisibility, IRenderModifier
 *
 * Implements:
 * - {@link IDefaultVisibility}: determines if the actor is visible to a given player
 * - {@link IRenderModifier}: hides the actor's renderables when not visible
 */
export class HiddenUnderShroud
  implements IDefaultVisibility, IRenderModifier
{
  /** Pre-allocated empty renderable array — avoids per-frame allocation. */
  private static readonly _none: readonly IRenderable[] = []

  /** Trait configuration. */
  protected readonly info: HiddenUnderShroudInfo

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA HiddenUnderShroud constructor)
  // -------------------------------------------------------------------------

  /**
   * Create the HiddenUnderShroud trait.
   *
   * OpenRA 对照: HiddenUnderShroud(HiddenUnderShroudInfo)
   *
   * @param info — trait configuration
   */
  constructor(info: HiddenUnderShroudInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // isVisibleInner (对应 OpenRA HiddenUnderShroud.IsVisibleInner)
  // -------------------------------------------------------------------------

  /**
   * Check whether the actor is visible to the given player based on
   * shroud exploration state.
   *
   * OpenRA 对照: HiddenUnderShroud.IsVisibleInner(Actor, Player)
   *
   * Visibility type determines the check:
   * - **Footprint**: any of the actor's occupied cells must be explored
   * - **GroundPosition**: the actor's center projected to ground must be explored
   * - **CenterPosition**: the actor's center world position must be explored
   *
   * @param self — the actor this trait is attached to
   * @param byPlayer — the player to check visibility for
   * @returns true if the actor is visible (explored) to byPlayer
   */
  protected isVisibleInner(self: IGameActor, byPlayer: PlayerStub): boolean {
    const shroud = this._getShroud(byPlayer)
    if (!shroud) return true

    if (this.info.type === VisibilityType.Footprint) {
      const occupiesSpace = this._getOccupiesSpace(self)
      if (!occupiesSpace) return false
      return anyExplored(shroud, occupiesSpace.occupiedCells())
    }

    // CenterPosition or GroundPosition
    const centerPosition = this._getCenterPosition(self)
    if (!centerPosition) return false

    let pos = centerPosition
    if (this.info.type === VisibilityType.GroundPosition) {
      const map = this._getMap(self)
      if (!map) return false
      const aboveTerrain = map.distanceAboveTerrain(pos)
      // PERF: direct WPos construction avoids intermediate WVec allocation
      pos = new WPos(pos.X, pos.Y, pos.Z - aboveTerrain.length)
    }

    return shroud.isExplored(pos)
  }

  // -------------------------------------------------------------------------
  // IDefaultVisibility.isVisible (对应 OpenRA IDefaultVisibility.IsVisible)
  // -------------------------------------------------------------------------

  /**
   * Determine whether this actor is visible to the given player.
   *
   * OpenRA 对照: IDefaultVisibility.IsVisible(Actor, Player)
   *
   * Returns true when:
   * - byPlayer is null (observer mode — always visible)
   * - The owner has the AlwaysVisibleRelationships with byPlayer
   * - The actor's position/cells are explored (isVisibleInner)
   *
   * @param self — the actor this trait is attached to
   * @param byPlayer — the player viewing the actor, or null (observer)
   * @returns true if the actor is visible to byPlayer
   */
  isVisible(self: IGameActor, byPlayer: PlayerStub | null): boolean {
    if (byPlayer === null || byPlayer === undefined) {
      return true
    }

    // Check always-visible relationships
    const owner = self.owner
    if (owner) {
      const rel = (owner as unknown as IHasPlayerRelationship).relationshipWith(byPlayer)
      if (PlayerRelationshipExts.hasRelationship(rel, this.info.alwaysVisibleRelationships)) {
        return true
      }
    }

    return this.isVisibleInner(self, byPlayer)
  }

  // -------------------------------------------------------------------------
  // IRenderModifier.modifyRender (对应 OpenRA IRenderModifier.ModifyRender)
  // -------------------------------------------------------------------------

  /**
   * Modify the actor's renderables before rendering.
   *
   * OpenRA 对照: IRenderModifier.ModifyRender(Actor, WorldRenderer, IEnumerable<IRenderable>)
   *
   * Returns the original renderables if the actor is visible to the render
   * player, or an empty array to hide the actor under unexplored shroud.
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

    const renderPlayer = this._getRenderPlayer(self)

    if (!renderPlayer || this.isVisible(self, renderPlayer)) return r

    return HiddenUnderShroud._none
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
   * Pass-through — HiddenUnderShroud does not modify screen bounds.
   *
   * @param self — the actor (unused)
   * @param wr — the world renderer (unused)
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
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Get the Shroud from a player.
   *
   * @param player — the player
   * @returns the player's shroud, or undefined
   */
  protected _getShroud(player: PlayerStub): Shroud | undefined {
    return (player as unknown as Record<string, unknown>)['shroud'] as Shroud | undefined
  }

  /**
   * Get the IOccupySpace trait from an actor.
   *
   * Uses traitOrDefault('IOccupySpace') runtime lookup (same pattern as
   * AffectsShroud and FrozenUnderFog).
   *
   * @param self — the actor
   * @returns the IOccupySpace trait, or null
   */
  protected _getOccupiesSpace(self: IGameActor): IOccupySpace | null {
    const actorAny = self as unknown as Record<string, unknown>
    const traitOrDefault = actorAny['traitOrDefault'] as
      | ((name: string) => unknown)
      | undefined
    return (traitOrDefault?.('IOccupySpace') as IOccupySpace | null) ?? null
  }

  /**
   * Get the actor's center position from IOccupySpace.
   *
   * @param self — the actor
   * @returns the center world position, or null
   */
  protected _getCenterPosition(self: IGameActor): WPos | null {
    return this._getOccupiesSpace(self)?.centerPosition ?? null
  }

  /**
   * Get the game map from the actor's world.
   *
   * @param self — the actor
   * @returns the game map, or null
   */
  protected _getMap(self: IGameActor): GameMap | null {
    const actorAny = self as unknown as Record<string, unknown>
    const world = actorAny['world'] as Record<string, unknown> | undefined
    return (world?.['map'] as GameMap | undefined) ?? null
  }

  /**
   * Get the render player from the actor's world.
   *
   * @param self — the actor
   * @returns the render player, or null
   */
  protected _getRenderPlayer(self: IGameActor): PlayerStub | null {
    const actorAny = self as unknown as Record<string, unknown>
    const world = actorAny['world'] as Record<string, unknown> | undefined
    return (world?.['renderPlayer'] as PlayerStub | undefined) ?? null
  }
}
