/**
 * Aircraft.ts — 飞行器运动特性（空中单位移动、起降、排斥、导引）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Air/Aircraft.cs (1381 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<AircraftInfo> → TS ConditionalTrait<AircraftInfo>
 * - C# WRot orientation; WAngle Facing → WRot with WithYaw/WithPitch/WithRoll
 * - C# WDist altitude → stored as WDist, CenterPosition.Z = terrain height + altitude
 * - C# Lazy<IEnumerable<int>> speedModifiers → memoized getSpeedModifiers()
 * - C# nested AssociateWithAirfieldActivity → private stub (deferred to Ch14)
 * - C# nested AircraftMoveOrderTargeter → exported class stub (deferred to Ch15)
 * - C# EnterAlliedActorTargeter → inline stub (generic order targeting deferred)
 * - 3D integration: altitude → TransformNode.position.y via map.DistanceAboveTerrain()
 *   inversion; orientation.yaw → TransformNode.rotation.y via radians
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
  type IMove,
  type IMoveInfo,
  type INotifyAddedToWorld,
  type INotifyRemovedFromWorld,
  type INotifyBecomingIdle,
  type IActorPreviewInitModifier,
  type IDeathActorInitModifier,
  type ICreationActivity,
  type ActivityStub,
  type Order,
  type ColorStub,
  type ActorInfoStub,
  type TargetStub,
  type OccupiedCell,
  type ITraitInfoInterface,
  type VariableObserver,
  type IObservesVariables,
  type IObservesVariablesInfo,
  PlayerRelationship,
  PlayerRelationshipExts,
  TargetModifiers,
  TargetModifiersExts,
  type BitSetStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import type { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { Activity } from '../../../OpenRA.Game/Activities/Activity.js'

import { applyPercentageModifiers, clamp } from '../../Projectiles/MissileMath.js'

import { SubCell as SubCellEnum } from '../../../OpenRA.Game/Traits/SubCell.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// IdleBehaviorType enum
// OpenRA 对照: IdleBehaviorType { None, Land, ReturnToBase, LeaveMap, LeaveMapAtClosestEdge }
// ---------------------------------------------------------------------------

/** Behavior when aircraft becomes idle.
 *
 * OpenRA 对照: IdleBehaviorType enum
 */
export const IdleBehaviorType = {
  None: 0,
  Land: 1,
  ReturnToBase: 2,
  LeaveMap: 3,
  LeaveMapAtClosestEdge: 4,
} as const

export type IdleBehaviorType =
  (typeof IdleBehaviorType)[keyof typeof IdleBehaviorType]

// ---------------------------------------------------------------------------
// MovementType (local — same as Locomotor.MovementType)
// OpenRA 对照: MovementType enum
// ---------------------------------------------------------------------------

export const MovementType = {
  None: 0,
  Horizontal: 1,
  Vertical: 2,
  Turn: 4,
} as const

export type MovementType =
  (typeof MovementType)[keyof typeof MovementType]

/** Check if a MovementType value has a specific movement flag.
 *
 * OpenRA 对照: MovementType.HasMovementType (extension)
 */
export function hasMovementType(
  value: MovementType,
  type: MovementType,
): boolean {
  return (value & type) !== 0
}

// ---------------------------------------------------------------------------
// IIssueDeployOrder — deploy order interface (local, not yet in TraitsInterfaces)
// OpenRA 对照: OpenRA.Mods.Common.Orders.IIssueDeployOrder
// ---------------------------------------------------------------------------

/**
 * Deploy order interface — allows traits to issue "ReturnToBase" via deploy hotkey.
 *
 * OpenRA 对照: IIssueDeployOrder
 */
export interface IIssueDeployOrder {
  readonly canIssueDeployOrder: boolean
  issueDeployOrder(actor: IGameActor, queued: boolean): Order | null
}

// ---------------------------------------------------------------------------
// IAircraftCenterPositionOffset — local interface for position offset traits
// OpenRA 对照: IAircraftCenterPositionOffset
// ---------------------------------------------------------------------------

/**
 * Offset applied to the aircraft's visual center position.
 *
 * OpenRA 对照: IAircraftCenterPositionOffset
 */
export interface IAircraftCenterPositionOffset {
  readonly positionOffset: WVec
}

// ---------------------------------------------------------------------------
// IOverrideAircraftLanding — local interface for landing override traits
// OpenRA 对照: IOverrideAircraftLanding
// ---------------------------------------------------------------------------

/**
 * Override the terrain types an aircraft can land on.
 *
 * OpenRA 对照: IOverrideAircraftLanding
 */
export interface IOverrideAircraftLanding {
  readonly landableTerrainTypes: Set<string>
}

// ---------------------------------------------------------------------------
// ISpeedModifier — local interface for speed modifier traits
// OpenRA 对照: ISpeedModifier
// ---------------------------------------------------------------------------

/**
 * Speed modifier trait — modifies movement speed.
 *
 * OpenRA 对照: ISpeedModifier
 */
export interface ISpeedModifier {
  getSpeedModifier(): number
}

// ---------------------------------------------------------------------------
// Reservable / IReservable — local stubs for reservation system
// OpenRA 对照: Reservable trait
// ---------------------------------------------------------------------------

/**
 * Stub for the Reservable trait on buildings (airfields, repair pads).
 *
 * OpenRA 对照: Reservable
 *
 * TODO-9.B.1-RESERVABLE: Replace with real Reservable when migrated.
 */
export interface IReservable {
  reserve(
    target: IGameActor,
    reserver: IGameActor,
    aircraft: unknown,
  ): { dispose(): void }
}

// ---------------------------------------------------------------------------
// Repairable / Rearmable — local stubs
// OpenRA 对照: Repairable, Rearmable
// ---------------------------------------------------------------------------

/**
 * Stub config for Repairable trait.
 *
 * OpenRA 对照: RepairableInfo
 */
export interface RepairableInfoStub {
  readonly repairActors: Set<string>
}

/**
 * Stub for Repairable trait.
 *
 * OpenRA 对照: Repairable
 */
export interface RepairableStub {
  readonly info: RepairableInfoStub
}

/**
 * Stub config for Rearmable trait.
 *
 * OpenRA 对照: RearmableInfo
 */
export interface RearmableInfoStub {
  readonly rearmActors: Set<string>
}

/**
 * Stub for Rearmable trait.
 *
 * OpenRA 对照: Rearmable
 */
export interface RearmableStub {
  readonly info: RearmableInfoStub
  readonly rearmableAmmoPools: readonly AmmoPoolStub[]
}

/** Ammo pool stub. */
export interface AmmoPoolStub {
  readonly hasFullAmmo: boolean
}

// ---------------------------------------------------------------------------
// BuildingInfo stub
// OpenRA 对照: BuildingInfo
// ---------------------------------------------------------------------------

/**
 * Stub for BuildingInfo — used by EnterAlliedActorTargeter type parameter.
 *
 * OpenRA 对照: BuildingInfo
 */
export interface BuildingInfoStub extends ITraitInfoInterface {
  // marker stub
}

// ---------------------------------------------------------------------------
// Duck-typed world/map/actorMap accessors — narrowed types for methods we use
// ---------------------------------------------------------------------------

/** Narrowed map interface with the methods Aircraft uses. */
interface IAircraftMap {
  contains(cell: CPos): boolean
  cellContaining(pos: WPos): CPos
  centerOfCell(cell: CPos): WPos
  clamp(cell: CPos): CPos
  distanceAboveTerrain(pos: WPos): WDist
  getTerrainInfo(cell: CPos): { type: string }
  findTilesInCircle(center: CPos, radius: number): CPos[]
  chooseClosestEdgeCell(cell: CPos): CPos
  projectedTopLeft?: WPos
  projectedBottomRight?: WPos
}

/** Narrowed actor map interface. */
interface IAircraftActorMap {
  getActorsAt(cell: CPos): IGameActor[]
  addInfluence(actor: IGameActor, ios: unknown): void
  removeInfluence(actor: IGameActor, ios: unknown): void
}

/** Narrowed world interface. */
interface IAircraftWorld {
  map: IAircraftMap
  actorMap: IAircraftActorMap
  sharedRandom: number
  rulesContainTemporaryBlocker: boolean
  addToMaps(actor: IGameActor, ios: unknown): void
  removeFromMaps(actor: IGameActor, ios: unknown): void
  updateMaps(actor: IGameActor, ios: unknown): void
  findActorsInCircle(pos: WPos, dist: WDist): IGameActor[]
}

// ---------------------------------------------------------------------------
// Activity stubs — minimal Activity implementations deployed when full
// Activity class is not yet available. These implement ActivityStub.
// OpenRA 对照: OpenRA.Mods.Common.Activities.*
// ---------------------------------------------------------------------------

let _activityIdCounter = 0

/**
 * Minimal Activity stub base class.
 *
 * OpenRA 对照: Activity (OpenRA.Game/Activities/Activity.cs)
 *
 * TODO-14: Replace with real Activity when Chapter 14 is implemented.
 */
abstract class ActivityStubBase implements ActivityStub {
  readonly activityId = ++_activityIdCounter
  activityLabel = 'Activity'

  queue(_activity: ActivityStub): void {
    // NO-OP stub — real Activity chains activities
  }

  cancel(_actor: IGameActor): void {
    // NO-OP stub
  }

  onActorDisposeOuter(_actor: IGameActor): void {
    // NO-OP stub
  }
}

/** Fly activity stub.
 *
 * OpenRA 对照: Fly (OpenRA.Mods.Common.Activities/Fly.cs)
 *
 * TODO-14.A.1: Full Fly activity implementation.
 */
class FlyActivity extends ActivityStubBase {
  activityLabel = 'Fly'
}

/** FlyFollow activity stub.
 *
 * OpenRA 对照: FlyFollow (OpenRA.Mods.Common.Activities/FlyFollow.cs)
 *
 * TODO-14.A.2: Full FlyFollow activity implementation.
 */
class FlyFollowActivity extends ActivityStubBase {
  activityLabel = 'FlyFollow'
}

/** Land activity stub.
 *
 * OpenRA 对照: Land (OpenRA.Mods.Common.Activities/Land.cs)
 *
 * TODO-14.A.3: Full Land activity implementation.
 */
class LandActivity extends ActivityStubBase {
  activityLabel = 'Land'
}

/** TakeOff activity stub.
 *
 * OpenRA 对照: TakeOff (OpenRA.Mods.Common.Activities/TakeOff.cs)
 *
 * TODO-14.A.4: Full TakeOff activity implementation.
 */
class TakeOffActivity extends ActivityStubBase {
  activityLabel = 'TakeOff'
}

/** FlyIdle activity stub.
 *
 * OpenRA 对照: FlyIdle (OpenRA.Mods.Common.Activities/FlyIdle.cs)
 *
 * TODO-14.A.5: Full FlyIdle activity implementation.
 */
class FlyIdleActivity extends ActivityStubBase {
  activityLabel = 'FlyIdle'
}

/** FlyOffMap activity stub.
 *
 * OpenRA 对照: FlyOffMap (OpenRA.Mods.Common.Activities/FlyOffMap.cs)
 *
 * TODO-14.A.6: Full FlyOffMap activity implementation.
 */
class FlyOffMapActivity extends ActivityStubBase {
  activityLabel = 'FlyOffMap'
}

/** ReturnToBase activity stub.
 *
 * OpenRA 对照: ReturnToBase (OpenRA.Mods.Common.Activities/ReturnToBase.cs)
 *
 * TODO-14.A.7: Full ReturnToBase activity implementation.
 */
class ReturnToBaseActivity extends ActivityStubBase {
  activityLabel = 'ReturnToBase'
}

/** Nudge activity stub.
 *
 * OpenRA 对照: Nudge (OpenRA.Mods.Common.Activities/Nudge.cs)
 *
 * TODO-14.A.9: Full Nudge activity implementation.
 */
class NudgeActivity extends ActivityStubBase {
  activityLabel = 'Nudge'
}

/** RemoveSelf activity stub.
 *
 * OpenRA 对照: RemoveSelf (OpenRA.Mods.Common.Activities/RemoveSelf.cs)
 *
 * TODO-14.A.10: Full RemoveSelf activity implementation.
 */
class RemoveSelfActivity extends ActivityStubBase {
  activityLabel = 'RemoveSelf'
}

// ---------------------------------------------------------------------------
// AircraftInfo (config class)
// OpenRA 对照: AircraftInfo : PausableConditionalTraitInfo, IPositionableInfo,
//   IFacingInfo, IMoveInfo, ICruiseAltitudeInfo, IActorPreviewInitInfo,
//   IEditorActorOptions
// ---------------------------------------------------------------------------

/**
 * Configuration for the Aircraft trait.
 *
 * OpenRA 对照: AircraftInfo
 */
export class AircraftInfo implements
  ConditionalTraitInfo,
  IMoveInfo,
  IOccupySpaceInfo,
  IFacingInfo,
  IObservesVariablesInfo
{
  readonly instanceName?: string
  readonly requiresCondition?: string

  // -----------------------------------------------------------------------
  // Core behavior
  // -----------------------------------------------------------------------

  /** Behavior when aircraft becomes idle.
   *
   * OpenRA 对照: AircraftInfo.IdleBehavior (default IdleBehaviorType.None)
   */
  readonly idleBehavior: IdleBehaviorType

  /** Cruise altitude for this aircraft.
   *
   * OpenRA 对照: AircraftInfo.CruiseAltitude (default new WDist(1280))
   */
  readonly cruiseAltitude: WDist

  /** Whether the aircraft can be repulsed from other aircraft.
   *
   * OpenRA 对照: AircraftInfo.Repulsable (default true)
   */
  readonly repulsable: boolean

  /** The distance it tries to maintain from other aircraft if repulsable.
   *
   * OpenRA 对照: AircraftInfo.IdealSeparation (default new WDist(1706))
   */
  readonly idealSeparation: WDist

  /** The speed at which the aircraft is repulsed from other aircraft.
   * Specify -1 for normal movement speed.
   *
   * OpenRA 对照: AircraftInfo.RepulsionSpeed (default -1)
   */
  readonly repulsionSpeed: number

  // -----------------------------------------------------------------------
  // Facing / turning
  // -----------------------------------------------------------------------

  /** Initial facing angle.
   *
   * OpenRA 对照: AircraftInfo.InitialFacing (default WAngle.Zero)
   */
  readonly initialFacing: WAngle

  /** Speed at which the actor turns.
   *
   * OpenRA 对照: AircraftInfo.TurnSpeed (default new WAngle(512))
   */
  readonly turnSpeed: WAngle

  /** Turn speed when aircraft flies in circles while idle.
   * Defaults to TurnSpeed if undefined.
   *
   * OpenRA 对照: AircraftInfo.IdleTurnSpeed (default null)
   */
  readonly idleTurnSpeed: WAngle | null

  /** When flying, if the difference between current facing and desired facing
   * is less than this value, don't turn. Prevents visual jitter.
   *
   * OpenRA 对照: AircraftInfo.TurnDeadzone (default new WAngle(2))
   */
  readonly turnDeadzone: WAngle

  // -----------------------------------------------------------------------
  // Speed
  // -----------------------------------------------------------------------

  /** Maximum flight speed when cruising.
   *
   * OpenRA 对照: AircraftInfo.Speed (default 1)
   */
  readonly speed: number

  /** If non-negative, force the aircraft to move in circles at this speed
   * when idle (a speed of 0 means don't move), ignoring CanHover.
   *
   * OpenRA 对照: AircraftInfo.IdleSpeed (default -1)
   */
  readonly idleSpeed: number

  // -----------------------------------------------------------------------
  // Pitch / Roll (voxel aircraft only, preserved for determinism)
  // -----------------------------------------------------------------------

  /** Body pitch when flying forwards. Only relevant for voxel aircraft.
   *
   * OpenRA 对照: AircraftInfo.Pitch (default WAngle.Zero)
   */
  readonly pitch: WAngle

  /** Pitch steps to apply each tick when starting/stopping.
   *
   * OpenRA 对照: AircraftInfo.PitchSpeed (default WAngle.Zero)
   */
  readonly pitchSpeed: WAngle

  /** Body roll when turning. Only relevant for voxel aircraft.
   *
   * OpenRA 对照: AircraftInfo.Roll (default WAngle.Zero)
   */
  readonly roll: WAngle

  /** Body roll to apply when aircraft flies in circles while idle.
   * Defaults to Roll if undefined.
   *
   * OpenRA 对照: AircraftInfo.IdleRoll (default null)
   */
  readonly idleRoll: WAngle | null

  /** Roll steps to apply each tick when turning.
   *
   * OpenRA 对照: AircraftInfo.RollSpeed (default WAngle.Zero)
   */
  readonly rollSpeed: WAngle

  // -----------------------------------------------------------------------
  // Altitude
  // -----------------------------------------------------------------------

  /** Minimum altitude where this aircraft is considered airborne.
   *
   * OpenRA 对照: AircraftInfo.MinAirborneAltitude (default 1)
   */
  readonly minAirborneAltitude: number

  // -----------------------------------------------------------------------
  // Landing
  // -----------------------------------------------------------------------

  /** Terrain types the aircraft can land on.
   *
   * OpenRA 对照: AircraftInfo.LandableTerrainTypes (default FrozenSet.Empty)
   */
  readonly landableTerrainTypes: Set<string>

  /** Can the actor be ordered to move into shroud?
   *
   * OpenRA 对照: AircraftInfo.MoveIntoShroud (default true)
   */
  readonly moveIntoShroud: boolean

  /** e.g. crate, wall, infantry.
   *
   * OpenRA 对照: AircraftInfo.Crushes (default default(BitSet<CrushClass>))
   */
  readonly crushes: BitSetStub<unknown>

  /** Types of damage that are caused while crushing.
   *
   * OpenRA 对照: AircraftInfo.CrushDamageTypes (default default(BitSet<DamageType>))
   */
  readonly crushDamageTypes: BitSetStub<unknown>

  // -----------------------------------------------------------------------
  // Voice / Visual
  // -----------------------------------------------------------------------

  /** Voice to use for move orders.
   *
   * OpenRA 对照: AircraftInfo.Voice (default "Action")
   */
  readonly voice: string

  /** Color for the target line for regular move orders.
   *
   * OpenRA 对照: AircraftInfo.TargetLineColor (default Color.Green)
   */
  readonly targetLineColor: ColorStub

  // -----------------------------------------------------------------------
  // Conditions
  // -----------------------------------------------------------------------

  /** The condition to grant to self while airborne.
   *
   * OpenRA 对照: AircraftInfo.AirborneCondition (default null)
   */
  readonly airborneCondition: string | null

  /** The condition to grant to self while at cruise altitude.
   *
   * OpenRA 对照: AircraftInfo.CruisingCondition (default null)
   */
  readonly cruisingCondition: string | null

  // -----------------------------------------------------------------------
  // Behavior flags
  // -----------------------------------------------------------------------

  /** Can the actor hover in place mid-air?
   *
   * OpenRA 对照: AircraftInfo.CanHover (default false)
   */
  readonly canHover: boolean

  /** Can the actor immediately change direction without turning first?
   *
   * OpenRA 对照: AircraftInfo.CanSlide (default false)
   */
  readonly canSlide: boolean

  /** Does the actor land and take off vertically?
   *
   * OpenRA 对照: AircraftInfo.VTOL (default false)
   */
  readonly vTOL: boolean

  /** Does this VTOL actor need to turn before landing (on terrain)?
   *
   * OpenRA 对照: AircraftInfo.TurnToLand (default false)
   */
  readonly turnToLand: boolean

  /** Does this actor automatically take off after resupplying?
   *
   * OpenRA 对照: AircraftInfo.TakeOffOnResupply (default false)
   */
  readonly takeOffOnResupply: boolean

  /** Does this actor automatically take off after creation?
   *
   * OpenRA 对照: AircraftInfo.TakeOffOnCreation (default true)
   */
  readonly takeOffOnCreation: boolean

  /** Can this actor be given an explicit land order using force-move?
   *
   * OpenRA 对照: AircraftInfo.CanForceLand (default true)
   */
  readonly canForceLand: boolean

  // -----------------------------------------------------------------------
  // Landing mechanics
  // -----------------------------------------------------------------------

  /** Altitude at which the aircraft considers itself landed.
   *
   * OpenRA 对照: AircraftInfo.LandAltitude (default WDist.Zero)
   */
  readonly landAltitude: WDist

  /** Range to search for an alternative landing location if the ordered
   * cell is blocked.
   *
   * OpenRA 对照: AircraftInfo.LandRange (default WDist.FromCells(5))
   */
  readonly landRange: WDist

  /** How fast this actor ascends or descends during horizontal movement.
   *
   * OpenRA 对照: AircraftInfo.MaximumPitch (default WAngle.FromDegrees(10))
   */
  readonly maximumPitch: WAngle

  /** How fast this actor ascends or descends when moving vertically only.
   *
   * OpenRA 对照: AircraftInfo.AltitudeVelocity (default new WDist(43))
   */
  readonly altitudeVelocity: WDist

  // -----------------------------------------------------------------------
  // Sound
  // -----------------------------------------------------------------------

  /** Sounds to play when the actor is taking off.
   *
   * OpenRA 对照: AircraftInfo.TakeoffSounds (default [])
   */
  readonly takeoffSounds: readonly string[]

  /** Sounds to play when the actor is landing.
   *
   * OpenRA 对照: AircraftInfo.LandingSounds (default [])
   */
  readonly landingSounds: readonly string[]

  // -----------------------------------------------------------------------
  // Resupply
  // -----------------------------------------------------------------------

  /** The distance of the resupply base that the aircraft will wait for its turn.
   *
   * OpenRA 对照: AircraftInfo.WaitDistanceFromResupplyBase (default new WDist(3072))
   */
  readonly waitDistanceFromResupplyBase: WDist

  /** The number of ticks that an airplane will wait to make a new search
   * for an available airport.
   *
   * OpenRA 对照: AircraftInfo.NumberOfTicksToVerifyAvailableAirport (default 150)
   */
  readonly numberOfTicksToVerifyAvailableAirport: number

  // -----------------------------------------------------------------------
  // Preview
  // -----------------------------------------------------------------------

  /** Facing to use for actor previews (map editor, color picker, etc).
   *
   * OpenRA 对照: AircraftInfo.PreviewFacing (default new WAngle(384))
   */
  readonly previewFacing: WAngle

  // -----------------------------------------------------------------------
  // Cursors
  // -----------------------------------------------------------------------

  /** Cursor to display when a move order can be issued at target location.
   *
   * OpenRA 对照: AircraftInfo.Cursor (default "move")
   */
  readonly cursor: string

  /** Cursor to display when a move order cannot be issued at target location.
   *
   * OpenRA 对照: AircraftInfo.BlockedCursor (default "move-blocked")
   */
  readonly blockedCursor: string

  /** Cursor to display when able to land at target building.
   *
   * OpenRA 对照: AircraftInfo.EnterCursor (default "enter")
   */
  readonly enterCursor: string

  /** Cursor to display when unable to land at target building.
   *
   * OpenRA 对照: AircraftInfo.EnterBlockedCursor (default "enter-blocked")
   */
  readonly enterBlockedCursor: string

  // -----------------------------------------------------------------------
  // Force move condition
  // -----------------------------------------------------------------------

  /** Boolean expression defining the condition under which the regular
   * (non-force) move cursor is disabled.
   *
   * OpenRA 对照: AircraftInfo.RequireForceMoveCondition (default null)
   */
  readonly requireForceMoveCondition: string | null

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    idleBehavior?: IdleBehaviorType
    cruiseAltitude?: WDist
    repulsable?: boolean
    idealSeparation?: WDist
    repulsionSpeed?: number
    initialFacing?: WAngle
    turnSpeed?: WAngle
    idleTurnSpeed?: WAngle | null
    turnDeadzone?: WAngle
    speed?: number
    idleSpeed?: number
    pitch?: WAngle
    pitchSpeed?: WAngle
    roll?: WAngle
    idleRoll?: WAngle | null
    rollSpeed?: WAngle
    minAirborneAltitude?: number
    landableTerrainTypes?: Set<string>
    moveIntoShroud?: boolean
    crushes?: BitSetStub<unknown>
    crushDamageTypes?: BitSetStub<unknown>
    voice?: string
    targetLineColor?: ColorStub
    airborneCondition?: string | null
    cruisingCondition?: string | null
    canHover?: boolean
    canSlide?: boolean
    vTOL?: boolean
    turnToLand?: boolean
    takeOffOnResupply?: boolean
    takeOffOnCreation?: boolean
    canForceLand?: boolean
    landAltitude?: WDist
    landRange?: WDist
    maximumPitch?: WAngle
    altitudeVelocity?: WDist
    takeoffSounds?: readonly string[]
    landingSounds?: readonly string[]
    waitDistanceFromResupplyBase?: WDist
    numberOfTicksToVerifyAvailableAirport?: number
    previewFacing?: WAngle
    cursor?: string
    blockedCursor?: string
    enterCursor?: string
    enterBlockedCursor?: string
    requireForceMoveCondition?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.idleBehavior = params.idleBehavior ?? IdleBehaviorType.None
    this.cruiseAltitude = params.cruiseAltitude ?? new WDist(1280)
    this.repulsable = params.repulsable ?? true
    this.idealSeparation = params.idealSeparation ?? new WDist(1706)
    this.repulsionSpeed = params.repulsionSpeed ?? -1
    this.initialFacing = params.initialFacing ?? WAngle.Zero
    this.turnSpeed = params.turnSpeed ?? new WAngle(512)
    this.idleTurnSpeed = params.idleTurnSpeed ?? null
    this.turnDeadzone = params.turnDeadzone ?? new WAngle(2)
    this.speed = params.speed ?? 1
    this.idleSpeed = params.idleSpeed ?? -1
    this.pitch = params.pitch ?? WAngle.Zero
    this.pitchSpeed = params.pitchSpeed ?? WAngle.Zero
    this.roll = params.roll ?? WAngle.Zero
    this.idleRoll = params.idleRoll ?? null
    this.rollSpeed = params.rollSpeed ?? WAngle.Zero
    this.minAirborneAltitude = params.minAirborneAltitude ?? 1
    this.landableTerrainTypes = params.landableTerrainTypes ?? new Set()
    this.moveIntoShroud = params.moveIntoShroud ?? true
    this.crushes = params.crushes ?? { contains: () => false, isEmpty: () => true }
    this.crushDamageTypes = params.crushDamageTypes ?? { contains: () => false, isEmpty: () => true }
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? { r: 0, g: 1, b: 0, a: 1 }
    this.airborneCondition = params.airborneCondition ?? null
    this.cruisingCondition = params.cruisingCondition ?? null
    this.canHover = params.canHover ?? false
    this.canSlide = params.canSlide ?? false
    this.vTOL = params.vTOL ?? false
    this.turnToLand = params.turnToLand ?? false
    this.takeOffOnResupply = params.takeOffOnResupply ?? false
    this.takeOffOnCreation = params.takeOffOnCreation ?? true
    this.canForceLand = params.canForceLand ?? true
    this.landAltitude = params.landAltitude ?? WDist.Zero
    this.landRange = params.landRange ?? WDist.fromCells(5)
    this.maximumPitch = params.maximumPitch ?? WAngle.fromDegrees(10)
    this.altitudeVelocity = params.altitudeVelocity ?? new WDist(43)
    this.takeoffSounds = params.takeoffSounds ?? []
    this.landingSounds = params.landingSounds ?? []
    this.waitDistanceFromResupplyBase = params.waitDistanceFromResupplyBase ?? new WDist(3072)
    this.numberOfTicksToVerifyAvailableAirport =
      params.numberOfTicksToVerifyAvailableAirport ?? 150
    this.previewFacing = params.previewFacing ?? new WAngle(384)
    this.cursor = params.cursor ?? 'move'
    this.blockedCursor = params.blockedCursor ?? 'move-blocked'
    this.enterCursor = params.enterCursor ?? 'enter'
    this.enterBlockedCursor = params.enterBlockedCursor ?? 'enter-blocked'
    this.requireForceMoveCondition = params.requireForceMoveCondition ?? null
  }

  // -----------------------------------------------------------------------
  // IFacingInfo
  // -----------------------------------------------------------------------

  /** Get the initial facing angle.
   *
   * OpenRA 对照: AircraftInfo.GetInitialFacing()
   */
  getInitialFacing(): WAngle {
    return this.initialFacing
  }

  // -----------------------------------------------------------------------
  // IMoveInfo
  // -----------------------------------------------------------------------

  /** Get the target line color for move orders.
   *
   * OpenRA 对照: AircraftInfo.GetTargetLineColor()
   */
  getTargetLineColor(): ColorStub {
    return this.targetLineColor
  }

  // -----------------------------------------------------------------------
  // IOccupySpaceInfo
  // -----------------------------------------------------------------------

  /** Aircraft don't occupy any cells (in the air).
   *
   * OpenRA 对照: AircraftInfo.OccupiedCells() → empty dictionary
   */
  occupiedCells(
    _info: ActorInfoStub,
    _location: CPos,
    _subCell: SubCellEnum = SubCellEnum.Any,
  ): ReadonlyMap<CPos, SubCellEnum> {
    return new Map()
  }

  /** Aircraft don't share cells.
   *
   * OpenRA 对照: IOccupySpaceInfo.SharesCell → false
   */
  get sharesCell(): boolean {
    return false
  }

  /** Check if an aircraft can spawn landed at a cell.
   *
   * OpenRA 对照: AircraftInfo.CanEnterCell()
   */
  canEnterCell(
    world: unknown,
    _self: IGameActor,
    cell: CPos,
    _subCell: SubCellEnum = SubCellEnum.FullCell,
    ignoreActor: IGameActor | null = null,
    checkBlockedByActor: number = 0, // BlockedByActor.All = 0
  ): boolean {
    const worldRecord = world as Record<string, unknown>

    const map = worldRecord.map as Record<string, unknown> | undefined
    if (!map || typeof map.contains !== 'function') return false
    if (!(map.contains as (c: CPos) => boolean)(cell)) return false

    const getTerrainInfo = map.getTerrainInfo as
      ((c: CPos) => { type: string }) | undefined
    if (!getTerrainInfo) return false
    const terrainType = getTerrainInfo(cell).type
    if (!this.landableTerrainTypes.has(terrainType)) return false

    // BlockedByActor.None
    if (checkBlockedByActor === 1) return true // BlockedByActor.None = 1

    const actorMap = worldRecord.actorMap as Record<string, unknown> | undefined
    if (!actorMap || typeof actorMap.getActorsAt !== 'function') return true
    const actorsAt = (actorMap.getActorsAt as (c: CPos) => IGameActor[])(cell)
    return !actorsAt.some((a: IGameActor) => a !== ignoreActor)
  }
}

// ---------------------------------------------------------------------------
// Aircraft (core implementation)
// OpenRA 对照: Aircraft : PausableConditionalTrait<AircraftInfo>, ITick,
//   ISync, IFacing, IPositionable, IMove, INotifyAddedToWorld,
//   INotifyRemovedFromWorld, INotifyActorDisposing, INotifyBecomingIdle,
//   ICreationActivity, IActorPreviewInitModifier, IDeathActorInitModifier,
//   IIssueDeployOrder, IIssueOrder, IResolveOrder, IOrderVoice
// ---------------------------------------------------------------------------

/** Full aircraft movement trait for aerial units.
 *
 * OpenRA 对照: Aircraft class
 */
export class Aircraft
  extends ConditionalTrait<AircraftInfo>
  implements
    ITick,
    ISync,
    IFacing,
    IPositionable,
    IMove,
    INotifyAddedToWorld,
    INotifyRemovedFromWorld,
    INotifyBecomingIdle,
    ICreationActivity,
    IActorPreviewInitModifier,
    IDeathActorInitModifier,
    IIssueDeployOrder,
    IIssueOrder,
    IResolveOrder,
    IOrderVoice,
    IObservesVariables
{
  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  private _self!: IGameActor
  private _orientation: WRot = WRot.None

  // Externally resolved trait references
  private _repairable: RepairableStub | null = null
  private _rearmable: RearmableStub | null = null
  private _speedModifiersMemo: number[] | null = null
  private _positionOffsets: IAircraftCenterPositionOffset[] = []
  private _overrideAircraftLanding: IOverrideAircraftLanding | null = null
  private _notifyMoving: { movementTypeChanged(actor: IGameActor, type: MovementType): void }[] = []
  private _notifyCenterPositionChanged: { centerPositionChanged(actor: IGameActor, x: number, y: number): void }[] = []

  // Reservation
  private _reservation: { dispose(): void } | null = null
  private _reservedActor: IGameActor | null = null
  private _mayYieldReservation: boolean = false

  // Landing cells
  private _landingCells: readonly OccupiedCell[] = []

  // Position & movement state
  private _centerPosition: WPos = WPos.Zero
  private _movementTypes: MovementType = MovementType.None
  private _cachedFacing: WAngle = WAngle.Zero
  private _cachedPosition: WPos = WPos.Zero

  // Airborne / cruising state
  private _airborne: boolean = false
  private _cruising: boolean = false
  private _airborneToken: number = -1 // Actor.InvalidConditionToken
  private _cruisingToken: number = -1

  // Force move
  private _requireForceMove: boolean = false

  // Force landing
  private _forceLanding: boolean = false

  // Creation state
  private _creationActivityDelay: number = 0
  private _creationByMap: boolean = false
  private _creationRallyPoint: CPos[] | null = null

  // Cached movement types set (PERF: avoids per-frame allocation)
  private _cachedMovementTypes: Set<string> | null = null

  // notify flag (HACK: prevents double-notification in Repulse)
  private _notify: boolean = true

  // -----------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: Aircraft(ActorInitializer init, AircraftInfo info)
  // -----------------------------------------------------------------------

  constructor(info: AircraftInfo) {
    super(info)
  }

  /** Initialize the aircraft trait with the owning actor and optional
   * position data (mirrors C# constructor body).
   *
   * OpenRA 对照: Aircraft constructor body
   */
  initialize(
    self: IGameActor,
    location?: CPos,
    centerPosition?: WPos,
    creationByMap?: boolean,
    creationActivityDelay?: number,
    creationRallyPoint?: CPos[],
  ): void {
    this._self = self

    if (location || centerPosition) {
      const pos = centerPosition ?? this._getMapCenterOfCell(location!)
      this._creationByMap = creationByMap ?? false
      this.setPosition(self, pos)
    }

    this.facing = this.info.initialFacing
    this._creationActivityDelay = creationActivityDelay ?? 0
    this._creationRallyPoint = creationRallyPoint ?? null
    this._cachedFacing = this.facing
    this._cachedPosition = this.centerPosition
  }

  /**
   * Resolve required trait references from the actor (mirrors C# Created).
   *
   * OpenRA 对照: Aircraft.Created()
   */
  resolveReferences(): void {
    // Resolve Repairable, Rearmable, speed modifiers,
    // position offsets, override landing, notify arrays
    const traits = this._getActorTraits()
    this._repairable = traits.repairable ?? null
    this._rearmable = traits.rearmable ?? null
    this._speedModifiersMemo = null // invalidate cache
    this._positionOffsets = traits.positionOffsets ?? []
    this._overrideAircraftLanding = traits.overrideAircraftLanding ?? null
    this._notifyMoving = traits.notifyMoving ?? []
    this._notifyCenterPositionChanged = traits.notifyCenterPositionChanged ?? []
  }

  // -----------------------------------------------------------------------
  // Orientation / Facing (IFacing)
  // OpenRA 对照: Aircraft.Facing, Pitch, Roll, Orientation
  // -----------------------------------------------------------------------

  get orientation(): WRot {
    return this._orientation
  }

  set orientation(value: WRot) {
    this._orientation = value
  }

  get facing(): WAngle {
    return this._orientation.yaw
  }

  set facing(value: WAngle) {
    this._orientation = this._orientation.withYaw(value)
  }

  get pitch(): WAngle {
    return this._orientation.pitch
  }

  set pitch(value: WAngle) {
    this._orientation = this._orientation.withPitch(value)
  }

  get roll(): WAngle {
    return this._orientation.roll
  }

  set roll(value: WAngle) {
    this._orientation = this._orientation.withRoll(value)
  }

  /** Turn speed when trait is not paused/disabled.
   *
   * OpenRA 对照: Aircraft.TurnSpeed
   */
  get turnSpeed(): WAngle {
    return this.isTraitDisabled || this.isTraitPaused
      ? WAngle.Zero
      : this.info.turnSpeed
  }

  /** Idle turn speed when trait is not paused/disabled.
   *
   * OpenRA 对照: Aircraft.IdleTurnSpeed
   */
  get idleTurnSpeed(): WAngle | null {
    return this.isTraitDisabled || this.isTraitPaused
      ? null
      : this.info.idleTurnSpeed
  }

  /** Get turn speed considering percentage modifiers.
   *
   * OpenRA 对照: Aircraft.GetTurnSpeed(bool isIdleTurn)
   */
  getTurnSpeed(isIdleTurn: boolean): WAngle {
    const speedModifiers = this._getSpeedModifiers()
    if ((isIdleTurn && this.idleMovementSpeed === 0) || this.movementSpeed === 0) {
      return WAngle.Zero
    }

    const baseTurnSpeed = isIdleTurn
      ? (this.idleTurnSpeed ?? this.turnSpeed)
      : this.turnSpeed

    const clampedAngle = clamp(
      applyPercentageModifiers(baseTurnSpeed.angle, speedModifiers),
      1,
      1024,
    )
    return new WAngle(clampedAngle)
  }

  // -----------------------------------------------------------------------
  // Movement speed
  // OpenRA 对照: Aircraft.MovementSpeed, IdleMovementSpeed
  // -----------------------------------------------------------------------

  /** Current movement speed considering modifiers and trait state.
   *
   * OpenRA 对照: Aircraft.MovementSpeed
   */
  get movementSpeed(): number {
    if (this.isTraitDisabled || this.isTraitPaused) return 0
    return applyPercentageModifiers(this.info.speed, this._getSpeedModifiers())
  }

  /** Current idle movement speed.
   *
   * OpenRA 对照: Aircraft.IdleMovementSpeed
   */
  get idleMovementSpeed(): number {
    if (this.info.idleSpeed < 0) return this.movementSpeed
    if (this.isTraitDisabled || this.isTraitPaused) return 0
    return applyPercentageModifiers(this.info.idleSpeed, this._getSpeedModifiers())
  }

  // -----------------------------------------------------------------------
  // Altitude
  // OpenRA 对照: Aircraft LandAltitude, AtLandAltitude, GroundPosition
  // -----------------------------------------------------------------------

  /** The effective land altitude (accounting for position offsets).
   *
   * OpenRA 对照: Aircraft.LandAltitude (computed property)
   */
  get landAltitude(): WDist {
    let alt = this.info.landAltitude.length
    for (const offset of this._positionOffsets) {
      alt -= offset.positionOffset.Z
    }
    return new WDist(alt)
  }

  /** Whether the aircraft is currently at land altitude.
   *
   * OpenRA 对照: Aircraft.AtLandAltitude
   */
  get atLandAltitude(): boolean {
    return this._getDistanceAboveTerrain(this._centerPosition).length ===
      this.landAltitude.length
  }

  /** Compute the ground position directly below this aircraft.
   *
   * OpenRA 对照: Aircraft.GroundPosition(Actor self)
   */
  groundPosition(): WPos {
    const terrainDist = this._getDistanceAboveTerrain(this._centerPosition)
    return WPos.subtractVec(
      this._centerPosition,
      new WVec(0, 0, terrainDist.length),
    )
  }

  // -----------------------------------------------------------------------
  // FlyStep — compute the movement vector for a given facing and speed
  // OpenRA 对照: Aircraft.FlyStep(WAngle), FlyStep(int, WAngle)
  // -----------------------------------------------------------------------

  /** Compute the fly step vector for the current movement speed.
   *
   * OpenRA 对照: Aircraft.FlyStep(WAngle facing)
   */
  flyStep(facing: WAngle): WVec {
    return this._flyStep(this.movementSpeed, facing)
  }

  /** Compute the fly step vector for a given speed and facing.
   *
   * OpenRA 对照: Aircraft.FlyStep(int speed, WAngle facing)
   */
  private _flyStep(speed: number, facing: WAngle): WVec {
    const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(facing))
    return WVec.divide(WVec.multiply(dir, speed), 1024)
  }

  // -----------------------------------------------------------------------
  // Position (IPositionable)
  // OpenRA 对照: Aircraft TopLeft, CenterPosition, SetPosition, SetCenterPosition
  // -----------------------------------------------------------------------

  get topLeft(): CPos {
    return this._getMapCellContaining(this._centerPosition)
  }

  get centerPosition(): WPos {
    return this._centerPosition
  }

  /** Set the center position (includes altitude).
   *
   * OpenRA 对照: Aircraft.SetPosition(Actor self, WPos pos)
   */
  setPosition(self: IGameActor, pos: WPos): void {
    this._centerPosition = pos

    if (!self.isInWorld) return

    const altitude = this._getDistanceAboveTerrain(pos)

    // Update landing cells if not airborne
    if (this.hasInfluence() && altitude.length <= this.info.minAirborneAltitude) {
      const currentPos: OccupiedCell[] = [
        { cell: this.topLeft, subCell: SubCellEnum.FullCell },
      ]
      if (this._landingCellsEqual(currentPos)) {
        this._removeInfluence(self)
        this._landingCells = currentPos
        this._addInfluence(self)
      }
    }

    this._updateMaps(self)

    // Airborne transition
    const isAirborne = altitude.length >= this.info.minAirborneAltitude
    if (isAirborne && !this._airborne) {
      this._onAirborneAltitudeReached()
    } else if (!isAirborne && this._airborne) {
      this._onAirborneAltitudeLeft()
    }

    // Cruising transition
    const isCruising = altitude.length === this.info.cruiseAltitude.length
    if (isCruising && !this._cruising) {
      this._onCruisingAltitudeReached()
    } else if (!isCruising && this._cruising) {
      this._onCruisingAltitudeLeft()
    }

    // Notify center position changed
    if (this._notify) {
      for (const n of this._notifyCenterPositionChanged) {
        n.centerPositionChanged(self, 0, 0)
      }
    }

    this._finishedMoving(self)
  }

  /** Set center position (IPositionable interface method — delegates to setPosition).
   *
   * OpenRA 对照: Aircraft.SetCenterPosition(Actor self, WPos pos)
   */
  setCenterPosition(self: IGameActor, value: WPos): void {
    this.setPosition(self, value)
  }

  /** Set position via cell (keeps current altitude).
   *
   * OpenRA 对照: Aircraft.SetPosition(Actor self, CPos cell, SubCell subCell)
   */
  setCellPosition(self: IGameActor, cell: CPos): void {
    const cellCenter = this._getMapCenterOfCell(cell)
    this.setPosition(
      self,
      WPos.add(cellCenter, new WVec(0, 0, this._centerPosition.Z)),
    )
  }

  canCenterPositionChange(_self: IGameActor): boolean {
    return !this.isTraitDisabled && !this.isTraitPaused
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

  occupiedCells(): readonly OccupiedCell[] {
    return this._landingCells
  }

  // -----------------------------------------------------------------------
  // Influence / landing cells
  // OpenRA 对照: Aircraft.AddInfluence, RemoveInfluence, HasInfluence
  // -----------------------------------------------------------------------

  /** Whether the aircraft has any landing cell influence.
   *
   * OpenRA 对照: Aircraft.HasInfluence()
   */
  hasInfluence(): boolean {
    return this._landingCells.length > 0
  }

  /** Add landing cell influence.
   *
   * OpenRA 对照: Aircraft.AddInfluence((CPos, SubCell)[])
   */
  addInfluence(landingCells: readonly OccupiedCell[]): void {
    if (this.hasInfluence()) {
      throw new Error(
        'Cannot addInfluence until previous influence is removed with removeInfluence',
      )
    }
    this._landingCells = landingCells
    if (this._self.isInWorld) {
      this._addInfluence(this._self)
    }
  }

  /** Add single landing cell influence.
   *
   * OpenRA 对照: Aircraft.AddInfluence(CPos landingCell)
   */
  addInfluenceCell(landingCell: CPos): void {
    this.addInfluence([{ cell: landingCell, subCell: SubCellEnum.FullCell }])
  }

  /** Remove landing cell influence.
   *
   * OpenRA 对照: Aircraft.RemoveInfluence()
   */
  removeInfluence(): void {
    if (this._self.isInWorld) {
      this._removeInfluence(this._self)
    }
    this._landingCells = []
  }

  // -----------------------------------------------------------------------
  // Reservation
  // OpenRA 对照: Aircraft.MakeReservation, AllowYieldingReservation, UnReserve
  // -----------------------------------------------------------------------

  /** The actor the aircraft has a reservation with.
   *
   * OpenRA 对照: Aircraft.ReservedActor
   */
  get reservedActor(): IGameActor | null {
    return this._reservedActor
  }

  /** Whether the aircraft may yield its reservation.
   *
   * OpenRA 对照: Aircraft.MayYieldReservation
   */
  get mayYieldReservation(): boolean {
    return this._mayYieldReservation
  }

  set mayYieldReservation(value: boolean) {
    this._mayYieldReservation = value
  }

  /** Make a reservation at the target actor.
   *
   * OpenRA 对照: Aircraft.MakeReservation(Actor target)
   */
  makeReservation(target: IGameActor): void {
    this.unReserve()
    const reservable = target as unknown as Record<string, unknown>
    if (typeof reservable.reserve === 'function') {
      this._reservation = (reservable.reserve as (
        target: IGameActor,
        reserver: IGameActor,
        aircraft: unknown,
      ) => { dispose(): void })(target, this._self, this)
      this._reservedActor = target
    }
  }

  /** Allow the reservation to be yielded.
   *
   * OpenRA 对照: Aircraft.AllowYieldingReservation()
   */
  allowYieldingReservation(): void {
    if (!this._reservation) return
    this._mayYieldReservation = true
  }

  /** Unreserve the current landing reservation.
   *
   * OpenRA 对照: Aircraft.UnReserve()
   */
  unReserve(): void {
    if (!this._reservation) return
    this._reservation.dispose()
    this._reservation = null
    this._reservedActor = null
    this._mayYieldReservation = false
  }

  // -----------------------------------------------------------------------
  // GetActorBelow
  // OpenRA 对照: Aircraft.GetActorBelow()
  // -----------------------------------------------------------------------

  /** Get the actor directly below this aircraft (at land altitude).
   *
   * OpenRA 对照: Aircraft.GetActorBelow()
   */
  getActorBelow(): IGameActor | null {
    if (this._getDistanceAboveTerrain(this._centerPosition).length !==
        this.landAltitude.length) {
      return null
    }

    const actorMap = this._getActorMap()
    if (!actorMap) return null
    const actorsAt = actorMap.getActorsAt(this.topLeft)
    return actorsAt.find((a: IGameActor) =>
      this._hasReservableInfo(a),
    ) ?? null
  }

  // -----------------------------------------------------------------------
  // CanLand / FindLandingLocation
  // OpenRA 对照: Aircraft.CanLand, FindLandingLocation, IsBlockedBy
  // -----------------------------------------------------------------------

  /** Find the nearest landable cell to the target.
   *
   * OpenRA 对照: Aircraft.FindLandingLocation(CPos targetCell, WDist maxSearchDistance)
   */
  findLandingLocation(
    targetCell: CPos,
    maxSearchDistance: WDist,
  ): CPos | null {
    // The easy case
    if (this.canLand(targetCell, null, false)) {
      return targetCell
    }

    const cellRange = Math.trunc((maxSearchDistance.length + 1023) / 1024)
    const map = this._getMap()
    if (!map) return null
    const centerPosition = map.centerOfCell(targetCell)
    const tilesInCircle = map.findTilesInCircle(targetCell, cellRange) as CPos[]
    for (const c of tilesInCircle) {
      if (!this.canLand(c, null, false)) continue
      const delta = WPos.subtract(map.centerOfCell(c), centerPosition)
      if (delta.lengthSquared < maxSearchDistance.length * maxSearchDistance.length) {
        return c
      }
    }

    return null
  }

  /** Check if the aircraft can land at all of the given cells.
   *
   * OpenRA 对照: Aircraft.CanLand(IEnumerable<CPos>, Actor?, bool)
   */
  canLandMulti(
    cells: readonly CPos[],
    dockingActor: IGameActor | null = null,
    blockedByMobile: boolean = true,
  ): boolean {
    for (const c of cells) {
      if (!this.canLand(c, dockingActor, blockedByMobile)) return false
    }
    return true
  }

  /** Check if the aircraft can land at a specific cell.
   *
   * OpenRA 对照: Aircraft.CanLand(CPos, Actor?, bool)
   */
  canLand(
    cell: CPos,
    dockingActor: IGameActor | null = null,
    blockedByMobile: boolean = true,
  ): boolean {
    const map = this._getMap()
    if (!map || !map.contains(cell)) return false

    const actorMap = this._getActorMap()
    if (actorMap) {
      const actorsAt = actorMap.getActorsAt(cell) as IGameActor[]
      for (const otherActor of actorsAt) {
        if (this._isBlockedBy(
          this._self,
          otherActor,
          dockingActor,
          blockedByMobile,
        )) {
          return false
        }
      }
    }

    // Terrain type is ignored when docking with an actor
    if (dockingActor !== null) return true

    const landableTerrain = this._overrideAircraftLanding !== null
      ? this._overrideAircraftLanding.landableTerrainTypes
      : this.info.landableTerrainTypes

    const terrainInfo = map.getTerrainInfo(cell) as { type: string } | undefined
    if (!terrainInfo) return false
    return landableTerrain.has(terrainInfo.type)
  }

  /** Check if this aircraft is blocked by another actor at a cell.
   *
   * OpenRA 对照: Aircraft.IsBlockedBy(Actor self, Actor otherActor, Actor ignoreActor, bool blockedByMobile)
   */
  private _isBlockedBy(
    self: IGameActor,
    otherActor: IGameActor,
    ignoreActor: IGameActor | null,
    blockedByMobile: boolean,
  ): boolean {
    if (otherActor === self || otherActor === ignoreActor) return false

    // Not blocked by actors we can nudge out of the way
    if (
      !blockedByMobile &&
      self.owner &&
      otherActor.owner
    ) {
      const selfOwnerRel = self.owner as unknown as {
        relationshipWith?: (other: unknown) => PlayerRelationship
      }
      const rel = selfOwnerRel.relationshipWith?.(otherActor.owner) ??
        PlayerRelationship.Enemy
      if (
        PlayerRelationshipExts.hasRelationship(rel, PlayerRelationship.Ally) &&
        this._hasMobile(otherActor) &&
        !otherActor.isIdle
      ) {
        return false
      }
    }

    // Check temporary blockers
    if (this._worldHasTemporaryBlockers()) {
      const tempBlocker = otherActor as unknown as
        { canRemoveBlockage?: (a: IGameActor, b: IGameActor) => boolean }
      if (
        tempBlocker.canRemoveBlockage &&
        tempBlocker.canRemoveBlockage(otherActor, self)
      ) {
        return false
      }
    }

    // If we cannot crush, we are blocked
    if (this.info.crushes.isEmpty()) return true

    // Check if the other actor can be crushed
    const crushable =
      otherActor as unknown as { crushables?: readonly { crushableBy: (a: IGameActor, b: IGameActor, c: BitSetStub<unknown>) => boolean }[] }
    if (crushable.crushables) {
      for (const c of crushable.crushables) {
        if (c.crushableBy(otherActor, self, this.info.crushes)) return false
      }
    }

    return true
  }

  // -----------------------------------------------------------------------
  // Resupply checks
  // OpenRA 对照: Aircraft.AircraftCanEnter, AircraftCanResupplyAt,
  //   CanRearmAt, CanRepairAt
  // -----------------------------------------------------------------------

  /** Check if aircraft can enter this actor (for resupply).
   *
   * OpenRA 对照: Aircraft.AircraftCanEnter(Actor a)
   */
  aircraftCanEnter(a: IGameActor): boolean {
    if (this._appearsHostileTo(a)) return false

    const canRearmAtActor =
      this._rearmable !== null &&
      this._rearmable.info.rearmActors.has(
        (a.info as ActorInfoStub).name,
      )
    const canRepairAtActor =
      this._repairable !== null &&
      this._repairable.info.repairActors.has(
        (a.info as ActorInfoStub).name,
      )

    return canRearmAtActor || canRepairAtActor
  }

  /** Check if aircraft can resupply at this actor.
   *
   * OpenRA 对照: Aircraft.AircraftCanResupplyAt(Actor a, bool allowedToForceEnter)
   */
  aircraftCanResupplyAt(
    a: IGameActor,
    allowedToForceEnter: boolean = false,
  ): boolean {
    if (this._appearsHostileTo(a)) return false

    const canRearmAtActor =
      this._rearmable !== null &&
      this._rearmable.info.rearmActors.has(
        (a.info as ActorInfoStub).name,
      )
    const canRepairAtActor =
      this._repairable !== null &&
      this._repairable.info.repairActors.has(
        (a.info as ActorInfoStub).name,
      )

    const allowedToEnterRearmer =
      canRearmAtActor &&
      (allowedToForceEnter ||
        this._rearmable!.rearmableAmmoPools.some((p) => !p.hasFullAmmo))
    const allowedToEnterRepairer =
      canRepairAtActor &&
      (allowedToForceEnter ||
        this._getDamageState() !== 1) // DamageState.Undamaged = 1

    return allowedToEnterRearmer || allowedToEnterRepairer
  }

  /** Check if the aircraft can rearm at a host.
   *
   * OpenRA 对照: Aircraft.CanRearmAt(Actor host)
   */
  canRearmAt(host: IGameActor): boolean {
    return (
      this._rearmable !== null &&
      this._rearmable.info.rearmActors.has(
        (host.info as ActorInfoStub).name,
      ) &&
      this._rearmable.rearmableAmmoPools.some((p) => !p.hasFullAmmo)
    )
  }

  /** Check if the aircraft can repair at a host.
   *
   * OpenRA 对照: Aircraft.CanRepairAt(Actor host)
   */
  canRepairAt(host: IGameActor): boolean {
    return (
      this._repairable !== null &&
      this._repairable.info.repairActors.has(
        (host.info as ActorInfoStub).name,
      ) &&
      this._getDamageState() !== 1 // DamageState.Undamaged = 1
    )
  }

  // -----------------------------------------------------------------------
  // IPositionable: CanExistInCell, IsLeavingCell, CanEnterCell, etc.
  // OpenRA 对照: Aircraft #region Implement IPositionable
  // -----------------------------------------------------------------------

  /** Aircraft can always exist in any cell (in the air).
   *
   * OpenRA 对照: Aircraft.CanExistInCell(CPos) → true
   */
  canExistInCell(_cell: CPos): boolean {
    return true
  }

  /** Aircraft are not leaving a cell (landing handled separately).
   *
   * OpenRA 对照: Aircraft.IsLeavingCell(CPos, SubCell) → false
   */
  isLeavingCell(_location: CPos, _subCell: SubCellEnum = SubCellEnum.Any): boolean {
    return false // TODO-9.B.1-LEAVING: Handle landing cell transitions
  }

  /** Aircraft can always enter any cell (fly over).
   *
   * OpenRA 对照: Aircraft.CanEnterCell(CPos, Actor?, BlockedByActor) → true
   */
  canEnterCell(
    _cell: CPos,
    _ignoreActor: IGameActor | null = null,
    _check: number = 0,
  ): boolean {
    return true
  }

  getValidSubCell(_preferred: SubCellEnum): SubCellEnum {
    return SubCellEnum.Invalid
  }

  getAvailableSubCell(
    _a: CPos,
    _preferredSubCell: SubCellEnum = SubCellEnum.Any,
    _ignoreActor: IGameActor | null = null,
    _check: number = 0,
  ): SubCellEnum {
    return SubCellEnum.Invalid
  }

  // -----------------------------------------------------------------------
  // Crush / EnteringCell
  // OpenRA 对照: Aircraft.FinishedMoving, EnteringCell, CrushAction
  // -----------------------------------------------------------------------

  /** Handle crush actions after moving (only on ground).
   *
   * OpenRA 对照: Aircraft.FinishedMoving(Actor self)
   */
  private _finishedMoving(self: IGameActor): void {
    if (!this._isAtGroundLevel()) return
    this._crushAction(self, 'onCrush')
  }

  /** Handle crush warnings when entering a cell.
   *
   * OpenRA 对照: Aircraft.EnteringCell(Actor self)
   */
  enteringCell(self: IGameActor): void {
    this._crushAction(self, 'warnCrush')
  }

  private _crushAction(
    self: IGameActor,
    action: 'onCrush' | 'warnCrush',
  ): void {
    if (this.info.crushes.isEmpty()) return

    const actorMap = this._getActorMap()
    if (!actorMap) return

    const actorsAt = actorMap.getActorsAt(this.topLeft)
    for (const a of actorsAt) {
      if (a === self) continue
      const crushable =
        a as unknown as {
          crushables?: readonly {
            crushableBy: (
              a: IGameActor,
              b: IGameActor,
              c: BitSetStub<unknown>,
            ) => boolean
            [key: string]: unknown
          }[]
        }
      if (!crushable.crushables) continue
      for (const c of crushable.crushables) {
        if (c.crushableBy(a, self, this.info.crushes) && this._isAtGroundLevelA(a)) {
          const notifyCrushed =
            a as unknown as {
              onCrush?: (a: IGameActor, b: IGameActor, c: BitSetStub<unknown>) => void
              warnCrush?: (a: IGameActor, b: IGameActor, c: BitSetStub<unknown>) => void
            }
          const handler = notifyCrushed[action]
          if (handler) {
            handler.bind(notifyCrushed)(a, self, this.info.crushes)
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Repulse
  // OpenRA 对照: Aircraft.Repulse, GetRepulsionForce, GetRepulsionForce(Actor)
  // -----------------------------------------------------------------------

  /** Apply repulsion force to this aircraft.
   *
   * OpenRA 对照: Aircraft.Repulse()
   */
  repulse(): void {
    const repulsionForce = this._getRepulsionForce()
    if (WVec.equals(repulsionForce, WVec.Zero)) return

    const speed = this.info.repulsionSpeed !== -1
      ? this.info.repulsionSpeed
      : this.movementSpeed

    // HACK: Prevent updating visibility twice per tick
    this._notify = false
    this.setPosition(
      this._self,
      WPos.add(this._centerPosition, this._flyStep(speed, repulsionForce.yaw)),
    )
    this._notify = true
  }

  /** Get the total repulsion force on this aircraft.
   *
   * OpenRA 对照: Aircraft.GetRepulsionForce()
   */
  private _getRepulsionForce(): WVec {
    if (!this.info.repulsable) return WVec.Zero

    if (this._reservation !== null) {
      const reserved = this._reservedActor
      if (reserved) {
        const reservedPos = (reserved as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
        const distanceFromReservation =
          WPos.subtract(reservedPos, this._centerPosition)
            .horizontalLength
        if (distanceFromReservation < this.info.waitDistanceFromResupplyBase.length) {
          return WVec.Zero
        }
      }
    }

    // Repulsion only applies when cruising
    if (!this._cruising) return WVec.Zero

    let repulsionForce = WVec.Zero
    const world = this._getWorld()
    if (!world) return WVec.Zero

    const actorsInCircle = world.findActorsInCircle(
      this._centerPosition,
      this.info.idealSeparation,
    ) as IGameActor[]
    for (const other of actorsInCircle) {
      if (other.isDead) continue

      const ai = (other as unknown as Record<string, unknown>)
        .aircraftInfo as AircraftInfo | undefined
      if (!ai || !ai.repulsable || ai.cruiseAltitude.length !== this.info.cruiseAltitude.length) {
        continue
      }

      repulsionForce = WVec.add(
        repulsionForce,
        this._getRepulsionForceFrom(other),
      )
    }

    // Actors outside the map bounds receive an extra nudge towards the center
    const map = this._getMap()
    if (map && !map.contains(this.topLeft)) {
      const projectedTopLeft = map.projectedTopLeft as WPos | undefined
      const projectedBottomRight = map.projectedBottomRight as WPos | undefined
      if (projectedTopLeft && projectedBottomRight) {
        const center = WPos.lerp(projectedTopLeft, projectedBottomRight, 1, 2)
        const nudge = new WVec(0, 1024, 0).rotate(
          WRot.fromYaw(WPos.subtract(this._centerPosition, center).yaw),
        )
        repulsionForce = WVec.add(repulsionForce, nudge)
      }
    }

    if (this.info.canSlide) return repulsionForce

    // Non-hovering actors must always keep moving forward
    const currentDir = this._flyStep(this.movementSpeed, this.facing)
    const length =
      currentDir.horizontalLength * repulsionForce.horizontalLength
    if (length === 0) return WVec.Zero

    const dot = WVec.dot(currentDir, repulsionForce) / length

    // Avoid stalling the plane
    return dot >= 0 ? repulsionForce : WVec.Zero
  }

  /** Get the repulsion force from a specific other actor.
   *
   * OpenRA 对照: Aircraft.GetRepulsionForce(Actor other)
   */
  private _getRepulsionForceFrom(other: IGameActor): WVec {
    const otherPos = (other as unknown as { centerPosition?: WPos }).centerPosition
    if (
      this._self === other ||
      (otherPos !== undefined && otherPos.Z < this._centerPosition.Z)
    ) {
      return WVec.Zero
    }

    if (!otherPos) return WVec.Zero

    const d = WPos.subtract(this._centerPosition, otherPos)
    const distSq = d.horizontalLengthSquared
    if (distSq > this.info.idealSeparation.length * this.info.idealSeparation.length) {
      return WVec.Zero
    }

    if (distSq < 1) {
      const random = this._getSharedRandom() ?? 0
      const yaw = random % 1024
      const rot = new WRot(WAngle.Zero, WAngle.Zero, new WAngle(yaw))
      return new WVec(1024, 0, 0).rotate(rot)
    }

    return WVec.multiply(d, Math.trunc((1024 * 8) / distSq))
  }

  // -----------------------------------------------------------------------
  // IMove implementation
  // OpenRA 对照: Aircraft #region Implement IMove
  // -----------------------------------------------------------------------

  /** Move to a specific cell.
   *
   * OpenRA 对照: Aircraft.MoveTo(CPos, int, Actor?, bool, Color?)
   */
  moveToCell(
    _cell: CPos,
    _nearEnough: number = 0,
    _ignoreActor: IGameActor | null = null,
    _evaluateNearestMovableCell: boolean = false,
    _targetLineColor?: ColorStub,
  ): ActivityStub {
    return new FlyActivity()
    // TODO-14.A.1: Pass target, nearEnough, targetLineColor
  }

  /** Move to a target.
   *
   * OpenRA 对照: IMove.MoveTo(Target)
   */
  moveTo(_source: IGameActor, _target: Target): Activity {
    return new FlyActivity() as unknown as Activity
  }

  /** Move within range of a target.
   *
   * OpenRA 对照: IMove.MoveWithinRange(Target, WDist, WPos?, Target?)
   */
  moveWithinRange(
    _source: IGameActor,
    _target: Target,
    _range: WDist,
    _initialTarget?: Target,
  ): Activity {
    return new FlyActivity() as unknown as Activity
  }

  /** Move within min/max range of a target.
   *
   * OpenRA 对照: Aircraft.MoveWithinRange(Target, WDist, WDist, WPos?, Color?)
   */
  moveWithinRangeMinMax(
    _source: IGameActor,
    _target: Target,
    _minRange: WDist,
    _maxRange: WDist,
    _initialTarget?: Target,
    _targetLineColor?: ColorStub,
  ): Activity {
    return new FlyActivity() as unknown as Activity
  }

  /** Follow a target while staying within range.
   *
   * OpenRA 对照: IMove.MoveFollow(Target, WDist, WDist?, Target?)
   */
  moveFollow(
    _source: IGameActor,
    _target: Target,
    _range: WDist,
    _followTarget: Target,
    _initialTarget?: Target,
  ): Activity {
    return new FlyFollowActivity() as unknown as Activity
  }

  /** Return to the actor's cell.
   *
   * OpenRA 对照: IMove.ReturnToCell() → null
   */
  returnToCell(_source: IGameActor): Activity | null {
    return null
  }

  /** Move to target (for attacks).
   *
   * OpenRA 对照: Aircraft.MoveToTarget(Target, WPos?, Color?)
   */
  moveToTarget(
    _source: IGameActor,
    _target: Target,
    _initialTarget?: Target,
  ): Activity {
    return new FlyActivity() as unknown as Activity
  }

  /** Move into a target (for landing at buildings).
   *
   * OpenRA 对照: Aircraft.MoveIntoTarget(Target)
   */
  moveIntoTarget(_source: IGameActor, _target: Target): Activity {
    return new LandActivity() as unknown as Activity
  }

  /** Move onto a target (for landing with offset/facing).
   *
   * OpenRA 对照: Aircraft.MoveOntoTarget(Target, WVec, WAngle?, Color?)
   */
  moveOntoTarget(
    _source: IGameActor,
    _target: Target,
    _facingTarget: Target,
  ): Activity {
    return new LandActivity() as unknown as Activity
  }

  /** Local move (reposition within screen).
   *
   * OpenRA 对照: Aircraft.LocalMove(WPos, WPos)
   */
  localMove(_source: IGameActor, _destination: WPos): Activity {
    return new FlyActivity() as unknown as Activity
  }

  /** Estimate the duration (in ticks) to move between two positions.
   *
   * OpenRA 对照: Aircraft.EstimatedMoveDuration(WPos, WPos)
   */
  estimatedMoveDuration(
    _source: IGameActor,
    from: WPos,
    to: WPos,
  ): number {
    const speed = this.movementSpeed
    return speed > 0 ? WPos.subtract(to, from).length / speed : 0
  }

  /** Find the nearest moveable cell position from a WPos.
   *
   * OpenRA 对照: IMove.NearestMoveableCell(WPos) → CPos from position
   */
  nearestMoveableCell(_source: IGameActor, _target: WPos): CPos {
    return this._getMapCellContaining(this._centerPosition)
  }

  /** Find the nearest moveable cell from a CPos (landable cell).
   *
   * OpenRA 对照: Aircraft.NearestMoveableCell(CPos) → same cell
   */
  nearestMoveableCellFromCell(cell: CPos): CPos {
    return cell
  }

  /** Check whether this actor can enter the target cell right now.
   *
   * OpenRA 对照: IMove.CanEnterTargetNow(Target)
   *
   * In C#, this extracts the target actor, checks if it is reservable, and
   * returns true if a reservation was successfully made. Currently stubbed
   * with a basic null-check on the reserved actor.
   */
  canEnterTargetNow(_source: IGameActor, _target: Target): boolean {
    // TODO-9.B.1: Full enter target check when Target is fully migrated.
    //   In C#: extract target actor, verify ReservingOffset, call
    //   MakeReservation. Return false if no reservable actor is found.
    const reservedActor = this._reservedActor
    if (!reservedActor) return false

    this.makeReservation(reservedActor)
    return true
  }

  /** Current movement types.
   *
   * OpenRA 对照: Aircraft.CurrentMovementTypes
   */
  get currentMovementTypes(): Set<string> {
    return this._getCachedMovementTypes()
  }

  private _getCachedMovementTypes(): Set<string> {
    if (this._cachedMovementTypes === null) {
      this._cachedMovementTypes = new Set<string>()
      if (hasMovementType(this._movementTypes, MovementType.Horizontal)) {
        this._cachedMovementTypes.add('Horizontal')
      }
      if (hasMovementType(this._movementTypes, MovementType.Vertical)) {
        this._cachedMovementTypes.add('Vertical')
      }
      if (hasMovementType(this._movementTypes, MovementType.Turn)) {
        this._cachedMovementTypes.add('Turn')
      }
    }
    return this._cachedMovementTypes
  }

  /** Raw movement types bitmask.
   *
   * OpenRA 对照: Aircraft.CurrentMovementTypes (setter)
   */
  get movementTypes(): MovementType {
    return this._movementTypes
  }

  private _setMovementTypes(value: MovementType): void {
    const oldValue = this._movementTypes
    this._movementTypes = value
    this._cachedMovementTypes = null // invalidate cache
    if (value !== oldValue) {
      for (const n of this._notifyMoving) {
        n.movementTypeChanged(this._self, value)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Force flags
  // -----------------------------------------------------------------------

  /** Whether force landing is active.
   *
   * OpenRA 对照: Aircraft.ForceLanding
   */
  get forceLanding(): boolean {
    return this._forceLanding
  }

  set forceLanding(value: boolean) {
    this._forceLanding = value
  }

  /** Whether this aircraft requires force move.
   *
   * OpenRA 对照: Aircraft.RequireForceMove
   */
  get requireForceMove(): boolean {
    return this._requireForceMove
  }

  set requireForceMove(value: boolean) {
    this._requireForceMove = value
  }

  // -----------------------------------------------------------------------
  // IsLeaving
  // -----------------------------------------------------------------------

  /** Check if the aircraft is currently leaving (moving horizontally or turning).
   *
   * OpenRA 对照: N/A (equivalent to Mobile.IsLeaving logic applied to aircraft)
   */
  isLeaving(): boolean {
    if (hasMovementType(this._movementTypes, MovementType.Horizontal)) return true
    if (hasMovementType(this._movementTypes, MovementType.Turn)) return true
    return false
  }

  // -----------------------------------------------------------------------
  // ITick
  // OpenRA 对照: Aircraft.Tick(Actor self)
  // -----------------------------------------------------------------------

  /** Per-tick update.
   *
   * OpenRA 对照: ITick.Tick(Actor self) → Aircraft.Tick(Actor self)
   */
  tick(actor: IGameActor): void {
    // Handle pausing: force land if paused and airborne
    if (
      !this._forceLanding &&
      this.isTraitPaused &&
      this._airborne &&
      this.canLand(this.topLeft) &&
      true // NOTE: C# also checks !(currentActivity is Land || currentActivity is Turn)
    ) {
      this._queueActivity(actor, false, new LandActivity())
      this._forceLanding = true
    }

    // Handle unpausing: take off if forced to land
    if (
      this._forceLanding &&
      !this.isTraitPaused &&
      !this._cruising
      // NOTE: C# also checks self.CurrentActivity is not TakeOff
    ) {
      this._forceLanding = false
      if (this.info.idleBehavior !== IdleBehaviorType.Land) {
        this._queueActivity(actor, false, new TakeOffActivity())
      }
    }

    const oldCachedFacing = this._cachedFacing
    this._cachedFacing = this.facing

    const oldCachedPosition = this._cachedPosition
    this._cachedPosition = this.centerPosition

    let newMovementTypes = MovementType.None
    if (!WAngle.equals(oldCachedFacing, this.facing)) {
      newMovementTypes |= MovementType.Turn
    }

    const posDelta = WPos.subtract(oldCachedPosition, this._cachedPosition)
    if (posDelta.horizontalLengthSquared !== 0) {
      newMovementTypes |= MovementType.Horizontal
    }
    if (posDelta.verticalLengthSquared !== 0) {
      newMovementTypes |= MovementType.Vertical
    }

    this._setMovementTypes(newMovementTypes as MovementType)

    // Reset pitch/roll when not moving horizontally
    if (!hasMovementType(newMovementTypes as MovementType, MovementType.Horizontal)) {
      if (
        this.info.roll.angle !== 0 &&
        this.roll.angle !== 0
      ) {
        this.roll = WAngle.tickFacing(
          this.roll,
          WAngle.Zero,
          this.info.rollSpeed,
        )
      }
      if (
        this.info.pitch.angle !== 0 &&
        this.pitch.angle !== 0
      ) {
        this.pitch = WAngle.tickFacing(
          this.pitch,
          WAngle.Zero,
          this.info.pitchSpeed,
        )
      }
    }

    this.repulse()
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld / INotifyRemovedFromWorld
  // OpenRA 对照: Aircraft.AddedToWorld / RemovedFromWorld
  // -----------------------------------------------------------------------

  /** Called when the actor is added to the world.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor self)
   */
  addedToWorld(actor: IGameActor): void {
    this._addToMaps(actor)

    const altitude = this._getDistanceAboveTerrain(this._centerPosition)
    if (altitude.length >= this.info.minAirborneAltitude) {
      this._onAirborneAltitudeReached()
    }
    if (altitude.length === this.info.cruiseAltitude.length) {
      this._onCruisingAltitudeReached()
    }
  }

  /** Called when the actor is removed from the world.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
   */
  removedFromWorld(actor: IGameActor): void {
    this.unReserve()
    this._removeFromMaps(actor)

    this._onCruisingAltitudeLeft()
    this._onAirborneAltitudeLeft()
  }

  // -----------------------------------------------------------------------
  // INotifyBecomingIdle
  // OpenRA 对照: Aircraft.OnBecomingIdle(Actor self)
  // -----------------------------------------------------------------------

  /** Called when the actor becomes idle.
   *
   * OpenRA 对照: INotifyBecomingIdle.OnBecomingIdle(Actor self)
   */
  onBecomingIdle(actor: IGameActor): void {
    if (this.info.idleBehavior === IdleBehaviorType.LeaveMap) {
      this._queueActivity(actor, false, new FlyOffMapActivity())
      this._queueActivity(actor, false, new RemoveSelfActivity())
    } else if (this.info.idleBehavior === IdleBehaviorType.LeaveMapAtClosestEdge) {
      // const _edgeCell = ... (unused in stub, deferred to Ch14)
      this._queueActivity(actor, false, new FlyOffMapActivity())
      this._queueActivity(actor, false, new RemoveSelfActivity())
    } else if (
      this.info.idleBehavior === IdleBehaviorType.ReturnToBase &&
      this.getActorBelow() === null
    ) {
      this._queueActivity(
        actor,
        false,
        new ReturnToBaseActivity(),
      )
    } else {
      const distanceAboveTerrain = this._getDistanceAboveTerrain(
        this._centerPosition,
      )
      if (distanceAboveTerrain.length === this.landAltitude.length) {
        if (!this.canLand(this.topLeft) && this._reservedActor === null) {
          this._queueActivity(actor, false, new TakeOffActivity())
        }
        return
      }

      if (
        this.info.idleBehavior === IdleBehaviorType.Land &&
        this.info.landableTerrainTypes.size > 0
      ) {
        this._queueActivity(actor, false, new LandActivity())
      } else {
        this._queueActivity(actor, false, new FlyIdleActivity())
      }
    }
  }

  // -----------------------------------------------------------------------
  // ICreationActivity
  // OpenRA 对照: Aircraft ICreationActivity.GetCreationActivity()
  // -----------------------------------------------------------------------

  /** Get the creation activity for this aircraft.
   *
   * OpenRA 对照: ICreationActivity.GetCreationActivity()
   *
   * Returns an AssociateWithAirfieldActivity (stubbed as ReturnToBaseActivity)
   * when there is a rally point, delay, or map-created flag. Otherwise returns
   * null, matching C# behavior exactly.
   */
  getCreationActivity(): ActivityStub | null {
    if (
      this._creationRallyPoint !== null ||
      this._creationActivityDelay > 0 ||
      this._creationByMap
    ) {
      // TODO-14.A.12: Implement AssociateWithAirfieldActivity
      return new ReturnToBaseActivity()
    }
    return null
  }

  // -----------------------------------------------------------------------
  // IDeathActorInitModifier
  // OpenRA 对照: Aircraft.ModifyDeathActorInit(Actor self, TypeDictionary init)
  // -----------------------------------------------------------------------

  /** Modify the death actor init to include current facing.
   *
   * OpenRA 对照: IDeathActorInitModifier.ModifyDeathActorInit()
   */
  modifyDeathActorInit(
    _self: IGameActor,
    init: Map<string, unknown>,
  ): void {
    init.set('facing', this.facing)
  }

  // -----------------------------------------------------------------------
  // IActorPreviewInitModifier
  // OpenRA 对照: IActorPreviewInitModifier.ModifyActorPreviewInit()
  // -----------------------------------------------------------------------

  /** Modify actor preview inits for dynamic facing.
   *
   * OpenRA 对照: IActorPreviewInitModifier.ModifyActorPreviewInit()
   */
  modifyActorPreviewInit(
    _self: IGameActor,
    inits: Map<string, unknown>,
  ): void {
    if (!inits.has('dynamicFacing') && !inits.has('facing')) {
      inits.set('dynamicFacing', () => this.facing)
    }
  }

  // -----------------------------------------------------------------------
  // IIssueDeployOrder
  // OpenRA 对照: IIssueDeployOrder.IssueDeployOrder, CanIssueDeployOrder
  // -----------------------------------------------------------------------

  /** Whether this aircraft can issue a deploy order.
   *
   * OpenRA 对照: IIssueDeployOrder.CanIssueDeployOrder
   */
  get canIssueDeployOrder(): boolean {
    return (
      this._rearmable !== null &&
      this._rearmable.info.rearmActors.size > 0
    )
  }

  /** Issue a deploy order (ReturnToBase).
   *
   * OpenRA 对照: IIssueDeployOrder.IssueDeployOrder(Actor self, bool queued)
   */
  issueDeployOrder(
    _actor: IGameActor,
    queued: boolean,
  ): Order | null {
    if (
      this.isTraitDisabled ||
      this._rearmable === null ||
      this._rearmable.info.rearmActors.size === 0
    ) {
      return null
    }
    return {
      orderName: 'ReturnToBase',
      targetString: '',
      extraData: { queued },
    } as unknown as Order
  }

  // -----------------------------------------------------------------------
  // IIssueOrder
  // OpenRA 对照: IIssueOrder.Orders, IssueOrder
  // -----------------------------------------------------------------------

  /** The set of orders this aircraft can issue.
   *
   * OpenRA 对照: Aircraft.Orders
   */
  get orders(): readonly IOrderTargeter[] {
    // Stub order targeters — full implementation deferred to Chapter 15
    return []
  }

  /** Issue an order.
   *
   * OpenRA 对照: Aircraft.IssueOrder(Actor self, IOrderTargeter order, Target target, bool queued)
   */
  issueOrder(
    _actor: IGameActor,
    _order: IOrderTargeter,
    _target: TargetStub,
    _queued: boolean,
  ): Order {
    // TODO-15.A.1: Full order targeter integration
    // Currently returns a minimal order stub
    return {
      orderName: 'Move',
      targetString: '',
      extraData: {},
    } as unknown as Order
  }

  // -----------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: Aircraft.ResolveOrder(Actor self, Order order)
  // -----------------------------------------------------------------------

  /** Resolve a player-issued order.
   *
   * OpenRA 对照: Aircraft.ResolveOrder(Actor self, Order order)
   */
  resolveOrder(actor: IGameActor, order: Order): void {
    if (this.isTraitDisabled) return

    const orderString = order.orderName

    if (orderString === 'Move') {
      if (!this._isValidFor(actor, order)) return

      const map = this._getMap()
      if (!map) return

      const cell = map.clamp(
        map.cellContaining(this._getOrderCenterPosition(order)),
      )

      if (!this.info.moveIntoShroud) {
        const shrouded = this._isShroudExplored(cell)
        if (!shrouded) return
      }

      if (!(order.extraData as any)?.queued) {
        this.unReserve()
      }

      this._queueActivity(
        actor,
        (order.extraData as any)?.queued ?? false,
        new FlyActivity(),
      )
      this._showTargetLines(actor)
    } else if (orderString === 'Land') {
      if (!this._isValidFor(actor, order)) return

      const map = this._getMap()
      if (!map) return

      const cell = map.clamp(
        map.cellContaining(this._getOrderCenterPosition(order)),
      )

      if (!this.info.moveIntoShroud) {
        const shrouded = this._isShroudExplored(cell)
        if (!shrouded) return
      }

      if (!(order.extraData as any)?.queued) {
        this.unReserve()
      }

      this._queueActivity(
        actor,
        (order.extraData as any)?.queued ?? false,
        new LandActivity(),
      )
      this._showTargetLines(actor)
    } else if (
      orderString === 'Enter' ||
      orderString === 'ForceEnter' ||
      orderString === 'Repair'
    ) {
      // These orders are only valid for own/allied actors
      // TODO-9.B.1-ENTER: Full Enter/Repair order handling
      if (!(order.extraData as any)?.queued) {
        this.unReserve()
      }

      // isForceEnter deferred to Ch14
      this._queueActivity(
        actor,
        (order.extraData as any)?.queued ?? false,
        new ReturnToBaseActivity(),
      )
      this._showTargetLines(actor)
    } else if (orderString === 'Stop') {
      this._cancelActivity(actor)
      this.unReserve()
    } else if (orderString === 'ReturnToBase') {
      if (
        this._rearmable === null ||
        this._rearmable.info.rearmActors.size === 0 ||
        this.getActorBelow() !== null
      ) {
        return
      }

      if (!(order.extraData as any)?.queued) {
        this.unReserve()
      }

      this._queueActivity(
        actor,
        (order.extraData as any)?.queued ?? false,
        new ReturnToBaseActivity(),
      )
      this._showTargetLines(actor)
    } else if (orderString === 'Scatter') {
      this._queueActivity(
        actor,
        (order.extraData as any)?.queued ?? false,
        new NudgeActivity(),
      )
      this._showTargetLines(actor)
    }
  }

  // -----------------------------------------------------------------------
  // IOrderVoice
  // OpenRA 对照: Aircraft.VoicePhraseForOrder(Actor self, Order order)
  // -----------------------------------------------------------------------

  /** Get the voice phrase for an order.
   *
   * OpenRA 对照: Aircraft.VoicePhraseForOrder(Actor self, Order order)
   */
  voicePhraseForOrder(_actor: IGameActor, order: Order): string {
    if (this.isTraitDisabled) return ''

    switch (order.orderName) {
      case 'Land':
      case 'Move':
        // When moveIntoShroud is false, check if the target cell is explored.
        // If the order has a resolvable cell position, use it; otherwise
        // use the actor's own position (which is always explored).
        if (!this.info.moveIntoShroud) {
          const map = this._getMap()
          if (map) {
            const cell = map.clamp(
              map.cellContaining(this._getOrderCenterPosition(order)),
            )
            const shrouded = this._isShroudExplored(cell)
            if (!shrouded) return ''
          }
        }
        return this.info.voice
      case 'Enter':
      case 'ForceEnter':
      case 'Stop':
      case 'Scatter':
        return this.info.voice
      case 'ReturnToBase':
        return this._rearmable !== null &&
          this._rearmable.info.rearmActors.size > 0
          ? this.info.voice
          : ''
      default:
        return ''
    }
  }

  // -----------------------------------------------------------------------
  // IObservesVariables
  // OpenRA 对照: Aircraft.GetVariableObservers()
  // -----------------------------------------------------------------------

  /** Get variable observers for condition-based state changes.
   *
   * OpenRA 对照: Aircraft.GetVariableObservers()
   */
  getVariableObservers(): readonly VariableObserver[] {
    if (this.info.requireForceMoveCondition) {
      return [
        {
          notifier: this._requireForceMoveConditionChanged.bind(this),
          variables: [this.info.requireForceMoveCondition],
        },
      ]
    }
    return []
  }

  private _requireForceMoveConditionChanged(
    _actor: IGameActor,
    conditions: ReadonlyMap<string, number>,
  ): void {
    // Simple condition check: if all variables have tokens > 0, condition is true
    const expr = this.info.requireForceMoveCondition!
    // Evaluate simple boolean expression
    this._requireForceMove = this._evaluateConditionExpr(expr, conditions)
  }

  private _evaluateConditionExpr(
    expr: string,
    conditions: ReadonlyMap<string, number>,
  ): boolean {
    // Simple variable reference: check if token count > 0
    const trimmed = expr.trim()
    if (trimmed.startsWith('!')) {
      return !this._evaluateConditionExpr(trimmed.substring(1), conditions)
    }
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      return this._evaluateConditionExpr(
        trimmed.substring(1, trimmed.length - 1),
        conditions,
      )
    }

    const andIdx = trimmed.indexOf('&&')
    if (andIdx > -1) {
      return (
        this._evaluateConditionExpr(
          trimmed.substring(0, andIdx).trim(),
          conditions,
        ) &&
        this._evaluateConditionExpr(
          trimmed.substring(andIdx + 2).trim(),
          conditions,
        )
      )
    }
    const orIdx = trimmed.indexOf('||')
    if (orIdx > -1) {
      return (
        this._evaluateConditionExpr(
          trimmed.substring(0, orIdx).trim(),
          conditions,
        ) ||
        this._evaluateConditionExpr(
          trimmed.substring(orIdx + 2).trim(),
          conditions,
        )
      )
    }

    return (conditions.get(trimmed) ?? 0) > 0
  }

  // -----------------------------------------------------------------------
  // Airborne conditions
  // OpenRA 对照: Aircraft OnAirborneAltitudeReached / OnAirborneAltitudeLeft
  // -----------------------------------------------------------------------

  private _onAirborneAltitudeReached(): void {
    if (this._airborne) return
    this._airborne = true
    if (
      this.info.airborneCondition !== null &&
      this._airborneToken === -1 &&
      this._self.grantCondition
    ) {
      this._airborneToken = this._self.grantCondition(
        this.info.airborneCondition,
      )
    }
  }

  private _onAirborneAltitudeLeft(): void {
    if (!this._airborne) return
    this._airborne = false
    if (
      this._airborneToken !== -1 &&
      this.info.airborneCondition !== null &&
      this._self.revokeCondition
    ) {
      this._self.revokeCondition(this._airborneToken)
      this._airborneToken = -1
    }
  }

  // -----------------------------------------------------------------------
  // Cruising conditions
  // OpenRA 对照: Aircraft OnCruisingAltitudeReached / OnCruisingAltitudeLeft
  // -----------------------------------------------------------------------

  private _onCruisingAltitudeReached(): void {
    if (this._cruising) return
    this._cruising = true
    if (
      this.info.cruisingCondition !== null &&
      this._cruisingToken === -1 &&
      this._self.grantCondition
    ) {
      this._cruisingToken = this._self.grantCondition(
        this.info.cruisingCondition,
      )
    }
  }

  private _onCruisingAltitudeLeft(): void {
    if (!this._cruising) return
    this._cruising = false
    if (
      this._cruisingToken !== -1 &&
      this.info.cruisingCondition !== null &&
      this._self.revokeCondition
    ) {
      this._self.revokeCondition(this._cruisingToken)
      this._cruisingToken = -1
    }
  }

  // -----------------------------------------------------------------------
  // Private helper — world access (all through duck typing)
  // -----------------------------------------------------------------------

  private _getWorld(): IAircraftWorld | null {
    return (this._self?.world as IAircraftWorld | undefined) ?? null
  }

  private _getMap(): IAircraftMap | null {
    return this._getWorld()?.map ?? null
  }

  private _getActorMap(): IAircraftActorMap | null {
    return this._getWorld()?.actorMap ?? null
  }

  private _getSharedRandom(): number {
    return this._getWorld()?.sharedRandom ?? 0
  }

  private _getDistanceAboveTerrain(pos: WPos): WDist {
    return this._getMap()?.distanceAboveTerrain(pos) ?? WDist.Zero
  }

  private _getMapCellContaining(pos: WPos): CPos {
    return this._getMap()?.cellContaining(pos) ?? CPos.Zero
  }

  private _getMapCenterOfCell(cell: CPos): WPos {
    return this._getMap()?.centerOfCell(cell) ?? WPos.Zero
  }

  private _getSpeedModifiers(): number[] {
    if (this._speedModifiersMemo === null) {
      this._speedModifiersMemo = []
      const traits = this._getActorTraits()
      if (traits.speedModifiers) {
        this._speedModifiersMemo = traits.speedModifiers.map(
          (sm: ISpeedModifier) => sm.getSpeedModifier(),
        )
      }
    }
    return this._speedModifiersMemo
  }

  /** Get trait references from the actor via duck typing.
   *
   * OpenRA 对照: self.TraitsImplementing<T>() in C# via reflection
   */
  private _getActorTraits(): {
    repairable?: RepairableStub
    rearmable?: RearmableStub
    speedModifiers?: ISpeedModifier[]
    positionOffsets?: IAircraftCenterPositionOffset[]
    overrideAircraftLanding?: IOverrideAircraftLanding
    notifyMoving?: { movementTypeChanged(actor: IGameActor, type: MovementType): void }[]
    notifyCenterPositionChanged?: { centerPositionChanged(actor: IGameActor, x: number, y: number): void }[]
  } {
    const self = this._self as unknown as Record<string, unknown>
    return {
      repairable: self.repairable as RepairableStub | undefined,
      rearmable: self.rearmable as RearmableStub | undefined,
      speedModifiers: self.speedModifiers as ISpeedModifier[] | undefined,
      positionOffsets: self.positionOffsets as IAircraftCenterPositionOffset[] | undefined,
      overrideAircraftLanding: self.overrideAircraftLanding as IOverrideAircraftLanding | undefined,
      notifyMoving: self.notifyMoving as
        { movementTypeChanged(actor: IGameActor, type: MovementType): void }[] | undefined,
      notifyCenterPositionChanged: self.notifyCenterPositionChanged as
        { centerPositionChanged(actor: IGameActor, x: number, y: number): void }[] | undefined,
    }
  }

  private _addToMaps(actor: IGameActor): void {
    const world = this._getWorld()
    if (world && typeof world.addToMaps === 'function') {
      world.addToMaps(actor, this)
    }
  }

  private _removeFromMaps(actor: IGameActor): void {
    const world = this._getWorld()
    if (world && typeof world.removeFromMaps === 'function') {
      world.removeFromMaps(actor, this)
    }
  }

  private _updateMaps(_actor: IGameActor): void {
    const world = this._getWorld()
    if (world && typeof world.updateMaps === 'function') {
      world.updateMaps(_actor, this)
    }
  }

  private _addInfluence(actor: IGameActor): void {
    const actorMap = this._getActorMap()
    if (actorMap && typeof actorMap.addInfluence === 'function') {
      actorMap.addInfluence(actor, this)
    }
  }

  private _removeInfluence(actor: IGameActor): void {
    const actorMap = this._getActorMap()
    if (actorMap && typeof actorMap.removeInfluence === 'function') {
      actorMap.removeInfluence(actor, this)
    }
  }

  private _queueActivity(
    _actor: IGameActor,
    _queued: boolean,
    activity: ActivityStub,
  ): void {
    // HACK: Queue activity via actor if available
    const self = this._self as unknown as Record<string, unknown>
    if (typeof self.queueActivity === 'function') {
      (self.queueActivity as (a: ActivityStub, queued: boolean) => void)(
        activity,
        _queued,
      )
    }
  }

  private _cancelActivity(actor: IGameActor): void {
    const self = actor as unknown as Record<string, unknown>
    if (typeof self.cancelActivity === 'function') {
      (self.cancelActivity as () => void)()
    }
  }

  private _showTargetLines(_actor: IGameActor): void {
    const self = _actor as unknown as Record<string, unknown>
    if (typeof self.showTargetLines === 'function') {
      (self.showTargetLines as () => void)()
    }
  }

  /** Check if the actor has the Reservable trait info (which means it can be
   * reserved by aircraft for landing/resupply).
   *
   * OpenRA 对照: Reservable.IsReservable(Actor)
   *
   * TODO-9.B.1-RESERVABLE: Replace with proper Reservable trait check once
   *   the Reservable/ReservableInfo migration is complete. Currently returns
   *   false for all actors — actual reservation logic deferred.
   */
  private _hasReservableInfo(_actor: IGameActor): boolean {
    // STUB: Always returns false until Reservable trait is migrated.
    // In C#: checks if actor.Info.TraitInfo<ReservableInfo>() is not null.
    // For now, no actor is considered reservable, which means GetActorBelow()
    // returns null and ReturnToBase falls back to resupply search logic.
    return false
  }

  private _hasMobile(actor: IGameActor): boolean {
    const a = actor as unknown as Record<string, unknown>
    return typeof a.mobile !== 'undefined' && a.mobile !== null
  }

  private _isAtGroundLevel(): boolean {
    return this._getDistanceAboveTerrain(this._centerPosition).length === 0
  }

  /** Check if an actor is at ground level relative to this aircraft.
   *
   * OpenRA 对照: Aircraft.IsAtGroundLevel(Actor)
   *
   * For other actors, checks if their position is at or below the aircraft's
   * land altitude threshold. This prevents crushing actors that are airborne.
   *
   * TODO-9.B.1-ALTITUDE: Full altitude comparison with other actor's vertical
   *   position. Currently checks distance above terrain through map proxy.
   */
  private _isAtGroundLevelA(actor: IGameActor): boolean {
    const actorPos = (actor as unknown as { centerPosition?: WPos }).centerPosition
    if (!actorPos) return false
    const terrainDist = this._getDistanceAboveTerrain(actorPos)
    // Actor is at ground level if the terrain distance is 0 or very small
    return terrainDist.length <= this.landAltitude.length
  }

  private _appearsHostileTo(a: IGameActor): boolean {
    const self = this._self as unknown as Record<string, unknown>
    if (typeof self.appearsHostileTo === 'function') {
      return (self.appearsHostileTo as (a: IGameActor) => boolean)(a)
    }
    return false
  }

  private _getDamageState(): number {
    const self = this._self as unknown as Record<string, unknown>
    if (typeof self.getDamageState === 'function') {
      return (self.getDamageState as () => number)()
    }
    return 1 // Default: Undamaged
  }

  private _worldHasTemporaryBlockers(): boolean {
    const world = this._getWorld()
    return (
      (world?.rulesContainTemporaryBlocker as boolean | undefined) ?? false
    )
  }

  private _landingCellsEqual(other: readonly OccupiedCell[]): boolean {
    if (this._landingCells.length !== other.length) return false
    for (let i = 0; i < this._landingCells.length; i++) {
      const a = this._landingCells[i]
      const b = other[i]
      if (!CPos.equals(a.cell, b.cell) || a.subCell !== b.subCell) return false
    }
    return true
  }

  private _isValidFor(_actor: IGameActor, order: Order): boolean {
    // Simplified validity check
    return (
      order.orderName !== undefined &&
      order.orderName.length > 0
    )
  }

  private _getOrderCenterPosition(_order: Order): WPos {
    // Simplified: extract position from order target data
    // TODO-9.B.1: Full order target position extraction
    return this._centerPosition
  }

  private _isShroudExplored(_cell: CPos): boolean {
    const self = this._self as unknown as Record<string, unknown>
    if (!self.owner) return true
    const owner = self.owner as unknown as Record<string, unknown>
    if (!owner.shroud as any) return true
    if (typeof (owner.shroud as any)?.isExplored === 'function') {
      return ((owner.shroud as any).isExplored as (c: CPos) => boolean)(_cell)
    }
    return true
  }
}

// ---------------------------------------------------------------------------
// AircraftMoveOrderTargeter stub
// OpenRA 对照: Aircraft.AircraftMoveOrderTargeter : IOrderTargeter
// ---------------------------------------------------------------------------

/**
 * Order targeter for aircraft move orders.
 *
 * OpenRA 对照: AircraftMoveOrderTargeter (nested class in Aircraft)
 *
 * TODO-15.A.1: Full order targeter implementation with cursor management.
 */
export class AircraftMoveOrderTargeter implements IOrderTargeter {
  orderID: string = 'Move'
  readonly orderPriority: number = 4
  isQueued: boolean = false

  private readonly _aircraft: Aircraft

  constructor(aircraft: Aircraft) {
    this._aircraft = aircraft
  }

  canTarget(
    _actor: IGameActor,
    _target: TargetStub,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // TODO-15.A.1: Full canTarget logic
    return !this._aircraft.isTraitDisabled
  }

  targetOverridesSelection(
    _actor: IGameActor,
    target: TargetStub,
    _actorsAt: readonly IGameActor[],
    _xy: CPos,
    modifiers: TargetModifiers,
  ): boolean {
    // Always prioritise orders over selecting other people's actors
    if (
      (target as unknown as { type?: string }).type === 'Actor'
    ) {
      return true
    }
    return TargetModifiersExts.hasModifier(modifiers, TargetModifiers.ForceMove)
  }
}
