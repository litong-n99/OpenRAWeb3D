# OpenRA to Babylon.js Migration Plan: Chapter 20 -- Scripting System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 9 (Scripting/Mission System)
> **Chapter Status**: PLANNING (0/66 migrated, 0%)
> **Planning Date**: 2026-06-17
> **Prerequisite**: Chapters 2-19 COMPLETE (603/603, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Scripting Core Infrastructure](#31-phase-a-scripting-core-infrastructure)
   - 3.2 [Phase B: Trigger System & Trait Bridge](#32-phase-b-trigger-system--trait-bridge)
   - 3.3 [Phase C: Global API Tables](#33-phase-c-global-api-tables)
   - 3.4 [Phase D: Actor Property Groups](#34-phase-d-actor-property-groups)
   - 3.5 [Phase E: Player Property Groups](#35-phase-e-player-property-groups)
   - 3.6 [Phase F: C&C Mod Scripting Properties](#36-phase-f-cc-mod-scripting-properties)
   - 3.7 [Phase G: Lua VM Integration (Optional Full-Lua Support)](#37-phase-g-lua-vm-integration-optional-full-lua-support)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The OpenRA Scripting System is a **C#-to-Lua bridge** that exposes game APIs (actors, players, map, triggers, UI, media) to mission scripts written in Lua 5.2. At runtime, `.lua` files are loaded from the map package, sandboxed into a restricted Lua environment, and executed. Map authors use Lua to script campaign missions: spawning units, registering event callbacks, managing objectives, playing FMVs, and controlling game flow.

The core paradigm shift: **from .NET reflection-based Lua binding to a TypeScript-native mission scripting architecture**:

- **OpenRA pattern**: `ScriptContext` creates an Eluant (Lua 5.2) runtime, uses .NET reflection to discover `ScriptGlobal`, `ScriptActorProperties`, and `ScriptPlayerProperties` subclasses, wraps their public methods/properties via `ScriptMemberWrapper`, and exposes them as Lua globals. `ScriptTriggers` (a C# trait implementing ~18 `INotify*` interfaces) bridges game events to user-registered Lua callbacks.
- **Babylon.js pattern**: Two-tier approach -- (1) a **declarative JSON-based trigger/event system** as the primary mission scripting API, covering 80%+ of mission patterns without a Lua dependency; (2) an **optional fengari-based Lua 5.3 runtime** for backward compatibility with existing OpenRA mission scripts.

### 1.2 The Two-Tier Architecture

**Tier 1 -- Declarative JSON Trigger System (MVP, all phases A-F):**

A JSON-based mission definition format that replaces Lua scripts for common patterns:
```json
{
  "triggers": [
    {
      "event": "OnActorKilled",
      "actor": "e1_patrol_01",
      "action": { "type": "SendReinforcements", "player": "GoodGuy", "types": ["e1","e1","e2"], "path": [[5,10],[10,12]] }
    },
    {
      "event": "OnAllKilled",
      "actors": ["e1_patrol_01", "e1_patrol_02", "e2_patrol_01"],
      "action": { "type": "MarkObjectiveCompleted", "player": "GoodGuy", "id": 1 }
    }
  ],
  "objectives": [
    { "player": "GoodGuy", "description": "Eliminate enemy patrol", "type": "Primary" }
  ],
  "scripts": ["lua/init.lua"]
}
```

This approach uses TypeScript classes that mirror OpenRA's Global and Properties APIs but register them as event handlers rather than Lua bindings. The optional `scripts` field points to Lua files for advanced users who need the full Lua API.

**Tier 2 -- fengari Lua VM (optional Phase G):**

The `fengari` library (pure JS Lua 5.3 implementation) provides full Lua scripting compatibility. Unlike `lua.vm.js` (Emscripten-compiled C Lua), fengari is tree-shakeable, works with Vite's ESM bundling, and has no native dependencies. It is loaded dynamically only when a map contains Lua scripts.

### 1.3 Architecture Principles

1. **Event-driven, not reflection-driven**: TypeScript has no `System.Reflection`. Instead of dynamically discovering methods at runtime, use explicit registration -- each Property class exports a static `register()` method that adds itself to a `ScriptRegistry`.

2. **JSON-first for MVP**: The declarative trigger system handles the most common mission patterns (timers, actor lifecycles, reinforcements, objectives, media playback) without requiring a Lua VM. This reduces bundle size and complexity for the majority use case.

3. **Optional Lua for power users**: When a map includes `.lua` files, the fengari runtime loads on-demand via dynamic `import()`. The same TypeScript API classes serve double duty -- they register both as JSON-trigger handlers and as Lua global bindings when fengari is active.

4. **Sandbox paranoia preserved**: OpenRA's `ScriptContext` carefully removes dangerous Lua globals (`os`, `io`, `require`, `dofile`, `dostring`, `random`, `randomseed`). The TypeScript migration must replicate this sandboxing, whether via JSON validation schema or fengari's `setfenv`-equivalent.

5. **Memory and instruction limits**: OpenRA limits Lua scripts to 50 MB memory and 1,000,000 instructions per call. The JSON trigger system avoids this entirely (bounded parsing). The fengari integration should implement a watchdog timer for Lua execution.

6. **Sync safety**: OpenRA removes `math.random`/`math.randomseed` from the Lua sandbox because they are not network-safe. The JSON trigger system must use the deterministic `World.SharedRandom` for all random operations.

7. **Activity queue integration**: OpenRA's `CallLuaFunc` lets Lua functions run inside the actor activity queue. In TypeScript, this maps to `actor.queueActivity(new CallScriptFunc(fn))` where `fn` is either a TypeScript callback or a fengari-wrapped Lua function.

### 1.4 Completed Foundation

The following infrastructure from Chapters 2-19 is available for Chapter 20:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `INotify*` interfaces |
| Activity base class | Ch3 Phase F | `Activity` abstract class + `ActivityRunner` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA* pathfinder |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| Order + Connection + OrderManager | Ch6 | `Order`, `UnitOrders`, `OrderManager` |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Audio | Ch7 | `InputHandler`, `Viewport`, `Sound`, `SoundDevice` |
| Weapons & Combat | Ch8 | `AttackBase`, `IHealth`, `Damage`, warhead system |
| Movement & Physics | Ch9 | `Mobile`, `IMove`, `Move` activity |
| Production & Building | Ch11 | `ProductionQueue`, `Production`, `BuildableInfo` |
| Support Powers | Ch13 | `SupportPower`, chronoshift, ion cannon |
| Activities | Ch14 | `Hunt`, `AttackMoveActivity`, `Move`, `RideTransport` |
| UI Widget Extensions | Ch16 | `LabelWidget`, `VideoPlayerWidget`, `LogicTickerWidget` |
| Mod-Specific Content | Ch19 | Sprite loaders, asset pipelines |

### 1.5 Files NOT to Migrate (Deferred or NOP)

| File | Reason for Non-Migration |
|------|--------------------------|
| `ScriptMemberExts.cs` (LuaDoc helpers) | LuaDoc is for OpenRA's EmmyLua documentation generator. The JSON schema provides equivalent self-documentation. Deferred to Phase G if fengari is adopted. |
| `ScriptMemberWrapper.cs` (reflection wrapper) | .NET reflection has no TypeScript equivalent. Replaced by explicit `ScriptRegistry` registration at module load time. The concept is reimplemented, not directly ported. |
| `ScriptEmmyTypeOverrideAttribute.cs` | EmmyLua type hint attribute. Only relevant if full Lua API documentation is needed (Phase G). |
| `Media.cs` (FMV static helper) | The FMV playback logic is a thin wrapper around `VideoPlayerWidget`. Its functionality is absorbed into `MediaGlobal.ts`. |

---

## 2. File Mapping Table

This table provides a COMPLETE inventory of every file in the OpenRA scripting system. The initial estimate of 7 files in the high-level plan was incomplete -- the actual count is 66 files across 3 modules.

| # | OpenRA Source File | C# Lines | Target TS File | Complexity | Phase |
|---|-------------------|----------|----------------|------------|-------|
| **OpenRA.Game/Scripting/ (7 files)** |
| 1 | `OpenRA.Game/Scripting/ScriptContext.cs` | 346 | `src/OpenRA.Game/Scripting/ScriptContext.ts` | HIGH | A |
| 2 | `OpenRA.Game/Scripting/ScriptTypes.cs` | 192 | `src/OpenRA.Game/Scripting/ScriptTypes.ts` | MEDIUM | A |
| 3 | `OpenRA.Game/Scripting/ScriptMemberWrapper.cs` | 157 | *(absorbed into ScriptRegistry.ts)* | MEDIUM | A |
| 4 | `OpenRA.Game/Scripting/ScriptObjectWrapper.cs` | 95 | `src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts` | MEDIUM | A |
| 5 | `OpenRA.Game/Scripting/ScriptMemberExts.cs` | 74 | *(deferred -- LuaDoc only)* | LOW | -- |
| 6 | `OpenRA.Game/Scripting/ScriptActorInterface.cs` | 57 | `src/OpenRA.Game/Scripting/ScriptActorInterface.ts` | LOW | A |
| 7 | `OpenRA.Game/Scripting/ScriptPlayerInterface.cs` | 30 | `src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts` | LOW | A |
| **OpenRA.Mods.Common/Scripting/ (root level -- 4 files)** |
| 8 | `OpenRA.Mods.Common/Scripting/ScriptTriggers.cs` | 560 | `src/OpenRA.Mods.Common/Scripting/ScriptTriggers.ts` | HIGH | B |
| 9 | `OpenRA.Mods.Common/Scripting/LuaScript.cs` | 66 | `src/OpenRA.Mods.Common/Scripting/ScriptComponent.ts` | MEDIUM | B |
| 10 | `OpenRA.Mods.Common/Scripting/CallLuaFunc.cs` | 60 | `src/OpenRA.Mods.Common/Scripting/CallScriptFunc.ts` | LOW | B |
| 11 | `OpenRA.Mods.Common/Scripting/ScriptEmmyTypeOverrideAttribute.cs` | 26 | *(deferred -- LuaDoc only)* | LOW | -- |
| 12 | `OpenRA.Mods.Common/Scripting/Media.cs` | 68 | *(absorbed into MediaGlobal.ts)* | LOW | C |
| **OpenRA.Mods.Common/Scripting/Global/ (16 files)** |
| 13 | `.../Global/TriggerGlobal.cs` | 588 | `src/OpenRA.Mods.Common/Scripting/Global/TriggerGlobal.ts` | HIGH | C |
| 14 | `.../Global/ActorGlobal.cs` | 192 | `src/OpenRA.Mods.Common/Scripting/Global/ActorGlobal.ts` | MEDIUM | C |
| 15 | `.../Global/ReinforcementsGlobal.cs` | 204 | `src/OpenRA.Mods.Common/Scripting/Global/ReinforcementsGlobal.ts` | MEDIUM | C |
| 16 | `.../Global/MediaGlobal.cs` | 182 | `src/OpenRA.Mods.Common/Scripting/Global/MediaGlobal.ts` | MEDIUM | C |
| 17 | `.../Global/MapGlobal.cs` | 166 | `src/OpenRA.Mods.Common/Scripting/Global/MapGlobal.ts` | MEDIUM | C |
| 18 | `.../Global/UtilsGlobal.cs` | 155 | `src/OpenRA.Mods.Common/Scripting/Global/UtilsGlobal.ts` | MEDIUM | C |
| 19 | `.../Global/PlayerGlobal.cs` | 36 | `src/OpenRA.Mods.Common/Scripting/Global/PlayerGlobal.ts` | LOW | C |
| 20 | `.../Global/CameraGlobal.cs` | 29 | `src/OpenRA.Mods.Common/Scripting/Global/CameraGlobal.ts` | LOW | C |
| 21 | `.../Global/ColorGlobal.cs` | 127 | `src/OpenRA.Mods.Common/Scripting/Global/ColorGlobal.ts` | LOW | C |
| 22 | `.../Global/CoordinateGlobals.cs` | 107 | `src/OpenRA.Mods.Common/Scripting/Global/CoordinateGlobals.ts` | LOW | C |
| 23 | `.../Global/DateTimeGlobal.cs` | 94 | `src/OpenRA.Mods.Common/Scripting/Global/DateTimeGlobal.ts` | LOW | C |
| 24 | `.../Global/LightingGlobal.cs` | 67 | `src/OpenRA.Mods.Common/Scripting/Global/LightingGlobal.ts` | LOW | C |
| 25 | `.../Global/UserInterfaceGlobal.cs` | 65 | `src/OpenRA.Mods.Common/Scripting/Global/UserInterfaceGlobal.ts` | LOW | C |
| 26 | `.../Global/BeaconGlobal.cs` | 54 | `src/OpenRA.Mods.Common/Scripting/Global/BeaconGlobal.ts` | LOW | C |
| 27 | `.../Global/AngleGlobal.cs` | 43 | `src/OpenRA.Mods.Common/Scripting/Global/AngleGlobal.ts` | LOW | C |
| 28 | `.../Global/RadarGlobal.cs` | 35 | `src/OpenRA.Mods.Common/Scripting/Global/RadarGlobal.ts` | LOW | C |
| **OpenRA.Mods.Common/Scripting/Properties/ (34 files)** |
| 29 | `.../Properties/GeneralProperties.cs` | 226 | `src/OpenRA.Mods.Common/Scripting/Properties/GeneralProperties.ts` | MEDIUM | D |
| 30 | `.../Properties/ProductionProperties.cs` | 311 | `src/OpenRA.Mods.Common/Scripting/Properties/ProductionProperties.ts` | HIGH | D |
| 31 | `.../Properties/CombatProperties.cs` | 110 | `src/OpenRA.Mods.Common/Scripting/Properties/CombatProperties.ts` | MEDIUM | D |
| 32 | `.../Properties/HealthProperties.cs` | 53 | `src/OpenRA.Mods.Common/Scripting/Properties/HealthProperties.ts` | LOW | D |
| 33 | `.../Properties/MobileProperties.cs` | 72 | `src/OpenRA.Mods.Common/Scripting/Properties/MobileProperties.ts` | LOW | D |
| 34 | `.../Properties/AircraftProperties.cs` | 61 | `src/OpenRA.Mods.Common/Scripting/Properties/AircraftProperties.ts` | LOW | D |
| 35 | `.../Properties/TransportProperties.cs` | 66 | `src/OpenRA.Mods.Common/Scripting/Properties/TransportProperties.ts` | LOW | D |
| 36 | `.../Properties/ConditionProperties.cs` | 59 | `src/OpenRA.Mods.Common/Scripting/Properties/ConditionProperties.ts` | LOW | D |
| 37 | `.../Properties/AmmoPoolProperties.cs` | 67 | `src/OpenRA.Mods.Common/Scripting/Properties/AmmoPoolProperties.ts` | LOW | D |
| 38 | `.../Properties/CloakProperties.cs` | 39 | `src/OpenRA.Mods.Common/Scripting/Properties/CloakProperties.ts` | LOW | D |
| 39 | `.../Properties/DemolitionProperties.cs` | 40 | `src/OpenRA.Mods.Common/Scripting/Properties/DemolitionProperties.ts` | LOW | D |
| 40 | `.../Properties/GuardProperties.cs` | 36 | `src/OpenRA.Mods.Common/Scripting/Properties/GuardProperties.ts` | LOW | D |
| 41 | `.../Properties/HarvesterProperties.cs` | 33 | `src/OpenRA.Mods.Common/Scripting/Properties/HarvesterProperties.ts` | LOW | D |
| 42 | `.../Properties/CaptureProperties.cs` | 47 | `src/OpenRA.Mods.Common/Scripting/Properties/CaptureProperties.ts` | LOW | D |
| 43 | `.../Properties/CarryallProperties.cs` | 49 | `src/OpenRA.Mods.Common/Scripting/Properties/CarryallProperties.ts` | LOW | D |
| 44 | `.../Properties/DeliveryProperties.cs` | 73 | `src/OpenRA.Mods.Common/Scripting/Properties/DeliveryProperties.ts` | LOW | D |
| 45 | `.../Properties/GainsExperienceProperties.cs` | 53 | `src/OpenRA.Mods.Common/Scripting/Properties/GainsExperienceProperties.ts` | LOW | D |
| 46 | `.../Properties/InstantlyRepairsProperties.cs` | 41 | `src/OpenRA.Mods.Common/Scripting/Properties/InstantlyRepairsProperties.ts` | LOW | D |
| 47 | `.../Properties/NukeProperties.cs` | 39 | `src/OpenRA.Mods.Common/Scripting/Properties/NukeProperties.ts` | LOW | D |
| 48 | `.../Properties/ParadropProperties.cs` | 43 | `src/OpenRA.Mods.Common/Scripting/Properties/ParadropProperties.ts` | LOW | D |
| 49 | `.../Properties/ParatroopersProperties.cs` | 40 | `src/OpenRA.Mods.Common/Scripting/Properties/ParatroopersProperties.ts` | LOW | D |
| 50 | `.../Properties/RepairableBuildingProperties.cs` | 47 | `src/OpenRA.Mods.Common/Scripting/Properties/RepairableBuildingProperties.ts` | LOW | D |
| 51 | `.../Properties/ResourceProperties.cs` | 47 | `src/OpenRA.Mods.Common/Scripting/Properties/ResourceProperties.ts` | LOW | D |
| 52 | `.../Properties/ScaredCatProperties.cs` | 36 | `src/OpenRA.Mods.Common/Scripting/Properties/ScaredCatProperties.ts` | LOW | D |
| 53 | `.../Properties/SellableProperties.cs` | 31 | `src/OpenRA.Mods.Common/Scripting/Properties/SellableProperties.ts` | LOW | D |
| 54 | `.../Properties/TransformProperties.cs` | 36 | `src/OpenRA.Mods.Common/Scripting/Properties/TransformProperties.ts` | LOW | D |
| 55 | `.../Properties/AirstrikeProperties.cs` | 39 | `src/OpenRA.Mods.Common/Scripting/Properties/AirstrikeProperties.ts` | LOW | D |
| 56 | `.../Properties/DiplomacyProperties.cs` | 28 | `src/OpenRA.Mods.Common/Scripting/Properties/DiplomacyProperties.ts` | LOW | D |
| 57 | `.../Properties/PowerProperties.cs` | 73 | `src/OpenRA.Mods.Common/Scripting/Properties/PowerProperties.ts` | LOW | D |
| 58 | `.../Properties/PlayerProperties.cs` | 127 | `src/OpenRA.Mods.Common/Scripting/Properties/PlayerProperties.ts` | MEDIUM | E |
| 59 | `.../Properties/MissionObjectiveProperties.cs` | 129 | `src/OpenRA.Mods.Common/Scripting/Properties/MissionObjectiveProperties.ts` | MEDIUM | E |
| 60 | `.../Properties/PlayerConditionProperties.cs` | 58 | `src/OpenRA.Mods.Common/Scripting/Properties/PlayerConditionProperties.ts` | LOW | E |
| 61 | `.../Properties/PlayerExperienceProperties.cs` | 37 | `src/OpenRA.Mods.Common/Scripting/Properties/PlayerExperienceProperties.ts` | LOW | E |
| 62 | `.../Properties/PlayerStatsProperties.cs` | 47 | `src/OpenRA.Mods.Common/Scripting/Properties/PlayerStatsProperties.ts` | LOW | E |
| **OpenRA.Mods.Cnc/Scripting/Properties/ (4 files)** |
| 63 | `.../Cnc/Scripting/Properties/ChronosphereProperties.cs` | 49 | `src/OpenRA.Mods.Cnc/Scripting/Properties/ChronosphereProperties.ts` | LOW | F |
| 64 | `.../Cnc/Scripting/Properties/DisguiseProperties.cs` | 42 | `src/OpenRA.Mods.Cnc/Scripting/Properties/DisguiseProperties.ts` | LOW | F |
| 65 | `.../Cnc/Scripting/Properties/InfiltrateProperties.cs` | 44 | `src/OpenRA.Mods.Cnc/Scripting/Properties/InfiltrateProperties.ts` | LOW | F |
| 66 | `.../Cnc/Scripting/Properties/IonCannonProperties.cs` | 36 | `src/OpenRA.Mods.Cnc/Scripting/Properties/IonCannonProperties.ts` | LOW | F |

**Summary**: 66 files, ~6,339 lines of C# source. 62 files migrated (4 deferred/absorbed).

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Scripting Core Infrastructure

**Goal**: Establish the TypeScript-native scripting registry and object wrapper system. Replace OpenRA's .NET reflection-based Lua binding with explicit TypeScript registration.

**Files**: 6 migrated + 1 reimagined (ScriptMemberWrapper absorbed into ScriptRegistry)

| TODO# | File | Source Lines | Description | Status |
|-------|------|-------------|-------------|--------|
| TODO-20.A.1 | `ScriptContext.ts` | 346 | Core mission script host. Manages trigger registry, event dispatch, fatal error handling, sandbox config. Loads JSON trigger definitions from map. Optional Lua VM initialization. | [ ] |
| TODO-20.A.2 | `ScriptRegistry.ts` | (new, ~200) | Central registry for Global tables, Actor properties, and Player properties. Replaces ScriptMemberWrapper's reflection-based discovery with explicit `register()` calls at module import time. | [ ] |
| TODO-20.A.3 | `ScriptTypes.ts` | 192 | Type conversion utilities between TypeScript values and script-accessible representations. Replaces `LuaValueExts.TryGetClrValue`/`ToLuaValue` with TS-friendly equivalents. | [ ] |
| TODO-20.A.4 | `ScriptObjectWrapper.ts` | 95 | Abstract base class for script-exposed objects. Manages the member dictionary. Subclasses call `bind(objects)` to expose methods/properties. | [ ] |
| TODO-20.A.5 | `ScriptActorInterface.ts` | 57 | Actor-scoped script object wrapper. Filters available commands based on actor's traits. Handles destroyed-actor command filtering (`@ExposedForDestroyedActors`). | [ ] |
| TODO-20.A.6 | `ScriptPlayerInterface.ts` | 30 | Player-scoped script object wrapper. Exposes all `ScriptPlayerProperties` commands for a given player. | [ ] |

**Blocked by**: None (infrastructure chapter)
**Blocks**: Phase B (Triggers), Phase C (Globals), Phase D-F (Properties)

**Key Design Decisions for Phase A:**

1. **ScriptRegistry replaces reflection**: At module import time, each Global class calls `ScriptRegistry.registerGlobal('Actor', ActorGlobal)`. Each Property class calls `ScriptRegistry.registerActorProperty('General', GeneralProperties, [IHealthInfo, ...])` or `ScriptRegistry.registerPlayerProperty(...)`. The registry maps `ActorInfo` trait sets to available property classes.

2. **ScriptContext is the orchestrator**: It owns the `ScriptRegistry`, parses JSON triggers from the map, initializes the event dispatch system, and manages fatal error state. If a map includes `.lua` files, it dynamically imports the fengari adapter module.

3. **No per-frame allocation in hot path**: The trigger dispatch loop (`TriggerGlobal` methods) must reuse callback arrays and avoid allocation.

---

### 3.2 Phase B: Trigger System & Trait Bridge

**Goal**: Implement the event-driven mission scripting bridge. `ScriptTriggers` is the trait that connects 18 game event interfaces to user-registered callbacks. `ScriptComponent` is the world-level trait that owns the `ScriptContext`.

**Files**: 3 migrated

| TODO# | File | Source Lines | Description | Status |
|-------|------|-------------|-------------|--------|
| TODO-20.B.1 | `ScriptTriggers.ts` | 560 | Trait implementing 18 `INotify*` interfaces. Maintains per-Trigger callback lists. Bridges game events to script callbacks. Internal events (`OnKilledInternal`, `OnCapturedInternal`, etc.) for compound triggers. | [ ] |
| TODO-20.B.2 | `ScriptComponent.ts` | 66 | World-level trait (`LuaScript` in OpenRA). Owns `ScriptContext`. Implements `IWorldLoaded` (loads scripts, calls `WorldLoaded()`), `ITick` (calls `Tick()`), and dispose. | [ ] |
| TODO-20.B.3 | `CallScriptFunc.ts` | 60 | Activity that executes a script callback within the actor's activity queue. Used by `GeneralProperties.CallFunc()` and other queued script actions. | [ ] |

**Blocked by**: Phase A (ScriptContext, ScriptRegistry)
**Blocks**: Phase C (TriggerGlobal uses ScriptTriggers)

**Trigger Types to Implement (21 total):**

| # | Trigger | Interface | Callback Signature |
|---|---------|-----------|-------------------|
| 1 | `OnIdle` | `INotifyIdle` | `func(self: Actor)` |
| 2 | `OnDamaged` | `INotifyDamage` | `func(self: Actor, attacker: Actor, damage: number)` |
| 3 | `OnKilled` | `INotifyKilled` | `func(self: Actor, killer: Actor)` |
| 4 | `OnProduction` | `INotifyProduction` | `func(producer: Actor, produced: Actor)` |
| 5 | `OnOtherProduction` | `INotifyOtherProduction` | `func(producer: Actor, produced: Actor, productionType: string)` |
| 6 | `OnBuildingPlaced` | `INotifyBuildingPlaced` | `func(p: Player, placed: Actor)` |
| 7 | `OnPlayerWon` | `INotifyWinStateChanged` | `func(p: Player)` |
| 8 | `OnPlayerLost` | `INotifyWinStateChanged` | `func(p: Player)` |
| 9 | `OnObjectiveAdded` | `INotifyObjectivesUpdated` | `func(p: Player, id: number)` |
| 10 | `OnObjectiveCompleted` | `INotifyObjectivesUpdated` | `func(p: Player, id: number)` |
| 11 | `OnObjectiveFailed` | `INotifyObjectivesUpdated` | `func(p: Player, id: number)` |
| 12 | `OnCapture` | `INotifyCapture` | `func(self: Actor, captor: Actor, oldOwner: Player, newOwner: Player)` |
| 13 | `OnInfiltrated` | `INotifyInfiltrated` | `func(self: Actor, infiltrator: Actor)` |
| 14 | `OnAddedToWorld` | `INotifyAddedToWorld` | `func(self: Actor)` |
| 15 | `OnRemovedFromWorld` | `INotifyRemovedFromWorld` | `func(self: Actor)` |
| 16 | `OnDiscovered` | `INotifyDiscovered` | `func(discovered: Actor, discoverer: Player)` |
| 17 | `OnPlayerDiscovered` | `INotifyDiscovered` | `func(discovered: Player, discoverer: Player, actor: Actor)` |
| 18 | `OnPassengerEntered` | `INotifyPassengerEntered` | `func(transport: Actor, passenger: Actor)` |
| 19 | `OnPassengerExited` | `INotifyPassengerExited` | `func(transport: Actor, passenger: Actor)` |
| 20 | `OnSold` | `INotifySold` | `func(self: Actor)` |
| 21 | `OnTimerExpired` | `INotifyTimeLimit` | `func()` |

---

### 3.3 Phase C: Global API Tables

**Goal**: Migrate all 16 `ScriptGlobal` subclasses. These provide the top-level Lua table APIs (e.g., `Actor.Create(...)`, `Trigger.OnKilled(...)`, `Media.PlayMovieFullscreen(...)`). In the TypeScript architecture, each Global class registers itself with `ScriptRegistry` and exposes its methods to both JSON triggers and (optionally) the Lua VM.

**Files**: 16 migrated

| TODO# | File | Source Lines | Complexity | Description | Status |
|-------|------|-------------|------------|-------------|--------|
| TODO-20.C.1 | `TriggerGlobal.ts` | 588 | HIGH | 30+ trigger registration methods. `AfterDelay()`, `OnPassengerEntered/Exited()`, `OnIdle/Damaged/Killed()`, `OnAllKilled/OnAnyKilled()`, `OnProduction/OnAnyProduction()`, `OnPlayerWon/Lost()`, `OnObjectiveAdded/Completed/Failed()`, `OnBuildingPlaced()`, `OnAddedToWorld/RemovedFromWorld()`, `OnAllRemovedFromWorld()`, `OnCapture()`, `OnKilledOrCaptured/OnAllKilledOrCaptured()`, `OnEnteredFootprint/ExitedFootprint()`, `RemoveFootprintTrigger()`, `OnEnteredProximityTrigger/ExitedProximityTrigger()`, `RemoveProximityTrigger()`, `OnInfiltrated()`, `OnDiscovered/OnPlayerDiscovered()`, `OnSold()`, `OnTimerExpired()`, `ClearAll()`, `Clear()` | [ ] |
| TODO-20.C.2 | `ActorGlobal.ts` | 192 | MEDIUM | Actor creation (`Create()`), query (`BuildTime()`, `CruiseAltitude()`, `Cost()`). Handles `ActorInit` construction from script-provided tables. | [ ] |
| TODO-20.C.3 | `ReinforcementsGlobal.ts` | 204 | MEDIUM | Unit delivery system. `Reinforce(owner, types[], entryPath, interval, actionFunc)`, `ReinforceWithTransport(owner, transportType, cargoTypes[], entryPath, exitPath, actionFunc, exitFunc, dropRange)`. Handles air/ground/naval delivery with movement pathing. | [ ] |
| TODO-20.C.4 | `MediaGlobal.ts` | 182 | MEDIUM | Audio/video playback. `PlaySpeechNotification()`, `PlaySoundNotification()`, `PlaySound()`, `PlayMusic()`, `SetBackgroundMusic()`, `StopMusic()`, `PlayMovieFullscreen()`, `PlayMovieInRadar()`, `DisplayMessage()`, `DisplayMessageToPlayer()`, `DisplaySystemMessage()`, `Debug()`, `FloatingText()`. | [ ] |
| TODO-20.C.5 | `MapGlobal.ts` | 166 | MEDIUM | Map spatial queries. `ActorsInCircle()`, `ActorsInBox()`, `RandomCell()`, `RandomEdgeCell()`, `ClosestEdgeCell()`, `ClosestMatchingEdgeCell()`, `CenterOfCell()`, `TerrainType()`, `NamedActor()`, `NamedActors()`, `IsNamedActor()`, `ActorsWithTag()`, `ActorsInWorld()`, `LobbyOption()`, `IsSinglePlayer()`, `IsPausedShellmap()`. Also registers named map actors as script globals. | [ ] |
| TODO-20.C.6 | `UtilsGlobal.ts` | 155 | MEDIUM | Collection utilities. `Do()`, `Any()`, `All()`, `Where()`, `Take()`, `Skip()`, `Concat()`, `Random()`, `Shuffle()`, `ExpandFootprint()`, `RandomInteger()`, `FormatTime()`. | [ ] |
| TODO-20.C.7 | `PlayerGlobal.ts` | 36 | LOW | Player lookup. `GetPlayer(name)`, `GetPlayers(filter)`. | [ ] |
| TODO-20.C.8 | `CameraGlobal.ts` | 29 | LOW | Viewport center position get/set via `WorldRenderer.Viewport`. | [ ] |
| TODO-20.C.9 | `ColorGlobal.cs` | 127 | LOW | Color constructors. `FromRGB()`, `FromHSL()`, `FromHex()`, `FromName()`, color arithmetic, `Distance()`, `Clamp()`, `RandomHue()`. | [ ] |
| TODO-20.C.10 | `CoordinateGlobals.ts` | 107 | LOW | Coordinate utilities. `WPos.FromXY()`, `CPos.FromXY()`, `CVec.FromXY()`, `WVec.FromXY()`, conversion between coordinate types. | [ ] |
| TODO-20.C.11 | `DateTimeGlobal.ts` | 94 | LOW | Real-time clock access. `Now()`, `Seconds()`, `Minutes()`, `Hours()`, `Day()`, `Month()`, `Year()`, time formatting. | [ ] |
| TODO-20.C.12 | `LightingGlobal.ts` | 67 | LOW | Post-process effects. `Flash(type, ticks)`, `Red`/`Green`/`Blue`/`Ambient` tint get/set. | [ ] |
| TODO-20.C.13 | `UserInterfaceGlobal.ts` | 65 | LOW | UI text display. `SetMissionText(text, color)`, `GetFluentMessage(key, args)`. | [ ] |
| TODO-20.C.14 | `BeaconGlobal.ts` | 54 | LOW | Beacon placement. `New(owner, position, type, duration, showTick)` for creating timed beacons. | [ ] |
| TODO-20.C.15 | `AngleGlobal.ts` | 43 | LOW | Angle constructors. `New(degrees)`, `North`/`South`/`East`/`West` constants. | [ ] |
| TODO-20.C.16 | `RadarGlobal.ts` | 35 | LOW | Radar widget control. Create/remove custom radar events. | [ ] |

**Blocked by**: Phase A (ScriptObjectWrapper base class), Phase B (ScriptTriggers for TriggerGlobal)
**Blocks**: Phase D (some Properties reference Global constructors)

---

### 3.4 Phase D: Actor Property Groups

**Goal**: Migrate all 26 `ScriptActorProperties` subclasses. These expose trait-specific APIs on individual actors (e.g., `actor.Health`, `actor.Move(cell)`, `actor.Attack(target)`). Each property class requires one or more specific traits on the actor.

**Files**: 26 migrated

| TODO# | File | Source Lines | Required Traits | Description | Status |
|-------|------|-------------|-----------------|-------------|--------|
| TODO-20.D.1 | `GeneralProperties.ts` | 226 | (various) | 4 classes in 1 file: `BaseActorProperties` (IsInWorld, IsDead, IsIdle, Owner, Type, HasProperty, Flash, EffectiveOwner), `GeneralProperties` (Teleport, CallFunc, Wait, Destroy, Stop, Stance, TooltipName, Tags), `LocationProperties` (Location, CenterPosition), `FacingProperties` (Facing). | [ ] |
| TODO-20.D.2 | `ProductionProperties.ts` | 311 | Production, RallyPoint, PrimaryBuilding, ProductionQueue, ScriptTriggers | 5 classes in 1 file: `ProductionProperties` (Produce), `RallyPointProperties` (RallyPoint get/set), `PrimaryBuildingProperties` (IsPrimaryBuilding get/set), `ProductionQueueProperties` (Build, IsProducing), `ClassicProductionQueueProperties` (Build, IsProducing -- RA-style queues). Note: ClassicProductionQueueProperties extends ScriptPlayerProperties, not ScriptActorProperties. | [ ] |
| TODO-20.D.3 | `CombatProperties.ts` | 110 | AttackBase, IMove | 2 classes: `CombatProperties` (Hunt, AttackMove, Patrol, PatrolUntil), `GeneralCombatProperties` (Attack, CanTarget). | [ ] |
| TODO-20.D.4 | `HealthProperties.ts` | 53 | IHealth | Health get/set, MaxHealth, Kill(damageTypes). | [ ] |
| TODO-20.D.5 | `MobileProperties.ts` | 72 | Mobile | Move(cell), ScriptedMove(cell), MoveIntoWorld(cell), Scatter(), EnterTransport(actor), IsMobile. | [ ] |
| TODO-20.D.6 | `AircraftProperties.ts` | 61 | Aircraft | Land(cell), IsAboveGround(), Move(cell, closeEnough), ScriptedMove(cell). | [ ] |
| TODO-20.D.7 | `TransportProperties.ts` | 66 | Cargo, (various) | PassengerCount, Passenger(index), CargoCount, UnloadPassengers(), LoadPassenger(actor). | [ ] |
| TODO-20.D.8 | `ConditionProperties.ts` | 59 | ConditionManager | GrantCondition(condition), RevokeCondition(condition), IsConditionGranted(condition). | [ ] |
| TODO-20.D.9 | `AmmoPoolProperties.ts` | 67 | AmmoPool | AmmoCount(get), MaximumAmmoCount(get), Reloads(get), ReloadDelay(get/set). | [ ] |
| TODO-20.D.10 | `CloakProperties.ts` | 39 | Cloak | Cloak(get/set), CloakTypes(get), IsCloaked. | [ ] |
| TODO-20.D.11 | `DemolitionProperties.ts` | 40 | Demolition | Demolish(targetActor), IsDemolishing, DetonationDelay. | [ ] |
| TODO-20.D.12 | `GuardProperties.ts` | 36 | Guard | Guard(targetActor), IsGuarding(get). | [ ] |
| TODO-20.D.13 | `HarvesterProperties.ts` | 33 | Harvester | FindResources(), Harvest(cell), IsFull, IsEmpty. | [ ] |
| TODO-20.D.14 | `CaptureProperties.ts` | 47 | Captures | Capture(targetActor), CaptureTarget(get), CaptureComplete(get). | [ ] |
| TODO-20.D.15 | `CarryallProperties.ts` | 49 | Carryall | CarryallPickup(targetActor), CarryallDeliver(cell), IsCarrying, CarriedUnit. | [ ] |
| TODO-20.D.16 | `DeliveryProperties.ts` | 73 | Production | `Deliver(types[], target)` for heli/APC delivery to a target position. Handles cargo loading and unloading. | [ ] |
| TODO-20.D.17 | `GainsExperienceProperties.ts` | 53 | GainsExperience | Experience(get/set), Level(get/set), MaxLevel, NextLevel. | [ ] |
| TODO-20.D.18 | `InstantlyRepairsProperties.ts` | 41 | InstantlyRepairs | RepairBuildings(targetActor, closeEnough). | [ ] |
| TODO-20.D.19 | `NukeProperties.ts` | 39 | SupportPower (NukePower) | ActivateNukePower(target). | [ ] |
| TODO-20.D.20 | `ParadropProperties.ts` | 43 | Paradrop | Paradrop(cell), IsAvailable. | [ ] |
| TODO-20.D.21 | `ParatroopersProperties.ts` | 40 | ParatroopersPower | ActivateParatroopers(target). | [ ] |
| TODO-20.D.22 | `RepairableBuildingProperties.ts` | 47 | RepairableBuilding | StartBuildingRepairs(), StopBuildingRepairs(). | [ ] |
| TODO-20.D.23 | `ResourceProperties.cs` | 47 | ResourceCollector | Harvest(cell), ResourceType, ResourceCapacity, ResourceCount. | [ ] |
| TODO-20.D.24 | `ScaredCatProperties.ts` | 36 | ScaredyCat | Panic(), IsPanicking. | [ ] |
| TODO-20.D.25 | `SellableProperties.ts` | 31 | Sellable | Sell(). | [ ] |
| TODO-20.D.26 | `TransformProperties.ts` | 36 | Transforms | DeployTransform(), UndeployTransform(), IsDeployed, IsTransforming. | [ ] |
| TODO-20.D.27 | `AirstrikeProperties.ts` | 39 | AirstrikePower | ActivateAirstrike(targetActor). | [ ] |
| TODO-20.D.28 | `DiplomacyProperties.ts` | 28 | Diplomacy | SetStance(targetPlayer, stance), GetStance(targetPlayer), IsAlliedWith(targetPlayer). | [ ] |
| TODO-20.D.29 | `PowerProperties.ts` | 73 | Power, PowerManager | Power(get), PowerProvided(get), PowerDrained(get/set), TriggerPowerOutage(ticks). | [ ] |

**Blocked by**: Phase A (ScriptActorProperties base class), Phase C (some reference Global classes)
**Blocks**: Phase F (C&C properties extend the same base)

---

### 3.5 Phase E: Player Property Groups

**Goal**: Migrate `ScriptPlayerProperties` subclasses that expose player-level APIs.

**Files**: 5 migrated

| TODO# | File | Source Lines | Required Traits | Description | Status |
|-------|------|-------------|-----------------|-------------|--------|
| TODO-20.E.1 | `PlayerProperties.ts` | 127 | (player built-in) | InternalName, Name, Color, Faction, Spawn, HomeLocation, Team, Handicap, IsBot, IsNonCombatant, IsLocalPlayer, GetActors(), GetGroundAttackers(), GetActorsByType(type), GetActorsByTypes(types), HasPrerequisites(types). | [ ] |
| TODO-20.E.2 | `MissionObjectiveProperties.ts` | 129 | MissionObjectives | AddObjective(desc, type, required), AddPrimaryObjective(desc), AddSecondaryObjective(desc), MarkCompletedObjective(id), MarkFailedObjective(id), IsObjectiveCompleted(id), IsObjectiveFailed(id), GetObjectiveDescription(id), GetObjectiveType(id), HasNoRequiredUnits(). | [ ] |
| TODO-20.E.3 | `PlayerConditionProperties.ts` | 58 | ConditionManager (on PlayerActor) | GrantCondition(condition), RevokeCondition(condition), IsConditionGranted(condition). | [ ] |
| TODO-20.E.4 | `PlayerExperienceProperties.ts` | 37 | PlayerExperience | Experience(get/set), Level(get/set). | [ ] |
| TODO-20.E.5 | `PlayerStatsProperties.ts` | 47 | PlayerStatistics | Kills, Deaths, UnitsKilled, UnitsLost, BuildingsKilled, BuildingsLost, Experience, Score. | [ ] |

**Note**: `ClassicProductionQueueProperties` is in `ProductionProperties.ts` (Phase D) despite extending `ScriptPlayerProperties`.

**Blocked by**: Phase A (ScriptPlayerProperties base class), Phase D (ProductionProperties for ClassicProductionQueueProperties)
**Blocks**: Nothing (leaf nodes)

---

### 3.6 Phase F: C&C Mod Scripting Properties

**Goal**: Migrate the 4 C&C-specific `ScriptActorProperties` subclasses that expose C&C-exclusive traits (Chronosphere, Disguise, Infiltrate, Ion Cannon).

**Files**: 4 migrated

| TODO# | File | Source Lines | Required Traits | Description | Status |
|-------|------|-------------|-----------------|-------------|--------|
| TODO-20.F.1 | `ChronosphereProperties.ts` | 49 | ChronoshiftPower | `Chronoshift(unitLocationPairs, duration, killCargo)` -- teleports a table of actor->cell pairs. | [ ] |
| TODO-20.F.2 | `DisguiseProperties.ts` | 42 | Disguise | `DisguiseAs(target)` -- disguise as another actor. `DisguiseAsType(actorType, newOwner)` -- disguise as a type with specified owner. | [ ] |
| TODO-20.F.3 | `InfiltrateProperties.ts` | 44 | Infiltrates | `Infiltrate(target)` -- send actor to infiltrate a target building. | [ ] |
| TODO-20.F.4 | `IonCannonProperties.ts` | 36 | IonCannonPower | `ActivateIonCannon(target)` -- activate the ion cannon superweapon. | [ ] |

**Blocked by**: Phase A (base classes), Phase D (same pattern as Common Properties)
**Blocks**: Nothing (leaf nodes)

---

### 3.7 Phase G: Lua VM Integration (Optional)

**Goal**: Integrate the `fengari` Lua 5.3 VM for backward compatibility with existing OpenRA Lua mission scripts. This phase is OPTIONAL -- the JSON trigger system (Phases A-F) provides sufficient mission scripting for the MVP.

**New files**: ~3-5 files (not from OpenRA, purely migration-specific)

| TODO# | File | Description | Status |
|-------|------|-------------|--------|
| TODO-20.G.1 | `LuaRuntimeAdapter.ts` | Wrapper around `fengari` that implements the same sandbox restrictions as OpenRA's `ScriptContext`. Removes `os`, `io`, `require`, `dofile`, `dostring`, etc. Limits memory and instruction count. | [ ] |
| TODO-20.G.2 | `LuaBindingAdapter.ts` | Exposes Global/Properties APIs as Lua tables in the fengari runtime. Reuses the same TypeScript classes from Phases C-F. | [ ] |
| TODO-20.G.3 | `LuaValueAdapter.ts` | Type conversion bridge between fengari Lua values and TypeScript objects. Replaces `LuaValueExts` from `ScriptTypes.cs`. | [ ] |
| TODO-20.G.4 | `ScriptMemberExts.ts` | LuaDoc string generation helpers. Only needed if we want to generate EmmyLua API documentation. | [ ] |
| TODO-20.G.5 | `ScriptEmmyTypeOverrideAttribute.ts` / decorator | TypeScript decorator equivalent of `[ScriptEmmyTypeOverride]` for API doc generation. | [ ] |

**Blocked by**: All previous phases (A-F)
**Blocks**: Nothing (optional enhancement)

---

## 4. Dependency Graph

```
Phase A: Core Infrastructure (6 files)
  |
  +---> Phase B: Trigger System (3 files)
  |       |
  |       +---> Phase C: Global APIs (16 files)
  |       |       |
  |       |       +---> Phase D: Actor Properties (29 files)
  |       |       |       |
  |       |       |       +---> Phase E: Player Properties (5 files)
  |       |       |       |
  |       |       |       +---> Phase F: C&C Properties (4 files)
  |       |       |
  |       |       +---> Phase G: Lua VM (optional, 3-5 files)
  |       |
  +------> (ScriptRegistry used by all phases)
```

**Dependency Details:**
- Phase A has no chapter-20 dependencies (greenfield)
- Phase B depends on A (ScriptRegistry, ScriptContext, base wrappers)
- Phase C depends on A+B (ScriptObjectWrapper base from A, ScriptTriggers from B for TriggerGlobal)
- Phase D depends on A+C (ScriptActorProperties base from A, some Global classes from C for actor creation)
- Phase E depends on A+D (ScriptPlayerProperties base from A, ProductionProperties from D for ClassicProductionQueue)
- Phase F depends on A+D (same patterns)

**All phases depend on infrastructure from Chapters 2-19**, particularly:
- Chapter 3: `GameActor`, `Player`, traits, `Activity`, `TraitDictionary`
- Chapter 4: `Map`, `CPos`, `WPos`, `WDist`
- Chapter 7: `Sound`, `Viewport`
- Chapter 8: `IHealth`, `AttackBase`, `Damage`
- Chapter 9: `Mobile`, `IMove`
- Chapter 11: `Production`, `ProductionQueue`
- Chapter 13: `SupportPower` (for Chronosphere, IonCannon, Airstrike, Nuke, Paradrop)
- Chapter 14: Activity implementations (`Hunt`, `AttackMove`, `Move`)
- Chapter 19: Asset pipelines

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing (Vitest)

Each Phase must include comprehensive unit tests:

| Phase | Files | Expected Min Tests | Key Test Areas |
|-------|-------|--------------------|----------------|
| Phase A | 6 | ~60 | ScriptRegistry registration/lookup, ScriptObjectWrapper member binding, ScriptActorInterface trait filtering, ScriptContext lifecycle, type conversion round-trips |
| Phase B | 3 | ~55 | All 21 trigger types register/fire/clear correctly, ScriptComponent load/tick/dispose lifecycle, CallScriptFunc activity execution, fatal error propagation |
| Phase C | 16 | ~160 | Each Global method tested: TriggerGlobal all 30 methods, ActorGlobal Create with various init combinations, ReinforcementsGlobal delivery paths, MediaGlobal audio/video dispatch, MapGlobal spatial queries, UtilsGlobal collection operations |
| Phase D | 29 | ~200 | Each Property class: getter/setter round-trips, required trait validation, activity queuing, error cases (missing traits, invalid targets), destroy-actor safety (BaseActorProperties) |
| Phase E | 5 | ~40 | Player lookup, Objective CRUD, Condition grant/revoke, Experience levels, Statistics counters |
| Phase F | 4 | ~20 | Chronosphere teleport validation, Disguise type/actor, Infiltrate target validation, IonCannon activation |
| Phase G | 5 | ~40 | fengari sandbox restrictions, Lua->TS type conversion, memory/instruction limits, error handling |

**Total estimated tests**: ~575 across all phases

### 5.2 E2E / Acceptance Testing

The scripting system requires manual visual acceptance testing for:

1. **JSON Trigger System**: A test page (`ch20-scripting/trigger-system/`) that loads a mini-map with JSON trigger definitions and verifies:
   - Actor lifecycle triggers fire (spawn -> idle -> damage -> kill)
   - Timer delay works (AfterDelay)
   - Production triggers fire
   - Objective completion triggers game win/loss
   - Proximity/footprint triggers fire when actors enter/exit

2. **Reinforcements Delivery**: Visual verification of `ReinforceWithTransport` with aircraft, ground APC, and naval transport paths.

3. **FMV Playback** (deferred until VideoPlayerWidget is implemented): `PlayMovieFullscreen` and `PlayMovieInRadar`.

4. **UI Text Display**: `SetMissionText` and `FloatingText` position/color verification.

5. **Lua VM (Phase G only)**: Verify a real OpenRA campaign mission script runs correctly in fengari.

### 5.3 Integration Testing

- Cross-phase integration: Verify that a map with JSON triggers and optional Lua scripts coexists correctly
- Network safety: Verify that random operations use `World.SharedRandom` (deterministic)
- Memory: Verify no memory leaks from trigger callback registrations after actor disposal

---

## 6. Risk and Considerations

### 6.1 High-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Lua dependency for existing missions** | MEDIUM | HIGH | The two-tier architecture (JSON + optional fengari) ensures MVP works without Lua. Phase G provides backward compatibility for existing .lua mission scripts. |
| **fengari compatibility with OpenRA Lua** | MEDIUM | MEDIUM | OpenRA uses Lua 5.2 (Eluant); fengari is Lua 5.3. Some syntax/behavior differences exist. Test against real OpenRA campaign scripts (e.g., Tiberian Dawn GDI campaign) to identify gaps. |
| **Trigger registration memory leaks** | LOW | HIGH | OpenRA's `ScriptTriggers.ClearAll()` on actor dispose must be enforced. Every callback registration must pair with a corresponding cleanup on actor removal. |
| **Network desync from script randomness** | LOW | HIGH | All random operations in the scripting system must use the deterministic `World.SharedRandom`. The JSON trigger system enforces this by design. |
| **10K-line (mis)estimate for ScriptContext** | RESOLVED | N/A | ScriptContext.cs is actually 346 lines, not 10K as previously estimated. The complexity is manageable. |

### 6.2 Medium-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **ActorInit construction complexity** | MEDIUM | MEDIUM | `ActorGlobal.Create()` uses .NET reflection to find and invoke `ActorInit.Initialize()` overloads. We must reimplement this with a TypeScript factory registry. |
| **ProductionQueueProperties/ClassicProductionQueueProperties** | LOW | MEDIUM | These are the most complex Properties files (311 lines), with production callback wiring. Must carefully verify the OnProducedInternal handler registration/cleanup. |
| **ReinforcementsGlobal pathfinding integration** | LOW | MEDIUM | `ReinforceWithTransport` queues movement, cargo loading, and callbacks. Must integrate correctly with the pathfinding system (Ch4 Phase G) and Activity queue (Ch3 Phase F). |

### 6.3 Known Gaps

1. **FMV Playback**: The `Media.PlayFMVFullscreen()` function requires a `VideoPlayerWidget` and VQA decoder. This depends on Chapter 16's UI widget infrastructure. If the video player widget is not yet implemented, FMV playback is deferred.

2. **Radar Widget**: `RadarGlobal` manipulates the in-game radar widget. If the radar widget is not yet migrated, this is deferred.

3. **FluentProvider**: `UserInterfaceGlobal.GetFluentMessage()` depends on the localization system (`.ftl` files). This infrastructure exists from Chapter 5 but needs verification.

4. **Lobby Options**: `MapGlobal.LobbyOption()` reads `ScriptLobbyDropdown` values. This requires the lobby UI to be implemented.

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-20.1: Two-Tier Architecture -- JSON Triggers + Optional Lua VM

**Context**: OpenRA's scripting system uses Lua 5.2 for mission scripting. In the browser, running a Lua VM adds bundle size (~200KB for fengari) and complexity. Most mission patterns (triggers, timers, reinforcements, objectives) are simple event-response pairs that don't need Turing-complete scripting.

**Decision**: Implement a two-tier architecture:
1. **Tier 1 (MVP, Phases A-F)**: A declarative JSON trigger system that handles 80%+ of mission patterns. Map authors define triggers as JSON event-action pairs. No Lua dependency.
2. **Tier 2 (Optional, Phase G)**: fengari Lua 5.3 VM loaded on-demand via dynamic `import()` when a map includes `.lua` files. The same TypeScript API classes serve both tiers.

**Alternatives Considered**:
- **Full Lua from start**: Would delay MVP delivery and add mandatory 200KB+ bundle overhead. Rejected.
- **lua.vm.js (Emscripten)**: Larger bundle (~500KB), no tree-shaking, harder ESM integration. Rejected in favor of fengari (pure JS, tree-shakeable, ESM-compatible).
- **JSON-only, no Lua path**: Would lose backward compatibility with existing OpenRA campaign missions. Rejected -- the Lua path is important for long-term compatibility.
- **WASM-based Lua**: Even larger bundle, requires WASM loading infrastructure. Overkill for this use case. Rejected.

**Consequences**:
- Easier: MVP ships faster with JSON triggers. The majority of new missions can be written without Lua.
- Harder: Must maintain two code paths (JSON dispatch + Lua binding) for the same API surface. The `ScriptRegistry` design handles this by registering each API method once and routing to either dispatch layer.

### ADR-20.2: ScriptRegistry Replaces .NET Reflection

**Context**: OpenRA uses `System.Reflection` to discover `ScriptGlobal`, `ScriptActorProperties`, and `ScriptPlayerProperties` subclasses at runtime and auto-expose their public methods/properties to Lua. TypeScript has no equivalent of runtime reflection.

**Decision**: Implement `ScriptRegistry` -- a central registry populated at module import time via explicit `register()` calls. Each Global and Properties class calls `ScriptRegistry.registerX()` in its module body. The `ScriptContext` queries the registry instead of scanning types.

**Alternatives Considered**:
- **Decorator-based discovery** (`@ScriptGlobal('Actor')`): Attractive but requires `experimentalDecorators` in tsconfig and `reflect-metadata` polyfill. Would work but adds complexity. Deferred to Phase G if needed.
- **Code generation**: Pre-scan TypeScript files and generate registry code. Adds build step, fragile. Rejected.
- **Manual registry file**: Single file that imports and registers all classes. Simple but creates a hotspot file that must be updated for each new property. Chosen.

**Consequences**:
- Easier: No decorator or reflection polyfill needed. Works with `erasableSyntaxOnly`.
- Harder: Adding a new Property class requires updating the registry. Mitigated by clear documentation and test coverage.

### ADR-20.3: ScriptContext Modularization

**Context**: OpenRA's `ScriptContext` (347 lines) handles Lua runtime creation, sandboxing, script loading, global registration, tick dispatch, and fatal error handling. In TypeScript, these concerns should be separated for testability.

**Decision**: Split into three modules:
1. `ScriptContext.ts` -- Orchestrator: owns the event dispatch, fatal error state, tick/worldLoaded lifecycle. Delegates to ScriptRegistry for API lookups.
2. `ScriptRegistry.ts` -- API registration: global tables, actor properties, player properties, ActorInit factories.
3. `LuaRuntimeAdapter.ts` (Phase G) -- Lua VM integration: fengari initialization, sandboxing, script loading.

**Consequences**:
- Easier: Each module is independently testable. The JSON trigger system doesn't need to import fengari at all.
- Harder: Slightly more files, but follows the Single Responsibility Principle.

### ADR-20.4: Property Groups Mirror Trait Dependency Graph

**Context**: Each `ScriptActorProperties` subclass uses `Requires<T>` to declare which traits the actor must have for that property group to be available. For example, `HealthProperties` requires `IHealthInfo`, `MobileProperties` requires `MobileInfo`.

**Decision**: Use the exact same trait dependency system. When `ScriptRegistry` registers an actor property class, it records the required trait types. `ScriptActorInterface` filters available property classes against the actor's actual traits using the runtime `ActorInfo.HasTraitInfo()` equivalent.

**Consequences**:
- Easier: Direct 1:1 mapping from OpenRA's attribute system. The existing TypeScript trait infrastructure (Chapter 3) supports this.
- Harder: None. This is a straightforward mapping.

### ADR-20.5: Deferred Items (FMV, Radar, Lobby, Complex Production)

**Context**: Several Global and Properties methods depend on systems that may not be fully migrated when Chapter 20 is executed (FMV player, radar widget, lobby UI, complex production queues).

**Decision**: Implement these as stubs that log a warning and fail gracefully (return `false` or `null`). Each stub includes a TODO referencing the blocking system.

| Deferred Feature | Blocks | TODO Ref |
|-----------------|--------|----------|
| `MediaGlobal.PlayMovieFullscreen()` | VideoPlayerWidget (Ch16) | TODO-20.FMV |
| `MediaGlobal.PlayMovieInRadar()` | VideoPlayerWidget (Ch16) | TODO-20.FMV |
| `RadarGlobal` all methods | RadarWidget (Ch16) | TODO-20.RADAR |
| `MapGlobal.LobbyOption()` / `LobbyOptionOrDefault()` | Lobby UI | TODO-20.LOBBY |
| `ProductionQueueProperties.Build()` with actionFunc | Complex production callbacks | TODO-20.PROD-COMPLEX |

---

## Appendix A: JSON Trigger Schema (Tier 1 MVP)

This is the preliminary JSON schema for the declarative trigger system. It covers the most common mission patterns and can be extended.

```typescript
// Proposed TypeScript interface for JSON trigger definitions
interface MissionScript {
  triggers: TriggerDefinition[];
  objectives: ObjectiveDefinition[];
  scripts?: string[];  // Optional .lua files for Tier 2
}

interface TriggerDefinition {
  event: TriggerEventType;
  // Actor-specific events
  actor?: string;        // Named actor reference for single-actor events
  actors?: string[];     // Named actor references for group events
  player?: string;       // Player internal name for player events
  // Proximity/footprint events
  position?: [number, number];  // WPos
  radius?: number;               // WDist radius
  cells?: [number, number][];    // CPos footprint
  // Timer events
  delay?: number;                // ticks
  // Callback
  action: ActionDefinition;
}

type TriggerEventType =
  | 'OnIdle' | 'OnDamaged' | 'OnKilled' | 'OnAllKilled' | 'OnAnyKilled'
  | 'OnProduction' | 'OnBuildingPlaced' | 'OnPlayerWon' | 'OnPlayerLost'
  | 'OnObjectiveAdded' | 'OnObjectiveCompleted' | 'OnObjectiveFailed'
  | 'OnCapture' | 'OnInfiltrated' | 'OnAddedToWorld' | 'OnRemovedFromWorld'
  | 'OnAllRemovedFromWorld' | 'OnDiscovered' | 'OnPlayerDiscovered'
  | 'OnPassengerEntered' | 'OnPassengerExited' | 'OnSold'
  | 'OnEnteredFootprint' | 'OnExitedFootprint'
  | 'OnEnteredProximityTrigger' | 'OnExitedProximityTrigger'
  | 'OnKilledOrCaptured' | 'OnAllKilledOrCaptured'
  | 'OnTimerExpired' | 'AfterDelay';

interface ActionDefinition {
  type: ActionType;
  // Varies by action type
  [key: string]: unknown;
}

type ActionType =
  | 'SendReinforcements' | 'SendReinforcementsWithTransport'
  | 'CreateActor' | 'DestroyActor'
  | 'MarkObjectiveCompleted' | 'MarkObjectiveFailed' | 'AddObjective'
  | 'PlaySound' | 'PlayMusic' | 'StopMusic' | 'PlaySpeechNotification'
  | 'DisplayMessage' | 'FloatingText' | 'SetMissionText'
  | 'TeleportActor' | 'MoveActor' | 'AttackMoveActor'
  | 'FlashScreen' | 'SetLighting'
  | 'WinGame' | 'LoseGame'
  | 'RunScript';  // Escape hatch to Lua function
```

---

## Appendix B: File Count Summary

| Module | Directory | Files | Total C# Lines |
|--------|-----------|-------|----------------|
| OpenRA.Game | `Scripting/` | 7 | 951 |
| OpenRA.Mods.Common | `Scripting/` (root) | 5 | 780 |
| OpenRA.Mods.Common | `Scripting/Global/` | 16 | 2,139 |
| OpenRA.Mods.Common | `Scripting/Properties/` | 34 | 2,298 |
| OpenRA.Mods.Cnc | `Scripting/Properties/` | 4 | 171 |
| **TOTAL** | | **66** | **6,339** |

**Migration Summary:**
- Files to migrate: 62
- Files deferred (LuaDoc only): 1 (`ScriptMemberExts.cs`)
- Files deferred (Emmy attribute): 1 (`ScriptEmmyTypeOverrideAttribute.cs`)
- Files absorbed into other modules: 2 (`ScriptMemberWrapper.cs` -> `ScriptRegistry.ts`, `Media.cs` -> `MediaGlobal.ts`)
- New migration-specific files: 1 (`ScriptRegistry.ts`)
- Optional Phase G files: 5
