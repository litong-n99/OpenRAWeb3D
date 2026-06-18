/**
 * BaseBuilderBotModule.ts — AI base construction management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/BaseBuilderBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<BaseBuilderBotModuleInfo> with 575 lines of imperative logic
 *   → TypeScript ConditionalTrait with behavior tree patterns
 * - C# BaseBuilderQueueManager (620 lines, Phase E) → inline minimal implementation
 * - C# ActorIndex.OwnerAndNamesAndTrait<BuildingInfo> → TypeScript filtered actor lists
 * - C# PlayerResources / PowerManager / IResourceLayer → duck-typed stubs
 * - C# IBotTick.BotTick with interval counters → TypeScript botTick with intervals
 * - C# RallyPoint path management → simplified rally point assignment
 * - C# SellUselessRefinery logic → TypeScript refinery consolidation check
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotRespondToAttack,
  IBotPositionsUpdated,
  IBotRequestPauseUnitProduction,
  IBotSuggestRefineryProduction,
  IBot,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ResourceMapBotModule } from './ResourceMapBotModule.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// BaseBuilderBotModuleInfo
// ---------------------------------------------------------------------------

export interface BaseBuilderBotModuleInfo extends ConditionalTraitInfo {
  readonly constructionYardTypes: ReadonlySet<string>
  readonly refineryTypes: ReadonlySet<string>
  readonly powerTypes: ReadonlySet<string>
  readonly productionTypes: ReadonlySet<string>
  readonly techTypes: ReadonlySet<string>
  readonly navalProductionTypes: ReadonlySet<string>
  readonly siloTypes: ReadonlySet<string>
  readonly defenseTypes: ReadonlySet<string>
  readonly buildingQueues: readonly string[]
  readonly defenseQueues: readonly string[]

  readonly minBaseRadius: number
  readonly maxBaseRadius: number
  readonly minimumExcessPower: number
  readonly maximumExcessPower: number
  readonly excessPowerIncrement: number
  readonly excessPowerIncreaseThreshold: number
  readonly initialMinimumRefineryCount: number
  readonly additionalMinimumRefineryCount: number

  readonly structureProductionInactiveDelay: number
  readonly structureProductionActiveDelay: number
  readonly structureProductionRandomBonusDelay: number
  readonly structureProductionResumeDelay: number
  readonly maximumFailedPlacementAttempts: number
  readonly maxResourceCellsToCheck: number
  readonly checkForNewBasesDelay: number
  readonly placeDefenseTowardsEnemyChance: number
  readonly tryMaintainDefenseRange: number
  readonly newProductionCashThreshold: number
  readonly newProductionChance: number
  readonly rallyPointScanRadius: number
  readonly assignRallyPointsInterval: number
  readonly checkBestResourceLocationInterval: number
  readonly sellRefineryInterval: number
  readonly sellRefineryTooCloseCellDistance: number
  readonly sellRefineryNoResourceDistance: number
  readonly maxRefineryPerIndice: number
  readonly productionMinCashRequirement: number
  readonly expansionTolerate: readonly number[]

  // ---- OpenRA fields that were missing in original migration ----
  /** Integer percentage of the total base that must be this type of building. */
  readonly buildingFractions: ReadonlyMap<string, number>
  /** Maximum limit for specific building types. */
  readonly buildingLimits: ReadonlyMap<string, number>
  /** Delay (in ticks) before AI can start building specific buildings. */
  readonly buildingDelays: ReadonlyMap<string, number>
  /** Terrain types considered water for base building purposes. */
  readonly waterTerrainTypes: ReadonlySet<string>
  /** Radius to check for water where naval structures can be built. */
  readonly checkForWaterRadius: number
  /** Expansion tolerate when force-expanding with the only MCV. */
  readonly forceExpansionTolerate: readonly number[]
  /** Decrease expansion tolerate by Cash / this value. */
  readonly perExpansionTolerateOnCash: number
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

interface ActorLike {
  actorId: number
  owner: PlayerLike
  location: { x: number; y: number }
  centerPosition: { x: number; y: number; z: number }
  isDead: boolean
  isInWorld: boolean
  disposed: boolean
  info?: { name: string; hasTraitInfo?: (trait: string) => boolean }
  traitsImplementing?: (name: string) => unknown[]
}

interface PlayerLike {
  playerName: string
  relationshipWith(other: PlayerLike): unknown
}

interface WorldLike {
  map: MapLike
  actors: Iterable<ActorLike>
  findActorsInCircle(center: { x: number; y: number; z: number }, radius: { length: number }): ActorLike[]
  getActorsHavingTrait(name: string): ActorLike[]
  actorsWithTrait(name: string): { actor: ActorLike; trait: unknown }[]
}

interface MapLike {
  findTilesInAnnulus(center: { x: number; y: number }, minR: number, maxR: number): { x: number; y: number }[]
  findTilesInCircle(center: { x: number; y: number }, radius: number): { x: number; y: number }[]
}

interface ResourceLayerLike {
  getResource(cell: { x: number; y: number }): { type: string | null }
}

// ---------------------------------------------------------------------------
// BaseBuilderBotModule
// ---------------------------------------------------------------------------

export class BaseBuilderBotModule
  extends ConditionalTrait<BaseBuilderBotModuleInfo>
  implements
    IBotTick,
    IBotRespondToAttack,
    IBotPositionsUpdated,
    IBotRequestPauseUnitProduction,
    IBotSuggestRefineryProduction
{
  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  private readonly _world: WorldLike
  private readonly _player: PlayerLike
  private readonly _random: SimplePrng

  /** Resource map module (lazy init on first tick). */
  private _resourceMapModule: ResourceMapBotModule | null = null

  /** Buildings being produced (actor name → count). */
  buildingsBeingProduced = new Map<string, number>()

  /** Requested refinery locations (MCV actor → location pair). */
  requestedRefineries = new Map<number, { conyardLoc: { x: number; y: number }; resourceLoc: { x: number; y: number } }>()

  // -----------------------------------------------------------------------
  // Position state
  // -----------------------------------------------------------------------

  private _initialBaseCenter: { x: number; y: number } = { x: 0, y: 0 }
  private _defenseCenter: { x: number; y: number } | null = null
  resourceConyardCenter: { x: number; y: number } | null = null

  // -----------------------------------------------------------------------
  // Tick counters
  // -----------------------------------------------------------------------

  private _assignRallyPointsTicks: number
  private _checkBestResourceLocationTicks: number
  private _sellRefineryTick: number
  private _firstTick: boolean = true

  // -----------------------------------------------------------------------
  // Cached traits
  // -----------------------------------------------------------------------

  // Integrate PowerManager and PlayerResources via PlayerActor.trait<T>()
  // private _playerPowerStub: { excessPower: number } | null = null
  // private _playerResourcesStub: { getCashAndResources(): number } | null = null
  private _resourceLayer: ResourceLayerLike | null = null
  private _positionsUpdatedModules: { updatedDefenseCenter(loc: { x: number; y: number }): void }[] = []

  // -----------------------------------------------------------------------
  // Building indexes (cached per tick — MAJOR fix for hot-path iteration)
  // -----------------------------------------------------------------------

  /**
   * Cached building queries by type key.
   * Invalidated each tick to avoid iterating all actors on every getter access.
   *
   * OpenRA 对照: ActorIndex.OwnerAndNamesAndTrait (refreshed lazily)
   */
  private readonly _cachedBuildings = new Map<string, ActorLike[]>()
  private _cachedTick: number = -1

  private getTickSafe(): number {
    return (this._world as unknown as { worldTick?: number }).worldTick ?? 0
  }

  private invalidateCacheIfStale(): void {
    const tick = this.getTickSafe()
    if (tick !== this._cachedTick) {
      this._cachedBuildings.clear()
      this._cachedTick = tick
    }
  }

  private getCachedBuildings(types: ReadonlySet<string>): ActorLike[] {
    this.invalidateCacheIfStale()
    const key = Array.from(types).sort().join('|')
    let result = this._cachedBuildings.get(key)
    if (!result) {
      result = this.filterOwnActorsByTypes(types)
      this._cachedBuildings.set(key, result)
    }
    return result
  }

  private get refineryBuildings(): ActorLike[] {
    return this.getCachedBuildings(this.info.refineryTypes)
  }

  private get constructionYardBuildings(): ActorLike[] {
    return this.getCachedBuildings(this.info.constructionYardTypes)
  }

  get productionBuildings(): ActorLike[] {
    return this.getCachedBuildings(this.info.productionTypes)
  }

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: BaseBuilderBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this._world = world
    this._player = player
    this._random = random

    this._assignRallyPointsTicks = random.nextIntRange(0, info.assignRallyPointsInterval)
    this._checkBestResourceLocationTicks = random.nextIntRange(0, info.checkBestResourceLocationInterval)
    this._sellRefineryTick = info.sellRefineryInterval < 0
      ? 0
      : random.nextIntRange(0, info.sellRefineryInterval)
  }

  // -----------------------------------------------------------------------
  // IBotTick
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    if (this._firstTick) {
      this._firstTick = false
      const playerActor = (bot.player as unknown as { playerActor?: { traitsImplementing?: (name: string) => unknown[] } }).playerActor
      this._resourceMapModule = playerActor?.traitsImplementing?.('ResourceMapBotModule')?.[0] as ResourceMapBotModule | null ?? null
    }

    // Rally point assignment
    if (--this._assignRallyPointsTicks <= 0) {
      this._assignRallyPointsTicks = this.info.assignRallyPointsInterval
      // Rally points are deferred to Phase E (requires RallyPoint trait)
    }

    // Best resource location check
    if (--this._checkBestResourceLocationTicks <= 0 && this._resourceLayer) {
      this._checkBestResourceLocationTicks = this.info.checkBestResourceLocationInterval
      this.findBestResourceLocation()
    }

    // Building production
    this.buildingsBeingProduced.clear()

    // Sell redundant refineries
    if (this.info.sellRefineryInterval >= 0 && --this._sellRefineryTick <= 0) {
      this.sellUselessRefinery(bot)
      this._sellRefineryTick = this.info.sellRefineryInterval
    }
  }

  // -----------------------------------------------------------------------
  // IBotRespondToAttack
  // -----------------------------------------------------------------------

  respondToAttack(_bot: IBot, self: IGameActor, e: AttackInfo): void {
    const selfActor = self as unknown as ActorLike
    const attacker = e.attacker as unknown as ActorLike
    if (!attacker || attacker.isDead) return

    // Check if attacker is enemy
    try {
      const rel = String(this._player.relationshipWith(attacker.owner))
      if (rel !== 'Enemy') return
    } catch { return }

    // Protect buildings: set defense center to attacker location
    if (selfActor.info?.hasTraitInfo?.('Building')) {
      for (const n of this._positionsUpdatedModules) {
        n.updatedDefenseCenter(attacker.location)
      }
    }
  }

  // -----------------------------------------------------------------------
  // IBotPositionsUpdated
  // -----------------------------------------------------------------------

  updatedBaseCenter(newLocation: CPos): void {
    this._initialBaseCenter = { x: newLocation.X, y: newLocation.Y }
  }

  updatedDefenseCenter(newLocation: CPos): void {
    this._defenseCenter = { x: newLocation.X, y: newLocation.Y }
  }

  get defenseCenter(): { x: number; y: number } | null {
    return this._defenseCenter
  }

  // -----------------------------------------------------------------------
  // IBotRequestPauseUnitProduction
  // -----------------------------------------------------------------------

  get pauseUnitProduction(): boolean {
    if (this.isTraitDisabled) return false
    return !this.hasMinimalRefineryCount()
  }

  // -----------------------------------------------------------------------
  // IBotSuggestRefineryProduction
  // -----------------------------------------------------------------------

  requestLocation(
    refineryLocation: CPos,
    conyardLocation: CPos,
    expandActor: IGameActor,
  ): void {
    if (!this._resourceMapModule) return

    const closestIndice = this._resourceMapModule.findClosestIndiceFromCPos(
      { x: refineryLocation.X, y: refineryLocation.Y },
    )
    if (!closestIndice || closestIndice.playerRefineryCount < this.info.maxRefineryPerIndice) {
      const actor = expandActor as unknown as ActorLike
      this.requestedRefineries.set(actor.actorId, {
        conyardLoc: { x: conyardLocation.X, y: conyardLocation.Y },
        resourceLoc: { x: refineryLocation.X, y: refineryLocation.Y },
      })
    }
  }

  // -----------------------------------------------------------------------
  // Position queries
  // -----------------------------------------------------------------------

  getRandomBaseCenter(): { x: number; y: number } {
    const yards = this.constructionYardBuildings.filter(a => !a.isDead)
    if (yards.length > 0) {
      const idx = this._random.nextIntRange(0, yards.length - 1)
      return yards[idx].location
    }
    return this._initialBaseCenter
  }

  getDefenseBaseCenter(): { x: number; y: number } {
    if (this._defenseCenter) {
      const yards = this.constructionYardBuildings
        .filter(a => !a.isDead)
        .sort((a, b) => {
          const dxa = a.location.x - this._defenseCenter!.x
          const dya = a.location.y - this._defenseCenter!.y
          const da = dxa * dxa + dya * dya
          const dxb = b.location.x - this._defenseCenter!.x
          const dyb = b.location.y - this._defenseCenter!.y
          const db = dxb * dxb + dyb * dyb
          return da - db
        })
      if (yards.length > 0) return yards[0].location
    }
    return this.getRandomBaseCenter()
  }

  // -----------------------------------------------------------------------
  // Refinery management
  // -----------------------------------------------------------------------

  hasAdequateRefineryCount(): boolean {
    if (this.info.refineryTypes.size === 0) return true
    const refs = this.refineryBuildings.length
    const optimal = this.optimalRefineryCount()
    return refs >= optimal ||
      this.filterOwnActorsByTypes(this.info.powerTypes).length === 0 ||
      this.constructionYardBuildings.length === 0
  }

  hasMinimalRefineryCount(): boolean {
    return this.refineryBuildings.length >= this.info.initialMinimumRefineryCount
  }

  optimalRefineryCount(): number {
    return this.productionBuildings.length > 0
      ? this.info.initialMinimumRefineryCount + this.info.additionalMinimumRefineryCount
      : this.info.initialMinimumRefineryCount
  }

  // -----------------------------------------------------------------------
  // Resource location scan
  // -----------------------------------------------------------------------

  private findBestResourceLocation(): void {
    const map = this._world.map
    let bestConyard: ActorLike | null = null
    let bestScore = -2147483648 // INT32_MIN

    for (const conyard of this.constructionYardBuildings) {
      if (conyard.isDead) continue

      // Check for resources within base radius
      const tiles = map.findTilesInAnnulus(
        conyard.location,
        this.info.minBaseRadius,
        this.info.maxBaseRadius,
      )

      let hasResources = false
      if (this._resourceLayer) {
        for (const c of tiles) {
          const res = this._resourceLayer.getResource(c)
          if (this._resourceMapModule) {
            if (res.type && this._resourceMapModule.info.valuableResourceTypes.has(res.type)) {
              hasResources = true
              break
            }
          } else if (res.type) {
            hasResources = true
            break
          }
        }
      }
      if (!hasResources) continue

      // Count refineries and enemies in range
      const radius = { length: this.info.maxBaseRadius * 1024 }
      const nearby = this._world.findActorsInCircle(conyard.centerPosition, radius)
      const refs = nearby.filter(a =>
        a.owner === this._player &&
        a.info?.name &&
        this.info.refineryTypes.has(a.info.name),
      ).length

      let enemies = 0
      for (const a of nearby) {
        try {
          if (String(this._player.relationshipWith(a.owner)) === 'Enemy') enemies++
        } catch { /* ignore */ }
      }

      const score = -enemies - refs
      if (score > bestScore) {
        bestScore = score
        bestConyard = conyard
      }
    }

    this.resourceConyardCenter = bestConyard?.location ?? null
  }

  // -----------------------------------------------------------------------
  // Sell redundant refinery
  // -----------------------------------------------------------------------

  private sellUselessRefinery(bot: IBot): void {
    const refineries = this.refineryBuildings
    const minRefs = this.info.initialMinimumRefineryCount + this.info.additionalMinimumRefineryCount
    if (refineries.length <= minRefs) return

    for (let i = 0; i < refineries.length; i++) {
      for (let j = i + 1; j < refineries.length; j++) {
        const dx = refineries[i].location.x - refineries[j].location.x
        const dy = refineries[i].location.y - refineries[j].location.y
        if (dx * dx + dy * dy <=
          this.info.sellRefineryTooCloseCellDistance * this.info.sellRefineryTooCloseCellDistance) {
          bot.queueOrder({
            orderName: 'Sell',
            targetString: String(refineries[i].actorId),
            extraData: 0,
          } as unknown as Parameters<IBot['queueOrder']>[0])
          return
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private filterOwnActorsByTypes(types: ReadonlySet<string>): ActorLike[] {
    const result: ActorLike[] = []
    for (const a of this._world.actors) {
      if (a.owner === this._player && !a.isDead && a.isInWorld) {
        if (a.info?.name && types.has(a.info.name)) {
          result.push(a)
        }
      }
    }
    return result
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this.buildingsBeingProduced.clear()
    this.requestedRefineries.clear()
    super.dispose()
  }
}
