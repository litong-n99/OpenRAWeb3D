# OpenRAWeb3D

Migrate the [OpenRA](https://github.com/OpenRA/OpenRA) 2D RTS game engine (C# / OpenGL 3.2 / SDL2) to a Web-based 3D engine using **TypeScript** and **Babylon.js**. The core paradigm shift: from imperative OpenGL programming to a declarative 3D scene graph.

## Project Status

**Phase**: Chapter 2 -- Rendering Engine
**Progress**: 4/26 rendering files complete (15%)
**Details**: [docs/migration_progress.md](docs/migration_progress.md)

| Module | Status |
|--------|--------|
| Renderer (main renderer) | Completed, reviewed |
| WorldRenderer (world scene) | Completed, reviewed |
| SpriteRenderer (batch sprites) | Completed |
| RgbaColorRenderer (RGBA color renderer) | Completed, reviewed |
| Remaining rendering modules (22 files) | Stubs / pending |
| Game logic, networking, audio, mod system | Not yet started |

## Directory Layout

```
OpenRA/                     ← Original C# source (READ-ONLY reference, NEVER modify)
  OpenRA.Game/              ← Core engine: Renderer, World, Actor, Graphics, Traits
  OpenRA.Platforms.Default/ ← Platform: Shader, Texture, FrameBuffer, SDL2 context
  OpenRA.Mods.Cnc/          ← C&C-specific mod code
  glsl/                     ← Original GLSL shaders (OpenGL 3.2 / GLSL 1.50)

src/                        ← TypeScript migration target (mirrors OpenRA/ structure)
  OpenRA.Game/              ← Core engine: Renderer.ts, Graphics/, etc.
    Renderer.ts             ← migrated (1106 lines, 89 tests)
    Graphics/
      WorldRenderer.ts      ← migrated (1306 lines, 74 tests)
      SpriteRenderer.ts     ← migrated (835 lines, 55 tests)
      RgbaColorRenderer.ts  ← migrated (1012 lines, 68 tests)
      *.ts                  ← 22 remaining stubs
  OpenRA.Platforms.Default/ ← Platform abstraction stubs
  glsl/                     ← Migrated GLSL shaders (WebGL 2.0 / GLSL ES 3.0)
  assets/                   ← Static assets
  utils/                    ← Shared utilities

.claude/
  agents/
    migration-architect.md   ← Architect agent spec
    migration-develop.md     ← Developer agent spec
    migration-review.md      ← Code review agent spec
    migration-docs.md        ← Documentation manager agent spec
    migration-manager.md     ← Task manager agent spec

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

## Agent Team Structure

The project uses five specialized agents defined in `.claude/agents/`:

| Agent | Spec File | Role |
|-------|-----------|------|
| **migration-architect** | `migration-architect.md` | Overall design, scaffolding, CI/CD, tech decisions, dependency management |
| **migration-develop** | `migration-develop.md` | TypeScript/Babylon.js implementation with unit tests |
| **migration-review** | `migration-review.md` | Code review across 5 dimensions: docs compliance, feature completeness, efficiency, bugs, format |
| **migration-docs** | `migration-docs.md` | Documentation maintenance, progress tracking, task coordination, commit |
| **migration-manager** | `migration-manager.md` | [MERGED] Now handled by Team Lead directly |

### Agent Communication

Agents communicate via `SendMessage` tool calls. **Team Lead handles all coordination** (merged with manager role):

```
Architect → Developer → Reviewer → Docs Manager → Team Lead (routing)
```

### Agent Rules

**Team Lead and Manager must NOT modify code files.** They cannot directly edit any source files (`.ts` / `.test.ts` / `.json` / `.css` / `.html`). They can only:

- Read files to understand project state
- Send tasks to sub-agents via `SendMessage`
- Route questions and feedback to the appropriate sub-agent
- Commit documentation updates that sub-agents have staged but cannot commit due to sandbox restrictions

Sub-agents (Architect, Developer, Reviewer, Docs Manager) have full read/write access to the files within their domain.

## Development Workflow

### Migration Pipeline (per file)

1. **Manager** assigns task to Architect (if design needed) or Developer
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
| [docs/rendering_migration_plan.md](docs/rendering_migration_plan.md) | Chapter 2 rendering engine migration plan with TODO checklist and file mapping table (26 files) |
| [docs/openra_migration.agent.final.converted.md](docs/openra_migration.agent.final.converted.md) | Comprehensive OpenRA architecture analysis (~199KB) covering rendering, actor system, networking, resources |
| [docs/migration_progress.md](docs/migration_progress.md) | Overall migration progress tracker with file statuses, dependency graph, and recommended next tasks |
| [CLAUDE.md](CLAUDE.md) | This file — project overview, agent team structure, and development workflow |

## License

This project is based on [OpenRA](https://github.com/OpenRA/OpenRA), which is licensed under GPL-3.0.
