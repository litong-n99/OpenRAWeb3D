# OpenRA to Babylon.js Migration Plan: Chapter 11 -- Production & Building System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits -- Production, Building) + Section 4.6 (Orders)
> **Chapter Status**: PLANNING (0/25 migrated)
> **Planning Date**: 2026-06-14
> **Prerequisite**: Chapters 2-10 COMPLETE (299/299 files, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Production Queue System](#31-phase-a-production-queue-system)
   - 3.2 [Phase B: Building System](#32-phase-b-building-system)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Production & Building System is the **fourth gameplay logic chapter** of the project, following Weapons & Combat (Ch8), Movement & Physics (Ch9), and Resource & Economy (Ch10). Chapter 11 implements the core RTS base-building loop -- production queues manage build orders, buildings are placed on the terrain, construction progresses, and units exit production facilities.

The core paradigm shift: **from 2D grid-based building placement to 3D terrain-aware building placement with raycast-based ghost preview**:

- **Building footprint** maps from C# `FrozenDictionary<CVec, FootprintCellType>` to TypeScript `Map<string, FootprintCellType>` with string-keyed cell offsets (e.g., `"0,0"`, `"1,0"`)
- **Building placement preview** shifts from 2D sprite-based ghost rendering to 3D semi-transparent mesh preview positioned via `scene.onPointerMove` raycast to terrain
- **Production queue** shifts from C# `List<ProductionItem>` with LINQ operations to TypeScript `ProductionItem[]` with explicit loops for deterministic tick processing
- **Building construction state** (make/bake animation) maps to Babylon.js `Mesh` scaling/opacity interpolation or sprite frame cycling
- **Exit logic** for produced units shifts from 2D cell-based spawn to 3D world-position spawn with `TransformNode.position` direct set
- **Tech tree prerequisites** remain logic-driven but use JSON rule data instead of MiniYAML

### 1.2 Architecture Principles

1. **Production queue as deterministic state machine**: `ProductionQueue` and `ProductionItem` are pure logic classes with no rendering. Queue state (tick progress, cost, pause) is deterministic and `[Sync]`-compatible. Visual queue display (progress bars, icons) is handled by UI widgets (Ch16).

2. **Building placement preview via 3D ghost mesh**: The `PlaceBuildingOrderGenerator` creates a semi-transparent Babylon.js `Mesh` (or `InstancedMesh` for multi-cell footprints) that follows the mouse cursor via raycast-to-terrain. Valid/invalid placement is visualized via material color (green = valid, red = invalid).

3. **Footprint cell type preservation**: OpenRA's `FootprintCellType` enum (Empty, OccupiedPassable, Occupied, OccupiedUntargetable, OccupiedPassableTransitOnly) is preserved exactly. Building footprint parsing from JSON config uses the same character-based encoding (`x`, `X`, `=`, `_`, `+`).

4. **BuildingInfluence as CellLayer-backed spatial index**: `BuildingInfluence` uses the existing Chapter 4 `CellLayer` infrastructure with a linked-list-per-cell pattern (C# `InfluenceNode` -> TS `InfluenceNode` class). This enables O(1) lookup of buildings at any cell.

5. **Production trait variants via inheritance**: `Production` is the base class. `ProductionParadrop`, `ProductionAirdrop`, and `ProductionFromMapEdge` extend it with specific delivery mechanisms. `ClassicProductionQueue` extends `ProductionQueue` with shared-queue speed-up logic. TypeScript `extends` preserves this hierarchy.

6. **Event-driven building lifecycle**: `INotifyBuildingPlaced`, `INotifyProduction`, `INotifyOtherProduction` interfaces allow traits to react to building placement and unit production without direct cross-trait references. This preserves OpenRA's dependency inversion pattern.

7. **Base provider radius visualization**: `BaseProvider` range circles render as Babylon.js `LinesMesh` circles (or `TorusMesh` for 3D) at the provider's world position, colored by readiness state (white = ready, red = cooldown).

8. **JSON rule data over MiniYAML**: All building, production, and tech tree configuration consumed as JSON at runtime. The Ch4 Phase H MiniYAML-to-JSON build pipeline handles all YAML preprocessing.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-10 is available for Chapter 11:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, `TerrainSpriteLayer` |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, sprite rendering pipeline |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment, `TraitDictionary` |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `INotifyKilled`, `INotifyOwnerChanged`, `INotifySold`, `INotifyTransform`, `IResolveOrder`, `IIssueOrder`, `ISync` |
| Activity base class | Ch3 Phase F | `Activity` abstract class + `ActivityRunner` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Coordinate Primitives | Ch3 Phase A | `CPos`, `CVec`, `WPos`, `WVec`, `WAngle`, `WDist`, `WRot` |
| Map + Terrain + CellLayer | Ch4 | `Map`, `CellLayer`, `CellRegion`, `TerrainInfo`, `MapGrid`, `CellRamp` |
| Pathfinding | Ch4 Phase G | `HierarchicalPathFinder`, `PathSearch`, `DensePathGraph` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space conversion |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest`, `Ruleset` |
| Widget core | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager`, `IResolveOrder`, `IIssueOrder` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Keycode`, `Viewport`, `SelectionUtils` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` (build sounds, notifications) |
| Render traits | Ch7 Phase G | `RenderSprites`, `WithIdleOverlay`, `AnimationWithOffset` |
| Weapons & Combat | Ch8 | `Armament`, `AttackBase`, `WeaponInfo`, warheads, projectiles |
| Movement & Physics | Ch9 | `Mobile`, `IMove`, `Aircraft`, `Locomotor`, pathfinding |
| Resource & Economy | Ch10 | `PlayerResources`, `Valued`, `Harvester`, `Refinery`, `IStoresResources`, `IAcceptResources`, `Buildable` (Ch10 stub), `TechTree` (Ch10 stub) |

**NOT YET MIGRATED (blocking dependencies)**:

| System | OpenRA File | Status | Impact on Ch11 |
|--------|:---|:---|:---|
| `Buildable` | `OpenRA.Mods.Common/Traits/Buildable.cs` | PARTIAL (Ch10 stub) | Full implementation needed for production queue filtering |
| `TechTree` | `OpenRA.Mods.Common/Traits/Player/TechTree.cs` | PARTIAL (Ch10 stub) | Full implementation needed for prerequisite tracking |
| `PowerManager` | `OpenRA.Mods.Common/Traits/Player/PowerManager.cs` | NOT MIGRATED | Production queue low-power slowdown depends on this |
| `DeveloperMode` | `OpenRA.Mods.Common/Traits/Player/DeveloperMode.cs` | NOT MIGRATED | FastBuild, AllTech, BuildAnywhere cheats |
| `ActorInitializer` system | `OpenRA.Game/ActorInitializer.cs` | NOT MIGRATED | Building creation requires LocationInit, OwnerInit, FactionInit, etc. |
| `ActorMap` | `OpenRA.Game/Traits/World/ActorMap.cs` | NOT MIGRATED | Building placement checks actor occupancy |
| `World.CanPlaceBuilding` | `OpenRA.Game/World.cs` | NOT MIGRATED | Central placement validation logic |

> **Note**: Several of these dependencies are lightweight and can be stubbed for Phase A. `PowerManager` can initially return `PowerState.Normal` always. `DeveloperMode` can be a minimal stub with `FastBuild=false`, `AllTech=false`, `BuildAnywhere=false`. `ActorInitializer` is a TypeDictionary-like container that can be implemented as a simple `Map<string, any>`. `ActorMap` cell occupancy queries can be stubbed to check `BuildingInfluence` only. The full implementations of these dependencies will be completed in later phases or chapters.

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (25 files across 2 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Production Queue System** | | | | | | |
| 1 | `OpenRA.Mods.Common/Traits/Production.cs` | `src/OpenRA.Mods.Common/Traits/Production.ts` | `Production` | 156 | HIGH | A |
| 2 | `OpenRA.Mods.Common/Traits/Player/ProductionQueue.cs` | `src/OpenRA.Mods.Common/Traits/Player/ProductionQueue.ts` | `ProductionQueue`, `ProductionState`, `ProductionItem` | 813 | HIGH | A |
| 3 | `OpenRA.Mods.Common/Traits/Player/ClassicProductionQueue.cs` | `src/OpenRA.Mods.Common/Traits/Player/ClassicProductionQueue.ts` | `ClassicProductionQueue` | 161 | MEDIUM | A |
| 4 | `OpenRA.Mods.Common/Traits/ProductionParadrop.cs` | `src/OpenRA.Mods.Common/Traits/ProductionParadrop.ts` | `ProductionParadrop` | 166 | MEDIUM | A |
| 5 | `OpenRA.Mods.Common/Traits/ProductionFromMapEdge.cs` | `src/OpenRA.Mods.Common/Traits/ProductionFromMapEdge.ts` | `ProductionFromMapEdge` | 117 | MEDIUM | A |
| 6 | `OpenRA.Mods.Common/Traits/Buildings/ProductionAirdrop.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/ProductionAirdrop.ts` | `ProductionAirdrop` | 142 | MEDIUM | A |
| 7 | `OpenRA.Mods.Common/Traits/Buildings/Exit.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Exit.ts` | `Exit`, `ExitExts` | 96 | LOW | A |
| 8 | `OpenRA.Mods.Common/Traits/Buildings/RallyPoint.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/RallyPoint.ts` | `RallyPoint`, `RallyPointOrderTargeter` | 199 | MEDIUM | A |
| 9 | `OpenRA.Mods.Common/Traits/Buildings/PrimaryBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/PrimaryBuilding.ts` | `PrimaryBuilding`, `PrimaryExts` | 134 | MEDIUM | A |
| **Phase B: Building System** | | | | | | |
| 10 | `OpenRA.Mods.Common/Traits/Buildings/Building.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Building.ts` | `Building`, `BuildingInfo`, `FootprintCellType` | 356 | HIGH | B |
| 11 | `OpenRA.Mods.Common/Traits/Buildings/BuildingInfluence.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BuildingInfluence.ts` | `BuildingInfluence` | 92 | MEDIUM | B |
| 12 | `OpenRA.Mods.Common/Traits/Buildings/BaseBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BaseBuilding.ts` | `BaseBuilding` | 19 | LOW | B |
| 13 | `OpenRA.Mods.Common/Traits/Buildings/BaseProvider.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BaseProvider.ts` | `BaseProvider` | 135 | MEDIUM | B |
| 14 | `OpenRA.Mods.Common/Traits/Player/PlaceBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Player/PlaceBuilding.ts` | `PlaceBuilding`, `PlaceBuildingInit` | 268 | HIGH | B |
| 15 | `OpenRA.Mods.Common/Traits/Buildings/PlaceBuildingVariants.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/PlaceBuildingVariants.ts` | `PlaceBuildingVariants` | 32 | LOW | B |
| 16 | `OpenRA.Mods.Common/Traits/Buildings/Buildable.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Buildable.ts` | `Buildable` | 69 | LOW | B |
| 17 | `OpenRA.Mods.Common/Traits/Buildings/LineBuild.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/LineBuild.ts` | `LineBuild`, `LineBuildDirectionInit`, `LineBuildParentInit` | 125 | MEDIUM | B |
| 18 | `OpenRA.Mods.Common/Traits/Buildings/RequiresBuildableArea.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/RequiresBuildableArea.ts` | `RequiresBuildableArea` | 30 | LOW | B |
| 19 | `OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.ts` | `BuildingUtils` | 139 | MEDIUM | B |
| 20 | `OpenRA.Mods.Common/Traits/Buildings/RepairableBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/RepairableBuilding.ts` | `RepairableBuilding` | 208 | MEDIUM | B |
| 21 | `OpenRA.Mods.Common/Traits/Buildings/Gate.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Gate.ts` | `Gate` | 147 | MEDIUM | B |
| 22 | `OpenRA.Mods.Common/Traits/Transforms.cs` | `src/OpenRA.Mods.Common/Traits/Transforms.ts` | `Transforms` | 171 | MEDIUM | B |
| 23 | `OpenRA.Mods.Common/Traits/Demolition.cs` | `src/OpenRA.Mods.Common/Traits/Demolition.ts` | `Demolition` | 153 | MEDIUM | B |
| 24 | `OpenRA.Mods.Common/Traits/World/MapBuildRadius.cs` | `src/OpenRA.Mods.Common/Traits/World/MapBuildRadius.ts` | `MapBuildRadius` | 92 | LOW | B |
| 25 | `OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.ts` | `PlaceBuildingOrderGenerator`, `VariantWrapper`, `PlaceBuildingCellType` | 337 | HIGH | B |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies. 19-96 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple trait interactions or rendering integration. 92-208 lines of C# with significant Babylon.js visual components or state machine logic.
> - **HIGH**: Complex gameplay logic with state machines, spatial queries, or extensive trait coordination. 134-813 lines of C# with significant integration surface area.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 25 |
| **Phase A (Production Queue)** | 9 files |
| **Phase B (Building System)** | 16 files |
| **HIGH complexity** | 5 files (ProductionQueue 813, Building 356, PlaceBuilding 268, PlaceBuildingOrderGenerator 337, Production 156) |
| **MEDIUM complexity** | 13 files |
| **LOW complexity** | 7 files |
| **Total OpenRA C# source lines** | ~3,987 |

| Phase | Files | C# Lines | TS Lines (est.) | Tests (est.) | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Production Queue | 9 | ~2,084 | ~4,500 | ~250 | PLANNED |
| B: Building System | 16 | ~1,903 | ~4,000 | ~200 | PLANNED |
| **Total** | **25** | **~3,987** | **~8,500** | **~450** | **PLANNED** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Production Queue System

**Status**: PLANNED (0/9 migrated)
**Complexity**: HIGH (ProductionQueue 813 lines) + MEDIUM + LOW
**Blocked by**: Chapter 3 (World, Actor, TraitDictionary, ITick, IResolveOrder, ISync) -- COMPLETE, Chapter 6 (Order, IResolveOrder, Sync) -- COMPLETE, Chapter 10 (PlayerResources, Valued, Buildable stub, TechTree stub) -- COMPLETE
**Blocks**: Phase B (Building system needs production queues to test building placement), Chapter 14 (Activities use production for unit creation), Chapter 15 (Order generators queue production), Chapter 16 (ProductionPaletteWidget displays queues)

**Description**: Phase A implements the production queue infrastructure -- the system that manages what a player can build, how long it takes, and how units are delivered. `ProductionQueue` (813 lines) is the most complex file in this chapter. It manages queue state, build time calculation, cost deduction, prerequisite validation, low-power slowdown, and item cancellation. `Production` (156 lines) is the trait on buildings that actually creates units. `ClassicProductionQueue` (161 lines) extends it with shared-queue speed-up logic. `ProductionParadrop`, `ProductionAirdrop`, and `ProductionFromMapEdge` are delivery variants. `Exit` defines spawn points, `RallyPoint` defines post-production waypoints, and `PrimaryBuilding` designates the primary production structure.

**Paradigm Shifts**:
- C# `ProductionQueue.Queue: List<ProductionItem>` -> TypeScript `ProductionItem[]` with explicit array operations (no LINQ in hot paths)
- C# `ProductionQueue.Producible: Dictionary<ActorInfo, ProductionState>` -> TypeScript `Map<string, ProductionState>` keyed by actor name (ActorInfo not used as key in TS)
- C# `ProductionItem.Tick()` with `PlayerResources.TakeCash()` -> TypeScript `tick()` with `PlayerResources.takeCash()` and `Number.isSafeInteger()` checks
- C# `Production.DoProduction()` with `TypeDictionary` inits -> TypeScript `doProduction()` with `Map<string, any>` initializer bag
- C# `ExitExts.NearestExitOrDefault()` LINQ -> TypeScript explicit sort + filter loop
- C# `RallyPoint.Path: List<CPos>` -> TypeScript `CPos[]` with push/pop operations
- C# `PrimaryBuilding` condition token `Actor.InvalidConditionToken` -> TypeScript `-1` sentinel

#### 3.1.1 Production

- [ ] **TODO-11.A.1** `src/OpenRA.Mods.Common/Traits/Production.ts` (156 lines C#) -- Building production trait:
  - `ProductionInfo` config class: `Produces: string[]` (queue types, e.g., "Infantry", "Vehicles", "Aircraft", "Buildings")
  - `UpdateFactionOnOwnerChange: boolean` -- update faction on capture
  - `Production` class (extends `PausableConditionalTrait<ProductionInfo>`):
    - `Faction: string` -- current faction for produced units
    - `doProduction(self, producee, exitinfo, productionType, inits)` -- spawn unit at exit point
      - Compute spawn position from `exitinfo.SpawnOffset` + actor center position
      - Compute initial facing from exit direction or `exitinfo.Facing` override
      - Build `TypeDictionary` (TS: `Map<string, any>`) with `LocationInit`, `CenterPositionInit`, `FacingInit`, `CreationActivityDelayInit`, `RallyPointInit`
      - Create actor via `GameWorldManager.createActor()` in frame-end task
      - Notify `INotifyProduction` and `INotifyOtherProduction` listeners
    - `selectExit(self, producee, productionType, predicate)` -- choose best exit
      - Use `RallyPoint.Path[0]` if rally point set, otherwise nearest exit
    - `produce(self, producee, productionType, inits, refundableValue)` -- main entry point
      - Check `IsTraitDisabled`, `IsTraitPaused`, `Reservable.IsReserved`
      - Select exit, call `doProduction()` if exit valid or actor doesn't occupy space
      - Return `true` if production succeeded
    - `canUseExit(self, producee, exitInfo)` -- check if exit cell is traversable by produced unit
      - Uses `MobileInfo.canEnterCell()` from Chapter 9
  - `INotifyOwnerChanged` implementation: update `Faction` if `UpdateFactionOnOwnerChange`
  - `RallyPointInit` class: `ValueActorInit<CPos[]>` for rally point path serialization

#### 3.1.2 ProductionQueue

- [ ] **TODO-11.A.2** `src/OpenRA.Mods.Common/Traits/Player/ProductionQueue.ts` (813 lines C#) -- Production queue manager:
  - `ProductionQueueInfo` config class:
    - `Type: string` -- queue category (e.g., "Building", "Infantry", "Vehicle")
    - `DisplayOrder: number` -- UI sort order
    - `Group: string` -- queue grouping for UI tabs
    - `Factions: Set<string>` -- faction whitelist
    - `Sticky: boolean` -- keep prerequisites on owner change
    - `PayUpFront: boolean` -- pay full cost on queue (vs per-tick)
    - `BuildDurationModifier: number` -- build time multiplier (default 100 = 100%)
    - `ItemLimit: number` -- max of one actor type in queue (default 999)
    - `QueueLimit: number` -- max total items in queue (0 = infinite)
    - `LowPowerModifier: number` -- build time multiplier when low power (default 100)
    - `InfiniteBuildLimit: number` -- threshold for loop production (-1 = disabled)
    - Audio notifications: `ReadyAudio`, `BlockedAudio`, `LimitedAudio`, `CannotPlaceAudio`, `QueuedAudio`, `OnHoldAudio`, `CancelledAudio`
    - Text notifications: `ReadyTextNotification`, `BlockedTextNotification`, etc.
  - `ProductionQueue` class (implements `IResolveOrder`, `ITick`, `ITechTreeElement`, `INotifyOwnerChanged`, `INotifyKilled`, `INotifySold`, `ISync`, `INotifyTransform`, `INotifyCreated`):
    - `Producible: Map<string, ProductionState>` -- actor name -> buildable/visible state
    - `Queue: ProductionItem[]` -- the actual production queue
    - `productionTraits: Production[]` -- linked Production traits on this actor
    - `playerPower: PowerManager` -- for low-power detection (STUB initially)
    - `playerResources: PlayerResources` -- for cost deduction (Ch10 COMPLETE)
    - `developerMode: DeveloperMode` -- for cheat modes (STUB initially)
    - `techTree: TechTree` -- for prerequisite tracking (Ch10 stub, needs full impl)
    - `Enabled: boolean` -- queue active flag (`[VerifySync]`)
    - `Faction: string` -- current faction
    - `IsValidFaction: boolean` -- faction matches queue config
    - `cacheProducibles()` -- populate `Producible` from ruleset actors with `BuildableInfo`
    - `allBuildables(category)` -- filter ruleset actors by `BuildableInfo.Queue` membership
    - `prerequisitesAvailable(key)`, `prerequisitesUnavailable(key)`, `prerequisitesItemHidden(key)`, `prerequisitesItemVisible(key)` -- `ITechTreeElement` callbacks
    - `isProducing(item)`, `isInQueue(actor)`, `currentItem()`, `allQueued()`, `allItems()`, `buildableItems()`, `anyItemsToBuild()`, `canBuild(actor)` -- query methods
    - `tick(self)` -- main tick: check production traits enabled/paused, call `tickInner()`
    - `tickInner(self, allProductionPaused)` -- advance queue[0] tick, handle pause
    - `cancelUnbuildableItems()` -- remove items that are no longer buildable, refund costs
    - `canQueue(actor, out audio, out text)` -- check if actor can be added to queue
      - Check `BuildableInfo` exists, cost affordability, queue limits, item limits, build limits
    - `resolveOrder(self, order)` -- handle "StartProduction", "PauseProduction", "CancelProduction" orders
      - `StartProduction`: validate, compute cost/time, queue item, handle pay-up-front, infinite build limit
      - `PauseProduction`: toggle pause on named item
      - `CancelProduction`: cancel N items of named type, refund costs
    - `getBuildTime(unit, bi)` -- calculate build time with modifiers
      - `developerMode.FastBuild` -> 0 ticks
      - Apply `BuildDurationModifier`, `Info.BuildDurationModifier`, `IProductionTimeModifierInfo` modifiers
    - `getProductionCost(unit)` -- calculate cost with modifiers
      - Read `ValuedInfo.Cost`, apply `IProductionCostModifierInfo` modifiers
    - `pauseProduction(itemName, paused)`, `cancelProduction(itemName, count)` -- queue manipulation
    - `cancelProductionInner(itemName)` -- cancel last item of type, refund, handle infinite
    - `endProduction(item)` -- remove from queue, re-add if infinite
    - `beginProduction(item, hasPriority)` -- add to queue, handle pay-up-front, infinite limit
    - `remainingTimeActual(item)` -- actual remaining time accounting for low power
    - `mostLikelyProducer()` -- find best Production trait to use for building
    - `buildUnit(unit)` -- attempt to produce unit via `mostLikelyProducer().Produce()`
  - `ProductionState` class: `Visible: boolean`, `Buildable: boolean`
  - `ProductionItem` class:
    - `Item: string` -- actor name being built
    - `Queue: ProductionQueue` -- parent queue reference
    - `TotalCost: number`, `RemainingCost: number`, `ResourcesPaid: number` -- cost tracking
    - `TotalTime: number`, `RemainingTime: number` -- time tracking
    - `RemainingTimeActual: number` -- time adjusted for low power
    - `Paused: boolean`, `Done: boolean`, `Started: boolean`, `Infinite: boolean`
    - `tick(playerResources)` -- advance build progress:
      - On first tick: compute `TotalTime` from `Queue.getBuildTime()`
      - If `Done`: invoke `OnComplete` callback
      - If `Paused`: return
      - If low power: apply `LowPowerModifier` slowdown
      - If not `PayUpFront`: deduct cash per tick (`TakeCash`)
      - Decrement `RemainingTime`, set `Done` when reaches 0
    - `pause(paused)` -- set pause state

#### 3.1.3 ClassicProductionQueue

- [ ] **TODO-11.A.3** `src/OpenRA.Mods.Common/Traits/Player/ClassicProductionQueue.ts` (161 lines C#) -- Shared queue with speed-up:
  - `ClassicProductionQueueInfo` config class (extends `ProductionQueueInfo`):
    - `SpeedUp: boolean` -- enable build time reduction with multiple factories
    - `BuildTimeSpeedReduction: number[]` -- per-factory speed modifiers (default: [100, 86, 75, 67, 60, 55, 50])
  - `ClassicProductionQueue` class (extends `ProductionQueue`):
    - Override `tick(self)` -- scan all `Production` traits in world for matching queue type, update `Enabled`
    - Override `allItems()`, `buildableItems()` -- return empty if not enabled
    - Override `mostLikelyProducer()` -- select producer ordered by: not paused, is primary building, highest ActorID
    - Override `buildUnit(unit)` -- iterate all producers, try each until one succeeds
    - Override `getBuildTime(unit, bi)` -- apply speed reduction based on active producer count
      - `selfsameProductionsCount` = count of non-disabled, non-paused Production traits of same type for same owner
      - `speedModifier = BuildTimeSpeedReduction[clamp(count, 1, length) - 1]`
      - `time = baseTime * speedModifier / 100`

#### 3.1.4 ProductionParadrop

- [ ] **TODO-11.A.4** `src/OpenRA.Mods.Common/Traits/ProductionParadrop.ts` (166 lines C#) -- Paradrop delivery:
  - `ProductionParadropInfo` config class (extends `ProductionInfo`):
    - `ActorType: string` -- cargo aircraft actor (e.g., "badr")
    - `ChuteSound: string` -- sound on drop
    - `ReadyAudio: string` -- notification on drop
  - `ProductionParadrop` class (extends `Production`):
    - Override `produce()` -- spawn aircraft, fly to drop point, drop unit with parachute
    - Override `doProduction()` -- spawn unit at aircraft altitude with parachute
    - Aircraft path: start at map edge, fly to drop pos, drop, fly off map, remove
    - Uses `Aircraft` trait from Chapter 9 for flight
    - Integrates with `Parachutable` trait (not yet migrated -- stub)

#### 3.1.5 ProductionAirdrop

- [ ] **TODO-11.A.5** `src/OpenRA.Mods.Common/Traits/Buildings/ProductionAirdrop.ts` (142 lines C#) -- Airdrop delivery:
  - `ProductionAirdropInfo` config class (extends `ProductionInfo`):
    - `ActorType: string` -- cargo aircraft (must have `Aircraft` trait)
    - `BaselineSpawn: boolean` -- spawn at player baseline (map edge closest to spawn)
    - `Facing: WAngle` -- aircraft facing
    - `WaitTickBeforeProduce: number`, `WaitTickAfterProduce: number` -- delays
    - `LandOffset: WVec` -- landing offset
  - `ProductionAirdrop` class (extends `Production`):
    - Override `produce()` -- spawn aircraft, land at building, produce unit, take off
    - Aircraft queues: `Fly` -> `Land` -> `Wait` -> produce callback -> `Wait` -> `FlyOffMap` -> `RemoveSelf`
    - Uses `Aircraft` trait from Chapter 9

#### 3.1.6 ProductionFromMapEdge

- [ ] **TODO-11.A.6** `src/OpenRA.Mods.Common/Traits/ProductionFromMapEdge.ts` (117 lines C#) -- Map edge spawn:
  - `ProductionFromMapEdgeInfo` config class (extends `ProductionInfo`)
  - `ProductionFromMapEdge` class (extends `Production`):
    - Override `produce()` -- find closest map edge cell, spawn unit there, move to rally point
    - For aircraft: spawn at cruise altitude, use `ChooseClosestEdgeCell()`
    - For mobile units: use `ChooseClosestMatchingEdgeCell()` with pathfinding check
    - `ProductionSpawnLocationInit` -- init for fixed spawn location

#### 3.1.7 Exit

- [ ] **TODO-11.A.7** `src/OpenRA.Mods.Common/Traits/Buildings/Exit.ts` (96 lines C#) -- Unit exit definition:
  - `ExitInfo` config class (extends `ConditionalTraitInfo`):
    - `SpawnOffset: WVec` -- spawn position offset from producer center
    - `ExitCell: CVec` -- cell offset for actor map entry
    - `Facing: WAngle` -- optional fixed facing
    - `ProductionTypes: Set<string>` -- filter by production type tags
    - `ExitDelay: number` -- ticks before unit moves into world
    - `Priority: number` -- exit selection priority (higher = preferred)
  - `Exit` class (extends `ConditionalTrait<ExitInfo>`)
  - `ExitExts` static utility class:
    - `nearestExitOrDefault(actor, pos, productionType, predicate)` -- find nearest valid exit
    - `exits(actor, productionType)` -- all non-disabled exits, filtered by type
    - `randomExitOrDefault(actor, world, productionType, predicate)` -- random exit by priority group

#### 3.1.8 RallyPoint

- [ ] **TODO-11.A.8** `src/OpenRA.Mods.Common/Traits/Buildings/RallyPoint.ts` (199 lines C#) -- Post-production waypoint:
  - `RallyPointInfo` config class:
    - `Image: string` -- sprite image for indicator
    - `LineWidth: number` -- path line width
    - `FlagSequence: string`, `CirclesSequence: string` -- sprite sequences
    - `Cursor: string` -- set cursor
    - `Palette: string`, `IsPlayerPalette: boolean` -- palette config
    - `Path: CVec[]` -- initial rally point offsets
    - `Notification: string` -- audio on set
    - `ForceSetType: string` -- grouping for force-set
  - `RallyPoint` class (implements `IIssueOrder`, `IResolveOrder`, `INotifyOwnerChanged`, `INotifyCreated`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`):
    - `Path: CPos[]` -- current rally point path (world cells)
    - `PaletteName: string` -- resolved palette
    - `resetPath(self)` -- reset to initial offsets
    - `issueOrder()` -- create "SetRallyPoint" order
    - `resolveOrder()` -- handle "SetRallyPoint" and "Stop" orders
    - `RallyPointOrderTargeter` inner class -- order targeter for terrain clicks
    - `isForceSet(order)` -- static helper for force-set detection
    - 3D: Rally point indicator as `LinesMesh` path + `Sprite` flag at endpoint

#### 3.1.9 PrimaryBuilding

- [ ] **TODO-11.A.9** `src/OpenRA.Mods.Common/Traits/Buildings/PrimaryBuilding.ts` (134 lines C#) -- Primary production flag:
  - `PrimaryBuildingInfo` config class (extends `ConditionalTraitInfo`):
    - `PrimaryCondition: string` -- condition granted while primary
    - `SelectionNotification: string` -- audio on set
    - `ProductionQueues: string[]` -- queues this primary flag affects
    - `Cursor: string` -- "deploy" cursor
  - `PrimaryBuilding` class (extends `ConditionalTrait<PrimaryBuildingInfo>`):
    - `IsPrimary: boolean` -- current primary state
    - `primaryToken: number` -- condition token (`-1` = invalid)
    - `setPrimaryProducer(self, isPrimary)` -- set/unset primary, revoke other primaries for same queue type
    - `IIssueOrder` / `IResolveOrder` -- handle "PrimaryProducer" order
    - `PrimaryExts.isPrimaryBuilding(actor)` -- static extension method
    - On disable: auto-unset primary if active

**Phase A Summary**: 9 files, ~2,084 C# lines source. Estimated: ~4,500 TS implementation lines, ~3,000 test lines, ~250 tests. ProductionQueue is the central hub (~2,000 TS lines estimated). ClassicProductionQueue, Production variants, Exit, RallyPoint, and PrimaryBuilding are supporting files.

---

### 3.2 Phase B: Building System

**Status**: PLANNED (0/16 migrated)
**Complexity**: HIGH (Building 356 lines) + MEDIUM + LOW
**Blocked by**: Phase A (ProductionQueue for build order validation), Chapter 4 (Map, CellLayer, TerrainInfo), Chapter 9 (Mobile for exit traversal), Chapter 10 (PlayerResources for cost, Valued for sell value)
**Blocks**: Chapter 12 (Shroud -- buildings create shroud), Chapter 14 (Activities -- Transform activity), Chapter 15 (PlaceBuildingOrderGenerator), Chapter 16 (ProductionPaletteWidget, building UI)

**Description**: Phase B implements the building system -- footprint management, placement validation, building influence tracking, construction state, and building-specific traits. `Building` (356 lines) is the core trait that manages footprint, occupancy, and lifecycle. `BuildingInfluence` (92 lines) is the world-level spatial index for building occupancy. `PlaceBuilding` (268 lines) handles the actual building placement orders. `PlaceBuildingOrderGenerator` (337 lines) is the UI-side order generator for building placement with ghost preview. `BuildingUtils` (139 lines) provides shared placement validation logic. `RepairableBuilding` (208 lines) adds repair mechanics. `Gate` (147 lines) implements animated gate open/close. `Transforms` (171 lines) handles MCV deployment and building transformation. `Demolition` (153 lines) handles C4/explosive demolition orders.

**Paradigm Shifts**:
- C# `BuildingInfo.Footprint: FrozenDictionary<CVec, FootprintCellType>` -> TypeScript `Map<string, FootprintCellType>` with `"x,y"` string keys or `CVec` hash keys
- C# `BuildingInfo.LoadFootprint()` static YAML loader -> TypeScript `fromJSON()` factory with footprint string parsing
- C# `BuildingInfluence` linked-list per cell -> TypeScript `CellLayer<InfluenceNode>` with same linked-list pattern
- C# `PlaceBuildingOrderGenerator` 2D sprite preview -> TypeScript 3D ghost mesh with raycast positioning
- C# `BuildingUtils.IsCellBuildable()` world extension -> TypeScript static utility method taking `GameWorldManager`
- C# `RepairableBuilding.Repairers: List<Player>` -> TypeScript `Player[]` with add/remove
- C# `Gate.Position` int sync field -> TypeScript `number` with `[Sync]` registration
- C# `Transforms` activity queueing -> TypeScript `Activity` stub (full Transform Activity in Ch14)

#### 3.2.1 Building

- [ ] **TODO-11.B.1** `src/OpenRA.Mods.Common/Traits/Buildings/Building.ts` (356 lines C#) -- Core building trait:
  - `FootprintCellType` enum: `Empty='_'`, `OccupiedPassable='='`, `Occupied='x'`, `OccupiedUntargetable='X'`, `OccupiedPassableTransitOnly='+'`
  - `BuildingInfo` config class (extends `TraitInfo`, implements `IOccupySpaceInfo`, `IPlaceBuildingDecorationInfo`):
    - `TerrainTypes: Set<string>` -- allowed terrain types for placement
    - `Footprint: Map<string, FootprintCellType>` -- cell footprint (parsed from string)
    - `Dimensions: CVec` -- footprint dimensions
    - `LocalCenterOffset: WVec` -- visual center offset
    - `RequiresBaseProvider: boolean` -- needs base provider nearby
    - `AllowInvalidPlacement: boolean` -- allow placement anywhere (for debug)
    - `RemoveSmudgesOnBuild/Sell/Transform: boolean` -- smudge clearing
    - `BuildSounds: string[]`, `UndeploySounds: string[]` -- audio
    - `loadFootprint(yaml)` -> `fromJSON(json)` -- parse footprint string and dimensions
    - `footprintTiles(location, type)` -- get cells of specific type
    - `tiles(location)`, `occupiedTiles(location)`, `pathableTiles(location)`, `transitOnlyTiles(location)`, `frozenUnderFogTiles(location)` -- tile queries
    - `centerOffset(world)` -- compute visual center offset from dimensions
    - `findBaseProvider(world, player, topLeft)` -- find nearest valid base provider
    - `isCloseEnoughToBase(world, player, actorInfo, topLeft)` -- check base proximity
    - `occupiedCells(info, topLeft, subCell)` -- `IOccupySpaceInfo` implementation
  - `Building` class (implements `IOccupySpace`, `ITargetableCells`, `INotifySold`, `INotifyTransform`, `ISync`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`):
    - `TopLeft: CPos` -- top-left cell of building
    - `CenterPosition: WPos` -- world position of visual center
    - `occupiedCells: [CPos, SubCell][]` -- cached occupied cells
    - `targetableCells: [CPos, SubCell][]` -- cached targetable cells
    - `transitOnlyCells: CPos[]` -- cached transit-only cells
    - `addedToWorld(self)` -- add to actor map and building influence
    - `removedFromWorld(self)` -- remove from actor map and building influence
    - `removeSmudges()` -- clear smudges from footprint

#### 3.2.2 BuildingInfluence

- [ ] **TODO-11.B.2** `src/OpenRA.Mods.Common/Traits/Buildings/BuildingInfluence.ts` (92 lines C#) -- Building spatial index:
  - `BuildingInfluenceInfo` config class (World trait)
  - `BuildingInfluence` class:
    - `InfluenceNode` inner class: `Next: InfluenceNode`, `Actor: IGameActor`
    - `influence: CellLayer<InfluenceNode>` -- linked-list per cell
    - `addInfluence(actor, cells)` -- add actor to cells
    - `removeInfluence(actor, cells)` -- remove actor from cells
    - `getBuildingsAt(cell)` -- iterate actors at cell
    - `anyBuildingAt(cell)` -- quick check
  - Uses Chapter 4 `CellLayer` infrastructure

#### 3.2.3 BaseBuilding

- [ ] **TODO-11.B.3** `src/OpenRA.Mods.Common/Traits/Buildings/BaseBuilding.ts` (19 lines C#) -- Tag trait:
  - `BaseBuildingInfo` config class: marker trait for construction yards and MCVs
  - `BaseBuilding` class: empty tag trait
  - Used by "cycle bases" hotkey

#### 3.2.4 BaseProvider

- [ ] **TODO-11.B.4** `src/OpenRA.Mods.Common/Traits/Buildings/BaseProvider.ts` (135 lines C#) -- Base radius provider:
  - `BaseProviderInfo` config class (extends `PausableConditionalTraitInfo`):
    - `Range: WDist` -- build radius (default 10 cells)
    - `Cooldown: number`, `InitialDelay: number` -- startup delay
    - `CircleReadyColor: Color`, `CircleBlockedColor: Color` -- range circle colors
    - `CircleWidth: number`, `CircleBorderColor: Color`, `CircleBorderWidth: number` -- circle style
  - `BaseProvider` class (extends `PausableConditionalTrait<BaseProviderInfo>`):
    - `total: number`, `progress: number` -- cooldown tracking
    - `beginCooldown()` -- start cooldown timer
    - `ready()` -- check if provider is active (not disabled, not paused, cooldown done)
    - `rangeCircleRenderables()` -- generate range circle renderables
    - `ISelectionBar` implementation: show cooldown progress bar
  - 3D: Range circle as `LinesMesh` circle or `TorusMesh` at provider position

#### 3.2.5 PlaceBuilding

- [ ] **TODO-11.B.5** `src/OpenRA.Mods.Common/Traits/Player/PlaceBuilding.ts` (268 lines C#) -- Building placement handler:
  - `PlaceBuildingInit` class: `RuntimeFlagInit` marker for placed buildings
  - `PlaceBuildingInfo` config class (Player trait):
    - `NewOptionsNotificationDelay: number` -- delay for new options notification
    - `NewOptionsNotification: string` -- audio on new build options
    - `CannotPlaceNotification: string` -- audio on failed placement
    - `ToggleVariantKey: HotkeyReference` -- hotkey for variant toggle
  - `PlaceBuilding` class (implements `IResolveOrder`, `ITick`):
    - `resolveOrder()` -- handle "PlaceBuilding", "LineBuild", "PlacePlug" orders:
      - Find completed production item in queue
      - Handle `PlaceBuildingVariants` override
      - Handle `ReplacementInfo` -- remove replaceable actors
      - For `LineBuild`: place parent + segment actors along line
      - For `PlacePlug`: enable plug on target building
      - For normal: validate placement, create actor, play sounds, notify `INotifyBuildingPlaced`
      - End production item, trigger base provider cooldown
      - Check for new build options, queue notification
    - `tick()` -- delayed notification playback
    - `getNumBuildables(player)` -- count buildable items for notification check

#### 3.2.6 PlaceBuildingVariants

- [ ] **TODO-11.B.6** `src/OpenRA.Mods.Common/Traits/Buildings/PlaceBuildingVariants.ts` (32 lines C#) -- Building variant cycling:
  - `PlaceBuildingVariantsInfo` config class:
    - `Actors: string[]` -- variant actor names
    - `Facings: WAngle[]` -- facings for each variant
  - `PlaceBuildingVariants` class: empty marker trait
  - Used by `PlaceBuildingOrderGenerator` to cycle variants with hotkey

#### 3.2.7 Buildable

- [ ] **TODO-11.B.7** `src/OpenRA.Mods.Common/Traits/Buildings/Buildable.ts` (69 lines C#) -- Buildable marker:
  - `BuildableInfo` config class:
    - `Prerequisites: string[]` -- prerequisite names (with `!` invert, `~` hide)
    - `Queue: Set<string>` -- production queues that can build this
    - `BuildAtProductionType: string` -- override production structure type
    - `BuildLimit: number` -- max instances (0 = unlimited)
    - `ForceFaction: string` -- faction override
    - `Icon: string` -- icon sequence
    - `IconPalette: string`, `IconPaletteIsPlayerPalette: boolean` -- icon palette
    - `BuildDuration: number` -- base build time (-1 = use Value)
    - `BuildDurationModifier: number` -- build time modifier
    - `BuildPaletteOrder: number` -- UI sort order
    - `Description: string` -- tooltip text
    - `getInitialFaction(actorInfo, defaultFaction)` -- static helper
  - `Buildable` class: empty marker trait
  - **Note**: `BuildableInfo` is referenced by `ProductionQueue`, `PlaceBuildingOrderGenerator`, and `TechTree`. Full implementation needed here (Ch10 had stub).

#### 3.2.8 LineBuild

- [ ] **TODO-11.B.8** `src/OpenRA.Mods.Common/Traits/Buildings/LineBuild.ts` (125 lines C#) -- Wall line building:
  - `LineBuildDirection` enum: `Unset`, `X`, `Y`
  - `LineBuildDirectionInit` class: `ValueActorInit<LineBuildDirection>`
  - `LineBuildParentInit` class: `ValueActorInit<string[]>` (actor names)
  - `INotifyLineBuildSegmentsChanged` interface: `segmentAdded(self, segment)`, `segmentRemoved(self, segment)`
  - `LineBuildInfo` config class:
    - `Range: number` -- max line length
    - `NodeTypes: Set<string>` -- node type tags
    - `SegmentType: string` -- segment actor type (defaults to same)
    - `SegmentsRequireNode: boolean` -- delete segments when node destroyed
  - `LineBuild` class:
    - `parentNodes: IGameActor[]` -- connected parent nodes
    - `segments: Set<IGameActor>` -- child segments
    - `INotifyAddedToWorld` -- register with parent nodes
    - `INotifyRemovedFromWorld` -- unregister, optionally destroy segments
    - `INotifyKilled` -- optionally kill segments

#### 3.2.9 RequiresBuildableArea

- [ ] **TODO-11.B.9** `src/OpenRA.Mods.Common/Traits/Buildings/RequiresBuildableArea.ts` (30 lines C#) -- Build area requirement:
  - `RequiresBuildableAreaInfo` config class:
    - `AreaTypes: Set<string>` -- required buildable area types
    - `Adjacent: number` -- max distance from provider (default 2)
  - `RequiresBuildableArea` class: empty marker trait

#### 3.2.10 BuildingUtils

- [ ] **TODO-11.B.10** `src/OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.ts` (139 lines C#) -- Placement validation utilities:
  - `isCellBuildable(world, cell, actorInfo, buildingInfo, toIgnore)` -- check if cell is buildable:
    - Map bounds check
    - Actor occupancy check (with replacement support)
    - Building influence check
    - Terrain type check
    - Ramp check (no buildings on ramps)
  - `canPlaceBuilding(world, cell, actorInfo, buildingInfo, toIgnore)` -- full placement check:
    - All footprint cells must be buildable
  - `getLineBuildCells(world, cell, actorInfo, buildingInfo, owner)` -- find wall line cells:
    - Search in 4 directions from placement point
    - Find existing `LineBuildNode` connectors
    - Return intermediate cells and connector actors

#### 3.2.11 RepairableBuilding

- [ ] **TODO-11.B.11** `src/OpenRA.Mods.Common/Traits/Buildings/RepairableBuilding.ts` (208 lines C#) -- Building repair:
  - `RepairableBuildingInfo` config class (extends `ConditionalTraitInfo`):
    - `RepairPercent: number` -- cost to fully repair as % of value (default 20)
    - `RepairInterval: number` -- ticks between repair steps (default 24)
    - `RepairStep: number` -- max HP per step (default 7)
    - `RepairDamageTypes: BitSet<DamageType>` -- damage types for repair
    - `RepairBonuses: number[]` -- multi-repairer bonuses (default [100, 150, 175, 200, 220, 240, 260, 280, 300])
    - `CancelWhenDisabled: boolean` -- cancel repair on trait disable
    - `PlayerExperience: number` -- XP for allied repairs
    - `RepairCondition: string` -- condition while repairing
    - Audio notifications for start/stop
  - `RepairableBuilding` class (extends `ConditionalTrait<RepairableBuildingInfo>`, implements `ITick`, `ISync`):
    - `Repairers: Player[]` -- players currently repairing
    - `RepairActive: boolean` -- repair in progress
    - `repairTokens: number[]` -- condition tokens
    - `repairBuilding(self, player)` -- toggle player repair (add/remove)
    - `updateCondition(self)` -- sync condition tokens with repairer count
    - `tick()` -- repair step:
      - Remove inactive allies from repairers
      - Calculate HP to repair and cost
      - Deduct cash from each repairer
      - Apply repair bonus based on active repairer count
      - Stop when fully repaired

#### 3.2.12 Gate

- [ ] **TODO-11.B.12** `src/OpenRA.Mods.Common/Traits/Buildings/Gate.cs` (147 lines C#) -- Animated gate:
  - `GateInfo` config class (extends `PausableConditionalTraitInfo`):
    - `OpeningSound: string`, `ClosingSound: string`
    - `CloseDelay: number` -- ticks before auto-close (default 150)
    - `TransitionDelay: number` -- ticks to fully open (default 33)
    - `BlocksProjectilesHeight: WDist` -- projectile blocking height
    - `BlocksProjectilesValidRelationships: PlayerRelationship` -- who to block
  - `Gate` class (extends `PausableConditionalTrait<GateInfo>`):
    - `Position: number` -- current open position (0 = closed, `TransitionDelay` = open)
    - `OpenPosition: number` -- fully open position
    - `desiredPosition: number`, `remainingOpenTime: number`
    - `tick()` -- animate open/close:
      - Open when friendly actor wants to pass
      - Close after `CloseDelay` when no blockers
      - Play sounds at transition start
    - `ITemporaryBlocker` -- report blocking state
    - `IBlocksProjectiles` -- projectile height based on open position
    - `INotifyBlockingMove` -- open when friendly actor blocked

#### 3.2.13 Transforms

- [ ] **TODO-11.B.13** `src/OpenRA.Mods.Common/Traits/Transforms.ts` (171 lines C#) -- Actor transformation:
  - `TransformsInfo` config class (extends `PausableConditionalTraitInfo`):
    - `IntoActor: string` -- target actor type
    - `Offset: CVec` -- spawn offset
    - `Facing: WAngle` -- required facing
    - `TransformSounds: string[]`, `NoTransformSounds: string[]`
    - `TransformNotification: string`, `NoTransformNotification: string`
    - `DeployCursor: string`, `DeployBlockedCursor: string`
    - `Voice: string`
  - `Transforms` class (extends `PausableConditionalTrait<TransformsInfo>`):
    - `canDeploy()` -- check if transformation is possible (placement valid)
    - `getTransformActivity()` -- create `Transform` Activity (stub, full in Ch14)
    - `deployTransform(queued)` -- queue transform activity
    - `IIssueOrder` / `IResolveOrder` -- handle "DeployTransform" order
    - `IOrderVoice` -- voice phrase for deploy order

#### 3.2.14 Demolition

- [ ] **TODO-11.B.14** `src/OpenRA.Mods.Common/Traits/Demolition.ts` (153 lines C#) -- C4 demolition:
  - `DemolitionInfo` config class (extends `ConditionalTraitInfo`):
    - `DetonationDelay: number` -- ticks before detonation (default 45)
    - `Flashes: number`, `FlashesDelay: number`, `FlashInterval: number` -- target flash
    - `EnterBehaviour: EnterBehaviour` -- actor behavior after planting (Exit/Suicide/Dispose)
    - `DamageTypes: BitSet<DamageType>`
    - `Voice: string`
    - `TargetLineColor: Color`
    - `TargetRelationships`, `ForceTargetRelationships`
    - `Cursor: string`
  - `Demolition` class (extends `ConditionalTrait<DemolitionInfo>`):
    - `IIssueOrder` / `IResolveOrder` -- handle "C4" order
    - `getDemolishActivity()` -- create `Demolish` Activity (stub, full in Ch14)
    - `IOrderVoice` -- voice phrase for C4 order
    - `DemolitionOrderTargeter` inner class -- target validation

#### 3.2.15 MapBuildRadius

- [ ] **TODO-11.B.15** `src/OpenRA.Mods.Common/Traits/World/MapBuildRadius.ts` (92 lines C#) -- Build radius lobby option:
  - `MapBuildRadiusInfo` config class (World trait, `ILobbyOptions`):
    - `AllyBuildRadiusCheckbox*`: Label, Description, Enabled, Locked, Visible, DisplayOrder
    - `BuildRadiusCheckbox*`: Label, Description, Enabled, Locked, Visible, DisplayOrder
  - `MapBuildRadius` class (implements `INotifyCreated`):
    - `AllyBuildRadiusEnabled: boolean`
    - `BuildRadiusEnabled: boolean`
    - Read lobby options on creation
  - **Note**: `ILobbyOptions` can be stubbed initially; full lobby UI in Chapter 16.

#### 3.2.16 PlaceBuildingOrderGenerator

- [ ] **TODO-11.B.16** `src/OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.ts` (337 lines C#) -- Building placement UI:
  - `PlaceBuildingCellType` enum: `None`, `Valid`, `Invalid`, `LineBuild`
  - `IPlaceBuildingPreviewGeneratorInfo` interface: `createPreview()`
  - `IPlaceBuildingPreview` interface: `topLeftScreenOffset`, `tick()`, `render()`, `renderAnnotations()`
  - `PlaceBuildingOrderGenerator` class (implements `IOrderGenerator`):
    - `VariantWrapper` inner class -- holds actor info, building info, plug info, line build info, preview
    - `variants: VariantWrapper[]` -- all variants (base + PlaceBuildingVariants)
    - `variant: number` -- current variant index
    - `topLeft` -- computed top-left cell from mouse position
    - `order()` -- handle mouse down/up for placement/cancel
    - `innerOrder()` -- validate placement, generate orders:
      - Check `CanPlaceBuilding` + `IsCloseEnoughToBase`
      - Handle plugs (PlacePlug)
      - Handle line build (LineBuild)
      - Handle normal placement (PlaceBuilding)
      - Generate `ClearBlockersOrders` if blocked
    - `tick()` -- check queue still has completed item, tick previews
    - `renderAboveShroud()` -- render footprint preview:
      - Compute footprint cells with validity
      - For plugs: 1x1 check
      - For line build: segment cells + connector check
      - For normal: all footprint cells
      - Delegate to preview renderer
    - `renderAnnotations()` -- preview annotations
    - `getCursor()` -- world default cursor
    - `handleKeyPress()` -- variant toggle hotkey
    - `acceptsPlug()` -- check if cell accepts plug
    - `clearBlockersOrders()` -- generate orders to clear blocking actors
  - 3D: Ghost preview as semi-transparent `InstancedMesh` or `Mesh` per footprint cell, colored by validity

**Phase B Summary**: 16 files, ~1,903 C# lines source. Estimated: ~4,000 TS implementation lines, ~2,500 test lines, ~200 tests. Building and PlaceBuildingOrderGenerator are the most complex. BuildingInfluence, BuildingUtils, and PlaceBuilding are critical infrastructure. RepairableBuilding, Gate, Transforms, and Demolition are gameplay features.

---

## 4. Dependency Graph

### 4.1 Within Chapter 11

```
Phase A: Production Queue System
  |
  +--> Production.ts (base class)
  |     |
  |     +--> ProductionParadrop.ts (extends Production)
  |     +--> ProductionAirdrop.ts (extends Production)
  |     +--> ProductionFromMapEdge.ts (extends Production)
  |
  +--> ProductionQueue.ts
  |     |
  |     +--> ClassicProductionQueue.ts (extends ProductionQueue)
  |     +--> PrimaryBuilding.ts (sets primary for queue producer selection)
  |     +--> PlaceBuilding.ts (ends production on building placement)
  |
  +--> Exit.ts (used by Production for spawn)
  +--> RallyPoint.ts (used by Production for waypoints)

Phase B: Building System
  |
  +--> Building.ts (core footprint/occupancy)
  |     |
  |     +--> BuildingInfluence.ts (tracks Building occupancy)
  |     +--> Gate.ts (extends Building behavior)
  |     +--> LineBuild.ts (building connection)
  |
  +--> BuildingUtils.ts (placement validation)
  |     |
  |     +--> PlaceBuildingOrderGenerator.ts (uses for preview)
  |     +--> PlaceBuilding.ts (uses for placement)
  |
  +--> BaseProvider.ts (range for building placement)
  |     |
  |     +--> Building.ts (findBaseProvider)
  |     +--> MapBuildRadius.ts (enables/disables radius)
  |
  +--> PlaceBuilding.ts (order handler)
  |     |
  |     +--> PlaceBuildingOrderGenerator.ts (generates orders)
  |     +--> PlaceBuildingVariants.ts (variant cycling)
  |
  +--> Buildable.ts (production eligibility)
  |     |
  |     +--> ProductionQueue.ts (filters buildables)
  |     +--> TechTree.ts (prerequisite tracking)
  |
  +--> RequiresBuildableArea.ts (placement requirement)
  +--> BaseBuilding.ts (tag trait)
  +--> RepairableBuilding.ts (repair mechanic)
  +--> Transforms.ts (MCV deployment)
  +--> Demolition.ts (C4 orders)
```

### 4.2 Cross-Chapter Dependencies

```
Chapters 2-10 (COMPLETE -- Foundation)
  |
  +--> Ch11 Phase A (Production Queue)
  |     |
  |     |   Ch10: PlayerResources (cost deduction, refunds)
  |     |   Ch10: Valued (cost lookup)
  |     |   Ch10: Buildable (stub -- needs full impl)
  |     |   Ch10: TechTree (stub -- needs full impl)
  |     |   Ch9: Mobile (exit traversal check)
  |     |   Ch9: Aircraft (paradrop/airdrop)
  |     |   Ch8: WeaponInfo (not directly used)
  |     |   Ch6: Order, IResolveOrder, UnitOrders
  |     |   Ch6: Sync (ProductionQueue [Sync] fields)
  |     |   Ch5: WorldInteractionControllerWidget (order generation)
  |     |   Ch4: Map, CellLayer, TerrainInfo
  |     |   Ch3: World, Actor, Player, TraitDictionary
  |     |   Ch3: ITick, INotifyCreated, INotifyOwnerChanged, etc.
  |     |   Ch2: Sprite, Animation (build icons)
  |     |
  |     +--> Ch11 Phase B (Building System)
  |           |
  |           |   Ch4: CellLayer (BuildingInfluence)
  |           |   Ch4: Map, TerrainInfo (placement validation)
  |           |   Ch9: Mobile (pathing for ProductionFromMapEdge)
  |           |   Ch10: PlayerResources (RepairableBuilding cost)
  |           |   Ch10: IHealth (RepairableBuilding)
  |           |   Ch8: DamageType (RepairableBuilding)
  |           |   Ch6: Order, IResolveOrder
  |           |   Ch5: Widget (PlaceBuildingOrderGenerator UI)
  |           |   Ch3: Activity (Transform, Demolish stubs)
  |           |
  |           +--> Ch12 (Shroud -- buildings create/reveal shroud)
  |           +--> Ch14 (Activities -- Transform, Demolish full impl)
  |           +--> Ch15 (Order Generators -- PlaceBuildingOrderGenerator)
  |           +--> Ch16 (UI -- ProductionPaletteWidget, building icons)
```

### 4.3 Critical Path

```
Buildable.ts + TechTree.ts (prerequisite system)
  -> ProductionQueue.ts (queue filtering)
    -> ClassicProductionQueue.ts (shared queue)
    -> PlaceBuilding.ts (building placement)
      -> PlaceBuildingOrderGenerator.ts (UI preview)

Building.ts (footprint/occupancy)
  -> BuildingInfluence.ts (spatial index)
    -> BuildingUtils.ts (placement validation)
      -> PlaceBuilding.ts + PlaceBuildingOrderGenerator.ts

Production.ts (base production)
  -> ProductionParadrop + ProductionAirdrop + ProductionFromMapEdge
  -> Exit.ts + RallyPoint.ts (spawn/waypoints)
```

### 4.4 Parallelization Opportunities

- **Phase A internal**: `Exit.ts` and `RallyPoint.ts` can be parallel. `PrimaryBuilding.ts` can be parallel with `Production` variants. `ProductionQueue.ts` must precede `ClassicProductionQueue.ts`.
- **Phase B internal**: `BaseBuilding.ts`, `RequiresBuildableArea.ts`, `PlaceBuildingVariants.ts`, `MapBuildRadius.ts` are independent and can all be parallel. `BuildingInfluence.ts` can be parallel with `Building.ts`. `RepairableBuilding.ts`, `Gate.ts`, `Transforms.ts`, `Demolition.ts` are independent gameplay features.
- **Phase A vs Phase B**: `Buildable.ts` (Phase B) must be done before `ProductionQueue.ts` (Phase A) can fully function. `BuildingUtils.ts` (Phase B) and `Building.ts` (Phase B) must be done before `PlaceBuildingOrderGenerator.ts` (Phase B).
- **Cross-chapter**: `TechTree.ts` full implementation can be done in parallel with Phase A files if the interface is defined first. `PowerManager` and `DeveloperMode` stubs can be created as one-liner stubs and filled in later.

### 4.5 Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| Buildable.ts | Must be migrated before ProductionQueue can filter buildable items |
| TechTree.ts | Must be migrated before ProductionQueue can validate prerequisites |
| Building.ts | Must be migrated before BuildingInfluence (uses BuildingInfo) |
| BuildingInfluence.ts | Must be migrated before BuildingUtils (uses for occupancy checks) |
| BuildingUtils.ts | Must be migrated before PlaceBuilding + PlaceBuildingOrderGenerator |
| Production.ts | Must be migrated before ProductionParadrop/Airdrop/FromMapEdge |
| ProductionQueue.ts | Must be migrated before ClassicProductionQueue + PlaceBuilding |
| Exit.ts | Must be migrated before Production (uses for spawn) |
| PlaceBuilding.ts | Must be migrated before PlaceBuildingOrderGenerator (generates orders for it) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns per phase:

#### Phase A Tests

- [ ] **TEST-11.1** Production: `produce()` returns true when exit valid, false when disabled/paused/reserved
- [ ] **TEST-11.2** Production: `doProduction()` creates actor with correct inits (Location, CenterPosition, Facing, RallyPoint)
- [ ] **TEST-11.3** Production: `selectExit()` picks nearest exit to rally point, or random if no rally point
- [ ] **TEST-11.4** Production: `canUseExit()` returns true when cell traversable by Mobile, false when blocked
- [ ] **TEST-11.5** ProductionQueue: `canQueue()` returns true for affordable, buildable, within-limit actor
- [ ] **TEST-11.6** ProductionQueue: `canQueue()` returns false for unaffordable, over queue limit, over build limit
- [ ] **TEST-11.7** ProductionQueue: `resolveOrder("StartProduction")` adds item to queue, deducts cost if PayUpFront
- [ ] **TEST-11.8** ProductionQueue: `resolveOrder("PauseProduction")` toggles pause on named item
- [ ] **TEST-11.9** ProductionQueue: `resolveOrder("CancelProduction")` removes item, refunds cost
- [ ] **TEST-11.10** ProductionQueue: `getBuildTime()` applies all modifiers correctly (FastBuild=0, BuildDurationModifier, Info modifier)
- [ ] **TEST-11.11** ProductionQueue: `getProductionCost()` reads Valued.Cost and applies modifiers
- [ ] **TEST-11.12** ProductionQueue: `tick()` advances queue[0] when not paused, not low power
- [ ] **TEST-11.13** ProductionQueue: low power applies LowPowerModifier slowdown
- [ ] **TEST-11.14** ProductionQueue: `cancelUnbuildableItems()` removes items when prerequisites lost, refunds
- [ ] **TEST-11.15** ProductionItem: `tick()` deducts per-tick cost when not PayUpFront
- [ ] **TEST-11.16** ProductionItem: `tick()` sets Done=true when RemainingTime reaches 0
- [ ] **TEST-11.17** ClassicProductionQueue: `getBuildTime()` applies speed reduction based on producer count
- [ ] **TEST-11.18** ClassicProductionQueue: `mostLikelyProducer()` prefers non-paused, primary, highest ID
- [ ] **TEST-11.19** Exit: `nearestExitOrDefault()` returns exit by priority then distance
- [ ] **TEST-11.20** Exit: `exits()` filters by ProductionTypes when specified
- [ ] **TEST-11.21** RallyPoint: `resolveOrder("SetRallyPoint")` adds cell to path
- [ ] **TEST-11.22** RallyPoint: `resetPath()` resets to initial offsets
- [ ] **TEST-11.23** PrimaryBuilding: `setPrimaryProducer()` grants condition, revokes other primaries for same queue
- [ ] **TEST-11.24** PrimaryBuilding: `isPrimaryBuilding()` extension returns correct state

#### Phase B Tests

- [ ] **TEST-11.25** Building: `fromJSON()` parses footprint string correctly (x, X, =, _, +)
- [ ] **TEST-11.26** Building: `footprintTiles()` returns correct cells for each type
- [ ] **TEST-11.27** Building: `centerOffset()` computes correct offset from dimensions
- [ ] **TEST-11.28** Building: `isCloseEnoughToBase()` returns true when adjacent to GivesBuildableArea
- [ ] **TEST-11.29** Building: `isCloseEnoughToBase()` returns false when too far from base provider
- [ ] **TEST-11.30** BuildingInfluence: `addInfluence()` adds actor to cells
- [ ] **TEST-11.31** BuildingInfluence: `removeInfluence()` removes actor from cells
- [ ] **TEST-11.32** BuildingInfluence: `getBuildingsAt()` iterates all actors at cell
- [ ] **TEST-11.33** BuildingInfluence: `anyBuildingAt()` returns true when cell occupied
- [ ] **TEST-11.34** BuildingUtils: `isCellBuildable()` returns false for out-of-bounds cells
- [ ] **TEST-11.35** BuildingUtils: `isCellBuildable()` returns false for occupied cells
- [ ] **TEST-11.36** BuildingUtils: `isCellBuildable()` returns false for ramp cells
- [ ] **TEST-11.37** BuildingUtils: `isCellBuildable()` returns true for valid empty cells
- [ ] **TEST-11.38** BuildingUtils: `canPlaceBuilding()` returns true when all footprint cells buildable
- [ ] **TEST-11.39** BuildingUtils: `getLineBuildCells()` finds correct wall segments
- [ ] **TEST-11.40** BaseProvider: `ready()` returns true when not disabled, not paused, cooldown done
- [ ] **TEST-11.41** BaseProvider: `beginCooldown()` sets progress to Cooldown value
- [ ] **TEST-11.42** PlaceBuilding: `resolveOrder("PlaceBuilding")` creates actor, ends production, plays sound
- [ ] **TEST-11.43** PlaceBuilding: `resolveOrder("LineBuild")` creates parent + segment actors
- [ ] **TEST-11.44** RepairableBuilding: `repairBuilding()` toggles player in repairers list
- [ ] **TEST-11.45** RepairableBuilding: `tick()` repairs HP and deducts cash at correct interval
- [ ] **TEST-11.46** RepairableBuilding: repair bonus scales with multiple repairers
- [ ] **TEST-11.47** Gate: `tick()` opens when friendly actor blocked, closes after delay
- [ ] **TEST-11.48** Gate: `Position` interpolates from 0 to OpenPosition over TransitionDelay ticks
- [ ] **TEST-11.49** Transforms: `canDeploy()` returns true when placement valid, false when blocked
- [ ] **TEST-11.50** Transforms: `deployTransform()` queues Transform Activity
- [ ] **TEST-11.51** Demolition: order targeter validates target relationships
- [ ] **TEST-11.52** MapBuildRadius: reads lobby options correctly on creation

### 5.2 Per-Phase Test File Estimates

| Phase | Files | Test Files | Estimated Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Production Queue | 9 | 8 | ~120 | ~3,000 |
| B: Building System | 16 | 12 | ~130 | ~2,500 |
| **Total** | **25** | **20** | **~250** | **~5,500** |

### 5.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Building placement preview | `/test/building/placement/` | Verify ghost mesh follows mouse, valid/invalid cell coloring, footprint accuracy |
| Building placement line build | `/test/building/linebuild/` | Verify wall line preview, segment placement, connector detection |
| Base provider range | `/test/building/baseprovider/` | Verify range circle rendering, color change on cooldown |
| Production queue | `/test/production/queue/` | Verify queue items, progress bar, completion notification |
| Rally point | `/test/building/rallypoint/` | Verify path line rendering, flag sprite at endpoint |
| Gate animation | `/test/building/gate/` | Verify gate open/close animation, collision state change |
| Building repair | `/test/building/repair/` | Verify repair indicator, health regeneration, cash deduction |
| Primary building | `/test/building/primary/` | Verify primary building indicator, production priority |

### 5.4 Integration Testing

- [ ] **TEST-11.I1** Full production loop: queue unit -> production ticks -> completion -> unit spawns at exit -> moves to rally point
- [ ] **TEST-11.I2** Building placement: select building -> ghost preview -> click valid cell -> building created -> footprint occupied -> building influence updated
- [ ] **TEST-11.I3** Classic production speed-up: build 2nd factory -> verify build time reduction matches BuildTimeSpeedReduction table
- [ ] **TEST-11.I4** Primary building: set primary on barracks -> verify new units exit from primary
- [ ] **TEST-11.I5** Repair: click repair on damaged building -> verify cash deduction, HP increase, stop when full
- [ ] **TEST-11.I6** Gate: friendly unit approaches gate -> gate opens -> unit passes -> gate closes after delay
- [ ] **TEST-11.I7** MCV deploy: MCV deploy order -> verify canDeploy check -> Transform activity -> building created
- [ ] **TEST-11.I8** Demolition: engineer C4 order on enemy building -> verify approach -> plant -> delay -> detonation -> damage
- [ ] **TEST-11.I9** Tech tree: build prerequisite -> verify new options appear in queue -> sell prerequisite -> verify options hidden
- [ ] **TEST-11.I10** Low power: power plant destroyed -> verify production slowdown -> power restored -> normal speed resumes

---

## 6. Risk and Considerations

### 6.1 High-Risk Areas

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **ProductionQueue complexity** (813 lines, central hub) | HIGH | Queue state bugs break entire production system | Port line-for-line; extensive unit tests for each order type; validate tick-by-tick cost/time progression |
| **Building placement 3D preview** (PlaceBuildingOrderGenerator) | HIGH | Ghost mesh misalignment, invalid placement in 3D | Use raycast-to-terrain for positioning; validate footprint cell alignment with CoordinateTransformer; test on ramped terrain |
| **Building footprint parity** | MEDIUM | Footprint parsing differs from C#, causing wrong occupancy | Port `LoadFootprint()` line-for-line; validate all 5 cell types parse correctly; test multi-cell footprints |
| **BuildingInfluence linked-list** | MEDIUM | Memory leaks or incorrect removal cause phantom buildings | Unit test add/remove cycles; verify `getBuildingsAt()` returns correct actors after multiple add/remove operations |
| **Production queue sync** | MEDIUM | `[Sync]` field mismatches cause desync in multiplayer | Port `[VerifySync]` fields exactly; validate sync hash stability over 100 ticks with randomized queue operations |
| **ClassicProductionQueue speed-up** | MEDIUM | Build time calculation differs from C# with multiple factories | Validate `BuildTimeSpeedReduction` table lookup matches C# exactly; test with 1-7 factories |
| **Gate animation state** | LOW | Gate stuck open/closed, blocking units incorrectly | Unit test tick-by-tick position changes; verify `ITemporaryBlocker` reports correct state at each position |
| **RepairableBuilding cost** | LOW | Repair cost calculation differs, causing economy imbalance | Validate cost formula: `hpToRepair * RepairPercent * buildingValue / (maxHP * 100)` |
| **TechTree prerequisite inversion** | LOW | `!` and `~` prefix handling incorrect | Unit test all combinations: plain, `!`, `~`, `!~`, `~!` |
| **LineBuild wall placement** | LOW | Wall segments placed incorrectly or not connected | Validate `GetLineBuildCells()` against C# for known test scenarios |

### 6.2 Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| ProductionQueue.tick() | < 0.1ms | Called every tick; must be fast even with 20 queued items |
| BuildingInfluence lookup | < 0.01ms per cell | O(1) CellLayer access + linked-list traversal |
| PlaceBuildingOrderGenerator.render | < 1ms per frame | Ghost mesh update + footprint cell validation |
| Building placement validation | < 2ms | All footprint cells checked against map, actors, terrain |
| ProductionItem.tick() | < 0.01ms | Simple arithmetic; called per active queue item |
| Gate.tick() | < 0.01ms | Simple state machine; called per gate |
| RepairableBuilding.tick() | < 0.05ms | Repairer iteration + cost calculation |

### 6.3 Deferred Features

| Feature | Files | Lines (est.) | Reason for Deferral |
|:---|:---|:---:|:---|
| PowerManager full implementation | ProductionQueue.ts | ~50 | Stub returns PowerState.Normal always; full PowerManager in later chapter |
| DeveloperMode full implementation | ProductionQueue.ts | ~30 | Stub with FastBuild=false, AllTech=false, BuildAnywhere=false; full in later chapter |
| ActorInitializer system | Production.ts, PlaceBuilding.ts | ~100 | Use `Map<string, any>` bag instead; full ActorInitializer in Ch14 |
| ActorMap cell occupancy | BuildingUtils.ts | ~40 | Use BuildingInfluence only; full ActorMap in later chapter |
| Transform Activity | Transforms.ts | ~80 | Activity stub; full Transform Activity in Ch14 |
| Demolish Activity | Demolition.ts | ~60 | Activity stub; full Demolish Activity in Ch14 |
| ILobbyOptions | MapBuildRadius.ts | ~20 | Stub lobby options; full lobby UI in Ch16 |
| IPlaceBuildingPreview | PlaceBuildingOrderGenerator.ts | ~50 | Preview renderer stub; full 3D preview when rendering pipeline ready |
| Parachutable trait | ProductionParadrop.ts | ~30 | Parachute descent logic; full in Ch14 |
| Replaceable/Replacement | BuildingUtils.ts | ~40 | Actor replacement on build; stub for now |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-11.1: Production Queue Deterministic Tick Processing

- **Decision**: `ProductionQueue` and `ProductionItem` use explicit `for` loops and `if` branches instead of LINQ-style operations. Queue state is fully deterministic and `[Sync]`-compatible. All cost and time calculations use integer arithmetic.
- **Rationale**: OpenRA's C# `ProductionQueue` uses LINQ extensively (`Queue.Any()`, `Queue.First()`, `BuildableItems().All()`). In TypeScript, LINQ equivalents are slower and less predictable. Explicit loops provide deterministic execution order essential for network sync. Integer arithmetic avoids floating-point drift across clients.
- **Mitigation**: Each `ProductionQueue` method that was LINQ in C# gets an explicit loop implementation with the same semantics. Unit tests validate identical output for the same inputs.

### ADR-11.2: Building Footprint String-Keyed Map

- **Decision**: `BuildingInfo.Footprint` uses `Map<string, FootprintCellType>` with `"x,y"` string keys (e.g., `"0,0"`, `"1,0"`) instead of `Map<CVec, FootprintCellType>` with object keys.
- **Rationale**: JavaScript `Map` uses reference equality for object keys. Two `CVec` instances with the same coordinates are different objects and would not match. String keys provide value-based lookup. The `"x,y"` format is simple, fast to compute, and human-readable for debugging.
- **Mitigation**: A `CVec.toFootprintKey()` helper method generates the string key. Footprint parsing from JSON uses the same key format. All footprint tile queries use this helper.

### ADR-11.3: Building Placement Preview via Ghost Mesh

- **Decision**: The `PlaceBuildingOrderGenerator` creates a Babylon.js `Mesh` (or `InstancedMesh` for multi-cell footprints) with a semi-transparent material. The mesh follows the mouse cursor via `scene.onPointerMove` raycast to the terrain. Valid cells are tinted green, invalid cells red.
- **Rationale**: OpenRA's 2D placement preview uses sprite-based ghost rendering. In 3D, a transparent mesh provides proper depth testing, occlusion, and terrain following. Raycast-to-terrain gives accurate world positioning. Per-cell coloring communicates placement validity clearly.
- **Mitigation**: The ghost mesh uses `MeshBuilder.CreateBox()` or `CreatePlane()` per footprint cell, scaled to cell size. Material uses `StandardMaterial` with `alpha=0.5` and `emissiveColor` for tinting. The mesh is disposed when the order generator deactivates.

### ADR-11.4: BuildingInfluence Linked-List per Cell

- **Decision**: `BuildingInfluence` uses the same linked-list-per-cell pattern as OpenRA's C# implementation: `CellLayer<InfluenceNode>` where each node has `Next` and `Actor` fields.
- **Rationale**: This pattern supports multiple buildings overlapping the same cell (e.g., building bibs, transit-only cells). A simple `CellLayer<IGameActor>` would only store one actor per cell. The linked-list enables O(n) traversal of all actors at a cell, which is typically a small number (1-3).
- **Mitigation**: `addInfluence()` prepends a new node. `removeInfluence()` recursively traverses and removes the matching node. `getBuildingsAt()` yields actors by traversing the list. Unit tests validate correct behavior with overlapping buildings.

### ADR-11.5: TechTree Prerequisite String Parsing

- **Decision**: TechTree prerequisite strings are parsed with the same semantics as OpenRA: `!` prefix inverts the prerequisite (actor must NOT exist), `~` prefix hides the item when prerequisite is not met. Both prefixes can be combined (`!~` or `~!`).
- **Rationale**: OpenRA's prerequisite system is a core gameplay mechanic. Inverting and hiding prerequisites are used extensively in mod rules. Preserving exact semantics ensures mod compatibility.
- **Mitigation**: Parse order: strip `~` first (for hidden flag), then check `!` (for invert flag). The remaining string is the prerequisite key. `HasPrerequisites()` checks all prerequisites with their modifiers. `IsHidden()` checks only `~`-prefixed prerequisites.

### ADR-11.6: Production Trait Variant Inheritance

- **Decision**: `ProductionParadrop`, `ProductionAirdrop`, and `ProductionFromMapEdge` extend `Production` via TypeScript `extends`. `ClassicProductionQueue` extends `ProductionQueue` via `extends`. Method overrides use `super.produce()` where appropriate.
- **Rationale**: OpenRA uses C# inheritance for production variants. Preserving this hierarchy in TypeScript enables code reuse and type safety. The base `Production.produce()` handles common logic (exit selection, spawn position, facing). Subclasses override for specific delivery mechanisms.
- **Mitigation**: Abstract methods are not needed since the base class has default implementations. Subclasses call `super.doProduction()` for common spawn logic, then add delivery-specific behavior (aircraft spawn, parachute, etc.).

### ADR-11.7: Deferred Activity Stubs for Transform and Demolition

- **Decision**: `Transforms.getTransformActivity()` and `Demolition.getDemolishActivity()` return `Activity` stubs that immediately complete. The actual `Transform` and `Demolish` Activity implementations are deferred to Chapter 14.
- **Rationale**: `Transform` and `Demolish` are complex state-machine Activities that involve movement, facing alignment, actor destruction, and new actor creation. Implementing them in Chapter 11 would delay the building system. The stubs allow `Transforms` and `Demolition` traits to be fully implemented and tested at the trait level.
- **Mitigation**: Activity stubs implement the `Activity` base class interface with `tick()` returning `ActivityStatus.Done` immediately. Integration tests verify that the correct stub type is returned. Chapter 14 will replace stubs with full implementations.

---

## Migration Order and Phasing Strategy

| Step | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase B (interface) | 2 | Buildable.ts + TechTree.ts (full implementation) | NO (blocks everything) |
| 2 | Phase B (infrastructure) | 2 | BuildingInfluence.ts + BuildingUtils.ts | YES (with each other) |
| 3 | Phase B (core) | 1 | Building.ts | After step 2 |
| 4 | Phase A (base) | 1 | Production.ts | After step 1 |
| 5 | Phase A (queue) | 1 | ProductionQueue.ts | After steps 1, 4 |
| 6 | Phase A (classic) | 1 | ClassicProductionQueue.ts | After step 5 |
| 7 | Phase A (variants) | 3 | ProductionParadrop + ProductionAirdrop + ProductionFromMapEdge | After step 4 |
| 8 | Phase A (support) | 3 | Exit.ts + RallyPoint.ts + PrimaryBuilding.ts | After step 4 |
| 9 | Phase B (placement) | 2 | PlaceBuilding.ts + PlaceBuildingOrderGenerator.ts | After steps 2, 3 |
| 10 | Phase B (features) | 6 | BaseProvider + LineBuild + RepairableBuilding + Gate + Transforms + Demolition | YES (most independent) |
| 11 | Phase B (markers) | 4 | BaseBuilding + PlaceBuildingVariants + RequiresBuildableArea + MapBuildRadius | YES (all independent) |

**Estimated Total**: ~4-5 weeks (single developer, sequential). Can be compressed to ~2-3 weeks with parallel assignment of LOW complexity files.

---

> **Chapter 11 milestone**: When complete, players can build bases, queue production, place buildings on the terrain, and manage construction yards. The production queue system drives the core RTS base-building loop, and the building system provides placement validation, occupancy tracking, and building-specific behaviors (repair, gates, transformation, demolition).

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.4 -- Chapter 11 outline
> - `docs/chapter10_resource_economy_migration_plan.md` -- Chapter 10 plan (dependency, format reference)
> - `docs/chapter9_movement_physics_migration_plan.md` -- Chapter 9 plan (format reference)
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Chapter 8 plan (format reference)
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
