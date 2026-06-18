# OpenRA to Babylon.js Migration Plan: Chapter 22 -- Game Entry & Application Shell

> **Source Reference**: `OpenRA/OpenRA.Game/Game.cs` (~1000 lines, `static class Game`), `index.html` (Vite scaffold), `src/main.ts` (Vite scaffold)
> **Chapter Status**: IN PROGRESS (6/7 migrated, 86%, Phases A-B COMPLETE)
> **Planning Date**: 2026-06-18
> **Phase A Completion**: 2026-06-18 (Router: 146 lines + 271 test lines, ModSelector: 249 lines + 438 test lines, 51 tests, 0 BLOCKERs)
> **Phase B Completion**: 2026-06-18 (Game: 588 lines + 1056 test lines, 47 tests, 0 BLOCKERs)
> **Original Design Doc**: `docs/game_entry_design.md` (1090 lines, ~2026-06-18)
> **Prerequisite**: Chapters 2-20 COMPLETE (665/665, 100%). No hard dependency on Chapter 21 (Editor & Utilities). Chapter 22 can begin in parallel with Chapter 21.
> **Note**: Chapter 22 is the **final integration chapter** -- it stitches all migrated subsystems together into a functional web application accessible from a browser URL.
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Foundation -- Router + ModSelector](#31-phase-a-foundation--router--modselector)
   - 3.2 [Phase B: Bootstrap -- Game Class + Mod Loading](#32-phase-b-bootstrap--game-class--mod-loading)
   - 3.3 [Phase C: Main Menu -- Shellmap + Widgets](#33-phase-c-main-menu--shellmap--widgets)
   - 3.4 [Phase D: Editor Stub](#34-phase-d-editor-stub)
   - 3.5 [Phase E: Real Assets](#35-phase-e-real-assets)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

Chapter 22 is the **final integration chapter** of the OpenRAWeb3D migration. It transforms the Vite template placeholder at `src/main.ts` into the OpenRAWeb3D game entry point, connecting the mod selection homepage, game bootstrapping pipeline, and Babylon.js rendering engine into a cohesive single-page application.

The core paradigm shifts:

- **C# `static class Game` (SDL2 Window)** to **TypeScript `class Game` instance (HTML Canvas + Babylon.js Engine)**: OpenRA's C# root coordinator is a static class that owns an SDL2 window, OpenGL context, and all subsystem instances. In TypeScript, `Game` is an instance class that owns an HTML `<canvas>` element, Babylon.js `Engine`, and subsystem instances. The instance pattern enables testability and clean disposal.
- **C# CLI entry point (`Program.Main()`)** to **Browser URL routing (SPA + client-side Router)**: OpenRA starts via a desktop executable. TypeScript entry is via `index.html` + `src/main.ts`, with URL-based routing (`/`, `/play/:modId`, `/editor/:modId`).
- **C# SDL2 event loop** to **Babylon.js `Engine.runRenderLoop()`**: The fixed-timestep game loop (logic at 25 TPS, render at display refresh) is driven by `requestAnimationFrame` via Babylon.js.
- **C# `ModBrowserWidget` (in-game mod selector)** to **Standalone DOM mod selector (no engine loaded)**: The `ModSelector` at `/` is a lightweight plain DOM page. The game engine (~1 MB gzipped) loads lazily only after the user selects a mod. This decision is documented in ADR-22.3.
- **Vite MPA mode (`appType: 'mpa'`)** to **Vite SPA mode (default)**: The `vite.config.ts` switches from MPA to SPA mode, with a client-side `Router` handling dynamic routes. The existing `/test/` plugin middleware intercepts test URLs before the SPA fallback (ADR-22.2).

### 1.2 Architecture Principles

1. **Progressive Loading**: The game engine loads lazily. The homepage (`/`) loads in < 10 KB of JS with instant paint. Babylon.js and all game subsystems are loaded only after mod selection.
2. **Single WebGL Context**: Only one Babylon.js `Engine` (hence one WebGL context) exists at any time. Mod switching disposes the existing `Game` instance and creates a new one. Multiple concurrent `Game` instances are not supported.
3. **Instance-Based Game Class**: `Game` is an instance class (not static). A module-level `_currentGame` variable provides singleton-like access within a page load. This enables testing with fresh instances and explicit `dispose()` for GPU resource cleanup.
4. **Client-Side URL Routing**: The Router matches path patterns (`/`, `/play/:modId`, `/editor/:modId`) and dispatches to handlers. Browser history is maintained via `history.pushState()`.
5. **Mod Assets as Static Files**: Mod manifests and assets are deployed as static files under `public/mods/{modId}/`. The `FileSystem` uses `fetch()` to load them on demand. HTTP caching provides distribution.
6. **Shellmap Phased Rollout**: Shellmap support progresses from static background (Phase C) to pre-rendered map image to full dynamic AI skirmish. This prevents the shellmap from blocking the MVP.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-20 is available for Chapter 22:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, post-processing |
| World + Actor + Player | Ch3 | `GameWorldManager`, `GameActor`, `Player`, trait attachment |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA* pathfinder, `TerrainMeshBuilder` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()` |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest`, `IPackage` |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 | `Order`, `UnitOrders`, `OrderManager` |
| Input + Camera + Selection | Ch7 | `InputHandler`, `Viewport`, `SelectionUtils` |
| Audio System | Ch7 Phase D | `Sound`, `SoundDevice` |
| All Gameplay Systems | Ch8-20 | Weapons, movement, production, shroud, etc. |
| Server System | Ch18 | `Server`, `Connection`, `OrderBuffer` -- needed for multiplayer |

### 1.4 Chapter 22 File Inventory

| Category | Count | Details |
|----------|:-----:|---------|
| **New implementation files** | 4 | `Game.ts`, `ModSelector.ts`, `Router.ts`, `main.ts` (rewrite) |
| **New test files** | 3 | `Game.test.ts`, `ModSelector.test.ts`, `Router.test.ts` |
| **Modified existing files** | 2 | `index.html` (rewrite), `vite.config.ts` (SPA mode switch) |
| **New static assets** | 6+ | `public/mods/_index.json`, `public/mods/_test/mod.json`, 4 mod stub `mod.json` files |
| **Architecture Decisions** | 5 | ADR-22.1 through ADR-22.5 |
| **Implementation Phases** | 5 | Foundation, Bootstrap, Main Menu, Editor Stub, Real Assets |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (7 files across 5 Phases)

| # | Source / Origin | Target TypeScript File | Class/Interface | Description | Phase |
|:---:|:---|:---|:---|:---|:---:|
| **Phase A: Foundation** | | | | | |
| 1 | New (no C# equivalent) | `src/OpenRA.Game/Router.ts` | `Router` | Client-side path router with pattern matching (`/play/:modId`) | A |
| 2 | New (no C# equivalent) | `src/OpenRA.Game/Router.test.ts` | Router tests | Pattern matching, param extraction, history push, dispatch | A |
| 3 | New (no C# equivalent) | `src/OpenRA.Game/ModSelector.ts` | `ModSelector` | Static HTML mod cards, fetches `_index.json`, click-to-launch | A |
| 4 | New (no C# equivalent) | `src/OpenRA.Game/ModSelector.test.ts` | ModSelector tests | DOM rendering, card click events, loading state transitions | A |
| *A+* | `vite.config.ts` (existing) | `vite.config.ts` | Vite config change | Remove `appType: 'mpa'`, switch to SPA mode | A |
| *A+* | `index.html` (existing) | `index.html` | Game shell rewrite | Canvas + loader overlay + mod selector div | A |
| **Phase B: Bootstrap** | | | | | |
| 5 | `OpenRA/OpenRA.Game/Game.cs` | `src/OpenRA.Game/Game.ts` | `Game` | Root coordinator: Engine creation, `loadMod()`, `startGame()`, `loadShellMap()`, `dispose()` | B |
| 6 | New (no C# equivalent) | `src/OpenRA.Game/Game.test.ts` | Game tests | Lifecycle (create→loadMod→startGame→dispose), state transitions, error handling | B |
| *B+* | `src/main.ts` (existing) | `src/main.ts` | Main entry rewrite | Router dispatch, ModSelector.show(), Game.create() wiring | B |
| **Phase C: Main Menu** | | | | | |
| *C* | No new source files | — | — | Extend Game.ts with `loadShellMap()` Phase 1 fallback; create minimal main menu widget JSON | C |
| **Phase D: Editor Stub** | | | | | |
| *D* | No new source files | — | — | Add `/editor/:modId` route to main.ts → placeholder page | D |
| **Phase E: Real Assets** | | | | | |
| *E* | No new source files | — | — | Build pipeline for OpenRA mod data → `public/mods/{id}/` | E |

### 2.2 New Static Resource Files

| # | File Path | Description | Phase |
|:---:|:---|:---|:---:|
| SR1 | `public/mods/_index.json` | Available mods manifest (mod ID, title, description, thumbnail, availability) | A |
| SR2 | `public/mods/_test/mod.json` | Minimal test mod manifest (no terrain, no actors, no rules) | A |
| SR3 | `public/mods/ra/mod.json` | Red Alert mod stub manifest | E |
| SR4 | `public/mods/td/mod.json` | Tiberian Dawn mod stub manifest | E |
| SR5 | `public/mods/d2k/mod.json` | Dune 2000 mod stub manifest | E |
| SR6 | `public/mods/ts/mod.json` | Tiberian Sun mod stub manifest (marked unavailable) | E |

### 2.3 Modified Existing Files

| # | File Path | Change Description | Phase |
|:---:|:---|:---|:---:|
| M1 | `index.html` | Replace Vite scaffold template with game shell: `#mod-selector` div, `#game-canvas` canvas, `#loading-overlay` div | A |
| M2 | `vite.config.ts` | Remove `appType: 'mpa'` (revert to SPA default); test routes plugin remains unchanged | A |

### 2.4 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total new implementation files** | 4 (Game.ts, ModSelector.ts, Router.ts, main.ts rewrite) |
| **Total new test files** | 3 (Game.test.ts, ModSelector.test.ts, Router.test.ts) |
| **Modified existing source files** | 2 (index.html, vite.config.ts) |
| **New static resource files** | 6 (mod index + 5 mod manifests) |
| **Implementation phases** | 5 (A-E) |
| **C# source reference lines** | ~1000 (Game.cs + related) |
| **Estimated TS implementation lines** | ~1,200 (Router: ~100, ModSelector: ~250, Game: ~600, main.ts: ~250) |
| **Estimated test lines** | ~800 (Router: ~200, ModSelector: ~250, Game: ~350) |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Foundation -- Router + ModSelector

**Status**: ✅ COMPLETE (4/4 files migrated + 2 files modified + 2 static resources, 51 tests, 0 BLOCKERs)
**Completed**: 2026-06-18 | **Commit**: `686b312`
**Complexity**: Low-Medium
**Blocked by**: Nothing (Phase A uses zero game engine dependencies)
**Blocks**: Phase B (Bootstrap needs Router + ModSelector for URL routing and mod launch flow)
**ADR Reference**: ADR-22.2 (SPA mode), ADR-22.3 (DOM mod selector)

**Description**: Establish the client-side routing infrastructure and mod selection homepage. This phase loads NO game engine code -- the entire mod selector is under 10 KB of JavaScript. The Vite build switches from MPA to SPA mode. The `index.html` is rewritten from the Vite scaffold template to the game application shell (canvas, loader overlay, mod selector container).

**Paradigm Shifts**:
- Vite MPA (`appType: 'mpa'`) → Vite SPA (default) with client-side Router
- Vite scaffold HTML → Game application shell (canvas + mod selector + loading overlay)
- No C# equivalent for ModSelector (C# uses in-game Widget mod browser after engine is loaded)

#### 3.1.1 Router Implementation

- [x] **TODO-22.A.1** `src/OpenRA.Game/Router.ts` -- Client-side path router:
  - `RouteHandler` type: `(params: Record<string, string>) => void`
  - `on(pattern: string, handler: RouteHandler): this` -- register path pattern (e.g., `"/play/:modId"`)
  - `dispatch(): boolean` -- match current `window.location.pathname` against registered patterns, extract params via regex (`:param` → `([^/]+)`), call handler, return `true` if matched
  - `navigate(path: string): void` -- push history state via `history.pushState()`, call `dispatch()`
  - `popstate` event listener for browser back/forward
  - Zero dependencies, zero imports from game engine

- [x] **TODO-22.A.2** `src/OpenRA.Game/Router.test.ts` -- Router unit tests:
  - Pattern matching: exact (`"/"`), parameterized (`"/play/:modId"`), multi-param (`"/edit/:modId/:mapId"`)
  - Param extraction: verify `params.modId` matches URL segment
  - Dispatch: verify correct handler is called based on pathname
  - History: verify `navigate()` updates `window.location.pathname` and triggers handler
  - Popstate: verify back button triggers correct handler
  - No-match: verify `dispatch()` returns `false` for unknown paths

#### 3.1.2 ModSelector Implementation

- [x] **TODO-22.A.3** `src/OpenRA.Game/ModSelector.ts` -- Mod selection homepage:
  - `ModEntry` interface: `id`, `title`, `version`, `description`, `factions`, `thumbnail`, `background`, `available`
  - `ModSelector.show(container: HTMLElement): Promise<void>` -- fetch `_index.json`, render mod cards into container DOM, attach click handlers
  - `ModSelector.launchMod(modId: string, worldType?: WorldType): Promise<void>` -- hide mod cards, show loading overlay, create `<canvas>`, dynamically `import()` Game module, call `Game.create()`
  - `ModSelector.hide(): void` -- remove mod selector DOM, clean up
  - Progressive enhancement: show loading bar phase text ("Loading engine...", "Loading mod...", "Starting shellmap...")
  - Handle `available: false` mods (show "Coming Soon" ribbon)
  - CSS styling: mod cards in responsive grid, hover effects, C&C-themed dark background

- [x] **TODO-22.A.4** `src/OpenRA.Game/ModSelector.test.ts` -- ModSelector unit tests:
  - DOM rendering: verify mod cards are created from `_index.json` data
  - Click handler: verify `launchMod()` is called with correct modId
  - Loading state: verify overlay appears, progress text updates
  - Unavailable mod: verify "Coming Soon" ribbon renders, click prevented
  - Empty mod list: verify graceful empty state message
  - Hide: verify DOM is cleaned up after `hide()`

#### 3.1.3 Vite Configuration Change

- [x] **TODO-22.A.5** `vite.config.ts` -- Switch to SPA mode:
  - Remove `appType: 'mpa'` from Vite config (revert to default SPA behavior)
  - Keep `testRoutesPlugin` -- it intercepts `/test/...` URLs before the SPA fallback
  - Verify: `npm run dev` serves all `/test/...` pages correctly
  - Verify: non-test, non-asset URLs (e.g., `/play/ra`) serve `index.html` (SPA fallback)
  - No other Vite config changes needed

#### 3.1.4 HTML Shell Rewrite

- [x] **TODO-22.A.6** `index.html` -- Game application shell:
  - Replace Vite scaffold content with game shell layout
  - Add `<div id="mod-selector">` -- container for ModSelector (visible at `/`, hidden after mod launch)
  - Add `<canvas id="game-canvas" style="display:none">` -- Babylon.js render target (invisible until mod is launched)
  - Add `<div id="loading-overlay" style="display:none">` with `<div id="loading-bar">` and `<span id="loading-text">Loading...</span>`
  - Keep `<script type="module" src="/src/main.ts">` entry point
  - Update `<title>` to "OpenRAWeb3D"
  - Style: dark background, full-viewport layout, system font stack

#### 3.1.5 Mod Index & Test Mod

- [x] **TODO-22.A.7** `public/mods/_index.json` -- Available mods manifest:
  - Array of `ModEntry` objects with `id`, `title`, `version`, `description`, `factions`, `thumbnail`, `background`, `available` fields
  - 4 mods: ra (available), td (available), d2k (available), ts (available: false)

- [x] **TODO-22.A.8** `public/mods/_test/mod.json` -- Minimal test mod manifest:
  - `Metadata.Title: "Test Mod"`, `Metadata.Hidden: true`, `Metadata.Version: "0.1.0"`
  - Empty `RequiresMods`, `FileSystem`, `Rules`, `Sequences`, `Weapons`, `TileSets`
  - Empty `ChromeLayout`, `PackageFormats`, `MapFolders`
  - Minimal `Chrome` and `ChromeMetrics` (empty widget tree)
  - Purpose: verify Game → ModData → Renderer initialization pipeline without real mod assets

### 3.2 Phase B: Bootstrap -- Game Class + Mod Loading

**Status**: ✅ COMPLETE (2/2 files migrated + 1 file modified, 81 tests)
**Completed**: 2026-06-18 | **Commits**: `0a6e5d8` (initial), `ec88735` (review fixes)
**Complexity**: HIGH
**Blocked by**: Phase A (Router + ModSelector provide URL routing and mod launch entry point)
**Blocks**: Phase C (Main Menu needs Game class with loadShellMap support), Phase D (Editor Stub needs Game class with WorldType.Editor type support)
**ADR Reference**: ADR-22.1 (instance-based Game class)

**Description**: Implement the `Game` class -- the root coordinator that owns and initializes all subsystem lifecycles. This is the TypeScript equivalent of OpenRA's `static class Game.cs` (~1000 lines), adapted for browser environment and Babylon.js. The Game class creates the Babylon.js Engine, initializes the Renderer, loads the mod (fetch manifest → create ModData → mount filesystem → load ruleset), starts the game world (or shellmap), and manages the fixed-timestep game loop. The `main.ts` entry point is rewritten to wire Router → ModSelector → Game.

**Paradigm Shifts**:
- C# `static class Game` (global singleton) → TypeScript `class Game` (instance + module-level `_currentGame`)
- C# `Game.InitializeAndRun(args)` → TypeScript `Game.create(canvas, modId, worldType)` static async factory
- C# `Game.InitializeMod(manifest, args)` → TypeScript `game.loadMod(modId)` instance method
- C# `Game.LoadShellMap()` → TypeScript `game.loadShellMap()` with Phase 1 static fallback
- C# `Game.Run()` while-loop → Babylon.js `Engine.runRenderLoop()` with fixed-timestep accumulator

#### 3.2.1 Game Class Implementation

- [x] **TODO-22.B.1** `src/OpenRA.Game/Game.ts` -- Game class (root coordinator):
  
  **Lifecycle States**:
  - `GameState` enum: `Uninitialized`, `LoadingMod`, `Shellmap`, `Playing`, `Editor`, `Disposed`
  
  **Static Factory**:
  - `Game.create(canvas: HTMLCanvasElement, modId: string, worldType?: WorldType): Promise<Game>`
    - `WorldType` enum: `Regular`, `Shellmap`, `Editor`
    - Creates and initializes a Game instance, returns when in Shellmap/Playing state

  **Subsystem Instances** (mirror C# Game static fields):
  - `renderer: Renderer` -- created during `initializeEngine()`
  - `sound: Sound | null` -- created during `loadMod()`
  - `modData: ModData | null` -- created during `loadMod()`
  - `orderManager: OrderManager | null` -- created during `loadMod()`
  - `world: GameWorldManager | null` -- created during `startGame()`
  - `worldRenderer: WorldRenderer | null` -- created during `startGame()`
  - `state: GameState` -- current lifecycle state
  - `currentModId: string | null` -- currently loaded mod ID

  **Initialization Sequence** (mirrors `Game.InitializeAndRun()`):
  - `initializeEngine(canvas)`: Create Babylon.js `Engine`, create `Renderer`, start `Engine.runRenderLoop()`
  - `loadMod(modId)`: Fetch `mod.json`, create `Manifest`, create `FileSystem`, mount paths, create `ModData`, call `modData.init()`, load ruleset, initialize `Sound`, create `OrderManager` (local single-player via `EchoConnection`)
  - `startGame(mapUid, worldType)`: Prepare map, create `World`, create `WorldRenderer`, call `world.LoadComplete()`, start orders
  - `loadShellMap()`: Phase 1 static background fallback (ADR-22.5); Phase 3 full dynamic shellmap

  **Game Loop** (hooks into `Engine.runRenderLoop()`):
  - Fixed-timestep logic tick at 25 TPS (with accumulator from `engine.getDeltaTime()`)
  - Render tick every frame
  - Pause guard: no logic ticks when paused
  - Dispose guard: no ticks when disposed

  **Mod Switching**:
  - `switchMod(modId: string): Promise<void>` -- disposes current world + mod data, reloads new mod

  **Disposal**:
  - `dispose(): void` -- reverse creation order: World → WorldRenderer → OrderManager → Cursor → Sound → ModData → Renderer → Engine

  **C# Member Mapping**:
  | C# `Game` Member | TypeScript Counterpart |
  |---|---|
  | `Game.Mods` | `Game.installedMods` or standalone function |
  | `Game.ModData` | `game.modData` |
  | `Game.Renderer` | `game.renderer` |
  | `Game.Sound` | `game.sound` |
  | `Game.OrderManager` | `game.orderManager` |
  | `Game.Cursor` | `game.renderer.cursor` (or dedicated field) |
  | `Game.worldRenderer` | `game.worldRenderer` (private) |
  | `Game.RunTime` | `performance.now()` (browser native) |
  | `Game.RenderFrame` | `game.renderFrame` |
  | `Game.LocalTick` | `game.orderManager.localFrameNumber` |
  | `Game.InitializeAndRun(args)` | `Game.create(canvas, modId, worldType)` |
  | `Game.InitializeMod(manifest, args)` | `game.loadMod(modId)` |
  | `Game.LoadShellMap()` | `game.loadShellMap()` |
  | `Game.StartGame(map, type)` | `game.startGame(mapUid, worldType)` |
  | `Game.Run()` | `renderer.engine.runRenderLoop()` |
  | `Game.Exit()` | `game.dispose()` |
  | `Game.JoinServer(endpoint, pw)` | `game.joinServer(endpoint, pw)` (deferred) |
  | `Game.JoinLocal()` | `game.joinLocal()` |
  | `Game.CreateObject<T>(name)` | `game.modData.objectCreator.createObject<T>(name)` |
  | `Game.OpenWindow(world, widget)` | Widget system (via UI root) |

- [x] **TODO-22.B.2** `src/OpenRA.Game/Game.test.ts` -- Game class unit tests:
  - Lifecycle: `create()` → `dispose()` full round-trip
  - State transitions: `Uninitialized` → `LoadingMod` → `Shellmap` → `Disposed`
  - `loadMod()`: verify manifest fetched, ModData created, Sound initialized
  - `loadMod()` error handling: missing mod, invalid manifest, dependency failure
  - `startGame()`: verify World + WorldRenderer created
  - `loadShellMap()`: verify fallback path when no maps available
  - `dispose()`: verify all subsystems disposed in correct order
  - `switchMod()`: verify old mod disposed, new mod loaded
  - Game loop: verify logic ticks at 25 TPS, render ticks at display rate
  - Babylon.js mock strategy: all `@babylonjs/core` imports mocked via vitest global mocks

#### 3.2.2 Main Entry Point Rewrite

- [x] **TODO-22.B.3** `src/main.ts` -- Application entry point:
  - Create `Router` instance
  - Register route `"/"` → `ModSelector.show(document.getElementById('mod-selector')!)`
  - Register route `"/play/:modId"` → extract `modId`, call `ModSelector.launchMod(modId, WorldType.Regular)`
  - Register route `"/editor/:modId"` → show placeholder "Editor coming soon" (see Phase D)
  - Call `router.dispatch()` on initial page load
  - Listen for `popstate` events via Router
  - Replace all Vite scaffold code (counter, hero image, documentation links)

### 3.3 Phase C: Main Menu -- Shellmap + Widgets

**Status**: 📋 PLANNING (0/0 files, extension of Game.ts from Phase B)
**Complexity**: Medium
**Blocked by**: Phase B (Game class must exist to extend with shellmap support)
**Blocks**: Phase E (shellmap is a visual prerequisite for the full main menu experience)
**ADR Reference**: ADR-22.5 (shellmap phased rollout)

**Description**: Extend the Game class with shellmap support following the three-phase strategy. Phase 1 (immediate): static background color behind main menu widgets. Create a minimal main menu widget JSON layout with basic buttons (Skirmish, Settings, etc.). The main menu renders on top of the Babylon.js scene with a static clear color.

**Paradigm Shifts**:
- C# `Game.LoadShellMap()` full AI skirmish → TypeScript three-phase rollout: static → preview image → dynamic AI

#### 3.3.1 Shellmap Fallback

- [ ] **TODO-22.C.1** Extend `Game.ts` -- `loadShellMap()` with Phase 1 static fallback:
  - If no maps available (empty map cache): set `renderer.worldScene.clearColor` to dark RTS-appropriate color
  - If maps available: attempt full shellmap (Phase 3), catch errors → fallback to static
  - `chooseShellmap()`: pick random shellmap-flagged map from map cache
  - `setShellmapFallback()`: dark background with opacity 1.0

#### 3.3.2 Main Menu Widgets

- [ ] **TODO-22.C.2** Create minimal main menu ChromeProvider widget layout:
  - Main menu buttons: "Skirmish" (stub), "Multiplayer" (Coming Soon), "Settings" (stub), "Exit to Desktop" (navigate to `/`)
  - Widget layout in `public/mods/_test/chrome/mainmenu.yaml` (or JSON)
  - Leverage existing Ch5 Widget system (Widget, ButtonWidget, LabelWidget from Ch16)
  - Main menu renders as UI overlay on `renderer.uiScene`

#### 3.3.3 Acceptance Test

- [ ] **TODO-22.C.3** E2E acceptance test page at `src/__e2e__/manual/ch22-game-entry/main-menu/`:
  - Verify: Full flow `/` → click RA card → loading bar → main menu over dark background
  - Verify: Browser back button returns to mod selector
  - Verify: Mod selector is cleanly disposed (no memory leak)

### 3.4 Phase D: Editor Stub

**Status**: 📋 PLANNING (0/0 files, extension of main.ts from Phase B)
**Complexity**: Low
**Blocked by**: Phase B (Game class `WorldType.Editor` type system support)
**Blocks**: Chapter 21 Phase C (Editor UI uses `/editor/:modId` route)

**Description**: Add a placeholder route for the map editor. Until Chapter 21 editor phases are complete, visiting `/editor/:modId` shows a "Coming Soon" page. The `Game` class supports `WorldType.Editor` in its type system but defers the editor-specific loading logic to Chapter 21.

#### 3.4.1 Editor Route Placeholder

- [ ] **TODO-22.D.1** Extend `src/main.ts` -- Register `/editor/:modId` route:
  - Route handler renders static placeholder: "Editor coming soon"
  - No game engine loaded for editor stub
  - Navigate back to mod selector via link

#### 3.4.2 WorldType.Editor Type Support

- [ ] **TODO-22.D.2** Extend `Game.ts` -- `WorldType.Editor` type support:
  - `loadMod()` handles `WorldType.Editor` (same pipeline as regular, different `startGame()` call)
  - Defer editor-specific loading to Chapter 21

### 3.5 Phase E: Real Assets

**Status**: 📋 PLANNING (0/0 files, build pipeline work)
**Complexity**: HIGH (external dependency: OpenRA mod data, build pipeline)
**Blocked by**: External factors (see Open Questions below)
**Blocks**: Full game experience with real mod content

**Description**: Build the pipeline that converts OpenRA's `mod.yaml` + MiniYAML rule files to precompiled `public/mods/{id}/mod.json` and JSON asset files. Replace the `_test` mod stubs with real mod data. This phase is a build-tool effort, not a code migration.

#### 3.5.1 Build Pipeline

- [ ] **TODO-22.E.1** Create build script for OpenRA mod conversion:
  - Input: `OpenRA/mods/{ra,td,d2k,ts}/mod.yaml`, `OpenRA/mods/{ra,td,d2k,ts}/rules/*.yaml`, etc.
  - Output: `public/mods/{ra,td,d2k,ts}/mod.json`, `public/mods/{ra,td,d2k,ts}/rules/*.json`, etc.
  - Uses existing MiniYAML pipeline (`src/utils/miniyaml-to-json.ts`) for YAML→JSON conversion
  - Runs as `npm run build:mods` script

#### 3.5.2 Mod Manifest Conversion

- [ ] **TODO-22.E.2** Convert each OpenRA mod's `mod.yaml` to `mod.json`:
  - `OpenRA/mods/ra/mod.yaml` → `public/mods/ra/mod.json`
  - `OpenRA/mods/td/mod.yaml` → `public/mods/td/mod.json`
  - `OpenRA/mods/d2k/mod.yaml` → `public/mods/d2k/mod.json`
  - `OpenRA/mods/ts/mod.yaml` → `public/mods/ts/mod.json`

#### 3.5.3 Asset Conversion

- [ ] **TODO-22.E.3** Convert rule/weapon/sequence YAML files to JSON:
  - Rules files, weapon definitions, sprite sequences, UI chrome layouts
  - Audio configuration files
  - Map manifests and preview images

#### 3.5.4 Mod Index Generation

- [ ] **TODO-22.E.4** Auto-generate `public/mods/_index.json` from converted mod manifests:
  - Extract metadata (title, version, description) from each mod's `mod.json`
  - Add thumbnail/background paths
  - Mark mods as available/unavailable based on build configuration

---

## 4. Dependency Graph

### 4.1 Internal Chapter Dependencies

```
Phase A (Foundation: Router + ModSelector + HTML shell)
  |
  +---> Phase B (Bootstrap: Game class + loadMod + main.ts wiring)
          |
          +---> Phase C (Main Menu: shellmap fallback + main menu widgets)
          |
          +---> Phase D (Editor Stub: /editor/:modId placeholder)
          |
          +---> Phase E (Real Assets: build pipeline, blocked on external dependencies)
```

Phases A-E are strictly sequential. No parallelism within Chapter 22.

### 4.2 External Chapter Dependencies

```
Chapters 2-7 (Foundation) ────+
                               |
Chapter 5 (FileSystem, ModData)├──> Phase B (Game.loadMod needs Manifest, ModData, FileSystem)
                               |
Chapter 3 (World, Actor)      ├──> Phase B (Game.startGame needs World, GameWorldManager)
                               |
Chapter 2 (Renderer)           ├──> Phase B (Game needs Renderer, Babylon.js Engine)
                               |
Chapter 7 Phase D (Sound)      ├──> Phase B (Game initializes Sound)
                               |
Chapter 6 Phase A (Orders)     ├──> Phase B (Game creates OrderManager)
                               |
Chapter 21 Phase A-C (Editor)  ├──> Phase D (Editor stub defers real editor to Ch21)
                               |
Chapter 21 Phase E (Build Tools)├──> Phase E (Build pipeline reuses MiniYAML + utility scripts)
```

### 4.3 Parallelization Opportunities

Chapter 22 has NO hard dependency on Chapter 21. They can run in parallel:
- **Track 1**: Chapter 21 (Editor & Utilities)
- **Track 2**: Chapter 22 (Game Entry & Application Shell)

Phase D (Editor Stub) provides a URL entry point for Chapter 21's editor but is not needed for Ch21 to proceed (Ch21 can use test routes).

---

## 5. Verification and Test Strategy

### 5.1 Unit Tests (Vitest + happy-dom)

| Target | Test File | What to Test |
|--------|-----------|--------------|
| Router | `Router.test.ts` | Pattern matching, param extraction, dispatch, history push, popstate |
| ModSelector | `ModSelector.test.ts` | DOM rendering, card click events, loading state transitions, unavailable mod handling |
| Game | `Game.test.ts` | Lifecycle (create → loadMod → startGame → dispose), state transitions, error handling (missing mod, dependency failure) |

**Mocking strategy**: All `@babylonjs/core` imports are mocked globally (existing vitest setup from Chapter 2). `FileSystem` and `ModData` are mocked to return test data from memory. `fetch` is mocked for `mod.json` and `_index.json` requests.

### 5.2 Manual Acceptance Tests

| Test Page | URL | What to Verify |
|-----------|-----|----------------|
| Mod Selector | `/test/ch22-game-entry/mod-selector/` | Mod cards render, hover effects, click navigates, coming soon ribbon on unavailable mods |
| Game Loading | `/test/ch22-game-entry/game-loading/` | Loading bar progresses through stages, engine initializes, main menu appears over dark background |
| Mod Switch | `/test/ch22-game-entry/mod-switch/` | Switch from Mod A to Mod B, verify cleanup and reload |

### 5.3 Pipeline Verification (No Real Assets)

The `_test` mod in `public/mods/_test/` enables end-to-end verification of the Game entry pipeline without real OpenRA assets:

1. `fetch('/mods/_test/mod.json')` → parses to `Manifest`
2. `new FileSystem()` → mounts (empty) paths
3. `new ModData(manifest, fileSystem)` → creates ObjectCreator, MapCache
4. `modData.init()` → validates deps, mounts paths
5. `new Renderer(canvas)` → creates Engine, Scenes, cameras
6. Optional: `modData.loadRuleSet()` → returns empty/null Ruleset
7. Game loop starts, renders empty scene, UI widgets show

### 5.4 Vite Configuration Verification

- [ ] Verify `npm run dev` serves `/test/...` pages correctly in SPA mode
- [ ] Verify `/play/ra`, `/editor/ra` serve `index.html` (SPA fallback)
- [ ] Verify `npm run build` excludes test pages from `dist/`

---

## 6. Risk and Considerations

### 6.1 High-Risk Areas

| Risk | Severity | Mitigation |
|------|:---:|-----------|
| **SPA mode switch breaks test pages** | HIGH | Test plugin middleware runs before SPA fallback in Vite's middleware stack. Verify with `npm run dev` after switch. Rollback: re-add `appType: 'mpa'` if issues found. |
| **Babylon.js Engine per-page singleton** | MEDIUM | Only one Engine can exist per WebGL context. `Game.create()` verifies no existing Engine before creating. `dispose()` ensures clean teardown before creating a new instance. |
| **Mod loading pipeline integration** | MEDIUM | `Game.loadMod()` chains multiple subsystems. Each step has independent error handling. The `_test` mod provides a minimal integration test path. |
| **Browser history and mod switching** | LOW | Router uses `history.pushState()` -- well-supported in all modern browsers. Mod switching disposes old Game before creating new. |
| **Dynamic import code splitting** | LOW | `ModSelector.launchMod()` uses `import()` for lazy loading. Vite handles code splitting automatically. Verify chunk sizes with `npm run build`. |

### 6.2 Deferred Items

| Feature | Phase | Reason |
|---------|-------|--------|
| Full dynamic shellmap (AI skirmish) | Phase C → future | Requires real mod assets (maps, sprites, rules). Phase 1 static fallback is sufficient for MVP. |
| Multiplayer server connection | Post-MVP | `Game.JoinServer()` stub. Chapter 18 Server is migrated; multiplayer integration is a future task. |
| Settings persistence | Post-MVP | Settings module not yet migrated. `localStorage` or `IndexedDB` planned for future. |
| Offline / Service Worker support | Post-MVP | CDN caching sufficient for MVP. Full offline mode requires Cache API + Service Worker. |
| Hotkey configuration in main menu | Post-MVP | Hotkey system (Ch7) is complete, but main menu hotkey settings UI is a future task. |

### 6.3 Open Questions (for Manager Review)

1. **Mod asset conversion pipeline**: Who is responsible for the build step that converts OpenRA's `mod.yaml` + MiniYAML files to `public/mods/{id}/mod.json`? This is a prerequisite for Phase E (Real Assets). The MiniYAML pipeline (`src/utils/miniyaml-to-json.ts`) exists, but a build script that runs it against the OpenRA mod directories is needed.

2. **Hotkeys/Settings persistence**: The C# `Game.InitializeSettings(args)` creates a `Settings` object backed by a YAML file. In the browser, settings need to persist via `localStorage`. Is the Settings module migration planned for a specific chapter, or should it be handled as part of the Game entry work?

3. **Multiplayer timeline**: The C# `Game.JoinServer()` and the Server system (Chapter 18, migrated) are available. Should the main menu include a "Multiplayer" button, even if it just shows "Coming Soon" in Phase 1?

4. **Vite config change approval**: Switching from `appType: 'mpa'` to SPA mode is a breaking change for the test page URL scheme. The test pages will continue working (test plugin runs first), but this should be explicitly approved before implementation.

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-22.1: Game Class is Instance-Based (Not Static)

**Context**: OpenRA C# uses `static class Game` with all-static members. TypeScript could mirror this, but browser environments and testability requirements differ.

**Decision**: `Game` is an instance class. A module-level `_currentGame` variable provides singleton-like access within a page load.

**Alternatives Considered**:
- **True static class (all static members)**: Matches C# 1:1 but makes testing impossible (global state bleed between tests, cannot mock subsystems).
- **Dependency injection container**: Over-engineered for a game with a single WebGL context constraint. Adds complexity without benefit.

**Consequences**:
- Easier: Testing -- each test creates a fresh Game instance.
- Easier: Mod switching -- dispose old Game, create new one.
- Harder: Code must pass Game instance or access via `getCurrentGame()` instead of `Game.Renderer`.
- Migration note: C# code using `Game.Renderer` becomes `game.renderer` or `getCurrentGame().renderer`.

### ADR-22.2: SPA Mode with Client-Side Router (Not MPA)

**Context**: Current `vite.config.ts` uses `appType: 'mpa'` to support `/test/` pages. The game needs dynamic routes like `/play/ra`, `/play/td` (not feasible with true MPA -- each mod would need its own HTML file).

**Decision**: Switch to `appType: 'spa'` (Vite default) with a minimal client-side router. The test route plugin continues working because Vite processes custom middleware before the SPA fallback.

**Alternatives Considered**:
- **True MPA with build-time HTML generation**: Would need a Vite plugin to generate `play-ra.html`, `play-td.html`, etc. at build time. Brittle, does not scale to dynamic mods.
- **Hash-based routing (`/#/play/ra`)**: Works without server support but ugly URLs, no SSR potential.

**Consequences**:
- Easier: Dynamic routes for mods, maps, replays.
- Easier: Code splitting with dynamic `import()`.
- Harder: Production server needs SPA fallback configuration (standard for all SPA deployments).

### ADR-22.3: Mod Selector Uses Plain DOM (No Widget System, No Game Engine)

**Context**: The project has a complete Widget UI system (Ch5 + Ch16). The homepage could use it, but that requires loading the entire game engine first.

**Decision**: The mod selector at `/` is implemented with plain DOM manipulation and CSS. No Babylon.js, no Widget system, no Game engine. The game engine is loaded lazily when a mod is selected.

**Alternatives Considered**:
- **Widget system for mod selector**: Consistent UI but requires loading ~1 MB of game engine JS before showing the first pixel. Unacceptable page load time.
- **React/Vue/Svelte**: Adds a framework dependency for a single page. Overkill; the mod selector is simple enough for vanilla DOM.

**Consequences**:
- Easier: Instant page load (mod selector JS is < 10 KB).
- Easier: Progressive enhancement -- game engine loads asynchronously.
- Harder: Two UI systems (DOM for selector, Widget system for game). Acceptable because they never coexist in the DOM.

### ADR-22.4: Mod Assets as Static Files (Not a Single Bundle)

**Context**: OpenRA packages mod assets in `.mix` archive files. For web delivery, we need efficient loading strategies.

**Decision**: Mod assets are deployed as individual static files under `public/mods/{modId}/`. The FileSystem uses `fetch()` to load them on demand. Caching is handled by the browser's HTTP cache + the FileSystem's L1 LRU cache.

**Alternatives Considered**:
- **Single .zip per mod**: Matches OpenRA's `.mix` approach but requires decompression in JS. Added complexity for marginal benefit. Browser HTTP/2 multiplexing handles many small files well.
- **Service Worker + Cache API**: Over-engineered for initial release. Can be added later for offline support.
- **IndexedDB for large asset storage**: Good for future offline mode.

**Consequences**:
- Easier: Simple deployment -- just static files, any CDN works.
- Easier: Debugging -- individual files visible in DevTools.
- Harder: Many small files may be slower on HTTP/1.1 (but HTTP/2 is ubiquitous now).

### ADR-22.5: Shellmap Phased Rollout

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

## Appendix A: Route Architecture Reference

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

## Appendix B: Loading Sequence (With Progress Events)

```
loadMod(modId):
  1. Progress: 'manifest', 0%
     → fetch /mods/{modId}/mod.json, parse JSON, new Manifest()

  2. Progress: 'dependencies', 10%
     → Validate requiresMods against installed mods

  3. Progress: 'filesystem', 15%
     → Create FileSystem, mount all manifest.mounts paths

  4. Progress: 'moddata', 30%
     → new ModData(manifest, fileSystem), await modData.init()

  5. Progress: 'ruleset', 40%
     → await modData.loadRuleSet()

  6. Progress: 'assets', 50%
     → Load sound device, initialize cursor manager

  7. Progress: 'maps', 70%
     → Load map cache index

  8. Progress: 'world', 85%
     → startGame(shellmapUid, WorldType.Shellmap)

  9. Progress: 'complete', 100%
     → Shellmap running, main menu widgets shown
```

## Appendix C: index.html Structure Reference

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
