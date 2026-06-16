/**
 * Enter.ts — 进入目标 Actor 的抽象基类（4 状态状态机）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Enter.cs
 *
 * 核心范式转换:
 * - C# abstract Enter class with enum EnterState → TypeScript abstract class with string-union state
 * - C# IMove trait access → duck-typed IMove interface
 * - C# MoveCooldownHelper → reuse existing MoveCooldownHelper.ts
 * - C# Target.Recalculate() → Target.recalculate() (already migrated)
 * - C# ChildHasPriority = false → TypeScript childHasPriority = false
 *
 * NOTE: This is a MINIMAL implementation for Phase B (Combat Activities).
 * Full Enter with Cargo/Passenger transport logic is Phase E.
 * CaptureActor and Demolish extend this minimal base.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.js'
import type { Mobile } from '../Traits/Mobile.js'

// ---------------------------------------------------------------------------
// EnterBehaviour enum (对应 OpenRA EnterBehaviour)
// ---------------------------------------------------------------------------

/**
 * What happens to the entering actor after entering completes.
 *
 * OpenRA 对照: EnterBehaviour { Exit, Suicide, Dispose }
 */
export const EnterBehaviour = {
  Exit: 0,
  Suicide: 1,
  Dispose: 2,
} as const
export type EnterBehaviour = (typeof EnterBehaviour)[keyof typeof EnterBehaviour]

// ---------------------------------------------------------------------------
// EnterState enum (对应 OpenRA Enter.EnterState)
// ---------------------------------------------------------------------------

/**
 * The four states of the Enter state machine.
 *
 * OpenRA 对照: Enter.EnterState { Approaching, Entering, Exiting, Finished }
 */
export const EnterState = {
  Approaching: 0,
  Entering: 1,
  Exiting: 2,
  Finished: 3,
} as const
export type EnterState = (typeof EnterState)[keyof typeof EnterState]

// ---------------------------------------------------------------------------
// Enter (abstract base)
// ---------------------------------------------------------------------------

/**
 * Abstract base class for activities that enter a target actor.
 *
 * OpenRA 对照: Enter abstract class
 *
 * Implements a 4-state state machine:
 *   Approaching → move to target actor
 *   Entering    → move into target actor's cell
 *   Exiting     → return to own cell
 *   Finished    → complete
 *
 * Subclasses override:
 * - `tickInner()`: called early each tick to update state / cancel if needed
 * - `tryStartEnter()`: called when ready to enter; return true to proceed
 * - `onEnterComplete()`: called after successfully entering the target
 *
 * NOTE: Minimal Phase B version. Does NOT include Cargo/Passenger logic.
 * TODO-14.E.1: Full Enter with transport support in Phase E.
 */
export abstract class Enter extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** The target actor to enter. */
  protected target: Target

  /** The last known visible position of the target (for fallback movement). */
  protected lastVisibleTarget: Target

  /** Whether to use lastVisibleTarget instead of the current target. */
  protected useLastVisibleTarget: boolean = false

  /** Current state in the Enter state machine. */
  protected lastState: EnterState = EnterState.Approaching

  /** Color for target line rendering. */
  protected readonly targetLineColor: ColorStub | null

  /** Duck-typed IMove trait reference. */
  protected readonly move: {
    moveToTarget(source: GameActor, target: Target, initialTargetPosition: WPos): Activity
    moveIntoTarget(source: GameActor, target: Target): Activity
    returnToCell(source: GameActor): Activity
    canEnterTargetNow(source: GameActor, target: Target): boolean
  } | null

  /** Move cooldown helper for retry logic. */
  protected readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create an Enter activity.
   *
   * OpenRA 对照: Enter(Actor, Target, Color?)
   *
   * @param self — the actor performing the enter
   * @param target — the target to enter
   * @param targetLineColor — optional color for target line rendering
   */
  constructor(self: GameActor, target: Target, targetLineColor: ColorStub | null = null) {
    super()
    this.target = target
    this.targetLineColor = targetLineColor
    this.lastVisibleTarget = Target.Invalid
    this.childHasPriority = false

    // Resolve IMove trait
    const actorAny = self as unknown as {
      traits?: Map<string, unknown>
      world?: { sharedRandom?: { next(): number } }
    }
    this.move = (actorAny.traits?.get('Mobile') ?? actorAny.traits?.get('Aircraft') ?? null) as Enter['move']

    // Resolve Mobile for MoveCooldownHelper
    const mobile = actorAny.traits?.get('Mobile') ?? null
    this.moveCooldownHelper = new MoveCooldownHelper(
      actorAny.world ?? null,
      mobile as Mobile | null,
    )
    this.moveCooldownHelper.retryIfDestinationBlocked = true
  }

  // ---------------------------------------------------------------------------
  // Abstract hooks for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Called early in the activity tick to allow subclasses to update state.
   * Call cancel(self, true) if it is no longer valid to enter.
   *
   * OpenRA 对照: Enter.TickInner(Actor, Target, bool)
   *
   * @param _self — the actor performing this activity
   * @param _target — the current target
   * @param _targetIsDeadOrHiddenActor — whether the target is dead or hidden
   */
  protected tickInner(_self: GameActor, _target: Target, _targetIsDeadOrHiddenActor: boolean): void {
    // Default: no-op. Subclasses override.
  }

  /**
   * Called when the actor is ready to transition from approaching to entering.
   * Return true to start entering, or false to wait.
   * Call cancel(self, true) before returning false if it is no longer valid to enter.
   *
   * OpenRA 对照: Enter.TryStartEnter(Actor, Actor)
   *
   * @param _self — the actor performing this activity
   * @param _targetActor — the target actor to enter
   * @returns true to proceed with entering, false to wait
   */
  protected tryStartEnter(_self: GameActor, _targetActor: GameActor): boolean {
    return true
  }

  /**
   * Called when the actor has successfully entered the target actor.
   *
   * OpenRA 对照: Enter.OnEnterComplete(Actor, Actor)
   *
   * @param _self — the actor performing this activity
   * @param _targetActor — the target actor that was entered
   */
  protected onEnterComplete(_self: GameActor, _targetActor: GameActor): void {
    // Default: no-op. Subclasses override.
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Main tick implementing the 4-state Enter state machine.
   *
   * OpenRA 对照: Enter.Tick(Actor)
   *
   * State machine:
   * 1. Update target visibility
   * 2. TickInner (subclass hook)
   * 3. Tick child (if any)
   * 4. MoveCooldownHelper check
   * 5. State transition based on lastState
   *
   * @param self — the actor performing this activity
   * @returns true if complete, false to continue
   */
  override tick(self: GameActor): boolean {
    // Update our view of the target
    const [recalculatedTarget, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculatedTarget

    if (!targetIsHiddenActor && this.target.type === TargetType.Actor) {
      this.lastVisibleTarget = Target.fromTargetPositions(this.target)
    }

    this.useLastVisibleTarget = targetIsHiddenActor || !this.target.isValidFor(self as unknown as never)

    // Cancel immediately if the target died while we were entering it
    if (!this.isCanceling && this.useLastVisibleTarget && this.lastState === EnterState.Entering) {
      this.cancel(self, true)
    }

    // Subclass hook for state updates
    this.tickInner(self, this.target, this.useLastVisibleTarget)

    // We need to wait for movement to finish before transitioning
    if (!this.tickChild(self)) return false

    // Move cooldown helper check
    const cooldownResult = this.moveCooldownHelper.tick(targetIsHiddenActor)
    if (cooldownResult !== null) return cooldownResult

    // State machine based on what we just finished doing
    switch (this.lastState) {
      case EnterState.Approaching:
        return this.tickApproaching(self)
      case EnterState.Entering:
        return this.tickEntering(self)
      case EnterState.Exiting:
        return this.tickExiting(self)
      case EnterState.Finished:
        return true
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // State handlers
  // ---------------------------------------------------------------------------

  private tickApproaching(self: GameActor): boolean {
    // We can safely cancel here because we know the actor has finished any in-progress move
    if (this.isCanceling) return true

    // Lost track of the target
    if (this.useLastVisibleTarget && this.lastVisibleTarget.type === TargetType.Invalid)
      return true

    // We are not next to the target — let's fix that
    if (this.target.type !== TargetType.Invalid && this.move !== null &&
        !this.move.canEnterTargetNow(self, this.target)) {
      this.moveCooldownHelper.notifyMoveQueued()
      const initialTargetPosition = (this.useLastVisibleTarget ? this.lastVisibleTarget : this.target).centerPosition
      this.queueChild(this.move.moveToTarget(self, this.target, initialTargetPosition))
      return false
    }

    // We are next to where we thought the target should be, but it isn't here
    if (this.useLastVisibleTarget || this.target.type !== TargetType.Actor)
      return true

    // Are we ready to move into the target?
    if (this.tryStartEnter(self, this.target.actor as unknown as GameActor)) {
      this.moveCooldownHelper.notifyMoveQueued()
      this.lastState = EnterState.Entering
      if (this.move !== null) {
        this.queueChild(this.move.moveIntoTarget(self, this.target))
      }
      return false
    }

    // Subclasses can cancel during TryStartEnter
    if (this.isCanceling) return true

    return false
  }

  private tickEntering(self: GameActor): boolean {
    // Check that we reached the requested position
    const targetPos = this.target.positions.length > 0
      ? this.target.positions[0]
      : this.target.centerPosition
    const selfPos = (self as unknown as { centerPosition?: { X: number; Y: number; Z: number } }).centerPosition
    const reached = selfPos !== undefined &&
      selfPos.X === targetPos.X && selfPos.Y === targetPos.Y && selfPos.Z === targetPos.Z

    if (!this.isCanceling && reached && this.target.type === TargetType.Actor) {
      this.onEnterComplete(self, this.target.actor as unknown as GameActor)
    }

    this.lastState = EnterState.Exiting
    return false
  }

  private tickExiting(self: GameActor): boolean {
    this.moveCooldownHelper.notifyMoveQueued()
    if (this.move !== null) {
      this.queueChild(this.move.returnToCell(self))
    }
    this.lastState = EnterState.Finished
    return false
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: Enter.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      const t = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
      if (t.type !== TargetType.Invalid) {
        return [new TargetLineNode(t, this.targetLineColor)]
      }
    }
    return []
  }
}
