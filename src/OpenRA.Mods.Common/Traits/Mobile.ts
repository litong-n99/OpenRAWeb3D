/**
 * Mobile.ts — Full mobile unit trait (ground movement)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Mobile.cs (1079 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<MobileInfo> → TS ConditionalTrait<MobileInfo>
 * - C# WRot orientation; WAngle Facing via orientation.Yaw → orientation stored as
 *   WRot, facing getter/setter delegates to WRot.WithYaw
 * - C# Locomotor fetched via world actor traits → ILocomotor injected/resolved
 * - C# Lazy<IEnumerable<int>> speedModifiers → memoized getSpeedModifiers()
 * - C# nested ReturnToCellActivity / LeaveProductionActivity → private stub
 *   Activity classes (deferred to Ch14 / Ch11)
 * - C# MoveOrderTargeter nested class → exported class (order generation
 *   deferred to Ch15)
 * - 3D integration: orientation.yaw → TransformNode.rotation.y via radians
 *   conversion at render boundary
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
  type ISync,
  type IFacing,
  type IFacingInfo,
  type IResolveOrder,
  type IIssueOrder,
  type IOrderVoice,
  type IOrderTargeter,
  type IOccupySpaceInfo,
  type IPositionable,
  type IMoveInfo,
  type INotifyAddedToWorld,
  type INotifyRemovedFromWorld,
  type INotifyBlockingMove,
  type INotifyBecomingIdle,
  type INotifyCustomLayerChanged,
  type IActorPreviewInitModifier,
  type IDeathActorInitModifier,
  type INotifyCenterPositionChanged,
  type INotifyMoving,
  type INotifyFinishedMoving,
  type IWrapMove,
  type ICreationActivity,
  type ActivityStub,
  type Order,
  type IObservesVariables,
  type VariableObserver,
  type VariableObserverNotifier,
  type ColorStub,
  type ActorInfoStub,
  type TargetStub,
  type OccupiedCell,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { applyPercentageModifiers } from '../Projectiles/MissileMath.js'

import type { ILocomotor, LocomotorInfo } from './World/Locomotor.js'
import { MovementType, hasMovementType } from './World/Locomotor.js'
import type { BlockedByActor } from './BlockedByActor.js'
import { SubCell as SubCellEnum } from '../../OpenRA.Game/Traits/SubCell.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { PathGraph } from '../Pathfinder/IPathGraph.js'

// ---------------------------------------------------------------------------
// MoveResult enum
// OpenRA 对照: MoveResult enum
// ---------------------------------------------------------------------------

/** Result of a move operation.
 *
 * OpenRA 对照: MoveResult enum
 */
export const MoveResult = {
  Moving: 0,
  Consumed: 1,
  Blocked: 2,
} as const

export type MoveResult = (typeof MoveResult)[keyof typeof MoveResult]

// ---------------------------------------------------------------------------
// IMove — local extension of the simplified TS IMove with full C# Mobile API
// ---------------------------------------------------------------------------

/**
 * Full IMove interface matching C# Mobile methods.
 *
 * The TS IMove in TraitsInterfaces.ts is simplified (single-parameter methods
 * taking Target). Mobile implements this extended version with all the C#
 * overloads plus the TS-required methods.
 */
export interface IFullMove {
  /** Move to a specific cell.
   *
   * OpenRA 对照: Mobile.MoveTo(CPos, int, Actor, bool, Color?)
   */
  moveToCell(
    cell: CPos,
    nearEnough?: number,
    ignoreActor?: IGameActor | null,
    evaluateNearestMovableCell?: boolean,
    targetLineColor?: ColorStub,
  ): ActivityStub

  /** Move within range of a target.
   *
   * OpenRA 对照: Mobile.MoveWithinRange(Target, WDist, WPos?, Color?)
   */
  moveWithinRange(
    target: TargetStub,
    range: WDist,
    initialTargetPosition?: WPos,
    targetLineColor?: ColorStub,
  ): ActivityStub

  /** Move within min/max range of a target.
   *
   * OpenRA 对照: Mobile.MoveWithinRange(Target, WDist, WDist, WPos?, Color?)
   */
  moveWithinRangeMinMax(
    target: TargetStub,
    minRange: WDist,
    maxRange: WDist,
    initialTargetPosition?: WPos,
    targetLineColor?: ColorStub,
  ): ActivityStub

  /** Follow a target between min/max range.
   *
   * OpenRA 对照: Mobile.MoveFollow()
   */
  moveFollow(
    target: TargetStub,
    minRange: WDist,
    maxRange: WDist,
    initialTargetPosition?: WPos,
    targetLineColor?: ColorStub,
  ): ActivityStub

  /** Return to the actor's home cell.
   *
   * OpenRA 对照: Mobile.ReturnToCell()
   */
  returnToCell(): ActivityStub

  /** Move onto a target and face it.
   *
   * OpenRA 对照: Mobile.MoveOntoTarget()
   */
  moveOntoTarget(
    target: TargetStub,
    offset: WVec,
    facing?: WAngle,
    targetLineColor?: ColorStub,
  ): ActivityStub

  /** Estimate move duration between two world positions.
   *
   * OpenRA 对照: Mobile.EstimatedMoveDuration()
   */
  estimatedMoveDuration(
    self: IGameActor,
    fromPos: WPos,
    toPos: WPos,
  ): number

  /** Find the nearest moveable cell.
   *
   * OpenRA 对照: Mobile.NearestMoveableCell(CPos, int, int)
   */
  nearestMoveableCell(
    target: CPos,
    minRange?: number,
    maxRange?: number,
  ): CPos

  /** Local move between two world positions.
   *
   * OpenRA 对照: Mobile.LocalMove(WPos, WPos)
   */
  localMove(
    fromPos: WPos,
    toPos: WPos,
  ): ActivityStub
}

// ---------------------------------------------------------------------------
// MobileInfo (config class)
// OpenRA 对照: MobileInfo : PausableConditionalTraitInfo, IMoveInfo,
//   IPositionableInfo, IFacingInfo, IActorPreviewInitInfo, IEditorActorOptions
// ---------------------------------------------------------------------------

/** Configuration for the Mobile trait.
 *
 * OpenRA 对照: MobileInfo
 */
export class MobileInfo implements
  ConditionalTraitInfo,
  IMoveInfo,
  IOccupySpaceInfo,
  IFacingInfo
{
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Which Locomotor does this trait use. Must be defined on the World actor.
   *
   * OpenRA 对照: MobileInfo.Locomotor
   */
  readonly locomotor: string

  /** Initial facing angle.
   *
   * OpenRA 对照: MobileInfo.InitialFacing (default WAngle.Zero)
   */
  readonly initialFacing: WAngle

  /** Speed at which the actor turns (angle units per tick).
   *
   * OpenRA 对照: MobileInfo.TurnSpeed (default new WAngle(512))
   */
  readonly turnSpeed: WAngle

  /** Movement speed in ticks per cell.
   *
   * OpenRA 对照: MobileInfo.Speed (default 1)
   */
  readonly speed: number

  /** If true, this unit will always turn in place instead of following a
   * curved trajectory (like infantry).
   *
   * OpenRA 对照: MobileInfo.AlwaysTurnInPlace
   */
  readonly alwaysTurnInPlace: boolean

  /** If true, this unit won't stop to turn, it will turn while moving instead.
   *
   * OpenRA 对照: MobileInfo.TurnsWhileMoving
   */
  readonly turnsWhileMoving: boolean

  /** Cursor to display when a move order can be issued at target location.
   *
   * OpenRA 对照: MobileInfo.Cursor (default "move")
   */
  readonly cursor: string

  /** Cursor overrides to display for specific terrain types.
   *
   * OpenRA 对照: MobileInfo.TerrainCursors
   */
  readonly terrainCursors: ReadonlyMap<string, string>

  /** Cursor to display when a move order cannot be issued at target location.
   *
   * OpenRA 对照: MobileInfo.BlockedCursor (default "move-blocked")
   */
  readonly blockedCursor: string

  /** Voice for move orders.
   *
   * OpenRA 对照: MobileInfo.Voice (default "Action")
   */
  readonly voice: string

  /** Color for the target line for regular move orders.
   *
   * OpenRA 对照: MobileInfo.TargetLineColor (default Color.Green)
   */
  readonly targetLineColor: ColorStub

  /** Facing to use for actor previews (map editor, color picker, etc.).
   *
   * OpenRA 对照: MobileInfo.PreviewFacing (default new WAngle(384))
   */
  readonly previewFacing: WAngle

  /** Display order for the facing slider in the map editor.
   *
   * OpenRA 对照: MobileInfo.EditorFacingDisplayOrder (default 3)
   */
  readonly editorFacingDisplayOrder: number

  /** Can move backward if possible.
   *
   * OpenRA 对照: MobileInfo.CanMoveBackward
   */
  readonly canMoveBackward: boolean

  /** After how many ticks the actor will turn forward during backoff.
   * -1 means unlimited backward movement.
   *
   * OpenRA 对照: MobileInfo.BackwardDuration (default 40)
   */
  readonly backwardDuration: number

  /** Actor will only try to move backwards when the path (in cells) is shorter
   * than this value. -1 means unlimited.
   *
   * OpenRA 对照: MobileInfo.MaxBackwardCells (default 15)
   */
  readonly maxBackwardCells: number

  /** Boolean expression defining the condition for force-move cursor.
   *
   * OpenRA 对照: MobileInfo.RequireForceMoveCondition
   */
  readonly requireForceMoveCondition: string | null

  /** Boolean expression defining the condition for immovability.
   *
   * OpenRA 对照: MobileInfo.ImmovableCondition
   */
  readonly immovableCondition: string | null

  /** The distance from the edge of a cell over which the actor will adjust its
   * tilt when moving between cells with different ramp types.
   * -1 means that the actor does not tilt on slopes.
   *
   * OpenRA 对照: MobileInfo.TerrainOrientationAdjustmentMargin
   */
  readonly terrainOrientationAdjustmentMargin: WDist

  /**
   * The resolved LocomotorInfo from the World actor.
   *
   * OpenRA 对照: MobileInfo.LocomotorInfo
   */
  locomotorInfo: LocomotorInfo | null = null

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    locomotor?: string
    initialFacing?: WAngle
    turnSpeed?: WAngle
    speed?: number
    alwaysTurnInPlace?: boolean
    turnsWhileMoving?: boolean
    cursor?: string
    terrainCursors?: ReadonlyMap<string, string>
    blockedCursor?: string
    voice?: string
    targetLineColor?: ColorStub
    previewFacing?: WAngle
    editorFacingDisplayOrder?: number
    canMoveBackward?: boolean
    backwardDuration?: number
    maxBackwardCells?: number
    requireForceMoveCondition?: string | null
    immovableCondition?: string | null
    terrainOrientationAdjustmentMargin?: WDist
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.locomotor = params.locomotor ?? 'default'
    this.initialFacing = params.initialFacing ?? WAngle.Zero
    this.turnSpeed = params.turnSpeed ?? new WAngle(512)
    this.speed = params.speed ?? 1
    this.alwaysTurnInPlace = params.alwaysTurnInPlace ?? false
    this.turnsWhileMoving = params.turnsWhileMoving ?? false
    this.cursor = params.cursor ?? 'move'
    this.terrainCursors = params.terrainCursors ?? new Map()
    this.blockedCursor = params.blockedCursor ?? 'move-blocked'
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? { r: 0, g: 1, b: 0, a: 1 }
    this.previewFacing = params.previewFacing ?? new WAngle(384)
    this.editorFacingDisplayOrder = params.editorFacingDisplayOrder ?? 3
    this.canMoveBackward = params.canMoveBackward ?? false
    this.backwardDuration = params.backwardDuration ?? 40
    this.maxBackwardCells = params.maxBackwardCells ?? 15
    this.requireForceMoveCondition = params.requireForceMoveCondition ?? null
    this.immovableCondition = params.immovableCondition ?? null
    this.terrainOrientationAdjustmentMargin =
      params.terrainOrientationAdjustmentMargin ?? new WDist(-1)
  }

  /** Get the initial facing angle.
   *
   * OpenRA 对照: MobileInfo.GetInitialFacing()
   */
  getInitialFacing(): WAngle {
    return this.initialFacing
  }

  /** Get the target line color for move orders.
   *
   * OpenRA 对照: MobileInfo.GetTargetLineColor()
   */
  getTargetLineColor(): ColorStub {
    return this.targetLineColor
  }

  /** Return the cells that would be occupied by this actor at a given cell.
   *
   * OpenRA 对照: MobileInfo.OccupiedCells()
   */
  occupiedCells(
    _info: ActorInfoStub,
    location: CPos,
    subCell: SubCellEnum = SubCellEnum.Any,
  ): ReadonlyMap<CPos, SubCellEnum> {
    return new Map([[location, subCell]])
  }

  /** Whether this actor shares cells with others.
   *
   * OpenRA 对照: IOccupySpaceInfo.SharesCell → LocomotorInfo.SharesCell
   * NOTE: C# default for LocomotorInfo.SharesCell is false.
   */
  get sharesCell(): boolean {
    return this.locomotorInfo?.SharesCell ?? false
  }

  /**
   * Note: If the target cell has any free subcell, the value of subCell is
   * ignored (matching OpenRA behavior).
   *
   * OpenRA 对照: MobileInfo.CanEnterCell()
   *
   * NOTE: Uses locomotor.movementCostToEnterCell() which checks BOTH terrain
   * cost (water, cliffs) AND actor blocking. The previous implementation
   * incorrectly only checked blocking via canMoveFreelyInto().
   */
  canEnterCell(
    self: IGameActor,
    cell: CPos,
    check: BlockedByActor,
    _subCell: SubCellEnum = SubCellEnum.FullCell,
    ignoreActor: IGameActor | null = null,
    locomotor: ILocomotor | null,
  ): boolean {
    if (!locomotor) return false
    // Overload 2 (without srcNode): (actor, destNode, check, ignoreActor, ignoreSelf)
    return locomotor.movementCostToEnterCell(
      self,
      cell,
      check,
      ignoreActor ?? null,
      false,
    ) !== PathGraph.MovementCostForUnreachableCell
  }

  /**
   * Check if the actor can stay in a given cell.
   *
   * OpenRA 对照: MobileInfo.CanStayInCell()
   */
  canStayInCell(
    cell: CPos,
    locomotor: ILocomotor | null,
  ): boolean {
    if (!locomotor) return false
    // STUB: Tunnel check deferred to Ch12
    // if (cell.Layer === CustomMovementLayerType.Tunnel) return false
    return locomotor.movementCostForCell(cell) !== PathGraph.MovementCostForUnreachableCell
  }
}

// ---------------------------------------------------------------------------
// Mobile (core implementation)
// OpenRA 对照: Mobile : PausableConditionalTrait<MobileInfo>, IIssueOrder,
//   IResolveOrder, IOrderVoice, IPositionable, IMove, ITick,
//   ICreationActivity, IFacing, IDeathActorInitModifier,
//   INotifyAddedToWorld, INotifyRemovedFromWorld, INotifyBlockingMove,
//   IActorPreviewInitModifier, INotifyBecomingIdle, ISync
// ---------------------------------------------------------------------------

/** Full mobile unit trait for ground movement.
 *
 * OpenRA 对照: Mobile class
 */
export class Mobile
  extends ConditionalTrait<MobileInfo>
  implements
    IPositionable,
    IFacing,
    ITick,
    IResolveOrder,
    IIssueOrder,
    IOrderVoice,
    ICreationActivity,
    INotifyAddedToWorld,
    INotifyRemovedFromWorld,
    INotifyBlockingMove,
    INotifyBecomingIdle,
    IActorPreviewInitModifier,
    IDeathActorInitModifier,
    IObservesVariables,
    ISync,
    IFullMove
{
  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  private _self!: IGameActor
  private _speedModifiersMemo: number[] | null = null
  private _returnToCellOnCreation: boolean = false
  private _creationActivityDelay: number = 0
  private _creationRallypoint: CPos[] | null = null

  private _movementTypes: MovementType = MovementType.None
  private _terrainRampOrientation: WRot = WRot.None
  private _oldFacing: WAngle = WAngle.Zero
  private _orientation: WRot = WRot.None
  private _oldPos: WPos = WPos.Zero
  private _fromCell!: CPos
  private _toCell!: CPos
  private _centerPosition: WPos = WPos.Zero

  private _notifyCustomLayerChanged: INotifyCustomLayerChanged[] = []
  private _notifyCenterPositionChanged: INotifyCenterPositionChanged[] = []
  private _notifyMoving: INotifyMoving[] = []
  private _notifyFinishedMoving: INotifyFinishedMoving[] = []
  private _requireForceMove: boolean = false
  private _isBlocking: boolean = false
  private _moveResult: MoveResult = MoveResult.Moving
  private _turnToMove: boolean = false
  private _locomotor: ILocomotor | null = null

  /** Lazily-resolved locomotor cached on first use.
   *
   * OpenRA 对照: Mobile.locomotor (Lazy resolution via world traits)
   */
  private _locomotorResolved: ILocomotor | null = null

  /** Tracks whether immovable condition is evaluated as active. */
  private _immoConditionActive: boolean = false

  // Internal subcell state
  private _fromSubCell: SubCellEnum = SubCellEnum.FullCell
  private _toSubCell_cache: SubCellEnum = SubCellEnum.FullCell

  // -----------------------------------------------------------------------
  // IPositionable: centerPosition, isInWorld, isLeavingMap
  // -----------------------------------------------------------------------

  get centerPosition(): WPos {
    return this._centerPosition
  }

  setCenterPosition(_self: IGameActor, pos: WPos): void {
    this._centerPosition = pos

    // HACK: World.UpdateMaps — cast through unknown to avoid WorldStub issues
    const world = this._self.world as unknown as Record<string, unknown> | null
    if (world && typeof world.updateMaps === 'function') {
      world.updateMaps(this._self, this)
    }

    // Set terrain ramp orientation
    const map = world?.map as unknown as Record<string, unknown> | null
    if (map && typeof (map as Record<string, unknown>).cellContaining === 'function') {
      const cell = (map as unknown as { cellContaining: (p: WPos) => CPos }).cellContaining(pos)
      if (typeof (map as Record<string, unknown>).terrainOrientation === 'function') {
        const terrainOrientation = (map as unknown as { terrainOrientation: (c: CPos) => WRot }).terrainOrientation(cell)
        this.setTerrainRampOrientation(terrainOrientation)
      }
    }

    // Notify center position changed
    for (const n of this._notifyCenterPositionChanged) {
      n.onCenterPositionChanged(this._self)
    }
  }

  canCenterPositionChange(_self: IGameActor): boolean {
    return !this.isTraitDisabled && !this.isImmovable
  }

  get isInWorld(): boolean {
    return this._self?.isInWorld ?? false
  }

  isLeavingMap(_self: IGameActor): boolean {
    return this.isLeaving()
  }

  // -----------------------------------------------------------------------
  // IOccupySpace
  // -----------------------------------------------------------------------

  get topLeft(): CPos {
    return this._toCell
  }

  occupiedCells(): readonly OccupiedCell[] {
    if (CPos.equals(this._fromCell, this._toCell)) {
      return [{ cell: this._fromCell, subCell: this._fromSubCell }]
    }

    // HACK: Should be fixed properly, see OpenRA pull/17292
    if (this.info.sharesCell) {
      return [{ cell: this._toCell, subCell: this._toSubCell_cache }]
    }

    return [
      { cell: this._fromCell, subCell: this._fromSubCell },
      { cell: this._toCell, subCell: this._toSubCell_cache },
    ]
  }

  // -----------------------------------------------------------------------
  // IFacing
  // -----------------------------------------------------------------------

  get turnSpeed(): WAngle {
    return this.info.turnSpeed
  }

  get facing(): WAngle {
    return this._orientation.yaw
  }

  set facing(value: WAngle) {
    this._orientation = this._orientation.withYaw(value)
  }

  get orientation(): WRot {
    return this._orientation.rotate(this._terrainRampOrientation)
  }

  // -----------------------------------------------------------------------
  // Movement state
  // -----------------------------------------------------------------------

  get currentMovementTypes(): Set<string> {
    const set = new Set<string>()
    if (hasMovementType(this._movementTypes, MovementType.Horizontal)) {
      set.add('Horizontal')
    }
    if (hasMovementType(this._movementTypes, MovementType.Vertical)) {
      set.add('Vertical')
    }
    if (hasMovementType(this._movementTypes, MovementType.Turn)) {
      set.add('Turn')
    }
    return set
  }

  /**
   * Internal setter for movement types that fires change notifications.
   *
   * OpenRA 对照: Mobile.CurrentMovementTypes setter
   */
  private setCurrentMovementTypes(value: MovementType): void {
    const oldValue = this._movementTypes
    this._movementTypes = value
    if (value !== oldValue) {
      // HACK: ActorMap.UpdateOccupiedCells via world
      const world = this._self?.world as unknown as Record<string, unknown> | null
      if (world && typeof world.updateOccupiedCells === 'function') {
        world.updateOccupiedCells(this)
      }
      for (const n of this._notifyMoving) {
        n.onNotifyMoving(this._self)
      }
    }
  }

  /** Current movement types as raw bitmask.
   *
   * OpenRA 对照: Mobile.CurrentMovementTypes (internal)
   */
  get movementTypes(): MovementType {
    return this._movementTypes
  }

  get fromSubCell(): SubCellEnum {
    return this._fromSubCell
  }

  get toSubCell(): SubCellEnum {
    return this._toSubCell_cache
  }

  /** FromCell position.
   *
   * OpenRA 对照: Mobile.FromCell
   */
  get fromCell(): CPos {
    return this._fromCell
  }

  /** ToCell position.
   *
   * OpenRA 对照: Mobile.ToCell
   */
  get toCell(): CPos {
    return this._toCell
  }

  /** Whether the actor is currently moving between two cells.
   *
   * OpenRA 对照: Mobile.IsMovingBetweenCells
   */
  get isMovingBetweenCells(): boolean {
    return !CPos.equals(this._fromCell, this._toCell)
  }

  /** The result of the last move operation.
   *
   * OpenRA 对照: Mobile.MoveResult
   */
  get moveResult(): MoveResult {
    return this._moveResult
  }

  set moveResult(value: MoveResult) {
    this._moveResult = value
  }

  /** Whether the actor can interact with the ground (Layer 0) terrain.
   *
   * OpenRA 对照: Mobile.CanInteractWithGroundLayer()
   */
  canInteractWithGroundLayer(_self: IGameActor): boolean {
    if (this._toCell.Layer === 0) return true
    // Custom movement layers check deferred to Ch12
    return false
  }

  /** Whether the actor is immovable (condition-based).
   *
   * OpenRA 对照: Mobile.IsImmovable
   */
  get isImmovable(): boolean {
    return this.info.immovableCondition !== null &&
      this._immoConditionActive === true
  }

  /** Whether the actor is blocking other actors.
   *
   * OpenRA 对照: Mobile.IsBlocking
   */
  get isBlocking(): boolean {
    return this._isBlocking
  }

  set isBlocking(value: boolean) {
    this._isBlocking = value
  }

  /** Whether the actor should turn to move.
   *
   * OpenRA 对照: Mobile.TurnToMove
   */
  get turnToMove(): boolean {
    return this._turnToMove
  }

  set turnToMove(value: boolean) {
    this._turnToMove = value
  }

  /** Check if the actor is currently leaving (moving horizontally or turning to move).
   *
   * OpenRA 对照: Mobile.IsLeaving()
   */
  isLeaving(): boolean {
    if (hasMovementType(this._movementTypes, MovementType.Horizontal)) {
      return true
    }
    if (hasMovementType(this._movementTypes, MovementType.Turn)) {
      return this._turnToMove
    }
    return false
  }

  // -----------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: Mobile(ActorInitializer init, MobileInfo info)
  // -----------------------------------------------------------------------

  constructor(info: MobileInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Lifecycle: Called after trait creation
  // (mirrors C# Mobile constructor + Created)
  // OpenRA 对照: Mobile.Created()
  // -----------------------------------------------------------------------

  /** Initialize the mobile trait with the owning actor.
   *
   * OpenRA 对照: Mobile constructor body + Created()
   */
  initialize(self: IGameActor, fromCell?: CPos, centerPos?: WPos): void {
    this._self = self

    // Convert facing to orientation
    const initialFacing = this.info.initialFacing
    this.facing = initialFacing
    this._oldFacing = initialFacing

    // Set up cells
    if (fromCell) {
      this._fromCell = fromCell
      this._toCell = fromCell
    } else {
      this._fromCell = new CPos(0, 0)
      this._toCell = new CPos(0, 0)
    }

    // Set initial subcell
    if (this.info.sharesCell) {
      this._fromSubCell = this._toSubCell_cache =
        (this.info.locomotorInfo as unknown as Record<string, unknown>)?.['DefaultSubCell'] as SubCellEnum | undefined ?? SubCellEnum.FullCell
    } else {
      this._fromSubCell = SubCellEnum.FullCell
      this._toSubCell_cache = SubCellEnum.FullCell
    }

    if (centerPos) {
      this._oldPos = centerPos
      this.setCenterPosition(self, centerPos)
      this._returnToCellOnCreation = true
    }
  }

  /** Set the locomotor reference (resolved from world).
   *
   * OpenRA 对照: Mobile.Created() → Locomotor assignment
   */
  setLocomotor(locomotor: ILocomotor): void {
    this._locomotor = locomotor
  }

  /** Get the current locomotor.
   *
   * OpenRA 对照: Mobile.Locomotor
   */
  get locomotor(): ILocomotor | null {
    return this._locomotor
  }

  /** Resolve the locomotor lazily (cached on first use).
   *
   * OpenRA 对照: Mobile C# constructor: locomotor is resolved via
   * world.WorldActor.TraitsImplementing<Locomotor>().SingleOrDefault()
   * in a lazy pattern. This mirrors that lazy resolution.
   */
  private getLocomotor(): ILocomotor | null {
    if (!this._locomotorResolved && this._locomotor) {
      this._locomotorResolved = this._locomotor
    }
    return this._locomotorResolved
  }

  // -----------------------------------------------------------------------
  // ITick.Tick
  // OpenRA 对照: ITick.Tick(Actor self)
  // -----------------------------------------------------------------------

  tick(): void {
    this.updateMovement()
  }

  /** Update the current movement types based on position/facing changes.
   *
   * OpenRA 对照: Mobile.UpdateMovement()
   */
  updateMovement(): void {
    let newMovementTypes = MovementType.None
    const delta = WPos.subtract(this._oldPos, this._centerPosition)
    if (delta.horizontalLengthSquared !== 0) {
      newMovementTypes |= MovementType.Horizontal
    }
    if (this._oldPos.Z !== this._centerPosition.Z) {
      newMovementTypes |= MovementType.Vertical
    }
    if (!WAngle.equals(this._oldFacing, this.facing)) {
      newMovementTypes |= MovementType.Turn
    }
    this.setCurrentMovementTypes(newMovementTypes)

    this._oldPos = this._centerPosition
    this._oldFacing = this.facing
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld / INotifyRemovedFromWorld
  // OpenRA 对照: AddedToWorld / RemovedFromWorld
  // -----------------------------------------------------------------------

  addedToWorld(self: IGameActor): void {
    // HACK: World.AddToMaps via world stub
    const world = self.world as unknown as Record<string, unknown> | null
    if (world && typeof world.addToMaps === 'function') {
      world.addToMaps(self, this)
    }
  }

  removedFromWorld(self: IGameActor): void {
    const world = self.world as unknown as Record<string, unknown> | null
    if (world && typeof world.removeFromMaps === 'function') {
      world.removeFromMaps(self, this)
    }
  }

  // -----------------------------------------------------------------------
  // PausableConditionalTrait overrides
  // OpenRA 对照: TraitEnabled / TraitDisabled / TraitPaused / TraitResumed
  // -----------------------------------------------------------------------

  protected override traitEnabled(_actor: IGameActor): void {
    super.traitEnabled(_actor)
    // HACK: World.ActorMap.UpdateOccupiedCells
    const world = this._self?.world as unknown as Record<string, unknown> | null
    if (world && typeof world.updateOccupiedCells === 'function') {
      world.updateOccupiedCells(this)
    }
  }

  protected override traitDisabled(_actor: IGameActor): void {
    super.traitDisabled(_actor)
    const world = this._self?.world as unknown as Record<string, unknown> | null
    if (world && typeof world.updateOccupiedCells === 'function') {
      world.updateOccupiedCells(this)
    }
  }

  /** Pause trait (e.g., out of ammo).
   *
   * OpenRA 对照: PausableConditionalTrait.TraitPaused()
   */
  traitPaused(_actor: IGameActor): void {
    this._paused = true
    const world = this._self?.world as unknown as Record<string, unknown> | null
    if (world && typeof world.updateOccupiedCells === 'function') {
      world.updateOccupiedCells(this)
    }
  }

  /** Resume trait from pause.
   *
   * OpenRA 对照: PausableConditionalTrait.TraitResumed()
   */
  traitResumed(_actor: IGameActor): void {
    this._paused = false
    const world = this._self?.world as unknown as Record<string, unknown> | null
    if (world && typeof world.updateOccupiedCells === 'function') {
      world.updateOccupiedCells(this)
    }
  }

  // -----------------------------------------------------------------------
  // Local misc stuff
  // OpenRA 对照: Mobile #region Local misc stuff
  // -----------------------------------------------------------------------

  /** Get an adjacent cell that is enterable, optionally avoiding preferred cells.
   *
   * OpenRA 对照: Mobile.GetAdjacentCell()
   */
  getAdjacentCell(
    nextCell: CPos,
    preferToAvoid?: (cell: CPos) => boolean,
    random?: { next(): number },
  ): CPos | null {
    const availCells: CPos[] = []
    const notStupidCells: CPos[] = []

    for (const direction of CVec.Directions) {
      const p = CPos.add(this._toCell, direction)
      if (this.canEnterCell(p) && this.canStayInCell(p) &&
        (!preferToAvoid || !preferToAvoid(p))) {
        availCells.push(p)
      } else if (!CPos.equals(p, nextCell) && !CPos.equals(p, this._toCell)) {
        notStupidCells.push(p)
      }
    }

    if (availCells.length > 0) {
      if (random) {
        return availCells[Math.floor(Math.abs(random.next()) * availCells.length)]
      }
      return availCells[0]
    }

    // Try moving movable actors out of the way — STUB
    if (notStupidCells.length > 0) {
      if (random) {
        return notStupidCells[Math.floor(Math.abs(random.next()) * notStupidCells.length)]
      }
      return notStupidCells[0]
    }

    return null
  }

  // -----------------------------------------------------------------------
  // IPositionable implementation
  // OpenRA 对照: Mobile #region IPositionable
  // -----------------------------------------------------------------------

  /** Returns a valid sub-cell position.
   *
   * OpenRA 对照: Mobile.GetValidSubCell()
   */
  getValidSubCell(preferred: SubCellEnum = SubCellEnum.Any): SubCellEnum {
    let preferredSubCell = preferred
    if (preferredSubCell === SubCellEnum.Any) {
      preferredSubCell = this._fromSubCell
    }

    // Fix sub-cell assignment
    if (this.info.sharesCell) {
      if (preferredSubCell <= SubCellEnum.FullCell) {
        return (this.info.locomotorInfo as unknown as Record<string, unknown>)?.['DefaultSubCell'] as SubCellEnum | undefined ?? SubCellEnum.FullCell
      }
    } else {
      if (preferredSubCell !== SubCellEnum.FullCell) {
        return SubCellEnum.FullCell
      }
    }

    return preferredSubCell
  }

  /** Sets the location and center position from a cell.
   *
   * OpenRA 对照: Mobile.SetPosition(Actor, CPos, SubCell)
   */
  setPosition(_self: IGameActor, cell: CPos, subCell: SubCellEnum = SubCellEnum.Any): void {
    const validSubCell = this.getValidSubCell(subCell)
    this.setLocation(cell, validSubCell, cell, validSubCell)

    const world = this._self.world as unknown as Record<string, unknown> | null
    const map = world?.map as unknown as Record<string, unknown> | null
    if (map) {
      let position: WPos
      if (cell.Layer === 0) {
        position = (map as unknown as { centerOfCell: (c: CPos) => WPos }).centerOfCell(cell)
      } else {
        // Custom movement layer center — STUB
        position = WPos.Zero
      }
      const grid = (map as unknown as Record<string, unknown>)['grid'] as unknown as Record<string, unknown> | null
      if (grid && typeof (grid as Record<string, unknown>).offsetOfSubCell === 'function') {
        const offset = (grid as unknown as { offsetOfSubCell: (s: SubCellEnum) => WVec }).offsetOfSubCell(validSubCell)
        position = WPos.add(position, offset)
      }
      position = WPos.subtractVec(position, new WVec(0, 0, 0)) // dummy Z offset
      this.setCenterPosition(this._self, position)
    }

    this.finishedMoving(this._self)
  }

  /** Sets the location and center position from a WPos.
   *
   * OpenRA 对照: Mobile.SetPosition(Actor, WPos)
   */
  setPositionFromPos(_self: IGameActor, pos: WPos): void {
    const world = this._self.world as unknown as Record<string, unknown> | null
    const map = world?.map as unknown as Record<string, unknown> | null
    let cell: CPos
    if (map && typeof (map as Record<string, unknown>).cellContaining === 'function') {
      cell = (map as unknown as { cellContaining: (p: WPos) => CPos }).cellContaining(pos)
    } else {
      cell = new CPos(0, 0)
    }
    this.setLocation(cell, this._fromSubCell, cell, this._fromSubCell)
    this.setCenterPosition(this._self, pos)
    this.finishedMoving(this._self)
  }

  /** Set the terrain ramp orientation for rendering.
   *
   * OpenRA 对照: Mobile.SetTerrainRampOrientation()
   */
  setTerrainRampOrientation(orientation: WRot): void {
    if (this.info.terrainOrientationAdjustmentMargin.length >= 0) {
      this._terrainRampOrientation = orientation
    }
  }

  /** Check if the actor is leaving a specific cell.
   *
   * OpenRA 对照: Mobile.IsLeavingCell()
   */
  isLeavingCell(location: CPos, subCell: SubCellEnum = SubCellEnum.Any): boolean {
    return !CPos.equals(this._toCell, location) && CPos.equals(this._fromCell, location) &&
      (subCell === SubCellEnum.Any || this._fromSubCell === subCell ||
        subCell === SubCellEnum.FullCell || this._fromSubCell === SubCellEnum.FullCell)
  }

  /** Get an available sub-cell at a position.
   *
   * OpenRA 对照: Mobile.GetAvailableSubCell()
   */
  getAvailableSubCell(
    _a: CPos,
    preferredSubCell: SubCellEnum = SubCellEnum.Any,
    _ignoreActor: IGameActor | null = null,
    _check: BlockedByActor = 3, // All
  ): SubCellEnum {
    if (!this._locomotor) return SubCellEnum.Invalid
    // STUB: Locomotor.getAvailableSubCell not yet on ILocomotor interface
    return preferredSubCell !== SubCellEnum.Any ? preferredSubCell : SubCellEnum.FullCell
  }

  /** Check if the actor can exist in a cell (terrain passable).
   *
   * OpenRA 对照: Mobile.CanExistInCell()
   */
  canExistInCell(cell: CPos): boolean {
    if (!this._locomotor) return false
    return this._locomotor.movementCostForCell(cell) !== PathGraph.MovementCostForUnreachableCell
  }

  /** Check if the actor can enter a cell.
   *
   * OpenRA 对照: Mobile.CanEnterCell()
   */
  canEnterCell(
    cell: CPos,
    ignoreActor?: IGameActor | null,
    check?: BlockedByActor,
  ): boolean {
    return this.info.canEnterCell(
      this._self,
      cell,
      check ?? 3, // BlockedByActor.All
      this._toSubCell_cache,
      ignoreActor ?? null,
      this.getLocomotor(),
    )
  }

  /** Check if the actor can stay in a cell.
   *
   * OpenRA 对照: Mobile.CanStayInCell()
   */
  canStayInCell(cell: CPos): boolean {
    return this.info.canStayInCell(cell, this.getLocomotor())
  }

  // -----------------------------------------------------------------------
  // Local IPositionable-related
  // OpenRA 对照: Mobile #region Local IPositionable-related
  // -----------------------------------------------------------------------

  /** Sets only the location (fromCell, toCell, subcells).
   *
   * OpenRA 对照: Mobile.SetLocation()
   */
  setLocation(
    from: CPos,
    fromSub: SubCellEnum,
    to: CPos,
    toSub: SubCellEnum,
  ): void {
    if (CPos.equals(this._fromCell, from) && CPos.equals(this._toCell, to) &&
      this._toSubCell_cache === toSub &&
      this._fromSubCell === fromSub) {
      return
    }

    this.removeInfluence()
    this._fromCell = from
    this._toCell = to
    this._fromSubCell = fromSub
    this._toSubCell_cache = toSub
    this.addInfluence()
    this._isBlocking = false

    // Custom layer change notification
    if (to.Layer !== from.Layer) {
      for (const n of this._notifyCustomLayerChanged) {
        n.customLayerChanged(this._self, from.Layer, to.Layer)
      }
    }
  }

  /** Signal that the actor has finished moving.
   *
   * OpenRA 对照: Mobile.FinishedMoving()
   */
  finishedMoving(self: IGameActor): void {
    if (this._fromCell?.Layer === this._toCell?.Layer) {
      for (const n of this._notifyFinishedMoving) {
        n.onNotifyFinishedMoving(self)
      }
    }
    // CrushAction: STUB — crush detection deferred to Ch14
  }

  /** Add this actor's influence to the actor map.
   *
   * OpenRA 对照: Mobile.AddInfluence()
   */
  addInfluence(): void {
    if (this._self?.isInWorld) {
      const world = this._self.world as unknown as Record<string, unknown> | null
      if (world && typeof world.addInfluence === 'function') {
        world.addInfluence(this._self, this)
      }
    }
  }

  /** Remove this actor's influence from the actor map.
   *
   * OpenRA 对照: Mobile.RemoveInfluence()
   */
  removeInfluence(): void {
    if (this._self?.isInWorld) {
      const world = this._self.world as unknown as Record<string, unknown> | null
      if (world && typeof world.removeInfluence === 'function') {
        world.removeInfluence(this._self, this)
      }
    }
  }

  // -----------------------------------------------------------------------
  // IMove-related: MoveTo
  // OpenRA 对照: Mobile #region IMove
  // -----------------------------------------------------------------------

  /** Wrap a move activity with move wrappers (e.g., map-edge wrapping).
   *
   * OpenRA 对照: Mobile.WrapMove()
   */
  wrapMove(inner: ActivityStub): ActivityStub {
    // STUB: moveWrappers[0].WrapMove not yet implemented
    return inner
  }

  /** Move to a specific cell.
   *
   * OpenRA 对照: Mobile.MoveTo(CPos, int, Actor, bool, Color?)
   */
  moveToCell(
    _cell: CPos,
    _nearEnough: number = 0,
    _ignoreActor?: IGameActor | null,
    _evaluateNearestMovableCell?: boolean,
    _targetLineColor?: ColorStub,
  ): ActivityStub {
    // STUB: Move activity deferred to Ch14
    return new ReturnToCellActivity()
  }

  /** Move to within range of a target.
   *
   * OpenRA 对照: Mobile.MoveWithinRange(Target, WDist, WPos?, Color?)
   */
  moveWithinRange(
    _target: TargetStub,
    _range: WDist,
    _initialTargetPosition?: WPos,
    _targetLineColor?: ColorStub,
  ): ActivityStub {
    return new ReturnToCellActivity()
  }

  /** Move within min/max range of a target.
   *
   * OpenRA 对照: Mobile.MoveWithinRange(Target, WDist, WDist, WPos?, Color?)
   */
  moveWithinRangeMinMax(
    _target: TargetStub,
    _minRange: WDist,
    _maxRange: WDist,
    _initialTargetPosition?: WPos,
    _targetLineColor?: ColorStub,
  ): ActivityStub {
    return new ReturnToCellActivity()
  }

  /** Move to follow a target between min/max range.
   *
   * OpenRA 对照: Mobile.MoveFollow()
   */
  moveFollow(
    _target: TargetStub,
    _minRange: WDist,
    _maxRange: WDist,
    _initialTargetPosition?: WPos,
    _targetLineColor?: ColorStub,
  ): ActivityStub {
    return new ReturnToCellActivity()
  }

  /** Return to the actor's home cell.
   *
   * OpenRA 对照: Mobile.ReturnToCell()
   */
  returnToCell(): ActivityStub {
    return new ReturnToCellActivity()
  }

  /** Move onto a target and face it.
   *
   * OpenRA 对照: Mobile.MoveOntoTarget()
   */
  moveOntoTarget(
    _target: TargetStub,
    _offset: WVec,
    _facing?: WAngle,
    _targetLineColor?: ColorStub,
  ): ActivityStub {
    return new ReturnToCellActivity()
  }

  /** Estimate the duration (in ticks) to move between two positions.
   *
   * OpenRA 对照: Mobile.EstimatedMoveDuration()
   */
  estimatedMoveDuration(
    _self: IGameActor,
    fromPos: WPos,
    toPos: WPos,
  ): number {
    const speed = this.movementSpeedForCell(this._toCell)
    const delta = WPos.subtract(toPos, fromPos)
    return speed > 0 ? delta.length / speed : 0
  }

  /** Find the nearest moveable cell.
   *
   * OpenRA 对照: Mobile.NearestMoveableCell(CPos)
   */
  nearestMoveableCell(
    target: CPos,
    minRange?: number,
    maxRange?: number,
  ): CPos {
    return this.nearestMoveableCellImpl(
      target,
      minRange ?? 1,
      maxRange ?? 10,
    )
  }

  /** Local move between two world positions.
   *
   * OpenRA 对照: Mobile.LocalMove(WPos, WPos)
   */
  localMove(
    _fromPos: WPos,
    _toPos: WPos,
  ): ActivityStub {
    return new ReturnToCellActivity()
  }

  // -----------------------------------------------------------------------
  // Local IMove-related
  // OpenRA 对照: Mobile #region Local IMove-related
  // -----------------------------------------------------------------------

  /** Get the movement speed for a specific cell, accounting for terrain and
   * speed modifiers.
   *
   * OpenRA 对照: Mobile.MovementSpeedForCell()
   */
  movementSpeedForCell(cell: CPos): number {
    const terrainSpeed = this._locomotor
      ? this._locomotor.movementCostForCell(cell)
      : 100
    const modifiers = this.getSpeedModifiers()
    return applyPercentageModifiers(this.info.speed, [...modifiers, terrainSpeed])
  }

  /** Get the memoized speed modifiers.
   *
   * OpenRA 对照: Mobile.speedModifiers (Lazy)
   */
  private getSpeedModifiers(): number[] {
    if (this._speedModifiersMemo === null) {
      this._speedModifiersMemo = []
      // STUB: In full impl, queries self.TraitsImplementing<ISpeedModifier>()
    }
    return this._speedModifiersMemo
  }

  /** Reset the speed modifiers cache.
   *
   * OpenRA 对照: speedModifiers reset when traits change
   */
  resetSpeedModifiers(): void {
    this._speedModifiersMemo = null
  }

  /** Find the nearest moveable cell within [minRange, maxRange] of a target.
   *
   * OpenRA 对照: Mobile.NearestMoveableCell(CPos, int, int)
   */
  nearestMoveableCellImpl(
    target: CPos,
    minRange: number,
    maxRange: number,
  ): CPos {
    // HACK: Work around code that blindly tries to move to cells in invalid
    // movement layers.
    let adjustedTarget = target
    if (target.Layer !== 0) {
      adjustedTarget = new CPos(target.X, target.Y)
    }

    if (CPos.equals(adjustedTarget, this._toCell) && this.canStayInCell(adjustedTarget)) {
      return adjustedTarget
    }

    if (this.canEnterCell(adjustedTarget, null, 1 /* Immovable */) && this.canStayInCell(adjustedTarget)) {
      return adjustedTarget
    }

    // Search in annulus
    const world = this._self.world as unknown as Record<string, unknown> | null
    const map = world?.map as unknown as Record<string, unknown> | null
    if (map && typeof (map as Record<string, unknown>).findTilesInAnnulus === 'function') {
      const findTiles = (map as unknown as { findTilesInAnnulus: (c: CPos, min: number, max: number) => CPos[] })
      const tiles = findTiles.findTilesInAnnulus(adjustedTarget, minRange, maxRange)
      for (const tile of tiles) {
        if (this.canEnterCell(tile, null, 1 /* Immovable */) && this.canStayInCell(tile)) {
          return tile
        }
      }
    }

    return adjustedTarget
  }

  /** Find the nearest cell satisfying a check within [minRange, maxRange].
   *
   * OpenRA 对照: Mobile.NearestCell()
   */
  nearestCell(
    target: CPos,
    check: (cell: CPos) => boolean,
    minRange: number,
    maxRange: number,
  ): CPos {
    if (check(target)) return target

    const world = this._self.world as unknown as Record<string, unknown> | null
    const map = world?.map as unknown as Record<string, unknown> | null
    if (map && typeof (map as Record<string, unknown>).findTilesInAnnulus === 'function') {
      const findTiles = (map as unknown as { findTilesInAnnulus: (c: CPos, min: number, max: number) => CPos[] })
      const tiles = findTiles.findTilesInAnnulus(target, minRange, maxRange)
      for (const tile of tiles) {
        if (check(tile)) return tile
      }
    }

    return target
  }

  /** Called when the actor is entering a cell — crush warning.
   *
   * OpenRA 对照: Mobile.EnteringCell()
   */
  enteringCell(_self: IGameActor): void {
    // CrushAction: STUB — deferred to Ch14
  }

  /** Find the closest ground cell from the current position.
   *
   * OpenRA 对照: Mobile.ClosestGroundCell()
   */
  closestGroundCell(): CPos | null {
    const above = new CPos(this._toCell.X, this._toCell.Y)
    if (this.canEnterCell(above)) return above

    // STUB: PathFinder.FindPathToTargetCellByPredicate deferred to Ch14
    return null
  }

  // -----------------------------------------------------------------------
  // IActorPreviewInitModifier / IDeathActorInitModifier
  // -----------------------------------------------------------------------

  modifyActorPreviewInit(
    _self: IGameActor,
    inits: Map<string, unknown>,
  ): void {
    if (!inits.has('DynamicFacingInit') && !inits.has('FacingInit')) {
      inits.set('DynamicFacingInit', { value: this.facing })
    }
  }

  modifyDeathActorInit(
    _self: IGameActor,
    init: Map<string, unknown>,
  ): void {
    init.set('FacingInit', this.facing)
    // Allow husk to drag to its final position
    if (this.canEnterCell(this._toCell, null, 2 /* Stationary */)) {
      init.set('HuskSpeedInit', this.movementSpeedForCell(this._toCell))
    }
  }

  // -----------------------------------------------------------------------
  // INotifyBecomingIdle
  // -----------------------------------------------------------------------

  onBecomingIdle(_self: IGameActor): void {
    if (this._toCell.Layer === 0) {
      // Make sure that units aren't left idling in a transit-only cell
      if (this._locomotor && !this.canStayInCell(this._toCell)) {
        // STUB: QueueActivity MoveTo
        return
      }
      return
    }
    // Custom movement layers: deferred to Ch12
  }

  // -----------------------------------------------------------------------
  // INotifyBlockingMove
  // -----------------------------------------------------------------------

  onNotifyBlockingMove(self: IGameActor, _blocking: IGameActor): void {
    // STUB: AppearsFriendlyTo and Nudge are deferred to Ch14
    if (self.isIdle ?? false) {
      return
    }
    this._isBlocking = true
  }

  // -----------------------------------------------------------------------
  // IObservesVariables
  // OpenRA 对照: Mobile.GetVariableObservers()
  // -----------------------------------------------------------------------

  getVariableObservers(): readonly VariableObserver[] {
    const observers: VariableObserver[] = []

    if (this.info.requireForceMoveCondition) {
      const notifier: VariableObserverNotifier = (
        _actor: IGameActor,
        conditions: ReadonlyMap<string, number>,
      ) => {
        this._requireForceMove = this.evaluateConditionString(
          this.info.requireForceMoveCondition!,
          conditions,
        )
      }
      observers.push({
        notifier,
        variables: this.extractVariables(this.info.requireForceMoveCondition),
      })
    }

    if (this.info.immovableCondition) {
      const notifier: VariableObserverNotifier = (
        _actor: IGameActor,
        conditions: ReadonlyMap<string, number>,
      ) => {
        const wasImmovable = this.isImmovable
        this._immoConditionActive = this.evaluateConditionString(
          this.info.immovableCondition!,
          conditions,
        )
        if (wasImmovable !== this.isImmovable) {
          const world = this._self?.world as unknown as Record<string, unknown> | null
          if (world && typeof world.updateOccupiedCells === 'function') {
            world.updateOccupiedCells(this)
          }
        }
      }
      observers.push({
        notifier,
        variables: this.extractVariables(this.info.immovableCondition),
      })
    }

    return observers
  }

  /** Evaluate a condition expression string against a variable map.
   *
   * STUB: In full impl, uses BooleanExpression.Evaluate()
   */
  private evaluateConditionString(
    expr: string,
    conditions: ReadonlyMap<string, number>,
  ): boolean {
    return conditions.has(expr) && (conditions.get(expr) ?? 0) > 0
  }

  /** Extract variable names from a condition expression string.
   *
   * STUB: In full impl, uses BooleanExpression.Variables
   */
  private extractVariables(_expr: string): readonly string[] {
    return []
  }

  // -----------------------------------------------------------------------
  // IIssueOrder
  // OpenRA 对照: Mobile #region IIssueOrder (Orders + IssueOrder)
  // -----------------------------------------------------------------------

  get orders(): readonly IOrderTargeter[] {
    if (this.isTraitDisabled) return []
    return [new MoveOrderTargeter(this)]
  }

  issueOrder(
    _self: IGameActor,
    order: IOrderTargeter,
    target: TargetStub,
    queued: boolean,
  ): Order {
    if (order instanceof MoveOrderTargeter) {
      return {
        orderName: 'Move',
        targetString: '',
        extraData: { target, queued },
      } as unknown as Order
    }
    // Return null-equivalent
    return null as unknown as Order
  }

  // -----------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: Mobile.IResolveOrder.ResolveOrder()
  // -----------------------------------------------------------------------

  resolveOrder(self: IGameActor, order: Order): void {
    if (this.isTraitDisabled) return

    if (order.orderName === 'Move') {
      // Check if target is valid
      const extra = order.extraData as Record<string, unknown> | undefined
      if (!extra?.['target']) return

      // STUB: MoveIntoShroud check, cell clamping
      // Queue move activity
      if (self.queueActivity) {
        self.queueActivity(new ReturnToCellActivity() as unknown as ActivityStub)
      }
    } else if (order.orderName === 'Stop') {
      if (self.cancelActivity) {
        self.cancelActivity()
      }
    } else if (order.orderName === 'Scatter') {
      // STUB: Nudge deferred to Ch14
      if (self.queueActivity) {
        self.queueActivity(new ReturnToCellActivity() as unknown as ActivityStub)
      }
    }
  }

  // -----------------------------------------------------------------------
  // IOrderVoice
  // -----------------------------------------------------------------------

  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (this.isTraitDisabled) return ''

    switch (order.orderName) {
      case 'Move':
      case 'Scatter':
      case 'Stop':
        return this.info.voice
      default:
        return ''
    }
  }

  // -----------------------------------------------------------------------
  // ICreationActivity
  // -----------------------------------------------------------------------

  getCreationActivity(): ActivityStub {
    if (this._returnToCellOnCreation || this._creationRallypoint || this._creationActivityDelay > 0) {
      return new LeaveProductionActivity() as unknown as ActivityStub
    }
    return null as unknown as ActivityStub
  }

  // -----------------------------------------------------------------------
  // Observer registration (inverse of Trait.Created notifications wire-up)
  // -----------------------------------------------------------------------

  /** Register center position changed observers.
   *
   * OpenRA 对照: Created() → notifyCenterPositionChanged array
   */
  setCenterPositionObservers(observers: INotifyCenterPositionChanged[]): void {
    this._notifyCenterPositionChanged = observers
  }

  /** Register moving observers.
   *
   * OpenRA 对照: Created() → notifyMoving array
   */
  setMovingObservers(observers: INotifyMoving[]): void {
    this._notifyMoving = observers
  }

  /** Register finished moving observers.
   *
   * OpenRA 对照: Created() → notifyFinishedMoving array
   */
  setFinishedMovingObservers(observers: INotifyFinishedMoving[]): void {
    this._notifyFinishedMoving = observers
  }

  /** Register custom layer changed observers.
   *
   * OpenRA 对照: Created() → notifyCustomLayerChanged array
   */
  setCustomLayerObservers(observers: INotifyCustomLayerChanged[]): void {
    this._notifyCustomLayerChanged = observers
  }

  /** Register move wrappers.
   *
   * OpenRA 对照: Created() → moveWrappers array
   */
  setMoveWrappers(_wrappers: IWrapMove[]): void {
    // STUB: moveWrappers deferred — WrapMove always returns inner directly
  }

  /** Set the creation activity parameters.
   *
   * OpenRA 对照: Constructor → creationActivityDelay, creationRallypoint
   */
  setCreationParams(delay: number, rallypoint: CPos[] | null): void {
    this._creationActivityDelay = delay
    this._creationRallypoint = rallypoint
  }
}

// ---------------------------------------------------------------------------
// MoveOrderTargeter
// OpenRA 对照: Mobile.MoveOrderTargeter : IOrderTargeter (sealed)
// ---------------------------------------------------------------------------

/** Order targeter for move orders.
 *
 * OpenRA 对照: Mobile.MoveOrderTargeter
 */
export class MoveOrderTargeter implements IOrderTargeter {
  readonly orderID: string = 'Move'
  readonly orderPriority: number = 4
  private _isQueued: boolean = false
  private readonly _mobile: Mobile

  constructor(mobile: Mobile) {
    this._mobile = mobile
  }

  get isQueued(): boolean {
    return this._isQueued
  }

  targetOverridesSelection(
    _actor: IGameActor,
    _target: TargetStub,
    _actorsAt: readonly IGameActor[],
    _xy: CPos,
    modifiers: number,
  ): boolean {
    // Always prioritise orders over selecting other peoples actors
    if ((_target as unknown as Record<string, unknown>).Type === 'Actor') {
      const targetRecord = _target as unknown as Record<string, unknown>
      const targetActor = targetRecord['Actor'] as Record<string, unknown> | undefined
      const targetOwner = targetActor?.['owner']
      const selfOwner = _actor.owner
      if (targetOwner !== selfOwner) return true
    }
    // Check ForceMove modifier
    return (modifiers & 4) !== 0 // TargetModifiers.ForceMove
  }

  canTarget(
    _actor: IGameActor,
    _target: TargetStub,
    modifiers: number,
    _cursor: string,
  ): boolean {
    this._isQueued = (modifiers & 2) !== 0 // TargetModifiers.ForceQueue

    // Check force move condition
    if (this._mobile['_requireForceMove'] && (modifiers & 4) === 0) {
      return false
    }

    if (this._mobile.isTraitPaused) {
      // NOTE: In C# this modifies the ref cursor parameter directly.
      // In TS we return false via canTarget but can't modify the cursor string.
    }

    return true
  }
}

// ---------------------------------------------------------------------------
// ReturnToCellActivity — stub (deferred to Ch14)
// OpenRA 对照: Mobile.ReturnToCellActivity : Activity
// ---------------------------------------------------------------------------

/** Moves actor to nearest valid cell on creation.
 *
 * OpenRA 对照: Mobile.ReturnToCellActivity
 *
 * STUB: Returns immediate success. Full implementation deferred to Ch14.
 */
export class ReturnToCellActivity {
  /** Whether this activity can be interrupted. */
  isInterruptible: boolean = false

  /** Whether this activity is being cancelled. */
  isCanceling: boolean = false

  tick(_self: IGameActor): boolean {
    // STUB: immediately complete
    return true
  }

  cancel(_actor: IGameActor): void {
    this.isCanceling = true
  }

  queue(_activity: ActivityStub): void {
    // STUB: no-op
  }

  onActorDisposeOuter(_actor: IGameActor): void {
    // STUB: no-op
  }
}

// ---------------------------------------------------------------------------
// LeaveProductionActivity — stub (deferred to Ch11)
// OpenRA 对照: Mobile.LeaveProductionActivity : Activity
// ---------------------------------------------------------------------------

/** Exits production facility.
 *
 * OpenRA 对照: Mobile.LeaveProductionActivity
 *
 * STUB: Returns immediate success. Full implementation deferred to Ch11.
 */
export class LeaveProductionActivity {
  /** Whether this activity can be interrupted. */
  isInterruptible: boolean = false

  /** Whether this activity is being cancelled. */
  isCanceling: boolean = false

  tick(_self: IGameActor): boolean {
    // STUB: immediately complete
    return true
  }

  cancel(_actor: IGameActor): void {
    this.isCanceling = true
  }

  queue(_activity: ActivityStub): void {
    // STUB: no-op
  }

  onActorDisposeOuter(_actor: IGameActor): void {
    // STUB: no-op
  }
}
