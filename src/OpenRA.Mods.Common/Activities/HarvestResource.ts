/**
 * HarvestResource.ts — 资源采集活动（单单元格收割）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/HarvestResource.cs
 *
 * 核心范式转换:
 * - C# Harvester trait 解析 → TypeScript 鸭子类型查找 (actor.traits Map)
 * - C# IFacing / BodyOrientation → 鸭子类型朝向解析
 * - C# ResourceClaimLayer.TryClaimCell() → claimLayer.tryClaimCell()
 * - C# IResourceLayer.GetResource() / RemoveResource() → resourceLayer.getResource() / removeResource()
 * - C# QueueChild(new Turn(...)) / QueueChild(new Wait(...)) → this.queueChild(new Turn(...))
 * - C# INotifyHarvestAction[] 数组 → TypeScript 鸭子类型数组
 * - C# MoveCooldownHelper → 复用已迁移的 MoveCooldownHelper
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { WAngle } from '../../OpenRA.Game/WAngle.js'
import { Turn } from './Turn.js'
import { Wait } from './Wait.js'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.js'
import type { INotifyHarvestAction } from './EconomicActivityInterfaces.js'
import type { BodyOrientation } from './EconomicActivityInterfaces.js'

// ---------------------------------------------------------------------------
// HarvestResource
// ---------------------------------------------------------------------------

/**
 * 在指定单元格收割资源的活动。
 *
 * OpenRA 对照: HarvestResource activity
 *
 * 工作流程:
 * 1. onFirstRun: 通过 ResourceClaimLayer 声明目标单元格
 * 2. tick: 移动到目标单元格 → 调整朝向 → 收割资源 → 等待装载延迟
 * 3. onLastRun: 释放单元格声明
 * 4. cancel: 通知 INotifyHarvestAction 监听者移动已取消
 *
 * 被 FindAndDeliverResources 使用来执行单次单元格收割。
 */
export class HarvestResource extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** 目标资源单元格。 */
  readonly targetCell: CPos

  // ---------------------------------------------------------------------------
  // Resolved traits (duck-typed)
  // ---------------------------------------------------------------------------

  /** Harvester trait (鸭子类型)。 */
  private readonly harvester: HarvesterLike

  /** Harvester 配置信息。 */
  private readonly harvInfo: HarvesterInfoLike

  /** 朝向 trait (可选，用于 harvest facings 检查)。 */
  private readonly facing: FacingLike | null

  /** 身体朝向量化器 (可选，用于 harvest facings)。 */
  private readonly body: BodyOrientation | null

  /** 移动 trait (可选，用于移动到目标单元格)。 */
  private readonly move: MoveLike | null

  /** 资源声明层 (世界级 trait)。 */
  private readonly claimLayer: ResourceClaimLayerLike

  /** 资源层 (世界级 trait)。 */
  private readonly resourceLayer: IResourceLayerLike

  /** 收割动作通知监听者。 */
  private readonly notifyHarvestActions: INotifyHarvestAction[]

  /** 移动冷却辅助器。 */
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 HarvestResource 活动。
   *
   * OpenRA 对照: HarvestResource(Actor self, CPos targetCell)
   *
   * @param self — 执行此活动的 actor (收割机)
   * @param targetCell — 要收割的目标单元格
   */
  constructor(self: GameActor, targetCell: CPos) {
    super()
    this.targetCell = targetCell

    // 解析 Harvester trait
    const resolved = HarvestResource._resolveHarvester(self)
    this.harvester = resolved.harvester
    this.harvInfo = resolved.info

    // 解析 IFacing
    this.facing = HarvestResource._resolveFacing(self)

    // 解析 BodyOrientation
    this.body = HarvestResource._resolveBodyOrientation(self)

    // 解析 IMove / Mobile
    this.move = HarvestResource._resolveMove(self)

    // 解析 ResourceClaimLayer (从 worldActor)
    this.claimLayer = HarvestResource._resolveClaimLayer(self)

    // 解析 IResourceLayer (从 worldActor)
    this.resourceLayer = HarvestResource._resolveResourceLayer(self)

    // 解析 INotifyHarvestAction 监听者
    this.notifyHarvestActions = HarvestResource._resolveNotifyHarvestActions(self)

    // 创建 MoveCooldownHelper
    // NOTE: MoveCooldownHelper expects Mobile | null, but we use duck-typed
    // move trait. Cast through unknown to satisfy type checker.
    const world = (self as unknown as { world?: { sharedRandom?: { next(): number } } | null }).world ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(
      world,
      this.move as unknown as import('../Traits/Mobile.js').Mobile | null,
    )
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  /**
   * 首次运行时声明目标单元格。
   *
   * OpenRA 对照: HarvestResource.OnFirstRun(Actor)
   *
   * 我们可以安全地假设声明会成功，因为此活动只在目标单元格被选择的
   * 同一 actor-tick 内被调用。因此没有其他收割机能够声明该单元格。
   */
  protected override onFirstRun(_self: GameActor): void {
    this.claimLayer.tryClaimCell(_self, this.targetCell)
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每 tick 执行收割逻辑。
   *
   * OpenRA 对照: HarvestResource.Tick(Actor)
   *
   * @param self — 执行此活动的 actor
   * @returns true 当活动完成，false 继续执行
   */
  override tick(self: GameActor): boolean {
    // 如果 trait 被禁用，取消活动
    if (this.harvester.isTraitDisabled) {
      this.cancel(self, true)
      return true
    }

    // 如果正在取消或收割机已满，完成活动
    if (this.isCanceling || this.harvester.isFull) {
      return true
    }

    // 移动冷却辅助器 tick
    const cooldownResult = this.moveCooldownHelper.tick(false)
    if (cooldownResult !== null) {
      return cooldownResult
    }

    // 如果不在目标单元格，移动到目标单元格
    const actorLocation = (self as unknown as { location?: CPos }).location
    if (actorLocation === undefined || !actorLocation.equals(this.targetCell)) {
      // 通知监听者正在移动到资源
      for (const n of this.notifyHarvestActions) {
        n.movingToResources(self, this.targetCell)
      }

      this.moveCooldownHelper.notifyMoveQueued()

      // 通过 move trait 排队移动子活动
      if (this.move !== null) {
        const moveActivity = this.move.moveTo(self, this.targetCell, 0)
        if (moveActivity !== null) {
          this.queueChild(moveActivity as Activity)
        }
      }
      return false
    }

    // 检查当前单元格是否可以收割
    if (!this.harvester.canHarvestCell(self, this.targetCell)) {
      return true
    }

    // 如果需要特定的收割朝向，调整到最近的量化朝向
    if (this.harvInfo.harvestFacings !== 0) {
      const current = this.facing?.facing ?? null
      if (current !== null && this.body !== null) {
        const desired = this.body.quantizeFacing(current, this.harvInfo.harvestFacings)
        if (desired.angle !== current.angle) {
          this.queueChild(new Turn(self, desired))
          return false
        }
      }
    }

    // 获取单元格资源并移除一个单位
    const resource = this.resourceLayer.getResource(this.targetCell)
    if (resource.type === '' || this.resourceLayer.removeResource(resource.type, this.targetCell) !== 1) {
      return true
    }

    // 将资源添加到收割机货舱
    this.harvester.addResource(self, resource.type)

    // 通知监听者收割完成
    for (const t of this.notifyHarvestActions) {
      t.harvested(self, resource.type)
    }

    // 排队等待装载延迟
    this.queueChild(new Wait(this.harvInfo.baleLoadDelay))
    return false
  }

  // ---------------------------------------------------------------------------
  // OnLastRun
  // ---------------------------------------------------------------------------

  /**
   * 最后运行时释放单元格声明。
   *
   * OpenRA 对照: HarvestResource.OnLastRun(Actor)
   */
  protected override onLastRun(_self: GameActor): void {
    this.claimLayer.removeClaim(_self)
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * 取消此活动 — 通知监听者移动已取消。
   *
   * OpenRA 对照: HarvestResource.Cancel(Actor, bool)
   *
   * @param self — 执行此活动的 actor
   * @param keepQueue — 是否保留后续活动队列
   */
  override cancel(self: GameActor, keepQueue: boolean = false): void {
    // 通知监听者移动被取消
    for (const n of this.notifyHarvestActions) {
      n.movementCancelled(self)
    }

    super.cancel(self, keepQueue)
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * 获取目标线节点。
   *
   * OpenRA 对照: HarvestResource.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    return [new TargetLineNode(Target.fromCell(this.targetCell), this.harvInfo.harvestLineColor)]
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 从 actor 解析 Harvester trait 和 HarvesterInfo。
   *
   *  OpenRA 对照: self.Trait<Harvester>() + self.Info.TraitInfo<HarvesterInfo>()
   */
  private static _resolveHarvester(self: GameActor): { harvester: HarvesterLike; info: HarvesterInfoLike } {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const harvester = traits?.get('Harvester') as HarvesterLike | undefined

    if (harvester) {
      // 从 Harvester trait 获取 info
      const info = (harvester as unknown as { info?: HarvesterInfoLike }).info
      if (info) {
        return { harvester, info }
      }
    }

    // 回退: 直接从 actor 的 traits 中查找 HarvesterInfo
    const info = traits?.get('HarvesterInfo') as HarvesterInfoLike | undefined
    if (info) {
      return {
        harvester: harvester ?? createStubHarvester(),
        info,
      }
    }

    // 从 actor 本身查找属性
    const actorAny = self as unknown as Record<string, unknown>
    const actorInfo = (actorAny.info as Record<string, unknown> | undefined)
    const harvInfo = actorInfo?.harvesterInfo as HarvesterInfoLike | undefined

    return {
      harvester: harvester ?? createStubHarvester(),
      info: harvInfo ?? createStubHarvesterInfo(),
    }
  }

  /** 从 actor 解析 IFacing trait。
   *
   *  OpenRA 对照: self.Trait<IFacing>()
   */
  private static _resolveFacing(self: GameActor): FacingLike | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const facing = traits?.get('facing') ?? traits?.get('IFacing')
    if (facing && typeof (facing as { facing?: WAngle }).facing !== 'undefined') {
      return facing as FacingLike
    }
    return null
  }

  /** 从 actor 解析 BodyOrientation trait。
   *
   *  OpenRA 对照: self.Trait<BodyOrientation>()
   */
  private static _resolveBodyOrientation(self: GameActor): BodyOrientation | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const body = traits?.get('BodyOrientation')
    if (body && typeof (body as { quantizeFacing?: unknown }).quantizeFacing === 'function') {
      return body as BodyOrientation
    }
    return null
  }

  /** 从 actor 解析 IMove / Mobile trait。
   *
   *  OpenRA 对照: self.Trait<IMove>() (cast to Mobile)
   */
  private static _resolveMove(self: GameActor): MoveLike | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const move = traits?.get('Mobile') ?? traits?.get('IMove')
    if (move && typeof (move as { moveTo?: unknown }).moveTo === 'function') {
      return move as MoveLike
    }
    return null
  }

  /** 从 worldActor 解析 ResourceClaimLayer。
   *
   *  OpenRA 对照: self.World.WorldActor.Trait<ResourceClaimLayer>()
   */
  private static _resolveClaimLayer(self: GameActor): ResourceClaimLayerLike {
    const world = (self as unknown as { world?: { worldActor?: unknown } | null }).world
    const worldActor = world?.worldActor as Record<string, unknown> | undefined

    if (worldActor) {
      const claimLayer = worldActor.claimLayer ?? worldActor._claimLayer
      if (claimLayer && typeof (claimLayer as { tryClaimCell?: unknown }).tryClaimCell === 'function') {
        return claimLayer as ResourceClaimLayerLike
      }
    }

    // 回退: 检查 actor 的 traits
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const claimLayer = traits?.get('ResourceClaimLayer')
    if (claimLayer && typeof (claimLayer as { tryClaimCell?: unknown }).tryClaimCell === 'function') {
      return claimLayer as ResourceClaimLayerLike
    }

    return createStubResourceClaimLayer()
  }

  /** 从 worldActor 解析 IResourceLayer。
   *
   *  OpenRA 对照: self.World.WorldActor.Trait<IResourceLayer>()
   */
  private static _resolveResourceLayer(self: GameActor): IResourceLayerLike {
    const world = (self as unknown as { world?: { worldActor?: unknown } | null }).world
    const worldActor = world?.worldActor as Record<string, unknown> | undefined

    if (worldActor) {
      const layer = worldActor.resourceLayer ?? worldActor._resourceLayer
      if (layer && typeof (layer as { getResource?: unknown }).getResource === 'function') {
        return layer as IResourceLayerLike
      }
    }

    // 回退: 检查 actor 的 traits
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const layer = traits?.get('ResourceLayer') ?? traits?.get('IResourceLayer')
    if (layer && typeof (layer as { getResource?: unknown }).getResource === 'function') {
      return layer as IResourceLayerLike
    }

    return createStubResourceLayer()
  }

  /** 从 actor 解析 INotifyHarvestAction 监听者。
   *
   *  OpenRA 对照: self.TraitsImplementing<INotifyHarvestAction>().ToArray()
   */
  private static _resolveNotifyHarvestActions(self: GameActor): INotifyHarvestAction[] {
    const result: INotifyHarvestAction[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits) {
      for (const [, trait] of traits) {
        const t = trait as Partial<INotifyHarvestAction>
        if (typeof t.movingToResources === 'function' &&
            typeof t.harvested === 'function' &&
            typeof t.movementCancelled === 'function') {
          result.push(t as INotifyHarvestAction)
        }
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Harvester trait 最小接口 — 鸭子类型。 */
interface HarvesterLike {
  /** 是否被条件禁用。 */
  readonly isTraitDisabled: boolean

  /** 是否已满。 */
  readonly isFull: boolean

  /** 检查单元格是否可以收割。
   *
   *  @param self — actor
   *  @param cell — 单元格位置
   *  @returns 是否可以收割
   */
  canHarvestCell(self: GameActor, cell: CPos): boolean

  /** 添加资源到货舱。
   *
   *  @param self — actor
   *  @param resourceType — 资源类型
   */
  addResource(self: GameActor, resourceType: string): void
}

/** HarvesterInfo 配置最小接口。 */
interface HarvesterInfoLike {
  /** 收割朝向面数 (0 = 任意朝向)。 */
  readonly harvestFacings: number

  /** 每 bale 装载延迟 (tick 数)。 */
  readonly baleLoadDelay: number

  /** 收割目标线颜色。 */
  readonly harvestLineColor: { r: number; g: number; b: number; a: number }
}

/** IFacing trait 最小接口。 */
interface FacingLike {
  /** 当前朝向。 */
  facing: WAngle

  /** 转向速度。 */
  turnSpeed: WAngle
}

/** IMove / Mobile trait 最小接口 — 用于移动。 */
interface MoveLike {
  /** 移动到指定单元格。
   *
   *  @param self — actor
   *  @param cell — 目标单元格
   *  @param nearEnough — 接近阈值
   *  @returns 移动活动 (或 null)
   */
  moveTo(self: GameActor, cell: CPos, nearEnough: number): unknown
}

/** ResourceClaimLayer 最小接口。 */
interface ResourceClaimLayerLike {
  /** 尝试声明单元格。
   *
   *  @param claimer — 声明者 actor
   *  @param cell — 单元格位置
   *  @returns 声明是否成功
   */
  tryClaimCell(claimer: GameActor, cell: CPos): boolean

  /** 移除声明。
   *
   *  @param claimer — 声明者 actor
   */
  removeClaim(claimer: GameActor): void

  /** 检查是否可以声明单元格。
   *
   *  @param claimer — 声明者 actor
   *  @param cell — 单元格位置
   *  @returns 是否可以声明
   */
  canClaimCell(claimer: GameActor, cell: CPos): boolean
}

/** IResourceLayer 最小接口。 */
interface IResourceLayerLike {
  /** 获取单元格资源内容。
   *
   *  @param cell — 单元格位置
   *  @returns 资源内容 { type: string, density: number }
   */
  getResource(cell: CPos): { type: string; density: number }

  /** 从单元格移除资源。
   *
   *  @param resourceType — 资源类型
   *  @param cell — 单元格位置
   *  @returns 实际移除的数量
   */
  removeResource(resourceType: string, cell: CPos): number
}

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

/** 创建最小 Harvester 存根。 */
function createStubHarvester(): HarvesterLike {
  return {
    isTraitDisabled: false,
    isFull: false,
    canHarvestCell: () => false,
    addResource: () => { /* no-op */ },
  }
}

/** 创建最小 HarvesterInfo 存根。 */
function createStubHarvesterInfo(): HarvesterInfoLike {
  return {
    harvestFacings: 0,
    baleLoadDelay: 4,
    harvestLineColor: { r: 0.86, g: 0.08, b: 0.24, a: 1 },
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

/** 创建最小 IResourceLayer 存根。 */
function createStubResourceLayer(): IResourceLayerLike {
  return {
    getResource: () => ({ type: '', density: 0 }),
    removeResource: () => 0,
  }
}
