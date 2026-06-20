/**
 * UnitBuilderBotModule.ts — AI unit production queue management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/UnitBuilderBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<UnitBuilderBotModuleInfo> (271 lines)
 *   → TypeScript ConditionalTrait with interval-based production
 * - C# IBotTick.BotTick with FeedbackTime gating → TypeScript botTick
 * - C# PlayerResources check → duck-typed cash check
 * - C# IBotRequestUnitProduction → TypeScript interface call
 * - C# ChooseRandomUnitToBuild with unit ratios → TypeScript ratio-based selection
 * - C# BuildUnit (specific unit request) → TypeScript BuildUnit
 * - C# HasAdequateAirUnitReloadBuildings → TypeScript air unit capacity check
 * - C# PERF: one queue type per tick → TypeScript same pattern
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotNotifyIdleBaseUnits,
  IBotRequestUnitProduction,
  IBot,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// UnitBuilderBotModuleInfo
// ---------------------------------------------------------------------------

export interface UnitBuilderBotModuleInfo extends ConditionalTraitInfo {
  readonly idleBaseUnitsMaximum: number
  readonly unitQueues: readonly string[]
  readonly unitsToBuild: ReadonlyMap<string, number> // name → target share %
  readonly unitLimits?: ReadonlyMap<string, number> // name → max count
  readonly unitDelays?: ReadonlyMap<string, number> // name → earliest tick
  readonly productionMinCashRequirement: number
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

interface ActorLike {
  actorId: number
  owner: PlayerLike
  isDead: boolean
  isInWorld: boolean
  info?: { name: string }
  traitsImplementing?: (name: string) => unknown[]
}

interface PlayerLike {
  playerActor?: {
    traitsImplementing?: (name: string) => unknown[]
    trait?: (name: string) => unknown
  }
}

interface WorldLike {
  map?: { rules?: { actors?: Map<string, { name: string; traitInfoOrDefault?: (name: string) => unknown }> } }
  worldTick: number
  actors: Iterable<ActorLike>
}

interface ProductionQueueLike {
  actor: ActorLike
  allQueued(): { item: string }[]
  buildableItems(): { name: string; traitInfoOrDefault?: (name: string) => unknown }[]
}

// ---------------------------------------------------------------------------
// UnitBuilderBotModule
// ---------------------------------------------------------------------------

export class UnitBuilderBotModule
  extends ConditionalTrait<UnitBuilderBotModuleInfo>
  implements IBotTick, IBotNotifyIdleBaseUnits, IBotRequestUnitProduction
{
  /** Interfaces implemented by this trait for TraitDictionary lookups.
   *
   * OpenRA 对照: N/A (C# uses reflection to find implemented interfaces)
   */
  static readonly interfaces: string[] = [
    'IBotTick',
    'IBotNotifyIdleBaseUnits',
    'IBotRequestUnitProduction',
    'component',
  ]

  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  private readonly _world: WorldLike
  private readonly _player: PlayerLike
  private readonly _random: SimplePrng

  /** Feedback time in ticks (~1.2s at 25tps). Must be >= netlag. */
  static readonly FEEDBACK_TIME = 30

  /** Queued build requests from other modules. */
  private readonly _queuedBuildRequests: string[] = []

  /** Idle unit count (updated by SquadManagerBotModule). */
  private _idleUnitCount: number = 0

  /** Current queue index (round-robin). */
  private _currentQueueIndex: number = 0

  /** Ticks counter. */
  private _ticks: number = 0

  /** Modules that can pause unit production. */
  private _requestPause: { pauseUnitProduction: boolean }[] = []

  /** Cached PlayerResources. */
  private _playerResources: { getCashAndResources: () => number } | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: UnitBuilderBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this._world = world
    this._player = player
    this._random = random
  }

  // -----------------------------------------------------------------------
  // IBotNotifyIdleBaseUnits
  // -----------------------------------------------------------------------

  updatedIdleBaseUnits(idleUnits: IGameActor[]): void {
    this._idleUnitCount = idleUnits.length
  }

  // -----------------------------------------------------------------------
  // IBotTick
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    // Check cash
    if (this._playerResources) {
      const cash = this._playerResources.getCashAndResources()
      if (cash < this.info.productionMinCashRequirement) return
    }

    // Check if any module wants to pause production
    if (this._requestPause.length > 0) {
      for (const rp of this._requestPause) {
        if (rp.pauseUnitProduction) return
      }
    }

    this._ticks++

    if (this._ticks % UnitBuilderBotModule.FEEDBACK_TIME === 0) {
      // Process specific build requests first
      const buildRequest = this._queuedBuildRequests.shift()
      if (buildRequest) {
        this.buildUnit(bot, buildRequest)
      }

      // Check idle unit count
      if (this.info.idleBaseUnitsMaximum <= 0 ||
        this.info.idleBaseUnitsMaximum > this._idleUnitCount) {
        for (let i = 0; i < this.info.unitQueues.length; i++) {
          if (++this._currentQueueIndex >= this.info.unitQueues.length) {
            this._currentQueueIndex = 0
          }
          const category = this.info.unitQueues[this._currentQueueIndex]
          const queues = this.getQueuesByCategory(category)
          if (queues.length > 0) {
            this.buildRandomUnit(bot, queues)
            break // one queue type per tick (PERF)
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // IBotRequestUnitProduction
  // -----------------------------------------------------------------------

  requestUnitProduction(_bot: IBot, requestedActor: string): void {
    this._queuedBuildRequests.push(requestedActor)
  }

  requestedProductionCount(_bot: IBot, requestedActor: string): number {
    let count = 0
    for (const r of this._queuedBuildRequests) {
      if (r === requestedActor) count++
    }
    return count
  }

  // -----------------------------------------------------------------------
  // Production logic
  // -----------------------------------------------------------------------

  /**
   * Build a random unit from available queues.
   *
   * OpenRA 对照: UnitBuilderBotModule.BuildRandomUnit(IBot, ProductionQueue[])
   */
  private buildRandomUnit(bot: IBot, queues: ProductionQueueLike[]): void {
    if (this.info.unitsToBuild.size === 0) return

    // Find a free queue
    const queue = queues.find(q => q.allQueued().length === 0)
    if (!queue) return

    const unitName = this.chooseRandomUnitToBuild(queue)
    if (!unitName) return

    bot.queueOrder({
      orderName: 'StartProduction',
      targetString: String(queue.actor.actorId),
      extraData: unitName,
    } as unknown as Parameters<IBot['queueOrder']>[0])
  }

  /**
   * Build a specific unit by name.
   *
   * OpenRA 对照: UnitBuilderBotModule.BuildUnit(IBot, string, ILookup)
   */
  private buildUnit(bot: IBot, name: string): void {
    const rules = this._world.map?.rules
    if (!rules?.actors) return

    const actorInfo = rules.actors.get(name)
    if (!actorInfo) return

    const buildableInfo = actorInfo.traitInfoOrDefault?.('Buildable')
    if (!buildableInfo) return

    const bi = buildableInfo as { queue?: readonly string[] }
    const queues = bi.queue ?? []

    for (const pqName of queues) {
      const categoryQueues = this.getQueuesByCategory(pqName)
      const freeQueue = categoryQueues.find(q => q.allQueued().length === 0)
      if (freeQueue) {
        bot.queueOrder({
          orderName: 'StartProduction',
          targetString: String(freeQueue.actor.actorId),
          extraData: name,
        } as unknown as Parameters<IBot['queueOrder']>[0])
        return
      }
    }
  }

  /**
   * Choose a random unit to build based on configured ratios.
   *
   * OpenRA 对照: UnitBuilderBotModule.ChooseRandomUnitToBuild(ProductionQueue)
   */
  private chooseRandomUnitToBuild(queue: ProductionQueueLike): string | null {
    const buildable = queue.buildableItems()
    if (buildable.length === 0) return null

    // Count owned units by name (for ratio calculation)
    const allUnits = this.filterOwnActors()
    const totalUnits = allUnits.length

    // Shuffle buildable (deterministic via PRNG)
    const shuffled = this.shuffleArray([...buildable])

    for (const unit of shuffled) {
      const share = this.info.unitsToBuild.get(unit.name)
      if (share === undefined) continue

      // Check delay
      const delay = this.info.unitDelays?.get(unit.name)
      if (delay !== undefined && delay > this._world.worldTick) continue

      // Count existing units of this type
      let unitCount = 0
      for (const a of allUnits) {
        if (a.info?.name === unit.name) unitCount++
      }

      // Check limit
      const limit = this.info.unitLimits?.get(unit.name)
      if (limit !== undefined && unitCount >= limit) continue

      // Check ratio
      if (totalUnits > 0) {
        const ratio = ((unitCount * 100) / totalUnits) | 0
        if (ratio < share) {
          return this.hasAdequateAirUnitReloadBuildings(unit) ? unit.name : null
        }
      } else {
        // No units yet — build first available
        return this.hasAdequateAirUnitReloadBuildings(unit) ? unit.name : null
      }
    }

    return null
  }

  /**
   * Check if there are enough rearmer buildings for aircraft.
   */
  private hasAdequateAirUnitReloadBuildings(actorInfo: { name: string; traitInfoOrDefault?: (name: string) => unknown }): boolean {
    const aircraftInfo = actorInfo.traitInfoOrDefault?.('Aircraft')
    if (!aircraftInfo) return true

    const rearmableInfo = actorInfo.traitInfoOrDefault?.('Rearmable')
    if (!rearmableInfo) return true

    // Count own aircraft vs building capacity
    const countAir = this.countOwnActorsByName(actorInfo.name)
    const ri = rearmableInfo as { rearmActors?: string[] }
    const rearmActors = ri.rearmActors ?? []

    let countBuildings = 0
    for (const buildingName of rearmActors) {
      countBuildings += this.countOwnActorsByName(buildingName)
    }

    return countAir < countBuildings
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private getQueuesByCategory(category: string): ProductionQueueLike[] {
    // Duck-type: find production queues for this category
    const result: ProductionQueueLike[] = []
    for (const a of this._world.actors) {
      if (a.owner !== this._player) continue
      const queues = a.traitsImplementing?.('ProductionQueue') ?? []
      for (const q of queues) {
        const queue = q as { info?: { type?: string }; actor?: ActorLike; allQueued?: () => { item: string }[]; buildableItems?: () => { name: string }[] }
        if (queue.info?.type === category) {
          result.push({
            actor: a,
            allQueued: () => queue.allQueued?.() ?? [],
            buildableItems: () => queue.buildableItems?.() ?? [],
          })
        }
      }
    }
    return result
  }

  private filterOwnActors(): ActorLike[] {
    const result: ActorLike[] = []
    for (const a of this._world.actors) {
      if (a.owner === this._player && !a.isDead) {
        result.push(a)
      }
    }
    return result
  }

  private countOwnActorsByName(name: string): number {
    let count = 0
    for (const a of this._world.actors) {
      if (a.owner === this._player && !a.isDead && a.info?.name === name) {
        count++
      }
    }
    return count
  }

  /**
   * Deterministic shuffle (Fisher-Yates with PRNG).
   */
  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this._random.nextIntRange(0, i)
      const temp = arr[i]
      arr[i] = arr[j]
      arr[j] = temp
    }
    return arr
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._queuedBuildRequests.length = 0
    super.dispose()
  }
}
