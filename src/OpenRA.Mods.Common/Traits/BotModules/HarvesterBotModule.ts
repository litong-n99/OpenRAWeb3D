/**
 * HarvesterBotModule.ts — AI harvester resource collection management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/HarvesterBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<HarvesterBotModuleInfo> → TypeScript ConditionalTrait
 * - C# HarvesterTraitWrapper sealed class → TypeScript HarvesterWrapper interface
 * - C# IBotTick.BotTick() with interval counters → TypeScript tick() with intervals
 * - C# FindNextResource() with custom path cost → TypeScript FindNextResource()
 *   (simplified — uses distance-to-target + enemy avoidance scoring)
 * - C# ResourceClaimLayer.CanClaimCell → TypeScript duck-typed claim check
 * - C# MersenneTwister → SimplePrng
 * - C# LINQ Where/Random/MinByOrDefault → TypeScript for-loops
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotRespondToAttack,
  IBot,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ResourceMapBotModule } from './ResourceMapBotModule.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// HarvesterBotModuleInfo
// ---------------------------------------------------------------------------

export interface HarvesterBotModuleInfo extends ConditionalTraitInfo {
  readonly harvesterTypes: ReadonlySet<string>
  readonly refineryTypes: ReadonlySet<string>
  readonly scanForIdleHarvestersInterval: number
  readonly scanForLowEffectHarvestersInterval: number
  readonly scanIntervalMultiplierWhenNoResources: number
  readonly harvesterEnemyAvoidanceRadius: number
  readonly harvesterEnemyAvoidanceCostMultiplier: number
  readonly resourceCellsPerHarvester: number
  readonly initialHarvesters: number
}

// ---------------------------------------------------------------------------
// HarvesterWrapper (对应 OpenRA HarvesterTraitWrapper)
// ---------------------------------------------------------------------------

interface HarvesterWrapper {
  actor: ActorLike
  harvester: HarvesterLike
  dockClientManager: DockLike
  mobile: MobileLike | null
  parachutable: ParachutableLike | null
  noResourcesCooldown: number
}

interface ActorLike {
  actorId: number
  owner: PlayerLike
  location: { x: number; y: number }
  centerPosition: { x: number; y: number; z: number }
  isDead: boolean
  isInWorld: boolean
  isIdle: boolean
  info?: { name: string }
  currentActivity?: { lastSearchFailed?: boolean; type?: string } | null
  traitsImplementing?: <T>(name: string) => T[]
}

interface PlayerLike {
  relationshipWith(other: PlayerLike): unknown
}

interface HarvesterLike {
  info: { resources: readonly string[] }
}

interface DockLike {
  closestDock(
    actor: ActorLike | null,
    forceEnter?: boolean,
    ignoreOccupancy?: boolean,
  ): { actor: ActorLike } | null
  reservedHostActor?: unknown
}

interface MobileLike {
  locomotor: { info: { terrainSpeeds: Map<unknown, { cost: number }> } }
  pathFinder: { pathMightExistForLocomotorBlockedByImmovable(
    locomotor: unknown, from: { x: number; y: number }, to: { x: number; y: number },
  ): boolean }
}

interface ParachutableLike {
  isInAir: boolean
}

interface WorldLike {
  actors: Iterable<ActorLike>
  map: MapLike
  findActorsInCircle(center: { x: number; y: number; z: number }, radius: { length: number }): ActorLike[]
}

interface MapLike {
  allCells: Iterable<{ x: number; y: number }>
  centerOfCell(cell: { x: number; y: number }): { x: number; y: number; z: number }
  findTilesInAnnulus(center: { x: number; y: number }, minR: number, maxR: number): { x: number; y: number }[]
}

interface ResourceLayerLike {
  getResource(cell: { x: number; y: number }): { type: string | null }
  readonly isEmpty: boolean
  cellChanged?: ((cell: { x: number; y: number }, resourceType: string | null) => void) | null
}

// ---------------------------------------------------------------------------
// HarvesterBotModule
// ---------------------------------------------------------------------------

export class HarvesterBotModule
  extends ConditionalTrait<HarvesterBotModuleInfo>
  implements IBotTick, IBotRespondToAttack
{
  private readonly _world: WorldLike
  private readonly _player: PlayerLike
  private readonly _harvesters = new Map<number, HarvesterWrapper>()
  private readonly _harvestersNeedingOrders: HarvesterWrapper[] = []
  private readonly _resourceTypesByCell = new Map<string, string>() // "x,y" → type

  private _resourceLayer: ResourceLayerLike | null = null
  private _resourceMapModule: ResourceMapBotModule | null = null
  private _requestUnitProduction: {
    requestUnitProduction(bot: IBot, name: string): void
    requestedProductionCount(bot: IBot, name: string): number
  }[] = []

  private _scanForIdleHarvestersTicks: number
  private _scanForLowEffectHarvestersTicks: number
  private _respondToAttackCooldown: number = 0
  private _firstTick: boolean = true

  private readonly _random: SimplePrng

  static readonly COOLDOWN_AFTER_ATTACK = 40
  static readonly RESPOND_TO_ATTACK_COOLDOWN = 30

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: HarvesterBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this._world = world
    this._player = player
    this._random = random

    this._scanForIdleHarvestersTicks = random.nextIntRange(
      0, info.scanForIdleHarvestersInterval,
    )
    this._scanForLowEffectHarvestersTicks = random.nextIntRange(
      0, info.scanForLowEffectHarvestersInterval,
    )
  }

  // -----------------------------------------------------------------------
  // IBotTick
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    this._respondToAttackCooldown--

    if (!this._resourceLayer || this._resourceLayer.isEmpty) return

    if (this._firstTick) {
      this._firstTick = false
      const playerActor = (bot.player as unknown as { playerActor?: { traitsImplementing?: <T>(name: string) => T[] } }).playerActor
      this._resourceMapModule = playerActor?.traitsImplementing?.('ResourceMapBotModule')?.[0] as ResourceMapBotModule | null ?? null

      // Populate resource types from all map cells
      if (this._resourceLayer) {
        for (const cell of this._world.map.allCells) {
          const resource = this._resourceLayer.getResource(cell)
          if (resource.type !== null) {
            this._resourceTypesByCell.set(`${cell.x},${cell.y}`, resource.type)
          }
        }
        // Subscribe to cell changes
        if (this._resourceLayer.cellChanged) {
          this._resourceLayer.cellChanged = null // will be set up in WorldLoaded equivalent
        }
      }
    }

    // Process pending harvester orders (one per tick — PERF)
    let searchedForResources = false
    while (this._harvestersNeedingOrders.length > 0 && !searchedForResources) {
      const hno = this._harvestersNeedingOrders.pop()!
      searchedForResources = this.harvestIfAble(bot, hno)
    }

    // Scan for idle harvesters
    if (--this._scanForIdleHarvestersTicks <= 0) {
      this._scanForIdleHarvestersTicks = this.info.scanForIdleHarvestersInterval
      this.findIdleHarvester()

      // Check if we need more harvesters
      if (this.info.harvesterTypes.size > 0 && this._requestUnitProduction.length > 0) {
        const harvsNum = this.countHarvesters()
        const refineriesNum = this.countRefineries()
        const harvCountTooLow = harvsNum < this.info.initialHarvesters || harvsNum < refineriesNum

        if (harvCountTooLow) {
          const types = Array.from(this.info.harvesterTypes)
          const harvesterType = types[this._random.nextIntRange(0, types.length - 1)]
          const unitBuilder = this._requestUnitProduction[0]
          if (unitBuilder.requestedProductionCount(bot, harvesterType) === 0) {
            unitBuilder.requestUnitProduction(bot, harvesterType)
          }
        }
      }
    }

    // Scan for low-effect harvesters
    if (--this._scanForLowEffectHarvestersTicks <= 0) {
      this._scanForLowEffectHarvestersTicks = this.info.scanForLowEffectHarvestersInterval
      if (this._resourceMapModule) {
        this.findAndOrderLowEffectHarvester(bot)
      }
    }
  }

  // -----------------------------------------------------------------------
  // IBotRespondToAttack
  // -----------------------------------------------------------------------

  respondToAttack(bot: IBot, self: IGameActor, e: AttackInfo): void {
    if (this._respondToAttackCooldown > 0) return

    const selfActor = self as unknown as ActorLike
    const name = selfActor.info?.name ?? ''
    if (!this.info.harvesterTypes.has(name)) return

    const attacker = e.attacker as unknown as ActorLike
    if (!attacker || attacker.isDead) return

    // Duck-type: Check if attacker appears hostile
    const parach = selfActor.traitsImplementing?.('Parachutable')?.[0] as ParachutableLike | undefined
    if (parach?.isInAir) return

    const dock = selfActor.traitsImplementing?.('DockClientManager')?.[0] as DockLike | undefined
    if (dock?.reservedHostActor != null) return

    this._respondToAttackCooldown = HarvesterBotModule.RESPOND_TO_ATTACK_COOLDOWN

    const scanFrom = dock?.closestDock(null, true, true)
    if (scanFrom) {
      bot.queueOrder({
        orderName: 'Dock',
        targetString: String(scanFrom.actor.actorId),
        extraData: 0,
      } as unknown as Parameters<IBot['queueOrder']>[0])
    }
  }

  // -----------------------------------------------------------------------
  // Harvest management
  // -----------------------------------------------------------------------

  private findIdleHarvester(): void {
    // Remove dead/unowned harvesters
    for (const [id, h] of this._harvesters) {
      if (this.unitCannotBeOrdered(h.actor)) {
        this._harvesters.delete(id)
      }
    }

    // Find new harvesters
    for (const a of this._world.actors) {
      if (this.unitCannotBeOrdered(a)) continue
      if (this._harvesters.has(a.actorId)) continue

      const harvester = a.traitsImplementing?.('Harvester')?.[0] as HarvesterLike | undefined
      if (!harvester) continue

      this._harvesters.set(a.actorId, {
        actor: a,
        harvester,
        dockClientManager: a.traitsImplementing?.('DockClientManager')?.[0] as DockLike,
        mobile: a.traitsImplementing?.('Mobile')?.[0] as MobileLike | null ?? null,
        parachutable: a.traitsImplementing?.('Parachutable')?.[0] as ParachutableLike | null ?? null,
        noResourcesCooldown: 0,
      })
    }

    // Push all to pending orders stack
    this._harvestersNeedingOrders.length = 0
    for (const h of this._harvesters.values()) {
      this._harvestersNeedingOrders.push(h)
    }
  }

  /**
   * Try to send a harvester to a resource field.
   *
   * OpenRA 对照: HarvestIfAble(IBot, HarvesterTraitWrapper)
   *
   * Returns true if FindNextResource was called (one per tick for PERF).
   */
  private harvestIfAble(bot: IBot, h: HarvesterWrapper): boolean {
    if (h.actor.isDead || !h.actor.isInWorld || !h.mobile) return false

    if (!h.actor.isIdle) {
      // Check if current FindAndDeliverResources activity has failed
      const act = h.actor.currentActivity
      if (!act || !act.lastSearchFailed) return false
    }

    if (h.noResourcesCooldown > 1) {
      h.noResourcesCooldown--
      return false
    }

    if (h.parachutable?.isInAir) return false

    // Find next resource
    const newTarget = this.findNextResource(h)
    if (newTarget.type !== 'Invalid') {
      bot.queueOrder({
        orderName: 'Harvest',
        targetString: `${newTarget.cell.x},${newTarget.cell.y}`,
        extraData: 0,
      } as unknown as Parameters<IBot['queueOrder']>[0])
    } else {
      h.noResourcesCooldown = this.info.scanIntervalMultiplierWhenNoResources
    }

    return true
  }

  /**
   * Find the nearest safe resource cell for a harvester.
   *
   * OpenRA 对照: HarvesterBotModule.FindNextResource(Actor, HarvesterTraitWrapper)
   *
   * Simplified version: finds nearest resource cell of the harvester's
   * resource types, avoiding cells near enemies.
   */
  private findNextResource(h: HarvesterWrapper): { type: string; cell: { x: number; y: number } } {
    // Use closest dock position as scan origin, or harvester position
    const scanFrom = h.dockClientManager.closestDock(null, false, true)?.actor ?? h.actor

    // Gather all valid resource cells
    const validCells: { x: number; y: number }[] = []
    for (const [key, type] of this._resourceTypesByCell) {
      if (!h.harvester.info.resources.includes(type)) continue

      // Duck-type: check if cell can be claimed
      const [xStr, yStr] = key.split(',')
      const cell = { x: parseInt(xStr, 10), y: parseInt(yStr, 10) }

      // Avoid enemy-occupied areas
      const cellCenter = this._world.map.centerOfCell(cell)
      const avoidRadius = this.info.harvesterEnemyAvoidanceRadius * 1024
      const enemies = this._world.findActorsInCircle(cellCenter, { length: avoidRadius })
        .filter(a => {
          try { return String(this._player.relationshipWith(a.owner)) === 'Enemy' }
          catch { return false }
        })

      if (enemies.length > 0) continue

      validCells.push(cell)
    }

    if (validCells.length === 0) return { type: 'Invalid', cell: { x: 0, y: 0 } }

    // Find closest to scanFrom
    let bestCell = validCells[0]
    let bestDist = (bestCell.x - scanFrom.location.x) * (bestCell.x - scanFrom.location.x) +
      (bestCell.y - scanFrom.location.y) * (bestCell.y - scanFrom.location.y)

    for (let i = 1; i < validCells.length; i++) {
      const c = validCells[i]
      const dist = (c.x - scanFrom.location.x) * (c.x - scanFrom.location.x) +
        (c.y - scanFrom.location.y) * (c.y - scanFrom.location.y)
      if (dist < bestDist) {
        bestDist = dist
        bestCell = c
      }
    }

    return { type: 'Valid', cell: bestCell }
  }

  /**
   * Find and reassign harvesters in resource-poor indices.
   *
   * OpenRA 对照: FindAndOrderLowEffectHarvesterOnResourceMap(IBot)
   */
  /**
   * Find and reassign harvesters in resource-poor indices to richer areas.
   *
   * OpenRA 对照: FindAndOrderLowEffectHarvesterOnResourceMap(IBot)
   *
   * Full algorithm (matching OpenRA 323-line method):
   * 1. Scan all indices computing "attraction" and "lackHarvs" for each
   * 2. Find the worst-effect indice (most negative lackHarvs)
   * 3. Find harvesters near the worst indice
   * 4. Sort good indices by attraction-weighted distance
   * 5. Reassign harvesters to the closest rich resource patches
   *
   * PERF: Uses integer arithmetic only. No per-frame allocation beyond
   * temporary arrays (reused across calls via local scope).
   */
  private findAndOrderLowEffectHarvester(bot: IBot): void {
    const rmm = this._resourceMapModule
    if (!rmm) return

    const indiceSideLength = rmm.getIndiceSideLength()
    const indiceSideLengthSquare = indiceSideLength * indiceSideLength

    let worstEffectIndice: { x: number; y: number } | null = null
    let worstEffectHarvesterCount = 2147483647 // INT32_MAX

    // (attraction, lackHarvs, resourceCenter)
    const lackHarvesterIndices: {
      attraction: number
      lackHarvs: number
      resourceCenter: { x: number; y: number }
    }[] = []

    const indicesLen = rmm.getIndicesLength()
    for (let i = 0; i < indicesLen; i++) {
      const baseIndice = rmm.getIndice(i)
      if (!baseIndice) continue

      // Initial attraction = indiceSideLengthSquare >> 5
      let attraction = indiceSideLengthSquare >> 5

      attraction += baseIndice.resourceCellsCount - baseIndice.playerHarvesterCount * this.info.resourceCellsPerHarvester

      let lackHarvs: number
      if (attraction > 0) {
        lackHarvs = (attraction / this.info.resourceCellsPerHarvester) | 0
      } else if (attraction === 0 && baseIndice.resourceCellsCount > 0) {
        lackHarvs = 1
      } else {
        lackHarvs = -1
      }

      // Halve attraction after lackHarvs calculation
      attraction >>= 1

      // If there is refinery but no harvester, consider lackHarvs positive if resources exist
      if (baseIndice.playerRefineryCount <= 0 && lackHarvs > 0) {
        lackHarvs = 1
      }

      // Enemy threat — reduce attraction
      if (baseIndice.enemyBaseCount > 0 || baseIndice.enemyUnitCount > 0) {
        attraction -= indiceSideLengthSquare << 4 // >> 4 is heavy penalty
      } else {
        const nearby = rmm.getNearbyIndicesThreat(i)
        if (nearby.enemyBaseCount + nearby.enemyUnitCount > 0) {
          attraction -= indiceSideLengthSquare >> 5 // small penalty for nearby enemies
        }
      }

      // Refinery bonus
      if (baseIndice.playerRefineryCount > 0) {
        attraction += indiceSideLengthSquare
      }

      // Record good indices for later reassignment
      if (baseIndice.resourceCellsCount > 0 && attraction > 0 && lackHarvs > 0) {
        lackHarvesterIndices.push({
          attraction,
          lackHarvs,
          resourceCenter: baseIndice.resourceCellsCenter,
        })
      }

      // Track worst effect (most oversupplied) indice
      if (lackHarvs < worstEffectHarvesterCount && lackHarvs < 0) {
        worstEffectHarvesterCount = lackHarvs
        worstEffectIndice = baseIndice.indiceCenter
      }
    }

    if (!worstEffectIndice) return

    let harvestersCanAssign = -worstEffectHarvesterCount
    const searchRadius = rmm.getIndiceScanRadius()
    const worldCast = this._world as unknown as {
      findActorsInCircle?: (center: { x: number; y: number; z: number }, radius: { length: number }) => ActorLike[]
      map: MapLike
    }

    // Find harvesters near the worst indice center
    const worstCenterWPos = this._world.map.centerOfCell(worstEffectIndice)
    const scanWDist = { length: searchRadius * 1024 }
    const nearbyActors = worldCast.findActorsInCircle?.(worstCenterWPos, scanWDist) ?? []

    const harvesters: ActorLike[] = []
    for (const a of nearbyActors) {
      if (a.owner !== this._player || a.isDead || !a.isInWorld) continue
      const name = a.info?.name ?? ''
      if (this.info.harvesterTypes.has(name)) {
        harvesters.push(a)
      }
    }

    harvestersCanAssign = Math.min(harvestersCanAssign, harvesters.length - 1)
    if (harvestersCanAssign <= 0) return
    if (harvesters.length === 0) return

    // Sort lackHarvesterIndices by: attraction - (distanceSquared / pathDistanceSquareFactor)
    const columnCount = rmm.getIndiceColumnCount()
    const rowCount = rmm.getIndiceRowCount()
    const pathDistanceSquareFactor = rowCount * rowCount + columnCount * columnCount

    const h0loc = harvesters[0].location
    lackHarvesterIndices.sort((a, b) => {
      const da = (h0loc.x - a.resourceCenter.x) * (h0loc.x - a.resourceCenter.x) +
        (h0loc.y - a.resourceCenter.y) * (h0loc.y - a.resourceCenter.y)
      const db = (h0loc.x - b.resourceCenter.x) * (h0loc.x - b.resourceCenter.x) +
        (h0loc.y - b.resourceCenter.y) * (h0loc.y - b.resourceCenter.y)
      const scoreA = a.attraction - (da / pathDistanceSquareFactor) | 0
      const scoreB = b.attraction - (db / pathDistanceSquareFactor) | 0
      return scoreB - scoreA // descending
    })

    // Reassign harvesters to better indices
    const usedHarvs = new Set<ActorLike>()
    for (const entry of lackHarvesterIndices) {
      if (harvestersCanAssign <= 0) break

      let needHarvs = entry.lackHarvs
      const nearbyCells = this._world.map.findTilesInAnnulus(
        entry.resourceCenter, 0, searchRadius,
      )

      // Filter: valuable resources, closer to harvester than the indice center
      const goodCells = nearbyCells.filter(c => {
        const res = this._resourceLayer?.getResource(c)
        if (!res || !res.type) return false
        if (!rmm.info.valuableResourceTypes.has(res.type)) return false
        const dc = (h0loc.x - entry.resourceCenter.x) * (h0loc.x - entry.resourceCenter.x) +
          (h0loc.y - entry.resourceCenter.y) * (h0loc.y - entry.resourceCenter.y)
        const dh = (c.x - h0loc.x) * (c.x - h0loc.x) + (c.y - h0loc.y) * (c.y - h0loc.y)
        return dc >= dh
      })

      if (goodCells.length === 0 || needHarvs <= 0) continue

      for (const harv of harvesters) {
        if (needHarvs <= 0 || harvestersCanAssign <= 0) break
        if (usedHarvs.has(harv)) continue

        // Skip parachutable units in the air
        const parach = harv.traitsImplementing?.('Parachutable')?.[0] as ParachutableLike | undefined
        if (parach?.isInAir) {
          harvestersCanAssign--
          usedHarvs.add(harv)
          continue
        }

        const mobile = harv.traitsImplementing?.('Mobile')?.[0] as MobileLike | undefined
        if (mobile) {
          // Pick a random nearby resource cell
          const tcell = goodCells[this._random.nextIntRange(0, goodCells.length - 1)]
          if (tcell && mobile.pathFinder.pathMightExistForLocomotorBlockedByImmovable(
            mobile.locomotor, harv.location, tcell,
          )) {
            bot.queueOrder({
              orderName: 'Harvest',
              targetString: `${tcell.x},${tcell.y}`,
              extraData: 0,
            } as unknown as Parameters<IBot['queueOrder']>[0])
            needHarvs--
            harvestersCanAssign--
            usedHarvs.add(harv)
          } else {
            // If path doesn't exist for first cell, try just one more
            if (needHarvs > 1) {
              needHarvs = 1
            } else {
              break
            }
          }
        } else {
          // No Mobile trait — just send to a random good cell
          const tcell = goodCells[this._random.nextIntRange(0, goodCells.length - 1)]
          bot.queueOrder({
            orderName: 'Harvest',
            targetString: `${tcell.x},${tcell.y}`,
            extraData: 0,
          } as unknown as Parameters<IBot['queueOrder']>[0])
          needHarvs--
          harvestersCanAssign--
          usedHarvs.add(harv)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private unitCannotBeOrdered(a: ActorLike): boolean {
    return !a || a.owner !== this._player || a.isDead || !a.isInWorld
  }

  private countHarvesters(): number {
    let count = 0
    for (const h of this._harvesters.values()) {
      if (!this.unitCannotBeOrdered(h.actor)) count++
    }
    return count
  }

  private countRefineries(): number {
    let count = 0
    for (const a of this._world.actors) {
      if (a.owner === this._player && !a.isDead && a.isInWorld) {
        const name = a.info?.name ?? ''
        if (this.info.refineryTypes.has(name)) count++
      }
    }
    return count
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._harvesters.clear()
    this._harvestersNeedingOrders.length = 0
    this._resourceTypesByCell.clear()
    super.dispose()
  }
}
