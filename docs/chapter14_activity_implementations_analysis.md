# OpenRA to Babylon.js Migration Plan: Chapter 14 — Activity Implementations

> **Source Reference**: `OpenRA/OpenRA.Game/Activities/Activity.cs`, `OpenRA/OpenRA.Mods.Common/Activities/**/*.cs`
> **Chapter Status**: PLANNING (0/49 concrete files migrated; `Activity.ts` + `CallFunc.ts` already migrated in Chapter 3 Phase F)
> **Planning Date**: 2026-06-15
> **Prerequisite**: Chapters 2-13 COMPLETE (341/341 files, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [File Inventory Table](#2-file-inventory-table)
3. [Summary Statistics](#3-summary-statistics)
4. [Key Paradigm Shifts](#4-key-paradigm-shifts)
5. [Dependency Graph](#5-dependency-graph)
6. [Critical Path and Parallelization](#6-critical-path-and-parallelization)
7. [Risks and Considerations](#7-risks-and-considerations)
8. [Appendix: Architecture Decisions Record (ADR)](#8-appendix-architecture-decisions-record-adr)

---

## 1. Executive Summary

Chapter 14 migrates **all concrete Activity implementations** from the OpenRA C# codebase to TypeScript. The Activity base class (`Activity.ts`) and `CallFunc.ts` were already migrated in Chapter 3 Phase F. This chapter implements the **49 concrete activity subclasses** that form the gameplay behavior engine of OpenRA.

Activities are the **coroutine-linked state machines** that drive every unit action in the game: moving, attacking, harvesting, docking, capturing, repairing, transforming, flying, landing, and more. Each activity is a node in a linked-list chain, with optional child-activity nesting. The Activity system ticks through the chain each game frame, advancing when `tick()` returns `true`.

### Scope

| Category | Files | Lines (C#) | Description |
|----------|------:|-----------:|-------------|
| Core Infrastructure | 2 | ~330 | Activity.cs + CallFunc.cs (already migrated in Ch3) |
| Movement Activities | 11 | ~1,500 | Ground unit movement, pathfinding integration, adjacency, range |
| Combat Activities | 5 | ~630 | Attack, Hunt, CaptureActor, Demolish, Turn |
| Aircraft Activities | 12 | ~1,630 | Fly, FlyAttack, FlyFollow, Land, TakeOff, ReturnToBase, Parachute, etc. |
| Economic Activities | 7 | ~1,375 | Harvest, FindAndDeliverResources, Dock, Resupply, Sell, LayMines |
| Transport & Enter | 6 | ~730 | Enter, RideTransport, UnloadCargo, PickupUnit, DeliverUnit, SimpleTeleport |
| Utility & Misc | 8 | ~650 | Wait, Transform, RemoveSelf, DeployForGrantedCondition, DonateCash, DonateExperience, RepairBridge, InstantRepair |
| **Total** | **51** | **~6,840** | 49 concrete + 2 already-migrated base files |

### Key Finding: Scope Is Larger Than Originally Estimated

The existing `docs/remaining_systems_migration_plan.md` estimates Chapter 14 at **~26 files / ~3,438 C# lines**. A complete inventory of all Activity sources reveals **51 files** (49 concrete files to migrate plus the 2 already-migrated base files) totaling approximately **6,839 C# source lines**. This analysis updates the plan accordingly. The increase comes from:
- 12 aircraft activities (previously uncounted)
- 9 utility/misc activities (previously grouped)
- Nested classes within files (e.g., `MovePart`, `FlyAttackRun`, `ReleaseUnit`) that are substantial logical units

### Key Insight: The Activity System is the "Gameplay Glue"

Activities are where the **major gameplay systems intersect**. A single `Move` activity references:
- Pathfinding (Ch4 Phase G)
- Mobile trait (Ch9)
- Map terrain (Ch4)
- World tick (Ch3)
- Actor influence (Ch3)
- Target system (Ch3)

This makes Chapter 14 the **most cross-cutting chapter** in the entire migration. Every activity is a mini-integration point.

### Key Insight: ALL External Dependencies Are COMPLETE

Every trait, interface, and utility class referenced by activities has already been migrated in Chapters 2-13. This makes Chapter 14 **immediately actionable** with zero blocking dependencies. The only ordering constraints are internal class hierarchy within the chapter itself.


---

## 2. File Inventory Table

### Phase A: Movement Activities (12 files) — FOUNDATIONAL

These are the **most foundational** activities. Almost every other activity queues a movement activity as a child. `Move` is the most complex single file in the entire chapter (~640 lines).

| # | OpenRA Source | Target TS Path | Class | Lines | Complexity | Key Dependencies |
|---|---------------|----------------|-------|------:|:----------:|------------------|
| 14.A.1 | `OpenRA.Mods.Common/Activities/Move/Move.cs` | `src/OpenRA.Mods.Common/Activities/Move/Move.ts` | `Move` | 640 | **HIGHEST** | Mobile, PathFinder, Map, World, BlockedByActor, Util, Turn, WPos, WAngle, WRot, WDist, CPos, SubCell |
| 14.A.2 | `OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.ts` | `MoveAdjacentTo` | 159 | MEDIUM | Mobile, Target, PathFinder, BlockedByActor, Util, CPos |
| 14.A.3 | `OpenRA.Mods.Common/Activities/Move/MoveOnto.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveOnto.ts` | `MoveOnto` | 60 | LOW | Mobile, Target, BlockedByActor, Util |
| 14.A.4 | `OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.ts` | `MoveOntoAndTurn` | 43 | LOW | MoveOnto, Mobile, Target, Turn, WAngle |
| 14.A.5 | `OpenRA.Mods.Common/Activities/Move/MoveWithinRange.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveWithinRange.ts` | `MoveWithinRange` | 78 | MEDIUM | MoveAdjacentTo, Mobile, Target, Map, WDist, CPos |
| 14.A.6 | `OpenRA.Mods.Common/Activities/Move/Nudge.cs` | `src/OpenRA.Mods.Common/Activities/Move/Nudge.ts` | `Nudge` | 64 | LOW | IMove, Mobile, Aircraft, Fly, Target, WVec, WRot |
| 14.A.7 | `OpenRA.Mods.Common/Activities/Move/Drag.cs` | `src/OpenRA.Mods.Common/Activities/Move/Drag.ts` | `Drag` | 73 | LOW | IPositionable, IDisabledTrait, IMove, Target, WPos, WAngle |
| 14.A.8 | `OpenRA.Mods.Common/Activities/Move/Follow.cs` | `src/OpenRA.Mods.Common/Activities/Move/Follow.ts` | `Follow` | 89 | MEDIUM | IMove, Mobile, Target, WDist, WPos, MoveCooldownHelper |
| 14.A.9 | `OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.cs` | `src/OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.ts` | `LocalMoveIntoTarget` | 89 | LOW | Mobile, Target, WDist, WPos, WVec, WAngle |
| 14.A.10 | `OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.cs` | `src/OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.ts` | `AttackMoveActivity` | 108 | MEDIUM | AutoTarget, AttackMove, Activity, Target |
| 14.A.11 | `OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.ts` | `MoveCooldownHelper` | 100 | LOW | World, Mobile, MoveResult |
| 14.A.12 | `OpenRA.Game/Activities/CallFunc.cs` | `src/OpenRA.Game/Activities/CallFunc.ts` | `CallFunc` | 33 | LOW | Activity (already migrated) |

### Phase B: Combat Activities (5 files)

| # | OpenRA Source | Target TS Path | Class | Lines | Complexity | Key Dependencies |
|---|---------------|----------------|-------|------:|:----------:|------------------|
| 14.B.1 | `OpenRA.Mods.Common/Activities/Attack.cs` | `src/OpenRA.Mods.Common/Activities/Attack.ts` | `Attack` | 283 | **HIGH** | AttackFrontal, RevealsShroud, IMove, Mobile, IFacing, IPositionable, Armament, Target, AutoTarget, MoveCooldownHelper |
| 14.B.2 | `OpenRA.Mods.Common/Activities/Hunt.cs` | `src/OpenRA.Mods.Common/Activities/Hunt.ts` | `Hunt` | 49 | LOW | IMove, AttackBase, Huntable, Target, AttackMoveActivity |
| 14.B.3 | `OpenRA.Mods.Common/Activities/Demolish.cs` | `src/OpenRA.Mods.Common/Activities/Demolish.ts` | `Demolish` | 89 | LOW | Enter, IDemolishable, INotifyDemolition, FlashTarget, EnterBehaviour, DamageType |
| 14.B.4 | `OpenRA.Mods.Common/Activities/CaptureActor.cs` | `src/OpenRA.Mods.Common/Activities/CaptureActor.ts` | `CaptureActor` | 158 | MEDIUM | Enter, CaptureManager, Captures, IHealth, PlayerExperience, INotifyCapture, Damage |
| 14.B.5 | `OpenRA.Mods.Common/Activities/Turn.cs` | `src/OpenRA.Mods.Common/Activities/Turn.ts` | `Turn` | 47 | LOW | Mobile, IFacing, WAngle, Util |

### Phase C: Aircraft Activities (12 files)

Aircraft activities are **highly interdependent** and share the `Fly.FlyTick()` static helper pattern. The `Fly` class contains the core flight physics that all other aircraft activities call into.

| # | OpenRA Source | Target TS Path | Class | Lines | Complexity | Key Dependencies |
|---|---------------|----------------|-------|------:|:----------:|------------------|
| 14.C.1 | `OpenRA.Mods.Common/Activities/Air/Fly.cs` | `src/OpenRA.Mods.Common/Activities/Air/Fly.ts` | `Fly` | 283 | **HIGH** | Aircraft, Target, WDist, WPos, WVec, WAngle, Map, RingBuffer |
| 14.C.2 | `OpenRA.Mods.Common/Activities/Air/FlyAttack.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.ts` | `FlyAttack` | 316 | **HIGH** | Aircraft, AttackAircraft, Rearmable, Target, Fly, TakeOff, ReturnToBase, FlyAttackRun, StrafeAttackRun |
| 14.C.3 | `OpenRA.Mods.Common/Activities/Air/FlyFollow.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.ts` | `FlyFollow` | 99 | MEDIUM | Aircraft, Target, WDist, WPos, Fly |
| 14.C.4 | `OpenRA.Mods.Common/Activities/Air/FlyForward.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyForward.ts` | `FlyForward` | 64 | LOW | Aircraft, WDist, Fly |
| 14.C.5 | `OpenRA.Mods.Common/Activities/Air/FlyIdle.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.ts` | `FlyIdle` | 66 | LOW | Aircraft, INotifyIdle, Fly |
| 14.C.6 | `OpenRA.Mods.Common/Activities/Air/FlyOffMap.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.ts` | `FlyOffMap` | 70 | LOW | Aircraft, Target, Fly, TakeOff |
| 14.C.7 | `OpenRA.Mods.Common/Activities/Air/Land.cs` | `src/OpenRA.Mods.Common/Activities/Air/Land.ts` | `Land` | 276 | **HIGH** | Aircraft, Target, WVec, WAngle, WPos, WDist, WRot, Fly, TakeOff, Map, INotifyLanding |
| 14.C.8 | `OpenRA.Mods.Common/Activities/Air/ReturnToBase.cs` | `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.ts` | `ReturnToBase` | 140 | MEDIUM | Aircraft, RepairableInfo, Rearmable, Reservable, Fly, MoveOntoAndTurn, Resupply, WVec, WAngle |
| 14.C.9 | `OpenRA.Mods.Common/Activities/Air/TakeOff.cs` | `src/OpenRA.Mods.Common/Activities/Air/TakeOff.ts` | `TakeOff` | 73 | LOW | Aircraft, Fly, INotifyTakeOff |
| 14.C.10 | `OpenRA.Mods.Common/Activities/Air/FallToEarth.cs` | `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.ts` | `FallToEarth` | 64 | LOW | Aircraft, FallsToEarthInfo, Target, WVec, WAngle, WDist |
| 14.C.11 | `OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.cs` | `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.ts` | `DeliverBulkOrder` | 118 | MEDIUM | Cargo, ProductionBulkAirdrop, BulkProductionQueue, Target, Land, Wait, FlyOffMap, RemoveSelf |
| 14.C.12 | `OpenRA.Mods.Common/Activities/Parachute.cs` | `src/OpenRA.Mods.Common/Activities/Parachute.ts` | `Parachute` | 58 | LOW | IPositionable, ParachutableInfo, INotifyParachute, WVec |

### Phase D: Economic Activities (7 files)

| # | OpenRA Source | Target TS Path | Class | Lines | Complexity | Key Dependencies |
|---|---------------|----------------|-------|------:|:----------:|------------------|
| 14.D.1 | `OpenRA.Mods.Common/Activities/FindAndDeliverResources.cs` | `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.ts` | `FindAndDeliverResources` | 263 | **HIGH** | Harvester, Mobile, ResourceClaimLayer, DockClientManager, PathFinder, MoveToDock, HarvestResource, Wait, CPos |
| 14.D.2 | `OpenRA.Mods.Common/Activities/HarvestResource.cs` | `src/OpenRA.Mods.Common/Activities/HarvestResource.ts` | `HarvestResource` | 124 | MEDIUM | Harvester, IFacing, BodyOrientation, IMove, ResourceClaimLayer, IResourceLayer, INotifyHarvestAction, Wait, Turn |
| 14.D.3 | `OpenRA.Mods.Common/Activities/MoveToDock.cs` | `src/OpenRA.Mods.Common/Activities/MoveToDock.ts` | `MoveToDock` | 150 | MEDIUM | DockClientManager, IDockHost, INotifyDockClientMoving, Wait, MoveCooldownHelper |
| 14.D.4 | `OpenRA.Mods.Common/Activities/GenericDockSequence.cs` | `src/OpenRA.Mods.Common/Activities/GenericDockSequence.ts` | `GenericDockSequence` | 216 | **HIGH** | DockClientManager, IDockHost, IDockClientBody, INotifyDockClient, INotifyDockHost, WithDockingOverlay, Drag, Wait |
| 14.D.5 | `OpenRA.Mods.Common/Activities/Resupply.cs` | `src/OpenRA.Mods.Common/Activities/Resupply.ts` | `Resupply` | 327 | **HIGH** | IHealth, RepairsUnits, Repairable, RepairableNear, Rearmable, INotifyResupply, INotifyDockHost, INotifyDockClient, ICallForTransport, IMove, Aircraft, PlayerResources, MoveCooldownHelper, RallyPoint, AttackMoveActivity, TakeOff |
| 14.D.6 | `OpenRA.Mods.Common/Activities/Sell.cs` | `src/OpenRA.Mods.Common/Activities/Sell.ts` | `Sell` | 58 | LOW | IHealth, SellableInfo, PlayerResources, INotifySold, FloatingText |
| 14.D.7 | `OpenRA.Mods.Common/Activities/LayMines.cs` | `src/OpenRA.Mods.Common/Activities/LayMines.ts` | `LayMines` | 237 | MEDIUM | Minelayer, AmmoPool, IMove, RearmableInfo, INotifyMineLaying, MoveCooldownHelper, Wait, MoveAdjacentTo, Resupply |

### Phase E: Transport & Enter Activities (6 files)

| # | OpenRA Source | Target TS Path | Class | Lines | Complexity | Key Dependencies |
|---|---------------|----------------|-------|------:|:----------:|------------------|
| 14.E.1 | `OpenRA.Mods.Common/Activities/Enter.cs` | `src/OpenRA.Mods.Common/Activities/Enter.ts` | `Enter` | 163 | **HIGH** | IMove, Target, MoveCooldownHelper, EnterBehaviour (abstract base) |
| 14.E.2 | `OpenRA.Mods.Common/Activities/RideTransport.cs` | `src/OpenRA.Mods.Common/Activities/RideTransport.ts` | `RideTransport` | 93 | MEDIUM | Enter, Passenger, Cargo, Aircraft, INotifyLoadCargo |
| 14.E.3 | `OpenRA.Mods.Common/Activities/UnloadCargo.cs` | `src/OpenRA.Mods.Common/Activities/UnloadCargo.ts` | `UnloadCargo` | 153 | MEDIUM | Cargo, INotifyUnloadCargo, Aircraft, Mobile, IPositionable, IMove, Passenger, Land, Move, Wait, TakeOff |
| 14.E.4 | `OpenRA.Mods.Common/Activities/PickupUnit.cs` | `src/OpenRA.Mods.Common/Activities/PickupUnit.ts` | `PickupUnit` | 181 | MEDIUM | Carryall, Carryable, IFacing, BodyOrientation, Fly, FlyIdle, Land, Wait, AttachUnit, TakeOff |
| 14.E.5 | `OpenRA.Mods.Common/Activities/DeliverUnit.cs` | `src/OpenRA.Mods.Common/Activities/DeliverUnit.ts` | `DeliverUnit` | 112 | MEDIUM | Carryall, IPositionable, IFacing, BodyOrientation, Land, Wait, TakeOff, Target |
| 14.E.6 | `OpenRA.Mods.Common/Activities/SimpleTeleport.cs` | `src/OpenRA.Mods.Common/Activities/SimpleTeleport.ts` | `SimpleTeleport` | 30 | LOW | IPositionable, CPos |

### Phase F: Utility & Miscellaneous (9 files)

| # | OpenRA Source | Target TS Path | Class | Lines | Complexity | Key Dependencies |
|---|---------------|----------------|-------|------:|:----------:|------------------|
| 14.F.1 | `OpenRA.Mods.Common/Activities/Wait.cs` | `src/OpenRA.Mods.Common/Activities/Wait.ts` | `Wait` / `WaitFor` | 56 | LOW | Activity (already migrated) |
| 14.F.2 | `OpenRA.Mods.Common/Activities/Transform.cs` | `src/OpenRA.Mods.Common/Activities/Transform.ts` | `Transform` / `IssueOrderAfterTransform` | 189 | MEDIUM | Transforms, WithMakeAnimation, INotifyTransform, IFacingInfo, AircraftInfo, TypeDictionary, LocationInit, OwnerInit, FacingInit, HealthInit, FactionInit, SkipMakeAnimsInit, ITransformActorInitModifier, IResolveOrder, Selection, ControlGroups |
| 14.F.3 | `OpenRA.Mods.Common/Activities/RemoveSelf.cs` | `src/OpenRA.Mods.Common/Activities/RemoveSelf.ts` | `RemoveSelf` | 26 | LOW | Activity (already migrated) |
| 14.F.4 | `OpenRA.Mods.Common/Activities/DeployForGrantedCondition.cs` | `src/OpenRA.Mods.Common/Activities/DeployForGrantedCondition.ts` | `DeployForGrantedCondition` / `DeployInner` | 87 | LOW | GrantConditionOnDeploy, IFacingInfo, Turn |
| 14.F.5 | `OpenRA.Mods.Common/Activities/DonateCash.cs` | `src/OpenRA.Mods.Common/Activities/DonateCash.ts` | `DonateCash` | 52 | LOW | Enter, PlayerResources, PlayerExperience, INotifyCashTransfer, FloatingText |
| 14.F.6 | `OpenRA.Mods.Common/Activities/DonateExperience.cs` | `src/OpenRA.Mods.Common/Activities/DonateExperience.ts` | `DonateExperience` | 66 | LOW | Enter, GainsExperience, PlayerExperience |
| 14.F.7 | `OpenRA.Mods.Common/Activities/RepairBridge.cs` | `src/OpenRA.Mods.Common/Activities/RepairBridge.ts` | `RepairBridge` | 89 | LOW | Enter, BridgeHut, LegacyBridgeHut, EnterBehaviour, INotifyDemolition |
| 14.F.8 | `OpenRA.Mods.Common/Activities/InstantRepair.cs` | `src/OpenRA.Mods.Common/Activities/InstantRepair.ts` | `InstantRepair` | 82 | LOW | Enter, InstantlyRepairsInfo, IHealth, InstantlyRepairable, Damage, EnterBehaviour |
| 14.F.9 | `OpenRA.Game/Activities/Activity.cs` | `src/OpenRA.Game/Activities/Activity.ts` | `Activity` (abstract) | 296 | **HIGH** | GameActor, Target, Sprite, IActivityInterface, ActivityUtils (already migrated) |

---

## 3. Summary Statistics

### By Phase

| Phase | Files | C# Lines | Complexity Distribution | Description |
|-------|------:|---------:|:------------------------|-------------|
| A: Movement | 12 | ~1,535 | 1 HIGHEST, 4 MEDIUM, 7 LOW | Ground movement, pathfinding, nudge, drag, follow |
| B: Combat | 5 | ~625 | 1 HIGH, 1 MEDIUM, 3 LOW | Attack, Hunt, Demolish, Capture, Turn |
| C: Aircraft | 12 | ~1,625 | 3 HIGH, 3 MEDIUM, 6 LOW | Flight physics, attack runs, landing, resupply |
| D: Economic | 7 | ~1,375 | 3 HIGH, 3 MEDIUM, 1 LOW | Harvest, dock, resupply, sell, lay mines |
| E: Transport & Enter | 6 | ~730 | 1 HIGH, 4 MEDIUM, 1 LOW | Enter base, ride transport, unload, pickup, teleport |
| F: Utility & Misc | 9 | ~945 | 1 HIGH (base), 1 MEDIUM, 7 LOW | Wait, Transform, RemoveSelf, Deploy, Donate, Repair |
| **Total** | **51** | **~6,840** | **1 HIGHEST, 9 HIGH, 16 MEDIUM, 25 LOW** | 49 concrete + 2 already-migrated base files |

### Note on Line Counts

- **49 concrete activity files**: ~6,510 C# source lines (the migration work for Chapter 14).
- **2 already-migrated base files**: ~330 C# source lines (`Activity.cs` ~297 + `CallFunc.cs` ~33).
- **Total Activity system**: ~6,840 C# source lines.

### Complexity Breakdown

| Complexity | Count | Files |
|:----------:|------:|-------|
| **HIGHEST** (≥400 lines or core infrastructure with broad impact) | 1 | `Move` |
| **HIGH** (≥250 lines or complex state machine/physics) | 9 | `Fly`, `FlyAttack`, `Land`, `FindAndDeliverResources`, `Resupply`, `GenericDockSequence`, `Attack`, `Enter`, `Activity` (base) |
| **MEDIUM** (150-400 lines, multiple trait interactions) | 17 | `MoveAdjacentTo`, `MoveWithinRange`, `Follow`, `AttackMoveActivity`, `FlyFollow`, `ReturnToBase`, `DeliverBulkOrder`, `HarvestResource`, `MoveToDock`, `LayMines`, `CaptureActor`, `UnloadCargo`, `PickupUnit`, `DeliverUnit`, `Transform`, `FlyAttackRun`, `StrafeAttackRun` |
| **LOW** (≤150 lines, simple logic) | 25 | `MoveOnto`, `MoveOntoAndTurn`, `Nudge`, `Drag`, `LocalMoveIntoTarget`, `MoveCooldownHelper`, `CallFunc`, `Turn`, `Hunt`, `Demolish`, `FlyForward`, `FlyIdle`, `FlyOffMap`, `TakeOff`, `FallToEarth`, `Parachute`, `Sell`, `Wait`, `RemoveSelf`, `DeployForGrantedCondition`, `DeployInner`, `DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair`, `SimpleTeleport`, `IssueOrderAfterTransform` |

### Note on Nested Classes

Several files contain **nested private classes** that count as separate logical units:

- `Move.cs` contains `MovePart` (abstract), `MoveFirstHalf`, `MoveSecondHalf` — 3 extra classes
- `FlyAttack.cs` contains `FlyAttackRun`, `StrafeAttackRun` — 2 extra classes
- `Transform.cs` contains `IssueOrderAfterTransform` — 1 extra class
- `DeployForGrantedCondition.cs` contains `DeployInner` — 1 extra class
- `DeliverUnit.cs` contains `ReleaseUnit` — 1 extra class
- `PickupUnit.cs` contains `AttachUnit` — 1 extra class
- `Wait.cs` contains `WaitFor` — 1 extra class

This brings the **total logical activity classes to ~60** (51 files + ~9 nested classes).

### Note on Already-Migrated Files

Two files from the inventory are **already migrated** in Chapter 3 Phase F:
- `Activity.ts` (base class, 297 lines) — COMPLETE
- `CallFunc.ts` (callback activity, 34 lines) — COMPLETE

These are included in the inventory for completeness but require no migration work in Chapter 14.


---

## 4. Key Paradigm Shifts

### 4.1 Activity State Machine (Already Migrated in Ch3)

The Activity base class was migrated in Chapter 3 Phase F. The core state machine is **unchanged** in TypeScript:

| C# OpenRA | TypeScript / Babylon.js | Notes |
|-----------|------------------------|-------|
| `ActivityState` enum | `ActivityState` const object + type alias | Same 4 states |
| `TickOuter(Actor)` | `tickOuter(GameActor)` | Identical logic, camelCase |
| `Tick(Actor)` | `tick(GameActor)` | Virtual method, default returns true |
| `OnFirstRun(Actor)` | `onFirstRun(GameActor)` | Protected lifecycle hook |
| `OnLastRun(Actor)` | `onLastRun(GameActor)` | Protected lifecycle hook |
| `OnActorDispose(Actor)` | `onActorDispose(GameActor)` | Protected cleanup hook |
| `Cancel(Actor, bool)` | `cancel(GameActor, boolean)` | Cascading cancellation |
| `Queue(Activity)` | `queue(Activity)` | Linked-list append |
| `QueueChild(Activity)` | `queueChild(Activity)` | Child nesting |
| `ChildActivity` / `NextActivity` | `childActivity` / `nextActivity` | Getters with SkipDoneActivities |
| `ActivitiesImplementing<T>()` | `activitiesImplementing(ctor)` | Runtime `instanceof` instead of C# `is T` |
| `SkipDoneActivities()` | `skipDoneActivities()` | Static method, same logic |
| `TickChild(Actor)` | `tickChild(GameActor)` | Delegates to `runActivity()` |
| `IActivityInterface` | `IActivityInterface` | Already defined in TraitsInterfaces.ts |

### 4.2 Child/Next Activity Queue

The linked-list queue pattern is **universal** and requires no paradigm shift:

```typescript
// C#: activity.Queue(new Move(self, destination));
// TS:  activity.queue(new Move(self, destination));

// C#: activity.QueueChild(new Turn(self, facing));
// TS:  activity.queueChild(new Turn(self, facing));
```

The only difference is TypeScript's lack of `yield return` for `GetTargets()` and `TargetLineNodes()`. These return arrays instead of generators:

```typescript
// C#: public override IEnumerable<TargetLineNode> TargetLineNodes(Actor self) { yield break; }
// TS:  override targetLineNodes(_self: GameActor): TargetLineNode[] { return []; }
```

### 4.3 Cancellation Semantics

Cancellation is **identical** between C# and TypeScript. The base class `cancel()` method:
1. Clears `nextActivity` chain (unless `keepQueue=true`)
2. Checks `isInterruptible` — if false, cancel is ignored
3. Cascades cancel to child activity
4. If `Queued` → sets `Done` (never started, skip cleanup)
5. If `Active`/`Canceling` → sets `Canceling` (activity cleans up in next tick)

**Important**: The TypeScript base class adds a guard that the C# source lacks: if `state === Done`, cancel is a no-op. This prevents a double-cancel from transitioning `Done → Canceling` (a latent defect in the original C# source).

### 4.4 Target Line Rendering in 3D

Target lines (the colored lines showing unit orders) shift from 2D sprite-based rendering to 3D line rendering:

| C# OpenRA | TypeScript / Babylon.js |
|-----------|------------------------|
| `TargetLineNode` with `Color` and `Sprite tile` | `TargetLineNode` with `Color` and optional `Sprite` (same structure) |
| `TargetLineNodes(Actor)` returns `IEnumerable<TargetLineNode>` | `targetLineNodes()` returns `TargetLineNode[]` |
| 2D sprite tiles along the line path | 3D `LinesMesh` or `TrailMesh` with `Color3` materials |
| Line drawn in screen-space 2D | Line drawn in world-space 3D (Babylon.js `CreateLines`) |
| Dashed/solid via sprite tile pattern | Dashed/solid via `DashArray` material parameter or segment splitting |

**3D Target Line Implementation Strategy**:
- Use `BABYLON.MeshBuilder.CreateLines("targetLine", { points: [...], colors: [...] }, scene)`
- Points are `Vector3[]` converted from `WPos` via `CoordinateTransformer`
- Colors are `Color4[]` per point (supports gradient lines)
- Lines are transient — created each frame from `targetLineNodes()` output, disposed after render
- For dashed lines, split into segments and alternate visibility
- For tile markers (minefield indicators), use small billboard planes at cell centers

### 4.5 Move Activity Physics in 3D

The `Move` activity is the most physics-heavy activity. Key 3D shifts:

| C# OpenRA | TypeScript / Babylon.js |
|-----------|------------------------|
| `WPos.Lerp(From, To, progress, Distance)` | `Vector3.Lerp(fromVec3, toVec3, progress / distance)` |
| `WRot.SLerp(from, to, t, max)` | `Quaternion.Slerp(fromQuat, toQuat, t)` |
| `map.DistanceAboveTerrain(pos)` | `terrainMesh.getHeightAt(pos.x, pos.z)` |
| `mobile.SetCenterPosition(self, pos)` | `actor.transformNode.position = pos` |
| `mobile.SetTerrainRampOrientation(rot)` | `actor.transformNode.rotationQuaternion = rot` |
| Arc movement via elliptical math | Arc movement via `BABYLON.Curve3` or `Path3D` |
| Turn-in-place via `Util.TickFacing()` | Turn-in-place via `Quaternion.Slerp()` on Y-axis |

### 4.6 Aircraft Flight Physics in 3D

The `Fly` activity's `FlyTick()` static method is the core flight simulator:

| C# OpenRA | TypeScript / Babylon.js |
|-----------|------------------------|
| `aircraft.FlyStep(desiredFacing)` | `Vector3.TransformCoordinates(new Vector3(0, 0, speed), rotationMatrix)` |
| `Util.TickFacing(current, desired, turnSpeed)` | `Quaternion.Slerp(currentRotation, desiredRotation, turnSpeed * deltaTime)` |
| `aircraft.Roll` / `aircraft.Pitch` | `actor.transformNode.rotation.x` (pitch) / `rotation.z` (roll) |
| `DistanceAboveTerrain(pos)` | `terrainMesh.getHeightAt(pos.x, pos.z)` |
| `VerticalTakeOffOrLandTick()` | Direct Y-axis position lerp with terrain height |
| Turn radius calculation | Same math (speed / turnSpeed), used for 3D path planning |

### 4.7 Enter Activity Pattern

The `Enter` abstract class defines a **5-state state machine** for entering a target actor:

```
Approaching → Entering → Exiting → Finished
     ↑___________↓
     (cancel loops back to Approaching)
```

This pattern is used by `CaptureActor`, `Demolish`, `DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair`, and `RideTransport`. The state machine is implemented via a `lastState` enum field and `switch` statement in `Tick()`.

In TypeScript, this maps directly to a string union type:

```typescript
type EnterState = 'Approaching' | 'Entering' | 'Exiting' | 'Finished'
```

### 5.1 Internal Dependencies (Within Chapter 14)

```
Activity (base) ─────────────────┬────────────────────────────────────────┐
                                 │                                        │
    ┌────────────────────────────┼────────────────────────┐               │
    │                            │                        │               │
    ▼                            ▼                        ▼               │
CallFunc                      Wait      Turn                         │
                                        │                              │
    ┌───────────────────────────────────┼──────────────────────────┐   │
    │                                   │                          │   │
    ▼                                   ▼                          ▼   │
Enter ◄──────┬──────────────┬────── Move ◄──────┬──────────────┬── Fly │
    │        │              │        │           │              │      │
    │        │              │        │           │              │      │
    ▼        ▼              ▼        ▼           ▼              ▼      │
Capture  Demolish      Ride    MoveAdjacentTo  MoveOnto      FlyAttack  │
Actor    DonateCash    Transport MoveOntoAndTurn MoveWithinRange FlyFollow
Donate   RepairBridge  Unload    Drag            LocalMoveInto   FlyForward
Exp.     InstantRepair Cargo    Follow          Target          FlyIdle
                                                AttackMove      FlyOffMap
                                                                Land
                                                                ReturnToBase
                                                                TakeOff
                                                                FallToEarth
```

**Key internal dependency chains:**

1. **Move hierarchy**: `Move` ← `MoveAdjacentTo` ← `MoveOnto` ← `MoveOntoAndTurn`
2. **Enter hierarchy**: `Enter` ← `CaptureActor`, `Demolish`, `DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair`, `RideTransport`
3. **Fly hierarchy**: `Fly` (static `FlyTick`) is called by `FlyAttack`, `FlyFollow`, `FlyForward`, `FlyIdle`, `FlyOffMap`, `Land`, `TakeOff`, `FallToEarth`, `ReturnToBase`
4. **Economic chain**: `FindAndDeliverResources` → `HarvestResource` → `MoveToDock` → `GenericDockSequence` → `Resupply`

> **Cross-reference: phase placement of `Turn` and `MoveToDock`**
> - `Turn.cs` is filed under **Phase B (Combat)** even though it performs a simple rotation. It is needed early by `Attack`, `Move`, and aircraft landing alignment, and placing it in Phase B keeps Phase A focused on path-following infrastructure while unblocking combat activities.
> - `MoveToDock.cs` is filed under **Phase D (Economic)** even though it moves the actor. It is a specialized docking-alignment wrapper that depends on `Move` (Phase A) and on `DockClientManager`/`IDockHost` from Chapters 10–11, so it naturally belongs with the harvest/dock/resupply cluster.

### 5.2 External Dependencies (To Other Chapters) — ALL COMPLETE

| Activity | Depends On | Chapter | Status |
|----------|-----------|---------|--------|
| `Move` | `Mobile`, `PathFinder`, `Map`, `World` | Ch3, Ch4, Ch9 | COMPLETE |
| `Move` | `BlockedByActor`, `WPos`, `WAngle`, `WRot`, `WDist`, `CPos`, `SubCell` | Ch3, Ch4 | COMPLETE |
| `Attack` | `AttackFrontal`, `Armament`, `AutoTarget`, `RevealsShroud` | Ch8 | COMPLETE |
| `Attack` | `IMove`, `Mobile`, `IFacing`, `IPositionable` | Ch3, Ch9 | COMPLETE |
| `FlyAttack` | `Aircraft`, `AttackAircraft`, `Rearmable` | Ch8, Ch9 | COMPLETE |
| `Fly` | `Aircraft`, `Map` | Ch8, Ch4 | COMPLETE |
| `Land` | `Aircraft`, `Map`, `INotifyLanding` | Ch8, Ch4 | COMPLETE |
| `ReturnToBase` | `Aircraft`, `Reservable`, `RepairableInfo`, `Rearmable` | Ch8, Ch9, Ch11 | COMPLETE |
| `FindAndDeliverResources` | `Harvester`, `ResourceClaimLayer`, `DockClientManager` | Ch10, Ch11 | COMPLETE |
| `HarvestResource` | `Harvester`, `IResourceLayer`, `ResourceClaimLayer` | Ch10, Ch4 | COMPLETE |
| `Resupply` | `RepairsUnits`, `Repairable`, `Rearmable`, `PlayerResources` | Ch8, Ch10, Ch11 | COMPLETE |
| `GenericDockSequence` | `DockClientManager`, `IDockHost`, `WithDockingOverlay` | Ch10, Ch11 | COMPLETE |
| `CaptureActor` | `CaptureManager`, `Captures`, `IHealth` | Ch8 | COMPLETE |
| `Demolish` | `IDemolishable`, `FlashTarget` | Ch8, Ch7 | COMPLETE |
| `Sell` | `SellableInfo`, `PlayerResources`, `FloatingText` | Ch10, Ch7 | COMPLETE |
| `Transform` | `Transforms`, `WithMakeAnimation`, `INotifyTransform` | Ch3, Ch7 | COMPLETE |
| `LayMines` | `Minelayer`, `AmmoPool`, `RearmableInfo` | Ch8 | COMPLETE |
| `Enter` | `IMove`, `Target`, `MoveCooldownHelper` | Ch3, Ch14 | COMPLETE |
| `PickupUnit` | `Carryall`, `Carryable`, `BodyOrientation` | Ch9, Ch3 | COMPLETE |
| `UnloadCargo` | `Cargo`, `Passenger`, `Aircraft`, `Mobile` | Ch9, Ch3 | COMPLETE |
| `Parachute` | `IPositionable`, `ParachutableInfo` | Ch3, Ch9 | COMPLETE |
| `Hunt` | `AttackBase`, `Huntable` | Ch8 | COMPLETE |
| `AttackMoveActivity` | `AutoTarget`, `AttackMove` | Ch8 | COMPLETE |
| `Nudge` | `IMove`, `Mobile`, `Aircraft` | Ch9, Ch8 | COMPLETE |
| `Follow` | `IMove`, `MoveCooldownHelper` | Ch9, Ch14 | COMPLETE |
| `LocalMoveIntoTarget` | `Mobile`, `Target` | Ch9, Ch3 | COMPLETE |
| `MoveToDock` | `DockClientManager`, `IDockHost` | Ch10, Ch11 | COMPLETE |
| `DeliverUnit` | `Carryall`, `IPositionable`, `IFacing` | Ch9, Ch3 | COMPLETE |
| `RepairBridge` | `BridgeHut`, `LegacyBridgeHut` | Ch4 | COMPLETE |
| `InstantRepair` | `InstantlyRepairsInfo`, `IHealth` | Ch8 | COMPLETE |
| `DonateCash` | `PlayerResources`, `PlayerExperience` | Ch10 | COMPLETE |
| `DonateExperience` | `GainsExperience`, `PlayerExperience` | Ch10 | COMPLETE |
| `DeployForGrantedCondition` | `GrantConditionOnDeploy`, `IFacingInfo` | Ch3 | COMPLETE |
| `FallToEarth` | `Aircraft`, `FallsToEarthInfo` | Ch8 | COMPLETE |
| `DeliverBulkOrder` | `Cargo`, `ProductionBulkAirdrop`, `BulkProductionQueue` | Ch10, Ch11 | COMPLETE |
| `SimpleTeleport` | `IPositionable` | Ch3 | COMPLETE |
| `RemoveSelf` | (none — just Activity base) | Ch3 | COMPLETE |
| `Wait` | (none — just Activity base) | Ch3 | COMPLETE |
| `Turn` | `IFacing`, `Mobile` | Ch3, Ch9 | COMPLETE |
| `Drag` | `IPositionable`, `IDisabledTrait`, `IMove` | Ch3, Ch9 | COMPLETE |
| `MoveCooldownHelper` | `World`, `Mobile` | Ch3, Ch9 | COMPLETE |

### 5.3 Dependency Summary

**ALL external dependencies are COMPLETE.** This is a critical finding: Chapter 14 has **zero blocking dependencies** on un-migrated chapters. Every trait, interface, and utility class that activities reference has already been migrated in Chapters 2-13.

This makes Chapter 14 **immediately actionable** in its entirety. The only internal ordering constraint is the class hierarchy within the chapter itself (e.g., `MoveOnto` extends `MoveAdjacentTo`, so `MoveAdjacentTo` must be migrated first).

---

## 6. Critical Path and Parallelization

### 6.1 Critical Path (Must Be Done First)

The following files are on the **critical path** — everything else depends on them:

1. **`Activity.ts`** (base class) — Already migrated in Ch3 ✅
2. **`CallFunc.ts`** — Already migrated in Ch3 ✅
3. **`Wait.ts`** — Simplest activity, used everywhere as a child
4. **`Turn.ts`** — Used by Move, Fly, Land, Transform, Deploy
5. **`Move.ts`** — The most complex and most referenced activity
6. **`Fly.ts`** — Core flight physics, referenced by all aircraft activities
7. **`Enter.ts`** — Abstract base for 7 enter-type activities

**Critical path length**: 7 files (5 already done or trivial, 2 complex: Move + Fly).

### 6.2 Parallelization Opportunities

Once the critical path is complete, the remaining files can be assigned in **parallel batches**:

**Batch 1 (Movement, no dependencies beyond critical path):**
- `MoveAdjacentTo`, `MoveOnto`, `MoveOntoAndTurn`, `MoveWithinRange`, `Drag`, `LocalMoveIntoTarget`, `Nudge`, `Follow`, `MoveCooldownHelper`

**Batch 2 (Combat, depends on Batch 1 movement):**
- `Attack`, `Hunt`, `AttackMoveActivity`, `Demolish`, `CaptureActor`

**Batch 3 (Aircraft, depends on Fly):**
- `FlyForward`, `FlyIdle`, `FlyOffMap`, `FlyFollow`, `TakeOff`, `FallToEarth`, `ReturnToBase`, `Land`, `FlyAttack`, `DeliverBulkOrder`

**Batch 4 (Economic, depends on Batch 1 movement + Batch 3 aircraft):**
- `FindAndDeliverResources`, `HarvestResource`, `MoveToDock`, `GenericDockSequence`, `Resupply`, `Sell`, `LayMines`

**Batch 5 (Transport, depends on Batch 1 + Batch 3):**
- `Enter` (already on critical path), `RideTransport`, `UnloadCargo`, `PickupUnit`, `DeliverUnit`, `Parachute`, `SimpleTeleport`

**Batch 6 (Utility, mostly independent):**
- `Transform`, `RemoveSelf`, `DeployForGrantedCondition`, `DonateCash`, `DonateExperience`, `RepairBridge`, `InstantRepair`

### 6.3 Recommended Phase Assignment

| Phase | Files | Estimated Tests | Estimated TS Lines | Assignee Strategy |
|-------|------:|----------------:|-------------------:|-------------------|
| A | 11 movement + CallFunc (already migrated) | ~200 | ~3,000 | Single developer, sequential (high internal deps) |
| B | 5 combat | ~80 | ~900 | Single developer, after Phase A |
| C | 12 aircraft | ~150 | ~2,500 | Single developer, after Phase A (needs Fly) |
| D | 7 economic | ~120 | ~1,800 | Single developer, after Phase A + C |
| E | 6 transport | ~100 | ~1,200 | Single developer, after Phase A + C |
| F | 8 utility + Activity base (already migrated) | ~60 | ~1,200 | Single developer, after Phase A |

**Total estimated**: ~49 concrete files, ~710 tests, ~10,600 TS lines.

---

## 7. Risks and Considerations

### Risk 1: Move Activity Complexity (Severity: HIGH)

**Description**: `Move.cs` is 640 lines of C# with deeply nested logic for pathfinding, blocking, nudging, waiting, repathing, backward movement, terrain orientation, and arc interpolation. It contains 3 nested classes (`MovePart`, `MoveFirstHalf`, `MoveSecondHalf`) with complex physics.

**Mitigation**:
- Break `Move.ts` into 4 files: `Move.ts`, `MovePart.ts`, `MoveFirstHalf.ts`, `MoveSecondHalf.ts`
- Write extensive unit tests for `PopPath()` edge cases (blocked cells, nudging, repathing)
- Create an acceptance test page showing unit movement over ramps and around blockers
- Defer arc interpolation to a follow-up PR if it blocks progress

**Impact if unmitigated**: Phase A stalls, blocking all subsequent phases.

### Risk 2: Aircraft Physics Fidelity (Severity: HIGH)

**Description**: The `Fly.FlyTick()` static method is the core flight physics engine. It handles facing, roll, pitch, altitude, turn deadzone, turn radius, and sliding. Getting this wrong produces visibly wrong aircraft behavior.

**Mitigation**:
- Extract `FlyTick` into a standalone `AircraftPhysics.ts` utility module
- Unit test each physics component independently (facing, roll, pitch, altitude)
- Create acceptance test pages for: hover aircraft, fixed-wing aircraft, VTOL takeoff/landing
- Use Babylon.js `TransformNode` rotation properties directly instead of manual quaternion math where possible

**Impact if unmitigated**: Aircraft appear to fly sideways, fail to land, or spin uncontrollably.

### Risk 3: Target Line Rendering in 3D (Severity: MEDIUM)

**Description**: Target lines in 2D OpenRA are drawn as colored lines with optional sprite tiles. In 3D, lines must be drawn in world space with proper depth testing, and tile markers must be billboarded to face the camera.

**Mitigation**:
- Use `MeshBuilder.CreateLines` for solid lines, custom `LinesMesh` for dashed
- Use `BillboardMode` for tile markers (minefield indicators)
- Implement target line rendering as a separate `TargetLineRenderer` system (not in activities)
- Activities only provide `TargetLineNode[]` data; rendering is handled by WorldRenderer

**Impact if unmitigated**: Target lines clip through terrain, are invisible from certain angles, or hurt performance.

### Risk 4: Enter Activity State Machine Edge Cases (Severity: MEDIUM)

**Description**: The `Enter` abstract class has a 4-state state machine (`Approaching → Entering → Exiting → Finished`) with complex cancellation semantics. Subclasses override `TryStartEnter()`, `OnEnterComplete()`, and `TickInner()`. Getting the state transitions wrong causes actors to get stuck mid-enter.

**Mitigation**:
- Create a state transition diagram and unit test every transition
- Test cancellation at every state boundary
- Test actor death during each state
- Use a formal state machine pattern (not ad-hoc switch statements) in the TypeScript implementation

**Impact if unmitigated**: Engineers get stuck entering buildings, transports fail to load/unload, capture attempts hang.

### Risk 5: Activity Reuse Bug (Severity: MEDIUM)

**Description**: OpenRA's Activity.cs comments explicitly warn: "Do not 'reuse' activity objects that have already started running. Queue a new instance instead." This is a common source of bugs in the original C# codebase.

**Mitigation**:
- Add runtime assertions in `queue()` and `queueChild()` that check `state !== Done`
- Document this constraint prominently in the TypeScript Activity base class
- Unit test that reusing a completed activity throws an error
- Consider making activities immutable after first tick (frozen state)

**Impact if unmitigated**: Subtle bugs where completed activities are re-queued, causing actors to behave unpredictably.

### Risk 6: Cross-Trait Activity Construction (Severity: LOW)

**Description**: Many activities construct other activities via trait methods (e.g., `mobile.MoveTo()`, `aircraft.MoveWithinRange()`). These methods are defined on traits, not activities, creating a circular dependency risk.

**Mitigation**:
- Ensure trait `MoveTo()` methods return `new Move(...)` (already the pattern in C#)
- Keep activity construction in activity files, not trait files
- Use factory functions where direct construction would create circular imports

**Impact if unmitigated**: Circular import errors at build time.

### Performance Targets

| System | Target | Measurement |
|--------|--------|-------------|
| `Move.Tick()` single unit | <0.05ms | Per-tick path step |
| `ActivityRunner` tick all activities | <0.5ms | 200 actors with active activities |
| Target line render (50 selected units) | <1ms | LinesMesh update |
| Aircraft `Fly.Tick()` | <0.05ms | Per aircraft |
| Harvester full cycle (harvest→dock→return) | <2ms total | Across all activity transitions |

---

## 8. Appendix: Architecture Decisions Record (ADR)

### ADR-14.1: Activity File Organization — Mirror OpenRA Directory Structure

**Context**: OpenRA organizes activities under `OpenRA.Mods.Common/Activities/` with subdirectories `Move/` and `Air/`. The TypeScript `src/` directory must mirror this.

**Decision**: Create `src/OpenRA.Mods.Common/Activities/` with `Move/` and `Air/` subdirectories. All activity files go here, including those that extend `Enter` (which lives in the root `Activities/` directory).

**Alternatives Considered**:
- Flatten all activities into a single directory: Rejected — loses the logical grouping that OpenRA uses.
- Create additional subdirectories (Combat/, Economic/, Transport/): Rejected — adds divergence from OpenRA structure.

**Consequences**: Directory structure is familiar to OpenRA developers. Import paths are slightly longer but consistent.

### ADR-14.2: Target Line Rendering — Separate Renderer System

**Context**: Activities define `targetLineNodes()` which returns data about what lines to draw. The actual rendering must happen in 3D.

**Decision**: Activities remain **pure data providers** — they return `TargetLineNode[]`. A separate `TargetLineRenderer` class (in the rendering layer, Ch2) consumes this data and creates/updates Babylon.js `LinesMesh` instances. Activities do NOT create GPU resources.

**Alternatives Considered**:
- Activities create `LinesMesh` directly: Rejected — violates separation of concerns; activities should not know about rendering.
- Activities emit events that the renderer listens to: Rejected — adds indirection; direct method call is simpler.

**Consequences**: Activities stay testable without WebGL. Target line rendering can be optimized independently (batching, LOD, culling).

### ADR-14.3: Move Activity Decomposition — Keep Nested Classes in Same File

**Context**: `Move.cs` contains `MovePart` (abstract), `MoveFirstHalf`, and `MoveSecondHalf` as nested classes. These are substantial helper classes with complex physics.

**Decision**: Keep the nested classes as **private helper classes within `Move.ts`**. Do not split them into separate files. This matches the existing project convention (e.g., `Wait` / `WaitFor` in the same file) and keeps the file inventory aligned with OpenRA.

**Alternatives Considered**:
- Split into separate files (`MovePart.ts`, `MoveFirstHalf.ts`, `MoveSecondHalf.ts`): Rejected — increases file count and import complexity without clear benefit; helpers are only used by `Move`.
- Flatten all logic into `Move.ts`: Rejected — `Move.ts` would become unwieldy; helpers keep concerns separated.

**Consequences**: `Move.ts` remains the single source of truth for movement. Helper classes are testable via internal module tests or by testing `Move` behavior.

### ADR-14.4: Fly.FlyTick — Extract to AircraftPhysics Utility Module

**Context**: `Fly.cs` contains `FlyTick()` and `VerticalTakeOffOrLandTick()` as static methods. These are called by 8+ other aircraft activities. The physics logic is complex and should be testable independently.

**Decision**: Extract `FlyTick()` and `VerticalTakeOffOrLandTick()` into a standalone `AircraftPhysics.ts` utility module under `src/OpenRA.Mods.Common/Activities/Air/`. The `Fly` activity imports and calls these functions, as do all other aircraft activities.

**Alternatives Considered**:
- Keep as static methods on `Fly` class: Rejected — creates import dependency from `TakeOff` to `Fly` even though `TakeOff` doesn't logically extend `Fly`.
- Make instance methods: Rejected — no instance state needed; pure physics functions.

**Consequences**: Cleaner dependency graph. `AircraftPhysics` can be unit tested with mock `Aircraft` traits. Other activities import physics without importing the full `Fly` activity.

### ADR-14.5: Enter State Machine — Use Explicit State Pattern

**Context**: The `Enter` abstract class uses an enum (`EnterState`) and a `switch` statement in `Tick()`. Subclasses override virtual methods that are called from specific states.

**Decision**: In TypeScript, use a **discriminated union** with explicit state handlers:

```typescript
type EnterState =
  | { type: 'Approaching' }
  | { type: 'Entering' }
  | { type: 'Exiting' }
  | { type: 'Finished' }
```

Each state transition is explicit. The `Tick()` method delegates to a state-specific handler. This is more verbose than a switch statement but prevents invalid state transitions and makes the state machine testable.

**Alternatives Considered**:
- Keep C# enum + switch pattern: Rejected — TypeScript's type system can enforce valid transitions with discriminated unions.
- Use a full state machine library: Rejected — overkill for a 4-state machine; adds dependency.

**Consequences**: More boilerplate in `Enter.ts` but safer state transitions. Invalid transitions are caught at compile time. Unit tests can verify each state handler independently.

---

## 7. Migration Order and Phasing Strategy

| Week | Phase | Files | Focus | Dependencies |
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

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-06-15 | 1.0 | Initial analysis — complete file inventory, dependency graph, phase assignment, 5 ADRs, 6 risks |
| 2026-06-15 | 1.1 | Review fixes: corrected line counts to match `wc -l`, reconciled file totals, clarified nested-class policy, added Migration Order section |

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits) -- Architecture analysis
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Format template for migration plans
> - `docs/chapter9_movement_physics_migration_plan.md` -- Movement/physics foundation
> - `docs/chapter10_resource_economy_migration_plan.md` -- Economy trait dependencies
> - `docs/chapter11_production_building_migration_plan.md` -- Production/cargo dependencies
> - `docs/remaining_systems_migration_plan.md` -- Original Chapter 14 skeleton (scope updated)
> - `src/OpenRA.Game/Activities/Activity.ts` -- Already-migrated base class
