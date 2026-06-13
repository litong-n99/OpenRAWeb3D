/**
 * AttackBomber.ts -- Scripted bomber attack with target position
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Air/AttackBomber.cs (95 lines)
 *
 * 核心范式转换:
 * - C# AttackBase, ITick, ISync, INotifyRemovedFromWorld → TS same pattern
 * - C# event Action<Actor> → TS callback arrays
 * - C# TargetInFiringArc → TS method from AttackBase
 * - C# getAttackActivity() → TS throws NotImplementedError (scripted-only)
 * - Movement activities deferred (TODO-8.E.AIR-MOVE)
 */

import {
  type IGameActor,
  type ITick,
  type ISync,
  type INotifyRemovedFromWorld,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import {
  AttackBase,
  AttackBaseInfo,
} from '../Attack/AttackBase.js'

// ---------------------------------------------------------------------------
// AttackBomberInfo
// OpenRA 对照: AttackBomberInfo (AttackBaseInfo)
// ---------------------------------------------------------------------------

/** Configuration for AttackBomber trait.
 *
 *  OpenRA 对照: AttackBomberInfo
 */
export class AttackBomberInfo extends AttackBaseInfo {
  constructor(params: {
    instanceName?: string
    armaments?: string[]
    facingTolerance?: import('../../../OpenRA.Game/WAngle.js').WAngle
    enabledByDefault?: boolean
  } = {}) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// AttackBomber
// OpenRA 对照: AttackBomber (AttackBase, ITick, ISync, INotifyRemovedFromWorld)
// ---------------------------------------------------------------------------

/** Trait used for scripted actors or actors spawned by a support power.
 *
 *  OpenRA 对照: AttackBomber
 *
 *  The target is set externally via SetTarget(WPos). Each tick, the bomber
 *  checks if the target is in range and in firing arc, then fires all armaments.
 */
export class AttackBomber
  extends AttackBase
  implements ITick, ISync, INotifyRemovedFromWorld
{
  /** Current scripted attack target.
   *
   *  OpenRA 对照: AttackBomber.target [VerifySync]
   */
  target: Target = Target.Invalid

  /** Whether the bomber is currently in attack range.
   *
   *  OpenRA 对照: AttackBomber.inAttackRange [VerifySync]
   */
  inAttackRange: boolean = false

  /** Whether the bomber is facing the target.
   *
   *  OpenRA 对照: AttackBomber.facingTarget [VerifySync]
   */
  facingTarget: boolean = true

  /** Callback invoked when the actor is removed from the world.
   *
   *  OpenRA 对照: event Action<Actor> OnRemovedFromWorld
   */
  onRemovedFromWorldCallbacks: Array<(self: IGameActor) => void> = []

  /** Callback invoked when entering attack range.
   *
   *  OpenRA 对照: event Action<Actor> OnEnteredAttackRange
   */
  onEnteredAttackRangeCallbacks: Array<(self: IGameActor) => void> = []

  /** Callback invoked when exiting attack range.
   *
   *  OpenRA 对照: event Action<Actor> OnExitedAttackRange
   */
  onExitedAttackRangeCallbacks: Array<(self: IGameActor) => void> = []

  constructor(info: AttackBomberInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // SetTarget
  // -----------------------------------------------------------------------

  /** Set the scripted attack target position.
   *
   *  OpenRA 对照: AttackBomber.SetTarget(WPos pos)
   */
  setTarget(pos: WPos): void {
    this.target = Target.fromPos(pos)
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick: check target range and firing arc, fire armaments.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   *
   *  @param self — the actor
   */
  override tick(self: IGameActor): void {
    const wasInAttackRange = this.inAttackRange
    this.inAttackRange = false

    if (self.isInWorld) {
      // Adjust target for terrain height
      const worldMap = (self.world as unknown as {
        map?: { distanceAboveTerrain?: (pos: WPos) => WDist }
      })?.map
      const targetCenter = this.target.centerPosition
      if (targetCenter && worldMap?.distanceAboveTerrain) {
        const dat = worldMap.distanceAboveTerrain(targetCenter)
        const adjustedPos = new WPos(
          targetCenter.X,
          targetCenter.Y,
          targetCenter.Z - dat.length,
        )
        this.target = Target.fromPos(adjustedPos)
      }

      const wasFacingTarget = this.facingTarget
      this.facingTarget = this.targetInFiringArc(self, this.target, this.info.facingTolerance)

      const armaments = this.armaments
      for (const a of armaments) {
        const arm = a as {
          maxRange?: () => WDist
          checkFire?: (self: IGameActor, facing: unknown, target: Target) => void
        }
        if (!arm.maxRange) continue

        const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition
        if (!centerPos) continue

        if (!this.target.isInRange(centerPos, arm.maxRange())) continue

        this.inAttackRange = true
        arm.checkFire?.(self, this.facing, this.target)
      }

      // Actors without armaments may want to trigger an action when passing the target
      if (armaments.length === 0) {
        this.inAttackRange = !wasInAttackRange && !this.facingTarget && wasFacingTarget
      }
    }

    if (this.inAttackRange && !wasInAttackRange) {
      for (const cb of this.onEnteredAttackRangeCallbacks) {
        cb(self)
      }
    }

    if (!this.inAttackRange && wasInAttackRange) {
      for (const cb of this.onExitedAttackRangeCallbacks) {
        cb(self)
      }
    }

    super.tick(self)
  }

  // -----------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // -----------------------------------------------------------------------

  /** Notify all callbacks when removed from world.
   *
   *  OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
   */
  removedFromWorld(self: IGameActor): void {
    for (const cb of this.onRemovedFromWorldCallbacks) {
      cb(self)
    }
  }

  // -----------------------------------------------------------------------
  // getAttackActivity
  // -----------------------------------------------------------------------

  /** Create the attack activity (not supported for scripted bombers).
   *
   *  OpenRA 对照: AttackBomber.GetAttackActivity()
   *
   *  AttackBomber requires a scripted target and does not support auto-targeting.
   */
  override getAttackActivity(
    _self: IGameActor,
    _source: unknown,
    _target: Target,
    _allowMove: boolean,
    _forceAttack: boolean,
    _targetLineColor?: string,
  ): unknown {
    throw new Error(
      'AttackBomber requires a scripted target',
    )
  }
}
