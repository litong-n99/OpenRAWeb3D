/**
 * FlashTargetsInRadiusWarhead.ts -- Target sprite flash on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/FlashTargetsInRadiusWarhead.cs
 *
 * 核心范式转换:
 * - C# FlashTarget effect via world.AddFrameEndTask → TargetFlashEffect deferred
 * - C# World.FindActorsInCircle → duck-typed findActorsOnCircle
 * - C# Color / float3 overlay/tint → RGBA overlay and tint values
 * - C# DamageCalculationType → same enum from Warhead.ts
 */

import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  TargetType,
} from '../../OpenRA.Game/Traits/Target.js'
import {
  Warhead,
  type WarheadArgs,
  type TargetFlashEffect,
  type WarheadEffect,
  type WarheadActorLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'

type TargetInstance = Target

// ---------------------------------------------------------------------------
// FlashTargetsInRadiusWarhead (对应 OpenRA FlashTargetsInRadiusWarhead)
// ---------------------------------------------------------------------------

/**
 * Triggers a flash effect on the targeted actor or actors within a radius.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.FlashTargetsInRadiusWarhead
 *
 * Flashes actors with configurable overlay color/alpha or tint.
 * FlashCount controls the number of flash cycles, FlashInterval the ticks
 * between flashes.
 */
export class FlashTargetsInRadiusWarhead extends Warhead {
  // `DamageCalculationType` field from C# (line 41) omitted — unused in DoImpact()

  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Overlay color when ActorFlashType is Overlay.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.ActorFlashOverlayColor
   */
  actorFlashOverlayColor: { r: number; g: number; b: number; a: number } = {
    r: 1, g: 1, b: 1, a: 1,
  }

  /** Overlay transparency.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.ActorFlashOverlayAlpha
   */
  actorFlashOverlayAlpha: number = 0.5

  /** Tint to apply when ActorFlashType is Tint.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.ActorFlashTint (float3)
   */
  actorFlashTint: { r: number; g: number; b: number } = {
    r: 1.4, g: 1.4, b: 1.4,
  }

  /** Number of times to flash actors.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.ActorFlashCount
   */
  actorFlashCount: number = 2

  /** Number of ticks between flashes.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.ActorFlashInterval
   */
  actorFlashInterval: number = 2

  /** Radius at which effect is applied. 0 = only target actor.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.Radius
   */
  radius: WDist = new WDist(0)

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.ActorFlashOverlayColor !== undefined) {
      const arr = json.ActorFlashOverlayColor as number[]
      this.actorFlashOverlayColor = {
        r: (arr[0] ?? 255) / 255,
        g: (arr[1] ?? 255) / 255,
        b: (arr[2] ?? 255) / 255,
        a: (arr[3] ?? 255) / 255,
      }
    }
    if (json.ActorFlashOverlayAlpha !== undefined) {
      this.actorFlashOverlayAlpha = json.ActorFlashOverlayAlpha as number
    }
    if (json.ActorFlashTint !== undefined) {
      const arr = json.ActorFlashTint as number[]
      this.actorFlashTint = {
        r: arr[0] ?? 1.4,
        g: arr[1] ?? 1.4,
        b: arr[2] ?? 1.4,
      }
    }
    if (json.ActorFlashCount !== undefined) {
      this.actorFlashCount = json.ActorFlashCount as number
    }
    if (json.ActorFlashInterval !== undefined) {
      this.actorFlashInterval = json.ActorFlashInterval as number
    }
    if (json.Radius !== undefined) {
      this.radius = new WDist(json.Radius as number)
    }
  }

  // -----------------------------------------------------------------------
  // Override: doImpact
  // -----------------------------------------------------------------------

  /**
   * Flash the target actor or actors in the radius.
   *
   * OpenRA 对照: FlashTargetsInRadiusWarhead.DoImpact(in Target target, WarheadArgs args)
   *
   * If radius is zero, flashes only the targeted actor.
   * Otherwise, flashes all valid actors within the radius.
   */
  override doImpact(
    target: TargetInstance,
    args: WarheadArgs,
  ): WarheadEffect[] {
    const firedBy = args.sourceActor
    const effects: TargetFlashEffect[] = []

    let victims: IGameActor[] = []

    if (this.radius.length === 0 && target.type === TargetType.Actor) {
      const a = target.actor
      if (a) victims = [a as unknown as IGameActor]
    } else {
      const world = (firedBy as unknown as WarheadActorLike).world
      if (world?.findActorsOnCircle) {
        const found = world.findActorsOnCircle(
          target.centerPosition,
          this.radius,
        )
        if (found) victims = found as unknown[] as IGameActor[]
      }
    }

    for (const victim of victims) {
      if (!this.isValidAgainst(victim, firedBy)) continue

      effects.push({
        type: 'targetFlash',
        target: victim,
        overlayColor: this.actorFlashOverlayColor,
        overlayAlpha: this.actorFlashOverlayAlpha,
        flashCount: this.actorFlashCount,
        flashInterval: this.actorFlashInterval,
        tintColor: this.actorFlashTint,
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
