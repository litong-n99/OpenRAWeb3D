# OpenRA to Babylon.js Migration Plan: Chapter 14 Phase C -- Aircraft Activities

> **Source Reference**: `OpenRA/OpenRA.Mods.Common/Activities/Air/*.cs`, `OpenRA/OpenRA.Mods.Common/Activities/Parachute.cs`
> **Phase Status**: PLANNING (0/12 migrated)
> **Planning Date**: 2026-06-15
> **Prerequisite**: Chapter 14 Phase A+B COMPLETE (17/49 files), Chapter 9 Aircraft trait COMPLETE
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overview and Scope](#1-overview-and-scope)
2. [Dependency Analysis](#2-dependency-analysis)
3. [Implementation Order](#3-implementation-order)
4. [File-by-File Plan](#4-file-by-file-plan)
5. [Key Paradigm Shifts](#5-key-paradigm-shifts)
6. [Shared Helpers / Base Classes](#6-shared-helpers--base-classes)
7. [Test Strategy](#7-test-strategy)
8. [Acceptance Test Recommendations](#8-acceptance-test-recommendations)
9. [Aircraft.ts Stub Replacement Plan](#9-aircraftts-stub-replacement-plan)
10. [Risk Register](#10-risk-register)

---

## 1. Overview and Scope

Phase C migrates 12 aircraft-related activity files from OpenRA C# to TypeScript. These activities form the flight physics and air-combat layer of the game engine. All files depend on the Chapter 9 `Aircraft` trait (already migrated) and the Chapter 3 `Activity` base class (already migrated).

### 1.1 Files in Scope

| # | OpenRA Source | Target TypeScript File | Class | Lines (C#) | Complexity | Dependencies |
|:---:|:---|:---|:---|:---:|:---:|:---|
| 1 | `OpenRA.Mods.Common/Activities/Air/Fly.cs` | `src/OpenRA.Mods.Common/Activities/Air/Fly.ts` | `Fly` (+ static helpers) | 283 | **HIGH** | Aircraft, Activity, Target, WAngle, WDist, WVec, WPos, Turn |
| 2 | `OpenRA.Mods.Common/Activities/Air/TakeOff.cs` | `src/OpenRA.Mods.Common/Activities/Air/TakeOff.ts` | `TakeOff` | 73 | LOW | Fly (static helpers), Aircraft |
| 3 | `OpenRA.Mods.Common/Activities/Air/Land.cs` | `src/OpenRA.Mods.Common/Activities/Air/Land.ts` | `Land` | 276 | **HIGH** | Fly (static helpers), TakeOff, Turn, Aircraft, Target |
| 4 | `OpenRA.Mods.Common/Activities/Air/FlyForward.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyForward.ts` | `FlyForward` | 64 | LOW | Fly (static helpers), Aircraft |
| 5 | `OpenRA.Mods.Common/Activities/Air/FlyIdle.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.ts` | `FlyIdle` | 66 | LOW | Fly (static helpers), Aircraft, INotifyIdle |
| 6 | `OpenRA.Mods.Common/Activities/Air/FlyOffMap.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.ts` | `FlyOffMap` | 70 | LOW | Fly, FlyForward, TakeOff, Aircraft |
| 7 | `OpenRA.Mods.Common/Activities/Air/ReturnToBase.cs` | `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.ts` | `ReturnToBase` | 140 | MEDIUM | Fly, FlyIdle, Aircraft, Reservable (stub), Repairable (stub), Rearmable (stub) |
| 8 | `OpenRA.Mods.Common/Activities/Air/FlyAttack.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.ts` | `FlyAttack` (+ nested `FlyAttackRun`, `StrafeAttackRun`) | 316 | **HIGH** | Fly, FlyForward, TakeOff, Aircraft, AttackAircraft, Rearmable, Attack (pattern) |
| 9 | `OpenRA.Mods.Common/Activities/Air/FlyFollow.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.ts` | `FlyFollow` | 99 | MEDIUM | Fly (static helpers), Aircraft, Target |
| 10 | `OpenRA.Mods.Common/Activities/Air/FallToEarth.cs` | `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.ts` | `FallToEarth` | 64 | LOW | Aircraft, FallsToEarthInfo (Ch9) |
| 11 | `OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.cs` | `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.ts` | `DeliverBulkOrder` | 118 | MEDIUM | Land, FlyOffMap, Cargo (Ch11), ProductionBulkAirdrop |
| 12 | `OpenRA.Mods.Common/Activities/Parachute.cs` | `src/OpenRA.Mods.Common/Activities/Parachute.ts` | `Parachute` | 58 | LOW | IPositionable, ParachutableInfo, INotifyParachute |

### 1.2 Summary Statistics

| Metric | Count |
|--------|-------|
| Total files | 12 |
| Total C# source lines | ~1,627 |
| Estimated TypeScript lines | ~3,700 |
| Estimated test files | 5 |
| Estimated tests | ~140 |
| Estimated test lines | ~2,500 |
| HIGH complexity | 3 files (`Fly`, `FlyAttack`, `Land`) |
| MEDIUM complexity | 3 files (`ReturnToBase`, `FlyFollow`, `DeliverBulkOrder`) |
| LOW complexity | 6 files |

---

## 2. Dependency Analysis

### 2.1 External Dependencies (Already Migrated)

| Dependency | Source Chapter | Status | Key APIs Used |
|:---|:---|:---|:---|
| `Activity` base class | Ch3 Phase F | COMPLETE | `tick()`, `queueChild()`, `cancel()`, `onFirstRun()`, `onLastRun()`, `childHasPriority`, `isCanceling`, `TargetLineNode` |
| `Aircraft` trait | Ch9 Phase B | COMPLETE | `flyStep()`, `setPosition()`, `facing`, `pitch`, `roll`, `turnSpeed`, `idleTurnSpeed`, `movementSpeed`, `idleMovementSpeed`, `info` (all config fields), `forceLanding`, `landAltitude`, `atLandAltitude`, `canLand()`, `findLandingLocation()`, `addInfluence()`, `removeInfluence()`, `hasInfluence()`, `makeReservation()`, `unReserve()`, `getActorBelow()` |
| `Target` | Ch3 Phase A | COMPLETE | `recalculate()`, `isValidFor()`, `isInRange()`, `centerPosition`, `type`, `fromPos()`, `fromActor()`, `fromCell()`, `Invalid` |
| WPos / WVec / WDist / WAngle / WRot | Ch3 Phase A | COMPLETE | All math operations, `tickFacing()`, `yaw`, `horizontalLength`, `horizontalLengthSquared`, `length`, `lengthSquared`, `rotate()`, `dot()`, `subtract()`, `add()`, `equals()` |
| `AttackAircraft` trait | Ch8 Phase E | COMPLETE | `info` (attackType, strafeRunLength, abortOnResupply, facingTolerance), `setRequestedTarget()`, `clearRequestedTarget()`, `requestedTarget`, `chooseArmamentsForTarget()`, `getMaximumRangeVersusTarget()`, `getMinimumRangeVersusTarget()`, `getTargetPosition()`, `targetInFiringArc()`, `hasAnyValidWeapons()`, `armaments`, `isTraitPaused` |
| `Turn` activity | Ch14 Phase B | COMPLETE | `Turn` class for facing adjustment |
| `Attack` activity | Ch14 Phase B | COMPLETE | Pattern reference for `IActivityNotifyStanceChanged` |
| `FallsToEarthInfo` | Ch9 Phase B | COMPLETE | `moves`, `velocity`, `explosionWeapon`, `maximumSpinSpeed` |
| `Cargo` / `ProductionBulkAirdrop` | Ch11 | COMPLETE | `info` (beforeUnloadDelay, betweenUnloadDelay, afterUnloadDelay), `deliverFinished()`, `publicExit()`, `doProduction()` |
| `Map` | Ch4 | COMPLETE | `distanceAboveTerrain()`, `contains()`, `cellContaining()`, `centerOfCell()`, `chooseClosestEdgeCell()` |
| `Reservable` / `Repairable` / `Rearmable` | Ch9 (stubs in Aircraft.ts) | STUB | `isAvailableFor()`, `reserve()`, `repairActors`, `rearmActors`, `rearmableAmmoPools` |

### 2.2 Internal Dependencies (Within Phase C)

```
Fly (core) -- MUST be first
  |
  +--> TakeOff (uses Fly.VerticalTakeOffOrLandTick)
  +--> Land (uses Fly, Fly.VerticalTakeOffOrLandTick, TakeOff)
  +--> FlyForward (uses Fly.FlyTick)
  +--> FlyIdle (uses Fly.FlyTick)
  +--> FlyOffMap (uses Fly, FlyForward, TakeOff)
  +--> FlyAttack (uses Fly, FlyForward, TakeOff)
  +--> FlyFollow (uses Fly.FlyTick)
  +--> ReturnToBase (uses Fly, FlyIdle)
  +--> FallToEarth (uses aircraft.flyStep, aircraft.setPosition)

Parachute -- independent (no aircraft dependency, uses IPositionable)

DeliverBulkOrder -- depends on Land, FlyOffMap, Cargo (Ch11)
```

### 2.3 Missing Dependencies (Need Stubs or Deferred)

| Dependency | Status | Action |
|:---|:---|:---|
| `Resupply` activity | Phase D (not yet migrated) | **STUB**: ReturnToBase queues `Resupply` as child. Create minimal `Resupply` stub that immediately returns true, or queue `Wait` instead. Update when Phase D completes. |
| `RemoveSelf` activity | Phase F (not yet migrated) | **STUB**: FlyOffMap and DeliverBulkOrder queue `RemoveSelf`. Use the existing `Hunt.ts` local `Wait` pattern or create a minimal inline `RemoveSelf` stub class. |
| `Wait` activity | Phase F (not yet migrated) | **PARTIAL**: `Hunt.ts` already has a local `Wait` stub (lines 212-225). `DeliverBulkOrder` and `ReturnToBase` need `Wait`. Reuse the same pattern or create a shared minimal `Wait` in a support file. |
| `INotifyLanding` / `INotifyTakeOff` | Not migrated | **STUB**: Create minimal interface stubs in `Fly.ts` or `Aircraft.ts`. These are notification interfaces called during landing/takeoff. |
| `INotifyIdle` | Not migrated | **STUB**: `FlyIdle` uses `self.TraitsImplementing<INotifyIdle>()`. Create minimal interface stub. |
| `INotifyParachute` | Not migrated | **STUB**: `Parachute` uses `self.TraitsImplementing<INotifyParachute>()`. Create minimal interface stub. |
| `ParachutableInfo` | Not migrated | **STUB**: `Parachute` reads `self.Info.TraitInfo<ParachutableInfo>().FallRate`. Create minimal info stub with `fallRate: WDist`. |
| `IActivityNotifyStanceChanged` | Already in Attack.ts | **REUSE**: `FlyAttack` implements the same interface as `Attack`. Reuse the pattern from `Attack.ts`. |
| `AttackSource` enum | Not migrated | **STUB**: Simple enum `{ Normal, AttackMove }` used by FlyAttack. |
| `AirAttackType` enum | In AttackAircraft.ts | **VERIFY**: Check if `AirAttackType` (Strafe, Default, Hover) is already defined in migrated `AttackAircraft.ts`. |
| `Util.TickFacing` / `Util.GetTurnDirection` | In WAngle.ts | **REUSE**: `WAngle.tickFacing()` and `WAngle.getTurnDirection()` already migrated. |
| `RingBuffer<WPos>` | Not migrated | **NEW**: `Fly` uses a `RingBuffer<WPos>` of capacity 5 for position history. Implement as a simple fixed-size circular buffer utility or inline array. |
| `Game.Sound.Play` | Ch7 Phase D | COMPLETE | `Sound.ts` has `play()` method. |
| `WVec.FromPDF` | Not migrated | **STUB**: `ReturnToBase` uses `WVec.FromPDF(self.World.SharedRandom, 2)` for random position. Implement as simple random vector generation. |
| `NearestExitOrDefault` | Not migrated | **STUB**: `ReturnToBase` uses `dest.NearestExitOrDefault()`. This is a Building/Exit trait method. Create stub. |
| `NotifyBlocker` | Not migrated | **STUB**: `Land` uses `self.NotifyBlocker(blockingCells)`. Create minimal stub method on actor. |

---

## 3. Implementation Order

### 3.1 Recommended Batch Order

**Batch 1: Core Infrastructure (3 files)**
1. `Fly.ts` -- HIGHEST priority. All other aircraft activities depend on its static helpers.
2. `TakeOff.ts` -- Simple, depends only on Fly static helpers.
3. `Land.ts` -- Complex but core; depends on Fly and TakeOff.

**Batch 2: Simple Flight Modes (4 files)**
4. `FlyForward.ts` -- Simple, depends on Fly.
5. `FlyIdle.ts` -- Simple, depends on Fly.
6. `FlyOffMap.ts` -- Simple, depends on Fly, FlyForward, TakeOff.
7. `Parachute.ts` -- Independent, no aircraft dependency.

**Batch 3: Combat & Follow (2 files)**
8. `FlyAttack.ts` -- Complex, depends on Fly, FlyForward, TakeOff. Contains nested classes.
9. `FlyFollow.ts` -- Medium, depends on Fly.

**Batch 4: Specialized (3 files)**
10. `ReturnToBase.ts` -- Medium, depends on Fly, FlyIdle. Needs Resupply stub.
11. `FallToEarth.ts` -- Simple, depends on Aircraft trait only.
12. `DeliverBulkOrder.ts` -- Medium, depends on Land, FlyOffMap, Cargo. Most complex dependencies.

### 3.2 Parallelization

- **Batch 1 must be sequential**: Fly -> TakeOff -> Land.
- **Batch 2 can start after Fly is done**: FlyForward, FlyIdle, FlyOffMap, Parachute can be done in parallel after Batch 1.
- **Batch 3 depends on Batch 1**: FlyAttack and FlyFollow need Fly.
- **Batch 4 depends on earlier batches**: ReturnToBase needs FlyIdle; DeliverBulkOrder needs Land + FlyOffMap.

---

## 4. File-by-File Plan

### 4.1 Fly.ts (HIGH complexity, 283 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/Fly.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/Fly.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/Fly.test.ts`

**Key features to migrate**:
- Three constructors: `(self, target, nearEnough)`, `(self, target, initialPos, color)`, `(self, target, minRange, maxRange, initialPos, color)`
- Static `FlyTick()` -- the core flight physics tick (two overloads)
- Static `VerticalTakeOffOrLandTick()` -- vertical-only altitude change
- Static `CalculateTurnRadius()` -- turn radius from speed and turn rate
- Instance `Tick()` -- target tracking, range annulus, turn radius avoidance, position history, cancellation landing
- `GetTargets()` -- yield target
- `TargetLineNodes()` -- yield target line with color
- `RingBuffer<WPos>` for position history (capacity 5)

**Paradigm shifts**:
- C# `RingBuffer<WPos>` -> TypeScript fixed-size circular buffer (simple array with head/tail index)
- C# static methods on class -> TypeScript static methods on class
- C# `yield return` -> TypeScript array return (or generator if needed)
- C# `WAngle` math with `Tan()` -> TypeScript `WAngle.tan()` (verify exists) or inline `Math.tan()`

**Test strategy**:
- Test `FlyTick` with various facing deltas, altitude changes, roll/pitch
- Test `VerticalTakeOffOrLandTick` ascent/descent
- Test `CalculateTurnRadius` with known values
- Test instance `Tick`: target approach, min range slide, max range stop, turn radius avoidance, cancellation landing, position history blocking
- Test target line node generation

**Things to watch out for**:
- The `Tan()` method on `WAngle` -- verify it exists in migrated WAngle.ts. If not, implement or use `Math.tan(wAngle.toRadians())`.
- The `FlyTick` overload with `moveOverride` -- second overload delegates to first. Preserve this pattern.
- The `isSlider` / `CanSlide` logic: when inside min range, slider reverses, non-slider turns away.
- The turn radius check: only applies to non-sliders. The circle-center calculation uses `WVec` rotation and scaling.
- Cancellation handling: when canceling, aircraft must return to sensible height. If landed, queue TakeOff. If hovering, use `VerticalTakeOffOrLandTick`.
- The `previousPositions` ring buffer: used to detect being blocked (moved < 64 WDist in 5 ticks).

---

### 4.2 TakeOff.ts (LOW complexity, 73 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/TakeOff.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/TakeOff.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/TakeOff.test.ts`

**Key features**:
- Constructor: `(self)` -- resolves Aircraft trait
- `OnFirstRun`: remove influence, play sound, notify takeoff
- `Tick`: if below cruise altitude, rise (VTOL uses vertical tick, non-VTOL uses FlyTick)

**Dependencies**: Fly (static helpers), Aircraft trait

**Test strategy**:
- VTOL takeoff: uses `VerticalTakeOffOrLandTick`, reaches cruise altitude
- Non-VTOL takeoff: uses `FlyTick`, reaches cruise altitude while moving forward
- Force landing cancellation
- Sound notification on first run
- Influence removal on first run

---

### 4.3 Land.ts (HIGH complexity, 276 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/Land.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/Land.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/Land.test.ts`

**Key features**:
- Multiple constructors: no target (land at self.Location), with target, with target + landRange, with target + offset, full constructor with clearCells
- `OnFirstRun`: assign target from self.Location if not provided
- `Tick`: complex landing sequence
  - Cancellation: if landing initiated, either continue landing (idle behavior) or take off
  - VTOL path: horizontal alignment -> turn -> vertical descent
  - Non-VTOL path: approach trajectory calculation (turn radius, tangent points, waypoints w1/w2/w3)
  - Landing initiation: check `CanLand`, add influence, play sound, notify
  - Final descent: VTOL uses `VerticalTakeOffOrLandTick`, non-VTOL uses `FlyTick`
- `TargetLineNodes`

**Dependencies**: Fly (static helpers), TakeOff (for cancellation), Turn (for VTOL facing), Aircraft trait

**Paradigm shifts**:
- C# approach trajectory math (tangent circles, waypoint calculation) -> Same math with TypeScript WVec/WPos operations
- C# `QueueChild` multiple waypoints -> TypeScript `queueChild()` multiple times

**Test strategy**:
- VTOL landing: horizontal approach, turn, vertical descent
- Non-VTOL landing: approach trajectory waypoints, final descent
- Cancellation during landing: continue or take off
- Blocked landing: holding pattern (FlyIdle), notify blockers
- Target line rendering
- Landing at actor vs terrain

**Things to watch out for**:
- The approach trajectory for non-VTOL is the most complex geometry in the file. The tangent calculation between two turning circles must be precise.
- The `finishedApproach` flag prevents re-queuing approach waypoints.
- `landingInitiated` tracks whether influence has been added and landing notifications sent.
- The `clearCells` parameter for blocking cell checks.

---

### 4.4 FlyForward.ts (LOW complexity, 64 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/FlyForward.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/FlyForward.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/FlyForward.test.ts`

**Key features**:
- Two constructors: `(self, ticks)` and `(self, distance)`
- `Tick`: fly forward at current facing for N ticks or until distance traveled
- Uses `Fly.FlyTick()` for movement

**Test strategy**:
- Tick-based: returns true after N ticks
- Distance-based: returns true after traveling specified distance
- Force landing cancellation
- Uses `FlyTick` with current facing and cruise altitude

---

### 4.5 FlyIdle.ts (LOW complexity, 66 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/FlyIdle.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.test.ts`

**Key features**:
- Constructor: `(self, ticks = -1, idleTurn = true)`
- `Tick`: if idleTurner (can hover or has idleSpeed), circle at idle speed
- Calls `INotifyIdle.TickIdle()` for each notify idle trait
- Uses `Fly.FlyTick()` with `idleTurn = true` for roll/pitch

**Dependencies**: Fly (static helpers), Aircraft trait, INotifyIdle (stub)

**Test strategy**:
- Ticks countdown: returns true when ticks reach 0
- Circling behavior: `isIdleTurner` true, desiredFacing = current + 256 (quarter turn)
- Hover behavior: `CanHover` true, no movement
- Force landing cancellation
- `INotifyIdle` tick notification

---

### 4.6 FlyOffMap.ts (LOW complexity, 70 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/FlyOffMap.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.test.ts`

**Key features**:
- Two constructors: `(self, endingDelay = 25)` and `(self, target, endingDelay = 25)`
- `OnFirstRun`: if has target, Fly to target then FlyForward; else VTOL takeoff if needed then FlyForward
- `Tick`: when off map and delay expired, cancel child; tick child

**Dependencies**: Fly, FlyForward, TakeOff, Aircraft

**Test strategy**:
- With target: queues Fly then FlyForward
- Without target: queues FlyForward (TakeOff first for VTOL)
- Off-map detection: `!self.World.Map.Contains(self.Location)`
- Ending delay countdown
- Force landing cancellation

---

### 4.7 FlyAttack.ts (HIGH complexity, 316 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/FlyAttack.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.test.ts`

**Key features**:
- `FlyAttack` class: main attack orchestration
  - Constructor: resolves Aircraft, AttackAircraft, Rearmable
  - `Tick`: ammo check, target recalculation, resupply decision, range approach, attack run selection
  - `OnLastRun`: clear requested target
  - `StanceChanged`: cancel non-forced targets on stance change
  - `TargetLineNodes`: render target lines (with returnToBase handling)
  - `HasArmamentsFor`: check if any armament can attack target
- `FlyAttackRun` (nested class): fly past target, fire, exit range
  - `OnFirstRun`: queue Fly to target, FlyForward 1 tick, Fly away
  - `Tick`: tick child, cancel if target dies while visible
- `StrafeAttackRun` (nested class): fly through target area firing
  - `OnFirstRun`: queue Fly to target, FlyForward by exitRange, Fly away with turn distance
  - `Tick`: tick child, update ground target position

**Dependencies**: Fly, FlyForward, TakeOff, Aircraft, AttackAircraft, Rearmable, Attack pattern (IActivityNotifyStanceChanged)

**Paradigm shifts**:
- C# nested classes -> TypeScript private helper classes in same file, or separate exported classes
- C# `AttackAircraft.Info.AttackType` enum -> TypeScript enum/union type
- C# `attackAircraft.Armaments.All()` LINQ -> TypeScript `every()` array method

**Test strategy**:
- FlyAttack: target approach, ammo depletion -> ReturnToBase, stance change cancellation, target invalidation
- FlyAttackRun: fly past target, child chain (Fly -> FlyForward -> Fly), target death cancellation
- StrafeAttackRun: strafe distance, exit range, target position update
- Target line rendering with returnToBase flag

**Things to watch out for**:
- The `AttackSource` enum (Normal vs AttackMove) affects resupply behavior.
- `AbortOnResupply` flag: if true, cancels current activity and queue; if false, queues ReturnToBase as child.
- The `hasTicked` flag prevents checking `RequestedTarget` before first tick.
- The `returnToBase` flag affects target line rendering.
- `FlyAttackRun` and `StrafeAttackRun` are `sealed` in C# -- they should not be extended.

---

### 4.8 FlyFollow.ts (MEDIUM complexity, 99 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/FlyFollow.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.test.ts`

**Key features**:
- Constructor: `(self, target, minRange, maxRange, initialPos, color)`
- `Tick`: recalculate target, check range, if in range and visible wait (or FlyTick if non-hover), if out of range queue MoveWithinRange
- `TargetLineNodes`

**Dependencies**: Fly (static helpers), Aircraft, Target

**Test strategy**:
- Target in range: returns true (or false for non-hover)
- Target out of range: queues child, returns false
- Target hidden after move: returns true (give up)
- Target line rendering

---

### 4.9 ReturnToBase.ts (MEDIUM complexity, 140 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/ReturnToBase.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.test.ts`

**Key features**:
- Constructor: `(self, dest = null, alwaysLand = false)`
- Static `ChooseResupplier`: find nearest available resupplier (airfield/helipad)
- `ShouldLandAtBuilding`: check if needs repair or rearm
- `Tick`: find dest, if no dest wait near nearest, if needs land queue MoveOntoTarget + Resupply, else just Fly to dest
- `TargetLineNodes`

**Dependencies**: Fly, FlyIdle, Aircraft, Reservable (stub), Repairable (stub), Rearmable (stub)

**Paradigm shifts**:
- C# `self.World.ActorsHavingTrait<Reservable>()` -> TypeScript duck-typed actor search
- C# `ClosestToWithPathFrom` -> TypeScript distance search
- C# `Reservable.IsAvailableFor` -> TypeScript stub method

**Test strategy**:
- Find resupplier: nearest available
- No resupplier: hover near nearest, or fly idle wait
- Needs landing: queues MoveOntoTarget + Resupply
- No landing needed: just Fly to dest
- Target line rendering
- Force landing early return

**Things to watch out for**:
- `Resupply` activity is not yet migrated (Phase D). Need a stub.
- `WVec.FromPDF` for random position -- implement simple random vector.
- `NearestExitOrDefault` for building exit -- stub needed.

---

### 4.10 FallToEarth.ts (LOW complexity, 64 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/FallToEarth.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.test.ts`

**Key features**:
- Constructor: `(self, info)` -- resolves Aircraft, sets `IsInterruptible = false`
- `Tick`: if on ground, explode weapon and kill self; otherwise spin and fall

**Dependencies**: Aircraft trait, FallsToEarthInfo (Ch9)

**Test strategy**:
- Ground impact: weapon explosion, actor killed
- Falling: spin acceleration, position update
- Non-interruptible: cancel ignored
- `Moves` flag: if false, falls straight down; if true, flies forward while falling

---

### 4.11 DeliverBulkOrder.ts (MEDIUM complexity, 118 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.test.ts`

**Key features**:
- Constructor: `(transport, producer, orderedActors, productionType, queue)`
- `OnFirstRun`: queue Land at producer, then Wait before unload
- `OnLastRun`: notify delivery, queue Wait after unload, FlyOffMap, RemoveSelf
- `OnActorDispose`: call `queue.DeliverFinished()`
- `Tick`: if producer dead, find alternative; if no actors, finish; unload one actor per tick with delay

**Dependencies**: Land, FlyOffMap, Wait (stub), Cargo (Ch11), ProductionBulkAirdrop (Ch11)

**Test strategy**:
- Landing at producer
- Unload delay between actors
- Producer death: find alternative or finish
- Empty order list: finish
- OnLastRun: delivery notification, fly off map
- OnActorDispose: deliver finished callback

**Things to watch out for**:
- `RemoveSelf` is not yet migrated. Need stub.
- `ProductionBulkAirdropInfo.LandOffset` -- verify exists in Ch11.
- `productionTrait.DoProduction` with `TypeDictionary` inits -- `TypeDictionary` is migrated (Ch3).

---

### 4.12 Parachute.ts (LOW complexity, 58 C# lines)

**OpenRA source**: `OpenRA.Mods.Common/Activities/Parachute.cs`
**Target**: `src/OpenRA.Mods.Common/Activities/Parachute.ts`
**Test target**: `src/OpenRA.Mods.Common/Activities/Parachute.test.ts`

**Key features**:
- Constructor: `(self)` -- resolves IPositionable, reads ParachutableInfo.FallRate, `IsInterruptible = false`
- `OnFirstRun`: record ground level, notify parachute start
- `Tick`: fall by fallRate each tick; return true when at/below ground
- `OnLastRun`: snap to ground level, notify landed

**Dependencies**: IPositionable (migrated), ParachutableInfo (stub needed), INotifyParachute (stub needed)

**Test strategy**:
- Falling: position decreases by fallRate each tick
- Landing: returns true when at ground level
- Non-interruptible
- OnFirstRun: ground level recorded, notifications sent
- OnLastRun: position snapped to ground, notifications sent

---

## 5. Key Paradigm Shifts

### 5.1 3D Altitude Handling

| OpenRA (C#) | TypeScript (Babylon.js) |
|:---|:---|
| `WPos.Z` is altitude above terrain | `WPos.Z` remains altitude; `CoordinateTransformer` maps to Babylon.js Y axis |
| `Map.DistanceAboveTerrain(pos)` returns `WDist` | Same method on Map; returns `WDist` |
| Altitude changes via `aircraft.SetPosition(self, pos + new WVec(0,0,deltaZ))` | Same via `aircraft.setPosition(self, newPos)` |
| Cruise altitude is `aircraft.Info.CruiseAltitude` | Same via `aircraft.info.cruiseAltitude` |

### 5.2 Turn Radius and Facing

| OpenRA (C#) | TypeScript |
|:---|:---|
| `Util.TickFacing(current, desired, turnSpeed)` | `WAngle.tickFacing(current, desired, turnSpeed)` |
| `Util.GetTurnDirection(current, desired)` | `WAngle.getTurnDirection(current, desired)` (verify exists) |
| `WAngle.Angle` for raw angle value | `WAngle.angle` property |
| `new WAngle(512)` for quarter turn | `new WAngle(512)` |
| Turn radius = `180 * speed / turnSpeed.Angle` | Same formula in `Fly.calculateTurnRadius()` |

### 5.3 Target Lines

| OpenRA (C#) | TypeScript |
|:---|:---|
| `yield return new TargetLineNode(target, color)` | Return `TargetLineNode[]` from `targetLineNodes()` method |
| `TargetLineNode` with `Sprite tile` | Same `TargetLineNode` class (already migrated in Activity.ts) |
| Target line rendering via 2D sprites | Deferred to renderer; activities just provide nodes |

### 5.4 Static Helpers

| OpenRA (C#) | TypeScript |
|:---|:---|
| `public static void FlyTick(...)` | `public static flyTick(...)` on Fly class |
| Static methods called as `Fly.FlyTick(self, aircraft, ...)` | Same pattern: `Fly.flyTick(self, aircraft, ...)` |
| `VerticalTakeOffOrLandTick` returns `bool` (true = still moving) | Same return semantics |

### 5.5 Child Activity Composition

| OpenRA (C#) | TypeScript |
|:---|:---|
| `QueueChild(new TakeOff(self))` | `this.queueChild(new TakeOff(self))` |
| `ChildHasPriority = false` for parent-controlled ticking | `this.childHasPriority = false` |
| `TickChild(self)` in parent tick | `this.tickChild(self)` (inherited from Activity) |

---

## 6. Shared Helpers / Base Classes

### 6.1 RingBuffer Utility

`Fly` uses a `RingBuffer<WPos>` of capacity 5. Options:

**Option A: Inline fixed-size array in Fly.ts**
```typescript
private readonly previousPositions: WPos[] = new Array(5)
private posIndex = 0
private posCount = 0

private addPosition(pos: WPos): void {
  this.previousPositions[this.posIndex] = pos
  this.posIndex = (this.posIndex + 1) % 5
  if (this.posCount < 5) this.posCount++
}

private get oldestPosition(): WPos | null {
  if (this.posCount < 5) return null
  return this.previousPositions[this.posIndex] // next to be overwritten = oldest
}
```

**Option B: Generic RingBuffer utility class**
Create `src/OpenRA.Game/Primitives/RingBuffer.ts` if other files need it. Currently only Fly uses it, so **Option A (inline)** is preferred to avoid unnecessary abstraction.

### 6.2 Minimal Wait Stub

`DeliverBulkOrder` and `ReturnToBase` need `Wait`. `Hunt.ts` already has a local `Wait` class (lines 212-225). Options:

**Option A: Promote to shared file**
Create `src/OpenRA.Mods.Common/Activities/Wait.ts` as a minimal stub (to be replaced by Phase F full implementation). This avoids duplication.

**Option B: Keep local in each file**
Duplicate the simple Wait class. Not DRY but avoids cross-file dependency.

**Recommendation: Option A**. Create a minimal `Wait.ts` now. Phase F will expand it.

### 6.3 Minimal RemoveSelf Stub

`FlyOffMap` and `DeliverBulkOrder` queue `RemoveSelf`. Create a minimal stub:

```typescript
// src/OpenRA.Mods.Common/Activities/RemoveSelf.ts (minimal stub)
export class RemoveSelf extends Activity {
  override tick(self: GameActor): boolean {
    // Deferred to world.frameEndActions
    const world = (self as unknown as { world?: { queueFrameEndAction: (fn: () => void) => void } }).world
    world?.queueFrameEndAction(() => {
      // Actor removal logic
    })
    return true
  }
}
```

Phase F will implement the full version.

### 6.4 Minimal Resupply Stub

`ReturnToBase` queues `Resupply`. Create a minimal stub that immediately returns true:

```typescript
// src/OpenRA.Mods.Common/Activities/Resupply.ts (minimal stub)
export class Resupply extends Activity {
  constructor(_self: GameActor, _dest: unknown, _dist: WDist, _alwaysLand: boolean) {
    super()
  }
  override tick(): boolean {
    return true // Phase D will implement full logic
  }
}
```

### 6.5 Interface Stubs

Create minimal interface stubs in a shared file or inline:

```typescript
// INotifyIdle -- used by FlyIdle
export interface INotifyIdle {
  tickIdle(actor: GameActor): void
}

// INotifyLanding -- used by Land
export interface INotifyLanding {
  landing(actor: GameActor): void
}

// INotifyTakeOff -- used by TakeOff
export interface INotifyTakeOff {
  takeOff(actor: GameActor): void
}

// INotifyParachute -- used by Parachute
export interface INotifyParachute {
  onParachute(actor: GameActor): void
  onLanded(actor: GameActor): void
}

// ParachutableInfo -- used by Parachute
export interface ParachutableInfo {
  readonly fallRate: WDist
}
```

**Recommendation**: Place these in `src/OpenRA.Mods.Common/Activities/Air/AircraftActivityInterfaces.ts` or add to existing `TraitsInterfaces.ts` if appropriate. Given they are activity-specific notification interfaces, a local file in the Air directory is cleaner.

---

## 7. Test Strategy

### 7.1 Unit Test Files

| Test File | Tests | Coverage |
|:---|:---:|:---|
| `Fly.test.ts` | ~35 | FlyTick static helpers, VerticalTakeOffOrLandTick, instance Tick (approach, range, turn radius, cancellation, position history), target lines |
| `TakeOff.test.ts` | ~10 | VTOL vs non-VTOL ascent, force landing, sound notification, influence removal |
| `Land.test.ts` | ~25 | VTOL landing, non-VTOL approach trajectory, cancellation, blocked landing, target lines |
| `FlyAttack.test.ts` | ~20 | FlyAttack (ammo, resupply, stance), FlyAttackRun (child chain), StrafeAttackRun (exit range), target lines |
| `AircraftActivities.test.ts` | ~30 | FlyForward, FlyIdle, FlyOffMap, FlyFollow, ReturnToBase, FallToEarth, DeliverBulkOrder, Parachute (combined file for simple activities) |
| **Total** | **~120** | |

### 7.2 Mocking Strategy

All tests mock the `Aircraft` trait and `GameActor`:

```typescript
// Mock aircraft
const mockAircraft = {
  info: { cruiseAltitude: new WDist(1280), canHover: false, canSlide: false, vTOL: false, /* ... */ },
  facing: new WAngle(0),
  pitch: WAngle.Zero,
  roll: WAngle.Zero,
  turnSpeed: new WAngle(512),
  idleTurnSpeed: null,
  movementSpeed: 100,
  idleMovementSpeed: 100,
  flyStep: (facing: WAngle) => new WVec(0, -100, 0).rotate(WRot.fromYaw(facing)),
  setPosition: vi.fn(),
  forceLanding: false,
  landAltitude: new WDist(0),
  atLandAltitude: false,
  canLand: vi.fn(() => true),
  findLandingLocation: vi.fn((cell: CPos) => cell),
  addInfluence: vi.fn(),
  removeInfluence: vi.fn(),
  hasInfluence: vi.fn(() => false),
  makeReservation: vi.fn(),
  unReserve: vi.fn(),
  getActorBelow: vi.fn(() => null),
  // ... etc
}

// Mock actor with traits
const mockActor = {
  traits: new Map([['Aircraft', mockAircraft], ['facing', mockAircraft]]),
  centerPosition: WPos.Zero,
  location: CPos.Zero,
  owner: { /* ... */ },
  world: { map: mockMap, sharedRandom: 42, /* ... */ },
  isInWorld: true,
  isDead: false,
  isIdle: false,
  currentActivity: null,
  // ... etc
}
```

### 7.3 Key Test Patterns

1. **Fly approach test**: Create Fly with target 1000 units away. Tick until `tick()` returns true. Verify aircraft position approaches target.
2. **Min range slide test**: Create Fly with minRange. Position aircraft inside minRange. Verify `CanSlide` aircraft reverses, non-slider turns away.
3. **Turn radius test**: Create Fly with non-slider aircraft. Position target inside turn radius. Verify aircraft continues current facing instead of turning toward target.
4. **Cancellation landing test**: Create Fly, start ticking, call `cancel()`. Verify aircraft queues TakeOff or uses VerticalTakeOffOrLandTick.
5. **VTOL landing test**: Create Land with VTOL aircraft. Verify approach is horizontal + turn + vertical descent.
6. **Non-VTOL approach test**: Create Land with non-VTOL. Verify waypoints w1, w2, w3 are queued.
7. **Strafe attack test**: Create FlyAttack with Strafe attack type. Verify StrafeAttackRun is queued with correct exit range.

---

## 8. Acceptance Test Recommendations

### 8.1 Recommended Test Pages

| Page | Module | Purpose | Priority |
|:---|:---|:---|:---:|
| `/test/activities/fly/` | Fly + FlyForward | Verify aircraft flies toward target, maintains altitude, target line visible | HIGH |
| `/test/activities/land-takeoff/` | TakeOff + Land | Verify VTOL vertical ascent/descent, non-VTOL approach trajectory, landing sound | HIGH |
| `/test/activities/fly-attack/` | FlyAttack + FlyAttackRun + StrafeAttackRun | Verify attack approach, strafe run, hover attack, target line color change | MEDIUM |
| `/test/activities/return-to-base/` | ReturnToBase + FlyIdle | Verify aircraft finds base, lands, idle circling when no base | MEDIUM |
| `/test/activities/parachute/` | Parachute | Verify parachute descent animation, landing, unit spawn | LOW |

### 8.2 Page Specifications

**`/test/activities/fly/`**
- Scene: Flat terrain, 1 aircraft at origin
- Test: Click to set target, aircraft flies toward it
- Criteria: (1) Aircraft reaches target within 5 seconds, (2) Altitude stays at cruise level, (3) Target line is visible (red/green)

**`/test/activities/land-takeoff/`**
- Scene: Flat terrain with helipad, 1 VTOL aircraft
- Test: Aircraft takes off, flies, lands at helipad
- Criteria: (1) VTOL rises vertically then moves horizontally, (2) Lands exactly on helipad, (3) Non-VTOL shows approach arc

**`/test/activities/fly-attack/`**
- Scene: Flat terrain, 1 attack aircraft, 1 target building
- Test: Aircraft attacks building
- Criteria: (1) Aircraft approaches and fires, (2) Strafe aircraft flies past target, (3) Hover aircraft holds position

---

## 9. Aircraft.ts Stub Replacement Plan

The migrated `Aircraft.ts` (Ch9 Phase B) contains activity stubs that must be replaced with real imports after Phase C is complete.

### 9.1 Stubs to Replace

| Stub Class | Location in Aircraft.ts | Replacement |
|:---|:---|:---|
| `FlyActivity` | Lines 328-330 | `import { Fly } from '../Activities/Air/Fly.js'` |
| `FlyFollowActivity` | Lines 338-340 | `import { FlyFollow } from '../Activities/Air/FlyFollow.js'` |
| `LandActivity` | Lines 348-350 | `import { Land } from '../Activities/Air/Land.js'` |
| `TakeOffActivity` | Lines 358-360 | `import { TakeOff } from '../Activities/Air/TakeOff.js'` |
| `FlyIdleActivity` | Lines 368-370 | `import { FlyIdle } from '../Activities/Air/FlyIdle.js'` |
| `FlyOffMapActivity` | Lines 378-380 | `import { FlyOffMap } from '../Activities/Air/FlyOffMap.js'` |
| `ReturnToBaseActivity` | Lines 388-390 | `import { ReturnToBase } from '../Activities/Air/ReturnToBase.js'` |
| `NudgeActivity` | Lines 398-400 | `import { Nudge } from '../Activities/Move/Nudge.js'` (Phase A) |
| `RemoveSelfActivity` | Lines 408-410 | `import { RemoveSelf } from '../Activities/RemoveSelf.js'` (Phase F) |

### 9.2 Method Implementations to Update

| Method | Current | Update |
|:---|:---|:---|
| `moveToCell()` | Returns `new FlyActivity()` | Returns `new Fly(self, target, nearEnough, null, targetLineColor)` |
| `moveTo()` | Returns `new FlyActivity()` | Returns `new Fly(self, target)` |
| `moveWithinRange()` | Returns `new FlyActivity()` | Returns `new Fly(self, target, WDist.Zero, range, initialTarget, targetLineColor)` |
| `moveWithinRangeMinMax()` | Returns `new FlyActivity()` | Returns `new Fly(self, target, minRange, maxRange, initialTarget, targetLineColor)` |
| `moveFollow()` | Returns `new FlyFollowActivity()` | Returns `new FlyFollow(self, target, range, followTarget, initialTarget, targetLineColor)` |
| `moveToTarget()` | Returns `new FlyActivity()` | Returns `new Fly(self, target, initialTargetPosition)` |
| `moveIntoTarget()` | Returns `new LandActivity()` | Returns `new Land(self, target)` |
| `moveOntoTarget()` | Returns `new LandActivity()` | Returns `new Land(self, target, offset, facing, targetLineColor)` |
| `localMove()` | Returns `new FlyActivity()` | Returns `new Fly(self, Target.fromPos(destination))` |
| `getCreationActivity()` | Returns `new ReturnToBaseActivity()` | Returns `new ReturnToBase(self)` or proper AssociateWithAirfieldActivity |
| `onBecomingIdle()` | Uses all activity stubs | Use real activity imports |
| `resolveOrder()` | Uses all activity stubs | Use real activity imports with proper target construction |

### 9.3 When to Update

**Do NOT update Aircraft.ts during Phase C implementation.** The activity stubs in Aircraft.ts are used by other chapters. Update Aircraft.ts only after ALL Phase C activities are migrated, tested, and reviewed. This is a **post-Phase C cleanup task**.

---

## 10. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|:---|:---:|:---:|:---|
| `WAngle.Tan()` does not exist | HIGH | MEDIUM | Check WAngle.ts; implement `tan()` method if missing using `Math.tan(this.toRadians())` |
| `WAngle.getTurnDirection()` does not exist | HIGH | LOW | Check WAngle.ts; implement if missing (simple comparison of angle deltas) |
| `Resupply` stub breaks ReturnToBase tests | MEDIUM | HIGH | Create minimal Resupply that returns true immediately; tests verify ReturnToBase queues it correctly |
| `RemoveSelf` stub breaks FlyOffMap/DeliverBulkOrder | MEDIUM | HIGH | Create minimal RemoveSelf that returns true; tests verify it's queued |
| Non-VTOL approach trajectory math errors | MEDIUM | MEDIUM | Extensive unit tests with known waypoint values; visual acceptance test |
| Turn radius calculation off-by-one | MEDIUM | MEDIUM | Test with known speed/turnSpeed values; compare with C# formula result |
| `RingBuffer` implementation diverges from C# | LOW | LOW | Inline simple array; test with exact C# behavior (capacity 5, FIFO) |
| `AttackAircraft` trait API mismatch | MEDIUM | LOW | Verify all referenced methods exist in migrated AttackAircraft.ts (Ch8 Phase E) |
| `FlyAttack` nested classes cause circular imports | LOW | MEDIUM | Keep nested classes in same file; export only FlyAttack; FlyAttackRun/StrafeAttackRun are internal |
| Phase C completion blocks Phase D | MEDIUM | LOW | Phase D can start in parallel with Batch 3-4 of Phase C; only Resupply stub is shared |

---

## Appendix A: C# Source Line Counts

| File | C# Lines | C# Code Lines (non-comment) |
|:---|:---:|:---:|
| Fly.cs | 283 | ~240 |
| FlyAttack.cs | 316 | ~270 |
| FlyFollow.cs | 99 | ~85 |
| FlyForward.cs | 64 | ~55 |
| FlyIdle.cs | 66 | ~55 |
| FlyOffMap.cs | 70 | ~60 |
| Land.cs | 276 | ~240 |
| TakeOff.cs | 73 | ~60 |
| ReturnToBase.cs | 140 | ~120 |
| FallToEarth.cs | 64 | ~55 |
| DeliverBulkOrder.cs | 118 | ~100 |
| Parachute.cs | 58 | ~50 |
| **Total** | **1,627** | **~1,390** |

---

## Appendix B: Batch Assignment for Developer

### Batch 1: Core (Fly, TakeOff, Land)
- **Files**: 3
- **Estimated TS lines**: ~900
- **Estimated tests**: ~50
- **Dependencies**: Activity base, Aircraft trait, Turn activity, Target, WAngle, WDist, WVec, WPos
- **Deliverables**: Fly.ts + Fly.test.ts, TakeOff.ts + TakeOff.test.ts, Land.ts + Land.test.ts
- **Review round**: 1 (combined for all 3)

### Batch 2: Simple Modes (FlyForward, FlyIdle, FlyOffMap, Parachute)
- **Files**: 4
- **Estimated TS lines**: ~400
- **Estimated tests**: ~30
- **Dependencies**: Batch 1 complete
- **Deliverables**: 4 .ts files + 1 combined test file (AircraftActivities.test.ts)
- **Review round**: 1

### Batch 3: Combat (FlyAttack, FlyFollow)
- **Files**: 2
- **Estimated TS lines**: ~700
- **Estimated tests**: ~30
- **Dependencies**: Batch 1 complete, AttackAircraft trait
- **Deliverables**: FlyAttack.ts + FlyAttack.test.ts, FlyFollow.ts (tests in combined file)
- **Review round**: 1

### Batch 4: Specialized (ReturnToBase, FallToEarth, DeliverBulkOrder)
- **Files**: 3
- **Estimated TS lines**: ~500
- **Estimated tests**: ~25
- **Dependencies**: Batch 2 complete, Cargo trait, Resupply stub
- **Deliverables**: 3 .ts files + tests in combined file
- **Review round**: 1

### Batch 5: Cleanup (Aircraft.ts stub replacement, shared stubs)
- **Files**: Aircraft.ts updates + Wait.ts + RemoveSelf.ts + Resupply.ts stubs + AircraftActivityInterfaces.ts
- **Estimated TS lines**: ~200
- **No new tests** (stubs are tested by their consumers)
- **Review round**: 1 (quick check)

---

> **Reference Documents**:
> - `docs/chapter14_activity_implementations_migration_plan.md` -- Main Chapter 14 plan
> - `src/OpenRA.Game/Activities/Activity.ts` -- Activity base class
> - `src/OpenRA.Mods.Common/Traits/Air/Aircraft.ts` -- Aircraft trait (with stubs to replace)
> - `src/OpenRA.Mods.Common/Activities/Attack.ts` -- Attack activity pattern reference
> - `src/OpenRA.Mods.Common/Activities/Turn.ts` -- Turn activity
> - `docs/chapter9_movement_physics_migration_plan.md` -- Chapter 9 plan (Aircraft trait)
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Chapter 8 plan (AttackAircraft trait)
