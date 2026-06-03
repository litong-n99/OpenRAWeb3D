# OpenRAWeb3D

Migrate the [OpenRA](https://github.com/OpenRA/OpenRA) 2D RTS game engine (C# / OpenGL 3.2 / SDL2) to a Web-based 3D engine using **TypeScript** and **Babylon.js**. The core paradigm shift: from imperative OpenGL programming to a declarative 3D scene graph.

## Project Status

**Phase**: Chapter 2 -- Rendering Engine (COMPLETE)
**Progress**: 27/27 rendering files complete (100%)
**Details**: [docs/migration_progress.md](docs/migration_progress.md)

| Module | Status |
|--------|--------|
| Renderer (main renderer) | Completed, reviewed |
| WorldRenderer (world scene) | Completed, reviewed |
| SpriteRenderer (batch sprites) | Completed |
| RgbaColorRenderer (RGBA color renderer) | Completed, reviewed |
| Shader / Material System (6 files) | Completed, reviewed |
| FrameBuffer & Post-Processing (10 files) | Completed, reviewed |
| Sprite & Texture System (8 core + 4 extra files) | Completed, reviewed |
| Platform Abstraction (11 files) | Completed, reviewed |
| RgbaSpriteRenderer (RGBA sprite batches) | Completed |
| Model shaders (model.vert/frag) | NOP stubs (fully documented) |
| Game logic, networking, audio, mod system | Not yet started |

## Directory Layout

```
OpenRA/                     ← Original C# source (READ-ONLY reference, NEVER modify)
  OpenRA.Game/              ← Core engine: Renderer, World, Actor, Graphics, Traits
  OpenRA.Platforms.Default/ ← Platform: Shader, Texture, FrameBuffer, SDL2 context
  OpenRA.Mods.Cnc/          ← C&C-specific mod code
  glsl/                     ← Original GLSL shaders (OpenGL 3.2 / GLSL 1.50)

src/                        ← TypeScript migration target (mirrors OpenRA/ structure)
  OpenRA.Game/              ← Core engine: Renderer.ts, Graphics/, Primitives/, etc.
    Renderer.ts             ← migrated (1128 lines, 89 tests)
    Primitives/
      Color.ts              ← migrated (272 lines, 319 test lines)
    Graphics/
      WorldRenderer.ts      ← migrated (1314 lines, 74 tests)
      SpriteRenderer.ts     ← migrated (835 lines, 55 tests)
      RgbaColorRenderer.ts  ← migrated (1012 lines, 68 tests)
      Sprite.ts             ← migrated (296 lines, 268 test lines)
      Sheet.ts              ← migrated (437 lines, 351 test lines)
      SheetBuilder.ts       ← migrated (502 lines, 367 test lines)
      HardwarePalette.ts    ← migrated (658 lines, 463 test lines)
      PlayerColorRemap.ts   ← migrated (154 lines, 191 test lines)
      Animation.ts          ← migrated (558 lines, 451 test lines)
      CursorManager.ts      ← migrated (548 lines, 288 test lines)
      TerrainSpriteLayer.ts ← migrated (631 lines, 346 test lines)
      RgbaSpriteRenderer.ts ← migrated (161 lines, 462 test lines)
      Palette.ts            ← migrated (477 lines, 381 test lines)
      PaletteReference.ts   ← migrated (91 lines, 89 test lines)
      Util.ts               ← migrated (558 lines, 511 test lines)
      *.ts                  ← 16 remaining stubs (beyond Chapter 2 scope)
  OpenRA.Platforms.Default/ ← Platform abstraction (6 migrated, 7 NOP, 5 stubs)
      Shader.ts             ← migrated (417 lines, 572 test lines)
      FrameBuffer.ts        ← migrated (415 lines, 649 test lines)
      Texture.ts            ← migrated (526 lines, 61 shared tests)
      VertexBuffer.ts       ← migrated (375 lines, 61 shared tests)
      StaticIndexBuffer.ts  ← migrated (174 lines, 61 shared tests)
      ITextureInternal.ts   ← migrated (49 lines)
      Sdl2*.ts (4 files)    ← NOP stubs (browser API replacement)
  glsl/                     ← Migrated GLSL shaders (WebGL 2.0 / GLSL ES 3.0)
                              ← model.vert/frag NOP stubs (StandardMaterial/PBRMaterial)
  assets/                   ← Static assets
  utils/                    ← Shared utilities

.claude/
  agents/
    migration-architect.md   ← Architect agent spec
    migration-develop.md     ← Developer agent spec
    migration-review.md      ← Code review agent spec
    migration-docs.md        ← Documentation manager agent spec
  teams/
    openra-migration/        ← Reusable team configuration template

docs/
  openra_migration.agent.final.converted.md   ← Comprehensive architecture analysis (~199KB)
  rendering_migration_plan.md                 ← Chapter 2 rendering plan with TODO checklist
  migration_progress.md                       ← Overall progress tracker with dependency graph
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | ~6.0 |
| 3D Engine | Babylon.js (`@babylonjs/core`) | ^9.10.1 |
| Build/Bundler | Vite | ^8.0.12 |
| Unit Testing | Vitest + happy-dom | ^4.1.8 / ^20.9.0 |
| Modules | ESM (`"type": "module"`) | — |
| Target | ES2023 | — |
| TS Config | `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` |

## Key Paradigm Mappings

| OpenRA (C# / OpenGL) | Babylon.js (TypeScript / WebGL) |
|----------------------|---------------------------------|
| `Renderer.BeginFrame/EndFrame` | `Engine.runRenderLoop()` |
| Dual FBO (`worldBuffer/screenBuffer`) | `RenderTargetTexture` + dual `Scene` |
| `SpriteRenderer` batch rendering | `ThinInstances` / `SpriteManager` |
| `HardwarePalette` (256xN texture) | `RawTexture` + custom `ShaderMaterial` |
| `WorldRenderer.Draw()` 6 phases | `renderingGroupId` layers + `Scene.render()` |
| `IShader.SetVec/SetTexture` | `ShaderMaterial.setVector3/setTexture` |
| `Vertex` 48-byte struct | `VertexData` multi-array |
| `Util.PremultiplyAlpha()` | `material.alphaMode = ALPHA_PREMULTIPLIED` |
| CPU vertex computation + inline types | Babylon.js dynamic Mesh + ShaderMaterial |
| `Sheet` (texture atlas / sprite sheet) | `BABYLON.Texture` / `RawTexture` with UV sub-regions |
| `Sprite` (single sprite from sheet) | `MeshBuilder.CreatePlane()` + custom UV offset/scale |
| `SheetBuilder` (runtime packing) | Build-time `maxrects-packer` / TexturePacker |
| `IPalette` / `ImmutablePalette` / `MutablePalette` | `Uint32Array` + custom TypeScript interface (indexer -> `at()` method) |
| `PlayerColorRemap` (HSV recolor) | GPU uniform lookup via 256x1 `RawTexture` |
| `Animation` (frame-based sprite anim) | `mesh.updateVerticesData("uv", ...)` frame swap + 25fps tick |
| `CursorManager` (hardware cursor) | CSS `cursor: url(...)` / HTML overlay element |
| `TerrainSpriteLayer` (large terrain grid) | Single large-plane `Mesh` + `updateVerticesData()` dirty-row update |
| `PaletteReference` (weak palette link) | TypeScript class with getter + setter (no `internal` keyword) |
| `RenderPostProcessPassVertex` (postprocess vertex) | Babylon.js `PostProcess` auto-generates fullscreen quad |

## Agent Team Structure

The project uses four specialized agents defined in `.claude/agents/`:

| Agent | Spec File | Role |
|-------|-----------|------|
| **migration-architect** | `migration-architect.md` | Overall design, scaffolding, CI/CD, tech decisions, dependency management |
| **migration-develop** | `migration-develop.md` | TypeScript/Babylon.js implementation with unit tests |
| **migration-review** | `migration-review.md` | Code review across 5 dimensions: docs compliance, feature completeness, efficiency, bugs, format |
| **migration-docs** | `migration-docs.md` | Documentation maintenance, progress tracking, task coordination, commit |

### Agent Communication

Agents communicate via `SendMessage` tool calls. **Team Lead handles all coordination** (merged with manager role):

```
Architect → Developer → Reviewer → Docs Manager → Team Lead (routing)
```

### Agent Rules

**Team Lead must NOT modify code files.** The Team Lead cannot directly edit any source files (`.ts` / `.test.ts` / `.json` / `.css` / `.html`). They can only:

- Read files to understand project state
- Send tasks to sub-agents via `SendMessage`
- Route questions and feedback to the appropriate sub-agent
- Commit documentation updates that sub-agents have staged but cannot commit due to sandbox restrictions

Sub-agents (Architect, Developer, Reviewer, Docs Manager) have full read/write access to the files within their domain.

## Development Workflow

### Migration Pipeline (per file)

1. **Team Lead** assigns task to Architect (if design needed) or Developer
2. **Architect** (if needed): analyzes OpenRA source, writes design spec, updates migration plan
3. **Developer**: reads OpenRA source + migration docs, implements TypeScript + unit tests, self-reviews
4. **Reviewer**: reviews across 5 dimensions (docs compliance, feature completeness, efficiency, bugs, format), assigns severity (BLOCKER/MAJOR/MINOR/INFO)
5. **Developer**: fixes review findings, resubmits (may require multiple rounds)
6. **Docs Manager**: on APPROVED, updates all documentation (migration plan TODOs, progress tracker, README, architecture doc) and commits

### Project Conventions

- **OpenRA/ is read-only** — original C# source is for reference only, never modify it
- **Directory parity** — `src/` paths must mirror `OpenRA/` paths for all migrated files
- **ESM only** — all code uses ES modules
- **Babylon.js tree-shaking** — import from `@babylonjs/core`, not the legacy barrel export
- **Mock Babylon.js in unit tests** — happy-dom has no WebGL, all `@babylonjs/core` imports must be mocked
- **Dispose pattern** — any class creating GPU resources must implement `dispose()`
- **No per-frame allocation** — hot-path code must reuse objects
- **File header required** — every migrated `.ts` file must have a header with OpenRA file reference and paradigm mapping notes

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run unit tests
npm test

# Type-check
npx tsc --noEmit
```

## Key Documentation

| Document | Description |
|----------|-------------|
| [docs/rendering_migration_plan.md](docs/rendering_migration_plan.md) | Chapter 2 rendering engine migration plan with TODO checklist and file mapping table (27 migration items, 26 unique files) |
| [docs/openra_migration.agent.final.converted.md](docs/openra_migration.agent.final.converted.md) | Comprehensive OpenRA architecture analysis (~199KB) covering rendering, actor system, networking, resources |
| [docs/migration_progress.md](docs/migration_progress.md) | Overall migration progress tracker with file statuses, dependency graph, and recommended next tasks |
| [CLAUDE.md](CLAUDE.md) | This file — project overview, agent team structure, and development workflow |

## License

This project is based on [OpenRA](https://github.com/OpenRA/OpenRA), which is licensed under GPL-3.0.
