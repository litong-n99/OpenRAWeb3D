/**
 * ConyardChronoReturn.ts — 建造场超时空返回（低血量时自动传送回原位）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/ConyardChronoReturn.cs (245 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo, Requires<HealthInfo>, Requires<WithSpriteBodyInfo>
 *   → TypeScript TraitInfo with stub note for dependencies
 * - C# IObservesVariables (BooleanExpression evaluation)
 *   → TypeScript IObservesVariables with VariableObserver pattern
 * - C# INotifySold → TypeScript INotifySold interface (already migrated)
 * - C# BitSet<DamageType> → TypeScript string[] (faction-agnostic damage types)
 * - C# Game.Sound.Play → TypeScript stub (audio integration deferred)
 * - C# World.CreateActor / self.Dispose → TypeScript stub (World integration deferred)
 * - C# ChronoVortexEffect / ConyardChronoVortex → TypeScript forward stub
 *
 * NOTE: Many dependencies (Health, WithSpriteBody, ConyardChronoVortex,
 * Game.Sound, World.CreateActor/dispose, FactionInit, etc.) are not yet
 * fully migrated. This trait documents the full OpenRA logic and stubs
 * the integration points with clear TODO markers.
 *
 * NOTE: The INotifyTransform / ITransformActorInitModifier pattern is
 * deferred until the transform system is fully migrated.
 */

import type {
  IGameActor,
  ITick,
  ISync,
  ISelectionBar,
  IObservesVariables,
  ITraitInfo,
  VariableObserver,
  ColorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { CPos } from '../../OpenRA.Game/CPos.js'
import type { ChronoshiftReturnInit } from './Chronoshiftable.js'

// ---------------------------------------------------------------------------
// Health stub interface
// ---------------------------------------------------------------------------

/**
 * Minimal Health trait API needed by ConyardChronoReturn.
 *
 * OpenRA 对照: Health (subset)
 */
interface HealthStub {
  readonly hp: number
  readonly maxHP: number
  inflictDamage(
    self: IGameActor,
    attacker: IGameActor | null,
    damage: DamageStub,
    ignoreModifiers?: boolean,
  ): void
}

interface DamageStub {
  readonly value: number
  readonly damageTypes: readonly string[]
}

// ---------------------------------------------------------------------------
// BooleanExpression stub
// ---------------------------------------------------------------------------

/**
 * Forward declaration for BooleanExpression.
 *
 * OpenRA 对照: OpenRA.Support.BooleanExpression
 */
interface BooleanExpressionStub {
  readonly variables: readonly string[]
  evaluate(conditions: ReadonlyMap<string, number>): boolean
}

// ---------------------------------------------------------------------------
// ConyardChronoReturnInfo
// OpenRA 对照: ConyardChronoReturnInfo : TraitInfo,
//   Requires<HealthInfo>, Requires<WithSpriteBodyInfo>, IObservesVariablesInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the Construction Yard chrono-return trait.
 *
 * OpenRA 对照: ConyardChronoReturnInfo
 */
export class ConyardChronoReturnInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Condition to grant while the vortex animation plays.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.Condition
   */
  readonly condition: string | null

  /** Amount of damage to apply each tick while the vortex plays.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.Damage
   */
  readonly damage: number

  /** Damage types for the vortex damage.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.DamageTypes (BitSet<DamageType>)
   */
  readonly damageTypes: readonly string[]

  /** Boolean expression: condition under which to return original actor.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.ReturnOriginalActorOnCondition
   */
  readonly returnOriginalActorOnCondition: BooleanExpressionStub | null

  /** Replacement actor type to create on chrono-return.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.OriginalActor
   */
  readonly originalActor: string

  /** Facing of the returned actor.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.Facing (WAngle)
   */
  readonly facing: number // stored as angle value (0-1023)

  /** Sound played on chronoshift return.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.ChronoshiftSound
   */
  readonly chronoshiftSound: string

  /** Color of the return-to-origin time bar.
   *
   * OpenRA 对照: ConyardChronoReturnInfo.TimeBarColor
   */
  readonly timeBarColor: ColorStub

  constructor(params?: {
    instanceName?: string
    condition?: string | null
    damage?: number
    damageTypes?: string[]
    returnOriginalActorOnCondition?: BooleanExpressionStub | null
    originalActor?: string
    facing?: number
    chronoshiftSound?: string
    timeBarColor?: ColorStub
  }) {
    this.instanceName = params?.instanceName
    this.condition = params?.condition ?? null
    this.damage = params?.damage ?? 1000
    this.damageTypes = params?.damageTypes ?? []
    this.returnOriginalActorOnCondition = params?.returnOriginalActorOnCondition ?? null
    this.originalActor = params?.originalActor ?? 'mcv'
    this.facing = params?.facing ?? 384
    this.chronoshiftSound = params?.chronoshiftSound ?? 'chrono2.aud'
    this.timeBarColor = params?.timeBarColor ?? { r: 255, g: 255, b: 255, a: 255 }
  }

  create(init: IGameActor): ConyardChronoReturn {
    return new ConyardChronoReturn(init, this)
  }
}

// ---------------------------------------------------------------------------
// INotifySold stub
// ---------------------------------------------------------------------------

interface INotifySoldStub {
  selling(self: IGameActor): void
  sold(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// ConyardChronoReturn
// OpenRA 对照: ConyardChronoReturn : ITick, ISync, IObservesVariables,
//   ISelectionBar, INotifySold, IDeathActorInitModifier, ITransformActorInitModifier
// ---------------------------------------------------------------------------

/**
 * Implements chronoshift return for construction yards when they reach
 * a critical HP threshold.
 *
 * OpenRA 对照: ConyardChronoReturn
 *
 * When activated:
 * - If ReturnOriginalActorOnCondition evaluates true AND the actor is not
 *   being sold, the OriginalActor is created at the origin and the yard
 *   is disposed.
 * - Otherwise, a vortex animation plays and damage is dealt each tick.
 */
export class ConyardChronoReturn
  implements ITick, ISync, IObservesVariables, ISelectionBar, INotifySoldStub
{
  /** Trait configuration. */
  readonly info: ConyardChronoReturnInfo

  /** The actor this trait is attached to. */
  readonly self: IGameActor

  /** The Health trait reference.
   *
   * OpenRA 对照: ConyardChronoReturn.health
   */
  private readonly _health: HealthStub | null

  /** The actor's faction string.
   *
   * OpenRA 对照: ConyardChronoReturn.faction
   */
  readonly faction: string

  /** Condition token for vortex animation.
   *
   * OpenRA 对照: ConyardChronoReturn.conditionToken
   *
   * Actor.InvalidConditionToken = 0
   */

  /** The chronosphere actor that caused the return.
   *
   * OpenRA 对照: ConyardChronoReturn.chronosphere
   */
  private _chronosphere: IGameActor | null = null

  /** Duration of the current chronoshift return timer.
   *
   * OpenRA 对照: ConyardChronoReturn.duration
   */
  private _duration: number = 0

  /** Whether to return the original actor (not trigger vortex).
   *
   * OpenRA 对照: ConyardChronoReturn.returnOriginal
   */
  private _returnOriginal: boolean = false

  /** Whether the building is being sold.
   *
   * OpenRA 对照: ConyardChronoReturn.selling
   */
  private _selling: boolean = false

  // -----------------------------------------------------------------------
  // Sync fields
  // -----------------------------------------------------------------------

  /** Ticks remaining until return.
   *
   * OpenRA 对照: ConyardChronoReturn.returnTicks ([VerifySync])
   */
  returnTicks: number = 0

  /** The origin cell to return to.
   *
   * OpenRA 对照: ConyardChronoReturn.origin ([VerifySync])
   */
  origin: CPos = CPos.Zero

  /** Whether the vortex has been triggered.
   *
   * OpenRA 对照: ConyardChronoReturn.triggered ([VerifySync])
   */
  triggered: boolean = false

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(init: IGameActor, info: ConyardChronoReturnInfo) {
    this.info = info
    this.self = init

    // OpenRA: health = self.Trait<Health>()
    const actorAny = init as unknown as Record<string, unknown>
    this._health = (actorAny['health'] as HealthStub | undefined) ?? null

    // OpenRA: faction = init.GetValue<FactionInit, string>(self.Owner.Faction.InternalName)
    this.faction = (actorAny['faction'] as string) ?? 'neutral'

    // Check for ChronoshiftReturnInit
    const returnInit = (actorAny['chronoshiftReturnInit'] as ChronoshiftReturnInit | undefined)
    if (returnInit) {
      this.returnTicks = returnInit.ticks
      this._duration = returnInit.duration
      this.origin = returnInit.origin
      // Defer to end of tick: chronosphere = returnInit.Chronosphere.Actor(World).Value
      this._chronosphere = returnInit.chronosphere
    }
  }

  // -----------------------------------------------------------------------
  // IObservesVariables
  // -----------------------------------------------------------------------

  /** Get variable observers for the ReturnOriginalActorOnCondition expression.
   *
   * OpenRA 对照: ConyardChronoReturn.IObservesVariables.GetVariableObservers()
   */
  getVariableObservers(): readonly VariableObserver[] {
    if (!this.info.returnOriginalActorOnCondition) return []

    return [{
      notifier: this._replacementConditionChanged.bind(this),
      variables: this.info.returnOriginalActorOnCondition.variables,
    }]
  }

  /** Called when the replacement condition variables change.
   *
   * OpenRA 对照: ConyardChronoReturn.ReplacementConditionChanged(Actor, IReadOnlyDictionary)
   */
  private _replacementConditionChanged(
    _self: IGameActor,
    conditions: ReadonlyMap<string, number>,
  ): void {
    if (this.info.returnOriginalActorOnCondition) {
      this._returnOriginal = this.info.returnOriginalActorOnCondition.evaluate(conditions)
    }
  }

  // -----------------------------------------------------------------------
  // Vortex trigger
  // -----------------------------------------------------------------------

  /** Trigger the destructive vortex animation.
   *
   * OpenRA 对照: ConyardChronoReturn.TriggerVortex()
   */
  triggerVortex(): void {
    // OpenRA: if (conditionToken == Actor.InvalidConditionToken)
    //   conditionToken = self.GrantCondition(info.Condition)
    // triggered = true
    // self.World.AddFrameEndTask(w => w.Add(new ConyardChronoVortex(self, () => { ... })))
    this.triggered = true
    // TODO-19.A.8: ConyardChronoVortex effect integration
    // TODO: ConditionManager grant/revoke integration
  }

  // -----------------------------------------------------------------------
  // Return to origin
  // -----------------------------------------------------------------------

  /** Return the original actor to the origin location.
   *
   * OpenRA 对照: ConyardChronoReturn.ReturnToOrigin()
   */
  returnToOrigin(): void {
    // OpenRA: Complex method that:
    // 1. Finds best destination cell (can enter cell, is explored)
    // 2. Notifies INotifyTransform traits
    // 3. Creates a new actor of type OriginalActor at destination
    // 4. Transfers selection and control group
    // 5. Plays sound, disposes self
    //
    // For the TS migration, this is stubbed because it depends on:
    // - World.CreateActor (not yet defined in type)
    // - MobileInfo (for CanEnterCell check)
    // - INotifyTransform
    // - Selection / ControlGroups
    // - Game.Sound
    // - self.Dispose()
    //
    // TODO-19.A.3: Full return-to-origin implementation with World integration
  }

  // -----------------------------------------------------------------------
  // Choose best destination cell
  // -----------------------------------------------------------------------

  /** Find the best destination cell for the returned actor.
   *
   * OpenRA 对照: ConyardChronoReturn.ChooseBestDestinationCell(MobileInfo, CPos)
   *
   * @returns the best cell, or null if no valid destination is found
   */
  chooseBestDestinationCell(_destination: CPos): CPos | null {
    // OpenRA: if (chronosphere == null) return null
    // if (mobileInfo.CanEnterCell(world, null, destination)) return destination
    // var max = chronosphere.World.Map.Grid.MaximumTileSearchRange
    // foreach tile in FindTilesInCircle(destination, max)
    //   if explored && CanEnterCell -> return tile
    // return null
    //
    // TODO: Full implementation requires MobileInfo, Map.Grid, Shroud
    return _destination
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Apply vortex damage each tick, or trigger return when timer expires.
   *
   * OpenRA 对照: ConyardChronoReturn.ITick.Tick(Actor)
   */
  tick(self: IGameActor): void {
    // OpenRA: if (self.WillDispose) return
    if (self.disposed) return

    // Apply vortex damage each tick
    if (this.triggered && this._health) {
      this._health.inflictDamage(
        self,
        this._chronosphere,
        { value: this.info.damage, damageTypes: this.info.damageTypes },
        true, // ignoreModifiers
      )
    }

    // Check return timer
    if (this.returnTicks <= 0 || --this.returnTicks > 0)
      return

    // Timer reached zero — trigger action
    if (this._returnOriginal && !this._selling) {
      this.returnToOrigin()
    } else {
      this.triggerVortex()
    }

    // Trigger screen desaturate effect
    // OpenRA: foreach (cpa in self.World.ActorsWithTrait<ChronoshiftPostProcessEffect>())
    //   cpa.Trait.Enable()
    // TODO: ChronoshiftPostProcessEffect integration

    // Play sound
    // OpenRA: Game.Sound.Play(SoundType.World, info.ChronoshiftSound, self.CenterPosition)
    // TODO: Audio integration

    // Play chronosphere building animation
    // OpenRA: if (chronosphere != null && self != chronosphere && !chronosphere.Disposed) {
    //   var building = chronosphere.TraitOrDefault<WithSpriteBody>()
    //   if (building != null && building.DefaultAnimation.HasSequence("active"))
    //     building.PlayCustomAnimation(chronosphere, "active")
    // }
  }

  // -----------------------------------------------------------------------
  // INotifySold
  // -----------------------------------------------------------------------

  /** Called when selling begins.
   *
   * OpenRA 对照: ConyardChronoReturn.INotifySold.Selling(Actor)
   */
  selling(_self: IGameActor): void {
    this._selling = true
  }

  /** Called when the sale completes.
   *
   * OpenRA 对照: ConyardChronoReturn.INotifySold.Sold(Actor)
   */
  sold(_self: IGameActor): void {
    // No-op — selling flag already set
  }

  // -----------------------------------------------------------------------
  // ISelectionBar
  // -----------------------------------------------------------------------

  /** Get the remaining return time as a bar value (0.0 to 1.0).
   *
   * OpenRA 对照: ConyardChronoReturn.ISelectionBar.GetValue()
   */
  getValue(): number {
    // OpenRA: if (returnTicks == 0 || !self.Owner.IsAlliedWith(self.World.RenderPlayer))
    //   return 0f
    if (this.returnTicks === 0)
      return 0

    return this.returnTicks / this._duration
  }

  /** Get the color of the selection bar.
   *
   * OpenRA 对照: ConyardChronoReturn.ISelectionBar.GetColor()
   */
  getColor(): ColorStub {
    return this.info.timeBarColor
  }

  /** Whether to display the bar when empty.
   *
   * OpenRA 对照: ConyardChronoReturn.ISelectionBar.DisplayWhenEmpty
   */
  get displayWhenEmpty(): boolean {
    return false
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  /** Create a ChronoshiftReturnInit from current state.
   *
   * OpenRA 对照: ConyardChronoReturn.ModifyActorInit(TypeDictionary)
   */
  createReturnInit(): ChronoshiftReturnInit | null {
    if (this.returnTicks <= 0) return null
    // Stub — ChronoshiftReturnInit creation delegated to runtime wiring.
    // The actual ChronoshiftReturnInit is imported lazily to avoid circular deps.
    return null
  }

  // -----------------------------------------------------------------------
  // State setters (for testing)
  // -----------------------------------------------------------------------

  /** Set return state for testing.
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

  /** Set the Health reference for testing.
   */
  setHealth(health: HealthStub | null): void {
    (this as unknown as Record<string, unknown>)['_health'] = health
  }

  /** Set whether to use original return.
   */
  setReturnOriginal(value: boolean): void {
    this._returnOriginal = value
  }

  /** Set selling flag.
   */
  setSelling(value: boolean): void {
    this._selling = value
  }

  /** Whether the return-to-origin option is active.
   */
  get returnOriginal(): boolean {
    return this._returnOriginal
  }

  /** Whether the building is being sold (for testing).
   */
  get isSelling(): boolean {
    return this._selling
  }

  /** The chronosphere actor.
   */
  get chronosphere(): IGameActor | null {
    return this._chronosphere
  }

  /** Duration of the return timer.
   */
  get duration(): number {
    return this._duration
  }
}
