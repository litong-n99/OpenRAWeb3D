/**
 * AutoCrusher.ts -- Trait that automatically scans for and crushes crushable actors
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AutoCrusher.cs (103 lines)
 *
 * 核心范式转换:
 * - C# AutoCrusherInfo : PausableConditionalTraitInfo, Requires<IMoveInfo> →
 *   TS ConditionalTraitInfo
 * - C# PausableConditionalTrait → TS ConditionalTrait with _paused field
 * - C# INotifyIdle.TickIdle() → TS INotifyIdle.tickIdle()
 * - C# world.FindActorsInCircle() → duck-typed spatial query
 * - C# Aircraft / Land activity → TODO-8.D.AIRCRAFT
 * - C# Cloak / IgnoresDisguiseInfo → duck-typed check
 */

import type { WDist } from '../../OpenRA.Game/WDist.js'
import { BitSet } from '../../OpenRA.Game/Primitives/BitSet.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyIdle,
  type IMoveInfo,
  type IMove,
  PlayerRelationship,
  PlayerRelationshipExts,
  type BitSetStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type CrushClass,
  CRUSH_CLASS_TYPENAME,
} from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AutoCrusherInfo
// OpenRA 对照: AutoCrusherInfo (PausableConditionalTraitInfo, Requires<IMoveInfo>)
// ---------------------------------------------------------------------------

/** Configuration for AutoCrusher trait.
 *
 *  OpenRA 对照: AutoCrusherInfo
 */
export class AutoCrusherInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Maximum range to scan for targets.
   *
   *  OpenRA 对照: AutoCrusherInfo.ScanRadius (default WDist.FromCells(5))
   */
  readonly scanRadius: WDist

  /** The minimal amount of ticks to wait between scanning for targets.
   *
   *  OpenRA 对照: AutoCrusherInfo.MinimumScanTimeInterval (default 10)
   */
  readonly minimumScanTimeInterval: number = 10

  /** The maximal amount of ticks to wait between scanning for targets.
   *
   *  OpenRA 对照: AutoCrusherInfo.MaximumScanTimeInterval (default 15)
   */
  readonly maximumScanTimeInterval: number = 15

  /** The crush class(es) that can be automatically crushed.
   *
   *  OpenRA 对照: AutoCrusherInfo.CrushClasses (default empty)
   */
  readonly crushClasses: BitSet<CrushClass>

  /** Player relationships the owner of the actor needs to get targeted.
   *
   *  OpenRA 对照: AutoCrusherInfo.TargetRelationships
   *  (default Ally | Neutral | Enemy)
   */
  readonly targetRelationships: PlayerRelationship

  /** Whether this actor can see through disguise.
   *
   *  OpenRA 对照: self.Info.HasTraitInfo<IgnoresDisguiseInfo>()
   *
   *  TODO-8.D.IGNORES-DISGUISE: In OpenRA, this is determined dynamically at
   *  runtime via self.Info.HasTraitInfo<IgnoresDisguiseInfo>(). For now, use a
   *  config option. When the full trait system supports dynamic trait info
   *  queries, replace this with a runtime check.
   */
  readonly ignoresDisguise: boolean = false

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    scanRadius?: WDist
    minimumScanTimeInterval?: number
    maximumScanTimeInterval?: number
    crushClasses?: readonly string[]
    targetRelationships?: PlayerRelationship
    ignoresDisguise?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    // Default: 5 cell scan radius
    this.scanRadius = params.scanRadius ?? ({ length: 5120, _brand: 'WDist' } as unknown as WDist)
    this.minimumScanTimeInterval = params.minimumScanTimeInterval ?? 10
    this.maximumScanTimeInterval = params.maximumScanTimeInterval ?? 15
    this.crushClasses = new BitSet<CrushClass>(
      CRUSH_CLASS_TYPENAME,
      ...(params.crushClasses ?? []),
    )
    this.targetRelationships = params.targetRelationships ?? (
      (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
    )
    this.ignoresDisguise = params.ignoresDisguise ?? false
  }
}

// ---------------------------------------------------------------------------
// AutoCrusher
// OpenRA 对照: AutoCrusher (ConditionalTrait<AutoCrusherInfo>, INotifyIdle)
// ---------------------------------------------------------------------------

/** Automatically crush crushable actors when idle.
 *
 *  OpenRA 对照: AutoCrusher
 */
export class AutoCrusher
  extends ConditionalTrait<AutoCrusherInfo>
  implements INotifyIdle
{
  /** Countdown to next scan.
   *
   *  OpenRA 对照: AutoCrusher.nextScanTime
   */
  private _nextScanTime: number = 0

  /** Pre-resolved move capability. */
  private _move: IMove | null = null

  /** Pre-resolved move info. */
  private _moveInfo: IMoveInfo | null = null

  // NOTE: Aircraft check deferred (TODO-8.D.AIRCRAFT). When Aircraft trait is
  // migrated, add _isAircraft field and set it from `move is Aircraft`.
  // private _isAircraft: boolean = false

  /** Whether this actor ignores disguise.
   *
   *  OpenRA 对照: self.Info.HasTraitInfo<IgnoresDisguiseInfo>()
   *
   *  TODO-8.D.IGNORES-DISGUISE: Currently uses the config option from info.
   *  When the full trait system supports dynamic trait info queries, add a
   *  runtime fallback via self.Info.HasTraitInfo equivalent.
   */
  private readonly _ignoresDisguise: boolean

  constructor(info: AutoCrusherInfo) {
    super(info)
    this._ignoresDisguise = info.ignoresDisguise
  }

  // -----------------------------------------------------------------------
  // INotifyIdle — tickIdle (periodic crush scan)
  // OpenRA 对照: INotifyIdle.TickIdle(Actor)
  // -----------------------------------------------------------------------

  tickIdle(self: IGameActor): void {
    if (this.isTraitDisabled || this.isTraitPaused || this._nextScanTime-- > 0) {
      return
    }

    // Lazy-resolve move traits on first idle tick
    if (this._move === null) {
      this._move = (self as unknown as {
        trait?: <T>(_tag: string) => T | null
      }).trait?.<IMove>('IMove') ?? null
    }
    if (this._moveInfo === null) {
      this._moveInfo = (self as unknown as {
        info?: {
          traitInfo?: <T>(_tag: string) => T | null
        }
      }).info?.traitInfo?.<IMoveInfo>('IMoveInfo') ?? null
    }

    // Scan for crushable targets in range
    const world = (self as unknown as {
      world?: {
        findActorsInCircle?: (pos: unknown, radius: WDist) => readonly IGameActor[]
        sharedRandom?: { next(min?: number, max?: number): number }
      }
    }).world

    if (!world || !world.findActorsInCircle) return

    const aSelf = self as unknown as {
      centerPosition?: unknown
    }
    const centerPos = aSelf.centerPosition
    if (!centerPos) return

    const actors = world.findActorsInCircle(centerPos, this.info.scanRadius)

    // Filter valid crush targets
    const validTargets = actors.filter(a => this._isValidCrushTarget(self, a))

    if (validTargets.length === 0) return

    // Find closest target (simplified: pick first — OpenRA uses ClosestToWithPathFrom)
    // TODO-8.D.PATHFINDER-CLOSEST: Use pathfinding distance instead of simple first-match
    // TODO-8.D.AIRCRAFT/LAND: When activities (Land/MoveTo) are migrated, queue crush
    // movement here. The selected crush target is validTargets[0].

    // Reset scan timer with random interval
    const rand = world.sharedRandom
    if (rand) {
      this._nextScanTime = rand.next(
        this.info.minimumScanTimeInterval,
        this.info.maximumScanTimeInterval,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Trait enabled — initialize scan timer
  // OpenRA 对照: TraitEnabled(Actor)
  // -----------------------------------------------------------------------

  protected override traitEnabled(self: IGameActor): void {
    super.traitEnabled(self)
    const world = (self as unknown as {
      world?: { sharedRandom?: { next(min?: number, max?: number): number } }
    }).world
    const rand = world?.sharedRandom
    this._nextScanTime = rand
      ? rand.next(this.info.minimumScanTimeInterval, this.info.maximumScanTimeInterval)
      : this.info.minimumScanTimeInterval
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Check if a target actor is a valid crush target.
   *
   *  OpenRA 对照: AutoCrusher.IsValidCrushTarget(Actor, Actor)
   */
  private _isValidCrushTarget(self: IGameActor, target: IGameActor): boolean {
    if (target.actorId === self.actorId || target.isDead || !target.isInWorld) {
      return false
    }

    // Check that they're not at the same location
    const selfLoc = (self as unknown as { location?: unknown }).location
    const targetLoc = (target as unknown as { location?: unknown }).location
    if (selfLoc !== undefined && targetLoc !== undefined && selfLoc === targetLoc) {
      return false
    }

    // Check ground level
    const t = target as unknown as { isAtGroundLevel?: () => boolean }
    if (t.isAtGroundLevel && !t.isAtGroundLevel()) return false

    // Check relationship
    const selfOwner = (self as unknown as { owner?: { relationshipWith(other: unknown): PlayerRelationship } }).owner
    const targetOwner = target.owner
    if (!selfOwner || !targetOwner) return false

    const targetRelationship = selfOwner.relationshipWith(targetOwner)

    // Check disguise
    const effectiveOwner = (target as unknown as {
      effectiveOwner?: { owner?: unknown } | null
    }).effectiveOwner?.owner

    if (effectiveOwner !== undefined && effectiveOwner !== null && !this._ignoresDisguise) {
      if (targetRelationship !== PlayerRelationship.Ally) {
        if (!PlayerRelationshipExts.hasRelationship(
          this.info.targetRelationships,
          selfOwner.relationshipWith(effectiveOwner),
        )) {
          return false
        }
      }
    } else if (!PlayerRelationshipExts.hasRelationship(
      this.info.targetRelationships,
      targetRelationship,
    )) {
      return false
    }

    // Check cloak
    const cloaks = (target as unknown as {
      traitsImplementing?: <T>(_tag: string) => readonly T[]
    }).traitsImplementing?.<{
      isTraitDisabled?: boolean
      isVisible?(target: IGameActor, player: unknown): boolean
    }>('Cloak') ?? []

    for (const c of cloaks) {
      if (!c.isTraitDisabled && !(c.isVisible?.(target, selfOwner) ?? true)) {
        return false
      }
    }

    // Check crushable
    const crushables = (target as unknown as {
      crushables?: readonly {
        crushableBy(a: IGameActor, b: IGameActor, c: BitSetStub<unknown>): boolean
      }[]
    }).crushables

    if (!crushables) return false

    return crushables.some(c => c.crushableBy(target, self, this.info.crushClasses as unknown as BitSetStub<unknown>))
  }
}
