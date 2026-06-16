/**
 * Move.ts - Core movement activity (path following, blocker handling, backward movement)
 * OpenRA reference: OpenRA.Mods.Common/Activities/Move/Move.cs
 *
 * Core paradigm shifts:
 * - C# Mobile cast from OccupiesSpace -> TypeScript Mobile trait lookup
 * - C# PathFinder.FindPathToTargetCell -> TypeScript pathfinder API
 * - C# nested MovePart/MoveFirstHalf/MoveSecondHalf -> TypeScript private classes
 * - C# WPos.Lerp/WRot.SLerp -> WPos.lerp/WRot.slerp
 * - C# BlockedByActor enum -> BlockedByActor const object
 * - C# List<CPos> path -> CPos[] array
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { WVec } from '../../../OpenRA.Game/WVec.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { BlockedByActor } from '../../Traits/BlockedByActor.js'
import { MoveResult } from '../../Traits/Mobile.js'
import { Turn } from '../Turn.js'

// ---------------------------------------------------------------------------
// PathSearchOrder (OpenRA reference: Move.PathSearchOrder)
// ---------------------------------------------------------------------------

const PATH_SEARCH_ORDER: BlockedByActor[] = [
  BlockedByActor.All,
  BlockedByActor.Stationary,
  BlockedByActor.Immovable,
  BlockedByActor.None,
]

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

/**
 * Core movement activity that follows a path from the actor's current cell
 * to a destination cell.
 *
 * OpenRA reference: Move activity (640 lines C#)
 *
 * Handles path evaluation, cell-by-cell movement, local avoidance (nudge/wait),
 * backward movement, and carryover progress for smooth speed.
 */
export class Move extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly nearEnough: number
  readonly ignoreActor: GameActor | null
  readonly targetLineColor: ColorStub | null
  readonly evaluateNearestMovableCell: boolean

  // ---------------------------------------------------------------------------
  // Delegates
  // ---------------------------------------------------------------------------

  protected getPath: (check: BlockedByActor) => { alreadyAtDestination: boolean; path: CPos[] }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  protected mobile: {
    toCell: CPos
    fromCell: CPos
    toSubCell: number
    fromSubCell: number
    facing: WAngle
    turnSpeed: WAngle
    moveResult: number
    turnToMove: boolean
    isTraitDisabled: boolean
    isTraitPaused: boolean
    canStayInCell: (cell: CPos) => boolean
    canEnterCell: (cell: CPos, ignoreActor?: GameActor | null, check?: BlockedByActor) => boolean
    setLocation: (from: CPos, fromSub: number, to: CPos, toSub: number) => void
    setCenterPosition: (self: GameActor, pos: WPos) => void
    setPosition: (self: GameActor, cell: CPos) => void
    finishedMoving: (self: GameActor) => void
    enteringCell: (self: GameActor) => void
    getAvailableSubCell: (cell: CPos, preferred: number, ignoreActor?: GameActor | null) => number
    getAdjacentCell: (nextCell: CPos) => CPos | null
    removeInfluence: () => void
    addInfluence: () => void
    isBlocking: boolean
    pathFinder: { findPathToTargetCells: (self: GameActor, from: CPos, targets: CPos[], check: BlockedByActor) => CPos[] }
    info: {
      canMoveBackward: boolean
      maxBackwardCells: number
      backwardDuration: number
      turnsWhileMoving: boolean
      alwaysTurnInPlace: boolean
      terrainOrientationAdjustmentMargin: { length: number }
      targetLineColor: ColorStub
      locomotorInfo: { waitAverage: number } | null
    }
    movementSpeedForCell: (cell: CPos) => number
  } | null = null

  protected actorFacingModifier: WAngle | null = null
  protected carryoverProgress: number = 0
  protected lastMovePartCompletedTick: number = -1

  protected alreadyAtDestination: boolean = false
  protected path: CPos[] = []
  protected destination: CPos | null = null
  protected startTicks: number = 0
  protected hadNoPath: boolean = false

  // Blocker handling
  protected hasWaited: boolean = false
  protected waitTicksRemaining: number = 0

  // Cached world references (avoid deep optional chaining every tick)
  protected worldTick: number = 0
  protected mapFacingBetween: ((from: CPos, to: CPos, current: WAngle) => WAngle) | null = null
  protected mapCenterOfCell: ((c: CPos) => WPos) | null = null
  protected gridOffsetOfSubCell: ((s: number) => WVec) | null = null

  // ---------------------------------------------------------------------------
  // Constructor overloads
  // ---------------------------------------------------------------------------

  constructor(self: GameActor, destination: CPos, targetLineColor?: ColorStub)
  constructor(self: GameActor, destination: CPos, nearEnough: number, ignoreActor?: GameActor | null, evaluateNearestMovableCell?: boolean, targetLineColor?: ColorStub)
  constructor(self: GameActor, getPath: (check: BlockedByActor) => { alreadyAtDestination: boolean; path: CPos[] }, targetLineColor?: ColorStub)

  constructor(
    self: GameActor,
    arg2: CPos | ((check: BlockedByActor) => { alreadyAtDestination: boolean; path: CPos[] }),
    arg3?: number | ColorStub | null,
    arg4?: GameActor | null,
    arg5?: boolean | ColorStub,
    arg6?: ColorStub,
  ) {
    super()

    // Resolve Mobile trait
    this.mobile = (self as unknown as { traits: Map<string, unknown> }).traits.get('Mobile') as Move['mobile']
    if (this.mobile) {
      this.mobile.moveResult = MoveResult.InProgress
    }

    // Cache world references
    const world = (self as unknown as {
      world?: {
        worldTick: number
        map?: {
          facingBetween: (from: CPos, to: CPos, current: WAngle) => WAngle
          centerOfCell: (c: CPos) => WPos
          grid?: { offsetOfSubCell: (s: number) => WVec }
        }
      }
    }).world
    this.worldTick = world?.worldTick ?? 0
    this.mapFacingBetween = world?.map?.facingBetween ?? null
    this.mapCenterOfCell = world?.map?.centerOfCell ?? null
    this.gridOffsetOfSubCell = world?.map?.grid?.offsetOfSubCell ?? null

    if (typeof arg2 === 'function') {
      this.getPath = arg2
      this.destination = null
      this.nearEnough = 0
      this.ignoreActor = null
      this.targetLineColor = arg3 as ColorStub | undefined ?? null
      this.evaluateNearestMovableCell = false
    } else {
      const dest = arg2 as CPos
      this.destination = dest
      this.targetLineColor = arg6 !== undefined ? arg6
        : (arg5 !== undefined && typeof arg5 !== 'boolean' ? arg5 as ColorStub
          : (arg3 !== undefined && arg3 !== null && typeof arg3 === 'object' ? arg3 as ColorStub
            : null))
      this.evaluateNearestMovableCell = typeof arg5 === 'boolean' ? arg5 : false

      if (arg3 === undefined || arg3 === null || typeof arg3 === 'object') {
        this.nearEnough = 0
        this.ignoreActor = null
        this.getPath = (check: BlockedByActor) => {
          if (!this.mobile) return { alreadyAtDestination: false, path: [] }
          if (this.mobile.toCell === dest) return { alreadyAtDestination: true, path: [] }
          const pathFinder = (self as unknown as { world?: { pathFinder?: { findPathToTargetCell: (self: GameActor, from: CPos[], to: CPos, check: BlockedByActor, laneBias: boolean) => CPos[] } } }).world?.pathFinder
          const path = pathFinder?.findPathToTargetCell(self, [this.mobile.toCell], dest, check, false) ?? []
          return { alreadyAtDestination: false, path }
        }
      } else {
        this.nearEnough = arg3 as number
        this.ignoreActor = arg4 ?? null
        this.getPath = (check: BlockedByActor) => {
          if (!this.mobile || !this.destination) return { alreadyAtDestination: false, path: [] }
          if (this.mobile.toCell === this.destination) return { alreadyAtDestination: true, path: [] }
          const pathFinder = (self as unknown as { world?: { pathFinder?: { findPathToTargetCell: (self: GameActor, from: CPos[], to: CPos, check: BlockedByActor, ignoreActor?: GameActor | null) => CPos[] } } }).world?.pathFinder
          const path = pathFinder?.findPathToTargetCell(self, [this.mobile.toCell], this.destination, check, this.ignoreActor) ?? []
          return { alreadyAtDestination: false, path }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Path evaluation
  // ---------------------------------------------------------------------------

  protected evalPath(check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
    const result = this.getPath(check)
    const filtered = result.path.filter(a => a !== this.mobile?.toCell)
    return { alreadyAtDestination: result.alreadyAtDestination, path: filtered }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    this.startTicks = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0
    if (this.mobile) this.mobile.moveResult = MoveResult.InProgress

    if (this.evaluateNearestMovableCell && this.destination !== null) {
      const nearest = this.mobile?.getAdjacentCell(this.destination)
      if (nearest != null && this.mobile != null && this.mobile.canEnterCell(nearest)) {
        this.destination = nearest
      } else {
        this.destination = null
      }
    }

    for (const check of PATH_SEARCH_ORDER) {
      const result = this.evalPath(check)
      this.alreadyAtDestination = result.alreadyAtDestination
      this.path = result.path
      if (this.alreadyAtDestination || this.path.length > 0) return
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (!this.mobile) return true

    this.mobile.turnToMove = false

    if (this.isCanceling && this.mobile.canStayInCell(this.mobile.toCell)) {
      this.path = []
      this.mobile.moveResult = MoveResult.CompleteCanceled
      return true
    }

    if (this.mobile.isTraitDisabled || this.mobile.isTraitPaused)
      return false

    if (this.alreadyAtDestination) {
      this.mobile.moveResult = MoveResult.CompleteDestinationReached
      return true
    }

    if (this.destination !== null && this.destination === this.mobile.toCell) {
      this.mobile.moveResult = this.hadNoPath
        ? MoveResult.CompleteDestinationBlocked
        : MoveResult.CompleteDestinationReached
      return true
    }

    if (this.path.length === 0) {
      this.hadNoPath = true
      this.destination = this.mobile.toCell
      return false
    }

    this.destination = this.path[0]

    const popResult = this.popPath(self)
    if (popResult.next === null) {
      if (!popResult.shouldTryAgain) {
        this.mobile.moveResult = MoveResult.CompleteDestinationBlocked
        return true
      }
      return false
    }

    const nextCell = popResult.next.cell
    const nextSubCell = popResult.next.subCell

    const firstFacing = this.mapFacingBetween?.(this.mobile.fromCell, nextCell, this.mobile.facing) ?? this.mobile.facing

    if (this.mobile.info.canMoveBackward
      && (this.mobile.info.maxBackwardCells < 0 || this.path.length < this.mobile.info.maxBackwardCells)
      && (this.mobile.info.backwardDuration < 0 || ((self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0) - this.startTicks < this.mobile.info.backwardDuration)
      && Math.abs(firstFacing.angle - this.mobile.facing.angle) > 256) {
      this.actorFacingModifier = new WAngle(512)
    } else {
      this.actorFacingModifier = new WAngle(0)
    }

    if (!this.mobile.info.turnsWhileMoving && firstFacing.angle !== this.mobile.facing.angle) {
      this.path.push(nextCell)
      this.queueChild(new Turn(self, firstFacing))
      this.mobile.turnToMove = true
      return false
    }

    this.mobile.setLocation(this.mobile.fromCell, this.mobile.fromSubCell, nextCell, nextSubCell)

    // Calculate positions and queue MoveFirstHalf
    const fromPos = this.mapCenterOfCell?.(this.mobile.fromCell) ?? WPos.Zero
    const fromSubOffset = this.gridOffsetOfSubCell?.(this.mobile.fromSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec
    const toPos = this.calculateBetweenCells(self, this.mobile.fromCell, this.mobile.toCell)
    const toSubOffset = this.gridOffsetOfSubCell?.(this.mobile.fromSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec
    const toSubOffset2 = this.gridOffsetOfSubCell?.(this.mobile.toSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec

    const fromWPos = WPos.add(fromPos, fromSubOffset)
    const midSub = {
      X: Math.trunc((toSubOffset.X + toSubOffset2.X) / 2),
      Y: Math.trunc((toSubOffset.Y + toSubOffset2.Y) / 2),
      Z: Math.trunc((toSubOffset.Z + toSubOffset2.Z) / 2),
    } as WVec
    const toWPos = WPos.add(toPos, midSub)

    this.queueChild(new MoveFirstHalf(
      this,
      fromWPos,
      toWPos,
      this.mobile.facing,
      firstFacing,
      this.carryoverProgress,
    ))
    this.carryoverProgress = 0
    return false
  }

  private calculateBetweenCells(_self: GameActor, from: CPos, to: CPos): WPos {
    const fromPos = this.mapCenterOfCell?.(from) ?? WPos.Zero
    const toPos = this.mapCenterOfCell?.(to) ?? WPos.Zero
    return WPos.lerp(fromPos, toPos, 1, 2)
  }

  // ---------------------------------------------------------------------------
  // PopPath
  // ---------------------------------------------------------------------------

  protected popPath(self: GameActor): { next: { cell: CPos; subCell: number } | null; shouldTryAgain: boolean } {
    if (this.path.length === 0 || !this.mobile)
      return { next: null, shouldTryAgain: false }

    const nextCell = this.path[this.path.length - 1]

    const dx = Math.abs(nextCell.X - this.mobile.toCell.X)
    const dy = Math.abs(nextCell.Y - this.mobile.toCell.Y)
    if (dx > 1 || dy > 1) {
      const result = this.evalPath(BlockedByActor.Immovable)
      this.alreadyAtDestination = result.alreadyAtDestination
      this.path = result.path
      return { next: null, shouldTryAgain: false }
    }

    const canEnter = this.mobile.canEnterCell(nextCell, this.ignoreActor)
    if (!canEnter) {
      const cellRange = Math.trunc(this.nearEnough / 1024)
      if (this.destination !== null) {
        const destDx = this.mobile.toCell.X - this.destination.X
        const destDy = this.mobile.toCell.Y - this.destination.Y
        if (destDx * destDx + destDy * destDy <= cellRange * cellRange && this.mobile.canStayInCell(this.mobile.toCell)) {
          if (this.path.length < 2) {
            this.path = []
            return { next: null, shouldTryAgain: false }
          }
        }
      }

      const canEnterImmovable = this.mobile.canEnterCell(nextCell, this.ignoreActor, BlockedByActor.Immovable)
      if (!canEnterImmovable) {
        const result = this.evalPath(BlockedByActor.Immovable)
        this.alreadyAtDestination = result.alreadyAtDestination
        this.path = result.path
        return { next: null, shouldTryAgain: false }
      }

      if (!this.hasWaited) {
        const waitAvg = this.mobile.info.locomotorInfo?.waitAverage ?? 20
        this.waitTicksRemaining = waitAvg
        this.hasWaited = true
        return { next: null, shouldTryAgain: true }
      }

      if (--this.waitTicksRemaining >= 0)
        return { next: null, shouldTryAgain: true }

      this.hasWaited = false

      if (this.cellIsEvacuating(self, nextCell))
        return { next: null, shouldTryAgain: true }

      this.mobile.removeInfluence()
      const { path: newPath } = this.evalPath(BlockedByActor.All)
      this.mobile.addInfluence()

      if (newPath.length > 0) {
        this.path = newPath
        const newCell = this.path[this.path.length - 1]
        this.path.pop()
        const subCell = this.mobile.getAvailableSubCell(newCell, this.mobile.fromSubCell, this.ignoreActor)
        return { next: { cell: newCell, subCell }, shouldTryAgain: true }
      } else if (this.mobile.isBlocking) {
        const adjCell = this.mobile.getAdjacentCell(nextCell)
        if (adjCell !== null) {
          const subCell = this.mobile.getAvailableSubCell(adjCell, this.mobile.fromSubCell, this.ignoreActor)
          return { next: { cell: adjCell, subCell }, shouldTryAgain: true }
        }
      }

      return { next: null, shouldTryAgain: false }
    }

    this.hasWaited = false
    this.path.pop()
    const subCell = this.mobile.getAvailableSubCell(nextCell, this.mobile.fromSubCell, this.ignoreActor)
    return { next: { cell: nextCell, subCell }, shouldTryAgain: true }
  }

  protected cellIsEvacuating(_self: GameActor, _cell: CPos): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  override cancel(self: GameActor, keepQueue: boolean = false): void {
    this.cancelWithForce(self, keepQueue, false)
  }

  cancelWithForce(self: GameActor, keepQueue: boolean, forceClearPath: boolean): void {
    if (this.path.length > 0 && (forceClearPath || (this.mobile?.canStayInCell(this.mobile.toCell) ?? false))) {
      this.path = []
    }
    super.cancel(self, keepQueue)
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  protected override onLastRun(_self: GameActor): void {
    this.path = []
    // Set move result if not already set by tick completion
    if (this.mobile && this.mobile.moveResult === MoveResult.InProgress) {
      this.mobile.moveResult = MoveResult.CompleteDestinationReached
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override getTargets(_self: GameActor): Target[] {
    if (this.destination !== null)
      return [Target.fromCell(this.destination)]
    return []
  }

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null && this.destination !== null) {
      return [new TargetLineNode(Target.fromCell(this.destination), this.targetLineColor)]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Accessors for nested classes
  // ---------------------------------------------------------------------------

  get _mobile(): Move['mobile'] { return this.mobile }
  get _carryoverProgress(): number { return this.carryoverProgress }
  set _carryoverProgress(value: number) { this.carryoverProgress = value }
  get _lastMovePartCompletedTick(): number { return this.lastMovePartCompletedTick }
  set _lastMovePartCompletedTick(value: number) { this.lastMovePartCompletedTick = value }
  get _startTicks(): number { return this.startTicks }
  get _actorFacingModifier(): WAngle | null { return this.actorFacingModifier }
  get _path(): CPos[] { return this.path }
  set _path(value: CPos[]) { this.path = value }
}

// ---------------------------------------------------------------------------
// MovePart - Abstract base class for MoveFirstHalf and MoveSecondHalf
// OpenRA reference: Move.MovePart abstract class
// ---------------------------------------------------------------------------

abstract class MovePart extends Activity {
  protected readonly move: Move
  protected readonly from: WPos
  protected readonly to: WPos
  protected readonly fromFacing: WAngle
  protected readonly toFacing: WAngle
  protected progress: number
  protected readonly distance: number

  constructor(
    move: Move,
    from: WPos,
    to: WPos,
    fromFacing: WAngle,
    toFacing: WAngle,
    carryoverProgress: number,
  ) {
    super()
    this.move = move
    this.from = from
    this.to = to
    this.fromFacing = fromFacing
    this.toFacing = toFacing
    this.progress = carryoverProgress
    this.distance = Math.sqrt(
      (to.X - from.X) * (to.X - from.X) +
      (to.Y - from.Y) * (to.Y - from.Y) +
      (to.Z - from.Z) * (to.Z - from.Z),
    )
    this.isInterruptible = false
  }

  override tick(self: GameActor): boolean {
    const mobile = this.move._mobile
    if (!mobile) return true

    const worldTick = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0
    if (this.move._lastMovePartCompletedTick < worldTick) {
      this.progress += mobile.movementSpeedForCell(mobile.toCell)
    }

    if (this.progress >= this.distance) {
      mobile.setCenterPosition(self, this.to)
      mobile.facing = this.toFacing
      this.move._lastMovePartCompletedTick = worldTick

      // Call subclass completion handler
      const nextPart = this.onComplete(self, mobile, this.move)
      if (nextPart !== null) {
        this.move.queueChild(nextPart)
      }

      return true
    }

    const t = this.distance > 0 ? this.progress / this.distance : 1
    const pos = WPos.lerp(this.from, this.to, t, 1)
    mobile.setCenterPosition(self, pos)

    // Turn while moving
    if (mobile.info.turnsWhileMoving) {
      const diff = ((this.toFacing.angle - mobile.facing.angle + 1024) % 1024)
      const shortestDiff = diff > 512 ? diff - 1024 : diff
      const turnAmount = Math.min(Math.abs(shortestDiff), mobile.turnSpeed.angle)
      const direction = shortestDiff >= 0 ? 1 : -1
      mobile.facing = new WAngle((mobile.facing.angle + turnAmount * direction + 1024) % 1024)
    } else {
      mobile.facing = new WAngle(Math.trunc(this.fromFacing.angle + (this.toFacing.angle - this.fromFacing.angle) * t))
    }

    return false
  }

  protected abstract onComplete(self: GameActor, mobile: NonNullable<Move['_mobile']>, move: Move): MovePart | null

  override getTargets(_self: GameActor): Target[] {
    return this.move.getTargets(_self)
  }

  protected override onLastRun(_self: GameActor): void {
    // Remove influence when MovePart is cancelled mid-movement
    const mobile = this.move._mobile
    if (mobile) {
      mobile.removeInfluence()
    }
  }
}

// ---------------------------------------------------------------------------
// MoveFirstHalf - handles movement from fromCell to toCell
// OpenRA reference: Move.MoveFirstHalf
// ---------------------------------------------------------------------------

class MoveFirstHalf extends MovePart {
  constructor(
    move: Move,
    from: WPos,
    to: WPos,
    fromFacing: WAngle,
    toFacing: WAngle,
    carryoverProgress: number,
  ) {
    super(move, from, to, fromFacing, toFacing, carryoverProgress)
  }

  protected override onComplete(self: GameActor, mobile: NonNullable<Move['_mobile']>, move: Move): MovePart | null {
    // Calculate the final position for MoveSecondHalf
    const world = (self as unknown as { world?: { map?: { centerOfCell: (c: CPos) => WPos; grid?: { offsetOfSubCell: (s: number) => WVec } } } }).world
    const map = world?.map
    const toPos = map?.centerOfCell?.(mobile.toCell) ?? WPos.Zero
    const toSubOffset = map?.grid?.offsetOfSubCell?.(mobile.toSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec
    const toWPos = WPos.add(toPos, toSubOffset)

    mobile.enteringCell(self)
    mobile.setLocation(mobile.toCell, mobile.toSubCell, mobile.toCell, mobile.toSubCell)

    return new MoveSecondHalf(
      move,
      this.to,
      toWPos,
      mobile.facing,
      this.toFacing,
      this.progress - this.distance,
    )
  }
}

// ---------------------------------------------------------------------------
// MoveSecondHalf - handles movement from between-cells to cell center
// OpenRA reference: Move.MoveSecondHalf
// ---------------------------------------------------------------------------

class MoveSecondHalf extends MovePart {
  constructor(
    move: Move,
    from: WPos,
    to: WPos,
    fromFacing: WAngle,
    toFacing: WAngle,
    carryoverProgress: number,
  ) {
    super(move, from, to, fromFacing, toFacing, carryoverProgress)
  }

  protected override onComplete(_self: GameActor, mobile: Move['_mobile'], move: Move): MovePart | null {
    if (!mobile) return null
    mobile.setPosition(_self, mobile.toCell)
    mobile.finishedMoving(_self)
    move._carryoverProgress = this.progress - this.distance
    return null
  }
}
