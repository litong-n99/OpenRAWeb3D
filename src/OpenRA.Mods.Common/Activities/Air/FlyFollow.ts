/**
 * FlyFollow.ts — 跟随目标活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/FlyFollow.cs
 *
 * 核心范式转换:
 * - C# aircraft.MoveWithinRange(...) → new Fly(self, target, minRange, maxRange, ...)
 * - C# yield return → array return
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Fly } from './Fly.js'
import { type AircraftLike } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// FlyFollow
// ---------------------------------------------------------------------------

/**
 * Follow a target while maintaining a min/max range annulus.
 *
 * OpenRA 对照: FlyFollow activity
 *
 * - If the target is inside the annulus, wait (or keep flying forward for
 *   non-hover aircraft).
 * - Otherwise, queue a Fly to move into the annulus.
 * - Gives up if the target is hidden after a MoveWithinRange completed.
 */
export class FlyFollow extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly aircraft: AircraftLike
  private readonly minRange: WDist
  private readonly maxRange: WDist
  private readonly targetLineColor: ColorStub | null

  private target: Target
  private lastVisibleTarget: Target = Target.Invalid
  private useLastVisibleTarget: boolean = false
  private wasMovingWithinRange: boolean = false

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a FlyFollow activity.
   *
   * OpenRA 对照: FlyFollow(Actor self, Target target, WDist minRange, WDist maxRange, WPos? initialTargetPosition, Color? targetLineColor)
   *
   * @param self — the actor following the target
   * @param target — the target to follow
   * @param minRange — minimum desired range
   * @param maxRange — maximum desired range
   * @param initialTargetPosition — fallback position when target is initially hidden
   * @param targetLineColor — optional target line color
   */
  constructor(
    self: GameActor,
    target: Target,
    minRange: WDist,
    maxRange: WDist,
    initialTargetPosition: WPos | null = null,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this.target = target
    this.minRange = minRange
    this.maxRange = maxRange
    this.targetLineColor = targetLineColor
    this.aircraft = FlyFollow._resolveAircraft(self)

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
    } else if (initialTargetPosition !== null) {
      this.lastVisibleTarget = Target.fromPos(initialTargetPosition)
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Follow the target, keeping within the desired range annulus.
   *
   * OpenRA 对照: FlyFollow.Tick(Actor)
   *
   * @param self — the actor following the target
   * @returns true when target lost or in range, false while moving
   */
  override tick(self: GameActor): boolean {
    // Refuse to take off if it would land immediately again.
    if (this.aircraft.forceLanding) {
      this.cancel(self)
    }

    if (this.isCanceling) {
      return true
    }

    const [recalculatedTarget, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculatedTarget
    if (!targetIsHiddenActor && this.target.type === TargetType.Actor) {
      this.lastVisibleTarget = Target.fromTargetPositions(this.target)
    }

    this.useLastVisibleTarget =
      targetIsHiddenActor || !this.target.isValidFor(self as unknown as never)

    // If we are ticking again after previously sequencing a MoveWithinRange then that move must have completed
    // Either we are in range and can see the target, or we've lost track of it and should give up
    if (this.wasMovingWithinRange && targetIsHiddenActor) {
      return true
    }

    this.wasMovingWithinRange = false

    // Target is hidden or dead, and we don't have a fallback position to move towards
    if (this.useLastVisibleTarget && !this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      return true
    }

    const pos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const checkTarget = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target

    // We've reached the required range - if the target is visible and valid then we wait
    // otherwise if it is hidden or dead we give up
    if (checkTarget.isInRange(pos, this.maxRange) && !checkTarget.isInRange(pos, this.minRange)) {
      if (!this.aircraft.info.canHover) {
        Fly.flyTick(self, this.aircraft, this.aircraft.facing, this.aircraft.info.cruiseAltitude)
      }

      return this.useLastVisibleTarget
    }

    this.wasMovingWithinRange = true
    this.queueChild(
      new Fly(
        self,
        this.target,
        this.minRange,
        this.maxRange,
        checkTarget.centerPosition,
        this.targetLineColor,
      ),
    )
    return false
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: FlyFollow.TargetLineNodes(Actor)
   */
  override targetLineNodes(): TargetLineNode[] {
    if (this.targetLineColor !== null && this.targetLineColor !== undefined) {
      return [
        new TargetLineNode(
          this.useLastVisibleTarget ? this.lastVisibleTarget : this.target,
          this.targetLineColor,
        ),
      ]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('FlyFollow requires an Aircraft trait on the actor')
    }
    return aircraft
  }
}
