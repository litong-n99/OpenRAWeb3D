# Chapter 13: Support Powers -- Architect Analysis

> **Analysis Date**: 2026-06-15
> **Status**: PLANNING (Architect analysis complete)
> **Prerequisites**: Chapters 2-12 COMPLETE (319/319 files, 100%)

---

## Table of Contents

1. [Architecture Analysis](#1-architecture-analysis)
   - 1.1 [Class Hierarchy](#11-class-hierarchy)
   - 1.2 [SupportPowerManager Lifecycle](#12-supportpowermanager-lifecycle)
   - 1.3 [SupportPowerInstance State Machine](#13-supportpowerinstance-state-machine)
   - 1.4 [OrderGenerator Chain](#14-ordergenerator-chain)
   - 1.5 [INotifySupportPower Interface](#15-inotifysupportpower-interface)
   - 1.6 [Cross-Chapter Dependencies](#16-cross-chapter-dependencies)
2. [File Mapping Table](#2-file-mapping-table)
3. [3D Paradigm Shifts](#3-3d-paradigm-shifts)
4. [Dependency Graph](#4-dependency-graph)
5. [Risk Assessment](#5-risk-assessment)
6. [Architecture Decision Records (ADRs)](#6-architecture-decision-records-adrs)
7. [Phase Strategy](#7-phase-strategy)
8. [Appendix: Support Power Widget Files](#8-appendix-support-power-widget-files)

---

## 1. Architecture Analysis

### 1.1 Class Hierarchy

The Support Powers system has a two-layer inheritance structure:

#### Info (Configuration) Hierarchy

```
PausableConditionalTraitInfo            (Ch3 -- conditional trait config base)
  |
  +-- SupportPowerInfo                  (14 configurable properties + 32 sound/notification slots)
        |
        +-- DirectionalSupportPowerInfo (2 extra properties: UseDirectionalTarget, Arrows[])
        |     |
        |     +-- AirstrikePowerInfo    (9 extra: UnitType, SquadSize, SquadOffset, QuantizedFacings,
        |     |                          Cordon, CameraActor, CameraRemoveDelay, BeaconDistanceOffset)
        |     |
        |     +-- ParatroopersPowerInfo (11 extra: UnitType, SquadSize, SquadOffset, DropItems[],
        |                                QuantizedFacings, Cordon, CameraActor, etc.)
        |
        +-- NukePowerInfo               (18 extra: MissileWeapon, MissileImage, MissileUp/Down,
        |                                 FlightDelay, FlightVelocity, CameraRange, CircleRanges[], etc.)
        |
        +-- ProduceActorPowerInfo       (4 extra: Actors[], Type, ReadyAudio, BlockedAudio)
        |
        +-- SpawnActorPowerInfo         (8 extra: Actor, LifeTime, Terrain[], EffectImage, etc.)
        |
        +-- GrantExternalConditionPowerInfo (5 extra: Condition, Duration, Dimensions, Footprint, Sequence, etc.)
```

#### Logic (Trait) Hierarchy

```
PausableConditionalTrait<SupportPowerInfo>  (Ch3 -- conditional trait base)
  |
  +-- SupportPower                          (Self, info; Created, CreateInstance, Charging, Charged,
        |                                    SelectTarget, Activate, PlayLaunchSounds, CellsMatching)
        |
        +-- DirectionalSupportPower         (overrides SelectTarget for directional mode)
        |     |
        |     +-- AirstrikePower            (SendAirstrike: spawns aircraft formation with Fly activities)
        |     |
        |     +-- ParatroopersPower         (SendParatroopers: spawns transport aircraft with ParaDrop)
        |
        +-- NukePower                       (Activate: creates NukeLaunch projectile + RevealShroudEffect + Beacon)
        |
        +-- ProduceActorPower               (Activate: finds best Production queue, issues produce order)
        |
        +-- SpawnActorPower                 (Activate: creates actor at target cell with optional LifeTime)
        |
        +-- GrantExternalConditionPower     (Activate: applies ExternalCondition to units in footprint)
```

### 1.2 SupportPowerManager Lifecycle

`SupportPowerManager` is a **Player-level trait** (attached to `SystemActors.Player`) that coordinates all support powers owned by a single player.

**Initialization**:
1. Attached to the Player actor via `TraitInfo.Create()`.
2. Subscribes to `World.ActorAdded` and `World.ActorRemoved` events.
3. Stores references to `DeveloperMode` (for `FastCharge` and `AllTech` cheats) and `TechTree` (for prerequisite gating).

**ActorAdded** (when a building/grant with a SupportPower trait enters the world):
1. Checks the actor's owner matches the manager's player.
2. Enumerates all `SupportPower` traits on the actor.
3. Computes a unique key: `info.OrderName` (with `_actorID` suffix if `AllowMultiple`).
4. Creates or reuses a `SupportPowerInstance` for the key.
5. Registers prerequisite watchers via `TechTree.Add()`.

**ActorRemoved** (when a building is destroyed or sold):
1. Checks the actor belongs to the same player and has `SupportPowerInfo`.
2. Finds the associated `SupportPowerInstance` by key.
3. Removes the trait from the instance's `Instances` list.
4. If all instances are gone and the power is not disabled: removes from `Powers` dict and `TechTree`.

**Tick** (every logic tick):
1. Iterates all `SupportPowerInstance` values.
2. Calls `power.Tick()` on each (decrements charge timer, fires `Charged` notification).

**ResolveOrder** (order dispatched by OrderManager):
1. Looks up `order.OrderString` in `Powers` dictionary.
2. If found, delegates to `power.Activate(order)`.

**GetPowersForActor** (query used by UI widgets like SupportPowerChargeBar):
1. Checks if actor's owner matches and has `SupportPowerInfo`.
2. Maps each `SupportPower` trait to its `SupportPowerInstance`.
3. Filters to only instances where the specific actor is an active contributor.

### 1.3 SupportPowerInstance State Machine

`SupportPowerInstance` is the runtime controller for a single power key (shared across all actors providing the same power). Its lifecycle:

```
[Created] ---- prereqsAvailable, instancesEnabled ---- [Disabled] (WinState.Lost / prereqs unavailable / trait disabled / oneShot fired)
    |
    v
[Active] ---- prereqsAvailable AND instancesEnabled AND any instance not paused
    |
    v (Active = true)
[Charging] ---- remainingSubTicks > 0, tick decrements by 100/tick
    |           On first active tick: fires BeginChargeSound/BeginChargeSpeechNotification
    v
[Ready] ---- remainingSubTicks = 0, fires EndChargeSound notification
    |          Calls power.Charged() -> INotifySupportPower.Charged() on all self traits
    v
[Target] ---- Player clicks support power button -> instance.Target()
    |          Fires SelectTargetSound notification
    |          Calls power.SelectTarget() -> sets World.OrderGenerator
    v
[Activate] ---- Order resolved by SupportPowerManager -> instance.Activate(order)
    |             Selects best instance (closest non-paused, non-disabled to target)
    |             Calls power.Activate() -> does the thing (spawn aircraft, launch nuke, etc.)
    |             Resets remainingSubTicks = TotalTicks * 100
    |             If OneShot: marks oneShotFired = true, prerequisites become unavailable
    v
[Charging] ---- (back to start)
```

**Key fields**:
- `remainingSubTicks`: stored at 100x resolution for smooth `FastCharge` override (2500 sub-ticks = 25 regular ticks minimum)
- `Active`: derived from `!Disabled && any instance not paused`
- `Ready`: derived from `Active && RemainingTicks == 0`
- `Disabled`: derived from OR of (WinState.Lost, prereqs unavailable, no enabled instances, oneShot fired)

**FastCharge** (DeveloperMode):
- When `DevMode.FastCharge` is true and `remainingSubTicks > 2500`, it's clamped to 2500.
- This means powers charge in 25 ticks (about 1 second at 25 tick/s) instead of the normal interval.

### 1.4 OrderGenerator Chain

When a player clicks a ready support power, a target-selection `OrderGenerator` is activated. OpenRA has a chain of order generators:

```
SupportPower.SelectTarget()
    |
    +-- DirectionalSupportPower.SelectTarget()
    |     |
    |     +-- info.UseDirectionalTarget ? SelectDirectionalTarget
    |     |     (drag to set direction, outputs ExtraData = facing angle)
    |     |
    |     +-- otherwise -> base.SelectTarget() -> SelectGenericPowerTarget
    |
    +-- NukePower.SelectTarget() -> SelectNukePowerTarget (extends SelectGenericPowerTarget)
    |     Adds: range circle annotations (CircleRanges[]), special cursor
    |
    +-- SpawnActorPower.SelectTarget() -> SelectSpawnActorPowerTarget (extends OrderGenerator)
    |     Adds: terrain validation, shroud validation, custom cursor
    |
    +-- GrantExternalConditionPower.SelectTarget() -> SelectConditionTarget (inner class)
    |     Adds: footprint overlay rendering, unit highlight annotations
    |
    +-- ProduceActorPower.SelectTarget() -> Issues order immediately (no targeting needed)
    |
    +-- Default -> SelectGenericPowerTarget
          Simple cell-targeting: click on map -> Order with Target.FromCell()
```

**SelectGenericPowerTarget** (the base targeting mode):
- Cursor: `info.Cursor` (valid cell) or `info.BlockedCursor` (invalid cell)
- Order generation: cell click -> `new Order(OrderKey, manager.Self, Target.FromCell(world, cell))`
- Tick: cancels input mode if power is no longer active/ready

**SelectDirectionalTarget** (drag-to-set-direction):
- MouseDown: locks cursor, starts tracking origin cell
- MouseMove: tracks drag direction, computes angle, selects arrow sprite from 8-direction array
- MouseUp: outputs `Order` with `ExtraData = currentArrow.Direction.Facing` (or `uint.MaxValue` if drag too short)
- Deactivate: releases mouse attachment, unlocks cursor

**SelectNukePowerTarget** (extends SelectGenericPowerTarget):
- Adds `RenderAnnotations`: range circles drawn around cursor position using `RangeCircleAnnotationRenderable`
- Circles are concentric with configurable colors and border widths

**SelectSpawnActorPowerTarget** (standalone OrderGenerator):
- Validates target cell against terrain type and shroud visibility
- Cursor changes based on `power.Validate()`

**SelectConditionTarget** (inner class of GrantExternalConditionPower):
- Renders footprint overlay sprites on the terrain
- Highlights affected units with red selection decorations
- Uses `UnitsInRange()` as validation for cursor and order generation

### 1.5 INotifySupportPower Interface

**Definition** (OpenRA `TraitsInterfaces.cs` line 145):
```csharp
public interface INotifySupportPower { void Charged(Actor self); void Activated(Actor self); }
```

**Implementors**:
| Class | File | Charged | Activated |
|-------|------|---------|-----------|
| `WithSupportPowerActivationAnimation` | Render | No-op | Plays custom animation sequence on `WithSpriteBody` |
| `WithSupportPowerActivationOverlay` | Render | No-op | Shows overlay animation via `AnimationWithOffset` |
| `Cloak` | Traits | Uncloaks on support power activate | Resets cloak timer when support power is used |

**In TypeScript**: The interface needs to be added to `src/OpenRA.Game/Traits/TraitsInterfaces.ts`. The `Cloak.ts` already has a TODO marker for `INotifySupportPower` (TODO-12.A.4.7) but the interface method is not yet implemented.

### 1.6 Cross-Chapter Dependencies

Chapter 13 has the deepest dependency chain of any chapter so far. Every major system from Chapters 2-12 is needed:

| Chapter | System | How Chapter 13 Uses It |
|---------|--------|----------------------|
| Ch2 | Renderer, WorldRenderer, Sprite, Sheet, Animation | Beacon rendering, activation overlays, footprint previews, charge bar sprites |
| Ch3 | World, Actor, Player, TraitDictionary, ITick, PausableConditionalTrait, Activity | Entire trait system, actor creation/destruction, activity queues |
| Ch4 | Map, CPos, CVec, CellLayers, TerrainInfo, CoordinateTransformer | Target cell resolution, footprint matching, terrain validation |
| Ch5 | WorldInteractionControllerWidget, Widget | Integration with world input system |
| Ch6 | Order, OrderManager, IResolveOrder, Ruleset | Order dispatch, support power activation via orders |
| Ch7 | Sound, SoundDevice, SpriteEffect, RenderSprites, AnimationWithOffset, Bullet | All audio notifications, visual effects, sprite render traits, projectile base |
| Ch8 | WeaponInfo, Warhead, WarheadRegistry, NukeLaunch, Armament, AttackBase | Nuke weapon, warhead impact, combat integration |
| Ch9 | Aircraft, Fly, ParaDrop, Cargo, Passenger, Mobile | Airstrike aircraft movement, paratrooper drops, unit delivery |
| Ch11 | Production, ProductionQueue, TechTree, TechTree | ProduceActorPower integrates with production system; prerequisite gating |
| Ch12 | Shroud, RevealsMap, CreatesShroud, RevealShroudEffect | Nuke camera reveal, spawn under shroud validation |

**Already-migrated infrastructure in TypeScript (directly usable)**:
- `NukeLaunch.ts` (Ch8 Phase B): Nuclear missile projectile with ascent/descent phases
- `SupportPowerBotModule.ts` (Ch6 Phase D): AI support power targeting (already uses SupportPowerDecision)
- `SupportPowerDecision.ts` (Ch6 Phase D): AI decision scoring for support powers
- `PlaceBuildingOrderGenerator.ts` (Ch11 Phase B): Reference pattern for OrderGenerator implementations
- `TechTree.ts` (Ch11): Prerequisite management with ITechTreeElement interface
- `Production.ts` / `ProductionQueue.ts` (Ch11): Production system for ProduceActorPower

**Missing infrastructure (blockers)**:
- `Beacon.ts` (143 lines C#): Not yet migrated. Required by AirstrikePower, ParatroopersPower, NukePower.
- `RevealShroudEffect.ts`: Not yet migrated. Required by NukePower for camera reveal.
- `ExternalCondition.ts`: Not yet migrated (file not found in src). Required by GrantExternalConditionPower.
- `ISelectionDecorations.ts`: Not yet migrated. Required by SelectConditionTarget for unit highlighting.

---

## 2. File Mapping Table

### 2.1 Complete File Inventory

| # | OpenRA Source | Target TypeScript File | Class/Interface | C# Lines | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Support Power Infrastructure** | | | | | |
| 1 | `OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.ts` | `SupportPowerInfo` / `SupportPower` | 261 | HIGH | A |
| 2 | `OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.ts` | `SupportPowerManager` / `SupportPowerInstance` / `SelectGenericPowerTarget` | 321 | HIGH | A |
| 3 | `OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.ts` | `DirectionalSupportPowerInfo` / `DirectionalSupportPower` | 51 | LOW | A |
| 4 | `OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.ts` | `SelectDirectionalTarget` | 180 | MEDIUM | A |
| 5 | `OpenRA.Mods.Common/Effects/Beacon.cs` | `src/OpenRA.Mods.Common/Effects/Beacon.ts` | `Beacon` | 143 | MEDIUM | A |
| **Phase B: Support Power Implementations** | | | | | |
| 6 | `OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.ts` | `AirstrikePowerInfo` / `AirstrikePower` | 227 | HIGH | B |
| 7 | `OpenRA.Mods.Common/Traits/SupportPowers/NukePower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/NukePower.ts` | `NukePowerInfo` / `NukePower` / `SelectNukePowerTarget` | 244 | HIGH | B |
| 8 | `OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.ts` | `ParatroopersPowerInfo` / `ParatroopersPower` | 277 | HIGHEST | B |
| 9 | `OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.ts` | `ProduceActorPowerInfo` / `ProduceActorPower` | 114 | MEDIUM | B |
| 10 | `OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.ts` | `SpawnActorPowerInfo` / `SpawnActorPower` / `SelectSpawnActorPowerTarget` | 164 | MEDIUM | B |
| 11 | `OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.ts` | `GrantExternalConditionPowerInfo` / `GrantExternalConditionPower` / `SelectConditionTarget` | 178 | MEDIUM | B |
| **Phase C: Render Traits & Crate Action** | | | | | |
| 12 | `OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.cs` | `src/OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.ts` | `SupportPowerChargeBarInfo` / `SupportPowerChargeBar` | 65 | LOW | C |
| 13 | `OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.ts` | `WithSupportPowerActivationAnimationInfo` / `WithSupportPowerActivationAnimation` | 53 | LOW | C |
| 14 | `OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.ts` | `WithSupportPowerActivationOverlayInfo` / `WithSupportPowerActivationOverlay` | 67 | MEDIUM | C |
| 15 | `OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.cs` | `src/OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.ts` | `SupportPowerCrateActionInfo` / `SupportPowerCrateAction` | 48 | LOW | C |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic. 48-67 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple trait interactions or rendering. 114-180 lines of C#.
> - **HIGH**: Complex gameplay logic with state machines or multiple subsystems. 227-321 lines of C#.
> - **HIGHEST**: Most complex logic, deep dependency chain, multiple sub-activities. 277+ lines of C#.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 15 |
| **Phase A (Infrastructure)** | 5 files |
| **Phase B (Implementations)** | 6 files |
| **Phase C (Render + Crate)** | 4 files |
| **HIGHEST complexity** | 1 file (ParatroopersPower 277 lines) |
| **HIGH complexity** | 4 files (SupportPower, SupportPowerManager, AirstrikePower, NukePower) |
| **MEDIUM complexity** | 5 files |
| **LOW complexity** | 5 files |
| **Total OpenRA C# source lines** | ~2,393 |

| Phase | Files | C# Lines | TS Lines (est.) | Tests (est.) | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Infrastructure | 5 | 956 | ~2,500-3,200 | ~80-100 | PLANNING |
| B: Implementations | 6 | 1,204 | ~3,500-4,500 | ~120-150 | PLANNING |
| C: Render + Crate | 4 | 233 | ~600-800 | ~30-40 | PLANNING |
| **Total** | **15** | **~2,393** | **~6,600-8,500** | **~230-290** | PLANNING |

### 2.3 Notes on In-Scope vs. Out-of-Scope

**In-scope (Chapter 13)**:
- All 15 files listed above

**Out-of-scope (deferred to Chapter 16 -- UI Widget Extensions)**:
- `OpenRA.Mods.Common/Widgets/SupportPowersWidget.cs` -- UI widget rendering the power palette in the sidebar
- `OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.cs` -- UI widget showing countdown timers
- `OpenRA.Mods.Common/Widgets/Logic/Ingame/SupportPowerBinLogic.cs` -- UI logic for support power bin
- `OpenRA.Mods.Common/Widgets/Logic/Ingame/SupportPowerTooltipLogic.cs` -- UI logic for tooltips

**Out-of-scope (deferred to Chapter 20 -- Scripting)**:
- `OpenRA.Mods.Common/Scripting/Properties/AirstrikeProperties.cs`
- `OpenRA.Mods.Common/Scripting/Properties/NukeProperties.cs`
- `OpenRA.Mods.Common/Scripting/Properties/ParatroopersProperties.cs`
- `OpenRA.Mods.Common/Scripting/Properties/ParadropProperties.cs`

---

## 3. 3D Paradigm Shifts

### 3.1 General Support Power Shift

| OpenRA 2D Pattern | Babylon.js 3D Pattern |
|-------------------|----------------------|
| `SupportPowerInfo` trait data read from YAML | JSON config objects (MiniYAML pipeline from Ch4 Phase H) |
| `SupportPower` base class with `Created()`, `Activate()` virtuals | TypeScript abstract class with same virtual methods |
| `World.AddFrameEndTask(w => ...)` deferred execution | `scene.onAfterRenderObservable` or explicit frame-end queue |
| `SupportPowerInstance.Tick()` with 100x sub-tick accuracy | Same logic, ticking at configurable intervals |
| `Game.Sound.PlayToPlayer()` / `PlayNotification()` / `TextNotificationsManager` | `Sound.ts` and `SoundDevice.ts` from Ch7 Phase D |
| C# `Lazy<RadarPings>` | TypeScript lazy initialization via getter or `Map.has()` check |
| `DeveloperMode` cheat flags | Config flags on Player/World (already stubbed in Ch3/Ch11) |

### 3.2 Beacon Rendering

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `Beacon : IEffect, IEffectAboveShroud` -- renders 2D sprites above shroud | `Beacon extends TransformNode` -- 3D billboard sprites at world position |
| `Animation` objects for `beacon`, `arrow`, `circles`, `clock`, `poster` layers | Multiple `Mesh` planes with `Animation` frame update via UV scrolling |
| Arrow bobbing (`arrowHeight` oscillates 0-512 with `arrowSpeed`) | Same oscillation applied to `mesh.position.y` offset |
| `IEffectAboveShroud.RenderAboveShroud()` -- renders when `delay > 0` and `owner.IsAlliedWith(RenderPlayer)` | Visibility controlled by `mesh.isVisible` based on same conditions |
| `SpriteRenderable` yields with palette-based rendering | `StandardMaterial` with `diffuseTexture` from sprite sheet; palette via `PlayerColorRemap` |
| Clock fraction driven by `Func<float>` callback | Same pattern: pass `() => fractionComplete` callback, compute UV frame index |
| Two constructor overloads (player-placed vs support-power beacons) | Single constructor with discriminated options object |

### 3.3 Airstrike and Paratroopers (Aircraft Spawning)

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `World.CreateActor(false, unitType, inits)` -- creates actor off-map | Same: `GameWorldManager.createActor()` with off-world position |
| `World.AddFrameEndTask(w => w.Add(a))` -- deferred add to world | Same deferred pattern via frame-end queue |
| `a.QueueActivity(new Fly(...))` -- activity chaining | Same: `actor.queueActivity(new Fly(...))` using Ch9 Activity system |
| `AttackBomber.SetTarget()` / `ParaDrop.SetLZ()` | Same: trait method calls on the spawned aircraft |
| `OnEnteredAttackRange` / `OnExitedAttackRange` / `OnRemovedFromWorld` callbacks | Same: event emitters or callback properties on the trait |
| 2D formation math: `spawnOffset = WVec.Rotate(attackRotation)` | 3D equivalent: `Vector3.TransformCoordinates(spawnOffsetVec3, rotationMatrix)` on XZ plane |
| `map.DistanceToEdge(target, delta)` calculation | Same geometric calculation using 3D map bounds on XZ plane |
| Camera actor spawning (snap camera to airstrike) | `ArcRotateCamera` target transition or scene `activeCamera` swap |

### 3.4 Nuke Power

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `NukeLaunch` projectile (Ch8 Phase B -- already migrated to TS) | Directly reuse `NukeLaunch.ts` |
| `RevealShroudEffect` camera reveal | Create `RevealShroudEffect` that modifies `Shroud` visibility (Ch12 foundation) |
| `Beacon` with clock fraction driven by `missile.FractionComplete` | 3D Beacon with same callback pattern (see 3.2 above) |
| `SelectNukePowerTarget` renders `RangeCircleAnnotationRenderable` | 3D circle mesh as semi-transparent `MeshBuilder.CreateDisc()` or `CreateTorus()` at cursor ground position |
| `CircleColor` / `CircleBorderColor` with alpha | `StandardMaterial` with `alpha` and `emissiveColor` |

### 3.5 GrantExternalConditionPower (Footprint Rendering)

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `CellsMatching()` yields `CPos` for each 'x' in footprint string | Same grid-based logic (pure computation, no rendering change) |
| `SpriteRenderable` per footprint cell (2D overlay) | `MeshBuilder.CreateGround()` semi-transparent tile at each cell position |
| `ISelectionDecorations.RenderSelectionAnnotations()` -- red highlight on affected units | `HighlightLayer` with red color, or `GlowLayer` on affected meshes |
| `UnitsInRange()` query via `ActorMap.GetActorsAt(t)` | Same spatial query pattern via `ActorMap` or world actor registry |

### 3.6 ProduceActorPower (Production Integration)

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `Production.Produce(actor, actorInfo, type, inits, 0)` | Same: `Production.produce()` from Ch11 |
| `actorsWithTrait<Production>()` LINQ chain with ordering | TypeScript array filter/sort chain with same priority ordering |
| `IsPrimaryBuilding()` / `ActorID` ordering | Same property access on actor (Ch11 foundation) |

### 3.7 SupportPowerChargeBar

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `ISelectionBar.GetValue()` returns 0-1 float | Same interface |
| `INotifyOwnerChanged.OnOwnerChanged()` re-fetches `SupportPowerManager` | Same pattern: re-lookup on player change |
| 2D bar rendering (colored rectangle based on charge percentage) | 3D health bar mesh positioned above the building (scales width) |

### 3.8 Activation Animation/Overlay

| OpenRA (C#) | Babylon.js (3D) |
|-------------|-----------------|
| `WithSupportPowerActivationAnimation` plays custom animation on `WithSpriteBody` | Same: `wsb.playCustomAnimation(info.Sequence)` |
| `WithSupportPowerActivationOverlay` adds `AnimationWithOffset` to `RenderSprites` | Same: create overlay mesh as child of body, play animation sequence |
| 2D overlay sprite at offset from body orientation | 3D billboard sprite at `body.localToWorld(offset)` position |

---

## 4. Dependency Graph

### 4.1 Internal Dependencies (Within Chapter 13)

```
SupportPower.ts (Phase A)
  |
  +-- SupportPowerManager.ts (Phase A)
  |     |
  |     +-- DirectionalSupportPower.ts (Phase A)
  |     |     +-- SelectDirectionalTarget.ts (Phase A)
  |     |     +-- AirstrikePower.ts (Phase B)
  |     |     +-- ParatroopersPower.ts (Phase B)
  |     |
  |     +-- NukePower.ts (Phase B)
  |     +-- ProduceActorPower.ts (Phase B)
  |     +-- SpawnActorPower.ts (Phase B)
  |     +-- GrantExternalConditionPower.ts (Phase B)
  |
  +-- SupportPowerChargeBar.ts (Phase C) -- depends on SupportPowerManager
  +-- WithSupportPowerActivationAnimation.ts (Phase C) -- depends on INotifySupportPower
  +-- WithSupportPowerActivationOverlay.ts (Phase C) -- depends on INotifySupportPower
  +-- SupportPowerCrateAction.ts (Phase C) -- depends on SupportPowerManager (creates power-granting proxy)

Beacon.ts (Phase A) -- used by AirstrikePower, ParatroopersPower, NukePower
```

### 4.2 Critical Path (Serial Dependencies)

```
SupportPower (abstract base) --> SupportPowerManager (manager) --> SupportPowerInstance (state machine)
    --> DirectionalSupportPower (directional variant)
        --> SelectDirectionalTarget (directional targeting UI)
            --> AirstrikePower (uses directional targeting)
            --> ParatroopersPower (uses directional targeting)
    --> NukePower (needs NukeLaunch + RevealShroudEffect)
    --> ProduceActorPower (needs Production system)
    --> SpawnActorPower (needs target validation)
    --> GrantExternalConditionPower (needs ExternalCondition + footprint rendering)

Beacon --> AirstrikePower / ParatroopersPower / NukePower
```

### 4.3 External Dependencies on Other Chapters

```
Phase A files require:
  SupportPower.ts:          Ch3 (PausableConditionalTrait, Actor, Player, World)
                            Ch6 (Order, IResolveOrder for Manager)
                            Ch7 (Sound)
  SupportPowerManager.ts:   Ch3 (World, Actor, Player, ITick, TraitDictionary)
                            Ch6 (IResolveOrder, Order)
                            Ch11 (TechTree, ITechTreeElement)
  DirectionalSupportPower:  SupportPower, Ch3 base
  SelectDirectionalTarget:  Ch5 (WorldInteraction, MouseAttachment, Widget)
                            Ch7 (Input, Keycode)
                            Ch4 (Map, CPos)
  Beacon.ts:                Ch2 (Animation, Sprite, Sheet)
                            Ch7 (IEffect, IEffectAboveShroud interfaces)

Phase B files require:
  AirstrikePower.ts:        Phase A (all), Ch9 (Aircraft, Fly, AttackBomber)
                            Ch7 (Sound, PlayLaunchSounds)
  NukePower.ts:             Phase A (all), Ch8 (NukeLaunch, WeaponInfo)
                            Ch12 (RevealShroudEffect)
  ParatroopersPower.ts:     Phase A (all), Ch9 (Aircraft, Fly, ParaDrop, Cargo, Passenger)
                            Ch7 (Sound)
  ProduceActorPower.ts:     Phase A (all), Ch11 (Production, ProductionQueue)
                            Ch7 (Sound)
  SpawnActorPower.ts:       Phase A (all), Ch4 (Map, TerrainInfo)
                            Ch12 (Shroud)
                            Ch7 (Sound, SpriteEffect)
  GrantExternalConditionPower: Phase A (all), Ch3 (ExternalCondition, ActorMap)
                            Ch2 (Sprite, TerrainSpriteLayer)

Phase C files require:
  SupportPowerChargeBar:    Phase A (SupportPowerManager)
                            Ch3 (ISelectionBar, INotifyOwnerChanged)
  ActivationAnimation/Overlay: Phase A (INotifySupportPower)
                            Ch7 (RenderSprites, WithSpriteBody, AnimationWithOffset)
  SupportPowerCrateAction:  Phase A (SupportPowerManager for proxy creation)
                            Ch3 (CrateAction base class)
```

### 4.4 Parallelization Opportunities

**Within Phase A** (after SupportPower base):
- DirectionalSupportPower + SelectDirectionalTarget can be developed in parallel with Beacon

**Within Phase B** (after Phase A complete):
- All 6 implementation files can be developed in parallel
- SpawnActorPower + ProduceActorPower are simpler and can serve as "warm-up" tasks
- AirstrikePower + ParatroopersPower share formation math (can share a utility)
- NukePower can start immediately (NukeLaunch already migrated)
- GrantExternalConditionPower can start in parallel (ExternalCondition needs to be checked but Ch8 GrantExternalConditionWarhead already references it)

**Within Phase C** (after Phase A + INotifySupportPower interface):
- All 4 files can be developed in parallel

### 4.5 Dependency Blockers (Things That Must Be Done First)

| Blocker | Status | Impact |
|---------|--------|--------|
| `Beacon.ts` (143 lines C#) | NOT MIGRATED | Blocks Airstrike, Paratroopers, Nuke beacon rendering |
| `RevealShroudEffect.ts` | NOT MIGRATED | Blocks Nuke camera reveal. Deferrable: Nuke works without it. |
| `ExternalCondition.ts` | NOT MIGRATED (Ch8 GrantExternalConditionWarhead references it) | Blocks GrantExternalConditionPower |
| `INotifySupportPower` interface in `TraitsInterfaces.ts` | NOT ADDED | Blocks Phase C render traits and the Cloak integration |
| `CrateAction` base class | NOT MIGRATED (Ch3 deferral) | Blocks SupportPowerCrateAction. Deferrable: crate action is a small file. |

---

## 5. Risk Assessment

### 5.1 Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **Beacon rendering complexity**: Beacon has 4 Animation layers + clock fraction callback. 3D conversion to billboard sprites with bobbing arrow requires careful Z-ordering and multi-mesh management. | HIGH | HIGH | Start Beacon early as Phase A dependency. Use layered Mesh approach with shared parent TransformNode. |
| **ParatroopersPower complexity**: Longest file, deepest dependency chain (Aircraft, Fly, ParaDrop, Cargo, Passenger, Beacon). Multiple aircraft and units created/destroyed. OnEnterRange/OnExitRange/OnRemovedFromWorld callbacks are intricate. | HIGH | MEDIUM | This is the most complex power. Assign to most experienced developer. Break into sub-steps: (1) aircraft spawning + Fly activities, (2) paratroop drop, (3) beacon/camera cleanup. |
| **Aircraft spawning integration**: Airstrike and Paratroopers both spawn aircraft at map edges with formation offsets. Requires precise position math (DistanceToEdge, WVec.Rotate). If Ch9 Aircraft/Fly activities have bugs, these powers will expose them. | MEDIUM | MEDIUM | Write targeted unit tests for the formation math before integration. Validate against OpenRA behavior with known inputs. |
| **ExternalCondition dependency**: The GrantExternalConditionPower needs ExternalCondition trait, which may not be fully migrated. | MEDIUM | MEDIUM | Check Ch8 GrantExternalConditionWarhead.ts for how ExternalCondition is used. If stubbed, can stub here too. |
| **Sound/notification system load**: SupportPowerInfo has 32 sound/notification slots. Not all need immediate implementation, but the structural pattern must handle them. | LOW | HIGH | The pattern is uniform: each notification category (Detected, BeginCharge, EndCharge, SelectTarget, InsufficientPower, Launch, Incoming) has Sound + SpeechNotification + TextNotification. Implement as a helper method that dispatches all three from a config object. |
| **OrderGenerator interface mismatch**: The TypeScript `IOrderGenerator` interface differs from the C# `IOrderGenerator` (e.g., `order()` returns `Generator<Order>` instead of `IEnumerable<Order>`). Support power OGs must conform to the TS interface. | LOW | LOW | Study PlaceBuildingOrderGenerator.ts for the TS pattern and adapt all OGs accordingly. |
| **Performance: Charge timer precision**: Sub-tick (100x resolution) timer uses integer math. In TypeScript, `number` is float64. Must ensure integer precision for sync hash determinism. | LOW | LOW | Use `Math.floor()` or integer arithmetic; validate with sync hash tests. |

### 5.2 Performance Targets

| Component | Target | Measurement |
|-----------|--------|-------------|
| SupportPowerInstance.Tick() | <0.1ms per instance | Sum of all instance ticks for a player |
| SupportPowerManager.Tick() | <1ms for all powers | All instance ticks + event checks |
| Beacon.Tick() | <0.5ms per beacon | Per-beacon tick includes 4 animation ticks |
| AirstrikePower.Activate() | <10ms one-time (spawns aircraft) | One-time activation, not per-tick |
| SelectDirectionalTarget mouse move | <1ms per mouse event | Arrow computation + sprite lookup |
| GrantExternalConditionPower.Activate() | <5ms for up to 100 units | UnitsInRange + condition grants |

---

## 6. Architecture Decision Records (ADRs)

### ADR-13.1: SupportPower Targeting Mode Integration

**Context**: Support powers need a way to let the player select a target on the map. OpenRA does this by setting `World.OrderGenerator` to a power-specific order generator. In the TypeScript+Babylon.js architecture, the `WorldInteractionControllerWidget` (Ch5 Phase E) already handles the generic order generator pipeline.

**Decision**: Support power targeting will reuse the existing `WorldInteractionControllerWidget` by registering power-specific `IOrderGenerator` implementations. Each power creates its own order generator (SelectGenericPowerTarget, SelectDirectionalTarget, SelectNukePowerTarget, SelectSpawnActorPowerTarget, SelectConditionTarget) following the same pattern as `PlaceBuildingOrderGenerator` from Ch11.

**Alternatives Considered**:
- **Custom targeting UI per power**: Too much duplication. The order generator pattern is already tested and working.
- **Unified power targeting with configuration**: Would over-complicate the simple cases (Nuke has circles, Directional has arrows, Condition has footprints). Separate classes match OpenRA's architecture.

**Consequences**: All order generators must implement the TypeScript `IOrderGenerator` interface (signatures differ slightly from C#). The directional target drag-and-drop interaction requires careful mouse event handling.

### ADR-13.2: Charge Timer and State Machine

**Context**: `SupportPowerInstance` manages a charge timer with 100x sub-tick resolution (for `FastCharge` smoothing) and a state machine (Disabled -> Active -> Ready -> Activated -> reset).

**Decision**: The timer uses integer arithmetic with `remainingSubTicks` stored at 100x resolution. Each `Tick()` decrements by 100. The `FastCharge` override clamps to 2500 sub-ticks (= 25 display ticks). The state machine is a pure function of `remainingSubTicks`, `instancesEnabled`, `prereqsAvailable`, and `oneShotFired`.

**Alternatives Considered**:
- **Float-based timer**: Simpler but risks floating-point drift in network sync. Integer arithmetic preserves determinism.
- **Event-driven state machine with transitions**: Over-engineered for a simple countdown. The current linear state derivation is sufficient.

**Consequences**: The `RemainingTicks` getter (divides by 100) must return integer for UI display. Sync hash tests must verify that `remainingSubTicks` is deterministic across network clients.

### ADR-13.3: Beacon Rendering in 3D

**Context**: The `Beacon` effect renders above the shroud at a world position, showing an animated beacon marker, bobbing arrow, concentric circles, and a clock-style progress indicator. Used by Airstrike, Paratroopers, and Nuke powers.

**Decision**: Beacon will be rendered as a `TransformNode` with multiple child `Mesh` billboard planes. Each layer (beacon, arrow, circles, clock, poster) is a separate child mesh. The arrow bobbing animation oscillates `mesh.position.y`. Clock progress uses `updateVerticesData("uv")` on the clock mesh to select the correct frame. Visibility is controlled by `mesh.isVisible` based on `delay > 0 && owner.isAlliedWith(world.renderPlayer)`.

**Alternatives Considered**:
- **SpriteManager with custom shader**: Would batch better for many beacons, but beacons are rare (1-2 per power activation). Individual meshes are simpler.
- **GUI overlay (HTML/CSS)**: Would not respect 3D depth or camera perspective. 3D world-space beacons are preferred for immersion.

**Consequences**: Each beacon creates 4-5 meshes. Since beacons are temporary (removed when aircraft arrives or missile detonates), the GPU overhead is negligible. Must implement `dispose()` to clean up all meshes when the beacon is removed.

### ADR-13.4: Camera and Spawn Effects in 3D

**Context**: Airstrike and Paratroopers powers can spawn a "camera actor" that snaps the player's view to the target area. NukePower can spawn a `RevealShroudEffect` that temporarily reveals the detonation area.

**Decision**: Camera snapping will use `scene.activeCamera.position` or `ArcRotateCamera.target` transition with smoothing. The camera actor pattern (spawning an actor with `CameraActor` type that lives briefly then self-destructs) will be preserved but the actual camera binding is done via the scene's active camera rather than a custom camera controller.

**Alternatives Considered**:
- **Separate viewport camera**: Too complex for a temporary effect. Direct camera manipulation is simpler.
- **No camera snap**: Would lose the dramatic "cut to action" effect that makes superweapons satisfying.

**Consequences**: The `CameraActor` field in AirstrikePowerInfo and ParatroopersPowerInfo specifies which actor to spawn. This actor does not need full trait functionality -- it just needs to signal the camera system to focus on its position for a duration. A `CameraController` trait or global camera manager would be ideal but is out of scope for Ch13 (deferred to Ch16 or later).

### ADR-13.5: INotifySupportPower Interface Design

**Context**: The `INotifySupportPower` interface has two methods: `Charged(Actor self)` and `Activated(Actor self)`. It is implemented by render traits to trigger visual feedback when a power becomes ready or is activated. It is also implemented by `Cloak` to break cloak on power usage.

**Decision**: Add `INotifySupportPower` to `src/OpenRA.Game/Traits/TraitsInterfaces.ts` with:
```typescript
export interface INotifySupportPower {
  charged(actor: IGameActor): void
  activated(actor: IGameActor): void
}
```
The existing `Cloak.ts` (which already has a TODO for INotifySupportPower at TODO-12.A.4.7) will implement this interface. The two render traits (Phase C) will implement it to trigger their animations.

**Alternatives Considered**:
- **Event-based notification (pub/sub)**: More flexible but adds indirection. Direct interface calls match OpenRA's pattern and are simpler to test.
- **Make it part of ITick**: Would couple charge notifications to the tick cycle. Separate interface is cleaner.

**Consequences**: Any trait wanting to respond to support power events must implement this interface. The `SupportPower.Charged()` method iterates `self.traitsImplementing<INotifySupportPower>()` and calls each one -- same as the C# pattern.

### ADR-13.6: Support Power Sound/Notification Architecture

**Context**: `SupportPowerInfo` defines 32 fields across 7 notification categories (Detected, BeginCharge, EndCharge, SelectTarget, InsufficientPower, Launch, Incoming). Each category has up to 3 channels: Sound, SpeechNotification, TextNotification. The base `SupportPower` class plays these at appropriate lifecycle moments.

**Decision**: A helper utility `playPowerNotification(info, owner, category)` will be created that dispatches all three channels from a notification config object. This avoids repeating the 3-line notification pattern in every power. The helper will call `Sound.playToPlayer()`, `Sound.playNotification()`, and `TextNotificationsManager.addTransientLine()` from Ch7 Phase D.

**Alternatives Considered**:
- **Per-category method on SupportPower**: Would add 7 methods to the base class. The helper utility is more testable and reusable.
- **Notification system integration**: Could integrate with a broader notification manager, but that's out of scope for Ch13 (deferred to Ch16 or later).

**Consequences**: The notification helper is a pure TypeScript utility (no Babylon.js dependency) and can be unit-tested independently. The 32 Info fields become properties on the JSON config objects.

---

## 7. Phase Strategy

### 7.1 Recommendation: Three-Phase Approach

The Support Powers system naturally splits into three phases based on dependency ordering:

**Phase A: Infrastructure (5 files, 956 C# lines, ~2,500-3,200 TS lines)**
- `SupportPower.ts` -- Abstract base class + SupportPowerInfo
- `SupportPowerManager.ts` -- Manager + SupportPowerInstance + SelectGenericPowerTarget
- `DirectionalSupportPower.ts` -- Directional targeting variant
- `SelectDirectionalTarget.ts` -- Drag-to-set-direction order generator
- `Beacon.ts` -- 3D beacon effect (blocker for Airstrike, Paratroopers, Nuke)

**Phase B: Implementations (6 files, 1,204 C# lines, ~3,500-4,500 TS lines)**
- `AirstrikePower.ts` -- Aircraft airstrike
- `NukePower.ts` -- Nuclear missile + range circles
- `ParatroopersPower.ts` -- Paradrop via aircraft
- `ProduceActorPower.ts` -- Production queue integration
- `SpawnActorPower.ts` -- Spawn actor at target
- `GrantExternalConditionPower.ts` -- Condition grant in footprint area

**Phase C: Render Traits + Crate (4 files, 233 C# lines, ~600-800 TS lines)**
- `SupportPowerChargeBar.ts` -- Building charge bar
- `WithSupportPowerActivationAnimation.ts` -- Activation animation
- `WithSupportPowerActivationOverlay.ts` -- Activation overlay
- `SupportPowerCrateAction.ts` -- Crate power grant

### 7.2 Development Order

```
Phase A (serial dependencies, must be done first):
  1. SupportPower.ts (abstract base -- everything depends on this)
  2. SupportPowerManager.ts (depends on #1)
  3. Beacon.ts (can be parallel with #2, needed by Phase B)
  4. DirectionalSupportPower.ts (depends on #1)
  5. SelectDirectionalTarget.ts (depends on #4)

Phase B (parallel, after Phase A):
  6. SpawnActorPower.ts (simplest power, good warm-up)
  7. ProduceActorPower.ts (medium, depends on Ch11 Production)
  8. NukePower.ts (depends on Ch8 NukeLaunch)
  9. AirstrikePower.ts (depends on Ch9 Aircraft + Beacon)
  10. ParatroopersPower.ts (most complex, last in phase)
  11. GrantExternalConditionPower.ts (depends on ExternalCondition)

Phase C (parallel, after Phase A + INotifySupportPower interface):
  12. SupportPowerChargeBar.ts
  13. WithSupportPowerActivationAnimation.ts
  14. WithSupportPowerActivationOverlay.ts
  15. SupportPowerCrateAction.ts
```

### 7.3 Pre-Migration Tasks (Must Complete Before Phase A)

1. Add `INotifySupportPower` interface to `src/OpenRA.Game/Traits/TraitsInterfaces.ts`
2. Verify `IOrderGenerator` interface in `TraitsInterfaces.ts` is compatible with all order generator needs (mouse input, annotations rendering)
3. Check `ExternalCondition.ts` status -- if not migrated, create a stub for GrantExternalConditionPower
4. Verify `NukeLaunch.ts` can be directly reused by `NukePower.ts`

### 7.4 Estimated Effort

| Phase | Files | Complexity Range | Estimated Developer Days |
|:---|:---:|:---|:---:|
| A | 5 | LOW to HIGH | 3-4 days |
| B | 6 | MEDIUM to HIGHEST | 4-5 days |
| C | 4 | LOW to MEDIUM | 1-2 days |
| **Total** | **15** | | **8-11 days** |

These estimates assume:
- All Chapter 2-12 infrastructure is working and tested
- Beacon.ts is new 3D effect (no existing pattern to follow)
- ParatroopersPower requires the most careful attention due to multi-actor lifecycle
- Review cycles add approximately 1 day per phase

---

## 8. Appendix: Support Power Widget Files

The following widget files are **out of scope** for Chapter 13 and will be migrated in Chapter 16 (UI Widget Extensions). They are documented here for reference:

| # | OpenRA Source | C# Lines | Description |
|:---:|:---|:---:|:---|
| W1 | `OpenRA.Mods.Common/Widgets/SupportPowersWidget.cs` | ~352 | Sidebar palette displaying ready/charging support power icons |
| W2 | `OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.cs` | ~108 | Overlay showing countdown timers for pending powers |
| W3 | `OpenRA.Mods.Common/Widgets/Logic/Ingame/SupportPowerBinLogic.cs` | ~42 | Logic binding SupportPowersWidget to SupportPowerManager |
| W4 | `OpenRA.Mods.Common/Widgets/Logic/Ingame/SupportPowerTooltipLogic.cs` | ~28 | Logic for hovering tooltip on support power icons |

These widgets render the support power icons in the UI sidebar and display countdown timers. They depend on `SupportPowerManager.GetPowersForActor()` and `SupportPowerInstance.RemainingTicks`/`Ready`/`Active` properties -- all of which are implemented in Chapter 13.
