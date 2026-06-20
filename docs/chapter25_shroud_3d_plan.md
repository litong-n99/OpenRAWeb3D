# OpenRA to Babylon.js Migration Plan: Chapter 25 -- Shroud & Fog of War 3D Completion

> **Source Reference**: `OpenRA.Mods.Common/Traits/World/ShroudRenderer.cs` + FrozenActor system
> **Chapter Status**: Phase A COMPLETE (2/7 migrated)
> **Planning Date**: 2026-06-20
> **Prerequisite**: Chapters 2-22 COMPLETE, Chapter 24 (AnimationStub for Flash effects)

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: ShroudRenderer 3D Rendering Verification & Fix](#31-phase-a-shroudrenderer-3d-rendering-verification--fix)
   - 3.2 [Phase B: FrozenActor 3D Flash & Tint Rendering](#32-phase-b-frozenactor-3d-flash--tint-rendering)
   - 3.3 [Phase C: Fog Visibility Trait Integration](#33-phase-c-fog-visibility-trait-integration)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Problem Statement

The Shroud & Fog of War system is **substantially complete** at the code level. The `ShroudRenderer` has a full 3D pipeline: `RawTexture` for visibility data, `ShaderMaterial` with 8-neighbor edge blending fragment shader, ground-plane `Mesh` with correct `renderingGroupId=2`. The `FrozenActorLayer` has `Flash()`, `Polygon` hit-testing, and `MouseBounds`. The `Cloak` trait has `DetectCloaked` spatial queries.

The remaining gaps are **integration-level** rather than infrastructure:

1. **ShroudRenderer may not actually render**: The ground-plane mesh is created in `_createShroudResources()` but may not be connected to the real Shroud data source at runtime. The `_updateShroudTexture()` method is called from `renderShroud()` which iterates `this._map.projectedCells`, but the Shroud data may not be populated when the renderer is initialized.

2. **FrozenActor Flash() 3D tinting**: `Flash()` sets internal `_flashTint`/`_flashAlpha`/`_flashMods` properties, but the 3D rendering path (`IRenderable` with `IModifyableRenderable.WithTint/WithAlpha`) is deferred (`TODO-12.DEFERRED.13`). Flashing frozen actors under fog is not visible in 3D.

3. **Fog visibility traits not integrated**: `HiddenUnderFog`, `HiddenUnderShroud`, and `DetectCloaked` traits have their game-logic checks, but the visual effects (hiding actors, showing detection outlines) are not connected to the 3D render pipeline.

4. **FrozenUnderFog renderable capture**: When an actor transitions from visible to fogged, its `IRenderable[]` output must be snapshotted and stored in the `FrozenActor`. The live actor must be removed from the `ScreenMap`. This snapshot/capture pipeline is presently incomplete.

### 1.2 Core Paradigm Shift

- **C# FrozenActor 2D sprite flash (palette swap)** -> TypeScript 3D material tinting via `material.emissiveColor` / color uniform override on the frozen mesh's ShaderMaterial
- **C# `IModifyableRenderable.WithTint/WithAlpha`** -> Babylon.js material property mutation (`alpha`, `emissiveColor.r/g/b` multiplied by tint)
- **C# `ScreenMap` 2D rectangle-based visibility culling** -> Babylon.js `mesh.setEnabled(bool)` for fog-based actor hiding (simpler, leverages GPU culling)
- **C# `FrozenUnderFog.tickRender` capturing `IRenderable[]`** -> TypeScript renderable snapshot captured at the transition boundary and stored as a flat list of mesh + material references

### 1.3 Architecture Principles

1. **ShroudRenderer integration first**: Before adding any new features, verify the existing 3D shroud pipeline actually renders. The ShroudRenderer class has ~1000 lines of working code. The likely gap is that it's never instantiated or its `worldLoaded()` method is never called in the game startup flow.

2. **Material tinting over palette remapping**: In 2D OpenRA, frozen actor flash effects are achieved via palette swapping. In 3D, the equivalent is multiplying the material's emissive/diffuse color by the flash tint color. This requires the frozen actor's mesh to have a material that supports color modulation.

3. **FrozenActor renderable snapshots are mesh references**: When capturing an actor's visual state for the FrozenActor, we store references to the actor's current meshes and their materials. On subsequent frames, we render these meshes at their last known position (no animation update). This avoids duplicating mesh geometry.

4. **Visibility trait integration uses mesh enabled/disabled**: `HiddenUnderFog` and `HiddenUnderShroud` toggle `mesh.setEnabled(false)` when the actor should be hidden. This is simpler than removing/re-adding meshes from the scene and leverages Babylon.js's built-in frustum culling to skip disabled meshes.

5. **DetectCloaked visual indicator**: When a cloaked unit is detected by an enemy's `DetectCloaked` trait, apply a brief `emissiveColor` pulse (white flash) to the cloaked unit's mesh. This provides the "spotted" visual feedback.

### 1.4 Completed Foundation

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Shroud (game logic) | Ch12 | `Shroud`, `CellVisibility`, `Shroud.explore()`, dirty callbacks |
| ShroudRenderer (3D) | Ch12 | `ShroudRenderer`, `RawTexture`, `ShaderMaterial`, ground-plane Mesh, visibility texture updates, 8-neighbor edge blending, `renderingGroupId=2` |
| FrozenActorLayer | Ch12 | `FrozenActor`, `Flash()` (logic), `Polygon` hit-testing, `MouseBounds` |
| Cloak + DetectCloaked | Ch12 | `Cloak.tick()`, `DetectCloaked` spatial query, `Cloak.isVisible()` |
| FrozenUnderFog | Ch12 | `FrozenUnderFog.tickRender()`, transition detection |
| HiddenUnderFog/Shroud | Ch12 | Trait classes with `isVisible()` checks |
| WorldRenderer | Ch2 | Scene graph, mesh management, `renderingGroupId` layers |
| RenderSprites | Ch7 | `IRenderable` interface, `IModifyableRenderable` |
| AnimationStub | Ch24 | Material-based sprite animation (Flash effects use this) |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (7 operations across 3 Phases)

| # | OpenRA Source | Target File(s) | Operation | Est. LOC | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: ShroudRenderer 3D Verification & Fix** | | | | | |
| 1 | `ShroudRenderer.cs:70-130` (WorldLoaded) | `ShroudRenderer.ts` | Verify/fix runtime rendering pipeline | ~60 | LOW | A |
| 2 | `ShroudRenderer.cs:150-230` (resolution) | `ShroudRenderer.ts` | Fix visibility resolution for non-square maps | ~40 | LOW | A |
| **Phase B: FrozenActor 3D Flash & Tint** | | | | | |
| 3 | `FrozenActorLayer.cs:290-320` (Flash) | `FrozenActorLayer.ts` | 3D tint rendering via material color modulation | ~100 | MEDIUM | B |
| 4 | `FrozenUnderFog.cs:170-220` (capture) | `FrozenUnderFog.ts` | Renderable snapshot capture at fog transition | ~120 | MEDIUM | B |
| **Phase C: Fog Visibility Trait Integration** | | | | | |
| 5 | `HiddenUnderFog.cs`, `HiddenUnderShroud.cs` | Both trait files | Mesh visibility toggle on fog state change | ~60 | LOW | C |
| 6 | `DetectCloaked.cs` (visual indicator) | `Cloak.ts` | Emissive pulse on detection | ~50 | LOW | C |
| 7 | -- | `ShroudRenderer.test.ts`, `FrozenActorLayer.test.ts` | 3D rendering and flash tint tests | ~350 | MEDIUM | C |

> **Complexity Legend**:
> - **LOW**: Simple wire-up, data fix, or toggle. 40-60 lines.
> - **MEDIUM**: Material color modulation, renderable capture, test fixtures. 100-350 lines.
> - **HIGH**: Not used in Ch25.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total operations** | 7 |
| **Phase A (ShroudRenderer)** | 2 operations |
| **Phase B (FrozenActor 3D)** | 2 operations |
| **Phase C (Visibility Traits + Tests)** | 3 operations |
| **Files to modify** | 5 (`ShroudRenderer.ts`, `FrozenActorLayer.ts`, `FrozenUnderFog.ts`, `Cloak.ts`, `HiddenUnderFog.ts`/`HiddenUnderShroud.ts`) |
| **Test files to expand** | 2 |
| **Estimated total new/modified lines** | ~780 (430 impl + 350 test) |

| Phase | Operations | Impl Lines | Test Lines | Status |
|:---|:---:|:---:|:---:|:---|
| A: ShroudRenderer | 2 | ~100 | -- | COMPLETE |
| B: FrozenActor 3D | 2 | ~220 | -- | PLANNING |
| C: Visibility + Tests | 3 | ~110 | ~350 | PLANNING |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: ShroudRenderer 3D Rendering Verification & Fix

**Status**: COMPLETE

**Description**: The ShroudRenderer has all the GPU infrastructure code (`RawTexture`, `ShaderMaterial`, ground-plane `Mesh`) but needs verification that it actually renders at runtime. The most likely issue is that the Shroud data source is not connected during the first frame, or the ground-plane mesh dimensions don't match the actual terrain extent.

**Paradigm Shifts**:
- C# `ShroudRenderer.WorldLoaded()` 2D sprite layer creation -> TypeScript already-implemented 3D resource creation; the fix is in the integration point, not the renderer itself

#### 3.1.1 Verify ShroudRenderer Runtime Rendering

- [x] **TODO-25.A.1** `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` (est. 60 lines) -- Verify and fix the 3D rendering pipeline at runtime:
  - **Integration check**: The `GameWorldManager.loadComplete()` calls `worldLoaded()` on all registered traits. Verify that `ShroudRenderer` is registered as a WorldActor trait (via `ModData.loadRuleSet()` -> trait instantiation).
  - **If not registered**: Add `ShroudRenderer` trait creation to the WorldActor initialization path in `GameWorldManager`. The shroud renderer needs a `ShroudRendererInfo` instance from the ruleset. If no YAML config exists, create a default `new ShroudRendererInfo()`.
  - **Shroud data connection**: Ensure the `_worldOnRenderPlayerChanged()` callback actually receives a player with a valid `shroud` property. If the player has no Shroud trait (e.g., initial spectator state), the renderer correctly defaults to all-visible. Verify this default is set before the first frame renders.
  - **First-frame visibility**: The `renderShroud()` method is called each frame. On the first frame, all cells are dirty (initialized with `_cellsDirty.fill(1)`), which triggers a full texture upload. Verify the initial visibility data is correct (all zeros = hidden, which renders as opaque black overlay).
  - **Debug helper**: Add a `logDiagnostics()` method that prints the current visibility state, dirty cell count, and mesh/material validity. This aids debugging if the shroud still doesn't render.
  - **OpenRA reference**: `ShroudRenderer.WorldLoaded()` -- registers the shroud sprite layer in the WorldRenderer

#### 3.1.2 Fix Visibility Resolution for Non-Square Maps

- [x] **TODO-25.A.2** `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` (est. 40 lines) -- Ensure visibility texture maps correctly to map dimensions:
  - **Current behavior**: The `RawTexture` is created with `(mapWidth, mapHeight)` and the ground-plane Mesh is sized `(mapWidth, mapHeight)`. The mesh position is `(mapWidth/2, 0.01, mapHeight/2)`.
  - **Verify**: The ground-plane mesh's world-space position aligns with the terrain mesh's world-space position. The terrain mesh generated by `TerrainMeshBuilder` may have a different coordinate origin.
  - **Fix if misaligned**: Adjust the ground-plane mesh's `position` to match the terrain mesh's origin. Use the `CoordinateTransformer` or the `TerrainData.bounds` to determine the correct offset.
  - **Texel alignment**: The visibility texture is `TEXTURE_NEAREST_SAMPLINGMODE`. For a map of 128x128 cells, the texture is 128x128 texels. Each texel maps to one cell. Verify the UV coordinates in the ground-plane mesh correctly map to texel centers (not edges) to avoid sampling artifacts at cell boundaries.
  - **OpenRA reference**: `ShroudRenderer.cs` uses `TerrainSpriteLayer` which maps cell positions to sprite positions via `CellRegion` iteration. Our 3D approach uses a single ground-plane with UV mapping.

**Phase A Summary**: 2 operations, ~356 lines TS (+136 impl, +218 test, +10 World.ts, +9 World.test.ts, -17 removed). After Phase A, ShroudRenderer is registered as a WorldActor trait with Full TraitDictionary integration. The `ITickRender.tickRender()` path ensures per-frame visibility texture updates before Babylon.js renders. `logDiagnostics()` debug helper added. Non-square map support verified and documented. UV axis coordinate-system documented. Acceptance test page at `/test/ch25-shroud/shroud-overlay/`. Review: APPROVED (0 BLOCKERs, 2 MAJOR pre-existing, 4 MINOR resolved). Commits: `fc125a9` (impl), follow-up (review fixes + e2e).

---

### 3.2 Phase B: FrozenActor 3D Flash & Tint Rendering

**Status**: PLANNING
**Complexity**: MEDIUM
**Blocked by**: Phase A (ShroudRenderer must be rendering for fog state to be observable)
**Blocks**: Under-attack visual feedback for fogged units

**Description**: The FrozenActor's `Flash()` method sets tint color and alpha values but doesn't propagate them to 3D mesh materials. Phase B implements the 3D tinting path (material color modulation) and completes the renderable snapshot capture pipeline for `FrozenUnderFog`.

**Paradigm Shifts**:
- C# `IModifyableRenderable.WithTint(Color, float)` returns a new renderable with tint applied -> TypeScript mutate the frozen actor's mesh `material.emissiveColor` and `material.alpha` directly
- C# `FrozenUnderFog.tickRender` captures `IRenderable[]` -> TypeScript captures mesh references + material snapshots

#### 3.2.1 3D Tint Rendering via Material Color Modulation

- [ ] **TODO-25.B.1** `src/OpenRA.Mods.Common/Traits/Player/FrozenActorLayer.ts` (est. 100 lines) -- Implement 3D Flash() tinting for frozen actor meshes:
  - **Current state**: `Flash()` sets `_flashTint`/`_flashAlpha`/`_flashMods` on the FrozenActor, and `_flashTicks` counts down each frame. The 3D rendering path is `TODO-12.DEFERRED.13`.
  - **Implementation**: Add a private `_applyFlashTint()` method called from `tick()` when `_flashTicks > 0`:
    1. Retrieve the FrozenActor's current mesh(es) from the renderable snapshot
    2. For each mesh, access `mesh.material` (cast to `StandardMaterial` or `ShaderMaterial`)
    3. Set `material.alpha` to `_flashAlpha` (fall back to 1.0 if null)
    4. Set `material.emissiveColor` to `new Color3(_flashTint.r/255, _flashTint.g/255, _flashTint.b/255)`
    5. On flash expiry (`_flashTicks` reaches 0), revert `material.alpha` to the original value and `material.emissiveColor` to `Color3.Black()` (no emission)
  - **Performance**: Flash state is checked once per tick. Material property assignment is a single CPU operation. No per-frame allocation.
  - **`IModifyableRenderable` alternative**: If the renderable snapshot includes `IModifyableRenderable` wrappers, implement `WithTint` and `WithAlpha` on a `ModifyableRenderable` class that wraps a mesh + material + tint state. This is the more architecturally pure approach but requires creating a new wrapper class.
  - **Chosen approach**: Direct material mutation (simpler, fewer allocations). The `IModifyableRenderable` approach can be deferred as future refactoring.
  - OpenRA reference: `FrozenActor.Flash(Color, float)` in `FrozenActorLayer.cs`, `IModifyableRenderable.WithTint/WithAlpha`

#### 3.2.2 Renderable Snapshot Capture on Fog Transition

- [ ] **TODO-25.B.2** `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts` (est. 120 lines) -- Capture actor renderables when transitioning to fogged state:
  - **Current behavior**: `FrozenUnderFog.tickRender()` detects when an actor transitions from visible to fogged (`!_isVisible && _wasVisible`), but the renderable capture logic is incomplete.
  - **Implementation**:
    1. **Capture moment**: When `_wasVisible` is true and `_isVisible` becomes false:
       a. Query the actor's `IRender` traits via `traitDict.traitsImplementing<IRender>('IRender')`
       b. Collect all `IRenderable[]` from their `render()` methods
       c. Apply the player's color palette to the captured renderables (for correct owner coloring)
       d. Store the snapshot in the `FrozenActor` (created by `FrozenActorLayer`)
    2. **Remove from ScreenMap**: Call `ScreenMap.remove(viewer, actor)` to remove the live actor from visible rendering
    3. **Add to FrozenActorLayer**: Register the frozen actor in the per-player `FrozenActorLayer` with the captured renderables
    4. **On re-visibility** (`_isVisible && !_wasVisible`): Remove the frozen actor from `FrozenActorLayer`, re-add the live actor to `ScreenMap`
  - **Snapshot format**: The snapshot is an array of `{ mesh: Mesh, material: Material, position: Vector3 }` objects. These are stored in the FrozenActor and rendered each frame at the last known position (no animation update).
  - **Frame reference**: Each `render()` call returns current renderables. The capture must happen in the same frame as the visibility transition (in `tickRender()`).
  - OpenRA reference: `FrozenUnderFog.TickRender(WorldRenderer)` -- captures `ActorBounds` and `IRenderable[]`

**Phase B Summary**: 2 operations, ~220 lines TS. After Phase B, frozen actors under fog flash with color tints when damaged, and their visual snapshots are correctly captured when they transition out of visibility.

---

### 3.3 Phase C: Fog Visibility Trait Integration

**Status**: PLANNING
**Complexity**: LOW-MEDIUM
**Blocked by**: Phase A (shroud rendering must work), Phase B (frozen actor system must work)
**Blocks**: Nothing (endpoint phase for shroud/fog system)

**Description**: Completes the fog visibility trait integration and adds the DetectCloaked visual indicator. Also expands the test suite for the 3D shroud and frozen actor rendering.

#### 3.3.1 Mesh Visibility Toggle on Fog State Change

- [ ] **TODO-25.C.1** `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.ts` and `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.ts` (est. 60 lines) -- Wire mesh visibility to fog/shroud state:
  - **HiddenUnderFog**: In `tickRender()`, when the actor is under fog (not visible to the render player), call `actor.setRenderEnabled(false)` or iterate the actor's meshes and set `mesh.setEnabled(false)`. When the actor becomes visible again, re-enable.
  - **HiddenUnderShroud**: Same pattern, but checks shroud visibility (not yet explored) vs fog (explored but not visible).
  - **Performance**: `mesh.setEnabled(false)` is a single boolean flag on the mesh. Babylon.js skips disabled meshes during scene rendering (no draw call). This is more efficient than removing/re-adding meshes.
  - **Edge case**: If the actor has multiple meshes (e.g., turret + body), toggle all of them.
  - OpenRA reference: `HiddenUnderFog.TickRender()` -- sets `renderable.IsVisible = false`

#### 3.3.2 DetectCloaked Emissive Pulse

- [ ] **TODO-25.C.2** `src/OpenRA.Mods.Common/Traits/Cloak.ts` (est. 50 lines) -- Add visual indicator when cloaked unit is detected:
  - **Trigger**: When `Cloak.isVisible(observer)` returns true due to a `DetectCloaked` trait in range (not due to the cloaked unit firing or taking damage), apply a brief visual pulse.
  - **Pulse effect**: Set `material.emissiveColor` to `new Color3(0.8, 0.8, 0.8)` (white pulse) for 3-5 ticks, then revert to black (no emission). The pulse makes the detected cloaked unit briefly "shimmer" into visibility.
  - **Uncloak transition**: The existing uncloak sound + SpriteEffect (P1-C.4 from post-migration plan) handles visual feedback when the unit fully uncloaks. This is separate from the detection pulse.
  - **Configurable**: The pulse duration and color are hardcoded defaults. Future enhancement: read from `WithDecoration` or a similar trait info class.
  - **OpenRA reference**: `Cloak.cs` -- `DetectCloaked` integration, cloak/uncloak transition effects

#### 3.3.3 Expand Test Suite for 3D Shroud and Frozen Actor Rendering

- [ ] **TODO-25.C.3** `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.test.ts` and `src/OpenRA.Game/Traits/Player/FrozenActorLayer.test.ts` (est. 350 lines) -- Comprehensive 3D rendering tests:
  - **ShroudRenderer tests**:
    - Ground-plane mesh is created in `_createShroudResources`
    - Visibility texture is uploaded with correct data after `renderShroud()`
    - Initial state: all cells dirty, full texture upload on first frame
    - Single cell change: only that cell's texel is updated in `_visibilityData`
    - Neighbor dirty marking: changing one cell marks 8 neighbors as dirty
    - Disposal cleans up mesh, material, and texture
  - **FrozenActorLayer tests**:
    - `Flash()` sets tint color and alpha on the frozen actor's mesh material
    - Flash expiry reverts material to original state
    - Flash tick countdown correctly decrements each tick
    - Mesh visibility toggle: `HiddenUnderFog` disables mesh, re-enabling works
  - **Integration tests**:
    - Full cycle: actor becomes fogged -> snapshot captured -> frozen actor rendered -> Flash() tints mesh -> flash expires -> tint reverted

**Phase C Summary**: 3 operations, ~110 impl lines + ~350 test lines. After Phase C, the shroud/fog system is fully complete with 3D rendering, frozen actor tinting, fog-based visibility, and detection visual feedback.

---

## 4. Dependency Graph

```
Chapters 2-22 (ALL COMPLETE)
  |
  v
Phase A (ShroudRenderer verification: 2 ops)
  |
  +-- 25.A.1 (Runtime rendering verification) -- independent, ~60 lines
  +-- 25.A.2 (Non-square map fix) -- independent, ~40 lines
  |
  v
Phase B (FrozenActor 3D: 2 ops)
  |
  +-- 25.B.1 (3D Flash tinting) -- depends on A.1 (shroud state affects fog transitions)
  +-- 25.B.2 (Renderable snapshot capture) -- depends on A.1 (needs working fog/shroud state)
  |
  v
Phase C (Visibility traits + tests: 3 ops)
  |
  +-- 25.C.1 (HiddenUnderFog/Shroud toggle) -- depends on A.1
  +-- 25.C.2 (DetectCloaked pulse) -- independent (works with existing Cloak trait)
  +-- 25.C.3 (Test suite) -- depends on B.1, B.2 code-complete
```

### Critical Path

```
25.A.1 (rendering verification) -> 25.B.1 (Flash tint) -> 25.B.2 (snapshot capture) -> 25.C.3 (tests) -> DONE
```

### Parallelization Opportunities

- 25.A.1 and 25.A.2 can be verified in parallel
- 25.C.2 (DetectCloaked pulse) is independent of Phase B and can run in parallel
- 25.C.3 (tests) can begin writing test stubs as soon as Phase B APIs are defined

### Key Blocking Relationships

| Dependency | Constraint |
|:---|:---|
| 25.A.1 (ShroudRenderer validation) | Must work before fog-based feature testing is meaningful |
| 25.B.1 (Flash tint) | Depends on FrozenActor having mesh references (requires 25.B.2 capture for realism) |
| 25.B.2 (Snapshot capture) | Depends on Shroud state being correct (requires 25.A.1) |
| Chapter 24 (AnimationStub) | FrozenActor Flash may use AnimationStub for tint animation (optional dependency) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

- [x] **TEST-25.1** ShroudRenderer: ground-plane mesh exists in scene after `worldLoaded()`
- [x] **TEST-25.2** ShroudRenderer: visibility texture receives correct data for all-hidden initial state
- [x] **TEST-25.3** ShroudRenderer: dirty cell tracking marks only changed cells
- [ ] **TEST-25.4** FrozenActor.Flash(): material.emissiveColor is set to flash tint color
- [ ] **TEST-25.5** FrozenActor.Flash(): material.alpha is set to flash alpha
- [ ] **TEST-25.6** FrozenActor.Flash(): on expiry, material reverts to original state
- [ ] **TEST-25.7** FrozenUnderFog: renderable snapshot captured when actor enters fog
- [ ] **TEST-25.8** FrozenUnderFog: snapshot includes all IRender traits' renderables
- [ ] **TEST-25.9** HiddenUnderFog: mesh.setEnabled(false) when under fog
- [ ] **TEST-25.10** DetectCloaked: emissive pulse applied when cloaked unit is detected

### 5.2 Visual Acceptance Testing

| System | Test Page Path | Purpose |
|--------|-----------|---------|
| Shroud overlay 3D | `/test/ch25-shroud/shroud-overlay/` | Verify shroud renders as dark overlay with smooth edge blending at fog boundaries | **CREATED** (Ch25 Phase A) |
| Frozen actor flash | `/test/ch25-shroud/frozen-actor-flash/` | Verify frozen actor meshes flash with color tint on damage |
| Actor visibility toggle | `/test/ch25-shroud/actor-visibility/` | Verify actors appear/disappear as they enter/leave fog |

### 5.3 Test File Estimates

| Phase | Test Files | Estimated New Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|
| A: ShroudRenderer tests | 1 | ~8 | ~120 |
| B: FrozenActor tests | 1 | ~8 | ~120 |
| C: Visibility + integration | 2 | ~8 | ~110 |
| **Total** | **2** | **~24** | **~350** |

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **ShroudRenderer not instantiated** (trait registration missing in WorldActor setup) | HIGH | Entire shroud overlay invisible; fog has no visual effect | Diagnose first (25.A.1). If missing, add trait registration in `GameWorldManager` initialization. The ShroudRenderer class is complete; it just needs to be wired into the actor lifecycle. |
| **Ground-plane mesh z-fighting with terrain** (both at Y ~0) | MEDIUM | Flickering between shroud and terrain texture | The ground-plane is already at `Y = 0.01` which should be above terrain at `Y = 0`. If z-fighting occurs, increase to `Y = 0.05` or enable `polygonOffset` on the shroud material. |
| **FrozenActor renderable snapshot memory** (retaining mesh references after actor destroyed) | MEDIUM | Memory leak: frozen actors hold references to destroyed meshes | The snapshot should store copies of renderable descriptors, not live mesh references. When the live actor is destroyed, its meshes are disposed. The frozen snapshot must not reference disposed GPU resources. Use `clone()` or serialize renderable state. |
| **Flash tint conflict with palette remapping** (both modify material color) | LOW | Incorrect color on frozen actors when both flash and player-color palette are active | Flash tint is applied as emissive color (additive). Palette remap is applied via the material's diffuse texture or a separate uniform. These are independent color channels and should not conflict. |
| **DetectCloaked pulse causing unnecessary draw call** (even when no enemy has detectors) | LOW | Minor performance cost checking material each tick | The pulse check is a single boolean per cloaked unit per tick. Only triggers material assignment when detection state changes. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-25.1: Direct Material Mutation over Renderable Wrapper

- **Decision**: FrozenActor `Flash()` directly mutates `mesh.material.emissiveColor` and `material.alpha` rather than creating `IModifyableRenderable` wrapper objects.
- **Rationale**: The wrapper approach creates one allocation per flash event and requires the render pipeline to unwrap renderables each frame. Direct material mutation is a single property assignment with zero allocation. The frozen actor mesh is not shared, so there are no side effects on other renderers.
- **Mitigation**: If frozen actor meshes become shared (e.g., instanced rendering), the `IModifyableRenderable` approach would be preferred. For the current singleton-mesh-per-frozen-actor design, direct mutation is safe.

### ADR-25.2: Ground-Plane Mesh over RenderTargetTexture for Shroud

- **Decision**: Continue using the existing ground-plane `Mesh` approach for shroud rendering (already implemented in `ShroudRenderer._createShroudResources()`).
- **Rationale**: The ground-plane approach was selected during Ch12 migration (ADR-12.1). It renders in a single pass via alpha blending, uses `renderingGroupId=2` for correct depth ordering, and requires no additional render target or compositing pass. Changing to RTT at this stage would be a large refactor with no benefit.
- **Mitigation**: If performance becomes an issue with very large maps, the RTT approach could be reconsidered (RTT renders shroud once, regardless of map size). For current map sizes (max 256x256), the ground-plane approach is performant.

### ADR-25.3: FrozenActor Snapshot as Value Objects

- **Decision**: Frozen actor renderable snapshots store copies of renderable descriptors (position, UV rect, palette index, sheet reference), not live mesh references.
- **Rationale**: Live mesh references become invalid when the original actor is destroyed (meshes are disposed). Value-object snapshots survive actor destruction and can be re-rendered in subsequent frames from the stored data. The frozen actor's own mesh is created lazily from the snapshot data.
- **Mitigation**: This increases snapshot memory slightly (storing descriptors instead of pointers) but prevents use-after-dispose bugs. The descriptor format matches the existing `IRenderable` interface.

### ADR-25.4: ShroudRenderer Trait Registration

- **Decision**: If `ShroudRenderer` is not automatically registered as a WorldActor trait, add explicit registration in `GameWorldManager` initialization.
- **Rationale**: The ShroudRenderer is not a mod-specific trait; it's a core rendering system that should always be present when a Shroud exists. Explicit registration ensures it's never accidentally omitted.
- **Mitigation**: The registration is conditional: if the ruleset does not define a `ShroudRenderer` trait, create one with default `ShroudRendererInfo`. This ensures backward compatibility with mods that may not define shroud rendering.

---

> **Plan Status**: This plan defines the 3-phase approach to completing the Shroud & Fog of War 3D system. The ShroudRenderer code is already ~1000 lines of working GPU infrastructure. The main work is integration verification (Phase A), 3D tinting for frozen actors (Phase B), and visibility trait wire-up (Phase C). The entire shroud/fog system is expected to be 80-90% done on day one of this chapter.

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All implementation work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `CLAUDE.md` -- Project conventions and overall status
> - `docs/post_migration_completion_plan.md` -- Post-migration plan (Phase C: Shroud/Fog reference)
> - `docs/chapter12_shroud_fog_of_war_migration_plan.md` -- Chapter 12 original migration plan
> - `docs/chapter24_animation_effects_plan.md` -- Chapter 24 (AnimationStub for Flash effect integration)
> - `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` -- Current 3D ShroudRenderer (~1000 lines)
> - `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` -- Current FrozenActorLayer (~800 lines)
> - `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts` -- FrozenUnderFog trait
> - `src/OpenRA.Mods.Common/Traits/Cloak.ts` -- Cloak + DetectCloaked
> - `OpenRA/OpenRA.Mods.Common/Traits/World/ShroudRenderer.cs` -- Original C# ShroudRenderer (390 lines)
