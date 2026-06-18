/**
 * ScriptTypes.ts — Type conversion bridge for the scripting system
 * OpenRA 对照: ScriptTypes.cs / LuaValueExts
 *
 * 核心范式转换:
 * - C# Eluant LuaValue wrapping (LuaNumber, LuaString, LuaTable, ...)
 *   → JSON-compatible primitive values (number, string, boolean, object, array)
 * - C# TryGetClrValue(Type, out object) reflection-based dispatch
 *   → fromScriptValue(value, ScriptTypeName) with explicit type switch
 * - C# LuaValue.Dispose() reference counting
 *   → disposeScriptValue() no-op for Tier 1 (JSON), active for Tier 2 (fengari)
 */

import type { IGameActor, PlayerStub } from '../Traits/TraitsInterfaces.js'
import type {
  ScriptTypeName,
  IScriptContext,
} from './ScriptMemberDescriptor.js'

// Pre-import primitives for toScriptValue/fromScriptValue
import { CPos } from '../CPos.js'
import { WPos } from '../WPos.js'
import { WAngle } from '../WAngle.js'
import { WDist } from '../WDist.js'
import { WRot } from '../WRot.js'
import { CVec } from '../CVec.js'
import { WVec } from '../WVec.js'

// ---------------------------------------------------------------------------
// Marker interfaces (OpenRA 对照: IScriptBindable, IScriptNotifyBind)
// ---------------------------------------------------------------------------

/**
 * Marker interface for objects that can be exposed to the scripting system.
 * Objects implementing IScriptBindable are converted to script-accessible
 * wrappers via ScriptTypes.toScriptValue().
 *
 * OpenRA 对照: IScriptBindable (ScriptContext.cs:26 — tag interface)
 */
export interface IScriptBindable {
  // intentionally empty — marker interface
}

/**
 * Notification interface for objects that need the ScriptContext reference
 * when they are exposed to the scripting system.
 *
 * OpenRA 对照: IScriptNotifyBind (ScriptContext.cs:29-32)
 *
 * Called by ScriptTypes.toScriptValue() before the object is wrapped.
 * This gives the object access to the ScriptContext for further API calls
 * (e.g., converting child objects to script values).
 */
export interface IScriptNotifyBind {
  onScriptBind(context: IScriptContext): void
}

// ---------------------------------------------------------------------------
// ScriptTypes — type conversion utilities
// ---------------------------------------------------------------------------

/**
 * Type conversion utilities for the scripting system.
 *
 * OpenRA 对照: LuaValueExts (ScriptTypes.cs:17-191)
 *
 * Converts between TypeScript game objects and script-compatible values.
 *
 * Tier 1 (JSON triggers): script values are JSON-compatible primitives
 *   (number, boolean, string, null, plain objects, arrays).
 * Tier 2 (Phase G fengari): script values are Lua values.
 *
 * The same conversion functions serve both tiers — the output format
 * depends on the script runtime adapter.
 *
 * Paradigm shift:
 * - C# converts between CLR types and Eluant LuaValue wrappers
 *   (LuaNumber, LuaString, LuaTable, etc.)
 * - TS converts between typed game objects and JSON-compatible values
 *   for Tier 1, with an extension point for Lua value conversion in Phase G
 */
export class ScriptTypes {
  // ---------------------------------------------------------------------------
  // To-Script Conversion (object → script value)
  // ---------------------------------------------------------------------------

  /**
   * Convert a TypeScript game object to a script-compatible value.
   *
   * OpenRA 对照: object.ToLuaValue(ScriptContext)
   *
   * Conversion rules:
   * - null/undefined → null
   * - number, boolean, string → passthrough
   * - CPos → { x: number, y: number }
   * - WPos → { x: number, y: number, z: number }
   * - WAngle → number (degrees)
   * - WDist → number
   * - WRot → { yaw, pitch, roll }
   * - WVec → { x, y, z }
   * - CVec → { x, y }
   * - ColorStub → { r, g, b, a }
   * - IScriptBindable → ScriptObjectWrapper (via context.createActorInterface/createPlayerInterface)
   * - Array → Array (recursively converted)
   * - Otherwise → throws Error
   *
   * @param obj — the game object to convert
   * @param context — the script context (needed for creating wrappers)
   * @returns the script-compatible value
   * @throws Error if the object type cannot be converted
   */
  static toScriptValue(obj: unknown, context: IScriptContext): unknown {
    // null/undefined → null
    if (obj === null || obj === undefined) return null

    // Primitives — passthrough
    if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'string') return obj

    // Game primitives
    if (obj instanceof CPos) return { x: obj.X, y: obj.Y }
    if (obj instanceof WPos) return { x: obj.X, y: obj.Y, z: obj.Z }
    if (obj instanceof WAngle) return obj.angle // script sees angle in [0, 1024)
    if (obj instanceof WDist) return obj.length
    if (obj instanceof WRot) return { yaw: obj.yaw?.angle ?? 0, pitch: obj.pitch?.angle ?? 0, roll: obj.roll?.angle ?? 0 }
    if (obj instanceof WVec) return { x: obj.X, y: obj.Y, z: obj.Z }
    if (obj instanceof CVec) return { x: obj.X, y: obj.Y }

    // ColorStub (interface check — duck typing)
    if (ScriptTypes._isColorStub(obj)) return { r: obj.r, g: obj.g, b: obj.b, a: obj.a }

    // Array — recursively convert elements (check BEFORE IScriptBindable)
    if (Array.isArray(obj)) {
      return (obj as unknown[]).map(item => ScriptTypes.toScriptValue(item, context))
    }

    // IScriptBindable — objects with script interfaces
    if (ScriptTypes._isScriptBindable(obj)) {
      const notify = obj as IScriptNotifyBind | null
      notify?.onScriptBind?.(context)

      // Use context to create the appropriate interface
      // We check for telltale signs of what kind of object this is
      if (ScriptTypes._isActor(obj)) {
        const actor = obj as IGameActor
        return (context as any).createActorInterface?.(actor) ?? actor
      }
      if (ScriptTypes._isPlayer(obj)) {
        const player = obj as PlayerStub
        return (context as any).createPlayerInterface?.(player) ?? player
      }
      // Generic IScriptBindable — pass through directly (e.g., ScriptGlobal)
      return obj
    }

    // Fallback: throw
    throw new Error(`Cannot convert type '${typeof obj}' to script value. Object must implement IScriptBindable.`)
  }

  // ---------------------------------------------------------------------------
  // From-Script Conversion (script value → typed game object)
  // ---------------------------------------------------------------------------

  /**
   * Convert a script value to a TypeScript game object of the expected type.
   *
   * OpenRA 对照: LuaValue.TryGetClrValue(Type, out object)
   *
   * Conversion rules (from JSON-compatible values):
   * - number → number, int, short, byte (with validation)
   * - boolean → boolean
   * - string → string
   * - null → null (for nullable types)
   * - { x: number, y: number } → CPos
   * - { x: number, y: number, z: number } → WPos
   * - number → WAngle (treat as angle)
   * - number → WDist (treat as length)
   * - { r, g, b, a } → ColorStub
   * - script wrapper → underlying game object (unwrap)
   * - Array → typed Array (recursively convert elements)
   *
   * @param value — the script value to convert
   * @param targetType — the expected TypeScript type name
   * @returns the converted game object
   * @throws Error if conversion is not possible
   */
  static fromScriptValue(value: unknown, targetType: ScriptTypeName): unknown {
    // null/nil handling
    if (value === null || value === undefined) {
      if (targetType === 'nil') return null
      // For non-nil types, null → null (nullable reference)
      return null
    }

    switch (targetType) {
      case 'nil':
        return null

      case 'boolean':
        if (typeof value === 'boolean') return value
        throw new Error(`Cannot convert ${typeof value} to boolean`)

      case 'number':
        if (typeof value === 'number') return value
        throw new Error(`Cannot convert ${typeof value} to number`)

      case 'string':
        if (typeof value === 'string') return value
        throw new Error(`Cannot convert ${typeof value} to string`)

      case 'CPos':
        return new CPos(
          (value as any).x ?? 0,
          (value as any).y ?? 0,
        )

      case 'WPos':
        return new WPos(
          (value as any).x ?? 0,
          (value as any).y ?? 0,
          (value as any).z ?? 0,
        )

      case 'CVec':
        return new CVec(
          (value as any).x ?? 0,
          (value as any).y ?? 0,
        )

      case 'WVec':
        return new WVec(
          (value as any).x ?? 0,
          (value as any).y ?? 0,
          (value as any).z ?? 0,
        )

      case 'WAngle':
        if (typeof value === 'number') return new WAngle(value)
        throw new Error(`Cannot convert ${typeof value} to WAngle`)

      case 'WDist':
        if (typeof value === 'number') return new WDist(value)
        throw new Error(`Cannot convert ${typeof value} to WDist`)

      case 'WRot': {
        const ya = (value as any).yaw ?? 0
        const pa = (value as any).pitch ?? 0
        const ra = (value as any).roll ?? 0
        return new WRot(
          typeof ra === 'number' ? new WAngle(ra) : ra,
          typeof pa === 'number' ? new WAngle(pa) : pa,
          typeof ya === 'number' ? new WAngle(ya) : ya,
        )
      }

      case 'Color': {
        // Return a ColorStub-compatible object
        const v = value as any
        if (v && typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number') {
          return { r: v.r, g: v.g, b: v.b, a: v.a ?? 255 }
        }
        throw new Error(`Cannot convert ${typeof value} to Color`)
      }

      case 'Actor':
        // Unwrap ScriptActorInterface to IGameActor
        if (typeof value === 'object' && value !== null && '_actor' in (value as Record<string, unknown>)) {
          return (value as any)._actor
        }
        throw new Error(`Cannot convert ${typeof value} to Actor`)

      case 'Player':
        // Unwrap ScriptPlayerInterface to PlayerStub
        if (typeof value === 'object' && value !== null && '_player' in (value as Record<string, unknown>)) {
          return (value as any)._player
        }
        throw new Error(`Cannot convert ${typeof value} to Player`)

      case 'function':
        if (typeof value === 'function') return value
        throw new Error(`Cannot convert ${typeof value} to function`)

      case 'table':
      case 'any':
        if (typeof value === 'object' || targetType === 'any') return value
        throw new Error(`Cannot convert ${typeof value} to table`)

      // Array types
      case 'string[]':
      case 'Actor[]':
      case 'Player[]':
      case 'CPos[]':
        if (Array.isArray(value)) {
          const elementType = targetType.replace('[]', '') as ScriptTypeName
          return value.map(v => ScriptTypes.fromScriptValue(v, elementType))
        }
        throw new Error(`Cannot convert ${typeof value} to ${targetType}`)

      default:
        throw new Error(`Unknown target type: ${targetType}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Lua-Specific Value Conversion (Phase G)
  // ---------------------------------------------------------------------------

  /**
   * Convert a TypeScript game object to an OpenRA-compatible Lua value format.
   *
   * OpenRA 对照: object.ToLuaValue(ScriptContext)
   *
   * Differs from toScriptValue in key casing to match OpenRA's Lua API:
   * - CPos → { X: number, Y: number, Layer: number }
   * - WPos → { X: number, Y: number, Z: number }
   * - CVec → { X: number, Y: number }
   * - WVec → { X: number, Y: number, Z: number }
   *
   * This uses UPPERCASE keys for coordinate types, matching the convention
   * used by OpenRA's original Lua API.
   *
   * Non-coordinate types (primitives, arrays, Color, Actor, Player, WAngle,
   * WDist, WRot) use the same format as toScriptValue.
   *
   * @param obj — the game object to convert
   * @param context — the script context (needed for creating wrappers)
   * @returns the Lua-compatible value
   * @throws Error if the object type cannot be converted
   */
  static toLuaValue(obj: unknown, context: IScriptContext): unknown {
    // null/undefined → null
    if (obj === null || obj === undefined) return null

    // Primitives — passthrough
    if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'string') return obj

    // Game primitives with UPPERCASE keys
    if (obj instanceof CPos) return { X: obj.X, Y: obj.Y, Layer: obj.Layer }
    if (obj instanceof WPos) return { X: obj.X, Y: obj.Y, Z: obj.Z }
    if (obj instanceof CVec) return { X: obj.X, Y: obj.Y }
    if (obj instanceof WVec) return { X: obj.X, Y: obj.Y, Z: obj.Z }
    if (obj instanceof WAngle) return obj.angle
    if (obj instanceof WDist) return obj.length
    if (obj instanceof WRot) return { Yaw: obj.yaw?.angle ?? 0, Pitch: obj.pitch?.angle ?? 0, Roll: obj.roll?.angle ?? 0 }

    // Array — recursively convert elements
    if (Array.isArray(obj)) {
      return (obj as unknown[]).map(item => ScriptTypes.toLuaValue(item, context))
    }

    // For Color, Actor, Player — reuse toScriptValue logic since those are
    // unchanged between JSON and Lua formats
    if (ScriptTypes._isColorStub(obj)) return { r: obj.r, g: obj.g, b: obj.b, a: obj.a }

    // IScriptBindable — use existing toScriptValue path
    if (typeof obj === 'object' && obj !== null) {
      if (ScriptTypes._isActor(obj)) {
        const actor = obj as IGameActor
        return (context as any).createActorInterface?.(actor) ?? actor
      }
      if (ScriptTypes._isPlayer(obj)) {
        const player = obj as PlayerStub
        return (context as any).createPlayerInterface?.(player) ?? player
      }
      return obj
    }

    throw new Error(`Cannot convert type '${typeof obj}' to Lua value.`)
  }

  /**
   * Convert a Lua value (obtained via interop.tojs()) to a TypeScript game object.
   *
   * OpenRA 对照: LuaValue.TryGetClrValue(Type, out object) — Lua path
   *
   * This extends fromScriptValue with Lua-specific conversions:
   * - Accepts both { X: ..., Y: ... } (uppercase keys, Lua convention) and
   *   { x: ..., y: ... } (lowercase keys, JSON convention) for coordinate types.
   * - Lua tables → plain objects or arrays (depending on keys).
   * - Lua nil → null.
   * - Lua functions → passed through as callable.
   *
   * @param luaValue — a value obtained via interop.tojs(L, idx)
   * @param targetType — the expected TypeScript type name
   * @returns the converted game object
   * @throws Error if conversion is not possible
   */
  static fromLuaValue(luaValue: unknown, targetType: ScriptTypeName): unknown {
    // null/nil handling
    if (luaValue === null || luaValue === undefined) {
      if (targetType === 'nil') return null
      return null
    }

    // Try fromScriptValue first (handles lowercase keys and primitive types)
    try {
      return ScriptTypes.fromScriptValue(luaValue, targetType)
    } catch {
      // fromScriptValue failed — try Lua-specific uppercase-key formats
    }

    // Handle coordinate types with UPPERCASE keys (OpenRA Lua convention)
    switch (targetType) {
      case 'CPos':
        if (typeof luaValue === 'object' && luaValue !== null) {
          const v = luaValue as Record<string, unknown>
          return new CPos(
            Number(v.X ?? v.x ?? 0),
            Number(v.Y ?? v.y ?? 0),
          )
        }
        throw new Error(`Cannot convert ${typeof luaValue} to CPos`)

      case 'WPos':
        if (typeof luaValue === 'object' && luaValue !== null) {
          const v = luaValue as Record<string, unknown>
          return new WPos(
            Number(v.X ?? v.x ?? 0),
            Number(v.Y ?? v.y ?? 0),
            Number(v.Z ?? v.z ?? 0),
          )
        }
        throw new Error(`Cannot convert ${typeof luaValue} to WPos`)

      case 'CVec':
        if (typeof luaValue === 'object' && luaValue !== null) {
          const v = luaValue as Record<string, unknown>
          return new CVec(
            Number(v.X ?? v.x ?? 0),
            Number(v.Y ?? v.y ?? 0),
          )
        }
        throw new Error(`Cannot convert ${typeof luaValue} to CVec`)

      case 'WVec':
        if (typeof luaValue === 'object' && luaValue !== null) {
          const v = luaValue as Record<string, unknown>
          return new WVec(
            Number(v.X ?? v.x ?? 0),
            Number(v.Y ?? v.y ?? 0),
            Number(v.Z ?? v.z ?? 0),
          )
        }
        throw new Error(`Cannot convert ${typeof luaValue} to WVec`)

      case 'WRot':
        if (typeof luaValue === 'object' && luaValue !== null) {
          const v = luaValue as Record<string, unknown>
          const ra = Number(
            v.Roll ?? v.roll ?? v.R ?? v.r ?? 0,
          )
          const pa = Number(
            v.Pitch ?? v.pitch ?? v.P ?? v.p ?? 0,
          )
          const ya = Number(
            v.Yaw ?? v.yaw ?? v.Y ?? v.y ?? 0,
          )
          return new WRot(
            ra !== 0 ? new WAngle(ra) : ra as unknown as WAngle,
            pa !== 0 ? new WAngle(pa) : pa as unknown as WAngle,
            ya !== 0 ? new WAngle(ya) : ya as unknown as WAngle,
          )
        }
        throw new Error(`Cannot convert ${typeof luaValue} to WRot`)

      case 'number':
        if (typeof luaValue === 'number') return luaValue
        throw new Error(`Cannot convert ${typeof luaValue} to number`)

      case 'string':
        if (typeof luaValue === 'string') return luaValue
        throw new Error(`Cannot convert ${typeof luaValue} to string`)

      case 'boolean':
        if (typeof luaValue === 'boolean') return luaValue
        throw new Error(`Cannot convert ${typeof luaValue} to boolean`)

      case 'WAngle':
        if (typeof luaValue === 'number') return new WAngle(luaValue)
        throw new Error(`Cannot convert ${typeof luaValue} to WAngle`)

      case 'WDist':
        if (typeof luaValue === 'number') return new WDist(luaValue)
        throw new Error(`Cannot convert ${typeof luaValue} to WDist`)

      case 'function':
        if (typeof luaValue === 'function') return luaValue
        throw new Error(`Cannot convert ${typeof luaValue} to function`)

      case 'table':
      case 'any':
        return luaValue

      default:
        // Fall back to fromScriptValue
        return ScriptTypes.fromScriptValue(luaValue, targetType)
    }
  }

  // ---------------------------------------------------------------------------
  // Type Checking
  // ---------------------------------------------------------------------------

  /**
   * Get the type name of a value in the script context.
   *
   * OpenRA 对照: LuaValue.WrappedClrType()
   *
   * @param value — the script value to check
   * @returns the type name string
   */
  static typeOf(value: unknown): ScriptTypeName {
    if (value === null || value === undefined) return 'nil'
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'function') return 'function'
    if (Array.isArray(value)) return 'table'
    if (value instanceof CPos) return 'CPos'
    if (value instanceof WPos) return 'WPos'
    if (value instanceof WAngle) return 'WAngle'
    if (value instanceof WDist) return 'WDist'
    if (value instanceof WRot) return 'WRot'
    if (value instanceof WVec) return 'WVec'
    if (value instanceof CVec) return 'CVec'
    if (ScriptTypes._isColorStub(value)) return 'Color'
    if (ScriptTypes._isActor(value)) return 'Actor'
    if (ScriptTypes._isPlayer(value)) return 'Player'
    if (typeof value === 'object') return 'table'
    // NOTE: In Lua Tier 2 (Phase G), this could return a Lua type name
    return 'any'
  }

  /**
   * Check whether a script value can be converted to the given type.
   *
   * OpenRA 对照: LuaValue.TryGetClrValue<T>(out T) — boolean return
   *
   * @param value — the script value to check
   * @param targetType — the expected type name
   * @returns true if conversion is possible
   */
  static canConvert(value: unknown, targetType: ScriptTypeName): boolean {
    try {
      ScriptTypes.fromScriptValue(value, targetType)
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Resource Management
  // ---------------------------------------------------------------------------

  /**
   * Dispose a script value, releasing any resources it holds.
   *
   * OpenRA 对照: LuaValue.Dispose() pattern
   *
   * In Tier 1 (JSON), this is a no-op for primitives.
   * In Tier 2 (fengari), this disposes Lua values to prevent memory leaks.
   *
   * Call this when you're done with a script value, especially
   * array elements that were individually converted.
   *
   * @param value — the script value to dispose
   */
  static disposeScriptValue(_value: unknown): void {
    // No-op for Tier 1 (JSON primitives don't need disposal)
    // Phase G (fengari): will call dispose() on Lua values
  }

  // ---------------------------------------------------------------------------
  // Private helpers — type detection
  // ---------------------------------------------------------------------------

  /** Check if an object implements the IScriptBindable marker. */
  private static _isScriptBindable(obj: unknown): obj is IScriptBindable {
    return typeof obj === 'object' && obj !== null
  }

  /** Check if an object is a ColorStub (has r, g, b, a number properties). */
  private static _isColorStub(obj: unknown): obj is { r: number; g: number; b: number; a: number } {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as any).r === 'number' &&
      typeof (obj as any).g === 'number' &&
      typeof (obj as any).b === 'number' &&
      typeof (obj as any).a === 'number'
    )
  }

  /** Check if an object is an IGameActor. */
  private static _isActor(obj: unknown): obj is IGameActor {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'actorId' in (obj as Record<string, unknown>) &&
      'isInWorld' in (obj as Record<string, unknown>)
    )
  }

  /** Check if an object is a PlayerStub. */
  private static _isPlayer(obj: unknown): obj is PlayerStub {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'playerName' in (obj as Record<string, unknown>)
    )
  }

}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------

export type { ScriptTypeName, IScriptContext }
