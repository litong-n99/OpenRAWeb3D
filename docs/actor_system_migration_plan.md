# OpenRA to Babylon.js Migration Plan: Chapter 3 -- Game World and Actor System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4 (lines 458-623)
> **Chapter Status**: Chapter 3 -- Implementation Phase (35/36 migrated, 27/31 in-scope)
> **Planning Date**: 2026-06-04
> **Prerequisite**: Chapter 2 (Rendering Engine) -- COMPLETE (27/27, 100%)
> **Overall Complexity**: HIGH (the architecture doc states this is "the most challenging part of the entire project")
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Coordinate System and Primitives (Foundation)](#31-phase-a-coordinate-system-and-primitives)
   - 3.2 [Phase B: Trait System Core](#32-phase-b-trait-system-core)
   - 3.3 [Phase C: World.cs -- Game World Container](#33-phase-c-worldcs----game-world-container)
   - 3.4 [Phase D: Actor.cs -- Game Object](#34-phase-d-actorcs----game-object)
   - 3.5 [Phase E: ActorInfo.cs -- Actor Metadata](#35-phase-e-actorinfocs----actor-metadata)
   - 3.6 [Phase F: Activity.cs -- Behavior State Machine](#36-phase-f-activitycs----behavior-state-machine)
   - 3.7 [Phase G: Player.cs -- Player Management](#37-phase-g-playercs----player-management)
   - 3.8 [Phase H: Effects System](#38-phase-h-effects-system)
   - 3.9 [Phase I: Spatial Query (ScreenMap)](#39-phase-i-spatial-query-screenmap)
   - 3.10 [Phase J: Weapon System (Deferrable)](#310-phase-j-weapon-system-deferrable)
   - 3.11 [Support Files](#311-support-files)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Game World and Actor system is the **most architecturally challenging** phase of the entire project. The core paradigm shift: **from C# interface-driven trait composition to TypeScript Component system + Babylon.js Behaviors**.

OpenRA uses a unique **Actor-Trait-Activity** three-layer design, which is a variant of the Entity-Component-System (ECS) pattern. Unlike traditional ECS, OpenRA's Trait system is closer to the Composition Pattern, emphasizing "composition over inheritance" -- a tank unit does not inherit from "UnitBase," but rather dynamically combines `Mobile`, `Health`, `Armor`, `Armament` and other Traits at runtime through YAML configuration.

### 1.2 Five Core Architectural Principles

1. **Composition over inheritance**: Trait system via Component map, not deep class hierarchy
2. **Deterministic tick separation**: 25 TPS logic (fixed timestep) vs 60 FPS render (requestAnimationFrame)
3. **Data-driven configuration**: YAML/JSON config files define actor composition, not hardcoded classes
4. **PlayerActor pattern**: Player capabilities implemented as traits on a special actor
5. **Activity chaining**: Behavior composition via linked list of activities

### 1.3 Architecture Diagram Reference

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

### 1.4 OpenRA Multi-Layer Coordinate System

OpenRA uses a sophisticated multi-layer coordinate system that must be migrated BEFORE any actor or world code. Three coordinate spaces exist:

- **MPos** (Map position): Integer grid coordinates with sub-cell precision for mobile units. `U, V` pair.
- **CPos** (Cell position): Integer cell coordinates clamped to map bounds. `X, Y, Layer`.
- **WPos** (World position): High-precision 3D world coordinates. Uses 1024 sub-units per cell. `X, Y, Z`.

Conversion chain: `CPos` -> `MPos` -> `WPos`. All game logic uses `WPos`; map and pathfinding use `CPos`; mobile unit positions use `MPos` sub-cells.

### 1.5 Critical Coordinate Design Decision

**Keep OpenRA coordinate system internally, convert to Babylon meters only at render time** via a `CoordinateTransformer` utility.

- **Rationale**: OpenRA's 1024 sub-units/cell is the foundation of game balance and network determinism. Converting to meters would introduce floating-point drift. The render boundary is the only place where coordinate system conversion is needed.
- **Implementation**: `CoordinateTransformer.cellToWorld(cpos: CPos): Vector3` converts game coordinates to Babylon.js world space at the rendering layer.

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (36 files across 10 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Coordinate System & Primitives (Foundation)** | | | | | |
| 1 | `OpenRA.Game/MPos.cs` | `src/OpenRA.Game/MPos.ts` | `MPos` | 94 | Low | A |
| 2 | `OpenRA.Game/CPos.cs` | `src/OpenRA.Game/CPos.ts` | `CPos` | 148 | Low | A |
| 3 | `OpenRA.Game/CVec.cs` | `src/OpenRA.Game/CVec.ts` | `CVec` | 147 | Low | A |
| 4 | `OpenRA.Game/WPos.cs` | `src/OpenRA.Game/WPos.ts` | `WPos` | 169 | Low | A |
| 5 | `OpenRA.Game/WVec.cs` | `src/OpenRA.Game/WVec.ts` | `WVec` | 183 | Low | A |
| 6 | `OpenRA.Game/WAngle.cs` | `src/OpenRA.Game/WAngle.ts` | `WAngle` | 279 | Medium | A |
| 7 | `OpenRA.Game/WDist.cs` | `src/OpenRA.Game/WDist.ts` | `WDist` | 194 | Low | A |
| 8 | `OpenRA.Game/WRot.cs` | `src/OpenRA.Game/WRot.ts` | `WRot` | 222 | Medium | A |
| 9 | `OpenRA.Game/Primitives/BitSet.cs` | `src/OpenRA.Game/Primitives/BitSet.ts` | `BitSet` | 171 | Low | A |
| 10 | `OpenRA.Game/Primitives/LongBitSet.cs` | `src/OpenRA.Game/Primitives/LongBitSet.ts` | `LongBitSet` | 189 | Medium | A |
| 11 | `OpenRA.Game/Primitives/TypeDictionary.cs` | `src/OpenRA.Game/Primitives/TypeDictionary.ts` | `TypeDictionary` | 183 | Medium | A |
| 12 | `OpenRA.Game/Primitives/SpatiallyPartitioned.cs` | `src/OpenRA.Game/Primitives/SpatiallyPartitioned.ts` | `SpatiallyPartitioned` | 169 | Medium | A |
| 13 | `OpenRA.Game/Primitives/PriorityQueue.cs` | `src/OpenRA.Game/Primitives/PriorityQueue.ts` | `PriorityQueue` | 159 | Low | A |
| 14 | `OpenRA.Game/Primitives/Cache.cs` | `src/OpenRA.Game/Primitives/Cache.ts` | `Cache` | 50 | Low | A |
| 15 | `OpenRA.Game/Primitives/CachedTransform.cs` | `src/OpenRA.Game/Primitives/CachedTransform.ts` | `CachedTransform` | 41 | Low | A |
| 16 | `OpenRA.Game/Primitives/ActionQueue.cs` | `src/OpenRA.Game/Primitives/ActionQueue.ts` | `ActionQueue` | 93 | Low | A |
| 17 | `OpenRA.Game/Traits/Target.cs` | `src/OpenRA.Game/Traits/Target.ts` | `Target` | 295 | Medium | A |

| **Phase B: Trait System Core** | | | | | |
| 18 | `OpenRA.Game/TraitDictionary.cs` | `src/OpenRA.Game/TraitDictionary.ts` | `TraitDictionary` | 329 | Medium | B |
| 19 | `OpenRA.Game/Traits/TraitsInterfaces.cs` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | `ITick`, `INotifyCreated`, `IResolveOrder`, etc. | 664 | Medium | B |

| **Phase C-D: World + Actor (Core Containers)** | | | | | |
| 20 | `OpenRA.Game/World.cs` | `src/OpenRA.Game/World.ts` | `World` -> `BABYLON.Scene` + `GameWorldManager` | 650 | HIGH | C |
| 21 | `OpenRA.Game/Actor.cs` | `src/OpenRA.Game/Actor.ts` | `Actor` -> `GameActor extends TransformNode` | 650 | HIGH | D |

| **Phase E: Actor Metadata** | | | | | |
| 22 | `OpenRA.Game/GameRules/ActorInfo.cs` | `src/OpenRA.Game/GameRules/ActorInfo.ts` | `ActorInfo` | 201 | Medium | E |

| **Phase F: Activity System** | | | | | |
| 23 | `OpenRA.Game/Activities/Activity.cs` | `src/OpenRA.Game/Activities/Activity.ts` | `Activity` | 296 | HIGH | F |
| 24 | `OpenRA.Game/Activities/CallFunc.cs` | `src/OpenRA.Game/Activities/CallFunc.ts` | `CallFunc` | 39 | Low | F |

| **Phase G: Player System** | | | | | |
| 25 | `OpenRA.Game/Player.cs` | `src/OpenRA.Game/Player.ts` | `Player` | 337 | Low | G |

| **Phase H: Effects System** | | | | | |
| 26 | `OpenRA.Game/Effects/IEffect.cs` | `src/OpenRA.Game/Effects/IEffect.ts` | `IEffect` | 28 | Low | H |
| 27 | `OpenRA.Game/Effects/DelayedAction.cs` | `src/OpenRA.Game/Effects/DelayedAction.ts` | `DelayedAction` | 37 | Low | H |
| 28 | `OpenRA.Game/Effects/DelayedImpact.cs` | `src/OpenRA.Game/Effects/DelayedImpact.ts` | `DelayedImpact` | 43 | Low | H |

| **Phase I: Spatial Query** | | | | | |
| 29 | `OpenRA.Game/Traits/World/ScreenMap.cs` | `src/OpenRA.Game/Traits/World/ScreenMap.ts` | `ScreenMap` | 287 | Medium | I |

| **Phase J: Weapon System (Deferrable)** | | | | | |
| 30 | `OpenRA.Game/GameRules/WeaponInfo.cs` | `src/OpenRA.Game/GameRules/WeaponInfo.ts` | `WeaponInfo` | 268 | Medium | J |
| 31 | `OpenRA.Game/GameRules/Ruleset.cs` | `src/OpenRA.Game/GameRules/Ruleset.ts` | `Ruleset` | 281 | Low | J |

| **Support Files (Migrate as Needed)** | | | | | |
| S1 | `OpenRA.Game/Sync.cs` | `src/OpenRA.Game/Sync.ts` | `Sync` | 212 | Low | Support |
| S2 | `OpenRA.Game/Exts.cs` | `src/OpenRA.Game/Exts.ts` | Extensions | 680 | Low | Support |
| S3 | `OpenRA.Game/WorldUtils.cs` | `src/OpenRA.Game/WorldUtils.ts` | `WorldUtils` | 112 | Low | Support |
| S4 | `OpenRA.Game/GameSpeed.cs` | `src/OpenRA.Game/GameSpeed.ts` | `GameSpeed` | 62 | Low | Support |
| S5 | `OpenRA.Game/Traits/ActivityUtils.cs` | `src/OpenRA.Game/Traits/ActivityUtils.ts` | `ActivityUtils` | 39 | Low | Support |

> **Complexity Legend**:
> - **LOW**: Data structures with no external dependencies beyond primitives. 50-200 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Some dependency on Phase A/B types. 200-500 lines of C# with moderate Babylon.js integration.
> - **HIGH**: Complex architecture requiring careful design. 500-1000+ lines of C# with significant Babylon.js integration and multiple dependencies.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 36 (31 in-scope + 5 support) |
| **Phase A (foundation)** | 17 files |
| **Phases B-J (core system)** | 14 files |
| **Support files** | 5 files |
| **Deferrable (Phase J)** | 2 files |
| **HIGH complexity** | 3 files (World, Actor, Activity) |
| **MEDIUM complexity** | 10 files |
| **LOW complexity** | 23 files |
| **Total C# source lines** | ~6,800 |
| **Total planned TODO items** | ~70 |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Coordinate System and Primitives

**Status**: ✅ Completed (17/17) -- 2026-06-04
**Complexity**: Low-Medium
**Blocked by**: Nothing (foundation layer, no internal deps)
**Blocks**: Everything else in Chapter 3 (Phase B ready to start)

**Description**: OpenRA uses a sophisticated multi-layer coordinate system. Three coordinate spaces exist: **MPos** (Map position -- integer grid with sub-cell), **CPos** (Cell position -- clamped to map bounds), and **WPos** (World position -- high-precision 3D with 1024 units/cell). These must be migrated BEFORE any actor or world code, along with the primitive data structures they depend on.

**Critical Design Decision**: Keep OpenRA coordinate system internally (1024 sub-units/cell), convert to Babylon meters only at render time via a `CoordinateTransformer` utility. This preserves game balance and network determinism while enabling 3D rendering.

**Paradigm Shifts**:
- C# struct (value type, stack-allocated) -> TypeScript class (reference type) -- Watch for per-frame allocation in hot paths
- C# operator overloading -> TypeScript static methods -- `WPos.add(a, b)`, not `a + b`
- C# `readonly struct` immutability -> TypeScript `readonly` fields + defensive copy where needed
- WAngle uses 0-1024 range for full circle -> Convert to radians at render boundary

#### 3.1.1 World Coordinate Types

- [x] **TODO-3.A.1** `src/OpenRA.Game/WPos.ts` ✅ — 3D world position with high precision (1024 sub-units/cell). `WPos.add(WVec): WPos`, `WPos.subtract(WPos): WVec`, `Lerp()`, equality operators as static methods. **(180 lines TS + 24 tests)**
- [x] **TODO-3.A.2** `src/OpenRA.Game/WVec.ts` ✅ — 3D world vector. `dot(WVec): number`, `cross(WVec): WVec`, `length: number`, `flatLength` (2D magnitude), `normalize()`, `rotate(WRot): WVec`. **(230 lines TS + 35 tests)**
- [x] **TODO-3.A.3** `src/OpenRA.Game/WAngle.ts` ✅ — World angle (0-1024 = full circle, 256 = 90 degrees). Converts to radians at render boundary. `sin()/cos()/tan()` via lookup table for deterministic cross-browser behavior. `arcsin()/arccos()/arctan2()`. **(270 lines TS + 54 tests)**
- [x] **TODO-3.A.4** `src/OpenRA.Game/WDist.ts` ✅ — World distance with ranged comparison. `length: number`, `compareTo(WDist)`, arithmetic with `WDist`. **(170 lines TS + 32 tests)**
- [x] **TODO-3.A.5** `src/OpenRA.Game/WRot.ts` ✅ — 3D rotation representation. Maps to `Int32Matrix4x4` internally. `WRot.add(WRot)`, `rotAsMatrix()`, `rotate(WVec): WVec`, `rotateInverse(WVec): WVec`. **(310 lines TS + 32 tests)**

#### 3.1.2 Map Coordinate Types

- [x] **TODO-3.A.6** `src/OpenRA.Game/MPos.ts` ✅ -- Map position (integer `U, V` grid coordinates with sub-cell). Implement `MPos <-> CPos` and `MPos <-> WPos` conversions. (94 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.7** `src/OpenRA.Game/CPos.ts` ✅ -- Cell position (`X, Y, Layer` -- integer cell coordinates, clamped to map bounds). Implement `CPos <-> MPos` and `CPos <-> WPos` conversions. Support 8-directional cell offsets for RTS movement. (148 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.8** `src/OpenRA.Game/CVec.ts` ✅ -- Cell vector (integer cell offsets). Direction constants for 8 cardinal/diagonal RTS movement directions (up, down, left, right, diagonals). (147 lines C#, migrated with full test coverage)

#### 3.1.3 Primitives

- [x] **TODO-3.A.9** `src/OpenRA.Game/Traits/Target.ts` ✅ -- Target abstraction representing "where/what to attack/move to." Supports `WPos` target, `Actor` target, and `Invalid` target types. Methods: `isValid`, `centerPosition`, `actor`. Used by Activity system extensively. (295 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.10** `src/OpenRA.Game/Primitives/BitSet.ts` ✅ -- Efficient bit-packed boolean set for conditions and flags. Implement bitwise AND/OR/XOR/NOT operations. Used by condition system and player masks. (171 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.11** `src/OpenRA.Game/Primitives/LongBitSet.ts` ✅ -- 64-bit bit set for PlayerMask (up to 64 players in multiplayer). Used extensively in diplomacy for O(1) relationship queries via bitwise AND. (189 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.12** `src/OpenRA.Game/Primitives/TypeDictionary.ts` ✅ -- Container storing objects keyed by type (for TraitInfo storage). Maps to `Map<string, unknown>` with typed accessors. Provides `get<T>(key): T`, `has(key): boolean`, `add(value)`. (183 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.13** `src/OpenRA.Game/Primitives/SpatiallyPartitioned.ts` ✅ -- Generic spatial partitioning structure. Used by ScreenMap for efficient spatial queries. Implement grid-based spatial hash with add/remove/query operations. (169 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.14** `src/OpenRA.Game/Primitives/PriorityQueue.ts` ✅ -- Min-heap priority queue implementation. Used in pathfinding and tick scheduling. `enqueue(item, priority)`, `dequeue(): T`, `peek(): T`. (159 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.15** `src/OpenRA.Game/Primitives/Cache.ts` + `CachedTransform.ts` ✅ -- Lazy-computed cached values with invalidation. `Cache<K, V>` with `get(key, factory)`. `CachedTransform<TIn, TOut>` for memoized transformations. (50 + 41 lines C#, migrated with full test coverage)
- [x] **TODO-3.A.16** `src/OpenRA.Game/Primitives/ActionQueue.ts` ✅ -- Deferred action queue for frame-end task execution. `add(action, delayTicks)`, `performActions()`. Used for safe actor disposal and delayed effects. (93 lines C#, migrated with full test coverage)

#### 3.1.4 Phase A Acceptance Criteria

- [x] **AC-3.A.1** `WPos <-> MPos <-> CPos` round-trip conversions are lossless (verify at extreme map coordinates)
- [x] **AC-3.A.2** `WAngle.sin()/cos()` lookup table results match across Chrome, Firefox, Safari (determinism test)
- [x] **AC-3.A.3** `LongBitSet` correctly handles 64 players with O(1) AND operation
- [x] **AC-3.A.4** `PriorityQueue` handles 10000 items with dequeue in O(log n)
- [x] **AC-3.A.5** 17 test files covering all coordinate types and primitives
- [x] **AC-3.A.6** No per-frame allocation of coordinate types in hot paths (use pooling)

**Estimated Effort**: ~2,500 lines implementation + ~1,800 lines test (2 developer-weeks)

---

### 3.2 Phase B: Trait System Core

**Status**: Completed (2/2)
**Complexity**: Medium
**Blocked by**: Phase A (coordinate primitives for Target references in interfaces)
**Blocks**: World.cs, Actor.cs, all Trait implementations

**Description**: The trait system is the architectural backbone of OpenRA. `TraitsInterfaces` defines all interface contracts organized into four categories (Update/Render, Lifecycle, Game Logic, Dependency). `TraitDictionary` provides the storage and query mechanism with O(n) linear scan lookup.

**Key Architecture Decision -- Interface-based query dispatch**: C# uses generic type-keyed binary search on sorted arrays (O(log n)). TypeScript uses linear scan with type guard functions (O(n)). Performance is acceptable because a single Actor typically has only 10-30 components.

```typescript
// Original C#: Actor.TraitsImplementing<ITick>()
// TypeScript equivalent using type guards:
function traitsImplementingITick(components: Component[]): ITick[] {
    return components.filter((c): c is ITick =>
        'tick' in c && typeof (c as any).tick === 'function'
    );
}
```

- [x] **TODO-3.B.1** `src/OpenRA.Game/Traits/TraitsInterfaces.ts` -- All TypeScript interfaces for the Trait system, organized into 4 categories:
  - **Update / Render**: `ITick { tick(actor: GameActor): void }`, `ITickRender { tickRender(wr: WorldRenderer, actor: GameActor): void }`
  - **Lifecycle Notifications**: `INotifyCreated { created(actor: GameActor): void }`, `INotifyAddedToWorld { addedToWorld(actor: GameActor): void }`, `INotifyRemovedFromWorld { removedFromWorld(actor: GameActor): void }`, `INotifyActorDisposing { disposing(actor: GameActor): void }`, `INotifyKilled { killed(actor: GameActor, attackInfo: AttackInfo): void }`
  - **Game Logic**: `IResolveOrder { resolveOrder(actor: GameActor, order: Order): void }`, `IIssueOrder`, `IHealth { hp, maxHp, isDead }`, `IFacing { facing: WAngle }`, `IOccupySpace { occupiedCells, centerPosition }`, `ITargetable`, `IMove`, `IAttack`, `ICrushable`, `ISelectable`, `IDisable`
  - **Dependency / State**: `Requires<T>`, `NotBefore<T>` (conceptual -- these become build-time schema validations), `IObservesVariables { getVariableObservers() }`, `IStance`
  - Provide type guard functions for each major interface: `isITick(obj)`, `isIResolveOrder(obj)`, `isINotifyCreated(obj)`, etc.
  - Define `Component` abstract base class: `attach(actor)`, `detach()`, `onEnabledChanged(enabled: boolean)`. All Traits extend this.
  - Define `BehaviorComponent` for rendering Traits: wraps `BABYLON.Behavior<T>` interface but integrates with Component lifecycle.

- [x] **TODO-3.B.2** `src/OpenRA.Game/TraitDictionary.ts` -- Trait storage and query system:
  - Internal storage: `Map<string, Component[]>` keyed by interface name
  - `addTrait(actor: GameActor, trait: Component): void` -- Register a trait, index by all implemented interfaces
  - `removeTrait(actor: GameActor, trait: Component): void` -- Unregister from all interface indexes
  - `traitsImplementing<T>(actor: GameActor, interfaceName: string): T[]` -- Linear O(n) scan using type guards (n = 10-30 per actor, acceptable)
  - `traitOrDefault<T>(actor: GameActor, interfaceName: string): T | undefined` -- Return first matching trait or undefined
  - `withTraitTimed<T>(world: GameWorldManager, interfaceName: string, fn: (actor, trait) => void): void` -- Bulk iteration with optional performance timing
  - `hasTrait(actor: GameActor, interfaceName: string): boolean` -- Check if trait exists
  - **Key tradeoff documented**: C# uses binary search on sorted array (O(log n)) via generic type key. TypeScript degrades to linear scan (O(n)). Acceptable because n never exceeds ~30 per actor.

**Acceptance Criteria**:
- All interfaces from architecture doc Table 4-2 (9 core + extensions) are defined and exported
- Type guard functions correctly identify each interface (test with mock objects implementing 0, 1, and multiple interfaces)
- `TraitDictionary.traitsImplementing()` correctly collects all matching components (test with 20 components, 5 implementing ITick)
- `withTraitTimed()` performance: 1000 actors with 20 traits each, traversal under 5ms
- 2 test files with ~80 test cases covering all interface types and dictionary operations

**Estimated Effort**: ~800 lines implementation + ~600 lines test (5-7 developer-days)

---

### 3.3 Phase C: World.cs -- Game World Container

**Status**: Completed (1/1) -- 2026-06-04
**Complexity**: HIGH
**Blocked by**: Phases A, B
**Blocks**: Phase D (Actor -- co-created with World)
**Implementation**: ~1903 lines TS + 66 tests | **Review**: 2 rounds, 0 BLOCKERs

**OpenRA Reference**: `OpenRA.Game/World.cs` (650 lines)
**Migration Target**: `src/OpenRA.Game/World.ts`
**Key Mapping**: `BABYLON.Scene` + `GameWorldManager`

**Description**: World is the root container for the entire game simulation. `World.Tick()` is the game's main heartbeat. Execution order is carefully designed: increment `WorldTick`, then execute `Activity.Tick()`, all `ITick` Traits, `IEffect.Tick()`. `TickRender()` is independent of logic Tick, calling `ITickRender` per render frame for visual interpolation.

- [x] **TODO-3.C.1** Create `GameWorldManager` class wrapping `BABYLON.Scene`:
  - `tickRate: number = 25` (25 TPS, 40ms timestep)
  - `worldTick: number` (incremented each logic tick)
  - `actors: Map<number, GameActor>` (sorted by ActorID for deterministic iteration)
  - `effects: IEffect[]` (visual effects list, ticked alongside actors)
  - `frameEndActions: Array<() => void>` (deferred tasks, executed at end of tick for safe disposal)
  - `players: Player[]`, `localPlayer: Player`, `renderPlayer: Player`

- [x] **TODO-3.C.2** Fixed timestep game loop:
  - Use `requestAnimationFrame` to drive the loop
  - Accumulate elapsed time; when >= 40ms, execute one logic tick and decrement accumulator
  - Low FPS catch-up: execute multiple ticks per frame if accumulator exceeds threshold
  - High FPS: skip ticks, render interpolation between ticks
  - Spiral-of-death protection: cap at maximum 5 ticks per frame
  - Call `ITickRender` every render frame (unaffected by tick timing)

- [x] **TODO-3.C.3** Tick execution order (must match OpenRA exactly):
  1. Increment `worldTick`
  2. Execute `Activity.tickOuter()` for all actors with active activities
  3. Execute `ITick.tick()` for all actors (via `TraitDictionary.withTraitTimed`)
  4. Execute `IEffect.tick()` for all active effects
  5. Process `frameEndActions` queue (dispose, spawn, deferred operations)
  6. Compute `SyncHash()` (placeholder for network sync validation -- deferred to networking chapter)

- [x] **TODO-3.C.4** Actor lifecycle management:
  - `addActor(actor: GameActor): void` -- Set `IsInWorld = true`, add to `actors` map, fire `INotifyAddedToWorld` on all traits
  - `removeActor(actor: GameActor): void` -- Set `IsInWorld = false`, fire `INotifyRemovedFromWorld`, defer actual disposal to frame end
  - Actor lookup: `getActorById(id: number): GameActor | undefined`

- [x] **TODO-3.C.5** Player management:
  - `setPlayers(players: Player[], localPlayer: Player): void` -- Set all players, create PlayerActors
  - `renderPlayer: Player` -- Whose perspective to render (shroud, camera, etc.)

- [x] **TODO-3.C.6** WorldActor -- Special actor holding global traits (map system, selection system, shroud). Attached as a child of `BABYLON.Scene`. Created automatically during world initialization.

- [x] **TODO-3.C.7** Pause state management:
  - `setPauseState(paused: boolean): void` -- Pause/unpause game ticks (rendering continues)
  - `predictedPaused: boolean` -- For replays: predict if game is paused

- [x] **TODO-3.C.8** `SyncHash()` -- Compute deterministic hash for network sync validation. Placeholder implementation in Chapter 3; full implementation deferred to networking chapter.

| Babylon.js API Mapping | |
|:---|:---|
| `World.Tick()` loop | Custom `GameWorldManager.fixedTick()` via `requestAnimationFrame` |
| `World.TickRender()` | `scene.onBeforeRenderObservable.add(callback)` |
| `World.frameEndActions` | Queue processed after all `ITick` traits, before next frame |
| `IActorMap` (spatial query) | Custom spatial hash (Phase I) |
| Actor rendering | Scene graph membership (TransformNode hierarchy via `scene.meshes`) |

**Acceptance Criteria**:
- Fixed timestep loop: create a World, run 250 ticks (10s game time at 25 TPS), verify exactly 250 ticks executed
- Tick execution order matches OpenRA: Activities before ITick before Effects before frameEndActions
- 1000 actors with 10 traits each tick in under 10ms
- Pause correctly prevents logic ticks but not render ticks
- Deterministic iteration order: actors processed in sorted ActorID order every frame

**Estimated Effort**: ~800 lines implementation + ~600 lines test (4-5 developer-days)

---

### 3.4 Phase D: Actor.cs -- Game Object

**Status**: Completed (1/1) -- 2026-06-04
**Complexity**: HIGH
**Blocked by**: Phases A, B, C (World for lifecycle integration)
**Blocks**: All Trait implementations, GameActor usage
**Implementation**: ~1840 lines TS + 91 tests | **Review**: 2 rounds, 0 BLOCKERs

**OpenRA Reference**: `OpenRA.Game/Actor.cs` (650 lines)
**Migration Target**: `src/OpenRA.Game/Actor.ts`
**Key Mapping**: `GameActor extends BABYLON.TransformNode`

**Description**: Actor is the universal game entity -- a "lightweight container" where all functionality comes from Trait composition. The Condition System is the core of dynamic behavior, using token-based grant/revoke with reference counting. `Actor.Tick()` drives the Activity system, while `Trait<T>()` and `TraitsImplementing<T>()` query components.

- [x] **TODO-3.D.1** `GameActor` class extending `BABYLON.TransformNode`:
  - `actorId: number` (uint32, globally unique)
  - `info: ActorConfig` (static metadata -- actor type definition)
  - `owner: Player` (owning player)
  - `world: GameWorldManager` (reference to containing world)
  - `isInWorld: boolean` (whether added to world)
  - `willDispose: boolean` / `disposed: boolean` (deferred destruction state)
  - `generation: number` (incremented on replacement, e.g., building upgrade -- network sync)

- [x] **TODO-3.D.2** Component system (replaces per-actor TraitDictionary):
  - `components: Map<string, Component>` -- Component storage keyed by class name
  - `getComponent<T>(name: string): T | undefined` -- Typed component lookup
  - `getComponentsImplementing<T>(interfaceName: string): T[]` -- Filter by interface using type guards
  - `addComponent(component: Component): void` / `removeComponent(component: Component): void`
  - Components call `attach(actor)` on registration and `detach()` on removal

- [x] **TODO-3.D.3** Condition system:
  - `grantCondition(condition: string): number` -- Returns unique integer token
  - `revokeCondition(token: number): void` -- Revoke specific token
  - `hasCondition(condition: string): boolean` -- Check if condition currently active
  - `conditionCache: Set<string>` -- Current active conditions
  - `conditionTokens: Map<number, string>` -- Token-to-condition mapping for revocation
  - **Key invariant**: Same condition can be granted multiple times (generating different tokens); condition is removed ONLY when ALL tokens are revoked (reference counting)
  - `registerObserver(observer: IObservesVariables): void` -- Notify observers on condition change
  - Support `RequiresCondition` expressions: `deployed`, `!deployed`, `deployed || upgraded`, `deployed && !disabled`

- [x] **TODO-3.D.4** Activity system integration:
  - `currentActivity: Activity | null` -- Currently executing activity
  - `queueActivity(next: Activity, interruptible?: boolean): void` -- Append to activity chain
  - `cancelActivity(): void` -- Cancel current activity with proper cleanup
  - `tickActivities(): void` -- Called by World during each logic tick

- [x] **TODO-3.D.5** Cached trait references (like OpenRA's fast-path properties):
  - `occupiesSpace: IOccupySpace | undefined` -- Fast cache for spatial queries
  - `targetables: ITargetable[]` -- Fast cache for targeting
  - `effectiveOwner: IEffectiveOwner | undefined` -- For mind-control / ownership changes
  - These are set during initialization for fast O(1) access in hot paths

- [x] **TODO-3.D.6** Lifecycle state machine:
  - States: `Created` -> `initialize()` -> `world.addActor()` -> `InWorld` -> `world.removeActor()` -> `NotInWorld` -> `dispose()` -> `Disposed`
  - `dispose(): void` -- Set `WillDispose = true`, defer to world's `frameEndActions`, fire `INotifyActorDisposing`
  - Lifecycle hooks fire in strict order: `INotifyCreated` -> `INotifyAddedToWorld` -> (game ticks) -> `INotifyRemovedFromWorld` -> `INotifyActorDisposing`

- [x] **TODO-3.D.7** `ResolveOrder(order: Order): void` -- Dispatch player commands to all `IResolveOrder` components. Iterates all components implementing `IResolveOrder` and calls `resolveOrder(self, order)`.

- [x] **TODO-3.D.8** `SyncHash()` -- Deterministic hash for this actor (used for network sync verification). Placeholder in Chapter 3.

**Key Architecture Decision**: `GameActor extends TransformNode` vs wrapping TransformNode
- **Decision**: Extend `TransformNode` directly (ADR-3.1)
- **Rationale**: Direct scene graph participation, built-in position/rotation/scale, automatic frustum culling, full Babylon.js API compatibility
- **Risk**: Tighter coupling to Babylon.js; `dispose()` must call both `super.dispose()` (Babylon) and component cleanup

**Acceptance Criteria**:
- `GameActor extends TransformNode` correctly participates in Babylon.js scene graph
- Condition tokens are correctly reference-counted: grant("deployed") twice = 2 tokens; revoke 1 token = still deployed; revoke both = condition removed
- Lifecycle state transitions are strictly enforced (cannot skip from Created to Disposed)
- `WillDispose` actors are never referenced by game logic after marking
- Owner changes trigger correct rendering (player color) and diplomacy updates
- 500 actors with condition changes per tick run in under 2ms

**Estimated Effort**: ~750 lines implementation + ~550 lines test (4-5 developer-days)

---

### 3.5 Phase E: ActorInfo.cs -- Actor Metadata

**Status**: Completed (1/1) -- 2026-06-04
**Complexity**: Medium
**Blocked by**: Phase A (primitives), Phase B (conceptual -- Trait interfaces)
**Blocks**: Actor construction (World.createActor() needs ActorConfig)
**Implementation**: ~916 lines TS + 64 tests | **Review**: 2 rounds, 0 BLOCKERs

**OpenRA Reference**: `OpenRA.Game/GameRules/ActorInfo.cs` (201 lines)
**Migration Target**: `src/OpenRA.Game/GameRules/ActorInfo.ts`

**Description**: Static metadata describing an actor type. Loaded from YAML/JSON at game start. Maps to `ActorConfig` class. Handles trait inheritance (child merges parent traits, child overrides parent), `-TraitName` removal syntax, and topological sort of `Requires<T>` dependencies.

- [x] **TODO-3.E.1** `ActorConfig` class:
  - `name: string` -- Actor type name (e.g., "E1", "HARV", "2TNK")
  - `traitInfos: Map<string, TraitConfig>` -- Trait configurations loaded from JSON
  - `isAbstract: boolean` -- Template-only types (names prefixed with `^`), not spawnable in-game
  - `inheritsFrom: string[]` -- Inheritance chain identifiers for trait composition

- [x] **TODO-3.E.2** Trait composition from JSON config:
  - Parse JSON representation of actor YAML (build-time compiled)
  - Apply inheritance: merge parent traits, child properties override parent
  - Handle `-TraitName` removal syntax (explicitly remove inherited traits)
  - Topological sort of `Requires<T>` / `NotBefore<T>` dependencies using Kahn's algorithm
  - Throw descriptive error on circular dependencies or missing requirements

- [x] **TODO-3.E.3** `TraitConfig` interface:
  - `name: string` -- Trait name
  - `properties: Record<string, unknown>` -- Raw configuration values (parsed from YAML/JSON)
  - Factory method design: `createTrait(config: TraitConfig): Component` (implementation deferred to concrete trait chapters)

- [x] **TODO-3.E.4** Build-time YAML-to-JSON compilation design:
  - Document the pipeline: YAML files -> build step (Vite plugin) -> JSON modules
  - `fromJSON(json: unknown): ActorConfig` factory method with JSON Schema validation
  - Validate required fields (`name`, `traits`), validate each `TraitConfig` structure
  - Actual `FieldLoader` / YAML parsing implementation deferred to build system chapter

- [x] **TODO-3.E.5** `ActorConfig` immutability: After construction from JSON, ActorConfig is frozen (no runtime modification). `Object.freeze()` applied to the config and all nested trait configs.

**Acceptance Criteria**:
- JSON Schema validation catches malformed actor configurations (missing name, invalid trait structure)
- Topological sort correctly orders traits with known dependency chains
- Circular dependencies throw a clear error message identifying the cycle
- Inheritance: child correctly merges parent traits with override semantics
- `-TraitName` removal syntax correctly excludes inherited traits

**Estimated Effort**: ~916 lines implementation + ~1049 lines test (64 tests, 2 review rounds, 0 BLOCKERs)

---

### 3.6 Phase F: Activity.cs -- Behavior State Machine

**Status**: Completed (2/2 + 1 support) -- 2026-06-04
**Complexity**: HIGH
**Blocked by**: Phase A (Target type), Phase D (Actor -- `GameActor` reference for `self`)
**Blocks**: Trait implementations that use Activities (Move, Attack, etc.)

**OpenRA Reference**: `OpenRA.Game/Activities/Activity.cs` (296 lines), `OpenRA.Game/Activities/CallFunc.cs` (39 lines), `OpenRA.Game/Traits/ActivityUtils.cs` (39 lines)
**Migration Target**: `src/OpenRA.Game/Activities/Activity.ts`, `src/OpenRA.Game/Activities/CallFunc.ts`, `src/OpenRA.Game/Traits/ActivityUtils.ts`
**Key Mapping**: Custom `Activity` abstract class with linked-list chain + child activity priority

**Description**: Behavior state machine using linked-list + child activity two-layer structure. `Activity` is an abstract base class; subclasses implement `tick(actor)` returning `true` to indicate completion. This is one of the most architecturally significant parts of the migration. ActivityUtils.ts (support file S5) was migrated alongside as a dependency.

**Implementation**: Activity.ts (~722 lines + 849 test, 50 tests), CallFunc.ts (~90 lines + 202 test, 15 tests), ActivityUtils.ts (~87 lines + 8 tests) | **Review**: 2 rounds, 0 BLOCKERs | **Total**: ~899 TS + ~1051 test, 73 tests

Typical activity chain showing composition: "Move to target and attack" is composed of `Move -> Attack -> Move -> Wait`, where `Move` has `PathFind` as a child activity (child executes first), and `Attack` has `Aim` as a child.

- [x] **TODO-3.F.1** `abstract class Activity` (Activity.ts, 722 lines, 50 tests):
  - `state: ActivityState` enum (`Queued`, `Active`, `Done`, `Canceling`, `Canceled`)
  - `nextActivity: Activity | null` -- Linked-list pointer to next activity in chain
  - `childActivity: Activity | null` -- Sub-activity (executed first when `childHasPriority = true`)
  - `childHasPriority: boolean` -- Default `true`; when child exists and has priority, child is ticked first
  - `isInterruptible: boolean` -- Whether activity can be canceled mid-execution
  - `tick(actor: GameActor): boolean` -- Abstract method; returns `true` when activity is complete
  - `tickOuter(actor: GameActor): void` -- Main entry point called by World; manages state machine (reviewer noted: "near-perfect line-for-line"):
    - If cancelled: set state to `Canceling`, call `tick()` until clean completion
    - If `childActivity` exists and `childHasPriority`: tick child, on completion clear child reference
    - Then tick self: if `tick()` returns `true`, set state to `Done`
  - `onFirstRun(actor: GameActor): void` -- Called once when activity activates (deferred initialization)
  - `onLastRun(actor: GameActor): void` -- Called when activity completes; **must always execute** for resource cleanup
  - `cancel(actor: GameActor, keepQueue?: boolean): void` -- Cancel with cleanup; optionally preserve queued chain
  - `queueChild(child: Activity): void` -- Set a child activity (replaces any existing child)
  - `queue(next: Activity): void` -- Append to activity chain (traverse to end, set `nextActivity`)

- [x] **TODO-3.F.2** Activity state machine transitions (documented in code):
  - `Queued` -> `onFirstRun()` -> `Active` -> `tick()` returns `true` -> `Done` -> `onLastRun()`
  - Cancellation path: Any state -> `Canceling` -> `tick()` detects cancel state and cleans up -> `Canceled`
  - `isInterruptible = false` prevents cancellation (used by `Attack` activity)
  - Invalid transitions detected and logged as warnings (never silently skip)

- [x] **TODO-3.F.3** `CallFunc.ts` -- Simple callback activity (CallFunc.ts, 90 lines, 15 tests):
  - Constructor takes `() => void` callback function
  - `tick()` calls the callback once and returns `true` (immediately done after first tick)
  - Useful for one-shot actions: "play sound after move completes," "explode after delay"

- [x] **TODO-3.F.4** `ActivityUtils.ts` (support file S5, 87 lines, 8 tests):
  - Activity state utilities (sequence composition helpers)
  - Migrated alongside Activity.ts as a direct dependency
  - Manages activity chain execution for a single actor

- [x] **TODO-3.F.5** Document Plan B (Promise/async alternative) for UI animations:
  - `Activity.runAsync(actor: GameActor): Promise<void>` -- Async execution path for non-deterministic visual activities
  - Use case: UI transitions, screen shake, camera animations (not game logic)
  - Core game logic ALWAYS uses Plan A (class hierarchy) for determinism

**Key Architecture Decision: Option A (Class Hierarchy) vs Option B (async/await)** (see ADR-3.3)
- **Decision**: Option A (Class Hierarchy) for core game logic
- **Rationale**: Preserves deterministic tick-by-tick execution (critical for lockstep networking). Child activity priority mechanism requires fine-grained per-tick control. Cancellation requires cooperative check points (not possible with Promise cancellation). Activity state machine maps naturally to class state.

**Acceptance Criteria**:
- Activity chain `Move -> Attack -> Wait` executes in correct sequential order
- Child activity preemption: `Move` with `PathFind` child ticks child first, advances to parent only when child completes
- Cancellation propagates: parent cancelled -> child receives cancel and cleans up
- `onLastRun()` is ALWAYS called before disposal (critical for resource cleanup -- verify with try/finally)
- `isInterruptible = false` prevents cancellation (verified by test that attempts cancel during Attack)
- Activity state transitions are valid: cannot go from Queued directly to Done
- 500 actors each running an activity tick in under 1ms

**Review**: 2 rounds, 0 BLOCKERs. Reviewer noted TickOuter is "near-perfect line-for-line" matching of OpenRA original.

---

### 3.7 Phase G: Player.cs -- Player Management

**Status**: Completed (1/1) -- 2026-06-04
**Complexity**: Low
**Blocked by**: Phase A (LongBitSet for PlayerMask), Phase D (Actor -- PlayerActor pattern)
**Blocks**: Diplomacy, Fog of War (Shroud), UI (player info display)
**Implementation**: ~1272 lines TS + ~1407 lines test, 82 tests | **Review**: 1 round, 0 BLOCKERs

**OpenRA Reference**: `OpenRA.Game/Player.cs` (337 lines)
**Migration Target**: `src/OpenRA.Game/Player.ts`

**Description**: Player state and diplomacy using the unique **PlayerActor pattern**: each `Player` owns a `PlayerActor` which has a full Trait set just like regular game Actors. Player capabilities (fog of war, frozen units, resource management, tech tree) are implemented through Traits on the PlayerActor. Uses bitmask for O(1) alliance checks.

- [x] **TODO-3.G.1** `Player` class (NOT a scene node -- lives alongside the scene):
  - `playerName: string` -- Display name
  - `faction: string` -- Faction identifier (e.g., "allies", "soviet")
  - `internalName: string` -- Internal ID
  - `playerActor: GameActor` -- Special actor holding player traits (Shroud, FrozenActorLayer, etc.)
  - `winState: WinState` enum (`Undefined`, `Won`, `Lost`) -- Immutable after transition to Won/Lost
  - `playerMask: LongBitSet` -- Bitmask for fast relationship query
  - `alliedPlayersMask: LongBitSet` -- Bitmask of allied players
  - `enemyPlayersMask: LongBitSet` -- Bitmask of enemy players

- [x] **TODO-3.G.2** Diplomacy system:
  - `relationshipWith(other: Player): PlayerRelationship` -- Returns `Enemy`, `Neutral`, or `Ally`
  - Bitmask-based O(1) lookup: `(alliedPlayersMask & other.playerMask) != 0` for ally check
  - `playerStances: Map<string, PlayerRelationship>` -- Configurable per-player stances
  - `isAlliedWith(other: Player): boolean`, `isEnemyWith(other: Player): boolean` -- Convenience methods
  - Relationship affects: target acquisition (enemies only), selection (own/allies only), vision sharing

- [x] **TODO-3.G.3** Resource management (placeholder for economy chapter):
  - `resources: Map<string, number>` -- Cash, power, ore, etc.
  - `addResource(type: string, amount: number): void` -- Add resource, clamp to 0
  - `getResource(type: string): number` -- Query resource amount
  - `canAfford(costs: Map<string, number>): boolean` -- Check if can afford costs

- [x] **TODO-3.G.4** Event system for UI updates:
  - `onResourcesChanged: BABYLON.Observable<ResourceChange>` -- UI subscribes to resource changes
  - `onWinStateChanged: BABYLON.Observable<WinState>` -- UI subscribes to win/loss transitions
  - `onPlayerActorChanged: BABYLON.Observable<GameActor>` -- Notify when PlayerActor traits change

- [x] **TODO-3.G.5** `Spectating` player flag:
  - A player with no units/control, viewing the game passively
  - Spectating players have full map visibility (no Shroud applied)
  - Cannot issue orders or influence game state

- [x] **TODO-3.G.6** `IBot` interface placeholder:
  - Bot/AI players are activated through the `IBot` Trait on the PlayerActor
  - AI logic migration (condition-action rule system) is deferred to AI chapter
  - Define `IBot` interface: `activate(player: Player): void`, `queueOrder(order: Order): void`

**Acceptance Criteria**:
- PlayerActor correctly owns all player-specific Traits (Shroud, FrozenActorLayer, etc.)
- `relationshipWith()` returns correct values for ally, enemy, and neutral configurations
- `PlayerMask` bitmask correctly handles up to 64 players with O(1) alliance checks via bitwise AND
- Resource changes emit observable events for UI updates
- `WinState` transitions are immutable (Won/Lost cannot revert)
- Spectating players have full map visibility and cannot issue orders

**Estimated Effort**: ~1272 lines implementation + ~1407 lines test (82 tests, 1 review round)

---

### 3.8 Phase H: Effects System

**Status**: Pending (0/3)
**Complexity**: Low
**Blocked by**: Phase C (World -- effects list lives in GameWorldManager)
**Blocks**: Visual effects (explosions, smoke, delayed callbacks)

**OpenRA Reference**: `OpenRA.Game/Effects/IEffect.cs` (28 lines), `DelayedAction.cs` (37 lines), `DelayedImpact.cs` (43 lines)
**Migration Target**: `src/OpenRA.Game/Effects/IEffect.ts`, `DelayedAction.ts`, `DelayedImpact.ts`

**Description**: Time-limited visual/non-visual effects that run outside the Actor system. Effects are ticked by World alongside Actors but are not Actors themselves. Used for projectiles, explosions, screen shakes, delayed actions.

- [x] **TODO-3.H.1** `IEffect.ts` interface:
  - `tick(world: GameWorldManager): void` -- Called each logic tick by World
  - `render(worldRenderer: WorldRenderer): IRenderable[]` -- Return renderables for this frame
  - Optional: `isDone: boolean` -- Mark effect for removal (World removes done effects)

- [x] **TODO-3.H.2** `DelayedAction.ts` -- Execute a callback after a specified number of ticks:
  - Constructor: `new DelayedAction(delayTicks: number, action: () => void)`
  - `tick()` decrements counter each tick; when counter reaches 0, executes the action callback once
  - Marked `isDone = true` after callback execution
  - Use case: "destroy this actor in 10 ticks," "play explosion sound after 3 ticks"

- [x] **TODO-3.H.3** `DelayedImpact.ts` -- Execute an action when a projectile reaches its target:
  - Constructor: `new DelayedImpact(origin: WPos, target: Target, speed: number, onImpact: (target: Target) => void)`
  - `tick()` advances projectile position toward target at speed rate
  - When position reaches target, calls `onImpact(target)` and marks `isDone = true`
  - Use case: bullet travel time, missile flight, artillery shell arc

| Babylon.js Mapping | |
|:---|:---|
| `IEffect.render()` returns `IRenderable[]` | Effects create `BABYLON.Mesh` or `ParticleSystem` directly in scene |
| `IEffect.tick()` | Called by `GameWorldManager` during logic tick |
| Visual-only effects (no gameplay impact) | Can use `scene.onBeforeRenderObservable` for smooth interpolation |

**Acceptance Criteria**:
- `DelayedAction` correctly defers callback execution by exact tick count
- `DelayedImpact` correctly interpolates position and fires callback at target arrival
- Effects with `isDone = true` are removed by World at frame end
- Multiple effects tick concurrently without interference

**Estimated Effort**: ~200 lines implementation + ~150 lines test (1-2 developer-days)

---

### 3.9 Phase I: Spatial Query (ScreenMap)

**Status**: Pending (0/1)
**Complexity**: Medium
**Blocked by**: Phase A (SpatiallyPartitioned), Phase D (Actor)
**Blocks**: Selection box, tooltips, spatial queries

**OpenRA Reference**: `OpenRA.Game/Traits/World/ScreenMap.cs` (287 lines)
**Migration Target**: `src/OpenRA.Game/Traits/World/ScreenMap.ts`

**Description**: Maps screen coordinates to Actors for click detection and selection. In 3D, this partially converts to ray-picking while retaining a spatial index for deterministic queries like selection boxes.

- [ ] **TODO-3.I.1** `ScreenMap3D` trait/component:
  - Spatial hash grid over the world XZ plane (inherits `SpatiallyPartitioned`)
  - `add(actor: GameActor, bounds: Rectangle): void` -- Register actor in spatial index
  - `remove(actor: GameActor): void` -- Remove from index
  - `update(actor: GameActor, bounds: Rectangle): void` -- Update when actor moves
  - `query(bounds: Rectangle): GameActor[]` -- Return actors in screen rectangle (for selection box)
  - `queryAt(screenPoint: {x: number, y: number}): GameActor[]` -- Return actors at screen point (for tooltip/click)

- [ ] **TODO-3.I.2** 3D picking integration (dual approach):
  - **Option 1 (GPU)**: `scene.pick(x, y)` with `predicate` filter for selectable actors -- used for mouse hover (visual feedback)
  - **Option 2 (CPU)**: Spatial index + camera projection to screen space -- used for selection box (deterministic)
  - **Recommendation**: Use Option 2 for selection logic (matches OpenRA determinism), Option 1 for hover highlights (responsive visual feedback)

- [ ] **TODO-3.I.3** Key 2D-to-3D change documentation:
  - OpenRA's 2D `ScreenMap` maps pixel coordinates -> Actors (flat map)
  - In 3D, perspective camera projects 3D positions to screen space; spatial queries in world space
  - `ScreenMap3D` operates in world-space XZ coordinates, then projects to screen for render

**Acceptance Criteria**:
- Rectangle query returns all actors whose projected screen bounds overlap the selection rectangle
- Point query returns the closest (topmost/highest render order) actor at the click point
- Spatial index add/remove/update maintains correct query results with 1000+ actors
- Performance: 100-actor selection box query completes in under 1ms

**Estimated Effort**: ~350 lines implementation + ~250 lines test (2-3 developer-days)

---

### 3.10 Phase J: Weapon System (Deferrable)

**Status**: Pending (0/2) -- **DEFERRABLE to future chapter**
**Complexity**: Medium
**Blocked by**: Phase A (primitives), Phase E (ActorInfo -- configuration loading)
**Blocks**: Nothing critical in Chapter 3

**OpenRA Reference**: `OpenRA.Game/GameRules/WeaponInfo.cs` (268 lines), `OpenRA.Game/GameRules/Ruleset.cs` (281 lines)
**Migration Targets**: `src/OpenRA.Game/GameRules/WeaponInfo.ts`, `src/OpenRA.Game/GameRules/Ruleset.ts`

**Description**: Weapon configuration and game rules. These are pure data structures -- the weapon itself has no behavior. Firing logic is in the `Armament` Trait (mod code), projectile flight in `IProjectile` implementations, and damage in `IWarhead` implementations. The three-layer separation (Config -> Launcher -> Projectile -> Warhead) is the core design.

**Deferral Rationale**:
- Weapon config is a pure data structure -- no dependencies to unblock other Chapter 3 work
- Projectile physics in 3D (bezier missiles, parabolic grenades, ray bullets) is complex visual work best done after the rendering pipeline fully stabilizes
- Warhead effects depend on having a full trait ecosystem (Health, Damage, Area effects) from mod system chapter

- [ ] **TODO-3.J.1** `WeaponConfig.ts` -- Pure data class for weapon settings:
  - `range: WDist` (range), `projectile: ProjectileConfig`, `warheads: WarheadConfig[]`
  - `report: string` (firing sound), `burst: number`, `burstDelay: number`, `reloadDelay: number`
  - `fromJSON(json: unknown): WeaponConfig` factory with JSON Schema validation
  - Validate required fields, numeric ranges, enum values for projectile/warhead types

- [ ] **TODO-3.J.2** `ProjectileConfig` interface definitions:
  - `BulletProjectileConfig`: speed, inaccuracy, blockable
  - `MissileProjectileConfig`: speed, homing, guidance
  - `GravityBombConfig`: speed, gravity, launch angle
  - `LaserProjectileConfig`: duration, width, color

- [ ] **TODO-3.J.3** `WarheadConfig` interface definitions:
  - `SpreadDamageWarhead` (damage, spread, versus armor)
  - `TargetDamageWarhead` (damage, target validation)
  - Future extensibility for custom warhead types

- [ ] **TODO-3.J.4** `Ruleset.ts` -- Ruleset container:
  - `actors: Map<string, ActorConfig>` -- All actor definitions
  - `weapons: Map<string, WeaponConfig>` -- All weapon definitions
  - `music: MusicInfo[]`, `sounds: SoundInfo[]`
  - `fromModDirectory(path: string): Ruleset` -- Load from mod directory (JSON files)

- [ ] **TODO-3.J.5** Document that actual `IProjectile`, `IWarhead`, and `Armament` implementations belong to `OpenRA.Mods.Common/` (mod code migration). Chapter 3 only provides the configuration data layer.

**Acceptance Criteria**:
- `WeaponConfig.fromJSON()` correctly parses all OpenRA weapon YAML fields
- JSON Schema validation rejects invalid weapon configurations
- Burst weapon configuration (count + delay) is correctly modeled
- `Ruleset` correctly aggregates all game rules from a mod directory
- `IProjectile` and `IWarhead` interfaces are defined as contracts for future implementation

**Estimated Effort**: ~450 lines implementation + ~300 lines test (3 developer-days)

---

### 3.11 Support Files

**Status**: Pending (0/5)
**Complexity**: Low
**Migration on-demand** -- migrate these as needed when other phases require them.

| File | When Needed | Notes |
|------|------------|-------|
| `Sync.ts` (212 lines) | Networking chapter | Deterministic hash computation for sync validation. Placeholder in Chapter 3. |
| `Exts.ts` (680 lines) | All phases | Extension methods: `Clamp`, `MinBy`, `MaxBy`, `TryGetValue`, collection utilities. Migrate incrementally as functions are needed. |
| `WorldUtils.ts` (112 lines) | Phase C | World utility functions. Migrate alongside World.ts. |
| `GameSpeed.ts` (62 lines) | Phase C | Game speed configuration. Migrate alongside World.ts. |
| `ActivityUtils.ts` (39 lines) | Phase F | Activity state utilities (sequence composition helpers). Migrate alongside Activity.ts. |

---

## 4. Dependency Graph

```
Phase A (17 files: Coords + Primitives) <-- FOUNDATION, no internal dependencies
  |
  +--> Phase B (TraitsInterfaces, TraitDictionary)
  |     |
  |     +--> Phase C (World.cs) --------------------------+
  |     |     |                                            |
  |     |     +--> Phase D (Actor.cs / GameActor)          |<-- World contains Actors
  |     |           |                                      |    Actor references World
  |     |           |                                      |    (circular REFERENCE, not circular DEPENDENCY)
  |     |           +--> Phase E (ActorInfo.cs)            |
  |     |           +--> Phase F (Activity.cs)             |
  |     |           +--> Phase G (Player.cs)               |
  |     |           +--> Phase H (Effects)                 |
  |     |           +--> Phase I (ScreenMap)               |
  |     |                                                  |
  |     +--> Phase J (Weapon System) [DEFERRABLE]          |
  |                                                        |
  +--------------------------------------------------------+
```

### Parallelization Strategy

- **Within Phase A**: All 17 items have NO internal dependencies. They can ALL be developed in parallel by multiple developers.
- **Phase B** (2 items): Tightly coupled, should be done together by one developer. Requires only Phase A.
- **Phases C + D** (2 items): The most complex pair. Must be closely coordinated (World contains Actors, Actor references World). Ideally one developer, or two with very tight communication.
- **Phases E, F, G, H** (7 items): Can start once Phase D Actor interface is STABLE (don't need full Actor implementation, just the `GameActor` class shape). All can proceed in parallel.
- **Phase I** (1 item): Can start once Phase A (SpatiallyPartitioned) and Phase D (Actor) are stable.
- **Phase J** (2 items): Can be deferred entirely to a future chapter or started in parallel with Phase E.

### External Dependencies (Chapter 2)

| Chapter 2 Dependency | Required By | Status |
|:---|:---|:---|
| `Renderer.ts` (Engine.runRenderLoop) | Phase C (World tick loop) | Complete |
| `WorldRenderer.ts` (BABYLON.Scene) | Phase C (GameWorldManager wraps Scene) | Complete |
| `ShaderMaterial` (custom shaders) | Future trait rendering | Complete |
| Sprite & Texture system | Future visual effects (Phase H) | Complete |

---

## 5. Verification and Test Strategy

- [ ] **TEST-3.1** Unit tests for all coordinate types:
  - `WPos`/`WVec` arithmetic correctness (add, subtract, dot, cross, lerp)
  - Coordinate conversion accuracy: `MPos <-> CPos <-> WPos` round-trip with zero loss
  - `WAngle` trigonometric determinism: `sin()/cos()` return identical values across Chrome, Firefox, Safari
  - `WDist` comparison and arithmetic edge cases (zero, max, overflow)

- [ ] **TEST-3.2** Primitives tests:
  - `BitSet` / `LongBitSet` bitwise operations (set, clear, AND, OR, XOR, NOT)
  - `TypeDictionary` typed get/set operations with string keys
  - `PriorityQueue` min-heap invariant (heap property maintained after enqueue/dequeue)
  - `SpatiallyPartitioned` add/remove/update/query correctness with rectangle bounds
  - `Cache` lazy evaluation and invalidation
  - `ActionQueue` deferred execution order and delay counting

- [ ] **TEST-3.3** TraitDictionary tests:
  - Add/remove/lookup correctness across multiple interface implementations
  - `traitsImplementing()` returns correct subset (5 ITick traits from 20 components)
  - `withTraitTimed()` batch iteration performance: 1K actors x 20 traits in under 5ms
  - Removal correctly purges from ALL interface indexes

- [ ] **TEST-3.4** GameWorldManager tests:
  - Fixed timestep loop simulation: 250 ticks in 10 seconds (25 TPS)
  - Tick execution order verification: Activities -> ITick -> Effects -> frameEndActions
  - Actor add/remove lifecycle fires correct `INotify*` events
  - Pause state: no logic ticks while paused, render ticks continue

- [ ] **TEST-3.5** GameActor tests:
  - Component CRUD operations (add, query, remove)
  - Condition grant/revoke with reference counting (grant x2, revoke x1, still active; revoke again, inactive)
  - `RequiresCondition` expression evaluation: `deployed`, `!deployed`, `deployed || upgraded`, `deployed && !disabled`
  - Activity queue/cancel/dispose chain
  - Lifecycle state transitions: Created -> InWorld -> Disposed (all hooks fire in order)
  - `WillDispose` deferred destruction: actor not referenced after marking

- [ ] **TEST-3.6** Activity state machine tests:
  - Chain execution: `Move -> Attack -> Wait` executes in order
  - Child activity priority: `Move` with `PathFind` child ticks child first
  - Cancellation mid-chain: parent cancelled -> child cancelled -> chain advances or stops
  - `isInterruptible = false`: cancel attempt fails, activity continues
  - `onLastRun()` always called on completion and on cancellation (verify cleanup)

- [ ] **TEST-3.7** Player diplomacy tests:
  - `LongBitSet` O(1) relationship queries: `(alliedMask & otherMask) != 0`
  - `relationshipWith()` correct for ally/enemy/neutral configurations
  - PlayerActor trait delegation (player traits are on actor, player class delegates)

- [ ] **TEST-3.8** ScreenMap spatial query tests:
  - Rectangle query (selection box) returns all actors in bounds
  - Point query (click/hover) returns closest actor at point
  - Add/remove/update correctness (moving actor updates spatial index)
  - Performance: 1000 actors, point query under 0.5ms

- [ ] **TEST-3.9** Effects system tests:
  - `DelayedAction` defers callback by correct tick count
  - `DelayedImpact` correctly interpolates position toward target
  - Multiple effects tick concurrently without interference

- [ ] **TEST-3.10** E2E integration test (Playwright, deferred to post-Chapter 3):
  - Game world initialization with test actors
  - Multiple tick cycles: actors move, activities complete, effects fire
  - Visual rendering verification: actors appear in scene

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **TypeScript lacks C# operator overloading** | HIGH | All coordinate arithmetic is `WPos.add(a, b)` not `a + b`; verbose, error-prone | Static methods on each type with clear documentation; consider JS `Proxy` for debug-mode only operator-style syntax |
| **C# struct copies vs TS reference semantics** | MEDIUM | C# structs are always copied; TS classes are aliased -- mutation bugs possible | Use immutable patterns (`readonly` fields, `Object.freeze()`); explicit `clone()` methods where mutation needed |
| **Trait query O(n) vs C# O(log n)** | LOW | 30 components per actor max, linear scan is negligible | Cache frequent lookups (`occupiesSpace`, `targetables`); benchmark before optimizing |
| **GameActor extends TransformNode coupling** | MEDIUM | Tight coupling to Babylon.js; makes unit testing game logic harder | Test game logic with mocked TransformNode; keep Babylon-dependent code in separate methods |
| **Activity cancellation in tick boundaries** | LOW | Cancellation mid-chain could leave state inconsistent | Port exact C# state machine logic; extensive unit tests for every state transition combination |
| **Deterministic sync hash (Sync.cs)** | HIGH | JS floating-point differences across browsers break network sync | Use lookup tables for trig functions; avoid floating-point in sync hash; defer full implementation to networking chapter |
| **3D ray picking vs 2D ScreenMap determinism** | MEDIUM | GPU ray picking may return different results than CPU spatial index | Dual approach: CPU spatial index for logic (deterministic selection), GPU picking for visual (hover highlights) |
| **Per-frame allocation** | MEDIUM | Coordinate types are created/destroyed every tick -- GC pressure | Pool patterns for temporary objects in hot paths; reuse `WPos`/`WVec` instances where possible |
| **Phase A scope creep** | LOW | 17 files is a lot for "prerequisites" | All 17 are LOW complexity; they are pure data structures with no external deps; can be done in parallel by 3-4 developers |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-3.1: GameActor extends TransformNode

- **Context**: Actor needs 3D position/rotation/scale and scene graph participation for rendering.
- **Decision**: Extend `BABYLON.TransformNode` directly.
- **Alternatives considered**: Wrapper class holding a TransformNode (adds indirection, harder to integrate with Babylon scene graph). Custom 3D class with manual sync (complex, error-prone).
- **Consequences**: 
  - Pro: Direct scene graph participation, built-in transform, automatic frustum culling.
  - Con: Tighter coupling to Babylon.js; `dispose()` must call both `super.dispose()` and game cleanup.
  - Mitigation: Test game logic (traits, conditions, activities) with mocked TransformNode in isolation.

### ADR-3.2: Trait Query Strategy -- Linear Scan with Type Guards

- **Context**: C# `TraitDictionary` uses generic type keys with binary search on sorted arrays (O(log n)). TypeScript has no equivalent compile-time generic type key system.
- **Decision**: Linear O(n) scan with type guard functions, using `Map<string, Component[]>` storage.
- **Alternatives considered**: TypeScript decorators (experimental, may change). Prototype chain inspection (fragile, breaks with minification).
- **Consequences**:
  - Pro: Simple, understandable, no experimental features, works with all bundlers.
  - Con: O(n) queries vs C# O(log n).
  - Mitigation: n < 30 per actor makes O(n) negligible; cache hot-path lookups (`occupiesSpace`, `targetables`) on Actor for O(1) access.

### ADR-3.3: Activity System -- Class Hierarchy (Plan A)

- **Context**: C# coroutine-style activity chains need conversion to TypeScript. Two approaches exist.
- **Decision**: Retain class hierarchy (`abstract class Activity` with `tick(): boolean` returning completion status).
- **Alternatives considered**: async/await with Promises (Plan B) -- cleaner code but loses tick-level control and child activity priority.
- **Consequences**:
  - Pro: Preserves deterministic tick-by-tick execution (critical for lockstep networking). Child activity priority mechanism works naturally. Cancellation via cooperative check points.
  - Con: More boilerplate code (explicit state machine, manual chain management).
  - Mitigation: Plan B (async/await) allowed for UI animations and screen effects (non-gameplay visual activities).

### ADR-3.4: Coordinate Conversion Layer

- **Context**: OpenRA uses 1024 sub-units per cell internally. Babylon.js uses meters. Conversion is needed for rendering.
- **Decision**: Keep OpenRA coordinate system internally for all game logic; convert to Babylon meters only at the render boundary.
- **Alternatives considered**: Normalize everything to Babylon meters (lossy conversion breaks game balance and network determinism). Maintain dual coordinate systems (complex, error-prone).
- **Consequences**:
  - Pro: Game balance and network determinism preserved. Only one internal coordinate system.
  - Con: `CoordinateTransformer` utility needed; conversion cost at render time.
  - Mitigation: Cache converted positions; update only when game position changes (not every frame).

### ADR-3.5: Phase J (Weapon System) Deferral

- **Context**: Weapon system depends on full trait ecosystem (Health, Damage, Armament, projectiles) from mod code, not yet migrated.
- **Decision**: Define `WeaponConfig` data class and `IProjectile`/`IWarhead` interfaces in Chapter 3. Defer full implementation (concrete projectiles, warheads, Armament trait) to the mod system chapter.
- **Alternatives considered**: Partial implementation in Chapter 3 (creates false sense of progress; tight coupling to unimplemented traits). Full implementation (blocks progress; too many dependencies).
- **Consequences**:
  - Pro: Chapter 3 stays focused on core containers (World, Actor). Clean interface contracts defined for future implementation.
  - Con: Cannot fire weapons until mod chapter; integration testing limited.
  - Mitigation: `WeaponConfig` is a pure data class easily tested in isolation. Weapons chapter becomes self-contained with clear interfaces.

### ADR-3.6: YAML Build-Time Compilation to JSON

- **Context**: OpenRA uses YAML for all configuration. Browser-side YAML parsing is heavyweight (large JS library, slow parse time).
- **Decision**: Compile YAML to JSON at build time (Vite plugin or pre-build script). Runtime only loads JSON.
- **Alternatives considered**: Runtime YAML parser (js-yaml ~40KB, slow for large mod files). Custom lightweight YAML subset parser (maintenance burden, likely misses edge cases).
- **Consequences**:
  - Pro: Fast load times, no runtime YAML library, JSON.parse() is native and fast.
  - Con: Build step required; YAML errors surfaced at build time, not runtime.
  - Mitigation: Clear error messages in build step; validate YAML schema during compilation.

---

## Migration Order and Phasing Strategy

**Recommended execution sequence** (optimized for early integration testing and parallel development):

| Week | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1-2 | Phase A | 17 | All coordinate types + primitives. Pure data structures with no Babylon.js deps. | YES -- all 17 in parallel |
| 2-3 | Phase B | 2 | TraitsInterfaces + TraitDictionary. Architectural keystone. | Together (tightly coupled) |
| 3-5 | Phases C+D | 2 | World + Actor. Highest complexity. Closely coordinated. | Together (World/Actor interlocked) |
| 5-6 | Phase E | 1 | ActorInfo (metadata configuration). | YES -- alongside F, G, H |
| 5-6 | Phase F | 2 | Activity + CallFunc (behavior state machines). | YES -- alongside E, G, H |
| 6 | Phase G | 1 | Player (diplomacy, PlayerActor). | YES -- alongside E, F, H |
| 6 | Phase H | 3 | Effects (IEffect, DelayedAction, DelayedImpact). | YES -- alongside E, F, G |
| 7 | Phase I | 1 | ScreenMap (spatial query). | Only after D (Actor) stable |
| — | Phase J | 2 | Weapon system. DEFERRED to future chapter. | — |
| — | Support | 5 | Migrate incrementally as needed. | — |

**Total estimate**: 7-8 weeks with 2 developers; 4-5 weeks with 4 developers.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths. If ambiguities in understanding the OpenRA source code arise, document notes in the migration plan instead of modifying the original files.

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4 (lines 458-623) -- Full architecture analysis
> - `docs/rendering_migration_plan.md` -- Chapter 2 migration plan (format reference)
> - `docs/migration_progress.md` -- Current project progress tracking
> - `CLAUDE.md` -- Project overview and conventions
