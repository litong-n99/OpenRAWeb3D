/**
 * Demolition.ts — C4 爆破命令 trait（工程师/破坏者放置炸弹）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Demolition.cs (153 lines)
 *
 * 核心范式转换:
 * - C# Demolish Activity (内含爆破逻辑) → TS DemolishActivityStub（完整实现延至 Ch14）
 * - C# DemolitionOrderTargeter : UnitOrderTargeter → TS 内部类扩展 UnitOrderTargeter
 * - C# Actor.TraitsImplementing<IDemolishable>() → TS duck-typed trait 迭代
 * - C# PlayerRelationship.HasRelationship() → TS PlayerRelationshipExts.hasRelationship()
 * - C# TargetModifiers.HasModifier() → TS TargetModifiersExts.hasModifier()
 * - C# self.ShowTargetLines() → TODO-14（场景渲染延后）
 * - C# order.Target.Type, order.Target.Actor → TS Target class
 * - C# DamageType BitSet → TS Set<string> (简化)
 * - C# FrozenActor.TraitInfos<IDemolishableInfo>() → TS 桩（Shroud 延至 Ch12）
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  EnterBehaviour,
  PlayerRelationship,
  PlayerRelationshipExts,
  TargetModifiersExts,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  IResolveOrder,
  IIssueOrder,
  IOrderVoice,
  IOrderTargeter,
  Order,
  ActivityStub,
  FrozenActorStub,
  ColorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import { UnitOrderTargeter } from '../Orders/UnitOrderTargeter.js'

// ---------------------------------------------------------------------------
// IDemolishable trait query interface (duck-typed)
// OpenRA 对照: IDemolishable
// ---------------------------------------------------------------------------

/**
 * Duck-typed IDemolishable for trait iteration.
 *
 * OpenRA 对照: IDemolishable
 */
interface IDemolishableAccess {
  readonly demolishableInfo: {
    readonly isValidTarget: (target: IGameActor, saboteur: IGameActor) => boolean
  }
}

// ---------------------------------------------------------------------------
// DemolishActivityStub — Demolish Activity 桩 (Chapter 14)
// OpenRA 对照: OpenRA.Mods.Common/Activities/Demolish.cs
// ---------------------------------------------------------------------------

/**
 * Minimal stub for the Demolish Activity.
 *
 * OpenRA 对照: Demolish : Activity
 *
 * Full Demolish activity includes: delay timer, target flashing,
 * entering the target structure, detonation (InflictDamage), and
 * cleanup. This stub exists to satisfy the activity queueing interface
 * until Chapter 14 provides the full implementation.
 *
 * TODO-14.D: Replace with full Demolish Activity implementation.
 */
class DemolishActivityStub implements ActivityStub {
  readonly _self: IGameActor
  readonly _target: Target | null
  readonly _enterBehaviour: EnterBehaviour
  readonly _detonationDelay: number
  readonly _flashes: number
  readonly _flashesDelay: number
  readonly _flashInterval: number
  readonly _damageTypes: ReadonlySet<string>
  readonly _targetLineColor: ColorStub | null

  constructor(
    self: IGameActor,
    target: Target | null,
    enterBehaviour: EnterBehaviour,
    detonationDelay: number,
    flashes: number,
    flashesDelay: number,
    flashInterval: number,
    damageTypes: ReadonlySet<string>,
    targetLineColor: ColorStub | null,
  ) {
    this._self = self
    this._target = target
    this._enterBehaviour = enterBehaviour
    this._detonationDelay = detonationDelay
    this._flashes = flashes
    this._flashesDelay = flashesDelay
    this._flashInterval = flashInterval
    this._damageTypes = damageTypes
    this._targetLineColor = targetLineColor
  }

  /** Append to activity chain.
   *
   * OpenRA 对照: Activity.Queue(Activity)
   */
  queue(_activity: ActivityStub): void {
    // Stub
  }

  /** Cancel this activity.
   *
   * OpenRA 对照: Activity.Cancel(Actor)
   */
  cancel(_actor: IGameActor): void {
    // Stub
  }

  /** Called when the actor is being disposed.
   *
   * OpenRA 对照: Activity.OnActorDisposeOuter(Actor)
   */
  onActorDisposeOuter(_actor: IGameActor): void {
    // Stub
  }
}

// ---------------------------------------------------------------------------
// DemolitionInfo
// OpenRA 对照: DemolitionInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** C4 爆破命令的配置。
 *
 * OpenRA 对照: DemolitionInfo
 */
export class DemolitionInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 放置炸药后到引爆之间的延迟（游戏 ticks）。
   *
   * OpenRA 对照: DemolitionInfo.DetonationDelay (默认 45 = 1.8 秒)
   */
  readonly detonationDelay: number

  /** 目标闪烁次数。
   *
   * OpenRA 对照: DemolitionInfo.Flashes (默认 3)
   */
  readonly flashes: number

  /** 闪烁开始前的延迟（ticks）。
   *
   * OpenRA 对照: DemolitionInfo.FlashesDelay (默认 4)
   */
  readonly flashesDelay: number

  /** 每次闪烁之间的间隔（ticks）。
   *
   * OpenRA 对照: DemolitionInfo.FlashInterval (默认 4)
   */
  readonly flashInterval: number

  /** 进入建筑后的行为。
   *
   * OpenRA 对照: DemolitionInfo.EnterBehaviour (默认 Exit)
   */
  readonly enterBehaviour: EnterBehaviour

  /** 爆破造成的伤害类型集合。
   *
   * OpenRA 对照: DemolitionInfo.DamageTypes (默认空集合)
   */
  readonly damageTypes: ReadonlySet<string>

  /** 放置炸药时的语音短语。
   *
   * OpenRA 对照: DemolitionInfo.Voice (默认 "Action")
   */
  readonly voice: string

  /** 目标连线的颜色。
   *
   * OpenRA 对照: DemolitionInfo.TargetLineColor (默认 Color.Crimson)
   */
  readonly targetLineColor: ColorStub

  /** 正常可攻击的关系（不含 ForceAttack）。
   *
   * OpenRA 对照: DemolitionInfo.TargetRelationships
   * (默认 Enemy | Neutral)
   *
   * Type is `number` (not `PlayerRelationship`) because it may be a bitfield
   * combining multiple PlayerRelationship flags.
   */
  readonly targetRelationships: number

  /** 强制攻击时可攻击的关系。
   *
   * OpenRA 对照: DemolitionInfo.ForceTargetRelationships
   * (默认 Enemy | Neutral | Ally)
   *
   * Type is `number` (not `PlayerRelationship`) because it may be a bitfield
   * combining multiple PlayerRelationship flags.
   */
  readonly forceTargetRelationships: number

  /** 悬停在可爆破目标上时的光标。
   *
   * OpenRA 对照: DemolitionInfo.Cursor (默认 "c4")
   */
  readonly cursor: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    detonationDelay?: number
    flashes?: number
    flashesDelay?: number
    flashInterval?: number
    enterBehaviour?: EnterBehaviour
    damageTypes?: ReadonlySet<string>
    voice?: string
    targetLineColor?: ColorStub
    targetRelationships?: number
    forceTargetRelationships?: number
    cursor?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.detonationDelay = params.detonationDelay ?? 45
    this.flashes = params.flashes ?? 3
    this.flashesDelay = params.flashesDelay ?? 4
    this.flashInterval = params.flashInterval ?? 4
    this.enterBehaviour = params.enterBehaviour ?? EnterBehaviour.Exit
    this.damageTypes = params.damageTypes ?? new Set()
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? { r: 220, g: 20, b: 60, a: 255 } // Crimson
    this.targetRelationships = params.targetRelationships ??
      (PlayerRelationship.Enemy | PlayerRelationship.Neutral)
    this.forceTargetRelationships = params.forceTargetRelationships ??
      (PlayerRelationship.Enemy | PlayerRelationship.Neutral | PlayerRelationship.Ally)
    this.cursor = params.cursor ?? 'c4'
  }
}

// ---------------------------------------------------------------------------
// DemolitionOrderTargeter — 内部目标选择器
// OpenRA 对照: Demolition.DemolitionOrderTargeter : UnitOrderTargeter
// ---------------------------------------------------------------------------

/**
 * C4 爆破命令的目标选择器。
 *
 * OpenRA 对照: Demolition.DemolitionOrderTargeter
 *
 * 验证目标 actor 是否可以被爆破：
 * 1. 非 ForceMove 修饰（ForceMove 时返回 false）
 * 2. 关系检查（正常目标 vs 强制攻击目标）
 * 3. 目标必须实现 IDemolishable 且 IsValidTarget 返回 true
 */
class DemolitionOrderTargeter extends UnitOrderTargeter {
  private readonly _demoInfo: DemolitionInfo

  constructor(demoInfo: DemolitionInfo) {
    super('C4', 6, demoInfo.cursor, true, true)
    this._demoInfo = demoInfo
  }

  // ---------------------------------------------------------------------------
  // canTargetActor
  // OpenRA 对照: DemolitionOrderTargeter.CanTargetActor
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  canTargetActor(
    self: IGameActor,
    target: IGameActor,
    modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // Obey force moving onto bridges
    if (TargetModifiersExts.hasModifier(modifiers, TargetModifiers.ForceMove))
      return false

    // Relationship check using actual diplomacy lookup
    const targetOwner = target.owner
    const selfOwner = self.owner

    if (targetOwner && selfOwner) {
      // OpenRA 对照: target.Owner.RelationshipWith(self.Owner)
      const targetOwnerRel = targetOwner as unknown as {
        relationshipWith?(other: unknown): PlayerRelationship
      }
      const relationship = targetOwnerRel.relationshipWith
        ? targetOwnerRel.relationshipWith(selfOwner)
        : (targetOwner === selfOwner ? PlayerRelationship.Ally : PlayerRelationship.Enemy)

      const isForceAttack = TargetModifiersExts.hasModifier(
        modifiers,
        TargetModifiers.ForceAttack,
      )

      if (!isForceAttack) {
        if (!PlayerRelationshipExts.hasRelationship(
          this._demoInfo.targetRelationships as PlayerRelationship,
          relationship,
        )) return false
      } else {
        if (!PlayerRelationshipExts.hasRelationship(
          this._demoInfo.forceTargetRelationships as PlayerRelationship,
          relationship,
        )) return false
      }
    }

    // Check if target is demolishable
    return this._isDemolishable(target, self)
  }

  // ---------------------------------------------------------------------------
  // canTargetFrozenActor
  // OpenRA 对照: DemolitionOrderTargeter.CanTargetFrozenActor
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  canTargetFrozenActor(
    self: IGameActor,
    target: FrozenActorStub,
    modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // OpenRA 对照: target.Owner.RelationshipWith(self.Owner) + relationship filter
    // NOTE: FrozenActorStub does not expose owner (Ch12). We duck-type for it
    // and fall back to conservative behavior when unavailable.
    const frozenWithOwner = target as unknown as {
      owner?: { relationshipWith?(other: unknown): PlayerRelationship }
    }

    const selfOwner = self.owner
    const isForceAttack = TargetModifiersExts.hasModifier(
      modifiers,
      TargetModifiers.ForceAttack,
    )

    if (frozenWithOwner.owner && selfOwner) {
      // Full relationship check when owner info is available
      const relationship = frozenWithOwner.owner.relationshipWith
        ? frozenWithOwner.owner.relationshipWith(selfOwner)
        : (frozenWithOwner.owner === (selfOwner as unknown)
          ? PlayerRelationship.Ally
          : PlayerRelationship.Enemy)

      if (!isForceAttack) {
        if (!PlayerRelationshipExts.hasRelationship(
          this._demoInfo.targetRelationships as PlayerRelationship,
          relationship,
        )) return false
      } else {
        if (!PlayerRelationshipExts.hasRelationship(
          this._demoInfo.forceTargetRelationships as PlayerRelationship,
          relationship,
        )) return false
      }
    } else {
      // No owner info available — conservative Phase B behavior.
      // Without ForceAttack, require ownership info (defer to false).
      // With ForceAttack, allow any visible frozen actor (ForceAttack is
      // explicitly permissive: Ally | Enemy | Neutral by default).
      // TODO-12.A: Remove this branch once FrozenActorStub includes owner.
      if (!isForceAttack) return false
    }

    // Check if frozen actor info has IDemolishableInfo
    // NOTE: FrozenActorStub doesn't have trait info access yet.
    // TODO-12.A: Add target.Info.TraitInfos<IDemolishableInfo>() to FrozenActorStub.
    return target.visible && target.isValid
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Check if an actor has IDemolishable traits with valid targets.
   *
   * OpenRA 对照: target.TraitsImplementing<IDemolishable>().Any(i => i.IsValidTarget(target, self))
   */
  private _isDemolishable(target: IGameActor, self: IGameActor): boolean {
    // Duck-typed access to trait iteration
    const targetAccess = target as unknown as {
      traitsImplementing?: (name: string) => IDemolishableAccess[]
    }

    const demolishables = targetAccess.traitsImplementing?.('IDemolishable')
    if (!demolishables || demolishables.length === 0) return false

    for (const d of demolishables) {
      if (d.demolishableInfo?.isValidTarget?.(target, self)) {
        return true
      }
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// Demolition
// OpenRA 对照: Demolition : ConditionalTrait<DemolitionInfo>,
//   IIssueOrder, IResolveOrder, IOrderVoice
// ---------------------------------------------------------------------------

/** C4 爆破命令 trait。
 *
 * OpenRA 对照: Demolition
 *
 * 使 actor 可以通过 "C4" 命令在目标建筑上放置炸药。
 * 爆破流程：
 * 1. 检查 trait 是否禁用
 * 2. 验证目标是否为 actor 且实现了 IDemolishable
 * 3. 排队 Demolish 活动
 * 4. 显示目标连线
 */
export class Demolition
  extends ConditionalTrait<DemolitionInfo>
  implements IIssueOrder, IResolveOrder, IOrderVoice
{
  constructor(info: DemolitionInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // IOrderVoice
  // OpenRA 对照: IOrderVoice.VoicePhraseForOrder(Actor self, Order order)
  // ---------------------------------------------------------------------------

  /** 返回 C4 订单的语音短语。
   *
   * OpenRA 对照: Demolition.VoicePhraseForOrder(Actor self, Order order)
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (this.isTraitDisabled) return ''
    return order.orderName === 'C4' ? this.info.voice : ''
  }

  // ---------------------------------------------------------------------------
  // getDemolishActivity
  // OpenRA 对照: Demolition.GetDemolishActivity(Actor self, Target target, Color? targetLineColor)
  // ---------------------------------------------------------------------------

  /** 创建爆破 Activity。
   *
   * OpenRA 对照: Demolition.GetDemolishActivity(Actor self, Target target, Color? targetLineColor)
   *
   * 在 C# 中返回 Demolish Activity 并传入所有配置参数。
   *
   * @param self — 执行爆破的 actor
   * @param target — 爆破目标
   * @param targetLineColor — 目标连线颜色（可选）
   * @returns 已配置的 Demolish Activity 桩
   */
  getDemolishActivity(
    self: IGameActor,
    target: Target | null,
    targetLineColor: ColorStub | null = null,
  ): ActivityStub {
    return new DemolishActivityStub(
      self,
      target,
      this.info.enterBehaviour,
      this.info.detonationDelay,
      this.info.flashes,
      this.info.flashesDelay,
      this.info.flashInterval,
      this.info.damageTypes,
      targetLineColor ?? this.info.targetLineColor,
    )
  }

  // ---------------------------------------------------------------------------
  // IIssueOrder
  // OpenRA 对照: Demolition.Orders + IssueOrder
  // ---------------------------------------------------------------------------

  /** 可用的订单目标选择器列表。
   *
   * OpenRA 对照: Demolition.Orders getter
   *
   * 返回 DemolitionOrderTargeter，仅在 trait 未被禁用时有效。
   */
  get orders(): readonly IOrderTargeter[] {
    if (this.isTraitDisabled) return []
    return [new DemolitionOrderTargeter(this.info)]
  }

  /** 发行 C4 订单。
   *
   * OpenRA 对照: Demolition.IssueOrder(Actor self, IOrderTargeter order, Target target, bool queued)
   *
   * @param _self — 发行订单的 actor
   * @param order — 目标选择器
   * @param target — 目标（会被转换为 Target 对象）
   * @param queued — 是否排队
   * @returns 创建的 C4 Order
   */
  issueOrder(
    _self: IGameActor,
    order: IOrderTargeter,
    target: unknown,
    queued: boolean,
  ): Order {
    if (order.orderID !== 'C4' || this.isTraitDisabled) {
      return { orderName: '', targetString: '', extraData: 0 }
    }

    return {
      orderName: 'C4',
      targetString: '',
      extraData: { queued, target: target as Target | null },
    }
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: Demolition.ResolveOrder(Actor self, Order order)
  // ---------------------------------------------------------------------------

  /** 解析 C4 命令。
   *
   * OpenRA 对照: Demolition.ResolveOrder(Actor self, Order order)
   *
   * 流程：
   * 1. 验证命令名称和 trait 状态
   * 2. 如果目标是 actor，验证 IDemolishable
   * 3. 排队 Demolish 活动
   * 4. 显示目标连线
   *
   * @param self — 执行爆破的 actor
   * @param order — 要解析的订单
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName !== 'C4' || this.isTraitDisabled) return

    const ed = order.extraData as { queued: boolean; target?: Target | null } | null
    const target = ed?.target
    const queued = ed?.queued ?? false

    if (!target) return

    // 验证目标类型和可爆破性
    if (target.type === TargetType.Actor) {
      const targetActor = target.actor
      if (!targetActor) return

      const gameActor = targetActor as unknown as IGameActor
      if (!this._hasDemolishableTrait(gameActor, self)) return
    }

    // 排队爆破活动
    if (typeof self.queueActivity === 'function') {
      // C#: self.QueueActivity(order.Queued, GetDemolishActivity(self, order.Target, Info.TargetLineColor));
      void queued // queued param for future use
      self.queueActivity(
        this.getDemolishActivity(self, target, this.info.targetLineColor),
      )
    }

    // 显示目标连线
    // C#: self.ShowTargetLines();
    // TODO-14: Implement target line rendering
    // Target line rendering is a WorldRenderer/Scene-dependent feature.
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** 检查目标 actor 是否具有有效的 IDemolishable trait。
   *
   * OpenRA 对照: order.Target.Actor.TraitsImplementing<IDemolishable>()
   *   .Any(i => i.IsValidTarget(order.Target.Actor, self))
   *
   * @param target — 目标 actor
   * @param self — 执行爆破的 actor
   * @returns true 如果目标是有效的爆破目标
   */
  private _hasDemolishableTrait(
    target: IGameActor,
    self: IGameActor,
  ): boolean {
    const targetAccess = target as unknown as {
      traitsImplementing?: (name: string) => IDemolishableAccess[]
    }

    const demolishables = targetAccess.traitsImplementing?.('IDemolishable')
    if (!demolishables || demolishables.length === 0) return false

    for (const d of demolishables) {
      if (d.demolishableInfo?.isValidTarget?.(target, self)) {
        return true
      }
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------
export { DemolishActivityStub, DemolitionOrderTargeter }
