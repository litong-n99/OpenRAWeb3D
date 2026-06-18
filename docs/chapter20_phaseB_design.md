# Chapter 20 Phase B Design Specification: Trigger System & Trait Bridge

> **Status**: DESIGN COMPLETE
> **Date**: 2026-06-18
> **Source Plan**: `docs/chapter20_scripting_system_migration_plan.md` Section 3.2
> **OpenRA Source Files Analyzed**: 3 files (ScriptTriggers.cs, LuaScript.cs, CallLuaFunc.cs)
> **Predecessor Phase**: Phase A (Scripting Core Infrastructure) — COMPLETE, APPROVED
> **Successor Phase**: Phase C (Global API Tables) — blocked on Phase B

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Structure & Dependency Graph](#2-module-structure--dependency-graph)
3. [Interface Audit: What Exists vs. What Needs Stubs](#3-interface-audit-what-exists-vs-what-needs-stubs)
4. [ScriptTriggers Design (B.1)](#4-scripttriggers-design-b1)
5. [ScriptComponent Design (B.2)](#5-scriptcomponent-design-b2)
6. [CallScriptFunc Design (B.3)](#6-callscriptfunc-design-b3)
7. [Unit Test Strategy](#7-unit-test-strategy)
8. [Migration Work Requirement Documents](#8-migration-work-requirement-documents)

---

## 1. Architecture Overview

### 1.1 How Phase B Connects Phase A to Phase C

```
Phase A (Scripting Core)          Phase B (Trigger System)          Phase C (Global API)
─────────────────────────         ─────────────────────────         ─────────────────────
ScriptContext                      ScriptComponent                  TriggerGlobal
  └── owns ScriptRegistry            └── owns ScriptContext           └── uses ScriptTriggers
                                    └── creates on WorldLoaded          to register callbacks
ScriptRegistry                                                          via Clear/RegisterCallback
  └── no trigger knowledge        ScriptTriggers                     ActorGlobal
                                    └── trait on individual actors     └── uses ScriptContext
ScriptObjectWrapper                  └── 21 trigger callback lists       and named actors
  └── base for all wrappers         └── 6 internal events
                                    └── implements 18 INotify*
ScriptActorInterface
  └── actor.propertyGroup access  CallScriptFunc
                                    └── Activity subclass
                                    └── executes script callbacks

FLOW:
  1. ScriptComponent (world trait) is created on the World actor
  2. On IWorldLoaded: creates ScriptContext, calls context.WorldLoaded()
  3. On ITick (each frame): calls context.Tick()
  4. ScriptTriggers (actor trait) on any actor:
     - Map scripts call RegisterCallback(trigger, fn, context) → stored
     - Game events fire (INotify*) → iterate matching trigger list → call fn
     - Internal events (OnKilledInternal, etc.) → C#-only interop hooks
  5. CallScriptFunc: enqueue a script callback as an Activity
     - Used by GeneralProperties.CallFunc() (Phase D) and other API methods
```

### 1.2 Core Paradigm Shifts

| OpenRA (C# / Lua / Eluant) | OpenRAWeb3D (TypeScript / JSON) |
|---|---|
| `LuaScript` trait (creates Eluant Lua runtime) | `ScriptComponent` trait (creates JSON trigger dispatch) |
| `Triggerable` struct: `LuaFunction + ScriptContext + LuaValue self` | `Triggerable` interface: `fn: TriggerCallback + context: ScriptContext + selfArg?: unknown` |
| `LuaFunction.Call(...).Dispose()` | `fn.call(context, ...args)` — plain function invocation |
| `LuaFunction.CopyReference()` | Pass function reference directly (GC handles cleanup) |
| `CallLuaFunc` extends `Activity`, holds `LuaFunction` | `CallScriptFunc` extends `Activity`, holds `TriggerCallback` |
| `Enum.GetValues<Trigger>().Length` (21 triggers) | `TRIGGER_COUNT` constant + `Trigger` enum |
| C# `event Action<Actor> OnKilledInternal` | TypeScript `Set<InternalEventListener>` with typed payloads |

### 1.3 Design Constraints

1. **No Lua dependency in Phase B**: Phase B establishes the trigger infrastructure that both the JSON trigger system (Phase C) and the optional fengari Lua VM (Phase G) build upon. The `TriggerCallback` signature is format-agnostic.

2. **Actor/Player stubs remain**: `IGameActor`, `PlayerStub` from TraitsInterfaces are used as-is. Full `Player` and `GameActor` types are upstream dependencies; Phase B depends only on the interface contracts.

3. **Missing INotify* interfaces need stub declarations**: 10 of the 18 INotify* interfaces that ScriptTriggers implements do not yet have formal TypeScript interfaces in the project. These must be declared in this phase as part of the migration.

4. **Internal events are C#-only**: `OnKilledInternal`, `OnCapturedInternal`, `OnRemovedInternal`, `OnAddedInternal`, `OnProducedInternal`, `OnOtherProducedInternal` exist in OpenRA for C# trait-to-trait interop. In TS, these can be implemented as typed listener sets, but the actual C# consumers (like `GivesBounty`, `SpawnActorOnDeath`) may not exist yet. We implement the mechanism but document it as internal API.

---

## 2. Module Structure & Dependency Graph

### 2.1 File Locations

```
src/OpenRA.Mods.Common/
  Scripting/
    ScriptTriggers.ts          ← TODO-20.B.1 — 21 trigger callbacks + 18 INotify* interfaces
    ScriptComponent.ts         ← TODO-20.B.2 — world-level trait, owns ScriptContext
  Activities/
    CallScriptFunc.ts          ← TODO-20.B.3 — Activity that invokes a script callback
```

### 2.2 Dependency Graph

```
src/OpenRA.Game/
  Traits/TraitsInterfaces.ts   ← INotify* interfaces (some exist, 10 added by Phase B)
  Activities/Activity.ts       ← base class for CallScriptFunc
  Actor.ts                     ← GameActor (IGameActor)
  Scripting/
    ScriptContext.ts           ← orchestrator (ScriptComponent creates/owns it)
    ScriptTypes.ts             ← type conversion (used by callback argument marshaling)
    ScriptMemberDescriptor.ts  ← type definitions
```

**Dependency direction (top-down)**:
```
ScriptComponent.ts
  ├── ScriptContext.ts (Phase A)
  ├── TraitsInterfaces.ts (IWorldLoaded, ITick, INotifyActorDisposing)
  └── TraitsInterfaces.ts (WorldStub, WorldRendererStub)

ScriptTriggers.ts
  ├── TraitsInterfaces.ts (18 INotify* interfaces)
  ├── ScriptContext.ts (Phase A — FatalError)
  └── TraitsInterfaces.ts (IGameActor, PlayerStub, IAttackInfo)

CallScriptFunc.ts
  ├── Activity.ts (Phase A / Ch3 Phase F)
  └── ScriptContext.ts (Phase A — FatalError)
```

### 2.3 What Phase B DOES NOT Depend On

- `ScriptRegistry.ts` — ScriptTriggers does not use the registry (it's a trait, not a Global)
- `ScriptObjectWrapper.ts` — not needed for trigger mechanics
- `TriggerGlobal.ts` — Phase C (consumes ScriptTriggers, not the other way around)
- Any Babylon.js imports — Phase B is pure game logic, no rendering

---

## 3. Interface Audit: What Exists vs. What Needs Stubs

### 3.1 INotify* Interfaces Already Existing in TraitsInterfaces.ts

| # | Interface | Method Signature | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 1 | `INotifyIdle` | `tickIdle(self: IGameActor): void` | EXISTS | Line 989 |
| 2 | `INotifyDamage` | `damaged(self: IGameActor, e: IAttackInfo): void` | EXISTS | Line 941 |
| 3 | `INotifyKilled` | `killed(self: IGameActor, e: IAttackInfo): void` | EXISTS | Line 929 |
| 4 | `INotifyAddedToWorld` | `addedToWorld(self: IGameActor): void` | EXISTS | Line 866 |
| 5 | `INotifyRemovedFromWorld` | `removedFromWorld(self: IGameActor): void` | EXISTS | Line 876 |
| 6 | `INotifyActorDisposing` | `disposing(self: IGameActor): void` | EXISTS | Line 885 |
| 7 | `INotifyCapture` | `onCapture(self: IGameActor, captor: IGameActor, oldOwner: PlayerStub, newOwner: PlayerStub, captureTypes: number): void` | EXISTS | Line 3924 |
| 8 | `INotifySold` | `selling(self: IGameActor): void` + `sold(self: IGameActor): void` | EXISTS | Line 3953 |

### 3.2 INotify* Interfaces That Need Declaration (Phase B Responsibility)

These 10 interfaces must be declared. To minimize disruption to `TraitsInterfaces.ts` (a very large file), they will be declared in a **new file**: `src/OpenRA.Mods.Common/Scripting/TriggerInterfaces.ts`.

| # | Interface | Method Signature | OpenRA Source |
|---|-----------|-----------------|---------------|
| 9 | `INotifyProduction` | `unitProduced(self: IGameActor, other: IGameActor, exitCell: CPos): void` | `ITraitNotifyInterface` |
| 10 | `INotifyOtherProduction` | `unitProducedByOther(self: IGameActor, producee: IGameActor, produced: IGameActor, productionType: string, init: Record<string, unknown>): void` | `ITraitNotifyInterface` |
| 11 | `INotifyBuildingPlaced` | `buildingPlaced(self: IGameActor, building: IGameActor): void` | `ITraitNotifyInterface` |
| 12 | `INotifyObjectivesUpdated` | `onObjectiveAdded(player: PlayerStub, id: number): void` + `onObjectiveCompleted(player: PlayerStub, id: number): void` + `onObjectiveFailed(player: PlayerStub, id: number): void` | `ITraitNotifyInterface` |
| 13 | `INotifyInfiltrated` | `infiltrated(self: IGameActor, infiltrator: IGameActor, types: number): void` | Already exists in `InfiltrationInterfaces.ts` (Cnc-specific). We add a Common version. |
| 14 | `INotifyDiscovered` | `onDiscovered(self: IGameActor, discoverer: PlayerStub, playNotification: boolean): void` | `ITraitNotifyInterface` |
| 15 | `INotifyPassengerEntered` | `onPassengerEntered(self: IGameActor, passenger: IGameActor): void` | `ITraitNotifyInterface` |
| 16 | `INotifyPassengerExited` | `onPassengerExited(self: IGameActor, passenger: IGameActor): void` | `ITraitNotifyInterface` |
| 17 | `INotifyWinStateChanged` | `onPlayerWon(player: PlayerStub): void` + `onPlayerLost(player: PlayerStub): void` | `ITraitNotifyInterface` |
| 18 | `INotifyTimeLimit` | `notifyTimerExpired(self: IGameActor): void` | `ITraitNotifyInterface` |

### 3.3 Supporting Stub Types

`IAttackInfo` (used by `INotifyDamage.damaged` and `INotifyKilled.killed`) — check if it already exists, or define a stub.

`CPos` — used by `INotifyProduction.unitProduced(exit: CPos)`. Already exists in the codebase as `src/OpenRA.Game/CPos.ts`.

---

## 4. ScriptTriggers Design (B.1)

### 4.1 Overview

```
OpenRA 对照: OpenRA.Mods.Common/Scripting/ScriptTriggers.cs (560 lines)

ScriptTriggers is a TRAIT that can be attached to any actor.
It bridges 18 game event interfaces to script-registered callbacks.

Architecture:
  ┌─────────────────────────────────────────────────────────────┐
  │                     ScriptTriggers                           │
  │                                                              │
  │  triggerables: Triggerable[][]  (21 arrays, one per Trigger) │
  │                                                              │
  │  ┌──────────────────┐    ┌──────────────────────────────┐  │
  │  │ INotify* handlers │    │  Internal Events              │  │
  │  │ (18 impl.)        │    │  OnKilledInternal: Set<fn>    │  │
  │  │                    │    │  OnCapturedInternal: Set<fn>  │  │
  │  │  Each:              │    │  OnRemovedInternal: Set<fn>  │  │
  │  │  - check disposing │    │  OnAddedInternal: Set<fn>    │  │
  │  │  - iterate list    │    │  OnProducedInternal: Set<fn> │  │
  │  │  - marshal args    │    │  OnOtherProduced: Set<fn>    │  │
  │  │  - call fn         │    │                               │  │
  │  │  - catch/fatalError│    └──────────────────────────────┘  │
  │  └──────────────────┘                                        │
  │                                                              │
  │  Public API:                                                 │
  │  - RegisterCallback(trigger, fn, context)                    │
  │  - HasAnyCallbacksFor(trigger): boolean                      │
  │  - Clear(trigger)                                            │
  │  - ClearAll()                                                │
  └─────────────────────────────────────────────────────────────┘
```

### 4.2 Trigger Enum

```typescript
export enum Trigger {
  OnIdle = 0,
  OnDamaged = 1,
  OnKilled = 2,
  OnProduction = 3,
  OnOtherProduction = 4,
  OnBuildingPlaced = 5,
  OnPlayerWon = 6,
  OnPlayerLost = 7,
  OnObjectiveAdded = 8,
  OnObjectiveCompleted = 9,
  OnObjectiveFailed = 10,
  OnCapture = 11,
  OnInfiltrated = 12,
  OnAddedToWorld = 13,
  OnRemovedFromWorld = 14,
  OnDiscovered = 15,
  OnPlayerDiscovered = 16,
  OnPassengerEntered = 17,
  OnPassengerExited = 18,
  OnSold = 19,
  OnTimerExpired = 20,
}

export const TRIGGER_COUNT = 21;
```

### 4.3 TriggerCallback Type

```typescript
/**
 * A generic script callback function.
 * The args array contains the marshaled arguments from the INotify* handler.
 * The callee is responsible for understanding the expected argument types
 * based on which trigger was registered.
 */
export type TriggerCallback = (context: IScriptContext, ...args: unknown[]) => void;
```

### 4.4 Triggerable

```typescript
/**
 * A registered callback for a specific trigger.
 *
 * OpenRA 对照: ScriptTriggers.Triggerable struct (lines 52-69)
 *
 * Paradigm shift:
 * - C# stores LuaFunction + LuaValue(self) with CopyReference()/Dispose()
 * - TS stores a plain function reference; memory managed by GC
 */
export interface Triggerable {
  fn: TriggerCallback;
  context: IScriptContext;
  /** The "self" argument — the actor this trigger is attached to.
   *  Pre-marshaled for callbacks that take self as first arg. */
  selfArg?: unknown;
}
```

### 4.5 Internal Event Types

```typescript
export type ActorEventCallback = (actor: IGameActor) => void;
export type ActorPairCallback = (a: IGameActor, b: IGameActor) => void;
```

### 4.6 ScriptTriggersInfo (Trait Configuration)

```typescript
/**
 * Trait info for ScriptTriggers.
 *
 * OpenRA 对照: ScriptTriggersInfo (lines 31-34)
 *
 * No configurable properties — this is a simple marker trait
 * that the map script system detects to know the actor supports triggers.
 */
export class ScriptTriggersInfo {
  // Empty — ScriptTriggers has no configurable fields
}
```

### 4.7 ScriptTriggers Class

**Implements all 18 INotify* interfaces** (8 existing + 10 new).

```typescript
export class ScriptTriggers implements
  INotifyIdle,        // tickIdle(self)
  INotifyDamage,      // damaged(self, e)
  INotifyKilled,      // killed(self, e)
  INotifyProduction,          // unitProduced(self, other, exitCell)
  INotifyOtherProduction,     // unitProducedByOther(self, producee, produced, type, init)
  INotifyBuildingPlaced,      // buildingPlaced(self, building)
  INotifyWinStateChanged,     // onPlayerWon(player) + onPlayerLost(player)
  INotifyObjectivesUpdated,   // onObjectiveAdded/Completed/Failed(player, id)
  INotifyCapture,             // onCapture(self, captor, oldOwner, newOwner, types)
  INotifyInfiltrated,         // infiltrated(self, infiltrator, types)
  INotifyAddedToWorld,        // addedToWorld(self)
  INotifyRemovedFromWorld,    // removedFromWorld(self)
  INotifyDiscovered,          // onDiscovered(self, discoverer, playNotification)
  INotifyPassengerEntered,    // onPassengerEntered(self, passenger)
  INotifyPassengerExited,     // onPassengerExited(self, passenger)
  INotifySold,                // selling(self) + sold(self)
  INotifyTimeLimit,           // notifyTimerExpired(self)
  INotifyActorDisposing       // disposing(self)
```

**Key public methods**:

| Method | OpenRA 对照 | Description |
|--------|------------|-------------|
| `registerCallback(trigger, fn, context)` | `RegisterCallback(Trigger, LuaFunction, ScriptContext)` | Register a script callback for a trigger type |
| `hasAnyCallbacksFor(trigger): boolean` | `HasAnyCallbacksFor(Trigger)` | Check if any callbacks exist for a trigger |
| `clear(trigger)` | `Clear(Trigger)` | Remove and dispose all callbacks for a trigger |
| `clearAll()` | `ClearAll()` | Remove and dispose all callbacks for ALL triggers |

**Internal events** (for C#-style inter-trait communication, mapped to TypeScript listener sets):

| Event | Type | Fires during |
|-------|------|-------------|
| `onKilledInternal` | `Set<ActorEventCallback>` | `INotifyKilled.killed()` — after Lua callbacks |
| `onCapturedInternal` | `Set<ActorEventCallback>` | `INotifyCapture.onCapture()` — after Lua callbacks |
| `onRemovedInternal` | `Set<ActorEventCallback>` | `INotifyRemovedFromWorld.removedFromWorld()` — after Lua callbacks |
| `onAddedInternal` | `Set<ActorEventCallback>` | `INotifyAddedToWorld.addedToWorld()` — after Lua callbacks |
| `onProducedInternal` | `Set<ActorPairCallback>` | `INotifyProduction.unitProduced()` — after Lua callbacks |
| `onOtherProducedInternal` | `Set<ActorPairCallback>` | `INotifyOtherProduction.unitProducedByOther()` — after Lua callbacks |

### 4.8 INotify* Handler Implementation Pattern

Every handler follows the same pattern (from OpenRA source):

```typescript
handlerName(self: IGameActor, ...args: unknown[]): void {
  if (this.worldDisposing) return;

  for (const t of this.triggerables(trigger)) {
    try {
      // Marshal args to script-compatible values (delegates to ScriptTypes in full impl)
      t.fn(t.context, ...marshaledArgs);
    } catch (ex) {
      t.context.fatalError(ex);
      return; // Abort on first fatal error (matching OpenRA behavior)
    }
  }

  // Fire internal events (where applicable)
}
```

### 4.9 World Disposing Check

OpenRA's ScriptTriggers checks `world.Disposing` at the top of every handler. In TypeScript, we need a way to know if the world is disposing. Since `WorldStub` doesn't have a `disposing` property, we accept a callback or boolean:

```typescript
private _worldDisposingFn: (() => boolean) | null = null;

/** Register a function that returns whether the world is currently disposing. */
setWorldDisposingCheck(fn: () => boolean): void {
  this._worldDisposingFn = fn;
}
```

### 4.10 Argument Marshaling

In OpenRA, arguments are converted to `LuaValue` via `ext.ToLuaValue(context)`. In Phase B, we define the marshaling signature but defer full implementation:

- `OnDamaged`: marshals `e.attacker` and `e.damage.value` → `fn(context, selfArg, attackerScriptValue, damageNumber)`
- `OnKilled`: marshals `e.attacker` → `fn(context, selfArg, killerScriptValue)`
- `OnCapture`: marshals `captor`, `oldOwner`, `newOwner` → `fn(context, selfArg, captorVal, oldOwnerVal, newOwnerVal)`

For Phase B MVP, arguments are passed directly as their game types (IGameActor, PlayerStub, number). The `toScriptValue()` conversion from ScriptTypes can be applied in Phase C when TriggerGlobal wraps these callbacks.

---

## 5. ScriptComponent Design (B.2)

### 5.1 Overview

```
OpenRA 对照: OpenRA.Mods.Common/Scripting/LuaScript.cs (66 lines)

ScriptComponent (named LuaScript in OpenRA) is a WORLD-LEVEL trait
that creates and owns the ScriptContext. It is the entry point for
the entire scripting system at game startup.
```

### 5.2 Trait Info

```typescript
/**
 * Trait info for ScriptComponent.
 *
 * OpenRA 对照: LuaScriptInfo (lines 23-28)
 *
 * Requires SpawnMapActors + NotBefore SpawnStartingUnits.
 * Configurable: array of script file paths.
 */
export class ScriptComponentInfo {
  /** Script file names, relative to the map package. */
  scripts: readonly string[] = [];
}
```

### 5.3 ScriptComponent Class

```typescript
/**
 * World-level trait that owns the scripting runtime.
 *
 * OpenRA 对照: LuaScript (lines 31-65)
 *
 * Implements:
 * - IWorldLoaded: Creates ScriptContext, calls context.WorldLoaded()
 * - ITick: Calls context.Tick() each frame
 * - INotifyActorDisposing: Calls context.dispose() on world teardown
 *
 * Paradigm shift:
 * - C# creates Eluant MemoryConstrainedLuaRuntime + loads .lua files
 * - TS creates ScriptContext with JSON trigger system (Phase C)
 *   + optional fengari Lua VM for .lua files (Phase G)
 * - C# info.Scripts is FrozenSet<string>
 * - TS info.scripts is readonly string[]
 */
export class ScriptComponent implements IWorldLoaded, ITick, INotifyActorDisposing {
  readonly info: ScriptComponentInfo;
  context: ScriptContext | null = null;
  private _disposed = false;

  // IWorldLoaded
  worldLoaded(world: WorldStub, worldRenderer: WorldRendererStub): void {
    const scripts = this.info.scripts ?? [];
    this.context = new ScriptContext(world, worldRenderer, scripts);
    this.context.worldLoaded();
  }

  // ITick
  tick(self: IGameActor): void {
    this.context?.tick();
  }

  // INotifyActorDisposing
  disposing(self: IGameActor): void {
    if (this._disposed) return;
    this.context?.dispose();
    this._disposed = true;
  }

  get fatalErrorOccurred(): boolean {
    return this.context?.fatalErrorOccurred ?? false;
  }
}
```

### 5.4 Integration with ScriptContext

When `ScriptComponent.worldLoaded()` is called:
1. Creates `ScriptContext` with the world, worldRenderer, and script paths
2. Calls `context.worldLoaded()` which:
   - Registers named actors from the map
   - Parses JSON trigger definitions (Phase C)
   - Initializes player interfaces
   - (Phase G only) Loads fengari Lua VM if `.lua` files present

`ScriptContext._onFatalError` callback is set by ScriptComponent so that fatal script errors can invoke `world.endGame()` (OpenRA pattern).

---

## 6. CallScriptFunc Design (B.3)

### 6.1 Overview

```
OpenRA 对照: OpenRA.Mods.Common/Scripting/CallLuaFunc.cs (60 lines)

CallScriptFunc is an Activity that executes a script callback within
an actor's activity queue. It is a single-tick activity: Tick() calls
the function then returns true (Done).

Used by:
- GeneralProperties.CallFunc() — (Phase D) — "call this function, wait for completion"
- Various Global methods that need activity-queue synchronization
```

### 6.2 Class Structure

```typescript
/**
 * Activity that invokes a script callback within the actor's activity queue.
 *
 * OpenRA 对照: CallLuaFunc (CallLuaFunc.cs:19-60)
 *
 * This is a single-tick activity: it calls the function on the first Tick()
 * and then completes immediately (returns true).
 *
 * Paradigm shift:
 * - C# stores LuaFunction with CopyReference() + manual Dispose()
 * - TS stores a plain TriggerCallback; GC handles cleanup
 * - C# implements IDisposable (separate from Activity)
 * - TS uses the standard Activity lifecycle (no separate Dispose)
 */
export class CallScriptFunc extends Activity {
  private readonly _context: IScriptContext;
  private _fn: TriggerCallback | null;

  constructor(fn: TriggerCallback, context: IScriptContext) {
    super();
    this._fn = fn;
    this._context = context;
  }

  // Tick — single-tick execution
  override tick(self: IGameActor): boolean {
    try {
      this._fn?.call(null, this._context);
    } catch (ex) {
      this._context.fatalError(ex);
      return true; // Complete even on error
    }

    this._fn = null; // Release reference
    return true; // Activity complete
  }

  // Cancel — clean up if activity is canceled before execution
  override cancel(self: IGameActor, keepQueue = false): void {
    super.cancel(self, keepQueue);
    this._fn = null; // Release reference
  }
}
```

### 6.3 Lifecycle

1. Created: `const activity = new CallScriptFunc(myFn, context)`
2. Queued: `actor.queueActivity(activity)` — goes into actor's activity queue
3. Tick: `activity.tick(self)` called by ActivityRunner when activity reaches front of queue
4. Done: `tick()` returns `true` → ActivityRunner advances to next activity
5. Canceled: `activity.cancel(self)` → releases function reference, activity removed

Key invariant (from OpenRA): `CallScriptFunc` is ALWAYS single-tick. It never yields or queues child activities.

---

## 7. Unit Test Strategy

### 7.1 ScriptTriggers Tests (`ScriptTriggers.test.ts`)

**Target**: 70-80 test cases covering all 21 triggers + public API + internal events + error handling.

| Category | Test Cases | Description |
|----------|-----------|-------------|
| **Registration** | 5 | registerCallback adds to correct trigger list; multiple registrations; duplicate triggers; clear single; clearAll |
| **Trigger Dispatch** | 21 | One test per Trigger enum value — verify the correct callback signature and argument count |
| **Disposing Guard** | 2 | All handlers short-circuit when world is disposing; callbacks NOT invoked |
| **Fatal Error** | 3 | Exception in callback calls context.fatalError; aborts remaining callbacks; sets fatalErrorOccurred |
| **Internal Events** | 6 | Each internal event fires AFTER Lua callbacks; fires with correct arguments; listener can subscribe/unsubscribe |
| **Edge Cases** | 5 | Zero callbacks registered (no-op); register null callback (throws); clear empty trigger list; clearAll then re-register; multiple actors with same trigger |

**Mocks needed**:
- `IScriptContext` (mock — fatalError, fatalErrorOccurred)
- `IGameActor` (stub — minimal actor interface)
- `PlayerStub` (stub — player name)
- `IAttackInfo` (stub — attacker, damage)
- `CPos` (stub — cell position)

### 7.2 ScriptComponent Tests (`ScriptComponent.test.ts`)

**Target**: 15-20 test cases.

| Category | Test Cases | Description |
|----------|-----------|-------------|
| **Construction** | 2 | Creates with empty scripts; creates with script paths |
| **IWorldLoaded** | 3 | Creates ScriptContext; calls WorldLoaded; passes scripts to context |
| **ITick** | 2 | Calls context.Tick() each frame; survives null context (pre-WorldLoaded) |
| **INotifyActorDisposing** | 3 | Calls context.dispose(); sets _disposed flag; double-dispose is safe |
| **FatalErrorOccurred** | 2 | Returns context.fatalErrorOccurred; false when no context |

### 7.3 CallScriptFunc Tests (`CallScriptFunc.test.ts`)

**Target**: 10-15 test cases.

| Category | Test Cases | Description |
|----------|-----------|-------------|
| **Construction** | 2 | Creates with fn + context; stores references |
| **Tick** | 3 | Calls fn on tick; returns true (complete); fn not called twice |
| **Fatal Error** | 2 | Exception in fn calls context.fatalError; activity still completes |
| **Cancel** | 3 | Cancel before tick releases fn; cancel after tick is safe (fn already null); cancel calls super.cancel |
| **Edge Cases** | 2 | Null function (should not throw, just skip); context is null (should handle gracefully) |

### 7.4 Mock Strategy

All tests use `happy-dom` (no WebGL needed). The following are mocked:

```typescript
// ScriptContext mock
vi.mock('../Scripting/ScriptContext.js', () => ({
  ScriptContext: vi.fn().mockImplementation(() => ({
    world: {},
    worldRenderer: {},
    fatalErrorOccurred: false,
    tick: vi.fn(),
    worldLoaded: vi.fn(),
    dispose: vi.fn(),
    fatalError: vi.fn(),
  })),
}));

// Activity mock (for CallScriptFunc)
vi.mock('../Activities/Activity.js', () => ({
  Activity: class {
    cancel() {}
  },
}));
```

---

## 8. Migration Work Requirement Documents

---

### WRD B.1: ScriptTriggers.ts

```
## Work Requirement: ScriptTriggers

### Source
- OpenRA file: `OpenRA/OpenRA.Mods.Common/Scripting/ScriptTriggers.cs` (560 lines)
- Target file: `src/OpenRA.Mods.Common/Scripting/ScriptTriggers.ts`
- Target test: `src/OpenRA.Mods.Common/Scripting/ScriptTriggers.test.ts`
- Migration plan ref: TODO-20.B.1 from `docs/chapter20_scripting_system_migration_plan.md`
- Design spec: `docs/chapter20_phaseB_design.md` Section 4

### Dependencies (already completed)
- [x] `src/OpenRA.Game/Scripting/ScriptContext.ts` — Phase A (IScriptContext interface for fatalError)
- [x] `src/OpenRA.Game/Scripting/ScriptTypes.ts` — Phase A (type conversion for argument marshaling)
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — INotifyIdle, INotifyDamage, INotifyKilled, INotifyCapture, INotifySold, INotifyAddedToWorld, INotifyRemovedFromWorld, INotifyActorDisposing, IGameActor, PlayerStub, IAttackInfo

### Requirements

1. **Trigger enum (21 values)**: Implement the `Trigger` enum matching OpenRA's enum exactly (0-based, 21 entries). Export `TRIGGER_COUNT = 21` constant.

2. **Triggerable interface**: Define `Triggerable { fn: TriggerCallback, context: IScriptContext, selfArg?: unknown }`. In OpenRA this is a struct with LuaFunction + ScriptContext + LuaValue. In TS we store a plain function — no CopyReference/Dispose needed (GC handles it).

3. **18 INotify* interface implementations**: Implement every handler method from the 18 interfaces. Each handler:
   - Checks world-disposing guard (short-circuit if disposing)
   - Iterates the matching trigger list
   - Catches exceptions and calls context.fatalError(ex)
   - Fires internal events AFTER script callbacks (where applicable: Killed, Production, OtherProduction, Capture, AddedToWorld, RemovedFromWorld)

4. **10 new INotify* interfaces**: Declare the missing interfaces in `TriggerInterfaces.ts`. These are: INotifyProduction, INotifyOtherProduction, INotifyBuildingPlaced, INotifyObjectivesUpdated, INotifyInfiltrated (Common version), INotifyDiscovered, INotifyPassengerEntered, INotifyPassengerExited, INotifyWinStateChanged, INotifyTimeLimit.

5. **Argument marshaling**: Each handler must pass the correct arguments to the callback. For Phase B, pass game types directly (IGameActor, PlayerStub, number, string). Do NOT attempt to convert to script values via ScriptTypes — that will be done in Phase C by TriggerGlobal.

6. **Internal events**: Implement 6 internal event Sets — onKilledInternal, onCapturedInternal, onRemovedInternal, onAddedInternal, onProducedInternal, onOtherProducedInternal. These are typed as `Set<(actor: IGameActor) => void>` or `Set<(a: IGameActor, b: IGameActor) => void>`.

7. **ScriptTriggersInfo (trait info)**: Empty info class — no configurable fields.

### Babylon.js API Mapping
Not applicable — Phase B is pure game logic with no rendering components.

### Acceptance Criteria
- [ ] All 21 Trigger enum values implemented
- [ ] All 18 INotify* handlers implemented (8 existing + 10 new)
- [ ] 10 new INotify* interfaces declared in TriggerInterfaces.ts
- [ ] 6 internal event Sets implemented with correct typing
- [ ] registerCallback() adds to correct trigger list
- [ ] hasAnyCallbacksFor() returns correct boolean
- [ ] clear() removes and releases callbacks for one trigger
- [ ] clearAll() removes all callbacks
- [ ] World-disposing guard on every handler
- [ ] Fatal error handling (catch → context.fatalError → abort)
- [ ] Unit tests pass (`npx vitest run src/OpenRA.Mods.Common/Scripting/ScriptTriggers.test.ts`) — 70+ test cases
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] No per-frame allocation (trigger list iteration reuses no objects)
- [ ] E2E tests NOT required (pure logic, no visual surface)

### Constraints
- No Lua dependency — this is format-agnostic trigger infrastructure
- Do NOT import from @babylonjs/core
- Use IGameActor and PlayerStub from TraitsInterfaces (not full Actor/Player classes)
- _worldDisposingFn pattern for world-disposing check (WorldStub has no disposing property)
```

---

### WRD B.2: ScriptComponent.ts

```
## Work Requirement: ScriptComponent

### Source
- OpenRA file: `OpenRA/OpenRA.Mods.Common/Scripting/LuaScript.cs` (66 lines)
- Target file: `src/OpenRA.Mods.Common/Scripting/ScriptComponent.ts`
- Target test: `src/OpenRA.Mods.Common/Scripting/ScriptComponent.test.ts`
- Migration plan ref: TODO-20.B.2 from `docs/chapter20_scripting_system_migration_plan.md`
- Design spec: `docs/chapter20_phaseB_design.md` Section 5

### Dependencies (already completed)
- [x] `src/OpenRA.Game/Scripting/ScriptContext.ts` — Phase A (created and owned by ScriptComponent)
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — IWorldLoaded, ITick, INotifyActorDisposing, WorldStub, WorldRendererStub

### Requirements

1. **ScriptComponentInfo (trait info)**: Info class with `scripts: readonly string[]` field (mapping OpenRA's `FrozenSet<string> Scripts`). Defaults to empty array.

2. **ScriptComponent class**: World-level trait implementing IWorldLoaded, ITick, INotifyActorDisposing.

3. **IWorldLoaded.worldLoaded()**: Creates a `ScriptContext(world, worldRenderer, scripts)`, stores it as `this.context`, and calls `this.context.worldLoaded()`. OpenRA 对照: LuaScript lines 42-48.

4. **ITick.tick()**: Calls `this.context?.tick()` each simulation tick. OpenRA 对照: LuaScript lines 49-53.

5. **INotifyActorDisposing.disposing()**: Guarded by `_disposed` flag. Calls `this.context?.dispose()`. Sets `_disposed = true`. OpenRA 对照: LuaScript lines 54-62.

6. **fatalErrorOccurred getter**: Returns `this.context?.fatalErrorOccurred ?? false`. OpenRA 对照: LuaScript line 64.

### Babylon.js API Mapping
Not applicable — pure game logic.

### Acceptance Criteria
- [ ] ScriptComponentInfo created with scripts field
- [ ] IWorldLoaded creates ScriptContext and calls worldLoaded()
- [ ] ITick calls context.tick() each frame
- [ ] INotifyActorDisposing calls context.dispose() once
- [ ] Double-dispose is safe (guarded by _disposed flag)
- [ ] fatalErrorOccurred delegates to context
- [ ] Unit tests pass (`npx vitest run src/OpenRA.Mods.Common/Scripting/ScriptComponent.test.ts`) — 15+ test cases
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] E2E tests NOT required

### Constraints
- Do NOT import Babylon.js
- ScriptContext constructor signature must match Phase A implementation
- Use WorldStub/WorldRendererStub from TraitsInterfaces (not full types)
```

---

### WRD B.3: CallScriptFunc.ts

```
## Work Requirement: CallScriptFunc

### Source
- OpenRA file: `OpenRA/OpenRA.Mods.Common/Scripting/CallLuaFunc.cs` (60 lines)
- Target file: `src/OpenRA.Mods.Common/Activities/CallScriptFunc.ts`
- Target test: `src/OpenRA.Mods.Common/Activities/CallScriptFunc.test.ts`
- Migration plan ref: TODO-20.B.3 from `docs/chapter20_scripting_system_migration_plan.md`
- Design spec: `docs/chapter20_phaseB_design.md` Section 6

### Dependencies (already completed)
- [x] `src/OpenRA.Game/Activities/Activity.ts` — base Activity class (Ch3 Phase F)
- [x] `src/OpenRA.Game/Scripting/ScriptContext.ts` — IScriptContext for fatalError
- [x] `src/OpenRA.Game/Traits/TraitsInterfaces.ts` — IGameActor

### Requirements

1. **CallScriptFunc class**: Extends `Activity` from `src/OpenRA.Game/Activities/Activity.ts`. OpenRA 对照: CallLuaFunc lines 19-59.

2. **Constructor**: Takes `(fn: TriggerCallback, context: IScriptContext)`. Stores both. The function reference is directly stored (no `CopyReference()` equivalent needed in TS). OpenRA 对照: CallLuaFunc lines 24-28.

3. **tick() method**: Overrides Activity.tick(). Calls the stored function. Catches exceptions via context.fatalError(). Sets _fn to null (release reference). Returns `true` (activity complete — single-tick). OpenRA 对照: CallLuaFunc lines 30-43.

4. **cancel() method**: Overrides Activity.cancel(). Calls super.cancel(self, keepQueue). Sets _fn to null (release reference). OpenRA 对照: CallLuaFunc lines 45-48.

5. **No separate Dispose**: Unlike OpenRA's CallLuaFunc which implements IDisposable, TS relies on GC. The _fn reference is nulled in both tick() and cancel() to allow GC.

### Babylon.js API Mapping
Not applicable — pure game logic.

### Acceptance Criteria
- [ ] Constructor stores fn and context
- [ ] tick() calls the function
- [ ] tick() returns true (single-tick activity)
- [ ] tick() nulls function reference after call
- [ ] tick() calls context.fatalError on exception
- [ ] cancel() calls super.cancel() and nulls function reference
- [ ] cancel() after tick() is safe (fn already nulled)
- [ ] Unit tests pass (`npx vitest run src/OpenRA.Mods.Common/Activities/CallScriptFunc.test.ts`) — 10+ test cases
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] E2E tests NOT required

### Constraints
- Extends Activity correctly (match the abstract class interface from Ch3 Phase F)
- Do NOT import Babylon.js
- The function signature is TriggerCallback: `(context: IScriptContext, ...args: unknown[]) => void`
```
