/**
 * InfiltrateForTransform.ts — 渗透后将目标建筑变形为其他单位
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForTransform.cs (72 lines)
 *
 * 核心范式转换:
 * - C# Transform activity → TS duck-typed Transform activity queuing
 * - C# IFacing trait access → TS duck-typed facing query
 * - C# ActorInitializer.GetValue<FactionInit> → TS faction stored from init
 * - C# QueueActivity(false, transform) → TS activity queuing
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'
import { typesOverlap } from './InfiltrationUtils.js'
import type { WAngle } from '../../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// InfiltrateForTransformInfo
// ---------------------------------------------------------------------------

export class InfiltrateForTransformInfo {
  /** Actor type to transform into. */
  readonly intoActor: string = ''
  /** Health percentage to apply after transformation (0 = use default). */
  readonly forceHealthPercentage: number = 0
  /** Whether to skip the construction animation. */
  readonly skipMakeAnims: boolean = true
  /** Experience to grant to the infiltrating player. */
  readonly playerExperience: number = 0
  /** Target types filter. */
  readonly types: readonly string[] = []

  constructor(params: Partial<InfiltrateForTransformInfo> = {}) {
    this.intoActor = params.intoActor ?? ''
    this.forceHealthPercentage = params.forceHealthPercentage ?? 0
    this.skipMakeAnims = params.skipMakeAnims ?? true
    this.playerExperience = params.playerExperience ?? 0
    this.types = params.types ?? []
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForTransform
// OpenRA 对照: InfiltrateForTransform : INotifyInfiltrated
// ---------------------------------------------------------------------------

/**
 * Transforms the infiltrated building into a different actor type.
 * The transformation preserves the actor's facing and faction.
 *
 * OpenRA 对照: InfiltrateForTransform
 */
export class InfiltrateForTransform implements INotifyInfiltrated {
  readonly info: InfiltrateForTransformInfo

  /** The faction to use when creating the new actor. */
  private readonly faction: string

  constructor(init: unknown, info: InfiltrateForTransformInfo) {
    this.info = info

    // Extract faction from init
    const initAny = init as {
      getValue?: <T>(_key: string, _default: T) => T
      self?: IGameActor & {
        owner?: { faction?: { internalName?: string } }
      }
    }
    this.faction =
      initAny?.getValue?.<string>('FactionInit', '') ??
      initAny?.self?.owner?.faction?.internalName ??
      ''
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

    // Get the facing trait if available
    const selfAny = self as unknown as {
      getTrait?: <T>(_: string) => T | undefined
    }
    const facing = selfAny.getTrait?.<{ facing?: WAngle }>('IFacing')

    // Build Transform activity params
    const transformConfig: Record<string, unknown> = {
      intoActor: this.info.intoActor,
      forceHealthPercentage: this.info.forceHealthPercentage,
      faction: this.faction,
      skipMakeAnims: this.info.skipMakeAnims,
    }
    if (facing?.facing) {
      transformConfig.facing = facing.facing
    }

    // Queue the Transform activity
    const queueActor = self as unknown as {
      queueActivity?: (queued: boolean, activity: unknown) => void
    }
    queueActor.queueActivity?.(false, { __type: 'Transform', ...transformConfig })
  }
}
