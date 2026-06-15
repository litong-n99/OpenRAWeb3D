# OpenRA to Babylon.js Migration Plan: Chapter 13 -- Support Powers

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits)
> **Chapter Status**: COMPLETE (14/14 migrated, 285 tests, Round 2 APPROVED)
> **Planning Date**: 2026-06-15 | **Completion Date**: 2026-06-15
> **Prerequisite**: Chapters 3, 5 Phase E, 6 Phase A, 7 Phases D-E, 8, 9, 11, 12 (ALL COMPLETE)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Support Power System](#31-phase-a-support-power-system)
4. [Key Paradigm Shifts](#4-key-paradigm-shifts)
5. [Dependency Graph](#5-dependency-graph)
6. [Verification and Test Strategy](#6-verification-and-test-strategy)
7. [Risk and Considerations](#7-risk-and-considerations)
8. [Appendix: Architecture Decisions Record (ADR)](#8-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Support Powers system shifts from **2D grid-based superweapon activation via OrderGenerator** to **Babylon.js 3D world-space targeting with HTML overlay UI**. Support powers represent the "ultimate abilities" of the RTS genre -- airstrikes, nuclear missiles, paratrooper drops, and actor spawning -- each with distinct visual and gameplay feedback (beacon animations, camera reveals, radar pings, audio notifications).

The core paradigm shifts:

- **Charge timer with sub-tick precision** (C# `remainingSubTicks / 100` integer division) -> **TypeScript `chargeProgress: number` (0.0 to 1.0 float)** with millisecond accumulator, producing identical tick-level behavior
- **OrderGenerator targeting mode** (C# `IOrderGenerator` with custom `SelectGenericPowerTarget` / `SelectDirectionalTarget` subclasses) -> **TypeScript power-specific targeting modes** reusing the existing `WorldInteractionControllerWidget` (Ch5 Phase E) with cursor/validation override
- **Beacon rendering** (C# `Beacon` effect with sprite-based clock/arrow/circle animations) -> **Babylon.js world-space billboard overlay** using `GUI.AdvancedDynamicTexture` on a `Plane` mesh positioned above the target, with shader-based clock sweep animation
- **Camera reveal effect** (C# `RevealShroudEffect` with shroud source manipulation) -> **Reuse Ch12 Shroud visibility source** with timed auto-removal via `world.frameEndActions`
- **Aircraft formation flight** (C# `Fly` activity queuing with edge-to-edge pathfinding) -> **Reuse Ch9 Aircraft + Fly activity** with spline-based approach/departure path generation in 3D
- **INotifySupportPower observer pattern** -> **TypeScript `INotifySupportPower` interface** added to `TraitsInterfaces.ts`, with `Charged()` and `Activated()` callbacks

### 1.2 Architecture Principles

1. **SupportPowerManager lives on the Player actor**: OpenRA attaches `SupportPowerManager` to `SystemActors.Player`. In TypeScript, the manager is a component on the `Player` actor, discovered via `TraitDictionary`. Support powers are automatically registered when actors with `SupportPower` traits are added to the world.

2. **Order-based activation with targeting modes**: Each support power is activated via an Order with `OrderName = traitTypeName + "Order"` (e.g., `AirstrikePowerOrder`). The `SupportPowerManager.IResolveOrder` resolves the order to the correct `SupportPowerInstance`. Targeting uses `WorldInteractionControllerWidget` with power-specific `OrderGenerator` subclasses.

3. **Sub-tick precision charge timer**: The charge timer uses `remainingSubTicks / 100` pattern from C# (each tick advances by 100 sub-ticks). In TypeScript, this is preserved as `remainingSubTicks: number` with `Tick()` advancing by 100 per tick. The `RemainingTicks` property returns `Math.floor(remainingSubTicks / 100)` for UI display.

4. **Reference-counted power instances**: Each `SupportPowerInstance` tracks a list of `SupportPower` instances (multiple actors can provide the same power if `AllowMultiple` is set). When all instances are removed or disabled, the power is removed from the manager.

5. **TechTree prerequisite integration**: Powers with `Prerequisites` are registered with the `TechTree` system (Ch6 Phase C). The power is disabled until prerequisites are met. `DeveloperMode.AllTech` bypasses prerequisite checks.

6. **Deferred visual effects via frameEndActions**: All power effects (actor spawning, projectile launching, beacon creation, camera reveal) are queued via `world.frameEndActions` to prevent mid-tick state mutation. This matches the C# `world.AddFrameEndTask()` pattern.

7. **Beacon as world-space billboard**: Beacon rendering (clock animation, arrow, circle) shifts from 2D sprite composition to a Babylon.js billboard `Plane` with `GUI.AdvancedDynamicTexture` displaying a canvas-drawn clock animation. This renders above terrain but below UI, visible through fog of war for allied players.

8. **C&C-specific powers deferred to Chapter 19**: Chronoshift, GPS, Ion Cannon, Drop Pods, and other faction-specific powers are deferred to Chapter 19 (Mod-Specific Content). Only the Common-mod powers (usable by all factions) are implemented in Chapter 13.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-12 is available for Chapter 13:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, `Scene`, `Mesh`, `StandardMaterial` |
| Sprite/Sheet/Animation/Util | Ch2 | `Sprite`, `Sheet`, `Animation`, `Util` |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, `TraitDictionary` |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IRender`, `ConditionManager` |
| Activity base class | Ch3 Phase F | `Activity` abstract class, `ActivityRunner` |
| Map + Terrain + CellLayers | Ch4 | `Map`, `CellLayer`, `ProjectedCellLayer`, `CellRegion`, `CPos`, `WPos`, `WVec`, `WDist`, `WAngle`, `WRot` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, `distanceBetween()`, WDist-to-world-space |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | `OrderGenerator` base class, click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager`, `IResolveOrder` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset + TechTree | Ch6 Phase C | `Ruleset`, `ActorInfo`, `TechTree`, `ITechTreeElement`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Viewport`, `SelectionUtils`, `ISelectionBar` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice`, audio notifications |
| Effects + Projectile base | Ch7 Phases E-F | `SpriteEffect`, `FloatingSpriteEmitter`, `Bullet`, `NukeLaunch` |
| RenderSprites + AnimationWithOffset | Ch7 Phase G | `RenderSprites`, `AnimationWithOffset`, `WithSpriteBody` |
| Weapons & Combat | Ch8 | `Warhead`, `SpreadDamageWarhead`, `WeaponInfo`, all projectiles including `NukeLaunch` |
| Movement & Physics | Ch9 | `Mobile`, `Aircraft`, `Fly` activity, `AttackBomber`, `Cargo`, `ParaDrop`, `Locomotor` |
| Resource & Economy | Ch10 | `Harvester`, `ResourceLayer`, `PlayerResources` |
| Production & Building | Ch11 | `Production`, `ProductionQueue`, `Building`, `PlaceBuilding` |
| Shroud & Fog of War | Ch12 | `Shroud`, `RevealShroudEffect`, `FrozenActorLayer`, `CreatesShroud`, `RevealsShroud` |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (14 files + 1 interface, Phase A only)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Support Power System** | | | | | |
| 1 | `OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.ts` | `SupportPower` / `SupportPowerInfo` | 261 | HIGHEST | A |
| 2 | `OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.ts` | `SupportPowerManager` / `SupportPowerInstance` / `SelectGenericPowerTarget` | 321 | HIGHEST | A |
| 3 | `OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.ts` | `AirstrikePower` / `AirstrikePowerInfo` | 227 | HIGH | A |
| 4 | `OpenRA.Mods.Common/Traits/SupportPowers/NukePower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/NukePower.ts` | `NukePower` / `NukePowerInfo` / `SelectNukePowerTarget` | 244 | HIGH | A |
| 5 | `OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.ts` | `ParatroopersPower` / `ParatroopersPowerInfo` | 277 | HIGH | A |
| 6 | `OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.ts` | `ProduceActorPower` / `ProduceActorPowerInfo` | 114 | MEDIUM | A |
| 7 | `OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.ts` | `SpawnActorPower` / `SpawnActorPowerInfo` / `SelectSpawnActorPowerTarget` | 164 | MEDIUM | A |
| 8 | `OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.ts` | `GrantExternalConditionPower` / `GrantExternalConditionPowerInfo` / `SelectConditionTarget` | 178 | MEDIUM | A |
| 9 | `OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.ts` | `DirectionalSupportPower` / `DirectionalSupportPowerInfo` | 51 | LOW | A |
| 10 | `OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.ts` | `SelectDirectionalTarget` | 180 | LOW | A |
| 11 | `OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.cs` | `src/OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.ts` | `SupportPowerChargeBar` / `SupportPowerChargeBarInfo` | 65 | LOW | A |
| 12 | `OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.ts` | `WithSupportPowerActivationAnimation` / `WithSupportPowerActivationAnimationInfo` | 53 | LOW | A |
| 13 | `OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.ts` | `WithSupportPowerActivationOverlay` / `WithSupportPowerActivationOverlayInfo` | 67 | LOW | A |
| 14 | `OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.cs` | `src/OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.ts` | `SupportPowerCrateAction` / `SupportPowerCrateActionInfo` | 48 | LOW | A |
| -- | `OpenRA.Mods.Common/TraitsInterfaces.cs` (partial) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (addition) | `INotifySupportPower` interface | ~10 | LOW | A |

> **Complexity Legend**:
> - **LOW**: Data structures or simple observer logic with few dependencies. 48-180 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate gameplay logic with production system integration, actor spawning, or condition application. 114-178 lines of C# with multi-system dependencies.
> - **HIGH**: Complex multi-system orchestration involving aircraft formation, projectile launching, camera reveals, and beacon animations. 227-277 lines of C# with significant Babylon.js integration.
> - **HIGHEST**: Core infrastructure with hot-path timer logic, TechTree integration, Order resolution, and power lifecycle management. 261-321 lines of C#. Foundation for all power types.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 14 (+ 1 interface addition) |
| **HIGHEST complexity** | 2 files (SupportPower.cs 261 lines, SupportPowerManager.cs 321 lines) |
| **HIGH complexity** | 3 files (AirstrikePower.cs 227 lines, NukePower.cs 244 lines, ParatroopersPower.cs 277 lines) |
| **MEDIUM complexity** | 3 files (ProduceActorPower.cs 114 lines, SpawnActorPower.cs 164 lines, GrantExternalConditionPower.cs 178 lines) |
| **LOW complexity** | 6 files (DirectionalSupportPower.cs 51 lines, SelectDirectionalTarget.cs 180 lines, SupportPowerChargeBar.cs 65 lines, WithSupportPowerActivationAnimation.cs 53 lines, WithSupportPowerActivationOverlay.cs 67 lines, SupportPowerCrateAction.cs 48 lines) |
| **Total OpenRA C# source lines** | ~2,250 (+ ~10 for interface) |

| Phase | Files | C# Lines | TS Lines (actual) | Tests (actual) | Status |
|:---|:---:|:---:|:---:|:---:|:---:|
| A: Support Power System | 14 (+1 interface) | ~2,260 | 6,423 | 285 | **COMPLETE (R2 APPROVED)** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Support Power System

**Status**: COMPLETE (14/14 migrated, 285 tests, Round 2 APPROVED)
**Complexity**: HIGHEST (SupportPower.cs 261 lines + SupportPowerManager.cs 321 lines)
**Completed**: 2026-06-15
**Commits**: `aac45e2` (core infra: SupportPower + SupportPowerManager + TraitsInterfaces), `8194110` (power implementations: AirstrikePower, NukePower, ParatroopersPower, ProduceActorPower, SpawnActorPower, GrantExternalConditionPower, DirectionalSupportPower, SelectDirectionalTarget), `55be5d4` (render/crate: SupportPowerChargeBar, WithSupportPowerActivationAnimation, WithSupportPowerActivationOverlay, SupportPowerCrateAction), `830951d` (review fixes: Round 2 APPROVED)

**Description**: The support power system is the RTS "superweapon" mechanic. A `SupportPowerManager` attached to each player's `Player` actor manages a dictionary of `SupportPowerInstance` objects. Each instance tracks a charge timer (sub-tick precision), prerequisites via `TechTree`, and a list of `SupportPower` trait instances from the player's actors. When the timer completes, the power is "ready" and the player can target it. Targeting delegates to power-specific `OrderGenerator` subclasses (`SelectGenericPowerTarget`, `SelectDirectionalTarget`, `SelectNukePowerTarget`, `SelectSpawnActorPowerTarget`, `SelectConditionTarget`). Activation spawns actors, launches projectiles, creates beacons, plays audio, and reveals shroud depending on the power type.

**Paradigm Shifts**:
- C# `remainingSubTicks / 100` integer charge timer -> TypeScript `chargeProgress: number` (0.0-1.0) with sub-tick accumulator
- C# `IOrderGenerator` per-power targeting subclasses -> TypeScript `OrderGenerator` with power-specific targeting modes, reusing Ch5 infrastructure
- C# sprite-based `Beacon` effect (clock/arrow/circle animations) -> Babylon.js billboard `Plane` with `GUI.AdvancedDynamicTexture` and canvas-drawn clock sweep
- C# `RevealShroudEffect` (timed shroud source) -> Reuse Ch12 `Shroud.AddSource()`/`RemoveSource()` with `world.frameEndActions` timed removal
- C# aircraft edge-to-edge formation flight -> Reuse Ch9 `Aircraft` + `Fly` activity with 3D spline path via `CoordinateTransformer`
- C# `INotifySupportPower` observer notifications -> TypeScript `INotifySupportPower` interface in `TraitsInterfaces.ts`

#### 3.1.1 SupportPower (Base Class) + INotifySupportPower

- [x] **TODO-13.A.1** `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.ts` (261 lines C#) -- Abstract base class for all support powers: COMPLETED (R2 APPROVED, `aac45e2`/`830951d`)
  - `SupportPowerInfo` abstract trait info class (extends `PausableConditionalTraitInfo`):
    - `ChargeInterval: number` -- ticks between charges (0 = no auto-recharge)
    - `IconImage` / `Icon` / `IconPalette` -- power palette icon configuration
    - `Name` / `Description` -- Fluent localization references
    - `AllowMultiple: boolean` -- allow multiple instances of same power type
    - `OneShot: boolean` -- single-use power
    - `Cursor: string` / `BlockedCursor: string` -- targeting cursor names
    - `StartFullyCharged: boolean` -- power starts ready
    - `Prerequisites: string[]` -- `TechTree` prerequisite names
    - `OrderName: string` -- auto-generated: `GetType().Name + "Order"` (e.g., `AirstrikePowerOrder`)
    - `SupportPowerPaletteOrder: number` -- sort order in palette (default 9999)
    - Audio notification fields: `DetectedSound`, `BeginChargeSound`, `EndChargeSound`, `SelectTargetSound`, `InsufficientPowerSound`, `LaunchSound`, `IncomingSound` (each with Speech and Text notification variants)
    - `DisplayTimerRelationships: PlayerRelationship` -- who sees the charge timer
    - `DisplayBeacon: boolean` / `BeaconPalette` / `BeaconImage` / `BeaconPoster` / `BeaconPosterPalette` / `ClockSequence` / `BeaconSequence` / `ArrowSequence` / `CircleSequence` -- beacon animation configuration
    - `BeaconDelay: number` -- delay after launch before beacon appears
    - `DisplayRadarPing: boolean` / `RadarPingDuration: number` -- radar ping configuration
  - `SupportPower` abstract trait class (extends `PausableConditionalTrait<SupportPowerInfo>`):
    - `Self: Actor` -- the actor holding this power
    - `ping: RadarPing` -- active radar ping reference
    - `Created(self)` -- plays `DetectedSound` when enemy player detects this power (if local player != owner)
    - `CreateInstance(key, manager): SupportPowerInstance` -- factory method for power instance (virtual, subclasses may override)
    - `Charging(self, key)` -- called when charge cycle begins (plays `BeginChargeSound`, fires `BeginChargeTextNotification`)
    - `Charged(self, key)` -- called when charge completes (plays `EndChargeSound`, fires `EndChargeTextNotification`, notifies `INotifySupportPower.Charged`)
    - `SelectTarget(self, order, manager)` -- enters targeting mode (creates `SelectGenericPowerTarget` OrderGenerator)
    - `Activate(self, order, manager)` -- activates the power: adds `RadarPing`, notifies `INotifySupportPower.Activated`
    - `PlayLaunchSounds()` -- plays `LaunchSound` (allied) or `IncomingSound` (enemy), with Speech and Text notifications
    - `CellsMatching(location, footprint, dimensions): CPos[]` -- utility: resolves footprint char array to cell positions
  - **3D migration**: Base class has minimal 3D dependencies; beacon rendering is delegated to the `Beacon` effect class (migrated as part of TODO-13.A.3). Audio calls route through Ch7 Sound system. INotifySupportPower becomes a TypeScript interface.
  - Add `INotifySupportPower` interface to `src/OpenRA.Game/Traits/TraitsInterfaces.ts`:
    - `charged(self: IGameActor): void` -- power finished charging
    - `activated(self: IGameActor): void` -- power was activated

#### 3.1.2 SupportPowerManager + SelectGenericPowerTarget

- [x] **TODO-13.A.2** `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.ts` (321 lines C#) -- Per-player support power registry and order resolver: COMPLETED (R2 APPROVED, `aac45e2`/`830951d`)
  - `SupportPowerManagerInfo`:
    - `Requires<DeveloperModeInfo>` -- FastCharge support
    - `Requires<TechTreeInfo>` -- prerequisite integration
    - Attach location: `TraitLocation(SystemActors.Player)` -- goes on Player actor
  - `SupportPowerManager` trait class (implements `ITick`, `IResolveOrder`, `ITechTreeElement`):
    - `Self: Actor` -- the Player actor
    - `Powers: Map<string, SupportPowerInstance>` -- keyed power registry
    - `DevMode: DeveloperMode` -- reference for FastCharge
    - `TechTree: TechTree` -- reference for prerequisites
    - `RadarPings: Lazy<RadarPings>` -- lazy reference to world radar pings
    - `ActorAdded(a)` -- subscribes to `World.ActorAdded`; discovers `SupportPower` traits on newly added actors owned by this player; creates `SupportPowerInstance` if not yet registered; registers with `TechTree` if has prerequisites
    - `ActorRemoved(a)` -- subscribes to `World.ActorRemoved`; removes instance from `SupportPowerInstance.Instances`; removes power from registry if all instances gone and not disabled
    - `ITick.Tick(self)` -- ticks all `Powers.Values` each tick
    - `IResolveOrder.ResolveOrder(self, order)` -- routes order by `order.OrderString` (which is the power key) to the matching `SupportPowerInstance.Activate(order)`
    - `GetPowersForActor(a): SupportPowerInstance[]` -- returns powers provided by a specific actor (used by UI)
    - `ITechTreeElement.PrerequisitesAvailable(key)` / `PrerequisitesUnavailable(key)` -- TechTree callbacks
    - `MakeKey(sp): string` -- static key generation: `AllowMultiple` ? `orderName + "_" + actorID` : `orderName`
  - `SupportPowerInstance` class:
    - `Key: string` -- unique key in manager registry
    - `Instances: SupportPower[]` -- list of trait instances providing this power
    - `TotalTicks: number` -- total charge duration (from `Info.ChargeInterval`)
    - `remainingSubTicks: number` -- sub-tick remaining charge (initialize: `StartFullyCharged ? 0 : TotalTicks * 100`)
    - `RemainingTicks: number` -- integer remaining ticks: `Math.floor(remainingSubTicks / 100)`
    - `Active: boolean` -- power is not disabled and has at least one non-paused instance
    - `Ready: boolean` -- Active AND RemainingTicks == 0
    - `Disabled: boolean` -- owner lost, prerequisites unavailable, no enabled instances, or one-shot fired
    - `Info: SupportPowerInfo` -- first instance's info for reference
    - `Name` / `Description` -- Fluent localization lookups
    - `ResetTimer()` -- sets `remainingSubTicks = TotalTicks * 100`
    - `PrerequisitesAvailable(available)` -- TechTree callback; resets timer if unavailable
    - `Tick()` -- main charge loop:
      - `instancesEnabled = Instances.some(i => !i.IsTraitDisabled)`
      - If no enabled instances: reset timer to max
      - `Active = !Disabled && Instances.some(i => !i.IsTraitPaused)`
      - If `DevMode.FastCharge` and `remainingSubTicks > 2500`: clamp to 2500
      - Advance timer: `remainingSubTicks = Math.max(0, remainingSubTicks - 100)`
      - Fire `Charging`/`Charged` notifications once each per cycle
    - `Target()` -- enter targeting mode: plays `SelectTargetSound`, delegates to `power.SelectTarget()`
    - `Activate(order)` -- activate the power:
      - Select best instance (closest to target, non-paused, non-disabled)
      - Call `power.Activate(self, order, manager)`
      - Reset timer, clear notification flags
      - If `OneShot`: disable permanently
    - `IconOverlayTextOverride()` / `TooltipTimeTextOverride()` -- UI text overrides (virtual, subclasses override)
  - `SelectGenericPowerTarget` nested class (extends `OrderGenerator`):
    - `ActionType = MouseActionType.SupportPower`
    - `OrderKey: string` -- the power key to activate
    - `OrderInner(world, cell, worldPixel, mi)` -- yields `Order(OrderKey, manager.Self, Target.FromCell(cell))` on click
    - `Tick(world)` -- cancels targeting if power becomes unavailable
    - `GetCursor(world, cell, ...)` -- returns `info.Cursor` or `info.BlockedCursor` based on map containment
    - `Render` / `RenderAboveShroud` / `RenderAnnotations` -- all yield break (base generic target has no visual)

#### 3.1.3 AirstrikePower

- [x] **TODO-13.A.3** `src/OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.ts` (227 lines C#) -- Aircraft-based airstrike support power: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `AirstrikePowerInfo` (extends `DirectionalSupportPowerInfo`):
    - `UnitType: string` -- aircraft actor type (default `"badr.bomber"`)
    - `SquadSize: number` -- number of aircraft in formation (default 1)
    - `SquadOffset: WVec` -- offset between aircraft in formation (default `(-1536, 1536, 0)`)
    - `QuantizedFacings: number` -- number of approach direction angles (default 32)
    - `Cordon: WDist` -- distance beyond map edge to spawn/despawn (default `new WDist(5120)`)
    - `CameraActor: string` -- actor to spawn when aircraft enter attack range (optional)
    - `CameraRemoveDelay: number` -- ticks to keep camera after aircraft leave range (default 25)
    - `BeaconDistanceOffset: WDist` -- weapon range offset for beacon clock calculation (default `WDist.FromCells(6)`)
  - `AirstrikePower` trait class (extends `DirectionalSupportPower`):
    - `Activate(self, order, manager)` -- calls base.Activate, then:
      - Extract facing from `order.ExtraData` if `UseDirectionalTarget` (else random from `QuantizedFacings`)
      - Call `SendAirstrike(self, target, facing)`
    - `SendAirstrike(self, target, facing?)` -- main airstrike logic:
      - Compute altitude from `AircraftInfo.CruiseAltitude`
      - Compute approach direction from facing -> `WRot.FromYaw` -> delta vector
      - Compute start edge (map edge + Cordon beyond target away from approach)
      - Compute finish edge (opposite map edge + Cordon)
      - Create aircraft actors in formation at start edge with `CenterPositionInit`, `OwnerInit`, `FacingInit`
      - Configure `AttackBomber.SetTarget(target + formationOffset)`
      - Subscribe to `OnEnteredAttackRange` -> spawn camera, remove beacon
      - Subscribe to `OnExitedAttackRange` -> update tracking, remove camera when all exited
      - Subscribe to `OnRemovedFromWorld` -> cleanup camera/beacon
      - Queue activities: `Fly(a, startPos)` -> `Fly(a, finishPos)` -> `RemoveSelf()`
      - Create `Beacon` effect with clock animation based on aircraft distance-to-target
      - Play launch sounds
    - `RemoveCamera(camera)` -- queues `Wait(CameraRemoveDelay)` + `RemoveSelf()` on camera actor
    - `RemoveBeacon(beacon)` -- queues `world.Remove(beacon)` via `frameEndActions`
  - **3D migration**: Aircraft formation uses `CoordinateTransformer.wPosToVector3()` for spawn positions on the 3D map edge. `Fly` activity uses spline-based pathfinding for approach and departure. Beacon renders as billboard `Plane` above target position. Camera actor spawns as a `GameActor` with camera-lock logic (deferred to Chapter 16 UI implementation).
  - **Dependencies**: Ch9 (Aircraft, Fly activity, AttackBomber). Ch7 Phase D (Sound for launch/reinforcements audio).

#### 3.1.4 NukePower

- [x] **TODO-13.A.4** `src/OpenRA.Mods.Common/Traits/SupportPowers/NukePower.ts` (244 lines C#) -- Nuclear missile support power: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `NukePowerInfo` (extends `SupportPowerInfo`):
    - `MissileWeapon: string` -- weapon to use for impact (required)
    - `MissileDelay: number` -- ticks delay before missile spawns (default 0)
    - `MissileImage` / `MissileUp` / `MissileDown` -- missile sprite animation sequences
    - `MissilePalette` / `IsPlayerPalette` -- palette configuration
    - `SpawnOffset: WVec` -- offset from launch actor (for silo animation)
    - `DetonationAltitude: WDist` -- altitude offset for airburst detonation (default 0)
    - `RemoveMissileOnDetonation: boolean` -- remove missile on airburst, or let it fall (default true)
    - `TrailImage` / `TrailSequences` / `TrailInterval` / `TrailDelay` / `TrailPalette` / `TrailUsePlayerPalette` -- missile trail particle configuration
    - `FlightDelay: number` -- total flight time in ticks (split between ascent/descent, default 400)
    - `FlightVelocity: WDist` -- visual ascent velocity (default `new WDist(512)`)
    - `SkipAscent: boolean` -- skip ascent animation (launch directly toward target, default false)
    - `BeaconRemoveAdvance: number` -- ticks before detonation to remove beacon (default 25)
    - `CameraRange: WDist` -- shroud reveal radius around target (default 0 = no reveal)
    - `RevealGeneratedShroud: boolean` -- can reveal generated shroud (default true)
    - `CameraRelationships: PlayerRelationship` -- who sees the camera reveal (default Ally)
    - `CameraSpawnAdvance: number` -- ticks before detonation to spawn camera (default 25)
    - `CameraRemoveDelay: number` -- ticks after detonation to remove camera (default 25)
    - `CircleColor` / `CircleWidth` / `CircleBorderColor` / `CircleBorderWidth` -- targeting circle visualization
    - `CircleRanges: WDist[]` -- range circles shown during targeting
    - `WeaponInfo: WeaponInfo` -- loaded from Ruleset (validated in `RulesetLoaded`)
  - `NukePower` trait class (extends `SupportPower`):
    - `body: BodyOrientation` -- cached in `Created()` for silo launch offset
    - `Activate(self, order, manager)` -- calls base, plays launch sounds, calls `Activate(self, targetPosition)`
    - `Activate(self, targetPosition)` -- main nuke logic:
      - Determine missile palette (player or static)
      - Compute launch position: if `SkipAscent` or no body, use `WPos.Zero`; else `self.CenterPosition + body.LocalToWorld(info.SpawnOffset)`
      - Create `NukeLaunch` projectile (from Ch8 Phase B) with all missile parameters
      - Queue missile via `world.AddFrameEndTask(w => w.Add(missile))`
      - If `CameraRange != WDist.Zero`: create `RevealShroudEffect` (from Ch12) with timed reveal centered on target
      - If `DisplayBeacon`: create `Beacon` effect with clock animation driven by `missile.FractionComplete`
      - Beacon auto-removes `FlightDelay - BeaconRemoveAdvance` ticks before detonation
    - `SelectTarget(self, order, manager)` -- creates `SelectNukePowerTarget` OrderGenerator (renders range circles)
  - `SelectNukePowerTarget` nested class (extends `SelectGenericPowerTarget`):
    - `RenderAnnotations(wr, world)` -- renders `RangeCircleAnnotationRenderable` for each range in `CircleRanges` centered on mouse position
  - **3D migration**: NukeLaunch projectile uses Ch8 `NukeLaunch` class (already migrated). `RevealShroudEffect` reuses Ch12 `Shroud.AddSource()` with timed `RemoveSource()` callback. Range circles render via Babylon.js `LinesMesh` or `TrailMesh` in world space (XZ plane). Beacon renders as billboard `Plane`.
  - **Dependencies**: Ch8 Phase B (NukeLaunch projectile, WeaponInfo), Ch12 (Shroud, RevealShroudEffect).

#### 3.1.5 ParatroopersPower

- [x] **TODO-13.A.5** `src/OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.ts` (277 lines C#) -- Paratrooper drop support power: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `ParatroopersPowerInfo` (extends `DirectionalSupportPowerInfo`):
    - `UnitType: string` -- aircraft type for delivery (default `"badr"`)
    - `SquadSize: number` -- number of aircraft (default 1)
    - `SquadOffset: WVec` -- formation spacing (default `(-1536, 1536, 0)`)
    - `ReinforcementsArrivedSpeechNotification` / `ReinforcementsArrivedTextNotification` -- arrival notifications
    - `QuantizedFacings: number` -- approach direction count (default 32)
    - `Cordon: WDist` -- map edge distance (default 5120)
    - `DropItems: string[]` -- infantry actor types to drop
    - `AllowImpassableCells: boolean` -- allow drop on impassable terrain (default false, risky)
    - `CameraActor: string` -- camera actor on drop zone entry (optional)
    - `CameraRemoveDelay: number` -- ticks to keep camera after passengers drop (default 85)
    - `BeaconDistanceOffset: WDist` -- weapon range offset for beacon (default `WDist.FromCells(4)`)
  - `ParatroopersPower` trait class (extends `DirectionalSupportPower`):
    - `Activate(self, order, manager)` -- calls base, extracts directional facing, calls `SendParatroopers()`
    - `SendParatroopers(self, target, facing?)` -- main paradrop logic:
      - Same edge-to-edge formation computation as AirstrikePower
      - Create aircraft actors at start edge
      - Create infantry units (DropItems) with `OwnerInit`, held in a list
      - In `frameEndActions`:
        - Distribute infantry among planes (ceiling division: `DropItems.length / SquadSize`)
        - Load infantry into each aircraft via `Cargo.Load()`
        - Configure `ParaDrop.SetLZ(targetCell, !AllowImpassableCells)`
        - Subscribe `OnEnteredDropRange` -> spawn camera, remove beacon, play reinforcements audio
        - Subscribe `OnExitedDropRange` -> remove camera when all exited
        - Subscribe `OnRemovedFromWorld` -> cleanup
        - Queue activities: `Fly(a, target)` -> `Fly(a, exitEdge)` -> `RemoveSelf()`
        - Dispose unused units (if `DropItems` don't divide evenly into planes)
        - Create `Beacon` with clock animation driven by aircraft distance-to-target
      - Play launch sounds
    - `RemoveCamera(camera)` / `RemoveBeacon(beacon)` -- same pattern as AirstrikePower
  - **3D migration**: Essentially identical architecture to AirstrikePower but with `ParaDrop`/`Cargo` instead of `AttackBomber`. Infantry drop uses `Cargo.Unload()` trigger when aircraft enters drop zone. Paratrooper parachute effect is a `SpriteEffect` billboard (Ch7 Phase E).
  - **Dependencies**: Ch9 (Aircraft, Fly activity, Cargo, ParaDrop). Ch7 Phase D (Sound). Ch7 Phase E (SpriteEffect for parachute visuals).

#### 3.1.6 ProduceActorPower

- [x] **TODO-13.A.6** `src/OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.ts` (114 lines C#) -- Production queue-based support power: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `ProduceActorPowerInfo` (extends `SupportPowerInfo`):
    - `Actors: string[]` -- actor types to produce (required)
    - `Type: string` -- production queue type (required, e.g., "Vehicle", "Infantry")
    - `ReadyAudio: string` -- speech notification on successful production
    - `ReadyTextNotification: string` -- text notification on successful production
    - `BlockedAudio: string` -- speech notification when exit is jammed
    - `BlockedTextNotification: string` -- text notification when exit is jammed
  - `ProduceActorPower` trait class (extends `SupportPower`):
    - `faction: string` -- from `FactionInit` (for faction-specific actor initialization)
    - `SelectTarget(self, order, manager)` -- overrides base: immediately issues order (no targeting step)
    - `Activate(self, order, manager)` -- main production logic:
      - Calls `base.Activate()`, plays launch sounds
      - Finds all `Production` traits on actors owned by this player that produce `info.Type`
      - Sorts producers: primary buildings first, then by actor ID
      - Tries each producer in order; for each actor in `info.Actors`:
        - Creates `TypeDictionary` with `OwnerInit` and `FactionInit`
        - Calls `p.Trait.Produce(p.Actor, ai, info.Type, inits, 0)`
        - If production succeeds: play ReadyAudio/ReadyTextNotification, stop iterating
      - If all producers fail: play BlockedAudio/BlockedTextNotification
    - **Design note**: The power resets the timer even if production fails. OpenRA source has a TODO comment acknowledging this as a known limitation.
  - **3D migration**: No direct 3D rendering. Integration with Ch11 `Production` and `ProductionQueue`. Audio via Ch7 Phase D.
  - **Dependencies**: Ch11 (Production, ProductionQueue). Ch7 Phase D (Sound).

#### 3.1.7 SpawnActorPower

- [x] **TODO-13.A.7** `src/OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.ts` (164 lines C#) -- Direct actor spawning support power: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `SpawnActorPowerInfo` (extends `SupportPowerInfo`):
    - `Actor: string` -- actor type to spawn (required)
    - `LifeTime: number` -- lifetime in ticks before auto-removal (default 250, -1 = permanent)
    - `Terrain: string[]` -- allowed terrain types for spawn location
    - `AllowUnderShroud: boolean` -- allow spawning under shroud (default true)
    - `DeploySound: string` -- sound played at spawn position
    - `EffectImage` / `EffectSequence` / `EffectPalette` / `EffectPaletteIsPlayerPalette` -- spawn visual effect
  - `SpawnActorPower` trait class (extends `SupportPower`):
    - `Activate(self, order, manager)` -- main spawn logic:
      - Validate position: map contains cell, shroud check (if `!AllowUnderShroud`), terrain check
      - Calls `base.Activate()`
      - In `frameEndActions`:
        - Play launch sounds + `DeploySound`
        - Spawn `SpriteEffect` if effect configured
        - Create actor via `w.CreateActor(info.Actor, [LocationInit(cell), OwnerInit(owner)])`
        - If `LifeTime > -1`: queue `Wait(LifeTime)` + `RemoveSelf()` activities
    - `SelectTarget(self, order, manager)` -- creates `SelectSpawnActorPowerTarget` OrderGenerator with terrain validation
    - `Validate(world, info, cell): boolean` -- static validation: map containment, shroud check, terrain type check
  - `SelectSpawnActorPowerTarget` nested class (extends `OrderGenerator`):
    - `ActionType = MouseActionType.SupportPower`
    - `OrderInner(world, cell, ...)` -- yields order only if `power.Validate()` passes
    - `Tick(world)` -- cancels if power key not in manager
    - `GetCursor(world, cell, ...)` -- returns `info.Cursor` or `info.BlockedCursor` based on validation
  - **3D migration**: Spawned actor placed at cell center via `CoordinateTransformer.cellToVector3()`. `SpriteEffect` for deploy visual is a billboard particle effect (Ch7 Phase E). `LifeTime` uses `Wait` activity from Ch3 Phase F.
  - **Dependencies**: Ch3 (Actor, Activity, Wait, RemoveSelf). Ch7 Phase D (Sound). Ch7 Phase E (SpriteEffect). Ch12 (Shroud for validation).

#### 3.1.8 GrantExternalConditionPower

- [x] **TODO-13.A.8** `src/OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.ts` (178 lines C#) -- Area-of-effect condition application support power: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `GrantExternalConditionPowerInfo` (extends `SupportPowerInfo`):
    - `Condition: string` -- condition token name to apply (required)
    - `Duration: number` -- condition duration in ticks (0 = permanent, default 0)
    - `Dimensions: CVec` -- footprint dimensions
    - `Footprint: string` -- footprint pattern (chars, 'x' = affected cell)
    - `OnFireSound: string` -- sound at target area
    - `ValidRelationships: PlayerRelationship` -- who can be targeted (default Ally)
    - `Sequence: string` -- animation sequence for granting actor (default "active")
    - `FootprintImage` / `FootprintSequence` -- footprint overlay visualization
  - `GrantExternalConditionPower` trait class (extends `SupportPower`):
    - `footprint: char[]` -- parsed footprint (non-whitespace chars)
    - `SelectTarget(self, order, manager)` -- creates `SelectConditionTarget` OrderGenerator
    - `Activate(self, order, manager)` -- main condition logic:
      - Calls `base.Activate()`, plays launch sounds
      - Plays `WithSpriteBody.PlayCustomAnimation(self, info.Sequence)` if available
      - Plays `OnFireSound` at target position
      - For each actor in `UnitsInRange(targetCell)`:
        - Finds `ExternalCondition` trait matching `info.Condition` that `CanGrantCondition(self)`
        - Calls `trait.GrantCondition(actor, self, info.Duration)`
    - `UnitsInRange(xy: CPos): Actor[]` -- spatial query:
      - Resolves footprint cells via `CellsMatching()`
      - Queries `ActorMap.GetActorsAt(tile)` for each footprint cell
      - Deduplicates via HashSet
      - Filters by `ValidRelationships` and `CanGrantCondition()`
  - `SelectConditionTarget` nested class (extends `OrderGenerator`):
    - `ActionType = MouseActionType.SupportPower`
    - `OrderInner(world, cell, ...)` -- yields order if any unit in range
    - `Tick(world)` -- cancels if power unavailable
    - `Render(wr, world)` -- renders footprint overlay tiles at mouse position
    - `RenderAnnotations(wr, world)` -- highlights targetable actors with red `ISelectionDecorations`
    - `GetCursor(world, cell, ...)` -- returns `Cursor` or `BlockedCursor` based on `UnitsInRange`
  - **3D migration**: Footprint overlay renders as textured quads (Billboard `Plane` at terrain height). Actor highlight uses red emissive highlight on `StandardMaterial`. Condition application uses Ch3 `ConditionManager` with `GrantCondition()`.
  - **Dependencies**: Ch3 (ConditionManager, ExternalCondition). Ch3 (ActorMap for spatial query). Ch7 Phase G (RenderSprites, WithSpriteBody).

#### 3.1.9 DirectionalSupportPower

- [x] **TODO-13.A.9** `src/OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.ts` (51 lines C#) -- Directional targeting base class: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `DirectionalSupportPowerInfo` (extends `SupportPowerInfo`):
    - `UseDirectionalTarget: boolean` -- enable directional targeting mode (default false)
    - `Arrows: string[]` -- 8 arrow sequence names for direction UI (CCW: N, NW, W, SW, S, SE, E, NE -- OpenRA order is CCW starting from (0,-1))
    - `DirectionArrowAnimation: string` -- animation image name for arrows
    - `DirectionArrowPalette: string` -- palette for arrows (default "chrome")
  - `DirectionalSupportPower` trait class (extends `SupportPower`):
    - `SelectTarget(self, order, manager)` -- overrides base: creates `SelectDirectionalTarget` if `UseDirectionalTarget`, else delegates to base
  - **3D migration**: No direct 3D dependency. Delegates to `SelectDirectionalTarget` OrderGenerator.
  - **Dependencies**: Ch5 Phase E (WorldInteractionControllerWidget -- OrderGenerator).

#### 3.1.10 SelectDirectionalTarget

- [x] **TODO-13.A.10** `src/OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.ts` (180 lines C#) -- Directional targeting OrderGenerator: COMPLETED (R2 APPROVED, `8194110`/`830951d`)
  - `MinDragThreshold = 20` / `MaxDragThreshold = 75` -- drag detection thresholds in pixels
  - Implements `IOrderGenerator`:
    - `ActionButton` / `CancelButton` -- from `GameSettings.MouseActionType.SupportPower`
    - `Order(world, cell, worldPixel, mi)` -- three-phase interaction:
      1. Cancel button: exits targeting mode
      2. Action button down: sets `targetCell`, locks cursor, marks `activated`
      3. Mouse move (while activated): accumulates `dragDirection`, computes angle via `AngleOf(delta)`, selects arrow sprite via `GetArrow(angle)`, updates `MouseAttachmentWidget`
      4. Action button up: if `IsOutsideDragZone` (drag > MinDragThreshold), yields `Order(order, manager.Self, Target.FromCell(cell))` with `ExtraData = arrow.Direction.Facing`; else yields with `ExtraData = uint.MaxValue`
    - `Tick(world)` -- cancels if power becomes unavailable
    - `Deactivate()` -- resets `MouseAttachmentWidget`, unlocks cursor
    - `GetCursor(world, cell, ...)` -- returns `info.Cursor` or `info.BlockedCursor`
  - Static helpers:
    - `AngleOf(delta: float2): number` -- converts drag vector to angle (0 = North, CW from top, matching OpenRA's CCW convention)
    - `GetArrow(degree): Arrow` -- binary search / first-over-threshold lookup using `EndAngle`
    - `LoadArrows(animation, world, count): Arrow[]` -- pre-loads arrow sprites, computes angle sectors
  - `Arrow` record: `(Sprite, EndAngle: number, Direction: WAngle)`
  - **3D migration**: Directional drag UI is an HTML/CSS overlay (replaces `MouseAttachmentWidget`). Arrow sprite rendered as CSS `cursor: url()` or HTML element following mouse. Direction visualization uses a rotated arrow element in the DOM overlay, computed from the drag vector angle.
  - **Dependencies**: Ch5 Phase E (OrderGenerator). Ch7 Phase A (InputHandler for mouse events).

#### 3.1.11 SupportPowerChargeBar

- [x] **TODO-13.A.11** `src/OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.ts` (65 lines C#) -- Selection bar showing support power charge progress: COMPLETED (R2 APPROVED, `55be5d4`/`830951d`)
  - `SupportPowerChargeBarInfo` (extends `ConditionalTraitInfo`):
    - `DisplayRelationships: PlayerRelationship` -- who sees the charge bar (default Ally)
    - `Color: Color` -- bar color (default Magenta)
  - `SupportPowerChargeBar` trait class (extends `ConditionalTrait<Info>`, implements `ISelectionBar`, `INotifyOwnerChanged`):
    - `self: Actor` -- the actor holding the power
    - `spm: SupportPowerManager` -- reference from player actor, updated on owner change
    - `ISelectionBar.GetValue(): number` -- returns `1 - power.RemainingTicks / power.TotalTicks` (charge progress as 0-1)
      - Returns 0 if disabled, no powers found, or viewer is not in `DisplayRelationships`
    - `ISelectionBar.GetColor(): Color` -- returns `Info.Color`
    - `ISelectionBar.DisplayWhenEmpty: boolean` -- returns false
    - `INotifyOwnerChanged.OnOwnerChanged(self, oldOwner, newOwner)` -- re-fetches `SupportPowerManager` from new owner
  - **3D migration**: Charge bar renders via canvas-based `ISelectionBar` interface (migrated as part of Ch3). This trait provides the data; rendering is handled by the selection bar renderer. No direct 3D dependency.
  - **Dependencies**: Ch3 (ISelectionBar interface). Ch13 (SupportPowerManager -- referenced via player actor).

#### 3.1.12 WithSupportPowerActivationAnimation

- [x] **TODO-13.A.12** `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.ts` (53 lines C#) -- Building animation override on power activation: COMPLETED (R2 APPROVED, `55be5d4`/`830951d`)
  - `WithSupportPowerActivationAnimationInfo` (extends `ConditionalTraitInfo`, `Requires<WithSpriteBodyInfo>`):
    - `Sequence: string` -- animation sequence to play (default "active")
    - `Body: string` -- which sprite body to animate (default "body")
  - `WithSupportPowerActivationAnimation` trait class (extends `ConditionalTrait<Info>`, implements `INotifySupportPower`):
    - `wsb: WithSpriteBody` -- the target sprite body (resolved by `Body` name)
    - `INotifySupportPower.Charged(self)` -- no-op (animation triggers on activation, not charge)
    - `INotifySupportPower.Activated(self)` -- calls `wsb.PlayCustomAnimation(self, Info.Sequence, () => wsb.CancelCustomAnimation(self))` if trait not disabled
    - `TraitDisabled(self)` -- calls `wsb.CancelCustomAnimation(self)` to clear animation
  - **3D migration**: `WithSpriteBody.PlayCustomAnimation()` triggers a Babylon.js animation override (sprite frame swap at 25fps via `Animation` class from Ch2). The `CancelCustomAnimation` callback restores the default animation loop.
  - **Dependencies**: Ch7 Phase G (RenderSprites, WithSpriteBody). Ch2 (Animation sprite frame swap).

#### 3.1.13 WithSupportPowerActivationOverlay

- [x] **TODO-13.A.13** `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.ts` (67 lines C#) -- Overlay animation on power activation: COMPLETED (R2 APPROVED, `55be5d4`/`830951d`)
  - `WithSupportPowerActivationOverlayInfo` (extends `ConditionalTraitInfo`, `Requires<RenderSpritesInfo>`, `Requires<BodyOrientationInfo>`):
    - `Sequence: string` -- overlay animation sequence (default "active")
    - `Offset: WVec` -- position relative to body (default `WVec.Zero`)
    - `Palette` / `IsPlayerPalette` -- palette configuration
  - `WithSupportPowerActivationOverlay` trait class (extends `ConditionalTrait<Info>`, implements `INotifySupportPower`):
    - `overlay: Animation` -- animation instance, played once then hidden
    - `visible: boolean` -- visibility toggle
    - Constructor:
      - Gets `RenderSprites` and `BodyOrientation` from actor
      - Creates `Animation` with actor's render image
      - Plays `info.Sequence` once, then sets `visible = false`
      - Creates `AnimationWithOffset(overlay, positionFunc, visibilityFunc, zOffsetFunc)`:
        - Position: `body.LocalToWorld(info.Offset.Rotate(body.QuantizeOrientation(self.Orientation)))`
        - Visible: `IsTraitDisabled || !visible`
        - Z offset: `RenderUtils.ZOffsetFromCenter(self, p, 1)`
    - `INotifySupportPower.Charged(self)` -- no-op
    - `INotifySupportPower.Activated(self)` -- sets `visible = true`, replays `overlay.PlayThen(sequence, () => visible = false)`
  - **3D migration**: `AnimationWithOffset` renders as a billboard `Plane` in 3D space, positioned relative to the actor's body transform. The overlay appears at the configured offset once on activation, plays through once, then hides.
  - **Dependencies**: Ch7 Phase G (RenderSprites, AnimationWithOffset, BodyOrientation). Ch2 (Animation frame swap).

#### 3.1.14 SupportPowerCrateAction

- [x] **TODO-13.A.14** `src/OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.ts` (48 lines C#) -- Crate that grants a support power proxy actor: COMPLETED (R2 APPROVED, `55be5d4`/`830951d`)
  - `SupportPowerCrateActionInfo` (extends `CrateActionInfo`):
    - `Proxy: string` -- proxy actor type that grants the support power (required)
  - `SupportPowerCrateAction` trait class (extends `CrateAction`):
    - `Activate(collector)` -- in `frameEndActions`: creates proxy actor with `OwnerInit(collector.Owner)`, calls `base.Activate(collector)`
  - **3D migration**: Proxy actor creation follows standard Ch3 actor spawning pattern. The crate action itself has no visual rendering.
  - **Dependencies**: Ch3 (World, Actor, crate pick-up system). Ch13 (SupportPower -- the spawned proxy actor must have a SupportPower trait).

**Phase A Summary**: 14 files + 1 interface addition, ~2,260 C# lines. Actual: 6,423 TS implementation lines, 5,126 test lines, 285 tests. Commits: `aac45e2` (core infra), `8194110` (power implementations), `55be5d4` (render/crate), `830951d` (review fixes). R2 APPROVED 2026-06-15.

---

## 4. Key Paradigm Shifts

| OpenRA Pattern | Babylon.js / TypeScript Pattern | Explanation |
|----------------|-------------------------------|-------------|
| `remainingSubTicks / 100` integer charge timer | `chargeProgress: number` (0.0-1.0 float) with sub-tick accumulator | TypeScript float preserves sub-tick precision; `RemainingTicks` rounds via `Math.floor()` for integer display parity |
| `IOrderGenerator` per-power targeting subclasses | `OrderGenerator` with power-specific `targetingMode` property + validation callback | Reuses Ch5 Phase E `WorldInteractionControllerWidget`; each power provides a `validationFn` and `cursorFn` instead of subclassing |
| `Beacon` sprite-based clock/arrow/circle effect | Billboard `Plane` + `GUI.AdvancedDynamicTexture` with canvas-drawn clock sweep | World-space overlay renders above terrain at target position; clock animation uses canvas `2dContext.arc()` with `fractionComplete` input |
| `RevealShroudEffect` timed shroud source | Ch12 `Shroud.AddSource()` with `world.scheduleAction(delay, () => Shroud.RemoveSource())` | Reuses existing Ch12 shroud infrastructure; no separate `RevealShroudEffect` class needed |
| Aircraft edge-to-edge `Fly` activity chain | 3D spline-based pathfinding for approach/departure via Ch9 `Fly` activity | `CoordinateTransformer.wPosToVector3()` maps edge positions; `Fly` uses `PathSpline` for smooth 3D trajectories |
| `SelectDirectionalTarget` drag-to-aim cursor | HTML `canvas` overlay with CSS `transform: rotate()` on arrow sprite | Mouse drag delta maps to angle; arrow sprite rendered as CSS element tracked to mouse position; replaces `MouseAttachmentWidget` with DOM overlay |
| `RangeCircleAnnotationRenderable` 2D circle drawing | Babylon.js `LinesMesh` or `TrailMesh` in XZ plane at terrain height | Circle rendered as line loop in world space; radius from `WDist` via `CoordinateTransformer`; color/width from config |
| `Footprint` char array cell pattern rendering | Billboard `Plane` grid at terrain height with textured quad for each `'x'` cell | Each footprint cell gets a `Plane` at `cellToVector3(CPos)` with footprint tile texture; rendered via `RenderGroup` overlay |
| `ISelectionBar.GetValue()` charge progress | HTML/CSS progress bar or canvas `fillRect()` driven by Babylon.js `scene.onBeforeRenderObservable` | Ui renders as HTML overlay element positioned via `scene.project()` from actor world position to screen coordinates |
| `INotifySupportPower` observer pattern | TypeScript `INotifySupportPower` interface + `TraitDictionary.getComponentsOfType()` notification loop | Identical pattern to C# -- iterate all traits implementing the interface and call each method |

---

## 5. Dependency Graph

```
Chapters 2-11 (COMPLETE -- Foundation)
  |
  +--> Chapter 3 (World, Actor, Player, TraitDictionary, INotifyCreated) -- COMPLETE
  |     |
  |     +--> Chapter 3 Phase F (Activity base -- Wait, RemoveSelf) -- COMPLETE
  |
  +--> Chapter 5 Phase E (WorldInteractionControllerWidget -- OrderGenerator) -- COMPLETE
  |     |
  |     +--> Chapter 13 Phase A (Support Power System)
  |           |
  |           +--> SupportPower.ts (abstract base) + INotifySupportPower interface
  |           |     |
  |           |     +--> SupportPowerManager.ts (registry + Order resolution + SelectGenericPowerTarget)
  |           |           |
  |           |           +--> DirectionalSupportPower.ts (directional base)
  |           |           |     |
  |           |           |     +--> SelectDirectionalTarget.ts (drag-to-aim OrderGenerator)
  |           |           |     +--> AirstrikePower.ts (aircraft formation + AttackBomber)
  |           |           |     +--> ParatroopersPower.ts (aircraft formation + Cargo + ParaDrop)
  |           |           |
  |           |           +--> NukePower.ts (NukeLaunch + RevealShroudEffect + SelectNukePowerTarget)
  |           |           +--> SpawnActorPower.ts (direct spawn + SpriteEffect + SelectSpawnActorPowerTarget)
  |           |           +--> ProduceActorPower.ts (Production queue integration)
  |           |           +--> GrantExternalConditionPower.ts (ExternalCondition + footprint + SelectConditionTarget)
  |           |
  |           +--> SupportPowerChargeBar.ts (ISelectionBar charge progress)
  |           +--> WithSupportPowerActivationAnimation.ts (WithSpriteBody animation override)
  |           +--> WithSupportPowerActivationOverlay.ts (AnimationWithOffset overlay)
  |           +--> SupportPowerCrateAction.ts (crate pickup -> proxy actor)
  |
  +--> Chapter 6 Phase A (Order, IResolveOrder, OrderManager) -- COMPLETE
  +--> Chapter 6 Phase C (TechTree, ITechTreeElement) -- COMPLETE
  +--> Chapter 7 Phase D (Sound -- all audio notifications) -- COMPLETE
  +--> Chapter 7 Phase E (SpriteEffect -- deploy/spawn visual effects) -- COMPLETE
  +--> Chapter 7 Phase G (RenderSprites, AnimationWithOffset, WithSpriteBody) -- COMPLETE
  +--> Chapter 8 Phase B (NukeLaunch projectile) -- COMPLETE
  +--> Chapter 9 (Aircraft, Fly activity, AttackBomber, Cargo, ParaDrop) -- COMPLETE
  +--> Chapter 11 (Production, ProductionQueue) -- COMPLETE
  +--> Chapter 12 (Shroud, RevealShroudEffect) -- COMPLETE
```

### Internal Phase Dependencies

```
SupportPower.ts (abstract base + INotifySupportPower) -- FOUNDATION
  |
  +--> SupportPowerManager.ts (registry + SelectGenericPowerTarget)
  |     |
  |     +--> DirectionalSupportPower.ts (directional base)
  |     |     |
  |     |     +--> SelectDirectionalTarget.ts (drag-to-aim OG)
  |     |     +--> AirstrikePower.ts (aircraft formation)
  |     |     +--> ParatroopersPower.ts (paradrop)
  |     |
  |     +--> NukePower.ts (nuke missile + SelectNukePowerTarget)
  |     +--> SpawnActorPower.ts (spawn + SelectSpawnActorPowerTarget)
  |     +--> ProduceActorPower.ts (production queue)
  |     +--> GrantExternalConditionPower.ts (condition + SelectConditionTarget)
  |
  +--> SupportPowerChargeBar.ts (charge progress bar)
  +--> WithSupportPowerActivationAnimation.ts (animation override)
  +--> WithSupportPowerActivationOverlay.ts (overlay animation)
  +--> SupportPowerCrateAction.ts (crate action)
```

### Critical Path

```
SupportPower.ts (base) -> SupportPowerManager.ts (core registry)
     |
     +-> DirectionalSupportPower.ts (directional base) -> SelectDirectionalTarget.ts -> AirstrikePower.ts + ParatroopersPower.ts
     +-> NukePower.ts (depends on Ch8 NukeLaunch + Ch12 Shroud)
     +-> SpawnActorPower.ts (depends on Ch7 SpriteEffect + Ch12 Shroud)
     +-> ProduceActorPower.ts (depends on Ch11 Production)
     +-> GrantExternalConditionPower.ts (depends on Ch3 ConditionManager)
```

### Parallelization Opportunities

- **Track 1** (core foundation): SupportPower.ts + INotifySupportPower + SupportPowerManager.ts
- **Track 2** (directional powers): DirectionalSupportPower.ts + SelectDirectionalTarget.ts + AirstrikePower.ts + ParatroopersPower.ts
- **Track 3** (standalone powers): NukePower.ts + SpawnActorPower.ts (independent after core is done)
- **Track 4** (production/condition): ProduceActorPower.ts + GrantExternalConditionPower.ts (independent after core is done)
- **Track 5** (visual support): SupportPowerChargeBar.ts + WithSupportPowerActivationAnimation.ts + WithSupportPowerActivationOverlay.ts + SupportPowerCrateAction.ts (LOW complexity, parallelizable after core)

---

## 6. Verification and Test Strategy

### 6.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns:

- [ ] **TEST-13.1** `SupportPowerInstance` charge timer: verify `remainingSubTicks` decrements by 100 per tick, reaches 0 after `TotalTicks` ticks -- unit test with mock SupportPowerManager, manually call `Tick()` N times
- [ ] **TEST-13.2** `SupportPowerInstance` `StartFullyCharged`: verify `remainingSubTicks` initializes to 0 when flag set, power is immediately Ready
- [ ] **TEST-13.3** `SupportPowerInstance` `DevMode.FastCharge`: verify `remainingSubTicks` clamps to 2500 when `FastCharge` enabled and `remainingSubTicks > 2500`
- [ ] **TEST-13.4** `SupportPowerInstance` `OneShot`: verify power disables permanently after activation, cannot be activated again
- [ ] **TEST-13.5** `SupportPowerInstance` `Disabled` states: owner lost -> disabled; prerequisites unavailable -> disabled; all instances disabled -> disabled; one-shot fired -> disabled
- [ ] **TEST-13.6** `SupportPowerInstance` `Active` check: verify `Active` is false when all instances paused (`IsTraitPaused`), true when at least one non-paused
- [ ] **TEST-13.7** `SupportPowerInstance` notifications: verify `Charging()` fires exactly once per charge cycle; `Charged()` fires exactly once when `RemainingTicks == 0`
- [ ] **TEST-13.8** `SupportPowerInstance` targeting: verify `Target()` does nothing when not `Ready`; creates correct `OrderGenerator` when `Ready`
- [ ] **TEST-13.9** `SupportPowerInstance.Activate()` instance selection: verify closest non-paused, non-disabled instance is selected (by `HorizontalLengthSquared` comparison)
- [ ] **TEST-13.10** `SupportPowerManager` actor discovery: adding an actor with `SupportPower` trait registers power; removing the last actor removes power
- [ ] **TEST-13.11** `SupportPowerManager.MakeKey()`: `AllowMultiple` generates `orderName + "_" + actorID`; single instance generates `orderName` only
- [ ] **TEST-13.12** `SupportPowerManager.IResolveOrder`: verify order with `order.OrderString` matching power key activates correct power
- [ ] **TEST-13.13** `SupportPowerManager` `TechTree` integration: power with prerequisites starts disabled; becomes active when `PrerequisitesAvailable(key)` called
- [ ] **TEST-13.14** `SelectDirectionalTarget` drag detection: drag below `MinDragThreshold` produces `ExtraData = uint.MaxValue`; drag above produces directional facing; drag above `MaxDragThreshold` clamps to max threshold
- [ ] **TEST-13.15** `SelectDirectionalTarget.AngleOf()`: verify angle computation for cardinal and diagonal directions (0deg = North, 90deg = East, etc.)
- [ ] **TEST-13.16** `SelectDirectionalTarget.GetArrow()`: verify arrow selection for boundary angles (e.g., angle exactly at `EndAngle` selects that arrow)
- [ ] **TEST-13.17** `SpawnActorPower.Validate()`: test terrain type acceptance, shroud rejection, map containment
- [ ] **TEST-13.18** `GrantExternalConditionPower.UnitsInRange()`: footprint resolution, relationship filtering, condition eligibility
- [ ] **TEST-13.19** `ProduceActorPower` producer selection: primary buildings first, then by actor ID; handles single vs multiple producers
- [ ] **TEST-13.20** `ProduceActorPower` failure case: all producers blocked returns false, plays `BlockedAudio`; success plays `ReadyAudio`
- [ ] **TEST-13.21** `SupportPowerChargeBar.GetValue()`: returns correct progress (0.0 when full timer, 0.5 when half, 1.0 when ready); returns 0 when trait disabled
- [ ] **TEST-13.22** `WithSupportPowerActivationAnimation.Activated()`: verify `PlayCustomAnimation` called with correct sequence; `TraitDisabled()` calls `CancelCustomAnimation`
- [ ] **TEST-13.23** `SupportPowerCrateAction.Activate()`: verify proxy actor created with `OwnerInit(collector.Owner)` on the world
- [ ] **TEST-13.24** End-to-end power lifecycle: power discovered on actor add -> timer counts down -> power becomes ready -> targeting mode entered -> order issued -> power activated -> timer resets -> one-shot disables

### 6.2 Per-File Test Estimates

| File | Tests (est.) | Test Lines (est.) |
|:---|:---:|:---:|
| SupportPower.ts + INotifySupportPower | ~20 | ~600 |
| SupportPowerManager.ts (incl. SupportPowerInstance + SelectGenericPowerTarget) | ~35 | ~1,200 |
| AirstrikePower.ts | ~12 | ~400 |
| NukePower.ts | ~14 | ~450 |
| ParatroopersPower.ts | ~14 | ~450 |
| ProduceActorPower.ts | ~10 | ~300 |
| SpawnActorPower.ts | ~12 | ~400 |
| GrantExternalConditionPower.ts | ~12 | ~400 |
| DirectionalSupportPower.ts | ~4 | ~120 |
| SelectDirectionalTarget.ts | ~10 | ~350 |
| SupportPowerChargeBar.ts | ~6 | ~200 |
| WithSupportPowerActivationAnimation.ts | ~4 | ~120 |
| WithSupportPowerActivationOverlay.ts | ~4 | ~120 |
| SupportPowerCrateAction.ts | ~3 | ~100 |
| **Total** | **~150-170** | **~5,000-5,200** |

### 6.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Power targeting UI | `/test/support-powers/targeting/` | Verify generic power targeting cursor, click-to-target, blocked cursor on invalid terrain |
| Directional targeting | `/test/support-powers/directional-target/` | Verify drag-to-aim arrow cursor, 8-direction angle mapping, drag threshold detection |
| Beacon animation | `/test/support-powers/beacon/` | Verify beacon billboard placement above target, clock sweep animation, arrow/circle rendering |
| Nuke launch visual | `/test/support-powers/nuke-launch/` | Verify NukeLaunch projectile ascent/descent, detonation flash, camera reveal, range circles |
| Airstrike formation | `/test/support-powers/airstrike/` | Verify aircraft formation approach along map edge, bomb drop, camera spawn, beacon removal |
| Paratrooper drop | `/test/support-powers/paratroopers/` | Verify aircraft approach, infantry paradrop, parachute effect, reinforcements notification |
| Footprint overlay | `/test/support-powers/footprint/` | Verify `GrantExternalConditionPower` footprint tile overlay at mouse position, actor highlight |
| Charge bar | `/test/support-powers/charge-bar/` | Verify `SupportPowerChargeBar` progress animation (0% -> 100% over charge interval), color, relationship filter |

### 6.4 Integration Testing

- [ ] **TEST-13.I1** Full power lifecycle: building with SupportPower added to world -> timer begins -> external prerequisites met -> power ready -> player targets -> power activates -> timer resets -> building destroyed -> power removed from manager
- [ ] **TEST-13.I2** Airstrike + AttackBomber integration: aircraft spawns at map edge -> flies toward target -> enters attack range -> AttackBomber fires -> camera spawned -> aircraft exits -> camera removed
- [ ] **TEST-13.I3** Nuke + NukeLaunch + Shroud integration: missile launched -> FlightDelay ticks pass -> NukeLaunch impacts -> SpreadDamageWarhead applies -> RevealShroudEffect activates for CameraRange -> camera reveals -> camera removed after delay
- [ ] **TEST-13.I4** Paratroopers + Cargo + ParaDrop integration: aircraft loaded with infantry -> flies to drop zone -> ParaDrop triggers -> infantry paradrops -> aircraft exits -> unused infantry disposed
- [ ] **TEST-13.I5** ProduceActorPower + Production/ProductionQueue integration: production power activated -> Production.Produce() succeeds -> actor appears at rally point -> exit blocked -> plays blocked notification -> another producer tried
- [ ] **TEST-13.I6** GrantExternalConditionPower + ConditionManager integration: condition applied to footprint cells -> valid actors receive condition -> duration expires -> condition auto-removed -> invalid relationship actors not affected

---

## 7. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Sub-tick timer precision** (float accumulation vs C# integer `remainingSubTicks / 100` may diverge after many cycles) | MEDIUM | Desync in multiplayer if timer not frame-deterministic | Use integer accumulator (`remainingSubTicks` is number, not float) identical to C#; verify timer precision over 100+ charge cycles |
| **Beacon billboard rendering** (multiple simultaneous beacons on large maps) | MEDIUM | Frame drops if many beacons active simultaneously | Limit beacon `Plane` meshes to 16 max; use `Mesh.visibility` toggle instead of create/destroy; shared `GUI.AdvancedDynamicTexture` for clock |
| **Airstrike/Paratroopers aircraft formation** (Fly activity spline computation per aircraft) | MEDIUM | 10+ aircraft squads recompute splines each frame | Precompute spline once per formation, apply offset per aircraft; use `PathSpline` with shared control points |
| **NukePower CameraRange shroud reveal** (large range reveals many cells) | LOW | Instant cell state change for 50+ cells may tick spike | Batch shroud updates via `Shroud.AddSource()` (which handles batch marking internally) |
| **SelectDirectionalTarget drag UI** (HTML overlay tracking vs C# MouseAttachmentWidget) | LOW | CSS cursor tracking may feel different from native C# | Use `requestPointerLock()` or `pointermove` event at high polling rate; pre-render arrow sprites as CSS `background-image` for instant update |
| **Footprint overlay rendering** (many billboard quads at mouse position) | MEDIUM | 50+ footprint cells each create a `Plane` mesh -> GPU overhead | Use `Mesh.InstancedMesh` for footprint cells (single draw call); enabled/disabled per-cell visibility |
| **ProduceActorPower producer search** (linear scan of all player actors each activation) | LOW | O(player actors) scan; typically < 100 actors | Acceptable -- activation is rare (once per charge cycle). Cache sorted producer list on actor add/remove |
| **GrantExternalConditionPower actor scan** (footprint spatial query per tick during targeting) | LOW | O(footprint cells * actors per cell) via ActorMap | Footprint typically 3x3=9 cells; ActorMap `GetActorsAt` is O(1) per cell; negligible overhead |
| **C&C powers deferred to Ch19** (ChronoshiftPower is the most complex power in the game) | LOW | ChronoshiftPower 411 lines involves unit snap-back, teleportation, and timeline manipulation | Explicitly scoped out of Chapter 13; Ch19 must budget extra time for Chronoshift complexity |

### Performance Targets

| System | Target | Measurement |
|--------|--------|-------------|
| SupportPowerManager.Tick() (all powers) | <0.1ms | Per-tick timer advance loop |
| Beacon creation + canvas draw | <0.5ms | Billboard mesh + canvas 2D context arc draw |
| Airstrike formation creation (SquadSize=5) | <2ms | Actor creation + Activity queuing |
| NukePower activation (silo launch) | <1ms | NukeLaunch creation + RevealShroudEffect setup |
| Footprint overlay render (5x5 grid) | <1ms | Instanced billboard update |
| SelectDirectionalTarget drag update | <0.2ms | Per-frame arrow angle compute + CSS update |

### Deferred Features

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| ChronoshiftPower (time-based unit teleport with snap-back) | C&C-specific; complex 411-line implementation involving timeline tracking and position restoration | TODO-19.DEFERRED.1 (Chapter 19) |
| AttackOrderPower (attack order via support power UI) | C&C-specific; uses AttackOrderPower for AI scripting control | TODO-19.DEFERRED.2 (Chapter 19) |
| DropPodsPower (drop pod delivery system) | C&C-specific; spawns pod actors that crash-land with infantry | TODO-19.DEFERRED.3 (Chapter 19) |
| GpsPower (GPS satellite full-map reveal) | C&C-specific; grants permanent full-map vision via GpsWatcher trait | TODO-19.DEFERRED.4 (Chapter 19) |
| GrantPrerequisiteChargeDrainPower (prerequisite-linked charge drain) | C&C-specific; drains power charge when prerequisite lost | TODO-19.DEFERRED.5 (Chapter 19) |
| IonCannonPower (ion cannon orbital strike) | C&C-specific; beam weapon with sustained damage over time | TODO-19.DEFERRED.6 (Chapter 19) |
| Support power palette UI (SupportPowerBinWidget) | UI rendering with icons, timers, and ready indicators; deferred to Chapter 16 | TODO-16.DEFERRED.1 (Chapter 16) |
| Radar ping visualization (RadarWidget integration) | Radar ping rendering on minimap; deferred to Chapter 16 | TODO-16.DEFERRED.2 (Chapter 16) |
| FluentProvider localization (Name/Description lookups) | Full localization system deferred; use fallback string for MVP | TODO-13.DEFERRED.1 |
| Camera actor follow logic (camera lock during power execution) | Requires camera controller integration; deferred to Chapter 16 UI | TODO-13.DEFERRED.2 |

---

## 8. Appendix: Architecture Decisions Record (ADR)

### ADR-13.1: SupportPowerManager on Player Actor

- **Decision**: `SupportPowerManager` is attached exclusively to the `Player` actor (SystemActors.Player), matching OpenRA's `TraitLocation(SystemActors.Player)`. Each player has exactly one manager.
- **Rationale**: Centralizing power management on the `Player` actor ensures a single source of truth for power state, makes TechTree integration straightforward (Player already has TechTree), and aligns with OpenRA's architecture. Power discovery via `World.ActorAdded`/`ActorRemoved` subscriptions avoids poll- or scan-based approaches.
- **Mitigation**: `SupportPowerChargeBar` caches a reference to the manager and updates it via `INotifyOwnerChanged`. Other traits access the manager via `self.Owner.PlayerActor.getComponent(SupportPowerManager)`.

### ADR-13.2: Sub-Tick Precision Timer as Integer Accumulator

- **Decision**: The charge timer uses an integer `remainingSubTicks` (initialized to `TotalTicks * 100`) that decrements by 100 per tick. `RemainingTicks` returns `Math.floor(remainingSubTicks / 100)`. No floating-point arithmetic.
- **Rationale**: C# uses `remainingSubTicks / 100` (integer division). Floating-point accumulation in TypeScript would introduce rounding errors that diverge from C# over long charge cycles. Using an integer accumulator with the same decrement pattern guarantees deterministic behavior for network sync.
- **Mitigation**: `RemainingTicks` is the integer division result for UI display. `remainingSubTicks` is the internal accumulator. `DevMode.FastCharge` clamps to 2500 sub-ticks (25 ticks).

### ADR-13.3: OrderGenerator Reuse (Not Subclassing)

- **Decision**: Power targeting reuses the existing `OrderGenerator` infrastructure from Ch5 Phase E (`WorldInteractionControllerWidget`). Instead of per-power `IOrderGenerator` subclasses, each power provides a `targetingConfig` object with `validationFn`, `cursorFn`, and optional `renderFn` callbacks. The generic OrderGenerator dispatches to these callbacks.
- **Rationale**: OpenRA creates separate `SelectGenericPowerTarget`, `SelectNukePowerTarget`, `SelectSpawnActorPowerTarget`, and `SelectConditionTarget` classes. In TypeScript, a single configurable OrderGenerator with callback functions reduces code duplication (all share the same mouse handling, cancel-on-unavailable, and cursor rendering). The directional targeting (`SelectDirectionalTarget`) is the only genuinely different UX flow and keeps its own OrderGenerator.
- **Mitigation**: `SelectDirectionalTarget` remains a separate OrderGenerator due to its drag-to-aim interaction model. Nuke's range circles are rendered via the `renderAnnotationsFn` callback. Footprint overlay is rendered via the `renderFn` callback.

### ADR-13.4: Beacon as World-Space Billboard

- **Decision**: The `Beacon` effect (clock animation, arrow, circle, poster) renders as a Babylon.js `Plane` mesh with `GUI.AdvancedDynamicTexture` billboarding toward the camera. The clock animation is drawn on a `2dContext` canvas and uploaded as a dynamic texture each frame.
- **Rationale**: OpenRA's Beacon is a 2D sprite composition rendered at screen-space coordinates with a clock sweep overlay. In 3D, a world-space billboard with a canvas-drawn clock provides the same visual effect positioned correctly in 3D space. The canvas `2dContext.arc()` API efficiently renders the clock sweep. Billboard ensures the beacon faces the camera regardless of view angle.
- **Mitigation**: Canvas texture is 256x256 (sufficient for clock detail). Draw calls are batched: only update canvas when `fractionComplete` changes by >1%. Billboard `Plane` is positioned at `targetPosition + heightOffset` via `CoordinateTransformer.wPosToVector3()`.

### ADR-13.5: C&C-Specific Powers Deferred to Chapter 19

- **Decision**: All C&C-specific support powers (`ChronoshiftPower`, `AttackOrderPower`, `DropPodsPower`, `GpsPower`, `GrantPrerequisiteChargeDrainPower`, `IonCannonPower`) are deferred to Chapter 19 (Mod-Specific Content). Chapter 13 implements only Common-mod powers.
- **Rationale**: The C&C powers are faction-specific and involve mechanics unique to the Tiberian universe (time manipulation, ion cannon beam, GPS satellite). They also have higher complexity than Common powers (`ChronoshiftPower` is 411 lines, the largest support power in the game). Deferring keeps Chapter 13 focused and manageable. The Common-mod powers (Airstrike, Nuke, Paratroopers, production, spawn, condition grant) cover the core support power system architecture and can be tested independently.
- **Mitigation**: The `SupportPower` base class and `SupportPowerManager` are designed to accommodate any power type via the `CreateInstance()` / `Activate()` virtual methods. C&C powers will extend these same base classes in Chapter 19.

### ADR-13.6: INotifySupportPower Interface in TraitsInterfaces

- **Decision**: `INotifySupportPower` is added to `src/OpenRA.Game/Traits/TraitsInterfaces.ts` in the Game Logic section (Category 3), alongside other notification interfaces. It defines `charged(self)` and `activated(self)` methods.
- **Rationale**: This matches the C# location (`OpenRA.Mods.Common/TraitsInterfaces.cs`) and the existing pattern for notification interfaces (INotifyCreated, INotifyKilled, INotifyDamage, etc.). It enables the observer pattern where `SupportPower.Charged()`/`SupportPower.Activated()` notify all traits implementing the interface on the same actor.
- **Mitigation**: `Cloak` (Ch12) already implements `INotifySupportPower` stubs (`Charged` no-ops, `Activated` triggers uncloak). The interface must be added before or alongside `SupportPower.ts` migration. Existing traits with stubs (Cloak) are updated to reference the new interface.

### ADR-13.7: Aircraft Formation Path via Ch9 Fly Activity

- **Decision**: Airstrike and Paratroopers aircraft formation flight uses the existing Ch9 `Fly` activity and `Aircraft` trait. Approach and departure paths are computed as straight-line trajectories from map edge to target and target to opposite map edge, offset per aircraft by `SquadOffset` rotated by the approach facing.
- **Rationale**: OpenRA computes the same straight-line edge-to-edge paths using `Map.DistanceToEdge()` and WVec math. Reusing Ch9's `Fly` activity avoids reimplementing aircraft movement. The `Fly` activity already handles altitude, facing, and world-removal at map edge.
- **Mitigation**: Aircraft are created at the start edge offset and queued with `Fly` activities. `AttackBomber.SetTarget()` configures the bomb drop when in range. `ParaDrop.SetLZ()` configures the infantry drop zone. `OnEnteredRange` / `OnExitedRange` / `OnRemovedFromWorld` callbacks handle camera/beacon lifecycle.

---

## Migration Order and Phasing Strategy

| Week | Track | Files | Description | Dependencies |
|:---:|:---|:---:|:---|:---|
| 1 | Core | 2 + 1 | SupportPower.ts + INotifySupportPower + SupportPowerManager.ts | Ch3 Actor + Ch12 Shroud + Ch7 Sound + Ch6 TechTree |
| 1-2 | Directional | 2 | DirectionalSupportPower.ts + SelectDirectionalTarget.ts | Core + Ch5 OrderGenerator + Ch7 InputHandler |
| 2 | Airstrike | 1 | AirstrikePower.ts | Directional + Ch9 Aircraft/Fly/AttackBomber |
| 2 | Paratroopers | 1 | ParatroopersPower.ts | Directional + Ch9 Aircraft/Fly/Cargo/ParaDrop |
| 2-3 | Nuke | 1 | NukePower.ts | Core + Ch8 NukeLaunch + Ch12 Shroud/RevealShroudEffect |
| 3 | Spawn | 1 | SpawnActorPower.ts | Core + Ch7 SpriteEffect + Ch12 Shroud |
| 3 | Production | 1 | ProduceActorPower.ts | Core + Ch11 Production/ProductionQueue |
| 3 | Condition | 1 | GrantExternalConditionPower.ts | Core + Ch3 ConditionManager |
| 3 | Visual | 4 | SupportPowerChargeBar.ts + WithSupportPowerActivationAnimation.ts + WithSupportPowerActivationOverlay.ts + SupportPowerCrateAction.ts | Core + Ch2 Animation + Ch7 RenderSprites |

**Total estimated effort**: ~3-4 weeks (single developer) or ~1.5-2 weeks (3 developers with parallel tracks: Core + Directional on Track 1, Nuke + Airstrike + Para on Track 2, Spawn + Production + Condition on Track 3).

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits) -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.6 -- Chapter 13 skeleton and initial complexity estimates
> - `docs/chapter12_shroud_fog_of_war_migration_plan.md` -- Format and structure reference (primary template)
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Format and structure reference (secondary template)
> - `docs/migration_progress.md` -- Overall progress tracking
> - `CLAUDE.md` -- Project conventions and directory layout
