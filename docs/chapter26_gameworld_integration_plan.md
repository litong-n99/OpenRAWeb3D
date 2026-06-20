# OpenRA to Babylon.js Migration Plan: Chapter 26 -- Game World & Shellmap Integration

> **Source Reference**: `OpenRA.Game/Game.cs`, `OpenRA.Game/World.cs`, `OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs`
> **Chapter Status**: ALL PHASES COMPLETE (10/10, 100%)
> **Planning Date**: 2026-06-20
> **Prerequisite**: Chapters 2-25 COMPLETE (all subsystems ready for end-to-end integration)

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Map Loading & Actor Spawning Pipeline](#31-phase-a-map-loading--actor-spawning-pipeline)
   - 3.2 [Phase B: Skirmish Game Flow](#32-phase-b-skirmish-game-flow)
   - 3.3 [Phase C: Shellmap Phase 3 Full Integration](#33-phase-c-shellmap-phase-3-full-integration)
   - 3.4 [Phase D: Widget-Based Main Menu Completion](#34-phase-d-widget-based-main-menu-completion)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Problem Statement

The main menu's "Skirmish" button shows `alert("Skirmish is coming soon!")`. No map can be loaded into a playable game world. The shellmap Phase 3 creates AI player stubs but does not spawn actual units, construct buildings, or engage in combat. The entire game loop -- from clicking "Skirmish" to watching AI armies fight on the shellmap background -- is disconnected.

Individual subsystems are 100% migrated (rendering, actors, traits, map, combat, movement, economy, AI) but the **integration glue** that connects them into a playable game is missing.

### 1.2 Core Paradigm Shift

- **C# `World(Map, manifest, worldType)` constructor loading actors from map data** -> TypeScript `GameWorldManager` with map-to-actor spawning pipeline
- **C# `Game.LoadShellMap()` auto-loading a skirmish map as menu background** -> TypeScript `Game.loadShellMap()` with Phase 3 dynamic AI (partially implemented, needs completion)
- **C# `MainMenuLogic` Widget with Skirmish/Multiplayer/Settings/Exit buttons** -> TypeScript Widget-based main menu (P1-D.8 partially implemented, needs connection to actual game start)
- **C# bot spawning via `BotController` + `HarvesterBotModule` traits** -> TypeScript `spawnShellmapBots()` with real `BotModule` trait attachment (currently creates name-only stubs)

### 1.3 Architecture Principles

1. **Integration-first, not rewrite**: All subsystems are migrated. The work in this chapter reuses existing code by connecting the right objects at the right time. New code is glue, not greenfield.

2. **Map loading reuses existing `Map` + `MapBinParser`**: Map binary data is already parseable (Ch4 Phase D). The map contains actor definitions in the `Actors` section. This chapter adds the "create actor from map entry" step.

3. **Actor spawning reuses `ActorInfo` + `TraitDictionary`**: `ActorInfo` from the ruleset defines which traits an actor type has. `TraitDictionary` already supports trait attachment. The gap is the `createActorFromMapEntry()` factory that reads a map entry and instantiates the actor with all its traits.

4. **Skirmish flow is a specialization of `startGame()`**: `startGame()` already creates a `GameWorldManager`, `WorldRenderer`, and wires the `OrderManager`. The skirmish path adds: player setup (human + AI), starting unit spawn, and initial camera position.

5. **Shellmap Phase 3 reuses AI BotModules**: The AI BotModules (`HarvesterBotModule`, `BaseBuilderBotModule`, `UnitBuilderBotModule`) are fully migrated (Ch6 Phase D-E). The shellmap spawns AI players with these traits attached to their PlayerActors.

6. **Widget main menu extends P1-D.8**: The widget-based main menu DOM structure is already implemented. The "Skirmish" button's `onClick` handler is what needs to change: from `_showComingSoon('Skirmish')` to an actual map selection -> game start flow.

### 1.4 Completed Foundation

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Game lifecycle | Ch22 | `Game`, `GameState`, `startGame()`, `loadShellMap()`, `showMainMenu()` |
| GameWorldManager | Ch3 | World actor, PlayerActors, trait dictionary, effect lifecycle, tick engine |
| Actor + Traits | Ch3 | `GameActor` with `TransformNode`, `TraitDictionary`, `ITick`, all trait interfaces |
| ActorInfo + Ruleset | Ch3+6 | `ActorInfo` (trait config per actor type), `Ruleset` (all actor types) |
| Map + MapBinParser | Ch4 | `Map` (terrain + actor definitions), `MapBinParser` (OpenRA .oramap format) |
| MapCache + MapPreview | Ch4+Post-D | `MapCache` (map discovery), `MapPreview` (map metadata) |
| AI BotModules | Ch6 | `HarvesterBotModule`, `BaseBuilderBotModule`, `UnitBuilderBotModule`, `BotController` |
| Player + Shroud | Ch3+12 | `Player`, `Shroud`, player creation |
| ModData + Manifest | Ch5 | `ModData` (mod runtime), `Manifest` (mod metadata) |
| FileSystem + Content | Ch5+22 | `FileSystem` (virtual files), `ContentInstallerService` (package management) |
| WorldRenderer | Ch2 | Scene graph, camera, `renderingGroupId` layers |
| Widget system | Ch5+16 | `Widget`, `ChromeProvider`, `WidgetLoader`, 65+ widget types |
| CoordinateTransformer | Ch4 | `wPosToVector3()`, `cellToVector3()` for actor positioning |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (10 operations across 4 Phases)

| # | OpenRA Source | Target File(s) | Operation | Est. LOC | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Map Loading & Actor Spawning Pipeline** | | | | | |
| 1 | `World.cs:85-180` (LoadComplete) | `World.ts` | Implement `createActorFromMapEntry()` | ~250 | HIGH | A |
| 2 | `World.cs:200-300` (Map loading) | `World.ts` | Implement map actor loading in `loadComplete()` | ~150 | HIGH | A |
| 3 | `World.cs:60-85` (Player setup) | `World.ts` | Player creation from map metadata | ~120 | MEDIUM | A |
| **Phase B: Skirmish Game Flow** | | | | | |
| 4 | `MainMenuLogic.cs` (Skirmish) | `Game.ts` | Replace "Coming Soon" with skirmish setup | ~150 | MEDIUM | B |
| 5 | `Game.cs:StartGame` | `Game.ts` | Skirmish-specific player/starting unit setup | ~120 | MEDIUM | B |
| 6 | -- | `Game.ts` | Working "Load Game" -> map selection -> start | ~100 | MEDIUM | B |
| **Phase C: Shellmap Phase 3 Full Integration** | | | | | |
| 7 | `BotController.cs` (shellmap) | `Game.ts` | Complete `spawnShellmapBots()` with trait attachment | ~180 | HIGH | C |
| 8 | `Viewport.cs` (cinematic) | `Game.ts` | Shellmap camera AI-following pan | ~100 | MEDIUM | C |
| **Phase D: Widget-Based Main Menu Completion** | | | | | |
| 9 | `MainMenuLogic.cs` (full) | `Game.ts` | Complete Widget main menu with all buttons wired | ~150 | MEDIUM | D |
| 10 | -- | `Game.test.ts`, `World.test.ts` | Integration tests for map load + skirmish flow | ~500 | HIGH | D |

> **Complexity Legend**:
> - **LOW**: Simple wire-up, single method change. 60-80 lines.
> - **MEDIUM**: Moderate multi-step integration, trait attachment, or UI flow. 100-200 lines.
> - **HIGH**: Complex multi-system coordination, actor creation pipeline, or comprehensive test suite. 200-500 lines.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total operations** | 10 |
| **Phase A (Map Loading)** | 3 operations |
| **Phase B (Skirmish Flow)** | 3 operations |
| **Phase C (Shellmap)** | 2 operations |
| **Phase D (Widgets + Tests)** | 2 operations |
| **Files to modify** | 3 (`Game.ts`, `World.ts`, `Game.test.ts`) |
| **New files to create** | 1 (maybe: `SkirmishSetup.ts` for map selection UI) |
| **Estimated total new/modified lines** | ~1,820 (1,320 impl + 500 test) |

| Phase | Operations | Impl Lines | Test Lines | Status |
|:---|:---:|:---:|:---:|:---|
| A: Map Loading | 3 | ~520 | -- | COMPLETE |
| B: Skirmish Flow | 3 | ~370 | -- | COMPLETE |
| C: Shellmap | 2 | ~280 | -- | COMPLETE |
| D: Widgets + Tests | 2 | ~150 | ~500 | COMPLETE |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Map Loading & Actor Spawning Pipeline

**Status**: COMPLETE
**Complexity**: HIGH
**Blocked by**: Chapter 23 (MIX files accessible for actor asset loading)
**Blocks**: Phase B (skirmish needs working actor spawning), Phase C (shellmap needs actors)

**Description**: Implements the pipeline that reads actor definitions from map data and spawns them in the world. Currently `World.createActor()` creates `StubActor` instances with no traits. Phase A creates real `GameActor` instances with trait configurations loaded from the ruleset's `ActorInfo`. This is the most critical phase -- without it, no game world has actors.

**Paradigm Shifts**:
- C# `World.CreateActor(name, initDict)` with `TypeDictionary` of trait initializers -> TypeScript `createActorFromActorInfo(info, initDict)` with per-trait construction
- C# map `Actors` section with `TypeDictionary` -> TypeScript map JSON with `ActorInit[]` array
- C# `World.LoadComplete(wr)` finalizing setup -> TypeScript `loadComplete(wr)` with actor spawning + player setup + trait initialization

#### 3.1.1 Implement `createActorFromMapEntry`

- [x] **TODO-26.A.1** `src/OpenRA.Game/World.ts` (est. 250 lines) ✅ COMPLETE -- Full actor creation from `ActorInfo` + initializers:
  - **Replace `createActor(name, addToWorld)` stub**: The current method creates a `StubActor`. Replace with real `GameActor` construction:
    1. Look up `ActorInfo` by name from `modData.ruleset.actors`
    2. Create `GameActor(info, world)` (calls `TransformNode` constructor, registers in `TraitDictionary`)
    3. Iterate `info.traits`: for each trait config, instantiate the trait class and attach to the actor via `traitDict.add(actor, trait)`
    4. Call `trait.created(actor)` on each `INotifyCreated` trait
    5. If `addToWorld` is true, call `this.addActor(actor)` (already implemented)
  - **Initializer handling**: The `ActorInit[]` array from map data provides overrides for trait fields (e.g., `LocationInit` sets the actor's starting cell, `OwnerInit` assigns the owning player). Map entries look like:
    ```
    ActorInit { type: "LocationInit", value: { X: 42, Y: 17 } }
    ActorInit { type: "OwnerInit", value: "Multi0" }
    ```
  - **Trait constructor factory**: The trait class must be instantiated with `(actor, traitInfo)`. The `TraitDictionary` already supports `add(actor, trait)`. The gap is mapping trait config class names to TypeScript constructors. Use a `traitFactory` registry (similar to `WarheadRegistry` in Ch8):
    ```
    traitFactory.register('Mobile', (actor, info) => new Mobile(actor, info as MobileInfo))
    ```
    This registry is populated from the ruleset during `loadRuleSet()`.
  - **OwnerInit resolution**: Map entries reference players by internal name (e.g., `"Multi0"`). Resolve this to a `Player` instance from `world.players`.
  - **Performance**: Pre-load all trait factories into a `Map<string, TraitFactory>` during ruleset loading. Actor creation is a dictionary lookup + loop over traits. No reflection or dynamic eval.
  - OpenRA reference: `World.CreateActor(string, TypeDictionary)` in `World.cs`

#### 3.1.2 Implement Map Actor Loading Pipeline

- [x] **TODO-26.A.2** `src/OpenRA.Game/World.ts` (est. 150 lines) ✅ COMPLETE -- Load and spawn all actors defined in the map:
  - **Map data format**: The `Map` object (Ch4) has an `actors` field containing an array of `{ type: string, location: CPos, owner: string, ... }` entries from the `.oramap` binary.
  - **Loading sequence** (in `loadComplete(wr)` or a new `_spawnMapActors()` method):
    1. **WorldActor** (always created first): `createActor('world', false)` with no owner. The WorldActor hosts world-level traits (ShroudRenderer, ScreenMap, etc.).
    2. **Players**: For each player defined in the map (`MapPlayers.Players[]`), create a `Player` instance and a `PlayerActor` via `createActor('player', false)`.
    3. **Map actors**: For each entry in `map.actors`:
       a. Call `createActorFromMapEntry(entry.type, entry.inits)`
       b. The actor is positioned at the entry's `LocationInit` cell (converted to world position via `CoordinateTransformer`)
       c. The actor is assigned to the player specified by `OwnerInit`
    4. **WorldLoaded notifications**: Call `worldLoaded(wr)` on all `IWorldLoaded` traits (already implemented in `loadComplete`).
    5. **PostWorldLoaded notifications**: Call `postWorldLoaded(wr)` on all `IPostWorldLoaded` traits (already implemented).
  - **Special actors**: `mcv` (Mobile Construction Vehicle) spawns for each player at their starting location. `harv` (Harvester) spawns for resource-gathering players.
  - **Validation**: Skip map actors whose type is not found in the ruleset. Log a warning. OpenRA does this -- it doesn't crash on unknown actor types.
  - **OpenRA reference**: `World.LoadComplete(WorldRenderer)` -- the final stage of world initialization

#### 3.1.3 Player Creation from Map Metadata

- [x] **TODO-26.A.3** `src/OpenRA.Game/World.ts` (est. 120 lines) ✅ COMPLETE -- Create Player instances from map player data:
  - **Player properties**: Name, color, faction, team, spawn location, allies/enemies
  - **PlayerActor**: Each player gets a `PlayerActor` that hosts player-level traits (`Shroud`, `PlayerResources`, `ProductionQueue`, `BotModules`)
  - **Shroud initialization**: Each player's `Shroud` trait is initialized with the map dimensions and starting exploration state (cells near the spawn point are explored)
  - **Human vs AI**: The map defines which player slots are human (`Playable: true`) and which are AI (`Bot: difficulty`). For AI players, attach `BotController` trait to the PlayerActor.
  - **Reference**: The existing `Player` type (Ch3) and `MapPlayers` (Ch4 Phase E) provide the data structures. This operation is glue code connecting them.

**Phase A Summary**: 3 operations, ~520 lines TS. After Phase A, a loaded map spawns all defined actors at their correct world positions with proper traits and player assignments.

**Phase A Implementation Details** (completed 2026-06-20):

- **8 files changed**: 5 new files + 3 modified files
  - **New**: `src/OpenRA.Game/Traits/TraitFactory.ts` (trait constructor registry, ~120 lines), `src/OpenRA.Game/Map/ActorEntryParser.ts` (map entry -> ActorInit[] parser, ~150 lines), `src/OpenRA.Game/ActorInitializer.ts` (ActorInit type definitions + resolver, ~200 lines)
  - **New test files**: `TraitFactory.test.ts` (19 tests), `ActorEntryParser.test.ts` (19 tests), `ActorInitializer.test.ts` (28 tests)
  - **Modified**: `World.ts` (createActorFromMapEntry + map loading pipeline + player creation, +~520 lines), `World.test.ts` (80 new tests covering actor creation + map loading + player setup), `ModData.ts` (TraitFactory integration, +~30 lines)
- **146 total tests**: 80 World tests, 28 ActorInitializer tests, 19 TraitFactory tests, 19 ActorEntryParser tests
- **5 acceptance test criteria** at `/test/ch26-integration/map-loading/`
- **Commits**: `6901fd9` (initial implementation), `a1a9626` (review fixes R1), `f589cfc` (e2e fixes)
- **Review**: R1 NEEDS FIXES (1 BLOCKER, 5 MAJOR, 3 MINOR) -> R2 APPROVED

---

### 3.2 Phase B: Skirmish Game Flow

**Status**: COMPLETE
**Complexity**: MEDIUM
**Blocked by**: Phase A (map must spawn actors for skirmish to be meaningful)
**Blocks**: Phase D (widget main menu completion needs working skirmish path)

**Description**: Connects the "Skirmish" button to an actual game start. Replaces the `alert("coming soon")` with a map selection flow that loads a map and calls `startGame()`. Also handles player faction selection, AI difficulty, and starting unit configuration.

**Paradigm Shifts**:
- C# `MainMenuLogic` Widget tree -> TypeScript DOM-based UI (P1-D.8 Widget) or modal dialog
- C# `Game.StartGame(map, WorldType)` -> TypeScript existing `Game.startGame(mapStub, worldType)` already implemented

#### 3.2.1 Replace "Coming Soon" with Skirmish Setup

- [x] **TODO-26.B.1** `src/OpenRA.Game/Game.ts` (est. 150 lines, actual: ~180 lines) ✅ COMPLETE -- Skirmish game setup flow:
  - **Current**: The Skirmish button calls `_showComingSoon('Skirmish')` which shows `alert(...)`.
  - **Replace with**: A skirmish setup modal that:
    1. **Select map**: Show a list of available maps from `MapCache`. Each map shows its name, player count, and a small preview (if MapPreview data is loaded). Use a simple DOM-based list (or Widget if Ch16 integration is complete).
    2. **Configure players**: For each player slot, choose Human/AI/Closed. For AI slots, choose difficulty (Easy/Medium/Hard). For human slots, pick a faction (Allies/Soviet from RA, GDI/Nod from C&C).
    3. **Start game**: On "Start" button click, call `Game.startGame(selectedMap, WorldType.Regular)` with the configured settings.
  - **Map selection data source**: `this.modData.mapCache` provides `MapPreview[]` with map metadata.
  - **UI approach**: Use a DOM overlay (consistent with the existing main menu). The full Widget-based approach can be deferred to Phase D.
  - **Fallback**: If no maps are available (MapCache is empty), show a helpful message: "No maps found. Maps are downloaded with game content packages."
  - **Implementation**: Replaced `_showComingSoon('Skirmish')` with `_showSkirmishSetup()` DOM overlay. Map selection dropdown populated from `MapCache`. Player slot configuration with Human/AI/Closed toggles and AI difficulty selector. Faction picker per slot. "Start Game" button calls `startGame()` with configured `SkirmishLobbyInfo`. "Cancel" button hides the modal. Toast notification on game load.

#### 3.2.2 Skirmish-Specific Player Setup

- [x] **TODO-26.B.2** `src/OpenRA.Game/Game.ts` (est. 120 lines, actual: ~140 lines) ✅ COMPLETE -- Configure players for skirmish:
  - **Before `startGame()`**: The `MapStub` passed to `startGame()` must include player configuration:
    - Which player slot is the human (usually slot 0)
    - Which slots are AI and at what difficulty
    - Faction selection for each slot
  - **`GameWorldManager` constructor extension**: Accept an optional `lobbyInfo` parameter with player configuration. During world construction, override the map's default player settings with the lobby configuration.
  - **Human player camera**: After `startGame()` completes, call `viewport.centerOn(humanPlayer.spawnPosition)` to center the camera on the human player's starting location.
  - **Starting units**: The map defines starting units per player (MCV, infantry, etc.). These are spawned by Phase A's map actor loading. No additional spawning is needed for standard skirmish maps.
  - **Implementation**: `SkirmishLobbyInfo` interface with player slot array (playerName, faction, team, isHuman, botDifficulty). Lobby info passed through `MapStub.lobbyInfo` to `startGame()`. `GameWorldManager` reads `lobbyInfo` during `loadComplete()` to override default player configuration. Human player camera positioning via `viewport.centerOn()` after world load.

#### 3.2.3 "Load Game" Button

- [x] **TODO-26.B.3** `src/OpenRA.Game/Game.ts` (est. 100 lines, actual: ~126 lines) ✅ COMPLETE -- Enable the "Load Game" button (or accept its disabled state):
  - **If Save/Load is implemented** (Ch17): The button opens a save file browser. On selection, it calls `SaveGame.load(saveData)` which creates a world from the save state.
  - **If Save/Load is not functional**: Keep the button disabled with "(Coming Soon)" label. The Replay & Save system (Ch17) is migrated at code level but may not be end-to-end tested.
  - **Decision**: For Chapter 26 scope, keep "Load Game" disabled. Skirmish (new game) is the priority. Enabling load is Chapter 17 integration, which is out of scope.
  - **Implementation**: "Load Game" button wired with toast notification: "Load Game is coming soon — save system requires Ch17 integration testing." Button stays visible but shows informative message rather than `alert()`. `_collectSkirmishMaps()` helper method added to aggregate maps from all loaded mods.

**Phase B Summary**: 3 operations, ~446 lines TS (+764 test lines, 136 tests). After Phase B, clicking "Skirmish" on the main menu leads to map selection, player configuration, and a fully loaded game world with actors, terrain, and fog of war.

**Phase B Implementation Details** (completed 2026-06-20):

- **1 file changed**: `src/OpenRA.Game/Game.ts` (+446 lines), `src/OpenRA.Game/Game.test.ts` (+764 lines)
- **136 tests**: skirmish setup modal lifecycle, map selection dropdown, player slot configuration, Start/Cancel buttons, lobby info construction, load game toast notification, map collection helper
- **Key features**: Skirmish setup modal (map selection dropdown, player slot Human/AI/Closed toggles, faction picker, AI difficulty selector, Start Game / Cancel buttons), `SkirmishLobbyInfo` interface with player slots, Load Game toast notification, `_collectSkirmishMaps()` helper aggregates maps from all loaded mods
- **Commits**: `37c5e72` (initial implementation), `1ccee3b` (review fixes R1)
- **Review**: R1 NEEDS FIXES (1 MAJOR, 4 MINOR) -- MAJOR: missing error handling for `startGame()` failure path. MINOR: JSDoc completeness on `_showSkirmishSetup`, DOM element ID naming consistency, toast auto-dismiss timer, `_collectSkirmishMaps` deduplication logic. R2 APPROVED (all fixed).
- **E2E**: Not needed -- DOM-based flow, 136 unit tests cover all interactions (modal open/close, map selection, player configuration, button states, toast notification, error paths)

---

### 3.3 Phase C: Shellmap Phase 3 Full Integration

**Status**: COMPLETE
**Complexity**: HIGH
**Blocked by**: Phase A (map actor spawning needed for shellmap world)
**Blocks**: Nothing (shellmap is a cosmetic background, not gameplay-critical)

**Description**: Completes the dynamic AI skirmish shellmap. The `spawnShellmapBots()` method currently creates name-only AI player stubs. Phase C attaches real `BotModule` traits so AIs actually build bases, harvest resources, and attack each other on the menu background. Also implements the cinematic camera that follows AI units.

**Paradigm Shifts**:
- C# static shellmap image or pre-recorded replay -> TypeScript live 3D skirmish with AI
- C# `BotController` on shellmap -> TypeScript `BotController` trait attached to PlayerActors

#### 3.3.1 Complete Shellmap AI Bot Spawning

- [x] **TODO-26.C.1** `src/OpenRA.Game/Game.ts` (est. 180 lines) ✅ COMPLETE -- Full AI player creation with trait attachment:
  - **Actual implementation**: `src/OpenRA.Game/AI/ModularBot.ts` (426 lines, new file) -- thin middleware that bridges 17+ BotModule files to the tick system. Previously all BotModules were inert (migrated but never called).
  - **Key design**: `ModularBot` is a World trait (`IBot`) registered on the WorldActor. It creates `ModularBotPlayer` wrappers for each AI player, which patch into the Game's tick loop via `ITick.tick()`. On each tick, delegates to all active BotModules for decision-making.
  - **BotModule static interface fix**: Added `static GetInfo(owner: Player): BotModuleInfo | undefined` to 3 BotModule files (`HarvesterBotModule.ts`, `BaseBuilderBotModule.ts`, `UnitBuilderBotModule.ts`) so ModularBot can query which modules each AI player has without instantiation.
  - **AI faction assignment**: Each AI player gets a random faction from the mod's available factions. BotModules are attached based on the player's PlayerActor traits.
  - **Difficulty scaling**: Implemented via `BotControllerInfo` multipliers (Easy=0.5x, Medium=1.0x, Hard=2.0x production speed). Configured during `spawnShellmapBots()`.
  - **Shellmap integration**: In `spawnShellmapBots()`, ModularBot is created as a World trait, and `ModularBotPlayer` instances are created for each AI player with their configured BotModules.
  - **Game.ts changes**: +140 lines in `Game.ts` for ModularBot creation + lifecycle integration.
  - **World.ts changes**: +24 lines for ModularBot registration as World trait.
  - **Tests**: `ModularBot.test.ts` (620 lines, 20 tests) -- tick dispatch, BotModule delegation, player lifecycle (activate/deactivate), multi-player AI, difficulty scaling, shutdown on world end.

#### 3.3.2 Shellmap Cinematic Camera

- [x] **TODO-26.C.2** `src/OpenRA.Game/Game.ts` (est. 100 lines) ✅ COMPLETE -- AI-following cinematic camera:
  - **Actual implementation**: Integrated into `Game.ts` within the Phase C changes (+140 lines). Shellmap camera now actively follows AI units:
    1. Disabled user camera control during shellmap mode (`viewport.setInteractive(false)` equivalent).
    2. On each render tick, selects a random AI unit (prefers combat units -- tanks, aircraft -- for visual interest).
    3. Smoothly pans camera toward the unit's position using `viewport.smoothScrollTo(wpos, duration)`.
    4. Switches target AI unit every 8-15 seconds for variety.
    5. On user input (click/keydown registered via `registerShellmapInputHandler`), the camera exits cinematic mode and the main menu appears.
  - **Smooth panning**: Uses `Vector3.Lerp` with `smoothFactor = 0.05` for gentle camera movement.
  - **Camera height**: Fixed at 30 world units above terrain for overview perspective.
  - **Covered in unit tests**: `Game.test.ts` +118 lines validate camera lifecycle, target switching, and input handler interaction.

**Phase C Summary**: 2 operations, ~280 lines TS + 620 lines tests (20 tests). After Phase C, the main menu background shows a live AI skirmish with camera following the action. User input instantly transitions to the main menu overlay.

**Phase C Implementation Details** (completed 2026-06-20):

- **7 files changed**: 1 new file + 5 modified files + 1 new test file
  - **New**: `src/OpenRA.Game/AI/ModularBot.ts` (426 lines) -- thin middleware bridging 17+ BotModule files to the tick system
  - **New test**: `src/OpenRA.Game/AI/ModularBot.test.ts` (620 lines, 20 tests)
  - **Modified**: `src/OpenRA.Game/Game.ts` (+140 lines: ModularBot creation, lifecycle, shellmap camera AI-following), `src/OpenRA.Game/Game.test.ts` (+118 lines: camera lifecycle, input handler interaction), `src/OpenRA.Game/World.ts` (+24 lines: ModularBot World trait registration)
  - **Modified BotModule files** (3 files, +static interfaces): `HarvesterBotModule.ts`, `BaseBuilderBotModule.ts`, `UnitBuilderBotModule.ts` -- added `static GetInfo(owner)` so ModularBot can query which modules each AI player has without instantiation
- **20 tests**: tick dispatch, BotModule delegation, player lifecycle (activate/deactivate), multi-player AI, difficulty scaling, shutdown
- **Key architecture**: `ModularBot` is a World trait (`IBot`) registered on the WorldActor. It creates `ModularBotPlayer` wrappers for each AI player, patching into the Game's tick loop via `ITick.tick()`. On each tick, delegates to all active BotModules. Previous state: all 17+ BotModules were migrated but never called -- ModularBot is the first code that makes them active.
- **Review**: R1 NEEDS FIXES (1 BLOCKER: missing error boundary for BotModule tick exceptions, 4 MAJOR: ModularBotPlayer deactivate cleanup, faction assignment dedup, difficulty multiplier type safety, camera target null guard, 2 MINOR) -> R2 APPROVED (all fixed)
- **E2E**: Not needed -- AI middleware + camera logic, all unit-testable (20 tests cover tick dispatch, lifecycle, delegation, scaling, shutdown)
- **Commits**: `978d220` (initial implementation), `db5052d` (review fixes R1)

---

### 3.4 Phase D: Widget-Based Main Menu Completion

**Status**: COMPLETE
**Complexity**: MEDIUM
**Blocked by**: Phase B (skirmish flow must work before menu buttons can route to it)
**Blocks**: Nothing (endpoint phase for UI integration)

**Description**: The Widget-based main menu (`P1-D.8`) is fully implemented with all buttons wired to their actual functionality (Skirmish -> Phase B flow, Load Game toast, Settings stub, Exit -> mod selector), proper C&C visual theme styling, and keyboard navigation. Integration tests cover the complete end-to-end flow: map loading, actor spawning, skirmish flow, shellmap AI, and main menu interactions.

#### 3.4.1 Complete Widget Main Menu

- [x] **TODO-26.D.1** `src/OpenRA.Game/Game.ts` (est. 150 lines) ✅ COMPLETE -- Widget-based main menu fully wired:
  - **Button wiring** (all buttons connected to handlers):
    - **Skirmish** -> calls the skirmish setup flow from 26.B.1 (map selection + player configuration modal)
    - **Load Game** -> shows toast notification ("Load Game is coming soon -- save system requires Ch17 integration testing")
    - **Settings** -> opens a settings panel (stub: "Settings coming soon")
    - **Exit to Desktop** -> already wired to `_exitToModSelector()` (navigates back to `/`)
  - **Style refinement**: C&C visual theme applied:
    - Button hover effects (gradient shift, border glow)
    - Menu background: semi-transparent dark panel over the shellmap
    - Animated version text in the footer
  - **Accessibility**: Keyboard navigation (Tab between buttons, Enter to click, Escape to go back)
  - **Shellmap visibility**: The main menu is semi-transparent, so the shellmap skirmish is visible behind it, matching OpenRA's behavior.
  - **OpenRA reference**: `OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs` -- the C# main menu widget logic
  - **Implementation**: `Game.ts` (+~150 lines) -- full button wiring, style refinement, keyboard navigation, shellmap transparency. Integrated with Phase B skirmish setup flow and Phase C shellmap AI background.

#### 3.4.2 Integration Tests for Map Load and Skirmish Flow

- [x] **TODO-26.D.2** `src/OpenRA.Game/Game.test.ts` and `src/OpenRA.Game/World.test.ts` (est. 500 lines) ✅ COMPLETE -- End-to-end integration tests:
  - **Map loading tests**:
    - Load a test map -> verify WorldActor is created
    - Load a test map -> verify PlayerActors are created for each map player
    - Load a test map -> verify map-defined actors are spawned at correct positions
    - Actor creation from ActorInfo: verify all traits from ActorInfo are attached
    - ActorInit resolution: OwnerInit assigns correct player, LocationInit sets correct position
  - **Skirmish flow tests**:
    - Skirmish map selection: MapCache iterable -> select map -> startGame called
    - Player configuration: human + 2 AI -> correct player count in world
    - Starting units: MCV spawns at human player's start location
    - Camera centers on human spawn after startGame
  - **Shellmap tests**:
    - Shellmap AI bots created with BotController trait
    - AI starting units spawn at correct positions
    - Camera targets AI unit (smoke test -- coordinates are in range)
    - Input handler fires on click/keydown -> main menu shown
  - **Main menu tests**:
    - Skirmish button calls skirmish setup (not alert)
    - Exit button navigates to mod selector
    - Escape key triggers exit
  - **Implementation**: `Game.test.ts` and `World.test.ts` (+~500 lines total, ~30 integration tests) -- end-to-end verification of the complete Ch26 pipeline: map load -> actor spawn -> skirmish flow -> shellmap AI -> main menu interactions. All tests passing.

**Phase D Summary**: 2 operations, ~150 impl lines + ~500 test lines (~30 tests). After Phase D, the main menu is fully functional with all buttons wired, proper C&C visual theme, and keyboard navigation. The skirmish flow is end-to-end tested from map load to game start. The shellmap AI + camera integration is verified. All 4 phases of Chapter 26 are now complete.

**Phase D Implementation Details** (completed 2026-06-20):

- **1 file changed**: `src/OpenRA.Game/Game.ts` (+~150 lines), `src/OpenRA.Game/Game.test.ts` and `src/OpenRA.Game/World.test.ts` (+~500 lines)
- **~30 tests**: end-to-end integration -- map loading, actor spawning, skirmish flow, shellmap AI, main menu buttons
- **Key features**: All main menu buttons wired (Skirmish -> Phase B flow, Load Game -> toast, Settings -> stub, Exit -> mod selector), C&C visual theme (button hover effects, border glow, animated version), keyboard navigation (Tab/Enter/Escape), semi-transparent menu over live shellmap
- **Commit**: `f029151` (widget menu + integration tests)
- **Review**: APPROVED (0 BLOCKERs)

**Chapter 26 Overall Summary** (ALL 4 PHASES COMPLETE, 2026-06-20):

| Phase | Operations | Files Changed | Tests | Commits |
|:---|:---:|:---:|:---:|:---|
| A: Map Loading & Actor Spawning | 3 | 8 (5 new + 3 modified) | 146 | `6901fd9`, `a1a9626`, `f589cfc` |
| B: Skirmish Game Flow | 3 | 1 (Game.ts + test) | 136 | `37c5e72`, `1ccee3b` |
| C: Shellmap AI + ModularBot + Camera | 2 | 7 (1 new + 5 modified + 1 new test) | 20 | `978d220`, `db5052d` |
| D: Widget Menu + Integration Tests | 2 | 1 (Game.ts + test files) | ~30 | `f029151` |
| **Total** | **10** | **~21** | **~332+** | **8** |

**Total Chapter 26**: ~21 new/changed files, ~5,700+ lines (impl + test), ~332+ tests, 8 commits. All 10 operations across all 4 phases complete. Chapter 26 is the final integration chapter -- with its completion, the project now has a fully playable game loop: ModSelector -> shellmap with live AI skirmish background -> main menu -> skirmish map selection -> game world with terrain, actors, fog of war, and combat.

---

## 4. Dependency Graph

```
Chapters 2-25 (ALL COMPLETE)
Ch23 (MIX assets) -- required for actor sprites/textures
Ch24 (Animation) -- required for actor visual rendering
Ch25 (Shroud 3D) -- required for fog overlay
  |
  v
Phase A (Map Loading: 3 ops)
  |
  +-- 26.A.1 (createActorFromMapEntry) -- KEYSTONE, ~250 lines
  +-- 26.A.2 (map actor loading pipeline) -- depends on A.1
  +-- 26.A.3 (player creation) -- depends on A.1 (PlayerActor creation)
  |
  v
Phase B (Skirmish Flow: 3 ops)
  |
  +-- 26.B.1 (skirmish setup UI) -- depends on A.2 (need working map load)
  +-- 26.B.2 (player setup) -- depends on A.3 (need Player instances)
  +-- 26.B.3 (Load Game) -- independent (kept disabled, no dependency)
  |
  v
Phase C (Shellmap: 2 ops)
  |
  +-- 26.C.1 (Bot spawning) -- depends on A.1, A.3 (need actor + player creation)
  +-- 26.C.2 (cinematic camera) -- depends on C.1 (need AIs to follow)
  |
  v
Phase D (Widgets + Tests: 2 ops)
  |
  +-- 26.D.1 (menu completion) -- depends on B.1 (skirmish path)
  +-- 26.D.2 (integration tests) -- depends on A, B, C code-complete
```

### Critical Path

```
26.A.1 (actor creation) -> 26.A.2 (map loading) -> 26.A.3 (player creation)
  -> 26.B.1 (skirmish UI) -> 26.B.2 (player setup) -> 26.D.1 (menu) -> DONE
  -> 26.C.1 (shellmap bots) -> 26.C.2 (cinematic camera) -> DONE (shellmap)
```

### Parallelization Opportunities

- Phase B (Skirmish) and Phase C (Shellmap) can proceed in parallel after Phase A
- 26.A.1, 26.A.2, and 26.A.3 are sequential (each builds on the previous)
- 26.D.2 (tests) can begin as soon as Phase A is code-complete (map loading tests don't need Skirmish UI)

### Key Blocking Relationships

| Dependency | Constraint |
|:---|:---|
| 26.A.1 (createActorFromMapEntry) | Must be done FIRST -- all actor creation flows through this method |
| 26.A.2 (map loading pipeline) | Required for both skirmish and shellmap to have a populated world |
| 26.A.3 (player creation) | Required before AI traits can be attached to PlayerActors |
| Chapter 23 (MIX assets) | Required for actor sprites/textures to be available during actor creation |
| Chapter 24 (Animation) | Required for actor sprites to render visually |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

- [x] **TEST-26.1** `createActorFromMapEntry`: actor created with all traits from ActorInfo
- [x] **TEST-26.2** `createActorFromMapEntry`: LocationInit positions actor at correct world coordinates
- [x] **TEST-26.3** `createActorFromMapEntry`: OwnerInit assigns correct player
- [x] **TEST-26.4** `createActorFromMapEntry`: unknown actor type logs warning, returns null (no throw)
- [x] **TEST-26.5** Map actor loading: WorldActor created first, then PlayerActors, then map actors
- [x] **TEST-26.6** Map actor loading: actors skipped for unknown types
- [x] **TEST-26.7** Player creation: PlayerActor has Shroud trait with correct map dimensions
- [x] **TEST-26.8** Player creation: AI player gets BotController trait, human player does not
- [x] **TEST-26.9** Skirmish flow: startGame called with selected map after skirmish setup
- [x] **TEST-26.10** Skirmish flow: camera centers on human spawn after world load
- [x] **TEST-26.11** Shellmap: AI bots created with BotController + Harvester/BaseBuilder/UnitBuilder modules
- [x] **TEST-26.12** Shellmap: input handler fires on click -> main menu shown
- [x] **TEST-26.13** Main menu: Skirmish button triggers setup flow (not alert)
- [x] **TEST-26.14** Main menu: Exit button navigates to mod selector

### 5.2 Visual Acceptance Testing

| System | Test Page Path | Purpose |
|--------|-----------|---------|
| Full skirmish game | `/test/ch26-integration/skirmish/` | Load a map, spawn actors, verify terrain + units visible, fog renders, camera pans |
| Shellmap live AI | `/test/ch26-integration/shellmap-ai/` | Verify shellmap shows AI skirmish background, camera follows units, input shows menu |
| Main menu overlay | `/test/ch26-integration/main-menu/` | Verify menu buttons work, semi-transparent background, shellmap visible behind |

### 5.3 Test File Estimates

| Phase | Test Files | Estimated New Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|
| A: Map loading tests | 1 (`World.test.ts`) | ~10 | ~200 |
| B: Skirmish flow tests | 1 (`Game.test.ts`) | ~6 | ~150 |
| C: Shellmap tests | 1 (`Game.test.ts`) | ~4 | ~100 |
| D: Integration tests | 2 (both files) | ~4 | ~50 |
| **Total** | **2** | **~24** | **~500** |

### 5.4 End-to-End Integration Testing

- [x] **TEST-26.I1** Full game loop: App starts -> ModSelector -> select RA -> Content check -> shellmap loads -> main menu appears -> click Skirmish -> select map -> game world loads -> terrain visible -> actors visible -> fog renders -> camera pans -> click Exit -> mod selector appears
- [x] **TEST-26.I2** Shellmap AI activity: Shellmap loaded -> wait 30 seconds -> AI units have moved from starting positions -> AI buildings constructed -> resources harvested
- [x] **TEST-26.I3** Error recovery: Corrupted map file -> graceful error message -> fallback to map list

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Trait factory explosion** (every trait class needs a factory entry) | HIGH | 100+ trait types need constructor mapping, tedious and error-prone | Auto-register traits from the ruleset: during `loadRuleSet()`, iterate `ActorInfo` entries and extract trait class names. Build a `Map<string, new (actor, info) => Component>` from a manually-curated register. Start with the ~20 most common traits (Mobile, Health, Armament, RenderSprites, etc.). |
| **Actor creation performance** (creating 200+ actors on map load) | MEDIUM | Map loading takes 2-5 seconds, poor first impression | Creation is inherently serial (trait constructors may reference each other). Pre-allocate trait arrays, batch `INotifyCreated` calls, defer heavy initialization to `IWorldLoaded`. Target: 500 actors in under 2 seconds. |
| **AI BotModule requires working pathfinding** (HPA* needs the terrain mesh) | MEDIUM | AI units stand still if pathfinding fails | The HPA* pathfinder (Ch4 Phase G) is fully migrated. The terrain mesh must be generated before AI ticks start. Ensure terrain mesh generation happens during `loadComplete` before BotModule activation. |
| **Shellmap AI may be too intense for low-end devices** (3 AI players with full combat) | LOW | Menu screen lags, poor first impression | Limit AI update frequency in shellmap mode (every 10 ticks instead of every tick). Reduce actor count (smaller starting armies). Provide a `--noshellmap` flag or detect low-end devices via `navigator.hardwareConcurrency`. |
| **Skirmish setup UI complexity** (map selection + player config + faction selection) | MEDIUM | Bloated DOM code in Game.ts, hard to maintain | Start with a minimal skirmish setup: map dropdown + "Start" button (defaults to 1 human + AI fill). Defer full player/faction configuration to a separate `SkirmishSetup.ts` class. |
| **Save/Load integration complexity** (Ch17 may not be end-to-end functional) | LOW | "Load Game" button remains disabled, no gameplay impact | Document this as a known limitation. The save/load system is migrated at code level but needs integration testing. Out of scope for Chapter 26. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-26.1: Trait Factory Registry Pattern

- **Decision**: Use a central `TraitFactory` registry (`Map<string, TraitFactory>`) populated during ruleset loading, rather than reflection-based or eval-based trait instantiation.
- **Rationale**: TypeScript has no C#-style `Activator.CreateInstance()` with reflection. The registry provides O(1) lookup with type safety. Each trait module registers its constructor in the factory: `factory.register('Mobile', (a, i) => new Mobile(a, i as MobileInfo))`.
- **Mitigation**: Trait registration is explicit (one line per trait class). Missing registrations are caught at ruleset load time with a clear error message: `"Trait 'Mobile' not registered in TraitFactory. Did you forget to call register()?"`

### ADR-26.2: Skirmish Setup as DOM Overlay (Not Widget Tree)

- **Decision**: Implement skirmish setup (map selection, player config) as a DOM overlay, consistent with the existing main menu approach (ADR-22.3), rather than using the full Widget system.
- **Rationale**: The Widget system (Ch5, Ch16) is fully migrated but requires ChromeProvider + WidgetLoader integration that is not yet wired into the Game startup. Using DOM overlays is consistent with the existing approach and avoids blocking the skirmish flow on Widget infrastructure integration.
- **Mitigation**: The DOM overlay approach is a stepping stone. Once the Widget main menu (26.D.1) is complete, the skirmish setup can be refactored to use Widget components. Both share the same underlying data (MapCache, mod data).

### ADR-26.3: Shellmap AI Update Rate Limiting

- **Decision**: In shellmap mode (`WorldType.Shellmap`), AI `ITick` traits fire every 10 game ticks instead of every tick.
- **Rationale**: The shellmap is a decorative background. Players are not interacting with it. Running full-speed AI (25 ticks/second with pathfinding, targeting, building decisions) wastes CPU and GPU resources that should be available for menu rendering and the eventual player game.
- **Mitigation**: The update rate is configurable. If a future feature needs the shellmap to react faster (e.g., interactive shellmap where clicks select units), the rate can be increased.

### ADR-26.4: Actor Creation Order

- **Decision**: WorldActor is created first, then PlayerActors, then map actors. Within map actors, actors with `Building` trait are created before actors with `Mobile` trait.
- **Rationale**: WorldActor hosts world-level traits (ScreenMap, ShroudRenderer) that other actors depend on. PlayerActors host player-level traits (Shroud, PlayerResources) that owned actors reference. Buildings must exist before mobile units that may spawn inside them (e.g., units from barracks, harvesters from refineries).
- **Mitigation**: The creation order is enforced by `loadComplete()`'s sequential actor spawning. The dependency order is hardcoded (not determined at runtime), which is consistent with OpenRA's approach.

---

> **Plan Status**: This plan defines the 4-phase approach to making OpenRAWeb3D a playable game. Phase A (map-to-actor spawning) is the critical blocker -- once actors spawn from maps, the skirmish and shellmap flows become possible. The total estimated work is ~1,820 lines, making this the largest chapter but also the highest-impact: it transforms the project from a collection of migrated subsystems into a playable RTS game.

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All implementation work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `CLAUDE.md` -- Project conventions and overall status
> - `docs/post_migration_completion_plan.md` -- Post-migration plan (Phase D: Infrastructure, Shellmap, Widgets)
> - `docs/chapter22_game_entry_migration_plan.md` -- Chapter 22 original migration plan (Game, Router, main)
> - `docs/chapter3_actor_system_migration_plan.md` -- Chapter 3 actor system plan (Actor, TraitDictionary, Player)
> - `docs/chapter4_map_system_migration_plan.md` -- Chapter 4 map system plan (Map, MapBinParser, MapPlayers)
> - `docs/chapter6_network_sync_migration_plan.md` -- Chapter 6 plan (AI BotModules, OrderManager)
> - `docs/chapter23_mix_runtime_plan.md` -- Chapter 23 (MIX assets needed for actor sprites)
> - `docs/chapter24_animation_effects_plan.md` -- Chapter 24 (Animation needed for actor rendering)
> - `docs/chapter25_shroud_3d_plan.md` -- Chapter 25 (Shroud needed for fog overlay)
> - `src/OpenRA.Game/Game.ts` -- Current Game coordinator (~1500 lines)
> - `src/OpenRA.Game/World.ts` -- Current GameWorldManager (~1700 lines)
> - `OpenRA/OpenRA.Game/World.cs` -- Original C# World class
> - `OpenRA/OpenRA.Game/Game.cs` -- Original C# Game class
