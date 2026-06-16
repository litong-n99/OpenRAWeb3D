/**
 * LayMines.ts — 布雷活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/LayMines.cs
 *
 * 核心范式转换:
 * - C# minefield ??= [self.Location] → TypeScript minefield = minefield ?? [self.Location]
 * - C# self.World.Actors.Where(...).ClosestToWithPathFrom(self) → TypeScript actor search with distance sort
 * - C# self.World.AddFrameEndTask() → TypeScript world.queueFrameEndAction()
 * - C# self.World.CreateActor() → TypeScript world.createActor() via frame-end action
 * - C# ActorMap.GetActorsAt() → TypeScript actorMap.getActorsAt()
 * - C# LocationInit, OwnerInit, ParentActorInit → TypeScript init stubs (from EconomicActivityInterfaces)
 * - C# IPositionable cast from IMove → TypeScript duck-type lookup
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { Wait } from './Wait.js'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.js'
import type { Mobile } from '../Traits/Mobile.js'
import { BlockedByActor } from '../Traits/BlockedByActor.js'
import type { IMove } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IPositionable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IActorMap } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type Minelayer,
  type INotifyMineLaying,
  type Rearmable,
  LocationInit,
  OwnerInit,
  ParentActorInit,
} from './EconomicActivityInterfaces.js'
import { Resupply } from './Resupply.js'
import { MoveAdjacentTo } from './Move/MoveAdjacentTo.js'

// ---------------------------------------------------------------------------
// LayMines
// ---------------------------------------------------------------------------

/**
 * 布雷活动 — 在指定雷区放置地雷。
 *
 * OpenRA 对照: LayMines activity
 *
 * 工作流程:
 * 1. onFirstRun: 如果没有指定雷区，默认使用 actor 当前位置
 * 2. tick: 移动到雷区单元格，检查弹药，布雷 (可能有 preLayDelay)
 * 3. 弹药耗尽时: 寻找最近的补给建筑，排队 Resupply
 * 4. 布雷完成后: 排队 Wait (afterLayingDelay)，然后继续下一个单元格
 * 5. 所有单元格布雷完成后: 返回 true (活动结束)
 *
 * 被 Minelayer trait 使用。
 */
export class LayMines extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** 雷区单元格列表。 */
  minefield: CPos[] | null

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** 是否正在返回基地补给。 */
  returnToBase: boolean = false

  /** 补给目标 actor。 */
  rearmTarget: GameActor | null = null

  /** 是否正在布雷中 (preLayDelay 等待后)。 */
  layingMine: boolean = false

  // ---------------------------------------------------------------------------
  // Resolved traits
  // ---------------------------------------------------------------------------

  private readonly minelayer: Minelayer
  private readonly ammoPools: readonly AmmoPoolLike[]
  private readonly movement: IMove
  private readonly rearmableInfo: RearmableInfoLike | null
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 LayMines 活动。
   *
   * OpenRA 对照: LayMines(Actor, List<CPos>)
   *
   * @param self — 执行此活动的 actor
   * @param minefield — 雷区单元格列表 (null = 默认使用 actor 位置)
   */
  constructor(self: GameActor, minefield: CPos[] | null = null) {
    super()
    this.minefield = minefield

    this.minelayer = LayMines._resolveMinelayer(self)
    this.ammoPools = LayMines._resolveAmmoPools(self)
    this.movement = LayMines._resolveMovement(self)
    this.rearmableInfo = LayMines._resolveRearmableInfo(self)

    const mobile = (self as unknown as { traits?: Map<string, unknown> }).traits?.get('Mobile') ?? null
    const world = (self as unknown as { world?: { sharedRandom?: { next(): number } } | null }).world ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(world, mobile as Mobile | null)
    this.moveCooldownHelper.retryIfDestinationBlocked = true
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  /**
   * 首次运行时设置默认雷区。
   *
   * OpenRA 对照: LayMines.OnFirstRun(Actor)
   *
   * @param self — 执行此活动的 actor
   */
  protected override onFirstRun(self: GameActor): void {
    if (this.minefield === null) {
      const location = (self as unknown as { location: CPos }).location
      this.minefield = [location]
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 布雷主逻辑。
   *
   * OpenRA 对照: LayMines.Tick(Actor)
   *
   * @param self — 执行此活动的 actor
   * @returns true 当活动完成，false 继续执行
   */
  override tick(self: GameActor): boolean {
    this.returnToBase = false

    // 取消中
    if (this.isCanceling) {
      if (this.layingMine) {
        const notifyTraits = LayMines._resolveNotifyMineLaying(self)
        for (const t of notifyTraits) {
          t.mineLayingCanceled(self, (self as unknown as { location: CPos }).location)
        }
      }
      return true
    }

    // 完成 pending 的布雷 (preLayDelay 结束后)
    if (this.layingMine) {
      this.layingMine = false
      if (this.layMine(self)) {
        if (this.minelayer.info.afterLayingDelay > 0) {
          this.queueChild(new Wait(this.minelayer.info.afterLayingDelay))
        }
        // 此 tick 必须结束，否则下一单元格会被选中并排队 Move 活动
        return false
      }
    }

    // 移动冷却辅助器 tick
    const result = this.moveCooldownHelper.tick(false)
    if (result !== null) {
      return result
    }

    // 检查当前位置是否可以布雷
    const selfLocation = (self as unknown as { location: CPos }).location
    const canLayHere = this.minefield !== null &&
      this.minefield.some(c => CPos.equals(c, selfLocation)) &&
      LayMines.canLayMine(self, selfLocation)

    if (canLayHere) {
      // 检查弹药 — 如果为空且可重新装弹，返回基地
      if (this.rearmableInfo !== null && this._isAmmoEmpty()) {
        const target = this._findRearmTarget(self)
        if (target === null) {
          return true
        }

        this.rearmTarget = target
        this.moveCooldownHelper.notifyMoveQueued()

        // 排队移动到补给建筑附近 → 进入补给建筑 → 补给
        const targetCell = this._getTargetCell(self, target)
        this.queueChild(new MoveAdjacentTo(self, Target.fromActor(target as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef)))
        this.queueChild(this.movement.moveTo(self, Target.fromCell(targetCell)))
        this.queueChild(new Resupply(self, target, new WDist(512)))
        this.returnToBase = true
        return false
      }

      // 开始布雷
      if (!this.startLayingMine(self)) {
        return false
      }

      if (this.minelayer.info.preLayDelay === 0) {
        // 立即布雷
        if (this.layMine(self) && this.minelayer.info.afterLayingDelay > 0) {
          this.queueChild(new Wait(this.minelayer.info.afterLayingDelay))
        }
      } else {
        // 延迟布雷
        this.layingMine = true
        this.queueChild(new Wait(this.minelayer.info.preLayDelay))
      }

      return false
    }

    // 移动到下一个有效单元格
    const nextCell = this.nextValidCell(self)
    if (nextCell !== null) {
      this.moveCooldownHelper.notifyMoveQueued()
      this.queueChild(this.movement.moveTo(self, Target.fromCell(nextCell)))
      return false
    }

    // 没有更多单元格可以布雷
    return true
  }

  // ---------------------------------------------------------------------------
  // CleanMineField
  // ---------------------------------------------------------------------------

  /**
   * 清理雷区 — 移除已有地雷或不可布雷的单元格。
   *
   * OpenRA 对照: LayMines.CleanMineField(Actor)
   *
   * @param self — 执行此活动的 actor
   */
  cleanMineField(self: GameActor): void {
    if (this.minefield === null) return

    const positionable = this._resolvePositionable(self)
    const mobile = (positionable as unknown as Mobile | null)
    const actorMap = this._resolveActorMap(self)
    const mineType = this.minelayer.info.mine

    const owner = self.owner
    const shroud = owner !== undefined
      ? (owner as unknown as { shroud?: { isVisible: (c: CPos) => boolean } }).shroud
      : null

    this.minefield = this.minefield.filter(c => {
      // 检查是否已有地雷
      if (actorMap !== null) {
        const actors = actorMap.getActorsAt(c)
        const hasMine = actors.some(a => {
          const info = (a as unknown as { info?: { name?: string } }).info
          return info?.name !== undefined &&
            info.name.toLowerCase() === mineType.toLowerCase()
        })
        if (hasMine) return false
      }

      // 检查是否可以进入/停留
      if (positionable !== null) {
        const canEnter = (positionable as unknown as { canEnterCell?: (c: CPos, a: null, b: BlockedByActor) => boolean }).canEnterCell
        if (typeof canEnter === 'function' && !canEnter(c, null, BlockedByActor.Immovable)) {
          if (shroud !== null && shroud !== undefined && shroud.isVisible(c)) return false
        }

        if (mobile !== null && typeof mobile.canStayInCell === 'function') {
          if (!mobile.canStayInCell(c)) {
            if (shroud !== null && shroud !== undefined && shroud.isVisible(c)) return false
          }
        }
      }

      return true
    })
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * 获取目标线节点。
   *
   * OpenRA 对照: LayMines.TargetLineNodes(Actor)
   */
  override targetLineNodes(self: GameActor): TargetLineNode[] {
    const result: TargetLineNode[] = []

    // 返回基地时的目标线
    if (this.returnToBase && this.rearmTarget !== null) {
      const moveInfo = this._resolveMoveInfo(self)
      result.push(new TargetLineNode(
        Target.fromActor(this.rearmTarget as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef),
        moveInfo.getTargetLineColor(),
      ))
    }

    if (this.minefield === null || this.minefield.length === 0) {
      return result
    }

    // 下一个布雷单元格
    const nextCell = this.nextValidCell(self)
    if (nextCell !== null) {
      result.push(new TargetLineNode(
        Target.fromCell(nextCell),
        this.minelayer.info.targetLineColor,
      ))
    }

    // 所有雷区单元格 (如果多于一个)
    if (this.minefield.length > 1) {
      for (const c of this.minefield) {
        result.push(new TargetLineNode(
          Target.fromCell(c),
          this.minelayer.info.targetLineColor,
          null, // tile — minelayer.tile is typed as unknown|null in interface
        ))
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * 检查是否可以在指定位置布雷。
   *
   * OpenRA 对照: LayMines.CanLayMine(Actor, CPos)
   *
   * @param self — 执行布雷的 actor
   * @param location — 要检查的位置
   * @returns true 如果可以在该位置布雷
   */
  static canLayMine(self: GameActor, location: CPos): boolean {
    if (self.isDead || !self.isInWorld) {
      return false
    }

    const world = (self as unknown as { world?: WorldLike }).world
    const actorMap = world?.actorMap
    if (actorMap === undefined) {
      return true
    }

    const actors = actorMap.getActorsAt(location)
    // 如果除了自己之外没有其他 actor，可以布雷
    return actors.every(a => a === self)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** 获取下一个有效布雷单元格。 */
  private nextValidCell(self: GameActor): CPos | null {
    if (this.minefield === null) return null

    for (const c of this.minefield) {
      if (LayMines.canLayMine(self, c)) {
        return c
      }
    }

    return null
  }

  /** 开始布雷 — 检查弹药并通知。 */
  private startLayingMine(self: GameActor): boolean {
    if (this.ammoPools.length > 0) {
      const pool = this._findAmmoPool()
      if (pool === null) return false

      if (pool.currentAmmoCount < this.minelayer.info.ammoUsage) {
        return false
      }
    }

    // 通知
    const notifyTraits = LayMines._resolveNotifyMineLaying(self)
    for (const t of notifyTraits) {
      t.mineLaying(self, (self as unknown as { location: CPos }).location)
    }

    return true
  }

  /** 实际布雷 — 扣除弹药，创建地雷 actor。 */
  private layMine(self: GameActor): boolean {
    if (this.ammoPools.length > 0) {
      const pool = this._findAmmoPool()
      if (pool === null) return false

      if (!pool.takeAmmo(self, this.minelayer.info.ammoUsage)) {
        return false
      }
    }

    // 从雷区移除当前位置
    const selfLocation = (self as unknown as { location: CPos }).location
    if (this.minefield !== null) {
      this.minefield = this.minefield.filter(c => !CPos.equals(c, selfLocation))
    }

    // 延迟创建地雷 actor
    const world = (self as unknown as { world?: WorldLike }).world
    if (world !== undefined) {
      const mineType = this.minelayer.info.mine
      const owner = self.owner
      const location = selfLocation

      world.queueFrameEndAction(() => {
        if (!LayMines.canLayMine(self, location)) return

        const mine = world.createActor(mineType, [
          new LocationInit(location),
          new OwnerInit(owner as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').PlayerStub),
          new ParentActorInit(self),
        ])

        // 通知
        const notifyTraits = LayMines._resolveNotifyMineLaying(self)
        for (const t of notifyTraits) {
          t.mineLaid(self, mine as unknown as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').IGameActor)
        }
      })
    }

    return true
  }

  /** 检查弹药是否为空。 */
  private _isAmmoEmpty(): boolean {
    if (this.ammoPools.length === 0) return false

    const pool = this._findAmmoPool()
    if (pool === null) return true

    return pool.currentAmmoCount < this.minelayer.info.ammoUsage
  }

  /** 查找指定名称的弹药池。 */
  private _findAmmoPool(): AmmoPoolLike | null {
    for (const pool of this.ammoPools) {
      if (pool.name === this.minelayer.info.ammoPoolName) {
        return pool
      }
    }
    return null
  }

  /** 寻找最近的补给建筑。 */
  private _findRearmTarget(self: GameActor): GameActor | null {
    const world = (self as unknown as { world?: WorldLike }).world
    if (world === undefined) return null

    const owner = self.owner
    const rearmActors = this.rearmableInfo?.rearmActors ?? []
    if (rearmActors.length === 0) return null

    const selfPos = (self as unknown as { centerPosition: { X: number; Y: number; Z: number } }).centerPosition

    // 收集所有候选 actor
    const candidates: GameActor[] = []
    for (const actor of world.actors) {
      const actorOwner = (actor as unknown as { owner?: unknown }).owner
      if (actorOwner !== owner) continue

      const actorInfo = (actor as unknown as { info?: { name?: string } }).info
      if (actorInfo?.name === undefined) continue
      if (!rearmActors.includes(actorInfo.name)) continue

      candidates.push(actor as GameActor)
    }

    if (candidates.length === 0) return null

    // 按距离排序，返回最近的
    candidates.sort((a, b) => {
      const aPos = (a as unknown as { centerPosition: { X: number; Y: number; Z: number } }).centerPosition
      const bPos = (b as unknown as { centerPosition: { X: number; Y: number; Z: number } }).centerPosition
      const aDist = (aPos.X - selfPos.X) ** 2 + (aPos.Y - selfPos.Y) ** 2
      const bDist = (bPos.X - selfPos.X) ** 2 + (bPos.Y - selfPos.Y) ** 2
      return aDist - bDist
    })

    return candidates[0]!
  }

  /** 获取目标 actor 的单元格位置。 */
  private _getTargetCell(self: GameActor, target: GameActor): CPos {
    const world = (self as unknown as { world?: { map?: { cellContaining: (p: unknown) => CPos } } }).world
    const targetPos = (target as unknown as { centerPosition: unknown }).centerPosition
    return world?.map?.cellContaining(targetPos) ?? new CPos(0, 0)
  }

  /** 解析 IPositionable。 */
  private _resolvePositionable(self: GameActor): IPositionable | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const mobile = traits?.get('Mobile')
    if (mobile) return mobile as IPositionable
    return null
  }

  /** 解析 ActorMap。 */
  private _resolveActorMap(self: GameActor): IActorMap | null {
    const world = (self as unknown as { world?: { actorMap?: IActorMap } }).world
    return world?.actorMap ?? null
  }

  /** 解析移动配置信息。 */
  private _resolveMoveInfo(self: GameActor): IMoveInfoLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const mobile = traits?.get('Mobile') as { info?: IMoveInfoLike } | undefined
    if (mobile?.info && typeof mobile.info.getTargetLineColor === 'function') {
      return mobile.info
    }
    return {
      getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }),
    }
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 解析 Minelayer。 */
  private static _resolveMinelayer(self: GameActor): Minelayer {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<Minelayer>
      if (t.info !== undefined && (t.info as Minelayer['info']).mine !== undefined) {
        return t as Minelayer
      }
    }
    // 回退存根
    return {
      info: {
        mine: 'mine',
        ammoPoolName: 'mines',
        ammoUsage: 1,
        preLayDelay: 0,
        afterLayingDelay: 0,
        targetLineColor: { r: 1, g: 0, b: 0, a: 1 },
        tile: null,
      },
    }
  }

  /** 解析 AmmoPool 数组。 */
  private static _resolveAmmoPools(self: GameActor): readonly AmmoPoolLike[] {
    const result: AmmoPoolLike[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<AmmoPoolLike>
      if (t.name !== undefined && t.currentAmmoCount !== undefined && typeof t.takeAmmo === 'function') {
        result.push(t as AmmoPoolLike)
      }
    }
    return result
  }

  /** 解析 IMove。 */
  private static _resolveMovement(self: GameActor): IMove {
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
    throw new Error('LayMines requires an IMove trait on the actor')
  }

  /** 解析 RearmableInfo。 */
  private static _resolveRearmableInfo(self: GameActor): RearmableInfoLike | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<Rearmable>
      if (t.info !== undefined && (t.info as Rearmable['info']).rearmActors !== undefined) {
        return (t as Rearmable).info
      }
    }
    // 检查 actor info
    const info = (self as unknown as { info?: { rearmable?: RearmableInfoLike } }).info
    if (info?.rearmable) {
      return info.rearmable
    }
    return null
  }

  /** 解析 INotifyMineLaying traits。 */
  private static _resolveNotifyMineLaying(self: GameActor): INotifyMineLaying[] {
    const result: INotifyMineLaying[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyMineLaying>
      if (typeof t.mineLaying === 'function' && typeof t.mineLayingCanceled === 'function') {
        result.push(t as INotifyMineLaying)
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// AmmoPoolLike — 弹药池最小接口
// ---------------------------------------------------------------------------

/** 弹药池最小接口。
 *
 *  OpenRA 对照: AmmoPool
 */
interface AmmoPoolLike {
  /** 弹药池名称。 */
  readonly name: string

  /** 当前弹药数量。 */
  readonly currentAmmoCount: number

  /** 扣除弹药。
   *
   *  @param self — 所属 actor
   *  @param amount — 扣除数量
   *  @returns true 如果扣除成功
   */
  takeAmmo(self: GameActor, amount: number): boolean
}

// ---------------------------------------------------------------------------
// RearmableInfoLike — 可重新装弹配置最小接口
// ---------------------------------------------------------------------------

/** 可重新装弹配置最小接口。
 *
 *  OpenRA 对照: RearmableInfo
 */
interface RearmableInfoLike {
  /** 可重新装弹的建筑类型列表。 */
  readonly rearmActors: readonly string[]
}

// ---------------------------------------------------------------------------
// IMoveInfoLike — 移动配置最小接口
// ---------------------------------------------------------------------------

/** 移动配置最小接口。 */
interface IMoveInfoLike {
  /** 获取目标线颜色。 */
  getTargetLineColor(): ColorStub
}

// ---------------------------------------------------------------------------
// WorldLike — 世界最小接口
// ---------------------------------------------------------------------------

/** 世界最小接口。 */
interface WorldLike {
  /** 所有 actor。 */
  readonly actors: Iterable<unknown>

  /** Actor 空间索引。 */
  readonly actorMap?: IActorMap

  /** 在帧末执行操作。 */
  queueFrameEndAction(action: () => void): void

  /** 创建 actor。 */
  createActor(name: string, inits: unknown[]): unknown
}

// ---------------------------------------------------------------------------
// ColorStub — 颜色最小接口
// ---------------------------------------------------------------------------

/** 颜色最小接口。 */
interface ColorStub {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}
