/**
 * CombatInterfaces.ts -- Modifier interfaces for the combat system
 * OpenRA 对照: IRangeModifier, IFirepowerModifier, IReloadModifier,
 *             IInaccuracyModifier, IReloadAmmoModifier, INotifyAttack,
 *             INotifyBurstComplete, INotifyAiming, IOverrideAutoTarget,
 *             IAutoTargetPriorityInfo, IActivityNotifyStanceChanged,
 *             INotifyStanceChanged, UnitStance enum
 *
 * 核心范式转换:
 * - C# enum UnitStance → const object with numeric values
 * - C# explicit interface implementation → TypeScript interfaces with type guards
 * - Barrel: C# class with mutable fields → TypeScript readonly interface
 */

import type { WVec } from '../../OpenRA.Game/WVec.js'
import type { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import type {
  IGameActor,
  PlayerRelationship,
  AttackInfo,
  Damage,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// UnitStance enum
// OpenRA 对照: UnitStance { HoldFire=0, ReturnFire=1, Defend=2, AttackAnything=3 }
// ---------------------------------------------------------------------------

/** Unit stance enum for auto-target behavior.
 *
 *  OpenRA 对照: UnitStance enum
 *
 *  HoldFire:  Do not fire unless explicitly ordered.
 *  ReturnFire: Fire back when attacked, but do not seek targets.
 *  Defend:     Seek targets in range, but do not move.
 *  AttackAnything: Seek targets and move to engage.
 */
export const UnitStance = {
  HoldFire: 0,
  ReturnFire: 1,
  Defend: 2,
  AttackAnything: 3,
} as const

export type UnitStance = (typeof UnitStance)[keyof typeof UnitStance]

// ---------------------------------------------------------------------------
// Barrel
// OpenRA 对照: Barrel class in Armament.cs
// ---------------------------------------------------------------------------

/** Barrel configuration for an armament's muzzle position.
 *
 *  OpenRA 对照: Barrel class (WVec Offset, WAngle Yaw)
 */
export interface Barrel {
  readonly offset: WVec
  readonly yaw: WAngle
}

// ---------------------------------------------------------------------------
// Range modifier
// OpenRA 对照: IRangeModifier, IRangeModifierInfo
// ---------------------------------------------------------------------------

/** Percentage modifier for weapon range.
 *
 *  OpenRA 对照: IRangeModifier
 */
export interface IRangeModifier {
  getRangeModifier(): number
}

/** Info variant for ruleset-loaded default calculation.
 *
 *  OpenRA 对照: IRangeModifierInfo
 */
export interface IRangeModifierInfo {
  getRangeModifierDefault(): number
}

// ---------------------------------------------------------------------------
// Firepower modifier
// OpenRA 对照: IFirepowerModifier, IFirepowerModifierInfo
// ---------------------------------------------------------------------------

/** Percentage modifier for damage (Firepower).
 *
 *  OpenRA 对照: IFirepowerModifier
 */
export interface IFirepowerModifier {
  getFirepowerModifier(): number
}

/** Info variant for ruleset-loaded default calculation.
 *
 *  OpenRA 对照: IFirepowerModifierInfo
 */
export interface IFirepowerModifierInfo {
  getFirepowerModifierDefault(): number
}

// ---------------------------------------------------------------------------
// Reload modifier
// OpenRA 对照: IReloadModifier, IReloadModifierInfo
// ---------------------------------------------------------------------------

/** Percentage modifier for reload time.
 *
 *  OpenRA 对照: IReloadModifier
 */
export interface IReloadModifier {
  getReloadModifier(): number
}

/** Info variant.
 *
 *  OpenRA 对照: IReloadModifierInfo
 */
export interface IReloadModifierInfo {
  getReloadModifierDefault(): number
}

// ---------------------------------------------------------------------------
// Inaccuracy modifier
// OpenRA 对照: IInaccuracyModifier, IInaccuracyModifierInfo
// ---------------------------------------------------------------------------

/** Percentage modifier for inaccuracy.
 *
 *  OpenRA 对照: IInaccuracyModifier
 */
export interface IInaccuracyModifier {
  getInaccuracyModifier(): number
}

/** Info variant.
 *
 *  OpenRA 对照: IInaccuracyModifierInfo
 */
export interface IInaccuracyModifierInfo {
  getInaccuracyModifierDefault(): number
}

// ---------------------------------------------------------------------------
// Reload ammo modifier
// OpenRA 对照: IReloadAmmoModifier
// ---------------------------------------------------------------------------

/** Percentage modifier for ammo reload speed.
 *
 *  OpenRA 对照: IReloadAmmoModifier
 */
export interface IReloadAmmoModifier {
  getReloadAmmoModifier(): number
}

// ---------------------------------------------------------------------------
// INotifyAttack
// OpenRA 对照: INotifyAttack (explicit interface in OpenRA, but duck-typed in usage)
// ---------------------------------------------------------------------------

/** Notified before and during an attack (weapon checks, targeting).
 *
 *  OpenRA 对照: INotifyAttack
 */
export interface INotifyAttack {
  preparingAttack(
    self: IGameActor,
    target: Target,
    armament: unknown,
    barrel: Barrel,
  ): void

  attacking(
    self: IGameActor,
    target: Target,
    armament: unknown,
    barrel: Barrel,
  ): void
}

// ---------------------------------------------------------------------------
// INotifyBurstComplete
// OpenRA 对照: INotifyBurstComplete
// ---------------------------------------------------------------------------

/** Notified when a burst sequence completes.
 *
 *  OpenRA 对照: INotifyBurstComplete
 */
export interface INotifyBurstComplete {
  firedBurst(self: IGameActor, target: Target, armament: unknown): void
}

// ---------------------------------------------------------------------------
// INotifyAiming
// OpenRA 对照: INotifyAiming
// ---------------------------------------------------------------------------

/** Notified when aiming state changes.
 *
 *  OpenRA 对照: INotifyAiming
 */
export interface INotifyAiming {
  startedAiming(self: IGameActor, attack: unknown): void
  stoppedAiming(self: IGameActor, attack: unknown): void
}

// ---------------------------------------------------------------------------
// IOverrideAutoTarget
// OpenRA 对照: IOverrideAutoTarget
// ---------------------------------------------------------------------------

/** Override auto-target selection (used by AttackFollow for persistent targeting).
 *
 *  OpenRA 对照: IOverrideAutoTarget
 */
export interface IOverrideAutoTarget {
  tryGetAutoTargetOverride(
    self: IGameActor,
    out: { target: Target },
  ): boolean
}

// ---------------------------------------------------------------------------
// IAutoTargetPriorityInfo
// OpenRA 对照: AutoTargetPriority.Info (exposed as IAutoTargetPriorityInfo in C#)
// ---------------------------------------------------------------------------

/** Priority configuration for auto-targeting.
 *
 *  OpenRA 对照: IAutoTargetPriorityInfo (fields from AutoTargetPriorityInfo)
 */
export interface IAutoTargetPriorityInfo {
  readonly priority: number
  readonly validTargets: ReadonlySet<string>
  readonly invalidTargets: ReadonlySet<string>
  readonly validRelationships: PlayerRelationship
}

// ---------------------------------------------------------------------------
// IActivityNotifyStanceChanged
// OpenRA 对照: IActivityNotifyStanceChanged
// ---------------------------------------------------------------------------

/** Notified when stance changes (for activities to cancel invalid targets).
 *
 *  OpenRA 对照: IActivityNotifyStanceChanged
 */
export interface IActivityNotifyStanceChanged {
  stanceChanged(
    self: IGameActor,
    autoTarget: unknown,
    oldStance: UnitStance,
    newStance: UnitStance,
  ): void
}

// ---------------------------------------------------------------------------
// INotifyStanceChanged
// OpenRA 对照: INotifyStanceChanged
// ---------------------------------------------------------------------------

/** Notified when stance changes (for traits on the actor).
 *
 *  OpenRA 对照: INotifyStanceChanged
 */
export interface INotifyStanceChanged {
  stanceChanged(
    self: IGameActor,
    autoTarget: unknown,
    oldStance: UnitStance,
    newStance: UnitStance,
  ): void
}

// ---------------------------------------------------------------------------
// AttackDelayType enum
// OpenRA 对照: AttackDelayType { Preparation, Attack }
// ---------------------------------------------------------------------------

/** Delay timing enum for attack-related sounds, animations, and overlays.
 *
 *  OpenRA 对照: AttackDelayType
 */
export const AttackDelayType = {
  Preparation: 0,
  Attack: 1,
} as const
export type AttackDelayType =
  (typeof AttackDelayType)[keyof typeof AttackDelayType]

// ---------------------------------------------------------------------------
// Damage modifier
// OpenRA 对照: IDamageModifier, IDamageModifierInfo
// ---------------------------------------------------------------------------

/** Percentage modifier for incoming damage on this actor.
 *
 *  OpenRA 对照: IDamageModifier
 */
export interface IDamageModifier {
  getDamageModifier(attacker: IGameActor, damage: Damage): number
}

/** Info variant for ruleset-loaded default calculation.
 *
 *  OpenRA 对照: IDamageModifierInfo
 */
export interface IDamageModifierInfo {
  getDamageModifierDefault(): number
}

// ---------------------------------------------------------------------------
// INotifyKilled — combat-specific killed notification (extends lifecycle)
// OpenRA 对照: INotifyKilled (in Traits namespace, distinct from INotifyKilled lifecycle)
// NOTE: This is defined here for the combat-aware traits that need extra context.
//   The base INotifyKilled in TraitsInterfaces.ts already handles the lifecycle.
// ---------------------------------------------------------------------------

/** Combat-aware killed notification with AttackInfo context.
 *
 *  OpenRA 对照: INotifyKilled (Traits namespace, combat-specific)
 *
 *  This extends the base killed() signature with AttackInfo for damage type
 *  and attacker info. Traits that need this implement the method directly.
 *  TraitsInterfaces.ts INotifyKilled already handles the base lifecycle.
 */
export interface INotifyKilledCombat {
  killed(self: IGameActor, e: AttackInfo): void
}

// ---------------------------------------------------------------------------
// Type guard functions
// ---------------------------------------------------------------------------

/** Type guard for IRangeModifier. */
export function isIRangeModifier(obj: unknown): obj is IRangeModifier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getRangeModifier' in obj &&
    typeof (obj as Record<string, unknown>).getRangeModifier === 'function'
  )
}

/** Type guard for IFirepowerModifier. */
export function isIFirepowerModifier(
  obj: unknown,
): obj is IFirepowerModifier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getFirepowerModifier' in obj &&
    typeof (obj as Record<string, unknown>).getFirepowerModifier === 'function'
  )
}

/** Type guard for IReloadModifier. */
export function isIReloadModifier(obj: unknown): obj is IReloadModifier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getReloadModifier' in obj &&
    typeof (obj as Record<string, unknown>).getReloadModifier === 'function'
  )
}

/** Type guard for IInaccuracyModifier. */
export function isIInaccuracyModifier(
  obj: unknown,
): obj is IInaccuracyModifier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getInaccuracyModifier' in obj &&
    typeof (obj as Record<string, unknown>).getInaccuracyModifier === 'function'
  )
}

/** Type guard for IReloadAmmoModifier. */
export function isIReloadAmmoModifier(
  obj: unknown,
): obj is IReloadAmmoModifier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getReloadAmmoModifier' in obj &&
    typeof (obj as Record<string, unknown>).getReloadAmmoModifier === 'function'
  )
}

/** Type guard for INotifyAttack. */
export function isINotifyAttack(obj: unknown): obj is INotifyAttack {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'preparingAttack' in obj &&
    'attacking' in obj &&
    typeof (obj as Record<string, unknown>).attacking === 'function'
  )
}

/** Type guard for INotifyBurstComplete. */
export function isINotifyBurstComplete(
  obj: unknown,
): obj is INotifyBurstComplete {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'firedBurst' in obj &&
    typeof (obj as Record<string, unknown>).firedBurst === 'function'
  )
}

/** Type guard for INotifyAiming. */
export function isINotifyAiming(obj: unknown): obj is INotifyAiming {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'startedAiming' in obj &&
    'stoppedAiming' in obj &&
    typeof (obj as Record<string, unknown>).startedAiming === 'function'
  )
}

/** Type guard for IOverrideAutoTarget. */
export function isIOverrideAutoTarget(
  obj: unknown,
): obj is IOverrideAutoTarget {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tryGetAutoTargetOverride' in obj &&
    typeof (obj as Record<string, unknown>).tryGetAutoTargetOverride === 'function'
  )
}

/** Type guard for IActivityNotifyStanceChanged. */
export function isIActivityNotifyStanceChanged(
  obj: unknown,
): obj is IActivityNotifyStanceChanged {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'stanceChanged' in obj &&
    typeof (obj as Record<string, unknown>).stanceChanged === 'function'
  )
}

/** Type guard for INotifyStanceChanged. */
export function isINotifyStanceChanged(
  obj: unknown,
): obj is INotifyStanceChanged {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'stanceChanged' in obj &&
    typeof (obj as Record<string, unknown>).stanceChanged === 'function'
  )
}

/** Type guard for IDamageModifier. */
export function isIDamageModifier(
  obj: unknown,
): obj is IDamageModifier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getDamageModifier' in obj &&
    typeof (obj as Record<string, unknown>).getDamageModifier === 'function'
  )
}
