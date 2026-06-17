/**
 * WithTeslaChargeAnimation.ts — 特斯拉充能动画（发射前播放充能序列）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeAnimation.cs (47 lines)
 *
 * 核心范式转换:
 * - C# INotifyTeslaCharging (内部 trait 接口) → TS duck-typed event notification
 * - C# WithSpriteBody.PlayCustomAnimation / CancelCustomAnimation → TS duck-typed
 * - C# TraitsImplementing<WithSpriteBody>().Single() → TS trait lookup by name
 *
 * 特斯拉线圈在攻击前需要充电。充电期间播放 ChargeSequence 动画，
 * 充电完成后通过回调取消自定义动画，恢复正常序列。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal interface for WithSpriteBody trait.
 *
 * OpenRA 对照: WithSpriteBody
 */
export interface ITeslaSpriteBody {
  readonly info: { readonly name: string }
  playCustomAnimation(self: IGameActor, sequence: string, onComplete?: () => void): void
  cancelCustomAnimation(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyTeslaCharging interface
// OpenRA 对照: INotifyTeslaCharging (from OpenRA.Mods.Cnc/TraitsInterfaces.cs)
// ---------------------------------------------------------------------------

/** Interface for traits that respond to Tesla charge events.
 *
 * OpenRA 对照: INotifyTeslaCharging
 *
 * Called by AttackTesla when it begins charging.
 */
export interface INotifyTeslaCharging {
  /** Called when the Tesla coil starts charging.
   *
   * OpenRA 对照: INotifyTeslaCharging.Charging(Actor, in Target)
   *
   * @param self — the charging actor
   * @param target — the target being charged at
   */
  charging(self: IGameActor, target: unknown): void
}

// ---------------------------------------------------------------------------
// WithTeslaChargeAnimationInfo
// OpenRA 对照: WithTeslaChargeAnimationInfo : TraitInfo, Requires<WithSpriteBodyInfo>, Requires<RenderSpritesInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithTeslaChargeAnimation.
 *
 * OpenRA 对照: WithTeslaChargeAnimationInfo
 */
export class WithTeslaChargeAnimationInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Sequence to use for charge animation (default "active").
   *
   * OpenRA 对照: WithTeslaChargeAnimationInfo.ChargeSequence
   */
  readonly chargeSequence: string

  /** Which sprite body to play the animation on (default "body").
   *
   * OpenRA 对照: WithTeslaChargeAnimationInfo.Body
   */
  readonly body: string

  constructor(params: {
    instanceName?: string
    chargeSequence?: string
    body?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.chargeSequence = params.chargeSequence ?? 'active'
    this.body = params.body ?? 'body'
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithTeslaChargeAnimationInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithTeslaChargeAnimation {
    return new WithTeslaChargeAnimation(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithTeslaChargeAnimation
// OpenRA 对照: WithTeslaChargeAnimation : INotifyTeslaCharging
// ---------------------------------------------------------------------------

/** Plays a charge animation on a sprite body when Tesla weapon charges.
 *
 * OpenRA 对照: WithTeslaChargeAnimation
 *
 * When AttackTesla triggers the INotifyTeslaCharging event, this trait
 * plays a custom animation on the matched WithSpriteBody. The custom
 * animation is cancelled when the charge completes.
 */
export class WithTeslaChargeAnimation implements INotifyTeslaCharging {
  readonly info: WithTeslaChargeAnimationInfo
  private readonly _wsb: ITeslaSpriteBody

  constructor(self: IGameActor, info: WithTeslaChargeAnimationInfo) {
    this.info = info

    // Resolve the named WithSpriteBody trait
    // C#: wsb = init.Self.TraitsImplementing<WithSpriteBody>().Single(w => w.Info.Name == info.Body)
    const bodies = (self as any).traitsImplementing?.('WithSpriteBody') as ITeslaSpriteBody[] | undefined
    const matched = bodies?.find((b) => b.info.name === info.body)
    if (!matched) {
      throw new Error(
        `WithTeslaChargeAnimation requires a WithSpriteBody with name="${info.body}"`,
      )
    }
    this._wsb = matched
  }

  // -------------------------------------------------------------------------
  // INotifyTeslaCharging
  // 对照: INotifyTeslaCharging.Charging(Actor self, in Target target)
  // -------------------------------------------------------------------------

  /** Plays the charge animation when Tesla begins charging.
   *
   * OpenRA 对照: INotifyTeslaCharging.Charging(Actor, in Target)
   *
   * @param self — the actor
   * @param _target — the target (unused)
   */
  charging(self: IGameActor, _target: unknown): void {
    this._wsb.playCustomAnimation(self, this.info.chargeSequence, () => {
      this._wsb.cancelCustomAnimation(self)
    })
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
