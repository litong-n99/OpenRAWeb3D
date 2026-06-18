/**
 * ScriptObjectWrapper.ts — Abstract base for script-exposed objects
 * OpenRA 对照: ScriptObjectWrapper.cs
 *
 * 核心范式转换:
 * - C# ILuaTableBinding (key/value access through Lua runtime)
 *   → TypeScript get/set/containsKey methods with explicit MemberDescriptors
 * - C# reflection-based Bind(objects[]) via WrappableMembers()
 *   → Subclass-provided getMemberDescriptors(obj) returning explicit descriptors
 * - C# ScriptGlobal extends ScriptObjectWrapper (more specific error messages)
 *   → ScriptGlobal also defined in this file, matching OpenRA structure
 */

import type { IScriptContext } from './ScriptMemberDescriptor.js'
import type { MemberDescriptor, MethodDescriptor, PropertyDescriptor } from './ScriptMemberDescriptor.js'
import { ScriptTypes } from './ScriptTypes.js'

// ---------------------------------------------------------------------------
// Internal — BoundMemberDescriptor (not exported)
// ---------------------------------------------------------------------------

/**
 * Internal type: a MemberDescriptor with runtime binding info attached.
 * We use a separate interface rather than extending the union type.
 */
interface BoundMemberDescriptorCommon {
  _target: object
  _ownerCtor: new (...args: any[]) => any
}

type BoundPropertyDescriptor = PropertyDescriptor & BoundMemberDescriptorCommon
type BoundMethodDescriptor = MethodDescriptor & BoundMemberDescriptorCommon
type BoundMemberDescriptor = BoundPropertyDescriptor | BoundMethodDescriptor

// ---------------------------------------------------------------------------
// ScriptObjectWrapper — abstract base
// ---------------------------------------------------------------------------

/**
 * Abstract base class for objects exposed to the scripting system.
 *
 * OpenRA 对照: ScriptObjectWrapper (ScriptObjectWrapper.cs:19-95)
 *
 * Implements IScriptBindable + ILuaTableBinding (get/set/contains).
 * Manages a dictionary of script-accessible members.
 *
 * Paradigm shift:
 * - C# uses reflection to discover members:
 *     ScriptMemberWrapper.WrappableMembers(obj.GetType()) → MemberInfo[]
 * - TS uses explicit MemberDescriptor objects:
 *     subclasses override getMemberDescriptors() → MemberDescriptor[]
 *
 * Subclasses:
 * - ScriptGlobal: top-level API tables (Actor, Trigger, Media, ...)
 * - ScriptActorInterface: actor-scoped wrapper with trait filtering
 * - ScriptPlayerInterface: player-scoped wrapper
 */
export abstract class ScriptObjectWrapper {
  /** The owning ScriptContext. */
  protected readonly context: IScriptContext

  /** The member dictionary (name → BoundMemberDescriptor). */
  private _members = new Map<string, BoundMemberDescriptor>()

  constructor(context: IScriptContext) {
    this.context = context
  }

  // ---------------------------------------------------------------------------
  // Abstract — error message templates
  // ---------------------------------------------------------------------------

  /**
   * Error message when a member name is defined on multiple bound objects.
   *
   * OpenRA 对照: ScriptObjectWrapper.DuplicateKeyError(string)
   */
  protected abstract duplicateKeyError(memberName: string): string

  /**
   * Error message when a requested member is not found.
   *
   * OpenRA 对照: ScriptObjectWrapper.MemberNotFoundError(string)
   */
  protected abstract memberNotFoundError(memberName: string): string

  // ---------------------------------------------------------------------------
  // Bind / Unbind
  // ---------------------------------------------------------------------------

  /**
   * Bind one or more objects — expose their public methods/properties
   * to the scripting system.
   *
   * OpenRA 对照: ScriptObjectWrapper.Bind(object[])
   *
   * For each object in the array, calls getMemberDescriptors() to
   * obtain the list of members to expose. Each member is added to
   * the internal dictionary. Throws if a duplicate member name is found.
   *
   * Paradigm shift:
   * - C# reflection discovers members via ScriptMemberWrapper.WrappableMembers(Type)
   * - TS uses explicit getMemberDescriptors(obj) override in subclasses
   *
   * @param objects — the objects to bind (typically [this] for ScriptGlobal,
   *   or [propertyInstance1, propertyInstance2, ...] for interfaces)
   */
  protected bind(objects: object[]): void {
    this._members.clear()

    for (const obj of objects) {
      const descriptors = this.getMemberDescriptors(obj)
      for (const desc of descriptors) {
        if (this._members.has(desc.name)) {
          throw new Error(this.duplicateKeyError(desc.name))
        }
        const bindingInfo: BoundMemberDescriptorCommon = {
          _target: obj,
          _ownerCtor: (obj as any).constructor as new (...args: any[]) => any,
        }
        if (desc.memberType === 'property') {
          this._members.set(desc.name, { ...desc, ...bindingInfo } as BoundPropertyDescriptor)
        } else {
          this._members.set(desc.name, { ...desc, ...bindingInfo } as BoundMethodDescriptor)
        }
      }
    }
  }

  /**
   * Remove all members belonging to a specific target class.
   *
   * OpenRA 对照: ScriptObjectWrapper.Unbind(Type)
   *
   * Used by ScriptActorInterface when an actor is destroyed — it
   * unbinds property groups not marked ExposedForDestroyedActors.
   *
   * @param targetCtor — the constructor of the class to unbind
   */
  protected unbind(targetCtor: new (...args: any[]) => any): void {
    for (const [key, desc] of this._members) {
      if (desc._ownerCtor === targetCtor) {
        this._members.delete(key)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lua-table-like access
  // ---------------------------------------------------------------------------

  /**
   * Check if a named member exists.
   *
   * OpenRA 对照: ScriptObjectWrapper.ContainsKey(string) → bool
   */
  containsKey(key: string): boolean {
    return this._members.has(key)
  }

  /**
   * Get the value of a named member.
   *
   * OpenRA 对照: ScriptObjectWrapper[LuaRuntime, LuaValue].get
   *
   * For properties: calls the getter and converts the result via toScriptValue().
   * For methods: returns the invocation function.
   *
   * @param key — the member name
   * @returns the script-compatible value
   * @throws Error if the member is not found
   */
  get(key: string): unknown {
    const desc = this._members.get(key)
    if (!desc) {
      throw new Error(this.memberNotFoundError(key))
    }

    if (desc.memberType === 'property') {
      if (!desc.get) throw new Error(`The property '${key}' is write-only`)
      return ScriptTypes.toScriptValue(desc.get(desc._target), this.context)
    }

    if (desc.memberType === 'method') {
      // Return a callable wrapper with argument conversion
      const methodDesc = desc
      return (...args: unknown[]) => {
        const convertedArgs = this._convertArgs(methodDesc, args)
        const result = methodDesc.invoke(methodDesc._target, convertedArgs)
        return ScriptTypes.toScriptValue(result, this.context)
      }
    }

    throw new Error(this.memberNotFoundError(key))
  }

  /**
   * Set the value of a named member.
   *
   * OpenRA 对照: ScriptObjectWrapper[LuaRuntime, LuaValue].set
   *
   * @param key — the member name
   * @param value — the script-compatible value
   * @throws Error if the member is not found or is read-only
   */
  set(key: string, value: unknown): void {
    const desc = this._members.get(key)
    if (!desc) {
      throw new Error(this.memberNotFoundError(key))
    }

    if (desc.memberType !== 'property') {
      throw new Error(`The member '${key}' is a method and cannot be set`)
    }

    if (!desc.set) {
      throw new Error(`The property '${key}' is read-only`)
    }

    // Convert script value to internal type
    const convertedValue = ScriptTypes.fromScriptValue(
      value,
      desc.returnType,
    )
    desc.set(desc._target, convertedValue)
  }

  // ---------------------------------------------------------------------------
  // Abstract — member discovery
  // ---------------------------------------------------------------------------

  /**
   * Get the script-exposed member descriptors for an object.
   *
   * OpenRA 对照: ScriptMemberWrapper.WrappableMembers(Type)
   *
   * Subclasses override this to provide the list of public methods/properties
   * that should be accessible from scripts.
   *
   * Each ScriptActorProperties and ScriptPlayerProperties subclass uses
   * this to declare which methods/properties are available.
   *
   * @param obj — the object to discover members from
   * @returns array of member descriptors
   */
  protected abstract getMemberDescriptors(obj: object): MemberDescriptor[]

  // ---------------------------------------------------------------------------
  // Internal argument conversion
  // ---------------------------------------------------------------------------

  /**
   * Convert script arguments to internal types using fromScriptValue.
   *
   * OpenRA 对照: ScriptMemberWrapper.Invoke — TryGetClrValue(pi[j].ParameterType, out clrArgs[j])
   */
  private _convertArgs(desc: MethodDescriptor, args: unknown[]): unknown[] {
    const params = desc.parameters
    const converted: unknown[] = []

    for (let i = 0; i < params.length; i++) {
      if (i >= args.length) {
        if (params[i].optional) {
          converted.push(params[i].defaultValue)
          continue
        }
        throw new Error(
          `Argument '${params[i].name}' is required but was not provided (method: ${desc.name})`,
        )
      }

      converted.push(
        ScriptTypes.fromScriptValue(args[i], params[i].type),
      )
    }

    // Pass through any extra args beyond declared params (Lua→TS calls may
    // have dynamic arguments without statically declared parameter descriptors)
    for (let i = params.length; i < args.length; i++) {
      converted.push(args[i])
    }

    return converted
  }
}

// ---------------------------------------------------------------------------
// ScriptGlobal — abstract base for global API tables
// ---------------------------------------------------------------------------

/**
 * Abstract base class for global API tables exposed to scripts.
 *
 * OpenRA 对照: ScriptGlobal (ScriptContext.cs:76-111)
 *
 * Each subclass provides a set of top-level script-accessible methods
 * and properties (e.g., Actor.Create, Trigger.OnKilled, Media.PlayMusic).
 *
 * Paradigm shift:
 * - C# uses [ScriptGlobal("name")] attribute + reflection → constructor discovery
 * - TS passes the name explicitly to super() and registers via ScriptRegistry.registerGlobal()
 *
 * Subclasses:
 * - Phase C: ActorGlobal, TriggerGlobal, MediaGlobal, MapGlobal, etc. (16 files)
 */
export abstract class ScriptGlobal extends ScriptObjectWrapper {
  /** The global table name exposed to scripts (e.g., "Actor", "Trigger"). */
  readonly name: string

  /**
   * @param context — the owning ScriptContext
   * @param name — the global table name (e.g., "Actor", "Trigger")
   *
   * Note: Subclasses MUST call this.bind([this]) after super() returns,
   * because `this` is not available before super() in TS strict mode.
   */
  constructor(context: IScriptContext, name: string) {
    super(context)
    this.name = name
  }

  protected override duplicateKeyError(memberName: string): string {
    return `Table '${this.name}' defines multiple members '${memberName}'`
  }

  protected override memberNotFoundError(memberName: string): string {
    return `Table '${this.name}' does not define a property '${memberName}'`
  }

  /**
   * Filter an array of objects using a dynamic filter function.
   *
   * OpenRA 对照: ScriptGlobal.FilteredObjects<T>(IEnumerable<T>, LuaFunction)
   *
   * In Phase A, this delegates to a JSON Callable (Phase B).
   * When fengari Lua VM is active (Phase G), this accepts Lua functions too.
   *
   * @param objects — the array to filter
   * @param filter — a predicate function (from JSON or Lua)
   * @returns filtered array
   */
  protected filterObjects<T>(
    objects: T[],
    filter?: (item: unknown) => boolean,
  ): T[] {
    if (!filter) return objects
    return objects.filter(item => {
      const scriptValue = ScriptTypes.toScriptValue(item, this.context)
      try {
        return filter(scriptValue)
      } finally {
        ScriptTypes.disposeScriptValue(scriptValue)
      }
    })
  }
}
