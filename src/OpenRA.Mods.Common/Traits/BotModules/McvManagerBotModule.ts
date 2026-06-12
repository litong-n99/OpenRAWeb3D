/**
 * McvManagerBotModule.ts — AI MCV production and deployment management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/McvManagerBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<McvManagerBotModuleInfo> → TypeScript ConditionalTrait
 * - C# ActorIndex.OwnerAndNamesAndTrait → duck-typed actor lists
 * - C# TransformsInfo / BuildingInfo → duck-typed trait lookups
 * - C# World.CanPlaceBuilding → duck-typed world.canPlaceBuilding()
 * - C# FindTilesInAnnulus + OrderBy → duck-typed + manual sort
 * - C# MersenneTwister → SimplePrng
 *
 * Manages Mobile Construction Vehicles — decides when to produce them,
 * where to deploy them, and how to maintain base presence.
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotPositionsUpdated,
  IBot,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// McvManagerBotModuleInfo
// ---------------------------------------------------------------------------

export interface McvManagerBotModuleInfo extends ConditionalTraitInfo {
  readonly mcvTypes: ReadonlySet<string>
  readonly constructionYardTypes: ReadonlySet<string>
  readonly mcvFactoryTypes: ReadonlySet<string>
  readonly minimumConstructionYardCount: number
  readonly scanForNewMcvInterval: number
  readonly minBaseRadius: number
  readonly maxBaseRadius: number
  readonly restrictMCVDeploymentFallbackToBase: boolean
}

// ---------------------------------------------------------------------------
// McvManagerBotModule
// ---------------------------------------------------------------------------

/**
 * AI MCV manager — handles MCV production and deployment.
 *
 * OpenRA 对照: McvManagerBotModule : ConditionalTrait<McvManagerBotModuleInfo>
 *
 * Implements: IBotTick, IBotPositionsUpdated
 */
export class McvManagerBotModule
  extends ConditionalTrait<McvManagerBotModuleInfo>
  implements IBotTick, IBotPositionsUpdated
{
  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  readonly world: WorldLike
  readonly player: PlayerLike
  readonly info: McvManagerBotModuleInfo

  /** Cached base center for deployment. */
  private _initialBaseCenter: { x: number; y: number } = { x: 0, y: 0 }

  /** Scan interval countdown. */
  private _scanInterval: number

  /** Whether this is the first tick (for initial deployment). */
  private _firstTick: boolean = true

  /** Notify handlers accessed via PlayerActor. */
  private _notifyPositionsUpdated: IBotPositionsUpdated[] = []
  private _requestUnitProduction: IBotRequestUnitProdLike[] = []

  /** Deterministic PRNG stored at construction. */
  private readonly _random: SimplePrng

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: McvManagerBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this.world = world
    this.player = player
    this.info = info
    this._random = random
    this._scanInterval = random.nextIntRange(info.scanForNewMcvInterval, info.scanForNewMcvInterval * 2)
  }

  // -----------------------------------------------------------------------
  // IBotTick (对应 OpenRA IBotTick.BotTick)
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    // Cache traits on first tick
    if (this._firstTick) {
      this.cachePlayerTraits(bot)
      this.deployMcvs(bot, false)
      this._firstTick = false
    }

    if (--this._scanInterval <= 0) {
      this._scanInterval = this.info.scanForNewMcvInterval
      this.deployMcvs(bot, true)

      // Build new MCV if needed
      if (this.shouldBuildMCV()) {
        const unitBuilder = this._requestUnitProduction.find(t => t !== null)
        if (unitBuilder && this.info.mcvTypes.size > 0) {
          const mcvType = this.pickRandom(this.info.mcvTypes)
          if (unitBuilder.requestedProductionCount(bot, mcvType) === 0) {
            unitBuilder.requestUnitProduction(bot, mcvType)
          }
        }
      }
    }
  }

  private cachePlayerTraits(_bot: IBot): void {
    const playerActor = (this.player as unknown as { playerActor?: { traitsImplementing: <T>(name: string) => T[] } }).playerActor
    if (playerActor) {
      this._notifyPositionsUpdated = playerActor.traitsImplementing('IBotPositionsUpdated')
      this._requestUnitProduction = playerActor.traitsImplementing('IBotRequestUnitProduction')
    }
  }

  // -----------------------------------------------------------------------
  // IBotPositionsUpdated
  // -----------------------------------------------------------------------

  updatedBaseCenter(newLocation: CPos): void {
    this._initialBaseCenter = { x: newLocation.X, y: newLocation.Y }
  }

  updatedDefenseCenter(_newLocation: CPos): void { }

  // ---------------------------------------------------------------------------
  // MCV deployment (对应 OpenRA DeployMcvs / DeployMcv)
  // ---------------------------------------------------------------------------

  /**
   * Deploy all idle MCVs at sensible locations.
   *
   * OpenRA 对照: McvManagerBotModule.DeployMcvs(IBot, bool)
   */
  private deployMcvs(bot: IBot, chooseLocation: boolean): void {
    const mcvs = this.getMcvActors()
    for (const mcv of mcvs) {
      if (mcv.isIdle) {
        this.deployMcv(bot, mcv, chooseLocation)
      }
    }
  }

  private deployMcv(bot: IBot, mcv: ActorLike, move: boolean): void {
    const transformsInfo = mcv.info?.traitInfo?.('Transforms') as TransformsInfoLike | undefined
    if (!transformsInfo) return

    const intoActor = transformsInfo.intoActor
    const offset = transformsInfo.offset

    if (move) {
      const restrictToBase =
        this.info.restrictMCVDeploymentFallbackToBase &&
        this.countConstructionYards() > 0

      const desiredLocation = this.chooseMcvDeployLocation(intoActor, offset, restrictToBase)
      if (!desiredLocation) return

      bot.queueOrder({
        orderName: 'Move',
        subjectActor: mcv.actorId,
        targetString: `${desiredLocation.x},${desiredLocation.y}`,
      } as unknown as Parameters<typeof bot.queueOrder>[0])
    }

    // Notify position updates
    for (const n of this._notifyPositionsUpdated) {
      n.updatedBaseCenter({ X: mcv.location.x, Y: mcv.location.y, Z: 0 } as unknown as CPos)
      n.updatedDefenseCenter({ X: mcv.location.x, Y: mcv.location.y, Z: 0 } as unknown as CPos)
    }

    bot.queueOrder({
      orderName: 'DeployTransform',
      subjectActor: mcv.actorId,
    } as unknown as Parameters<typeof bot.queueOrder>[0])
  }

  // ---------------------------------------------------------------------------
  // Location selection (对应 OpenRA ChooseMcvDeployLocation)
  // ---------------------------------------------------------------------------

  /**
   * Choose where to deploy an MCV.
   *
   * OpenRA 对照: McvManagerBotModule.ChooseMcvDeployLocation(string, CVec, bool)
   */
  private chooseMcvDeployLocation(
    actorType: string,
    offset: { x: number; y: number },
    distanceToBaseIsImportant: boolean,
  ): { x: number; y: number } | null {
    const rules = this.world.map?.rules as { actors?: Record<string, ActorInfoLike> } | undefined
    const actorInfo = rules?.actors?.[actorType]
    if (!actorInfo) return null

    const bi = actorInfo.traitInfo?.('Building') as BuildingInfoLike | undefined
    if (!bi) return null

    const baseCenter = this.getRandomBaseCenter()

    // Find deployable cell in annulus
    const minRange = this.info.minBaseRadius
    const maxRange = distanceToBaseIsImportant
      ? this.info.maxBaseRadius
      : this.world.map?.grid?.maximumTileSearchRange ?? 256

    const cells = this.world.map?.findTilesInAnnulus?.(baseCenter, minRange, maxRange) ?? []

    let sortedCells: { x: number; y: number }[]
    const hasValidBase = this.getConstructionYardActors().length > 0
    if (!hasValidBase) {
      // No conyards → no valid base center, just copy cells
      sortedCells = [...cells]
    } else {
      // Sort by distance to target (target === baseCenter here, shuffle suffices)
      sortedCells = this.shuffleArray([...cells])
    }

    for (const cell of sortedCells) {
      const deployCell = {
        x: cell.x + offset.x,
        y: cell.y + offset.y,
      }
      if (this.world.canPlaceBuilding?.(deployCell, actorInfo, bi, null)) {
        return cell
      }
    }

    return null
  }

  private getRandomBaseCenter(): { x: number; y: number } {
    const conyards = this.getConstructionYardActors()
    if (conyards.length > 0) {
      const prng = this.botRandom()
      return conyards[prng.nextIntRange(0, conyards.length - 1)].location
    }
    return this._initialBaseCenter
  }

  // ---------------------------------------------------------------------------
  // Should build MCV check (对应 OpenRA ShouldBuildMCV)
  // ---------------------------------------------------------------------------

  private shouldBuildMCV(): boolean {
    // Only build MCV if we don't already have one in the field
    const mcvCount = this.getMcvActors().length
    if (mcvCount > 0) return false

    return this.countConstructionYards() < this.info.minimumConstructionYardCount &&
      this.countMcvFactories() > 0
  }

  // ---------------------------------------------------------------------------
  // Actor utility methods
  // ---------------------------------------------------------------------------

  private getMcvActors(): ActorLike[] {
    const result: ActorLike[] = []
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && a.info?.name !== undefined && this.info.mcvTypes.has(a.info.name)) {
        result.push(a)
      }
    }
    return result
  }

  private getConstructionYardActors(): ActorLike[] {
    const result: ActorLike[] = []
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && a.info?.name !== undefined && this.info.constructionYardTypes.has(a.info.name)) {
        result.push(a)
      }
    }
    return result
  }

  private countConstructionYards(): number {
    return this.getConstructionYardActors().length
  }

  private countMcvFactories(): number {
    let count = 0
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && a.info?.name !== undefined && this.info.mcvFactoryTypes.has(a.info.name)) {
        count++
      }
    }
    return count
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private pickRandom(set: ReadonlySet<string>): string {
    const arr = [...set]
    if (arr.length === 0) return ''
    return arr[this.botRandom().nextIntRange(0, arr.length - 1)]
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const prng = this.botRandom()
    // Fisher-Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = prng.nextIntRange(0, i)
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    return arr
  }

  private botRandom(): SimplePrng {
    return this._random
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._notifyPositionsUpdated = []
    this._requestUnitProduction = []
    super.dispose()
  }
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

interface ActorLike {
  readonly actorId: number
  readonly isDead: boolean
  readonly isInWorld: boolean
  readonly isIdle: boolean
  readonly location: { x: number; y: number }
  readonly owner: PlayerLike
  readonly info?: {
    readonly name: string
    traitInfo?: (name: string) => unknown
  }
  traitsImplementing?: <T>(name: string) => T[]
}

interface PlayerLike {
  readonly playerName?: string
  readonly playerActor?: unknown
}

interface WorldLike {
  readonly actors: Iterable<ActorLike>
  readonly map?: {
    readonly grid?: { readonly maximumTileSearchRange: number }
    readonly rules?: { actors?: Record<string, ActorInfoLike> }
    findTilesInAnnulus?: (center: { x: number; y: number }, minRange: number, maxRange: number) => { x: number; y: number }[]
  }
  canPlaceBuilding?: (cell: { x: number; y: number }, actorInfo: ActorInfoLike, buildingInfo: BuildingInfoLike, init: unknown) => boolean
}

interface ActorInfoLike {
  readonly name: string
  traitInfo?: (name: string) => unknown
}

interface BuildingInfoLike {
  // Marker for building info duck-type
}

interface TransformsInfoLike {
  readonly intoActor: string
  readonly offset: { x: number; y: number }
}

interface IBotRequestUnitProdLike {
  requestUnitProduction(bot: IBot, requestedActor: string): void
  requestedProductionCount(bot: IBot, requestedActor: string): number
}
