# OpenRA to Babylon.js Migration Plan: Chapter 8 -- Weapons & Combat System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.5 (WeaponInfo/Combat) + Section 4.3 (Traits)
> **Chapter Status**: IN PROGRESS (25/56 migrated, Phases A+B+C COMPLETE)
> **Planning Date**: 2026-06-12
> **Prerequisite**: Chapters 2-7 COMPLETE (162/162, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Warheads Foundation](#31-phase-a-warheads-foundation)
   - 3.2 [Phase B: Projectiles System](#32-phase-b-projectiles-system)
   - 3.3 [Phase C: Weapon Configuration Data](#33-phase-c-weapon-configuration-data)
   - 3.4 [Phase D: Core Combat Traits](#34-phase-d-core-combat-traits)
   - 3.5 [Phase E: Combat Support Traits](#35-phase-e-combat-support-traits)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Weapons and Combat system is the **first gameplay logic phase** of the project. All previous chapters (2-7) established the rendering, actor, map, UI, network, and input infrastructure. Chapter 8 implements the actual RTS combat loop -- weapons fire, projectiles travel to targets, warheads apply damage and effects, and combat traits control who can attack what under what conditions.

The core paradigm shift: **from 2D grid-based combat mechanics to 3D spatial combat with raycast-based collision detection**:

- **Warhead effects** resolve in deferred frame-end execution to prevent mid-tick state mutation, matching OpenRA's `world.frameEndActions` pattern
- **Projectile collision** shifts from 2D cell-grid checks to `scene.pickWithRay()` raycast from previous-to-current frame position, with AABB pre-filtering
- **AttackBase facing** shifts from 2D angle tolerance checks (WAngle) to 3D vector dot products on the XZ plane
- **HitShape collision** shifts from 2D polygon intersection to `BoundingBox` / `BoundingSphere` 3D intersection tests
- **Weapon configuration** consumed as JSON at runtime (MiniYAML preprocessed at build time via Chapter 4 Phase H)

### 1.2 Architecture Principles

1. **Deferred warhead resolution**: All warhead effects are queued during `DoImpact()` and applied during `world.frameEndActions`. This ensures deterministic state across network clients and prevents mid-tick mutation cascades.

2. **Pooled projectile objects**: Projectiles are created and destroyed frequently (every bullet, missile, beam). Object pooling with pre-allocated Babylon.js resources (meshes, particle systems) eliminates per-frame allocation during heavy combat.

3. **Trait-as-Component pattern**: Combat traits (Armament, AttackBase, AutoTarget, Armor, HitShape) are TypeScript classes implementing standardized interfaces (`ITick`, `INotifyCreated`, `IRender`). They attach to `GameActor` via the existing `TraitDictionary` from Chapter 3.

4. **JSON rule data over MiniYAML**: All weapon, warhead, and combat configuration consumed as JSON at runtime. The Ch4 Phase H MiniYAML-to-JSON pipeline handles all YAML preprocessing.

5. **2D distance preservation in 3D**: Combat range checks, spread damage radius, and weapon range circles all operate on the XZ plane (Y=0 in Babylon.js world space). The CoordinateTransformer (Ch4 Phase I) converts WDist units to world-space distances.

6. **AttackBase variant layering**: AttackBase is the abstract foundation. AttackTurreted, AttackFrontal, AttackOmni, AttackFollow, AttackCharges, and AttackGarrisoned add specific targeting and firing constraints. Each variant extends the base with minimal override surface area.

7. **Multiplier trait composition**: RangeMultiplier, FirepowerMultiplier, ReloadDelayMultiplier, InaccuracyMultiplier, and DamageMultiplier are lightweight traits that modify base combat stats without the target trait knowing they exist. This preserves OpenRA's dependency inversion pattern.

8. **Rendering split from logic**: Combat logic (damage calculation, target acquisition, firing decisions) is separated from visual effects (muzzle flashes, attack animations, explosion particles). Logic runs deterministically each tick; visuals update via `scene.onBeforeRenderObservable` at variable framerate.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-7 is available for Chapter 8:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, sprite rendering pipeline |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IRender` |
| Activity base class | Ch3 Phase F | `Activity` abstract class + `ActivityRunner` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA* pathfinder, `TerrainMeshBuilder` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Viewport`, `SelectionUtils` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` (explosion sounds, weapon sounds) |
| Effects + Projectile base | Ch7 Phases E-F | `SpriteEffect`, `FloatingSpriteEmitter`, `Bullet` (reference projectile) |
| RenderSprites | Ch7 Phase G | `RenderSprites`, `AnimationWithOffset` (sprite-based rendering) |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (56 files across 5 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Warheads Foundation** | | | | | |
| 1 | `OpenRA.Mods.Common/Warheads/Warhead.cs` | `src/OpenRA.Mods.Common/Warheads/Warhead.ts` | `Warhead` | 98 | LOW | A |
| 2 | `OpenRA.Mods.Common/Warheads/DamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/DamageWarhead.ts` | `DamageWarhead` | 94 | MEDIUM | A |
| 3 | `OpenRA.Mods.Common/Warheads/SpreadDamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/SpreadDamageWarhead.ts` | `SpreadDamageWarhead` | 143 | HIGH | A |
| 4 | `OpenRA.Mods.Common/Warheads/TargetDamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/TargetDamageWarhead.ts` | `TargetDamageWarhead` | 67 | LOW | A |
| 5 | `OpenRA.Mods.Common/Warheads/CreateEffectWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/CreateEffectWarhead.ts` | `CreateEffectWarhead` | 149 | MEDIUM | A |
| 6 | `OpenRA.Mods.Common/Warheads/FireClusterWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/FireClusterWarhead.ts` | `FireClusterWarhead` | 118 | MEDIUM | A |
| 7 | `OpenRA.Mods.Common/Warheads/LeaveSmudgeWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/LeaveSmudgeWarhead.ts` | `LeaveSmudgeWarhead` | 75 | LOW | A |
| 8 | `OpenRA.Mods.Common/Warheads/DestroyResourceWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/DestroyResourceWarhead.ts` | `DestroyResourceWarhead` | 66 | LOW | A |
| 9 | `OpenRA.Mods.Common/Warheads/CreateResourceWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/CreateResourceWarhead.ts` | `CreateResourceWarhead` | 59 | LOW | A |
| 10 | `OpenRA.Mods.Common/Warheads/ChangeOwnerWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/ChangeOwnerWarhead.ts` | `ChangeOwnerWarhead` | 57 | LOW | A |
| 11 | `OpenRA.Mods.Common/Warheads/GrantExternalConditionWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/GrantExternalConditionWarhead.ts` | `GrantExternalConditionWarhead` | 52 | LOW | A |
| 12 | `OpenRA.Mods.Common/Warheads/FlashEffectWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/FlashEffectWarhead.ts` | `FlashEffectWarhead` | 35 | LOW | A |
| 13 | `OpenRA.Mods.Common/Warheads/ShakeScreenWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/ShakeScreenWarhead.ts` | `ShakeScreenWarhead` | 34 | LOW | A |
| 14 | `OpenRA.Mods.Common/Warheads/HealthPercentageDamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/HealthPercentageDamageWarhead.ts` | `HealthPercentageDamageWarhead` | 28 | LOW | A |
| 15 | `OpenRA.Mods.Common/Warheads/FlashTargetsInRadiusWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/FlashTargetsInRadiusWarhead.ts` | `FlashTargetsInRadiusWarhead` | 60 | LOW | A |

| **Phase B: Projectiles System** | | | | | |
| 16 | `OpenRA.Mods.Common/Projectiles/Missile.cs` | `src/OpenRA.Mods.Common/Projectiles/Missile.ts` | `Missile` | 980 | HIGH | B |
| 17 | `OpenRA.Mods.Common/Projectiles/AreaBeam.cs` | `src/OpenRA.Mods.Common/Projectiles/AreaBeam.ts` | `AreaBeam` | 297 | MEDIUM | B |
| 18 | `OpenRA.Mods.Common/Projectiles/Railgun.cs` | `src/OpenRA.Mods.Common/Projectiles/Railgun.ts` | `Railgun` | 257 | MEDIUM | B |
| 19 | `OpenRA.Mods.Common/Projectiles/LaserZap.cs` | `src/OpenRA.Mods.Common/Projectiles/LaserZap.ts` | `LaserZap` | 217 | MEDIUM | B |
| 20 | `OpenRA.Mods.Common/Projectiles/NukeLaunch.cs` | `src/OpenRA.Mods.Common/Projectiles/NukeLaunch.ts` | `NukeLaunch` | 173 | MEDIUM | B |
| 21 | `OpenRA.Mods.Common/Projectiles/GravityBomb.cs` | `src/OpenRA.Mods.Common/Projectiles/GravityBomb.ts` | `GravityBomb` | 146 | LOW | B |
| 22 | `OpenRA.Mods.Common/Projectiles/InstantHit.cs` | `src/OpenRA.Mods.Common/Projectiles/InstantHit.ts` | `InstantHit` | 96 | LOW | B |

| **Phase C: Weapon Configuration Data** | | | | | |
| 23 | `OpenRA.Game/GameRules/WeaponInfo.cs` | `src/OpenRA.Game/GameRules/WeaponInfo.ts` | `WeaponInfo` | 268 | MEDIUM | C ✅ COMPLETE |
| 24 | `OpenRA.Game/GameRules/SoundInfo.cs` | `src/OpenRA.Game/GameRules/SoundInfo.ts` | `SoundInfo` | 97 | LOW | C ✅ COMPLETE |
| 25 | `OpenRA.Game/GameRules/MusicInfo.cs` | `src/OpenRA.Game/GameRules/MusicInfo.ts` | `MusicInfo` | 65 | LOW | C ✅ COMPLETE (optional) |

| **Phase D: Core Combat Traits** | | | | | |
| 26 | `OpenRA.Mods.Common/Traits/Armament.cs` | `src/OpenRA.Mods.Common/Traits/Armament.ts` | `Armament` | 432 | HIGH | D |
| 27 | `OpenRA.Mods.Common/Traits/AutoTarget.cs` | `src/OpenRA.Mods.Common/Traits/AutoTarget.ts` | `AutoTarget` | 485 | HIGH | D |
| 28 | `OpenRA.Mods.Common/Traits/Attack/AttackBase.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackBase.ts` | `AttackBase` | 526 | HIGH | D |
| 29 | `OpenRA.Mods.Common/Traits/Attack/AttackTurreted.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackTurreted.ts` | `AttackTurreted` | 51 | LOW | D |
| 30 | `OpenRA.Mods.Common/Traits/Attack/AttackFrontal.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackFrontal.ts` | `AttackFrontal` | 48 | LOW | D |
| 31 | `OpenRA.Mods.Common/Traits/Attack/AttackOmni.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackOmni.ts` | `AttackOmni` | 92 | LOW | D |
| 32 | `OpenRA.Mods.Common/Traits/AttackMove.cs` | `src/OpenRA.Mods.Common/Traits/AttackMove.ts` | `AttackMove` | 179 | MEDIUM | D |
| 33 | `OpenRA.Mods.Common/Traits/Attack/AttackFollow.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackFollow.ts` | `AttackFollow` | 466 | HIGH | D |
| 34 | `OpenRA.Mods.Common/Traits/Attack/AttackCharges.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackCharges.ts` | `AttackCharges` | 77 | LOW | D |
| 35 | `OpenRA.Mods.Common/Traits/AttackWander.cs` | `src/OpenRA.Mods.Common/Traits/AttackWander.ts` | `AttackWander` | 39 | LOW | D |
| 36 | `OpenRA.Mods.Common/Traits/Attack/AttackGarrisoned.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackGarrisoned.ts` | `AttackGarrisoned` | 235 | MEDIUM | D |
| 37 | `OpenRA.Mods.Common/Traits/HitShape.cs` | `src/OpenRA.Mods.Common/Traits/HitShape.ts` | `HitShape` | 177 | MEDIUM | D |
| 38 | `OpenRA.Mods.Common/Traits/Armor.cs` | `src/OpenRA.Mods.Common/Traits/Armor.ts` | `Armor` | 30 | LOW | D |
| 39 | `OpenRA.Mods.Common/Traits/AmmoPool.cs` | `src/OpenRA.Mods.Common/Traits/AmmoPool.ts` | `AmmoPool` | 119 | LOW | D |
| 40 | `OpenRA.Mods.Common/Traits/ReloadAmmoPool.cs` | `src/OpenRA.Mods.Common/Traits/ReloadAmmoPool.ts` | `ReloadAmmoPool` | 95 | LOW | D |
| 41 | `OpenRA.Mods.Common/Traits/Multipliers/RangeMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/RangeMultiplier.ts` | `RangeMultiplier` | 33 | LOW | D |
| 42 | `OpenRA.Mods.Common/Traits/Multipliers/FirepowerMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/FirepowerMultiplier.ts` | `FirepowerMultiplier` | 31 | LOW | D |

| **Phase E: Combat Support Traits** | | | | | |
| 43 | `OpenRA.Mods.Common/Traits/FireWarheads.cs` | `src/OpenRA.Mods.Common/Traits/FireWarheads.ts` | `FireWarheads` | 86 | LOW | E |
| 44 | `OpenRA.Mods.Common/Traits/FireWarheadsOnDeath.cs` | `src/OpenRA.Mods.Common/Traits/FireWarheadsOnDeath.ts` | `FireWarheadsOnDeath` | 190 | MEDIUM | E |
| 45 | `OpenRA.Mods.Common/Traits/FireProjectilesOnDeath.cs` | `src/OpenRA.Mods.Common/Traits/FireProjectilesOnDeath.ts` | `FireProjectilesOnDeath` | 124 | LOW | E |
| 46 | `OpenRA.Mods.Common/Traits/Sound/AttackSounds.cs` | `src/OpenRA.Mods.Common/Traits/Sound/AttackSounds.ts` | `AttackSounds` | 80 | LOW | E |
| 47 | `OpenRA.Mods.Common/Traits/Sound/DeathSounds.cs` | `src/OpenRA.Mods.Common/Traits/Sound/DeathSounds.ts` | `DeathSounds` | 48 | LOW | E |
| 48 | `OpenRA.Mods.Common/Traits/Multipliers/DamageMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/DamageMultiplier.ts` | `DamageMultiplier` | 37 | LOW | E |
| 49 | `OpenRA.Mods.Common/Traits/Multipliers/ReloadDelayMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/ReloadDelayMultiplier.ts` | `ReloadDelayMultiplier` | 31 | LOW | E |
| 50 | `OpenRA.Mods.Common/Traits/Multipliers/InaccuracyMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/InaccuracyMultiplier.ts` | `InaccuracyMultiplier` | 31 | LOW | E |
| 51 | `OpenRA.Mods.Common/Traits/ExplosionOnDamageTransition.cs` | `src/OpenRA.Mods.Common/Traits/ExplosionOnDamageTransition.ts` | `ExplosionOnDamageTransition` | 78 | LOW | E |
| 52 | `OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.ts` | `WithMuzzleOverlay` | 118 | LOW | E |
| 53 | `OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.ts` | `WithAttackAnimation` | 96 | LOW | E |
| 54 | `OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.ts` | `WithAttackOverlay` | 107 | LOW | E |
| 55 | `OpenRA.Mods.Common/Traits/Turreted.cs` | `src/OpenRA.Mods.Common/Traits/Turreted.ts` | `Turreted` | 333 | MEDIUM | E |
| 56 | `OpenRA.Mods.Common/Traits/Air/AttackBomber.cs` | `src/OpenRA.Mods.Common/Traits/Air/AttackBomber.ts` | `AttackBomber` | 95 | LOW | E |
| 57 | `OpenRA.Mods.Common/Traits/Air/AttackAircraft.cs` | `src/OpenRA.Mods.Common/Traits/Air/AttackAircraft.ts` | `AttackAircraft` | 69 | LOW | E |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies beyond Phase A/B. 28-150 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple trait interactions or rendering integration. 94-300 lines of C# with Babylon.js visual components.
> - **HIGH**: Complex gameplay logic with state machines, spatial queries, or physics simulation. 143-980 lines of C# with significant Babylon.js integration.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 57 (56 core + 1 optional MusicInfo) |
| **Phase A (Warheads)** | 15 files |
| **Phase B (Projectiles)** | 7 files (Bullet already in Ch7 Phase F) |
| **Phase C (Weapon Config)** | 2 core + 1 optional files |
| **Phase D (Core Combat Traits)** | 17 files |
| **Phase E (Support Traits)** | 15 files |
| **HIGH complexity** | 8 files (SpreadDamageWarhead, Missile, Armament, AutoTarget, AttackBase, AttackFollow, WeaponInfo, Turreted) |
| **MEDIUM complexity** | 9 files |
| **LOW complexity** | 40 files |
| **Total OpenRA C# source lines** | ~8,329 (with MusicInfo) / ~8,264 (without) |

| Phase | Files | C# Lines | Description |
|:---|:---:|:---:|:---|
| A: Warheads | 15 | 1,135 | Impact-effect classes |
| B: Projectiles | 7 | 2,166 | In-flight munition objects (Bullet already in Ch7) |
| C: Weapon Config | 2 (+1 opt) COMPLETE | 365 (+65) | WeaponInfo, SoundInfo, MusicInfo |
| D: Core Combat Traits | 17 | 3,075 | Armament, Attack*, AutoTarget, HitShape, Armor, etc. |
| E: Support Traits | 15 | 1,523 | FireWarheads, Render overlays, Turreted, Multipliers, etc. |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Warheads Foundation

**Status**: ✅ 已完成 (15/15 migrated, 143 tests)
**Complexity**: Low-Medium (base class LOW, spread damage HIGH)
**Review**: APPROVED (2 review rounds). Commits `d9f6c34` (initial), `9b25839` (Round 2 fixes)
**Blocked by**: Chapter 3 (World, Actor, TraitDictionary, ITick) -- COMPLETE
**Blocks**: Phase B (Projectiles trigger warheads on impact), Phase C (WeaponInfo references warhead types), Phase D (Armament selects warhead)

**Description**: Warheads are the impact-effect classes that apply damage and status effects when a projectile reaches its target. `Warhead` is the abstract base defining the `DoImpact()` interface. `DamageWarhead` provides the damage calculation framework (damage types, versus armor multipliers). `SpreadDamageWarhead` is the most complex warhead -- it applies area-of-effect damage with distance-based falloff. Other warheads apply resource destruction, owner changes, screen effects, and condition grants. In TypeScript, warhead effects are collected as `WarheadEffect[]` arrays and applied in `world.frameEndActions` to prevent mid-tick state mutation.

**Paradigm Shifts**:
- C# `Warhead.DoImpact(target, firedBy)` synchronous -> `doImpact()` returning `WarheadEffect[]` for deferred application
- C# `float` spread distance calculations -> `WDist` unit calculations in XZ plane via CoordinateTransformer
- C# `WorldUtils.FindActorsInCircle()` -> `scene.getMeshesByTags()` spatial query or AABB distance filter
- C# `ExternalCondition` token system -> existing Ch3 `ConditionManager` with reference-counted condition tokens
- C# reflection-based warhead instantiation -> TypeScript warhead registry with factory functions

#### 3.1.1 Warhead (Base Class)

- [x] **TODO-8.A.1** `src/OpenRA.Mods.Common/Warheads/Warhead.ts` (98 lines C#) -- Abstract base class for all warhead effects:
  - Abstract base implementing `IWarhead` interface with `impact()` method
  - `getEffectiveDamage()` virtual method for damage calculation override
  - `getDamageModifiers()` virtual method for per-target damage type modifiers
  - `isAirburst: boolean` check for airburst weapons (vs ground impact)
  - Warhead rule parsing from JSON config (validTargets, invalidTargets, delay, etc.)
  - Target validation: `isValidAgainst(target: Target): boolean` respecting `validTargets` / `invalidTargets` filters

#### 3.1.2 DamageWarhead

- [x] **TODO-8.A.2** `src/OpenRA.Mods.Common/Warheads/DamageWarhead.ts` (94 lines C#) -- Damage calculation framework:
  - Extends `Warhead` with `damage` property (integer damage amount)
  - `damageTypes: Set<string>` -- damage type classification (e.g., "Bullet", "Explosion", "Fire")
  - `versus: Map<string, number>` -- damage multiplier vs each armor type
  - `getEffectiveDamage(target, firedBy)` -- computes final damage after armor modifiers
  - `getDamageVersus(target)` -- looks up damage multiplier for target's Armor trait
  - Integration with Chapter 3 `Armor` trait pattern for damage reduction

#### 3.1.3 SpreadDamageWarhead

- [x] **TODO-8.A.3** `src/OpenRA.Mods.Common/Warheads/SpreadDamageWarhead.ts` (143 lines C#) -- Area-of-effect damage warhead:
  - Extends `DamageWarhead` with `spread: WDist` property (blast radius)
  - `falloff: number[]` array controlling damage reduction with distance (100%, 50%, 25%, 0%)
  - `range: WDist[]` thresholds corresponding to each falloff level
  - `doImpact(target, firedBy)` -- queries actors within spread radius, applies distance-based damage
  - Distance calculation using CoordinateTransformer to WDist units on XZ plane
  - `preventSelfDamage: boolean` check -- skip firedBy from damage list
  - Damage falloff: for each target in spread, compute distance ratio, select damage fraction from falloff array
  - **Precision requirement**: damage at boundary of spread radius must match C# within 1 su (sub-unit)

#### 3.1.4 TargetDamageWarhead

- [x] **TODO-8.A.4** `src/OpenRA.Mods.Common/Warheads/TargetDamageWarhead.ts` (67 lines C#) -- Single-target damage warhead:
  - Extends `DamageWarhead` -- applies damage to exactly one target (no spread)
  - `doImpact(target, firedBy)` -- direct damage to target actor's Health trait
  - No spatial query needed (simpler than SpreadDamageWarhead)
  - Used for precision weapons (sniper rifles, railguns)

#### 3.1.5 CreateEffectWarhead

- [x] **TODO-8.A.5** `src/OpenRA.Mods.Common/Warheads/CreateEffectWarhead.ts` (149 lines C#) -- Spawns visual effect on impact:
  - Spawns explosion animation/sprite effect at impact position
  - `explosion: string` -- sequence name for explosion sprite
  - `impactSound: string` -- sound to play on impact
  - `impactSoundVolume: number` -- volume control
  - `waterImpactSound: string` -- alternate sound for water terrain hits
  - Integration with Ch7 Phase E `SpriteEffect` and Ch7 Phase D `Sound`
  - 3D position from CoordinateTransformer.cellToVector3() for effect placement
  - Billboard sprite positioning facing camera

#### 3.1.6 FireClusterWarhead

- [x] **TODO-8.A.6** `src/OpenRA.Mods.Common/Warheads/FireClusterWarhead.ts` (118 lines C#) -- Multipoint cluster damage:
  - Extends `DamageWarhead` with `projectileCount: number` (sub-explosion count)
  - `randomMultiplier: number` -- random offset distance for sub-explosions
  - `doImpact(target, firedBy)` -- spawns N sub-damage instances at random positions around impact point
  - Random offset within spread radius using uniform distribution
  - Reuses existing warhead definitions for sub-explosions
  - Validates each sub-impact against terrain and target validity

#### 3.1.7 LeaveSmudgeWarhead

- [x] **TODO-8.A.7** `src/OpenRA.Mods.Common/Warheads/LeaveSmudgeWarhead.ts` (75 lines C#) -- Visual terrain scorching:
  - `smudgeType: string[]` -- smudge terrain overlay types to apply
  - `size: CVec` -- smudge footprint dimensions in cells (default 1x1)
  - `doImpact(target, firedBy)` -- marks cells within footprint with smudge terrain type
  - Each smudge type creates visual scorch mark on terrain via terrain splatmap update
  - Smudge size limited by map boundaries and terrain acceptance rules

#### 3.1.8 DestroyResourceWarhead

- [x] **TODO-8.A.8** `src/OpenRA.Mods.Common/Warheads/DestroyResourceWarhead.ts` (66 lines C#) -- Resource destruction on impact:
  - `size: CVec` -- affected resource area dimensions
  - `doImpact(target, firedBy)` -- reduces/removes resources from cells within footprint
  - Integration with Chapter 10 resource layer (stub interface until Chapter 10 is ready)
  - Percentage-based resource removal (0-100%)

#### 3.1.9 CreateResourceWarhead

- [x] **TODO-8.A.9** `src/OpenRA.Mods.Common/Warheads/CreateResourceWarhead.ts` (59 lines C#) -- Resource creation on impact:
  - `addsResourceType: string` -- resource type to spawn
  - `size: CVec` -- affected resource area dimensions
  - `doImpact(target, firedBy)` -- adds resources to cells within footprint
  - Resource amount per cell configurable
  - Integration with Chapter 10 resource layer (stub interface)

#### 3.1.10 ChangeOwnerWarhead

- [x] **TODO-8.A.10** `src/OpenRA.Mods.Common/Warheads/ChangeOwnerWarhead.ts` (57 lines C#) -- Ownership transfer on impact:
  - `captureRange: WDist` -- radius for ownership change effect
  - `doImpact(target, firedBy)` -- transfers ownership of actors in range to firing player
  - Valid targets filter (buildings, vehicles, infantry)
  - Does not work on actors with `ImmuneToOwnerChange` condition

#### 3.1.11 GrantExternalConditionWarhead

- [x] **TODO-8.A.11** `src/OpenRA.Mods.Common/Warheads/GrantExternalConditionWarhead.ts` (52 lines C#) -- Condition application on impact:
  - `condition: string` -- condition token to grant
  - `duration: number` -- condition duration in ticks
  - `range: WDist` -- effect radius
  - `doImpact(target, firedBy)` -- grants condition to all valid actors in range
  - Integration with Ch3 `ConditionManager` for reference-counted condition tokens
  - Duration-based auto-expiry via `world.frameEndActions` timer queue

#### 3.1.12 FlashEffectWarhead

- [x] **TODO-8.A.12** `src/OpenRA.Mods.Common/Warheads/FlashEffectWarhead.ts` (35 lines C#) -- Screen flash on impact:
  - `duration: number` -- flash duration in ticks
  - `doImpact(target, firedBy)` -- triggers screen flash effect
  - Camera-based fullscreen color overlay via Babylon.js PostProcess or HTML overlay div
  - Flash color and intensity from warhead config

#### 3.1.13 ShakeScreenWarhead

- [x] **TODO-8.A.13** `src/OpenRA.Mods.Common/Warheads/ShakeScreenWarhead.ts` (34 lines C#) -- Camera shake on impact:
  - `intensity: number` and `duration: number` for camera shake
  - `multiplier: number` -- shake intensity scaling
  - `doImpact(target, firedBy)` -- triggers camera shake via Camera position offset animation
  - Integration with Ch7 Phase B `Viewport`
  - Damped oscillation pattern matching OpenRA's screen shake

#### 3.1.14 HealthPercentageDamageWarhead

- [x] **TODO-8.A.14** `src/OpenRA.Mods.Common/Warheads/HealthPercentageDamageWarhead.ts` (28 lines C#) -- Percentage-based damage:
  - Extends `DamageWarhead` with `spread: WDist` and percentage calculation override
  - `doImpact(target, firedBy)` -- damage = target max health * percentage / 100
  - `getEffectiveDamage()` override to compute percentage-based damage
  - Used for weapons that deal %-based damage (e.g., Tiberium gas)

#### 3.1.15 FlashTargetsInRadiusWarhead

- [x] **TODO-8.A.15** `src/OpenRA.Mods.Common/Warheads/FlashTargetsInRadiusWarhead.ts` (60 lines C#) -- Target flash on impact:
  - `range: WDist` -- radius for target flash effect
  - `duration: number` -- flash duration in ticks
  - `doImpact(target, firedBy)` -- applies temporary flash/white tint to sprites of actors in range
  - Sprite color modulation via Babylon.js material emissive or color property
  - Auto-revert after duration expires

**Phase A Summary**: 15 files, ~1,135 C# lines source. Implemented: 19 files (15 impl + 4 test), 143 tests. Reviewed: APPROVED (2 rounds). Commits: `d9f6c34` (initial), `9b25839` (Round 2 fixes). Round 1: 1 BLOCKER (int2Lerp numerical bug), 7 MAJOR, 6 MINOR → NEEDS FIXES. Round 2: All fixed → APPROVED.

---

### 3.2 Phase B: Projectiles System

**Status**: ✅ COMPLETE (7/7 migrated, 186 tests)
**Review**: APPROVED (2 rounds). Commits `0f02230` (initial), `28b4602` (Round 1 fixes)
**Complexity**: Low-HIGH (InstantHit LOW, Missile HIGH at 980 lines)
**Blocked by**: Phase A (Warheads -- projectiles trigger warheads on impact), Chapter 7 Phase F (Bullet -- reference projectile implementation)
**Blocks**: Phase C (WeaponInfo references projectile types), Phase D (Armament creates projectiles on fire)

**Description**: Projectiles are the in-flight munition objects that travel from source to target and trigger warheads upon reaching their destination. `Bullet` (already migrated in Ch7 Phase F) serves as the reference implementation. This phase covers the remaining 7 projectile types. `Missile` is the most complex at 980 lines -- it tracks moving targets with arcing trajectory and fuel-limited flight. `AreaBeam` and `LaserZap` are instant-beam effects. `Railgun` combines bullet physics with beam rendering. `NukeLaunch` is a special projectile with multi-stage flight and massive AoE. `GravityBomb` is a simple ballistic projectile. `InstantHit` applies warheads without a visible travel projectile.

**Paradigm Shifts**:
- C# `Missile.Tick` angle lerp trajectory -> `Vector3.Lerp` + `Quaternion.Slerp` in 3D space with proper Up-vector gravity
- C# 2D cell-grid collision -> `scene.pickWithRay()` from previous-to-current frame position
- C# beam rendering (2D line segments) -> Babylon.js `LinesMesh` / `CylinderMesh` for laser beams
- C# homing/fuel logic -> TypeScript state machine with `HomingState` enum (SeekingTarget, Cruising, Retargeting)
- C# `WorldUtils.FindActorsInCircle()` -> `scene.getMeshesByTags()` with AABB distance filter

#### 3.2.1 Missile

- [x] **TODO-8.B.1** `src/OpenRA.Mods.Common/Projectiles/Missile.ts` (980 lines C#) -- Homing missile projectile:
  - `HomingState` enum: `SeekingTarget`, `Cruising`, `Retargeting`, `OutOfFuel`
  - Trajectory: initial vertical launch phase, then angle-lerp toward target
  - Homing: `homingSpeed: WAngle` per tick turn rate, `homingAlliance` target filter
  - `fuelDuration: number` -- maximum flight time in ticks
  - `armDistance: WDist` -- arming distance (cannot detonate before this)
  - `horizontalRateOfTurn: WAngle` -- per-tick turn rate cap
  - `verticalRateOfTurn: WAngle` -- vertical angle change cap
  - `contrailLength: number` -- particle trail length behind missile
  - `terrainHeightAware: boolean` -- collision with terrain height
  - `boundsFacingMargin` -- map boundary avoidance
  - `Tick(world)` -- advance position, check collision, update facing
  - `Explode(world)` -- trigger warheads with `targetPosition`
  - 3D rendering: `LinesMesh` contrail + `Mesh` body with Quaternion.Slerp orientation
  - **Precision requirement**: trajectory midpoint at tick=N must match C# within 1 WDist unit

#### 3.2.2 AreaBeam

- [x] **TODO-8.B.2** `src/OpenRA.Mods.Common/Projectiles/AreaBeam.ts` (297 lines C#) -- Area-effect beam projectile:
  - `duration: number` -- beam persistence in ticks
  - `damageInterval: number` -- damage tick interval within beam
  - `width: WDist` -- beam width for visual and damage area
  - `trackTarget: boolean` -- beam follows moving targets
  - `Tick(world)` -- apply damage to all actors within beam width each damageInterval
  - 3D rendering: `CylinderMesh` from source to target with beam glow `ShaderMaterial`
  - Beam fade-in/fade-out animation during duration
  - Head position offset for turreted units

#### 3.2.3 Railgun

- [x] **TODO-8.B.3** `src/OpenRA.Mods.Common/Projectiles/Railgun.ts` (257 lines C#) -- High-velocity projectile with beam trail:
  - Combines bullet physics (fast straight-line travel) with beam visual (trail)
  - `damage: number` -- impact damage
  - `speed: WDist` -- per-tick travel distance
  - `Tick(world)` -- advance bullet position, collision check each tick
  - 3D rendering: instant `LinesMesh` trail from source to current position each frame
  - Trail color and width configurable
  - Impact position triggers warheads

#### 3.2.4 LaserZap

- [x] **TODO-8.B.4** `src/OpenRA.Mods.Common/Projectiles/LaserZap.ts` (217 lines C#) -- Instant laser beam projectile:
  - `duration: number` -- beam visual persistence in ticks
  - `width: WDist` -- laser beam visual thickness
  - `tracksTarget: boolean` -- beam endpoint follows moving target
  - `usePlayerColor: boolean` -- beam tint from firing player's color
  - `Tick(world)` -- apply warheads at impact point (instant), maintain visual for duration
  - 3D rendering: `LinesMesh` with emissive material, optional glow
  - Visual-only after initial impact (damage applied on tick 0)
  - Outline beam color for faction differentiation

#### 3.2.5 NukeLaunch

- [x] **TODO-8.B.5** `src/OpenRA.Mods.Common/Projectiles/NukeLaunch.ts` (173 lines C#) -- Nuclear missile projectile:
  - `missileWeapon: string` -- missile warhead config
  - `detonationAltitude: WDist` -- height at which missile detonates
  - `velocity: WVec` -- upward velocity vector
  - `acceleration: WVec` -- gravity/acceleration vector
  - `Tick(world)` -- multi-stage flight: ascend, peak, descend, detonate
  - Special rendering: ascending trail + detonation flash
  - 3D rendering: vertical-ascent `LinesMesh` trail + `SpriteEffect` detonation at altitude
  - Upward velocity followed by parabolic arc descent

#### 3.2.6 GravityBomb

- [x] **TODO-8.B.6** `src/OpenRA.Mods.Common/Projectiles/GravityBomb.ts` (146 lines C#) -- Ballistic gravity-affected projectile:
  - Simple ballistic trajectory: initial horizontal velocity + gravity acceleration
  - `velocity: WVec` -- initial velocity (horizontal + vertical)
  - `acceleration: WVec` -- gravity vector (typically (0, 0, -g))
  - `Tick(world)` -- advance position via Euler integration, detonate on ground contact
  - Ground collision at height 0 (or terrain height if terrain-aware)
  - 3D rendering: simple `Mesh` with constant downward acceleration

#### 3.2.7 InstantHit

- [x] **TODO-8.B.7** `src/OpenRA.Mods.Common/Projectiles/InstantHit.ts` (96 lines C#) -- Zero-travel-time projectile:
  - Applies warheads immediately at target position on tick 0
  - No visual projectile (effect handled by warhead's CreateEffect)
  - `Tick(world)` -- instant warhead trigger, then self-dispose
  - Used for hitscan weapons (sniper rifles, machine guns)
  - Blocked by `BlockedByActor` check along line-of-sight from source to target
  - 3D line-of-sight check: `Ray` from source position to target, scene pick for blocking actors

**Phase B Summary**: 7 files, ~2,166 C# lines source. Implemented: 17 files (9 source + 8 test), 186 tests, ~4,483 lines. Reviewed: APPROVED (2 rounds). Commits: `0f02230` (initial), `28b4602` (Round 1 fixes). Shared modules: `MissileMath.ts` (23 tests), `ProjectileRegistry.ts`, `BeamRenderableShape.ts`. Test breakdown: Missile (32), AreaBeam (12), Railgun (13), LaserZap (12), NukeLaunch (11), GravityBomb (15), InstantHit (14), MissileMath (23), BeamRenderableShape (shared).

---

### 3.3 Phase C: Weapon Configuration Data

**Status**: ✅ COMPLETE (2/2 + 1 optional migrated, 115 tests)
**Review**: APPROVED (1 round, 0 BLOCKERs). Commit `ab3b3d4` — feat(weapons): Phase C — Weapon Configuration Data (WeaponInfo, SoundInfo, MusicInfo)
**Complexity**: Medium (WeaponInfo parses from JSON rules)
**Blocked by**: Phase A (WeaponInfo references warhead types) -- COMPLETE, Phase B (WeaponInfo references projectile types) -- COMPLETE
**Blocks**: Phase D (Armament loads WeaponInfo for each weapon slot) -- NOW UNBLOCKED, Phase E (support traits reference weapon definitions)

**Description**: Configuration data classes that define weapons, sounds, and music from JSON rule files. `WeaponInfo` is the central config hub -- it specifies the warhead, projectile, burst count, range, reload time, and target validation for each weapon. `SoundInfo` defines attack/death sound configurations. `MusicInfo` (optional) defines background music tracks. These classes are consumed by the Ruleset system (Ch6 Phase C) and loaded from JSON at world creation.

**Paradigm Shifts**:
- C# `WeaponInfo` YAML field deserialization -> JSON object with typed field validation
- C# `[FieldLoader.Load]` attribute reflection -> TypeScript `fromJSON()` factory with manual field extraction
- C# `IProjectileInfo` runtime projectile creation -> TypeScript projectile factory registry lookup
- C# `SoundInfo` audio file references -> Web Audio API buffer loading via Ch7 Phase D `Sound`

#### 3.3.1 WeaponInfo

- [x] **TODO-8.C.1** `src/OpenRA.Game/GameRules/WeaponInfo.ts` (268 lines C#) -- Weapon configuration data:
  - `projectile: string` -- projectile type name (resolved at runtime)
  - `warhead: string` -- primary warhead type name
  - `burst: number` -- shots per firing cycle (default 1)
  - `burstDelay: number` -- ticks between burst shots
  - `range: WDist` -- maximum weapon range
  - `minRange: WDist` -- minimum weapon range (for artillery)
  - `reloadDelay: number` -- ticks between firing cycles
  - `report: string[]` -- sound effects played on fire
  - `validTargets: string[]` -- allowed target types (Ground, Water, Air)
  - `invalidTargets: string[]` -- disallowed target types
  - `targetActorCenter: boolean` -- aim at actor center vs perimeter
  - `projectileArgs: Record<string, any>` -- type-specific projectile config passthrough
  - `warheadArgs: Record<string, any>` -- type-specific warhead config passthrough
  - `fromJSON(json: object): WeaponInfo` static factory
  - Validate projectile and warhead exist in registry
  - Compute `reloadTicks` from reloadDelay accounting for multipliers

#### 3.3.2 SoundInfo

- [x] **TODO-8.C.2** `src/OpenRA.Game/GameRules/SoundInfo.ts` (97 lines C#) -- Sound configuration data:
  - Attack/notification sound definitions for weapons and events
  - `audibleDistance: WDist` -- maximum hearing range
  - Volume and pitch variation ranges
  - Integration with Ch7 Phase D `Sound` for Web Audio API playback
  - Spatial audio positioning via Babylon.js audio engine

#### 3.3.3 MusicInfo (Optional)

- [x] **TODO-8.C.3** `src/OpenRA.Game/GameRules/MusicInfo.ts` (65 lines C#) -- Background music configuration:
  - `filename: string` -- audio file reference
  - `length: number` -- track length in ticks
  - `extension: string` -- audio format
  - `exists: boolean` -- file availability check
  - Integration with Ch7 Phase D `Sound` for music playback with crossfade support

**Phase C Summary**: 2 core + 1 optional files, ~365 (+65 opt) C# lines. Implemented: 11 files total (3 impl + 1 shared + modifications to Warhead.ts, DelayedImpact.ts, Bullet.ts + 4 test files), 115 new tests. Reviewed: APPROVED (1 round, 0 BLOCKERs). Commit: `ab3b3d4`. Shared module: `WarheadRegistry.ts` (warhead factory registry). Test breakdown: WeaponInfo.test.ts (52 tests), SoundInfo.test.ts (45 tests), MusicInfo.test.ts (18 tests).

---

### 3.4 Phase D: Core Combat Traits

**Status**: 📋 待迁移 (0/17 migrated) -- NOW UNBLOCKED (Phases A+B+C COMPLETE)
**Complexity**: Low-HIGH (AttackBase 526 lines HIGH, Armor 30 lines LOW)
**Blocked by**: Phase A (Armament references warhead types) -- COMPLETE, Phase C (Armament references WeaponInfo) -- COMPLETE
**Blocks**: Phase E (support traits react to combat events), Chapter 14 (Attack activities)

**Description**: The actor-side components that enable combat. `Armament` is the weapon mount -- it manages reload state, burst cycling, and firing logic. `AttackBase` is the abstract base for attack behavior, handling target validation, firing arc checks, and `AttackActivity` creation. `AutoTarget` implements autonomous target acquisition with priority and stance systems. `HitShape` defines collision geometry for damage application. `Armor` provides damage reduction via type-based multipliers. Multiplier traits (`RangeMultiplier`, `FirepowerMultiplier`) modify base combat stats. `AmmoPool` and `ReloadAmmoPool` manage limited ammunition.

**Paradigm Shifts**:
- C# `Armament.CheckFire()` grid-based target check -> 3D raycast from weapon hardpoint to target
- C# `AttackBase.FacingTolerance` 2D angle check -> `Vector3.Dot()` on XZ plane for facing comparison
- C# `HitShape` 2D polygon intersection -> `BoundingBox.intersectsPoint()` / `BoundingSphere.intersectsPoint()` 3D collision
- C# `AutoTarget.ScanForTarget` CPU grid scan -> frustum + distance-based target acquisition with spatial index
- C# `AmmoPool` reload timer -> TypeScript tick counter with event-driven reload trigger

#### 3.4.1 Armament

- [ ] **TODO-8.D.1** `src/OpenRA.Mods.Common/Traits/Armament.ts` (432 lines C#) -- Weapon mount trait:
  - `weapon: WeaponInfo` -- weapon configuration reference
  - `reloadDelay: number` -- current reload time (modified by multipliers)
  - `burst: number` -- current burst count (modified by multipliers)
  - `fireDelay: number` -- current burst fire delay
  - `localOffset: WVec` -- weapon hardpoint offset from actor center
  - `muzzleSequence: string` -- muzzle flash sprite sequence
  - `checkFire(actor, facing, target): boolean` -- can fire this tick?
  - `fire(actor, facing, target): Projectile` -- spawn projectile and play report
  - `getReloadTicks(): number` -- compute current reload time accounting for all multipliers
  - `getBurstTicks(): number` -- compute burst delay
  - `targetInRange(actor, target): boolean` -- range check in WDist units via CoordinateTransformer
  - `weaponMinRange: WDist` -- minimum required distance
  - 3D weapon hardpoint position from `localOffset` + actor position + turret facing rotation
  - Cooldown state management: `remainingBurst`, `remainingReloadTicks`

#### 3.4.2 AutoTarget

- [ ] **TODO-8.D.2** `src/OpenRA.Mods.Common/Traits/AutoTarget.ts` (485 lines C#) -- Autonomous target acquisition:
  - `scanRange: WDist` -- maximum search radius for targets
  - `initialStance: UnitStance` (Aggressive, AttackAnything, Defend, HoldFire, ReturnFire)
  - `scanInterval: number` -- ticks between target scans
  - `targetPriority: number` -- priority modifier for target scoring
  - `maximumRange: WDist` -- weapon range override for target selection
  - `scanForTarget(actor, allowMove, allowTurn): boolean` -- core target selection logic
  - Target scoring: closest, weakest, highest threat, anti-air preferred
  - Stance rules: `ReturnFire` only targets attackers, `HoldFire` never auto-attacks
  - `attack(enemy)` -- initiate attack on specific target
  - `targetLineColor: Color` -- target line visual debug color
  - 3D implementation: frustum-based visibility check + distance sort
  - Owner/enemy relationship check via Ch3 Player `RelationshipWith()`

#### 3.4.3 AttackBase

- [ ] **TODO-8.D.3** `src/OpenRA.Mods.Common/Traits/Attack/AttackBase.ts` (526 lines C#) -- Abstract attack behavior:
  - Base class for all attack trait variants
  - `doAttack(world, attackSource, target): Activity` -- creates Attack activity
  - `hasAnyValidWeapons(): boolean` -- checks if any armament can fire
  - `getTargetTypes(): Set<string>` -- target types this attacker can engage (Ground, Water, Air)
  - `facingTolerance: WAngle` -- maximum angle deviation allowed to fire
  - `attackRequiresEnteringCell: boolean` -- must move adjacent to cell before firing
  - `targetLineColor: Color` -- range circle / target line visual debug color
  - `getArmaments(): Armament[]` -- all weapon mounts on this actor
  - `chooseArmamentForTarget(target): Armament` -- select best weapon for target type
  - `canTargetModifier: IConditionalTrait<boolean>` -- dynamic condition-based targeting toggle
  - 3D facing check: `Vector3.Dot(facingVector, targetVector) > cos(facingTolerance * PI / 512)`
  - Range circle rendering: `LinesMesh` circle at weapon range radius on terrain plane

#### 3.4.4 AttackTurreted

- [ ] **TODO-8.D.4** `src/OpenRA.Mods.Common/Traits/Attack/AttackTurreted.ts` (51 lines C#) -- Turret-based attack variant:
  - Extends `AttackBase` -- requires turret to face target before firing
  - `getTargetFacing(actor, target): WAngle` -- compute required turret facing
  - `targetIsFacing(actor, target): boolean` -- check turret rotation matches target bearing
  - Delegates to `Turreted` trait for facing angle and rotation speed
  - 3D: turret `TransformNode.rotation.y` comparison via `Quaternion` angle check

#### 3.4.5 AttackFrontal

- [ ] **TODO-8.D.5** `src/OpenRA.Mods.Common/Traits/Attack/AttackFrontal.ts` (48 lines C#) -- Frontal-only attack variant:
  - Extends `AttackBase` -- entire actor must face target (tank hull rotation)
  - No independent turret -- actor body rotation is the firing arc
  - `targetIsFacing(actor, target): boolean` -- hull facing check
  - Used by tanks without turrets (e.g., Tank Destroyer)

#### 3.4.6 AttackOmni

- [ ] **TODO-8.D.6** `src/OpenRA.Mods.Common/Traits/Attack/AttackOmni.ts` (92 lines C#) -- Omnidirectional attack variant:
  - Extends `AttackBase` -- can fire in any direction without facing requirement
  - No facing constraint -- fires instantly regardless of actor orientation
  - Used by stationary defenses, buildings with weapons
  - `targetIsFacing()` always returns true

#### 3.4.7 AttackMove

- [ ] **TODO-8.D.7** `src/OpenRA.Mods.Common/Traits/AttackMove.ts` (179 lines C#) -- Attack-move behavior trait:
  - `assaultMoveCondition: string` -- condition token for assault-move mode
  - Auto-acquires and attacks targets while moving
  - `scanInterval: number` -- target scan frequency during movement
  - `approachScanRadius: WDist` -- scan range while moving toward destination
  - Integration with movement pathfinding -- attack interrupts movement when target found
  - `getAttackActivity(actor, target, allowMove, forceAttack): Activity` -- attack activity creator

#### 3.4.8 AttackFollow

- [ ] **TODO-8.D.8** `src/OpenRA.Mods.Common/Traits/Attack/AttackFollow.ts` (466 lines C#) -- Persistent pursuit attack:
  - Extends `AttackBase` -- maintains target lock and pursues fleeing targets
  - `followRange: WDist` -- maximum chase range before giving up
  - `targetStance: UnitStance` -- stance override for follow mode
  - `opportunityFire: boolean` -- fire at other targets while following
  - Performs target re-acquisition if original target becomes invalid
  - Pursuit pathfinding integration -- recalculates path as target moves
  - `hasTicked: boolean` guard against duplicate tick processing

#### 3.4.9 AttackCharges

- [ ] **TODO-8.D.9** `src/OpenRA.Mods.Common/Traits/Attack/AttackCharges.ts` (77 lines C#) -- Limited-charge attack variant:
  - Extends `AttackBase` -- limited number of attack uses
  - `chargeCount: number` -- remaining charges
  - `reloadTime: number` -- recharge time for one charge
  - Each attack consumes one charge; actor cannot fire at zero charges
  - Charge recharges over time (similar to AmmoPool but tied to the Attack trait)
  - Used by special abilities and one-shot weapons

#### 3.4.10 AttackWander

- [ ] **TODO-8.D.10** `src/OpenRA.Mods.Common/Traits/AttackWander.ts` (39 lines C#) -- Wander-and-attack behavior:
  - `wanderRadius: WDist` -- random movement radius
  - Periodically moves to random nearby positions, attacking targets encountered
  - Used for patrol-style autonomous behavior
  - Simple state machine: wander -> scan -> attack -> wander

#### 3.4.11 AttackGarrisoned

- [ ] **TODO-8.D.11** `src/OpenRA.Mods.Common/Traits/Attack/AttackGarrisoned.ts` (235 lines C#) -- Garrison-based attack:
  - Extends `AttackBase` -- weapon fires from garrisoned passengers
  - `portOffsets: WVec[]` -- firing port positions on the structure
  - Each passenger adds weapons to the garrisoned building's attack capability
  - `getPortOffsets(actor): WVec[]` -- compute dynamic port positions
  - Passenger count affects firepower and firing rate
  - Building rotates ports toward target direction

#### 3.4.12 HitShape

- [ ] **TODO-8.D.12** `src/OpenRA.Mods.Common/Traits/HitShape.ts` (177 lines C#) -- Collision geometry for damage:
  - `type: HitShapeType` (Circle, Rectangle, Capsule)
  - `topBottomOffsets: (number, number)[]` -- per-facing height offsets
  - `info: HitShapeInfo` -- shape dimensions in WDist units
  - `distanceFromEdge(pos: WPos, shape: HitShape): WDist` -- signed distance to shape boundary
  - `intersects(targetPos: WPos, shape: HitShape): boolean` -- point-in-shape test
  - `intersectsWith(targetShape: HitShape): boolean` -- shape-shape intersection
  - `getBounds(): WDist[]` -- shape bounding box in WDist
  - 3D mapping: Circle -> `BoundingSphere`, Rectangle -> `BoundingBox`
  - CoordinateTransformer converts WDist shape to world-space Babylon.js coordinates
  - Used by SpreadDamageWarhead for damage distance calculation

#### 3.4.13 Armor

- [ ] **TODO-8.D.13** `src/OpenRA.Mods.Common/Traits/Armor.ts` (30 lines C#) -- Damage reduction trait:
  - `type: string` -- armor type identifier (e.g., "Light", "Heavy", "Wood", "Concrete")
  - Warhead `versus` map looks up damage multiplier by armor type
  - Simple trait with no active logic -- provides type label for damage calculation
  - Multiple armor types possible on a single actor

#### 3.4.14 AmmoPool

- [ ] **TODO-8.D.14** `src/OpenRA.Mods.Common/Traits/AmmoPool.ts` (119 lines C#) -- Limited ammunition trait:
  - `name: string` -- pool identifier for armament linkage
  - `ammo: number` -- current ammunition count
  - `maxAmmo: number` -- maximum ammunition capacity
  - `reloadCount: number` -- ammo restored per reload tick
  - `initialAmmo: number` -- starting ammunition
  - `armaments: string[]` -- armament names this pool feeds
  - `takeAmmo(count): void` -- consume ammunition on fire
  - `giveAmmo(count): void` -- restore ammunition
  - `hasAmmo(): boolean` -- ammunition availability check
  - `fullAmmo(): boolean` -- pool at maximum capacity check
  - Integration with Armament: check pool before firing, decrement on fire

#### 3.4.15 ReloadAmmoPool

- [ ] **TODO-8.D.15** `src/OpenRA.Mods.Common/Traits/ReloadAmmoPool.ts` (95 lines C#) -- Ammo reload behavior:
  - `ammoPool: string` -- linked AmmoPool name
  - `reloadDelay: number` -- ticks between reload events
  - `reloadCount: number` -- ammo restored per tick
  - `resetOnFire: boolean` -- reload timer resets when weapon fires
  - `tick(actor)` -- advance reload timer, restore ammo when timer expires
  - Plays reload sound via Ch7 Phase D `Sound` when reload cycle completes

#### 3.4.16 RangeMultiplier

- [ ] **TODO-8.D.16** `src/OpenRA.Mods.Common/Traits/Multipliers/RangeMultiplier.ts` (33 lines C#) -- Weapon range multiplier:
  - `modifier: number` -- range scaling factor (1.0 = normal, 1.5 = +50%)
  - Modifies all armaments' `weaponRange` by multiplicative factor
  - Stackable with other multipliers
  - Applied during `getReloadTicks()` in Armament

#### 3.4.17 FirepowerMultiplier

- [ ] **TODO-8.D.17** `src/OpenRA.Mods.Common/Traits/Multipliers/FirepowerMultiplier.ts` (31 lines C#) -- Weapon damage multiplier:
  - `modifier: number` -- damage scaling factor
  - Modifies all warhead damage by multiplicative factor
  - Applied during `getEffectiveDamage()` in DamageWarhead

**Phase D Summary**: 17 files, ~3,075 C# lines, estimated ~12,000 TS implementation + ~8,500 test lines

---

### 3.5 Phase E: Combat Support Traits

**Status**: 📋 待迁移 (0/15 migrated)
**Complexity**: Low-Medium (Turreted 333 lines MEDIUM, DeathSounds 48 lines LOW)
**Blocked by**: Phase D (Core combat traits -- support traits react to combat events), Chapter 7 Phases D-E (Sound and Effects)
**Blocks**: Chapter 14 (Attack activities), Chapter 19 (mod-specific combat traits)

**Description**: Traits that modify, enhance, or react to combat events. `FireWarheads` and `FireWarheadsOnDeath` trigger warhead effects on specific conditions. `AttackSounds` and `DeathSounds` play audio feedback. `WithMuzzleOverlay`, `WithAttackAnimation`, and `WithAttackOverlay` provide visual combat feedback via sprite overlays. `Turreted` manages turret rotation and facing -- a critical dependency for turret-based attack variants. `AttackBomber` and `AttackAircraft` extend combat to air units. Multiplier traits (`DamageMultiplier`, `ReloadDelayMultiplier`, `InaccuracyMultiplier`) stack with Phase D multipliers.

**Paradigm Shifts**:
- C# `WithMuzzleOverlay` 2D sprite overlay -> Babylon.js Billboard sprite at weapon hardpoint position
- C# `WithAttackAnimation` frame-based sprite sequence -> Babylon.js sprite sheet frame swap on fire event
- C# `Turreted` WAngle rotation -> `TransformNode.rotation.y` continuous quaternion rotation
- C# `AttackSounds` Sound.Play() -> Web Audio API playback via Ch7 Phase D `Sound`

#### 3.5.1 FireWarheads

- [ ] **TODO-8.E.1** `src/OpenRA.Mods.Common/Traits/FireWarheads.ts` (86 lines C#) -- Conditional warhead trigger:
  - `warheads: string[]` -- warhead type names to trigger
  - `condition: string` -- condition that triggers warhead firing
  - `targetSelf: boolean` -- target self vs external targets
  - `fireWarheads(actor, target)` -- spawn and trigger all configured warheads
  - Integration with Ch3 `ConditionManager` for condition-based activation

#### 3.5.2 FireWarheadsOnDeath

- [ ] **TODO-8.E.2** `src/OpenRA.Mods.Common/Traits/FireWarheadsOnDeath.ts` (190 lines C#) -- Death explosion trait:
  - `warhead: string` -- warhead type to trigger on death
  - `weapon: string` -- optional weapon reference (for projectile effects)
  - `emptyWeapon: string` -- alternate weapon when no ammo remains
  - `killed(actor, attacker, damageState)` -- death event handler
  - `damageStateThreshold: DamageState` -- minimum damage state to trigger
  - Triggers warheads at actor's death position
  - Used for unit death explosions, building demolition

#### 3.5.3 FireProjectilesOnDeath

- [ ] **TODO-8.E.3** `src/OpenRA.Mods.Common/Traits/FireProjectilesOnDeath.ts` (124 lines C#) -- Death projectile burst:
  - `projectile: string` -- projectile type to spawn on death
  - `count: number` -- number of projectiles to spawn
  - `offset: WVec` -- spawn offset from actor center
  - `facing: WAngle` -- fixed or random facing for projectiles
  - `killed(actor, attacker, damageState)` -- spawns projectile burst on death
  - Random facing distribution for multi-projectile bursts

#### 3.5.4 AttackSounds

- [ ] **TODO-8.E.4** `src/OpenRA.Mods.Common/Traits/Sound/AttackSounds.ts` (80 lines C#) -- Attack audio feedback:
  - `sounds: string[]` -- sound effects to play when attacking
  - `delay: number` -- delay before playing sound
  - `audibleRange: WDist` -- hearing distance
  - `volume: number` -- playback volume
  - Plays random sound from array on each attack event
  - Integration with Ch7 Phase D `Sound` for spatial audio positioning

#### 3.5.5 DeathSounds

- [ ] **TODO-8.E.5** `src/OpenRA.Mods.Common/Traits/Sound/DeathSounds.ts` (48 lines C#) -- Death audio feedback:
  - `sounds: string[]` -- sound effects to play on death
  - `volume: number` -- playback volume
  - `killed(actor, attacker, damageState)` -- death event handler plays sound
  - Plays random sound from array
  - Infantry/vehicle-specific death sounds

#### 3.5.6 DamageMultiplier

- [ ] **TODO-8.E.6** `src/OpenRA.Mods.Common/Traits/Multipliers/DamageMultiplier.ts` (37 lines C#) -- Damage taken multiplier:
  - `modifier: number` -- damage multiplier on incoming damage
  - Modifies damage received from all sources
  - Applied during `getEffectiveDamage()` before Armor reduction
  - Used for defensive buffs/debuffs

#### 3.5.7 ReloadDelayMultiplier

- [ ] **TODO-8.E.7** `src/OpenRA.Mods.Common/Traits/Multipliers/ReloadDelayMultiplier.ts` (31 lines C#) -- Reload speed multiplier:
  - `modifier: number` -- reload time scaling factor
  - Modifies all armaments' `reloadTicks`
  - Used for rate-of-fire buffs/debuffs (e.g., veterancy bonus)

#### 3.5.8 InaccuracyMultiplier

- [ ] **TODO-8.E.8** `src/OpenRA.Mods.Common/Traits/Multipliers/InaccuracyMultiplier.ts` (31 lines C#) -- Inaccuracy multiplier:
  - `modifier: number` -- inaccuracy scaling factor
  - Modifies weapon spread/inaccuracy radius
  - Affects projectile spawn offset randomization

#### 3.5.9 ExplosionOnDamageTransition

- [ ] **TODO-8.E.9** `src/OpenRA.Mods.Common/Traits/ExplosionOnDamageTransition.ts` (78 lines C#) -- Damage-state explosion trigger:
  - `damageState: DamageState` -- threshold to trigger explosion
  - `weapon: string` -- weapon/warhead to trigger at threshold
  - `damageStateChanged(actor, attackInfo)` -- fires warhead when damage crosses threshold
  - Used for multi-stage building damage explosions

#### 3.5.10 WithMuzzleOverlay

- [ ] **TODO-8.E.10** `src/OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.ts` (118 lines C#) -- Muzzle flash render trait:
  - `sequence: string` -- sprite sequence name for muzzle flash
  - `palette: string` -- palette for muzzle sprite coloring
  - `offset: WVec` -- flash position offset from weapon hardpoint
  - `ignoredFacing: number` -- facing-independent rendering option
  - `firing(actor, target, armament, facing)` -- event handler, shows muzzle sprite for N ticks
  - 3D: `Billboard` sprite at weapon hardpoint world position, camera-facing
  - Auto-hide after animation sequence completes

#### 3.5.11 WithAttackAnimation

- [ ] **TODO-8.E.11** `src/OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.ts` (96 lines C#) -- Attack animation render trait:
  - `sequence: string` -- sprite animation sequence for attack
  - `body: string` -- body part name (for multi-part sprites)
  - `delay: number` -- ticks to play animation
  - `attacking(actor, target, armament, facing)` -- event handler triggers animation playback
  - Integration with Ch2 `Animation` for sprite frame cycling
  - Revert to idle sequence after animation completes

#### 3.5.12 WithAttackOverlay

- [ ] **TODO-8.E.12** `src/OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.ts` (107 lines C#) -- Attack overlay render trait:
  - `sequence: string` -- overlay sprite sequence
  - `palette: string` -- palette for overlay coloring
  - Overlay rendered on top of the actor during attack
  - `attacking(actor, target, armament, facing)` -- event handler triggers overlay display
  - 3D: additional semi-transparent Billboard sprite layered over actor sprite
  - Fade-in/fade-out effect over attack duration

#### 3.5.13 Turreted

- [ ] **TODO-8.E.13** `src/OpenRA.Mods.Common/Traits/Turreted.ts` (333 lines C#) -- Turret rotation trait:
  - `turretFacing: WAngle` -- current turret rotation angle
  - `desiredFacing: WAngle` -- target rotation angle
  - `turnSpeed: WAngle` -- rotation speed per tick
  - `initialFacing: WAngle` -- starting turret angle
  - `realignDelay: number` -- ticks before auto-realignment
  - `offset: WVec` -- turret center offset from actor origin
  - `worldFacingFromWAngle(actor): WVec` -- facing vector from WAngle
  - `canYaw: boolean` / `canPitch: boolean` -- rotation axis permissions
  - `tick(actor)` -- advance turret rotation toward desired facing
  - 3D: `TransformNode` child of actor, `rotation.y` interpolation via `Quaternion.RotateTowards`
  - Turret rotation respects `rotationSpeed: WAngle` per-tick limit
  - Multiple turrets per actor supported via `turretIndex` parameter

#### 3.5.14 AttackBomber

- [ ] **TODO-8.E.14** `src/OpenRA.Mods.Common/Traits/Air/AttackBomber.ts` (95 lines C#) -- Bomber aircraft attack:
  - `facingTolerance: WAngle` -- bomb release angle tolerance
  - `targetDistance: WDist` -- maximum bomb range
  - `bombFacingOffset: WAngle` -- bomb release angle offset
  - `doAttack(world, source, target)` -- spawns GravityBomb projectiles
  - Line-of-sight bomb release check from aircraft altitude
  - Bomber must fly over the target to release bombs

#### 3.5.15 AttackAircraft

- [ ] **TODO-8.E.15** `src/OpenRA.Mods.Common/Traits/Air/AttackAircraft.ts` (69 lines C#) -- Air-to-air / air-to-ground attack:
  - `attackType: AirAttackType` (Strafe, FlyBy, Hover)
  - `attackRange: WDist` -- engagement range
  - `ammoRequirement: string` -- required ammo pool for attack
  - `doAttack(world, source, target)` -- creates air-specific AttackActivity
  - Strafe: fly past target while firing
  - Hover: hold position and fire (helicopters)
  - FlyBy: single pass attack

**Phase E Summary**: 15 files, ~1,523 C# lines, estimated ~5,800 TS implementation + ~4,000 test lines

---

## 4. Dependency Graph

```
Chapters 2-7 (COMPLETE -- Foundation)
  |
  +--> Phase A (Warheads Foundation: 15 files)
  |     |
  |     +--> Phase B (Projectiles System: 7 files)
  |     |     |
  |     |     +--> Phase C (Weapon Config: 2+1 files)
  |     |           |
  |     |           +--> Phase D (Core Combat Traits: 17 files)
  |     |                 |
  |     |                 +--> Phase E (Combat Support Traits: 15 files)
  |     |
  |     +--> Phase D (Armament references warheads directly)
  |
  +--> Phase C (WeaponInfo -- can begin once Phase A+B warhead/projectile types known)

Internal Phase Dependencies:

  Warhead.cs  ----------> all other warheads (abstract base)
  DamageWarhead.cs -----> SpreadDamageWarhead.cs, TargetDamageWarhead.cs
  WeaponInfo.cs --------> Phase A warheads + Phase B projectiles
  Armament.cs ----------> WeaponInfo.cs
  AttackBase.cs --------> Armament.cs + Turreted.ts (Phase E)
  AutoTarget.cs --------> AttackBase.cs + Turreted.ts (Phase E)
  AttackTurreted.cs ----> AttackBase.cs + Turreted.ts (Phase E)
  AttackGarrisoned.cs --> AttackBase.cs + Building.cs (Chapter 11 stub)
  HitShape.cs ----------> (independent, used by SpreadDamageWarhead)
  Turreted.ts ----------> (Phase E, but required by Phase D attack variants)
```

### Critical Path

```
Phase A -> Phase B -> Phase C -> Phase D(AttackBase+Armament+AutoTarget) -> Phase D(remaining) -> Phase E
                                                                        \-> Phase E(Turreted -- early, needed by Phase D attack variants)
```

### Parallelization Opportunities

- **Phase A files 2-15**: All warhead implementations can be parallel-assigned (LOW complexity, only depend on Warhead.cs base)
- **Phase A vs Phase C**: WeaponInfo can begin while warheads are being implemented (interface is known)
- **Phase D vs Phase E**: Multiplier traits (TODO-8.E.6 through TODO-8.E.8) are independent and can parallel with Phase D
- **Phase D internal**: AmmoPool, ReloadAmmoPool, Armor, HitShape, RangeMultiplier, FirepowerMultiplier are independent of AttackBase variants
- **Phase E internal**: Sound traits (AttackSounds, DeathSounds), Render traits (WithMuzzleOverlay, WithAttackAnimation), Multiplier traits are all independent of each other

### Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| Warhead.cs base | Must be migrated before ANY other warhead (all warheads extend it) |
| SpreadDamageWarhead | Needs HitShape.ts for distance-to-shape calculation |
| Missile | Needs Warhead base + WeaponInfo for warhead lookup |
| Armament | Needs WeaponInfo (which needs warhead + projectile type names) |
| AttackBase | Needs Armament for weapon management |
| AttackTurreted | Needs Turreted.ts (Phase E) -- Turreted must migrate early |
| AttackGarrisoned | Needs Building stub from Chapter 11 |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns per phase:

- [ ] **TEST-8.1** Warhead base class validates target types correctly (Ground, Water, Air, invalid combinations)
- [ ] **TEST-8.2** DamageWarhead computes `getEffectiveDamage()` correctly with all armor type `versus` multipliers
- [ ] **TEST-8.3** SpreadDamageWarhead falloff calculation matches C# reference within +-1 su at all distance thresholds; verify with known test positions at 0%, 25%, 50%, 75%, 100% of spread radius
- [ ] **TEST-8.4** CreateEffectWarhead spawns correct effect type at correct position for water and land terrain
- [ ] **TEST-8.5** FireClusterWarhead generates correct number of sub-explosions within spread radius bounds
- [ ] **TEST-8.6** Missile trajectory: position at tick 0, midpoint, and impact match C# reference within 1 WDist unit for straight, homing, and arcing paths
- [ ] **TEST-8.7** Missile homing: verify angle correction per tick stays within `horizontalRateOfTurn` and `verticalRateOfTurn` limits
- [ ] **TEST-8.8** AreaBeam applies damage to all actors within beam width, skips actors outside beam width
- [ ] **TEST-8.9** InstantHit projectile triggers warheads on tick 0 and self-disposes
- [ ] **TEST-8.10** WeaponInfo fromJSON() validates projectile, warhead, and all numeric fields; rejects invalid configs
- [ ] **TEST-8.11** Armament checkFire() returns correct result for: in-range target, out-of-range target, reloading, burst cooldown, ammo-depleted
- [ ] **TEST-8.12** AutoTarget scanForTarget() selects correct target by: closest distance, highest priority, stance filtering (HoldFire returns no target)
- [ ] **TEST-8.13** AttackBase facingTolerance: verify firing is blocked when target bearing exceeds tolerance, allowed when within
- [ ] **TEST-8.14** HitShape distanceFromEdge() for Circle and Rectangle matches C# within 1 WDist unit
- [ ] **TEST-8.15** HitShape intersects() shape-shape collision correctly identifies overlapping and non-overlapping shapes
- [ ] **TEST-8.16** AmmoPool takeAmmo()/giveAmmo() maintain correct counts; hasAmmo() returns false when empty
- [ ] **TEST-8.17** Turreted rotation: WAngle lerp matches C# turn rate cap per tick; verify rotate-to-target within expected tick count
- [ ] **TEST-8.18** Multiplier stacking: RangeMultiplier(1.5) + ReloadDelayMultiplier(0.5) correctly combine in Armament.getReloadTicks()
- [ ] **TEST-8.19** FireWarheadsOnDeath triggers correct warhead at actor death position; verifies emptyWeapon vs weapon selection logic
- [ ] **TEST-8.20** Render traits (WithMuzzleOverlay, WithAttackAnimation) trigger correct sprite sequences on attack events

### 5.2 Per-Phase Test File Estimates

| Phase | Files | Test Files | Estimated Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Warheads | 15 | 12 | ~90 | ~3,000 |
| B: Projectiles | 7 | 7 | ~70 | ~5,500 |
| C: Weapon Config | 2 | 2 | ~30 | ~900 |
| D: Core Combat Traits | 17 | 15 | ~120 | ~8,500 |
| E: Support Traits | 15 | 14 | ~100 | ~4,000 |
| **Total** | **56** | **50** | **~410** | **~21,900** |

### 5.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Projectile rendering | `/test/projectiles/missile/` | Verify missile trajectory, contrail, homing behavior |
| Beam rendering | `/test/projectiles/areabeam/` | Verify cylinder beam rendering, fade-in/fade-out |
| Laser rendering | `/test/projectiles/laserzap/` | Verify instant laser beam with glow effect |
| Muzzle flash | `/test/combat/muzzle-overlay/` | Verify muzzle sprite at weapon hardpoint, camera-facing |
| Turret rotation | `/test/combat/turreted/` | Verify turret rotation toward target, turn speed limits |
| Explosion effects | `/test/weapons/explosion/` | Verify explosion particle systems, damage flash, camera shake |
| Integrated combat | `/test/weapons/combat-loop/` | Full loop: targeting -> fire -> projectile -> hit -> damage -> death |

### 5.4 Integration Testing

- [ ] **TEST-8.I1** Combat integration: spawn two actors with weapons, verify full combat loop (AutoTarget scans -> AttackBase fires -> Armament spawns projectile -> projectile travels -> warhead impacts -> damage applied -> death triggers FireWarheadsOnDeath)
- [ ] **TEST-8.I2** Spread damage: spawn cluster of actors, fire spread-damage weapon, verify all actors within radius receive correct distance-based damage
- [ ] **TEST-8.I3** Burst fire: verify Armament fires correct number of bursts with correct inter-burst delay
- [ ] **TEST-8.I4** Ammo management: fire until ammo depleted, verify cannot fire, reload restores ammo, can fire again

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Missile trajectory parity** (980 lines, complex physics) | HIGH | Homing missiles behave differently from OpenRA, breaking balance | Port Missile.cs Tick() line-for-line; validate at 10 evenly-spaced ticks against C# reference |
| **SpreadDamageWarhead falloff precision** | MEDIUM | AOE damage differs by >1 su, causing balance issues | Use WDist arithmetic (not float rounding); validate at spread boundary with 0.1 WDist precision |
| **AttackBase facing tolerance in 3D** | MEDIUM | 3D dot product produces different results than 2D angle comparison | Use exact WAngle -> radian conversion; verify cosine threshold matches C# WAngle comparison |
| **HitShape 2D-to-3D conversion** | MEDIUM | Collision detection misses or false-positives in 3D space | All HitShape tests on XZ plane (Y=0); use BoundingBox with zero Y-extent |
| **Turreted rotation in 3D quaternion space** | MEDIUM | Turret rotation overshoots or oscillates | Use Quaternion.RotateTowards with WAngle-converted step size; verify turn rate cap per tick |
| **Armament reload timing across bursts** | LOW | Burst fire rhythm differs from OpenRA | Use exact tick counting; verify burst delay + reload delay match C# config |
| **Projectile collision with terrain** | MEDIUM | Projectiles pass through terrain or detonate early | Use scene.pickWithRay from prev-to-current position; terrain height check per tick |
| **AutoTarget scan performance with 200+ units** | MEDIUM | ScanForTarget O(n) per actor causes frame drops | Spatial hash or frustum culling; scan interval 10+ ticks; distance pre-filter |
| **WeaponInfo JSON validation gaps** | LOW | Invalid weapon config causes runtime errors | Validate all fields in fromJSON(); throw descriptive errors for missing required fields |
| **Multiplier stacking order** | LOW | Incorrect order produces different final values from OpenRA | Document multiplication order; verify with 3 stacked multipliers against expected OpenRA result |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-8.1: Deferred Warhead Effect Resolution

- **Decision**: All warhead effects are queued during `doImpact()` and applied in `world.frameEndActions`.
- **Rationale**: Prevents mid-tick state mutation cascades where one warhead's damage kills an actor whose death fires another warhead within the same tick. This matches OpenRA's own `frameEndActions` pattern and ensures deterministic state across network clients.
- **Mitigation**: `WarheadEffect` interface with `apply(world): void`; effects applied in insertion order at frame-end.

### ADR-8.2: HitShape 2D Distance Preservation in 3D

- **Decision**: HitShape geometry operates on the XZ plane (Y=0 in Babylon.js world space). All distance calculations use `WDist` arithmetic converted via CoordinateTransformer. BoundingBox Y-extent is zero.
- **Rationale**: OpenRA's HitShape is a 2D polygon on the map surface. 3D should preserve exact 2D semantics by operating on a horizontal plane. Height (Y-axis) is ignored for hit detection.
- **Mitigation**: `BoundingBox` minimum/maximum Y set to same value (terrain height at cell). `BoundingSphere` center Y matches terrain height.

### ADR-8.3: Weapon Factory Registry vs Reflection

- **Decision**: Use a TypeScript `Map<string, ProjectileFactory>` and `Map<string, WarheadFactory>` registry. Projectile and warhead classes self-register via static initializers.
- **Rationale**: OpenRA uses C# reflection + `[field: ...]` attributes for instantiation. TypeScript has no runtime reflection. A central factory registry provides the same decoupling.
- **Mitigation**: Each projectile/warhead file calls `ProjectileRegistry.register("Missile", Missile)` at module load time.

### ADR-8.4: Missile Physics -- Line-for-Line Port

- **Decision**: Port `Missile.Tick()` line-for-line from C#. Use WVec arithmetic (not float vectors) for homing angle calculations. Convert to Babylon.js Vector3 only for rendering.
- **Rationale**: Missile behavior is tuned extensively in OpenRA. Any physics discrepancy breaks unit balance. Line-for-line port guarantees parity.
- **Mitigation**: Run identical tick sequence in C# and TS for known test scenarios; diff position at each tick.

### ADR-8.5: Beam Projectile Rendering (Cylinder-Based)

- **Decision**: AreaBeam and LaserZap render using Babylon.js `MeshBuilder.CreateCylinder()` oriented from source to target. Emissive ShaderMaterial provides glow effect. Width controlled by cylinder diameter.
- **Rationale**: 3D cylinders provide proper 3D beam rendering with correct depth testing and lighting. OpenRA's 2D lines can't translate directly.
- **Mitigation**: Cylinder length = distance between source and target; oriented via `Quaternion.RotationAlignTo(direction)`.

### ADR-8.6: AmmoPool Condition Token Strategy

- **Decision**: AmmoPool empty state uses Ch3 `ConditionManager` tokens (e.g., "ammo-empty" condition). Armament checks condition + pool count before firing.
- **Rationale**: This matches OpenRA's pattern where AmmoPool grants a condition that AttackBase checks. The existing Ch3 condition system handles reference-counted token lifecycle.
- **Mitigation**: `AmmoPool.takeAmmo()` grants condition when count reaches zero; `AmmoPool.giveAmmo()` revokes condition when count > 0.

### ADR-8.7: Attack Activity Integration with Pathfinding

- **Decision**: AttackBase creates AttackActivity (Chapter 14) that chains MoveWithinRange activity + fire sequence. Attack activity uses Ch4 Phase G pathfinding for movement to weapon range.
- **Rationale**: OpenRA's attack behavior is activity-based -- move into range, then fire. The attack activity orchestrates movement and firing as a state machine.
- **Mitigation**: Attack activity stub defined early; full implementation in Chapter 14. Early testing uses direct fire without movement.

---

## Migration Order and Phasing Strategy

| Week | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A (core) | 4 | Warhead, DamageWarhead, SpreadDamageWarhead, TargetDamageWarhead | NO (base first) |
| 1-2 | Phase A (remaining) | 11 | All other warheads | YES (all 11) |
| 2-3 | Phase B (all) | 7 | All projectile types | Missile first, then parallel |
| 3 | Phase C | 2 | WeaponInfo, SoundInfo | After Phase A+B |
| 3-5 | Phase D (core) | 5 | Armament, AttackBase, AutoTarget, HitShape, Armor | AttackBase after Armament |
| 5-6 | Phase D (remaining) | 12 | Attack variants, AmmoPool, Multipliers | YES (most independent) |
| 6-7 | Phase E | 15 | All support traits | YES (most independent) |

**Total**: 7 weeks (single developer) or 4-5 weeks (2 developers with parallel assignments).

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.5 (WeaponInfo/Combat) + Section 4.3 (Traits) -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.1 -- Verified file paths and line counts
> - `docs/map_system_migration_plan.md` -- Chapter 4 plan (format reference)
> - `docs/actor_system_migration_plan.md` -- Chapter 3 plan
> - `docs/network_sync_migration_plan.md` -- Chapter 6 plan
> - `docs/input_camera_audio_effects_migration_plan.md` -- Chapter 7 plan
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
