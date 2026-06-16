/**
 * DonateCash.ts — 捐赠资金活动 (extends Enter)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/DonateCash.cs
 *
 * 核心范式转换:
 * - C# sealed class DonateCash : Enter → TypeScript class DonateCash extends Enter
 * - C# targetOwner.PlayerActor.Trait<PlayerResources>() → TypeScript duck-typed PlayerResourcesLike
 * - C# self.Owner.PlayerActor.Trait<PlayerExperience>() → TypeScript duck-typed PlayerExperienceLike
 * - C# FloatingText effect → TypeScript stub (FloatingText not yet migrated)
 * - C# INotifyCashTransfer → TypeScript INotifyCashTransferLike duck type
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  PlayerResourcesLike,
  PlayerExperienceLike,
  INotifyCashTransferLike,
} from './UtilityActivityInterfaces.js'

// ---------------------------------------------------------------------------
// DonateCash
// ---------------------------------------------------------------------------

/**
 * 捐赠资金 — 进入目标 actor 并捐赠现金。
 *
 * OpenRA 对照: DonateCash sealed class
 *
 * 继承 Enter 基类。OnEnterComplete 中执行资金转移、经验奖励和通知。
 */
export class DonateCash extends Enter {
  private readonly payload: number
  private readonly playerExperience: number

  constructor(
    self: GameActor,
    target: Target,
    payload: number,
    playerExperience: number,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, targetLineColor)
    this.payload = payload
    this.playerExperience = playerExperience
  }

  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    const targetOwner = (targetActor as unknown as { owner?: { playerActor?: GameActor } }).owner
    const selfOwner = (self as unknown as { owner?: { playerActor?: GameActor; isAlliedWith?: (p: unknown) => boolean } }).owner

    // Transfer cash via PlayerResources trait
    if (targetOwner?.playerActor) {
      const playerResources = DonateCash._resolvePlayerResources(targetOwner.playerActor)
      if (playerResources) {
        playerResources.changeCash(this.payload)
      }
    }

    // Award experience to the donating player
    if (selfOwner?.playerActor && targetOwner !== selfOwner) {
      const playerExp = DonateCash._resolvePlayerExperience(selfOwner.playerActor)
      if (playerExp) {
        playerExp.giveExperience(this.playerExperience)
      }
    }

    // Notify INotifyCashTransfer on target
    const targetNotifiers = DonateCash._resolveCashTransferNotifiers(targetActor)
    for (const nct of targetNotifiers) {
      nct.onAcceptingCash(targetActor, self)
    }

    // Notify INotifyCashTransfer on self
    const selfNotifiers = DonateCash._resolveCashTransferNotifiers(self)
    for (const nct of selfNotifiers) {
      nct.onDeliveringCash(self, targetActor)
    }

    // Dispose self
    self.dispose()
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  private static _resolvePlayerResources(actor: GameActor): PlayerResourcesLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<PlayerResourcesLike>
      if (typeof t.changeCash === 'function') return t as PlayerResourcesLike
    }
    return null
  }

  private static _resolvePlayerExperience(actor: GameActor): PlayerExperienceLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<PlayerExperienceLike>
      if (typeof t.giveExperience === 'function') return t as PlayerExperienceLike
    }
    return null
  }

  private static _resolveCashTransferNotifiers(actor: GameActor): INotifyCashTransferLike[] {
    const result: INotifyCashTransferLike[] = []
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyCashTransferLike>
      if (typeof t.onAcceptingCash === 'function') result.push(t as INotifyCashTransferLike)
    }
    return result
  }
}
