/**
 * MoveWithinRange.ts - Move within a specified range [minRange, maxRange] of a target
 * OpenRA reference: OpenRA.Mods.Common/Activities/Move/MoveWithinRange.cs
 *
 * Core paradigm shifts:
 * - C# MoveWithinRange extends MoveAdjacentTo -> TypeScript extends MoveAdjacentTo
 * - C# Map.FindTilesInAnnulus -> manual cell iteration with Euclidean distance
 * - C# WDist range checks -> WDist.isInRange
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { BlockedByActor } from '../../Traits/BlockedByActor.js'
import { MoveAdjacentTo } from './MoveAdjacentTo.js'

// ---------------------------------------------------------------------------
// MoveWithinRange
// ---------------------------------------------------------------------------

/**
 * Move within a specified range [minRange, maxRange] of a target.
 *
 * OpenRA reference: MoveWithinRange activity
 *
 * Searches for cells in an annulus around the target that satisfy the range
 * constraints and are enterable. Stops when the actor is at correct range.
 */
export class MoveWithinRange extends MoveAdjacentTo {
  readonly minRange: WDist
  readonly maxRange: WDist

  private readonly maxCells: number
  private readonly minCells: number

  constructor(
    self: GameActor,
    target: Target,
    minRange: WDist,
    maxRange: WDist,
    initialTargetPosition: WPos | null = null,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, initialTargetPosition, targetLineColor)
    this.minRange = minRange
    this.maxRange = maxRange

    this.maxCells = Math.trunc((maxRange.length + 1023) / 1024)
    this.minCells = Math.trunc(minRange.length / 1024)
  }

  protected override shouldStop(self: GameActor): boolean {
    const pos = (self as unknown as { centerPosition: WPos }).centerPosition
    return this.atCorrectRange(pos) &&
      (this.mobile?.canStayInCell((self as unknown as { location: CPos }).location) ?? false)
  }

  protected override shouldRepath(self: GameActor, targetLocation: CPos): boolean {
    return !this.lastVisibleTargetLocation.equals(targetLocation) &&
      (!this.atCorrectRange((self as unknown as { centerPosition: WPos }).centerPosition) ||
        !this.mobile?.canStayInCell((self as unknown as { location: CPos }).location))
  }

  private atCorrectRange(origin: WPos): boolean {
    const t = this.getTarget()
    return t.isInRange(origin, this.maxRange) && !t.isInRange(origin, this.minRange)
  }

  private findTilesInAnnulus(center: CPos, minR: number, maxR: number): CPos[] {
    const result: CPos[] = []
    for (let dx = -maxR; dx <= maxR; dx++) {
      for (let dy = -maxR; dy <= maxR; dy++) {
        const distSq = dx * dx + dy * dy
        const minRSq = minR * minR
        const maxRSq = maxR * maxR
        if (distSq >= minRSq && distSq <= maxRSq) {
          result.push(new CPos(center.X + dx, center.Y + dy))
        }
      }
    }
    return result
  }

  protected override calculatePathToTarget(self: GameActor, check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
    const selfLoc = (self as unknown as { location: CPos }).location
    if (this.lastVisibleTargetLocation.equals(selfLoc))
      return { alreadyAtDestination: true, path: [] }

    const worldTick = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0
    if (this.searchCellsTick !== worldTick) {
      this.searchCells = []
      this.searchCellsTick = worldTick
      const cells = this.findTilesInAnnulus(this.lastVisibleTargetLocation, this.minCells, this.maxCells)
      for (const cell of cells) {
        if (this.mobile?.canStayInCell(cell) && this.mobile?.canEnterCell(cell)) {
          const cellCenter = this.getCellCenter(self, cell)
          if (this.atCorrectRange(cellCenter)) {
            if (cell.equals(selfLoc))
              return { alreadyAtDestination: true, path: [] }
            this.searchCells.push(cell)
          }
        }
      }
    }

    if (this.searchCells.length === 0)
      return { alreadyAtDestination: false, path: [] }

    const path = this.mobile?.pathFinder.findPathToTargetCells(
      self,
      selfLoc,
      this.searchCells,
      check,
    ) ?? []
    return { alreadyAtDestination: false, path }
  }

  private getCellCenter(self: GameActor, cell: CPos): WPos {
    const world = (self as unknown as { world?: { map?: { centerOfSubCell: (c: CPos) => WPos } } }).world
    return world?.map?.centerOfSubCell?.(cell) ?? { X: 0, Y: 0, Z: 0 } as WPos
  }

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.getTarget(), this.targetLineColor)]
    }
    return []
  }
}
