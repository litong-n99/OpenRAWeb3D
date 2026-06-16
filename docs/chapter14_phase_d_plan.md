# OpenRA to Babylon.js Migration Plan: Chapter 14 Phase D -- Economic Activities

> **Source Reference**: `OpenRA/OpenRA.Mods.Common/Activities/FindAndDeliverResources.cs`, `HarvestResource.cs`, `MoveToDock.cs`, `GenericDockSequence.cs`, `Resupply.cs`, `Sell.cs`, `LayMines.cs`
> **Phase Status**: **COMPLETE (7/7 migrated, 161 tests passing)**
> **Completed Date**: 2026-06-16
> **Planning Date**: 2026-06-16
> **Prerequisite**: Chapter 14 Phase A+B+C COMPLETE (29/49 files), Chapter 10 (Resource & Economy) COMPLETE, Chapter 11 (Production & Building) COMPLETE
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overview and Scope](#1-overview-and-scope)
2. [Dependency Analysis](#2-dependency-analysis)
3. [Implementation Order](#3-implementation-order)
4. [File-by-File Plan](#4-file-by-file-plan)
5. [Key Paradigm Shifts](#5-key-paradigm-shifts)
6. [Shared Helpers / Stubs Needed](#6-shared-helpers--stubs-needed)
7. [Test Strategy](#7-test-strategy)
8. [Acceptance Test Recommendations](#8-acceptance-test-recommendations)
9. [Risk Register](#9-risk-register)

---

## 1. Overview and Scope

Phase D migrates 7 economic activity files from OpenRA C# to TypeScript. These activities drive the resource loop (harvesting, delivery), building interactions (docking, resupply), and actor lifecycle (sell, mine laying). All files depend on the Chapter 10 economy traits (`Harvester`, `ResourceLayer`, `DockClientBase`, `Refinery`) and the Chapter 11 building traits (`Building`, `DockClientManager`), plus the Chapter 14 Phase A movement activities (`Move`, `MoveAdjacentTo`, `MoveToDock`) and Phase C aircraft activities (`ReturnToBase` which queues `Resupply`).

### 1.1 Files in Scope

| # | OpenRA Source | Target TypeScript File | Class | Lines (C#) | Complexity | Dependencies |
|:---:|:---|:---|:---|:---:|:---:|:---|
| 1 | `OpenRA.Mods.Common/Activities/Resupply.cs` | `src/OpenRA.Mods.Common/Activities/Resupply.ts` | `Resupply` (replaces stub) | 327 | **HIGH** | Activity, IHealth, Repairable, RepairableNear, Rearmable, RepairsUnits, PlayerResources, IMove, Aircraft, RallyPoint, AttackMoveActivity, TakeOff, MoveToDock, MoveAdjacentTo, MoveWithinRange, MoveToTarget |
| 2 | `OpenRA.Mods.Common/Activities/FindAndDeliverResources.cs` | `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.ts` | `FindAndDeliverResources` | 263 | **HIGH** | Activity, Harvester, ResourceClaimLayer, Mobile, MoveToDock, HarvestResource, Wait, MoveCooldownHelper, PathFinder, IDockHost |
| 3 | `OpenRA.Mods.Common/Activities/GenericDockSequence.cs` | `src/OpenRA.Mods.Common/Activities/GenericDockSequence.ts` | `GenericDockSequence` | 216 | **HIGH** | Activity, DockClientManager, IDockHost, IDockClientBody, WithDockingOverlay, Drag, Wait, INotifyDockClient, INotifyDockHost |
| 4 | `OpenRA.Mods.Common/Activities/MoveToDock.cs` | `src/OpenRA.Mods.Common/Activities/MoveToDock.ts` | `MoveToDock` | 150 | MEDIUM | Activity, DockClientManager, IDockHost, IMove, Mobile, MoveCooldownHelper, Wait, INotifyDockClientMoving |
| 5 | `OpenRA.Mods.Common/Activities/HarvestResource.cs` | `src/OpenRA.Mods.Common/Activities/HarvestResource.ts` | `HarvestResource` | 124 | MEDIUM | Activity, Harvester, IFacing, BodyOrientation, ResourceClaimLayer, IResourceLayer, IMove, Mobile, Turn, Wait, MoveCooldownHelper, INotifyHarvestAction |
| 6 | `OpenRA.Mods.Common/Activities/LayMines.cs` | `src/OpenRA.Mods.Common/Activities/LayMines.ts` | `LayMines` | 237 | MEDIUM | Activity, Minelayer, AmmoPool, IMove, Mobile, MoveToDock, MoveAdjacentTo, Resupply, MoveCooldownHelper, INotifyMineLaying, ICallForTransport, IPositionable |
| 7 | `OpenRA.Mods.Common/Activities/Sell.cs` | `src/OpenRA.Mods.Common/Activities/Sell.ts` | `Sell` | 58 | LOW | Activity, IHealth, SellableInfo, PlayerResources, INotifySold, FloatingText |

### 1.2 Summary Statistics

| Metric | Count |
|--------|-------|
| Total files | 7 |
| Total C# source lines | ~1,375 |
| Estimated TypeScript lines | ~3,300 |
| Estimated test files | 5 |
| Estimated tests | ~120 |
| Estimated test lines | ~2,000 |
| HIGH complexity | 3 files (`Resupply`, `FindAndDeliverResources`, `GenericDockSequence`) |
| MEDIUM complexity | 3 files (`MoveToDock`, `HarvestResource`, `LayMines`) |
| LOW complexity | 1 file (`Sell`) |

---

## 2. Dependency Analysis

### 2.1 External Dependencies (Already Migrated)

| Dependency | Source Chapter | Status | Key APIs Used |
|:---|:---|:---|:---|
| `Activity` base class | Ch3 Phase F | COMPLETE | `tick()`, `queueChild()`, `cancel()`, `onFirstRun()`, `onLastRun()`, `childHasPriority`, `isCanceling`, `TargetLineNode` |
| `Move` activity | Ch14 Phase A | COMPLETE | `Move` class, `MoveResult` |
| `MoveAdjacentTo` | Ch14 Phase A | COMPLETE | `MoveAdjacentTo` class |
| `MoveWithinRange` | Ch14 Phase A | COMPLETE | `MoveWithinRange` class |
| `MoveToTarget` | Ch14 Phase A | COMPLETE | `MoveToTarget` via `IMove.moveToTarget()` |
| `Turn` activity | Ch14 Phase B | COMPLETE | `Turn` class |
| `AttackMoveActivity` | Ch14 Phase A | COMPLETE | `AttackMoveActivity` class |
| `TakeOff` activity | Ch14 Phase C | COMPLETE | `TakeOff` class |
| `Drag` activity | Ch14 Phase A | COMPLETE | `Drag` class |
| `Wait` activity | Ch14 Phase C stub | PARTIAL | `Wait` stub exists (counts down ticks) |
| `RemoveSelf` activity | Ch14 Phase F stub | PARTIAL | `RemoveSelf` stub exists |
| `Harvester` trait | Ch10 Phase A | COMPLETE | `isFull`, `isEmpty`, `canHarvestCell()`, `addResource()`, `info` (baleLoadDelay, baleUnloadDelay, harvestFacings, searchFromHarvesterRadius, searchFromProcRadius, waitDuration, resourceRefineryDirectionPenalty, queueFullLoad, unblockCell, harvestLineColor) |
| `DockClientBase` / `HarvesterInfo` | Ch10 Phase A | COMPLETE | `DockClientBaseInfo`, `canDock()`, `canDockAt()`, `onDockStarted()`, `onDockTick()`, `onDockCompleted()` |
| `Refinery` trait | Ch10 Phase A | COMPLETE | `IAcceptResources`, `IDockHost` (directly implemented by Refinery) |
| `ResourceLayer` | Ch10 Phase A | COMPLETE | `getResource()`, `removeResource()`, `addResource()`, `canAddResource()` |
| `ResourceClaimLayer` | Ch10 Phase A | COMPLETE | `tryClaimCell()`, `removeClaim()`, `canClaimCell()` |
| `Mobile` trait | Ch9 Phase A | COMPLETE | `moveTo()`, `moveResult`, `nearestMoveableCell()`, `pathFinder` |
| `IResourceLayer` interface | Ch10 Phase A | COMPLETE | `getResource()`, `removeResource()` |
| `IHealth` interface | Ch3 Phase B | COMPLETE | `hp`, `maxHP`, `damageState`, `inflictDamage()` |
| `IFacing` interface | Ch3 Phase B | COMPLETE | `facing`, `turnSpeed` |
| `WPos` / `WVec` / `WDist` / `WAngle` | Ch3 Phase A | COMPLETE | All math operations |
| `CPos` / `CVec` | Ch3 Phase A | COMPLETE | Cell coordinates, `CVec.Directions` |
| `Target` | Ch3 Phase A | COMPLETE | `fromCell()`, `fromActor()`, `fromPos()`, `isInRange()`, `centerPosition` |
| `Map` | Ch4 | COMPLETE | `contains()`, `cellContaining()`, `centerOfCell()` |
| `PathFinder` | Ch4 Phase G | COMPLETE | `findPathToTargetCellByPredicate()` |
| `MoveCooldownHelper` | Ch14 Phase A | COMPLETE | `tick()`, `notifyMoveQueued()`, `retryIfDestinationBlocked` |
| `Sound` | Ch7 Phase D | COMPLETE | `playNotification()` |
| `PlayerResources` | Ch10 Phase B | COMPLETE | `changeCash()`, `takeCash()` |
| `Sellable` / `SellableInfo` | Ch10 Phase B | COMPLETE | `refundPercent`, `notification` |
| `AmmoPool` | Ch8 Phase D | COMPLETE | `currentAmmoCount`, `hasAmmo`, `takeAmmo()`, `info.name` |
| `DamageState` enum | Ch3 Phase B | COMPLETE | `Undamaged`, `Light`, `Medium`, `Heavy`, `Critical`, `Dead` |
| `CoordinateTransformer` | Ch4 Phase I | COMPLETE | `wPosToVector3()` |

### 2.2 Internal Dependencies (Within Phase D)

```
Resupply (most complex, depends on many traits)
  |
  +--> MoveToDock (queues MoveToDock as child for ground units)
  +--> GenericDockSequence (indirectly, via DockClientManager)
  +--> TakeOff (queues TakeOff for aircraft after resupply)
  +--> AttackMoveActivity (queues AttackMoveActivity for rally point path)
  +--> MoveAdjacentTo, MoveWithinRange, MoveToTarget (approach host)

FindAndDeliverResources (orchestrates the full harvest cycle)
  |
  +--> MoveToDock (delivers resources to refinery)
  +--> HarvestResource (harvests at a specific cell)
  +--> Wait (waits between searches when no resources found)
  +--> Move (via Mobile.moveTo / MoveCooldownHelper)

GenericDockSequence (base class for docking animations)
  |
  +--> Drag (drags actor into dock position)
  +--> Wait (waits for overlay animations)
  +--> INotifyDockClient / INotifyDockHost (notification interfaces)

MoveToDock (approaches and aligns at dock)
  |
  +--> Wait (waits when no dock available or dock occupied)
  +--> IMove (queues move activities via DockHost)

HarvestResource (harvests one cell)
  |
  +--> Turn (turns to harvest facing)
  +--> Wait (waits between bale loads)
  +--> IMove (moves to target cell if not there yet)

LayMines (places mines in a pattern)
  |
  +--> MoveAdjacentTo (approaches rearm building)
  +--> Resupply (rearms at building)
  +--> IMove (moves to next mine cell)
  +--> Wait (pre-lay and after-lay delays)

Sell (simple, no internal dependencies)
```

### 2.3 Missing Dependencies (Need Stubs or Deferred)

| Dependency | Status | Action |
|:---|:---|:---|
| `DockClientManager` | Ch10 stub | **VERIFY**: Check if `DockClientManager` trait exists in migrated codebase. If not, create minimal stub with `reservedHost`, `closestDock()`, `reserveHost()`, `unreserveHost()`, `availableDockHosts()`, `dockLineColor`, `lastReservedHost`, `searchForDockDelay`. |
| `IDockHost` | Ch10 (Refinery implements) | **REUSE**: `Refinery` directly implements `IDockHost`. Verify all methods used by activities exist (`dockPosition`, `getDockType`, `isDockingPossible()`, `queueMoveActivity()`, `queueDockActivity()`, `onDockStarted()`, `onDockCompleted()`, `canDockAt()`). |
| `IDockClientBody` | Not migrated | **STUB**: `GenericDockSequence` uses `self.TraitOrDefault<IDockClientBody>()`. Create minimal interface with `playDockAnimation()` and `playReverseDockAnimation()` methods. |
| `WithDockingOverlay` | Not migrated | **STUB**: `GenericDockSequence` uses `hostActor.TraitOrDefault<WithDockingOverlay>()`. Create minimal interface with `visible`, `info.sequence`, `withOffset.animation.playThen()`, `withOffset.animation.playBackwardsThen()`. |
| `INotifyDockClient` | Not migrated | **STUB**: Used by `GenericDockSequence`, `Resupply`, `MoveToDock`. Create minimal interface with `docked()` and `undocked()` methods. |
| `INotifyDockHost` | Not migrated | **STUB**: Used by `GenericDockSequence`, `Resupply`. Create minimal interface with `docked()` and `undocked()` methods. |
| `INotifyDockClientMoving` | Partial (CarryableHarvester.ts) | **REUSE/EXTEND**: `INotifyDockClientMoving` exists in `CarryableHarvester.ts` but uses `IDockHostStub`. Update to use real `IDockHost` interface when migrating. |
| `INotifyHarvestAction` | Partial (CarryableHarvester.ts) | **REUSE/EXTEND**: `INotifyHarvestAction` exists in `CarryableHarvester.ts` with `movingToResources()`. Extend with `harvested()` and `movementCancelled()` methods for `HarvestResource`. |
| `INotifyResupply` | Not migrated | **STUB**: Used by `Resupply`. Create minimal interface with `beforeResupply()`, `resupplyTick()` methods. |
| `INotifyMineLaying` | Not migrated | **STUB**: Used by `LayMines`. Create minimal interface with `mineLaying()`, `mineLayingCanceled()`, `mineLaid()` methods. |
| `INotifySold` | Not migrated | **STUB**: Used by `Sell`. Create minimal interface with `sold()` method. |
| `RepairsUnits` | Not migrated | **STUB**: Used by `Resupply`. Create minimal interface with `isTraitDisabled`, `isTraitPaused`, `info` (hpPerStep, valuePercentage, interval, repairDamageTypes, startRepairingNotification, finishRepairingNotification, startRepairingTextNotification, finishRepairingTextNotification, playerExperience). |
| `Repairable` | Not migrated | **STUB**: Used by `Resupply`. Create minimal interface with `info` (repairActors, hpPerStep). |
| `RepairableNear` | Not migrated | **STUB**: Used by `Resupply`. Create minimal interface with `info` (repairActors). |
| `Rearmable` | Not migrated | **STUB**: Used by `Resupply`, `LayMines`. Create minimal interface with `info` (rearmActors), `rearmTick()`, `rearmableAmmoPools`, `hasFullAmmo`. |
| `RallyPoint` | Not migrated | **STUB**: Used by `Resupply`. Create minimal interface with `path` (CPos array). |
| `Minelayer` | Not migrated | **STUB**: Used by `LayMines`. Create minimal interface with `info` (mine, ammoPoolName, ammoUsage, preLayDelay, afterLayingDelay, targetLineColor, tile). |
| `BodyOrientation` | Not migrated | **STUB**: Used by `HarvestResource`. Create minimal interface with `quantizeFacing()`. |
| `FloatingText` | Not migrated | **STUB**: Used by `Sell`. Create minimal interface / class for floating text effect. Can be deferred to visual effects chapter. |
| `TextNotificationsManager` | Not migrated | **STUB**: Used by `Resupply`, `Sell`. Create minimal stub class with `addTransientLine()` static method. |
| `PlayerExperience` | Not migrated | **STUB**: Used by `Resupply`. Create minimal interface with `giveExperience()` method. |
| `ResupplyType` enum | Not migrated | **NEW**: Create enum `{ None = 0, Repair = 1, Rearm = 2 }` used by `Resupply`. |
| `ICallForTransport` | Partial (CarryableHarvester.ts) | **REUSE**: Already exists in `CarryableHarvester.ts`. Used by `Resupply` and `LayMines`. |
| `ValuedInfo` | Not migrated | **STUB**: Used by `Resupply` for unit cost. Create minimal interface with `cost` field. |
| `ActorMap` | Not migrated | **STUB**: Used by `LayMines` (`getActorsAt()`). Create minimal interface with `getActorsAt()` method. |
| `LocationInit`, `OwnerInit`, `ParentActorInit` | Not migrated | **STUB**: Used by `LayMines` for actor creation. Create minimal init classes. |
| `IPositionable` | Ch9 (Mobile implements) | **REUSE**: `Mobile` implements `IPositionable`. Used by `LayMines` for `canEnterCell()`, `canStayInCell()`. |
| `Shroud` | Ch12 | COMPLETE | `isVisible()` method. Used by `LayMines` for `CleanMineField`. |

---

## 3. Implementation Order

### 3.1 Recommended Batch Order

**Batch 1: Core Infrastructure (3 files)**
1. `MoveToDock.ts` -- Foundation for all docking. Simplest docking activity; queues move and wait children. Other economic activities depend on it.
2. `GenericDockSequence.ts` -- Base class for docking animations. Depends on MoveToDock (indirectly via DockClientManager). Complex state machine but self-contained.
3. `Resupply.ts` -- Replaces existing stub. Most complex; depends on MoveToDock, GenericDockSequence (indirectly), and many traits. Must be done after MoveToDock and GenericDockSequence because it queues docking-related children.

**Batch 2: Resource Loop (2 files)**
4. `HarvestResource.ts` -- Harvests one cell. Medium complexity; depends on ResourceLayer, Harvester, Turn, Wait.
5. `FindAndDeliverResources.ts` -- Orchestrates full harvest cycle. Most complex state machine; depends on HarvestResource, MoveToDock, Wait, PathFinder.

**Batch 3: Specialized (2 files)**
6. `Sell.ts` -- Simple building sale. Low complexity; no dependencies beyond basic traits.
7. `LayMines.ts` -- Mine placement with rearm cycle. Medium complexity; depends on Resupply (Batch 1), MoveAdjacentTo, AmmoPool.

### 3.2 Parallelization

- **Batch 1 must be sequential**: MoveToDock -> GenericDockSequence -> Resupply.
- **Batch 2 can start after Batch 1**: HarvestResource and FindAndDeliverResources need MoveToDock (for delivery) and Wait.
- **Batch 3 can start after Batch 1**: Sell is independent. LayMines needs Resupply (Batch 1) and MoveAdjacentTo (Phase A).
- **Within Batch 1**: `Sell.ts` can be done in parallel with any Batch 1 file since it has no dependencies.
- **Interface stubs**: Can be created in parallel with Batch 1 implementation. Group them into a single `EconomicActivityInterfaces.ts` file.

---

## 4. File-by-File Plan

### 4.1 MoveToDock.ts (MEDIUM complexity, 150 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/MoveToDock.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/MoveToDock.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/MoveToDock.test.ts`

**Key features to migrate**:
- Constructor: `(self, dockHostActor = null, dockHost = null, forceEnter = false, ignoreOccupancy = false, dockLineColor = null)`
- `OnFirstRun`: Resolve dock host from actor if not explicitly provided; validate actor is alive and in world; find closest available dock via `dockClient.availableDockHosts()`.
- `Tick`: Find nearest dock if not specified; reserve host via `dockClient.reserveHost()`; if reservation succeeds, queue move activity via `dockHost.queueMoveActivity()` or `dockHost.queueDockActivity()`; handle cancellation and trait disabled states.
- `Cancel`: Unreserve host, notify `INotifyDockClientMoving` traits.
- `TargetLineNodes`: Render target line to dock host actor.

**Paradigm shifts**:
- C# `DockClientManager` trait resolution -> TypeScript `self.getComponent('DockClientManager')` or duck-typed lookup
- C# `IDockHost` interface methods -> TypeScript interface method calls on `Refinery` (which implements `IDockHost`)
- C# `INotifyDockClientMoving[]` array -> TypeScript `self.getComponents('INotifyDockClientMoving')` or duck-typed array
- C# `Color?` nullable -> TypeScript `ColorStub | null`

**Test strategy**:
- Test dock host resolution from actor in `onFirstRun`
- Test nearest dock search when no dock specified
- Test reservation success path (queues move activity)
- Test reservation failure path (queues Wait with search delay)
- Test cancellation (unreserves host)
- Test trait disabled (cancels activity)
- Test target line rendering

**Things to watch out for**:
- `DockClientManager` may be a stub. Verify `closestDock()`, `reserveHost()`, `unreserveHost()`, `availableDockHosts()` exist.
- `IDockHost.queueMoveActivity()` and `queueDockActivity()` are callbacks that queue child activities on the passed activity instance. The TypeScript version must preserve this pattern.
- The `forceEnter` and `ignoreOccupancy` flags affect dock selection behavior.

---

### 4.2 GenericDockSequence.ts (HIGH complexity, 216 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/GenericDockSequence.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/GenericDockSequence.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/GenericDockSequence.test.ts`

**Key features to migrate**:
- `DockingState` enum: `Wait`, `Drag`, `Dock`, `Loop`, `Undock`, `Complete`
- Constructor: `(self, client, hostActor, host, dockWait, isDragRequired, dragOffset, dragLength)`
- `Tick`: State machine over 6 docking states
  - `Wait`: returns false (waiting for animation)
  - `Drag`: validates host is alive, queues `Drag` child if drag required
  - `Dock`: initiates docking, plays dock animations, notifies `INotifyDockClient`/`INotifyDockHost`
  - `Loop`: ticks dock loop; if cancel or host dead or `onDockTick()` returns true, transition to `Undock`
  - `Undock`: plays undock animations
  - `Complete`: notifies completion, queues reverse `Drag` if required, returns true
- `PlayDockAnimations()`: Virtual method. If `WithDockingOverlay` exists, plays overlay animation then transitions to `Loop`.
- `PlayDockClientAnimation()`: Virtual method. If `IDockClientBody` exists, plays body animation.
- `PlayUndockAnimations()`: Virtual method. Plays overlay animation backwards, then client reverse animation.
- `PlayUndockClientAnimation()`: Virtual method. If `IDockClientBody` exists, plays reverse dock animation.
- `NotifyDocked()` / `NotifyUndocked()`: Calls notification interfaces on both client and host.

**Dependencies**: `DockClientManager`, `IDockHost`, `IDockClientBody` (stub), `WithDockingOverlay` (stub), `Drag`, `Wait`, `INotifyDockClient` (stub), `INotifyDockHost` (stub)

**Paradigm shifts**:
- C# `Action` callback for animation completion -> TypeScript `() => void` callback
- C# `WithDockingOverlay` sprite animation -> TypeScript animation stub (deferred to render traits)
- C# `IDockClientBody` animation callbacks -> TypeScript method stubs
- C# `protected enum DockingState` -> TypeScript string union type or numeric enum

**Test strategy**:
- Test state machine transitions: Drag -> Dock -> Loop -> Undock -> Complete
- Test cancellation during each state
- Test host death during docking (cancels and unreserves)
- Test with and without drag required
- Test notification callbacks (docked/undocked)
- Test `PlayDockAnimations` virtual method (with and without overlay)
- Test `PlayUndockAnimations` virtual method

**Things to watch out for**:
- The `dockInitiated` flag tracks whether docking actually started (for cleanup on cancellation).
- `PlayDockAnimations` is virtual and may be overridden by mod-specific docking sequences (e.g., custom refinery animations).
- The `WithDockingOverlay` trait may not be migrated yet. The code must handle `null` gracefully.
- Animation callbacks (`PlayThen`, `PlayBackwardsThen`) are deferred to render trait chapter. Use callback-based stubs.

---

### 4.3 Resupply.ts (HIGH complexity, 327 C# lines -- REPLACES STUB)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Resupply.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Resupply.ts` (replaces existing stub)
**Test target**: `src/OpenRA.Mods.Common/Activities/Resupply.test.ts`

**Key features to migrate**:
- Constructor: `(self, host, closeEnough, stayOnResupplier = false)`
- `OnFirstRun` (constructor in C#): Resolve `IHealth`, `Repairable`, `RepairableNear`, `Rearmable`, `RepairsUnits`, `PlayerResources`, `IMove`, `Aircraft`, `RallyPoint`, `ICallForTransport`. Determine active resupply types (Repair/Rearm) based on actor state and host capabilities.
- `Tick`: Complex resupply orchestration
  - Canceling with remaining ticks: countdown and return false
  - Host invalidation: cancel, call `onResupplyEnding()`
  - Not close enough (ground units): queue `MoveOntoTarget` or `MoveWithinRange`, request transport if needed
  - Start resupply: notify `INotifyResupply`, `INotifyDockClient`, `INotifyDockHost`
  - Repair tick: deduct cash, apply healing, play notifications
  - Rearm tick: call `rearmable.rearmTick()`, remove rearm flag when complete
  - Completion: call `onResupplyEnding()`, return true
- `Cancel`: Cancel child Move activities with `ignoreTransitOnlyCells` flag, notify transport callers
- `OnResupplyEnding()`: Handle aircraft (take off or yield reservation), ground units (move to rally point or leave host), notify undocked
- `RepairTick()`: Find active `RepairsUnits`, deduct cash per HP, apply damage (negative = heal), play sound notifications
- `TargetLineNodes`: Render target line to host, or delegate to child activities

**Dependencies**: `MoveToDock`, `MoveAdjacentTo`, `MoveWithinRange`, `MoveToTarget`, `AttackMoveActivity`, `TakeOff`, `IHealth`, `Repairable`, `RepairableNear`, `Rearmable`, `RepairsUnits`, `PlayerResources`, `RallyPoint`, `ICallForTransport`, `INotifyResupply`, `INotifyDockClient`, `INotifyDockHost`

**Paradigm shifts**:
- C# `ResupplyType` flags enum -> TypeScript bitmask or Set-based approach
- C# `allRepairsUnits.FirstOrDefault(r => !r.IsTraitDisabled)` -> TypeScript `find()` on array
- C# `Game.Sound.PlayNotification()` -> TypeScript `Sound.playNotification()` (already migrated)
- C# `TextNotificationsManager.AddTransientLine()` -> TypeScript stub (deferred)
- C# `self.InflictDamage()` -> TypeScript `health.inflictDamage()` (note: negative damage = heal)
- C# `aircraft.UnReserve()` -> TypeScript `aircraft.unReserve()`
- C# `aircraft.AllowYieldingReservation()` -> TypeScript `aircraft.allowYieldingReservation()`

**Test strategy**:
- Test constructor: determines correct active resupply types (Repair only, Rearm only, both, neither)
- Test repair tick: HP increases, cash deducted, notifications played
- Test rearm tick: ammo increases, flag cleared when full
- Test host death during resupply: cancels, undocks
- Test aircraft resupply: queues TakeOff after completion
- Test ground unit resupply: moves to rally point or leaves host
- Test cancellation: countdown before releasing, child Move cancellation
- Test `stayOnResupplier` flag: aircraft stays on pad when true
- Test target line rendering

**Things to watch out for**:
- The `wasRepaired` flag forces aircraft take-off after repair (hack for reservable logic limitation).
- `RepairTick` uses `(long)unitCost * repairsUnits.Info.ValuePercentage` to avoid overflow. TypeScript `number` is double-precision so overflow is less likely, but use `BigInt` or careful ordering if exact C# semantics needed.
- The `closeEnough` parameter: negative means no distance limit.
- `repairableNear` changes the approach behavior (uses `MoveWithinRange` instead of `MoveOntoTarget`).
- The `Cancel` method has a HACK: it cancels child `Move` activities with `ignoreTransitOnlyCells = true`.
- `OnResupplyEnding` for ground units: if no next activity, move to rally point; if next activity exists and is not Move, leave host first.

---

### 4.4 HarvestResource.ts (MEDIUM complexity, 124 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/HarvestResource.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/HarvestResource.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/HarvestResource.test.ts`

**Key features to migrate**:
- Constructor: `(self, targetCell)`
- `OnFirstRun`: Claim the target cell via `claimLayer.tryClaimCell()`
- `Tick`: Complex harvest logic
  - If trait disabled: cancel
  - If canceling or full: return true
  - Move cooldown helper tick
  - If not at target cell: move to it, notify `INotifyHarvestAction`
  - If cell not harvestable: return true
  - If harvest facings required: quantize facing and queue `Turn` if needed
  - Get resource from cell, remove one unit, add to harvester cargo
  - Notify `INotifyHarvestAction` of harvest completion
  - Queue `Wait` for bale load delay
- `OnLastRun`: Remove claim from cell
- `Cancel`: Notify `INotifyHarvestAction` of movement cancellation
- `TargetLineNodes`: Render target line to harvest cell

**Dependencies**: `Harvester`, `IFacing`, `BodyOrientation` (stub), `ResourceClaimLayer`, `IResourceLayer`, `IMove`, `Mobile`, `Turn`, `Wait`, `MoveCooldownHelper`, `INotifyHarvestAction`

**Paradigm shifts**:
- C# `body.QuantizeFacing(current, harvestFacings)` -> TypeScript `body.quantizeFacing(current, harvestFacings)` (stub)
- C# `resourceLayer.GetResource()` / `RemoveResource()` -> TypeScript `resourceLayer.getResource()` / `removeResource()`
- C# `harv.AddResource()` -> TypeScript `harvester.addResource()`
- C# `claimLayer.TryClaimCell()` / `RemoveClaim()` -> TypeScript `claimLayer.tryClaimCell()` / `removeClaim()`

**Test strategy**:
- Test `onFirstRun`: claims target cell
- Test movement to target cell: queues `Move` child, returns false
- Test facing adjustment: queues `Turn` child when facing mismatch
- Test successful harvest: removes resource, adds to cargo, queues Wait
- Test cell depleted: returns true (activity complete)
- Test harvester full: returns true
- Test cancellation: removes claim
- Test target line rendering

**Things to watch out for**:
- `harvestFacings = 0` means any facing is acceptable (no Turn needed).
- The claim is made in `onFirstRun` and removed in `onLastRun`. If the activity is cancelled mid-harvest, the claim must be released.
- `resourceLayer.removeResource()` returns the amount removed. In C# it returns 1 if successful, 0 if not. The check `!= 1` means "could not remove exactly one unit".
- `MoveCooldownHelper` is used to prevent excessive pathfinding when the target cell is blocked.

---

### 4.5 FindAndDeliverResources.ts (HIGH complexity, 263 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/FindAndDeliverResources.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.test.ts`

**Key features to migrate**:
- Constructor: `(self, orderLocation = null)`
- `OnFirstRun`: If order location provided and harvester is full, queue `MoveToDock`
- `Tick`: Complex state machine over resource search and delivery
  - If canceling or trait disabled: return true
  - If next activity exists and `queueFullLoad` is false: interrupt after first cell harvested or search failed
  - If next activity exists and `hasDeliveredLoad` or full: interrupt after first cycle
  - If full or (not empty and last search failed): deliver resources via `MoveToDock`
  - If reserved host exists: wait (docking already initiated)
  - If last search failed and not waited: queue `Wait`, set `hasWaited`
  - Find closest harvestable cell via `closestHarvestablePos()`
  - If no cell found: try backup search from refinery; set `LastSearchFailed`
  - If at refinery and empty: unblock refinery entrance
  - If cell found: queue `HarvestResource`, update `lastHarvestedCell`
- `ClosestHarvestablePos()`: Complex pathfinding with cost modifier
  - Check current cell / order location first
  - Determine search origin (lastHarvestedCell -> dock position -> self location)
  - Use `PathFinder.findPathToTargetCellByPredicate()` with predicate checking `canHarvestCell()` and `canClaimCell()`
  - Apply direction penalty: prefer cells toward refinery using cosine rule
- `GetTargets()`: Yield target from current cell
- `TargetLineNodes`: Delegate to child, or render order location / reserved host
- `LastSearchFailed`: Public property (read-only)

**Dependencies**: `Harvester`, `HarvesterInfo`, `Mobile`, `ResourceClaimLayer`, `DockClientManager`, `MoveToDock`, `HarvestResource`, `Wait`, `MoveCooldownHelper`, `PathFinder`, `IDockHost`, `Map`

**Paradigm shifts**:
- C# `PathFinder.FindPathToTargetCellByPredicate()` -> TypeScript `pathFinder.findPathToTargetCellByPredicate()` (verify API exists)
- C# `BlockedByActor.Stationary` -> TypeScript `BlockedByActor.Stationary` (already migrated)
- C# `PathGraph.PathCostForInvalidPath` -> TypeScript constant (likely `Number.MAX_SAFE_INTEGER` or large value)
- C# `yield return` for `GetTargets` and `TargetLineNodes` -> TypeScript array return or generator
- C# `mobile.PathFinder` -> TypeScript `mobile.pathFinder` (verify property exists on Mobile trait)
- C# cosine rule cost modifier -> Same math with TypeScript `WVec` operations

**Test strategy**:
- Test full harvest cycle: Empty -> FindResource -> Harvest -> Full -> MoveToDock -> Deliver -> Empty
- Test `queueFullLoad = false`: interrupts after first cell
- Test `queueFullLoad = true`: continues until full
- Test no resources found: waits, then searches again
- Test refinery selection: delivers to nearest available refinery
- Test `closestHarvestablePos`: pathfinding with predicate, direction penalty
- Test order location: respects explicit harvest order
- Test `LastSearchFailed` flag: set when no resources found
- Test unblocking refinery: moves away when sitting at refinery entrance
- Test target line rendering

**Things to watch out for**:
- The `orderLocation` parameter: if provided, the harvester searches there first. If two consecutive harvest orders, deliver first if full.
- The `hasHarvestedCell` and `hasDeliveredLoad` flags track progress for interruption logic.
- `ClosestHarvestablePos` uses cosine rule for direction penalty: `cosA = 512 * (b^2 + c^2 - a^2) / (b.Length * c.Length)`. This is a fixed-point calculation (512 = 1.0 in fixed-point). The cost modifier varies between 0 and `ResourceRefineryDirectionPenalty`.
- The path predicate checks both `canHarvestCell()` and `canClaimCell()`. The claim is made inside `HarvestResource.onFirstRun`, not here.
- `PathFinder.findPathToTargetCellByPredicate` may not exist in the migrated pathfinder. Verify the exact API name.
- The `moveCooldownHelper` is used to prevent excessive repathing when the destination is blocked.

---

### 4.6 Sell.ts (LOW complexity, 58 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Sell.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Sell.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Sell.test.ts`

**Key features to migrate**:
- Constructor: `(self, showTicks)`
- `Tick`: Non-interruptible activity
  - Calculate sell value based on health percentage and refund percent
  - Add refund to player resources
  - Notify `INotifySold` traits
  - Show floating text if enabled and allied with render player
  - Play sound notification
  - Dispose actor (deferred to frame-end actions)
- `IsInterruptible = false` (set in constructor)

**Dependencies**: `IHealth`, `SellableInfo`, `PlayerResources`, `INotifySold` (stub), `FloatingText` (stub), `Sound`

**Paradigm shifts**:
- C# `self.GetSellValue()` -> TypeScript `self.getSellValue()` or `sellableInfo.cost` (verify method exists)
- C# `self.Dispose()` -> TypeScript `world.queueFrameEndAction(() => world.removeActor(self))`
- C# `FloatingText` effect -> TypeScript stub (deferred to visual effects)
- C# `TextNotificationsManager.AddTransientLine()` -> TypeScript stub

**Test strategy**:
- Test sell value calculation: full health = full refund, damaged = proportional
- Test refund added to player resources
- Test `INotifySold` notification
- Test floating text shown when allied
- Test sound notification played
- Test actor disposal deferred
- Test non-interruptible: cancel ignored

**Things to watch out for**:
- `IsInterruptible = false` means the sell cannot be cancelled once started.
- The refund calculation: `(int)(sellValue * refundPercent * hp / (100 * maxHP))`. Note the cast to `int` truncates.
- `playerResources.changeCash(refund)` returns the actual amount added (may be capped).
- Actor disposal must be deferred to `world.frameEndActions` to prevent mid-tick mutation.

---

### 4.7 LayMines.ts (MEDIUM complexity, 237 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/LayMines.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/LayMines.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/LayMines.test.ts`

**Key features to migrate**:
- Constructor: `(self, minefield = null)`
- `OnFirstRun`: If no minefield provided, default to `[self.Location]`
- `Tick`: Complex mine laying state machine
  - If canceling and laying mine: notify `INotifyMineLaying` of cancellation
  - If laying mine: complete lay, queue `Wait` for after-lay delay
  - Move cooldown helper tick
  - If at minefield cell and can lay mine: check ammo, find rearm target if empty, queue resupply chain, or start laying
  - If pre-lay delay > 0: set `layingMine = true`, queue `Wait`
  - If pre-lay delay = 0: lay mine immediately
  - Find next valid cell, queue `Move` to it
  - If no valid cells: return true (complete)
- `NextValidCell()`: Iterate minefield, find first cell where `CanLayMine()` is true
- `CleanMineField()`: Remove cells that already have mines or are unmineable
- `CanLayMine()`: Static check -- actor is alive and in world, no other actors at location
- `StartLayingMine()`: Check ammo, deduct ammo, notify `INotifyMineLaying`
- `LayMine()`: Check ammo, deduct ammo, remove cell from minefield, create mine actor via `world.addFrameEndTask`, notify `INotifyMineLaying`
- `TargetLineNodes`: Render target lines to rearm target (if returning) and next mine cell

**Dependencies**: `Minelayer` (stub), `AmmoPool`, `IMove`, `Mobile`, `MoveAdjacentTo`, `Resupply`, `MoveCooldownHelper`, `Wait`, `INotifyMineLaying` (stub), `ICallForTransport`, `IPositionable`, `ActorMap` (stub), `Shroud`

**Paradigm shifts**:
- C# `minefield ??= [self.Location]` -> TypeScript `minefield = minefield ?? [self.Location]`
- C# `self.World.Actors.Where(...).ClosestToWithPathFrom(self)` -> TypeScript actor search with distance sort
- C# `self.World.AddFrameEndTask()` -> TypeScript `world.queueFrameEndAction()`
- C# `self.World.CreateActor()` -> TypeScript `world.createActor()` or `world.addFrameEndAction(() => world.createActor(...))`
- C# `LocationInit`, `OwnerInit`, `ParentActorInit` -> TypeScript init stubs
- C# `ActorMap.GetActorsAt()` -> TypeScript `actorMap.getActorsAt()`

**Test strategy**:
- Test mine laying at current cell: deducts ammo, creates mine actor
- Test pre-lay delay: queues Wait, sets `layingMine` flag
- Test after-lay delay: queues Wait after successful lay
- Test movement to next mine cell: queues Move
- Test rearm when out of ammo: finds rearm building, queues MoveAdjacentTo + Resupply
- Test cancellation during lay: notifies `INotifyMineLaying`
- Test `CleanMineField`: removes cells with existing mines
- Test `CanLayMine`: returns false when other actors present
- Test target line rendering

**Things to watch out for**:
- The `layingMine` flag prevents the activity from queuing a Move to the next cell in the same tick that a mine is laid.
- `CleanMineField` uses `ActorMap.GetActorsAt()` and checks if any actor is a mine of the same type. This requires the `ActorMap` stub.
- The `IPositionable` cast from `IMove` is used for `canEnterCell()` and `canStayInCell()` checks.
- Mine actor creation uses `world.AddFrameEndTask` with `LocationInit`, `OwnerInit`, `ParentActorInit`. These init types are not yet migrated.
- The `rearmableInfo` check determines if the unit can rearm at a building. If null, the unit cannot rearm and the activity completes when out of ammo.
- The `returnToBase` flag affects target line rendering.

---

## 5. Key Paradigm Shifts

### 5.1 Docking System Integration

| OpenRA (C#) | TypeScript |
|:---|:---|
| `DockClientManager` as separate trait | `DockClientManager` may be merged into `Harvester` or kept as stub; verify before implementation |
| `IDockHost` implemented by separate `DockHost` trait | `Refinery` directly implements `IDockHost` (Ch10 architectural decision) |
| `self.Trait<DockClientManager>()` | `self.getComponent('DockClientManager')` or duck-typed lookup |
| `dockClient.ReserveHost()` / `UnreserveHost()` | Same method names on `DockClientManager` stub |
| `dockHost.QueueMoveActivity()` / `QueueDockActivity()` | Same callback pattern -- host queues children on the passed activity |

### 5.2 Resource Management

| OpenRA (C#) | TypeScript |
|:---|:---|
| `resourceLayer.GetResource(cell)` | `resourceLayer.getResource(cell)` |
| `resourceLayer.RemoveResource(type, cell)` | `resourceLayer.removeResource(type, cell)` |
| `harvester.AddResource(self, type)` | `harvester.addResource(self, type)` |
| `claimLayer.TryClaimCell(self, cell)` | `claimLayer.tryClaimCell(self, cell)` |
| `claimLayer.RemoveClaim(self)` | `claimLayer.removeClaim(self)` |
| `claimLayer.CanClaimCell(self, cell)` | `claimLayer.canClaimCell(self, cell)` |

### 5.3 Activity Composition

| OpenRA (C#) | TypeScript |
|:---|:---|
| `QueueChild(new MoveToDock(self, ...))` | `this.queueChild(new MoveToDock(self, ...))` |
| `QueueChild(new HarvestResource(self, cell))` | `this.queueChild(new HarvestResource(self, cell))` |
| `QueueChild(new Wait(ticks))` | `this.queueChild(new Wait(ticks))` |
| `QueueChild(new Drag(self, start, end, length))` | `this.queueChild(new Drag(self, start, end, length))` |
| `QueueChild(move.MoveTo(cell, 0))` | `this.queueChild(move.moveTo(cell, 0))` |
| `ChildActivity != null` | `this.childActivity !== null` |
| `NextActivity != null` | `this.nextActivity !== null` |

### 5.4 World Mutations

| OpenRA (C#) | TypeScript |
|:---|:---|
| `self.Dispose()` | `world.queueFrameEndAction(() => world.removeActor(self))` |
| `self.World.AddFrameEndTask(w => w.Add(new FloatingText(...)))` | `world.queueFrameEndAction(() => world.addEffect(new FloatingText(...)))` |
| `self.World.CreateActor(name, [new LocationInit(...), ...])` | `world.queueFrameEndAction(() => world.createActor(name, { location: ..., owner: ... }))` |

### 5.5 Notification Interfaces

| OpenRA (C#) | TypeScript |
|:---|:---|
| `self.TraitsImplementing<INotifyDockClient>().ToArray()` | `self.getComponents('INotifyDockClient')` or duck-typed array |
| `self.TraitsImplementing<INotifyHarvestAction>().ToArray()` | `self.getComponents('INotifyHarvestAction')` or duck-typed array |
| `self.TraitsImplementing<INotifyMineLaying>().ToArray()` | `self.getComponents('INotifyMineLaying')` or duck-typed array |

---

## 6. Shared Helpers / Stubs Needed

### 6.1 Economic Activity Interfaces

Create `src/OpenRA.Mods.Common/Activities/EconomicActivityInterfaces.ts` with all notification and stub interfaces:

```typescript
// INotifyDockClient -- used by GenericDockSequence, Resupply, MoveToDock
export interface INotifyDockClient {
  docked(self: IGameActor, host: IGameActor): void
  undocked(self: IGameActor, host: IGameActor): void
}

// INotifyDockHost -- used by GenericDockSequence, Resupply
export interface INotifyDockHost {
  docked(host: IGameActor, client: IGameActor): void
  undocked(host: IGameActor, client: IGameActor): void
}

// INotifyResupply -- used by Resupply
export interface INotifyResupply {
  beforeResupply(host: IGameActor, client: IGameActor, types: ResupplyType): void
  resupplyTick(host: IGameActor, client: IGameActor, types: ResupplyType): void
}

// INotifyMineLaying -- used by LayMines
export interface INotifyMineLaying {
  mineLaying(self: IGameActor, location: CPos): void
  mineLayingCanceled(self: IGameActor, location: CPos): void
  mineLaid(self: IGameActor, mine: IGameActor): void
}

// INotifySold -- used by Sell
export interface INotifySold {
  sold(self: IGameActor): void
}

// IDockClientBody -- used by GenericDockSequence
export interface IDockClientBody {
  playDockAnimation(self: IGameActor, after: () => void): void
  playReverseDockAnimation(self: IGameActor, after: () => void): void
}

// WithDockingOverlay -- used by GenericDockSequence
export interface WithDockingOverlay {
  visible: boolean
  info: { sequence: string }
  withOffset: {
    animation: {
      playThen(sequence: string, after: () => void): void
      playBackwardsThen(sequence: string, after: () => void): void
    }
  }
}

// RepairsUnits -- used by Resupply
export interface RepairsUnits {
  isTraitDisabled: boolean
  isTraitPaused: boolean
  info: {
    hpPerStep: number
    valuePercentage: number
    interval: number
    repairDamageTypes: string[]
    startRepairingNotification: string | null
    finishRepairingNotification: string | null
    startRepairingTextNotification: string | null
    finishRepairingTextNotification: string | null
    playerExperience: number
  }
}

// Repairable -- used by Resupply
export interface Repairable {
  info: {
    repairActors: string[]
    hpPerStep: number
  }
}

// RepairableNear -- used by Resupply
export interface RepairableNear {
  info: {
    repairActors: string[]
  }
}

// Rearmable -- used by Resupply, LayMines
export interface Rearmable {
  info: {
    rearmActors: string[]
  }
  rearmTick(self: IGameActor): boolean
  rearmableAmmoPools: { hasFullAmmo: boolean }[]
}

// RallyPoint -- used by Resupply
export interface RallyPoint {
  path: CPos[]
}

// Minelayer -- used by LayMines
export interface Minelayer {
  info: {
    mine: string
    ammoPoolName: string
    ammoUsage: number
    preLayDelay: number
    afterLayingDelay: number
    targetLineColor: ColorStub
    tile: Sprite | null
  }
}

// BodyOrientation -- used by HarvestResource
export interface BodyOrientation {
  quantizeFacing(facing: WAngle, facings: number): WAngle
}

// ValuedInfo -- used by Resupply
export interface ValuedInfo {
  cost: number
}

// ActorMap -- used by LayMines
export interface ActorMap {
  getActorsAt(cell: CPos): IGameActor[]
}

// FloatingText -- used by Sell (stub)
export class FloatingText {
  static formatCashTick(amount: number): string
  constructor(position: WPos, color: ColorStub, text: string, duration: number)
}

// TextNotificationsManager -- used by Resupply, Sell (stub)
export class TextNotificationsManager {
  static addTransientLine(player: PlayerStub, text: string | null): void
}

// PlayerExperience -- used by Resupply (stub)
export interface PlayerExperience {
  giveExperience(amount: number): void
}
```

### 6.2 ResupplyType Enum

```typescript
// src/OpenRA.Mods.Common/Activities/ResupplyType.ts
export enum ResupplyType {
  None = 0,
  Repair = 1,
  Rearm = 2,
}
```

### 6.3 Init Stubs for LayMines

```typescript
// src/OpenRA.Game/ActorInit.ts (or inline in LayMines.ts)
export class LocationInit {
  constructor(public readonly location: CPos) {}
}

export class OwnerInit {
  constructor(public readonly owner: PlayerStub) {}
}

export class ParentActorInit {
  constructor(public readonly parent: IGameActor) {}
}
```

### 6.4 Existing Stubs to Replace

| File | Current Status | Action |
|:---|:---|:---|
| `src/OpenRA.Mods.Common/Activities/Resupply.ts` | Minimal stub (returns true) | **Replace** with full implementation |
| `src/OpenRA.Mods.Common/Activities/Wait.ts` | Partial stub (tick countdown) | **Keep** -- sufficient for Phase D needs |
| `src/OpenRA.Mods.Common/Activities/RemoveSelf.ts` | Minimal stub (returns true) | **Keep** -- not used by Phase D |

---

## 7. Test Strategy

### 7.1 Unit Test Files

| Test File | Tests | Coverage |
|:---|:---:|:---|
| `MoveToDock.test.ts` | ~15 | Dock host resolution, nearest dock search, reservation success/failure, cancellation, target lines |
| `GenericDockSequence.test.ts` | ~20 | State machine (6 states), cancellation at each state, drag with/without, notifications, virtual methods |
| `Resupply.test.ts` | ~30 | Repair tick, rearm tick, host death, aircraft/ground ending, cancellation, cash deduction, notifications |
| `HarvestResource.test.ts` | ~15 | Claim on first run, movement to cell, facing adjustment, harvest success, cell depletion, cancellation |
| `FindAndDeliverResources.test.ts` | ~25 | Full cycle, queueFullLoad behavior, no-resources wait, closestHarvestablePos, order location, unblocking |
| `Sell.test.ts` | ~8 | Refund calculation, notifications, floating text, actor disposal, non-interruptible |
| `LayMines.test.ts` | ~20 | Mine laying, pre-lay delay, rearm cycle, ammo check, cancellation, cleanMineField, target lines |
| **Total** | **~133** | |

### 7.2 Mocking Strategy

All tests mock the actor and its traits:

```typescript
// Mock actor with traits
const mockActor = {
  traits: new Map([
    ['Harvester', mockHarvester],
    ['DockClientManager', mockDockClientManager],
    ['Mobile', mockMobile],
    ['IHealth', mockHealth],
    ['IFacing', mockFacing],
  ]),
  location: new CPos(5, 5),
  centerPosition: new WPos(5 * 1024, 5 * 1024, 0),
  owner: mockPlayer,
  world: mockWorld,
  isInWorld: true,
  isDead: false,
  getComponent: vi.fn((name: string) => mockActor.traits.get(name)),
  getComponents: vi.fn((name: string) => [mockActor.traits.get(name)].filter(Boolean)),
}

// Mock harvester
const mockHarvester = {
  isFull: false,
  isEmpty: true,
  canHarvestCell: vi.fn((cell: CPos) => true),
  addResource: vi.fn(),
  info: {
    baleLoadDelay: 4,
    harvestFacings: 0,
    harvestLineColor: { r: 0.86, g: 0.08, b: 0.24, a: 1 },
    searchFromHarvesterRadius: 12,
    searchFromProcRadius: 24,
    waitDuration: 25,
    resourceRefineryDirectionPenalty: 200,
    queueFullLoad: false,
    unblockCell: new CVec(0, 4),
  },
}

// Mock dock client manager
const mockDockClientManager = {
  reservedHost: null,
  reservedHostActor: null,
  lastReservedHost: null,
  dockLineColor: { r: 0, g: 1, b: 0, a: 1 },
  info: { searchForDockDelay: 25 },
  closestDock: vi.fn(() => null),
  reserveHost: vi.fn(() => true),
  unreserveHost: vi.fn(),
  availableDockHosts: vi.fn(() => []),
}

// Mock resource layer
const mockResourceLayer = {
  getResource: vi.fn((cell: CPos) => ({ type: 'Ore', density: 5 })),
  removeResource: vi.fn(() => 1),
}

// Mock resource claim layer
const mockClaimLayer = {
  tryClaimCell: vi.fn(() => true),
  removeClaim: vi.fn(),
  canClaimCell: vi.fn(() => true),
}
```

### 7.3 Key Test Patterns

1. **MoveToDock reservation test**: Create MoveToDock with no dock specified. Mock `closestDock` to return a host. Verify `reserveHost` is called and a move child is queued.
2. **GenericDockSequence state machine test**: Create sequence, tick through each state. Verify state transitions and child activities queued.
3. **Resupply repair test**: Create Resupply with Repair active. Mock `RepairsUnits` with `hpPerStep = 5`. Tick until repair complete. Verify HP increased by expected amount.
4. **HarvestResource full cycle**: Create HarvestResource with target cell. Tick through movement, facing, harvest, wait. Verify resource removed and added to cargo.
5. **FindAndDeliverResources no-resources**: Mock `canHarvestCell` to return false everywhere. Verify `LastSearchFailed` is set and Wait is queued.
6. **Sell refund test**: Create Sell with full-health building. Verify refund equals cost * refundPercent / 100.
7. **LayMines rearm cycle**: Mock ammo pool to return empty. Verify `MoveAdjacentTo` and `Resupply` are queued.

---

## 8. Acceptance Test Recommendations

### 8.1 Recommended Test Pages

| Page | Module | Purpose | Priority |
|:---|:---|:---|:---:|
| `/test/activities/harvest/` | FindAndDeliverResources + HarvestResource + MoveToDock | Verify harvester finds ore, moves to it, harvests, delivers to refinery | HIGH |
| `/test/activities/dock/` | GenericDockSequence + Resupply | Verify docking animation sequence, repair/rearm at service depot | MEDIUM |

### 8.2 Page Specifications

**`/test/activities/harvest/`**
- Scene: Flat terrain with ore field and refinery, 1 harvester
- Test: Harvester auto-harvests ore, delivers to refinery, repeats
- Criteria: (1) Harvester reaches ore field within 10 seconds, (2) Harvester fills cargo and moves to refinery, (3) Resources are delivered and refinery shows cash tick, (4) Target lines visible (red for harvest, green for dock)

**`/test/activities/dock/`**
- Scene: Flat terrain with service depot, 1 damaged tank
- Test: Tank moves to service depot, docks, repairs, leaves
- Criteria: (1) Tank approaches depot and aligns, (2) Repair animation plays (HP increases), (3) Tank leaves depot after repair complete, (4) Target line visible (green)

---

## 9. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|:---|:---:|:---:|:---|
| `DockClientManager` stub API mismatch | HIGH | MEDIUM | Verify all methods used by activities exist in stub. Extend stub if needed before Batch 1. |
| `PathFinder.findPathToTargetCellByPredicate` API mismatch | HIGH | MEDIUM | Verify exact API name in migrated PathFinder. May be `findPathToTargetCell` or different signature. |
| `IDockHost` methods missing on Refinery | HIGH | LOW | Refinery directly implements IDockHost. Verify all required methods exist (`queueMoveActivity`, `queueDockActivity`, `canDockAt`, `onDockStarted`, `onDockCompleted`). |
| `GenericDockSequence` animation callbacks deferred | MEDIUM | HIGH | Animation stubs (`playThen`, `playBackwardsThen`) immediately call callback. Full animation integration deferred to render traits chapter. |
| `Resupply` repair cash calculation overflow | MEDIUM | LOW | TypeScript `number` is double-precision. Use `Math.floor()` for truncation to match C# `(int)` cast behavior. |
| `FindAndDeliverResources` cosine rule cost modifier precision | MEDIUM | MEDIUM | Test with known values. Fixed-point math (512 = 1.0) may differ slightly from floating-point. Document any deviation. |
| `LayMines` actor creation with Init types | MEDIUM | MEDIUM | `LocationInit`, `OwnerInit`, `ParentActorInit` are stubs. Create minimal implementations that set actor properties. |
| `INotifyHarvestAction` interface incomplete | MEDIUM | HIGH | Existing stub in `CarryableHarvester.ts` only has `movingToResources()`. Extend with `harvested()` and `movementCancelled()` for `HarvestResource`. |
| `Resupply` aircraft take-off after repair | MEDIUM | LOW | `wasRepaired` flag forces take-off. Verify `Aircraft` trait has `unReserve()` and `allowYieldingReservation()` methods. |
| Many interface stubs to create | LOW | HIGH | Group all stubs into single `EconomicActivityInterfaces.ts` file. Create before Batch 1. |
| `Sell.ts` floating text effect deferred | LOW | HIGH | `FloatingText` is a visual effect. Stub the creation call; actual rendering deferred to Chapter 7/16. |
| `TextNotificationsManager` not migrated | LOW | HIGH | Create minimal stub with `addTransientLine()` no-op. Full implementation deferred to UI chapter. |

---

## Appendix A: C# Source Line Counts

| File | C# Lines | C# Code Lines (non-comment) |
|:---|:---:|:---:|
| Resupply.cs | 327 | ~280 |
| FindAndDeliverResources.cs | 263 | ~220 |
| GenericDockSequence.cs | 216 | ~180 |
| MoveToDock.cs | 150 | ~125 |
| HarvestResource.cs | 124 | ~105 |
| LayMines.cs | 237 | ~200 |
| Sell.cs | 58 | ~50 |
| **Total** | **1,375** | **~1,160** |

---

## Appendix B: Batch Assignment for Developer

### Batch 1: Core Infrastructure (3 files)
- **Files**: MoveToDock, GenericDockSequence, Resupply
- **Estimated TS lines**: ~1,400
- **Estimated tests**: ~65
- **Dependencies**: Activity base, Move, Drag, Wait, Turn, TakeOff, AttackMoveActivity, all economy traits
- **Deliverables**: MoveToDock.ts + test, GenericDockSequence.ts + test, Resupply.ts + test
- **Shared**: EconomicActivityInterfaces.ts (all stubs)
- **Review round**: 1 (combined for all 3)

### Batch 2: Resource Loop (2 files)
- **Files**: HarvestResource, FindAndDeliverResources
- **Estimated TS lines**: ~900
- **Estimated tests**: ~40
- **Dependencies**: Batch 1 complete, Harvester, ResourceLayer, ResourceClaimLayer, PathFinder
- **Deliverables**: HarvestResource.ts + test, FindAndDeliverResources.ts + test
- **Review round**: 1

### Batch 3: Specialized (2 files)
- **Files**: Sell, LayMines
- **Estimated TS lines**: ~500
- **Estimated tests**: ~28
- **Dependencies**: Batch 1 complete (Resupply for LayMines), Sell independent
- **Deliverables**: Sell.ts + test, LayMines.ts + test
- **Review round**: 1

---

> **Reference Documents**:
> - `docs/chapter14_activity_implementations_migration_plan.md` -- Main Chapter 14 plan
> - `docs/chapter14_phase_c_plan.md` -- Phase C Aircraft plan (for ReturnToBase -> Resupply dependency)
> - `src/OpenRA.Game/Activities/Activity.ts` -- Activity base class
> - `src/OpenRA.Mods.Common/Activities/Resupply.ts` -- Existing stub (to be replaced)
> - `src/OpenRA.Mods.Common/Activities/Wait.ts` -- Existing stub (sufficient)
> - `src/OpenRA.Mods.Common/Traits/Harvester.ts` -- Harvester trait
> - `src/OpenRA.Mods.Common/Traits/DockClientBase.ts` -- Dock client base
> - `src/OpenRA.Mods.Common/Traits/Buildings/Refinery.ts` -- Refinery / IDockHost
> - `src/OpenRA.Mods.Common/Traits/World/ResourceLayer.ts` -- Resource layer
> - `src/OpenRA.Mods.Common/Traits/World/ResourceClaimLayer.ts` -- Resource claim layer
> - `src/OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.ts` -- Move cooldown helper
> - `src/OpenRA.Mods.Common/Traits/CarryableHarvester.ts` -- Partial interface stubs
> - `docs/chapter10_resource_economy_migration_plan.md` -- Chapter 10 plan (economy traits)
> - `docs/chapter11_production_building_migration_plan.md` -- Chapter 11 plan (building traits)
