/**
 * MoveOnto.ts — 移动到目标格活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/MoveOnto.cs
 *
 * 核心范式转换:
 * - C# MoveAdjacentTo inheritance → TypeScript extension of MoveAdjacentTo
 * - C# WVec offset → TypeScript WVec offset
 * - C# List<CPos> reuse → TypeScript CPos[] reuse
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { BlockedByActor } from '../../Traits/BlockedByActor.js'

// ---------------------------------------------------------------------------
// MoveOnto
// ---------------------------------------------------------------------------

/**
 * Move onto the exact cell containing the target.
 *
 * OpenRA 对照: MoveOnto activity
 *
 * Extends MoveAdjacentTo logic but targets the exact cell rather than an adjacent one.
 * If the target cell is blocked and adjacent, waits instead of failing.
 */
export class MoveOnto extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly offset: WVec
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

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    self: GameActor,
    target: Target,
    offset: WVec | null = null,
    initialTargetPosition: WPos | null = null,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this.target = target
    this.offset = offset ?? { X: 0, Y: 0, Z: 0 } as WVec
    this.targetLineColor = targetLineColor
    this.childHasPriority = false

    this.mobile = (self as unknown as { traits: Map<string, unknown> }).traits.get('Mobile') as {
      canStayInCell: (cell: CPos) => boolean
      canEnterCell: (cell: CPos) => boolean
      pathFinder: { findPathToTargetCells: (self: GameActor, from: CPos, targets: CPos[], check: BlockedByActor) => CPos[] }
    }

    // Set up lastVisibleTarget
    if (target.type === 2 || target.type === 3) { // Terrain or FrozenActor
      this.lastVisibleTarget = Target.fromPos(target.centerPosition)
      this.lastVisibleTargetLocation = this.getCellContaining(self, target.centerPosition)
    } else if (initialTargetPosition !== null) {
      this.lastVisibleTarget = Target.fromPos(initialTargetPosition)
      this.lastVisibleTargetLocation = this.getCellContaining(self, initialTargetPosition)
    } else {
      this.lastVisibleTarget = Target.Invalid
      this.lastVisibleTargetLocation = { X: 0, Y: 0 } as CPos
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getCellContaining(self: GameActor, pos: WPos): CPos {
    const world = (self as unknown as { world?: { map?: { cellContaining: (p: WPos) => CPos } } }).world
    if (world?.map?.cellContaining) {
      return world.map.cellContaining(pos)
    }
    return { X: 0, Y: 0 } as CPos
  }

  protected getTarget(): Target {
    return this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
  }

  protected shouldStop(_self: GameActor): boolean {
    // Stop if the target is dead (became Terrain/Invalid)
    return this.getTarget().type === 2 // TargetType.Terrain
  }

  protected shouldRepath(_self: GameActor, targetLocation: CPos): boolean {
    return this.lastVisibleTargetLocation !== targetLocation
  }

  protected setVisibleTargetLocation(self: GameActor, target: Target): void {
    const pos = WPos.add(target.centerPosition, this.offset as unknown as WVec)
    this.lastVisibleTargetLocation = this.getCellContaining(self, pos)
  }

  // ---------------------------------------------------------------------------
  // Path calculation
  // ---------------------------------------------------------------------------

  protected calculatePathToTarget(self: GameActor, check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
    if (this.lastVisibleTargetLocation === (self as unknown as { location: CPos }).location)
      return { alreadyAtDestination: true, path: [] }

    // If close to target but can't enter, wait
    if (!this.mobile.canEnterCell(this.lastVisibleTargetLocation)) {
      const dx = Math.abs(this.lastVisibleTargetLocation.X - (self as unknown as { location: CPos }).location.X)
      const dy = Math.abs(this.lastVisibleTargetLocation.Y - (self as unknown as { location: CPos }).location.Y)
      if (dx <= 1 && dy <= 1)
        return { alreadyAtDestination: false, path: [] }
    }

    const path = this.mobile.pathFinder.findPathToTargetCells(
      self,
      (self as unknown as { location: CPos }).location,
      [this.lastVisibleTargetLocation],
      check,
    )
    return { alreadyAtDestination: false, path }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    // Queue a move to the target cell
    const { alreadyAtDestination, path } = this.calculatePathToTarget(self, 3 as BlockedByActor) // All = 3
    if (!alreadyAtDestination && path.length > 0) {
      // TODO-14.A: Queue real Move activity
      this.queueChild(new MoveOntoMoveStub())
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    const oldTargetLocation = this.lastVisibleTargetLocation

    // Recalculate target
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
      // Target moved, repath
      const ca = this.childActivity
      if (ca !== null) ca.cancel(self)
      const { alreadyAtDestination, path } = this.calculatePathToTarget(self, 3 as BlockedByActor)
      if (!alreadyAtDestination && path.length > 0) {
        this.queueChild(new MoveOntoMoveStub())
      }
    }

    // Tick child
    const ca = this.childActivity
    if (ca !== null) {
      this.tickChild(self)
      return false
    }

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

// ---------------------------------------------------------------------------
// MoveOntoMoveStub
// ---------------------------------------------------------------------------

class MoveOntoMoveStub extends Activity {
  override tick(_self: GameActor): boolean {
    return true
  }
}
