/**
 * MoveToDock.ts — 移动到对接主机活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/MoveToDock.cs
 *
 * 核心范式转换:
 * - C# DockClientManager trait 解析 → TypeScript 鸭子类型查找 (actor.traits Map)
 * - C# IDockHost 接口方法 → TypeScript 接口方法调用 (Refinery 直接实现 IDockHost)
 * - C# INotifyDockClientMoving[] 数组 → TypeScript 鸭子类型数组
 * - C# Color? 可空 → TypeScript ColorStub | null
 * - C# QueueChild(new Wait(...)) → TypeScript this.queueChild(new Wait(...))
 * - C# TargetLineNode yield return → TypeScript 数组返回
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.ts'
import type { GameActor } from '../../OpenRA.Game/Actor.ts'
import type { ColorStub, IDockHost } from '../../OpenRA.Game/Traits/TraitsInterfaces.ts'
import { Target } from '../../OpenRA.Game/Traits/Target.ts'
import { Wait } from './Wait.ts'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.ts'
import type { INotifyDockClientMoving } from './EconomicActivityInterfaces.ts'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.ts'
import type { Mobile } from '../Traits/Mobile.ts'

// ---------------------------------------------------------------------------
// MoveToDock
// ---------------------------------------------------------------------------

/**
 * 移动到对接主机并尝试预约对接位置。
 *
 * OpenRA 对照: MoveToDock activity
 *
 * 工作流程:
 * 1. onFirstRun: 如果提供了 hostActor 但未提供 host，从 actor 解析 host
 * 2. tick: 查找最近的对接主机 (如未指定)；尝试预约；成功后通过 host 的
 *    queueMoveActivity / queueDockActivity 回调排队移动子活动
 * 3. cancel: 取消预约，通知 INotifyDockClientMoving
 * 4. targetLineNodes: 渲染目标线到对接主机
 *
 * 被 FindAndDeliverResources (运送资源) 和 Resupply (补给) 使用。
 */
export class MoveToDock extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** 对接主机 actor (可能为 null，此时需要搜索最近的主机)。 */
  dockHostActor: GameActor | null

  /** 对接主机 trait (可能为 null，在 onFirstRun 或 tick 中解析)。 */
  dockHost: IDockHost | null

  /** 是否强制进入 (忽略某些限制)。 */
  readonly forceEnter: boolean

  /** 是否忽略占用检查。 */
  readonly ignoreOccupancy: boolean

  /** 目标线颜色 (null = 不显示目标线)。 */
  readonly dockLineColor: ColorStub | null

  // ---------------------------------------------------------------------------
  // Resolved traits
  // ---------------------------------------------------------------------------

  /** 对接客户端管理器 (鸭子类型)。 */
  private readonly dockClient: DockClientManagerLike

  /** 移动通知接口数组。 */
  private readonly notifyDockClientMoving: INotifyDockClientMoving[]

  /** 移动冷却辅助器。 */
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** 对接是否已被取消 (如 hostActor 死亡或无效)。 */
  private dockingCancelled: boolean = false

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 MoveToDock 活动。
   *
   * OpenRA 对照: MoveToDock(Actor, Actor, IDockHost, bool, bool, Color?)
   *
   * @param self — 执行此活动的 actor
   * @param dockHostActor — 目标对接主机 actor (可选，null 时搜索最近主机)
   * @param dockHost — 目标对接主机 trait (可选，null 时从 dockHostActor 解析)
   * @param forceEnter — 是否强制进入
   * @param ignoreOccupancy — 是否忽略占用检查
   * @param dockLineColor — 目标线颜色 (可选)
   */
  constructor(
    self: GameActor,
    dockHostActor: GameActor | null = null,
    dockHost: IDockHost | null = null,
    forceEnter: boolean = false,
    ignoreOccupancy: boolean = false,
    dockLineColor: ColorStub | null = null,
  ) {
    super()
    this.dockHostActor = dockHostActor
    this.dockHost = dockHost
    this.forceEnter = forceEnter
    this.ignoreOccupancy = ignoreOccupancy
    this.dockLineColor = dockLineColor

    // 解析 DockClientManager
    this.dockClient = MoveToDock._resolveDockClient(self)

    // 解析 INotifyDockClientMoving 通知接口
    this.notifyDockClientMoving = MoveToDock._resolveNotifyDockClientMoving(self)

    // 创建移动冷却辅助器
    const mobile = (self as unknown as { traits?: Map<string, unknown> }).traits?.get('Mobile') ?? null
    const world = (self as unknown as { world?: { sharedRandom?: { next(): number } } | null }).world ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(world, mobile as unknown as Mobile | null)
    this.moveCooldownHelper.retryIfDestinationBlocked = true
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  /**
   * 首次运行时解析对接主机。
   *
   * OpenRA 对照: MoveToDock.OnFirstRun(Actor)
   *
   * 如果提供了 dockHostActor 但未提供 dockHost，从 actor 中查找可用的
   * IDockHost trait。如果 actor 已死亡或不在世界中，标记 dockingCancelled。
   */
  protected override onFirstRun(_self: GameActor): void {
    if (this.dockClient.isTraitDisabled) return

    // 提供了 hostActor 但未指定 host — 从 actor 解析
    if (this.dockHostActor !== null && this.dockHost === null) {
      if (this.dockHostActor.isDead || !this.dockHostActor.isInWorld) {
        this.dockingCancelled = true
        return
      }

      // 通过 availableDockHosts 查找最佳对接点
      const hosts = this.dockClient.availableDockHosts(
        this.dockHostActor,
        undefined,
        this.forceEnter,
        this.ignoreOccupancy,
      )
      const link = this._closestDock(hosts)
      if (link !== null) {
        this.dockHost = link.trait
        this.dockHostActor = link.actor
      } else {
        this.dockingCancelled = true
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每 tick 尝试预约对接主机并排队移动活动。
   *
   * OpenRA 对照: MoveToDock.Tick(Actor)
   *
   * @param self — 执行此活动的 actor
   * @returns true 当活动完成，false 继续执行
   */
  override tick(self: GameActor): boolean {
    // 正在取消中 — 立即完成
    if (this.isCanceling) return true

    // 对接已取消或 trait 被禁用
    if (this.dockingCancelled || this.dockClient.isTraitDisabled) {
      this.cancel(self, true)
      return true
    }

    // 未指定对接主机或主机已失效 — 查找最近的可用主机
    if (this.dockHost === null || !this.dockHost.isEnabledAndInWorld) {
      const host = this.dockClient.closestDock(null)
      if (host !== null) {
        this.dockHost = host.trait
        this.dockHostActor = host.actor
      } else {
        // 没有可用主机 — 等待后重试
        this.queueChild(new Wait(this.dockClient.info.searchForDockDelay))
        return false
      }
    }

    // 移动冷却辅助器 tick
    const result = this.moveCooldownHelper.tick(false)
    if (result !== null) return result

    // 尝试预约对接主机
    if (this.dockHostActor !== null && this.dockHost !== null &&
        this.dockClient.reserveHost(this.dockHostActor, this.dockHost)) {
      // 预约成功 — 通过 host 的回调排队移动/对接活动
      const dockHostAny = this.dockHost as unknown as Record<string, unknown>
      if (typeof dockHostAny.queueMoveActivity === 'function') {
        const queued = (dockHostAny as { queueMoveActivity: (a: Activity, b: GameActor, c: GameActor, d: DockClientManagerLike, e: MoveCooldownHelper) => boolean }).queueMoveActivity(
          this,
          this.dockHostActor,
          self,
          this.dockClient,
          this.moveCooldownHelper,
        )
        if (queued) {
          // 通知移动监听者
          for (const ndcm of this.notifyDockClientMoving) {
            ndcm.movingToDock(self, this.dockHostActor, this.dockHost)
          }
          return false
        }
      }

      // queueMoveActivity 返回 false 或未定义 — 直接排队对接活动
      if (typeof dockHostAny.queueDockActivity === 'function') {
        (dockHostAny as { queueDockActivity: (a: Activity, b: GameActor, c: GameActor, d: DockClientManagerLike) => void }).queueDockActivity(
          this,
          this.dockHostActor,
          self,
          this.dockClient,
        )
      }
      return true
    } else {
      // 预约失败 — 通知取消，等待后重试
      for (const ndcm of this.notifyDockClientMoving) {
        ndcm.movementCancelled(self)
      }
      this.queueChild(new Wait(this.dockClient.info.searchForDockDelay))
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * 取消此活动 — 释放预约并通知监听者。
   *
   * OpenRA 对照: MoveToDock.Cancel(Actor, bool)
   *
   * @param self — 执行此活动的 actor
   * @param keepQueue — 是否保留后续活动队列
   */
  override cancel(self: GameActor, keepQueue: boolean = false): void {
    // 释放预约
    this.dockClient.unreserveHost()

    // 通知移动取消
    for (const ndcm of this.notifyDockClientMoving) {
      ndcm.movementCancelled(self)
    }

    super.cancel(self, keepQueue)
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * 获取目标线节点。
   *
   * OpenRA 对照: MoveToDock.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.dockLineColor === null) return []

    if (this.dockHostActor !== null) {
      return [new TargetLineNode(Target.fromActor(this.dockHostActor as unknown as IActorRef), this.dockLineColor)]
    } else {
      const reservedActor = this.dockClient.reservedHostActor
      if (reservedActor !== null) {
        return [new TargetLineNode(Target.fromActor(reservedActor as unknown as IActorRef), this.dockLineColor)]
      }
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * 从可用主机列表中找到最近的一个。
   *
   * OpenRA 对照: ClosestDock extension method
   */
  private _closestDock(hosts: DockHostLink[]): DockHostLink | null {
    if (hosts.length === 0) return null
    // 简化: 返回第一个可用主机
    // 完整实现应计算距离并返回最近的一个
    return hosts[0]
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 从 actor 解析 DockClientManager (鸭子类型)。
   *
   *  OpenRA 对照: self.Trait<DockClientManager>()
   */
  private static _resolveDockClient(self: GameActor): DockClientManagerLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits?.has('DockClientManager')) {
      return traits.get('DockClientManager') as DockClientManagerLike
    }

    // 回退: 检查 actor 本身是否有 DockClientManager 方法
    const actorAny = self as unknown as Record<string, unknown>
    if (typeof actorAny.reserveHost === 'function' &&
        typeof actorAny.unreserveHost === 'function') {
      return actorAny as unknown as DockClientManagerLike
    }

    // 返回最小存根 (用于测试)
    return createStubDockClientManager()
  }

  /** 从 actor 解析 INotifyDockClientMoving 接口数组。
   *
   *  OpenRA 对照: self.TraitsImplementing<INotifyDockClientMoving>().ToArray()
   */
  private static _resolveNotifyDockClientMoving(self: GameActor): INotifyDockClientMoving[] {
    const result: INotifyDockClientMoving[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits) {
      for (const [, trait] of traits) {
        const t = trait as Partial<INotifyDockClientMoving>
        if (typeof t.movingToDock === 'function' && typeof t.movementCancelled === 'function') {
          result.push(t as INotifyDockClientMoving)
        }
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// DockClientManagerLike — 对接客户端管理器鸭子类型接口
// ---------------------------------------------------------------------------

/** DockClientManager 的最小接口 — 用于鸭子类型解析。
 *
 *  OpenRA 对照: DockClientManager
 *
 *  在完整迁移中，DockClientManager 是一个独立的 trait。此处使用鸭子类型
 *  以支持存根和测试。
 */
export interface DockClientManagerLike {
  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** 配置信息。 */
  readonly info: {
    /** 搜索对接主机的延迟 tick 数。 */
    searchForDockDelay: number
  }

  /** 当前预约的对接主机。 */
  readonly reservedHost: IDockHost | null

  /** 当前预约的对接主机 actor。 */
  readonly reservedHostActor: GameActor | null

  /** 查找最近的可用对接主机。
   *
   *  @param actor — 可选的特定 actor 搜索
   *  @returns 最近的主机链接，或 null
   */
  closestDock(actor: GameActor | null): DockHostLink | null

  /** 获取指定 actor 上的可用对接主机列表。
   *
   *  @param actor — 目标 actor
   *  @param type — 可选的对接类型过滤
   *  @param forceEnter — 是否强制进入
   *  @param ignoreOccupancy — 是否忽略占用
   *  @returns 可用主机链接列表
   */
  availableDockHosts(
    actor: GameActor,
    type?: number,
    forceEnter?: boolean,
    ignoreOccupancy?: boolean,
  ): DockHostLink[]

  /** 预约对接主机。
   *
   *  @param hostActor — 主机 actor
   *  @param host — 主机 trait
   *  @returns 预约是否成功
   */
  reserveHost(hostActor: GameActor, host: IDockHost): boolean

  /** 释放预约。 */
  unreserveHost(): void

  /** 排队移动活动回调 (由 IDockHost 调用)。
   *
   *  @param activity — 当前活动
   *  @param hostActor — 主机 actor
   *  @param self — 客户端 actor
   *  @param client — 客户端管理器
   *  @param moveCooldownHelper — 移动冷却辅助器
   *  @returns 是否成功排队
   */
  queueMoveActivity?(
    activity: Activity,
    hostActor: GameActor,
    self: GameActor,
    client: DockClientManagerLike,
    moveCooldownHelper: MoveCooldownHelper,
  ): boolean

  /** 排队对接活动回调 (由 IDockHost 调用)。
   *
   *  @param activity — 当前活动
   *  @param hostActor — 主机 actor
   *  @param self — 客户端 actor
   *  @param client — 客户端管理器
   */
  queueDockActivity?(
    activity: Activity,
    hostActor: GameActor,
    self: GameActor,
    client: DockClientManagerLike,
  ): void
}

// ---------------------------------------------------------------------------
// DockHostLink — 对接主机链接
// ---------------------------------------------------------------------------

/** 对接主机 actor + trait 的组合。
 *
 *  OpenRA 对照: (Actor, IDockHost) tuple / DockHostLink
 */
export interface DockHostLink {
  /** 对接主机 actor。 */
  actor: GameActor

  /** 对接主机 trait。 */
  trait: IDockHost
}

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/** 创建最小 DockClientManager 存根 (用于测试)。 */
function createStubDockClientManager(): DockClientManagerLike {
  return {
    isTraitDisabled: false,
    info: { searchForDockDelay: 25 },
    reservedHost: null,
    reservedHostActor: null,
    closestDock: () => null,
    availableDockHosts: () => [],
    reserveHost: () => false,
    unreserveHost: () => { /* no-op */ },
  }
}
