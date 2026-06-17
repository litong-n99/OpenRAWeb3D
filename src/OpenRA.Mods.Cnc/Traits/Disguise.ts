/**
 * Disguise.ts — 单位伪装系统 (间谍伪装为敌方单位)
 * OpenRA 对照: OpenRA.OpenRA.Mods.Cnc/Traits/Disguise.cs (335 lines)
 *
 * 核心范式转换:
 * - C# 4 classes in 1 file → 4 exported classes + 1 enum
 * - C# Disguise does NOT extend ConditionalTrait (manages conditions manually)
 *   → TS same: standalone class with condition token management
 * - C# 11 explicit interfaces → TS implements all 11
 * - C# [Flags] enum RevealDisguiseType → TS const object
 * - C# FrozenDictionary<string,string> → TS Record<string,string>
 *
 * NOTE: 3D mesh swap for disguise visual is deferred to TODO-19.C.3.
 * NOTE: INotifyDemolition interface is defined locally since not yet in TraitsInterfaces.
 */

import type {
  IGameActor,
  ITraitInfo,
  PlayerStub,
  FrozenActorStub,
  IOrderTargeter,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  PlayerRelationship,
  PlayerRelationshipExts,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TargetType } from '../../OpenRA.Game/Traits/Target.js'
import { Order } from '../../OpenRA.Game/Network/Order.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import { UnitOrderTargeter } from '../../OpenRA.Mods.Common/Orders/UnitOrderTargeter.js'

// ---------------------------------------------------------------------------
// INotifyDemolition — local definition
// ---------------------------------------------------------------------------

export interface INotifyDemolition {
  demolishing(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// Stubs for interfaces not yet fully defined in TraitsInterfaces
// ---------------------------------------------------------------------------

interface ITooltipInfo {
  readonly isOwnerRowVisible: boolean
  tooltipForPlayerStance(stance: PlayerRelationship): string
}

interface ITooltip {
  readonly tooltipInfo: ITooltipInfo
  readonly owner: PlayerStub
}

interface ActorInfoStub {
  readonly name: string
  traitInfos<T>(type: string): T[]
}

interface CPosStub {
  readonly X: number
  readonly Y: number
}

// ---------------------------------------------------------------------------
// Condition token sentinel (OpenRA: Actor.InvalidConditionToken = -1)
// ---------------------------------------------------------------------------

const INVALID_CONDITION_TOKEN = -1

// ---------------------------------------------------------------------------
// RevealDisguiseType (Flags)
// OpenRA 对照: [Flags] enum RevealDisguiseType
// ---------------------------------------------------------------------------

export const RevealDisguiseType = {
  None: 0,
  Attack: 1,
  Damaged: 2,
  Load: 4,
  Unload: 8,
  Infiltrate: 16,
  Demolish: 32,
  Move: 64,
} as const
export type RevealDisguiseType = number & { __brand?: 'RevealDisguiseType' }

function hasFlag(value: RevealDisguiseType, flag: number): boolean {
  return (value & flag) !== 0
}

// ---------------------------------------------------------------------------
// DisguiseInfo
// OpenRA 对照: DisguiseInfo : TraitInfo
// ---------------------------------------------------------------------------

export interface DisguiseInfo extends ITraitInfo {
  readonly voice: string
  readonly disguisedCondition: string | null
  readonly validRelationships: PlayerRelationship
  readonly targetTypes: ReadonlySet<string>
  readonly revealDisguiseOn: RevealDisguiseType
  readonly disguisedAsConditions: Readonly<Record<string, string>>
  readonly cursor: string
}

export const DefaultDisguiseInfo = {
  voice: 'Action',
  disguisedCondition: null,
  validRelationships: (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship,
  targetTypes: new Set<string>(['Disguise']),
  revealDisguiseOn: RevealDisguiseType.Attack as RevealDisguiseType,
  disguisedAsConditions: {} as Record<string, string>,
  cursor: 'ability',
} as const

export function createDisguiseInfo(overrides?: Partial<DisguiseInfo>): DisguiseInfo {
  return {
    voice: overrides?.voice ?? DefaultDisguiseInfo.voice,
    disguisedCondition: overrides?.disguisedCondition ?? DefaultDisguiseInfo.disguisedCondition,
    validRelationships: overrides?.validRelationships ?? DefaultDisguiseInfo.validRelationships,
    targetTypes: overrides?.targetTypes ?? new Set(DefaultDisguiseInfo.targetTypes),
    revealDisguiseOn: overrides?.revealDisguiseOn ?? DefaultDisguiseInfo.revealDisguiseOn,
    disguisedAsConditions: overrides?.disguisedAsConditions ?? DefaultDisguiseInfo.disguisedAsConditions,
    cursor: overrides?.cursor ?? DefaultDisguiseInfo.cursor,
  }
}

// ---------------------------------------------------------------------------
// Disguise
// OpenRA 对照: Disguise : 11 interfaces
// ---------------------------------------------------------------------------

export class Disguise {
  // Public identity state (OpenRA: AsActor, AsPlayer, AsTooltipInfo)
  asActor: ActorInfoStub
  asPlayer: PlayerStub | null = null
  asTooltipInfo: ITooltipInfo | null = null

  private readonly _self: IGameActor
  private readonly _info: DisguiseInfo
  private _disguisedToken: number = INVALID_CONDITION_TOKEN
  private _disguisedAsToken: number = INVALID_CONDITION_TOKEN
  private _lastPos: CPosStub | null = null

  constructor(self: IGameActor, info: DisguiseInfo) {
    this._self = self
    this._info = info
    this.asActor = (self as any).info as ActorInfoStub
  }

  // ---------------------------------------------------------------------------
  // IEffectiveOwner
  // ---------------------------------------------------------------------------

  get disguised(): boolean { return this.asPlayer !== null }
  get owner(): PlayerStub | null { return this.asPlayer }

  // ---------------------------------------------------------------------------
  // IIssueOrder
  // ---------------------------------------------------------------------------

  get orders(): readonly IOrderTargeter[] {
    return [new DisguiseOrderTargeter(this._info)]
  }

  issueOrder(
    self: IGameActor,
    order: IOrderTargeter,
    target: Target,
    queued: boolean,
  ): Order {
    if (order.orderID === 'Disguise') {
      // OpenRA: new Order(order.OrderID, self, target, queued)
      return Order.withTarget(order.orderID, (self as any).actorId ?? 0, target, queued)
    }
    return null as unknown as Order
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // ---------------------------------------------------------------------------

  resolveOrder(self: IGameActor, order: Order): void {
    const os = order as any
    if (os.orderString === 'Disguise' || os.orderName === 'Disguise') {
      const target = os.target as any
      if (target?.type === TargetType.Actor) {
        const tgtActor = target.actor as IGameActor | undefined
        this._disguiseAs(
          (tgtActor && tgtActor !== (self as any) && (tgtActor as any).isInWorld)
            ? tgtActor : null,
        )
      }
      if (target?.type === TargetType.FrozenActor) {
        const fa = target.frozenActor as { info: ActorInfoStub; owner: PlayerStub } | undefined
        if (fa) this._disguiseFromFrozen(fa.info, fa.owner)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // IOrderVoice
  // ---------------------------------------------------------------------------

  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    const os = order as any
    return (os.orderString === 'Disguise' || os.orderName === 'Disguise')
      ? this._info.voice : null as unknown as string
  }

  // ---------------------------------------------------------------------------
  // DisguiseAs(Actor target) — core disguise logic
  // OpenRA 对照: Disguise.DisguiseAs(Actor)
  // ---------------------------------------------------------------------------

  _disguiseAs(target: IGameActor | null): void {
    const oldActor = this.asActor
    const oldOwner = this.asPlayer
    const oldDisguised = this.disguised

    if (target != null) {
      const targetDisguise = (target as any).getTrait?.('Disguise') as Disguise | undefined
      if (targetDisguise && targetDisguise.disguised) {
        // Chain-of-disguise
        if (
          targetDisguise.asActor.name === ((this._self as any).info as ActorInfoStub)?.name &&
          targetDisguise.asPlayer === this._self.owner
        ) {
          this.asTooltipInfo = null
          this.asPlayer = null
          this.asActor = (this._self as any).info as ActorInfoStub
        } else {
          this.asPlayer = targetDisguise.asPlayer
          this.asActor = targetDisguise.asActor
          this.asTooltipInfo = targetDisguise.asTooltipInfo
        }
      } else {
        if (
          ((target as any).info as any)?.name === ((this._self as any).info as any)?.name &&
          (target as any).owner === this._self.owner
        ) {
          this.asTooltipInfo = null
          this.asPlayer = null
          this.asActor = (this._self as any).info as ActorInfoStub
        } else {
          const tooltip = ((target as any).traitsImplementing?.('ITooltip') as ITooltip[])
            ?.find(() => true)
          if (!tooltip) throw new Error('Missing tooltip or invalid target.')
          this.asPlayer = tooltip.owner
          this.asActor = (target as any).info as ActorInfoStub
          this.asTooltipInfo = tooltip.tooltipInfo
        }
      }
    } else {
      this.asTooltipInfo = null
      this.asPlayer = null
      this.asActor = (this._self as any).info as ActorInfoStub
    }

    this._handleDisguise(oldActor, oldOwner, oldDisguised)
  }

  // ---------------------------------------------------------------------------
  // DisguiseAs(ActorInfo, Player) — frozen actor disguise
  // OpenRA 对照: Disguise.DisguiseAs(ActorInfo, Player)
  // ---------------------------------------------------------------------------

  _disguiseFromFrozen(actorInfo: ActorInfoStub, newOwner: PlayerStub): void {
    const oldActor = this.asActor
    const oldOwner = this.asPlayer
    const oldDisguised = this.disguised

    this.asPlayer = newOwner
    this.asActor = actorInfo
    this.asTooltipInfo =
      actorInfo.traitInfos<ITooltipInfo & { enabledByDefault?: boolean }>('TooltipInfo')
        .find((i) => (i as any).enabledByDefault ?? false) ?? null

    this._handleDisguise(oldActor, oldOwner, oldDisguised)
  }

  // ---------------------------------------------------------------------------
  // HandleDisguise — condition management + notification
  // OpenRA 对照: Disguise.HandleDisguise(ActorInfo, Player, bool)
  // ---------------------------------------------------------------------------

  private _handleDisguise(
    oldActor: ActorInfoStub,
    oldOwner: PlayerStub | null,
    oldDisguised: boolean,
  ): void {
    // Notify INotifyEffectiveOwnerChanged
    const notifies = (this._self as any).traitsImplementing?.('INotifyEffectiveOwnerChanged') as Array<{
      onEffectiveOwnerChanged: (a: IGameActor, o: PlayerStub | null, n: PlayerStub | null) => void
    }> | undefined
    if (notifies) {
      for (const n of notifies) {
        n.onEffectiveOwnerChanged(this._self, oldOwner, this.asPlayer)
      }
    }

    // Grant/revoke DisguisedCondition
    if (this.disguised !== oldDisguised) {
      if (this.disguised && this._disguisedToken === INVALID_CONDITION_TOKEN) {
        if (this._info.disguisedCondition) {
          this._disguisedToken = (this._self as any).grantCondition?.(this._info.disguisedCondition)
            ?? INVALID_CONDITION_TOKEN
        }
      } else if (!this.disguised && this._disguisedToken !== INVALID_CONDITION_TOKEN) {
        (this._self as any).revokeCondition?.(this._disguisedToken)
        this._disguisedToken = INVALID_CONDITION_TOKEN
      }
    }

    // Grant/revoke actor-specific conditions
    if (this.asActor !== oldActor) {
      if (this._disguisedAsToken !== INVALID_CONDITION_TOKEN) {
        (this._self as any).revokeCondition?.(this._disguisedAsToken)
        this._disguisedAsToken = INVALID_CONDITION_TOKEN
      }
      const condition = this._info.disguisedAsConditions[this.asActor.name]
      if (condition) {
        this._disguisedAsToken = (this._self as any).grantCondition?.(condition)
          ?? INVALID_CONDITION_TOKEN
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyAttack
  // ---------------------------------------------------------------------------

  preparingAttack(): void { /* no-op */ }
  attacking(): void {
    if (hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Attack)) {
      this._disguiseAs(null)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyDamage
  // ---------------------------------------------------------------------------

  damaged(_self: IGameActor, e: { damage?: { value?: number } }): void {
    if (
      hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Damaged) &&
      (e.damage?.value ?? 0) > 0
    ) {
      this._disguiseAs(null)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyLoadCargo / INotifyUnloadCargo
  // ---------------------------------------------------------------------------

  loading(): void {
    if (hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Load)) {
      this._disguiseAs(null)
    }
  }

  unloading(): void {
    if (hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Unload)) {
      this._disguiseAs(null)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyDemolition
  // ---------------------------------------------------------------------------

  demolishing(): void {
    if (hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Demolish)) {
      this._disguiseAs(null)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyInfiltration
  // ---------------------------------------------------------------------------

  infiltrating(): void {
    if (hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Infiltrate)) {
      this._disguiseAs(null)
    }
  }

  // ---------------------------------------------------------------------------
  // ITick — move detection
  // ---------------------------------------------------------------------------

  tick(): void {
    if (
      hasFlag(this._info.revealDisguiseOn, RevealDisguiseType.Move) &&
      this._lastPos !== null
    ) {
      const loc = (this._self as any).location as CPosStub | undefined
      if (loc && (this._lastPos.X !== loc.X || this._lastPos.Y !== loc.Y)) {
        this._disguiseAs(null)
      }
    }
    const loc = (this._self as any).location as CPosStub | undefined
    if (loc) this._lastPos = { X: loc.X, Y: loc.Y }
  }
}

// ---------------------------------------------------------------------------
// DisguiseTooltipInfo
// OpenRA 对照: DisguiseTooltipInfo : TooltipInfo, Requires<DisguiseInfo>
// ---------------------------------------------------------------------------

export interface DisguiseTooltipInfo {
  readonly name: string
  readonly isOwnerRowVisible: boolean
}

// ---------------------------------------------------------------------------
// DisguiseTooltip
// OpenRA 对照: DisguiseTooltip : ConditionalTrait<DisguiseTooltipInfo>, ITooltip
// ---------------------------------------------------------------------------

export class DisguiseTooltip {
  private readonly _actor: IGameActor
  private readonly _disguise: Disguise
  private readonly _info: DisguiseTooltipInfo

  constructor(self: IGameActor, info: DisguiseTooltipInfo) {
    this._actor = self
    this._info = info
    this._disguise = (self as any).getTrait?.('Disguise') as Disguise
  }

  get tooltipInfo(): ITooltipInfo {
    if (this._disguise.disguised && this._disguise.asTooltipInfo) {
      return this._disguise.asTooltipInfo
    }
    const that = this
    return {
      isOwnerRowVisible: this._info.isOwnerRowVisible,
      tooltipForPlayerStance(_s: PlayerRelationship): string {
        return that._info.name
      },
    }
  }

  get owner(): PlayerStub {
    if (!this._disguise.disguised) return this._actor.owner!
    const world = (this._actor as any).world as any
    const renderPlayer = world?.renderPlayer
    if (this._actor.owner && (this._actor.owner as any).isAlliedWith?.(renderPlayer)) {
      return this._actor.owner
    }
    return this._disguise.asPlayer!
  }
}

// ---------------------------------------------------------------------------
// DisguiseOrderTargeter
// OpenRA 对照: DisguiseOrderTargeter : UnitOrderTargeter
// ---------------------------------------------------------------------------

export class DisguiseOrderTargeter extends UnitOrderTargeter {
  private readonly _disguiseInfo: DisguiseInfo

  constructor(info: DisguiseInfo) {
    super('Disguise', 7, info.cursor, true, true)
    this._disguiseInfo = info
    ;(this as any).forceAttack = false
  }

  canTargetActor(
    self: IGameActor,
    target: IGameActor,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    const selfOwner = self.owner
    const targetOwner = (target as any).owner
    if (!selfOwner || !targetOwner) return false

    const relationship = typeof (selfOwner as any).relationshipWith === 'function'
      ? (selfOwner as any).relationshipWith(targetOwner) as PlayerRelationship
      : selfOwner === targetOwner
        ? PlayerRelationship.Ally
        : PlayerRelationship.Enemy

    if (!PlayerRelationshipExts.hasRelationship(this._disguiseInfo.validRelationships, relationship))
      return false

    if ((target as any).actorId === (self as any).actorId) return false

    // OpenRA: info.TargetTypes.Overlaps(target.GetAllTargetTypes())
    // GetAllTargetTypes returns gameplay target type tags (e.g. 'Disguise', 'Building'),
    // NOT the actor info name (which is the internal class name).
    const targetAllTypes = (target as any).getAllTargetTypes?.() as Iterable<string> | undefined
    if (!targetAllTypes) return false
    for (const t of targetAllTypes) {
      if (this._disguiseInfo.targetTypes.has(t)) return true
    }
    return false
  }

  canTargetFrozenActor(
    self: IGameActor,
    target: FrozenActorStub,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    const selfOwner = self.owner
    const targetOwner = (target as any).owner
    if (!selfOwner || !targetOwner) return false

    const relationship = typeof (selfOwner as any).relationshipWith === 'function'
      ? (selfOwner as any).relationshipWith(targetOwner) as PlayerRelationship
      : selfOwner === targetOwner
        ? PlayerRelationship.Ally
        : PlayerRelationship.Enemy

    if (!PlayerRelationshipExts.hasRelationship(this._disguiseInfo.validRelationships, relationship))
      return false

    // OpenRA: info.TargetTypes.Overlaps(target.Info.GetAllTargetTypes())
    // GetAllTargetTypes is on the ActorInfo, not on the FrozenActor directly.
    const targetInfo = (target as any).info as { getAllTargetTypes?: () => Iterable<string> } | undefined
    const allTypes = targetInfo?.getAllTargetTypes?.()
    if (!allTypes) return false
    for (const t of allTypes) {
      if (this._disguiseInfo.targetTypes.has(t)) return true
    }
    return false
  }
}
