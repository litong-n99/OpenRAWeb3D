# OpenRAWeb3D Migration Progress

> **Last updated**: 2026-06-03
> **Current phase**: Chapter 2 (Rendering Engine)
> **Overall status**: Rendering core complete, remaining modules are stubs

---

## Overall Stats

| Metric | Count |
|--------|-------|
| **Total files in rendering migration plan** | 26 |
| **Completed (full implementation + tests)** | 4 |
| **Stubs (placeholder files created)** | 22 |
| **Remaining modules beyond rendering** | Not yet planned |
| **Overall rendering completion** | 15% (4/26) |

---

## Rendering Engine (Chapter 2) Progress

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 4 | 15% |
| In Progress | 0 | 0% |
| Pending (stubs exist) | 22 | 85% |

### Detailed File Status

#### Completed (Full Implementation + Tests)

| # | File | Lines (impl) | Lines (test) | Test Cases | Reviewed |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | `src/OpenRA.Game/Renderer.ts` | 1106 | 782 | 89 | Yes |
| 2 | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | 1306 | 1104 | 74 | Yes |
| 3 | `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 835 | 642 | 55 | Pending |
| 4 | `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | 1012 | 858 | 51 | Yes |

#### Pending (Stubs Created)

| # | File | Migration Plan Reference | Complexity |
|:---:|:---|:---|:---:|
| 5 | `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.ts` | TODO-2.4.x | Low |
| 6 | `src/OpenRA.Game/Graphics/Vertex.ts` | TODO-2.5.4 | Medium |
| 7 | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | TODO-2.5.1, TODO-2.8.1 | High/Medium |
| 8 | `src/OpenRA.Game/Graphics/Util.ts` | — | Low |
| 9 | `src/OpenRA.Game/Graphics/RenderPostProcessPassVertex.ts` | — | Low |
| 10 | `src/OpenRA.Game/Graphics/Sprite.ts` | TODO-2.7.1 | Medium |
| 11 | `src/OpenRA.Game/Graphics/Sheet.ts` | TODO-2.7.2 | Low |
| 12 | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | TODO-2.7.3 | Low |
| 13 | `src/OpenRA.Game/Graphics/HardwarePalette.ts` | TODO-2.7.4 | High |
| 14 | `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` | TODO-2.7.5 | Medium |
| 15 | `src/OpenRA.Game/Graphics/Animation.ts` | TODO-2.7.6 | Medium |
| 16 | `src/OpenRA.Game/Graphics/CursorManager.ts` | TODO-2.7.7 | Low |
| 17 | `src/OpenRA.Game/Graphics/TerrainSpriteLayer.ts` | TODO-2.7.8 | High |
| 18 | `src/OpenRA.Platforms.Default/Shader.ts` | TODO-2.8.2 | High |
| 19 | `src/OpenRA.Platforms.Default/Texture.ts` | TODO-2.8.3 | Medium |
| 20 | `src/OpenRA.Platforms.Default/FrameBuffer.ts` | TODO-2.8.4 | Medium |
| 21 | `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | TODO-2.8.6 | Medium |
| 22 | `src/glsl/combined.vert` | TODO-2.S1 | High |
| 23 | `src/glsl/combined.frag` | TODO-2.S2 | High |
| 24 | `src/glsl/postprocess.vert` + postprocess `*.frag` | TODO-2.S3 | Low/Medium |
| 25 | `src/glsl/model.vert` / `model.frag` | TODO-2.S4 | Low |

> Note: Platform abstraction layer files not listed individually above (e.g., VertexBuffer.ts, StaticIndexBuffer.ts, Sdl2PlatformWindow.ts, Sdl2Input.ts, etc.) also exist as stubs. They are addressed by TODO-2.8.5 and TODO-2.8.6.

---

## By OpenRA Module

| OpenRA Module | Total Files | Done | Stubs | Empty Dirs |
|---------------|:-----------:|:----:|:-----:|:----------:|
| `OpenRA.Game/Graphics/` | 35 | 3 | 32 | 0 |
| `OpenRA.Game/` (root) | 1 | 1 | 0 | 0 |
| `OpenRA.Platforms.Default/` | 18 | 0 | 18 | 0 |
| `glsl/` | 12 | 0 | 12 | 0 |
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
| Unit tests | Vitest + happy-dom | 5 test files | Passing |
| E2E tests | Playwright | 0 | Not yet configured |

### Existing Test Files

| Test File | Lines | Test Cases | Status |
|-----------|:-----:|:----------:|--------|
| `src/OpenRA.Game/Renderer.test.ts` | 782 | 89 | Passing |
| `src/OpenRA.Game/Graphics/WorldRenderer.test.ts` | 1104 | 74 | Passing |
| `src/OpenRA.Game/Graphics/SpriteRenderer.test.ts` | 642 | 55 | Passing |
| `src/utils/math.test.ts` | — | — | Passing |
| `src/counter.test.ts` | — | — | Passing |

---

## Recent Completions

| Date | File | Developer | Reviewer | Notes |
|------|------|-----------|----------|-------|
| 2026-06-03 | RgbaColorRenderer.ts | migration-develop | migration-review | 2 review rounds, 51 test cases, GUI/lines |
| 2026-06-03 | SpriteRenderer.ts | migration-develop | Pending | 55 test cases, ThinInstances backend |
| ~2026-06-02 | WorldRenderer.ts | migration-develop | migration-review | Reviewed, fixes applied |
| ~2026-06-01 | Renderer.ts | migration-develop | migration-review | Reviewed, 89 tests |

---

## Dependency Graph & Unblocked Items

### Currently Unblocked (Dependencies Satisfied)

Since Renderer.ts, WorldRenderer.ts, SpriteRenderer.ts, and RgbaColorRenderer.ts are complete, the following are unblocked and ready for development:

1. **RgbaSpriteRenderer.ts** (Low) — depends on Renderer, Sprite-style API
2. **Vertex.ts** (Medium) — independent, needed by Shader system
3. **Util.ts** (Low) — independent, needed by many files

### Blocked (Waiting on Dependencies)

1. **HardwarePalette.ts** (High) — blocked by Shader system (TODO-2.5.x)
2. **TerrainSpriteLayer.ts** (High) — blocked by Shader system
3. **PlayerColorRemap.ts** (Medium) — blocked by HardwarePalette/Shader
4. **Shader.ts** (High) — blocked by GLSL migration and Vertex system
5. **All GLSL files** (High) — blocked by Shader/Vertex infrastructure
6. **Sprite.ts, Sheet.ts, SheetBuilder.ts** — blocked by HardwarePalette/Shader for palette support

### Recommended Next Tasks (Priority Order)

| Priority | File | Reason |
|:--------:|------|--------|
| 1 | `Vertex.ts` | Foundation for Shader/VertexBuffer system |
| 2 | `Util.ts` | Utility used by almost every other file |
| 3 | `PlatformInterfaces.ts` | Interface definitions needed by platform layer |
| 4 | `Shader.ts` + GLSL files | Core shader infrastructure, unblocks palette/sprite/tiles |
| 5 | `HardwarePalette.ts` | Key RTS feature, unblocks palette-dependent files |

---

## Verification Notes (2026-06-03)

The migration plan's TODO statuses were verified against actual source files:

- **Migration plan accuracy**: The plan correctly shows Renderer, WorldRenderer, and SpriteRenderer as completed. All other files are correctly marked as pending.
- **Stub files**: 23+ files exist as 4-line placeholder stubs (file header + TODO comment). These are placeholders created to maintain the `src/` directory structure mirroring `OpenRA/`.
- **Empty directories**: All subdirectories under `src/OpenRA.Game/` (Activities, FileSystem, Map, Network, Orders, Scripting, Sound, Traits, Widgets, etc.) and `src/OpenRA.Mods.Cnc/` exist but contain no .ts files — these are beyond the current Chapter 2 (rendering engine) scope.
- **Test coverage**: Only the 3 completed files have unit tests. No E2E test infrastructure is set up yet.
- **GLSL files**: All 12 GLSL files are stubs. The original OpenRA GLSL source is in `OpenRA/glsl/` for reference.
- **No missing files**: All files listed in the migration plan's mapping table (Section 2, items 1-26) have corresponding entries in `src/`.
