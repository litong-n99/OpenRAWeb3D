/**
 * MoveOnto.ts - Move onto the exact cell containing the target
 * OpenRA reference: OpenRA.Mods.Common/Activities/Move/MoveOnto.cs
 *
 * Core paradigm shifts:
 * - C# MoveOnto extends MoveAdjacentTo -> TypeScript extends MoveAdjacentTo
 * - C# WVec offset -> TypeScript WVec offset
 * - C# List<CPos> reuse -> TypeScript CPos[] reuse
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { BlockedByActor } from '../../Traits/BlockedByActor.js'
import { MoveAdjacentTo } from './MoveAdjacentTo.js'

// ---------------------------------------------------------------------------
// MoveOnto
// ---------------------------------------------------------------------------

/**
 * Move onto the exact cell containing the target.
 *
 * OpenRA reference: MoveOnto activity
 *
 * Extends MoveAdjacentTo but targets the exact cell rather than an adjacent one.
 * If the target cell is blocked and adjacent, waits instead of failing.
 */
export class MoveOnto extends MoveAdjacentTo {
  readonly offset: WVec

  constructor(
    self: GameActor,
    target: Target,
    offset: WVec | null = null,
    initialTargetPosition: WPos | null = null,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, initialTargetPosition, targetLineColor)
    this.offset = offset ?? { X: 0, Y: 0, Z: 0 } as WVec
  }

  protected override shouldStop(_self: GameActor): boolean {
    // Stop if the target is dead (became Invalid/Terrain)
    return this.getTarget().type === 0 // TargetType.Invalid
  }

  protected override setVisibleTargetLocation(self: GameActor, target: Target): void {
    const pos = WPos.add(target.centerPosition, this.offset as unknown as WVec)
    this.lastVisibleTargetLocation = this.getCellFromPos(self, pos)
  }

  protected override calculatePathToTarget(self: GameActor, check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
    const selfLoc = (self as unknown as { location: CPos }).location
    if (this.lastVisibleTargetLocation.equals(selfLoc))
      return { alreadyAtDestination: true, path: [] }

    // If close to target but can't enter, wait
    if (!this.mobile?.canEnterCell(this.lastVisibleTargetLocation)) {
      const dx = Math.abs(this.lastVisibleTargetLocation.X - (self as unknown as { location: CPos }).location.X)
      const dy = Math.abs(this.lastVisibleTargetLocation.Y - (self as unknown as { location: CPos }).location.Y)
      if (dx <= 1 && dy <= 1)
        return { alreadyAtDestination: false, path: [] }
    }

    const path = this.mobile?.pathFinder.findPathToTargetCells(
      self,
      (self as unknown as { location: CPos }).location,
      [this.lastVisibleTargetLocation],
      check,
    ) ?? []
    return { alreadyAtDestination: false, path }
  }

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.getTarget(), this.targetLineColor)]
    }
    return []
  }
}
