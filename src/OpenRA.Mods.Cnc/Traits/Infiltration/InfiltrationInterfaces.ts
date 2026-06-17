/**
 * InfiltrationInterfaces.ts — Infiltration trait interfaces
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (INotifyInfiltrated, INotifyInfiltration)
 *
 * 核心范式转换:
 * - C# explicit interface implementation → TypeScript interfaces + type guards
 * - C# BitSet<TargetableType> → TypeScript string[] (target type names)
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// INotifyInfiltrated — notified on the TARGET actor when infiltrated
// OpenRA 对照: INotifyInfiltrated { void Infiltrated(Actor self, Actor infiltrator, BitSet<TargetableType> types); }
// ---------------------------------------------------------------------------

/**
 * Implemented by traits on the TARGET building that receive infiltration effects.
 *
 * OpenRA 对照: INotifyInfiltrated
 *
 * Called by the Infiltrate activity after successfully entering the target.
 * Each InfiltrateFor* trait on the target receives this callback and applies
 * its specific effect.
 */
export interface INotifyInfiltrated {
  infiltrated(
    self: IGameActor,
    infiltrator: IGameActor,
    types: readonly string[],
  ): void
}

/** Type guard for INotifyInfiltrated. */
export function isINotifyInfiltrated(
  obj: unknown,
): obj is INotifyInfiltrated {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'infiltrated' in obj &&
    typeof (obj as Record<string, unknown>).infiltrated === 'function'
  )
}

// ---------------------------------------------------------------------------
// INotifyInfiltration — notified on the INFILTRATOR actor before infiltration
// OpenRA 对照: INotifyInfiltration { void Infiltrating(Actor self); }
// ---------------------------------------------------------------------------

/**
 * Implemented by traits on the infiltrating actor that are notified
 * just before the infiltration effects are applied.
 *
 * OpenRA 对照: INotifyInfiltration
 */
export interface INotifyInfiltration {
  infiltrating(self: IGameActor): void
}

/** Type guard for INotifyInfiltration. */
export function isINotifyInfiltration(
  obj: unknown,
): obj is INotifyInfiltration {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'infiltrating' in obj &&
    typeof (obj as Record<string, unknown>).infiltrating === 'function'
  )
}
