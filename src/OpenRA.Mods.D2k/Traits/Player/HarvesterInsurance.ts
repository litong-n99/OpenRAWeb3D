/**
 * HarvesterInsurance.ts — D2K 矿车保险：矿车被沙虫吞噬后自动补充
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/Player/HarvesterInsurance.cs (49 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo + TraitLocation(SystemActors.Player) → TS class
 * - C# self.World.ActorsHavingTrait<Harvester>() → TS duck-typed actor query
 * - C# refinery.Trait<FreeActorWithDelivery>() → TS duck-typed trait lookup
 *   (FreeActorWithDelivery not yet migrated, uses minimal forward interface)
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Forward interfaces for unmigrated dependencies
// ---------------------------------------------------------------------------

/** Minimal interface for Harvester trait (duck-typed).
 *
 * OpenRA 对照: Harvester trait
 */
export interface IHarvesterLike {
  readonly info: { readonly name?: string }
}

/** Minimal interface for FreeActorWithDelivery trait.
 *
 * OpenRA 对照: FreeActorWithDelivery trait
 *
* Replace with full FreeActorWithDelivery when migrated.
 */
export interface IFreeActorWithDeliveryLike {
  readonly info: IFreeActorWithDeliveryInfoLike | null
  doDelivery(
    location: { X: number; Y: number },
    actorName: string,
    deliveringActor: string,
  ): void
}

/** Minimal interface for FreeActorWithDeliveryInfo.
 *
 * OpenRA 对照: FreeActorWithDeliveryInfo
 */
export interface IFreeActorWithDeliveryInfoLike {
  readonly hasTraitInfo?: (name: string) => boolean
  readonly actor?: string
  readonly deliveringActor?: string
  readonly deliveryOffset?: { X: number; Y: number }
}

/** Minimal interface for Refinery trait (duck-typed).
 *
 * OpenRA 对照: Refinery trait
 */
export interface IRefineryLike {
  readonly info: { readonly hasTraitInfo?: (name: string) => boolean }
  readonly location?: { X: number; Y: number }
  trait?: <T>(name: string) => T | undefined
}

// ---------------------------------------------------------------------------
// HarvesterInsuranceInfo
// ---------------------------------------------------------------------------

/** Configuration for HarvesterInsurance trait.
 *
 * OpenRA 对照: HarvesterInsuranceInfo : TraitInfo
 */
export class HarvesterInsuranceInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }

  /** Create the runtime trait instance.
   *
   * OpenRA 对照: HarvesterInsuranceInfo.Create(ActorInitializer init)
   */
  create(init: { self: IGameActor }): HarvesterInsurance {
    return new HarvesterInsurance(init.self)
  }
}

// ---------------------------------------------------------------------------
// HarvesterInsurance
// ---------------------------------------------------------------------------

/** Player trait — auto-queues a replacement harvester when the last one
 * is destroyed by a sandworm, provided the player has at least one refinery
 * with FreeActorWithDelivery.
 *
 * OpenRA 对照: HarvesterInsurance class
 *
 * Usage: Attach to PlayerActor. When a harvester is destroyed (eaten by
 * sandworm), call tryActivate() to spawn a replacement.
 */
export class HarvesterInsurance {
  readonly self: IGameActor

  constructor(self: IGameActor) {
    this.self = self
  }

  // -----------------------------------------------------------------------
  // TryActivate (对应 OpenRA HarvesterInsurance.TryActivate)
  // -----------------------------------------------------------------------

  /** Attempt to spawn a replacement harvester.
   *
   * OpenRA 对照: HarvesterInsurance.TryActivate()
   *
   * Checks:
   * 1. Player has no remaining harvesters
   * 2. Player has a refinery with FreeActorWithDelivery
   *
   * If both conditions met, spawns a harvester at the refinery's delivery
   * offset location.
   */
  tryActivate(): void {
    const world = this.self.world as unknown as {
      actorsHavingTrait?: (traitName: string) => Iterable<IGameActor>
    }

    // Check if player has any remaining harvesters
    if (world.actorsHavingTrait) {
      const harvesters = world.actorsHavingTrait('Harvester')
      for (const h of harvesters) {
        if (h.owner === this.self.owner) return
      }
    }

    // Find a refinery with FreeActorWithDelivery
    if (world.actorsHavingTrait) {
      const refineries = world.actorsHavingTrait('Refinery')
      for (const r of refineries) {
        if (r.owner !== this.self.owner) continue

        const rInfo = (r as unknown as Record<string, unknown>).info as Record<string, unknown> | undefined
        if (typeof rInfo?.hasTraitInfo === 'function') {
          if (!rInfo.hasTraitInfo('FreeActorWithDelivery')) continue
        }

        const rAny = r as unknown as Record<string, unknown>
        const delivery = typeof rAny['trait'] === 'function'
          ? (rAny['trait'] as (name: string) => unknown)('FreeActorWithDelivery') as IFreeActorWithDeliveryLike | undefined
          : undefined
        if (!delivery || !delivery.info) continue

        const deliveryInfo = delivery.info
        const loc = (rAny['location'] as { X: number; Y: number } | undefined) ?? { X: 0, Y: 0 }
        const deliveryOffset = deliveryInfo.deliveryOffset ?? { X: 0, Y: 0 }
        const deliveryPos = {
          X: loc.X + deliveryOffset.X,
          Y: loc.Y + deliveryOffset.Y,
        }

        delivery.doDelivery(
          deliveryPos,
          deliveryInfo.actor ?? 'harvester',
          deliveryInfo.deliveringActor ?? 'carryall',
        )
        return
      }
    }
  }
}
