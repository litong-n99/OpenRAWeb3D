/**
 * MoveOntoAndTurn.ts — 移动到目标格并转向活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.cs
 *
 * 核心范式转换:
 * - C# MoveOnto inheritance → TypeScript extension of MoveOnto
 * - C# Turn child queuing → queueChild(new Turn(...))
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import type { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { WVec } from '../../../OpenRA.Game/WVec.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Turn } from '../Turn.js'
import { MoveOnto } from './MoveOnto.js'

// ---------------------------------------------------------------------------
// MoveOntoAndTurn
// ---------------------------------------------------------------------------

/**
 * Move onto a target cell, then turn to face a desired direction.
 *
 * OpenRA 对照: MoveOntoAndTurn activity
 *
 * After the MoveOnto completes, if a desired facing was specified and the
 * activity is not canceling, queues a Turn child to face the desired direction.
 */
export class MoveOntoAndTurn extends MoveOnto {
  readonly desiredFacing: WAngle | null

  constructor(
    self: GameActor,
    target: Target,
    offset: WVec,
    desiredFacing: WAngle | null = null,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, offset, null, targetLineColor)
    this.desiredFacing = desiredFacing
  }

  override tick(self: GameActor): boolean {
    if (super.tick(self)) {
      if (!this.isCanceling && this.desiredFacing !== null) {
        const mobile = (self as unknown as { traits: Map<string, unknown> }).traits.get('Mobile') as {
          facing: WAngle
        } | undefined
        if (mobile && this.desiredFacing.angle !== mobile.facing.angle) {
          this.queueChild(new Turn(self, this.desiredFacing))
          return false
        }
      }
      return true
    }
    return false
  }
}
