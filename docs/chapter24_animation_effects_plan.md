# OpenRA to Babylon.js Migration Plan: Chapter 24 -- Animation & 3D Visual Effects

> **Source Reference**: OpenRA C# rendering effects + C&C projectile/effect animations
> **Chapter Status**: IN PROGRESS (6/10 migrated — Phases A+B COMPLETE)
> **Planning Date**: 2026-06-20
> **Prerequisite**: Chapters 2-22 COMPLETE, Chapter 23 (MIX assets accessible)

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: AnimationStub Material Integration](#31-phase-a-animationstub-material-integration)
   - 3.2 [Phase B: TeslaZap 3D Lightning Polish](#32-phase-b-teslazap-3d-lightning-polish)
   - 3.3 [Phase C: ChronoVortex 3D Vortex Polish](#33-phase-c-chronovortex-3d-vortex-polish)
   - 3.4 [Phase D: GpsDotEffect & Remaining Effects](#34-phase-d-gpsdoteffect--remaining-effects)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Problem Statement

C&C visual effects (IonCannon beam, DropPodImpact entry, SatelliteLaunch, ConyardChronoVortex, GpsDot) all use the shared `AnimationStub` class. Despite being migrated from a pure stub to a class that creates Babylon.js mesh planes and updates UVs, these effects remain **invisible** because:

1. **No material assigned**: `MeshBuilder.CreatePlane()` is called without assigning a `Material`. Babylon.js planes without a material render as invisible (no color, no texture, nothing to draw).
2. **No texture binding**: The evenly-spaced horizontal strip UV assumption has no backing texture. Actual sprites come from the Ch2 `Sheet` (texture atlas) infrastructure, which provides the correct UV sub-regions for each frame.
3. **No integration with Renderer**: The meshes are created but never registered with the `WorldRenderer`'s render list. They float in the scene without being part of the render loop.

The TeslaZap and ChronoVortex have their own renderers (`TeslaZapRenderable`, `ChronoVortexRenderable`) with substantial Babylon.js code, but they may also have material/texture gaps preventing them from being visible.

### 1.2 Core Paradigm Shift

- **C# `Animation` 2D sprite rendering with `Sheet` texture atlas** -> TypeScript `AnimationStub` that creates Babylon.js planes with proper `ShaderMaterial` referencing the sprite sheet `RawTexture`, using per-frame UV sub-regions resolved from `Sheet`/`Sprite` data
- **C# TeslaZap 2D line segments per `ISpriteSequence` frame** -> TypeScript `LinesMesh` with `ShaderMaterial` (emissive-only), dynamic vertex update each tick, and random jitter for lightning branching
- **C# ChronoVortex 2D sprite sequence + `.lut` lookup tables** -> TypeScript `Billboard` with `ChronoVortexShaderMaterial` (spiral UV animation via fragment shader `atan2` + radius distortion)
- **C# GpsDot 2D minimap dot sprite** -> TypeScript `Billboard` dot sprite on a minimap render layer
- **C# `IRenderable` yield-return pattern** -> TypeScript array accumulation with `render()` returning `IRenderable[]`

### 1.3 Architecture Principles

1. **Material-first approach**: The primary fix for `AnimationStub` is giving its planes actual Babylon.js `Materials`. Without materials, the meshes are in the scene but render nothing.

2. **Sheet/Sprite integration**: The Ch2 `Sheet` (texture atlas on GPU) and `Sprite` (UV sub-region within a sheet) are the source of truth for frame UV coordinates. `AnimationStub` must resolve frames to UVs via the Sheet/Sprite infrastructure, not the evenly-spaced assumption.

3. **ShaderMaterial for custom effects**: TeslaZap and ChronoVortex use custom `ShaderMaterial` (not `StandardMaterial`) because they need per-frame dynamic uniforms (time, jitter, intensity). The general AnimationStub uses `ShaderMaterial` with a sprite sheet texture and a frame-select uniform.

4. **Render pipeline integration**: All created meshes must be attached to the scene with correct `renderingGroupId` values so they render in the proper order: terrain (0) -> actors (1) -> effects/projectiles (2) -> shroud (3) -> UI (4).

5. **Instance pooling for hot paths**: AnimationStub creates meshes lazily on first `render()`/`renderUI()`. Once created, meshes are reused across frames. Only UV data is updated per frame. No mesh allocation during gameplay.

6. **Backward compatibility**: The AnimationStub public API (`playThen`, `playRepeating`, `tick`, `render`, `renderUI`, accessors) remains identical. Only the internal implementation changes.

### 1.4 Completed Foundation

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, `renderingGroupId` layers |
| Sprite/Sheet/Animation | Ch2 | `Sheet`, `Sprite`, `SheetBuilder`, `HardwarePalette`, `Sequence` |
| Shader/Material System | Ch2 | `ShaderMaterial`, `RawTexture`, `StandardMaterial`, custom shaders |
| VertexBuffer | Ch2 | `VertexBuffer`, `StaticIndexBuffer`, `updateVerticesData()` |
| AnimationStub | Ch19 Phase B | Existing class with Babylon.js mesh creation (no material) |
| TeslaZapRenderable | Ch19 Phase B | LinesMesh interface, `STEPS` table, `SeededRandom`, segment generation |
| ChronoVortexRenderable | Ch19 Phase B | `ChronoVortexShaderMaterial` with spiral fragment shader, Billboard |
| GpsDotEffect | Ch19 Phase B | Basic stub returning empty renderables |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()` for world-space positioning |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (10 operations across 4 Phases)

| # | OpenRA Source | Target File(s) | Operation | Est. LOC | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: AnimationStub Material Integration** | | | | | |
| 1 | `OpenRA.Graphics/Animation.cs` (sprite rendering) | `AnimationStub.ts` | Assign `ShaderMaterial` with sheet texture | ~80 | MEDIUM | A |
| 2 | `OpenRA.Graphics/Sprite.cs` (UV sub-region) | `AnimationStub.ts` | Integrate `Sheet`/`Sprite` UV resolution | ~100 | MEDIUM | A |
| 3 | `OpenRA.Graphics/Animation.cs` (Render) | `AnimationStub.ts` | Register meshes in `WorldRenderer` render list | ~60 | MEDIUM | A |
| 4 | -- | `AnimationStub.ts` | Wire `tick()` to WorldRenderer frame loop | ~40 | LOW | A |
| **Phase B: TeslaZap 3D Lightning Polish** | | | | | |
| 5 | `TeslaZapRenderable.cs:90-167` (render) | `TeslaZapRenderable.ts` | Complete `LinesMesh` material + vertex update | ~120 | MEDIUM | B |
| 6 | `TeslaZap.cs:55-85` (Tick) | `TeslaZap.ts` | Wire renderables into WorldRenderer pipeline | ~50 | LOW | B |
| **Phase C: ChronoVortex 3D Vortex Polish** | | | | | |
| 7 | `ChronoVortexRenderable.cs:40-67` (render) | `ChronoVortexRenderable.ts` | Complete Billboard ShaderMaterial pipeline | ~100 | MEDIUM | C |
| **Phase D: GpsDotEffect & Remaining Effects** | | | | | |
| 8 | `GpsDot.cs:80-138` (render dot) | `GpsDotEffect.ts` | Billboard dot sprite rendering | ~80 | LOW | D |
| 9 | -- | `AnimationStub.test.ts` | Material/texture integration tests | ~300 | MEDIUM | D |
| 10 | -- | `TeslaZapRenderable.test.ts` | LinesMesh rendering tests | ~200 | MEDIUM | D |

> **Complexity Legend**:
> - **LOW**: Simple wire-up, texture assignment, or callback registration. 40-80 lines.
> - **MEDIUM**: Moderate ShaderMaterial setup, UV resolution integration, test fixtures. 60-300 lines.
> - **HIGH**: Not used in Ch24.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total operations** | 10 |
| **Phase A (AnimationStub)** | 4 operations |
| **Phase B (TeslaZap)** | 2 operations |
| **Phase C (ChronoVortex)** | 1 operation |
| **Phase D (GpsDot + Tests)** | 3 operations |
| **Files to modify** | 5 (`AnimationStub.ts`, `TeslaZapRenderable.ts`, `TeslaZap.ts`, `ChronoVortexRenderable.ts`, `GpsDotEffect.ts`) |
| **Test files to expand** | 2 (`AnimationStub.test.ts`, `TeslaZapRenderable.test.ts`) |
| **Estimated total new/modified lines** | ~1,130 (630 impl + 500 test) |

| Phase | Operations | Impl Lines | Test Lines | Status |
|:---|:---:|:---:|:---:|:---|
| A: AnimationStub | 4 | ~280 | -- | COMPLETE |
| B: TeslaZap | 2 | ~170 | -- | COMPLETE |
| C: ChronoVortex | 1 | ~100 | -- | PLANNING |
| D: GpsDot + Tests | 3 | ~80 | ~500 | PLANNING |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: AnimationStub Material Integration

**Status**: COMPLETE
**Complexity**: MEDIUM
**Blocked by**: Chapter 23 (sprites/sheets must be accessible from MIX files for texture data)
**Blocks**: IonCannon visual, DropPodImpact visual, SatelliteLaunch visual, ConyardChronoVortex visual, all AnimationStub consumers

**Description**: The keystone fix. `AnimationStub` creates mesh planes but without materials, making all C&C effects invisible. Phase A assigns a proper `ShaderMaterial` with a sprite sheet texture, integrates with the Ch2 `Sheet`/`Sprite` infrastructure for correct UV coordinates, and registers the meshes in the `WorldRenderer`'s render pipeline.

**Paradigm Shifts**:
- C# `Animation.Render(WPos, PaletteReference)` CPU-side sprite selection -> TypeScript GPU-side material with dynamic UV uniform
- C# `Sheet.GetSprite(frameIndex)` -> TypeScript UV sub-region from `Sprite.bounds` mapped to texture coordinates
- C# `WorldRenderer.AddRenderable(IRenderable)` -> TypeScript mesh with `renderingGroupId=2` on the scene

#### 3.1.1 Assign ShaderMaterial with Sheet Texture

- [ ] **TODO-24.A.1** `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` (est. 80 lines) -- Replace the material-less mesh with a proper `ShaderMaterial`:
  - **Constructor changes**: Accept an optional `Sheet` reference (from Ch2 `Sheet.ts`) that provides the GPU `RawTexture` and frame metadata.
  - **ShaderMaterial creation** (lazy, on first render):
    - Create `ShaderMaterial` with vertex shader (pass-through position + UV) and fragment shader (sample texture, apply palette remap if palette provided).
    - Fragment shader uniforms: `uTexture` (the sprite sheet), `uFrameUV` (vec4: uMin, vMin, uMax, vMax for current frame), `uPaletteRemap` (sampler2D or vec4 for color tint).
    - Set `material.alphaMode = Constants.ALPHA_PREMULTIPLIED` for correct premultiplied alpha blending.
    - Set `material.backFaceCulling = false` so the plane is visible from both sides (sprite billboarding).
  - **Without Sheet reference**: Fall back to a `StandardMaterial` with `emissiveColor` set to a debug magenta (so untextured animations are visibly distinguishable rather than invisible).
  - The `_mesh.material = this._shaderMaterial` assignment is the critical line. Currently `_mesh` has no material at all.
  - Unit test: verify `_mesh.material` is non-null after first `render()` call.

#### 3.1.2 Integrate Sheet/Sprite UV Resolution

- [ ] **TODO-24.A.2** `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` (est. 100 lines) -- Replace evenly-spaced UV assumption with actual sprite sheet coordinates:
  - **New dependency**: `AnimationStub` takes an optional `Sheet` parameter. The `Sheet` class (Ch2) holds the `RawTexture` and provides frame-to-UV mapping.
  - **Frame resolution**: When a sequence is played, resolve the sequence name to frame indices via the existing `Sequence` infrastructure. For a simpler approach, accept a `frameUVs: Float32Array[]` array (one 4-element UV rect per frame) directly in the constructor.
  - **`_updateUVs` rewrite**: Instead of computing `u0 = i / frameCount` (horizontal strip), look up the actual UV rect for frame `i`:
    ```
    // frameUVs[i] = [uMin, vMin, uMax, vMax] in 0..1 texture space
    const rect = this._frameUVs[this._frame]
    uvs[0] = rect[0]; uvs[1] = rect[1]  // bottom-left
    uvs[2] = rect[2]; uvs[3] = rect[1]  // bottom-right
    uvs[4] = rect[2]; uvs[5] = rect[3]  // top-right
    uvs[6] = rect[0]; uvs[7] = rect[3]  // top-left
    ```
  - **Fallback**: If no frame UVs are provided, keep the evenly-spaced horizontal strip assumption (the current behavior) but log a console.warn about using a debug layout.
  - **Sheet integration API**: Add `setSheet(sheet: Sheet, frameUVs: Float32Array[])` method. This allows the animation to be created before the sheet is loaded, then configured when assets arrive.
  - Unit test: with 4 mock UV rects, verify that `_updateUVs()` sets UVs matching the 3rd frame's rect.

#### 3.1.3 Register Meshes in WorldRenderer Render List

- [ ] **TODO-24.A.3** `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` (est. 60 lines) -- Ensure created meshes are visible in the render pipeline:
  - **Scene attachment**: The `_mesh` created by `MeshBuilder.CreatePlane()` must be added to the Babylon.js scene. Currently it's created but may not be parented to any node in the scene graph.
  - **renderingGroupId**: Set `_mesh.renderingGroupId = 2` (effects layer, between actors at 1 and shroud at 3).
  - **WorldRenderer integration**: In the `render(pos, palette)` method, ensure the mesh is added to the scene. If a `WorldRenderer` reference is available (pass it through the constructor or a setter), add the mesh via `worldRenderer.addRenderable(this._mesh)`.
  - **Dispose cleanup**: Ensure `dispose()` removes the mesh from both the material and the scene. Currently it only calls `mesh.dispose()`, which is correct if the mesh was directly parented to the scene.
  - **Visibility management**: When animation is not started (`!_started`), hide the mesh (`mesh.setEnabled(false)`) rather than returning an empty array. This keeps the mesh in the scene graph for fast enable/disable toggling.
  - Unit test: after `render()`, verify mesh is in scene's mesh list and has correct `renderingGroupId`.

#### 3.1.4 Wire tick() to WorldRenderer Frame Loop

- [ ] **TODO-24.A.4** `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` (est. 40 lines) -- Ensure animation frames advance in sync with the game's fixed timestep:
  - The animations must tick at 25 ticks/second (40ms per tick), matching the game logic rate.
  - The `AnimationStub.tick()` method already exists. The gap is that downstream consumers (TeslaZap, IonCannon, etc.) must call `tick()` in their own `Tick()` methods.
  - **Consumer wire-up**: Add a note that each consumer's `ITick.tick()` must call `this._anim.tick()`. This is a consumer-side change, not an AnimationStub change. But the docs must make it clear.
  - **Auto-registration option**: Add an optional `registerWithWorld(world)` method that subscribes `this.tick` to the world's tick callback. This simplifies consumer code but couples AnimationStub to the World interface. Keep it optional.

**Phase A Summary**: 4 operations, ~280 lines TS. After Phase A, all AnimationStub-based effects (IonCannon, DropPodImpact, SatelliteLaunch, ConyardChronoVortex) render as visible, textured meshes in the scene.

---

### 3.2 Phase B: TeslaZap 3D Lightning Polish

**Status**: PLANNING
**Complexity**: MEDIUM
**Blocked by**: Nothing (TeslaZapRenderable has its own rendering infrastructure, independent of AnimationStub)
**Blocks**: TeslaZap visual in C&C mod gameplay

**Description**: `TeslaZapRenderable` generates 3D segment descriptors and has the `LinesMesh` interface defined. However, it may lack a proper `ShaderMaterial` with emissive properties and the vertex update loop that makes the lightning visible each frame. This phase completes the rendering pipeline.

**Paradigm Shifts**:
- C# `TeslaZapRenderable.Render()` generating `SpriteRenderable[]` per segment -> TypeScript `LinesMesh` with per-frame vertex position update
- C# bright/dim sprite rendering -> TypeScript thick/thin lines with emissive color differentiation

#### 3.2.1 Complete LinesMesh Material + Vertex Update

- [ ] **TODO-24.B.1** `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts` (est. 120 lines) -- Complete the 3D lightning rendering pipeline:
  - **ShaderMaterial creation**: Create an emissive-only `ShaderMaterial` for the LinesMesh. The fragment shader outputs a solid color (no lighting, no shadow) with alpha blending for the glow effect.
  - **Two material variants**: Bright zap material (emissive cyan, line width ~3 world units) and dim zap material (emissive dark blue, line width ~1 world unit). The bright/dim distinction comes from the C# `STEPS` table where step[4] selects the sprite index.
  - **LinesMesh creation**: Use `MeshBuilder.CreateLines('teslaZap', { points: vertexArray, updatable: true }, scene)`. The `updatable: true` flag enables `updateVerticesData()`.
  - **Per-frame vertex update**: The `render(wr)` method must:
    1. Generate the lightning path vertices from source to target, applying random jitter via `randomZapOffset()` and the `STEPS` table
    2. Build two vertex arrays: bright path and dim path
    3. Call `linesMesh.updateVerticesData('position', vertexArray)` for each LinesMesh
    4. Set mesh visibility based on the zap state
  - **Dispose on completion**: When the zap effect ends (after N ticks of visual persistence), dispose the LinesMeshes and ShaderMaterials.
  - **Scene attachment**: The LinesMesh must be added to the scene (it already has Babylon.js methods for this; the key is ensuring the renderer passes the correct Scene reference).
  - Unit test: verify LinesMesh is created with correct vertex count, updateVerticesData changes vertex positions, bright/dim materials have different colors

#### 3.2.2 Wire TeslaZap Renderables into WorldRenderer

- [ ] **TODO-24.B.2** `src/OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts` (est. 50 lines) -- Integrate TeslaZap renderables with the WorldRenderer pipeline:
  - The `TeslaZap.render(wr)` method currently returns `IRenderable[]`. Ensure the returned renderables include the LinesMesh descriptor that the WorldRenderer uses to add meshes to the scene.
  - Verify `WorldRenderer.render()` processes these renderables and adds their meshes to the appropriate renderingGroupId layer.
  - If the WorldRenderer's render list integration is not automated, add manual scene attachment in the `render()` method: `wr.scene.addMesh(linesMesh)`.

**Phase B Summary**: 2 operations, ~170 lines TS. After Phase B, TeslaZap lightning arcs render as visible, jittering LinesMesh arcs in the 3D scene.

---

### 3.3 Phase C: ChronoVortex 3D Vortex Polish

**Status**: PLANNING
**Complexity**: MEDIUM
**Blocked by**: Nothing (ChronoVortexRenderable has its own ShaderMaterial, independent of AnimationStub)
**Blocks**: ChronoVortex visual at teleport departure/arrival points

**Description**: `ChronoVortexRenderable` has a comprehensive `ChronoVortexShaderMaterial` with custom fragment shader (spiral UV animation via `atan2` + radius distortion). The Billboard mesh and ShaderMaterial are defined. This phase ensures the vortex Billboard renders in the scene and animates correctly.

**Paradigm Shifts**:
- C# 2D vortex sprite with 48-frame animation + `.lut` lookup -> TypeScript single Billboard with fragment-shader-driven spiral animation

#### 3.3.1 Complete Billboard ShaderMaterial Pipeline

- [ ] **TODO-24.C.1** `src/OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.ts` (est. 100 lines) -- Complete the vortex rendering:
  - **Billboard mesh confirmation**: Verify `MeshBuilder.CreatePlane()` with `billboardMode = Mesh.BILLBOARDMODE_ALL` is created and assigned the `ChronoVortexShaderMaterial`.
  - **Texture assignment**: The vortex material needs a texture (currently uses procedural spiral generation in the fragment shader, which is correct). Verify the shader produces visible output without an external texture.
  - **Per-tick uniform update**: The `render(tickCount, wr)` method updates `u_time` and `u_progress` uniforms on the ShaderMaterial:
    - `u_time`: increases each tick, driving the spiral rotation speed
    - `u_progress`: lerps from 0 to 1 over the vortex lifetime, controlling fade-in/out
  - **World position update**: Set `mesh.position = CoordinateTransformer.wPosToVector3(vortexPos)` each frame. The vortex may need to track a moving actor during Chronoshift.
  - **renderingGroupId**: Set to 2 (effects layer).
  - **Dispose lifecycle**: Remove mesh + material from scene when vortex expires.
  - Unit test: material uniforms update correctly per tick, mesh position matches world position, dispose cleans up

**Phase C Summary**: 1 operation, ~100 lines TS. After Phase C, ChronoVortex renders as a visible, animated spiral Billboard at teleport points.

---

### 3.4 Phase D: GpsDotEffect & Remaining Effects

**Status**: PLANNING
**Complexity**: LOW-MEDIUM
**Blocked by**: Phase A (AnimationStub material for sprite-based dot rendering)
**Blocks**: GPS minimap dots in C&C gameplay

**Description**: `GpsDotEffect` currently returns empty renderables (a stub). Phase D implements a Billboard dot sprite at the actor's world position, visible when GPS power is active. Also expands the test suite for the AnimationStub and TeslaZap changes.

#### 3.4.1 GpsDotEffect Billboard Rendering

- [ ] **TODO-24.D.1** `src/OpenRA.Mods.Cnc/Effects/GpsDotEffect.ts` (est. 80 lines) -- GPS dot sprite rendering:
  - **Billboard creation**: Create a small `MeshBuilder.CreatePlane()` (e.g., 0.3 x 0.3 world units) at the actor's position.
  - **Material**: Assign a `StandardMaterial` with `emissiveColor` set to the player color (from `GpsDotInfo.IndicatorPalettePrefix`)
  - **Billboard mode**: `Mesh.BILLBOARDMODE_ALL` so the dot always faces the camera
  - **renderingGroupId**: Set to 3 (above effects, on the minimap/UI layer)
  - **Visibility toggle**: Only enabled when `GpsDot.traitEnabled` is true (GPS power active)
  - **Lifecycle**: Created in `INotifyAddedToWorld`, disposed in `INotifyRemovedFromWorld`
  - **position update**: If the actor moves, update `mesh.position` each frame (or parent the mesh to the actor's TransformNode)
  - Replace the `return []` stub in the current `render()` method with `return [this._mesh as unknown as IRenderable]`
  - Unit test: mesh created on add, mesh removed on remove, visibility toggles with GPS power

#### 3.4.2 Expand AnimationStub Test Suite

- [ ] **TODO-24.D.2** `src/OpenRA.Mods.Cnc/Effects/AnimationStub.test.ts` (est. 300 lines) -- Comprehensive material and rendering tests:
  - Material assignment: verify `_mesh.material` is non-null after first `render()` call
  - Material disposal: verify material is disposed when `dispose()` is called
  - UV update with mock frame UVs: verify correct UV rect for frame N
  - Fallback UV: verify evenly-spaced strip is used when no frame UVs are provided
  - `renderingGroupId`: verify mesh has correct group after render
  - Complete lifecycle: create -> start -> tick through all frames -> onComplete fires -> dispose
  - Repeating animation: verify frame loops back to 0 after the last frame

#### 3.4.3 Expand TeslaZapRenderable Test Suite

- [ ] **TODO-24.D.3** `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.test.ts` (est. 200 lines) -- LinesMesh rendering tests:
  - LinesMesh creation: verify mesh is created with correct number of vertices
  - Vertex update: verify `updateVerticesData` changes vertex positions
  - Bright/dim material differentiation: verify bright material has higher emissive intensity
  - Random jitter: verify vertex positions differ from straight line (jitter applied)
  - Dispose: verify LinesMesh and ShaderMaterials are disposed

**Phase D Summary**: 3 operations, ~80 impl lines + ~500 test lines. After Phase D, all C&C visual effects have visible 3D rendering and comprehensive test coverage.

---

## 4. Dependency Graph

```
Chapters 2-22 (ALL COMPLETE)
  |
  v
Phase A (AnimationStub Material: 4 operations)
  |
  +-- 24.A.1 (ShaderMaterial assignment) -- KEYSTONE, ~80 lines
  +-- 24.A.2 (Sheet/Sprite UV resolution) -- depends on A.1 having material to assign UVs to
  +-- 24.A.3 (Scene attachment + renderingGroupId) -- depends on A.1 having a mesh
  +-- 24.A.4 (Tick wire-up) -- independent (method already exists, consumer-side change)
  |
  v
Phase B (TeslaZap: 2 ops) -- independent of Phase A (own renderer)
Phase C (ChronoVortex: 1 op) -- independent of Phase A (own renderer)
Phase D (GpsDot: 1 op) -- depends on Phase A (may use AnimationStub for dot sprite)
Phase D (Tests: 2 ops) -- depends on A, B being code-complete
```

### Critical Path

```
24.A.1 (material) -> 24.A.2 (UVs) -> 24.A.3 (scene) -> DONE (AnimationStub)
                     24.B.1 -> 24.B.2 (TeslaZap, parallel track)
                     24.C.1 -> DONE (ChronoVortex, parallel track)
```

### Parallelization Opportunities

- All three renderer phases (A: AnimationStub, B: TeslaZap, C: ChronoVortex) can proceed in parallel since each has its own rendering infrastructure
- 24.D.2 and 24.D.3 (test suites) can start as soon as 24.A.1 and 24.B.1 are code-complete
- 24.D.1 (GpsDot) can start after 24.A.1 is complete

### Key Blocking Relationships

| Dependency | Constraint |
|:---|:---|
| 24.A.1 (ShaderMaterial) | Must be done FIRST -- without a material, all AnimationStub meshes are invisible |
| 24.A.2 (UV resolution) | Required for correct frame display; without it, all frames show the same UV region |
| 24.D.1 (GpsDotEffect) | If using AnimationStub for dot rendering, requires 24.A.1 and 24.A.2 |
| Chapter 23 (MIX runtime) | Required for sprite sheet textures to be accessible from MIX files |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

- [ ] **TEST-24.1** AnimationStub: material assigned on first render, material is non-null after render()
- [ ] **TEST-24.2** AnimationStub: UV update uses correct frame rect from provided frameUVs array
- [ ] **TEST-24.3** AnimationStub: fallback UV uses evenly-spaced strip when no frameUVs provided
- [ ] **TEST-24.4** AnimationStub: dispose cleans up mesh + material
- [ ] **TEST-24.5** AnimationStub: renderingGroupId is set to 2 on the mesh
- [ ] **TEST-24.6** TeslaZap: LinesMesh created with correct vertex count for given segment count
- [ ] **TEST-24.7** TeslaZap: updateVerticesData changes vertex positions (verify before/after values)
- [ ] **TEST-24.8** ChronoVortex: Billboard mesh has BILLBOARDMODE_ALL, renderingGroupId=2
- [ ] **TEST-24.9** ChronoVortex: u_time and u_progress uniforms update per tick
- [ ] **TEST-24.10** GpsDot: Billboard created on add, removed on remove, visibility toggles

### 5.2 Visual Acceptance Testing

Rendering effects require manual visual verification:

| System | Test Page Path | Purpose |
|--------|-----------|---------|
| AnimationStub sprites | `/test/ch24-effects/animation-sprite/` | Verify sprite sheet animation renders with correct UV frames, palette remap, alpha blending |
| TeslaZap lightning | `/test/ch24-effects/tesla-zap/` | Verify lightning LinesMesh: bright/dim zaps, random jitter, color differentiation |
| ChronoVortex spiral | `/test/ch24-effects/chrono-vortex/` | Verify spiral UV animation, progress-based fade, Billboard orientation |
| GpsDotEffect minimap | `/test/ch24-effects/gps-dot/` | Verify dot sprite visible on minimap, player-colored, GPS toggle |

### 5.3 Test File Estimates

| Phase | Test Files | Estimated New Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|
| A-C: Impl tests | 3 (AnimationStub, TeslaZapRenderable, ChronoVortexRenderable) | ~20 | ~300 |
| D: Test expansion | 2 (AnimationStub, TeslaZapRenderable) | ~15 | ~200 |
| **Total** | **3** | **~35** | **~500** |

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Sheet texture not available** (sheets depend on MIX extraction from Ch23) | HIGH | AnimationStub has no texture to sample; rendered as solid color or invisible | Implement the debug magenta `StandardMaterial` fallback so missing textures are visibly obvious. Log console.warn with the missing sheet name. |
| **ShaderMaterial compilation failure** (custom GLSL may fail on some browsers/devices) | MEDIUM | Effects render as invisible; no crash, just missing visuals | Test on Chrome, Firefox, and Safari. Provide a `StandardMaterial` fallback path if ShaderMaterial compilation fails. Catch `Effect` creation errors. |
| **UV coordinate mismatch** (Sheet packing may produce different UV layout than expected) | MEDIUM | Sprites show wrong frame or garbage texture region | The evenly-spaced UV assumption is only a fallback. The primary path uses explicit `frameUVs[]` arrays. Unit test with known UV rects. |
| **renderingGroupId ordering conflicts** (multiple effects in the same group may z-fight) | LOW | Overlapping effects may flicker | Effects at the same height should not overlap in practice (TeslaZap and ChronoVortex are spatially separated). If needed, add sub-group IDs or slight Y-offsets. |
| **Per-frame allocation in vertex update** (new Float32Array each frame) | LOW | GC pressure during heavy combat | Pre-allocate vertex arrays in the TeslaZapRenderable and reuse them. The AnimationStub already pre-allocates `_uvArray`. |
| **AnimationStub consumer changes** (6+ consumers may need minor updates) | LOW | If the new constructor takes a Sheet parameter, all `new AnimationStub(...)` calls need updating | Make the Sheet parameter optional with a `setSheet()` setter. Existing constructor signatures continue to work. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-24.1: ShaderMaterial over StandardMaterial for AnimationStub

- **Decision**: Use `ShaderMaterial` with a custom fragment shader for sprite rendering, rather than `StandardMaterial`.
- **Rationale**: `StandardMaterial` does not support per-frame UV sub-region updates via a uniform. The fragment shader needs to sample a sub-rectangle of the sprite sheet texture based on the current frame index. `ShaderMaterial` allows passing a `uFrameUV` uniform that selects the correct region. Additionally, palette remapping (player colors, team colors) requires a second sampler (`uPaletteRemap`) that `StandardMaterial` cannot express.
- **Mitigation**: The vertex shader is a standard pass-through (identical to Babylon.js defaults). The fragment shader is ~15 lines: sample the sheet texture at the frame UV sub-region, apply palette lookup if enabled, output the resulting color. Fall back to `StandardMaterial` with emissive color if shader compilation fails.

### ADR-24.2: AnimationStub Keystone Pattern

- **Decision**: Fix AnimationStub's material/texture first, before any per-effect rendering work. All 6+ downstream effects (IonCannon, DropPodImpact, SatelliteLaunch, ConyardChronoVortex, GpsDotEffect) automatically become visible once AnimationStub has a material.
- **Rationale**: This is the same keystone pattern used in Phase B of the post-migration plan (ADR-P1.2). All effects share the same AnimationStub class. Fixing it once unblocks all of them. Per-effect work (TeslaZap, ChronoVortex) uses separate renderers and is independent.
- **Mitigation**: The AnimationStub public API surface does not change. Downstream consumers require zero code changes. The fix is entirely internal.

### ADR-24.3: Scene-Based Mesh Management (No Manual Render List)

- **Decision**: AnimationStub meshes are added directly to the Babylon.js scene with a `renderingGroupId` of 2, rather than managed through a separate `WorldRenderer` render list array.
- **Rationale**: Babylon.js's built-in scene graph and `renderingGroupId` system provide correct draw ordering without manual render list management. Meshes in the scene are automatically rendered by `Scene.render()`. The `renderingGroupId` layers (0=terrain, 1=actors, 2=effects, 3=shroud, 4=UI) ensure proper depth ordering.
- **Mitigation**: The `WorldRenderer.render()` method does not need to iterate a separate list of effect meshes. All effect meshes live in the scene and render automatically. This simplifies the render loop and reduces CPU overhead.

### ADR-24.4: Billboard-Based Effects (Not Particle Systems)

- **Decision**: C&C visual effects (TeslaZap, ChronoVortex, GpsDot) use individual Babylon.js meshes (LinesMesh, Plane with Billboard mode) rather than Babylon.js `ParticleSystem`.
- **Rationale**: Particle systems are optimized for many small, short-lived particles with similar properties. C&C effects are small in count (1-2 per effect instance), long-lived (persist for multiple ticks), and have highly specific geometry (lightning arcs, spiral vortexes). Individual meshes with custom ShaderMaterials provide the needed control without the overhead of a particle system.
- **Mitigation**: If performance becomes an issue with many simultaneous effects, switch to `ThinInstances` for Billboard-based effects (e.g., many GpsDots on the minimap).

---

> **Plan Status**: This plan defines the 4-phase approach to making all C&C visual effects visible. The keystone is 24.A.1 (assigning a ShaderMaterial to AnimationStub's mesh planes). Once done, IonCannon, DropPodImpact, SatelliteLaunch, and ConyardChronoVortex automatically become visible. TeslaZap and ChronoVortex have their own renderers and are independent tracks.

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All implementation work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `CLAUDE.md` -- Project conventions and overall status
> - `docs/post_migration_completion_plan.md` -- Post-migration plan (Phase B: 3D Rendering Integration reference)
> - `docs/chapter23_mix_runtime_plan.md` -- Chapter 23 (required for MIX asset access)
> - `src/OpenRA.Mods.Cnc/Effects/AnimationStub.ts` -- Current AnimationStub class (~441 lines)
> - `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts` -- Current TeslaZap renderer interface + segments
> - `src/OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.ts` -- Current ChronoVortex renderer + ShaderMaterial
> - `OpenRA/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.cs` -- Original C# TeslaZap renderer
> - `OpenRA/OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.cs` -- Original C# ChronoVortex renderer
