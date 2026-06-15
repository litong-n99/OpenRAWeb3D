/**
 * MoveAdjacentTo.ts — 移动到目标相邻格活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.cs
 *
 * 核心范式转换:
 * - C# MoveAdjacentTo base class → TypeScript base for MoveOnto, MoveWithinRange
 * - C# Target.Recalculate → Target.recalculate()
 * - C# Util.AdjacentCells → manual adjacent cell generation
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { BlockedByActor } from '../../Traits/BlockedByActor.js'

// ---------------------------------------------------------------------------
// MoveAdjacentTo
// ---------------------------------------------------------------------------

/**
 * Move to a cell adjacent to the target.
 *
 * OpenRA 对照: MoveAdjacentTo activity
 *
 * Base class for MoveOnto and MoveWithinRange. Finds adjacent cells that are
 * enterable and moves to the nearest one. Handles target visibility changes.
 */
export class MoveAdjacentTo extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly targetLineColor: ColorStub | null

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  protected target: Target
  protected lastVisibleTarget: Target
  protected lastVisibleTargetLocation: CPos
  protected useLastVisibleTarget: boolean = false
  protected readonly mobile: {
    canStayInCell: (cell: CPos) => boolean
    canEnterCell: (cell: CPos) => boolean
    pathFinder: { findPathToTargetCells: (self: GameActor, from: CPos, targets: CPos[], check: BlockedByActor) => CPos[] }
  }

  protected searchCells: CPos[] = []
  protected searchCellsTick: number = -1

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    self: GameActor,
    target: Target,
    initialTargetPosition: WPos | null = null,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this.target = target
    this.targetLineColor = targetLineColor
    this.childHasPriority = false

    this.mobile = (self as unknown as { traits: Map<string, unknown> }).traits.get('Mobile') as {
      canStayInCell: (cell: CPos) => boolean
      canEnterCell: (cell: CPos) => boolean
      pathFinder: { findPathToTargetCells: (self: GameActor, from: CPos, targets: CPos[], check: BlockedByActor) => CPos[] }
    }

    if (target.type === 2 || target.type === 3) { // Terrain or FrozenActor
      this.lastVisibleTarget = Target.fromPos(target.centerPosition)
      this.lastVisibleTargetLocation = this.getCellFromPos(self, target.centerPosition)
    } else if (initialTargetPosition !== null) {
      this.lastVisibleTarget = Target.fromPos(initialTargetPosition)
      this.lastVisibleTargetLocation = this.getCellFromPos(self, initialTargetPosition)
    } else {
      this.lastVisibleTarget = Target.Invalid
      this.lastVisibleTargetLocation = { X: 0, Y: 0 } as CPos
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getCellFromPos(self: GameActor, pos: WPos): CPos {
    const world = (self as unknown as { world?: { map?: { cellContaining: (p: WPos) => CPos } } }).world
    return world?.map?.cellContaining?.(pos) ?? { X: 0, Y: 0 } as CPos
  }

  protected getTarget(): Target {
    return this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
  }

  protected shouldStop(_self: GameActor): boolean {
    return false
  }

  protected shouldRepath(_self: GameActor, targetLocation: CPos): boolean {
    return this.lastVisibleTargetLocation !== targetLocation
  }

  protected setVisibleTargetLocation(self: GameActor, target: Target): void {
    this.lastVisibleTargetLocation = this.getCellFromPos(self, target.centerPosition)
  }

  protected getAdjacentCells(_self: GameActor, _target: Target): CPos[] {
    const center = this.lastVisibleTargetLocation
    return [
      { X: center.X - 1, Y: center.Y - 1 } as CPos,
      { X: center.X, Y: center.Y - 1 } as CPos,
      { X: center.X + 1, Y: center.Y - 1 } as CPos,
      { X: center.X - 1, Y: center.Y } as CPos,
      { X: center.X + 1, Y: center.Y } as CPos,
      { X: center.X - 1, Y: center.Y + 1 } as CPos,
      { X: center.X, Y: center.Y + 1 } as CPos,
      { X: center.X + 1, Y: center.Y + 1 } as CPos,
    ]
  }

  protected calculatePathToTarget(self: GameActor, check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
    const worldTick = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0
    if (this.searchCellsTick !== worldTick) {
      this.searchCells = []
      this.searchCellsTick = worldTick
      const adjacent = this.getAdjacentCells(self, this.getTarget())
      const selfLoc = (self as unknown as { location: CPos }).location
      for (const cell of adjacent) {
        if (this.mobile.canStayInCell(cell) && this.mobile.canEnterCell(cell)) {
          if (cell.X === selfLoc.X && cell.Y === selfLoc.Y)
            return { alreadyAtDestination: true, path: [] }
          this.searchCells.push(cell)
        }
      }
    }

    if (this.searchCells.length === 0)
      return { alreadyAtDestination: false, path: [] }

    const path = this.mobile.pathFinder.findPathToTargetCells(
      self,
      (self as unknown as { location: CPos }).location,
      this.searchCells,
      check,
    )
    return { alreadyAtDestination: false, path }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    const { alreadyAtDestination, path } = this.calculatePathToTarget(self, 3 as BlockedByActor)
    if (!alreadyAtDestination && path.length > 0) {
      this.queueChild(new MoveAdjacentToMoveStub())
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    const oldTargetLocation = this.lastVisibleTargetLocation

    const [recalculated, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculated
    if (!targetIsHiddenActor && this.target.type === 1) { // Actor
      this.lastVisibleTarget = Target.fromPos(this.target.centerPosition)
      this.setVisibleTargetLocation(self, this.target)
    }

    const targetIsValid = this.getTarget().isValidFor(self as unknown as import('../../../OpenRA.Game/Traits/IActorRef.js').IActorRef)
    this.useLastVisibleTarget = targetIsHiddenActor || !targetIsValid

    const noTarget = this.useLastVisibleTarget && !this.lastVisibleTarget.isValidFor(self as unknown as import('../../../OpenRA.Game/Traits/IActorRef.js').IActorRef)

    if (this.shouldStop(self) || noTarget) {
      this.cancel(self, true)
    } else if (!this.isCanceling && targetIsValid && this.shouldRepath(self, oldTargetLocation)) {
      const ca = this.childActivity
      if (ca !== null) ca.cancel(self)
      const { alreadyAtDestination, path } = this.calculatePathToTarget(self, 3 as BlockedByActor)
      if (!alreadyAtDestination && path.length > 0) {
        this.queueChild(new MoveAdjacentToMoveStub())
      }
    }

    const ca = this.childActivity
    if (ca !== null) {
      this.tickChild(self)
      return false
    }

    // Check move result
    const mobileResult = (self as unknown as { traits: Map<string, unknown> }).traits.get('Mobile') as {
      moveResult: number
    } | undefined
    if (mobileResult && mobileResult.moveResult === 2) // CompleteDestinationReached
      return true

    this.cancel(self, true)
    return true
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override getTargets(_self: GameActor): Target[] {
    return [this.getTarget()]
  }

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.getTarget(), this.targetLineColor)]
    }
    return []
  }
}

class MoveAdjacentToMoveStub extends Activity {
  override tick(_self: GameActor): boolean {
    return true
  }
}
