/**
 * SupportPowerCrateAction.ts — 从宝箱获得支援能力的动作
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.cs (48 lines)
 *
 * 核心范式转换:
 * - C# CrateAction virtual Activate(Actor) → TS 重写 activate()
 * - C# World.AddFrameEndTask(w => w.CreateActor(…)) → TS world.addFrameEndAction()
 * - C# OwnerInit(collector.Owner) → TS { owner: collector.owner }
 *
 * NOTE: Proxy actor creation delegates to world.addFrameEndAction() stub.
 *   The base class CrateAction handles audio/visual effects.
 *
* SupportPowerCrateAction migration
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CrateAction, type CrateActionInfo } from './CrateAction.js'

// ---------------------------------------------------------------------------
// SupportPowerCrateActionInfo
// OpenRA 对照: SupportPowerCrateActionInfo : CrateActionInfo
// ---------------------------------------------------------------------------

/** Configuration for SupportPowerCrateAction.
 *
 * OpenRA 对照: SupportPowerCrateActionInfo
 *
 * Defines the proxy actor type that will be spawned when the crate is
 * collected. The proxy actor must have a SupportPower trait.
 */
export interface SupportPowerCrateActionInfo extends CrateActionInfo {
  /** The proxy actor type that grants the support power (required).
   *
   * OpenRA 对照: SupportPowerCrateActionInfo.Proxy
   */
  readonly proxy: string
}

// ---------------------------------------------------------------------------
// SupportPowerCrateAction
// OpenRA 对照: SupportPowerCrateAction : CrateAction
// ---------------------------------------------------------------------------

/**
 * Crate action that spawns a proxy actor granting a support power.
 *
 * OpenRA 对照: SupportPowerCrateAction
 *
 * When the crate is collected, a proxy actor is created via
 * world.addFrameEndAction(). The proxy actor carries the SupportPower
 * trait, which grants the power to the collector's player.
 */
export class SupportPowerCrateAction extends CrateAction {
  /** Typed info reference. */
  get typedInfo(): SupportPowerCrateActionInfo {
    return this.info as SupportPowerCrateActionInfo
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the crate action: spawn a proxy actor granting the power.
   *
   * OpenRA 对照: SupportPowerCrateAction.Activate(Actor)
   *
   * The proxy actor is created at the end of the current frame to avoid
   * mid-tick state mutation. The proxy actor carries the SupportPower
   * trait which will be automatically discovered by SupportPowerManager.
   *
   * Unlike OpenRA's free unit crate, proxy actor crates:
   * - Do NOT require same faction
   * - Do NOT require the actor to be mobile
   *
   * @param collector — the actor collecting the crate
   */
  override activate(collector: IGameActor): void {
    // Create the proxy actor via frameEndActions
    if (collector.world && collector.owner) {
      const proxyType = this.typedInfo.proxy
      const owner = collector.owner

      // NOTE: In OpenRA:
      //   collector.World.AddFrameEndTask(w => w.CreateActor(info.Proxy,
      //     [new OwnerInit(collector.Owner)]))
      //
      // frameEndActions ensures the actor is created after the current
      // tick completes, preventing re-entrant state mutation.
      this.createProxyActor(collector, proxyType, owner)
    }

    // Call base class effects (sound, notification, sprite effect)
    super.activate(collector)
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Create the proxy actor via frameEndActions.
   *
   * Override in tests to capture the spawned actor info.
   *
   * @param _collector — the actor collecting the crate
   * @param _proxyType — the proxy actor type name
   * @param _owner — the owner for the spawned actor
   */
  protected createProxyActor(
    _collector: IGameActor,
    _proxyType: string,
    _owner: unknown,
  ): void {
    // NOTE: world.addFrameEndAction(() => world.createActor(proxyType, { owner }))
    // World actor creation is stubbed — full integration requires Ch3 World runtime.
  }
}
