/**
 * AttackSwallow.ts — 沙虫吞食攻击 (特殊的 AttackFrontal 变体)
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/AttackSwallow.cs (99 lines)
 *
 * 核心范式转换:
 * - C# AttackSwallowInfo : AttackFrontalInfo → TS AttackSwallowInfo extends AttackFrontalInfo
 * - C# AttackSwallow : AttackFrontal → TS AttackSwallow extends AttackFrontal
 * - C# DoAttack queues SwallowActor activity → TS same pattern
 * - C# nested SwallowTarget : Attack → TS inner class SwallowTarget (stub
 *   since Attack activity is deferred — TODO-8.D.ATTACKFRONTAL-ACT)
 * - 3D: swallow = target mesh moves toward Sandworm mouth, scales down, vanishes
 */

import { Target, TargetType } from '../../OpenRA.Game/Traits/Target'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import {
  AttackFrontal,
  AttackFrontalInfo,
} from '../../OpenRA.Mods.Common/Traits/Attack/AttackFrontal'
import { AttackSource } from '../../OpenRA.Mods.Common/Traits/Attack/AttackBase'
import type { Armament } from '../../OpenRA.Mods.Common/Traits/Armament'

// ---------------------------------------------------------------------------
// AttackSwallowInfo
// OpenRA 对照: AttackSwallowInfo : AttackFrontalInfo
// ---------------------------------------------------------------------------

/** Configuration for the AttackSwallow trait.
 *
 * OpenRA 对照: AttackSwallowInfo (sealed class, extends AttackFrontalInfo)
 *
 * Configures the Sandworm's swallow attack timing, sounds, and
 * attacking condition.
 */
export class AttackSwallowInfo extends AttackFrontalInfo {
  /** The number of ticks it takes to return underground.
   *
   * OpenRA 对照: AttackSwallowInfo.ReturnDelay (default 60)
   */
  readonly returnDelay: number

  /** The number of ticks it takes to get in place under the target to attack.
   *
   * OpenRA 对照: AttackSwallowInfo.AttackDelay (default 30)
   */
  readonly attackDelay: number

  /** The condition to grant to self while attacking.
   *
   * OpenRA 对照: AttackSwallowInfo.AttackingCondition (default null)
   */
  readonly attackingCondition: string | null

  /** The sound played when the worm attacks.
   *
   * OpenRA 对照: AttackSwallowInfo.WormAttackSound (default "WORM.WAV")
   */
  readonly wormAttackSound: string

  /** Speech notification prefix for worm attack.
   *
   * OpenRA 对照: AttackSwallowInfo.WormAttackNotification (default "WormAttack")
   */
  readonly wormAttackNotification: string

  /** Text notification key for worm attack.
   *
   * OpenRA 对照: AttackSwallowInfo.WormAttackTextNotification (default "notification-worm-attack")
   */
  readonly wormAttackTextNotification: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    armaments?: string[]
    returnDelay?: number
    attackDelay?: number
    attackingCondition?: string | null
    wormAttackSound?: string
    wormAttackNotification?: string
    wormAttackTextNotification?: string
  } = {}) {
    super(params)
    this.returnDelay = params.returnDelay ?? 60
    this.attackDelay = params.attackDelay ?? 30
    this.attackingCondition = params.attackingCondition ?? null
    this.wormAttackSound = params.wormAttackSound ?? 'WORM.WAV'
    this.wormAttackNotification = params.wormAttackNotification ?? 'WormAttack'
    this.wormAttackTextNotification = params.wormAttackTextNotification ?? 'notification-worm-attack'
  }
}

// ---------------------------------------------------------------------------
// AttackSwallow
// OpenRA 对照: AttackSwallow : AttackFrontal
// ---------------------------------------------------------------------------

/** Sandworm swallow attack: approaches target, emerges, swallows, submerges.
 *
 * OpenRA 对照: AttackSwallow (sealed class, extends AttackFrontal)
 *
 * Overrides DoAttack to queue a SwallowActor activity instead of the
 * default AttackFrontal burst-fire behavior. Also overrides
 * GetAttackActivity to produce a SwallowTarget activity for auto-targeting.
 */
export class AttackSwallow extends AttackFrontal {
  /** Strongly-typed info shortcut.
   *
   * OpenRA 对照: AttackSwallow.Info (new readonly AttackSwallowInfo)
   */
  declare readonly info: AttackSwallowInfo

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: AttackSwallow(Actor self, AttackSwallowInfo info) : base(self, info)
  // ---------------------------------------------------------------------------

  /** Create a new AttackSwallow trait.
   *
   * OpenRA 对照: AttackSwallow(Actor self, AttackSwallowInfo info)
   *
   * @param self — the actor that owns this trait
   * @param info — trait configuration
   */
  constructor(self: IGameActor, info: AttackSwallowInfo) {
    super(info)
    // Call inherited onCreated
    this.onCreated(self)
  }

  // ---------------------------------------------------------------------------
  // DoAttack
  // OpenRA 对照: AttackSwallow.DoAttack(Actor self, in Target target) [override]
  // ---------------------------------------------------------------------------

  /** Queue a SwallowActor activity to swallow the target.
   *
   * OpenRA 对照: AttackSwallow.DoAttack(Actor self, in Target target)
   *
   * Validates the target, selects an armament, checks range,
   * then queues the SwallowActor activity.
   *
   * @param self — the actor
   * @param target — the target to swallow
   */
  override doAttack(self: IGameActor, target: Target): void {
    // This is so that the worm does not launch an attack against a target
    // that has reached solid rock
    if (target.type !== TargetType.Actor || !this.canAttack(self, target)) {
      this.cancelActivity(self)
      return
    }

    const armaments = this.chooseArmamentsForTarget(target, true)
    const a = armaments.length > 0 ? armaments[0] : null
    if (!a) return

    const centerPos = (self as unknown as { centerPosition?: { X: number; Y: number; Z: number } }).centerPosition
      ?? { X: 0, Y: 0, Z: 0 }
    const wPos = centerPos as import('../../OpenRA.Game/WPos').WPos
    if (!target.isInRange(wPos, a.maxRange())) return

    // NOTE: queueActivity takes one argument (the activity).
    // C# QueueActivity(false, activity) → TS queueActivity(activity)
    const swallowActivity = this.createSwallowActor(self, target, a)
    self.queueActivity?.(swallowActivity as never)
  }

  // ---------------------------------------------------------------------------
  // GetAttackActivity
  // OpenRA 对照: AttackSwallow.GetAttackActivity(..., AttackSource, Target, bool, bool, Color?)
  // ---------------------------------------------------------------------------

  /** Create a SwallowTarget activity for auto-targeting.
   *
   * OpenRA 对照: AttackSwallow.GetAttackActivity(...) → new SwallowTarget(...)
   *
   * @param self — the actor
   * @param _source — attack source (Default, AutoTarget, or AttackMove)
   * @param target — the target
   * @param allowMove — whether movement is allowed
   * @param forceAttack — whether force-fire
   * @param _targetLineColor — optional target line color
   * @returns a SwallowTarget activity
   */
  override getAttackActivity(
    self: IGameActor,
    _source: AttackSource,
    target: Target,
    allowMove: boolean,
    forceAttack: boolean,
    _targetLineColor?: string,
  ): unknown {
    return new SwallowTarget(
      this,
      self,
      target,
      allowMove,
      forceAttack,
    )
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Cancel the actor's current activity. */
  private cancelActivity(self: IGameActor): void {
    ;(self as unknown as { cancelActivity?: () => void }).cancelActivity?.()
  }

  /** Create a SwallowActor activity instance.
   *
   * NOTE: Creates the SwallowActor class — deferred import to avoid
   * circular dependency. The SwallowActor module imports AttackSwallow.
   */
  private createSwallowActor(
    _self: IGameActor,
    _target: Target,
    _armament: Armament,
  ): unknown {
    // Returns a SwallowActor-like object (duck-typed to avoid
    // hard import of SwallowActor which creates a circular dependency).
    // The SwallowActor is activated by the activity system via queueActivity.
    // NOTE: Full SwallowActor integration requires importing from
    // Activities/SwallowActor — deferred to avoid circular deps.
    return {
      tick: () => false,
      cancel: () => {},
      queue: () => {},
      onActorDisposeOuter: () => {},
    }
  }
}

// ---------------------------------------------------------------------------
// SwallowTarget — inner activity class
// OpenRA 对照: AttackSwallow.SwallowTarget : Attack
// ---------------------------------------------------------------------------

/** Activity that moves toward a target for swallow attack.
 *
 * OpenRA 对照: AttackSwallow.SwallowTarget (inner sealed class, extends Attack)
 *
 * Simplified stub — full Attack activity (turning, movement toward target,
 * then calling DoAttack) is deferred (TODO-8.D.ATTACKFRONTAL-ACT).
 * This stub calls DoAttack directly when the actor is ready.
 *
 * NOTE: Worms ignore visibility, so don't need to recalculate targets.
 */
export class SwallowTarget {
  /** The AttackSwallow trait that owns this activity. */
  private readonly _attack: AttackFrontal

  /** The actor performing the attack. */
  private readonly _self: IGameActor

  /** The target to swallow. */
  private readonly _target: Target

  /** Cancel guard. */
  private _isCanceling: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SwallowTarget(Actor, Target, bool allowMovement, bool forceAttack)
  // ---------------------------------------------------------------------------

  /** Create a SwallowTarget activity.
   *
   * OpenRA 对照: new AttackSwallow.SwallowTarget(self, target, allowMovement, forceAttack)
   *
   * @param attack — the attack swallow trait
   * @param self — the actor
   * @param target — the target to swallow
   * @param allowMovement — whether movement toward target is allowed
   * @param forceAttack — whether force-fire
   */
  constructor(
    attack: AttackFrontal,
    self: IGameActor,
    target: Target,
    _allowMovement: boolean,
    _forceAttack: boolean,
  ) {
    this._attack = attack
    this._self = self
    this._target = target
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: Attack.Tick(Actor)
  // ---------------------------------------------------------------------------

  /** Execute one tick of the activity.
   *
   * OpenRA 对照: Attack.Tick(Actor)
   *
   * Worms ignore visibility, so target recalculation is not needed.
   * Calls DoAttack directly when the actor is ready.
   *
   * @returns true if the activity is complete
   */
  tick(_self: IGameActor): boolean {
    if (this._isCanceling || !this._target.isValidFor(this._self as unknown as never)) {
      return true
    }

    this._attack.doAttack(this._self, this._target)
    return false
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /** Cancel this activity. */
  cancel(): void {
    this._isCanceling = true
  }

  /** Queue a follow-up activity. */
  queue(_activity: unknown): void { /* no-op */ }

  /** Handle actor disposal. */
  onActorDisposeOuter(_actor: IGameActor): void { /* no-op */ }
}
