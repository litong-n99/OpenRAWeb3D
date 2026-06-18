# Chapter 20 Phase A Design Specification: Scripting Core Infrastructure

> **Status**: DESIGN COMPLETE (pending review)
> **Date**: 2026-06-17
> **Source Plan**: `docs/chapter20_scripting_system_migration_plan.md` Section 3.1
> **OpenRA Source Files Analyzed**: 6 files (ScriptContext.cs, ScriptTypes.cs, ScriptMemberWrapper.cs, ScriptObjectWrapper.cs, ScriptActorInterface.cs, ScriptPlayerInterface.cs)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Structure & Dependency Graph](#2-module-structure--dependency-graph)
3. [Interface & Abstract Class Definitions](#3-interface--abstract-class-definitions)
4. [ScriptRegistry Design](#4-scriptregistry-design)
5. [ScriptContext Design](#5-scriptcontext-design)
6. [ScriptObjectWrapper Design](#6-scriptobjectwrapper-design)
7. [ScriptActorInterface Design](#7-scriptactorinterface-design)
8. [ScriptPlayerInterface Design](#8-scriptplayerinterface-design)
9. [ScriptTypes Design](#9-scripttypes-design)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [Unit Test Strategy](#11-unit-test-strategy)
12. [Migration Work Requirement Documents](#12-migration-work-requirement-documents)

---

## 1. Architecture Overview

### 1.1 The Core Paradigm Shift

```
OpenRA (C# / Lua 5.2 / Eluant)              OpenRAWeb3D (TypeScript / JSON)
────────────────────────────────            ────────────────────────────────
ScriptContext creates Lua runtime       →   ScriptContext owns trigger dispatch + registry
.NET reflection discovers classes       →   ScriptRegistry explicit registration at import time
ScriptMemberWrapper reflects Members    →   MemberDescriptor — explicit property/method maps
LuaValue → CLR object conversion        →   JSON-compatible value → game type conversion
Lua table access (obj[key])             →   Direct property access + getMember()/setMember()
Actor trait queries via reflection      →   TraitInfo dependency matching via registry
```

### 1.2 How the 6 Files Fit Together

```
┌─────────────────────────────────────────────────────────────────┐
│                       ScriptContext                              │
│  (orchestrator — owns registry, tick/WorldLoaded lifecycle,     │
│   fatal error state, named actor registration)                  │
│                                                                 │
│  ┌──────────────────────┐    ┌───────────────────────────────┐ │
│  │   ScriptRegistry      │    │  TriggerDispatch (Phase B)    │ │
│  │   (API registration)  │    │  (JSON event → callback)      │ │
│  └──────────┬───────────┘    └───────────────────────────────┘ │
│             │                                                   │
│             ▼                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   ScriptObjectWrapper (abstract base)                      │  │
│  │   - Member dict: Map<string, MemberDescriptor>            │  │
│  │   - bind(objects[]): populates members                    │  │
│  │   - unbind(targetType): removes members                   │  │
│  │   - get(key), set(key, value), has(key)                   │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│       ┌─────────┴─────────┐                                    │
│       ▼                   ▼                                    │
│  ┌──────────────┐  ┌───────────────────┐                       │
│  │ ActorInterface│  │ PlayerInterface   │                       │
│  │ (trait-filtered│  │ (all player       │                       │
│  │  commands)    │  │  commands)         │                       │
│  └──────────────┘  └───────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │     ScriptTypes         │
              │  (type conversion utils)│
              │  fromScriptValue()      │
              │  toScriptValue()        │
              └────────────────────────┘
```

### 1.3 Design Principles (from ADRs 20.1-20.4)

1. **ADR-20.1 (JSON-first, optional Lua)**: Phase A provides the core abstraction layer that both the JSON trigger system (Phase B) and optional fengari Lua VM (Phase G) build upon. The registry, wrapper, and type conversion modules are format-agnostic.

2. **ADR-20.2 (Explicit registration, no decorators)**: Each Global/Properties class calls `ScriptRegistry.register*()` at module import time. No reflection, no decorators, no reflect-metadata. Works with `erasableSyntaxOnly`.

3. **ADR-20.3 (Modularization)**: Three separate modules — `ScriptContext.ts` (orchestrator), `ScriptRegistry.ts` (registration), `ScriptTypes.ts` (conversion). Each independently testable.

4. **ADR-20.4 (Trait dependency mirroring)**: Property classes declare their required trait types. `ScriptActorInterface` filters available property classes by matching against the actor's actual traits.

---

## 2. Module Structure & Dependency Graph

### 2.1 File Locations

```
src/OpenRA.Game/Scripting/
  ScriptTypes.ts           ← TODO-20.A.3 — type conversion utilities (no deps)
  ScriptRegistry.ts        ← TODO-20.A.2 — central registry (depends on types)
  ScriptMemberDescriptor.ts ← NEW (part of A.2) — MemberDescriptor types
  ScriptObjectWrapper.ts   ← TODO-20.A.4 — abstract base (depends on registry + types)
  ScriptActorInterface.ts  ← TODO-20.A.5 — actor wrapper (depends on wrapper + registry)
  ScriptPlayerInterface.ts ← TODO-20.A.6 — player wrapper (depends on wrapper + registry)
  ScriptContext.ts         ← TODO-20.A.1 — orchestrator (depends on all above)
```

### 2.2 Import Graph

```
ScriptTypes.ts
  (no internal deps — only imports CPos, WPos, WAngle from OpenRA.Game primitives)
      │
      ├──► ScriptRegistry.ts
      │      imports: ScriptTypes (type only), ScriptMemberDescriptor
      │      │
      │      ├──► ScriptObjectWrapper.ts
      │      │      imports: ScriptRegistry, ScriptMemberDescriptor, ScriptTypes
      │      │      │
      │      │      ├──► ScriptActorInterface.ts
      │      │      │      imports: ScriptObjectWrapper, ScriptRegistry
      │      │      │
      │      │      └──► ScriptPlayerInterface.ts
      │      │             imports: ScriptObjectWrapper, ScriptRegistry
      │      │
      │      └──► ScriptContext.ts
      │             imports: ScriptRegistry, ScriptObjectWrapper,
      │                       ScriptActorInterface, ScriptPlayerInterface,
      │                       ScriptTypes
      │
      └──► (Phase B-C users)
            ScriptTriggers.ts, ScriptGlobal.ts, etc.
```

### 2.3 External Dependencies (Already Available from Chapters 2-19)

| Import | Source Module | Purpose |
|--------|--------------|---------|
| `IGameActor` | `Traits/TraitsInterfaces.ts` | Actor reference in wrappers, type conversion |
| `PlayerStub` | `Traits/TraitsInterfaces.ts` | Player reference in wrappers |
| `WorldStub` | `Traits/TraitsInterfaces.ts` | World reference in ScriptContext |
| `WorldRendererStub` | `Traits/TraitsInterfaces.ts` | WorldRenderer reference in ScriptContext |
| `ActorInfoStub` | `Traits/TraitsInterfaces.ts` | Actor type metadata for trait filtering |
| `ITraitInfoInterface` | `Traits/TraitsInterfaces.ts` | Marker for trait info interfaces |
| `CPos`, `WPos`, `WAngle`, `WDist`, `WRot` | `OpenRA.Game/` | Type conversion between script and game values |
| `Color` | `Primitives/Color.ts` | Color type conversion |

---

## 3. Interface & Abstract Class Definitions

### 3.1 `IScriptBindable` (Marker Interface)

Equivalent to OpenRA's `IScriptBindable` — marks a class whose instances can be exposed to the script system.

```typescript
// src/OpenRA.Game/Scripting/ScriptTypes.ts

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
```

### 3.2 `IScriptNotifyBind` (Lifecycle Hook)

Equivalent to OpenRA's `IScriptNotifyBind` — notification that an object is being bound to a ScriptContext.

```typescript
// src/OpenRA.Game/Scripting/ScriptTypes.ts

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
  onScriptBind(context: IScriptContext): void;
}
```

### 3.3 `IScriptContext` (Forward Interface)

A forward reference to avoid circular dependencies between ScriptContext and the wrapper classes.

```typescript
// src/OpenRA.Game/Scripting/ScriptTypes.ts

import type { ActorInfoStub } from '../Traits/TraitsInterfaces.js';
import type { WorldStub, WorldRendererStub } from '../Traits/TraitsInterfaces.js';

/**
 * Forward interface for ScriptContext — used by ScriptObjectWrapper,
 * ScriptActorInterface, and ScriptPlayerInterface to avoid circular imports.
 *
 * OpenRA 对照: ScriptContext public members used by wrappers
 */
export interface IScriptContext {
  readonly world: WorldStub;
  readonly worldRenderer: WorldRendererStub;

  /** Whether a fatal script error has occurred. */
  readonly fatalErrorOccurred: boolean;

  /** The fatal error message, if any. */
  readonly errorMessage: string | null;

  /** Get the available actor property classes for a given ActorInfo. */
  getActorCommands(info: ActorInfoStub): readonly ActorPropertyRegistration[];

  /** Get the available player property classes. */
  readonly playerCommands: readonly PlayerPropertyRegistration[];

  /** Register a named actor as a script global. */
  registerMapActor(name: string, actor: import('../Traits/TraitsInterfaces.js').IGameActor): void;

  /** Trigger a fatal script error, ending the game. */
  fatalError(error: Error): void;
  fatalError(message: string): void;
}
```

### 3.4 `MemberDescriptor` Types

Replaces both `ScriptMemberWrapper` and the reflection-based `MemberInfo` discovery.

```typescript
// src/OpenRA.Game/Scripting/ScriptMemberDescriptor.ts

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
  | MethodDescriptor;

/**
 * Describes a readable and/or writable property exposed to scripts.
 *
 * OpenRA 对照: PropertyInfo + ScriptMemberWrapper.Get/Set
 */
export interface PropertyDescriptor {
  readonly memberType: 'property';
  readonly name: string;
  readonly description?: string;
  /** The return type of the property (for documentation/type conversion). */
  readonly returnType: ScriptTypeName;
  /** Get the property value. undefined means write-only. */
  readonly get?: (target: object) => unknown;
  /** Set the property value. undefined means read-only. */
  readonly set?: (target: object, value: unknown) => void;
}

/**
 * Describes a callable method exposed to scripts.
 *
 * OpenRA 对照: MethodInfo + ScriptMemberWrapper.Invoke
 */
export interface MethodDescriptor {
  readonly memberType: 'method';
  readonly name: string;
  readonly description?: string;
  /** Parameter definitions (for argument validation and type conversion). */
  readonly parameters: readonly ParameterDescriptor[];
  /** The return type (for documentation/type conversion). */
  readonly returnType: ScriptTypeName;
  /** Invoke the method with script-compatible arguments. */
  readonly invoke: (target: object, args: unknown[]) => unknown;
}

/**
 * Describes a single method parameter.
 */
export interface ParameterDescriptor {
  readonly name: string;
  readonly type: ScriptTypeName;
  readonly optional: boolean;
  readonly defaultValue?: unknown;
}

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
  | 'function';
```

### 3.5 `ScriptGlobal` Abstract Base Class

Equivalent to OpenRA's `ScriptGlobal` — base class for global API tables (Actor, Trigger, Media, etc.).

```typescript
// src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts (same file, after ScriptObjectWrapper)

import type { IScriptContext } from './ScriptTypes.js';

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
  readonly name: string;

  /**
   * @param context — the owning ScriptContext
   * @param name — the global table name (e.g., "Actor", "Trigger")
   * @param objects — the binding objects (typically just [this])
   */
  constructor(context: IScriptContext, name: string, objects: object[]) {
    super(context);
    this.name = name;
    this.bind(objects);
  }

  protected override duplicateKeyError(memberName: string): string {
    return `Table '${this.name}' defines multiple members '${memberName}'`;
  }

  protected override memberNotFoundError(memberName: string): string {
    return `Table '${this.name}' does not define a property '${memberName}'`;
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
    if (!filter) return objects;
    return objects.filter(item => {
      const scriptValue = ScriptTypes.toScriptValue(item, this.context);
      try {
        return filter(scriptValue);
      } finally {
        ScriptTypes.disposeScriptValue(scriptValue);
      }
    });
  }
}
```

Note: `ScriptTypes` is referenced inside `filterObjects`; this requires a forward reference or re-export. We'll handle this with a separate import from `ScriptTypes.ts` within the method body. Since it's not a top-level dependency, the import can be dynamic or resolved at the call site.

### 3.6 `ScriptActorProperties` Abstract Base Class

Defined in `ScriptContext.cs` (lines 48-53) — base for actor-scoped property groups.

```typescript
// src/OpenRA.Game/Scripting/ScriptActorInterface.ts (re-exported for downstream use)

import type { IGameActor } from '../Traits/TraitsInterfaces.js';
import type { IScriptContext } from './ScriptTypes.js';

/**
 * Abstract base class for trait-specific scripting properties on an actor.
 *
 * OpenRA 对照: ScriptActorProperties (ScriptContext.cs:48-53)
 *
 * Each subclass exposes trait methods to scripts (e.g., HealthProperties
 * exposes actor.Health, GeneralProperties exposes actor.IsDead).
 *
 * Subclasses use Requires<T> to declare which traits must be present on
 * the actor. ScriptActorInterface filters available property classes
 * based on the actor's actual trait set.
 *
 * Paradigm shift:
 * - C# constructor takes (ScriptContext, Actor) directly
 * - TS constructor takes (context, self) where self is IGameActor
 * - C# [ScriptPropertyGroup("category")] attribute → static readonly category + registerActorProperty
 */
export abstract class ScriptActorProperties {
  /** The actor these properties are bound to. */
  protected readonly self: IGameActor;

  /** The owning ScriptContext. */
  protected readonly context: IScriptContext;

  constructor(context: IScriptContext, self: IGameActor) {
    this.context = context;
    this.self = self;
  }

  /** The category this property group belongs to (e.g., "General", "Combat").
   *
   * OpenRA 对照: [ScriptPropertyGroup("category")] attribute
   *
   * Subclasses MUST override this with a static value, and typically also
   * declare `static readonly requiredTraits: string[]` for trait filtering.
   */
  static readonly category: string;

  /** Required trait interface names for this property group.
   *
   * OpenRA 对照: Requires<TInfo> generic interface constraints
   *
   * Example: HealthProperties requires ['IHealthInfo']
   *          MobileProperties requires ['MobileInfo']
   *
   * Empty array means no traits required (e.g., BaseActorProperties
   * for destroyed-actor-safe properties).
   */
  static readonly requiredTraits: readonly string[];

  /** Whether this property group is safe to access on destroyed actors.
   *
   * OpenRA 对照: [ExposedForDestroyedActors] attribute
   *
   * Only BaseActorProperties sets this to true.
   */
  static readonly exposedForDestroyedActors: boolean;

  /** Whether this property group requires a ScriptActivity queue.
   *
   * OpenRA 对照: [ScriptActorPropertyActivity] attribute
   *
   * Properties that queue activities (e.g., CallFunc, Wait) need this.
   * Default: false.
   */
  static readonly requiresActivity: boolean;
}
```

### 3.7 `ScriptPlayerProperties` Abstract Base Class

Defined in `ScriptContext.cs` (lines 54-58) — base for player-scoped property groups.

```typescript
// src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts (re-exported for downstream use)

import type { PlayerStub } from '../Traits/TraitsInterfaces.js';
import type { IScriptContext } from './ScriptTypes.js';

/**
 * Abstract base class for scripting properties on a player.
 *
 * OpenRA 对照: ScriptPlayerProperties (ScriptContext.cs:54-58)
 *
 * Each subclass exposes player-level APIs (e.g., PlayerProperties exposes
 * player.Name, MissionObjectiveProperties exposes player.AddObjective).
 *
 * Paradigm shift:
 * - C# constructor takes (ScriptContext, Player) directly
 * - TS constructor takes (context, player) where player is PlayerStub
 */
export abstract class ScriptPlayerProperties {
  /** The player these properties are bound to. */
  protected readonly player: PlayerStub;

  /** The owning ScriptContext. */
  protected readonly context: IScriptContext;

  constructor(context: IScriptContext, player: PlayerStub) {
    this.context = context;
    this.player = player;
  }

  /** Required trait interface names for this property group (on the PlayerActor).
   *
   * OpenRA 对照: Requires<TInfo> on ScriptPlayerProperties subclass
   */
  static readonly requiredTraits: readonly string[];
}
```

### 3.8 `ScriptRegistration` Types

These are the types that `ScriptRegistry` consumes and produces.

```typescript
// src/OpenRA.Game/Scripting/ScriptRegistry.ts

import type { MemberDescriptor } from './ScriptMemberDescriptor.js';
import type { ITraitInfoInterface } from '../Traits/TraitsInterfaces.js';

/**
 * Registration record for a ScriptGlobal subclass.
 *
 * OpenRA 对照: ScriptGlobal attribute discovery + constructor invocation
 */
export interface GlobalRegistration {
  /** The global table name (e.g., "Actor", "Trigger"). */
  readonly name: string;
  /** Constructor for the global class. Must accept (context). */
  readonly ctor: new (context: IScriptContext) => ScriptGlobal;
  /** Human-readable description of the global table. */
  readonly description?: string;
}

/**
 * Registration record for a ScriptActorProperties subclass.
 *
 * OpenRA 对照: [ScriptPropertyGroup("category")] + Requires<TInfo> on class
 */
export interface ActorPropertyRegistration {
  /** The property group category (e.g., "General", "Combat", "Production"). */
  readonly category: string;
  /** Constructor for the property class. Must accept (context, actor). */
  readonly ctor: new (context: IScriptContext, actor: IGameActor) => ScriptActorProperties;
  /** Required trait info interface names (empty if no traits needed). */
  readonly requiredTraits: readonly string[];
  /** Whether safe on destroyed actors. */
  readonly exposedForDestroyedActors: boolean;
  /** Description of what this property group provides. */
  readonly description?: string;
}

/**
 * Registration record for a ScriptPlayerProperties subclass.
 *
 * OpenRA 对照: [ScriptPropertyGroup("category")] on PlayerProperties subclass
 */
export interface PlayerPropertyRegistration {
  /** The property group category. */
  readonly category: string;
  /** Constructor for the property class. Must accept (context, player). */
  readonly ctor: new (context: IScriptContext, player: PlayerStub) => ScriptPlayerProperties;
  /** Required trait info interface names on the PlayerActor. */
  readonly requiredTraits: readonly string[];
  /** Description of what this property group provides. */
  readonly description?: string;
}

/**
 * Registration record for ActorInit factory functions.
 * Used by ActorGlobal.Create() to construct actors from script-provided init tables.
 *
 * OpenRA 对照: ActorInit subclasses found via reflection + CompositeActorInit pattern
 */
export interface ActorInitRegistration {
  /** The init name (e.g., "Location", "Owner", "Facing"). */
  readonly name: string;
  /** The parameter names and their expected types (for validation). */
  readonly parameters: ReadonlyMap<string, ScriptTypeName>;
  /** Factory function that creates the init object from script-provided values. */
  readonly factory: (values: ReadonlyMap<string, unknown>) => ActorInitValue;
}

/**
 * A resolved ActorInit value (ready for actor construction).
 *
 * OpenRA 对照: ActorInit (abstract class)
 */
export interface ActorInitValue {
  readonly initName: string;
  readonly instanceName?: string;
  readonly value: unknown;
}
```

---

## 4. ScriptRegistry Design

### 4.1 Purpose

`ScriptRegistry` is the central authority that maps:
- **Global names** → constructors for `ScriptGlobal` subclasses
- **ActorInfo trait sets** → available `ScriptActorProperties` subclasses
- **Player trait sets** → available `ScriptPlayerProperties` subclasses
- **Init names** → `ActorInit` factory functions

It replaces .NET reflection-based discovery (`ObjectCreator.GetTypesImplementing<T>()`) with explicit registration at module import time.

### 4.2 Complete API Surface

```typescript
// src/OpenRA.Game/Scripting/ScriptRegistry.ts

import type { ITraitInfoInterface } from '../Traits/TraitsInterfaces.js';
import type {
  GlobalRegistration,
  ActorPropertyRegistration,
  PlayerPropertyRegistration,
  ActorInitRegistration,
} from './ScriptRegistryTypes.js';  // (types defined in §3.8 above)

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
  // -----------------------------------------------------------------------
  // Global Registration
  // -----------------------------------------------------------------------

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
    ctor: new (context: IScriptContext) => ScriptGlobal,
    description?: string,
  ): void;

  /**
   * Get all registered global definitions.
   *
   * @returns array of all registered globals, sorted by name
   */
  static getGlobals(): readonly GlobalRegistration[];

  /**
   * Get a specific global registration by name.
   *
   * @returns the registration, or undefined if not found
   */
  static getGlobal(name: string): GlobalRegistration | undefined;

  // -----------------------------------------------------------------------
  // Actor Property Registration
  // -----------------------------------------------------------------------

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
   * @throws Error if the registration is invalid (duplicate key, etc.)
   */
  static registerActorProperty(registration: ActorPropertyRegistration): void;

  /**
   * Get all registered actor property classes.
   *
   * @returns array of all registrations, sorted by category
   */
  static getActorProperties(): readonly ActorPropertyRegistration[];

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
   * @param info — the actor type's metadata
   * @param hasTraitInfo — function that checks if the actor has a given trait info
   * @returns filtered array of property registrations
   */
  static getActorCommands(
    info: ActorInfoStub,
    hasTraitInfo: (traitName: string) => boolean,
  ): readonly ActorPropertyRegistration[];

  // -----------------------------------------------------------------------
  // Player Property Registration
  // -----------------------------------------------------------------------

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
  static registerPlayerProperty(registration: PlayerPropertyRegistration): void;

  /**
   * Get all registered player property classes.
   */
  static getPlayerProperties(): readonly PlayerPropertyRegistration[];

  /**
   * Filter player property classes by required traits on the PlayerActor.
   *
   * OpenRA 对照: ScriptContext constructor — FilterCommands(world.Map.Rules.Actors[SystemActors.Player], knownPlayerCommands)
   *
   * @param playerActorInfo — the Player actor type metadata
   * @param hasTraitInfo — function to check for trait presence
   * @returns filtered array
   */
  static getPlayerCommands(
    playerActorInfo: ActorInfoStub,
    hasTraitInfo: (traitName: string) => boolean,
  ): readonly PlayerPropertyRegistration[];

  // -----------------------------------------------------------------------
  // ActorInit Registration
  // -----------------------------------------------------------------------

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
  static registerActorInit(registration: ActorInitRegistration): void;

  /**
   * Get a registered ActorInit factory by name.
   */
  static getActorInit(name: string): ActorInitRegistration | undefined;

  /**
   * Get all registered ActorInit factories.
   */
  static getActorInits(): readonly ActorInitRegistration[];

  // -----------------------------------------------------------------------
  // Validation & Reset
  // -----------------------------------------------------------------------

  /**
   * Validate the registry state. Throws if:
   * - No globals registered
   * - No actor properties registered
   * - No player properties registered
   *
   * Called by ScriptContext after all imports have loaded.
   */
  static validate(): void;

  /**
   * Clear all registrations. Provided ONLY for unit testing.
   * Production code must never call this.
   */
  static _resetForTest(): void;
}
```

### 4.3 Internal Data Structure

```typescript
// Internal implementation (not exported)
namespace ScriptRegistryImpl {
  const globals = new Map<string, GlobalRegistration>();
  const actorProperties: ActorPropertyRegistration[] = [];
  const playerProperties: PlayerPropertyRegistration[] = [];
  const actorInits = new Map<string, ActorInitRegistration>();

  // ... method implementations
}
```

### 4.4 Registration Pattern (Module Import Time)

Each Global/Properties file registers itself at the top level:

```typescript
// Example: src/OpenRA.Mods.Common/Scripting/Properties/HealthProperties.ts (Phase D)

import { ScriptRegistry } from '../../../../OpenRA.Game/Scripting/ScriptRegistry.js';
import { ScriptActorProperties } from '../../../../OpenRA.Game/Scripting/ScriptActorInterface.js';
import type { IGameActor } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js';
import type { IHealth } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js';

export class HealthProperties extends ScriptActorProperties {
  static readonly category = 'General';
  static readonly requiredTraits = ['IHealthInfo'];
  static readonly exposedForDestroyedActors = false;

  private health: IHealth;

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self);
    this.health = self.traitsImplementing?.('IHealth')?.[0] as IHealth;
    if (!this.health) {
      throw new Error(`Actor ${self.info?.name} missing IHealth trait`);
    }
  }

  get Health(): number {
    return this.health.hp;
  }

  set Health(value: number) {
    const damage = this.health.hp - value;
    // Inflict self-damage
    this.health.inflictDamage(this.self, this.self, { value: damage, damageTypes: ... }, true);
  }

  get MaxHealth(): number {
    return this.health.maxHP;
  }

  Kill(damageTypes?: string | string[]): void {
    // ... implementation
  }
}

// Register at module import time
ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: HealthProperties,
  requiredTraits: ['IHealthInfo'],
  exposedForDestroyedActors: false,
  description: 'Actor health, max health, and kill',
});
```

### 4.5 Cache Pattern for ActorCommands

OpenRA's `ScriptContext` uses a `Cache<ActorInfo, Type[]>` to memoize the filtered command list per actor type. We replicate this:

```typescript
// Inside ScriptRegistry
const actorCommandsCache = new Map<ActorInfoStub, readonly ActorPropertyRegistration[]>();

static getActorCommands(
  info: ActorInfoStub,
  hasTraitInfo: (traitName: string) => boolean,
): readonly ActorPropertyRegistration[] {
  const cached = actorCommandsCache.get(info);
  if (cached) return cached;

  const filtered = actorProperties.filter(reg =>
    reg.requiredTraits.every(trait => hasTraitInfo(trait)),
  );

  actorCommandsCache.set(info, filtered);
  return filtered;
}
```

The cache is cleared when `_resetForTest()` is called.

---

## 5. ScriptContext Design

### 5.1 Purpose

`ScriptContext` is the orchestrator. It:
1. Owns the `ScriptRegistry` (pre-populated, not created by ScriptContext)
2. Parses JSON trigger definitions from map packages
3. Instantiates global API tables from the registry
4. Manages the fatal error state
5. Dispatches `WorldLoaded()` and `Tick()` lifecycle methods
6. Registers named map actors as script globals
7. Provides actor/player interfaces on demand
8. Optionally initializes the fengari Lua VM (Phase G)

### 5.2 Complete API Surface

```typescript
// src/OpenRA.Game/Scripting/ScriptContext.ts

import type { WorldStub, WorldRendererStub, ActorInfoStub } from '../Traits/TraitsInterfaces.js';
import type { IScriptContext } from './ScriptTypes.js';
import { ScriptRegistry } from './ScriptRegistry.js';
import type { ScriptGlobal } from './ScriptObjectWrapper.js';
import { ScriptActorInterface } from './ScriptActorInterface.js';
import { ScriptPlayerInterface } from './ScriptPlayerInterface.js';

/**
 * Core mission script host.
 *
 * OpenRA 对照: ScriptContext (ScriptContext.cs:119-345)
 *
 * Manages the scripting runtime lifecycle: construction, WorldLoaded, Tick,
 * FatalError, Dispose. Delegates to ScriptRegistry for API lookups.
 *
 * Paradigm shift:
 * - C# creates Eluant Lua runtime, loads .lua files, manages Lua globals
 * - TS creates a JSON trigger dispatch loop (Phase B) with optional fengari VM (Phase G)
 * - C# uses MemoryConstrainedLuaRuntime for sandboxing
 * - TS sandboxing is inherent in the JSON schema validation (no Turing-complete
 *   runtime needed for Tier 1) + optional fengari sandbox (Phase G)
 */
export class ScriptContext implements IScriptContext, IDisposable {
  // -----------------------------------------------------------------------
  // Public Properties
  // -----------------------------------------------------------------------

  /** The game world. */
  readonly world: WorldStub;

  /** The world renderer. */
  readonly worldRenderer: WorldRendererStub;

  /** Whether a fatal script error has occurred. */
  fatalErrorOccurred: boolean;

  /** The fatal error message, if any. */
  errorMessage: string | null;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new ScriptContext.
   *
   * OpenRA 对照: ScriptContext(World, WorldRenderer, IEnumerable<string> scripts)
   *
   * Construction sequence (mirrors OpenRA):
   * 1. Log channel setup ("lua" → "script" for clarity)
   * 2. Discover known actor/player commands via ScriptRegistry
   * 3. Cache filtered actor commands for the Player actor type
   * 4. Sandbox configuration (JSON-trigger validation, optional Lua sandbox)
   * 5. Register global tables from ScriptRegistry
   * 6. Load scripts — parse JSON trigger definitions from map
   *    (in Phase A: load placeholder; Phase B: full JSON trigger parsing)
   * 7. Optionally: dynamically import fengari adapter if .lua files present (Phase G)
   *
   * @param world — the game world
   * @param worldRenderer — the world renderer
   * @param scripts — list of script resource paths from the map package
   *                  (e.g., ["mission.json", "lua/init.lua"])
   */
  constructor(
    world: WorldStub,
    worldRenderer: WorldRendererStub,
    scripts: Iterable<string>,
  );

  // -----------------------------------------------------------------------
  // Lifecycle Methods
  // -----------------------------------------------------------------------

  /**
   * Called when the world finishes loading. Dispatches to:
   * - WorldLoaded trigger in JSON (Phase B)
   * - WorldLoaded Lua function if fengari VM is active (Phase G)
   *
   * OpenRA 对照: ScriptContext.WorldLoaded() — calls runtime.Globals["WorldLoaded"]
   */
  worldLoaded(): void;

  /**
   * Called every game tick (25 TPS). Dispatches to:
   * - Tick trigger polling in JSON (Phase B)
   * - Tick Lua function if fengari VM is active (Phase G)
   *
   * OpenRA 对照: ScriptContext.Tick() — calls runtime.Globals["Tick"] as LuaFunction
   *
   * Early-exits if fatalErrorOccurred or disposed.
   */
  tick(): void;

  // -----------------------------------------------------------------------
  // Error Handling
  // -----------------------------------------------------------------------

  /**
   * Trigger a fatal script error, immediately ending the game.
   *
   * OpenRA 对照: ScriptContext.FatalError(Exception) / FatalError(string)
   *
   * Overloads:
   * - fatalError(error: Error): extracts message + stack trace
   * - fatalError(message: string): creates stack trace
   *
   * Actions:
   * 1. Sets this.fatalErrorOccurred = true
   * 2. Stores errorMessage for display
   * 3. Logs to console and "lua" log channel
   * 4. Calls world.addFrameEndTask(() => world.endGame())
   *
   * Note: world.endGame() may not exist on WorldStub. In Phase A, this
   * emits an event/callback that the World-level ScriptComponent (Phase B)
   * listens for and acts upon. The actual World reference is accessed
   * via a callback provided to the constructor.
   */
  fatalError(error: Error): void;
  fatalError(message: string): void;

  // -----------------------------------------------------------------------
  // Map Actor Registration
  // -----------------------------------------------------------------------

  /**
   * Register a named map actor as a script global.
   *
   * OpenRA 对照: ScriptContext.RegisterMapActor(string, Actor)
   *
   * Creates a ScriptActorInterface for the actor and makes it accessible
   * by name in the script environment. Throws if the name conflicts with
   * a reserved global name.
   *
   * @param name — the script name for this actor
   * @param actor — the actor to register
   * @throws Error if the name is already reserved by a global table
   */
  registerMapActor(name: string, actor: IGameActor): void;

  // -----------------------------------------------------------------------
  // Command Queries
  // -----------------------------------------------------------------------

  /**
   * Get the available actor property classes for a given actor type.
   *
   * OpenRA 对照: ScriptContext.ActorCommands[actor.Info]
   *
   * Delegates to ScriptRegistry.getActorCommands() with the actor's
   * trait presence check function.
   */
  getActorCommands(info: ActorInfoStub): readonly ActorPropertyRegistration[];

  /**
   * Get the available player property classes.
   *
   * OpenRA 对照: ScriptContext.PlayerCommands
   */
  readonly playerCommands: readonly PlayerPropertyRegistration[];

  // -----------------------------------------------------------------------
  // Script Interface Factory
  // -----------------------------------------------------------------------

  /**
   * Create a ScriptActorInterface for a given actor.
   *
   * OpenRA 对照: actor.ToLuaValue(context) → ScriptActorInterface(context, actor)
   *
   * The returned interface is cached per actor to avoid redundant construction.
   */
  createActorInterface(actor: IGameActor): ScriptActorInterface;

  /**
   * Create a ScriptPlayerInterface for a given player.
   *
   * OpenRA 对照: player.ToLuaValue(context) → ScriptPlayerInterface(context, player)
   */
  createPlayerInterface(player: PlayerStub): ScriptPlayerInterface;

  // -----------------------------------------------------------------------
  // Global Table Access
  // -----------------------------------------------------------------------

  /**
   * Get all instantiated global tables.
   * Each is created in the constructor from ScriptRegistry.getGlobals().
   */
  readonly globals: ReadonlyMap<string, ScriptGlobal>;

  /**
   * Get a specific global table by name.
   */
  getGlobal(name: string): ScriptGlobal | undefined;

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * Clean up all resources.
   *
   * OpenRA 对照: ScriptContext.Dispose() — disposes Lua runtime
   *
   * In Phase A: clears globals, named actors, and caches.
   * In Phase G: also disposes fengari Lua runtime.
   */
  dispose(): void;

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Whether this instance has been disposed. */
  get disposed(): boolean;

  /**
   * Log a debug message from user scripts.
   *
   * OpenRA 对照: LogDebugMessage(string) — prints to console + "lua" log
   */
  logDebug(message: string): void;
}
```

### 5.3 Constructor Implementation Strategy

```
constructor(world, worldRenderer, scripts):
  1.  this.world = world
  2.  this.worldRenderer = worldRenderer
  3.  this.fatalErrorOccurred = false
  4.  this.errorMessage = null
  5.  this._disposed = false
  6.
  7.  // Discover known commands
  8.  this._knownActorCommands = ScriptRegistry.getActorProperties()
  9.  this._knownPlayerCommands = ScriptRegistry.getPlayerProperties()
 10.
 11.  // Cache filtered player commands
 12.  const playerActorInfo = world.map?.rules?.actors?.['Player']  (stub)
 13.  if (playerActorInfo) {
 14.    this._playerCommands = ScriptRegistry.getPlayerCommands(
 15.      playerActorInfo, t => playerActorInfo.hasTrait?.(t)
 16.    )
 17.  } else {
 18.    this._playerCommands = this._knownPlayerCommands  // pass all if no filter
 19.  }
 20.
 21.  // Instantiate global tables
 22.  this._globals = new Map()
 23.  for (const reg of ScriptRegistry.getGlobals()) {
 24.    const instance = new reg.ctor(this)
 25.    this._globals.set(reg.name, instance)
 26.  }
 27.
 28.  // Validate registry
 29.  ScriptRegistry.validate()
 30.
 31.  // Load scripts (Phase A: placeholder; Phase B: full JSON parsing)
 32.  this._loadScripts(scripts)
 33.
 34.  // Phase G hook (dynamic import of fengari adapter)
 35.  // if (hasLuaFiles(scripts)) this._initLuaRuntime(scripts)
```

### 5.4 Named Actor Registry

```typescript
// Internal state
private _namedActors = new Map<string, IGameActor>();
private _actorInterfaces = new Map<IGameActor, ScriptActorInterface>();
private _playerInterfaces = new Map<PlayerStub, ScriptPlayerInterface>();
private _reservedNames = new Set<string>();

// Reserved names are populated during constructor from:
// - Global table names (e.g., "Actor", "Trigger", "Media", ...)
// - Internal globals ("EngineDir", "FatalError", "print", "MaxUserScriptInstructions", "Tick", "WorldLoaded")
```

### 5.5 JSON Script Loading (Placeholder for Phase A)

```typescript
private _loadScripts(scripts: Iterable<string>): void {
  const fileSystem = this._getFileSystem(); // from world or injected

  for (const script of scripts) {
    try {
      const content = fileSystem.open(script)?.read();
      if (!content) {
        this.fatalError(`Script file not found: ${script}`);
        return;
      }

      // Determine file type
      if (script.endsWith('.json')) {
        this._parseJsonTriggerScript(content, script);
      } else if (script.endsWith('.lua')) {
        // Phase G: defer Lua script loading to fengari adapter
        this._luaScriptPaths ??= [];
        this._luaScriptPaths.push(script);
      } else {
        // Treat unknown format as text (backward compat)
        console.warn(`Unknown script format: ${script}`);
      }
    } catch (e) {
      this.fatalError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
  }
}

private _parseJsonTriggerScript(content: ArrayBuffer, path: string): void {
  // Phase A: Parse the JSON, validate against MissionScript schema
  // Phase B: Full trigger dispatch setup
  const text = new TextDecoder().decode(content);
  const missionScript = JSON.parse(text) as MissionScript;

  // Validate structure
  if (!missionScript.triggers && !missionScript.objectives) {
    console.warn(`Mission script '${path}' has no triggers or objectives`);
  }

  // Store for Phase B dispatch
  this._pendingTriggers.push({ source: path, script: missionScript });
}
```

### 5.6 Fatal Error Propagation

The `fatalError()` method must end the game. Since `WorldStub.endGame()` may not exist, we use a callback pattern:

```typescript
private _onFatalError: (() => void) | null;

/**
 * Set the callback invoked when a fatal error ends the game.
 * Called by ScriptComponent (Phase B) during world setup.
 */
setFatalErrorHandler(handler: () => void): void {
  this._onFatalError = handler;
}

fatalError(errorOrMessage: Error | string): void {
  const message = errorOrMessage instanceof Error
    ? errorOrMessage.message
    : errorOrMessage;
  const stackTrace = errorOrMessage instanceof Error
    ? errorOrMessage.stack ?? ''
    : new Error().stack ?? '';

  this.errorMessage = message;
  this.fatalErrorOccurred = true;

  console.error(`Fatal Script Error: ${message}`);
  console.error(stackTrace);

  // Log to script channel
  this.logDebug(`Fatal Script Error: ${message}`);
  this.logDebug(stackTrace);

  // End the game via callback
  this._onFatalError?.();
}
```

---

## 6. ScriptObjectWrapper Design

### 6.1 Purpose

`ScriptObjectWrapper` is the abstract base class that manages a dictionary of named members (properties + methods). It provides Lua-table-like access (`get`/`set`/`has`) backed by explicit `MemberDescriptor` objects.

### 6.2 Complete API Surface

```typescript
// src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts

import type { IScriptContext } from './ScriptTypes.js';
import { ScriptTypes } from './ScriptTypes.js';
import type { MemberDescriptor } from './ScriptMemberDescriptor.js';

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
  protected readonly context: IScriptContext;

  /** The member dictionary (name → descriptor). */
  private _members = new Map<string, MemberDescriptor>();

  constructor(context: IScriptContext) {
    this.context = context;
  }

  // -----------------------------------------------------------------------
  // Abstract — error message templates
  // -----------------------------------------------------------------------

  /**
   * Error message when a member name is defined on multiple bound objects.
   *
   * OpenRA 对照: ScriptObjectWrapper.DuplicateKeyError(string)
   */
  protected abstract duplicateKeyError(memberName: string): string;

  /**
   * Error message when a requested member is not found.
   *
   * OpenRA 对照: ScriptObjectWrapper.MemberNotFoundError(string)
   */
  protected abstract memberNotFoundError(memberName: string): string;

  // -----------------------------------------------------------------------
  // Bind / Unbind
  // -----------------------------------------------------------------------

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
   * In the TypeScript version, subclasses provide member descriptors
   * via an abstract method rather than reflection. This is the key
   * paradigm shift from runtime reflection to explicit declaration.
   *
   * @param objects — the objects to bind (typically [this] for ScriptGlobal,
   *   or [propertyInstance1, propertyInstance2, ...] for interfaces)
   */
  protected bind(objects: object[]): void {
    this._members.clear();

    for (const obj of objects) {
      const descriptors = this.getMemberDescriptors(obj);
      for (const desc of descriptors) {
        if (this._members.has(desc.name)) {
          throw new Error(this.duplicateKeyError(desc.name));
        }
        this._members.set(desc.name, desc);
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
      // Check if this member belongs to an instance of the target class
      if (desc._ownerCtor === targetCtor) {
        this._members.delete(key);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Lua-table-like access
  // -----------------------------------------------------------------------

  /**
   * Check if a named member exists.
   *
   * OpenRA 对照: ScriptObjectWrapper.ContainsKey(string) → bool
   */
  containsKey(key: string): boolean {
    return this._members.has(key);
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
    const desc = this._members.get(key);
    if (!desc) {
      throw new Error(this.memberNotFoundError(key));
    }

    if (desc.memberType === 'property') {
      if (!desc.get) throw new Error(`The property '${key}' is write-only`);
      return ScriptTypes.toScriptValue(desc.get(desc._target), this.context);
    }

    if (desc.memberType === 'method') {
      // Return a callable wrapper
      return (...args: unknown[]) => {
        // Convert script arguments to internal types
        const clrArgs = this._convertArgs(desc, args);
        const result = desc.invoke(desc._target, clrArgs);
        return ScriptTypes.toScriptValue(result, this.context);
      };
    }

    throw new Error(this.memberNotFoundError(key));
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
    const desc = this._members.get(key);
    if (!desc) {
      throw new Error(this.memberNotFoundError(key));
    }

    if (desc.memberType !== 'property') {
      throw new Error(`The member '${key}' is a method and cannot be set`);
    }

    if (!desc.set) {
      throw new Error(`The property '${key}' is read-only`);
    }

    // Convert script value to internal type
    const convertedValue = ScriptTypes.fromScriptValue(
      value, desc.returnType,
    );
    desc.set(desc._target, convertedValue);
  }

  // -----------------------------------------------------------------------
  // Abstract — member discovery
  // -----------------------------------------------------------------------

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
  protected abstract getMemberDescriptors(obj: object): MemberDescriptor[];

  // -----------------------------------------------------------------------
  // Internal argument conversion
  // -----------------------------------------------------------------------

  private _convertArgs(desc: MethodDescriptor, args: unknown[]): unknown[] {
    const params = desc.parameters;
    const converted: unknown[] = [];

    for (let i = 0; i < params.length; i++) {
      if (i >= args.length) {
        if (params[i].optional) {
          converted.push(params[i].defaultValue);
          continue;
        }
        throw new Error(
          `Argument '${params[i].name}' of '${desc.name}' is not optional`,
        );
      }

      converted.push(
        ScriptTypes.fromScriptValue(args[i], params[i].type),
      );
    }

    return converted;
  }
}
```

### 6.3 MemberDescriptor Extension

The internal `MemberDescriptor` needs a hidden `_target` and `_ownerCtor` for unbind support. These are set during `bind()`:

```typescript
// Internal extension to MemberDescriptor (not exported)
interface BoundMemberDescriptor extends MemberDescriptor {
  /** The object instance this member is bound to. */
  _target: object;
  /** The constructor of the object this member is bound to. */
  _ownerCtor: new (...args: any[]) => any;
}
```

### 6.4 Integration with Existing Code

The `GameActor.hasScriptProperty(name)` method (referenced in `BaseActorProperties`) delegates to the actor's `ScriptActorInterface.containsKey(name)`. This requires `GameActor` to hold a reference to its `ScriptActorInterface`, which is set by `ScriptContext.createActorInterface()`.

---

## 7. ScriptActorInterface Design

### 7.1 Purpose

`ScriptActorInterface` extends `ScriptObjectWrapper` to provide actor-scoped script access. Its key responsibility is filtering available property classes based on:
1. Whether the actor's ActorInfo has the required traits for each property group
2. Whether the actor is destroyed (if destroyed, only `ExposedForDestroyedActors` groups remain available)

### 7.2 Complete API Surface

```typescript
// src/OpenRA.Game/Scripting/ScriptActorInterface.ts

import type { IGameActor } from '../Traits/TraitsInterfaces.js';
import type { IScriptContext } from './ScriptTypes.js';
import { ScriptObjectWrapper } from './ScriptObjectWrapper.js';
import { ScriptRegistry } from './ScriptRegistry.js';
import type { MemberDescriptor } from './ScriptMemberDescriptor.js';
import type { ScriptActorProperties } from './ScriptActorProperties.js';
import type { ActorPropertyRegistration } from './ScriptRegistry.js';

/**
 * Script-accessible interface for a specific game actor.
 *
 * OpenRA 对照: ScriptActorInterface (ScriptActorInterface.cs:16-56)
 *
 * Wraps an actor and exposes its trait-based property groups to scripts.
 * Automatically filters available commands based on the actor's traits
 * and alive/destroyed state.
 */
export class ScriptActorInterface extends ScriptObjectWrapper {
  /** The wrapped actor. */
  private readonly _actor: IGameActor;

  /** The property class instances currently bound to this actor. */
  private _commandInstances: Map<new (...args: any[]) => ScriptActorProperties, ScriptActorProperties>;

  /** The property registrations this interface was initialized with. */
  private _commandClasses: readonly ActorPropertyRegistration[];

  /**
   * @param context — the owning ScriptContext
   * @param actor — the actor to wrap
   */
  constructor(context: IScriptContext, actor: IGameActor) {
    super(context);
    this._actor = actor;
    this._commandInstances = new Map();
    this._commandClasses = [];
    this._initializeBindings();
  }

  // -----------------------------------------------------------------------
  // Error Messages
  // -----------------------------------------------------------------------

  protected override duplicateKeyError(memberName: string): string {
    return `Actor '${this._actor.info?.name ?? 'unknown'}' defines the command '${memberName}' on multiple traits`;
  }

  protected override memberNotFoundError(memberName: string): string {
    let actorName = this._actor.info?.name ?? 'unknown';
    if (this._actor.isDead) actorName += ' (dead)';
    return `Actor '${actorName}' does not define a property '${memberName}'`;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Called when the actor is destroyed. Removes bindings for property
   * groups not marked ExposedForDestroyedActors.
   *
   * OpenRA 对照: ScriptActorInterface.OnActorDestroyed()
   */
  onActorDestroyed(): void {
    const commands = ScriptRegistry.getActorCommands(
      this._actor.info!,
      (trait) => this._hasTraitInfo(trait),
    );

    for (const cmd of commands) {
      if (!cmd.exposedForDestroyedActors) {
        this.unbind(cmd.ctor as new (...args: any[]) => ScriptActorProperties);
        this._commandInstances.delete(
          cmd.ctor as new (...args: any[]) => ScriptActorProperties,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Member Binding
  // -----------------------------------------------------------------------

  /**
   * Re-initialize the bindings (used after trait changes, e.g., upgrades).
   */
  reinitializeBindings(): void {
    this._commandInstances.clear();
    this._initializeBindings();
  }

  /**
   * Select property groups and create instances.
   */
  private _initializeBindings(): void {
    if (!this._actor.info) return;

    this._commandClasses = ScriptRegistry.getActorCommands(
      this._actor.info,
      (trait) => this._hasTraitInfo(trait),
    );

    // If the actor is already destroyed, filter to ExposedForDestroyedActors only
    const filtered = this._actor.disposed
      ? this._commandClasses.filter(c => c.exposedForDestroyedActors)
      : this._commandClasses;

    const instances: ScriptActorProperties[] = [];
    for (const cmd of filtered) {
      const instance = new cmd.ctor(this.context, this._actor);
      this._commandInstances.set(
        cmd.ctor as new (...args: any[]) => ScriptActorProperties,
        instance,
      );
      instances.push(instance);
    }

    if (instances.length > 0) {
      this.bind(instances);
    }
  }

  /**
   * Get member descriptors from property instances.
   *
   * Each ScriptActorProperties subclass overrides getOwnMemberDescriptors()
   * to declare its public members.
   */
  protected override getMemberDescriptors(obj: object): MemberDescriptor[] {
    if (obj instanceof ScriptActorProperties) {
      return (obj as any).getOwnMemberDescriptors?.() ?? [];
    }
    return [];
  }

  /**
   * Check if the actor has a given trait info.
   *
   * OpenRA 对照: ActorInfo.HasTraitInfo<T>() — reflection-based
   *
   * In TS, this delegates to the actor's trait query system.
   * The exact mechanism depends on how ActorInfo stores trait info.
   */
  private _hasTraitInfo(traitName: string): boolean {
    // Use the actor's info trait presence check
    // For ActorInfoStub, we can't call a method — we rely on the
    // ScriptContext to provide a hasTraitInfo function.
    // During construction, getActorCommands receives this function.
    // We cache it.
    if (!this._hasTraitInfoFn) {
      // Fallback: check if the actor itself has the trait
      return (this._actor as any).traitsImplementing?.(traitName)?.length > 0;
    }
    return this._hasTraitInfoFn(traitName);
  }

  private _hasTraitInfoFn?: (traitName: string) => boolean;
}
```

---

## 8. ScriptPlayerInterface Design

### 8.1 Purpose

`ScriptPlayerInterface` extends `ScriptObjectWrapper` to provide player-scoped script access. It binds all `ScriptPlayerProperties` subclasses whose required traits are present on the Player actor.

### 8.2 Complete API Surface

```typescript
// src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts

import type { PlayerStub } from '../Traits/TraitsInterfaces.js';
import type { IScriptContext } from './ScriptTypes.js';
import { ScriptObjectWrapper } from './ScriptObjectWrapper.js';
import { ScriptRegistry } from './ScriptRegistry.js';
import type { MemberDescriptor } from './ScriptMemberDescriptor.js';
import type { ScriptPlayerProperties } from './ScriptPlayerProperties.js';
import type { PlayerPropertyRegistration } from './ScriptRegistry.js';

/**
 * Script-accessible interface for a specific player.
 *
 * OpenRA 对照: ScriptPlayerInterface (ScriptPlayerInterface.cs:14-29)
 *
 * Wraps a player and exposes all available ScriptPlayerProperties
 * command groups.
 */
export class ScriptPlayerInterface extends ScriptObjectWrapper {
  /** The wrapped player. */
  private readonly _player: PlayerStub;

  /**
   * @param context — the owning ScriptContext
   * @param player — the player to wrap
   */
  constructor(context: IScriptContext, player: PlayerStub) {
    super(context);
    this._player = player;

    const commandClasses = context.playerCommands;
    const instances = commandClasses.map(
      cmd => new cmd.ctor(context, player),
    );

    if (instances.length > 0) {
      this.bind(instances);
    }
  }

  // -----------------------------------------------------------------------
  // Error Messages
  // -----------------------------------------------------------------------

  protected override duplicateKeyError(memberName: string): string {
    return `Player '${this._getPlayerName()}' defines the command '${memberName}' on multiple traits`;
  }

  protected override memberNotFoundError(memberName: string): string {
    return `Player '${this._getPlayerName()}' does not define a property '${memberName}'`;
  }

  // -----------------------------------------------------------------------
  // Member Binding
  // -----------------------------------------------------------------------

  protected override getMemberDescriptors(obj: object): MemberDescriptor[] {
    if (obj instanceof ScriptPlayerProperties) {
      return (obj as any).getOwnMemberDescriptors?.() ?? [];
    }
    return [];
  }

  private _getPlayerName(): string {
    // PlayerStub has playerName; Player class may have additional methods
    return (this._player as any).resolvedPlayerName
      ?? (this._player as any).playerName
      ?? 'unknown';
  }
}
```

---

## 9. ScriptTypes Design

### 9.1 Purpose

`ScriptTypes` provides the type conversion bridge between TypeScript game objects and script-compatible values (JSON-compatible primitives for Tier 1, or Lua values for Tier 2/Phase G).

### 9.2 Conversion Philosophy

| Source Type | Script Type (Tier 1 JSON) | Notes |
|------------|--------------------------|-------|
| `number` | `number` | Direct passthrough |
| `boolean` | `boolean` | Direct passthrough |
| `string` | `string` | Direct passthrough |
| `null` | `null` | Direct passthrough |
| `WPos` | `{ x: number, y: number, z: number }` | Struct → object |
| `CPos` | `{ x: number, y: number }` | Struct → object |
| `WAngle` | `number` (degrees) | Struct → scalar |
| `WDist` | `number` (cell units) | Struct → scalar |
| `WRot` | `{ yaw: number, pitch: number, roll: number }` | Struct → object |
| `Color` | `{ r: number, g: number, b: number, a: number }` | Struct → object |
| `GameActor` | `ScriptActorInterface` | Object → wrapper |
| `Player` | `ScriptPlayerInterface` | Object → wrapper |
| `Array` | `Array` (recursively converted) | Elements converted individually |
| `IScriptBindable` | Wrapped via ScriptTypes.toScriptValue() | Objects with `onScriptBind()` notification |

### 9.3 Complete API Surface

```typescript
// src/OpenRA.Game/Scripting/ScriptTypes.ts

import type { IScriptContext, IScriptBindable, IScriptNotifyBind } from './ScriptTypes.js';
import { CPos } from '../CPos.js';
import { WPos } from '../WPos.js';
import { WAngle } from '../WAngle.js';
import { WDist } from '../WDist.js';
import { WRot } from '../WRot.js';
import { CVec } from '../CVec.js';
import { WVec } from '../WVec.js';
import type { ScriptTypeName } from './ScriptMemberDescriptor.js';

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
  // -----------------------------------------------------------------------
  // To-Script Conversion (object → script value)
  // -----------------------------------------------------------------------

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
   * - Color → { r, g, b, a }
   * - IScriptBindable → ScriptObjectWrapper (via context.createActorInterface/createPlayerInterface)
   * - Array → Array (recursively converted)
   * - Otherwise → throws InvalidOperationException
   *
   * @param obj — the game object to convert
   * @param context — the script context (needed for creating wrappers)
   * @returns the script-compatible value
   * @throws Error if the object type cannot be converted
   */
  static toScriptValue(obj: unknown, context: IScriptContext): unknown;

  // -----------------------------------------------------------------------
  // From-Script Conversion (script value → typed game object)
  // -----------------------------------------------------------------------

  /**
   * Convert a script value to a TypeScript game object of the expected type.
   *
   * OpenRA 对照: LuaValue.TryGetClrValue(Type, out object)
   *
   * The type parameter in OpenRA is resolved via reflection from the
   * .NET method signature. In TS, we pass the expected type explicitly.
   *
   * Conversion rules (from JSON-compatible values):
   * - number → number, int, short, byte (with validation)
   * - boolean → boolean
   * - string → string
   * - null → null (for nullable types)
   * - { x: number, y: number } → CPos
   * - { x: number, y: number, z: number } → WPos
   * - number → WAngle (treat as degrees)
   * - number → WDist (treat as cell-units)
   * - { r, g, b, a } → Color
   * - script wrapper → underlying game object (unwrap)
   * - Array → typed Array (recursively convert elements)
   *
   * @param value — the script value to convert
   * @param targetType — the expected TypeScript type name
   * @returns the converted game object
   * @throws Error if conversion is not possible
   */
  static fromScriptValue(value: unknown, targetType: ScriptTypeName): unknown;

  // -----------------------------------------------------------------------
  // Type Checking
  // -----------------------------------------------------------------------

  /**
   * Get the type name of a value in the script context.
   *
   * OpenRA 对照: LuaValue.WrappedClrType()
   *
   * @param value — the script value to check
   * @returns the type name string
   */
  static typeOf(value: unknown): ScriptTypeName;

  /**
   * Check whether a script value can be converted to the given type.
   *
   * OpenRA 对照: LuaValue.TryGetClrValue<T>(out T) — boolean return
   *
   * @param value — the script value to check
   * @param targetType — the expected type name
   * @returns true if conversion is possible
   */
  static canConvert(value: unknown, targetType: ScriptTypeName): boolean;

  // -----------------------------------------------------------------------
  // Resource Management
  // -----------------------------------------------------------------------

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
  static disposeScriptValue(value: unknown): void;
}

// ---------------------------------------------------------------------------
// Re-export marker interfaces for convenience
// ---------------------------------------------------------------------------

export type { IScriptBindable, IScriptNotifyBind, IScriptContext };
```

### 9.4 fromScriptValue Implementation Detail

```typescript
static fromScriptValue(value: unknown, targetType: ScriptTypeName): unknown {
  // null/nil handling
  if (value === null || value === undefined) {
    return null;
  }

  switch (targetType) {
    case 'nil':
      return null;

    case 'boolean':
      if (typeof value === 'boolean') return value;
      throw new Error(`Cannot convert ${typeof value} to boolean`);

    case 'number':
      if (typeof value === 'number') return value;
      throw new Error(`Cannot convert ${typeof value} to number`);

    case 'string':
      if (typeof value === 'string') return value;
      throw new Error(`Cannot convert ${typeof value} to string`);

    case 'CPos':
      return CPos.fromXY(
        (value as any).x,
        (value as any).y,
      );

    case 'WPos':
      return new WPos(
        (value as any).x,
        (value as any).y,
        (value as any).z,
      );

    case 'CVec':
      return new CVec(
        (value as any).x,
        (value as any).y,
      );

    case 'WVec':
      return new WVec(
        (value as any).x,
        (value as any).y,
        (value as any).z,
      );

    case 'WAngle':
      if (typeof value === 'number') return WAngle.fromDegrees(value);
      throw new Error(`Cannot convert ${typeof value} to WAngle`);

    case 'WDist':
      if (typeof value === 'number') return new WDist(value);
      throw new Error(`Cannot convert ${typeof value} to WDist`);

    case 'WRot':
      return WRot.fromYawPitchRoll(
        WAngle.fromDegrees((value as any).yaw ?? 0),
        WAngle.fromDegrees((value as any).pitch ?? 0),
        WAngle.fromDegrees((value as any).roll ?? 0),
      );

    case 'Actor':
      // Unwrap ScriptActorInterface to IGameActor
      if (value instanceof ScriptActorInterface) return value.getActor();
      throw new Error(`Cannot convert ${typeof value} to Actor`);

    case 'Player':
      // Unwrap ScriptPlayerInterface to PlayerStub
      if (value instanceof ScriptPlayerInterface) return value.getPlayer();
      throw new Error(`Cannot convert ${typeof value} to Player`);

    case 'function':
      if (typeof value === 'function') return value;
      throw new Error(`Cannot convert ${typeof value} to function`);

    case 'table':
      if (typeof value === 'object') return value;
      throw new Error(`Cannot convert ${typeof value} to table`);

    case 'any':
      return value;

    // Array types
    case 'string[]':
    case 'Actor[]':
    case 'Player[]':
    case 'CPos[]':
      if (Array.isArray(value)) {
        const elementType = targetType.replace('[]', '') as ScriptTypeName;
        return value.map(v => this.fromScriptValue(v, elementType));
      }
      throw new Error(`Cannot convert ${typeof value} to ${targetType}`);

    default:
      throw new Error(`Unknown target type: ${targetType}`);
  }
}
```

---

## 10. Error Handling Strategy

### 10.1 Error Categories

| Category | Source | Severity | Behavior |
|----------|--------|----------|----------|
| **Registration Error** | Duplicate global/actor property registration | FATAL | Throws at module import time (startup crash) |
| **Member Not Found** | Script references non-existent property | ERROR | Throws with descriptive message (surfaced to script author) |
| **Type Conversion Error** | Script passes wrong type for parameter | ERROR | Throws with type name mismatch detail |
| **Required Trait Missing** | Property group instantiated for actor without required traits | FATAL | Throws during interface creation (implementation error) |
| **Fatal Script Error** | Script logic error (e.g., divide by zero, invalid state) | FATAL | Sets fatalErrorOccurred; ends game via World endGame callback |
| **Disposed Access** | Script accesses actor/player after disposal | WARNING | Returns null/false gracefully (per OpenRA behavior) |

### 10.2 Error Propagation Path

```
Script method throws Error
  ↓
ScriptObjectWrapper.get() (or set/invoke)
  ↓
JSON trigger dispatch (Phase B: catches Error, wraps as FatalError)
  ↓
ScriptContext.fatalError(error)
  ↓
Sets fatalErrorOccurred = true
Calls _onFatalError handler
  ↓
World.addFrameEndTask(w => w.endGame())
```

### 10.3 Error Message Format

Error messages should follow OpenRA's format:
- Include the context (actor name, player name, global table name)
- Include the member name that failed
- Include the expected vs actual types for conversion errors
- Never expose internal stack traces to scripts (log them, but surface a clean message)

Example messages:
- `"Actor 'e1' does not define a property 'Attack'"` (not on this actor type)
- `"Actor 'e1 (dead)' does not define a property 'Health'"` (destroyed)
- `"Unable to convert parameter 0 to CPos (got string)"` (type mismatch)
- `"Table 'Actor' defines multiple members 'Create'"` (duplicate registration)

---

## 11. Unit Test Strategy

### 11.1 Test Plan

| File | Tests | Key Test Areas |
|------|-------|----------------|
| `ScriptRegistry.test.ts` | 15-18 | registerGlobal (success + duplicate), registerActorProperty, registerPlayerProperty, registerActorInit, getActorCommands with trait filtering, getPlayerCommands with trait filtering, cache invalidation on _resetForTest, validate() with empty registry |
| `ScriptTypes.test.ts` | 15-20 | toScriptValue for all primitives, toScriptValue for WPos/CPos/WAngle/WDist/WRot/Color, fromScriptValue for all types (round-trip), typeOf for all types, canConvert edge cases, array conversion (recursive), disposeScriptValue no-op (Tier 1) |
| `ScriptObjectWrapper.test.ts` | 12-15 | bind() with valid members, bind() duplicate detection, unbind() removal, containsKey, get (property + method), set (read-only + write-only error), method invocation with argument conversion, duplicateKeyError/memberNotFoundError templates |
| `ScriptActorInterface.test.ts` | 10-12 | Constructor initializes with correct filtered properties, onActorDestroyed() removes non-exposed properties, ExposedForDestroyedActors properties survive destruction, trait filtering (present vs missing traits), duplicate member detection across property groups, reinitializeBindings after trait change |
| `ScriptPlayerInterface.test.ts` | 5-8 | Constructor binds all player properties, get/set on player properties, duplicateKeyError formatting, memberNotFoundError formatting |
| `ScriptContext.test.ts` | 12-15 | Constructor creates all globals from registry, constructor loads JSON scripts (placeholder), worldLoaded() with WorldLoaded handler, tick() early-exit on fatalError/disposed, registerMapActor rejects reserved names, fatalError sets state and calls handler, getActorCommands delegates to registry, createActorInterface/PlayerInterface caching, dispose() cleanup |

**Total estimated tests for Phase A**: ~70-85

### 11.2 Mock Strategy

- `IGameActor`: Create a minimal stub with `actorId`, `isInWorld`, `isDead`, `disposed`, `info`, `owner`, `world`, `traitsImplementing`
- `PlayerStub`: Simple stub with `playerName`
- `WorldStub`: Stub with `actors`, `addFrameEndTask`, `endGame` (optional)
- `ActorInfoStub`: Stub with `name`, `hasTraitInfo` (for trait filtering tests)
- `IScriptContext`: Create a mock ScriptContext that returns pre-configured property registrations

### 11.3 Test File Locations

```
src/OpenRA.Game/Scripting/
  ScriptRegistry.test.ts
  ScriptTypes.test.ts
  ScriptObjectWrapper.test.ts
  ScriptActorInterface.test.ts
  ScriptPlayerInterface.test.ts
  ScriptContext.test.ts
```

---

## 12. Migration Work Requirement Documents

The following Work Requirement Documents are ready for Manager approval and Developer handoff.

### 12.1 WRD: ScriptRegistry and ScriptMemberDescriptor

```
## Work Requirement: ScriptMemberDescriptor + ScriptRegistry

### Source
- OpenRA file: `OpenRA.Game/Scripting/ScriptMemberWrapper.cs` (absorbed, not ported)
- Target file: `src/OpenRA.Game/Scripting/ScriptMemberDescriptor.ts` (NEW)
- Target file: `src/OpenRA.Game/Scripting/ScriptRegistry.ts` (NEW)
- Target test: `src/OpenRA.Game/Scripting/ScriptRegistry.test.ts` (NEW)
- Migration plan ref: TODO-20.A.2

### Dependencies (verified completed)
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — IGameActor, PlayerStub, WorldStub, ActorInfoStub, ITraitInfoInterface
- [x] `src/OpenRA.Game/GameRules/ActorInfo.ts` — ActorInfo with TraitConfig
- [x] `src/OpenRA.Game/CPos.ts`, `WPos.ts`, `WAngle.ts`, `WDist.ts`, `WRot.ts` — game primitives

### Architecture Context
ScriptRegistry is the central authority for the entire scripting system. Every Global, Actor Property, Player Property, and ActorInit class registers itself here at module import time. ScriptContext and all interface wrappers query the registry for available commands. This replaces .NET reflection-based type discovery.

### Migration Requirements
1. Define MemberDescriptor types (PropertyDescriptor, MethodDescriptor, ParameterDescriptor, ScriptTypeName)
2. Implement ScriptRegistry as a class with all-static methods (singleton pattern)
3. Implement registerGlobal, registerActorProperty, registerPlayerProperty, registerActorInit
4. Implement query methods: getGlobals, getGlobal, getActorProperties, getActorCommands, getPlayerProperties, getPlayerCommands, getActorInit, getActorInits
5. Implement getActorCommands trait filtering with cache
6. Implement validate() to ensure minimum registration
7. Implement _resetForTest() for test isolation
8. Duplicate registration detection with descriptive errors

### Key Paradigm Shifts
- C# reflection type scanning → explicit register*() calls at module import time
- C# Requires<T> generic constraints → requiredTraits: string[] array
- C# Cache<ActorInfo, Type[]> → Map<ActorInfoStub, ActorPropertyRegistration[]>

### Acceptance Criteria
- [x] All static methods defined and documented
- [x] Unit tests: 15-18 tests (registration, query, filtering, cache, validation)
- [x] TypeScript compiles without errors
- [x] JSDoc on all public APIs with OpenRA method references
```

### 12.2 WRD: ScriptTypes

```
## Work Requirement: ScriptTypes

### Source
- OpenRA file: `OpenRA.Game/Scripting/ScriptTypes.cs` (192 lines)
- Target file: `src/OpenRA.Game/Scripting/ScriptTypes.ts`
- Target test: `src/OpenRA.Game/Scripting/ScriptTypes.test.ts`
- Migration plan ref: TODO-20.A.3

### Dependencies (verified completed)
- [x] `src/OpenRA.Game/CPos.ts`, `WPos.ts`, `WAngle.ts`, `WDist.ts`, `WRot.ts`, `CVec.ts`, `WVec.ts` — game primitives
- [x] `src/OpenRA.Game/Primitives/Color.ts` — color type

### Architecture Context
ScriptTypes provides the bidirectional conversion between TypeScript game objects and script-compatible values. This is the foundational layer — all other scripting modules use these conversions.

### Migration Requirements
1. Define IScriptBindable and IScriptNotifyBind marker interfaces
2. Define IScriptContext forward interface
3. Implement ScriptTypes.toScriptValue() — game object → script-compatible value
4. Implement ScriptTypes.fromScriptValue() — script value → typed game object
5. Implement ScriptTypes.typeOf() — get type name of a script value
6. Implement ScriptTypes.canConvert() — check conversion compatibility
7. Implement ScriptTypes.disposeScriptValue() — resource cleanup (no-op for Tier 1)

### Babylon.js API Mapping
| OpenRA API | TS Replacement | Notes |
|------------|---------------|-------|
| LuaValue.TryGetClrValue<T>() | ScriptTypes.fromScriptValue(value, type) | Type passed as string name |
| obj.ToLuaValue(context) | ScriptTypes.toScriptValue(obj, context) | IScriptNotifyBind notification |
| LuaValue.Dispose() | ScriptTypes.disposeScriptValue() | No-op for Tier 1 JSON |
| LuaValue.WrappedClrType() | ScriptTypes.typeOf(value) | Returns ScriptTypeName |
| LuaTable → array conversion | fromScriptValue with 'T[]' types | Recursive element conversion |

### Key Paradigm Shifts
- C# Eluant LuaValue wrapping → JSON-compatible primitive values
- C# runtime type checking (is LuaNumber, is LuaString, etc.) → typeof checks
- C# LuaTable → Array conversion with LuaValue disposal → plain array mapping

### Acceptance Criteria
- [x] All conversion paths implemented
- [x] Unit tests: 15-20 tests (round-trip for all types, edge cases, array conversion)
- [x] TypeScript compiles without errors
- [x] JSDoc on all public APIs with OpenRA method references
```

### 12.3 WRD: ScriptObjectWrapper

```
## Work Requirement: ScriptObjectWrapper

### Source
- OpenRA file: `OpenRA.Game/Scripting/ScriptObjectWrapper.cs` (95 lines)
- Target file: `src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts`
- Target test: `src/OpenRA.Game/Scripting/ScriptObjectWrapper.test.ts`
- Migration plan ref: TODO-20.A.4

### Dependencies (verified completed)
- [x] `src/OpenRA.Game/Scripting/ScriptMemberDescriptor.ts` (TODO-20.A.2)
- [x] `src/OpenRA.Game/Scripting/ScriptTypes.ts` (TODO-20.A.3)

### Architecture Context
ScriptObjectWrapper is the abstract base class for all script-exposed objects. It manages a dictionary of members (properties + methods) and provides get/set/has access. Subclasses include ScriptGlobal, ScriptActorInterface, and ScriptPlayerInterface.

### Migration Requirements
1. Define abstract duplicateKeyError and memberNotFoundError templates
2. Implement bind(objects[]) — populate member dictionary from object descriptors
3. Implement unbind(targetCtor) — remove all members from a specific class
4. Implement containsKey(key) — check member existence
5. Implement get(key) — property getter or method wrapper
6. Implement set(key, value) — property setter with type conversion
7. Define abstract getMemberDescriptors(obj) — subclasses provide member lists
8. Implement internal argument conversion for method invocation

### Key Paradigm Shifts
- C# reflection: ScriptMemberWrapper.WrappableMembers(Type) → explicit getMemberDescriptors()
- C# ILuaTableBinding interface → get/set/containsKey methods
- C# LuaRuntime parameter in get() → not needed in TS (direct invocation)

### Acceptance Criteria
- [x] All abstract methods defined
- [x] Unit tests: 12-15 tests
- [x] TypeScript compiles without errors
- [x] JSDoc on all public APIs
```

### 12.4 WRD: ScriptActorInterface

```
## Work Requirement: ScriptActorInterface

### Source
- OpenRA file: `OpenRA.Game/Scripting/ScriptActorInterface.cs` (57 lines)
- Target file: `src/OpenRA.Game/Scripting/ScriptActorInterface.ts`
- Target test: `src/OpenRA.Game/Scripting/ScriptActorInterface.test.ts`
- Migration plan ref: TODO-20.A.5

### Dependencies (verified completed)
- [x] `src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts` (TODO-20.A.4)
- [x] `src/OpenRA.Game/Scripting/ScriptRegistry.ts` (TODO-20.A.2)
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — IGameActor

### Architecture Context
ScriptActorInterface wraps a game actor and exposes trait-specific property groups to scripts. It filters available commands based on the actor's actual traits and alive/destroyed state.

### Migration Requirements
1. Implement constructor — query registry for actor commands, filter by traits, create property instances, bind
2. Implement onActorDestroyed() — remove non-exposed property groups
3. Implement reinitializeBindings() — for trait changes
4. Implement duplicateKeyError and memberNotFoundError with actor name
5. Implement trait checking via hasTraitInfo

### Acceptance Criteria
- [x] All OpenRA public members accounted for
- [x] Unit tests: 10-12 tests
- [x] TypeScript compiles without errors
```

### 12.5 WRD: ScriptPlayerInterface

```
## Work Requirement: ScriptPlayerInterface

### Source
- OpenRA file: `OpenRA.Game/Scripting/ScriptPlayerInterface.cs` (30 lines)
- Target file: `src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts`
- Target test: `src/OpenRA.Game/Scripting/ScriptPlayerInterface.test.ts`
- Migration plan ref: TODO-20.A.6

### Dependencies (verified completed)
- [x] `src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts` (TODO-20.A.4)
- [x] `src/OpenRA.Game/Scripting/ScriptRegistry.ts` (TODO-20.A.2)
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — PlayerStub

### Architecture Context
ScriptPlayerInterface wraps a player and exposes all ScriptPlayerProperties command groups. Simpler than ScriptActorInterface (no trait filtering at the interface level; filtering happens in ScriptContext construction via PlayerCommands).

### Migration Requirements
1. Implement constructor — get PlayerCommands from context, create instances, bind
2. Implement duplicateKeyError and memberNotFoundError with player name
3. Implement getMemberDescriptors for ScriptPlayerProperties instances

### Acceptance Criteria
- [x] All OpenRA public members accounted for
- [x] Unit tests: 5-8 tests
- [x] TypeScript compiles without errors
```

### 12.6 WRD: ScriptContext

```
## Work Requirement: ScriptContext

### Source
- OpenRA file: `OpenRA.Game/Scripting/ScriptContext.cs` (346 lines)
- Target file: `src/OpenRA.Game/Scripting/ScriptContext.ts`
- Target test: `src/OpenRA.Game/Scripting/ScriptContext.test.ts`
- Migration plan ref: TODO-20.A.1

### Dependencies (verified completed)
- [x] `src/OpenRA.Game/Scripting/ScriptRegistry.ts` (TODO-20.A.2)
- [x] `src/OpenRA.Game/Scripting/ScriptTypes.ts` (TODO-20.A.3)
- [x] `src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts` (TODO-20.A.4)
- [x] `src/OpenRA.Game/Scripting/ScriptActorInterface.ts` (TODO-20.A.5)
- [x] `src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts` (TODO-20.A.6)
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — all stubs

### Architecture Context
ScriptContext is the orchestrator for the entire scripting system. It owns the registry, manages fatal error state, dispatches lifecycle events, and serves as the bridge between game world and script domain.

### Migration Requirements
1. Implement IScriptContext interface
2. Implement constructor — discover commands, instantiate globals, load scripts
3. Implement worldLoaded() — dispatch WorldLoaded (Phase A placeholder; Phase B full)
4. Implement tick() — dispatch Tick (Phase A placeholder; Phase B full)
5. Implement fatalError(error) and fatalError(message) overloads
6. Implement registerMapActor(name, actor) with reserved name checking
7. Implement getActorCommands(info) — delegates to Registry with trait filter
8. Implement createActorInterface/createPlayerInterface with caching
9. Implement globals accessor (getGlobal, readonly globals)
10. Implement dispose() — cleanup globals, named actors, caches
11. Implement logDebug() — logging bridge
12. Implement setFatalErrorHandler() — end-game callback

### Key Paradigm Shifts
- C# MemoryConstrainedLuaRuntime → JSON trigger dispatch (Phase B) + optional fengari (Phase G)
- C# Lua sandbox (os/io/random removal) → JSON schema validation + fengari sandbox (Phase G)
- C# RegisterMapActor checks Lua globals → checks reserved names from registry
- C# World.AddFrameEndTask(w => w.EndGame()) → fatal error callback pattern

### Acceptance Criteria
- [x] All public members from OpenRA source accounted for
- [x] Unit tests: 12-15 tests
- [x] TypeScript compiles without errors
- [x] JSDoc on all public APIs
- [x] Dispose pattern implemented
```

---

## Appendix A: File Header Templates

### ScriptMemberDescriptor.ts
```typescript
/**
 * MemberDescriptor.ts — Explicit member descriptors for script-exposed objects
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
```

### ScriptRegistry.ts
```typescript
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

```

### ScriptTypes.ts
```typescript
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
```

### ScriptObjectWrapper.ts
```typescript
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
```

### ScriptActorInterface.ts
```typescript
/**
 * ScriptActorInterface.ts — Actor-scoped script access with trait filtering
 * OpenRA 对照: ScriptActorInterface.cs
 *
 * 核心范式转换:
 * - C# ActorCommands[actor.Info] filtered via reflection + HasAttribute
 *   → ScriptRegistry.getActorCommands() with trait name matching
 * - C# [ExposedForDestroyedActors] attribute
 *   → exposedForDestroyedActors: boolean on ActorPropertyRegistration
 * - C# CreateObjects() reflection-based constructor invocation
 *   → Direct new ctor(context, actor) from registration
 */
```

### ScriptPlayerInterface.ts
```typescript
/**
 * ScriptPlayerInterface.ts — Player-scoped script access
 * OpenRA 对照: ScriptPlayerInterface.cs
 *
 * 核心范式转换:
 * - C# context.PlayerCommands (Type[] from reflection)
 *   → ScriptRegistry.getPlayerProperties() from explicit registration
 * - C# Player reference → PlayerStub (forward interface for loose coupling)
 */
```

### ScriptContext.ts
```typescript
/**
 * ScriptContext.ts — Core mission script orchestrator
 * OpenRA 对照: ScriptContext.cs
 *
 * 核心范式转换:
 * - C# MemoryConstrainedLuaRuntime (Eluant/Lua 5.2 sandbox)
 *   → JSON trigger dispatch loop + optional fengari Lua 5.3 VM (Phase G)
 * - C# runtime.Globals Lua table (register globals, map actors)
 *   → ScriptRegistry + named actor map + global table instances
 * - C# World.AddFrameEndTask(w => w.EndGame()) for fatal errors
 *   → _onFatalError callback injected by ScriptComponent (Phase B)
 */
```

---

## Appendix B: Open Issues for Manager Decision

1. **ActorInfoStub.hasTraitInfo()**: The `ActorInfo.ts` defined in Chapter 6 has `TraitConfig` but the `ActorInfoStub` in `TraitsInterfaces.ts` only has `name`. We need to either:
   - Extend `ActorInfoStub` to include a `hasTraitInfo?(traitName: string): boolean` method
   - Pass a standalone `hasTraitInfo` function through `getActorCommands()`
   - The design spec assumes Option B (function passed separately) since `ScriptContext` provides this bridge.

2. **WorldStub.endGame()**: `ScriptContext.fatalError()` needs to end the game. `WorldStub` does not define `endGame()`. The design uses a callback pattern (`setFatalErrorHandler`) to avoid adding methods to the stub. This is resolved in Phase B when `ScriptComponent` (the world-level trait that owns `ScriptContext`) provides the handler.

3. **ActorInit type system**: `ActorGlobal.Create()` uses `ActorInit` subclasses to construct actors from script-provided values. The full `ActorInit` system needs a separate design specification for Phase C. Phase A only provides the `ActorInitRegistration` type and registry hooks.

4. **ScriptContext.ts — IScriptContext coupling**: The `IScriptContext` forward interface is defined in `ScriptTypes.ts` to avoid circular imports. But `ScriptContext.ts` implements it. The import order is: `ScriptTypes.ts` (defines interface) → `ScriptRegistry.ts` → `ScriptObjectWrapper.ts` → `ScriptActorInterface.ts`/`ScriptPlayerInterface.ts` → `ScriptContext.ts` (implements it). This is non-circular.

---

## Appendix C: Key Decisions Summary

| Decision | Reference | Rationale |
|----------|-----------|-----------|
| Static methods on ScriptRegistry | ADR-20.2 | Singleton pattern avoids needing to inject the registry everywhere |
| MemberDescriptor union type | ADR-20.2 | More type-safe than runtime type checking; property vs method known at compile time |
| getMemberDescriptors abstract method | ADR-20.2 | Each subclass declares its own members explicitly; no reflection needed |
| _target and _ownerCtor on MemberDescriptor | §6.3 | Required for unbind() to remove members by constructor; set during bind() |
| fatalError callback pattern | §5.6 | Avoids adding endGame() to WorldStub; ScriptComponent provides the bridge |
| fromScriptValue type switch | §9.4 | Explicit mapping is more maintainable than generic reflection emulation |
| exposedForDestroyedActors boolean vs attribute | ADR-20.4 | Simpler than decorator; matches the registration pattern |
| Cache in getActorCommands | §4.5 | O(1) lookup after first call; mirrors OpenRA's Cache<ActorInfo, Type[]> |
| _resetForTest() pattern | §4.2 | Standard test isolation pattern used in other modules (e.g., ruleset cache) |
