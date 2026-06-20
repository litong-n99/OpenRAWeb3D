# OpenRAWeb3D Main Menu GUI Fix Plan: Chapter 27

> **Source Reference**: OpenRA Red Alert main menu (`OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs`) + chrome YAML definitions (`OpenRA/mods/common/chrome/mainmenu.yaml`, etc.)
> **Chapter Status**: 🎉 ALL PHASES COMPLETE (15/15 tasks, 100%)
> **Phase A Commits**: `58995dd` (feat: chrome asset pipeline), `152890b` (fix: review findings)
> **Phase B Commits**: `1bacfc5` (feat: ChromeProvider + FileSystem wiring), `cbb2de9` (fix: review findings)
> **Phase C Commits**: `8ea60b1` (feat: Widget-based main menu activation), `e0a40a4` (fix: review findings BLOCKERs #1,#2 + MAJORs #3,#4), `3748c28` (fix: acceptance test review findings)
> **Phase D Commits**: `f339795` (feat: Ch27 Phase D Shellmap Asset Enablement), `17c8376` (fix: Phase D review findings MAJOR #1-#2, MINOR #1-#4)
> **Phase E Commits**: `e2768d1` (fix: shellmap-background test page 3 MINOR fixes), `61a4f42` (fix: Game.mainmenu.test.ts 1 BLOCKER + 3 MAJOR + 4 MINOR fixes), `4a7b579` (feat: Game.mainmenu.test.ts 47 integration tests)
> **Planning Date**: 2026-06-20
> **Prerequisite**: ALL Chapters 2-26 COMPLETE (782+ files, 100%). Post-migration completion plan ALL PHASES A-E COMPLETE (52/52, 100%).

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All implementation work should be done in TypeScript files under the corresponding `src/` paths, and build-time work in `scripts/` and `public/`.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Tasks (TODO)](#3-core-tasks-todo)
   - 3.1 [Phase A: Chrome Asset Pipeline](#31-phase-a-chrome-asset-pipeline)
   - 3.2 [Phase B: ChromeProvider + FileSystem Wiring](#32-phase-b-chromeprovider--filesystem-wiring)
   - 3.3 [Phase C: Widget-Based Main Menu Activation](#33-phase-c-widget-based-main-menu-activation)
   - 3.4 [Phase D: Shellmap Asset Enablement](#34-phase-d-shellmap-asset-enablement)
   - 3.5 [Phase E: Integration Testing and Visual Polish](#35-phase-e-integration-testing-and-visual-polish)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Problem Statement

After completing Chapters 2-26 (782+ files, 100% code migration), clicking "Play" in the mod selector produces a raw DOM overlay displaying "OpenRAWeb3D" with CSS-styled buttons -- not the authentic OpenRA Red Alert main menu GUI with:

- **Shellmap background**: Dynamic AI skirmish scene behind the menu (RA's iconic moving battlefield backdrop)
- **RA theme chrome UI**: The metal-panel aesthetic with proper 9-slice border rendering from `chrome.png` textures
- **Game fonts**: The `ZoodRangmah.ttf` title font and `FreeSans.ttf` body font used in the original
- **YAML-driven widget layout**: Menu buttons and panels defined in `common/chrome/mainmenu.yaml`, loaded via `ChromeProvider` + `WidgetLoader`

### 1.2 Root Cause Analysis

Five interlocking gaps prevent the proper main menu from appearing:

| # | Gap | Impact |
|:---:|---|------|
| 1 | **No `content.json` for ra mod** — `public/mods/ra/` has `mod.json` + `rules/` + `weapons/` + `sequences/` but no `content.json`, so `ContentInstallerService` never triggers and no game assets (textures, fonts, maps, chrome PNGs) are downloaded | No shellmap, no chrome textures, no fonts |
| 2 | **No `public/mods/common/` mod** — The `common` mod is referenced by `RequiresMods: ["common"]` in ra's `mod.json` and all `ChromeLayout` paths reference `common\|chrome/...`. This directory does not exist | ChromeProvider can't load chrome YAML definitions |
| 3 | **`build-mods.ts` doesn't convert chrome YAML** — It only converts `rules/`, `weapons/`, and `sequences/`. Chrome YAML files in `OpenRA/mods/{common,ra}/chrome/` are never compiled to JSON | No chrome JSON available for ChromeProvider to parse |
| 4 | **`_mountModDataFolders()` skips chrome** — Game.ts method only mounts `rules`, `weapons`, and `sequences` folders. Chrome files (even if built) are never mounted into the virtual FileSystem | ChromeProvider can't resolve `common\|chrome/mainmenu.yaml` paths |
| 5 | **`showMainMenu()` doesn't call `showMainMenuWidget()`** — The DOM overlay path is the active one. `showMainMenuWidget()` exists (creates Widget tree programmatically) but is never invoked from the main code path | Widget system unused for main menu |

### 1.3 Core Strategy: Connect Existing Components

This is **not a new subsystem build**. Every major component already exists and works:

| Component | Location | Status |
|-----------|----------|--------|
| `ChromeProvider` | `src/OpenRA.Game/Graphics/ChromeProvider.ts` | Fully implemented (resolves collections, DPI-aware images, CSS border-image) |
| `WidgetLoader` | `src/OpenRA.Game/Widgets/WidgetLoader.ts` | Fully implemented (loads widget trees from JSON) |
| `Widget` / `ContainerWidget` / `ButtonWidget` | `src/OpenRA.Game/Widgets/` | Fully implemented |
| `WidgetTypes` (65+ widget types) | Ch16 | Fully implemented |
| `FileSystem` | `src/OpenRA.Game/FileSystem/FileSystem.ts` | Fully implemented (with L1-L4 cache) |
| `Folder` package | `src/OpenRA.Game/FileSystem/Folder.ts` | Fully implemented (URL-based virtual folder) |
| `ContentInstallerService` | `src/OpenRA.Game/ContentInstaller/ContentInstallerService.ts` | Fully implemented |
| `MiniYamlParser` | `src/utils/miniyaml-to-json.ts` | Fully implemented |
| `build-mods.ts` | `scripts/build-mods.ts` | Fully implemented (converts mod.yaml + rules/weapons/sequences) |
| `Game.showMainMenuWidget()` | `src/OpenRA.Game/Game.ts` | Fully implemented (programmatic Widget tree) |
| `Game.loadShellMap()` | `src/OpenRA.Game/Game.ts` | Fully implemented (Phase 1-3 with fallbacks) |
| Shellmap AI + camera | `src/OpenRA.Game/Game.ts` | Fully implemented (Ch26 Phase C) |
| `ModularBot` | `src/OpenRA.Mods.Common/Traits/` | Fully implemented (Ch6 Phase D-E) |
| MixFileRuntime | `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` | Fully implemented (Ch23) |

The work is purely **integration**: build-time asset conversion + runtime wiring.

### 1.4 Architecture Principles

1. **Build-time conversion, runtime consumption**: Chrome YAML files are converted to JSON at build time (by extended `build-mods.ts`), stored in `public/mods/`, and loaded at runtime by `ChromeProvider.initialize()` via `FileSystem.openAsync()`.

2. **No new npm dependencies**: All conversion uses existing `MiniYamlParser`. Runtime loading uses existing `FileSystem` + `Folder`. No new packages.

3. **Progressive enablement**: Start with the `_test` mod (no ContentInstaller dependency), then enable ra mod chrome, then wire up content.json for full assets.

4. **Fallback chain preserved**: The DOM overlay remains as a fallback if Widget-based menu fails to load. Shellmap fallback to solid background color is preserved.

5. **ADR-22.3 superseded**: The original decision to use DOM overlay as a temporary solution is retired. The Widget-based approach becomes the primary render path.

6. **No OpenRA/ modifications**: All source data comes from `OpenRA/mods/` YAML files (read-only reference). Output goes to `public/mods/`.

---

## 2. File Mapping Table

### 2.1 Complete Task Inventory (15 tasks across 5 Phases)

| # | Target File(s) | Operation | Est. LOC | Complexity | Phase |
|:---:|:---|:---|:---:|:---:|:---:|
| **Phase A: Chrome Asset Pipeline** | | | | | |
| 1 | `scripts/build-chrome.ts` | **New**: Build script to convert OpenRA chrome YAML -> JSON | ~150 | MEDIUM | A |
| 2 | `scripts/build-mods.ts` | **Modify**: Add chrome conversion to build pipeline | ~30 | LOW | A |
| 3 | `public/mods/common/chrome/*.json` | **New**: Chrome JSON output (mainmenu.yaml, settings.yaml, etc.) | 0 (generated) | LOW | A |
| **Phase B: ChromeProvider + FileSystem Wiring** | | | | | |
| 4 | `src/OpenRA.Game/Game.ts` (`_mountModDataFolders`) | **Modify**: Add chrome + chromeLayout + chromeMetrics to folder mount list | ~30 | LOW | B | ✅ DONE (`1bacfc5`) |
| 5 | `src/OpenRA.Game/Game.ts` (`loadMod`) | **Modify**: Call ChromeProvider.initialize() after ModData init | ~40 | LOW | B | ✅ DONE (`1bacfc5`) |
| 6 | `src/OpenRA.Game/ModData.ts` | **Modify**: JSDoc for ADR-27.3 responsibility separation | ~30 | LOW | B | ✅ DONE (`1bacfc5`) |
| **Phase C: Widget-Based Main Menu Activation** | | | | | |
| 7 | `src/OpenRA.Game/Game.ts` (`showMainMenu`) | **Modify**: Wire showMainMenu() -> showMainMenuWidget() with YAML loading | ~80 | MEDIUM | C |
| 8 | `src/OpenRA.Game/Game.ts` (`showMainMenuWidget`) | **Modify**: Load from ChromeProvider + WidgetLoader instead of programmatic tree | ~60 | MEDIUM | C |
| 9 | `src/OpenRA.Game/Game.ts` | **Modify**: Wire button onClick handlers to game state transitions | ~50 | MEDIUM | C |
| **Phase D: Shellmap Asset Enablement** | | | | | |
| 10 | `scripts/build-content.ts` | **Modify**: Add ra-content content.json generation (maps + core assets) | ~80 | MEDIUM | D |
| 11 | `public/mods/ra/content.json` | **New**: Content manifest for Red Alert CDN packages | 0 (generated) | LOW | D |
| 12 | `src/OpenRA.Game/Game.ts` (`loadShellMap`) | **Modify**: Ensure shellmap loads real map after content install | ~40 | LOW | D |
| 13 | `public/fonts/` | **New/Verify**: Game fonts (ZoodRangmah.ttf, FreeSans.ttf) available via @font-face | ~30 | LOW | D |
| **Phase E: Integration Testing and Visual Polish** | | | | | |
| 14 | `src/__e2e__/manual/ch27-mainmenu/` | **New**: Acceptance test pages (3 test cases) | ~200 | MEDIUM | E |
| 15 | `src/OpenRA.Game/Game.test.ts` (or new test file) | **Modify/New**: Integration tests for menu widget flow | ~150 | MEDIUM | E |

> **Complexity Legend**:
> - **LOW**: Simple wire-up, configuration change, or generated output. 10-50 estimated TS lines.
> - **MEDIUM**: New script logic, Widget tree loading, or comprehensive test suite. 60-200 estimated TS lines.
> - **HIGH**: Complex multi-system integration. Not used in Ch27.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total tasks** | 15 |
| **New files** | 5 (build-chrome.ts, chrome JSON, content.json, fonts, e2e pages) |
| **Modified files** | 4 (build-mods.ts, Game.ts, ModData.ts, build-content.ts) |
| **Phase A (Chrome Pipeline)** | 3 tasks |
| **Phase B (ChromeProvider Wiring)** | 3 tasks |
| **Phase C (Widget Menu Activation)** | 3 tasks |
| **Phase D (Shellmap Enablement)** | 4 tasks |
| **Phase E (Integration Testing)** | 2 tasks |
| **LOW complexity** | 7 tasks |
| **MEDIUM complexity** | 8 tasks |
| **Estimated total new/changed lines** | ~1,200 (across all phases) |

---

## 3. Core Tasks (TODO)

### 3.1 Phase A: Chrome Asset Pipeline

**Status**: COMPLETE (2026-06-20)
**Complexity**: MEDIUM (build-chrome.ts), LOW (rest)
**Blocked by**: Nothing (all infrastructure available)
**Blocks**: Phase B, Phase C
**Commits**: `58995dd` (feat: implement Ch27 Phase A chrome asset pipeline), `152890b` (fix: address Ch27 Phase A review findings)

**Description**: Builds the chrome asset pipeline. A new build script (`build-chrome.ts`) converts OpenRA's chrome YAML definitions from `OpenRA/mods/{mod}/chrome/*.yaml` to `public/mods/{mod}/chrome/*.json`. The existing `build-mods.ts` is extended to invoke this script. This fills the critical gap: `public/mods/common/` and `public/mods/ra/chrome/` directories currently don't exist.

#### TODO Items

- [x] **TODO-27.A.1** `scripts/build-chrome.ts` (NEW, est. 150 lines -> actual 236 lines) -- Chrome YAML to JSON build script:
  - Iterate `OpenRA/mods/common/chrome/` and `OpenRA/mods/ra/chrome/` directories
  - For each `*.yaml` file, parse with existing `MiniYamlParser`
  - Convert to JSON and write to `public/mods/{mod}/chrome/{name}.json`
  - Handle mini-YAML merge semantics (files prefixed with `^` are overlays)
  - Output mapping: `OpenRA/mods/common/chrome/mainmenu.yaml` -> `public/mods/common/chrome/mainmenu.json`
  - Create all necessary output directories before writing (recursive mkdir)
  - Run via `npx tsx scripts/build-chrome.ts` (or integrated into build-mods.ts)

- [x] **TODO-27.A.2** `scripts/build-mods.ts` (MODIFY, est. 30 lines -> actual +69 lines) -- Integrate chrome conversion:
  - After rules/weapons/sequences conversion, invoke `buildChromeAssets()` for the mod
  - Extract `Chrome` and `ChromeLayout` paths from parsed mod.yaml
  - For each path (e.g., `common|chrome/mainmenu.yaml`), call `buildChromeYaml()`
  - Generate `public/mods/common/mod.json` (minimal manifest for the common mod) if it doesn't exist
  - Ensure `public/mods/common/chrome/` directory is populated with chrome JSON files
  - Add `chrome` and `chromeLayout` entries to the output mod.json so ChromeProvider can find them

- [x] **TODO-27.A.3** `public/mods/common/chrome/*.json` (GENERATED) -- Verify generated chrome JSON:
  - `mainmenu.json` -- Main menu widget tree definition
  - `settings.json` -- Settings panel layout
  - `ingame.json` -- In-game HUD chrome
  - `color-picker.json` -- Color picker widget
  - `dropdowns.json` -- Dropdown widget definitions
  - All other chrome YAML files from `OpenRA/mods/common/chrome/`
  - Output must pass `JSON.parse()` roundtrip validation

**Phase A Verification**:
- Run `npx tsx scripts/build-mods.ts` -- completes without errors
- `public/mods/common/chrome/mainmenu.json` exists and contains valid JSON
- `public/mods/ra/mod.json` contains `Chrome` and `ChromeLayout` arrays with correct paths
- `public/mods/common/mod.json` exists with minimal manifest

---

### 3.2 Phase B: ChromeProvider + FileSystem Wiring

**Status**: COMPLETE (2026-06-20)
**Complexity**: LOW
**Blocked by**: Phase A (chrome JSON files must exist)
**Blocks**: Phase C
**Commits**: `1bacfc5` (feat: implement Ch27 Phase B ChromeProvider + FileSystem wiring), `cbb2de9` (fix: address Ch27 Phase B review findings)

**Description**: Wires the chrome JSON files into the runtime FileSystem and initializes ChromeProvider during mod loading. This fills the gap where `_mountModDataFolders()` only mounted rules/weapons/sequences. After Phase B, `ChromeProvider` is initialized during `loadMod()` with chrome + chromeLayout + chromeMetrics paths mounted into the FileSystem, and properly deinitialized on `dispose()` / `switchMod()`.

**Implementation summary**:
- `Game.ts:_mountModDataFolders()` extended to mount chrome, chromeLayout, and chromeMetrics paths into the FileSystem
- `Game.ts:loadMod()` calls `await ChromeProvider.initialize(manifest, fileSystem)` after ModData init
- `Game.ts:dispose()` and `switchMod()` call `ChromeProvider.deinitialize()` for cleanup
- `ModData.ts` updated with JSDoc documenting ADR-27.3 responsibility separation (ChromeProvider init handled by Game.ts)
- MAJOR fix (`cbb2de9`): Removed redundant `deinitialize` call from `switchMod()` (double-deinitialize bug)
- MINOR fixes: JSDoc explicitly mentions chrome paths; malformed file paths emit `console.warn`

#### TODO Items

- [x] **TODO-27.B.1** `src/OpenRA.Game/Game.ts:_mountModDataFolders()` (MODIFY, est. 30 lines) -- Extend folder mounting to include chrome assets:
  - Add `manifest.chrome` and `manifest.chromeLayout` to the path lists that get mounted
  - Parse `common|chrome/mainmenu.yaml` paths into `{pkg: "common", file: "chrome/mainmenu.yaml"}`
  - Map `.yaml` to `.json` URL paths: `/mods/common/chrome/mainmenu.json`
  - Create `Folder` packages for new mod namespaces (`common`, `ra` for chrome files)
  - Mount via `fileSystem.mountPackage(folder, pkgName)` with duplicate guard

- [x] **TODO-27.B.2** `src/OpenRA.Game/Game.ts:loadMod()` (MODIFY, est. 40 lines) -- Initialize ChromeProvider:
  - After `modData.init()` and `_mountModDataFolders()`, call `await ChromeProvider.initialize(manifest, fileSystem)`
  - Handle initialization failure gracefully (log warning, continue without chrome)
  - Pass manifest.chrome and manifest.chromeLayout entries to ChromeProvider
  - Ensure deinitialize is called in `dispose()` / `switchMod()`

- [x] **TODO-27.B.3** `src/OpenRA.Game/ModData.ts` (MODIFY, est. 30 lines) -- ModData.ts JSDoc update:
  - Decision (ADR-27.3): ChromeProvider initialization is kept in Game.ts for explicit control. ModData remains Chrome-unaware.
  - Added JSDoc comment in ModData.ts documenting ChromeProvider init is handled by Game.ts
  - Added JSDoc comment noting the responsibility separation between Game.ts (UI orchestration) and ModData.ts (game data)

**Phase B Verification** (all verified 2026-06-20):
- [x] Load `_test` mod in browser -- no console errors related to chrome
- [x] `ChromeProvider.collections` is non-empty (contains at least "background" collection from mainmenu.json)
- [x] `ChromeProvider.resolveImage()` returns valid URLs for chrome definitions
- [x] FileSystem can resolve `common|chrome/mainmenu.yaml` via `fileSystem.openAsync()`
- [x] `ChromeProvider.deinitialize()` called in `dispose()` and `switchMod()` (no double-deinitialize)
- [x] All existing unit tests pass (`npm test`)
- [x] `npx tsc --noEmit` passes (zero type errors)

---

### 3.3 Phase C: Widget-Based Main Menu Activation

**Status**: COMPLETE (2026-06-20)
**Complexity**: MEDIUM
**Blocked by**: Phase B (ChromeProvider must be initialized)
**Blocks**: Phase E (acceptance tests validate the widget menu)
**Commits**: `8ea60b1` (feat: Widget-based main menu activation), `e0a40a4` (fix: review findings BLOCKERs #1,#2 + MAJORs #3,#4), `3748c28` (fix: acceptance test review findings)

**Description**: Connects `showMainMenu()` to the Widget-based rendering path. Currently, `showMainMenu()` creates a raw DOM overlay while `showMainMenuWidget()` creates a programmatic Widget tree (also DOM-based but using the Widget system). Phase C replaces the programmatic tree in `showMainMenuWidget()` with YAML-loaded widget tree from `ChromeProvider` + `WidgetLoader`, and wires `showMainMenu()` to call it.

**Implementation summary**:
- `Game.ts:showMainMenu()` changed to call `showMainMenuWidget()` instead of creating raw DOM, with DOM fallback on error
- `Game.ts:showMainMenuWidget()` replaced the programmatic `new ContainerWidget()` tree with `WidgetLoader.loadWidgetTree()` from ChromeProvider-loaded chrome JSON
- 7 widget types registered (Container, Button, Label, Background, Image, DropDownButton, LogicKeyListener)
- Button onClick handlers wired: Skirmish (`_openSkirmishSetup`), Settings (`_openSettingsPanel`), Exit (`_exitToModSelector`)
- WidgetLoader.loadUI() extended to support `node.id` matching (MiniYamlParser @Name compatibility)
- Acceptance test pages: 3 test cases under `src/__e2e__/manual/ch27-mainmenu/` (widget-menu-rendering, button-interaction, dom-fallback)
- BLOCKER fixes (`e0a40a4`): remove default empty loadUI() call in showMainMenuWidget(); fix WidgetLoader.loadUI() node.id matching
- MAJOR fixes (`e0a40a4`): register LogicKeyListenerWidget in ObjectCreator; fix escape key handler

#### TODO Items

- [x] **TODO-27.C.1** `src/OpenRA.Game/Game.ts:showMainMenu()` (MODIFY, est. 80 lines -> actual implementation) -- Wire to Widget path:
  - Change `showMainMenu()` to call `showMainMenuWidget()` instead of creating raw DOM
  - Keep the DOM overlay as fallback (catch errors from showMainMenuWidget, fall back to DOM)
  - Pass modId and manifest to showMainMenuWidget for WidgetLoader context
  - Remove the pulse keyframe injection (handled by Widget CSS or ChromeProvider)

- [x] **TODO-27.C.2** `src/OpenRA.Game/Game.ts:showMainMenuWidget()` (MODIFY, est. 60 lines -> actual implementation) -- Load from YAML/JSON:
  - Replace programmatic `new ContainerWidget()` tree with `WidgetLoader.load()` from chrome JSON
  - Load `mainmenu.json` from ChromeProvider: `WidgetLoader.loadWidgetTree(manifest, chromeJson)`
  - The main menu widget tree is defined in `common|chrome/mainmenu.json` (loaded via ChromeProvider)
  - Keep the existing button onClick handlers for Skirmish, Settings, Exit
  - Assert that widget types referenced in the YAML are registered in `ObjectCreator`

- [x] **TODO-27.C.3** `src/OpenRA.Game/Game.ts` (MODIFY, est. 50 lines -> actual implementation) -- Wire button actions:
  - After WidgetLoader creates the widget tree, find buttons by ID:
    - `btn_skirmish` -> `_openSkirmishSetup()`
    - `btn_multiplayer` -> disabled (Coming Soon)
    - `btn_settings` -> `_openSettingsPanel()`
    - `btn_exit` -> `_exitToModSelector()`
  - Use `widget.getElementById()` or `widget.findWidget()` to locate button widgets
  - Attach `onClick` callbacks via `ButtonWidget.onClick` property
  - Register Escape key handler (existing logic in showMainMenuWidget)

**Phase C Verification** (all verified 2026-06-20):
- [x] Click "Play" in mod selector -> Widget-based main menu appears (not raw DOM overlay)
- [x] Main menu has correct RA theme chrome styling (9-slice panels, metal texture)
- [x] Skirmish, Settings, Exit buttons work (trigger correct game state transitions)
- [x] DOM overlay fallback works if Widget loading fails
- [x] Escape key returns to mod selector
- [x] All existing unit tests pass (`npm test`)
- [x] `npx tsc --noEmit` passes (zero type errors)
- [x] 3 acceptance test pages created and reviewed (widget-menu-rendering, button-interaction, dom-fallback)

---

### 3.4 Phase D: Shellmap Asset Enablement

**Status**: COMPLETE (2026-06-20)
**Complexity**: MEDIUM
**Blocked by**: Phase A (content.json generation depends on chrome pipeline pattern)
**Blocks**: Phase E (acceptance tests verify shellmap + menu together)
**Commits**: `f339795` (feat: impl), `17c8376` (fix: review findings MAJOR #1-#2, MINOR #1-#4)

**Description**: Enables the shellmap background by ensuring game assets (maps, textures, fonts) are available. The `ContentInstallerService` needs a `content.json` manifest to download assets from the OpenRA CDN. Additionally, game fonts must be loaded via CSS `@font-face`.

**Implementation summary**:
- `scripts/build-content.ts` extended with dual-output: contentModId + targetModId content.json
- `_onContentInstalled()` 3-step pipeline: rehydrateFiles → ChromeProvider re-init → MapCache refresh
- 4 target mod content.json files generated (ra, td, d2k, ts)
- 3 game font files copied to `public/fonts/` + @font-face rules + `document.fonts.ready`
- MAJOR fix (`17c8376`): Build step integration for automated content.json regeneration; added error boundary try-catch for font loading
- MINOR fixes: JSDoc for `_onContentInstalled()` pipeline; console warnings for missing font files; removed stale TODO comments

#### TODO Items

- [x] **TODO-27.D.1** `scripts/build-content.ts` (MODIFY, est. 80 lines) -- Generate ra-content.json:
  - Extend build-content.ts to generate `public/mods/ra/content.json` from `OpenRA/mods/ra-content/installer/downloads.yaml`
  - The existing script already handles `ra-content`, `cnc-content`, `d2k-content`, `ts-content`
  - Verify that the generated `content.json` includes:
    - `scores.mix` (music)
    - `allies.mix`, `conquer.mix`, `interior.mix`, `temperat.mix`, `snow.mix` (terrain/sprite data)
    - `local.mix`, `russian.mix` (localization data)
    - `sounds.mix`, `speech.mix` (audio)
    - `general.mix`, `bits` (UI/chrome assets)
    - `lores`, `hires.mix` (sprite sheets)
  - The package list must match `public/mods/ra/mod.json` FileSystem entries

- [x] **TODO-27.D.2** `public/mods/ra/content.json` (GENERATED) -- Content manifest:
  - Ensure the file exists after running `npx tsx scripts/build-content.ts`
  - Verify JSON structure matches `ContentInstallerTypes.ModContentManifest`
  - Verify SHA1 hashes match OpenRA CDN values
  - Verify `testFiles` arrays for each package include valid test file paths

- [x] **TODO-27.D.3** `src/OpenRA.Game/Game.ts:loadShellMap()` (MODIFY, est. 40 lines) -- Content-aware shellmap:
  - After content installation succeeds, reload FileSystem with new mounted MIX packages
  - Re-initialize ChromeProvider with new assets (chrome textures now available from MIX files)
  - Re-load Widget tree with proper chrome textures (not just CSS fallbacks)
  - Ensure `MapCache` is refreshed after content install to pick up installed maps
  - The shellmap should show the real Red Alert title screen with shellmap background

- [x] **TODO-27.D.4** `public/fonts/` (NEW, est. 30 lines) -- Game font loading:
  - Copy or reference `FreeSans.ttf`, `FreeSansBold.ttf` from OpenRA content
  - Copy or reference `ZoodRangmah.ttf` (RA title font) from OpenRA content
  - These fonts are referenced in `mod.json` Fonts section: `common|FreeSans.ttf`, `ra|ZoodRangmah.ttf`
  - They can be served from `public/fonts/` or extracted from MIX archives at runtime
  - Add CSS `@font-face` rules in index.html or programmatically via Widget CSS
  - Font loading is async -- use `document.fonts.ready` or FontFace API

**Phase D Verification** (all verified 2026-06-20):
- [x] ContentInstallerService.checkContent('ra') returns 0 missing packages
- [x] Content download and extraction completes successfully
- [x] ChromeProvider resolves images to actual texture URLs (not null)
- [x] Shellmap background shows a dynamic AI skirmish (not solid color)
- [x] Title font "ZoodRangmah" renders correctly (not browser fallback font)
- [x] All existing unit tests pass (`npm test`)
- [x] `npx tsc --noEmit` passes (zero type errors)

---

### 3.5 Phase E: Integration Testing and Visual Polish

**Status**: COMPLETE (2026-06-20)
**Complexity**: MEDIUM
**Blocked by**: Phase C (widget menu must work), Phase D (shellmap must work)
**Blocks**: Nothing (final validation phase)
**Commits**: `e2768d1` (fix: shellmap-background test page 3 MINOR fixes), `61a4f42` (fix: Game.mainmenu.test.ts 1 BLOCKER + 3 MAJOR + 4 MINOR fixes), `4a7b579` (feat: Game.mainmenu.test.ts 47 integration tests)

**Description**: Created 3 manual acceptance test pages and 47 integration tests to validate the end-to-end main menu flow. Covers widget rendering, button interactions, shellmap background, and fallback paths. Acceptance test pages created under `src/__e2e__/manual/ch27-mainmenu/`.

**Implementation summary**:
- 3 acceptance test pages: widget-menu-rendering, button-interaction, shellmap-background (each with index.html + main.ts + README.md)
- 47 integration tests in Game.mainmenu.test.ts covering: showMainMenuWidget Widget tree loading, button onClick handlers, Escape key handler, hideMainMenu cleanup, DOM overlay fallback on Widget failure, double-invoke protection
- BLOCKER fix (`61a4f42`): Core test for showMainMenuWidget Widget tree loading was not testing the correct path
- MAJOR fixes: test assertions for button onClick callbacks, Escape key registration/unregistration, hideMainMenu cleanup verification
- MINOR fixes: JSDoc in test file, test naming conventions, DOM overlay fallback test edge cases, double-invoke test coverage

#### TODO Items

- [x] **TODO-27.E.1** `src/__e2e__/manual/ch27-mainmenu/` (NEW, 3 test pages) -- Acceptance tests:
  - **Test case 1: widget-rendering** -- Verify Widget-based main menu renders with correct chrome styling:
    - Background panel uses 9-slice border-image from chrome.png (or CSS fallback)
    - Title text renders with ZoodRangmah font (or verifiable fallback)
    - All 4 buttons (Skirmish, Multiplayer, Settings, Exit) are visible and positioned correctly
    - Version text is displayed at bottom
  - **Test case 2: button-interactions** -- Verify button click handlers:
    - Skirmish button opens the Skirmish setup modal
    - Settings button opens the Settings panel
    - Exit button returns to mod selector
    - Multiplayer button is disabled (greyed out)
    - Escape key returns to mod selector
  - **Test case 3: shellmap-background** -- Verify shellmap behind menu:
    - Shellmap scene is rendering behind the menu overlay
    - AI units are visible moving on the battlefield
    - Menu overlay is semi-transparent (shellmap visible through it)
    - Fallback to solid background works when no shellmap maps available
  - Each test page: `index.html` + `main.ts` + `README.md`

- [x] **TODO-27.E.2** `src/OpenRA.Game/__tests__/Game.mainmenu.test.ts` (NEW, 47 tests) -- Integration tests:
  - Test `showMainMenu()` calls `showMainMenuWidget()` (not raw DOM)
  - Test `showMainMenuWidget()` loads widget tree from ChromeProvider
  - Test button onClick handlers trigger correct Game methods
  - Test Escape key handler registration/unregistration
  - Test `hideMainMenu()` cleans up Widget tree and DOM elements
  - Test fallback to DOM overlay when Widget loading fails (mock ChromeProvider error)
  - Test double-invoke protection (calling showMainMenu twice doesn't create duplicate menus)

**Phase E Verification** (all verified 2026-06-20):
- [x] All 3 acceptance test pages pass manual visual verification
- [x] All 47 integration tests pass (`npm test -- src/OpenRA.Game/__tests__/Game.mainmenu.test.ts`)
- [x] `npx tsc --noEmit` passes (no type errors from new code)
- [x] All existing unit tests pass (`npm test`)

---

## 4. Dependency Graph

```
Phase A (Chrome Asset Pipeline) [x]
  │
  ├── 27.A.1 build-chrome.ts (NEW) [x]
  ├── 27.A.2 build-mods.ts integration [x]
  └── 27.A.3 chrome JSON verification [x]
  │
  ▼
Phase B (ChromeProvider + FileSystem Wiring) [x]
  │
  ├── 27.B.1 _mountModDataFolders extension [x]
  ├── 27.B.2 ChromeProvider.initialize() call [x]
  └── 27.B.3 ModData.ts (optional integration point) [x]
  │
  ▼
Phase C (Widget-Based Main Menu Activation) [x]
  │
  ├── 27.C.1 showMainMenu() → showMainMenuWidget() [x]
  ├── 27.C.2 showMainMenuWidget() → WidgetLoader.load() [x]
  └── 27.C.3 Button action wiring [x]
  │
  ├──────────────────────────────────────┐
  ▼                                      ▼
Phase D (Shellmap Asset Enablement) [x]  Phase E (Integration Testing) [x]
  │                                      │
  ├── 27.D.1 build-content.ts extension [x]  ├── 27.E.1 Acceptance test pages [x]
  ├── 27.D.2 content.json verification [x]   └── 27.E.2 Integration tests [x]
  ├── 27.D.3 loadShellMap content-aware [x]
  └── 27.D.4 Game font loading [x]
```

**Parallel execution paths**:
- Phase A -> Phase B -> Phase C (strict linear dependency)
- Phase C -> Phase D AND Phase E (parallel after Phase C)
- Phase D is content/asset work (build-time + runtime)
- Phase E is test work (started after Phase C + D, now COMPLETE)

**Execution order** (ALL COMPLETE): A.1 -> A.2 -> A.3 -> B.1 -> B.2 -> B.3 -> C.1 -> C.2 -> C.3 -> D.1 + D.4 (parallel) -> D.2 + D.3 (parallel) -> E.1 + E.2 (parallel)

---

## 5. Verification and Test Strategy

### 5.1 Build-Time Verification

```bash
# After Phase A: verify chrome JSON is generated
npx tsx scripts/build-mods.ts
ls public/mods/common/chrome/mainmenu.json  # must exist
ls public/mods/ra/mod.json                  # must have Chrome/ChromeLayout entries

# After Phase D: verify content.json is generated
npx tsx scripts/build-content.ts
ls public/mods/ra/content.json              # must exist
node -e "JSON.parse(require('fs').readFileSync('public/mods/ra/content.json','utf-8'))"  # valid JSON
```

### 5.2 Runtime Verification

```bash
# Unit tests
npm test -- --run  # All existing tests must pass

# Integration tests (Phase E)
npm test -- src/OpenRA.Game/__tests__/Game.mainmenu.test.ts

# Type checking
npx tsc --noEmit  # Zero errors
```

### 5.3 Manual Visual Verification

```bash
npm run dev
# Open http://localhost:5173/
# -> Mod Selector appears
# -> Click "Play" on Red Alert
# -> Content Installer runs (first time)
# -> Widget-based main menu with RA chrome appears
# -> Shellmap is visible behind the semi-transparent menu

# Acceptance test pages:
# http://localhost:5173/test/ch27-mainmenu/widget-rendering/
# http://localhost:5173/test/ch27-mainmenu/button-interactions/
# http://localhost:5173/test/ch27-mainmenu/shellmap-background/
```

### 5.4 Regression Guard

- All existing unit tests must continue to pass
- `Game.create()` with `_test` mod must still work (no content installer dependency)
- DOM overlay fallback must work when Widget loading fails
- `switchMod()` properly cleans up and re-initializes chrome for new mod

---

## 6. Risk and Considerations

### 6.1 Known Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------|
| OpenRA chrome YAML uses features not supported by MiniYamlParser | LOW | MEDIUM | Chrome YAML is mostly key-value collections with minimal inherit depth; MiniYamlParser handles this. If `^` overlay merges are complex, skip merge and load standalone. |
| ContentInstaller downloads large files (100MB+) on slow connections | MEDIUM | HIGH | Show progress UI (ContentInstallerUI already implemented). Cache in IndexedDB (FileSystem L2-L3 already implemented). |
| CORS restrictions on OpenRA CDN | LOW | HIGH | Mirror list is already configured in downloads.yaml. ContentInstallerService already handles mirror failover. |
| Chrome JSON file count mismatch between build and runtime | LOW | LOW | ChromeProvider.initialize() silently skips missing files (existing behavior). |
| Widget YAML types not registered in ObjectCreator | MEDIUM | MEDIUM | Verify widget registration during Phase C. Add defensive `undefined` checks in WidgetLoader. |

### 6.2 Edge Cases

1. **No chrome YAML files found**: ChromeProvider initializes with empty collections. `showMainMenuWidget()` falls back to DOM overlay. No crash.
2. **Content install fails (network error)**: ContentInstallerUI shows retry button. User can still access test mod without content.
3. **Font files not found**: Browser uses fallback system font. Menu is functional but not visually authentic.
4. **No shellmap maps in MapCache**: Falls back to solid background color (existing `setShellmapFallback()` behavior).
5. **Browser doesn't support @font-face or has strict CORS**: Font loading silently fails, menu text renders in fallback font.

### 6.3 Performance Considerations

- Chrome JSON files are small (<5KB each), loaded once and cached in memory
- ChromeProvider doesn't create GPU resources (all CSS-based), no dispose overhead
- Menu widget tree is ~5-10 widgets deep, renders in a single DOM pass
- ContentInstaller downloads are one-time; cached in IndexedDB, Cache API, and memory
- Shellmap runs a full AI skirmish in the background -- acceptable since it's capped at a small map and limited AI players

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-27.1: Widget-Based Main Menu as Primary Path

**Date**: 2026-06-20
**Status**: ACCEPTED (implemented in Phase A, commit `58995dd`)
**Supersedes**: ADR-22.3 (DOM overlay as temporary solution)

**Decision**: The Widget-based main menu (`showMainMenuWidget`) becomes the primary rendering path. The raw DOM overlay (`showMainMenu`) is demoted to a fallback invoked only when WidgetLoader or ChromeProvider fails.

**Rationale**:
1. Widget system (Ch5 + Ch16) is fully implemented and tested (65+ widget types, 1,900+ tests)
2. ChromeProvider + WidgetLoader can load YAML-defined widget trees matching OpenRA's layout exactly
3. Using the Widget system enables future main menu extensions (multiplayer lobby, replay browser, etc.) via the same YAML-driven pipeline
4. The DOM overlay was always marked as temporary (ADR-22.3: "集成完成之后，届时可替换此 DOM 实现")

**Consequences**:
- `showMainMenu()` must import and invoke Widget module dynamically
- Button action wiring must be done after WidgetLoader creates the tree
- Fallback path must be tested (DOM overlay shows when Widget fails)

### ADR-27.2: Chrome JSON at Build Time

**Date**: 2026-06-20
**Status**: ACCEPTED (implemented in Phase A, commit `58995dd`)

**Decision**: Chrome YAML files are converted to JSON at build time by `build-mods.ts` (extended), stored in `public/mods/`, and loaded at runtime by `ChromeProvider.initialize()` via `FileSystem.openAsync()`.

**Rationale**:
1. Consistent with existing rules/weapons/sequences build pipeline
2. Avoids bundling a YAML parser in the browser runtime (MiniYamlParser is 762 lines)
3. JSON.parse() is native and fast; ChromeProvider already consumes JSON
4. Static JSON files can be served with optimal caching headers

**Alternatives considered**:
- **Runtime YAML parsing**: Rejected. MiniYamlParser is not tree-shakeable and adds ~16KB to the bundle. Build-time conversion is the established pattern.
- **Inline JSON in mod.json**: Rejected. Chrome definitions can be large (mainmenu.yaml alone defines many widget trees). Separate files keep mod.json clean.

**Consequences**:
- `build-mods.ts` must be extended to process chrome YAML files
- `public/mods/common/` directory must be created and populated
- Build step required after any chrome YAML change in OpenRA/

### ADR-27.3: ChromeProvider Initialization in Game.ts

**Date**: 2026-06-20
**Status**: ACCEPTED (implemented in Phase B, commit `1bacfc5`)

**Decision**: `ChromeProvider.initialize()` is called from `Game.loadMod()`, not from `ModData.init()`. ModData remains unaware of ChromeProvider.

**Rationale**:
1. Game.ts is the initialization orchestrator (creates FileSystem, mounts folders, creates ModData)
2. ChromeProvider is a UI concern, not a data concern -- it doesn't belong in ModData
3. Game.ts already handles the initialization sequence; adding one more step is consistent
4. ModData remains focused on ruleset/game data, not UI chrome

**Consequences**:
- `ChromeProvider.initialize(manifest, fileSystem)` must be called after `_mountModDataFolders()` (so chrome files are mounted)
- `ChromeProvider.deinitialize()` must be called in `Game.dispose()` and `Game.switchMod()`
- ModData.ts carries a JSDoc comment documenting that ChromeProvider init is handled externally by Game.ts
