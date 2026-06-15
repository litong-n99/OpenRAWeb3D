# OpenRA to Babylon.js Migration Plan: Chapter 14 -- Activity Implementations

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits) + `docs/chapter14_activity_implementations_analysis.md`
> **Chapter Status**: Phase A COMPLETE (11/11 files migrated, 82 tests, 3 acceptance test pages R2 APPROVED); Phases B-F PLANNING (0/38 migrated)
> **Planning Date**: 2026-06-15
> **Last Updated**: 2026-06-15
> **Prerequisite**: Chapters 2-13 COMPLETE (341/341 core files, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Movement Activities](#31-phase-a-movement-activities)
   - 3.2 [Phase B: Combat Activities](#32-phase-b-combat-activities)
   - 3.3 [Phase C: Aircraft Activities](#33-phase-c-aircraft-activities)
   - 3.4 [Phase D: Economic Activities](#34-phase-d-economic-activities)
   - 3.5 [Phase E: Transport & Enter Activities](#35-phase-e-transport--enter-activities)
   - 3.6 [Phase F: Utility & Miscellaneous](#36-phase-f-utility--miscellaneous)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's concrete Activity implementations shifts from **C# coroutine-like state machines driven by `Activity.Tick(Actor)`** to **TypeScript activity classes extending the already-migrated `Activity` base** (`src/OpenRA.Game/Activities/Activity.ts`). The base state machine (`Queued → Active → Done`, child/next queues, cancellation, `OnFirstRun`/`OnLastRun`) is already implemented in Chapter 3 Phase F. Chapter 14 focuses on gameplay-specific behavior: path following, aircraft flight, combat orchestration, harvesting, docking, cargo transport, and actor lifecycle management.

The core paradigm shifts:

- **2D grid movement logic** (C# `Move` with `CPos` path and WPos interpolation) -> **Reuse Chapter 9 `Mobile` trait**; activities decide *which cell to move to*, `Mobile` handles position authority; Babylon.js `TransformNode.position` is updated only for visual interpolation in `scene.onBeforeRenderObservable`
- **Aircraft flight physics** (C# `Fly` with WAngle facing/roll/pitch and altitude clamps) -> **Reuse Chapter 9 `Aircraft` trait**; activities call `Aircraft.setPosition()` / `flyStep()` helpers; 3D world-space altitude maps to Y axis via `CoordinateTransformer`
- **2D sprite target lines** (C# `TargetLineNode` with `Sprite` tiles) -> **Babylon.js `LinesMesh` in world space** at terrain height + small Y offset, depth-tested and camera-stable
- **Combat activity orchestration** (C# `Attack` coordinates `Armament`/`AttackBase`) -> **TypeScript `Attack` reuses Chapter 8 combat traits**; range checks remain on XZ plane; facing via `WAngle`
- **Enter pattern state machine** (C# abstract `Enter` with Approaching/Entering/Exiting/Finished) -> **TypeScript string-union state machine** reused by `CaptureActor`, `Demolish`, `RepairBridge`, `InstantRepair`, `DonateCash`, `DonateExperience`, `RideTransport`
- **World mutation side effects** (actor creation/removal/transform in `Tick`) -> **Deferred via `world.frameEndActions`** to prevent mid-tick state mutation

### 1.2 Architecture Principles

1. **Activity base is frozen**: Chapter 14 concrete activities extend `src/OpenRA.Game/Activities/Activity.ts` without modifying it. The base already matches OpenRA's `Activity.cs` contract.

2. **Grid authority, 3D visualization**: All movement and positioning logic operates on `CPos`/`WPos`. The `TransformNode.position` is purely visual and interpolated between tick positions.

3. **Trait delegation**: Activities do not implement physics directly. `Move` delegates to `Mobile`; `Fly` delegates to `Aircraft`; `Attack` delegates to `Armament`/`AttackBase`; harvesting delegates to `Harvester`/`ResourceLayer`.

4. **Deferred world mutations**: Any activity that creates, removes, or transforms actors queues the action via `world.frameEndActions` (mirroring OpenRA's `World.AddFrameEndTask`).

5. **Child/next activity composition**: Complex sequences (`Resupply`, `FindAndDeliverResources`, `Enter`) are built by queuing child activities rather than large monolithic state machines.

6. **Cancellation cleanup**: Every activity must return the actor to a consistent state before returning `true` when canceling. This matches OpenRA's requirement and ensures network sync.

7. **No per-frame allocation**: Hot paths (`Move.Tick`, `Fly.Tick`) must reuse objects (`WPos`, `WVec`, arrays). No `new` allocations inside per-tick loops.

8. **File headers required**: Every migrated `.ts` file must have a header with OpenRA file reference and paradigm mapping notes.

9. **Nested classes as separate logical units**: Several C# files contain nested classes (`MovePart`/`MoveFirstHalf`/`MoveSecondHalf`, `FlyAttackRun`/`StrafeAttackRun`, `IssueOrderAfterTransform`, `DeployInner`, `ReleaseUnit`, `AttachUnit`, `WaitFor`). These are migrated as private helper classes within the same file.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-13 is available for Chapter 14:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, `Scene`, `Mesh`, `LinesMesh` |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, `Util` |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, `TraitDictionary` |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IResolveOrder`, `Target`, `IActivityInterface` |
| Activity base class | Ch3 Phase F | `Activity`, `ActivityState`, `TargetLineNode`, `CallFunc` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `CellLayer`, `DensePathGraph`, `HierarchicalPathFinder`, `CPos`, `WPos`, `WVec`, `WDist`, `WAngle` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist-to-world-space |
| WorldInteractionControllerWidget | Ch5 Phase E | `OrderGenerator`, click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager`, `IResolveOrder` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` |
| Effects + Projectiles | Ch7 Phases E-F, Ch8 | `SpriteEffect`, `Bullet`, `NukeLaunch`, all projectiles |
| Weapons & Combat | Ch8 | `Armament`, `AttackBase`, `AutoTarget`, `HitShape`, `Warhead`, `WeaponInfo` |
| Movement & Physics | Ch9 | `Mobile`, `Aircraft`, `Fly` trait helpers, `Locomotor`, `Cargo`, `ParaDrop`, `BlockedByActor` |
| Resource & Economy | Ch10 | `Harvester`, `ResourceLayer`, `PlayerResources`, `ResourceClaimLayer`, `DockClientManager` |
| Production & Building | Ch11 | `Production`, `ProductionQueue`, `Building`, `Exit`, `RallyPoint`, `Cargo`, `Passenger`, `Carryall`, `Carryable` |
| Shroud & Fog of War | Ch12 | `Shroud`, `FrozenActorLayer`, `RevealsShroud` |
| Support Powers | Ch13 | `SupportPower`, `SupportPowerManager`, `AirstrikePower`, `NukePower`, `ParatroopersPower` |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (49 concrete + 2 already-migrated base files)

| # | OpenRA Source | Target TypeScript File | Class | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Movement Activities** | | | | | |
| 1 | `OpenRA.Mods.Common/Activities/Move/Move.cs` | `src/OpenRA.Mods.Common/Activities/Move/Move.ts` | `Move` (+ nested `MovePart`, `MoveFirstHalf`, `MoveSecondHalf`) | 640 | HIGHEST | A ✅ COMPLETE |
| 2 | `OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.ts` | `MoveAdjacentTo` | 159 | MEDIUM | A ✅ COMPLETE |
| 3 | `OpenRA.Mods.Common/Activities/Move/MoveOnto.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveOnto.ts` | `MoveOnto` | 60 | LOW | A ✅ COMPLETE |
| 4 | `OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.ts` | `MoveOntoAndTurn` | 43 | LOW | A ✅ COMPLETE |
| 5 | `OpenRA.Mods.Common/Activities/Move/MoveWithinRange.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveWithinRange.ts` | `MoveWithinRange` | 78 | MEDIUM | A ✅ COMPLETE |
| 6 | `OpenRA.Mods.Common/Activities/Move/Drag.cs` | `src/OpenRA.Mods.Common/Activities/Move/Drag.ts` | `Drag` | 73 | LOW | A ✅ COMPLETE |
| 7 | `OpenRA.Mods.Common/Activities/Move/Nudge.cs` | `src/OpenRA.Mods.Common/Activities/Move/Nudge.ts` | `Nudge` | 64 | LOW | A ✅ COMPLETE |
| 8 | `OpenRA.Mods.Common/Activities/Move/Follow.cs` | `src/OpenRA.Mods.Common/Activities/Move/Follow.ts` | `Follow` | 89 | MEDIUM | A ✅ COMPLETE |
| 9 | `OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.cs` | `src/OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.ts` | `LocalMoveIntoTarget` | 89 | LOW | A ✅ COMPLETE |
| 10 | `OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.cs` | `src/OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.ts` | `AttackMoveActivity` | 108 | MEDIUM | A ✅ COMPLETE |
| 11 | `OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.ts` | `MoveCooldownHelper` | 100 | LOW | A ✅ COMPLETE |
| -- | `OpenRA.Game/Activities/CallFunc.cs` | `src/OpenRA.Game/Activities/CallFunc.ts` | `CallFunc` | 33 | LOW | A ✅ ALREADY MIGRATED |

| **Phase B: Combat Activities** | | | | | |
| 12 | `OpenRA.Mods.Common/Activities/Attack.cs` | `src/OpenRA.Mods.Common/Activities/Attack.ts` | `Attack` | 283 | HIGH | B |
| 13 | `OpenRA.Mods.Common/Activities/Hunt.cs` | `src/OpenRA.Mods.Common/Activities/Hunt.ts` | `Hunt` | 49 | LOW | B |
| 14 | `OpenRA.Mods.Common/Activities/CaptureActor.cs` | `src/OpenRA.Mods.Common/Activities/CaptureActor.ts` | `CaptureActor` | 158 | MEDIUM | B |
| 15 | `OpenRA.Mods.Common/Activities/Demolish.cs` | `src/OpenRA.Mods.Common/Activities/Demolish.ts` | `Demolish` | 89 | LOW | B |
| 16 | `OpenRA.Mods.Common/Activities/Turn.cs` | `src/OpenRA.Mods.Common/Activities/Turn.ts` | `Turn` | 47 | LOW | B |

| **Phase C: Aircraft Activities** | | | | | |
| 17 | `OpenRA.Mods.Common/Activities/Air/Fly.cs` | `src/OpenRA.Mods.Common/Activities/Air/Fly.ts` | `Fly` (+ static `FlyTick`, `VerticalTakeOffOrLandTick`) | 283 | HIGH | C |
| 18 | `OpenRA.Mods.Common/Activities/Air/FlyAttack.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.ts` | `FlyAttack` (+ nested `FlyAttackRun`, `StrafeAttackRun`) | 316 | HIGH | C |
| 19 | `OpenRA.Mods.Common/Activities/Air/FlyFollow.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.ts` | `FlyFollow` | 99 | MEDIUM | C |
| 20 | `OpenRA.Mods.Common/Activities/Air/FlyForward.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyForward.ts` | `FlyForward` | 64 | LOW | C |
| 21 | `OpenRA.Mods.Common/Activities/Air/FlyIdle.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.ts` | `FlyIdle` | 66 | LOW | C |
| 22 | `OpenRA.Mods.Common/Activities/Air/FlyOffMap.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.ts` | `FlyOffMap` | 70 | LOW | C |
| 23 | `OpenRA.Mods.Common/Activities/Air/Land.cs` | `src/OpenRA.Mods.Common/Activities/Air/Land.ts` | `Land` | 276 | HIGH | C |
| 24 | `OpenRA.Mods.Common/Activities/Air/TakeOff.cs` | `src/OpenRA.Mods.Common/Activities/Air/TakeOff.ts` | `TakeOff` | 73 | LOW | C |
| 25 | `OpenRA.Mods.Common/Activities/Air/ReturnToBase.cs` | `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.ts` | `ReturnToBase` | 140 | MEDIUM | C |
| 26 | `OpenRA.Mods.Common/Activities/Air/FallToEarth.cs` | `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.ts` | `FallToEarth` | 64 | LOW | C |
| 27 | `OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.cs` | `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.ts` | `DeliverBulkOrder` | 118 | MEDIUM | C |
| 28 | `OpenRA.Mods.Common/Activities/Parachute.cs` | `src/OpenRA.Mods.Common/Activities/Parachute.ts` | `Parachute` | 58 | LOW | C |

| **Phase D: Economic Activities** | | | | | |
| 29 | `OpenRA.Mods.Common/Activities/HarvestResource.cs` | `src/OpenRA.Mods.Common/Activities/HarvestResource.ts` | `HarvestResource` | 124 | MEDIUM | D |
| 30 | `OpenRA.Mods.Common/Activities/FindAndDeliverResources.cs` | `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.ts` | `FindAndDeliverResources` | 263 | HIGH | D |
| 31 | `OpenRA.Mods.Common/Activities/MoveToDock.cs` | `src/OpenRA.Mods.Common/Activities/MoveToDock.ts` | `MoveToDock` | 150 | MEDIUM | D |
| 32 | `OpenRA.Mods.Common/Activities/GenericDockSequence.cs` | `src/OpenRA.Mods.Common/Activities/GenericDockSequence.ts` | `GenericDockSequence` | 216 | HIGH | D |
| 33 | `OpenRA.Mods.Common/Activities/Resupply.cs` | `src/OpenRA.Mods.Common/Activities/Resupply.ts` | `Resupply` | 327 | HIGH | D |
| 34 | `OpenRA.Mods.Common/Activities/Sell.cs` | `src/OpenRA.Mods.Common/Activities/Sell.ts` | `Sell` | 58 | LOW | D |
| 35 | `OpenRA.Mods.Common/Activities/LayMines.cs` | `src/OpenRA.Mods.Common/Activities/LayMines.ts` | `LayMines` | 237 | MEDIUM | D |

| **Phase E: Transport & Enter Activities** | | | | | |
| 36 | `OpenRA.Mods.Common/Activities/Enter.cs` | `src/OpenRA.Mods.Common/Activities/Enter.ts` | `Enter` (abstract) | 163 | HIGH | E |
| 37 | `OpenRA.Mods.Common/Activities/RideTransport.cs` | `src/OpenRA.Mods.Common/Activities/RideTransport.ts` | `RideTransport` | 93 | LOW | E |
| 38 | `OpenRA.Mods.Common/Activities/UnloadCargo.cs` | `src/OpenRA.Mods.Common/Activities/UnloadCargo.ts` | `UnloadCargo` | 153 | MEDIUM | E |
| 39 | `OpenRA.Mods.Common/Activities/PickupUnit.cs` | `src/OpenRA.Mods.Common/Activities/PickupUnit.ts` | `PickupUnit` (+ nested `AttachUnit`) | 181 | MEDIUM | E |
| 40 | `OpenRA.Mods.Common/Activities/DeliverUnit.cs` | `src/OpenRA.Mods.Common/Activities/DeliverUnit.ts` | `DeliverUnit` (+ nested `ReleaseUnit`) | 112 | MEDIUM | E |
| 41 | `OpenRA.Mods.Common/Activities/SimpleTeleport.cs` | `src/OpenRA.Mods.Common/Activities/SimpleTeleport.ts` | `SimpleTeleport` | 30 | LOW | E |

| **Phase F: Utility & Miscellaneous** | | | | | |
| 42 | `OpenRA.Mods.Common/Activities/Wait.cs` | `src/OpenRA.Mods.Common/Activities/Wait.ts` | `Wait` / `WaitFor` | 56 | LOW | F |
| 43 | `OpenRA.Mods.Common/Activities/Transform.cs` | `src/OpenRA.Mods.Common/Activities/Transform.ts` | `Transform` (+ nested `IssueOrderAfterTransform`) | 189 | MEDIUM | F |
| 44 | `OpenRA.Mods.Common/Activities/RemoveSelf.cs` | `src/OpenRA.Mods.Common/Activities/RemoveSelf.ts` | `RemoveSelf` | 26 | LOW | F |
| 45 | `OpenRA.Mods.Common/Activities/DeployForGrantedCondition.cs` | `src/OpenRA.Mods.Common/Activities/DeployForGrantedCondition.ts` | `DeployForGrantedCondition` (+ nested `DeployInner`) | 87 | LOW | F |
| 46 | `OpenRA.Mods.Common/Activities/DonateCash.cs` | `src/OpenRA.Mods.Common/Activities/DonateCash.ts` | `DonateCash` | 52 | LOW | F |
| 47 | `OpenRA.Mods.Common/Activities/DonateExperience.cs` | `src/OpenRA.Mods.Common/Activities/DonateExperience.ts` | `DonateExperience` | 66 | LOW | F |
| 48 | `OpenRA.Mods.Common/Activities/RepairBridge.cs` | `src/OpenRA.Mods.Common/Activities/RepairBridge.ts` | `RepairBridge` | 89 | LOW | F |
| 49 | `OpenRA.Mods.Common/Activities/InstantRepair.cs` | `src/OpenRA.Mods.Common/Activities/InstantRepair.ts` | `InstantRepair` | 82 | LOW | F |
| -- | `OpenRA.Game/Activities/Activity.cs` | `src/OpenRA.Game/Activities/Activity.ts` | `Activity` (abstract) | 296 | HIGH | F ✅ ALREADY MIGRATED |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies. ≤100 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple trait interactions or state transitions. 100-300 lines of C#.
> - **HIGH**: Complex gameplay logic with state machines, spatial queries, or physics. 300-400 lines of C#.
> - **HIGHEST**: Core infrastructure or very large state machine with broad impact. ≥400 lines of C#.

> **Cross-reference: phase placement of `Turn` and `MoveToDock`**
> - `Turn.ts` is placed in **Phase B (Combat)** rather than Phase A. It is a simple facing activity used by both movement and combat; placing it in Phase B unblocks `Attack` without adding Phase A critical-path length.
> - `MoveToDock.ts` is placed in **Phase D (Economic)** rather than Phase A. It is a docking-alignment specialization that depends on `Move` (Phase A) and on `DockClientManager`/`IDockHost` from Chapters 10–11, so it migrates alongside the harvest/dock/resupply cluster.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total concrete activity files to migrate** | 49 |
| **Already migrated base files** | 2 (`Activity.ts`, `CallFunc.ts` in Chapter 3 Phase F) |
| **Total files in Activity system** | 51 |
| **Total logical classes** | ~60 (49 files + ~11 nested helper classes) |
| **Total C# source lines** | ~6,510 (49 concrete activity files) |
| **Total C# source lines (including already-migrated base files)** | ~6,839 |
| **Estimated TypeScript implementation lines** | ~14,000-16,000 |
| **HIGHEST complexity** | 1 file (`Move.cs` 640 lines) |
| **HIGH complexity** | 8 files (`Attack`, `Enter`, `Fly`, `FlyAttack`, `Land`, `FindAndDeliverResources`, `Resupply`, `GenericDockSequence`) |
| **MEDIUM complexity** | 17 files |
| **LOW complexity** | 23 files |

| Phase | Files | C# Lines | Est. TS Lines | Est. Tests | Status |
|:---|:---:|:---:|:---:|:---:|:---:|
| A: Movement | 11 | ~1,500 | ~3,400 | ~180 | **COMPLETE (11/11, 82 tests, 3 E2E pages R2 APPROVED)** |
| B: Combat | 5 | ~626 | ~1,500 | ~90 | PLANNING |
| C: Aircraft | 12 | ~1,627 | ~3,700 | ~140 | PLANNING |
| D: Economic | 7 | ~1,375 | ~3,300 | ~120 | PLANNING |
| E: Transport & Enter | 6 | ~732 | ~1,800 | ~90 | PLANNING |
| F: Utility & Misc | 8 | ~647 | ~1,500 | ~70 | PLANNING |
| **Total** | **49** | **~6,510** | **~15,200** | **~690** | **Phase A COMPLETE (11/11); B-F PLANNING** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Movement Activities ✅ COMPLETE (11/11 migrated, 82 tests, 3 E2E pages R2 APPROVED)
**Complexity**: HIGHEST (`Move.cs` 640 lines) + MEDIUM/LOW wrappers
**Blocked by**: Chapter 3 Phase F (`Activity` base) -- COMPLETE; Chapter 9 (`Mobile`, `Locomotor`, pathfinding) -- COMPLETE
**Blocks**: Phase B (`Attack`, `Hunt`), Phase D (`MoveToDock`), Phase E (`Enter`, `UnloadCargo`, `Resupply`), Phase F (`DeployForGrantedCondition`)
**Completed**: 2026-06-15
**Tests**: 11 test files, 82 tests, all passing
**Acceptance Test Pages**: 3 pages (`activities/move/`, `activities/target-lines/`, `activities/attack-move/`), R2 APPROVED
**Review**: ch14-reviewer, Round 2 APPROVED (0 BLOCKERs remaining)

**Description**: Movement activities are the foundation of all actor motion. `Move` is the largest single activity in the chapter and handles path following, local avoidance, blocker retry, backward movement, arc movement, and `MoveResult` reporting. All other movement activities are wrappers or specializations.

**Paradigm Shifts**:
- C# `Mobile` cast from `self.OccupiesSpace` -> TypeScript `self.occupiesSpace as Mobile` or `self.getComponent(Mobile)`
- C# `PathFinder.FindPathToTargetCell()` -> reuse Ch9 pathfinder API
- C# `WDist`/`WAngle` math -> same TypeScript primitives (already migrated)
- C# `TargetLineNode` 2D sprite -> Babylon.js `LinesMesh` in XZ world space
- C# nested `MovePart` classes -> TypeScript private helper classes in same file
- Visual position interpolation -> `scene.onBeforeRenderObservable` between tick positions

#### TODO-14.A.1 `src/OpenRA.Mods.Common/Activities/Move/Move.ts`
- [x] Port `Move` class with all three constructors (scriptable, standard, custom path func)
- [x] Port nested `MovePart`, `MoveFirstHalf`, `MoveSecondHalf` helpers
- [x] Implement `OnFirstRun` path evaluation with `PathSearchOrder` (All, Stationary, Immovable, None)
- [x] Implement `Tick` with path popping, facing, backward movement, blocker wait/retry
- [x] Handle cancellation: clear path, set `MoveResult.CompleteCanceled`
- [x] Implement `PopPath` helper with local avoidance and `MoveResult` reporting
- [x] Implement `TargetLineNodes` for move target preview
- [x] Unit tests: path following, cancellation, already-at-destination, blocked destination, backward movement, arc movement

#### TODO-14.A.2 `src/OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.ts`
- [x] Port `MoveAdjacentTo` wrapper around `Move`
- [x] Compute adjacent target cell and `nearEnough` distance
- [x] Unit tests: adjacency resolution, dynamic target updates

#### TODO-14.A.3 `src/OpenRA.Mods.Common/Activities/Move/MoveOnto.ts`
- [x] Port simple `MoveOnto` (move into target cell)
- [x] Unit tests: cell containment, completion condition

#### TODO-14.A.4 `src/OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.ts`
- [x] Port `MoveOntoAndTurn` (move onto cell then face target)
- [x] Unit tests: facing after move completion

#### TODO-14.A.5 `src/OpenRA.Mods.Common/Activities/Move/MoveWithinRange.ts`
- [x] Port `MoveWithinRange` (move within WDist range of target)
- [x] Unit tests: range threshold, target invalidation

#### TODO-14.A.6 `src/OpenRA.Mods.Common/Activities/Move/Drag.ts`
- [x] Port `Drag` (pull/push another actor)
- [x] Unit tests: relative position update

#### TODO-14.A.7 `src/OpenRA.Mods.Common/Activities/Move/Nudge.ts`
- [x] Port `Nudge` (micro-movement to unblock)
- [x] Unit tests: nudge direction, completion

#### TODO-14.A.8 `src/OpenRA.Mods.Common/Activities/Move/Follow.ts`
- [x] Port `Follow` (chase moving target)
- [x] Unit tests: target movement, range maintenance

#### TODO-14.A.9 `src/OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.ts`
- [x] Port `LocalMoveIntoTarget` (close-range approach)
- [x] Unit tests: target validity, completion distance

#### TODO-14.A.10 `src/OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.ts`
- [x] Port `AttackMoveActivity` (combines `Move` + `Hunt`)
- [x] Unit tests: move interleaved with attack acquisition

#### TODO-14.A.11 `src/OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.ts`
- [x] Port `MoveCooldownHelper` (shared movement cooldown tracking)
- [x] Unit tests: cooldown expiration

---

### 3.2 Phase B: Combat Activities

**Status**: PLANNING (0/5 migrated)
**Complexity**: HIGH (`Attack.cs` 283 lines)
**Blocked by**: Phase A (`Move`, `Turn`), Chapter 8 (combat traits), Chapter 9 (`Mobile`/`Aircraft`)
**Blocks**: Phase A (`AttackMoveActivity`), Phase F (`DeployForGrantedCondition` indirectly)

**Description**: Combat activities orchestrate the attack loop: move into range, face target, wait for armament cooldown, fire, repeat. `CaptureActor` and `Demolish` use the `Enter` pattern from Phase E.

**Paradigm Shifts**:
- C# `Armament` / `AttackBase` integration -> reuse Ch8 traits
- Range checks on XZ plane -> `CoordinateTransformer.distanceBetween()` or WPos horizontal distance
- Target invalidation -> `Target.Recalculate()` equivalent
- `Turn` is a combat support activity used by `Attack` and movement wrappers

#### TODO-14.B.1 `src/OpenRA.Mods.Common/Activities/Attack.ts`
- [ ] Port `Attack` activity (move into range, face, fire, repeat)
- [ ] Handle `IsCanceling` cleanup
- [ ] Unit tests: range approach, firing cycle, target death, cancellation

#### TODO-14.B.2 `src/OpenRA.Mods.Common/Activities/Hunt.ts`
- [ ] Port `Hunt` (search for nearest enemy and attack)
- [ ] Unit tests: target acquisition, no-target completion

#### TODO-14.B.3 `src/OpenRA.Mods.Common/Activities/CaptureActor.ts`
- [ ] Port `CaptureActor` (engineer capture using `Enter` pattern)
- [ ] Unit tests: capture progress, ownership transfer

#### TODO-14.B.4 `src/OpenRA.Mods.Common/Activities/Demolish.ts`
- [ ] Port `Demolish` (place explosives using `Enter` pattern)
- [ ] Unit tests: timer, damage application

#### TODO-14.B.5 `src/OpenRA.Mods.Common/Activities/Turn.ts`
- [ ] Port `Turn` (rotate actor to facing)
- [ ] Unit tests: rotation completion

---

### 3.3 Phase C: Aircraft Activities

**Status**: PLANNING (0/12 migrated)
**Complexity**: HIGH (`Fly.cs` 283 lines, `FlyAttack.cs` 316 lines, `Land.cs` 276 lines)
**Blocked by**: Chapter 9 (`Aircraft` trait), Phase A (`Move` for ground taxi if any)
**Blocks**: Phase B (`FlyAttack`, `FlyFollow`), Phase D (`Resupply` for aircraft), Phase E (`PickupUnit`, `DeliverUnit`), Chapter 13 support powers (already use `Fly`)

**Description**: Aircraft activities implement flight physics wrappers. `Fly` is the core and exposes static `FlyTick()` / `VerticalTakeOffOrLandTick()` helpers used by all other aircraft activities. `FlyAttack` contains nested `FlyAttackRun`/`StrafeAttackRun` classes.

**Paradigm Shifts**:
- C# `Aircraft` direct mutation -> call `Aircraft` helper methods
- 3D altitude maps to Babylon.js Y axis
- Turn radius / roll / pitch handled by `Aircraft` trait, not activity
- `RingBuffer<WPos>` for position history -> fixed-size array or `RingBuffer` utility

#### TODO-14.C.1 `src/OpenRA.Mods.Common/Activities/Air/Fly.ts`
- [ ] Port `Fly` with target tracking, last-visible-target fallback, range annulus
- [ ] Implement static `FlyTick` helpers (or delegate to `Aircraft`)
- [ ] Implement `VerticalTakeOffOrLandTick`
- [ ] Unit tests: target approach, minimum range slide, turn radius, cancellation/landing

#### TODO-14.C.2 `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.ts`
- [ ] Port `FlyAttack` (aircraft attack run)
- [ ] Port nested `FlyAttackRun` and `StrafeAttackRun`
- [ ] Coordinate with `AttackAircraft` / `AttackBomber` traits
- [ ] Unit tests: approach, attack range, departure

#### TODO-14.C.3 `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.ts`
- [ ] Port `FlyFollow` (aircraft escort/chase)
- [ ] Unit tests: follow range, target invalidation

#### TODO-14.C.4 `src/OpenRA.Mods.Common/Activities/Air/FlyForward.ts`
- [ ] Port `FlyForward` (fly fixed facing)
- [ ] Unit tests: boundary/off-map handling

#### TODO-14.C.5 `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.ts`
- [ ] Port `FlyIdle` (circling/hovering)
- [ ] Unit tests: idle behavior modes

#### TODO-14.C.6 `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.ts`
- [ ] Port `FlyOffMap` (exit world bounds)
- [ ] Unit tests: removal on off-map

#### TODO-14.C.7 `src/OpenRA.Mods.Common/Activities/Air/Land.ts`
- [ ] Port `Land` (descent and landing)
- [ ] Unit tests: landing altitude, runway/offset alignment

#### TODO-14.C.8 `src/OpenRA.Mods.Common/Activities/Air/TakeOff.ts`
- [ ] Port `TakeOff` (vertical ascent to cruise altitude)
- [ ] Unit tests: altitude transition, influence reservation

#### TODO-14.C.9 `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.ts`
- [ ] Port `ReturnToBase` (find helipad/airfield, land, resupply)
- [ ] Unit tests: base selection, landing sequence

#### TODO-14.C.10 `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.ts`
- [ ] Port `FallToEarth` (crashing aircraft)
- [ ] Unit tests: descent, impact

#### TODO-14.C.11 `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.ts`
- [ ] Port `DeliverBulkOrder` (transport deliver order)
- [ ] Unit tests: delivery position, unload trigger

#### TODO-14.C.12 `src/OpenRA.Mods.Common/Activities/Parachute.ts`
- [ ] Port `Parachute` (descent after paradrop)
- [ ] Unit tests: fall completion, land effect

---

### 3.4 Phase D: Economic Activities

**Status**: PLANNING (0/7 migrated)
**Complexity**: HIGH (`Resupply.cs` 327 lines, `FindAndDeliverResources.cs` 263 lines, `GenericDockSequence.cs` 216 lines)
**Blocked by**: Phase A (`Move`, `MoveToDock`), Chapter 10 (`Harvester`, `ResourceLayer`), Chapter 11 (`Building`, `DockClientManager`)
**Blocks**: Phase C (`ReturnToBase`), Phase E (`PickupUnit`, `DeliverUnit` indirectly)

**Description**: Economic activities drive the resource loop and building interactions. `FindAndDeliverResources` is a complex state machine over resource search, harvest, deliver, and dock. `Resupply` orchestrates repair/rearm child chains.

**Paradigm Shifts**:
- Docking offsets in WPos -> `CoordinateTransformer` for 3D positioning
- `DockClientManager` / `IDockHost` integration -> reuse Ch11 docking traits
- World mutations (sell, transform) -> deferred via `world.frameEndActions`

#### TODO-14.D.1 `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.ts`
- [ ] Port `FindAndDeliverResources` state machine (find resource, harvest, find refinery, deliver)
- [ ] Unit tests: full harvest cycle, no-resources behavior, refinery selection

#### TODO-14.D.2 `src/OpenRA.Mods.Common/Activities/HarvestResource.ts`
- [ ] Port `HarvestResource` (harvest tick at resource cell)
- [ ] Unit tests: harvest progress, resource depletion

#### TODO-14.D.3 `src/OpenRA.Mods.Common/Activities/MoveToDock.ts`
- [ ] Port `MoveToDock` (approach dock and align)
- [ ] Unit tests: dock alignment, offset

#### TODO-14.D.4 `src/OpenRA.Mods.Common/Activities/GenericDockSequence.ts`
- [ ] Port `GenericDockSequence` base class for docking
- [ ] Unit tests: dock state transitions

#### TODO-14.D.5 `src/OpenRA.Mods.Common/Activities/Resupply.ts`
- [ ] Port `Resupply` (repair/rearm sequence)
- [ ] Unit tests: resupply completion, cancellation, child chain

#### TODO-14.D.6 `src/OpenRA.Mods.Common/Activities/Sell.ts`
- [ ] Port `Sell` (sell building)
- [ ] Unit tests: refund, removal deferred

#### TODO-14.D.7 `src/OpenRA.Mods.Common/Activities/LayMines.ts`
- [ ] Port `LayMines` (mine placement sequence)
- [ ] Unit tests: mine placement, ammo check

---

### 3.5 Phase E: Transport & Enter Activities

**Status**: PLANNING (0/6 migrated)
**Complexity**: HIGH (`Enter.cs` 163 lines abstract base)
**Blocked by**: Phase A (`Move`), Phase C (`Land`, `TakeOff`, `Fly`), Chapter 11 (`Cargo`, `Passenger`, `Carryall`, `Carryable`)
**Blocks**: Phase B (`CaptureActor`, `Demolish`), Phase D (`Resupply`), Phase F (`DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair`)

**Description**: The `Enter` abstract class defines a 4-state state machine (Approaching/Entering/Exiting/Finished) used by capture, demolish, donation, repair, and transport activities. Cargo transport activities manage passenger loading/unloading.

**Paradigm Shifts**:
- C# abstract `Enter` class -> TypeScript abstract class with string-union state
- `Cargo.Load`/`Unload` integration -> reuse Ch11 `Cargo` trait
- `Carryall` attach/release -> reuse Ch11 carryable transport traits

#### TODO-14.E.1 `src/OpenRA.Mods.Common/Activities/Enter.ts`
- [ ] Port abstract `Enter` class with 4-state state machine
- [ ] Unit tests: state transitions, cancellation return to Approaching

#### TODO-14.E.2 `src/OpenRA.Mods.Common/Activities/RideTransport.ts`
- [ ] Port `RideTransport`
- [ ] Unit tests: transport entry

#### TODO-14.E.3 `src/OpenRA.Mods.Common/Activities/UnloadCargo.ts`
- [ ] Port `UnloadCargo` (unload passengers)
- [ ] Unit tests: unload positions, cargo removal

#### TODO-14.E.4 `src/OpenRA.Mods.Common/Activities/PickupUnit.ts`
- [ ] Port `PickupUnit` (carryall pick up)
- [ ] Port nested `AttachUnit`
- [ ] Unit tests: approach, attach

#### TODO-14.E.5 `src/OpenRA.Mods.Common/Activities/DeliverUnit.ts`
- [ ] Port `DeliverUnit` (carryall drop)
- [ ] Port nested `ReleaseUnit`
- [ ] Unit tests: delivery position, release

#### TODO-14.E.6 `src/OpenRA.Mods.Common/Activities/SimpleTeleport.ts`
- [ ] Port `SimpleTeleport`
- [ ] Unit tests: position change

---

### 3.6 Phase F: Utility & Miscellaneous

**Status**: PLANNING (0/8 migrated)
**Complexity**: MEDIUM (`Transform.cs` 189 lines)
**Blocked by**: Chapter 3 (`Activity` base, `ConditionManager`), Chapter 11 (`Building`, `Transforms`, `WithMakeAnimation`)
**Blocks**: None (leaf activities)

**Description**: Simple utility activities used everywhere. `Transform` is the most complex due to actor replacement with init transfer. `DeployForGrantedCondition` contains nested `DeployInner`.

**Paradigm Shifts**:
- `Transform` actor replacement -> deferred `world.frameEndActions` with `ActorInitializer` transfer
- `Wait` condition wait -> predicate-based wait loop

#### TODO-14.F.1 `src/OpenRA.Mods.Common/Activities/Wait.ts`
- [ ] Port `Wait` and nested `WaitFor`
- [ ] Unit tests: tick countdown, condition wait

#### TODO-14.F.2 `src/OpenRA.Mods.Common/Activities/Transform.ts`
- [ ] Port `Transform` and nested `IssueOrderAfterTransform`
- [ ] Unit tests: new actor creation, init transfer, order reissue

#### TODO-14.F.3 `src/OpenRA.Mods.Common/Activities/RemoveSelf.ts`
- [ ] Port `RemoveSelf`
- [ ] Unit tests: deferred removal

#### TODO-14.F.4 `src/OpenRA.Mods.Common/Activities/DeployForGrantedCondition.ts`
- [ ] Port `DeployForGrantedCondition` and nested `DeployInner`
- [ ] Unit tests: condition grant/toggle

#### TODO-14.F.5 `src/OpenRA.Mods.Common/Activities/DonateCash.ts`
- [ ] Port `DonateCash`
- [ ] Unit tests: resource transfer

#### TODO-14.F.6 `src/OpenRA.Mods.Common/Activities/DonateExperience.ts`
- [ ] Port `DonateExperience`
- [ ] Unit tests: experience transfer

#### TODO-14.F.7 `src/OpenRA.Mods.Common/Activities/RepairBridge.ts`
- [ ] Port `RepairBridge` (engineer bridge repair)
- [ ] Unit tests: bridge repair completion

#### TODO-14.F.8 `src/OpenRA.Mods.Common/Activities/InstantRepair.ts`
- [ ] Port `InstantRepair`
- [ ] Unit tests: health restoration

---

## 4. Dependency Graph

### 4.1 External Dependencies

```
Chapters 2-13 (COMPLETE -- Foundation)
  |
  +--> Chapter 3 (Activity base, Actor, World, TraitDictionary, Target, ConditionManager) -- COMPLETE
  |
  +--> Chapter 4 (Map, CellLayer, Pathfinder, CoordinateTransformer) -- COMPLETE
  |
  +--> Chapter 5 (WorldInteractionControllerWidget, OrderGenerator) -- COMPLETE
  |
  +--> Chapter 6 (Order, IResolveOrder) -- COMPLETE
  |
  +--> Chapter 7 (Sound, SpriteEffect, RenderSprites) -- COMPLETE
  |
  +--> Chapter 8 (Armament, AttackBase, AutoTarget, HitShape, Warheads, Projectiles) -- COMPLETE
  |
  +--> Chapter 9 (Mobile, Aircraft, Fly-related traits, Cargo, ParaDrop, Locomotor) -- COMPLETE
  |
  +--> Chapter 10 (Harvester, ResourceLayer, PlayerResources, ResourceClaimLayer) -- COMPLETE
  |
  +--> Chapter 11 (Production, Building, Cargo, ParaDrop, Exit, RallyPoint, Carryall) -- COMPLETE
  |
  +--> Chapter 12 (Shroud, FrozenActor) -- COMPLETE
  |
  +--> Chapter 13 (SupportPower, SupportPowerManager) -- COMPLETE
  |
  +--> Chapter 14: Activity Implementations
```

### 4.2 Internal Phase Dependencies

```
Activity base (Ch3 Phase F) -- ALREADY MIGRATED
  |
  +--> Phase A: Movement Activities
  |     |
  |     +--> Move (core path follower)
  |     +--> MoveAdjacentTo, MoveOnto, MoveWithinRange, LocalMoveIntoTarget (wrappers)
  |     +--> Nudge, Drag, Follow (micro-movement)
  |     +--> AttackMoveActivity (combines Move + Hunt)
  |     +--> MoveCooldownHelper, MoveToDock (support)
  |
  +--> Phase B: Combat Activities
  |     |
  |     +--> Attack (uses Mobile + Armament)
  |     +--> Hunt (simple search-and-attack wrapper)
  |     +--> CaptureActor, Demolish (use Enter pattern from Phase E)
  |     +--> Turn (used by Attack and movement)
  |
  +--> Phase C: Aircraft Activities
  |     |
  |     +--> Fly (core flight physics)
  |     +--> TakeOff, Land (altitude transitions)
  |     +--> FlyIdle, FlyForward, FlyOffMap (simple flight modes)
  |     +--> FlyAttack, FlyFollow (aircraft combat)
  |     +--> ReturnToBase, FallToEarth, DeliverBulkOrder (specialized)
  |     +--> Parachute (descent effect)
  |
  +--> Phase D: Economic Activities
  |     |
  |     +--> HarvestResource, FindAndDeliverResources (economy)
  |     +--> MoveToDock, GenericDockSequence, Resupply (docking)
  |     +--> Sell, LayMines (building/actor lifecycle)
  |
  +--> Phase E: Transport & Enter Activities
  |     |
  |     +--> Enter (abstract base)
  |     +--> RideTransport, UnloadCargo (cargo)
  |     +--> PickupUnit, DeliverUnit (carryall)
  |     +--> SimpleTeleport (actor position)
  |
  +--> Phase F: Utility & Miscellaneous
        |
        +--> Wait, RemoveSelf, Turn
        +--> Transform, Sell (actor lifecycle)
        +--> DeployForGrantedCondition, InstantRepair, RepairBridge
        +--> DonateCash, DonateExperience
```

### 4.3 Critical Path

```
Move (Phase A) -- longest and most complex activity
  |
  +--> AttackMoveActivity, MoveAdjacentTo, MoveWithinRange, LocalMoveIntoTarget, Nudge
  +--> Attack (Phase B)
  +--> Enter, UnloadCargo, PickupUnit, Resupply, MoveToDock (Phases D/E)

Fly (Phase C) -- core aircraft physics
  |
  +--> FlyAttack, FlyFollow (Phase B)
  +--> ReturnToBase, Land, TakeOff (Phase C)
  +--> DeliverBulkOrder, Parachute (Phase C)

Enter (Phase E) -- abstract base for many activities
  |
  +--> CaptureActor, Demolish (Phase B)
  +--> RideTransport (Phase E)
  +--> DonateCash, DonateExperience, RepairBridge, InstantRepair (Phase F)

HarvestResource / FindAndDeliverResources (Phase D) -- depend on Move + economy traits
```

### 4.4 Parallelization Opportunities

- **Track 1** (ground movement): Phase A after Activity base
- **Track 2** (aircraft): Phase C can start in parallel with Phase A once `Aircraft` trait API is stable
- **Track 3** (combat): Phase B depends on Track 1 (`Move`, `Turn`) and Chapter 8
- **Track 4** (economy): Phase D depends on Tracks 1-2 and Chapters 10-11
- **Track 5** (transport/utility): Phases E-F depend on Track 1 and Chapter 11
- **Within each phase**: LOW-complexity utility activities can be batch-assigned in parallel

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns:

- [ ] **TEST-14.1** `Move` path following: verify actor advances one cell per tick along computed path; returns true when destination reached
- [ ] **TEST-14.2** `Move` path recalculation: when next cell becomes blocked mid-movement, verify path is recomputed from current position
- [ ] **TEST-14.3** `Move` local avoidance: when blocked by friendly actor, verify `Nudge` is attempted; when blocked by enemy, verify path recalculation
- [ ] **TEST-14.4** `Move` backward movement: verify backward movement enabled when config allows and angle > 256
- [ ] **TEST-14.5** `Move` arc movement: verify `MovePart` arc interpolation
- [ ] **TEST-14.6** `MoveAdjacentTo` range validation: verify actor stops at cell within [minRange, maxRange] of target; re-evaluates if target moves
- [ ] **TEST-14.7** `MoveOnto` exact cell: verify actor must reach exact target cell; fails if cell permanently blocked
- [ ] **TEST-14.8** `MoveWithinRange` weapon range: verify actor stops when target is within `Armament.weaponRange`; re-approaches if target moves out of range
- [ ] **TEST-14.9** `Nudge` resolution: verify single-cell displacement; returns true if blocked (give up)
- [ ] **TEST-14.10** `Follow` re-evaluation: verify path recomputed when target moves >1 cell; maintains follow distance
- [ ] **TEST-14.11** `AttackMoveActivity` interruption: verify `Move` is interrupted when enemy spotted; `Attack` queued; `Move` resumes after combat
- [ ] **TEST-14.12** `Attack` state machine: verify sequence: (1) MoveWithinRange if out of range, (2) Turn if not facing, (3) Fire if in range and facing
- [ ] **TEST-14.13** `Attack` target invalidation: verify activity completes when target destroyed; cancels when target becomes invalid
- [ ] **TEST-14.14** `Hunt` scan: verify nearest enemy selected; queues `Attack` on found enemy; returns true if no enemies
- [ ] **TEST-14.15** `FlyAttack` strafe: verify aircraft flies past target, fires when in range, continues past
- [ ] **TEST-14.16** `FlyAttack` hover: verify aircraft holds position, fires continuously while target in range
- [ ] **TEST-14.17** `Fly` target approach: verify aircraft moves toward target, respects `nearEnough`
- [ ] **TEST-14.18** `Fly` minimum range slide: verify slider aircraft backs away when inside min range
- [ ] **TEST-14.19** `Fly` turn radius: verify turn radius calculation prevents impossible turns
- [ ] **TEST-14.20** `Land` descent: verify altitude decreases each tick; returns true when altitude <= 0
- [ ] **TEST-14.21** `TakeOff` ascent: verify altitude increases each tick; returns true when cruise altitude reached
- [ ] **TEST-14.22** `ReturnToBase` sequence: verify Fly -> Land -> Resupply -> TakeOff chain
- [ ] **TEST-14.23** `Enter` state machine: verify Approaching -> Entering -> Exiting -> Finished transitions
- [ ] **TEST-14.24** `Enter` cancellation: verify cancel returns to Approaching state
- [ ] **TEST-14.25** `HarvestResource` completion: verify harvest completes when cell depleted; returns true
- [ ] **TEST-14.26** `FindAndDeliverResources` cycle: verify state transitions: Empty -> FindResource -> Move -> Harvest -> Full -> FindRefinery -> Move -> Dock -> Deliver -> Empty
- [ ] **TEST-14.27** `Resupply` orchestration: verify child activity chain: MoveToDock -> GenericDockSequence -> Wait -> Undock
- [ ] **TEST-14.28** `UnloadCargo` / `PickupUnit`: verify cargo load/unload with Ch11 `Cargo` trait
- [ ] **TEST-14.29** `CaptureActor` ownership: verify ownership transfer on completion; condition granted during capture
- [ ] **TEST-14.30** `Transform` deferred mutation: verify new actor created, old actor removed via `frameEndActions`; state transferred
- [ ] **TEST-14.31** `RemoveSelf` deferred: verify `world.remove(actor)` queued in `frameEndActions`, not immediate
- [ ] **TEST-14.32** `Turn` rotation: verify facing advances toward desired at turn speed; returns true when facing reached
- [ ] **TEST-14.33** `Wait` countdown: verify returns false while counting; returns true when duration expired
- [ ] **TEST-14.34** `DeployForGrantedCondition` condition: verify condition granted after deploy animation; `ConditionManager` token created
- [ ] **TEST-14.35** Activity cancellation: verify `cancel(keepQueue=true)` preserves child queue; `cancel(keepQueue=false)` discards it
- [ ] **TEST-14.36** `ActivityRunner` tick all: verify `ActivityRunner` ticks current activity; advances to next on completion; handles cancellation
- [ ] **TEST-14.37** Target line rendering: verify `LinesMesh` created on activity start; updated each tick; disposed on completion
- [ ] **TEST-14.38** `Sell` deferred removal: verify refund and `world.frameEndActions` removal

### 5.2 Per-Phase Test Estimates

| Phase | Files | Test Files (est.) | Tests (est.) | Test Lines (est.) |
|:---|:---:|:---:|:---:|:---:|
| A: Movement | 11 | 8 | ~180 | ~3,000 |
| B: Combat | 5 | 3 | ~90 | ~1,500 |
| C: Aircraft | 12 | 5 | ~140 | ~2,500 |
| D: Economic | 7 | 5 | ~120 | ~2,000 |
| E: Transport & Enter | 6 | 4 | ~90 | ~1,500 |
| F: Utility & Miscellaneous | 8 | 3 | ~70 | ~1,000 |
| **Total** | **49** | **28** | **~690** | **~11,500** |

### 5.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Ground movement | `/test/activities/move/` | ✅ COMPLETE (R2 APPROVED) | Verify path following, target line rendering, arrival at destination |
| Attack-move | `/test/activities/attack-move/` | ✅ COMPLETE (R2 APPROVED) | Verify movement interrupted by combat, target line color change |
| Target lines | `/test/activities/target-lines/` | ✅ COMPLETE (R2 APPROVED) | Verify move/attack target lines render in 3D world space |
| Aircraft flight | `/test/activities/fly/` | 📋 Planned | Verify flight path, altitude maintenance, arrival at destination |
| Landing/takeoff | `/test/activities/land-takeoff/` | 📋 Planned | Verify altitude transition, landing animation, takeoff sequence |
| Harvester cycle | `/test/activities/harvest/` | 📋 Planned | Verify harvest animation, dock approach, resource delivery |
| Cargo enter/unload | `/test/activities/cargo/` | 📋 Planned | Verify unit entering transport, transport moving, units exiting |
| Capture/demolish | `/test/activities/engineer/` | 📋 Planned | Verify engineer approach, capture animation, ownership change |
| Parachute drop | `/test/activities/parachute/` | 📋 Planned | Verify parachute descent animation, landing, unit spawn |
| Target lines | `/test/activities/target-lines/` | Verify move/attack target lines render in 3D world space |

### 5.4 Integration Testing

- [ ] **TEST-14.I1** Full harvester cycle: harvester spawned -> FindAndDeliverResources -> moves to resource -> harvests -> moves to refinery -> docks -> delivers -> repeats
- [ ] **TEST-14.I2** Attack + Move integration: unit attack-moves -> enemy spotted -> Attack activity -> MoveWithinRange -> Turn -> Armament fires -> enemy destroyed -> resume Move
- [ ] **TEST-14.I3** Aircraft full cycle: aircraft spawned -> Fly to target -> FlyAttack -> ReturnToBase -> Land -> Resupply -> TakeOff -> Fly to patrol
- [ ] **TEST-14.I4** Transport cargo loop: transport spawned -> PickupUnit -> Enter -> cargo loaded -> Move -> UnloadCargo -> passengers exit
- [ ] **TEST-14.I5** Engineer capture: engineer spawned -> Move to building -> CaptureActor -> ownership transfer -> engineer removed
- [ ] **TEST-14.I6** Carryall transport: carryall picks up unit -> flies to destination -> releases unit
- [ ] **TEST-14.I7** Activity cancellation chain: parent activity cancelled -> all child activities cancelled -> next activity preserved (if keepQueue=true)
- [ ] **TEST-14.I8** Resupply full cycle: damaged unit -> ReturnToBase -> MoveToDock -> GenericDockSequence -> Wait (repair) -> Undock -> TakeOff -> resume

---

## 6. Risk and Considerations

### 6.1 High-Risk Areas

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Move.cs complexity** (640 lines, pathfinding + local avoidance + blocker retry + arc movement) | HIGH | Largest single activity; mistakes affect every ground unit | Break into internal helpers; extensive unit tests for path edge cases; reuse Ch9 `Mobile`/`PathSearch` |
| **Activity cancellation semantics** (state machine corner cases) | HIGH | Desync or stuck actors if cancel logic diverges from C# | Port `tickOuter` tests first; mirror C# state transitions exactly; test queued-cancel-before-first-tick |
| **Aircraft flight physics** (Fly.cs turn radius, altitude, sliding) | MEDIUM | Aircraft may jitter or fail to reach targets | Reuse Ch9 `Aircraft` math; visual interpolation separate from tick logic; acceptance tests for landing/takeoff |
| **Child/next activity chains** (Resupply, FindAndDeliverResources) | MEDIUM | Complex nested activity trees are hard to debug | Unit-test each nested step independently; use `PrintActivityTree` equivalent for debugging |
| **Target line rendering in 3D** (LinesMesh performance) | MEDIUM | Many units selected → many line meshes | Use `LinesMesh` with shared vertex buffers or `TrailMesh`; cull off-screen lines |
| **Docking alignment** (MoveToDock, GenericDockSequence) | MEDIUM | Refinery/dock offsets must match building footprints | Use `CoordinateTransformer` for WPos→Vector3; acceptance test for harvester docking |
| **Scope underestimate** (49 files vs 26 planned) | MEDIUM | Schedule pressure if original timeline used | Update plan to ~7-8 weeks single-dev or 4 weeks with parallel tracks |
| **Enter pattern consistency** (abstract base used by 6+ activities) | MEDIUM | Divergent enter behavior breaks capture/demolish/donation | Implement `Enter` base first; all derived activities inherit same state machine |

### 6.2 Performance Targets

| System | Target | Measurement |
|--------|--------|-------------|
| `Move.Tick()` single unit | <0.05ms | Per-tick path step |
| `ActivityRunner` tick all activities | <0.5ms | 200 actors with active activities |
| Target line render (50 selected units) | <1ms | LinesMesh update |
| Aircraft `Fly.Tick()` | <0.05ms | Per aircraft |
| Harvester full cycle (harvest→dock→return) | <2ms total | Across all activity transitions |

### 6.3 Deferred Features

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| Advanced local avoidance (beyond OpenRA's current blocker retry) | Out of scope; reuse Ch9 `BlockedByActor` behavior | TODO-14.DEFERRED.1 |
| Formation movement activity | Not present in OpenRA base; can be built later on top of `Move` | TODO-14.DEFERRED.2 |
| Scripted activity cutscenes (mission-specific) | Mission scripting is Chapter 20 | TODO-14.DEFERRED.3 |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-14.1: Reuse Chapter 3 Activity Base Without Modification

- **Decision**: Chapter 14 concrete activities extend the existing `src/OpenRA.Game/Activities/Activity.ts` base class. No changes to the base class are anticipated.
- **Rationale**: The base class already mirrors OpenRA's `Activity.cs` state machine, child/next queues, cancellation, and lifecycle callbacks. Changing it would risk regressions in Chapters 9, 11, and 13 that already depend on it.
- **Mitigation**: If a concrete activity genuinely needs new base behavior, prefer composition or a wrapper activity rather than modifying `Activity.ts`.

### ADR-14.2: Movement Logic Stays Grid-Based, Visuals Use 3D Interpolation

- **Decision**: `Move`, `MoveAdjacentTo`, and related activities continue to operate on the `CPos` grid and WPos coordinates. Babylon.js `TransformNode.position` is updated only for rendering via `scene.onBeforeRenderObservable` interpolation between tick positions.
- **Rationale**: Preserves deterministic lockstep and network sync. The grid is the authority; 3D visuals are cosmetic smoothing.
- **Mitigation**: `CoordinateTransformer` converts `WPos` to `Vector3` for the renderer. `Mobile` trait owns the position authority.

### ADR-14.3: Target Lines as World-Space `LinesMesh`

- **Decision**: `TargetLineNode` rendering uses Babylon.js `LinesMesh` in world space (XZ plane at terrain height + small Y offset) rather than 2D screen-space sprites.
- **Rationale**: World-space lines are correctly depth-sorted, occluded by terrain/buildings, and remain stable under camera rotation.
- **Mitigation**: Lines are created once and updated via `mesh.updateVerticesData()`; disposal on activity completion to avoid GPU leaks.

### ADR-14.4: Aircraft Activities Delegate Physics to `Aircraft` Trait

- **Decision**: `Fly`, `Land`, `TakeOff` activities call into the Chapter 9 `Aircraft` trait for position/rotation updates rather than mutating the actor transform directly.
- **Rationale**: Centralizes aircraft physics (facing, roll, pitch, altitude, speed) in one trait; activities only decide *where* to fly, not *how*.
- **Mitigation**: `Aircraft` exposes `setPosition()`, `flyStep()`, `tickFacing()` helpers used by activities.

### ADR-14.5: All World Mutations Deferred to `frameEndActions`

- **Decision**: Activities that create, remove, or transform actors (`RemoveSelf`, `Transform`, `Sell`, `SimpleTeleport`, `Enter` completion) queue mutations via `world.frameEndActions`.
- **Rationale**: Matches OpenRA's `World.AddFrameEndTask` pattern and prevents mid-tick state mutation that could break sync or iteration.
- **Mitigation**: `Activity` subclasses receive a `GameWorldManager` reference; helper method `queueFrameEndAction()` centralizes deferred execution.

### ADR-14.6: Phase Ordering by Dependency, Not File Size

- **Decision**: Chapter 14 is split into Movement → Combat → Aircraft → Economic → Transport → Utility, even though the largest file (`Move.cs`) is in Phase A.
- **Rationale**: Combat activities depend on Movement. Aircraft activities depend on Aircraft trait but are largely independent of ground movement. Economic, transport, and utility activities depend on earlier phases and Chapters 10-11.
- **Mitigation**: Within each phase, parallelize by dependency subgraph (e.g., `Wait`, `Turn`, `RemoveSelf` can be done anytime after base).

### ADR-14.7: Enter Pattern as Shared Abstract Base

- **Decision**: The `Enter` abstract class (Approaching → Entering → Exiting → Finished) is migrated as a shared TypeScript abstract base used by `CaptureActor`, `Demolish`, `DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair`, and `RideTransport`.
- **Rationale**: Ensures consistent enter/cancel semantics across all actor-entry activities and reduces duplicated state machine code.
- **Mitigation**: Implement `Enter.ts` early in Phase E; derive all enter-based activities from it.

---

## Migration Order and Phasing Strategy

| Week | Phase | Files | Description | Dependencies |
|:---:|:---|:---:|:---|:---|
| 1 | A (foundation) | 4 | `Move.ts` core + `Nudge`, `Drag`, `Turn` | Ch3 Activity base + Ch9 Mobile |
| 2 | A (wrappers) | 4 | `MoveAdjacentTo`, `MoveOnto`, `MoveOntoAndTurn`, `MoveWithinRange` | `Move` |
| 2-3 | A (advanced) | 3 | `Follow`, `LocalMoveIntoTarget`, `AttackMoveActivity` | `Move`, Ch8 combat |
| 3 | A (support) | 2 | `MoveCooldownHelper`, `MoveToDock` | `Move`, Ch11 docking |
| 3-4 | B | 5 | `Attack`, `Hunt`, `CaptureActor`, `Demolish`, `Turn` | Phase A + Ch8 |
| 4-5 | C (core) | 3 | `Fly`, `TakeOff`, `Land` | Ch9 Aircraft |
| 5 | C (modes) | 9 | `FlyIdle`, `FlyForward`, `FlyOffMap`, `ReturnToBase`, `FallToEarth`, `DeliverBulkOrder`, `FlyAttack`, `FlyFollow`, `Parachute` | `Fly` |
| 6 | D | 7 | `HarvestResource`, `FindAndDeliverResources`, `MoveToDock`, `GenericDockSequence`, `Resupply`, `Sell`, `LayMines` | Ch10 + Ch11 |
| 6-7 | E | 6 | `Enter`, `RideTransport`, `UnloadCargo`, `PickupUnit`, `DeliverUnit`, `SimpleTeleport` | Ch11 Cargo |
| 7-8 | F | 8 | `Wait`, `Transform`, `RemoveSelf`, `DeployForGrantedCondition`, `DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair` | Ch3 / Ch11 |

**Total estimated effort**: ~7-8 weeks (single developer) or ~4 weeks (3 developers with parallel tracks).

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits) -- Architecture analysis
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Format template for migration plans
> - `docs/chapter14_activity_implementations_analysis.md` -- Detailed source analysis and inventory
> - `docs/chapter9_movement_physics_migration_plan.md` -- Movement/physics foundation
> - `docs/chapter10_resource_economy_migration_plan.md` -- Economy trait dependencies
> - `docs/chapter11_production_building_migration_plan.md` -- Production/cargo dependencies
> - `docs/remaining_systems_migration_plan.md` -- Original Chapter 14 skeleton (scope updated by this plan)
> - `src/OpenRA.Game/Activities/Activity.ts` -- Already-migrated base class
