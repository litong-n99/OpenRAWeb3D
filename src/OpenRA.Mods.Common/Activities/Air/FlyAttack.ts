/**
 * FlyAttack.ts — 空中攻击活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/FlyAttack.cs
 *
 * 核心范式转换:
 * - C# nested sealed classes → top-level private helper classes in same file
 * - C# LINQ/BitSet → TypeScript arrays / ReadonlySet
 * - C# Color.Red target line → ColorStub constant
 * - C# IActivityNotifyStanceChanged → duck-typed stanceChanged method
 * - C# aircraft.MoveWithinRange(...) → new Fly(self, target, minRange, maxRange, ...)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackSource } from '../../Traits/Attack/AttackBase.js'
import { AirAttackType } from '../../Traits/Air/AttackAircraft.js'
import { UnitStance } from '../../Traits/CombatInterfaces.js'
import { Fly } from './Fly.js'
import { FlyForward } from './FlyForward.js'
import { TakeOff } from './TakeOff.js'
import { ReturnToBase } from './ReturnToBase.js'
import { type AircraftLike } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// AttackAircraft-like duck type
// ---------------------------------------------------------------------------

/** Minimal AttackAircraft interface used by FlyAttack. */
interface AttackAircraftLike {
  readonly isTraitDisabled: boolean
  readonly isTraitPaused: boolean
  readonly info: {
    readonly attackType: AirAttackType
    readonly abortOnResupply: boolean
    readonly facingTolerance: WAngle
    readonly strafeRunLength: WDist
  }
  requestedTarget: Target
  setRequestedTarget(target: Target, isForceAttack?: boolean): void
  clearRequestedTarget(): void
  chooseArmamentsForTarget(target: Target, forceAttack: boolean): ArmamentLike[]
  hasAnyValidWeapons(target: Target): boolean
  getMaximumRangeVersusTarget(target: Target): WDist
  getMinimumRangeVersusTarget(target: Target): WDist
  getTargetPosition(pos: WPos, target: Target): WPos
  targetInFiringArc(self: GameActor, target: Target, facingTolerance: WAngle): boolean
  readonly armaments: ArmamentLike[]
}

/** Minimal Armament interface used by FlyAttack. */
interface ArmamentLike {
  readonly isTraitPaused: boolean
  readonly weapon: {
    isValidAgainst(target: Target, world: unknown, self: GameActor): boolean
  } | null
}

/** Default target-line color for attack range approach (red). */
const AttackTargetLineRed: ColorStub = { r: 255, g: 0, b: 0, a: 255 }

// ---------------------------------------------------------------------------
// FlyAttack
// ---------------------------------------------------------------------------

/**
 * Orchestrate air attacks: approach target, select attack run type, handle
 * resupply, and react to stance changes.
 *
 * OpenRA 对照: FlyAttack activity
 */
export class FlyAttack extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly aircraft: AircraftLike
  private readonly attackAircraft: AttackAircraftLike
  private readonly rearmable: unknown
  private readonly source: AttackSource
  private readonly forceAttack: boolean
  private readonly targetLineColor: ColorStub | null
  private readonly strafeDistance: WDist

  private target: Target
  private lastVisibleTarget: Target = Target.Invalid
  private lastVisibleMaximumRange: WDist = WDist.Zero
  private lastVisibleTargetTypes: ReadonlySet<string> = new Set()
  private lastVisibleOwner: unknown = null
  private useLastVisibleTarget: boolean = false
  private hasTicked: boolean = false
  private returnToBase: boolean = false

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a FlyAttack activity.
   *
   * OpenRA 对照: FlyAttack(Actor self, AttackSource source, Target target, bool forceAttack, Color? targetLineColor)
   *
   * @param self — the attacking actor
   * @param source — attack source (normal or attack-move)
   * @param target — the target to attack
   * @param forceAttack — whether to force attack
   * @param targetLineColor — optional target line color
   */
  constructor(
    self: GameActor,
    source: AttackSource,
    target: Target,
    forceAttack: boolean,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this.source = source
    this.target = target
    this.forceAttack = forceAttack
    this.targetLineColor = targetLineColor
    this.childHasPriority = false

    this.aircraft = FlyAttack._resolveAircraft(self)
    this.attackAircraft = FlyAttack._resolveAttackAircraft(self)
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    this.rearmable = actorAny.traits?.get('Rearmable') ?? null

    this.strafeDistance = this.attackAircraft.info.strafeRunLength

    // The target may become hidden between the initial order request and the first tick (e.g. if queued)
    // Moving to any position (even if quite stale) is still better than immediately giving up
    if (
      (target.type === TargetType.Actor &&
        (target.actor as unknown as { canBeViewedByPlayer?: (p: unknown) => boolean })?.canBeViewedByPlayer?.(
          (self as unknown as { owner?: unknown }).owner,
        )) ||
      target.type === TargetType.FrozenActor ||
      target.type === TargetType.Terrain
    ) {
      this.lastVisibleTarget = Target.fromPos(target.centerPosition)
      this.lastVisibleMaximumRange = this.attackAircraft.getMaximumRangeVersusTarget(target)

      if (target.type === TargetType.Actor) {
        this.lastVisibleOwner = (target.actor as unknown as { owner?: unknown }).owner
        const targetTypes = (target.actor as unknown as { getEnabledTargetTypes?: () => ReadonlySet<string> }).getEnabledTargetTypes?.()
        if (targetTypes) this.lastVisibleTargetTypes = targetTypes
      } else if (target.type === TargetType.FrozenActor) {
        const fa = target.frozenActor as unknown as { owner?: unknown; targetTypes?: ReadonlySet<string> } | null
        this.lastVisibleOwner = fa?.owner
        if (fa?.targetTypes) this.lastVisibleTargetTypes = fa.targetTypes
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Main attack orchestration tick.
   *
   * OpenRA 对照: FlyAttack.Tick(Actor)
   *
   * @param self — the attacking actor
   * @returns true when attack activity is complete, false to continue
   */
  override tick(self: GameActor): boolean {
    if (!this.isCanceling && !this._hasArmamentsFor(this.target)) {
      this.cancel(self, true)
    }

    if (!this.tickChild(self)) {
      return false
    }

    this.returnToBase = false

    // Refuse to take off if it would land immediately again.
    if (this.aircraft.forceLanding) {
      this.cancel(self)
    }

    if (this.isCanceling) {
      return true
    }

    // Check that AttackFollow hasn't cancelled the target by modifying attack.Target
    // Having both this and AttackFollow modify that field is a horrible hack.
    if (this.hasTicked && this.attackAircraft.requestedTarget.type === TargetType.Invalid) {
      return true
    }

    if (this.attackAircraft.isTraitPaused) {
      return false
    }

    const [recalculatedTarget, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculatedTarget
    this.attackAircraft.setRequestedTarget(this.target, this.forceAttack)
    this.hasTicked = true

    if (!targetIsHiddenActor && this.target.type === TargetType.Actor) {
      this.lastVisibleTarget = Target.fromTargetPositions(this.target)
      this.lastVisibleMaximumRange = this.attackAircraft.getMaximumRangeVersusTarget(this.target)
      this.lastVisibleOwner = (this.target.actor as unknown as { owner?: unknown }).owner
      const targetTypes = (this.target.actor as unknown as { getEnabledTargetTypes?: () => ReadonlySet<string> }).getEnabledTargetTypes?.()
      if (targetTypes) this.lastVisibleTargetTypes = targetTypes
    } else if (this.target.type === TargetType.FrozenActor && !this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      // Fix fallback values based on frozen actor properties
      this.lastVisibleTarget = Target.fromTargetPositions(this.target)
      this.lastVisibleMaximumRange = this.attackAircraft.getMaximumRangeVersusTarget(this.target)
      const fa = this.target.frozenActor as unknown as { owner?: unknown; targetTypes?: ReadonlySet<string> } | null
      this.lastVisibleOwner = fa?.owner
      if (fa?.targetTypes) this.lastVisibleTargetTypes = fa.targetTypes
    }

    this.useLastVisibleTarget = targetIsHiddenActor || !this.target.isValidFor(self as unknown as never)

    // Target is hidden or dead, and we don't have a fallback position to move towards
    if (this.useLastVisibleTarget && !this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      return true
    }

    // If all valid weapons have depleted their ammo and Rearmable trait exists, return to RearmActor to reload
    // and resume the activity after reloading if AbortOnResupply is set to 'false'
    if (
      this.rearmable !== null &&
      !this.useLastVisibleTarget &&
      this.attackAircraft.armaments.length > 0 &&
      this.attackAircraft.armaments.every(
        (a) => a.isTraitPaused || !a.weapon?.isValidAgainst(this.target, (self as unknown as { world?: unknown }).world, self),
      )
    ) {
      // Attack moves never resupply
      if (this.source === AttackSource.AttackMove) {
        return true
      }

      if (this.attackAircraft.info.abortOnResupply) {
        // AbortOnResupply cancels the current activity (after resupplying) plus any queued activities
        this.nextActivity?.cancel(self)
        this.queue(new ReturnToBase(self))
      } else {
        this.queueChild(new ReturnToBase(self))
      }

      this.returnToBase = true
      return this.attackAircraft.info.abortOnResupply
    }

    const pos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const checkTarget = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target

    const minimumRange =
      this.attackAircraft.info.attackType === AirAttackType.Strafe
        ? WDist.Zero
        : this.attackAircraft.getMinimumRangeVersusTarget(this.target)

    if (
      WDist.equals(this.lastVisibleMaximumRange, WDist.Zero) ||
      WDist.lessThan(this.lastVisibleMaximumRange, minimumRange)
    ) {
      return true
    }

    const delta = WPos.subtract(this.attackAircraft.getTargetPosition(pos, this.target), pos)
    const desiredFacing =
      delta.horizontalLengthSquared !== 0 ? delta.yaw : this.aircraft.facing

    this.queueChild(new TakeOff(self))

    // Move into range of the target.
    if (
      !checkTarget.isInRange(pos, this.lastVisibleMaximumRange) ||
      checkTarget.isInRange(pos, minimumRange)
    ) {
      this.queueChild(
        new Fly(
          self,
          this.target,
          minimumRange,
          this.lastVisibleMaximumRange,
          checkTarget.centerPosition,
          AttackTargetLineRed,
        ),
      )
    }
    // We've reached the assumed position but it is not there - give up
    else if (this.useLastVisibleTarget) {
      return true
    }
    // The aircraft must keep moving forward even if it is already in an ideal position.
    else if (this.attackAircraft.info.attackType === AirAttackType.Strafe) {
      const exitRange = WDist.equals(this.strafeDistance, WDist.Zero)
        ? this.lastVisibleMaximumRange
        : this.strafeDistance
      this.queueChild(
        new StrafeAttackRun(this.attackAircraft, this.aircraft, this.target, exitRange),
      )
    } else if (
      this.attackAircraft.info.attackType === AirAttackType.Default &&
      !this.aircraft.info.canHover
    ) {
      this.queueChild(new FlyAttackRun(this.target, this.lastVisibleMaximumRange, this.attackAircraft))
    }
    // Turn to face the target if required.
    else if (
      !this.attackAircraft.targetInFiringArc(self, this.target, this.attackAircraft.info.facingTolerance)
    ) {
      this.aircraft.facing = WAngle.tickFacing(
        this.aircraft.facing,
        desiredFacing,
        this.aircraft.turnSpeed,
      )
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clear the requested target when this activity ends.
   *
   * OpenRA 对照: FlyAttack.OnLastRun(Actor)
   */
  protected override onLastRun(_self: GameActor): void {
    this.attackAircraft.clearRequestedTarget()
  }

  // ---------------------------------------------------------------------------
  // Stance change notification
  // ---------------------------------------------------------------------------

  /**
   * Cancel non-forced targets when switching to a more restrictive stance if
   * they are no longer valid for auto-targeting.
   *
   * OpenRA 对照: IActivityNotifyStanceChanged.StanceChanged
   */
  stanceChanged(
    self: GameActor,
    autoTarget: unknown,
    oldStance: UnitStance,
    newStance: UnitStance,
  ): void {
    // Cancel non-forced targets when switching to a more restrictive stance if they are no longer valid for auto-targeting
    if (newStance > oldStance || this.forceAttack) {
      return
    }

    // If lastVisibleTarget is invalid we could never view the target in the first place, so we just drop it here too
    if (!this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      this.attackAircraft.clearRequestedTarget()
      return
    }

    const autoTargetAny = autoTarget as {
      hasValidTargetPriority?: (
        self: GameActor,
        owner: unknown,
        targetTypes: ReadonlySet<string>,
      ) => boolean
    }
    if (
      autoTargetAny.hasValidTargetPriority &&
      !autoTargetAny.hasValidTargetPriority(self, this.lastVisibleOwner, this.lastVisibleTargetTypes)
    ) {
      this.attackAircraft.clearRequestedTarget()
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: FlyAttack.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self?: GameActor): TargetLineNode[] {
    if (this.targetLineColor === null || this.targetLineColor === undefined) {
      return []
    }

    const nodes: TargetLineNode[] = []
    if (this.returnToBase) {
      const childNodes = this.childActivity?.targetLineNodes(_self ?? ({} as GameActor)) ?? []
      nodes.push(...childNodes)
    }

    if (!this.returnToBase || !this.attackAircraft.info.abortOnResupply) {
      nodes.push(
        new TargetLineNode(
          this.useLastVisibleTarget ? this.lastVisibleTarget : this.target,
          this.targetLineColor,
        ),
      )
    }

    return nodes
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Check whether any armaments can attack the target. */
  private _hasArmamentsFor(target: Target): boolean {
    return (
      !this.attackAircraft.isTraitDisabled &&
      this.attackAircraft.chooseArmamentsForTarget(target, this.forceAttack).length > 0
    )
  }

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('FlyAttack requires an Aircraft trait on the actor')
    }
    return aircraft
  }

  /** Resolve AttackAircraft trait from actor via duck typing. */
  private static _resolveAttackAircraft(self: GameActor): AttackAircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const attack = actorAny.traits?.get('AttackAircraft') as AttackAircraftLike | undefined
    if (!attack) {
      throw new Error('FlyAttack requires an AttackAircraft trait on the actor')
    }
    return attack
  }
}

// ---------------------------------------------------------------------------
// FlyAttackRun
// ---------------------------------------------------------------------------

/**
 * Fly past the target, fire, and exit range.
 *
 * OpenRA 对照: FlyAttack nested sealed class FlyAttackRun
 */
class FlyAttackRun extends Activity {
  private readonly attack: AttackAircraftLike
  private readonly exitRange: WDist
  private target: Target
  private targetIsVisibleActor: boolean = false

  constructor(target: Target, exitRange: WDist, attack: AttackAircraftLike) {
    super()
    this.target = target
    this.exitRange = exitRange
    this.attack = attack
    this.childHasPriority = false
  }

  protected override onFirstRun(self: GameActor): void {
    // The target may have died while this activity was queued
    if (this.target.isValidFor(self as unknown as never)) {
      this.queueChild(new Fly(self, this.target, this.target.centerPosition))

      // Fly a single tick forward so we have passed the target and start flying out of range facing away from it
      this.queueChild(new FlyForward(self, 1))
      this.queueChild(
        new Fly(self, this.target, this.exitRange, WDist.MaxValue, this.target.centerPosition),
      )
    } else {
      this.cancel(self)
    }
  }

  override tick(self: GameActor): boolean {
    if (this.tickChild(self) || this.isCanceling) {
      return true
    }

    // Cancel the run if the target become invalid (e.g. killed) while visible
    const targetWasVisibleActor = this.targetIsVisibleActor
    const [recalculatedTarget, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculatedTarget
    this.targetIsVisibleActor = this.target.type === TargetType.Actor && !targetIsHiddenActor

    if (
      targetWasVisibleActor &&
      (!this.target.isValidFor(self as unknown as never) || !this.attack.hasAnyValidWeapons(this.target))
    ) {
      this.cancel(self)
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// StrafeAttackRun
// ---------------------------------------------------------------------------

/**
 * Fly through the target area firing, then exit range and turn for another pass.
 *
 * OpenRA 对照: FlyAttack nested sealed class StrafeAttackRun
 */
class StrafeAttackRun extends Activity {
  private readonly attackAircraft: AttackAircraftLike
  private readonly aircraft: AircraftLike
  private readonly exitRange: WDist
  private target: Target

  constructor(
    attackAircraft: AttackAircraftLike,
    aircraft: AircraftLike,
    target: Target,
    exitRange: WDist,
  ) {
    super()
    this.target = target
    this.attackAircraft = attackAircraft
    this.aircraft = aircraft
    this.exitRange = exitRange
    this.childHasPriority = false
  }

  protected override onFirstRun(self: GameActor): void {
    // The target may have died while this activity was queued
    if (this.target.isValidFor(self as unknown as never)) {
      this.queueChild(new Fly(self, this.target, this.target.centerPosition))
      this.queueChild(new FlyForward(self, this.exitRange))

      // Exit the range and then fly enough to turn towards the target for another run
      const turnSpeedAngle = this.aircraft.info.turnSpeed.angle
      const distanceToTurn =
        turnSpeedAngle > 0
          ? new WDist(Math.trunc((this.aircraft.info.speed * 256) / turnSpeedAngle))
          : WDist.Zero
      this.queueChild(
        new Fly(
          self,
          this.target,
          WDist.add(this.exitRange, distanceToTurn),
          WDist.MaxValue,
          this.target.centerPosition,
        ),
      )
    } else {
      this.cancel(self)
    }
  }

  override tick(self: GameActor): boolean {
    if (this.tickChild(self) || this.isCanceling) {
      return true
    }

    // Strafe attacks target the ground below the original target
    // Update the position if we seen the target move; keep the previous one if it dies or disappears
    const [recalculatedTarget, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculatedTarget
    if (!targetIsHiddenActor && this.target.type === TargetType.Actor) {
      this.attackAircraft.setRequestedTarget(Target.fromTargetPositions(this.target), true)
    }

    return false
  }
}
