/**
 * ActorInitializer.ts — Actor initialization data: init types and collection class
 * OpenRA 对照: OpenRA.Game/Map/ActorInitializer.cs
 *
 * 核心范式转换:
 * - C# generic type-keyed TypeDictionary with ISingleInstanceInit
 *   → string-based typeName lookup with Map<string, ActorInit[]>
 * - C# ValueActorInit<T> with reflection-based FieldLoader
 *   → TypeScript ValueActorInit<T> with direct constructor value
 * - C# OwnerInit dual-mode (Player object OR string InternalName)
 *   → OwnerNameInit (string, for two-phase resolution) distinct from Player reference
 * - C# CPos/WAngle value types
 *   → TypeScript CPos/number (WAngle degrees)
 */

import type { CPos } from '../CPos.js'
import type { PlayerStub } from './TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ActorInit — abstract base for all initialization data types
// OpenRA 对照: ActorInit abstract class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for actor initialization data.
 *
 * OpenRA 对照: ActorInit
 *
 * Each subclass carries a `typeName` static string used for lookup in the
 * ActorInitializer collection. The optional `instanceName` allows targeting
 * specific trait instances (e.g., "Turreted@primary").
 */
export abstract class ActorInit {
  /** Unique type identifier for lookup (e.g., "LocationInit", "OwnerNameInit").
   *
   * OpenRA 对照: typeof(ActorInit).Name
   */
  static readonly typeName: string = 'ActorInit'

  /** Optional trait instance name for targeted initialization.
   *
   * OpenRA 对照: ActorInit.InstanceName
   */
  readonly instanceName: string

  constructor(instanceName: string = '') {
    this.instanceName = instanceName
  }
}

// ---------------------------------------------------------------------------
// ISingleInstanceInit — marker for unique inits
// OpenRA 对照: ISingleInstanceInit
// ---------------------------------------------------------------------------

/**
 * Marker interface for inits that should only appear once per actor.
 *
 * OpenRA 对照: ISingleInstanceInit
 *
 * Single-instance inits can be queried without a TraitInfo target.
 */
export interface ISingleInstanceInit {
  // intentionally empty — marker interface
}

// ---------------------------------------------------------------------------
// ValueActorInit<T> — typed value init
// OpenRA 对照: ValueActorInit<T>
// ---------------------------------------------------------------------------

/**
 * An ActorInit carrying a typed value.
 *
 * OpenRA 对照: ValueActorInit<T>
 *
 * @typeParam T — the value type carried by this init
 */
export abstract class ValueActorInit<T> extends ActorInit {
  /** The value carried by this init.
   *
   * OpenRA 对照: ValueActorInit<T>.Value
   */
  readonly value: T

  constructor(value: T, instanceName: string = '') {
    super(instanceName)
    this.value = value
  }
}

// ---------------------------------------------------------------------------
// LocationInit — starting cell position
// OpenRA 对照: LocationInit(CPos value) : ValueActorInit<CPos>, ISingleInstanceInit
// ---------------------------------------------------------------------------

/**
 * Starting cell position for a spawned actor.
 *
 * OpenRA 对照: LocationInit
 *
 * Placed on the actor's OccupiesSpace trait during construction.
 */
export class LocationInit extends ValueActorInit<CPos> implements ISingleInstanceInit {
  static override readonly typeName = 'LocationInit'

  constructor(value: CPos) {
    super(value)
  }
}

// ---------------------------------------------------------------------------
// OwnerNameInit — owner player name (string, resolved later)
// OpenRA 对照: OwnerInit(string value) constructor
// ---------------------------------------------------------------------------

/**
 * Owner player name as a string, resolved to PlayerStub during world loading.
 *
 * OpenRA 对照: OwnerInit(string value) — the string-based constructor
 *
 * In OpenRA, OwnerInit can be constructed with either a Player object OR a
 * string (InternalName). During map parsing, the string form is used because
 * Player instances don't exist yet. Resolution happens when the world is
 * fully loaded and all Player instances have been created.
 *
 * This is distinct from the Player-reference form (which would be called
 * `OwnerInit` in C#). We separate them in TypeScript because:
 * - Map parsing produces strings (owner names)
 * - World loading produces PlayerStub references
 * - Two-phase resolution clarifies intent
 */
export class OwnerNameInit extends ValueActorInit<string> implements ISingleInstanceInit {
  static override readonly typeName = 'OwnerNameInit'

  constructor(ownerName: string) {
    super(ownerName)
  }
}

// ---------------------------------------------------------------------------
// FacingInit — initial facing direction
// OpenRA 对照: FacingInit (WAngle value)
// ---------------------------------------------------------------------------

/**
 * Initial facing direction for a spawned actor.
 *
 * OpenRA 对照: FacingInit (WAngle value, defined in various trait files)
 *
 * In OpenRA, FacingInit is defined in multiple trait files as:
 *   class FacingInit(WAngle value) : ValueActorInit<WAngle>
 *
 * We use a number representing the facing angle in WAngle units (0-1023).
 */
export class FacingInit extends ValueActorInit<number> implements ISingleInstanceInit {
  static override readonly typeName = 'FacingInit'

  constructor(value: number) {
    super(value)
  }
}

// ---------------------------------------------------------------------------
// OwnerInit — resolved Player reference init
// OpenRA 对照: OwnerInit(Player value) constructor
// ---------------------------------------------------------------------------

/**
 * Resolved player reference for actor ownership.
 *
 * OpenRA 对照: OwnerInit(Player value) — the Player-object constructor
 *
 * This is the resolved form — set during world loading after OwnerNameInit
 * has been resolved against the world's player list.
 */
export class OwnerInit extends ValueActorInit<PlayerStub> implements ISingleInstanceInit {
  static override readonly typeName = 'OwnerInit'

  constructor(value: PlayerStub) {
    super(value)
  }
}

// ---------------------------------------------------------------------------
// ActorInitializer — collection of inits with query methods
// OpenRA 对照: ActorInitializer class implements IActorInitializer
// ---------------------------------------------------------------------------

/**
 * Collection of ActorInit instances for one actor, with typed query methods.
 *
 * OpenRA 对照: ActorInitializer
 *
 * Stores inits in a Map keyed by typeName. Supports:
 * - getOrDefault<T>(typeName) — get the first matching init or null
 * - get<T>(typeName) — get the first matching init or throw
 * - getValue<T>(typeName) — get the value of a ValueActorInit
 * - getValue<T>(typeName, fallback) — get the value or a fallback
 * - contains(typeName) — check if an init type is present
 *
 * Per-instance-name targeting: inits with a matching instanceName take
 * priority over unnamed inits (matching OpenRA's trait-instance-aware lookup).
 */
export class ActorInitializer {
  /** Internal storage: typeName → array of ActorInit instances. */
  private readonly _inits = new Map<string, ActorInit[]>()

  // -----------------------------------------------------------------------
  // Construction (对应 OpenRA ActorInitializer constructor)
  // -----------------------------------------------------------------------

  /**
   * Create an ActorInitializer with the given inits.
   *
   * OpenRA 对照: ActorInitializer(Actor, TypeDictionary)
   *
   * @param inits — array of ActorInit instances (duplicates allowed)
   */
  constructor(inits: readonly ActorInit[] = []) {
    for (const init of inits) {
      const typeName = (init.constructor as typeof ActorInit).typeName
      let list = this._inits.get(typeName)
      if (!list) {
        list = []
        this._inits.set(typeName, list)
      }
      list.push(init)
    }
  }

  // -----------------------------------------------------------------------
  // Query: generic by typeName (对应 OpenRA IActorInitializer generic methods)
  // -----------------------------------------------------------------------

  /**
   * Get the first init of a given type, or null if not present.
   *
   * OpenRA 对照: IActorInitializer.GetOrDefault<T>(TraitInfo)
   *
   * @param typeName — the init type name (e.g., "LocationInit")
   * @param instanceName — optional trait instance name for targeted lookup
   * @returns the init, or null if not found
   */
  getOrDefault<T extends ActorInit>(typeName: string, instanceName?: string): T | null {
    const list = this._inits.get(typeName)
    if (!list || list.length === 0) return null

    if (instanceName) {
      // Prefer inits with matching instanceName, fall back to unnamed
      const named = list.findLast(i => i.instanceName === instanceName)
      if (named) return named as T
      return list.findLast(i => !i.instanceName) as T ?? null
    }

    // Untagged query: return last unnamed init (standard YAML override semantics)
    return list.findLast(i => !i.instanceName) as T ?? null
  }

  /**
   * Get the first init of a given type, or throw if not present.
   *
   * OpenRA 对照: IActorInitializer.Get<T>(TraitInfo)
   *
   * @param typeName — the init type name
   * @param instanceName — optional trait instance name for targeted lookup
   * @returns the init
   * @throws if no init of the given type is found
   */
  get<T extends ActorInit>(typeName: string, instanceName?: string): T {
    const init = this.getOrDefault<T>(typeName, instanceName)
    if (!init) {
      throw new Error(
        `ActorInitializer does not contain init of type '${typeName}'` +
        (instanceName ? ` (instance: '${instanceName}')` : ''),
      )
    }
    return init
  }

  /**
   * Get the value of a ValueActorInit, or throw if not present.
   *
   * OpenRA 对照: IActorInitializer.GetValue<T, U>(TraitInfo)
   *
   * @param typeName — the init type name
   * @param instanceName — optional trait instance name
   * @returns the value carried by the init
   * @throws if no init of the given type is found
   */
  getValue<T>(typeName: string, instanceName?: string): T {
    const init = this.get<ValueActorInit<T>>(typeName, instanceName)
    return init.value
  }

  /**
   * Get the value of a ValueActorInit, or return a fallback if not present.
   *
   * OpenRA 对照: IActorInitializer.GetValue<T, U>(TraitInfo, U fallback)
   *
   * @param typeName — the init type name
   * @param fallback — value to return if init not found
   * @param instanceName — optional trait instance name
   * @returns the value or fallback
   */
  getValueOrDefault<T>(typeName: string, fallback: T, instanceName?: string): T {
    const init = this.getOrDefault<ValueActorInit<T>>(typeName, instanceName)
    return init ? init.value : fallback
  }

  /**
   * Check if an init of the given type is present.
   *
   * OpenRA 对照: IActorInitializer.Contains<T>(TraitInfo)
   *
   * @param typeName — the init type name
   * @param instanceName — optional trait instance name
   * @returns true if at least one init of the given type is present
   */
  contains(typeName: string, instanceName?: string): boolean {
    return this.getOrDefault(typeName, instanceName) !== null
  }

  // -----------------------------------------------------------------------
  // All inits accessor
  // -----------------------------------------------------------------------

  /**
   * Get all inits in this collection (for iteration).
   *
   * NOTE: Non-OpenRA — added for convenience in createActor pipeline.
   */
  allInits(): readonly ActorInit[] {
    const result: ActorInit[] = []
    for (const list of this._inits.values()) {
      result.push(...list)
    }
    return result
  }

  /**
   * Get all init type names present in this collection.
   */
  initTypes(): readonly string[] {
    return Array.from(this._inits.keys())
  }

  /**
   * Number of inits in this collection.
   */
  get size(): number {
    let count = 0
    for (const list of this._inits.values()) {
      count += list.length
    }
    return count
  }
}
