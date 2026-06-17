/**
 * ScriptMemberDescriptor.ts — Explicit member descriptors for script-exposed objects
 * OpenRA 对照: ScriptMemberWrapper.cs (absorbed)
 *
 * 核心范式转换:
 * - C# System.Reflection MemberInfo + PropertyInfo + MethodInfo
 *   → Explicit PropertyDescriptor | MethodDescriptor union type
 * - C# runtime type scanning via GetMembers(BindingFlags)
 *   → Statically declared descriptors returned by getMemberDescriptors()
 * - C# LuaValue parameter conversion (TryGetClrValue)
 *   → fromScriptValue() with explicit ScriptTypeName target
 */

// ---------------------------------------------------------------------------
// ScriptTypeName — union of all possible script API types
// ---------------------------------------------------------------------------

/**
 * Names of types that can appear in script APIs.
 * Used for documentation, error messages, and type conversion validation.
 *
 * OpenRA 对照: Type.Name strings used in LuaDoc generation
 */
export type ScriptTypeName =
  | 'nil'
  | 'boolean'
  | 'number'
  | 'string'
  | 'Actor'
  | 'Player'
  | 'WPos'
  | 'CPos'
  | 'CVec'
  | 'WVec'
  | 'WAngle'
  | 'WDist'
  | 'WRot'
  | 'Color'
  | 'string[]'
  | 'Actor[]'
  | 'Player[]'
  | 'CPos[]'
  | 'any'
  | 'table'
  | 'function'

// ---------------------------------------------------------------------------
// ParameterDescriptor
// ---------------------------------------------------------------------------

/**
 * Describes a single method parameter.
 *
 * OpenRA 对照: ParameterInfo.Name + ParameterInfo.ParameterType name
 */
export interface ParameterDescriptor {
  readonly name: string
  readonly type: ScriptTypeName
  readonly optional: boolean
  readonly defaultValue?: unknown
}

// ---------------------------------------------------------------------------
// PropertyDescriptor
// ---------------------------------------------------------------------------

/**
 * Describes a readable and/or writable property exposed to scripts.
 *
 * OpenRA 对照: PropertyInfo + ScriptMemberWrapper.Get/Set
 */
export interface PropertyDescriptor {
  readonly memberType: 'property'
  readonly name: string
  readonly description?: string
  /** The return type of the property (for documentation/type conversion). */
  readonly returnType: ScriptTypeName
  /** Get the property value. undefined means write-only. */
  readonly get?: (target: object) => unknown
  /** Set the property value. undefined means read-only. */
  readonly set?: (target: object, value: unknown) => void
}

// ---------------------------------------------------------------------------
// MethodDescriptor
// ---------------------------------------------------------------------------

/**
 * Describes a callable method exposed to scripts.
 *
 * OpenRA 对照: MethodInfo + ScriptMemberWrapper.Invoke
 */
export interface MethodDescriptor {
  readonly memberType: 'method'
  readonly name: string
  readonly description?: string
  /** Parameter definitions (for argument validation and type conversion). */
  readonly parameters: readonly ParameterDescriptor[]
  /** The return type (for documentation/type conversion). */
  readonly returnType: ScriptTypeName
  /** Invoke the method with script-compatible arguments. */
  readonly invoke: (target: object, args: unknown[]) => unknown
}

// ---------------------------------------------------------------------------
// MemberDescriptor — discriminated union
// ---------------------------------------------------------------------------

/**
 * Describes a single member (property or method) exposed to scripts.
 * Replaces OpenRA's reflection-based ScriptMemberWrapper + MemberInfo.
 *
 * OpenRA 对照: ScriptMemberWrapper (ScriptMemberWrapper.cs:21-155)
 *
 * Paradigm shift:
 * - C# reflection discovers public methods/properties at runtime
 * - TypeScript uses explicit MemberDescriptor objects registered at import time
 */
export type MemberDescriptor =
  | PropertyDescriptor
  | MethodDescriptor

// ---------------------------------------------------------------------------
// Forward interface stubs (avoid circular imports)
// ---------------------------------------------------------------------------

import type { ActorInfoStub } from '../Traits/TraitsInterfaces.js'
import type { IGameActor } from '../Traits/TraitsInterfaces.js'
import type { PlayerStub } from '../Traits/TraitsInterfaces.js'
import type { WorldStub } from '../Traits/TraitsInterfaces.js'
import type { WorldRendererStub } from '../Traits/TraitsInterfaces.js'

/**
 * Forward interface for ScriptContext — used by ScriptRegistry registrations
 * and ScriptObjectWrapper subclasses to avoid circular imports.
 *
 * OpenRA 对照: ScriptContext public members used by wrappers
 */
export interface IScriptContext {
  readonly world: WorldStub
  readonly worldRenderer: WorldRendererStub
  readonly fatalErrorOccurred: boolean
  readonly errorMessage: string | null
  getActorCommands(info: ActorInfoStub): readonly ActorPropertyRegistration[]
  readonly playerCommands: readonly PlayerPropertyRegistration[]
  registerMapActor(name: string, actor: IGameActor): void
  fatalError(error: Error): void
  fatalError(message: string): void
}

// ---------------------------------------------------------------------------
// ScriptRegistration types (used by ScriptRegistry + IScriptContext)
// ---------------------------------------------------------------------------

/**
 * Registration record for a ScriptGlobal subclass.
 *
 * OpenRA 对照: ScriptGlobal attribute discovery + constructor invocation
 */
export interface GlobalRegistration {
  readonly name: string
  readonly ctor: new (context: IScriptContext) => any // ScriptGlobal
  readonly description?: string
}

/**
 * Registration record for a ScriptActorProperties subclass.
 *
 * OpenRA 对照: [ScriptPropertyGroup("category")] + Requires<TInfo> on class
 */
export interface ActorPropertyRegistration {
  readonly category: string
  readonly ctor: new (context: IScriptContext, actor: IGameActor) => any // ScriptActorProperties
  readonly requiredTraits: readonly string[]
  readonly exposedForDestroyedActors: boolean
  readonly description?: string
}

/**
 * Registration record for a ScriptPlayerProperties subclass.
 *
 * OpenRA 对照: [ScriptPropertyGroup("category")] on PlayerProperties subclass
 */
export interface PlayerPropertyRegistration {
  readonly category: string
  readonly ctor: new (context: IScriptContext, player: PlayerStub) => any // ScriptPlayerProperties
  readonly requiredTraits: readonly string[]
  readonly description?: string
}

/**
 * Registration record for ActorInit factory functions.
 * Used by ActorGlobal.Create() to construct actors from script-provided init tables.
 *
 * OpenRA 对照: ActorInit subclasses found via reflection + CompositeActorInit pattern
 */
export interface ActorInitRegistration {
  readonly name: string
  readonly parameters: ReadonlyMap<string, ScriptTypeName>
  readonly factory: (values: ReadonlyMap<string, unknown>) => ActorInitValue
}

/**
 * A resolved ActorInit value (ready for actor construction).
 *
 * OpenRA 对照: ActorInit (abstract class)
 */
export interface ActorInitValue {
  readonly initName: string
  readonly instanceName?: string
  readonly value: unknown
}
