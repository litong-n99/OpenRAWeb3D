/**
 * SupportPowerBotModule.ts — AI superweapon / support power targeting
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/SupportPowerBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<SupportPowerBotModuleInfo> → TypeScript ConditionalTrait
 * - C# SupportPowerDecision custom scoring → TypeScript weighted target scoring
 * - C# FindCoarseAttackLocation / FindFineAttackLocation grid scanning
 *   → TypeScript coarse→fine two-pass target search
 * - C# IBotTick.BotTick() with delay dictionary → TypeScript tick() with delays
 * - C# MersenneTwister randomization → SimplePrng / deterministic selection
 * - C# uint.MaxValue ExtraData → TypeScript sentinel value for "no direction"
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBot,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// SupportPowerDecision — configuration for each support power use case
// ---------------------------------------------------------------------------

/**
 * Decision rule for when to use a support power.
 *
 * OpenRA 对照: SupportPowerDecision class
 */
export interface SupportPowerDecision {
  readonly orderName: string
  readonly coarseScanRadius: number
  readonly fineScanRadius: number
  readonly minimumAttractiveness: number
  readonly getAttractiveness: (targets: unknown, player: unknown) => number
  readonly getNextScanTime: (world: unknown) => number
}

// ---------------------------------------------------------------------------
// SupportPowerBotModuleInfo
// ---------------------------------------------------------------------------

export interface SupportPowerBotModuleInfo extends ConditionalTraitInfo {
  readonly decisions: readonly SupportPowerDecision[]
}

// ---------------------------------------------------------------------------
// SupportPowerBotModule
// ---------------------------------------------------------------------------

/**
 * AI support power management — finds optimal targets for superweapons.
 *
 * OpenRA 对照: SupportPowerBotModule class
 */
export class SupportPowerBotModule
  extends ConditionalTrait<SupportPowerBotModuleInfo>
  implements IBotTick
{
  /** Maps power instances to their delay counters. */
  private readonly _waitingPowers = new Map<string, number>()

  /** Maps order names to their decision rules. */
  private readonly _powerDecisions = new Map<string, SupportPowerDecision>()

  /** Cached world reference for scanning. */
  private readonly _world: WorldLike

  /** Cached player reference. */
  private readonly _player: PlayerLike

  /** Cached random generator. */
  private readonly _random: SimplePrng

  /** SupportPowerManager reference (duck-typed). */
  private _supportPowerManager: SupportPowerManagerLike | null = null

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  /** Sentinel value indicating no directional target (OpenRA: uint.MaxValue). */
  static readonly NO_DIRECTION = 0xFFFFFFFF

  /** Delay ticks after issuing a power order to prevent re-scanning. */
  static readonly POST_ORDER_DELAY = 10

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: SupportPowerBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this._world = world
    this._player = player
    this._random = random

    // Index decisions by order name
    for (const decision of info.decisions) {
      this._powerDecisions.set(decision.orderName, decision)
    }
  }

  // -----------------------------------------------------------------------
  // IBotTick
  // -----------------------------------------------------------------------

  botTick(bot: IBot): void {
    if (!this._supportPowerManager) return

    const stalePowers: string[] = []

    for (const [key, sp] of this._supportPowerManager.powers) {
      if (sp.disabled) continue

      // Initialize delay
      let delay = this._waitingPowers.get(key)
      if (delay === undefined) {
        delay = 0
        this._waitingPowers.set(key, delay)
      }

      if (delay > 0) {
        this._waitingPowers.set(key, delay - 1)
      }

      const isDelayed = (this._waitingPowers.get(key) ?? 0) > 0

      if (sp.ready && !isDelayed) {
        const decision = this._powerDecisions.get(sp.info.orderName)
        if (!decision) continue

        // Coarse scan
        const attackLocation = this.findCoarseAttackLocation(sp, decision)
        if (!attackLocation) {
          this._waitingPowers.set(key,
            (this._waitingPowers.get(key) ?? 0) + decision.getNextScanTime(this._world),
          )
          continue
        }

        // Fine scan
        const fineLocation = this.findFineAttackLocation(sp, decision, attackLocation)
        if (!fineLocation) {
          this._waitingPowers.set(key,
            (this._waitingPowers.get(key) ?? 0) + decision.getNextScanTime(this._world),
          )
          continue
        }

        // Valid target found — delay and fire
        this._waitingPowers.set(key, SupportPowerBotModule.POST_ORDER_DELAY)

        bot.queueOrder({
          orderName: sp.info.orderName,
          targetString: `${fineLocation.x},${fineLocation.y}`,
          extraData: SupportPowerBotModule.NO_DIRECTION,
        } as unknown as Parameters<IBot['queueOrder']>[0])
      }

      // Track stale powers
      if (!this._supportPowerManager.powers.has(key)) {
        stalePowers.push(key)
      }
    }

    // Clean up stale power entries
    for (const key of stalePowers) {
      this._waitingPowers.delete(key)
    }
  }

  // -----------------------------------------------------------------------
  // Coarse scanning (对应 OpenRA FindCoarseAttackLocationToSupportPower)
  // -----------------------------------------------------------------------

  /**
   * Scan the map in coarse chunks to find candidate target regions.
   *
   * OpenRA 对照: SupportPowerBotModule.FindCoarseAttackLocationToSupportPower()
   */
  private findCoarseAttackLocation(
    _sp: SupportPowerInstanceLike,
    decision: SupportPowerDecision,
  ): { x: number; y: number } | null {
    const map = this._world.map
    if (!map) return null

    const checkRadius = decision.coarseScanRadius
    const suitableLocations: { uv: { x: number; y: number }; attractiveness: number }[] = []
    let totalAttractiveness = 0

    for (let i = 0; i < map.size.width; i += checkRadius) {
      for (let j = 0; j < map.size.height; j += checkRadius) {
        const tl = { x: i, y: j }
        const br = { x: i + checkRadius, y: j + checkRadius }

        const wtl = map.centerOfCell(tl)
        const wbr = map.centerOfCell(br)

        const targets = this._world.actorsInBox?.(wtl, wbr) ?? []
        const playerUnknown = this._player as unknown

        const attractiveness = decision.getAttractiveness(targets, playerUnknown)
        if (attractiveness < decision.minimumAttractiveness) continue

        suitableLocations.push({ uv: tl, attractiveness })
        totalAttractiveness += attractiveness
      }
    }

    if (suitableLocations.length === 0) return null

    // Pick a random location with above-average attractiveness
    const averageAttractiveness = (totalAttractiveness / suitableLocations.length) | 0
    const aboveAverage = suitableLocations.filter(
      x => x.attractiveness >= averageAttractiveness,
    )

    if (aboveAverage.length === 0) return null

    const idx = this._random.nextIntRange(0, aboveAverage.length - 1)
    return aboveAverage[idx].uv
  }

  // -----------------------------------------------------------------------
  // Fine scanning (对应 OpenRA FindFineAttackLocationToSupportPower)
  // -----------------------------------------------------------------------

  /**
   * Scan an area in detail to find the best precise target cell.
   *
   * OpenRA 对照: SupportPowerBotModule.FindFineAttackLocationToSupportPower()
   */
  private findFineAttackLocation(
    __sp: SupportPowerInstanceLike,
    decision: SupportPowerDecision,
    checkPos: { x: number; y: number },
    extendedRange: number = 1,
  ): { x: number; y: number } | null {
    const checkRadius = decision.coarseScanRadius
    const fineCheck = decision.fineScanRadius
    let bestLocation: { x: number; y: number } | null = null
    let bestAttractiveness = 0

    for (let i = 0 - extendedRange; i <= checkRadius + extendedRange; i += fineCheck) {
      const x = checkPos.x + i

      for (let j = 0 - extendedRange; j <= checkRadius + extendedRange; j += fineCheck) {
        const y = checkPos.y + j
        const pos = this._world.map?.centerOfCell({ x, y })
        if (!pos) continue

        const playerUnknown = this._player as unknown
        const attractiveness = decision.getAttractiveness(pos, playerUnknown)

        if (attractiveness <= bestAttractiveness) continue
        if (attractiveness < decision.minimumAttractiveness) continue

        bestAttractiveness = attractiveness
        bestLocation = { x, y }
      }
    }

    return bestLocation
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._waitingPowers.clear()
    this._powerDecisions.clear()
    super.dispose()
  }
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

interface SupportPowerInstanceLike {
  disabled: boolean
  ready: boolean
  key: string
  info: { orderName: string }
}

interface SupportPowerManagerLike {
  powers: Map<string, SupportPowerInstanceLike>
  self: unknown
}

interface MapLike {
  size: { width: number; height: number }
  centerOfCell(cell: { x: number; y: number }): { x: number; y: number; z: number }
}

interface WorldLike {
  map?: MapLike
  actorsInBox?: (tl: unknown, br: unknown) => unknown[]
}

interface PlayerLike {
  playerName?: string
}
