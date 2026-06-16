/**
 * Resupply.ts — 补给活动 (修复/重新装弹)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Resupply.cs
 *
 * 核心范式转换:
 * - C# ResupplyType 标志枚举 → TypeScript ResupplyType 位掩码
 * - C# allRepairsUnits.FirstOrDefault(r => !r.IsTraitDisabled) → TypeScript find()
 * - C# Game.Sound.PlayNotification() → TypeScript Sound.playNotification() (已迁移)
 * - C# TextNotificationsManager.AddTransientLine() → TypeScript 存根 (延迟)
 * - C# self.InflictDamage() → TypeScript health.inflictDamage() (负伤害 = 治疗)
 * - C# aircraft.UnReserve() / AllowYieldingReservation() → TypeScript 鸭子类型调用
 * - C# ChildActivity != null → TypeScript this.childActivity !== null
 * - C# NextActivity != null → TypeScript this.nextActivity !== null
 * - C# (long)unitCost * repairsUnits.Info.ValuePercentage → TypeScript number (无溢出风险)
 * - C# yield return → TypeScript 数组返回
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.ts'
import type { GameActor } from '../../OpenRA.Game/Actor.ts'
import type {
  IHealth,
  IMove,
  IMoveInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.ts'
import { Damage } from '../../OpenRA.Game/Traits/TraitsInterfaces.ts'
import { Target } from '../../OpenRA.Game/Traits/Target.ts'
import { WDist } from '../../OpenRA.Game/WDist.ts'
import { WPos } from '../../OpenRA.Game/WPos.ts'
import { CPos } from '../../OpenRA.Game/CPos.ts'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.ts'
import { TakeOff } from './Air/TakeOff.ts'
import { AttackMoveActivity } from './Move/AttackMoveActivity.ts'
import type {
  ResupplyType,
  INotifyResupply,
  INotifyDockClient,
  INotifyDockHost,
  Repairable,
  RepairableNear,
  Rearmable,
  RepairsUnits,
  RallyPoint,
  ValuedInfo,
  PlayerExperience,
} from './EconomicActivityInterfaces.ts'
import { ResupplyType as ResupplyTypeConst, TextNotificationsManager } from './EconomicActivityInterfaces.ts'
import type { ICallForTransport } from '../Traits/CarryableHarvester.ts'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.ts'
import type { Mobile } from '../Traits/Mobile.ts'

// ---------------------------------------------------------------------------
// Resupply
// ---------------------------------------------------------------------------

/**
 * 补给活动 — 在指定建筑处修复和/或重新装弹。
 *
 * OpenRA 对照: Resupply activity
 *
 * 工作流程:
 * 1. 构造函数: 解析所有相关 trait，确定激活的补给类型 (Repair / Rearm)
 * 2. tick: 如果不在范围内，排队移动活动；如果在范围内，执行修复/装弹 tick
 * 3. RepairTick: 扣除现金，应用负伤害 (治疗)，播放通知
 * 4. Rearm: 调用 rearmable.rearmTick()，完成后清除 Rearm 标志
 * 5. 完成: 调用 onResupplyEnding — 飞机起飞，地面单位移动到集结点
 * 6. cancel: 取消子移动活动，通知运输请求
 *
 * 被 ReturnToBase (飞机返回基地) 和 LayMines (布雷后重新装弹) 使用。
 */
export class Resupply extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** 补给目标 (主机 actor)。 */
  readonly host: Target

  /** 足够接近的距离 (负值 = 无距离限制)。 */
  readonly closeEnough: WDist

  /** 补给完成后是否停留在补给器上。 */
  readonly stayOnResupplier: boolean

  // ---------------------------------------------------------------------------
  // Resolved traits
  // ---------------------------------------------------------------------------

  /** 健康 trait (可能为 null)。 */
  private readonly health: IHealth | null

  /** 所有 RepairsUnits trait (主机上的)。 */
  private readonly allRepairsUnits: readonly RepairsUnits[]

  /** 可修复 trait (可能为 null)。 */
  private readonly repairable: Repairable | null

  /** 附近可修复 trait (可能为 null)。 */
  private readonly repairableNear: RepairableNear | null

  /** 可重新装弹 trait (可能为 null)。 */
  private readonly rearmable: Rearmable | null

  /** 补给通知接口数组 (主机上的)。 */
  private readonly notifyResupplies: readonly INotifyResupply[]

  /** 对接主机通知接口数组 (主机上的)。 */
  private readonly notifyDockHosts: readonly INotifyDockHost[]

  /** 对接客户端通知接口数组 (自身上的)。 */
  private readonly notifyDockClients: readonly INotifyDockClient[]

  /** 运输请求接口数组 (自身上的)。 */
  private readonly transportCallers: readonly ICallForTransport[]

  /** 移动 trait。 */
  private readonly move: IMove

  /** 飞机 trait (可能为 null — 如果不是飞机则为 null)。 */
  private readonly aircraft: AircraftLike | null

  /** 移动配置信息。 */
  private readonly moveInfo: IMoveInfo

  /** 玩家资源 (用于修复扣费)。 */
  private readonly playerResources: PlayerResourcesLike

  /** 单位造价 (用于计算修复费用)。 */
  private readonly unitCost: number

  /** 移动冷却辅助器。 */
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** 剩余 tick 数 (取消时倒计时)。 */
  private remainingTicks: number = 0

  /** 是否已播放开始修复通知。 */
  private played: boolean = false

  /** 实际补给是否已开始 (用于触发 beforeResupply 通知)。 */
  private actualResupplyStarted: boolean = false

  /** 当前激活的补给类型 (ResupplyType 位掩码)。 */
  private activeResupplyTypes: ResupplyType = ResupplyTypeConst.None

  /** 是否包含修复 (HACK: 强制飞机起飞)。 */
  private readonly wasRepaired: boolean

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 Resupply 活动。
   *
   * OpenRA 对照: Resupply(Actor, Actor, WDist, bool)
   *
   * @param self — 执行此活动的 actor
   * @param host — 提供补给的 actor (建筑)
   * @param closeEnough — 足够接近的距离
   * @param stayOnResupplier — 补给完成后是否停留在补给器上
   */
  constructor(
    self: GameActor,
    host: GameActor,
    closeEnough: WDist,
    stayOnResupplier: boolean = false,
  ) {
    super()
    this.host = Target.fromActor(host as unknown as IActorRef)
    this.closeEnough = closeEnough
    this.stayOnResupplier = stayOnResupplier

    // 解析主机上的 RepairsUnits
    this.allRepairsUnits = Resupply._resolveRepairsUnits(host)

    // 解析自身 trait
    this.health = Resupply._resolveHealth(self)
    this.repairable = Resupply._resolveRepairable(self)
    this.repairableNear = Resupply._resolveRepairableNear(self)
    this.rearmable = Resupply._resolveRearmable(self)

    // 解析通知接口
    this.notifyResupplies = Resupply._resolveNotifyResupplies(host)
    this.notifyDockHosts = Resupply._resolveNotifyDockHosts(host)
    this.notifyDockClients = Resupply._resolveNotifyDockClients(self)
    this.transportCallers = Resupply._resolveTransportCallers(self)

    // 解析移动相关
    this.move = Resupply._resolveMove(self)
    this.aircraft = Resupply._resolveAircraft(self)
    this.moveInfo = Resupply._resolveMoveInfo(self)

    // 解析玩家资源
    this.playerResources = Resupply._resolvePlayerResources(self)

    // 解析单位造价
    this.unitCost = Resupply._resolveUnitCost(self)

    // 创建移动冷却辅助器
    const mobile = (self as unknown as { traits?: Map<string, unknown> }).traits?.get('Mobile') ?? null
    const world = (self as unknown as { world?: { sharedRandom?: { next(): number } } | null }).world ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(world, mobile as unknown as Mobile | null)
    this.moveCooldownHelper.retryIfDestinationBlocked = true

    // 确定激活的补给类型
    let wasRepairedLocal = false

    const cannotRepairAtHost =
      this.health === null ||
      this.health.damageState === 1 || // DamageState.Undamaged = 1
      this.allRepairsUnits.length === 0 ||
      (
        (this.repairable === null || !this.repairable.info.repairActors.includes(host.info?.name ?? '')) &&
        (this.repairableNear === null || !this.repairableNear.info.repairActors.includes(host.info?.name ?? ''))
      )

    if (!cannotRepairAtHost) {
      this.activeResupplyTypes |= ResupplyTypeConst.Repair
      // HACK: Reservable 逻辑无法处理修复，因此如果补给包含修复则强制起飞。
      wasRepairedLocal = true
    }

    const cannotRearmAtHost =
      this.rearmable === null ||
      !this.rearmable.info.rearmActors.includes(host.info?.name ?? '') ||
      this.rearmable.rearmableAmmoPools.every((p: { hasFullAmmo: boolean }) => p.hasFullAmmo)

    if (!cannotRearmAtHost) {
      this.activeResupplyTypes |= ResupplyTypeConst.Rearm
    }

    this.wasRepaired = wasRepairedLocal
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 补给主逻辑。
   *
   * OpenRA 对照: Resupply.Tick(Actor)
   *
   * @param self — 执行此活动的 actor
   * @returns true 当活动完成，false 继续执行
   */
  override tick(self: GameActor): boolean {
    // 取消中且还有剩余 tick — 倒计时
    if (this.isCanceling && this.remainingTicks > 0) {
      this.remainingTicks--
      return false
    }

    // 检查主机是否有效
    const isHostInvalid = this.host.type !== 1 || !this.host.actor!.isInWorld // TargetType.Actor = 1

    let isCloseEnough = false
    if (!isHostInvalid) {
      // 负值 = 无距离限制
      if (this.closeEnough.length < 0) {
        isCloseEnough = true
      } else if (this.repairableNear !== null) {
        // RepairableNear: 使用 TargetablePositions 而不是 CenterPosition
        isCloseEnough = this.host.isInRange(
          (self as unknown as { centerPosition: WPos }).centerPosition,
          this.closeEnough,
        )
      } else {
        const delta = WPos.subtract(
          this.host.centerPosition,
          (self as unknown as { centerPosition: WPos }).centerPosition,
        )
        isCloseEnough = delta.horizontalLengthSquared <= this.closeEnough.lengthSquared
      }
    }

    // 主机无效且未取消 — 取消此活动
    if (!this.isCanceling && isHostInvalid) {
      this.cancel(self, true)
    }

    // 取消中或主机无效
    if (this.isCanceling || isHostInvalid) {
      // 主机仍存活时最后一次 tick 通知
      if (!isHostInvalid) {
        for (const notifyResupply of this.notifyResupplies) {
          notifyResupply.resupplyTick(this.host.actor! as unknown as GameActor, self, ResupplyTypeConst.None)
        }
      }

      // HACK: 如果在补给器上取消，移动 actor 离开补给器 footprint
      if (isCloseEnough || isHostInvalid) {
        this.onResupplyEnding(self, isHostInvalid)
      }

      return true
    }

    // 移动冷却辅助器 tick
    const result = this.moveCooldownHelper.tick(false)
    if (result !== null) return result

    // 不在范围内且不是飞机 — 排队移动
    if (this.activeResupplyTypes !== 0 && this.aircraft === null && !isCloseEnough) {
      const targetCell = (self as unknown as { world?: { map?: { cellContaining: (pos: WPos) => CPos } } }).world?.map?.cellContaining(this.host.actor!.centerPosition)

      // HACK: Repairable 需要 actor 移动到主机中心。
      this.moveCooldownHelper.notifyMoveQueued()
      if (this.repairableNear === null) {
        // 使用 moveOntoTarget (MoveOnto)
        const moveActivity = this.move.moveToTarget(self, this.host)
        this.queueChild(moveActivity)
      } else {
        // 使用 MoveWithinRange
        const moveActivity = this.move.moveWithinRange(
          self,
          this.host,
          this.closeEnough,
          undefined,
        )
        this.queueChild(moveActivity)
      }

      // 请求运输 (如果有)
      const delta = WPos.subtract(
        (self as unknown as { centerPosition: WPos }).centerPosition,
        this.host.centerPosition,
      ).lengthSquared
      for (const t of this.transportCallers) {
        const minDist = (t as unknown as { minimumDistance?: WDist }).minimumDistance
        if (minDist !== undefined && minDist.lengthSquared < delta) {
          t.requestTransport(self, targetCell ?? new CPos(0, 0))
        }
      }

      return false
    }

    // 开始补给 (首次)
    if (!this.actualResupplyStarted && this.activeResupplyTypes > 0) {
      this.actualResupplyStarted = true
      for (const t of this.transportCallers) {
        t.movementCancelled(self)
      }
      for (const notifyResupply of this.notifyResupplies) {
        notifyResupply.beforeResupply(this.host.actor! as unknown as GameActor, self, this.activeResupplyTypes)
      }
      for (const nd of this.notifyDockClients) {
        nd.docked(self, this.host.actor! as unknown as GameActor)
      }
      for (const nd of this.notifyDockHosts) {
        nd.docked(this.host.actor! as unknown as GameActor, self)
      }
    }

    // 修复 tick
    if ((this.activeResupplyTypes & ResupplyTypeConst.Repair) === ResupplyTypeConst.Repair) {
      this.repairTick(self)
    }

    // 装弹 tick
    if ((this.activeResupplyTypes & ResupplyTypeConst.Rearm) === ResupplyTypeConst.Rearm) {
      if (this.rearmable !== null && this.rearmable.rearmTick(self)) {
        this.activeResupplyTypes &= ~ResupplyTypeConst.Rearm
      }
    }

    // 通知补给 tick
    for (const notifyResupply of this.notifyResupplies) {
      notifyResupply.resupplyTick(this.host.actor! as unknown as GameActor, self, this.activeResupplyTypes)
    }

    // 所有补给完成
    if (this.activeResupplyTypes === 0) {
      this.onResupplyEnding(self)
      return true
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * 取消此活动 — 取消子移动活动并通知运输请求。
   *
   * OpenRA 对照: Resupply.Cancel(Actor, bool)
   *
   * HACK: 强制移动活动忽略 transit-only 单元格。
   *
   * @param self — 执行此活动的 actor
   * @param keepQueue — 是否保留后续活动队列
   */
  override cancel(self: GameActor, keepQueue: boolean = false): void {
    // HACK: 取消时强制移动活动忽略 transit-only 单元格
    // 空闲处理程序将接管并移动它们到安全单元格
    const child = this.childActivity
    if (child !== null) {
      // 查找所有子活动并取消
      const moves = child.activitiesImplementing(Activity as unknown as new (...args: any[]) => Activity)
      for (const m of moves) {
        m.cancel(self, false)
      }
    }

    for (const t of this.transportCallers) {
      t.movementCancelled(self)
    }

    super.cancel(self, keepQueue)
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * 获取目标线节点。
   *
   * OpenRA 对照: Resupply.TargetLineNodes(Actor)
   */
  override targetLineNodes(self: GameActor): TargetLineNode[] {
    const child = this.childActivity
    if (child === null) {
      return [new TargetLineNode(this.host, this.moveInfo.getTargetLineColor())]
    } else {
      const result: TargetLineNode[] = []
      let current: Activity | null = child
      while (current !== null) {
        result.push(...current.targetLineNodes(self))
        current = current.nextActivity
      }
      return result
    }
  }

  // ---------------------------------------------------------------------------
  // OnResupplyEnding — 补给结束处理
  // ---------------------------------------------------------------------------

  /**
   * 补给结束时的处理 — 飞机起飞或地面单位离开。
   *
   * OpenRA 对照: Resupply.OnResupplyEnding(Actor, bool)
   *
   * @param self — 执行此活动的 actor
   * @param isHostInvalid — 主机是否已失效
   */
  private onResupplyEnding(self: GameActor, isHostInvalid: boolean = false): void {
    const hostActor = isHostInvalid ? null : this.host.actor as unknown as GameActor | null
    const rp = hostActor !== null
      ? Resupply._resolveRallyPoint(hostActor)
      : null

    if (this.aircraft !== null) {
      // 飞机处理
      if (this.wasRepaired || isHostInvalid || (!this.stayOnResupplier && this.aircraft.info.takeOffOnResupply)) {
        const nextActivity = (self as unknown as { currentActivity?: { nextActivity: Activity | null } }).currentActivity?.nextActivity ?? null
        if (nextActivity === null && rp !== null && rp.path.length > 0) {
          this.moveCooldownHelper.notifyMoveQueued()
          for (const cell of rp.path) {
            const moveActivity = this.move.moveTo(
              self,
              Target.fromCell(cell),
            )
            this.queueChild(new AttackMoveActivity(self, () => moveActivity))
          }
        } else {
          this.queueChild(new TakeOff(self))
        }
        this.aircraft.unReserve()
      } else {
        // 不 TakeOffOnResupply 的飞机保持停留在补给器上
        this.aircraft.allowYieldingReservation()
      }
    } else if (!this.stayOnResupplier && !isHostInvalid) {
      // 地面单位处理
      this.moveCooldownHelper.notifyMoveQueued()
      const currentActivity = (self as unknown as { currentActivity?: { nextActivity: Activity | null } }).currentActivity
      const nextActivity = currentActivity?.nextActivity ?? null

      if (nextActivity === null) {
        if (rp !== null && rp.path.length > 0) {
          // 移动到集结点
          for (const cell of rp.path) {
            const moveActivity = this.move.moveTo(
              self,
              Target.fromCell(cell),
            )
            this.queueChild(new AttackMoveActivity(self, () => moveActivity))
          }
        } else if (this.repairableNear === null) {
          // 离开主机
          const moveActivity = this.move.moveToTarget(self, this.host)
          this.queueChild(moveActivity)
        }
      } else if (this.repairableNear === null) {
        // 有下一个活动且不是 Move — 先离开主机
        const moveActivity = this.move.moveToTarget(self, this.host)
        this.queueChild(moveActivity)
      }
    }

    // 通知解对接
    for (const nd of this.notifyDockClients) {
      nd.undocked(self, this.host.actor! as unknown as GameActor)
    }
    if (!isHostInvalid) {
      for (const nd of this.notifyDockHosts) {
        nd.undocked(this.host.actor! as unknown as GameActor, self)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RepairTick — 修复逻辑
  // ---------------------------------------------------------------------------

  /**
   * 执行一次修复 tick。
   *
   * OpenRA 对照: Resupply.RepairTick(Actor)
   *
   * @param self — 执行此活动的 actor
   */
  private repairTick(self: GameActor): void {
    // 找到第一个未禁用且未暂停的 RepairsUnits
    const repairsUnits = this.allRepairsUnits.find(
      r => !r.isTraitDisabled && !r.isTraitPaused,
    )

    if (repairsUnits === undefined) {
      // 没有可用的 RepairsUnits
      if (!this.allRepairsUnits.some(r => r.isTraitPaused)) {
        this.activeResupplyTypes &= ~ResupplyTypeConst.Repair
      }
      return
    }

    // 已完全修复
    if (this.health !== null && this.health.damageState === 1) { // Undamaged = 1
      // 给予玩家经验 (如果主机不属于同一玩家)
      const hostActor = this.host.actor as unknown as GameActor | null
      if (hostActor !== null && hostActor.owner !== self.owner) {
        const playerExperience = Resupply._resolvePlayerExperience(hostActor)
        if (playerExperience !== null) {
          playerExperience.giveExperience(repairsUnits.info.playerExperience)
        }
      }

      // 播放完成修复通知
      if (repairsUnits.info.finishRepairingNotification !== null) {
        Resupply._playNotification(self, repairsUnits.info.finishRepairingNotification)
      }
      if (repairsUnits.info.finishRepairingTextNotification !== null) {
        TextNotificationsManager.addTransientLine(self.owner ?? null, repairsUnits.info.finishRepairingTextNotification)
      }

      this.activeResupplyTypes &= ~ResupplyTypeConst.Repair
      return
    }

    // 修复间隔倒计时
    if (this.remainingTicks === 0) {
      // 计算修复 HP
      const hpToRepair =
        this.repairable !== null && this.repairable.info.hpPerStep > 0
          ? this.repairable.info.hpPerStep
          : repairsUnits.info.hpPerStep

      // 计算修复费用
      const value = this.unitCost * repairsUnits.info.valuePercentage
      const cost = value === 0
        ? 0
        : Math.max(1, Math.floor(hpToRepair * value / (this.health!.maxHP * 100)))

      // 首次播放开始修复通知
      if (!this.played) {
        this.played = true
        if (repairsUnits.info.startRepairingNotification !== null) {
          Resupply._playNotification(self, repairsUnits.info.startRepairingNotification)
        }
        if (repairsUnits.info.startRepairingTextNotification !== null) {
          TextNotificationsManager.addTransientLine(self.owner ?? null, repairsUnits.info.startRepairingTextNotification)
        }
      }

      // 扣除费用
      if (!this.playerResources.takeCash(cost, true)) {
        this.remainingTicks = 1
        return
      }

      // 应用负伤害 (治疗)
      const damage = new Damage(-hpToRepair, {
        contains: (v: number) => repairsUnits.info.repairDamageTypes.includes(String(v)),
        isEmpty: () => repairsUnits.info.repairDamageTypes.length === 0,
      })
      const hostActor = this.host.actor as unknown as GameActor | null
      this.health!.inflictDamage(self, hostActor ?? self, damage, true)
      this.remainingTicks = repairsUnits.info.interval
    } else {
      this.remainingTicks--
    }
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 解析 IHealth。 */
  private static _resolveHealth(self: GameActor): IHealth | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits?.has('IHealth')) {
      return traits.get('IHealth') as IHealth
    }
    // 鸭子类型查找
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<IHealth>
      if (t.hp !== undefined && t.maxHP !== undefined && t.damageState !== undefined) {
        return t as IHealth
      }
    }
    return null
  }

  /** 解析 RepairsUnits (主机上)。 */
  private static _resolveRepairsUnits(host: GameActor): RepairsUnits[] {
    const result: RepairsUnits[] = []
    const traits = (host as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<RepairsUnits>
      if (t.info !== undefined && (t.info as RepairsUnits['info']).hpPerStep !== undefined) {
        result.push(t as RepairsUnits)
      }
    }
    return result
  }

  /** 解析 Repairable。 */
  private static _resolveRepairable(self: GameActor): Repairable | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<Repairable>
      if (t.info !== undefined && (t.info as Repairable['info']).repairActors !== undefined) {
        return t as Repairable
      }
    }
    return null
  }

  /** 解析 RepairableNear。 */
  private static _resolveRepairableNear(self: GameActor): RepairableNear | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<RepairableNear>
      if (t.info !== undefined && (t.info as RepairableNear['info']).repairActors !== undefined &&
          !((t.info as Record<string, unknown>).hpPerStep !== undefined)) {
        return t as RepairableNear
      }
    }
    return null
  }

  /** 解析 Rearmable。 */
  private static _resolveRearmable(self: GameActor): Rearmable | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<Rearmable>
      if (typeof t.rearmTick === 'function' && t.rearmableAmmoPools !== undefined) {
        return t as Rearmable
      }
    }
    return null
  }

  /** 解析 INotifyResupply (主机上)。 */
  private static _resolveNotifyResupplies(host: GameActor): INotifyResupply[] {
    const result: INotifyResupply[] = []
    const traits = (host as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyResupply>
      if (typeof t.beforeResupply === 'function' && typeof t.resupplyTick === 'function') {
        result.push(t as INotifyResupply)
      }
    }
    return result
  }

  /** 解析 INotifyDockHost (主机上)。 */
  private static _resolveNotifyDockHosts(host: GameActor): INotifyDockHost[] {
    const result: INotifyDockHost[] = []
    const traits = (host as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyDockHost>
      if (typeof t.docked === 'function' && typeof t.undocked === 'function') {
        result.push(t as INotifyDockHost)
      }
    }
    return result
  }

  /** 解析 INotifyDockClient (自身上)。 */
  private static _resolveNotifyDockClients(self: GameActor): INotifyDockClient[] {
    const result: INotifyDockClient[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyDockClient>
      if (typeof t.docked === 'function' && typeof t.undocked === 'function') {
        result.push(t as INotifyDockClient)
      }
    }
    return result
  }

  /** 解析 ICallForTransport (自身上)。 */
  private static _resolveTransportCallers(self: GameActor): ICallForTransport[] {
    const result: ICallForTransport[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<ICallForTransport>
      if (typeof t.requestTransport === 'function' && typeof t.movementCancelled === 'function') {
        result.push(t as ICallForTransport)
      }
    }
    return result
  }

  /** 解析 IMove。 */
  private static _resolveMove(self: GameActor): IMove {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const mobile = traits?.get('Mobile') as IMove | undefined
    if (mobile && typeof mobile.moveTo === 'function') {
      return mobile
    }
    // 回退: 检查 actor 本身
    const actorAny = self as unknown as Partial<IMove>
    if (typeof actorAny.moveTo === 'function') {
      return actorAny as IMove
    }
    throw new Error('Resupply requires an IMove trait on the actor')
  }

  /** 解析 Aircraft (可能为 null)。 */
  private static _resolveAircraft(self: GameActor): AircraftLike | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const aircraft = traits?.get('Aircraft')
    if (aircraft && typeof (aircraft as AircraftLike).unReserve === 'function') {
      return aircraft as AircraftLike
    }
    return null
  }

  /** 解析 IMoveInfo。 */
  private static _resolveMoveInfo(self: GameActor): IMoveInfo {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const mobile = traits?.get('Mobile') as { info?: IMoveInfo } | undefined
    if (mobile?.info && typeof mobile.info.getTargetLineColor === 'function') {
      return mobile.info
    }
    // 回退存根
    return {
      getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }),
    } as IMoveInfo
  }

  /** 解析 PlayerResources。 */
  private static _resolvePlayerResources(self: GameActor): PlayerResourcesLike {
    const owner = self.owner
    if (owner) {
      const playerActor = (owner as unknown as { playerActor?: unknown }).playerActor
      if (playerActor) {
        const pr = (playerActor as unknown as { playerResources?: PlayerResourcesLike }).playerResources
        if (pr) return pr
      }
    }
    // 回退存根
    return {
      takeCash: (_cost: number, _silenced: boolean) => true,
    }
  }

  /** 解析 PlayerExperience (主机所有者上)。 */
  private static _resolvePlayerExperience(host: GameActor): PlayerExperience | null {
    const owner = host.owner
    if (owner) {
      const playerActor = (owner as unknown as { playerActor?: unknown }).playerActor
      if (playerActor) {
        const pe = (playerActor as unknown as { playerExperience?: PlayerExperience }).playerExperience
        if (pe) return pe
      }
    }
    return null
  }

  /** 解析单位造价。 */
  private static _resolveUnitCost(self: GameActor): number {
    const info = (self as unknown as { info?: { valued?: ValuedInfo } }).info
    if (info?.valued?.cost !== undefined) {
      return info.valued.cost
    }
    // 从 traits 查找 ValuedInfo
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<ValuedInfo>
      if (t.cost !== undefined) {
        return t.cost
      }
    }
    return 0
  }

  /** 解析 RallyPoint (主机上)。 */
  private static _resolveRallyPoint(host: GameActor): RallyPoint | null {
    const traits = (host as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<RallyPoint>
      if (t.path !== undefined && Array.isArray(t.path)) {
        return t as RallyPoint
      }
    }
    return null
  }

  /** 播放语音通知。 */
  private static _playNotification(self: GameActor, notification: string): void {
    const world = (self as unknown as { world?: { playSound?: (type: string, sounds: readonly string[], world: unknown, pos: unknown) => void } }).world
    if (world?.playSound) {
      world.playSound('Speech', [notification], self.world, (self as unknown as { centerPosition: WPos }).centerPosition)
    }
  }
}

// ---------------------------------------------------------------------------
// AircraftLike — 飞机 trait 鸭子类型
// ---------------------------------------------------------------------------

/** 飞机 trait 最小接口 — 用于 Resupply 中的飞机处理。
 *
 *  OpenRA 对照: Aircraft trait
 */
export interface AircraftLike {
  /** 是否强制降落。 */
  readonly forceLanding: boolean

  /** 配置信息。 */
  readonly info: {
    /** 是否在补给后起飞。 */
    takeOffOnResupply: boolean
  }

  /** 取消预约。 */
  unReserve(): void

  /** 允许让出预约。 */
  allowYieldingReservation(): void
}

// ---------------------------------------------------------------------------
// PlayerResourcesLike — 玩家资源鸭子类型
// ---------------------------------------------------------------------------

/** 玩家资源最小接口。
 *
 *  OpenRA 对照: PlayerResources
 */
export interface PlayerResourcesLike {
  /** 扣除现金。
   *
   *  @param cost — 费用
   *  @param silenced — 是否静默
   *  @returns 是否成功扣除
   */
  takeCash(cost: number, silenced: boolean): boolean
}
