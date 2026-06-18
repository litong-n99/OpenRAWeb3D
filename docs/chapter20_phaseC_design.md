# Chapter 20 Phase C Design Specification: Global API Tables

> **Status**: DESIGN COMPLETE
> **Date**: 2026-06-18
> **Source Plan**: `docs/chapter20_scripting_system_migration_plan.md` Section 3.3
> **OpenRA Source Files Analyzed**: 16 files in `OpenRA/OpenRA.Mods.Common/Scripting/Global/`
> **Prerequisite**: Phase A (ScriptObjectWrapper, ScriptRegistry, ScriptTypes) + Phase B (ScriptTriggers, TriggerInterfaces, ScriptComponent)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Structure & Dependency Graph](#2-module-structure--dependency-graph)
3. [API Surface per File](#3-api-surface-per-file)
4. [Paradigm Mappings](#4-paradigm-mappings)
5. [Stub/Deferred Decisions](#5-stubdeferred-decisions)
6. [Batch Organization](#6-batch-organization)
7. [Test Strategy](#7-test-strategy)
8. [Implementation Notes for Complex Methods](#8-implementation-notes-for-complex-methods)
9. [Work Requirement Documents](#9-work-requirement-documents)

---

## 1. Architecture Overview

### 1.1 Registration Flow

```
Module import time:
  ScriptRegistry.registerGlobal('Actor', ActorGlobal, 'Actor creation and query')
      │
      ▼
ScriptContext constructor:
  for (const reg of ScriptRegistry.getGlobals())
    new reg.ctor(this) → ScriptGlobal.bind([this]) → getMemberDescriptors(this)
      │
      ▼
Script access:
  context.getGlobal('Actor').get('Create') → callable wrapper
```

Every Global file has exactly one `ScriptRegistry.registerGlobal()` call at module level. The global table name **must be unique** -- the registry throws on duplicates.

### 1.2 ScriptTypeName Extension

Phase C requires several new ScriptTypeName values beyond those defined in Phase A. The `ScriptTypeName` type in `ScriptMemberDescriptor.ts` must be extended:

```typescript
export type ScriptTypeName =
  | 'nil' | 'boolean' | 'number' | 'string'
  | 'Actor' | 'Player' | 'WPos' | 'CPos' | 'CVec' | 'WVec'
  | 'WAngle' | 'WDist' | 'WRot' | 'Color'
  | 'string[]' | 'Actor[]' | 'Player[]' | 'CPos[]'
  | 'any' | 'table' | 'function'
  // Phase C additions:
  | 'WDist' | 'Actor[]' | 'CPos[]' | 'Player[]'  // already present, verify
  | 'number[]'  // for footprint cells
  // NOTE: 'function' type for callbacks — represented as TriggerCallback in TS
```

**Decision**: The existing `ScriptTypeName` already covers all needed types. No extension needed. Callbacks use the `'function'` type which maps to `TriggerCallback` via `fromScriptValue`/`toScriptValue`.

### 1.3 Creator Functions

For method parameters in `getMemberDescriptors()`, the `invoke` closures must cast parameters from `unknown[]`:

```typescript
{
  memberType: 'method',
  name: 'Create',
  returnType: 'Actor',
  parameters: [
    { name: 'type', type: 'string', optional: false },
    { name: 'addToWorld', type: 'boolean', optional: false },
    { name: 'initTable', type: 'table', optional: false },
  ],
  invoke: (_t, args) => this.create(
    args[0] as string,
    args[1] as boolean,
    args[2] as ReadonlyMap<string, unknown>,
  ),
}
```

---

## 2. Module Structure & Dependency Graph

### 2.1 Directory Layout

```
src/OpenRA.Mods.Common/Scripting/Global/
  TriggerGlobal.ts            (C.1, HIGH,   588 C# lines)
  ReinforcementsGlobal.ts     (C.2, MEDIUM, 204 C# lines)
  ActorGlobal.ts              (C.3, MEDIUM, 192 C# lines)
  MediaGlobal.ts              (C.4, MEDIUM, 182 C# lines)
  MapGlobal.ts                (C.5, MEDIUM, 166 C# lines)
  UtilsGlobal.ts              (C.6, MEDIUM, 155 C# lines)
  ColorGlobal.ts              (C.7, LOW,    127 C# lines)
  CoordinateGlobals.ts         (C.8, LOW,    107 C# lines)
  DateTimeGlobal.ts           (C.9, LOW,     94 C# lines)
  LightingGlobal.ts           (C.10, LOW,    67 C# lines)
  UserInterfaceGlobal.ts      (C.11, LOW,    65 C# lines)
  BeaconGlobal.ts             (C.12, LOW,    54 C# lines)
  AngleGlobal.ts              (C.13, LOW,    43 C# lines)
  PlayerGlobal.ts             (C.14, LOW,    36 C# lines)
  RadarGlobal.ts              (C.15, LOW,    35 C# lines)
  CameraGlobal.ts             (C.16, LOW,    29 C# lines)
```

No barrel export is needed — each file self-registers via `ScriptRegistry.registerGlobal()`.

### 2.2 Dependency Graph

```
                          ScriptObjectWrapper (Phase A)
                               │
                        ScriptGlobal (Phase A)
                               │
              ┌────────────────┼────────────────────────┐
              │                │                         │
         TriggerGlobal    MapGlobal              CoordinateGlobals
         │                │                      (CPos/CVec/WPos/
         │                │                       WVec/WDist)
         │                │
    ┌────┴────┐      ┌────┴────┐
    │         │      │         │
ActorGlobal  │  ReinforcementsGlobal
    │        │      │         │
    │   MediaGlobal  │   UtilsGlobal
    │        │      │         │
    │   ColorGlobal  │   PlayerGlobal
    │        │      │         │
    │ DateTimeGlobal│   BeaconGlobal
    │        │      │         │
    │ LightingGlobal│   RadarGlobal
    │        │      │         │
    │UserInterfaceGlobal CameraGlobal
    │        │      │         │
    └────────┴──────┴─────────┘
              │
        AngleGlobal
```

**Key dependencies**:
- **TriggerGlobal** → `ScriptTriggers` (Phase B), `Trigger` enum, `TriggerCallback`, `Triggerable`
- **ReinforcementsGlobal** → `ScriptRegistry.getActorInit()`, `IGameActor`, `PlayerStub`
- **ActorGlobal** → `ScriptRegistry.getActorInit()`, `ScriptRegistry.getActorInits()`
- **MapGlobal** → `WorldStub`, `PlayerStub`, `IGameActor`
- **MediaGlobal** → `WorldStub`, `PlayerStub`, `Color`
- **UtilsGlobal** → `WorldStub` (for SharedRandom)
- **ColorGlobal** → `Color`
- **CoordinateGlobals** → `CPos`, `CVec`, `WPos`, `WVec`, `WDist`
- **DateTimeGlobal** → `WorldStub` (for WorldTick, TimeLimitManager)
- **LightingGlobal** → `WorldStub` (for FlashPostProcessEffect, TintPostProcessEffect)
- **UserInterfaceGlobal** → `Color`
- **BeaconGlobal** → `WorldStub`, `PlayerStub`
- **AngleGlobal** → `WAngle`
- **PlayerGlobal** → `WorldStub`, `PlayerStub`
- **RadarGlobal** → `WorldStub`, `PlayerStub`
- **CameraGlobal** → `WorldRendererStub` (for Viewport)

---

## 3. API Surface per File

### 3.1 TriggerGlobal (C.1, HIGH)

**Global name**: `"Trigger"`
**Registration**: `ScriptRegistry.registerGlobal('Trigger', TriggerGlobal, 'Event triggers and timed callbacks')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `AfterDelay` | method | `delay: number`, `func: function` | `void` | Call function after delay ticks (via DelayedAction) |
| `OnPassengerEntered` | method | `actor: Actor`, `func: function` | `void` | When passenger enters transport |
| `OnPassengerExited` | method | `actor: Actor`, `func: function` | `void` | When passenger exits transport |
| `OnIdle` | method | `actor: Actor`, `func: function` | `void` | Each tick actor is idle |
| `OnDamaged` | method | `actor: Actor`, `func: function` | `void` | When actor damaged |
| `OnKilled` | method | `actor: Actor`, `func: function` | `void` | When actor killed |
| `OnAllKilled` | method | `actors: Actor[]`, `func: function` | `void` | When all actors in group killed |
| `OnAnyKilled` | method | `actors: Actor[]`, `func: function` | `void` | When any actor in group killed (once) |
| `OnProduction` | method | `actor: Actor`, `func: function` | `void` | When actor produces another |
| `OnAnyProduction` | method | `func: function` | `void` | When any actor produces (world-level) |
| `OnPlayerWon` | method | `player: Player`, `func: function` | `void` | When player wins |
| `OnPlayerLost` | method | `player: Player`, `func: function` | `void` | When player loses |
| `OnObjectiveAdded` | method | `player: Player`, `func: function` | `void` | When player gets new objective |
| `OnObjectiveCompleted` | method | `player: Player`, `func: function` | `void` | When player completes objective |
| `OnObjectiveFailed` | method | `player: Player`, `func: function` | `void` | When player fails objective |
| `OnBuildingPlaced` | method | `player: Player`, `func: function` | `void` | When player places building |
| `OnAddedToWorld` | method | `actor: Actor`, `func: function` | `void` | When actor added to world |
| `OnRemovedFromWorld` | method | `actor: Actor`, `func: function` | `void` | When actor removed from world |
| `OnAllRemovedFromWorld` | method | `actors: Actor[]`, `func: function` | `void` | When all in group removed |
| `OnCapture` | method | `actor: Actor`, `func: function` | `void` | When actor captured |
| `OnKilledOrCaptured` | method | `actor: Actor`, `func: function` | `void` | When actor killed OR captured (once) |
| `OnAllKilledOrCaptured` | method | `actors: Actor[]`, `func: function` | `void` | When all in group killed/captured |
| `OnEnteredFootprint` | method | `cells: CPos[]`, `func: function` | `number` | When actor enters footprint (returns triggerId) |
| `OnExitedFootprint` | method | `cells: CPos[]`, `func: function` | `number` | When actor exits footprint (returns triggerId) |
| `RemoveFootprintTrigger` | method | `id: number` | `void` | Remove a footprint trigger |
| `OnEnteredProximityTrigger` | method | `pos: WPos`, `range: WDist`, `func: function` | `number` | When actor enters range (returns triggerId) |
| `OnExitedProximityTrigger` | method | `pos: WPos`, `range: WDist`, `func: function` | `number` | When actor exits range (returns triggerId) |
| `RemoveProximityTrigger` | method | `id: number` | `void` | Remove a proximity trigger |
| `OnInfiltrated` | method | `actor: Actor`, `func: function` | `void` | When actor infiltrated |
| `OnDiscovered` | method | `actor: Actor`, `func: function` | `void` | When actor discovered |
| `OnPlayerDiscovered` | method | `player: Player`, `func: function` | `void` | When player discovered |
| `OnSold` | method | `actor: Actor`, `func: function` | `void` | When actor sold |
| `OnTimerExpired` | method | `func: function` | `void` | When game timer expires |
| `ClearAll` | method | `actor: Actor` | `void` | Remove all triggers from actor |
| `Clear` | method | `actor: Actor`, `triggerName: string` | `void` | Remove specified trigger from actor |

**Total**: 33 members (33 methods, 0 properties)

### 3.2 ActorGlobal (C.2, MEDIUM)

**Global name**: `"Actor"`
**Registration**: `ScriptRegistry.registerGlobal('Actor', ActorGlobal, 'Actor creation and query')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `Create` | method | `type: string`, `addToWorld: boolean`, `initTable: table` | `Actor` | Create actor from type + init table |
| `BuildTime` | method | `type: string`, `queue?: string` | `number` | Build time in ticks |
| `CruiseAltitude` | method | `type: string` | `number` | Cruise altitude (0 if ground) |
| `Cost` | method | `type: string` | `number` | Cost from Valued trait |

**Total**: 4 members (4 methods, 0 properties)

### 3.3 ReinforcementsGlobal (C.3, MEDIUM)

**Global name**: `"Reinforcements"`
**Registration**: `ScriptRegistry.registerGlobal('Reinforcements', ReinforcementsGlobal, 'Unit delivery and transport')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `Reinforce` | method | `owner: Player`, `actorTypes: string[]`, `entryPath: CPos[]`, `interval?: number`, `actionFunc?: function` | `Actor[]` | Multi-unit reinforcement delivery |
| `ReinforceWithTransport` | method | `owner: Player`, `actorType: string`, `cargoTypes?: string[]`, `entryPath: CPos[]`, `exitPath?: CPos[]`, `actionFunc?: function`, `exitFunc?: function`, `dropRange?: number` | `table` | Transport-based delivery |

**Total**: 2 members (2 methods, 0 properties)

### 3.4 MediaGlobal (C.4, MEDIUM)

**Global name**: `"Media"`
**Registration**: `ScriptRegistry.registerGlobal('Media', MediaGlobal, 'Audio, video, and text display')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `PlaySpeechNotification` | method | `player: Player`, `notification: string` | `void` | Play announcer voice |
| `PlaySoundNotification` | method | `player: Player`, `notification: string` | `void` | Play sound notification |
| `PlaySound` | method | `file: string` | `void` | Play sound file |
| `PlayMusic` | method | `track?: string`, `onPlayComplete?: function` | `void` | Play music track |
| `SetBackgroundMusic` | method | `track?: string` | `void` | Set background music |
| `StopMusic` | method | — | `void` | Stop current music |
| `PlayMovieFullscreen` | method | `videoFileName: string`, `onPlayComplete?: function` | `void` | Play fullscreen video |
| `PlayMovieInRadar` | method | `videoFileName: string`, `onPlayComplete?: function` | `void` | Play video in radar |
| `DisplayMessage` | method | `text: string`, `prefix?: string`, `color?: Color` | `void` | Display message to all |
| `DisplayMessageToPlayer` | method | `player: Player`, `text: string`, `prefix?: string`, `color?: Color` | `void` | Display message to one player |
| `DisplaySystemMessage` | method | `text: string`, `prefix?: string` | `void` | Display system message |
| `Debug` | method | `format: string` | `void` | Debug message |
| `FloatingText` | method | `text: string`, `position: WPos`, `duration?: number`, `color?: Color` | `void` | Floating text at position |

**Total**: 13 members (13 methods, 0 properties)

### 3.5 MapGlobal (C.5, MEDIUM)

**Global name**: `"Map"`
**Registration**: `ScriptRegistry.registerGlobal('Map', MapGlobal, 'Map spatial queries and actor lookup')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `ActorsInCircle` | method | `location: WPos`, `radius: WDist`, `filter?: function` | `Actor[]` | Actors in circle |
| `ActorsInBox` | method | `topLeft: WPos`, `bottomRight: WPos`, `filter?: function` | `Actor[]` | Actors in box |
| `TopLeft` | property | — | `WPos` | Top-left corner (OBSOLETE) |
| `BottomRight` | property | — | `WPos` | Bottom-right corner (OBSOLETE) |
| `RandomCell` | method | — | `CPos` | Random visible cell |
| `RandomEdgeCell` | method | — | `CPos` | Random edge cell |
| `ClosestEdgeCell` | method | `givenCell: CPos` | `CPos` | Closest edge cell |
| `ClosestMatchingEdgeCell` | method | `givenCell: CPos`, `filter: function` | `CPos` | Closest matching edge cell |
| `CenterOfCell` | method | `cell: CPos` | `WPos` | Center world position of cell |
| `TerrainType` | method | `cell: CPos` | `string` | Terrain type at cell |
| `IsSinglePlayer` | property | — | `boolean` | True if only one human player |
| `IsPausedShellmap` | property | — | `boolean` | True if shellmap paused |
| `LobbyOption` | method | `id: string` | `string` | Script lobby dropdown value |
| `LobbyOptionOrDefault` | method | `id: string`, `fallback: string` | `string` | Lobby dropdown with fallback |
| `NamedActors` | property | — | `Actor[]` | All named map actors |
| `NamedActor` | method | `actorName: string` | `Actor` | Named map actor by name |
| `IsNamedActor` | method | `actor: Actor` | `boolean` | True if from map file |
| `ActorsWithTag` | method | `tag: string` | `Actor[]` | Actors with ScriptTags tag |
| `ActorsInWorld` | property | — | `Actor[]` | All actors in world |

**Total**: 19 members (13 methods, 6 properties)

### 3.6 UtilsGlobal (C.6, MEDIUM)

**Global name**: `"Utils"`
**Registration**: `ScriptRegistry.registerGlobal('Utils', UtilsGlobal, 'Collection utilities')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `Do` | method | `collection: any[]`, `func: function` | `void` | Call func on each element |
| `Any` | method | `collection: any[]`, `func: function` | `boolean` | Any element matches? |
| `All` | method | `collection: any[]`, `func: function` | `boolean` | All elements match? |
| `Where` | method | `collection: any[]`, `func: function` | `any[]` | Filtered collection |
| `Take` | method | `n: number`, `source: any[]` | `any[]` | First n elements |
| `Skip` | method | `table: any[]`, `numElements: number` | `any[]` | Skip first n elements |
| `Concat` | method | `first: any[]`, `second: any[]` | `any[]` | Concatenate two arrays |
| `Random` | method | `collection: any[]` | `any` | Random element |
| `Shuffle` | method | `collection: any[]` | `any[]` | Shuffled copy |
| `ExpandFootprint` | method | `footprint: CPos[]`, `allowDiagonal: boolean` | `CPos[]` | Expand footprint cells |
| `RandomInteger` | method | `low: number`, `high: number` | `number` | Random integer in [low, high) |
| `FormatTime` | method | `ticks: number`, `leadingMinuteZero?: boolean` | `string` | Format ticks as HH:MM:SS |

**Total**: 12 members (12 methods, 0 properties)

### 3.7 ColorGlobal (C.7, LOW)

**Global name**: `"HSLColor"`
**Registration**: `ScriptRegistry.registerGlobal('HSLColor', ColorGlobal, 'Color creation and constants')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `New` | method | `hue: number`, `saturation: number`, `luminosity: number` | `Color` | HSL color |
| `FromRGB` | method | `red: number`, `green: number`, `blue: number`, `alpha?: number` | `Color` | RGB(A) color |
| `FromHex` | method | `value: string` | `Color` | Hex string color |
| `Aqua` through `White` | property | — | `Color` | 39 named color constants |

**Total**: ~42 members (3 methods, 39 properties)

### 3.8 CoordinateGlobals (C.8, LOW)

**Global names**: `"CPos"`, `"CVec"`, `"WPos"`, `"WVec"`, `"WDist"`

**Five separate Global classes in one file:**

**CPosGlobal** (name: `"CPos"`):
| Member | Type | Parameters | Return |
|--------|------|-----------|--------|
| `New` | method | `x: number`, `y: number` | `CPos` |
| `NewWithLayer` | method | `x: number`, `y: number`, `layer: number` | `CPos` |
| `Zero` | property | — | `CPos` |

**CVecGlobal** (name: `"CVec"`):
| Member | Type | Parameters | Return |
|--------|------|-----------|--------|
| `New` | method | `x: number`, `y: number` | `CVec` |
| `Zero` | property | — | `CVec` |

**WPosGlobal** (name: `"WPos"`):
| Member | Type | Parameters | Return |
|--------|------|-----------|--------|
| `New` | method | `x: number`, `y: number`, `z: number` | `WPos` |
| `Zero` | property | — | `WPos` |

**WVecGlobal** (name: `"WVec"`):
| Member | Type | Parameters | Return |
|--------|------|-----------|--------|
| `New` | method | `x: number`, `y: number`, `z: number` | `WVec` |
| `Zero` | property | — | `WVec` |

**WDistGlobal** (name: `"WDist"`):
| Member | Type | Parameters | Return |
|--------|------|-----------|--------|
| `New` | method | `r: number` | `WDist` |
| `FromCells` | method | `numCells: number` | `WDist` |

### 3.9 DateTimeGlobal (C.9, LOW)

**Global name**: `"DateTime"`
**Registration**: `ScriptRegistry.registerGlobal('DateTime', DateTimeGlobal, 'Game time and real-world clock')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `IsHalloween` | property | — | `boolean` | True on Oct 31 (OBSOLETE) |
| `GameTime` | property | — | `number` | Current tick |
| `Seconds` | method | `seconds: number` | `number` | Seconds to ticks |
| `CurrentYear` | property | — | `number` | 1-9999 |
| `CurrentMonth` | property | — | `number` | 1-12 |
| `CurrentDay` | property | — | `number` | 1-31 |
| `CurrentHour` | property | — | `number` | 0-23 |
| `CurrentMinute` | property | — | `number` | 0-59 |
| `CurrentSecond` | property | — | `number` | 0-59 |
| `Minutes` | method | `minutes: number` | `number` | Minutes to ticks |
| `TimeLimit` | property | — | `number` | Get/set time limit |
| `TimeLimitNotification` | property | — | `string` | Get/set notification string |

### 3.10 LightingGlobal (C.10, LOW)

**Global name**: `"Lighting"`
**Registration**: `ScriptRegistry.registerGlobal('Lighting', LightingGlobal, 'Post-process lighting effects')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `Flash` | method | `type?: string`, `ticks?: number` | `void` | Flash effect |
| `Red` | property | — | `number` | Red component (0-1) |
| `Green` | property | — | `number` | Green component (0-1) |
| `Blue` | property | — | `number` | Blue component (0-1) |
| `Ambient` | property | — | `number` | Ambient strength (0-1) |

### 3.11 UserInterfaceGlobal (C.11, LOW)

**Global name**: `"UserInterface"`
**Registration**: `ScriptRegistry.registerGlobal('UserInterface', UserInterfaceGlobal, 'UI text display')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `SetMissionText` | method | `text: string`, `color?: Color` | `void` | Set mission text label |
| `GetFluentMessage` | method | `key: string`, `args?: table` | `string` | Localized string lookup |

### 3.12 BeaconGlobal (C.12, LOW)

**Global name**: `"Beacon"`
**Registration**: `ScriptRegistry.registerGlobal('Beacon', BeaconGlobal, 'Map beacon placement')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `New` | method | `owner: Player`, `position: WPos`, `duration?: number`, `showRadarPings?: boolean` | `void` | Create beacon |

### 3.13 AngleGlobal (C.13, LOW)

**Global name**: `"Angle"`
**Registration**: `ScriptRegistry.registerGlobal('Angle', AngleGlobal, 'Angle constants and creation')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `North` through `NorthEast` | property | — | `WAngle` | 8 cardinal directions |
| `New` | method | `a: number` | `WAngle` | Create arbitrary angle |

### 3.14 PlayerGlobal (C.14, LOW)

**Global name**: `"Player"`
**Registration**: `ScriptRegistry.registerGlobal('Player', PlayerGlobal, 'Player lookup')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `GetPlayer` | method | `name: string` | `Player` | Player by internal name |
| `GetPlayers` | method | `filter?: function` | `Player[]` | Players matching filter |

### 3.15 RadarGlobal (C.15, LOW)

**Global name**: `"Radar"`
**Registration**: `ScriptRegistry.registerGlobal('Radar', RadarGlobal, 'Radar widget control')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `Ping` | method | `player: Player`, `position: WPos`, `color: Color`, `duration?: number` | `void` | Create radar ping |

### 3.16 CameraGlobal (C.16, LOW)

**Global name**: `"Camera"`
**Registration**: `ScriptRegistry.registerGlobal('Camera', CameraGlobal, 'Viewport camera control')`

| Member | Type | Parameters | Return | Description |
|--------|------|-----------|--------|-------------|
| `Position` | property | — | `WPos` | Get/set viewport center |

---

## 4. Paradigm Mappings

| OpenRA (C#) | TypeScript | Notes |
|-------------|-----------|-------|
| `[ScriptGlobal("Name")]` attribute | `ScriptRegistry.registerGlobal('Name', ClassGlobal, ...)` | Module-level call |
| `base(context)` constructor | `super(context, 'Name', [this])` | Name passed explicitly |
| `[Desc("...")]` attribute | `description` field in MemberDescriptor | String from Desc attribute |
| `LuaFunction func` parameter | `TriggerCallback` or `(ctx, ...args) => void` | Function type |
| `func.CopyReference()` | No-op (GC-managed) | No copy needed in TS |
| `using (f) f.Call().Dispose()` | `try { fn(...args) } finally { /* cleanup */ }` | try/finally pattern |
| `actor.ToLuaValue(Context)` | `ScriptTypes.toScriptValue(actor, context)` | Explicit conversion |
| `Enumerable.FirstOrDefault<Player>` | `Array.find()` | JS native |
| `LuaTable` | `ReadonlyMap<string, unknown>` or `unknown[]` | Generic key-value or array |
| `TypeDictionary` | `ReadonlyMap<string, unknown>` | String-keyed init dict |
| `ActorInit` construction | `ScriptRegistry.getActorInit(name)?.factory(values)` | Registry-based |
| `world.AddFrameEndTask(w => ...)` | Direct call (Phase C stub) | Deferred to full World integration |
| `Game.Sound.PlayNotification()` | Stub method on context.world | Engine audio deferred |
| `world.Map.Rules.Actors.TryGetValue()` | `context.world.map?.rules?.actors?.get(name)` | May be stubbed |
| `TraitOrDefault<T>()` | TypeScript has no equivalent; use getter to stub property | Stub trait access |
| `System.DateTime.Now` | `new Date()` | Standard JS |
| `Enum.Parse<Trigger>(triggerName)` | `Trigger[triggerName as keyof typeof Trigger]` | Object lookup |

---

## 5. Stub/Deferred Decisions

### 5.1 Full Stubbing Strategy

Since many engine subsystems are not yet wired together, most Globals will use **stub implementations** for engine-level operations:

| Engine Call | Stub Behavior | Future Phase |
|-------------|---------------|--------------|
| `world.AddFrameEndTask(fn)` | Direct call `fn()` | World integration |
| `world.CreateActor(...)` | Return stub IGameActor | World integration |
| `world.Map.Rules.Actors` | `new Map()` (empty) | Ruleset wiring |
| `world.Players` | `[]` (empty array) | Player system wiring |
| `world.Map.ChooseRandomCell()` | Return `CPos.Zero` | Map integration |
| `world.ActorMap.AddCellTrigger()` | Return incrementing ID | ActorMap integration |
| `Game.Sound.PlayNotification()` | `console.log()` | Audio system |
| `MusicPlaylist.Play()` | `console.log()` | Audio system |
| `Media.PlayFMVFullscreen()` | `console.log()` | Video system |
| `TextNotificationsManager.AddMissionLine()` | `console.log()` | UI integration |
| `Ui.Root.Get()` | Return null-safe stub | Widget system |
| `FluentProvider.GetMessage()` | Return key as value | Localization |

### 5.2 Trait Access

C# uses `TraitOrDefault<T>()` and `TraitsImplementing<T>()`. In TypeScript Phase C, these are simulated via optional getters on the world/actor stubs:

```typescript
// WorldStub extension for Phase C
interface WorldStub {
  // ...existing...
  readonly worldTick?: number
  readonly players?: PlayerStub[]
  readonly sharedRandom?: { next(low: number, high: number): number }
  findActorsInCircle?(center: WPos, radius: WDist): IGameActor[]
}
```

### 5.3 ActorInit Registration

ActorGlobal.Create() requires ActorInit factories. In Phase C, we register stubs for the core inits:

```typescript
// Registered by ActorGlobal.ts at module level:
ScriptRegistry.registerActorInit({
  name: 'Owner',
  parameters: new Map([['value', 'Player']]),
  factory: (values) => ({ initName: 'Owner', value: values.get('value') }),
})
ScriptRegistry.registerActorInit({
  name: 'Location',
  parameters: new Map([['value', 'CPos']]),
  factory: (values) => ({ initName: 'Location', value: values.get('value') }),
})
```

The full set of ActorInits (Facing, CenterPosition, etc.) will be registered in Phase D (ActorProperties).

---

## 6. Batch Organization

### Batch 1: LOW complexity (10 files, ~765 C# lines)
Start with the simplest files to establish the pattern and build confidence:

1. **C.13 AngleGlobal.ts** — 8 properties + 1 method (43 C# lines)
2. **C.14 PlayerGlobal.ts** — 2 methods (36 lines)
3. **C.16 CameraGlobal.ts** — 1 property (29 lines)
4. **C.15 RadarGlobal.ts** — 1 method (35 lines)
5. **C.12 BeaconGlobal.ts** — 1 method (54 lines)
6. **C.8 CoordinateGlobals.ts** — 5 classes with simple factories (107 lines)
7. **C.7 ColorGlobal.ts** — 39 properties + 3 methods (127 lines)
8. **C.9 DateTimeGlobal.ts** — properties + methods (94 lines)
9. **C.10 LightingGlobal.ts** — 1 method + 4 properties (67 lines)
10. **C.11 UserInterfaceGlobal.ts** — 2 methods (65 lines)

### Batch 2: MEDIUM + HIGH complexity (6 files, ~1,487 C# lines)

1. **C.6 UtilsGlobal.ts** — 12 methods, pure logic (155 lines)
2. **C.5 MapGlobal.ts** — 19 members, spatial queries (166 lines)
3. **C.4 MediaGlobal.ts** — 13 methods, audio/video (182 lines)
4. **C.3 ActorGlobal.ts** — 4 methods, actor creation (192 lines)
5. **C.2 ReinforcementsGlobal.ts** — 2 methods, complex delivery (204 lines)
6. **C.1 TriggerGlobal.ts** — 33 methods, largest file (588 lines)

---

## 7. Test Strategy

### 7.1 Test File Organization

Each Global gets a companion test file: `src/OpenRA.Mods.Common/Scripting/Global/[Name].test.ts`

Tests follow this pattern:
1. **Registration test**: Verify `ScriptRegistry.getGlobal('Name')` returns the correct registration
2. **Constructor test**: Create instance with mock context, verify table name
3. **Member descriptor test**: Verify `getMemberDescriptors()` returns expected count of members
4. **Method invoke test**: Call each method through the descriptor's `invoke` function
5. **Property get/set test**: Test property access through descriptors
6. **Error condition test**: Verify null checks, error messages

### 7.2 Mock Context Factory

```typescript
function createMockContext(overrides?: Partial<IScriptContext>): IScriptContext {
  return {
    world: {
      worldTick: 0,
      players: [],
      map: {
        rules: { actors: new Map() },
        chooseRandomCell: () => CPos.Zero,
        centerOfCell: () => WPos.Zero,
        // ...etc
      },
      addFrameEndTask: (fn: () => void) => fn(),
      createActor: () => ({ actorId: 1, disposed: false, isDead: false }),
      sharedRandom: { next: (lo, hi) => lo },
      ...overrides?.world,
    } as unknown as WorldStub,
    worldRenderer: { viewport: { centerPosition: WPos.Zero, center: () => {} } } as unknown as WorldRendererStub,
    fatalErrorOccurred: false,
    errorMessage: null,
    getActorCommands: () => [],
    playerCommands: [],
    registerMapActor: () => {},
    fatalError: () => {},
    ...overrides,
  }
}
```

### 7.3 Test Coverage Requirements

| File | Minimum Tests | Key Test Areas |
|------|--------------|----------------|
| AngleGlobal.ts | 10 | 8 direction values, New() with various angles |
| PlayerGlobal.ts | 8 | GetPlayer found/not-found, GetPlayers with/without filter |
| CameraGlobal.ts | 6 | Position get, Position set, initial value |
| RadarGlobal.ts | 5 | Ping with valid/invalid radarPings |
| BeaconGlobal.ts | 6 | New with/without beacon trait, showRadarPings |
| CoordinateGlobals.ts | 15 | 5 classes x 2-3 tests each |
| ColorGlobal.ts | 45 | 39 color constants, FromRGB, FromHex, New validation |
| DateTimeGlobal.ts | 15 | Properties, Seconds/Minutes, TimeLimit get/set |
| LightingGlobal.ts | 10 | Flash, 4 RGBA properties |
| UserInterfaceGlobal.ts | 6 | SetMissionText, GetFluentMessage |
| UtilsGlobal.ts | 20 | Each of 12 methods + edge cases |
| MapGlobal.ts | 25 | Actor queries, cell queries, properties |
| MediaGlobal.ts | 20 | Each method + error conditions |
| ActorGlobal.ts | 15 | Create, BuildTime, CruiseAltitude, Cost |
| ReinforcementsGlobal.ts | 15 | Reinforce, ReinforceWithTransport edge cases |
| TriggerGlobal.ts | 40 | Each trigger registration, AfterDelay, OnAllKilled, OnAllRemovedFromWorld, OnEnteredFootprint, etc. |

**Total estimated**: ~250 tests across all 16 files

### 7.4 E2E Tests

TriggerGlobal's AfterDelay method has timing-dependent behavior that unit tests cannot verify. A manual acceptance test page may be needed for:
- AfterDelay timing accuracy
- But since this is pure logic (no WebGL), unit tests with fake timers should suffice

**Decision**: No E2E manual test pages needed for Phase C. All behavior is logic-based and verifiable through unit tests.

---

## 8. Implementation Notes for Complex Methods

### 8.1 TriggerGlobal.AfterDelay

```typescript
afterDelay(delay: number, func: TriggerCallback): void {
  const ctx = this.context
  const doCall = () => {
    try {
      func(ctx)
    } catch (e) {
      ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
    }
  }
  // In full integration: context.world.addFrameEndTask(w => w.add(new DelayedAction(delay, doCall)))
  // Phase C stub: setTimeout
  setTimeout(doCall, delay * 40) // 40ms per tick at 25 TPS
}
```

### 8.2 TriggerGlobal.OnAllKilled

```typescript
onAllKilled(actors: IGameActor[], func: TriggerCallback): void {
  const group = new Set(actors)
  const ctx = this.context
  const onMemberKilled = (m: IGameActor) => {
    try {
      group.delete(m)
      if (group.size === 0) {
        func(ctx)
      }
    } catch (e) {
      ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
    }
  }
  for (const a of actors) {
    const st = TriggerGlobal.getScriptTriggers(a)
    st.onKilledInternal.add(onMemberKilled)
  }
}
```

### 8.3 ActorGlobal.Create

```typescript
create(type: string, addToWorld: boolean, initTable: ReadonlyMap<string, unknown>): IGameActor {
  const inits: ActorInitValue[] = []
  for (const [key, value] of initTable) {
    const initName = key.split('.')[0]
    const initReg = ScriptRegistry.getActorInit(initName)
    if (!initReg) throw new Error(`Unknown initializer type '${initName}'`)
    inits.push(initReg.factory(new Map([[key, value]])))
  }
  const ownerInit = inits.find(i => i.initName === 'Owner')
  if (!ownerInit) throw new Error(`Tried to create actor '${type}' with no owner init!`)

  const actor = this.context.world.createActor(false, type, inits)
  if (addToWorld) {
    this.context.world.addFrameEndTask(() => this.context.world.addActor?.(actor))
  }
  return actor
}
```

---

## 9. Work Requirement Documents

The following sections provide complete Work Requirement Documents for the Developer.

### WRD-C.1: TriggerGlobal.ts

**Source**: `OpenRA/OpenRA.Mods.Common/Scripting/Global/TriggerGlobal.cs` (588 lines)
**Target**: `src/OpenRA.Mods.Common/Scripting/Global/TriggerGlobal.ts`
**Dependencies**: ScriptGlobal, ScriptRegistry, ScriptTypes, ScriptTriggers, Trigger, TriggerCallback, IScriptContext, IGameActor, PlayerStub, CPos, WPos, WDist

### WRD-C.2: ActorGlobal.ts

**Source**: `OpenRA/OpenRA.Mods.Common/Scripting/Global/ActorGlobal.cs` (192 lines)
**Target**: `src/OpenRA.Mods.Common/Scripting/Global/ActorGlobal.ts`
**Dependencies**: ScriptGlobal, ScriptRegistry, ScriptTypes, ScriptRegistry.getActorInit(), IScriptContext, IGameActor, PlayerStub, ActorInitValue, CPos

### WRD-C.3 through C.16

[All remaining files follow the same WRD pattern documented in Section 3 above.]

---

## Implementation Checklist

- [ ] C.13 AngleGlobal.ts + AngleGlobal.test.ts
- [ ] C.14 PlayerGlobal.ts + PlayerGlobal.test.ts
- [ ] C.16 CameraGlobal.ts + CameraGlobal.test.ts
- [ ] C.15 RadarGlobal.ts + RadarGlobal.test.ts
- [ ] C.12 BeaconGlobal.ts + BeaconGlobal.test.ts
- [ ] C.8 CoordinateGlobals.ts + CoordinateGlobals.test.ts
- [ ] C.7 ColorGlobal.ts + ColorGlobal.test.ts
- [ ] C.9 DateTimeGlobal.ts + DateTimeGlobal.test.ts
- [ ] C.10 LightingGlobal.ts + LightingGlobal.test.ts
- [ ] C.11 UserInterfaceGlobal.ts + UserInterfaceGlobal.test.ts
- [ ] C.6 UtilsGlobal.ts + UtilsGlobal.test.ts
- [ ] C.5 MapGlobal.ts + MapGlobal.test.ts
- [ ] C.4 MediaGlobal.ts + MediaGlobal.test.ts
- [ ] C.3 ActorGlobal.ts + ActorGlobal.test.ts
- [ ] C.2 ReinforcementsGlobal.ts + ReinforcementsGlobal.test.ts
- [ ] C.1 TriggerGlobal.ts + TriggerGlobal.test.ts
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run src/OpenRA.Mods.Common/Scripting/Global/` passes
