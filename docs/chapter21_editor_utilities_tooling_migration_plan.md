# OpenRA to Babylon.js Migration Plan: Chapter 21 -- Editor, Utilities & Tooling

> **Source Reference**: `OpenRA/OpenRA.Mods.Common/EditorBrushes/`, `OpenRA/OpenRA.Mods.Common/Widgets/Logic/Editor/`, `OpenRA/OpenRA.Game/UtilityCommands/`, `OpenRA/OpenRA.Mods.Common/UtilityCommands/`, `OpenRA/OpenRA.Mods.Cnc/UtilityCommands/`, `OpenRA/OpenRA.Mods.D2k/UtilityCommands/`
> **Chapter Status**: PLANNING (0/~73 migrated, 0%)
> **Planning Date**: 2026-06-18
> **Prerequisite**: Chapters 2-19 COMPLETE (603/603, 100%). Chapter 20 Scripting System (62/62, 100%, ALL PHASES A-G COMPLETE). Editor Phases A-C and Debug Phase D can begin with Ch2-19. Utility command Phases E-G benefit from Ch20's `ScriptRegistry` for scripting-aware tooling.
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Editor Core Infrastructure](#31-phase-a-editor-core-infrastructure)
   - 3.2 [Phase B: Editor Brushes](#32-phase-b-editor-brushes)
   - 3.3 [Phase C: Editor UI Logic](#33-phase-c-editor-ui-logic)
   - 3.4 [Phase D: Debug & Developer Tools](#34-phase-d-debug--developer-tools)
   - 3.5 [Phase E: Utility Commands — Core Build Tools](#35-phase-e-utility-commands--core-build-tools)
   - 3.6 [Phase F: Utility Commands — Documentation & Export](#36-phase-f-utility-commands--documentation--export)
   - 3.7 [Phase G: Legacy Map Import Tools (C&C / D2K)](#37-phase-g-legacy-map-import-tools-cc--d2k)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

Chapter 21 is the **final chapter** of the OpenRAWeb3D migration. It covers the Map Editor (a fully functional WYSIWYG editor for creating and modifying OpenRA maps), Developer Tools (debug overlays, cheat commands, visualization toggles), and Utility Commands (CLI build tools for asset conversion, mod management, documentation generation, and legacy map import).

The core paradigm shifts:

- **C# WinForms/OpenGL Map Editor** → **Babylon.js browser-based 3D Map Editor**: The OpenRA editor uses C# widgets + OpenGL rendering within a WinForms-style layout. The TypeScript migration leverages the existing Chapter 5 Widget system (already migrated) + Babylon.js scene for 3D terrain rendering. The editor runs entirely in the browser.
- **C# CLI `OpenRA.Utility.exe`** → **Node.js/Vite CLI scripts**: OpenRA's standalone utility program (`OpenRA.Utility/Program.cs`) processes command-line arguments and dispatches to `IUtilityCommand` implementations. In TypeScript, these become Node.js scripts run via `npx` or Vite plugins, with browser-compatible alternatives for tools that need WebGL (sprite sheet dumping, PNG conversion).
- **C# Undo/Redo Stack** → **TypeScript Command Pattern**: `EditorActionManager` uses a classic stack-based undo/redo pattern. The TypeScript version preserves this exact pattern — each editor action is a serializable command object.
- **C# Editor Brushes (2D mouse interaction)** → **Babylon.js 3D Pick + Grid Snap**: Editor brushes use 2D viewport mouse coordinates mapped to map cells. TypeScript uses `scene.pick()` raycasting onto the terrain mesh with grid snapping to cell coordinates.
- **C# .NET Reflection-based Command Dispatch** → **TypeScript Explicit Command Registry**: OpenRA's `Utility` class uses reflection to discover `IUtilityCommand` implementations. TypeScript uses an explicit `Map<string, IUtilityCommand>` registry.

### 1.2 Architecture Principles

1. **Editor as a Mode, not a Separate Application**: The map editor reuses the existing game engine (Renderer, WorldRenderer, Widget system, Map, Terrain) with editor-specific traits and UI widgets. There is no separate "editor executable" — the editor is a mode toggle within the main application. This mirrors OpenRA's architecture where the editor shares the same process as the game.

2. **Editor Brush Abstraction**: All editor tools implement the `IEditorBrush` interface (`handleMouseInput()`, `tick()`, `tickRender()`, `renderAboveShroud()`, `renderAnnotations()`). Each brush is a self-contained TypeScript class that receives mouse events and produces `IEditorAction` commands for the undo/redo stack.

3. **Undo/Redo as Serialized Commands**: Every mutation to the map (tile changes, actor placement, resource modification) goes through `EditorActionManager.add(IEditorAction)`. Actions must be serializable and reversible — each action provides `execute()` and `undo()`. This pattern guarantees correctness and enables save-before-quit prompts.

4. **Editor World Isolation**: Editor traits (`EditorActorLayer`, `EditorCursorLayer`, `EditorResourceLayer`) attach to a special `EditorWorld` variant of the standard `World`. Editor actors are lightweight previews (`EditorActorPreview`) that are NOT full `GameActor` instances — they render visually but have no game logic. This separation prevents accidental game simulation during editing.

5. **Build Tools as Standalone Scripts**: Utility commands that process files (sprite sheet dumping, YAML validation, map import/conversion) are standalone Node.js scripts or Vite plugins. They do NOT bundle into the browser app. Only developer debugging tools (DevCommands, DebugVisualizations) load at runtime.

6. **Legacy Map Import as Optional Modules**: C&C / D2K legacy map import tools are heavy (~3,000+ lines across 13 files) and NOT required for MVP. They are loaded via dynamic `import()` only when the user explicitly imports a legacy map format. This keeps the base bundle size small.

7. **Editor UI Leverages Existing Widget System**: Editor UI panels (actor selector, tile selector, tool palette, history log, save dialog) are built with the existing Chapter 16 Widget extensions (`LabelWidget`, `ButtonWidget`, `SliderWidget`, `ScrollPanelWidget`, `TextFieldWidget`, etc.). No new widget base classes are needed.

8. **3D Editor Viewport with Grid Snapping**: The editor viewport renders the map in 3D via Babylon.js. Mouse-to-cell mapping uses `scene.pick(ray)` on the terrain mesh, with the hit point snapped to the nearest cell grid. A visual cursor grid overlay indicates the current selection/hover cell.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-20 is available for Chapter 21:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Renderer + WorldRenderer | Ch2 | `Renderer`, `WorldRenderer`, scene graph, post-processing |
| Sprite/Sheet/Animation | Ch2 | `Sprite`, `Sheet`, `Animation`, sprite rendering pipeline |
| World + Actor + Player | Ch3 | `GameActor`, `GameWorldManager`, `Player`, trait attachment |
| TraitDictionary + TraitsInterfaces | Ch3 | `TraitDictionary`, `ITick`, `INotifyCreated`, `IRender` |
| Map + Terrain + Pathfinding | Ch4 | `Map`, `TerrainData`, HPA* pathfinder, `TerrainMeshBuilder` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `cellToVector3()`, WDist↔world-space |
| MiniYAML pipeline | Ch4 Phase H | `miniyaml-to-json.ts` — YAML→JSON build-time conversion |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest`, `IPackage` |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` |
| WorldInteractionControllerWidget | Ch5 Phase E | Click-to-target, order generation bridge |
| Order + Connection + OrderManager | Ch6 | `Order`, `UnitOrders`, `OrderManager` — editor reuses for actor placement |
| Ruleset container | Ch6 Phase C | `Ruleset`, `ActorInfo` — editor browses available actor types |
| Input + Camera + Selection | Ch7 Phases A-C | `InputHandler`, `Viewport`, `SelectionUtils` |
| Effects + Projectile base | Ch7 Phases E-F | Visual effect infrastructure (no projectiles in editor) |
| Weapon & Combat | Ch8 | Armament, Turreted — editor previews weapon ranges |
| Movement & Physics | Ch9 | Mobile trait — editor previews movement and blocking |
| Resource & Economy | Ch10 | ResourceLayer — editor modifies resource placement |
| Production & Building | Ch11 | Building, ProductionQueue — editor places buildings |
| Shroud & Fog of War | Ch12 | Shroud — disabled in editor mode |
| Support Powers | Ch13 | SupportPower — editor configures power placement |
| Activities | Ch14 | Activity system — not active in editor mode |
| Order Generators | Ch15 | IOrderGenerator — editor brushes replace order generators |
| UI Widget Extensions | Ch16 | Full widget toolkit for editor UI panels |
| Replay & Save | Ch17 | Replay system — editor uses save/load infrastructure |
| Server System | Ch18 | Not needed for single-player editor |
| Mod Content | Ch19 | Sprite loaders, asset pipelines — editor browses all assets |
| Scripting | Ch20 | Scripting API — editor can preview script triggers |

### 1.4 Files NOT to Migrate (Deferred or NOP)

| File | Reason for Non-Migration |
|------|--------------------------|
| `OpenRA.Utility/Program.cs` (472 lines) | Top-level CLI entry point is replaced by `scripts/` directory with individual Node.js scripts and `package.json` script entries. The command dispatch pattern (`Utility.Run()`) is reimplemented in `UtilityRunner.ts`. |
| `OpenRA.Mods.Common/UpdateRules/` (update migration rules) | These are C#-specific YAML→YAML migration rules for upgrading old mod files. In TypeScript, mod updates use JSON schema migration. Deferred until mod ecosystem matures. |
| `OpenRA.Mods.Common/MapGenerator/MultiBrush.cs` | Absorbed into `MapGeneratorToolLogic.ts` as a helper class. The C# MultiBrush is a thin random-selection wrapper. |
| `OpenRA.Mods.Common/UtilityCommands/ListInstallShieldCabContentsCommand.cs` | InstallShield CAB is a legacy Windows installer format. Not needed for web deployment. NOP. |
| `OpenRA.Mods.Common/UtilityCommands/ListMSCabContentsCommand.cs` | Microsoft CAB format, same as above. NOP. |
| `EditorHotkeys` (scattered across hotkey logic files) | Absorbed into the existing Ch7 hotkey system (`HotkeyReference.ts`, `HotkeyManager`). Editor-specific hotkeys register at editor mode activation. |

### 1.5 Editor Mode vs Game Mode Architecture

The Map Editor shares the same Babylon.js engine, scene, and widget tree as the game. Toggling between editor mode and game mode involves:

```
Game Mode:                         Editor Mode:
  World (simulated)                 EditorWorld (static, no simulation)
  ├── ActorLayer (live actors)      ├── EditorActorLayer (preview actors)
  ├── ResourceLayer (gameplay)      ├── EditorResourceLayer (editable)
  ├── Shroud (active FOW)           ├── Shroud = disabled (full reveal)
  ├── Player: human + AI            ├── Player: editor-only (GodMode)
  ├── ITick → game ticks            ├── ITick → editor ticks (no sim)
  └── Widgets: game UI              └── Widgets: editor panels + tool palette
```

The key isolation mechanism: `EditorWorld` extends `World` but overrides `tick()` to skip simulation. The trait dictionary is populated with editor-specific traits instead of gameplay traits. Actor previews are render-only (no components, no activities, no AI).

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (~73 files across 7 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Editor Core Infrastructure** | | | | | |
| 1 | `OpenRA.Mods.Common/Traits/World/EditorActionManager.cs` | `src/OpenRA.Mods.Common/Traits/World/EditorActionManager.ts` | `EditorActionManager` | 189 | MEDIUM | A |
| 2 | `OpenRA.Mods.Common/Traits/World/EditorActorLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/EditorActorLayer.ts` | `EditorActorLayer` | 495 | HIGH | A |
| 3 | `OpenRA.Mods.Common/Traits/World/EditorActorPreview.cs` | `src/OpenRA.Mods.Common/Traits/World/EditorActorPreview.ts` | `EditorActorPreview` | 333 | MEDIUM | A |
| 4 | `OpenRA.Mods.Common/Traits/World/EditorCursorLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/EditorCursorLayer.ts` | `EditorCursorLayer` | 53 | LOW | A |
| 5 | `OpenRA.Mods.Common/Traits/World/EditorResourceLayer.cs` | `src/OpenRA.Mods.Common/Traits/World/EditorResourceLayer.ts` | `EditorResourceLayer` | 313 | MEDIUM | A |
| 6 | `OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.ts` | `EditorViewportControllerWidget` | 132 | LOW | A |
| 7 | `OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.cs` | `src/OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.ts` | `EditorSelectionAnnotationRenderable` | 79 | LOW | A |
| 8 | `OpenRA.Mods.Common/Traits/MapEditorData.cs` | `src/OpenRA.Mods.Common/Traits/MapEditorData.ts` | `MapEditorData` | 26 | LOW | A |
| **Phase B: Editor Brushes** | | | | | |
| 9 | *(IEditorBrush interface, in EditorDefaultBrush.cs)* | `src/OpenRA.Mods.Common/EditorBrushes/IEditorBrush.ts` | `IEditorBrush` (interface) | ~30 | LOW | B |
| 10 | `OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.ts` | `EditorDefaultBrush` | 627 | HIGH | B |
| 11 | `OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.ts` | `EditorTileBrush` | 383 | MEDIUM | B |
| 12 | `OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.ts` | `EditorActorBrush` | 180 | MEDIUM | B |
| 13 | `OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.ts` | `EditorResourceBrush` | 161 | LOW | B |
| 14 | `OpenRA.Mods.Common/EditorBrushes/EditorBlit.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorBlit.ts` | `EditorBlit` (terrain copy tool) | 363 | MEDIUM | B |
| 15 | `OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.ts` | `EditorCopyPasteBrush` | 174 | LOW | B |
| 16 | `OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.ts` | `EditorMarkerLayerBrush` | 265 | MEDIUM | B |
| 17 | `OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.cs` | `src/OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.ts` | `EditorTilingPathBrush` | 380 | MEDIUM | B |
| 18 | `OpenRA.Mods.Common/Traits/World/TilingPathTool.cs` | `src/OpenRA.Mods.Common/Traits/World/TilingPathTool.ts` | `TilingPathTool` | 580 | HIGH | B |
| **Phase C: Editor UI Logic** | | | | | |
| 19 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.ts` | `MapEditorLogic` | 57 | LOW | C |
| 20 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorSelectionLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorSelectionLogic.ts` | `MapEditorSelectionLogic` | 152 | LOW | C |
| 21 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorTabsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorTabsLogic.ts` | `MapEditorTabsLogic` | 100 | LOW | C |
| 22 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapToolsLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapToolsLogic.ts` | `MapToolsLogic` | 94 | LOW | C |
| 23 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapGeneratorToolLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapGeneratorToolLogic.ts` | `MapGeneratorToolLogic` | 331 | MEDIUM | C |
| 24 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapMarkerTilesLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapMarkerTilesLogic.ts` | `MapMarkerTilesLogic` | 261 | MEDIUM | C |
| 25 | `OpenRA.Mods.Common/Widgets/Logic/Editor/MapOverlaysLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapOverlaysLogic.ts` | `MapOverlaysLogic` | 130 | LOW | C |
| 26 | `OpenRA.Mods.Common/Widgets/Logic/Editor/NewMapLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/NewMapLogic.ts` | `NewMapLogic` | 84 | LOW | C |
| 27 | `OpenRA.Mods.Common/Widgets/Logic/Editor/SaveMapLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/SaveMapLogic.ts` | `SaveMapLogic` | 360 | MEDIUM | C |
| 28 | `OpenRA.Mods.Common/Widgets/Logic/Editor/ActorEditLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorEditLogic.ts` | `ActorEditLogic` | 602 | HIGH | C |
| 29 | `OpenRA.Mods.Common/Widgets/Logic/Editor/ActorSelectorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorSelectorLogic.ts` | `ActorSelectorLogic` | 233 | MEDIUM | C |
| 30 | `OpenRA.Mods.Common/Widgets/Logic/Editor/TileSelectorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/TileSelectorLogic.ts` | `TileSelectorLogic` | 144 | LOW | C |
| 31 | `OpenRA.Mods.Common/Widgets/Logic/Editor/LayerSelectorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/LayerSelectorLogic.ts` | `LayerSelectorLogic` | 79 | LOW | C |
| 32 | `OpenRA.Mods.Common/Widgets/Logic/Editor/CommonSelectorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/CommonSelectorLogic.ts` | `CommonSelectorLogic` | 171 | LOW | C |
| 33 | `OpenRA.Mods.Common/Widgets/Logic/Editor/HistoryLogLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/HistoryLogLogic.ts` | `HistoryLogLogic` | 69 | LOW | C |
| 34 | `OpenRA.Mods.Common/Widgets/Logic/Editor/TilingPathToolLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Editor/TilingPathToolLogic.ts` | `TilingPathToolLogic` | 149 | LOW | C |
| 35 | `OpenRA.Mods.Common/Widgets/Logic/Ingame/LoadMapEditorLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Ingame/LoadMapEditorLogic.ts` | `LoadMapEditorLogic` | 26 | LOW | C |
| 36 | `OpenRA.Mods.Common/Widgets/Logic/Ingame/Hotkeys/EditorQuickSaveHotkeyLogic.cs` | `src/OpenRA.Mods.Common/Widgets/Logic/Ingame/Hotkeys/EditorQuickSaveHotkeyLogic.ts` | `EditorQuickSaveHotkeyLogic` | 61 | LOW | C |
| **Phase D: Debug & Developer Tools** | | | | | |
| 35 | `OpenRA.Game/IUtilityCommand.cs` | `src/OpenRA.Game/IUtilityCommand.ts` | `IUtilityCommand` (interface) | 69 | LOW | D |
| 36 | `OpenRA.Game/Traits/World/DebugVisualizations.cs` | `src/OpenRA.Game/Traits/World/DebugVisualizations.ts` | `DebugVisualizations` | 70 | LOW | D |
| 37 | `OpenRA.Mods.Common/Commands/DebugVisualizationCommands.cs` | `src/OpenRA.Mods.Common/Commands/DebugVisualizationCommands.ts` | `DebugVisualizationCommands` | 155 | LOW | D |
| 38 | `OpenRA.Mods.Common/Commands/DevCommands.cs` | `src/OpenRA.Mods.Common/Commands/DevCommands.ts` | `DevCommands` | 318 | MEDIUM | D |
| 39 | `OpenRA.Mods.Common/Traits/Player/DeveloperMode.cs` | `src/OpenRA.Mods.Common/Traits/Player/DeveloperMode.ts` | `DeveloperMode` | 342 | MEDIUM | D |
| 40 | `OpenRA.Mods.Common/Traits/Render/RenderSpritesEditorOnly.cs` | `src/OpenRA.Mods.Common/Traits/Render/RenderSpritesEditorOnly.ts` | `RenderSpritesEditorOnly` | 30 | LOW | D |
| 41 | `OpenRA.Mods.Common/Traits/Render/CustomTerrainDebugOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/CustomTerrainDebugOverlay.ts` | `CustomTerrainDebugOverlay` | 116 | LOW | D |
| **Phase E: Utility Commands — Core Build Tools** | | | | | |
| 42 | `OpenRA.Mods.Common/UtilityCommands/LintInterfaces.cs` | `src/OpenRA.Mods.Common/UtilityCommands/LintInterfaces.ts` | `ILintPass`, `ILintMapPass`, `ILintRulesPass` (interfaces) | 21 | LOW | E |
| 43 | *(N/A — new file)* | `src/OpenRA.Game/UtilityRunner.ts` | `UtilityRunner` (command dispatcher) | — | MEDIUM | E |
| 43 | `OpenRA.Game/UtilityCommands/RegisterModCommand.cs` | `src/OpenRA.Game/UtilityCommands/RegisterModCommand.ts` | `RegisterModCommand` | 47 | LOW | E |
| 44 | `OpenRA.Game/UtilityCommands/UnregisterModCommand.cs` | `src/OpenRA.Game/UtilityCommands/UnregisterModCommand.ts` | `UnregisterModCommand` | 43 | LOW | E |
| 45 | `OpenRA.Game/UtilityCommands/ClearInvalidModRegistrationsCommand.cs` | `src/OpenRA.Game/UtilityCommands/ClearInvalidModRegistrationsCommand.ts` | `ClearInvalidModRegistrationsCommand` | 47 | LOW | E |
| 46 | `OpenRA.Mods.Common/UtilityCommands/UpdateModCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/UpdateModCommand.ts` | `UpdateModCommand` | 294 | MEDIUM | E |
| 47 | `OpenRA.Mods.Common/UtilityCommands/MapCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/MapCommand.ts` | `MapCommand` | 91 | LOW | E |
| 48 | `OpenRA.Mods.Common/UtilityCommands/ResizeMapCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ResizeMapCommand.ts` | `ResizeMapCommand` | 72 | LOW | E |
| 49 | `OpenRA.Mods.Common/UtilityCommands/UpdateMapCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/UpdateMapCommand.ts` | `UpdateMapCommand` | 162 | LOW | E |
| 50 | `OpenRA.Mods.Common/UtilityCommands/GetMapHashCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/GetMapHashCommand.ts` | `GetMapHashCommand` | 31 | LOW | E |
| 51 | `OpenRA.Mods.Common/UtilityCommands/ExtractMapRules.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ExtractMapRules.ts` | `ExtractMapRules` | 126 | LOW | E |
| 52 | `OpenRA.Mods.Common/UtilityCommands/ExtractFilesCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ExtractFilesCommand.ts` | `ExtractFilesCommand` | 43 | LOW | E |
| 53 | `OpenRA.Mods.Common/UtilityCommands/ConvertSpriteToPngCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ConvertSpriteToPngCommand.ts` | `ConvertSpriteToPngCommand` | 104 | LOW | E |
| 54 | `OpenRA.Mods.Common/UtilityCommands/DumpSequenceSheetsCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/DumpSequenceSheetsCommand.ts` | `DumpSequenceSheetsCommand` | 174 | MEDIUM | E |
| 55 | `OpenRA.Mods.Common/UtilityCommands/ExtractChromeStrings.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ExtractChromeStrings.ts` | `ExtractChromeStrings` | 386 | MEDIUM | E |
| 56 | `OpenRA.Mods.Common/UtilityCommands/ExtractYamlStrings.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ExtractYamlStrings.ts` | `ExtractYamlStrings` | 411 | MEDIUM | E |
| 57 | `OpenRA.Mods.Common/UtilityCommands/CheckYaml.cs` | `src/OpenRA.Mods.Common/UtilityCommands/CheckYaml.ts` | `CheckYaml` | 219 | MEDIUM | E |
| 58 | `OpenRA.Mods.Common/UtilityCommands/CheckMissingSprites.cs` | `src/OpenRA.Mods.Common/UtilityCommands/CheckMissingSprites.ts` | `CheckMissingSprites` | 100 | LOW | E |
| 59 | `OpenRA.Mods.Common/UtilityCommands/CheckExplicitInterfacesCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/CheckExplicitInterfacesCommand.ts` | `CheckExplicitInterfacesCommand` | 153 | LOW | E |
| 60 | `OpenRA.Mods.Common/UtilityCommands/CheckConditionalTraitInterfaceOverrides.cs` | `src/OpenRA.Mods.Common/UtilityCommands/CheckConditionalTraitInterfaceOverrides.ts` | `CheckConditionalTraitInterfaceOverrides` | 98 | LOW | E |
| 61 | `OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.cs` | `src/OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.ts` | `UtilityHelpers` | 53 | LOW | E |
| 62 | `OpenRA.Mods.Common/UtilityCommands/ReplayMetadataCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/ReplayMetadataCommand.ts` | `ReplayMetadataCommand` | 50 | LOW | E |
| **Phase F: Utility Commands — Documentation & Export** | | | | | |
| 62 | `OpenRA.Mods.Common/UtilityCommands/CreateManPage.cs` | `src/OpenRA.Mods.Common/UtilityCommands/CreateManPage.ts` | `CreateManPage` | 109 | LOW | F |
| 63 | `OpenRA.Mods.Common/UtilityCommands/OutputResolvedRulesCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/OutputResolvedRulesCommand.ts` | `OutputResolvedRulesCommand` | 55 | LOW | F |
| 64 | `OpenRA.Mods.Common/UtilityCommands/OutputResolvedSequencesCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/OutputResolvedSequencesCommand.ts` | `OutputResolvedSequencesCommand` | 55 | LOW | F |
| 65 | `OpenRA.Mods.Common/UtilityCommands/OutputResolvedWeaponsCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/OutputResolvedWeaponsCommand.ts` | `OutputResolvedWeaponsCommand` | 55 | LOW | F |
| 66 | `OpenRA.Mods.Common/UtilityCommands/DebugChromeRegions.cs` | `src/OpenRA.Mods.Common/UtilityCommands/DebugChromeRegions.ts` | `DebugChromeRegions` | 185 | LOW | F |
| 67 | `OpenRA.Mods.Common/UtilityCommands/Documentation/DocumentationHelpers.cs` | `src/OpenRA.Mods.Common/UtilityCommands/Documentation/DocumentationHelpers.ts` | `DocumentationHelpers` | 205 | MEDIUM | F |
| 68 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractEmmyLuaAPI.cs` | *(deferred — LuaDoc only, absorbed into Ch20 scripting docs)* | — | 478 | — | — |
| 69 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractLuaDocsCommand.cs` | *(deferred — LuaDoc generation, non-essential for web)* | — | 210 | — | — |
| 70 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractSettingsDocsCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractSettingsDocsCommand.ts` | `ExtractSettingsDocsCommand` | 112 | LOW | F |
| 71 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractSpriteSequenceDocsCommand.cs` | *(deferred — build-time docs gen, optional)* | — | 103 | — | — |
| 72 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractTraitDocsCommand.cs` | *(deferred — build-time docs gen, optional)* | — | 91 | — | — |
| 73 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractWeaponDocsCommand.cs` | *(deferred — build-time docs gen, optional)* | — | 85 | — | — |
| 74 | `OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractZeroBraneStudioLuaAPI.cs` | *(deferred — IDE-specific tool, NOP for web)* | — | 146 | — | — |
| **Phase G: Legacy Map Import Tools (C&C / D2K)** | | | | | |
| 75 | `OpenRA.Mods.Common/UtilityCommands/Rgba2Hex.cs` | `src/OpenRA.Mods.Common/UtilityCommands/Rgba2Hex.ts` | `Rgba2Hex` | 286 | LOW | G |
| 76 | `OpenRA.Mods.Common/UtilityCommands/PngSheetExportMetadataCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/PngSheetExportMetadataCommand.ts` | `PngSheetExportMetadataCommand` | 38 | LOW | G |
| 77 | `OpenRA.Mods.Common/UtilityCommands/PngSheetImportMetadataCommand.cs` | `src/OpenRA.Mods.Common/UtilityCommands/PngSheetImportMetadataCommand.ts` | `PngSheetImportMetadataCommand` | 68 | LOW | G |
| 78 | `OpenRA.Mods.Cnc/UtilityCommands/ConvertPngToShpCommand.cs` | `src/OpenRA.Mods.Cnc/UtilityCommands/ConvertPngToShpCommand.ts` | `ConvertPngToShpCommand` | 59 | LOW | G |
| 79 | `OpenRA.Mods.Cnc/UtilityCommands/Glob.cs` | `src/OpenRA.Mods.Cnc/UtilityCommands/Glob.ts` | `Glob` (file glob utility) | 127 | LOW | G |
| 80 | `OpenRA.Mods.Cnc/UtilityCommands/RemapShpCommand.cs` | `src/OpenRA.Mods.Cnc/UtilityCommands/RemapShpCommand.ts` | `RemapShpCommand` | 89 | LOW | G |
| 81 | `OpenRA.Mods.Cnc/Traits/World/TSEditorResourceLayer.cs` | *(deferred — C&C TS vein resource adjacency; only needed if TS mod content from Ch19 is completed)* | — | 117 | — | — |
| 82 | `OpenRA.Mods.Cnc/UtilityCommands/LegacyRulesImporter.cs` | *(deferred — C&C legacy rules conversion, Phase G optional)* | — | 208 | — | — |
| 83 | `OpenRA.Mods.Cnc/UtilityCommands/LegacySequenceImporter.cs` | *(deferred — C&C legacy sequences, Phase G optional)* | — | 275 | — | — |
| 84 | `OpenRA.Mods.Cnc/UtilityCommands/LegacyTilesetImporter.cs` | *(deferred — C&C legacy tileset, Phase G optional)* | — | 192 | — | — |
| 85 | `OpenRA.Mods.Cnc/UtilityCommands/ImportGen1MapCommand.cs` | *(deferred — C&C1 legacy map import)* | — | 506 | — | — |
| 86 | `OpenRA.Mods.Cnc/UtilityCommands/ImportGen2MapCommand.cs` | *(deferred — RA1 legacy map import)* | — | 579 | — | — |
| 87 | `OpenRA.Mods.Cnc/UtilityCommands/ImportRedAlertMapCommand.cs` | *(deferred — RA1 map import helper)* | — | 253 | — | — |
| 88 | `OpenRA.Mods.Cnc/UtilityCommands/ImportTiberianDawnMapCommand.cs` | *(deferred — TD map import)* | — | 186 | — | — |
| 89 | `OpenRA.Mods.Cnc/UtilityCommands/ImportTiberianSunMapCommand.cs` | *(deferred — TS map import)* | — | 334 | — | — |
| 90 | `OpenRA.Mods.D2k/UtilityCommands/D2kMapImporter.cs` | *(deferred — Dune 2000 map import)* | — | 530 | — | — |
| 91 | `OpenRA.Mods.D2k/UtilityCommands/ImportD2kMapCommand.cs` | *(deferred — D2K map import CLI)* | — | 44 | — | — |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with minimal dependencies. 25-175 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple trait interactions or UI integration. 100-400 lines of C#.
> - **HIGH**: Complex logic with state machines, spatial queries, or multi-widget coordination. 400-630 lines of C#.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 91 (54 active + 25 deferred/absorbed/NOP + 12 legacy deferred import) |
| **Phase A (Editor Core)** | 8 files |
| **Phase B (Editor Brushes)** | 10 files (9 brushes + 1 interface) |
| **Phase C (Editor UI Logic)** | 18 files (16 core + 2 additional widget logic) |
| **Phase D (Debug & Dev Tools)** | 7 files |
| **Phase E (Core Build Tools)** | 22 files (21 commands + 1 new UtilityRunner) |
| **Phase F (Documentation & Export)** | 13 files (7 active + 6 deferred; plus 5 Documentation/Objects/ data classes absorbed into DocumentationHelpers.ts) |
| **Phase G (Legacy Map Import)** | 17 files (6 active + 1 TS-specific deferred + 10 legacy import deferred) |
| **HIGH complexity** | 5 files (EditorActorLayer, EditorDefaultBrush, TilingPathTool, ActorEditLogic, SaveMapLogic) |
| **MEDIUM complexity** | 18 files |
| **LOW complexity** | 68 files |
| **Total OpenRA C# source lines** | ~10,400 (all mapped active) / ~5,700 (deferred) / ~16,100 (grand total) |

| Phase | Files (Active + Deferred) | C# Lines (Active) | Est. TS Lines | Est. Tests | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Editor Core | 8 + 0 | ~1,620 | ~2,800 | ~85 | PLANNING |
| B: Editor Brushes | 10 + 0 | ~3,143 | ~4,500 | ~110 | PLANNING |
| C: Editor UI Logic | 18 + 0 | ~3,003 | ~5,350 | ~125 | PLANNING |
| D: Debug & Dev Tools | 7 + 0 | ~1,100 | ~1,950 | ~65 | PLANNING |
| E: Core Build Tools | 22 + 0 | ~2,704 | ~5,050 | ~105 | PLANNING |
| F: Docs & Export | 7 + 6 | ~776 | ~1,200 | ~40 | PLANNING |
| G: Legacy Map Import | 6 + 12 | ~667 | ~1,200 | ~35 | PLANNING |
| **Total** | **78 + 18** | **~13,013** | **~22,050** | **~565** | |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Editor Core Infrastructure

**Status**: 🔜 PLANNING (0/8 migrated)
**Complexity**: Low-HIGH (EditorActorLayer 495 lines HIGH, MapEditorData 26 lines LOW)
**Blocked by**: Chapter 3 (World, Actor, TraitDictionary — editor traits attach to World), Chapter 4 (Map + Terrain — editor manipulates map data), Chapter 5 (Widgets — editor uses widget system), Chapter 7 (Camera, Input — editor needs viewport interaction), Chapter 10 (ResourceLayer — EditorResourceLayer interacts with resource infrastructure)
**Blocks**: Phase B (Editor Brushes depend on EditorActionManager, EditorActorLayer, EditorCursorLayer), Phase C (Editor UI depends on all Phase A traits)

**Description**: The foundational editor infrastructure — undo/redo action manager, actor preview layer, resource editing layer, cursor overlay, and editor viewport widget. These 8 files form the core that all editor brushes and UI panels build upon. `EditorActionManager` provides the Command pattern undo/redo stack. `EditorActorLayer` and `EditorActorPreview` manage lightweight render-only actor previews (no game simulation). `EditorResourceLayer` enables resource painting on the map. `EditorCursorLayer` renders the editor cursor grid overlay. `EditorViewportControllerWidget` extends the standard viewport with editor-specific mouse handling. `EditorSelectionAnnotationRenderable` draws selection boxes. `MapEditorData` is a marker trait that persists editor metadata in map files.

**Paradigm Shifts**:
- C# `Stack<EditorActionContainer>` undo/redo → TypeScript `Array<EditorAction>` with serializable command objects
- C# `EditorActorPreview` as lightweight OpenGL renderable → Babylon.js `TransformNode` + `Sprite` billboard with no game components
- C# 2D cell grid cursor → Babylon.js 3D grid overlay via `LinesMesh` on terrain plane
- C# `Viewport.ViewToWorld()` → `scene.pick(ray)` on terrain mesh with cell grid snap
- C# `IResourceLayer` interface → TypeScript `IResourceLayer` with identical semantics, backed by Ch10 `ResourceLayer`

#### 3.1.1 EditorActionManager

- [ ] **TODO-21.A.1** `src/OpenRA.Mods.Common/Traits/World/EditorActionManager.ts` (189 lines C#) — Undo/redo command stack:
  - `IEditorAction` interface: `execute()`, `undo()`, `redo()`, `description: string`
  - `undoStack: EditorAction[]`, `redoStack: EditorAction[]`
  - `add(action: IEditorAction): void` — execute action, push to undo stack, clear redo stack
  - `undo(): void` — pop undo, push to redo, call action.undo()
  - `redo(): void` — pop redo, push to undo, call action.redo()
  - `hasUndos(): boolean`, `hasRedos(): boolean` — stack emptiness checks
  - `modified: boolean` — dirty flag, set to true on any action
  - `saveFailed: boolean` — save error flag
  - `OpenMapAction` subclass: marks initial map load state (cannot undo past it)
  - Event hooks: `onChange`, `onItemAdded`, `onItemRemoved`
  - Action serialization for save/restore (optional — Phase C)

#### 3.1.2 EditorActorLayer

- [ ] **TODO-21.A.2** `src/OpenRA.Mods.Common/Traits/World/EditorActorLayer.ts` (495 lines C#) — Editor actor management layer:
  - Manages collection of `EditorActorPreview` instances
  - `addActor(owner, type, location, facing): EditorActorPreview` — create new preview actor
  - `removeActor(preview): void` — remove preview actor
  - `getActors(): EditorActorPreview[]` — all preview actors
  - `getActorsAt(cell: CellCoords): EditorActorPreview[]` — actors at specific cell
  - Actor naming: auto-generate unique actor IDs (`Actor000`, `Actor001`, ...)
  - `nextActorName(): string` — incremental name generator
  - `canPlaceActor(type, cell): boolean` — placement validity check (terrain, blocking)
  - `moveActor(preview, newLocation): void` — reposition actor preview
  - Owner/faction assignment for preview actors
  - Integration with EditorActionManager: actor add/remove/move are undoable actions
  - 3D rendering: each preview is a `Billboard` sprite + optional `TransformNode` for turrets
  - NOT a gameplay trait — actors have no `ITick`, no AI, no combat
  - **Precision requirement**: preview actor position must match in-game position exactly

#### 3.1.3 EditorActorPreview

- [ ] **TODO-21.A.3** `src/OpenRA.Mods.Common/Traits/World/EditorActorPreview.ts` (333 lines C#) — Individual preview actor:
  - Lightweight render-only actor representation
  - `type: string` — actor type from ruleset (e.g., "e1", "mtnk", "proc")
  - `owner: Player` — display owner (for faction-specific rendering)
  - `facing: WAngle` — preview facing direction
  - `location: CellCoords` — map cell position
  - `render(worldRenderer): void` — draw sprite/animation at cell position
  - `getBounds(): BoundingBox` — selection box for hit-testing
  - `tooltip: string` — hover tooltip (actor name + type)
  - Turret/barrel preview rendering for multi-part actors
  - Occupied cells calculation for multi-cell actors (buildings)
  - 3D rendering: Babylon.js `Sprite` billboard or `Mesh` with `StandardMaterial`
  - Selection highlight: emissive glow or outline when selected
  - No `ITick`, no `Activity`, no `TraitDictionary` — pure visual preview

#### 3.1.4 EditorCursorLayer

- [ ] **TODO-21.A.4** `src/OpenRA.Mods.Common/Traits/World/EditorCursorLayer.ts` (53 lines C#) — Editor cursor grid overlay:
  - `cursorPosition: CellCoords` — current mouse cell
  - `render(worldRenderer): void` — draw cursor highlight at cell
  - Cell highlight visualization: semi-transparent colored quad at cell position
  - Color varies by brush mode (green = tile, blue = actor, yellow = resource)
  - Grid snap indicator: dashed border around selected cell
  - 3D rendering: `GroundMesh` quad or `Decal` at terrain height
  - Update on mouse move via `EditorViewportControllerWidget` callback

#### 3.1.5 EditorResourceLayer

- [ ] **TODO-21.A.5** `src/OpenRA.Mods.Common/Traits/World/EditorResourceLayer.ts` (313 lines C#) — Editor resource manipulation:
  - Implements `IResourceLayer` interface for editor mode
  - `addResource(cell, type, amount): void` — place/add resources
  - `removeResource(cell): void` — remove resources
  - `getResource(cell): ResourceLayerContents` — read resource at cell
  - `netWorth: number` — calculated total resource value on map
  - `clearResources(): void` — remove all resources from map
  - `clone()` — deep copy for undo/redo snapshots
  - Resource density visualization: color-coded cell overlay
  - Integration with EditorActionManager: each resource change is undoable
  - Resource type validation (only types defined in map ruleset)
  - Amount clamping (0 to resource type max density)
  - 3D rendering: colored overlay on terrain cells (not part of gameplay `ResourceRenderer`)

#### 3.1.6 EditorViewportControllerWidget

- [ ] **TODO-21.A.6** `src/OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.ts` (132 lines C#) — Editor-specific viewport:
  - Extends existing `ViewportControllerWidget` (Ch7 Phase B) with editor mouse handling
  - `handleMouseInput(mi: MouseInput): boolean` — route mouse events to active brush
  - `viewportToCell(mousePos: Vector2): CellCoords` — screen position to map cell
  - Scroll edge zones: 20px edge margin triggers viewport pan
  - Middle-mouse-button drag for viewport panning
  - Mouse wheel zoom with editor-specific zoom limits (wider range than game mode)
  - Context menu integration: right-click for actor properties
  - `activeBrush: IEditorBrush` — currently selected brush tool
  - Override cursor display based on brush type
  - Grid snap toggle (hold Shift for free placement vs cell-snapped)

#### 3.1.7 EditorSelectionAnnotationRenderable

- [ ] **TODO-21.A.7** `src/OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.ts` (79 lines C#) — Selection box renderer:
  - `selectionBounds: CellCoordsRegion` — currently selected cell region
  - `render(worldRenderer): void` — draw selection rectangle
  - Selection box: semi-transparent colored rectangle over selected cells
  - Multi-cell selection for drag-select operations
  - 3D rendering: `LinesMesh` rectangle at terrain height with emissive color
  - Animated dash pattern option for marching ants selection border
  - Auto-culling: only visible cells render selection

#### 3.1.8 MapEditorData

- [ ] **TODO-21.A.8** `src/OpenRA.Mods.Common/Traits/MapEditorData.ts` (26 lines C#) — Editor metadata marker:
  - `editorConfig: MapEditorConfig` — editor-specific settings
  - `cameraPosition: CellCoords` — last editor viewport position
  - `selectedTab: string` — last open editor tab
  - Persisted in map YAML/JSON: `EditorData:` section
  - Minimal trait — exists to carry editor state across save/load cycles
  - Stripped when map is loaded in game mode (not editor mode)

**Phase A Summary**: 8 files, ~1,620 C# lines source. Estimated: 8 impl + 8 test = 16 files, ~85 tests, ~2,800 TS lines.

---

### 3.2 Phase B: Editor Brushes

**Status**: 🔜 PLANNING (0/10 migrated)
**Complexity**: LOW-HIGH (EditorDefaultBrush 627 lines HIGH, EditorResourceBrush 161 lines LOW)
**Blocked by**: Phase A (brushes use EditorActionManager, EditorActorLayer, EditorCursorLayer, EditorResourceLayer)
**Blocks**: Phase C (UI tool palette selects and configures brushes)

**Description**: Editor brushes are the core editing tools — they implement `IEditorBrush` and handle mouse input, produce undoable editor actions, and render visual feedback. `EditorDefaultBrush` is the primary selection/manipulation brush (drag-select, move, delete). `EditorTileBrush` paints terrain tiles. `EditorActorBrush` places actors. `EditorResourceBrush` paints resource deposits. `EditorBlit` copies terrain regions. `EditorCopyPasteBrush` copies/pastes actors and resources. `EditorMarkerLayerBrush` places map markers. `EditorTilingPathBrush` and `TilingPathTool` create roads/rivers/tiled paths between two points.

**Paradigm Shifts**:
- C# `MouseInput` 2D screen coordinates → Babylon.js `PointerEvent` with `scene.pick()` for 3D hit-testing
- C# `IEditorBrush.RenderAboveShroud()` → Babylon.js `UtilityLayerRenderer` overlay rendering
- C# tile painting (2D tile indices) → 3D terrain mesh texture updates via `TerrainMeshBuilder`
- **⚠ Architectural Gap**: `TerrainMeshBuilder` (Ch4 Phase F) generates the entire terrain mesh in one pass and does NOT currently have an `updateCell(cell, tile)` method for incremental cell-level updates. Phase B must either extend `TerrainMeshBuilder` with per-cell vertex data patching or design an editor-specific terrain update mechanism. This is a prerequisite design task before tile brush implementation.
- C# actor placement (2D cell coordinates) → 3D Billboard sprite at `cellToVector3()` position
- C# resource painting → mesh vertex color updates on resource layer

#### 3.2.1 IEditorBrush Interface

- [ ] **TODO-21.B.1** `src/OpenRA.Mods.Common/EditorBrushes/IEditorBrush.ts` (~30 line equivalent) — Brush interface:
  - `handleMouseInput(mi: MouseInput): boolean` — process mouse event, return true if consumed
  - `tick(): void` — per-tick update (for animation, delayed actions)
  - `tickRender(worldRenderer: WorldRenderer): void` — per-frame visual update
  - `renderAboveShroud(worldRenderer: WorldRenderer): IRenderable[]` — overlay visuals
  - `renderAnnotations(worldRenderer: WorldRenderer): IRenderable[]` — annotation visuals (selection boxes, guides)
  - `dispose(): void` — cleanup

#### 3.2.2 EditorDefaultBrush

- [ ] **TODO-21.B.2** `src/OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.ts` (627 lines C#) — Primary selection/manipulation brush:
  - `EditorSelection` state: `Area?: CellCoordsRegion`, `Actor?: EditorActorPreview`
  - Left-click: select actor at cell or begin drag-select region
  - Drag-select: rubber-band box across cells, select all actors/resources within
  - Right-click: context menu (copy/paste/delete/properties)
  - Delete key: remove selected actors/resources (undoable)
  - Multi-select: Ctrl+click to add to selection, Shift+click for range select
  - `SelectionChanged` event: other editor panels update when selection changes
  - `UpdateSelectedTab` event: auto-switch to relevant tab (e.g., Actors tab when actor selected)
  - Move selected actors: drag to new cell position
  - Copy/paste: Ctrl+C/Ctrl+V for selected actors/resources
  - Mouse drag threshold: `MinMouseMoveBeforeDrag = 32` pixels before drag starts
  - Selection box rendering: `EditorSelectionAnnotationRenderable` for selected region
  - Actor highlight: emissive sprite when selected
  - Undo integration: all mutations via `EditorActionManager`

#### 3.2.3 EditorTileBrush

- [ ] **TODO-21.B.3** `src/OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.ts` (383 lines C#) — Terrain tile painting brush:
  - `selectedTile: TerrainTile` — currently selected tile type
  - `brushSize: number` — brush diameter in cells (1x1, 3x3, 5x5)
  - Click: paint single tile at cell
  - Drag: paint line or filled rectangle of tiles
  - Tile template painting (predefined multi-tile patterns for cliffs, shores)
  - `paintCell(cell: CellCoords, tile: TerrainTile): void` — set tile at cell
  - Terrain validation: tile must be valid for terrain type at elevation
  - Height auto-adjustment option for cliff continuity
  - Visual preview: ghost tiles showing what will be placed before click
  - Undo: each paint stroke is a single undoable action
  - 3D terrain update: `TerrainMeshBuilder.updateCell(cell)` after each tile change

#### 3.2.4 EditorActorBrush

- [ ] **TODO-21.B.4** `src/OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.ts` (180 lines C#) — Actor placement brush:
  - `selectedActorType: string` — actor type from ruleset to place
  - `owner: Player` — which player owns placed actors
  - `facing: WAngle` — initial facing direction (configurable via rotation handle)
  - Click: place actor at cell (if valid)
  - `canPlace(type, cell): boolean` — cell traversability + building footprint check
  - Multi-cell actor placement (buildings) with footprint validation
  - Rotation handle: drag to set actor facing before placement
  - Repeat placement: hold Ctrl to place multiple of same actor
  - Visual preview: ghost actor sprite at cursor position
  - Placement validity color: green (valid) / red (blocked)
  - Undo: `PlaceActorAction` / `RemoveActorAction`
  - Actor list auto-refresh after placement (triggers `ActorSelectorLogic` update)

#### 3.2.5 EditorResourceBrush

- [ ] **TODO-21.B.5** `src/OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.ts` (161 lines C#) — Resource painting brush:
  - `resourceType: string` — resource type to paint (e.g., "ore", "gems", "tiberium")
  - `brushSize: number` — brush diameter in cells
  - `density: number` — resource density to apply (0-100%)
  - Click/drag: add resource to cells under brush
  - Right-click/drag: remove resource from cells under brush
  - Density falloff: center of brush gets higher density (gaussian or linear falloff)
  - Resource amount display: hover tooltip shows cell resource value ($)
  - Visual preview: color-coded density overlay before placement
  - Undo: `SetResourcesAction` with snapshot of pre-edit resource values

#### 3.2.6 EditorBlit

- [ ] **TODO-21.B.6** `src/OpenRA.Mods.Common/EditorBrushes/EditorBlit.ts` (363 lines C#) — Terrain copy tool:
  - Source selection: drag-select region to copy from
  - Destination paste: click to paste copied terrain tiles
  - `copy(source: CellCoordsRegion): TerrainData` — capture source region tiles + heights
  - `paste(dest: CellCoords): void` — apply captured tiles at destination
  - Height offset handling: preserve or flatten height during paste
  - Mirror/flip options: horizontal flip, vertical flip, rotate 90°
  - Visual preview: ghost overlay of copied terrain at paste location
  - Source region highlight: different color from selection box
  - Undo: `BlitAction` containing all cells changed during paste

#### 3.2.7 EditorCopyPasteBrush

- [ ] **TODO-21.B.7** `src/OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.ts` (174 lines C#) — Actor copy-paste brush:
  - Copy selected actors (Ctrl+C) — captures actor type, owner, facing, relative positions
  - Paste (Ctrl+V) — places duplicate actors at new location
  - `copyActors(actors: EditorActorPreview[]): ActorClipboardData`
  - `pasteActors(origin: CellCoords, data: ActorClipboardData): void`
  - Relative position preservation: pasted actors maintain same spatial arrangement
  - Owner preservation or reassignment option
  - Visual preview: ghost actors at paste position before confirming
  - Undo: batch action containing all pasted actors
  - Clipboard data is serializable for cross-session persistence

#### 3.2.8 EditorMarkerLayerBrush

- [ ] **TODO-21.B.8** `src/OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.ts` (265 lines C#) — Map marker brush:
  - `markerType: string` — marker type (flag, spawn point, waypoint, camera)
  - Click: place marker at cell
  - Right-click: remove marker
  - Drag: move existing marker to new cell
  - Marker label editing: double-click to rename marker
  - Waypoint chain mode: click sequence of cells to create numbered waypoints
  - Player spawn point assignment (1, 2, 3, ...)
  - Multi-select markers for batch operations
  - Visual: colored flag/icon billboard at marker position
  - Undo: `PlaceMarkerAction` / `RemoveMarkerAction`

#### 3.2.9 EditorTilingPathBrush

- [ ] **TODO-21.B.9** `src/OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.ts` (380 lines C#) — Tiled path brush (roads/rivers):
  - `tileSet: string` — tiling template to use (road, river, cliff, wall)
  - Click start cell, click end cell → auto-generate tiled path between them
  - Path auto-tiling: selects correct tile variants for corners, straights, T-junctions, crossroads
  - Path width: single-cell or multi-cell wide roads
  - Smoothing: curve the path through clicked waypoints (not just straight lines)
  - Real-time preview: ghost tiles showing final path while dragging end point
  - Intersection handling: automatically create proper junction tiles at crossings
  - Brush mode toggle: freehand paint vs path-connect mode
  - Undo: `TilingPathAction` containing all cells modified

#### 3.2.10 TilingPathTool

- [ ] **TODO-21.B.10** `src/OpenRA.Mods.Common/Traits/World/TilingPathTool.ts` (580 lines C#) — Tiling path utility:
  - Path-finding engine for tiled paths (roads follow terrain, bridges cross water)
  - `findPath(start: CellCoords, end: CellCoords): CellCoords[]` — A* path for tiling
  - Terrain cost function: roads prefer flat terrain, avoid water (unless bridge)
  - Junction tile selection: analyze neighboring cells to pick correct tile variant
  - Tile adjacency rule engine: matches OpenRA's tiling system
  - Template database: predefined tile patterns for each tileset
  - Bridge placement logic: elevated road over water cells
  - Tunnel entry/exit placement for cliff passages
  - **Precision requirement**: junction tile selection must match OpenRA output exactly

**Phase B Summary**: 10 files, ~2,913 C# lines source. Estimated: 10 impl + 10 test = 20 files, ~110 tests, ~4,500 TS lines.

---

### 3.3 Phase C: Editor UI Logic

**Status**: 🔜 PLANNING (0/16 migrated)
**Complexity**: LOW-HIGH (ActorEditLogic 602 lines HIGH, MapEditorLogic 57 lines LOW)
**Blocked by**: Phase A (needs editor traits to interact with), Phase B (needs brushes to configure), Chapter 16 (UI Widget Extensions for widget toolkit)
**Blocks**: No phase depends on editor UI (leaf node)

**Description**: Editor UI panels — the widget logic classes that provide the visual interface for the map editor. Each file corresponds to a tab or panel in the editor layout. `MapEditorLogic` is the root editor controller (toolbar, undo/redo buttons, coordinate display). `MapEditorSelectionLogic` handles the selection info panel. `MapEditorTabsLogic` manages the tab strip. `MapToolsLogic` selects active brush. `MapGeneratorToolLogic` generates random maps from parameters. `MapMarkerTilesLogic` configures marker placement. `MapOverlaysLogic` toggles visual overlays. `NewMapLogic` and `SaveMapLogic` handle map creation/saving dialogs. `ActorEditLogic` provides actor property editing (owner, facing, health, conditions). `ActorSelectorLogic` provides an actor type browser. `TileSelectorLogic` browses and selects terrain tiles. `LayerSelectorLogic` toggles between terrain/resource/actor layers. `CommonSelectorLogic` provides shared selection UI patterns. `HistoryLogLogic` shows the undo/redo history list. `TilingPathToolLogic` configures the tiling path brush parameters.

**Paradigm Shifts**:
- C# WinForms-style widget composition → Babylon.js GUI / HTML overlay panels
- C# `ScrollPanelWidget` with item rendering → HTML `div` with CSS `overflow-y: auto`
- C# `ObjectCreator.UseCtor` DI → TypeScript explicit constructor injection
- C# `ChromeLogic` base class → TypeScript class implementing `IWidgetLogic`
- C# widget tree traversal (`widget.Get<T>("name")`) → existing Ch5/Ch16 widget reference pattern

#### 3.3.1 MapEditorLogic

- [ ] **TODO-21.C.1** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.ts` (57 lines C#) — Root editor controller:
  - Wires undo/redo buttons to `EditorActionManager`
  - Coordinate label: shows current mouse cell + terrain height + tile type
  - Cash label: shows total resource value on map (via `EditorResourceLayer.netWorth`)
  - Editor mode entry: disable game simulation, enable editor traits
  - Editor mode exit: prompt save if modified, restore game mode

#### 3.3.2 MapEditorSelectionLogic

- [ ] **TODO-21.C.2** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorSelectionLogic.ts` (152 lines C#) — Selection info panel:
  - Shows properties of currently selected actor(s) or cells
  - Actor info: name, type, owner, facing, health (preview), position
  - Cell info: terrain type, height, resource type/amount
  - Multi-select info: count of selected actors, aggregate properties
  - Edit fields: double-click to edit actor properties inline

#### 3.3.3 MapEditorTabsLogic

- [ ] **TODO-21.C.3** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorTabsLogic.ts` (100 lines C#) — Tab strip controller:
  - Tabs: Tiles, Actors, Resources, Markers, History, Options
  - Tab switching: hide/show corresponding panels
  - Auto-switch: selecting an actor switches to Actors tab
  - Tab icons: small sprite icons for each tab

#### 3.3.4 MapToolsLogic

- [ ] **TODO-21.C.4** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapToolsLogic.ts` (94 lines C#) — Brush tool palette:
  - Tool buttons: Select, Tile, Actor, Resource, Marker, Path, Copy
  - Each tool button activates corresponding `IEditorBrush`
  - Tool options panel: brush-specific settings (size, type, etc.)
  - Keyboard shortcuts: S=Select, T=Tile, A=Actor, R=Resource, etc.

#### 3.3.5 MapGeneratorToolLogic

- [ ] **TODO-21.C.5** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapGeneratorToolLogic.ts` (331 lines C#) — Map generator UI:
  - Map size inputs: width, height
  - Terrain type selector: desert, temperate, snow, etc.
  - Random seed input (or auto-generate)
  - Generator algorithm choice: Classic, Clear, Custom
  - Generate button: creates new map with parameters
  - Preview thumbnail: small rendered preview of generated map
  - Re-roll: regenerate with new random seed
  - Integration with `ClassicMapGenerator` / `ClearMapGenerator` (Ch4)

#### 3.3.6 MapMarkerTilesLogic

- [ ] **TODO-21.C.6** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapMarkerTilesLogic.ts` (261 lines C#) — Marker placement UI:
  - Player spawn point assignment dropdown (1-8 players)
  - Waypoint list editor: add, remove, reorder waypoints
  - Camera bookmark placement and naming
  - Rally point markers
  - Resource density overlay toggle
  - Marker visibility toggle per type

#### 3.3.7 MapOverlaysLogic

- [ ] **TODO-21.C.7** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/MapOverlaysLogic.ts` (130 lines C#) — Overlay toggle panel:
  - Toggle overlays: grid lines, terrain types, resources, actor footprints, blocking cells
  - Opacity slider: overlay transparency
  - Height map overlay: color-coded elevation visualization
  - Actor count overlay: heat map of actor density
  - All overlays render via Babylon.js `UtilityLayerRenderer` or post-processing

#### 3.3.8 NewMapLogic

- [ ] **TODO-21.C.8** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/NewMapLogic.ts` (84 lines C#) — New map dialog:
  - Map dimensions: width x height (in cells)
  - Default terrain type selector
  - Start from scratch or from template
  - Create button: initializes empty map and opens editor
  - Template list: pre-made map templates (skirmish maps)

#### 3.3.9 SaveMapLogic

- [ ] **TODO-21.C.9** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/SaveMapLogic.ts` (360 lines C#) — Save map dialog:
  - Map title, author, description fields
  - Map type: Skirmish, Mission, Campaign
  - Player count selector
  - Map size summary (read-only)
  - Save path: file name for map package
  - Validation: required fields, player count > 0, no overlapping spawns
  - Save action: serializes map to `.oramap` format (ZIP with `map.yaml` + `map.bin`)
  - Auto-save timer: periodic save to prevent data loss
  - Save-as-copy option

#### 3.3.10 ActorEditLogic

- [ ] **TODO-21.C.10** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorEditLogic.ts` (602 lines C#) — Actor property editor:
  - Property grid: all editable actor properties in a scrollable list
  - Owner selector: dropdown of players
  - Facing editor: rotation slider (0-255 WAngle)
  - Health/condition editor: set initial health %, add/remove conditions
  - Actor name editor: custom name override
  - Script tags editor: add/remove script trigger tags
  - Tooltip text editor
  - Multi-edit mode: change property for all selected actors simultaneously
  - Property categories: General, Combat, Visual, Scripting
  - Apply/Cancel buttons
  - Undo: `EditActorPropertiesAction`

#### 3.3.11 ActorSelectorLogic

- [ ] **TODO-21.C.11** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/ActorSelectorLogic.ts` (233 lines C#) — Actor type browser:
  - Category filters: Infantry, Vehicles, Tanks, Aircraft, Buildings, Naval, Special
  - Faction filter: Allies, Soviets, GDI, Nod, etc.
  - Search bar: type actor name to filter
  - Actor list: scrollable grid of actor thumbnails with names
  - Click actor to select for placement (activates `EditorActorBrush`)
  - Context menu: quick-place, add to favorites
  - Favorites bar: frequently used actors
  - Thumbnail rendering: small `Sprite` of actor's default animation

#### 3.3.12 TileSelectorLogic

- [ ] **TODO-21.C.12** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/TileSelectorLogic.ts` (144 lines C#) — Terrain tile browser:
  - Category filters: Clear, Rough, Road, Water, Cliff, Shore, River, etc.
  - Tile palette: clickable grid of tile thumbnails
  - Selected tile preview: larger tile thumbnail
  - Tile template selection: multi-tile brush patterns
  - Recently used tiles: quick-access row
  - Search by terrain index number

#### 3.3.13 LayerSelectorLogic

- [ ] **TODO-21.C.13** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/LayerSelectorLogic.ts` (79 lines C#) — Layer visibility toggle:
  - Layer checkboxes: Terrain, Resources, Actors, Markers
  - Each layer can be independently shown/hidden
  - Lock layer: prevent accidental editing
  - Opacity per layer
  - "Show All" / "Hide All" quick buttons

#### 3.3.14 CommonSelectorLogic

- [ ] **TODO-21.C.14** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/CommonSelectorLogic.ts` (171 lines C#) — Shared selector base:
  - Category button strip: common category filter pattern
  - Search text field with debounce
  - Scrollable item grid with variable item size
  - Sort order toggle: name, type, cost
  - Used as base or mixin by ActorSelectorLogic, TileSelectorLogic, etc.

#### 3.3.15 HistoryLogLogic

- [ ] **TODO-21.C.15** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/HistoryLogLogic.ts` (69 lines C#) — Undo/redo history display:
  - Scrollable list of past actions with timestamps
  - Each entry: action icon + description + time
  - Click entry to undo/redo to that point in history
  - Current state marker indicating position in history
  - Clean/dirty markers (is map modified after this action)
  - Collapse/expand details for complex actions

#### 3.3.16 TilingPathToolLogic

- [ ] **TODO-21.C.16** `src/OpenRA.Mods.Common/Widgets/Logic/Editor/TilingPathToolLogic.ts` (149 lines C#) — Tiling path brush UI:
  - Tile template selector: road, river, cliff wall, fence
  - Width slider: 1-5 cells wide
  - Preview checkbox: show/hide path preview
  - Smoothing toggle: curved vs straight paths
  - Template property overrides
  - Quick-select recently used tiling templates

#### 3.3.17 LoadMapEditorLogic

- [ ] **TODO-21.C.17** `src/OpenRA.Mods.Common/Widgets/Logic/Ingame/LoadMapEditorLogic.ts` (26 lines C#) — Editor widget tree bootstrap:
  - Entry-point `ChromeLogic` that initializes the editor UI when a map is opened
  - Loads `EDITOR_WORLD_ROOT` widget subtree
  - Loads `TRANSIENTS_PANEL` for floating editor dialogs
  - Widget tree setup before `MapEditorLogic` populates individual panels
  - **Note**: Must be migrated before TODO-21.C.1 (MapEditorLogic) — it creates the widget root that MapEditorLogic populates

#### 3.3.18 EditorQuickSaveHotkeyLogic

- [ ] **TODO-21.C.18** `src/OpenRA.Mods.Common/Widgets/Logic/Ingame/Hotkeys/EditorQuickSaveHotkeyLogic.ts` (61 lines C#) — Editor quick-save hotkey:
  - Ctrl+S hotkey handler for editor mode
  - Extends `SingleHotkeyBaseLogic` from Ch7 hotkey system
  - Triggers `SaveMapLogic.save()` action
  - Registers on editor mode entry, unregisters on exit
  - Reuses Ch7 `HotkeyReference` and `HotkeyManager`

**Phase C Summary**: 18 files, ~3,003 C# lines source. Estimated: 18 impl + 16 test = 34 files, ~125 tests, ~5,350 TS lines.

---

### 3.4 Phase D: Debug & Developer Tools

**Status**: 🔜 PLANNING (0/7 migrated)
**Complexity**: LOW-MEDIUM (DevCommands 318 lines MEDIUM, RenderSpritesEditorOnly 30 lines LOW)
**Blocked by**: Chapter 3 (World, Actor, TraitDictionary), Chapter 5 (Widget system — for in-game console). Chapter 7 (HotkeyReference — EditorQuickSaveHotkeyLogic).
**Blocks**: Phase E, F, G (IUtilityCommand interface is the foundation for ALL utility commands). Note: DebugVisualizations, DevCommands, DeveloperMode, RenderSpritesEditorOnly, and CustomTerrainDebugOverlay are true leaf nodes — only IUtilityCommand blocks downstream phases.

**Description**: In-game developer tools — debug visualization overlays, developer cheat commands, and editor-only rendering traits. `IUtilityCommand` defines the command interface reused by both in-game console commands and CLI build tools. `DebugVisualizations` manages global debug overlay toggles (pathfinding grid, blocking cells, weapon ranges). `DebugVisualizationCommands` registers chat-console commands to toggle debug overlays. `DevCommands` provides cheat commands (give cash, instant build, reveal map, spawn actors). `DeveloperMode` is a player trait that enables cheat commands and unlocks all tech. `RenderSpritesEditorOnly` renders sprites only when in editor mode. `CustomTerrainDebugOverlay` draws debug information on terrain cells.

**Paradigm Shifts**:
- C# chat-console command dispatch → TypeScript command registry + in-game chat parser
- C# `DebugVisualizations` static flags → TypeScript singleton with Babylon.js `UtilityLayerRenderer` overlays
- C# cheat commands modifying game state → TypeScript methods on `World` / `Player` with sync-safe state changes
- C# debug overlay rendering (2D lines) → Babylon.js `LinesMesh` / `UtilityLayerRenderer` in 3D space

#### 3.4.1 IUtilityCommand Interface

- [ ] **TODO-21.D.1** `src/OpenRA.Game/IUtilityCommand.ts` (69 lines C#) — Command interface:
  - `name: string` — command invocation string (e.g., "give-cash", "reveal-map")
  - `validateArguments(args: string[]): boolean` — argument syntax check
  - `run(utility: Utility, args: string[]): void` — execute command
  - `RequireExplicitImplementation` equivalent: commands must explicitly register

#### 3.4.2 DebugVisualizations

- [ ] **TODO-21.D.2** `src/OpenRA.Game/Traits/World/DebugVisualizations.ts` (70 lines C#) — Debug overlay manager:
  - Global debug flag toggles: `showPathfindingGrid`, `showBlockingCells`, `showWeaponRanges`, `showActorFootprints`, `showTerrainCosts`
  - Singleton accessible from any trait
  - Toggle via console commands or key bindings (Ctrl+Shift+D)
  - 3D overlay rendering: colored `LinesMesh` grids, `BoundingBox` wireframes
  - Performance: debug overlays disabled in production builds
  - `render(worldRenderer: WorldRenderer): void` — render all active debug overlays

#### 3.4.3 DebugVisualizationCommands

- [ ] **TODO-21.D.3** `src/OpenRA.Mods.Common/Commands/DebugVisualizationCommands.ts` (155 lines C#) — Debug overlay console commands:
  - `/debug pathfinding` — toggle pathfinding grid overlay
  - `/debug blocking` — toggle blocking cells overlay
  - `/debug weapons` — toggle weapon range circles
  - `/debug footprints` — toggle actor footprint overlay
  - `/debug terrain-costs` — toggle terrain cost numbers
  - `/debug all-on` / `/debug all-off` — toggle all overlays
  - Each command registers with `CommandRegistry`

#### 3.4.4 DevCommands

- [ ] **TODO-21.D.4** `src/OpenRA.Mods.Common/Commands/DevCommands.ts` (318 lines C#) — Developer cheat commands:
  - `/give-cash <amount> [player]` — add money to player
  - `/instant-build [on|off]` — toggle instant production/build times
  - `/reveal-map [on|off]` — toggle full map reveal (disable shroud)
  - `/spawn-actor <type> [player] [x] [y]` — spawn actor at position
  - `/kill-selected` — destroy currently selected actors
  - `/heal-selected` — heal currently selected actors to full
  - `/give-level <level>` — set selected actors' veterancy level
  - `/toggle-invulnerability` — make selected actors invincible
  - `/toggle-cloak` — cloak/reveal selected actors
  - All commands require `DeveloperMode` trait enabled (or admin privilege)
  - Sync-safe: commands that modify state must use deterministic RNG paths

#### 3.4.5 DeveloperMode

- [ ] **TODO-21.D.5** `src/OpenRA.Mods.Common/Traits/Player/DeveloperMode.ts` (342 lines C#) — Developer mode trait:
  - Player trait that gates cheat command access
  - `enabled: boolean` — toggled via settings or command-line flag
  - `unlockTech: boolean` — unlocks all tech tree prerequisites
  - `instantBuildTime: boolean` — reduces all build times to 1 tick
  - `infiniteResources: boolean` — disable resource consumption
  - `fastBuild: boolean` — ignore building placement cooldown
  - `allFactions: boolean` — allow building units from any faction
  - `enableShroudReveal: boolean` — full map visibility
  - `enableCheats: boolean` — master switch for `/give-*` commands
  - `checkPermission(player: Player): boolean` — gate check for dev commands
  - Multiplayer: dev mode disabled by default (server config)

#### 3.4.6 RenderSpritesEditorOnly

- [ ] **TODO-21.D.6** `src/OpenRA.Mods.Common/Traits/Render/RenderSpritesEditorOnly.ts` (30 lines C#) — Editor-only sprite renderer:
  - Renders sprite only when world is in editor mode
  - Throws away sprite in game mode
  - Used for editor-only visual helpers (spawn point markers, camera bookmarks)
  - Minimal trait — boolean check on render

#### 3.4.7 CustomTerrainDebugOverlay

- [ ] **TODO-21.D.7** `src/OpenRA.Mods.Common/Traits/Render/CustomTerrainDebugOverlay.ts` (116 lines C#) — Terrain debug overlay:
  - Renders colored overlay on terrain cells based on custom criteria
  - Cell color function: `(cell: CellCoords) => Color`
  - Used for visualizing terrain costs, custom movement layers, resource density
  - 3D rendering: semi-transparent colored quads at terrain height
  - Hot-reloadable: can redefine the color function at runtime
  - Integration with `DebugVisualizations`

**Phase D Summary**: 7 files, ~1,100 C# lines source. Estimated: 7 impl + 5 test = 12 files, ~65 tests, ~1,950 TS lines.

---

### 3.5 Phase E: Utility Commands — Core Build Tools

**Status**: 🔜 PLANNING (0/20 migrated)
**Complexity**: LOW-MEDIUM (ExtractYamlStrings 411 lines MEDIUM, GetMapHashCommand 31 lines LOW)
**Blocked by**: Chapter 4 (Map, MiniYAML pipeline — tools process maps and YAML), Chapter 5 (FileSystem — tools open/read/write packages)
**Blocks**: No phase depends on utility commands (leaf node)

**Description**: CLI build tools for mod development. These are Node.js scripts (not browser code) for asset conversion, map manipulation, YAML validation, and mod management. `UtilityRunner` is a new command dispatcher that replaces `OpenRA.Utility/Program.cs`. Mod management commands register/unregister mods. Map commands save, resize, and update maps. Asset conversion commands convert sprites to PNG, dump sprite sheets, extract strings. Validation commands check YAML syntax, missing sprites, and trait interface correctness. These tools are NOT bundled into the web app — they run via `npx` or `npm run` scripts during development and CI/CD.

**Paradigm Shifts**:
- C# `OpenRA.Utility.exe` single binary → `scripts/` directory with individual Node.js scripts
- C# `File.ReadAllText` / `File.WriteAllBytes` → Node.js `fs.readFileSync` / `fs.writeFileSync`
- C# `FieldLoader.Load()` YAML deserialization → Ch4 Phase H `miniyaml-to-json.ts` preprocessed JSON
- C# `System.Drawing.Bitmap` → Node.js `sharp` or `canvas` for image processing
- C# `System.IO.Compression.ZipFile` → Node.js `fflate` (already in dependencies)

#### 3.5.0 LintInterfaces (Shared Foundation)

- [ ] **TODO-21.E.0** `src/OpenRA.Mods.Common/UtilityCommands/LintInterfaces.ts` (21 lines C#) — Lint pass interfaces:
  - `ILintPass` — base interface for lint checkers
  - `ILintMapPass` — map-level lint pass (validates map structure)
  - `ILintRulesPass` — rules-level lint pass (validates actor/weapon definitions)
  - `ILintSequencesPass` — sequences-level lint pass (validates sprite sequences)
  - **Note**: These are the foundational interfaces that `CheckYaml` (TODO-21.E.16), `CheckExplicitInterfacesCommand` (TODO-21.E.18), `CheckConditionalTraitInterfaceOverrides` (TODO-21.E.19), and `CheckMissingSprites` (TODO-21.E.17) implement. Must be migrated before any lint command.

#### 3.5.1 UtilityRunner

- [ ] **TODO-21.E.1** `src/OpenRA.Game/UtilityRunner.ts` (new file) — Command dispatcher:
  - `commands: Map<string, IUtilityCommand>` — registered commands
  - `register(command: IUtilityCommand): void` — add command
  - `run(args: string[]): Promise<void>` — parse args, find command, validate, execute
  - Usage: `node scripts/run-utility.mjs <mod> <command> [args...]`
  - ModData initialization from manifest path
  - Error handling: exit code 1 on failure, descriptive error messages
  - Help text: `--help` flag lists all registered commands

#### 3.5.2 RegisterModCommand

- [ ] **TODO-21.E.2** `src/OpenRA.Game/UtilityCommands/RegisterModCommand.ts` (47 lines C#) — Mod registration:
  - `name: "register-mod"`
  - `run(utility, [modPath])` — register a mod directory in the mod registry
  - Writes to `mods.yaml` in the user's config directory
  - Validates that `mod.yaml` exists in the target directory

#### 3.5.3 UnregisterModCommand

- [ ] **TODO-21.E.3** `src/OpenRA.Game/UtilityCommands/UnregisterModCommand.ts` (43 lines C#) — Mod removal:
  - `name: "unregister-mod"`
  - `run(utility, [modId])` — remove a mod from registry
  - Does NOT delete mod files, only removes the registry entry

#### 3.5.4 ClearInvalidModRegistrationsCommand

- [ ] **TODO-21.E.4** `src/OpenRA.Game/UtilityCommands/ClearInvalidModRegistrationsCommand.ts` (47 lines C#) — Registry cleanup:
  - `name: "clear-invalid-mod-registrations"`
  - Scans registry, removes entries where mod directory no longer exists
  - Reports which entries were removed

#### 3.5.5 UpdateModCommand

- [ ] **TODO-21.E.5** `src/OpenRA.Mods.Common/UtilityCommands/UpdateModCommand.ts` (294 lines C#) — Mod update tool:
  - `name: "update-mod"`
  - Updates YAML rules, sequences, tilesets, chrome, etc. from upstream changes
  - Applies update rule transformations (YAML→YAML migration rules)
  - Mod version tracking and compatibility checks
  - Backup creation before update
  - Progress reporting for multi-file updates

#### 3.5.6 MapCommand

- [ ] **TODO-21.E.6** `src/OpenRA.Mods.Common/UtilityCommands/MapCommand.ts` (91 lines C#) — Map utility base:
  - `name: "map"`
  - Sub-commands: save, resize, info, validate
  - Shared map loading/saving logic for other map commands
  - Map package open/write via Ch5 FileSystem

#### 3.5.7 ResizeMapCommand

- [ ] **TODO-21.E.7** `src/OpenRA.Mods.Common/UtilityCommands/ResizeMapCommand.ts` (72 lines C#) — Map resize:
  - `name: "resize-map"`
  - `run(utility, [mapPath, newWidth, newHeight])` — resize map dimensions
  - Preserves existing terrain data within new bounds
  - Fills new cells with default terrain
  - Adjusts actor positions that fall outside new bounds

#### 3.5.8 UpdateMapCommand

- [ ] **TODO-21.E.8** `src/OpenRA.Mods.Common/UtilityCommands/UpdateMapCommand.ts` (162 lines C#) — Map update tool:
  - `name: "update-map"`
  - Updates a map file from older format to current format
  - Applies map-specific update rules
  - Handles actor definition changes, terrain format changes

#### 3.5.9 GetMapHashCommand

- [ ] **TODO-21.E.9** `src/OpenRA.Mods.Common/UtilityCommands/GetMapHashCommand.ts` (31 lines C#) — Map hash:
  - `name: "get-map-hash"`
  - Computes SHA-256 hash of map file
  - Matches OpenRA's map hash algorithm for compatibility

#### 3.5.10 ExtractMapRules

- [ ] **TODO-21.E.10** `src/OpenRA.Mods.Common/UtilityCommands/ExtractMapRules.ts` (126 lines C#) — Extract map rules:
  - `name: "extract-map-rules"`
  - Extracts embedded map rules (actor definitions, weapon configs) from a map package
  - Outputs as standalone files for inspection
  - Useful for debugging custom map logic

#### 3.5.11 ExtractFilesCommand

- [ ] **TODO-21.E.11** `src/OpenRA.Mods.Common/UtilityCommands/ExtractFilesCommand.ts` (43 lines C#) — File extraction:
  - `name: "extract-files"`
  - Extracts all files from a package (`MIX`, `BIG`, `PAK`, `ZIP`) to a directory
  - Uses Ch5 FileSystem package abstractions

#### 3.5.12 ConvertSpriteToPngCommand

- [ ] **TODO-21.E.12** `src/OpenRA.Mods.Common/UtilityCommands/ConvertSpriteToPngCommand.ts` (104 lines C#) — Sprite to PNG:
  - `name: "convert-sprite-to-png"`
  - Converts `.shp` sprite files to PNG sprite sheets
  - Preserves palette and transparency
  - Batch mode: convert entire directory of sprites
  - Uses Node.js `sharp` or `canvas` for PNG encoding

#### 3.5.13 DumpSequenceSheetsCommand

- [ ] **TODO-21.E.13** `src/OpenRA.Mods.Common/UtilityCommands/DumpSequenceSheetsCommand.ts` (174 lines C#) — Sequence sheet dumper:
  - `name: "dump-sequence-sheets"`
  - Generates PNG sprite sheets showing all frames of all sequences
  - Grid layout with labels for each frame
  - Used for visual debugging of animations
  - Requires WebGL if rendering in browser; uses `sharp` for server-side

#### 3.5.14 ExtractChromeStrings

- [ ] **TODO-21.E.14** `src/OpenRA.Mods.Common/UtilityCommands/ExtractChromeStrings.ts` (386 lines C#) — UI string extraction:
  - `name: "extract-chrome-strings"`
  - Extracts translatable strings from Chrome YAML widget definitions
  - Outputs `.po` / `.pot` gettext-format translation files
  - String deduplication and context annotation
  - Used for localization workflow

#### 3.5.15 ExtractYamlStrings

- [ ] **TODO-21.E.15** `src/OpenRA.Mods.Common/UtilityCommands/ExtractYamlStrings.ts` (411 lines C#) — Rules string extraction:
  - `name: "extract-yaml-strings"`
  - Extracts translatable strings from rules YAML files (actor names, descriptions, tooltips)
  - Outputs `.po` / `.pot` files grouped by actor type
  - Supports multiple languages
  - String interpolation variable marking

#### 3.5.16 CheckYaml

- [ ] **TODO-21.E.16** `src/OpenRA.Mods.Common/UtilityCommands/CheckYaml.ts` (219 lines C#) — YAML validator:
  - `name: "check-yaml"`
  - Validates all YAML/JSON files in a mod for syntax errors
  - Checks required fields, type correctness, enum values
  - Reference checking: actor types exist, weapon types exist, sequence names valid
  - Reports file name + line number for each error
  - Exit code 1 if any errors found (CI/CD integration)

#### 3.5.17 CheckMissingSprites

- [ ] **TODO-21.E.17** `src/OpenRA.Mods.Common/UtilityCommands/CheckMissingSprites.ts` (100 lines C#) — Sprite checker:
  - `name: "check-missing-sprites"`
  - Scans sequences.yaml for referenced sprites
  - Validates each sprite exists in the sprite sheets
  - Reports missing sprites with sequence name and frame index

#### 3.5.18 CheckExplicitInterfacesCommand

- [ ] **TODO-21.E.18** `src/OpenRA.Mods.Common/UtilityCommands/CheckExplicitInterfacesCommand.ts` (153 lines C#) — Interface checker:
  - `name: "check-explicit-interfaces"`
  - Verifies all traits explicitly implement required interfaces
  - TypeScript equivalent: checks that trait classes implement all required interface methods
  - Static analysis via `tsc --noEmit` already handles most of this

#### 3.5.19 CheckConditionalTraitInterfaceOverrides

- [ ] **TODO-21.E.19** `src/OpenRA.Mods.Common/UtilityCommands/CheckConditionalTraitInterfaceOverrides.ts` (98 lines C#) — Conditional trait checker:
  - `name: "check-conditional-trait-interface-overrides"`
  - Validates conditional trait interface method resolution
  - Ensures condition-disabled traits don't cause interface method failures

#### 3.5.20 UtilityHelpers

- [ ] **TODO-21.E.20** `src/OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.ts` (53 lines C#) — Shared utility helpers:
  - `loadMap(path: string): Map` — load map from file path
  - `saveMap(map: Map, path: string): void` — save map to file
  - `getModData(manifestPath: string): ModData` — initialize ModData
  - Common argument parsing utilities

#### 3.5.21 ReplayMetadataCommand

- [ ] **TODO-21.E.21** `src/OpenRA.Mods.Common/UtilityCommands/ReplayMetadataCommand.ts` (50 lines C#) — Replay metadata reader:
  - `name: "replay-metadata"`
  - Reads replay file header and extracts metadata (map, players, duration, version)
  - Outputs metadata as JSON for further processing
  - Integration with Ch17 replay system

**Phase E Summary**: 22 files (21 commands + 1 new UtilityRunner), ~2,704 C# lines source. Estimated: 22 impl + 14 test = 36 files, ~105 tests, ~5,050 TS lines.

---

### 3.6 Phase F: Utility Commands — Documentation & Export

**Status**: 🔜 PLANNING (5 active + 8 deferred)
**Complexity**: LOW-MEDIUM (DocumentationHelpers 205 lines MEDIUM, OutputResolvedRules 55 lines LOW)
**Blocked by**: Phase E (UtilityRunner, UtilityHelpers)
**Blocks**: No phase depends on docs tools (leaf node)

**Description**: Documentation generation and build output commands. These tools auto-generate documentation from mod data — resolved rules, sequences, weapons, settings, and man pages. `DocumentationHelpers` provides shared utilities for traversing trait metadata and formatting output. The `OutputResolved*` commands dump the fully-resolved (after inheritance and defaults) rules/sequences/weapons as structured output. `CreateManPage` generates UNIX man page format. `ExtractSettingsDocsCommand` generates settings documentation. Several Lua/IDE-specific documentation extractors are deferred as they're not relevant to the web platform.

**Paradigm Shifts**:
- C# `FieldLoader` reflection-based metadata → TypeScript JSON Schema introspection
- C# `Console.WriteLine` output → Node.js stdout / file writing
- C# EmmyLua annotation generation → NOP (web platform uses TypeScript types for self-documentation)
- C# ZeroBrane Studio Lua API → NOP (ZeroBrane is a desktop Lua IDE)

#### 3.6.1 CreateManPage

- [ ] **TODO-21.F.1** `src/OpenRA.Mods.Common/UtilityCommands/CreateManPage.ts` (109 lines C#) — Man page generator:
  - `name: "create-man-page"`
  - Generates UNIX `man` page format for OpenRAWeb3D
  - Includes command-line options, environment variables, file paths
  - Outputs to stdout or file

#### 3.6.2 OutputResolvedRulesCommand

- [ ] **TODO-21.F.2** `src/OpenRA.Mods.Common/UtilityCommands/OutputResolvedRulesCommand.ts` (55 lines C#) — Resolved rules dump:
  - `name: "output-resolved-rules"`
  - Dumps fully-resolved actor definitions (after trait inheritance, defaults) as JSON
  - Useful for debugging trait defaults and inheritance chains

#### 3.6.3 OutputResolvedSequencesCommand

- [ ] **TODO-21.F.3** `src/OpenRA.Mods.Common/UtilityCommands/OutputResolvedSequencesCommand.ts` (55 lines C#) — Resolved sequences dump:
  - `name: "output-resolved-sequences"`
  - Dumps fully-resolved sprite sequences as JSON
  - Includes inherited sequence defaults

#### 3.6.4 OutputResolvedWeaponsCommand

- [ ] **TODO-21.F.4** `src/OpenRA.Mods.Common/UtilityCommands/OutputResolvedWeaponsCommand.ts` (55 lines C#) — Resolved weapons dump:
  - `name: "output-resolved-weapons"`
  - Dumps fully-resolved weapon definitions as JSON
  - Includes warhead and projectile type resolutions

#### 3.6.5 DebugChromeRegions

- [ ] **TODO-21.F.5** `src/OpenRA.Mods.Common/UtilityCommands/DebugChromeRegions.ts` (185 lines C#) — Chrome debug tool:
  - `name: "debug-chrome-regions"`
  - Renders Chrome widget layout with colored rectangles for each widget region
  - Outputs PNG image of the widget layout
  - Used for UI layout debugging

#### 3.6.6 DocumentationHelpers

- [ ] **TODO-21.F.6** `src/OpenRA.Mods.Common/UtilityCommands/Documentation/DocumentationHelpers.ts` (205 lines C#) — Doc generation helpers:
  - `getAllTraitInfos(ruleset: Ruleset): TraitDocEntry[]` — enumerate all trait types
  - `formatTraitDoc(entry: TraitDocEntry): string` — format trait as markdown
  - `getTraitFields(traitType: string): FieldDoc[]` — extract trait field metadata
  - `getEnumValues(enumType: string): string[]` — extract enum values
  - Shared formatters reused by all doc extraction commands

#### 3.6.7 ExtractSettingsDocsCommand

- [ ] **TODO-21.F.7** `src/OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractSettingsDocsCommand.ts` (112 lines C#) — Settings documentation:
  - `name: "extract-settings-docs"`
  - Generates markdown documentation for all game settings
  - Includes setting name, type, default value, description
  - Groups settings by category (Graphics, Sound, Gameplay, Debug)

**Deferred Documentation Commands (8 files, ~1,430 C# lines):**

| File | Reason for Deferral |
|------|---------------------|
| `ExtractEmmyLuaAPI.cs` (478 lines) | EmmyLua annotations for Lua IDE — web platform uses TypeScript types. Deferred until full Lua scripting adoption. |
| `ExtractLuaDocsCommand.cs` (210 lines) | Lua API documentation generator — only needed if Lua scripting is widely used. |
| `ExtractSpriteSequenceDocsCommand.cs` (103 lines) | Sprite sequence documentation — build-time only, low priority. |
| `ExtractTraitDocsCommand.cs` (91 lines) | Trait documentation — build-time only, low priority. |
| `ExtractWeaponDocsCommand.cs` (85 lines) | Weapon documentation — build-time only, low priority. |
| `ExtractZeroBraneStudioLuaAPI.cs` (146 lines) | ZeroBrane Studio is a desktop Lua IDE — NOP for web platform. |
| `FuzzMapGeneratorCommand.cs` (~400 lines) | Random map fuzzer for testing — deferrable internal tool. |
| `Documentation/Objects/` (5 files: `ExtractedClassFieldAttributeInfo`, `ExtractedClassFieldInfo`, `ExtractedClassInfo`, `ExtractedEnumInfo`, `ExtractedTraitInfo`; 135 lines total) | Plain data objects used by `DocumentationHelpers`. Absorbed into `DocumentationHelpers.ts` as TypeScript interfaces/type aliases. No separate migration needed. |

**Phase F Summary**: 7 active + 6 deferred files. Active files: ~776 C# lines. Plus 5 Documentation/Objects/ data classes (135 lines) absorbed into `DocumentationHelpers.ts`. Estimated: 7 impl + 4 test = 11 files, ~40 tests, ~1,200 TS lines.

---

### 3.7 Phase G: Legacy Map Import Tools (C&C / D2K)

**Status**: 🔜 PLANNING (7 active + 11 deferred)
**Complexity**: LOW-MEDIUM (D2kMapImporter 530 lines deferred, Glob 127 lines LOW)
**Blocked by**: Phase E (UtilityRunner — import tools use the same command infrastructure), Chapter 19 (C&C/D2K mod content — importers reference mod-specific file formats)
**Blocks**: No phase depends on import tools (leaf node)

**Description**: Tools for importing legacy game maps and converting legacy asset formats. The active subset includes simple utilities (`Rgba2Hex` color converter, `Glob` file pattern matcher, basic PNG↔SHP conversion). The deferred subset includes full map importers for C&C1, Red Alert 1, Tiberian Sun, and Dune 2000 — these are large, format-specific converters that are NOT needed for MVP. They should be implemented as separate Node.js scripts loaded via dynamic `import()` only when a user explicitly imports a legacy map.

**Paradigm Shifts**:
- C# binary file reading (`BinaryReader`, `Stream.Read`) → Node.js `Buffer` / `DataView`
- C# `Palette` / `Sprite` image processing → Node.js `sharp` for PNG conversion
- C# legacy map format parsers → TypeScript binary parsers (struct-by-struct port)
- C# `System.IO.MemoryMappedFiles` → Node.js `Buffer` for large file processing

#### 3.7.1 Rgba2Hex

- [ ] **TODO-21.G.1** `src/OpenRA.Mods.Common/UtilityCommands/Rgba2Hex.ts` (286 lines C#) — Color tool:
  - `name: "rgba2hex"`
  - Converts RGBA color values to hex string format
  - Batch conversion from files
  - Palette file processing
  - Output format options (CSS hex, GLSL vec4, JSON)

#### 3.7.2 Glob

- [ ] **TODO-21.G.2** `src/OpenRA.Mods.Cnc/UtilityCommands/Glob.ts` (127 lines C#) — File glob utility:
  - `glob(pattern: string, baseDir: string): string[]` — find files matching pattern
  - Supports `*` (single segment) and `**` (recursive) wildcards
  - Cross-platform path normalization
  - Used by other import tools for batch file discovery

#### 3.7.3 RemapShpCommand

- [ ] **TODO-21.G.3** `src/OpenRA.Mods.Cnc/UtilityCommands/RemapShpCommand.ts` (89 lines C#) — SHP palette remap:
  - `name: "remap-shp"`
  - Remaps SHP sprite colors from one palette to another
  - Batch processing of SHP files
  - Preserves transparency indices

#### 3.7.4 ConvertPngToShpCommand

- [ ] **TODO-21.G.4** `src/OpenRA.Mods.Cnc/UtilityCommands/ConvertPngToShpCommand.ts` (59 lines C#) — PNG to SHP:
  - `name: "convert-png-to-shp"`
  - Converts PNG images to SHP sprite format
  - Inverse of `ConvertSpriteToPngCommand`

#### 3.7.5 PngSheetExportMetadataCommand

- [ ] **TODO-21.G.5** `src/OpenRA.Mods.Common/UtilityCommands/PngSheetExportMetadataCommand.ts` (38 lines C#) — Sheet metadata export:
  - `name: "png-sheet-export-metadata"`
  - Exports sprite sheet metadata (frame positions, sizes) alongside PNG export

#### 3.7.6 PngSheetImportMetadataCommand

- [ ] **TODO-21.G.6** `src/OpenRA.Mods.Common/UtilityCommands/PngSheetImportMetadataCommand.ts` (68 lines C#) — Sheet metadata import:
  - `name: "png-sheet-import-metadata"`
  - Imports sprite sheet metadata to reconstruct sprite positions

**Deferred Legacy Map Importers (11 files, ~3,000 C# lines):**

| File | Lines | Reason for Deferral |
|------|:---:|---------------------|
| `LegacyRulesImporter.cs` | 208 | C&C1 rules.ini → OpenRA YAML. Low-value for MVP. |
| `LegacySequenceImporter.cs` | 275 | C&C1 art.ini → sequences.yaml. Low-value for MVP. |
| `LegacyTilesetImporter.cs` | 192 | C&C1 temperat.pal / desert.pal → tileset. Low-value for MVP. |
| `ImportGen1MapCommand.cs` | 506 | C&C1 / RA1 .BIN map import. Complex binary format. |
| `ImportGen2MapCommand.cs` | 579 | C&C1 / RA1 .MPR map import. Complex binary format. |
| `ImportRedAlertMapCommand.cs` | 253 | RA1-specific map format variants. |
| `ImportTiberianDawnMapCommand.cs` | 186 | TD-specific map format. |
| `ImportTiberianSunMapCommand.cs` | 334 | TS .MAP import. Most complex legacy format. |
| `D2kMapImporter.cs` | 530 | Dune 2000 .MAP import. Complex format. |
| `ImportD2kMapCommand.cs` | 44 | D2K CLI wrapper. |
| `FuzzMapGeneratorCommand.cs` | ~400 | Random fuzzer: generates random maps to stress-test the engine. Dev tool only. |

These importers are valuable for backward compatibility with the OpenRA map ecosystem but are NOT on the critical path. Each importer requires deep knowledge of a legacy binary file format. Recommended approach: implement as separate `scripts/import-*.mjs` files with dynamic `import()` loading, implemented post-MVP when community demand justifies the effort.

**Phase G Summary**: 6 active files, ~667 C# lines. Estimated: 6 impl + 4 test = 10 files, ~35 tests, ~1,200 TS lines. Plus 12 deferred files (~3,117 C# lines) for post-MVP (including TSEditorResourceLayer at 117 lines).

---

## 4. Dependency Graph

```
Chapters 2-19 (COMPLETE — Foundation: 603/603 files, 100%). Chapter 20 (COMPLETE — 62/62 files, 100%, all phases A-G)
  |
  +---> Phase A (Editor Core Infrastructure: 8 files)
  |       |
  |       +---> Phase B (Editor Brushes: 10 files)
  |       |       |
  |       |       +---> Phase C (Editor UI Logic: 16 files) ✅ LEAF NODE
  |       |
  |       +---> Phase C (direct dependency: UI panels need editor traits)
  |
  +---> Phase D (Debug & Developer Tools: 7 files) ✅ LEAF NODE
  |       |
  |       +---> (Independent of editor — used in both game and editor modes)
  |
  +---> Phase D (Debug & Dev Tools: 7 files — IUtilityCommand interface)
  |       |
  |       +---> Phase E (Core Build Tools: 22 files — all commands implement IUtilityCommand)
  |       |       |
  |       |       +---> Phase F (Documentation & Export: 7 active + 6 deferred)
  |       |       |       |
  |       |       |       +---> (Leaf node — docs tools are standalone)
  |       |       |
  |       |       +---> Phase G (Legacy Map Import: 6 active + 12 deferred)
  |       |               |
  |       |               +---> (Leaf node — importers are standalone scripts)
  |       |
  |       +---> (DebugVisualizations, DevCommands, DeveloperMode, Editor-only renders are true leaf nodes within Phase D)
```

### Critical Path

```
Phase A (EditorActionManager + EditorActorLayer) → Phase B (EditorDefaultBrush + brushes) → Phase C (UI panels)
Phase D (independent, can parallel with all phases)
Phase E (UtilityRunner) → Phase F (docs commands) + Phase G (import commands)
```

### Parallelization Opportunities

- **Phase A files 4, 7, 8**: EditorCursorLayer (53 lines), EditorSelectionAnnotationRenderable (79 lines), MapEditorData (26 lines) — all LOW complexity, independent of each other
- **Phase B files 11-17**: All brushes except EditorDefaultBrush can be parallel-assigned (all share the `IEditorBrush` interface)
- **Phase C files 19-34**: UI logic files are independent of each other (each is a separate panel). Only MapEditorLogic must be first (root controller)
- **Phase D files 35-41**: All debug/dev files are independent of each other
- **Phase E files 43-61**: All utility commands are independent (each is a self-contained CLI command)
- **Phase F + Phase G**: Phases F and G are fully independent of each other and of the editor phases (A-C)
- **Phase A-C vs Phase D-G**: Editor (A-C) and Utilities (D-G) are independent tracks — they can run in parallel with separate developers

### Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| EditorActionManager | Must be migrated before any brush (all brushes produce editor actions) |
| EditorActorLayer | Must be migrated before EditorActorBrush and EditorDefaultBrush |
| EditorCursorLayer | Must be migrated before any brush with visual cursor feedback |
| IEditorBrush interface | Must be migrated before any brush implementation |
| EditorDefaultBrush | Must be migrated before EditorCopyPasteBrush (uses its selection state) |
| UtilityRunner | Must be migrated before any utility command (command dispatch) |
| TilingPathTool | Must be migrated before EditorTilingPathBrush (brush uses tool internally) |
| MapEditorLogic | Must be migrated before other UI logic files (root controller for widget tree) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All non-rendering game logic MUST have unit tests. Key test patterns per phase:

- [ ] **TEST-21.1** EditorActionManager undo/redo: add 3 actions, undo 2, verify state, redo 1, verify state; redo stack cleared on new action after undo
- [ ] **TEST-21.2** EditorActorLayer add/remove: create preview actors at various cells, verify `getActorsAt()` returns correct actors, verify removal and name generation
- [ ] **TEST-21.3** EditorActorPreview placement validation: verify cell validity checks (occupied, blocked, out-of-bounds, terrain-incompatible)
- [ ] **TEST-21.4** EditorResourceLayer add/remove: add resources, verify density, netWorth calculation, removal, clone for undo
- [ ] **TEST-21.5** EditorViewportControllerWidget cell-to-viewport coordinate conversion matches OpenRA within 0.5 cell
- [ ] **TEST-21.6** EditorDefaultBrush: drag-select creates correct CellCoordsRegion; Ctrl+click multi-select; Delete removes selected actors
- [ ] **TEST-21.7** EditorTileBrush: paint single tile, paint multi-cell rectangle, verify terrain update matches expected tile indices
- [ ] **TEST-21.8** EditorActorBrush: canPlace validates footprint, placement creates undoable action, repeat placement with Ctrl
- [ ] **TEST-21.9** EditorResourceBrush: density falloff over brush radius, right-click removal, paint preview
- [ ] **TEST-21.10** EditorBlit: copy terrain region, paste at offset, verify all cells match source
- [ ] **TEST-21.11** EditorCopyPasteBrush: copy actors, paste at new location, verify relative positions preserved
- [ ] **TEST-21.12** TilingPathTool: findPath A* result matches OpenRA for same start/end cells; junction tile selection correctness
- [ ] **TEST-21.13** SaveMapLogic: validates required fields, rejects invalid configs, serializes to .oramap format
- [ ] **TEST-21.14** ActorEditLogic: property changes applied correctly, multi-edit propagates to all selected actors
- [ ] **TEST-21.15** DeveloperMode: gate check rejects commands when disabled, allows when enabled
- [ ] **TEST-21.16** DevCommands: give-cash increases player resources by correct amount, spawn-actor places actor at correct cell
- [ ] **TEST-21.17** UtilityRunner: parses args correctly, dispatches to correct command, reports errors for invalid commands
- [ ] **TEST-21.18** CheckYaml: catches syntax errors in sample YAML, validates required fields, reports correct file+line
- [ ] **TEST-21.19** ExtractChromeStrings: extracts all translatable strings from sample Chrome YAML, outputs correct .pot format
- [ ] **TEST-21.20** ResizeMapCommand: resize preserves data in overlapping region, fills new cells with defaults

### 5.2 Per-Phase Test File Estimates

| Phase | Files (Active) | Test Files | Estimated Tests | Est. Test Lines |
|:---|:---:|:---:|:---:|:---:|
| A: Editor Core | 8 | 8 | ~85 | ~2,500 |
| B: Editor Brushes | 10 | 10 | ~110 | ~3,500 |
| C: Editor UI Logic | 16 | 14 | ~120 | ~3,800 |
| D: Debug & Dev Tools | 7 | 5 | ~65 | ~1,800 |
| E: Core Build Tools | 20 | 12 | ~100 | ~3,200 |
| F: Docs & Export | 5 | 3 | ~30 | ~900 |
| G: Legacy Import | 7 | 4 | ~35 | ~1,100 |
| **Total** | **~73 (44 active)** | **~56** | **~545** | **~16,800** |

### 5.3 Visual Acceptance Testing

Editor rendering and interaction require manual visual acceptance tests:

| System | Test Page | Purpose |
|--------|-----------|---------|
| Editor viewport | `/test/ch21-editor/viewport/` | Verify 3D terrain rendering, mouse-to-cell mapping, grid overlay |
| Tile painting | `/test/ch21-editor/tile-brush/` | Verify terrain tile painting, multi-cell brush, visual preview |
| Actor placement | `/test/ch21-editor/actor-placement/` | Verify actor preview, placement validation colors, rotation handle |
| Selection & drag | `/test/ch21-editor/selection/` | Verify drag-select, multi-select, move, delete |
| Undo/redo | `/test/ch21-editor/undo-redo/` | Verify undo/redo stack with tile, actor, and resource changes |
| Save/load | `/test/ch21-editor/save-load/` | Verify map save to .oramap, reload preserves all data |
| Dev commands | `/test/ch21-editor/dev-commands/` | Verify debug overlay toggles, cheat commands, developer mode |
| Map generator | `/test/ch21-editor/map-generator/` | Verify generated map has correct dimensions, terrain, and resources |

### 5.4 Integration Testing

- [ ] **TEST-21.I1** Full editor workflow: create new map → paint terrain → place actors → add resources → undo changes → redo → save → close → open → verify all data preserved
- [ ] **TEST-21.I2** Editor-to-game transition: create map in editor → toggle to game mode → verify actors spawn correctly, resources are harvestable, terrain matches
- [ ] **TEST-21.I3** Multi-tool interaction: select tile brush → paint tiles → switch to actor brush → place actors → switch to resource brush → paint resources → verify all layers coexist correctly
- [ ] **TEST-21.I4** CLI tool pipeline: validate YAML → dump sprite sheets → convert sprites → extract strings → verify output files are valid

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **EditorActorLayer 3D rendering performance** with 500+ preview actors | HIGH | Editor becomes sluggish with large maps | Use `ThinInstances` for actor sprite billboards; LOD: distant actors use simple colored quads; cull actors outside view frustum |
| **Editor brush mouse-to-cell accuracy** | MEDIUM | Tiles/actors placed at wrong cell position | Use `scene.pickWithRay()` on terrain ground mesh; verify cell snapping at 10 random positions against OpenRA's `Viewport.ViewToWorld()`; use CoordinateTransformer for WPos↔Vector3 accuracy |
| **Undo memory accumulation** with many tile changes | MEDIUM | Browser tab OOM on large maps with long undo history | Batch tile changes into single undo action per stroke; limit undo stack depth to 100; use cell-level diff snapshots (not full map copies) |
| **SaveMapLogic .oramap format compatibility** | MEDIUM | Maps saved from web editor can't be opened in OpenRA (or vice versa) | Implement exact .oramap binary format specification; round-trip test: OpenRA save → web open → web save → OpenRA open |
| **TilingPathTool junction tile selection parity** | MEDIUM | Roads/rivers placed with wrong junction tiles look visually wrong | Port OpenRA's tile adjacency rule engine line-for-line; validate junction tiles at all 4-way intersection types |
| **Editor-to-game transition state leak** | LOW | Editor traits remain active in game mode, causing simulation bugs | Strict trait lifecycle management: editor traits implement `IEditorOnly` marker; `World.tick()` skips editor-only traits; mode switch performs full trait refresh |
| **CLI tool cross-platform compatibility** (Windows/Unix paths) | LOW | Utility scripts fail on different OS | Use `path.join()` / `path.relative()` for all file operations; avoid hardcoded path separators; CI tests on both platforms |
| **Legacy map import format complexity** | LOW (deferred) | Importers are large and error-prone | All legacy importers marked DEFERRED for post-MVP; implement only after community demand; each importer independently testable with known-good reference inputs |
| **Editor UI widget layout responsive design** | LOW | Editor panels don't adapt to different screen sizes | Use CSS flexbox/grid for all editor panels; minimum viewport 1280×720; panels resize with viewport |
| **DeveloperMode cheat sync safety** | LOW | Cheat commands could be exploited in multiplayer | All dev commands check `DeveloperMode.enabled` before execution; multiplayer server disables `DeveloperMode` by default; server-side command validation |

### 6.2 Performance Targets (Editor Mode)

| System | Target | Measurement |
|--------|--------|-------------|
| Editor viewport with 256×256 map | 60fps | Babylon.js FPS counter |
| 500+ preview actors rendered | 45fps | `scene.getActiveMeshes().length` > threshold, measure frame time |
| Tile brush paint stroke (100 cells) | <50ms | Action execution time |
| Undo operation (100-cell tile change) | <30ms | Action undo time |
| Map save to .oramap (256×256 map) | <500ms | ZIP compression + file write time |
| Map load from .oramap | <2s | ZIP decompression + map parse + terrain build |

### 6.3 Deferred Features (Post-MVP)

| Feature | Phase | Reason |
|---------|-------|--------|
| Full legacy map importers (C&C1, RA1, TS, D2K) | Phase G | ~3,000 lines; complex binary format parsers; low-value for MVP |
| Lua/EmmyLua documentation generators | Phase F | ~1,430 lines; desktop-IDE-specific; web platform uses TypeScript types |
| FuzzMapGenerator | Phase G | Internal testing tool; not user-facing |
| Map update rule auto-application | Phase E | UpdateModCommand is complex; manual update instructions sufficient for MVP |
| Voxel editor previews (TS/RA2 units) | Phase A | Voxel rendering deferred from Ch19; 2D sprite previews sufficient |
| Multiplayer collaborative map editing | N/A | Feature creep; single-user editor is MVP |
| Map editor mobile/tablet support | N/A | Touch controls deferred; desktop browser only for MVP |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-21.1: Editor as Engine Mode (Not Separate Application)

- **Decision**: The map editor reuses the existing game engine infrastructure (World, Renderer, Widgets, Map) as a mode toggle within the main application, rather than as a separate SPA or application.
- **Rationale**: This mirrors OpenRA's architecture where the editor shares the same process and rendering pipeline. It avoids duplicating the terrain renderer, widget system, and asset loading. Editor-specific functionality is isolated via traits that only load in editor mode.
- **Mitigation**: `EditorWorld` extends `World` with simulation disabled. Editor traits implement `IEditorOnly` marker. Mode switch performs full trait dictionary refresh. `build.rollupOptions` can optionally tree-shake editor code from production game-only builds.

### ADR-21.2: EditorActionManager as Serializable Command Pattern

- **Decision**: All editor mutations go through `EditorActionManager.add(IEditorAction)`. Each action provides `execute()`, `undo()`, and optional `serialize()`.
- **Rationale**: This guarantees every edit is undoable and enables future features like macro recording, action replay, and collaborative editing (shared action log). It matches OpenRA's exact undo/redo semantics.
- **Mitigation**: Actions must be self-contained (carry enough state to undo). Snapshot actions (tile changes, resource changes) store pre-edit cell values. Composite actions group multiple sub-actions into one undo step.

### ADR-21.3: EditorActorPreview as Render-Only Billboard

- **Decision**: Editor preview actors are `Billboard` sprites attached to the Babylon.js scene, NOT full `GameActor` instances. They have no trait dictionary, no activities, no AI.
- **Rationale**: Editor maps can contain hundreds of actors. Creating full `GameActor` instances for each would waste memory and risk accidental simulation. Preview actors are lightweight visual-only representations.
- **Mitigation**: `EditorActorPreview` renders using the same sprite/animation data as game actors (shared `Sprite` / `Animation` types). When the editor transitions to game mode, preview actors are replaced with full `GameActor` instances via `ActorInitializer` (Ch3).

### ADR-21.4: CLI Tools as Standalone Node.js Scripts

- **Decision**: All utility commands (Phase E-G) are implemented as standalone Node.js scripts. Source TypeScript files live under `src/OpenRA.*/UtilityCommands/` (following directory parity convention), with thin entry-point `.mjs` wrappers in a `scripts/` directory that import and run them. These are NOT bundled into the browser application.
- **Rationale**: These tools process files, manipulate packages, and generate documentation — they have no need for WebGL, Babylon.js, or a browser environment. Keeping them as Node.js scripts reduces browser bundle size and avoids loading unnecessary dependencies. Placing source under `src/` preserves directory parity with OpenRA; `scripts/` contains only launcher wrappers.
- **Mitigation**: Each command's TypeScript source lives at its `src/` path (e.g., `src/OpenRA.Game/UtilityCommands/RegisterModCommand.ts`). A companion `scripts/register-mod.mjs` launcher imports and invokes it. Commands are also invocable via `npm run` scripts in `package.json`. The `UtilityRunner.ts` dispatcher is shared between CLI and browser in-game console.

### ADR-21.5: Undo Stack Depth Limit

- **Decision**: The undo stack is capped at 100 entries. Batch operations (tile brush strokes, resource painting) combine multiple cell changes into a single undo entry.
- **Rationale**: Maps can have hundreds of thousands of cells. Storing a full snapshot per cell change would quickly exhaust browser memory. A 100-entry limit with batched actions provides sufficient undo history without memory risk.
- **Mitigation**: Cell-level diffs: tile actions store `Array<{cell: CellCoords, oldTile: Tile, newTile: Tile}>`. Resource actions store `Array<{cell: CellCoords, oldAmount: number, newAmount: number}>`. Only changed cells are stored, not the entire map.

### ADR-21.6: Editor Keyboard Shortcut Strategy

- **Decision**: Editor shortcuts reuse the existing Ch7 hotkey system (`HotkeyReference`, `HotkeyManager`) with editor-specific key bindings registered at editor mode activation and unregistered at deactivation.
- **Rationale**: This avoids duplicating hotkey infrastructure and ensures consistent key handling between game and editor modes. Editor shortcuts (S=Select, T=Tile, Delete=Remove, Ctrl+Z=Undo, Ctrl+Y=Redo) coexist with game hotkeys.
- **Mitigation**: Editor hotkeys are in a `EditorHotkeys` namespace. They take priority over game hotkeys when in editor mode. Conflicts are resolved by mode — game hotkeys are disabled during editing.

### ADR-21.7: Progressive Deferral of Legacy Importers

- **Decision**: All C&C1 / RA1 / TS / D2K legacy map importers are DEFERRED for post-MVP. Only simple utilities (Rgba2Hex, Glob, PNG↔SHP conversion) are included in Chapter 21.
- **Rationale**: Legacy map importers are large (~3,000 lines), complex (require deep knowledge of binary file formats from 1995-2000), and have minimal impact on MVP launch. The primary use case — editing new maps — does not need legacy compatibility. Importers can be implemented incrementally as separate modules post-launch.
- **Mitigation**: Each importer is a self-contained script with no dependencies on the core engine. Community contributors can implement individual importers for the formats they care about. A common `LegacyBinaryReader` utility provides shared binary parsing primitives.

---

## Migration Order and Phasing Strategy

| Phase | Files (Active) | Description | Parallelizable | Recommended Agent |
|:---|:---:|:---|:---|:---|
| **A: Editor Core** | 8 | EditorActionManager, EditorActorLayer, EditorActorPreview, EditorCursorLayer, EditorResourceLayer, Viewport, Selection, MapEditorData | NO (base first: EditorActionManager → others) | migration-develop |
| **B: Editor Brushes** | 10 | IEditorBrush, EditorDefaultBrush, Tile, Actor, Resource, Blit, CopyPaste, Marker, TilingPath brushes + TilingPathTool | YES (all 9 brushes after EditorDefaultBrush) | migration-develop |
| **C: Editor UI Logic** | 16 | All 16 editor UI panel logic classes | YES (all 15 after MapEditorLogic) | migration-develop |
| **D: Debug & Dev Tools** | 7 | IUtilityCommand, DebugVisualizations, DebugCommands, DevCommands, DeveloperMode, Editor-only renders | YES (fully independent of each other) | migration-develop |
| **E: Core Build Tools** | 20 | UtilityRunner + 19 utility commands | YES (all commands independent after UtilityRunner) | migration-develop |
| **F: Docs & Export** | 5 (+8 def) | Documentation generation commands | YES (fully independent) | migration-develop |
| **G: Legacy Import** | 7 (+11 def) | Rgba2Hex, Glob, SHP tools, sheet metadata | YES (fully independent) | migration-develop |

### Recommended Execution Order

1. **Phase A** (Editor Core) → **Phase B** (Editor Brushes) → **Phase C** (Editor UI) — sequential editor track
2. **Phase D** (Debug Tools) — parallel with any phase
3. **Phase E** (Core Build Tools) — parallel with editor track
4. **Phase F** (Docs) + **Phase G** (Import) — after Phase E, parallel with each other

**Estimated timeline**: ~3-4 weeks (single developer, sequential) or ~2 weeks (multi-developer, parallel tracks).

### MVP vs Full Completion

For **MVP launch**, the minimum viable set is:

- **Phase A (8 files)**: 100% — editor cannot function without core infrastructure
- **Phase B (10 files)**: 100% — editor needs at least tile + actor + resource brushes
- **Phase C (16 files)**: 80% — core panels (MapEditor, SaveMap, NewMap, ActorEdit, TileSelector, ActorSelector, MapTools); defer HistoryLog, Overlays, MarkerTiles, GeneratorTool, TilingPathTool
- **Phase D (7 files)**: 50% — DeveloperMode + DevCommands only; defer debug overlays
- **Phase E (20 files)**: 40% — essential tools (CheckYaml, ConvertSpriteToPng, DumpSequenceSheets, ExtractChromeStrings); defer others
- **Phase F (5 files)**: 20% — only if needed for release documentation
- **Phase G (7 files)**: 0% — all deferrable for MVP

**MVP total**: ~30 files (~70% of active files, ~40% of total mapped)

---

> **Chapter 21 milestone**: The final chapter of the OpenRAWeb3D migration. When all phases are complete, the project will have a fully functional in-browser 3D map editor with undo/redo, terrain/actor/resource editing tools, debug overlays, developer cheat commands, and a suite of CLI build tools for mod development.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/remaining_systems_migration_plan.md` Section 3.14 — Original Chapter 21 outline
> - `docs/chapter8_weapons_combat_migration_plan.md` — Chapter 8 plan (format reference)
> - `docs/chapter20_scripting_system_migration_plan.md` — Chapter 20 plan (format reference, most recent completed chapter)
> - `docs/migration_progress.md` — Overall progress tracking
> - `CLAUDE.md` — Project conventions
