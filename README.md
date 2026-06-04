# OpenRAWeb3D

Migrate the [OpenRA](https://github.com/OpenRA/OpenRA) 2D RTS game engine (C# / OpenGL 3.2 / SDL2) to a Web-based 3D engine using **TypeScript** and **Babylon.js**. The core paradigm shift: from imperative OpenGL programming to a declarative 3D scene graph.

## Status

**Phase**: Chapter 2 -- Rendering Engine (COMPLETE); Chapter 3 -- Actor System (IN PROGRESS)  
**Progress**: 27/27 rendering (100%), 35/36 actor system (97%)  
**Details**: [docs/migration_progress.md](docs/migration_progress.md)

| Module | Status |
|--------|--------|
| **Chapter 2: Rendering Engine** | **Complete (27/27)** |
| Renderer, WorldRenderer, SpriteRenderer | Completed |
| RgbaColorRenderer, RgbaSpriteRenderer | Completed |
| Shader / Material System (6 files) | Completed |
| FrameBuffer & Post-Processing (10 files) | Completed |
| Sprite & Texture System (8 core + 4 extra files) | Completed |
| Platform Abstraction (11 files) | Completed |
| Model shaders (model.vert/frag) | NOP stubs |
| **Chapter 3: Actor System** | **In Progress (35/36)** |
| Coordinate System & Primitives (17 files) | Completed |
| Trait System Core (2 files) | Completed |
| GameWorldManager (World.ts) | Completed |
| GameActor (Actor.ts) | Completed |
| ActorConfig (ActorInfo.ts) | Completed |
| Activity System (Activity.ts, CallFunc.ts, ActivityUtils.ts) | Completed |
| Player | Completed |
| Effects System (IEffect, DelayedAction, DelayedImpact, 103 tests) | Completed |
| ScreenMap (1 file remaining) | Pending |
| Weapon System (2 files) | Deferred |
| Networking, audio, mod system, UI | Not yet started |

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
| `Sheet` (texture atlas / sprite sheet) | `BABYLON.Texture` / `RawTexture` with UV sub-regions |
| `Sprite` (single sprite from sheet) | `MeshBuilder.CreatePlane()` + custom UV offset/scale |
| `IPalette` (256-color palette, indexer) | `Uint32Array` + TypeScript `at()` method |
| `PlayerColorRemap` (HSV recolor) | GPU uniform lookup via 256x1 `RawTexture` |
| `Animation` (frame-based sprite anim) | `mesh.updateVerticesData("uv", ...)` frame swap |
| `TerrainSpriteLayer` (large terrain grid) | Single large-plane `Mesh` + dirty-row update |

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
