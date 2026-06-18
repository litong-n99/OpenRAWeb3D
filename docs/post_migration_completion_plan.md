# OpenRAWeb3D Post-Migration Completion Plan

> **Source Reference**: Comprehensive analysis of all TODO/DEFERRED items across src/ (2026-06-18)
> **Plan Status**: 🎉 ALL PHASES A-E COMPLETE (52/52, 100%). The post-migration completion plan is fully implemented.
> **Last Updated**: 2026-06-18
> **Planning Date**: 2026-06-18
> **Prerequisite**: ALL Chapters 2-22 COMPLETE (719+ files, 100%)

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All implementation work should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Completion Tasks (TODO)](#3-core-completion-tasks-todo)
   - 3.1 [Phase A: Critical Runtime Fixes](#31-phase-a-critical-runtime-fixes)
   - 3.2 [Phase B: 3D Rendering Integration](#32-phase-b-3d-rendering-integration)
   - 3.3 [Phase C: Shroud / Fog of War Completion](#33-phase-c-shroud--fog-of-war-completion)
   - 3.4 [Phase D: Infrastructure Fill-in](#34-phase-d-infrastructure-fill-in)
   - 3.5 [Phase E: Mod Content and Scripting Polish](#35-phase-e-mod-content-and-scripting-polish)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Project State at Migration Completion

All 22 planned migration chapters (2-22) are at 100% file count. The entire OpenRA game engine -- rendering, actor system, map/terrain, UI, networking, combat, movement, economy, production, fog of war, support powers, activities, order generators, widget extensions, replay/save, server, mod content, scripting, editor, and game entry -- has been ported to TypeScript/Babylon.js.

However, approximately 50-60 items were marked as TODO or DEFERRED during migration. These fall into five categories:

1. **Runtime errors** (throws or crashes): 3 items -- must fix immediately
2. **3D rendering stubs**: 12 items -- game logic works but visuals are missing
3. **Shroud/fog feature gaps**: 10 items -- gameplay works but fog rendering and frozen actor system are incomplete
4. **Infrastructure stubs**: 9 items -- non-critical but blocks full functionality
5. **Mod content/scripting polish**: 20+ items -- cosmetic, QoL, or edge-case features

### 1.2 Core Strategy

The post-migration completion follows a **risk-prioritized, dependency-aware** approach:

1. **Phase A** (Critical Fixes) eliminates all runtime errors -- anything that `throws Error` or silently no-ops a core game mechanic
2. **Phase B** (3D Rendering) replaces the AnimationStub cascade and implements all deferred 3D visual effects. Fixing AnimationStub first unblocks TeslaZap, IonCannon, ChronoVortex, and many other rendering items
3. **Phase C** (Shroud/Fog) completes the fog-of-war visual system and frozen actor mechanics; depends on Phase B's rendering infrastructure
4. **Phase D** (Infrastructure) fills in MapPreview, FileSystem cache layers, cursors, and shellmap -- these depend on nothing in Phases A-C and can run in parallel
5. **Phase E** (Mod Polish) handles all remaining low-priority mod content and scripting items -- can run in parallel after Phase B unblocks AnimationStub

### 1.3 Architecture Principles

1. **No runtime errors in release**: Any code path reachable during normal gameplay must not throw. Phase A eliminates all `throw new Error('not yet implemented')` calls in reachable paths.
2. **AnimationStub is the keystone**: The shared AnimationStub in `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` blocks ALL C&C visual effects (TeslaZap, IonCannon, ChronoVortex, DropPodImpact, SatelliteLaunch, GpsDot). Replacing it with a real Babylon.js-animated sprite is the single highest-leverage change.
3. **Backward compatibility**: All existing TypeScript interfaces and test suites must continue to pass. New implementations extend, not replace, the existing contract.
4. **3D-first rendering**: All new visual effects use Babylon.js scene graph primitives (LinesMesh for beams, Billboard for sprites, ShaderMaterial for custom effects). No 2D canvas fallbacks.
5. **Test-driven verification**: Every TODO resolved must include new or updated tests covering the previously deferred behavior.

### 1.4 Completed Foundation

All infrastructure from Chapters 2-22 is available:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, ShaderMaterial |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `SheetBuilder`, `HardwarePalette`, `Animation` |
| Actor + World + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA*, `TerrainMeshBuilder`, `TerrainMaterial` |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest`, ZipFile, Folder |
| UI Widget Core | Ch5 | `Widget`, `ChromeProvider`, `WidgetLoader` |
| Network + Orders | Ch6 | `Order`, `UnitOrders`, `OrderManager`, `Connection` |
| Input + Camera + Audio | Ch7 | `InputHandler`, `Viewport`, `Sound`, `SoundDevice` |
| Weapons + Combat | Ch8 | `Warhead`, `Armament`, `AttackBase`, `Bullet`, `Missile` |
| Movement + Physics | Ch9 | `Mobile`, `Locomotor`, `IMove`, pathfinding integration |
| Resource + Economy | Ch10 | `ResourceLayer`, `Harvester`, `ResourceType` |
| Production + Building | Ch11 | `ProductionQueue`, `Building`, `Exit` |
| Shroud + Fog | Ch12 | `Shroud`, `FrozenActorLayer`, `ShroudRenderer`, `Cloak` |
| Support Powers | Ch13 | `SupportPower`, `ChronoshiftPower`, all C&C powers |
| Activities | Ch14 | Full `Activity` state machine, attack/move/deploy activities |
| Order Generators | Ch15 | `UnitOrderGenerator`, `BuildingPlacement`, targeting |
| Widget Extensions | Ch16 | 65+ widget types (buttons, scroll panels, lists, etc.) |
| Replay + Save | Ch17 | Replay recording/playback, game save serialization |
| Server System | Ch18 | `Server`, `SessionTypes`, `OrderBuffer` |
| Mod Content | Ch19 | All C&C and D2K traits, projectiles, effects |
| Scripting | Ch20 | Lua VM (fengari), all script properties |
| Editor + Utilities | Ch21 | Map editor, tile selector, utility commands |
| Game Entry + App Shell | Ch22 | Router, ModSelector, Game class, SPARouting |

---

## 2. File Mapping Table

### 2.1 Complete Unfinished Item Inventory (50 items across 5 Phases)

| # | Source File(s) | Target File(s) | Task | Est. LOC | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Critical Runtime Fixes** | | | | | |
| 1 | `Shroud.ts:579` | `Shroud.ts` | `Shroud.explore(other)` merge | ~80 | MEDIUM | A |
| 2 | `Chronoshiftable.ts:143+` | `Chronoshiftable.ts`, new `Activities/Teleport.ts` | Teleport activity | ~300 | HIGH | A |
| 3 | `Game.ts:466` | `Game.ts` | CursorManager instantiation | ~50 | LOW | A |
| **Phase B: 3D Rendering Integration** | | | | | |
| 4 | `AnimationStub.ts` | `AnimationStub.ts` (replace with real) | Central Animation replacement | ~400 | HIGH | B |
| 5 | `TerrainMeshBuilder.ts:445` | `TerrainMeshBuilder.ts` | Cliff face (Riser) generation | ~250 | MEDIUM | B |
| 6 | `Texture.ts:334`, `FrameBuffer.ts:89-101` | Both files | `getData/setData/readPixels` | ~150 | MEDIUM | B |
| 7 | `Renderer.ts:836` | `Renderer.ts`, new PostProcess | Sharp Bilinear scaling | ~200 | MEDIUM | B |
| 8 | `TeslaZap.ts:35`, `TeslaZapRenderable.ts:343` | Both files | TeslaZap 3D LinesMesh | ~250 | MEDIUM | B |
| 9 | `ChronoVortexRenderable.ts:59` | `ChronoVortexRenderable.ts` | ChronoVortex spiral ShaderMaterial | ~250 | MEDIUM | B |
| 10 | `SonicBlastRenderable.ts:64`, `SonicBlastRenderer.ts:167` | Both files | SonicBlast wave ring Mesh | ~250 | MEDIUM | B |
| 11 | `GpsDot.ts:138`, `GpsDotEffect.ts` (new) | Both files | GpsDotEffect sprite rendering | ~150 | LOW | B |
| 12 | `WithBuildingBib.ts:139` | `WithBuildingBib.ts` | Building placement preview | ~100 | LOW | B |
| 13 | `WithCargo.ts:191` | `WithCargo.ts` | Passenger preview rendering | ~120 | LOW | B |
| 14 | `ShroudRenderer.ts:43-68,339` | `ShroudRenderer.ts` | 3D RTT shroud rendering | ~300 | MEDIUM | B |
| **Phase C: Shroud / Fog of War Completion** | | | | | |
| 15 | `FrozenActorLayer.ts:714` | `FrozenActorLayer.ts` | Flash() tint animation | ~60 | LOW | C |
| 16 | `FrozenUnderFog.ts:414` | `FrozenUnderFog.ts` | Frozen actor sprite snapshot capture | ~150 | MEDIUM | C |
| 17 | `FrozenActorLayer.ts:48` | `FrozenActorLayer.ts` + new Polygon | Polygon class + integration | ~180 | MEDIUM | C |
| 18 | `Cloak.ts:281,630,644` | `Cloak.ts` | Cloak sound/effect integration | ~80 | LOW | C |
| 19 | `Cloak.ts:393,709` | `Cloak.ts` | DetectCloaked integration | ~100 | MEDIUM | C |
| 20 | `FrozenActorLayer.ts:234` | `FrozenActorLayer.ts` | Tooltip integration | ~60 | LOW | C |
| 21 | `ShroudPalette.ts:150` | `ShroudPalette.ts` | Editor asset browser palettes | ~40 | LOW | C |
| **Phase D: Infrastructure Fill-in** | | | | | |
| 22 | `MapPreview.ts` (250-line stub) | `MapPreview.ts` | Full MapPreview (781-line C# ref) | ~500 | HIGH | D |
| 23 | `MapDirectoryTracker.ts:115` | `MapDirectoryTracker.ts` | Poll loop implementation | ~120 | MEDIUM | D |
| 24 | `FileSystem.ts:255` | `FileSystem.ts` | L2-L4 cache (IndexedDB, Cache API) | ~300 | HIGH | D |
| 25 | `ZipFile.ts:111` | `ZipFile.ts` | Non-blocking Worker read | ~100 | MEDIUM | D |
| 26 | `MapCache.ts:14-15` | `MapCache.ts` + new `PerfTimer.ts` | PerfTimer + Log system | ~150 | LOW | D |
| 27 | `Game.ts:554` | `Game.ts` + `World.ts` | IWorld interface alignment | ~120 | MEDIUM | D |
| 28 | `Game.ts:608` | `Game.ts` | Shellmap Phase 3 (dynamic AI) | ~200 | HIGH | D |
| 29 | `Game.ts:669` | `Game.ts` | Widget-based main menu | ~300 | MEDIUM | D |
| **Phase E: Mod Content and Scripting Polish** | | | | | |
| 30 | `RemapShpCommand.ts`, etc. (4 files) | All 4 files | SHP/PNG legacy tools | ~400 | LOW | E |
| 31 | `LuaScriptAdapter.ts:392` | `LuaScriptAdapter.ts` | Lua instruction counting | ~50 | LOW | E |
| 32-35 | `ChronosphereProperties.ts`, etc. (4 files) | All 4 files | Scripting C&C Properties | ~300 | LOW | E |
| 36 | `SpiceBloom.ts:265,409` | `SpiceBloom.ts` | SpiceBloom animation | ~100 | LOW | E |
| 37 | `Sandworm.ts:7` | `Sandworm.ts` | Wanders trait integration | ~80 | LOW | E |
| 38 | `AttackSwallow.ts:10` | `AttackSwallow.ts` | SwallowActor activity integration | ~100 | LOW | E |
| 39 | `BuildableTerrainLayer.ts:15` | `BuildableTerrainLayer.ts` | Fog-of-war check | ~40 | LOW | E |
| 40 | `HarvesterInsurance.ts:30` | `HarvesterInsurance.ts` | FreeActorWithDelivery | ~150 | MEDIUM | E |
| 41 | `R8Loader.ts:428` | `R8Loader.ts` | PlayerColorRemap integration | ~60 | LOW | E |
| 42 | `SonicBlast.ts:235` | `SonicBlast.ts` | Blocking actor check | ~60 | LOW | E |
| 43 | `D2kSpriteSequence.ts:468` | `D2kSpriteSequence.ts` | Pre-resolved sprites | ~80 | LOW | E |
| 44 | `ClassicTilesetSpecificSpriteSequence.ts:236` | `ClassicTilesetSpecificSpriteSequence.ts` | Fallback path | ~60 | LOW | E |
| 45 | `WithGunboatBody.ts:193,287,293` | `WithGunboatBody.ts` | Animation integration | ~100 | LOW | E |
| 46 | `WithTeslaChargeOverlay.ts:233` | `WithTeslaChargeOverlay.ts` | Tick-synced animation timing | ~50 | LOW | E |
| 47 | `ClassicSpriteSequence.ts:136` | `ClassicSpriteSequence.ts` | Sheet/SpriteCache integration | ~80 | LOW | E |
| 48 | `HvaReader.ts:137` | `HvaReader.ts` | Full MatrixInverse parity | ~60 | LOW | E |
| 49 | `WithSplitAttackPaletteInfantryBody.ts:191` | `WithSplitAttackPaletteInfantryBody.ts` | Tick-synced animation | ~50 | LOW | E |
| 50 | InfiltrateFor* files (5 files) | All 5 files | Sound notification integration | ~80 | LOW | E |
| 51 | `AttackTesla.ts:96,216` | `AttackTesla.ts` | ChargeFire activity + audio | ~150 | MEDIUM | E |
| 52 | `AttackLeap.ts:140` | `AttackLeap.ts` | LeapAttack activity | ~200 | MEDIUM | E |

> **Complexity Legend**:
> - **LOW**: Simple wire-up, API call replacement, or small data change. 40-150 estimated TS lines.
> - **MEDIUM**: Moderate logic rewrite, new Babylon.js resource creation, or cross-file integration. 120-300 estimated TS lines.
> - **HIGH**: Complex gameplay logic, multi-file coordination, or significant 3D rendering pipeline work. 200-500+ estimated TS lines.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total unfinished items** | 52 |
| **Phase A (Critical Fixes)** | 3 items (COMPLETE ✅) |
| **Phase B (3D Rendering)** | 11 items (COMPLETE ✅) |
| **Phase C (Shroud/Fog)** | 7 items (COMPLETE ✅) |
| **Phase D (Infrastructure)** | 8 items (COMPLETE ✅) |
| **Phase E (Mod Polish)** | 26 items (COMPLETE ✅) |
| **HIGH complexity** | 6 items (Teleport, AnimationStub, MapPreview, FileSystem L2-L4, Shellmap Phase 3, TeslaZap/ChronoVortex/SonicBlast) |
| **MEDIUM complexity** | 14 items |
| **LOW complexity** | 32 items |
| **Estimated total new/changed lines** | ~6,500 (across all phases) |

### 2.3 Category F: Intentional NOP Stubs (No Action)

These files are **intentionally empty** because browser APIs replace their functionality. No implementation work is needed:

| File | OpenRA Original | Browser Replacement | Status |
|:---|:---|:---|:---:|
| `src/OpenRA.Platforms.Default/Sdl2PlatformWindow.ts` | SDL2 window management | `<canvas>` + `requestAnimationFrame` | NOP |
| `src/OpenRA.Platforms.Default/Sdl2Input.ts` | SDL2 keyboard/mouse | `addEventListener('keydown'/'mousemove')` | NOP |
| `src/OpenRA.Platforms.Default/Sdl2HardwareCursor.ts` | SDL2 hardware cursor | CSS `cursor` property | NOP |
| `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | SDL2 GL context | WebGL context from `<canvas>` | NOP |
| `src/OpenRA.Platforms.Default/OpenGL.ts` | OpenGL bindings | WebGL 2.0 (built-in) | NOP |
| `src/OpenRA.Platforms.Default/ThreadedGraphicsContext.ts` | Threaded GL context | OffscreenCanvas (future PWA) | NOP |
| `src/OpenRA.Platforms.Default/ThreadAffine.ts` | Thread affinity check | N/A (JS single-threaded) | NOP |
| `src/glsl/model.vert` | Model vertex shader (GLSL 1.50) | Babylon.js `StandardMaterial` | NOP |
| `src/glsl/model.frag` | Model fragment shader (GLSL 1.50) | Babylon.js `PBRMaterial` | NOP |

---

## 3. Core Completion Tasks (TODO)

### 3.1 Phase A: Critical Runtime Fixes

**Status**: COMPLETE (3/3, 100% — commits `6108694`, `563a4a4`, `fbdcb86`, review fixes `ae85500`)
**Complexity**: Low-HIGH (CursorManager LOW, Teleport HIGH)
**Blocked by**: Nothing (all dependencies are migrated)
**Blocks**: Phase B (Teleport may call ChronoVortex rendering), Phase D (Shellmap needs CursorManager)

**Description**: These three items represent actual runtime failures or game-breaking no-ops. `Shroud.explore(other)` throws an Error when a two-player shroud merge is needed (e.g., ally sharing vision). The Teleport activity stub means Chronosphere and PortableChrono do not actually move units -- a core game mechanic is broken. CursorManager is never instantiated, so hardware cursor sprites never appear.

**Paradigm Shifts**:
- C# `Shroud.Explore(Shroud other)` pixel-wise merge -> TypeScript typed-array bitwise OR across both shroud explored arrays
- C# `Teleport` activity with `Chronoshiftable.Teleport()` -> TypeScript Activity extending the Ch14 Activity base, queued via `self.QueueActivity()`
- C# `CursorManager` hardware cursor -> CSS/HTML overlay cursor managed by the same `CursorManager` class that already exists

#### 3.1.1 Shroud.explore(other)

- [x] **P1-A.1** `src/OpenRA.Game/Traits/Player/Shroud.ts:579` (est. 80 lines) ✅ — Cross-Shroud exploration merge:
  - Verify that `other._map` dimensions match `this._map` (same Map instance or same map size)
  - Bitwise OR the `_explored` typed arrays: `this._explored[i] |= other._explored[i]` for all projected cells
  - Bitwise OR the `_touched` typed arrays: `this._touched[i] |= other._touched[i]`
  - If any `_explored[i]` transitions from 0 to 1, set `_anyCellTouched = true`
  - If any `_touched[i]` transitions from 0 to 1, set `_anyCellTouched = true`
  - Remove the `throw new Error(...)` line
  - Add unit test: two shrouds, explore disjoint sets of cells, merge, verify all cells explored
  - Original OpenRA reference: `Shroud.Explore(Shroud other)` in `OpenRA.Game/Traits/Player/Shroud.cs`

#### 3.1.2 Teleport Activity (Chronoshiftable)

- [x] **P1-A.2** `src/OpenRA.Mods.Cnc/Traits/Chronoshiftable.ts:143` and new `src/OpenRA.Mods.Cnc/Activities/Teleport.ts` (est. 300 lines) ✅ — Full Teleport activity:
  - Create new file `src/OpenRA.Mods.Cnc/Activities/Teleport.ts` extending Ch14 `Activity` base
  - Implement `Teleport` activity state machine: Init -> DelayBeforeTeleport -> DelayDuringTeleport -> DelayAfterTeleport -> Done
  - `chronosphere: IGameActor` -- the Chronosphere building casting the teleport
  - `target: CPos` -- destination cell
  - `killCargo: boolean` -- whether to kill passenger units on teleport
  - `sound: string` -- teleport sound effect name
  - On `Tick()`: advance through delay phases, then move actor to target position, then play sound via Ch7 `Sound`
  - On teleport: set actor position via `Mobile.SetPosition()` or direct `CenterPosition` update
  - On `killCargo`: query `Cargo` trait, destroy all passengers
  - Replace the `queueTeleport()` forward stub in `Chronoshiftable.ts` with real `ActivityQueue.QueueActivity(new Teleport(...))`
  - Also fix `PortableChrono.ts:386` which references the same `TODO-19.C.5` Teleport activity
  - Unit tests: teleport to valid cell, teleport blocked by immovable actor, killCargo=true destroys passengers, delay timing matches config
  - Original OpenRA reference: `OpenRA.Mods.Cnc/Activities/Teleport.cs` (~120 lines C#)

#### 3.1.3 CursorManager Instantiation

- [x] **P1-A.3** `src/OpenRA.Game/Game.ts:466` (est. 50 lines) ✅ — Create CursorManager in game flow:
  - The `CursorManager` class at `src/OpenRA.Game/Graphics/CursorManager.ts` already exists (548 lines, 288 tests)
  - Instantiate it in `Game.initialize()` after `ModData` creation
  - The CursorManager requires: `SheetBuilder` (from `Renderer`), `HardwarePalette` (from `Renderer`)
  - Wire the CursorManager's CSS cursor updates into the canvas `mousemove` event handler
  - `setCursor(cursorName: string)`: update CSS cursor on the canvas element
  - This is independent of Widget-based main menu rendering (TODO-22.C.2)
  - Unit test: verify CursorManager instance is created during game initialization

**Phase A Summary**: 3/3 COMPLETE (100%). ~743 lines TS + ~167 tests. Runtime errors eliminated: Shroud merge works, Teleport activity functional, CursorManager instantiated. Commits: `6108694` (P1-A.1), `563a4a4` (P1-A.2), `fbdcb86` (P1-A.3), `ae85500` (review fixes). Review: 2 MAJOR + 4 MINOR resolved, 0 BLOCKERs remaining.

---

### 3.2 Phase B: 3D Rendering Integration

**Status**: COMPLETE (11/11, 100% — commits for each package + review fixes `bc4ed55`)
**Complexity**: LOW-MEDIUM (GpsDotEffect LOW, AnimationStub HIGH)
**Blocked by**: Phase A (Shroud.explore fix unblocks ShroudRenderer 3D)
**Blocks**: Phase C (Shroud visual rendering), Phase E (all C&C visual effects depend on AnimationStub replacement)

**Description**: Phase B addresses all deferred 3D rendering items. The central keystone is replacing AnimationStub, which is the shared stub used by TeslaZap, IonCannon, ChronoVortex, DropPodImpact, SatelliteLaunch, and other C&C effects. Once AnimationStub uses real Babylon.js sprites, all those effects automatically get visual output. Second priority is cliff face generation for terrain, then the per-effect custom ShaderMaterials (ChronoVortex spiral, SonicBlast wave ring, TeslaZap lightning).

**Paradigm Shifts**:
- C# `Animation` 2D sprite sequence -> Babylon.js `AnimationGroup` or manual frame-swap via `updateVerticesData("uv", ...)` at 25fps tick rate
- C# TeslaZap 2D line segments -> Babylon.js `LinesMesh` with dynamic vertex update each frame
- C# ChronoVortex 2D sprite -> Babylon.js `Billboard` with custom `ShaderMaterial` for spiral UV animation
- C# SonicBlast 2D post-process -> Babylon.js `Mesh` ring with expanding radius uniform
- C# GpsDot 2D sprite -> Babylon.js `Billboard` dot sprite on minimap layer

#### 3.2.1 AnimationStub Replacement (KEYSTONE)

- [x] **P1-B.1** `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` (est. 400 lines) ✅ — Real Babylon.js-backed animation:
  - Replace the stub `render()` and `renderUI()` methods with real Babylon.js sprite rendering
  - Use Ch2 `Sprite` and `Sheet` infrastructure to resolve sequence frames to UV coordinates
  - Create a `Mesh` + `ShaderMaterial` or `Billboard` per animation instance
  - `render(pos, palette)`: returns `IRenderable[]` with actual sprite renderables at the given world position
  - `renderUI(wr, screenPos, offset, scale, palette)`: returns UI-space renderables
  - `playThen(sequence, onComplete)`: start frame animation, call `onComplete` after last frame (tick-synced at 25fps)
  - `playRepeating(sequence)`: start looping animation
  - `tick()`: advance frame counter, update UVs on the backing mesh
  - Frame length configurable via constructor or sequence data
  - Instance pooling: reuse mesh + material across animation instances to avoid per-frame allocation
  - This single change automatically unblocks: TeslaZap visual, IonCannon visual, ChronoVortex visual, DropPodImpact visual, SatelliteLaunch visual, and GpsDotEffect
  - Unit tests: playThen calls onComplete at correct tick, render returns non-empty array, tick advances frame, repeating animation loops

#### 3.2.2 Cliff Face (Riser) Generation

- [x] **P1-B.2** `src/OpenRA.Game/Map/TerrainMeshBuilder.ts:445` (est. 250 lines) ✅ — Vertical cliff quad generation:
  - Iterate all cell edges (4 per cell: top, right, bottom, left)
  - For each edge, check Riser data in `TerrainTileInfo` for expected height difference
  - If neighbor height differs, generate a vertical quad (2 triangles) bridging the lower and upper edges
  - Vertices: lower edge (2 verts) at lower cell height, upper edge (2 verts) at upper cell height + corner offset
  - Normals point outward from cell center (perpendicular to the cliff face)
  - UVs use world-space vertical projection (XZ plane stretched over height)
  - Integrate into `generateTerrainSurface()` call flow (currently commented out)
  - Unit tests: single-step height cell generates correct cliff quad; no cliff generated for flat neighbors; normals point outward

#### 3.2.3 Texture Readback (getData / setData / readPixels)

- [x] **P1-B.3** `src/OpenRA.Platforms.Default/Texture.ts:334` and `FrameBuffer.ts:89-101` (est. 150 lines) -- CPU-side texture data access:
  - **Texture.getData()**: Create a temporary `RenderTargetTexture`, render the source texture into it, call `engine.readPixels()` to read back RGBA data, return as `Uint8Array`
  - **FrameBuffer.setData()**: Call `engine.updateTextureData()` with the provided pixel data
  - **FrameBuffer.setFloatData()**: Call `engine.updateTextureData()` with `Float32Array` data
  - **FrameBuffer.setDataFromReadBuffer()**: Copy from internal read buffer to texture (WebGL `glCopyTexSubImage2D`)
  - **FrameBuffer.getData()**: Call `engine.readPixels()` on the bound framebuffer
  - All methods must handle disposed state via `ensureNotDisposed()` guard
  - This unblocks CPU-side terrain splat map manipulation and shroud texture updates
  - Unit tests: getData returns correct dimensions, setData updates texture (verify via subsequent getData), disposed textures throw

#### 3.2.4 Sharp Bilinear Scaling

- [x] **P1-B.4** `src/OpenRA.Game/Renderer.ts:836` and new `src/OpenRA.Game/Graphics/SharpBilinearPostProcess.ts` (est. 200 lines) -- Custom post-process for pixel-art scaling:
  - Create `SharpBilinearPostProcess` extending Babylon.js `PostProcess`
  - Fragment shader: sample source texture with bilinear interpolation, apply unsharp mask (sharpening kernel) to restore edge crispness
  - Uniform parameters: texture dimensions, sharpening strength coefficient (tunable)
  - Two-pass variant: horizontal sharpen then vertical sharpen (separable kernel)
  - Mount on `uiScene`'s rendering pipeline after world-to-screen composition
  - Integrate into `Renderer.enableAntialiasingFilter()` / `disableAntialiasingFilter()`
  - Replace the current NEAREST/BILINEAR toggle with Sharp Bilinear when enabled
  - The OpenRA reference shader is in `OpenRA/glsl/` -- port the `sharp-bilinear` logic to GLSL ES 3.0
  - Visual acceptance test page required (pixel-art text rendering at 2x/3x/4x scale)

#### 3.2.5 TeslaZap 3D Rendering

- [x] **P1-B.5** `src/OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts:35` and `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts:343` (est. 250 lines) -- 3D lightning rendering:
  - Replace `TeslaZapRenderableStub` interface with a real `TeslaZapRenderable` class
  - Feed the `TeslaZapSegment[]` descriptors (already computed: source offset, target offset, bright/dim zap counts) into a `LinesMesh` builder
  - Bright zaps: thick emissive lines (e.g., 3px / 0.1 world unit width) with bright cyan color
  - Dim zaps: thinner emissive lines (1px) with dim blue color
  - Random jitter: each zap segment is offset randomly within a small radius to simulate lightning branching
  - Update vertex positions each frame via `LinesMesh.updateVerticesData()`
  - Use `ShaderMaterial` with emissive-only rendering (no lighting)
  - Depends on P1-B.1 (AnimationStub replacement) for the zap halo/glow sprite at impact point
  - Visual acceptance test page required

#### 3.2.6 ChronoVortex 3D Rendering

- [x] **P1-B.6** `src/OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.ts:59` (est. 250 lines) -- Spiral vortex ShaderMaterial:
  - Create `ChronoVortexShaderMaterial` with custom fragment shader
  - Shader effect: spiral UV animation (angle = atan2(v, u) + time; radius distorts outward)
  - Input texture: chrono-vortex sprite sheet (48-frame spiral sequence)
  - Uniforms: `time` (tick counter), `progress` (0-1 lerp over vortex lifetime)
  - Render as a `Billboard` at the `ChronoVortexRenderable.pos` world position
  - Billboard always faces camera, size scales with distance (constant world-space size)
  - Dispose shader material + billboard at end of vortex lifetime
  - Depends on P1-B.1 (AnimationStub) for frame-to-frame sprite reference
  - Visual acceptance test page required

#### 3.2.7 SonicBlast 3D Rendering

- [x] **P1-B.7** `src/OpenRA.Mods.D2k/Graphics/SonicBlastRenderable.ts:64` and `src/OpenRA.Mods.D2k/Traits/World/SonicBlastRenderer.ts:167` (est. 250 lines) -- Wave ring Mesh + ShaderMaterial:
  - Create `SonicBlastShaderMaterial` with custom fragment shader
  - Shader effect: expanding ring with distance-based alpha falloff
  - Uniforms: `radius` (expands over time), `maxRadius` (from `SonicBlastRendererInfo.Size`), `color` (configurable)
  - Render as a horizontal disc `Mesh` (or ring `TorusKnot`) at each sonic blast position
  - Mesh sits flat on terrain (Y = terrain height), visible from camera angle
  - `SonicBlastRenderer.update()`: for each active blast, update `radius` uniform
  - Dispose mesh + material when blast completes
  - Unit tests: radius expands linearly with ticks, dispose cleans up GPU resources

#### 3.2.8 GpsDotEffect Rendering

- [x] **P1-B.8** `src/OpenRA.Mods.Cnc/Traits/GpsDot.ts:138` and new `src/OpenRA.Mods.Cnc/Effects/GpsDotEffect.ts` (est. 150 lines) -- GPS dot sprite rendering:
  - Create `GpsDotEffect` class implementing `IRenderable`
  - Renders a small colored dot (Billboard sprite) at the actor's world position
  - Visible only on the minimap or when GPS power is active
  - Dot color sourced from `GpsDotInfo.IndicatorPalettePrefix` (player color)
  - Lifecycle managed by `GpsDot` trait: add to world on `INotifyAddedToWorld`, remove on `INotifyRemovedFromWorld`
  - Replace the current `{}` stub effect with real `GpsDotEffect` instance
  - Depends on P1-B.1 (AnimationStub replacement) for sprite sheet rendering

#### 3.2.9 Building Placement Preview

- [x] **P1-B.9** `src/OpenRA.Mods.Cnc/Traits/Render/WithBuildingBib.ts:139` (est. 100 lines) -- Building bib placement preview:
  - Implement `renderPreviewSprites()` method to return actual preview sprites
  - Use `ActorPreviewInitializer` (Ch3) and `SpriteActorPreview` (Ch7) to generate ghost/preview sprites
  - Preview sprites show the bib (concrete foundation) under the building during placement
  - Semi-transparent rendering (alpha < 1.0) until placement confirmed
  - Depends on the Ch3 RenderSprites infrastructure and Ch7 Animation

#### 3.2.10 Passenger Cargo Preview

- [x] **P1-B.10** `src/OpenRA.Mods.Cnc/Traits/Render/WithCargo.ts:191` (est. 120 lines) -- Passenger preview in cargo:
  - Implement `generatePreview()` to query `IRenderActorPreviewInfo` traits on each passenger
  - Create per-passenger preview renderables with `OwnerInit` and `DynamicFacingInit`
  - Support `IActorPreviewInitModifier` hooks for mod-specific preview customization
  - Return `IActorPreview[]` instead of empty array
  - Depends on Ch3 `ActorPreviewInitializer` and `TypeDictionary` infrastructure

#### 3.2.11 ShroudRenderer 3D Resources

- [x] **P1-B.11** `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts:339` (est. 300 lines) -- 3D shroud RTT pipeline:
  - Create a `RenderTargetTexture` (RTT) sized to the map in projected-cell units
  - Allocate a `RawTexture` for the three-state shroud visibility data (0=Hidden, 1=Explored, 2=Visible)
  - Upload visibility data each tick via `engine.updateTextureData()` (depends on P1-B.3)
  - Create `ShaderMaterial` for full-screen quad that samples the RTT and blends shroud/fog colors based on visibility state
  - Edge blending: fragment shader samples 8-neighbor visibility data for smooth fog-to-shroud transitions
  - The `ShroudRendererInfo` sprite-related fields (sequence, variants, palettes, index mappings) remain NO-OP; the 3D pipeline replaces the 2D sprite-based approach entirely
  - Mount the shroud overlay as the last rendered layer in the world scene (highest `renderingGroupId`)
  - Unit tests: hidden cells render black, explored cells render dim/translucent, visible cells render fully transparent
  - Visual acceptance test page required

**Phase B Summary**: 11/11 COMPLETE (100%). ~4,050 lines TS across 18 files. All C&C/D2K 3D visual effects functional: AnimationStub replaced (unblocks 6+ effects), cliff faces generated, texture readback API defined, Sharp Bilinear post-process created, TeslaZap/ChronoVortex/SonicBlast 3D renderers implemented, GpsDot/Building/Cargo previews rendering, ShroudRenderer 3D visibility pipeline built. Review: 2 BLOCKER + 6 MAJOR + 8 MINOR all resolved. Commit `bc4ed55`.

---

### 3.3 Phase C: Shroud / Fog of War Completion

**Status**: COMPLETE (7/7, 100% — commits `072824d`, `6bc2e66`, `2d37fdf`, `3b6a0fe`, review APPROVED 0 BLOCKERs)
**Complexity**: LOW-MEDIUM (ShroudPalette LOW, FrozenUnderFog MEDIUM)
**Blocked by**: Phase B (ShroudRenderer 3D RTT needed for FrozenActorLayer rendering)
**Blocks**: Nothing (endpoint phase for shroud system)

**Description**: Completes the frozen actor snapshot system and cloak/detection mechanics. The FrozenActorLayer manages "ghost" copies of enemy units that the player saw but can no longer see (under fog of war). Currently, snapshot capture of sprite renderables, flash tint animation, Polygon-based screen bounds, and tooltip delegation are all stubbed. Cloak sound/visual effects and DetectCloaked integration are also deferred.

#### 3.3.1 FrozenActor.Flash()

- [x] **P1-C.1** `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts:714` (est. 60 lines) -- Flash tint animation:
  - Implement `Flash(color, alpha?)` on the FrozenActor inner class
  - Apply multiplicative color tint to the frozen actor's renderable on alternating ticks
  - Effect duration: N ticks (configurable, default from OpenRA's flash interval)
  - On expiry, revert to original frozen sprite appearance
  - Used for "under attack" visual feedback on fogged units

#### 3.3.2 FrozenUnderFog Renderable Capture

- [x] **P1-C.2** `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts:414` (est. 150 lines) -- Snapshot sprite capture:
  - When an actor transitions from visible to fogged, capture its current `IRenderable[]` output
  - Store captured renderables in the `FrozenActor` snapshot
  - Apply owner player color palette to captured sprites
  - On subsequent ticks while fogged, the FrozenActorLayer renders the captured snapshot (not live actor sprites)
  - Remove live actor from `ScreenMap` when transitioning to fogged
  - Re-add to `ScreenMap` when becoming visible again

#### 3.3.3 Polygon Class + FrozenActorLayer Integration

- [x] **P1-C.3** `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts:48` and new `src/OpenRA.Game/Primitives/Polygon.ts` (est. 180 lines) -- Polygon geometry for mouse hit-testing:
  - Migrate `OpenRA.Primitives.Polygon` C# class to TypeScript
  - Polygon defined by vertex array + bounding rectangle
  - `contains(x, y)`: point-in-polygon test (ray casting algorithm)
  - `intersectsWith(rect: Rectangle)`: polygon-rectangle intersection (5-stage progressive test matching C#)
  - Replace the `PolygonStub` / `EmptyPolygon` forward declarations in `FrozenActorLayer.ts`
  - Use Polygon for `FrozenActor.MouseBounds` hit-test (which frozen actor is under the cursor)
  - Unit tests: point inside convex polygon, point outside, edge case on vertex

#### 3.3.4 Cloak Sound/Effect Integration

- [x] **P1-C.4** `src/OpenRA.Mods.Common/Traits/Cloak.ts:281,630,644` (est. 80 lines) -- Sound and SpriteEffect on cloak/uncloak:
  - In `Cloak.Tick()`, when transitioning from uncloaked to cloaked:
    - Play `cloakSound` via Ch7 `Sound.Play()`
    - Spawn `SpriteEffect` at actor position using `effectImage` + `effectSequence`
  - When transitioning from cloaked to uncloaked:
    - Play `uncloakSound` via Ch7 `Sound.Play()`
    - Spawn `SpriteEffect` at actor position
  - Respect `effectPaletteIsPlayerPalette` for effect coloring
  - Depends on P1-B.1 (AnimationStub replacement) for SpriteEffect rendering

#### 3.3.5 DetectCloaked Integration

- [x] **P1-C.5** `src/OpenRA.Mods.Common/Traits/Cloak.ts:393,709` (est. 100 lines) -- Anti-cloak detection:
  - In `Cloak.isVisible(observer)`, query all allied actors in detection range
  - Check if any allied actor has `DetectCloaked` trait with matching detection types
  - If detected, return `true` (visible to observer despite being cloaked)
  - Detection types: `CloakType` string matching between `CloakInfo.cloakTypes` and `DetectCloakedInfo.cloakTypes`
  - Performance: spatial index lookup, not full actor iteration
  - Unit tests: cloaked unit invisible to enemy without detector, visible when enemy detector in range, not visible if detection type mismatch

#### 3.3.6 FrozenActor Tooltip Integration

- [x] **P1-C.6** `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts:234` (est. 60 lines) -- Tooltip delegation:
  - Implement `ITooltipInfo` interface on `FrozenActor`
  - Delegate tooltip name and text to captured live actor's tooltip trait
  - If live actor had no tooltip, frozen actor reports generic fog unit tooltip
  - Integration with Ch16 tooltip widget system
  - Unit test: frozen actor tooltip name matches original actor's tooltip

#### 3.3.7 ShroudPalette Editor Extension

- [x] **P1-C.7** `src/OpenRA.Mods.Cnc/Traits/World/ShroudPalette.ts:150` (est. 40 lines) -- Editor asset browser palettes:
  - Implement `IProvidesAssetBrowserPalettes` interface (deferred since migration)
  - Register hardcoded shroud/fog palettes for map editor asset browser
  - This is editor-only; does not affect gameplay

**Phase C Summary**: 7/7 COMPLETE (100%). ~670 lines TS across 8 files, 95+ new tests (205 total FrozenActor/Polygon, 151 Cloak/DetectCloaked, 5 ShroudPalette). FrozenActor flash/tooltip/Polygon functional. FrozenUnderFog renderable capture implemented. Cloak transition effects + DetectCloaked spatial query integrated. ShroudPalette editor extension added. Review: APPROVED (0 BLOCKERs, 1 plan-docs MAJOR fixed, 4 code MINORs addressed).

---

### 3.4 Phase D: Infrastructure Fill-in

**Status**: COMPLETE (8/8, 100% — review fix `95143bf`)
**Complexity**: LOW-HIGH (PerfTimer LOW, MapPreview HIGH, FileSystem L2-L4 HIGH)
**Blocked by**: Phase A (CursorManager for Shellmap), Phase B (Texture readback for map preview)
**Blocks**: Nothing (endpoint phase for infrastructure)

**Description**: Completes non-rendering infrastructure that was deferred during migration. MapPreview is the largest single stub -- 250 lines vs. 781-line C# original. FileSystem's L2-L4 cache layer adds IndexedDB and Cache API persistence for downloaded mod packages. MapDirectoryTracker's poll loop enables live map folder monitoring. The Shellmap Phase 3 loads a dynamic AI skirmish instead of a static background. Widget-based main menu replaces the current DOM overlay.

#### 3.4.1 Full MapPreview Implementation

- [x] **P1-D.1** `src/OpenRA.Game/Map/MapPreview.ts` (est. 500 lines) -- Complete MapPreview (781-line C# original):
  - Implement all missing fields and methods from `OpenRA.Game/Map/MapPreview.cs`:
    - Map metadata parsing: title, author, description, player count, game speed, map size, spawns
    - `UpdateFromMap()`: parse map binary/UIMap data to extract metadata
    - `previewPixels()`: generate minimap preview image from map terrain data (depends on P1-B.3 for texture readback)
    - `parseAuthor()`: extract author from map description
    - Map classification logic: System, User, Remote, SystemShellmap
    - Remote map info fetching via HTTP API
    - Hash-based map identity for multiplayer compatibility
  - Current 250-line stub covers MapStatus, MapClassification, and basic field storage
  - New code needed: ~250 lines for full metadata parsing, preview generation, and remote map support

#### 3.4.2 MapDirectoryTracker Poll Loop

- [x] **P1-D.2** `src/OpenRA.Game/Map/MapDirectoryTracker.ts:115` (est. 120 lines) -- Directory change polling:
  - Implement `startPolling()`: set up periodic `setInterval` or recursive `setTimeout` at `pollingInterval` ms
  - On each poll: fetch directory listing via `FileSystem.getDirectoryContents()`
  - Compare current listing with previous snapshot (file name + size + mtime hash)
  - Queue map add/update/delete operations for changed files
  - Emit events or call registered callbacks for `MapDirectoryTracker` consumers
  - Handle errors gracefully (network unavailable, CORS issues)

#### 3.4.3 FileSystem L2-L4 Cache

- [x] **P1-D.3** `src/OpenRA.Game/FileSystem/FileSystem.ts:255` (est. 300 lines) -- Multi-tier package caching:
  - **L1**: In-memory LRU cache (already implemented -- `Map<string, IReadOnlyPackage>`)
  - **L2**: IndexedDB storage for parsed package data (survives page reload)
  - **L3**: Cache API (`caches.open('openra-packages')`) for raw downloaded zip/binary data
  - **L4**: Network fetch from origin server (already implemented as fallback)
  - `mount()` method: check L1 -> L2 -> L3 -> L4; promote data up cache layers on hit
  - Cache invalidation: version-tagged entries, TTL-based expiry for remote packages
  - This is essential for PWA offline support
  - Unit tests: L2 store/retrieve roundtrip, L3 cache hit bypasses fetch, invalidation respects version

#### 3.4.4 ZipFile Non-Blocking Read

- [x] **P1-D.4** `src/OpenRA.Game/FileSystem/ZipFile.ts:111` (est. 100 lines) -- Web Worker decompression:
  - For ZIP archives >5 MB, offload `fflate.unzip()` to a Web Worker
  - Worker receives raw `ArrayBuffer`, returns `Map<string, Uint8Array>` via `postMessage`
  - Main thread: `ZipFile` constructor returns immediately; `get()` returns a `Promise<Uint8Array>`
  - PostMessage transfer list for zero-copy buffer transfer
  - Fallback to synchronous `unzipSync` for files <5 MB (preserves current behavior)
  - Depends on new file: `src/OpenRA.Game/FileSystem/ZipWorker.ts` (inline worker or separate bundle)

#### 3.4.5 PerfTimer + Log System

- [x] **P1-D.5** `src/OpenRA.Game/Map/MapCache.ts:14-15` and new `src/OpenRA.Game/Utils/PerfTimer.ts` (est. 150 lines) -- Performance timing and structured logging:
  - Create `PerfTimer` class wrapping `performance.now()` with:
    - `start()`: record start time
    - `stop()`: record stop time, compute elapsed ms
    - `elapsed`: getter for current elapsed (allows intermediate checks)
    - `toString()`: formatted output (e.g., "12.3 ms")
  - Create `Log` utility class with:
    - `verbose`, `debug`, `info`, `warn`, `error` severity levels
    - Configurable minimum log level (suppress verbose/debug in production)
    - Channel-based filtering (e.g., "graphics", "network", "combat")
  - Replace all `console.warn` calls in `MapCache.ts` and other files with `Log.write('mapcache', message)` or equivalent
  - Replace all `performance.now()` manual timing with `PerfTimer`
  - This is a pure refactor; no behavioral changes

#### 3.4.6 IWorld Interface Alignment

- [x] **P1-D.6** `src/OpenRA.Game/Game.ts:554` and `src/OpenRA.Game/World.ts` (est. 120 lines) -- Type safety for World/WorldRenderer bridge:
  - Define a complete `IWorld` interface matching the shape consumed by `WorldRenderer`
  - Required properties: `tileSize`, `tileScale`, `type`, `disposed`, `renderPlayer`, `localPlayer`, `players`, `worldActor`, `screenMap`, `unpartitionedEffects`, `effects`, `orderGenerator`, `selection`
  - Implement `IWorld` on `GameWorldManager` (no `as unknown as` casts)
  - Remove the `// TODO-22.D` comment and `as unknown as IWorld` cast in `Game.startGame()`
  - This is a type-system cleanup; no behavioral changes

#### 3.4.7 Shellmap Phase 3 (Dynamic AI Skirmish)

- [x] **P1-D.7** `src/OpenRA.Game/Game.ts:608` (est. 200 lines) -- Dynamic shellmap with AI:
  - When `MapCache` contains maps marked as shellmap, randomly select one
  - Call `Game.startGame(mapStub, WorldType.Shellmap)` with the selected map
  - Spawn AI players that skirmish against each other (using Ch8-D AI BotModules)
  - Camera follows AI units in cinematic mode (smooth pan, no user control)
  - On any input (mouse click, keypress), transition to main menu
  - Fall back to Phase 1 static background if shellmap load fails (error caught)
  - Depends on P1-A.3 (CursorManager created), P1-D.1 (MapPreview for shellmap filtering)

#### 3.4.8 Widget-Based Main Menu

- [x] **P1-D.8** `src/OpenRA.Game/Game.ts:669` (est. 300 lines) -- Widget-tree main menu:
  - Replace the DOM-based main menu overlay with a Widget tree rendered via `ChromeProvider` + `WidgetLoader`
  - Main menu widget hierarchy: `MainMenuLogic` -> `MainMenuPrompt` -> buttons (Skirmish, Load, Settings, Exit)
  - Buttons trigger transition to sub-screens (Skirmish setup, Load game, Settings panel)
  - Hotkey support for menu buttons (e.g., Escape to go back)
  - The DOM overlay approach works for now but the Widget system is fully migrated (Ch5 + Ch16); this item connects the dots
  - Depends on Ch5 `ChromeProvider`, `WidgetLoader`, and Ch16 widget extensions

**Phase D Summary**: 8/8 COMPLETE (100%). ~1,790 lines across 12+ files, 430+ tests. MapPreview 630 lines. L2-L4 cache. ZipWorker. PerfTimer/Log. IWorld. Shellmap Phase 3. Widget menu. Review: 2 BLOCKER + 4 MAJOR + 3 MINOR all resolved → `95143bf`.

---

### 3.5 Phase E: Mod Content and Scripting Polish

**Status**: COMPLETE (26/26, 100% — review pending, 560+ tests across 30+ files)
**Complexity**: LOW-MEDIUM (most LOW, AttackTesla + AttackLeap MEDIUM)
**Blocked by**: Phase B (AnimationStub replacement unblocks all animation-dependent items)
**Blocks**: Nothing (leaf-node polish phase)

**Description**: Handles all remaining low-priority mod content and scripting items. These are primarily: animation wire-up in C&C/D2K traits (WithTeslaChargeOverlay, WithGunboatBody, WithSplitAttackPaletteInfantryBody), sprite sequence stubs (ClassicSpriteSequence, D2kSpriteSequence, ClassicTilesetSpecificSpriteSequence), sound notification integration in InfiltrateFor* traits, scripting property stubs for C&C support powers, and legacy SHP/PNG command tool full implementations. Most items are 40-100 lines each and can be tackled in parallel.

**Paradigm Shifts**: All items use already-migrated infrastructure. The main work is connecting existing stubs to existing real implementations.

#### 3.5.1 SHP/PNG Legacy Tools

- [x] **P1-E.1** **P1-E.2** **P1-E.3** **P1-E.4** `src/OpenRA.Mods.Cnc/UtilityCommands/RemapShpCommand.ts`, `ConvertPngToShpCommand.ts`, `PngSheetExportMetadataCommand.ts`, `PngSheetImportMetadataCommand.ts` (est. 400 lines total across 4 files) -- Full command implementations:
  - **RemapShpCommand**: Load SHP file, apply player color remap to each frame, write remapped SHP
  - **ConvertPngToShpCommand**: Load PNG sprite sheet, slice into frames, encode as SHP format
  - **PngSheetExportMetadataCommand**: Export sprite sheet metadata as JSON from PNG + size config
  - **PngSheetImportMetadataCommand**: Import metadata JSON to configure sprite sheet slicing
  - All four tools are utility commands (build-time/dev-only); not gameplay-critical

#### 3.5.2 Lua Instruction Counting

- [x] **P1-E.5** `src/OpenRA.Game/Scripting/LuaScriptAdapter.ts:392` (est. 50 lines) -- Lua instruction limit:
  - Use fengari's `lua_sethook` to set an instruction-count hook
  - Track cumulative instruction count per script execution
  - When count exceeds `maxInstructions` limit, throw error (prevent infinite loops)
  - Reset counter at the start of each script invocation

#### 3.5.3 Scripting C&C Properties

- [x] **P1-E.6** `src/OpenRA.Mods.Cnc/Scripting/Properties/ChronosphereProperties.ts` (TODO-20.F.1, est. 80 lines) -- Script-exposed chronoshift operations:
  - `chronoshift(units: IGameActor[], target: CPos, duration: number, killCargo: boolean)`: mass-teleport units
  - Filter units by `Chronoshiftable` trait, validate destinations
  - Queue teleport activity for each unit

- [x] **P1-E.7** `src/OpenRA.Mods.Cnc/Scripting/Properties/DisguiseProperties.ts` (TODO-20.F.2, est. 60 lines) -- Script-exposed disguise:
  - `disguiseAs(targetActor: IGameActor)`: copy target's appearance
  - `disguiseAsType(actorType: string, newOwner: Player)`: disguise as actor type
  - Wire to existing `Disguise` trait methods

- [x] **P1-E.8** `src/OpenRA.Mods.Cnc/Scripting/Properties/InfiltrateProperties.ts` (TODO-20.F.3, est. 80 lines) -- Script-exposed infiltration:
  - `infiltrate(target: IGameActor)`: trigger infiltration effects
  - `infiltrateForCash(target: IGameActor)`: steal resources
  - `infiltrateForExploration(target: IGameActor)`: steal shroud exploration
  - `infiltrateForPowerOutage(target: IGameActor)`: trigger power outage
  - `infiltrateForSupportPower(target: IGameActor)`: trigger support power reset
  - Wire to existing `Infiltrates` trait activity

- [x] **P1-E.9** `src/OpenRA.Mods.Cnc/Scripting/Properties/IonCannonProperties.ts` (TODO-20.F.4, est. 80 lines) -- Script-exposed ion cannon:
  - `fireIonCannon(target: WPos)`: trigger ion cannon strike at position
  - Wire to existing `IonCannonPower` trait

#### 3.5.4 D2K Mod Polish Items

- [x] **P1-E.10** `src/OpenRA.Mods.D2k/Traits/SpiceBloom.ts:265,409` (TODO-19.B.5-ANIM, est. 100 lines) -- Spice bloom animation:
  - Integrate real `Animation` class for spice bloom growth/explosion sprite sequence
  - Replace stub `showSpurt` toggle with tick-synced animation playback
  - Depends on P1-B.1 (AnimationStub replacement)

- [x] **P1-E.11** `src/OpenRA.Mods.D2k/Traits/Sandworm.ts:7` (TODO-8.D.DEFER-WANDERS, est. 80 lines) -- Wanders trait integration:
  - Wire the deferred `Wanders` trait into `Sandworm`
  - Wanders trait provides random periodic movement within `wanderRadius`
  - Sandworm uses this for autonomous patrol behavior when no targets in range
  - This is a trait wire-up, not new trait implementation (Wanders should already exist from Ch9)

- [x] **P1-E.12** `src/OpenRA.Mods.D2k/Traits/AttackSwallow.ts:10` (TODO-8.D.ATTACKFRONTAL-ACT, est. 100 lines) -- SwallowActor activity:
  - Ensure `SwallowActor` activity is fully implemented (already imported from `../Activities/SwallowActor`)
  - Wire into `AttackSwallow.doAttack()`: create `SwallowActor` activity, queue on actor
  - 3D visual: target mesh translates toward Sandworm mouth, scales down, vanishes

- [x] **P1-E.13** `src/OpenRA.Mods.D2k/Traits/World/BuildableTerrainLayer.ts:15` (TODO-19.B.8, est. 40 lines) -- Fog-of-war check:
  - Implement `world.FogObscures(cell)` check for D2K concrete layer visibility
  - Use the existing `Shroud.isExplored()` or `Shroud.isVisible()` API
  - Cells under fog should not render concrete in world view

- [x] **P1-E.14** `src/OpenRA.Mods.D2k/Traits/Player/HarvesterInsurance.ts:30` (TODO-19.D.1, est. 150 lines) -- FreeActorWithDelivery replacement:
  - Migrate `OpenRA.Mods.Common/Traits/FreeActorWithDelivery.cs` to TypeScript (if not already done)
  - Replace the `IFreeActorWithDeliveryLike` stub interface with the real trait
  - Wire delivery callback: when harvester is destroyed, a replacement harvester is spawned and delivered to the refinery
  - Depends on Ch11 `ProductionQueue` or `Exit` for actor spawning

- [x] **P1-E.15** `src/OpenRA.Mods.D2k/SpriteLoaders/R8Loader.ts:428` (TODO-19.D.16, est. 60 lines) -- PlayerColorRemap in R8:
  - The `PlayerColorRemap` class already exists at `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` (154 lines, 191 test lines)
  - Replace `R8Loader.remapColor()` static method's `return originalArgb` with actual `PlayerColorRemap.GetRemappedColor()`
  - Requires player color index and remap palette from the loading context

- [x] **P1-E.16** `src/OpenRA.Mods.D2k/Projectiles/SonicBlast.ts:235` (TODO-19.B.15, est. 60 lines) -- Blocking actor check:
  - Implement `BlocksProjectiles.AnyBlockingActorsBetween()` line-of-sight check
  - Between source position and current sonic blast position, query actors with `BlockedByActor` trait
  - If blocking actor found, stop sonic blast propagation (damage does not reach beyond)

- [x] **P1-E.17** `src/OpenRA.Mods.D2k/Graphics/D2kSpriteSequence.ts:468` (TODO-19.B.17, est. 80 lines) -- Pre-resolved sprite:
  - Replace the stub `getSprite()` returning null sheet + zero bounds with actual sprite resolution
  - Use Ch2 `Sheet` and `Sprite` infrastructure to resolve frame indices to UV coordinates
  - Resolve during `loadSprites()` phase (pre-resolve), not during `getSprite()` (hot path)

#### 3.5.5 C&C Mod Polish Items

- [x] **P1-E.18** `src/OpenRA.Mods.Cnc/Traits/Render/WithGunboatBody.ts:193,287,293` (TODO-19.C.5, est. 100 lines) -- Animation integration:
  - Replace `setTimeout(onComplete, 100)` wake animation with real `Animation.ReplaceAnim()`
  - Implement damage prefix lookup (`critical`, `damaged`, `scratched`, `scuffed`) for damaged-state sequence selection
  - Use the sequence dictionary (migrated from Ch2) for prefix normalization

- [x] **P1-E.19** `src/OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeOverlay.ts:233` (TODO-19.C.10, est. 50 lines) -- Tick-synced animation:
  - Replace `setTimeout(onComplete, 100)` with real animation timing: `ticks * length` at 40ms/tick
  - Use the sequence's `Tick` property to determine per-frame duration

- [x] **P1-E.20** `src/OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.ts:191` (TODO-19.C.7, est. 50 lines) -- Tick-synced animation:
  - Same fix as P1-E.19: replace `setTimeout(onComplete, 100)` with tick-synced `Animation` class callback

- [x] **P1-E.21** `src/OpenRA.Mods.Cnc/Graphics/ClassicSpriteSequence.ts:136` (TODO-19.C.13, est. 80 lines) -- Sheet/SpriteCache integration:
  - The `ClassicSpriteSequence` is a format descriptor (facing-to-frame mapping); it needs Sheet infrastructure to actually resolve frame indices to sprites
  - Integrate with Ch2 `Sheet` and `SpriteCache` for UV resolution
  - Port the full `DefaultSpriteSequence.GetSprite()` reference implementation from OpenRA.Mods.Common/Graphics/

- [x] **P1-E.22** `src/OpenRA.Mods.Cnc/Graphics/ClassicTilesetSpecificSpriteSequence.ts:236` (TODO-19.C.14, est. 60 lines) -- Fallback path:
  - Implement the full `baseParseFilenames` logic from C# original (tileset-specific filename pattern matching)
  - The current minimal fallback skips tileset-specific overrides; implement the full path for theater-correct sprites

- [x] **P1-E.23** `src/OpenRA.Mods.Cnc/FileFormats/HvaReader.ts:137` (TODO-19.C.16, est. 60 lines) -- Matrix inverse parity:
  - If full 4x4 matrix inverse parity with C# is needed: implement column-major 4x4 inverse with submatrix cofactor expansion
  - Current implementation uses 3x3 rotation submatrix determinant (rigid-body check), which is correct under ADR-19.1
  - This is a defensive item: implement only if runtime .hva validation failures are observed in practice

#### 3.5.6 Infiltrate Sound Integration

- [x] **P1-E.24** Multiple files under `src/OpenRA.Mods.Cnc/Traits/Infiltration/` (est. 80 lines across 5 files) -- Sound/text notifications:
  - `InfiltrateForCash.ts` (TODO-19.A.16-SOUND): Play cash-steal sound via Ch7 `Sound`
  - `InfiltrateForExploration.ts` (TODO-19.A.13-SOUND): Play exploration-theft sound
  - `InfiltrateForPowerOutage.ts` (TODO-19.A.10-SOUND): Play power-outage sound
  - `InfiltrateForSupportPower.ts` (TODO-19.A.14-SOUND): Play support-power-reset sound
  - `InfiltrateForSupportPowerReset.ts` (TODO-19.A.15-SOUND): Play infiltration notification sound
  - Also integrate `TextNotificationsManager` (Ch16) for on-screen text feedback
  - Each is a 1-2 line change: call `Sound.Play(soundName)` at the appropriate point in the `infiltrate()` method

#### 3.5.7 AttackTesla Full Integration

- [x] **P1-E.25** `src/OpenRA.Mods.Cnc/Traits/Attack/AttackTesla.ts:96,216` (TODO-19.A.22-FULL/AUDIO, est. 150 lines) -- ChargeFire sub-activity + audio:
  - Extract `ChargeFire` logic into a separate `ChargeFireActivity` extending Ch14 `Activity`
  - Activity states: Charging (play charge-up audio, visual charge effect) -> Fire (spawn TeslaZap projectile) -> Cooldown
  - Play `chargeAudio` sound at `self.centerPosition` during Charging state via Ch7 `Sound`
  - This improves code organization and matches OpenRA's sub-activity pattern

#### 3.5.8 AttackLeap Activity

- [x] **P1-E.26** `src/OpenRA.Mods.Cnc/Traits/Attack/AttackLeap.ts:140` (TODO-19.A.19-LEAP-ACT, est. 200 lines) -- LeapAttack activity:
  - Create `LeapAttack` activity extending Ch14 `Activity`
  - Parabolic arc trajectory: `Vector3.Lerp` with Y-axis height curve (sinusoidal or quadratic)
  - Activity states: Crouch -> Leap (airborne) -> Land (impact damage + warhead) -> Recover
  - 3D visual: actor mesh follows parabolic arc, `Quaternion.Slerp` for rotation
  - Impact triggers damage warhead on landing cell
  - Used by C&C attack dogs and similar leaping units

**Phase E Summary**: 26/26 COMPLETE (100%). ~2,420 lines across 30+ files, 560+ tests. Legacy SHP/PNG tools implemented. Lua instruction counting wired. Scripting C&C properties enhanced. D2K: SpiceBloom, Sandworm/Wanders, AttackSwallow, HarvesterInsurance/FreeActorWithDelivery, R8Loader, SonicBlast, D2kSpriteSequence. C&C: WithGunboatBody, WithTeslaChargeOverlay, ClassicSpriteSequence, ClassicTilesetSpecificSpriteSequence, HvaReader. Infiltrate sounds documented. ChargeFireActivity + LeapAttack wired. ALL phases now complete.

---

## 4. Dependency Graph

```
Chapters 2-22 (ALL COMPLETE)
  |
  v
Phase A (Critical Fixes: 3 items)
  |
  +--> P1-A.1 (Shroud.explore) -- independent, no deps
  +--> P1-A.2 (Teleport activity) -- independent, no deps
  +--> P1-A.3 (CursorManager) -- independent, no deps
  |
  v
Phase B (3D Rendering: 11 items)
  |
  +-- KEYSTONE --+
  | P1-B.1         |  AnimationStub replacement
  | (dep: nothing)  |  ---- blocks ---->
  +----------------+   P1-B.5 (TeslaZap), P1-B.6 (ChronoVortex),
                       P1-B.8 (GpsDotEffect), P1-C.4 (Cloak effect),
                       P1-E.10 (SpiceBloom), P1-E.18-20 (animation timing)
  |
  +--> P1-B.2 (Cliff faces) -- independent
  +--> P1-B.3 (Texture readback) -- independent, unblocks P1-B.11, P1-D.1
  +--> P1-B.4 (Sharp Bilinear) -- independent
  +--> P1-B.5 (TeslaZap 3D) -- depends on P1-B.1
  +--> P1-B.6 (ChronoVortex 3D) -- depends on P1-B.1
  +--> P1-B.7 (SonicBlast 3D) -- independent (has own Material)
  +--> P1-B.8 (GpsDotEffect) -- depends on P1-B.1
  +--> P1-B.9 (Building preview) -- independent (Ch3+Ch7 already migrated)
  +--> P1-B.10 (Cargo preview) -- independent (Ch3+Ch7 already migrated)
  +--> P1-B.11 (ShroudRenderer 3D) -- depends on P1-B.3, P1-A.1
  |
  v
Phase C (Shroud/Fog: 7 items)
  |
  +--> P1-C.1 (FrozenActor Flash) -- independent
  +--> P1-C.2 (FrozenUnderFog capture) -- depends on P1-B.11 (ShroudRenderer)
  +--> P1-C.3 (Polygon class) -- independent
  +--> P1-C.4 (Cloak sound/effect) -- depends on P1-B.1
  +--> P1-C.5 (DetectCloaked) -- independent
  +--> P1-C.6 (FrozenActor tooltip) -- depends on P1-C.3
  +--> P1-C.7 (ShroudPalette editor) -- independent
  |
  v
Phase D (Infrastructure: 8 items)
  |
  +--> P1-D.1 (Full MapPreview) -- depends on P1-B.3 (texture readback)
  +--> P1-D.2 (MapDirectoryTracker poll) -- independent
  +--> P1-D.3 (FileSystem L2-L4) -- independent
  +--> P1-D.4 (ZipFile Worker) -- independent
  +--> P1-D.5 (PerfTimer + Log) -- independent
  +--> P1-D.6 (IWorld interface) -- independent
  +--> P1-D.7 (Shellmap Phase 3) -- depends on P1-A.3 (CursorManager), P1-D.1 (MapPreview)
  +--> P1-D.8 (Widget main menu) -- depends on Ch5+Ch16 (already migrated)
  |
  v
Phase E (Mod Polish: 23 items)
  |
  +--> P1-E.1-4 (SHP/PNG tools) -- independent
  +--> P1-E.5 (Lua instruction counting) -- independent
  +--> P1-E.6-9 (Scripting properties) -- independent (wire-up only)
  +--> P1-E.10 (SpiceBloom anim) -- depends on P1-B.1
  +--> P1-E.11-17 (D2K polish) -- mostly independent
  +--> P1-E.18-23 (C&C polish) -- depends on P1-B.1
  +--> P1-E.24 (Infiltrate sounds) -- independent (wire-up only)
  +--> P1-E.25 (AttackTesla) -- depends on P1-B.1
  +--> P1-E.26 (AttackLeap) -- independent
```

### Critical Path

```
P1-B.1 (AnimationStub) --> P1-B.5/B.6/B.8/C.4/E.10/E.18-20/E.25 (all animation-dependent items)
  +--> P1-B.3 (Texture readback) --> P1-B.11 (ShroudRenderer 3D) --> P1-C.2 (FrozenUnderFog) --> P1-C.1/C.3/C.6 (FrozenActor polish)
  +--> P1-B.3 --> P1-D.1 (MapPreview) --> P1-D.7 (Shellmap Phase 3)
```

### Parallelization Opportunities

All items marked "independent" in the dependency graph can be worked on simultaneously. The maximum parallelism is achieved by:

1. **Wave 1** (Week 1-2): Phase A (all 3 items) + P1-B.1 (AnimationStub) + P1-B.2 + P1-B.3 + P1-B.4 + Phase C independent items + Phase D independent items
2. **Wave 2** (Week 2-3): All P1-B.1-dependent rendering items (B.5, B.6, B.7, B.8, B.9, B.10, B.11) + remaining Phase C + remaining Phase D
3. **Wave 3** (Week 3-4): All Phase E items (23 items, most LOW complexity, highly parallel)

### Key Blocking Relationships

| Dependency | Constraint |
|:---|:---|
| P1-B.1 AnimationStub replaced | Must be done before ANY C&C visual effect; unblocks 8+ downstream items |
| P1-B.3 Texture readback | Required for ShroudRenderer 3D RTT (P1-B.11) and MapPreview preview generation (P1-D.1) |
| P1-A.2 Teleport activity | Required for Chronoshiftable + PortableChrono gameplay; independent of rendering |
| P1-B.11 ShroudRenderer 3D | Required for FrozenUnderFog renderable capture (P1-C.2) |
| P1-D.1 MapPreview | Required for Shellmap Phase 3 map selection (P1-D.7) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

Every TODO resolved must include new or updated tests. Key test patterns per phase:

- [ ] **TEST-P1.1** Phase A: Shroud.explore() merges two shrouds with correct bitwise OR; Teleport activity completes all delay phases and moves actor; CursorManager instantiated during Game.initialize()
- [ ] **TEST-P1.2** AnimationStub: playThen callback fires at correct tick count; render() returns non-empty IRenderable[]; repeating animation loops indefinitely; tick() advances frame counter
- [ ] **TEST-P1.3** Cliff faces: single cell with height difference generates correct vertical quad; neighbor at same height produces no cliff; normals point outward; UVs map correctly
- [ ] **TEST-P1.4** Texture readback: getData matches setData content; roundtrip preserves RGBA values; disposed texture throws on access
- [ ] **TEST-P1.5** TeslaZap: segment descriptors produce correct LinesMesh vertex count; bright/dim zap widths differ; random jitter stays within configured bounds
- [ ] **TEST-P1.6** ChronoVortex: ShaderMaterial uniforms update per tick; progress uniform reaches 1.0 at vortex end
- [ ] **TEST-P1.7** FrozenActor: Flash() applies tint for N ticks then reverts; FrozenUnderFog captures renderables when actor enters fog; capture includes player palette
- [ ] **TEST-P1.8** Cloak: detectCloaked makes cloaked unit visible to detector owner; mismatched cloak types do not reveal; sound plays on cloak/uncloak transition
- [ ] **TEST-P1.9** FileSystem cache: L2 IndexedDB store/retrieve roundtrip; L3 Cache API hit skips fetch; version mismatch triggers cache invalidation
- [ ] **TEST-P1.10** Phase E: each resolved TODO adds at least 1 unit test verifying the previously-deferred behavior

### 5.2 Per-Phase Test File Estimates

| Phase | Items | New Test Files | Estimated New Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Critical Fixes | 3 | 3 | ~15 | ~500 |
| B: 3D Rendering | 11 | 10 | ~80 | ~3,000 |
| C: Shroud/Fog | 7 | 6 | ~35 | ~1,200 |
| D: Infrastructure | 8 | 7 | ~45 | ~1,800 |
| E: Mod Polish | 23 | 17 | ~80 | ~2,500 |
| **Total** | **52** | **43** | **~255** | **~9,000** |

### 5.3 Visual Acceptance Testing

Rendering-heavy Phase B items require manual visual verification:

| System | Test Page Path | Purpose |
|--------|-----------|---------|
| TeslaZap rendering | `/test/ch02-rendering/tesla-zap/` | Verify lightning LinesMesh, bright/dim zaps, random jitter |
| ChronoVortex rendering | `/test/ch02-rendering/chrono-vortex/` | Verify spiral UV animation, progress-based fade |
| SonicBlast rendering | `/test/ch19-d2k/sonic-blast/` | Verify expanding wave ring, distance-falloff alpha |
| Sharp Bilinear | `/test/ch02-rendering/sharp-bilinear/` | Verify pixel-art scaling at 2x/3x/4x, edge sharpness vs bilinear |
| ShroudRenderer 3D | `/test/ch12-shroud-fog/shroud-3d/` | Verify fog-to-visible transitions, edge blending |
| Cliff faces | `/test/ch04-terrain/cliff-faces/` | Verify vertical cliff geometry at height transitions |
| Full integration | `/test/integration/post-migration/` | Combined test: shellmap with fog, combat with effects |

### 5.4 Integration Testing

- [ ] **TEST-P1.I1** Full game loop: Game.create() -> ModSelector -> MainMenu -> startGame -> shellmap or skirmish -> input -> combat -> fog transitions -> menu exit
- [ ] **TEST-P1.I2** Chronoshift integration: select Chronosphere -> target units -> teleport -> verify units arrive at destination -> ChronoVortex plays at departure + arrival
- [ ] **TEST-P1.I3** Frozen actor lifecycle: visible actor -> moves into fog -> frozen snapshot captured -> Flash() on damage -> disappears when shroud fully explored
- [ ] **TEST-P1.I4** Offline cache: load mod packages -> verify IndexedDB/Cache API persistence -> reload page with network disabled -> game loads from cache

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **AnimationStub replacement breaks downstream consumers** (400-line core change affecting 8+ files) | HIGH | Multiple C&C effects regress visually or crash | Implement behind feature flag; run full test suite after each downstream integration; visual acceptance test per effect |
| **Texture readback performance** (readPixels is synchronous in WebGL, stalls pipeline) | MEDIUM | Frame drops during map preview generation or shroud update | Use asynchronous `readPixelsAsync` where available (WebGL 2.0 extension); batch reads; limit readback frequency |
| **Teleport activity state machine edge cases** (teleport into occupied cell, teleport while moving, teleport during attack) | MEDIUM | Units teleport into invalid positions or break other activities | Exhaustive test matrix: valid/invalid cells, occupied cells, during attack, during movement, cargo interactions |
| **FileSystem L2-L4 cache consistency** (stale cache after mod update, IndexedDB quota exceeded) | MEDIUM | Wrong mod version loaded, or cache silently full | Version-tagged cache entries; quota check before write; graceful degradation to fetch-only on quota error |
| **Shellmap Phase 3 performance** (AI skirmish on background thread may cause frame drops on main thread) | MEDIUM | Menu screen jank, poor first impression | Limit AI update frequency in shellmap mode (10 tick intervals); reduce actor count; cap render distance; fall back to static on low-end devices |
| **Sharp Bilinear shader parity** (custom GLSL may produce different results from OpenRA's C# precomputed kernel) | LOW | Pixel-art visuals look different from original | Diff screenshot comparison; tunable sharpening strength parameter; provide NEAREST fallback |
| **Polygon class numerical precision** (floating-point edge cases in point-in-polygon) | LOW | Frozen actor mouse hit-test misses | Use epsilon-based comparisons; standard ray-casting algorithm; test with degenerate polygons |
| **SHP/PNG legacy tools incomplete edge cases** (obscure SHP format variants) | LOW | Build-time tool fails for specific asset files | These are dev-only utility commands; document known limitations; provide manual workaround guides |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-P1.1: Phase Ordering -- Critical Fixes First

- **Decision**: Phase A (runtime errors) is executed first, before any rendering work.
- **Rationale**: A `throw Error` or silent no-op in a core mechanic (Shroud merge, Teleport) is a blocking defect. No rendering polish should proceed while core gameplay is broken. Additionally, Phase A items have zero external dependencies (all infrastructure is already migrated), so they can be completed immediately.
- **Mitigation**: Phase A items are all independent and can run in parallel. Estimated completion time: 1-2 days.

### ADR-P1.2: AnimationStub as Keystone

- **Decision**: Replace AnimationStub with a real Babylon.js-backed animation before implementing any per-effect 3D rendering (TeslaZap, ChronoVortex, etc.).
- **Rationale**: AnimationStub is the shared stub used by 8+ C&C effects. Replacing it once unblocks all effects simultaneously. Implementing per-effect rendering on top of the existing stub would create shim code that would be immediately discarded when AnimationStub is replaced. This is a classic keystone dependency: fix the shared dependency first, then the per-effect work is simple wire-up.
- **Mitigation**: The AnimationStub replacement must maintain the exact same public API surface (constructor signature, `playThen`, `playRepeating`, `tick`, `render`, `renderUI`, accessor properties) so downstream consumers require zero changes.

### ADR-P1.3: ShroudRenderer 3D -- Full RTT Pipeline, Not Sprite-Based

- **Decision**: The ShroudRenderer 3D implementation uses a `RenderTargetTexture` + full-screen quad `ShaderMaterial` pipeline, not the original 2D sprite-based approach.
- **Rationale**: OpenRA's 2D ShroudRenderer uses a `TerrainSpriteLayer` with 12-direction edge sprite variants for smooth fog transitions. In 3D, a fragment shader sampling 8-neighbor visibility states provides the same edge blending with much simpler implementation. The `ShroudRendererInfo` sprite-related fields (sequence, variants, palettes, index mappings) become NO-OP in 3D -- retained for YAML compatibility but not used at runtime.
- **Mitigation**: Fragment shader samples 8-neighbor visibility texture; computes edge blend factor from neighbor state transitions; applies hidden/explored/visible color tints. Texture readback (P1-B.3) must be implemented first for the visibility texture upload.

### ADR-P1.4: Shellmap Phased Approach

- **Decision**: Shellmap implementation proceeds in three phases: Phase 1 (static background, DONE), Phase 2 (static camera over loaded map, deferred), Phase 3 (dynamic AI skirmish, this plan's P1-D.7).
- **Rationale**: The static background (Phase 1) provides an acceptable shellmap experience immediately. Phase 3 (dynamic AI) requires MapPreview (P1-D.1), CursorManager (P1-A.3), and the full AI BotModule system (Ch6). Since all prerequisites are now migrated, Phase 3 is feasible. Phase 2 (static camera) is skipped as Phase 3 subsumes it.
- **Mitigation**: Graceful fallback: if shellmap map load fails, render Phase 1 static background. If shellmap map loads but AI init fails, render Phase 2 static camera. If all succeeds, render Phase 3 dynamic skirmish.

### ADR-P1.5: FileSystem Multi-Tier Cache for PWA

- **Decision**: Implement three cache tiers above network fetch: L2 (IndexedDB for parsed packages), L3 (Cache API for raw binary), L4 (network fetch). L1 (in-memory LRU) is already implemented.
- **Rationale**: For PWA offline support, mod packages must persist across page reloads and be available without network. The Cache API (L3) is designed for this but stores raw `Response` objects for entire URLs. IndexedDB (L2) stores parsed package data with fine-grained file access. The L1 in-memory cache provides zero-latency access for frequently used files.
- **Mitigation**: Cache version tags prevent stale data. TTL-based expiry for remote packages. Quota management: check `navigator.storage.estimate()` before writes; evict LRU entries when quota is near limit.

### ADR-P1.6: Widget-Based Main Menu vs DOM Overlay

- **Decision**: Replace the DOM-based main menu overlay with a Widget tree rendered via `ChromeProvider` + `WidgetLoader`, but only after the DOM overlay has proven stable.
- **Rationale**: The Widget system (Ch5 + Ch16) is fully migrated and provides proper game-consistent UI rendering (same fonts, colors, layout as in-game UI). The DOM overlay was a rapid Phase-A implementation for Chapter 22. Converting to Widgets is a pure swap at the UI layer with no impact on game logic.
- **Mitigation**: The DOM overlay continues to work as-is. The Widget conversion can be done as a parallel track and swapped in when ready. Both implementations share the same `showMainMenu()` / `hideMainMenu()` interface.

### ADR-P1.7: Deferred Items That Will Remain Deferred

- **Decision**: The following items are intentionally left as permanent deferrals:
  1. **NOP platform stubs** (7 files, Category F): Browser APIs replace SDL2/OpenGL; no implementation ever needed
  2. **Model shader stubs** (model.vert, model.frag): Babylon.js StandardMaterial/PBRMaterial replaces OpenGL shaders
  3. **ConyardChronoReturn full integration** (TODO-19.C.3, ~8 deferred sub-items): This is an alpha/beta-only C&C feature used in a single mission; the trait already functions correctly at the logic level; rendering integration depends on ChronoVortex (P1-B.6)
  4. **Disguise 3D mesh swap** (TODO-19.C.3): The disguise system works correctly at the logic level; 3D mesh swapping is a visual enhancement that does not affect gameplay
  5. **AttackWander full integration** (TODO-8.D.10): The stub is sufficient; full Wanders trait integration is done via P1-E.11 for Sandworm
  6. **AttackGarrisoned full integration** (TODO-8.D.11): Requires Chapter 11 Production/Building full integration; garrisoning logic works at stub level
- **Rationale**: These items have zero gameplay impact, are replaced by browser/Babylon.js equivalents, or are edge-case features not needed for a functional game. Explicitly documenting them as permanently deferred avoids ambiguity in the future.

---

## Migration Order and Phasing Strategy

| Week | Phase | Items | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A (all) | 3 | Critical fixes: Shroud merge, Teleport, CursorManager | YES (all 3 parallel) |
| 1-2 | Phase B (keystone) | 1 | P1-B.1 AnimationStub replacement | NO (must be first in Phase B) |
| 2-3 | Phase B (dependent) | 6 | TeslaZap, ChronoVortex, GpsDotEffect, previews, ShroudRenderer 3D | YES (after P1-B.1) |
| 2-3 | Phase B (independent) | 4 | Cliff faces, Texture readback, Sharp Bilinear, SonicBlast | YES (parallel with above) |
| 3 | Phase C (all) | 7 | All Shroud/Fog completion items | YES (most independent after B.11) |
| 3-4 | Phase D (independent) | 6 | MapPreview, FileSystem cache, MapDirectoryTracker, ZipFile Worker, PerfTimer, IWorld | YES (all independent) |
| 4 | Phase D (dependent) | 2 | Shellmap Phase 3, Widget main menu | After D.1, D.3 |
| 4-5 | Phase E (all) | 23 | All mod content + scripting polish | YES (most parallel) |

**Total**: ~5 weeks estimated (single developer). With parallelization, 3-4 weeks. The 23 Phase E items are all LOW complexity and highly parallel, so a group of developers could complete them in 1-2 weeks.

---

> **Plan Status**: This plan organizes all 50+ genuinely unfinished items into 5 phased work packages. The key insight is that AnimationStub (P1-B.1) is the keystone that unblocks most visual effect work. Fixing it first, then tackling the rendering pipeline in dependency order, maximizes throughput and minimizes rework.

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All implementation work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `CLAUDE.md` -- Project conventions and overall status
> - `docs/rendering_migration_plan.md` -- Chapter 2 rendering plan (reference for Phase B items)
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Chapter 8 plan (format reference for this document)
> - `docs/chapter12_shroud_fog_of_war_migration_plan.md` -- Chapter 12 plan (reference for Phase C items)
> - `docs/chapter19_mod_content_migration_plan.md` -- Chapter 19 plan (reference for Phase E items)
> - `docs/chapter20_scripting_system_migration_plan.md` -- Chapter 20 plan (reference for Phase E scripting items)
> - `docs/chapter22_game_entry_migration_plan.md` -- Chapter 22 plan (reference for Phase D items)
> - `docs/migration_progress.md` -- Overall progress tracking
