/**
 * CaptureManagerBotModule.ts — AI structure capture management via engineers
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/CaptureManagerBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<CaptureManagerBotModuleInfo> → TypeScript class
 * - C# ActorIndex.OwnerAndNamesAndTrait<CapturesInfo> → duck-typed actor lists
 * - C# LINQ (Where, Select, OrderByDescending, Take, ToList, ToArray)
 *   → TypeScript for-loops (PERF: no allocation)
 * - C# ClosestToWithPathFrom → TypeScript manual distance comparison
 * - C# List<Actor> activeCapturers → TypeScript Array<ActorLike>
 * - C# MersenneTwister → SimplePrng
 *
 * Manages engineer-type units for capturing enemy/neutral structures.
 * Prioritizes high-value targets (tech > production > defense > resources).
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBot,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// CaptureManagerBotModuleInfo
// ---------------------------------------------------------------------------

export interface CaptureManagerBotModuleInfo extends ConditionalTraitInfo {
  readonly capturingActorTypes: ReadonlySet<string>
  readonly capturableActorTypes: ReadonlySet<string>
  readonly minimumCaptureDelay: number
  readonly maximumCaptureTargetOptions: number
  readonly checkCaptureTargetsForVisibility: boolean
  readonly capturableRelationships: number // bitmask of PlayerRelationship
}

// ---------------------------------------------------------------------------
// CaptureManagerBotModule
// ---------------------------------------------------------------------------

/**
 * AI capture management — assigns engineers to capture enemy/neutral structures.
 *
 * OpenRA 对照: CaptureManagerBotModule : ConditionalTrait<CaptureManagerBotModuleInfo>
 *
 * Implements: IBotTick
 */
export class CaptureManagerBotModule
  extends ConditionalTrait<CaptureManagerBotModuleInfo>
  implements IBotTick
{
  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  readonly world: WorldLike
  readonly player: PlayerLike
  readonly info: CaptureManagerBotModuleInfo

  /** Capturers already assigned to capture orders. */
  private readonly _activeCapturers: ActorLike[] = []

  /** Delay countdown between capture scans. */
  private _minCaptureDelayTicks: number

  /** Maximum capture targets to consider per decision. */
  private readonly _maximumCaptureTargetOptions: number

  // -----------------------------------------------------------------------
  // Predicates
  // -----------------------------------------------------------------------

  private readonly _unitCannotBeOrderedOrIsIdle: (a: ActorLike) => boolean

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: CaptureManagerBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this.world = world
    this.player = player
    this.info = info
    this._random = random

    this._maximumCaptureTargetOptions = Math.max(1, info.maximumCaptureTargetOptions)
    this._minCaptureDelayTicks = random.nextIntRange(0, info.minimumCaptureDelay)

    this._unitCannotBeOrderedOrIsIdle = (a) =>
      a.owner !== player || a.isDead || !a.isInWorld || a.isIdle
  }

  // -----------------------------------------------------------------------
  // IBotTick (对应 OpenRA IBotTick.BotTick)
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    if (--this._minCaptureDelayTicks <= 0) {
      this._minCaptureDelayTicks = this.info.minimumCaptureDelay
      this.queueCaptureOrders(bot)
    }
  }

  // ---------------------------------------------------------------------------
  // Capture order queuing (对应 OpenRA QueueCaptureOrders)
  // ---------------------------------------------------------------------------

  /**
   * Find idle capturers and assign them to high-value capture targets.
   *
   * OpenRA 对照: CaptureManagerBotModule.QueueCaptureOrders(IBot)
   */
  private queueCaptureOrders(bot: IBot): void {
    if (this.info.capturingActorTypes.size === 0) return

    // WinState check — player must still be active
    const ps = this.player as unknown as { winState?: string }
    if (ps.winState !== undefined && ps.winState !== 'Undefined') return

    // Clean up dead/idle capturers
    this._activeCapturers.splice(
      0,
      this._activeCapturers.length,
      ...this._activeCapturers.filter(a => !this._unitCannotBeOrderedOrIsIdle(a)),
    )

    // Find capturers with Captures trait
    const capturers: { actor: ActorLike; trait: CaptureTraitLike }[] = []

    for (const a of this.world.actors) {
      if (a.owner !== this.player) continue
      if (!a.isIdle) continue
      if (a.isDead || !a.isInWorld) continue
      if (!this.info.capturingActorTypes.has(a.info?.name ?? '')) continue
      if (this._activeCapturers.includes(a)) continue

      // Check if actor can capture
      const capturesTrait = a.traitsImplementing?.('Captures')?.[0] as CaptureTraitLike | undefined
      if (!capturesTrait) continue

      capturers.push({ actor: a, trait: capturesTrait })
    }

    if (capturers.length === 0) return

    // Find a random non-spectating enemy/neutral player
    const eligiblePlayers: PlayerLike[] = []
    const capturableRel = this.info.capturableRelationships
    for (const p of this.world.players ?? []) {
      if (p === this.player) continue
      const ps2 = p as unknown as { spectating?: boolean }
      if (ps2.spectating) continue
      // Check relationship bitmask
      const rel = (this.player as unknown as { relationshipBitsWith?: (other: PlayerLike) => number })
        .relationshipBitsWith?.(p) ?? 0
      if (rel & capturableRel) {
        eligiblePlayers.push(p)
      }
    }

    if (eligiblePlayers.length === 0) return

    const prng = this.botRandom()
    const randPlayer = eligiblePlayers[prng.nextIntRange(0, eligiblePlayers.length - 1)]

    // Get capturable targets from that player
    const targets = this.getCapturableTargets(randPlayer, capturers)
    if (targets.length === 0) return

    // Assign capturers to closest targets
    for (const capturer of capturers) {
      // Find closest target by path distance (simplified: Manhattan distance)
      let bestTarget: ActorLike | null = null
      let bestDist = 2147483647

      for (const t of targets) {
        const dx = capturer.actor.location.x - t.location.x
        const dy = capturer.actor.location.y - t.location.y
        const dist = Math.abs(dx) + Math.abs(dy) // Manhattan estimate
        if (dist < bestDist) {
          bestDist = dist
          bestTarget = t
        }
      }

      if (bestTarget) {
        bot.queueOrder({
          orderName: 'CaptureActor',
          targetActorId: bestTarget.actorId,
        } as unknown as Parameters<typeof bot.queueOrder>[0])
        this._activeCapturers.push(capturer.actor)
        // One capturer per target
        const idx = targets.indexOf(bestTarget)
        if (idx >= 0) targets.splice(idx, 1)
      }
    }
  }

  private getCapturableTargets(
    targetPlayer: PlayerLike,
    capturers: readonly { actor: ActorLike; trait: CaptureTraitLike }[],
  ): ActorLike[] {
    const result: ActorLike[] = []

    for (const a of this.world.actors) {
      if (a.owner !== targetPlayer) continue
      if (a.isDead || !a.isInWorld) continue

      // Visibility check
      if (this.info.checkCaptureTargetsForVisibility) {
        if (!a.canBeViewedByPlayer?.(this.player)) continue
      }

      // Check if target has CaptureManager (capturable)
      const captureMgr = a.traitsImplementing?.('CaptureManager')?.[0] as CaptureManagerLike | undefined
      if (!captureMgr) continue

      // Check if any capturer can capture this target
      let canCapture = false
      for (const c of capturers) {
        if (c.trait.canTarget?.(captureMgr)) {
          canCapture = true
          break
        }
      }
      if (!canCapture) continue

      // Filter by capturable actor types
      if (this.info.capturableActorTypes.size > 0) {
        const name = (a.info?.name ?? '').toLowerCase()
        if (!this.info.capturableActorTypes.has(name)) continue
      }

      result.push(a)
    }

    // Sort by sell value descending, then take top N
    result.sort((a, b) => (this.getSellValue(b) - this.getSellValue(a)) | 0)
    if (result.length > this._maximumCaptureTargetOptions) {
      result.length = this._maximumCaptureTargetOptions
    }

    return result
  }

  private getSellValue(a: ActorLike): number {
    // Duck-type: get sell value from Valued trait
    const valued = a.traitsImplementing?.('Valued')?.[0] as { cost?: number } | undefined
    return valued?.cost ?? 0
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /** Deterministic PRNG stored at construction — NO per-frame allocation. */
  private readonly _random: SimplePrng

  private botRandom(): SimplePrng {
    return this._random
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._activeCapturers.length = 0
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
  readonly info?: { readonly name: string }
  traitsImplementing?: <T>(name: string) => T[]
  canBeViewedByPlayer?: (player: PlayerLike) => boolean
}

interface PlayerLike {
  readonly playerName?: string
}

interface WorldLike {
  readonly actors: Iterable<ActorLike>
  readonly players?: Iterable<PlayerLike>
}

interface CaptureTraitLike {
  canTarget?: (target: CaptureManagerLike) => boolean
}

interface CaptureManagerLike {
  // Marker interface for capturable actors
}
