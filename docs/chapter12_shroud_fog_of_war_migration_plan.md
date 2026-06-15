# OpenRA to Babylon.js Migration Plan: Chapter 12 -- Shroud & Fog of War

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits -- Visibility System)
> **Chapter Status**: PLANNED (0/15 migrated, Phase A only)
> **Planning Date**: 2026-06-15
> **Prerequisite**: Chapters 2-8 COMPLETE (219/219, 100%), Chapter 9 (Movement) COMPLETE, Chapter 10 (Economy) COMPLETE, Chapter 11 (Production) COMPLETE
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Shroud System](#31-phase-a-shroud-system)
4. [Key Paradigm Shifts](#4-key-paradigm-shifts)
5. [Dependency Graph](#5-dependency-graph)
6. [Verification and Test Strategy](#6-verification-and-test-strategy)
7. [Risk and Considerations](#7-risk-and-considerations)
8. [Appendix: Architecture Decisions Record (ADR)](#8-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Shroud & Fog of War system shifts from **2D tile-based sprite overlay rendering** to **GPU-driven fog-of-war via RenderTargetTexture (RTT) with custom ShaderMaterial**. This is one of the most visually distinctive subsystems in an RTS -- it controls what each player can see, remember, and target.

The core paradigm shifts:

- **Shroud cell state tracking** (C# `ProjectedCellLayer<short>` count arrays) -> **TypeScript `Uint8Array` visibility bitfield per cell** with reactive dirty tracking
- **Shroud edge sprite rendering** (C# `TerrainSpriteLayer` with 12 directional shroud/fog sprite variants) -> **Babylon.js RTT + custom ShaderMaterial** that blends between revealed/explored/hidden states using the visibility texture
- **Frozen actor capture** (C# `FrozenActorLayer` with `IRenderable` snapshots) -> **Per-player frozen actor registry** with static `TransformNode` clones and reduced-opacity materials
- **Cloak visibility** (C# `IRenderModifier` alpha/palette/color tint) -> **Babylon.js material alphaMode / emissive color / custom shader** per cloak style
- **Actor visibility queries** (C# `IDefaultVisibility` + `IVisibilityModifier` interface chain) -> **TypeScript visibility service** with cached per-player visibility results

### 1.2 Architecture Principles

1. **Per-player shroud isolation**: Each `Player` has an independent `Shroud` instance. Visibility state is never shared between players. The shroud texture is player-specific.

2. **Lazy shroud resolution**: Cell visibility is resolved only when `touched` (dirty) cells exist. The `Tick()` loop skips entirely when no sources have changed. This matches OpenRA's `anyCellTouched` optimization.

3. **Three-state visibility model**: Each cell has three states -- `Hidden` (unexplored black shroud), `Explored` (fog of war -- terrain visible but no live unit updates), `Visible` (fully visible -- live units, animations, effects). This maps to RGB channels in the shroud texture.

4. **Source-based visibility accounting**: `Shroud.AddSource()` / `RemoveSource()` track visibility by source object (each `RevealsShroud`, `CreatesShroud`, `RevealsMap` trait instance). Multiple sources can affect the same cell; counts are reference-counted.

5. **Frozen actor as static snapshot**: When an enemy actor leaves visible range, its last-known state (position, health, owner, renderables) is captured in a `FrozenActor`. Frozen actors render with reduced opacity and do not update visually.

6. **Cloak as material effect**: Cloaked actors are not removed from the scene graph. Instead, their material is modified (alpha reduction, color tint, or palette swap) based on `CloakStyle`. This preserves culling and spatial queries.

7. **Visibility drives rendering, not existence**: Actors always exist in the `World` scene graph. Visibility traits (`HiddenUnderShroud`, `HiddenUnderFog`) control whether renderables are passed to the renderer, not whether the actor exists.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-11 is available for Chapter 12:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, `Scene`, `RenderTargetTexture` |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, `TerrainSpriteLayer` |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, `TraitDictionary` |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IRender`, `ConditionManager` |
| Map + Terrain + CellLayers | Ch4 | `Map`, `CellLayer`, `ProjectedCellLayer`, `CellRegion`, `MPos`, `PPos`, `CPos` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, deterministic state verification |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Viewport`, `SelectionUtils` |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` |
| Effects + Projectile base | Ch7 Phases E-F | `SpriteEffect`, `FloatingSpriteEmitter`, `Bullet` |
| RenderSprites + AnimationWithOffset | Ch7 Phase G | `RenderSprites`, `AnimationWithOffset` |
| Weapons & Combat | Ch8 | `Armament`, `AttackBase`, `AutoTarget`, `HitShape`, `Warhead` |
| Movement & Physics | Ch9 | `Mobile`, `Aircraft`, `Locomotor`, pathfinding |
| Resource & Economy | Ch10 | `Harvester`, `ResourceLayer`, `PlayerResources` |
| Production & Building | Ch11 | `Production`, `Building`, `PlaceBuilding`, `ProductionQueue` |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (15 files across Phase A)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Shroud System** | | | | | |
| 1 | `OpenRA.Game/Traits/Player/Shroud.cs` | `src/OpenRA.Game/Traits/Player/Shroud.ts` | `Shroud` | 514 | HIGHEST | A |
| 2 | `OpenRA.Mods.Common/Traits/World/ShroudRenderer.cs` | `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` | `ShroudRenderer` | 390 | HIGHEST | A |
| 3 | `OpenRA.Game/Traits/Player/FrozenActorLayer.cs` | `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` | `FrozenActorLayer` / `FrozenActor` | 385 | HIGH | A |
| 4 | `OpenRA.Mods.Common/Traits/Cloak.cs` | `src/OpenRA.Mods.Common/Traits/Cloak.ts` | `Cloak` | 374 | HIGH | A |
| 5 | `OpenRA.Mods.Common/Traits/AffectsShroud.cs` | `src/OpenRA.Mods.Common/Traits/AffectsShroud.ts` | `AffectsShroud` | 174 | MEDIUM | A |
| 6 | `OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.cs` | `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts` | `FrozenUnderFog` | 190 | MEDIUM | A |
| 7 | `OpenRA.Mods.Common/Traits/RevealsMap.cs` | `src/OpenRA.Mods.Common/Traits/RevealsMap.ts` | `RevealsMap` | 92 | MEDIUM | A |
| 8 | `OpenRA.Mods.Common/Traits/Player/PlayerRadarTerrain.cs` | `src/OpenRA.Mods.Common/Traits/Player/PlayerRadarTerrain.ts` | `PlayerRadarTerrain` | 97 | MEDIUM | A |
| 9 | `OpenRA.Mods.Common/Traits/CreatesShroud.cs` | `src/OpenRA.Mods.Common/Traits/CreatesShroud.ts` | `CreatesShroud` | 66 | LOW | A |
| 10 | `OpenRA.Mods.Common/Traits/RevealsShroud.cs` | `src/OpenRA.Mods.Common/Traits/RevealsShroud.ts` | `RevealsShroud` | 72 | LOW | A |
| 11 | `OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.cs` | `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.ts` | `HiddenUnderShroud` | 72 | LOW | A |
| 12 | `OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.cs` | `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.ts` | `HiddenUnderFog` | 41 | LOW | A |
| 13 | `OpenRA.Mods.Common/Traits/DetectCloaked.cs` | `src/OpenRA.Mods.Common/Traits/DetectCloaked.ts` | `DetectCloaked` | 54 | LOW | A |
| 14 | `OpenRA.Mods.Common/ShroudExts.cs` | `src/OpenRA.Mods.Common/ShroudExts.ts` | `ShroudExts` | 48 | LOW | A |
| 15 | `OpenRA.Mods.Cnc/Traits/World/ShroudPalette.cs` | `src/OpenRA.Mods.Cnc/Traits/World/ShroudPalette.ts` | `ShroudPalette` | 70 | LOW | A |
| -- | `OpenRA.Mods.Common/Traits/Multipliers/RevealsShroudMultiplier.cs` | `src/OpenRA.Mods.Common/Traits/Multipliers/RevealsShroudMultiplier.ts` | `RevealsShroudMultiplier` | 34 | LOW | A (optional) |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies. 28-80 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple trait interactions or rendering integration. 90-200 lines of C# with Babylon.js visual components.
> - **HIGH**: Complex gameplay logic with state machines, spatial queries, or significant rendering. 190-400 lines of C# with significant Babylon.js integration.
> - **HIGHEST**: Core infrastructure with hot-path performance concerns, complex algorithms, or extensive rendering pipelines. 380-520+ lines of C#.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 15 (16 with optional RevealsShroudMultiplier) |
| **HIGHEST complexity** | 2 files (Shroud.cs 514 lines, ShroudRenderer.cs 390 lines) |
| **HIGH complexity** | 2 files (FrozenActorLayer.cs 385 lines, Cloak.cs 374 lines) |
| **MEDIUM complexity** | 4 files (AffectsShroud, FrozenUnderFog, RevealsMap, PlayerRadarTerrain) |
| **LOW complexity** | 7 files (CreatesShroud, RevealsShroud, HiddenUnderShroud, HiddenUnderFog, DetectCloaked, ShroudExts, ShroudPalette) |
| **Total OpenRA C# source lines** | ~2,594 (2,628 with optional) |

| Phase | Files | C# Lines | TS Lines (est.) | Tests (est.) | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Shroud System | 15 | 2,594 | ~5,500-7,000 | ~200-250 | **IN PROGRESS (7/15)** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Shroud System

**Status**: IN PROGRESS (7/15 migrated)
**Complexity**: HIGHEST (Shroud.cs 514 lines, ShroudRenderer.cs 390 lines)
**Blocked by**: Chapter 4 (Map, CellLayers, ProjectedCellLayer), Chapter 3 (Player, Actor, TraitDictionary), Chapter 2 (Renderer, WorldRenderer, TerrainSpriteLayer)
**Blocks**: Chapter 13 (Support Powers -- some require shroud visibility), Chapter 16 (RadarWidget -- depends on PlayerRadarTerrain), Chapter 19 (GPS/Sensors -- GpsDot, GpsWatcher interact with shroud)

**Completed**:
- [x] TODO-12.A.1 `Shroud.ts` -- per-player visibility state tracker (APPROVED, 2026-06-15)
- [x] TODO-12.A.2 `ShroudRenderer.ts` -- visual shroud/fog overlay renderer (APPROVED, 2026-06-15)
- [x] TODO-12.A.3 `FrozenActorLayer.ts` -- per-player frozen actor snapshot system (APPROVED R2, 2026-06-15)
- [x] TODO-12.A.4 `Cloak.ts` -- stealth/cloak system (APPROVED, 2026-06-15)
- [x] TODO-12.A.5 `AffectsShroud.ts` -- abstract base for shroud-affecting traits (APPROVED, 2026-06-15)
- [x] TODO-12.A.7 `RevealsMap.ts` -- full-map reveal trait (APPROVED, 2026-06-15)
- [x] TODO-12.A.14 `ShroudExts.ts` -- shroud extension methods (APPROVED, 2026-06-15)

**Remaining**: 8 files

**Description**: The shroud system controls what each player can see on the map. It has three layers: (1) `Shroud` -- per-player visibility state tracking with source-based reference counting, (2) `ShroudRenderer` -- visual overlay rendering of shroud/fog edges using sprite variants, (3) `FrozenActorLayer` -- per-player snapshot of enemy actors that have left visible range. Supporting traits include `RevealsShroud` (units reveal area), `CreatesShroud` (units generate darkness for enemies), `HiddenUnderShroud`/`HiddenUnderFog` (actors hide when not visible), `FrozenUnderFog` (buildings freeze when fogged), `Cloak` (stealth system), and `DetectCloaked` (detection of cloaked units).

**Paradigm Shifts**:
- C# `ProjectedCellLayer<short>` count arrays -> TypeScript `Uint8Array` visibility bitfield with dirty tracking
- C# `TerrainSpriteLayer` shroud/fog sprite overlay -> Babylon.js RTT + custom ShaderMaterial
- C# `FrozenActor` with `IRenderable[]` snapshot -> Per-player frozen actor registry with `TransformNode` clones and reduced-opacity `StandardMaterial`
- C# `IRenderModifier` cloak alpha/palette/color -> Babylon.js `material.alpha` / `emissiveColor` / custom shader
- C# `IDefaultVisibility` interface chain -> TypeScript `VisibilityService` with cached per-player results

#### 3.1.1 Shroud

- [x] **TODO-12.A.1** `src/OpenRA.Game/Traits/Player/Shroud.ts` (514 lines C#) -- Per-player visibility state tracker: ✅ COMPLETE (APPROVED, 2026-06-15)
  - `CellVisibility` enum: `Hidden = 0x0`, `Explored = 0x1`, `Visible = 0x2`
  - `SourceType` enum: `PassiveVisibility`, `Shroud`, `Visibility`
  - `ShroudSource` record: `(type: SourceType, projectedCells: PPos[])`
  - `sources: Map<object, ShroudSource>` -- reference-counted visibility sources
  - `passiveVisibleCount: ProjectedCellLayer<short>` -- passive visibility (RevealsShroud without generated shroud reveal)
  - `visibleCount: ProjectedCellLayer<short>` -- active visibility
  - `generatedShroudCount: ProjectedCellLayer<short>` -- shroud generation (CreatesShroud)
  - `explored: ProjectedCellLayer<boolean>` -- has this cell ever been explored
  - `touched: ProjectedCellLayer<boolean>` -- dirty flag for cell re-resolution
  - `resolvedType: ProjectedCellLayer<ShroudCellType>` -- cached resolved state per cell
  - `OnShroudChanged: Event<PPos>` -- event fired when cell visibility changes
  - `Disabled: boolean` -- disables shroud (all cells visible)
  - `FogEnabled: boolean` -- fog of war enabled
  - `ExploreMapEnabled: boolean` -- map starts fully explored
  - `Hash: number` -- sync hash for network determinism
  - `AddSource(key, type, projectedCells)` -- add visibility source
  - `RemoveSource(key)` -- remove visibility source
  - `ExploreProjectedCells(cells)` -- mark cells as explored
  - `ExploreAll()` -- explore entire map
  - `ResetExploration()` -- reset to current visibility only
  - `IsExplored(pos/cell/puv)` -- is cell explored (was ever visible)
  - `IsVisible(pos/cell/puv)` -- is cell currently visible
  - `GetVisibility(puv)` -- combined visibility state
  - `ProjectedCellsInRange(map, pos, minRange, maxRange, maxHeightDelta)` -- static helper for range queries
  - **PERF**: Hot-path loop in `Tick()` uses direct index iteration, converting to `PPos` only when needed
  - **PERF**: `UpdateCell()` only fires `OnShroudChanged` when resolved type actually changes
  - **Status**: Migrated, reviewed, APPROVED. Also updated `Sync.ts` and `Sync.test.ts` for shroud sync hash integration.

#### 3.1.2 ShroudRenderer

- [x] **TODO-12.A.2** `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` (390 lines C#) -- Visual shroud/fog overlay renderer: ✅ COMPLETE (APPROVED, 2026-06-15)
  - `Edges` enum: bitflags for `TopLeft`, `TopRight`, `BottomRight`, `BottomLeft`, `TopSide`, `RightSide`, `BottomSide`, `LeftSide`
  - `Neighbor` enum: `Top`, `Right`, `Bottom`, `Left`, `TopLeft`, `TopRight`, `BottomRight`, `BottomLeft`
  - `TileInfo` struct: `(screenPosition: Vector3, variant: number)`
  - `shroudLayer: TerrainSpriteLayer` -- shroud sprite overlay layer
  - `fogLayer: TerrainSpriteLayer` -- fog sprite overlay layer
  - `shroudSprites: (Sprite, scale, alpha)[]` -- loaded shroud sprite variants
  - `fogSprites: (Sprite, scale, alpha)[]` -- loaded fog sprite variants
  - `edgesToSpriteIndexOffset: number[]` -- mapping from edge bitmask to sprite index
  - `notVisibleEdgesPair: (Edges, Edges)` -- default edges when cell is hidden
  - `variantStride: number` -- sprites per variant
  - `GetNeighborsVisibility(puv)` -- query 8 neighboring cells' visibility
  - `GetEdges(neighbors, visibleMask)` -- compute edge bitmask from neighbor visibility
  - `GetEdges(puv)` -- combined shroud + fog edges for a cell
  - `WorldOnRenderPlayerChanged(player)` -- switch to new player's shroud
  - `UpdateShroud(region)` -- update dirty cells in region
  - `UpdateShroudCell(puv)` -- mark cell and neighbors dirty
  - `GetSprite(sprites, edges, variant)` -- lookup sprite for edge combination
  - `RenderShroud(wr)` -- draw fog and shroud layers
  - **3D migration**: Replace `TerrainSpriteLayer` with Babylon.js RTT + ShaderMaterial
  - **3D migration**: Edge-based sprite variants become shader-based edge blending
  - `info.Sequence` -- shroud sprite sequence name
  - `info.ShroudVariants` / `info.FogVariants` -- variant names
  - `info.ShroudPalette` / `info.FogPalette` -- palette references
  - `info.Index` -- bitfield mapping for frame indices
  - `info.UseExtendedIndex` -- extended edge detection
  - `info.OverrideFullShroud` / `info.OverrideFullFog` -- override sprites
  - **Status**: Migrated (~720 TS lines), reviewed (Round 2), APPROVED. 28 tests.

#### 3.1.3 FrozenActorLayer

- [x] **TODO-12.A.3** `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` (385 lines C#) -- Per-player frozen actor snapshot system: ✅ COMPLETE (APPROVED R2, 2026-06-15)
  - `FrozenActorLayerInfo` -- `BinSize: number` for spatial partition
  - `FrozenActor` class:
    - `Footprint: PPos[]` -- actor's projected cell footprint
    - `CenterPosition: WPos` -- last known position
    - `Viewer: Player` -- owning player
    - `Owner: Player` -- actor's owner at time of freeze
    - `TargetTypes: BitSet<TargetableType>` -- targetable types
    - `TargetablePositions: WPos[]` -- targetable positions
    - `TooltipInfo: ITooltipInfo` -- tooltip data
    - `TooltipOwner: Player` -- tooltip owner
    - `HP: number` -- health at freeze time
    - `DamageState: DamageState` -- damage state at freeze time
    - `Visible: boolean` -- is currently visible (under fog = not visible)
    - `NeedRenderables: boolean` -- needs renderable snapshot
    - `Renderables: IRenderable[]` -- captured renderables
    - `ScreenBounds: Rectangle[]` -- captured screen bounds
    - `MouseBounds: Polygon` -- captured mouse bounds
    - `RefreshState()` -- update from live actor
    - `RefreshHidden()` -- update visibility
    - `Invalidate()` -- mark as invalid (actor destroyed/captured)
  - `FrozenActorLayer` class:
    - `Add(frozenActor)` -- add frozen actor to layer
    - `Remove(frozenActor)` -- remove frozen actor
    - `FromID(id)` -- lookup by actor ID
    - `FromCell(cell)` -- lookup by cell (spatial query)
    - `Update(actor)` -- update frozen state from live actor
    - `TickRender(wr)` -- render frozen actors
  - **3D migration**: Frozen actors rendered as static `TransformNode` clones with `StandardMaterial` at alpha=0.5
  - **3D migration**: No live updates -- position, health, owner frozen at snapshot time
  - **Status**: Migrated, reviewed (Round 2), APPROVED. 63 tests. Commit `09437ba`.

#### 3.1.4 Cloak

- [x] **TODO-12.A.4** `src/OpenRA.Mods.Common/Traits/Cloak.ts` (374 lines C#) -- Stealth/cloak system: ✅ COMPLETE (APPROVED, 2026-06-15)
  - `UncloakType` enum flags: `Attack`, `Move`, `Load`, `Unload`, `Infiltrate`, `Demolish`, `Damage`, `Heal`, `SelfHeal`, `Dock`, `SupportPower`
  - `CloakStyle` enum: `None`, `Alpha`, `Color`, `Palette`
  - `CloakInfo`:
    - `InitialDelay: number` -- ticks before initial cloak
    - `CloakDelay: number` -- ticks before re-cloak after uncloak
    - `UncloakOn: UncloakType` -- events that trigger uncloak
    - `CloakSound` / `UncloakSound` -- audio effects
    - `DetectionTypes: BitSet<DetectionType>` -- detection classification
    - `CloakedCondition: string` -- condition granted while cloaked
    - `CloakType: string` -- cloak type (same types don't stack sounds)
    - `CloakStyle: CloakStyle` -- visual cloaking style
    - `CloakedAlpha: number` -- alpha for Alpha style (0.55)
    - `CloakedColor: Color` -- color for Color style
    - `CloakedPalette: string` -- palette for Palette style
    - `IsPlayerPalette: boolean` -- palette is player-specific
    - `EffectImage` / `CloakEffectSequence` / `UncloakEffectSequence` -- visual effects
    - `EffectPalette` / `EffectPaletteIsPlayerPalette` -- effect palette
    - `EffectOffset: WVec` -- effect position offset
    - `EffectTracksActor: boolean` -- effect follows actor
  - `Cloak` class:
    - `Cloaked: boolean` -- is currently cloaked
    - `Uncloak(time?)` -- force uncloak for N ticks
    - `IsVisible(self, viewer)` -- visibility check (detected by allied DetectCloaked in range)
    - `Tick(self)` -- advance cloak timer, handle state transitions
    - `ModifyRender(self, wr, r)` -- apply cloak visual effect
    - Event handlers: `Attacking`, `Damaged`, `Docked`, `Undocked`, `Loading`, `Unloading`, `Demolishing`, `Infiltrating`, `SupportPowerActivated`
  - **3D migration**: `Alpha` style -> `material.alpha = CloakedAlpha`
  - **3D migration**: `Color` style -> `material.emissiveColor = CloakedColor`
  - **3D migration**: `Palette` style -> custom shader material with palette swap
  - **Status**: Migrated, reviewed, APPROVED (0 BLOCKER, 0 MAJOR, 4 MINOR). Commit `fdd6ba2`.

#### 3.1.5 AffectsShroud

- [x] **TODO-12.A.5** `src/OpenRA.Mods.Common/Traits/AffectsShroud.ts` (174 lines C#) -- Abstract base for shroud-affecting traits: ✅ COMPLETE (APPROVED, 2026-06-15)
  - `AffectsShroudInfo`:
    - `MinRange: WDist` -- minimum range (donut reveal)
    - `Range: WDist` -- maximum reveal range
    - `MaxHeightDelta: number` -- height difference limit
    - `MoveRecalculationThreshold: WDist` -- movement threshold for recalculation
    - `Type: VisibilityType` -- `CenterPosition` or `Footprint`
  - `AffectsShroud` abstract class:
    - `cachedLocation: CPos` -- last known cell
    - `cachedRange: WDist` -- last known range
    - `cachedPos: WPos` -- last known position
    - `CachedTraitDisabled: boolean` -- trait disabled state
    - `footprint: Set<PPos>` -- cached footprint
    - Abstract methods: `AddCellsToPlayerShroud(self, player, uv)`, `RemoveCellsFromPlayerShroud(self, player)`
    - `Range: WDist` -- virtual property (overridden by subclasses with modifiers)
    - `Tick(self)` -- check position/range changes, update shroud sources
    - `ProjectedCellsInRange(map, pos, range)` -- static helper
  - Implements: `ISync`, `INotifyAddedToWorld`, `INotifyRemovedFromWorld`, `INotifyMoving`, `INotifyCenterPositionChanged`, `ITick`
  - **Status**: Migrated, reviewed, APPROVED (0 BLOCKER, 0 MAJOR, 4 MINOR). Commit `6472844`. Unlocks CreatesShroud + RevealsShroud.

#### 3.1.6 FrozenUnderFog

- [ ] **TODO-12.A.6** `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts` (190 lines C#) -- Building freeze-under-fog behavior:
  - `FrozenUnderFogInfo`:
    - `AlwaysVisibleRelationships: PlayerRelationship` -- relationships that can always see
    - `Requires<BuildingInfo>` -- only for buildings
  - `FrozenUnderFog` class:
    - `VisibilityHash: number` -- bit hash of visibility per player
    - `frozenStates: PlayerDictionary<FrozenState>` -- per-player frozen state
    - `isRendering: boolean` -- flag during render capture
    - `created: boolean` -- initialized flag
    - `FrozenState` inner class: `(frozenActor: FrozenActor, isVisible: boolean)`
    - `IsVisible(self, byPlayer)` -- visibility check (uses FrozenActorLayer when fogged)
    - `TickRender(wr, self)` -- capture renderables for frozen state
    - `OnVisibilityChanged(frozen)` -- callback from FrozenActorLayer
    - `OnOwnerChanged(self, oldOwner, newOwner)` -- update frozen actor on capture
    - `Disposing(self)` -- invalidate frozen actor
    - Implements: `ICreatesFrozenActors`, `IRenderModifier`, `IDefaultVisibility`, `ITickRender`, `ISync`, `INotifyCreated`, `INotifyOwnerChanged`, `INotifyActorDisposing`
  - `HiddenUnderFogInit` -- runtime flag init

#### 3.1.7 RevealsMap

- [x] **TODO-12.A.7** `src/OpenRA.Mods.Common/Traits/RevealsMap.ts` (92 lines C#) -- Full-map reveal trait: ✅ COMPLETE (APPROVED, 2026-06-15)
  - `RevealsMapInfo`:
    - `ValidRelationships: PlayerRelationship` -- who sees the reveal
    - `RevealGeneratedShroud: boolean` -- can reveal generated shroud
  - `RevealsMap` class:
    - `type: Shroud.SourceType` -- visibility or passive visibility
    - `AddCellsToPlayerShroud(self, player, uv)` -- adds all map projected cells
    - `RemoveCellsFromPlayerShroud(player)` -- removes all cells
    - `ProjectedCells(self)` -- returns `map.ProjectedCells`
    - Event handlers: `OnOwnerChanged`, `Disposing`, `Killed`
    - `TraitEnabled(self)` -- reveal all cells
    - `TraitDisabled(self)` -- remove all cells
  - Extends: `ConditionalTrait<RevealsMapInfo>`
  - **Status**: Migrated, reviewed, APPROVED (0 BLOCKER, 0 MAJOR, 3 MINOR). Commit `c1d906a`.

#### 3.1.8 PlayerRadarTerrain

- [ ] **TODO-12.A.8** `src/OpenRA.Mods.Common/Traits/Player/PlayerRadarTerrain.ts` (97 lines C#) -- Radar terrain color tracker:
  - `PlayerRadarTerrainInfo`:
    - `Requires<ShroudInfo>` -- requires shroud on player actor
  - `PlayerRadarTerrain` class:
    - `IsInitialized: boolean` -- initialization flag
    - `terrainColor: CellLayer<(uint, uint)>` -- per-cell terrain color pair
    - `shroud: Shroud` -- reference to player's shroud
    - `CellTerrainColorChanged: Event<MPos>` -- event when color changes
    - `UpdateShroudCell(puv)` -- update cells unprojected from shroud change
    - `UpdateTerrainCell(uv)` -- update single cell if visible
    - `UpdateTerrainCellColor(uv)` -- compute and store color
    - `WorldLoaded(w, wr)` -- initialize terrain color layer
    - `GetColor(map, radarTerrainLayers, uv)` -- static color lookup
    - `this[uv]` -- color accessor
  - Implements: `IWorldLoaded`

#### 3.1.9 CreatesShroud

- [ ] **TODO-12.A.9** `src/OpenRA.Mods.Common/Traits/CreatesShroud.ts` (66 lines C#) -- Shroud generation trait:
  - `CreatesShroudInfo`:
    - `ValidRelationships: PlayerRelationship` -- who is affected by generated shroud (Neutral | Enemy default)
  - `CreatesShroud` class:
    - `rangeModifiers: number[]` -- `ICreatesShroudModifier` multipliers
    - `AddCellsToPlayerShroud(self, player, uv)` -- add shroud source to player
    - `RemoveCellsFromPlayerShroud(self, player)` -- remove shroud source
    - `Range` override -- apply percentage modifiers
  - Extends: `AffectsShroud`

#### 3.1.10 RevealsShroud

- [ ] **TODO-12.A.10** `src/OpenRA.Mods.Common/Traits/RevealsShroud.ts` (72 lines C#) -- Shroud removal trait:
  - `RevealsShroudInfo`:
    - `ValidRelationships: PlayerRelationship` -- who sees the reveal (Ally default)
    - `RevealGeneratedShroud: boolean` -- can reveal generated shroud (true default)
  - `RevealsShroud` class:
    - `type: Shroud.SourceType` -- `Visibility` or `PassiveVisibility`
    - `rangeModifiers: number[]` -- `IRevealsShroudModifier` multipliers
    - `AddCellsToPlayerShroud(self, player, uv)` -- add visibility source
    - `RemoveCellsFromPlayerShroud(self, player)` -- remove visibility source
    - `Range` override -- apply percentage modifiers
  - Extends: `AffectsShroud`

#### 3.1.11 HiddenUnderShroud

- [ ] **TODO-12.A.11** `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.ts` (72 lines C#) -- Base visibility trait:
  - `HiddenUnderShroudInfo`:
    - `AlwaysVisibleRelationships: PlayerRelationship` -- always-visible relationships
    - `Type: VisibilityType` -- `CenterPosition` or `Footprint`
  - `HiddenUnderShroud` class:
    - `IsVisible(self, byPlayer)` -- visibility check (explored or always-visible relationship)
    - `IsVisibleInner(self, byPlayer)` -- inner check: `AnyExplored` for footprint, `IsExplored` for center
    - `ModifyRender(self, wr, r)` -- hide renderables when not visible
    - `ModifyScreenBounds(self, wr, bounds)` -- pass through bounds
  - Implements: `IDefaultVisibility`, `IRenderModifier`

#### 3.1.12 HiddenUnderFog

- [ ] **TODO-12.A.12** `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.ts` (41 lines C#) -- Fog visibility trait:
  - `HiddenUnderFogInfo` -- extends `HiddenUnderShroudInfo`
  - `HiddenUnderFog` class:
    - `IsVisibleInner(self, byPlayer)` -- check: if fog disabled, delegate to shroud; otherwise `AnyVisible` for footprint, `IsVisible` for center
  - Extends: `HiddenUnderShroud`

#### 3.1.13 DetectCloaked

- [ ] **TODO-12.A.13** `src/OpenRA.Mods.Common/Traits/DetectCloaked.ts` (54 lines C#) -- Cloak detection trait:
  - `DetectCloakedInfo`:
    - `DetectionTypes: BitSet<DetectionType>` -- types this detector can reveal (default "Cloak")
    - `Range: WDist` -- detection radius (5 cells default)
  - `DetectCloaked` class:
    - `rangeModifiers: IDetectCloakedModifier[]` -- range modifier traits
    - `Range` property -- apply percentage modifiers
  - Extends: `ConditionalTrait<DetectCloakedInfo>`

#### 3.1.14 ShroudExts

- [x] **TODO-12.A.14** `src/OpenRA.Mods.Common/ShroudExts.ts` (48 lines C#) -- Shroud extension methods: ✅ COMPLETE (APPROVED, 2026-06-15)
  - `AnyExplored(shroud, cells)` -- check if any cell in array is explored
  - `AnyExplored(shroud, puvs)` -- check if any projected cell is explored
  - `AnyVisible(shroud, cells)` -- check if any cell is visible
  - **PERF**: Avoid LINQ, use manual loops
  - **Status**: Migrated (103 lines), reviewed, APPROVED (ZERO findings across all 5 dimensions). 17 tests. Commit `43a256d`.

#### 3.1.15 ShroudPalette

- [ ] **TODO-12.A.15** `src/OpenRA.Mods.Cnc/Traits/World/ShroudPalette.ts` (70 lines C#) -- Hard-coded shroud palette:
  - `ShroudPaletteInfo`:
    - `Name: string` -- palette name ("shroud")
    - `Fog: boolean` -- fog vs shroud palette type
  - `ShroudPalette` class:
    - `LoadPalettes(wr)` -- add palette to world renderer
    - `Fog` array -- 8 colors for fog palette
    - `Shroud` array -- 8 colors for shroud palette
    - `PaletteNames` -- enumerable of palette names
  - Implements: `ILoadsPalettes`, `IProvidesAssetBrowserPalettes`
  - **3D migration**: Palette colors become shader uniform values or texture lookup

#### 3.1.16 RevealsShroudMultiplier (Optional)

- [ ] **TODO-12.A.16** `src/OpenRA.Mods.Common/Traits/Multipliers/RevealsShroudMultiplier.ts` (34 lines C#) -- Range multiplier:
  - `RevealsShroudMultiplierInfo`:
    - `Modifier: number` -- percentage modifier
  - `RevealsShroudMultiplier` class:
    - `GetRevealsShroudModifier()` -- return modifier value
  - Implements: `IRevealsShroudModifier`

**Phase A Summary**: 15 files, ~2,594 C# lines. Estimated: ~5,500-7,000 TS lines, ~200-250 tests.

---

## 4. Key Paradigm Shifts

| OpenRA Pattern | Babylon.js / TypeScript Pattern | Explanation |
|----------------|-------------------------------|-------------|
| `ProjectedCellLayer<short>` count arrays | `Uint8Array` visibility bitfield per cell | Single byte per cell stores visibility state; dirty tracking via separate boolean array |
| `TerrainSpriteLayer` shroud/fog sprite overlay | `RenderTargetTexture` + custom `ShaderMaterial` | GPU-driven fog-of-war with 3-way blend (hidden/explored/visible) via shader |
| `ShroudRenderer` 12-directional edge sprite variants | Shader-based edge detection from neighbor visibility texture | Neighbor visibility sampled in fragment shader; edge blending computed per-pixel |
| `FrozenActor` with `IRenderable[]` snapshot | Per-player `FrozenActorLayer` with `TransformNode` clones | Static cloned meshes with `StandardMaterial` at alpha=0.5; no live updates |
| `IRenderModifier.ModifyRender()` alpha/palette/color | Babylon.js `material.alpha` / `emissiveColor` / custom shader | Cloak styles map directly to material properties; no renderable wrapping |
| `IDefaultVisibility` interface chain | `VisibilityService` with cached per-player results | Centralized visibility computation with LRU cache; avoids per-frame interface dispatch |
| `PlayerDictionary<T>` per-player data | `Map<Player, T>` or `T[]` indexed by player index | TypeScript lacks C# `PlayerDictionary`; use array index by player index for O(1) |
| `CPos.ToMPos(map)` / `PPos` projection | `CoordinateTransformer` cell projection functions | Reuse Ch4 Phase I coordinate transformation |
| `WorldUtils.FindTilesInAnnulus()` | `Map.FindTilesInAnnulus()` (already migrated in Ch4) | Spatial query for range-based cell selection |

---

## 5. Dependency Graph

```
Chapters 2-7 (COMPLETE -- Foundation)
  |
  +--> Chapter 4 (Map + CellLayers + ProjectedCellLayer) -- COMPLETE
  |     |
  |     +--> Chapter 12 Phase A (Shroud System)
  |           |
  |           +--> Shroud.cs (core visibility tracker)
  |           |     |
  |           |     +--> ShroudRenderer.ts (visual overlay)
  |           |     +--> FrozenActorLayer.ts (frozen snapshots)
  |           |     +--> AffectsShroud.ts (abstract base)
  |           |           |
  |           |           +--> CreatesShroud.ts
  |           |           +--> RevealsShroud.ts
  |           |           +--> RevealsMap.ts
  |           |
  |           +--> HiddenUnderShroud.ts / HiddenUnderFog.ts (visibility check)
  |           +--> FrozenUnderFog.ts (building freeze)
  |           +--> Cloak.ts (stealth)
  |           +--> DetectCloaked.ts (detection)
  |           +--> PlayerRadarTerrain.ts (radar colors)
  |           +--> ShroudExts.ts (extension methods)
  |           +--> ShroudPalette.ts (palette)
  |
  +--> Chapter 3 (Player, Actor, TraitDictionary, ConditionManager) -- COMPLETE
  +--> Chapter 2 (Renderer, WorldRenderer, TerrainSpriteLayer) -- COMPLETE
  +--> Chapter 8 (Combat -- Cloak.IsVisible checks DetectCloaked range) -- COMPLETE
```

### Internal Phase Dependencies

```
Shroud.cs (core) ----------> ShroudRenderer.ts (uses Shroud.CellVisibility)
Shroud.cs (core) ----------> FrozenActorLayer.ts (uses Shroud.IsVisible)
Shroud.cs (core) ----------> AffectsShroud.ts (calls Shroud.AddSource/RemoveSource)
Shroud.cs (core) ----------> PlayerRadarTerrain.ts (subscribes to OnShroudChanged)
AffectsShroud.ts (base) ----> CreatesShroud.ts, RevealsShroud.ts, RevealsMap.ts
HiddenUnderShroud.ts -------> HiddenUnderFog.ts (extends base)
FrozenUnderFog.ts ----------> FrozenActorLayer.ts (adds frozen actors)
Cloak.ts -------------------> DetectCloaked.ts (IsVisible checks detection range)
ShroudRenderer.ts ----------> ShroudPalette.ts (palette reference)
```

### Critical Path

```
Shroud.cs (core) -> AffectsShroud.ts (base) -> CreatesShroud.ts + RevealsShroud.ts
     |
     +-> ShroudRenderer.ts (visual)
     +-> FrozenActorLayer.ts (frozen actors)
     +-> HiddenUnderShroud.ts + HiddenUnderFog.ts (visibility)
     +-> FrozenUnderFog.ts (building freeze)
     +-> Cloak.ts + DetectCloaked.ts (stealth)
```

### Parallelization Opportunities

- **Track 1** (core logic): Shroud.ts -> AffectsShroud.ts -> CreatesShroud.ts + RevealsShroud.ts + RevealsMap.ts
- **Track 2** (visual): ShroudRenderer.ts (can begin once Shroud.ts interface is defined)
- **Track 3** (frozen actors): FrozenActorLayer.ts + FrozenUnderFog.ts (can begin once Shroud.ts interface is defined)
- **Track 4** (stealth): Cloak.ts + DetectCloaked.ts (independent of shroud core, depends on Ch8 combat)
- **Track 5** (support): HiddenUnderShroud.ts + HiddenUnderFog.ts + PlayerRadarTerrain.ts + ShroudExts.ts + ShroudPalette.ts (all LOW complexity, parallelizable)

---

## 6. Verification and Test Strategy

### 6.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns:

- [ ] **TEST-12.1** Shroud `AddSource`/`RemoveSource` reference counting: add two sources to same cell, remove one, cell remains visible
- [ ] **TEST-12.2** Shroud `Tick()` resolution: verify `Hidden` -> `Explored` -> `Visible` transitions fire `OnShroudChanged` exactly once per cell
- [ ] **TEST-12.3** Shroud `Disabled` flag: all cells return `Visible | Explored` when disabled
- [ ] **TEST-12.4** Shroud `FogEnabled=false`: explored cells return `Visible` (no fog)
- [ ] **TEST-12.5** Shroud `ExploreAll()`: all cells marked explored, `RevealedCells` count correct
- [ ] **TEST-12.6** Shroud `ResetExploration()`: only currently visible cells remain explored
- [ ] **TEST-12.7** Shroud `ProjectedCellsInRange()`: annulus query returns correct cells within range, respects `maxHeightDelta`
- [ ] **TEST-12.8** Shroud sync hash: `Hash` changes deterministically when visibility changes
- [ ] **TEST-12.9** AffectsShroud position tracking: trait updates shroud only when `MoveRecalculationThreshold` exceeded
- [ ] **TEST-12.10** CreatesShroud relationship filter: only affects Neutral/Enemy players (not Ally)
- [ ] **TEST-12.11** RevealsShroud relationship filter: only affects Ally players (not Enemy)
- [ ] **TEST-12.12** HiddenUnderShroud footprint mode: actor visible when any footprint cell is explored
- [ ] **TEST-12.13** HiddenUnderFog footprint mode: actor visible when any footprint cell is currently visible
- [ ] **TEST-12.14** FrozenUnderFog: creates FrozenActor when actor leaves visible range, frozen actor has correct snapshot
- [ ] **TEST-12.15** FrozenActorLayer: `FromCell()` spatial query returns correct frozen actor
- [ ] **TEST-12.16** Cloak `IsVisible`: returns true for owner, false for enemy without detector, true for enemy with detector in range
- [ ] **TEST-12.17** Cloak `Uncloak` events: Attack, Move, Damage each trigger uncloak when configured
- [ ] **TEST-12.18** Cloak `Tick()`: countdown timer decrements, re-cloaks after `CloakDelay`
- [ ] **TEST-12.19** DetectCloaked range: modifier traits correctly scale detection range
- [ ] **TEST-12.20** RevealsMap: trait enabled reveals all map cells, disabled removes reveal
- [ ] **TEST-12.21** ShroudExts `AnyExplored`/`AnyVisible`: manual loop correctness, early exit
- [ ] **TEST-12.22** PlayerRadarTerrain: color updates only for visible cells, `OnShroudChanged` subscription works

### 6.2 Per-File Test Estimates

| File | Tests (est.) | Test Lines (est.) |
|:---|:---:|:---:|
| Shroud.ts | ~40 | ~1,200 |
| ShroudRenderer.ts | ~15 | ~600 |
| FrozenActorLayer.ts | ~25 | ~800 |
| Cloak.ts | ~30 | ~900 |
| AffectsShroud.ts | ~15 | ~450 |
| FrozenUnderFog.ts | ~15 | ~450 |
| RevealsMap.ts | ~10 | ~300 |
| PlayerRadarTerrain.ts | ~10 | ~300 |
| CreatesShroud.ts | ~8 | ~240 |
| RevealsShroud.ts | ~8 | ~240 |
| HiddenUnderShroud.ts | ~8 | ~240 |
| HiddenUnderFog.ts | ~5 | ~150 |
| DetectCloaked.ts | ~8 | ~240 |
| ShroudExts.ts | ~6 | ~180 |
| ShroudPalette.ts | ~5 | ~150 |
| **Total** | **~200-220** | **~6,200-6,500** |

### 6.3 Visual Acceptance Testing

Rendering-heavy systems require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Shroud overlay | `/test/shroud/basic/` | Verify fog-of-war texture overlay on terrain; hidden=black, explored=dim, visible=bright |
| Shroud edge blending | `/test/shroud/edges/` | Verify smooth edge transitions between shroud/fog/visible cells |
| Frozen actors | `/test/shroud/frozen/` | Verify frozen building snapshot with reduced opacity under fog |
| Cloak alpha | `/test/shroud/cloak-alpha/` | Verify cloaked unit at 55% alpha, visible to owner, hidden to enemy |
| Cloak detection | `/test/shroud/cloak-detect/` | Verify detector unit reveals cloaked enemies in range |
| Full map reveal | `/test/shroud/reveal-map/` | Verify RevealsMap trait reveals entire map when enabled |

### 6.4 Integration Testing

- [ ] **TEST-12.I1** Shroud lifecycle: unit with RevealsShroud moves across map -> cells become visible -> unit destroyed -> cells become fogged (explored but not visible)
- [ ] **TEST-12.I2** Combat under fog: enemy building under fog cannot be targeted; once revealed, can be targeted
- [ ] **TEST-12.I3** Cloak combat: cloaked unit invisible to enemy -> detector enters range -> unit becomes visible -> enemy can target and fire
- [ ] **TEST-12.I4** Frozen actor combat: enemy tank leaves visible range -> frozen snapshot appears -> player can still target frozen position (but not updated position)

---

## 7. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **ShroudRenderer RTT performance** (per-frame texture update on large maps) | HIGH | Frame drops on 256x256 maps with many visibility changes | Batch cell updates into single `RawTexture.update()` call; use `Uint8Array` subarray for dirty regions; consider compute shader for cell resolution |
| **Shroud.cs hot-path loop parity** (C# uses `Span.IndexOf` vectorized search) | HIGH | TypeScript loop slower than C# for large maps | Use `TypedArray` methods (`indexOf`) where possible; batch dirty cell processing; profile with 256x256 map |
| **FrozenActor renderable capture** (C# captures `IRenderable[]` array) | MEDIUM | Babylon.js scene graph cloning is expensive | Clone only `TransformNode` hierarchy, not full mesh; use `InstantiateHierarchy()` with shared geometry; capture material state, not full render pipeline |
| **Cloak material modification per-frame** | MEDIUM | Material changes cause shader recompilation | Use `Material` clones per actor, not per-frame modification; pre-create cloaked material variants |
| **Per-player shroud memory** (256x256 map = 65K cells * 4 players = 256K cells) | MEDIUM | Memory overhead for multiplayer games | Use `Uint8Array` (1 byte/cell) not objects; share `explored` array between players if `ExploreMapEnabled` |
| **Shroud edge shader complexity** | MEDIUM | Fragment shader too complex for mobile GPUs | Simplify to 4-neighbor edge detection (not 8); precompute edge masks in vertex shader |
| **FrozenActorLayer spatial query** | LOW | `FromCell()` O(n) scan for large maps | Use `Map`-keyed `Map<FrozenActor[]>` or spatial hash; `BinSize` partitioning from C# |
| **AffectsShroud position change detection** | LOW | Frequent shroud recalculation on jitter | Use `MoveRecalculationThreshold` (256 WDist = 1/4 cell); only recalculate when threshold exceeded |
| **Cloak detection range query** | LOW | `DetectCloaked` scans all actors each tick | Cache detector positions in spatial index; only query when detector moves or cloaked actor moves |

### Performance Targets

| System | Target | Measurement |
|--------|--------|-------------|
| Shroud update on 128x128 map | <1ms tick | Dirty cell processing time |
| Shroud update on 256x256 map | <2ms tick | Dirty cell processing time |
| Shroud texture upload | <0.5ms | `RawTexture.update()` call time |
| Frozen actor render capture | <1ms | Clone + material snapshot time |
| Cloak visibility check | <0.1ms per actor | `IsVisible()` with detector scan |

### Deferred Features

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| Shroud edge anti-aliasing | Shader complexity; basic edge blending sufficient for MVP | TODO-12.DEFERRED.1 |
| Frozen actor animation freeze | Frozen actors show static frame; animated buildings show last frame | TODO-12.DEFERRED.2 |
| Advanced cloak styles (Palette with player tint) | Custom shader complexity; Alpha + Color styles cover 90% of use cases | TODO-12.DEFERRED.3 |
| Shroud compute shader (WebGPU) | WebGL 2.0 only; compute shaders require WebGPU which is not universally supported | TODO-12.DEFERRED.4 |

---

## 8. Appendix: Architecture Decisions Record (ADR)

### ADR-12.1: RTT Fog-of-War Layer

- **Decision**: Shroud rendering uses a `RenderTargetTexture` (RTT) rendered as an overlay quad above the terrain. Visibility data is stored as a per-cell `Uint8Array` (1 byte per cell: 0=Hidden, 1=Explored, 2=Visible). The RTT shader blends between revealed/explored/hidden states using the visibility texture.
- **Rationale**: OpenRA uses `TerrainSpriteLayer` with directional sprite variants for shroud edges. In 3D, a shader-based approach provides smoother edges, better performance (single draw call), and easier integration with 3D terrain. The `Uint8Array` can be efficiently uploaded to GPU via `RawTexture.update()`.
- **Mitigation**: Fragment shader samples visibility texture and neighbor cells for edge blending. Three color uniforms define hidden (black), explored (dim gray), and visible (transparent) colors.

### ADR-12.2: FrozenActor as TransformNode Clone

- **Decision**: Frozen actors are rendered as static `TransformNode` clones with `StandardMaterial` at alpha=0.5. The frozen actor layer is per-player and updates when enemy actors leave the visible area.
- **Rationale**: OpenRA's `FrozenActor` captures `IRenderable[]` arrays. In Babylon.js, cloning the `TransformNode` hierarchy with shared geometry and a reduced-opacity material provides the same visual effect without capturing the full render pipeline.
- **Mitigation**: Use `TransformNode.clone()` with `mesh.material = frozenMaterial` (alpha=0.5). Dispose clones when frozen actor invalidated.

### ADR-12.3: VisibilityService Centralized Cache

- **Decision**: Actor visibility queries use a centralized `VisibilityService` with per-player LRU caches, rather than the C# `IDefaultVisibility` interface chain.
- **Rationale**: C# uses interface dispatch (`actor.Trait<IDefaultVisibility>().IsVisible()`) which is efficient with JIT. In TypeScript, interface dispatch is property lookup. A centralized service with cached results avoids per-actor interface lookups and enables batch invalidation when shroud changes.
- **Mitigation**: `VisibilityService` subscribes to `Shroud.OnShroudChanged` and invalidates affected cells' cached visibility. `IsVisible(actor, player)` returns cached result or recomputes.

### ADR-12.4: Cloak Material Effect (Not Scene Removal)

- **Decision**: Cloaked actors remain in the Babylon.js scene graph. Their material is modified (alpha reduction, color tint, or palette swap) based on `CloakStyle`. They are not removed from the scene.
- **Rationale**: Removing/adding actors from the scene graph is expensive (rebuilds spatial indices). Material modification is cheap and preserves culling, picking, and spatial queries. This also enables smooth alpha transitions.
- **Mitigation**: Pre-create material variants (normal, cloaked-alpha, cloaked-color, cloaked-palette) per actor. Swap material reference on cloak state change.

### ADR-12.5: Shroud Source Reference Counting

- **Decision**: Maintain `ProjectedCellLayer<short>` (count arrays) for each source type, identical to C# OpenRA. Do not simplify to boolean flags.
- **Rationale**: Multiple sources can affect the same cell (e.g., two units revealing overlapping areas). Reference counting ensures correct state when one source is removed. This is critical for network sync determinism.
- **Mitigation**: Use `Int16Array` for counts (same as C# `short`). Overflow is impossible (max sources per cell < 1000).

### ADR-12.6: Lazy Shroud Resolution with Dirty Tracking

- **Decision**: Shroud cell resolution is lazy -- only dirty (`touched`) cells are re-resolved in `Tick()`. The `anyCellTouched` flag skips the entire loop when no changes occurred.
- **Rationale**: This matches OpenRA's optimization exactly. On most ticks, no shroud sources change, so the loop is skipped entirely. This is critical for performance on large maps.
- **Mitigation**: `AddSource()` and `RemoveSource()` mark affected cells as touched. `Tick()` iterates only touched cells, using `TypedArray.indexOf()` for fast scanning.

---

## Migration Order and Phasing Strategy

| Week | Track | Files | Description | Dependencies |
|:---:|:---|:---:|:---|:---|
| 1 | Core | 2 | Shroud.ts + ShroudExts.ts | Chapter 4 CellLayers |
| 1-2 | Visual | 2 | ShroudRenderer.ts + ShroudPalette.ts | Shroud.ts interface |
| 2 | Frozen | 2 | FrozenActorLayer.ts + FrozenUnderFog.ts | Shroud.ts + Ch3 Actor |
| 2-3 | Visibility | 4 | AffectsShroud.ts + CreatesShroud.ts + RevealsShroud.ts + RevealsMap.ts | Shroud.ts |
| 3 | Stealth | 2 | Cloak.ts + DetectCloaked.ts | Ch8 combat + Shroud.ts |
| 3 | Support | 3 | HiddenUnderShroud.ts + HiddenUnderFog.ts + PlayerRadarTerrain.ts | Shroud.ts + FrozenActorLayer.ts |
| 3 | Optional | 1 | RevealsShroudMultiplier.ts | RevealsShroud.ts |

**Total estimated effort**: ~3-4 weeks (single developer) or ~1.5-2 weeks (2 developers with parallel tracks).

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.3 (Traits -- Visibility System) -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.5 -- Verified file paths and initial complexity estimates
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Format and structure reference
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
