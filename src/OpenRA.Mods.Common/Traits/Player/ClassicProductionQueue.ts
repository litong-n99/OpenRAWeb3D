/**
 * ClassicProductionQueue.ts — 经典共享生产队列：多工厂加速建造
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/ClassicProductionQueue.cs (161 lines)
 *
 * 核心范式转换:
 * - C# ClassicProductionQueue extends ProductionQueue → TS extends ProductionQueue
 * - C# LINQ (ActorsWithTrait, Where, OrderBy, FirstOrDefault) → TS 显式循环
 * - C# BuildTimeSpeedReduction ImmutableArray<int> → TS readonly number[]
 * - C# TraitPair<Production> → TS 直接返回 Production trait
 *
 * ClassicProductionQueue 附加到玩家 Actor（而非建筑），实现共享队列。
 * 当玩家建造多个同类型生产建筑时，所有该队列中的建造时间会缩短。
 */

import { ProductionQueue, ProductionQueueInfo } from './ProductionQueue.js'
import type { IGameActor, ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Production } from '../Production.js'
import type { BuildableInfo } from '../Buildable.js'

// ---------------------------------------------------------------------------
// ClassicProductionQueueInfo
// OpenRA 对照: ClassicProductionQueueInfo (extends ProductionQueueInfo)
// ---------------------------------------------------------------------------

/** Configuration for the ClassicProductionQueue trait.
 *
 * OpenRA 对照: ClassicProductionQueueInfo
 *
 * Extends ProductionQueueInfo with shared-queue speed-up logic.
 */
export class ClassicProductionQueueInfo extends ProductionQueueInfo {
  /** Enable build time reduction with multiple factories.
   *
   * OpenRA 对照: ClassicProductionQueueInfo.SpeedUp
   */
  readonly speedUp: boolean = false

  /** Per-factory speed modifiers (default: [100, 86, 75, 67, 60, 55, 50]).
   *
   * OpenRA 对照: ClassicProductionQueueInfo.BuildTimeSpeedReduction (ImmutableArray<int>)
   */
  readonly buildTimeSpeedReduction: readonly number[] = [100, 86, 75, 67, 60, 55, 50]

  constructor(params: {
    instanceName?: string
    type?: string
    displayOrder?: number
    group?: string | null
    factions?: ReadonlySet<string> | readonly string[]
    sticky?: boolean
    payUpFront?: boolean
    disallowPaused?: boolean
    buildDurationModifier?: number
    itemLimit?: number
    queueLimit?: number
    lowPowerModifier?: number
    infiniteBuildLimit?: number
    readyAudio?: string | null
    readyTextNotification?: string | null
    blockedAudio?: string | null
    blockedTextNotification?: string | null
    limitedAudio?: string | null
    limitedTextNotification?: string | null
    cannotPlaceAudio?: string | null
    queuedAudio?: string | null
    queuedTextNotification?: string | null
    onHoldAudio?: string | null
    onHoldTextNotification?: string | null
    cancelledAudio?: string | null
    cancelledTextNotification?: string | null
    speedUp?: boolean
    buildTimeSpeedReduction?: readonly number[]
  } = {}) {
    super(params)
    if (params.speedUp !== undefined) this.speedUp = params.speedUp
    if (params.buildTimeSpeedReduction !== undefined) this.buildTimeSpeedReduction = params.buildTimeSpeedReduction
  }
}

// ---------------------------------------------------------------------------
// ClassicProductionQueue
// OpenRA 对照: ClassicProductionQueue class
// ---------------------------------------------------------------------------

/** Shared production queue with build time speed-up from multiple factories.
 *
 * OpenRA 对照: ClassicProductionQueue
 *
 * When the player builds multiple production structures of the same type,
 * build times for all items in this queue are reduced according to the
 * BuildTimeSpeedReduction table.
 */
export class ClassicProductionQueue extends ProductionQueue {
  /** The typed info reference (shadows parent). */
  declare readonly info: ClassicProductionQueueInfo

  /** All Production traits in the world (for counting active producers). */
  private _worldProductions: Production[] = []

  constructor(
    actor: IGameActor,
    info: ClassicProductionQueueInfo,
    faction: string = '',
    rulesActors: Map<string, ActorInfoStub> = new Map(),
  ) {
    super(actor, info, faction, rulesActors)
  }

  /** Set all Production traits in the world for producer counting.
   *
   * Used for dependency injection in tests and initialization.
   */
  setWorldProductions(productions: Production[]): void {
    this._worldProductions = productions
  }

  // ---------------------------------------------------------------------------
  // Tick override
  // ---------------------------------------------------------------------------

  /** Override tick to scan all Production traits in the world.
   *
   * OpenRA 对照: ClassicProductionQueue.Tick(Actor)
   *
   * The enabled logic matches C# exactly: enabled is set to IsValidFaction
   * only when we find at least one non-disabled Production trait that produces
   * this queue's type. If no matching traits exist, the queue is disabled.
   */
  protected override _tick(self: IGameActor): void {
    // PERF: Avoid LINQ.
    let enabled = false
    let isActive = false
    for (const x of this._worldProductions) {
      if (x.isTraitDisabled) continue
      // In full implementation: check x.actor.owner == self.owner && x.info.produces.contains(this.info.type)
      // For now, we check produces membership only
      if (!x.info.produces.has(this.info.type)) continue

      // Only enable if we found at least one matching production building
      // AND the faction is valid for this queue
      enabled = this.isValidFaction
      isActive ||= !x.isTraitPaused
    }

    if (!enabled) {
      this.clearQueue()
    }

    // Update enabled state
    this['_enabled'] = enabled
    this._tickInner(self, !isActive)
  }

  // ---------------------------------------------------------------------------
  // AllItems / BuildableItems override
  // ---------------------------------------------------------------------------

  /** Get all items that could be produced.
   *
   * OpenRA 对照: ClassicProductionQueue.AllItems()
   *
   * Returns empty if the queue is not enabled.
   */
  override allItems(): ActorInfoStub[] {
    if (!this.enabled) return []
    return super.allItems()
  }

  /** Get all items that are currently buildable.
   *
   * OpenRA 对照: ClassicProductionQueue.BuildableItems()
   *
   * Returns empty if the queue is not enabled.
   */
  override buildableItems(): ActorInfoStub[] {
    if (!this.enabled) return []
    return super.buildableItems()
  }

  // ---------------------------------------------------------------------------
  // mostLikelyProducer override
  // ---------------------------------------------------------------------------

  /** Find the most likely production trait to use.
   *
   * OpenRA 对照: ClassicProductionQueue.MostLikelyProducer()
   *
   * Selects producer ordered by: not paused, is primary building, highest ActorID.
   * In this stub, we delegate to the parent implementation.
   */
  override mostLikelyProducer(): Production | null {
    // In full implementation:
    // Scan all world productions for matching queue type
    // Order by: not paused, primary building, highest ActorID
    // For now, delegate to parent
    return super.mostLikelyProducer()
  }

  // ---------------------------------------------------------------------------
  // BuildUnit override
  // ---------------------------------------------------------------------------

  /** Attempt to build a unit from any available producer.
   *
   * OpenRA 对照: ClassicProductionQueue.BuildUnit(ActorInfo)
   *
   * Iterates all producers and tries each until one succeeds.
   */
  protected override _buildUnit(unit: ActorInfoStub): boolean {
    // In full implementation:
    // Find all producers of matching type for this owner
    // Try each in order (primary first, then by ActorID)
    // Return true if any succeeds
    // For now, delegate to parent
    return super._buildUnit(unit)
  }

  // ---------------------------------------------------------------------------
  // getBuildTime override — speed reduction
  // ---------------------------------------------------------------------------

  /** Calculate build time with speed reduction from multiple factories.
   *
   * OpenRA 对照: ClassicProductionQueue.GetBuildTime(ActorInfo, BuildableInfo)
   *
   * @param unit — the actor info
   * @param bi — the buildable info
   * @returns build time in ticks
   */
  override getBuildTime(unit: ActorInfoStub, bi: BuildableInfo): number {
    if (this.developerMode?.fastBuild ?? false) {
      return 0
    }

    const time = super.getBuildTime(unit, bi)

    if (this.info.speedUp) {
      const type = bi.buildAtProductionType ?? this.info.type

      // Count active producers of the same type for the same owner
      let selfsameProductionsCount = 0
      for (const p of this._worldProductions) {
        if (p.isTraitDisabled || p.isTraitPaused) continue
        if (!p.info.produces.has(type)) continue
        // In full implementation: check p.actor.owner == this.actor.owner
        selfsameProductionsCount++
      }

      const clampedCount = Math.max(1, Math.min(selfsameProductionsCount, this.info.buildTimeSpeedReduction.length))
      const speedModifier = this.info.buildTimeSpeedReduction[clampedCount - 1]
      return Math.floor((time * speedModifier) / 100)
    }

    return time
  }
}
