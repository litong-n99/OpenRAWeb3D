/**
 * InfiltrateForPowerOutage.ts — 渗透后触发停电效果
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForPowerOutage.cs (83 lines)
 *
 * 核心范式转换:
 * - C# PowerManager.TriggerPowerOutage → TS duck-typed power outage trigger
 * - C# INotifyOwnerChanged → TS owner-change listener (stub)
 * - C# PlayerExperience → TS duck-typed
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'
import { typesOverlap } from './InfiltrationUtils.js'

// ---------------------------------------------------------------------------
// InfiltrateForPowerOutageInfo
// ---------------------------------------------------------------------------

export class InfiltrateForPowerOutageInfo {
  readonly types: readonly string[] = []
  readonly duration: number = 500
  readonly playerExperience: number = 0
  readonly infiltratedNotification: string | null = null
  readonly infiltratedTextNotification: string | null = null
  readonly infiltrationNotification: string | null = null
  readonly infiltrationTextNotification: string | null = null

  constructor(params: Partial<InfiltrateForPowerOutageInfo> = {}) {
    this.types = params.types ?? []
    this.duration = params.duration ?? 500
    this.playerExperience = params.playerExperience ?? 0
    this.infiltratedNotification = params.infiltratedNotification ?? null
    this.infiltratedTextNotification = params.infiltratedTextNotification ?? null
    this.infiltrationNotification = params.infiltrationNotification ?? null
    this.infiltrationTextNotification = params.infiltrationTextNotification ?? null
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForPowerOutage
// OpenRA 对照: InfiltrateForPowerOutage : INotifyOwnerChanged, INotifyInfiltrated
// ---------------------------------------------------------------------------

/**
 * Causes a power outage for the target player when their building is
 * infiltrated. All power-dependent structures go offline for the duration.
 *
 * OpenRA 对照: InfiltrateForPowerOutage
 */
export class InfiltrateForPowerOutage implements INotifyInfiltrated {
  readonly info: InfiltrateForPowerOutageInfo

  /** Duck-typed PowerManager reference. */
  private playerPower: {
    triggerPowerOutage(duration: number): void
  } | null = null

  constructor(info: InfiltrateForPowerOutageInfo) {
    this.info = info
  }

  /** Initialize after actor creation: cache PowerManager reference.
   *
   *  OpenRA 对照: InfiltrateForPowerOutage constructor
   */
  init(self: IGameActor): void {
    const owner = self.owner as unknown as {
      playerActor?: IGameActor & {
        getTrait?: <T>(_: string) => T | undefined
      }
    }
    this.playerPower =
      owner?.playerActor?.getTrait?.<{
        triggerPowerOutage(duration: number): void
      }>('PowerManager') ?? null
  }

  /** Called when the owner changes: refresh PowerManager reference.
   *
   *  OpenRA 对照: InfiltrateForPowerOutage.OnOwnerChanged()
   */
  onOwnerChanged(self: IGameActor): void {
    this.init(self)
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

    // Trigger power outage
    if (!this.playerPower) this.init(self)
    this.playerPower?.triggerPowerOutage(this.info.duration)

    // Sound/text notifications are stubs (require Ch7 Phase D)
  }
}
