# OpenRAWeb3D

Migrate the [OpenRA](https://github.com/OpenRA/OpenRA) 2D RTS game engine (C# / OpenGL 3.2 / SDL2) to a Web-based 3D engine using **TypeScript** and **Babylon.js**. The core paradigm shift: from imperative OpenGL programming to a declarative 3D scene graph.

## Project Status

**Phase**: Chapter 4 (Map & Terrain System) -- Phase C complete (12/34, 35%)
**Progress**: 27/27 rendering (100%), Chapter 3: 36/36 (100%), Chapter 4: 12/34 (35%)
**Details**: [docs/migration_progress.md](docs/migration_progress.md)

| Module | Status |
|--------|--------|
| **Rendering Engine (27 files)** | COMPLETE (100%) |
| Renderer (main renderer) | Completed, reviewed |
| WorldRenderer (world scene) | Completed, reviewed |
| SpriteRenderer (batch sprites) | Completed |
| RgbaColorRenderer (RGBA color renderer) | Completed, reviewed |
| Shader / Material System (6 files) | Completed, reviewed |
| FrameBuffer & Post-Processing (10 files) | Completed, reviewed |
| Sprite & Texture System (8 core + 4 extra files) | Completed, reviewed |
| Platform Abstraction (11 files) | Completed, reviewed |
| **Actor System (36 files)** | COMPLETE (100%) |
| **Map & Terrain System (34 files)** | **Phase B: 11/34 (32%), COMPLETE** |
| CellLayer Infrastructure (8 files) | COMPLETE, 195/195 tests, 2 review rounds |
| MapGrid + CellRamp (2+2 files) | COMPLETE, 138 tests, 1 review round |
| TerrainInfo / TileSet (1 file) | COMPLETE, 93 tests, 2 review rounds |
| Remaining Map System (22 files) | Pending |
| Game logic, networking, audio, mod system | Not yet started

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
    Int32Matrix4x4.ts     ← migrated (120 lines, 5 tests) -- Phase A support
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
    WPos.ts               ← migrated (180 lines, 24 tests) -- Phase A 3.1.1
    WVec.ts               ← migrated (230 lines, 35 tests) -- Phase A 3.1.1
    WAngle.ts             ← migrated (270 lines, 54 tests) -- Phase A 3.1.1
    WDist.ts              ← migrated (170 lines, 32 tests) -- Phase A 3.1.1
    WRot.ts               ← migrated (310 lines, 32 tests) -- Phase A 3.1.1
    Exts.ts               ← migrated (67 lines, 10 tests) -- Phase A support + isqrtCeiling (Phase B)
    CVec.ts               ← migrated (271 lines, 40 tests) -- hashCode added Phase B
    Map/                    ← Chapter 4: Map & Terrain System (3/34 基础 + 8/8 Phase A + 2/2 Phase B = 11/34, 32%)
      MapGridType.ts      ← migrated -- Phase A prereq
      CellLayerBase.ts    ← migrated (213 lines, 281 test lines) -- Phase A
      CellLayer.ts        ← migrated (468 lines, 722 test lines) -- Phase A
      CellRegion.ts       ← migrated (309 lines, 356 test lines) -- Phase A
      ProjectedCellLayer.ts   ← migrated (183 lines, 227 test lines) -- Phase A
      ProjectedCellRegion.ts  ← migrated (234 lines, 262 test lines) -- Phase A
      CellCoordsRegion.ts ← migrated (171 lines, 140 test lines) -- Phase A
      MapCoordsRegion.ts  ← migrated (122 lines, 117 test lines) -- Phase A
      MapGrid.ts          ← migrated (436 lines, 491 test lines) -- Phase B
      CellRamp.ts         ← migrated (238 lines, 352 test lines) -- Phase B
    Traits/                 ← Chapter 3: Trait interfaces and components (in progress)
    Activities/             ← Chapter 3: Activity state machine (empty, planned)
    GameRules/              ← Chapter 3: ActorInfo, WeaponInfo config (empty, planned)
    Orders/                 ← Chapter 3: Order generation (empty, planned)
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
  __e2e__/                  ← Manual acceptance test pages (dev-only, excluded from production builds)
    manual/
      index.html            ← Hub page: auto-lists all test pages (served at /test/)
      main.ts               ← Auto-discovery via import.meta.glob
      [module-name]/        ← Per-module test page directories
        [test-case-id]/     ← Individual test cases
          index.html        ← Test page entry
          main.ts           ← Test logic + Babylon.js scene
          README.md         ← Expected results + verification steps

vite.config.ts              ← Vite 8 MPA config + /test/ route plugin (dev-only)

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
  actor_system_migration_plan.md              ← Chapter 3 actor system plan with TODO checklist
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

## Chapter 3 Paradigm Mappings (Actor System)

| OpenRA (C# / Reflection) | Babylon.js / TypeScript |
|---------------------------|-------------------------|
| `World` (game world container) | `BABYLON.Scene` + `GameWorldManager` |
| `Actor` (lightweight trait container) | `GameActor extends TransformNode` |
| `TraitDictionary` (generic type-keyed storage) | `Map<string, Component[]>` + type guard functions |
| `Trait<T>()` (compiler-enforced type lookup) | `getComponent<T>(name: string): T \| undefined` (runtime assertion) |
| `ITick` / `ITickRender` (logic vs render split) | Custom `ITick` + `scene.onBeforeRenderObservable` |
| `Activity` (coroutine-linked state machine) | Custom `Activity` abstract class + `ActivityRunner` |
| `Condition System` (token-based trait toggles) | `ConditionManager` with reference-counted tokens |
| `WeaponInfo` (YAML weapon config) | `WeaponConfig` with JSON Schema validation |
| `Player` (PlayerActor pattern) | `Player` class + component-based PlayerActor |
| `Requires<T>` (compile-time dependency) | Build-time JSON Schema validation + topological sort |
| `ScreenMap` (2D screen coordinate hash) | `scene.pick()` raycasting + GPU picker |
| `Relationships` (diplomacy bitmask) | `PlayerMask` bitmask + `RelationshipWith()` bitwise check |

## Agent Team Structure

The project uses four specialized agents defined in `.claude/agents/`:

| Agent | Spec File | Role |
|-------|-----------|------|
| **migration-architect** | `migration-architect.md` | Overall design, scaffolding, CI/CD, tech decisions, dependency management |
| **migration-develop** | `migration-develop.md` | TypeScript/Babylon.js implementation with unit tests |
| **migration-review** | `migration-review.md` | Code review across 5 dimensions: docs compliance, feature completeness, efficiency, bugs, format |
| **acceptance-test-assistant** | `acceptance-test-assistant.md` | Manual visual acceptance test pages for non-unit-testable modules |
| **migration-docs** | `migration-docs.md` | Documentation maintenance, progress tracking, task coordination, commit |

### Agent Communication

Agents communicate via `SendMessage` tool calls. **Team Lead handles all coordination** (merged with manager role):

```
Architect → Developer → Reviewer ─┬─→ Acceptance Tester → Team Lead (routing)
                                  └─→ Docs Manager → Team Lead (routing)
```

### Agent Rules

**Team Lead must NOT modify code files.** The Team Lead cannot directly edit any source files (`.ts` / `.test.ts` / `.json` / `.css` / `.html`). They can only:

- Read files to understand project state
- Send tasks to sub-agents via `SendMessage`
- Route questions and feedback to the appropriate sub-agent
- Commit documentation updates that sub-agents have staged but cannot commit due to sandbox restrictions

Sub-agents (Architect, Developer, Reviewer, Acceptance Tester, Docs Manager) have full read/write access to the files within their domain.

- **Acceptance Tester may commit test code** — can write and commit files under `src/__e2e__/manual/` after verifying `tsc --noEmit` passes
- **Acceptance Tester creates test pages and commits independently** — can write `.html`, `.ts`, `.md` files under `src/__e2e__/manual/`, verify with `tsc --noEmit`, and commit test code

## Development Workflow

### Migration Pipeline (per file)

1. **Team Lead** assigns task to Architect (if design needed) or Developer
2. **Architect** (if needed): analyzes OpenRA source, writes design spec, updates migration plan
3. **Developer**: reads OpenRA source + migration docs, implements TypeScript + unit tests, self-reviews
4. **Reviewer**: reviews across 5 dimensions (docs compliance, feature completeness, efficiency, bugs, format), assigns severity (BLOCKER/MAJOR/MINOR/INFO)
5. **Developer**: fixes review findings, resubmits (may require multiple rounds)
6. **Acceptance Tester** (parallel with Docs Manager): on APPROVED, creates manual visual acceptance test pages if the module has visual/GPU-dependent behavior
7. **Docs Manager** (parallel with Acceptance Tester): on APPROVED, updates all documentation (migration plan TODOs, progress tracker, README, architecture doc) and commits

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
# Main app: http://localhost:5173/
# Acceptance test hub: http://localhost:5173/test/

# Build for production
npm run build

# Preview production build
npm run preview

# Run unit tests
npm test

# Type-check
npx tsc --noEmit
```

## Acceptance Testing (Manual Visual Verification)

The project includes a framework for manual visual acceptance testing of modules that cannot be verified through automated unit tests (animation, shader effects, visual layout, interaction feel, etc.). This is a **dev-only** infrastructure -- test pages are excluded from production builds.

### URL Scheme

| URL | Maps To | Purpose |
|-----|---------|---------|
| `/` | `index.html` | Main application |
| `/test/` | `src/__e2e__/manual/index.html` | Hub page listing all test pages |
| `/test/[module]/[case]/` | `src/__e2e__/manual/[module]/[case]/index.html` | Individual test case |

All `/test/` URLs are available only in dev mode (`npm run dev`). Production builds (`npm run build`) exclude all test pages from `dist/` via `build.rollupOptions.input` (only `index.html` is included).

### How It Works

- **`vite.config.ts`** uses a custom dev-only plugin (`vite-plugin-test-routes`) that rewrites `/test/...` URLs to `/src/__e2e__/manual/...` on the filesystem. Old `/src/__e2e__/manual/...` page URLs are blocked (404) to enforce the canonical `/test/` prefix.
- **Hub page auto-discovery**: `src/__e2e__/manual/main.ts` uses `import.meta.glob('./**/index.html', { eager: false })` to discover all test pages at dev server startup. No manual route registration is needed.
- **HMR-aware**: The hub page re-renders the test list on hot module updates, so adding a new test page directory takes effect after dev server restart or HMR refresh.

### Creating a New Test Page

1. Create a directory: `src/__e2e__/manual/[module-name]/[test-case-id]/`
2. Add three files inside:
   - `index.html` -- HTML entry point with inline styles and layout (see page template in `.claude/agents/acceptance-test-assistant.md`)
   - `main.ts` -- TypeScript logic + Babylon.js scene setup
   - `README.md` -- Expected results (at least 3 quantifiable criteria) + verification step-by-step
3. No config changes needed -- the hub page auto-discovers the new directory on next dev server start
4. Access the page at `http://localhost:5173/test/[module-name]/[test-case-id]/`

The agent responsible for creating these test pages is defined in `.claude/agents/acceptance-test-assistant.md`.

## Key Documentation

| Document | Description |
|----------|-------------|
| [docs/rendering_migration_plan.md](docs/rendering_migration_plan.md) | Chapter 2 rendering engine migration plan with TODO checklist and file mapping table (27 migration items, 100% complete) |
| [docs/actor_system_migration_plan.md](docs/actor_system_migration_plan.md) | Chapter 3 actor system migration plan with TODO checklist (36 total: 17 Phase A primitives + 14 core + 5 support; 61 TODO items) |
| [docs/openra_migration.agent.final.converted.md](docs/openra_migration.agent.final.converted.md) | Comprehensive OpenRA architecture analysis (~199KB) covering rendering, actor system, networking, resources |
| [docs/migration_progress.md](docs/migration_progress.md) | Overall migration progress tracker with file statuses, dependency graph, and recommended next tasks |
| [CLAUDE.md](CLAUDE.md) | This file — project overview, agent team structure, and development workflow |

## License

This project is based on [OpenRA](https://github.com/OpenRA/OpenRA), which is licensed under GPL-3.0.
