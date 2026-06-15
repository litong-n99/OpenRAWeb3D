/**
 * WithSupportPowerActivationAnimation.ts — 支援能力激活时替换建筑动画
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.cs (53 lines)
 *
 * 核心范式转换:
 * - C# WithSpriteBody.PlayCustomAnimation() → TS duck-typed IWithSpriteBody
 * - C# CancelCustomAnimation via Action callback → TS duck-typed cancelCustomAnimation
 * - C# TraitsImplementing<WithSpriteBody>().Single() → TS trait lookup
 * - C# ConditionalTrait<Info>, INotifySupportPower → TS implement both
 *
 * NOTE: WithSpriteBody is NOT fully migrated (deferred to Chapter 14).
 *   Uses the same duck-typed IWithSpriteBody pattern as WithAttackAnimation.
 *
 * RENDER: playCustomAnimation() triggers a Babylon.js animation override
 * (sprite frame swap at 25fps via the Animation class from Ch2).
 * The CancelCustomAnimation callback restores the default animation loop.
 *
 * TODO-13.A.12: WithSupportPowerActivationAnimation migration
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifySupportPower,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IWithSpriteBody — duck-typed forward reference
// OpenRA 对照: WithSpriteBody (not yet migrated)
//
// TODO-14.SPRITEBODY: Replace with actual WithSpriteBody class when migrated.
// ---------------------------------------------------------------------------

/** Duck-typed interface for WithSpriteBody trait.
 *
 * OpenRA 对照: WithSpriteBody
 *
 * Only the methods needed by WithSupportPowerActivationAnimation are exposed.
 */
export interface IWithSpriteBody {
  /** The trait's configuration info. */
  readonly info: { readonly name: string }

  /** Play a custom animation sequence on the sprite body.
   *
   * OpenRA 对照: WithSpriteBody.PlayCustomAnimation(Actor, string, Action?)
   *
   * @param self — the actor
   * @param sequence — the animation sequence name
   * @param onComplete — callback invoked when the custom animation completes
   */
  playCustomAnimation(
    self: IGameActor,
    sequence: string,
    onComplete?: () => void,
  ): void

  /** Cancel a custom animation and restore the default animation loop.
   *
   * OpenRA 对照: WithSpriteBody.CancelCustomAnimation(Actor)
   *
   * @param self — the actor
   */
  cancelCustomAnimation(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// WithSupportPowerActivationAnimationInfo
// OpenRA 对照: WithSupportPowerActivationAnimationInfo : ConditionalTraitInfo, Requires<WithSpriteBodyInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithSupportPowerActivationAnimation.
 *
 * OpenRA 对照: WithSupportPowerActivationAnimationInfo
 *
 * Defines which sequence to play and which sprite body to animate
 * when the support power is activated.
 */
export interface WithSupportPowerActivationAnimationInfo
  extends ConditionalTraitInfo {
  /** Sequence name to use (default "active").
   *
   * OpenRA 对照: WithSupportPowerActivationAnimationInfo.Sequence
   */
  readonly sequence: string

  /** Which sprite body to play the animation on (default "body").
   *
   * OpenRA 对照: WithSupportPowerActivationAnimationInfo.Body
   */
  readonly body: string
}

/** Default values for WithSupportPowerActivationAnimationInfo. */
export const DEFAULT_ACTIVATION_ANIMATION_INFO: WithSupportPowerActivationAnimationInfo =
  {
    sequence: 'active',
    body: 'body',
  }

// ---------------------------------------------------------------------------
// WithSupportPowerActivationAnimation
// OpenRA 对照: WithSupportPowerActivationAnimation : ConditionalTrait<Info>, INotifySupportPower
// ---------------------------------------------------------------------------

/**
 * Replaces the building animation when a support power is triggered.
 *
 * OpenRA 对照: WithSupportPowerActivationAnimation
 *
 * When the support power is Activated, a custom animation sequence is
 * played on the matched WithSpriteBody. The animation reverts to default
 * when the custom animation completes, or when the trait is disabled.
 */
export class WithSupportPowerActivationAnimation
  extends ConditionalTrait<WithSupportPowerActivationAnimationInfo>
  implements INotifySupportPower
{
  /** The matched WithSpriteBody trait.
   *
   * OpenRA 对照: WithSupportPowerActivationAnimation.wsb
   */
  private wsb: IWithSpriteBody | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(info: WithSupportPowerActivationAnimationInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the WithSpriteBody reference.
   *
   * OpenRA 对照: WithSupportPowerActivationAnimation constructor body
   *
   * Called after the trait is constructed to resolve the WithSpriteBody
   * trait by name. Since TypeScript doesn't have the full actor trait
   * lookup at construction time, we provide an explicit init method.
   *
   * @param body — the matched WithSpriteBody trait
   */
  init(body: IWithSpriteBody): void {
    this.wsb = body
  }

  // -----------------------------------------------------------------------
  // Lifecycle — attach
  // -----------------------------------------------------------------------

  override attach(actor: IGameActor): void {
    super.attach(actor)
    // If not yet initialized via explicit init(), try to resolve via actor
    if (!this.wsb) {
      this.resolveWithSpriteBody(actor)
    }
  }

  // -----------------------------------------------------------------------
  // INotifySupportPower — Charged
  // -----------------------------------------------------------------------

  /**
   * Called when the support power finishes charging.
   * No-op — animation triggers on Activation, not charge completion.
   *
   * OpenRA 对照: INotifySupportPower.Charged(Actor)
   */
  charged(_self: IGameActor): void {
    // Intentional no-op: animation plays on activation
  }

  // -----------------------------------------------------------------------
  // INotifySupportPower — Activated
  // -----------------------------------------------------------------------

  /**
   * Called when the support power is activated.
   * Plays the custom animation sequence on the matched sprite body.
   *
   * OpenRA 对照: INotifySupportPower.Activated(Actor)
   *
   * @param self — the actor holding the support power
   */
  activated(self: IGameActor): void {
    if (this.isTraitDisabled) return
    if (!this.wsb) return

    this.wsb.playCustomAnimation(self, this.info.sequence, () => {
      this.wsb?.cancelCustomAnimation(self)
    })
  }

  // -----------------------------------------------------------------------
  // ConditionalTrait — TraitDisabled
  // -----------------------------------------------------------------------

  /**
   * Called when the trait is disabled (conditions not satisfied).
   * Cancels any active custom animation to restore the default loop.
   *
   * OpenRA 对照: TraitDisabled(Actor)
   *
   * @param self — the actor
   */
  protected override traitDisabled(self: IGameActor): void {
    if (this.wsb) {
      this.wsb.cancelCustomAnimation(self)
    }
    super.traitDisabled(self)
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Resolve the WithSpriteBody trait from the actor.
   * Override in tests to inject mock bodies.
   *
   * @param actor — the actor to search
   */
  protected resolveWithSpriteBody(actor: IGameActor): void {
    // NOTE: In OpenRA:
    //   wsb = self.TraitsImplementing<WithSpriteBody>()
    //     .Single(w => w.Info.Name == Info.Body);
    //
    // WithSpriteBody is not yet fully migrated.
    // We use duck-typed lookup via traitsImplementing.
    if (actor.traitsImplementing) {
      const bodies = actor.traitsImplementing('WithSpriteBody') as IWithSpriteBody[]
      this.wsb = bodies.find((b) => b.info.name === this.info.body) ?? null
    }
  }

  // -----------------------------------------------------------------------
  // Test accessors
  // -----------------------------------------------------------------------

  /** Expose the matched WithSpriteBody for test assertions. */
  get _testWsb(): IWithSpriteBody | null {
    return this.wsb
  }

  /** Inject a WithSpriteBody for testing. */
  set _testWsb(body: IWithSpriteBody | null) {
    this.wsb = body
  }
}
