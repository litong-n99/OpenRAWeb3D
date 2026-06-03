# OpenRAWeb3D Migration Progress

> **Last updated**: 2026-06-03
> **Current phase**: Chapter 2 (Rendering Engine)
> **Overall status**: Rendering core complete, remaining modules are stubs

---

## Overall Stats

| Metric | Count |
|--------|-------|
| **Total files in rendering migration plan** | 27 |
| **Completed (full implementation + tests)** | 10 |
| **Stubs (placeholder files created)** | 17 |
| **Remaining modules beyond rendering** | Not yet planned |
| **Overall rendering completion** | 37% (10/27) |

---

## Rendering Engine (Chapter 2) Progress

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 10 | 37% |
| In Progress | 0 | 0% |
| Pending (stubs exist) | 17 | 63% |

### Detailed File Status

#### Completed (Full Implementation + Tests)

| # | File | Lines (impl) | Lines (test) | Test Cases | Reviewed |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | `src/OpenRA.Game/Renderer.ts` | 1106 | 782 | 89 | Yes |
| 2 | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | 1306 | 1104 | 74 | Yes |
| 3 | `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 835 | 642 | 55 | Pending |
| 4 | `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | 1012 | 858 | 68 | Yes |
| 5 | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | 407 | 118 | — | Yes |
| 6 | `src/OpenRA.Game/Graphics/ShaderBindings.ts` | 174 | 205 | — | Yes |
| 7 | `src/OpenRA.Game/Graphics/Vertex.ts` | 340 | 413 | — | Yes |
| 8 | `src/OpenRA.Platforms.Default/Shader.ts` | 417 | 572 | — | Yes |
| 9 | `src/glsl/combined.vert` | 108 | — | — | Yes |
| 10 | `src/glsl/combined.frag` | 345 | — | — | Yes |

#### Pending (Stubs Created)

| # | File | Migration Plan Reference | Complexity |
|:---:|:---|:---|:---:|
| 11 | `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.ts` | TODO-2.4.x | Low |
| 12 | `src/OpenRA.Game/Graphics/Util.ts` | — | Low |
| 13 | `src/OpenRA.Game/Graphics/RenderPostProcessPassVertex.ts` | — | Low |
| 14 | `src/OpenRA.Game/Graphics/Sprite.ts` | TODO-2.7.1 | Medium |
| 15 | `src/OpenRA.Game/Graphics/Sheet.ts` | TODO-2.7.2 | Low |
| 16 | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | TODO-2.7.3 | Low |
| 17 | `src/OpenRA.Game/Graphics/HardwarePalette.ts` | TODO-2.7.4 | High |
| 18 | `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` | TODO-2.7.5 | Medium |
| 19 | `src/OpenRA.Game/Graphics/Animation.ts` | TODO-2.7.6 | Medium |
| 20 | `src/OpenRA.Game/Graphics/CursorManager.ts` | TODO-2.7.7 | Low |
| 21 | `src/OpenRA.Game/Graphics/TerrainSpriteLayer.ts` | TODO-2.7.8 | High |
| 22 | `src/OpenRA.Platforms.Default/Texture.ts` | TODO-2.8.3 | Medium |
| 23 | `src/OpenRA.Platforms.Default/FrameBuffer.ts` | TODO-2.8.4 | Medium |
| 24 | `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | TODO-2.8.6 | Medium |
| 25 | `src/glsl/postprocess.vert` + postprocess `*.frag` | TODO-2.S3 | Low/Medium |
| 26 | `src/glsl/model.vert` / `model.frag` | TODO-2.S4 | Low |

> Note: Platform abstraction layer files not listed individually above (e.g., VertexBuffer.ts, StaticIndexBuffer.ts, Sdl2PlatformWindow.ts, Sdl2Input.ts, etc.) also exist as stubs. They are addressed by TODO-2.8.5 and TODO-2.8.6.

---

## By OpenRA Module

| OpenRA Module | Total Files | Done | Stubs | Empty Dirs |
|---------------|:-----------:|:----:|:-----:|:----------:|
| `OpenRA.Game/Graphics/` | 35 | 6 | 29 | 0 |
| `OpenRA.Game/` (root) | 1 | 1 | 0 | 0 |
| `OpenRA.Platforms.Default/` | 18 | 1 | 17 | 0 |
| `glsl/` | 12 | 2 | 10 | 0 |
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
| Unit tests | Vitest + happy-dom | 10 test files | Passing |
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
| `src/utils/math.test.ts` | — | — | Passing |
| `src/counter.test.ts` | — | — | Passing |

---

## Recent Completions

| Date | File | Developer | Reviewer | Notes |
|------|------|-----------|----------|-------|
| 2026-06-03 | Shader/Material System (6 files) | migration-develop | migration-review | 2 review rounds, 142 new tests, ShaderMaterial + GLSL |
| 2026-06-03 | RgbaColorRenderer.ts | migration-develop | migration-review | 3 review rounds, 68 test cases, dynamic Mesh + ShaderMaterial |
| 2026-06-03 | SpriteRenderer.ts | migration-develop | Pending | 55 test cases, ThinInstances backend |
| ~2026-06-02 | WorldRenderer.ts | migration-develop | migration-review | Reviewed, fixes applied |
| ~2026-06-01 | Renderer.ts | migration-develop | migration-review | Reviewed, 89 tests |

---

## Dependency Graph & Unblocked Items

### Currently Unblocked (Dependencies Satisfied)

Since Renderer.ts, WorldRenderer.ts, SpriteRenderer.ts, RgbaColorRenderer.ts, and the Shader/Material system are complete, the following are unblocked and ready for development:

1. **RgbaSpriteRenderer.ts** (Low) — depends on Renderer, Sprite-style API
2. **Util.ts** (Low) — independent, needed by many files
3. **HardwarePalette.ts** (High) — Shader system now complete, palette texture infrastructure available
4. **TerrainSpriteLayer.ts** (High) — Shader system now complete, custom ShaderMaterial available
5. **PlayerColorRemap.ts** (Medium) — Shader/Vertex infrastructure now available
6. **Sprite.ts, Sheet.ts, SheetBuilder.ts** — palette infrastructure now available
7. **Texture.ts, FrameBuffer.ts** (Medium) — Shader backend now complete
8. **RenderPostProcessPassVertex.ts** (Low) — independent postprocess vertex

### Blocked (Waiting on Dependencies)

1. **Animation.ts** (Medium) — blocked by Sprite/Sheet (needs sprite data structures)
2. **CursorManager.ts** (Low) — blocked by Sprite/Sheet for cursor sprites
3. **Postprocess GLSL files** (Low/Medium) — blocked by FrameBuffer (TODO-2.6.x)
4. **Sdl2GraphicsContext.ts** (Medium) — blocked by Texture/FrameBuffer platform layer

### Recommended Next Tasks (Priority Order)

| Priority | File | Reason |
|:--------:|------|--------|
| 1 | `HardwarePalette.ts` | Key RTS feature (palette system), unblocks all palette-dependent files |
| 2 | `Util.ts` | Utility used by almost every other file |
| 3 | `RgbaSpriteRenderer.ts` | Simple, low-risk file to increase completed count |
| 4 | `Texture.ts` | Platform texture backend, needed by Sprite/Sheet |
| 5 | `Sprite.ts` + `Sheet.ts` + `SheetBuilder.ts` | Core sprite infrastructure, unblocks Animation/CursorManager |

---

## Verification Notes (2026-06-03)

The migration plan's TODO statuses were verified against actual source files:

- **Migration plan accuracy**: The plan correctly shows Renderer, WorldRenderer, SpriteRenderer, RgbaColorRenderer, and Shader/Material System as completed. All other files are correctly marked as pending.
- **Stub files**: 17 files remain as 4-line placeholder stubs (file header + TODO comment). These are placeholders created to maintain the `src/` directory structure mirroring `OpenRA/`.
- **Empty directories**: All subdirectories under `src/OpenRA.Game/` (Activities, FileSystem, Map, Network, Orders, Scripting, Sound, Traits, Widgets, etc.) and `src/OpenRA.Mods.Cnc/` exist but contain no .ts files — these are beyond the current Chapter 2 (rendering engine) scope.
- **Test coverage**: 10 test files now exist (411 total test cases). No E2E test infrastructure is set up yet.
- **GLSL files**: combined.vert and combined.frag are now fully migrated (WebGL 2.0 / GLSL ES 3.0). The remaining 10 GLSL files (postprocess and model) are still stubs. The original OpenRA GLSL source is in `OpenRA/glsl/` for reference.
- **No missing files**: All files listed in the migration plan's mapping table (Section 2, items 1-27) have corresponding entries in `src/`.
