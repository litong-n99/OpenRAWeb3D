/**
 * BaseBuilderQueueManager.ts — AI building queue optimization and placement
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/BaseBuilderQueueManager.cs
 *
 * 核心范式转换:
 * - C# sealed class BaseBuilderQueueManager (620 lines) → TypeScript class
 * - C# LINQ (Where, Count, ToArray, OrderBy, Shuffle, Take, MinByOrDefault, MaxByOrDefault, FirstOrDefault, Sum)
 *   → TypeScript for-loops (PERF: no LINQ)
 * - C# WaterCheck enum → TypeScript const object
 * - C# BuildingType enum → TypeScript const object
 * - C# ILookup<string, ProductionQueue> → TypeScript Map<string, ProdQueueLike[]>
 * - C# QueueOrder(Order.StartProduction(...)) → bot.queueOrder(orderData)
 * - C# ProductionQueue.AllQueued() → duck-typed
 * - C# World.CanPlaceBuilding → duck-typed world.canPlaceBuilding()
 * - C# MersenneTwister → SimplePrng
 *
 * Manages parallel build queues across multiple production structures,
 * prioritizing: power-critical > economy > defense > tech.
 */

import type { SimplePrng } from '../Squads/Squad.js'
import type { BaseBuilderBotModuleInfo } from '../BaseBuilderBotModule.js'
import { isqrt } from '../../../../OpenRA.Game/Exts.js'

// ---------------------------------------------------------------------------
// Enums (对应 OpenRA WaterCheck / BuildingType)
// ---------------------------------------------------------------------------

export const WaterCheck = {
  NotChecked: 0,
  EnoughWater: 1,
  NotEnoughWater: 2,
  DontCheck: 3,
} as const
export type WaterCheck = (typeof WaterCheck)[keyof typeof WaterCheck]

export const BuildingType = {
  Building: 0,
  Defense: 1,
  Refinery: 2,
} as const
export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType]

// ---------------------------------------------------------------------------
// BaseBuilderQueueManager
// ---------------------------------------------------------------------------

/**
 * Manages a single build queue category, deciding what to build and where.
 *
 * OpenRA 对照: sealed class BaseBuilderQueueManager
 *
 * Handles:
 * - Power-aware building selection
 * - Queue balancing across structures
 * - Wait state management
 * - Building placement location selection
 * - Expansion nudge logic
 * - Water / naval structure checking
 */
export class BaseBuilderQueueManager {
  /** The build category this manager handles. */
  readonly category: string

  /** Ticks to wait before next build attempt. */
  waitTicks: number = 0

  /** Reference to the owning BaseBuilderBotModule. */
  private readonly _baseBuilder: BaseBuilderLike

  /** Cached world reference. */
  private readonly _world: WorldLike

  /** Cached player reference. */
  private readonly _player: PlayerLike

  /** Power manager for excess power checks. */
  private readonly _playerPower: PowerManagerLike | null

  /** Player resources for cash checks. */
  private readonly _playerResources: PlayerResourcesLike

  /** Resource layer for refinery placement. */
  private readonly _resourceLayer: ResourceLayerLike | null

  /** Reference to the BaseBuilderBotModuleInfo. */
  private readonly _info: BaseBuilderBotModuleInfo

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  /** Cached array of player's buildings. */
  private _playerBuildings: ActorLike[] = []

  /** Consecutive placement failures. */
  private _failCount: number = 0

  /** Ticks until we can retry after failure. */
  private _failRetryTicks: number = 0

  /** Name of the last building that failed to place. */
  private _lastFailedBuilding: string = ''

  /** Ticks until we re-check for new base providers. */
  private _checkForBasesTicks: number = 0

  /** Cached base count for failure retry. */
  private _cachedBases: number = 0

  /** Cached building count for failure retry. */
  private _cachedBuildings: number = 0

  /** Current minimum excess power threshold. */
  private _minimumExcessPower: number

  /** Base center that keeps failing. */
  private _baseCenterKeepsFailing: { x: number; y: number } | null = null

  /** Whether we already queued an item this tick. */
  private _itemQueuedThisTick: boolean = false

  /** Water availability check state. */
  private _waterState: WaterCheck = WaterCheck.NotChecked

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    baseBuilder: BaseBuilderLike,
    category: string,
    p: PlayerLike,
    pm: PowerManagerLike | null,
    pr: PlayerResourcesLike,
    rl: ResourceLayerLike | null,
    info: BaseBuilderBotModuleInfo,
  ) {
    this._baseBuilder = baseBuilder
    this._world = (p as unknown as { world: WorldLike }).world
    this._player = p
    this._playerPower = pm
    this._playerResources = pr
    this._resourceLayer = rl
    this._info = info
    this.category = category
    this._minimumExcessPower = info.minimumExcessPower

    if (info.navalProductionTypes.size === 0) {
      this._waterState = WaterCheck.DontCheck
    }
  }

  // ---------------------------------------------------------------------------
  // Main tick (对应 OpenRA BaseBuilderQueueManager.Tick)
  // ---------------------------------------------------------------------------

  /**
   * Process one tick of the build queue.
   *
   * OpenRA 对照: BaseBuilderQueueManager.Tick(IBot, ILookup<string, ProductionQueue>)
   */
  tick(queuesByCategory: Map<string, ProdQueueLike[]>, worldRandom: SimplePrng): void {
    // If we can't place any structures, nudge expansion modules
    if (this._failCount >= this._info.maximumFailedPlacementAttempts) {
      if (this._baseBuilder.baseExpansionModules && this._baseCenterKeepsFailing) {
        if (!this._info.defenseTypes.has(this._lastFailedBuilding)) {
          // Find closest construction yard to the failing base center
          let stuckConyard: ActorLike | null = null
          let bestDistSq = 2147483647
          const cyards = this._baseBuilder.constructionYardBuildings?.actors ?? []
          for (const a of cyards) {
            const dx = a.location.x - this._baseCenterKeepsFailing.x
            const dy = a.location.y - this._baseCenterKeepsFailing.y
            const distSq = dx * dx + dy * dy
            if (distSq <= this._info.maxBaseRadius * this._info.maxBaseRadius && distSq < bestDistSq) {
              bestDistSq = distSq
              stuckConyard = a
            }
          }

          if (stuckConyard) {
            for (const be of this._baseBuilder.baseExpansionModules) {
              be.updateExpansionParams?.(null, false, true, stuckConyard?.actorId ?? 0)
            }
          }
        }
        this._failCount = 0
      } else if (!this._baseBuilder.baseExpansionModules && --this._failRetryTicks <= 0) {
        const currentBuildings = this.countPlayerBuildings()
        const baseProviders = this.countBaseProviders()
        if (currentBuildings < this._cachedBuildings || baseProviders > this._cachedBases) {
          this._failCount = 0
        } else {
          this._failRetryTicks = this._info.structureProductionResumeDelay
        }
      }

      if (this._failCount >= this._info.maximumFailedPlacementAttempts) return
    }

    // Water check logic
    if (this._waterState === WaterCheck.NotChecked) {
      if (this.isAreaAvailable('BaseProvider', this._info.maxBaseRadius, this._info.waterTerrainTypes)) {
        this._waterState = WaterCheck.EnoughWater
      } else {
        this._waterState = WaterCheck.NotEnoughWater
        this._checkForBasesTicks = this._info.checkForNewBasesDelay
      }
    }

    if (this._waterState === WaterCheck.NotEnoughWater && --this._checkForBasesTicks <= 0) {
      if (this.countBaseProviders() > this._cachedBases) {
        this._cachedBases = this.countBaseProviders()
        this._waterState = WaterCheck.NotChecked
      }
    }

    // Only update once per second or so
    if (this.waitTicks > 0) return

    this._playerBuildings = []
    for (const a of this._world.actors) {
      if (a.owner === this._player && a.buildingInfo) {
        this._playerBuildings.push(a)
      }
    }

    const excessPowerBonus =
      this._info.excessPowerIncrement *
      ((this._playerBuildings.length / Math.max(this._info.excessPowerIncreaseThreshold, 1)) | 0)

    this._minimumExcessPower = Math.max(
      this._info.minimumExcessPower,
      Math.min(
        this._minimumExcessPower + excessPowerBonus,
        this._info.maximumExcessPower,
      ),
    )

    // PERF: Queue only one actor at a time per category
    this._itemQueuedThisTick = false
    let active = false
    const queues = queuesByCategory.get(this.category) ?? []
    for (const queue of queues) {
      if (this.tickQueue(queue, worldRandom)) {
        active = true
      }
    }

    const randomFactor = worldRandom.nextIntRange(0, this._info.structureProductionRandomBonusDelay)
    this.waitTicks = active
      ? this._info.structureProductionActiveDelay + randomFactor
      : this._info.structureProductionInactiveDelay + randomFactor
  }

  // ---------------------------------------------------------------------------
  // TickQueue (对应 OpenRA BaseBuilderQueueManager.TickQueue)
  // ---------------------------------------------------------------------------

  private tickQueue(queue: ProdQueueLike, worldRandom: SimplePrng): boolean {
    const currentBuilding = queue.firstAllQueued?.()

    // Waiting to build something
    if (!currentBuilding && this._failCount < this._info.maximumFailedPlacementAttempts) {
      if (this._playerResources.getCashAndResources() < this._info.productionMinCashRequirement
        || this._itemQueuedThisTick) {
        return false
      }

      const item = this.chooseBuildingToBuild(queue, worldRandom)
      if (!item) return false

      queue.startProduction?.(item.name, 1)
      this._itemQueuedThisTick = true
    } else if (currentBuilding && currentBuilding.done) {
      // Production is complete — choose placement logic
      let type = this.getBuildingType(currentBuilding.name)
      let location: { x: number; y: number } | null = null
      let actorVariant = 0
      let orderString = 'PlaceBuilding'

      // Check if Building is a plug
      const actorInfo = this._world.map?.rules?.actors?.[currentBuilding.name]
      const plugInfo = actorInfo?.traitInfo?.('Plug') as PlugInfoLike | undefined

      if (plugInfo) {
        // Find a Pluggable building
        let possibleBuilding: { actor: ActorLike | null; trait: PluggableLike } = { actor: null, trait: null! }
        for (const a of this._world.actors) {
          if (a.owner === this._player) {
            const pluggable = a.traitsImplementing?.('Pluggable')?.[0] as PluggableLike | undefined
            if (pluggable?.acceptsPlug(plugInfo.type)) {
              possibleBuilding = { actor: a, trait: pluggable }
              break
            }
          }
        }

        if (possibleBuilding.actor) {
          orderString = 'PlacePlug'
          const offset = possibleBuilding.trait.info?.offset ?? { x: 0, y: 0 }
          location = {
            x: possibleBuilding.actor.location.x + offset.x,
            y: possibleBuilding.actor.location.y + offset.y,
          }
        }
      } else {
        if (this._info.defenseTypes.has(actorInfo?.name ?? '')
          && worldRandom.nextIntRange(0, 99) < this._info.placeDefenseTowardsEnemyChance) {
          type = BuildingType.Defense
        }

        const result = this.chooseBuildLocation(currentBuilding.name, true, type, worldRandom)
        location = result.location
        this._baseCenterKeepsFailing = result.baseCenter
        actorVariant = result.variant
      }

      if (!location) {
        if (++this._failCount >= this._info.maximumFailedPlacementAttempts) {
          // Cancel production
          queue.cancelProduction?.(currentBuilding.name, 1)
          this._lastFailedBuilding = currentBuilding.name
          if (!this._baseBuilder.baseExpansionModules) {
            this._cachedBuildings = this.countPlayerBuildings()
            this._cachedBases = this.countBaseProviders()
          }
        }
      } else {
        this._failCount = 0

        this._baseBuilder.queueOrderForBot?.({
          orderName: orderString,
          targetString: currentBuilding.name,
          extraLocation: { x: actorVariant, y: 0 },
          extraData: queue.actorId,
          suppressVisualFeedback: true,
          targetPosition: { x: location.x * 1024 + 512, y: location.y * 1024 + 512, z: 0 },
        })

        // Nudge expansion
        if (this._info.productionTypes.has(currentBuilding.name)
          || this._info.techTypes.has(currentBuilding.name)
          || this._info.refineryTypes.has(currentBuilding.name)) {

          const numRef = this._baseBuilder.refineryBuildingsCount() +
            (this._info.refineryTypes.has(currentBuilding.name) ? 1 : 0)
          const numProd = this._baseBuilder.productionBuildingsCount() +
            (this._info.productionTypes.has(currentBuilding.name) ? 1 : 0)
          let numTech = 0
          for (const b of this._playerBuildings) {
            if (this._info.techTypes.has(b.info?.name ?? '')) numTech++
          }
          if (this._info.techTypes.has(currentBuilding.name)) numTech++

          const tolerateOnCash = (this._playerResources.getCashAndResources()
            / Math.max(this._info.perExpansionTolerateOnCash, 1)) | 0

          if (numRef >= this._info.initialMinimumRefineryCount + this._info.additionalMinimumRefineryCount
            && numProd > 0
            && numProd + numTech - this.pickRandomTolerate(this._info.expansionTolerate, worldRandom) - tolerateOnCash >= numRef) {

            const undeployEvenNoBase = numProd + numTech
              - this.pickRandomTolerate(this._info.forceExpansionTolerate, worldRandom) - tolerateOnCash >= numRef

            for (const be of this._baseBuilder.baseExpansionModules ?? []) {
              be.updateExpansionParams?.(null, true, undeployEvenNoBase, null)
            }
          }
        }

        return true
      }
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // ChooseBuildingToBuild (对应 OpenRA ChooseBuildingToBuild)
  // ---------------------------------------------------------------------------

  private chooseBuildingToBuild(queue: ProdQueueLike, worldRandom: SimplePrng): { name: string } | null {
    const buildableThings = queue.buildableItems?.() ?? []
    if (buildableThings.length === 0) return null

    const buildableSet = new Set(buildableThings.map(b => b.name))

    // Cached power evaluation
    const power = this.getProducibleBuilding(
      this._info.powerTypes,
      buildableThings,
      (a) => {
        const powerInfos = a.traitInfos?.('Power') ?? []
        let sum = 0
        for (const p of powerInfos) {
          const pi = p as { enabledByDefault?: boolean; amount: number }
          if (pi.enabledByDefault !== false) sum += pi.amount
        }
        return sum
      },
    )

    // Low power priority
    if (this._playerPower && this._playerPower.excessPower < this._minimumExcessPower
      && power && this.sumPowerAmount(power) > 0) {
      return power
    }

    // Refinery priority
    if ((this._baseBuilder.requestedRefineriesCount?.() ?? 0) > 0
      || !(this._baseBuilder.hasAdequateRefineryCount?.() ?? true)) {
      const refinery = this.getProducibleBuilding(this._info.refineryTypes, buildableThings)
      if (refinery && this.hasSufficientPowerForActor(refinery)) return refinery
      if (power && refinery && !this.hasSufficientPowerForActor(refinery)) return power
    }

    // Production priority
    if (this._info.newProductionCashThreshold > 0
      && this._playerResources.getCashAndResources() > this._info.newProductionCashThreshold
      && worldRandom.nextIntRange(0, 99) < this._info.newProductionChance) {
      const production = this.getProducibleBuilding(this._info.productionTypes, buildableThings)
      if (production && this.hasSufficientPowerForActor(production)) return production
      if (power && production && !this.hasSufficientPowerForActor(production)) return power
    }

    // Naval production
    if (this._waterState === WaterCheck.EnoughWater
      && this._info.newProductionCashThreshold > 0
      && this._playerResources.getCashAndResources() > this._info.newProductionCashThreshold
      && this.isAreaAvailable('GivesBuildableArea', this._info.checkForWaterRadius, this._info.waterTerrainTypes)) {
      const navalProd = this.getProducibleBuilding(this._info.navalProductionTypes, buildableThings)
      if (navalProd && this.hasSufficientPowerForActor(navalProd)) return navalProd
      if (power && navalProd && !this.hasSufficientPowerForActor(navalProd)) return power
    }

    // Silo priority
    // 0.8 * capacity → integer: resources * 5 > capacity * 4
    if (this._playerResources.resources * 5 > this._playerResources.resourceCapacity * 4) {
      const silo = this.getProducibleBuilding(this._info.siloTypes, buildableThings)
      if (silo && this.hasSufficientPowerForActor(silo)) return silo
      if (power && silo && !this.hasSufficientPowerForActor(silo)) return power
    }

    // Building fractions — build by ratio
    const fractionEntries = this.shuffleFractionEntries(this._info.buildingFractions, worldRandom)
    for (const [name, frac] of fractionEntries) {
      // Delay check
      const delay = this._info.buildingDelays.get(name)
      if (delay !== undefined && delay > this._world.worldTick) continue

      if (!buildableSet.has(name)) continue

      const actorInfo = this._world.map?.rules?.actors?.[name]
      const variantInfo = actorInfo?.traitInfo?.('PlaceBuildingVariants') as { actors?: string[] } | undefined
      const variants = variantInfo?.actors ?? []

      let count = 0
      for (const b of this._playerBuildings) {
        const bn = b.info?.name ?? ''
        if (bn === name || variants.includes(bn)) count++
      }
      count += this._baseBuilder.buildingsBeingProducedCount?.(name) ?? 0

      if (count * 100 > frac * this._playerBuildings.length) continue

      const limit = this._info.buildingLimits.get(name)
      if (limit !== undefined && limit <= count) continue

      // Naval check
      if (this._info.navalProductionTypes.has(name)
        && (this._waterState === WaterCheck.NotEnoughWater
          || !this.isAreaAvailable('GivesBuildableArea', this._info.checkForWaterRadius, this._info.waterTerrainTypes))) {
        continue
      }

      const actor = this._world.map?.rules?.actors?.[name]
      if (this._playerPower
        && (this._playerPower.excessPower < this._minimumExcessPower
          || (actor && !this.hasSufficientPowerForActor(actor)))) {
        if (power && this.sumPowerAmount(power) > 0) return power
      }

      return actor ?? null
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Placement selection (对应 OpenRA ChooseBuildLocation)
  // ---------------------------------------------------------------------------

  private chooseBuildLocation(
    actorType: string,
    distanceToBaseIsImportant: boolean,
    type: BuildingType,
    worldRandom: SimplePrng,
  ): { location: { x: number; y: number } | null; baseCenter: { x: number; y: number } | null; variant: number } {
    const actorInfo = this._world.map?.rules?.actors?.[actorType]
    const bi = actorInfo?.traitInfo?.('Building') as BuildingInfoLike | undefined
    if (!bi) return { location: null, baseCenter: null, variant: 0 }

    const baseCenter = type === BuildingType.Defense
      ? this._baseBuilder.getDefenseBaseCenter?.() ?? this._baseBuilder.getRandomBaseCenter?.() ?? { x: 0, y: 0 }
      : this._baseBuilder.getRandomBaseCenter?.() ?? { x: 0, y: 0 }

    switch (type) {
      case BuildingType.Defense: {
        // Build near closest enemy
        let closestEnemy: ActorLike | null = null
        let bestDistSq = 2147483647
        for (const a of this._world.actors) {
          if (a.isDead || !a.isInWorld) continue
          if (this._player.relationshipWith?.(a.owner) !== 'Enemy') continue
          if (!a.info?.hasTraitInfo?.('Targetable')) continue

          const bcx = baseCenter.x * 1024 + 512
          const bcy = baseCenter.y * 1024 + 512
          const acx = a.centerPosition.x
          const acy = a.centerPosition.y
          const dx = acx - bcx
          const dy = acy - bcy
          const distSq = dx * dx + dy * dy
          if (distSq < bestDistSq) {
            bestDistSq = distSq
            closestEnemy = a
          }
        }

        const targetCell = closestEnemy ? closestEnemy.location : baseCenter
        return {
          ...this.findPos(actorType, baseCenter, targetCell,
            this._info.minBaseRadius, this._info.maxBaseRadius,
            this._info.tryMaintainDefenseRange, distanceToBaseIsImportant, worldRandom),
          baseCenter,
        }
      }

      case BuildingType.Refinery: {
        const requestRef = this._baseBuilder.getFirstRequestedRefinery?.()

        if (this._resourceLayer) {
          const resourceBaseCenter = this._failCount > 0 ? baseCenter
            : (requestRef
              ? this._baseBuilder.getRefineryConyard?.(requestRef)?.conyardLoc ?? baseCenter
              : (this._baseBuilder.resourceConyardCenter ?? baseCenter))

          const nearbyResources: { x: number; y: number }[] = []
          const cells = this._world.map?.findTilesInAnnulus?.(
            resourceBaseCenter, this._info.minBaseRadius, this._info.maxBaseRadius,
          ) ?? []

          for (const c of cells) {
            const resource = this._resourceLayer.getResource(c)
            if (this._baseBuilder.resourceMapModule) {
              const valTypes = this._baseBuilder.resourceMapModule.info.valuableResourceTypes
              if (resource.type && valTypes.has(resource.type)) {
                nearbyResources.push(c)
              }
            } else if (resource.type) {
              nearbyResources.push(c)
            }
          }

          let closestRefinery: ActorLike | null = null
          if (this._failCount <= 0) {
            const refineries = this._baseBuilder.refineryBuildings?.actors ?? []
            let bestRSq = 2147483647
            const rbCx = resourceBaseCenter.x * 1024 + 512
            const rbCy = resourceBaseCenter.y * 1024 + 512
            for (const r of refineries) {
              if (r.isDead) continue
              const dx = r.centerPosition.x - rbCx
              const dy = r.centerPosition.y - rbCy
              const distSq = dx * dx + dy * dy
              if (distSq < bestRSq) {
                bestRSq = distSq
                closestRefinery = r
              }
            }
          }

          let resourcesToCheck: { x: number; y: number }[]
          if (!closestRefinery) {
            resourcesToCheck = this.shuffleArray([...nearbyResources], worldRandom)
              .slice(0, this._info.maxResourceCellsToCheck)
          } else if (requestRef) {
            const refReq = this._baseBuilder.getRefineryConyard?.(requestRef)
            resourcesToCheck = [...nearbyResources]
            resourcesToCheck.sort((a, b) => {
              const rl = refReq?.resourceLoc ?? { x: 0, y: 0 }
              const da = (a.x - rl.x) * (a.x - rl.x) + (a.y - rl.y) * (a.y - rl.y)
              const db = (b.x - rl.x) * (b.x - rl.x) + (b.y - rl.y) * (b.y - rl.y)
              return da - db
            })
            resourcesToCheck = resourcesToCheck.slice(0, this._info.maxResourceCellsToCheck)
          } else {
            resourcesToCheck = [...nearbyResources]
            const crLoc = closestRefinery!.location
            resourcesToCheck.sort((a, b) => {
              const da = (a.x - crLoc.x) * (a.x - crLoc.x) + (a.y - crLoc.y) * (a.y - crLoc.y)
              const db = (b.x - crLoc.x) * (b.x - crLoc.x) + (b.y - crLoc.y) * (b.y - crLoc.y)
              return db - da // OrderByDescending
            })
            resourcesToCheck = resourcesToCheck.slice(0, this._info.maxResourceCellsToCheck)
          }

          for (const r of resourcesToCheck) {
            const found = this.findPos(actorType, resourceBaseCenter, r,
              this._info.minBaseRadius, this._info.maxBaseRadius,
              undefined, distanceToBaseIsImportant, worldRandom)
            if (found.location) {
              if (requestRef && this._baseBuilder.requestedRefineriesCount?.() > 0) {
                this._baseBuilder.removeRequestedRefinery?.(requestRef)
              }
              return { ...found, baseCenter }
            }
          }
        }

        if (requestRef && this._baseBuilder.requestedRefineriesCount?.() > 0) {
          this._baseBuilder.removeRequestedRefinery?.(requestRef)
        }

        return {
          ...this.findPos(actorType, baseCenter, baseCenter,
            this._info.minBaseRadius, this._info.maxBaseRadius,
            undefined, distanceToBaseIsImportant, worldRandom),
          baseCenter,
        }
      }

      case BuildingType.Building:
      default: {
        const maxRange = distanceToBaseIsImportant
          ? this._info.maxBaseRadius
          : (this._world.map?.grid?.maximumTileSearchRange ?? 256)
        return {
          ...this.findPos(actorType, baseCenter, baseCenter,
            this._info.minBaseRadius, maxRange,
            undefined, distanceToBaseIsImportant, worldRandom),
          baseCenter,
        }
      }
    }
  }

  private findPos(
    actorType: string,
    center: { x: number; y: number },
    target: { x: number; y: number },
    minRange: number,
    maxRange: number,
    _tryMaintainRange: number | undefined,
    distanceToBaseIsImportant: boolean,
    worldRandom: SimplePrng,
  ): { location: { x: number; y: number } | null; variant: number } {
    const actorInfo = this._world.map?.rules?.actors?.[actorType]
    const bi = actorInfo?.traitInfo?.('Building') as BuildingInfoLike | undefined
    if (!bi) return { location: null, variant: 0 }

    const cells = this._world.map?.findTilesInAnnulus?.(center, minRange, maxRange) ?? []
    let actorVariant = 0
    let variantActorInfo = actorInfo
    let vbi = bi

    const buildingVariantInfo = actorInfo?.traitInfo?.('PlaceBuildingVariants') as {
      actors?: string[]
      facings?: number[]
    } | undefined

    let sortedCells: { x: number; y: number }[]
    if (center.x !== target.x || center.y !== target.y) {
      // Sort by distance to target
      sortedCells = [...cells]
      sortedCells.sort((a, b) => {
        const da = (a.x - target.x) * (a.x - target.x) + (a.y - target.y) * (a.y - target.y)
        const db = (b.x - target.x) * (b.x - target.x) + (b.y - target.y) * (b.y - target.y)
        return da - db
      })
    } else {
      sortedCells = this.shuffleArray([...cells], worldRandom)
    }

    if (center.x !== target.x || center.y !== target.y) {
      if (buildingVariantInfo?.facings) {
        // Select variant based on facing angle
        const cx = target.x - center.x
        const cy = target.y - center.y
        // NOTE: integer sqrt for deterministic cross-platform behavior
        const length = isqrt(cx * cx + cy * cy)
        if (length > 0) {
          const facings = buildingVariantInfo.facings
          // Compute desireFacing using arcsin approximation for integer determinism
          const absCx = cx < 0 ? -cx : cx
          const arcsinApprox = absCx * 1024 / length
          let desireFacingAngle = this.wAngleArcSin(arcsinApprox)

          if (cx > 0 && cy >= 0) desireFacingAngle = 512 - desireFacingAngle
          else if (cx < 0 && cy >= 0) desireFacingAngle = 512 + desireFacingAngle
          else if (cx < 0 && cy < 0) desireFacingAngle = -desireFacingAngle

          let minDelta = 1024
          for (let i = 0; i < facings.length; i++) {
            const delta = Math.min(
              Math.abs(desireFacingAngle - facings[i]),
              Math.abs(facings[i] - desireFacingAngle),
            )
            if (minDelta > delta) {
              minDelta = delta
              actorVariant = i
            }
          }
        }
      } else if (buildingVariantInfo?.actors) {
        actorVariant = worldRandom.nextIntRange(0, buildingVariantInfo.actors.length)
      }
    } else {
      if (buildingVariantInfo?.actors) {
        actorVariant = worldRandom.nextIntRange(0, buildingVariantInfo.actors.length)
      }
    }

    // Apply variant
    if (actorVariant !== 0 && buildingVariantInfo?.actors) {
      const variantName = buildingVariantInfo.actors[actorVariant - 1]
      variantActorInfo = this._world.map?.rules?.actors?.[variantName]
      vbi = (variantActorInfo?.traitInfo?.('Building') ?? bi) as BuildingInfoLike
    }

    // Find first placeable cell
    for (const cell of sortedCells) {
      if (this._world.canPlaceBuilding?.(cell, variantActorInfo, vbi!, null)) {
        if (distanceToBaseIsImportant && !(vbi as unknown as { isCloseEnoughToBase?: (world: unknown, player: unknown, info: unknown, cell: unknown) => boolean })?.isCloseEnoughToBase?.(this._world, this._player, variantActorInfo, cell)) {
          continue
        }
        return { location: cell, variant: actorVariant }
      }
    }

    return { location: null, variant: 0 }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private hasSufficientPowerForActor(actorInfo: { traitInfos?: (name: string) => unknown[] }): boolean {
    if (!this._playerPower) return true
    const powerInfos = actorInfo.traitInfos?.('Power') ?? []
    let sum = 0
    for (const p of powerInfos) {
      const pi = p as { enabledByDefault?: boolean; amount: number }
      if (pi.enabledByDefault !== false) sum += pi.amount
    }
    return sum + this._playerPower.excessPower >= this._minimumExcessPower
  }

  private sumPowerAmount(actorInfo: { traitInfos?: (name: string) => unknown[] }): number {
    const powerInfos = actorInfo.traitInfos?.('Power') ?? []
    let sum = 0
    for (const p of powerInfos) {
      const pi = p as { enabledByDefault?: boolean; amount: number }
      if (pi.enabledByDefault !== false) sum += pi.amount
    }
    return sum
  }

  private getProducibleBuilding(
    types: ReadonlySet<string>,
    buildables: readonly { name: string; traitInfos?: (name: string) => unknown[] }[],
    orderBy?: (a: { name: string; traitInfos?: (name: string) => unknown[] }) => number,
  ): { name: string; traitInfos?: (name: string) => unknown[] } | null {
    const available = buildables.filter(actor => {
      if (!types.has(actor.name)) return false
      const limit = this._info.buildingLimits.get(actor.name)
      if (limit === undefined) return true

      let count = 0
      for (const b of this._playerBuildings) {
        if ((b.info?.name ?? '') === actor.name) count++
      }
      return count < limit
    })

    if (available.length === 0) return null

    if (orderBy) {
      let best: typeof available[0] | null = null
      let bestVal = -2147483648
      for (const a of available) {
        const val = orderBy(a)
        if (val > bestVal) {
          bestVal = val
          best = a
        }
      }
      return best
    }

    return available.length > 0 ? available[0] : null
  }

  private countPlayerBuildings(): number {
    let count = 0
    for (const a of this._world.actors) {
      if (a.owner === this._player && a.buildingInfo) count++
    }
    return count
  }

  private countBaseProviders(): number {
    let count = 0
    for (const a of this._world.actors) {
      if (a.owner === this._player && !a.isDead && a.isInWorld
        && a.info?.hasTraitInfo?.('BaseProvider')) count++
    }
    return count
  }

  // NOTE: traitName is for future use when duck-typing actors by trait.
  private isAreaAvailable(_traitName: string, radius: number, terrainTypes: ReadonlySet<string>): boolean {
    // Duck-type: check if any actors with given trait exist within radius of base
    const baseCenter = this._baseBuilder.getRandomBaseCenter?.() ?? { x: 0, y: 0 }
    const cells = this._world.map?.findTilesInAnnulus?.(baseCenter, 0, radius) ?? []

    for (const c of cells) {
      // Check terrain types at cell
      const terrain = this._world.map?.getTerrainType?.(c)
      if (terrain && terrainTypes.has(terrain)) {
        return true
      }
    }
    return false
  }

  private getBuildingType(name: string): BuildingType {
    if (this._info.defenseTypes.has(name)) return BuildingType.Defense
    if (this._info.refineryTypes.has(name)) return BuildingType.Refinery
    return BuildingType.Building
  }

  private shuffleFractionEntries(
    map: ReadonlyMap<string, number>,
    worldRandom: SimplePrng,
  ): [string, number][] {
    const entries: [string, number][] = []
    for (const [k, v] of map) entries.push([k, v])
    return this.shuffleArray(entries, worldRandom)
  }

  private shuffleArray<T>(arr: T[], worldRandom: SimplePrng): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = worldRandom.nextIntRange(0, i)
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    return arr
  }

  private pickRandomTolerate(arr: readonly number[], worldRandom: SimplePrng): number {
    if (arr.length === 0) return 0
    return arr[worldRandom.nextIntRange(0, arr.length - 1)]
  }

  private wAngleArcSin(value: number): number {
    // Integer arcsin approximation for facing calculations
    // Returns angle in 1024ths of a circle
    const clamped = Math.max(0, Math.min(1024, value))
    // Lookup-table-like approximation
    if (clamped <= 383) return clamped // linear for small angles
    if (clamped <= 707) return 383 + ((clamped - 383) * 129 / 324) | 0
    if (clamped <= 923) return 512 + ((clamped - 707) * 129 / 216) | 0
    return 641 + ((clamped - 923) * 383 / 101) | 0
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._playerBuildings = []
  }
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

interface ActorLike {
  readonly actorId: number
  readonly isDead: boolean
  readonly isInWorld: boolean
  readonly location: { x: number; y: number }
  readonly centerPosition: { x: number; y: number; z: number }
  readonly owner: PlayerLike
  readonly info?: {
    readonly name: string
    hasTraitInfo?: (name: string) => boolean
  }
  readonly buildingInfo?: unknown
  traitsImplementing?: <T>(name: string) => T[]
}

interface PlayerLike {
  readonly playerName?: string
  relationshipWith?(other: unknown): string
}

interface WorldLike {
  readonly worldTick: number
  readonly actors: Iterable<ActorLike>
  map?: {
    readonly grid?: { readonly maximumTileSearchRange: number }
    readonly rules?: { actors?: Record<string, ActorInfoLike> }
    findTilesInAnnulus?: (center: { x: number; y: number }, minRange: number, maxRange: number) => { x: number; y: number }[]
    getTerrainType?: (cell: { x: number; y: number }) => string | null
  }
  canPlaceBuilding?: (cell: { x: number; y: number }, actorInfo: unknown, buildingInfo: unknown, init: unknown) => boolean
}

interface ActorInfoLike {
  readonly name: string
  traitInfo?: (name: string) => unknown
  traitInfos?: <T>(name: string) => T[]
}

interface BuildingInfoLike {
  // Marker
}

interface PowerManagerLike {
  readonly excessPower: number
}

interface PlayerResourcesLike {
  getCashAndResources(): number
  readonly resources: number
  readonly resourceCapacity: number
}

interface ResourceLayerLike {
  getResource(cell: { x: number; y: number }): { type: string | null }
}

interface ProdQueueLike {
  readonly actorId: number
  firstAllQueued?: () => { name: string; done: boolean } | null
  buildableItems?: () => { name: string; traitInfos?: (name: string) => unknown[] }[]
  startProduction?: (name: string, count: number) => void
  cancelProduction?: (name: string, count: number) => void
}

interface PlugInfoLike {
  readonly type: string
}

interface PluggableLike {
  readonly info?: { readonly offset: { x: number; y: number } }
  acceptsPlug(type: string): boolean
}

interface BaseBuilderLike {
  readonly baseExpansionModules: { updateExpansionParams?: (bot: unknown, fallback: boolean, undeployEvenNoBase: boolean, mustUndeploy: number | null) => void }[] | null
  readonly constructionYardBuildings?: { actors: ActorLike[] }
  readonly refineryBuildings?: { actors: ActorLike[] }
  readonly productionBuildings?: { actors: ActorLike[] }
  readonly resourceConyardCenter: { x: number; y: number } | null
  readonly resourceMapModule: { info: { valuableResourceTypes: ReadonlySet<string> } } | null
  getRandomBaseCenter(): { x: number; y: number }
  getDefenseBaseCenter(): { x: number; y: number }
  refineryBuildingsCount(): number
  productionBuildingsCount(): number
  requestedRefineriesCount(): number
  getFirstRequestedRefinery(): string | null
  getRefineryConyard?(ref: string): { conyardLoc: { x: number; y: number }; resourceLoc: { x: number; y: number } }
  removeRequestedRefinery(ref: string): void
  hasAdequateRefineryCount(): boolean
  buildingsBeingProducedCount(name: string): number
  queueOrderForBot?(order: unknown): void
}
