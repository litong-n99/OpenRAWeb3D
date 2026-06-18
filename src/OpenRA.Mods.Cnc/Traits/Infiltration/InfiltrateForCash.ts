/**
 * InfiltrateForCash.ts — 渗透偷钱效果（从目标玩家转移资金）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForCash.cs (100 lines)
 *
 * 核心范式转换:
 * - C# INotifyInfiltrated.Infiltrated → TS INotifyInfiltrated.infiltrated
 * - C# Game.Sound.PlayNotification → TS sound playback stub (forward reference)
 * - C# TextNotificationsManager → TS text notification stub
 * - C# FloatingText — deferred to E2E visual test
 * - C# PlayerResources.TakeCash/GiveCash → TS duck-typed access
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'
import { typesOverlap } from './InfiltrationUtils.js'

// ---------------------------------------------------------------------------
// InfiltrateForCashInfo
// OpenRA 对照: InfiltrateForCashInfo : TraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the InfiltrateForCash trait.
 *
 *  OpenRA 对照: InfiltrateForCashInfo
 */
export class InfiltrateForCashInfo {
  /** The TargetTypes from Targetable that are allowed to trigger this effect. */
  readonly types: readonly string[] = []

  /** Percentage of the victim's resources that will be stolen. */
  readonly percentage: number = 100

  /** Amount of guaranteed funds to claim when the victim lacks resources.
   *  When negative, uses the infiltrating actor's production cost instead. */
  readonly minimum: number = -1

  /** Maximum amount of funds which will be stolen. */
  readonly maximum: number = Number.MAX_SAFE_INTEGER

  /** Experience to grant to the infiltrating player. */
  readonly playerExperience: number = 0

  /** Experience to grant based on cash stolen (percentage of cash as XP). */
  readonly playerExperiencePercentage: number = 0

  /** Sound the victim will hear when they get robbed. */
  readonly infiltratedNotification: string | null = null

  /** Text notification the victim will see when they get robbed. */
  readonly infiltratedTextNotification: string | null = null

  /** Sound the perpetrator will hear after successful infiltration. */
  readonly infiltrationNotification: string | null = null

  /** Text notification the perpetrator will see after successful infiltration. */
  readonly infiltrationTextNotification: string | null = null

  /** Whether to show the cash tick indicators rising from the actor. */
  readonly showTicks: boolean = true

  constructor(params: Partial<InfiltrateForCashInfo> = {}) {
    this.types = params.types ?? []
    this.percentage = params.percentage ?? 100
    this.minimum = params.minimum ?? -1
    this.maximum = params.maximum ?? Number.MAX_SAFE_INTEGER
    this.playerExperience = params.playerExperience ?? 0
    this.playerExperiencePercentage = params.playerExperiencePercentage ?? 0
    this.infiltratedNotification = params.infiltratedNotification ?? null
    this.infiltratedTextNotification = params.infiltratedTextNotification ?? null
    this.infiltrationNotification = params.infiltrationNotification ?? null
    this.infiltrationTextNotification = params.infiltrationTextNotification ?? null
    this.showTicks = params.showTicks ?? true
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForCash
// OpenRA 对照: InfiltrateForCash : INotifyInfiltrated
// ---------------------------------------------------------------------------

/**
 * Steals cash from the infiltrated player and gives it to the infiltrator's
 * player. The amount is a percentage of the target's total cash+resources,
 * bounded by minimum and maximum values.
 *
 * OpenRA 对照: InfiltrateForCash
 */
export class InfiltrateForCash implements INotifyInfiltrated {
  readonly info: InfiltrateForCashInfo

  constructor(info: InfiltrateForCashInfo) {
    this.info = info
  }

  /** Execute the cash-stealing effect.
   *
   *  OpenRA 对照: InfiltrateForCash.Infiltrated()
   */
  infiltrated(
    self: IGameActor,
    infiltrator: IGameActor,
    types: readonly string[],
  ): void {
    if (!typesOverlap(this.info.types, types)) return

    const selfOwner = self.owner as unknown as {
      playerActor?: IGameActor & {
        getTrait?: <T>(_name: string) => T | undefined
      }
    }
    const infiltratorOwner = infiltrator.owner as unknown as {
      playerActor?: IGameActor & {
        getTrait?: <T>(_name: string) => T | undefined
      }
    }

    // Access PlayerResources via duck-typed player actor
    const targetResources = selfOwner?.playerActor?.getTrait?.<{
      cash: number
      resources: number
      takeCash(n: number): void
      giveCash(n: number): void
    }>('PlayerResources')

    const spyResources = infiltratorOwner?.playerActor?.getTrait?.<{
      cash: number
      resources: number
      takeCash(n: number): void
      giveCash(n: number): void
    }>('PlayerResources')

    if (!targetResources || !spyResources) return

    // Calculate amount to steal
    const totalTargetWealth = targetResources.cash + targetResources.resources
    const toTake = Math.min(
      this.info.maximum,
      Math.floor(totalTargetWealth * this.info.percentage / 100),
    )

    // Determine guaranteed minimum payout
    let minPayout = 0
    if (this.info.minimum >= 0) {
      minPayout = this.info.minimum
    } else {
      // Use infiltrator's production cost (Valued trait)
      const spyInfo = (infiltrator.info as unknown as {
        getTraitInfo?: <T>(_name: string) => T | undefined
      })
      const valuedInfo = spyInfo?.getTraitInfo?.<{ cost: number }>('Valued')
      minPayout = valuedInfo?.cost ?? 0
    }

    const toGive = Math.max(toTake, minPayout)

    targetResources.takeCash(toTake)
    spyResources.giveCash(toGive)

    // Grant experience to the infiltrator's player (matching OpenRA: infiltrator.Owner.PlayerActor)
    const playerExperience = infiltratorOwner?.playerActor?.getTrait?.<{
      giveExperience(xp: number): void
    }>('PlayerExperience')
    if (playerExperience) {
      playerExperience.giveExperience(
        this.info.playerExperience +
          Math.floor(toTake * this.info.playerExperiencePercentage / 100),
      )
    }

    // TODO: Play sound via Game.Sound.Play() when Game.Sound singleton is wired.
    // OpenRA 对照:
    //   Game.Sound.PlayNotification(world.Map.Rules, infiltrator.Owner, "Speech",
    //     info.InfiltrationNotification, infiltrator.Owner.Faction.InternalName)
    //   TextNotificationsManager.AddTransientLine(info.InfiltrationTextNotification, infiltrator.Owner)
    // Integration point (after cash transfer completes):
    //   const world = (self.world as any).gameWorld
    //   if (this.info.infiltratedNotification) {
    //     world.sound?.playNotification(world.map.rules, selfOwner, "Speech",
    //       this.info.infiltratedNotification, selfOwner.faction?.internalName)
    //   }
    //   if (this.info.infiltrationNotification) {
    //     world.sound?.playNotification(world.map.rules, infiltratorOwner, "Speech",
    //       this.info.infiltrationNotification, infiltratorOwner.faction?.internalName)
    //   }
    // Full implementation requires Game.Sound singleton + TextNotificationsManager (Ch16)
  }
}
