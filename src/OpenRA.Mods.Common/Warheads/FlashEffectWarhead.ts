/**
 * FlashEffectWarhead.ts -- Screen flash on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/FlashEffectWarhead.cs
 *
 * 核心范式转换:
 * - C# FlashPostProcessEffect.Enable(Duration) → ScreenEffect deferred
 * - C# WorldActor.TraitsImplementing<FlashPostProcessEffect> → deferred
 * - Flash type matching via Info.Type → ScreenEffect.flashType
 */

import type { WPos } from '../../OpenRA.Game/WPos.js'
import {
  Warhead,
  type WarheadArgs,
  type ScreenEffect,
  type WarheadEffect,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// FlashEffectWarhead (对应 OpenRA FlashEffectWarhead)
// ---------------------------------------------------------------------------

/**
 * Triggers a screen flash effect on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.FlashEffectWarhead
 *
 * Activates a FlashPostProcessEffect trait on the WorldActor.
 * Duration = -1 defaults to the effect's configured Length.
 */
export class FlashEffectWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Corresponds to Type from FlashPostProcessEffect on the world actor.
   *
   * OpenRA 对照: FlashEffectWarhead.FlashType
   */
  flashType: string = ''

  /** Duration of the flashing in ticks. -1 = use effect's Length.
   *
   * OpenRA 对照: FlashEffectWarhead.Duration
   */
  duration: number = 0

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.FlashType !== undefined) this.flashType = json.FlashType as string
    if (json.Duration !== undefined) this.duration = json.Duration as number
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Trigger screen flash on impact.
   *
   * OpenRA 对照: FlashEffectWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    _pos: WPos,
    _firedBy: IGameActor,
    _args: WarheadArgs,
  ): WarheadEffect[] {
    const effect: ScreenEffect = {
      type: 'screen',
      effectType: 'flash',
      duration: this.duration,
      flashType: this.flashType,
    }

    return [effect]
  }
}
