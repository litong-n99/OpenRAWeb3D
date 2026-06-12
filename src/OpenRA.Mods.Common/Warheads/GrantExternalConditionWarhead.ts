/**
 * GrantExternalConditionWarhead.ts -- Grant external conditions on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/GrantExternalConditionWarhead.cs
 *
 * 核心范式转换:
 * - C# ExternalCondition trait lookup + GrantCondition → ConditionEffect deferred
 * - C# World.FindActorsInCircle → duck-typed findActorsOnCircle
 * - C# ExternalCondition.CanGrantCondition check → skipped (applied at frame end)
 * - C# duration 0 = permanent → ConditionEffect with duration = 0
 */

import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  TargetType,
} from '../../OpenRA.Game/Traits/Target.js'
import {
  Warhead,
  type WarheadArgs,
  type ConditionEffect,
  type WarheadEffect,
  type WarheadActorLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'

type TargetInstance = Target

// ---------------------------------------------------------------------------
// GrantExternalConditionWarhead (对应 OpenRA GrantExternalConditionWarhead)
// ---------------------------------------------------------------------------

/**
 * Grants an external condition to hit actors.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.GrantExternalConditionWarhead
 *
 * Duration = 0 means permanent condition.
 * Only actors with the matching ExternalCondition trait are affected.
 */
export class GrantExternalConditionWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** The condition to apply. Must be in the target's ExternalConditions list.
   *
   * OpenRA 对照: GrantExternalConditionWarhead.Condition
   */
  condition: string = ''

  /** Duration of the condition in ticks. 0 = permanent.
   *
   * OpenRA 对照: GrantExternalConditionWarhead.Duration
   */
  duration: number = 0

  /** Effect radius.
   *
   * OpenRA 对照: GrantExternalConditionWarhead.Range (WDist.FromCells(1))
   */
  range: WDist = WDist.fromCells(1)

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Condition !== undefined) this.condition = json.Condition as string
    if (json.Duration !== undefined) this.duration = json.Duration as number
    if (json.Range !== undefined) this.range = new WDist(json.Range as number)
  }

  // -----------------------------------------------------------------------
  // Override: doImpact
  // -----------------------------------------------------------------------

  /**
   * Grant condition to the target actor or actors in range.
   *
   * OpenRA 对照: GrantExternalConditionWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpact(
    target: TargetInstance,
    args: WarheadArgs,
  ): WarheadEffect[] {
    if (target.type === TargetType.Invalid) return []

    if (!this.condition) return []

    const firedBy = args.sourceActor
    const effects: ConditionEffect[] = []

    let actors: IGameActor[] = []

    if (target.type === TargetType.Actor) {
      const a = target.actor
      if (a) actors = [a as unknown as IGameActor]
    } else {
      const world = (firedBy as unknown as WarheadActorLike).world
      if (world?.findActorsOnCircle) {
        const found = world.findActorsOnCircle(
          target.centerPosition,
          this.range,
        )
        if (found) actors = found as unknown[] as IGameActor[]
      }
    }

    for (const a of actors) {
      if (!this.isValidAgainst(a, firedBy)) continue

      effects.push({
        type: 'condition',
        target: a,
        condition: this.condition,
        duration: this.duration,
        firedBy,
      })
    }

    return effects
  }

  // -----------------------------------------------------------------------
  // Implementation of abstract doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Position-based impact is handled via the overridden doImpact which
   * delegates to findActorsInCircle. This method returns an empty array
   * because all logic is in doImpact.
   */
  override doImpactInWorld(): WarheadEffect[] {
    console.warn('Unexpected direct call to doImpactInWorld — use doImpact() which handles logic directly')
    return []
  }
}
