/**
 * InfiltrateForExploration.ts — 渗透后窃取并重置目标的探索视野
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForExploration.cs (79 lines)
 *
 * 核心范式转换:
 * - C# Shroud.Explore/ResetExploration → TS duck-typed shroud access
 * - C# IPreventsShroudReset → TS duck-typed trait query
 * - C# PlayerExperience.GiveExperience → TS duck-typed
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'
import { typesOverlap } from './InfiltrationUtils.js'

// ---------------------------------------------------------------------------
// InfiltrateForExplorationInfo
// ---------------------------------------------------------------------------

export class InfiltrateForExplorationInfo {
  readonly types: readonly string[] = []
  readonly playerExperience: number = 0
  readonly infiltratedNotification: string | null = null
  readonly infiltratedTextNotification: string | null = null
  readonly infiltrationNotification: string | null = null
  readonly infiltrationTextNotification: string | null = null

  constructor(params: Partial<InfiltrateForExplorationInfo> = {}) {
    this.types = params.types ?? []
    this.playerExperience = params.playerExperience ?? 0
    this.infiltratedNotification = params.infiltratedNotification ?? null
    this.infiltratedTextNotification = params.infiltratedTextNotification ?? null
    this.infiltrationNotification = params.infiltrationNotification ?? null
    this.infiltrationTextNotification = params.infiltrationTextNotification ?? null
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForExploration
// OpenRA 对照: InfiltrateForExploration : INotifyInfiltrated
// ---------------------------------------------------------------------------

/**
 * Steals the target player's shroud exploration and gives it to the
 * infiltrator. Then resets the target's own exploration unless prevented.
 *
 * OpenRA 对照: InfiltrateForExploration
 */
export class InfiltrateForExploration implements INotifyInfiltrated {
  readonly info: InfiltrateForExplorationInfo

  constructor(info: InfiltrateForExplorationInfo) {
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

    // Access shroud via duck-typed player
    const selfOwner = self.owner as unknown as {
      shroud?: {
        explore(other: unknown): void
        resetExploration(): void
      }
      playerActor?: IGameActor & {
        traitsImplementing?: <T>(_: string) => T[]
      }
    }
    const infOwner = infiltrator.owner as unknown as {
      shroud?: {
        explore(other: unknown): void
      }
    }

    const selfShroud = selfOwner?.shroud
    const infiltratorShroud = infOwner?.shroud

    if (selfShroud && infiltratorShroud) {
      // Steal exploration: infiltrator explores what the victim explored
      infiltratorShroud.explore(selfShroud)

      // Reset victim's exploration unless prevented
      const preventReset = selfOwner?.playerActor
        ?.traitsImplementing?.<{ preventShroudReset?(actor: IGameActor): boolean }>('IPreventsShroudReset')
        ?.some((p) => p.preventShroudReset?.(self) ?? false)

      if (!preventReset) {
        selfShroud.resetExploration()
      }
    }

    // Sound/text notifications are stubs (require Ch7 Phase D)
  }
}
