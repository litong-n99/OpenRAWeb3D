/**
 * Follow.ts — 跟随目标活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/Follow.cs
 *
 * 核心范式转换:
 * - C# IMove trait access → TypeScript type assertion
 * - C# MoveCooldownHelper → imported helper class
 * - C# Target.Recalculate → Target.recalculate()
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { MoveCooldownHelper } from './MoveCooldownHelper.js'

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

/**
 * Follow a moving target, maintaining a distance within [minRange, maxRange].
 *
 * OpenRA 对照: Follow activity
 *
 * Recalculates the target position each tick. If the target moves out of range,
 * queues a MoveWithinRange child to re-approach. Uses MoveCooldownHelper to
 * avoid excessive pathfinding when the destination is blocked.
 */
export class Follow extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly minRange: WDist
  readonly maxRange: WDist
  readonly targetLineColor: ColorStub | null

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private target: Target
  private lastVisibleTarget: Target
  private useLastVisibleTarget: boolean = false
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

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

    const world = (self as unknown as { world?: { sharedRandom?: { next(): number } } | null }).world ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(world, null)
    this.moveCooldownHelper.retryIfDestinationBlocked = true

    // Set up lastVisibleTarget fallback
    if (target.type === 2 || target.type === 3) { // Terrain or FrozenActor
      this.lastVisibleTarget = Target.fromPos(target.centerPosition)
    } else if (initialTargetPosition !== null) {
      this.lastVisibleTarget = Target.fromPos(initialTargetPosition)
    } else {
      this.lastVisibleTarget = Target.Invalid
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (this.isCanceling)
      return true

    // Recalculate target visibility
    const [recalculated, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculated
    if (!targetIsHiddenActor && this.target.type === 1) { // Actor
      this.lastVisibleTarget = Target.fromPos(this.target.centerPosition)
    }

    this.useLastVisibleTarget = targetIsHiddenActor || !this.target.isValidFor(self as unknown as import('../../../OpenRA.Game/Traits/IActorRef.js').IActorRef)

    const cooldownResult = this.moveCooldownHelper.tick(targetIsHiddenActor)
    if (cooldownResult !== null)
      return cooldownResult

    // No valid target to follow
    if (this.useLastVisibleTarget && !this.lastVisibleTarget.isValidFor(self as unknown as import('../../../OpenRA.Game/Traits/IActorRef.js').IActorRef))
      return true

    const pos = (self as unknown as { centerPosition: WPos }).centerPosition
    const checkTarget = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target

    // In range — wait
    if (checkTarget.isInRange(pos, this.maxRange) && !checkTarget.isInRange(pos, this.minRange))
      return this.useLastVisibleTarget

    // Out of range — queue move
    this.moveCooldownHelper.notifyMoveQueued()
    // TODO-14.A: Queue real MoveWithinRange when available
    // For now, queue a stub
    this.queueChild(new FollowMoveStub())
    return false
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      const t = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
      return [new TargetLineNode(t, this.targetLineColor)]
    }
    return []
  }
}

// ---------------------------------------------------------------------------
// FollowMoveStub
// ---------------------------------------------------------------------------

class FollowMoveStub extends Activity {
  override tick(_self: GameActor): boolean {
    return true
  }
}
