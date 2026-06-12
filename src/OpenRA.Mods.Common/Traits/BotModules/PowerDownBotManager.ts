/**
 * PowerDownBotManager.ts — AI power-down management for low-power states (STUB)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/PowerDownBotManager.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<PowerDownBotModuleInfo> → TypeScript stub
 * - C# PowerManager / PowerMultiplier / ToggleConditionOnOrder → deferred stub
 *
 * STUB — full migration deferred to Chapter 8 (Weapon/Health/Power System).
 *
 * @todo Chapter 8: Implement power management with PowerManager, PowerMultiplier,
 *       and ToggleConditionOnOrder when trait system is fully migrated.
 */

import type {
  IBotTick,
  IBot,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// PowerDownBotManager (STUB)
// ---------------------------------------------------------------------------

/**
 * AI power-down manager — STUB.
 *
 * OpenRA 对照: PowerDownBotModule : ConditionalTrait<PowerDownBotModuleInfo>
 *
 * @todo Chapter 8: Full implementation with PowerManager, PowerMultiplier,
 *       ToggleConditionOnOrder, and IBotTick.
 */
export class PowerDownBotManager implements IBotTick {
  /** Interval (ticks) between power toggle checks. */
  readonly interval: number

  /** Actor types that allow power toggling. */
  readonly powerDownTypes: ReadonlySet<string>

  /** Order name used for power toggling. */
  readonly powerDownOrder: string

  /** Current toggle tick countdown. */
  private _toggleTick: number

  constructor(
    interval: number = 150,
    powerDownTypes: ReadonlySet<string> = new Set(),
    powerDownOrder: string = 'PowerDown',
    initialToggleTick: number = 0,
  ) {
    this.interval = interval
    this.powerDownTypes = powerDownTypes
    this.powerDownOrder = powerDownOrder
    this._toggleTick = initialToggleTick
  }

  // -----------------------------------------------------------------------
  // IBotTick (STUB — no-op)
  // -----------------------------------------------------------------------

  /**
   * Per-tick power management.
   *
   * OpenRA 对照: IBotTick.BotTick(IBot)
   *
   * @todo Chapter 8: Check excess power, toggle buildings on/off appropriately.
   */
  botTick(_bot: IBot): void {
    // STUB: No-op. Full power management deferred to Chapter 8.
    // In OpenRA, this checks excess power and toggles buildings accordingly.
    this._toggleTick--
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    // No GPU resources to clean up
  }
}
