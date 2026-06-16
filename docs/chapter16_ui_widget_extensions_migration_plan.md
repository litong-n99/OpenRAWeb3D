# OpenRA to Babylon.js Migration Plan: Chapter 16 -- UI Widget Extensions

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.6 (UI Widgets) + `docs/remaining_systems_migration_plan.md` Section 3.9
> **Chapter Status**: PLANNING (0/~65 migrated, 0%)
> **Planning Date**: 2026-06-16
> **Prerequisite**: Chapters 2-15 COMPLETE (401/401, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Primitive UI Controls](#31-phase-a-primitive-ui-controls)
   - 3.2 [Phase B: Game HUD Widgets & Utilities](#32-phase-b-game-hud-widgets--utilities)
   - 3.3 [Phase C: Menu Screen Logic](#33-phase-c-menu-screen-logic)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's UI Widget Extensions completes the player-facing user interface layer for the game. Chapters 2-15 built the complete gameplay infrastructure (rendering, actor, map, networking, combat, movement, economy, production, shroud, support powers, activities, order generators). Chapter 5 Phases C-D established the widget core framework (`Widget`, `ChromeProvider`, `WidgetLoader`, `ChromeMetrics`). Chapter 16 implements the remaining ~65 Chrome UI widgets and Logic classes that players interact with during gameplay -- from primitive form controls to the full game HUD and menu screens.

The core paradigm shift: **from OpenRA's imperative 2D OpenGL widget rendering (immediate-mode quads + sprite-sheet atlases + bitmap font glyphs) to HTML/CSS DOM-based UI layered over the Babylon.js 3D canvas**, reusing the existing Widget framework from Chapter 5:

- **2D sprite-sheet button/chrome rendering** → CSS `border-image` with 9-slice sprite atlas coordinates from `ChromeProvider` (Ch5 Phase D)
- **Bitmap font text rendering** (`SpriteFont.DrawText`) → CSS `font-family` + `color` on DOM text nodes; text measurement via Canvas 2D `measureText()` API
- **Immediate-mode `DrawPanel()` quad fills** → CSS `border-image` with pre-computed 9-slice from `ChromeProvider.GetPanelImages()`
- **`Game.Renderer.EnableScissor()` clipping** → CSS `overflow: hidden` on container `<div>` elements
- **Stateful sprite images** (`-disabled`, `-pressed`, `-hover` suffixes) → CSS class toggling or Canvas `drawImage()` from sprite atlas
- **`Func<T>` data binding delegates** → TypeScript arrow functions `() => T` evaluated each frame with optional `CachedTransform` lazy evaluation
- **YAML widget tree definitions** → JSON widget trees loaded by existing `WidgetLoader` (Ch5 Phase D); MiniYAML→JSON preprocessed at build time (Ch4 Phase H)
- **`ChromeLogic` behavior classes** → TypeScript `ChromeLogic` subclasses (already abstracted in Ch5 Phase D), constructor-receives widget + context, wires event handlers
- **`Ui.OpenWindow()/CloseWindow()` screen transitions** → DOM-based modal stacking: append/remove top-level widget tree roots, CSS `z-index` layering

### 1.2 Architecture Principles

1. **DOM-first rendering with Canvas fallback**: Standard widgets (Button, Label, TextField, Slider, Checkbox, ScrollPanel) render as HTML DOM elements. Only widgets requiring custom 2D pixel rendering (RadarWidget minimap, MapPreviewWidget, LineGraphWidget, ColorMixerWidget) use `<canvas>` elements embedded within the widget's DOM container. This preserves text accessibility, native scrolling, and CSS styling for ~80% of widgets.

2. **Widget-Logic separation maintained**: Every widget that has behavioral logic follows OpenRA's `Widget` + `ChromeLogic` pattern exactly. Widget handles `render(): HTMLElement` and input event routing; Logic (a `ChromeLogic` subclass) wires event handlers, manages state, and interfaces with game systems. Logic classes are independently unit-testable.

3. **Reactive data binding via Func delegates**: OpenRA's `GetText: Func<string>`, `GetColor: Func<Color>`, `IsVisible: Func<bool>`, `IsDisabled: Func<bool>` pattern maps directly to TypeScript arrow functions. A `CachedTransform<K,V>` utility enables lazy evaluation with cache invalidation, matching OpenRA's `CachedTransform` semantics.

4. **ChromeProvider 9-slice via CSS border-image**: The existing `ChromeProvider` (Ch5 Phase D) provides sprite atlas coordinates for 9-slice panel images (TL, T, TR, L, C, R, BL, B, BR). These map to CSS `border-image-source` + `border-image-slice` for GPU-accelerated panel rendering without per-pixel sprite drawing.

5. **Screen transitions via DOM modal stacking**: `Ui.openWindow(widgetId, args)` creates a new top-level widget tree root, appends it to the root container, and pushes it onto the WindowList stack. `Ui.closeWindow()` removes the top element, revealing the previous screen. This matches OpenRA's exact window lifecycle semantics (`hidden()`/`becameHidden()`/`becameVisible()`).

6. **ProductionPalette deep integration pattern**: The `ProductionPaletteWidget` is the most complex widget (649 lines C#). It integrates with `ProductionQueue` (Ch11), `PlayerResources` (Ch10), `SupportPowerManager` (Ch13), and the icon rendering pipeline. Its migration serves as the reference pattern for all game-state-dependent widgets.

7. **RadarWidget 2D canvas minimap**: The minimap renders terrain tiles, actor positions, and shroud/fog overlay via a hidden `<canvas>` element within the widget's DOM bounds. Terrain data comes from `Map` (Ch4), shroud visibility from `Shroud` (Ch12), and actor positions from `GameWorldManager` (Ch3). Camera viewport rectangle and coordinate transforms use `ViewportControllerWidget` (Ch7 Phase B).

8. **Lazy-loaded menu screens**: Menu screen Logic classes (MainMenuLogic, LobbyLogic, SettingsLogic, etc.) are loaded dynamically via `WidgetLoader` from pre-compiled JSON widget tree definitions. Each screen is a self-contained widget tree with its own `ChromeLogic` wiring. This enables screens to be developed and tested independently.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-15 is available for Chapter 16:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, rendering groups |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, sprite rendering pipeline |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, `TraitDictionary` |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IRender` |
| Condition System | Ch3 | `ConditionManager`, reference-counted condition tokens |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA* pathfinder, `CPos`, `WPos` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist<->world-space |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest` |
| **Widget core + ChromeProvider** | **Ch5 Phases C-D** | **`Widget`, `ChromeProvider`, `ChromeMetrics`, `WidgetLoader`** |
| **WorldInteractionControllerWidget** | **Ch5 Phase E** | **Click-to-target, order generation bridge** |
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `UnitOrders`, `OrderManager` |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo`, trait config loading |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Keycode`, `Viewport`, `SelectionUtils` |
| **ViewportControllerWidget** | **Ch7 Phase B** | **Camera control widget, viewport scroll/zoom** |
| Audio system | Ch7 Phase D | `Sound`, `SoundDevice` |
| Weapons & Combat | Ch8 | `Armament`, `AttackBase`, `AutoTarget`, `Warhead`, `WeaponInfo` |
| Movement & Physics | Ch9 | `Mobile`, `Aircraft`, `Locomotor` |
| Resource & Economy | Ch10 | `Harvester`, `PlayerResources`, `ResourceLayer` |
| Production & Building | Ch11 | `ProductionQueue`, `Production`, `Building`, `RallyPoint` |
| Shroud & Fog of War | Ch12 | `Shroud`, `FrozenActorLayer`, `ShroudRenderer` |
| Support Powers | Ch13 | `SupportPower`, `SupportPowerManager`, `SupportPowerInstance` |
| Activity Implementations | Ch14 | All concrete Activity implementations |
| Order Generators | Ch15 | `OrderGenerator`, `UnitOrderGenerator`, all concrete generators |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (~65 files across 3 Phases)

> **Scope Note**: The `OpenRA/OpenRA.Mods.Common/Widgets/` directory contains ~109 .cs files total (44 root-level widgets + ~65 Logic/ files). This plan covers ~65 core files across 3 phases. The following are **deferred** to other chapters or future phases:
> - **Logic/Editor/* (16 files)** → Chapter 21 (Editor & Utilities)
> - **EditorViewportControllerWidget.cs** → Chapter 21
> - **Logic/Ingame/Hotkeys/* (14 files)** → Phase C-optional (can be added post-core), as they are thin wrappers (~35-100 lines each) around hotkey registrations
> - **Logic/Installation/* (5 files)** → Phase C-optional (content installation UI, requires Ch17+Ch18 server infrastructure)
> - **Small standalone visual widgets** (BadgeWidget 46 lines, ColorBlockWidget 80 lines, BackgroundWidget 43 lines, etc.) → included in Phase A as they are trivial

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Primitive UI Controls** | | | | | |
| 1 | `OpenRA.Mods.Common/Widgets/ButtonWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ButtonWidget.ts` | `ButtonWidget` | 298 | MEDIUM | A |
| 2 | `OpenRA.Mods.Common/Widgets/LabelWidget.cs` | `src/OpenRA.Mods.Common/Widgets/LabelWidget.ts` | `LabelWidget` | 132 | LOW | A |
| 3 | `OpenRA.Mods.Common/Widgets/ImageWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ImageWidget.ts` | `ImageWidget` | 98 | LOW | A |
| 4 | `OpenRA.Mods.Common/Widgets/CheckboxWidget.cs` | `src/OpenRA.Mods.Common/Widgets/CheckboxWidget.ts` | `CheckboxWidget` | 90 | LOW | A |
| 5 | `OpenRA.Mods.Common/Widgets/TextFieldWidget.cs` | `src/OpenRA.Mods.Common/Widgets/TextFieldWidget.ts` | `TextFieldWidget` | 617 | HIGH | A |
| 6 | `OpenRA.Mods.Common/Widgets/PasswordFieldWidget.cs` | `src/OpenRA.Mods.Common/Widgets/PasswordFieldWidget.ts` | `PasswordFieldWidget` | 23 | LOW | A |
| 7 | `OpenRA.Mods.Common/Widgets/SliderWidget.cs` | `src/OpenRA.Mods.Common/Widgets/SliderWidget.ts` | `SliderWidget` | 145 | LOW | A |
| 8 | `OpenRA.Mods.Common/Widgets/ExponentialSliderWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ExponentialSliderWidget.ts` | `ExponentialSliderWidget` | 50 | LOW | A |
| 9 | `OpenRA.Mods.Common/Widgets/DropDownButtonWidget.cs` | `src/OpenRA.Mods.Common/Widgets/DropDownButtonWidget.ts` | `DropDownButtonWidget` | 256 | MEDIUM | A |
| 10 | `OpenRA.Mods.Common/Widgets/ScrollPanelWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ScrollPanelWidget.ts` | `ScrollPanelWidget` | 527 | HIGH | A |
| 11 | `OpenRA.Mods.Common/Widgets/ScrollItemWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ScrollItemWidget.ts` | `ScrollItemWidget` | 97 | LOW | A |
| 12 | `OpenRA.Mods.Common/Widgets/HotkeyEntryWidget.cs` | `src/OpenRA.Mods.Common/Widgets/HotkeyEntryWidget.ts` | `HotkeyEntryWidget` | 162 | LOW | A |
| 13 | `OpenRA.Mods.Common/Widgets/TooltipContainerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/TooltipContainerWidget.ts` | `TooltipContainerWidget` | 114 | LOW | A |
| 14 | `OpenRA.Mods.Common/Widgets/LabelWithTooltipWidget.cs` | `src/OpenRA.Mods.Common/Widgets/LabelWithTooltipWidget.ts` | `LabelWithTooltipWidget` | 64 | LOW | A |
| 15 | `OpenRA.Mods.Common/Widgets/LabelWithHighlightWidget.cs` | `src/OpenRA.Mods.Common/Widgets/LabelWithHighlightWidget.ts` | `LabelWithHighlightWidget` | 86 | LOW | A |
| 16 | `OpenRA.Mods.Common/Widgets/LabelForInputWidget.cs` | `src/OpenRA.Mods.Common/Widgets/LabelForInputWidget.ts` | `LabelForInputWidget` | 48 | LOW | A |
| 17 | `OpenRA.Mods.Common/Widgets/SpriteWidget.cs` | `src/OpenRA.Mods.Common/Widgets/SpriteWidget.ts` | `SpriteWidget` | 82 | LOW | A |
| 18 | `OpenRA.Mods.Common/Widgets/RGBASpriteWidget.cs` | `src/OpenRA.Mods.Common/Widgets/RGBASpriteWidget.ts` | `RGBASpriteWidget` | 39 | LOW | A |
| 19 | `OpenRA.Mods.Common/Widgets/ColorBlockWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ColorBlockWidget.ts` | `ColorBlockWidget` | 80 | LOW | A |
| 20 | `OpenRA.Mods.Common/Widgets/GradientColorBlockWidget.cs` | `src/OpenRA.Mods.Common/Widgets/GradientColorBlockWidget.ts` | `GradientColorBlockWidget` | 57 | LOW | A |
| 21 | `OpenRA.Mods.Common/Widgets/BackgroundWidget.cs` | `src/OpenRA.Mods.Common/Widgets/BackgroundWidget.ts` | `BackgroundWidget` | 43 | LOW | A |
| 22 | `OpenRA.Mods.Common/Widgets/GridLayout.cs` | `src/OpenRA.Mods.Common/Widgets/GridLayout.ts` | `GridLayout` | 48 | LOW | A |
| 23 | `OpenRA.Mods.Common/Widgets/ListLayout.cs` | `src/OpenRA.Mods.Common/Widgets/ListLayout.ts` | `ListLayout` | 47 | LOW | A |

| **Phase B: Game HUD Widgets & Utilities** | | | | | |
| 24 | `OpenRA.Mods.Common/Widgets/WidgetUtils.cs` | `src/OpenRA.Mods.Common/Widgets/WidgetUtils.ts` | `WidgetUtils` | 428 | MEDIUM | B |
| 25 | `OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.ts` | `ProductionPaletteWidget` | 649 | HIGH | B |
| 26 | `OpenRA.Mods.Common/Widgets/ProductionTabsWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ProductionTabsWidget.ts` | `ProductionTabsWidget` | 370 | MEDIUM | B |
| 27 | `OpenRA.Mods.Common/Widgets/ProductionTypeButtonWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ProductionTypeButtonWidget.ts` | `ProductionTypeButtonWidget` | 28 | LOW | B |
| 28 | `OpenRA.Mods.Common/Widgets/SupportPowersWidget.cs` | `src/OpenRA.Mods.Common/Widgets/SupportPowersWidget.ts` | `SupportPowersWidget` | 298 | MEDIUM | B |
| 29 | `OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.ts` | `SupportPowerTimerWidget` | 97 | LOW | B |
| 30 | `OpenRA.Mods.Common/Widgets/RadarWidget.cs` | `src/OpenRA.Mods.Common/Widgets/RadarWidget.ts` | `RadarWidget` | 530 | HIGH | B |
| 31 | `OpenRA.Mods.Common/Widgets/ResourceBarWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ResourceBarWidget.ts` | `ResourceBarWidget` | 107 | LOW | B |
| 32 | `OpenRA.Mods.Common/Widgets/ResourcePreviewWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ResourcePreviewWidget.ts` | `ResourcePreviewWidget` | 92 | LOW | B |
| 33 | `OpenRA.Mods.Common/Widgets/ControlGroupsWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ControlGroupsWidget.ts` | `ControlGroupsWidget` | 173 | LOW | B |
| 34 | `OpenRA.Mods.Common/Widgets/StrategicProgressWidget.cs` | `src/OpenRA.Mods.Common/Widgets/StrategicProgressWidget.ts` | `StrategicProgressWidget` | 106 | LOW | B |
| 35 | `OpenRA.Mods.Common/Widgets/ConfirmationDialogs.cs` | `src/OpenRA.Mods.Common/Widgets/ConfirmationDialogs.ts` | `ConfirmationDialogs` | 194 | MEDIUM | B |
| 36 | `OpenRA.Mods.Common/Widgets/TextNotificationsDisplayWidget.cs` | `src/OpenRA.Mods.Common/Widgets/TextNotificationsDisplayWidget.ts` | `TextNotificationsDisplayWidget` | 138 | LOW | B |
| 37 | `OpenRA.Mods.Common/Widgets/ProgressBarWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ProgressBarWidget.ts` | `ProgressBarWidget` | 85 | LOW | B |
| 38 | `OpenRA.Mods.Common/Widgets/LogicTickerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/LogicTickerWidget.ts` | `LogicTickerWidget` | 22 | LOW | B |
| 39 | `OpenRA.Mods.Common/Widgets/LogicKeyListenerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/LogicKeyListenerWidget.ts` | `LogicKeyListenerWidget` | 36 | LOW | B |
| 40 | `OpenRA.Mods.Common/Widgets/ColorMixerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ColorMixerWidget.ts` | `ColorMixerWidget` | 189 | MEDIUM | B |

| **Phase C: Menu Screen Logic** | | | | | |
| 41 | `OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.ts` | `MainMenuLogic` | 566 | HIGH | C |
| 42 | `OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyLogic.ts` | `LobbyLogic` | 1056 | HIGHEST | C |
| 43 | `OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyUtils.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyUtils.ts` | `LobbyUtils` | 707 | HIGH | C |
| 44 | `OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyOptionsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyOptionsLogic.ts` | `LobbyOptionsLogic` | 198 | LOW | C |
| 45 | `OpenRA.Mods.Common/Widgets/Logic/LoadGameBrowserLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/LoadGameBrowserLogic.ts` | `LoadGameBrowserLogic` | 1039 | HIGH | C |
| 46 | `OpenRA.Mods.Common/Widgets/Logic/ReplayBrowserLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/ReplayBrowserLogic.ts` | `ReplayBrowserLogic` | 883 | HIGH | C |
| 47 | `OpenRA.Mods.Common/Widgets/Logic/ServerListLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/ServerListLogic.ts` | `ServerListLogic` | 892 | HIGH | C |
| 48 | `OpenRA.Mods.Common/Widgets/Logic/MapChooserLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/MapChooserLogic.ts` | `MapChooserLogic` | 660 | MEDIUM | C |
| 49 | `OpenRA.Mods.Common/Widgets/Logic/MissionBrowserLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/MissionBrowserLogic.ts` | `MissionBrowserLogic` | 631 | MEDIUM | C |
| 50 | `OpenRA.Mods.Common/Widgets/Logic/MapGeneratorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/MapGeneratorLogic.ts` | `MapGeneratorLogic` | 463 | MEDIUM | C |
| 51 | `OpenRA.Mods.Common/Widgets/Logic/ServerCreationLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/ServerCreationLogic.ts` | `ServerCreationLogic` | 257 | LOW | C |
| 52 | `OpenRA.Mods.Common/Widgets/Logic/ConnectionLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/ConnectionLogic.ts` | `ConnectionLogic` | 282 | MEDIUM | C |
| 53 | `OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsLogic.ts` | `SettingsLogic` | 197 | LOW | C |
| 54 | `OpenRA.Mods.Common/Widgets/Logic/Settings/DisplaySettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/DisplaySettingsLogic.ts` | `DisplaySettingsLogic` | 575 | HIGH | C |
| 55 | `OpenRA.Mods.Common/Widgets/Logic/Settings/HotkeysSettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/HotkeysSettingsLogic.ts` | `HotkeysSettingsLogic` | 379 | MEDIUM | C |
| 56 | `OpenRA.Mods.Common/Widgets/Logic/Settings/InputSettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/InputSettingsLogic.ts` | `InputSettingsLogic` | 232 | LOW | C |
| 57 | `OpenRA.Mods.Common/Widgets/Logic/Settings/AudioSettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/AudioSettingsLogic.ts` | `AudioSettingsLogic` | 173 | LOW | C |
| 58 | `OpenRA.Mods.Common/Widgets/Logic/Settings/GamePlaySettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/GamePlaySettingsLogic.ts` | `GamePlaySettingsLogic` | 192 | LOW | C |
| 59 | `OpenRA.Mods.Common/Widgets/Logic/Settings/AdvancedSettingsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/AdvancedSettingsLogic.ts` | `AdvancedSettingsLogic` | 91 | LOW | C |
| 60 | `OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsUtils.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsUtils.ts` | `SettingsUtils` | 77 | LOW | C |
| 61 | `OpenRA.Mods.Common/Widgets/Logic/EncyclopediaLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/EncyclopediaLogic.ts` | `EncyclopediaLogic` | 318 | MEDIUM | C |
| 62 | `OpenRA.Mods.Common/Widgets/Logic/MusicPlayerLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/MusicPlayerLogic.ts` | `MusicPlayerLogic` | 170 | LOW | C |
| 63 | `OpenRA.Mods.Common/Widgets/Logic/CreditsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/CreditsLogic.ts` | `CreditsLogic` | 97 | LOW | C |
| 64 | `OpenRA.Mods.Common/Widgets/Logic/GameSaveBrowserLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/GameSaveBrowserLogic.ts` | `GameSaveBrowserLogic` | 599 | MEDIUM | C |
| 65 | `OpenRA.Mods.Common/Widgets/MapPreviewWidget.cs` | `src/OpenRA.Mods.Common/Widgets/MapPreviewWidget.ts` | `MapPreviewWidget` | 233 | MEDIUM | C |

> **Complexity Legend**:
> - **LOW**: Simple data display or single-interaction widget with few dependencies. 22-194 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate input handling, state management, or multi-element composition. 189-660 lines of C# with event-driven interaction.
> - **HIGH**: Complex widgets with deep integration into game systems, real-time data binding, or custom rendering. 527-1056 lines of C#.
> - **HIGHEST**: Extreme complexity with multi-system integration. LobbyLogic at 1056 lines C# is the single largest Logic file in all of OpenRA.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 65 (23 Phase A + 17 Phase B + 25 Phase C) |
| **Phase A (Primitive UI Controls)** | 23 files |
| **Phase B (Game HUD & Utilities)** | 17 files |
| **Phase C (Menu Screen Logic)** | 25 files |
| **HIGHEST complexity** | 1 file (LobbyLogic, 1056 lines C#) |
| **HIGH complexity** | 7 files (TextFieldWidget, ScrollPanelWidget, ProductionPaletteWidget, RadarWidget, MainMenuLogic, LoadGameBrowserLogic, ReplayBrowserLogic, ServerListLogic, DisplaySettingsLogic, LobbyUtils) |
| **MEDIUM complexity** | 14 files |
| **LOW complexity** | 33 files |
| **Total OpenRA C# source lines** | ~16,230 |

| Phase | Files | C# Lines | Est. TS Lines | Est. Tests | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Primitive UI Controls | 23 | 3,350 | ~7,500 | ~160 | PLANNING (0/23) |
| B: Game HUD & Utilities | 17 | 3,540 | ~8,000 | ~175 | PLANNING (0/17) |
| C: Menu Screen Logic | 25 | 9,340 | ~19,500 | ~420 | PLANNING (0/25) |
| **TOTAL** | **65** | **~16,230** | **~35,000** | **~755** | **PLANNING (0/65)** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Primitive UI Controls

**Status**: PLANNING (0/23 migrated)
**Complexity**: LOW-HIGH (PasswordFieldWidget 23 lines LOW, TextFieldWidget 617 lines HIGH, ScrollPanelWidget 527 lines HIGH)
**Blocked by**: Chapter 5 Phases C-D (Widget core framework -- COMPLETE)
**Blocks**: Phase B (Game HUD widgets use primitive controls as building blocks), Phase C (All menu screens use buttons, labels, text fields, scroll panels)

**Description**: Leaf-node UI building blocks that form the vocabulary of all higher-level widgets. These 23 controls have zero or minimal dependencies on other widget classes beyond the `Widget` base from Ch5 Phase D. `ButtonWidget` is the core interactive widget extending `InputWidget` with click/key/disabled/hover states. `TextFieldWidget` is the most complex primitive (617 lines C#) with cursor management, text selection, validation, and keyboard input handling. `ScrollPanelWidget` (527 lines C#) implements smooth scrolling, thumb rendering, `IObservableCollection` binding, and item template cloning. The remaining 20 controls are small (22-298 lines) with simple rendering and state. All ~23 files can be developed in parallel since they are independent of each other.

**Paradigm Shifts**:
- C# `SpriteFont.DrawText()` bitmap glyph rendering → CSS `font-family` on DOM text node + Canvas 2D `measureText()` for text metrics
- C# `WidgetUtils.GetStatefulImageName()` sprite suffix selection → CSS class toggling (`-disabled`, `-pressed`, `-hover`) or Canvas sprite atlas blitting
- C# `Game.Renderer.EnableScissor()` → CSS `overflow: hidden` on container `<div>`
- C# `ScrollPanelWidget` custom scroll physics → CSS `overflow-y: auto` with native scrollbar, or custom scroll via `transform: translateY()` with touch/pointer events
- C# `HotkeyEntryWidget` key capture via SDL2 → DOM `keydown` event capture with `Keycode` (Ch7 Phase A) mapping
- C# `DropDownButtonWidget` popup panel → absolutely-positioned `<div>` sibling with `z-index` elevation
- C# `GridLayout`/`ListLayout` child positioning → CSS `display: grid` / `display: flex` with computed cell sizes from `ChromeMetrics`

#### 3.1.1 ButtonWidget

- [ ] **TODO-16.A.1** `src/OpenRA.Mods.Common/Widgets/ButtonWidget.ts` (298 lines C#) -- Standard clickable button:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ButtonWidget.cs`
  - Extends `InputWidget` (from Ch5 Phase D Widget.ts), supports `OnClick`, `OnKeyDown`, disabled/hover/pressed states
  - `GetText: () => string` delegate for runtime text updates
  - `GetColor: () => Color` delegate for runtime tint
  - `GetBackground: () => string` delegate for runtime background image
  - `GetTooltipText: () => string` delegate for tooltip content
  - `chrome: string` property for ChromeProvider 9-slice panel collection
  - Stateful image rendering: `-disabled` suffix when disabled, `-pressed` when mouse-down, `-hover` when hovered
  - `font: string` and `textAlign: TextAlign` for label rendering
  - `key: Keycode` for keyboard shortcut binding
  - `isHighlighted: () => boolean` for visual highlight state
  - Sound playback on click via Ch7 Phase D `Sound`
  - **Precision requirement**: Button press state must activate on `pointerdown` (not `click`) matching OpenRA's immediate feedback. Text positioning within button must match OpenRA within 2px at 1024x768 reference resolution.

#### 3.1.2 LabelWidget

- [ ] **TODO-16.A.2** `src/OpenRA.Mods.Common/Widgets/LabelWidget.ts` (132 lines C#) -- Static text label:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/LabelWidget.cs`
  - `GetText: () => string` delegate for runtime text content
  - `getColor: () => Color` delegate for text color
  - `getContrastColor: () => Color` for text shadow contrast color
  - `getContrast: boolean` toggle for text shadow rendering
  - `align: TextAlign` (Left/Center/Right) and `wordWrap: boolean`
  - `font: string` for font family/size selection
  - **Precision requirement**: Text position and wrapping must match OpenRA line-breaking behavior (word-break and character-break rules)

#### 3.1.3 ImageWidget

- [ ] **TODO-16.A.3** `src/OpenRA.Mods.Common/Widgets/ImageWidget.ts` (98 lines C#) -- Static sprite/image display:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ImageWidget.cs`
  - `imageCollection: string` for ChromeProvider sprite atlas reference
  - `imageName: string` for specific sprite within collection
  - `ScaleTexture: boolean` for CSS `background-size: contain` vs `cover`
  - Supports both ChromeProvider sprite atlas and direct image URL rendering
  - **Precision requirement**: Sprite atlas UV coordinates from ChromeProvider must match pixel boundaries within 1px

#### 3.1.4 CheckboxWidget

- [ ] **TODO-16.A.4** `src/OpenRA.Mods.Common/Widgets/CheckboxWidget.ts` (90 lines C#) -- Binary toggle checkbox:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/CheckboxWidget.cs`
  - `getValue: () => boolean` for checked state, `setValue: (v: boolean) => void` for toggle
  - Checkmark sprite from ChromeProvider (`checked` image name suffix)
  - Click to toggle, keyboard Space/Enter to toggle
  - Visual states: unchecked, checked, disabled-unchecked, disabled-checked
  - **Precision requirement**: Checkbox hit area must match OpenRA's 12px clickable zone

#### 3.1.5 TextFieldWidget

- [ ] **TODO-16.A.5** `src/OpenRA.Mods.Common/Widgets/TextFieldWidget.ts` (617 lines C#) -- Text input field with cursor and selection:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/TextFieldWidget.cs`
  - `getText: () => string` / `setText: (v: string) => void` for value binding
  - `maxLength: number` for character limit
  - `placeholder: string` for hint text when empty
  - Cursor rendering: blinking caret with `caretColor`, `caretFlashInterval`
  - Text selection via Shift+Arrow or pointer drag, with selection highlight
  - Keyboard input handling: character insertion, Backspace/Delete, Home/End, Ctrl+A, Ctrl+C/V/X
  - `onEnterKey: () => void` and `onEscapeKey: () => void` delegates
  - `type: TextFieldType` (Text, Integer, Float, Password -- PasswordFieldWidget delegates to this)
  - Input validation for Integer/Float types with min/max bounds
  - Scroll-to-cursor when text exceeds visible width
  - **Precision requirement**: Cursor positioning must match OpenRA glyph-advance-based calculation within 1px. Text selection tracking must handle double-click word-select and triple-click line-select matching OpenRA behavior.

#### 3.1.6 PasswordFieldWidget

- [ ] **TODO-16.A.6** `src/OpenRA.Mods.Common/Widgets/PasswordFieldWidget.ts` (23 lines C#) -- Masked password input:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/PasswordFieldWidget.cs`
  - Extends `TextFieldWidget` with asterisk masking (`bullet: '*'`)
  - Overrides text rendering to display `*` characters instead of actual text
  - Internal value stored unmasked; visual rendering masked
  - **Precision requirement**: Inherits all TextFieldWidget cursor/selection precision requirements

#### 3.1.7 SliderWidget

- [ ] **TODO-16.A.7** `src/OpenRA.Mods.Common/Widgets/SliderWidget.ts` (145 lines C#) -- Draggable range slider:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/SliderWidget.cs`
  - `getValue: () => number` / `setValue: (v: number) => void` for 0.0-1.0 range
  - `minimumValue: number` (default 0) and `maximumValue: number` (default 1)
  - `ticks: number` for discrete step count (0 = continuous)
  - Thumb sprite rendering with drag interaction (pointerdown + pointermove + pointerup)
  - Track background sprite with thumb position proportional to value
  - Keyboard Left/Right arrows for incremental adjustment
  - **Precision requirement**: Thumb position linear interpolation must match OpenRA rounding (integer pixel positions). Slider value must be quantized to `ticks` steps when `ticks > 0`.

#### 3.1.8 ExponentialSliderWidget

- [ ] **TODO-16.A.8** `src/OpenRA.Mods.Common/Widgets/ExponentialSliderWidget.ts` (50 lines C#) -- Logarithmic scale slider:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ExponentialSliderWidget.cs`
  - Extends `SliderWidget` with exponential value mapping
  - Internal 0.0-1.0 slider position maps to `minValue * (maxValue/minValue)^position` output
  - Used for audio volume and other logarithmic-scale controls
  - **Precision requirement**: Exponential curve evaluation must match OpenRA within 0.001 float tolerance

#### 3.1.9 DropDownButtonWidget

- [ ] **TODO-16.A.9** `src/OpenRA.Mods.Common/Widgets/DropDownButtonWidget.ts` (256 lines C#) -- Button with attached popup panel:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/DropDownButtonWidget.cs`
  - Extends `ButtonWidget` with popup panel attachment
  - `panelId: string` references a hidden panel in the widget tree
  - Click toggles panel visibility below/above the button
  - Auto-close on outside click or Escape key
  - Panel positioning: below button by default, above if insufficient space
  - Scroll support for long option lists within the panel
  - **Precision requirement**: Panel must appear within 1 frame (16ms) of button click. Auto-close must trigger on the pointerup that occurs outside the panel bounds.

#### 3.1.10 ScrollPanelWidget

- [ ] **TODO-16.A.10** `src/OpenRA.Mods.Common/Widgets/ScrollPanelWidget.ts` (527 lines C#) -- Scrollable content container:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ScrollPanelWidget.cs`
  - `itemTemplate: string` -- widget ID to clone for each item (template instantiation pattern)
  - `layout: ILayout` (GridLayout or ListLayout) for child positioning
  - `contentHeight: number` and `scrollPosition: number` for scroll state
  - Thumb rendering: draggable scroll thumb sized proportionally to visible/content ratio
  - Smooth scrolling via mouse wheel and touch gestures
  - `scrollVelocity: number` for kinetic/inertia scrolling
  - `topBottomSpacing: number` and `itemSpacing: number` from layout
  - `IObservableCollection` binding for dynamic item lists
  - Keyboard navigation: Up/Down/PageUp/PageDown/Home/End
  - Scrollbar visibility: auto-hide when content fits, show when overflow
  - **Precision requirement**: Scroll thumb size ratio must match OpenRA `thumbHeight = max(visibleHeight * visibleHeight / totalContentHeight, 20px)`. Scroll position must snap to item boundaries when `smoothScroll: false`.

#### 3.1.11 ScrollItemWidget

- [ ] **TODO-16.A.11** `src/OpenRA.Mods.Common/Widgets/ScrollItemWidget.ts` (97 lines C#) -- Selectable scroll panel item:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ScrollItemWidget.cs`
  - Extends `ButtonWidget` with `isSelected: () => boolean` state
  - `itemKey: string` for identifying items in observable collections
  - Selected state visual: distinct background chrome when selected
  - Click to select, keyboard Enter to activate
  - Used as the template item cloned by `ScrollPanelWidget`
  - **Precision requirement**: Selection highlight must toggle within 1 frame of click

#### 3.1.12 HotkeyEntryWidget

- [ ] **TODO-16.A.12** `src/OpenRA.Mods.Common/Widgets/HotkeyEntryWidget.ts` (162 lines C#) -- Key binding capture widget:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/HotkeyEntryWidget.cs`
  - `getValue: () => Hotkey` / `setValue: (h: Hotkey) => void` for key binding
  - Captures next key press when focused, displaying key name
  - Handles modifier keys (Ctrl, Alt, Shift, Meta) as key combo components
  - `HotkeyReference` integration from Ch7 Phase B
  - Visual states: normal (display bound key), capturing (flashing caret, awaiting input), unbound (empty)
  - Escape to clear binding, Backspace to unbind
  - **Precision requirement**: Key capture must consume the event (stopPropagation) to prevent the captured key from triggering other UI actions

#### 3.1.13 TooltipContainerWidget

- [ ] **TODO-16.A.13** `src/OpenRA.Mods.Common/Widgets/TooltipContainerWidget.ts` (114 lines C#) -- Tooltip display container:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/TooltipContainerWidget.cs`
  - `setTooltip(template: Widget, args: WidgetArgs): void` for tooltip display
  - `removeTooltip(): void` for tooltip dismissal
  - Tooltip positioning: follows mouse cursor with offset, clamped to screen bounds
  - Show delay: customizable delay (default ~250ms) before tooltip appears
  - Auto-dismiss on mouse leave from the triggering widget
  - **Precision requirement**: Tooltip must not overflow viewport bounds (clamp to edges with 4px margin). Show delay must match OpenRA's `tooltipDelay` ChromeMetrics value.

#### 3.1.14 LabelWithTooltipWidget

- [ ] **TODO-16.A.14** `src/OpenRA.Mods.Common/Widgets/LabelWithTooltipWidget.ts` (64 lines C#) -- Label with hover tooltip:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/LabelWithTooltipWidget.cs`
  - Extends `LabelWidget` with `tooltipText: string` and `tooltipContainer: string` properties
  - On mouse enter: calls `tooltipContainer.setTooltip()` with tooltip content
  - On mouse exit: calls `tooltipContainer.removeTooltip()`
  - **Precision requirement**: Tooltip show delay and positioning inherited from TooltipContainerWidget

#### 3.1.15 LabelWithHighlightWidget

- [ ] **TODO-16.A.15** `src/OpenRA.Mods.Common/Widgets/LabelWithHighlightWidget.ts` (86 lines C#) -- Label with highlighted text segments:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/LabelWithHighlightWidget.cs`
  - Extends `LabelWidget` with `highlightedText: string` for substring matching
  - Renders matching text portions with distinct color/weight
  - Case-insensitive matching by default
  - Used for search result highlighting in server browser, map chooser, etc.
  - **Precision requirement**: Highlight must match all overlapping occurrences (not just first match). Text measurement must account for bold/regular weight difference in highlighted vs normal spans.

#### 3.1.16 LabelForInputWidget

- [ ] **TODO-16.A.16** `src/OpenRA.Mods.Common/Widgets/LabelForInputWidget.ts` (48 lines C#) -- Label linked to an input widget:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/LabelForInputWidget.cs`
  - Extends `LabelWidget` with `inputWidgetId: string` reference
  - Click on label transfers focus to the linked input widget
  - Used for accessibility: clicking "Player Name:" focuses the name text field
  - **Precision requirement**: Focus transfer must occur on `pointerup` (not `click`) matching native `<label>` behavior

#### 3.1.17 SpriteWidget

- [ ] **TODO-16.A.17** `src/OpenRA.Mods.Common/Widgets/SpriteWidget.ts` (82 lines C#) -- Unlimited-size sprite rendering:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/SpriteWidget.cs`
  - Renders a sprite from `Sheet` (Ch2) with no size constraints
  - `sprite: string` for sprite asset reference
  - `scale: number` for display scaling
  - Uses Canvas 2D `drawImage()` from sprite atlas for rendering
  - **Precision requirement**: Sprite UV coordinates from Sheet must match pixel-accurate boundaries

#### 3.1.18 RGBASpriteWidget

- [ ] **TODO-16.A.18** `src/OpenRA.Mods.Common/Widgets/RGBASpriteWidget.ts` (39 lines C#) -- RGBA channel sprite variant:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/RGBASpriteWidget.cs`
  - Extends `SpriteWidget` with RGBA color channel support
  - Uses `RgbaSpriteRenderer` (Ch2) color tinting via Canvas globalCompositeOperation
  - **Precision requirement**: RGBA channel rendering must match Ch2 `RgbaSpriteRenderer` color modulation

#### 3.1.19 ColorBlockWidget

- [ ] **TODO-16.A.19** `src/OpenRA.Mods.Common/Widgets/ColorBlockWidget.ts` (80 lines C#) -- Solid color rectangle:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ColorBlockWidget.cs`
  - `getColor: () => Color` delegate for runtime color
  - Rendered as CSS `background-color` on `<div>`
  - Used for health bars, team color indicators, UI accents
  - **Precision requirement**: Color must exactly match OpenRA `Color.RGB` values (no browser color management variance beyond sRGB)

#### 3.1.20 GradientColorBlockWidget

- [ ] **TODO-16.A.20** `src/OpenRA.Mods.Common/Widgets/GradientColorBlockWidget.ts` (57 lines C#) -- Gradient-filled rectangle:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/GradientColorBlockWidget.cs`
  - `startColor: Color` and `endColor: Color` for gradient endpoints
  - `gradientDirection: GradientDirection` (Horizontal, Vertical)
  - Rendered as CSS `linear-gradient` background
  - **Precision requirement**: Gradient stops must use the same interpolation as OpenRA's CPU-side gradient computation (linear RGB interpolation)

#### 3.1.21 BackgroundWidget

- [ ] **TODO-16.A.21** `src/OpenRA.Mods.Common/Widgets/BackgroundWidget.ts` (43 lines C#) -- Panel background decorator:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/BackgroundWidget.cs`
  - `background: string` for ChromeProvider panel collection name
  - Renders 9-slice panel background via CSS `border-image` with ChromeProvider sprite atlas
  - Used as a decorator widget placed behind other widgets
  - **Precision requirement**: 9-slice borders must match ChromeProvider.GetPanelImages() pixel dimensions

#### 3.1.22 GridLayout

- [ ] **TODO-16.A.22** `src/OpenRA.Mods.Common/Widgets/GridLayout.ts` (48 lines C#) -- Grid-based child layout:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/GridLayout.cs`
  - Implements `ILayout` interface for grid cell positioning
  - `columnCount: number` for grid columns
  - `cellWidth: number` and `cellHeight: number` from ChromeMetrics
  - Calculates child widget positions in row-major order
  - Used by `ScrollPanelWidget` for grid-based item lists
  - **Precision requirement**: Cell position calculation must match OpenRA's integer pixel rounding

#### 3.1.23 ListLayout

- [ ] **TODO-16.A.23** `src/OpenRA.Mods.Common/Widgets/ListLayout.ts` (47 lines C#) -- List-based child layout:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ListLayout.cs`
  - Implements `ILayout` interface for vertical list positioning
  - `itemHeight: number` from ChromeMetrics
  - `itemSpacing: number` for gap between items
  - Vertical stacking with optional horizontal centering
  - Used by `ScrollPanelWidget` for list-based item displays
  - **Precision requirement**: Item position calculation must match OpenRA's integer pixel rounding

**Phase A Summary**: 23 files, ~3,350 C# lines source. All files are leaf-node widgets with zero cross-widget dependencies (each extends `Widget` directly). Can be fully parallel-assigned (23 independent development tasks). Estimated ~7,500 TS implementation lines + ~5,500 test lines, 160 tests. Foundation for ALL subsequent phases.

---

### 3.2 Phase B: Game HUD Widgets & Utilities

**Status**: PLANNING (0/17 migrated)
**Complexity**: LOW-HIGH (LogicTickerWidget 22 lines LOW, ProductionPaletteWidget 649 lines HIGH, RadarWidget 530 lines HIGH)
**Blocked by**: Chapter 5 Phases C-D (Widget core -- COMPLETE), Phase A (primitive controls used as building blocks), Chapter 10 (PlayerResources), Chapter 11 (ProductionQueue), Chapter 12 (Shroud), Chapter 13 (SupportPowerManager)
**Blocks**: Phase C (Menu screens use WidgetUtils helpers)

**Description**: Game HUD widgets that overlay the 3D viewport during gameplay. `ProductionPaletteWidget` (649 lines C#) is the most complex Phase B widget -- it renders a grid of producible actor icons with clock-animation progress overlays, cost text, and tooltip integration. `RadarWidget` (530 lines C#) renders a real-time minimap via Canvas 2D with terrain tiles, actor positions, shroud/fog overlay, and camera viewport rectangle. `WidgetUtils` (428 lines C#) provides static helper methods used by virtually all widgets: panel drawing, text formatting, time formatting, text wrapping, and button icon binding. Support widgets manage resources, support powers, control groups, and progress displays. `ConfirmationDialogs` provides standard modal confirm/cancel prompts. `ColorMixerWidget` provides HSV color picker with hue slider.

**Paradigm Shifts**:
- C# `ProductionPaletteWidget.Draw()` overlay rendering (clock, progress bars, hotkey labels via `SpriteFont`) → HTML `<div>` overlay with CSS `conic-gradient` for clock animation and Canvas text for overlay labels
- C# `RadarWidget` minimap (`Sheet` byte-pixel array + `SpriteRenderer` sprites) → `<canvas>` with `ImageData` manipulation for terrain + actor rendering
- C# `WidgetUtils.DrawPanel()` 9-slice via `RgbaSpriteRenderer` → CSS `border-image` from `ChromeProvider` sprite atlas
- C# `WidgetUtils.FormatTime()` → JavaScript `Date` formatting with same zero-padded output
- C# `WidgetUtils.WrapText()` `SpriteFont` line-breaking → Canvas 2D `measureText()` for word-wrap computation
- C# `ColorMixerWidget` HSV picker with custom sprite rendering → `<canvas>` with HSL color space rendering + `<input type="range">` for hue slider

#### 3.2.1 WidgetUtils

- [ ] **TODO-16.B.1** `src/OpenRA.Mods.Common/Widgets/WidgetUtils.ts` (428 lines C#) -- Static widget helper functions:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/WidgetUtils.cs`
  - `drawPanel(collection: string, bounds: Rectangle): void` -- 9-slice panel rendering via CSS border-image from ChromeProvider
  - `drawPanelPartial(collection: string, bounds: Rectangle, state: string): void` -- partial stateful panel
  - `fillRectWithColor(rect: Rectangle, color: Color): void` -- CSS background-color fill
  - `fillEllipseWithColor(rect: Rectangle, color: Color): void` -- CSS border-radius based ellipse
  - `drawSprite(sprite: Sprite, pos: Vector2): void` -- sprite rendering at position
  - `drawRGBASprite(sprite: Sprite, pos: Vector2, color: Color): void` -- tinted sprite rendering
  - `formatTime(ticks: number, timestep: number): string` -- "MM:SS" time formatting
  - `formatFPS(fps: number): string` -- FPS with one decimal place
  - `wrapText(text: string, font: Font, maxWidth: number): string[]` -- text line-breaking using Canvas 2D measureText
  - `getStatefulImageName(base: string, state: WidgetState): string` -- appends `-disabled`/`-pressed`/`-hover` suffixes
  - `getCachedStatefulImageName(cache: Map, ...)`: cached variant of stateful image name lookup
  - `getTextContrastColor(textColor: Color): Color` -- white/black contrast selection for text shadow
  - `bindButtonIcon(button: ButtonWidget): void` -- wires button icon from ChromeProvider
  - **Precision requirement**: `drawPanel` 9-slice borders must match OpenRA pixel dimensions from ChromeProvider within 1px. `wrapText` line breaks must match OpenRA SpriteFont wrapping (break on word boundaries, then character boundaries).

#### 3.2.2 ProductionPaletteWidget

- [ ] **TODO-16.B.2** `src/OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.ts` (649 lines C#) -- Production queue icon palette:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs`
  - Displays grid of producible actor icons from `ProductionQueue` (Ch11)
  - Each icon shows: actor sprite, production cost, hotkey label, progress clock overlay
  - Clock animation overlay: CSS `conic-gradient` from 0° to 360° representing build progress (0-100%)
  - `displayIcon(icon: ProductionIcon, index: number): Widget` -- creates icon button with overlays
  - Click dispatches production order via `OrderManager` (Ch6 Phase A)
  - Right-click cancels production with hotkey-based cancel logic
  - `currentQueue: ProductionQueue` binding -- watches queue changes
  - `trayHolds: number` -- max visible icons (9 default, building tabs may show fewer)
  - Ready notification pulse animation when unit completes
  - Tooltip showing unit name, cost, build time, prerequisites on hover
  - Production type tabs (buildings, defense, infantry, vehicles, aircraft, navy)
  - Integration with `PlayerResources` (Ch10) for affordability gray-out
  - **Precision requirement**: Clock overlay angle must match `360 * (1 - remainingCost/totalCost)`. Icon grid spacing must match `ChromeMetrics.productionIconWidth`/`Height`. Right-click cancel must target correct queue item when multiple queues share a palette.

#### 3.2.3 ProductionTabsWidget

- [ ] **TODO-16.B.3** `src/OpenRA.Mods.Common/Widgets/ProductionTabsWidget.ts` (370 lines C#) -- Production category tab bar:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ProductionTabsWidget.cs`
  - Renders horizontal tab bar for production queue categories
  - Each tab shows: category icon, ready queue count badge
  - `ProductionTypeButtonWidget` instances for each queue type
  - Tab switching changes which queue the ProductionPaletteWidget displays
  - Tab highlight indicates currently active queue
  - Queue count badge shows number of completed (ready-to-place) items
  - **Precision requirement**: Tab selection must switch ProductionPaletteWidget display within 1 frame. Badge count must match ProductionQueue.QueuedItems.length exactly.

#### 3.2.4 ProductionTypeButtonWidget

- [ ] **TODO-16.B.4** `src/OpenRA.Mods.Common/Widgets/ProductionTypeButtonWidget.ts` (28 lines C#) -- Production type tab button:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ProductionTypeButtonWidget.cs`
  - Extends `ButtonWidget` with `productionType: string` property
  - Click activates the associated production queue for display
  - Displays category-specific icon from ChromeProvider
  - **Precision requirement**: Inherits all ButtonWidget precision requirements

#### 3.2.5 SupportPowersWidget

- [ ] **TODO-16.B.5** `src/OpenRA.Mods.Common/Widgets/SupportPowersWidget.ts` (298 lines C#) -- Support power icon palette:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/SupportPowersWidget.cs`
  - Displays grid of support power icons from `SupportPowerManager` (Ch13)
  - Each icon shows: power sprite, cooldown clock overlay, hotkey label, ready pulse
  - `SupportPowerTimerWidget` instances for cooldown countdown display
  - Click activates support power (enters targeting mode via `OrderGenerator`)
  - Right-click cancels pending power targeting
  - Clock overlay: CSS `conic-gradient` showing cooldown progress (same as ProductionPaletteWidget)
  - Ready notification: pulsing animation when power is available
  - Tooltip showing power name, description, charge time on hover
  - **Precision requirement**: Clock overlay must match `SupportPowerInstance.remainingTicks / totalTicks`. Icon order must match `SupportPowerManager.powers` list order. Tooltip must update in real-time as charge progresses.

#### 3.2.6 SupportPowerTimerWidget

- [ ] **TODO-16.B.6** `src/OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.ts` (97 lines C#) -- Cooldown timer overlay for support powers:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.cs`
  - Displays countdown text overlay ("2:30") on support power icon
  - `getText: () => string` delegate returning formatted remaining time
  - `isVisible: () => boolean` -- hidden when power is ready
  - Text color changes: white during normal cooldown, red when almost ready (<10s)
  - **Precision requirement**: Timer text must update every 500ms (not every frame). Format must match `WidgetUtils.FormatTime()`.

#### 3.2.7 RadarWidget

- [ ] **TODO-16.B.7** `src/OpenRA.Mods.Common/Widgets/RadarWidget.ts` (530 lines C#) -- Minimap radar widget:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/RadarWidget.cs`
  - Renders minimap via `<canvas>` element within widget bounds
  - Terrain layer: scaled-down terrain tile colors from `Map` (Ch4) rendered via `ImageData`
  - Actor layer: colored dots (2x2 pixel squares) at actor world positions scaled to minimap
  - Shroud layer: black overlay for unexplored cells, semi-transparent for explored-but-not-visible from `Shroud` (Ch12)
  - Camera viewport rectangle: white outline showing current camera area on minimap
  - Click-to-jump: clicking on minimap moves `Viewport` (Ch7 Phase B) camera to that world position
  - Right-click: issues move/attack-move order at minimap position
  - Drag-scroll: dragging within minimap pans camera
  - Radar bin signal animation for radar dome buildings
  - `MinimapColorFunc` interface for custom actor color mapping
  - Cache management: terrain and actor layers cached, only redrawn on dirty events
  - **Precision requirement**: Minimap coordinate transform from world position to canvas pixel must match `(worldX - mapLeft) * canvasWidth / mapWidth` within 1px. Shroud opacity must match OpenRA: unexplored=100% black, explored=50% black, visible=0% black.

#### 3.2.8 ResourceBarWidget

- [ ] **TODO-16.B.8** `src/OpenRA.Mods.Common/Widgets/ResourceBarWidget.ts` (107 lines C#) -- Resource/cash display bar:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ResourceBarWidget.cs`
  - Displays player's cash/resources count with $ prefix
  - `getText: () => string` binding to `PlayerResources.cash` (Ch10)
  - Color changes: green when increasing, red when decreasing, white when stable
  - Flashing animation on significant resource change (>100)
  - **Precision requirement**: Cash display must update within 1 frame of `PlayerResources` tick. Flashing duration must be exactly 10 ticks (250ms at 25tps).

#### 3.2.9 ResourcePreviewWidget

- [ ] **TODO-16.B.9** `src/OpenRA.Mods.Common/Widgets/ResourcePreviewWidget.ts` (92 lines C#) -- Resource tooltip preview:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ResourcePreviewWidget.cs`
  - Renders small resource sprite + density indicator
  - Used in map preview tooltips to show resource deposits
  - `resourceType: string` and `density: number` (0-100)
  - **Precision requirement**: Density color must use OpenRA's density-to-color mapping (low=yellow, medium=orange, high=red)

#### 3.2.10 ControlGroupsWidget

- [ ] **TODO-16.B.10** `src/OpenRA.Mods.Common/Widgets/ControlGroupsWidget.ts` (173 lines C#) -- Control group assignment display:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ControlGroupsWidget.cs`
  - Displays 10 control group slots (0-9) with unit icons
  - Each slot shows: group number, miniature unit icon grid
  - Ctrl+number assigns selected units to group
  - Number key selects group (double-tap centers camera on group)
  - Integration with `SelectionUtils` (Ch7 Phase C) for unit selection management
  - **Precision requirement**: Group selection must deselect current and select group within 1 tick. Double-tap detection window must be 300ms matching OpenRA.

#### 3.2.11 StrategicProgressWidget

- [ ] **TODO-16.B.11** `src/OpenRA.Mods.Common/Widgets/StrategicProgressWidget.ts` (106 lines C#) -- Strategic victory progress bar:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/StrategicProgressWidget.cs`
  - Displays progress toward strategic victory condition
  - Horizontal bar with fill percentage and text label
  - `getValue: () => number` for 0-100% progress
  - `label: string` for progress description
  - **Precision requirement**: Bar fill width must be integer pixel width (no sub-pixel rendering)

#### 3.2.12 ConfirmationDialogs

- [ ] **TODO-16.B.12** `src/OpenRA.Mods.Common/Widgets/ConfirmationDialogs.ts` (194 lines C#) -- Standard modal confirmation dialogs:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ConfirmationDialogs.cs`
  - `promptConfirm(title: string, message: string, onConfirm: () => void, onCancel?: () => void): void`
  - `promptTextInput(title: string, message: string, onConfirm: (text: string) => void, onCancel?: () => void): void`
  - Modal overlay: semi-transparent background blocking all other interaction
  - Dialog panel: centered panel with title, message text, OK/Cancel buttons
  - Keyboard: Enter confirms, Escape cancels
  - Button text localizable via string table
  - **Precision requirement**: Modal must block all pointer events to widgets behind it (CSS `pointer-events: none` on siblings). Dialog must center within viewport even on window resize.

#### 3.2.13 TextNotificationsDisplayWidget

- [ ] **TODO-16.B.13** `src/OpenRA.Mods.Common/Widgets/TextNotificationsDisplayWidget.ts` (138 lines C#) -- Scrolling text notification feed:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/TextNotificationsDisplayWidget.cs`
  - Displays scrolling list of recent game event text notifications
  - `addNotification(text: string): void` -- adds notification with timestamp
  - Notifications fade out after configurable duration (~5 seconds)
  - CSS `transition: opacity` for fade animation
  - Max visible notifications: configurable (default 6)
  - **Precision requirement**: Fade duration must match OpenRA's notification display time (300 ticks = 12 seconds at 25tps by default, configurable)

#### 3.2.14 ProgressBarWidget

- [ ] **TODO-16.B.14** `src/OpenRA.Mods.Common/Widgets/ProgressBarWidget.ts` (85 lines C#) -- Progress bar control:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ProgressBarWidget.cs`
  - `getValue: () => number` for 0-100% completion
  - `indeterminate: boolean` for animation when progress is unknown
  - Fill color: `getColor: () => Color` delegate
  - Indeterminate mode: CSS animation of sliding gradient
  - Used for loading screens, building construction progress, etc.
  - **Precision requirement**: Determinate bar width must be integer pixels. Indeterminate animation period must be 2s.

#### 3.2.15 LogicTickerWidget

- [ ] **TODO-16.B.15** `src/OpenRA.Mods.Common/Widgets/LogicTickerWidget.ts` (22 lines C#) -- Per-tick logic trigger widget:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/LogicTickerWidget.cs`
  - Invisible widget that calls `onTick: () => void` each game tick
  - Bridges the game tick loop to widget Logic classes that need per-frame updates
  - Used as a hidden widget in widget tree definitions to drive Logic tick behavior
  - **Precision requirement**: `onTick` must be called exactly once per tick, matching `world.tick()` frequency

#### 3.2.16 LogicKeyListenerWidget

- [ ] **TODO-16.B.16** `src/OpenRA.Mods.Common/Widgets/LogicKeyListenerWidget.ts` (36 lines C#) -- Global key listener widget:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/LogicKeyListenerWidget.cs`
  - Invisible widget that listens for specific key events regardless of focus
  - `onKeyDown(key: Keycode): boolean` -- return true to consume event
  - Used by Logic classes needing global hotkey support (e.g., pause, screenshot)
  - **Precision requirement**: Key events must be intercepted before focused widget processing (capture phase)

#### 3.2.17 ColorMixerWidget

- [ ] **TODO-16.B.17** `src/OpenRA.Mods.Common/Widgets/ColorMixerWidget.ts` (189 lines C#) -- HSV color picker widget:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/ColorMixerWidget.cs`
  - HSV color space picker: saturation/value square + hue slider
  - `getColor: () => Color` / `setColor: (c: Color) => void` for value binding
  - SV square: `<canvas>` rendering HSL saturation/value grid with current hue
  - Hue slider: `<input type="range">` styled as gradient bar
  - Color preview swatch showing current selection
  - RGB hex text input for direct color entry
  - Used in player color selection, settings screens
  - **Precision requirement**: HSV→RGB conversion must match OpenRA's `HSLColor.RGB` conversion within 1/255 per channel. Saturation/value square must update within 1 frame when hue slider changes.

**Phase B Summary**: 17 files, ~3,540 C# lines source. Includes both the shared utility infrastructure (WidgetUtils) and the complete game HUD. Estimated ~8,000 TS implementation lines + ~6,000 test lines, 175 tests. ProductionPaletteWidget (649 lines) and RadarWidget (530 lines) are the two most complex items. All B-files except WidgetUtils can be parallel-assigned once WidgetUtils is complete.

---

### 3.3 Phase C: Menu Screen Logic

**Status**: PLANNING (0/25 migrated)
**Complexity**: LOW-HIGHEST (SettingsUtils 77 lines LOW, LobbyLogic 1056 lines HIGHEST)
**Blocked by**: Chapter 5 Phases C-D (Widget core -- COMPLETE), Phase A (primitive UI controls), Phase B (WidgetUtils for formatting helpers), Chapter 6 Phase A (Order/Connection for multiplayer lobbies), Chapter 7 Phase D (Sound for music/audio settings)
**Blocks**: Nothing (leaf chapter -- menu screens consume but are not consumed by other chapters)

**Description**: Menu screen Logic classes that implement the behavior layer for each screen in the game's menu flow. Each Logic class is a `ChromeLogic` subclass that wires widget event handlers, manages screen state, and orchestrates transitions. `LobbyLogic` (1056 lines C#) is the most complex Logic file in all of OpenRA -- it manages the multiplayer lobby with player slots, team assignment, faction selection, map options, chat, ready state, and game launch. `MainMenuLogic` (566 lines C#) is the entry point with buttons for all sub-screens. Settings screens manage display, audio, input, hotkey, and gameplay configuration. Browser screens (server list, map chooser, replay, save game) display scrollable lists with search/filter functionality.

**Paradigm Shifts**:
- C# `Game.OpenWindow(widgetId, args)` screen push → DOM append new widget tree root + WindowList push
- C# `Game.CloseWindow()` screen pop → DOM remove top widget tree root + WindowList pop
- C# `Widget.Get<T>(id)` child lookup → TypeScript `widget.getElementById(id)` DOM traversal
- C# `OrderManager` order dispatch → same TypeScript `OrderManager` (Ch6 Phase A) API
- C# `Game.Settings` → TypeScript settings store with localStorage persistence or in-memory config
- C# `Sheet`/`Sprite` loading for map previews → `<canvas>` rendering from `MapCache` (Ch4 Phase E)
- C# `ModData`/`Manifest` mod selection → same TypeScript `ModData`/`Manifest` (Ch5 Phase C) API

#### 3.3.1 MainMenuLogic

- [ ] **TODO-16.C.1** `src/OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.ts` (566 lines C#) -- Main menu screen logic:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs`
  - Wires main menu buttons: "Skirmish", "Multiplayer", "Settings", "Extras", "Quit"
  - `openSkirmishPanel(): void` -- opens map chooser for skirmish game
  - `openMultiplayerPanel(): void` -- opens server browser or direct connect
  - `openSettingsPanel(): void` -- opens settings screen
  - `openExtrasPanel(): void` -- opens extras/credits/encyclopedia
  - `onQuit(): void` -- application exit
  - Background video/music management via Ch7 Phase D `Sound`
  - News/update notification display from remote server
  - Version label display from `Manifest` (Ch5 Phase C)
  - System info prompt for first-time setup
  - **Precision requirement**: Screen transitions must complete within 100ms. Background music must crossfade between screens (2-second crossfade duration).

#### 3.3.2 LobbyLogic

- [ ] **TODO-16.C.2** `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyLogic.ts` (1056 lines C#) -- Multiplayer lobby logic:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyLogic.cs`
  - Player slot management: open/closed/occupied slots, team assignment, faction selection
  - `updatePlayerList(): void` -- refreshes player slot display from server state
  - `setFaction(slotIndex, faction): void` -- updates faction for a slot
  - `setTeam(slotIndex, team): void` -- assigns player to team
  - `toggleSlot(slotIndex): void` -- opens/closes a slot
  - `kickPlayer(slotIndex): void` -- kicks a player (host only)
  - Map preview panel via `MapPreviewWidget` with map metadata display
  - Game options panel: starting cash, tech level, fog of war, etc. via `LobbyOptionsLogic`
  - Chat panel with message history, player name coloring, and scrollback
  - Ready checkbox per player; host "Start Game" button enabled when all ready
  - Color selection for each player slot via `ColorMixerWidget`
  - Latency display per player
  - Spectator slot toggle
  - `LobbyUtils` integration for color contrast, slot validation, dropdown population
  - **Precision requirement**: Player list must update within 1 tick of server `LobbyInfo` change. Chat messages must display with correct player color (from `Player.Color`). Map preview must render within 500ms of map selection change.

#### 3.3.3 LobbyUtils

- [ ] **TODO-16.C.3** `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyUtils.ts` (707 lines C#) -- Lobby helper functions:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyUtils.cs`
  - `populatePlayerSlot(slot: Widget, player: Session.Client): void` -- fills a slot widget with player info
  - `getPlayerColor(color: Color, background: Color): Color` -- ensures contrast against lobby background
  - `populateFactionDropdown(dd: DropDownButtonWidget): void` -- fills faction list from mod
  - `populateColorDropdown(dd: DropDownButtonWidget): void` -- fills color picker options
  - `slotStateImage(state: SlotState): string` -- maps slot state to sprite image name
  - `clientStateImage(state: ClientState): string` -- maps client state to sprite image name
  - `latencyDescription(latency: number): string` -- "Low"/"Medium"/"High" latency label
  - Various validation helpers for slot/team/faction constraints
  - **Precision requirement**: Color contrast calculation must match OpenRA's `GetContrastColor()` algorithm (white text if background luminance < 128, black otherwise). Faction dropdown must list factions in the order defined by `ModData.Manifest.factions`.

#### 3.3.4 LobbyOptionsLogic

- [ ] **TODO-16.C.4** `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyOptionsLogic.ts` (198 lines C#) -- Game options configuration panel:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyOptionsLogic.cs`
  - Displays and modifies game options: starting cash, tech level, fog of war, crates, etc.
  - Each option displayed as dropdown or checkbox depending on type
  - Options read from `GameSettings` and written back on change
  - Host-only editing (greyed out for non-host players)
  - **Precision requirement**: Option changes must broadcast to all lobby clients within 1 tick via `OrderManager`

#### 3.3.5 LoadGameBrowserLogic

- [ ] **TODO-16.C.5** `src/OpenRA.Mods.Common/Widgets/Logic/LoadGameBrowserLogic.ts` (1039 lines C#) -- Load saved game browser:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/LoadGameBrowserLogic.cs`
  - Lists saved game files with metadata: map name, date, game time, players
  - `loadGames(): void` -- scans save directory, populates list
  - `selectGame(index): void` -- highlights selected save, shows preview
  - `loadSelectedGame(): void` -- loads the selected save
  - `deleteSelectedGame(): void` -- deletes save with confirmation dialog
  - Sort by date/name; filter by map/mode
  - Empty state: "No saved games found" message
  - **Precision requirement**: Save scan must complete within 200ms for 100 saves. Delete must show `ConfirmationDialogs.promptConfirm()` before executing.

#### 3.3.6 ReplayBrowserLogic

- [ ] **TODO-16.C.6** `src/OpenRA.Mods.Common/Widgets/Logic/ReplayBrowserLogic.ts` (883 lines C#) -- Replay browser:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/ReplayBrowserLogic.cs`
  - Lists replay files with metadata: map, players, duration, date, version
  - `loadReplays(): void` -- scans replay directory
  - `selectReplay(index): void` -- shows replay metadata preview
  - `watchReplay(): void` -- launches replay playback
  - Filtering by map, player count, duration, game version
  - Sort by date/duration/players
  - Replay metadata parsing (header info from replay files)
  - **Precision requirement**: Replay scan must complete within 500ms for 500 replays. Metadata must parse replay header without loading full file.

#### 3.3.7 ServerListLogic

- [ ] **TODO-16.C.7** `src/OpenRA.Mods.Common/Widgets/Logic/ServerListLogic.ts` (892 lines C#) -- Server browser:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/ServerListLogic.cs`
  - Lists available multiplayer servers with metadata
  - `refreshServerList(): void` -- queries master server for game list
  - `joinServer(address): void` -- connects to selected server
  - Server entry shows: server name, map, players/slots, ping, locked/protected status
  - Filtering by server name, map, player count, game version
  - Sort by name/players/ping
  - Direct connect button for manual IP entry
  - Refresh button with auto-refresh interval (configurable, default 30s)
  - **Precision requirement**: Server list must render within 100ms of response. Auto-refresh must not interrupt user interaction with the list (update in-place).

#### 3.3.8 MapChooserLogic

- [ ] **TODO-16.C.8** `src/OpenRA.Mods.Common/Widgets/Logic/MapChooserLogic.ts` (660 lines C#) -- Map selection screen:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/MapChooserLogic.cs`
  - Lists available maps with preview thumbnails via `MapPreviewWidget`
  - `loadMaps(): void` -- scans map directories via `MapCache` (Ch4 Phase E)
  - `selectMap(uid): void` -- shows map preview, metadata, player slots
  - Map metadata display: title, author, player count, size, type, description
  - Filtering by map type, player count, size
  - Search by map name
  - Map preview rendering via Canvas 2D from `MapCache` terrain data
  - **Precision requirement**: Map preview must render within 200ms for a 128x128 map. Map list must sort alphabetically by title by default.

#### 3.3.9 MissionBrowserLogic

- [ ] **TODO-16.C.9** `src/OpenRA.Mods.Common/Widgets/Logic/MissionBrowserLogic.ts` (631 lines C#) -- Mission/campaign browser:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/MissionBrowserLogic.cs`
  - Lists available campaign missions with metadata
  - `loadMissions(): void` -- scans mission directories
  - `selectMission(id): void` -- shows mission briefing, objectives preview
  - Mission grouping by campaign (e.g., "Allied Campaign", "Soviet Campaign")
  - Mission lock/unlock based on campaign progress
  - Briefing text display with scroll support
  - **Precision requirement**: Mission list must update campaign progress lock states from save data. Briefing text must support multi-paragraph display with proper line breaks.

#### 3.3.10 MapGeneratorLogic

- [ ] **TODO-16.C.10** `src/OpenRA.Mods.Common/Widgets/Logic/MapGeneratorLogic.ts` (463 lines C#) -- Random map generation UI:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/MapGeneratorLogic.cs`
  - Random map generation parameter configuration
  - Parameters: map size, seed, terrain type, water coverage, resource density, actor density
  - `generateMap(): void` -- triggers map generation with current parameters
  - Preview update on parameter change (debounced, ~500ms)
  - Seed randomization button
  - **Precision requirement**: Parameter change must trigger debounced preview regeneration (500ms debounce). Seed randomization must use cryptographically-weak PRNG for deterministic seeds.

#### 3.3.11 ServerCreationLogic

- [ ] **TODO-16.C.11** `src/OpenRA.Mods.Common/Widgets/Logic/ServerCreationLogic.ts` (257 lines C#) -- Server creation panel:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/ServerCreationLogic.cs`
  - Server configuration: server name, password, max players, advertise toggle
  - `createServer(): void` -- starts local server with configuration
  - Map selection integration for server map choice
  - Port forwarding hint display
  - Advertise checkbox: register with master server or LAN-only
  - **Precision requirement**: Server creation must validate all fields before allowing create (name not empty, valid port, map selected)

#### 3.3.12 ConnectionLogic

- [ ] **TODO-16.C.12** `src/OpenRA.Mods.Common/Widgets/Logic/ConnectionLogic.ts` (282 lines C#) -- Connection setup and status:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/ConnectionLogic.cs`
  - Connection state display: connecting, connected, disconnected, error
  - `connect(address, port): void` -- initiates connection via `OrderManager`
  - `disconnect(): void` -- disconnects from server
  - Connection error display with retry option
  - Connection progress animation during handshake
  - Timeout handling with configurable timeout duration
  - **Precision requirement**: Connection state must update within 100ms of state change. Error messages must be user-readable (not raw socket errors).

#### 3.3.13 SettingsLogic

- [ ] **TODO-16.C.13** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsLogic.ts` (197 lines C#) -- Settings panel router:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsLogic.cs`
  - Tab-based settings panel routing: Display, Audio, Input, Hotkeys, Gameplay, Advanced
  - `openSettingsTab(tabId: string): void` -- switches active settings tab
  - Tab button panel with category icons
  - Settings groups loaded from JSON widget definitions
  - Apply/Cancel/Default buttons
  - **Precision requirement**: Tab switching must complete within 50ms. "Default" button must reset all settings on current tab to hardcoded defaults.

#### 3.3.14 DisplaySettingsLogic

- [ ] **TODO-16.C.14** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/DisplaySettingsLogic.ts` (575 lines C#) -- Display settings:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/DisplaySettingsLogic.cs`
  - Resolution dropdown with common resolutions
  - Fullscreen/windowed mode toggle
  - UI scale slider (0.8x to 2.0x)
  - VSync toggle
  - Frame limiter (30/60/120/unlimited FPS)
  - Battlefield news toggle
  - Target lines display toggle (attack-move, guard, etc.)
  - Player stance colors toggle
  - **Precision requirement**: Resolution change must apply immediately with confirmation timeout (revert in 15s if not confirmed). UI scale must persist across sessions via localStorage.

#### 3.3.15 HotkeysSettingsLogic

- [ ] **TODO-16.C.15** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/HotkeysSettingsLogic.ts` (379 lines C#) -- Hotkey configuration:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/HotkeysSettingsLogic.cs`
  - Lists all configurable hotkeys grouped by category
  - `HotkeyEntryWidget` per hotkey for rebinding
  - `resetHotkey(hotkeyId: string): void` -- resets to default binding
  - `resetAllHotkeys(): void` -- resets all hotkeys to defaults
  - Conflict detection: warns if two actions share the same key combo
  - Search/filter by hotkey name
  - **Precision requirement**: Hotkey conflict detection must check all current bindings. Duplicate binding must show warning icon on both conflicting entries.

#### 3.3.16 InputSettingsLogic

- [ ] **TODO-16.C.16** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/InputSettingsLogic.ts` (232 lines C#) -- Input settings:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/InputSettingsLogic.cs`
  - Mouse sensitivity slider
  - Scroll speed slider (viewport pan speed)
  - Mouse wheel zoom inversion toggle
  - Right-click order type: default/attack-move/deploy
  - Edge scroll toggle
  - Middle-mouse-button scroll toggle
  - **Precision requirement**: Sensitivity change must apply immediately for preview. Scroll speed value must be in range 1-100 mapping to viewport scroll pixels per tick.

#### 3.3.17 AudioSettingsLogic

- [ ] **TODO-16.C.17** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/AudioSettingsLogic.ts` (173 lines C#) -- Audio settings:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/AudioSettingsLogic.cs`
  - Master volume `ExponentialSliderWidget` (logarithmic scale)
  - Sound effects volume slider
  - Music volume slider
  - UI feedback volume slider
  - Mute toggle
  - Audio device selection (if multiple outputs available)
  - **Precision requirement**: Volume slider exponential mapping must match `ExponentialSliderWidget` curve. Volume change must apply immediately (test beep on SFX slider change).

#### 3.3.18 GamePlaySettingsLogic

- [ ] **TODO-16.C.18** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/GamePlaySettingsLogic.ts` (192 lines C#) -- Gameplay settings:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/GamePlaySettingsLogic.cs`
  - Player name text field
  - Player color selector via `ColorMixerWidget`
  - Default faction dropdown
  - Team preference (random, specific team)
  - Spawn preference (random, specific spawn)
  - **Precision requirement**: Player name must validate length (1-16 characters, alphanumeric + spaces). Color change must preview immediately on all settings UI elements.

#### 3.3.19 AdvancedSettingsLogic

- [ ] **TODO-16.C.19** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/AdvancedSettingsLogic.ts` (91 lines C#) -- Advanced settings:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/AdvancedSettingsLogic.cs`
  - Debug menu toggle
  - Perf graph toggle
  - Network statistics display toggle
  - Replay recording toggle
  - System information display
  - **Precision requirement**: All toggles must take effect immediately. System info must reflect current browser/WebGL capabilities.

#### 3.3.20 SettingsUtils

- [ ] **TODO-16.C.20** `src/OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsUtils.ts` (77 lines C#) -- Settings helper functions:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsUtils.cs`
  - `bindSlider(slider: SliderWidget, settingName: string): void` -- generic slider binding
  - `bindCheckbox(checkbox: CheckboxWidget, settingName: string): void` -- generic checkbox binding
  - `bindDropdown(dropdown: DropDownButtonWidget, settingName: string, options: string[]): void` -- dropdown binding
  - `settingChanged(settingName: string, newValue: any): void` -- persistence layer call
  - **Precision requirement**: Setting changes must persist within 1 tick of user interaction

#### 3.3.21 EncyclopediaLogic

- [ ] **TODO-16.C.21** `src/OpenRA.Mods.Common/Widgets/Logic/EncyclopediaLogic.ts` (318 lines C#) -- Unit/building encyclopedia:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/EncyclopediaLogic.cs`
  - Lists all actors with descriptions, stats, and production info
  - Category filtering: buildings, infantry, vehicles, aircraft, navy
  - Search by actor name
  - Actor stat display: health, armor, speed, weapons, cost, build time
  - Actor preview sprite rendering
  - **Precision requirement**: Actor stats must match `Ruleset` data exactly. Search must be case-insensitive substring match.

#### 3.3.22 MusicPlayerLogic

- [ ] **TODO-16.C.22** `src/OpenRA.Mods.Common/Widgets/Logic/MusicPlayerLogic.ts` (170 lines C#) -- Music player control panel:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/MusicPlayerLogic.cs`
  - Track list display with current track highlight
  - Play/Pause, Next, Previous buttons
  - Shuffle and Repeat toggles
  - Volume slider for music
  - Track progress bar with time display
  - Integration with Ch7 Phase D `Sound` for music playback
  - **Precision requirement**: Track progress must update every 500ms. Next/Previous must use shuffle order when shuffle enabled.

#### 3.3.23 CreditsLogic

- [ ] **TODO-16.C.23** `src/OpenRA.Mods.Common/Widgets/Logic/CreditsLogic.ts` (97 lines C#) -- Credits screen:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/CreditsLogic.cs`
  - Scrolling credits text with mod author attribution
  - Auto-scroll animation (configurable speed)
  - Click-to-dismiss or auto-dismiss after scroll completes
  - **Precision requirement**: Scroll speed must be 1 pixel per tick at default speed

#### 3.3.24 GameSaveBrowserLogic

- [ ] **TODO-16.C.24** `src/OpenRA.Mods.Common/Widgets/Logic/GameSaveBrowserLogic.ts` (599 lines C#) -- Save game browser (in-game):
  - **C# reference**: `OpenRA.Mods.Common/Widgets/Logic/GameSaveBrowserLogic.cs`
  - Lists save slots for current game
  - `saveGame(slotIndex): void` -- saves current game state
  - `loadGame(slotIndex): void` -- loads from selected save
  - `deleteSave(slotIndex): void` -- deletes save with confirmation
  - Save slot metadata: timestamp, game time, map name
  - Quick-save and quick-load support (Ctrl+S / Ctrl+L)
  - **Precision requirement**: Save operation must display progress indicator for saves >1MB. Quick-save must complete within 500ms.

#### 3.3.25 MapPreviewWidget

- [ ] **TODO-16.C.25** `src/OpenRA.Mods.Common/Widgets/MapPreviewWidget.ts` (233 lines C#) -- Map preview thumbnail:
  - **C# reference**: `OpenRA.Mods.Common/Widgets/MapPreviewWidget.cs`
  - Renders map preview thumbnail via Canvas 2D from `MapCache` (Ch4 Phase E)
  - Terrain rendering: scaled-down terrain tile colors as pixel grid
  - Resource overlay: colored dots for resource deposits
  - Spawn point markers: numbered circles at player spawn locations
  - Actor preview: small colored rectangles for pre-placed actors
  - `setMap(mapUid: string): void` -- loads and renders map preview
  - Cached rendering: only re-renders when map changes
  - Used in MapChooserLogic, LobbyLogic, MapPreviewLogic
  - **Precision requirement**: Map preview must render within 200ms for a 128x128 map. Spawn point markers must match `MapPlayers.spawnLocations` coordinates.

**Phase C Summary**: 25 files, ~9,340 C# lines source. All are `ChromeLogic` subclasses implementing screen behavior. Files are mostly independent of each other (each screen is self-contained), so 20+ of 25 files can be parallel-assigned. `LobbyLogic` (1056 lines) is the most complex single file. Settings files share `SettingsUtils` dependency. Estimated ~19,500 TS implementation lines + ~14,000 test lines, 420 tests.

---

## 4. Dependency Graph

```
Chapters 2-15 (COMPLETE -- Foundation)
  |
  +--> Chapter 5 Phases C-D (Widget core: Widget, ChromeProvider, WidgetLoader -- DONE)
  |     |
  |     +--> Phase A: Primitive UI Controls (23 files)
  |           All extend Widget base class
  |           All independent of each other (FULLY PARALLELIZABLE)
  |           |
  |           +--> Phase B: Game HUD & Utilities (17 files)
  |           |     depends on: Phase A (uses primitive controls) +
  |           |                 Ch10 (PlayerResources) + Ch11 (ProductionQueue) +
  |           |                 Ch12 (Shroud) + Ch13 (SupportPowerManager) +
  |           |                 Ch7 Phase B (ViewportControllerWidget)
  |           |     
  |           +--> Phase C: Menu Screen Logic (25 files)
  |                 depends on: Phase A (uses primitive controls) +
  |                             Phase B (WidgetUtils for formatting) +
  |                             Ch6 Phase A (Order/Connection) +
  |                             Ch7 Phase D (Sound for audio/music)
  |
  +--> Ch10 (Economy: PlayerResources -- DONE)
  |     |
  |     +--> Phase B: ResourceBarWidget, ResourcePreviewWidget
  |
  +--> Ch11 (Production: ProductionQueue, Production -- DONE)
  |     |
  |     +--> Phase B: ProductionPaletteWidget, ProductionTabsWidget, ProductionTypeButtonWidget
  |
  +--> Ch13 (Support Powers: SupportPowerManager -- DONE)
  |     |
  |     +--> Phase B: SupportPowersWidget, SupportPowerTimerWidget
  |
  +--> Ch12 (Shroud: Shroud, FrozenActorLayer -- DONE)
  |     |
  |     +--> Phase B: RadarWidget (shroud visibility overlay)
  |
  +--> Ch7 Phase B (ViewportControllerWidget -- DONE)
  |     |
  |     +--> Phase B: RadarWidget (camera viewport rectangle, click-to-jump)
  |
  +--> Ch3 (Actor + Player -- DONE)
  |     |
  |     +--> Phase B: ControlGroupsWidget + Phase C: all Logic classes
  |
  +--> Ch6 Phase A (OrderManager, Connection -- DONE)
        |
        +--> Phase C: ConnectionLogic, LobbyLogic, ServerCreationLogic

Internal Inter-Phase Dependencies:

  Widget.ts (Ch5 Phase D) --------> ALL Chapter 16 widgets (abstract base class)
  ChromeProvider.ts (Ch5 Phase D) -> Phase A buttons/labels/images (skin/border-image)
  WidgetLoader.ts (Ch5 Phase D) --> Phase C menu screens (JSON widget tree loading)
  
  Phase A controls ---------------> Phase B Game HUD (uses buttons, labels, scroll panels)
  Phase A controls ---------------> Phase C Menu Screens (uses ALL primitive controls)
  WidgetUtils (Phase B) ----------> Phase C Menu Screens (FormatTime, WrapText, DrawPanel)

Files That Can Be Developed in Parallel:

  Phase A: ALL 23 files (no cross-widget dependencies)
  Phase B: 15 of 17 files after WidgetUtils is complete
    - ProductionPaletteWidget, RadarWidget, SupportPowersWidget can start in parallel
  Phase C: 22 of 25 files after Phase A + WidgetUtils are complete
    - All settings files are independent of each other
    - All browser files are independent of each other
    - MainMenuLogic depends on all sub-screens being available (stub them for early dev)
```

### Critical Path

```
Phase A (ScrollPanelWidget 527 + TextFieldWidget 617 + ButtonWidget 298 -- most-used primitives)
  -> WidgetUtils (428 -- shared static helpers, required by Phase C)
  -> Phase B (ProductionPaletteWidget 649 + RadarWidget 530 -- two most complex HUD widgets)
  -> Phase C (LobbyLogic 1056 -- single most complex Logic file)
```

### Parallelization Opportunities

| Group | Files | Can Start When |
|-------|-------|----------------|
| Phase A small widgets (21 of 23) | 21 | Immediately (all independent leaves) |
| Phase A ScrollPanel + TextField | 2 | Immediately (no Phase A deps) |
| WidgetUtils | 1 | Immediately (no Phase A deps) |
| Phase B HUD widgets (14 of 17) | 14 | After Phase A controls available |
| Phase C settings files (8 of 25) | 8 | After Phase A + WidgetUtils |
| Phase C browser files (6 of 25) | 6 | After Phase A + WidgetUtils |
| Phase C lobby files (4 of 25) | 4 | After Phase A + WidgetUtils + Ch6 |

### Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| Widget.ts (Ch5 Phase D) | Must be available before ANY Chapter 16 widget (all widgets extend it) |
| ChromeProvider.ts (Ch5 Phase D) | Required for border-image skin rendering on all widgets |
| WidgetLoader.ts (Ch5 Phase D) | Required by all Phase C menu screens for child widget lookup |
| ScrollPanelWidget (Phase A) | Required by Phase C: LoadGameBrowser, ReplayBrowser, ServerList, MapChooser, MissionBrowser, Encyclopedia |
| TextFieldWidget (Phase A) | Required by Phase B: HotkeyEntryWidget; Phase C: ServerCreation, Connection, GamePlaySettings |
| WidgetUtils (Phase B) | Required by Phase C: ALL menu screens (FormatTime, WrapText, DrawPanel helpers) |
| ProductionQueue.ts (Ch11) | Required by ProductionPaletteWidget, ProductionTabsWidget |
| SupportPowerManager.ts (Ch13) | Required by SupportPowersWidget, SupportPowerTimerWidget |
| Shroud.ts (Ch12) | Required by RadarWidget for fog-of-war overlay |
| PlayerResources.ts (Ch10) | Required by ResourceBarWidget |
| OrderManager.ts (Ch6 Phase A) | Required by Phase C: LobbyLogic, ServerCreationLogic, ConnectionLogic |
| Sound.ts (Ch7 Phase D) | Required by Phase C: MusicPlayerLogic, AudioSettingsLogic |
| ViewportControllerWidget.ts (Ch7 Phase B) | Required by RadarWidget for camera rectangle + click-to-jump |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering widget logic MUST have unit tests. Key test patterns:

- [ ] **TEST-16.1** Phase A: Each primitive widget tested for DOM output, event handling, and state transitions. Mock `Widget` base, `ChromeProvider`, and `ChromeMetrics`. Verify generated HTML structure and CSS classes.
- [ ] **TEST-16.2** Phase A: `TextFieldWidget` cursor management: test character insertion at cursor, selection tracking (Shift+Arrow), Backspace/Delete, Ctrl+A, text validation (Integer/Float type), maxLength enforcement.
- [ ] **TEST-16.3** Phase A: `ScrollPanelWidget` scroll physics: test thumb size ratio, scroll position clamping, item template cloning, layout calculation (GridLayout/ListLayout), mouse wheel delta handling.
- [ ] **TEST-16.4** Phase B: `WidgetUtils` formatting: test `FormatTime` edge cases (0 ticks, negative, max int), `WrapText` line-break boundaries, `getStatefulImageName` all state suffixes, `getContrastColor` black/white threshold.
- [ ] **TEST-16.5** Phase B: `ProductionPaletteWidget`: mock `ProductionQueue`, verify icon rendering order, clock progress overlay angle calculation, affordability gray-out logic, click-to-produce order dispatch, right-click cancel targeting.
- [ ] **TEST-16.6** Phase C: `LobbyLogic`: mock `OrderManager` + server `LobbyInfo`, test slot assignment, team selection, faction change, kick player, ready state, start game conditions, chat message routing.
- [ ] **TEST-16.7** Phase C: Settings persistence: test that all setting changes survive page reload (localStorage round-trip), test "Default" button resets to hardcoded defaults.
- [ ] **TEST-16.8** Phase C: Screen transitions: test `Ui.openWindow()`/`closeWindow()` stacking, test that hidden widgets receive `becameHidden()` and visible widgets receive `becameVisible()`.

### 5.2 Per-Phase Test File Estimates

| Phase | Files | Test Files | Estimated Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Primitive UI Controls | 23 | 23 | ~160 (avg 7 per widget, more for TextField/ScrollPanel) | ~5,500 |
| B: Game HUD & Utilities | 17 | 17 | ~175 (avg 10 per widget, ProductionPalette+Radar each 20+) | ~6,000 |
| C: Menu Screen Logic | 25 | 25 | ~420 (avg 17 per screen, LobbyLogic 35+) | ~14,000 |
| **Total** | **65** | **65** | **~755** | **~25,500** |

### 5.3 Visual Acceptance Testing

Widget rendering and layout require manual visual acceptance test pages:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Primitive controls gallery | `/test/widgets/primitives/` | Verify all 23 primitive widgets render correctly with ChromeProvider skins, text alignment, state visuals (hover/pressed/disabled) |
| Scroll panel | `/test/widgets/scroll-panel/` | Verify smooth scrolling, thumb sizing, item cloning, layout grid/list modes, keyboard navigation |
| Production palette | `/test/widgets/production-palette/` | Verify icon grid layout, clock overlay animation, cost text, hotkey labels, affordability gray-out, ready pulse |
| Radar minimap | `/test/widgets/radar/` | Verify terrain rendering, actor dots, shroud overlay, camera rectangle, click-to-jump accuracy |
| Support powers palette | `/test/widgets/support-powers/` | Verify icon display, cooldown clock, ready pulse, activation/targeting mode transition |
| Settings screen | `/test/widgets/settings/` | Verify all settings tabs, volume slider exponential curve, hotkey capture, display resolution list |
| Lobby screen | `/test/widgets/lobby/` | Verify player slot rendering, faction/color dropdowns, chat display, map preview, team assignment |

### 5.4 Integration Testing

- [ ] **TEST-16.I1** Production pipeline: `ProductionPaletteWidget` click → `ProductionQueue` order → `Production` trait tick → actor creation → icon count update
- [ ] **TEST-16.I2** Radar + viewport: `RadarWidget` click → `Viewport` camera position update → `ViewportControllerWidget` scroll event
- [ ] **TEST-16.I3** Support power flow: `SupportPowersWidget` click → `SupportPowerManager` targeting mode → `OrderGenerator` activation → target selection → power execution
- [ ] **TEST-16.I4** Lobby flow: `ServerListLogic` → select server → `ConnectionLogic` connect → `LobbyLogic` slot management → ready → game start

---

## 6. Risk and Considerations

### 6.1 High-Risk Areas

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **LobbyLogic complexity** (1056 lines C#, 16 distinct responsibilities) | HIGH | Multiplayer lobby is the most complex UI screen. Bugs block all multiplayer testing. | Break into sub-modules: LobbySlotManager, LobbyChatHandler, LobbyOptionsPanel. Develop against a mock `OrderManager` that simulates server responses. |
| **ProductionPaletteWidget deep integration** (649 lines, depends on Ch10+Ch11+Ch13) | HIGH | Central to in-game UI; broken production palette blocks all gameplay. | Develop with mock `ProductionQueue` and `PlayerResources`. Test icon rendering independently of game state. |
| **RadarWidget Canvas minimap performance** (530 lines, real-time rendering) | HIGH | Minimap redraws every frame on shroud change. Canvas pixel operations are CPU-intensive. | Implement dirty-rectangle tracking: only redraw changed cells. Use `requestAnimationFrame` throttling (target 15fps for minimap). Cache terrain layer as static `ImageData`. |
| **DOM-based text rendering parity** (C# bitmap font vs browser text) | MEDIUM | Pixel-exact text layout is impossible with browser fonts. | Use Canvas 2D `measureText()` for layout metrics, CSS `font-family` for rendering. Accept ±2px tolerance. Use a monospace web font for console/perf display where pixel-exact alignment matters. |
| **Settings persistence across sessions** | MEDIUM | Corrupted settings can prevent game from launching. | Validate all settings on load with schema validation. Fall back to defaults if any setting fails validation. Use versioned settings format for forward compatibility. |
| **ScrollPanelWidget scroll physics parity** | MEDIUM | Native browser scroll vs OpenRA custom scroll physics differ in feel. | Replicate OpenRA scroll physics using custom scroll handler with `transform: translateY()`. Match thumb size ratio formula exactly. |
| **Widget hot-reload during dev** | LOW | WidgetLoader JSON changes not reflected without page reload. | Leverage Vite HMR: widget JSON files trigger full widget tree reload when changed. Use `import.meta.hot` for HMR integration. |
| **Color accuracy across color spaces** | LOW | CSS colors (sRGB) may not match OpenRA's linear RGB color computation. | Accept ±1/255 per channel tolerance. Use `srgb` color space explicitly in Canvas operations. |
| **MapPreviewWidget render time** (200ms target for 128x128) | LOW | Large maps (256x256) may exceed render budget causing UI lag. | Render asynchronously in `requestIdleCallback`. Cache rendered previews in `MapCache`. Show loading placeholder during render. |

### 6.2 Performance Targets

| Widget | Target | Measurement |
|--------|--------|-------------|
| ProductionPaletteWidget icon grid render | <5ms | Per-frame render time with 24 icons |
| RadarWidget minimap update (dirty cells) | <8ms | Canvas `putImageData` time for changed cells only |
| RadarWidget minimap full redraw | <50ms | Complete terrain+actor+shroud redraw (128x128 map) |
| ScrollPanelWidget scroll response | <16ms | Time from pointer event to visual scroll update |
| MapPreviewWidget render (128x128) | <200ms | Total render time including terrain+resources+spawns |
| LobbyLogic player list update | <10ms | Full player slot refresh with 16 slots |
| Settings tab switch | <50ms | Time from click to new tab content visible |
| Screen transition (main menu → sub-screen) | <100ms | Time from button click to new screen rendered |

### 6.3 Deferred Features

| Feature | Phase | Reason |
|---------|-------|--------|
| In-game hotkey Logic classes (14 files) | Deferred to Ch16-optional | Thin wrappers (~35-100 lines each) around hotkey registrations. Can be added incrementally post-core. |
| Content installation UI (5 files) | Deferred to Ch19 | Requires server-side content delivery infrastructure (Ch18). |
| Editor widget Logic (17 files) | Deferred to Ch21 | Part of the map editor system. `EditorViewportControllerWidget` + `Logic/Editor/*` belong in Chapter 21. |
| Observer HUD Logic (ObserverStatsLogic, ObserverShroudSelectorLogic) | Deferred to Ch16-optional | Requires full multiplayer observer infrastructure. 2 files, 887 C# lines total. |
| VideoPlayerWidget | Deferred to Ch16-optional | Requires FMV video asset pipeline. HTML `<video>` element provides basic support. |
| VideoPlayerWidget | Deferred to Ch19 | Full FMV support requires C&C-specific video codec integration. |
| PerfGraphWidget + ScrollableLineGraphWidget | Deferred to Ch16-optional | Developer tools, not gameplay-critical. 2 files, 796 C# lines total. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-16.1: DOM-First Widget Rendering with Canvas Fallback

**Context**: OpenRA widgets render via OpenGL immediate-mode drawing (sprites, 9-slice panels, bitmap fonts). The TS Widget base already defines `render(): HTMLElement`. We need to decide the rendering strategy for 65+ new widget types.

**Decision**: Three-tier rendering strategy:
- **Tier 1 (HTML DOM, ~80% of widgets)**: Standard form controls and display widgets (Button, Label, TextField, Slider, Checkbox, ScrollPanel, DropDown, etc.) render as DOM elements with CSS styling. ChromeProvider 9-slice panels become CSS `border-image`. Text is rendered via CSS `font-family`. This preserves accessibility, text selection, and native form behavior.
- **Tier 2 (Canvas 2D, ~15% of widgets)**: Widgets requiring custom pixel rendering (RadarWidget minimap, MapPreviewWidget, LineGraphWidget, ColorMixerWidget) use `<canvas>` elements embedded within the widget's DOM container. These widgets manage their own Canvas context.
- **Tier 3 (Babylon.js scene, ~5% of widgets)**: Widgets needing 3D rendering within their bounds (ActorPreviewWidget) use a `RenderTargetTexture` or second `Engine` with output to a `<canvas>`.

**Rationale**: DOM rendering is simpler to implement and test. CSS handles responsive layout, text rendering, and GPU-accelerated compositing. Canvas provides pixel-level control for custom rendering without leaving the DOM tree. Babylon.js integration is reserved for true 3D preview needs.

**Alternatives Considered**:
- All-Canvas 2D (like OpenRA's OpenGL approach): Faithful to original but loses accessibility, text selection, and CSS benefits. Much more code to write for basic controls.
- All-Babylon.js GUI (`AdvancedDynamicTexture`): Adds 3D engine overhead for 2D widgets. Rejected for standard controls.

**Consequences**: Tier 1 widgets are accessible (screen readers, text selection, keyboard navigation) and themable via CSS. Text layout may differ from OpenRA bitmap fonts (±2px tolerance). Canvas-based widgets require manual cursor/keyboard handling.

### ADR-16.2: Widget-Logic Separation via ChromeLogic

**Context**: OpenRA uses `Widget` (rendering + input routing) separated from `ChromeLogic` (behavior + state management). Logic classes receive the widget tree in their constructor and wire event handlers. This pattern is already established in the TS `Widget` base class.

**Decision**: Maintain exact Widget-Logic separation: each Logic class in OpenRA becomes a TypeScript `ChromeLogic` subclass. The Logic constructor receives `widget: Widget`, `modData: ModData`, and optional `args: WidgetArgs`. Logic wires event handlers, manages state, and interfaces with game systems. `dispose()` unsubscribes handlers and frees resources. `tick()` handles per-frame state updates (rate-limited to game tick frequency).

**Rationale**: Clean separation of concerns enables independent unit testing of Logic classes without DOM rendering. Widgets remain reusable across different screens (same ButtonWidget used in MainMenu, Lobby, and Settings).

**Alternatives Considered**:
- Merge Logic into Widget subclasses: Simpler file count but loses reusability and testability. Violates OpenRA's dependency inversion principle.
- React/Vue component model: Would replace the Widget tree entirely. Too disruptive and inconsistent with existing Ch5 architecture.

**Consequences**: Each screen requires two files (Widget definition JSON + Logic TypeScript class). Logic classes can be developed and tested independently. Widget tree definitions remain declarative JSON.

### ADR-16.3: Reactive Data Binding via Func Delegates

**Context**: OpenRA uses `Func<T>` delegates for data binding: `GetText: () => string`, `GetColor: () => Color`, `IsVisible: () => boolean`, `IsDisabled: () => boolean`. These are evaluated each frame during `Draw()`.

**Decision**: Direct mapping to TypeScript arrow functions with optional caching via a `CachedTransform<K,V>` utility class. The `render()` method evaluates all func delegates and applies changes to the DOM only when values differ from previous render. A dirty-flag system marks widgets for re-evaluation when their bound data changes, avoiding full tree renders each frame.

**Rationale**: Simple, testable, and matches OpenRA semantics exactly. No framework dependency needed. The `CachedTransform` pattern from OpenRA maps cleanly to TypeScript generics.

**Alternatives Considered**:
- RxJS observables: Powerful but adds dependency and learning curve. Overkill for simple data binding.
- Proxy-based reactivity (Vue/MobX): Implicit dependency tracking but adds framework complexity.

**Consequences**: Data binding is explicit and traceable. Widgets must be marked dirty when their bound data changes. The dirty-flag system prevents unnecessary DOM updates.

### ADR-16.4: Screen Transitions via DOM Modal Stacking

**Context**: OpenRA uses `Ui.OpenWindow(widgetId, args)` and `Ui.CloseWindow()` with a `WindowList` stack. Widgets are loaded from YAML definitions by `WidgetLoader`.

**Decision**: Implement as DOM-based modal stacking: each "window" (screen-level widget tree root) is a top-level `<div>` within a root container. `Ui.openWindow()` loads the widget tree via `WidgetLoader` from pre-compiled JSON (Ch4 Phase H MiniYAML pipeline), appends the root `<div>`, and pushes to the WindowList stack. `Ui.closeWindow()` removes the top `<div>` and reveals the previous screen. CSS `z-index` manages layering. The existing `Widget.hidden()`/`becameHidden()`/`becameVisible()` lifecycle is called on transition.

**Rationale**: Matches OpenRA's Widget lifecycle exactly. Screen transitions can be CSS-animated (fade, slide). The JSON widget tree format (already supported by `WidgetLoader` from Ch5 Phase D) handles declarative layout.

**Alternatives Considered**:
- React Router / SPA routing: URL-based navigation doesn't match OpenRA's widget stack model.
- CSS `visibility: hidden` toggling: Keeping all screens alive but hidden wastes memory and causes hidden widgets to still process ticks.

**Consequences**: Screen transitions are synchronous DOM operations (<100ms). Each screen's Logic is disposed on close. Widget tree JSON definitions can be hot-reloaded during development.

### ADR-16.5: Canvas 2D Minimap for RadarWidget

**Context**: OpenRA's `RadarWidget` renders the minimap by writing pixel data to a `Sheet` texture and rendering it via `SpriteRenderer`. Shroud data comes from `Shroud` (Ch12), terrain from `Map` (Ch4).

**Decision**: Use a `<canvas>` element within the RadarWidget's DOM container. Terrain layer is cached as a static `ImageData` (rebuilt only on map change). Actor positions are rendered as colored 2x2 pixel rectangles each frame. Shroud/fog overlay is a semi-transparent black fill over unexplored/explored cells. Dirty-rectangle tracking limits redraws to changed cells only. Camera viewport rectangle is rendered as a white outline.

**Rationale**: Canvas 2D provides the pixel-level control needed for a minimap. The dirty-rectangle approach keeps frame times under 8ms. Caching the terrain layer avoids expensive per-frame terrain re-rendering.

**Alternatives Considered**:
- DOM-based with thousands of 1px `<div>`s: Performance disaster for 128x128 maps (16,384 elements).
- WebGL render-to-texture: Over-engineered for a 2D minimap. Canvas is simpler and sufficient.

**Consequences**: Minimap rendering is CPU-bound on Canvas operations. For very large maps (256x256), consider rendering at half-resolution and scaling up via CSS `image-rendering: pixelated`.

### ADR-16.6: Scope Deferrals -- Editor, Observer, Installation Widgets

**Context**: The complete OpenRA widget source contains ~109 files. Some belong to subsystems not yet migrated (Editor → Ch21, Server → Ch18) or are thin wrappers that can be added incrementally.

**Decision**:
- **Editor widgets (17 files)**: `EditorViewportControllerWidget` + `Logic/Editor/*` deferred to Chapter 21 (Editor & Utilities).
- **Hotkey Logic (14 files)**: Deferred to optional Ch16 sub-phase. These are thin wrappers (~35-100 lines each) registering hotkey callbacks. Core hotkey infrastructure exists in Ch7 Phase A+B.
- **Observer HUD Logic (2 files)**: Deferred. Requires full multiplayer observer infrastructure and dedicated server.
- **Content Installation UI (5 files)**: Deferred to Ch19. Requires server-side content delivery.
- **PerfGraphWidget + ScrollableLineGraphWidget (2 files)**: Deferred to optional. Developer tools, not gameplay-critical.

**Rationale**: Keeps Chapter 16 scope manageable at 65 files while covering all gameplay-critical UI. Deferred items are either small enough to add later or belong to other chapters with their own dependencies.

**Consequences**: Multiplayer lobbies can be tested without observer HUD. Editor development (Ch21) will need to implement editor widgets from scratch.

---

## Migration Order and Phasing Strategy

| Step | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A (early) | 3 | ScrollPanelWidget + TextFieldWidget + ButtonWidget (most-used primitives, unblock Phase B/C) | NO (base controls first) |
| 2 | WidgetUtils | 1 | WidgetUtils (static helpers used by ALL Phase C screens) | YES (parallel with Step 1) |
| 3 | Phase A (remaining) | 20 | All other primitive controls | YES (all 20 independent) |
| 4 | Phase B (HUD) | 14 | All Game HUD widgets (after Phase A controls available) | YES (each widget independent, mock game state) |
| 5 | Phase C (settings) | 8 | Settings screens (after Phase A + WidgetUtils) | YES (each settings tab independent) |
| 6 | Phase C (browsers) | 6 | Browser screens (after Phase A + WidgetUtils) | YES (each browser independent) |
| 7 | Phase C (lobby) | 3 | LobbyLogic + LobbyUtils + LobbyOptionsLogic (after Phase A + WidgetUtils + Ch6) | After Settings |
| 8 | Phase C (remaining) | 8 | MainMenu, Encyclopedia, MusicPlayer, Credits, etc. | YES (each independent) |
| 9 | Integration | -- | End-to-end pipeline tests + visual acceptance pages | After Steps 1-8 |

**Total estimated effort**: 12-16 weeks (single developer), or 4-6 weeks (3-4 developers with parallel tracks).

| Metric | Count |
|--------|-------|
| **Total files** | 65 (23 Phase A + 17 Phase B + 25 Phase C) |
| **Estimated TypeScript implementation lines** | ~35,000 |
| **Estimated test lines** | ~25,500 |
| **Estimated tests** | ~755 |
| **Visual acceptance test pages** | 7 |
| **ADR records** | 6 |
| **Deferred files (other chapters)** | 17 (Editor → Ch21) |
| **Deferred files (optional)** | 23 (Hotkeys 14 + Observer 2 + Installation 5 + Perf/Graphs 2) |

---

> **Chapter 16 Status**: PLANNING. Phase A: 0/23, Phase B: 0/17, Phase C: 0/25. Total: 0/65 (0%).

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.6 + Section 4.3 -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.9 -- Chapter 16 overview and file inventory
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Chapter 8 plan (primary format reference)
> - `docs/chapter5_ui_system_migration_plan.md` -- Chapter 5 UI system plan (widget core reference)
> - `docs/chapter11_production_building_migration_plan.md` -- Chapter 11 plan (production system reference)
> - `docs/chapter13_support_powers_migration_plan.md` -- Chapter 13 plan (support power system reference)
> - `docs/chapter15_order_generators_migration_plan.md` -- Chapter 15 plan (order generator bridge reference)
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
