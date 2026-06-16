# OpenRA to Babylon.js Migration Plan: Chapter 15 -- Order Generators

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.4 (Orders/OrderGenerators) + Section 4.3 (Traits/Interfaces)
> **Chapter Status**: PHASE A COMPLETE (3/11 migrated, 2 New + 1 Verified; 8 pending in Phases B-C). APPROVED (R1, 0 BLOCKERs, 0 MAJORs, 3 MINORs)
> **Planning Date**: 2026-06-16
> **Prerequisite**: Chapters 2-14 COMPLETE (all foundation layers ready)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Foundation -- Abstract Base & Targeters](#31-phase-a-foundation----abstract-base--targeters)
   - 3.2 [Phase B: Core Order Generators](#32-phase-b-core-order-generators)
   - 3.3 [Phase C: Extended Generators](#33-phase-c-extended-generators)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

Chapter 15 implements the **UI-side order generation logic** that converts player input (clicks, hotkeys, modifier keys) into `Order` objects dispatched through the network layer. These order generators are the bridge between the player's intent (clicking on the map) and the game engine's execution (actor traits resolving orders).

The core paradigm shift: **from OpenRA's 2D screen-space input dispatch to Babylon.js 3D input bridging**, while maintaining identical order semantics:

- **Target resolution** shifts from 2D `ScreenMap.ActorsAtMouse()` pixel-hash → CPU-side `ActorMap` spatial lookup with cell-level granularity, backed by `CoordinateTransformer` viewport-to-cell projection
- **Cursor feedback** shifts from `ChromeMetrics` sprite-sheet coordinate lookup → CSS `cursor` property mapping with logical cursor names
- **Visual feedback** (ghost buildings, range circles, beacon markers) shifts from `IEnumerable<IRenderable>` 2D renderables → temporary Babylon.js `Mesh` objects managed per-generator lifecycle
- **Modifier key handling** shifts from C# `Modifiers` flags enum → `TargetModifiers` class with named boolean properties
- **Order creation** uses the existing `Order` / `OrderManager` infrastructure from Chapter 6 Phase A, unchanged

### 1.2 Architecture Principles

1. **Command Pattern**: Order generators are the "Command" in the Command pattern. Each generator is an input mode that processes mouse/keyboard events and produces `Order` objects. The generator lifecycle is managed by `WorldInteractionControllerWidget` (Chapter 5 Phase E).

2. **Constructor Injection over Globals**: C# global singletons (`Game.Settings.Game`, `ChromeMetrics`) are passed as constructor parameters via an `OrderGeneratorContext` object. This matches the existing pattern in `PlaceBuildingOrderGenerator` (Chapter 11) and enables unit testing with mock dependencies.

3. **Abstract Base Reuse**: The `OrderGenerator` abstract base class centralizes button resolution (`ActionButton`/`CancelButton` via `MouseActionType`), cancel-on-game-over logic, and default method stubs. Concrete generators extend this base and override only what they need.

4. **CPU Spatial Hash over GPU Raycasting**: Target resolution uses the existing `ActorMap` CPU-side spatial hash (Chapter 3), not Babylon.js `scene.pick()` GPU raycasting. This ensures determinism, supports non-rendered actors, and avoids GPU readback stalls. See ADR-15.2.

5. **Trait-as-Component for Order Resolution**: `UnitOrderGenerator.orderForUnit()` iterates `IIssueOrder` traits on selected actors, sorted by `IOrderTargeter.orderPriority`. The highest-priority matching targeter produces the order. This is the same dependency inversion pattern as OpenRA -- traits declare their own orders, the generator just coordinates.

6. **Logical Cursor Names over Direct Sprite References**: Order generators return logical cursor name strings (`"repair"`, `"move-blocked"`, `"ability"`). These are mapped to CSS `cursor` values or custom cursor DataURIs via a central mapping table. This separates cursor logic from cursor rendering.

7. **Dispose Pattern for Visual Feedback**: Generators that create visual feedback (ghost meshes, target lines) store them in a `private meshes: Mesh[]` array and dispose them on `deactivate()`. This prevents GPU memory leaks when generators are replaced.

8. **One-Shot vs Persistent Generators**: Beacon and building placement generators are one-shot -- they auto-cancel after producing an order. Guard and repair generators persist until explicitly cancelled or the game state invalidates them (target destroyed, game over).

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-14 is available for Chapter 15:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, scene graph, rendering groups |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, `ActorMap` |
| TraitDictionary + TraitsInterfaces | Ch3 | `IOrderGenerator`, `IOrderTargeter`, `IIssueOrder`, `TraitDictionary` |
| Activity base class | Ch3 Phase F | `Activity` abstract class |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `CPos`, `CVec`, HPA* pathfinder |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space |
| WorldInteractionControllerWidget | Ch5 Phase E | Generator lifecycle management, input dispatch |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider` |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager` |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `ViewportControllerWidget`, `SelectionUtils` |
| Combat traits | Ch8 | `Armament`, `AttackBase`, `AutoTarget` (IIssueOrder implementations) |
| Movement traits | Ch9 | `Mobile`, `Aircraft` (movement IIssueOrder implementations) |
| Resource traits | Ch10 | `Harvester` (harvest IIssueOrder implementation) |
| Building traits | Ch11 | `RepairableBuilding`, `Building`, `PlaceBuildingOrderGenerator` (already migrated) |
| Shroud | Ch12 | `Shroud`, `FrozenActorLayer` (fog-of-war target filtering) |
| Support Powers | Ch13 | `Beacon` trait (beacon order receiver) |
| Activity Implementations | Ch14 | `Repairable`, `RepairableNear`, `Guardable`, `Guard`, `Sellable` stubs |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (11 files across 3 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase | Status |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|
| **Phase A: Foundation — Abstract Base & Targeters** | | | | | | | |
| 1 | `OpenRA.Game/Orders/IOrderGenerator.cs` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (L1137-1220) | `IOrderGenerator` | 30 | LOW | A | ✅ MIGRATED (verify) |
| 2 | `OpenRA.Mods.Common/Orders/OrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/OrderGenerator.ts` | `OrderGenerator` | 61 | LOW | A | 📋 PENDING |
| 3 | `OpenRA.Mods.Common/Orders/UnitOrderTargeter.cs` | `src/OpenRA.Mods.Common/Orders/UnitOrderTargeter.ts` | `UnitOrderTargeter` | 88 | MEDIUM | A | ✅ MIGRATED (Ch11) |
| 4 | `OpenRA.Mods.Common/Orders/DeployOrderTargeter.cs` | `src/OpenRA.Mods.Common/Orders/DeployOrderTargeter.ts` | `DeployOrderTargeter` | 46 | LOW | A | ✅ MIGRATED (Ch11) |
| 5 | `OpenRA.Mods.Common/Orders/EnterAlliedActorTargeter.cs` | `src/OpenRA.Mods.Common/Orders/EnterAlliedActorTargeter.ts` | `EnterAlliedActorTargeter` | 49 | LOW | A | 📋 PENDING |

| **Phase B: Core Order Generators** | | | | | | | |
| 6 | `OpenRA.Mods.Common/Orders/UnitOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/UnitOrderGenerator.ts` | `UnitOrderGenerator` | 224 | **HIGH** | B | 📋 PENDING |
| 7 | `OpenRA.Mods.Common/Orders/RepairOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/RepairOrderGenerator.ts` | `RepairOrderGenerator` | 87 | LOW | B | 📋 PENDING |
| 8 | `OpenRA.Mods.Common/Orders/BeaconOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/BeaconOrderGenerator.ts` | `BeaconOrderGenerator` | 39 | LOW | B | 📋 PENDING |
| 9 | `OpenRA.Mods.Common/Orders/GlobalButtonOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/GlobalButtonOrderGenerator.ts` | `GlobalButtonOrderGenerator` + `PowerDownOrderGenerator` + `SellOrderGenerator` | 95 | MEDIUM | B | 📋 PENDING |

| **Phase C: Extended Generators** | | | | | | | |
| 10 | `OpenRA.Mods.Common/Orders/GuardOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/GuardOrderGenerator.ts` | `GuardOrderGenerator` | 85 | LOW | C | 📋 PENDING |
| 11 | `OpenRA.Mods.Common/Orders/ForceModifiersOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/ForceModifiersOrderGenerator.ts` | `ForceModifiersOrderGenerator` | 46 | LOW | C | 📋 PENDING |

| **Already Migrated in Chapter 11 (reference only)** | | | | | | | |
| 12 | `OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.ts` | `PlaceBuildingOrderGenerator` | 337 | HIGH | Ch11 | ✅ MIGRATED (1,449 TS lines, 940 test lines) |

> **Complexity Legend**:
> - **LOW**: Simple class with few dependencies. 30-95 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with generic type handling or multiple concretions. 88-95 lines of C#.
> - **HIGH**: Complex gameplay logic with target resolution chains, trait iteration, and cursor management. 224 lines of C# with deep integration into selection, targeting, and order systems.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 11 (8 new + 3 already migrated from Ch11) |
| **Phase A (Foundation)** | 2 new + 3 existing (verify) |
| **Phase B (Core Generators)** | 4 new |
| **Phase C (Extended Generators)** | 2 new |
| **HIGH complexity** | 1 file (UnitOrderGenerator, 224 lines) |
| **MEDIUM complexity** | 2 files (UnitOrderTargeter 88, GlobalButtonOrderGenerator 95) |
| **LOW complexity** | 8 files |
| **Total OpenRA C# source lines** | ~769 (pending only) / ~1,217 (total including migrated) |

| Phase | Pending Files | C# Lines | Est. TS Lines | Est. Tests | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Foundation | 0 | 110 | ~537 (done) | 59 (done) | ✅ COMPLETE |
| B: Core Generators | 4 | 445 | ~800 | ~920 | 📋 PLANNING |
| C: Extended Generators | 2 | 131 | ~230 | ~380 | 📋 PLANNING |
| Already migrated (Ch11) | 3 | 471 | ~2,200 (done) | ~1,700 (done) | COMPLETE |
| **Total** | **11** | **~1,217** | **~537 new + ~2,200 done** | **59 new + ~1,700 done** | — |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Foundation — Abstract Base & Targeters

**Status**: ✅ COMPLETE (2 new + 1 verified + 2 already migrated from Ch11 = 5/5)
**Complexity**: LOW (OrderGenerator 275 TS lines, EnterAlliedActorTargeter 262 TS lines)
**Blocked by**: Nothing (all dependencies already exist)
**Blocks**: Phase B (all concrete generators extend OrderGenerator), Phase C (Guard and ForceModifiers extend UnitOrderGenerator)

**Description**: Phase A establishes the foundation that all concrete order generators build upon. The `IOrderGenerator` interface is already defined in `TraitsInterfaces.ts` but needs verification for completeness against the C# source. The `OrderGenerator` abstract base class provides shared button resolution logic and default method stubs. `EnterAlliedActorTargeter` is a generic targeter for transport/garrion enter orders. `UnitOrderTargeter` and `DeployOrderTargeter` were migrated in Chapter 11 and require interface compatibility verification only.

**Paradigm Shifts**:
- C# `abstract class OrderGenerator : IOrderGenerator` with explicit interface implementation → TS `abstract class OrderGenerator implements IOrderGenerator` with direct method override
- C# `Game.Settings.Game` global singleton → TS constructor-injected `IMouseSettings` (matches existing PlaceBuildingOrderGenerator pattern)
- C# `MouseActionType` enum with `ResolveActionButton()` → TS `MouseActionType` enum with settings-resolved button mapping
- C# `EnterAlliedActorTargeter<T> where T : ITraitInfoInterface` generic → TS `EnterAlliedActorTargeter` with string-based trait key parameter
- C# `ref string cursor` output parameter → TS cursor returned via getter method (matches existing UnitOrderTargeter pattern)
- C# explicit interface impl forwarding (`void IOrderGenerator.Tick() { Tick(); }`) → TS direct method calls (no explicit interface implementation needed)

#### 3.1.1 IOrderGenerator Interface Verification

- [x] **TODO-15.A.1** `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (IOrderGenerator at L1137-1220) — Verify interface completeness against C# source:
  - **C# reference**: `OpenRA.Game/Orders/IOrderGenerator.cs` (30 lines)
  - Verify `MouseButton ActionButton { get; }` property exists or is handled via `handleMouseInput`
  - Verify `IEnumerable<Order> Order(World, CPos, int2, MouseInput)` maps correctly to `order(world, cell, modifiers): Generator<Order>`
  - Verify `void Tick(World)` → `tick(world): void` present
  - Verify `IEnumerable<IRenderable> Render(WorldRenderer, World)` → `renderAboveShroud(renderer, world): void`
  - Verify `IEnumerable<IRenderable> RenderAboveShroud(WorldRenderer, World)` → covered by `renderAboveShroud`
  - Verify `IEnumerable<IRenderable> RenderAnnotations(WorldRenderer, World)` → `renderAnnotations(renderer, world): void` present
  - Verify `string GetCursor(World, CPos, int2, MouseInput)` → `getCursor(world, cell): string`
  - Verify `void Deactivate()` is handled (may be implicit via `cancelInputMode` callback)
  - Verify `bool HandleKeyPress(KeyInput)` → `handleKeyPress(e: unknown): boolean`
  - Verify `void SelectionChanged(World, IEnumerable<Actor>)` → `selectionChanged(world, selected): void`
  - Add `MouseActionType` enum if not already present (values: `Contextual`, `ConfirmOrder`, `PlaceBuilding`, `GlobalCommand`)
  - **Precision requirement**: Interface method signatures must match C# semantics exactly

#### 3.1.2 OrderGenerator (Abstract Base Class)

- [x] **TODO-15.A.2** `src/OpenRA.Mods.Common/Orders/OrderGenerator.ts` (275 lines TS) — Abstract base class for all order generators:
  - **C# reference**: `OpenRA.Mods.Common/Orders/OrderGenerator.cs` (61 lines)
  - `protected abstract actionType: MouseActionType` — abstract property for subclass to define
  - Constructor takes `world: World` and `settings: IMouseSettings` (injected, not global Game.Settings)
  - `actionButton: number` — resolved from settings via `settings.resolveActionButton(this.actionType)`
  - `cancelButton: number` — resolved from settings via `settings.resolveCancelButton(this.actionType)`
  - `order(world, cell, worldPixel, mi): Generator<Order>` — default dispatch:
    - If `mi.button === actionButton && mi.event === 'Down'` → calls abstract `orderInner()`
    - If `mi.button === cancelButton && mi.event === 'Up'` → calls `world.cancelInputMode()`
    - Classic mode: clears selection on construction (via `gameSettings.mouseControlStyle === Classic`)
  - `tick(world): void` — protected virtual, default no-op
  - `renderAboveShroud(renderer, world): void` — protected abstract
  - `renderAnnotations(renderer, world): void` — protected abstract
  - `getCursor(world, cell): string` — protected abstract
  - `orderInner(world, cell, worldPixel, mi): Generator<Order>` — protected abstract
  - `selectionChanged(world, selected): void` — protected virtual, default no-op
  - `handleKeyPress(e: unknown): boolean` — default returns false
  - `deactivate(): void` — default no-op (called when generator is removed)
  - **Precision requirement**: Button dispatch logic (action vs cancel) must match C# event timing exactly

#### 3.1.3 EnterAlliedActorTargeter

- [x] **TODO-15.A.3** `src/OpenRA.Mods.Common/Orders/EnterAlliedActorTargeter.ts` (262 lines TS) — Generic allied-actor enter targeter:
  - **C# reference**: `OpenRA.Mods.Common/Orders/EnterAlliedActorTargeter.cs` (49 lines)
  - Extends `UnitOrderTargeter` (already migrated)
  - C# `EnterAlliedActorTargeter<T> where T : ITraitInfoInterface` → TS: takes `traitKey: string` instead of generic type parameter
  - Constructor params: `order: string`, `priority: number`, `enterCursor: string`, `enterBlockedCursor: string`, `canTarget: (actor, modifiers) => boolean`, `useEnterCursor: (actor) => boolean`
  - `canTargetActor(self, target, modifiers, cursor): boolean`:
    - Checks `self.owner.isAlliedWith(target.owner)` — must be allied
    - Checks `target.info.hasTraitInfo(this.traitKey)` — target must have the required trait
    - Checks `this.canTarget(target, modifiers)` — custom validity delegate
    - Sets cursor to `enterCursor` or `enterBlockedCursor` based on `useEnterCursor(target)`
  - `canTargetFrozenActor(self, target, modifiers, cursor): boolean` → always returns false (allied actors are never frozen)
  - **Precision requirement**: Allied relationship check must match C# diplomacy rules exactly

**Phase A Summary**: 5 item slots (1 interface verify + 2 migrated from Ch11 + 2 new files). ~110 C# lines source, delivered ~537 TS implementation lines (OrderGenerator 275 + EnterAlliedActorTargeter 262) + ~1,103 test lines (2 test files). 59 tests (29 + 30) all passing. Review: APPROVED (R1, 0 BLOCKERs, 0 MAJORs, 3 MINORs). Commit: `cb792bd`. Key deliverable: `OrderGenerator.ts` (TODO-15.A.2) — the abstract base that all Phase B/C generators extend.

---

### 3.2 Phase B: Core Order Generators

**Status**: 📋 PLANNING (4 files pending, 1 already migrated)
**Complexity**: LOW-HIGH (UnitOrderGenerator 224 lines HIGH, others LOW)
**Blocked by**: Phase A (OrderGenerator abstract base — TODO-15.A.2)
**Blocks**: Phase C (GuardOrderGenerator and ForceModifiersOrderGenerator extend UnitOrderGenerator), Chapter 16 (UI widgets use order generators for context-sensitive commands)

**Description**: Phase B implements the concrete order generators that process player input and produce `Order` objects. `UnitOrderGenerator` (224 lines, HIGH) is the critical file — it handles all standard unit commands (attack, move, repair, capture, guard, deploy) by iterating through selected actors, resolving `IOrderTargeter` instances from their `IIssueOrder` traits, and picking the highest-priority matching targeter for the clicked target. The remaining generators are small, focused implementations for specific commands: repair cursor mode, global ability buttons (sell, power down), and beacon placement. `PlaceBuildingOrderGenerator` was already fully migrated in Chapter 11.

**Paradigm Shifts**:
- C# `ScreenMap.ActorsAtMouse(mi)` 2D screen-space hash → TS `ActorMap.getActorsAt(cell)` CPU spatial hash with CoordinateTransformer viewport-to-cell projection
- C# `actors.Where(...).WithHighestSelectionPriority(...)` LINQ chain → TS `Array.filter().reduce()` with explicit priority comparison
- C# `self.TraitsImplementing<IIssueOrder>().SelectMany(trait => trait.Orders)` → TS `self.traitsImplementing('IIssueOrder').flatMap(trait => trait.orders)`
- C# `new UnitOrderResult(self, order, trait, cursor, target)` sealed inner class → TS `{ actor, order, trait, cursor, target }` object literal
- C# `GlobalButtonOrderGenerator<T> where T : class` generic → TS base class with `traitKey: string` constructor parameter
- C# `ChromeMetrics.Get<string>("WorldSelectCursor")` → TS hardcoded default with optional config injection

#### 3.2.1 UnitOrderGenerator

- [ ] **TODO-15.B.1** `src/OpenRA.Mods.Common/Orders/UnitOrderGenerator.ts` (224 lines C#) — Main unit command order generator:
  - **C# reference**: `OpenRA.Mods.Common/Orders/UnitOrderGenerator.cs` (224 lines)
  - Implements `IOrderGenerator` (extends `OrderGenerator` abstract base)
  - `actionType: MouseActionType.Contextual` — right-click by default in standard mouse control
  - `worldSelectCursor: string` — injected cursor name (default `"select"`), from ChromeMetrics
  - `worldDefaultCursor: string` — injected cursor name (default `"default"`), from ChromeMetrics
  - `gameSettings: IMouseSettings` — injected for button resolution and mouse control style
  - **`targetForInput(world, cell, worldPixel, mi): Target`** — click-to-target resolution (static method):
    - Query live actors at mouse position via `world.actorMap.getActorsAt(cell)` or viewport-projected lookup
    - Filter: `!actor.isDead && actor.info.hasTraitInfo('ITargetableInfo') && !world.shroud.fogObscures(actor)`
    - Select highest priority via `.withHighestSelectionPriority(worldPixel, modifiers)` utility
    - If live actor found → `Target.fromActor(actor)`
    - Else query frozen actors → Filter: `frozen.info.hasTraitInfo('ITargetableInfo') && frozen.visible && frozen.hasRenderables` → `Target.fromFrozenActor(frozen)`
    - Else → `Target.fromCell(world, cell)`
  - **`orderForUnit(self, target, xy, mi): UnitOrderResult | null`** — per-actor targeter resolution:
    - Returns null if `self.owner !== world.localPlayer` or `world.isGameOver` or `self.disposed` or `!target.isValidFor(self)`
    - Builds `TargetModifiers` from `mi.modifiers` (Ctrl→ForceAttack, Shift→ForceQueue, Alt→ForceMove)
    - Collects all `IIssueOrder` traits from actor: `self.traitsImplementing('IIssueOrder')`
    - Flattens all `IOrderTargeter` instances and sorts by `orderPriority` descending
    - Cache per `ActorInfo` name to avoid repeated trait enumeration (per ADR-15.6)
    - Two-pass resolution (matching C# behavior): first pass against the actor/frozen-actor target, second pass against the cell target
    - For each targeter: calls `targeter.canTarget(self, target, modifiers, cursor)` — first match wins
    - Returns `{ actor: self, order: targeter, trait: issueOrderTrait, cursor, target }` object literal
  - **`orderInner(world, cell, worldPixel, mi): Generator<Order>`** — main order pipeline:
    - Computes `target = TargetForInput(world, cell, worldPixel, mi)`
    - Maps selected actors through `orderForUnit()`, filters nulls
    - Tracks distinct actors involved
    - Yields `Order("CreateGroup", actorsInvolved[0].owner.playerActor, false, actorsInvolved)` (APM tracking, matches C# HACK comment)
    - For each result: calls `checkSameOrder(result.order, result.trait.issueOrder(result.actor, result.order, result.target, queued))`
  - **`getCursor(world, cell, worldPixel, mi): string`** — cursor resolution:
    - Computes `target = TargetForInput(...)`
    - Classic mouse style: if `!inputOverridesSelection(...)` and target is selectable actor → `worldSelectCursor`
    - Standard style: finds highest-priority order with non-null cursor; if none and target is selectable → `worldSelectCursor`, else cursor from winning order or `worldDefaultCursor`
  - **`inputOverridesSelection(world, xy, mi): boolean`** — whether click should be an order vs selection:
    - Finds actor at mouse (with selection priority)
    - If no actor → returns true (order overrides)
    - For each selected actor: checks if any order `targetOverridesSelection(actor, target, actorsAt, cell, modifiers)`
    - If at least one order overrides → true
  - `clearSelectionOnLeftClick: boolean` — virtual getter, default true
  - `deactivate(): void` — no-op (default generator has no cleanup)
  - **`checkSameOrder(iot, order): Order`** — debug validation that targeter OrderID matches produced OrderString
  - **Precision requirement**: TargetForInput priority order (live actor > frozen actor > cell) must match C# exactly. orderForUnit two-pass resolution must match C# behavior.

#### 3.2.2 RepairOrderGenerator

- [ ] **TODO-15.B.2** `src/OpenRA.Mods.Common/Orders/RepairOrderGenerator.ts` (87 lines C#) — Repair cursor mode generator:
  - **C# reference**: `OpenRA.Mods.Common/Orders/RepairOrderGenerator.cs` (87 lines)
  - Extends `OrderGenerator` (not UnitOrderGenerator — uses simple cell-based repair targeting)
  - `actionType: MouseActionType.GlobalCommand` — global command button mapping
  - **`orderInner(world, cell, worldPixel, mi): Generator<Order>`**:
    - Finds actor under cursor via `world.actorMap.getActorsAt(cell)`: first friendly, non-fog-obscured actor
    - If no actor or actor is undamaged (`getDamageState() === DamageState.Undamaged`) → yield break
    - If `underCursor.info.hasTraitInfo('RepairableBuildingInfo')` → yield `Order("RepairBuilding", localPlayer.playerActor, Target.fromActor(underCursor), false)`
    - If `underCursor.owner !== world.localPlayer` → yield break (don't command allied units past repair-building check)
    - Check `repairable = underCursor.traitOrDefault('Repairable')` → if found, `repairBuilding = repairable.findRepairBuilding(underCursor)`; orderId = `"Repair"`
    - Else check `repairableNear = underCursor.traitOrDefault('RepairableNear')` → if found, `repairBuilding = repairableNear.findRepairBuilding(underCursor)`; orderId = `"RepairNear"`
    - If no repairBuilding found → yield break
    - Yield `Order(orderId, underCursor, Target.fromActor(repairBuilding), Target.fromActor(underCursor), queued)`
  - **`tick(world): void`** — auto-cancels if local player WinState is not Undefined (game over)
  - **`getCursor(world, cell, worldPixel, mi): string`** — returns `"repair"` if `orderInner()` would produce any orders, else `"repair-blocked"`
  - `renderAboveShroud`, `renderAnnotations` → no-op (empty render)
  - **Dependency**: Chapter 11 `RepairableBuilding` trait, Chapter 14 `Repairable`/`RepairableNear` stubs

#### 3.2.3 BeaconOrderGenerator

- [ ] **TODO-15.B.3** `src/OpenRA.Mods.Common/Orders/BeaconOrderGenerator.ts` (39 lines C#) — Beacon placement generator:
  - **C# reference**: `OpenRA.Mods.Common/Orders/BeaconOrderGenerator.cs` (39 lines)
  - Extends `OrderGenerator` — simple one-shot generator
  - `actionType: MouseActionType.PlaceBuilding` — reuses building placement button
  - **`orderInner(world, cell, worldPixel, mi): Generator<Order>`**:
    - Immediately calls `world.cancelInputMode()`
    - Yields `Order("PlaceBeacon", world.localPlayer.playerActor, Target.fromCell(world, cell), false)` with `suppressVisualFeedback = true`
  - `getCursor(world, cell): string` → returns `"ability"`
  - `renderAboveShroud`, `renderAnnotations` → no-op (beacon rendering handled by `Beacon` effect trait)
  - One-shot: deactivates after first click
  - **Dependency**: Chapter 13 `Beacon` trait (beacon order receiver), Chapter 7 Phase E `SpriteEffect` (beacon visual)

#### 3.2.4 GlobalButtonOrderGenerator

- [ ] **TODO-15.B.4** `src/OpenRA.Mods.Common/Orders/GlobalButtonOrderGenerator.ts` (95 lines C#) — Global ability button generator (generic base + 2 concretions):
  - **C# reference**: `OpenRA.Mods.Common/Orders/GlobalButtonOrderGenerator.cs` (95 lines)
  - C# `GlobalButtonOrderGenerator<T> where T : class` → TS: constructor takes `traitKey: string` instead of generic type parameter
  - Extends `OrderGenerator`
  - `actionType: MouseActionType.GlobalCommand`
  - `order: string` — order name (e.g., `"PowerDown"`, `"Sell"`)
  - **`isValidTrait(trait): boolean`** — protected virtual, default `trait.isTraitEnabled()`
  - **`orderInner(world, cell, worldPixel, mi): Generator<Order>`**:
    - Finds actor under cursor: first actor owned by local player with at least one enabled trait matching `traitKey`
    - Yield `Order(this.order, underCursor, false)`
  - **`tick(world): void`** — auto-cancels if local player WinState is not Undefined (game over)
  - `renderAboveShroud`, `renderAnnotations` → no-op
  - **`getCursor(world, cell, worldPixel, mi): string`** — abstract (subclasses override)
  - **`PowerDownOrderGenerator`** concrete subclass:
    - order = `"PowerDown"`, traitKey = `"ToggleConditionOnOrder"`
    - Overrides `isValidTrait(t)`: returns `!t.isTraitDisabled && !t.isTraitPaused`
    - `getCursor`: returns `"powerdown"` if any order produced, else `"powerdown-blocked"`
  - **`SellOrderGenerator`** concrete subclass:
    - order = `"Sell"`, traitKey = `"Sellable"`
    - `getCursor`: iterates `Sellable` traits on order subject, returns first non-null `sellable.info.cursor` or `"sell-blocked"`
  - **Precision requirement**: Dependencies on `ToggleConditionOnOrder` and `Sellable` trait interfaces — define minimal stubs

**Phase B Summary**: 5 item slots (4 new + 1 already migrated). ~445 C# lines source. UnitOrderGenerator (224 lines) is the critical-path file with HIGH complexity. Estimated ~800 TS implementation lines + ~920 test lines.

---

### 3.3 Phase C: Extended Generators

**Status**: 📋 PLANNING (2 files pending)
**Complexity**: LOW (GuardOrderGenerator 85 lines, ForceModifiersOrderGenerator 46 lines)
**Blocked by**: Phase B (UnitOrderGenerator — TODO-15.B.1 — both extend it)
**Blocks**: Nothing critical (optional quality-of-life features)

**Description**: Phase C implements order generators that extend `UnitOrderGenerator` to provide specialized input modes. `GuardOrderGenerator` enters a guard-targeting mode where the player clicks on a friendly unit to assign selected units to guard it. `ForceModifiersOrderGenerator` is a decorator that forces modifier keys (Ctrl for force-attack, Alt for force-move, Shift for queue) and delegates to `UnitOrderGenerator`.

**Paradigm Shifts**:
- C# decorator pattern with `base.OrderInner()` delegation → TS `super.orderInner()` with modified input
- C# `mi.Modifiers |= Modifiers` bitwise OR → TS `modifiers.or(forceModifiers)` class method
- C# `SelectionChanged` callback cancels mode if selection invalid → TS `selectionChanged()` with trait existence check

#### 3.3.1 GuardOrderGenerator

- [ ] **TODO-15.C.1** `src/OpenRA.Mods.Common/Orders/GuardOrderGenerator.ts` (85 lines C#) — Guard command mode generator:
  - **C# reference**: `OpenRA.Mods.Common/Orders/GuardOrderGenerator.cs` (85 lines)
  - Extends `UnitOrderGenerator` — reuses unit targeting infrastructure
  - Constructor takes `world`, `subjects: IGameActor[]`, `orderName: string`, `cursor: string`
  - `actionType: MouseActionType.ConfirmOrder`
  - **`orderInner(world, cell, worldPixel, mi): Generator<Order>`**:
    - Finds first friendly guardable unit via `FriendlyGuardableUnits(world, mi).firstOrDefault()`
    - If no target → yield break
    - `queued = mi.modifiers.hasModifier(Modifiers.Shift)`
    - If not queued → `world.cancelInputMode()`
    - Yield `Order(orderName, null, Target.fromActor(target), queued, null, subjects.filter(s => s !== target))`
  - **`selectionChanged(world, selected): void`**:
    - Filters subjects to non-dead actors with `GuardInfo` trait
    - If no subjects have `AutoTargetInfo` → `world.cancelInputMode()` (guarding needs auto-target)
  - **`getCursor(world, cell, worldPixel, mi): string`**:
    - If no subjects → return null (no cursor)
    - `multiple = subjects.length > 1`
    - `canGuard = FriendlyGuardableUnits(world, mi).some(a => multiple || a !== subjects[0])`
    - Returns `cursor` if canGuard, else `"move-blocked"`
  - `inputOverridesSelection(world, xy, mi): boolean` → always true (custom generators override selection)
  - `clearSelectionOnLeftClick: boolean` → false
  - **`FriendlyGuardableUnits(world, mi): IGameActor[]`** (static helper):
    - Queries actors at mouse: `world.actorMap.getActorsAt(cell)`
    - Filters: not dead, friendly to local player, has `GuardableInfo` trait, not fog-obscured
  - **Dependencies**: `GuardInfo`, `GuardableInfo`, `AutoTargetInfo` trait interfaces — define minimal stubs

#### 3.3.2 ForceModifiersOrderGenerator

- [ ] **TODO-15.C.2** `src/OpenRA.Mods.Common/Orders/ForceModifiersOrderGenerator.ts` (46 lines C#) — Modifier key passthrough decorator:
  - **C# reference**: `OpenRA.Mods.Common/Orders/ForceModifiersOrderGenerator.cs` (46 lines)
  - Extends `UnitOrderGenerator` — decorator pattern with forced modifier keys
  - Constructor takes `world`, `modifiers: TargetModifiers`, `cancelOnFirstUse: boolean`
  - `actionType: MouseActionType.ConfirmOrder`
  - **`orderInner(world, cell, worldPixel, mi): Generator<Order>`**:
    - `mi.modifiers = mi.modifiers.or(this.modifiers)` — force OR the modifiers into input
    - If `cancelOnFirstUse && !mi.modifiers.hasModifier(Modifiers.Shift)` or `mi.button === cancelButton` → `world.cancelInputMode()`
    - Delegates to `super.orderInner(world, cell, worldPixel, modifiedMi)`
  - **`getCursor(world, cell, worldPixel, mi): string`**:
    - `mi.modifiers = mi.modifiers.or(this.modifiers)`
    - Returns `super.getCursor(world, cell, worldPixel, modifiedMi)`
  - `clearSelectionOnLeftClick: boolean` → false (prevents deselection during force-modifier mode)
  - Used by: force-attack (Ctrl+click → `ForceModifiersOrderGenerator(world, Modifiers.Ctrl, true)`), force-move (Alt+click), queued orders (Shift+click)

**Phase C Summary**: 2 files, ~131 C# lines source. Both extend UnitOrderGenerator. Estimated ~230 TS implementation lines + ~380 test lines.

---

## 4. Dependency Graph

```
Chapters 2-14 (COMPLETE -- Foundation)
  |
  +--> TraitsInterfaces.ts (IOrderGenerator, IOrderTargeter, IIssueOrder -- DONE)
  |     |
  |     +--> Phase A: OrderGenerator.ts (abstract base, TODO-15.A.2)
  |     |     |
  |     |     +--> Phase B: UnitOrderGenerator.ts (TODO-15.B.1)
  |     |     |     |
  |     |     |     +--> Phase C: GuardOrderGenerator.ts (TODO-15.C.1)
  |     |     |     +--> Phase C: ForceModifiersOrderGenerator.ts (TODO-15.C.2)
  |     |     |
  |     |     +--> Phase B: RepairOrderGenerator.ts (TODO-15.B.2)
  |     |     +--> Phase B: BeaconOrderGenerator.ts (TODO-15.B.3)
  |     |     +--> Phase B: GlobalButtonOrderGenerator.ts (TODO-15.B.4)
  |     |
  |     +--> UnitOrderTargeter.ts (abstract, DONE from Ch11)
  |     |     |
  |     |     +--> DeployOrderTargeter.ts (DONE from Ch11)
  |     |     +--> Phase A: EnterAlliedActorTargeter.ts (TODO-15.A.3)
  |     |
  |     +--> Chapter 5 Phase E: WorldInteractionControllerWidget (manages generator lifecycle -- DONE)
  |     +--> Chapter 6 Phase A: Order, UnitOrders, OrderManager (order objects -- DONE)
  |
  +--> Chapter 8: Combat traits (IIssueOrder implementations: Armament, AttackBase -- DONE)
  |     +--> Phase B: UnitOrderGenerator (iterates IIssueOrder traits, TODO-15.B.1)
  |
  +--> Chapter 9: Movement (Mobile, Aircraft -- movement orders -- DONE)
  +--> Chapter 10: Resources (Harvester, PlayerResources -- economy orders -- DONE)
  +--> Chapter 11: Building (RepairableBuilding, PlaceBuilding -- building orders -- DONE)
  |     +--> PlaceBuildingOrderGenerator.ts (DONE from Ch11)
  |     +--> Phase B: RepairOrderGenerator (TODO-15.B.2, uses RepairableBuilding)
  |     +--> Phase B: GlobalButtonOrderGenerator (TODO-15.B.4, uses ToggleConditionOnOrder, Sellable)
  |
  +--> Chapter 12: Shroud (FrozenActorLayer, visibility -- DONE)
  |     +--> UnitOrderGenerator.targetForInput() uses fog-obscured actor filtering
  |
  +--> Chapter 13: Support Powers (Beacon trait -- DONE)
  |     +--> Phase B: BeaconOrderGenerator (TODO-15.B.3, issues PlaceBeacon orders)
  |
  +--> Chapter 14: Activities (Repairable, RepairableNear, Guardable, Guard -- DONE/STUB)
        +--> Phase B: RepairOrderGenerator (uses Repairable/RepairableNear stubs)
        +--> Phase C: GuardOrderGenerator (uses GuardInfo/GuardableInfo stubs)
```

### Critical Path

```
Phase A (OrderGenerator.ts) → Phase B (UnitOrderGenerator.ts) → Phase C (GuardOrderGenerator, ForceModifiersOrderGenerator)
Phase A (EnterAlliedActorTargeter.ts) — parallel with Phase B
Phase B (RepairOrderGenerator, GlobalButtonOrderGenerator, BeaconOrderGenerator) — parallel after OrderGenerator.ts
```

### Parallelization Opportunities

- **Phase A**: `OrderGenerator.ts` (TODO-15.A.2) and `EnterAlliedActorTargeter.ts` (TODO-15.A.3) are independent and can be parallel-assigned
- **Phase B after OrderGenerator.ts**: RepairOrderGenerator, BeaconOrderGenerator, GlobalButtonOrderGenerator can all be parallel-assigned (independent of each other, all extend OrderGenerator)
- **UnitOrderGenerator (TODO-15.B.1)**: Must be completed before Phase C starts, but Phase B's other 3 generators can proceed in parallel
- **Phase C after UnitOrderGenerator**: GuardOrderGenerator and ForceModifiersOrderGenerator can be parallel-assigned

### Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| OrderGenerator.ts | Must be migrated before ANY concrete generator (all extend it) |
| UnitOrderGenerator.ts | Must be migrated before GuardOrderGenerator and ForceModifiersOrderGenerator |
| EnterAlliedActorTargeter.ts | Extends already-migrated UnitOrderTargeter — can start immediately |
| UnitOrderTargeter.ts (DONE) | Already available; required by EnterAlliedActorTargeter |
| WorldInteractionControllerWidget | Already manages IOrderGenerator lifecycle; verify API compatibility |
| ActorMap | Used by targetForInput() for actor-at-cell lookup; verify `getActorsAt(cell)` method exists |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering order generation logic MUST have unit tests. Key test patterns:

- [ ] **TEST-15.1** `OrderGenerator` abstract base: verify `order()` dispatches to `orderInner()` on action button Down; verify `order()` cancels input mode on cancel button Up; verify Classic mode clears selection on construction; verify default `tick()`, `selectionChanged()` are no-ops
- [ ] **TEST-15.2** `UnitOrderGenerator.targetForInput()`: verify priority order — live actor (not dead, has ITargetable, not fog-obscured) > frozen actor (visible, has renderables, has ITargetable) > cell target. Verify dead actors and fog-obscured actors are filtered out
- [ ] **TEST-15.3** `UnitOrderGenerator.orderForUnit()`: verify targeter selection by priority — highest priority matching targeter wins; verify two-pass resolution (actor-target pass first, cell-target pass second); verify null return when actor is dead/disposed/not-local-player
- [ ] **TEST-15.4** `UnitOrderGenerator.orderInner()`: verify "CreateGroup" order is always yielded first; verify distinct actors are tracked correctly; verify `checkSameOrder` validation
- [ ] **TEST-15.5** `UnitOrderGenerator.getCursor()`: verify cursor returns `worldSelectCursor` for selectable actors; verify cursor returns winning order's cursor when an order matches; verify `worldDefaultCursor` for empty ground
- [ ] **TEST-15.6** `EnterAlliedActorTargeter.canTargetActor()`: verify allied check (enemy rejected, neutral rejected, ally accepted); verify trait type check via `hasTraitInfo`; verify `canTarget` delegate filters; verify cursor returns `enterCursor` vs `enterBlockedCursor`
- [ ] **TEST-15.7** `EnterAlliedActorTargeter.canTargetFrozenActor()`: verify always returns false (allies never frozen)
- [ ] **TEST-15.8** `RepairOrderGenerator`: verify repair order targets building at cell; verify undamaged actor yields no order; verify `RepairableBuilding` path produces "RepairBuilding" order; verify `Repairable` path produces "Repair" order; verify `RepairableNear` path produces "RepairNear" order; verify `tick()` auto-cancels when game over
- [ ] **TEST-15.9** `BeaconOrderGenerator`: verify single-click emits `PlaceBeacon` order with `suppressVisualFeedback`; verify input mode cancelled after order; verify render methods are no-ops; verify cursor returns `"ability"`
- [ ] **TEST-15.10** `GlobalButtonOrderGenerator`: verify `orderInner` finds first actor with enabled trait; verify `PowerDownOrderGenerator.getCursor` returns `"powerdown"` or `"powerdown-blocked"`; verify `SellOrderGenerator.getCursor` returns sellable cursor or `"sell-blocked"`; verify `tick()` auto-cancels when game over
- [ ] **TEST-15.11** `GuardOrderGenerator`: verify guard order targets friendly guardable unit; verify queued execution (Shift modifier); verify `selectionChanged` cancels mode when no Guard/AutoTarget traits in selection; verify `FriendlyGuardableUnits` filters dead/fog-obscured/enemy actors; verify cursor returns `"move-blocked"` when no valid guard targets
- [ ] **TEST-15.12** `ForceModifiersOrderGenerator`: verify forced modifiers are OR'd into mouse input; verify `cancelOnFirstUse` deactivates after first non-shift order; verify `clearSelectionOnLeftClick` is false; verify `super.orderInner()` receives modified input
- [ ] **TEST-15.13** `DeployOrderTargeter` (existing, verify): verify target must be the issuing actor; verify `cursorFn` returns correct cursor for deployable state
- [ ] **TEST-15.14** `UnitOrderTargeter` (existing, verify): verify relationship filtering (enemy targeters can only target enemies, allied targeters can only target allies); verify `forceAttack` constraint (null=either, true=must, false=must-not)

### 5.2 Per-Phase Test File Estimates

| Phase | Files | New Test Files | Estimated New Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Foundation | 2 new | 2 | ~25 | ~350 |
| B: Core Generators | 4 new | 4 | ~45 | ~920 |
| C: Extended Generators | 2 new | 2 | ~15 | ~380 |
| Already complete (Ch11) | 3 + 3 tests (existing) | 0 new | 0 new | 0 (review only) |
| **Total** | **8 new + 3 existing** | **8 new** | **~85** | **~1,650** |

### 5.3 Visual Acceptance Testing

Rendering-heavy generators require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Building placement preview | `/test/orders/place-building/` | Verify ghost mesh positioning, color coding (green/red), footprint alignment (already built in Ch11 — Chapter 15 review) |
| Beacon placement | `/test/orders/beacon/` | Verify beacon marker appears at target cell, auto-deactivation after placement |
| Repair cursor mode | `/test/orders/repair/` | Verify repair cursor icon, valid/invalid target highlighting |
| Guard command | `/test/orders/guard/` | Verify guard cursor, guard line rendering, queued order chaining |

### 5.4 Integration Testing

- [ ] **TEST-15.I1** Full order pipeline: click on map → `UnitOrderGenerator.order()` → `targetForInput()` → `orderForUnit()` → `IIssueOrder.issueOrder()` → `OrderManager.issueOrder()` → `Order` dispatched. Verify for attack, move, repair, deploy orders.
- [ ] **TEST-15.I2** Force-modifier pipeline: Ctrl+click (force-attack) → `ForceModifiersOrderGenerator` forces modifiers → `UnitOrderGenerator.orderInner()` sees modified modifiers → correct `IOrderTargeter` (force-fire targeter) matches.
- [ ] **TEST-15.I3** Order generator lifecycle: activate generator → verify `WorldInteractionControllerWidget` routes input → generator produces order → generator deactivates → verify no more input routing.

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **UnitOrderGenerator complexity** (224 lines, deep integration) | HIGH | The central generator touches ScreenMap, IIssueOrder trait enumeration, TargetModifiers, cursor resolution, InputOverridesSelection, and Selection.Actors. Bugs here break ALL right-click orders. | Port line-for-line; test orderForUnit with mocked IIssueOrder traits returning predictable results; validate target resolution priority chain against C# reference with test data |
| **ScreenMap absence** (no 2D pixel-hash in TS) | HIGH | All generators use `ScreenMap.ActorsAtMouse()` for target resolution. The TS codebase has ActorMap at cell granularity, not pixel-precise bounding rectangles. | ADR-15.2: Use CPU-side ActorMap with cell-level lookup. For overlapping actors in same cell, add secondary 3D screen-projected position check. Cell granularity is sufficient for RTS gameplay. |
| **IOrderTargeter priority resolution** (integer priority comparison) | MEDIUM | Wrong targeter selected for multi-use target (e.g., attack vs capture the same building) | Port priority sorting exactly from C#; verify with multiple targeters at same priority level; two-pass resolution must match C# |
| **Modifier key handling differences** (C# flags enum → TS class) | MEDIUM | Force-attack/force-move don't work correctly, breaking micro-intensive gameplay | Port `TargetModifiers` bitwise logic exactly; verify Ctrl/Shift/Alt combinations produce correct TargetModifiers in ForceModifiersOrderGenerator |
| **Missing trait interfaces** (Repairable, Guardable, Guard, Sellable, ToggleConditionOnOrder) | MEDIUM | Order generators reference traits that may only exist as stubs in Chapter 14 | Define minimal interfaces in TraitsInterfaces.ts supplement. Only the methods accessed by generators need stubs (e.g., `findRepairBuilding()`, `isTraitEnabled()`). Full trait implementations not needed. |
| **Order generator lifecycle leak** (deactivate() not called) | MEDIUM | Ghost meshes persist after generator deactivation, leaking GPU memory | Enforce dispose pattern in deactivate(); add test verifying all scene children removed after deactivation |
| **Cursor feedback lag** (getCursor() called every frame) | LOW | Cursor flickers or lags during rapid mouse movement | Cache cursor result per frame; only recompute on cell change (pointermove to new cell) |
| **WinState dependency** (RepairOrderGenerator, GlobalButtonOrderGenerator tick) | LOW | Both generators check `WinState` in tick() to auto-cancel on game end | Use injected `isGameOver(): boolean` callback (ADR-15.4) instead of coupling to WinState type |
| **GlobalButtonOrderGenerator generic type mapping** (C# generics → TS) | LOW | C# generic `T : class` constraint is compile-time; TS uses runtime string keys | Use `traitKey: string` constructor parameter instead of generic type parameter. Simpler, same result. |
| **BeaconOrderGenerator one-shot behavior** | LOW | Beacon placed on wrong cell with no undo | Match C# behavior exactly: cancel input mode immediately after yielding order |
| **All existing migrated files compatibility** (3 files from Ch11) | LOW | Chapter 11 implementations use slightly different interfaces than what Chapter 15 expects | Review existing PlaceBuildingOrderGenerator, DeployOrderTargeter, UnitOrderTargeter against IOrderGenerator/IOrderTargeter interfaces; update if needed |
| **GuardOrderGenerator AutoTarget dependency** | LOW | Guarding requires AutoTarget trait on selected units; trait check may not work if stubbed | Stub the trait check — assume all selected actors have required traits initially. Add TODO for full implementation. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-15.1: OrderGenerator as Command Pattern

- **Decision**: Order generators implement the Command pattern: `getCursor()` returns the current cursor state, `order()` converts a click target into `Order` objects, `handleKeyPress()` intercepts keyboard input. The generator lifecycle (activation/deactivation) is managed by `WorldInteractionControllerWidget` (Chapter 5 Phase E).
- **Rationale**: This matches OpenRA's existing pattern where each "input mode" is a separate `IOrderGenerator` implementation. The `WorldInteractionControllerWidget` already provides the activation/deactivation infrastructure via `world.orderGenerator` property. Button resolution is centralized in `OrderGenerator` abstract base using `MouseActionType` → mouse button mapping from game settings.
- **Mitigation**: All generators implement the `IOrderGenerator` interface (already defined in `TraitsInterfaces.ts`). The `OrderGenerator` abstract base provides default implementations for tick, render, handleKeyPress, selectionChanged, and deactivate.

### ADR-15.2: Target Resolution Strategy — CPU Spatial Hash over GPU Raycasting

- **Decision**: Use a CPU-side spatial hash (extending the existing `ActorMap` from Chapter 3) for target resolution in `targetForInput()`, NOT Babylon.js `scene.pick()` GPU raycasting.
- **Rationale**:
  1. **Determinism**: CPU spatial hash is deterministic across browsers and GPU vendors. GPU raycasting precision varies.
  2. **Non-rendered actors**: Order generators need to find actors that may not be rendered (out of view, under fog). GPU pick only hits rendered meshes.
  3. **Performance**: Spatial hash lookup is O(1) per query with no GPU readback stall. GPU pick requires synchronous readback (1-2ms on integrated GPUs).
  4. **Frozen actors**: Under fog of war, enemy actors are replaced with "frozen" placeholders that have no 3D mesh. The CPU spatial hash stores these separately.
  5. **Parity with OpenRA**: The CPU spatial hash approach mirrors the original C# `ScreenMap` architecture, reducing subtle behavioral differences.
- **Consequences**: Cell-level granularity for target resolution (not pixel-precise bounding rectangles). For the rare case where two actors overlap in the same cell, a secondary 3D screen-projected position check can disambiguate.

### ADR-15.3: PlaceBuilding Visual Preview — Deferred 3D Ghost Rendering

- **Decision**: **Defer full 3D building preview to Chapter 19 (Mod-Specific Content)**. For Chapter 15, use the existing stub pattern with `IPlaceBuildingPreview` interface already defined in the migrated `PlaceBuildingOrderGenerator.ts`.
- **Rationale**:
  1. `IPlaceBuildingPreviewGeneratorInfo` and `IPlaceBuildingPreview` are mod-specific — C&C uses `SpriteSequencePreview`, D2K uses `D2kActorPreviewPlaceBuildingPreview`. Neither has a generic implementation.
  2. The migrated `PlaceBuildingOrderGenerator.ts` already handles null previews gracefully.
  3. The footprint cell coloring (valid/invalid/line-build) is already computed and passed to the preview renderer.
- **Consequences**: Building placement works immediately with existing code. Mod-specific previews are added later without changing the order generator interface. A generic fallback (flat colored planes at footprint cells) can be added if visual feedback is needed before Chapter 19.

### ADR-15.4: OrderGenerator Lifecycle Management — Callback Injection

- **Decision**: The TS architecture uses callback injection at construction time (`OrderGeneratorContext`) rather than C# global `Game.Settings` / `world.CancelInputMode()` direct calls.
- **Design**:
  ```typescript
  interface OrderGeneratorContext {
    cancelInputMode(): void;
    isGameOver(): boolean;
    getModifiers(): Modifiers;
    settings: IMouseSettings;
    sound?: ISoundPlayer;
  }
  ```
- **Rationale**: The existing `PlaceBuildingOrderGenerator.ts` (Chapter 11) already follows this pattern. Constructor injection makes generators testable with mock dependencies and avoids hidden coupling to global state.
- **Consequences**: All generators accept a `context: OrderGeneratorContext` parameter. Unit tests create mock contexts. Clean separation between generator logic and world environment.

### ADR-15.5: Cursor State Mapping — Logical Names to CSS

- **Decision**: Map logical cursor name strings returned by generators (`"repair"`, `"move-blocked"`, `"powerdown"`, etc.) to CSS `cursor` values via a central mapping table. Custom cursors use CSS `cursor: url(...)` with pre-exported PNG cursor sprite sheets.
- **Design**:
  ```typescript
  const CURSOR_CSS_MAP: Record<string, string> = {
    'default': 'default',
    'select': 'pointer',
    'attack': 'crosshair',
    'move': 'move',
    'move-blocked': 'not-allowed',
    'repair': 'pointer',          // custom via CSS url()
    'repair-blocked': 'not-allowed',
    'powerdown': 'pointer',
    'powerdown-blocked': 'not-allowed',
    'sell': 'pointer',
    'sell-blocked': 'not-allowed',
    'ability': 'crosshair',
    'guard': 'pointer',           // custom via CSS url()
    'enter': 'cell',
    'enter-blocked': 'not-allowed',
    'deploy': 'pointer',
  };
  ```
- **Rationale**: OpenRA's `ChromeMetrics` cursor system is a 2D sprite-sheet coordinate lookup. In the browser, CSS `cursor` property with `url()` is the direct equivalent. Logical names separate cursor logic (in the order generator) from cursor rendering (in CSS).
- **Consequences**: Custom cursor sprite sheets need to be exported as PNG files (part of the build-time asset pipeline). Large cursors (>32x32) may need JavaScript-based custom rendering (HTML overlay element), matching the existing `CursorManager.ts` approach.

### ADR-15.6: UnitOrderGenerator Performance — Per-ActorInfo Order Cache

- **Decision**: Cache the ordered list of `IIssueOrder` traits per `ActorInfo` name (not per actor instance) since the trait list is static per actor type. Only re-sort when the mod manifest changes.
- **Design**:
  ```typescript
  const orderCache = new Map<string, Array<{ trait: IIssueOrder, order: IOrderTargeter }>>();
  function getOrdersForActorInfo(actorInfo: ActorInfo): Array<...> {
    let cached = orderCache.get(actorInfo.name);
    if (!cached) {
      cached = actorInfo.traitInfos<IIssueOrder>()
        .flatMap(trait => trait.orders.map(order => ({ trait, order })))
        .sort((a, b) => b.order.orderPriority - a.order.orderPriority);
      orderCache.set(actorInfo.name, cached);
    }
    return cached;
  }
  ```
- **Rationale**: All actors of the same type (e.g., "e1" Rifle Infantry) have identical IIssueOrder traits in the same priority order. Caching avoids repeated trait enumeration and sorting. For a selection of 50 identical tanks, this is a 50x speedup.
- **Consequences**: Cache invalidated on mod switch (rare). Cache uses actor type name as key (stable string).

### ADR-15.7: GlobalButtonOrderGenerator — String-Based Trait Key over TypeScript Generics

- **Decision**: C# `GlobalButtonOrderGenerator<T> where T : class` is ported as a TypeScript class that takes `traitKey: string` in its constructor instead of using a TypeScript generic type parameter.
- **Rationale**: In C#, the generic type parameter `T` is used with `TraitsImplementing<T>()` for compile-time trait type resolution. In TypeScript, trait lookup is by string key (`traitsImplementing('Sellable')`). A string parameter achieves the same result without the complexity of TypeScript generics at the class level.
- **Consequences**: `PowerDownOrderGenerator` passes `"ToggleConditionOnOrder"`, `SellOrderGenerator` passes `"Sellable"`. Simpler than C# generics, functionally equivalent.

---

## Migration Order and Phasing Strategy

| Step | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A | 1 | IOrderGenerator interface verification (TODO-15.A.1) — verify TraitsInterfaces.ts completeness | YES (with step 2) |
| 2 | Phase A | 1 | OrderGenerator.ts abstract base (TODO-15.A.2, 61 lines) | After step 1 |
| 3 | Phase A | 1 | EnterAlliedActorTargeter.ts (TODO-15.A.3, 49 lines) | YES (with step 2, extends already-migrated UnitOrderTargeter) |
| 4 | Phase B | 1 | UnitOrderGenerator.ts (TODO-15.B.1, 224 lines, HIGH) — the critical file | After step 2 |
| 5 | Phase B | 3 | RepairOrderGenerator.ts + BeaconOrderGenerator.ts + GlobalButtonOrderGenerator.ts (after step 2) | YES (all 3 parallel with step 4) |
| 6 | Phase C | 2 | GuardOrderGenerator.ts + ForceModifiersOrderGenerator.ts (after step 4) | YES (both parallel) |
| 7 | Integration | — | Review existing Ch11 migrated files; end-to-end pipeline tests | After steps 4-6 |

**Total estimated**: ~5-7 days (single developer). With parallelization, ~3-5 days.

| Metric | Count |
|--------|-------|
| **Total files** | 11 (8 new + 3 already migrated from Ch11) |
| **New TypeScript implementation lines** | ~1,230 |
| **New test lines** | ~1,650 |
| **Estimated tests** | ~85 new |
| **Visual acceptance test pages** | 3 new (beacon, repair, guard) + 1 review (place-building) |
| **ADR records** | 7 (ADR-15.1 through ADR-15.7) |
