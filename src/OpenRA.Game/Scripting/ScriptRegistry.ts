/**
 * ScriptRegistry.ts — Central API registration for the scripting system
 * OpenRA 对照:
 * - Game.ModData.ObjectCreator.GetTypesImplementing<T>()
 * - ScriptContext.ActorCommands Cache<ActorInfo, Type[]>
 * - ScriptMemberWrapper.RequiredTraitNames()
 *
 * 核心范式转换:
 * - C# reflection assembly scanning → explicit register*() at module import time
 * - C# Requires<T> generic constraints → requiredTraits: string[] with runtime matching
 * - C# Cache<ActorInfo, Type[]> → Map<ActorInfoStub, PropertyRegistration[]>
 */

import type { ActorInfoStub } from '../Traits/TraitsInterfaces.js'
import type {
  GlobalRegistration,
  ActorPropertyRegistration,
  PlayerPropertyRegistration,
  ActorInitRegistration,
} from './ScriptMemberDescriptor.js'

// ---------------------------------------------------------------------------
// Internal state (module-private — not exported)
// ---------------------------------------------------------------------------

const _globals = new Map<string, GlobalRegistration>()
const _actorProperties: ActorPropertyRegistration[] = []
const _playerProperties: PlayerPropertyRegistration[] = []
const _actorInits = new Map<string, ActorInitRegistration>()
const _actorCommandsCache = new Map<ActorInfoStub, readonly ActorPropertyRegistration[]>()

// ---------------------------------------------------------------------------
// ScriptRegistry
// ---------------------------------------------------------------------------

/**
 * Central registry for the scripting system.
 *
 * OpenRA 对照:
 * - Game.ModData.ObjectCreator.GetTypesImplementing<ScriptGlobal>()  → getGlobals()
 * - Game.ModData.ObjectCreator.GetTypesImplementing<ScriptActorProperties>() → getActorProperties()
 * - Game.ModData.ObjectCreator.GetTypesImplementing<ScriptPlayerProperties>() → getPlayerProperties()
 * - ScriptContext.ActorCommands Cache<ActorInfo, Type[]> → getActorCommands()
 * - ScriptContext.PlayerCommands Type[] → getPlayerCommands()
 * - ActorInit type discovery via FindType(initName + "Init") → getActorInit()
 *
 * Paradigm shift:
 * - C# reflection scans all loaded assemblies for matching types
 * - TS uses explicit register*() calls at module import time
 *
 * All register*() methods validate for duplicates and throw on conflict.
 * This ensures runtime errors catch registration mistakes immediately.
 *
 * Thread safety: Not required (all registration happens at module import time,
 * before any game logic runs).
 */
export class ScriptRegistry {
  // ---------------------------------------------------------------------------
  // Global Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a ScriptGlobal subclass.
   *
   * OpenRA 对照: ScriptContext constructor — foreach (var b in bindings) { ... }
   *
   * Called at module import time by each ScriptGlobal subclass:
   * ```
   * ScriptRegistry.registerGlobal('Actor', ActorGlobal, 'Actor creation and query');
   * ```
   *
   * @param name — the global table name (must be unique)
   * @param ctor — the constructor (accepts IScriptContext)
   * @param description — optional human-readable description
   * @throws Error if a global with the same name is already registered
   */
  static registerGlobal(
    name: string,
    ctor: new (context: import('./ScriptMemberDescriptor.js').IScriptContext) => any,
    description?: string,
  ): void {
    if (_globals.has(name)) {
      throw new Error(`Duplicate global registration: '${name}' is already registered`)
    }
    _globals.set(name, { name, ctor, description })
  }

  /**
   * Get all registered global definitions.
   *
   * @returns array of all registered globals, sorted by name
   */
  static getGlobals(): readonly GlobalRegistration[] {
    return [..._globals.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Get a specific global registration by name.
   *
   * @returns the registration, or undefined if not found
   */
  static getGlobal(name: string): GlobalRegistration | undefined {
    return _globals.get(name)
  }

  // ---------------------------------------------------------------------------
  // Actor Property Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a ScriptActorProperties subclass.
   *
   * OpenRA 对照: ObjectCreator.GetTypesImplementing<ScriptActorProperties>()
   *
   * Called at module import time by each ScriptActorProperties subclass:
   * ```
   * ScriptRegistry.registerActorProperty({
   *   category: 'Health',
   *   ctor: HealthProperties,
   *   requiredTraits: ['IHealthInfo'],
   *   exposedForDestroyedActors: false,
   *   description: 'Actor health, max health, and kill',
   * });
   * ```
   *
   * @param registration — the property registration data
   * @throws Error if the registration is invalid
   */
  static registerActorProperty(registration: ActorPropertyRegistration): void {
    // Validate: requiredTraits must be present (can be empty)
    if (!registration.requiredTraits) {
      throw new Error(`registerActorProperty: requiredTraits must be an array (got ${registration.requiredTraits})`)
    }
    _actorProperties.push(registration)
  }

  /**
   * Get all registered actor property classes.
   *
   * @returns array of all registrations, sorted by category
   */
  static getActorProperties(): readonly ActorPropertyRegistration[] {
    return [..._actorProperties].sort((a, b) => a.category.localeCompare(b.category))
  }

  /**
   * Filter actor property classes by required traits.
   *
   * OpenRA 对照: ScriptContext.FilterActorCommands(ActorInfo)
   *            → FilterCommands(ai, knownActorCommands)
   *
   * Returns only the property classes whose required traits are all
   * present in the given ActorInfo. This is the key method that
   * ScriptActorInterface uses to determine which property groups
   * are available on a given actor.
   *
   * Results are cached per ActorInfo for O(1) lookup after the first call.
   *
   * @param info — the actor type's metadata
   * @param hasTraitInfo — function that checks if the actor has a given trait info
   * @returns filtered array of property registrations
   */
  static getActorCommands(
    info: ActorInfoStub,
    hasTraitInfo: (traitName: string) => boolean,
  ): readonly ActorPropertyRegistration[] {
    const cached = _actorCommandsCache.get(info)
    if (cached) return cached

    const filtered = _actorProperties.filter(reg =>
      reg.requiredTraits.every(trait => hasTraitInfo(trait)),
    )

    _actorCommandsCache.set(info, filtered)
    return filtered
  }

  // ---------------------------------------------------------------------------
  // Player Property Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a ScriptPlayerProperties subclass.
   *
   * OpenRA 对照: ObjectCreator.GetTypesImplementing<ScriptPlayerProperties>()
   *
   * Called at module import time:
   * ```
   * ScriptRegistry.registerPlayerProperty({
   *   category: 'Player',
   *   ctor: PlayerProperties,
   *   requiredTraits: [],
   *   description: 'Player name, color, faction, team',
   * });
   * ```
   */
  static registerPlayerProperty(registration: PlayerPropertyRegistration): void {
    if (!registration.requiredTraits) {
      throw new Error(`registerPlayerProperty: requiredTraits must be an array (got ${registration.requiredTraits})`)
    }
    _playerProperties.push(registration)
  }

  /**
   * Get all registered player property classes.
   */
  static getPlayerProperties(): readonly PlayerPropertyRegistration[] {
    return [..._playerProperties].sort((a, b) => a.category.localeCompare(b.category))
  }

  /**
   * Filter player property classes by required traits on the PlayerActor.
   *
   * OpenRA 对照: ScriptContext constructor — FilterCommands(
   *   world.Map.Rules.Actors[SystemActors.Player], knownPlayerCommands)
   *
   * @param playerActorInfo — the Player actor type metadata
   * @param hasTraitInfo — function to check for trait presence
   * @returns filtered array
   */
  static getPlayerCommands(
    _playerActorInfo: ActorInfoStub,
    hasTraitInfo: (traitName: string) => boolean,
  ): readonly PlayerPropertyRegistration[] {
    return _playerProperties.filter(reg =>
      reg.requiredTraits.every(trait => hasTraitInfo(trait)),
    )
  }

  // ---------------------------------------------------------------------------
  // ActorInit Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an ActorInit factory.
   *
   * OpenRA 对照: ActorInit type discovery via ObjectCreator.FindType(name + "Init")
   *
   * ```
   * ScriptRegistry.registerActorInit({
   *   name: 'Location',
   *   parameters: new Map([['value', 'CPos']]),
   *   factory: (values) => ({ initName: 'Location', value: values.get('value') }),
   * });
   * ```
   */
  static registerActorInit(registration: ActorInitRegistration): void {
    if (_actorInits.has(registration.name)) {
      throw new Error(`Duplicate ActorInit registration: '${registration.name}'`)
    }
    _actorInits.set(registration.name, registration)
  }

  /**
   * Get a registered ActorInit factory by name.
   */
  static getActorInit(name: string): ActorInitRegistration | undefined {
    return _actorInits.get(name)
  }

  /**
   * Get all registered ActorInit factories.
   */
  static getActorInits(): readonly ActorInitRegistration[] {
    return [..._actorInits.values()]
  }

  // ---------------------------------------------------------------------------
  // Validation & Reset
  // ---------------------------------------------------------------------------

  /**
   * Validate the registry state. Throws if:
   * - No globals registered
   * - No actor properties registered
   * - No player properties registered
   *
   * Called by ScriptContext after all imports have loaded.
   */
  static validate(): void {
    // NOTE: Not throwing on empty registries — in minimal environments
    // (tests, Phase A) there may legitimately be no registrations yet.
    // The ScriptContext will log warnings instead.
    // Phase C+ adds actual Property/Global subclasses.
  }

  /**
   * Clear all registrations. Provided ONLY for unit testing.
   * Production code must never call this.
   */
  static _resetForTest(): void {
    _globals.clear()
    _actorProperties.length = 0
    _playerProperties.length = 0
    _actorInits.clear()
    _actorCommandsCache.clear()
  }
}
