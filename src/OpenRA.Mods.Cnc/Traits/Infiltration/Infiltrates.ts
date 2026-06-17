/**
 * Infiltrates.ts -- 基础渗透特性（间谍/工程师进入敌方建筑触发效果）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Infiltration/Infiltrates.cs (156 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<InfiltratesInfo> + IIssueOrder + IResolveOrder → TS ConditionalTrait + implements
 * - C# InfiltrationOrderTargeter extends UnitOrderTargeter → TS inner class
 * - C# EnterBehaviour enum → TS const object (reused from Enter.ts)
 * - C# self.QueueActivity(Infiltrate(...)) → QueueChild pattern
 *
 * ADR-19.3: Composition order is cash → decoration → exploration → power →
 * support → reset → transform.
 */

import { TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import {
  ConditionalTrait,
  PlayerRelationship,
  type ConditionalTraitInfo,
  type IGameActor,
  type IIssueOrder,
  type IOrderTargeter,
  type IOrderVoice,
  type IResolveOrder,
  type Order,
  TargetModifiers,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { UnitOrderTargeter } from '../../../OpenRA.Mods.Common/Orders/UnitOrderTargeter.js'
import { EnterBehaviour } from '../../../OpenRA.Mods.Common/Activities/Enter.js'

// ---------------------------------------------------------------------------
// Helper: check array overlap (BitSet.Overlaps emulation)
// ---------------------------------------------------------------------------

function typesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const bSet = new Set(b)
  return a.some((t) => bSet.has(t))
}

// ---------------------------------------------------------------------------
// InfiltratesInfo
// OpenRA 对照: InfiltratesInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

export class InfiltratesInfo implements ConditionalTraitInfo {
  readonly requiresCondition?: string
  readonly types: readonly string[] = []
  readonly voice: string = 'Action'
  readonly targetLineColor: string = 'Crimson'
  readonly validRelationships: PlayerRelationship =
    (PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
  readonly enterBehaviour: EnterBehaviour = EnterBehaviour.Dispose
  readonly notification: string | null = null
  readonly textNotification: string | null = null
  readonly enterCursor: string = 'enter'

  constructor(params: Partial<InfiltratesInfo> = {}) {
    this.requiresCondition = params.requiresCondition
    this.types = params.types ?? []
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? 'Crimson'
    this.validRelationships =
      (params.validRelationships ??
        (PlayerRelationship.Neutral | PlayerRelationship.Enemy)) as PlayerRelationship
    this.enterBehaviour = params.enterBehaviour ?? EnterBehaviour.Dispose
    this.notification = params.notification ?? null
    this.textNotification = params.textNotification ?? null
    this.enterCursor = params.enterCursor ?? 'enter'
  }
}

// ---------------------------------------------------------------------------
// Infiltrates
// OpenRA 对照: Infiltrates : ConditionalTrait<InfiltratesInfo>, IIssueOrder, IResolveOrder, IOrderVoice
// ---------------------------------------------------------------------------

export class Infiltrates
  extends ConditionalTrait<InfiltratesInfo>
  implements IIssueOrder, IResolveOrder, IOrderVoice
{
  private readonly _infiltrationOrderTargeter: InfiltrationOrderTargeter

  constructor(info: InfiltratesInfo) {
    super(info)
    this._infiltrationOrderTargeter = new InfiltrationOrderTargeter(info)
  }

  // -- IIssueOrder --

  get orders(): readonly IOrderTargeter[] {
    if (this.isTraitDisabled) return []
    return [this._infiltrationOrderTargeter]
  }

  issueOrder(
    _self: IGameActor,
    order: IOrderTargeter,
    target: TargetType_,
    queued: boolean,
  ): Order {
    if (order.orderID !== 'Infiltrate')
      return { orderName: '', targetString: '', extraData: undefined }

    return {
      orderName: order.orderID,
      targetString: target.toString?.() ?? '',
      extraData: { queued },
    }
  }

  // -- IOrderVoice --

  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (order.orderName === 'Infiltrate' && this.isValidOrder(order))
      return this.info.voice
    return ''
  }

  // -- Validation --

  isValidOrder(order: Order): boolean {
    if (this.isTraitDisabled) return false
    const target = (order as unknown as { target?: TargetType_ }).target
    if (!target) return false

    let targetTypes: readonly string[] = []
    if (target.type === TargetType.FrozenActor) {
      const fa = (target as unknown as { frozenActor?: { targetTypes?: readonly string[] } }).frozenActor
      targetTypes = fa?.targetTypes ?? []
    }
    if (target.type === TargetType.Actor) {
      const actor = (target as unknown as { actor?: IGameActor & { getEnabledTargetTypes?: () => readonly string[] } }).actor
      targetTypes = actor?.getEnabledTargetTypes?.() ?? []
    }
    return typesOverlap(this.info.types, targetTypes)
  }

  canInfiltrateTarget(_self: IGameActor, target: TargetType_): boolean {
    switch (target.type) {
      case TargetType.Actor: {
        const td = target as unknown as {
          actor?: IGameActor & {
            getEnabledTargetTypes?: () => readonly string[]
            owner?: { relationshipWith?: (other: unknown) => number }
          }
        }
        if (!td.actor) return false
        const targetTypes = td.actor.getEnabledTargetTypes?.() ?? []
        const relationship =
          td.actor.owner?.relationshipWith?.((_self as IGameActor).owner) ?? PlayerRelationship.None
        return (
          typesOverlap(this.info.types, targetTypes) &&
          (this.info.validRelationships & relationship) !== 0
        )
      }
      case TargetType.FrozenActor: {
        const td = target as unknown as {
          frozenActor?: {
            visible?: boolean
            targetTypes?: readonly string[]
            owner?: PlayerRelationship
          }
        }
        if (!td.frozenActor?.visible) return false
        const targetTypes = td.frozenActor.targetTypes ?? []
        const relationship =
          (td.frozenActor.owner ?? PlayerRelationship.None) as number
        return (
          typesOverlap(this.info.types, targetTypes) &&
          (this.info.validRelationships & relationship) !== 0
        )
      }
      default:
        return false
    }
  }

  // -- IResolveOrder --

  resolveOrder(self: IGameActor, order: Order): void {
    if (
      order.orderName !== 'Infiltrate' ||
      !this.isValidOrder(order) ||
      this.isTraitDisabled
    )
      return

    const target = (order as unknown as { target?: TargetType_ }).target
    if (!target) return
    if (!this.canInfiltrateTarget(self, target)) return

    const queued =
      (order.extraData as { queued?: boolean })?.queued ?? false

    const actorAny = self as unknown as {
      queueActivity?: (queued: boolean, activity: unknown) => void
      showTargetLines?: () => void
    }

    const infiltrateActivity = {
      __type: 'Infiltrate',
      infiltrates: this,
      target,
      targetLineColor: this.info.targetLineColor,
    }

    actorAny.queueActivity?.(queued, infiltrateActivity)
    actorAny.showTargetLines?.()
  }
}

// ---------------------------------------------------------------------------
// InfiltrationOrderTargeter
// ---------------------------------------------------------------------------

class InfiltrationOrderTargeter extends UnitOrderTargeter {
  private readonly _info: InfiltratesInfo

  constructor(info: InfiltratesInfo) {
    super('Infiltrate', 7, info.enterCursor, true, true)
    this._info = info
  }

  override canTargetActor(
    self: IGameActor,
    target: IGameActor,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    const stance = (self.owner as { relationshipWith?: (other: unknown) => number } | undefined)
      ?.relationshipWith?.(target.owner) ?? PlayerRelationship.None
    if (!(this._info.validRelationships & (stance as number))) return false

    const actorAny = target as unknown as { getAllTargetTypes?: () => readonly string[] }
    const allTypes = actorAny.getAllTargetTypes?.() ?? []
    return allTypes.some((t) => this._info.types.includes(t))
  }

  override canTargetFrozenActor(
    self: IGameActor,
    target: { visible?: boolean; targetTypes?: readonly string[]; owner?: unknown },
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    const stance = (self.owner as { relationshipWith?: (other: unknown) => number } | undefined)
      ?.relationshipWith?.(target.owner) ?? PlayerRelationship.None
    if (!(this._info.validRelationships & (stance as number))) return false

    const allTypes = target.targetTypes ?? []
    return allTypes.some((t) => this._info.types.includes(t))
  }
}
