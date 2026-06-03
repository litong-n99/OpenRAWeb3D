# OpenRAWeb3D Migration Progress

> **Last updated**: 2026-06-03
> **Current phase**: Chapter 2 (Rendering Engine)
> **Overall status**: Platform abstraction layer complete, 93% rendering complete

---

## Overall Stats

| Metric | Count |
|--------|-------|
| **Total files in rendering migration plan** | 27 |
| **Completed (full implementation + tests)** | 24 |
| **Completed without tests (implemented, no test file)** | 1 |
| **NOP stubs (intentional omissions, documented)** | 1 |
| **Stubs (placeholder files, pending migration)** | 1 |
| **Remaining modules beyond rendering** | Not yet planned |
| **Overall rendering completion** | 93% (25/27; +1 NOP) |

> **Note**: 7 additional platform files are documented as NOP stubs (SDL2 replacement by browser APIs). Plus 3 newly migrated core wrappers (VertexBuffer, StaticIndexBuffer, ITextureInternal) and 4 previously migrated extra files (Util, Palette, PaletteReference, Color) go beyond the original 27-item plan. Only 1 rendering file (RgbaSpriteRenderer) and 2 model shaders remain as stubs.

---

## Rendering Engine (Chapter 2) Progress

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 24 | 89% |
| Completed (no test) | 1 | 4% |
| NOP (intentional omission) | 1 | 4% |
| Pending (stubs exist) | 1 | 4% |

### Detailed File Status

#### Completed (Full Implementation + Tests)

| # | File | Lines (impl) | Lines (test) | Test Cases | Reviewed |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | `src/OpenRA.Game/Renderer.ts` | 1128 | 782 | 89 | Yes |
| 2 | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | 1314 | 1104 | 74 | Yes |
| 3 | `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 835 | 642 | 55 | Pending |
| 4 | `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | 1012 | 858 | 68 | Yes |
| 5 | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | 407 | 118 | — | Yes |
| 6 | `src/OpenRA.Game/Graphics/ShaderBindings.ts` | 174 | 205 | — | Yes |
| 7 | `src/OpenRA.Game/Graphics/Vertex.ts` | 340 | 413 | — | Yes |
| 8 | `src/OpenRA.Platforms.Default/Shader.ts` | 417 | 572 | — | Yes |
| 9 | `src/glsl/combined.vert` | 108 | — | — | Yes |
| 10 | `src/glsl/combined.frag` | 345 | — | — | Yes |
| 11 | `src/OpenRA.Platforms.Default/FrameBuffer.ts` | 415 | 649 | 58 | Yes |
| 12 | `src/glsl/postprocess.vert` + 7 `*.frag` shaders | 269 | — | — | Yes |
| 13 | `src/OpenRA.Game/Graphics/Sprite.ts` | 296 | 268 | — | Yes |
| 14 | `src/OpenRA.Game/Graphics/Sheet.ts` | 437 | 351 | — | Yes |
| 15 | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | 502 | 367 | — | Yes |
| 16 | `src/OpenRA.Game/Graphics/HardwarePalette.ts` | 658 | 463 | — | Yes |
| 17 | `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` | 154 | 191 | — | Yes |
| 18 | `src/OpenRA.Game/Graphics/Animation.ts` | 558 | 451 | — | Yes |
| 19 | `src/OpenRA.Game/Graphics/CursorManager.ts` | 548 | 288 | — | Yes |
| 20 | `src/OpenRA.Game/Graphics/TerrainSpriteLayer.ts` | 631 | 346 | — | Yes |
| 21 | `src/OpenRA.Platforms.Default/Texture.ts` | 526 | 485 | 61 (shared) | Yes |
| 22 | `src/OpenRA.Platforms.Default/VertexBuffer.ts` | 375 | 341 | 61 (shared) | Yes |
| 23 | `src/OpenRA.Platforms.Default/StaticIndexBuffer.ts` | 174 | 149 | 61 (shared) | Yes |

> **Note**: Texture.ts, VertexBuffer.ts, and StaticIndexBuffer.ts share 61 test cases across 3 test files (Texture.test.ts: ~485 lines, VertexBuffer.test.ts: ~341 lines, StaticIndexBuffer.test.ts: ~149 lines).

#### Completed (Implementation, No Test File)

| # | File | Lines (impl) | Migration Plan Reference | Reviewed |
|:---:|:---|:---:|:---|:---:|
| 24 | `src/OpenRA.Game/Graphics/RenderPostProcessPassVertex.ts` | 142 | — | Pending |
| 25 | `src/OpenRA.Platforms.Default/ITextureInternal.ts` | 49 | — | Yes |

#### Additional Migrated Files (Beyond Migration Plan 27)

| # | File | Lines (impl) | Lines (test) | Reviewed |
|:---:|:---|:---:|:---:|:---:|
| A1 | `src/OpenRA.Game/Graphics/Util.ts` | 558 | 511 | Yes |
| A2 | `src/OpenRA.Game/Graphics/Palette.ts` | 477 | 381 | Yes |
| A3 | `src/OpenRA.Game/Graphics/PaletteReference.ts` | 91 | 89 | Yes |
| A4 | `src/OpenRA.Game/Primitives/Color.ts` | 272 | 319 | Yes |

> **Note**: Files A1–A4 were migrated alongside Section 3.7 as dependencies/enablers. They are not tracked in the original 27-item migration plan but are now fully implemented with tests.

#### NOP Stubs (Intentional Omissions — Documented)

These files are retained to preserve directory structure parity with OpenRA but contain no migrated code. Each file documents why migration is unnecessary (browser APIs / Babylon.js replace the functionality).

| # | File | Lines | Reason |
|:---:|:---|:---:|:---|
| N1 | `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | 29 | Babylon.js Engine auto-creates WebGL 2.0 context |
| N2 | `src/OpenRA.Platforms.Default/Sdl2PlatformWindow.ts` | 27 | HTMLCanvasElement + Fullscreen API |
| N3 | `src/OpenRA.Platforms.Default/Sdl2Input.ts` | 29 | DeviceSourceManager + Observable |
| N4 | `src/OpenRA.Platforms.Default/Sdl2HardwareCursor.ts` | 28 | CSS `cursor: url(...)` |
| N5 | `src/OpenRA.Platforms.Default/DefaultPlatform.ts` | 4 | Browser platform detection |
| N6 | `src/OpenRA.Platforms.Default/ThreadAffine.ts` | 19 | Web Worker model (no shared memory) |
| N7 | `src/OpenRA.Platforms.Default/OpenGL.ts` | 26 | Babylon.js thin abstraction layer |

> **Note**: These 7 NOP stubs replace SDL2 and OpenGL-specific platform code. They are counted in the 27-item plan as "handled" (1 NOP = `Sdl2GraphicsContext.ts`, item #22). The remaining 6 are beyond the 27-item plan.

#### Remaining Pending Stubs

| # | File | Migration Plan Reference | Complexity |
|:---:|:---|:---|:---:|
| P1 | `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.ts` | TODO-2.4.x | Low |
| P2 | `src/glsl/model.vert` / `model.frag` | TODO-2.S4 | Low |

> Note: These 2 items are the only remaining stubs in the rendering engine. Audio stubs (DummySoundEngine.ts, OpenAlSoundEngine.ts, MultiTapDetection.ts), font stubs (FreeTypeFont.ts), and other platform stubs (ThreadedGraphicsContext.ts) remain as 4-line placeholders beyond Chapter 2 scope.

---

## By OpenRA Module

| OpenRA Module | Total Files | Done | Stubs | Empty Dirs |
|---------------|:-----------:|:----:|:-----:|:----------:|
| `OpenRA.Game/Graphics/` | 37 | 18 | 19 | 0 |
| `OpenRA.Game/` (root) | 2 | 2 | 0 | 0 |
| `OpenRA.Game/Primitives/` | 1 | 1 | 0 | 0 |
| `OpenRA.Platforms.Default/` | 18 | 6 | 12 | 0 |
| `glsl/` | 12 | 10 | 2 | 0 |
| `OpenRA.Game/Traits/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Activities/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Network/` | 0 | 0 | 0 | All |
| `OpenRA.Game/FileSystem/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Map/` | 0 | 0 | 0 | All |
| `OpenRA.Mods.Cnc/` | 0 | 0 | 0 | All |
| Other modules | 0 | 0 | 0 | All |

---

## Test Infrastructure

| Test Type | Framework | Files | Status |
|-----------|-----------|:-----:|--------|
| Unit tests | Vitest + happy-dom | 26 test files | 23 pass, 3 with failures |
| E2E tests | Playwright | 0 | Not yet configured |

### Existing Test Files

| Test File | Lines | Test Cases | Status |
|-----------|:-----:|:----------:|--------|
| `src/OpenRA.Game/Renderer.test.ts` | 782 | 89 | Passing |
| `src/OpenRA.Game/Graphics/WorldRenderer.test.ts` | 1104 | 74 | Passing |
| `src/OpenRA.Game/Graphics/SpriteRenderer.test.ts` | 642 | 55 | Passing |
| `src/OpenRA.Game/Graphics/RgbaColorRenderer.test.ts` | 858 | 68 | Passing |
| `src/OpenRA.Game/Graphics/PlatformInterfaces.test.ts` | 118 | — | Passing |
| `src/OpenRA.Game/Graphics/ShaderBindings.test.ts` | 205 | — | Passing |
| `src/OpenRA.Game/Graphics/Vertex.test.ts` | 413 | — | Passing |
| `src/OpenRA.Platforms.Default/Shader.test.ts` | 572 | — | Passing |
| `src/OpenRA.Platforms.Default/FrameBuffer.test.ts` | 649 | 58 | Passing |
| `src/OpenRA.Platforms.Default/Texture.test.ts` | 485 | 61 (shared) | Passing |
| `src/OpenRA.Platforms.Default/VertexBuffer.test.ts` | 341 | 61 (shared) | Passing |
| `src/OpenRA.Platforms.Default/StaticIndexBuffer.test.ts` | 149 | 61 (shared) | Passing |
| `src/OpenRA.Game/Graphics/Sprite.test.ts` | 268 | — | Passing |
| `src/OpenRA.Game/Graphics/Sheet.test.ts` | 351 | — | Failures (3) |
| `src/OpenRA.Game/Graphics/SheetBuilder.test.ts` | 367 | — | Passing |
| `src/OpenRA.Game/Graphics/HardwarePalette.test.ts` | 463 | — | Passing |
| `src/OpenRA.Game/Graphics/PlayerColorRemap.test.ts` | 191 | — | Passing |
| `src/OpenRA.Game/Graphics/Animation.test.ts` | 451 | — | Passing |
| `src/OpenRA.Game/Graphics/CursorManager.test.ts` | 288 | — | Passing |
| `src/OpenRA.Game/Graphics/TerrainSpriteLayer.test.ts` | 346 | — | Failures (4) |
| `src/OpenRA.Game/Graphics/Util.test.ts` | 511 | — | Failures (2) |
| `src/OpenRA.Game/Graphics/Palette.test.ts` | 381 | — | Passing |
| `src/OpenRA.Game/Graphics/PaletteReference.test.ts` | 89 | — | Passing |
| `src/OpenRA.Game/Primitives/Color.test.ts` | 319 | — | Passing |
| `src/utils/math.test.ts` | — | — | Passing |
| `src/counter.test.ts` | — | — | Passing |

> **Note**: 3 test files have failures (Sheet.test.ts: 3, TerrainSpriteLayer.test.ts: 4, Util.test.ts: 2). These are recorded as post-migration fixes needed.

---

## Recent Completions

| Date | File | Developer | Reviewer | Notes |
|------|------|-----------|----------|-------|
| 2026-06-03 | Platform Abstraction (Section 3.8) — 11 files | migration-develop | migration-review | 3 review rounds, 1068 lines impl, 61 tests, 7 NOP stubs, core wrappers + SDL2 removal |
| 2026-06-03 | Sprite & Texture System (Section 3.7) — 12 files | migration-develop | migration-review | 2 review rounds, ~4900 lines impl, 12 test files, 252 new tests, Palette + Sprite/Sheet + Animation + TerrainLayer |
| 2026-06-03 | FrameBuffer & Post-Processing (Section 3.6) | migration-develop | migration-review | 2 review rounds, 58 tests, 8 GLSL shaders, RTT + DefaultRenderingPipeline |
| 2026-06-03 | Shader/Material System (6 files) | migration-develop | migration-review | 2 review rounds, 142 new tests, ShaderMaterial + GLSL |
| 2026-06-03 | RgbaColorRenderer.ts | migration-develop | migration-review | 3 review rounds, 68 test cases, dynamic Mesh + ShaderMaterial |
| 2026-06-03 | SpriteRenderer.ts | migration-develop | Pending | 55 test cases, ThinInstances backend |
| ~2026-06-02 | WorldRenderer.ts | migration-develop | migration-review | Reviewed, fixes applied |
| ~2026-06-01 | Renderer.ts | migration-develop | migration-review | Reviewed, 89 tests |

---

## Dependency Graph & Unblocked Items

### Section 3.8 Unlocks

With Texture, VertexBuffer, StaticIndexBuffer, ITextureInternal, and platform NOP stubs now complete:
- **All rendering core files now have full platform backend support**
- **RgbaSpriteRenderer.ts** — no longer blocked; all platform texture/buffer infrastructure complete

### Currently Unblocked (Dependencies Satisfied)

1. **RgbaSpriteRenderer.ts** (Low) — depends on Renderer + Sprite-style API; all dependencies satisfied
2. **model.vert / model.frag** (Low) — replaceable with Babylon.js StandardMaterial
3. **RenderPostProcessPassVertex.ts** — already implemented (142 lines), review pending

### Remaining Pending Items

| Priority | File | Reason |
|:--------:|------|--------|
| 1 | `RgbaSpriteRenderer.ts` | Only remaining rendering code file; simple, low-risk |
| 2 | `model.vert` / `model.frag` | Model shader stubs, replaceable with StandardMaterial |
| 3 | Graphics/ stubs (AnimationWithOffset, ChromeProvider, CursorSequence, etc.) | Beyond Chapter 2 core rendering |

---

## Verification Notes (2026-06-03)

The migration plan's TODO statuses were verified against actual source files:

- **Migration plan accuracy**: The plan correctly shows all 8 sections (3.1–3.8) as completed. Only RgbaSpriteRenderer.ts (TODO-2.4.x) and model.vert/model.frag (TODO-2.S4) remain as pending stubs.
- **Section 3.8 completion**: Platform abstraction layer fully migrated. 3 core wrapper files (Texture.ts: 526 lines, VertexBuffer.ts: 375 lines, StaticIndexBuffer.ts: 174 lines) with 61 shared tests. 1 interface file (ITextureInternal.ts: 49 lines). 7 SDL2/platform files converted to NOP stubs with documentation explaining browser API alternatives.
- **RenderPostProcessPassVertex.ts**: Implemented (142 lines), no test file. Reclassified as "Completed (Implementation, No Test File)."
- **Additional files**: Utils (558 lines), Palette (477 lines), PaletteReference (91 lines), Color (272 lines), VertexBuffer (375 lines), StaticIndexBuffer (174 lines), ITextureInternal (49 lines) — 7 files beyond the original 27-item migration plan.
- **NOP stubs**: 7 SDL2/platform files (Sdl2GraphicsContext, Sdl2PlatformWindow, Sdl2Input, Sdl2HardwareCursor, DefaultPlatform, ThreadAffine, OpenGL) are intentionally retained as documented NOP stubs rather than removed, preserving directory parity with OpenRA.
- **Stub files**: ~17 files in `OpenRA.Game/Graphics/` and ~12 in `OpenRA.Platforms.Default/` remain as 4-line placeholder stubs. Audio stubs (DummySoundEngine, OpenAlSoundEngine, MultiTapDetection), font stubs (FreeTypeFont), and other platform stubs (ThreadedGraphicsContext) are beyond Chapter 2 scope.
- **Empty directories**: All subdirectories under `src/OpenRA.Game/` (Activities, FileSystem, Map, Network, Orders, Scripting, Sound, Traits, Widgets, etc.) and `src/OpenRA.Mods.Cnc/` exist but contain no .ts files — these are beyond the current Chapter 2 (rendering engine) scope.
- **Test coverage**: 26 test files now exist. 3 test files with known issues (Sheet.test.ts: 3, TerrainSpriteLayer.test.ts: 4, Util.test.ts: 2). No E2E test infrastructure is set up yet.
- **GLSL files**: combined.vert, combined.frag, and 8 postprocess shaders are fully migrated (WebGL 2.0 / GLSL ES 3.0). Only 2 model GLSL files remain as stubs.
- **No missing files**: All files listed in the migration plan's mapping table (Section 2, items 1-27) have corresponding entries in `src/`.
