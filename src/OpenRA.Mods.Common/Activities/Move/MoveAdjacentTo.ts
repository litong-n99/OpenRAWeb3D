/**
 * MoveAdjacentTo.ts - Move to a cell adjacent to the target
 * OpenRA reference: OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.cs
 *
 * Core paradigm shifts:
 * - C# MoveAdjacentTo extends Activity -> TypeScript extends Move (with custom getPath)
 * - C# Mobile.MoveTo() child queue -> direct Move inheritance with path function
 * - C# Target.Recalculate -> Target.recalculate()
 * - C# Util.AdjacentCells -> manual adjacent cell generation
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { BlockedByActor } from '../../Traits/BlockedByActor.js'
import { MoveResult } from '../../Traits/Mobile.js'
import { Move } from './Move.js'

// ---------------------------------------------------------------------------
// MoveAdjacentTo
// ---------------------------------------------------------------------------

/**
 * Move to a cell adjacent to the target.
 *
 * OpenRA reference: MoveAdjacentTo activity
 *
 * Extends Move with a custom path function that finds adjacent cells.
 * Handles target visibility changes and repathing when target moves.
 */
export class MoveAdjacentTo extends Move {
  // ---------------------------------------------------------------------------
  // State (target tracking)
  // ---------------------------------------------------------------------------

  protected target: Target
  protected lastVisibleTarget: Target
  protected lastVisibleTargetLocation: CPos
  protected useLastVisibleTarget: boolean = false

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
    // Call Move constructor with a placeholder getPath; we'll override it after
    super(self, (_check: BlockedByActor) => ({ alreadyAtDestination: false, path: [] }), targetLineColor ?? undefined)

    this.target = target
    this.childHasPriority = false

    // Override the getPath with our custom path function
    this.getPath = (check: BlockedByActor) => this.calculatePathToTarget(self, check)

    if (target.type === 2 || target.type === 3) { // Terrain or FrozenActor
      this.lastVisibleTarget = Target.fromPos(target.centerPosition)
      this.lastVisibleTargetLocation = this.getCellFromPos(self, target.centerPosition)
    } else if (initialTargetPosition !== null) {
      this.lastVisibleTarget = Target.fromPos(initialTargetPosition)
      this.lastVisibleTargetLocation = this.getCellFromPos(self, initialTargetPosition)
    } else {
      this.lastVisibleTarget = Target.Invalid
      this.lastVisibleTargetLocation = new CPos(0, 0)
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  protected getCellFromPos(self: GameActor, pos: WPos): CPos {
    const world = (self as unknown as { world?: { map?: { cellContaining: (p: WPos) => CPos } } }).world
    return world?.map?.cellContaining?.(pos) ?? new CPos(0, 0)
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
      new CPos(center.X - 1, center.Y - 1),
      new CPos(center.X, center.Y - 1),
      new CPos(center.X + 1, center.Y - 1),
      new CPos(center.X - 1, center.Y),
      new CPos(center.X + 1, center.Y),
      new CPos(center.X - 1, center.Y + 1),
      new CPos(center.X, center.Y + 1),
      new CPos(center.X + 1, center.Y + 1),
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
        if (this.mobile?.canStayInCell(cell) && this.mobile?.canEnterCell(cell)) {
          if (cell.X === selfLoc.X && cell.Y === selfLoc.Y)
            return { alreadyAtDestination: true, path: [] }
          this.searchCells.push(cell)
        }
      }
    }

    if (this.searchCells.length === 0)
      return { alreadyAtDestination: false, path: [] }

    const path = this.mobile?.pathFinder.findPathToTargetCells(
      self,
      (self as unknown as { location: CPos }).location,
      this.searchCells,
      check,
    ) ?? []
    return { alreadyAtDestination: false, path }
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
      // Repath will be handled by parent's onFirstRun / tick logic
    }

    // Delegate to Move.tick for actual movement handling
    // Tick child first (Move has childHasPriority = false, so parent tick controls)
    const ca = this.childActivity
    if (ca !== null) {
      if (!this.tickChild(self)) {
        return false
      }
    }

    // Check move result
    if (this.mobile?.moveResult === MoveResult.CompleteDestinationReached)
      return true

    // If no child and not at destination, let Move.tick handle pathing
    if (ca === null) {
      return super.tick(self)
    }

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
