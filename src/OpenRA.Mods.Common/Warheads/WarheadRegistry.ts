/**
 * WarheadRegistry.ts — Central warhead type name → constructor registry
 * OpenRA 对照: Warhead type resolution via Game.CreateObject<IWarhead>()
 *
 * 核心范式转换:
 * - C# reflection-based IWarhead instantiation (Game.CreateObject)
 *   → TypeScript explicit registry map
 * - C# convention-based naming ("TypeName" + "Warhead")
 *   → explicit key-value pairs in WARHEAD_REGISTRY
 *
 * Usage:
 * ```
 * import { WARHEAD_REGISTRY } from './WarheadRegistry.js'
 * const Ctor = WARHEAD_REGISTRY['SpreadDamage']
 * const warhead = new Ctor()
 * warhead.loadFromJSON(configJson)
 * ```
 */

import { SpreadDamageWarhead } from './SpreadDamageWarhead.js'
import { TargetDamageWarhead } from './TargetDamageWarhead.js'
import { HealthPercentageDamageWarhead } from './HealthPercentageDamageWarhead.js'
import { CreateEffectWarhead } from './CreateEffectWarhead.js'
import { FireClusterWarhead } from './FireClusterWarhead.js'
import { GrantExternalConditionWarhead } from './GrantExternalConditionWarhead.js'
import { ChangeOwnerWarhead } from './ChangeOwnerWarhead.js'
import { FlashTargetsInRadiusWarhead } from './FlashTargetsInRadiusWarhead.js'
import { CreateResourceWarhead } from './CreateResourceWarhead.js'
import { DestroyResourceWarhead } from './DestroyResourceWarhead.js'
import { LeaveSmudgeWarhead } from './LeaveSmudgeWarhead.js'
import { ShakeScreenWarhead } from './ShakeScreenWarhead.js'
import { FlashEffectWarhead } from './FlashEffectWarhead.js'
import type { IWarhead } from './Warhead.js'

// ---------------------------------------------------------------------------
// WarheadConstructor type
// ---------------------------------------------------------------------------

/**
 * Constructor type for warhead classes that implement IWarhead.
 *
 * OpenRA 对照: Game.CreateObject<IWarhead>() factory type
 *
 * All registered warhead constructors take no arguments and implement IWarhead.
 * Using IWarhead instead of Warhead allows mock warheads in tests.
 *
 * ADR-8.C.3: Warhead resolution from registry.
 */
export type WarheadConstructor = new () => IWarhead

/**
 * Union of all registered warhead type name strings.
 */
export type WarheadTypeName = keyof typeof WARHEAD_REGISTRY

// ---------------------------------------------------------------------------
// WARHEAD_REGISTRY — canonical name → constructor mapping
// ---------------------------------------------------------------------------

/**
 * Central registry of all warhead constructors by type name.
 *
 * OpenRA 对照: IWarhead resolution by type name via reflection
 *
 * Usage:
 * ```
 * import { WARHEAD_REGISTRY } from './WarheadRegistry.js'
 * const factory = WARHEAD_REGISTRY['SpreadDamage']
 * const warhead = new factory()
 * warhead.loadFromJSON(config)
 * ```
 */
/**
 * NOTE: DamageWarhead (abstract) is NOT included — it cannot be directly
 * instantiated. Use SpreadDamageWarhead or TargetDamageWarhead instead.
 */
export const WARHEAD_REGISTRY: Readonly<Record<string, WarheadConstructor>> = {
  SpreadDamage: SpreadDamageWarhead,
  TargetDamage: TargetDamageWarhead,
  HealthPercentageDamage: HealthPercentageDamageWarhead,
  CreateEffect: CreateEffectWarhead,
  FireCluster: FireClusterWarhead,
  GrantExternalCondition: GrantExternalConditionWarhead,
  ChangeOwner: ChangeOwnerWarhead,
  FlashTargetsInRadius: FlashTargetsInRadiusWarhead,
  CreateResource: CreateResourceWarhead,
  DestroyResource: DestroyResourceWarhead,
  LeaveSmudge: LeaveSmudgeWarhead,
  ShakeScreen: ShakeScreenWarhead,
  FlashEffect: FlashEffectWarhead,
}
