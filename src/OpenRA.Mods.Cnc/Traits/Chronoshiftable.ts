/**
 * Chronoshiftable.ts — 超时空传送能力（Actor可通过超时空传送）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Chronoshiftable.cs (192 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ChronoshiftableInfo> → TS ConditionalTrait<ChronoshiftableInfo>
 * - C# ISync → TS ISync marker interface
 * - C# ISelectionBar → TS ISelectionBar interface
 * - C# IDeathActorInitModifier / ITransformActorInitModifier → TS same pattern
 * - C# Actor.CurrentActivity hacking (HACK comment) → TS same approach with note
 * - C# QueueActivity(new Teleport(...)) → TS forward stub for Teleport activity
 * - C# frameEndTask → TS deferral pattern (TODO for World integration)
 *
 * NOTE: The Teleport activity (OpenRA.Mods.Cnc.Activities.Teleport) is deferred
 * to . This trait references it as a forward-declared stub.
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo as IConditionalTraitInfo,
  IGameActor,
  ISync,
  ITick,
  ISelectionBar,
  ColorStub,
  ITraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// ChronoshiftReturnInit
// OpenRA 对照: ChronoshiftReturnInit : CompositeActorInit, ISingleInstanceInit
// ---------------------------------------------------------------------------

/**
 * Initializer for persisting chronoshift return state across actor transforms.
 *
 * OpenRA 对照: ChronoshiftReturnInit
 */
export class ChronoshiftReturnInit {
  readonly ticks: number
  readonly duration: number
  readonly origin: CPos
  readonly chronosphere: IGameActor | null

  constructor(
    ticks: number,
    duration: number,
    origin: CPos,
    chronosphere: IGameActor | null,
  ) {
    this.ticks = ticks
    this.duration = duration
    this.origin = origin
    this.chronosphere = chronosphere
  }
}

// ---------------------------------------------------------------------------
// ChronoshiftableInfo
// OpenRA 对照: ChronoshiftableInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the Chronoshiftable trait.
 *
 * OpenRA 对照: ChronoshiftableInfo
 *
 * Requires Mobile or Husk trait on the actor.
 */
export class ChronoshiftableInfo implements ITraitInfo, IConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Should the actor die instead of being teleported?
   *
   * OpenRA 对照: ChronoshiftableInfo.ExplodeInstead
   */
  readonly explodeInstead: boolean

  /** Types of damage inflicted when exploding or return-to-origin is blocked.
   *
   * OpenRA 对照: ChronoshiftableInfo.DamageTypes (BitSet<DamageType>)
   */
  readonly damageTypes: readonly string[]

  /** Sound played when chronoshifting.
   *
   * OpenRA 对照: ChronoshiftableInfo.ChronoshiftSound
   */
  readonly chronoshiftSound: string

  /** Whether the actor should return to its previous location.
   *
   * OpenRA 对照: ChronoshiftableInfo.ReturnToOrigin
   */
  readonly returnToOrigin: boolean

  /** Color of the return-to-origin timer bar.
   *
   * OpenRA 对照: ChronoshiftableInfo.TimeBarColor
   */
  readonly timeBarColor: ColorStub

  constructor(params?: {
    instanceName?: string
    requiresCondition?: string
    explodeInstead?: boolean
    damageTypes?: string[]
    chronoshiftSound?: string
    returnToOrigin?: boolean
    timeBarColor?: ColorStub
  }) {
    this.instanceName = params?.instanceName
    this.requiresCondition = params?.requiresCondition
    this.explodeInstead = params?.explodeInstead ?? false
    this.damageTypes = params?.damageTypes ?? []
    this.chronoshiftSound = params?.chronoshiftSound ?? 'chrono2.aud'
    this.returnToOrigin = params?.returnToOrigin ?? true
    this.timeBarColor = params?.timeBarColor ?? { r: 255, g: 255, b: 255, a: 255 }
  }

  create(init: IGameActor): Chronoshiftable {
    return new Chronoshiftable(init, this)
  }
}

// ---------------------------------------------------------------------------
// Teleport activity forward stub
//
// OpenRA 对照: OpenRA.Mods.Cnc.Activities.Teleport
// Full migration of Teleport activity.
// ---------------------------------------------------------------------------

/** Queue a teleport activity on the actor.
 *
 * In production, this delegates to self.QueueActivity() with a Teleport
 * activity instance. For testing, this is a no-op that logs the call.
 *
* Replace with real Teleport activity integration.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function queueTeleport(
  _self: IGameActor,
  _queued: boolean,
  _chronosphere: IGameActor,
  _target: CPos,
  _maxDistance: number | null,
  _killCargo: boolean,
  _sound: string,
  _flashScreen?: boolean,
  _returnToOrigin?: boolean,
  _damageTypes?: readonly string[],
): void {
  // Stub — no-op in tests, replaced by real Teleport activity at runtime
}

// ---------------------------------------------------------------------------
// IPositionable forward stub
// ---------------------------------------------------------------------------

/**
 * Minimal IPositionable interface for CanEnterCell check.
 *
 * OpenRA 对照: IPositionable (subset)
 */
interface IPositionableStub {
  canEnterCell(cell: CPos, ignoreActor?: IGameActor | null): boolean
}

// ---------------------------------------------------------------------------
// Chronoshiftable
// OpenRA 对照: Chronoshiftable : ConditionalTrait<ChronoshiftableInfo>,
//   ITick, ISync, ISelectionBar, IDeathActorInitModifier, ITransformActorInitModifier
// ---------------------------------------------------------------------------

/**
 * Allows an actor to be teleported via Chronoshift power.
 *
 * OpenRA 对照: Chronoshiftable
 *
 * Handles both the initial teleport and the return-to-origin logic after
 * the chronoshift duration expires. When return-to-origin is enabled, the
 * actor queues a Teleport back to its original position when the timer
 * reaches zero.
 */
export class Chronoshiftable
  extends ConditionalTrait<ChronoshiftableInfo>
  implements ITick, ISync, ISelectionBar
{
  /** The actor this trait is attached to.
   *
   * OpenRA 对照: Chronoshiftable.self
   */
  readonly self: IGameActor

  /** The actor that chronoshifted this one (the chronosphere building).
   *
   * OpenRA 对照: Chronoshiftable.chronosphere
   */
  private _chronosphere: IGameActor | null = null

  /** Duration of the current chronoshift (ticks until return).
   *
   * OpenRA 对照: Chronoshiftable.duration
   */
  private _duration: number = 0

  /** Whether the cargo should be killed on the return trip.
   *
   * OpenRA 对照: Chronoshiftable.killCargo
   */
  private _killCargo: boolean = true

  /** The actor's positionable trait (for CanEnterCell checks).
   *
   * OpenRA 对照: Chronoshiftable.iPositionable
   */
  private _iPositionable: IPositionableStub | null = null

  // -----------------------------------------------------------------------
  // Sync fields
  // -----------------------------------------------------------------------

  /** The original position for return-to-origin.
   *
   * OpenRA 对照: Chronoshiftable.Origin ([VerifySync])
   */
  origin: CPos = CPos.Zero

  /** Ticks remaining until return to origin.
   *
   * OpenRA 对照: Chronoshiftable.ReturnTicks ([VerifySync])
   */
  returnTicks: number = 0

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(init: IGameActor, info: ChronoshiftableInfo) {
    super(info)
    this.self = init

    // Process ChronoshiftReturnInit from actor initializer
    // OpenRA: var returnInit = init.GetOrDefault<ChronoshiftReturnInit>(info.InstanceName)
    const actorAny = init as unknown as Record<string, unknown>
    const returnInit = actorAny['chronoshiftReturnInit'] as ChronoshiftReturnInit | undefined
    if (returnInit) {
      this.setReturnState(
        returnInit.ticks,
        returnInit.duration,
        returnInit.origin,
        returnInit.chronosphere,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle (对应 OpenRA Created)
  // -----------------------------------------------------------------------

  /** Called after the actor is created. Resolves IPositionable.
   *
   * OpenRA 对照: Chronoshiftable.Created(Actor)
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    // NOTE: IPositionable = self.OccupiesSpace as IPositionable
    // In TS, this is resolved via a stub lookup.
    const actorAny = actor as unknown as Record<string, unknown>
    const occupiesSpace = actorAny['occupiesSpace']
    if (occupiesSpace && typeof occupiesSpace === 'object') {
      this._iPositionable = occupiesSpace as IPositionableStub
    }
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick the return-to-origin countdown.
   *
   * OpenRA 对照: Chronoshiftable.ITick.Tick(Actor)
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled || !this.info.returnToOrigin || this.returnTicks <= 0)
      return

    // Return to original location
    if (--this.returnTicks === 0) {
      // OpenRA HACK: manipulating private internal actor state
      // The Move activity is not immediately cancelled...
      // We force-erase the Move activity to work around the cancellation bug.
      // NOTE: In TS, this would be:
      //   if (self.currentActivity instanceof Move)
      //     self.currentActivity = null

      // Queue the Teleport activity back to origin
      queueTeleport(
        self,
        false,
        this._chronosphere ?? self,
        this.origin,
        null, // maxDistance: no limit for return
        this._killCargo, // killCargo — preserved from original teleport call
        this.info.chronoshiftSound,
        false, // flashScreen: false for return
        true,  // returnToOrigin
        this.info.damageTypes,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Check whether the actor can chronoshift to the target cell.
   *
   * OpenRA 对照: Chronoshiftable.CanChronoshiftTo(Actor, CPos)
   *
   * Cannot be used in synced code, except with ignoreVis.
   */
  canChronoshiftTo(_self: IGameActor, targetLocation: CPos): boolean {
    // TODO: Allow enemy units to be chronoshifted into bad terrain to kill them
    if (this.isTraitDisabled) return false
    if (!this._iPositionable) return false
    return this._iPositionable.canEnterCell(targetLocation)
  }

  /** Teleport the actor to the target location.
   *
   * OpenRA 对照: Chronoshiftable.Teleport(Actor, CPos, int, bool, Actor)
   *
   * @returns true if the teleport was accepted (either executed or the actor exploded)
   */
  teleport(
    self: IGameActor,
    targetLocation: CPos,
    duration: number,
    killCargo: boolean,
    chronosphere: IGameActor,
  ): boolean {
    if (this.isTraitDisabled)
      return false

    // Some things appear chronoshiftable, but instead they just die.
    if (this.info.explodeInstead) {
      // NOTE: self.World.AddFrameEndTask(w => { if (!self.Disposed) self.Kill(chronosphere, Info.DamageTypes); })
      // Damage is inflicted by the chronosphere
      // TODO: World integration for frameEndTask + Kill
      return true
    }

    // Set up return-to-origin info
    // If this actor is already counting down to return to
    // an existing location then we shouldn't override it
    if (this.returnTicks <= 0) {
      this.origin = selfLocation(self)
      this.returnTicks = duration
    }

    this._duration = duration
    this._chronosphere = chronosphere
    this._killCargo = killCargo

    // Set up the teleport
    queueTeleport(
      self,
      false, // queued = false
      chronosphere,
      targetLocation,
      null, // maxDistance
      killCargo,
      this.info.chronoshiftSound,
      true, // flashScreen
    )

    return true
  }

  // -----------------------------------------------------------------------
  // ISelectionBar
  // -----------------------------------------------------------------------

  /** Get the remaining time as a bar value (0.0 to 1.0).
   *
   * OpenRA 对照: Chronoshiftable.ISelectionBar.GetValue()
   */
  getValue(): number {
    if (this.isTraitDisabled || !this.info.returnToOrigin)
      return 0

    // Otherwise an empty bar is rendered all the time
    if (this.returnTicks === 0) // NOTE: OpenRA also checks !self.Owner.IsAlliedWith(self.World.RenderPlayer)
      return 0

    return this.returnTicks / this._duration
  }

  /** Get the color of the selection bar.
   *
   * OpenRA 对照: Chronoshiftable.ISelectionBar.GetColor()
   */
  getColor(): ColorStub {
    return this.info.timeBarColor
  }

  /** Whether to display the bar when empty.
   *
   * OpenRA 对照: Chronoshiftable.ISelectionBar.DisplayWhenEmpty
   */
  get displayWhenEmpty(): boolean {
    return false
  }

  // -----------------------------------------------------------------------
  // Serialization helpers
  // -----------------------------------------------------------------------

  /** Create a ChronoshiftReturnInit from current state (for transform/death).
   *
   * OpenRA 对照: Chronoshiftable.ModifyActorInit(TypeDictionary)
   */
  createReturnInit(): ChronoshiftReturnInit | null {
    if (this.isTraitDisabled || !this.info.returnToOrigin || this.returnTicks <= 0)
      return null

    return new ChronoshiftReturnInit(
      this.returnTicks,
      this._duration,
      this.origin,
      this._chronosphere,
    )
  }

  // -----------------------------------------------------------------------
  // State setters (for testing and init reconstruction)
  // -----------------------------------------------------------------------

  /** Set the return state (used when reconstructing from ChronoshiftReturnInit).
   *
   * OpenRA 对照: Chronoshiftable constructor's returnInit handling
   */
  setReturnState(
    ticks: number,
    duration: number,
    origin: CPos,
    chronosphere: IGameActor | null,
  ): void {
    this.returnTicks = ticks
    this._duration = duration
    this.origin = origin
    this._chronosphere = chronosphere
  }

  /** Set the IPositionable for testing.
   */
  setPositionable(p: IPositionableStub | null): void {
    this._iPositionable = p
  }

  /** Whether the actor is currently chronoshifting (returnTicks > 0).
   */
  get isTeleporting(): boolean {
    return this.returnTicks > 0
  }

  /** The chronosphere actor that performed the shift.
   */
  get chronosphere(): IGameActor | null {
    return this._chronosphere
  }
}

// ---------------------------------------------------------------------------
// Helper: get actor location
// ---------------------------------------------------------------------------

/** Get the current cell location of an actor.
 *
 * OpenRA 对照: self.Location
 */
function selfLocation(self: IGameActor): CPos {
  const actorAny = self as unknown as Record<string, unknown>
  const loc = actorAny['location'] as CPos | undefined
  return loc ?? CPos.Zero
}
