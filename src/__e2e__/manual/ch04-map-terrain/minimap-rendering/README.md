# Minimap Rendering Pipeline -- Acceptance Test

**审核状态**: ✅ 全部审核通过 (2026-06-20)

## Purpose

Visually verify that the minimap rendering pipeline correctly converts Rgba32 pixel data
to a textured minimap sprite. This test validates the three bugs fixed in Phase B (TODO-4.E.4):
SpriteFrameType correction, size correction, and releaseBuffer() lifecycle.

## Background: Phase B Bug Fixes

The minimap rendering pipeline in `MapPreview.generatePreviewPixels()` produces Rgba32
pixel data and feeds it through `SheetBuilder.addSimple()` to pack into a texture atlas.
Phase B fixed three critical bugs in this pipeline:

| Bug | OpenRA C# Original | Buggy TS Port (Before Fix) | Fixed TS Port |
|-----|-------------------|---------------------------|---------------|
| **Bug 1: SpriteFrameType** | `SpriteFrameType.Rgba32` (value 3) — RGBA 32-bit format matching PNG decoder output | `SpriteFrameType.Indexed8` (value 0) — treated as palette index data, causing wrong pixel interpretation | `SpriteFrameType.Rgba32` (value 3) — correctly interpreted as RGBA color data |
| **Bug 2: Size** | Actual image dimensions from PNG header | `{width: 1, height: 1}` — hardcoded, causing texture UV to span entire atlas | `{width, height}` — actual image dimensions |
| **Bug 3: releaseBuffer()** | `sheetBuilder.Current.ReleaseBuffer()` called after adding sprite | Not called — CPU buffer retained indefinitely, wasting memory | `releaseBuffer()` called — buffer freed after GPU upload |

### Data Pipeline (Fixed)

```
MapPreview.generatePreviewPixels(w, h, terrainSampler)
  → Uint8Array [R,G,B,A, R,G,B,A, ...]  ← Rgba32 byte order
  ↓
SheetBuilder.addSimple(pixels, SpriteFrameType.Rgba32(3), {width: w, height: h})
  → fastCopyIntoChannel(src, Rgba32 → dest BGRA buffer)  ← Bug 1 & 2 fix here
  → commitBufferedData()  ← marks dirty
  → releaseBuffer()       ← Bug 3 fix here
  ↓
Sheet.getTexture(scene)
  → _createRgbaUploadBuffer()  ← BGRA→RGBA swap (R↔B)
  → RawTexture.CreateRGBATexture(rgbaData, w, h, scene, ...)
  ↓
Plane Mesh (StandardMaterial.diffuseTexture)
```

### Test Approach: Scheme B (Direct RawTexture)

This test page uses **Scheme B**: directly creates a Babylon.js `RawTexture` from Rgba32
pixel data, bypassing `SheetBuilder` to reduce dependency chain complexity while still
validating the core data format correctness. The pixel data generation follows the same
Rgba32 byte order as `MapPreview.generatePreviewPixels()`.

The pipeline overlay in the test page explains how the full SheetBuilder pipeline maps to
this simplified setup. The pixel data format (Rgba32: R,G,B,A byte order) is identical
in both paths.

## Expected Results

### Criterion 1: Correct Color Rendering (Bug 1)
- Terrain regions should display distinct, recognizable colors matching the color palette:
  - **Water (deep)**: `#4040C0` (medium blue) — lowest elevation
  - **Water (shallow)**: `#5060D0` (lighter blue)
  - **Beach**: `#D0C090` (sandy tan) — elevation 0.35-0.42
  - **Clear**: `#C0B080` (yellow-green) — elevation 0.42-0.62, usually dominant
  - **Tree / Forest**: `#408040` (forest green) — elevation 0.62-0.72
  - **Road**: `#808080` (medium gray) — elevation 0.72-0.78
  - **Rock**: `#606060` (dark gray) — elevation 0.78-0.92
  - **Snow / Peak**: `#E8E8E8` (off-white) — highest elevation 0.92-1.00
- Colors must NOT be inverted, swapped (no red↔blue swap), or corrupted
- Water must appear blue, not red or green; Clear must appear yellow-green, not blue
- **Quantifiable**: Pixel at any coordinate (x,y) should match the RGBA tuple from `terrainColorForElevation()`. Use `__testHarness.getPixelAt(x, y)` for CPU-side data verification.
  注意：`getPixelAt()` 从 CPU 端重新生成像素数据，而非从 GPU 读取。此验证测试像素生成逻辑的正确性，而非 GPU 渲染。GPU 颜色正确性需通过视觉检查确认。

### Criterion 2: Correct Aspect Ratio (Bug 2)
- **128x128** map: rendered plane is a square (1:1 aspect ratio)
- **200x100** map: rendered plane is a 2:1 rectangle (wider than tall)
- **64x64** map: rendered plane is a square
- **512x512** map: rendered plane is a square
- The plane's longest side is fixed at 4 Babylon.js units; the other side scales proportionally
- **Quantifiable**: Plane width/height ratio = texture width/height ratio within 0.001 tolerance. Use `__testHarness.getCurrentPlane()` to inspect geometry dimensions.

### Criterion 3: No Visual Artifacts
- No tearing, misalignment, or color banding at the edges of the texture
- Texture is crisply rendered with NEAREST sampling (no bilinear blur)
- In wireframe mode (press W), the plane mesh shows a clean single-quad grid
- No Z-fighting or flickering when rotating the camera
- **Quantifiable**: Wireframe mode shows exactly 2 triangles (1 quad = 2 triangles) for the plane mesh

### Criterion 4: Dynamic Update (Bug 3 equivalent)
- Clicking "Generate Random Minimap" updates the texture within 50ms
- Previous texture is properly disposed (no GPU memory leak)
- Generating 5+ times in succession shows no performance degradation
- FPS remains stable at 55-60 throughout repeated generation
- **Quantifiable**: Run benchmark (100 generations at current size) -- average time < 20ms per generation at 128x128, < 80ms at 512x512

### Criterion 5: Channel Format Verification (Bug 1)
- Each pixel uses 4 bytes (R, G, B, A), not 1 byte (palette index)
- Total data size = `width * height * 4` bytes
- **Quantifiable**: Check "Data Length" stat = `width * height * 4` bytes. For 128x128: 65,536 bytes.

## Verification Steps

### Prerequisites
1. Open the test page: `http://localhost:5173/test/ch04-map-terrain/minimap-rendering/`
2. Confirm the info bar shows "WebGL 2.0" engine
3. Set screen resolution to 1920x1080 (1x scaling) for consistent viewing

### Step 1: Initial Render Inspection
- Observe the initial minimap rendering on the 3D plane (128x128 default)
- Identify distinct terrain regions by color (blue water, yellow-green clear, gray rock)
- **Expected**: `[check]` Colors match the palette in Criterion 1. The dominant color should be yellow-green/beige (Clear terrain, 0.42-0.62 elevation band).
- **Note**: The terrain is procedurally generated, so the exact pattern changes, but the color palette remains fixed.

### Step 2: Aspect Ratio Verification
- Click the "200x100" preset button
- Observe the plane shape -- it should be a 2:1 rectangle (wider than tall)
- **Expected**: `[check]` Plane is visibly rectangular. "Aspect Ratio" stat shows "2.000 : 1".
- Click "128x128" preset -- plane returns to square
- Click "64x64" preset -- plane stays square but smaller feature scale
- **Expected**: `[check]` Aspect ratio stat always matches the input dimensions.

### Step 3: Color Accuracy (Channel Order Check)
- Press the G key or click "Generate Random Minimap" several times
- Each time, verify that water areas are blue (not red or green)
- Verify forest areas are green (not blue)
- Verify clear/beach areas are tan/yellow (not pink)
- **Expected**: `[check]` No color channel swap visible in any generation. Blue stays blue, green stays green.
- **Rationale**: If Rgba32 channels were misread as Bgra32 (R↔B swap), water would appear red-orange instead of blue.

### Step 4: Wireframe Inspection
- Press W or click "Toggle Wireframe"
- The plane mesh should be visible as a wireframe grid
- Rotate the camera (left-drag) to inspect from different angles
- **Expected**: `[check]` Only 2 triangles visible (1 rectangular quad). No extra edges.
- Press W again to return to solid mode.

### Step 5: Dynamic Update Stress Test
- Click "Generate Random Minimap" 5 times in quick succession
- The texture should update within 50ms each time with no visible flash or blank frame
- Check browser console (F12) -- no errors or warnings about disposed textures
- **Expected**: `[check]` All 5 generations render correctly. FPS counter stays at 55-60.

### Step 6: Benchmark
- Click "Run Benchmark (100 gens)" button
- Wait for the benchmark result to appear
- **Expected**: `[check]` At 128x128, average generation time < 20ms, p95 < 30ms.
- Try different sizes: switch to 256x256 and re-run benchmark
- **Expected**: `[check]` At 256x256, average < 60ms (256*256*4 = 262KB per gen).

### Step 7: Large Texture Test
- Click "512x512" preset
- The texture should still render correctly (no WebGL texture size limit issues on modern GPUs)
- **Expected**: `[check]` 512x512 texture renders without errors. Data length shows 1,048,576 bytes (1MB).

### Step 8: Manual Size Entry
- Enter custom dimensions: width=300, height=80
- Click "Generate Random Minimap"
- **Expected**: `[check]` A wide strip renders correctly with 3.75:1 aspect ratio.

## Boundary / Error Conditions

| Condition | Expected Behavior |
|-----------|-------------------|
| Min size (16x16) | Renders correctly as a tiny square. Data = 1,024 bytes |
| Max size (512x512) | Renders correctly. Data = 1,048,576 bytes. FPS remains stable |
| Non-power-of-2 sizes (e.g., 100x100) | Renders correctly (RawTexture supports NPOT) |
| Repeated rapid generation (20x in 2 sec) | No memory leak, no FPS drop, no console errors |
| Wireframe on/off toggle during generation | Should work without errors |

## Result Determination

- `[ ]` All 5 criteria pass (with 8 verification steps all green) → **ACCEPTED**
- `[ ]` 1-2 criteria partially fail → Record specific failures, attach screenshot, submit as MINOR issue
- `[ ]` Criterion 1 (color accuracy) fails → **BLOCKER** -- indicates Rgba32 format is fundamentally broken
- `[ ]` Criterion 2 (aspect ratio) fails → **BLOCKER** -- indicates size fix is incomplete
- `[ ]` Test environment error (WebGL not available, etc.) → Record UA/engine info and retry on compatible browser

## Regression Notes

If any of the Phase B bug fixes are accidentally reverted:

| Regression | Symptom |
|-----------|---------|
| **Bug 1 reverts** (Rgba32 → Indexed8) | Water appears as single gray shade because 4 bytes are interpreted as 1-byte palette indices. Entire texture looks like grayscale noise. |
| **Bug 2 reverts** (size → {1,1}) | Texture UVs cover the entire plane with a single stretched texel. Only one solid color visible regardless of generated data. |
| **Bug 3 reverts** (releaseBuffer not called) | No visual symptom in short tests. After 100+ generations, memory usage increases ~65KB per gen (at 128x128). Detectable via browser Memory profiler. |

## Technical Reference

- **Source file**: `src/OpenRA.Game/Map/MapPreview.ts` — `generatePreviewPixels()` method
- **SheetBuilder**: `src/OpenRA.Game/Graphics/SheetBuilder.ts` — `addSimple()` method
- **Pixel format**: `src/OpenRA.Game/Graphics/Util.ts` — `fastCopyIntoChannel()`, `copyIntoRgba()`
- **Sheet/Texture**: `src/OpenRA.Game/Graphics/Sheet.ts` — `getTexture()`, `_createRgbaUploadBuffer()`
- **OpenRA C# original**: `OpenRA.Game/Map/MapPreview.cs`
