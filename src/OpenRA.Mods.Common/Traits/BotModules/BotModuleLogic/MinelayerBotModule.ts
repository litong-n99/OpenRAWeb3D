/**
 * MinelayerBotModule.ts — AI mine-laying unit management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/MinelayerBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<MinelayerBotModuleInfo> → TypeScript ConditionalTrait
 * - C# CPos?[] fixed-size arrays → TypeScript fixed-length arrays
 * - C# LINQ (Where, Any, ToArray, FirstOrDefault) → TypeScript for-loops
 * - C# PathFinder.FindPathToTargetCell → duck-typed pathfinding
 * - C# WDist.FromCells → integer cell * 1024
 * - C# BitSet<TargetableType> → ReadonlySet<string>
 * - C# MersenneTwister → SimplePrng
 *
 * Manages mine-laying vehicles: records conflict locations, maintains
 * favorite minefield positions, and assigns minelayers to lay mines.
 */

import { ConditionalTrait } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotRespondToAttack,
  IBot,
  IGameActor,
} from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { SimplePrng } from '../Squads/Squad.js'

// ---------------------------------------------------------------------------
// MinelayerBotModuleInfo
// ---------------------------------------------------------------------------

export interface MinelayerBotModuleInfo extends ConditionalTraitInfo {
  readonly ignoredEnemyTargetTypes: ReadonlySet<string>
  readonly useEnemyLocationTargetTypes: ReadonlySet<string>
  readonly minelayingActorTypes: ReadonlySet<string>
  readonly maxPerAssign: number
  readonly scanTick: number
  readonly mineFieldRadius: number
  readonly awayFromAlliedTargetTypes: ReadonlySet<string>
  readonly awayFromEnemyTargetTypes: ReadonlySet<string>
  readonly awayFromCellDistance: number
  readonly favoritePositionDistance: number
}

// ---------------------------------------------------------------------------
// MinelayerBotModule
// ---------------------------------------------------------------------------

/**
 * AI mine-laying manager — assigns minelayers to deploy minefields.
 *
 * OpenRA 对照: MinelayerBotModule : ConditionalTrait<MinelayerBotModuleInfo>
 *
 * Implements: IBotTick, IBotRespondToAttack
 */
export class MinelayerBotModule
  extends ConditionalTrait<MinelayerBotModuleInfo>
  implements IBotTick, IBotRespondToAttack
{
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  private static readonly MAX_POSITION_CACHE_LENGTH = 5
  private static readonly REPEATED_ALERT_TICKS = 40

  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  readonly world: WorldLike
  readonly player: PlayerLike
  readonly info: MinelayerBotModuleInfo

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  /** Conflict position queue (ring buffer). */
  private readonly _conflictPositionQueue: ({ x: number; y: number; z: number } | null)[]

  /** Favorite minefield positions (ring buffer). */
  private readonly _favoritePositions: ({ x: number; y: number; z: number } | null)[]

  /** Predicates for unit ordering. */
  private readonly _unitCannotBeOrdered: (a: ActorLike | null) => boolean
  private readonly _unitCannotBeOrderedOrIsBusy: (a: ActorLike | null) => boolean

  /** Tick countdowns. */
  private _minAssignRoleDelayTicks: number
  private _alertedTicks: number = 0

  /** Ring buffer indices. */
  private _conflictPositionLength: number = 0
  private _favoritePositionsLength: number = 0
  private _currentFavoritePositionIndex: number = 0

  /** Cached pathfinder. */
  private _pathFinder: PathFinderLike | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: MinelayerBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this.world = world
    this.player = player
    this.info = info

    this._conflictPositionQueue = new Array(MinelayerBotModule.MAX_POSITION_CACHE_LENGTH).fill(null)
    this._favoritePositions = new Array(MinelayerBotModule.MAX_POSITION_CACHE_LENGTH).fill(null)

    this._unitCannotBeOrdered = (a) => !a || a.isDead || !a.isInWorld || a.owner !== player
    this._unitCannotBeOrderedOrIsBusy = (a) => this._unitCannotBeOrdered(a) || !(a && a.isIdle)

    this._minAssignRoleDelayTicks = random.nextIntRange(0, info.scanTick)
  }

  // -----------------------------------------------------------------------
  // IBotTick (对应 OpenRA IBotTick.BotTick)
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    if (this._alertedTicks > 0) this._alertedTicks--

    if (--this._minAssignRoleDelayTicks <= 0) {
      this._minAssignRoleDelayTicks = this.info.scanTick

      let minelayingPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
      let useFavoritePosition = false
      let layMineOnHalfway = false

      // Process conflict positions
      while (this._conflictPositionLength > 0) {
        const pos = this._conflictPositionQueue[0]!
        minelayingPosition = pos
        const checks = this.hasInvalidActorInCircle(
          this.world.centerOfCell?.(pos) ?? { x: pos.x * 1024, y: pos.y * 1024, z: 0 },
          this.info.awayFromCellDistance * 1024,
        )
        if (checks.hasInvalidActors) {
          this.dequeueFirstConflictPosition()
        } else {
          layMineOnHalfway = checks.hasEnemyNearby
          break
        }
      }

      let minelayers: MinelayerPair[] | null = null

      if (this._conflictPositionLength === 0) {
        // No conflict positions — find a midpoint between unit and enemy
        if (this._favoritePositionsLength === 0) {
          minelayers = this.getMinelayers()
          if (minelayers.length === 0) return

          const enemies: ActorLike[] = []
          for (const a of this.world.actors) {
            if (this.isPreferredEnemyUnit(a)) enemies.push(a)
          }
          if (enemies.length === 0) return

          const prng = this.botRandom()
          const enemy = enemies[prng.nextIntRange(0, enemies.length - 1)]

          for (const ml of minelayers) {
            if (!this._pathFinder) {
              this._pathFinder = this.world.pathFinder as PathFinderLike
            }
            const cells = this._pathFinder?.findPathToTargetCell?.(
              ml.actor.actorId,
              [ml.actor.location],
              enemy.location,
            )
            if (cells && cells.length > 0) {
              this.enqueueConflictPosition(cells[cells.length >> 1])
              return
            }
          }
          return
        } else {
          // Use favorite positions
          while (this._favoritePositionsLength > 0) {
            const pos = this._favoritePositions[this._currentFavoritePositionIndex]!
            minelayingPosition = pos
            const checks = this.hasInvalidActorInCircle(
              this.world.centerOfCell?.(pos) ?? { x: pos.x * 1024, y: pos.y * 1024, z: 0 },
              this.info.awayFromCellDistance * 1024,
            )
            if (checks.hasInvalidActors) {
              this.deleteCurrentFavoritePosition()
              if (this._favoritePositionsLength === 0) return
            } else {
              layMineOnHalfway = checks.hasEnemyNearby
              useFavoritePosition = true
              break
            }
          }
        }
      }

      minelayers ??= this.getMinelayers()
      if (minelayers.length === 0) return

      // Find path for each minelayer
      const orderedActors: ActorLike[] = []
      for (const ml of minelayers) {
        const cells = this._pathFinder?.findPathToTargetCell?.(
          ml.actor.actorId,
          [ml.actor.location],
          minelayingPosition,
        )
        if (cells && cells.length > 0) {
          orderedActors.push(ml.actor)

          if (layMineOnHalfway) {
            minelayingPosition = cells[(cells.length * 1 / 4) | 0]
            layMineOnHalfway = false
          }

          if (orderedActors.length >= this.info.maxPerAssign) break
        }
      }

      if (orderedActors.length > 0) {
        if (useFavoritePosition) {
          this.nextFavoritePositionIndex()
        } else {
          this.dequeueFirstConflictPosition()
          this.addPositionToFavoritePositions(minelayingPosition)
        }

        const vec = { x: this.info.mineFieldRadius, y: this.info.mineFieldRadius }
        const orderedActorArr: number[] = []
        for (const a of orderedActors) orderedActorArr.push(a.actorId)

        bot.queueOrder({
          orderName: 'PlaceMinefield',
          targetPosition: { x: (minelayingPosition.x + vec.x) * 1024 + 512, y: (minelayingPosition.y + vec.y) * 1024 + 512, z: 0 },
          extraLocation: { x: minelayingPosition.x - vec.x, y: minelayingPosition.y - vec.y },
          groupedActors: orderedActorArr,
        } as unknown as Parameters<typeof bot.queueOrder>[0])

        bot.queueOrder({
          orderName: 'Move',
          subjectActor: orderedActors[0].actorId,
          targetPosition: { x: orderedActors[0].location.x * 1024 + 512, y: orderedActors[0].location.y * 1024 + 512, z: 0 },
          groupedActors: orderedActorArr,
        } as unknown as Parameters<typeof bot.queueOrder>[0])
      } else {
        if (useFavoritePosition) {
          this.deleteCurrentFavoritePosition()
        } else {
          this.dequeueFirstConflictPosition()
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // IBotRespondToAttack (对应 OpenRA IBotRespondToAttack.RespondToAttack)
  // ---------------------------------------------------------------------------

  respondToAttack(_bot: IBot, self: IGameActor, e: AttackInfo): void {
    if (this._alertedTicks > 0) return

    const attacker = e.attacker as unknown as ActorLike
    if (!this.isPreferredEnemyUnit(attacker)) return

    this._alertedTicks = MinelayerBotModule.REPEATED_ALERT_TICKS

    const selfActor = self as unknown as ActorLike
    const center = selfActor.centerPosition
    const hasInvalid = this.hasInvalidActorInCircle(
      center,
      this.info.awayFromCellDistance * 1024,
    )
    if (hasInvalid.hasInvalidActors) return

    const targetTypes = selfActor.getEnabledTargetTypes?.()
    const useEnemyLoc = targetTypes && !targetTypes.isEmpty
      && targetTypes.overlaps?.(this.info.useEnemyLocationTargetTypes)

    const pos = useEnemyLoc ? attacker.location : selfActor.location
    this.enqueueConflictPosition({ x: pos.x, y: pos.y, z: 0 })
  }

  // ---------------------------------------------------------------------------
  // Queue management
  // ---------------------------------------------------------------------------

  private enqueueConflictPosition(cell: { x: number; y: number; z: number }): void {
    if (this._conflictPositionLength < MinelayerBotModule.MAX_POSITION_CACHE_LENGTH) {
      this._conflictPositionQueue[this._conflictPositionLength] = cell
      this._conflictPositionLength++
    } else {
      this._conflictPositionQueue[MinelayerBotModule.MAX_POSITION_CACHE_LENGTH - 1] = cell
    }
  }

  private dequeueFirstConflictPosition(): void {
    for (let i = 1; i < this._conflictPositionLength; i++) {
      this._conflictPositionQueue[i - 1] = this._conflictPositionQueue[i]
    }
    this._conflictPositionQueue[this._conflictPositionLength - 1] = null
    this._conflictPositionLength--
  }

  private addPositionToFavoritePositions(cpos: { x: number; y: number; z: number }): void {
    const favDistSquare = this.info.favoritePositionDistance * this.info.favoritePositionDistance
    let closestIndex = 0
    let closestDistSquare = 2147483647

    for (let i = 0; i < this._favoritePositionsLength; i++) {
      const fav = this._favoritePositions[i]!
      const dx = fav.x - cpos.x
      const dy = fav.y - cpos.y
      const lengthsquare = dx * dx + dy * dy
      if (lengthsquare < closestDistSquare) {
        closestIndex = i
        closestDistSquare = lengthsquare
      }
    }

    if (closestDistSquare > favDistSquare && this._favoritePositionsLength < this._favoritePositions.length) {
      this._favoritePositions[this._favoritePositionsLength] = cpos
      this._favoritePositionsLength++
    } else if (this._favoritePositionsLength > 0) {
      const pos = this._favoritePositions[closestIndex]!
      this._favoritePositions[closestIndex] = {
        x: ((pos.x - cpos.x) / 2) + cpos.x,
        y: ((pos.y - cpos.y) / 2) + cpos.y,
        z: 0,
      }
    }
  }

  private deleteCurrentFavoritePosition(): void {
    for (let i = this._currentFavoritePositionIndex; i < this._favoritePositionsLength - 1; i++) {
      this._favoritePositions[i] = this._favoritePositions[i + 1]
    }
    this._favoritePositions[this._favoritePositionsLength - 1] = null
    if (--this._favoritePositionsLength > 0) {
      this._currentFavoritePositionIndex %= this._favoritePositionsLength
    }
  }

  private nextFavoritePositionIndex(): void {
    this._currentFavoritePositionIndex = (this._currentFavoritePositionIndex + 1) % this._favoritePositionsLength
  }

  // ---------------------------------------------------------------------------
  // Enemy checks (对应 OpenRA IsPreferredEnemyUnit / HasInvalidActorInCircle)
  // ---------------------------------------------------------------------------

  private isPreferredEnemyUnit(actor: ActorLike): boolean {
    if (!actor || actor.isDead) return false
    if (this.player.relationshipWith?.(actor.owner) !== 'Enemy') return false
    if (actor.info?.name === 'Husk') return false

    const targetTypes = actor.getEnabledTargetTypes?.()
    if (!targetTypes || targetTypes.isEmpty) return false

    if (this.info.ignoredEnemyTargetTypes.size > 0
      && targetTypes.overlaps?.(this.info.ignoredEnemyTargetTypes)) {
      return false
    }

    return true
  }

  private hasInvalidActorInCircle(
    pos: { x: number; y: number; z: number },
    dist: number,
  ): { hasInvalidActors: boolean; hasEnemyNearby: boolean } {
    let hasInvalidActor = false
    let hasEnemyActor = false

    const nearby = this.world.findActorsInCircle?.(pos, dist) ?? []
    for (const actor of nearby) {
      const rel = this.player.relationshipWith?.(actor.owner)

      if (rel === 'Ally') {
        const targetTypes = actor.getEnabledTargetTypes?.()
        if (targetTypes && !targetTypes.isEmpty) {
          if (this.info.awayFromAlliedTargetTypes.size > 0
            && targetTypes.overlaps?.(this.info.awayFromAlliedTargetTypes)) {
            hasInvalidActor = true
            break
          }
        }
      }

      if (rel === 'Enemy') {
        hasEnemyActor = true
        const targetTypes = actor.getEnabledTargetTypes?.()
        if (targetTypes && !targetTypes.isEmpty) {
          if (this.info.awayFromEnemyTargetTypes.size > 0
            && targetTypes.overlaps?.(this.info.awayFromEnemyTargetTypes)) {
            hasInvalidActor = true
            break
          }
        }
      }
    }

    return { hasInvalidActors: hasInvalidActor, hasEnemyNearby: hasEnemyActor }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getMinelayers(): MinelayerPair[] {
    const result: MinelayerPair[] = []
    for (const a of this.world.actors) {
      if (this._unitCannotBeOrderedOrIsBusy(a)) continue
      if (!this.info.minelayingActorTypes.has(a.info?.name ?? '')) continue
      const mlTrait = a.traitsImplementing?.('Minelayer')?.[0] as unknown
      if (!mlTrait) continue
      result.push({ actor: a, trait: mlTrait as MinelayerTraitLike })
    }
    return result
  }

  /** Cached PRNG. */
  private _cachedRandom: SimplePrng | null = null
  private botRandom(): SimplePrng {
    if (!this._cachedRandom) {
      this._cachedRandom = {
        nextIntRange: (min, max) => min >= max ? min : min + ((Math.abs((Math.imul(48271, min + 1) | 0)) % (max - min + 1))),
      } as SimplePrng
    }
    return this._cachedRandom
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._conflictPositionQueue.fill(null)
    this._favoritePositions.fill(null)
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
  readonly info?: { readonly name: string; hasTraitInfo?: (name: string) => boolean }
  traitsImplementing?: <T>(name: string) => T[]
  getEnabledTargetTypes?: () => { isEmpty: boolean; overlaps?: (other: unknown) => boolean }
}

interface PlayerLike {
  relationshipWith?(other: unknown): string
}

interface WorldLike {
  readonly actors: Iterable<ActorLike>
  centerOfCell?: (cell: { x: number; y: number; z: number }) => { x: number; y: number; z: number }
  findActorsInCircle?: (pos: { x: number; y: number; z: number }, radius: number) => ActorLike[]
  pathFinder?: unknown
}

interface PathFinderLike {
  findPathToTargetCell?: (
    actorId: number,
    sources: readonly { x: number; y: number }[],
    target: { x: number; y: number },
  ) => { x: number; y: number; z: number }[] | null
}

interface MinelayerPair {
  actor: ActorLike
  trait: MinelayerTraitLike
}

interface MinelayerTraitLike {
  // Marker for Minelayer trait
}
