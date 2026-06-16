# OpenRA to Babylon.js Migration Plan: Remaining Systems (Chapters 8-21)

> **Source Reference**: `docs/openra_migration.agent.final.converted.md`
> **Chapter Status**: IN PROGRESS (101 files migrated: Ch8 57/57 + Ch9 30/30 + Ch13 14/14; ~288 remaining in Ch10-12 + Ch14-21)
> **Created**: 2026-06-12
> **Prerequisite**: Chapters 2-7 COMPLETE (162/162 files, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [System Categorization & Chapter Layout](#2-system-categorization--chapter-layout)
3. [Core Migration Tasks by Chapter](#3-core-migration-tasks-by-chapter)
   - 3.1 [Chapter 8: Weapons & Combat System](#31-chapter-8-weapons--combat-system)
   - 3.2 [Chapter 9: Unit Movement & Physics](#32-chapter-9-unit-movement--physics)
   - 3.3 [Chapter 10: Resource & Economy System](#33-chapter-10-resource--economy-system)
   - 3.4 [Chapter 11: Production & Building System](#34-chapter-11-production--building-system)
   - 3.5 [Chapter 12: Shroud & Fog of War](#35-chapter-12-shroud--fog-of-war)
   - 3.6 [Chapter 13: Support Powers](#36-chapter-13-support-powers)
   - 3.7 [Chapter 14: Activity Implementations](#37-chapter-14-activity-implementations)
   - 3.8 [Chapter 15: Order Generators](#38-chapter-15-order-generators)
   - 3.9 [Chapter 16: UI Widget Extensions](#39-chapter-16-ui-widget-extensions)
   - 3.10 [Chapter 17: Replay & Save System](#310-chapter-17-replay--save-system)
   - 3.11 [Chapter 18: Server System](#311-chapter-18-server-system)
   - 3.12 [Chapter 19: Mod-Specific Content (C&C + D2K)](#312-chapter-19-mod-specific-content-cnc--d2k)
   - 3.13 [Chapter 20: Scripting System](#313-chapter-20-scripting-system)
   - 3.14 [Chapter 21: Editor, Utilities & Tooling](#314-chapter-21-editor-utilities--tooling)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Where We Are

Chapters 2-7 are 100% complete (162 files migrated):
- **Ch2**: Rendering Engine (27/27) -- GPU pipeline, shaders, sprites, textures
- **Ch3**: Actor System (36/36) -- World, Actor, TraitDictionary, TraitsInterfaces, Activity base, Player, Effects, ScreenMap
- **Ch4**: Map & Terrain (37/37) -- CellLayers, MapGrid, Map, Terrain, Pathfinding, MiniYAML pipeline
- **Ch5**: UI & Resources (16/16) -- FileSystem, MOD System, Widget core, WorldInteraction
- **Ch6**: Network & Game Logic (29/29) -- Order/Connection/OrderManager, Sync, Ruleset, AI BotModules
- **Ch7**: Input, Camera, Audio & Effects (13/13) -- InputHandler, Viewport, Selection, Sound, Effects, Bullet, RenderSprites

The remaining work consists of approximately **250+ files** spanning core gameplay traits, activities, order generators, UI widgets, weapon/warhead systems, mod-specific content, scripting, server infrastructure, and editor tooling. These systems build on the completed foundation layers.

### 1.2 Core Paradigm Shift (Remaining Systems)

The remaining migration shifts from infrastructure (graphics, networking, input, file systems) to **gameplay logic** (combat, movement, production, economy, AI, missions). The key paradigm shifts:

- **2D grid combat mechanics** (Armament range circles, AttackBase facing masks, HitShape 2D rectangles) to **3D spatial combat** (raycast distance, frustum-based range, bounding box hit detection)
- **2D unit rendering** (RenderSprites, WithIdleOverlay, WithSpriteBody) to **3D Billboard/BillboardGroup rendering** with Babylon.js Sprite/ThinInstance pipelines
- **MiniYAML data-driven traits** to **JSON data-driven components** with TypeScript decorator metadata
- **C# Reflection trait composition** to **TypeScript class registry + runtime component attachment**
- **2D shroud/fog tile rendering** to **Babylon.js PostProcess + transparency-based fog reveal**

### 1.3 Seven Core Architectural Principles for Remaining Migration

1. **Trait-as-Component pattern**: OpenRA traits map to TypeScript classes implementing standardized interfaces (`ITick`, `INotifyCreated`, `IRender`, `IResolveOrder`). Components attach to `GameActor` via the existing `TraitDictionary` and condition system from Chapter 3.

2. **Gameplay logic / rendering split**: Each trait splits into a logic layer (TypeScript class, deterministically tickable) and optional visual layer (Babylon.js Mesh/Sprite/ParticleSystem). This preserves deterministic lockstep while enabling rich 3D visuals.

3. **JSON rule data over MiniYAML**: All weapon, actor, and mod configuration consumed as JSON at runtime. The MiniYAML-to-JSON build pipeline (Ch4 Phase H) handles all YAML preprocessing.

4. **Event-driven trait communication**: Traits communicate via typed events and the existing `IResolveOrder` / `Order` system rather than direct cross-trait references. This maintains the dependency inversion principle central to OpenRA's architecture.

5. **Pooled projectile/effect objects**: Frequent-creation objects (projectiles, effects, particles) use object pools with pre-allocated Babylon.js resources to eliminate per-frame allocation.

6. **LOD for all visual traits**: Distance-based level-of-detail controls rendering quality for shroud, effects, projectiles, and unit visuals. Close units render full detail; distant units use simplified meshes or are culled.

7. **Phased delivery**: Each chapter is independently testable. Chapters with no dependency on each other can be parallel-assigned. Core gameplay traits (combat, movement) must precede derived traits (support powers, production).

### 1.4 Completed Foundation (Not Repeated Here)

The following infrastructure is already complete and available for all remaining chapters:

| System | Source | Status |
|--------|--------|--------|
| Renderer + WorldRenderer | Ch2 | Complete |
| Sprite/Sheet/Animation | Ch2 | Complete |
| World + Actor + Player | Ch3 | Complete |
| TraitDictionary + TraitsInterfaces | Ch3 | Complete |
| Activity base class | Ch3 Phase F | Complete |
| Map + Terrain + Pathfinding | Ch4 | Complete |
| FileSystem + MOD System | Ch5 | Complete |
| Widget core + ChromeProvider | Ch5 Phases C-D | Complete |
| WorldInteractionControllerWidget | Ch5 Phase E | Complete |
| Order + Connection + OrderManager | Ch6 Phase A | Complete |
| Sync hash system | Ch6 Phase B | Complete |
| Ruleset container | Ch6 Phase C | Complete |
| AI BotModules | Ch6 Phases D-E | Complete |
| Input + Camera + Selection | Ch7 Phases A-C | Complete |
| Audio + Effects + Projectiles | Ch7 Phases D-F | Complete |
| RenderSprites + AnimationWithOffset | Ch7 Phase G | Complete |

---

## 2. System Categorization & Chapter Layout

The remaining ~250+ files are organized into 14 chapters (8-21), each representing a self-contained subsystem. Ordering reflects dependency chains -- earlier chapters provide foundations for later ones.

| Chapter | Name | Approx. Files | Priority | Rationale |
|---------|------|:---:|:---:|-----------|
| **8** | Weapons & Combat System | ~55 | CRITICAL | Warheads + Projectiles + Combat traits form the core gameplay loop. Must precede Support Powers and most activities. |
| **9** | Unit Movement & Physics | ~30 | CRITICAL | Mobile trait is the largest single trait; enables units to move. Required by Production and many activities. |
| **10** | Resource & Economy System | ~15 | HIGH | Harvesting and economy; required for functional RTS gameplay. |
| **11** | Production & Building System | ~25 | HIGH | Production queues, building placement, construction. Depends on Movement and Economy. |
| **12** | Shroud & Fog of War | ~15 | MEDIUM | Exploration/visibility system. Required for full gameplay but not blocking combat tests. |
| **13** | Support Powers | 14 | MEDIUM | ~~Airstrike, Nuke, ParaDrop, Chronoshift. Depends on Combat + Effects.~~ **COMPLETE (14/14, 285 tests, R2 APPROVED)** |
| **14** | Activity Implementations | 49 | HIGH | Move, Attack, Fly, Harvest activities. Depends on Ch8-9. |
| **15** | Order Generators | ~11 | MEDIUM | UI order creation (PlaceBuilding, Repair, Guard). Depends on Ch5+Ch8. |
| **16** | UI Widget Extensions | ~40 | LOW | ProductionPalette, Radar, Observer widgets. Depends on Ch5+Ch11. |
| **17** | Replay & Save System | ~10 | MEDIUM | Replay recording/playback. Depends on Ch6 network layer. |
| **18** | Server System | ~9 | LOW | Dedicated server infrastructure. Independent of most chapters. |
| **19** | Mod-Specific Content | ~83 | LOW | C&C (70) + D2K (13) traits. Depends on all gameplay chapters. |
| **20** | Scripting System | ~7 | LOW | Lua mission scripting bridge. Depends on Ch8-13. |
| **21** | Editor & Utilities | ~15 | LOW | Map editor, brushes, utility commands. Depends on Ch4+Ch5. |

**Total estimated files**: ~389 (~288 remaining; 101 migrated = Ch8 57 + Ch9 30 + Ch13 14). Chapters 10-12 are tracked separately in their own detailed plans.

---

## 3. Core Migration Tasks by Chapter

### 3.1 Chapter 8: Weapons & Combat System

**Objective**: Implement the weapon/warhead/projectile infrastructure and core combat traits that form the RTS combat loop.

**Architecture Context**: Weapons in OpenRA are defined via `WeaponInfo` (YAML-configurable, referencing a warhead + projectile). When a weapon fires, a projectile is spawned that travels to the target, then the warhead applies effects. Combat traits (Armament, Attack*, AutoTarget, HitShape, Armor) control which actor can fire, at what target, under what conditions. This chapter implements the full weapons pipeline and the actor-side combat traits.

**Prerequisites**: Chapters 2-7 (all complete)

#### Phase A: Warheads Foundation (15 files) -- COMPLETE (15/15, 143 tests)

**Status**: APPROVED (2 review rounds, 2026-06-12). Commits: `d9f6c34` (initial), `9b25839` (Round 2 fixes).

Warheads are the impact-effect classes that apply damage and status effects. They form the foundation that projectiles trigger upon reaching their target.

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `OpenRA.Mods.Common/Warheads/Warhead.cs` | `src/OpenRA.Mods.Common/Warheads/Warhead.ts` | 98 | LOW |
| 2 | `OpenRA.Mods.Common/Warheads/DamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/DamageWarhead.ts` | 94 | MEDIUM |
| 3 | `OpenRA.Mods.Common/Warheads/SpreadDamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/SpreadDamageWarhead.ts` | 143 | HIGH |
| 4 | `OpenRA.Mods.Common/Warheads/TargetDamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/TargetDamageWarhead.ts` | 67 | LOW |
| 5 | `OpenRA.Mods.Common/Warheads/CreateEffectWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/CreateEffectWarhead.ts` | 149 | MEDIUM |
| 6 | `OpenRA.Mods.Common/Warheads/FireClusterWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/FireClusterWarhead.ts` | 118 | MEDIUM |
| 7 | `OpenRA.Mods.Common/Warheads/LeaveSmudgeWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/LeaveSmudgeWarhead.ts` | 75 | LOW |
| 8 | `OpenRA.Mods.Common/Warheads/DestroyResourceWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/DestroyResourceWarhead.ts` | 66 | LOW |
| 9 | `OpenRA.Mods.Common/Warheads/CreateResourceWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/CreateResourceWarhead.ts` | 59 | LOW |
| 10 | `OpenRA.Mods.Common/Warheads/ChangeOwnerWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/ChangeOwnerWarhead.ts` | 57 | LOW |
| 11 | `OpenRA.Mods.Common/Warheads/GrantExternalConditionWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/GrantExternalConditionWarhead.ts` | 52 | LOW |
| 12 | `OpenRA.Mods.Common/Warheads/FlashEffectWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/FlashEffectWarhead.ts` | 35 | LOW |
| 13 | `OpenRA.Mods.Common/Warheads/ShakeScreenWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/ShakeScreenWarhead.ts` | 34 | LOW |
| 14 | `OpenRA.Mods.Common/Warheads/HealthPercentageDamageWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/HealthPercentageDamageWarhead.ts` | 28 | LOW |
| 15 | `OpenRA.Mods.Common/Warheads/FlashTargetsInRadiusWarhead.cs` | `src/OpenRA.Mods.Common/Warheads/FlashTargetsInRadiusWarhead.ts` | 60 | LOW |

**Warheads Total**: 15 files, ~1,135 C# lines

#### Phase B: Projectiles System (7 files, Bullet already migrated)

Projectiles are the in-flight munition objects that travel from source to target. Bullet was already migrated in Ch7 Phase F. This phase covers the remaining projectile types.

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 16 | `OpenRA.Mods.Common/Projectiles/Missile.cs` | `src/OpenRA.Mods.Common/Projectiles/Missile.ts` | 980 | HIGH |
| 17 | `OpenRA.Mods.Common/Projectiles/AreaBeam.cs` | `src/OpenRA.Mods.Common/Projectiles/AreaBeam.ts` | 297 | MEDIUM |
| 18 | `OpenRA.Mods.Common/Projectiles/Railgun.cs` | `src/OpenRA.Mods.Common/Projectiles/Railgun.ts` | 257 | MEDIUM |
| 19 | `OpenRA.Mods.Common/Projectiles/LaserZap.cs` | `src/OpenRA.Mods.Common/Projectiles/LaserZap.ts` | 217 | MEDIUM |
| 20 | `OpenRA.Mods.Common/Projectiles/NukeLaunch.cs` | `src/OpenRA.Mods.Common/Projectiles/NukeLaunch.ts` | 173 | MEDIUM |
| 21 | `OpenRA.Mods.Common/Projectiles/GravityBomb.cs` | `src/OpenRA.Mods.Common/Projectiles/GravityBomb.ts` | 146 | LOW |
| 22 | `OpenRA.Mods.Common/Projectiles/InstantHit.cs` | `src/OpenRA.Mods.Common/Projectiles/InstantHit.ts` | 96 | LOW |

**Projectiles Total**: 7 files, ~2,166 C# lines (Bullet already in Ch7: 397)

#### Phase C: Weapon Configuration Data (2 files)

Configuration data classes that define weapons, sounds, and music from JSON rule files.

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 23 | `OpenRA.Game/GameRules/WeaponInfo.cs` | `src/OpenRA.Game/GameRules/WeaponInfo.ts` | 268 | MEDIUM |
| 24 | `OpenRA.Game/GameRules/SoundInfo.cs` | `src/OpenRA.Game/GameRules/SoundInfo.ts` | 97 | LOW |
| -- | `OpenRA.Game/GameRules/MusicInfo.cs` | `src/OpenRA.Game/GameRules/MusicInfo.ts` | 65 | LOW (optional) |

#### Phase D: Core Combat Traits (17 files)

The actor-side components that enable combat: Armament (weapon mount), Attack* variants (attack behavior), AutoTarget (target acquisition), HitShape (collision geometry), Armor (damage reduction). Note: Attack sub-variants live in `Traits/Attack/` subdirectory; multipliers live in `Traits/Multipliers/`.

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 25 | `OpenRA.Mods.Common/Traits/Armament.cs` | `src/OpenRA.Mods.Common/Traits/Armament.ts` | 432 | HIGH |
| 26 | `OpenRA.Mods.Common/Traits/AutoTarget.cs` | `src/OpenRA.Mods.Common/Traits/AutoTarget.ts` | 485 | HIGH |
| 27 | `OpenRA.Mods.Common/Traits/Attack/AttackBase.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackBase.ts` | 526 | HIGH |
| 28 | `OpenRA.Mods.Common/Traits/Attack/AttackTurreted.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackTurreted.ts` | 51 | LOW |
| 29 | `OpenRA.Mods.Common/Traits/Attack/AttackFrontal.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackFrontal.ts` | 48 | LOW |
| 30 | `OpenRA.Mods.Common/Traits/Attack/AttackOmni.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackOmni.ts` | 92 | LOW |
| 31 | `OpenRA.Mods.Common/Traits/AttackMove.cs` | `src/OpenRA.Mods.Common/Traits/AttackMove.ts` | 179 | MEDIUM |
| 32 | `OpenRA.Mods.Common/Traits/Attack/AttackFollow.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackFollow.ts` | 466 | HIGH |
| 33 | `OpenRA.Mods.Common/Traits/Attack/AttackCharges.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackCharges.ts` | 77 | LOW |
| 34 | `OpenRA.Mods.Common/Traits/AttackWander.cs` | `src/OpenRA.Mods.Common/Traits/AttackWander.ts` | 39 | LOW |
| 35 | `OpenRA.Mods.Common/Traits/Attack/AttackGarrisoned.cs` | `src/OpenRA.Mods.Common/Traits/Attack/AttackGarrisoned.ts` | 235 | MEDIUM |
| 36 | `OpenRA.Mods.Common/Traits/HitShape.cs` | `src/OpenRA.Mods.Common/Traits/HitShape.ts` | 177 | MEDIUM |
| 37 | `OpenRA.Mods.Common/Traits/Armor.cs` | `src/OpenRA.Mods.Common/Traits/Armor.ts` | 30 | LOW |
| 38 | `OpenRA.Mods.Common/Traits/AmmoPool.cs` | `src/OpenRA.Mods.Common/Traits/AmmoPool.ts` | 119 | LOW |
| 39 | `OpenRA.Mods.Common/Traits/ReloadAmmoPool.cs` | `src/OpenRA.Mods.Common/Traits/ReloadAmmoPool.ts` | 95 | LOW |
| 40 | `OpenRA.Mods.Common/Traits/Multipliers/RangeMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/RangeMultiplier.ts` | 33 | LOW |
| 41 | `OpenRA.Mods.Common/Traits/Multipliers/FirepowerMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/FirepowerMultiplier.ts` | 31 | LOW |

**Core Combat Traits Total**: 17 files, ~3,075 C# lines

#### Phase E: Combat-Related Support Traits (15 files)

Traits that modify, enhance, or react to combat events. These depend on the core combat traits from Phase D. Files span across Traits root, `Traits/Sound/`, `Traits/Multipliers/`, `Traits/Render/`, and `Traits/Air/` subdirectories.

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 42 | `OpenRA.Mods.Common/Traits/FireWarheads.cs` | `src/OpenRA.Mods.Common/Traits/FireWarheads.ts` | 86 | LOW |
| 43 | `OpenRA.Mods.Common/Traits/FireWarheadsOnDeath.cs` | `src/OpenRA.Mods.Common/Traits/FireWarheadsOnDeath.ts` | 190 | MEDIUM |
| 44 | `OpenRA.Mods.Common/Traits/FireProjectilesOnDeath.cs` | `src/OpenRA.Mods.Common/Traits/FireProjectilesOnDeath.ts` | 124 | LOW |
| 45 | `OpenRA.Mods.Common/Traits/Sound/AttackSounds.cs` | `src/OpenRA.Mods.Common/Traits/Sound/AttackSounds.ts` | 80 | LOW |
| 46 | `OpenRA.Mods.Common/Traits/Sound/DeathSounds.cs` | `src/OpenRA.Mods.Common/Traits/Sound/DeathSounds.ts` | 48 | LOW |
| 47 | `OpenRA.Mods.Common/Traits/Multipliers/DamageMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/DamageMultiplier.ts` | 37 | LOW |
| 48 | `OpenRA.Mods.Common/Traits/Multipliers/ReloadDelayMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/ReloadDelayMultiplier.ts` | 31 | LOW |
| 49 | `OpenRA.Mods.Common/Traits/Multipliers/InaccuracyMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/InaccuracyMultiplier.ts` | 31 | LOW |
| 50 | `OpenRA.Mods.Common/Traits/ExplosionOnDamageTransition.cs` | `src/OpenRA.Mods.Common/Traits/ExplosionOnDamageTransition.ts` | 78 | LOW |
| 51 | `OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.ts` | 118 | LOW |
| 52 | `OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.ts` | 96 | LOW |
| 53 | `OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.ts` | 107 | LOW |
| 54 | `OpenRA.Mods.Common/Traits/Turreted.cs` | `src/OpenRA.Mods.Common/Traits/Turreted.ts` | 333 | MEDIUM |
| 55 | `OpenRA.Mods.Common/Traits/Air/AttackBomber.cs` | `src/OpenRA.Mods.Common/Traits/Air/AttackBomber.ts` | 95 | LOW |
| 56 | `OpenRA.Mods.Common/Traits/Air/AttackAircraft.cs` | `src/OpenRA.Mods.Common/Traits/Air/AttackAircraft.ts` | 69 | LOW |

**Support Traits Total**: 15 files, ~1,523 C# lines

**Chapter 8 Grand Total**: 56 files (57 with optional MusicInfo), ~8,264 C# lines (8,329 with MusicInfo)

| Phase | Files | C# Lines | Description | Status |
|:---|:---:|:---:|:---|:---:|
| A: Warheads | 15 | 1,135 | Impact-effect classes | **COMPLETE** (15/15, 143 tests) |
| B: Projectiles | 7 | 2,166 | In-flight munition objects (Bullet already in Ch7) | Pending |
| C: Weapon Config | 2 (+1 opt) | 365 (+65) | WeaponInfo, SoundInfo, MusicInfo | Pending |
| D: Core Combat Traits | 17 | 3,075 | Armament, Attack*, AutoTarget, HitShape, Armor, etc. | Pending |
| E: Support Traits | 15 | 1,523 | FireWarheads, Render overlays, Turreted, Multipliers, etc. | Pending |

#### Chapter 8 Key Paradigm Shifts

| OpenRA Pattern | Babylon.js / TypeScript Pattern | Explanation |
|----------------|-------------------------------|-------------|
| `Warhead.DoImpact(target, firedBy)` synchronous damage | `Warhead.doImpact()` returning `WarheadEffect[]` | Damage effects queued for deferred application to avoid mid-tick state mutation |
| `AttackBase.FacingTolerance` 2D angle check | `Vector3.Dot()` or `Angle.Between()` 3D check | 2D facing masks replaced by 3D vector dot products on XZ plane |
| `HitShape` 2D polygon intersection | `BoundingBox.intersectsPoint()` / `scene.pickWithRay()` | 3D bounding boxes replace 2D polygon collision |
| `AutoTarget.ScanForTarget` CPU grid scan | Frustum + distance-based target acquisition | Target seeking uses spatial index + ray queries |
| `Missile.Tick` angle lerp trajectory | `Vector3.Lerp` + `Quaternion.Slerp` in 3D space | 3D arcing trajectory with proper Up-vector gravity |

#### Chapter 8 Architecture Decision Records

**ADR-8.1**: Warhead effects are deferred to frame-end execution to prevent mid-tick state mutation. All damage, condition grants, and kill events queue during `DoImpact()` and apply during `world.frameEndActions`.

**ADR-8.2**: Projectile collision uses `scene.pickWithRay()` from previous-to-current position each tick. AABB pre-check reduces raycast overhead for non-colliding projectiles.

**ADR-8.3**: AttackBase variants use `renderingGroupId=1` for range circles and `LinesMesh` for debug overlays, ensuring they render above terrain but below UI.

**ADR-8.4**: HitShape maps to `BABYLON.BoundingBox` or `BABYLON.BoundingSphere`. Per OpenRA convention, shapes are defined in WDist units and converted to world-space Babylon.js coordinates via CoordinateTransformer.

---

### 3.2 Chapter 9: Unit Movement & Physics -- COMPLETE (2026-06-13)

> **Detailed Plan**: [docs/chapter9_movement_physics_migration_plan.md](docs/chapter9_movement_physics_migration_plan.md) -- 32 files (30 active + 2 deferred), 4 phases A-D, ALL PHASES COMPLETE. **~11,723 TS implementation lines, 1,084 tests, 19 commits**.

**Objective**: COMPLETE. Implemented Mobile trait (largest single trait at 1079 lines C# -> ~2,500 lines TS) and all movement-related traits. Units can now traverse the game world via pathfinding, respecting terrain passability, blocking rules, and altitude constraints.

**Prerequisites**: Chapters 2-8 COMPLETE (219/219, 100%) -- satisfied.

#### Phase A: Core Movement Trait (5 files) -- COMPLETE

| # | File | Lines (C#) | Status |
|:---:|:---|:---:|:---:|
| 1 | `Mobile.ts` | 1079 | COMPLETE, ~2,500 TS lines |
| 2 | `Immobile.ts` | 62 | COMPLETE |
| 3 | `Locomotor.ts` | 526 | COMPLETE (upgraded from 261-line stub) |
| 4 | `PathFinder.ts` | 295 | COMPLETE |
| -- | `TraitsInterfaces.ts` (IMove expansion) | -- | COMPLETE |
| **Phase A Total** | 5 files | ~2,047 C# | ~4,200 TS, 361 tests, 7 commits, 2 review rounds |

#### Phase B: Aircraft & Air Movement (4 files) -- COMPLETE

| # | File | Lines (C#) | Status |
|:---:|:---|:---:|:---:|
| 5 | `Aircraft.ts` | 1381 | COMPLETE, ~2,500 TS lines |
| 6 | `FallsToEarth.ts` | 71 | COMPLETE |
| 7 | `BodyOrientation.ts` | 127 | COMPLETE |
| 8 | `QuantizeFacingsFromSequence.ts` | 48 | COMPLETE |
| **Phase B Total** | 4 files | ~1,627 C# | ~3,873 TS, 358 tests, 4 commits, 1 review round |

#### Phase C: World Movement Infrastructure (10 files) -- COMPLETE

SubterraneanLocomotor, SubterraneanActorLayer, BridgeLayer, LegacyBridgeLayer, ElevatedBridgeLayer, ElevatedBridgePlaceholder, TerrainTunnel, TerrainTunnelLayer, TunnelEntrance, EntersTunnels. ~900 C# lines, ~2,100 TS, 175 tests, 4 commits, 1 review round.

#### Phase D: Movement-Related Support Traits (11 + 2 deferred) -- COMPLETE

BlocksProjectiles, Crushable, AutoCrusher, TransformCrusherOnCrush, GrantConditionOnMovement, Hovers, TerrainModifiesDamage, SpeedMultiplier, AttackMove (upgraded from stub), ClassicFacingBodyOrientation, JumpjetLocomotor. 2 deferred: PathFinderOverlay, HierarchicalPathFinderOverlay. ~866 active C# lines, ~1,550 TS, 190 tests, 4 commits, 1 review round.

#### Chapter 9 Key Paradigm Shifts

| OpenRA Pattern | Babylon.js / TypeScript Pattern |
|----------------|-------------------------------|
| `Mobile.IsTraitPaused` + `Mobile.IsImmovable` state | Component `enabled` flag + Condition system integration |
| `Mobile.SetPosition` grid-based teleport | `TransformNode.position` direct set + interpolation |
| `Mobile.Facing` 8/16/32-direction discrete | `mesh.rotation.y` continuous angle + quantized sprite frame |
| `Mobile.VisualPosition` screen-space lerp | `TransformNode.position` smoothly interpolated each render frame |
| `Aircraft.Fly` altitude management | `TransformNode.position.y` for height zones |

**ADR-9.1**: Mobile trait positions are the ground truth for actor world position. All visual interpolation happens on `TransformNode` via `scene.onBeforeRenderObservable`. Mobile `CenterPosition` maps to `TransformNode.position`.

**ADR-9.2**: Movement blocking uses the existing Chapter 4 pathfinding `BlockedByActor` flags. `Mobile.CanEnterCell()` integrates with `DensePathGraph`/`MapPathGraph` cost functions from Chapter 4 Phase G.

---

### 3.3 Chapter 10: Resource & Economy System

**Objective**: Implement resource gathering, refining, and economy traits.

**Prerequisites**: Chapter 9 (Movement)

#### Phase A: Resource Infrastructure

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Traits/Harvester.cs` | `src/OpenRA.Mods.Common/Traits/Harvester.ts` | 330 | HIGH |
| 2 | `Traits/ResourceLayer.cs` | `src/OpenRA.Mods.Common/Traits/ResourceLayer.ts` | -- | MEDIUM |
| 3 | `Traits/ResourceRenderer.cs` | `src/OpenRA.Mods.Common/Traits/ResourceRenderer.ts` | -- | MEDIUM |
| 4 | `Traits/ResourceClaimLayer.cs` | `src/OpenRA.Mods.Common/Traits/ResourceClaimLayer.ts` | -- | LOW |
| 5 | `Traits/SeedsResource.cs` | `src/OpenRA.Mods.Common/Traits/SeedsResource.ts` | -- | LOW |
| 6 | `Traits/Refinery.cs` | `src/OpenRA.Mods.Common/Traits/Refinery.ts` | -- | MEDIUM |

#### Phase B: Economy Support Traits

| # | OpenRA Source | Target TypeScript File | Complexity |
|:---:|:---|:---|:---:|
| 7+ | StoresResources, StoresPlayerResources, PlayerResources, CashTrickler, Valued, GivesBounty, GivesCashOnCapture, DeliversCash, AcceptsDeliveredCash, Sellable, CustomSellValue | | LOW-MEDIUM |

**ADR-10.1**: Resource rendering uses Billboard sprites or instanced meshes on the terrain ground plane, positioned at cell centers with height offset from CellRamp data.

---

### 3.4 Chapter 11: Production & Building System

**Objective**: Implement production queues, building placement, construction, and base management traits.

**Prerequisites**: Chapter 9 (Movement), Chapter 10 (Economy)

#### Phase A: Production Queue System

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Traits/Production.cs` | `src/OpenRA.Mods.Common/Traits/Production.ts` | 156 | HIGH |
| 2 | `Traits/ProductionQueue.cs` | `src/OpenRA.Mods.Common/Traits/ProductionQueue.ts` | -- | HIGH |
| 3 | `Traits/ClassicProductionQueue.cs` | `src/OpenRA.Mods.Common/Traits/ClassicProductionQueue.ts` | -- | MEDIUM |
| 4 | `Traits/ProductionParadrop.cs` | `src/OpenRA.Mods.Common/Traits/ProductionParadrop.ts` | 166 | MEDIUM |
| 5 | `Traits/ProductionFromMapEdge.cs` | `src/OpenRA.Mods.Common/Traits/ProductionFromMapEdge.ts` | 117 | LOW |

#### Phase B: Building System

| # | OpenRA Source | Target TypeScript File | Complexity |
|:---:|:---|:---|:---:|
| 6+ | Building, BaseBuilding, BaseProvider, PlaceBuilding, PlaceBuildingVariants, Buildable, BuildingInfluence, LineBuild, RallyPoint, PrimaryBuilding, Exit, ProductionAirdrop, RepairableBuilding, Transforms, Demolition, Gate | | MEDIUM-HIGH |

**ADR-11.1**: Building placement preview uses semi-transparent ghost meshes positioned via `scene.onPointerMove` raycast to terrain. Legal placement areas are computed from `BuildingUtils.GetLineBuildCells()` logic.

---

### 3.5 Chapter 12: Shroud & Fog of War

**Objective**: Implement the exploration/visibility system that reveals and hides parts of the map.

**Prerequisites**: Chapter 4 (Map + Terrain), Chapter 8 (Combat)

#### Phase A: Shroud System

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Traits/Shroud.cs` | `src/OpenRA.Mods.Common/Traits/Shroud.ts` | -- | HIGH |
| 2 | `Traits/ShroudRenderer.cs` | `src/OpenRA.Mods.Common/Traits/ShroudRenderer.ts` | -- | HIGH |
| 3 | `Traits/CreatesShroud.cs` | `src/OpenRA.Mods.Common/Traits/CreatesShroud.ts` | 174 | MEDIUM |
| 4 | `Traits/RevealsShroud.cs` | `src/OpenRA.Mods.Common/Traits/RevealsShroud.ts` | -- | MEDIUM |
| 5 | `Traits/FrozenUnderFog.cs` | `src/OpenRA.Mods.Common/Traits/FrozenUnderFog.ts` | -- | MEDIUM |
| 6 | `Traits/HiddenUnderFog.cs` | `src/OpenRA.Mods.Common/Traits/HiddenUnderFog.ts` | -- | LOW |
| 7 | `Traits/HiddenUnderShroud.cs` | `src/OpenRA.Mods.Common/Traits/HiddenUnderShroud.ts` | -- | LOW |
| 8+ | RevealsMap, AffectsShroud, DetectCloaked, Cloak, PlayerRadarTerrain | | LOW-MEDIUM |

**ADR-12.1**: Shroud rendering uses a `RenderTargetTexture` (RTT) fog-of-war layer rendered as a semi-transparent overlay on the terrain. Shroud cells are updated via `RawTexture.update()` with visibility bitfield data.

**ADR-12.2**: Frozen actors (last-known position under fog) are rendered as static colored sprite instances with reduced opacity, stored in a per-player `FrozenActorLayer`.

---

### 3.6 Chapter 13: Support Powers -- COMPLETE (2026-06-15)

> **Detailed Plan**: [docs/chapter13_support_powers_migration_plan.md](docs/chapter13_support_powers_migration_plan.md) -- 14 files + 1 interface, 1 Phase A, COMPLETE. **6,423 TS implementation lines, 5,126 test lines, 285 tests, 4 commits**.

**Objective**: COMPLETE. Implemented support power infrastructure (SupportPower base class, SupportPowerManager registry) and 12 power implementations: AirstrikePower, NukePower, ParatroopersPower, ProduceActorPower, SpawnActorPower, GrantExternalConditionPower, DirectionalSupportPower, SelectDirectionalTarget, SupportPowerChargeBar, WithSupportPowerActivationAnimation, WithSupportPowerActivationOverlay, SupportPowerCrateAction. INotifySupportPower interface added to TraitsInterfaces.ts.

**Prerequisites**: All satisfied (Ch3 Actor, Ch5 OrderGenerator, Ch6 Order/IResolveOrder, Ch7 Sound/Effects, Ch8 Warheads/Projectiles, Ch9 Aircraft/Fly, Ch11 Production, Ch12 Shroud).

---

### 3.7 Chapter 14: Activity Implementations

**Objective**: Implement the 49 concrete Activity subclasses (Move, Attack, Fly, Harvest, etc.) that drive actor behavior state machines. Base class `Activity.cs` and `CallFunc.cs` already migrated in Chapter 3 Phase F.

**Prerequisites**: Activity base class (Ch3 Phase F) -- COMPLETE; Chapter 9 (Movement) -- COMPLETE; Chapter 8 (Combat) -- COMPLETE.

**Detailed Plan**: [docs/chapter14_activity_implementations_migration_plan.md](docs/chapter14_activity_implementations_migration_plan.md) -- 49 concrete files + 2 already-migrated base files, 6 phases (A-F). Phases A-D COMPLETE (36/49 files); Phases E-F PLANNING (0/13).

#### Phase A: Movement Activities (11 files)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Activities/Move/Move.cs` | `src/OpenRA.Mods.Common/Activities/Move/Move.ts` | 640 | HIGHEST |
| 2 | `Activities/Move/MoveAdjacentTo.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveAdjacentTo.ts` | 159 | MEDIUM |
| 3 | `Activities/Move/MoveOnto.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveOnto.ts` | 60 | LOW |
| 4 | `Activities/Move/MoveOntoAndTurn.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveOntoAndTurn.ts` | 43 | LOW |
| 5 | `Activities/Move/MoveWithinRange.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveWithinRange.ts` | 78 | MEDIUM |
| 6 | `Activities/Move/Drag.cs` | `src/OpenRA.Mods.Common/Activities/Move/Drag.ts` | 73 | LOW |
| 7 | `Activities/Move/Nudge.cs` | `src/OpenRA.Mods.Common/Activities/Move/Nudge.ts` | 64 | LOW |
| 8 | `Activities/Move/Follow.cs` | `src/OpenRA.Mods.Common/Activities/Move/Follow.ts` | 89 | MEDIUM |
| 9 | `Activities/Move/LocalMoveIntoTarget.cs` | `src/OpenRA.Mods.Common/Activities/Move/LocalMoveIntoTarget.ts` | 89 | LOW |
| 10 | `Activities/Move/AttackMoveActivity.cs` | `src/OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.ts` | 108 | MEDIUM |
| 11 | `Activities/Move/MoveCooldownHelper.cs` | `src/OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.ts` | 100 | LOW |

#### Phase B: Combat Activities (5 files)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Activities/Attack.cs` | `src/OpenRA.Mods.Common/Activities/Attack.ts` | 283 | HIGH |
| 2 | `Activities/Hunt.cs` | `src/OpenRA.Mods.Common/Activities/Hunt.ts` | 49 | LOW |
| 3 | `Activities/CaptureActor.cs` | `src/OpenRA.Mods.Common/Activities/CaptureActor.ts` | 158 | MEDIUM |
| 4 | `Activities/Demolish.cs` | `src/OpenRA.Mods.Common/Activities/Demolish.ts` | 89 | LOW |
| 5 | `Activities/Turn.cs` | `src/OpenRA.Mods.Common/Activities/Turn.ts` | 47 | LOW |

#### Phase C: Aircraft Activities (12 files)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Activities/Air/Fly.cs` | `src/OpenRA.Mods.Common/Activities/Air/Fly.ts` | 283 | HIGH |
| 2 | `Activities/Air/FlyAttack.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyAttack.ts` | 316 | HIGH |
| 3 | `Activities/Air/FlyFollow.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyFollow.ts` | 99 | MEDIUM |
| 4 | `Activities/Air/FlyForward.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyForward.ts` | 64 | LOW |
| 5 | `Activities/Air/FlyIdle.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyIdle.ts` | 66 | LOW |
| 6 | `Activities/Air/FlyOffMap.cs` | `src/OpenRA.Mods.Common/Activities/Air/FlyOffMap.ts` | 70 | LOW |
| 7 | `Activities/Air/Land.cs` | `src/OpenRA.Mods.Common/Activities/Air/Land.ts` | 276 | HIGH |
| 8 | `Activities/Air/TakeOff.cs` | `src/OpenRA.Mods.Common/Activities/Air/TakeOff.ts` | 73 | LOW |
| 9 | `Activities/Air/ReturnToBase.cs` | `src/OpenRA.Mods.Common/Activities/Air/ReturnToBase.ts` | 140 | MEDIUM |
| 10 | `Activities/Air/FallToEarth.cs` | `src/OpenRA.Mods.Common/Activities/Air/FallToEarth.ts` | 64 | LOW |
| 11 | `Activities/Air/DeliverBulkOrder.cs` | `src/OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.ts` | 118 | MEDIUM |
| 12 | `Activities/Parachute.cs` | `src/OpenRA.Mods.Common/Activities/Parachute.ts` | 58 | LOW |

#### Phase D: Economic Activities (7 files)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Activities/HarvestResource.cs` | `src/OpenRA.Mods.Common/Activities/HarvestResource.ts` | 124 | MEDIUM |
| 2 | `Activities/FindAndDeliverResources.cs` | `src/OpenRA.Mods.Common/Activities/FindAndDeliverResources.ts` | 263 | HIGH |
| 3 | `Activities/MoveToDock.cs` | `src/OpenRA.Mods.Common/Activities/MoveToDock.ts` | 150 | MEDIUM |
| 4 | `Activities/GenericDockSequence.cs` | `src/OpenRA.Mods.Common/Activities/GenericDockSequence.ts` | 216 | HIGH |
| 5 | `Activities/Resupply.cs` | `src/OpenRA.Mods.Common/Activities/Resupply.ts` | 327 | HIGH |
| 6 | `Activities/Sell.cs` | `src/OpenRA.Mods.Common/Activities/Sell.ts` | 58 | LOW |
| 7 | `Activities/LayMines.cs` | `src/OpenRA.Mods.Common/Activities/LayMines.ts` | 237 | MEDIUM |

#### Phase E: Transport & Enter Activities (6 files)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Activities/Enter.cs` | `src/OpenRA.Mods.Common/Activities/Enter.ts` | 163 | HIGH |
| 2 | `Activities/RideTransport.cs` | `src/OpenRA.Mods.Common/Activities/RideTransport.ts` | 93 | LOW |
| 3 | `Activities/UnloadCargo.cs` | `src/OpenRA.Mods.Common/Activities/UnloadCargo.ts` | 153 | MEDIUM |
| 4 | `Activities/PickupUnit.cs` | `src/OpenRA.Mods.Common/Activities/PickupUnit.ts` | 181 | MEDIUM |
| 5 | `Activities/DeliverUnit.cs` | `src/OpenRA.Mods.Common/Activities/DeliverUnit.ts` | 112 | MEDIUM |
| 6 | `Activities/SimpleTeleport.cs` | `src/OpenRA.Mods.Common/Activities/SimpleTeleport.ts` | 30 | LOW |

#### Phase F: Utility & Miscellaneous Activities (8 files)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Activities/Wait.cs` | `src/OpenRA.Mods.Common/Activities/Wait.ts` | 56 | LOW |
| 2 | `Activities/Transform.cs` | `src/OpenRA.Mods.Common/Activities/Transform.ts` | 189 | MEDIUM |
| 3 | `Activities/RemoveSelf.cs` | `src/OpenRA.Mods.Common/Activities/RemoveSelf.ts` | 26 | LOW |
| 4 | `Activities/DeployForGrantedCondition.cs` | `src/OpenRA.Mods.Common/Activities/DeployForGrantedCondition.ts` | 87 | LOW |
| 5 | `Activities/DonateCash.cs` | `src/OpenRA.Mods.Common/Activities/DonateCash.ts` | 52 | LOW |
| 6 | `Activities/DonateExperience.cs` | `src/OpenRA.Mods.Common/Activities/DonateExperience.ts` | 66 | LOW |
| 7 | `Activities/RepairBridge.cs` | `src/OpenRA.Mods.Common/Activities/RepairBridge.ts` | 89 | LOW |
| 8 | `Activities/InstantRepair.cs` | `src/OpenRA.Mods.Common/Activities/InstantRepair.ts` | 82 | LOW |

**Activity Total**: 49 concrete files, ~6,510 C# lines in original source (plus `Activity.cs` and `CallFunc.cs` already migrated in Chapter 3).

---

### 3.8 Chapter 15: Order Generators

**Objective**: Implement the UI-side order generation logic that converts player input (clicks, hotkeys) into Order objects.

**Prerequisites**: Chapter 5 Phase E (WorldInteraction), Chapter 6 Phase A (Order), Chapter 8 (Combat), Chapter 11 (Building)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Orders/UnitOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/UnitOrderGenerator.ts` | 224 | HIGH |
| 2 | `Orders/PlaceBuildingOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.ts` | 337 | HIGH |
| 3 | `Orders/OrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/OrderGenerator.ts` | 61 | LOW |
| 4 | `Orders/UnitOrderTargeter.cs` | `src/OpenRA.Mods.Common/Orders/UnitOrderTargeter.ts` | 88 | MEDIUM |
| 5 | `Orders/RepairOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/RepairOrderGenerator.ts` | 87 | LOW |
| 6 | `Orders/GuardOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/GuardOrderGenerator.ts` | 85 | LOW |
| 7 | `Orders/GlobalButtonOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/GlobalButtonOrderGenerator.ts` | 95 | LOW |
| 8+ | BeaconOrderGenerator, DeployOrderTargeter, EnterAlliedActorTargeter, ForceModifiersOrderGenerator | | LOW |

---

### 3.9 Chapter 16: UI Widget Extensions

**Objective**: Implement the remaining Chrome UI widgets beyond the core framework (Ch5 Phase D) and world interaction (Ch5 Phase E).

**Prerequisites**: Chapter 5 (Widget core, Ch5 Phases C-D), Chapter 11 (Production), Chapter 12 (Shroud)

#### Phase A: Production & Management Widgets

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Widgets/ProductionPaletteWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.ts` | 649 | HIGH |
| 2 | `Widgets/ProductionTabsWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ProductionTabsWidget.ts` | 370 | MEDIUM |
| 3 | `Widgets/SupportPowersWidget.cs` | `src/OpenRA.Mods.Common/Widgets/SupportPowersWidget.ts` | 298 | MEDIUM |
| 4 | `Widgets/ControlGroupsWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ControlGroupsWidget.ts` | 173 | LOW |
| 5 | `Widgets/ResourceBarWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ResourceBarWidget.ts` | 107 | LOW |

#### Phase B: Map & Observer Widgets

| # | OpenRA Source | Target TypeScript File | Complexity |
|:---:|:---|:---|:---:|
| 6+ | RadarWidget (530), ObserverProductionIconsWidget (281), MapPreviewWidget (233), ObserverArmyIconsWidget (211), ObserverSupportPowerIconsWidget (199), StrategicProgressWidget (106) | | MEDIUM-HIGH |

#### Phase C: Common UI Controls

| # | OpenRA Source | Target TypeScript File | Complexity |
|:---:|:---|:---|:---:|
| 12+ | ButtonWidget (298), TextFieldWidget (617), DropDownButtonWidget (256), SliderWidget (145), LabelWidget (132), CheckboxWidget (90), ImageWidget (98), HotkeyEntryWidget (162), ScrollPanelWidget (527), ScrollItemWidget (97), TooltipContainerWidget (114), ColorMixerWidget (189), VideoPlayerWidget (313), ScrollableLineGraphWidget (602), PerfGraphWidget (194), ConfirmationDialogs (194), TextNotificationsDisplayWidget (138), LineGraphWidget (234), LabelWithHighlightWidget (86) | | LOW-MEDIUM |

**Widgets Total**: ~40 files, ~10,678 C# lines in original source.

---

### 3.10 Chapter 17: Replay & Save System

**Objective**: Implement replay recording and playback, game save serialization.

**Prerequisites**: Chapter 6 Phase A (Order + Connection)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Network/ReplayRecorder.cs` | `src/OpenRA.Game/Network/ReplayRecorder.ts` | 119 | MEDIUM |
| 2 | `Network/ReplayConnection.cs` | `src/OpenRA.Game/Network/ReplayConnection.ts` | 136 | MEDIUM |
| 3 | `Network/GameSave.cs` | `src/OpenRA.Game/Network/GameSave.ts` | 333 | HIGH |
| 4 | `Network/SyncReport.cs` | `src/OpenRA.Game/Network/SyncReport.ts` | 342 | MEDIUM |
| 5 | `Traits/AutoSave.cs` | `src/OpenRA.Mods.Common/Traits/AutoSave.ts` | -- | LOW |
| 6 | `Traits/GameSaveViewportManager.cs` | `src/OpenRA.Mods.Common/Traits/GameSaveViewportManager.ts` | -- | LOW |

**ADR-17.1**: Replay files stored as gzipped MessagePack binary blobs. Replay playback uses `EchoConnection`-equivalent to feed recorded orders frame-by-frame into OrderManager.

---

### 3.11 Chapter 18: Server System

**Objective**: Implement the dedicated server infrastructure for multiplayer game hosting.

**Prerequisites**: Chapter 6 Phase A (Order + Connection), Chapter 6 Phase B (Sync)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Server/Server.cs` | `src/OpenRA.Game/Server/Server.ts` | 1594 | HIGHEST |
| 2 | `Server/Connection.cs` | `src/OpenRA.Game/Server/Connection.ts` | 220 | MEDIUM |
| 3 | `Server/OrderBuffer.cs` | `src/OpenRA.Game/Server/OrderBuffer.ts` | 139 | MEDIUM |
| 4 | `Server/VoteKickTracker.cs` | `src/OpenRA.Game/Server/VoteKickTracker.ts` | 223 | LOW |
| 5 | `Server/ProtocolVersion.cs` | `src/OpenRA.Game/Server/ProtocolVersion.ts` | 82 | LOW |
| 6 | `Server/TraitInterfaces.cs` | `src/OpenRA.Game/Server/TraitInterfaces.ts` | 63 | LOW |
| 7 | `Server/Exts.cs` | `src/OpenRA.Game/Server/Exts.ts` | 24 | LOW |
| 8 | `Server/MapStatusCache.cs` | `src/OpenRA.Game/Server/MapStatusCache.ts` | 106 | LOW |
| 9 | `Server/PlayerMessageTracker.cs` | `src/OpenRA.Game/Server/PlayerMessageTracker.ts` | 86 | LOW |

**ADR-18.1**: Game server runs in Node.js (not browser). Uses `ws` WebSocket library for client connections. Order broadcasting and sync hash verification operate identically to C# server logic.

**ADR-18.2**: Server can optionally run as a Web Worker in a "host" browser tab for peer-hosted games (no dedicated server needed).

---

### 3.12 Chapter 19: Mod-Specific Content (C&C + D2K)

**Objective**: Implement mod-specific traits for Command & Conquer (RA/TD/TS) and Dune 2000.

**Prerequisites**: All gameplay chapters (8-13)

#### Phase A: C&C Mod Traits (~70 files)

| Category | Example Traits | Complexity |
|----------|---------------|:---:|
| Attack variants | AttackLeap, AttackPopupTurreted, AttackTDGunboatTurreted, AttackTesla, AttackOrderPower | MEDIUM |
| Chrono tech | Chronoshiftable, ChronoshiftPostProcessEffect, ChronoshiftPower, PortableChrono, ConyardChronoReturn | MEDIUM-HIGH |
| Cloak/Stealth | Disguise, WithDisguisingInfantryBody, Infiltrates, InfiltrateFor* | MEDIUM |
| GPS/Sensors | GpsPower, GpsDot, GpsWatcher, FrozenUnderFogUpdatedByGps | MEDIUM |
| Infantry | ClassicFacingBodyOrientation, WithInfantryBody, WithSplitAttackPaletteInfantryBody | LOW |
| Tesla/Ion | IonCannonPower, AttackTesla, WithTeslaChargeAnimation, WithTeslaChargeOverlay | MEDIUM |
| Rendering | RenderVoxels, VoxelCache, ModelRenderer, ChronoVortexRenderer, TSVeinsRenderer, WithVoxelBody/Turret/Barrel/Walker/Unload | MEDIUM-HIGH |
| Other | MadTank, Cloneable, ClonesProducedUnits, DropPodsPower, EnergyWall, EdibleByLeap, ResourcePurifier, TDGunboat, HarvesterHuskModifier | LOW-MEDIUM |

#### Phase B: D2K Mod Traits (~13 files)

| Category | Example Traits | Complexity |
|----------|---------------|:---:|
| Sandworm | Sandworm, AttackSwallow, AttractsWorms | HIGH |
| Spice | SpiceBloom, D2kResourceRenderer | MEDIUM |
| Building | D2kBuilding, D2kActorPreviewPlaceBuildingPreview, D2kMapGenerator, BuildableTerrainLayer | MEDIUM |
| Visual | WithCrumbleOverlay, WithDeliveryOverlay, SonicBlastRenderer | LOW |
| Economy | HarvesterInsurance | LOW |

**ADR-19.1**: Voxel rendering (C&C TS/RA2) maps to Babylon.js Mesh with instancing for multi-part voxel models (turrets, barrels). Animated voxels use bone-less mesh transform updates per frame.

**ADR-19.2**: Mod-specific content is loaded lazily at runtime based on active mod manifest. No C&C or D2K code is bundled unless the corresponding mod is active.

---

### 3.13 Chapter 20: Scripting System

**Objective**: Implement the Lua scripting bridge for mission/campaign scripted behaviors.

**Prerequisites**: All gameplay chapters (8-13), Chapter 5 (MOD System)

| # | OpenRA Source | Target TypeScript File | Lines (C#) | Complexity |
|:---:|:---|:---|:---:|:---:|
| 1 | `Scripting/ScriptContext.cs` | `src/OpenRA.Game/Scripting/ScriptContext.ts` | 10248 | HIGH |
| 2 | `Scripting/ScriptMemberWrapper.cs` | `src/OpenRA.Game/Scripting/ScriptMemberWrapper.ts` | 4443 | HIGH |
| 3 | `Scripting/ScriptTypes.cs` | `src/OpenRA.Game/Scripting/ScriptTypes.ts` | 4489 | MEDIUM |
| 4 | `Scripting/ScriptObjectWrapper.cs` | `src/OpenRA.Game/Scripting/ScriptObjectWrapper.ts` | 2561 | MEDIUM |
| 5 | `Scripting/ScriptMemberExts.cs` | `src/OpenRA.Game/Scripting/ScriptMemberExts.ts` | 2066 | MEDIUM |
| 6 | `Scripting/ScriptActorInterface.cs` | `src/OpenRA.Game/Scripting/ScriptActorInterface.ts` | 1747 | MEDIUM |
| 7 | `Scripting/ScriptPlayerInterface.cs` | `src/OpenRA.Game/Scripting/ScriptPlayerInterface.ts` | 1047 | LOW |

**ADR-20.1**: Lua scripting in the browser uses `lua.vm.js` (compiled Lua 5.3 to JavaScript via Emscripten) or `fengari` (Lua VM in pure JS). Script triggers, objectives, and mission data are compiled from Lua to JSON at build time for non-scripted preview.

**ADR-20.2**: Scripting is optional for basic gameplay. The mission system works without Lua by using JSON-based trigger definitions that cover 80% of common mission patterns.

---

### 3.14 Chapter 21: Editor, Utilities & Tooling

**Objective**: Implement map editor tools, developer utilities, and build tooling commands.

**Prerequisites**: Chapter 4 (Map), Chapter 5 (UI), Chapter 8-11 (gameplay systems)

#### Phase A: Map Editor

| # | OpenRA Source | Target TypeScript File | Complexity |
|:---:|:---|:---|:---:|
| 1+ | EditorActorLayer, EditorActorPreview, EditorActionManager, EditorCursorLayer, EditorResourceLayer, EditorViewportControllerWidget, various EditorBrushes/ | | MEDIUM-HIGH |

#### Phase B: Utility Commands

| # | OpenRA Source | Target TypeScript File | Complexity |
|:---:|:---|:---|:---:|
| 5+ | Various UtilityCommands/, DeveloperMode, MapEditorData, TilingPathTool | | LOW |

---

## 4. Dependency Graph

```
Chapters 2-7 (COMPLETE -- Foundation)
  |
  +---> Ch8: Weapons & Combat (Phase A: Warheads)
  |       |
  |       +---> Ch8: Phase B (Projectiles) + Phase C (WeaponConfig)
  |       |       |
  |       |       +---> Ch8: Phase D (Combat Traits) + Phase E (Support)
  |       |
  +---> Ch9: Unit Movement & Physics
  |       |
  |       +---> Ch10: Resource & Economy
  |       |       |
  |       |       +---> Ch11: Production & Building
  |       |
  +---> Ch12: Shroud & Fog of War
  |
  +---> Ch13: Support Powers (depends Ch8 + Ch7)
  |
  +---> Ch14: Activity Implementations (depends Ch8 + Ch9)
  |
  +---> Ch15: Order Generators (depends Ch5 + Ch8 + Ch11)
  |
  +---> Ch16: UI Widget Extensions (depends Ch5 + Ch11 + Ch12)
  |
  +---> Ch17: Replay & Save (depends Ch6)
  |
  +---> Ch18: Server (depends Ch6)
  |
  +---> Ch19: Mod-Specific C&C/D2K (depends ALL gameplay Ch8-13)
  |
  +---> Ch20: Scripting (depends Ch8-13)
  |
  +---> Ch21: Editor & Utilities (depends Ch4+Ch5+Ch8-11)
```

### Parallelization Opportunities

These chapters have NO dependency on each other and can run in parallel:

- **Track 1** (combat): Ch8 -> Ch13 -> Ch14
- **Track 2** (movement): Ch9 -> Ch10 -> Ch11 -> Ch16
- **Track 3** (systems): Ch12, Ch17, Ch18 (independent)

Chapters 19-21 are leaf nodes that can begin once their gameplay prerequisites are satisfied.

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing

All non-rendering game logic MUST have unit tests. Key test patterns:

- **Trait behavior**: Mock World + Actor + TraitDictionary. Test trait state transitions, condition toggles, order resolution.
- **Warhead effects**: Test damage calculation, damage spread, condition grants with mock Health/ExternalCondition traits.
- **Production queues**: Test queue insertion, tick progression, building placement validation, prerequisites.
- **Movement**: Test pathfinding integration, cell blocking, speed calculation, facing updates.

### 5.2 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages (per existing E2E framework):

| System | Test Page | Purpose |
|--------|-----------|---------|
| Projectile rendering | `/test/projectiles/missile/` | Verify missile trajectory, trail, impact effect |
| Shroud overlay | `/test/shroud/basic/` | Verify fog-of-war texture overlay on terrain |
| Building placement | `/test/building/placement/` | Verify ghost preview, valid/invalid highlighting |
| Unit movement | `/test/movement/patrol/` | Verify unit movement along path with facing |
| Weapon effects | `/test/weapons/explosion/` | Verify explosion particle systems, damage flash |

### 5.3 Integration Testing

- **Combat integration**: Spawn two actors with weapons, verify full combat loop (targeting -> fire -> projectile -> hit -> damage -> death)
- **Economy integration**: Harvest resource -> deliver to refinery -> cash increment -> production queue -> unit spawn
- **Complete game loop**: Start game -> build base -> produce units -> attack enemy -> victory condition check

---

## 6. Risk and Considerations

### 6.1 High-Risk Areas

| Risk | Severity | Mitigation |
|------|:---:|-----------|
| **Mobile trait complexity** (1079 lines) | HIGH | Break into smaller focused sub-modules (MobilePosition, MobileFacing, MobileMovement, MobileBlocking) |
| **Voxel rendering** (C&C TS/RA2) | HIGH | Consider deferred to post-MVP; Voxel->Mesh conversion at build time |
| **Lua scripting bridge** (10K+ lines) | HIGH | Use JSON-based trigger definitions for 80% coverage; fengari for full Lua support as stretch goal |
| **Server system in Node.js** (1594 lines) | MEDIUM | Implement core order relay first; lobby/matchmaking deferred |
| **Shroud performance** (per-frame texture update) | MEDIUM | Use GPU-driven shroud via RTT + custom ShaderMaterial; batch cell updates |
| **Cross-trait dependency chains** | MEDIUM | Incremental testing after each trait; existing Condition system from Ch3 handles runtime toggles |

### 6.2 Performance Targets

| System | Target | Measurement |
|--------|--------|-------------|
| Combat with 200 units firing | 60fps | Per-frame tick timing |
| 500+ projectiles active | 45fps | Projectile pool utilization |
| Shroud update on 256x256 map | <2ms | Texture update cost |
| Production queue with 20 items | <0.5ms tick | Queue processing time |

### 6.3 Deferred Features

| Feature | Phase | Reason |
|---------|-------|--------|
| Full Lua scripting in browser | Chapter 20 | Use JSON triggers as MVP; Lua VM adds 200KB+ bundle |
| Voxel rendering pipeline | Chapter 19 | Build-time conversion to glTF preferred if feasible |
| Map editor full feature set | Chapter 21 | Basic map viewer first; full editor post-MVP |
| WebRTC P2P networking | Chapter 18 | WebSocket client-server is sufficient for MVP |
| 4K HiDPI widget themes | Chapter 16 | Base themes sufficient; pixel-perfect polish deferred |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### Chapter 8 ADRs

**ADR-8.1: Deferred Warhead Effects**
Warhead effects are collected during `DoImpact()` and applied in `world.frameEndActions` to prevent mid-tick state mutation. This mirrors OpenRA's own frame-end-actions pattern and ensures deterministic state across network clients.

**ADR-8.2: Raycast Projectile Collision**
Projectile collision detection uses `scene.pickWithRay()` from previous-frame to current-frame position. This is a 3D replacement for OpenRA's 2D grid-based collision check. AABB pre-filtering eliminates rays that cannot possibly hit targets.

**ADR-8.3: RenderingGroupId for Combat Overlays**
Range circles, target lines, and debug overlays use `renderingGroupId=1` (between terrain=0 and units=2). This ensures they render above terrain but are properly depth-tested against units and buildings.

**ADR-8.4: BoundingBox HitShape**
HitShape maps to Babylon.js `BoundingBox` or `BoundingSphere`. Rectangular shapes (OpenRA's `Rectangle` HitShape) map to AABB; circular shapes map to BoundingSphere. Per OpenRA convention, shape dimensions are defined in WDist units and converted via CoordinateTransformer.

### Chapter 9 ADRs

**ADR-9.1: TransformNode as Position Authority**
Mobile trait is the ground truth for actor world position. `Mobile.CenterPosition` maps to `TransformNode.position` with the Z/Y axis swap (WPos Z = height -> TransformNode Y). Visual interpolation between tick positions happens in `scene.onBeforeRenderObservable` for smooth movement at variable framerate.

**ADR-9.2: Pathfinding Integration**
Movement blocking reuses Chapter 4 Phase G's `BlockedByActor` flags and `DensePathGraph`/`MapPathGraph` cost functions. Mobile.CanEnterCell() queries the path graph for cell traversability, respecting custom movement layers (subterranean, jumpjet, tunnel).

### Chapter 12 ADRs

**ADR-12.1: RTT Fog-of-War Layer**
Shroud uses a RenderTargetTexture rendered as an overlay quad above the terrain. Visibility data is stored as a per-cell bitfield Uint8Array. The RTT shader blends between revealed/explored/hidden states using a 3-way mix controlled by the visibility bitfield texture.

**ADR-12.2: FrozenActor Rendering**
Frozen actors (last-known enemy position under fog) are rendered as static colored billboard sprites with reduced opacity (alpha=0.5). The frozen actor layer is per-player and updates when enemy actors leave the visible area.

### Chapter 15 ADRs

**ADR-15.1: OrderGenerator as Command Pattern**
Order generators implement the Command pattern: `GetCursor()` returns the current cursor state, `GetOverrideCursor()` handles modifier keys, `Order()` converts a click target into `Order` objects. The generator lifecycle (activation/deactivation) is managed by `WorldInteractionControllerWidget`.

### Chapter 18 ADRs

**ADR-18.1: Node.js Game Server**
The dedicated server runs in Node.js using the `ws` WebSocket library. Order broadcasting, sync hash verification, and frame timing are identical to the C# OpenRA.Server implementation. Client connections use WebSocket (WSS for production).

**ADR-18.2: Web Worker Hosted Server**
For peer-hosted games (no dedicated server), the server logic can run in a Web Worker within the host player's browser tab. This eliminates server costs for small games while maintaining the same network protocol.

### Chapter 19 ADRs

**ADR-19.1: Voxel Build-Time Conversion**
C&C Tiberian Sun / Red Alert 2 voxel models are converted from `.vxl` format to glTF (`.glb`) at build time using a Node.js tool. Runtime voxel rendering is not implemented; all models are pre-converted static meshes. Animated voxel parts (turrets) are separate mesh nodes with rotation animation.

**ADR-19.2: Mod-Specific Code Lazy Loading**
Mod-specific traits are loaded via dynamic `import()` based on the active mod manifest. The base game bundle contains only OpenRA.Mods.Common traits. C&C or D2K traits are fetched as separate chunks, ensuring minimal initial load for players not using those mods.

### Chapter 20 ADRs

**ADR-20.1: Dual Scripting Strategy**
Mission scripting supports two tiers: (1) JSON-based trigger definitions that cover common mission patterns without a Lua VM, and (2) optional `fengari` Lua VM for full Lua compatibility with existing OpenRA mission scripts. Tier 1 is the MVP target; Tier 2 is a stretch goal.

**ADR-20.2: Build-Time Lua Precompilation**
Where possible, Lua mission scripts are precompiled to JSON trigger definitions at build time. Only scripts with complex logic (loops, custom functions) require runtime Lua interpretation.

---

## Summary: Migration Order Recommendation

**Phase 1 (Core Gameplay -- highest priority)**:
- Chapter 8: Weapons & Combat (~16 weeks)
- Chapter 9: Unit Movement & Physics (~6 weeks) -- **COMPLETE (2026-06-13)**
- Chapter 10: Resource & Economy (~3 weeks)

**Phase 2 (Game Loop Completion)**:
- Chapter 11: Production & Building (~6 weeks)
- Chapter 14: Activity Implementations (~6 weeks)
- Chapter 12: Shroud & Fog of War (~4 weeks)

**Phase 3 (Extended Features)**:
- Chapter 13: Support Powers (~3 weeks) -- **COMPLETE (2026-06-15)**
- Chapter 15: Order Generators (~2 weeks)
- Chapter 17: Replay & Save (~2 weeks)

**Phase 4 (Polish & Mod Support)**:
- Chapter 16: UI Widget Extensions (~6 weeks)
- Chapter 18: Server System (~4 weeks)
- Chapter 19: Mod-Specific Content (~6 weeks)

**Phase 5 (Stretch Goals)**:
- Chapter 20: Scripting System (~4 weeks)
- Chapter 21: Editor & Utilities (~4 weeks)

**Total estimated effort**: ~72 weeks (single developer) or ~20-24 weeks (3-4 developers with parallel tracks)
