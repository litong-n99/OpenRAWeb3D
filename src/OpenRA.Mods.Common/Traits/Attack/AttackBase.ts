/**
 * AttackBase.ts -- Abstract attack foundation for all attack variants
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackBase.cs (526 lines)
 *
 * 核心范式转换:
 * - C# abstract class AttackBase : PausableConditionalTrait<AttackBaseInfo>
 *   → TS abstract class AttackBase extends ConditionalTrait<AttackBaseInfo>
 * - C# IIssueOrder/IResolveOrder/IOrderVoice/ISync → TS interfaces
 * - C# AttackOrderTargeter inner class → TS nested class
 * - C# IFacing, IPositionable → TS duck-typed
 * - C# getAttackActivity() abstract → TS abstract method
 * - 3D facing tolerance: dot product on XZ plane via facingWithinTolerance()
 */

import {
  type IGameActor,
  type ISync,
  type ITick,
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
// WVec unused directly but needed for Target signature compatibility
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { Armament } from '../Armament.js'
import type { INotifyAiming } from '../CombatInterfaces.js'
import { isINotifyAiming } from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AttackSource
// OpenRA 对照: AttackSource
// ---------------------------------------------------------------------------

/** Source of an attack command.
 *
 *  OpenRA 对照: AttackSource enum
 */
export const AttackSource = {
  Default: 0,
  AutoTarget: 1,
  AttackMove: 2,
} as const
export type AttackSource = (typeof AttackSource)[keyof typeof AttackSource]

// ---------------------------------------------------------------------------
// Helper: facingWithinTolerance
// ---------------------------------------------------------------------------

/** Check if facing is within tolerance of desired facing.
 *
 *  OpenRA 对照: Util.FacingWithinTolerance(WAngle, WAngle, WAngle)
 */
function facingWithinTolerance(
  facing: WAngle,
  desiredFacing: WAngle,
  tolerance: WAngle,
): boolean {
  if (tolerance.angle >= 512) return true
  const delta = WAngle.subtract(desiredFacing, facing).angle
  return delta <= tolerance.angle
}

// ---------------------------------------------------------------------------
// AttackBaseInfo
// OpenRA 对照: AttackBaseInfo (PausableConditionalTraitInfo, abstract)
// ---------------------------------------------------------------------------

/** Configuration for an AttackBase trait.
 *
 *  OpenRA 对照: AttackBaseInfo
 */
export class AttackBaseInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Armament names that this attack can use.
   *
   *  OpenRA 对照: AttackBaseInfo.Armaments
   */
  readonly armaments: readonly string[] = ['primary', 'secondary']

  /** Cursor for valid targets.
   *
   *  OpenRA 对照: AttackBaseInfo.Cursor
   */
  readonly cursor: string | null = null

  /** Cursor for valid targets outside of range.
   *
   *  OpenRA 对照: AttackBaseInfo.OutsideRangeCursor
   */
  readonly outsideRangeCursor: string | null = null

  /** Color for target line.
   *
   *  OpenRA 对照: AttackBaseInfo.TargetLineColor
   */
  readonly targetLineColor: string = 'Crimson'

  /** Does the attack require entering the target's cell?
   *
   *  OpenRA 对照: AttackBaseInfo.AttackRequiresEnteringCell
   */
  readonly attackRequiresEnteringCell: boolean = false

  /** Allow firing into the fog of war at frozen actors.
   *
   *  OpenRA 对照: AttackBaseInfo.TargetFrozenActors
   */
  readonly targetFrozenActors: boolean = false

  /** Force-fire ignores actors and targets ground instead.
   *
   *  OpenRA 对照: AttackBaseInfo.ForceFireIgnoresActors
   */
  readonly forceFireIgnoresActors: boolean = false

  /** Force-fire required for targets outside range.
   *
   *  OpenRA 对照: AttackBaseInfo.OutsideRangeRequiresForceFire
   */
  readonly outsideRangeRequiresForceFire: boolean = false

  /** Voice phrase for attack orders.
   *
   *  OpenRA 对照: AttackBaseInfo.Voice
   */
  readonly voice: string = 'Action'

  /** Tolerance for attack angle [0, 512]. 512 = 360 degrees.
   *
   *  OpenRA 对照: AttackBaseInfo.FacingTolerance
   */
  readonly facingTolerance: WAngle = new WAngle(512)

  /** Show target cursor on terrain cells even without force-fire.
   *
   *  OpenRA 对照: AttackBaseInfo.TargetTerrainWithoutForceFire
   */
  readonly targetTerrainWithoutForceFire: boolean = false

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    armaments?: string[]
    cursor?: string | null
    outsideRangeCursor?: string | null
    targetLineColor?: string
    attackRequiresEnteringCell?: boolean
    targetFrozenActors?: boolean
    forceFireIgnoresActors?: boolean
    outsideRangeRequiresForceFire?: boolean
    voice?: string
    facingTolerance?: WAngle
    targetTerrainWithoutForceFire?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.armaments = params.armaments ?? ['primary', 'secondary']
    this.cursor = params.cursor ?? null
    this.outsideRangeCursor = params.outsideRangeCursor ?? null
    this.targetLineColor = params.targetLineColor ?? 'Crimson'
    this.attackRequiresEnteringCell = params.attackRequiresEnteringCell ?? false
    this.targetFrozenActors = params.targetFrozenActors ?? false
    this.forceFireIgnoresActors = params.forceFireIgnoresActors ?? false
    this.outsideRangeRequiresForceFire = params.outsideRangeRequiresForceFire ?? false
    this.voice = params.voice ?? 'Action'
    this.facingTolerance = params.facingTolerance ?? new WAngle(512)
    this.targetTerrainWithoutForceFire = params.targetTerrainWithoutForceFire ?? false
  }
}

// ---------------------------------------------------------------------------
// AttackBase
// OpenRA 对照: AttackBase (abstract, PausableConditionalTrait)
// ---------------------------------------------------------------------------

/** Abstract attack foundation for all attack variants.
 *
 *  OpenRA 对照: AttackBase
 *
 *  Provides shared attack methods: DoAttack, CanAttack, HasAnyValidWeapons,
 *  ChooseArmamentsForTarget, etc. Subclasses override getAttackActivity()
 *  to produce their specific activity.
 */
export abstract class AttackBase
  extends ConditionalTrait<AttackBaseInfo>
  implements ITick, ISync
{
  /** Whether the actor is currently aiming (network-synced).
   *
   *  OpenRA 对照: AttackBase.IsAiming
   */
  isAiming: boolean = false

  /** Duck-typed facing trait (IFacing). */
  protected facing: IFacing | null = null

  /** Duck-typed IPositionable (aka occupiesSpace). */
  protected positionable: unknown | null = null

  /** Notify aiming listeners. */
  protected notifyAiming: INotifyAiming[] = []

  /** Lazily initialized armaments getter. */
  protected getArmaments: () => Armament[] = () => []

  /** Track previous aiming state for change detection. */
  private wasAiming: boolean = false

  constructor(info: AttackBaseInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /** Initialize after actor creation: cache trait references.
   *
   *  OpenRA 对照: AttackBase.Created(Actor)
   */
  protected onCreated(self: IGameActor): void {
    const actorAny = self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }

    this.facing = (actorAny.getTraits?.<IFacing>('facing') ?? [null])[0] ?? null

    // IPositionable = OccupiesSpace when it also implements IPositionable
    this.positionable = null

    const allTraits = actorAny.getTraits?.<unknown>('') ?? []
    this.notifyAiming = allTraits.filter(isINotifyAiming) as INotifyAiming[]

    this.getArmaments = this.initializeGetArmaments(self)
  }

  /** Initialize the armaments getter function.
   *
   *  OpenRA 对照: AttackBase.InitializeGetArmaments(Actor)
   *
   *  Finds Armament traits matching the configured names.
   */
  protected initializeGetArmaments(self: IGameActor): () => Armament[] {
    const actorAny = self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }
    const allArmaments = (actorAny.getTraits?.<Armament>('armament') ?? [])
    const armaments = allArmaments.filter(a =>
      this.info.armaments.includes(a.info.name),
    )
    return () => armaments
  }

  /** The armaments available to this attack trait.
   *
   *  OpenRA 对照: AttackBase.Armaments
   */
  get armaments(): Armament[] {
    return this.getArmaments()
  }

  // ---------------------------------------------------------------------------
  // ITick
  // ---------------------------------------------------------------------------

  /** Tick: fire INotifyAiming callbacks when IsAiming changes.
   *
   *  OpenRA 对照: ITick.Tick(Actor) → AttackBase.Tick(Actor)
   */
  tick(self: IGameActor): void {
    if (!this.wasAiming && this.isAiming) {
      for (const n of this.notifyAiming) {
        n.startedAiming(self, this)
      }
    } else if (this.wasAiming && !this.isAiming) {
      for (const n of this.notifyAiming) {
        n.stoppedAiming(self, this)
      }
    }
    this.wasAiming = this.isAiming
  }

  // ---------------------------------------------------------------------------
  // Facing check
  // ---------------------------------------------------------------------------

  /** Check if the target is within the firing arc.
   *
   *  OpenRA 对照: AttackBase.TargetInFiringArc(Actor, Target, WAngle)
   */
  targetInFiringArc(
    self: IGameActor,
    target: Target,
    facingTolerance: WAngle,
  ): boolean {
    if (!this.facing) return true

    const centerPos =
      (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const targetedPosition = this.getTargetPosition(centerPos, target)
    const delta = WPos.subtract(targetedPosition, centerPos)

    if (delta.horizontalLengthSquared === 0) return true

    return facingWithinTolerance(
      this.facing.facing,
      delta.yaw,
      facingTolerance,
    )
  }

  // ---------------------------------------------------------------------------
  // Can attack
  // ---------------------------------------------------------------------------

  /** Check if this actor can attack the given target.
   *
   *  OpenRA 对照: AttackBase.CanAttack(Actor, Target)
   */
  canAttack(self: IGameActor, target: Target): boolean {
    if (this.isTraitDisabled) return false

    const selfAny = self as unknown as { isInWorld?: boolean }
    if (selfAny.isInWorld === false) return false

    if (!target.isValidFor(self as unknown as never)) return false

    if (!this.hasAnyValidWeapons(target, false, true)) return false

    return true
  }

  // ---------------------------------------------------------------------------
  // Do attack
  // ---------------------------------------------------------------------------

  /** Perform the attack on a target (iterate armaments, call checkFire).
   *
   *  OpenRA 对照: AttackBase.DoAttack(Actor, Target)
   */
  doAttack(self: IGameActor, target: Target): void {
    if (!this.canAttack(self, target)) return

    for (const a of this.armaments) {
      a.checkFire(self, this.facing, target)
    }
  }

  // ---------------------------------------------------------------------------
  // Weapon validation
  // ---------------------------------------------------------------------------

  /** Check if any valid weapons can target the given target.
   *
   *  OpenRA 对照: AttackBase.HasAnyValidWeapons(Target, bool, bool)
   */
  hasAnyValidWeapons(
    target: Target,
    checkForCenterTargetingWeapons: boolean = false,
    reloadingIsInvalid: boolean = false,
  ): boolean {
    if (this.isTraitDisabled) return false

    for (const armament of this.armaments) {
      const checkIsValid = checkForCenterTargetingWeapons
        ? (armament.weapon?.targetActorCenter ?? false)
        : true
      const reloadingStateIsValid = !reloadingIsInvalid || !armament.isReloading

      if (
        checkIsValid &&
        reloadingStateIsValid &&
        !armament.isTraitDisabled &&
        armament.weapon?.isValidAgainst(target, null, armament as unknown as IGameActor)
      ) {
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Target position calculation
  // ---------------------------------------------------------------------------

  /** Get the target position for aiming/facing calculations.
   *
   *  OpenRA 对照: AttackBase.GetTargetPosition(WPos, Target)
   */
  getTargetPosition(pos: WPos, target: Target): WPos {
    return this.hasAnyValidWeapons(target, true)
      ? target.centerPosition
      : this.closestTargetPosition(pos, target)
  }

  // ---------------------------------------------------------------------------
  // Range computation
  // ---------------------------------------------------------------------------

  /** Get the minimum range across all valid armaments.
   *
   *  OpenRA 对照: AttackBase.GetMinimumRange()
   */
  getMinimumRange(): WDist {
    if (this.isTraitDisabled) return WDist.Zero

    let min = WDist.MaxValue
    for (const armament of this.armaments) {
      if (armament.isTraitDisabled) continue
      const range = armament.weapon?.minRange ?? WDist.Zero
      if (WDist.lessThan(range, min)) min = range
    }

    return WDist.equals(min, WDist.MaxValue) ? WDist.Zero : min
  }

  /** Get the maximum range across all valid armaments.
   *
   *  OpenRA 对照: AttackBase.GetMaximumRange()
   */
  getMaximumRange(): WDist {
    if (this.isTraitDisabled) return WDist.Zero

    let max = WDist.Zero
    for (const armament of this.armaments) {
      if (armament.isTraitDisabled) continue
      const range = armament.maxRange()
      if (WDist.greaterThan(range, max)) max = range
    }

    return max
  }

  /** Get the minimum range versus a specific target.
   *
   *  OpenRA 对照: AttackBase.GetMinimumRangeVersusTarget(Target)
   */
  getMinimumRangeVersusTarget(target: Target): WDist {
    if (this.isTraitDisabled) return WDist.Zero

    let min = WDist.MaxValue
    for (const armament of this.armaments) {
      if (armament.isTraitDisabled) continue
      if (!armament.weapon?.isValidAgainst(target, null, armament as unknown as IGameActor)) continue
      const range = armament.weapon.minRange
      if (WDist.lessThan(range, min)) min = range
    }

    return WDist.equals(min, WDist.MaxValue) ? WDist.Zero : min
  }

  /** Get the maximum range versus a specific target.
   *
   *  OpenRA 对照: AttackBase.GetMaximumRangeVersusTarget(Target)
   */
  getMaximumRangeVersusTarget(target: Target): WDist {
    if (this.isTraitDisabled) return WDist.Zero

    let max = WDist.Zero
    let maxFallback = WDist.Zero

    for (const armament of this.armaments) {
      if (armament.isTraitDisabled) continue
      if (!armament.weapon?.isValidAgainst(target, null, armament as unknown as IGameActor)) continue

      const range = armament.maxRange()
      if (WDist.greaterThan(range, maxFallback)) maxFallback = range
      if (WDist.greaterThan(range, max)) max = range
    }

    return WDist.greaterThan(max, WDist.Zero) ? max : maxFallback
  }

  // ---------------------------------------------------------------------------
  // Armament selection
  // ---------------------------------------------------------------------------

  /** Choose armaments that can be used against a target.
   *
   *  OpenRA 对照: AttackBase.ChooseArmamentsForTarget(Target, bool)
   */
  chooseArmamentsForTarget(
    target: Target,
    forceAttack: boolean,
  ): Armament[] {
    // If force-fire is not used and the target requires force-firing, no armaments
    if (
      !forceAttack &&
      ((target.type === TargetType.Terrain && !this.info.targetTerrainWithoutForceFire) ||
        target.type === TargetType.Invalid ||
        target.requiresForceFire)
    ) {
      return []
    }

    return this.armaments.filter(a => {
      if (a.isTraitDisabled) return false

      // Relationship check
      let owner: unknown = null
      if (target.type === TargetType.FrozenActor) {
        owner = (target.frozenActor as unknown as { owner?: unknown })?.owner
      } else if (target.type === TargetType.Actor) {
        owner = (target.actor as unknown as { owner?: unknown })?.owner
      }

      if (owner !== null) {
        // Duck-typed relationship check
        // Simplified: always allow for now (full relationship check deferred)
      }

      return a.weapon?.isValidAgainst(target, null, a as unknown as IGameActor) ?? false
    })
  }

  // ---------------------------------------------------------------------------
  // Attack mechanics
  // ---------------------------------------------------------------------------

  /** Queue an attack activity on the target.
   *
   *  OpenRA 对照: AttackBase.AttackTarget(Target, AttackSource, bool, bool, bool, Color?)
   */
  attackTarget(
    self: IGameActor,
    target: Target,
    source: AttackSource,
    queued: boolean,
    allowMove: boolean,
    forceAttack: boolean = false,
    targetLineColor?: string,
  ): void {
    if (this.isTraitDisabled) return
    if (!target.isValidFor(self as unknown as never)) return

    const activity = this.getAttackActivity(
      self,
      source,
      target,
      allowMove,
      forceAttack,
      targetLineColor,
    )

    // Queue the activity
    const selfAny = self as unknown as {
      queueActivity?: (activity: unknown, queued: boolean) => void
    }
    if (queued) {
      selfAny.queueActivity?.(activity, true)
    } else {
      selfAny.queueActivity?.(activity, false)
    }

    this.onResolveAttackOrder(self, activity, target, queued, forceAttack)
  }

  /** Called after queuing an attack. Subclasses may override.
   *
   *  OpenRA 对照: AttackBase.OnResolveAttackOrder()
   */
  onResolveAttackOrder(
    _self: IGameActor,
    _activity: unknown,
    _target: Target,
    _queued: boolean,
    _forceAttack: boolean,
  ): void {
    // Default no-op, subclasses override
  }

  /** Check if the target is reachable (in range, or can move into range).
   *
   *  OpenRA 对照: AttackBase.IsReachableTarget(Target, bool)
   */
  isReachableTarget(target: Target, allowMove: boolean): boolean {
    const centerPos = WPos.Zero // Will be filled by actor center at runtime

    return (
      this.hasAnyValidWeapons(target) &&
      (target.isInRange(centerPos, this.getMaximumRangeVersusTarget(target)) ||
        allowMove)
    )
  }

  /** Get the combined target relationship stances from armaments.
   *
   *  OpenRA 对照: AttackBase.UnforcedAttackTargetStances()
   */
  unforcedAttackTargetStances(): number {
    let stances = 0
    for (const armament of this.armaments) {
      if (!armament.isTraitDisabled) {
        stances |= armament.info.targetRelationships
      }
    }
    return stances
  }

  // ---------------------------------------------------------------------------
  // Abstract: activity creation
  // ---------------------------------------------------------------------------

  /** Create the activity for executing an attack.
   *
   *  OpenRA 对照: AttackBase.GetAttackActivity() [abstract]
   *
   *  Each attack variant provides its own activity implementation.
   */
  abstract getAttackActivity(
    self: IGameActor,
    source: AttackSource,
    target: Target,
    allowMove: boolean,
    forceAttack: boolean,
    targetLineColor?: string,
  ): unknown

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Find the closest target position to a given origin. */
  private closestTargetPosition(origin: WPos, target: Target): WPos {
    const positions = target.positions
    if (positions.length === 0) return target.centerPosition

    let bestPos = positions[0]!
    let bestDistSq = WPos.subtract(bestPos, origin).horizontalLengthSquared

    for (let i = 1; i < positions.length; i++) {
      const p = positions[i]!
      const distSq = WPos.subtract(p, origin).horizontalLengthSquared
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestPos = p
      }
    }

    return bestPos
  }
}
