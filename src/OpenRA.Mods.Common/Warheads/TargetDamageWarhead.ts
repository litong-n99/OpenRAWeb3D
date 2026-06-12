/**
 * TargetDamageWarhead.ts -- Single-target damage with optional spread
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/TargetDamageWarhead.cs
 *
 * 核心范式转换:
 * - C# Spread = WDist.Zero → only target actor damaged by default
 * - C# World.FindActorsOnCircle for non-zero spread → duck-typed findActorsOnCircle()
 * - C# synchronous InflictDamage → deferred DamageEffect[] (ADR-8.1)
 *
 * TODO: Wire debug overlay: WarheadDebugOverlay.AddImpact() — C# equivalent deferred to debug visualization phase
 */

import type { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  DamageWarhead,
} from './DamageWarhead.js'
import {
  type WarheadArgs,
  type WarheadEffect,
  type WarheadActorLike,
  type WarheadWorldLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// TargetDamageWarhead (对应 OpenRA TargetDamageWarhead)
// ---------------------------------------------------------------------------

/**
 * Apply damage to the targeted actor, with optional nearby spread.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.TargetDamageWarhead
 *
 * If Spread is zero, damage is only applied to the single targeted actor
 * (handled in the parent DamageWarhead.doImpact for Actor targets).
 * If Spread > 0, damage is also applied to nearby actors within the spread.
 */
export class TargetDamageWarhead extends DamageWarhead {
  /** Damage will be applied to actors in this area.
   * A value of zero means only targeted actor will be damaged.
   *
   * OpenRA 对照: TargetDamageWarhead.Spread
   */
  spread: WDist = WDist.Zero

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Spread !== undefined) {
      this.spread = new WDist(json.Spread as number)
    }
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Apply damage at a world position (for terrain/tile targets).
   *
   * OpenRA 对照: TargetDamageWarhead.DoImpact(WPos pos, Actor firedBy, WarheadArgs args)
   *
   * If spread is zero, no terrain-based damage is applied (only actor
   * targets can be damaged -- handled by the parent DamageWarhead).
   * If spread > 0, nearby actors within the spread radius are damaged.
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    args: WarheadArgs,
  ): WarheadEffect[] {
    if (this.spread.length === 0) return []

    const effects: WarheadEffect[] = []
    const actorLike = firedBy as unknown as WarheadActorLike
    const world: WarheadWorldLike | undefined = actorLike.world
    if (!world || !world.findActorsOnCircle) return effects

    const victims = world.findActorsOnCircle(pos, this.spread)
    if (!victims || victims.length === 0) return effects

    for (const victim of victims) {
      const victimActor = victim as unknown as IGameActor
      if (!this.isValidAgainst(victimActor, firedBy)) continue

      const shapeResult = this.findClosestActiveShape(victim, pos)
      if (!shapeResult) continue

      // Cannot be damaged if HitShape is outside Spread
      if (shapeResult.distance > this.spread.length) continue

      effects.push(
        ...this.inflictDamage(victimActor, firedBy, shapeResult.shape, args),
      )
    }

    return effects
  }
}
