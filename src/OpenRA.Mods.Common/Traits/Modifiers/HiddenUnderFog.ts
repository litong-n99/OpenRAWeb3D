/**
 * HiddenUnderFog.ts — Hides an actor when it is under fog of war
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.cs
 *
 * 核心范式转换:
 * - C# HiddenUnderFogInfo : HiddenUnderShroudInfo (empty subclass) → class
 *   extending HiddenUnderShroudInfo with no extra fields
 * - C# HiddenUnderFog : HiddenUnderShroud (override IsVisibleInner) → class
 *   extending HiddenUnderShroud, overriding isVisibleInner
 * - C# ShroudExts.AnyVisible(occupiedCells) → anyVisible() from ../../ShroudExts
 * - When fog is disabled, falls back to shroud exploration (super.isVisibleInner)
 * - When fog is enabled, uses shroud.isVisible() / anyVisible() instead of
 *   shroud.isExplored() / anyExplored()
 *
 * 使用者:
 * - Mod system (RA, TD, D2K) — actors that should be hidden under fog
 */

import { WPos } from '../../../OpenRA.Game/WPos.js'
import {
  type IGameActor,
  type PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { VisibilityType } from '../AffectsShroud.js'
import { anyVisible } from '../../ShroudExts.js'
import { HiddenUnderShroud, HiddenUnderShroudInfo } from './HiddenUnderShroud.js'

// ---------------------------------------------------------------------------
// HiddenUnderFogInfo (对应 OpenRA HiddenUnderFogInfo)
// ---------------------------------------------------------------------------

/**
 * Trait info for HiddenUnderFog. Extends HiddenUnderShroudInfo with no
 * additional fields.
 *
 * OpenRA 对照: HiddenUnderFogInfo : HiddenUnderShroudInfo
 */
export class HiddenUnderFogInfo extends HiddenUnderShroudInfo {
  // No extra fields — identical to HiddenUnderShroudInfo
}

// ---------------------------------------------------------------------------
// HiddenUnderFog (对应 OpenRA HiddenUnderFog)
// ---------------------------------------------------------------------------

/**
 * Trait that hides an actor when it is under fog of war.
 *
 * OpenRA 对照: HiddenUnderFog : HiddenUnderShroud
 *
 * Extends {@link HiddenUnderShroud} to override the visibility check:
 * - When fog is disabled, falls back to shroud exploration (super)
 * - When fog is enabled, uses visibility checks (shroud.isVisible / anyVisible)
 *   instead of exploration checks (shroud.isExplored / anyExplored)
 */
export class HiddenUnderFog extends HiddenUnderShroud {
  /** Trait configuration (narrower type than base).
   *
   * NOTE: `declare` re-declares the inherited `info` field with a narrower
   * type (HiddenUnderFogInfo extends HiddenUnderShroudInfo). TypeScript
   * does not emit code for `declare` — the base class property is used at
   * runtime.
   */
  declare public readonly info: HiddenUnderFogInfo

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA HiddenUnderFog constructor)
  // -------------------------------------------------------------------------

  /**
   * Create the HiddenUnderFog trait.
   *
   * OpenRA 对照: HiddenUnderFog(HiddenUnderFogInfo) : base(info)
   *
   * @param info — trait configuration
   */
  constructor(info: HiddenUnderFogInfo) {
    super(info)
  }

  // -------------------------------------------------------------------------
  // isVisibleInner (override, 对应 OpenRA HiddenUnderFog.IsVisibleInner)
  // -------------------------------------------------------------------------

  /**
   * Check whether the actor is visible to the given player based on
   * fog/shrout visibility state.
   *
   * OpenRA 对照: HiddenUnderFog.IsVisibleInner(Actor, Player)
   *
   * When fog is disabled, visibility is determined by shroud exploration
   * (delegates to super). When fog is enabled, uses visibility instead of
   * exploration: checks if any occupied cell (or the center position) is
   * currently visible.
   *
   * @param self — the actor this trait is attached to
   * @param byPlayer — the player to check visibility for
   * @returns true if the actor is visible (not hidden by fog) to byPlayer
   */
  protected override isVisibleInner(self: IGameActor, byPlayer: PlayerStub): boolean {
    const shroud = this._getShroud(byPlayer)
    if (!shroud) return true

    // If fog is disabled, visibility is determined by shroud exploration
    if (!shroud.fogEnabled) {
      return super.isVisibleInner(self, byPlayer)
    }

    // Fog enabled — use visibility checks instead of exploration checks
    if (this.info.type === VisibilityType.Footprint) {
      const occupiesSpace = this._getOccupiesSpace(self)
      if (!occupiesSpace) return false
      return anyVisible(shroud, occupiesSpace.occupiedCells())
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

    return shroud.isVisible(pos)
  }
}
