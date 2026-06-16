/**
 * DonateExperience.ts — 捐赠经验活动 (extends Enter)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/DonateExperience.cs
 *
 * 核心范式转换:
 * - C# sealed class DonateExperience : Enter → TypeScript class DonateExperience extends Enter
 * - C# targetActor.Trait<GainsExperience>() → TypeScript duck-typed GainsExperienceLike
 * - C# self.Owner.PlayerActor.Trait<PlayerExperience>() → TypeScript duck-typed PlayerExperienceLike
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  GainsExperienceLike,
  PlayerExperienceLike,
} from './UtilityActivityInterfaces.js'

// ---------------------------------------------------------------------------
// DonateExperience
// ---------------------------------------------------------------------------

/**
 * 捐赠经验 — 进入目标 actor 并给予等级提升。
 *
 * OpenRA 对照: DonateExperience sealed class
 *
 * 继承 Enter 基类。TryStartEnter 检查目标是否有 GainsExperience 且未满级。
 * OnEnterComplete 执行等级提升和经验奖励。
 */
export class DonateExperience extends Enter {
  private readonly level: number
  private readonly playerExperience: number

  private enterActor: GameActor | null = null
  private enterGainsExperience: GainsExperienceLike | null = null

  constructor(
    self: GameActor,
    target: Target,
    level: number,
    playerExperience: number,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, targetLineColor)
    this.level = level
    this.playerExperience = playerExperience
  }

  protected override tryStartEnter(self: GameActor, targetActor: GameActor): boolean {
    this.enterActor = targetActor
    this.enterGainsExperience = DonateExperience._resolveGainsExperience(targetActor)

    if (this.enterGainsExperience === null ||
        this.enterGainsExperience.level >= this.enterGainsExperience.maxLevel) {
      this.cancel(self, true)
      return false
    }

    return true
  }

  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    if (targetActor !== this.enterActor) return
    if (this.enterGainsExperience === null) return
    if (this.enterGainsExperience.level >= this.enterGainsExperience.maxLevel) return

    this.enterGainsExperience.giveLevels(this.level)

    // Award experience to the donating player
    const selfOwner = (self as unknown as { owner?: { playerActor?: GameActor } }).owner
    const targetOwner = (targetActor as unknown as { owner?: unknown }).owner
    if (selfOwner?.playerActor && targetOwner !== selfOwner) {
      const playerExp = DonateExperience._resolvePlayerExperience(selfOwner.playerActor)
      if (playerExp) {
        playerExp.giveExperience(this.playerExperience)
      }
    }

    self.dispose()
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  private static _resolveGainsExperience(actor: GameActor): GainsExperienceLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<GainsExperienceLike>
      if (typeof t.giveLevels === 'function') return t as GainsExperienceLike
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
}
