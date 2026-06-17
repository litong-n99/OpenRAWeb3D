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
 * - C# MoveCooldownHelper → TypeScript cooldown tracker with non-null return
 * - C# TargetLineNode → TypeScript TargetLineNode from Activity.ts
 * - C# yield return → TypeScript override method returning array
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Leap } from './Leap.js'

// ---------------------------------------------------------------------------
// MoveCooldownHelper
// OpenRA 对照: OpenRA.Mods.Common.Activities.MoveCooldownHelper
// ---------------------------------------------------------------------------

/** Move cooldown tracker — prevents excessive movement re-queueing.
 *
 * OpenRA 对照: MoveCooldownHelper
 */
class MoveCooldownHelper {
  private _cooldown: number = 0

  /** Check cooldown. Returns true if movement is blocked by cooldown.
   *
   * OpenRA 对照: MoveCooldownHelper.Tick(bool)
   */
  tick(_targetIsHiddenActor: boolean): boolean | null {
    if (this._cooldown > 0) {
      this._cooldown--
      return true // Block movement until cooldown expires
    }
    return null // Proceed
  }

  notifyMoveQueued(): void {
    this._cooldown = 3
  }
}

// ---------------------------------------------------------------------------
// Trait interfaces (duck-typed)
// ---------------------------------------------------------------------------

interface AttackLeapLike {
  readonly info: AttackLeapInfoLike
  isAiming: boolean
  getMinimumRangeVersusTarget(target: TargetType_): WDist
  getMaximumRangeVersusTarget(target: TargetType_): WDist
  hasAnyValidWeapons(target: TargetType_): boolean
  get armaments(): readonly ArmamentLike[]
  doAttack(self: GameActor, target: TargetType_): void
  grantLeapCondition(self: GameActor): void
  revokeLeapCondition(self: GameActor): void
}

interface AttackLeapInfoLike {
  readonly speed: WDist
  readonly leapCondition: string
}

interface ArmamentLike {
  get isReloading(): boolean
}

interface MobileLike {
  readonly fromSubCell: number
  readonly toSubCell: number
  readonly facing: number
  moveWithinRange(
    target: TargetType_,
    minRange: WDist,
    maxRange: WDist,
    initialCenterPosition: WPos,
    color?: ColorStub | null,
  ): Activity
  setCenterPosition(self: GameActor, pos: WPos): void
  setLocation(self: GameActor, destCell: CPos, destSubCell: number, fromCell: CPos, fromSubCell: number): void
  updateMovement(): void
}

interface EdibleByLeapLike {
  canLeap(leaper: GameActor): boolean
  getLeapAtBy(leaper: GameActor): boolean
}

interface TargetActorStub {
  location: CPos
  owner: unknown | null
  isDead: boolean
  canBeViewedByPlayer(owner: unknown): boolean
  getEnabledTargetTypes(): Set<string>
  traits?: Map<string, unknown>
}

// ---------------------------------------------------------------------------
// LeapAttack — activity implementation
// OpenRA 对照: LeapAttack : Activity, IActivityNotifyStanceChanged
// ---------------------------------------------------------------------------

export class LeapAttack extends Activity {
  private readonly _info: AttackLeapInfoLike
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
    this._info = info
    this._attack = attack
    this._allowMovement = allowMovement
    this._forceAttack = forceAttack

    const selfAny = self as unknown as { traits?: Map<string, unknown> }
    this._mobile = selfAny.traits?.get('Mobile') as unknown as MobileLike
    this._moveCooldownHelper = new MoveCooldownHelper()

    // Cache initial last-visible-target data (OpenRA: constructor caching)
    this._cacheLastVisibleTarget(self, target)
  }

  /** Cache last-visible-target data from the initial target.
   *
   * OpenRA 对照: LeapAttack constructor visibility caching
   */
  private _cacheLastVisibleTarget(self: GameActor, target: TargetType_): void {
    if (target.type === TargetType.Actor) {
      const actor = (target as unknown as { actor?: TargetActorStub }).actor
      if (actor && actor.canBeViewedByPlayer(self.owner)) {
        this._lastVisibleTarget = Target.fromPos(target.centerPosition)
        this._lastVisibleMinRange = this._attack.getMinimumRangeVersusTarget(target)
        this._lastVisibleMaxRange = this._attack.getMaximumRangeVersusTarget(target)
        this._lastVisibleOwner = actor.owner
        this._lastVisibleTargetTypes = actor.getEnabledTargetTypes()
      }
    } else if (target.type === TargetType.FrozenActor) {
      const frozen = (target as unknown as { frozenActor?: { owner: unknown; targetTypes: Set<string> } }).frozenActor
      if (frozen) {
        this._lastVisibleTarget = Target.fromPos(target.centerPosition)
        this._lastVisibleMinRange = this._attack.getMinimumRangeVersusTarget(target)
        this._lastVisibleMaxRange = this._attack.getMaximumRangeVersusTarget(target)
        this._lastVisibleOwner = frozen.owner
        this._lastVisibleTargetTypes = frozen.targetTypes
      }
    } else if (target.type === TargetType.Terrain) {
      this._lastVisibleTarget = Target.fromPos(target.centerPosition)
      this._lastVisibleMinRange = this._attack.getMinimumRangeVersusTarget(target)
      this._lastVisibleMaxRange = this._attack.getMaximumRangeVersusTarget(target)
    }
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  protected override onFirstRun(_self: GameActor): void {
    this._attack.isAiming = true
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (this.isCanceling) return true

    // OpenRA: target = target.Recalculate(self.Owner, out targetIsHiddenActor)
    const [recalculated, targetIsHiddenActor] = this._target.recalculate(self.owner)
    this._target = recalculated

    // Cache last visible target when still visible
    if (!targetIsHiddenActor && this._target.type === TargetType.Actor) {
      this._lastVisibleTarget = Target.fromPos(this._target.centerPosition)
      this._lastVisibleMinRange = this._attack.getMinimumRangeVersusTarget(this._target)
      this._lastVisibleMaxRange = this._attack.getMaximumRangeVersusTarget(this._target)
      const actor = (this._target as unknown as { actor?: TargetActorStub }).actor
      if (actor) {
        this._lastVisibleOwner = actor.owner
        this._lastVisibleTargetTypes = actor.getEnabledTargetTypes()
      }
    }

    this._useLastVisibleTarget =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      targetIsHiddenActor || !this._target.isValidFor(self as any)

    // Move cooldown check
    const cooldownResult = this._moveCooldownHelper.tick(targetIsHiddenActor)
    if (cooldownResult !== null) return cooldownResult

    // Target hidden/dead with no fallback
    if (
      this._useLastVisibleTarget &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (!this._lastVisibleTarget || !this._lastVisibleTarget.isValidFor(self as any))
    ) {
      return true
    }

    const pos = (self as unknown as { centerPosition: WPos }).centerPosition ?? WPos.Zero
    const checkTarget = this._useLastVisibleTarget
      ? (this._lastVisibleTarget!)
      : this._target

    // Range check
    if (
      !checkTarget.isInRange(pos, this._lastVisibleMaxRange) ||
      checkTarget.isInRange(pos, this._lastVisibleMinRange)
    ) {
      if (
        !this._allowMovement ||
        WDist.equals(this._lastVisibleMaxRange, WDist.Zero) ||
        this._lastVisibleMaxRange.compareTo(this._lastVisibleMinRange) < 0
      ) {
        return true
      }

      this._moveCooldownHelper.notifyMoveQueued()
      this.queueChild(
        this._mobile.moveWithinRange(
          this._target,
          this._lastVisibleMinRange,
          this._lastVisibleMaxRange,
          checkTarget.centerPosition,
        ),
      )
      return false
    }

    // Ready to leap, but target isn't visible as actor
    if (targetIsHiddenActor || this._target.type !== TargetType.Actor) {
      return true
    }

    // Target not valid for leaping
    if (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !this._target.isValidFor(self as any) ||
      !this._attack.hasAnyValidWeapons(this._target)
    ) {
      return true
    }

    // Check EdibleByLeap
    const targetActor = (this._target as unknown as { actor?: TargetActorStub }).actor
    if (!targetActor) return true

    const edible = targetActor.traits?.get('EdibleByLeap') as unknown as
      | EdibleByLeapLike
      | undefined
    if (!edible || !edible.canLeap(self)) return true

    // Can't leap yet — all armaments reloading
    if (this._attack.armaments.every((a) => a.isReloading)) return false

    // Resolve target mobile for sub-cell positioning
    const targetMobile = targetActor.traits?.get('Mobile') as unknown as
      | MobileLike
      | undefined
    const targetSubcell = targetMobile?.toSubCell ?? -1 // SubCell.Any

    // Compute origin and destination world positions
    const worldAny = (self as unknown as { world?: { map?: { centerOfSubCell(cell: CPos, subCell: number): WPos } } }).world
    const map = worldAny?.map

    const destination = map?.centerOfSubCell?.(targetActor.location ?? CPos.Zero, targetSubcell) ?? WPos.Zero
    const origin = map?.centerOfSubCell?.(
      (self as unknown as { location: CPos }).location ?? CPos.Zero,
      this._mobile.fromSubCell,
    ) ?? WPos.Zero

    // Compute desired facing
    const diff = WPos.subtract(destination, origin)
    const desiredFacing = diff.yaw.angle
    if (this._mobile.facing !== desiredFacing) {
      // Queue Turn activity (OpenRA: new Turn(self, desiredFacing))
      this.queueChild(new TurnActivityProxy(self, desiredFacing))
      return false
    }

    // Queue the Leap activity
    // NOTE: LeapAttack's MobileLike is a superset of Leap's MobileLike.
    // Cast to bridge the structural type gap between the two duck-typed interfaces.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.queueChild(
      new Leap(
        this._target,
        this._mobile as any,
        (targetMobile as any) ?? null,
        this._info.speed.length,
        this._attack,
        edible,
      ),
    )

    return false
  }

  // ---------------------------------------------------------------------------
  // OnLastRun
  // ---------------------------------------------------------------------------

  protected override onLastRun(_self: GameActor): void {
    this._attack.isAiming = false
  }

  // ---------------------------------------------------------------------------
  // IActivityNotifyStanceChanged — 4 params matching C# signature
  // OpenRA 对照: void StanceChanged(Actor self, AutoTarget autoTarget, UnitStance oldStance, UnitStance newStance)
  // ---------------------------------------------------------------------------

  stanceChanged(
    self: GameActor,
    autoTarget: {
      hasValidTargetPriority(self: GameActor, owner: unknown, targetTypes: Set<string>): boolean
    },
    oldStance: number,
    newStance: number,
  ): void {
    // OpenRA: if (newStance > oldStance || forceAttack) return
    if (newStance > oldStance || this._forceAttack) return

    // OpenRA: if lastVisibleTarget is invalid we could never view the target
    if (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !this._lastVisibleTarget?.isValidFor(self as any) ||
      !autoTarget.hasValidTargetPriority(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        self as any,
        this._lastVisibleOwner,
        this._lastVisibleTargetTypes,
      )
    ) {
      this._target = Target.Invalid
    }
  }

  // ---------------------------------------------------------------------------
  // TargetLineNodes
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

// ---------------------------------------------------------------------------
// TurnActivityProxy — minimal Turn activity
// OpenRA 对照: Turn(Actor self, int desiredFacing)
// ---------------------------------------------------------------------------

class TurnActivityProxy extends Activity {
  private _self: GameActor
  private _desiredFacing: number

  constructor(self: GameActor, desiredFacing: number) {
    super()
    this._self = self
    this._desiredFacing = desiredFacing
  }

  override tick(self: GameActor): boolean {
    const mobile = (self as unknown as { traits?: Map<string, unknown> }).traits?.get('Mobile') as unknown as
      | { facing: number }
      | undefined
    if (mobile) {
      mobile.facing = this._desiredFacing
    }
    void this._self
    return true
  }
}
