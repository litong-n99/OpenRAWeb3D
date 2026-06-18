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
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import {
  AttackFrontal,
  AttackFrontalInfo,
} from '../../OpenRA.Mods.Common/Traits/Attack/AttackFrontal'
import { AttackSource, type AttackBase } from '../../OpenRA.Mods.Common/Traits/Attack/AttackBase'
import type { Armament } from '../../OpenRA.Mods.Common/Traits/Armament'
import { SwallowActor } from '../Activities/SwallowActor'
import type { Sandworm } from './Sandworm'
import { Attack } from '../../OpenRA.Mods.Common/Activities/Attack.js'

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
      self as unknown as GameActor,
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
   * OpenRA 对照: new SwallowActor(self, target, a, facing)
   *
   * Resolves the facing and sandworm traits from self to construct
   * the full SwallowActor activity. Import is safe because
   * SwallowActor uses `import type { AttackSwallow }` (no runtime circular dep).
   */
  private createSwallowActor(
    self: IGameActor,
    target: Target,
    armament: Armament,
  ): unknown {
    const facing = this.resolveFacing(self)
    const sandworm = this.resolveSandworm(self)
    // Sandworm trait is required (Required<TraitInfo<SandwormInfo>> in C#)
    // Fallback to a minimal stub only if the trait system is not yet wired
    const worm = sandworm ?? {
      isAttacking: false,
      wormInfo: { chanceToDisappear: 100 },
    } as unknown as Sandworm
    return new SwallowActor(
      self,
      target,
      armament,
      facing,
      this,
      worm,
    )
  }

  /** Resolve the IFacing trait from the actor. */
  private resolveFacing(self: IGameActor): unknown {
    const fn = (self as unknown as { trait?: <T>(name: string) => T | undefined }).trait
    return fn?.<unknown>('IFacing') ?? null
  }

  /** Resolve the Sandworm trait from the actor. */
  private resolveSandworm(self: IGameActor): Sandworm | null {
    const fn = (self as unknown as { trait?: <T>(name: string) => T | undefined }).trait
    return fn?.<Sandworm>('Sandworm') ?? null
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
 * Extends the full Attack activity which handles approach, movement,
 * turning toward target, and attack orchestration. Overrides:
 * - RecalculateTarget: worms ignore visibility
 * - DoAttack: delegates to AttackSwallow.DoAttack for swallow-specific logic
 *
 * NOTE: Worms ignore visibility, so don't need to recalculate targets.
 */
export class SwallowTarget extends Attack {
  /** The AttackSwallow trait that owns this activity. */
  private readonly _attackSwallow: AttackFrontal

  /** The target to swallow. */
  private readonly _swallowTarget: Target

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SwallowTarget(Actor self, in Target target, bool allowMovement, bool forceAttack) : base(self, target, allowMovement, forceAttack)
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
    self: GameActor,
    target: Target,
    allowMovement: boolean,
    forceAttack: boolean,
  ) {
    super(self, target, allowMovement, forceAttack)
    this._attackSwallow = attack
    this._swallowTarget = target
  }

  // ---------------------------------------------------------------------------
  // RecalculateTarget
  // OpenRA 对照: SwallowTarget.RecalculateTarget → targetIsHiddenActor = false
  // ---------------------------------------------------------------------------

  /** Worms ignore visibility, so no target recalculation needed.
   *
   * OpenRA 对照: SwallowTarget.RecalculateTarget(Actor, out bool) [override]
   *
   * @returns [original target, false (target is never hidden)]
   */
  protected override recalculateTarget(_self: GameActor): [Target, boolean] {
    // NOTE: Worms ignore visibility, so don't need to recalculate targets
    return [this._swallowTarget, false]
  }

  // ---------------------------------------------------------------------------
  // DoAttack
  // OpenRA 对照: SwallowTarget.DoAttack → attack.DoAttack(self, target)
  // ---------------------------------------------------------------------------

  /** Delegate to AttackSwallow's DoAttack for swallow-specific logic.
   *
   * OpenRA 对照: SwallowTarget.DoAttack(Actor, AttackFrontal, IEnumerable<Armament>) [override]
   *
   * @param self — the actor
   * @param _attack — the attack trait (unused; we use our specific swallow attack)
   * @param _armaments — selected armaments (unused; AttackSwallow handles this)
   */
  protected override doAttack(
    self: GameActor,
    _attack: AttackBase,
    _armaments: Armament[],
  ): void {
    this._attackSwallow.doAttack(
      self as unknown as IGameActor,
      this._swallowTarget,
    )
  }
}
