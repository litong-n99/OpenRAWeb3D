# OpenRA to Babylon.js Migration Plan: Chapter 9 -- Unit Movement & Physics

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits -- Mobile, Aircraft, Movement)
> **Chapter Status**: PLANNING (0/32 migrated)
> **Planning Date**: 2026-06-13
> **Prerequisite**: Chapters 2-8 COMPLETE (219/219, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Core Movement Foundations](#31-phase-a-core-movement-foundations)
   - 3.2 [Phase B: Aircraft & Air Movement](#32-phase-b-aircraft--air-movement)
   - 3.3 [Phase C: World Movement Infrastructure](#33-phase-c-world-movement-infrastructure)
   - 3.4 [Phase D: Movement-Related Support Traits](#34-phase-d-movement-related-support-traits)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Unit Movement & Physics system is the **first spatial simulation chapter**. Unlike all previous chapters which established infrastructure (rendering, actors, maps, UI, network, input, combat), Chapter 9 implements the core RTS movement loop -- actors traverse the game world via pathfinding, respecting terrain passability, blocking rules, and altitude constraints.

The core paradigm shift: **from 2D grid-based position tracking to 3D TransformNode-based spatial simulation**:

- **Mobile.CenterPosition** maps to `TransformNode.position` as ground truth. `SetCenterPosition()` directly writes to `TransformNode.position`, with visual interpolation via `scene.onBeforeRenderObservable` for smooth rendering between game ticks.
- **Mobile.Facing** shifts from discrete 8/16/32-direction WAngle to continuous `mesh.rotation.y` angle with quantized sprite frame selection for rendering only.
- **Aircraft altitude** maps to `TransformNode.position.y` for height zones (ground, low, medium, high, super-high), with landing/reservation logic operating on the Y-axis.
- **Locomotor CellCache** shifts from C# `CellLayer<short>` record struct to TypeScript `Map<string, CellInfo>` with `LongBitSet<PlayerBitMask>` for per-player blocking state.
- **CellFlag enum** with bitwise AND/OR operations maps identically in JavaScript (32-bit integer bitwise ops are identical).
- **PathFinder** transitions from C# synchronous path request + callback to TypeScript async pathfinder integration with the existing Ch4 Phase G `HierarchicalPathFinder`.

This chapter builds on the pathfinding infrastructure from Chapter 4 Phase G (HPA\*, A\*, DensePathGraph, MapPathGraph, GridPathGraph, PathSearch, CellInfo, HierarchicalPathFinder), the coordinate primitives from Chapter 3 Phase A (CPos, CVec, WPos, WVec, WAngle, WDist, WRot), and the actor framework from Chapter 3 (GameActor, TraitDictionary, ConditionManager, ITick, INotifyCreated, IGameWorld).

### 1.2 Architecture Principles

1. **TransformNode.position is ground truth**: `Mobile.CenterPosition` and `Aircraft.CenterPosition` directly control `TransformNode.position` each tick. No separate position tracking. Visual interpolation reads from the same source and applies frame-rate-independent smoothing.

2. **IMove is the central movement interface**: Both `Mobile` and `Aircraft` implement `IMove`. This replaces the current duck-typing pattern with proper compile-time safety. All movement-related traits (AutoTarget, Harvester, etc.) interact with actors through `IMove` without knowing whether the actor is a ground unit or aircraft.

3. **Locomotor upgrades from stub to full implementation**: The existing 261-line Locomotor stub from Ch4 Phase G expands to the full 526-line equivalent with `UpdateCellBlocking`, `CanStayInCell`, `GetAvailableSubCell`, `IsBlockedBy`, `CellCache` with dirty cell tracking, `CellFlag` bitmasks, and `CellCostChanged` event. The existing `SimpleLocomotor` and `WallAwareLocomotor` from Ch4 Phase G become test-only mocks.

4. **Movement Activities are deferred to Chapter 14**: Chapter 9 provides factory methods (`MoveTo`, `MoveWithinRange`, `MoveFollow`, etc.) that return `Activity` stub instances. The actual `Activity` subclasses (`Move`, `MoveAdjacentTo`, `MoveOnto`, `MoveWithinRange`, `MoveToDock`) wait for Chapter 14 Phase A. This avoids circular dependencies and keeps Chapter 9 focused on the movement trait layer.

5. **PathFinder overlay debug tools are deferred**: `PathFinderOverlay` (286 lines) and `HierarchicalPathFinderOverlay` (188 lines) are developer-facing debug visualizations that render pathfinding state. These are deferred to a future Developer Tools / Debug phase. The core `PathFinder` trait (295 lines) is in Phase A because it bridges Mobile to the pathfinding system.

6. **Blocking uses existing Ch4 Phase G infrastructure**: `Mobile.CanEnterCell()` integrates with `DensePathGraph` / `MapPathGraph` cost functions, reusing `BlockedByActor` flags and `ICustomMovementLayer` from Chapter 4 Phase G. No new blocking primitives are introduced.

7. **Facing quantization is render-only**: Discrete facing directions (8, 16, 32) are used only for sprite frame selection (`BodyOrientation`, `QuantizeFacingsFromSequence`). The underlying rotation is a continuous `number` (radians) stored in `TransformNode.rotation.y`. Movement calculations use continuous angles.

8. **Visual interpolation is separate from game state**: All visual smoothing (hovers, position interpolation, rotation lerp) operates on Babylon.js scene objects via `scene.onBeforeRenderObservable`. Game logic operates at fixed 25-tick simulation rate. These two timelines never mix.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-8 is available for Chapter 9:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, sprite rendering |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, `AnimationWithOffset` |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `IFacing`, `IOccupySpace`, `IMoveInfo` |
| Activity base class | Ch3 Phase F | `Activity` abstract class + `ActivityRunner` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Coordinate Primitives | Ch3 Phase A | `CPos`, `CVec`, `WPos`, `WVec`, `WAngle`, `WDist`, `WRot` |
| Map + Terrain + CellLayer | Ch4 | `Map`, `CellLayer`, `CellRegion`, `TerrainInfo`, `MapGrid` |
| Pathfinding | Ch4 Phase G | `HierarchicalPathFinder`, `PathSearch`, `DensePathGraph`, `MapPathGraph`, `GridPathGraph`, `SparsePathGraph`, `CellInfo`, `CellInfoLayerPool`, `IPathGraph`, `Grid` |
| Movement Support | Ch4 Phase G | `BlockedByActor`, `ICustomMovementLayer`, `Locomotor` stub (261 lines), `SubCell` enum |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space conversion |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| Widget core | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager`, `IResolveOrder`, `IIssueOrder` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, `IMoveInfo` trait config |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Keycode`, `Viewport`, `SelectionUtils`, `HotkeyReference` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` (movement sounds) |
| Render traits | Ch7 Phase G | `RenderSprites`, `WithIdleOverlay` |
| Turreted (Ch8 Phase E) | Ch8 | `Turreted` trait (rotation for body orientation) |
| CombatInterfaces (Ch8 Phase D) | Ch8 | `DamageState`, `IHealth`, combat enums |
| Armament + AttackBase | Ch8 Phase D | Weapon system (interacts with IMove for range checks) |
| AutoTarget | Ch8 Phase D | Autonomous targeting (interacts with IMove for pursuit) |
| AttackMove | Ch8 Phase D | Stub (upgraded in Ch9 Phase D to full implementation) |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (32 files across 4 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Core Movement Foundations** | | | | | |
| 0 | `OpenRA.Mods.Common/TraitsInterfaces.cs` (IMove + INotifyMoving + INotifyFinishedMoving + IWrapMove + INotifyCenterPositionChanged + INotifyBlockingMove) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (expand existing) | `IMove`, `INotifyMoving`, `INotifyFinishedMoving`, `IWrapMove`, `INotifyCenterPositionChanged`, `INotifyBlockingMove` | ~85 | LOW | A |
| 1 | `OpenRA.Mods.Common/Traits/Immobile.cs` | `src/OpenRA.Mods.Common/Traits/Immobile.ts` | `Immobile` | 62 | LOW | A |
| 2 | `OpenRA.Mods.Common/Traits/World/Locomotor.cs` | `src/OpenRA.Mods.Common/Traits/World/Locomotor.ts` | `Locomotor` (expand from 261-line stub to 526-line full) | 526 | MEDIUM | A |
| 3 | `OpenRA.Mods.Common/Traits/Mobile.cs` | `src/OpenRA.Mods.Common/Traits/Mobile.ts` | `Mobile` | 1079 | HIGHEST | A |
| 4 | `OpenRA.Mods.Common/Traits/World/PathFinder.cs` | `src/OpenRA.Mods.Common/Traits/World/PathFinder.ts` | `PathFinder` | 295 | MEDIUM | A |

| **Phase B: Aircraft & Air Movement** | | | | | |
| 5 | `OpenRA.Mods.Common/Traits/Air/Aircraft.cs` | `src/OpenRA.Mods.Common/Traits/Air/Aircraft.ts` | `Aircraft` | 1381 | HIGH | B |
| 6 | `OpenRA.Mods.Common/Traits/Air/FallsToEarth.cs` | `src/OpenRA.Mods.Common/Traits/Air/FallsToEarth.ts` | `FallsToEarth` | 71 | LOW | B |
| 7 | `OpenRA.Mods.Common/Traits/BodyOrientation.cs` | `src/OpenRA.Mods.Common/Traits/BodyOrientation.ts` | `BodyOrientation` | 127 | LOW | B |
| 8 | `OpenRA.Mods.Common/Traits/QuantizeFacingsFromSequence.cs` | `src/OpenRA.Mods.Common/Traits/QuantizeFacingsFromSequence.ts` | `QuantizeFacingsFromSequence` | 48 | LOW | B |

| **Phase C: World Movement Infrastructure** | | | | | |
| 9 | `OpenRA.Mods.Common/Traits/World/SubterraneanLocomotor.cs` | `src/OpenRA.Mods.Common/Traits/World/SubterraneanLocomotor.ts` | `SubterraneanLocomotor` | 43 | LOW | C |
| 10 | `OpenRA.Mods.Common/Traits/World/SubterraneanActorLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/SubterraneanActorLayer.ts` | `SubterraneanActorLayer` | 105 | LOW-MEDIUM | C |
| 11 | `OpenRA.Mods.Common/Traits/World/ElevatedBridgeLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/ElevatedBridgeLayer.ts` | `ElevatedBridgeLayer` | 97 | LOW-MEDIUM | C |
| 12 | `OpenRA.Mods.Common/Traits/World/ElevatedBridgePlaceholder.cs` | `src/OpenRA.Mods.Common/Traits/World/ElevatedBridgePlaceholder.ts` | `ElevatedBridgePlaceholder` | 75 | LOW | C |
| 13 | `OpenRA.Mods.Common/Traits/World/BridgeLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/BridgeLayer.ts` | `BridgeLayer` | 62 | LOW | C |
| 14 | `OpenRA.Mods.Common/Traits/World/LegacyBridgeLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/LegacyBridgeLayer.ts` | `LegacyBridgeLayer` | 123 | MEDIUM | C |
| 15 | `OpenRA.Mods.Common/Traits/World/TerrainTunnel.cs` | `src/OpenRA.Mods.Common/Traits/World/TerrainTunnel.ts` | `TerrainTunnel` | 63 | LOW | C |
| 16 | `OpenRA.Mods.Common/Traits/World/TerrainTunnelLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/TerrainTunnelLayer.ts` | `TerrainTunnelLayer` | 96 | LOW-MEDIUM | C |
| 17 | `OpenRA.Mods.Common/Traits/TunnelEntrance.cs` | `src/OpenRA.Mods.Common/Traits/TunnelEntrance.ts` | `TunnelEntrance` | 73 | LOW | C |
| 18 | `OpenRA.Mods.Common/Traits/EntersTunnels.cs` | `src/OpenRA.Mods.Common/Traits/EntersTunnels.ts` | `EntersTunnels` | 163 | LOW-MEDIUM | C |

| **Phase D: Movement-Related Support Traits** | | | | | |
| 19 | `OpenRA.Mods.Common/Traits/BlocksProjectiles.cs` | `src/OpenRA.Mods.Common/Traits/BlocksProjectiles.ts` | `BlocksProjectiles` | 74 | LOW | D |
| 20 | `OpenRA.Mods.Common/Traits/Crushable.cs` | `src/OpenRA.Mods.Common/Traits/Crushable.ts` | `Crushable` | 97 | LOW | D |
| 21 | `OpenRA.Mods.Common/Traits/AutoCrusher.cs` | `src/OpenRA.Mods.Common/Traits/AutoCrusher.ts` | `AutoCrusher` | 103 | LOW | D |
| 22 | `OpenRA.Mods.Common/Traits/TransformCrusherOnCrush.cs` | `src/OpenRA.Mods.Common/Traits/TransformCrusherOnCrush.ts` | `TransformCrusherOnCrush` | 59 | LOW | D |
| 23 | `OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnMovement.cs` | `src/OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnMovement.ts` | `GrantConditionOnMovement` | 65 | LOW | D |
| 24 | `OpenRA.Mods.Common/Traits/Render/Hovers.cs` | `src/OpenRA.Mods.Common/Traits/Render/Hovers.ts` | `Hovers` | 121 | LOW-MEDIUM | D |
| 25 | `OpenRA.Mods.Common/Traits/Infantry/TerrainModifiesDamage.cs` | `src/OpenRA.Mods.Common/Traits/Infantry/TerrainModifiesDamage.ts` | `TerrainModifiesDamage` | 60 | LOW | D |
| 26 | `OpenRA.Mods.Common/Traits/Multipliers/SpeedMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/SpeedMultiplier.ts` | `SpeedMultiplier` | 31 | LOW | D |
| 27 | `OpenRA.Mods.Common/Traits/AttackMove.cs` | `src/OpenRA.Mods.Common/Traits/AttackMove.ts` | `AttackMove` (upgrade from Ch8 Phase D stub to full) | 179 | LOW-MEDIUM | D |
| 28 | `OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientation.cs` | `src/OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientation.ts` | `ClassicFacingBodyOrientation` (C&C-specific) | 36 | LOW | D |
| 29 | `OpenRA.Mods.Cnc/Traits/World/JumpjetLocomotor.cs` | `src/OpenRA.Mods.Cnc/Traits/World/JumpjetLocomotor.ts` | `JumpjetLocomotor` (C&C-specific) | 41 | LOW | D |
| 30 | `OpenRA.Mods.Common/Traits/World/PathFinderOverlay.cs` | DEFERRED to Developer Tools phase | `PathFinderOverlay` | 286 | DEFER | D |
| 31 | `OpenRA.Mods.Common/Traits/World/HierarchicalPathFinderOverlay.cs` | DEFERRED to Developer Tools phase | `HierarchicalPathFinderOverlay` | 188 | DEFER | D |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies. 30-175 lines of C#. Can be parallel-assigned.
> - **LOW-MEDIUM**: Moderate logic requiring ICustomMovementLayer integration or tunnel state management. 95-165 lines of C#.
> - **MEDIUM**: Core movement infrastructure with cell blocking, path coordination, or bridge generation. 120-530 lines of C#.
> - **HIGH**: Complex flight physics with altitude, landing, reservation, repulsion. 1381 lines of C#. Significant 3D integration.
> - **HIGHEST**: The largest single trait in OpenRA (1079 lines). Full movement state machine, order handling, visual interpolation, cell blocking, sub-cell precision.
> - **DEFER**: Developer debug visualization tool -- not needed for gameplay.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 32 (28 core + 2 C&C-specific + 2 deferred overlays) |
| **Phase A (Core Movement)** | 4 files + 1 interface expansion (TraitsInterfaces.ts) |
| **Phase B (Aircraft & Air)** | 4 files |
| **Phase C (World Infrastructure)** | 10 files |
| **Phase D (Support Traits)** | 13 files (11 active + 2 deferred) |
| **HIGHEST complexity** | 1 file (Mobile: 1079 lines) |
| **HIGH complexity** | 1 file (Aircraft: 1381 lines) |
| **MEDIUM complexity** | 3 files (Locomotor: 526, PathFinder: 295, LegacyBridgeLayer: 123) |
| **LOW-MEDIUM complexity** | 5 files (SubterraneanActorLayer: 105, ElevatedBridgeLayer: 97, TerrainTunnelLayer: 96, EntersTunnels: 163, Hovers: 121, AttackMove: 179) |
| **LOW complexity** | 20 files |
| **DEFERRED** | 2 files (PathFinderOverlay: 286, HierarchicalPathFinderOverlay: 188) |
| **Total active OpenRA C# source lines** | ~5,355 (28 core + 2 C&C) |
| **Total including deferred** | ~5,829 |

| Phase | Files | C# Lines | Complexity | Status |
|:---|:---:|:---:|:---|:---|
| A: Core Movement Foundations | 5 (4 files + interface) | 2,047 | HIGHEST + MEDIUM + LOW | PLANNING (0/5) |
| B: Aircraft & Air Movement | 4 | 1,627 | HIGH + LOW | PLANNING (0/4) |
| C: World Movement Infrastructure | 10 | 900 | MEDIUM + LOW-MEDIUM + LOW | PLANNING (0/10) |
| D: Movement-Related Support Traits | 11 active + 2 deferred | 866 active + 474 deferred | LOW-MEDIUM + LOW | PLANNING (0/13) |
| **Total** | **30 active + 2 deferred** | **~5,355 active** | | **PLANNING (0/32)** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Core Movement Foundations

**Status**: PLANNING (0/5)
**Complexity**: HIGHEST (Mobile 1079 lines) + MEDIUM + LOW (Immobile 62, Locomotor expand 526, PathFinder 295)
**Blocked by**: Chapters 2-8 (foundation) -- ALL COMPLETE. Specifically: Ch3 Phase A (CPos/CVec/WPos/WVec/WAngle/WDist/WRot), Ch3 (GameActor, TraitDictionary, ITick, INotifyAddedToWorld/RemovedFromWorld, INotifyBecomingIdle), Ch3 (IFacing, IOccupySpace, IMoveInfo, ICreationActivity, IDeathActorInitModifier, IActorPreviewInitModifier), Ch4 Phase G (HierarchicalPathFinder, PathSearch, CellInfo, DensePathGraph, MapPathGraph, BlockedByActor, ICustomMovementLayer, Locomotor stub), Ch4 Phase I (CoordinateTransformer), Ch6 Phase A (Order, IResolveOrder, IIssueOrder), Ch8 Phase D (IMove, IPositionable integration needs), Ch8 Phase E (Turreted for body orientation)
**Blocks**: Phase B (Aircraft implements IMove -- needs interface finalized), Phase C (SubterraneanLocomotor extends Locomotor), Phase D (AttackMove upgrades stub, all movement-related traits need IMove), Chapter 10 (Harvester movement), Chapter 11 (Production unit exit), Chapter 12 (MoveIntoShroud), Chapter 14 (Movement Activities)

**Description**: Phase A establishes the core movement foundation. The `IMove` interface (with all its sub-interfaces `INotifyMoving`, `INotifyFinishedMoving`, `IWrapMove`, `INotifyCenterPositionChanged`, `INotifyBlockingMove`) must be fully defined in `TraitsInterfaces.ts` before any implementing trait can be written. `Immobile` provides `IOccupySpace` for static actors (buildings, walls) and is the simplest trait to implement first. `Locomotor` is upgraded from the 261-line Ch4 Phase G stub to the full 526-line version with cell blocking, dirty cell tracking, and terrain cost management. `Mobile` at 1079 lines is the single largest trait in OpenRA -- it implements `IPositionable`, `IMove`, `IFacing`, `ITick`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `ICreationActivity`, `IDeathActorInitModifier`, `IActorPreviewInitModifier`, `INotifyBecomingIdle`, and order handlers for Move, Stop, and Scatter. `PathFinder` wires `Locomotor` to `HierarchicalPathFinder` and handles multi-source/target path queries with domain passability checks.

**Paradigm Shifts**:
- C# `Mobile.CenterPosition` WPos fixed-point 3D vector -> `TransformNode.position` BABYLON.Vector3 directly
- C# `Mobile.IsTraitPaused` / `Mobile.IsImmovable` state -> Component `enabled` flag + Condition system integration
- C# `Mobile.SetPosition()` grid-based teleport -> Direct `TransformNode.position` set + visual interpolation
- C# `Mobile.Facing` WAngle discrete direction -> Continuous `mesh.rotation.y` (radians) + quantized sprite frame
- C# `Mobile.VisualPosition` screen-space lerp -> `TransformNode.position` smoothly interpolated via `scene.onBeforeRenderObservable`
- C# `Locomotor.CellCache` record struct with `LongBitSet` -> TypeScript readonly class with `LongBitSet<PlayerBitMask>`
- C# `Locomotor.CellFlag` enum bitwise ops -> Numeric flags with identical bitwise ops in JavaScript
- C# `Locomotor.UpdateCellBlocking()` dirty cell system -> TypeScript `Set<number>` for dirty cell tracking + `CellCostChanged` event emitter
- C# `PathFinder.FindPath()` synchronous callback -> Async pathfinder integration reusing existing Ch4 Phase G `HierarchicalPathFinder`
- C# `SubCell` enum sub-cell precision -> Same enum (already in Ch4 Phase G pathfinding)

#### 3.1.0 TraitsInterfaces Expansion: IMove + Movement Notification Interfaces

- [ ] **TODO-9.A.0** `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (expand existing) -- Add full `IMove` interface and movement notification interfaces:
  - `IMove` interface (extends existing `IMoveInfo` trait info):
    - `moveTo(source: IGameActor, target: Target): Activity` -- create Move activity to target cell/actor
    - `moveWithinRange(source: IGameActor, target: Target, range: WDist, initialTarget?: Target): Activity` -- create MoveWithinRange activity
    - `moveFollow(source: IGameActor, target: Target, range: WDist, followTarget: Target, initialTarget?: Target): Activity` -- create MoveFollow activity
    - `moveToTarget(source: IGameActor, target: Target): Activity` -- create MoveToTarget activity
    - `moveIntoTarget(source: IGameActor, target: Target): Activity` -- create MoveIntoTarget activity
    - `moveOntoTarget(source: IGameActor, target: Target, facingTarget: Target): Activity` -- create MoveOntoTarget activity
    - `localMove(source: IGameActor, destination: WPos): Activity` -- create local-position move activity
    - `estimatedMoveDuration(source: IGameActor, from: WPos, to: WPos): number` -- estimate ticks to travel distance
    - `nearestMoveableCell(source: IGameActor, target: WPos): CPos` -- find nearest passable cell to position
    - `canEnterTargetNow(source: IGameActor, target: Target): boolean` -- immediate passability check
    - `currentMovementTypes: Set<string>` -- active movement type set (e.g., "horizontal", "vertical" via SpeedMultiplier)
  - `INotifyMoving` interface (actor started moving):
    - `onNotifyMoving(self: IGameActor): void`
  - `INotifyFinishedMoving` interface (actor finished or failed to move):
    - `onNotifyFinishedMoving(self: IGameActor): void`
  - `IWrapMove` interface (wrap movement around map edges):
    - `onWrapMove(self: IGameActor, oldPos: WPos, newPos: WPos): WPos`
  - `INotifyCenterPositionChanged` interface (center of actor changed):
    - `onCenterPositionChanged(self: IGameActor): void`
  - `INotifyBlockingMove` interface (actor is blocking another's movement):
    - `onNotifyBlockingMove(self: IGameActor, blocking: IGameActor): void`
  - **Note**: All Activity return types are stubs (`class Activity {}` minimal) until Chapter 14

#### 3.1.1 Immobile

- [ ] **TODO-9.A.1** `src/OpenRA.Mods.Common/Traits/Immobile.ts` (62 lines C#) -- `IOccupySpace` for static actors:
  - Implements `IOccupySpace` for buildings, walls, and other stationary actors
  - `occupiesSpace: boolean` config flag (default true)
  - `centerPosition: WPos` calculated from actor's TopLeft cell + MapGrid offset
  - `occupiedCells(): CPos[]` returns single cell (for buildings: footprint via Tileset/Building trait later)
  - Integration with `IOccupySpace` interface (already in Ch3 TraitsInterfaces.ts)
  - No movement logic -- static position only
  - `INotifyAddedToWorld` handler: register occupied cell with world map
  - `INotifyRemovedFromWorld` handler: unregister occupied cell

#### 3.1.2 Locomotor (Expand from Stub)

- [ ] **TODO-9.A.2** `src/OpenRA.Mods.Common/Traits/World/Locomotor.ts` (expand from 261-line stub to 526-line C# full) -- Full locomotion system:
  - `LocomotorInfo` config class: `name: string`, `crushes: string[]`, `crushDamageTypes: Set<string>`, `terrainInfos: Map<string, TerrainInfo>`, `sharesCell: boolean`, `moveIntoShroud: boolean`
  - `TerrainInfo` inner class: `speed: number` (percentage), `cost: number` (path cost multiplier), `transitionCost: number`
  - `WorldMovementInfo` inner class: `world: IGameWorld`, `actor: IGameActor`, `index: number`
  - `UpdateCellBlocking(cell: CPos)` -- refresh blocking state for a cell; detects when `CellFlag` transitions (HasMovingActor, HasBlockingActor, HasTemporaryBlocker)
  - `CanStayInCell(cell: CPos, blockedBy: SubCell): boolean` -- check if actor can remain in cell
  - `GetAvailableSubCell(actor: IGameActor, cell: CPos, blockedBy: SubCell, ignoreActor?: IGameActor): SubCell` -- find an unoccupied sub-cell position
  - `IsBlockedBy(actor: IGameActor, other: IGameActor, blockedBy: SubCell): boolean` -- check if `other` actor blocks `actor` at the given sub-cell precision
  - `CellCache` class: per-player blocking state map, tracks `CellFlag` per cell (HasMovingActor = 1, HasBlockingActor = 2, HasTemporaryBlocker = 4) via bitwise flags
  - Dirty cell system: `dirtyCells: Set<number>` tracking cells whose blocking state changed; `CellCostChanged` event emitter fires on batch processing
  - `CellFlag` enum with bitwise operations: `HasMovingActor = 1`, `HasBlockingActor = 2`, `HasTemporaryBlocker = 4`
  - `LongBitSet<PlayerBitMask>` for per-player blocking state (reuses Ch4 Phase G `LongBitSet`)
  - Integration with `ICustomMovementLayer` (already in Ch4 Phase G) for subterranean/elevated layer passability
  - `sharesCell` logic: multiple actors can occupy the same cell if `sharesCell` is true (infantry squad behavior)
  - `moveIntoShroud` logic: actors can move into unexplored territory if flag is true
  - Terrain speed/cost lookup: `terrainInfos` map keyed by terrain type string, provides speed percentage and path cost multiplier
  - **Note**: Existing `SimpleLocomotor` and `WallAwareLocomotor` from Ch4 Phase G tests become mock implementations. The real Locomotor replaces them for gameplay.

#### 3.1.3 Mobile

- [ ] **TODO-9.A.3** `src/OpenRA.Mods.Common/Traits/Mobile.ts` (1079 lines C#) -- Full mobile unit trait:
  - `MobileInfo` config class: `locomotor: string`, `speed: number` (ticks per cell), `turnSpeed: number` (facings per tick), `initialFacing: WAngle`, `crushes: string[]`, `crushDamageTypes: Set<string>`, `terrainOrientationAdjustment: number`, `moveCursor: string`, `blockedCursor: string`, `moveBlockedNotification: string`, `movementType: string`
  - `IPositionable` implementation:
    - `centerPosition: WPos` -- getter returns current `TransformNode.position` via CoordinateTransformer
    - `setCenterPosition(actor, value)` -- writes `TransformNode.position` directly (teleport)
    - `canCenterPositionChange(actor): boolean` -- checks if NotMobile condition is active
    - `isInWorld(actor): boolean` -- is actor placed on map
    - `isLeavingMap(actor): boolean` -- is actor exiting map
  - `IMove` implementation:
    - `moveTo()`, `moveWithinRange()`, `moveFollow()`, `moveToTarget()`, `moveIntoTarget()`, `moveOntoTarget()` -- all return Activity stubs
    - `localMove(source, destination)` -- local position move without pathfinding
    - `estimatedMoveDuration(from, to)` -- distance / speed in tick units
    - `nearestMoveableCell(target)` -- delegates to Locomotor + PathFinder
    - `canEnterTargetNow(target)` -- immediate cell passability check
    - `currentMovementTypes: Set<string>` -- movement type set from SpeedMultiplier
  - `IFacing` implementation:
    - `facing: WAngle` -- current facing angle
    - `desiredFacing: WAngle` -- target facing to rotate toward
    - `turnSpeed: number` -- facings per tick rotation speed
    - `turnToFacing(desiredFacing)` -- set target facing
    - `rotateToFacing(actor)` -- advance rotation by `turnSpeed` toward `desiredFacing`
  - `ITick` implementation:
    - `tick(actor)` -- advance movement (if moving along path), rotate toward facing, update blocking cache
    - Path following: advance `centerPosition` along current path segment at `speed` WDist/tick
    - Sub-cell precision for position within cell
  - Order handlers (`IResolveOrder`):
    - `resolveOrder(actor, order)` -- handle "Move", "Stop", "Scatter", "AttackMove" orders
    - "Move": create MoveTo activity to order target cell
    - "Stop": cancel current activity, clear path
    - "Scatter": create local move to random position within scatter radius
  - `INotifyAddedToWorld` / `INotifyRemovedFromWorld`:
    - Register/unregister with Locomotor for cell blocking
    - Add/remove influence on `IOccupySpace` map
  - `INotifyBecomingIdle`:
    - Reset path-following state when activity completes
    - Clear `moveToCell` target
  - `ICreationActivity`: returns `ReturnToCellActivity` (stub -- deferred to Ch14)
  - Inner classes (stubs):
    - `ReturnToCellActivity`: moves actor to nearest valid cell on creation (deferred to Ch14)
    - `LeaveProductionActivity`: exits production facility (deferred to Ch11)
    - `MoveOrderTargeter`: order generator for move orders (deferred to Ch15)
  - `currentMovementTypes: Set<string>` -- set that SpeedMultiplier traits add/remove types to
  - `visualPosition: WPos` -- separate smoothed position for rendering (lerp to centerPosition each render frame)
  - `canEnterCell(cell, blockedBy, ignoreActor?)` -- delegates to Locomotor for passability check
  - `isTraitPaused: boolean` -- true when actor is disabled (NotMobile condition)
  - `isImmovable: boolean` -- true when actor cannot move at all (frozen, stunned)
  - Terrain speed modifier: multiply base speed by terrain speed percentage from Locomotor
  - Facing quantization for rendering: continuous facing angle -> discrete sprite frame index via `QuantizeFacingsFromSequence`
  - **3D integration**: `TransformNode.position` = `centerPosition` converted via CoordinateTransformer; `TransformNode.rotation.y` = continuous facing radians; `visualPosition` for smooth frame interpolation

#### 3.1.4 PathFinder

- [ ] **TODO-9.A.4** `src/OpenRA.Mods.Common/Traits/World/PathFinder.ts` (295 lines C#) -- World-level pathfinding coordinator:
  - `PathFinderInfo` config class: no config fields (marker trait)
  - `findPathToTarget(world, sources, target, blockedBy, check, ignoreActor?): PathResult` -- main pathfinding entry point
  - `findPathToTargetCell(world, sources, targetCell, blockedBy, check, ignoreActor?): PathResult` -- cell-target variant
  - `findPath(world, locomotor, actor, sources, target, blockedBy, check, ignoreActor?): PathResult` -- internal method
  - `pathExistsForLocomotor(locomotor, sources, check): boolean` -- existence check only (no path reconstruction)
  - Multi-source support: iterate `sources: CPos[]`, find best path from any source
  - Target support: both `CPos` (cell) and `Target` (actor/position) targets
  - Domain passability checks: verify each locomotor's terrain domains pass through path nodes
  - Wires Locomotor.terrainInfos -> HierarchicalPathFinder via custom cost function
  - `PathResult` class: `path: CPos[] | null`, `cost: number`, `source: CPos`, `target: CPos`
  - Caching: cache last N path results for repeated queries (optional optimization deferred)
  - Integration with Ch4 Phase G `HierarchicalPathFinder` for HPA\* path computation
  - Integration with Ch4 Phase G `DensePathGraph` / `MapPathGraph` for domain-specific cost functions
  - `blockedBy: SubCell` pass-through to Locomotor pathfinding
  - `check: (CPos) => boolean` -- per-cell custom passability override (e.g., for BlockedByActor checks)
  - `ignoreActor?: IGameActor` -- exclude a specific actor from blocking checks (self)
  - **Async pattern**: path computation is synchronous per OpenRA design (runs within tick); result returned immediately

**Phase A Summary**: 5 items (1 interface expansion + 4 files), ~2,047 C# lines source. Mobile (1079 lines) is the single largest trait in OpenRA and must be carefully ported line-for-line. Locomotor (526 lines) expands from the existing 261-line stub. Immobile (62 lines) is the simplest -- good warm-up task. PathFinder (295 lines) bridges Locomotor to HierarchicalPathFinder. Estimated ~65 unit tests. Estimated ~3,500 TypeScript implementation lines.

---

### 3.2 Phase B: Aircraft & Air Movement

**Status**: PLANNING (0/4)
**Complexity**: HIGH (Aircraft 1381 lines) + LOW (FallsToEarth 71, BodyOrientation 127, QuantizeFacingsFromSequence 48)
**Blocked by**: Phase A (IMove interface must be finalized in TraitsInterfaces.ts; Mobile provides reference IMove implementation; BodyOrientation depends on IMove + IFacing; QuantizeFacingsFromSequence needs body orientation system)
**Blocks**: Chapter 11 (Production unit exit for aircraft), Chapter 13 (Paradrops/Airstrike), Chapter 14 (Aircraft movement activities), Chapter 19 (C&C-specific aircraft traits)
**Already migrated from Ch8 Phase E**: `AttackAircraft.ts`, `AttackBomber.ts`

**Description**: Aircraft are the second major `IMove` implementation. At 1381 lines, `Aircraft` is slightly larger than `Mobile` (1079) due to altitude management, landing/reservation, repulsion, and airfield coordination. `FallsToEarth` handles aircraft death/husk behavior. `BodyOrientation` and `QuantizeFacingsFromSequence` are rendering utilities that map continuous facing angles to discrete sprite frames, shared between Mobile and Aircraft.

**Paradigm Shifts**:
- C# `Aircraft.Fly` altitude management -> `TransformNode.position.y` mapped to discrete height zones (ground=0, low, medium, high, super-high)
- C# `Aircraft.altitude` enum -> TypeScript `Altitude` numeric enum with Y-axis offsets
- C# `Aircraft.reserveCell()` / `Aircraft.unreserveCell()` -> Cell reservation map in `WorldMovementInfo`
- C# `Aircraft.repulse()` -> Air-to-air collision avoidance via distance checks and `TransformNode.position` push
- C# `Aircraft.landing` state machine -> TypeScript state machine: TakeOff, Cruising, Landing, Landed
- C# `BodyOrientation` WAngle quantization -> Render-only: continuous `mesh.rotation.y` -> quantized sprite frame index
- C# `QuantizeFacingsFromSequence` auto-detect facings -> Read `SequenceProvider` data to count facings per body

#### 3.2.1 Aircraft

- [ ] **TODO-9.B.1** `src/OpenRA.Mods.Common/Traits/Air/Aircraft.ts` (1381 lines C#) -- Full aircraft movement trait:
  - `AircraftInfo` config class: `speed: number`, `turnSpeed: number`, `initialFacing: WAngle`, `cruiseAltitude: WDist`, `maximumPitch: WAngle`, `landableTerrainTypes: Set<string>`, `repulsionRadius: number`, `idleBehavior: AirIdleBehavior` (Circle, Land, LeaveMap, None), `moveCursor: string`, `blockedCursor: string`, `canHover: boolean`, `canSlide: boolean`, `landWhenIdle: boolean`, `landOnReservoir: boolean`
  - `IPositionable` implementation (same as Mobile):
    - `centerPosition: WPos` -- with Y-coordinate from altitude
    - `setCenterPosition(actor, value)` -- direct set including altitude
    - `canCenterPositionChange`, `isInWorld`, `isLeavingMap`
  - `IMove` implementation:
    - All `moveTo*` factory methods returning Activity stubs
    - `estimatedMoveDuration` -- includes altitude change time
    - `nearestMoveableCell` -- nearest landable cell
    - `canEnterTargetNow` -- check landability
  - `IFacing` implementation:
    - `facing: WAngle` -- horizontal facing (yaw)
    - `desiredFacing`, `turnSpeed`, `turnToFacing`, `rotateToFacing`
  - `ITick` implementation:
    - `tick(actor)` -- advance flight path, manage altitude transitions, handle reservation
    - `Fly(world, actor)` -- core flight update per tick
    - `FlyTick(world, actor, desiredFacing, desiredAltitude)` -- advance facing and altitude toward targets
  - Altitude management:
    - `altitude: WDist` -- current flight height
    - `desiredAltitude: WDist` -- target flight height
    - `verticalSpeed: WDist` -- altitude change per tick
    - Altitude zones: `Ground` (0), `Low`, `Medium`, `High`, `VeryHigh` mapped to Y-axis offsets
    - `mapAltitudeToY(altitude: WDist): number` -- convert WDist to Babylon.js Y coordinate
  - Landing system:
    - `landing: boolean` -- in landing sequence
    - `reserveCell(actor)` -- reserve landing cell
    - `unreserveCell(actor)` -- release landing cell
    - `canLand(cell: CPos, ignoreActor?: IGameActor): boolean` -- landing clearance check
    - `land(actor)` -- initiate landing sequence
    - `takeOff(actor)` -- initiate takeoff sequence
    - `landingAltitudes: WDist[]` -- altitude steps during descent
    - `landingTicks: number` -- ticks per altitude step
  - Repulsion system:
    - `repulse(actor)` -- push away from nearby aircraft to avoid collision
    - `repulsionRadius: number` -- radius in cells for repulsion check
    - Force-based push: `TransformNode.position` offset each tick
  - Reservation system:
    - `reserveCell(cell)` -- mark cell as reserved for landing
    - `unreserveCell()` -- release reservation
    - Reservation conflict detection: two aircraft cannot reserve same cell
  - `AssociateWithAirfieldActivity` inner class (stub -- deferred to Ch14):
    - Links aircraft to home airfield on creation
  - `AircraftMoveOrderTargeter` inner class (stub -- deferred to Ch15):
    - Order generator for aircraft move orders
  - Order handlers: "Move", "Stop", "ReturnToBase", "Land"
  - `INotifyAddedToWorld` / `INotifyRemovedFromWorld`:
    - Register with airspace tracker
    - Reserve home airfield cell
  - **3D integration**: `TransformNode.position.y` from altitude; `TransformNode.rotation.y` = yaw (facing); pitch from `maximumPitch` applied to `TransformNode.rotation.x` during ascent/descent; roll during banking turns

#### 3.2.2 FallsToEarth

- [ ] **TODO-9.B.2** `src/OpenRA.Mods.Common/Traits/Air/FallsToEarth.ts` (71 lines C#) -- Aircraft death husk behavior:
  - `FallsToEarthInfo` config class: `explosion: string`, `moves: boolean`, `velocity: WDist` (fall speed)
  - Implements `IEffectiveOwner` (returns original owner for kill credit)
  - Implements `INotifyCreated`:
    - `created(actor)` -- initiates fall sequence on creation
  - Fall sequence: descend from current altitude to ground at `velocity` per tick
  - On ground contact: trigger explosion warhead, dispose actor
  - Moves while falling if `moves: true` (horizontal momentum)
  - Used for aircraft shot down mid-flight (aircraft husk falls to ground)
  - 3D: animate `TransformNode.position.y` toward 0 at `velocity` rate

#### 3.2.3 BodyOrientation

- [ ] **TODO-9.B.3** `src/OpenRA.Mods.Common/Traits/BodyOrientation.ts` (127 lines C#) -- Facing quantization for sprite rendering:
  - `BodyOrientationInfo` config class: `quantizedFacings: number` (8, 16, 32), `cameraPitch: WAngle` (0=top-down, 90=side-view)
  - `quantizedFacings: number` -- number of discrete facing directions in sprite sheet
  - `worldToLocal(worldFacingVec: WVec, actorFacing: WAngle): WRot` -- convert world-space facing vector to local-space orientation angles (yaw, pitch, roll)
  - `localToWorld(localOrientation: WRot, actorFacing: WAngle): WVec` -- convert local-space orientation back to world-space facing vector
  - `quantizeFacing(facing: WAngle, facings: number): WAngle` -- snap continuous facing to nearest discrete step
  - Facing step size = 360 / quantizedFacings degrees
  - `cameraPitch` affects sprite Y-offset for perspective correction
  - Integration with `IFacing` trait from Mobile/Aircraft to get current facing
  - Integration with `RenderSprites` (Ch7 Phase G) for sprite frame selection
  - 3D: continuous `mesh.rotation.y` maps to discrete sprite frame index via `quantizeFacing()`

#### 3.2.4 QuantizeFacingsFromSequence

- [ ] **TODO-9.B.4** `src/OpenRA.Mods.Common/Traits/QuantizeFacingsFromSequence.ts` (48 lines C#) -- Auto-detect facing count from sprite sequences:
  - `QuantizeFacingsFromSequenceInfo` config class: `sequence: string` (sprite sequence to inspect)
  - Auto-detects `quantizedFacings` count from the number of facings in the named sprite sequence
  - Reads `SequenceProvider` data at actor creation time
  - Counts distinct facings in the sequence (8, 16, or 32)
  - Sets `BodyOrientation.quantizedFacings` to detected value
  - Simplifies configuration: modder specifies sequence name, facings count derived automatically
  - Integration with Ch2 `SequenceProvider` / `Animation` for sequence data access

**Phase B Summary**: 4 files, ~1,627 C# lines source. Aircraft (1381 lines) is the second-largest trait after Mobile. FallsToEarth (71 lines) is a simple death handler. BodyOrientation (127 lines) and QuantizeFacingsFromSequence (48 lines) are rendering utilities shared between Mobile and Aircraft. Estimated ~45 unit tests. Estimated ~3,000 TypeScript implementation lines.

---

### 3.3 Phase C: World Movement Infrastructure

**Status**: PLANNING (0/10)
**Complexity**: MEDIUM + LOW-MEDIUM + LOW (10 files, ~900 lines total)
**Blocked by**: Phase A (Locomotor must be complete -- SubterraneanLocomotor extends it; ICustomMovementLayer from Ch4 Phase G needed by all *Layer implementations; Map + TerrainInfo from Ch4 needed by all terrain-aware traits)
**Blocks**: Phase D (AutoCrusher needs BridgeLayer/TunnelLayer for crush path checks), Chapter 10 (Harvester route to resource), Chapter 14 (tunnel/bridge movement activities)

**Description**: World movement infrastructure provides terrain-aware movement layers beyond the base ground plane. `SubterraneanLocomotor` extends `Locomotor` for underground units. `SubterraneanActorLayer` provides the underground `ICustomMovementLayer`. Bridge infrastructure (`BridgeLayer`, `LegacyBridgeLayer`, `ElevatedBridgeLayer`, `ElevatedBridgePlaceholder`) handles bridge movement. Tunnel infrastructure (`TerrainTunnel`, `TerrainTunnelLayer`, `TunnelEntrance`, `EntersTunnels`) handles tunnel portals and underground passage.

**Paradigm Shifts**:
- C# `SubterraneanLocomotor` extends `Locomotor` -> TypeScript class extends `Locomotor` with `super()` chaining
- C# `ICustomMovementLayer.getTerrainHeight()` -> Babylon.js Y-offset for terrain layer height
- C# `LegacyBridgeLayer` template-based bridge generation -> TypeScript with tile-based bridge footprint interpolation
- C# `TunnelEntrance` portal linking -> TypeScript `Map<CPos, StagingPoint>` with bidirectional portal pairs
- C# `EntersTunnels` order handler -> TypeScript IIssueOrder + IResolveOrder integration

#### 3.3.1 SubterraneanLocomotor

- [ ] **TODO-9.C.1** `src/OpenRA.Mods.Common/Traits/World/SubterraneanLocomotor.ts` (43 lines C#) -- Underground locomotor:
  - Extends `Locomotor` with underground terrain passability
  - `SubterraneanLocomotorInfo` config class: `subterraneanTransitionCost: number`
  - Override terrain cost lookup to use subterranean-specific terrain costs
  - Integration with `SubterraneanActorLayer` for underground cell occupancy
  - All movement operates in the subterranean layer (not ground plane)
  - Pathfinding uses the subterranean movement domain

#### 3.3.2 SubterraneanActorLayer

- [ ] **TODO-9.C.2** `src/OpenRA.Mods.Common/Traits/World/SubterraneanActorLayer.ts` (105 lines C#) -- Underground movement layer:
  - Implements `ICustomMovementLayer` from Ch4 Phase G
  - `index: number` -- layer index for pathfinding domain
  - `enabledForLocomotor(locomotor: LocomotorInfo): boolean` -- only `SubterraneanLocomotor` enabled
  - `entryCostForCell(cell: CPos): number` -- transition cost at cell entrance
  - `getTerrainHeight(cell: CPos): number` -- smoothed underground terrain height
  - Maintains subterranean actor list for collision checks
  - Smoothed terrain height for underground movement (cave floor contour)
  - 3D: actors on this layer have Y-offset below ground plane (negative Y)

#### 3.3.3 ElevatedBridgeLayer

- [ ] **TODO-9.C.3** `src/OpenRA.Mods.Common/Traits/World/ElevatedBridgeLayer.ts` (97 lines C#) -- Elevated bridge movement layer:
  - Implements `ICustomMovementLayer` from Ch4 Phase G
  - `index: number` -- layer index for pathfinding domain
  - `enabledForLocomotor(locomotor: LocomotorInfo): boolean` -- ground locomotor enabled
  - `entryCostForCell(cell: CPos): number` -- cost to enter bridge from ground
  - `getTerrainHeight(cell: CPos): number` -- bridge deck height
  - Reads bridge footprint cells from `ElevatedBridgePlaceholder` map actors
  - 3D: actors on bridge have Y-offset matching bridge deck height

#### 3.3.4 ElevatedBridgePlaceholder

- [ ] **TODO-9.C.4** `src/OpenRA.Mods.Common/Traits/World/ElevatedBridgePlaceholder.ts` (75 lines C#) -- Bridge footprint configuration:
  - `ElevatedBridgePlaceholderInfo` config class: `bridgeType: string`, `cells: CVec[]` (bridge footprint cells)
  - Map-level actor placed during map creation
  - Defines which cells are part of the elevated bridge
  - Provides bridge footprint to `ElevatedBridgeLayer` for movement passability
  - `cells: CVec[]` relative to the placeholder position
  - Used by map editor to designate bridge areas

#### 3.3.5 BridgeLayer

- [ ] **TODO-9.C.5** `src/OpenRA.Mods.Common/Traits/World/BridgeLayer.ts` (62 lines C#) -- Runtime bridge actor tracking:
  - `BridgeLayerInfo` config class: no config fields (marker trait)
  - Tracks bridge actors (the destructible bridge segments)
  - Maintains mapping of cell positions to bridge actors
  - `isBridgeBlocked(cell: CPos): boolean` -- check if bridge at cell is destroyed/blocked
  - `addBridge(bridge: Bridge)` -- register a bridge actor
  - `removeBridge(bridge: Bridge)` -- unregister a bridge actor
  - Used by `Locomotor` to determine if bridge cells are passable
  - Bridge destruction updates blocking state in `CellCache`

#### 3.3.6 LegacyBridgeLayer

- [ ] **TODO-9.C.6** `src/OpenRA.Mods.Common/Traits/World/LegacyBridgeLayer.ts` (123 lines C#) -- Template-based bridge generation:
  - `LegacyBridgeLayerInfo` config class: `bridges: LegacyBridge[]`
  - `LegacyBridge` config: `template: number`, `start: CPos`, `end: CPos` (orientation), `cells: CVec[]`
  - Generates bridge actors from tileset template at map load time
  - Template-based bridge definition (for maps that use tile templates instead of individual bridge actors)
  - Bridge footprint extracted from tileset bridge template
  - Bridges placed along specified orientation between start and end points
  - Registers generated bridges with `BridgeLayer` for runtime tracking
  - Integration with Ch4 `Map` for tile data access
  - Integration with Ch4 `TerrainInfo` for bridge tile identification

#### 3.3.7 TerrainTunnel

- [ ] **TODO-9.C.7** `src/OpenRA.Mods.Common/Traits/World/TerrainTunnel.ts` (63 lines C#) -- Tunnel footprint configuration:
  - `TerrainTunnelInfo` config class: `cells: CVec[]` (tunnel footprint cells), `name: string`
  - Map-level actor placed during map creation
  - Defines which cells are underground tunnel passages
  - Used by `TerrainTunnelLayer` for movement passability
  - Portal linking: tunnel entrance cells link to exit cells
  - 3D: tunnel cells have sub-surface Y-offset

#### 3.3.8 TerrainTunnelLayer

- [ ] **TODO-9.C.8** `src/OpenRA.Mods.Common/Traits/World/TerrainTunnelLayer.ts` (96 lines C#) -- Tunnel movement layer:
  - Implements `ICustomMovementLayer` from Ch4 Phase G
  - `index: number` -- layer index for pathfinding domain
  - `enabledForLocomotor(locomotor: LocomotorInfo): boolean` -- ground locomotor enabled
  - `entryCostForCell(cell: CPos): number` -- transition cost at tunnel entrance
  - `getTerrainHeight(cell: CPos): number` -- tunnel interior height (constant)
  - Reads tunnel footprint from `TerrainTunnel` map actors
  - Manages tunnel entrance -> exit portal linking
  - 3D: actors in tunnel have constant sub-surface Y-offset

#### 3.3.9 TunnelEntrance

- [ ] **TODO-9.C.9** `src/OpenRA.Mods.Common/Traits/TunnelEntrance.ts` (73 lines C#) -- Tunnel portal linking:
  - `TunnelEntranceInfo` config class: `tunnel: string` (tunnel name), `entrances: CVec[]` (entrance cells)
  - Links tunnel entrance cells to the tunnel layer portals
  - Provides staging points for entry/exit transitions
  - `entrances: Map<CPos, StagingPoint[]>` -- each entrance cell maps to exit staging points
  - `StagingPoint` class: `position: WPos`, `facing: WAngle`
  - Used by `EntersTunnels` trait for entry/exit positioning
  - Bidirectional: exit entrances also defined for tunnel return

#### 3.3.10 EntersTunnels

- [ ] **TODO-9.C.10** `src/OpenRA.Mods.Common/Traits/EntersTunnels.ts` (163 lines C#) -- Tunnel entry order handling:
  - `EntersTunnelsInfo` config class: `enterCursor: string`, `enterBlockedCursor: string`, `voice: string`
  - Implements `IIssueOrder` (Ch6 Phase A):
    - `issueOrder(world, target, targetCell, mi): Order | null` -- issue EnterTunnel order when clicking tunnel entrance
  - Implements `IResolveOrder` (Ch6 Phase A):
    - `resolveOrder(actor, order)` -- create EnterTunnel activity
  - Implements `IOrderVoice`: `voicePhraseForOrder(actor, order): string`
  - EnterTunnel order: unit moves to tunnel entrance cell, transitions to tunnel layer
  - Validates target is a tunnel entrance cell
  - Scheduling: unit queues enter action when reaching entrance
  - Integration with `TerrainTunnelLayer` for transition cost and staging positions

**Phase C Summary**: 10 files, ~900 C# lines source. All files are LOW to MEDIUM complexity. The main challenge is coordinating `ICustomMovementLayer` implementations with the pathfinding system (Ch4 Phase G) and ensuring consistent terrain height reporting. Estimated ~35 unit tests. Estimated ~2,000 TypeScript implementation lines.

---

### 3.4 Phase D: Movement-Related Support Traits

**Status**: PLANNING (0/13; 11 active + 2 deferred)
**Complexity**: LOW-MEDIUM + LOW (13 files, ~866 active lines + ~474 deferred lines)
**Blocked by**: Phase A (Mobile, Locomotor, IMove interface), Phase B (BodyOrientation for ClassicFacingBodyOrientation), Phase C (Bridge infrastructure for AutoCrusher bridge awareness)
**Blocks**: Chapter 10 (Harvester crushables), Chapter 19 (C&C-specific movement traits)

**Description**: Support traits that modify, react to, or enhance movement. `BlocksProjectiles` prevents projectiles from passing through a structure (wall blocking). `Crushable` makes infantry/light units crushable by tanks. `AutoCrusher` auto-crushes crushable units during idle movement scanning. `TransformCrusherOnCrush` triggers actor transformation on crush (e.g., ore truck becomes husk). `GrantConditionOnMovement` grants conditions during movement (e.g., "moving" condition for movement-specific behaviors). `Hovers` provides visual hover elevation animation. `TerrainModifiesDamage` applies terrain-based damage multipliers (e.g., infantry in cover take less damage). `SpeedMultiplier` modifies movement speed by percentage. `AttackMove` is upgraded from Ch8 Phase D stub to full implementation. `ClassicFacingBodyOrientation` and `JumpjetLocomotor` are C&C-specific movement traits. `PathFinderOverlay` and `HierarchicalPathFinderOverlay` are deferred debug visualizations.

**Paradigm Shifts**:
- C# `Hovers` offset lerp -> `TransformNode.position.y` oscillating sine wave via `scene.onBeforeRenderObservable`
- C# `Crushable` faction bitmask -> TypeScript `LongBitSet<PlayerBitMask>` (already in Ch4 Phase G)
- C# `AutoCrusher` idle scan -> Interval-based crush candidate scan during idle activity
- C# `TerrainModifiesDamage` terrain damage lookup -> `TerrainInfo` data access (Ch4 Phase C)
- C# `SpeedMultiplier` percent modifier -> `Mobile.currentMovementTypes` set modification
- C# `AttackMove` upgrade from stub -> Full implementation with scan radius and target acquisition
- C# `ClassicFacingBodyOrientation` C&C-specific -> Simple override of `BodyOrientation` with 8-direction quantization
- C# `JumpjetLocomotor` C&C-specific -> Extends `Locomotor` with jump-jet flight behavior (short hop distances)

#### 3.4.1 BlocksProjectiles

- [ ] **TODO-9.D.1** `src/OpenRA.Mods.Common/Traits/BlocksProjectiles.ts` (74 lines C#) -- Projectile blocking by structures/terrain:
  - `BlocksProjectilesInfo` config class: `height: WDist` (blocking height), `blockGroundProjectiles: boolean`, `blockAirProjectiles: boolean`
  - Implements `IBlocksProjectiles` interface
  - `blocks(projectile: IProjectile): boolean` -- check if this actor blocks the given projectile
  - `blockingHeight: WDist` -- projectile must travel below this height to be blocked
  - Ground/Air filtering: only block projectiles at matching altitude
  - 3D: line-of-sight from projectile source to target intersects blocking actor's bounding volume
  - Used by walls, buildings, terrain features
  - Integration with Ch8 Phase B projectile collision system

#### 3.4.2 Crushable

- [ ] **TODO-9.D.2** `src/OpenRA.Mods.Common/Traits/Crushable.ts` (97 lines C#) -- Crushability with faction-based masks:
  - `CrushableInfo` config class: `crushClasses: string[]` (types that can crush), `warnProbability: number` (chance to flee)
  - Implements `ICrushable` interface
  - `crushableBy(actor, crusher, crushClasses): boolean` -- check if crusher can crush this actor
  - `crushableByPlayerMask(actor, crushClasses): LongBitSet<PlayerBitMask>` -- player mask of who can crush
  - `isTraitDisabled: boolean` -- crusher can still crush even if Crushable trait is disabled
  - `notifyCrushed(crusher)` -- called when crushed; plays death sound, triggers death effects
  - Faction-aware crushing (allies don't crush each other unless explicitly configured)
  - `warnProbability`: chance infantry flees when tank approaches
  - Integration with Ch8 Phase D `IHealth` for insta-kill on crush
  - Used by infantry, light vehicles

#### 3.4.3 AutoCrusher

- [ ] **TODO-9.D.3** `src/OpenRA.Mods.Common/Traits/AutoCrusher.ts` (103 lines C#) -- Idle auto-crush scanning:
  - `AutoCrusherInfo` config class: `crushClasses: string[]`, `scanRadius: WDist`, `tickRate: number`
  - Implements `INotifyIdle`:
    - `tickIdle(actor)` -- scan for crushable actors, crush them if found
  - Periodic scan (every `tickRate` ticks) for crushable actors within `scanRadius`
  - Crush logic: move to crushable target cell, trigger crush
  - Path-aware: doesn't crush if path planning shows no valid path to target
  - Respects `ICrushable.crushableBy()` checks (faction, crush class matching)
  - Used by tanks to automatically crush infantry in their path
  - 3D: scan radius converted to world-space via CoordinateTransformer

#### 3.4.4 TransformCrusherOnCrush

- [ ] **TODO-9.D.4** `src/OpenRA.Mods.Common/Traits/TransformCrusherOnCrush.ts` (59 lines C#) -- Crush transformation trigger:
  - `TransformCrusherOnCrushInfo` config class: `intoActor: string`, `skipMakeAnims: boolean`, `faction: string`
  - Implements `INotifyCrushed`:
    - `onCrush(actor, crusher, crushClasses)` -- replaces crusher with transformed actor
    - `warnCrush(actor, crusher, crushClasses)` -- pre-crush warning
  - Transforms the crusher into a different actor on crush (e.g., Ore Truck -> Ore Husk)
  - Uses `ActorInfo` from ruleset to create replacement actor
  - `skipMakeAnims`: skip factory exit animation for transformed actor
  - Faction-specific transformation (GDI harvester vs Nod harvester)
  - Integration with Ch3 `GameWorldManager.createActor()`

#### 3.4.5 GrantConditionOnMovement

- [ ] **TODO-9.D.5** `src/OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnMovement.ts` (65 lines C#) -- Condition toggling on movement state:
  - `GrantConditionOnMovementInfo` config class: `condition: string`, `validMovementTypes: Set<string>`
  - Implements `INotifyMoving`:
    - `onNotifyMoving(actor)` -- grant condition when movement starts
  - Implements `INotifyFinishedMoving`:
    - `onNotifyFinishedMoving(actor)` -- revoke condition when movement stops
  - `validMovementTypes` filter: only trigger for specific movement types (e.g., "horizontal" but not "vertical")
  - Integration with Ch3 `ConditionManager` for reference-counted tokens
  - Used for "moving" state effects (dust trails, sound loops, animation changes)

#### 3.4.6 Hovers

- [ ] **TODO-9.D.6** `src/OpenRA.Mods.Common/Traits/Render/Hovers.ts` (121 lines C#) -- Visual hover elevation animation:
  - `HoversInfo` config class: `bobDistance: WDist`, `minHoveringAltitude: WDist`, `tick: number` (oscillation speed)
  - Implements `IRenderModifier`: modifies actor render position
  - Implements `ITick`: advances oscillation phase
  - Implements `ISync`: sync oscillation phase for deterministic network state
  - Sine-wave oscillation: `bobOffset = sin(phase) * bobDistance`
  - `minHoveringAltitude`: base elevation above ground
  - Phase increment per tick: `phase += 2 * PI * tick / ticksPerCycle`
  - 3D: applies `TransformNode.position.y` offset via `scene.onBeforeRenderObservable`
  - Visual only -- does not affect pathfinding or blocking
  - Used by hover tanks, drones, floating structures

#### 3.4.7 TerrainModifiesDamage

- [ ] **TODO-9.D.7** `src/OpenRA.Mods.Common/Traits/Infantry/TerrainModifiesDamage.ts` (60 lines C#) -- Terrain-based damage multiplier:
  - `TerrainModifiesDamageInfo` config class: `damageModifier: Map<string, number>` (terrain type -> damage multiplier)
  - Implements `IDamageModifier` (Ch8 Phase D):
    - `getDamageModifier(attacker, damageType): number` -- returns terrain-based multiplier
  - Looks up current cell's terrain type, returns configured multiplier
  - Example: "tiberium" terrain -> 2x damage, "rock" terrain -> 0.5x damage
  - Integration with Ch4 `Map` + `TerrainInfo` for cell terrain type lookup
  - Used by infantry for cover mechanics (prone in grass takes less damage)

#### 3.4.8 SpeedMultiplier

- [ ] **TODO-9.D.8** `src/OpenRA.Mods.Common/Traits/Multipliers/SpeedMultiplier.ts` (31 lines C#) -- Percent speed modifier:
  - `SpeedMultiplierInfo` config class: `modifier: number` (e.g., 1.5 = +50% speed)
  - Implements `ISpeedModifier`:
    - `getSpeedModifier(movementTypes: Set<string>): number` -- returns speed multiplier
  - Modifies all movement speed by multiplicative factor
  - Applied during Mobile's speed calculation
  - Stackable with terrain speed modifiers
  - Used for buffs/debuffs (veterancy speed bonus, crippled speed penalty)

#### 3.4.9 AttackMove (Upgrade from Stub)

- [ ] **TODO-9.D.9** `src/OpenRA.Mods.Common/Traits/AttackMove.ts` (179 lines C#) -- Upgrade from Ch8 Phase D stub to full implementation:
  - Full `AttackMoveInfo` config: `assaultMoveCondition: string`, `scanRadius: WDist`, `scanInterval: number`, `targetLineColor: Color`
  - Auto-acquires and attacks targets while moving to destination
  - Scan loop: every `scanInterval` ticks, search for targets within `scanRadius` from current path position
  - `assaultMoveCondition`: grants condition token when in assault-move mode
  - Attack priority: closest enemy first, then highest value
  - Movement interruption: attack target found -> stop movement -> engage -> resume movement after target destroyed
  - Integration with IMove for path-following state
  - Integration with AutoTarget for target acquisition
  - Integration with Armament for weapon range check
  - Order handling: "AttackMove" order from Ch6 Phase A `UnitOrders`
  - **Upgrade from stub**: The Ch8 Phase D version was a minimal stub (class skeleton only). This is the full implementation with scanning, interruption, and re-acquisition logic.

#### 3.4.10 ClassicFacingBodyOrientation (C&C-specific)

- [ ] **TODO-9.D.10** `src/OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientation.ts` (36 lines C#) -- C&C classic facing behavior:
  - `ClassicFacingBodyOrientationInfo` config class: `quantizedFacings: number` (fixed at 8 for classic C&C)
  - Extends/overrides `BodyOrientation` with 8-direction sprite quantization
  - Classic C&C used exactly 8 facings for all units
  - `quantizeFacing()` override: snap to 8 directions (N, NE, E, SE, S, SW, W, NW)
  - No rolling or pitching adjustments (2D game style)
  - 3D: `mesh.rotation.y` clamped to 8 discrete values with snapping behavior

#### 3.4.11 JumpjetLocomotor (C&C-specific)

- [ ] **TODO-9.D.11** `src/OpenRA.Mods.Cnc/Traits/World/JumpjetLocomotor.ts` (41 lines C#) -- Jump-jet infantry locomotor:
  - `JumpjetLocomotorInfo` config class: `jumpjetTransitionCost: number`
  - Extends `Locomotor` with jump-jet flight behavior
  - Jump-jet infantry can hop over obstacles and water
  - Short-hop distance limited by fuel/energy
  - Begins and ends on ground; mid-hop is airborne (ignores terrain passability)
  - Pathfinding integration: jump-jet domain in path cost
  - Used by C&C Rocket Infantry and Jump Jet Infantry
  - 3D: arc-shaped trajectory during hop (parabolic Y-offset)

#### 3.4.12 PathFinderOverlay (DEFERRED)

- [ ] **TODO-9.D.12** DEFERRED -- `src/OpenRA.Mods.Common/Traits/World/PathFinderOverlay.ts` (286 lines C#):
  - Developer debug visualization that renders pathfinding cell costs as colored overlay
  - Shows per-cell path costs, blocked cells, path nodes
  - Color gradient: green (low cost) -> yellow (medium) -> red (high/impassable)
  - Toggle on/off via developer hotkey
  - **Deferred to Developer Tools phase** (not needed for gameplay)
  - When implemented: create a semi-transparent plane mesh colored per-cell using `VertexData`

#### 3.4.13 HierarchicalPathFinderOverlay (DEFERRED)

- [ ] **TODO-9.D.13** DEFERRED -- `src/OpenRA.Mods.Common/Traits/World/HierarchicalPathFinderOverlay.ts` (188 lines C#):
  - Developer debug visualization for HPA\* cluster nodes and edges
  - Shows cluster boundaries, abstract graph edges, path-through-cluster visualization
  - Color: cluster entrances in blue, cluster centers in cyan, path edges in white
  - Toggle on/off via developer hotkey
  - **Deferred to Developer Tools phase** (not needed for gameplay)
  - When implemented: render wireframe boxes for clusters, colored lines for edges

**Phase D Summary**: 11 active + 2 deferred files, ~866 active + ~474 deferred C# lines. Most files are LOW complexity (30-120 lines). AttackMove (179 lines) is the main upgrade from Ch8 Phase D stub. The two C&C-specific files (ClassicFacingBodyOrientation, JumpjetLocomotor) are simple overrides. Estimated ~35 unit tests for active files. Estimated ~1,500 TypeScript implementation lines for active files.

---

**Chapter 9 Total**: 30 active files + 2 deferred. ~5,355 active C# source lines. Estimated ~175 unit tests. Estimated ~10,000 TypeScript implementation lines.

---

## 4. Dependency Graph

```
Chapters 2-8 (COMPLETE -- Foundation)
  |
  +--> Phase A (Core Movement Foundations: 4 files + 1 interface)
  |     |
  |     |   TraitsInterfaces.ts expansion (IMove + INotifyMoving + INotifyFinishedMoving + IWrapMove + INotifyCenterPositionChanged + INotifyBlockingMove)
  |     |     |
  |     |     +--> Immobile.ts (62 lines) -- implements IOccupySpace
  |     |     |
  |     |     +--> Locomotor.ts (expand 261->526) -- CellCache, blocking, terrain costs
  |     |           |
  |     |           +--> Mobile.ts (1079 lines) -- IMove, IPositionable, IFacing, ITick, orders
  |     |           |     |
  |     |           |     +--> Phase B (Aircraft -- second IMove implementation)
  |     |           |     +--> Phase B (BodyOrientation -- needs IFacing from Mobile/Aircraft)
  |     |           |     +--> Phase C (all Locomotor extensions)
  |     |           |     +--> Phase D (all movement-related support traits)
  |     |           |
  |     |           +--> PathFinder.ts (295 lines) -- wires Locomotor to HierarchicalPathFinder
  |     |
  |     +--> Phase B (QuantizeFacingsFromSequence -- needs SequenceProvider from Mobile context)
  |
  +--> Phase B (Aircraft & Air Movement: 4 files)
  |     |
  |     |   Aircraft.ts (1381 lines) -- second IMove implementation
  |     |     |
  |     |     +--> FallsToEarth.ts (71 lines) -- death behavior for aircraft
  |     |     +--> BodyOrientation.ts (127 lines) -- shared with Mobile
  |     |     +--> QuantizeFacingsFromSequence.ts (48 lines) -- shared with Mobile
  |     |
  |     +--> Phase D (ClassicFacingBodyOrientation -- extends BodyOrientation)
  |
  +--> Phase C (World Movement Infrastructure: 10 files)
  |     |
  |     |   SubterraneanLocomotor.ts (43 lines) -- extends Locomotor
  |     |   SubterraneanActorLayer.ts (105 lines) -- ICustomMovementLayer
  |     |
  |     |   ElevatedBridgePlaceholder.ts (75 lines) -- map config
  |     |     +--> ElevatedBridgeLayer.ts (97 lines) -- ICustomMovementLayer
  |     |
  |     |   BridgeLayer.ts (62 lines) -- bridge actor tracking
  |     |     +--> LegacyBridgeLayer.ts (123 lines) -- template bridge generation
  |     |
  |     |   TerrainTunnel.ts (63 lines) -- map config
  |     |     +--> TerrainTunnelLayer.ts (96 lines) -- ICustomMovementLayer
  |     |           +--> TunnelEntrance.ts (73 lines) -- portal linking
  |     |                 +--> EntersTunnels.ts (163 lines) -- order handling
  |     |
  |     +--> Phase D (AutoCrusher -- needs bridge/tunnel layer for crush path checks)
  |
  +--> Phase D (Movement-Related Support Traits: 13 files)
        |
        |   BlocksProjectiles.ts (74 lines) -- independent, needs IBlocksProjectiles
        |   Crushable.ts (97 lines) -- independent
        |   AutoCrusher.ts (103 lines) -- needs Crushable + Movement
        |   TransformCrusherOnCrush.ts (59 lines) -- needs INotifyCrushed
        |   GrantConditionOnMovement.ts (65 lines) -- needs INotifyMoving/INotifyFinishedMoving
        |   Hovers.ts (121 lines) -- independent render trait
        |   TerrainModifiesDamage.ts (60 lines) -- needs TerrainInfo + IDamageModifier
        |   SpeedMultiplier.ts (31 lines) -- independent
        |   AttackMove.ts (179 lines) -- upgrade from Ch8 Phase D stub
        |   ClassicFacingBodyOrientation.ts (36 lines) -- needs BodyOrientation
        |   JumpjetLocomotor.ts (41 lines) -- needs Locomotor
        |   PathFinderOverlay.ts (286 lines) -- DEFERRED
        |   HierarchicalPathFinderOverlay.ts (188 lines) -- DEFERRED
```

### Critical Path

```
TraitsInterfaces (IMove) -> Immobile -> Locomotor -> Mobile -> Aircraft -> BodyOrientation -> Phase C (Layers) -> Phase D (Support)
                                     \-> PathFinder
```

### Parallelization Opportunities

- **Phase A internal**: Immobile (62 lines) can be done in parallel with TraitsInterfaces expansion. Locomotor expansion and PathFinder can proceed in parallel once TraitsInterfaces is done. Mobile must wait for Locomotor.

- **Phase B vs Phase A**: BodyOrientation and QuantizeFacingsFromSequence can begin once IFacing interface is finalized from Phase A. Aircraft must wait for full Mobile as reference IMove implementation.

- **Phase C internal**: All 10 files can be parallel-assigned once Locomotor is complete. The layer files (SubterraneanActorLayer, ElevatedBridgeLayer, TerrainTunnelLayer) are independent of each other. Bridge infrastructure (ElevatedBridgePlaceholder, BridgeLayer, LegacyBridgeLayer) is independent of tunnel infrastructure. TunnelEntrance depends on TerrainTunnelLayer. EntersTunnels depends on TunnelEntrance.

- **Phase D internal**: All LOW complexity files (BlocksProjectiles, Crushable, GrantConditionOnMovement, TerrainModifiesDamage, SpeedMultiplier, ClassicFacingBodyOrientation, JumpjetLocomotor, TransformCrusherOnCrush) can be parallel-assigned. AttackMove upgrade waits for full Mobile. AutoCrusher waits for Crushable + Bridge infrastructure. Hovers waits for IRenderModifier pattern.

- **Phase C vs Phase D**: Phase D files that don't depend on Phase C (BlocksProjectiles, Crushable, GrantConditionOnMovement, Hovers, TerrainModifiesDamage, SpeedMultiplier, AttackMove, ClassicFacingBodyOrientation, JumpjetLocomotor, TransformCrusherOnCrush) can begin as soon as Phase A is done.

### Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| IMove interface (TraitsInterfaces) | Must be finalized before ANY IMove implementation (Mobile, Aircraft) |
| Locomotor (full) | Must be complete before Mobile (Mobile uses Locomotor for cell blocking) |
| Mobile | Must be complete before Aircraft (second IMove implementation references Mobile patterns) |
| Mobile + IFacing | Must be complete before BodyOrientation (needs IFacing trait on actor) |
| Locomotor | Must be complete before SubterraneanLocomotor and JumpjetLocomotor (extend it) |
| ICustomMovementLayer (Ch4 Phase G) | Must exist before all *Layer files (SubterraneanActorLayer, ElevatedBridgeLayer, TerrainTunnelLayer) |
| Bridge infrastructure | Must be complete before AutoCrusher (bridge-awareness for crush paths) |
| BodyOrientation | Must be complete before ClassicFacingBodyOrientation (extends/overrides it) |
| AttackMove stub (Ch8 Phase D) | Must exist before AttackMove upgrade |
| TerrainTunnelLayer | Must be complete before TunnelEntrance (portal index reference) |
| TunnelEntrance | Must be complete before EntersTunnels (staging point lookup) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns per phase:

- [ ] **TEST-9.1** IMove interface: verify Mobile and Aircraft both satisfy the full IMove contract (TypeScript structural typing)
- [ ] **TEST-9.2** Immobile: `centerPosition` calculated correctly from actor TopLeft cell; `occupiedCells()` returns correct cells for single-cell building
- [ ] **TEST-9.3** Locomotor: `CanStayInCell()` returns true for passable cell, false for blocked cell with correct `CellFlag` mask
- [ ] **TEST-9.4** Locomotor: `GetAvailableSubCell()` finds correct sub-cell when primary is occupied; falls back to next available SubCell
- [ ] **TEST-9.5** Locomotor: `UpdateCellBlocking()` correctly sets `HasMovingActor`, `HasBlockingActor`, `HasTemporaryBlocker` flags; dirty cell set updated
- [ ] **TEST-9.6** Locomotor: `IsBlockedBy()` correctly identifies blocking relationship between two actors with SubCell precision
- [ ] **TEST-9.7** Mobile: `centerPosition` matches expected WPos from CPos + MapGrid conversion; changes after `setCenterPosition()`
- [ ] **TEST-9.8** Mobile: `canEnterCell()` delegates to Locomotor; returns false for blocked cell, true for passable cell
- [ ] **TEST-9.9** Mobile: `moveTo()` returns Activity stub (not thrown); factories for all 6 move methods return non-null stubs
- [ ] **TEST-9.10** Mobile: `estimatedMoveDuration()` calculates correctly -- distance / (speed * terrainModifier) in ticks
- [ ] **TEST-9.11** Mobile: `nearestMoveableCell()` finds nearest passable cell to blocked position
- [ ] **TEST-9.12** Mobile: `rotateToFacing()` advances `facing` toward `desiredFacing` by `turnSpeed` per call; never overshoots
- [ ] **TEST-9.13** Mobile: `tick()` advances centerPosition along current path at correct speed; respects terrain speed multiplier
- [ ] **TEST-9.14** Mobile: `resolveOrder("Move")` creates correct Move activity; `resolveOrder("Stop")` cancels current activity
- [ ] **TEST-9.15** Mobile: `isTraitPaused` true when NotMobile condition active; `isImmovable` true when Paused or Stunned
- [ ] **TEST-9.16** PathFinder: `findPathToTarget()` returns valid path of CPos[] between source and reachable target
- [ ] **TEST-9.17** PathFinder: `findPathToTarget()` returns null for unreachable target (blocked by terrain)
- [ ] **TEST-9.18** PathFinder: multi-source pathfinding picks the source that yields the lowest-cost path
- [ ] **TEST-9.19** Aircraft: `centerPosition` correctly includes `altitude` as Y-coordinate via WPos
- [ ] **TEST-9.20** Aircraft: `canLand()` returns true for unreserved landable cell, false for reserved or non-landable cell
- [ ] **TEST-9.21** Aircraft: `reserveCell()` marks cell as reserved; `unreserveCell()` releases; two aircraft cannot reserve same cell
- [ ] **TEST-9.22** Aircraft: `Fly()` advances position toward target at correct speed; altitude transitions through landing steps
- [ ] **TEST-9.23** Aircraft: `repulse()` pushes aircraft apart when within `repulsionRadius`; force proportional to proximity
- [ ] **TEST-9.24** FallsToEarth: fall sequence decrements altitude by `velocity` per tick; triggers explosion on ground contact
- [ ] **TEST-9.25** BodyOrientation: `quantizeFacing()` maps continuous WAngle to correct discrete facing index for 8/16/32 facings
- [ ] **TEST-9.26** BodyOrientation: `worldToLocal()` / `localToWorld()` round-trip correctly (localToWorld(worldToLocal(v)) == v)
- [ ] **TEST-9.27** QuantizeFacingsFromSequence: auto-detects 8 facings from standard sequence, 32 facings from high-res sequence
- [ ] **TEST-9.28** SubterraneanActorLayer: `getTerrainHeight()` returns sub-surface Y offset; `entryCostForCell()` returns non-zero transition cost
- [ ] **TEST-9.29** ElevatedBridgeLayer: `getTerrainHeight()` returns bridge deck Y offset; only enabled for ground locomotor
- [ ] **TEST-9.30** LegacyBridgeLayer: generates correct number of bridge actors for template bridge between start and end positions
- [ ] **TEST-9.31** TerrainTunnelLayer: portal linking -- entrance cell maps to correct exit cell via `TunnelEntrance` staging points
- [ ] **TEST-9.32** EntersTunnels: `issueOrder()` returns EnterTunnel order for valid tunnel entrance; null for non-tunnel cell
- [ ] **TEST-9.33** BlocksProjectiles: `blocks()` returns true when projectile height < blocking height; false when projectile flies over
- [ ] **TEST-9.34** Crushable: `crushableBy()` respects faction masks -- allied crusher returns false unless explicit allow
- [ ] **TEST-9.35** AutoCrusher: `tickIdle()` detects crushable unit within scan radius, does not detect unit outside radius
- [ ] **TEST-9.36** TransformCrusherOnCrush: `onCrush()` transforms crusher into specified `intoActor` actor type
- [ ] **TEST-9.37** GrantConditionOnMovement: grants condition on movement start, revokes on movement stop
- [ ] **TEST-9.38** Hovers: oscillation phase advances correctly; `bobOffset` follows sine wave at correct period
- [ ] **TEST-9.39** TerrainModifiesDamage: returns correct damage modifier for current terrain type; 1.0 for unknown terrain
- [ ] **TEST-9.40** SpeedMultiplier: `getSpeedModifier()` returns correct multiplier; stacked correctly with terrain speed
- [ ] **TEST-9.41** AttackMove: scan loop acquires target within `scanRadius`; interrupts movement when target found; resumes when target destroyed
- [ ] **TEST-9.42** ClassicFacingBodyOrientation: quantizes to exactly 8 facings regardless of sequence count
- [ ] **TEST-9.43** JumpjetLocomotor: hop trajectory passes through cells that are ground-impassable (water, cliffs)

### 5.2 Per-Phase Test File Estimates

| Phase | Files | Test Files | Estimated Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Core Movement | 5 (4 + interface) | 5 | ~65 | ~5,000 |
| B: Aircraft & Air | 4 | 4 | ~45 | ~3,500 |
| C: World Infrastructure | 10 | 8 | ~35 | ~2,500 |
| D: Support Traits | 11 active | 10 | ~35 | ~2,000 |
| **Total (active)** | **30** | **27** | **~180** | **~13,000** |

### 5.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Basic unit movement | `/test/movement/basic-movement/` | Verify unit moves along path, rotates toward facing, stops at destination |
| Pathfinding visual | `/test/movement/path-visual/` | Verify pathfinding A\* returns correct path around obstacles |
| Crushing mechanic | `/test/movement/crushing/` | Verify tank crushes infantry on contact, infantry flees when warned |
| Aircraft flight | `/test/movement/fly-land/` | Verify aircraft takeoff, cruise at altitude, landing sequence |
| Aircraft repulsion | `/test/movement/repulsion/` | Verify aircraft push apart when too close |
| Hover visual | `/test/movement/visual-bob/` | Verify hover oscillation sine wave visual effect |
| Blocking cache | `/test/movement/blocking-cache/` | Verify cell blocking updates correctly as units move through cells |
| Tunnel entry | `/test/movement/tunnel/` | Verify unit enters tunnel, transitions to underground layer, exits at other portal |
| Bridge crossing | `/test/movement/bridge/` | Verify unit crosses elevated bridge, blocked when bridge destroyed |
| Integrated movement | `/test/movement/integrated/` | Full stack: Locomotor -> HierarchicalPathFinder -> PathFinder -> Mobile pathfinding and execution |

### 5.4 Integration Testing

- [ ] **TEST-9.I1** Full movement integration: spawn actor at map start, issue Move order to target cell, verify actor follows path via HPA\* -> A\* -> path execution through Mobile.tick(), arrives at target cell within expected tick count
- [ ] **TEST-9.I2** Multi-actor movement: 10 actors moving simultaneously through narrow corridor; verify no collisions, correct sub-cell occupancy, blocking state updates correctly
- [ ] **TEST-9.I3** Aircraft + ground interaction: aircraft lands on ground cell; ground unit cannot occupy landing cell during reservation
- [ ] **TEST-9.I4** Terrain speed: actor moving through different terrain types (road, rough, water-border) experiences correct speed changes (road = fast, rough = slow, water = blocked)
- [ ] **TEST-9.I5** Crush chain: tank moves toward infantry; infantry crushes; tank transforms via TransformCrusherOnCrush; crusher's new actor type verified
- [ ] **TEST-9.I6** Tunnel traversal: unit enters tunnel at entrance A, pathfinds through tunnel layer, exits at entrance B; total travel distance matches expected
- [ ] **TEST-9.I7** Bridge destruction: unit on bridge when bridge destroyed; blocked path, unit re-pathfinds around

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Mobile (1079 lines) -- largest single trait** | HIGHEST | Any bug in the most-used trait breaks all ground unit movement | Line-for-line port of `Mobile.cs`; validate each method against C# reference with identical input; run full movement integration test after each method group |
| **Aircraft (1381 lines) -- complex altitude state machine** | HIGH | Broken landing/reservation causes aircraft to get stuck or overlap | Port altitude state machine line-for-line; validate all 4 states (TakeOff, Cruising, Landing, Landed); test with multiple aircraft simultaneously |
| **Locomotor CellCache blocking parity** | MEDIUM | Wrong blocking state causes units to path through each other or get stuck | Validate CellFlag bitmask transitions at every cell-state change; test with 2 actors crossing same cell at same tick |
| **Mobile.VisualPosition interpolation stutter** | MEDIUM | Visual position jitter or lag causes poor player experience | Decouple visual lerp from tick rate; use `scene.onBeforeRenderObservable` with delta-time factor; validate smooth motion at 30/60/144 fps |
| **Aircraft repulsion oscillation** | MEDIUM | Air units oscillate or push through each other due to repulsion force instability | Use damped spring model (not pure vector push); cap repulsion per-frame offset; validate 3+ aircraft stable formation |
| **PathFinder multi-source path race conditions** | LOW | Multiple actors requesting paths simultaneously on same tick may cause contention | PathFinder runs synchronously per-tick (no async); all path requests complete before next actor's tick |
| **Terrain speed modifier stacking with SpeedMultiplier** | LOW | Incorrect stacking order produces wrong final speed | Document multiplication order: baseSpeed * terrainModifier * speedMultiplier; verify with known test values |
| **SubCell precision mismatch in 3D** | LOW | SubCell offsets don't translate correctly to Babylon.js TransformNode positions | Use CoordinateTransformer for SubCell -> world-space offset; validate SubCell positions match C# grid positions |
| **LegacyBridgeLayer template generation** | LOW | Bridge templates don't match C# bridge positions, units fall through map | Validate bridge cell footprint matches C# for known template IDs; test on standard RA/TD maps |
| **Tunnel portal linking** | LOW | Entrance/exit portal mismatch causes units to exit at wrong tunnel | Validate bidirectional portal map; test entry A -> exit B and entry B -> exit A produce correct staging points |
| **AttackMove upgrade complexity** | LOW | Upgrade from stub introduces new scan logic not present in stub | Keep upgrade scope limited to 179-line C# equivalent; defer scan optimization to performance phase |
| **Deferred overlays (474 lines) -- future complexity** | LOW | When un-deferred, overlay rendering requires new Babylon.js debug mesh infrastructure | Document overlay requirements now; tag in code with `TODO-9.D.12` and `TODO-9.D.13` for future Developer Tools phase |

### 6.1 Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Mobile.tick() per actor | < 0.1ms | 1000 units at 25fps = 40ms budget for all gameplay logic including movement |
| Locomotor.UpdateCellBlocking() per cell | < 0.05ms | Blocking updated every tick for dirty cells only; ~50 dirty cells typical |
| PathFinder.findPath() per request | < 2ms | Pathfinding runs on HPA\* (fast approximate) then A\* refinement; 50 simultaneous path requests = 100ms budget |
| Aircraft.repulse() per actor | < 0.05ms | Repulsion checks distance to N nearest aircraft (N <= 10); O(N) per aircraft |
| Visual interpolation per actor | < 0.01ms | Simple vector lerp; trivial GPU cost |
| CellCache dirty set batch size | < 100 cells/tick | Only cells with actual blocking changes; lazy batch at frame end |

### 6.2 Deferred Features

| Feature | Files | Lines | Reason for Deferral |
|:---|:---|:---:|:---|
| PathFinder overlay | PathFinderOverlay.ts | 286 | Developer debug tool; not needed for gameplay. Requires semi-transparent mesh rendering system. |
| HierarchicalPathFinder overlay | HierarchicalPathFinderOverlay.ts | 188 | Developer debug tool; not needed for gameplay. Requires HPA\* cluster visualization (wireframe boxes). |
| Movement Activities | Move/MoveAdjacentTo/MoveOnto/MoveWithinRange/MoveToDock | ~1,200 (Ch14) | Activity implementations belong in Chapter 14 Phase A. Chapter 9 provides factory methods returning stubs. |
| ReturnToCellActivity | Inside Mobile.ts | ~80 (Ch14) | Activity implementation deferred to Chapter 14. Mobile provides factory stub. |
| LeaveProductionActivity | Inside Mobile.ts | ~60 (Ch11) | Production-related activity deferred to Chapter 11 (Production & Building). |
| MoveOrderTargeter (orders) | Inside Mobile.ts / Aircraft.ts | ~120 (Ch15) | Order generator implementations deferred to Chapter 15 (Order Generators). |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-9.1: TransformNode.position as Position Ground Truth

- **Decision**: `Mobile.CenterPosition` and `Aircraft.CenterPosition` directly control `TransformNode.position` each game tick. `SetCenterPosition()` directly writes to `TransformNode.position` without intermediate state. Visual interpolation reads from `TransformNode.position` and applies frame-rate-independent smoothing via a separate `visualPosition` offset in `scene.onBeforeRenderObservable`.
- **Rationale**: Eliminates dual position tracking (game-logic position + render position) which was a source of drift bugs in early prototypes. The 25fps simulation tick is the authoritative update; rendering at variable framerate smoothly interpolates between ticks. This matches the paradigm of other 3D game engines (Unity, Unreal) where the Transform is authoritative.
- **Mitigation**: `visualPosition` lerp factor = `min(1, deltaTime * interpolationSpeed)`. Interpolation disabled during teleport (SetCenterPosition with >1 cell distance).

### ADR-9.2: IMove as Central Movement Interface

- **Decision**: `IMove` is the central movement interface. Both `Mobile` and `Aircraft` implement it. All movement-related traits interact with actors through `IMove` without knowing concrete type.
- **Rationale**: OpenRA's `IMove` is used by dozens of traits (AutoTarget, Harvester, AttackBase, etc.) to interact with movable actors. A single interface provides compile-time safety and enables trait composition. This replaces the current duck-typing pattern in TraitsInterfaces.ts where movement methods are resolved at runtime.
- **Mitigation**: `IMove` is fully defined in `TraitsInterfaces.ts` before any implementation. Activity factory methods return stubs until Chapter 14. Traits that need `IMove` use `actor.trait<IMove>("Mobile")` or `actor.trait<IMove>("Aircraft")` via the existing TraitDictionary.

### ADR-9.3: Locomotor Upgrade Strategy

- **Decision**: The existing 261-line Locomotor stub from Ch4 Phase G is upgraded in-place to the full 526-line implementation. The existing `SimpleLocomotor` and `WallAwareLocomotor` from Ch4 Phase G tests become test-only mocks. Production code uses the real Locomotor exclusively.
- **Rationale**: The Ch4 Phase G stub provided enough interface for pathfinding to work (terrain cost functions, passability checks). The full Locomotor adds cell blocking (`CellCache`, `CellFlag`, dirty cell tracking) and multi-actor occupancy management. Upgrading in-place avoids duplicate implementations and ensures all existing pathfinding tests continue to pass.
- **Mitigation**: All Ch4 Phase G tests continue to pass with the upgraded Locomotor. New tests validate the additional blocking functionality. Test-only mocks are clearly labeled with `@testOnly` JSDoc tags.

### ADR-9.4: Movement Activities Deferred to Chapter 14

- **Decision**: Chapter 9 provides `IMove` factory methods (`moveTo`, `moveWithinRange`, `moveFollow`, etc.) that return `Activity` stubs. The actual `Activity` subclasses (`Move`, `MoveAdjacentTo`, `MoveOnto`, `MoveWithinRange`, `MoveToDock`) are deferred to Chapter 14 Phase A.
- **Rationale**: Movement activities are complex state machines (200-400 lines each) that orchestrate pathfinding, movement along paths, facing rotation, and interruption handling. Implementing them in Chapter 9 would delay the core movement trait layer. Chapter 14 is specifically designated for Activity implementations and can implement them with the full `IMove` foundation. The factory method pattern in Chapter 9 provides the correct interface for early integration testing.
- **Mitigation**: Activity stubs implement the `Activity` base class interface (from Ch3 Phase F) with a `cancel()` method and a `tick()` that immediately completes. This allows `orderManager.resolveOrder()` to work with stub activities during Phase A-D development. Integration tests can verify that the correct stub type is returned for each factory method.

### ADR-9.5: PathFinder Overlay Deferral

- **Decision**: `PathFinderOverlay` (286 lines) and `HierarchicalPathFinderOverlay` (188 lines) are deferred to a future Developer Tools phase. These are pure debug visualizations that render pathfinding state and have no impact on gameplay.
- **Rationale**: These files require a dedicated debug overlay rendering system (semi-transparent colored cells, wireframe boxes, colored lines) that is not needed for any gameplay feature. Implementing them now would add rendering complexity with no player-visible benefit. Developer tools can be added as a dedicated phase when all gameplay chapters are complete.
- **Mitigation**: TODO markers `TODO-9.D.12` and `TODO-9.D.13` in the codebase. The debug overlay infrastructure can be designed independently when the Developer Tools phase begins.

---

## Migration Order and Phasing Strategy

| Step | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A (interface) | 1 | TraitsInterfaces.ts IMove expansion | NO (blocks everything) |
| 2 | Phase A (Immobile) | 1 | Immobile.ts (62 lines) | YES (with step 1) |
| 3 | Phase A (Locomotor) | 1 | Locomotor.ts upgrade (261 -> 526) | After step 1 |
| 4 | Phase A (PathFinder) | 1 | PathFinder.ts (295 lines) | YES (with step 3) |
| 5 | Phase A (Mobile) | 1 | Mobile.ts (1079 lines) | After steps 3, 4 |
| 6 | Phase B (aircraft core) | 1 | Aircraft.ts (1381 lines) | After step 5 |
| 7 | Phase B (air support) | 3 | FallsToEarth, BodyOrientation, QuantizeFacingsFromSequence | YES (with step 6) |
| 8 | Phase C (all layers) | 10 | All world infrastructure | YES (most independent after step 3) |
| 9 | Phase D (all support) | 11 active | All support traits | YES (most independent after steps 5-7) |

**Estimated Total**: ~4-5 weeks (single developer, sequential). Can be compressed to ~2 weeks with parallel assignment of LOW complexity files.

---

> **Chapter 9 milestone**: The first spatial simulation chapter. When complete, actors will navigate the game world with full pathfinding, terrain-aware movement, altitude-managed flight, cell blocking, and crush mechanics. This chapter provides the `IMove` foundation on which Harvester movement (Ch10), Production unit exit (Ch11), MoveIntoShroud (Ch12), Paradrops (Ch13), and Movement Activities (Ch14) all depend.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.2 -- Chapter 9 outline and key paradigm shifts
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Chapter 8 plan (format reference)
> - `docs/actor_system_migration_plan.md` -- Chapter 3 plan (IMove interface references)
> - `docs/map_system_migration_plan.md` -- Chapter 4 plan (pathfinding, CellLayer, ICustomMovementLayer)
> - `docs/network_sync_migration_plan.md` -- Chapter 6 plan (Order system)
> - `docs/input_camera_audio_effects_migration_plan.md` -- Chapter 7 plan (Turreted, Sound)
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
