/**
 * LocalMoveIntoTarget.ts — 短程接近目标活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.cs
 *
 * 核心范式转换:
 * - C# Mobile trait access → TypeScript type assertion
 * - C# WPos math → WPos/WVec static methods
 * - C# Util.TickFacing → direct facing adjustment
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// LocalMoveIntoTarget
// ---------------------------------------------------------------------------

/**
 * Move directly toward a target at close range, without pathfinding.
 *
 * OpenRA 对照: LocalMoveIntoTarget activity
 */
export class LocalMoveIntoTarget extends Activity {
  readonly target: Target
  readonly targetMovementThreshold: WDist
  readonly targetLineColor: ColorStub | null
  private targetStartPos: WPos | null = null

  constructor(
    _self: GameActor,
    target: Target,
    targetMovementThreshold: WDist,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this.target = target
    this.targetMovementThreshold = targetMovementThreshold
    this.targetLineColor = targetLineColor
  }

  protected override onFirstRun(_self: GameActor): void {
    this.targetStartPos = this.target.positions[0] ?? null
  }

  override tick(self: GameActor): boolean {
    if (this.isCanceling || this.target.type === 0)
      return true

    const actor = self as unknown as Record<string, unknown>
    const traits = actor.traits as Map<string, unknown> | undefined
    const mobile = traits?.get('Mobile') as {
      isTraitDisabled: boolean
      isTraitPaused: boolean
      facing: WAngle
      turnSpeed: WAngle
      movementSpeedForCell: (cell: unknown) => number
      setCenterPosition: (s: GameActor, p: WPos) => void
    } | undefined

    if (!mobile || mobile.isTraitDisabled || mobile.isTraitPaused)
      return false

    const currentPos = (actor.centerPosition as WPos) ?? WPos.Zero
    const targetPos = this.target.positions[0] ?? currentPos

    // Give up if target moved too far
    if (this.targetStartPos !== null && this.targetMovementThreshold.length > 0) {
      const dx = targetPos.X - this.targetStartPos.X
      const dy = targetPos.Y - this.targetStartPos.Y
      const distSq = dx * dx + dy * dy
      if (distSq > this.targetMovementThreshold.length * this.targetMovementThreshold.length)
        return true
    }

    // Turn toward target
    const dx = targetPos.X - currentPos.X
    const dy = targetPos.Y - currentPos.Y
    const facing = (dx * dx + dy * dy) !== 0
      ? new WAngle(Math.atan2(dy, dx) * 512 / Math.PI)
      : mobile.facing

    if (facing.angle !== mobile.facing.angle) {
      const diff = ((facing.angle - mobile.facing.angle + 1024) % 1024)
      const shortestDiff = diff > 512 ? diff - 1024 : diff
      const turnAmount = Math.min(Math.abs(shortestDiff), mobile.turnSpeed.angle)
      const direction = shortestDiff >= 0 ? 1 : -1
      mobile.facing = new WAngle((mobile.facing.angle + turnAmount * direction + 1024) % 1024)
      return false
    }

    // Move toward target
    const speed = mobile.movementSpeedForCell(actor.location)
    const distSq = dx * dx + dy * dy
    if (distSq <= speed * speed) {
      mobile.setCenterPosition(self, targetPos)
      return true
    }

    const dist = Math.sqrt(distSq)
    const newPos = new WPos(
      currentPos.X + Math.trunc(dx * speed / dist),
      currentPos.Y + Math.trunc(dy * speed / dist),
      currentPos.Z + Math.trunc((targetPos.Z - currentPos.Z) * speed / dist),
    )
    mobile.setCenterPosition(self, newPos)
    return false
  }

  override getTargets(_self: GameActor): Target[] {
    return [this.target]
  }

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.target, this.targetLineColor)]
    }
    return []
  }
}
