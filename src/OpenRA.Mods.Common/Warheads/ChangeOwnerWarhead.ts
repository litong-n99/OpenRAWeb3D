/**
 * ChangeOwnerWarhead.ts -- Ownership transfer on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/ChangeOwnerWarhead.cs
 *
 * 核心范式转换:
 * - C# actor.ChangeOwner(Player) synchronous → OwnerChangeEffect deferred
 * - C# actor.CancelActivity() synchronous → cancelActivity flag in effect
 * - C# TemporaryOwnerManager trait → deferred effect with duration
 * - C# World.FindActorsInCircle → duck-typed findActorsOnCircle
 */

import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  TargetType,
} from '../../OpenRA.Game/Traits/Target.js'
import {
  Warhead,
  type WarheadArgs,
  type OwnerChangeEffect,
  type WarheadEffect,
  type WarheadActorLike,
} from './Warhead.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'

type TargetInstance = Target

// ---------------------------------------------------------------------------
// ChangeOwnerWarhead (对应 OpenRA ChangeOwnerWarhead)
// ---------------------------------------------------------------------------

/**
 * Transfers ownership of actors on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.ChangeOwnerWarhead
 *
 * Duration = 0 means permanent ownership change.
 * Duration > 0 requires TemporaryOwnerManager trait on the target.
 */
export class ChangeOwnerWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Duration of the owner change in ticks. 0 = permanent.
   *
   * OpenRA 对照: ChangeOwnerWarhead.Duration
   */
  duration: number = 0

  /** Effect radius.
   *
   * OpenRA 对照: ChangeOwnerWarhead.Range (WDist.FromCells(1))
   */
  range: WDist = WDist.fromCells(1)

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Duration !== undefined) this.duration = json.Duration as number
    if (json.Range !== undefined) this.range = new WDist(json.Range as number)
  }

  // -----------------------------------------------------------------------
  // Override: doImpact (handles both Actor and position targets)
  // -----------------------------------------------------------------------

  /**
   * Apply owner change to the target actor or actors in range.
   *
   * OpenRA 对照: ChangeOwnerWarhead.DoImpact(in Target target, WarheadArgs args)
   *
   * For Actor targets: only affects that actor.
   * For position targets: affects all valid actors in range.
   */
  override doImpact(
    target: TargetInstance,
    args: WarheadArgs,
  ): WarheadEffect[] {
    if (target.type === TargetType.Invalid) return []

    const firedBy = args.sourceActor
    const effects: OwnerChangeEffect[] = []

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

      // Don't change owner on friendly fire
      if (a.owner === firedBy.owner) continue

      if (!firedBy.owner) continue

      effects.push({
        type: 'ownerChange',
        target: a,
        newOwner: firedBy.owner as PlayerStub,
        duration: this.duration,
        cancelActivity: true,
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
    return []
  }
}
