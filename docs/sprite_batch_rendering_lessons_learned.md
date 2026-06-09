# Project-Wide Audit: Lessons Learned from Acceptance Test Pages

Date: 2026-06-08 (Chapter 1), 2026-06-09 (Chapter 2)
Last Updated: 2026-06-09
Sources: 4-round bug-fixing cycle on `sprite-batch-rendering`, 3-round cycle on `screenmap/spatial-query`

---

## Summary

The `sprite-batch-rendering` acceptance test page required four rounds of fixes, uncovering issues in four categories: Babylon.js API misuse, performance anti-patterns, render-loop safety defects, and test-page robustness. This report audits the entire project for each category and identifies 12 confirmed issues across 8 files.

---

## Issue 1: ThinInstances + BILLBOARDMODE -- Billboard Not Inherited by Thin Instances

### Finding

Babylon.js `ThinInstances` do **not** inherit the base mesh's `billboardMode`. Each thin instance uses its own world matrix, bypassing the `computeWorldMatrix()` step that applies billboard rotation. Using `CreatePlane` (XY vertical plane) + `BILLBOARDMODE_Y` with thin instances causes sprites to face edge-on toward the camera (zero projected area).

### Confirmed Issue in Production Code

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 729-736 | `ThinInstancesGroup` constructor: `MeshBuilder.CreatePlane({ size: 1 })` + `this.mesh.billboardMode = Mesh.BILLBOARDMODE_Y` | **BLOCKER** |

The base mesh is a 1x1 XY-plane with `billboardMode = BILLBOARDMODE_Y`. The orthographic camera sits at `(0, 50, 0)` looking down at `(0, 0, 0)` (view direction `(0, -1, 0)`). The XY plane's normal is `(0, 0, 1)`. Even if billboard mode worked, `BILLBOARDMODE_Y` would only rotate around the Y axis, keeping the plane normal in the XZ plane -- which never faces the camera directly from `(0, 50, 0)`. And since thin instances skip billboard processing entirely, the plane stays in its original XY orientation.

**Visual result**: All sprites rendered through `ThinInstancesGroup` are invisible (zero projected area from the default top-down camera).

### Fix Required

The base mesh must be created so that its default orientation already faces the camera, independent of billboard mode. Two approaches:

1. **CreatePlane with rotation**: Create the plane and immediately rotate it so it lies flat in the XZ plane (rotation.x = -PI/2), facing upward toward the camera.
2. **CreateGround**: Use `MeshBuilder.CreateGround` instead of `CreatePlane`, which creates a mesh in the XZ plane by default.

Approach 2 is simpler and recommended:
```typescript
// Replace line 731-735:
this.mesh = MeshBuilder.CreateGround(
  `spriteGroup_${sheet.size.width}x${sheet.size.height}`,
  { width: 1, height: 1 },
  scene,
)
// Remove billboardMode assignment (line 736) since ground is already in XZ plane
```

Alternatively, if billboard behavior is desired for non-top-down camera angles, the test page solution was to create the plane **already oriented to face the camera** (rotation to put it in XZ/ground plane), rather than relying on billboard mode.

### Audit of Non-Production Code

No other production files use `billboardMode` + thin instances. Test pages that use `billboardMode` **without** thin instances are not affected:

| File | Billboard Usage | Affected? |
|------|----------------|-----------|
| `src/__e2e__/manual/sprite-renderer/sprite-billboarding/main.ts` | `BILLBOARDMODE_Y/ALL/NONE` on individual meshes | No (no thin instances) |
| `src/__e2e__/manual/world-renderer/world-layer-ordering/main.ts` | `BILLBOARDMODE_ALL` on label meshes | No (no thin instances) |
| `src/__e2e__/manual/animation/animation-orientation/main.ts` | `BILLBOARDMODE_ALL` on individual meshes | No (no thin instances) |

---

## Issue 2: Per-Frame Matrix/Object Allocation -- GC Storm

### Finding

`ThinInstancesGroup.setInstances()` allocates 5 `Matrix` objects per sprite instance (`Matrix.Scaling()`, `Matrix.RotationZ()`, `Matrix.Translation()`, 2x `Matrix.multiply()`) plus `new Float32Array()` per call. At 500 sprites this produces 2500 `Matrix` allocations per frame, causing GC to dominate frame time.

### Confirmed Issue in Production Code

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 753-754 | `new Float32Array(instances.length * 16)` and `new Float32Array(instances.length * 4)` -- allocated every `setInstances()` call | **MAJOR** |
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 762 | `Matrix.Scaling(...)` -- new Matrix per instance | **MAJOR** |
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 768 | `Matrix.RotationZ(...)` -- new Matrix per instance | **MAJOR** |
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 773-777 | `Matrix.Translation(...)` + 2x `Matrix.multiply()` -- 3 new Matrices per instance | **MAJOR** |
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 785-789 | Loop writing to `matrices[i * 16 + j]` -- repeated index multiplication per element | **MINOR** |

**Combined impact**: For a scene with 500 sprites, `setInstances()` allocates 2500 `Matrix` objects + 2 `Float32Array` buffers per flush, which can happen every frame in a busy game scene.

### Fix Required

Use **ToRef variants** for zero-allocation matrix construction, and pre-allocate buffer arrays:

```typescript
// Pre-allocate in the class (reuse across frames):
private matrixBuffer: Float32Array = new Float32Array(0)
private colorBuffer: Float32Array = new Float32Array(0)

// In setInstances():
const needed = instances.length * 16
if (this.matrixBuffer.length < needed) this.matrixBuffer = new Float32Array(needed)
if (this.colorBuffer.length < instances.length * 4) this.colorBuffer = new Float32Array(instances.length * 4)

const scaleV = new Vector3()
const quat = new Quaternion()
const transV = new Vector3()
const tmpMatrix = new Matrix()
const world = new Matrix()  // Reusable across iterations

for (let i = 0; i < instances.length; i++) {
  const inst = instances[i]
  // Use ToRef variants (zero allocation):
  scaleV.set(inst.sprite.size.x * inst.scale.x, inst.sprite.size.y * inst.scale.y, inst.scale.z)
  Quaternion.RotationYawPitchRollToRef(0, 0, inst.rotation, quat)
  transV.set(
    inst.location.x + inst.sprite.offset.x * inst.scale.x,
    inst.location.y + inst.sprite.offset.y * inst.scale.y + inst.sprite.zRamp * inst.scale.y,
    inst.location.z + inst.sprite.offset.z * inst.scale.z,
  )
  Matrix.ComposeToRef(scaleV, quat, transV, world)
  world.copyToArray(this.matrixBuffer, i * 16)
  // colors...
}
```

### Per-Frame Allocation Audit -- Other Hot Paths

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | 879-881 | `new Float32Array(vertexCount * 3)` + `new Float32Array(vertexCount * 4)` per `flush()` | **MINOR** (flush is less frequent; RgbaColorRenderer is for debug/UI) |
| `src/OpenRA.Game/Graphics/WorldRenderer.ts` | 791-795 | `buffer.map(...)` in `generateRenderables()` -- allocates new indexed array per frame (already has a PERF comment on line 789-790 noting this future optimization) | **MINOR** (documented as known issue) |

The `RgbaColorRenderer.flush()` allocations are acceptable because flush is called infrequently (debug graphics) and vertex counts are small. The `WorldRenderer.generateRenderables()` issue is already documented in code.

---

## Issue 3: StandardMaterial + disableLighting=true -- Missing emissiveTexture/emissiveColor

### Finding

When `StandardMaterial.disableLighting = true`, Babylon.js 9.x shader skips all lighting calculations and outputs only the emissive channel:

```
finalColor = emissiveColor * emissiveTexture
```

If `emissiveColor` is not set (defaults to `Color3(0,0,0)` = black) and `emissiveTexture` is not set, the output is black regardless of `diffuseTexture` value.

The fix is to set **both** `diffuseTexture` AND `emissiveTexture`, with `emissiveColor = Color3.White()`.

### Confirmed Issue in Production Code

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 740-743 | `ThinInstancesGroup` constructor: `disableLighting = true`, `diffuseTexture` set, but `emissiveColor` is NOT set (defaults to black), `emissiveTexture` is NOT set | **BLOCKER** -- all sprites render black |
| `src/OpenRA.Game/Renderer.ts` | 649-654 | `renderWorldToScreen()`: `disableLighting = true`, `diffuseTexture = worldRenderTarget`, `emissiveColor = Color3(1,1,1)` set, but `emissiveTexture` is NOT set | **MAJOR** -- world-to-screen quad may render without texture (potential white screen) |

**SpriteRenderer.ts (line 740-743)**: The material is created as:
```typescript
this.material = new StandardMaterial(`spriteMat_${sheet.size.width}`, scene)
this.material.diffuseTexture = sheet.texture
this.material.useAlphaFromDiffuseTexture = true
this.material.backFaceCulling = false
this.material.disableLighting = true
```

Missing: `emissiveColor` and `emissiveTexture`. With `disableLighting=true`, the shader uses only emissive channel. `emissiveColor` defaults to `(0,0,0)`, so all sprites render as black.

**Fix**:
```typescript
this.material.emissiveTexture = sheet.texture  // Add this line
this.material.emissiveColor = new Color3(1, 1, 1)  // Add this line
this.material.useAlphaFromDiffuseTexture = true
// Keep diffuseTexture as well (some Babylon.js versions may fall back)
```

**Renderer.ts (line 649-654)**: The `renderWorldToScreen()` method creates:
```typescript
const mat = new StandardMaterial('worldMat', this.uiScene)
mat.diffuseTexture = this.worldRenderTarget
mat.emissiveColor = new Color3(1, 1, 1)
mat.disableLighting = true
mat.backFaceCulling = false
```

`emissiveColor` is set to White so the emissive channel is active, but `emissiveTexture` is NOT set. The `diffuseTexture` might not be read by the shader. Behavior depends on Babylon.js version -- some versions may fall back to diffuse, others may ignore it. To be safe:

**Fix**:
```typescript
mat.emissiveTexture = this.worldRenderTarget  // Add this line
```

### Audit: All disableLighting=true Sites

| File | Line | Has emissiveColor? | Has emissiveTexture? | Status |
|------|------|--------------------|----------------------|--------|
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 743 | NO | NO | **BLOCKER** |
| `src/OpenRA.Game/Renderer.ts` | 652 | YES (White) | NO | **MAJOR** |
| `src/__e2e__/manual/world-renderer/world-layer-ordering/main.ts` | 180, 207 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/world-renderer/world-z-sorting/main.ts` | 169, 190, 297, 310 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/animation/animation-frame-switching/main.ts` | 198, 222, 242 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/animation/animation-orientation/main.ts` | 192, 249, 285 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/sprite-renderer/sprite-blend-modes/main.ts` | 246, 315, 332 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/sprite-renderer/sprite-billboarding/main.ts` | 99, 263, 288, 304, 318 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/hardware-palette/color-accuracy/main.ts` | 368 | NEEDS CHECK | NEEDS CHECK | Test pages |
| `src/__e2e__/manual/sprite-renderer/sprite-batch-rendering/main.ts` | 256 | YES (White) | YES | **REFERENCE** (correct) |

The test pages marked "NEEDS CHECK" should be audited individually but are lower priority (dev-only infrastructure).

---

## Issue 4: Babylon.js Render Loop -- No Error Protection, Silent Death

### Finding

Babylon.js 9.10.1 `_renderFrame()` has **no try-catch** around user-registered render callbacks. Any unhandled exception in a render callback causes `requestAnimationFrame` to stop being scheduled, killing the render loop silently with no warning or log.

### Confirmed Issue in Production Code

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/OpenRA.Game/Renderer.ts` | 1070-1073 | `startRenderLoop()`: `engine.runRenderLoop(() => { callback(...) })` -- NO try-catch | **BLOCKER** |

This is the **central render loop entry point** for the entire application. If any error occurs within a frame callback (game logic, rendering, etc.), the render loop silently dies.

**Fix**:
```typescript
startRenderLoop(callback: (deltaTime: number) => void): void {
  this.engine.runRenderLoop(() => {
    try {
      callback(this.engine.getDeltaTime())
    } catch (error) {
      console.error('[Renderer] Unhandled error in render loop callback:', error)
      // Do NOT rethrow -- would kill render loop silently
    }
  })
}
```

### Audit: All engine.runRenderLoop() Callbacks

| File | Line | Has try-catch? | Severity |
|------|------|----------------|----------|
| `src/OpenRA.Game/Renderer.ts` | 1071 | **NO** | **BLOCKER** (production) |
| `src/__e2e__/manual/sprite-renderer/sprite-batch-rendering/main.ts` | 424 | YES | REFERENCE (correct) |
| `src/__e2e__/manual/world-renderer/world-layer-ordering/main.ts` | 299 | NO | MINOR (test page) |
| `src/__e2e__/manual/world-renderer/world-z-sorting/main.ts` | 329 | NO | MINOR (test page) |
| `src/__e2e__/manual/rgba-color-renderer/rgba-debug-graphics/main.ts` | 368 | NO | MINOR (test page) |
| `src/__e2e__/manual/rgba-color-renderer/rgba-alpha-blending/main.ts` | 254 | NO | MINOR (test page) |
| `src/__e2e__/manual/animation/animation-frame-switching/main.ts` | 407 | NO | MINOR (test page) |
| `src/__e2e__/manual/animation/animation-orientation/main.ts` | 436 | NO | MINOR (test page) |
| `src/__e2e__/manual/sprite-renderer/sprite-blend-modes/main.ts` | 432 | NO | MINOR (test page) |
| `src/__e2e__/manual/sprite-renderer/sprite-billboarding/main.ts` | 415 | NO | MINOR (test page) |

The production `Renderer.ts:1071` is the only **BLOCKER** here. Test page callbacks are less critical because they are not production surfaces -- but should still be fixed as a defensive measure. One test page (`sprite-batch-rendering`) already has the fix and serves as the reference implementation.

---

## Issue 5: ThinInstances Base Mesh Frustum Culling -- Small Bounding Box

### Finding

Babylon.js frustum culling is based on the **base mesh's** bounding box. When the base mesh is only 1x1 unit but thin instances are spread across a large area, the entire thin instances batch can be incorrectly culled when the base mesh's small bounding box falls outside the frustum.

### Confirmed Issue in Production Code

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 731-735, 804 | Base mesh is `CreatePlane({ size: 1 })` (1x1 unit). `setInstances()` calls `refreshBoundingInfo()` but the bounding info only considers the base mesh's geometry, not thin instance positions. `alwaysSelectAsActiveMesh` is NOT set. | **MAJOR** |

The base plane is 1x1 but sprites can be placed anywhere in the world. If the camera moves so the 1x1 region at the origin is off-screen, the entire sprite batch is culled.

**Fix**:
```typescript
// In ThinInstancesGroup constructor, after creating the mesh:
this.mesh.alwaysSelectAsActiveMesh = true  // Add this line
```

The trivially correct alternative is to compute a bounding box that encompasses all thin instance positions, but this requires re-computing every frame. `alwaysSelectAsActiveMesh = true` is simpler and acceptable for sprite rendering (sprites inherently need to be considered for rendering regardless of position relative to the base mesh origin).

### Audit: Other ThinInstances Usage

No other files in production code use thin instances. The only consumer is `SpriteRenderer.ts`'s `ThinInstancesGroup`.

---

## Issue 6: Test Page -- getElementById Non-Null Assertions Without HTML Element Guarantee

### Finding

The `sprite-batch-rendering` test page had `main.ts` referencing `info-fps` via `document.getElementById('info-fps')!` (non-null assertion) but the HTML was missing the `<span id="info-fps">` element, causing `TypeError: null.textContent = ...` which killed the render loop.

### Audit Results

144 instances of `document.getElementById(...)!` exist across 7 test files. All use non-null assertions without any null-check guard, meaning a missing HTML element immediately causes a runtime TypeError.

### Test Page Files with Non-Null DOM Access

| File | Count | Priority |
|------|-------|----------|
| `src/__e2e__/manual/sprite-renderer/sprite-blend-modes/main.ts` | ~20 | MINOR |
| `src/__e2e__/manual/world-renderer/world-layer-ordering/main.ts` | ~15 | MINOR |
| `src/__e2e__/manual/rgba-color-renderer/rgba-debug-graphics/main.ts` | ~20 | MINOR |
| `src/__e2e__/manual/animation/animation-frame-switching/main.ts` | ~20 | MINOR |
| `src/__e2e__/manual/animation/animation-orientation/main.ts` | ~15 | MINOR |
| `src/__e2e__/manual/sprite-renderer/sprite-billboarding/main.ts` | ~15 | MINOR |
| `src/__e2e__/manual/sprite-renderer/sprite-batch-rendering/main.ts` | ~20 | MINOR |
| `src/__e2e__/manual/world-renderer/world-z-sorting/main.ts` | ~10 | MINOR |
| `src/__e2e__/manual/rgba-color-renderer/rgba-alpha-blending/main.ts` | ~5 | MINOR |
| `src/__e2e__/manual/hardware-palette/color-accuracy/main.ts` | ~4 | MINOR |
| **TOTAL** | **~144** | -- |

### Recommended Fix

Replace all `document.getElementById(...)!` with a helper function:

```typescript
function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing DOM element: #${id}`)
  return el as T
}
```

Or use optional chaining: `document.getElementById('info-fps')?.textContent = ...`

The helper function approach is preferred because it gives a clear error message with the missing element ID, rather than a cryptic `TypeError: Cannot set properties of null`.

---

## Consolidated Action Items

### Production Code Fixes (Priority Order)

| Priority | File | Issue | Action | Commit | Status |
|----------|------|-------|--------|--------|--------|
| **BLOCKER** | `src/OpenRA.Game/Graphics/SpriteRenderer.ts:736` | ThinInstances + Billboard incompatibility | Replace `CreatePlane` with `CreateGround` and remove `billboardMode` (or reorient plane to XZ plane facing camera) | `e96bc06` | ✅ FIXED |
| **BLOCKER** | `src/OpenRA.Game/Graphics/SpriteRenderer.ts:740-743` | disableLighting=true + missing emissive | Add `material.emissiveTexture = sheet.texture` and `material.emissiveColor = new Color3(1, 1, 1)` | `e96bc06` | ✅ FIXED |
| **BLOCKER** | `src/OpenRA.Game/Renderer.ts:1071-1073` | No try-catch in render loop | Wrap callback in try-catch, log but don't rethrow | `623cb4f` | ✅ FIXED |
| **MAJOR** | `src/OpenRA.Game/Graphics/SpriteRenderer.ts:752-783` | Per-frame Matrix/Float32Array allocation | Use ToRef variants + pre-allocated buffers | `e96bc06` | ✅ FIXED |
| **MAJOR** | `src/OpenRA.Game/Graphics/SpriteRenderer.ts:804` | Missing `alwaysSelectAsActiveMesh` | Set `this.mesh.alwaysSelectAsActiveMesh = true` | `e96bc06` | ✅ FIXED |
| **MAJOR** | `src/OpenRA.Game/Renderer.ts:652` | disableLighting=true + missing emissiveTexture | Add `mat.emissiveTexture = this.worldRenderTarget` | `623cb4f` | ✅ FIXED |

### Test Page Fixes (Lower Priority)

| Priority | Scope | Issue | Action |
|----------|-------|-------|--------|
| MINOR | 8 test pages | No try-catch in `runRenderLoop` callbacks | Add try-catch to all 8 callbacks (reference: `sprite-batch-rendering/main.ts`) |
| MINOR | 10 test pages, ~144 instances | `getElementById!` non-null assertions | Replace with helper function or optional chaining |

### Template for New Test Pages

Future test pages should start from the `sprite-batch-rendering/main.ts` template which already implements:
- try-catch in `engine.runRenderLoop()` callback
- `emissiveTexture` + `emissiveColor` with `disableLighting=true`
- First-frame FPS clock reset
- Non-null DOM element access via helper or optional chaining

---

## Root Cause Analysis

### Why Weren't These Caught Earlier?

1. **Unit tests mock Babylon.js**: `SpriteRenderer.test.ts` mocks `MeshBuilder.CreatePlane`, `StandardMaterial`, and `Mesh`, so the actual Babylon.js runtime behavior (billboard inheritance, emissive channel, frustum culling) is never exercised.

2. **No visual integration tests for SpriteRenderer**: The `sprite-renderer/` test pages (`sprite-billboarding` and `sprite-blend-modes`) use individual meshes (not thin instances), so they don't test the `ThinInstancesGroup` code path at all. `sprite-batch-rendering` was the first test page to exercise thin instances at scale.

3. **Babylon.js version-specific behavior**: The `disableLighting` shader behavior may differ between versions. The standard library (9.10.1) requires explicit `emissiveTexture`.

### What Changes to Process?

| Change | Rationale |
|--------|-----------|
| **Mandatory visual integration test** for any module that creates GPU resources | Unit tests cannot detect Babylon.js API semantics |
| **Performance benchmark for any batch renderer** | Per-frame allocation issues only manifest at scale |
| **Render loop safety rule**: all `runRenderLoop` callbacks MUST have try-catch | Prevents silent render loop death in production |
| **Template-based test page creation** | Ensures defensive patterns (try-catch, DOM safety, emissive/diffuse parity) are always applied |

---

## Chapter 2: spatial-query Lessons Learned & Project-Wide Audit

Date: 2026-06-09
Source: 3-round bug-fixing cycle on `screenmap/spatial-query` acceptance test page

---

## Summary

The `screenmap/spatial-query` acceptance test page required three rounds of fixes, uncovering issues in three new categories: pointer capture mechanism interaction, camera control vs custom interaction conflict, and canvas focus styling. This chapter audits the entire project for each category.

---

## Issue 7 (spatial-query #1): Babylon.js `setPointerCapture()` Suppresses Compatibility Mouse Events

### Finding

Babylon.js `camera.attachControl(canvas)` calls `setPointerCapture()` on `pointerdown`. Once the browser establishes pointer capture, it **suppresses all compatibility mouse events** (`mousedown`, `mouseup`, `mousemove`) for the captured pointer. Any business logic registered on `mousedown`/`mouseup`/`mousemove` event listeners will never execute while pointer capture is active.

This is a browser-spec behavior: pointer capture redirects all pointer events to the capturing element and suppresses the legacy mouse event path.

### Fix

All canvas-level interaction logic MUST use `pointerdown`/`pointerup`/`pointermove` instead of `mousedown`/`mouseup`/`mousemove` when `attachControl()` is in use (or may be used in the future).

### Project-Wide Audit

#### Production Code

| File | Canvas mouse listeners? | Status |
|------|------------------------|--------|
| `src/OpenRA.Game/Renderer.ts` | NO (only `window.resize`) | CLEAN |
| `src/OpenRA.Game/Graphics/WorldRenderer.ts` | NO | CLEAN |

Production code uses `TargetCamera` without `attachControl()` and has no canvas mouse event listeners. No issue.

#### Test Pages

| File | `attachControl`? | Canvas mouse listeners? | Risk |
|------|------------------|------------------------|------|
| `screenmap/spatial-query/main.ts` | NO (intentionally avoided) | `mousedown`/`mouseup`/`mousemove` as **diagnostic stubs** (line 797-805, intentionally silent observers) | NONE -- diagnostic only, no active logic depends on them. Also has proper `pointerdown`/`pointerup`/`pointermove` (lines 607/661/697) for actual interaction logic. |
| `terrain-sprite-layer/batch-rendering/main.ts` | YES (line 170) | `mousemove` (line 424, tooltip), `mouseleave` (line 465), `click` (line 470) | LOW -- `mousemove` for tooltip fires during hover (no button press = no pointer capture). During camera drag, suppression is actually desired (no tooltip while rotating). `click` is a higher-level event synthesized from pointer events, not suppressed. |
| 13 other test pages | YES (5 files) or NO | None have canvas mouse listeners | CLEAN |

**Verdict**: No active mouse-event logic is broken by pointer capture in the current codebase. The `terrain-sprite-layer` tooltip design is correct because:
1. Tooltip `mousemove` fires during simple hover (no button pressed, no pointer capture)
2. During camera drag (pointer capture active), tooltip suppression is the desired UX
3. `click` events are synthesized from pointer events and are not suppressed

### Preventive Rule

**Do not register `mousedown`/`mouseup`/`mousemove` on the canvas if the page uses `camera.attachControl()`.** Use `pointerdown`/`pointerup`/`pointermove` for all canvas interaction logic. This applies to both test pages and future production code.

---

## Issue 8 (spatial-query #2): Camera `attachControl()` Conflicts with Custom Pointer Interactions

### Finding

`camera.attachControl()` in Babylon.js configures the camera (typically `ArcRotateCamera`) to consume all pointer events for rotation, panning, and zooming. If a page also implements custom drag-based interactions (rectangle selection, drawing, drag-to-pan), the two systems conflict -- dragging the mouse causes both the camera to move AND the custom interaction to trigger.

Specifically:
- `ArcRotateCamera` uses `pointerdown` to begin drag rotation
- Custom drag-select also uses `pointerdown` to begin rectangle selection
- Both fire simultaneously, producing jittery/unusable behavior

### Fix

For pages that need custom pointer-based drag interactions on the canvas, **remove `camera.attachControl()`** and implement camera control manually via:
- Keyboard: WASD or arrow keys for panning, Q/E for rotation
- Scroll wheel: `wheel` event listener for zoom
- This gives exclusive pointer control to the custom interaction logic

The `screenmap/spatial-query` page is the reference implementation of this pattern.

### Project-Wide Audit

#### Production Code

| File | Camera type | `attachControl`? | Custom pointer interaction? | Conflict? |
|------|------------|-------------------|---------------------------|-----------|
| `src/OpenRA.Game/Renderer.ts` | `TargetCamera` (orthographic/perspective) | NO | None currently implemented | CLEAN |

The production camera system is designed for explicit programmatic control (scrolling/panning tied to game logic), not user-drag interaction. No conflict expected. However, when game interaction systems (selection, command issuing) are implemented, the camera interaction model must be planned to avoid this conflict.

#### Test Pages

| File | `attachControl`? | Custom canvas drag interaction? | Conflict? |
|------|------------------|--------------------------------|-----------|
| `screenmap/spatial-query/main.ts` | NO (line 265 comment) | YES (drag-to-select rectangle) | CORRECT (manually avoided) |
| `actor/actor-scene-rendering/main.ts` | YES (line 157) | None (only button clicks) | CLEAN |
| `sprite-renderer/sprite-billboarding/main.ts` | YES (line 220) | None (only button clicks) | CLEAN |
| `sprite-renderer/sprite-batch-rendering/main.ts` | YES (line 237) | None (only button clicks) | CLEAN |
| `player/player-diplomacy/main.ts` | YES (line 208) | None (only button clicks) | CLEAN |
| `terrain-sprite-layer/batch-rendering/main.ts` | YES (line 170) | `click` (cell update) + `mousemove` (tooltip) | LOW -- `click` is point-based, not drag-based; `mousemove` for tooltip fires during hover only |

**Verdict**: No current conflicts. The `spatial-query` page correctly avoids `attachControl` because it implements custom drag-select. All other `attachControl` pages do not implement drag-based canvas interactions.

### Architectural Rule for Future Production Code

When implementing game interaction systems (selection, orders, etc.):

1. If the camera is user-controlled via drag (e.g., `ArcRotateCamera.attachControl()`), game interactions should use **modifier keys** (Shift+click, Ctrl+drag) or **discrete click** (not drag) to avoid conflict.
2. If the game needs drag-based interactions (box selection), use a **programmatic camera** (`TargetCamera` with keyboard/wheel control) as done in the production `Renderer.ts`.
3. The spatial-query pattern (keyboard + wheel camera, exclusive pointer for custom interaction) is the recommended approach for complex interaction scenarios.

---

## Issue 9 (spatial-query #3): Canvas Focus Ring (White Box) on Click

### Finding

When a `<canvas>` element receives focus (e.g., from a click), the browser draws a focus indicator ring. On dark backgrounds, this appears as a **white box** around the canvas. In applications where the canvas is clicked frequently (games, test pages), this creates an annoying visual flash on every click.

### Fix

Add to the CSS targeting the Babylon.js canvas:
```css
canvas {
  outline: none !important;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;  /* Prevent browser gesture interpretation */
}
```

And add to the JavaScript after creating the canvas:
```typescript
canvas.tabIndex = -1  // Prevent Tab key from focusing the canvas
```

The `screenmap/spatial-query/index.html` is the reference implementation (line 15).

### Project-Wide Audit

#### Production Code

| Scope | Has fix? | Severity |
|-------|---------|----------|
| `src/style.css` | NO canvas-specific rules | **MAJOR** -- when the production app is integrated, clicking the game canvas will flash a white focus ring |
| `src/OpenRA.Game/Renderer.ts` | NO canvas styling code | **MAJOR** -- `Renderer` constructor receives canvas but does not apply `tabIndex = -1` or outline CSS |
| `src/main.ts` | NO (still Vite template boilerplate) | NOTE -- main.ts not yet integrated with Renderer |

**Fix needed**: When main.ts integrates the Renderer, either:
1. Add `canvas { outline: none !important; touch-action: none; }` to `src/style.css`, OR
2. Add inline style setting in `Renderer` constructor: `canvas.style.outline = 'none'` + `canvas.style.touchAction = 'none'` + `canvas.tabIndex = -1`

#### Test Pages

| Page | Has outline fix? | Status |
|------|-----------------|--------|
| `screenmap/spatial-query/index.html` | YES (line 15: `#sandbox canvas { outline: none !important; touch-action: none; }`) | REFERENCE |
| 15 other test pages | NO (only `display: block; width/height: 100%`) | **MISSING** -- clicking canvas causes white focus ring flash |

**All 15 test pages without the fix** should add `outline: none !important; -webkit-tap-highlight-color: transparent; touch-action: none;` to their `#sandbox canvas` CSS rule, and add `canvas.tabIndex = -1` in JavaScript after canvas creation.

The affected test page directories:
1. `world-renderer/world-z-sorting`
2. `world-renderer/world-layer-ordering`
3. `animation/animation-frame-switching`
4. `animation/animation-play-modes`
5. `animation/animation-orientation`
6. `sprite-renderer/sprite-batch-rendering`
7. `sprite-renderer/sprite-billboarding`
8. `sprite-renderer/sprite-blend-modes`
9. `rgba-color-renderer/rgba-debug-graphics`
10. `rgba-color-renderer/rgba-alpha-blending`
11. `terrain-sprite-layer/batch-rendering`
12. `actor/actor-scene-rendering`
13. `player/player-diplomacy`
14. `sheet/atlas-packing`
15. `hardware-palette/color-accuracy`

---

## Issue 10 (spatial-query follow-up): Additional `disableLighting` + Missing `emissiveTexture` Site

### Finding

During the project-wide audit of all `disableLighting = true` sites, one additional issue was discovered that was missed in the original Issue #3 audit:

| File | Line | Description | Severity |
|------|------|-------------|----------|
| `src/__e2e__/manual/sprite-renderer/sprite-blend-modes/main.ts` | 332-337 | `bgMat` (background checkerboard) sets `diffuseTexture = checkerTex` + `emissiveColor = White` + `disableLighting = true`, but **`emissiveTexture` is NOT set** | **MAJOR** (test page) |

The checkerboard background texture is assigned only to `diffuseTexture`. With `disableLighting = true`, the shader ignores `diffuseTexture` and uses only `emissiveColor * emissiveTexture`. Since `emissiveTexture` is not set, the background renders as solid white instead of the intended checkerboard pattern.

**Fix**: Add `bgMat.emissiveTexture = checkerTex` after line 334.

### Updated Audit: All `disableLighting = true` Sites Verified

All 37 `disableLighting = true` sites across 17 files have been verified. **36 of 37 are correct** (all set both `emissiveColor` and, where a texture is intended, `emissiveTexture`). The single exception is `sprite-blend-modes/main.ts:332-337` (background material).

### Previously "NEEDS CHECK" Entries -- All Confirmed Correct

All 8 test pages previously marked "NEEDS CHECK" in the Issue #3 audit table have been verified. Every `disableLighting = true` material in these pages correctly sets both `emissiveTexture` and `emissiveColor`:

| File | Sites | Status |
|------|-------|--------|
| `world-renderer/world-layer-ordering/main.ts` | 2 | CORRECT (emissiveTexture + emissiveColor both set) |
| `world-renderer/world-z-sorting/main.ts` | 4 | CORRECT |
| `animation/animation-frame-switching/main.ts` | 3 | CORRECT |
| `animation/animation-orientation/main.ts` | 3 | CORRECT |
| `animation/animation-play-modes/main.ts` | 2 | CORRECT |
| `sprite-renderer/sprite-blend-modes/main.ts` | 3 total (2 correct + 1 bgMat bug) | 1 BUG |
| `sprite-renderer/sprite-billboarding/main.ts` | 5 | CORRECT |
| `hardware-palette/color-accuracy/main.ts` | 1 | CORRECT |

---

## Consolidated New Action Items

### Test Page Fixes from spatial-query Audit

| Priority | Scope | Issue | Action |
|----------|-------|-------|--------|
| **MAJOR** | `sprite-renderer/sprite-blend-modes/main.ts:333` | `bgMat` missing `emissiveTexture` | Add `bgMat.emissiveTexture = checkerTex` |
| MINOR | 15 test page `index.html` files | Missing canvas outline CSS fix | Add `outline: none !important; -webkit-tap-highlight-color: transparent; touch-action: none;` to `#sandbox canvas` rule + `canvas.tabIndex = -1` in JS |
| MINOR | 8 test pages (non-sprite-batch-rendering) | No try-catch in `runRenderLoop` callbacks | Add try-catch (previously identified in Issue #4, still pending) |
| MINOR | 10 test pages, ~144 instances | `getElementById!` non-null assertions | Replace with helper function (previously identified in Issue #6, still pending) |

### Production Code Action Items

| Priority | Scope | Issue | Action |
|----------|-------|-------|--------|
| **MAJOR** | `src/style.css` + `src/OpenRA.Game/Renderer.ts` | Production canvas missing outline fix | Add `canvas { outline: none !important; touch-action: none; }` to style.css; add `canvas.tabIndex = -1` in Renderer constructor or canvas creation site |
| NOTE | Future game interaction systems | Camera control vs custom interaction may conflict | Follow architectural rules in Issue #8 when implementing selection/command systems |

### Updated Template for New Test Pages

In addition to the three rules from Chapter 1:

4. **Canvas outline**: Include `#sandbox canvas { outline: none !important; -webkit-tap-highlight-color: transparent; touch-action: none; }` in every `index.html`, and `canvas.tabIndex = -1` in JavaScript after canvas creation.
5. **Pointer events, not mouse events**: Use `pointerdown`/`pointerup`/`pointermove` for all canvas interactions. Never use `mousedown`/`mouseup`/`mousemove` if `camera.attachControl()` is or may be used.
6. **Camera vs interaction decision**: If the page needs custom drag interactions (selection, drawing), do NOT call `camera.attachControl()`. Use keyboard + wheel for camera control instead. Use `screenmap/spatial-query/main.ts` as the reference template for this pattern.
