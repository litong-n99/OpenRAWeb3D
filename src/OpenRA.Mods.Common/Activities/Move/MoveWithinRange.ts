/**
 * MoveWithinRange.ts — 移动到目标范围内活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/MoveWithinRange.cs
 *
 * 核心范式转换:
 * - C# MoveAdjacentTo inheritance → TypeScript extension of MoveAdjacentTo
 * - C# Map.FindTilesInAnnulus → manual cell iteration
 * - C# WDist range checks → WDist.isInRange
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { BlockedByActor } from '../../Traits/BlockedByActor.js'

// ---------------------------------------------------------------------------
// MoveWithinRange
// ---------------------------------------------------------------------------

/**
 * Move within a specified range [minRange, maxRange] of a target.
 *
 * OpenRA 对照: MoveWithinRange activity
 *
 * Searches for cells in an annulus around the target that satisfy the range
 * constraints and are enterable. Stops when the actor is at correct range.
 */
export class MoveWithinRange extends Activity {
  readonly minRange: WDist
  readonly maxRange: WDist
  readonly targetLineColor: ColorStub | null

  protected target: Target
  protected lastVisibleTarget: Target
  protected lastVisibleTargetLocation: CPos
  protected useLastVisibleTarget: boolean = false
  protected readonly mobile: {
    canStayInCell: (cell: CPos) => boolean
    canEnterCell: (cell: CPos) => boolean
    canInteractWithGroundLayer: (self: GameActor) => boolean
    pathFinder: { findPathToTargetCells: (self: GameActor, from: CPos, targets: CPos[], check: BlockedByActor) => CPos[] }
  }

  private readonly maxCells: number
  private readonly minCells: number
  private searchCells: CPos[] = []
  private searchCellsTick: number = -1

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
    this.childHasPriority = false

    this.maxCells = Math.trunc((maxRange.length + 1023) / 1024)
    this.minCells = Math.trunc(minRange.length / 1024)

    this.mobile = (self as unknown as { traits: Map<string, unknown> }).traits.get('Mobile') as {
      canStayInCell: (cell: CPos) => boolean
      canEnterCell: (cell: CPos) => boolean
      canInteractWithGroundLayer: (self: GameActor) => boolean
      pathFinder: { findPathToTargetCells: (self: GameActor, from: CPos, targets: CPos[], check: BlockedByActor) => CPos[] }
    }

    if (target.type === 2 || target.type === 3) {
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

  private getCellFromPos(self: GameActor, pos: WPos): CPos {
    const world = (self as unknown as { world?: { map?: { cellContaining: (p: WPos) => CPos } } }).world
    return world?.map?.cellContaining?.(pos) ?? { X: 0, Y: 0 } as CPos
  }

  protected getTarget(): Target {
    return this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
  }

  protected shouldStop(self: GameActor): boolean {
    const pos = (self as unknown as { centerPosition: WPos }).centerPosition
    return this.atCorrectRange(pos) &&
      this.mobile.canInteractWithGroundLayer(self) &&
      this.mobile.canStayInCell((self as unknown as { location: CPos }).location)
  }

  protected shouldRepath(self: GameActor, targetLocation: CPos): boolean {
    return this.lastVisibleTargetLocation !== targetLocation &&
      (!this.atCorrectRange((self as unknown as { centerPosition: WPos }).centerPosition) ||
        !this.mobile.canInteractWithGroundLayer(self) ||
        !this.mobile.canStayInCell((self as unknown as { location: CPos }).location))
  }

  protected setVisibleTargetLocation(self: GameActor, target: Target): void {
    this.lastVisibleTargetLocation = this.getCellFromPos(self, target.centerPosition)
  }

  private atCorrectRange(origin: WPos): boolean {
    const t = this.getTarget()
    return t.isInRange(origin, this.maxRange) && !t.isInRange(origin, this.minRange)
  }

  private findTilesInAnnulus(center: CPos, minR: number, maxR: number): CPos[] {
    const result: CPos[] = []
    for (let dx = -maxR; dx <= maxR; dx++) {
      for (let dy = -maxR; dy <= maxR; dy++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        if (dist >= minR && dist <= maxR) {
          result.push({ X: center.X + dx, Y: center.Y + dy } as CPos)
        }
      }
    }
    return result
  }

  protected calculatePathToTarget(self: GameActor, check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
    if (this.lastVisibleTargetLocation === (self as unknown as { location: CPos }).location)
      return { alreadyAtDestination: true, path: [] }

    const worldTick = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0
    if (this.searchCellsTick !== worldTick) {
      this.searchCells = []
      this.searchCellsTick = worldTick
      const cells = this.findTilesInAnnulus(this.lastVisibleTargetLocation, this.minCells, this.maxCells)
      const selfLoc = (self as unknown as { location: CPos }).location
      for (const cell of cells) {
        if (this.mobile.canStayInCell(cell) && this.mobile.canEnterCell(cell)) {
          const cellCenter = this.getCellCenter(self, cell)
          if (this.atCorrectRange(cellCenter)) {
            if (cell.X === selfLoc.X && cell.Y === selfLoc.Y)
              return { alreadyAtDestination: true, path: [] }
            this.searchCells.push(cell)
          }
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

  private getCellCenter(self: GameActor, cell: CPos): WPos {
    const world = (self as unknown as { world?: { map?: { centerOfSubCell: (c: CPos) => WPos } } }).world
    return world?.map?.centerOfSubCell?.(cell) ?? { X: 0, Y: 0, Z: 0 } as WPos
  }

  protected override onFirstRun(self: GameActor): void {
    const { alreadyAtDestination, path } = this.calculatePathToTarget(self, 3 as BlockedByActor)
    if (!alreadyAtDestination && path.length > 0) {
      this.queueChild(new MoveWithinRangeMoveStub())
    }
  }

  override tick(self: GameActor): boolean {
    const oldTargetLocation = this.lastVisibleTargetLocation

    const [recalculated, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculated
    if (!targetIsHiddenActor && this.target.type === 1) {
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
        this.queueChild(new MoveWithinRangeMoveStub())
      }
    }

    const ca = this.childActivity
    if (ca !== null) {
      this.tickChild(self)
      return false
    }

    // Check if we reached destination
    if ((self as unknown as { location: CPos }).location === this.lastVisibleTargetLocation)
      return true

    this.cancel(self, true)
    return true
  }

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

class MoveWithinRangeMoveStub extends Activity {
  override tick(_self: GameActor): boolean {
    return true
  }
}
