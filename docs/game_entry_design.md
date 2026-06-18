# OpenRAWeb3D Game Entry Design: Mod Selection, Routing & Game Bootstrapping

> **Status**: MERGED into [Chapter 22 Migration Plan](chapter22_game_entry_migration_plan.md) on 2026-06-18.
> **Date**: 2026-06-18
> **Scope**: `src/main.ts`, `src/OpenRA.Game/Game.ts` (new), `public/mods/` (new)
> **Target**: Transform the Vite template placeholder at `src/main.ts` into the OpenRAWeb3D game entry point.
>
> **IMPORTANT**: This design document has been formally incorporated into [docs/chapter22_game_entry_migration_plan.md](chapter22_game_entry_migration_plan.md) as the official Chapter 22 migration plan. This file is retained for the original architecture diagrams and detailed design rationale. For TODO checklists, phase breakdown, file mapping tables, and dependency tracking, refer to the Chapter 22 plan.

---

## Table of Contents

1. [Overview & Architecture Vision](#1-overview--architecture-vision)
2. [Routing Architecture](#2-routing-architecture)
3. [Game Class Design](#3-game-class-design)
4. [Mod Loading Pipeline](#4-mod-loading-pipeline)
5. [Mod Selector (Homepage) Design](#5-mod-selector-homepage-design)
6. [Shellmap Strategy](#6-shellmap-strategy)
7. [Editor Integration (Chapter 21)](#7-editor-integration-chapter-21)
8. [File Structure & Directory Layout](#8-file-structure--directory-layout)
9. [Implementation Phases](#9-implementation-phases)
10. [Architecture Decision Records (ADR)](#10-architecture-decision-records-adr)
11. [Testing & Validation Strategy](#11-testing--validation-strategy)

---

## 1. Overview & Architecture Vision

### 1.1 Problem Statement

`src/main.ts` currently holds a Vite scaffold template (counter, hero image, documentation links). It needs to become the entry point for the OpenRAWeb3D game engine, supporting:

- **Mod selection**: User sees mod cards (Red Alert, Tiberian Dawn, Dune 2000, Tiberian Sun) at `/` and clicks to enter
- **Game loading**: Clicking a mod card navigates to `/play/{modId}`, loads the mod, starts a shellmap or skirmish
- **Editor mode**: Future `/editor/{modId}` route loads the map editor (Chapter 21)

The C# `static class Game` (OpenRA.Game/Game.cs, ~1000 lines) is the root coordinator that stitches together all subsystems -- but it has not yet been migrated to TypeScript.

### 1.2 Architectural Constraints

| Constraint | Rationale |
|---|---|
| No new npm dependencies (Vue, React, Svelte) | Project already has a complete Widget UI system (Ch5 + Ch16), adding a framework adds 200+ KB for no benefit |
| Must support MPA-style URL routing (`/`, `/play/ra`, `/editor/td`) | Clean URLs for sharing, bookmarks, and browser history |
| Mod assets NOT yet available | Design must work with mock/minimal data first, real assets later |
| Babylon.js Engine lifecycle is expensive | Create once, reuse across mod switches; never create multiple Engines |
| Test pages must continue working (`/test/`) | Existing `vite-plugin-test-routes` must coexist with game routing |

### 1.3 Architecture Diagram

```
                  Browser URL
                      │
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
    / (homepage)  /play/{modId}  /editor/{modId}
        │             │              │
        ▼             ▼              ▼
   ModSelector    Game.create()   Game.create()
   (static HTML)  WorldType.Regular  WorldType.Editor
                      │              │
                      ▼              ▼
                 ┌──────────────────────┐
                 │     Game Instance     │
                 │  (root coordinator)   │
                 │                      │
                 │  ┌─────────────────┐ │
                 │  │ Renderer         │ │ ← Babylon.js Engine + Scene
                 │  │ WorldRenderer    │ │
                 │  │ Sound            │ │
                 │  │ ModData          │ │
                 │  │ OrderManager     │ │
                 │  │ Widget UI Tree   │ │
                 │  └─────────────────┘ │
                 └──────────────────────┘
```

---

## 2. Routing Architecture

### 2.1 Decision: SPA Mode with Client-Side Routing

The current `vite.config.ts` uses `appType: 'mpa'` to support `/test/` pages. This needs to change.

**Decision**: Switch to `appType: 'spa'` (Vite default) with a thin client-side router.

**Why SPA over true MPA**:
- MPA requires a separate `.html` entry point per route -- impossible for dynamic mod IDs like `/play/ra`, `/play/td`
- SPA mode provides a catch-all fallback to `index.html` for unknown paths, enabling dynamic routes
- The Game engine (Babylon.js) is expensive to create; SPA allows the engine to persist across mod switches
- Code splitting with `import()` handles per-mod asset loading efficiently
- The existing `/test/` plugin still works in SPA mode because its middleware runs before the SPA fallback

**How it works**:
1. `vite.config.ts` changes from `appType: 'mpa'` to default SPA
2. The test routes plugin intercepts `/test/...` and rewrites them to filesystem paths
3. Non-test, non-asset requests fall through to the SPA fallback → `index.html` served
4. `index.html` loads `src/main.ts`, which reads `window.location.pathname` to determine the current route

### 2.2 Route Map

| URL Pattern | Route Handler | Renders | Notes |
|---|---|---|---|
| `/` | `ModSelector.show()` | Static HTML mod cards | No game engine loaded |
| `/play/:modId` | `ModSelector.launchMod(modId, WorldType.Regular)` | Game engine + shellmap | Engine loaded on demand |
| `/editor/:modId` | `ModSelector.launchMod(modId, WorldType.Editor)` | Editor (Ch21 deferred) | 404 stub until Ch21 ready |
| `/test/...` | Test routes plugin | E2E test pages | Dev-only, unchanged |

### 2.3 Router Implementation

A minimal path-based router (no framework, no dependency):

```typescript
// src/OpenRA.Game/Router.ts (conceptual)
export type RouteHandler = (params: Record<string, string>) => void

export class Router {
  private routes: Map<string, RouteHandler> = new Map()

  /** Register a path pattern: "/play/:modId" */
  on(pattern: string, handler: RouteHandler): this

  /** Match current pathname and dispatch. Returns true if a route handled it. */
  dispatch(): boolean

  /** Navigate to a path, pushing history state. */
  navigate(path: string): void
}
```

The Router matches patterns like `/play/:modId` using simple regex conversion (`:param` → `([^/]+)`).

### 2.4 Vite Configuration Changes

```typescript
// vite.config.ts changes:
// - Remove appType: 'mpa' (revert to SPA default)
// - Keep testRoutesPlugin for /test/ routing (works in SPA mode because
//   the plugin middleware runs before Vite's SPA fallback)
// - No other changes needed -- build.rollupOptions.input stays as index.html
```

**Why the test plugin still works in SPA mode**:
Vite's middleware stack processes custom plugins first, then the built-in middleware. The test plugin rewrites `/test/foo/` to `/src/__e2e__/manual/foo/`, and the file is served from disk. The SPA fallback only triggers for 404s, which won't happen for valid test pages.

---

## 3. Game Class Design

### 3.1 Decision: Instance Class (not Singleton `static`)

OpenRA C# uses `public static class Game` -- a true global singleton with static fields for every subsystem.

For TypeScript/Web:

**Decision**: `Game` is an **instance class** with a module-level "current game" variable.

**Rationale**:
- Testability: Each test can create a fresh `Game` instance without global state bleed
- Clean disposal: `game.dispose()` tears down all GPU resources explicitly
- Mod switching: Destroying old Game and creating new ensures no stale state
- ESM module caching provides natural "singleton" behavior at the module level -- `import { getCurrentGame } from './Game.js'` returns the same instance within a module graph
- Babylon.js `Engine` has a global side effect (WebGL context ownership), so having multiple concurrent Game instances is not supported -- but the instance pattern makes this constraint explicit rather than accidental

**Anti-pattern avoided**: True static class with all-static members would make testing and cleanup nearly impossible in a browser context (no process isolation between tests).

### 3.2 Game Class API

```typescript
// src/OpenRA.Game/Game.ts (conceptual API)

/** Game lifecycle states. Mirrors the implicit state machine in C# Game.cs */
export const GameState = {
  Uninitialized: 'Uninitialized',
  LoadingMod: 'LoadingMod',
  Shellmap: 'Shellmap',       // Main menu with background map
  Playing: 'Playing',         // In-game (skirmish, campaign, multiplayer)
  Editor: 'Editor',           // Map editor mode
  Disposed: 'Disposed',
} as const
export type GameState = (typeof GameState)[keyof typeof GameState]

/**
 * Root game coordinator.
 *
 * OpenRA 对照: OpenRA.Game/Game.cs (static class Game)
 *
 * This class owns all subsystem lifecycles:
 *   Renderer → WorldRenderer → Sound → ModData → OrderManager → World → UI
 *
 * Only ONE Game instance can exist at a time (single WebGL context constraint).
 */
export class Game {
  // ---- Subsystem instances (mirror C# Game static fields) ----

  readonly renderer: Renderer
  sound: Sound | null = null
  modData: ModData | null = null
  orderManager: OrderManager | null = null

  /** Current world (null during mod loading, set after StartGame). */
  get world(): GameWorldManager | null
  /** Current world renderer (null during mod loading). */
  get worldRenderer(): WorldRenderer | null

  /** Current game state. */
  get state(): GameState

  /** The mod ID currently loaded (or being loaded). */
  get currentModId(): string | null

  // ---- Static factory (creates and initializes) ----

  /**
   * Create a Game instance, initialize the Babylon.js Engine, and load a mod.
   *
   * This is the primary entry point. Corresponds to C# Game.InitializeAndRun().
   *
   * @param canvas - HTML canvas element to attach the WebGL context to
   * @param modId - Mod identifier (e.g., "ra", "td", "d2k", "ts")
   * @param worldType - World type (Regular, Shellmap, or Editor)
   * @returns Fully initialized Game instance in Shellmap/Playing state
   */
  static async create(
    canvas: HTMLCanvasElement,
    modId: string,
    worldType?: WorldType,
  ): Promise<Game>

  // ---- Lifecycle ----

  /**
   * Initialize the Babylon.js Engine + Renderer.
   * Must be called before loadMod().
   * OpenRA 对照: Game.Initialize() renderer creation section
   */
  private async initializeEngine(canvas: HTMLCanvasElement): Promise<void>

  /**
   * Load a mod by ID. Handles:
   * 1. Fetch mod.json from public/mods/:modId/
   * 2. Parse into Manifest
   * 3. Create FileSystem, mount paths
   * 4. Create ModData, call init()
   * 5. Load Ruleset
   * 6. Initialize Sound, Cursor, etc.
   *
   * OpenRA 对照: Game.InitializeMod(Manifest, Arguments)
   */
  async loadMod(modId: string): Promise<void>

  /**
   * Start a game world (shellmap or skirmish).
   *
   * OpenRA 对照: Game.StartGame(Map, WorldType)
   *
   * @param mapUid - Map cache UID (use ChooseShellmap() for shellmap)
   * @param worldType - World type for the new world
   */
  async startGame(mapUid: string, worldType: WorldType): Promise<void>

  /**
   * Load the shellmap (background animated map for main menu).
   *
   * OpenRA 对照: Game.LoadShellMap()
   *
   * Picks a random shellmap from the map cache and starts it.
   * Falls back to a static background if no shellmaps available.
   */
  async loadShellMap(): Promise<void>

  /**
   * Dispose all subsystems and release the WebGL context.
   *
   * OpenRA 对照: Game.Run() finally block
   *
   * Dispose order (reverse of creation):
   *   World → WorldRenderer → OrderManager → Cursor → Sound → ModData → Renderer
   */
  dispose(): void

  // ---- Mod switching ----

  /**
   * Switch to a different mod. Disposes current world + mod data,
   * then loads the new mod and starts its shellmap.
   *
   * OpenRA 对照: Game.InitializeMod() called after switching mods
   */
  async switchMod(modId: string): Promise<void>
}
```

### 3.3 Internal Initialization Sequence

Mirrors the C# `Game.InitializeAndRun()` call chain:

```
C# Game.InitializeAndRun(args)
  ├── Initialize(args)
  │   ├── Parse arguments (Engine.EngineDir, Game.Mod, etc.)
  │   ├── InitializeSettings(args)
  │   ├── Initialize log channels
  │   ├── InstalledMods(modSearchPaths) -- scan mods/ directory
  │   ├── Validate mod ID exists
  │   ├── Create Renderer(platform, graphics, vertexBatchSize)
  │   ├── Create Sound(platform, soundSettings)
  │   └── InitializeMod(manifest, args)
  │       ├── new ModData(manifest, mods, useLoadScreen=true)
  │       ├── ModData.InitializeLoaders()
  │       ├── Renderer.InitializeFonts()
  │       ├── ModData.MapCache.LoadMaps()
  │       ├── new CursorManager(ModData)
  │       └── JoinLocal() -- creates local OrderManager
  └── Run()
      ├── LoadShellMap()
      │   ├── ChooseShellmap() -- pick random shellmap from cache
      │   └── StartGame(shellmap, WorldType.Shellmap)
      └── Loop() -- fixed-timestep game loop
          ├── LogicTick() -- at ~25 TPS
          │   ├── PerformDelayedActions()
          │   ├── Ui.Tick()
          │   ├── Cursor.Tick()
          │   ├── Sound.Tick()
          │   ├── OrderManager.TryTick()
          │   ├── world.OrderGenerator.Tick()
          │   └── world.Tick() -- actor ticks
          └── RenderTick() -- at display refresh rate
              ├── worldRenderer.BeginFrame()
              ├── worldRenderer.Draw()
              ├── Renderer.BeginUI()
              ├── Ui.Draw()
              ├── Cursor.Render()
              └── Renderer.EndFrame()
```

TypeScript `Game.create()` sequence:

```
Game.create(canvas, modId, worldType)
  ├── 1. initializeEngine(canvas)
  │   ├── new Engine(canvas, antialias=true)
  │   ├── new Renderer(engine) -- creates worldScene, uiScene, cameras
  │   └── Engine.runRenderLoop() -- starts requestAnimationFrame loop
  ├── 2. loadMod(modId)
  │   ├── fetch(`/mods/${modId}/mod.json`) -- load mod manifest JSON
  │   ├── new Manifest(modId, manifestJSON)
  │   ├── new FileSystem() -- create virtual file system
  │   ├── For each mount path: fileSystem.mount(`/mods/${modId}/${path}`)
  │   ├── new ModData(manifest, fileSystem, installedMods)
  │   ├── await modData.init() -- validate deps, mount paths
  │   ├── await modData.loadRuleSet() -- load ruleset from mod files
  │   ├── new Sound(renderer) -- initialize audio
  │   └── new OrderManager(new EchoConnection()) -- local single-player
  └── 3. startGame(mapUid, worldType)
      ├── Prepare map (MapCache lookup)
      ├── new World(map, modData, orderManager, worldType)
      ├── new WorldRenderer(modData, world)
      ├── world.LoadComplete(worldRenderer)
      ├── orderManager.StartGame()
      └── worldRenderer.RefreshPalette()
```

### 3.4 Game Loop Integration

The Babylon.js engine already provides `Engine.runRenderLoop()`. The Game class hooks into this:

```typescript
// Conceptual -- inside Game.create()
this.renderer.engine.runRenderLoop(() => {
  if (this.state === GameState.Disposed) return

  // Fixed-timestep logic tick (25 TPS, with accumulator)
  this.logicTickAccumulator += this.renderer.engine.getDeltaTime()
  while (this.logicTickAccumulator >= LOGIC_TIMESTEP_MS) {
    this.logicTick()
    this.logicTickAccumulator -= LOGIC_TIMESTEP_MS
  }

  // Render every frame
  this.renderTick()
})
```

This mirrors OpenRA's `Game.Loop()` but uses `requestAnimationFrame` timing (via Babylon.js) instead of a while-loop with `Thread.Sleep()`.

---

## 4. Mod Loading Pipeline

### 4.1 Mod JSON Format

Build-time precompiled from OpenRA's `mod.yaml` via the MiniYAML pipeline.

File location: `public/mods/{modId}/mod.json`

```json
{
  "Metadata": {
    "Title": "Red Alert",
    "Version": "release-20250308",
    "Website": "https://www.openra.net",
    "WindowTitle": "OpenRA - Red Alert"
  },
  "RequiresMods": [],
  "FileSystem": {
    "ra": "ra",
    "common": "common"
  },
  "Rules": ["rules/*.yaml"],
  "Sequences": ["sequences/*.yaml"],
  "Cursors": ["cursors.yaml"],
  "Chrome": ["chrome/*.yaml"],
  "ChromeLayout": ["chrome/*.yaml"],
  "Weapons": ["weapons/*.yaml"],
  "Voices": ["audio/voices.yaml"],
  "Notifications": ["audio/notifications.yaml"],
  "Music": ["audio/music.yaml"],
  "TileSets": ["tilesets/*.yaml"],
  "ChromeMetrics": ["metrics.yaml"],
  "Missions": ["missions.yaml"],
  "Hotkeys": ["hotkeys.yaml"],
  "ServerTraits": ["servertraits.yaml"],
  "SupportsMapsFrom": "ra",
  "DefaultOrderGenerator": "UnitOrderGenerator",
  "MapFolders": {
    "Main": "maps"
  },
  "PackageFormats": ["MixFile", "BigFile", "Pak"],
  "RendererConstants": {
    "FontSheetSize": 512,
    "CursorSheetSize": 512,
    "SequenceBgraSheetSize": 2048,
    "SequenceIndexedSheetSize": 2048,
    "VertexBatchSize": 8192
  }
}
```

### 4.2 Mod Assets Directory Structure

```
public/mods/
  ra/                           ← Red Alert mod
    mod.json                    ← Precompiled manifest
    rules/                      ← YAML rules files (as JSON)
    sequences/                  ← Sprite sequence definitions
    chrome/                     ← UI layout definitions
    weapons/                    ← Weapon definitions
    tilesets/                   ← Terrain tileset definitions
    audio/                      ← Voice/notification/music config
    maps/                       ← Bundled maps (.oramap)
    cursors.yaml                ← Cursor definitions
    metrics.yaml                ← Chrome metrics
    missions.yaml               ← Mission definitions
    hotkeys.yaml                ← Hotkey bindings
  td/                           ← Tiberian Dawn mod
    mod.json
    ...
  d2k/                          ← Dune 2000 mod
    mod.json
    ...
  ts/                           ← Tiberian Sun mod
    mod.json
    ...
  common/                       ← Shared mod (dependency for all)
    mod.json
    ...
```

### 4.3 Loading Sequence (With Progress Events)

```
loadMod(modId):
  1. emit 'progress', { stage: 'manifest', percent: 0 }
     → fetch /mods/{modId}/mod.json, parse JSON, new Manifest()

  2. emit 'progress', { stage: 'dependencies', percent: 10 }
     → Validate requiresMods against installed mods

  3. emit 'progress', { stage: 'filesystem', percent: 15 }
     → Create FileSystem, mount all manifest.mounts paths
     → Each mount: fetch directory listing, register packages

  4. emit 'progress', { stage: 'moddata', percent: 30 }
     → new ModData(manifest, fileSystem), await modData.init()

  5. emit 'progress', { stage: 'ruleset', percent: 40 }
     → await modData.loadRuleSet()

  6. emit 'progress', { stage: 'assets', percent: 50 }
     → Load sound device, initialize cursor manager
     → (Real assets loaded lazily on first use)

  7. emit 'progress', { stage: 'maps', percent: 70 }
     → Load map cache index

  8. emit 'progress', { stage: 'world', percent: 85 }
     → startGame(shellmapUid, WorldType.Shellmap)

  9. emit 'progress', { stage: 'complete', percent: 100 }
     → Shellmap running, main menu widgets shown
```

### 4.4 Minimal/Mock Mod for Pipeline Verification

Before real mod assets are available, create a `public/mods/_test/` minimal mod:

```json
{
  "Metadata": {
    "Title": "Test Mod",
    "Version": "0.1.0",
    "Hidden": true
  },
  "RequiresMods": [],
  "FileSystem": {},
  "Rules": [],
  "Sequences": [],
  "Weapons": [],
  "TileSets": [],
  "Chrome": ["chrome/test.yaml"],
  "ChromeLayout": [],
  "ChromeMetrics": ["metrics.yaml"],
  "PackageFormats": [],
  "MapFolders": {}
}
```

This mod has:
- No terrain, no actors, no rules -- just enough to boot the engine
- A minimal ChromeProvider (empty widget tree)
- Can be used to verify the Game → ModData → Renderer initialization pipeline
- No `.oramap` files needed

---

## 5. Mod Selector (Homepage) Design

### 5.1 Decision: Static HTML/CSS (No Game Engine)

The mod selector at `/` does NOT load the game engine or Babylon.js. It is a plain HTML/CSS/TypeScript page.

**Rationale**:
- The game engine (Babylon.js + custom shaders) is ~1 MB gzipped
- Most users land at `/` and need to choose a mod before anything loads
- Loading the engine for a simple card-based selection screen is wasteful
- The selector runs before any heavy JS, giving instant page load
- After a mod is chosen, we load the engine lazily

### 5.2 Mod Selector Layout

```
┌──────────────────────────────────────────────────────┐
│                    OpenRAWeb3D                        │
│            Open-Source RTS in Your Browser            │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │              │  │              │  │              │ │
│  │  Red Alert   │  │  Tiberian    │  │  Dune 2000   │ │
│  │              │  │  Dawn        │  │              │ │
│  │  [Soviet     │  │              │  │  [Atreides   │ │
│  │   vs Allies] │  │  [GDI vs Nod]│  │   vs Hark.]  │ │
│  │              │  │              │  │              │ │
│  │  [Play →]    │  │  [Play →]    │  │  [Play →]    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                       │
│  ┌──────────────┐                                     │
│  │  Tiberian    │                                     │
│  │  Sun         │  ┌────────────────────────────────┐ │
│  │              │  │  Editor (coming soon)           │ │
│  │  [Play →]    │  │  Create and edit maps in 3D    │ │
│  └──────────────┘  └────────────────────────────────┘ │
│                                                       │
│  Version 0.1.0 | GitHub | Discord                     │
└──────────────────────────────────────────────────────┘
```

### 5.3 Mod Card Data Source

Mod metadata is loaded from `public/mods/_index.json` -- a lightweight manifest of available mods:

```json
{
  "mods": [
    {
      "id": "ra",
      "title": "Red Alert",
      "version": "release-20250308",
      "description": "Command Soviets or Allies in an alternate-history clash.",
      "factions": ["Soviet", "Allies"],
      "thumbnail": "/mods/ra/thumbnail.webp",
      "background": "/mods/ra/background.webp",
      "available": true
    },
    {
      "id": "td",
      "title": "Tiberian Dawn",
      "version": "release-20250308",
      "description": "GDI vs Brotherhood of Nod in the first Tiberium War.",
      "factions": ["GDI", "Nod"],
      "thumbnail": "/mods/td/thumbnail.webp",
      "background": "/mods/td/background.webp",
      "available": true
    },
    {
      "id": "d2k",
      "title": "Dune 2000",
      "version": "release-20250308",
      "description": "Fight for control of Arrakis and the spice melange.",
      "factions": ["Atreides", "Harkonnen", "Ordos"],
      "thumbnail": "/mods/d2k/thumbnail.webp",
      "background": "/mods/d2k/background.webp",
      "available": true
    },
    {
      "id": "ts",
      "title": "Tiberian Sun",
      "version": "release-20250308",
      "description": "The Second Tiberium War rages on a shattered Earth.",
      "factions": ["GDI", "Nod"],
      "thumbnail": "/mods/ts/thumbnail.webp",
      "background": "/mods/ts/background.webp",
      "available": false
    }
  ]
}
```

### 5.4 Mod Selector Implementation

```typescript
// src/OpenRA.Game/ModSelector.ts (conceptual)
//
// OpenRA 对照: 无直接对应。OpenRA C# 使用 SDL2 窗口 + Widget 主菜单。
// TypeScript 版本在引擎启动前使用轻量 DOM 选择器。

export interface ModEntry {
  id: string
  title: string
  version: string
  description: string
  factions: string[]
  thumbnail: string
  background: string
  available: boolean
}

/**
 * Mod selection page. Renders mod cards, handles click-to-launch.
 *
 * This is a standalone module that runs WITHOUT the game engine.
 * It mounts into the #app div and replaces itself when a mod is launched.
 */
export class ModSelector {
  /**
   * Render the mod selection page into a DOM element.
   * Called by main.ts when the current route is '/'.
   */
  static async show(container: HTMLElement): Promise<void>

  /**
   * Launch a mod. This loads the game engine and transitions to /play/:modId.
   * Called when a user clicks a mod card's "Play" button.
   */
  static async launchMod(modId: string, worldType?: WorldType): Promise<void>

  /**
   * Hide the mod selector (called before transitioning to game view).
   */
  static hide(): void
}
```

### 5.5 State Transitions

```
URL: /                     URL: /play/ra
─────────                    ──────────
ModSelector.show()          Game.create(canvas, "ra")
  │                           │
  │  [User clicks RA card]    ├── fetch /mods/ra/mod.json
  ├── ModSelector.launchMod() ├── new Manifest("ra", json)
  │   ├── Push history state  ├── loadMod("ra")
  │   ├── Hide mod cards      ├── loadShellMap()
  │   ├── Show loading bar    ├── Show main menu widgets
  │   ├── Create <canvas>     └── Engine.runRenderLoop()
  │   ├── Dynamic import of
  │   │  Game.ts + all deps
  │   └── await Game.create()
  └── Canvas takes over #app
```

---

## 6. Shellmap Strategy

### 6.1 What is a Shellmap?

In OpenRA, the "shellmap" is a fully functional game world that runs as an animated background behind the main menu. It features AI-controlled skirmishes, ambient battles, and weather effects -- giving the main menu visual appeal and demonstrating the engine capabilities.

### 6.2 Phased Approach

**Phase 1 (immediate): Static Background**

No shellmap world is loaded. The main menu Widget tree renders over a static CSS background image or solid color.

Implementation:
- After `Game.create()`, skip `loadShellMap()`
- Renderer creates worldScene but leaves it empty (just the clear color)
- UI widgets render on the uiScene overlay
- User sees: Main menu buttons over a dark/colored background

**Phase 2 (optional, later): Static Map Preview**

A single-frame render of a map preview image (pre-baked PNG) displayed as a Babylon.js plane behind the UI.

**Phase 3 (full): Dynamic Shellmap**

Full shellmap with AI skirmish. Requires:
- Working map cache with shellmap-flagged maps
- Complete actor system (Chapter 3 done)
- Complete trait system for AI behavior (Chapters 9-14 done)
- Pathfinding (Chapter 4 Phase G done)
- Weapons and combat (Chapter 8 done)

Since Chapters 2-20 are complete, Phase 3 is architecturally feasible now, but requires real mod assets (.oramap files, sprite sheets, etc.) which are not yet bundled.

### 6.3 Shellmap Configuration in Game

```typescript
// Inside Game.ts
async loadShellMap(): Promise<void> {
  // Phase 1: Static background (always works)
  if (!this.modData || this.modData.mapCache.size === 0) {
    // No maps available -- use static background
    this.setShellmapFallback()
    return
  }

  // Phase 3: Full dynamic shellmap
  try {
    const shellmapUid = this.chooseShellmap()
    if (shellmapUid) {
      await this.startGame(shellmapUid, WorldType.Shellmap)
      return
    }
  } catch {
    // Fall through to static background
  }

  this.setShellmapFallback()
}

private setShellmapFallback(): void {
  // Set worldScene clear color to a dark RTS-appropriate color
  this.renderer.worldScene.clearColor = new Color4(0.05, 0.05, 0.1, 1.0)
  // Shellmap world remains null; UI widgets render over empty scene
}
```

---

## 7. Editor Integration (Chapter 21)

### 7.1 Editor Route

The `/editor/{modId}` route loads the game in Editor mode (`WorldType.Editor`).

```typescript
// Inside Game.create()
if (worldType === WorldType.Editor) {
  await game.loadMod(modId)
  // Editor requires a map to edit -- either a new blank map or an existing one
  const mapUid = params.mapId ?? await createBlankMap()
  await game.startGame(mapUid, WorldType.Editor)
  // Editor-specific widgets are loaded by World.LoadComplete()
  // See Chapter 21 Phase A-C for editor brush/UI migration
}
```

### 7.2 Deferred Features

The editor route is fully deferred to Chapter 21. Until then:
- `/editor/ra` returns a placeholder page: "Editor coming soon"
- The Game class supports `WorldType.Editor` in its type system but defers the editor-specific loading logic

### 7.3 Shared Infrastructure

Both `/play/:modId` and `/editor/:modId` share:
- Same `Game.create()` factory
- Same `loadMod()` pipeline
- Same Renderer / FileSystem / ModData initialization
- Different WorldType passed to `startGame()`

---

## 8. File Structure & Directory Layout

### 8.1 New Files

```
src/
  main.ts                            ← REWRITE: Router + bootstrap
  OpenRA.Game/
    Game.ts                          ← NEW: Game class (root coordinator)
    Game.test.ts                     ← NEW: Game unit tests
    ModSelector.ts                   ← NEW: Mod selection page
    ModSelector.test.ts              ← NEW: Mod selector unit tests
    Router.ts                        ← NEW: Client-side path router
    Router.test.ts                   ← NEW: Router unit tests

public/
  mods/
    _index.json                      ← NEW: Available mods manifest
    _test/                           ← NEW: Minimal test mod
      mod.json
      chrome/
        test.yaml (or JSON)
      metrics.yaml (or JSON)
    ra/                              ← NEW (stub): Red Alert mod
      mod.json
    td/                              ← NEW (stub): Tiberian Dawn mod
      mod.json
    d2k/                             ← NEW (stub): Dune 2000 mod
      mod.json
    ts/                              ← NEW (stub): Tiberian Sun mod
      mod.json
```

### 8.2 Modified Files

```
index.html                           ← REWRITE: Game shell (canvas + loader)
vite.config.ts                       ← CHANGE: Remove appType:'mpa', keep test plugin
package.json                         ← No changes (no new dependencies)
```

### 8.3 index.html Structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenRAWeb3D</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <!-- Phase 1: Mod selection (visible at /, hidden after mod launch) -->
  <div id="mod-selector"></div>

  <!-- Phase 2: Game canvas (invisible until mod is launched) -->
  <canvas id="game-canvas" style="display:none; width:100%; height:100%"></canvas>

  <!-- Loading overlay (shown during mod loading) -->
  <div id="loading-overlay" style="display:none">
    <div id="loading-progress">
      <div id="loading-bar"></div>
      <span id="loading-text">Loading...</span>
    </div>
  </div>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

---

## 9. Implementation Phases

### Phase 1: Foundation (no game engine, no mod assets)

| Step | File | Description |
|---|---|---|
| 1.1 | `src/OpenRA.Game/Router.ts` | Minimal path router (no deps) |
| 1.2 | `src/OpenRA.Game/ModSelector.ts` | Static HTML mod cards, loads `_index.json` |
| 1.3 | `src/main.ts` | Read URL, dispatch to ModSelector or 404 |
| 1.4 | `index.html` | Replace Vite template with mod selector shell |
| 1.5 | `vite.config.ts` | Switch to SPA mode |
| 1.6 | `public/mods/_index.json` | Create stub mod index with 4 mods |
| 1.7 | `public/mods/_test/mod.json` | Create minimal test mod manifest |

**Validation**: Visit `http://localhost:5173/` -- see mod cards. Click a card -- see loading state. No game engine loaded yet.

### Phase 2: Game Bootstrapping (engine + mod loading, no world)

| Step | File | Description |
|---|---|---|
| 2.1 | `src/OpenRA.Game/Game.ts` | Game class with `create()`, `loadMod()`, `dispose()` |
| 2.2 | `src/OpenRA.Game/Game.test.ts` | Test Game lifecycle (mock Babylon.js) |
| 2.3 | `src/main.ts` | Wire ModSelector.launchMod() → Game.create() |
| 2.4 | `public/mods/_test/` | Ensure FileSystem can mount from public/ |

**Validation**: Click "Play" on a mod card → Engine initializes → mod.json loaded → ModData created → loading progress shown. No world (just empty scene). Disposal works.

### Phase 3: Main Menu (shellmap + widgets)

| Step | File | Description |
|---|---|---|
| 3.1 | `src/OpenRA.Game/Game.ts` | Add `loadShellMap()` with Phase 1 static fallback |
| 3.2 | Main menu widget JSON | Create minimal main menu ChromeProvider layout |
| 3.3 | Widget logic | Load main menu buttons (Skirmish, Multiplayer, Settings, etc.) |
| 3.4 | E2E test | Visual verification of mod selection + main menu flow |

**Validation**: Full flow from `/` → click RA card → loading bar → main menu over empty scene → back button returns to mod selector.

### Phase 4: Editor Stub (Chapter 21 placeholder)

| Step | File | Description |
|---|---|---|
| 4.1 | `src/main.ts` | Add `/editor/:modId` route → placeholder page |
| 4.2 | `src/OpenRA.Game/Game.ts` | Ensure `WorldType.Editor` is accepted in type system |

**Validation**: Navigate to `/editor/ra` → see "Editor coming soon" page.

### Phase 5: Real Mod Assets (with actual OpenRA data)

| Step | Description |
|---|---|
| 5.1 | Build pipeline to convert OpenRA `mods/ra/mod.yaml` → `public/mods/ra/mod.json` |
| 5.2 | Convert OpenRA rules/weapons/sequences YAML to JSON |
| 5.3 | Package sprite sheets, audio, map files for web delivery |
| 5.4 | Replace `_test` mod stubs with real data |

**This phase is blocked on**: Asset pipeline tooling (MiniYAML conversion scripts, sprite sheet packing, audio format conversion). See `docs/remaining_systems_migration_plan.md` for asset pipeline tasks.

---

## 10. Architecture Decision Records (ADR)

### ADR-001: Game Class is Instance-Based (Not Static)

**Context**: OpenRA C# uses `static class Game` with all-static members. TypeScript could mirror this, but browser environments and testability requirements differ.

**Decision**: `Game` is an instance class. A module-level `_currentGame` variable provides singleton-like access within a page load.

**Alternatives Considered**:
- **True static class (all static members)**: Matches C# 1:1 but makes testing impossible (global state bleed between tests, can't mock subsystems).
- **Dependency injection container**: Over-engineered for a game with a single WebGL context constraint. Adds complexity without benefit.

**Consequences**:
- Easier: Testing -- each test creates a fresh Game instance.
- Easier: Mod switching -- dispose old Game, create new one.
- Harder: Code must pass Game instance or access via `getCurrentGame()` instead of `Game.Renderer`.
- Migration note: C# code using `Game.Renderer` becomes `game.renderer` or `getCurrentGame().renderer`.

### ADR-002: SPA Mode with Client-Side Router (Not MPA)

**Context**: Current `vite.config.ts` uses `appType: 'mpa'` to support `/test/` pages. The game needs dynamic routes like `/play/ra`, `/play/td` (not feasible with true MPA -- each mod would need its own HTML file).

**Decision**: Switch to `appType: 'spa'` (Vite default) with a minimal client-side router. The test route plugin continues working because Vite processes custom middleware before the SPA fallback.

**Alternatives Considered**:
- **True MPA with build-time HTML generation**: Would need a Vite plugin to generate `play-ra.html`, `play-td.html`, etc. at build time. Brittle, doesn't scale to dynamic mods.
- **Hash-based routing (`/#/play/ra`)**: Works without server support but ugly URLs, no SSR potential.

**Consequences**:
- Easier: Dynamic routes for mods, maps, replays.
- Easier: Code splitting with dynamic `import()`.
- Harder: Need to configure production server with SPA fallback (standard for all SPA deployments).

### ADR-003: Mod Selector Uses Plain DOM (No Widget System, No Game Engine)

**Context**: The project has a complete Widget UI system (Ch5 + Ch16). The homepage could use it, but that requires loading the entire game engine first.

**Decision**: The mod selector at `/` is implemented with plain DOM manipulation and CSS. No Babylon.js, no Widget system, no Game engine. The game engine is loaded lazily when a mod is selected.

**Alternatives Considered**:
- **Widget system for mod selector**: Consistent UI but requires loading ~1 MB of game engine JS before showing the first pixel. Unacceptable page load time.
- **React/Vue/Svelte**: Adds a framework dependency for a single page. Overkill; the mod selector is simple enough for vanilla DOM.

**Consequences**:
- Easier: Instant page load (mod selector JS is < 10 KB).
- Easier: Progressive enhancement -- game engine loads asynchronously.
- Harder: Two UI systems (DOM for selector, Widget system for game). Acceptable because they never coexist in the DOM.

### ADR-004: Mod Assets as Static Files (Not a Single Bundle)

**Context**: OpenRA packages mod assets in `.mix` archive files. For web delivery, we need efficient loading strategies.

**Decision**: Mod assets are deployed as individual static files under `public/mods/{modId}/`. The FileSystem uses `fetch()` to load them on demand. Caching is handled by the browser's HTTP cache + the FileSystem's L1 LRU cache.

**Alternatives Considered**:
- **Single .zip per mod**: Matches OpenRA's `.mix` approach but requires decompression in JS. Added complexity for marginal benefit. Browser HTTP/2 multiplexing handles many small files well.
- **Service Worker + Cache API**: Over-engineered for initial release. Can be added later for offline support.
- **IndexedDB for large asset storage**: Good for future offline mode. See TODO-5.A.4 in FileSystem.

**Consequences**:
- Easier: Simple deployment -- just static files, any CDN works.
- Easier: Debugging -- individual files visible in DevTools.
- Harder: Many small files may be slower on HTTP/1.1 (but HTTP/2 is ubiquitous now).

### ADR-005: Shellmap Phased Rollout

**Context**: OpenRA's shellmap is a fully functional game world requiring all subsystems to be operational. In web context, loading a full game world at startup adds significant latency.

**Decision**: Phase 1 uses a static background color/pattern behind the main menu widgets. Phase 2 upgrades to a pre-rendered map image. Phase 3 enables the full dynamic shellmap.

**Alternatives Considered**:
- **Full shellmap from day 1**: Requires all mod assets + fully tested game loop. Blocks the entire game entry pipeline on having real assets.
- **No shellmap ever**: Loses the visual appeal that makes OpenRA's main menu distinctive.

**Consequences**:
- Easier: MVP ships faster with static background.
- Easier: Each shellmap phase can be developed and tested independently.
- Harder: Need to ensure the Widget system works with or without a World behind it. The Widget system already supports this (widgets can exist without a world).

---

## 11. Testing & Validation Strategy

### 11.1 Unit Tests (Vitest + happy-dom)

| Target | Test File | What to Test |
|---|---|---|
| Router | `Router.test.ts` | Pattern matching, param extraction, dispatch, history push |
| ModSelector | `ModSelector.test.ts` | DOM rendering, card click events, loading state transitions |
| Game | `Game.test.ts` | Lifecycle (create → loadMod → startGame → dispose), state transitions, error handling (missing mod, dependency failure) |

**Mocking strategy**: All `@babylonjs/core` imports are mocked globally (existing vitest setup). FileSystem is mocked to return test data from memory.

### 11.2 Manual Acceptance Tests (Playwright)

| Test Page | URL | What to Verify |
|---|---|---|
| Mod Selector | `/test/ch00-game-entry/mod-selector/` | Mod cards render, hover effects, click navigates |
| Game Loading | `/test/ch00-game-entry/game-loading/` | Loading bar progresses, engine initializes, main menu appears |
| Mod Switch | `/test/ch00-game-entry/mod-switch/` | Switch from RA to TD, verify cleanup and reload |

### 11.3 Pipeline Verification (No Real Assets)

The `_test` mod in `public/mods/_test/` enables end-to-end verification without real OpenRA assets:

1. `fetch('/mods/_test/mod.json')` → parses to `Manifest`
2. `new FileSystem()` → mounts (empty) paths
3. `new ModData(manifest, fileSystem)` → creates ObjectCreator, MapCache
4. `modData.init()` → validates deps, mounts paths
5. `new Renderer(canvas)` → creates Engine, Scenes, cameras
6. Optional: `modData.loadRuleSet()` → returns empty/null Ruleset
7. Game loop starts, renders empty scene, UI widgets show

This verifies the entire architecture works before any real mod content is bundled.

---

## Appendix A: Migrated C# Members Checklist

The following `static class Game` members from OpenRA C# will be accounted for:

| C# Member | TypeScript Counterpart | Status |
|---|---|---|
| `Game.Mods` | `Game.installedMods` or standalone function | Needed for mod switching |
| `Game.ModData` | `game.modData` | Instance field |
| `Game.Settings` | Deferred (Ch21 or earlier settings module) | Stub for now |
| `Game.Renderer` | `game.renderer` | Instance field |
| `Game.Sound` | `game.sound` | Instance field |
| `Game.OrderManager` | `game.orderManager` | Instance field |
| `Game.Cursor` | `game.cursor` or Renderer-managed | Instance field |
| `Game.worldRenderer` | `game.worldRenderer` (private) | Instance field |
| `Game.CosmeticRandom` | `game.cosmeticRandom` | Instance field |
| `Game.RunTime` | `performance.now()` | Browser native |
| `Game.RenderFrame` | `game.renderFrame` | Instance field |
| `Game.LocalTick` | `game.orderManager.localFrameNumber` | Delegated |
| `Game.InitializeAndRun(args)` | `Game.create(canvas, modId, worldType)` | Instance factory |
| `Game.InitializeMod(manifest, args)` | `game.loadMod(modId)` | Instance method |
| `Game.LoadShellMap()` | `game.loadShellMap()` | Instance method |
| `Game.StartGame(map, type)` | `game.startGame(mapUid, worldType)` | Instance method |
| `Game.LoadEditor(uid)` | `game.startGame(uid, WorldType.Editor)` | Instance method |
| `Game.Run()` | `renderer.engine.runRenderLoop()` | Babylon.js managed |
| `Game.Exit()` | `game.dispose()` | Instance method |
| `Game.JoinServer(endpoint, password)` | `game.joinServer(endpoint, password)` | Deferred (networking) |
| `Game.JoinLocal()` | `game.joinLocal()` | Instance method |
| `Game.CreateObject<T>(name)` | `game.modData.objectCreator.createObject<T>(name)` | Delegated to ModData |
| `Game.OpenWindow(world, widget)` | Widget system (via UI root) | Delegated to WidgetLoader |

---

## Appendix B: Open Questions (for Manager Review)

1. **Mod asset conversion pipeline**: Who is responsible for the build step that converts OpenRA's `mod.yaml` + MiniYAML files to `public/mods/{id}/mod.json`? This is a prerequisite for Phase 5 (real assets). The MiniYAML pipeline (`src/utils/miniyaml-to-json.ts`) exists, but a build script that runs it against the OpenRA mod directories is needed.

2. **Hotkeys/Settings persistence**: The C# `Game.InitializeSettings(args)` creates a `Settings` object backed by a YAML file. In the browser, settings need to persist via `localStorage`. Is the Settings module migration planned for a specific chapter, or should it be handled as part of the Game entry work?

3. **Multiplayer timeline**: The C# `Game.JoinServer()` and the Server system (Chapter 18, migrated) are available. Should the main menu include a "Multiplayer" button, even if it just shows "Coming Soon" in Phase 1?

4. **Vite config change approval**: Switching from `appType: 'mpa'` to SPA mode is a breaking change for the test page URLs. The test pages will continue working (test plugin runs first), but this should be explicitly approved before implementation.
