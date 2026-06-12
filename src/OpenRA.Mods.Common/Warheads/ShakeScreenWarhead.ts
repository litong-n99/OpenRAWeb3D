/**
 * ShakeScreenWarhead.ts -- Camera shake on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/ShakeScreenWarhead.cs
 *
 * 核心范式转换:
 * - C# ScreenShaker.AddEffect(Duration, CenterPosition, Intensity, Multiplier)
 *   → ScreenEffect deferred
 * - C# float2 Multiplier (X, Y) → { x: number, y: number }
 * - Camera shake via Viewport position offset → ScreenEffect with centerPosition
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
// ShakeScreenWarhead (对应 OpenRA ShakeScreenWarhead)
// ---------------------------------------------------------------------------

/**
 * Makes the screen shake on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.ShakeScreenWarhead
 *
 * Adds a camera shake effect via ScreenShaker trait on the WorldActor.
 * Intensity controls the amplitude, Multiplier scales X/Y independently.
 * Shake follows a damped oscillation pattern centered on the impact position.
 */
export class ShakeScreenWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Duration of the shaking in ticks.
   *
   * OpenRA 对照: ShakeScreenWarhead.Duration
   */
  duration: number = 0

  /** Shake intensity.
   *
   * OpenRA 对照: ShakeScreenWarhead.Intensity
   */
  intensity: number = 0

  /** Shake multipliers by X and Y axis.
   *
   * OpenRA 对照: ShakeScreenWarhead.Multiplier (float2)
   */
  multiplier: { x: number; y: number } = { x: 0, y: 0 }

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Duration !== undefined) this.duration = json.Duration as number
    if (json.Intensity !== undefined) this.intensity = json.Intensity as number
    if (json.Multiplier !== undefined) {
      const arr = json.Multiplier as number[]
      this.multiplier = { x: arr[0] ?? 0, y: arr[1] ?? 0 }
    }
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Trigger screen shake on impact.
   *
   * OpenRA 对照: ShakeScreenWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    pos: WPos,
    _firedBy: IGameActor,
    _args: WarheadArgs,
  ): WarheadEffect[] {
    const effect: ScreenEffect = {
      type: 'screen',
      effectType: 'shake',
      duration: this.duration,
      intensity: this.intensity,
      multiplier: this.multiplier,
      centerPosition: pos,
    }

    return [effect]
  }
}
