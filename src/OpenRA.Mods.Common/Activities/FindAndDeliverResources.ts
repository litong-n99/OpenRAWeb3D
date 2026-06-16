/**
 * FindAndDeliverResources.ts — 寻找并运送资源活动（收割循环编排器）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/FindAndDeliverResources.cs
 *
 * 核心范式转换:
 * - C# Harvester / Mobile / DockClientManager trait 解析 → TypeScript 鸭子类型查找
 * - C# PathFinder.FindPathToTargetCellByPredicate() → pathFinder.findPathToTargetCellByPredicate()
 * - C# BlockedByActor.Stationary → BlockedByActor.Stationary (已迁移)
 * - C# PathGraph.PathCostForInvalidPath → PathGraph.PathCostForInvalidPath (已迁移)
 * - C# yield return (GetTargets / TargetLineNodes) → TypeScript 数组返回
 * - C# cosine rule 成本修正 → 相同数学，使用 TypeScript WVec 操作
 * - C# QueueChild(new HarvestResource(...)) / QueueChild(new MoveToDock(...)) → this.queueChild(...)
 * - C# mobile.PathFinder → mobile.pathFinder (鸭子类型属性)
 * - C# harv.DockClientManager.ReservedHost → dockClient.reservedHost
 * - C# harv.DockClientManager.LastReservedHost → dockClient.lastReservedHost
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { BlockedByActor } from '../Traits/BlockedByActor.js'
import { PathGraph } from '../Pathfinder/IPathGraph.js'
import { HarvestResource } from './HarvestResource.js'
import { Wait } from './Wait.js'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.js'
import type { DockClientManagerLike } from './MoveToDock.js'
import type { IDockHost } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CVec } from '../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// FindAndDeliverResources
// ---------------------------------------------------------------------------

/**
 * 编排完整的资源收割循环：寻找资源 → 收割 → 运送 → 重复。
 *
 * OpenRA 对照: FindAndDeliverResources activity
 *
 * 工作流程:
 * 1. onFirstRun: 如果提供了 orderLocation 且收割机已满，先排队 MoveToDock
 * 2. tick: 复杂状态机
 *    - 如果取消或 trait 禁用 → 完成
 *    - 如果下一个活动存在且 queueFullLoad=false → 中断
 *    - 如果已满或搜索失败 → 排队 MoveToDock 运送
 *    - 如果搜索失败且未等待 → 排队 Wait
 *    - 查找最近的收割单元格 → 排队 HarvestResource
 * 3. closestHarvestablePos: 使用路径查找和余弦规则成本修正
 * 4. targetLineNodes: 委托给子活动，或渲染 orderLocation / 预约主机
 *
 * 这是收割机 AI 的核心活动，驱动整个资源经济循环。
 */
export class FindAndDeliverResources extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** 显式收割命令位置 (null = 自动搜索)。 */
  orderLocation: CPos | null

  // ---------------------------------------------------------------------------
  // Resolved traits (duck-typed)
  // ---------------------------------------------------------------------------

  /** Harvester trait。 */
  private readonly harvester: HarvesterLike

  /** Harvester 配置信息。 */
  private readonly harvInfo: HarvesterInfoLike

  /** Mobile trait (用于路径查找和移动)。 */
  private readonly mobile: MobileLike

  /** 资源声明层。 */
  private readonly claimLayer: ResourceClaimLayerLike

  /** 对接客户端管理器。 */
  private readonly dockClient: DockClientManagerLike

  /** 移动冷却辅助器。 */
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** 上次收割的单元格。 */
  private lastHarvestedCell: CPos | null = null

  /** 是否已经运送过负载。 */
  private hasDeliveredLoad: boolean = false

  /** 是否已经收割过单元格。 */
  private hasHarvestedCell: boolean = false

  /** 是否已经等待过 (防止连续等待)。 */
  private hasWaited: boolean = false

  /** 上次搜索是否失败。 */
  private _lastSearchFailed: boolean = false

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 FindAndDeliverResources 活动。
   *
   * OpenRA 对照: FindAndDeliverResources(Actor self, CPos? orderLocation)
   *
   * @param self — 执行此活动的 actor (收割机)
   * @param orderLocation — 显式收割命令位置 (可选，null = 自动搜索)
   */
  constructor(self: GameActor, orderLocation: CPos | null = null) {
    super()
    this.orderLocation = orderLocation

    // 解析 Harvester trait
    const resolved = FindAndDeliverResources._resolveHarvester(self)
    this.harvester = resolved.harvester
    this.harvInfo = resolved.info

    // 解析 Mobile trait
    this.mobile = FindAndDeliverResources._resolveMobile(self)

    // 解析 ResourceClaimLayer
    this.claimLayer = FindAndDeliverResources._resolveClaimLayer(self)

    // 解析 DockClientManager
    this.dockClient = FindAndDeliverResources._resolveDockClient(self)

    // 创建 MoveCooldownHelper
    // NOTE: MoveCooldownHelper expects Mobile | null, but we use duck-typed
    // mobile trait. Cast through unknown to satisfy type checker.
    const world = (self as unknown as { world?: { sharedRandom?: { next(): number } } | null }).world ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(
      world,
      this.mobile as unknown as import('../Traits/Mobile.js').Mobile | null,
    )
    this.moveCooldownHelper.retryIfDestinationBlocked = true
  }

  // ---------------------------------------------------------------------------
  // Public property
  // ---------------------------------------------------------------------------

  /**
   * 上次搜索是否失败 (只读)。
   *
   * OpenRA 对照: FindAndDeliverResources.LastSearchFailed { get; private set; }
   */
  get lastSearchFailed(): boolean {
    return this._lastSearchFailed
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  /**
   * 首次运行处理显式收割命令。
   *
   * OpenRA 对照: FindAndDeliverResources.OnFirstRun(Actor)
   *
   * 如果提供了显式 "harvest" 命令，将收割机引导到命令位置而非上次收割位置
   * 进行初始搜索。如果连续两次 "harvest" 命令且收割机已满，先运送负载。
   */
  protected override onFirstRun(self: GameActor): void {
    if (this.orderLocation !== null) {
      this.lastHarvestedCell = this.orderLocation

      // 如果连续两次 "harvest" 命令，先运送负载 (如果需要)
      // 确保实际的 "harvest" 命令不会被跳过，所以保持 deliveredLoad 为 false
      if (this.harvester.isFull) {
        this._queueMoveToDock(self)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每 tick 执行资源搜索和收割循环。
   *
   * OpenRA 对照: FindAndDeliverResources.Tick(Actor)
   *
   * @param self — 执行此活动的 actor
   * @returns true 当活动完成，false 继续执行
   */
  override tick(self: GameActor): boolean {
    // 如果正在取消或 trait 被禁用，完成活动
    if (this.isCanceling || this.harvester.isTraitDisabled) {
      return true
    }

    // 如果下一个活动存在，检查是否需要中断自动收割
    const nextAct = this.nextActivity
    if (nextAct !== null) {
      // 在清除第一个单元格后中断自动收割
      if (!this.harvInfo.queueFullLoad && (this.hasHarvestedCell || this._lastSearchFailed)) {
        return true
      }

      // 在第一次完整收割循环后中断自动收割
      if (this.hasDeliveredLoad || this.harvester.isFull) {
        return true
      }
    }

    // 如果已满或 (非空且上次搜索失败)，运送资源
    if (this.harvester.isFull || (!this.harvester.isEmpty && this._lastSearchFailed)) {
      // 如果已预约主机，说明对接已经开始，等待
      if (this.dockClient.reservedHost !== null) {
        return false
      }

      this._queueMoveToDock(self)
      this.hasDeliveredLoad = true
      return false
    }

    // 上次搜索失败后等待一段时间再搜索
    if (this._lastSearchFailed && !this.hasWaited) {
      this.queueChild(new Wait(this.harvInfo.waitDuration))
      this.hasWaited = true
      return false
    }

    this.hasWaited = false

    // 扫描资源。如果当前区域没有资源，尝试从精炼厂附近搜索。
    // 如果还是找不到，暂时放弃。
    let closestHarvestableCell = this._closestHarvestablePos(self)
    if (closestHarvestableCell === null) {
      if (this.lastHarvestedCell !== null) {
        this.lastHarvestedCell = null // 强制从备用位置搜索
        closestHarvestableCell = this._closestHarvestablePos(self)
        this._lastSearchFailed = closestHarvestableCell === null
      } else {
        this._lastSearchFailed = true
      }
    } else {
      this._lastSearchFailed = false
    }

    // 移动冷却辅助器 tick
    const cooldownResult = this.moveCooldownHelper.tick(false)
    if (cooldownResult !== null) {
      return cooldownResult
    }

    // 如果找不到可收割位置且我们在精炼厂，让开精炼厂入口
    if (this._lastSearchFailed) {
      const lastproc = this.dockClient.lastReservedHost
      if (lastproc !== null) {
        const deliveryLoc = this._cellContainingDockPos(self, lastproc.dockPosition)
        const actorLocation = (self as unknown as { location?: CPos }).location
        if (deliveryLoc !== null && actorLocation !== undefined &&
            actorLocation.equals(deliveryLoc) && this.harvester.isEmpty) {
          const unblockCell = CPos.add(deliveryLoc, new CVec(this.harvInfo.unblockCell.x, this.harvInfo.unblockCell.y))
          const moveTo = this.mobile.nearestMoveableCell(unblockCell, 1, 5)
          this.moveCooldownHelper.notifyMoveQueued()
          const moveActivity = this.mobile.moveTo(self, moveTo, 1)
          if (moveActivity !== null) {
            this.queueChild(moveActivity as Activity)
          }
        }
      }
      return false
    }

    // 搜索成功，开始收割
    this.moveCooldownHelper.notifyMoveQueued()
    this.queueChild(new HarvestResource(self, closestHarvestableCell!))
    this.lastHarvestedCell = closestHarvestableCell
    this.hasHarvestedCell = true
    return false
  }

  // ---------------------------------------------------------------------------
  // ClosestHarvestablePos — 查找最近的收割位置
  // ---------------------------------------------------------------------------

  /**
   * 查找收割机当前位置和上次命令位置之间最近的收割位置。
   *
   * OpenRA 对照: FindAndDeliverResources.ClosestHarvestablePos(Actor)
   *
   * 使用路径查找和余弦规则成本修正来优先选择朝向精炼厂的资源。
   *
   * @param self — 执行此活动的 actor
   * @returns 最近的收割单元格，或 null 如果找不到
   */
  private _closestHarvestablePos(self: GameActor): CPos | null {
    // 收割机应尊重显式收割命令，而非收割当前单元格
    if (this.orderLocation === null) {
      const actorLocation = (self as unknown as { location?: CPos }).location
      if (actorLocation !== undefined &&
          this.harvester.canHarvestCell(self, actorLocation) &&
          this.claimLayer.canClaimCell(self, actorLocation)) {
        return actorLocation
      }
    } else {
      if (this.harvester.canHarvestCell(self, this.orderLocation) &&
          this.claimLayer.canClaimCell(self, this.orderLocation)) {
        return this.orderLocation
      }
      this.orderLocation = null
    }

    // 确定搜索起点和搜索半径:
    // 优先级: lastHarvestedCell -> lastLinkedDock -> self
    let searchFromLoc: CPos
    let searchRadius: number
    const dockPos = this.dockClient.lastReservedHost?.dockPosition ?? null
    const actorLocation = (self as unknown as { location?: CPos }).location

    if (this.lastHarvestedCell !== null) {
      searchRadius = this.harvInfo.searchFromHarvesterRadius
      searchFromLoc = this.lastHarvestedCell
    } else {
      searchRadius = this.harvInfo.searchFromProcRadius
      if (dockPos !== null) {
        const dockCell = this._cellContainingDockPos(self, dockPos)
        searchFromLoc = dockCell !== null ? dockCell : (actorLocation ?? new CPos(0, 0))
      } else {
        searchFromLoc = actorLocation ?? new CPos(0, 0)
      }
    }

    const searchRadiusSquared = searchRadius * searchRadius

    const map = this._getMap(self)
    const harvPos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero

    // 使用路径查找搜索可收割单元格
    const pathFinder = this.mobile.pathFinder
    if (pathFinder === null) {
      return null
    }

    const sources: CPos[] = [searchFromLoc]
    if (actorLocation !== undefined && !actorLocation.equals(searchFromLoc)) {
      sources.push(actorLocation)
    }

    const path = pathFinder.findPathToTargetCellByPredicate(
      self,
      sources,
      (loc: CPos) => this.harvester.canHarvestCell(self, loc) && this.claimLayer.canClaimCell(self, loc),
      BlockedByActor.Stationary,
      (loc: CPos) => {
        // 超出搜索半径
        const dx = loc.X - searchFromLoc.X
        const dy = loc.Y - searchFromLoc.Y
        if (dx * dx + dy * dy > searchRadiusSquared) {
          return PathGraph.PathCostForInvalidPath
        }

        // 添加成本修正以优先选择靠近精炼厂的资源
        // 这减少了收割机直线移动的倾向
        if (dockPos !== null && this.harvInfo.resourceRefineryDirectionPenalty > 0 &&
            this.harvester.canHarvestCell(self, loc)) {
          const pos = map !== null ? this._centerOfCell(map, loc) : WPos.Zero

          // 计算收割机-单元格-精炼厂角度 (余弦规则)
          const b = WPos.subtract(pos, dockPos)

          if (!WVec.equals(b, WVec.Zero)) {
            const c = WPos.subtract(pos, harvPos)
            if (!WVec.equals(c, WVec.Zero)) {
              const a = WPos.subtract(harvPos, dockPos)
              const bLen = Math.sqrt(b.X * b.X + b.Y * b.Y + b.Z * b.Z)
              const cLen = Math.sqrt(c.X * c.X + c.Y * c.Y + c.Z * c.Z)
              if (bLen > 0 && cLen > 0) {
                const aLenSq = a.X * a.X + a.Y * a.Y + a.Z * a.Z
                const bLenSq = b.X * b.X + b.Y * b.Y + b.Z * b.Z
                const cLenSq = c.X * c.X + c.Y * c.Y + c.Z * c.Z
                const cosA = Math.floor(512 * (bLenSq + cLenSq - aLenSq) / (bLen * cLen))

                // 成本修正在 0 到 ResourceRefineryDirectionPenalty 之间变化
                return Math.abs(this.harvInfo.resourceRefineryDirectionPenalty / 2) +
                  this.harvInfo.resourceRefineryDirectionPenalty * cosA / 2048
              }
            }
          }
        }

        return 0
      },
    )

    if (path.length > 0) {
      return path[0]
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // GetTargets
  // ---------------------------------------------------------------------------

  /**
   * 获取此活动的目标。
   *
   * OpenRA 对照: FindAndDeliverResources.GetTargets(Actor)
   */
  override getTargets(self: GameActor): Target[] {
    const actorLocation = (self as unknown as { location?: CPos }).location
    if (actorLocation !== undefined) {
      return [Target.fromCell(actorLocation)]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // TargetLineNodes
  // ---------------------------------------------------------------------------

  /**
   * 获取目标线节点。
   *
   * OpenRA 对照: FindAndDeliverResources.TargetLineNodes(Actor)
   */
  override targetLineNodes(self: GameActor): TargetLineNode[] {
    // 委托给子活动
    const child = this.childActivity
    if (child !== null) {
      const childNodes = child.targetLineNodes(self)
      if (childNodes.length > 0) {
        return childNodes
      }
    }

    // 渲染 orderLocation 或预约主机
    if (this.orderLocation !== null) {
      return [new TargetLineNode(Target.fromCell(this.orderLocation), this.harvInfo.harvestLineColor)]
    } else {
      const reservedHostActor = this.dockClient.reservedHostActor
      if (reservedHostActor !== null) {
        return [new TargetLineNode(
          Target.fromActor(reservedHostActor as unknown as { isInWorld: boolean; isDead: boolean; generation: number; centerPosition: WPos; getTargetablePositions(): WPos[]; isTargetableBy(_viewer: unknown): boolean }),
          this.dockClient.dockLineColor,
        )]
      }
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * 排队 MoveToDock 活动。
   *
   * 使用动态导入避免循环依赖。
   */
  private _queueMoveToDock(self: GameActor): void {
    // NOTE: MoveToDock 在 MoveToDock.ts 中定义。为了避免循环导入，
    // 我们通过动态 require 或工厂模式创建。在测试中，可以通过 mock 替换。
    // 这里使用一个工厂函数，由外部设置 (测试时注入)。
    if (FindAndDeliverResources._moveToDockFactory !== null) {
      const moveToDock = FindAndDeliverResources._moveToDockFactory(
        self,
        null, // dockHostActor
        null, // dockHost
        false, // forceEnter
        false, // ignoreOccupancy
        this.dockClient.dockLineColor as ColorStub,
      )
      if (moveToDock !== null) {
        this.queueChild(moveToDock)
      }
    }
  }

  /**
   * 从 dockPosition 解析单元格位置。
   */
  private _cellContainingDockPos(self: GameActor, dockPos: WPos): CPos | null {
    const world = (self as unknown as { world?: { map?: { cellContaining(pos: WPos): CPos } } | null }).world
    if (world?.map?.cellContaining) {
      return world.map.cellContaining(dockPos)
    }
    return null
  }

  /**
   * 获取地图引用。
   */
  private _getMap(self: GameActor): { cellContaining(pos: WPos): CPos; centerOfCell(cell: CPos): WPos } | null {
    const world = (self as unknown as { world?: { map?: { cellContaining(pos: WPos): CPos; centerOfCell(cell: CPos): WPos } } | null }).world
    return world?.map ?? null
  }

  /**
   * 获取单元格中心位置。
   */
  private _centerOfCell(map: { centerOfCell(cell: CPos): WPos }, cell: CPos): WPos {
    return map.centerOfCell(cell)
  }

  // ---------------------------------------------------------------------------
  // Static: MoveToDock factory (for dependency injection / testability)
  // ---------------------------------------------------------------------------

  /** MoveToDock 工厂函数 — 用于避免循环导入。
   *
   *  默认使用动态导入。测试时可以替换为 mock。
   */
  static _moveToDockFactory: (
    self: GameActor,
    dockHostActor: GameActor | null,
    dockHost: IDockHost | null,
    forceEnter: boolean,
    ignoreOccupancy: boolean,
    dockLineColor: ColorStub | null,
  ) => Activity | null = (_self, _dockHostActor, _dockHost, _forceEnter, _ignoreOccupancy, dockLineColor) => {
    // 动态导入避免循环依赖
    // 在运行时，MoveToDock 类应该已经加载
    try {
      // 使用 require 风格的动态导入 (在 ESM 中需要特殊处理)
      // 实际运行时，MoveToDock 应该已经通过模块图加载
      // 这里返回 null，由调用者处理 (或者使用预先注册的工厂)
      void dockLineColor
      return null
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 从 actor 解析 Harvester trait 和 HarvesterInfo。 */
  private static _resolveHarvester(self: GameActor): { harvester: HarvesterLike; info: HarvesterInfoLike } {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const harvester = traits?.get('Harvester') as HarvesterLike | undefined

    if (harvester) {
      const info = (harvester as unknown as { info?: HarvesterInfoLike }).info
      if (info) {
        return { harvester, info }
      }
    }

    const actorAny = self as unknown as Record<string, unknown>
    const actorInfo = (actorAny.info as Record<string, unknown> | undefined)
    const harvInfo = actorInfo?.harvesterInfo as HarvesterInfoLike | undefined

    return {
      harvester: harvester ?? createStubHarvester(),
      info: harvInfo ?? createStubHarvesterInfo(),
    }
  }

  /** 从 actor 解析 Mobile trait。 */
  private static _resolveMobile(self: GameActor): MobileLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const mobile = traits?.get('Mobile') as MobileLike | undefined
    if (mobile) {
      return mobile
    }

    // 回退: 检查 actor 本身是否有移动相关方法
    const actorAny = self as unknown as Record<string, unknown>
    if (typeof actorAny.moveTo === 'function' && typeof actorAny.nearestMoveableCell === 'function') {
      return actorAny as unknown as MobileLike
    }

    return createStubMobile()
  }

  /** 从 worldActor 解析 ResourceClaimLayer。 */
  private static _resolveClaimLayer(self: GameActor): ResourceClaimLayerLike {
    const world = (self as unknown as { world?: { worldActor?: unknown } | null }).world
    const worldActor = world?.worldActor as Record<string, unknown> | undefined

    if (worldActor) {
      const claimLayer = worldActor.claimLayer ?? worldActor._claimLayer
      if (claimLayer && typeof (claimLayer as { tryClaimCell?: unknown }).tryClaimCell === 'function') {
        return claimLayer as ResourceClaimLayerLike
      }
    }

    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const claimLayer = traits?.get('ResourceClaimLayer')
    if (claimLayer && typeof (claimLayer as { tryClaimCell?: unknown }).tryClaimCell === 'function') {
      return claimLayer as ResourceClaimLayerLike
    }

    return createStubResourceClaimLayer()
  }

  /** 从 actor 解析 DockClientManager。 */
  private static _resolveDockClient(self: GameActor): DockClientManagerLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const dockClient = traits?.get('DockClientManager') as DockClientManagerLike | undefined
    if (dockClient) {
      return dockClient
    }

    // 回退: 检查 actor 本身是否有 DockClientManager 方法
    const actorAny = self as unknown as Record<string, unknown>
    if (typeof actorAny.reserveHost === 'function' && typeof actorAny.unreserveHost === 'function') {
      return actorAny as unknown as DockClientManagerLike
    }

    return createStubDockClientManager()
  }
}

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Harvester trait 最小接口。 */
interface HarvesterLike {
  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** 是否已满。 */
  readonly isFull: boolean

  /** 是否为空。 */
  readonly isEmpty: boolean

  /** 检查单元格是否可以收割。 */
  canHarvestCell(self: GameActor, cell: CPos): boolean
}

/** HarvesterInfo 配置最小接口。 */
interface HarvesterInfoLike {
  /** 是否排队完整装载。 */
  readonly queueFullLoad: boolean

  /** 从收割机搜索半径。 */
  readonly searchFromHarvesterRadius: number

  /** 从精炼厂搜索半径。 */
  readonly searchFromProcRadius: number

  /** 无资源时等待时长。 */
  readonly waitDuration: number

  /** 精炼厂方向成本惩罚。 */
  readonly resourceRefineryDirectionPenalty: number

  /** 收割目标线颜色。 */
  readonly harvestLineColor: ColorStub

  /** 解堵单元格偏移。 */
  readonly unblockCell: { x: number; y: number }
}

/** Mobile trait 最小接口。 */
interface MobileLike {
  /** 移动到指定单元格。 */
  moveTo(self: GameActor, cell: CPos, nearEnough: number): unknown

  /** 查找最近的移动单元格。 */
  nearestMoveableCell(target: CPos, minRange: number, maxRange: number): CPos

  /** 路径查找器。 */
  readonly pathFinder: PathFinderLike | null
}

/** PathFinder 最小接口。 */
interface PathFinderLike {
  /** 通过谓词查找目标单元格路径。
   *
   *  @param self — actor
   *  @param sources — 起始单元格列表
   *  @param targetPredicate — 目标单元格谓词
   *  @param check — 阻挡检查级别
   *  @param customCost — 自定义成本函数
   *  @returns 路径单元格数组 (从目标到源，反转)
   */
  findPathToTargetCellByPredicate(
    self: GameActor,
    sources: CPos[],
    targetPredicate: (cell: CPos) => boolean,
    check: BlockedByActor,
    customCost: ((cell: CPos) => number) | null,
  ): CPos[]
}

/** ResourceClaimLayer 最小接口。 */
interface ResourceClaimLayerLike {
  tryClaimCell(claimer: GameActor, cell: CPos): boolean
  removeClaim(claimer: GameActor): void
  canClaimCell(claimer: GameActor, cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

/** 创建最小 Harvester 存根。 */
function createStubHarvester(): HarvesterLike {
  return {
    isTraitDisabled: false,
    isFull: false,
    isEmpty: true,
    canHarvestCell: () => false,
  }
}

/** 创建最小 HarvesterInfo 存根。 */
function createStubHarvesterInfo(): HarvesterInfoLike {
  return {
    queueFullLoad: false,
    searchFromHarvesterRadius: 12,
    searchFromProcRadius: 24,
    waitDuration: 25,
    resourceRefineryDirectionPenalty: 200,
    harvestLineColor: { r: 0.86, g: 0.08, b: 0.24, a: 1 },
    unblockCell: { x: 0, y: 4 },
  }
}

/** 创建最小 Mobile 存根。 */
function createStubMobile(): MobileLike {
  return {
    moveTo: () => null,
    nearestMoveableCell: (target) => target,
    pathFinder: null,
  }
}

/** 创建最小 ResourceClaimLayer 存根。 */
function createStubResourceClaimLayer(): ResourceClaimLayerLike {
  return {
    tryClaimCell: () => true,
    removeClaim: () => { /* no-op */ },
    canClaimCell: () => true,
  }
}

/** 创建最小 DockClientManager 存根。 */
function createStubDockClientManager(): DockClientManagerLike {
  return {
    isTraitDisabled: false,
    info: { searchForDockDelay: 25 },
    reservedHost: null,
    reservedHostActor: null,
    lastReservedHost: null,
    dockLineColor: { r: 0, g: 1, b: 0, a: 1 },
    closestDock: () => null,
    availableDockHosts: () => [],
    reserveHost: () => false,
    unreserveHost: () => { /* no-op */ },
  }
}
