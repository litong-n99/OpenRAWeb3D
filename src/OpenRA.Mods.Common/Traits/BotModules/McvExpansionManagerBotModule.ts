/**
 * McvExpansionManagerBotModule.ts — AI MCV expansion management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/McvExpansionManagerBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<McvExpansionManagerBotModuleInfo> (825 lines) → TypeScript
 * - C# ActorIndex.OwnerAndNamesAndTrait → duck-typed actor lists
 * - C# PathFinder.FindPathToTargetCells → duck-typed pathfinding
 * - C# WDist/WPos/WVec → TypeScript {x,y,z} position objects
 * - C# LINQ (Where, Select, Count, ToArray, OrderBy, OrderByDescending, MinByOrDefault)
 *   → TypeScript for-loops (PERF)
 * - C# enum BotMcvExpansionMode → TypeScript const object
 * - C# MersenneTwister → SimplePrng
 *
 * Manages Mobile Construction Vehicle expansion: site selection using
 * weighted grid evaluation, mode switching (CheckResource/CheckBase/
 * CheckCurrentLocation), and conyard movement.
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotRespondToAttack,
  IBotBaseExpansion,
  IBot,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import { isqrt } from '../../../OpenRA.Game/Exts.js'
import type { ResourceMapBotModuleInfo, ResourceIndice } from './ResourceMapBotModule.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// BotMcvExpansionMode enum
// ---------------------------------------------------------------------------

export const BotMcvExpansionMode = {
  CheckResource: 0,
  CheckBase: 1,
  CheckCurrentLocation: 2,
} as const
export type BotMcvExpansionMode = (typeof BotMcvExpansionMode)[keyof typeof BotMcvExpansionMode]

// ---------------------------------------------------------------------------
// McvExpansionManagerBotModuleInfo
// ---------------------------------------------------------------------------

export interface McvExpansionManagerBotModuleInfo extends ConditionalTraitInfo {
  readonly mcvTypes: ReadonlySet<string>
  readonly constructionYardTypes: ReadonlySet<string>
  readonly mcvFactoryTypes: ReadonlySet<string>
  readonly minimumConstructionYardCount: number
  readonly additionalConstructionYardCount: number
  readonly buildAdditionalMCVCashAmount: number
  readonly scanForNewMcvInterval: number
  readonly buildMcvInterval: number
  readonly moveConyardTick: number
  readonly moveOldConyardFirst: boolean | null
  readonly initialExpansionMode: BotMcvExpansionMode
  readonly expansionModeAutoSwitch: boolean
  readonly crModeMinDeployRadius: number
  readonly crModeMaxDeployRadius: number
  readonly crModeTryMaintainRange: number
  readonly crModeFriendlyConyardDislikeRange: number
  readonly crModeFriendlyRefineryDislikeRange: number
  readonly cbModeMinDeployRadius: number
  readonly cbModeMaxDeployRadius: number
}

// ---------------------------------------------------------------------------
// McvExpansionManagerBotModule
// ---------------------------------------------------------------------------

/**
 * AI MCV expansion manager — handles base expansion site selection,
 * MCV deployment, conyard move decisions, and build-MCV logic.
 *
 * OpenRA 对照: McvExpansionManagerBotModule : ConditionalTrait<McvExpansionManagerBotModuleInfo>
 *
 * Implements: IBotTick, IBotRespondToAttack, IBotBaseExpansion
 */
export class McvExpansionManagerBotModule
  extends ConditionalTrait<McvExpansionManagerBotModuleInfo>
  implements IBotTick, IBotRespondToAttack, IBotBaseExpansion
{
  // -----------------------------------------------------------------------
  // Constants (对应 OpenRA const ints)
  // -----------------------------------------------------------------------

  private static readonly CR_MOD_POSITIVE_MAX_FAILED_ATTEMPTS = 3
  private static readonly CB_MOD_POSITIVE_MAX_FAILED_ATTEMPTS = 2
  private static readonly NEGATIVE_MAX_FAILED_ATTEMPTS = 0

  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  readonly world: WorldLike
  readonly player: PlayerLike
  readonly info: McvExpansionManagerBotModuleInfo

  /** Active MCVs and their destinations. */
  private readonly _activeMCVs = new Map<number, { x: number; y: number } | null>()

  /** Pathfinder reference. */
  private _pathFinder: PathFinderLike | null = null

  /** Resource map module reference. */
  private _resourceMapModule: ResourceMapModuleLike | null = null

  /** Player resources reference. */
  private _playerResources: PlayerResourcesLike | null = null

  // -----------------------------------------------------------------------
  // Dependencies (notify/request/suggest interfaces)
  // -----------------------------------------------------------------------

  private _notifyPositionsUpdated: { updatedBaseCenter(loc: CPos): void; updatedDefenseCenter(loc: CPos): void }[] = []
  private _requestUnitProduction: IBotRequestUnitProduction[] = []
  private _suggestRefineryProduction: IBotSuggestRefineryProduction[] = []

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  private _scanInterval: number = 0
  private _buildMCVInterval: number = 0
  private _moveConyardInterval: number = 0
  private _firstTick: boolean = true
  private _undeployEvenNoBase: boolean = false
  private _allowFallback: boolean = true

  /** Current expansion mode. */
  private _mcvExpansionMode: BotMcvExpansionMode = BotMcvExpansionMode.CheckResource

  /** Deployment radius parameters (set by SwitchExpansionMode). */
  private _mcvDeploymentMinDeployRadius: number = 2
  private _mcvDeploymentMaxDeployRadius: number = 20
  private _mcvDeploymentTryMaintainRange: number = 8

  /** Maximum failed attempts before mode switch. */
  private _maxFailedAttempts: number = McvExpansionManagerBotModule.CR_MOD_POSITIVE_MAX_FAILED_ATTEMPTS

  /** Current failed attempt count. */
  private _failedAttempts: number = 0

  /** Last failed check spot. */
  private _lastFailedCheckSpot: { x: number; y: number } | null = null

  /** Attack response cooldown. */
  private _attackRespondCooldown: number = 20

  /** Path distance normalization factor. */
  private _pathDistanceSquareFactor: number = 0

  /** Cached PRNG. */
  private _cachedRandom: SimplePrng | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: McvExpansionManagerBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this.world = world
    this.player = player
    this.info = info
    this._cachedRandom = random
  }

  // -----------------------------------------------------------------------
  // IBotTick (对应 OpenRA IBotTick.BotTick)
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    this._attackRespondCooldown--

    if (this._firstTick) {
      // Cache traits from PlayerActor
      const playerActor = (this.player as unknown as { playerActor?: ActorLike }).playerActor
      if (playerActor) {
        this._notifyPositionsUpdated = (playerActor.traitsImplementing?.('IBotPositionsUpdated') ?? []) as typeof this._notifyPositionsUpdated
        this._requestUnitProduction = (playerActor.traitsImplementing?.('IBotRequestUnitProduction') ?? []) as IBotRequestUnitProduction[]
        this._suggestRefineryProduction = (playerActor.traitsImplementing?.('IBotSuggestRefineryProduction') ?? []) as IBotSuggestRefineryProduction[]
        this._resourceMapModule = playerActor.traitsImplementing?.('ResourceMapBotModule')?.find(
          (t: unknown) => (t as { isTraitEnabled?: () => boolean }).isTraitEnabled?.()
        ) as ResourceMapModuleLike | undefined ?? null
      }

      this._pathFinder = this.world.worldActor?.traitsImplementing?.('PathFinder')?.[0] as PathFinderLike | undefined ?? null
      this._playerResources = (this.player as unknown as { playerActor?: ActorLike }).playerActor?.traitsImplementing?.('PlayerResources')?.[0] as PlayerResourcesLike | undefined ?? null

      this.switchExpansionMode(this.info.initialExpansionMode)

      this._pathDistanceSquareFactor =
        (this._resourceMapModule?.getIndiceRowCount() ?? 0) * (this._resourceMapModule?.getIndiceRowCount() ?? 0) +
        (this._resourceMapModule?.getIndiceColumnCount() ?? 0) * (this._resourceMapModule?.getIndiceColumnCount() ?? 0)

      this.deployMcvs(bot, false)
      this._firstTick = false
    }

    if (--this._scanInterval <= 0) {
      // Clean dead MCVs
      for (const [id] of this._activeMCVs) {
        const actor = this.getActorById(id)
        if (!actor || actor.isDead || !actor.isInWorld) {
          this._activeMCVs.delete(id)
        }
      }

      this._scanInterval = this.info.scanForNewMcvInterval
      this.deployMcvs(bot, true)
    }

    if (--this._buildMCVInterval <= 0) {
      this._buildMCVInterval = this.info.buildMcvInterval
      this.buildMCV(bot)
    }

    if (--this._moveConyardInterval <= 0) {
      // Clean dead MCVs
      for (const [id] of this._activeMCVs) {
        const actor = this.getActorById(id)
        if (!actor || actor.isDead || !actor.isInWorld) {
          this._activeMCVs.delete(id)
        }
      }
      this._moveConyardInterval = this.info.moveConyardTick
      this.undeployConyard(bot)
    }
  }

  // ---------------------------------------------------------------------------
  // Expansion mode switching (对应 OpenRA SwitchExpansionMode)
  // ---------------------------------------------------------------------------

  private switchExpansionMode(nextMode: BotMcvExpansionMode): void {
    this._mcvExpansionMode = nextMode

    switch (nextMode) {
      case BotMcvExpansionMode.CheckResource:
        this._mcvDeploymentMinDeployRadius = this.info.crModeMinDeployRadius
        this._mcvDeploymentMaxDeployRadius = this.info.crModeMaxDeployRadius
        this._mcvDeploymentTryMaintainRange = this.info.crModeTryMaintainRange
        break

      case BotMcvExpansionMode.CheckBase:
        this._mcvDeploymentMinDeployRadius = this.info.cbModeMinDeployRadius
        this._mcvDeploymentMaxDeployRadius = this.info.cbModeMaxDeployRadius
        this._mcvDeploymentTryMaintainRange = (this.info.cbModeMaxDeployRadius + this.info.cbModeMinDeployRadius) >> 1
        break

      case BotMcvExpansionMode.CheckCurrentLocation:
        this._mcvDeploymentMinDeployRadius = this.info.cbModeMinDeployRadius
        this._mcvDeploymentMaxDeployRadius = this.info.cbModeMaxDeployRadius
        this._mcvDeploymentTryMaintainRange = 0
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Good/Bad deploy spot tracking
  // ---------------------------------------------------------------------------

  private findBadDeploySpot(failedSpot: { x: number; y: number } | null): void {
    this._lastFailedCheckSpot = failedSpot

    if (!this.info.expansionModeAutoSwitch) {
      if (++this._failedAttempts >= this._maxFailedAttempts) {
        this._failedAttempts = this._maxFailedAttempts
      }
      return
    }

    if (++this._failedAttempts >= this._maxFailedAttempts) {
      this._failedAttempts = 0
      switch (this._mcvExpansionMode) {
        case BotMcvExpansionMode.CheckResource:
          this.switchExpansionMode(BotMcvExpansionMode.CheckBase)
          break
        case BotMcvExpansionMode.CheckBase:
          this.switchExpansionMode(BotMcvExpansionMode.CheckResource)
          this._maxFailedAttempts = McvExpansionManagerBotModule.NEGATIVE_MAX_FAILED_ATTEMPTS
          break
        case BotMcvExpansionMode.CheckCurrentLocation:
          this.switchExpansionMode(BotMcvExpansionMode.CheckResource)
          this._maxFailedAttempts = McvExpansionManagerBotModule.NEGATIVE_MAX_FAILED_ATTEMPTS
          break
      }
    }
  }

  private findGoodDeploySpot(): void {
    this._lastFailedCheckSpot = null

    if (!this.info.expansionModeAutoSwitch) {
      if (--this._failedAttempts <= -this._maxFailedAttempts) {
        this._failedAttempts = -this._maxFailedAttempts
      }
      return
    }

    if (--this._failedAttempts <= -this._maxFailedAttempts) {
      switch (this._mcvExpansionMode) {
        case BotMcvExpansionMode.CheckResource:
          this._maxFailedAttempts = McvExpansionManagerBotModule.CR_MOD_POSITIVE_MAX_FAILED_ATTEMPTS
          this._failedAttempts = -this._maxFailedAttempts
          break
        case BotMcvExpansionMode.CheckBase:
          this._maxFailedAttempts = McvExpansionManagerBotModule.CR_MOD_POSITIVE_MAX_FAILED_ATTEMPTS
          this._failedAttempts = this._maxFailedAttempts - 1
          this.switchExpansionMode(BotMcvExpansionMode.CheckResource)
          break
        case BotMcvExpansionMode.CheckCurrentLocation:
          this._maxFailedAttempts = McvExpansionManagerBotModule.CB_MOD_POSITIVE_MAX_FAILED_ATTEMPTS
          this._failedAttempts = this._maxFailedAttempts - 1
          this.switchExpansionMode(BotMcvExpansionMode.CheckBase)
          break
      }
    }
  }

  // ---------------------------------------------------------------------------
  // GetExpansionCenter (对应 OpenRA GetExpansionCenter)
  // ---------------------------------------------------------------------------

  /**
   * Calculate the best expansion location for an MCV using weighted grid evaluation.
   *
   * OpenRA 对照: McvExpansionManagerBotModule.GetExpansionCenter(Actor, Mobile, bool)
   */
  private getExpansionCenter(
    mcv: ActorLike,
    mobile: MobileLike | null,
    allowFallback: boolean,
  ): { expandLocation: { x: number; y: number } | null; attraction: number; checkSpot: { x: number; y: number } | null } {
    if (!this._resourceMapModule) {
      return { expandLocation: null, attraction: -2147483648, checkSpot: null }
    }

    const indiceSideLengthSquare = this._resourceMapModule.getIndiceSideLength() ** 2

    switch (this._mcvExpansionMode) {
      // CheckBase mode
      case BotMcvExpansionMode.CheckBase: {
        const cbConyardLocs = this.getConyardLocations()
        let cbSuitableSpot: { x: number; y: number } | null = null
        let cbCheckSpot: { x: number; y: number } | null = null
        let cbBest = -2147483648

        const indicesLength = this._resourceMapModule.getIndicesLength()
        for (let i = 0; i < indicesLength; i++) {
          const indice = this._resourceMapModule.getIndice(i)
          const indiceCenter = indice.indiceCenter

          if (this._lastFailedCheckSpot && this._lastFailedCheckSpot.x === indiceCenter.x
            && this._lastFailedCheckSpot.y === indiceCenter.y) {
            continue
          }

          let attraction = indiceSideLengthSquare >> 1

          // Distance penalty
          const dx = indiceCenter.x - mcv.location.x
          const dy = indiceCenter.y - mcv.location.y
          attraction -= (dx * dx + dy * dy) / Math.max(this._pathDistanceSquareFactor, 1)

          // Threat penalty
          attraction -= this.calculateThreats(indiceSideLengthSquare, i)

          // Friendly conyard penalty
          for (const { loc, isAlly } of cbConyardLocs) {
            const sdx = indiceCenter.x - loc.x
            const sdy = indiceCenter.y - loc.y
            if (sdx * sdx + sdy * sdy <= indiceSideLengthSquare) {
              attraction -= isAlly ? indiceSideLengthSquare : indiceSideLengthSquare << 1
            }
          }

          // Other MCV destination penalty
          for (const [, dest] of this._activeMCVs) {
            if (dest && dest.x === indiceCenter.x && dest.y === indiceCenter.y) {
              attraction -= indiceSideLengthSquare << 1
            }
          }

          // Fallback penalty
          if (!allowFallback) {
            const sdx = indiceCenter.x - mcv.location.x
            const sdy = indiceCenter.y - mcv.location.y
            if (sdx * sdx + sdy * sdy <= indiceSideLengthSquare) {
              attraction -= indiceSideLengthSquare << 1
            }
          }

          if (attraction > cbBest) {
            cbBest = attraction
            cbCheckSpot = indiceCenter
            cbSuitableSpot = indiceCenter
          }
        }

        return {
          expandLocation: cbSuitableSpot ?? mcv.location,
          attraction: cbBest,
          checkSpot: cbCheckSpot,
        }
      }

      // CheckResource mode
      case BotMcvExpansionMode.CheckResource: {
        const crRefineryLocs = this.getRefineryLocations()
        const crConyardLocs = this.getConyardLocations()

        // Calculate resource threshold
        let thresholdRes = 0
        const indicesLength = this._resourceMapModule.getIndicesLength()
        for (let i = 0; i < indicesLength; i++) {
          const indice = this._resourceMapModule.getIndice(i)
          const rcc = indice.resourceCellsCount
          thresholdRes += (indiceSideLengthSquare >> 1) - Math.abs(rcc - (indiceSideLengthSquare >> 1))
        }
        thresholdRes = (thresholdRes / Math.max(indicesLength, 1)) >> 1

        let crSuitableSpot: { x: number; y: number } | null = null
        let crCheckSpot: { x: number; y: number } | null = null
        let crBest = -2147483648

        for (let i = 0; i < indicesLength; i++) {
          const indice = this._resourceMapModule.getIndice(i)
          const indiceCenter = indice.indiceCenter
          const resourceCellsCount = indice.resourceCellsCount
          const resourceCellsCenter = indice.resourceCellsCenter
          const resourceCreatorLocs = indice.resourceCreatorLocs

          if ((this._failedAttempts > this._maxFailedAttempts >> 1 && resourceCellsCount <= thresholdRes)
            || (this._lastFailedCheckSpot && this._lastFailedCheckSpot.x === indiceCenter.x
              && this._lastFailedCheckSpot.y === indiceCenter.y)) {
            continue
          }

          let attraction = 0
          if (!mobile) {
            attraction = indiceSideLengthSquare >> 2
            const rdx = resourceCellsCenter.x - mcv.location.x
            const rdy = resourceCellsCenter.y - mcv.location.y
            attraction -= (rdx * rdx + rdy * rdy) / Math.max(this._pathDistanceSquareFactor, 1)
          } else {
            attraction = indiceSideLengthSquare >> 1

            const path = this._pathFinder?.findPathToTargetCells?.(
              mcv.location,
              [resourceCellsCenter],
            )
            if (!path || path.length === 0) continue
            attraction -= (path.length * path.length) / Math.max(this._pathDistanceSquareFactor, 1)
          }

          // Resource density bonus
          attraction += ((indiceSideLengthSquare >> 1) - Math.abs(resourceCellsCount - (indiceSideLengthSquare >> 1))) >> 2
          attraction += 8 * resourceCreatorLocs.length

          // Pick resource center or creator location
          const prng = this.botRandom()
          const useCreator = resourceCreatorLocs.length > 0 && prng.nextIntRange(0, 1) > 0
          const resCenter = useCreator && resourceCreatorLocs.length > 0
            ? resourceCreatorLocs[prng.nextIntRange(0, resourceCreatorLocs.length - 1)]
            : resourceCellsCenter

          attraction -= this.calculateThreats(indiceSideLengthSquare, i)

          // Refinery penalty
          for (const { loc, isAlly } of crRefineryLocs) {
            const sdx = resCenter.x - loc.x
            const sdy = resCenter.y - loc.y
            if (sdx * sdx + sdy * sdy <= this.info.crModeFriendlyRefineryDislikeRange * this.info.crModeFriendlyRefineryDislikeRange) {
              attraction -= isAlly ? indiceSideLengthSquare : indiceSideLengthSquare << 1
            }
          }

          // Conyard penalty
          for (const { loc, isAlly } of crConyardLocs) {
            const sdx = resCenter.x - loc.x
            const sdy = resCenter.y - loc.y
            if (sdx * sdx + sdy * sdy <= this.info.crModeFriendlyConyardDislikeRange * this.info.crModeFriendlyConyardDislikeRange) {
              attraction -= isAlly ? indiceSideLengthSquare : indiceSideLengthSquare << 1
            }
          }

          // Other MCV penalty
          for (const [, dest] of this._activeMCVs) {
            if (dest && dest.x === indiceCenter.x && dest.y === indiceCenter.y) {
              attraction -= indiceSideLengthSquare << 1
            }
          }

          // Fallback
          if (!allowFallback) {
            const sdx = resCenter.x - mcv.location.x
            const sdy = resCenter.y - mcv.location.y
            if (sdx * sdx + sdy * sdy <= this.info.crModeFriendlyConyardDislikeRange * this.info.crModeFriendlyConyardDislikeRange) {
              attraction -= indiceSideLengthSquare << 1
            }
          }

          if (attraction > crBest) {
            crBest = attraction
            crCheckSpot = indiceCenter
            crSuitableSpot = resCenter
          }
        }

        if (!crSuitableSpot) {
          return { expandLocation: null, attraction: -2147483648, checkSpot: null }
        }

        return { expandLocation: crSuitableSpot, attraction: crBest, checkSpot: crCheckSpot }
      }

      // CheckCurrentLocation
      case BotMcvExpansionMode.CheckCurrentLocation:
        return { expandLocation: mcv.location, attraction: 2147483647, checkSpot: null }

      default:
        return { expandLocation: null, attraction: -2147483648, checkSpot: null }
    }
  }

  // ---------------------------------------------------------------------------
  // Threat calculation (对应 OpenRA CalculateThreats)
  // ---------------------------------------------------------------------------

  private calculateThreats(indiceSideLengthSquare: number, index: number): number {
    if (!this._resourceMapModule) return 0

    const baseIndice = this._resourceMapModule.getIndice(index)
    const { indiceCount, nearbyEnemyThreat, nearbyEnemyBaseThreat } =
      this._resourceMapModule.getNearbyIndicesThreat?.(index) ?? { indiceCount: 0, nearbyEnemyThreat: 0, nearbyEnemyBaseThreat: 0 }

    const indiceEnemyBaseThreat = Math.max((baseIndice.enemyBaseCount ?? 0) - (baseIndice.friendlyBaseCount ?? 0), 0)
    const indiceEnemyUnitThreat = Math.max((baseIndice.enemyUnitCount ?? 0) - (baseIndice.friendlyUnitCount ?? 0), 0)

    if (indiceCount === 0) {
      return (indiceEnemyUnitThreat * indiceSideLengthSquare >> 6) +
        (indiceEnemyBaseThreat * indiceSideLengthSquare << 3)
    }

    return ((indiceEnemyUnitThreat * indiceSideLengthSquare + nearbyEnemyThreat * indiceSideLengthSquare / indiceCount) >> 6) +
      ((indiceEnemyBaseThreat * indiceSideLengthSquare + nearbyEnemyBaseThreat * indiceSideLengthSquare / indiceCount) << 3)
  }

  // ---------------------------------------------------------------------------
  // MCV deployment (对应 OpenRA DeployMcvs / DeployMcv)
  // ---------------------------------------------------------------------------

  private deployMcvs(bot: IBot, chooseLocation: boolean): void {
    for (const a of this.world.actors) {
      if (a.owner !== this.player) continue
      if (a.isDead || !a.isInWorld) continue
      if (!a.isIdle) continue
      if (!this.info.mcvTypes.has(a.info?.name ?? '')) continue

      this.deployMcv(bot, a, chooseLocation)
    }
  }

  private deployMcv(bot: IBot, mcv: ActorLike, move: boolean): void {
    const transformsInfo = mcv.info?.traitInfo?.('Transforms') as TransformsInfoLike | undefined
    if (!transformsInfo) return

    const actorType = transformsInfo.intoActor
    const offset = transformsInfo.offset
    const rules = (this.world.map as { rules?: { actors?: Record<string, ActorInfoLike> } } | undefined)?.rules
    const actorInfo = rules?.actors?.[actorType]
    const bi = actorInfo?.traitInfo?.('Building') as BuildingInfoLike | undefined
    if (!bi || !actorInfo) return

    if (move) {
      const { deployLoc, resourceLoc, checkLoc } = this.chooseMcvDeployLocation(
        mcv, actorInfo!, bi!, offset, this._allowFallback,
      )
      this._allowFallback = true
      const desiredLocation = deployLoc
      if (!desiredLocation) return

      if (checkLoc) {
        this._activeMCVs.set(mcv.actorId, checkLoc)
      }

      if (resourceLoc) {
        for (const srp of this._suggestRefineryProduction) {
          srp.requestLocation?.(
            { X: resourceLoc.x, Y: resourceLoc.y, Z: 0 } as unknown as CPos,
            { X: desiredLocation.x, Y: desiredLocation.y, Z: 0 } as unknown as CPos,
            mcv as unknown as IGameActor,
          )
        }
      }

      bot.queueOrder({
        orderName: 'Move',
        subjectActor: mcv.actorId,
        targetString: `${desiredLocation.x},${desiredLocation.y}`,
      } as unknown as Parameters<typeof bot.queueOrder>[0])
    } else {
      const deployCell = {
        x: mcv.location.x + offset.x,
        y: mcv.location.y + offset.y,
      }
      if (!this.world.canPlaceBuilding?.(deployCell, actorInfo, bi, mcv)) return
      // desiredLocation = mcv.Location (no move needed)
    }

    bot.queueOrder({
      orderName: 'DeployTransform',
      subjectActor: mcv.actorId,
    } as unknown as Parameters<typeof bot.queueOrder>[0])

    // Notify position updates
    const conyardCount = this.countConstructionYards()
    const prng = this.botRandom()
    if (conyardCount === 0 || prng.nextIntRange(0, 1) > 0) {
      for (const n of this._notifyPositionsUpdated) {
        n.updatedBaseCenter({ X: mcv.location.x, Y: mcv.location.y, Z: 0 } as unknown as CPos)
        n.updatedDefenseCenter({ X: mcv.location.x, Y: mcv.location.y, Z: 0 } as unknown as CPos)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ChooseMcvDeployLocation (对应 OpenRA ChooseMcvDeployLocation)
  // ---------------------------------------------------------------------------

  private chooseMcvDeployLocation(
    mcv: ActorLike,
    transformIntoInfo: ActorInfoLike,
    transformIntoBuildingInfo: BuildingInfoLike,
    offset: { x: number; y: number },
    allowFallback: boolean,
  ): { deployLoc: { x: number; y: number } | null; resourceLoc: { x: number; y: number } | null; checkLoc: { x: number; y: number } | null } {
    const mobile = mcv.traitsImplementing?.('Mobile')?.[0] as MobileLike | undefined ?? null

    const { expandLocation: expandCenter, attraction, checkSpot: checkspot } =
      this.getExpansionCenter(mcv, mobile, allowFallback)

    const findDeployCell = (
      sourceCell: { x: number; y: number } | null,
      targetCell: { x: number; y: number } | null,
      minRange: number,
      maxRange: number,
      tryMaintainRange: number,
    ): { x: number; y: number } | null => {
      if (!sourceCell || !targetCell) return null

      const cells = this.world.map?.findTilesInAnnulus?.(targetCell, minRange, maxRange) ?? []
      let sortedCells: { x: number; y: number }[]

      if (sourceCell.x !== targetCell.x || sourceCell.y !== targetCell.y) {
        const theta = tryMaintainRange
        // NOTE: integer sqrt for deterministic cross-platform behavior
        const deta = isqrt((targetCell.x - sourceCell.x) ** 2 + (targetCell.y - sourceCell.y) ** 2) - tryMaintainRange
        sortedCells = [...cells]
        sortedCells.sort((a, b) => {
          const da = (a.x - targetCell.x) ** 2 + (a.y - targetCell.y) ** 2
          const db = (b.x - targetCell.x) ** 2 + (b.y - targetCell.y) ** 2
          const da2 = (a.x - sourceCell.x) ** 2 + (a.y - sourceCell.y) ** 2
          const db2 = (b.x - sourceCell.x) ** 2 + (b.y - sourceCell.y) ** 2
          return (deta * da + theta * da2) - (deta * db + theta * db2)
        })
      } else {
        sortedCells = [...cells]
        // Shuffle
        for (let i = sortedCells.length - 1; i > 0; i--) {
          const j = this.botRandom().nextIntRange(0, i)
          const t = sortedCells[i]; sortedCells[i] = sortedCells[j]; sortedCells[j] = t
        }
      }

      let bestCell: { x: number; y: number } | null = null
      for (const cell of sortedCells) {
        const deployCell = { x: cell.x + offset.x, y: cell.y + offset.y }
        if (this.world.canPlaceBuilding?.(deployCell, transformIntoInfo, transformIntoBuildingInfo, mcv)) {
          bestCell = cell
          break
        }
      }

      if (!bestCell) return null

      // Path existence check
      if (sourceCell.x !== targetCell.x || sourceCell.y !== targetCell.y) {
        if (mobile && this._pathFinder && !this._pathFinder.pathMightExistForLocomotorBlockedByImmovable?.(
          mobile.locomotor, sourceCell, bestCell,
        )) {
          bestCell = null
        }
      }

      // If best deploy cell is not ideal, fall back to closest cell
      if (!bestCell || (sourceCell.x !== targetCell.x || sourceCell.y !== targetCell.y) &&
        ((bestCell.x - targetCell.x) ** 2 + (bestCell.y - targetCell.y) ** 2 >= (tryMaintainRange + 2) ** 2)) {
        sortedCells = [...cells]
        sortedCells.sort((a, b) => {
          const da = (a.x - targetCell.x) ** 2 + (a.y - targetCell.y) ** 2
          const db = (b.x - targetCell.x) ** 2 + (b.y - targetCell.y) ** 2
          return da - db
        })

        for (const cell of sortedCells) {
          const deployCell = { x: cell.x + offset.x, y: cell.y + offset.y }
          if (this.world.canPlaceBuilding?.(deployCell, transformIntoInfo, transformIntoBuildingInfo, mcv)) {
            if (mobile && this._pathFinder && !this._pathFinder.pathMightExistForLocomotorBlockedByImmovable?.(
              mobile.locomotor, sourceCell, cell,
            )) {
              return null
            }
            if (!bestCell ||
              ((cell.x - targetCell.x) ** 2 + (cell.y - targetCell.y) ** 2 < (bestCell.x - targetCell.x) ** 2 + (bestCell.y - targetCell.y) ** 2)) {
              return cell
            }
          }
        }
      }

      return bestCell
    }

    const bc = findDeployCell(
      mcv.location,
      expandCenter,
      this._mcvDeploymentMinDeployRadius,
      this._mcvDeploymentMaxDeployRadius,
      this._mcvDeploymentTryMaintainRange,
    )

    if (bc && attraction > 0) {
      this.findGoodDeploySpot()
    } else {
      this.findBadDeploySpot(bc ? null : checkspot)
    }

    if (this._mcvExpansionMode === BotMcvExpansionMode.CheckResource && expandCenter && bc) {
      return { deployLoc: bc, resourceLoc: expandCenter, checkLoc: checkspot }
    }

    return { deployLoc: bc, resourceLoc: null, checkLoc: checkspot }
  }

  // ---------------------------------------------------------------------------
  // BuildMCV (对应 OpenRA BuildMCV)
  // ---------------------------------------------------------------------------

  private buildMCV(bot: IBot): void {
    if (this.info.mcvTypes.size === 0) return
    if (this.countMcvFactories() === 0) return

    const mcvNum = this.countMcvActors()
    const conyardNum = this.countConstructionYards()

    const cash = this._playerResources?.getCashAndResources() ?? 0
    const mcvShouldHave = cash >= this.info.buildAdditionalMCVCashAmount
      ? this.info.minimumConstructionYardCount + this.info.additionalConstructionYardCount
      : this.info.minimumConstructionYardCount

    if ((conyardNum <= 0 && mcvNum > 1) || (conyardNum > 0 && mcvNum > 0)) return
    if (conyardNum + mcvNum >= mcvShouldHave) return

    // Check if MCV already in production queue
    for (const a of this.world.actors) {
      if (a.owner !== this.player || a.isDead) continue
      if (!this.info.mcvFactoryTypes.has(a.info?.name ?? '')) continue
      const pq = a.traitsImplementing?.('ProductionQueue')?.[0] as ProdQueueLike | undefined
      if (pq?.allQueued) {
        const queued = pq.allQueued()
        if (queued.some((q: { item: string }) => this.info.mcvTypes.has(q.item))) return
      }
    }

    const unitBuilder = this._requestUnitProduction.find(t => t !== null)
    if (!unitBuilder) return

    const mcvType = this.pickRandom(this.info.mcvTypes)
    if ((unitBuilder.requestedProductionCount?.(bot, mcvType) ?? 0) <= 0) {
      unitBuilder.requestUnitProduction?.(bot, mcvType)
    }
  }

  // ---------------------------------------------------------------------------
  // UnDeployConyard (对应 OpenRA UnDeployConyard)
  // ---------------------------------------------------------------------------

  private undeployConyard(bot: IBot): void {
    if (this._activeMCVs.size > 0) return

    let conyards: ActorLike[] = []
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && this.info.constructionYardTypes.has(a.info?.name ?? '')) {
        conyards.push(a)
      }
    }

    const moveOldFirst = this.info.moveOldConyardFirst ?? (this.botRandom().nextIntRange(0, 1) > 0)
    conyards.sort((a, b) => moveOldFirst ? a.actorId - b.actorId : b.actorId - a.actorId)

    if (conyards.length > 1 || this._undeployEvenNoBase) {
      // Don't interrupt refinery production
      const movableMCV = conyards.find(a => {
        const pq = a.traitsImplementing?.('ProductionQueue')?.[0] as ProdQueueLike | undefined
        if (!pq?.allQueued) return true
        const queued = pq.allQueued()
        return !queued.some((q: { item: string }) =>
          this._resourceMapModule?.info?.refineryTypes.has(q.item))
      })

      if (movableMCV) {
        bot.queueOrder({
          orderName: 'DeployTransform',
          subjectActor: movableMCV.actorId,
        } as unknown as Parameters<typeof bot.queueOrder>[0])
      }

      this._undeployEvenNoBase = false
    }
  }

  // ---------------------------------------------------------------------------
  // IBotRespondToAttack (对应 OpenRA RespondToAttack)
  // ---------------------------------------------------------------------------

  respondToAttack(bot: IBot, self: IGameActor, _e: AttackInfo): void {
    if (this._attackRespondCooldown > 0) return

    const selfActor = self as unknown as ActorLike
    if (!this.info.mcvTypes.has(selfActor.info?.name ?? '')) return

    this._attackRespondCooldown = 20
    this.deployMcv(bot, selfActor, false)

    if (this.countConstructionYards() === 0) {
      for (const n of this._notifyPositionsUpdated) {
        n.updatedBaseCenter({ X: selfActor.location.x, Y: selfActor.location.y, Z: 0 } as unknown as CPos)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // IBotBaseExpansion (对应 OpenRA UpdateExpansionParams)
  // ---------------------------------------------------------------------------

  updateExpansionParams(
    _bot: IBot | null,
    fallback: boolean,
    undeployEvenNoBase: boolean,
    _mustUndeploy: IGameActor | null,
  ): void {
    this._moveConyardInterval = 20
    this._allowFallback = fallback
    this._undeployEvenNoBase = undeployEvenNoBase
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getConyardLocations(): { loc: { x: number; y: number }; isAlly: boolean }[] {
    const result: { loc: { x: number; y: number }; isAlly: boolean }[] = []
    for (const a of this.world.actors) {
      if (a.isDead) continue
      if (this.info.constructionYardTypes.has(a.info?.name ?? '')) {
        const rel = this.player.relationshipWith?.(a.owner)
        if (rel === 'Ally' || a.owner === this.player) {
          result.push({ loc: a.location, isAlly: a.owner === this.player })
        }
      }
    }
    return result
  }

  private getRefineryLocations(): { loc: { x: number; y: number }; isAlly: boolean }[] {
    const result: { loc: { x: number; y: number }; isAlly: boolean }[] = []
    const refineryTypes = this._resourceMapModule?.info?.refineryTypes ?? new Set<string>()
    for (const a of this.world.actors) {
      if (a.isDead) continue
      if (a.owner === this.player && refineryTypes.has(a.info?.name ?? '')) {
        result.push({ loc: a.location, isAlly: false })
      }
    }
    return result
  }

  private countConstructionYards(): number {
    let count = 0
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && this.info.constructionYardTypes.has(a.info?.name ?? '')) count++
    }
    return count
  }

  private countMcvActors(): number {
    let count = 0
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && this.info.mcvTypes.has(a.info?.name ?? '')) count++
    }
    return count
  }

  private countMcvFactories(): number {
    let count = 0
    for (const a of this.world.actors) {
      if (a.owner === this.player && !a.isDead && a.isInWorld
        && this.info.mcvFactoryTypes.has(a.info?.name ?? '')) count++
    }
    return count
  }

  private getActorById(id: number): ActorLike | null {
    for (const a of this.world.actors) {
      if (a.actorId === id) return a
    }
    return null
  }

  private pickRandom(set: ReadonlySet<string>): string {
    const arr = [...set]
    if (arr.length === 0) return ''
    return arr[this.botRandom().nextIntRange(0, arr.length - 1)]
  }

  private botRandom(): SimplePrng {
    if (!this._cachedRandom) {
      this._cachedRandom = {
        nextIntRange: (min: number, max: number) => min >= max ? min : min + ((Math.abs((Math.imul(48271, min + 1) | 0)) % (max - min + 1))),
      } as SimplePrng
    }
    return this._cachedRandom
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._activeMCVs.clear()
    this._notifyPositionsUpdated = []
    this._requestUnitProduction = []
    this._suggestRefineryProduction = []
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
  readonly centerPosition: { x: number; y: number; z: number }
  readonly owner: PlayerLike
  readonly info?: {
    readonly name: string
    traitInfo?: (name: string) => unknown
  }
  traitsImplementing?: <T>(name: string) => T[]
}

interface PlayerLike {
  readonly playerName?: string
  readonly playerActor?: ActorLike
  relationshipWith?(other: unknown): string
}

interface WorldLike {
  readonly actors: Iterable<ActorLike>
  readonly worldActor?: { traitsImplementing: <T>(name: string) => T[] }
  map?: {
    readonly grid?: { readonly maximumTileSearchRange: number }
    readonly rules?: { actors?: Record<string, ActorInfoLike> }
    findTilesInAnnulus?: (center: { x: number; y: number }, minRange: number, maxRange: number) => { x: number; y: number }[]
  }
  canPlaceBuilding?: (cell: { x: number; y: number }, actorInfo: unknown, buildingInfo: unknown, init: unknown) => boolean
}

interface ActorInfoLike {
  readonly name: string
  traitInfo?: (name: string) => unknown
}

interface BuildingInfoLike {
  // Marker
}

interface TransformsInfoLike {
  readonly intoActor: string
  readonly offset: { x: number; y: number }
}

interface MobileLike {
  readonly locomotor: unknown
}

interface PathFinderLike {
  findPathToTargetCells?: (
    source: { x: number; y: number },
    targets: readonly { x: number; y: number }[],
  ) => { x: number; y: number }[] | null
  pathMightExistForLocomotorBlockedByImmovable?: (
    locomotor: unknown,
    source: { x: number; y: number },
    target: { x: number; y: number },
  ) => boolean
}

interface PlayerResourcesLike {
  getCashAndResources(): number
}

interface ResourceMapModuleLike {
  readonly info?: ResourceMapBotModuleInfo
  getIndiceSideLength(): number
  getIndicesLength(): number
  getIndiceRowCount(): number
  getIndiceColumnCount(): number
  getIndice(i: number): ResourceIndice & { enemyBaseCount?: number; friendlyBaseCount?: number; enemyUnitCount?: number; friendlyUnitCount?: number }
  getNearbyIndicesThreat?(i: number): { indiceCount: number; nearbyEnemyThreat: number; nearbyEnemyBaseThreat: number }
}

interface ProdQueueLike {
  allQueued(): { item: string; name: string; done: boolean }[]
}

interface IBotRequestUnitProduction {
  requestUnitProduction?(bot: IBot, requestedActor: string): void
  requestedProductionCount?(bot: IBot, requestedActor: string): number
}

interface IBotSuggestRefineryProduction {
  requestLocation?(refineryLocation: CPos, conyardLocation: CPos, expandActor: IGameActor): void
}
