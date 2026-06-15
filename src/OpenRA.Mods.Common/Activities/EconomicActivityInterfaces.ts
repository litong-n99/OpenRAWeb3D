/**
 * EconomicActivityInterfaces.ts — 经济活动通知接口与辅助类型
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (相关部分)
 *
 * 核心范式转换:
 * - C# INotifyDockClient / INotifyDockHost / INotifyResupply 等接口 → TypeScript 接口
 * - C# 显式接口实现 → TypeScript 鸭子类型 + 接口标记
 * - C# 动画回调 (PlayThen / PlayBackwardsThen) → TypeScript 回调存根 (动画延迟到渲染章节)
 * - C# ResupplyType 枚举 → TypeScript 枚举对象
 *
 * 这些接口被 MoveToDock、GenericDockSequence、Resupply、HarvestResource、
 * FindAndDeliverResources、LayMines、Sell 等活动使用。
 */

import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'
import type { WPos } from '../../OpenRA.Game/WPos.js'
import type { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ResupplyType 枚举 (对应 OpenRA ResupplyType)
// ---------------------------------------------------------------------------

/** 补给类型标志位 — 用于 Resupply 活动标记当前正在进行的补给操作。
 *
 *  OpenRA 对照: ResupplyType { None = 0, Repair = 1, Rearm = 2 }
 */
export const ResupplyType = {
  None: 0,
  Repair: 1,
  Rearm: 2,
} as const

export type ResupplyType = (typeof ResupplyType)[keyof typeof ResupplyType]

/** ResupplyType 扩展工具。 */
export const ResupplyTypeExts = {
  /** 检查是否包含某个补给类型。 */
  hasFlag(self: ResupplyType, flag: ResupplyType): boolean {
    return (self & flag) === flag
  },
} as const

// ---------------------------------------------------------------------------
// INotifyDockClient — 对接客户端通知 (对应 OpenRA INotifyDockClient)
// ---------------------------------------------------------------------------

/** 当对接客户端 (如收割机) 完成对接/解对接时调用。
 *
 *  OpenRA 对照: INotifyDockClient
 *
 *  被 GenericDockSequence、Resupply、MoveToDock 使用。
 */
export interface INotifyDockClient {
  /** 对接完成时调用。
   *
   *  @param self — 对接客户端 actor
   *  @param host — 对接主机 actor
   */
  docked(self: IGameActor, host: IGameActor): void

  /** 解对接时调用。
   *
   *  @param self — 对接客户端 actor
   *  @param host — 对接主机 actor
   */
  undocked(self: IGameActor, host: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyDockHost — 对接主机通知 (对应 OpenRA INotifyDockHost)
// ---------------------------------------------------------------------------

/** 当对接主机 (如精炼厂) 有客户端完成对接/解对接时调用。
 *
 *  OpenRA 对照: INotifyDockHost
 *
 *  被 GenericDockSequence、Resupply 使用。
 */
export interface INotifyDockHost {
  /** 客户端对接完成时调用。
   *
   *  @param host — 对接主机 actor
   *  @param client — 对接客户端 actor
   */
  docked(host: IGameActor, client: IGameActor): void

  /** 客户端解对接时调用。
   *
   *  @param host — 对接主机 actor
   *  @param client — 对接客户端 actor
   */
  undocked(host: IGameActor, client: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyDockClientMoving — 对接客户端移动通知 (对应 OpenRA INotifyDockClientMoving)
// ---------------------------------------------------------------------------

/** 当对接客户端开始/取消向对接主机移动时调用。
 *
 *  OpenRA 对照: INotifyDockClientMoving
 *
 *  被 MoveToDock 使用。已存在于 CarryableHarvester.ts，此处扩展为正式接口。
 */
export interface INotifyDockClientMoving {
  /** 开始移动到对接主机时调用。
   *
   *  @param self — 移动中的 actor
   *  @param hostActor — 目标对接主机 actor
   *  @param host — 目标对接主机 trait
   */
  movingToDock(self: IGameActor, hostActor: IGameActor, host: IDockHostLike): void

  /** 移动被取消时调用。
   *
   *  @param self — 移动被取消的 actor
   */
  movementCancelled(self: IGameActor): void
}

/** 对接主机最小接口 — 用于 INotifyDockClientMoving 的 host 参数。
 *
 *  提供 dockPosition 供运输单元计算目标单元格。
 */
export interface IDockHostLike {
  readonly dockPosition: { X: number; Y: number; Z: number }
}

// ---------------------------------------------------------------------------
// INotifyResupply — 补给过程通知 (对应 OpenRA INotifyResupply)
// ---------------------------------------------------------------------------

/** 当补给过程开始或每 tick 时调用。
 *
 *  OpenRA 对照: INotifyResupply
 *
 *  被 Resupply 使用。
 */
export interface INotifyResupply {
  /** 补给开始前调用。
   *
   *  @param host — 提供补给的 actor
   *  @param client — 接受补给的 actor
   *  @param types — 当前激活的补给类型 (ResupplyType 位掩码)
   */
  beforeResupply(host: IGameActor, client: IGameActor, types: ResupplyType): void

  /** 每 tick 调用一次。
   *
   *  @param host — 提供补给的 actor
   *  @param client — 接受补给的 actor
   *  @param types — 当前激活的补给类型 (ResupplyType 位掩码)
   */
  resupplyTick(host: IGameActor, client: IGameActor, types: ResupplyType): void
}

// ---------------------------------------------------------------------------
// INotifyHarvestAction — 收割动作通知 (对应 OpenRA INotifyHarvestAction)
// ---------------------------------------------------------------------------

/** 当收割机开始/完成/取消收割动作时调用。
 *
 *  OpenRA 对照: INotifyHarvestAction
 *
 *  被 HarvestResource、FindAndDeliverResources 使用。
 *  已存在于 CarryableHarvester.ts (仅有 movingToResources)，此处扩展完整接口。
 */
export interface INotifyHarvestAction {
  /** 开始移动到资源时调用。
   *
   *  @param self — 收割机 actor
   *  @param targetCell — 目标资源单元格
   */
  movingToResources(self: IGameActor, targetCell: CPos): void

  /** 完成一次收割时调用。
   *
   *  @param self — 收割机 actor
   *  @param resourceType — 收割的资源类型
   */
  harvested(self: IGameActor, resourceType: string): void

  /** 移动被取消时调用。
   *
   *  @param self — 收割机 actor
   */
  movementCancelled(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyMineLaying — 布雷通知 (对应 OpenRA INotifyMineLaying)
// ---------------------------------------------------------------------------

/** 当布雷过程开始/完成/取消时调用。
 *
 *  OpenRA 对照: INotifyMineLaying
 *
 *  被 LayMines 使用。
 */
export interface INotifyMineLaying {
  /** 开始布雷时调用。
   *
   *  @param self — 布雷 actor
   *  @param location — 布雷位置
   */
  mineLaying(self: IGameActor, location: CPos): void

  /** 布雷被取消时调用。
   *
   *  @param self — 布雷 actor
   *  @param location — 被取消的布雷位置
   */
  mineLayingCanceled(self: IGameActor, location: CPos): void

  /** 地雷被成功放置时调用。
   *
   *  @param self — 布雷 actor
   *  @param mine — 新放置的地雷 actor
   */
  mineLaid(self: IGameActor, mine: IGameActor): void
}

// ---------------------------------------------------------------------------
// IDockClientBody — 对接客户端身体动画 (对应 OpenRA IDockClientBody)
// ---------------------------------------------------------------------------

/** 对接客户端身体动画接口。
 *
 *  OpenRA 对照: IDockClientBody
 *
 *  被 GenericDockSequence 使用。控制对接时的身体动画 (如收割机倾倒动画)。
 *  动画回调存根 — 实际动画渲染延迟到渲染章节。
 */
export interface IDockClientBody {
  /** 播放对接动画。
   *
   *  @param self — 动画所属的 actor
   *  @param after — 动画完成后的回调
   */
  playDockAnimation(self: IGameActor, after: () => void): void

  /** 播放反向对接动画 (解对接)。
   *
   *  @param self — 动画所属的 actor
   *  @param after — 动画完成后的回调
   */
  playReverseDockAnimation(self: IGameActor, after: () => void): void
}

// ---------------------------------------------------------------------------
// WithDockingOverlay — 对接主机覆盖动画 (对应 OpenRA WithDockingOverlay)
// ---------------------------------------------------------------------------

/** 对接主机上的覆盖动画 (如精炼厂漏斗动画)。
 *
 *  OpenRA 对照: WithDockingOverlay
 *
 *  被 GenericDockSequence 使用。控制对接主机上的覆盖动画序列。
 *  动画回调存根 — 实际动画渲染延迟到渲染章节。
 */
export interface WithDockingOverlay {
  /** 覆盖是否可见。 */
  visible: boolean

  /** 配置信息。 */
  info: {
    /** 动画序列名称。 */
    sequence: string
  }

  /** 带偏移的动画控制器。 */
  withOffset: {
    animation: {
      /** 播放序列然后调用回调。 */
      playThen(sequence: string, after: () => void): void

      /** 反向播放序列然后调用回调。 */
      playBackwardsThen(sequence: string, after: () => void): void
    }
  }
}

// ---------------------------------------------------------------------------
// RepairsUnits — 修复单位 trait 接口 (对应 OpenRA RepairsUnits)
// ---------------------------------------------------------------------------

/** 提供修复服务的 trait (如维修站)。
 *
 *  OpenRA 对照: RepairsUnits
 *
 *  被 Resupply 使用。
 */
export interface RepairsUnits {
  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** 是否被暂停。 */
  readonly isTraitPaused: boolean

  /** 配置信息。 */
  readonly info: {
    /** 每 tick 修复的 HP 量。 */
    hpPerStep: number

    /** 修复价值百分比 (影响费用)。 */
    valuePercentage: number

    /** 修复间隔 (tick 数)。 */
    interval: number

    /** 修复伤害类型。 */
    repairDamageTypes: string[]

    /** 开始修复时的语音通知。 */
    startRepairingNotification: string | null

    /** 完成修复时的语音通知。 */
    finishRepairingNotification: string | null

    /** 开始修复时的文字通知。 */
    startRepairingTextNotification: string | null

    /** 完成修复时的文字通知。 */
    finishRepairingTextNotification: string | null

    /** 修复完成后给予的玩家经验值。 */
    playerExperience: number
  }
}

// ---------------------------------------------------------------------------
// Repairable / RepairableNear — 可修复接口 (对应 OpenRA Repairable / RepairableNear)
// ---------------------------------------------------------------------------

/** 可被修复的 trait (主动移动到修复建筑)。
 *
 *  OpenRA 对照: Repairable
 *
 *  被 Resupply 使用。
 */
export interface Repairable {
  /** 配置信息。 */
  readonly info: {
    /** 可修复该单位的建筑类型列表。 */
    repairActors: string[]

    /** 每步修复的 HP (覆盖 RepairsUnits 的值)。 */
    hpPerStep: number
  }
}

/** 可在附近被修复的 trait (不进入建筑)。
 *
 *  OpenRA 对照: RepairableNear
 *
 *  被 Resupply 使用。
 */
export interface RepairableNear {
  /** 配置信息。 */
  readonly info: {
    /** 可修复该单位的建筑类型列表。 */
    repairActors: string[]
  }
}

// ---------------------------------------------------------------------------
// Rearmable — 可重新装弹接口 (对应 OpenRA Rearmable)
// ---------------------------------------------------------------------------

/** 可重新装弹的 trait。
 *
 *  OpenRA 对照: Rearmable
 *
 *  被 Resupply、LayMines 使用。
 */
export interface Rearmable {
  /** 配置信息。 */
  readonly info: {
    /** 可重新装弹的建筑类型列表。 */
    rearmActors: string[]
  }

  /** 执行一次装弹 tick。
   *
   *  @param self — 装弹的 actor
   *  @returns true 当装弹完成
   */
  rearmTick(self: IGameActor): boolean

  /** 可装弹的弹药池列表。 */
  readonly rearmableAmmoPools: { readonly hasFullAmmo: boolean }[]
}

// ---------------------------------------------------------------------------
// RallyPoint — 集结点接口 (对应 OpenRA RallyPoint)
// ---------------------------------------------------------------------------

/** 建筑的集结点路径。
 *
 *  OpenRA 对照: RallyPoint
 *
 *  被 Resupply 使用。补给完成后单位沿此路径移动。
 */
export interface RallyPoint {
  /** 集结点路径单元格列表。 */
  readonly path: readonly CPos[]
}

// ---------------------------------------------------------------------------
// BodyOrientation — 身体朝向接口 (对应 OpenRA BodyOrientation)
// ---------------------------------------------------------------------------

/** 量化身体朝向。
 *
 *  OpenRA 对照: BodyOrientation
 *
 *  被 HarvestResource 使用。
 */
export interface BodyOrientation {
  /** 将当前朝向量化到指定的面数。
   *
   *  @param facing — 当前朝向
   *  @param facings — 目标面数
   *  @returns 量化后的朝向
   */
  quantizeFacing(facing: WAngle, facings: number): WAngle
}

// ---------------------------------------------------------------------------
// ValuedInfo — 价值信息 (对应 OpenRA ValuedInfo)
// ---------------------------------------------------------------------------

/** 单位造价信息。
 *
 *  OpenRA 对照: ValuedInfo
 *
 *  被 Resupply 使用 (计算修复费用)。
 */
export interface ValuedInfo {
  /** 单位造价。 */
  readonly cost: number
}

// ---------------------------------------------------------------------------
// ActorMap — 演员地图接口 (对应 OpenRA ActorMap)
// ---------------------------------------------------------------------------

/** 空间索引查询接口。
 *
 *  OpenRA 对照: ActorMap
 *
 *  被 LayMines 使用。
 */
export interface ActorMap {
  /** 获取指定单元格上的所有 actor。
   *
   *  @param cell — 单元格位置
   *  @returns 该单元格上的 actor 列表
   */
  getActorsAt(cell: CPos): readonly IGameActor[]
}

// ---------------------------------------------------------------------------
// FloatingText — 浮动文字效果 (对应 OpenRA FloatingText)
// ---------------------------------------------------------------------------

/** 浮动文字效果 (如 "+$XXX")。
 *
 *  OpenRA 对照: FloatingText
 *
 *  被 Sell 使用。实际渲染延迟到视觉特效章节。
 */
export class FloatingText {
  readonly position: WPos
  readonly color: ColorStub
  readonly text: string
  readonly duration: number

  /** 格式化现金 tick 显示文本。
   *
   *  @param amount — 金额
   *  @returns 格式化后的字符串 (如 "+$100")
   */
  static formatCashTick(amount: number): string {
    return `+$${amount}`
  }

  /** 创建浮动文字实例。
   *
   *  @param position — 世界位置
   *  @param color — 颜色
   *  @param text — 显示文本
   *  @param duration — 持续时间 (tick 数)
   */
  constructor(
    position: WPos,
    color: ColorStub,
    text: string,
    duration: number,
  ) {
    this.position = position
    this.color = color
    this.text = text
    this.duration = duration
    // 存根 — 实际渲染延迟
  }
}

// ---------------------------------------------------------------------------
// TextNotificationsManager — 文字通知管理器 (对应 OpenRA TextNotificationsManager)
// ---------------------------------------------------------------------------

/** 文字通知管理器。
 *
 *  OpenRA 对照: TextNotificationsManager
 *
 *  被 Resupply、Sell 使用。实际 UI 延迟到 UI 章节。
 */
export class TextNotificationsManager {
  /** 添加一条临时文字通知。
   *
   *  @param player — 接收通知的玩家
   *  @param text — 通知文本 (null 则忽略)
   */
  static addTransientLine(_player: PlayerStub | null, text: string | null): void {
    if (text === null) return
    // 存根 — 实际通知系统延迟到 UI 章节
  }
}

// ---------------------------------------------------------------------------
// PlayerExperience — 玩家经验接口 (对应 OpenRA PlayerExperience)
// ---------------------------------------------------------------------------

/** 玩家经验系统。
 *
 *  OpenRA 对照: PlayerExperience
 *
 *  被 Resupply 使用。
 */
export interface PlayerExperience {
  /** 给予玩家经验。
   *
   *  @param amount — 经验值
   */
  giveExperience(amount: number): void
}

// ---------------------------------------------------------------------------
// Minelayer — 布雷器接口 (对应 OpenRA Minelayer)
// ---------------------------------------------------------------------------

/** 布雷器 trait。
 *
 *  OpenRA 对照: Minelayer
 *
 *  被 LayMines 使用。
 */
export interface Minelayer {
  /** 配置信息。 */
  readonly info: {
    /** 地雷 actor 类型名称。 */
    mine: string

    /** 使用的弹药池名称。 */
    ammoPoolName: string

    /** 每次布雷消耗的弹药量。 */
    ammoUsage: number

    /** 布雷前延迟 (tick 数)。 */
    preLayDelay: number

    /** 布雷后延迟 (tick 数)。 */
    afterLayingDelay: number

    /** 目标线颜色。 */
    targetLineColor: ColorStub

    /** 布雷预览图块。 */
    tile: unknown | null
  }
}

// ---------------------------------------------------------------------------
// Init stubs for LayMines actor creation
// ---------------------------------------------------------------------------

/** 位置初始化参数。
 *
 *  OpenRA 对照: LocationInit
 */
export class LocationInit {
  readonly location: CPos
  constructor(location: CPos) {
    this.location = location
  }
}

/** 所有者初始化参数。
 *
 *  OpenRA 对照: OwnerInit
 */
export class OwnerInit {
  readonly owner: PlayerStub
  constructor(owner: PlayerStub) {
    this.owner = owner
  }
}

/** 父 actor 初始化参数。
 *
 *  OpenRA 对照: ParentActorInit
 */
export class ParentActorInit {
  readonly parent: IGameActor
  constructor(parent: IGameActor) {
    this.parent = parent
  }
}
