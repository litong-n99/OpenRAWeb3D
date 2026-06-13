/**
 * WithAttackAnimation.ts -- Custom sprite body animation during attack
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.cs (96 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<Info>, ITick, INotifyAttack → TS ConditionalTrait<Info>
 * - C# WithSpriteBody.PlayCustomAnimation() → TS duck-typed playCustomAnimation
 * - C# AttackDelayType → TS AttackDelayType from CombatInterfaces
 * - C# Armament name matching → TS duck-typed armament.info.name
 *
 * NOTE: WithSpriteBody is NOT yet migrated (deferred to Chapter 14).
 *   We provide a duck-typed interface for playCustomAnimation().
 *   TODO-8.E.SPRITEBODY: Full WithSpriteBody trait migration deferred.
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  AttackDelayType,
  type AttackDelayType as AttackDelayTypeEnum,
  type INotifyAttack,
  type Barrel,
} from '../CombatInterfaces.js'
import type { Target } from '../../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// WithSpriteBody duck-type interface
// OpenRA 对照: WithSpriteBody (not yet migrated)
//
// TODO-8.E.SPRITEBODY: Replace with actual WithSpriteBody class in Chapter 14.
// ---------------------------------------------------------------------------

/** Duck-typed interface for WithSpriteBody trait.
 *
 *  OpenRA 对照: WithSpriteBody
 *
 *  Only the methods needed by WithAttackAnimation are exposed.
 */
export interface IWithSpriteBody {
  readonly isTraitDisabled: boolean
  readonly info: { readonly name: string }
  playCustomAnimation?(self: IGameActor, sequence: string): void
}

// ---------------------------------------------------------------------------
// WithAttackAnimationInfo
// OpenRA 对照: WithAttackAnimationInfo (ConditionalTraitInfo, Requires<WithSpriteBodyInfo>, Requires<ArmamentInfo>, Requires<AttackBaseInfo>)
// ---------------------------------------------------------------------------

/** Configuration for WithAttackAnimation trait.
 *
 *  OpenRA 对照: WithAttackAnimationInfo
 */
export class WithAttackAnimationInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Armament name to match.
   *
   *  OpenRA 对照: WithAttackAnimationInfo.Armament (default "primary")
   */
  readonly armament: string = 'primary'

  /** Sequence to display while attacking.
   *
   *  OpenRA 对照: WithAttackAnimationInfo.Sequence
   */
  readonly sequence: string | null = null

  /** Delay in ticks before animation starts.
   *
   *  OpenRA 对照: WithAttackAnimationInfo.Delay (default 0)
   */
  readonly delay: number = 0

  /** Should the animation be delayed relative to preparation or actual attack?
   *
   *  OpenRA 对照: WithAttackAnimationInfo.DelayRelativeTo (default AttackDelayType.Preparation)
   */
  readonly delayRelativeTo: AttackDelayTypeEnum = AttackDelayType.Preparation

  /** Which sprite body to modify.
   *
   *  OpenRA 对照: WithAttackAnimationInfo.Body (default "body")
   */
  readonly body: string = 'body'

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    armament?: string
    sequence?: string | null
    delay?: number
    delayRelativeTo?: AttackDelayTypeEnum
    body?: string
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.armament = params.armament ?? 'primary'
    this.sequence = params.sequence ?? null
    this.delay = params.delay ?? 0
    this.delayRelativeTo = params.delayRelativeTo ?? AttackDelayType.Preparation
    this.body = params.body ?? 'body'
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// WithAttackAnimation
// OpenRA 对照: WithAttackAnimation (ConditionalTrait<Info>, ITick, INotifyAttack)
// ---------------------------------------------------------------------------

/** Triggers a custom animation on a WithSpriteBody when the actor attacks.
 *
 *  OpenRA 对照: WithAttackAnimation
 */
export class WithAttackAnimation
  extends ConditionalTrait<WithAttackAnimationInfo>
  implements ITick, INotifyAttack
{
  /** The matched armament.
   *
   *  OpenRA 对照: WithAttackAnimation.armament
   */
  armament: unknown | null = null

  /** The matched WithSpriteBody.
   *
   *  OpenRA 对照: WithAttackAnimation.wsb
   *
   *  TODO-8.E.SPRITEBODY: Duck-typed until WithSpriteBody is migrated.
   */
  wsb: IWithSpriteBody | null = null

  /** Delay countdown timer.
   *
   *  OpenRA 对照: WithAttackAnimation.tick
   */
  private tickCount: number = 0

  constructor(info: WithAttackAnimationInfo) {
    super(info)
  }

  /** Initialize references after creation.
   *
   *  OpenRA 对照: WithAttackAnimation constructor body
   *
   *  @param armament — the matched Armament trait
   *  @param wsb — the matched WithSpriteBody trait
   */
  init(armament: unknown, wsb: IWithSpriteBody): void {
    this.armament = armament
    this.wsb = wsb
  }

  // -----------------------------------------------------------------------
  // INotifyAttack
  // -----------------------------------------------------------------------

  /** Called before attack preparation.
   *
   *  OpenRA 对照: INotifyAttack.PreparingAttack()
   */
  preparingAttack(
    _self: IGameActor,
    _target: Target,
    a: unknown,
    _barrel: Barrel,
  ): void {
    if (a === this.armament && this.info.delayRelativeTo === AttackDelayType.Preparation) {
      if (this.info.delay > 0) {
        this.tickCount = this.info.delay
      } else {
        this.playAttackAnimation(_self)
      }
    }
  }

  /** Called when the actual attack fires.
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    self: IGameActor,
    _target: Target,
    a: unknown,
    _barrel: Barrel,
  ): void {
    if (a === this.armament && this.info.delayRelativeTo === AttackDelayType.Attack) {
      if (this.info.delay > 0) {
        this.tickCount = this.info.delay
      } else {
        this.playAttackAnimation(self)
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick: countdown delay, trigger animation on expiry.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(self: IGameActor): void {
    if (this.info.delay > 0 && --this.tickCount === 0) {
      this.playAttackAnimation(self)
    }
  }

  // -----------------------------------------------------------------------
  // Animation playback
  // -----------------------------------------------------------------------

  /** Play the attack animation on the matched sprite body.
   *
   *  OpenRA 对照: WithAttackAnimation.PlayAttackAnimation(Actor self)
   *
   *  @param self — the actor
   */
  private playAttackAnimation(self: IGameActor): void {
    if (
      !this.isTraitDisabled &&
      this.wsb &&
      !this.wsb.isTraitDisabled &&
      this.info.sequence !== null &&
      this.info.sequence !== '' &&
      this.wsb.playCustomAnimation
    ) {
      this.wsb.playCustomAnimation(self, this.info.sequence)
    }
  }
}
