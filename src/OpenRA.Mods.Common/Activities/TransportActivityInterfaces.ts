/**
 * TransportActivityInterfaces.ts — 运输活动通知接口与辅助类型
 * OpenRA 对照: OpenRA.Mods.Common/Traits/ Cargo.cs, Passenger.cs, Carryall.cs, Carryable.cs (相关接口)
 *
 * 核心范式转换:
 * - C# Cargo / Passenger / Carryall / Carryable traits → TypeScript 鸭子类型接口
 * - C# INotifyLoadCargo / INotifyUnloadCargo 等接口 → TypeScript 接口
 * - C# TraitOrDefault<T>() → 鸭子类型查找 (actor.traits Map)
 * - C# SubCell enum / WDist / WAngle → 已迁移的 TypeScript 类型
 *
 * 这些接口被 RideTransport、UnloadCargo、PickupUnit、DeliverUnit 等活动使用。
 * Cargo/Passenger/Carryall/Carryable traits 尚未迁移，此处提供最小鸭子类型接口。
 */

import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'
import type { WPos } from '../../OpenRA.Game/WPos.js'
import type { WVec } from '../../OpenRA.Game/WVec.js'
import type { WDist } from '../../OpenRA.Game/WDist.js'
import type { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { BlockedByActor } from '../Traits/BlockedByActor.js'

// ---------------------------------------------------------------------------
// Cargo trait — 运输载具 (对应 OpenRA Cargo)
// ---------------------------------------------------------------------------

/** Cargo trait 最小接口。
 *
 *  OpenRA 对照: OpenRA.Mods.Common/Traits/Cargo.cs
 *
 *  被 UnloadCargo、RideTransport 使用。
 */
export interface CargoLike {
  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** Cargo 配置信息。 */
  readonly info: CargoInfoLike

  /** 当前乘客列表。 */
  readonly passengers: Iterable<GameActor>

  /** 乘客数量。 */
  readonly passengerCount: number

  /** 查看最后一个乘客 (不移除)。 */
  peek(): GameActor

  /** 卸载一个乘客。
   *
   *  @param self — 运输 actor
   *  @param passenger — 要卸载的乘客 (null = 卸载最后一个)
   *  @returns 被卸载的乘客
   */
  unload(self: GameActor, passenger?: GameActor | null): GameActor

  /** 装载一个乘客。
   *
   *  @param self — 运输 actor
   *  @param passenger — 要装载的乘客
   */
  load(self: GameActor, passenger: GameActor): void

  /** 检查是否可以装载乘客。 */
  canLoad(passenger: GameActor): boolean

  /** 检查是否可以卸载。 */
  canUnload(): boolean

  /** 是否为空。 */
  isEmpty(): boolean

  /** 是否有空间容纳指定重量。 */
  hasSpace(weight: number): boolean

  /** 预留空间。 */
  reserveSpace(actor: GameActor): boolean

  /** 取消预留空间。 */
  unreserveSpace(actor: GameActor): void

  /** 获取当前位置的相邻单元格。 */
  currentAdjacentCells(): CPos[]
}

/** CargoInfo 配置最小接口。 */
export interface CargoInfoLike {
  /** 最大承载重量。 */
  readonly maxWeight: number

  /** 允许装载的 CargoType 集合。 */
  readonly types: ReadonlySet<string> | readonly string[]

  /** 卸载前延迟 (tick)。 */
  readonly beforeUnloadDelay: number

  /** 卸载后延迟 (tick)。 */
  readonly afterUnloadDelay: number

  /** 卸载之间延迟 (tick)。 */
  readonly betweenUnloadDelay: number

  /** 装载后延迟 (tick)。 */
  readonly afterLoadDelay: number

  /** 装载范围 (WDist)。 */
  readonly loadRange: WDist

  /** 卸载语音。 */
  readonly unloadVoice?: string

  /** 乘客卸载朝向 (相对运输)。 */
  readonly passengerFacing: WAngle

  /** 卸载光标。 */
  readonly unloadCursor?: string

  /** 卸载阻塞光标。 */
  readonly unloadBlockedCursor?: string
}

// ---------------------------------------------------------------------------
// Passenger trait — 乘客 (对应 OpenRA Passenger)
// ---------------------------------------------------------------------------

/** Passenger trait 最小接口。
 *
 *  OpenRA 对照: OpenRA.Mods.Common/Traits/Passenger.cs
 *
 *  被 RideTransport 使用。
 */
export interface PassengerLike {
  /** Passenger 配置信息。 */
  readonly info: PassengerInfoLike

  /** 当前预留的 Cargo (如果有)。 */
  readonly reservedCargo: CargoLike | null

  /** 当前所在的运输 actor。 */
  transport: GameActor | null

  /** 预留 cargo 空间。
   *
   *  @param self — 乘客 actor
   *  @param cargo — 要预留的 Cargo trait
   *  @returns 预留是否成功
   */
  reserve(self: GameActor, cargo: CargoLike): boolean

  /** 取消预留。 */
  unreserve(self: GameActor): void

  /** 在添加到世界前调用。 */
  onBeforeAddedToWorld(actor: GameActor): void

  /** 从被摧毁的 cargo 中弹出时调用。 */
  onEjectedFromKilledCargo(self: GameActor): void
}

/** PassengerInfo 配置最小接口。 */
export interface PassengerInfoLike {
  /** Cargo 类型字符串。 */
  readonly cargoType: string

  /** 重量。 */
  readonly weight: number

  /** 目标线颜色。 */
  readonly targetLineColor: ColorStub
}

// ---------------------------------------------------------------------------
// Carryall trait — 运输机 (对应 OpenRA Carryall)
// ---------------------------------------------------------------------------

/** Carryall 状态枚举。
 *
 *  OpenRA 对照: Carryall.CarryallState { Idle, Reserved, Carrying }
 */
export const CarryallState = {
  Idle: 0,
  Reserved: 1,
  Carrying: 2,
} as const
export type CarryallState = (typeof CarryallState)[keyof typeof CarryallState]

/** Carryall trait 最小接口。
 *
 *  OpenRA 对照: OpenRA.Mods.Common/Traits/Carryall.cs
 *
 *  被 PickupUnit、DeliverUnit 使用。
 */
export interface CarryallLike {
  /** 当前状态。 */
  readonly state: CarryallState

  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** Carryall 配置信息。 */
  readonly info: CarryallInfoLike

  /** 当前携带的 actor (如果有)。 */
  readonly carryable: GameActor | null

  /** 预留可携带对象。
   *
   *  @param self — carryall actor
   *  @param carryable — 要预留的可携带对象
   *  @returns 预留是否成功
   */
  reserveCarryable(self: GameActor, carryable: GameActor): boolean

  /** 取消预留。 */
  unreserveCarryable(self: GameActor): void

  /** 附加可携带对象。 */
  attachCarryable(self: GameActor, cargo: GameActor): void

  /** 分离可携带对象。 */
  detachCarryable(self: GameActor): void

  /** 计算可携带对象偏移量。 */
  offsetForCarryable(self: GameActor, cargo: GameActor): WVec

  /** 可携带对象偏移量 (已附加时)。 */
  readonly carryableOffset: WVec
}

/** CarryallInfo 配置最小接口。 */
export interface CarryallInfoLike {
  /** 卸载前延迟 (tick)。 */
  readonly beforeUnloadDelay: number
}

// ---------------------------------------------------------------------------
// Carryable trait — 可携带对象 (对应 OpenRA Carryable)
// ---------------------------------------------------------------------------

/** LockResponse 枚举。
 *
 *  OpenRA 对照: LockResponse { Success, Failed, Pending }
 */
export const LockResponse = {
  Success: 0,
  Failed: 1,
  Pending: 2,
} as const
export type LockResponse = (typeof LockResponse)[keyof typeof LockResponse]

/** Carryable trait 最小接口。
 *
 *  OpenRA 对照: OpenRA.Mods.Common/Traits/Carryable.cs
 *
 *  被 PickupUnit、DeliverUnit 使用。
 */
export interface CarryableLike {
  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** 尝试锁定以进行拾取。
   *
   *  @param self — 可携带对象 actor
   *  @param carrier — 运输机 actor
   *  @returns 锁定响应
   */
  lockForPickup(self: GameActor, carrier: GameActor): LockResponse

  /** 已附加到运输机。 */
  attached(self: GameActor, carrier: GameActor): void

  /** 已从运输机分离。 */
  detached(self: GameActor): void

  /** 取消预留。 */
  unreserve(self: GameActor): void
}

// ---------------------------------------------------------------------------
// INotifyLoadCargo — 装载通知 (对应 OpenRA INotifyLoadCargo)
// ---------------------------------------------------------------------------

/** 当乘客被装载到 cargo 时调用。
 *
 *  OpenRA 对照: INotifyLoadCargo
 */
export interface INotifyLoadCargo {
  loading(self: GameActor): void
}

// ---------------------------------------------------------------------------
// INotifyUnloadCargo — 卸载通知 (对应 OpenRA INotifyUnloadCargo)
// ---------------------------------------------------------------------------

/** 当乘客从 cargo 卸载时调用。
 *
 *  OpenRA 对照: INotifyUnloadCargo
 */
export interface INotifyUnloadCargo {
  unloading(self: GameActor): void
}

// ---------------------------------------------------------------------------
// IPositionable — 可定位 (对应 OpenRA IPositionable) — 精简版
// ---------------------------------------------------------------------------

/** IPositionable 最小接口 — 用于 UnloadCargo 中的乘客重新定位。
 *
 *  OpenRA 对照: IPositionable
 */
export interface IPositionableLike {
  /** 设置位置。 */
  setPosition(actor: GameActor, cell: CPos): void

  /** 设置中心位置。 */
  setCenterPosition(actor: GameActor, pos: WPos): void

  /** 检查是否可以进入单元格。 */
  canEnterCell(cell: CPos, ignoreActor: GameActor | null, blockedByActor: BlockedByActor): boolean

  /** 获取可用的 SubCell。 */
  getAvailableSubCell(cell: CPos): SubCellLike
}

/** SubCell 枚举 (对应 OpenRA SubCell)。
 *
 *  OpenRA 对照: SubCell { Invalid = -1, Any = 0, FullCell = 1, ... }
 */
export const SubCellLike = {
  Invalid: -1,
  Any: 0,
  FullCell: 1,
} as const
export type SubCellLike = number

// ---------------------------------------------------------------------------
// IFacing — 朝向 (对应 OpenRA IFacing) — 精简版
// ---------------------------------------------------------------------------

/** IFacing 最小接口 — 用于朝向查询。 */
export interface IFacingLike {
  facing: WAngle
}

// ---------------------------------------------------------------------------
// BodyOrientation — 身体朝向 (对应 OpenRA BodyOrientation) — 精简版
// ---------------------------------------------------------------------------

/** BodyOrientation 最小接口 — 用于量化朝向。 */
export interface BodyOrientationLike {
  /** 量化朝向。 */
  quantizeOrientation(orientation: unknown): WAngle

  /** 量化朝向 (按面数)。 */
  quantizeFacing(facing: WAngle, facings: number): WAngle

  /** 局部坐标转世界坐标。 */
  localToWorld(offset: WVec): WVec
}

// ---------------------------------------------------------------------------
// Aircraft trait — 飞机 (对应 OpenRA Aircraft) — 精简版
// ---------------------------------------------------------------------------

/** Aircraft trait 最小接口 — 用于检查着陆高度。 */
export interface AircraftLike {
  /** 是否在地面高度。 */
  readonly atLandAltitude: boolean

  /** 是否可以着陆。 */
  canLand(cell: CPos, blockedByMobile?: boolean): boolean

  /** 是否在地面产生碰撞影响。 */
  hasInfluence(): boolean
}

// ---------------------------------------------------------------------------
// Mobile trait — 地面移动 (对应 OpenRA Mobile) — 精简版
// ---------------------------------------------------------------------------

/** Mobile trait 最小接口 — 用于地面卸载移动。 */
export interface MobileLike {
  /** 是否可以停留在单元格。 */
  canStayInCell(cell: CPos): boolean
}
