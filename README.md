# OpenRAWeb3D

Migrate the [OpenRA](https://github.com/OpenRA/OpenRA) 2D RTS game engine (C# / OpenGL 3.2 / SDL2) to a Web-based 3D engine using **TypeScript** and **Babylon.js**. The core paradigm shift: from imperative OpenGL programming to a declarative 3D scene graph.

## Status

**Phase**: Chapter 2 -- Rendering Engine  
**Progress**: 10/27 rendering files complete (37%)  
**Details**: [docs/migration_progress.md](docs/migration_progress.md)

| Module | Status |
|--------|--------|
| Renderer (main renderer) | Completed |
| WorldRenderer (world scene) | Completed |
| SpriteRenderer (batch sprites) | Completed |
| RgbaColorRenderer (RGBA color renderer) | Completed |
| Shader / Material System (6 files) | Completed |
| Remaining rendering modules (17 files) | Stubs / pending |
| Game logic, networking, audio, mod system | Not yet started |

## Architecture Overview

```
OpenRA/                     ← Original C# source (READ-ONLY reference)
src/                        ← TypeScript migration target (mirrors OpenRA/ structure)
  OpenRA.Game/              ← Core engine: Renderer, World, Actor, Traits, Graphics
  OpenRA.Platforms.Default/ ← Platform abstraction: Shader, Texture, FrameBuffer
  OpenRA.Mods.Cnc/          ← C&C-specific mod code
  glsl/                     ← Migrated GLSL shaders (WebGL 2.0 / GLSL ES 3.0)
  assets/                   ← Static assets
  utils/                    ← Shared utilities
```

**Key paradigm mappings**:

| OpenRA (C# / OpenGL) | Babylon.js (TypeScript / WebGL) |
|----------------------|---------------------------------|
| `Renderer.BeginFrame/EndFrame` | `Engine.runRenderLoop()` |
| Dual FBO (`worldBuffer/screenBuffer`) | `RenderTargetTexture` + dual `Scene` |
| `SpriteRenderer` batch rendering | `ThinInstances` / `SpriteManager` |
| `HardwarePalette` (256xN texture) | `RawTexture` + custom `ShaderMaterial` |
| `WorldRenderer.Draw()` 6 phases | `renderingGroupId` layers + `Scene.render()` |
| `IShader.SetVec/SetTexture` | `ShaderMaterial.setVector3/setTexture` |
| `ShaderBindings` C# attribute reflection | `ShaderMaterial` + `Effect.ShadersStore` uniform declaration |
| `Vertex` 48-byte struct | `VertexData` multi-array |
| `Util.PremultiplyAlpha()` | `material.alphaMode = ALPHA_PREMULTIPLIED` |

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | ~6.0 |
| 3D Engine | Babylon.js (`@babylonjs/core`) | ^9.10.1 |
| Build/Bundler | Vite | ^8.0.12 |
| Unit Testing | Vitest + happy-dom | ^4.1.8 / ^20.9.0 |
| Modules | ESM (`"type": "module"`) | — |
| Target | ES2023 | — |

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

## Project Conventions

- **OpenRA/ is read-only** -- original C# source is for reference only, never modify it
- **Directory parity** -- `src/` paths must mirror `OpenRA/` paths for all migrated files
- **ESM only** -- all code uses ES modules
- **Babylon.js tree-shaking** -- import from `@babylonjs/core`, not the legacy barrel export
- **Mock Babylon.js in unit tests** -- happy-dom has no WebGL, all `@babylonjs/core` imports must be mocked
- **Dispose pattern** -- any class creating GPU resources must implement `dispose()`
- **No per-frame allocation** -- hot-path code must reuse objects

## Documentation

| Document | Description |
|----------|-------------|
| [docs/rendering_migration_plan.md](docs/rendering_migration_plan.md) | Chapter 2 rendering engine migration plan with TODO checklist and file mapping table |
| [docs/openra_migration.agent.final.converted.md](docs/openra_migration.agent.final.converted.md) | Comprehensive OpenRA architecture analysis (~199KB) covering rendering, actor system, networking, resources |
| [docs/migration_progress.md](docs/migration_progress.md) | Overall migration progress tracker with file statuses and dependency graph |

## Team

The project uses four specialized Claude Code agents defined in `.claude/agents/`:

| Agent | Role |
|-------|------|
| **migration-architect** | Overall design, scaffolding, CI/CD, tech decisions, dependency management |
| **migration-develop** | TypeScript/Babylon.js implementation with unit tests and E2E tests |
| **migration-review** | Code review across 5 dimensions: docs compliance, feature completeness, efficiency, bugs, format |
| **migration-docs** | Documentation maintenance, progress tracking, task coordination |

## License

This project is based on [OpenRA](https://github.com/OpenRA/OpenRA), which is licensed under GPL-3.0.
