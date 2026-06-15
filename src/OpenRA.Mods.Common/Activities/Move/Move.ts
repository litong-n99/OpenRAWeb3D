/**
 * Move.ts — 核心移动活动（路径跟随、阻挡处理、后退移动）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/Move.cs
 *
 * 核心范式转换:
 * - C# Mobile cast from OccupiesSpace → TypeScript Mobile trait lookup
 * - C# PathFinder.FindPathToTargetCell → TypeScript pathfinder API
 * - C# nested MovePart/MoveFirstHalf/MoveSecondHalf → TypeScript private classes
 * - C# WPos.Lerp/WRot.SLerp → WPos.lerp/WRot.slerp
 * - C# BlockedByActor enum → BlockedByActor const object
 * - C# List<CPos> path → CPos[] array
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
import type { BlockedByActor } from '../../Traits/BlockedByActor.js'
import { MoveResult } from '../../Traits/Mobile.js'
import { Turn } from '../Turn.js'

// ---------------------------------------------------------------------------
// PathSearchOrder (对应 OpenRA Move.PathSearchOrder)
// ---------------------------------------------------------------------------

const PATH_SEARCH_ORDER: BlockedByActor[] = [3, 2, 1, 0] // All, Stationary, Immovable, None

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

/**
 * Core movement activity that follows a path from the actor's current cell
 * to a destination cell.
 *
 * OpenRA 对照: Move activity (640 lines C#)
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

  private readonly getPath: (check: BlockedByActor) => { alreadyAtDestination: boolean; path: CPos[] }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private mobile: {
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

  private actorFacingModifier: WAngle | null = null
  private carryoverProgress: number = 0
  private lastMovePartCompletedTick: number = -1

  private alreadyAtDestination: boolean = false
  private path: CPos[] = []
  private destination: CPos | null = null
  private startTicks: number = 0
  private hadNoPath: boolean = false

  // Blocker handling
  private hasWaited: boolean = false
  private waitTicksRemaining: number = 0

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

  private evalPath(check: BlockedByActor): { alreadyAtDestination: boolean; path: CPos[] } {
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

    const world = (self as unknown as { world?: { map?: { facingBetween: (from: CPos, to: CPos, current: WAngle) => WAngle } } }).world
    let firstFacing = world?.map?.facingBetween?.(this.mobile.fromCell, nextCell, this.mobile.facing) ?? this.mobile.facing

    if (this.mobile.info.canMoveBackward
      && (this.mobile.info.maxBackwardCells < 0 || this.path.length < this.mobile.info.maxBackwardCells)
      && (this.mobile.info.backwardDuration < 0 || ((self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0) - this.startTicks < this.mobile.info.backwardDuration)
      && Math.abs(firstFacing.angle - this.mobile.facing.angle) > 256) {
      this.actorFacingModifier = new WAngle(512)
      firstFacing = new WAngle((firstFacing.angle + 512) % 1024)
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
    const map = (self as unknown as { world?: { map?: { centerOfCell: (c: CPos) => WPos; grid?: { offsetOfSubCell: (s: number) => WVec } } } }).world?.map
    const fromPos = map?.centerOfCell?.(this.mobile.fromCell) ?? WPos.Zero
    const fromSubOffset = map?.grid?.offsetOfSubCell?.(this.mobile.fromSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec
    const toPos = this.calculateBetweenCells(self, this.mobile.fromCell, this.mobile.toCell)
    const toSubOffset = map?.grid?.offsetOfSubCell?.(this.mobile.fromSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec
    const toSubOffset2 = map?.grid?.offsetOfSubCell?.(this.mobile.toSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec

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
    const world = (_self as unknown as { world?: { map?: { centerOfCell: (c: CPos) => WPos } } }).world
    const fromPos = world?.map?.centerOfCell?.(from) ?? WPos.Zero
    const toPos = world?.map?.centerOfCell?.(to) ?? WPos.Zero
    return new WPos(
      Math.trunc((fromPos.X + toPos.X) / 2),
      Math.trunc((fromPos.Y + toPos.Y) / 2),
      Math.trunc((fromPos.Z + toPos.Z) / 2),
    )
  }

  // ---------------------------------------------------------------------------
  // PopPath
  // ---------------------------------------------------------------------------

  private popPath(self: GameActor): { next: { cell: CPos; subCell: number } | null; shouldTryAgain: boolean } {
    if (this.path.length === 0 || !this.mobile)
      return { next: null, shouldTryAgain: false }

    const nextCell = this.path[this.path.length - 1]

    const dx = Math.abs(nextCell.X - this.mobile.toCell.X)
    const dy = Math.abs(nextCell.Y - this.mobile.toCell.Y)
    if (dx > 1 || dy > 1) {
      const result = this.evalPath(1 as BlockedByActor)
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

      const canEnterImmovable = this.mobile.canEnterCell(nextCell, this.ignoreActor, 1 as BlockedByActor)
      if (!canEnterImmovable) {
        const result = this.evalPath(1 as BlockedByActor)
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
      const { path: newPath } = this.evalPath(3 as BlockedByActor)
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

  private cellIsEvacuating(_self: GameActor, _cell: CPos): boolean {
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
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override getTargets(_self: GameActor): Target[] {
    if (this.path.length > 0)
      return this.path.map(c => Target.fromCell(c))
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
// MoveFirstHalf — handles movement from fromCell to toCell
// ---------------------------------------------------------------------------

class MoveFirstHalf extends Activity {
  private readonly move: Move
  private readonly from: WPos
  private readonly to: WPos
  private readonly fromFacing: WAngle
  private readonly toFacing: WAngle
  private progress: number
  private readonly distance: number

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

    if (this.move._lastMovePartCompletedTick < ((self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0)) {
      this.progress += mobile.movementSpeedForCell(mobile.toCell)
    }

    if (this.progress >= this.distance) {
      mobile.setCenterPosition(self, this.to)
      mobile.facing = this.toFacing
      this.move._lastMovePartCompletedTick = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0

      // Queue MoveSecondHalf
      const world = (self as unknown as { world?: { map?: { centerOfCell: (c: CPos) => WPos; grid?: { offsetOfSubCell: (s: number) => WVec } } } }).world
      const map = world?.map
      const toPos = map?.centerOfCell?.(mobile.toCell) ?? WPos.Zero
      const toSubOffset = map?.grid?.offsetOfSubCell?.(mobile.toSubCell) ?? { X: 0, Y: 0, Z: 0 } as WVec
      const toWPos = WPos.add(toPos, toSubOffset)

      this.queue(new MoveSecondHalf(this.move, this.to, toWPos, mobile.facing, this.toFacing, this.progress - this.distance))
      mobile.enteringCell(self)
      mobile.setLocation(mobile.toCell, mobile.toSubCell, mobile.toCell, mobile.toSubCell)
      return true
    }

    const t = this.distance > 0 ? this.progress / this.distance : 1
    const pos = new WPos(
      Math.trunc(this.from.X + (this.to.X - this.from.X) * t),
      Math.trunc(this.from.Y + (this.to.Y - this.from.Y) * t),
      Math.trunc(this.from.Z + (this.to.Z - this.from.Z) * t),
    )
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

  override getTargets(_self: GameActor): Target[] {
    return this.move.getTargets(_self)
  }
}

// ---------------------------------------------------------------------------
// MoveSecondHalf — handles movement from between-cells to cell center
// ---------------------------------------------------------------------------

class MoveSecondHalf extends Activity {
  private readonly move: Move
  private readonly from: WPos
  private readonly to: WPos
  private readonly fromFacing: WAngle
  private readonly toFacing: WAngle
  private progress: number
  private readonly distance: number

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

    if (this.move._lastMovePartCompletedTick < ((self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0)) {
      this.progress += mobile.movementSpeedForCell(mobile.toCell)
    }

    if (this.progress >= this.distance) {
      mobile.setCenterPosition(self, this.to)
      mobile.facing = this.toFacing
      this.move._lastMovePartCompletedTick = (self as unknown as { world?: { worldTick: number } }).world?.worldTick ?? 0
      mobile.setPosition(self, mobile.toCell)
      this.move._carryoverProgress = this.progress - this.distance
      return true
    }

    const t = this.distance > 0 ? this.progress / this.distance : 1
    const pos = new WPos(
      Math.trunc(this.from.X + (this.to.X - this.from.X) * t),
      Math.trunc(this.from.Y + (this.to.Y - this.from.Y) * t),
      Math.trunc(this.from.Z + (this.to.Z - this.from.Z) * t),
    )
    mobile.setCenterPosition(self, pos)

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

  override getTargets(_self: GameActor): Target[] {
    return this.move.getTargets(_self)
  }
}
