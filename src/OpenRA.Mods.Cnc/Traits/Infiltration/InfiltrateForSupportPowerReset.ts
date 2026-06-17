/**
 * InfiltrateForSupportPowerReset.ts — 渗透后重置目标所有支援技能冷却时间
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForSupportPowerReset.cs (77 lines)
 *
 * 核心范式转换:
 * - C# SupportPowerManager.GetPowersForActor → TS duck-typed trait access
 * - C# SupportPower.ResetTimer → TS duck-typed method call
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'
import { typesOverlap } from './InfiltrationUtils.js'

// ---------------------------------------------------------------------------
// InfiltrateForSupportPowerResetInfo
// ---------------------------------------------------------------------------

export class InfiltrateForSupportPowerResetInfo {
  readonly types: readonly string[] = []
  readonly playerExperience: number = 0
  readonly infiltratedNotification: string | null = null
  readonly infiltratedTextNotification: string | null = null
  readonly infiltrationNotification: string | null = null
  readonly infiltrationTextNotification: string | null = null

  constructor(params: Partial<InfiltrateForSupportPowerResetInfo> = {}) {
    this.types = params.types ?? []
    this.playerExperience = params.playerExperience ?? 0
    this.infiltratedNotification = params.infiltratedNotification ?? null
    this.infiltratedTextNotification = params.infiltratedTextNotification ?? null
    this.infiltrationNotification = params.infiltrationNotification ?? null
    this.infiltrationTextNotification = params.infiltrationTextNotification ?? null
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForSupportPowerReset
// OpenRA 对照: InfiltrateForSupportPowerReset : INotifyInfiltrated
// ---------------------------------------------------------------------------

/**
 * Resets the charge timer on all of the target player's support powers
 * that are associated with the infiltrated actor.
 *
 * OpenRA 对照: InfiltrateForSupportPowerReset
 */
export class InfiltrateForSupportPowerReset
  implements INotifyInfiltrated
{
  readonly info: InfiltrateForSupportPowerResetInfo

  constructor(info: InfiltrateForSupportPowerResetInfo) {
    this.info = info
  }

  infiltrated(
    self: IGameActor,
    infiltrator: IGameActor,
    types: readonly string[],
  ): void {
    if (!typesOverlap(this.info.types, types)) return

    // Grant experience
    const infiltratorOwner = infiltrator.owner as unknown as {
      playerActor?: IGameActor & { getTrait?: <T>(_: string) => T | undefined }
    }
    infiltratorOwner?.playerActor
      ?.getTrait?.<{ giveExperience(xp: number): void }>('PlayerExperience')
      ?.giveExperience(this.info.playerExperience)

    // Access SupportPowerManager on the target player
    const selfOwner = self.owner as unknown as {
      playerActor?: IGameActor & {
        getTrait?: <T>(_: string) => T | undefined
      }
    }
    const manager = selfOwner?.playerActor?.getTrait?.<{
      getPowersForActor(actor: IGameActor): Array<{
        disabled?: boolean
        resetTimer(): void
      }>
    }>('SupportPowerManager')

    if (manager) {
      const powers = manager
        .getPowersForActor(self)
        .filter((sp) => !sp.disabled)

      for (const power of powers) {
        power.resetTimer()
      }
    }

    // Sound/text notifications are stubs (require Ch7 Phase D)
  }
}
