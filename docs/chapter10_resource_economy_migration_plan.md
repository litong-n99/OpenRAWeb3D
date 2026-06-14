# OpenRA to Babylon.js Migration Plan: Chapter 10 -- Resource & Economy System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.4 (Traits -- Harvester, ResourceLayer, Economy)
> **Chapter Status**: COMPLETE (ALL PHASES A-B COMPLETE: 17 core files, 769 tests, ~7,365 TS lines; 8 optional files PLANNING; Phase B R2 pending)
> **Planning Date**: 2026-06-13 | **Updated**: 2026-06-14 (Phase B COMPLETE)
> **Prerequisite**: Chapters 2-9 COMPLETE (249/249, 100%)
>
> ### Completion Summary (Target)
>
> | Phase | Files | TS Lines (est.) | Tests (est.) | Commits | Review Rounds |
> |:---|:---:|:---:|:---:|:---:|:---:|
> | A: Resource Infrastructure | 8 | ~4,965 | ~3,960 (7 files, 344 tests) | 6 | 2 (R1 + R2) |
> | B: Economy Support Traits | 11 | ~2,400 | ~2,900 (11 files, 425 tests) | 6 | 1 (R1 resolved, R2 pending) |
> | B-optional: Extended Economy Traits | 8 | ~1,300 | ~35 | TBD | TBD |
> | **Total** | **17** | **~7,365** | **~769** | **12** | **TBD** |
>
> **Deferred**: 1 file (FindAndDeliverResources Activity -- implementation deferred to Chapter 14 Phase D). 3 inner order-targeter classes deferred to Chapter 15 (HarvestOrderTargeter, SellOrderTargeter).
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Resource Infrastructure](#31-phase-a-resource-infrastructure)
   - 3.2 [Phase B: Economy Support Traits](#32-phase-b-economy-support-traits)
   - 3.3 [Phase B-Optional: Extended Economy Traits](#33-phase-b-optional-extended-economy-traits)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Resource & Economy System is the **first economy-focused chapter**. Unlike previous chapters which established combat (Ch8: Weapons & Combat) and movement (Ch9: Unit Movement & Physics), Chapter 10 implements the core RTS resource loop -- resources exist on the map as terrain-attached deposits, harvesters collect them, deliver them to refineries, and the player's economy (cash + stored resources) drives production and building.

The core paradigm shift: **from 2D cell-based resource overlay to 3D terrain-attached billboard rendering**:

- **ResourceLayer.CellLayer<ResourceLayerContents>** maps to TypeScript `CellLayer<{ type: string, density: number }>` using the existing Chapter 4 `CellLayer` infrastructure with immutable data records.
- **ResourceRenderer.TerrainSpriteLayer** uses the existing Chapter 2 `TerrainSpriteLayer` for resource sprite rendering at cell centers with height offset from `CellRamp` data. Resource sprites are billboard quads positioned on the 3D terrain mesh via `CoordinateTransformer.cellToVector3()`.
- **Harvester.FindAndDeliverResources** Activity is deferred to Chapter 14 Phase D. Chapter 10 provides factory methods returning Activity stubs. The `Harvester` trait itself (330 lines) is fully implemented in Ch10, including resource search, capacity management, speed modification, and order handling.
- **PlayerResources** dual-resource system (Cash + Resources) replaces the C# thread-safe `[Sync]` field pattern with TypeScript `Sync` trait registration (Ch6 Phase B). Resource capacity management uses `AddStorageCapacity`/`RemoveStorageCapacity` via `StoresPlayerResources` bridges.
- **Refinery.AcceptResources()** maps to the TypeScript `IAcceptResources` interface with two modes: UseStorage (deposit into silo) and direct cash conversion. Floating text ticks render as Babylon.js GUI text billboards.

This chapter builds on the actor framework from Chapter 3 (GameActor, TraitDictionary, ITick, INotifyCreated, INotifyOwnerChanged), the coordinate primitives from Chapter 3 Phase A (CPos, CVec, WPos, WDist), the map and CellLayer infrastructure from Chapter 4 (Map, CellLayer, CellRegion, MapGrid, TerrainInfo), the CoordinateTransformer from Chapter 4 Phase I, the FileSystem and MOD system from Chapter 5, the Order system from Chapter 6 Phase A (Order, IResolveOrder, IIssueOrder), the Sync system from Chapter 6 Phase B, the Rendering primitives from Chapter 2 (TerrainSpriteLayer, Sprite, Sheet, Animation), the CombatInterfaces from Chapter 8 Phase D (IHealth, DamageState), and the Movement interfaces from Chapter 9 (IMove, Mobile).

### 1.2 Architecture Principles

1. **ResourceCellLayer as ground truth**: `ResourceLayer.CellLayer<ResourceLayerContents>` is the authoritative data store. Each cell stores a resource type string and density byte. The `Map.Resources` CellLayer (byte-based resource indices from map.bin) provides the initial map-authored resource layout; `ResourceLayer` provides the runtime mutable layer with types and densities.

2. **TerrainSpriteLayer for resource rendering**: All resource sprites are rendered through the existing Chapter 2 `TerrainSpriteLayer` infrastructure. Resource cells are positioned at 3D cell centers with height offset from `CellRamp` data, creating proper terrain-following billboards. The `Variant` system allows each resource type to have multiple sprite sequence variants selected randomly per cell.

3. **Harvester is a DockClientBase subclass**: `Harvester` inherits from `DockClientBase<HarvesterInfo>`, a new abstract base class that must be migrated as part of Phase A. The docking Activity (MoveToDock, Dock) is deferred to Chapter 14; Chapter 10 provides the trait-level docking callbacks (`CanDock`, `OnDockStarted`, `OnDockTick`, `OnDockCompleted`).

4. **Resource economy is dual-currency**: `PlayerResources` manages both Cash (simple integer) and stored Resources (keyed by resource type string). Cash is directly spendable for production; stored resources are capacity-limited and consumed in production queues. Overflow protection uses `Number.isSafeInteger()` checks.

5. **ResourceClaimLayer prevents harvester contention**: A simple bidirectional mapping prevents multiple harvesters from the same player from targeting the same resource cell simultaneously. This is a World trait that all harvesters query before committing to a harvest target.

6. **Economy support traits are event-driven**: `GivesBounty` reacts to `INotifyKilled`, `GivesCashOnCapture` reacts to `INotifyCapture`, `DeliversCash`/`AcceptsDeliveredCash` coordinate through the order system, and `Sellable` integrates with `IResolveOrder` for the Sell order. All follow the standard OpenRA trait communication pattern already established in Chapters 3, 6, and 8.

7. **IAcceptResources is the central refinery interface**: Any building that accepts resources implements `IAcceptResources`. The `Refinery` trait is the primary implementation, handling both UseStorage mode (deposit into silos) and direct-cash mode. The interface is defined in `TraitsInterfaces.ts` alongside the existing trait interfaces.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-9 is available for Chapter 10:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, `TerrainSpriteLayer`, sprite rendering |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, `AnimationWithOffset`, `SequenceProvider` |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `INotifyKilled`, `INotifyOwnerChanged`, `INotifyCapture` |
| Activity base class | Ch3 Phase F | `Activity` abstract class + `ActivityRunner` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Coordinate Primitives | Ch3 Phase A | `CPos`, `CVec`, `WPos`, `WVec`, `WAngle`, `WDist`, `WRot` |
| Map + Terrain + CellLayer | Ch4 | `Map`, `CellLayer`, `CellRegion`, `TerrainInfo`, `MapGrid`, `CellRamp` |
| Pathfinding | Ch4 Phase G | `HierarchicalPathFinder`, `PathSearch`, `DensePathGraph`, `CellInfo` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space conversion |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| Widget core | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager`, `IResolveOrder`, `IIssueOrder` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Keycode`, `Viewport`, `SelectionUtils` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` (cash tick, harvest sounds) |
| Render traits | Ch7 Phase G | `RenderSprites`, `WithIdleOverlay`, `WithSpriteBody` |
| Turreted | Ch8 Phase E | `Turreted` trait (docking vehicle rotation toward refinery) |
| CombatInterfaces | Ch8 Phase D | `DamageState`, `IHealth`, combat enums |
| Armament + AttackBase | Ch8 Phase D | Weapon system (resource-based combat interaction -- e.g., DestroyResourceWarhead from Ch8 Phase A already migrated) |
| DestroyResourceWarhead | Ch8 Phase A | Warhead that destroys resources on impact (interacts with `ResourceLayer.RemoveResource()`) |
| CreateResourceWarhead | Ch8 Phase A | Warhead that creates resources on impact (interacts with `ResourceLayer.AddResource()`) |
| Mobile + IMove | Ch9 Phase A | `Mobile`, `IMove` interface (Harvester uses IMove to navigate to resources and refineries) |
| PathFinder | Ch9 Phase A | `PathFinder` trait (Harvester uses PathFinder to find routes to resources) |
| Locomotor | Ch9 Phase A | `Locomotor` with cell blocking (Harvester occupies cells while harvesting) |
| Aircraft | Ch9 Phase B | `Aircraft` (airborne resource transport if applicable) |

**NOT YET MIGRATED (blocking dependencies)**:

| System | OpenRA File | Status | Impact on Ch10 |
|--------|:---|:---|:---|
| BuildingInfluence | `OpenRA.Mods.Common/Traits/BuildingInfluence.cs` | NOT MIGRATED | `ResourceLayer` depends on `BuildingInfluence` to check if buildings block resource spawning |
| DockClientBase | `OpenRA.Mods.Common/Traits/DockClientBase.cs` | NOT MIGRATED | `Harvester` inherits from `DockClientBase<HarvesterInfo>` |
| IDockHost | `TraitsInterfaces.cs` (IDockHost) | NOT MIGRATED | `Refinery` requires `IDockHostInfo` for docking coordination |
| WithSpriteBody | `OpenRA.Mods.Common/Traits/Render/WithSpriteBody.cs` | NOT MIGRATED | `Refinery` requires `WithSpriteBodyInfo` for building sprite rendering |

> **Note**: `BuildingInfluence` is a Chapter 11 Phase B dependency (Building System). For Chapter 10 Phase A, `ResourceLayer` can be initially implemented without `BuildingInfluence` integration (buildings simply don't block resource spawning). `DockClientBase` must be migrated as part of Chapter 10 Phase A since `Harvester` directly inherits from it. `IDockHost` interface must be added to `TraitsInterfaces.ts`. `WithSpriteBody` is a render trait from Chapter 7 Phase G -- if not yet migrated, `Refinery` can accept a stub.

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (25 files across 2 Phases + 1 Optional Group)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Resource Infrastructure (COMPLETED 2026-06-14)** | | | | TS Lines | | |
| 0 | `OpenRA.Mods.Common/Traits/DockClientBase.cs` | `src/OpenRA.Mods.Common/Traits/DockClientBase.ts` | `DockClientBase<T>` (COMPLETED) | 385 | MEDIUM | A |
| 0b | `TraitsInterfaces.cs` (IDockHost, IAcceptResources, IResourceLayer, IResourceRenderer, IStoresResources) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (expand existing) | `IDockHost`, `IAcceptResources`, `IResourceLayer`, `IResourceRenderer`, `IStoresResources` (COMPLETED +497 lines) | +497 | LOW | A |
| 1 | `OpenRA.Mods.Common/Traits/Harvester.cs` | `src/OpenRA.Mods.Common/Traits/Harvester.ts` | `Harvester` (COMPLETED) | 1,075 | HIGH | A |
| 2 | `OpenRA.Mods.Common/Traits/World/ResourceLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/ResourceLayer.ts` | `ResourceLayer` (COMPLETED) | 799 | MEDIUM | A |
| 3 | `OpenRA.Mods.Common/Traits/World/ResourceRenderer.cs` | `src/OpenRA.Mods.Common/Traits/World/ResourceRenderer.ts` | `ResourceRenderer` (COMPLETED) | 1,106 | MEDIUM | A |
| 4 | `OpenRA.Mods.Common/Traits/World/ResourceClaimLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/ResourceClaimLayer.ts` | `ResourceClaimLayer` (COMPLETED) | 240 | LOW | A |
| 5 | `OpenRA.Mods.Common/Traits/SeedsResource.cs` | `src/OpenRA.Mods.Common/Traits/SeedsResource.ts` | `SeedsResource` (COMPLETED) | 348 | LOW | A |
| 6 | `OpenRA.Mods.Common/Traits/Buildings/Refinery.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Refinery.ts` | `Refinery` (COMPLETED) | 705 | MEDIUM | A |

| **Phase B: Economy Support Traits (COMPLETED 2026-06-14)** | | | | TS Lines | | |
| 7 | `OpenRA.Mods.Common/Traits/StoresResources.cs` | `src/OpenRA.Mods.Common/Traits/StoresResources.ts` | `StoresResources` (COMPLETED) | 219 | LOW | B |
| 8 | `OpenRA.Mods.Common/Traits/StoresPlayerResources.cs` | `src/OpenRA.Mods.Common/Traits/StoresPlayerResources.ts` | `StoresPlayerResources` (COMPLETED) | 288 | LOW | B |
| 9 | `OpenRA.Mods.Common/Traits/Player/PlayerResources.cs` | `src/OpenRA.Mods.Common/Traits/Player/PlayerResources.ts` | `PlayerResources` (COMPLETED) | 540 | MEDIUM | B |
| 10 | `OpenRA.Mods.Common/Traits/CashTrickler.cs` | `src/OpenRA.Mods.Common/Traits/CashTrickler.ts` | `CashTrickler` (COMPLETED) | 294 | LOW-MEDIUM | B |
| 11 | `OpenRA.Mods.Common/Traits/Valued.cs` | `src/OpenRA.Mods.Common/Traits/Valued.ts` | `Valued` (COMPLETED) | 76 | LOW | B |
| 12 | `OpenRA.Mods.Common/Traits/GivesBounty.cs` | `src/OpenRA.Mods.Common/Traits/GivesBounty.ts` | `GivesBounty` (COMPLETED) | 268 | LOW | B |
| 13 | `OpenRA.Mods.Common/Traits/GivesCashOnCapture.cs` | `src/OpenRA.Mods.Common/Traits/GivesCashOnCapture.ts` | `GivesCashOnCapture` (COMPLETED) | 232 | LOW | B |
| 14 | `OpenRA.Mods.Common/Traits/DeliversCash.cs` | `src/OpenRA.Mods.Common/Traits/DeliversCash.ts` | `DeliversCash` (COMPLETED) | 298 | LOW-MEDIUM | B |
| 15 | `OpenRA.Mods.Common/Traits/AcceptsDeliveredCash.cs` | `src/OpenRA.Mods.Common/Traits/AcceptsDeliveredCash.ts` | `AcceptsDeliveredCash` (COMPLETED) | 149 | LOW | B |
| 16 | `OpenRA.Mods.Common/Traits/Sellable.cs` | `src/OpenRA.Mods.Common/Traits/Sellable.ts` | `Sellable` (COMPLETED) | 314 | LOW-MEDIUM | B |
| 17 | `OpenRA.Mods.Common/Traits/CustomSellValue.cs` | `src/OpenRA.Mods.Common/Traits/CustomSellValue.ts` | `CustomSellValue` (COMPLETED) | 118 | LOW | B |

| **Phase B-Optional: Extended Economy Traits** | | | | | |
| 18 | `OpenRA.Mods.Common/Traits/Multipliers/ResourceValueMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/ResourceValueMultiplier.ts` | `ResourceValueMultiplier` | 31 | LOW | B-opt |
| 19 | `OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnPlayerResources.cs` | `src/OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnPlayerResources.ts` | `GrantConditionOnPlayerResources` | 64 | LOW | B-opt |
| 20 | `OpenRA.Mods.Common/Traits/Render/WithResourceLevelOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithResourceLevelOverlay.ts` | `WithResourceLevelOverlay` | 69 | LOW | B-opt |
| 21 | `OpenRA.Mods.Common/Traits/Render/WithResourceLevelSpriteBody.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithResourceLevelSpriteBody.ts` | `WithResourceLevelSpriteBody` | 75 | LOW | B-opt |
| 22 | `OpenRA.Mods.Common/Traits/Render/WithResourceStoragePipsDecoration.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithResourceStoragePipsDecoration.ts` | `WithResourceStoragePipsDecoration` | 79 | LOW | B-opt |
| 23 | `OpenRA.Mods.Common/Traits/Render/WithStoresResourcesPipsDecoration.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithStoresResourcesPipsDecoration.ts` | `WithStoresResourcesPipsDecoration` | 101 | LOW | B-opt |
| 24 | `OpenRA.Mods.Common/Traits/CarryableHarvester.cs` | `src/OpenRA.Mods.Common/Traits/CarryableHarvester.ts` | `CarryableHarvester` | 61 | LOW | B-opt |
| 25 | `OpenRA.Mods.Common/Traits/SpawnActorsOnSell.cs` | `src/OpenRA.Mods.Common/Traits/SpawnActorsOnSell.ts` | `SpawnActorsOnSell` | 143 | LOW-MEDIUM | B-opt |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies. 25-107 lines of C#. Can be parallel-assigned.
> - **LOW-MEDIUM**: Moderate logic requiring cash transfer coordination or tick-based accumulation. 110-130 lines of C#.
> - **MEDIUM**: Core economy infrastructure with CellLayer management, docking callbacks, or dual-currency sync. 110-400 lines of C#.
> - **HIGH**: The Harvester trait (330 lines) is the central resource-gathering orchestrator. Combines docking, resource search, speed modification, multiple order handlers, and activity creation.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 25 (17 core + 8 optional) |
| **Phase A (Resource Infrastructure)** | 6 files + 1 interface expansion + 1 new base class |
| **Phase B (Economy Support)** | 11 files |
| **Phase B-Optional (Extended Economy)** | 8 files |
| **HIGH complexity** | 1 file (Harvester: 330 lines) |
| **MEDIUM complexity** | 3 files (ResourceLayer: 302, ResourceRenderer: 386, PlayerResources: 264) |
| **LOW-MEDIUM complexity** | 5 files (Refinery: 110, CashTrickler: 113, DeliversCash: 128, Sellable: 122, SpawnActorsOnSell: 143) |
| **LOW complexity** | 14 files |
| **Total active OpenRA C# source lines** | ~2,333 (17 core files) |
| **Total including optional files** | ~2,925 (25 files) |
| **Total including new infrastructure** | ~2,333 + DockClientBase (~150 est.) + TraitsInterfaces expansion (~80 est.) |

| Phase | Files | C# Lines | Complexity | Status |
|:---|:---:|:---:|:---|:---|
| A: Resource Infrastructure | 8 (6 files + interface + base class) | ~1,266 active + ~230 infrastructure | HIGH + MEDIUM + LOW | COMPLETE (8/8, 344 tests, R1 + R2 done) |
| B: Economy Support Traits | 11 | ~1,067 | MEDIUM + LOW-MEDIUM + LOW | COMPLETE (11/11, 425 tests, R1 resolved, R2 pending) |
| B-opt: Extended Economy Traits | 8 | ~592 | LOW-MEDIUM + LOW | OPTIONAL (0/8) |
| **Total** | **17 + 8 opt** | **~2,333 core + ~592 opt** | | **COMPLETE (17/17 core)** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Resource Infrastructure

**Status**: COMPLETE (8/8, 344 tests, R1 resolved, R2 pending)
**Complexity**: HIGH (Harvester 330 lines) + MEDIUM + LOW (DockClientBase, TraitsInterfaces expansion, ResourceLayer 302, ResourceRenderer 386, ResourceClaimLayer 74, SeedsResource 64, Refinery 110)
**Blocked by**: Chapters 2-9 foundation (ALL COMPLETE). ~~**Critical missing dependencies**: `DockClientBase` (new), `BuildingInfluence` (not migrated -- deferred for Phase A initial implementation), `IDockHost` interface (new), `WithSpriteBody`~~ -- ALL RESOLVED. `BuildingInfluence` deferred to Ch11 per ADR-10.7.
**Blocks**: Phase B (PlayerResources, StoresPlayerResources depend on resource infrastructure), Chapter 11 (Production queues consume resources), Chapter 14 Phase D (FindAndDeliverResources Activity implementation), Chapter 15 (HarvestOrderTargeter, SellOrderTargeter), Chapter 16 (ResourceBarWidget)

**Description**: Phase A establishes the core resource gathering infrastructure. The new `DockClientBase<T>` abstract class must be migrated first since `Harvester` inherits from it. The `TraitsInterfaces.ts` expansion adds `IDockHost`, `IAcceptResources`, `IResourceLayer`, `IResourceRenderer`, and `IStoresResources` interfaces that both Phase A and B files depend on. `ResourceLayer` (302 lines) is the World trait that manages the `CellLayer<ResourceLayerContents>` data store with runtime density tracking, neighbor-aware density recalculation, and `CellChanged` events. `ResourceRenderer` (386 lines) uses `TerrainSpriteLayer` (Ch2) to render resource sprites at cell positions with variant selection and dirty cell tracking for incremental updates. `ResourceClaimLayer` (74 lines) provides simple bidirectional mapping for harvester-to-cell claim tracking. `SeedsResource` (64 lines) is a simple timer-based resource spawner. `Refinery` (110 lines) implements `IAcceptResources` with two modes (UseStorage/direct cash) and floating text display. `Harvester` (330 lines) is the central orchestrator -- it inherits from `DockClientBase`, implements `IMove`-based resource travel and `IStoresResources` for cargo management.

**Paradigm Shifts**:
- C# `ResourceLayer.CellLayer<ResourceLayerContents>` readonly struct -> TypeScript `CellLayer<ResourceContents>` with `interface ResourceContents { type: string; density: number; }` and `Object.freeze()` for immutability
- C# `ResourceRenderer.TerrainSpriteLayer` CPU sprite batch -> Existing `TerrainSpriteLayer` (Ch2) 3D ground-plane Mesh with cell-positioned billboards
- C# `ResourceRenderer.RendererCellContents` struct -> TypeScript `interface RendererCellContents` with sprite frame calculation from density ratio
- C# `Harvester` inherits `DockClientBase<HarvesterInfo>` -> TypeScript `Harvester extends DockClientBase<HarvesterInfo>` with abstract method overrides
- C# `Harvester.FindAndDeliverResources` Activity factory -> TypeScript factory method returning `Activity` stub (actual Activity in Ch14 Phase D)
- C# `ResourceLayer` `FrozenDictionary` resource types -> TypeScript `ReadonlyMap<string, ResourceTypeInfo>` or `Record<string, ...>`
- C# `Refinery.AcceptResources()` synchronous cash deposit -> TypeScript `PlayerResources.addCash()` with `Number.isSafeInteger()` overflow protection
- C# `DockClientBase` generic abstract class pattern -> TypeScript abstract generic class with `CanDock()`, `OnDockStarted()`, `OnDockTick()`, `OnDockCompleted()` methods

#### 3.1.0 DockClientBase (New Migration)

- [x] **TODO-10.A.0** `src/OpenRA.Mods.Common/Traits/DockClientBase.ts` (new file, 385 TS lines) -- Abstract base class for docking units (COMPLETED):
  - `DockClientBaseInfo` config class: `Type: BitSet<DockType>` (docking type flags), `color: Color`
  - Abstract methods to be overridden by subclasses (Harvester):
    - `CanDock(self: IGameActor, host: IGameActor): boolean` -- check if docking is allowed
    - `OnDockStarted(self: IGameActor, host: IGameActor): void` -- called when docking begins
    - `OnDockTick(self: IGameActor, host: IGameActor): void` -- per-tick update during docking
    - `OnDockCompleted(self: IGameActor, host: IGameActor): void` -- called when docking finishes (all resources unloaded)
  - `getDockHost(self: IGameActor, order: Order): IGameActor | null` -- validate and return dock host from order
  - `createDockActivity(self: IGameActor, host: IGameActor): Activity` -- factory returning Activity stub (deferred to Ch14)
  - `createMoveToDockActivity(self: IGameActor, host: IGameActor): Activity` -- factory returning Activity stub
  - Implements `IResolveOrder`:
    - `resolveOrder(self, order)` -- handle Dock order
  - DockType enum: `Unload = 1`, `Repair = 2`, `Refuel = 4`
  - Integration with `IDockHost` interface for host-side docking callbacks
  - **Note**: This class is a prerequisite for Harvester. The actual docking Activity (MoveToDock, Dock) is deferred to Chapter 14 Phase D.

#### 3.1.0b TraitsInterfaces Expansion: IDockHost + IAcceptResources + IResourceLayer + IResourceRenderer + IStoresResources

- [x] **TODO-10.A.0b** `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (expand existing, +497 lines) -- Add resource/economy interfaces (COMPLETED):
  - `IDockHost` interface:
    - `onDockStarted(actor: IGameActor, client: IGameActor): void`
    - `onDockTick(actor: IGameActor, client: IGameActor): void`
    - `onDockCompleted(actor: IGameActor, client: IGameActor): void`
    - `canDock(actor: IGameActor, client: IGameActor): boolean`
    - `dockPosition(actor: IGameActor, client: IGameActor): WPos` -- where client should position during dock
  - `IAcceptResources` interface:
    - `acceptResources(self: IGameActor, resourceType: string, amount: number): number` -- returns amount actually accepted
  - `IResourceLayer` interface:
    - `getResource(cell: CPos): ResourceContents` -- get resource at cell
    - `addResource(cell: CPos, type: string, amount: number): number` -- returns amount actually added
    - `removeResource(cell: CPos, type: string, amount: number): number` -- returns amount actually removed
    - `clearResources(cell: CPos): void`
    - `isVisible(cell: CPos, toPlayer: Player): boolean` -- visibility check (for shroud integration)
    - `onCellChanged(cell: CPos, resourceType: string | null): void` -- event emitter/callback
  - `IResourceRenderer` interface:
    - `addVisibleCell(cell: CPos): void`
    - `removeVisibleCell(cell: CPos): void`
    - `updateCell(cell: CPos): void`
  - `IStoresResources` interface:
    - `capacity: number` -- max total resource units
    - `contents: ReadonlyMap<string, number>` -- current resource counts by type
    - `contentsSum: number` -- total current resource units
    - `hasType(resourceType: string): boolean`
    - `addResource(resourceType: string, value: number): number` -- adds, returns leftover
    - `removeResource(resourceType: string, value: number): number` -- removes, returns leftover
  - `IResourceValueModifier` interface (for ResourceValueMultiplier in Phase B-opt):
    - `getResourceValueModifier(): number`
  - `ResourceContents` type: `{ type: string; density: number }` with `EMPTY` sentinel via `Object.freeze({ type: "", density: 0 })`
  - **Note**: These interfaces must be finalized before any implementing trait can be written.

#### 3.1.1 Harvester

- [x] **TODO-10.A.1** `src/OpenRA.Mods.Common/Traits/Harvester.ts` (1075 TS lines, 81 tests) -- Central resource-gathering actor trait (COMPLETED):
  - `HarvesterInfo` config class (extends `DockClientBaseInfo`):
    - `Type: BitSet<DockType>` = `"Unload"` (default)
    - `UnblockCell: CVec` = `new CVec(0, 4)` -- cell to move to when unblocking refinery
    - `BaleLoadDelay: number` = 4 -- ticks per resource bale loaded
    - `BaleUnloadDelay: number` = 4 -- ticks per resource bale unloaded
    - `BaleUnloadAmount: number` = 1 -- bales unloaded per dock tick
    - `HarvestFacings: number` = 0 -- facings for harvest animation (0 = any)
    - `Resources: string[]` -- which resource types this harvester can collect
    - `FullyLoadedSpeed: number` = 85 -- percentage of max speed when full
    - `SearchOnCreation: boolean` = true -- auto-scan for resources on creation
    - `SearchFromProcRadius: number` = 24 -- initial search radius from refinery
    - `SearchFromOrderRadius: number` = 12 -- search radius when ordered to harvest
    - `HarvestVoice: string` -- voice line for harvest order
    - `DeliverVoice: string` -- voice line for deliver order
  - `Harvester` class (extends `DockClientBase<HarvesterInfo>`):
    - `IStoresResources` implementation:
      - `capacity: number` -- delegates to `IStoresResources` inner trait
      - `contents: ReadonlyMap<string, number>` -- current cargo
      - `contentsSum: number` -- total cargo units
      - `hasType(resourceType: string): boolean` -- check if harvester carries this type
      - `addResource(resourceType, value): number` -- add to cargo
      - `removeResource(resourceType, value): number` -- remove from cargo
    - Capacity management:
      - `isFull: boolean` -- cargo at max capacity
      - `isEmpty: boolean` -- cargo empty
      - `fullness: number` -- ratio of cargo/capacity (0.0 to 1.0)
    - Resource search:
      - `canHarvestCell(self, cell: CPos): boolean` -- check if cell has harvestable resource
      - `findResourceField(self): CPos | null` -- search nearby for resource cells
    - Speed modification (`ISpeedModifier`):
      - `getSpeedModifier(movementTypes: Set<string>): number` -- returns `FullyLoadedSpeed / 100` when full
    - `IIssueOrder` implementation:
      - `issueOrder(world, target, targetCell, mi): Order | null` -- issue Harvest order when clicking resource cell
    - `IResolveOrder` implementation (overrides DockClientBase):
      - `resolveOrder(self, order)` -- handle "Harvest", "Deliver" orders
    - `IOrderVoice` implementation:
      - `voicePhraseForOrder(self, order): string` -- returns harvest/deliver voice
    - Docking overrides (from DockClientBase):
      - `CanDock(self, host): boolean` -- check if host is Refinery with matching DockType
      - `OnDockStarted(self, host)` -- start unloading sequence
      - `OnDockTick(self, host)` -- per-tick: unload `BaleUnloadAmount` bales
      - `OnDockCompleted(self, host)` -- all cargo unloaded, trigger search for more
    - Activity factory methods:
      - `createHarvestActivity(self): Activity` -- returns Activity stub for FindAndDeliverResources (actual Activity deferred to Ch14)
      - `createDeliverActivity(self, refinery: IGameActor): Activity` -- returns Activity stub for resource delivery
    - `INotifyCreated`:
      - `created(self)` -- if `SearchOnCreation`, queue auto-search for resources
    - `harvestTick(self, resourceLayer: IResourceLayer)` -- extract resources from current cell (called by Activity at Ch14)
    - `updateSpeed(self)` -- re-evaluate speed modifier based on fullness
    - Inner class (stub):
      - `HarvestOrderTargeter` -- order generator for harvest orders (deferred to Ch15)
    - **3D integration**: None (pure game logic). The `IMove` trait handles TransformNode positioning; harvester simply issues Move orders.

#### 3.1.2 ResourceLayer

- [x] **TODO-10.A.2** `src/OpenRA.Mods.Common/Traits/World/ResourceLayer.ts` (799 TS lines, 83 tests) -- World-level resource data store (COMPLETED):
  - `ResourceLayerInfo` config class:
    - `ResourceTypes: Map<string, ResourceTypeInfo>` -- resource type definitions
    - `RecalculateResourceDensity: boolean` -- auto-recalculate density from neighbors
    - `ResourceTypeInfo` inner class: `ResourceIndex: number`, `TerrainType: string`, `AllowedTerrainTypes: Set<string>`, `MaxDensity: number`
  - `ResourceLayer` trait:
    - `CellLayer<ResourceContents>` -- the core data store (uses Ch4 `CellLayer`)
    - `ResourceContents` type: `{ type: string; density: number }` with `EMPTY: ResourceContents = Object.freeze({ type: "", density: 0 })`
    - `IResourceLayer` implementation:
      - `getResource(cell: CPos): ResourceContents`
      - `addResource(cell, type, amount): number` -- adds up to `MaxDensity`; returns leftover
      - `removeResource(cell, type, amount): number` -- removes up to current density; returns leftover
      - `clearResources(cell): void`
      - `isVisible(cell, toPlayer): boolean` -- always true for now (integration with shroud deferred to Ch12)
    - `CellChanged` event: `(cell: CPos, resourceType: string | null) => void`
    - `removeResources(world, cell, resourceType, amount): number` -- removes resources and fires `CellChanged`
    - Density calculation:
      - `recalculateResourceDensity(): void` -- re-calculate all cell densities based on neighbor counts
      - Density = min(current density, number of neighboring cells with same resource type, `MaxDensity`)
      - Incremental: `recalculateDensity(cell, type)` -- update only affected cells
    - `addToCell(cell, type, amount): number` -- internal: add resource to cell respecting `AllowedTerrainTypes`
    - Initialization from Map.Resources:
      - `INotifyCreated.created(self)` -- read `Map.Resources` CellLayer (byte indices), convert to resource types using `ResourceTypes` mapping
      - Skip cells where building is present (requires `BuildingInfluence` -- can be deferred)
    - Terrain type validation: resources can only spawn on `AllowedTerrainTypes`
    - Integration with `BuildingInfluence` (deferred to Ch11): buildings block resource spawning on occupied cells
    - Integration with `Map.Resources` and `Map.CustomTerrain` from Ch4
    - **Note**: `BuildingInfluence` dependency can be initially stubbed (no building blocking). Full integration when Ch11 Phase B completes.

#### 3.1.3 ResourceRenderer

- [x] **TODO-10.A.3** `src/OpenRA.Mods.Common/Traits/World/ResourceRenderer.ts` (1106 TS lines, 41 tests) -- Resource sprite rendering (COMPLETED):
  - `ResourceRendererInfo` config class:
    - `OverlayPalette: string` -- palette for overlay rendering
    - `RenderTypes: Set<string>` -- which resource types to render (default: all)
  - `ResourceRenderer` trait (World trait, `IRenderOverlay`, `ITickRender`, `IRadarTerrainLayer`):
    - `IResourceRenderer` implementation:
      - `addVisibleCell(cell: CPos)` -- make cell visible (add to dirty set)
      - `removeVisibleCell(cell: CPos)` -- remove cell visibility
      - `updateCell(cell: CPos)` -- mark cell as dirty for re-render
    - `TerrainSpriteLayer` usage:
      - One `TerrainSpriteLayer` per resource type
      - Each layer renders resource sprites at cell positions with height from `CellRamp`
      - `RendererCellContents` type: `{ frame: number; variant: number }` with `EMPTY` sentinel
    - Variant system:
      - Each `ResourceTypeInfo` can define multiple sprite sequence variants
      - Variant selected per-cell randomly (deterministic based on cell position hash)
      - `SpriteFrame = int2.Lerp(0, sequenceLength - 1, density, maxDensity)` -- density controls which frame
    - Dirty cell tracking:
      - `dirtyCells: Set<number>` -- cells that need sprite update
      - Batch update at end of tick via `ITickRender`
    - `IRenderOverlay` implementation:
      - `render(worldRenderer)` -- draw all resource layers
    - `ITickRender` implementation:
      - `tickRender(worldRenderer)` -- process dirty cells, update sprite frames
    - Sequence handling:
      - Load sprite sequences from `SequenceProvider` (Ch2) per resource type
      - Multiple variants per type for visual variety
    - `addTerrainCell(cell: CPos)` -- add resource to render layer
    - `updateTerrainCell(cell: CPos)` -- update sprite frame for density change
    - `clearTerrainCell(cell: CPos)` -- remove resource from render layer
    - 3D integration: `TerrainSpriteLayer` (Ch2) places sprite billboards at `CoordinateTransformer.cellToVector3(cell)` with Y-offset from `CellRamp` data
    - **Note**: `TerrainSpriteLayer` is already migrated in Ch2. Integration involves calling its `update(dirtyCells)` method with updated sprite data.

#### 3.1.4 ResourceClaimLayer

- [x] **TODO-10.A.4** `src/OpenRA.Mods.Common/Traits/World/ResourceClaimLayer.ts` (240 TS lines, 24 tests) -- Harvester-to-cell claim tracking (COMPLETED):
  - `ResourceClaimLayerInfo` config class: no config fields (marker trait)
  - World trait:
    - `claimants: Map<string, CPos>` -- keyed by actor ID string, maps to claimed cell
    - `claimCells: Map<number, IGameActor[]>` -- keyed by cell index, maps to claiming actors
  - `TryClaimCell(actor, cell): boolean` -- claim a cell for this actor; returns false if already claimed by another actor from same player
  - `CanClaimCell(actor, cell): boolean` -- check if cell can be claimed (not claimed by another actor from same player)
  - `RemoveClaim(actor)` -- release actor's claim
  - `GetClaimedCell(actor): CPos | null` -- get the cell this actor has claimed
  - Player-based claim separation: harvesters from different players can claim the same cell
  - Used by Harvester to prevent two harvesters from same player from targeting same resource cell
  - Simple in-memory collection -- no celllayer storage needed

#### 3.1.5 SeedsResource

- [x] **TODO-10.A.5** `src/OpenRA.Mods.Common/Traits/SeedsResource.ts` (348 TS lines, 28 tests) -- Timer-based resource spawner (COMPLETED):
  - `SeedsResourceInfo` config class:
    - `ResourceType: string` -- type of resource to seed
    - `Interval: number` -- ticks between seeding attempts
    - `MaxDensity: number` -- maximum density to seed per cell
    - `Range: number` -- search radius around actor for seedable cells
  - `SeedsResource` trait (actor trait, `ITick`):
    - `tick(self)` -- every `Interval` ticks, attempt to add resource to a nearby cell
    - `seedTick(self)` -- find random cell within `Range`, add `ResourceType` at `MaxDensity` via `IResourceLayer.addResource()`
    - Only seeds on cells with `AllowedTerrainTypes` matching the resource type
    - Cell selection: random within `Range` cells of actor's current position
    - Used by "ore mine" buildings or special units that generate resources
  - Integration with `IResourceLayer` (found via World trait)
  - **3D integration**: None (pure game logic). ResourceRenderer automatically picks up new resources via `CellChanged` event.

#### 3.1.6 Refinery

- [x] **TODO-10.A.6** `src/OpenRA.Mods.Common/Traits/Buildings/Refinery.ts` (705 TS lines, 43 tests) -- Resource processing building (COMPLETED):
  - `RefineryInfo` config class:
    - `UseStorage: boolean` = true -- store resources in silos (false = direct cash)
    - `DiscardExcessResources: boolean` = false -- discard when silos full
    - `ShowTicks: boolean` = true -- show floating cash text above refinery
    - `TickRate: number` = 10 -- ticks between displayed value updates
  - `Refinery` trait (`IAcceptResources`, `INotifyCreated`, `ITick`, `INotifyOwnerChanged`):
    - `IAcceptResources` implementation:
      - `acceptResources(self, resourceType, amount): number` -- process resource delivery
        - If `UseStorage`: attempt to store in `PlayerResources` via `StoresPlayerResources.addStorage()`. If full and `DiscardExcessResources`, discard; otherwise return unaccepted amount.
        - If not `UseStorage`: convert directly to cash using resource value * `IResourceValueModifier`. Return 0 (all accepted).
    - `INotifyCreated`:
      - `created(self)` -- resolve `PlayerResources` reference from owning player
    - `INotifyOwnerChanged`:
      - `onOwnerChanged(self, oldOwner, newOwner)` -- re-resolve `PlayerResources`
    - `ITick`:
      - `tick(self)` -- update floating text display if `ShowTicks`
      - Show "+$XXX" text above refinery when resources are processed
      - Floating text: Babylon.js `GUI.TextBlock` billboard positioned above refinery mesh
    - Cash conversion:
      - Resource value lookup: `info.ResourceValues[resourceType] * resourceValueModifier`
      - `IResourceValueModifier` traits on the refinery modify value (e.g., ResourcePurifier)
    - Integration with `IDockHost`:
      - `canDock(actor, client): boolean` -- only `DockType.Unload` clients
      - `dockPosition(actor, client): WPos` -- cell adjacent to refinery for docking
      - `onDockStarted(actor, client)` -- begin unloading
      - `onDockTick(actor, client)` -- call `Harvester.removeResource()` + `acceptResources()`
      - `onDockCompleted(actor, client)` -- all resources processed
    - Floating text display:
      - Accumulated cash per tick interval
      - Display accumulated value each `TickRate` ticks
      - Reset accumulator after display
    - **3D integration**: Floating "+$XXX" text uses Babylon.js `GUI.TextBlock` with `linkWithMesh()` at position above refinery mesh center

**Phase A Summary (COMPLETED 2026-06-14)**: 8 items (1 new base class + 1 interface expansion + 6 files), ~4,965 TypeScript implementation lines, 7 test files with 6,224 test lines, 344 unit tests all passing. Harvester (1,075 TS lines) is the central orchestrator ported with full docking integration. ResourceLayer (799 TS lines) and ResourceRenderer (1,106 TS lines) are the resource visualization backbone. DockClientBase (385 TS lines) migrated as abstract generic base class. Review: R1 COMPLETE (4 BLOCKER + 4 MAJOR resolved), R2 PENDING. 6 commits: `d65c51c` (DockClientBase + TraitsInterfaces), `548756c` (ResourceClaimLayer + SeedsResource), `d78de60` (Harvester + Refinery), `7a72af7` (ResourceLayer + ResourceRenderer), `f55ed14` (BLOCKER#1,#2 + MAJOR#1,#2 fixes), `20380ca` (4 BLOCKER + 1 MAJOR fixes).

---

### 3.2 Phase B: Economy Support Traits

**Status**: COMPLETE (11/11, 425 tests, R1 resolved, R2 pending)
**Complexity**: MEDIUM (PlayerResources 264 lines) + LOW-MEDIUM + LOW (10 files, ~803 lines total)
**Blocked by**: Phase A (IStoresResources interface finalized in TraitsInterfaces.ts; ResourceLayer for resource type info; Harvester for IStoresResources reference implementation; Refinery for IAcceptResources reference implementation). Also blocked by: Chapter 3 (Player, INotifyKilled, INotifyCapture, INotifyOwnerChanged -- ALL COMPLETE), Chapter 6 Phase A (Order, IResolveOrder -- ALL COMPLETE), Chapter 6 Phase B (Sync trait -- ALL COMPLETE).
**Blocks**: Chapter 11 (Production queues consume PlayerResources cash and stored resources), Chapter 16 (ResourceBarWidget displays PlayerResources state)
**Review**: R1 COMPLETE (0 BLOCKER, 5 MAJOR resolved, 5 MINOR resolved), R2 PENDING. 6 commits: 4 implementation + 2 review fix commits.
**Date**: 2026-06-14

**Description**: Phase B implements the economy traits that manage player resources (cash + stored resources), provide resource storage capacity, and handle various cash transfer events. `PlayerResources` (264 lines) is the central player-level economy manager with dual-currency tracking, `[Sync]` synchronization, lobby options for starting cash, and cash overflow protection. `StoresResources` (107 lines, already having its interface defined in Phase A) provides per-actor resource storage with capacity limits. `StoresPlayerResources` (67 lines) bridges building storage to `PlayerResources` capacity tracking. `CashTrickler` (113 lines) grants periodic cash. `Valued` (25 lines) is the simplest trait -- just stores a Cost value. `GivesBounty` (91 lines) grants cash to the killer on death. `GivesCashOnCapture` (62 lines) grants cash to the captor. `DeliversCash` (128 lines) and `AcceptsDeliveredCash` (50 lines) coordinate cash delivery between actors. `Sellable` (122 lines) adds a Sell button and refund logic. `CustomSellValue` (38 lines) overrides the sell value calculation.

**Paradigm Shifts**:
- C# `PlayerResources` `[Sync]` int fields -> TypeScript `Sync` trait registration (Ch6 Phase B) + `Number.isSafeInteger()` overflow checks
- C# `PlayerResources` `ILobbyOptions` -> TypeScript lobby option interface (deferred to UI chapter)
- C# `StoresResources` `ReadOnlyDictionary` -> TypeScript `ReadonlyMap<string, number>` with `contents`: `ReadonlyMap`
- C# `Sellable` `IResolveOrder` -> TypeScript `IResolveOrder` (already from Ch6 Phase A) with Sell order resolution
- C# `GivesBounty` `INotifyKilled` -> TypeScript `INotifyKilled` (already from Ch3)
- C# `GivesCashOnCapture` `INotifyCapture` -> TypeScript `INotifyCapture` (from Ch3)

#### 3.2.1 StoresResources

- [x] **TODO-10.B.1** `src/OpenRA.Mods.Common/Traits/StoresResources.ts` (219 TS lines) -- Per-actor resource storage (COMPLETED):
  - `StoresResourcesInfo` config class:
    - `Capacity: number` = 28 -- max total resource units
    - `Resources: string[]` -- which resource types can be stored
  - `StoresResources` trait (`IStoresResources`, `ISync`):
    - `capacity: number` -- delegates to `info.Capacity`
    - `contents: ReadonlyMap<string, number>` -- current resource counts keyed by type
    - `contentsSum: number` -- total stored units (sum of all contents values)
    - `hasType(resourceType: string): boolean` -- check if resource type is accepted
    - `addResource(resourceType, value): number` -- add up to capacity; returns leftover
    - `removeResource(resourceType, value): number` -- remove up to current amount; returns leftover
    - `[Sync]` ContentHash: `reduce((acc, [type, count]) => acc + (count << type.length), 0)` -- deterministic hash for sync validation
  - Capacity enforcement: `contentsSum + value <= info.Capacity`
  - Inner `contents: Map<string, number>` with `ReadonlyMap` wrapper exposed via `Contents` property
  - **Implemented on**: Harvester (resource cargo), silo buildings (resource storage)
  - Integration with `IStoresResources` interface (already in TraitsInterfaces.ts from Phase A)

#### 3.2.2 StoresPlayerResources

- [x] **TODO-10.B.2** `src/OpenRA.Mods.Common/Traits/StoresPlayerResources.ts` (288 TS lines) -- Building-to-player resource bridge (COMPLETED):
  - `StoresPlayerResourcesInfo` config class: no config fields (marker trait)
  - `StoresPlayerResources` trait (`INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `INotifyOwnerChanged`):
    - `capacity: number` -- delegates to `IStoresResources.capacity` on this actor
    - `reserveCapacity: number` -- capacity reserved for in-progress deliveries
  - `INotifyAddedToWorld`:
    - `addedToWorld(self)` -- calls `PlayerResources.addStorageCapacity(capacity)`
  - `INotifyRemovedFromWorld`:
    - `removedFromWorld(self)` -- calls `PlayerResources.removeStorageCapacity(capacity)`
  - `INotifyOwnerChanged`:
    - Adjust storage: remove from old owner, add to new owner
  - `AddReserve(capacity: number): void` -- reserve capacity for pending delivery
  - `RemoveReserve(capacity: number): void` -- release reserved capacity
  - **Implemented on**: Silo buildings, Refinery (when UseStorage=true)
  - This trait is the bridge between individual building `IStoresResources` and player-level `PlayerResources`

#### 3.2.3 PlayerResources

- [x] **TODO-10.B.3** `src/OpenRA.Mods.Common/Traits/Player/PlayerResources.ts` (540 TS lines) -- Player-level economy manager (COMPLETED):
  - `PlayerResourcesInfo` config class:
    - `DefaultCashDropdownLabel: string` = "Starting Cash"
    - `DefaultCashDropdownDescription: string` -- tooltip
    - `SelectableCash: number[]` = [2500, 5000, 10000, 20000]
    - `DefaultCash: number` = 5000
    - `DefaultCashDropdownLocked: boolean` = false
    - `DefaultCashDropdownVisible: boolean` = true
    - `DefaultCashDropdownDisplayOrder: number` = 0
    - `InsufficientFundsNotification: string` -- speech notification
    - `InsufficientFundsTextNotification: string` -- text notification
    - `InsufficientFundsNotificationInterval: number` = 30000 -- mute interval in ms
    - `CashTickUpNotification: string` -- cash increment sound
    - `CashTickDownNotification: string` -- cash decrement sound
    - `TickFeedbackInterval: number` = 4 -- ticks between cash change sounds
  - `PlayerResources` trait (Player trait, `ISync`, `INotifyCreated`):
    - **Cash management**:
      - `cash: number` -- current cash balance
      - `addCash(amount: number): string | null` -- add cash; returns cash tick notification name (or null if none): `Number.isSafeInteger(cash + amount)` check enforced
      - `takeCash(amount: number): boolean` -- subtract cash; returns false if insufficient funds
      - `canAfford(cost: number): boolean` -- check if cash >= cost
      - Cash overflow safety: if `cash + amount > Number.MAX_SAFE_INTEGER`, cap at `MAX_SAFE_INTEGER` and log warning
    - **Resource storage management**:
      - `resources: Map<string, number>` -- stored resources by type
      - `resourceCapacity: number` -- total capacity across all `StoresPlayerResources` traits
      - `resourceCapacityUsed: number` -- currently used capacity
      - `addResourceStorage(type, amount, capacity): number` -- store resources; returns leftover; respects `resourceCapacity`
      - `removeResourceStorage(type, amount): number` -- remove resources; returns leftover
      - `addStorageCapacity(amount: number): void` -- increase total capacity
      - `removeStorageCapacity(amount: number): void` -- decrease total capacity
      - `canStoreResource(type, amount): boolean` -- check if space available
    - `[Sync]` fields:
      - `cashSync: number` -- sync hash for cash
      - `resourcesSync: number` -- sync hash for stored resources
      - `resourceCapacitySync: number` -- sync hash for capacity
    - `INotifyCreated`:
      - `created(self)` -- set initial cash from lobby options (or `DefaultCash`)
    - Lobby options (`ILobbyOptions`):
      - `lobbyOptions(): LobbyOption[]` -- provides selectable cash options (deferred to Ch16 UI widgets)
    - Cash change feedback:
      - `lastNotificationTime: number` -- time of last insufficient funds notification
      - `lastCashTickTime: number` -- time of last cash tick sound
      - Mute interval enforcement for both
    - Integration with `StoresPlayerResources` (via INotifyAddedToWorld/Removed)
    - **Note**: `ILobbyOptions` lobby integration can be initially stubbed; actual lobby UI is in Chapter 16.

#### 3.2.4 CashTrickler

- [x] **TODO-10.B.4** `src/OpenRA.Mods.Common/Traits/CashTrickler.ts` (294 TS lines) -- Periodic cash income (COMPLETED):
  - `CashTricklerInfo` config class:
    - `Amount: number` -- cash per period
    - `Interval: number` -- ticks between grants
    - `ShowTicks: boolean` -- show floating cash text
    - `DisplayDuration: number` -- duration of floating text display
  - `CashTrickler` trait (`ITick`):
    - `tick(self)` -- every `Interval` ticks, grant `Amount` cash to owning player via `PlayerResources.addCash()`
    - Floating text display: "+$Amount" text billboard above actor for `DisplayDuration` ticks
  - Integration with `PlayerResources` (found via owning Player)
  - Used by Oil Derricks, Tech Buildings, and other passive income sources
  - 3D: Floating text uses Babylon.js GUI TextBlock with timed fade-out

#### 3.2.5 Valued

- [x] **TODO-10.B.5** `src/OpenRA.Mods.Common/Traits/Valued.ts` (76 TS lines) -- Actor cost/value assignment (COMPLETED):
  - `ValuedInfo` config class:
    - `Cost: number` -- cost/value of this actor
  - `Valued` trait:
    - `cost: number` -- getter for `info.Cost`
  - Extremely simple trait -- used by `Sellable`, `GivesBounty`, `SpawnActorsOnSell`
  - One of the simplest traits in OpenRA -- good warm-up task

#### 3.2.6 GivesBounty

- [x] **TODO-10.B.6** `src/OpenRA.Mods.Common/Traits/GivesBounty.ts` (268 TS lines) -- Bounty on kill (COMPLETED):
  - `GivesBountyInfo` config class:
    - `Percentage: number` = 10 -- percentage of killed actor's value as bounty
    - `Levels: number[]` -- fixed bounty amounts per veterancy level
    - `ValidRelationships: PlayerRelationship[]` = `["Enemy"]` -- who gets bounty
  - `GivesBounty` trait (`INotifyKilled`):
    - `killed(self, attacker, e)` -- on death, grant cash to attacker
    - Bounty calculation:
      - If `Levels` defined: `Levels[attacker.veterancyLevel]` (capped at last level)
      - Otherwise: `Valued.Cost * Percentage / 100`
    - `ValidRelationships` filter: only grant bounty if relationship matches
    - Uses `PlayerResources.addCash()` on the attacker's owning player
    - Integration with `Valued` trait for base cost lookup
    - Integration with `PlayerRelationship` from Ch3

#### 3.2.7 GivesCashOnCapture

- [x] **TODO-10.B.7** `src/OpenRA.Mods.Common/Traits/GivesCashOnCapture.ts` (232 TS lines) -- Cash on building capture (COMPLETED):
  - `GivesCashOnCaptureInfo` config class:
    - `Amount: number` -- cash granted
    - `ShowTicksFlag: boolean` = true -- show floating cash text
  - `GivesCashOnCapture` trait (`INotifyCapture`):
    - `onCapture(self, captor, oldOwner, newOwner, captures)` -- grant cash to new owner
    - Cash granted immediately upon capture
    - Floating text: "+$Amount" above captured building
    - Integration with `PlayerResources.addCash()` on the new owner's player

#### 3.2.8 DeliversCash

- [x] **TODO-10.B.8** `src/OpenRA.Mods.Common/Traits/DeliversCash.ts` (298 TS lines) -- Carryable cash delivery (COMPLETED):
  - `DeliversCashInfo` config class:
    - `Payload: number` -- cash amount delivered
    - `PlayerExperience: number` = 0 -- experience granted to player on delivery
    - `Type: string` = "Cash" -- delivery type (matching AcceptsDeliveredCash)
    - `Voice: string` -- voice line on delivery
  - `DeliversCash` trait (`IIssueOrder`, `IResolveOrder`, `INotifyKilled`, `INotifyAddedToWorld`):
    - `IIssueOrder`:
      - `issueOrder(world, target, targetCell, mi): Order | null` -- issue DeliverCash order
    - `IResolveOrder`:
      - `resolveOrder(self, order)` -- create DeliverCash Activity (stub, deferred to Ch14)
    - `INotifyKilled`:
      - `killed(self, attacker, e)` -- cash is lost on death (no transfer)
    - `INotifyAddedToWorld`:
      - `addedToWorld(self)` -- register with world for delivery tracking
    - Used by Carryable units (e.g., cash crate, spy returning stolen funds)
    - Integration with `AcceptsDeliveredCash` for receiver-side logic

#### 3.2.9 AcceptsDeliveredCash

- [x] **TODO-10.B.9** `src/OpenRA.Mods.Common/Traits/AcceptsDeliveredCash.ts` (149 TS lines) -- Cash delivery receiver (COMPLETED):
  - `AcceptsDeliveredCashInfo` config class:
    - `Type: string` = "Cash" -- delivery type to accept
    - `ValidRelationships: PlayerRelationship` = `"Ally"` -- who can deliver
  - `AcceptsDeliveredCash` trait:
    - `acceptsDelivery(type, from): boolean` -- check if delivery is accepted (by type and relationship)
  - Simple filter trait -- used by buildings that can receive cash deliveries
  - Integration with `PlayerRelationship` for faction validation

#### 3.2.10 Sellable

- [x] **TODO-10.B.10** `src/OpenRA.Mods.Common/Traits/Sellable.ts` (314 TS lines) -- Sell button + refund logic (COMPLETED):
  - `SellableInfo` config class:
    - `RefundPercent: number` = 50 -- percentage of cost refunded
    - `SellSounds: string[]` -- sound effects played on sell
    - `ShowTicks: boolean` = true -- show floating cash text
    - `RequiresCondition: string` -- condition to enable sell button
  - `Sellable` trait (`IResolveOrder`, `IIssueOrder`):
    - `IResolveOrder`:
      - `resolveOrder(self, order)` -- handle "Sell" order
        - Calculate refund: `Valued.Cost * healthPercent * RefundPercent / 100`
        - `healthPercent = currentHealth / maxHealth` from `IHealth`
        - Apply `CustomSellValue` override if present
        - Grant cash via `PlayerResources.addCash()`
        - Trigger sell sounds
        - Remove actor from world (via `GameWorldManager.removeActor()`)
    - `IIssueOrder`:
      - `issueOrder(world, target, targetCell, mi): Order | null` -- issue Sell order (hotkey or UI button)
        - Only issues if `RequiresCondition` is satisfied (condition token active)
    - `sellValue(self): number` -- calculate current sell value
    - Integration with `IHealth` (Ch8 Phase D) for damage-based refund reduction
    - Integration with `Valued` (Ch10 Phase B) for base cost
    - Integration with `CustomSellValue` (Ch10 Phase B) for override
    - Inner class (stub):
      - `SellOrderTargeter` -- order generator for sell order (deferred to Ch15)
    - **3D integration**: None (pure game logic). Actor removal uses existing `GameWorldManager.disposeActor()`.

#### 3.2.11 CustomSellValue

- [x] **TODO-10.B.11** `src/OpenRA.Mods.Common/Traits/CustomSellValue.ts` (118 TS lines) -- Override sell value (COMPLETED):
  - `CustomSellValueInfo` config class:
    - `Value: number` -- override sell value (0 = use default calculation)
  - `CustomSellValue` trait:
    - `value(self): number` -- return custom value, or 0 to indicate "use default"
  - Used by `Sellable` to optionally override the calculated sell value
  - Simple data trait with no logic beyond value exposure

**Phase B Summary (COMPLETED 2026-06-14)**: 11 files, ~2,400 TypeScript implementation lines, 11 test files with 425 unit tests all passing. PlayerResources (540 TS lines) is the central economy manager ported with correct [Sync] integration and overflow protection. StoresResources (219 TS lines) and StoresPlayerResources (288 TS lines) work together to bridge actor-level storage to player-level capacity. CashTrickler (294 TS lines), GivesBounty (268 TS lines), GivesCashOnCapture (232 TS lines), DeliversCash (298 TS lines), Sellable (314 TS lines), and Valued (76 TS lines) are all fully implemented with tests. AcceptsDeliveredCash (149 TS lines) and CustomSellValue (118 TS lines) are simple data/filter traits. Review: R1 COMPLETE (0 BLOCKER, 5 MAJOR resolved, 5 MINOR resolved), R2 PENDING. 6 commits: 4 implementation + 2 review fix commits.

---

### 3.3 Phase B-Optional: Extended Economy Traits

**Status**: OPTIONAL PLANNING (0/8)
**Complexity**: LOW-MEDIUM + LOW (8 files, ~592 lines total)
**Blocked by**: Phase A (ResourceLayer, Harvester, Refinery), Phase B (PlayerResources, StoresResources, Sellable, Valued)
**Blocks**: Nothing critical -- these are visual polish and edge-case traits

**Description**: These 8 additional traits provide visual enhancements and edge-case economy behaviors. They are NOT required for basic RTS gameplay but add polish and completeness. `ResourceValueMultiplier` (31 lines) modifies the cash value of resources. `GrantConditionOnPlayerResources` (64 lines) grants conditions based on player resource levels. The four render overlay/decorator traits (WithResourceLevelOverlay, WithResourceLevelSpriteBody, WithResourceStoragePipsDecoration, WithStoresResourcesPipsDecoration) add visual indicators for resource levels on buildings and units. `CarryableHarvester` (61 lines) allows carrying harvesters by transports. `SpawnActorsOnSell` (143 lines) spawns actors when a building is sold.

**Paradigm Shifts**:
- C# `ResourceValueMultiplier` stackable multiplier -> TypeScript `IResourceValueModifier.getResourceValueModifier()` product
- C# `WithResourceLevelOverlay` sequence overlay -> TypeScript `Animation` overlay on actor mesh with frame selection based on resource fill level
- C# `WithResourceStoragePipsDecoration` pip rendering -> Babylon.js `Sprite` instances positioned in a row above building mesh
- C# `WithStoresResourcesPipsDecoration` multi-type pips -> Color-coded `Sprite` instances per resource type
- C# `SpawnActorsOnSell` actor creation on sell -> TypeScript `GameWorldManager.createActor()` with spawn positions

#### 3.3.1 ResourceValueMultiplier

- [ ] **TODO-10.B-Opt.1** `src/OpenRA.Mods.Common/Traits/Multipliers/ResourceValueMultiplier.ts` (31 lines C#) -- Resource value modifier:
  - `ResourceValueMultiplierInfo` config class:
    - `Modifier: number` = 100 -- percentage modifier (100 = normal, 200 = double)
  - `ResourceValueMultiplier` trait (`IResourceValueModifier`):
    - `getResourceValueModifier(): number` -- returns `Modifier / 100`
  - Used by Refinery and ResourcePurifier to modify resource sale value
  - Stackable: multiple ResourceValueMultiplier traits multiply together
  - Integration with `Refinery.acceptResources()` for cash conversion

#### 3.3.2 GrantConditionOnPlayerResources

- [ ] **TODO-10.B-Opt.2** `src/OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnPlayerResources.ts` (64 lines C#) -- Resource-level condition:
  - `GrantConditionOnPlayerResourcesInfo` config class:
    - `ResourceType: string` -- which resource to check
    - `Condition: string` -- condition to grant
    - `Threshold: number` -- minimum resource amount to trigger
  - `GrantConditionOnPlayerResources` trait (`INotifyCreated`, `ITick`):
    - Checks `PlayerResources.resources[ResourceType] >= Threshold`
    - Grants condition token via `ConditionManager` when above threshold
    - Revokes condition token when below threshold
    - Periodic check every N ticks (efficiency optimization deferred)
  - Used for visual upgrades based on resource stockpiles (e.g., silo fills up, gets bigger model)

#### 3.3.3 WithResourceLevelOverlay

- [ ] **TODO-10.B-Opt.3** `src/OpenRA.Mods.Common/Traits/Render/WithResourceLevelOverlay.ts` (69 lines C#) -- Resource fill overlay:
  - `WithResourceLevelOverlayInfo` config class:
    - `Sequence: string` -- overlay sprite sequence name
    - `Palette: string` -- palette for rendering
    - `ResourceType: string` -- which resource to track
  - `WithResourceLevelOverlay` trait (render trait, `ITickRender`):
    - Overlays a sprite on top of the actor mesh
    - Sprite frame = floor(resourceFillLevel * sequenceLength)
    - `resourceFillLevel = stored / capacity` from `IStoresResources` or `PlayerResources`
    - Frame update via `Animation` frame change
  - 3D: Overlay mesh positioned slightly above actor mesh; UV updated per frame to show correct fill level

#### 3.3.4 WithResourceLevelSpriteBody

- [ ] **TODO-10.B-Opt.4** `src/OpenRA.Mods.Common/Traits/Render/WithResourceLevelSpriteBody.ts` (75 lines C#) -- Resource-based sprite body:
  - `WithResourceLevelSpriteBodyInfo` config class:
    - `Levels: number[]` -- density thresholds for each body frame
    - `ResourceType: string` -- which resource to track
  - `WithResourceLevelSpriteBody` trait (render trait, replaces `WithSpriteBody`):
    - Selects sprite body frame based on resource fill level
    - `Levels` array: if fillLevel >= Levels[i], use frame i+1 (with frame 0 being empty)
    - Frame 0 when empty; last frame when >= Levels[last]
    - Replaces `WithSpriteBody` -- uses same rendering infrastructure
  - Used by silo buildings that visually change as they fill

#### 3.3.5 WithResourceStoragePipsDecoration

- [ ] **TODO-10.B-Opt.5** `src/OpenRA.Mods.Common/Traits/Render/WithResourceStoragePipsDecoration.ts` (79 lines C#) -- Resource capacity pip indicators:
  - `WithResourceStoragePipsDecorationInfo` config class:
    - `PipCount: number` = 5 -- number of pips to display
    - `PipSequence: string` -- sprite sequence for pip
    - `Palette: string` -- palette for pip rendering
    - `ResourceType: string` -- which resource to display
  - `WithResourceStoragePipsDecoration` trait (render trait):
    - Displays a row of pip sprites showing resource fill percentage
    - Filled pips count = floor(fillLevel * PipCount)
    - Pips positioned in a horizontal row above actor mesh
    - Pip sprites: filled (green) vs empty (gray) frames from sequence
  - 3D: `Sprite` instances positioned in a line using local offsets above actor mesh center

#### 3.3.6 WithStoresResourcesPipsDecoration

- [ ] **TODO-10.B-Opt.6** `src/OpenRA.Mods.Common/Traits/Render/WithStoresResourcesPipsDecoration.ts` (101 lines C#) -- Multi-type resource pips:
  - `WithStoresResourcesPipsDecorationInfo` config class:
    - `PipCount: number` = 5 -- number of pips per resource type
    - `PipSequences: Map<string, string>` -- pip sequence per resource type
    - `Palette: string`
  - `WithStoresResourcesPipsDecoration` trait (render trait):
    - Displays multiple rows of pips, one row per resource type
    - Color-coded by resource type (via different sprite sequences)
    - Row ordering: descending by stored amount
    - Integration with `IStoresResources.contents` for per-type counts
  - Similar to `WithResourceStoragePipsDecoration` but supports multiple resource types simultaneously

#### 3.3.7 CarryableHarvester

- [ ] **TODO-10.B-Opt.7** `src/OpenRA.Mods.Common/Traits/CarryableHarvester.ts` (61 lines C#) -- Carryable harvester interaction:
  - `CarryableHarvesterInfo` config class: no config fields (marker trait)
  - `CarryableHarvester` trait (`INotifyPickedUp`, `INotifyDelivered`):
    - `onPickup(self, transport)` -- harvester is picked up by carryall
    - `onDeliver(self, transport)` -- harvester is delivered/dropped
    - When picked up: preserve current cargo contents
    - When delivered: restore cargo contents
  - Used by Dune 2000 Carryall transport interactions with harvesters
  - Integration with transport mechanics (deferred to Ch19 mod-specific)

#### 3.3.8 SpawnActorsOnSell

- [ ] **TODO-10.B-Opt.8** `src/OpenRA.Mods.Common/Traits/SpawnActorsOnSell.ts` (143 lines C#) -- Spawn actors when sold:
  - `SpawnActorsOnSellInfo` config class:
    - `ActorTypes: string[]` -- actor types to spawn
    - `Faction: string` -- faction for spawned actors
    - `Probability: number` = 100 -- chance to spawn each actor type
    - `OwnerType: SpawnOwnerType` = "VictoryConditions" -- who owns spawned actors
  - `SpawnActorsOnSell` trait (`INotifySold`):
    - `sold(self)` -- on sell, spawn configured actors at self's position
    - Actor creation via `GameWorldManager.createActor()`
    - Position: use `self.centerPosition` as spawn location
    - Owner: `SpawnOwnerType` enum (VictoryConditions, Self, Killer, InternalName)
    - Useful for spawning infantry from sold barracks, or debris from sold buildings
  - Integration with `GameWorldManager` (Ch3) for actor creation
  - Integration with `Sellable` (Ch10 Phase B) for sell notification

**Phase B-Optional Summary**: 8 files, ~592 C# lines source. All LOW to LOW-MEDIUM complexity. These are polish traits -- the game is functionally complete without them. The render overlay traits require `SequenceProvider` and `Animation` from Ch2 for sprite rendering. `SpawnActorsOnSell` (143 lines) is the largest in this group. Estimated ~35 unit tests. Estimated ~1,300 TypeScript implementation lines.

---

**Chapter 10 Total**: 17 core files + 8 optional files. ~2,333 + ~592 C# source lines. Estimated ~125 unit tests (core) + ~35 (optional). Estimated ~5,200 + ~1,300 TypeScript implementation lines.

---

## 4. Dependency Graph

```
Chapters 2-9 (COMPLETE -- Foundation)
  |
  +--> Phase A (Resource Infrastructure: 8 items)
  |     |
  |     |   TraitsInterfaces.ts expansion (IDockHost + IAcceptResources + IResourceLayer + IResourceRenderer + IStoresResources)
  |     |     |
  |     |     +--> DockClientBase.ts (new) -- abstract base class
  |     |     |     |
  |     |     |     +--> Harvester.ts (330 lines) -- extends DockClientBase, implements IStoresResources
  |     |     |           |
  |     |     |           +--> Phase B (StoresResources -- reference IStoresResources impl)
  |     |     |           +--> Phase B (PlayerResources -- Harvester delivers resources to player)
  |     |     |           +--> Phase B-opt (CarryableHarvester -- interacts with Harvester)
  |     |     |
  |     |     +--> ResourceLayer.ts (302 lines) -- IResourceLayer + CellLayer
  |     |     |     |
  |     |     |     +--> SeedsResource.ts (64 lines) -- uses IResourceLayer
  |     |     |     +--> Phase B (PlayerResources -- needs resource type info)
  |     |     |
  |     |     +--> ResourceRenderer.ts (386 lines) -- IResourceRenderer + TerrainSpriteLayer
  |     |     |     |
  |     |     |     +--> ResourceClaimLayer.ts (74 lines) -- independent, used by Harvester
  |     |     |
  |     |     +--> Refinery.ts (110 lines) -- IAcceptResources + IDockHost
  |     |           |
  |     |           +--> Phase B (StoresPlayerResources -- bridges to PlayerResources)
  |     |           +--> Phase B-opt (ResourceValueMultiplier -- modifies resource value)
  |     |
  |     +--> Phase B (StoresResources -- needs IStoresResources from interface expansion)
  |
  +--> Phase B (Economy Support Traits: 11 files)
  |     |
  |     |   StoresResources.ts (107 lines) -- IStoresResources implementation
  |     |   StoresPlayerResources.ts (67 lines) -- bridges IStoresResources to PlayerResources
  |     |     |
  |     |     +--> PlayerResources.ts (264 lines) -- central economy manager
  |     |           |
  |     |           +--> CashTrickler.ts (113 lines) -- uses PlayerResources.addCash()
  |     |           +--> GivesBounty.ts (91 lines) -- uses PlayerResources.addCash()
  |     |           +--> GivesCashOnCapture.ts (62 lines) -- uses PlayerResources.addCash()
  |     |           +--> DeliversCash.ts (128 lines) -- uses PlayerResources.addCash()
  |     |           +--> Sellable.ts (122 lines) -- uses PlayerResources.addCash()
  |     |           +--> Phase B-opt (GrantConditionOnPlayerResources -- checks PlayerResources.resources)
  |     |
  |     |   Valued.ts (25 lines) -- simple data trait (independent)
  |     |     |
  |     |     +--> GivesBounty.ts -- reads Valued.Cost for bounty calc
  |     |     +--> Sellable.ts -- reads Valued.Cost for refund calc
  |     |     +--> Phase B-opt (SpawnActorsOnSell)
  |     |
  |     |   AcceptsDeliveredCash.ts (50 lines) -- independent filter trait
  |     |     +--> DeliversCash.ts -- checks AcceptsDeliveredCash for delivery validity
  |     |
  |     |   CustomSellValue.ts (38 lines) -- independent data trait
  |           +--> Sellable.ts -- overrides sell value if present
  |
  +--> Phase B-Optional (Extended Economy Traits: 8 files)
        |
        |   ResourceValueMultiplier.ts (31 lines) -- IResourceValueModifier
        |   GrantConditionOnPlayerResources.ts (64 lines) -- needs PlayerResources
        |   WithResourceLevelOverlay.ts (69 lines) -- render trait
        |   WithResourceLevelSpriteBody.ts (75 lines) -- render trait
        |   WithResourceStoragePipsDecoration.ts (79 lines) -- render trait
        |   WithStoresResourcesPipsDecoration.ts (101 lines) -- render trait
        |   CarryableHarvester.ts (61 lines) -- needs Harvester
        |   SpawnActorsOnSell.ts (143 lines) -- needs Sellable + Valued
```

### Critical Path

```
TraitsInterfaces (IDockHost + IStoresResources + IResourceLayer + IResourceRenderer + IAcceptResources)
  -> DockClientBase -> Harvester -> Refinery -> StoresResources -> StoresPlayerResources -> PlayerResources
                                                                       \-> ResourceLayer -> ResourceRenderer -> ResourceClaimLayer -> SeedsResource
```

### Parallelization Opportunities

- **Phase A internal**: `TraitsInterfaces.ts` expansion (TODO-10.A.0b) MUST be done first -- all other files depend on these interfaces. `DockClientBase` (TODO-10.A.0) must be done before `Harvester`. `ResourceLayer` and `ResourceRenderer` can be done in parallel with each other. `SeedsResource` can be done after `ResourceLayer` interface is available. `ResourceClaimLayer` is independent and can be done in parallel. `Refinery` can be done after `IAcceptResources` and `IDockHost` are defined.

- **Phase B vs Phase A**: `Valued`, `AcceptsDeliveredCash`, `CustomSellValue` (all independent data traits) can begin as soon as their config classes are structured. `StoresResources` can begin after its interface is finalized. `CashTrickler`, `GivesBounty`, `GivesCashOnCapture` can begin after `PlayerResources` interface is known. `PlayerResources` must wait for `IStoresResources` interface and `StoresPlayerResources` pattern. `Sellable` must wait for `Valued` and `PlayerResources`.

- **Phase B-Optional vs Phase B**: All 8 optional traits can be parallel-assigned once their Phase B prerequisites are met.

- **Phase B internal**: `Valued`, `AcceptsDeliveredCash`, `CustomSellValue` are independent and trivially small. `StoresResources` and `StoresPlayerResources` are closely linked and should be done sequentially. `PlayerResources` is the central hub and must be done after `StoresPlayerResources`. The 5 cash-modifying traits (CashTrickler, GivesBounty, GivesCashOnCapture, DeliversCash, Sellable) can be parallel-assigned once `PlayerResources` is done.

### Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| IDockHost interface | Must be in TraitsInterfaces.ts before DockClientBase or Refinery |
| IAcceptResources interface | Must be in TraitsInterfaces.ts before Refinery |
| IResourceLayer interface | Must be in TraitsInterfaces.ts before ResourceLayer, ResourceRenderer, SeedsResource |
| IResourceRenderer interface | Must be in TraitsInterfaces.ts before ResourceRenderer |
| IStoresResources interface | Must be in TraitsInterfaces.ts before Harvester, StoresResources, StoresPlayerResources |
| DockClientBase | Must be complete before Harvester (Harvester extends it) |
| Harvester | Must be complete before ResourceClaimLayer can be used (ResourceClaimLayer is used by Harvester) |
| ResourceLayer | Must be complete before ResourceRenderer (ResourceRenderer reads ResourceLayer data) |
| ResourceLayer | Must be complete before SeedsResource (SeedsResource writes via IResourceLayer) |
| Refinery | Must be complete before StoresPlayerResources integration (Refinery uses StoresPlayerResources pattern) |
| PlayerResources | Must be complete before all cash-modifying traits (CashTrickler, GivesBounty, GivesCashOnCapture, DeliversCash, Sellable) |
| Valued | Must be complete before GivesBounty, Sellable (both read Valued.Cost) |
| BuildingInfluence | Can be initially stubbed for ResourceLayer (full integration when Ch11 Phase B completes) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns per phase:

#### Phase A Tests (ALL COMPLETE: 344 tests across 7 test files)

- [x] **TEST-10.1** DockClientBase: `CanDock()` returns true for compatible DockType host, false for incompatible; abstract methods throw if not overridden
- [x] **TEST-10.2** Harvester: `isFull` returns true when cargo equals capacity; `isEmpty` returns true when cargo is zero
- [x] **TEST-10.3** Harvester: `canHarvestCell()` returns true for cell with compatible resource, false for empty or incompatible cell
- [x] **TEST-10.4** Harvester: `findResourceField()` returns cell with resource within search radius, null when no resources nearby
- [x] **TEST-10.5** Harvester: `getSpeedModifier()` returns `FullyLoadedSpeed / 100` when full, 1.0 when empty
- [x] **TEST-10.6** Harvester: `issueOrder()` returns Harvest order for resource cell, null for non-resource cell
- [x] **TEST-10.7** Harvester: `resolveOrder("Harvest")` creates harvest activity stub; `resolveOrder("Deliver")` creates deliver activity stub
- [x] **TEST-10.8** ResourceLayer: `addResource()` adds resource to empty cell; respects `MaxDensity`; returns correct leftover amount
- [x] **TEST-10.9** ResourceLayer: `removeResource()` removes resource from cell; returns correct leftover if not enough density
- [x] **TEST-10.10** ResourceLayer: `clearResources()` sets cell to `EMPTY`; fires `CellChanged` event with null resourceType
- [x] **TEST-10.11** ResourceLayer: `recalculateResourceDensity()` correctly adjusts density based on neighbor counts
- [x] **TEST-10.12** ResourceLayer: `addResource()` on cell with building blocking returns full amount as leftover (if BuildingInfluence active)
- [x] **TEST-10.13** ResourceLayer: initialization from Map.Resources correctly maps byte indices to resource types
- [x] **TEST-10.14** ResourceRenderer: `addVisibleCell()` adds cell to dirty set; `updateCell()` marks cell dirty for re-render
- [x] **TEST-10.15** ResourceRenderer: sprite frame calculation: `lerp(0, length-1, density, maxDensity)` returns correct frame index
- [x] **TEST-10.16** ResourceClaimLayer: `TryClaimCell()` succeeds for unclaimed cell; fails if already claimed by same-player harvester
- [x] **TEST-10.17** ResourceClaimLayer: `RemoveClaim()` releases claim; subsequent `TryClaimCell()` succeeds
- [x] **TEST-10.18** SeedsResource: `tick()` adds resource to random cell within range after `Interval` ticks
- [x] **TEST-10.19** Refinery: `acceptResources()` in UseStorage mode stores in PlayerResources, returns 0 when space available
- [x] **TEST-10.20** Refinery: `acceptResources()` in direct-cash mode converts resources to cash, returns 0 (all accepted)
- [x] **TEST-10.21** Refinery: `acceptResources()` returns leftover when UseStorage and silos are full and `DiscardExcessResources` is false
- [x] **TEST-10.22** Refinery: `canDock()` returns true for DockType.Unload clients

#### Phase B Tests

- [x] **TEST-10.23** StoresResources: `addResource()` adds up to capacity, returns leftover; `removeResource()` removes up to current amount
- [x] **TEST-10.24** StoresResources: `contentsSum` correctly tracks total stored units after add/remove operations
- [x] **TEST-10.25** StoresResources: `ContentHash` produces deterministic hash value for sync validation
- [x] **TEST-10.26** StoresPlayerResources: `addedToWorld()` calls `PlayerResources.addStorageCapacity()` with correct capacity
- [x] **TEST-10.27** StoresPlayerResources: `removedFromWorld()` calls `PlayerResources.removeStorageCapacity()` with correct capacity
- [x] **TEST-10.28** StoresPlayerResources: owner change adjusts storage on both old and new owner
- [x] **TEST-10.29** PlayerResources: `addCash()` correctly increments cash balance; `Number.isSafeInteger()` overflow protection caps at MAX_SAFE_INTEGER
- [x] **TEST-10.30** PlayerResources: `takeCash()` returns false when insufficient funds; returns true and decrements when sufficient
- [x] **TEST-10.31** PlayerResources: `canAfford()` returns true for cost <= cash, false for cost > cash
- [x] **TEST-10.32** PlayerResources: `addResourceStorage()` respects total capacity; returns leftover when full
- [x] **TEST-10.33** PlayerResources: `addStorageCapacity()` / `removeStorageCapacity()` correctly adjust total capacity
- [x] **TEST-10.34** PlayerResources: sync hash fields update correctly after cash and resource changes
- [x] **TEST-10.35** CashTrickler: `tick()` grants cash at correct interval; does not grant at non-interval ticks
- [x] **TEST-10.36** Valued: `cost` getter returns `info.Cost` value correctly
- [x] **TEST-10.37** GivesBounty: `killed()` grants correct bounty amount to attacker based on victim's Valued.Cost * Percentage
- [x] **TEST-10.38** GivesBounty: `ValidRelationships` filter prevents bounty grant to allies
- [x] **TEST-10.39** GivesCashOnCapture: `onCapture()` grants cash to new owner
- [x] **TEST-10.40** DeliversCash: `issueOrder()` returns DeliverCash order when targeting AcceptsDeliveredCash actor
- [x] **TEST-10.41** AcceptsDeliveredCash: `acceptsDelivery()` returns true for matching type and valid relationship
- [x] **TEST-10.42** Sellable: `sellValue()` calculates correct refund: Valued.Cost * healthPercent * RefundPercent / 100
- [x] **TEST-10.43** Sellable: `resolveOrder("Sell")` grants cash to player, removes actor from world
- [x] **TEST-10.44** Sellable: `issueOrder()` returns null when `RequiresCondition` is not satisfied
- [x] **TEST-10.45** CustomSellValue: `value()` returns configured override value

#### Phase B-Optional Tests

- [ ] **TEST-10.46** ResourceValueMultiplier: `getResourceValueModifier()` returns correct modifier ratio
- [ ] **TEST-10.47** GrantConditionOnPlayerResources: grants condition when resources >= threshold; revokes when below
- [ ] **TEST-10.48** WithResourceLevelOverlay: selects correct sprite frame based on fill level ratio
- [ ] **TEST-10.49** WithResourceLevelSpriteBody: selects correct body frame for each density threshold level
- [ ] **TEST-10.50** WithResourceStoragePipsDecoration: calculates correct number of filled pips
- [ ] **TEST-10.51** WithStoresResourcesPipsDecoration: displays correct pip rows per resource type
- [ ] **TEST-10.52** CarryableHarvester: preserves cargo contents across pickup/deliver cycle
- [ ] **TEST-10.53** SpawnActorsOnSell: spawns correct actor types at correct position on sell

### 5.2 Per-Phase Test File Estimates

| Phase | Files | Test Files | Estimated Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Resource Infrastructure | 8 (6 + interface + base) | 7 | 344 | ~6,224 |
| B: Economy Support | 11 | 11 | 425 | ~2,900 |
| B-opt: Extended Economy | 8 | 6 | ~35 | ~1,800 |
| **Total (core)** | **17** | **18** | **769** | **~9,124** |

### 5.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Resource rendering | `/test/resource/rendering/` | Verify resource sprites appear on terrain at correct cell positions, sprite frames respond to density, variants render correctly |
| Resource color per type | `/test/resource/color-mapping/` | Verify different resource types (Tiberium, Ore, Spice) render with correct colors and sprite sequences |
| Harvester gathering | `/test/resource/harvesting/` | Verify harvester moves to resource, plays harvest animation, cargo fills, moves to refinery |
| Refinery processing | `/test/resource/refinery/` | Verify refinery dock, harvester unloads, floating cash text appears, cash increments |
| Full economy loop | `/test/resource/economy-loop/` | Integrated test: resource spawn -> harvester collect -> refinery process -> cash increase -> production queue enabled |
| Resource pip display | `/test/resource/pips/` | Verify resource storage pips on silos update correctly as resources are added/removed |
| Sell building | `/test/economy/sell/` | Verify sell button works, refund calculated correctly, actor removed, cash added |

### 5.4 Integration Testing

- [ ] **TEST-10.I1** Full economy loop: spawn resource -> harvester moves to resource (via IMove) -> collects resource (via IResourceLayer) -> moves to refinery (via PathFinder) -> docks (via IDockHost/IDockClient) -> unloads (via IAcceptResources/IStoresResources) -> cash increments (via PlayerResources)
- [ ] **TEST-10.I2** Multi-harvester competition: 3 harvesters from same player, resources limited to 2 cells; verify ResourceClaimLayer prevents more than 1 harvester per cell
- [ ] **TEST-10.I3** Cash transfer chain: actor killed (GivesBounty) -> cash to killer; actor captured (GivesCashOnCapture) -> cash to captor; actor sold (Sellable) -> cash to owner
- [ ] **TEST-10.I4** Capacity overflow: Silo at max capacity, harvester attempts delivery; Refinery with `DiscardExcessResources` discards, without it bounces harvester
- [ ] **TEST-10.I5** Resource density recalculation: harvest some resources from cell, verify `RecalculateResourceDensity` adjusts neighbor densities correctly
- [ ] **TEST-10.I6** Cash flow: CashTrickler (Oil Derrick) grants periodic cash, verify total over N ticks matches expected Amount * floor(N / Interval)
- [ ] **TEST-10.I7** Sync verification: Capture sync hashes for PlayerResources cash and resource state over 100 ticks; verify deterministic across multiple state snapshots

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **DockClientBase + Harvester docking contract** | HIGH | Broken docking interface causes harvesters to get stuck at refinery or never deliver resources | Port DockClientBase line-for-line from C#; validate `CanDock`/`OnDockStarted`/`OnDockTick`/`OnDockCompleted` call sequence with unit tests; test Harvester + Refinery integration end-to-end |
| **BuildingInfluence not yet migrated** | MEDIUM | ResourceLayer cannot check building occupancy; resources may spawn under buildings | Implement ResourceLayer without BuildingInfluence initially (stub returns false); add full integration when Ch11 Phase B completes; resources spawning under buildings is a cosmetic-only issue |
| **ResourceRenderer TerrainSpriteLayer integration** | MEDIUM | Sprite positioning offsets, variant selection, or dirty cell updates cause flickering or incorrect resource visuals | Leverage existing TerrainSpriteLayer (Ch2) which is battle-tested; validate cell-to-3D-position conversion with CoordinateTransformer; validate dirty cell batch update correctness with known cell-state transitions |
| **PlayerResources dual-currency [Sync] parity** | MEDIUM | Cash or resource sync hash mismatch causes desync in multiplayer | Port C# `[Sync]` field hash calculation line-for-line; validate hash stability over 1000 ticks with randomized cash/resource operations |
| **Cash overflow with large economies** | LOW | `Number.MAX_SAFE_INTEGER` (9 quadrillion) is vastly larger than any practical RTS economy | `Number.isSafeInteger()` check is defensive but will never trigger in normal gameplay; log warning for debugging |
| **Sellable health-based refund calculation** | LOW | Incorrect health ratio provides wrong refund amount | Validate refund = `Valued.Cost * (currentHealth / maxHealth) * RefundPercent / 100`; test at 0%, 50%, 100% health |
| **Harvester fullness speed modifier** | LOW | Incorrect speed modifier makes full harvesters too fast or too slow | Validate `getSpeedModifier()` returns `FullyLoadedSpeed / 100` when full; test speed multiplier stacking with Ch9 SpeedMultiplier |
| **ResourceClaimLayer cross-player contention** | LOW | Players' harvesters incorrectly block each other from resource cells | Validate `CanClaimCell()` only blocks same-player harvesters; different players can claim same cell |
| **WithSpriteBody dependency for Refinery** | LOW | Refinery requires WithSpriteBodyInfo which may not be fully migrated | Check if WithSpriteBody is available from Ch7 Phase G; if not, Refinery can use a stub or minimal WithSpriteBody implementation |
| **Lobby options for PlayerResources** | LOW | ILobbyOptions lobby integration requires Ch16 UI widgets which are not yet available | Stub `lobbyOptions()` method initially; actual lobby UI integration happens in Chapter 16 |

### 6.1 Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| ResourceLayer.addResource() per call | < 0.05ms | Fast CellLayer access; called at most once per harvester per tick |
| ResourceLayer.recalculateResourceDensity() full map | < 5ms (256x256 map) | Only called once at map init; incremental recalc per cell is O(1) |
| ResourceRenderer dirty cell batch update | < 1ms for 100 cells/tick | TerrainSpriteLayer.update() is GPU-efficient; dirty cell batching reduces draw call changes |
| Harvester.findResourceField() | < 2ms for 24-cell radius | O(n) scan of nearby cells; occurs once per search (not per tick) |
| PlayerResources.addCash() / takeCash() | < 0.01ms | Simple integer arithmetic; called frequently during economy operations |
| CashTrickler tick (N actors) | < 0.01ms per actor | Simple interval check + addCash() |

### 6.2 Deferred Features

| Feature | Files | Lines | Reason for Deferral |
|:---|:---|:---:|:---|
| FindAndDeliverResources Activity | Inside Harvester | ~200 (Ch14) | Activity implementation belongs in Chapter 14 Phase D. Harvester provides factory methods returning stubs. |
| HarvestOrderTargeter (orders) | Inside Harvester | ~60 (Ch15) | Order generator implementation deferred to Chapter 15. |
| SellOrderTargeter (orders) | Inside Sellable | ~50 (Ch15) | Order generator implementation deferred to Chapter 15. |
| BuildingInfluence integration | Inside ResourceLayer | ~30 (Ch11) | Full building occupancy checking deferred to Chapter 11 Phase B. Initial implementation treats all cells as unblocked. |
| ILobbyOptions lobby integration | Inside PlayerResources | ~40 (Ch16) | Lobby UI widgets deferred to Chapter 16. Initial implementation uses `DefaultCash` directly. |
| Shroud visibility integration | Inside ResourceLayer | ~20 (Ch12) | `isVisible(cell, player)` always returns true initially. Fog-of-war resource hiding deferred to Chapter 12. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-10.1: Resource Rendering via TerrainSpriteLayer

- **Decision**: Resource sprites are rendered using the existing Chapter 2 `TerrainSpriteLayer` infrastructure. Each resource type gets its own `TerrainSpriteLayer`, with sprite positions calculated at cell centers via `CoordinateTransformer.cellToVector3()` with Y-offset from `CellRamp` data for terrain-following behavior.
- **Rationale**: `TerrainSpriteLayer` is already battle-tested from Chapter 2 and provides efficient batch rendering of billboard sprites on the terrain ground-plane. It supports incremental dirty-cell updates (only affected cells re-render) and integrates with the existing `WorldRenderer` render pipeline. Creating a new resource-specific rendering system would duplicate effort and increase maintenance burden.
- **Mitigation**: The `ResourceRenderer` trait manages all resource-specific logic (variant selection, density-based frame calculation, dirty cell tracking) and delegates actual GPU rendering to `TerrainSpriteLayer.update()`. This separation keeps the rendering layer generic and the resource layer focused on game logic.

### ADR-10.2: Resource Data Storage via CellLayer with Immutable Records

- **Decision**: `ResourceLayer` stores resource data using a `CellLayer<ResourceContents>` where `ResourceContents` is a TypeScript `interface { type: string; density: number }` with `Object.freeze()` applied to the `EMPTY` sentinel. This replaces the C# `readonly struct ResourceLayerContents`.
- **Rationale**: The Chapter 4 `CellLayer` infrastructure provides typed, grid-indexed storage with bounds checking. Using plain JavaScript objects (instead of classes) keeps serialization simple and reduces memory overhead. `Object.freeze()` on the `EMPTY` sentinel prevents accidental mutation of the default value while allowing normal mutation of non-empty cells.
- **Mitigation**: All public access to resource data goes through `IResourceLayer` methods (`getResource`, `addResource`, `removeResource`) rather than direct `CellLayer` access. This ensures data integrity and allows future optimizations (e.g., compression) without affecting consumers.

### ADR-10.3: Harvester Activities Deferred to Chapter 14

- **Decision**: Chapter 10 provides factory methods on `Harvester` (`createHarvestActivity`, `createDeliverActivity`) that return `Activity` stubs. The actual `FindAndDeliverResources` Activity implementation is deferred to Chapter 14 Phase D.
- **Rationale**: `FindAndDeliverResources` is a complex state machine (estimated ~200 lines) that orchestrates resource search, pathfinding to resource, harvesting, pathfinding to refinery, docking, and unloading. Implementing it in Chapter 10 would delay the resource infrastructure layer. This follows the same pattern as Chapter 9 where `Mobile` provides factory methods for movement Activities but the Activities themselves are in Chapter 14.
- **Mitigation**: Activity stubs implement the `Activity` base class interface (from Ch3 Phase F) with `cancel()` and `tick()` that immediately completes. This allows `orderManager.resolveOrder()` to work with stub activities during Phase A-B development. Integration tests can verify that the correct stub type is returned for each factory method.

### ADR-10.4: DockClientBase as Abstract Generic Base Class

- **Decision**: `DockClientBase<T extends DockClientBaseInfo>` is migrated as an abstract generic class in TypeScript. It provides the docking lifecycle (`CanDock`, `OnDockStarted`, `OnDockTick`, `OnDockCompleted`) and order handling. Subclasses (Harvester, RepairClient, etc.) override the abstract docking methods.
- **Rationale**: OpenRA uses `DockClientBase` as a reusable pattern for docking units. Harvester (resource delivery), RepairClient (repair depot), and other docking actors all share this base. Migrating it as a first-class TypeScript abstract class enables code reuse and type safety. The generic parameter `<T>` allows subclasses to define their specific `Info` config types.
- **Mitigation**: The actual docking Activity (MoveToDock, Dock) is deferred to Chapter 14. `DockClientBase` provides the trait-level docking callbacks that the Activity will invoke. This separation allows Phase A to ship with complete trait logic while deferring the Activity state machines.

### ADR-10.5: PlayerResources Dual-Currency with Safe Integer Checks

- **Decision**: `PlayerResources` manages both Cash (simple integer) and Resources (keyed by resource type string). Cash overflow protection uses `Number.isSafeInteger()` checks. The `[Sync]` pattern from C# maps to TypeScript `Sync` trait registration (Ch6 Phase B) with deterministic hash computation.
- **Rationale**: OpenRA's `PlayerResources` uses `int` for cash (max ~2.1 billion) and stored resources. JavaScript's `Number` is a double with exact integer precision up to `Number.MAX_SAFE_INTEGER` (~9 quadrillion), which is vastly larger than any practical RTS economy. The `Number.isSafeInteger()` check is purely defensive and will never trigger in normal gameplay. The dual-currency system (cash + stored resources) is essential for RTS gameplay where some resources must be physically collected and stored before use.
- **Mitigation**: Sync hash computation follows the same formula as C#: `ContentHash = reduce((acc, [type, count]) => acc + (count << type.length), 0)`. This ensures deterministic cross-client state verification.

### ADR-10.6: Sellable Refund Pattern

- **Decision**: The `Sellable` trait calculates refunds as `Valued.Cost * healthPercent * RefundPercent / 100`. The actor is removed from the world via `GameWorldManager.removeActor()`. The sell order is handled through the existing `IResolveOrder` infrastructure from Chapter 6 Phase A.
- **Rationale**: This formula mirrors OpenRA's exact sell logic: the refund is proportional to both the base cost and current health. A damaged building sells for less, incentivizing repair before sale. The `CustomSellValue` trait can override this calculation entirely. Using the existing `IResolveOrder` pattern keeps the sell button consistent with all other orders.
- **Mitigation**: The `SellOrderTargeter` (UI order generator for the sell button/ hotkey) is deferred to Chapter 15. The trait-level `resolveOrder("Sell")` is implemented in full.

### ADR-10.7: BuildingInfluence Deferred Integration

- **Decision**: `ResourceLayer` is initially implemented without `BuildingInfluence` integration. The `BuildingInfluence` check in `addToCell()` is stubbed to always return false (no building blocking). Full integration happens when Chapter 11 Phase B completes.
- **Rationale**: `BuildingInfluence` is a Chapter 11 trait that tracks which cells are occupied by buildings. Implementing it now would require pulling in Chapter 11 dependencies prematurely. Resources spawning under buildings is a cosmetic issue that does not affect core economy functionality. The stub is clearly marked with `TODO-10.A.2` and `TODO-11.B.X` cross-references.
- **Mitigation**: The stub is a one-line change: `isBlockedByBuilding(cell) { return false; }`. When BuildingInfluence is migrated, replacing this with real logic is trivial and does not affect any other ResourceLayer behavior.

---

## Migration Order and Phasing Strategy

| Step | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A (interface) | 1 | TraitsInterfaces.ts expansion -- IDockHost, IAcceptResources, IResourceLayer, IResourceRenderer, IStoresResources | NO (blocks everything) |
| 2 | Phase A (base class) | 1 | DockClientBase.ts -- abstract generic base class | After step 1 |
| 3 | Phase A (core traits) | 2 | ResourceLayer.ts (302 lines) + ResourceRenderer.ts (386 lines) | YES (with each other, after step 1) |
| 4 | Phase A (claim layer) | 1 | ResourceClaimLayer.ts (74 lines) | After step 3 (needs ResourceLayer concept) |
| 5 | Phase A (harvester + refinery) | 2 | Harvester.ts (330 lines) + Refinery.ts (110 lines) | After step 2 (DockClientBase) |
| 6 | Phase A (seeds) | 1 | SeedsResource.ts (64 lines) | After step 3 (ResourceLayer) |
| 7 | Phase B (data traits) | 3 | Valued.ts (25) + AcceptsDeliveredCash.ts (50) + CustomSellValue.ts (38) | YES (all independent after step 1) |
| 8 | Phase B (storage chain) | 2 | StoresResources.ts (107) + StoresPlayerResources.ts (67) | Sequential (StoresPlayerResources needs StoresResources) |
| 9 | Phase B (economy hub) | 1 | PlayerResources.ts (264 lines) | After step 8 |
| 10 | Phase B (cash modifiers) | 5 | CashTrickler + GivesBounty + GivesCashOnCapture + DeliversCash + Sellable | YES (all 5 parallel after step 9) |
| 11 | Phase B-Optional | 8 | All extended economy traits | YES (all parallel after steps 5, 9) |

**Estimated Total**: ~3-4 weeks (single developer, sequential). Can be compressed to ~1.5 weeks with parallel assignment of LOW complexity files.

---

> **Chapter 10 milestone**: The first economy-focused chapter. When complete, resources will be visible on the map, harvesters will collect and deliver them, refineries will process them into cash, and the player's economy (cash + stored resources) will drive production. This chapter provides the `PlayerResources` and `IStoresResources` foundation on which Production queues (Ch11), ResourceBarWidget (Ch16), and mod-specific resources (Ch19) all depend.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.3 -- Chapter 10 outline and key paradigm shifts
> - `docs/chapter9_movement_physics_migration_plan.md` -- Chapter 9 plan (format reference)
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Chapter 8 plan (format reference)
> - `docs/map_system_migration_plan.md` -- Chapter 4 plan (CellLayer, Map.Resources, TerrainInfo, CoordinateTransformer)
> - `docs/actor_system_migration_plan.md` -- Chapter 3 plan (TraitsInterfaces, ITick, INotifyCreated, Player)
> - `docs/network_sync_migration_plan.md` -- Chapter 6 plan (Order, Sync, IIssueOrder, IResolveOrder)
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
