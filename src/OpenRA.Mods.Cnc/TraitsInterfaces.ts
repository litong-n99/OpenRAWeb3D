/**
 * TraitsInterfaces.ts — C&C-specific trait interfaces
 * OpenRA 对照: OpenRA.Mods.Cnc/TraitsInterfaces.cs
 *
 * 核心范式转换:
 * - C# interface INotifyTeslaCharging → TypeScript interface + type guard
 */

import type { IGameActor } from '../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Target } from '../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// INotifyTeslaCharging
// OpenRA 对照: INotifyTeslaCharging { void Charging(Actor self, in Target target); }
// ---------------------------------------------------------------------------

/** Notified when a tesla coil is charging up to fire.
 *
 *  OpenRA 对照: INotifyTeslaCharging
 */
export interface INotifyTeslaCharging {
  charging(self: IGameActor, target: Target): void
}

/** Type guard for INotifyTeslaCharging. */
export function isINotifyTeslaCharging(
  obj: unknown,
): obj is INotifyTeslaCharging {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'charging' in obj &&
    typeof (obj as Record<string, unknown>).charging === 'function'
  )
}
