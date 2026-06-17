/**
 * InfiltrateForDecoration.ts — 渗透后为目标建筑添加装饰标记
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForDecoration.cs (59 lines)
 *
 * 核心范式转换:
 * - C# WithDecoration inheritance → TS composition with INotifyInfiltrated
 * - C# HashSet<Player> infiltrators → TS Set referencing PlayerStub
 * - C# ShouldRender override → TS duck-typed rendering check
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type INotifyInfiltrated } from './InfiltrationInterfaces.js'

function typesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const bSet = new Set(b)
  return a.some((t) => bSet.has(t))
}

// ---------------------------------------------------------------------------
// InfiltrateForDecorationInfo
// ---------------------------------------------------------------------------

export class InfiltrateForDecorationInfo {
  readonly types: readonly string[] = []
  readonly playerExperience: number = 0
  readonly validRelationships: PlayerRelationship =
    (PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
  readonly sequence: string = ''
  readonly palette: string = ''
  readonly image: string | null = null
  readonly reference: string = ''
  readonly requiresSelection: boolean = false

  constructor(params: Partial<InfiltrateForDecorationInfo> = {}) {
    this.types = params.types ?? []
    this.playerExperience = params.playerExperience ?? 0
    this.validRelationships =
      (params.validRelationships ??
        (PlayerRelationship.Neutral | PlayerRelationship.Enemy)) as PlayerRelationship
    this.sequence = params.sequence ?? ''
    this.palette = params.palette ?? ''
    this.image = params.image ?? null
    this.reference = params.reference ?? ''
    this.requiresSelection = params.requiresSelection ?? false
  }
}

// ---------------------------------------------------------------------------
// InfiltrateForDecoration
// ---------------------------------------------------------------------------

export class InfiltrateForDecoration implements INotifyInfiltrated {
  readonly info: InfiltrateForDecorationInfo
  private readonly infiltrators: Set<unknown> = new Set()

  constructor(info: InfiltrateForDecorationInfo) {
    this.info = info
  }

  infiltrated(
    _self: IGameActor,
    infiltrator: IGameActor,
    types: readonly string[],
  ): void {
    if (!typesOverlap(this.info.types, types)) return

    const infiltratorOwner = infiltrator.owner as unknown as {
      playerActor?: IGameActor & {
        getTrait?: <T>(_name: string) => T | undefined
      }
    }

    const playerExperience =
      infiltratorOwner?.playerActor?.getTrait?.<{
        giveExperience(xp: number): void
      }>('PlayerExperience')

    if (playerExperience && this.info.playerExperience > 0) {
      playerExperience.giveExperience(this.info.playerExperience)
    }

    this.infiltrators.add(infiltrator.owner)
  }

  shouldRender(self: IGameActor): boolean {
    const world = self.world as unknown as {
      renderPlayer?: unknown
    }
    const renderPlayer = world?.renderPlayer
    if (!renderPlayer) return false

    for (const infiltrator of this.infiltrators) {
      const rel = (infiltrator as {
        relationshipWith?: (other: unknown) => number
      }).relationshipWith?.(renderPlayer) ?? PlayerRelationship.None
      if (this.info.validRelationships & rel) return true
    }
    return false
  }

  getInfiltratorPlayers(): ReadonlySet<unknown> {
    return this.infiltrators
  }
}
