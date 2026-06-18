# Chapter 21 Phase C — Editor UI Logic Design Specification

**Author**: Migration Architect
**Date**: 2026-06-18
**Status**: DRAFT — Architect Design Spec
**OpenRA Sources Analyzed**: 18 files (2,811 total C# lines)
**Prerequisites**: Chapter 21 Phases A and B COMPLETE (EditorActionManager, EditorActorLayer, EditorActorPreview, EditorCursorLayer, EditorResourceLayer, EditorViewportControllerWidget, all 9 brushes + EditorBlit + TilingPathTool)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Dependency Graph](#2-dependency-graph)
3. [Wave 1 — Root Controller + Core Panels](#3-wave-1--root-controller--core-panels)
   - [TODO-21.C.17: LoadMapEditorLogic](#todo-21c17-loadmapeditorlogic)
   - [TODO-21.C.18: EditorQuickSaveHotkeyLogic](#todo-21c18-editorquicksavehotkeylogic)
   - [TODO-21.C.1: MapEditorLogic](#todo-21c1-mapeditorlogic)
   - [TODO-21.C.3: MapEditorTabsLogic](#todo-21c3-mapeditortabslogic)
   - [TODO-21.C.4: MapToolsLogic](#todo-21c4-maptoolslogic)
   - [TODO-21.C.8: NewMapLogic](#todo-21c8-newmaplogic)
   - [TODO-21.C.9: SaveMapLogic](#todo-21c9-savemaplogic)
4. [Wave 2 — Selectors + Property Editors](#4-wave-2--selectors--property-editors)
   - [TODO-21.C.14: CommonSelectorLogic](#todo-21c14-commonselectorlogic)
   - [TODO-21.C.12: TileSelectorLogic](#todo-21c12-tileselectorlogic)
   - [TODO-21.C.11: ActorSelectorLogic](#todo-21c11-actorselectorlogic)
   - [TODO-21.C.13: LayerSelectorLogic](#todo-21c13-layerselectorlogic)
   - [TODO-21.C.10: ActorEditLogic](#todo-21c10-actoreditlogic)
   - [TODO-21.C.2: MapEditorSelectionLogic](#todo-21c2-mapeditorselectionlogic)
   - [TODO-21.C.15: HistoryLogLogic](#todo-21c15-historyloglogic)
5. [Wave 3 — Tool-specific Panels](#5-wave-3--tool-specific-panels)
   - [TODO-21.C.5: MapGeneratorToolLogic](#todo-21c5-mapgeneratortoollogic)
   - [TODO-21.C.6: MapMarkerTilesLogic](#todo-21c6-mapmarkertileslogic)
   - [TODO-21.C.7: MapOverlaysLogic](#todo-21c7-mapoverlayslogic)
   - [TODO-21.C.16: TilingPathToolLogic](#todo-21c16-tilingpathtoollogic)
6. [Migration Order Recommendation](#6-migration-order-recommendation)
7. [Widget Tree Wiring Summary](#7-widget-tree-wiring-summary)
8. [Data Flow Architecture](#8-data-flow-architecture)
9. [Test Strategy](#9-test-strategy)
10. [Deferred Items](#10-deferred-items)

---

## 1. Architecture Overview

### 1.1 Role of Phase C in the Editor

Phase C migrates all 18 widget logic classes that form the visual interface of the map editor. Each file is a `ChromeLogic` subclass that wires DOM-based widgets (from Ch5/Ch16) to editor traits (from Phases A and B). These logic classes are **pure widget wiring** — they create widget trees, bind event handlers, and route data between the UI and the editor model.

Per ADR-21.1 (from the Chapter 21 plan), the editor UI uses **DOM-based widgets** (the Ch5 Widget system), NOT Babylon.js GUI. All editor panels render as HTML elements within the widget tree.

### 1.2 System Architecture

```
Widget Tree Root (loaded by LoadMapEditorLogic)
├── EDITOR_WORLD_ROOT
│   ├── MAP_EDITOR (EditorViewportControllerWidget) ← Phase A
│   ├── MAP_EDITOR_TAB_CONTAINER ← Phase C (MapEditorTabsLogic)
│   │   ├── SELECT_TAB, TILES_TAB, OVERLAYS_TAB, ACTORS_TAB, TOOLS_TAB, HISTORY_TAB
│   ├── SELECT_WIDGETS ← Phase C (MapEditorSelectionLogic)
│   │   ├── ACTOR_EDIT_PANEL (ActorEditLogic) + AREA_EDIT_PANEL
│   ├── TILE_WIDGETS ← Phase C (TileSelectorLogic)
│   │   ├── TILETEMPLATE_LIST + TILEPREVIEW_TEMPLATE + CATEGORIES_DROPDOWN + SEARCH_TEXTFIELD
│   ├── LAYER_WIDGETS ← Phase C (LayerSelectorLogic)
│   │   ├── LAYERTEMPLATE_LIST + LAYERPREVIEW_TEMPLATE
│   ├── ACTOR_WIDGETS ← Phase C (ActorSelectorLogic)
│   │   ├── ACTORTEMPLATE_LIST + ACTORPREVIEW_TEMPLATE + OWNERS_DROPDOWN + CATEGORIES_DROPDOWN + SEARCH_TEXTFIELD
│   ├── TOOLS_WIDGETS ← Phase C (MapToolsLogic)
│   │   ├── TOOLS_DROPDOWN (MapGeneratorToolLogic, MapMarkerTilesLogic, TilingPathToolLogic panels)
│   ├── HISTORY_WIDGETS ← Phase C (HistoryLogLogic)
│   │   ├── HISTORY_LIST + HISTORY_TEMPLATE
│   ├── COORDINATE_LABEL, CASH_LABEL ← Phase C (MapEditorLogic)
│   ├── UNDO_BUTTON, REDO_BUTTON ← Phase C (MapEditorLogic)
│   └── OVERLAY_BUTTON ← Phase C (MapOverlaysLogic)
├── TRANSIENTS_PANEL ← Floating dialogs (SaveMapLogic, NewMapLogic)
└── GLOBAL_KEYHANDLER ← Phase C (EditorQuickSaveHotkeyLogic)
```

### 1.3 Key Paradigm Shifts

| OpenRA (C# / WinForms-Widgets) | TypeScript (DOM Widgets) | Notes |
|------|------|------|
| `widget.Get<T>("NAME")` typed lookup | `widget.getWidget<T>("NAME")` | Ch5 Widget pattern |
| `[ObjectCreator.UseCtor]` DI | Constructor receives resolved dependencies | Explicit injection |
| `Ui.LoadWidget(name, parent, args)` | `widgetLoader.loadWidget(name, parent, args)` | Ch5 WidgetLoader |
| `Ui.CloseWindow()` / `Ui.OpenWindow()` | `uiRoot.closeWindow()` / `uiRoot.openWindow()` | Ch5 Ui root |
| `ScrollPanelWidget` with `ScrollItemWidget.Setup()` | Same via Ch16 extensions | Grid layout + item recycling |
| `FluentProvider.GetMessage(key)` | Template literal strings (deferred) | FluentProvider not yet migrated |
| `Game.LoadWidget(world, name, parent, args)` | `widgetLoader.loadWorldWidget(world, name, parent, args)` | World-scoped widget loading |
| `TextNotificationsManager.AddTransientLine()` | Deferred | Notification system not yet migrated |
| `ConfirmationDialogs.ButtonPrompt()` | Deferred — use `window.confirm()` fallback | Confirmation dialog system not yet migrated |
| `Log.Write("debug", msg)` | `console.debug(msg)` | Browser console |

---

## 2. Dependency Graph

```
Phase A Infrastructure (COMPLETE)
    ├── EditorActionManager.ts
    ├── EditorActorLayer.ts
    ├── EditorActorPreview.ts
    ├── EditorResourceLayer.ts
    ├── EditorCursorLayer.ts
    └── EditorViewportControllerWidget.ts

Phase B Brushes (COMPLETE)
    ├── EditorDefaultBrush.ts (Selection state + SelectionChanged/UpdateSelectedTab events)
    ├── EditorTileBrush.ts
    ├── EditorActorBrush.ts
    ├── EditorResourceBrush.ts
    ├── EditorCopyPasteBrush.ts
    ├── EditorMarkerLayerBrush.ts
    ├── EditorTilingPathBrush.ts
    ├── EditorBlit.ts
    └── TilingPathTool.ts

Ch5/Ch7/Ch16 Infrastructure (COMPLETE)
    ├── Widget system (Widget, ChromeLogic, WidgetLoader, ChromeProvider)
    ├── ButtonWidget, LabelWidget, TextFieldWidget, CheckboxWidget
    ├── DropDownButtonWidget, SliderWidget, ScrollPanelWidget, ScrollItemWidget
    ├── ContainerWidget, ColorBlockWidget
    ├── HotkeyReference, SingleHotkeyBaseLogic (Ch7)
    ├── ViewportControllerWidget (Ch7 Phase B)
    └── GridLayout (Ch16)

Phase C Wave 1 — MUST be first
    │
    ├── LoadMapEditorLogic.ts ← bootstrap (MUST be TODO-21.C.17, but trivial — 26 lines)
    │
    ├── MapEditorLogic.ts ← root controller (57 lines, wires undo/redo, coords, cash)
    │
    ├── MapEditorTabsLogic.ts ← tab strip (100 lines, 6 tabs, SelectionChanged listener)
    │
    ├── MapToolsLogic.ts ← tool palette (94 lines, loads IEditorTool panels)
    │
    ├── NewMapLogic.ts ← new map dialog (84 lines, standalone dialog)
    │
    ├── SaveMapLogic.ts ← save map dialog (360 lines, complex validation + file IO)
    │
    └── EditorQuickSaveHotkeyLogic.ts ← Ctrl+S hotkey (61 lines, extends SingleHotkeyBaseLogic)

Phase C Wave 2 — Selectors + Property Editors (all independent of each other after Wave 1)
    │
    ├── CommonSelectorLogic.ts ← abstract base (171 lines, category filter + search pattern)
    │       │
    │       ├── TileSelectorLogic.ts ← terrain tile browser (144 lines, extends CommonSelectorLogic)
    │       └── ActorSelectorLogic.ts ← actor type browser (233 lines, extends CommonSelectorLogic)
    │
    ├── LayerSelectorLogic.ts ← resource layer browser (79 lines, independent)
    │
    ├── ActorEditLogic.ts ← actor property editor (602 lines, HIGH complexity, uses SelectionChanged)
    │
    ├── MapEditorSelectionLogic.ts ← selection info panel (152 lines, uses SelectionChanged)
    │
    └── HistoryLogLogic.ts ← undo/redo history (69 lines, uses EditorActionManager events)

Phase C Wave 3 — Tool-specific panels (independent of each other)
    │
    ├── MapGeneratorToolLogic.ts ← map generator UI (331 lines, uses IEditorTool trait)
    │
    ├── MapMarkerTilesLogic.ts ← marker placement UI (261 lines, uses MarkerLayerOverlay)
    │
    ├── MapOverlaysLogic.ts ← overlay toggle panel (130 lines, uses overlay traits + hotkeys)
    │
    └── TilingPathToolLogic.ts ← tiling path config (149 lines, uses TilingPathTool + MapToolsLogic event)
```

---

## 3. Wave 1 — Root Controller + Core Panels

### 3.1 TODO-21.C.17: LoadMapEditorLogic (Bootstrap)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Ingame/LoadMapEditorLogic.cs` (26 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Ingame/LoadMapEditorLogic.ts`
**Complexity**: LOW (must be migrated FIRST in Phase C — it loads the widget tree root)

**Summary**: The entry-point ChromeLogic that initializes the editor widget tree. On construction, it loads two widget subtrees:
1. `EDITOR_WORLD_ROOT` — the main editor panel hierarchy (contains all tabs, selectors, tools)
2. `TRANSIENTS_PANEL` — floating dialog container (save/new map dialogs)

**Constructor parameters**: `(widget: Widget, world: World)`

**Key members**:

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| Constructor | `constructor(widget: Widget, world: World)` | Loads 2 widget subtrees |

**TypeScript approach**: Two calls to `widgetLoader.loadWorldWidget()` in the constructor. No event handlers, no state. Pure delegation.

**Test Strategy** (3 tests): Verify `loadWorldWidget` called for EDITOR_WORLD_ROOT and TRANSIENTS_PANEL; verify widget tree has expected children after construction.

---

### 3.2 TODO-21.C.18: EditorQuickSaveHotkeyLogic (Ctrl+S)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Ingame/Hotkeys/EditorQuickSaveHotkeyLogic.cs` (61 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Ingame/Hotkeys/EditorQuickSaveHotkeyLogic.ts`
**Complexity**: LOW

**Summary**: Extends `SingleHotkeyBaseLogic` (from Ch7) to wire Ctrl+S for quick-save in the editor. On hotkey activation, it checks `EditorActionManager.Modified` and `SaveFailed` flags, collects actor and player definitions from `EditorActorLayer`, then invokes `SaveMapLogic.saveMap()`.

**Constructor parameters**: `(widget, modData, world, logicArgs)` — delegates to `super(widget, modData, "QuickSaveKey", "GLOBAL_KEYHANDLER", logicArgs)`

**Key methods**:

| Method | Description | Test Priority |
|--------|-------------|:---:|
| `constructor(...)` | Calls super, stores `world` and `modData` | LOW |
| `onHotkeyActivated(keyInput)` | Check Modified/SaveFailed, then save | **CRITICAL** — 4 tests |

**TypeScript approach**: Extends `SingleHotkeyBaseLogic`. The `onHotkeyActivated` override:
1. Gets `EditorActionManager` from world actor
2. Returns false if `!actionManager || !actionManager.Modified || actionManager.SaveFailed`
3. Collects `actorDefinitions` from `EditorActorLayer.save()`
4. Collects `playerDefinitions` from `editorActorLayer.Players.toMiniYaml()`
5. Calls `SaveMapLogic.saveMap(modData, world, map, map.Package?.Name, saveMapCallback)`
6. The `saveMapCallback` calls `SaveMapLogic.saveMapInner()`

**Potential Pitfalls**: `SaveMapLogic.saveMap()` is a static method that may show confirmation dialogs (overwrite prompts). The hotkey handler does NOT need to show dialogs — it delegates to `SaveMapLogic.saveMap()` which handles all dialogs internally.

---

### 3.3 TODO-21.C.1: MapEditorLogic (Root Controller)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.cs` (57 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.ts`
**Complexity**: LOW

**Summary**: The root editor controller that wires the top-level toolbar elements:
1. **Coordinate label**: Shows `{cell.X},{cell.Y},{height} ({tileType})` at the current mouse position
2. **Cash label**: Shows total resource net worth (`EditorResourceLayer.netWorth`)
3. **Undo/Redo buttons**: Wired to `EditorActionManager.undo()`/`.redo()` with disabled state bound to `hasUndos()`/`hasRedos()`

**Constructor parameters**: `(widget, world, worldRenderer)`

**Key members**:

| Member | TypeScript | Notes |
|--------|-----------|-------|
| Constructor | Bind coordinateLabel.GetText from viewport + map data | Uses `Viewport.ViewToWorld + Map.Height + Map.Tiles` |
| Constructor | Bind cashLabel.GetText from EditorResourceLayer.NetWorth | Optional — null if no resource layer |
| Constructor | Bind undoButton/redoButton to EditorActionManager | IsDisabled from HasUndos/HasRedos; OnClick delegates |

**TypeScript approach**: All `.GetText` lambdas become TypeScript function closures assigned to widget `.getText` properties. Button delegates call the action manager directly.

**Potential Pitfalls**: `Viewport.ViewToWorld(Viewport.LastMousePos)` requires the Viewport to track `LastMousePos`. In 3D, this is set from the last mouse event position.

---

### 3.4 TODO-21.C.3: MapEditorTabsLogic (Tab Strip)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorTabsLogic.cs` (100 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorTabsLogic.ts`
**Complexity**: LOW

**Summary**: Manages the 6-tab editor tab strip with panel visibility toggling and auto-switch behavior on selection changes.

**Tab types**: `enum MenuType { Select, Tiles, Layers, Actors, Tools, History }`

**Constructor parameters**: `(widget, world)`

**Key behaviors**:
1. **Tab setup**: Each tab button has `isHighlighted` bound to `menuType === tabType`, `onClick` switches `menuType` and fires `OnTabChanged`
2. **Container visibility**: Each tab's container widget has `isVisible` bound to `menuType === tabType`
3. **Selection auto-switch**: When `SelectionChanged` fires through `HandleUpdateSelectedTab`, if a selection exists, auto-switches to Select tab; when selection cleared, switches back to `lastSelectedTab`
4. **Select tab guard**: Select tab is disabled when no selection exists
5. **Tools tab guard**: Tools tab is disabled when no `IEditorTool` traits are available
6. **Keyboard focus clear**: When switching tabs, `Ui.KeyboardFocusWidget = null`

**Events**:

| Event | Trigger | Consumers |
|-------|---------|-----------|
| `OnTabChanged` (static) | Tab switch or selection auto-switch | MapToolsLogic (re-invokes tool-specific tab logic) |

**TypeScript approach**: Static `onTabChanged` maps to a shared callback set:
```typescript
static onTabChangedCallbacks = new Set<() => void>()
```

Widget references use `widget.parent.parent.get<EditorViewportControllerWidget>("MAP_EDITOR")` for editor access. The subscribe/unsubscribe pattern for `DefaultBrush.UpdateSelectedTab` uses `editor.defaultBrush.onUpdateSelectedTab(cb)`.

---

### 3.5 TODO-21.C.4: MapToolsLogic (Tool Palette)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapToolsLogic.cs` (94 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapToolsLogic.ts`
**Complexity**: LOW

**Summary**: Loads all `IEditorTool` trait panels, manages tool selection dropdown, and fires `OnSelected` event for tool-specific logic classes to activate their brushes.

**Constructor parameters**: `(widget, world)`

**Key behaviors**:
1. Loads all `IEditorTool` traits from the world actor using `WidgetLoader.loadWorldWidget()`
2. Stores `[panel, label]` entries in a map
3. `SelectTool(panel)` shows the selected tool panel, hides the previous
4. Dropdown button shows the list of tool labels using `ScrollItemWidget.Setup` pattern
5. Calls `OnSelected(isVisible)` on TabChanged event

**Events**:

| Event | Trigger | Consumers |
|-------|---------|-----------|
| `OnSelected(isVisible)` (static) | Tool selected or tab changed | TilingPathToolLogic (sets/clears brush) |

**Potential Pitfalls**: When only one tool is available, the dropdown is disabled (no point in choosing). `MapEditorTabsLogic.OnTabChanged` listener must be unsubscribed in `dispose()`.

---

### 3.6 TODO-21.C.8: NewMapLogic (New Map Dialog)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/NewMapLogic.cs` (84 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/NewMapLogic.ts`
**Complexity**: LOW

**Summary**: A dialog that lets users create a new map from scratch. Provides terrain type selection dropdown, width/height text fields, and a Create button.

**Constructor parameters**: `(onExit: () => void, onSelect: (uid: string) => void, widget, world, modData)`

**Key behaviors**:
1. **Cancel button**: Closes window, calls `onExit()`
2. **Tileset dropdown**: Shows all `modData.DefaultTerrainInfo` values using `ScrollItemWidget.Setup` pattern with FluentProvider label
3. **Create button**: Validates width/height (clamped to min 2), creates a new `Map` with borders, sets player definitions, saves to in-memory ZIP package, calls `Game.LoadEditor(map)`, closes window, calls `onSelect(map.Uid)`
4. **Map bounds**: `topLeft = (1, 1 + maxTerrainHeight)`, `bottomRight = (width, height + maxTerrainHeight)` — leaves 1-cell border

**TypeScript approach**: The `Map` constructor call and `Map.setBounds()` must match Ch4 API. `Game.LoadEditor(map)` is a global function that switches the world to editor mode. `onSelect` and `onExit` are callback parameters — in TypeScript, these are plain functions.

**Potential Pitfalls**: The `CachedTransform<ITerrainInfo, string>` caching pattern avoids redundant FluentProvider lookups on every frame. In TypeScript, use a simple memoization pattern: `let cachedLabel = ""; let cachedTerrain: ITerrainInfo | null = null;`.

---

### 3.7 TODO-21.C.9: SaveMapLogic (Save Map Dialog)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/SaveMapLogic.cs` (360 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/SaveMapLogic.ts`
**Complexity**: MEDIUM (HIGH per plan's classification)

**Summary**: The save map dialog with title/author fields, visibility options, directory selection, file type toggle (.oramap vs unpacked folder), overwrite conflict resolution, and save error handling.

**Constructor parameters**: `(widget, modData, map, onSave: (uid: string) => void, onExit: () => void, world, playerDefinitions, actorDefinitions)`

**Key behaviors**:
1. **Title/Author fields**: Pre-populated from map metadata; save disabled when any field is whitespace
2. **Visibility dropdown**: Checkboxes for each `MapVisibility` enum value; Shellmap option only shown when already set
3. **Directory dropdown**: Enumerates writable directories from `modData.MapCache.MapLocations`; tests writability by creating/deleting a temp file; prioritizes directories containing the map; falls back to `User` classification directories
4. **File type dropdown**: `.oramap` (compressed ZIP) vs Unpacked (folder); mapped from `MapFileType` enum with extension + label
5. **Save button**: Constructs path from directory + filename + extension, calls static `SaveMap()` method
6. **Overwrite detection**: When path matches an existing map, shows confirmation dialog; when map UID changed externally, warns about editing outdated version
7. **Save execution**: Creates/opens writeable package, calls `Map.save(package)`, resets `Modified` flag, shows transient notification, calls `onSave(map.Uid)`
8. **Marker tiles save**: Saves `MarkerLayerOverlay` marker tiles to a `.yaml` file in the support directory
9. **Error handling**: On save failure, logs error, sets `EditorActionManager.SaveFailed = true`, shows error confirmation dialog

**Key methods**:

| Method | Scope | Description |
|--------|-------|-------------|
| `constructor(...)` | Instance | Widget wiring for all fields, dropdowns, buttons |
| `SaveMap(modData, world, map, path, saveMap)` | Static | Overwrite conflict detection + resolution |
| `SaveMapInner(map, package, world, modData)` | Static | Core save logic: `map.Save(package)`, reset Modified, notify |
| `SaveMapFailed(e, modData, world)` | Static | Error dialog display |
| `SaveMapMarkerTiles(map, modData, world)` | Static | Marker tile persistence |

**Potential Pitfalls**:
- `ConfirmationDialogs.ButtonPrompt()` is not yet migrated — use `window.confirm()` or a simple Promise-based dialog fallback
- `TextNotificationsManager.AddTransientLine()` is not yet migrated — stub as `console.log()`
- `FluentProvider.GetMessage()` is not yet migrated — hardcode English strings
- `ZipFileLoader.Create()` may not exist — use a deferred TODO if ZIP creation is not yet available
- `Platform.ResolvePath()` and `Platform.SupportDir` need TypeScript equivalents (browser has no filesystem — save will use download API)
- The temp file writability test (`File.Create(".testwritable")`) cannot work in browser — map save will go through download mechanism instead

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `ConfirmationDialogs.ButtonPrompt` | Confirmation dialog system not yet migrated | TODO-21.C.9-DEFER-1 |
| `TextNotificationsManager.AddTransientLine` | Notification system not yet migrated | TODO-21.C.9-DEFER-2 |
| `FluentProvider` localization | Localization not yet migrated | TODO-21.C.9-DEFER-3 |
| `ZipFileLoader.Create` (writeable ZIP) | ZIP write support not yet available | TODO-21.C.9-DEFER-4 |
| `Platform.ResolvePath` / `Platform.SupportDir` | Filesystem APIs not available in browser | TODO-21.C.9-DEFER-5 |
| `SaveMapMarkerTiles` | MarkerLayerOverlay serialization not yet migrated | TODO-21.C.9-DEFER-6 |

---

## 4. Wave 2 — Selectors + Property Editors

### 4.1 TODO-21.C.14: CommonSelectorLogic (Abstract Base)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/CommonSelectorLogic.cs` (171 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/CommonSelectorLogic.ts`
**Complexity**: LOW

**Summary**: Abstract base class for selector panels (tiles, actors). Provides shared patterns:
1. **Category filter dropdown**: Checkbox panel with Select All / Select None buttons
2. **Search text field**: Filters `allCategories` based on search terms from the data model
3. **Preview panel**: `ScrollPanelWidget` with `GridLayout` and a reusable `ScrollItemWidget` template
4. **Selection change listener**: Yields keyboard focus when selection changes

**Constructor parameters**: `(widget, modData, world, worldRenderer, templateListId: string, previewTemplateId: string)`

**Key members**:

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `Widget`, `ModData`, `World`, `WorldRenderer`, `Editor`, `Panel`, `ItemTemplate` | Protected fields | Set in constructor |
| `SelectedCategories` | `Set<string>` | Currently active category filters |
| `FilteredCategories` | `string[]` | Categories to show (filtered by search) |
| `allCategories` | `string[]` | All available categories |
| `searchFilter` | `string` | Current search text |
| `SearchTextField` | `TextFieldWidget` | Search input — escape clears text |
| `CreateCategoriesPanel(panel)` | `Widget` | Build checkbox panel; returns populated container |
| `InitializePreviews()` | `abstract void` | Subclass must implement — renders items in Panel |

**Concrete subclasses**: `TileSelectorLogic`, `ActorSelectorLogic`

**TypeScript approach**: Abstract class with `protected abstract initializePreviews(): void`. The search filter logic filters `allCategories` by matching against the data model's search terms (provided by subclasses). The category panel creation clones checkbox templates and wires `isChecked`/`onClick` to `SelectedCategories`.

**Potential Pitfalls**: The `categorySelector.GetText` uses a four-way condition (none, search-results, single, all, multiple). The `multiple` case when `SelectedCategories.size === allCategories.length` → "All". Must match C# logic exactly.

---

### 4.2 TODO-21.C.12: TileSelectorLogic (Terrain Tile Browser)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/TileSelectorLogic.cs` (144 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/TileSelectorLogic.ts`
**Complexity**: LOW

**Summary**: Extends `CommonSelectorLogic` to browse and select terrain template tiles from `ITemplatedTerrainInfo`. Each tile preview shows a `TerrainTemplatePreviewWidget`.

**Constructor parameters**: `(widget, modData, world, worldRenderer)` — calls `super(widget, modData, world, worldRenderer, "TILETEMPLATE_LIST", "TILEPREVIEW_TEMPLATE")`

**Key behaviors**:
1. Validates that terrain info is `ITemplatedTerrainInfo` (throws if not)
2. Builds `TileSelectorTemplate[]` from `terrainInfo.TemplatesInDefinitionOrder`
3. Categories come from `TerrainTemplateInfo.Categories`
4. Search terms = template ID (as string)
5. Category ordering uses `terrainInfo.EditorTemplateOrder` for custom sort
6. Preview rendering: scales `TerrainTemplatePreviewWidget` to fit within panel bounds while preserving aspect ratio

**Key method**: `initializePreviews()` — Overrides abstract method. For each template matching selected categories and search filter, creates a `ScrollItemWidget` that sets `EditorTileBrush` on click. Scales preview widget proportionally.

**Potential Pitfalls**: `ITemplatedTerrainInfo` and `TerrainTemplatePreviewWidget` are **NOT YET MIGRATED** (both are map generator dependencies). See deferral below.

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `ITemplatedTerrainInfo.TemplatesInDefinitionOrder` | Map generator terrain not yet migrated | TODO-21.C.12-DEFER-1 |
| `TerrainTemplatePreviewWidget` | Terrain preview widget not yet migrated | TODO-21.C.12-DEFER-2 |

---

### 4.3 TODO-21.C.11: ActorSelectorLogic (Actor Type Browser)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorSelectorLogic.cs` (233 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorSelectorLogic.ts`
**Complexity**: MEDIUM

**Summary**: Extends `CommonSelectorLogic` to browse and select actors for placement. Filters by owner, categories, tileset compatibility, and search terms. Each preview shows an `ActorPreviewWidget`.

**Constructor parameters**: `(widget, modData, world, worldRenderer)` — calls `super(widget, modData, world, worldRenderer, "ACTORTEMPLATE_LIST", "ACTORPREVIEW_TEMPLATE")`

**Key behaviors**:
1. **Owner dropdown**: Shows all players from `EditorActorLayer.Players`; `ScrollItemWidget.Setup` with color from `PlayerReference.Color`
2. **Actor filtering**: Loads all actors from `mapRules.Actors.Values`; filters out:
   - Partial templates (name contains `^`)
   - Actors without `IRenderActorPreviewInfo`
   - Actors without `MapEditorDataInfo` categories
   - Actors excluded by current tileset
3. **Search terms**: Actor name + `TooltipInfo.Name` (or `EditorOnlyTooltipInfo`)
4. **Tooltip**: Multi-line — actor display name + actor type
5. **Preview rendering**: Creates `ActorPreviewWidget` with `OwnerInit` + `FactionInit` + `IActorPreviewInitInfo` inits; scales to fit panel
6. **Owner change**: When owner changes via dropdown, if the current brush is `EditorActorBrush`, updates brush's preview actor with new `OwnerInit` and `FactionInit`
7. **Player removal listener**: When a player is removed, falls back to first available player

**Key data model**:

```typescript
interface ActorSelectorActor {
  actor: ActorInfo
  categories: readonly string[]
  searchTerms: readonly string[]
  tooltip: string
}
```

**Potential Pitfalls**:
- `ActorPreviewWidget` is **NOT YET MIGRATED** — requires Ch3 actor preview infrastructure (see deferral)
- `IRenderActorPreviewInfo` trait info query on `ActorInfo` requires the trait info system
- `IActorPreviewInitInfo.ActorPreviewInits()` requires the actor init pipeline
- The `editorLayer.OnPlayerRemoved` callback must handle the case where all players are removed

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `ActorPreviewWidget` rendering | Actor preview widget not yet migrated | TODO-21.C.11-DEFER-1 |
| `IActorPreviewInitInfo.ActorPreviewInits()` | Actor preview init pipeline not yet migrated | TODO-21.C.11-DEFER-2 |
| `FluentProvider` for tooltip/actor type labels | Localization not yet migrated | TODO-21.C.11-DEFER-3 |

---

### 4.4 TODO-21.C.13: LayerSelectorLogic (Resource Layer Browser)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/LayerSelectorLogic.cs` (79 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/LayerSelectorLogic.ts`
**Complexity**: LOW

**Summary**: Browses and selects resource types for painting. Iterates `IResourceRenderer` traits and creates preview items for each `resourceType`.

**Constructor parameters**: `(widget, worldRenderer)`

**Key behaviors**:
1. Iterates all `IResourceRenderer` traits on the world actor
2. For each renderer, iterates `renderer.ResourceTypes`
3. Creates `ScrollItemWidget` with `ResourcePreviewWidget` for each resource type
4. Click sets `EditorResourceBrush` on the editor
5. Scales preview widgets proportionally

**Potential Pitfalls**:
- `IResourceRenderer` and `ResourcePreviewWidget` are **NOT YET MIGRATED** (see deferral)
- The widget hierarchy uses `widget.parent.parent.get<EditorViewportControllerWidget>("MAP_EDITOR")` — 2 levels of parent traversal

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `IResourceRenderer.ResourceTypes` | Resource renderer not yet migrated | TODO-21.C.13-DEFER-1 |
| `ResourcePreviewWidget` resource rendering | Resource preview widget not yet migrated | TODO-21.C.13-DEFER-2 |

---

### 4.5 TODO-21.C.10: ActorEditLogic (Actor Property Editor) — HIGH COMPLEXITY

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorEditLogic.cs` (602 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorEditLogic.ts`
**Complexity**: HIGH

**Summary**: The most complex Phase C file. Provides an inline property editor for the currently selected actor. Dynamically generates form fields (checkboxes, sliders, dropdowns, text fields) from `IEditorActorOptions` trait infos. Manages an "edit preview" that tracks dirty state and provides undo/redo via `EditActorEditorAction`.

**Constructor parameters**: `(widget, world, worldRenderer, logicArgs)`

#### 4.5.1 Property Grid Pattern

The property grid is **dynamically generated** from `IEditorActorOptions` trait infos. The flow:

```
1. SelectionChanged fires → HandleSelectionChanged() runs
2. If actor selected:
   a. Record initialActorID
   b. Create EditActorPreview (tracks IEditActorHandle[] dirty state)
   c. Add owner dropdown (always first)
   d. Query SelectedActor.Info.TraitInfos<IEditorActorOptions>()
   e. For each option, ordered by DisplayOrder:
      - EditorActorCheckbox → clone CHECKBOX_OPTION_TEMPLATE
      - EditorActorSlider → clone SLIDER_OPTION_TEMPLATE
      - EditorActorDropdown → clone DROPDOWN_OPTION_TEMPLATE
      - EditorActorTextField → clone TEXTFIELD_OPTION_TEMPLATE
   f. Each option creates an EditorActorOptionActionHandle<T> added to editActorPreview
   g. initContainer.Bounds.Height accumulates as each row is added
3. If no actor selected: Close() → clear selection
```

#### 4.5.2 Key Sub-Classes (Nested in ActorEditLogic)

**EditActorPreview** (inner class):
- Tracks `List<IEditActorHandle>` — all parameter handles including `SetActorIdAction`
- `IsDirty` — computed: any handle.IsDirty
- `SetActorID(id)` — delegates to setActorIdAction
- `Reset()` — calls Undo on all dirty handles
- `GetDirtyHandles()` — returns handles where IsDirty

**EditorActorOptionActionHandle<T>** (exports to Phase B):
- Implements `IEditActorHandle`
- Stores initial value + change callback
- `OnChange(newValue)` — sets IsDirty by comparing with initial value (via `EqualityComparer<T>.Default`)
- `Do(ref actor)` / `Undo(ref actor)` — calls the change callback with current/initial values

**SetActorIdAction** (inner class):
- Implements `IEditActorHandle` with `ShouldDoOnSave = true`
- Actor ID change requires removing and re-adding the preview (ID is the hash key)
- `Do()`: `editorActorLayer.Remove(actor); actor = actor.WithId(newID); editorActorLayer.Add(actor);`
- Uses `logic.IsChangingSelection` flag to prevent re-entry during selection swap

**EditActorEditorAction** (inner class):
- Implements `IEditorAction`
- Stores all handles; `Do()` calls handle.Do() on all; `Undo()` calls handle.Undo() on all
- `Execute()` only calls handles where `ShouldDoOnSave` (currently only `SetActorIdAction`)
- Text auto-updates when actor ID changes

#### 4.5.3 Multi-Edit Support Pattern

**Current state**: The C# ActorEditLogic does NOT support multi-edit (editing multiple selected actors simultaneously). The `SelectedActor` single-reference pattern reflects this. Multi-edit support requires:
- Tracking a `SelectedActors: EditorActorPreview[]` instead of a single reference
- For each property change, applying to all selected actors
- Displaying "Multiple" for properties with heterogeneous values

**This is a deferred feature** — the C# code does not implement it, so Phase C migration can skip it.

#### 4.5.4 Actor ID Validation State Machine

```
ActorIDStatus (flags enum):
  Normal = 0     // Both Empty and Duplicate have overlapping bits with Normal
  Duplicate = 1  // ID already exists
  Empty = 3      // ID is whitespace (3 = 0b11, overlaps both Normal and Duplicate bits)

State transitions checked in Tick():
  if (actorIDStatus !== nextActorIDStatus):
    if ((actorIDStatus & nextActorIDStatus) === 0):
      // Major state change (Normal ↔ Duplicate or Normal ↔ Empty)
      // Shift initContainer and buttonContainer to make room for error label
    actorIDStatus = nextActorIDStatus
```

The overlapping bit design ensures that transitions between Duplicate and Empty (both error states) do NOT shift the layout — only transitions to/from Normal trigger layout reflow.

#### 4.5.5 Owner Dropdown (First Property)

Always the first row in the property grid. Shows all players from `editorActorLayer.Players.Players.Values`, ordered by name. Each item has player name + player color. Owner change replaces `OwnerInit` on the selected actor.

#### 4.5.6 Key Methods

| Method | Lines (C#) | Description | Test Priority |
|--------|:---:|-------------|:---:|
| `constructor(...)` | 70 | Widget wiring + selection listener | LOW |
| `HandleSelectionChanged()` | 205 | Generate property grid from trait infos | **CRITICAL** — 12+ tests |
| `Tick()` | 15 | Actor ID status change animation | HIGH |
| `Delete()` | 8 | Add RemoveSelectedActorAction | HIGH |
| `Cancel()` | 4 | Reset + Close | HIGH |
| `Save()` | 5 | Add EditActorEditorAction | HIGH |
| `Close()` | 9 | Yield focus + clear selection | MEDIUM |
| `Reset()` | 2 | Reset editActorPreview | MEDIUM |
| `YieldFocus()` | 6 | Yield all typable fields + actorID field | MEDIUM |
| `SetActorID(actorId)` | 4 | Update preview actor ID | MEDIUM |
| `IsValid()` | 3 | nextActorIDStatus === Normal | MEDIUM |

#### 4.5.7 Potential Pitfalls

- **`IsChangingSelection` guard**: When `SetActorIdAction.Do()` re-adds the actor with a new ID, it fires `SelectionChanged`. Without the guard, `HandleSelectionChanged` would reset the entire form mid-edit. The guard flag prevents this re-entry.
- **Layout reflow on error**: `actorIDErrorLabel.Bounds.Height` is added/subtracted from `initContainer.Bounds.Y` and `buttonContainer.Bounds.Y` when the error label appears/disappears. The overlap bit logic ensures reflow only on Normal↔Error transitions.
- **Tab traversal**: `typableFields` (`HashSet<TextFieldWidget>`) collects all text fields (slider value fields + text field options) for batch `YieldKeyboardFocus()`.
- **`IEditorActorOptions` + `IActorPreviewInitInfo`**: Both interfaces may not be fully migrated yet. They are part of the Ch3/Ch19 actor preview/trait info pipeline. See deferral.
- **Actor preview ID change in-place is impossible**: `EditorActorPreview` ID is the equality key. The `SetActorIdAction` must swap the entire preview object — remove old, add new. The `EditorSelection` reference updates to the new preview.

#### 4.5.8 Key Data Flow

```
User changes property
    │
    ▼
EditorActorOptionActionHandle.OnChange(value)
    │  compares to initial → sets IsDirty
    ▼
editActorPreview.GetDirtyHandles() → includes this handle
    │
    ▼
User clicks OK → Save()
    │
    ▼
editorActionManager.Add(new EditActorEditorAction(selectedActor, dirtyHandles))
    │
    ▼
EditActorEditorAction.Execute()
    │  calls handle.Do() on ShouldDoOnSave handles only
    ▼
Actor state updated (via change callbacks)

User clicks Cancel or selects different actor
    │
    ▼
editActorPreview.Reset()
    │  calls handle.Undo() on all dirty handles
    ▼
All properties revert to initial values
```

#### 4.5.9 Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `IEditorActorOptions` interface and implementations | Trait info option system not yet migrated | TODO-21.C.10-DEFER-1 |
| `OwnerInit`, `FactionInit`, `HealthInit` actor init types | Ch3 actor init types not fully migrated | TODO-21.C.10-DEFER-2 |
| `EditorActorOptionActionHandle<T>.OnChange` integration with EditorActionManager | Full undo integration requires Phase A complete | TODO-21.C.10-DEFER-3 |
| `FluentProvider` for error messages and labels | Localization not yet migrated | TODO-21.C.10-DEFER-4 |

---

### 4.6 TODO-21.C.2: MapEditorSelectionLogic (Selection Info Panel)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorSelectionLogic.cs` (152 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorSelectionLogic.ts`
**Complexity**: LOW

**Summary**: Shows selection info in the Select tab. Toggles between actor edit panel and area edit panel based on selection type. The area edit panel shows selection dimensions, diagonal length, and resource value within the region. Manages copy/paste buttons and selection delete/cancel buttons.

**Constructor parameters**: `(widget, world, worldRenderer)`

**Key behaviors**:
1. **Panel visibility**: `actorEditPanel.isVisible = () => selection.Actor !== null`; `areaEditPanel.isVisible = () => selection.Area !== null`
2. **Copy filter checkboxes** (Terrain, Resources, Actors): Bitmask of `MapBlitFilters` toggled by XOR on click
3. **Copy button**: Calls `CopySelectionContents()` → `EditorBlit.CopyRegionContents()` → stores as `clipboard`
4. **Paste button**: Creates `EditorCopyPasteBrush` with clipboard, resource layer, and filter callback
5. **Delete selection button**: Calls `editor.defaultBrush.DeleteSelection(selectionFilters)`
6. **Cancel selection button**: Calls `editor.defaultBrush.ClearSelection(updateSelectedTab: true)`
7. **Selection info labels**: `AreaEditTitle` (dimensions + coordinates), `DiagonalLabel` (pythagorean diagonal), `ResourceCounterLabel` (total resource value)
8. **Copy filter checkboxes disabled during paste**: When `EditorCopyPasteBrush` is active, checkboxes are disabled

**TypeScript approach**: Pure widget wiring — all properties are getter closures on widget visibility/state.

**Potential Pitfalls**: `EditorBlit.CopyRegionContents()` returns `EditorBlitSource` — this must be compatible with Phase B's `EditorBlit` type. The copy/paste buttons depend on `EditorCopyPasteBrush` from Phase B.

---

### 4.7 TODO-21.C.15: HistoryLogLogic (Undo/Redo History)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/HistoryLogLogic.cs` (69 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/HistoryLogLogic.ts`
**Complexity**: LOW

**Summary**: Displays the undo/redo history as a scrollable list. Each entry shows the action text, colored dim for future actions, and is clickable to rewind/forward.

**Constructor parameters**: `(widget, world)`

**Key behaviors**:
1. Subscribes to `EditorActionManager.ItemAdded` and `ItemRemoved`
2. `ItemAdded`: Creates `ScrollItemWidget` with action text; text color dims for `Future` status actions; click rewinds to that action's id in history
3. `ItemRemoved`: Removes the corresponding `ScrollItemWidget` from the panel
4. `IsSelected`: Highlights the `Active` status action
5. Click behavior: `Status === History` → `editorActionManager.Rewind(id)`; `Status === Future` → `editorActionManager.Forward(id)`; `Active` → no-op

**TypeScript approach**: Maintain a `Map<EditorActionContainer, ScrollItemWidget>` for efficient removal. Widget text uses closures bound to action status.

**Potential Pitfalls**: The `EditorActionContainer` must have stable IDs across undo/redo cycles — the ID is assigned once and never changes. The `EditorActionManager.Rewind(id)` / `Forward(id)` methods must exist on the Phase A `EditorActionManager`.

---

## 5. Wave 3 — Tool-specific Panels

### 5.1 TODO-21.C.5: MapGeneratorToolLogic (Map Generator UI)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapGeneratorToolLogic.cs` (331 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapGeneratorToolLogic.ts`
**Complexity**: MEDIUM

**Summary**: The UI for the map generator tool (`IEditorTool` trait implementing `IEditorMapGeneratorInfo`). Reads generator settings, builds a dynamic form with 4 option types (Boolean, Integer, MultiIntegerChoice, MultiChoice), and runs the generator on Generate button click.

**Constructor parameters**: `(widget, world, worldRenderer, modData, tool)`

**Key behaviors**:
1. **Dynamic form generation**: Reads `generator.GetSettings().Options` and creates form rows:
   - `MapGeneratorBooleanOption` → `CHECKBOX_TEMPLATE` clone + checkbox with label
   - `MapGeneratorIntegerOption` → `TEXT_TEMPLATE` clone + text field (integer type, validated on edit)
   - `MapGeneratorMultiIntegerChoiceOption` → `DROPDOWN_TEMPLATE` clone + dropdown button
   - `MapGeneratorMultiChoiceOption` → `DROPDOWN_TEMPLATE` clone + dropdown with FluentProvider labels
2. **Generate button**: Calls `GenerateMap()`, which wraps the generator call in try/catch for error display
3. **Generate random button**: Calls `settings.Randomize(world.LocalRandom)`, updates UI, then generates
4. **RandomMapEditorAction**: Wraps `EditorBlit` in an `IEditorAction` for undo/redo
5. **Generation output**: Converts generated map data (`MapGenerator.Map` result) to `EditorBlitSource`, applies via `EditorBlit.Commit()`
6. **Error display**: `MapGenerationException` shows the exception message; other errors show a generic prompt

**Key data flow**:
```
Settings object (IMapGeneratorSettings)
    │
    ▼
UpdateSettingsUi() — builds form from Options
    │
    ▼
User edits settings → values stored directly on settings object
    │
    ▼
GenerateMap() → generator.Generate(modData, args) → EditorBlitSource
    │
    ▼
EditorBlit.Commit() → IEditorAction → EditorActionManager.Add()
```

**Potential Pitfalls**:
- `MapGenerator`, `IEditorMapGeneratorInfo`, `IMapGeneratorSettings` and all option types are **NOT YET MIGRATED** (map generator namespace — deferred from Phase G original scope)
- The `PlayerCount` option triggers `UpdateSettingsUi()` re-render (some MultiChoice options depend on player count)
- `FieldSaver.FormatValue()` used for integer/choice display — this is a simple number→string conversion
- `FluentProvider.GetMessage()` used extensively for labels and tooltips — see deferral
- `MersenneTwister` (`world.LocalRandom`) — use `Math.random()` as substitute

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| Full `MapGenerator` namespace (Generate, settings, options) | Map generator not yet migrated | TODO-21.C.5-DEFER-1 |
| `MersenneTwister` (world.LocalRandom) | Use Math.random() as substitute | TODO-21.C.5-DEFER-2 |
| `FluentProvider` for labels and tooltips | Localization not yet migrated | TODO-21.C.5-DEFER-3 |

---

### 5.2 TODO-21.C.6: MapMarkerTilesLogic (Marker Placement UI)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapMarkerTilesLogic.cs` (261 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapMarkerTilesLogic.ts`
**Complexity**: MEDIUM

**Summary**: Configures the marker tile brush with color swatches, mirror mode controls, alpha slider, and clear buttons. Listens for brush changes to reset the selected marker index.

**Constructor parameters**: `(widget, world, modData, worldRenderer, logicArgs)`

**Key behaviors**:
1. **Color swatch grid**: Creates `ScrollItemWidget` for each `MarkerLayerOverlay.Info.Colors` entry; click sets `EditorMarkerLayerBrush` with that color index; selected state bound to `markerTile === index`
2. **Erase button**: Sets `EditorMarkerLayerBrush` with `templateId = null` (erase mode)
3. **Alpha slider**: Range 1-255, 12 ticks; directly sets `markerLayerTrait.TileAlpha`
4. **Mirror mode dropdown**: Three modes (None, Flip, Rotate); changes `markerLayerTrait.MirrorMode`
5. **Rotate num sides slider**: Range 2-8, 7 ticks; visible only in Rotate mode; sets `markerLayerTrait.NumSides`
6. **Flip num sides dropdown**: Options [2, 4]; visible only in Flip mode; sets `markerLayerTrait.NumSides`
7. **Axis angle slider**: Range 0-11 (mapped to 0-165 degrees in steps of 15); visible only in Flip mode; sets `markerLayerTrait.AxisAngle`
8. **Clear selected button**: Creates `ClearSelectedMarkerTilesEditorAction` for the active marker template
9. **Clear all button**: Creates `ClearAllMarkerTilesEditorAction`
10. **Brush change listener**: When brush changes away from `EditorMarkerLayerBrush`, resets `markerTile` to null

**TypeScript approach**: All `isVisible` properties are function closures checking the mirror mode. The color swatch grid uses the standard `ScrollItemWidget.Setup()` pattern.

**Potential Pitfalls**:
- `MarkerLayerOverlay` is **NOT YET MIGRATED** (Phase B stub used `IMarkerLayer` interface)
- The widget hierarchy traversal (`widget.parent.parent.parent.parent.get<EditorViewportControllerWidget>("MAP_EDITOR")`) — 4 levels of parent — must match the actual widget tree depth
- `ClearSelectedMarkerTilesEditorAction` and `ClearAllMarkerTilesEditorAction` are Phase B action classes — must have correct imports
- `MarkerTileMirrorMode` enum must be available from the `MarkerLayerOverlay` migration

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `MarkerLayerOverlay` full trait (Colors, TileAlpha, MirrorMode, NumSides, AxisAngle) | MarkerLayerOverlay not yet migrated | TODO-21.C.6-DEFER-1 |
| `ColorBlockWidget` rendering | Color block widget may not have visual renderer in 3D context | TODO-21.C.6-DEFER-2 |

---

### 5.3 TODO-21.C.7: MapOverlaysLogic (Overlay Toggle Panel)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/MapOverlaysLogic.cs` (130 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapOverlaysLogic.ts`
**Complexity**: LOW

**Summary**: Toggles editor visual overlays (terrain grid, buildable terrain, marker layer) via both a dropdown panel and keyboard hotkeys.

**Constructor parameters**: `(widget, world, modData, worldRenderer, logicArgs)`

**Key behaviors**:
1. **Overlay traits**: Resolves `TerrainGeometryOverlay`, `BuildableTerrainOverlay`, `MarkerLayerOverlay` from world actor
2. **Hotkey registration**: Reads hotkey references from `logicArgs` (ToggleGridOverlayKey, ToggleBuildableOverlayKey, ToggleMarkerOverlayKey) using `modData.Hotkeys[yaml.Value]`
3. **Key handler**: `LogicKeyListenerWidget` with `AddHandler` — on key down, toggles the corresponding overlay trait's `Enabled` flag via XOR
4. **Dropdown panel**: Creates a checkbox panel with 3 entries (Grid, Buildable, Marker); each checkbox reads/writes the corresponding trait's `Enabled` flag
5. **Overlay dropdown**: Uses the standard `overlayDropdown.RemovePanel()` / `overlayDropdown.AttachPanel(overlayPanel)` pattern

**TypeScript approach**: Uses Ch7 `HotkeyReference.isActivatedBy(keyInput)` for hotkey matching. Panel creation follows the same clone-template pattern as `CommonSelectorLogic.CreateCategoriesPanel()`.

**Potential Pitfalls**:
- `TerrainGeometryOverlay`, `BuildableTerrainOverlay` are **NOT YET MIGRATED** — these are editor-only overlay traits
- `LogicKeyListenerWidget.AddHandler()` — must verify this widget type exists in Ch16
- `[ChromeLogicArgsHotkeys]` attribute is a C# metadata marker — in TypeScript, this is JSDoc only

**Features That Can Be Deferred**:

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `TerrainGeometryOverlay` trait | Editor overlay trait not yet migrated | TODO-21.C.7-DEFER-1 |
| `BuildableTerrainOverlay` trait | Editor overlay trait not yet migrated | TODO-21.C.7-DEFER-2 |
| `FluentProvider` for checkbox labels | Localization not yet migrated | TODO-21.C.7-DEFER-3 |

---

### 5.4 TODO-21.C.16: TilingPathToolLogic (Tiling Path Config)

**Source**: `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/TilingPathToolLogic.cs` (149 lines)
**Target**: `src/OpenRA.Mods.Common/Widgets/Logic/Editor/TilingPathToolLogic.ts`
**Complexity**: LOW

**Summary**: Configures the tiling path tool parameters — start type, inner type, end type, deviation slider, and options checkboxes. Activates/deactivates `EditorTilingPathBrush` based on tool panel visibility.

**Constructor parameters**: `(widget, world, modData, worldRenderer, logicArgs)`

**Key behaviors**:
1. **Three dropdowns**: Start type, inner type, end type — each populated from `TilingPathTool`'s type maps
2. **Inner type change cascades**: Changing inner type reconfigures start/end dropdown to load the correct subtypes
3. **Deviation slider**: Stepped slider controlling `tool.MaxDeviation`
4. **Allow end deviation checkbox**: Toggles `tool.AllowEndDeviation`
5. **Closed loops checkbox**: Toggles `tool.ClosedLoops`
6. **Reset button**: Clears path plan (sets to null)
7. **Reverse button**: Reverses the current path plan
8. **Randomize button**: `tool.SetRandomSeed(Environment.TickCount)` → uses `Date.now()` in TypeScript
9. **Paint button**: Creates `PaintTilingPathEditorAction` when paint source is available
10. **Brush activation**: When tool panel becomes visible (`TabSelected(true, widgetIsVisible)`), sets `EditorTilingPathBrush`; when hidden, clears brush
11. **Dropdown setup helper**: `SetupDropDown(dropDown, choices, read, write)` — generic function for all three dropdowns

**TypeScript approach**: `SetupDropDown` is a local helper function using `ScrollItemWidget.Setup` with `ShowDropDown` pattern. `MapToolsLogic.OnSelected` subscription provides visibility events. All button callbacks create editor actions via `editorActionManager.Add()`.

**Potential Pitfalls**:
- `TilingPathTool` is **NOT FULLY MIGRATED** (Phase B uses stub for `TilePlan()` — but the type configuration interfaces like `StartTypesByInner`, `EndTypesByInner`, `InnerTypes` should be available)
- `UpdateTilingPathPlanEditorAction` and `PaintTilingPathEditorAction` are Phase B action classes
- The `SetRandomSeed(Date.now())` replaces `Environment.TickCount` — acceptable for non-deterministic editor preview
- `PathPlan.Reversed()` must exist on the `PathPlan` class (migrated in Phase B)

---

## 6. Migration Order Recommendation

```
Step 1: LoadMapEditorLogic.ts (26 lines, ~0.5 hours)
  → Must be first — bootstraps widget tree root
  → 3 tests

Step 2: MapEditorLogic.ts (57 lines, ~1 hour)
  → Root controller — wires undo/redo, coords, cash
  → 5 tests

Step 3: MapEditorTabsLogic.ts (100 lines, ~1.5 hours)
  → Tab strip — needed by MapToolsLogic
  → 8 tests

Step 4: MapToolsLogic.ts (94 lines, ~1 hour)
  → Tool palette — needed by Wave 3 tool panels
  → 6 tests

Step 5: NewMapLogic.ts (84 lines, ~1 hour)
  → Standalone dialog, no dependencies on other Wave 1 files
  → 5 tests

Step 6: SaveMapLogic.ts (360 lines, ~3 hours)
  → Complex dialog, standalone in TRANSIENTS_PANEL
  → 12 tests

Step 7: EditorQuickSaveHotkeyLogic.ts (61 lines, ~1 hour)
  → Depends on SaveMapLogic static methods
  → 5 tests

=== Wave 1 complete: Root infrastructure ready (~44 tests) ===

Step 8: CommonSelectorLogic.ts (171 lines, ~2 hours)
  → Abstract base, needed by TileSelectorLogic and ActorSelectorLogic
  → 10 tests

Step 9: TileSelectorLogic.ts (144 lines, ~1.5 hours) ← PARALLEL with Step 10
  → 8 tests

Step 10: ActorSelectorLogic.ts (233 lines, ~2 hours) ← PARALLEL with Step 9
  → 10 tests

Step 11: LayerSelectorLogic.ts (79 lines, ~0.5 hours) ← PARALLEL with Steps 9-10
  → 5 tests

Step 12: ActorEditLogic.ts (602 lines, ~4 hours)
  → HIGH complexity — dynamic property grid + edit preview + IEditActorHandle
  → 18 tests

Step 13: MapEditorSelectionLogic.ts (152 lines, ~1.5 hours) ← PARALLEL with Step 12
  → 8 tests

Step 14: HistoryLogLogic.ts (69 lines, ~0.5 hours) ← PARALLEL with Steps 12-13
  → 5 tests

=== Wave 2 complete: Selectors + Editors ready (~64 tests) ===

Step 15: MapGeneratorToolLogic.ts (331 lines, ~2.5 hours) ← PARALLEL with Steps 16-18
  → 10 tests

Step 16: MapMarkerTilesLogic.ts (261 lines, ~2 hours) ← PARALLEL with Steps 15, 17-18
  → 10 tests

Step 17: MapOverlaysLogic.ts (130 lines, ~1 hour) ← PARALLEL with Steps 15-16, 18
  → 6 tests

Step 18: TilingPathToolLogic.ts (149 lines, ~1.5 hours) ← PARALLEL with Steps 15-17
  → 8 tests

=== Wave 3 complete: All panels migrated (~34 tests) ===

TOTAL: 18 files, ~25 hours, ~142 tests
```

---

## 7. Widget Tree Wiring Summary

All Phase C panels use the following widget access patterns:

| Pattern | Example | Notes |
|---------|---------|-------|
| **Direct child lookup** | `widget.get<ButtonWidget>("SAVE_BUTTON")` | Widget declared in YAML under this logic's parent |
| **Parent traversal** | `widget.parent.parent.get<EditorViewportControllerWidget>("MAP_EDITOR")` | Access widgets in parent containers |
| **Sibling panel lookup** | `widget.parent.parent.get("SELECT_WIDGETS").get("ACTOR_EDIT_PANEL")` | Access widgets in other tab containers |
| **Widget loading** | `Ui.LoadWidget("MAP_SAVE_VISIBILITY_PANEL", null, [])` | Dynamically loaded sub-panels |
| **Clone + attach** | `template.Clone()` → `container.AddChild(clone)` | Template pattern for lists and grids |
| **Panel attach/detach** | `dropdown.RemovePanel(); dropdown.AttachPanel(panel)` | Dropdown menus with lazy-created panels |
| **Widget.IsVisible binding** | `container.IsVisible = () => menuType === tabType` | Tab visibility via closure |
| **Widget.IsDisabled binding** | `button.IsDisabled = () => !actionManager.HasUndos()` | Button state via closure |
| **Widget.GetText binding** | `label.GetText = () => selectedDirectory.DisplayName` | Dynamic label via closure |

---

## 8. Data Flow Architecture

### 8.1 Core Data Flows

```
EditorActionManager (Phase A) — central mutable state
    │
    ├── Read by: MapEditorLogic (undo/redo buttons)
    ├── Read by: HistoryLogLogic (history list display)
    ├── Written by: EditorDefaultBrush (all mutations via IEditorAction)
    ├── Read by: EditorQuickSaveHotkeyLogic (Modified/SaveFailed flags)
    └── Written by: SaveMapLogic (Modified = false on save)

EditorDefaultBrush.Selection (Phase B) — current selection state
    │
    ├── Read by: MapEditorTabsLogic (auto-switch to Select tab)
    ├── Read by: MapEditorSelectionLogic (show actor/area edit panel)
    ├── Read by: ActorEditLogic (populate property grid)
    ├── Written by: MapEditorSelectionLogic (ClearSelection on cancel)
    └── Event flow: SelectionChanged → all listeners above

EditorCursorLayer / EditorViewportControllerWidget (Phase A) — brush management
    │
    ├── Read by: TileSelectorLogic (set EditorTileBrush on click)
    ├── Read by: ActorSelectorLogic (set EditorActorBrush on click)
    ├── Read by: LayerSelectorLogic (set EditorResourceBrush on click)
    ├── Read by: MapMarkerTilesLogic (set EditorMarkerLayerBrush on click)
    ├── Read by: TilingPathToolLogic (set EditorTilingPathBrush on enter)
    └── Read by: MapToolsLogic (IEditorTool panels load tool-specific brushes)

Map data (Map.Tiles, Map.Height, EditorResourceLayer) — persistent state
    │
    ├── Read by: MapEditorLogic (coordinate label)
    ├── Written by: NewMapLogic (map creation)
    ├── Read by: SaveMapLogic (map.Save())
    └── Written by: SaveMapLogic (map author/title)
```

### 8.2 Event Bus Pattern

Phase C uses a lightweight event system (callback arrays) rather than a formal event bus:

| Event Name | Source | Listeners | Data |
|-----------|--------|-----------|------|
| `SelectionChanged` | EditorDefaultBrush | MapEditorTabsLogic, MapEditorSelectionLogic, ActorEditLogic | None (listeners re-read Selection) |
| `UpdateSelectedTab` | EditorDefaultBrush | MapEditorTabsLogic | None (auto-switches tab) |
| `OnTabChanged` | MapEditorTabsLogic | MapToolsLogic | None |
| `OnSelected` | MapToolsLogic | TilingPathToolLogic | `boolean` (isVisible) |
| `ItemAdded` | EditorActionManager | HistoryLogLogic | `EditorActionContainer` |
| `ItemRemoved` | EditorActionManager | HistoryLogLogic | `EditorActionContainer` |
| `BrushChanged` | EditorViewportControllerWidget | MapMarkerTilesLogic | None |

---

## 9. Test Strategy

### 9.1 Unit Test Summary

All Phase C logic classes are pure widget wiring with no GPU dependencies — they can be fully unit-tested with mocked widget infrastructure.

| File | Est. Tests | Key Test Categories |
|------|:---:|------|
| LoadMapEditorLogic | 3 | Widget subtree loading |
| EditorQuickSaveHotkeyLogic | 5 | Hotkey activation, dirty check, save delegation |
| MapEditorLogic | 5 | Coordinate label text, cash label, undo/redo button wiring |
| MapEditorTabsLogic | 8 | Tab switching, auto-select, disabled checks, container visibility |
| MapToolsLogic | 6 | Tool panel loading, selection, tab change listener, dropdown |
| NewMapLogic | 5 | Cancel, tileset dropdown, create (map dimensions, bounds, player defs) |
| SaveMapLogic | 12 | Field validation, visibility options, directory selection, file type, save path, overwrite detection, error handling |
| CommonSelectorLogic | 10 | Category filter panel, search, selection change, item setup |
| TileSelectorLogic | 8 | Template filtering, category ordering, preview scaling, brush setting |
| ActorSelectorLogic | 10 | Owner dropdown, actor filtering, tileset exclusion, owner change brush update, player removal fallback |
| LayerSelectorLogic | 5 | Resource type iteration, preview rendering, brush setting |
| ActorEditLogic | 18 | Property grid generation, owner dropdown, checkbox/slider/dropdown/text option types, actor ID validation, dirty tracking, save/cancel/delete, IsChangingSelection guard, SetActorIdAction |
| MapEditorSelectionLogic | 8 | Panel visibility toggle, copy/paste buttons, filters, selection info labels, EditorBlit integration |
| HistoryLogLogic | 5 | ItemAdded/ItemRemoved event handling, click-to-rewind, status-based coloring |
| MapGeneratorToolLogic | 10 | Form generation (4 option types), generate/random buttons, error display, settings UI update on PlayerCount change |
| MapMarkerTilesLogic | 10 | Color swatch grid, erase, alpha slider, mirror mode dropdown, num sides, axis angle, clear buttons, brush change listener |
| MapOverlaysLogic | 6 | Hotkey registration, overlay toggle, dropdown panel creation |
| TilingPathToolLogic | 8 | Three dropdowns, inner type cascade, deviation slider, checkboxes, reset/reverse/randomize/paint buttons, brush activation on tab select |
| **TOTAL** | **~142** | |

### 9.2 Mock Dependencies

| Dependency to Mock | Mock Behavior |
|-------------------|---------------|
| `Widget` / `Widget.parent` | Provide mock child widgets with spy properties (`isDisabled`, `isVisible`, `getText`, `onClick`) |
| `EditorViewportControllerWidget` | Mock `defaultBrush.Selection`, `currentBrush`, `setBrush()`, `clearBrush()`, `clearSelection()` |
| `EditorActionManager` | Mock `add()`, `undo()`, `redo()`, `hasUndos()`, `hasRedos()`, `modified`, `saveFailed`, event callbacks |
| `EditorActorLayer` | Mock `Players`, `remove()`, `add()`, indexer lookup |
| `WorldRenderer` / `Viewport` | Mock `ViewToWorld()`, `LastMousePos` |
| `ModData` | Mock `MapCache.MapLocations`, `DefaultTerrainInfo`, `Hotkeys` |
| `World` / `Map` | Mock `Map.Tiles`, `Map.Height`, `Map.Grid`, `Map.Rules`, `Map.Package`, `Map.Uid` |
| `ScrollItemWidget.Setup()` | Mock to return `ScrollItemWidget` with spy `onClick` |
| `EditorBlit` | Mock `CopyRegionContents()` returning test `EditorBlitSource` |
| `TilingPathTool` | Mock `StartTypesByInner`, `EndTypesByInner`, `InnerTypes`, `StartType`, `EndType`, etc. |
| `MarkerLayerOverlay` | Mock `Info.Colors`, `TileAlpha`, `MirrorMode`, `NumSides`, `AxisAngle`, `Enabled` |

---

## 10. Deferred Items

| # | Feature / File | Reason | TODO Ref | Phase C Blocker? |
|:---:|----------------|--------|----------|:---:|
| 1 | `FluentProvider` localization | Not yet migrated; hardcode English strings | TODO-21.C-DEFER-1 | No |
| 2 | `ConfirmationDialogs.ButtonPrompt` | Dialog system not yet migrated; use `window.confirm()` | TODO-21.C-DEFER-2 | No |
| 3 | `TextNotificationsManager.AddTransientLine` | Notification system not yet migrated; use `console.log()` | TODO-21.C-DEFER-3 | No |
| 4 | `ITemplatedTerrainInfo` (terrain templates) | Map generator terrain not yet migrated | TODO-21.C-DEFER-4 | Only for TileSelectorLogic |
| 5 | `TerrainTemplatePreviewWidget` | Terrain preview widget not yet migrated | TODO-21.C-DEFER-5 | Only for TileSelectorLogic |
| 6 | `ActorPreviewWidget` | Actor preview widget not yet migrated | TODO-21.C-DEFER-6 | Only for ActorSelectorLogic |
| 7 | `IActorPreviewInitInfo` | Actor preview init pipeline not yet migrated | TODO-21.C-DEFER-7 | Only for ActorSelectorLogic |
| 8 | `IEditorActorOptions` interface | Trait info option system not yet migrated | TODO-21.C-DEFER-8 | Only for ActorEditLogic property grid |
| 9 | `IResourceRenderer.ResourceTypes` | Resource renderer not yet migrated | TODO-21.C-DEFER-9 | Only for LayerSelectorLogic |
| 10 | `ResourcePreviewWidget` | Resource preview widget not yet migrated | TODO-21.C-DEFER-10 | Only for LayerSelectorLogic |
| 11 | `MapGenerator` namespace | Map generator not yet migrated | TODO-21.C-DEFER-11 | Only for MapGeneratorToolLogic |
| 12 | `MarkerLayerOverlay` full trait | Marker overlay not yet migrated | TODO-21.C-DEFER-12 | Only for MapMarkerTilesLogic + MapOverlaysLogic |
| 13 | `TerrainGeometryOverlay` / `BuildableTerrainOverlay` | Editor overlay traits not yet migrated | TODO-21.C-DEFER-13 | Only for MapOverlaysLogic |
| 14 | `TilingPathTool.TilePlan()` (stubbed) | MapGenerator.TilingPath not yet migrated | TODO-21.C-DEFER-14 | Only for TilingPathToolLogic (Paint button) |
| 15 | `ZipFileLoader.Create` (writeable ZIP) | ZIP write support not yet available | TODO-21.C-DEFER-15 | Only for SaveMapLogic/NewMapLogic |
| 16 | `Platform.ResolvePath` / `Platform.SupportDir` | Filesystem APIs not in browser | TODO-21.C-DEFER-16 | Only for SaveMapLogic |

**Phase C MVP scope**: Files 1-8, 9-14 (all Wave 1 + Wave 2). Wave 3 tools (MapGeneratorToolLogic, MapMarkerTilesLogic, MapOverlaysLogic, TilingPathToolLogic) are deferrable for MVP since they depend on unmigrated tool traits. The downloadable map save (via browser download API) replaces SaveMapLogic's filesystem path logic.
