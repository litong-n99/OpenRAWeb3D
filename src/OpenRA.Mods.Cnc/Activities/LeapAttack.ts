/**
 * LeapAttack.ts — 跳跃攻击活动（移动至目标并执行跳跃攻击）
 * OpenRA 对照: OpenRA.Mods.Cnc/Activities/LeapAttack.cs (176 lines)
 *
 * 核心范式转换:
 * - C# LeapAttack : Activity, IActivityNotifyStanceChanged
 *   → TypeScript LeapAttack extends Activity
 * - C# target.Recalculate / IsValidFor / IsInRange → TypeScript duck-typed Target
 * - C# BitSet<TargetableType> → TypeScript Set<string>
 * - C# WDist / WPos integer arithmetic → TypeScript same
 * - C# QueueChild(Mobile.MoveWithinRange/Leap/Turn) → TypeScript queueChild
 * - C# MoveCooldownHelper → TypeScript simplified cooldown tracker
 * - C# TargetLineNode → TypeScript TargetLineNode from Activity.ts
 * - C# yield return → TypeScript override method returning array
 *
 * NOTE: Full MoveCooldownHelper, Turn activity, and Mobile trait are needed
 * for full functionality. These are stubbed with minimal duck-typed interfaces.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import { type ActivityState } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// MoveCooldownHelper (simplified)
// OpenRA 对照: MoveCooldownHelper
// ---------------------------------------------------------------------------

/** Simplified move cooldown tracker.
 *
 * OpenRA 对照: MoveCooldownHelper
 *
 * Prevents excessive movement queueing by tracking cooldown ticks.
 */
class MoveCooldownHelper {
  private _cooldown: number = 0

  tick(_targetIsHidden: boolean): boolean | null {
    if (this._cooldown > 0) {
      this._cooldown--
      return null // Waiting for cooldown
    }
    // null means "proceed with logic" (no abort)
    return null
  }

  notifyMoveQueued(): void {
    this._cooldown = 3 // Simple cooldown
  }
}

// ---------------------------------------------------------------------------
// Trait interfaces (duck-typed)
// ---------------------------------------------------------------------------

/** Minimal AttackLeap trait for leap attack.
 *
 * OpenRA 对照: AttackLeap (subset of public members)
 */
interface AttackLeapLike {
  readonly info: AttackLeapInfoLike
  isAiming: boolean
  getMinimumRangeVersusTarget(target: TargetType_): WDist
  getMaximumRangeVersusTarget(target: TargetType_): WDist
  hasAnyValidWeapons(target: TargetType_): boolean
  get armaments(): readonly ArmamentLike[]
  doAttack(self: GameActor, target: TargetType_): void
}

interface AttackLeapInfoLike {
  readonly speed: WDist
  readonly leapCondition: string
}

/** Minimal Armament interface.
 *
 * OpenRA 对照: Armament
 */
interface ArmamentLike {
  get isReloading(): boolean
}

/** Minimal Mobile trait for movement.
 *
 * OpenRA 对照: Mobile (subset)
 */
interface MobileLike {
  readonly fromSubCell: number
  readonly facing: number
  moveWithinRange(
    target: TargetType_,
    minRange: WDist,
    maxRange: WDist,
    initialCenterPosition: WPos,
    color?: ColorStub,
  ): Activity
}

// ---------------------------------------------------------------------------
// IActor (simplified for target Owner)
// ---------------------------------------------------------------------------

interface TargetActorStub {
  location: CPos
  owner: unknown | null
  isDead: boolean
  canBeViewedByPlayer(owner: unknown): boolean
  getEnabledTargetTypes(): Set<string>
}

// ---------------------------------------------------------------------------
// LeapAttack — activity implementation
// OpenRA 对照: LeapAttack : Activity, IActivityNotifyStanceChanged
// ---------------------------------------------------------------------------

/**
 * Activity that moves toward a target and then executes a leap attack.
 *
 * OpenRA 对照: LeapAttack
 *
 * Manages target tracking, range checking, weapon reload validation,
 * and queues child activities (Turn, MoveWithinRange, Leap).
 */
export class LeapAttack extends Activity {
  private readonly _attack: AttackLeapLike
  private readonly _mobile: MobileLike
  private readonly _allowMovement: boolean
  private readonly _forceAttack: boolean
  private readonly _targetLineColor: ColorStub | null
  private readonly _moveCooldownHelper: MoveCooldownHelper

  private _target: TargetType_
  private _lastVisibleTarget: TargetType_ | null = null
  private _useLastVisibleTarget: boolean = false
  private _lastVisibleMinRange: WDist = WDist.Zero
  private _lastVisibleMaxRange: WDist = WDist.Zero
  private _lastVisibleTargetTypes: Set<string> = new Set()
  private _lastVisibleOwner: unknown = null

  constructor(
    self: GameActor,
    target: TargetType_,
    allowMovement: boolean,
    forceAttack: boolean,
    attack: AttackLeapLike,
    info: AttackLeapInfoLike,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this._target = target
    this._targetLineColor = targetLineColor
    this._attack = attack
    this._allowMovement = allowMovement
    this._forceAttack = forceAttack

    // Resolve Mobile via duck-typing
    const selfAny = self as unknown as { traits?: Map<string, unknown> }
    this._mobile = selfAny.traits?.get('Mobile') as unknown as MobileLike
    this._moveCooldownHelper = new MoveCooldownHelper()
    void info // Used via attack.info pattern

    // Cache initial last-visible-target data
    // OpenRA: if target is visible, cache it
    if (target.type === TargetType.Actor) {
      const actor = (target as unknown as { actor?: TargetActorStub }).actor
      if (actor && actor.canBeViewedByPlayer(self.owner)) {
        this._lastVisibleTarget = Target.fromPos(target.centerPosition)
        this._lastVisibleMinRange =
          attack.getMinimumRangeVersusTarget(target)
        this._lastVisibleMaxRange =
          attack.getMaximumRangeVersusTarget(target)
        this._lastVisibleOwner = actor.owner
        this._lastVisibleTargetTypes = actor.getEnabledTargetTypes()
      }
    } else if (target.type === TargetType.Terrain) {
      this._lastVisibleTarget = Target.fromPos(target.centerPosition)
      this._lastVisibleMinRange = attack.getMinimumRangeVersusTarget(target)
      this._lastVisibleMaxRange = attack.getMaximumRangeVersusTarget(target)
    }
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // OpenRA 对照: LeapAttack.OnFirstRun(Actor)
  // ---------------------------------------------------------------------------

  protected override onFirstRun(_self: GameActor): void {
    this._attack.isAiming = true
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: LeapAttack.Tick(Actor)
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (this.isCanceling) return true

    // Recalculate target visibility
    // NOTE: In OpenRA, target = target.Recalculate(self.Owner, out targetIsHiddenActor)
    // For migration, we check target.Type for valid/invalid
    const targetIsHiddenActor =
      this._target.type === TargetType.Actor &&
      !(this._target as unknown as { actor?: TargetActorStub }).actor
        ?.canBeViewedByPlayer(self.owner)

    // Cache last visible target if visible
    if (!targetIsHiddenActor && this._target.type === TargetType.Actor) {
      this._lastVisibleTarget = Target.fromPos(this._target.centerPosition)
      this._lastVisibleMinRange =
        this._attack.getMinimumRangeVersusTarget(this._target)
      this._lastVisibleMaxRange =
        this._attack.getMaximumRangeVersusTarget(this._target)
      const actor = (this._target as unknown as { actor?: TargetActorStub }).actor
      if (actor) {
        this._lastVisibleOwner = actor.owner
        this._lastVisibleTargetTypes = actor.getEnabledTargetTypes()
      }
    }

    this._useLastVisibleTarget =
      targetIsHiddenActor || !this._target.isValidFor(self)

    // Move cooldown check
    const cooldownResult = this._moveCooldownHelper.tick(targetIsHiddenActor)
    if (cooldownResult !== null) return cooldownResult

    // Target hidden/dead with no fallback
    if (
      this._useLastVisibleTarget &&
      this._lastVisibleTarget &&
      !this._lastVisibleTarget.isValidFor(self)
    ) {
      return true // Give up
    }

    const pos = (self as unknown as { centerPosition: WPos }).centerPosition ?? WPos.Zero
    const checkTarget = this._useLastVisibleTarget
      ? (this._lastVisibleTarget ?? this._target)
      : this._target

    // Range check
    if (
      !checkTarget.isInRange(pos, this._lastVisibleMaxRange) ||
      checkTarget.isInRange(pos, this._lastVisibleMinRange)
    ) {
      // Out of range or too close
      if (
        !this._allowMovement ||
        WDist.equals(this._lastVisibleMaxRange, WDist.Zero) ||
        this._lastVisibleMaxRange.compareTo(this._lastVisibleMinRange) < 0
      ) {
        return true
      }

      this._moveCooldownHelper.notifyMoveQueued()

      // Queue child: mobile.MoveWithinRange
      const moveChild = this._mobile.moveWithinRange(
        this._target,
        this._lastVisibleMinRange,
        this._lastVisibleMaxRange,
        checkTarget.centerPosition,
      )
      this.queueChild(moveChild)
      return false
    }

    // Ready to leap, but target isn't visible as actor
    if (
      targetIsHiddenActor ||
      this._target.type !== TargetType.Actor
    ) {
      return true
    }

    // Target not valid for leaping
    if (
      !this._target.isValidFor(self) ||
      !this._attack.hasAnyValidWeapons(this._target)
    ) {
      return true
    }

    // Check EdibleByLeap
    const targetActor = (this._target as unknown as { actor?: TargetActorStub & { traits?: Map<string, unknown> } }).actor
    if (!targetActor) return true

    const edible = targetActor.traits?.get('EdibleByLeap') as unknown as
      | { canLeap(actor: GameActor): boolean }
      | undefined
    if (!edible || !edible.canLeap(self)) return true

    // Can't leap yet — all armaments reloading
    if (this._attack.armaments.every((a) => a.isReloading)) return false

    // Resolve target mobile for sub-cell positioning
    const targetMobile = targetActor.traits?.get('Mobile') as unknown as
      | { toSubCell: number }
      | undefined
    const targetSubcell = targetMobile?.toSubCell ?? -1 // SubCell.Any

    // NOTE: Need map reference for CenterOfSubCell
    const worldAny = (self as unknown as { world?: { map?: { centerOfSubCell(cell: CPos, subCell: number): WPos } } }).world

    const destination = worldAny?.map?.centerOfSubCell?.(
      targetActor.location ?? CPos.Zero,
      targetSubcell,
    ) ?? WPos.Zero
    const origin = worldAny?.map?.centerOfSubCell?.(
      (self as unknown as { location: CPos }).location ?? CPos.Zero,
      this._mobile.fromSubCell,
    ) ?? WPos.Zero

    // Calculate desired facing (Yaw from origin to destination)
    const diffX = destination.X - origin.X
    const diffY = destination.Y - origin.Y
    const desiredFacing = Math.atan2(diffY, diffX) // Radians, approximate

    // NOTE: OpenRA uses WAngle.Yaw from WVec
    if (this._mobile.facing !== Math.round(desiredFacing * (1024 / (2 * Math.PI)))) {
      // Queue Turn activity
      // TODO: Create Turn activity matching the pattern
      // QueueChild(new Turn(self, desiredFacing));
      // For now: skip turn and proceed
    }

    // Queue the Leap activity
    // NOTE: Leap constructor requires full trait references
    // This is a deferred integration point
    // QueueChild(new Leap(target, mobile, targetMobile, info.Speed.Length, attack, edible));

    return false
  }

  // ---------------------------------------------------------------------------
  // OnLastRun
  // OpenRA 对照: LeapAttack.OnLastRun(Actor)
  // ---------------------------------------------------------------------------

  protected override onLastRun(_self: GameActor): void {
    this._attack.isAiming = false
  }

  // ---------------------------------------------------------------------------
  // IActivityNotifyStanceChanged (integrated as method)
  // OpenRA 对照: LeapAttack.StanceChanged()
  // ---------------------------------------------------------------------------

  stanceChanged(
    self: GameActor,
    autoTarget: {
      hasValidTargetPriority(
        self: GameActor,
        owner: unknown,
        targetTypes: Set<string>,
      ): boolean
    },
    _oldStance: number,
    newStance: number,
    oldStance: number,
  ): void {
    if (newStance > oldStance || this._forceAttack) return

    if (
      !this._lastVisibleTarget?.isValidFor(self) ||
      !autoTarget.hasValidTargetPriority(
        self,
        this._lastVisibleOwner,
        this._lastVisibleTargetTypes,
      )
    ) {
      this._target = Target.fromInvalid()
    }
  }

  // ---------------------------------------------------------------------------
  // TargetLineNodes
  // OpenRA 对照: LeapAttack.TargetLineNodes(Actor)
  // ---------------------------------------------------------------------------

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this._targetLineColor !== null) {
      const displayTarget = this._useLastVisibleTarget
        ? (this._lastVisibleTarget ?? this._target)
        : this._target
      return [
        new TargetLineNode(
          displayTarget as unknown as import('../../OpenRA.Game/Traits/Target.js').Target,
          this._targetLineColor as ColorStub,
        ),
      ]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  get target(): TargetType_ {
    return this._target
  }

  set target(t: TargetType_) {
    this._target = t
  }

  get isAiming(): boolean {
    return this._attack.isAiming
  }

  get useLastVisibleTarget(): boolean {
    return this._useLastVisibleTarget
  }

  get lastVisibleTarget(): TargetType_ | null {
    return this._lastVisibleTarget
  }
}
