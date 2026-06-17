/**
 * InfiltrateForSupportPower.ts — 渗透后授予一次性支援技能使用权
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForSupportPower.cs (80 lines)
 *
 * 核心范式转换:
 * - C# world.CreateActor(proxy, [OwnerInit]) → TS deferred actor creation stub
 * - C# frameEndTasks → TS duck-typed world.addFrameEndTask
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'
import { typesOverlap } from './InfiltrationUtils.js'

// ---------------------------------------------------------------------------
// InfiltrateForSupportPowerInfo
// ---------------------------------------------------------------------------

export class InfiltrateForSupportPowerInfo {
  /** The proxy actor to create (grants the support power). */
  readonly proxy: string = ''
  readonly types: readonly string[] = []
  readonly playerExperience: number = 0
  readonly infiltratedNotification: string | null = null
  readonly infiltratedTextNotification: string | null = null
  readonly infiltrationNotification: string | null = null
  readonly infiltrationTextNotification: string | null = null

  constructor(params: Partial<InfiltrateForSupportPowerInfo> = {}) {
    this.proxy = params.proxy ?? ''
    this.types = params.types ?? []
    this.playerExperience = params.playerExperience ?? 0
    this.infiltratedNotification = params.infiltratedNotification ?? null
    this.infiltratedTextNotification = params.infiltratedTextNotification ?? null
    this.infiltrationNotification = params.infiltrationNotification ?? null
    this.infiltrationTextNotification = params.infiltrationTextNotification ?? null
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForSupportPower
// OpenRA 对照: InfiltrateForSupportPower : INotifyInfiltrated
// ---------------------------------------------------------------------------

/**
 * Grants a one-time use of a support power to the infiltrator by creating
 * a proxy actor owned by the infiltrator's player.
 *
 * OpenRA 对照: InfiltrateForSupportPower
 */
export class InfiltrateForSupportPower implements INotifyInfiltrated {
  readonly info: InfiltrateForSupportPowerInfo

  constructor(info: InfiltrateForSupportPowerInfo) {
    this.info = info
  }

  infiltrated(
    _self: IGameActor,
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

    // Deferred actor creation: creates the proxy actor for the infiltrator
    const world = infiltrator.world as unknown as {
      addFrameEndTask?: (task: (w: unknown) => void) => void
      createActor?: (name: string, init: unknown[]) => unknown
    }

    world?.addFrameEndTask?.((w: unknown) => {
      const wAny = w as {
        createActor?: (name: string, init: unknown[]) => unknown
      }
      wAny.createActor?.(this.info.proxy, [
        { owner: infiltrator.owner },
      ])
    })

    // TODO-19.A.14-SOUND: Play infiltrated/infiltration notifications via Ch7 Sound system
  }
}
