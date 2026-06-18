# Chapter 20 Phase D Design Specification: Actor Property Groups

> **Status**: DESIGN COMPLETE
> **Date**: 2026-06-18
> **Source Plan**: `docs/chapter20_scripting_system_migration_plan.md` Section 3.4
> **Prerequisite**: Phase A (Scripting Core), Phase B (Triggers), Phase C (Global API Tables)
> **Foundation Files Analyzed**: All 29 C# source files in `OpenRA/OpenRA.Mods.Common/Scripting/Properties/`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Structure & Dependency Graph](#2-module-structure--dependency-graph)
3. [Base Class Inheritance Map](#3-base-class-inheritance-map)
4. [Implementation Pattern (Canonical)](#4-implementation-pattern-canonical)
5. [Batch 1: Foundation Properties (7 files, D.1-D.7)](#5-batch-1-foundation-properties)
6. [Batch 2: Combat & Economy (9 files, D.8-D.17, 1 extra)](#6-batch-2-combat--economy)
7. [Batch 3: Support Powers & Abilities (11 files, D.18-D.29)](#7-batch-3-support-powers--abilities)
8. [Trait Dependency Cross-Reference](#8-trait-dependency-cross-reference)
9. [Shared Type Definitions](#9-shared-type-definitions)
10. [Unit Test Strategy](#10-unit-test-strategy)
11. [Migration Work Requirement Documents](#11-migration-work-requirement-documents)

---

## 1. Architecture Overview

### 1.1 Phase D Scope

Phase D migrates all `ScriptActorProperties` subclasses from OpenRA's C# Lua scripting bridge to TypeScript. These property groups expose actor trait methods/properties to the mission scripting system (JSON triggers or optional Lua VM).

**Total files**: 29 (28 actor property groups + 1 player property co-located)
**Total classes**: 32 (29 actor property classes + 3 player property classes co-located for context)

### 1.2 The Core Paradigm Shift

```
OpenRA (C# / Reflection)                     OpenRAWeb3D (TypeScript / Explicit Registration)
───────────────────────────                  ──────────────────────────────────────────────
[ScriptPropertyGroup("Health")]          →   static readonly category = 'Health'
Requires<IHealthInfo>                    →   static readonly requiredTraits = ['IHealthInfo']
HasAttribute<ExposedForDestroyedActors>  →   static readonly exposedForDestroyedActors = true/false
public int Health { get; set; }          →   { memberType: 'property', name: 'Health', get: ..., set: ... }
public void Kill(...)                    →   { memberType: 'method', name: 'Kill', invoke: ... }
ScriptMemberWrapper.WrappableMembers()   →   getOwnMemberDescriptors(): MemberDescriptor[]
ObjectCreator.GetTypesImplementing<T>()  →   ScriptRegistry.registerActorProperty({...}) at module import
```

### 1.3 How Properties Fit Into the System

```
ScriptContext
  │
  ├── ScriptRegistry (Phase A)
  │   ├── _actorProperties[] — all registered ActorPropertyRegistrations
  │   ├── _playerProperties[] — all registered PlayerPropertyRegistrations
  │   └── getActorCommands(info, hasTraitInfo) — filters by actor's traits
  │
  └── ScriptActorInterface (Phase A)
      │
      └── bind([instance1, instance2, ...])
          └── Each instance = new HealthProperties(context, actor)
              └── getMemberDescriptors(obj) → obj.getOwnMemberDescriptors()
                  └── [{ memberType:'property', name:'Health', ... }, { memberType:'method', name:'Kill', ... }]
```

---

## 2. Module Structure & Dependency Graph

### 2.1 File Locations

```
src/OpenRA.Mods.Common/Scripting/Properties/
  GeneralProperties.ts           ← D.1  (MEDIUM, 4 classes)
  ProductionProperties.ts        ← D.2  (HIGH,   5 classes, 1 player)
  CombatProperties.ts            ← D.3  (MEDIUM, 2 classes)
  HealthProperties.ts            ← D.4  (LOW,    1 class)
  MobileProperties.ts            ← D.5  (LOW,    1 class)
  AircraftProperties.ts          ← D.6  (LOW,    1 class)
  TransportProperties.ts         ← D.7  (LOW,    1 class)
  ConditionProperties.ts         ← D.8  (LOW,    1 class)
  AmmoPoolProperties.ts          ← D.9  (LOW,    1 class)
  CloakProperties.ts             ← D.10 (LOW,    1 class)
  DemolitionProperties.ts        ← D.11 (LOW,    1 class)
  GuardProperties.ts             ← D.12 (LOW,    1 class)
  HarvesterProperties.ts         ← D.13 (LOW,    1 class)
  CaptureProperties.ts           ← D.14 (LOW,    1 class)
  CarryallProperties.ts          ← D.15 (LOW,    1 class)
  DeliveryProperties.ts          ← D.16 (LOW,    2 classes)
  GainsExperienceProperties.ts   ← D.17 (LOW,    1 class)
  InstantlyRepairsProperties.ts  ← D.18 (LOW,    1 class)
  NukeProperties.ts              ← D.19 (LOW,    1 class)
  ParadropProperties.ts          ← D.20 (LOW,    1 class)
  ParatroopersProperties.ts      ← D.21 (LOW,    1 class)
  RepairableBuildingProperties.ts← D.22 (LOW,    1 class)
  ResourceProperties.ts          ← D.23 (LOW,    1 player class — co-located from Phase E)
  ScaredCatProperties.ts         ← D.24 (LOW,    1 class)
  SellableProperties.ts          ← D.25 (LOW,    1 class)
  TransformProperties.ts         ← D.26 (LOW,    1 class)
  AirstrikeProperties.ts         ← D.27 (LOW,    1 class)
  DiplomacyProperties.ts         ← D.28 (LOW,    1 player class — co-located from Phase E)
  PowerProperties.ts             ← D.29 (LOW,    2 classes: 1 actor + 1 player)
```

### 2.2 Dependency Graph

```
src/OpenRA.Game/Scripting/ScriptActorInterface.ts  (ScriptActorProperties base class)
src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts  (ScriptPlayerProperties base class)
src/OpenRA.Game/Scripting/ScriptRegistry.ts         (registerActorProperty, registerPlayerProperty)
src/OpenRA.Game/Scripting/ScriptMemberDescriptor.ts  (MemberDescriptor, PropertyDescriptor, MethodDescriptor)
src/OpenRA.Game/Scripting/ScriptTypes.ts             (toScriptValue, fromScriptValue)
src/OpenRA.Game/Traits/TraitsInterfaces.ts           (IGameActor, PlayerStub, WorldStub, ActorInfoStub)

src/OpenRA.Mods.Common/Scripting/ScriptTriggers.ts   (used by ProductionProperties for trigger callbacks)

                          ┌──────────────────────────────┐
                          │     ScriptActorInterface.ts    │
                          │  ScriptActorProperties (base)  │
                          └──────────────┬───────────────┘
                                         │ extends
                    ┌────────────────────┼──────────────────────┐
                    ▼                    ▼                       ▼
           GeneralProperties    HealthProperties    MobileProperties
           ProductionProperties CombatProperties   AircraftProperties
           ConditionProperties  AmmoPoolProperties TransportProperties
           ...                  CaptureProperties   DemolitionProperties
           ...all 29 files      GuardProperties     HarvesterProperties
                                ...                 ...
                                         │
                          ┌──────────────┴───────────────┐
                          │     ScriptPlayerInterface.ts   │
                          │  ScriptPlayerProperties (base)  │
                          └──────────────┬───────────────┘
                                         │ extends
                    ┌────────────────────┼──────────────────────┐
                    ▼                    ▼                       ▼
           ClassicProductionQueue   DiplomacyProperties   PlayerPowerProperties
           Properties               ResourceProperties
```

### 2.3 Cross-Chapter Dependencies

| Dependency | Source Chapter | How Used |
|------------|:---:|----------|
| `IGameActor`, `PlayerStub`, `WorldStub` | Ch3 Phase E | Constructor parameters for all property classes |
| `Activity` system | Ch3 Phase F | `actor.queueActivity(...)` for activity-spawning methods |
| `GameActor.isDead`, `GameActor.isIdle`, `GameActor.isInWorld` | Ch3 | Property values in General/BaseActorProperties |
| `ITraitInfo` interface names | Ch3 | `requiredTraits` matching |
| `CPos`, `WPos`, `WAngle`, `WDist` | Ch3 Phase A | Parameter types for movement/position methods |
| `Player` / `PlayerMask` | Ch3 | Owner property, diplomacy checks |
| `ScriptTriggers` | Ch20 Phase B | `HasAnyCallbacksFor`, `OnProducedInternal` event |
| `Target.FromActor`, `Target.FromCell` | Ch8 | Combat targeting |
| `AttackBase`, `IMove`, `Demolition`, etc. | Ch8, Ch9 | Trait references in property constructors |

---

## 3. Base Class Inheritance Map

### 3.1 Classes extending ScriptActorProperties (Actor-scoped)

| # | Class | File | Category | requiredTraits |
|---|-------|------|----------|----------------|
| D.1a | `BaseActorProperties` | GeneralProperties.ts | `"General"` | `[]` (empty — safe on dead actors) |
| D.1b | `GeneralProperties` | GeneralProperties.ts | `"General"` | `[]` (no Requires<T> attribute) |
| D.1c | `LocationProperties` | GeneralProperties.ts | `"General"` | `["IOccupySpaceInfo"]` |
| D.1d | `FacingProperties` | GeneralProperties.ts | `"General"` | `["IFacingInfo"]` |
| D.2a | `ProductionProperties` | ProductionProperties.ts | `"Production"` | `["ProductionInfo"]` |
| D.2b | `RallyPointProperties` | ProductionProperties.ts | `"Production"` | `["RallyPointInfo"]` |
| D.2c | `PrimaryBuildingProperties` | ProductionProperties.ts | `"Production"` | `["PrimaryBuildingInfo"]` |
| D.2d | `ProductionQueueProperties` | ProductionProperties.ts | `"Production"` | `["ProductionQueueInfo", "ScriptTriggersInfo"]` |
| D.3a | `CombatProperties` | CombatProperties.ts | `"Combat"` | `["AttackBaseInfo", "IMoveInfo"]` |
| D.3b | `GeneralCombatProperties` | CombatProperties.ts | `"Combat"` | `["AttackBaseInfo"]` |
| D.4 | `HealthProperties` | HealthProperties.ts | `"General"` | `["IHealthInfo"]` |
| D.5 | `MobileProperties` | MobileProperties.ts | `"Movement"` | `["MobileInfo"]` |
| D.6 | `AircraftProperties` | AircraftProperties.ts | `"Movement"` | `["AircraftInfo"]` |
| D.7 | `TransportProperties` | TransportProperties.ts | `"Transports"` | `["CargoInfo"]` |
| D.8 | `ConditionProperties` | ConditionProperties.ts | `"General"` | `["ExternalConditionInfo"]` |
| D.9 | `AmmoPoolProperties` | AmmoPoolProperties.ts | `"AmmoPool"` | `["AmmoPoolInfo"]` |
| D.10 | `CloakProperties` | CloakProperties.ts | `"Cloak"` | `["CloakInfo"]` |
| D.11 | `DemolitionProperties` | DemolitionProperties.ts | `"Combat"` | `["IMoveInfo", "DemolitionInfo"]` |
| D.12 | `GuardProperties` | GuardProperties.ts | `"Combat"` | `["GuardInfo", "IMoveInfo"]` |
| D.13 | `HarvesterProperties` | HarvesterProperties.ts | `"Movement"` | `["HarvesterInfo"]` |
| D.14 | `CaptureProperties` | CaptureProperties.ts | `"Ability"` | `["CaptureManagerInfo"]` |
| D.15 | `CarryallProperties` | CarryallProperties.ts | `"Ability"` | `["CarryallInfo"]` |
| D.16a | `DeliversCashProperties` | DeliveryProperties.ts | `"Ability"` | `["IMoveInfo", "DeliversCashInfo"]` |
| D.16b | `DeliversExperienceProperties` | DeliveryProperties.ts | `"Ability"` | `["IMoveInfo", "DeliversExperienceInfo"]` |
| D.17 | `GainsExperienceProperties` | GainsExperienceProperties.ts | `"Experience"` | `["GainsExperienceInfo"]` |
| D.18 | `InstantlyRepairsProperties` | InstantlyRepairsProperties.ts | `"Ability"` | `["IMoveInfo", "InstantlyRepairsInfo"]` |
| D.19 | `NukeProperties` | NukeProperties.ts | `"Support Powers"` | `["NukePowerInfo"]` |
| D.20 | `ParadropProperties` | ParadropProperties.ts | `"Transports"` | `["CargoInfo", "ParaDropInfo"]` |
| D.21 | `ParatroopersProperties` | ParatroopersProperties.ts | `"Support Powers"` | `["ParatroopersPowerInfo"]` |
| D.22 | `RepairableBuildingProperties` | RepairableBuildingProperties.ts | `"General"` | `["RepairableBuildingInfo"]` |
| D.24 | `ScaredCatProperties` | ScaredCatProperties.ts | `"Movement"` | `["ScaredyCatInfo"]` |
| D.25 | `SellableProperties` | SellableProperties.ts | `"General"` | `["SellableInfo"]` |
| D.26 | `TransformProperties` | TransformProperties.ts | `"General"` | `["TransformsInfo"]` |
| D.27 | `AirstrikeProperties` | AirstrikeProperties.ts | `"Support Powers"` | `["AirstrikePowerInfo"]` |
| D.29b | `ActorPowerProperties` | PowerProperties.ts | `"Power"` | `["PowerInfo"]` |

### 3.2 Classes extending ScriptPlayerProperties (Player-scoped — co-located from Phase E)

| # | Class | File | Category | requiredTraits |
|---|-------|------|----------|----------------|
| D.2e | `ClassicProductionQueueProperties` | ProductionProperties.ts | `"Production"` | `["ClassicProductionQueueInfo", "ScriptTriggersInfo"]` |
| D.23 | `ResourceProperties` | ResourceProperties.ts | `"Resources"` | `["PlayerResourcesInfo"]` |
| D.28 | `DiplomacyProperties` | DiplomacyProperties.ts | `"Diplomacy"` | `[]` (no Requires<T>) |
| D.29a | `PlayerPowerProperties` | PowerProperties.ts | `"Power"` | `["PowerManagerInfo"]` |

---

## 4. Implementation Pattern (Canonical)

### 4.1 Actor Property Template

```typescript
/**
 * [ClassName].ts — Script-exposed [category] properties for actors
 * OpenRA 对照: [ClassName].cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("category")] attribute → static readonly category
 * - C# Requires<TInfo> → static readonly requiredTraits: string[]
 * - C# public [member] self.Trait<T>() → constructor trait cache
 * - C# ScriptMemberWrapper reflection → getOwnMemberDescriptors()
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class [ClassName] extends ScriptActorProperties {
  static readonly category = '[Category]'
  static readonly requiredTraits = ['[TraitInfo1]', '[TraitInfo2]'] as const
  static readonly exposedForDestroyedActors = false

  // --- Trait cache (from constructor) ---
  private readonly [traitField]: [TraitType]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    // Cache traits from actor
    this.[traitField] = self.trait<[TraitType]>('[TraitInterface]')
  }

  // --- Properties ---
  get [PropertyName](): [Type] {
    // Implementation using cached traits
    return ...
  }
  set [PropertyName](value: [Type]) {
    // Implementation
  }

  // --- Methods ---
  [MethodName](param1: Type1, param2?: Type2): ReturnType {
    // Implementation
  }

  // --- Descriptors ---
  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      { memberType: 'property', name: '[PropName]', returnType: '[ScriptTypeName]',
        get: () => this.[PropName],
        set: (_, v) => { this.[PropName] = v as ... },
      },
      { memberType: 'method', name: '[MethodName]', returnType: 'nil',
        parameters: [
          { name: 'param1', type: '[ScriptTypeName]', optional: false },
          { name: 'param2', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => { this.[MethodName](args[0] as ..., args[1] as ...) },
      },
    ]
  }
}

// Module-level registration
ScriptRegistry.registerActorProperty({
  category: '[Category]',
  ctor: [ClassName],
  requiredTraits: ['[TraitInfo1]', '[TraitInfo2]'],
  exposedForDestroyedActors: false,
  description: '[Human-readable description]',
})
```

### 4.2 Player Property Template (for co-located Phase E classes)

```typescript
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class [ClassName] extends ScriptPlayerProperties {
  static readonly requiredTraits = ['[TraitInfo]'] as const

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
    // Cache traits from player.PlayerActor
  }

  // ... same getOwnMemberDescriptors() pattern ...

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      // ... property and method descriptors ...
    ]
  }
}

ScriptRegistry.registerPlayerProperty({
  category: '[Category]',
  ctor: [ClassName],
  requiredTraits: ['[TraitInfo]'],
  description: '...',
})
```

### 4.3 Key Implementation Rules

1. **No per-frame allocation**: All MemberDescriptor arrays are built once in `getOwnMemberDescriptors()` and cached by the ScriptActorInterface. Never `return [...]` with new array each call — use a module-level constant.

2. **Trait caching**: All trait lookups happen in the constructor. Property getters/setters access the cached trait reference — no `self.trait<T>()` calls in hot paths.

3. **Error handling**: Methods that validate throw descriptive errors. Throw `Error` (not LuaException — TS has no Lua runtime).

4. **Activity queuing**: Methods marked `[ScriptActorPropertyActivity]` in C# call `this.self.queueActivity(...)`. Reference the activity by name string (deferred activity implementation is beyond scope — these methods just invoke the activity queue).

5. **Optional parameters**: Use TypeScript optional parameters (`param?: Type`). In the descriptor, mark as `optional: true` with `defaultValue`.

6. **Return type naming**: Use ScriptTypeName values from ScriptMemberDescriptor.ts: `'nil'`, `'boolean'`, `'number'`, `'string'`, `'Actor'`, `'Player'`, `'WPos'`, `'CPos'`, `'WAngle'`, `'Actor[]'`, etc.

---

## 5. Batch 1: Foundation Properties (7 files, D.1-D.7)

### D.1 GeneralProperties.ts (4 classes, 226 C# lines)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/GeneralProperties.cs`
**Category**: `"General"`
**Complexity**: MEDIUM

#### Class: BaseActorProperties
- `static readonly category = 'General'`
- `static readonly requiredTraits = []` (empty — safe on dead actors)
- `static readonly exposedForDestroyedActors = true`
- Properties: `IsInWorld` (r/w), `IsDead` (r), `IsIdle` (r), `Owner` (r/w), `Type` (r), `EffectiveOwner` (r)
- Methods: `HasProperty(name: string): boolean`, `Flash(color, count?, interval?, delay?)`

#### Class: GeneralProperties
- `static readonly requiredTraits = []` (no Requires<T> in C# source)
- `static readonly exposedForDestroyedActors = false`
- Constructor caches: `AutoTarget`, `ScriptTags`, `Tooltip[]`
- Methods: `Teleport(cell)`, `CallFunc(func)`, `Wait(ticks)`, `Destroy()`, `Stop()`
- Properties: `Stance` (r/w), `TooltipName` (r), `IsTaggable` (r)
- Methods: `AddTag(tag): boolean`, `RemoveTag(tag): boolean`, `HasTag(tag): boolean`

#### Class: LocationProperties
- `static readonly requiredTraits = ['IOccupySpaceInfo']`
- Properties: `Location` (r — CPos), `CenterPosition` (r — WPos)

#### Class: FacingProperties
- `static readonly requiredTraits = ['IFacingInfo']`
- Constructor caches: `IFacing`
- Properties: `Facing` (r — WAngle)

### D.2 ProductionProperties.ts (5 classes, 311 C# lines — HIGH)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/ProductionProperties.cs`
**Category**: `"Production"`
**Complexity**: HIGH (largest file; contains a player property class with trigger integration)

Classes: ProductionProperties, RallyPointProperties, PrimaryBuildingProperties, ProductionQueueProperties, ClassicProductionQueueProperties (ScriptPlayerProperties!)

**Critical design note**: `ProductionQueueProperties` requires `ScriptTriggersInfo` and accesses `TriggerGlobal.GetScriptTriggers(self)` for callback registration. This is the only actor property that directly depends on Phase B `ScriptTriggers`.

### D.3 CombatProperties.ts (2 classes, 110 C# lines)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/CombatProperties.cs`
**Category**: `"Combat"`
**Complexity**: MEDIUM

#### CombatProperties (requires AttackBaseInfo + IMoveInfo)
- Constructor caches: `IMove`
- Methods: `Hunt()`, `AttackMove(cell, closeEnough?)`, `Patrol(waypoints, loop?, wait?)`, `PatrolUntil(waypoints, func, wait?)`

#### GeneralCombatProperties (requires AttackBaseInfo)
- Constructor caches: `AttackBase[]`
- Methods: `Attack(targetActor, allowMove?, forceAttack?)`, `CanTarget(targetActor): boolean`

### D.4 HealthProperties.ts (1 class, 53 C# lines)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/HealthProperties.cs`
**Category**: `"General"`
**Complexity**: LOW

- `requiredTraits = ['IHealthInfo']`
- Constructor caches: `IHealth`
- Properties: `Health` (r/w — get HP, set via InflictDamage), `MaxHealth` (r)
- Methods: `Kill(damageTypes?)`

### D.5 MobileProperties.ts (1 class, 72 C# lines)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/MobileProperties.cs`
**Category**: `"Movement"`
**Complexity**: LOW

- `requiredTraits = ['MobileInfo']`
- Constructor caches: `Mobile`
- Methods: `Move(cell, closeEnough?)`, `ScriptedMove(cell)`, `MoveIntoWorld(cell)`, `Scatter()`, `EnterTransport(transport)`
- Properties: `IsMobile` (r)

### D.6 AircraftProperties.ts (1 class, 61 C# lines)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/AircraftProperties.cs`
**Category**: `"Movement"`
**Complexity**: LOW

- `requiredTraits = ['AircraftInfo']`
- Constructor caches: `Aircraft`
- Methods: `Move(cell)`, `ReturnToBase(destination?)`, `Land(landOn)`, `Resupply()`

### D.7 TransportProperties.ts (1 class, 66 C# lines)

**OpenRA source**: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/TransportProperties.cs`
**Category**: `"Transports"`
**Complexity**: LOW

- `requiredTraits = ['CargoInfo']`
- Constructor caches: `Cargo`
- Properties: `Passengers` (r — Actor[]), `HasPassengers` (r), `PassengerCount` (r)
- Methods: `LoadPassenger(a)`, `UnloadPassenger(a?): Actor`, `UnloadPassengers(cell?, unloadRange?)`

---

## 6. Batch 2: Combat & Economy (9 files, D.8-D.17)

### D.8 ConditionProperties.ts (1 class, 59 C# lines)

- `requiredTraits = ['ExternalConditionInfo']`
- Constructor caches: `ExternalCondition[]`
- Methods: `GrantCondition(condition, duration?): number`, `RevokeCondition(token)`, `AcceptsCondition(condition): boolean`

### D.9 AmmoPoolProperties.ts (1 class, 67 C# lines)

- `requiredTraits = ['AmmoPoolInfo']`
- Constructor caches: `AmmoPool[]`
- Methods: `AmmoCount(poolName?): number`, `MaximumAmmoCount(poolName?): number`, `Reload(poolName?, amount?)`

### D.10 CloakProperties.ts (1 class, 39 C# lines)

- `requiredTraits = ['CloakInfo']`
- Constructor caches: `Cloak[]`
- Properties: `IsCloaked` (r)

### D.11 DemolitionProperties.ts (1 class, 40 C# lines)

- `requiredTraits = ['IMoveInfo', 'DemolitionInfo']`
- Constructor caches: `Demolition[]`
- Methods: `Demolish(target)`

### D.12 GuardProperties.ts (1 class, 36 C# lines)

- `requiredTraits = ['GuardInfo', 'IMoveInfo']`
- Constructor caches: `Guard`
- Methods: `Guard(targetActor)`

### D.13 HarvesterProperties.ts (1 class, 33 C# lines)

- `requiredTraits = ['HarvesterInfo']`
- Methods: `FindResources()`

### D.14 CaptureProperties.ts (1 class, 47 C# lines)

- `requiredTraits = ['CaptureManagerInfo']`
- Constructor caches: `CaptureManager`
- Methods: `Capture(target)`, `CanCapture(target): boolean`

### D.15 CarryallProperties.ts (1 class, 49 C# lines)

- `requiredTraits = ['CarryallInfo']`
- Constructor caches: `Carryall`
- Methods: `PickupCarryable(target)`, `DeliverCarryable(target: CPos)`

### D.16 DeliveryProperties.ts (2 classes, 73 C# lines)

- **DeliversCashProperties**: `requiredTraits = ['IMoveInfo', 'DeliversCashInfo']`
  - Methods: `DeliverCash(target)`
- **DeliversExperienceProperties**: `requiredTraits = ['IMoveInfo', 'DeliversExperienceInfo']`
  - Methods: `DeliverExperience(target)`

### D.17 GainsExperienceProperties.ts (1 class, 53 C# lines)

- `requiredTraits = ['GainsExperienceInfo']`
- Constructor caches: `GainsExperience`
- Properties: `Experience` (r), `Level` (r), `MaxLevel` (r), `CanGainLevel` (r)
- Methods: `GiveExperience(amount, silent?)`, `GiveLevels(numLevels, silent?)`

---

## 7. Batch 3: Support Powers & Abilities (11 files, D.18-D.29)

### D.18 InstantlyRepairsProperties.ts (1 class, 41 C# lines)

- `requiredTraits = ['IMoveInfo', 'InstantlyRepairsInfo']`
- Constructor caches: `InstantlyRepairs[]`
- Methods: `InstantlyRepair(target)`

### D.19 NukeProperties.ts (1 class, 39 C# lines)

- `requiredTraits = ['NukePowerInfo']`
- Constructor caches: `NukePower`
- Methods: `ActivateNukePower(target: CPos)`

### D.20 ParadropProperties.ts (1 class, 43 C# lines)

- `requiredTraits = ['CargoInfo', 'ParaDropInfo']`
- Constructor caches: `ParaDrop`
- Methods: `Paradrop(cell: CPos)`

### D.21 ParatroopersProperties.ts (1 class, 40 C# lines)

- `requiredTraits = ['ParatroopersPowerInfo']`
- Constructor caches: `ParatroopersPower`
- Methods: `TargetParatroopers(target: WPos, facing?: WAngle): Actor[]`

### D.22 RepairableBuildingProperties.ts (1 class, 47 C# lines)

- `requiredTraits = ['RepairableBuildingInfo']`
- Constructor caches: `RepairableBuilding`
- Methods: `StartBuildingRepairs(repairer?)`, `StopBuildingRepairs(repairer?)`

### D.23 ResourceProperties.ts (1 PLAYER class, 47 C# lines)

- Extends `ScriptPlayerProperties` (player-scoped)
- `requiredTraits = ['PlayerResourcesInfo']`
- Constructor caches: `PlayerResources`
- Properties: `Resources` (r/w), `ResourceCapacity` (r), `Cash` (r/w)

### D.24 ScaredCatProperties.ts (1 class, 36 C# lines)

- `requiredTraits = ['ScaredyCatInfo']`
- Constructor caches: `ScaredyCat`
- Methods: `Panic()`

### D.25 SellableProperties.ts (1 class, 31 C# lines)

- `requiredTraits = ['SellableInfo']`
- Methods: `Sell()`

### D.26 TransformProperties.ts (1 class, 36 C# lines)

- `requiredTraits = ['TransformsInfo']`
- Constructor caches: `Transforms`
- Methods: `Deploy()`

### D.27 AirstrikeProperties.ts (1 class, 39 C# lines)

- `requiredTraits = ['AirstrikePowerInfo']`
- Constructor caches: `AirstrikePower`
- Methods: `TargetAirstrike(target: WPos, facing?: WAngle): Actor[]`

### D.28 DiplomacyProperties.ts (1 PLAYER class, 28 C# lines)

- Extends `ScriptPlayerProperties` (player-scoped)
- `requiredTraits = []` (no Requires<T> in C#)
- Methods: `IsAlliedWith(targetPlayer): boolean`

### D.29 PowerProperties.ts (2 classes, 73 C# lines)

- **PlayerPowerProperties**: extends `ScriptPlayerProperties`, `requiredTraits = ['PowerManagerInfo']`
  - Properties: `PowerProvided` (r), `PowerDrained` (r), `PowerState` (r), `PlayLowPowerNotification` (r/w)
  - Methods: `TriggerPowerOutage(ticks)`
- **ActorPowerProperties**: extends `ScriptActorProperties`, `requiredTraits = ['PowerInfo']`
  - Constructor caches: `Power[]`
  - Properties: `Power` (r — sum of GetEnabledPower())

---

## 8. Trait Dependency Cross-Reference

Complete list of all unique trait info names required by Phase D properties:

| TraitInfo Name | Required By (classes) | Source Chapter |
|---------------|----------------------|:---:|
| *(empty — no traits)* | BaseActorProperties, GeneralProperties, DiplomacyProperties | — |
| `AttackBaseInfo` | CombatProperties, GeneralCombatProperties | Ch8 |
| `AmmoPoolInfo` | AmmoPoolProperties | Ch8 |
| `IMoveInfo` | CombatProperties, DemolitionProperties, GuardProperties, DeliversCashProperties, DeliversExperienceProperties, InstantlyRepairsProperties | Ch9 |
| `MobileInfo` | MobileProperties | Ch9 |
| `AircraftInfo` | AircraftProperties | Ch9 |
| `IOccupySpaceInfo` | LocationProperties | Ch3 |
| `IFacingInfo` | FacingProperties | Ch3 |
| `IHealthInfo` | HealthProperties | Ch3 |
| `ProductionInfo` | ProductionProperties | Ch11 |
| `RallyPointInfo` | RallyPointProperties | Ch11 |
| `PrimaryBuildingInfo` | PrimaryBuildingProperties | Ch11 |
| `ProductionQueueInfo` | ProductionQueueProperties | Ch11 |
| `ClassicProductionQueueInfo` | ClassicProductionQueueProperties (player) | Ch11 |
| `ScriptTriggersInfo` | ProductionQueueProperties, ClassicProductionQueueProperties (player) | Ch20 Phase B |
| `CargoInfo` | TransportProperties, ParadropProperties | Ch9 |
| `ExternalConditionInfo` | ConditionProperties | Ch3 |
| `CloakInfo` | CloakProperties | Ch12 |
| `DemolitionInfo` | DemolitionProperties | Ch8 |
| `GuardInfo` | GuardProperties | Ch8 |
| `HarvesterInfo` | HarvesterProperties | Ch10 |
| `CaptureManagerInfo` | CaptureProperties | Ch8 |
| `CarryallInfo` | CarryallProperties | Ch9 |
| `DeliversCashInfo` | DeliversCashProperties | Ch10 |
| `DeliversExperienceInfo` | DeliversExperienceProperties | Ch10 |
| `GainsExperienceInfo` | GainsExperienceProperties | Ch8 |
| `InstantlyRepairsInfo` | InstantlyRepairsProperties | Ch8 |
| `NukePowerInfo` | NukeProperties | Ch13 |
| `ParaDropInfo` | ParadropProperties | Ch9 |
| `ParatroopersPowerInfo` | ParatroopersProperties | Ch13 |
| `RepairableBuildingInfo` | RepairableBuildingProperties | Ch8 |
| `PlayerResourcesInfo` | ResourceProperties (player) | Ch10 |
| `ScaredyCatInfo` | ScaredCatProperties | Ch9 |
| `SellableInfo` | SellableProperties | Ch11 |
| `TransformsInfo` | TransformProperties | Ch11 |
| `AirstrikePowerInfo` | AirstrikeProperties | Ch13 |
| `PowerInfo` | ActorPowerProperties | Ch11 |
| `PowerManagerInfo` | PlayerPowerProperties (player) | Ch11 |

---

## 9. Shared Type Definitions

### 9.1 Color type (used by GeneralProperties.Flash)

```typescript
// For Color parameter in Flash(), use a simple interface:
interface ScriptColor { r: number; g: number; b: number; a?: number }
```

### 9.2 Callable type (used by GeneralProperties.CallFunc, CombatProperties.PatrolUntil)

```typescript
// Callable function (JSON callback or future Lua function)
type ScriptCallable = (...args: unknown[]) => unknown
```

### 9.3 DamageTypes type (used by HealthProperties.Kill)

```typescript
// damageTypes can be: string, string[], or undefined
type DamageTypesArg = string | string[] | undefined
```

---

## 10. Unit Test Strategy

### 10.1 Test File Organization

Each Batch should have a corresponding test file:
- `src/OpenRA.Mods.Common/Scripting/Properties/GeneralProperties.test.ts`
- `src/OpenRA.Mods.Common/Scripting/Properties/ProductionProperties.test.ts`
- `src/OpenRA.Mods.Common/Scripting/Properties/CombatProperties.test.ts`
- ... (one test file per source file) ...

### 10.2 What to Test Per Property Class

1. **Registration**: Verify `ScriptRegistry.registerActorProperty()` or `registerPlayerProperty()` was called with correct `category`, `requiredTraits`, `exposedForDestroyedActors`
2. **Descriptor completeness**: Verify `getOwnMemberDescriptors()` returns all expected members (compare with C# source public members)
3. **Property get/set**: Mock the cached trait, verify getter returns trait value, setter calls trait method
4. **Method invocation**: Mock the cached trait, verify method delegates to the correct trait method with correct arguments
5. **Edge cases**:
   - Null trait (for methods that call `trait ?? throw`)
   - Default parameter values
   - Activity queue verification (verify `actor.queueActivity()` was called)

### 10.3 Mocking Strategy

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Reset registry before each test
beforeEach(() => {
  ScriptRegistry._resetForTest()
})

// Create stub IGameActor with mocked traits
function stubActor(traits: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    isIdle: false,
    owner: mockPlayer,
    disposed: false,
    traitName: 'test',
    world: mockWorld,
    info: { name: 'testActor', traits: [] },
    trait: vi.fn().mockImplementation((name: string) => traits[name] ?? null),
    traitsImplementing: vi.fn().mockImplementation((name: string) => {
      const val = traits[name]
      return val != null ? [val] : []
    }),
    queueActivity: vi.fn(),
    // ... other required IGameActor members
  } as unknown as IGameActor
}
```

### 10.4 Test Coverage Targets

| Batch | Files | Target Test Lines | Target Test Cases |
|-------|-------|------------------|-------------------|
| Batch 1 (D.1-D.7) | 7 files, 14 classes | ~800 lines | ~120 tests |
| Batch 2 (D.8-D.17) | 9 files, 10 classes | ~600 lines | ~90 tests |
| Batch 3 (D.18-D.29) | 11 files, 12 classes | ~500 lines | ~80 tests |
| **Total** | **27 files, 36 classes** | **~1,900 lines** | **~290 tests** |

---

## 11. Migration Work Requirement Documents

Below are the structured work requirements for each batch, ready for Developer assignment.

### Batch 1 WRD: Foundation Properties

```
## Work Requirement: Chapter 20 Phase D Batch 1 — Foundation Properties

### Source
- OpenRA directory: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/`
- Target directory: `src/OpenRA.Mods.Common/Scripting/Properties/`
- Migration plan ref: TODO-20.D.1 through TODO-20.D.7

### Dependencies (already completed)
- ScriptActorProperties (in ScriptActorInterface.ts)
- ScriptPlayerProperties (in ScriptPlayerInterface.ts)
- ScriptRegistry (ScriptRegistry.ts)
- ScriptMemberDescriptor types (ScriptMemberDescriptor.ts)
- ScriptTypes (ScriptTypes.ts)
- IGameActor, PlayerStub (TraitsInterfaces.ts)

### Files to Implement
1. GeneralProperties.ts (4 classes: BaseActorProperties, GeneralProperties, LocationProperties, FacingProperties)
2. ProductionProperties.ts (5 classes: ProductionProperties, RallyPointProperties, PrimaryBuildingProperties, ProductionQueueProperties, ClassicProductionQueueProperties)
3. CombatProperties.ts (2 classes: CombatProperties, GeneralCombatProperties)
4. HealthProperties.ts (1 class)
5. MobileProperties.ts (1 class)
6. AircraftProperties.ts (1 class)
7. TransportProperties.ts (1 class)

### Requirements
1. Each class MUST extend ScriptActorProperties (actor) or ScriptPlayerProperties (player)
2. Each class MUST have static `category`, `requiredTraits`, `exposedForDestroyedActors`
3. Each class MUST implement `getOwnMemberDescriptors(): MemberDescriptor[]`
4. Module-level `ScriptRegistry.registerActorProperty()` / `registerPlayerProperty()` call
5. File header with OpenRA对照

### Key Paradigm Mappings
| OpenRA | TypeScript | Notes |
|--------|-----------|-------|
| `[ScriptPropertyGroup("X")]` | `static readonly category = 'X'` | |
| `Requires<TInfo>` | `static readonly requiredTraits = ['TInfo']` | |
| `self.Trait<T>()` | Constructor: `self.trait<T>(name)` | Cache in private field |
| `Self.QueueActivity(...)` | `this.self.queueActivity(...)` | IGameActor method |
| `LuaFunction func` | `ScriptCallable` type (loose) | Phase B handles actual dispatch |
| `LuaException(msg)` | `throw new Error(msg)` | No Lua runtime |

### Acceptance Criteria
- [ ] All classes match C# public member surface
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run src/OpenRA.Mods.Common/Scripting/Properties/` passes
- [ ] JSDoc on all public classes and methods
- [ ] File header with OpenRA file reference
- [ ] Register calls throw on duplicate (unit test this)
```

---

### Batch 2 WRD: Combat & Economy

```
## Work Requirement: Chapter 20 Phase D Batch 2 — Combat & Economy

### Source
- OpenRA directory: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/`
- Target directory: `src/OpenRA.Mods.Common/Scripting/Properties/`
- Migration plan ref: TODO-20.D.8 through TODO-20.D.17

### Files to Implement
8. ConditionProperties.ts
9. AmmoPoolProperties.ts
10. CloakProperties.ts
11. DemolitionProperties.ts
12. GuardProperties.ts
13. HarvesterProperties.ts
14. CaptureProperties.ts
15. CarryallProperties.ts
16. DeliveryProperties.ts (2 classes)
17. GainsExperienceProperties.ts

### Special Notes
- DeliveryProperties.ts contains TWO classes in one file (DeliversCashProperties, DeliversExperienceProperties)
- ConditionProperties has a `CanGrantCondition(this)` pattern — the `this` refers to the calling context; treat as always true for the actor's own conditions
```

---

### Batch 3 WRD: Support Powers & Abilities

```
## Work Requirement: Chapter 20 Phase D Batch 3 — Support Powers & Abilities

### Source
- OpenRA directory: `OpenRA/OpenRA.Mods.Common/Scripting/Properties/`
- Target directory: `src/OpenRA.Mods.Common/Scripting/Properties/`
- Migration plan ref: TODO-20.D.18 through TODO-20.D.29

### Files to Implement
18. InstantlyRepairsProperties.ts
19. NukeProperties.ts
20. ParadropProperties.ts
21. ParatroopersProperties.ts
22. RepairableBuildingProperties.ts
23. ResourceProperties.ts (ScriptPlayerProperties!)
24. ScaredCatProperties.ts
25. SellableProperties.ts
26. TransformProperties.ts
27. AirstrikeProperties.ts
28. DiplomacyProperties.ts (ScriptPlayerProperties!)
29. PowerProperties.ts (2 classes: PlayerPowerProperties + ActorPowerProperties)

### Special Notes
- ResourceProperties extends ScriptPlayerProperties (registers with registerPlayerProperty)
- DiplomacyProperties extends ScriptPlayerProperties (registers with registerPlayerProperty)
- PowerProperties.ts has TWO classes: PlayerPowerProperties (extends ScriptPlayerProperties) + ActorPowerProperties (extends ScriptActorProperties)
- Support power classes (Nuke, Paratroopers, Airstrike) use `Self.TraitsImplementing<INotifySupportPower>()` — pattern: notify traits before activating power
```
