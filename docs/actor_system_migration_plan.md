# OpenRA to Babylon.js Migration Plan: Chapter 3 -- Game World and Actor System

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.
>
> **Chapter Status**: Chapter 3 -- Game World & Actor System  [ ] Pending (0/8 core files, 0%)
> **Planning Date**: 2026-06-04
> **Prerequisite**: Chapter 2 (Rendering Engine) -- COMPLETE (27/27, 100%)

---

## Table of Contents

1. [Overview and Architecture Principles](#1-overview-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Detailed Migration Tasks (TODO)](#3-detailed-migration-tasks-todo)
   - 3.1 [World.cs -- Game World Container](#31-worldcs----game-world-container)
   - 3.2 [Actor.cs -- Game Object](#32-actorcs----game-object)
   - 3.3 [TraitsInterfaces.cs & TraitDictionary.cs -- Trait System](#33-traitsinterfacescs--traitdictionarycs----trait-system)
   - 3.4 [ActorInfo.cs -- Actor Metadata](#34-actorinfocs----actor-metadata)
   - 3.5 [Activity.cs -- Activity System](#35-activitycs----activity-system)
   - 3.6 [WeaponInfo.cs -- Weapon System](#36-weaponinfocs----weapon-system)
   - 3.7 [Player.cs -- Player Object](#37-playercs----player-object)
   - 3.8 [Supporting Trait Files](#38-supporting-trait-files)
4. [Trait Interface Mapping Table](#4-trait-interface-mapping-table)
5. [Dependency Graph](#5-dependency-graph)
6. [Babylon.js API Mapping Table](#6-babylonjs-api-mapping-table)
7. [Migration Strategy and Phasing](#7-migration-strategy-and-phasing)
8. [Acceptance Criteria](#8-acceptance-criteria)
9. [Risk and Mitigation](#9-risk-and-mitigation)

---

## 1. Overview and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Game World and Actor system is the **most architecturally challenging** phase of the entire project. The core paradigm shift: **from C# reflection-driven Trait composition to TypeScript Component-based composition**.

OpenRA uses a unique **Actor-Trait-Activity** three-layer design, which is a variant of the Entity-Component-System (ECS) pattern. Unlike traditional ECS, OpenRA's Trait system is closer to the Composition Pattern, emphasizing "composition over inheritance" -- a tank unit does not inherit from "UnitBase," but rather dynamically combines `Mobile`, `Health`, `Armor`, `Armament` and other Traits at runtime through YAML configuration.

| Dimension | OpenRA (C#) | TypeScript / Babylon.js |
|-----------|-------------|------------------------|
| **Trait composition** | C# generics + reflection + `TraitDictionary` | `Map<string, Component[]>` + type guards |
| **Game loop** | Manual `World.Tick()` with sorted actor iteration | Fixed timestep accumulator in `requestAnimationFrame` |
| **Actor lifecycle** | C# event-based (`INotifyCreated`, `INotifyAddedToWorld`, etc.) | Component lifecycle hooks (`attach()`/`detach()`/`onEnabledChanged()`) |
| **Activity state machine** | C# coroutine-style linked list + child activities | Custom `Activity` abstract class + `ActivityRunner` |
| **Weapon configuration** | YAML + `FieldLoader` reflection | JSON Schema validation + build-time YAML-to-JSON |
| **Spatial queries** | 2D `ScreenMap` + `IActorMap` (cell-based spatial hash) | 3D Octree / Uniform Grid + `scene.pick()` raycasting |
| **Player model** | `PlayerActor` pattern (PlayerActor carries Traits) | `Player` class (non-scene node) + `Map<string, Component>` |

### 1.2 Architecture Diagram

Refer to **Figure 4-1** in `docs/openra_migration.agent.final.converted.md` (lines 569-620) for the complete OpenRA Actor-Trait-Activity to Babylon.js architecture mapping diagram. Key structural mappings:

```
World           -->  BABYLON.Scene + GameWorldManager
Actor           -->  GameActor extends TransformNode
TraitDictionary -->  Map<string, Component[]>
Trait interfaces -->  TypeScript interface + type guard functions
Activity        -->  Custom Activity base class + ActivityRunner
WeaponInfo      -->  WeaponConfig (data class)
Player          -->  Player class (non-scene node) + Observable
```

### 1.3 Source Material

- **Architecture Analysis**: `docs/openra_migration.agent.final.converted.md` Section 4 (lines 458-623)
- **Chapter 2 Reference**: `docs/rendering_migration_plan.md`
- **Progress Reference**: `docs/migration_progress.md`
- **OpenRA Reference Source**: `OpenRA/OpenRA.Game/` (read-only)

---

## 2. File Mapping Table

### 2.1 Core Files (8 files, from Architecture Analysis Table 4-1)

| # | OpenRA Source | Migration Target | Class/Interface | Complexity | Lines (C#) | Key Mapping Target |
|:---:|:---|:---|:---|:---:|:---:|:---|
| 1 | `OpenRA.Game/World.cs` | `src/OpenRA.Game/World.ts` | `World` | High | 650 | `BABYLON.Scene` + `GameWorldManager` |
| 2 | `OpenRA.Game/Actor.cs` | `src/OpenRA.Game/Actor.ts` | `Actor` | High | 650 | `GameActor extends TransformNode` |
| 3 | `OpenRA.Game/Traits/TraitsInterfaces.cs` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | `ITick`, `INotify*`, `IResolveOrder`, etc. | Medium | 664 | TypeScript `interface` + type guard functions |
| 4 | `OpenRA.Game/TraitDictionary.cs` | `src/OpenRA.Game/TraitDictionary.ts` | `TraitDictionary`, `TraitContainer<T>` | Medium | 329 | `Map<string, Component[]>` + linear traversal |
| 5 | `OpenRA.Game/GameRules/ActorInfo.cs` | `src/OpenRA.Game/GameRules/ActorInfo.ts` | `ActorInfo`, `TraitInfo` | Medium | 201 | `ActorConfig` + `ComponentDef` + JSON |
| 6 | `OpenRA.Game/Activities/Activity.cs` | `src/OpenRA.Game/Activities/Activity.ts` | `Activity` | High | 296 | Custom `Activity` base class + `ActivityRunner` |
| 7 | `OpenRA.Game/GameRules/WeaponInfo.cs` | `src/OpenRA.Game/GameRules/WeaponInfo.ts` | `WeaponInfo`, `IProjectile`, `IWarhead` | Medium | 268 | `WeaponConfig` + `Projectile` Component |
| 8 | `OpenRA.Game/Player.cs` | `src/OpenRA.Game/Player.ts` | `Player` | Low | 337 | `Player` class (non-scene node) + `Observable` |

### 2.2 Supporting Files (Chapter 3 scope extensions)

| # | OpenRA Source | Migration Target | Class/Interface | Complexity | Lines (C#) | Key Mapping Target |
|:---:|:---|:---|:---|:---:|:---:|:---|
| S1 | `OpenRA.Game/Activities/CallFunc.cs` | `src/OpenRA.Game/Activities/CallFunc.ts` | `CallFunc` | Low | ~40 | `CallFuncActivity` (callback wrapper) |
| S2 | `OpenRA.Game/Traits/Target.cs` | `src/OpenRA.Game/Traits/Target.ts` | `Target` | Low | ~50 | `Target` data class (position/actor reference) |
| S3 | `OpenRA.Game/GameRules/Ruleset.cs` | `src/OpenRA.Game/GameRules/Ruleset.ts` | `Ruleset` | Low | ~150 | `RulesetConfig` (collection of ActorInfo, WeaponInfo, etc.) |
| S4 | `OpenRA.Game/Traits/World/ScreenMap.cs` | `src/OpenRA.Game/Traits/World/ScreenMap.ts` | `ScreenMap` | Medium | ~200 | `ScreenMapComponent` (spatial hash of screen positions) |
| S5 | `OpenRA.Game/Traits/Player/Shroud.cs` | `src/OpenRA.Game/Traits/Player/Shroud.ts` | `Shroud` | Medium | ~250 | `ShroudComponent` (fog of war) |
| S6 | `OpenRA.Game/Traits/Player/FrozenActorLayer.cs` | `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` | `FrozenActorLayer` | Medium | ~200 | `FrozenActorComponent` (frozen actor rendering) |
| S7 | `OpenRA.Game/Orders/IOrderGenerator.cs` | `src/OpenRA.Game/Orders/IOrderGenerator.ts` | `IOrderGenerator` | Low | ~40 | `IOrderGenerator` interface |

---

## 3. Detailed Migration Tasks (TODO)

### 3.1 World.cs -- Game World Container

**OpenRA Reference**: `OpenRA.Game/World.cs` (650 lines)
**Migration Target**: `src/OpenRA.Game/World.ts`
**Status**: Pending migration
**Complexity**: High
**Dependencies**: TODO-2.1.x (Renderer -- `Engine.runRenderLoop()`), TODO-3.2.x (Actor -- `GameActor`)

**Architecture Context**: `World` is the total container of game state. Core collections: `SortedDictionary<uint, Actor>` (all Actors, sorted by ActorID for deterministic iteration), `List<IEffect>` (independent visual effects like bullet trails and explosions), `Queue<Action<World>>` (frameEndActions, deferred operations for safe actor disposal). Key members: `WorldActor` (special Actor carrying global Traits like map system, selection system), `IActorMap` (spatial query interface), `ScreenMap` (screen coordinate to Actor mapping), `WorldTick` (logic frame counter), `Timestep` (tick interval, default 40ms = 25 TPS).

`World.Tick()` is the game's main heartbeat. Execution order is carefully designed: increment `WorldTick`, then execute `Activity.Tick()`, all `ITick` Traits, `IEffect.Tick()`. `ApplyToActorsWithTraitTimed<ITick>()` batches timed traversal to identify hot-path Traits. `TickRender()` is independent of logic Tick, calling `ITickRender` per render frame for visual interpolation. `SyncHash()` computes per-frame sync hash for network sync validation.

- [ ] **TODO-3.1.1** Create `src/OpenRA.Game/World.ts` with `GameWorldManager` class. Map `World` to `BABYLON.Scene` + `GameWorldManager` (non-scene manager class).
- [ ] **TODO-3.1.2** Implement fixed timestep Tick loop. Use `requestAnimationFrame` driver with time accumulation: when accumulated time >= 40ms, execute one logic Tick and decrement accumulator. Handle spiral of death protection: if accumulator exceeds multiple ticks, clamp to max N ticks per frame.
- [ ] **TODO-3.1.3** Implement actor lifecycle management. Map `SortedDictionary<uint, Actor>` to `Map<number, GameActor>` (sorted numerically for deterministic iteration). Emit lifecycle events on add/remove: `onActorAdded` / `onActorRemoved` observables.
- [ ] **TODO-3.1.4** Implement `WorldActor` pattern. Create a special `GameActor` instance on world creation, attach global-scope Traits (map, selection, etc.) to it.
- [ ] **TODO-3.1.5** Implement `frameEndActions` queue. Map `Queue<Action<World>>` to a deferred action queue processed after all `ITick` Traits complete each frame. Use for safe actor disposal.
- [ ] **TODO-3.1.6** Implement `ITick` batch traversal. `applyToActorsWithTrait<ITick>()` iterates all actors, collects those implementing `ITick`, and calls `tick()` in deterministic order. Use `performance.now()` for optional timing instrumentation.
- [ ] **TODO-3.1.7** Separate `tickRender()` from logic `tick()`. `tickRender()` is called on every animation frame (not fixed timestep), drives visual interpolation via `ITickRender` Traits. This decoupling ensures deterministic simulation at 25 TPS while maintaining smooth 60fps rendering.
- [ ] **TODO-3.1.8** Implement spatial query interface replacement. Map `IActorMap` (2D cell-based spatial hash) to either `BABYLON.Octree` or a custom Uniform Grid for 3D spatial queries. Provide `getActorsInArea(center, radius): GameActor[]` method.
- [ ] **TODO-3.1.9** Remove `ScreenMap` 2D screen mapping. In 3D, unit selection uses raycasting: `scene.pick()` or GPU picker. Document the removal and provide guidance for selection logic migration.

**Acceptance Criteria**:
- Fixed timestep loop runs at exactly 25 TPS, verified by counting ticks over a 5-second test window
- Actor addition/removal is deterministic (sorted by ActorID)
- Frame-end actions execute after all Traits tick, not during
- 1000 actors with 10 Traits each tick in under 1ms (performance benchmark)
- SyncHash computation produces consistent values for identical world state

**Estimated Effort**: ~800 lines implementation + ~600 lines test

---

### 3.2 Actor.cs -- Game Object

**OpenRA Reference**: `OpenRA.Game/Actor.cs` (650 lines)
**Migration Target**: `src/OpenRA.Game/Actor.ts`
**Status**: Pending migration
**Complexity**: High
**Dependencies**: TODO-3.1.x (World), TODO-3.3.x (TraitsInterfaces, TraitDictionary)

**Architecture Context**: `Actor` is the unified representation of all game entities. Its core design is a "lightweight container": it has almost no behavior itself, all functionality is achieved through Trait composition stored in `TraitDictionary`. Key members: `ActorInfo Info` (static metadata for the Actor type), `uint ActorID` (globally unique identifier), `Player Owner` (owning player), `IsInWorld` (whether added to world), `WillDispose`/`Disposed` (deferred destruction state), and cached trait references like `IOccupySpace`.

The Condition System is the core of `Actor`'s dynamic behavior. `GrantCondition("deployed")` returns an integer token, `RevokeCondition(token)` revokes the condition. The same condition can be granted multiple times (different tokens); it is only invalidated when ALL tokens are revoked. `conditionCache` maintains the current set of active conditions, supporting runtime evaluation of complex expressions like `RequiresCondition: deployed || upgraded`. The `IObservesVariables` interface allows Traits to subscribe to condition changes; many Traits (`RenderSprites`, `WithInfantryBody`) depend on the condition system to control enable/disable state.

`Actor.Tick()` drives the Activity system. `Trait<T>()` and `TraitsImplementing<T>()` query Traits from `TraitDictionary`. `ResolveOrder(Order)` dispatches player commands to all `IResolveOrder` Traits.

- [ ] **TODO-3.2.1** Create `src/OpenRA.Game/Actor.ts` with `GameActor` class extending `BABYLON.TransformNode`. Use `TransformNode` as the base class to provide 3D transform capability and scene graph participation.
- [ ] **TODO-3.2.2** Implement `TraitDictionary` integration. `GameActor` owns a `TraitDictionary` instance; `trait<T>(name: string): T | undefined` performs type assertion lookup.
- [ ] **TODO-3.2.3** Implement the Condition System. `conditionManager: ConditionManager` manages condition tokens: `grantCondition(name: string): number` (returns token), `revokeCondition(token: number): void`. The same condition name can have multiple active tokens; condition is only removed when all tokens are revoked.
- [ ] **TODO-3.2.4** Implement condition expression evaluation. Support `RequiresCondition` boolean algebra: `deployed`, `!deployed`, `deployed || upgraded`, `deployed && !disabled`. Evaluated against current `conditionCache` set.
- [ ] **TODO-3.2.5** Implement `IObservesVariables` observer pattern. Traits can subscribe to condition changes via `registerObserver(observer: IObservesVariables): void`. When conditions change, notify all registered observers.
- [ ] **TODO-3.2.6** Implement Actor lifecycle state machine: `Created` -> `AddedToWorld` -> `InWorld` -> `RemovedFromWorld` -> `Disposing` -> `Disposed`. Use explicit state transitions; never skip stages.
- [ ] **TODO-3.2.7** Implement `WillDispose` deferred destruction. When an actor is marked `WillDispose = true`, it is queued for destruction at frame end (via `World.frameEndActions`). No game logic should reference the actor after `WillDispose` is set.
- [ ] **TODO-3.2.8** Implement `Owner` property and its three-layer impact: rendering (player color), logic (can only control own units), diplomacy (enemy/neutral/ally). Owner change must trigger render update and diplomacy re-evaluation.
- [ ] **TODO-3.2.9** Implement `ResolveOrder(order)` dispatch. Iterate all Traits implementing `IResolveOrder` and call `resolveOrder(self, order)`. Order handling is key to RTS unit control.

**Acceptance Criteria**:
- `GameActor extends TransformNode` correctly participates in Babylon.js scene graph
- Condition tokens are correctly reference-counted (multiple grants, single revoke)
- Lifecycle state transitions are strictly enforced (cannot skip from Created to Disposed)
- `WillDispose` actors are never referenced by game logic
- Owner changes trigger correct rendering and diplomacy updates
- 500 actors with condition changes per tick run in under 2ms

**Estimated Effort**: ~750 lines implementation + ~550 lines test

---

### 3.3 TraitsInterfaces.cs & TraitDictionary.cs -- Trait System

**OpenRA Reference**: `OpenRA.Game/Traits/TraitsInterfaces.cs` (664 lines), `OpenRA.Game/TraitDictionary.cs` (329 lines)
**Migration Target**: `src/OpenRA.Game/Traits/TraitsInterfaces.ts`, `src/OpenRA.Game/TraitDictionary.ts`
**Status**: Pending migration
**Complexity**: Medium
**Dependencies**: None (foundational, blocks Actor and World)

**Architecture Context**: `TraitsInterfaces.cs` defines all interface contracts for the Trait system. Interfaces are organized into four categories by responsibility: Update & Render (`ITick`, `ITickRender`), Lifecycle Notifications (`INotifyCreated`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `INotifyActorDisposing`, `INotifyKilled`), Game Logic (`IResolveOrder`, `IIssueOrder`, `IHealth`, `IFacing`, `IOccupySpace`, `ITargetable`), and Dependency Declarations (`Requires<T>`, `NotBefore<T>`).

`TraitDictionary.cs` implements Trait storage. Traits are bucketed by interface type: `TraitContainer<T>` maintains a sorted array with binary search for `O(log n)` lookup. Dependencies are resolved via `ActorInfo.TraitsInConstructOrder()` using topological sort.

Migration uses a two-layer architecture: Rendering Traits (`RenderSprites`, `WithInfantryBody`) map to `BABYLON.Behavior` subclasses; Logic Traits (`Health`, `Mobile`, `AutoTarget`) use a custom Component system. `GameActor` maintains `Map<string, Component>` for component storage, with component base class providing `attach()`/`detach()`/`onEnabledChanged()` lifecycle methods.

C# interface multiple-implementation requires special handling in TypeScript. A C# Trait can simultaneously implement `ITick`, `INotifyCreated`, and `IResolveOrder` -- in TypeScript this becomes a Component `implements` multiple interfaces, with type guard functions for detection. `TraitsImplementing<IResolveOrder>()` iterates `componentArray`, executing `isIResolveOrder(component)` type guards on each component to collect matches. Time complexity degrades from O(log n) to O(n), but a single Actor typically has only 10-30 components, making the overhead acceptable.

#### 3.3.1 TraitsInterfaces.ts

- [ ] **TODO-3.3.1** Create `src/OpenRA.Game/Traits/TraitsInterfaces.ts`. Define all core Trait interfaces as TypeScript `interface` types, organized into four categories:
  - **Update & Render**: `ITick { tick(actor: GameActor): void }`, `ITickRender { tickRender(actor: GameActor, wr: WorldRenderer): void }`
  - **Lifecycle**: `INotifyCreated { created(actor: GameActor): void }`, `INotifyAddedToWorld { addedToWorld(actor: GameActor): void }`, `INotifyRemovedFromWorld { removedFromWorld(actor: GameActor): void }`, `INotifyActorDisposing { disposing(actor: GameActor): void }`, `INotifyKilled { killed(actor: GameActor, attackInfo: AttackInfo): void }`
  - **Game Logic**: `IResolveOrder { resolveOrder(actor: GameActor, order: Order): void }`, `IIssueOrder { readonly orders: Order[] }`, `IHealth`, `IFacing`, `IOccupySpace`, `ITargetable`
  - **Dependency**: `Requires<T>`, `NotBefore<T>` (runtime markers checked during construction)
- [ ] **TODO-3.3.2** Implement type guard functions for each multi-method interface. e.g., `isIResolveOrder(obj: unknown): obj is IResolveOrder`, `isITick(obj: unknown): obj is ITick`. These enable `TraitsImplementing<T>()` linear scanning.
- [ ] **TODO-3.3.3** Define `Component` abstract base class with `attach(actor: GameActor): void`, `detach(): void`, `onEnabledChanged(enabled: boolean): void` lifecycle hooks. All Traits extend this base class.
- [ ] **TODO-3.3.4** Create `BehaviorComponent` for rendering Traits. Wraps `BABYLON.Behavior<T>` interface but integrates with the Component lifecycle. Rendering Traits like `RenderSprites` extend `BehaviorComponent`.
- [ ] **TODO-3.3.5** Document the two-layer Trait architecture in the file header: rendering Traits (Babylon.Behavior) vs. logic Traits (custom Component).

#### 3.3.2 TraitDictionary.ts

- [ ] **TODO-3.3.6** Create `src/OpenRA.Game/TraitDictionary.ts`. Implement `TraitDictionary` class with `Map<string, Component[]>` storage keyed by component class name.
- [ ] **TODO-3.3.7** Implement `addTrait(component: Component): void` and `removeTrait(component: Component): void`. Registration indexed by component interface names.
- [ ] **TODO-3.3.8** Implement `trait<T>(name: string): T | undefined` for single trait lookup. Returns the first component matching the name (with type assertion to generic T).
- [ ] **TODO-3.3.9** Implement `traitsImplementing<T>(typeGuard: (obj: unknown) => obj is T): T[]` for interface-based batch query. Linear scan all components, filter by type guard, return array.
- [ ] **TODO-3.3.10** Implement `hasTrait(name: string): boolean` and `allTraits(): Component[]`. Provide read-only access to the full component list.
- [ ] **TODO-3.3.11** Implement topological sort for trait construction order. `TraitInfo[]` -> topologically sorted array respecting `Requires<T>` and `NotBefore<T>` constraints. Use Kahn's algorithm.

**Acceptance Criteria**:
- All 9 core interfaces from Section 4 Table 4-2 are defined and exported
- Type guard functions correctly identify each interface (test with mock objects implementing 0, 1, and multiple interfaces)
- `TraitDictionary.traitsImplementing()` correctly collects all matching components (test with 10 components, 3 implementing ITick)
- Topological sort produces correct construction order (test with known dependency graph)
- Performance: 50 components in dictionary, `traitsImplementing()` executes in under 0.5ms

**Estimated Effort**:
- TraitsInterfaces.ts: ~500 lines implementation + ~400 lines test
- TraitDictionary.ts: ~350 lines implementation + ~300 lines test

---

### 3.4 ActorInfo.cs -- Actor Metadata

**OpenRA Reference**: `OpenRA.Game/GameRules/ActorInfo.cs` (201 lines)
**Migration Target**: `src/OpenRA.Game/GameRules/ActorInfo.ts`
**Status**: Pending migration
**Complexity**: Medium
**Dependencies**: TODO-3.3.x (TraitsInterfaces -- `Requires<T>` topological sort)

**Architecture Context**: `ActorInfo` stores static metadata for an Actor type. Each `ActorInfo` contains a list of `TraitInfo` objects (the configuration data for each Trait). `TraitsInConstructOrder()` performs topological sort on Traits based on `Requires<T>` and `NotBefore<T>` dependency declarations, ensuring `AttackBase` is created before traits requiring `IFacing` and `IPositionable`. In the web context, all configuration is loaded from JSON (build-time compiled from YAML), enabling JSON Schema validation.

- [ ] **TODO-3.4.1** Create `src/OpenRA.Game/GameRules/ActorInfo.ts`. Define `ComponentDef` interface (Trait configuration data): `{ name: string, properties: Record<string, unknown>, requires?: string[], notBefore?: string[] }`.
- [ ] **TODO-3.4.2** Define `ActorConfig` class with `name: string`, `traits: ComponentDef[]`, `traitsInConstructOrder(): ComponentDef[]`. Store parsed JSON configuration.
- [ ] **TODO-3.4.3** Implement `fromJSON(json: unknown): ActorConfig` factory method with JSON Schema validation. Validate required fields (`name`, `traits`), validate each `ComponentDef` structure.
- [ ] **TODO-3.4.4** Implement topological sort for trait construction order (`traitsInConstructOrder()`). Use Kahn's algorithm for `Requires<T>` and `NotBefore<T>` dependency resolution. Throw descriptive error on cycles or missing dependencies.
- [ ] **TODO-3.4.5** Implement YAML-to-JSON compilation guidance in the file header. Document that YAML parsing at runtime in the browser is expensive; recommend Vite plugin or build script for compile-time YAML-to-JSON conversion.

**Acceptance Criteria**:
- JSON Schema validation catches malformed actor configurations (missing name, invalid trait structure)
- Topological sort correctly orders traits with known dependency chains
- Circular dependencies throw a clear error message identifying the cycle
- `ActorConfig` is immutable after construction (no runtime modification)

**Estimated Effort**: ~300 lines implementation + ~250 lines test

---

### 3.5 Activity.cs -- Activity System

**OpenRA Reference**: `OpenRA.Game/Activities/Activity.cs` (296 lines), `OpenRA.Game/Activities/CallFunc.cs` (~40 lines)
**Migration Target**: `src/OpenRA.Game/Activities/Activity.ts`, `src/OpenRA.Game/Activities/CallFunc.ts`
**Status**: Pending migration
**Complexity**: High
**Dependencies**: TODO-3.2.x (Actor -- `GameActor` must exist for Activity to reference `self`)

**Architecture Context**: `Activity` implements the Actor behavior state machine using a linked list + child activity two-layer structure. `Activity` is an abstract base class; subclasses implement `Tick(Actor self)` returning `true` to indicate completion. `nextActivity` pointer forms the activity chain -- the current activity automatically switches to the next one upon completion. `childActivity` points to a child activity; when `ChildHasPriority = true` (default), the child activity takes priority -- enabling `Move` to have `PathFind` as a child, continuously pathfinding while moving.

Activity state transitions: `Queued` -> `OnFirstRun()` -> `Active` -> `Tick()` returns `true` -> `Done` -> `OnLastRun()`. Cancellation sets state to `Canceling`; activities must detect this in `Tick()` and clean up. `IsInterruptible` controls whether interruption is allowed -- `Attack` is typically non-interruptible. `TickOuter()` is the external entry point, managing state transitions and call order.

Typical activity chain showing composition: "Move to target and attack" is composed of `Move -> Attack -> Move -> Wait`, where `Move` has `PathFind` as a child activity, and `Attack` has `Aim` as a child activity. Complex behaviors are defined through simple activity composition.

**Migration Decision -- Plan A vs Plan B**: The core migration challenge is converting C# coroutine-style activity chains to JS async models. **Plan A** retains the class hierarchy: define `abstract class Activity`, subclasses override `tick(actor): boolean`, and `ActivityRunner` calls `tickOuter()` each Tick. **Plan B** uses Promise/Async: each activity returns a Promise, chains execute sequentially via `async/await`. Plan B produces cleaner code but loses child activity priority and per-Tick fine-grained control. **Decision: Use Plan A for core game logic (preserves determinism), Plan B for UI animations (where strict determinism is not required).**

- [ ] **TODO-3.5.1** Create `src/OpenRA.Game/Activities/Activity.ts`. Define `abstract class Activity` with `tick(actor: GameActor): boolean` (returns `true` when done), `nextActivity?: Activity`, `childActivity?: Activity`, `childHasPriority: boolean`, `isInterruptible: boolean`, `state: ActivityState` enum.
- [ ] **TODO-3.5.2** Implement Activity state machine: `ActivityState` enum (`Queued`, `Active`, `Done`, `Canceling`, `Canceled`). State transitions governed by `tickOuter()`.
- [ ] **TODO-3.5.3** Implement `tickOuter()`: the external entry point. If `childActivity` exists and `childHasPriority`, tick child first. If child returns true (done), clear child. Otherwise tick self, handle state transitions, manage cancellation.
- [ ] **TODO-3.5.4** Implement lifecycle hooks: `onFirstRun(actor: GameActor): void` (called on first activate), `onLastRun(actor: GameActor): void` (called after completion/destruction, must always run for resource cleanup).
- [ ] **TODO-3.5.5** Implement cancellation flow: `cancel(actor: GameActor, keepQueue?: boolean): void`. Set state to `Canceling`; propagate to child activity. Activities check `isCanceling` in `tick()` and return `true` after cleanup.
- [ ] **TODO-3.5.6** Implement activity queuing and chaining: `queueChild(activity: Activity): void`, `queue(activity: Activity): void` (append to activity chain via `nextActivity`). Support chaining multiple activities sequentially.
- [ ] **TODO-3.5.7** Create `CallFunc.ts` activity: a simple activity wrapping a callback function. `CallFunc(() => { doSomething(); }).tick()` returns `true` after calling the function. Useful for one-shot actions like "play sound after move completes."
- [ ] **TODO-3.5.8** Design and document Plan B (Promise-based) API for UI animations. Provide `Activity.runAsync(actor: GameActor): Promise<void>` as an optional async execution path for non-deterministic activities.
- [ ] **TODO-3.5.9** Create `ActivityRunner` utility class for managing activity execution across all actors. Calls `tickOuter()` on each actor's current activity in deterministic order.

**Acceptance Criteria**:
- Activity chain `Move -> Attack -> Wait` executes in correct order
- Child activity preemption works: `Move` with `PathFind` child ticks child first
- Cancellation propagates from parent to child and child to parent
- `onLastRun()` is ALWAYS called before disposal (critical for resource cleanup)
- Activity state transitions are valid: cannot go from Queued directly to Done
- 500 actors each running an activity tick in under 1ms

**Estimated Effort**:
- Activity.ts: ~500 lines implementation + ~400 lines test
- CallFunc.ts: ~60 lines implementation + ~80 lines test

---

### 3.6 WeaponInfo.cs -- Weapon System

**OpenRA Reference**: `OpenRA.Game/GameRules/WeaponInfo.cs` (268 lines)
**Migration Target**: `src/OpenRA.Game/GameRules/WeaponInfo.ts`
**Status**: Pending migration
**Complexity**: Medium
**Dependencies**: None (pure data structure, but needs ActorInfo for context)

**Architecture Context**: `WeaponInfo` is a pure data structure for weapon configuration. All properties are loaded through YAML/`FieldLoader`. The weapon itself has no behavior -- firing logic is implemented by the `Armament` Trait, projectile flight by `IProjectile` implementations, and damage application by `IWarhead` implementations. The three-layer separation (Weapon Config -> Launcher Trait -> Projectile -> Warhead) is the core design, enabling the same weapon to configure different projectile types (missiles, bullets, projectiles, beams, etc.) and different projectiles to configure different warhead effects (spread, area, persistent damage).

Key members: `Range` (range, WDist world distance), `Projectile` (projectile type configuration), `Warhead` (warhead effect configuration), `Report` (firing sound), `Burst` (burst count), `ReloadDelay` (reload delay).

- [ ] **TODO-3.6.1** Create `src/OpenRA.Game/GameRules/WeaponInfo.ts`. Define `WeaponConfig` class with all weapon properties as typed fields: `range: WDist`, `projectile: ProjectileConfig`, `warheads: WarheadConfig[]`, `report: string`, `burst: number`, `burstDelay: number`, `reloadDelay: number`, etc.
- [ ] **TODO-3.6.2** Define `ProjectileConfig` interface: projectile type, speed, gravity, inaccuracy, launch angle, etc. Sub-interfaces for each projectile type (`BulletProjectileConfig`, `MissileProjectileConfig`, `GravityBombConfig`, `LaserProjectileConfig`).
- [ ] **TODO-3.6.3** Define `WarheadConfig` interface: damage, damage types, spread, versus armor, target validation, effect visuals.
- [ ] **TODO-3.6.4** Implement `fromJSON(json: unknown): WeaponConfig` factory with JSON Schema validation. Validate required fields, numeric ranges, enum values for projectile/warhead types.
- [ ] **TODO-3.6.5** Document the three-layer weapon architecture in the file header: WeaponConfig (data) -> Armament Trait (launcher, out of Chapter 3 scope) -> Projectile Component (flight) -> Warhead Component (damage).
- [ ] **TODO-3.6.6** Document that actual `IProjectile` and `IWarhead` implementations belong to `OpenRA.Mods.Common/` (mod code). Chapter 3 only provides the configuration data layer; projectile/warhead logic migration is deferred to the Mod System chapter.
- [ ] **TODO-3.6.7** (Deferred) Design projectile 3D visualization guidance. Missiles follow Bezier curves, bullets use raycast instantaneous hit, projectiles simulate gravity with parabolic arcs. Mark as guidance for future chapters, not in Chapter 3 implementation scope.

**Acceptance Criteria**:
- `WeaponConfig.fromJSON()` correctly parses all OpenRA weapon YAML fields
- JSON Schema validation rejects invalid configurations with clear error messages
- Burst weapon configuration (count + delay) is correctly modeled
- Weapon balance data (damage, range, fire rate) is faithfully preserved

**Estimated Effort**: ~350 lines implementation + ~250 lines test

---

### 3.7 Player.cs -- Player Object

**OpenRA Reference**: `OpenRA.Game/Player.cs` (337 lines)
**Migration Target**: `src/OpenRA.Game/Player.ts`
**Status**: Pending migration
**Complexity**: Low
**Dependencies**: TODO-3.2.x (Actor -- `PlayerActor` pattern depends on GameActor)

**Architecture Context**: `Player` uses the unique **PlayerActor pattern**: each `Player` owns a `PlayerActor`, which has a full Trait set just like regular game Actors. All player capabilities -- fog of war (`Shroud`), frozen unit layer (`FrozenActorLayer`), resource management, tech tree -- are implemented through Traits on the PlayerActor. The advantage is unified processing logic: normal Actors and PlayerActor use the same Trait system without special mechanisms.

Key members: `PlayerName` (name), `Faction` (faction), `RelationshipWith()` (query diplomacy relationship, returns Enemy/Neutral/Ally), `WinState` (win/loss state), `PlayerMask` (bitmask for fast batch relationship queries). `RelationshipWith()` affects extensive logic: can only select own units, can only attack enemy units, allies share vision. `PlayerMask` bit operations significantly optimize performance in 8-player matches and other multi-player scenarios.

- [ ] **TODO-3.7.1** Create `src/OpenRA.Game/Player.ts`. Define `Player` class (NOT extending `TransformNode` -- Player is a non-scene entity). Store `playerName: string`, `faction: string`, `winState: WinState`, `playerMask: number`.
- [ ] **TODO-3.7.2** Implement `PlayerActor` pattern. Each `Player` instances creates a `GameActor` (the PlayerActor) owned by this player. Attach player-specific Traits (Shroud, FrozenActorLayer, etc.) to the PlayerActor.
- [ ] **TODO-3.7.3** Implement diplomacy relationships. `RelationshipWith(other: Player): PlayerRelationship` returns `Enemy`, `Neutral`, or `Ally`. Store relationship table as a `Map<Player, PlayerRelationship>` or compute from alliance data.
- [ ] **TODO-3.7.4** Implement `PlayerMask` bitmask system. Each player has a unique bit position. `PlayerMask` enables `isAlliedWith(mask: number): boolean` in O(1) via bitwise AND. Essential for 8-player multiplayer performance.
- [ ] **TODO-3.7.5** Implement `WinState` tracking. `WinState` enum: `Undefined`, `Won`, `Lost`. Transition management: once set to Won/Lost, cannot revert.
- [ ] **TODO-3.7.6** Implement resource tracking. `playerResources: Map<string, number>` for in-game resources (cash, power, etc.). `addResource(type: string, amount: number): void`, `getResource(type: string): number`. Emit `onResourceChanged` observable for UI updates.
- [ ] **TODO-3.7.7** Implement `Spectating` player flag. A player with no units/control, viewing the game passively. Spectating players have full map visibility (no Shroud).
- [ ] **TODO-3.7.8** Document the `IBot` interface placeholder. Bot/AI players are activated through the `IBot` Trait on the PlayerActor. AI logic migration (condition-action rule system) is deferred to a future chapter.

**Acceptance Criteria**:
- PlayerActor correctly owns all player-specific Traits
- `RelationshipWith()` returns correct values for ally, enemy, and neutral configurations
- `PlayerMask` bitmask correctly handles 8+ players with O(1) alliance checks
- Resource changes emit observable events for UI updates
- `WinState` transitions are immutable (Won/Lost cannot revert)

**Estimated Effort**: ~400 lines implementation + ~300 lines test

---

### 3.8 Supporting Trait Files

**Status**: Pending migration (can begin after 3.3 is complete)
**Complexity**: Low-Medium (varies by file)
**Dependencies**: TODO-3.3.x (TraitsInterfaces, Component base class)

These files implement concrete Traits and utility types that the core system depends on for full functionality.

- [ ] **TODO-3.8.1** `src/OpenRA.Game/Activities/CallFunc.ts` -- Simple callback wrapper activity. Encapsulates a `() => void` function; `tick()` calls the function and returns `true` immediately. Used for one-shot actions in activity chains. (~60 lines)
- [ ] **TODO-3.8.2** `src/OpenRA.Game/Traits/Target.ts` -- `Target` data class representing an attack/move target. Either a position (`WPos`) or an actor reference (`GameActor`). Methods: `isValid`, `centerPosition`, `actor`. (~80 lines)
- [ ] **TODO-3.8.3** `src/OpenRA.Game/GameRules/Ruleset.ts` -- `RulesetConfig` container for all game rules data: map of `ActorConfig`s, map of `WeaponConfig`s, `MusicInfo`, `SoundInfo`. Factory from a parsed mod directory. (~200 lines)
- [ ] **TODO-3.8.4** `src/OpenRA.Game/Traits/World/ScreenMap.ts` -- `ScreenMapComponent` implementing screen-space spatial queries. Maps screen coordinates to visible actors for hit-testing. In 3D, partially replaced by `scene.pick()` raycasting but retained for 2D UI cell selection. (~250 lines)
- [ ] **TODO-3.8.5** `src/OpenRA.Game/Traits/Player/Shroud.ts` -- `ShroudComponent` implementing fog of war. Tracks explored/visible/hidden cells for each player. Uses a grid of visibility states updated each tick based on owned units' vision range. (~300 lines)
- [ ] **TODO-3.8.6** `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` -- `FrozenActorComponent` implementing frozen actor rendering. When enemy units leave vision, they are frozen at their last known position (grayed out rendering). (~250 lines)
- [ ] **TODO-3.8.7** `src/OpenRA.Game/Orders/IOrderGenerator.ts` -- `IOrderGenerator` interface for order generation (e.g., command bar buttons). Provides `orders: Order[]` that the player can issue to selected units. (~50 lines)

**Acceptance Criteria**:
- Each supporting file follows the file header convention (OpenRA reference + paradigm mapping notes)
- `ScreenMap` correctly maps screen positions to actors for click hit-testing
- `Shroud` correctly updates visibility per tick based on unit vision
- `FrozenActorLayer` correctly renders frozen actors at last known positions
- `Ruleset` correctly aggregates all game rules from a mod directory

**Estimated Effort**: ~1,200 lines implementation + ~800 lines test (collectively)

---

## 4. Trait Interface Mapping Table

From Architecture Analysis Table 4-2 (lines 553-567). Complete mapping of OpenRA Trait interfaces to Babylon.js equivalents.

| # | OpenRA Interface | Method Signature | Trigger / Purpose | Babylon.js Equivalent |
|:---:|:---|:---|:---|:---|
| 1 | `ITick` | `Tick(Actor self)` | Every game Tick, drives logic updates | Custom `ITick` + `GameWorldManager` batch call |
| 2 | `ITickRender` | `TickRender(WorldRenderer, Actor)` | Every render frame, drives visual interpolation | `scene.onBeforeRenderObservable` callback |
| 3 | `INotifyCreated` | `Created(Actor self)` | Actor initialization complete | Called in `GameActor.initialize()` |
| 4 | `INotifyAddedToWorld` | `AddedToWorld(Actor self)` | Actor added to world | Triggered in `GameWorldManager.addActor()` |
| 5 | `INotifyRemovedFromWorld` | `RemovedFromWorld(Actor self)` | Actor removed from world | Triggered in `GameWorldManager.removeActor()` |
| 6 | `INotifyActorDisposing` | `Disposing(Actor self)` | Actor about to be destroyed | Called in `GameActor.dispose()` |
| 7 | `INotifyKilled` | `Killed(Actor self, AttackInfo e)` | Actor killed | Triggered in `HealthComponent` death event |
| 8 | `IResolveOrder` | `ResolveOrder(Actor self, Order order)` | Process player commands | Custom `OrderSystem` dispatches commands |
| 9 | `IIssueOrder` | `get orders(): Order[]` | Provide available commands (command bar) | `OrderProvider` component with command list |
| 10 | `IRender` | `Render(Actor, WorldRenderer)` | Collect renderables | `RenderMeshComponent` + Babylon scene graph |
| 11 | `IObservesVariables` | `GetVariableObservers()` | Subscribe to condition changes | `ConditionManager.registerObserver()` |
| 12 | `Requires<T>` | Interface marker | Trait dependency declaration | Build-time JSON Schema validation + topological sort |
| 13 | `NotBefore<T>` | Interface marker | Trait ordering constraint | Build-time JSON Schema validation + topological sort |
| 14 | `IHealth` | `HP`, `MaxHP`, `isDead` | Health/damage management | `HealthComponent` |
| 15 | `IFacing` | `Facing` (WAngle), `TurnSpeed` | Unit facing direction | `FacingComponent` + `TransformNode.rotation.y` |
| 16 | `IOccupySpace` | `OccupiedCells`, `centerPosition` | Spatial occupancy | `SpatialComponent` + TransformNode.position |
| 17 | `ITargetable` | `targetablePositions` | Targetable positions | `TargetableComponent` |

**Note**: Interfaces 14-17 (`IHealth`, `IFacing`, `IOccupySpace`, `ITargetable`) are referenced in `OpenRA.Mods.Common/Traits/` (mod code) rather than `OpenRA.Game/Traits/TraitsInterfaces.cs`. They are included here for completeness since they form the foundation of game logic interaction. Their definitions should be in `TraitsInterfaces.ts` but their concrete implementations belong to future mod system migration.

---

## 5. Dependency Graph

### 5.1 External Dependencies (Chapter 2)

```
Chapter 3 depends on:
├── TODO-2.1.x (Renderer.ts) -- Engine.runRenderLoop(), canvas, WebGL context
├── TODO-2.2.x (WorldRenderer.ts) -- BABYLON.Scene, renderingGroupId, camera
├── TODO-2.5.x (Shader system) -- ShaderMaterial for custom rendering Traits
├── TODO-2.7.x (Sprite & Texture) -- For rendering actor visuals
└── TODO-2.8.x (Platform abstraction) -- Browser APIs, engine setup
```

### 5.2 Internal Dependencies (Chapter 3)

```
                    ┌─────────────────────┐
                    │  TraitsInterfaces.ts │  (Foundation layer -- no deps)
                    │  TODO-3.3.1-3.3.5   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
   ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐
   │ TraitDictionary.ts│  │ ActorInfo.ts │  │ WeaponInfo.ts │
   │ TODO-3.3.6-3.3.11 │  │ TODO-3.4.x   │  │ TODO-3.6.x    │
   └────────┬─────────┘  └──────┬───────┘  └───────┬───────┘
            │                   │                   │
            └──────────┬────────┘                   │
                       ▼                            │
              ┌──────────────────┐                  │
              │    Actor.ts      │◄─────────────────┘
              │  TODO-3.2.x      │
              └────────┬─────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ World.ts │  │Player.ts │  │Activity.ts│
  │TODO-3.1.x│  │TODO-3.7.x│  │TODO-3.5.x │
  └──────────┘  └──────────┘  └──────────┘
```

### 5.3 Detailed Dependency Matrix

| File | Depends On | Blocked By |
|------|-----------|------------|
| `TraitsInterfaces.ts` | None | — |
| `TraitDictionary.ts` | TraitsInterfaces | TODO-3.3.1 |
| `ActorInfo.ts` | TraitsInterfaces | TODO-3.3.1 |
| `WeaponInfo.ts` | None (data class) | — |
| `Actor.ts` | TraitsInterfaces, TraitDictionary, ActorInfo | TODO-3.3.x, TODO-3.4.x |
| `Activity.ts` | Actor | TODO-3.2.x |
| `World.ts` | Actor, TraitsInterfaces | TODO-3.2.x, TODO-3.3.x |
| `Player.ts` | Actor, TraitsInterfaces | TODO-3.2.x, TODO-3.3.x |
| `CallFunc.ts` | Activity | TODO-3.5.x |
| `Target.ts` | Actor | TODO-3.2.x |
| `Ruleset.ts` | ActorInfo, WeaponInfo | TODO-3.4.x, TODO-3.6.x |
| `ScreenMap.ts` | World | TODO-3.1.x |
| `Shroud.ts` | Player, Actor | TODO-3.7.x, TODO-3.2.x |
| `FrozenActorLayer.ts` | Player, Actor | TODO-3.7.x, TODO-3.2.x |

---

## 6. Babylon.js API Mapping Table

### 6.1 Core Type Mappings

| OpenRA (C#) | TypeScript / Babylon.js | Notes |
|-------------|------------------------|-------|
| `SortedDictionary<uint, Actor>` | `Map<number, GameActor>` | JavaScript `Map` preserves insertion order but not sort order; manually sort keys for iteration |
| `List<T>` | `Array<T>` | Direct mapping |
| `Queue<Action<World>>` | `Array<() => void>` | Use as queue with `shift()`; or `Deque` from collections library |
| `Dictionary<Type, T>` | `Map<string, T>` | Type keys become string keys (class names) |
| `event Action<Actor>` | `BABYLON.Observable<GameActor>` | Babylon.js Observable for lifecycle events |
| `IEnumerable<T>` | `Iterable<T>` or `Array<T>` | JS native iterable protocol |
| `static readonly` | `static readonly` | TypeScript supports class-level readonly |
| `struct Vertex` | `interface VertexData` or vertex arrays | Separated attributes (positions, uvs, colors) |
| `out` parameters | Return object or tuple | e.g., `{ success: boolean, value: T }` instead of `bool TryGet(out T)` |
| IDisposable pattern | `dispose(): void` method | No `using` statement; manual `try/finally` or `DisposableResource` wrapper |

### 6.2 Scene Graph Mappings

| OpenRA Concept | Babylon.js API | Notes |
|---------------|---------------|-------|
| Actor position (WPos) | `TransformNode.position` (Vector3) | 2D WPos -> 3D Vector3 (X,Y,0) with optional Z |
| Actor facing (WAngle) | `TransformNode.rotation.y` | WAngle (1024 units/full rotation) -> radians |
| Actor visibility | `TransformNode.setEnabled()` | Visibility controlled by enabling/disabling the node |
| Render trait attachment | `Behavior<T>` on TransformNode | RenderingTraits attach as Babylon Behaviors |
| Actor selection bounding box | `BoundingBox` + `scene.pick()` | Raycasting for 3D unit selection |
| Occlusion / Frustum culling | `mesh.alwaysSelectAsActiveMesh` | Auto-managed by Babylon.js |
| Depth sorting (Y-sort) | `renderingGroupId` + `transparentSortCompareFn` | Already implemented in WorldRenderer.ts |

### 6.3 Custom Systems (No Direct Babylon.js Equivalent)

| OpenRA System | Custom Implementation | Notes |
|--------------|----------------------|-------|
| Condition System | `ConditionManager` class | Token-based condition tracking, expression evaluation |
| Activity State Machine | `Activity` abstract class + `ActivityRunner` | Linked list activity chains with child priority |
| Trait Query System | `Map<string, Component[]>` + Type guards | Replaces C# generic/reflection lookup |
| Spatial Queries (IActorMap) | `SpatialGrid` or `Octree` | 3D spatial partitioning for range queries |
| Player diplomacy bitmask | `PlayerMask` number + bitwise ops | Efficient alliance checks for multiplayer |
| Order dispatch | `OrderSystem` class | Routes player commands to IResolveOrder components |

---

## 7. Migration Strategy and Phasing

### 7.1 Recommended Phase Order

Given the deep dependency chain (TraitsInterfaces -> TraitDictionary/ActorInfo -> Actor -> World/Player/Activity), a strict phase-based approach prevents circular dependency issues.

| Phase | Files | Rationale | Est. Days |
|-------|-------|-----------|:---------:|
| **Phase 3A: Foundation** | TraitsInterfaces.ts, TraitDictionary.ts | Must exist first -- all components depend on the interface definitions and storage system | 2-3 |
| **Phase 3B: Data Models** | ActorInfo.ts, WeaponInfo.ts, Ruleset.ts | Configuration parsing and validation -- can be tested independently with JSON fixtures | 2-3 |
| **Phase 3C: Core Actor** | Actor.ts, Target.ts, Player.ts | Actor with Condition system, PlayerActor pattern -- game entities come to life | 3-4 |
| **Phase 3D: World** | World.ts, ScreenMap.ts | Game world container with fixed timestep loop -- actors now have a world to live in | 2-3 |
| **Phase 3E: Activity** | Activity.ts, CallFunc.ts | Behavior state machines -- actors can now do things | 2-3 |
| **Phase 3F: Game Traits** | Shroud.ts, FrozenActorLayer.ts, IOrderGenerator.ts | Concrete player/world Traits -- game-specific functionality | 2-3 |

**Total estimated effort**: 13-19 developer-days for core implementation

### 7.2 Parallelization Opportunities

- Phase 3A (TraitsInterfaces) and Phase 3B data models (WeaponInfo) can be developed in parallel since WeaponInfo is a pure data class with no Trait dependencies
- Phase 3C (Actor) and Phase 3B (ActorInfo) can begin once Phase 3A is complete
- Phase 3D (World) and Phase 3E (Activity) depend on Actor but can be developed in parallel with each other
- Phase 3F supporting Traits are mostly independent of each other and can be parallelized

### 7.3 Items Deferred Beyond Chapter 3

| Item | Reason | Target Chapter |
|------|--------|----------------|
| Concrete `IProjectile` implementations (Bullet, Missile, GravityBomb, Laser) | Mod code in `OpenRA.Mods.Common/` | Chapter 8 (Mod System) |
| Concrete `IWarhead` implementations (SpreadDamage, TargetDamage, etc.) | Mod code in `OpenRA.Mods.Common/` | Chapter 8 (Mod System) |
| `Armament` Trait (weapon launcher) | Mod code; depends on weapon system + actor system | Chapter 8 (Mod System) |
| All concrete Traits beyond Shroud/FrozenActorLayer | Hundreds of Trait files in `OpenRA.Mods.Common/Traits/` | Chapter 8 (Mod System) |
| AI/Bot system | `IBot` Trait, condition-action rules | Chapter 10+ (AI) |
| Full YAML runtime parser | Build-time JSON compilation is recommended | Post-migration optimization |
| `SyncHash` network validation | Requires complete trait set for meaningful hash | Chapter 5 (Networking) |
| Promise-based Activity (Plan B) | UI animation use cases | Phase 3E or later |

### 7.4 Immediate Next Steps (Ready to Start)

1. **Create directory structure**: Ensure `src/OpenRA.Game/Traits/`, `src/OpenRA.Game/Traits/Player/`, `src/OpenRA.Game/Traits/World/`, `src/OpenRA.Game/Activities/`, `src/OpenRA.Game/GameRules/`, `src/OpenRA.Game/Orders/` directories exist
2. **Begin Phase 3A**: Start with `TraitsInterfaces.ts` (no dependencies, unblocks everything else)
3. **Coordinate with Chapter 2**: Ensure `WorldRenderer.ts` and `Renderer.ts` APIs are stable enough for Chapter 3 to build upon

---

## 8. Acceptance Criteria

### 8.1 Per-File Criteria

Each migrated file must satisfy:

- [ ] **AC-3.1 File Header**: Contains OpenRA file reference, paradigm mapping notes, and architecture context
- [ ] **AC-3.2 Feature Completeness**: All public APIs from OpenRA source are implemented (adaptations documented)
- [ ] **AC-3.3 Unit Tests**: >= 80% branch coverage, all public methods tested, edge cases covered
- [ ] **AC-3.4 Performance**: Hot-path methods (Tick, TraitsImplementing) benchmark under stated thresholds
- [ ] **AC-3.5 No Per-Frame Allocation**: Reusable object pools for frequently created types (Target, Order)
- [ ] **AC-3.6 Dispose Pattern**: All classes holding resources (observers, Babylon objects) implement `dispose()`
- [ ] **AC-3.7 Code Review Passed**: Reviewed independently by `migration-review` agent

### 8.2 Integration Acceptance Criteria

- [ ] **IAC-3.1** Fixed timestep loop: create a World with 100 actors, run 250 ticks (10 seconds at 25 TPS), verify exactly 250 ticks executed
- [ ] **IAC-3.2** Deterministic iteration: create actors with specific ActorIDs, verify every Tick iterates them in sorted order
- [ ] **IAC-3.3** Condition system: grant 3 conditions, revoke 1, verify 2 still active; revoke remaining 2, verify all conditions cleared
- [ ] **IAC-3.4** Activity chain: `Move -> Attack -> Wait` executes in sequence, each activity ticks correctly
- [ ] **IAC-3.5** Player diplomacy: setup 3 players (ally, enemy, neutral), verify correct relationship returns
- [ ] **IAC-3.6** Lifecycle: create actor -> add to world -> remove from world -> dispose, verify all INotify* hooks fire in correct order
- [ ] **IAC-3.7** Trait lookup: Actor with 20 components, `traitsImplementing(isITick)` correctly returns all ITick components
- [ ] **IAC-3.8** Frame-end actions: queue 5 actions, verify they execute after all ITick traits complete and before next Tick
- [ ] **IAC-3.9** Performance: World with 1000 actors, 10 Traits each, Tick loop completes in under 10ms
- [ ] **IAC-3.10** Memory: create and dispose 10000 actors, verify no memory leak (weak reference tracking)

---

## 9. Risk and Mitigation

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Trait system complexity explosion** | High | Too many interfaces, type guards become unmaintainable | Use code generation for type guard functions from interface definitions |
| **Determinism drift** | High | JS floating-point differences break network sync | Fixed-point math with deterministic PRNG; lookup tables for trig |
| **Activity state machine bugs** | High | Stuck actors (infinite Activity loops) | Timeout watchdog per Activity; max Tick depth guard |
| **Condition system race conditions** | Medium | Conditions not properly revoked, Traits stuck enabled/disabled | Strict token counting; unit test every condition transition path |
| **Performance: 25 TPS loop load** | Medium | 1000+ actors with 10+ Traits each may exceed tick budget | Batch update patterns; spatial partitioning; lazy trait evaluation |
| **TS generics vs C# generics gap** | Medium | Cannot replicate `Trait<T>()` compiler-enforced type safety | Runtime type assertions + comprehensive unit tests for type safety |
| **Variable timestep instability** | Low | requestAnimationFrame timing jitter causes inconsistent ticks | Accumulator cap (max 5 ticks/frame); fixed delta per tick |
| **Babylon.js Observable overhead** | Low | Too many Observables for lifecycle events impact GC | Use simple callback arrays for hot-path lifecycle events |
| **JSON Schema drift from YAML** | Low | YAML source of truth, JSON compiled output may diverge | Automated build step: YAML -> JSON during Vite build |

---

## Appendix A: Directory Structure Checklist

The following directories must exist in `src/` before Chapter 3 migration begins:

```
src/OpenRA.Game/
├── Traits/
│   ├── TraitsInterfaces.ts      (TODO-3.3.1-3.3.5)
│   ├── Target.ts                (TODO-3.8.2)
│   ├── Player/
│   │   ├── Shroud.ts            (TODO-3.8.5)
│   │   └── FrozenActorLayer.ts  (TODO-3.8.6)
│   └── World/
│       └── ScreenMap.ts         (TODO-3.8.4)
├── Activities/
│   ├── Activity.ts              (TODO-3.5.1-3.5.6)
│   └── CallFunc.ts              (TODO-3.8.1)
├── GameRules/
│   ├── ActorInfo.ts             (TODO-3.4.x)
│   ├── WeaponInfo.ts            (TODO-3.6.x)
│   └── Ruleset.ts               (TODO-3.8.3)
├── Orders/
│   └── IOrderGenerator.ts       (TODO-3.8.7)
├── TraitDictionary.ts           (TODO-3.3.6-3.3.11)
├── Actor.ts                     (TODO-3.2.x)
├── World.ts                     (TODO-3.1.x)
└── Player.ts                    (TODO-3.7.x)
```

---

## Appendix B: Key Architecture Decisions (ADRs to be finalized)

| # | Decision | Options | Status |
|:---:|:---|:---|:---:|
| ADR-3.1 | Activity migration approach | A: Class-based (deterministic) vs B: Promise-based (async) | **Recommended: Plan A** for core, Plan B for UI |
| ADR-3.2 | Trait storage data structure | `Map<string, Component[]>` vs `Array<Component>` with filter | **Recommended: Map** for O(1) by-name lookup |
| ADR-3.3 | Spatial partitioning for 3D | Octree vs Uniform Grid vs Babylon.js built-in Octree | **TBD** -- depends on terrain system |
| ADR-3.4 | Condition expression evaluator | Custom parser vs `eval()` (unsafe) | **Recommended: Custom parser** for safety |
| ADR-3.5 | YAML runtime vs build-time JSON | Runtime YAML parser vs Vite plugin pre-compilation | **Recommended: Build-time** for performance |
| ADR-3.6 | Component lifecycle hooks | attach/detach vs Babylon Behavior pattern | **Recommended: attach/detach** for simplicity and control |

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths. If ambiguities in understanding the OpenRA source code arise, document notes in the migration plan instead of modifying the original files.

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4 (lines 458-623) -- Full architecture analysis
> - `docs/rendering_migration_plan.md` -- Chapter 2 migration plan (format reference)
> - `docs/migration_progress.md` -- Current project progress tracking
> - `CLAUDE.md` -- Project overview and conventions
