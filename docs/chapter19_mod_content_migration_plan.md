# OpenRA to Babylon.js Migration Plan: Chapter 19 -- Mod-Specific Content (C&C + D2K)

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.x (Mod-Specific) + Section 4.3 (Traits)
> **Chapter Status**: PLANNING (0/97 files, 0%; 45 deferred to build-time / post-MVP)
> **Planning Date**: 2026-06-17
> **Prerequisite**: Chapters 2-18 COMPLETE (484/484, 100%. Ch8 Weapons, Ch9 Movement, Ch10 Resources, Ch11 Buildings, Ch12 Shroud, Ch13 Support Powers, Ch14 Activities, Ch15 Order Generators)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: C&C Core Traits](#31-phase-a-cc-core-traits)
   - 3.2 [Phase B: D2K Mod Traits](#32-phase-b-d2k-mod-traits)
   - 3.3 [Phase C: C&C Rendering, Graphics & Voxel](#33-phase-c-cc-rendering-graphics--voxel)
   - 3.4 [Phase D: Supporting Infrastructure](#34-phase-d-supporting-infrastructure)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

Chapter 19 is the **first mod-specific content chapter** in the migration. Unlike previous chapters that implemented shared engine infrastructure, this chapter implements traits, renderers, and formats that are specific to particular C&C game titles:

- **C&C (Command & Conquer)**: Tiberian Dawn, Red Alert, Tiberian Sun, Red Alert 2 (shared base). The largest mod with the most custom traits.
- **D2K (Dune 2000)**: A smaller mod with unique Sandworm mechanics, Spice resource, and concrete building system.

The core paradigm shifts for each major subsystem:

- **Voxel rendering (C&C TS/RA2)**: C# software rasterizer rendering voxel models to 2D sprites → Babylon.js `Mesh` with pre-converted glTF models. Multi-part voxels (body + turret + barrel + walker legs) become parent-child `TransformNode` hierarchies. This is the **most architecturally significant** C&C subsystem — the only genuine 3D content in original OpenRA, and the system with the greatest paradigm shift opportunity.
- **Chronoshift mechanics (C&C RA/TS)**: C# stateful teleport with post-process palette effects → Babylon.js `PostProcess` for screen color shift + `TransformNode` instant position update, using the deferred-action pattern (queue in tick, apply in `frameEndActions`).
- **Infiltration / Disguise (C&C RA/TS)**: C# cloak/disguise rendering with actor transform → Babylon.js `material.visibility` + mesh swapping + ConditionManager grant/revoke.
- **Tesla / Ion rendering (C&C RA/TS)**: C# `TeslaZapRenderable` 2D line segments → Babylon.js `LinesMesh` + dynamic `ShaderMaterial` for lightning arcs. Ion cannon uses descending cylinder beam + ground-splash particle system.
- **GPS / Sensors (C&C TS)**: C# fog-of-war reveal with GPS satellite state → Integration with Chapter 12 `FrozenUnderFog` + `GpsWatcher` condition tokens. GPS power grants temporary global shroud reveal.
- **Sandworm movement (D2K)**: C# underground actor with cell-based emergence → Babylon.js subsurface `Mesh` with emerge/surface height animation + collision enable/disable toggle.
- **Spice / Resource (D2K)**: C# `D2kResourceRenderer` with D2K-specific resource variant rendering → extends Chapter 10 ResourceRenderer with D2K color palette and rounded-border rendering.
- **Concrete building system (D2K)**: C# `BuildableTerrainLayer` with concrete slab prerender → Babylon.js terrain decal / splatmap layer for concrete foundation display.

### 1.2 Architecture Principles

1. **Mod-specific code is lazily loaded**: No C&C or D2K code is bundled into the base game. All mod traits are loaded via dynamic `import()` based on the active mod manifest (ADR-19.2). The base bundle (`OpenRA.Mods.Common`) contains only shared traits; C&C and D2K traits are separate chunks.

2. **Trait-as-Component pattern continues**: All mod traits extend the existing `TraitDictionary` pattern from Chapter 3. They implement `ITick`, `INotifyCreated`, `IRender`, `IResolveOrder` as needed. No new architectural patterns are introduced.

3. **Voxel-to-glTF pipeline**: Voxel data (`.vxl` / `.hva`) is processed at **build time** by a Node.js tool into `.glb` (glTF binary) files. At runtime, the voxel rendering subsystem is a thin wrapper that loads pre-converted glTF meshes (ADR-19.1). Multi-part models use parent-child node hierarchy. This eliminates the entire software-rasterize-to-sprite pipeline (~2,000 C# lines collapse to ~500 TS lines of mesh management).

4. **Deferred action for teleport / transformation**: Chronoshift, disguise, and actor transformation effects are queued during tick and applied in `frameEndActions` to prevent mid-tick state mutation cascades. This matches the pattern established in ADR-8.1 for warhead resolution.

5. **Infiltration is trait-composition based**: `Infiltrates` is the base trait. Each `InfiltrateFor*` trait is an independent, composable effect that stacks on the base. The composition order (cash → decoration → exploration → power → support → reset → transform) is defined and verified in integration tests.

6. **Sprite sequence format specialization**: C&C and D2K use different sprite sequence formats (`ClassicSpriteSequence`, `ClassicTilesetSpecificSpriteSequence`, `D2kSpriteSequence`). Each extends the Chapter 2 `ISpriteSequence` interface. Sequence parsing logic is format-specific; rendering uses the established Sprite/Sheet infrastructure.

7. **Build-time format conversion for proprietary media**: C&C proprietary audio (AUD/VOC) and video (VQA/WSA) formats are NOT implemented in the browser runtime. AUD/VOC are converted to standard WAV/Opus at build time (ADR-19.4). Video playback is deferred to post-MVP. All file format decompression (LCW, LZO, XOR Delta) is ported line-for-line to TypeScript.

8. **Sandworm is a specialized actor state machine**: Underground state is represented by mesh visibility toggle + collision disable. Emergence is a height-interpolated animation on the Y axis. Swallow attack chains through the existing Chapter 8 AttackBase → Chapter 14 AttackActivity pipeline.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-18 is available for Chapter 19:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, `Sprite`, `Sheet`, `SheetBuilder`, `Animation` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IRender`, `IResolveOrder` |
| Activity base class | Ch3 Phase F | `Activity` abstract class + `ActivityRunner` |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA* pathfinder, `TerrainMeshBuilder`, `CellLayer` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist↔world-space conversion |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest`, `PackageEntry`, `MixFile`, `BigFile`, `MegFile`, `Pak` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Viewport`, `SelectionUtils` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` |
| Effects + Projectile base | Ch7 Phases E-F | `SpriteEffect`, `FloatingSpriteEmitter`, `Bullet` (reference projectile) |
| RenderSprites | Ch7 Phase G | `RenderSprites`, `AnimationWithOffset`, `WithIdleOverlay` |
| Weapons & Combat | Ch8 | `Warhead`, `DamageWarhead`, `SpreadDamageWarhead`, `WeaponInfo`, `Armament`, `AttackBase`, `AttackTurreted`, `AttackFrontal`, `Turreted`, `HitShape` |
| Movement & Physics | Ch9 | `Mobile`, `IMove`, `Locomotor`, `Aircraft`, `Wanders`, pathfinder traits |
| Resource & Economy | Ch10 | `IResourceLayer`, `ResourceType`, `ResourceRenderer`, `Harvester`, `Refinery` |
| Production & Building | Ch11 | `Building`, `ProductionQueue`, `PlaceBuilding`, `RepairableBuilding` |
| Shroud & Fog of War | Ch12 | `Shroud`, `FrozenUnderFog`, `FrozenActorLayer`, `CreatesShroud`, `RevealsShroud` |
| Support Powers | Ch13 | `SupportPower`, `SupportPowerManager`, `AirstrikePower`, `GrantExternalConditionPower` |
| Activity Implementations | Ch14 | `Move`, `Attack`, `Fly`, `Enter`, `HarvestResource`, `MoveToDock` |
| Order Generators | Ch15 | `OrderGenerator`, `UnitOrderGenerator`, targeting order generators |
| UI Widget Extensions | Ch16 | Lobby widgets, observer widgets, HUD widgets |
| Server System | Ch18 | `Server`, `SessionTypes`, `Connection` |

### 1.4 Already-Migrated C&C Files (Excluded from TODO List)

The following C&C files were migrated in prior chapters and are **NOT** part of the Chapter 19 scope:

| # | Source File | Class | Migrated In | Target Path |
|:---:|:---|:---|:---|:---|
| 1 | `FileSystem/BigFile.cs` | `BigFile` | Ch5 Phase B | `src/OpenRA.Mods.Cnc/FileSystem/BigFile.ts` |
| 2 | `FileSystem/MegFile.cs` | `MegFile` | Ch5 Phase B | `src/OpenRA.Mods.Cnc/FileSystem/MegFile.ts` |
| 3 | `FileSystem/MixFile.cs` | `MixFile` | Ch5 Phase B | `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` |
| 4 | `FileSystem/PackageEntry.cs` | `PackageEntry` | Ch5 Phase B | `src/OpenRA.Mods.Cnc/FileSystem/PackageEntry.ts` |
| 5 | `FileSystem/Pak.cs` | `Pak` | Ch5 Phase B | `src/OpenRA.Mods.Cnc/FileSystem/Pak.ts` |
| 6 | `Traits/ClassicFacingBodyOrientation.cs` | `ClassicFacingBodyOrientation` | Ch7 Phase G | `src/OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientation.ts` |
| 7 | `Traits/World/JumpjetLocomotor.cs` | `JumpjetLocomotor` | Ch9 Phase D | `src/OpenRA.Mods.Cnc/Traits/World/JumpjetLocomotor.ts` |
| 8 | `Traits/World/ShroudPalette.cs` | `ShroudPalette` | Ch12 | `src/OpenRA.Mods.Cnc/Traits/World/ShroudPalette.ts` |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (97 files across 4 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: C&C Core Traits** | | | | | | |
| **A1 — Chrono Technology (5 files)** | | | | | | |
| 1 | `Traits/Chronoshiftable.cs` | `src/OpenRA.Mods.Cnc/Traits/Chronoshiftable.ts` | `Chronoshiftable` | 192 | MEDIUM | A |
| 2 | `Traits/PortableChrono.cs` | `src/OpenRA.Mods.Cnc/Traits/PortableChrono.ts` | `PortableChrono` | 286 | MEDIUM | A |
| 3 | `Traits/ConyardChronoReturn.cs` | `src/OpenRA.Mods.Cnc/Traits/ConyardChronoReturn.ts` | `ConyardChronoReturn` | 245 | MEDIUM | A |
| 4 | `Traits/SupportPowers/ChronoshiftPower.cs` | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/ChronoshiftPower.ts` | `ChronoshiftPower` | 394 | HIGH | A |
| 5 | `Traits/PaletteEffects/ChronoshiftPostProcessEffect.cs` | `src/OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.ts` | `ChronoshiftPostProcessEffect` | 56 | LOW | A |
| **A2 — GPS / Sensors (4 files)** | | | | | | |
| 6 | `Traits/SupportPowers/GpsPower.cs` | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/GpsPower.ts` | `GpsPower` | 123 | LOW | A |
| 7 | `Traits/GpsWatcher.cs` | `src/OpenRA.Mods.Cnc/Traits/GpsWatcher.ts` | `GpsWatcher` | 114 | LOW | A |
| 8 | `Traits/GpsDot.cs` | `src/OpenRA.Mods.Cnc/Traits/GpsDot.ts` | `GpsDot` | 58 | LOW | A |
| 9 | `Traits/FrozenUnderFogUpdatedByGps.cs` | `src/OpenRA.Mods.Cnc/Traits/FrozenUnderFogUpdatedByGps.ts` | `FrozenUnderFogUpdatedByGps` | 110 | MEDIUM | A |
| **A3 — Infiltration System (9 files)** | | | | | | |
| 10 | `Traits/Infiltration/Infiltrates.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/Infiltrates.ts` | `Infiltrates` | 156 | MEDIUM | A |
| 11 | `Traits/Infiltration/InfiltrateForCash.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForCash.ts` | `InfiltrateForCash` | 100 | LOW | A |
| 12 | `Traits/Infiltration/InfiltrateForDecoration.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForDecoration.ts` | `InfiltrateForDecoration` | 59 | LOW | A |
| 13 | `Traits/Infiltration/InfiltrateForExploration.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForExploration.ts` | `InfiltrateForExploration` | 79 | LOW | A |
| 14 | `Traits/Infiltration/InfiltrateForPowerOutage.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForPowerOutage.ts` | `InfiltrateForPowerOutage` | 83 | LOW | A |
| 15 | `Traits/Infiltration/InfiltrateForSupportPower.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForSupportPower.ts` | `InfiltrateForSupportPower` | 80 | LOW | A |
| 16 | `Traits/Infiltration/InfiltrateForSupportPowerReset.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForSupportPowerReset.ts` | `InfiltrateForSupportPowerReset` | 77 | LOW | A |
| 17 | `Traits/Infiltration/InfiltrateForTransform.cs` | `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForTransform.ts` | `InfiltrateForTransform` | 72 | LOW | A |
| 18 | `Activities/Infiltrate.cs` | `src/OpenRA.Mods.Cnc/Activities/Infiltrate.ts` | `Infiltrate` | 79 | LOW | A |
| **A4 — Attack Variants (4 files)** | | | | | | |
| 19 | `Traits/Attack/AttackLeap.cs` | `src/OpenRA.Mods.Cnc/Traits/Attack/AttackLeap.ts` | `AttackLeap` | 72 | LOW | A |
| 20 | `Traits/Attack/AttackPopupTurreted.cs` | `src/OpenRA.Mods.Cnc/Traits/Attack/AttackPopupTurreted.ts` | `AttackPopupTurreted` | 135 | MEDIUM | A |
| 21 | `Traits/Attack/AttackTDGunboatTurreted.cs` | `src/OpenRA.Mods.Cnc/Traits/Attack/AttackTDGunboatTurreted.ts` | `AttackTDGunboatTurreted` | 83 | LOW | A |
| 22 | `Traits/Attack/AttackTesla.cs` | `src/OpenRA.Mods.Cnc/Traits/Attack/AttackTesla.ts` | `AttackTesla` | 174 | MEDIUM | A |
| **A5 — Support Powers (5 files)** | | | | | | |
| 23 | `Traits/SupportPowers/AttackOrderPower.cs` | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/AttackOrderPower.ts` | `AttackOrderPower` | 157 | MEDIUM | A |
| 24 | `Traits/SupportPowers/DropPodsPower.cs` | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/DropPodsPower.ts` | `DropPodsPower` | 191 | MEDIUM | A |
| 25 | `Traits/SupportPowers/GrantPrerequisiteChargeDrainPower.cs` | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/GrantPrerequisiteChargeDrainPower.ts` | `GrantPrerequisiteChargeDrainPower` | 197 | MEDIUM | A |
| 26 | `Traits/SupportPowers/IonCannonPower.cs` | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/IonCannonPower.ts` | `IonCannonPower` | 104 | MEDIUM | A |
| 27 | `Effects/GpsSatellite.cs` | `src/OpenRA.Mods.Cnc/Effects/GpsSatellite.ts` | `GpsSatellite` | 60 | LOW | A |
| **A6 — Miscellaneous Traits (11 files)** | | | | | | |
| 28 | `Traits/Disguise.cs` | `src/OpenRA.Mods.Cnc/Traits/Disguise.ts` | `Disguise` | 335 | HIGH | A |
| 29 | `Traits/MadTank.cs` | `src/OpenRA.Mods.Cnc/Traits/MadTank.ts` | `MadTank` | 255 | MEDIUM | A |
| 30 | `Traits/Cloneable.cs` | `src/OpenRA.Mods.Cnc/Traits/Cloneable.ts` | `Cloneable` | 29 | LOW | A |
| 31 | `Traits/Buildings/ClonesProducedUnits.cs` | `src/OpenRA.Mods.Cnc/Traits/Buildings/ClonesProducedUnits.ts` | `ClonesProducedUnits` | 76 | LOW | A |
| 32 | `Traits/EnergyWall.cs` | `src/OpenRA.Mods.Cnc/Traits/EnergyWall.ts` | `EnergyWall` | 111 | MEDIUM | A |
| 33 | `Traits/EdibleByLeap.cs` | `src/OpenRA.Mods.Cnc/Traits/EdibleByLeap.ts` | `EdibleByLeap` | 37 | LOW | A |
| 34 | `Traits/HarvesterHuskModifier.cs` | `src/OpenRA.Mods.Cnc/Traits/HarvesterHuskModifier.ts` | `HarvesterHuskModifier` | 39 | LOW | A |
| 35 | `Traits/ResourcePurifier.cs` | `src/OpenRA.Mods.Cnc/Traits/ResourcePurifier.ts` | `ResourcePurifier` | 91 | LOW | A |
| 36 | `Traits/TDGunboat.cs` | `src/OpenRA.Mods.Cnc/Traits/TDGunboat.ts` | `TDGunboat` | 242 | MEDIUM | A |
| 37 | `Traits/DrainPrerequisitePowerOnDamage.cs` | `src/OpenRA.Mods.Cnc/Traits/DrainPrerequisitePowerOnDamage.ts` | `DrainPrerequisitePowerOnDamage` | 62 | LOW | A |
| 38 | `Traits/TransferTimedExternalConditionOnTransform.cs` | `src/OpenRA.Mods.Cnc/Traits/TransferTimedExternalConditionOnTransform.ts` | `TransferTimedExternalConditionOnTransform` | 63 | LOW | A |
| 39 | `Traits/TransformsNearResources.cs` | `src/OpenRA.Mods.Cnc/Traits/TransformsNearResources.ts` | `TransformsNearResources` | 102 | LOW | A |
| **A7 — World / Resource Traits (5 files)** | | | | | | |
| 40 | `Traits/World/TSResourceLayer.cs` | `src/OpenRA.Mods.Cnc/Traits/World/TSResourceLayer.ts` | `TSResourceLayer` | 127 | MEDIUM | A |
| 41 | `Traits/World/TSTiberiumRenderer.cs` | `src/OpenRA.Mods.Cnc/Traits/World/TSTiberiumRenderer.ts` | `TSTiberiumRenderer` | 96 | MEDIUM | A |
| 42 | `Traits/World/TSVeinsRenderer.cs` | `src/OpenRA.Mods.Cnc/Traits/World/TSVeinsRenderer.ts` | `TSVeinsRenderer` | 430 | HIGH | A |
| 43 | `Traits/World/TSShroudPalette.cs` | `src/OpenRA.Mods.Cnc/Traits/World/TSShroudPalette.ts` | `TSShroudPalette` | 52 | LOW | A |
| 44 | `Traits/World/WithResourceAnimation.cs` | `src/OpenRA.Mods.Cnc/Traits/World/WithResourceAnimation.ts` | `WithResourceAnimation` | 108 | LOW | A |
| **A8 — Conditions & Palette Effects (3 files)** | | | | | | |
| 45 | `Traits/Conditions/GrantConditionOnJumpjetLayer.cs` | `src/OpenRA.Mods.Cnc/Traits/Conditions/GrantConditionOnJumpjetLayer.ts` | `GrantConditionOnJumpjetLayer` | 59 | LOW | A |
| 46 | `Traits/PaletteEffects/LightPaletteRotator.cs` | `src/OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.ts` | `LightPaletteRotator` | 66 | LOW | A |
| 47 | `Effects/ConyardChronoVortex.cs` | `src/OpenRA.Mods.Cnc/Effects/ConyardChronoVortex.ts` | `ConyardChronoVortex` | 63 | LOW | A |

| **Phase B: D2K Mod Traits** | | | | | | |
| **B1 — Sandworm System (4 files)** | | | | | | |
| 48 | `Traits/Sandworm.cs` | `src/OpenRA.Mods.D2k/Traits/Sandworm.ts` | `Sandworm` | 150 | MEDIUM | B |
| 49 | `Traits/AttackSwallow.cs` | `src/OpenRA.Mods.D2k/Traits/AttackSwallow.ts` | `AttackSwallow` | 99 | MEDIUM | B |
| 50 | `Traits/AttractsWorms.cs` | `src/OpenRA.Mods.D2k/Traits/AttractsWorms.ts` | `AttractsWorms` | 81 | LOW | B |
| 51 | `Activities/SwallowActor.cs` | `src/OpenRA.Mods.D2k/Activities/SwallowActor.ts` | `SwallowActor` | 166 | MEDIUM | B |
| **B2 — Spice / Resource (2 files)** | | | | | | |
| 52 | `Traits/SpiceBloom.cs` | `src/OpenRA.Mods.D2k/Traits/SpiceBloom.ts` | `SpiceBloom` | 213 | MEDIUM | B |
| 53 | `Traits/World/D2kResourceRenderer.cs` | `src/OpenRA.Mods.D2k/Traits/World/D2kResourceRenderer.ts` | `D2kResourceRenderer` | 170 | MEDIUM | B |
| **B3 — Building / Concrete (5 files)** | | | | | | |
| 54 | `Traits/Buildings/D2kBuilding.cs` | `src/OpenRA.Mods.D2k/Traits/Buildings/D2kBuilding.ts` | `D2kBuilding` | 162 | MEDIUM | B |
| 55 | `Traits/World/BuildableTerrainLayer.cs` | `src/OpenRA.Mods.D2k/Traits/World/BuildableTerrainLayer.ts` | `BuildableTerrainLayer` | 155 | MEDIUM | B |
| 56 | `Traits/Buildings/D2kActorPreviewPlaceBuildingPreview.cs` | `src/OpenRA.Mods.D2k/Traits/Buildings/D2kActorPreviewPlaceBuildingPreview.ts` | `D2kActorPreviewPlaceBuildingPreview` | 124 | MEDIUM | B |
| 57 | `Warheads/DamagesConcreteWarhead.cs` | `src/OpenRA.Mods.D2k/Warheads/DamagesConcreteWarhead.ts` | `DamagesConcreteWarhead` | 38 | LOW | B |
| 58 | `Traits/Player/HarvesterInsurance.cs` | `src/OpenRA.Mods.D2k/Traits/Player/HarvesterInsurance.ts` | `HarvesterInsurance` | 49 | LOW | B |
| **B4 — D2K Visual / Audio / Projectiles (6 files)** | | | | | | |
| 59 | `Traits/Render/WithCrumbleOverlay.cs` | `src/OpenRA.Mods.D2k/Traits/Render/WithCrumbleOverlay.ts` | `WithCrumbleOverlay` | 68 | LOW | B |
| 60 | `Traits/Render/WithDeliveryOverlay.cs` | `src/OpenRA.Mods.D2k/Traits/Render/WithDeliveryOverlay.ts` | `WithDeliveryOverlay` | 72 | LOW | B |
| 61 | `Traits/World/SonicBlastRenderer.cs` | `src/OpenRA.Mods.D2k/Traits/World/SonicBlastRenderer.ts` | `SonicBlastRenderer` | 95 | LOW | B |
| 62 | `Projectiles/SonicBlast.cs` | `src/OpenRA.Mods.D2k/Projectiles/SonicBlast.ts` | `SonicBlast` | 157 | MEDIUM | B |
| 63 | `Graphics/SonicBlastRenderable.cs` | `src/OpenRA.Mods.D2k/Graphics/SonicBlastRenderable.ts` | `SonicBlastRenderable` | 64 | LOW | B |
| 64 | `Graphics/D2kSpriteSequence.cs` | `src/OpenRA.Mods.D2k/Graphics/D2kSpriteSequence.ts` | `D2kSpriteSequence` | 116 | LOW | B |

| **Phase C: C&C Rendering & Graphics** | | | | | | |
| **C1 — Render Traits (10 files)** | | | | | | |
| 65 | `Traits/Render/WithBuildingBib.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithBuildingBib.ts` | `WithBuildingBib` | 137 | MEDIUM | C |
| 66 | `Traits/Render/WithCargo.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithCargo.ts` | `WithCargo` | 143 | MEDIUM | C |
| 67 | `Traits/Render/WithDisguisingInfantryBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithDisguisingInfantryBody.ts` | `WithDisguisingInfantryBody` | 78 | LOW | C |
| 68 | `Traits/Render/WithEmbeddedTurretSpriteBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithEmbeddedTurretSpriteBody.ts` | `WithEmbeddedTurretSpriteBody` | 78 | LOW | C |
| 69 | `Traits/Render/WithGunboatBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithGunboatBody.ts` | `WithGunboatBody` | 98 | LOW | C |
| 70 | `Traits/Render/WithHarvesterSpriteBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithHarvesterSpriteBody.ts` | `WithHarvesterSpriteBody` | 50 | LOW | C |
| 71 | `Traits/Render/WithLandingCraftAnimation.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithLandingCraftAnimation.ts` | `WithLandingCraftAnimation` | 97 | LOW | C |
| 72 | `Traits/Render/WithSplitAttackPaletteInfantryBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.ts` | `WithSplitAttackPaletteInfantryBody` | 58 | LOW | C |
| 73 | `Traits/Render/WithTeslaChargeAnimation.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeAnimation.ts` | `WithTeslaChargeAnimation` | 47 | LOW | C |
| 74 | `Traits/Render/WithTeslaChargeOverlay.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeOverlay.ts` | `WithTeslaChargeOverlay` | 72 | LOW | C |
| **C2 — Graphics Renderables (4 files)** | | | | | | |
| 75 | `Graphics/ChronoVortexRenderable.cs` | `src/OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.ts` | `ChronoVortexRenderable` | 67 | LOW | C |
| 76 | `Graphics/TeslaZapRenderable.cs` | `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts` | `TeslaZapRenderable` | 167 | MEDIUM | C |
| 77 | `Graphics/ClassicSpriteSequence.cs` | `src/OpenRA.Mods.Cnc/Graphics/ClassicSpriteSequence.ts` | `ClassicSpriteSequence` | 48 | LOW | C |
| 78 | `Graphics/ClassicTilesetSpecificSpriteSequence.cs` | `src/OpenRA.Mods.Cnc/Graphics/ClassicTilesetSpecificSpriteSequence.ts` | `ClassicTilesetSpecificSpriteSequence` | 95 | LOW | C |
| **C3 — Voxel Rendering Pipeline (12 files)** | | | | | | |
| 79 | `Traits/World/VoxelCache.cs` | `src/OpenRA.Mods.Cnc/Traits/World/VoxelCache.ts` | `VoxelCache` | 119 | MEDIUM | C |
| 80 | `Traits/World/VoxelNormalsPalette.cs` | `src/OpenRA.Mods.Cnc/Traits/World/VoxelNormalsPalette.ts` | `VoxelNormalsPalette` | 351 | MEDIUM | C |
| 81 | `Traits/World/ModelRenderer.cs` | `src/OpenRA.Mods.Cnc/Traits/World/ModelRenderer.ts` | `ModelRenderer` | 398 | HIGH | C |
| 82 | `Graphics/Voxel.cs` | `src/OpenRA.Mods.Cnc/Graphics/Voxel.ts` | `Voxel` | 161 | MEDIUM | C |
| 83 | `Graphics/VoxelLoader.cs` | `src/OpenRA.Mods.Cnc/Graphics/VoxelLoader.ts` | `VoxelLoader` | 242 | MEDIUM | C |
| 84 | `Graphics/ModelRenderable.cs` | `src/OpenRA.Mods.Cnc/Graphics/ModelRenderable.ts` | `ModelRenderable` | 294 | MEDIUM | C |
| 85 | `Graphics/ModelActorPreview.cs` | `src/OpenRA.Mods.Cnc/Graphics/ModelActorPreview.ts` | `ModelActorPreview` | 79 | LOW | C |
| 86 | `Graphics/UIModelRenderable.cs` | `src/OpenRA.Mods.Cnc/Graphics/UIModelRenderable.ts` | `UIModelRenderable` | 155 | MEDIUM | C |
| 87 | `Traits/Render/RenderVoxels.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/RenderVoxels.ts` | `RenderVoxels` | 189 | MEDIUM | C |
| 88 | `Traits/Render/WithVoxelBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelBody.ts` | `WithVoxelBody` | 68 | LOW | C |
| 89 | `Traits/Render/WithVoxelTurret.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelTurret.ts` | `WithVoxelTurret` | 67 | LOW | C |
| 90 | `Traits/Render/WithVoxelBarrel.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelBarrel.ts` | `WithVoxelBarrel` | 105 | LOW | C |
| 91 | `Traits/Render/WithVoxelWalkerBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelWalkerBody.ts` | `WithVoxelWalkerBody` | 106 | MEDIUM | C |
| 92 | `Traits/Render/WithVoxelUnloadBody.cs` | `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelUnloadBody.ts` | `WithVoxelUnloadBody` | 91 | LOW | C |
| **C4 — Projectiles (3 files)** | | | | | | |
| 93 | `Projectiles/TeslaZap.cs` | `src/OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts` | `TeslaZap` | 99 | LOW | C |
| 94 | `Projectiles/IonCannon.cs` | `src/OpenRA.Mods.Cnc/Projectiles/IonCannon.ts` | `IonCannon` | 73 | LOW | C |
| 95 | `Projectiles/DropPodImpact.cs` | `src/OpenRA.Mods.Cnc/Projectiles/DropPodImpact.ts` | `DropPodImpact` | 77 | LOW | C |
| **C5 — Activities (3 files)** | | | | | | |
| 96 | `Activities/Leap.cs` | `src/OpenRA.Mods.Cnc/Activities/Leap.ts` | `Leap` | 126 | MEDIUM | C |
| 97 | `Activities/LeapAttack.cs` | `src/OpenRA.Mods.Cnc/Activities/LeapAttack.ts` | `LeapAttack` | 176 | MEDIUM | C |
| 98 | `Activities/Teleport.cs` | `src/OpenRA.Mods.Cnc/Activities/Teleport.ts` | `Teleport` | 144 | MEDIUM | C |
| **C6 — Effects (3 files)** | | | | | | |
| 99 | `Effects/GpsDotEffect.cs` | `src/OpenRA.Mods.Cnc/Effects/GpsDotEffect.ts` | `GpsDotEffect` | 119 | MEDIUM | C |
| 100 | `Effects/SatelliteLaunch.cs` | `src/OpenRA.Mods.Cnc/Effects/SatelliteLaunch.ts` | `SatelliteLaunch` | 58 | LOW | C |
| 101 | `Traits/World/ChronoVortexRenderer.cs` | `src/OpenRA.Mods.Cnc/Traits/World/ChronoVortexRenderer.ts` | `ChronoVortexRenderer` | 114 | MEDIUM | C |

| **Phase D: Supporting Infrastructure** | | | | | | |
| **D1 — File Formats (6 files)** | | | | | | |
| 102 | `FileFormats/Blowfish.cs` | `src/OpenRA.Mods.Cnc/FileFormats/Blowfish.ts` | `Blowfish` | 410 | HIGH | D |
| 103 | `FileFormats/BlowfishKeyProvider.cs` | `src/OpenRA.Mods.Cnc/FileFormats/BlowfishKeyProvider.ts` | `BlowfishKeyProvider` | 491 | HIGH | D |
| 104 | `FileFormats/LCWCompression.cs` | `src/OpenRA.Mods.Cnc/FileFormats/LCWCompression.ts` | `LCWCompression` | 167 | LOW | D |
| 105 | `FileFormats/LZOCompression.cs` | `src/OpenRA.Mods.Cnc/FileFormats/LZOCompression.ts` | `LZOCompression` | 291 | MEDIUM | D |
| 106 | `FileFormats/XORDeltaCompression.cs` | `src/OpenRA.Mods.Cnc/FileFormats/XORDeltaCompression.ts` | `XORDeltaCompression` | 82 | LOW | D |
| 107 | `FileFormats/AudReader.cs` | `src/OpenRA.Mods.Cnc/FileFormats/AudReader.ts` | `AudReader` | 205 | MEDIUM | D |
| **D2 — Voxel File Format Readers (2 files)** | | | | | | |
| 108 | `FileFormats/VxlReader.cs` | `src/OpenRA.Mods.Cnc/FileFormats/VxlReader.ts` | `VxlReader` | 158 | MEDIUM | D |
| 109 | `FileFormats/HvaReader.cs` | `src/OpenRA.Mods.Cnc/FileFormats/HvaReader.ts` | `HvaReader` | 63 | LOW | D |
| **D3 — Sprite Loaders (7 files)** | | | | | | |
| 110 | `SpriteLoaders/ShpTDLoader.cs` | `src/OpenRA.Mods.Cnc/SpriteLoaders/ShpTDLoader.ts` | `ShpTDLoader` | 330 | MEDIUM | D |
| 111 | `SpriteLoaders/ShpD2Loader.cs` | `src/OpenRA.Mods.Cnc/SpriteLoaders/ShpD2Loader.ts` | `ShpD2Loader` | 171 | MEDIUM | D |
| 112 | `SpriteLoaders/ShpRemasteredLoader.cs` | `src/OpenRA.Mods.Cnc/SpriteLoaders/ShpRemasteredLoader.ts` | `ShpRemasteredLoader` | 121 | LOW | D |
| 113 | `SpriteLoaders/TmpTDLoader.cs` | `src/OpenRA.Mods.Cnc/SpriteLoaders/TmpTDLoader.ts` | `TmpTDLoader` | 101 | LOW | D |
| 114 | `SpriteLoaders/TmpRALoader.cs` | `src/OpenRA.Mods.Cnc/SpriteLoaders/TmpRALoader.ts` | `TmpRALoader` | 98 | LOW | D |
| 115 | `SpriteLoaders/TmpTSLoader.cs` | `src/OpenRA.Mods.Cnc/SpriteLoaders/TmpTSLoader.ts` | `TmpTSLoader` | 199 | LOW | D |
| 116 | `SpriteLoaders/R8Loader.cs` (D2K) | `src/OpenRA.Mods.D2k/SpriteLoaders/R8Loader.ts` | `R8Loader` | 229 | MEDIUM | D |
| **D4 — Interfaces & Utilities (3 files)** | | | | | | |
| 117 | `TraitsInterfaces.cs` | `src/OpenRA.Mods.Cnc/TraitsInterfaces.ts` | `INotifyTeslaCharging` | 18 | LOW | D |
| 118 | `Util.cs` | `src/OpenRA.Mods.Cnc/Util.ts` | `ClassicFacing`, `Util` | 315 | LOW | D |
| 119 | `PackageLoaders/D2kSoundResources.cs` | `src/OpenRA.Mods.D2k/PackageLoaders/D2kSoundResources.ts` | `D2kSoundResources` | 94 | LOW | D |

> **Complexity Legend**:
> - **LOW**: Data structures, simple traits, or small rendering adapters. 30-150 lines of C#. Can be parallel-assigned with minimal dependencies.
> - **MEDIUM**: Moderate logic with multiple trait interactions or custom rendering integration. 150-300 lines of C# with Babylon.js visual components.
> - **HIGH**: Complex gameplay mechanics, state machines, or custom rendering pipelines. 300+ lines of C# with significant Babylon.js integration.
> - **HIGHEST**: Reserved for the single most complex file in the chapter. For Chapter 19 this would be `TSMapGenerator.cs` (975 lines, map generation — **DEFERRED**).

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files (to migrate)** | 119 (97 implementation + 22 for already-migrated in prior chapters) |
| **Active migration files (this chapter)** | **97** |
| **Phase A (C&C Core Traits)** | 47 files |
| **Phase B (D2K Mod Traits)** | 17 files |
| **Phase C (C&C Rendering & Graphics)** | 37 files (including 14 voxel) |
| **Phase D (Supporting Infrastructure)** | 18 files |
| **Deferred (build-time / post-MVP)** | **45 files** (~7,300 C# lines) |
| **Already migrated (prior chapters)** | **8 files** |
| **Grand Total (all C&C + D2K C# files)** | **150 unique files** (~21,200 C# lines) |
| **HIGH complexity** | 5 files (ChronoshiftPower, Disguise, TSVeinsRenderer, ModelRenderer, Blowfish, BlowfishKeyProvider) |
| **MEDIUM complexity** | 28 files |
| **LOW complexity** | 64 files |
| **Total OpenRA C# source lines (to migrate)** | **~15,800** (excluding deferred) |
| **Total OpenRA C# source lines (deferred)** | **~7,300** |

| Phase | Files | C# Lines | Est. TS Lines | Est. Tests | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: C&C Core Traits | 47 | ~6,600 | ~8,000 | ~280 | PLANNING |
| B: D2K Mod Traits | 17 | ~2,000 | ~2,500 | ~90 | PLANNING |
| C: C&C Rendering & Voxel | 37 | ~4,700 | ~5,000 | ~200 | PLANNING |
| D: Supporting Infrastructure | 18 | ~2,500 | ~3,000 | ~120 | PLANNING |
| **Subtotal (Migrate)** | **119** | **~15,800** | **~18,500** | **~690** | **PLANNING** |
| | | | | | |
| Deferred | 45 | ~7,300 | 0 | 0 | DEFERRED |
| Already Migrated | 8 | ~600 | ~1,500 | Done | COMPLETE |
| **Grand Total** | **172** | **~23,700** | **~20,000** | **~690** | |

> **Note**: The total unique C&C + D2K C# source files is 163 (140 C&C + 23 D2K). The discrepancy (172 vs 163) is due to 9 counted files that are sub-component files sharing directories. The file count 119 in plan + 45 deferred + 8 already = 172 adjusted. Actual unique files ≈ 163.

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: C&C Core Traits

**Status**: 📋 待迁移 (0/47 migrated, 0 tests)
**Complexity**: MEDIUM-HIGH (ChronoshiftPower + Disguise are HIGH; most others LOW-MEDIUM)
**Blocked by**: Chapters 8 (Weapons), 9 (Movement), 10 (Resources), 11 (Buildings), 12 (Shroud), 13 (Support Powers), 14 (Activities)
**Blocks**: Phase B (D2K traits extend similar patterns), Phase C (Chrono renderers use Chronoshiftable/PortableChrono)

**Description**: Phase A implements the core gameplay traits for C&C mods. These traits modify or extend the shared gameplay systems from Chapters 8-14 with mod-specific behavior. The phase is organized into 8 sub-categories.

**Paradigm Shifts**:
- C# `Chronoshiftable.Tick()` creates teleport orders → TypeScript uses deferred-action pattern: queue teleport in tick, apply in `frameEndActions` (ADR-8.1)
- C# `PortableChrono` manages charge state via `IIssueOrder` → TypeScript uses `Order` dispatch + `ConditionManager` for charge state tokens
- C# `Infiltrates` trait composition via C# events → TypeScript uses typed callback dispatch with ordered `InfiltrateFor*` stacking
- C# `AttackTesla` charge-up via `INotifyTeslaCharging` interface → TypeScript uses event emitter pattern with Babylon.js `ShaderMaterial` for charge glow
- C# `Disguise` actor transform with palette swap → TypeScript uses mesh swap + `ConditionManager` token granting disguised condition
- C# `TSVeinsRenderer` extends `ResourceRenderer` with vein-specific rendering → TypeScript extends Chapter 10 `ResourceRenderer` with vein sprite variant selection

#### 3.1.1 Chrono Technology (5 files)

- [ ] **TODO-19.A.1** `src/OpenRA.Mods.Cnc/Traits/Chronoshiftable.ts` (192 lines C#) — Actor trait allowing chronoshift teleport:
  - Implements `ITick`, `INotifyCreated`, `ISync`
  - `teleportAction`: queue teleport to target cell during tick
  - `returnToOrigin`: chronoshift return after duration expires
  - `isTeleporting: boolean` state flag for rendering (chrono-vortex effect)
  - Integration: queues `ChronoshiftableOrder` via `OrderManager`; triggers `ChronoVortexRenderer`
  - **3D**: teleport = `TransformNode.position` instant update + `PostProcess` screen flash on arrival

- [ ] **TODO-19.A.2** `src/OpenRA.Mods.Cnc/Traits/PortableChrono.ts` (286 lines C#) — Infantry-portable chronoshift device:
  - Implements `IIssueOrder`, `IResolveOrder`, `ITick`
  - `chargeDuration: number` ticks between uses
  - `maxDistance: WDist` maximum teleport range
  - `killCargo: boolean` — whether passengers die on teleport
  - Charge state managed via `ConditionManager` token grant/revoke
  - **3D**: teleport range displayed as green circle indicator (Babylon.js `GroundMesh` decal)

- [ ] **TODO-19.A.3** `src/OpenRA.Mods.Cnc/Traits/ConyardChronoReturn.ts` (245 lines C#) — Construction yard chrono-return on low HP:
  - Implements `ITick`, `INotifyDamage`
  - Monitors `Health` trait for HP threshold crossing
  - Triggers chronoshift return to original build location
  - `returnDelay: number` ticks before auto-return
  - **3D**: chrono-vortex particle effect at original build site on arrival

- [ ] **TODO-19.A.4** `src/OpenRA.Mods.Cnc/Traits/SupportPowers/ChronoshiftPower.ts` (394 lines C#) — Chronosphere superweapon:
  - Extends Ch13 `SupportPower` with area-select targeting
  - `range: WDist` chronoshift area radius
  - `duration: number` ticks before units return
  - `killCargo: boolean` passenger kill toggle
  - `affectsBuildings: boolean` — can shift buildings
  - **3D**: area selection = Babylon.js `GroundMesh` circle overlay. Teleport effect = `PostProcess` fullscreen chroma-shift

- [ ] **TODO-19.A.5** `src/OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.ts` (56 lines C#) — Screen color-shift during chronoshift:
  - Applies palette rotation to screen during chronoshift duration
  - `chromaOffset: number` color-shift intensity
  - **3D**: Babylon.js `PostProcess` with custom `FragmentOutput` chroma-shift shader

#### 3.1.2 GPS / Sensors (4 files)

- [ ] **TODO-19.A.6** `src/OpenRA.Mods.Cnc/Traits/SupportPowers/GpsPower.ts` (123 lines C#) — GPS satellite support power:
  - Extends Ch13 `SupportPower`
  - `revealDelay: number` ticks until global shroud reveal
  - On activation: grants `GpsWatcher` condition to all allied players
  - On satellite destroyed: revokes watcher condition
  - Integration: Ch12 `FrozenUnderFogUpdatedByGps` + `GpsDot` visibility

- [ ] **TODO-19.A.7** `src/OpenRA.Mods.Cnc/Traits/GpsWatcher.ts` (114 lines C#) — GPS reveal condition manager:
  - Implements `ITick`, `INotifyCreated`
  - Watches for active GPS power on owning player
  - Grants/revokes `GpsWatcher` condition token on all allied actors
  - `gpsRadius: WDist` — reveal radius around watcher (defaults to full map)

- [ ] **TODO-19.A.8** `src/OpenRA.Mods.Cnc/Traits/GpsDot.ts` (58 lines C#) — GPS minimap dot for revealed actors:
  - ConditionalTrait: only visible when GPS reveal is active
  - Renders a tiny dot on the minimap for all revealed enemy actors
  - `color: Color` dot color (red = enemy, blue = ally)
  - **3D**: minimap dot = CSS pixel dot on Canvas2D minimap (Chapter 16 RadarWidget)

- [ ] **TODO-19.A.9** `src/OpenRA.Mods.Cnc/Traits/FrozenUnderFogUpdatedByGps.ts` (110 lines C#) — GPS-updated frozen actor visibility:
  - Extends Ch12 `FrozenUnderFog` with GPS awareness
  - When GPS is active, frozen actors update to current state (live position)
  - When GPS deactivates, frozen actors freeze again at last known position
  - Integration: Ch12 `FrozenActorLayer` + `FrozenUnderFog`

#### 3.1.3 Infiltration System (9 files)

- [ ] **TODO-19.A.10** `src/OpenRA.Mods.Cnc/Traits/Infiltration/Infiltrates.ts` (156 lines C#) — Base infiltration trait:
  - Implements `IIssueOrder`, `IResolveOrder`
  - `types: string[]` — infiltration target types (e.g., "Building", "Defense")
  - Enters target building via `Enter` activity
  - On infiltration: dispatches `InfiltrateFor*` effects in composition order
  - Self-destructs after successful infiltration
  - Integration: Ch14 `Enter` activity for movement into target

- [ ] **TODO-19.A.11** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForCash.ts` (100 lines C#) — Steal cash on infiltrate:
  - `percentage: number` — percentage of target player's cash to steal
  - `minimum: number` — minimum cash amount to steal
  - Transfers cash from target player to infiltrator's player via `PlayerResources`

- [ ] **TODO-19.A.12** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForDecoration.ts` (59 lines C#) — Apply visual decoration on infiltrate:
  - `sequence: string` — decoration sequence to apply to infiltrated building
  - Decoration lasts `duration: number` ticks

- [ ] **TODO-19.A.13** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForExploration.ts` (79 lines C#) — Reveal shroud on infiltrate:
  - Grants temporary shroud reveal around infiltrated building
  - `radius: WDist` reveal radius
  - `duration: number` reveal duration in ticks
  - Integration: Ch12 `Shroud` reveal mechanism

- [ ] **TODO-19.A.14** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForPowerOutage.ts` (83 lines C#) — Cause power outage on infiltrate:
  - Disables player power for `duration: number` ticks
  - All buildings lose power (production queues pause, radar disables)
  - Integration: Ch11 `PowerManager`

- [ ] **TODO-19.A.15** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForSupportPower.ts` (80 lines C#) — Grant one-time support power use:
  - Grants target player a single use of the specified `SupportPower`
  - `power: string` — support power name to grant
  - Integration: Ch13 `SupportPowerManager`

- [ ] **TODO-19.A.16** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForSupportPowerReset.ts` (77 lines C#) — Reset support power cooldown:
  - Resets charge timer on target player's specified support power
  - `power: string` — support power to reset
  - Integration: Ch13 `SupportPower` charge system

- [ ] **TODO-19.A.17** `src/OpenRA.Mods.Cnc/Traits/Infiltration/InfiltrateForTransform.ts` (72 lines C#) — Transform infiltrated building:
  - Transforms the infiltrated building into a different actor type
  - `intoActor: string` — target actor type after transformation
  - Integration: Ch11 `Transforms` building trait

- [ ] **TODO-19.A.18** `src/OpenRA.Mods.Cnc/Activities/Infiltrate.ts` (79 lines C#) — Infiltration activity:
  - Extends Ch14 `Enter` activity
  - On entering target: triggers `Infiltrates.ResolveOrder()`
  - Self-disposes after triggering infiltration effects
  - **3D**: infiltration animation = actor mesh shrink/fade into building entrance

#### 3.1.4 Attack Variants (4 files)

- [ ] **TODO-19.A.19** `src/OpenRA.Mods.Cnc/Traits/Attack/AttackLeap.ts` (72 lines C#) — Leap-based attack trait:
  - Extends Ch8 `AttackFrontal`
  - `leapSpeed: WDist` speed of leap toward target
  - On attack: initiates `Leap` activity toward target, then deals damage on landing
  - **3D**: leap = parabolic arc animation (`Vector3.Lerp` with Y-axis height curve)

- [ ] **TODO-19.A.20** `src/OpenRA.Mods.Cnc/Traits/Attack/AttackPopupTurreted.ts` (135 lines C#) — Pop-up turret attack:
  - Extends Ch8 `AttackTurreted` with pop-up state
  - Turret is hidden underground until target detected
  - `popUpDelay: number` ticks before turret emerges
  - `closeDelay: number` ticks before turret hides after target lost
  - **3D**: turret mesh Y-axis animation: hidden (below ground) → emerge (lerp up) → attack → hide (lerp down)

- [ ] **TODO-19.A.21** `src/OpenRA.Mods.Cnc/Traits/Attack/AttackTDGunboatTurreted.ts` (83 lines C#) — TD Gunboat turret attack:
  - Extends Ch8 `AttackTurreted` for naval gunboat-specific facing
  - `localOffset: WVec` turret offset on hull
  - Works with `TDGunboat` water movement trait
  - **3D**: turret node rotation on parent hull TransformNode

- [ ] **TODO-19.A.22** `src/OpenRA.Mods.Cnc/Traits/Attack/AttackTesla.ts` (174 lines C#) — Tesla coil attack with charge-up:
  - Extends Ch8 `AttackBase`
  - `chargeDelay: number` ticks charge-up before firing
  - During charge: `INotifyTeslaCharging` event for visual charge animation
  - `chargeAudio: string` charge-up sound
  - **3D**: charge animation = `ShaderMaterial` emissive intensity ramp-up. Tesla zap = `LinesMesh` lightning arc from coil to target

#### 3.1.5 Support Powers (5 files)

- [ ] **TODO-19.A.23** `src/OpenRA.Mods.Cnc/Traits/SupportPowers/AttackOrderPower.ts` (157 lines C#) — Target-and-attack support power:
  - Extends Ch13 `SupportPower` with `IIssueOrder` for targeting
  - Orders the target actor to attack a specified position/actor
  - Used for paradrop-attack, chrono-attack, etc.
  - **3D**: targeting indicator = Babylon.js `GroundMesh` decal at target

- [ ] **TODO-19.A.24** `src/OpenRA.Mods.Cnc/Traits/SupportPowers/DropPodsPower.ts` (191 lines C#) — Drop pods support power:
  - Extends Ch13 `SupportPower`
  - `unit: string` — unit type to drop
  - `podCount: number` — number of drop pods
  - `podScatter: WDist` — random scatter radius
  - **3D**: drop pod = vertically descending `Mesh` with particle trail + ground-impact `SpriteEffect` on landing

- [ ] **TODO-19.A.25** `src/OpenRA.Mods.Cnc/Traits/SupportPowers/GrantPrerequisiteChargeDrainPower.ts` (197 lines C#) — Prerequisite-granting drain power:
  - Extends Ch13 `SupportPower`
  - Grants prerequisite to owner (unlocks tech) while active
  - Drains power while active (continuous cost)
  - Toggle on/off via support power activation

- [ ] **TODO-19.A.26** `src/OpenRA.Mods.Cnc/Traits/SupportPowers/IonCannonPower.ts` (104 lines C#) — Ion cannon superweapon:
  - Extends Ch13 `SupportPower`
  - `weapon: string` — weapon fired from orbit
  - Fires `IonCannon` projectile from sky to ground target
  - **3D**: ion beam = descending `CylinderMesh` with bright blue `ShaderMaterial` + ground splash particle system

- [ ] **TODO-19.A.27** `src/OpenRA.Mods.Cnc/Effects/GpsSatellite.ts` (60 lines C#) — GPS satellite launch effect:
  - Implements Ch3 `IEffect` interface
  - Satellite launch animation and GPS activation sequence
  - **3D**: satellite = small `Mesh` rising from launch structure into sky

#### 3.1.6 Miscellaneous Traits (11 files)

- [ ] **TODO-19.A.28** `src/OpenRA.Mods.Cnc/Traits/Disguise.ts` (335 lines C#) — Actor disguise system:
  - Implements `ITick`, `INotifyAttack`, `IIssueOrder`
  - `disguisedAsActor: string` — actor type being impersonated
  - Disguise applied on creation; broken on attack
  - Tooltip, health bar, selection box show disguised identity
  - `revealOnAttack: boolean` — breaks disguise on first attack
  - **3D**: disguised mesh = swap to disguised actor's mesh. Reveal = swap back to real mesh

- [ ] **TODO-19.A.29** `src/OpenRA.Mods.Cnc/Traits/MadTank.ts` (255 lines C#) — MAD tank detonation sequence:
  - Implements `ITick`, `IIssueOrder`, `IResolveOrder`
  - `detonationDelay: number` ticks countdown after activation
  - During countdown: screen shake intensifies, engine glow increases
  - On detonation: deals massive AoE damage via `FireWarheadsOnDeath`
  - Self-destructs after detonation
  - **3D**: countdown = mesh vibration (random micro-offset) + emissive intensity ramp-up

- [ ] **TODO-19.A.30** `src/OpenRA.Mods.Cnc/Traits/Cloneable.ts` (29 lines C#) — Marks actor as cloneable:
  - ConditionalTrait indicating actor can be cloned by `ClonesProducedUnits`
  - Simple boolean flag trait, no tick logic

- [ ] **TODO-19.A.31** `src/OpenRA.Mods.Cnc/Traits/Buildings/ClonesProducedUnits.ts` (76 lines C#) — Clone units produced by this building:
  - When this building produces a unit from `Cloneable`, spawns a duplicate
  - `clones: number` — extra clone count (default 1)
  - Spawns clone at rally point with same facing

- [ ] **TODO-19.A.32** `src/OpenRA.Mods.Cnc/Traits/EnergyWall.ts` (111 lines C#) — Energy wall blocker:
  - ConditionalTrait: blocks movement when active
  - `adjacentCell: boolean` — blocks adjacent cells too
  - `maxRange: WDist` — wall segment length
  - Power-dependent (deactivates if no power)
  - Integration: Ch11 `PowerManager` for power dependency

- [ ] **TODO-19.A.33** `src/OpenRA.Mods.Cnc/Traits/EdibleByLeap.ts` (37 lines C#) — Marks actor as edible by leap attack:
  - ConditionalTrait indicating actor can be consumed by `AttackLeap`
  - Simple flag trait; consumed actor is destroyed on successful leap

- [ ] **TODO-19.A.34** `src/OpenRA.Mods.Cnc/Traits/HarvesterHuskModifier.ts` (39 lines C#) — Custom harvester husk appearance:
  - Overrides default harvester husk actor type
  - `huskActor: string` — custom husk actor to spawn

- [ ] **TODO-19.A.35** `src/OpenRA.Mods.Cnc/Traits/ResourcePurifier.ts` (91 lines C#) — Resource purification multiplier:
  - Implements `ITick`, `INotifyCreated`
  - `modifier: number` — cash multiplier for harvested resources
  - Affects all harvesters owned by owning player
  - Integration: Ch10 `PlayerResources` + `Harvester`

- [ ] **TODO-19.A.36** `src/OpenRA.Mods.Cnc/Traits/TDGunboat.ts` (242 lines C#) — Tiberian Dawn gunboat water unit:
  - Implements `ITick`, `IMove`
  - Water-only movement with gunboat-specific facing logic
  - `waterTileset: string` — valid water terrain types
  - Integration: Ch9 `Mobile` locomotion on water cells only

- [ ] **TODO-19.A.37** `src/OpenRA.Mods.Cnc/Traits/DrainPrerequisitePowerOnDamage.ts` (62 lines C#) — Drain power requirement on damage:
  - When actor takes damage, temporarily removes a prerequisite (disabling tech)
  - `prerequisite: string` — prerequisite to drain
  - `duration: number` — drain duration

- [ ] **TODO-19.A.38** `src/OpenRA.Mods.Cnc/Traits/TransferTimedExternalConditionOnTransform.ts` (63 lines C#) — Transfer conditions during transform:
  - When actor transforms, transfers timed external conditions to the new actor
  - `conditions: string[]` — conditions to transfer
  - Integration: Ch3 `ConditionManager`

- [ ] **TODO-19.A.39** `src/OpenRA.Mods.Cnc/Traits/TransformsNearResources.ts` (102 lines C#) — Transform when resources are near:
  - Implements `ITick`
  - When resources of specified type are within `range: WDist`, triggers actor transform
  - `intoActor: string` — target actor type after transformation
  - `resourceType: string` — resource type to detect
  - Integration: Ch11 `Transforms` trait

#### 3.1.7 World / Resource Traits (5 files)

- [ ] **TODO-19.A.40** `src/OpenRA.Mods.Cnc/Traits/World/TSResourceLayer.ts` (127 lines C#) — Tiberian Sun resource layer:
  - Extends Ch10 `ResourceLayer`
  - TS-specific resource types (Tiberium, Blue Tiberium, Veins)
  - `resourceDensity: number` — resource regeneration rate
  - `maxDensity: number` — maximum resource density per cell

- [ ] **TODO-19.A.41** `src/OpenRA.Mods.Cnc/Traits/World/TSTiberiumRenderer.ts` (96 lines C#) — Tiberian Sun Tiberium renderer:
  - Extends Ch10 `ResourceRenderer`
  - TS-specific tiberium sprite variants (green + blue crystal)
  - **3D**: tiberium = pre-generated TerrainSpriteLayer mesh with TS-specific sprite UV mappings

- [ ] **TODO-19.A.42** `src/OpenRA.Mods.Cnc/Traits/World/TSVeinsRenderer.ts` (430 lines C#) — Tiberian Sun Veins resource renderer:
  - Extends Ch10 `ResourceRenderer`
  - Vein-specific growth/spread rendering with connected-line visual
  - `maxSpreadRadius: number` — veins max spread from source
  - `growthRate: number` — vein spread rate per tick
  - **3D**: veins = connected-line `LinesMesh` with vein color gradient + growth animation

- [ ] **TODO-19.A.43** `src/OpenRA.Mods.Cnc/Traits/World/TSShroudPalette.ts` (52 lines C#) — Tiberian Sun shroud palette:
  - Extends Ch12 `ShroudPalette` (already migrated)
  - TS-specific shroud coloring (darker grey)
  - Thin subclass; minimal new logic

- [ ] **TODO-19.A.44** `src/OpenRA.Mods.Cnc/Traits/World/WithResourceAnimation.ts` (108 lines C#) — Resource gather animation for harvester:
  - Plays `sequence: string` animation when harvester is gathering
  - `armDelay: number` delay before animation starts
  - Integration: Ch10 `Harvester` + Ch7 `RenderSprites`

#### 3.1.8 Conditions & Palette Effects (3 files)

- [ ] **TODO-19.A.45** `src/OpenRA.Mods.Cnc/Traits/Conditions/GrantConditionOnJumpjetLayer.ts` (59 lines C#) — Grant condition when on jumpjet layer:
  - Grants `condition: string` when actor enters jumpjet-capable terrain
  - Integration: Ch9 `JumpjetLocomotor` (already migrated) + Ch3 `ConditionManager`

- [ ] **TODO-19.A.46** `src/OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.ts` (66 lines C#) — Rotating light palette effect:
  - `speed: number` — palette rotation speed
  - `palettes: string[]` — affected palette names
  - **3D**: palette rotation = cyclic `ShaderMaterial` uniform update for dynamic lighting effect

- [ ] **TODO-19.A.47** `src/OpenRA.Mods.Cnc/Effects/ConyardChronoVortex.ts` (63 lines C#) — Construction yard chrono-vortex effect:
  - Implements Ch3 `IEffect`
  - Spawns chrono-vortex particle effect at construction yard during chronoshift
  - **3D**: vortex = rotating `ParticleSystem` with spiral particle trajectory + blue chroma tint

**Phase A Summary**: 47 files, ~6,600 C# lines source. Key HIGH complexity: ChronoshiftPower (394 lines), Disguise (335 lines), TSVeinsRenderer (430 lines). Status: 📋 PLANNING.

---

### 3.2 Phase B: D2K Mod Traits

**Status**: 📋 待迁移 (0/17 migrated, 0 tests)
**Complexity**: MEDIUM (Sandworm system is the most complex; others MEDIUM-LOW)
**Blocked by**: Phase A (for shared patterns), Chapters 8 (Weapons), 9 (Movement), 10 (Resources), 11 (Buildings)
**Blocks**: D2K mod gameplay (standalone; nothing else depends on D2K traits)

**Description**: Phase B implements Dune 2000-specific gameplay traits. The Sandworm is the signature D2K mechanic — an AI-controlled underground creature that emerges to swallow units. Spice is the D2K resource variant. The concrete building system requires placement on concrete slabs rather than directly on terrain.

**Paradigm Shifts**:
- C# `Sandworm` underground cell-based movement → 3D subsurface `Mesh` with Y-axis height animation + collision enable/disable
- C# `AttackSwallow` actor absorption → TypeScript `SwallowActor` activity that parents target mesh to Sandworm mouth node, then scales to zero
- C# `D2kBuilding` concrete slab requirement → TypeScript `BuildableTerrainLayer` provides concrete splatmap that `PlaceBuilding` checks before placing
- C# `SpiceBloom` resource spawner with spice-specific growth → extends Ch10 `SeedsResource` with D2K spice variant selection

#### 3.2.1 Sandworm System (4 files)

- [ ] **TODO-19.B.1** `src/OpenRA.Mods.D2k/Traits/Sandworm.ts` (150 lines C#) — Sandworm AI actor:
  - Implements `ITick`, `INotifyCreated`, `IAutoTarget`
  - Underground movement: follows `Wanders` pattern, invisible to enemies
  - `emergeRange: WDist` — detection range for emergence
  - `attackRange: WDist` — range to initiate swallow attack
  - `resurfaceDelay: number` — ticks between attacks
  - **3D**: underground = mesh below terrain (Y < 0), invisible. Emerge = Y-axis lerp above ground. Movement = pathfinding on cell grid while underground.

- [ ] **TODO-19.B.2** `src/OpenRA.Mods.D2k/Traits/AttackSwallow.ts` (99 lines C#) — Sandworm swallow attack:
  - Extends Ch8 `AttackBase`
  - On attack: initiates `SwallowActor` activity
  - `swallowSound: string` — swallow sound effect
  - Target must be `Targetable` and not `ImmuneToSwallow`
  - **3D**: swallow = target mesh moves toward Sandworm mouth, scales down, then disappears

- [ ] **TODO-19.B.3** `src/OpenRA.Mods.D2k/Traits/AttractsWorms.ts` (81 lines C#) — Attracts sandworm attention:
  - `intensity: number` — worm attraction intensity (higher = preferred target)
  - `range: WDist` — attraction range
  - Worms prioritize attacking actors with higher intensity
  - ConditionalTrait (can be disabled by condition)

- [ ] **TODO-19.B.4** `src/OpenRA.Mods.D2k/Activities/SwallowActor.ts` (166 lines C#) — Swallow activity:
  - Extends Ch3 `Activity`
  - Phases: approach → emerge from ground → swallow target → submerge
  - `swallowDuration: number` — ticks for swallow animation
  - Target is destroyed at end of swallow phase
  - **3D**: multi-phase animation sequence with mesh position/size interpolation

#### 3.2.2 Spice / Resource (2 files)

- [ ] **TODO-19.B.5** `src/OpenRA.Mods.D2k/Traits/SpiceBloom.ts` (213 lines C#) — Spice resource spawner:
  - Implements `ITick`
  - Periodically spawns/regenerates spice resources on map
  - `growthRate: number` — spice growth per interval
  - `maxDensity: number` — max spice density per cell
  - `interval: number` — growth tick interval
  - Integration: Ch10 `ResourceLayer` + `ResourceType`

- [ ] **TODO-19.B.6** `src/OpenRA.Mods.D2k/Traits/World/D2kResourceRenderer.ts` (170 lines C#) — D2K spice resource renderer:
  - Extends Ch10 `ResourceRenderer`
  - Renders spice with D2K-specific color palette (orange/brown spice variants)
  - `spiceColors: number[]` — spice variant ARGB colors
  - **3D**: TerrainSpriteLayer with spice variant sprite UV selection. Different visual for low-density vs high-density spice

#### 3.2.3 Building / Concrete (5 files)

- [ ] **TODO-19.B.7** `src/OpenRA.Mods.D2k/Traits/Buildings/D2kBuilding.ts` (162 lines C#) — D2K building with concrete prerequisite:
  - Extends Ch11 `Building` trait
  - Building can only be placed on `BuildableTerrainLayer` concrete slabs
  - `minConcreteCoverage: number` — minimum % of footprint on concrete
  - Integration: Ch11 `PlaceBuilding` + `PlaceBuildingOrderGenerator`

- [ ] **TODO-19.B.8** `src/OpenRA.Mods.D2k/Traits/World/BuildableTerrainLayer.ts` (155 lines C#) — Concrete buildable terrain:
  - Implements `IRenderOverlay`, `ITiledTerrainRenderer`
  - Renders concrete slab under buildings
  - `concreteTileSet: string` — concrete terrain tileset
  - `maxThickness: number` — concrete layer depth
  - **3D**: concrete = terrain splatmap layer with concrete texture. Rendered as semi-transparent overlay on terrain mesh

- [ ] **TODO-19.B.9** `src/OpenRA.Mods.D2k/Traits/Buildings/D2kActorPreviewPlaceBuildingPreview.ts` (124 lines C#) — D2K building placement preview:
  - Extends Ch11 `PlaceBuildingPreview` system
  - Previews building footprint with concrete overlay during placement
  - Shows which cells have concrete vs need concrete
  - **3D**: green (valid) / red (needs concrete) preview mesh on terrain

- [ ] **TODO-19.B.10** `src/OpenRA.Mods.D2k/Warheads/DamagesConcreteWarhead.ts` (38 lines C#) — Damages concrete slabs:
  - Extends Ch8 `Warhead` with concrete damage
  - `damage: number` — concrete damage amount
  - Destroys concrete slabs on impact (buildings cannot be placed on damaged concrete)
  - Integration: `BuildableTerrainLayer` for concrete damage tracking

- [ ] **TODO-19.B.11** `src/OpenRA.Mods.D2k/Traits/Player/HarvesterInsurance.ts` (49 lines C#) — Harvester replacement insurance:
  - Implements `ITick`, `INotifyCreated`
  - When a harvester is destroyed, auto-queues a replacement at the owning player's factory
  - `replacementCost: number` — % of original cost (default free)
  - `factoryType: string` — factory that produces replacements
  - Integration: Ch11 `ProductionQueue` + Ch10 `Harvester`

#### 3.2.4 D2K Visual / Audio / Projectiles (6 files)

- [ ] **TODO-19.B.12** `src/OpenRA.Mods.D2k/Traits/Render/WithCrumbleOverlay.ts` (68 lines C#) — Building crumble overlay on low HP:
  - Extends Ch7 `RenderSprites`
  - Shows `crumbleSequence: string` overlay animation when building HP < threshold
  - `threshold: number` — HP percentage to show crumble (0-1)
  - **3D**: crumble = semi-transparent overlay sprite on building mesh

- [ ] **TODO-19.B.13** `src/OpenRA.Mods.D2k/Traits/Render/WithDeliveryOverlay.ts` (72 lines C#) — Carryall delivery overlay:
  - Shows `sequence: string` animation when unit is being delivered by carryall
  - Auto-hides after delivery complete
  - **3D**: delivery = descending sprite/Mesh from sky with shadow projection

- [ ] **TODO-19.B.14** `src/OpenRA.Mods.D2k/Traits/World/SonicBlastRenderer.ts` (95 lines C#) — Sonic blast visual effect:
  - Implements `IRender`, `IWorldLoaded`
  - Renders sonic blast ring expansion from source
  - `speed: WDist` — ring expansion speed
  - **3D**: sonic blast = expanding ring `GroundMesh` with shader-based displacement + screen shake

- [ ] **TODO-19.B.15** `src/OpenRA.Mods.D2k/Projectiles/SonicBlast.ts` (157 lines C#) — Sonic blast projectile:
  - Implements Ch8 `IProjectile`
  - Straight-line blast traveling at high speed
  - `width: WDist` — blast width (damage area)
  - `speed: WDist` — blast travel speed per tick
  - **3D**: blast = `CylinderMesh` oriented from source to target with `ShaderMaterial` wave/glow effect

- [ ] **TODO-19.B.16** `src/OpenRA.Mods.D2k/Graphics/SonicBlastRenderable.ts` (64 lines C#) — Sonic blast renderable helper:
  - Implements `IRenderable`
  - Renders sonic blast beam line segments
  - **3D**: `LinesMesh` with sonic blast color gradient

- [ ] **TODO-19.B.17** `src/OpenRA.Mods.D2k/Graphics/D2kSpriteSequence.ts` (116 lines C#) — D2K-specific sprite sequence:
  - Implements `ISpriteSequence`
  - D2K-specific frame ordering and tick timing
  - `UseD2kFacing: boolean` — D2K-specific 8-dir facing (instead of 32)
  - Integration: Ch2 `Sprite`, `Sheet`, `Animation`

**Phase B Summary**: 17 files, ~2,000 C# lines source. Key HIGH complexity: none (Sandworm at MEDIUM 150 lines). Status: 📋 PLANNING.

---

### 3.3 Phase C: C&C Rendering, Graphics & Voxel

**Status**: 📋 待迁移 (0/37 migrated, 0 tests)
**Complexity**: MEDIUM-HIGH (Voxel rendering subsystem is architecturally significant; ModelRenderer is HIGH)
**Blocked by**: Phase A (Chrono/Attack/Tesla traits provide logic; render traits depend on them), Ch2 (Renderer/Sprite/Sheet), Ch7 (RenderSprites)
**Blocks**: Nothing (leaf phase)

**Description**: Phase C implements all C&C rendering and graphics systems. This includes 10 render traits (With*Body sprite rendering), 4 graphics renderables (ChronoVortex, TeslaZap, sprite sequences), the complete 14-file voxel rendering pipeline, 3 C&C projectiles (TeslaZap, IonCannon, DropPod), 3 C&C activities (Leap, LeapAttack, Teleport), and 3 additional world effects.

**Paradigm Shifts**:
- C# `VoxelRenderer` software rasterizer → Pre-converted glTF meshes loaded via `SceneLoader.ImportMeshAsync()` (ADR-19.1)
- C# `ModelRenderer` CPU-side model transform computation → `TransformNode` parent-child hierarchy with per-frame rotation/position updates
- C# `IRenderable` per-frame CPU rendering → Static `Mesh` instances in the Babylon.js scene graph; visibility/transform updates per frame
- C# `TeslaZapRenderable` 2D line segments → `LinesMesh` with dynamic vertex reallocation + `ShaderMaterial` glow
- C# `ChronoVortexRenderable` 2D sprite particle → `ParticleSystem` with spiral emitter pattern
- C# `Leap` / `Teleport` cell-based animation → Babylon.js `Animation` / `TransformNode` interpolation

#### 3.3.1 Render Traits (10 files)

- [ ] **TODO-19.C.1** `src/OpenRA.Mods.Cnc/Traits/Render/WithBuildingBib.ts` (137 lines C#) — Building foundation bib rendering:
  - Renders building foundation "bib" sprite below the building
  - `sequence: string` — bib sprite sequence
  - `palette: string` — bib color palette
  - **3D**: bib = flat `GroundMesh` plane below building mesh with bib texture

- [ ] **TODO-19.C.2** `src/OpenRA.Mods.Cnc/Traits/Render/WithCargo.ts` (143 lines C#) — Cargo capacity display:
  - Shows cargo/passenger sprites on transport actor
  - `localOffset: WVec[]` — passenger display positions
  - `displayType: string` — how to display (e.g., "Default", "Passenger", "Crushable")
  - **3D**: cargo = small sprite `Meshes` positioned at offset locations on transport TransformNode

- [ ] **TODO-19.C.3** ~ **TODO-19.C.10**: Similar render trait stubs for `WithDisguisingInfantryBody`, `WithEmbeddedTurretSpriteBody`, `WithGunboatBody`, `WithHarvesterSpriteBody`, `WithLandingCraftAnimation`, `WithSplitAttackPaletteInfantryBody`, `WithTeslaChargeAnimation`, `WithTeslaChargeOverlay` — each implements custom sprite rendering for specific C&C unit types using Ch7 `RenderSprites` infrastructure with 3D adaptations (Billboard sprites, ShaderMaterial palette swaps, etc.)

*Note: Full per-file details for C3-C10 will be elaborated during Phase C planning. Each file is LOW complexity (47-97 lines C#), involving extending `RenderSprites` with mod-specific sequence/palette overrides.*

#### 3.3.2 Graphics Renderables (4 files)

- [ ] **TODO-19.C.11** `src/OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.ts` (67 lines C#) — Chrono-vortex renderable:
  - Implements `IRenderable`
  - Renders rotating vortex sprite at chronoshift departure/arrival points
  - **3D**: vortex = rotating `ParticleSystem` + `Mesh` with spiral UV animation on `ShaderMaterial`

- [ ] **TODO-19.C.12** `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts` (167 lines C#) — Tesla zap lightning renderable:
  - Implements `IRenderable`
  - Generates lightning arc between tesla coil and target
  - `zapDuration: number` — lightning flash duration
  - `boltCount: number` — number of branching bolts
  - **3D**: lightning = dynamically generated `LinesMesh` with jagged midpoint offsets + `ShaderMaterial` glow + random bolt branching

- [ ] **TODO-19.C.13** `src/OpenRA.Mods.Cnc/Graphics/ClassicSpriteSequence.ts` (48 lines C#) — Classic sprite sequence format:
  - Implements `ISpriteSequence`
  - C&C classic 8-direction facing with non-linear frame mapping
  - Uses `ClassicFacingBodyOrientation` for facing-to-frame conversion
  - Integration: Ch2 `Sprite`, `Sheet`, `Animation` + already-migrated `ClassicFacingBodyOrientation`

- [ ] **TODO-19.C.14** `src/OpenRA.Mods.Cnc/Graphics/ClassicTilesetSpecificSpriteSequence.ts` (95 lines C#) — Tileset-specific classic sequence:
  - Extends `ClassicSpriteSequence` with tileset-specific frame overrides
  - `tilesetOverrides: Map<string, SequenceDef>` — per-tileset frame remapping
  - Used for terrain-dependent sprite variants

#### 3.3.3 Voxel Rendering Pipeline (14 files)

*Note: This is the architecturally most significant C&C subsystem. Full per-file details will be elaborated after ADR-19.1 resolution (build-time vs runtime voxel conversion). The TODO items below assume the ADR-19.1 default: runtime glTF loading with build-time `.vxl`→`.glb` conversion.*

- [ ] **TODO-19.C.15** `src/OpenRA.Mods.Cnc/FileFormats/VxlReader.ts` (158 lines C#) — VXL voxel file format reader:
  - Parses binary `.vxl` format (Westwood voxel model): header, limb dimensions, color indices, normals
  - Outputs `VoxelData` structure: `Uint8Array` color indices per voxel + normal vectors
  - **ADR-19.1**: Used only at build time by the `.vxl`→`.glb` converter; runtime TS is thin validation wrapper

- [ ] **TODO-19.C.16** `src/OpenRA.Mods.Cnc/FileFormats/HvaReader.ts` (63 lines C#) — HVA voxel animation file reader:
  - Parses binary `.hva` format: frame count, per-limb transform matrices, animation flags
  - Outputs `HvaData`: `FrameTransform[]` array (position + rotation per limb per frame)
  - **ADR-19.1**: Used at build time; runtime TS is thin validation wrapper

- [ ] **TODO-19.C.17** `src/OpenRA.Mods.Cnc/Graphics/Voxel.ts` (161 lines C#) — Voxel model in-memory representation:
  - Holds parsed voxel data: limbs, frames, color palette mappings
  - `Render(worldRenderer, palette, scale, facing)` — triggers model rendering
  - **ADR-19.1**: Runtime TS loads pre-converted glTF. Voxel class becomes a thin `TransformNode` wrapper with limb node references.

- [ ] **TODO-19.C.18** `src/OpenRA.Mods.Cnc/Graphics/VoxelLoader.ts` (242 lines C#) — Voxel asset loader:
  - Loads `.vxl` + `.hva` from FileSystem, parses, caches in `VoxelCache`
  - Generates `Sheet` sprites for each voxel frame (software rasterizer output)
  - **ADR-19.1**: Runtime TS loads pre-converted `.glb` from FileSystem. VoxelLoader becomes a thin `SceneLoader` wrapper.

- [ ] **TODO-19.C.19** `src/OpenRA.Mods.Cnc/Traits/World/VoxelCache.ts` (119 lines C#) — Voxel model cache:
  - Implements `IModelCache`
  - LRU cache of loaded voxel models
  - Keyed by model name + palette hash
  - **ADR-19.1**: Cache stores pre-loaded `TransformNode` hierarchies. Keyed by model name only (palette is material property).

- [ ] **TODO-19.C.20** `src/OpenRA.Mods.Cnc/Traits/World/VoxelNormalsPalette.ts` (351 lines C#) — Voxel normal-to-color palette:
  - Generates 256-color palette based on voxel normal directions
  - `lightSource: WVec` — directional light source for shading calculation
  - Pre-computes normal angle → color mapping
  - **ADR-19.1**: Becomes a `ShaderMaterial` uniform — the normal-to-color table is uploaded as a 256×1 `RawTexture` lookup

- [ ] **TODO-19.C.21** `src/OpenRA.Mods.Cnc/Traits/World/ModelRenderer.ts` (398 lines C#) — Model renderer world trait:
  - Renders all voxel models in the world each frame
  - Batches models by palette for efficient rendering
  - `render(worldRenderer)` — iterates all visible models, calls model.Render()
  - **ADR-19.1**: Becomes a thin manager that registers glTF-loaded `TransformNodes` in the Babylon.js scene graph. No per-frame CPU rendering.

- [ ] **TODO-19.C.22** `src/OpenRA.Mods.Cnc/Graphics/ModelRenderable.ts` (294 lines C#) — Single model renderable:
  - Implements `IRenderable` for one voxel model instance
  - Compute model transform (scale, rotation, world position) from actor state
  - **ADR-19.1**: `TransformNode` already handles this. ModelRenderable becomes a simple state struct mapping actor → TransformNode.

- [ ] **TODO-19.C.23** `src/OpenRA.Mods.Cnc/Graphics/ModelActorPreview.ts` (79 lines C#) — Voxel model actor preview:
  - Implements `IActorPreview` for voxel models in UI (build queue, sidebar)
  - Renders model at fixed camera angle for preview
  - **3D**: Small `Scene`/`RenderTargetTexture` with single model for UI preview canvas

- [ ] **TODO-19.C.24** `src/OpenRA.Mods.Cnc/Graphics/UIModelRenderable.ts` (155 lines C#) — UI model renderable:
  - Implements `IRenderable` for voxel models in UI widgets (e.g., purchase dialog)
  - Fixed orthographic projection
  - **3D**: UI model = `Mesh` rendered in separate UI `Scene` with orthographic camera

- [ ] **TODO-19.C.25** `src/OpenRA.Mods.Cnc/Traits/Render/RenderVoxels.ts` (189 lines C#) — Actor trait for voxel rendering:
  - Replaces `RenderSprites` for voxel-based actors
  - Manages voxel model lifecycle: load model, attach to actor, update per frame
  - `model: string` — voxel model filename (without extension)
  - **3D**: Attaches pre-loaded glTF `TransformNode` as child of actor `TransformNode`

- [ ] **TODO-19.C.26** `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelBody.ts` (68 lines C#) — Voxel body rendering:
  - Extends `RenderVoxels` for the main body limb
  - Selects body frame based on actor facing
  - **3D**: Body = root `TransformNode` with glTF mesh. Facing rotates node around Y axis.

- [ ] **TODO-19.C.27** `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelTurret.ts` (67 lines C#) — Voxel turret rendering:
  - Extends `RenderVoxels` for turret limb
  - Selects turret frame based on `Turreted` trait facing
  - **3D**: Turret = child `TransformNode` of body. Rotation set from `Turreted.LocalYaw`.

- [ ] **TODO-19.C.28** `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelBarrel.ts` (105 lines C#) — Voxel barrel rendering:
  - Extends `RenderVoxels` for barrel limb
  - Selects barrel frame based on `Armament` barrel orientation
  - **3D**: Barrel = child `TransformNode` of turret. Rotation set from `Armament` pitch.

- [ ] **TODO-19.C.29** `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelWalkerBody.ts` (106 lines C#) — Voxel walker body (Tiberian Sun mechs):
  - Extends `RenderVoxels` for walker mech animation
  - Limb animation driven by movement state (idle, walking, turning)
  - **3D**: Walker legs = separate `TransformNodes` with per-frame rotation from glTF animation clips

- [ ] **TODO-19.C.30** `src/OpenRA.Mods.Cnc/Traits/Render/WithVoxelUnloadBody.ts` (91 lines C#) — Voxel unloading body:
  - Extends `RenderVoxels` for cargo unload state
  - Special frame selection when transport is unloading passengers
  - **3D**: Unload = dedicated glTF animation clip triggered on unload event

#### 3.3.4 Projectiles (3 files)

- [ ] **TODO-19.C.31** `src/OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts` (99 lines C#) — Tesla zap projectile:
  - Implements Ch8 `IProjectile`
  - Instant hit with visible lightning bolt renderable
  - `brightSequence: string` — target flash sequence on hit
  - **3D**: lightning bolt = `LinesMesh` + `TeslaZapRenderable`. Hit = `SpriteEffect` flash at target.

- [ ] **TODO-19.C.32** `src/OpenRA.Mods.Cnc/Projectiles/IonCannon.ts` (73 lines C#) — Ion cannon orbital projectile:
  - Implements Ch8 `IProjectile`
  - Descending beam from sky to ground
  - `weapon: WeaponInfo` — weapon to fire on impact
  - **3D**: Ion beam = descending `CylinderMesh` with bright blue emissive `ShaderMaterial`. Ground splash = `ParticleSystem` burst.

- [ ] **TODO-19.C.33** `src/OpenRA.Mods.Cnc/Projectiles/DropPodImpact.ts` (77 lines C#) — Drop pod ground impact:
  - Implements Ch8 `IProjectile`
  - Pod descent + ground impact + unit deployment
  - `unit: string` — unit type to spawn on impact
  - **3D**: Pod = descending `Mesh` with particle trail. Impact = `SpriteEffect` dust cloud + spawned unit appears.

#### 3.3.5 Activities (3 files)

- [ ] **TODO-19.C.34** `src/OpenRA.Mods.Cnc/Activities/Leap.ts` (126 lines C#) — Leap movement activity:
  - Extends Ch3 `Activity`
  - Parabolic arc jump from current position to target
  - `leapSpeed: WDist` — travel speed
  - On landing: trigger `AttackLeap` impact (if leaping at target)
  - **3D**: arc = `Vector3.Lerp` with Y-axis sin-based height curve

- [ ] **TODO-19.C.35** `src/OpenRA.Mods.Cnc/Activities/LeapAttack.ts` (176 lines C#) — Leap attack activity:
  - Extends `Leap` with attack on landing
  - Combines leap + target damage in one activity chain
  - `attackDelay: number` — ticks between landing and attack
  - Integration: Ch14 `AttackActivity`

- [ ] **TODO-19.C.36** `src/OpenRA.Mods.Cnc/Activities/Teleport.ts` (144 lines C#) — Teleport activity:
  - Extends Ch3 `Activity`
  - Instant position change with visual effect
  - `teleportDuration: number` — animation time around teleport
  - **3D**: Teleport = mesh fade-out at source + chrono-vortex effect + mesh fade-in at destination

#### 3.3.6 Effects (3 files)

- [ ] **TODO-19.C.37** `src/OpenRA.Mods.Cnc/Effects/GpsDotEffect.ts` (119 lines C#) — GPS dot visual effect:
  - Implements Ch3 `IEffect`
  - Renders GPS minimap dot for revealed actors
  - `color: Color` — dot color per player

- [ ] **TODO-19.C.38** `src/OpenRA.Mods.Cnc/Effects/SatelliteLaunch.ts` (58 lines C#) — Satellite launch effect:
  - Implements Ch3 `IEffect`
  - Satellite ascending from launch structure into sky
  - **3D**: Satellite = small `Mesh` with vertical ascent animation + particle trail

- [ ] **TODO-19.C.39** `src/OpenRA.Mods.Cnc/Traits/World/ChronoVortexRenderer.ts` (114 lines C#) — Chrono-vortex world renderer:
  - World trait that renders chrono-vortex effects at teleport points
  - `vortexDuration: number` — vortex persistence in ticks
  - **3D**: `ParticleSystem` with spiral pattern + chroma-shift `ShaderMaterial`

**Phase C Summary**: 37 files, ~4,700 C# lines source. Key HIGH complexity: ModelRenderer (398 lines). Voxel subsystem is the critical path. Status: 📋 PLANNING.

---

### 3.4 Phase D: Supporting Infrastructure

**Status**: 📋 待迁移 (0/18 migrated, 0 tests)
**Complexity**: LOW-MEDIUM (Blowfish + BlowfishKeyProvider are HIGH; most others LOW)
**Blocked by**: Ch5 (FileSystem for format readers), Ch2 (ISpriteLoader for sprite loaders)
**Blocks**: Unblocks Phase A-C (sprite loaders needed for sprite sequences; file formats needed for voxel data reading)

**Description**: Phase D implements the foundational file formats, sprite loaders, compression algorithms, and interfaces used by all other phases. These files have no game-logic dependencies — they are pure data processing. Because they are prerequisites for other phases, Phase D should begin early and run in parallel with Phase A.

**Paradigm Shifts**:
- C# `BinaryReader` on `Stream` → TypeScript `DataView` on `Uint8Array` (no Stream abstraction in browser)
- C# Blowfish cipher → Pure TypeScript port of Blowfish algorithm (line-for-line from C#)
- C# `ISpriteLoader` sprite frame decoding → Pure TypeScript frame parsers using `Uint8Array` + `DataView`
- C# `IPackage` file system → Already migrated Ch5 `FileSystem`; format readers use `Uint8Array` directly

#### 3.4.1 File Formats (6 files)

- [ ] **TODO-19.D.1** `src/OpenRA.Mods.Cnc/FileFormats/Blowfish.ts` (410 lines C#) — Blowfish encryption cipher:
  - Pure TypeScript implementation of the Blowfish block cipher (64-bit blocks)
  - `encipher(uint32 * 2)` — encrypt one block
  - `decipher(uint32 * 2)` — decrypt one block
  - Key schedule initialization from byte array (variable key length 4-56 bytes)
  - **Precision requirement**: encrypt/decrypt must produce byte-identical output to C# Blowfish for all test vectors
  - Used for decrypting encrypted MIX file headers

- [ ] **TODO-19.D.2** `src/OpenRA.Mods.Cnc/FileFormats/BlowfishKeyProvider.ts` (491 lines C#) — Blowfish key derivation from game EXE:
  - Analyzes game executable to extract decryption key
  - Byte pattern matching to locate key constants in binary
  - Produces 56-byte Blowfish key from located constants
  - Used only at asset-load time (build time). Runtime can use hardcoded key for known games.

- [ ] **TODO-19.D.3** `src/OpenRA.Mods.Cnc/FileFormats/LCWCompression.ts` (167 lines C#) — Lempel-Castle-Welch (LCW) decompression:
  - Pure TypeScript decompression from `Uint8Array` input → `Uint8Array` output
  - Used by SHP sprite format (Tiberian Dawn)
  - **Precision requirement**: decompress must produce byte-identical output to C# for all test vectors
  - Stream decoding with variable-length back-reference + raw copy commands

- [ ] **TODO-19.D.4** `src/OpenRA.Mods.Cnc/FileFormats/LZOCompression.ts` (291 lines C#) — LZO decompression:
  - Pure TypeScript decompression from `Uint8Array` input → `Uint8Array` output
  - Used by TS voxel data and terrain formats
  - Larger, more complex than LCW
  - **Precision requirement**: decompress must produce byte-identical output to C# for all test vectors

- [ ] **TODO-19.D.5** `src/OpenRA.Mods.Cnc/FileFormats/XORDeltaCompression.ts` (82 lines C#) — XOR delta decompression:
  - Pure TypeScript decompression from `Uint8Array` input → `Uint8Array` output
  - XOR each byte with previous frame for video frame decoding (WSA frames)
  - Simple algorithm; used as dependency for WSA video (deferred)

- [ ] **TODO-19.D.6** `src/OpenRA.Mods.Cnc/FileFormats/AudReader.ts` (205 lines C#) — AUD audio format reader:
  - Parses Westwood AUD audio container format
  - Extracts PCM/ADPCM audio data with sample rate and format metadata
  - **ADR-19.4**: Used at build time for AUD→WAV conversion. Runtime TS is thin validation wrapper.

#### 3.4.2 Sprite Loaders (7 files)

- [ ] **TODO-19.D.7** `src/OpenRA.Mods.Cnc/SpriteLoaders/ShpTDLoader.ts` (330 lines C#) — Tiberian Dawn SHP sprite loader:
  - Implements `ISpriteLoader`
  - Parses SHP format with LCW-compressed frames
  - TD-specific frame count and offset logic
  - Integration: Ch2 `SpriteLoader` infrastructure

- [ ] **TODO-19.D.8** `src/OpenRA.Mods.Cnc/SpriteLoaders/ShpD2Loader.ts` (171 lines C#) — Dune 2000 SHP variant:
  - Implements `ISpriteLoader`
  - D2K-specific SHP format (similar to TD but with variant header)
  - Different frame count handling

- [ ] **TODO-19.D.9** `src/OpenRA.Mods.Cnc/SpriteLoaders/ShpRemasteredLoader.ts` (121 lines C#) — Remastered SHP loader:
  - Implements `ISpriteLoader`
  - Wraps remastered sprite data (higher resolution)
  - Thin wrapper; most logic in base SHP loader

- [ ] **TODO-19.D.10** `src/OpenRA.Mods.Cnc/SpriteLoaders/TmpTDLoader.ts` (101 lines C#) — Tiberian Dawn terrain TMP loader:
  - Implements `ISpriteLoader` for terrain tiles
  - TD-specific TMP format: 24×24 pixel tiles with palette lookup
  - Integration: Ch4 terrain sprite pipeline

- [ ] **TODO-19.D.11** `src/OpenRA.Mods.Cnc/SpriteLoaders/TmpRALoader.ts` (98 lines C#) — Red Alert terrain TMP loader:
  - Implements `ISpriteLoader` for terrain tiles
  - RA-specific TMP variant

- [ ] **TODO-19.D.12** `src/OpenRA.Mods.Cnc/SpriteLoaders/TmpTSLoader.ts` (199 lines C#) — Tiberian Sun terrain TMP loader:
  - Implements `ISpriteLoader` for terrain tiles
  - TS-specific TMP with LZO-compressed tile data
  - More complex than TD/RA TMP due to LZO compression

- [ ] **TODO-19.D.13** `src/OpenRA.Mods.D2k/SpriteLoaders/R8Loader.ts` (229 lines C#) — D2K R8 sprite format loader:
  - Implements `ISpriteLoader`
  - Dune 2000-specific R8 sprite format
  - 8-bit indexed color with D2K-specific palette

#### 3.4.3 Interfaces & Utilities (3 files)

- [ ] **TODO-19.D.14** `src/OpenRA.Mods.Cnc/TraitsInterfaces.ts` (18 lines C#) — C&C-specific trait interfaces:
  - `INotifyTeslaCharging` — single-method interface for Tesla charge event
  - Minimal file; only 1 interface

- [ ] **TODO-19.D.15** `src/OpenRA.Mods.Cnc/Util.ts` (315 lines C#) — C&C utility functions:
  - `ClassicIndexFacing(facing, steps)` — converts WAngle to classic 8-dir index
  - `ClassicQuantizeFacing(facing, steps)` — quantizes facing to nearest classic direction
  - Non-linear facing mapping (0-31 → 0-7 with specific East/West bias)
  - Used by `ClassicFacingBodyOrientation` (already migrated) and `ClassicSpriteSequence`

- [ ] **TODO-19.D.16** `src/OpenRA.Mods.D2k/PackageLoaders/D2kSoundResources.ts` (94 lines C#) — D2K sound resource packaging:
  - Loads and registers D2K-specific sound files
  - `soundFormat: string` — D2K sound format (D2K AUD variant)
  - Integration: Ch7 `Sound` + `SoundDevice`

**Phase D Summary**: 18 files, ~2,500 C# lines source. Key HIGH complexity: Blowfish (410 lines), BlowfishKeyProvider (491 lines). Status: 📋 PLANNING.

---

### Chapter 19 Final Status: 0/119 files (0%, PLANNING). Phase A: 0/47, Phase B: 0/17, Phase C: 0/37, Phase D: 0/18. Deferred: 45 files (~7,300 lines). Already Migrated: 8 files.

---

## 4. Dependency Graph

### 4.1 Overall Dependency Map

```
Chapters 2-18 (COMPLETE -- Foundation)
  │
  ├── Phase D: Supporting Infrastructure (18 files)
  │     │
  │     ├── File Formats (6) — Blowfish, LCW, LZO, XOR Delta, AudReader, BlowfishKeyProvider
  │     ├── Sprite Loaders (7) — ShpTD/D2/RemasteredLoader, TmpTD/RA/TSLoader, R8Loader
  │     └── Interfaces/Utils (3) — TraitsInterfaces, Util, D2kSoundResources
  │           │
  │           └── [Unblocks Phase A sprite sequences + Phase C voxel pipeline]
  │
  ├── Phase A: C&C Core Traits (47 files) — can start in parallel with Phase D
  │     │
  │     ├── Attack Variants (4) — depends on Ch8 AttackBase
  │     ├── Chrono Technology (5) — depends on Ch13 SupportPowers + Ch9 Mobile
  │     ├── Infiltration (9) — depends on Ch3 ConditionManager + Ch14 Enter
  │     ├── GPS/Sensors (4) — depends on Ch12 Shroud/Fog
  │     ├── Support Powers (5) — depends on Ch13
  │     ├── Miscellaneous Traits (11) — depends on Ch8-11 gameplay
  │     ├── World/Resource Traits (5) — depends on Ch10 ResourceLayer + Ch12 Shroud
  │     └── Conditions/Palette (3) — depends on Ch3 ConditionManager + Ch2 Palette
  │
  ├── Phase B: D2K Mod Traits (17 files) — depends on Phase A + Ch8-11
  │     │
  │     ├── Sandworm System (4) — depends on Ch9 Movement + Ch8 Weapons
  │     ├── Spice/Resource (2) — depends on Ch10 ResourceLayer
  │     ├── Building/Concrete (5) — depends on Ch11 Production + Ch4 Terrain
  │     └── Visual/Audio (6) — depends on Ch7 Effects/Sound + Ch2 Renderer
  │
  └── Phase C: C&C Rendering & Voxel (37 files) — depends on Phase A + D
        │
        ├── Render Traits (10) — depends on Ch7 RenderSprites + Phase A traits
        ├── Graphics Renderables (4) — depends on Ch2 Renderer + Phase D sprite loaders
        ├── Voxel Pipeline (14) — depends on Ch2 Renderer + Phase D file format readers
        ├── Projectiles (3) — depends on Ch8 IProjectile + Phase A Tesla/Ion traits
        ├── Activities (3) — depends on Ch14 Activity base + Phase A AttackLeap
        └── Effects (3) — depends on Ch3 IEffect + Phase A GPS/Chrono traits
```

### 4.2 Critical Path

The longest sequential dependency chain:

```
Phase D FileFormats → Phase D SpriteLoaders → Phase C Voxel Pipeline → Phase C RenderTraits
  (~22 files, estimated 4-5 sequential steps)
```

### 4.3 Parallelization Opportunities

These sub-groups have NO cross-dependencies and can run simultaneously:

| Track | Files | Est. Time | Assignable To |
|--------|:---:|:---:|--------|
| **Track 1**: File Formats (D1) | 6 | 2-3 days | Developer A |
| **Track 2**: Sprite Loaders (D3) | 7 | 2-3 days | Developer B (after LCW/LZO from Track 1) |
| **Track 3**: Chrono + GPS traits (A1+A2) | 9 | 2-3 days | Developer C |
| **Track 4**: Infiltration + Attack (A3+A4) | 13 | 3-4 days | Developer D |
| **Track 5**: Support Powers + Misc (A5+A6+A7+A8) | 25 | 5-6 days | Developer E |
| **Track 6**: D2K all (Phase B) | 17 | 4-5 days | Developer F (after A6 patterns) |
| **Track 7**: Voxel Pipeline (Phase C) | 14 | 5-7 days | Developer G (after D2 format readers) |
| **Track 8**: C&C Render/Projectile/Activity (C1-C6, non-voxel) | 23 | 4-5 days | Developer H (after Phase A) |

### 4.4 Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| Voxel Pipeline | Must migrate `VxlReader` + `HvaReader` (D2) first, then `Voxel` + `VoxelLoader` (C3), then `RenderVoxels` + `WithVoxel*` (C3) |
| ChronoshiftPower | Depends on Ch13 `SupportPower` base + `Chronoshiftable` (A1) |
| AttackLeap | Depends on Ch8 `AttackBase` + `Leap` activity (C5) |
| Disguise | Depends on Ch3 `ConditionManager` + `RenderSprites` (Ch7) |
| Tesla zap rendering | Depends on `AttackTesla` (A4) + `TeslaZap` projectile (C4) + `TeslaZapRenderable` (C2) |
| GPS system | Depends on Ch12 `Shroud` + `FrozenUnderFog` + `FrozenUnderFogUpdatedByGps` (A2) |
| Infiltration | Depends on Ch14 `Enter` activity + Ch3 `ConditionManager` |
| D2K Sandworm | Depends on Ch9 `Mobile` + Ch8 `AttackBase` + `SwallowActor` activity (B1) |
| D2K Building | Depends on Ch11 `Building` + `BuildableTerrainLayer` (B3) + `D2kBuilding` (B3) |
| Sprite Loaders | Depends on `LCWCompression` (D1) for SHP format. Depends on `LZOCompression` (D1) for TmpTS format. |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

Most Chapter 19 traits are pure game logic and fully unit-testable. Rendering traits (With*Body, VoxelRenderVoxels) require visual acceptance testing for the 3D output, but the logic layer (frame selection, facing computation, state management) is unit-testable independently.

**Test patterns per category**:

| Category | Test Strategy | Special Considerations |
|----------|--------------|----------------------|
| Attack Variants | Unit test tick behavior, `getAttackActivity()` return type, `canAttack()` facing constraints | Mock `AttackBase` parent class |
| Chrono Tech | Unit test teleport queuing (verify deferred action pattern), charge state transitions, return timer | Verify teleport is queued during tick, applied in `frameEndActions` |
| Infiltration | Unit test composition order, effect stacking, self-destruct after infiltrate | Mock `Enter` activity completion |
| GPS | Unit test condition grant/revoke on power activate/deactivate, watcher radius | Mock `Shroud` state |
| Disguise | Unit test disguise selection, breaking on attack, tooltip/healthbar identity | Verify tooltip shows disguised name |
| Sandworm | Unit test underground/emerged state transitions, emergence timing, target selection priority | Mock `Mobile` movement layer |
| D2K Building | Unit test concrete coverage check, placement validation | Mock `BuildableTerrainLayer` |
| File Formats | Unit test with known C# test vectors — compression round-trip, decryption | **Precision**: byte-identical output required |
| Sprite Loaders | Unit test frame parsing with known `.shp`/`.tmp` binary test fixtures | Validate frame count, dimensions, palette indices |

### 5.2 Per-Phase Test File Estimates

| Phase | Files | Test Files | Estimated Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: C&C Core Traits | 47 | ~42 | ~280 | ~9,500 |
| B: D2K Mod Traits | 17 | ~15 | ~90 | ~3,000 |
| C: C&C Rendering & Voxel | 37 | ~28 | ~200 | ~7,000 |
| D: Supporting Infrastructure | 18 | ~14 | ~120 | ~4,000 |
| **Total** | **119** | **~99** | **~690** | **~23,500** |

### 5.3 Visual Acceptance Testing

The following manual test pages are needed for rendering-heavy systems:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Voxel body rendering | `/test/ch19-cnc/voxel-body/` | Verify multi-part voxel model (body+turret+barrel) renders with correct rotation, limb attachment, and facing |
| Voxel walker animation | `/test/ch19-cnc/voxel-walker/` | Verify walker leg animation during movement, idle, and turning states |
| Chrono-vortex effect | `/test/ch19-cnc/chrono-vortex/` | Verify chrono vortex particle effect, screen post-process, and teleport fade-in/fade-out |
| Tesla zap | `/test/ch19-cnc/tesla-zap/` | Verify Tesla zap beam rendering (LinesMesh), charge overlay animation, and bolt branching |
| Ion cannon | `/test/ch19-cnc/ion-cannon/` | Verify ion beam descent, ground splash, and screen shake |
| Disguise visual swap | `/test/ch19-cnc/disguise/` | Verify disguise mesh swap, reveal on attack, tooltip/healthbar identity display |
| Sandworm emerge/swallow | `/test/ch19-d2k/sandworm/` | Verify underground movement, emerge animation, swallow attack, and submerge animation |
| Sonic blast | `/test/ch19-d2k/sonic-blast/` | Verify sonic blast beam, expanding ring effect, and screen shake |
| D2K concrete building placement | `/test/ch19-d2k/concrete-placement/` | Verify concrete slab rendering, green/red placement preview, and building placement validation |
| C&C infantry body layers | `/test/ch19-cnc/infantry-body/` | Verify multi-layer infantry sprite rendering (body + attack overlay + idle overlay) |
| Drop pods | `/test/ch19-cnc/drop-pods/` | Verify drop pod descent, scatter, impact effect, and unit deployment |
| Leap attack | `/test/ch19-cnc/leap-attack/` | Verify parabolic leap arc, landing impact, and attack trigger |

### 5.4 Key Test Items (Precision-Critical)

- [ ] **TEST-19.1** Blowfish encryption: validate encrypt/decrypt matches C# output byte-for-byte for 10 known test vectors (key sizes 4-56 bytes)
- [ ] **TEST-19.2** LCW decompression: validate output matches C# for 5 known compressed streams from TD SHP files
- [ ] **TEST-19.3** LZO decompression: validate output matches C# for 5 known compressed streams from TS voxel data
- [ ] **TEST-19.4** Chronoshift deferred action: verify teleport is queued during tick and applied in `frameEndActions`, with correct position at each state transition
- [ ] **TEST-19.5** Infiltration composition order: verify all `InfiltrateFor*` effects execute in correct order on a single infiltrate action
- [ ] **TEST-19.6** Disguise identity: verify tooltip, health bar, and selection box all display disguised identity; verify attacking breaks disguise
- [ ] **TEST-19.7** Sandworm state machine: verify underground→emerge→attack→submerge state transitions at correct timings
- [ ] **TEST-19.8** GPS reveal lifetime: verify GPS reveals shroud on activation and re-freezes on deactivation
- [ ] **TEST-19.9** Tesla charge-up: verify `INotifyTeslaCharging` event fires at correct timing during charge-up sequence
- [ ] **TEST-19.10** Voxel normal-to-color: validate normal-to-color lookup produces correct ARGB values for 256 input normals against C# reference
- [ ] **TEST-19.11** Classic facing quantization: verify `ClassicQuantizeFacing()` maps all 32 WAngle steps to correct 8 classic directions
- [ ] **TEST-19.12** SHP frame parsing: validate ShpTDLoader extracts correct frame count, dimensions, and pixel data for 3 reference SHP files
- [ ] **TEST-19.13** D2K concrete coverage: verify building placement rejects cells with < minimum concrete coverage
- [ ] **TEST-19.14** Mad Tank detonation: verify screen shake intensifies during countdown, then AoE damage + self-destruct on detonation
- [ ] **TEST-19.15** Cloneable + ClonesProducedUnits: verify clone is spawned at rally point with correct facing when producing unit from cloneable

### 5.5 Integration Test Items

- [ ] **TEST-19.I1** Chronoshift + Mobile: teleport a moving unit, verify position is correct and movement resumes
- [ ] **TEST-19.I2** Infiltrates + Enter + multiple InfiltrateFor*: infiltrate building with all 7 InfiltrateFor* effects, verify all apply in correct order
- [ ] **TEST-19.I3** Sandworm + AttackSwallow + IMove: sandworm emerges, swallows moving harvester, verify harvester destroyed and sandworm submerges
- [ ] **TEST-19.I4** GPS + Shroud + Fog: activate GPS, verify shroud reveals, move unit, deactivate GPS, verify fog freezes at last known positions
- [ ] **TEST-19.I5** AttackLeap + EdibleByLeap + AttackSwallow: leap-attack an edible unit, verify unit destroyed and leaper returns to idle
- [ ] **TEST-19.I6** D2kBuilding + BuildableTerrainLayer + PlaceBuilding: attempt placement without concrete, with partial concrete, with full concrete — verify correct accept/reject

---

## 6. Risk and Considerations

### 6.1 Risk Matrix

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Voxel rendering pipeline complexity** (14 files, custom GPU pipeline) | **HIGHEST** | Voxel rendering is a completely custom CPU-to-GPU pipeline with no Babylon.js built-in equivalent. Incorrect implementation breaks all TS/RA2 mod visuals. | Port VxlReader + HvaReader line-for-line. Build-time `.vxl`→`.glb` conversion reduces runtime complexity from ~2,000 C# lines to ~500 TS lines. Validate against C# reference renders at 5 known camera angles. |
| **Sandworm underground state machine** | **HIGH** | Complex state machine with cell-based underground movement, emergence timing, and swallow attack. Bugs break D2K gameplay. | Port `Sandworm.Tick()` state machine line-for-line. Validate emergence positions at 10 evenly-spaced ticks against C# reference. |
| **Chronoshift mid-tick state mutation** | **MEDIUM** | Teleport during tick could cause cascade of dependent trait updates. | Enforce deferred action pattern: queue teleport in tick, apply in `frameEndActions` (matches ADR-8.1). |
| **Voxel animation without bones** | **MEDIUM** | Multi-part voxel models (body+turret+barrel+walker legs) animate via direct transform updates, not skeletal animation. Babylon.js has no first-class support for this pattern. | Parent-child `TransformNode` hierarchy. Each part is a separate Mesh with position/rotation set per frame. Validate timing matches C#. |
| **File format binary parsing precision** (6 compression/format files) | **MEDIUM** | Custom binary formats (LCW, LZO, XOR Delta, Blowfish encryption) must decompress byte-for-byte identically. One-bit error cascades to corrupt all sprite/voxel data. | Port compression algorithms line-for-line from C#. Validate against known test vectors from C# output. Unit test every code path. |
| **Sprite sequence format differences** (Classic vs TilesetSpecific vs D2k) | **MEDIUM** | Different OpenRA mods use different sprite sequence formats. Wrong sequence parser breaks all sprite animations for that mod. | Port ShpTDLoader, ShpD2Loader, TmpTDLoader, TmpRALoader, TmpTSLoader individually. Each tested against known reference sprite frame data. |
| **Infiltration trait stacking order** | **LOW** | Multiple InfiltrateFor* traits on same actor must compose correctly. Wrong order produces different game outcomes. | Document composition order (cash → decoration → exploration → power → support → reset → transform). Verify with 3-trait stack integration test. |
| **GPS + Shroud interaction** | **LOW** | GPS provides temporary shroud reveal; must integrate with Ch12 fog/shroud system without breaking fog-of-war semantics. | `FrozenUnderFogUpdatedByGps` extends Ch12 `FrozenUnderFog`. GPS applies `GpsWatcher` condition token; shroud query checks for active GPS tokens. |
| **Tesla/Ion custom rendering performance** | **LOW** | Tesla zap uses dynamic `LinesMesh` which can be expensive if created per frame. Ion cannon beam uses large cylinder mesh. | Pool `LinesMesh` instances. Reuse vertex buffers. Cap at 10 simultaneous zaps. Ion beam is short-lived (destroy after impact). |
| **D2K SonicBlast screen shake** | **LOW** | Sonic blast applies screen shake differently from Ch8 ShakeScreenWarhead. | Reuse Ch7 Phase B Viewport shake mechanism with SonicBlast-specific intensity/duration curve. |
| **Mod content lazy loading** | **LOW** | Dynamic `import()` for mod traits may cause load-time delays when switching mods. 119 files of C&C/D2K traits must load before gameplay starts. | Preload mod chunks during loading screen. Use `import()` with `Promise.all()` for parallel loading. Cache loaded mod chunks in IndexedDB. |
| **D2K MapGenerator dependency** | **LOW** | D2kMapGenerator (664 lines) and TSMapGenerator (975 lines) are deferred. Random map generation is not available at launch. | Explicitly communicate limitation. Provide ample pre-built maps. Implement map generators as post-MVP feature. |

### 6.2 Browser-Specific Limitations

| Limitation | Affected System | Workaround |
|:---|:---|:---|
| No `SubtleCrypto` match for Blowfish | Blowfish encryption | Pure TypeScript implementation (ADR-19.4) |
| No native `DataView` 64-bit read (BigInt required) | Some binary format parsing | Use `DataView.getBigInt64()` with BigInt conversion to two 32-bit ints for Blowfish |
| `WebCodecs` API not universally available | VQA/WSA video playback | **Deferred** (ADR-19B). Video cutscenes are non-essential. |
| `AudioContext.decodeAudioData()` does not support AUD/VOC | C&C audio playback | **Build-time conversion** to WAV/Opus (ADR-19C). Runtime only handles standard formats. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-19.1: Voxel Rendering Strategy — Build-Time glTF Conversion

**Decision**: C&C voxel models (`.vxl` + `.hva`) are converted to glTF binary (`.glb`) at **build time** by a Node.js tool. At runtime, the voxel rendering subsystem loads pre-converted glTF meshes via `SceneLoader.ImportMeshAsync()` and manages them as `TransformNode` hierarchies.

**Rationale**: The original C# voxel pipeline (~2,000 lines) software-rasterizes 3D voxels to 2D sprites via `VoxelRenderer` → `VoxelCache` → `SheetBuilder` → `Sprite`. This completely misses the paradigm shift opportunity. Instead, converting to glTF at build time: (1) Eliminates the entire runtime software rasterizer — ~2,000 C# lines collapse to ~500 TS lines of mesh management; (2) Leverages Babylon.js built-in glTF loading, materials, and node hierarchy; (3) Enables standard 3D features (lighting, shadows, post-processing) on voxel models for free; (4) Multi-part models (body + turret + barrel) map naturally to parent-child `TransformNode` hierarchies.

**Alternatives Considered**:
- **A — Runtime WebGL voxel renderer**: Build a custom `ShaderMaterial` + instanced cube renderer at runtime. More authentic (matches C# behavior exactly) but significantly higher implementation effort (~3,000 TS lines) and maintenance burden. Rejected for MVP.
- **B — Convert to sprite sheets at build time**: Preserve the 2D sprite pipeline. Simplest implementation but loses the 3D paradigm shift entirely. Rejected because it's architecturally regressive.
- **C — Hybrid**: glTF for static models, sprite sheets for animated multi-part models. Rejected due to increased complexity of maintaining two parallel rendering paths.

**Consequences**:
- Requires a separate build-time Node.js tool (`vxl2gltf`) not part of the browser bundle
- 14-file voxel subsystem collapses to ~8 TypeScript files (thin runtime wrappers)
- `VoxelCache.cs`, `VoxelLoader.cs`, `ModelRenderer.cs` become substantially simpler
- `VoxelNormalsPalette.cs` becomes a `RawTexture` lookup uniform in a `ShaderMaterial`
- Visual fidelity may differ from C# reference (acceptable — this is a 3D upgrade, not a pixel-exact port)

### ADR-19.2: Mod-Specific Code Lazy Loading

**Decision**: C&C and D2K traits are loaded via dynamic `import()` based on the active mod manifest. The base bundle (`OpenRA.Mods.Common`) contains only shared traits. C&C and D2K traits are separate chunks fetched at runtime when the corresponding mod is active.

**Rationale**: Bundling all 119 C&C/D2K files into the main bundle would bloat the base game (~18,500 TS lines of mod code that 90% of players never use in a given session). Lazy loading keeps the base bundle lean and enables per-mod caching. The `Manifest` class (Ch5) already provides the mod resolution infrastructure to determine which mod is active.

**Alternatives Considered**:
- **A — Static bundling with `import`**: All mod code bundled statically, tree-shaken by Vite. Simpler but still bundles unused mod code when multiple mods are installed.
- **B — Server-side mod compilation**: Mod traits are compiled to JS on the server and served as separate scripts. Overly complex for MVP.

**Consequences**:
- Mod switch requires a network fetch + module evaluation (~200-500ms for C&C, ~50-100ms for D2K)
- Traits must self-register at import time (side-effect import pattern)
- Build configuration needs per-mod entry points for chunk splitting
- Mod chunks can be cached in IndexedDB for offline play

### ADR-19.3: Infiltration Trait Composition Pattern

**Decision**: `Infiltrates` is the base trait that owns the infiltration lifecycle (enter target, trigger effects, self-destruct). Each `InfiltrateFor*` trait implements a single effect (`applyInfiltrate(target, infiltrator)`). The composition order is defined by a priority integer on each trait; effects execute in ascending priority order.

**Rationale**: This preserves OpenRA's architecture where infiltration effects are independent composable traits rather than a monolithic `Infiltrate` class with a switch statement. Adding a new infiltration effect requires only creating a new trait file — no modification to existing code.

**Consequences**: Composition order must be validated in integration tests. Trait priority must be documented and respected by all new infiltration effects.

### ADR-19.4: Sandworm Underground State Representation

**Decision**: Sandworm underground state is represented by `Mesh.isVisible = false` + collision disabled. Emergence is a Y-axis height interpolation from underground (Y = terrainHeight - depthOffset) to surface (Y = terrainHeight). The state machine (underground → emerging → surfaced → submerging → underground) is implemented as a TypeScript enum with tick-driven transitions.

**Rationale**: This is simpler than OpenRA's C# approach (separate actor layer for underground actors) because Babylon.js provides built-in visibility and collision toggles. The 3D height animation provides visual feedback that 2D C# does not have.

**Consequences**: Sandworm collision with above-ground actors must be explicitly managed — collision is disabled underground, enabled when surfaced.

### ADR-19.5: Chronoshift Deferred Teleport Pattern

**Decision**: Chronoshift teleport follows the same deferred-action pattern as warhead resolution (ADR-8.1): teleport is queued during `Chronoshiftable.Tick()`, applied in `world.frameEndActions`. This prevents mid-tick position mutation from cascading into dependent trait updates.

**Rationale**: If teleport were applied immediately during tick, subsequent trait ticks in the same frame would see the new position, potentially triggering move-blocking, path recalculation, or other cascading effects that differ from C# behavior. Deferred application ensures all traits see the pre-teleport position during tick, matching C# execution order.

**Consequences**: The `Teleport` activity's `TickOuter` must account for the one-frame delay between queuing and application.

### ADR-19.6: Multi-Part Voxel Model Hierarchy

**Decision**: Multi-part voxel models (body + turret + barrel + walker legs) use a parent-child `TransformNode` hierarchy in Babylon.js: body is the root node, turret is a child of body, barrel is a child of turret, legs are children of body. Per-frame rotation updates propagate automatically through the hierarchy.

**Rationale**: This maps naturally to both the C# limb hierarchy (`.hva` defines limb transform matrices relative to parent limbs) and to Babylon.js's scene graph. `Turreted.LocalYaw` sets `turretNode.rotation.y`. `Armament.BarrelPitch` sets `barrelNode.rotation.x`. The hierarchy handles the rest.

**Consequences**: Limb attachment points (pivot offsets) must be extracted from `.hva` data or authored in the glTF. Misaligned pivots produce visually incorrect models.

### ADR-19.7: Sprite Sequence Loader Factory Pattern

**Decision**: C&C/D2K sprite loaders (`ShpTDLoader`, `ShpD2Loader`, `R8Loader`, etc.) implement a shared `ISpriteLoader` interface. A factory function `createSpriteLoader(format: string): ISpriteLoader` dispatches to the correct loader based on format identifier in the sprite file header.

**Rationale**: This follows the established pattern from Chapter 2's sprite infrastructure. New sprite formats can be added by implementing the interface and registering in the factory.

**Consequences**: The factory must test file headers to distinguish between similar formats (e.g., TD SHP vs D2K SHP share the same magic number but differ in frame count encoding).

### ADR-19.8: File Format Compression — Line-for-Line Port Strategy

**Decision**: All C&C proprietary compression algorithms (`LCWCompression`, `LZOCompression`, `XORDeltaCompression`, `Blowfish`) are ported line-for-line from C# to TypeScript. Algorithm logic is identical to the C# reference; only I/O primitives (`Stream.ReadByte()` → `DataView.getUint8()`) differ.

**Rationale**: These are mature, bug-free algorithms that have been battle-tested for over a decade in OpenRA. Re-implementing with different algorithms (e.g., using browser-native `DecompressionStream` for LCW) would risk byte-level divergence that could corrupt sprite/voxel data. Line-for-line porting guarantees identical behavior.

**Consequences**: TypeScript implementations may be slightly less performant than native browser APIs but are equally correct. Performance is acceptable because decompression happens at asset-load time, not per frame.

### ADR-19.9: Legacy Utility Commands as Build-Time Tools

**Decision**: All C&C and D2K `UtilityCommands/` files (13 files, ~3,200 C# lines) are implemented as build-time Node.js scripts, not bundled into the browser runtime. This affects legacy map importers (ImportGen1Map, ImportRedAlertMap, ImportTiberianSunMap, etc.) and asset conversion tools (ConvertPngToShp, LegacySequenceImporter, etc.).

**Rationale**: These are development tools used for asset pipeline operations, never at runtime. Bundling them into the browser would bloat the bundle with ~3,200 lines of never-called code. Node.js scripts provide the same functionality without runtime overhead.

**Consequences**: Map conversion and asset import operations require running Node.js scripts, not browser UI. Acceptable for MVP; browser-based map import can be a future enhancement.

### ADR-19.10: Proprietary Audio/Video Format Strategy

**Decision**: (Audio) C&C AUD/VOC audio formats are converted to standard WAV/Opus at build time using ported `AudReader`/`VocLoader` logic in Node.js. The browser runtime only handles standard web audio formats. (Video) VQA/WSA video playback is deferred to post-MVP; cutscenes are non-essential for gameplay.

**Rationale**: Implementing proprietary audio codecs in the browser adds significant complexity for marginal value. `VocLoader.cs` alone is 394 lines of C# with multiple codec variants (PCM, ADPCM, etc.). Browser `AudioContext.decodeAudioData()` handles all standard formats for free. Video is even more complex — VQA/WSA require custom frame decoders with no browser API equivalent.

**Consequences**: `AudLoader.cs`, `AudReader.cs`, `VocLoader.cs` (combined ~673 lines) become build-time Node.js tools. `VqaVideo.cs`, `WsaVideo.cs`, `VqaLoader.cs`, `WsaLoader.cs` (combined ~833 lines) are excluded from MVP scope. Audio assets must be pre-converted to WAV/Opus during the build pipeline.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` — Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.12 — Original Ch19 file listing and ADRs
> - `docs/chapter8_weapons_combat_migration_plan.md` — Plan format reference (template)
> - `docs/chapter18_server_system_migration_plan.md` — Another reference example (Chapter 18 plan)
> - `docs/migration_progress.md` — Progress tracking
> - `CLAUDE.md` — Project conventions
> - `OpenRA/OpenRA.Mods.Cnc/` — C&C C# source (reference only, 140 files)
> - `OpenRA/OpenRA.Mods.D2k/` — D2K C# source (reference only, 23 files)
