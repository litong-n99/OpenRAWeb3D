/**
 * Transforms.ts — Actor 变形 trait（MCV 部署为建造场、建筑升级等）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Transforms.cs (171 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<TransformsInfo> → TS ConditionalTrait<TransformsInfo>
 *   (isTraitPaused / _paused 已在 ConditionalTrait 中实现)
 * - C# ActorInitializer.GetValue<FactionInit, string>() → TS 直接传入 faction 字符串
 * - C# self.World.CanPlaceBuilding() → TS IBuildingUtilsWorld + BuildingUtils.canPlaceBuilding()
 * - C# Transform Activity (内含变形逻辑) → TS TransformActivityStub（完整实现延至 Ch14）
 * - C# Game.Sound.PlayToPlayer / PlayNotification → TODO-11-SOUND（音频延后）
 * - C# TextNotificationsManager.AddTransientLine → TODO-16-NOTIFICATION（UI 通知延后）
 * - C# AIUtils.ClearBlockersOrders → TS clearBlockersOrders 桩（AI 系统延后）
 * - C# DeployOrderTargeter → TS import from DeployOrderTargeter.ts
 * - C# yield return Orders → TS get orders() 返回数组
 */

import { CVec } from '../../OpenRA.Game/CVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  IResolveOrder,
  IIssueOrder,
  IOrderVoice,
  IOrderTargeter,
  Order,
  ActivityStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IBuildingUtilsWorld } from './Buildings/BuildingUtils.js'
// IBuildingUtilsActorInfo used in constructor init parameter
import type { IBuildingUtilsActorInfo } from './Buildings/BuildingUtils.js'
import { BuildingUtils } from './Buildings/BuildingUtils.js'
import type { BuildingInfo } from './Buildings/Building.js'
import { DeployOrderTargeter } from '../Orders/DeployOrderTargeter.js'

// ---------------------------------------------------------------------------
// IIssueDeployOrder — deploy order interface
// OpenRA 对照: OpenRA.Mods.Common/Orders/IIssueDeployOrder.cs
// ---------------------------------------------------------------------------

/**
 * Deploy order interface — allows traits to issue deploy commands via hotkey.
 *
 * OpenRA 对照: IIssueDeployOrder
 *
 * NOTE: Defined here (rather than TraitsInterfaces.ts) to match the C# location
 * in OpenRA.Mods.Common. Multiple traits implement this interface including
 * Transforms and Aircraft.
 */
export interface IIssueDeployOrder {
  /** Whether the trait can currently issue a deploy order.
   *
   * OpenRA 对照: IIssueDeployOrder.CanIssueDeployOrder(Actor self, bool queued)
   *
   * @param self — the actor
   * @param queued — whether the order is being queued
   */
  canIssueDeployOrder(self: IGameActor, queued: boolean): boolean

  /** Issue a deploy order.
   *
   * OpenRA 对照: IIssueDeployOrder.IssueDeployOrder(Actor self, bool queued)
   *
   * @param self — the actor
   * @param queued — whether the order is queued
   * @returns the Order, or null if deployment is not possible
   */
  issueDeployOrder(self: IGameActor, queued: boolean): Order
}

// ---------------------------------------------------------------------------
// ITransformOrder — extended order interface with target and queued fields
// OpenRA 对照: N/A (C# Order has Target + Queued properties)
// ---------------------------------------------------------------------------

/** Extended order type that carries a queued flag.
 *
 * OpenRA 对照: C# Order.Queued property
 *
 * In the full Order migration this would be a proper Order class field.
 * For Phase B we extend the OrderStub with an extraData containing queued.
 */
interface TransformOrder extends Order {
  readonly orderName: string
  readonly targetString: string
  readonly extraData: { queued: boolean }
}

// ---------------------------------------------------------------------------
// TransformActivityStub — Transform Activity 桩 (Chapter 14)
// OpenRA 对照: OpenRA.Mods.Common/Activities/Transform.cs
// ---------------------------------------------------------------------------

/**
 * Minimal stub for the Transform Activity.
 *
 * OpenRA 对照: Transform : Activity
 *
 * Full Transform activity includes: make-animation reversal, spawn of new actor,
 * transfer of cargo/passengers, and disposal of old actor.
 * This stub exists to satisfy IOrderVoice and activity queueing until
 * Chapter 14 provides the full implementation.
 *
* Replace with full Transform Activity implementation.
 */
class TransformActivityStub implements ActivityStub {
  private readonly _intoActor: string
  private _offset: CVec = CVec.Zero
  private _facing: WAngle = new WAngle(384)
  private _sounds: readonly string[] = []
  private _notification: string | null = null
  private _textNotification: string | null = null
  private _faction: string = ''

  constructor(intoActor: string) {
    this._intoActor = intoActor
  }

  get offset(): CVec { return this._offset }
  set offset(v: CVec) { this._offset = v }
  get facing(): WAngle { return this._facing }
  set facing(v: WAngle) { this._facing = v }
  get sounds(): readonly string[] { return this._sounds }
  set sounds(v: readonly string[]) { this._sounds = v }
  get notification(): string | null { return this._notification }
  set notification(v: string | null) { this._notification = v }
  get textNotification(): string | null { return this._textNotification }
  set textNotification(v: string | null) { this._textNotification = v }
  get faction(): string { return this._faction }
  set faction(v: string) { this._faction = v }

  /** Append to activity chain.
   *
   * OpenRA 对照: Activity.Queue(Activity)
   */
  queue(_activity: ActivityStub): void {
    // Stub — real implementation chains activities
  }

  /** Cancel this activity.
   *
   * OpenRA 对照: Activity.Cancel(Actor)
   */
  cancel(_actor: IGameActor): void {
    // Stub — real implementation cancels and cleans up
  }

  /** Called when the actor is being disposed.
   *
   * OpenRA 对照: Activity.OnActorDisposeOuter(Actor)
   */
  onActorDisposeOuter(_actor: IGameActor): void {
    // Stub — real implementation cascades cleanup
  }

  get intoActor(): string { return this._intoActor }
}

// ---------------------------------------------------------------------------
// TransformsInfo
// OpenRA 对照: TransformsInfo : PausableConditionalTraitInfo
// ---------------------------------------------------------------------------

/** 配置：actor 激活此 trait 时变形为目标类型。
 *
 * OpenRA 对照: TransformsInfo
 */
export class TransformsInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 变形目标 actor 类型名称（必需）。
   *
   * OpenRA 对照: TransformsInfo.IntoActor
   */
  readonly intoActor: string

  /** 相对于当前位置的生成偏移。
   *
   * OpenRA 对照: TransformsInfo.Offset (默认 CVec.Zero)
   */
  readonly offset: CVec

  /** 变形前必须朝向的角度（0-1024 范围）。
   *
   * OpenRA 对照: TransformsInfo.Facing (默认 new WAngle(384) = SE 方向)
   */
  readonly facing: WAngle

  /** 变形时播放的音效列表。
   *
   * OpenRA 对照: TransformsInfo.TransformSounds
   */
  readonly transformSounds: readonly string[]

  /** 变形被阻止时播放的音效列表。
   *
   * OpenRA 对照: TransformsInfo.NoTransformSounds
   */
  readonly noTransformSounds: readonly string[]

  /** 变形时的语音通知 ID。
   *
   * OpenRA 对照: TransformsInfo.TransformNotification
   */
  readonly transformNotification: string | null

  /** 变形时的文字通知 ID。
   *
   * OpenRA 对照: TransformsInfo.TransformTextNotification
   */
  readonly transformTextNotification: string | null

  /** 变形被阻止时的语音通知 ID。
   *
   * OpenRA 对照: TransformsInfo.NoTransformNotification
   */
  readonly noTransformNotification: string | null

  /** 变形被阻止时的文字通知 ID。
   *
   * OpenRA 对照: TransformsInfo.NoTransformTextNotification
   */
  readonly noTransformTextNotification: string | null

  /** 可部署时的光标。
   *
   * OpenRA 对照: TransformsInfo.DeployCursor (默认 "deploy")
   */
  readonly deployCursor: string

  /** 不可部署时的光标。
   *
   * OpenRA 对照: TransformsInfo.DeployBlockedCursor (默认 "deploy-blocked")
   */
  readonly deployBlockedCursor: string

  /** 语音短语标识。
   *
   * OpenRA 对照: TransformsInfo.Voice (默认 "Action")
   */
  readonly voice: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    intoActor: string
    offset?: CVec
    facing?: WAngle
    transformSounds?: readonly string[]
    noTransformSounds?: readonly string[]
    transformNotification?: string | null
    transformTextNotification?: string | null
    noTransformNotification?: string | null
    noTransformTextNotification?: string | null
    deployCursor?: string
    deployBlockedCursor?: string
    voice?: string
  }) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.intoActor = params.intoActor
    this.offset = params.offset ?? CVec.Zero
    this.facing = params.facing ?? new WAngle(384)
    this.transformSounds = params.transformSounds ?? []
    this.noTransformSounds = params.noTransformSounds ?? []
    this.transformNotification = params.transformNotification ?? null
    this.transformTextNotification = params.transformTextNotification ?? null
    this.noTransformNotification = params.noTransformNotification ?? null
    this.noTransformTextNotification = params.noTransformTextNotification ?? null
    this.deployCursor = params.deployCursor ?? 'deploy'
    this.deployBlockedCursor = params.deployBlockedCursor ?? 'deploy-blocked'
    this.voice = params.voice ?? 'Action'
  }
}

// ---------------------------------------------------------------------------
// Transforms
// OpenRA 对照: Transforms : PausableConditionalTrait<TransformsInfo>,
//   IIssueOrder, IResolveOrder, IOrderVoice, IIssueDeployOrder
// ---------------------------------------------------------------------------

/** Actor 变形 trait。
 *
 * OpenRA 对照: Transforms
 *
 * 使 actor 可以通过 "DeployTransform" 命令变形为另一个 actor 类型。
 * 常用于 MCV 部署为建造场、建筑升级等场景。
 *
 * 变形流程：
 * 1. 检查 trait 是否暂停/禁用
 * 2. 验证目标位置是否可建造（如果目标是建筑）
 * 3. 如果不可建造且非排队模式：播放阻止音效、清除阻挡者
 * 4. 如果可建造或排队模式：排队 Transform 活动
 */
export class Transforms
  extends ConditionalTrait<TransformsInfo>
  implements IIssueOrder, IResolveOrder, IOrderVoice, IIssueDeployOrder
{
  /** 要变形的 actor 引用。 */
  private readonly _self: IGameActor

  /** 变形目标如果是建筑的 BuildingInfo（可能为 null）。
   *
   * OpenRA 对照: buildingInfo = actorInfo.TraitInfoOrDefault<BuildingInfo>()
   */
  private readonly _buildingInfo: BuildingInfo | null

  /** 所属势力名称。
   *
   * OpenRA 对照: faction = init.GetValue<FactionInit, string>(self.Owner.Faction.InternalName)
   */
  private readonly _faction: string

  /** 世界接口引用（用于 CanPlaceBuilding 检查）。 */
  private readonly _world: IBuildingUtilsWorld | null

  /** ActorInfo for the transform target (used by BuildingUtils.canPlaceBuilding). */
  private readonly _actorInfo: IBuildingUtilsActorInfo | null

  /** 目标 actor 是否为建筑。 */
  private readonly _isBuilding: boolean

  constructor(
    info: TransformsInfo,
    init: {
      self: IGameActor
      actorInfo: IBuildingUtilsActorInfo
      buildingInfo: BuildingInfo | null
      faction: string
      world?: IBuildingUtilsWorld | null
    },
  ) {
    super(info)
    this._self = init.self
    this._actorInfo = init.actorInfo
    this._buildingInfo = init.buildingInfo
    this._faction = init.faction
    this._world = init.world ?? null
    this._isBuilding = init.buildingInfo !== null
  }

  // ---------------------------------------------------------------------------
  // IOrderVoice
  // OpenRA 对照: IOrderVoice.VoicePhraseForOrder(Actor self, Order order)
  // ---------------------------------------------------------------------------

  /** 返回变形订单的语音短语。
   *
   * OpenRA 对照: Transforms.VoicePhraseForOrder(Actor self, Order order)
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    return order.orderName === 'DeployTransform' ? this.info.voice : ''
  }

  // ---------------------------------------------------------------------------
  // IIssueDeployOrder
  // OpenRA 对照: IIssueDeployOrder.IssueDeployOrder, CanIssueDeployOrder
  // ---------------------------------------------------------------------------

  /** 是否可发行部署命令。
   *
   * OpenRA 对照: IIssueDeployOrder.CanIssueDeployOrder(Actor self, bool queued)
   */
  canIssueDeployOrder(_self: IGameActor, _queued: boolean): boolean {
    return !this.isTraitPaused && !this.isTraitDisabled
  }

  /** 发行部署命令。
   *
   * OpenRA 对照: IIssueDeployOrder.IssueDeployOrder(Actor self, bool queued)
   */
  issueDeployOrder(_self: IGameActor, queued: boolean): Order {
    const order: TransformOrder = {
      orderName: 'DeployTransform',
      targetString: '',
      extraData: { queued },
    }
    return order
  }

  // ---------------------------------------------------------------------------
  // canDeploy
  // OpenRA 对照: Transforms.CanDeploy()
  // ---------------------------------------------------------------------------

  /** 检查变形是否可行。
   *
   * OpenRA 对照: Transforms.CanDeploy()
   *
   * 检查条件：
   * 1. trait 未被暂停或禁用
   * 2. 如果目标不是建筑 → 总是可行
   * 3. 如果目标是建筑 → 检查目标位置是否可建造
   *
   * @returns true 如果变形可以执行
   */
  canDeploy(): boolean {
    if (this.isTraitPaused || this.isTraitDisabled) return false

    // 如果目标不是建筑，始终可部署
    if (!this._isBuilding || !this._buildingInfo) return true

    // 验证建筑放置
    if (!this._world) return false

    const targetLocation = CPos.add(this._getSelfLocation(), this.info.offset)

    return this._world.map.contains(targetLocation) &&
      this.canPlaceBuildingAt(targetLocation)
  }

  /** 检查在指定位置是否可以放置变形目标建筑。
   *
   * OpenRA 对照: self.World.CanPlaceBuilding(self.Location + Info.Offset, actorInfo, buildingInfo, self)
   *
   * 此方法从 BuildingUtils.canPlaceBuilding 提取核心逻辑，
   * 避免直接依赖 IBuildingUtilsWorld（便于测试桩）。
   *
   * @param topLeft — 建筑放置的左上角位置
   * @returns true 如果可建造
   */
  canPlaceBuildingAt(topLeft: CPos): boolean {
    if (!this._buildingInfo || !this._world || !this._actorInfo) return false

    // OpenRA 对照: self.World.CanPlaceBuilding(location, actorInfo, buildingInfo, self)
    return BuildingUtils.canPlaceBuilding(
      this._world,
      topLeft,
      this._actorInfo,
      this._buildingInfo,
      this._self,
    )
  }

  // ---------------------------------------------------------------------------
  // getTransformActivity
  // OpenRA 对照: Transforms.GetTransformActivity()
  // ---------------------------------------------------------------------------

  /** 创建变形 Activity。
   *
   * OpenRA 对照: Transforms.GetTransformActivity()
   *
   * 在 C# 中返回 Transform Activity 并设置 Offset, Facing, Sounds,
   * Notification, TextNotification, Faction 属性。
   *
   * @returns 已配置的 Transform Activity 桩
   */
  getTransformActivity(): ActivityStub {
    const activity = new TransformActivityStub(this.info.intoActor)
    activity.offset = this.info.offset
    activity.facing = this.info.facing
    activity.sounds = this.info.transformSounds
    activity.notification = this.info.transformNotification
    activity.textNotification = this.info.transformTextNotification
    activity.faction = this._faction
    return activity
  }

  // ---------------------------------------------------------------------------
  // clearBlockersOrders
  // OpenRA 对照: AIUtils.ClearBlockersOrders(buildingInfo.Tiles(topLeft), self.Owner, self)
  // ---------------------------------------------------------------------------

  /** 获取清除阻挡者的命令。
   *
   * OpenRA 对照: AIUtils.ClearBlockersOrders(List<CPos>, Player, Actor)
   *
   * TODO-14.AI: 实现完整的 AI 阻挡者清除逻辑。
   * 目前返回空数组 — 阻挡者处理延迟至 AI 系统迁移。
   *
   * @param topLeft — 建筑左上角位置
   * @returns 清除阻挡者所需的订单列表（目前为空）
   */
  private _clearBlockersOrders(_topLeft: CPos): Order[] {
    // C#: return AIUtils.ClearBlockersOrders(buildingInfo.Tiles(topLeft).ToList(), self.Owner, self);
    // AIUtils not yet migrated. Returns empty array for now.
    // TODO-14.AI: Implement AI blocker-clearing logic.
    return []
  }

  // ---------------------------------------------------------------------------
  // deployTransform
  // OpenRA 对照: Transforms.DeployTransform(bool queued)
  // ---------------------------------------------------------------------------

  /** 执行变形部署。
   *
   * OpenRA 对照: Transforms.DeployTransform(bool queued)
   *
   * 流程：
   * 1. 如果非排队且不可部署 → 清除阻挡者、播放阻止音效、通知 UI
   * 2. 如果可部署或排队 → 排队变形 Activity
   *
   * @param queued — 是否排队命令
   */
  deployTransform(queued: boolean): void {
    if (!queued && !this.canDeploy()) {
      // 清除阻挡者
      const targetLocation = CPos.add(this._getSelfLocation(), this.info.offset)
      for (const order of this._clearBlockersOrders(targetLocation)) {
        this._issueOrderToWorld(order)
      }

      // 播放"无法在此部署"的音效
      // C#: foreach (var s in Info.NoTransformSounds)
      //        Game.Sound.PlayToPlayer(SoundType.World, self.Owner, s);
      // TODO-11-SOUND: 集成音频系统
      void this.info.noTransformSounds

      // C#: Game.Sound.PlayNotification(self.World.Map.Rules, self.Owner,
      //        "Speech", Info.NoTransformNotification, self.Owner.Faction.InternalName);
      // TODO-11-SOUND: 集成语音通知
      void this.info.noTransformNotification

      // C#: TextNotificationsManager.AddTransientLine(self.Owner, Info.NoTransformTextNotification);
      // TODO-16-NOTIFICATION: 集成文字通知系统
      void this.info.noTransformTextNotification

      return
    }

    // 排队变形活动
    this._queueTransformActivity(queued)
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: IResolveOrder.ResolveOrder(Actor self, Order order)
  // ---------------------------------------------------------------------------

  /** 解析 DeployTransform 命令。
   *
   * OpenRA 对照: Transforms.ResolveOrder(Actor self, Order order)
   *
   * @param _self — actor（接口参数，实际使用缓存的 this._self）
   * @param order — 要解析的订单
   */
  resolveOrder(_self: IGameActor, order: Order): void {
    if (order.orderName === 'DeployTransform' &&
        !this.isTraitPaused && !this.isTraitDisabled) {
      const queued = typeof order.extraData === 'object' && order.extraData !== null
        ? (order.extraData as { queued: boolean }).queued
        : false
      this.deployTransform(queued)
    }
  }

  // ---------------------------------------------------------------------------
  // IIssueOrder
  // OpenRA 对照: Transforms.Orders + IIssueOrder.IssueOrder
  // ---------------------------------------------------------------------------

  /** 可用的订单目标选择器列表。
   *
   * OpenRA 对照: Transforms.Orders getter
   *
   * 返回 DeployOrderTargeter，提供"部署"和"阻止部署"两种光标。
   */
  get orders(): readonly IOrderTargeter[] {
    if (this.isTraitDisabled) return []
    return [
      new DeployOrderTargeter('DeployTransform', 5, () =>
        this.canDeploy() ? this.info.deployCursor : this.info.deployBlockedCursor,
      ),
    ]
  }

  /** 发行订单。
   *
   * OpenRA 对照: Transforms.IssueOrder(Actor self, IOrderTargeter order, Target target, bool queued)
   *
   * @param _self — actor（接口参数，实际使用缓存的 this._self）
   * @param order — 目标选择器
   * @param _target — 目标（未使用，部署目标始终是自身）
   * @param queued — 是否排队
   * @returns 创建的 Order，如果订单 ID 不匹配则返回 null
   */
  issueOrder(
    _self: IGameActor,
    order: IOrderTargeter,
    _target: unknown,
    queued: boolean,
  ): Order {
    if (order.orderID === 'DeployTransform') {
      return this.issueDeployOrder(_self, queued)
    }
    return { orderName: '', targetString: '', extraData: 0 }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** 获取 self 的当前位置。
   *
   * OpenRA 对照: self.Location (在 C# 中是一个属性)
   *
   * 尝试从 actor 获取 topLeft（IOccupySpace）位置，
   * 如果不可用则返回 CPos.Zero。
   */
  private _getSelfLocation(): CPos {
    // 尝试通过 IOccupySpace 获取位置
    const occupySpace = (this._self as unknown as {
      topLeft?: CPos
    }).topLeft
    if (occupySpace instanceof CPos) return occupySpace

    // 尝试通过属性查找
    const location = (this._self as unknown as {
      location?: CPos
    }).location
    if (location instanceof CPos) return location

    return CPos.Zero
  }

  /** 将订单下发到世界。
   *
   * OpenRA 对照: self.World.IssueOrder(order)
   *
   * TODO-14.WORLD: 实现完整的世界订单系统集成
   */
  private _issueOrderToWorld(_order: Order): void {
    // C#: self.World.IssueOrder(order);
    // World.IssueOrder not yet fully integrated.
    // TODO-14.WORLD: Integrate with World order dispatch system.
  }

  /** 排队变形活动。
   *
   * OpenRA 对照: self.QueueActivity(queued, GetTransformActivity())
   */
  private _queueTransformActivity(queued: boolean): void {
    const activity = this.getTransformActivity()
    if (typeof this._self.queueActivity === 'function') {
      // C#: self.QueueActivity(queued, GetTransformActivity())
      // Actor.QueueActivity signature: QueueActivity(bool queued, Activity nextActivity)
      // For now, we always queue the activity.
      void queued // queued param — used when full QueueActivity(bool, Activity) is implemented
      this._self.queueActivity(activity)
    }
  }
}

// ---------------------------------------------------------------------------
// Re-export TransformActivityStub class name for tests
// ---------------------------------------------------------------------------
export { TransformActivityStub }
