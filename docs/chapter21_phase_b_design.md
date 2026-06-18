# Chapter 21 Phase B Design Specification: Editor Brushes

> **Status**: DRAFT — Architect Design Spec
> **Date**: 2026-06-18
> **Scope**: 9 brush files (10 migration units) — EditorDefaultBrush, EditorBlit, EditorTileBrush, EditorActorBrush, EditorResourceBrush, EditorCopyPasteBrush, EditorMarkerLayerBrush, EditorTilingPathBrush, TilingPathTool
> **Prerequisites**: Chapter 21 Phase A COMPLETE (EditorActionManager, EditorActorLayer, EditorActorPreview, EditorCursorLayer, EditorResourceLayer, EditorViewportControllerWidget, EditorSelectionAnnotationRenderable, MapEditorData, IEditorBrush)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Dependency Graph](#2-dependency-graph)
3. [Wave 1: EditorDefaultBrush (Foundation)](#3-wave-1-editordefaultbrush-foundation)
4. [Wave 1-B: EditorBlit (Terrain Copy Utility)](#4-wave-1b-editorblit-terrain-copy-utility)
5. [Wave 2: Independent Brushes](#5-wave-2-independent-brushes)
   - 5.1 [EditorTileBrush](#51-editortilebrush)
   - 5.2 [EditorActorBrush](#52-editoractorbrush)
   - 5.3 [EditorResourceBrush](#53-editorresourcebrush)
6. [Wave 3: Dependent Brushes](#6-wave-3-dependent-brushes)
   - 6.1 [EditorCopyPasteBrush](#61-editorcopypastebrush)
   - 6.2 [EditorMarkerLayerBrush](#62-editormarkerlayerbrush)
   - 6.3 [EditorTilingPathBrush](#63-editortilingpathbrush)
   - 6.4 [TilingPathTool](#64-tilingpathtool)
7. [Shared Data Structures](#7-shared-data-structures)
8. [Test Strategy](#8-test-strategy)
9. [Deferred Items](#9-deferred-items)
10. [Migration Order Recommendation](#10-migration-order-recommendation)

---

## 1. Architecture Overview

### 1.1 Role of Brushes in the Editor

Editor brushes are the active editing tools in the map editor. Each brush implements the `IEditorBrush` interface and receives mouse events routed from `EditorCursorLayer` (which is attached to the editor world actor). Brushes produce `IEditorAction` objects sent to `EditorActionManager` for undo/redo support.

```
User mouse input
    │
    ▼
EditorViewportControllerWidget
    │  (routes MouseInput → active brush)
    ▼
EditorCursorLayer (trait on world actor)
    │  (holds IEditorBrush reference, delegates tickRender/renderAboveShroud/renderAnnotations)
    ▼
IEditorBrush implementation
    │  (consumes mouse, produces IEditorAction objects)
    ▼
EditorActionManager
    │  (undo/redo stacks)
    ▼
Map state mutation (terrain tiles, actors, resources, markers)
```

### 1.2 Key Architectural Decisions (from Chapter 21 Plan ADRs)

**ADR-21.B.1: Brush State Isolation**
Each brush instance is self-contained — it receives mouse events and renders previews independently. Brushes do NOT hold references to each other. The exception is `EditorDefaultBrush`, whose `EditorSelection` state is read by `EditorCopyPasteBrush` (via the clipboard source) and internally by its own `DeleteAreaAction`.

**ADR-21.B.2: EditorBlit as a Shared Utility, Not a Brush**
`EditorBlit` is NOT an `IEditorBrush`. It is a utility class that implements the commit/revert logic for region copy/paste operations. Three consumers use it:
- `EditorDefaultBrush.DeleteAreaAction` — delete selection
- `EditorCopyPasteBrush.CopyPasteEditorAction` — paste clipboard
- `TilingPathTool.PaintTilingPathEditorAction` — paint tiled path

**ADR-21.B.3: EditorAction Granularity**
Actions group multiple atomic mutations:
- Single tile paint = one action per click (can cover a multi-cell template)
- Resource drag = one action per mouse-down-to-mouse-up sequence (accumulates cells)
- Actor placement = one action per click
- Flood fill = one action (many cells)

**ADR-21.B.4: Immutable PathPlan for TilingPath**
The `PathPlan` class in `TilingPathTool` follows a pure immutable pattern — every operation returns a new `PathPlan` instance (or null for removal). This eliminates mutation bugs during complex drag interactions and simplifies undo/redo (just swap the plan reference).

**ADR-21.B.5: Coordinate System Mapping**
The editor viewport maps screen pixel coordinates to cell coordinates (CPos). In 3D/Babylon.js, this is done via `scene.pick()` raycasting onto the terrain mesh. The `cellToVector3()` (from `CoordinateTransformer.ts` in Ch4 Phase I) converts CPos to Babylon.js `Vector3` for preview rendering.

---

## 2. Dependency Graph

```
Phase A Infrastructure (COMPLETE)
    │
    ├── EditorActionManager.ts (IEditorAction, undo/redo stacks)
    ├── EditorActorLayer.ts (actor add/remove/move, spatial index)
    ├── EditorActorPreview.ts (lightweight render proxy)
    ├── EditorResourceLayer.ts (resource add/remove, clone, snapshot)
    ├── EditorCursorLayer.ts (brush holder, cursor mesh)
    ├── EditorViewportControllerWidget.ts (viewport, mouse routing)
    ├── EditorSelectionAnnotationRenderable.ts (drag box rendering)
    └── IEditorBrush.ts (brush interface)

Phase B Wave 1 (Foundation — MUST be first)
    │
    ├── EditorBlit.ts ← TERRAIN COPY ENGINE (shared utility, not a brush)
    │       │             Uses: Map, EditorActorLayer, EditorResourceLayer
    │       │             Produces: BlitTile[], EditorBlitSource, commit/revert
    │       │
    │       ├── EditorTileBrush.ts     ← uses EditorBlit indirectly? NO — uses its own PaintTileEditorAction
    │       ├── EditorResourceBrush.ts ← uses EditorBlit indirectly? NO — uses AddResourcesEditorAction
    │       └── EditorCopyPasteBrush.ts ← DEPENDS on EditorBlit directly
    │
    └── EditorDefaultBrush.ts ← SELECTION/MANIPULATION BRUSH (foundation brush)
            │   Uses: EditorActorLayer, EditorActionManager, EditorResourceLayer, EditorBlit
            │   Exposes: EditorSelection (Area?, Actor?)
            │
            ├── EditorCopyPasteBrush.ts ← reads EditorSelection via clipboard source
            └── (future Phase C UI logic reads Selection state)

Phase B Wave 2 (Independent brushes — parallelizable after Wave 1)
    │
    ├── EditorTileBrush.ts
    │       Depends: Map (terrain tile data), EditorActionManager, ITemplatedTerrainInfo (NOT YET MIGRATED — see deferrals)
    │
    ├── EditorActorBrush.ts
    │       Depends: EditorActorLayer, EditorActorPreview, EditorActionManager
    │
    └── EditorResourceBrush.ts
            Depends: EditorResourceLayer, EditorActionManager, IResourceRenderer (NOT YET MIGRATED — see deferrals)

Phase B Wave 3 (Dependent brushes — after Wave 1+2)
    │
    ├── EditorCopyPasteBrush.ts
    │       Depends: EditorBlit, EditorDefaultBrush.Selection (via clipboard source)
    │
    ├── EditorMarkerLayerBrush.ts
    │       Depends: MarkerLayerOverlay (NOT YET MIGRATED — see deferrals)
    │
    ├── EditorTilingPathBrush.ts
    │       Depends: TilingPathTool, EditorBlit (for paint preview)
    │
    └── TilingPathTool.ts
            Depends: TilingPath, MultiBrush, Direction/DirectionExts (ALL NOT YET MIGRATED — see deferrals)
```

---

## 3. Wave 1: EditorDefaultBrush (Foundation)

### 3.1 Source File

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs` (627 lines)
- Namespace: `OpenRA.Mods.Common.Widgets`
- Also defines: `EditorSelection` class, `IEditorBrush` interface (already extracted to `src/OpenRA.Mods.Common/Editor/IEditorBrush.ts`)

### 3.2 Target Files

- `src/OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.ts` — main class + EditorSelection
- `src/OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.test.ts` — unit tests
- `src/OpenRA.Mods.Common/EditorBrushes/actions/ChangeSelectionAction.ts` — selection change action
- `src/OpenRA.Mods.Common/EditorBrushes/actions/DeleteAreaAction.ts` — delete area action
- `src/OpenRA.Mods.Common/EditorBrushes/actions/MoveActorAction.ts` — move actor action
- `src/OpenRA.Mods.Common/EditorBrushes/actions/RemoveActorAction.ts` — remove actor action
- `src/OpenRA.Mods.Common/EditorBrushes/actions/RemoveResourceAction.ts` — remove resource action

**Rationale for splitting action classes into separate files**: Each inner action class is ~40-100 lines with distinct dependencies (EditorBlitSource, IResourceLayer, EditorActorLayer, EditorActorPreview). Keeping them in one file would create a 600+ line monolithic file that is hard to test and review. Each action gets its own test file.

### 3.3 Class Summary

`EditorDefaultBrush` is the primary selection and manipulation brush. It handles:
- **Click-to-select**: Click on an actor to select it; click on empty space to deselect.
- **Drag-to-select**: Drag a rectangle to create a `CellCoordsRegion` selection.
- **Drag-to-move**: Shift-click or click on selected actor to initiate drag-move.
- **Right-click delete**: Right-click on an actor to remove it; right-click on a resource to clear it.
- **Delete selection**: Delete the current selection area (actors + resources + terrain reset).
- **Copy/Paste integration**: Selection state is read by `EditorCopyPasteBrush` to determine what to copy.

### 3.4 Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `EditorActorLayer` | Phase A COMPLETE | `PreviewsAtWorldPixel()`, `Remove()`, `RemoveRegion()`, `AddRange()`, `MoveActor()` |
| `EditorActionManager` | Phase A COMPLETE | `add(IEditorAction)` |
| `IResourceLayer` | Phase A COMPLETE (EditorResourceLayer) | `GetResource()`, `ClearResources()`, `AddResource()` |
| `EditorViewportControllerWidget` | Phase A COMPLETE | `SetTooltip()`, `SelectionAltColor`, `SelectionAltOffset`, `SelectionMainColor`, `ClearBrush()` |
| `WorldRenderer` | Ch2 COMPLETE | `Viewport.ViewToWorldPx()`, `Viewport.ViewToWorld()`, `ScreenPosition()` |
| `EditorBlit` | Phase B Wave 1B (see Section 4) | `CopyRegionContents()` — used by `DeleteAreaAction` |
| `EditorSelectionAnnotationRenderable` | Phase A COMPLETE | Drag box + selection visualization |
| `CellCoordsRegion` | Ch4 Phase A COMPLETE | `CellCoordsRegion(TopLeft, BottomRight)`, `Contains()`, iteration |
| `CPos` / `CVec` | Ch3/Ch4 COMPLETE | Cell position math |

### 3.5 Key Methods

| Method | Lines (C#) | Description | Test Priority |
|--------|:---:|-------------|:---:|
| `constructor(editorWidget, wr)` | 10 | Resolve traits from world actor | LOW — integration |
| `CalculateActorSelectionPriority(actor)` | 6 | Sort by pixel distance then Z for click targeting | HIGH — pure logic |
| `HandleMouseInput(mi)` | 147 | Central mouse dispatch — drag, select, delete | **CRITICAL** — 15+ test cases |
| `SetSelection(selection)` | 12 | Change selection, fire events, toggle actor.Selected | HIGH — 4 test cases |
| `ClearSelection(updateSelectedTab)` | 11 | Deselect with undo support | HIGH — 3 test cases |
| `DeleteSelection(filters)` | 4 | Delete area via EditorBlit undo action | MEDIUM — delegates to action |
| `Tick()` | 1 | No-op | LOW |
| `TickRender()` | 1 | No-op | LOW |
| `RenderAnnotations()` | 8 | Render drag bounds + selection box | MEDIUM — 2D annotation rendering |
| `RenderAboveShroud()` | 1 | No-op (yield break) | LOW |
| `Dispose()` | 1 | No-op | LOW |

### 3.6 EditorSelection State

```typescript
// C# Equivalent: class EditorSelection { CellCoordsRegion? Area; EditorActorPreview Actor; bool HasSelection; }
interface EditorSelection {
  area: CellCoordsRegion | null  // CPos-based region selection
  actor: EditorActorPreview | null  // Single actor selection
  readonly hasSelection: boolean  // Computed: area !== null || actor !== null
}
```

**Important**: `EditorSelection` is a simple data holder with no methods. The `HasSelection` property is a computed getter. In TypeScript, this is a plain interface with a readonly computed property.

### 3.7 Events

| Event | Trigger | Consumers |
|-------|---------|-----------|
| `SelectionChanged` | `SetSelection()` called | UI panels (Phase C) that show selection details |
| `UpdateSelectedTab` | Selection change or clear | UI tab system (Phase C) to switch tool palette tabs |

In TypeScript, these become typed callback arrays:
```typescript
private selectionChangedCallbacks: Array<() => void> = []
private updateSelectedTabCallbacks: Array<() => void> = []
```

### 3.8 Mouse Input State Machine

The `HandleMouseInput` method implements a state machine with these states:

```
IDLE
  │
  ├── Left Down on actor (+Shift or already selected)
  │     └──> DRAGGING_ACTOR
  │            │  Move: update MoveActorAction.Move(to)
  │            └── Left Up: commit MoveActorAction → IDLE
  │
  ├── Left Down on empty space
  │     └──> POTENTIAL_DRAG (selectionStartLocation set)
  │            │  Move > MinMouseMoveBeforeDrag: → DRAGGING_SELECTION
  │            │  Left Up without drag:
  │            │    ├── Clicked on actor: → set actor selection
  │            │    ├── Clicked on empty: → clear selection
  │            │    └── (never reached IDLE via this path)
  │            │
  │            └──> DRAGGING_SELECTION
  │                   │  Move: update selectionBounds rect
  │                   └── Left Up: commit selection area → IDLE
  │
  └── Right Down on actor → remove actor
  └── Right Down on resource → remove resource
```

### 3.9 Inner Action Classes

Each action class must implement `IEditorAction` (already defined in `EditorActionManager.ts`):

```typescript
interface IEditorAction {
  execute(): void
  undo(): void
  redo(): void
  readonly text: string
}
```

#### 3.9.1 ChangeSelectionAction

**File**: `src/OpenRA.Mods.Common/EditorBrushes/actions/ChangeSelectionAction.ts`

Snapshots the old selection and sets the new one. Both `Do()` and `Undo()` call `defaultBrush.SetSelection()`.

**Constructor args**: `(defaultBrush, selection, previousSelection)`
**Storage**: Copies the `EditorSelection` struct (deep-copies Area and Actor references).
**Text**: Fluent-formatted message based on selection type (area coordinates or actor ID, or "cleared").

**TypeScript approach**: The `FluentProvider.GetMessage` calls are replaced with template literals since FluentProvider is not yet migrated. Example:
```typescript
this.text = selection.area
  ? `Selected area: (${selection.area.topLeft.X},${selection.area.topLeft.Y})`
  : selection.actor
    ? `Selected actor: ${selection.actor.id}`
    : `Cleared selection`
```

#### 3.9.2 DeleteAreaAction

**File**: `src/OpenRA.Mods.Common/EditorBrushes/actions/DeleteAreaAction.ts`

Uses `EditorBlit.CopyRegionContents()` to snapshot the area before deletion.

**Do()**: Clears actors (via `EditorActorLayer.RemoveRegion()`), resets terrain tiles to default, clears height to 0, clears resources.
**Undo()**: Restores tiles, heights, resources from the `EditorBlitSource` snapshot, then re-creates actor copies.

**Key dependency**: This is why `EditorBlit` must be migrated before or alongside `EditorDefaultBrush`. The `DeleteAreaAction.constructor` calls `EditorBlit.CopyRegionContents()` to create the undo snapshot.

#### 3.9.3 MoveActorAction

**File**: `src/OpenRA.Mods.Common/EditorBrushes/actions/MoveActorAction.ts`

Tracks actor movement. `Execute()` is empty (movement happens during drag, not on commit). `Do()` moves the actor to the final position. `Undo()` moves back to the original position. `HasMoved` is a boolean getter (`from !== to`).

**Constructor args**: `(actor: EditorActorPreview, layer: EditorActorLayer)`

**Important**: The `Move(cell)` method is called during drag (not via the action stack). The action is only added to the stack when `HasMoved` is true on mouse up.

#### 3.9.4 RemoveActorAction

**File**: `src/OpenRA.Mods.Common/EditorBrushes/actions/RemoveActorAction.ts`

Simple remove/restore. `Do()` removes from layer, `Undo()` adds back.

**Constructor args**: `(editorActorLayer, actor)` or `(defaultBrush, editorActorLayer, actor)` for the selected-actor variant.

**Two variants in C#**:
- `RemoveActorAction` — right-click remove (simple)
- `RemoveSelectedActorAction` — delete key (also clears selection via `defaultBrush.SetSelection`)

Both can be unified into one class with an optional `defaultBrush` parameter.

#### 3.9.5 RemoveResourceAction

**File**: `src/OpenRA.Mods.Common/EditorBrushes/actions/RemoveResourceAction.ts`

Saves the resource layer contents at the target cell, then clears. Undo restores.

**Constructor args**: `(resourceLayer, cell, resourceType)`

### 3.10 Test Strategy for EditorDefaultBrush

#### Unit Tests (no Babylon.js needed)

Since `HandleMouseInput` does not directly create GPU resources (annotations are delegates to `EditorSelectionAnnotationRenderable`), the entire brush can be unit-tested with mocked dependencies.

**Test categories**:

1. **CalculateActorSelectionPriority** (3 tests)
   - Equal Z: closer pixel distance wins
   - Equal pixel distance: higher Z wins
   - Mixed: priority formula produces correct ordering

2. **SetSelection** (4 tests)
   - Set area selection → fires SelectionChanged
   - Set actor selection → actor.Selected = true
   - Set same selection → no event fire
   - Previous actor.Selected = false on new selection

3. **ClearSelection** (3 tests)
   - Clear area → fires UpdateSelectedTab, creates ChangeSelectionAction
   - Clear actor → actor.Selected = false
   - Clear with no selection → no action created

4. **HandleMouseInput — Click on actor** (3 tests)
   - Left click on actor → actor becomes selection
   - Left click on empty → clear selection
   - Click on already-selected actor → no change (if not drag)

5. **HandleMouseInput — Drag selection** (4 tests)
   - Drag > 32px → selectionBounds created
   - Drag release → selection area set
   - Drag < 32px → no bounds (treated as click)
   - Annotation renderables produced for drag bounds

6. **HandleMouseInput — Drag actor** (4 tests)
   - Shift+click on actor → draggingActor = true, MoveActorAction created
   - Drag move → MoveActorAction.Move() called with new cell
   - Release → action committed if HasMoved
   - Release without move → action discarded

7. **HandleMouseInput — Right-click delete** (3 tests)
   - Right-click on actor → RemoveActorAction added
   - Right-click on resource → RemoveResourceAction added
   - Right-click on empty → no action

8. **HandleMouseInput — Scroll/Move pass-through** (2 tests)
   - Mouse move events always return false (allow bubbling)
   - Scroll events always return false

9. **DeleteSelection** (2 tests)
   - Delete area → DeleteAreaAction created with correct filters
   - Filters control what gets deleted (terrain/resources/actors)

10. **Event propagation** (2 tests)
    - SelectionChanged fires correct number of times
    - UpdateSelectedTab fires on clearSelection(true)

**Estimated test count**: ~30 tests

### 3.11 Potential Pitfalls

- **MinMouseMoveBeforeDrag constant (32)**: This is in screen pixels. In Babylon.js, the viewport coordinate system may differ. The threshold should remain in logical screen pixels (same as OpenRA) since `Viewport.ViewToWorldPx()` handles the conversion.
- **SelectionStartLocation management**: Must be cleared on mouse up AND when switching brushes. The brush does NOT handle brush-switch cleanup itself — `EditorCursorLayer.setBrush()` is responsible for calling dispose.
- **Drag pixel offset calculation**: `dragPixelOffset = cellViewPx - mi.Location` — this uses `WorldToViewPx()` which is a 2D viewport operation. In 3D, `screenPosition()` maps a WPos to viewport coordinates. Ensure the 3D equivalent is tested.
- **RemoveSelectedActorAction vs RemoveActorAction**: Two separate classes in C#. The difference is only whether `defaultBrush.SetSelection(new EditorSelection())` is called. In TypeScript, unify into one class with an optional `onClearSelection` callback.
- **Memory**: `previousSelection` stores a copy of the entire selection (including `CellCoordsRegion`). For large selections, this copies a region object. Since `CellCoordsRegion` is a lightweight value type (two CPos), this is fine.

### 3.12 Babylon.js API Mapping

| OpenRA API / Pattern | Babylon.js / TypeScript Replacement | Notes |
|----------------------|--------------------------------------|-------|
| `Viewport.ViewToWorldPx(mi.Location)` | `scene.pick(ray)` on terrain mesh → cell coordinate | 3D raycast replaces 2D viewport math |
| `Viewport.WorldToViewPx(wPos)` | `Vector3.Project()` with view/projection matrix | Project 3D position to 2D screen |
| `actor.Bounds` (Rectangle) | `BoundingInfo` or custom `bounds` property on `EditorActorPreview` | EditorActorPreview must expose screen-space bounds |
| `MouseInput` event struct | Custom `MouseInput` interface matching C# fields | Button, Event (Down/Up/Move/Scroll), Location (Int2), Modifiers |
| `Modifiers.Shift` | `event.shiftKey` | Browser MouseEvent modifier keys |
| `Ui.KeyboardFocusWidget = null` | `document.activeElement?.blur()` | Lose focus for copy/paste keyboard shortcuts |
| `yield return new EditorSelectionAnnotationRenderable(...)` | Return `EditorSelectionAnnotationRenderable[]` array | Pre-allocate array, no yield |
| `Game.CosmeticRandom` | `Math.random()` for PickAny templates | Per-tile random index selection |
| `FluentProvider.GetMessage(...)` | Template literal string | Hardcoded until FluentProvider migrated |
| `using (new PerfTimer(...))` | `performance.now()` wrap (dev only) | Browser Performance API |

### 3.13 Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| FluentProvider localization | FluentProvider not yet migrated; hardcoded English strings acceptable for Phase B | TODO-21.B.1-DEFER-1 |
| PerfTimer using() blocks | Browser `performance.now()` is adequate; skip using() pattern | TODO-21.B.1-DEFER-2 |
| `Game.CosmeticRandom` | Use `Math.random()` as substitute; deterministic RNG deferred | TODO-21.B.1-DEFER-3 |
| `Ui.KeyboardFocusWidget` | `document.activeElement?.blur()` is equivalent | N/A |

---

## 4. Wave 1-B: EditorBlit (Terrain Copy Utility)

### 4.1 Source File

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorBlit.cs` (363 lines)
- Namespace: `OpenRA.Mods.Common.EditorBrushes`

### 4.2 Target Files

- `src/OpenRA.Mods.Common/EditorBrushes/EditorBlit.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/EditorBlit.test.ts`

### 4.3 Class Summary

`EditorBlit` is a **utility class, NOT an `IEditorBrush`**. It implements the commit/revert pattern for copying a rectangular region of map data (terrain tiles, resources, actors) from a source position to a target position. It is the engine behind:
- **DeleteAreaAction** — snapshots region then clears it
- **CopyPasteEditorAction** — pastes clipboard at target position
- **PaintTilingPathEditorAction** — paints a tiled path from a blit source

### 4.4 Key Data Structures

#### BlitTile
```typescript
// C#: readonly record struct BlitTile(TerrainTile, ResourceTile, ResourceLayerContents?, byte Height)
interface BlitTile {
  readonly terrainTile: TerrainTile
  readonly resourceTile: ResourceTile
  readonly resourceLayerContents: ResourceLayerContents | null
  readonly height: number  // byte → number in TS
}
```

#### EditorBlitSource
```typescript
// C#: readonly record struct EditorBlitSource(CellCoordsRegion, Dictionary<string, EditorActorPreview>, Dictionary<CPos, BlitTile>)
interface EditorBlitSource {
  readonly cellCoords: CellCoordsRegion
  readonly actors: Map<string, EditorActorPreview>  // keyed by actor ID
  readonly tiles: Map<string, BlitTile>  // keyed by "X,Y" string (CPos serialization)
}
```

#### MapBlitFilters (flags enum)
```typescript
// C#: [Flags] enum MapBlitFilters { None=0, Terrain=1, Resources=2, Actors=4, All=7 }
const enum MapBlitFilters {
  None = 0,
  Terrain = 1 << 0,
  Resources = 1 << 1,
  Actors = 1 << 2,
  All = Terrain | Resources | Actors  // 7
}
```

### 4.5 Key Methods

| Method | Description | Test Priority |
|--------|-------------|:---:|
| `static CopyRegionContents(map, actorLayer, resourceLayer, region, filters, mask?)` | Snapshot map region into EditorBlitSource | **CRITICAL** — 8+ tests |
| `constructor(blitFilters, resourceLayer, blitPosition, map, blitSource, actorLayer, respectBounds)` | Create blit with commit source and auto-generated revert source | HIGH — 3+ tests |
| `private Blit(isRevert)` | Core commit/revert logic | **CRITICAL** — 6+ tests |
| `Commit()` | Apply blit (calls `Blit(false)`) | MEDIUM — delegates |
| `Revert()` | Undo blit (calls `Blit(true)`) | MEDIUM — delegates |
| `static PreviewBlitSource(blitSource, filters, offset, wr, stickToGround)` | Generate renderables for preview | MEDIUM — 3D preview |
| `static GetBlitSourceMask(blitSource, offset)` | Find occupied cells within blit source | HIGH — 4+ tests |
| `TileCount()` / `ActorCount()` | Statistics for FluentProvider messages | LOW |

### 4.6 Core Algorithm: CopyRegionContents

```
1. Create empty tiles Map (CPos key → BlitTile) and actors Map (ID → EditorActorPreview)
2. If Terrain or Resources filter:
   a. For each cell in region:
      - Skip if !map.Tiles.Contains(cell) or (mask != null and !mask.Contains(cell))
      - Add BlitTile with terrain tile, resource tile, resource layer contents, height
3. If Actors filter:
   a. For each preview in actorLayer.PreviewsInCellRegion(region):
      - Skip if mask != null and no footprint cell in mask
      - Add to actors Map (TryAdd = skip if ID already present)
4. Return new EditorBlitSource(region, actors, tiles)
```

### 4.7 Core Algorithm: Blit (commit vs revert)

The `Blit()` method uses different source/offset logic for commit vs revert:

**Commit** (isRevert=false):
- Source = commitBlitSource (user's clipboard/selection)
- blitVec = blitPosition - source.CellCoords.TopLeft
- Remove actors in target region first, then paint tiles/resources/actors

**Revert** (isRevert=true):
- Source = revertBlitSource (auto-captured from target area)
- blitVec = source.CellCoords.TopLeft - source.CellCoords.TopLeft = 0 (identity)
- The revert source was captured at the original target positions, so no offset needed

### 4.8 Sparse Blit Mask

The `GetBlitSourceMask()` method supports **sparse blits** — when the clipboard source doesn't fill its entire bounding rectangle. The mask is a `Set<CPos>` (conceptually, keyed by serialized cell position) containing only cells that actually have tiles or actor footprints. This is critical for:
- Copy-paste of non-rectangular actor groups
- Delete operations that only clear occupied cells

### 4.9 Test Strategy for EditorBlit

1. **CopyRegionContents — full region** (3 tests)
   - All filters (Terrain|Resources|Actors) with mock data
   - Terrain-only filter
   - Actors-only filter

2. **CopyRegionContents — with mask** (2 tests)
   - Mask excludes some cells → only masked cells in result
   - Actor partially outside mask → only overlapping cells in mask

3. **Blit commit** (3 tests)
   - Terrain tiles copied to target offset correctly
   - Resources copied with density preserved
   - Actors deep-copied with LocationInit offset

4. **Blit revert** (2 tests)
   - Revert restores original tiles after commit
   - Revert restores original actors after commit

5. **Blit with respectBounds** (2 tests)
   - respectBounds=true: tiles outside map bounds skipped
   - respectBounds=false: tiles placed anywhere (TilingPath uses this)

6. **GetBlitSourceMask** (3 tests)
   - All tiles included in mask
   - Actor footprints included in mask
   - Empty blit source = empty mask

7. **Edge cases** (2 tests)
   - Blit of empty region (commit is no-op)
   - Overlapping commit/revert (same position)

**Estimated test count**: ~17 tests

### 4.10 Potential Pitfalls

- **Sparse blit mask complexity**: The comment in the C# source explains that `revertBlitSource`'s mask may be a superset of `commitBlitSource`'s mask. The commit uses the commit mask for actor removal (to avoid removing actors not in the paste). This logic must be preserved exactly.
- **Actor deep-copy**: `actor.Export()` creates a new `ActorReference` copy. The `LocationInit` must be offset by `blitVec`. Other inits (Owner, Faction, SubCell, Facing) are preserved.
- **Resource clearing before painting**: Resources are cleared before new resources are added. This prevents double-density on overlapping paste operations.
- **IMPORTANT: EditorBlit does NOT call `EditorActionManager`**. It is a pure utility. Actions that use it (like `DeleteAreaAction`, `CopyPasteEditorAction`) wrap it in an `IEditorAction`.

---

## 5. Wave 2: Independent Brushes

### 5.1 EditorTileBrush

#### 5.1.1 Source

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.cs` (383 lines)

#### 5.1.2 Target

- `src/OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/PaintTileEditorAction.ts` (inner class)
- `src/OpenRA.Mods.Common/EditorBrushes/actions/FloodFillEditorAction.ts` (inner class)
- `src/OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.test.ts`

#### 5.1.3 Class Summary

Paints terrain template tiles onto the map. Templates are multi-cell rectangular blocks of terrain (e.g., a 3x3 cliff corner). The brush supports:
- **Single-click paint**: Places the template at the clicked cell
- **Drag paint**: Continuous painting as the mouse moves
- **Shift+click flood fill**: Replaces all connected tiles of the same type
- **Duplicate avoidance**: `PlacementOverlapsSameTemplate()` check prevents re-painting cells already using the same template

#### 5.1.4 Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `ITemplatedTerrainInfo` | **NOT YET MIGRATED** | `TerrainInfo` from Ch4 Phase C — check if it implements this |
| `ITiledTerrainRenderer` | **NOT YET MIGRATED** | `TerrainRenderer` from C# — used for `RenderPreview()` |
| `EditorActionManager` | Phase A COMPLETE | Action stack |
| `EditorViewportControllerWidget` | Phase A COMPLETE | `ClearBrush()` on right-click |
| `Map.Tiles` / `Map.Height` | Ch4 Phase D COMPLETE | CellLayer access |
| `TerrainTemplateInfo` | **NOT YET MIGRATED** | Template data model from `TerrainInfo` |
| `Game.CosmeticRandom` | **DEFERRED** | Use `Math.random()` |

**IMPORTANT**: `EditorTileBrush` has the highest number of unmigrated dependencies. The brush constructor checks `terrainInfo as ITemplatedTerrainInfo` and throws if the terrain is not template-based. In TypeScript, this becomes a runtime type check:

```typescript
if (!('templates' in terrainInfo) || !(terrainInfo instanceof TemplatedTerrainInfo)) {
  throw new Error('EditorTileBrush can only be used with template-based tilesets')
}
```

#### 5.1.5 Key Methods

| Method | Lines | Description | Test Priority |
|--------|:---:|-------------|:---:|
| `constructor(editorWidget, templateId, wr)` | 15 | Validate terrain type, resolve traits | MEDIUM |
| `HandleMouseInput(mi)` | 43 | Left=start/stop painting, Right=clear brush, Shift=flood fill | **CRITICAL** |
| `PaintCell(cell, isMoving)` | 7 | Create PaintTileEditorAction, with overlap optimization | HIGH |
| `FloodFillWithBrush(cell)` | 12 | Guard, check not replacing same type, create FloodFillEditorAction | HIGH |
| `PlacementOverlapsSameTemplate(template, cell)` | 15 | Check if placing template would duplicate existing template | HIGH |
| `UpdatePreview()` | 4 | Generate terrain preview renderables at cursor cell | MEDIUM |
| `TickRender()` | 7 | Update preview when cursor cell changes | MEDIUM |

#### 5.1.6 Inner Actions

**PaintTileEditorAction** (67 lines C#):
- Iterates template grid (size.X x size.Y)
- For each contained tile with non-null terrain info: sets `map.Tiles[c]` and `map.Height[c]`
- Uses `PickAny` flag: if true, picks random tile index from template (via `Math.random()`); otherwise uses the template grid index
- Undo: restores original tiles/heights from `Queue<UndoTile>` (FIFO order)

**FloodFillEditorAction** (103 lines C#):
- BFS flood fill algorithm using `CellLayer<bool>` for visited tracking
- `ShouldPaint()`: checks if all cells in template footprint at position match the replace type
- `FindEdge()`: scans left/right along X axis to find the extent of contiguous matching cells
- For each X in range, paints the cell, then checks above/below neighbors for BFS expansion
- **Algorithm complexity**: O(cells_in_region * template_area) — worst case could be expensive on large maps

**UndoTile record**:
```typescript
// C#: sealed record UndoTile(CPos Cell, TerrainTile MapTile, byte Height)
interface UndoTile {
  readonly cell: CPos
  readonly mapTile: TerrainTile
  readonly height: number  // byte
}
```

#### 5.1.7 Migration Challenges

**Challenge 1: ITemplatedTerrainInfo dependency**
`EditorTileBrush` requires the terrain info to implement `ITemplatedTerrainInfo`, which provides `Templates[]` (indexed by ushort ID, returning `TerrainTemplateInfo`). In the current migration, `TerrainInfo` was migrated as part of Ch4 Phase C. Check if the template support was included:
- If YES: The brush can use it directly.
- If NO: This becomes a prerequisite — `TerrainTemplateInfo` must be added or the brush must be deferred.

**Decision**: Check the existing `TerrainInfo.ts` for template support. If missing, create a TODO item to extend `TerrainInfo` with template-based terrain data during Phase B migration.

**Challenge 2: ITiledTerrainRenderer.RenderPreview()**
The tile brush shows a preview of the template at the cursor position. In OpenRA, this is rendered via `terrainRenderer.RenderPreview(wr, template, wPos)`. In 3D/Babylon.js, the terrain preview must be rendered as semi-transparent quads at the cursor cell's world position.

**Proposed approach**: Create a lightweight `terrainRendererPreview()` function that takes template data and renders colored quads via `MeshBuilder.CreatePlane()` instances. These are NOT added to the scene permanently — they are repositioned each frame. For the initial Phase B migration, the preview can be **deferred** (return empty array) and implemented as TODO-21.B.2-DEFER-1.

**Challenge 3: Flood fill BFS on large maps**
The `CellLayer<bool>` allocation for visited tracking could be expensive on large maps (e.g., 256x256 = 65K cells). In TypeScript, use a `Uint8Array` for efficient memory usage:

```typescript
const visited = new Uint8Array(mapSize.X * mapSize.Y)
// Check: touched[cellIndex] !== 0
// Mark: touched[cellIndex] = 1
```

#### 5.1.8 Test Strategy

1. **PaintCell** (3 tests)
   - Single template placement: tiles + height set correctly
   - PickAny=true: random index selected
   - Placement outside map bounds: cell skipped

2. **PlacementOverlapsSameTemplate** (3 tests)
   - No overlap: returns false
   - Full overlap: returns true
   - Partial overlap (some cells match, some don't): returns true

3. **Flood fill** (4 tests)
   - Single-type region: all cells replaced
   - Mixed-type border: stops at different type
   - Replace-same-type: action not created (guard check)
   - Cell outside map: no action

4. **Undo** (3 tests)
   - PaintTile undo: restores original tile + height
   - FloodFill undo: restores all tiles in correct order
   - Multiple paint then undo: all cells restored

5. **Mouse handling** (4 tests)
   - Left down starts painting
   - Left up stops painting
   - Right click clears brush
   - Shift+click triggers flood fill

**Estimated test count**: ~17 tests

---

### 5.2 EditorActorBrush

#### 5.2.1 Source

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.cs` (180 lines)

#### 5.2.2 Target

- `src/OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/AddActorAction.ts` (inner class)
- `src/OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.test.ts`

#### 5.2.3 Class Summary

Places actors onto the map. Maintains a preview `EditorActorPreview` that follows the cursor. On left-click, creates an `AddActorAction` and commits the actor to `EditorActorLayer`.

Key behaviors:
- **Center offset**: Buildings may have a `CenterOffset(world)` that shifts the placement anchor. The preview position is adjusted by this offset.
- **SubCell sharing**: If the actor has `IOccupySpaceInfo.SharesCell`, the brush finds a free `SubCell` within the target cell for multi-actor stacking.
- **Facing initialization**: If the actor has `IFacingInfo`, the default facing from `editorLayer.Info.DefaultActorFacing` is applied.
- **Owner validation**: If the actor requires specific owners (`RequiresSpecificOwners`), the first valid owner is used.
- **Footprint validation**: Before placing, all footprint cells must be inside the map.

#### 5.2.4 Key Methods

| Method | Description | Test Priority |
|--------|-------------|:---:|
| `constructor(editorWidget, actorInfo, owner, wr)` | Create preview actor with correct owner, faction, location, subcell, facing | HIGH |
| `HandleMouseInput(mi)` | Left click=place actor, Right click=clear brush | **CRITICAL** |
| `TickRender()` | Update preview position + subcell when cursor moves | HIGH |
| `RenderAboveShroud()` | Render preview actor (sorted by Z) | MEDIUM |
| `RenderAnnotations()` | Render preview actor annotations (range circles, etc.) | MEDIUM |

#### 5.2.5 Owner Resolution Logic

```typescript
// C# logic from constructor:
// 1. Start with the provided owner name
// 2. If actor requires specific owners and the provided owner is not valid:
//    → use the first valid owner name
// 3. Create ActorReference with OwnerInit + FactionInit
let ownerName = owner.name
const specificOwnerInfo = actorInfo.traitInfoOrDefault<RequiresSpecificOwnersInfo>()
if (specificOwnerInfo && !specificOwnerInfo.validOwnerNames.includes(ownerName)) {
  ownerName = specificOwnerInfo.validOwnerNames[0]
}
```

#### 5.2.6 Inner Action: AddActorAction

Simple add/remove. `Do()` adds the actor to the layer (generating a unique ID), `Undo()` removes it.

**Constructor**: Takes an `ActorReference` clone (immutable copy).

#### 5.2.7 Test Strategy

1. **Constructor — owner selection** (3 tests)
   - Valid owner passed: used directly
   - Invalid owner, RequiresSpecificOwners: first valid owner used
   - No RequiresSpecificOwners: any owner accepted

2. **Constructor — center offset** (2 tests)
   - Building with CenterOffset: preview placed at adjusted position
   - Actor without CenterOffset: preview at cursor cell directly

3. **Constructor — subcell** (2 tests)
   - SharesCell=true and free subcell available: SubCellInit added
   - SharesCell=true but no free subcell: SubCellInit omitted

4. **HandleMouseInput** (4 tests)
   - Left click: AddActorAction created with exported reference
   - Left click with footprint outside map: no action
   - Right click: ClearBrush called
   - Non-left/right button: returns false

5. **TickRender — position update** (2 tests)
   - Cursor cell unchanged: preview not updated
   - Cursor cell changed: preview LocationInit replaced

**Estimated test count**: ~13 tests

---

### 5.3 EditorResourceBrush

#### 5.3.1 Source

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.cs` (161 lines)

#### 5.3.2 Target

- `src/OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/AddResourcesEditorAction.ts` (inner class)
- `src/OpenRA.Mods.Common/EditorBrushes/EditorResourceBrush.test.ts`

#### 5.3.3 Class Summary

Paints resources (tiberium, ore, gems) onto the map. Unlike the tile brush, resources are **accumulated across a drag** and committed as a single action on mouse up.

Key behaviors:
- **Accumulation pattern**: Each drag movement adds a `CellResource` to the pending action. The action is not pushed to `EditorActionManager` until mouse up.
- **Max density**: Resources are always placed at maximum density (via `resourceLayer.GetMaxDensity(type)`).
- **CanAddResource guard**: Only cells where the resource type can be placed are affected.
- **Preview suppression**: While painting (action != null), the preview is hidden (returns null instead of the preview list).
- **Undo semantics**: On undo, if the old resource type matches the new type, the cell is cleared. If different, the old type is restored. This handles overlapping resource placement correctly.

#### 5.3.4 Key Data Structures

```typescript
// C#: readonly record struct CellResource(CPos Cell, ResourceLayerContents OldResourceTile)
interface CellResource {
  readonly cell: CPos
  readonly oldResourceTile: ResourceLayerContents  // snapshot before modification
}
```

#### 5.3.5 Key Methods

| Method | Description | Test Priority |
|--------|-------------|:---:|
| `constructor(editorWidget, resourceType, wr)` | Resolve traits, get resource renderers, initial preview | MEDIUM |
| `HandleMouseInput(mi)` | Left drag=accumulate cells, Left up=commit action, Right=clear brush | **CRITICAL** |
| `TickRender()` | Update preview when cursor cell changes | MEDIUM |
| `RenderAboveShroud()` | Preview renderables or null (if painting) | LOW |
| `UpdatePreview()` | Gather resource renderer previews for cursor cell | MEDIUM |

#### 5.3.6 Inner Action: AddResourcesEditorAction

Accumulates cells during drag, applies all at once.

**Add(cellResource)**: Adds to internal list, immediately applies resource to map (for visual feedback), updates text message.
**Execute()**: Trims excess capacity from internal list (C# `TrimExcess()` → TypeScript: not needed, arrays auto-shrink or just leave as-is).
**Do()**: Applies resource to all accumulated cells.
**Undo()**: Iterates each CellResource, restoring old content based on matching logic.

#### 5.3.7 Test Strategy

1. **Constructor** (2 tests)
   - Valid resource type: brush created with resourceRenderers
   - Invalid/unavailable resource type: brush created but CanAddResource always false

2. **HandleMouseInput — drag accumulation** (3 tests)
   - Left down+drag: cell added to action, resource placed immediately
   - Left down on cell where CanAddResource=false: cell skipped
   - Left up: action committed to EditorActionManager, action reset to null

3. **HandleMouseInput — right click** (1 test)
   - Right click: ClearBrush called

4. **AddResourcesEditorAction — Do/Undo** (4 tests)
   - Do: resource placed at all cells
   - Undo with matching types: cells cleared
   - Undo with different old type: old type restored
   - Undo with null old type: cell cleared

5. **Preview visibility** (2 tests)
   - While not painting: preview rendered
   - While painting: preview returns null

**Estimated test count**: ~12 tests

---

## 6. Wave 3: Dependent Brushes

### 6.1 EditorCopyPasteBrush

#### 6.1.1 Source

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.cs` (174 lines)

#### 6.1.2 Target

- `src/OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/CopyPasteEditorAction.ts` (inner class)
- `src/OpenRA.Mods.Common/EditorBrushes/EditorCopyPasteBrush.test.ts`

#### 6.1.3 Class Summary

Pastes a previously-copied `EditorBlitSource` (clipboard) at the cursor position. Left-click places the paste; right-click cancels.

Key behaviors:
- **Preview rendering**: Shows the clipboard contents at the cursor position with `EditorBlit.PreviewBlitSource()`. Terrain tiles are previewed as semi-transparent quads; actors as offset previews.
- **Stick-to-ground**: If terrain filter is not active, actors stick to the terrain height at the target position. If terrain is active, actors preserve their relative height from the source.
- **Annotation**: Draws a selection-box outline (dashed/dotted pattern) around the clipboard region at the preview position.
- **Commit via EditorBlit**: On left-click, creates an `EditorBlit` with `respectBounds=true` and wraps it in `CopyPasteEditorAction`.

#### 6.1.4 Constructor Parameters

```typescript
constructor(
  editorWidget: EditorViewportControllerWidget,
  wr: WorldRenderer,
  clipboard: EditorBlitSource,  // from EditorDefaultBrush.Selection (via copy command)
  resourceLayer: IResourceLayer,
  getCopyFilters: () => MapBlitFilters  // callback to read current filter UI state
)
```

The `getCopyFilters` parameter is a function because the filter state (from editor UI checkboxes) can change between brush creation and paste execution. In C# this is `Func<MapBlitFilters>`. In TypeScript, it's a lambda/callback.

#### 6.1.5 Inner Action: CopyPasteEditorAction

Wraps `EditorBlit`. `Do()` calls `editorBlit.Commit()`, `Undo()` calls `editorBlit.Revert()`. Action text is formatted with tile and actor counts.

#### 6.1.6 Test Strategy

1. **HandleMouseInput** (3 tests)
   - Left click: CopyPasteEditorAction created
   - Right click: ClearBrush called
   - Non-left/right button: returns false

2. **Paste preview position** (2 tests)
   - Initial position: set from LastMousePos
   - Tick update: position follows cursor

3. **RenderAboveShroud — stick-to-ground** (3 tests)
   - Terrain filter active: actors at relative height
   - Terrain filter inactive: actors stick to ground
   - Mixed: resources at correct heights

4. **CopyPasteEditorAction** (2 tests)
   - Do: EditorBlit.Commit() called
   - Undo: EditorBlit.Revert() called

**Estimated test count**: ~10 tests

---

### 6.2 EditorMarkerLayerBrush

#### 6.2.1 Source

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.cs` (265 lines)

#### 6.2.2 Target

- `src/OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/PaintMarkerTileEditorAction.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/ClearSelectedMarkerTilesEditorAction.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/ClearAllMarkerTilesEditorAction.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/EditorMarkerLayerBrush.test.ts`

#### 6.2.3 Class Summary

Paints marker tiles on a special marker overlay layer. Markers are used to annotate the map (spawn points, objective markers, waypoints). The brush supports:
- **Mirror painting**: Via `markerLayerOverlay.CalculateMirrorPositions(cell)` for symmetric maps
- **Accumulation pattern**: Cells are accumulated during drag, committed on mouse up
- **Template-based colors**: Each marker index corresponds to a color from `MarkerLayerOverlay.Info.Colors`
- **Dispose cleanup**: On dispose, any pending paint tiles are reverted

#### 6.2.4 Key Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `MarkerLayerOverlay` | **NOT YET MIGRATED** | Major dependency — contains `CellLayer<int?>`, `CalculateMirrorPositions()`, `SetTile()`, `ClearSelected()`, `ClearAll()`, `SetSelected()`, `SetAll()`, `Tiles` dictionary |
| `EditorActionManager` | Phase A COMPLETE | Action stack |
| `EditorViewportControllerWidget` | Phase A COMPLETE | `ClearBrush()` |

**Decision on MarkerLayerOverlay**: This is a large trait (~350+ lines C# across the main file + info class) with `CellLayer<int?>`, `Dictionary<int, CPos[]>`, mirror mode support, and annotation rendering. It should be migrated as a **separate migration unit** within Phase B or as a prerequisite stub.

**Proposed approach**: Create a minimal stub of `MarkerLayerOverlay` for Phase B testing:
```typescript
interface IMarkerLayer {
  setTile(cell: CPos, type: number | null): void
  getTile(cell: CPos): number | null
  calculateMirrorPositions(cell: CPos): CPos[]
  clearSelected(tile: number): void
  clearAll(): void
  setSelected(tile: number, cells: readonly CPos[]): void
  setAll(tiles: Map<number, readonly CPos[]>): void
  readonly tiles: ReadonlyMap<number, readonly CPos[]>
}
```

#### 6.2.5 Key Methods

| Method | Description | Test Priority |
|--------|-------------|:---:|
| `constructor(editorWidget, templateId, wr)` | Resolve MarkerLayerOverlay trait | MEDIUM |
| `HandleMouseInput(mi)` | Left drag=accumulate cells, Left up=commit, Right=clear brush | **CRITICAL** |
| `UpdatePreview(forceRefresh)` | Update marker cells during drag; revert on cursor move during non-painting | HIGH |
| `TickRender()` | Delegate to UpdatePreview for cursor tracking | MEDIUM |
| `Dispose()` | Revert all pending paint tiles | HIGH |

#### 6.2.6 PaintMarkerTile Data

```typescript
// C#: readonly struct PaintMarkerTile { CPos Cell; int? Previous; }
interface PaintMarkerTile {
  readonly cell: CPos
  readonly previous: number | null
}
```

#### 6.2.7 Test Strategy

1. **HandleMouseInput** (4 tests)
   - Left down+paint: cells accumulated
   - Left up: action committed
   - Drag across same cell: no duplicate in paintTiles
   - Right click: ClearBrush called

2. **UpdatePreview — mirror positions** (3 tests)
   - Cursor moves: mirror positions calculated and cells updated
   - Already-painted cell: skipped (not added to paintTiles again)
   - Cell already has the template value: skipped

3. **UpdatePreview — non-painting revert** (2 tests)
   - Cursor moves while !painting: pending tiles reverted
   - paintTiles cleared on cursor change during non-painting

4. **Dispose** (2 tests)
   - Pending tiles reverted on dispose
   - MarkerLayerOverlay.SetTile called with Previous value

5. **Inner actions** (3 tests)
   - PaintMarkerTileEditorAction Do: SetTile with new type
   - PaintMarkerTileEditorAction Undo: SetTile with Previous
   - ClearAllMarkerTilesEditorAction Do: ClearAll called, Undo: SetAll called

**Estimated test count**: ~14 tests

---

### 6.3 EditorTilingPathBrush

#### 6.3.1 Source

- `OpenRA/OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.cs` (380 lines)

#### 6.3.2 Target

- `src/OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/UpdateTilingPathPlanEditorAction.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/actions/PaintTilingPathEditorAction.ts`
- `src/OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.test.ts`

#### 6.3.3 Class Summary

A complex brush for drawing roads, rivers, and other tiling paths on the map. It wraps `TilingPathTool` and provides mouse-based path planning:
- **Click to start path**: First left-click creates a PathPlan with a single rally point
- **Drag to extend**: Dragging from a rally/endpoint extends the path
- **Click on rally to remove**: Clicking an existing rally removes it (except the first, which toggles Loop)
- **Drag to move**: Dragging an internal rally point moves it
- **Direction handles**: Start/end direction adjustment via drag on direction indicator circles
- **Preview**: Shows the tiled path as it would appear when committed

#### 6.3.4 Mouse Interaction State Machine

The `HandleMouseInput` method is the most complex of all brushes. It implements:

```
States:
  IDLE_OR_DRAG (isDragging tracks distinction)
    │
    ├── StartingMouseInput = null (no plan exists)
    │     Left Down: create PathPlan(firstPoint) → plan created
    │     Left Up: nothing (already handled by Down)
    │
    └── StartingMouseInput != null (plan exists)
          Left Down on empty: startingMouseInput set, isDragging = false
          Left Move: isDragging = true
          Left Up: isFinal = true → commit plan update
          
          Behavior matrix (from point → to point):
          
          | fromIsStartDirector | Drag: modify start direction
          | fromIsEndDirector   | Drag: modify end direction
          | fromIsInside        |
          |   + fromIsRally     | Drag: replace rally with `to`
          |   + !fromIsRally    | Drag: move plan by offset
          | !fromIsInside       |
          |   + !toIsRally      | Drag: append rally at `to`
          |                     |
          | (isDragging=false)  |
          |   toIsInside        |
          |     + toIsRally     |
          |       + index==0    | Click: toggle loop
          |       + index>0     | Click: remove rally
          |     + !toIsRally    | Click: insert rally before index
          |   !toIsInside       | Click: append rally at `to`
```

#### 6.3.5 Key Rendering Methods

**RenderAboveShroud**: Shows the tiled path preview using `EditorBlit.PreviewBlitSource()` for terrain/actor preview. If no `EditorBlitSource` is available, nothing is rendered (C#: `yield break`).

**RenderAnnotations**: Draws the path plan visualization:
- Yellow circles at each path waypoint (128 radius) + yellow lines between consecutive waypoints
- Main-color circles at rally points (512 radius) + lines between consecutive rallies
- Magenta/Gray direction indicator circles at start/end, offset by 768/1024 of a cell in the auto-start/auto-end direction
- First rally point rendered with filled circle (main color, filled=true)

**Color logic**: `mainColor = tool.EditorBlitSource != null ? Color.Cyan : Color.Red` — cyan when the path tiles successfully, red when tiling fails (invalid path).

#### 6.3.6 Test Strategy

Testing `HandleMouseInput` comprehensively will require significant setup. Each path plan manipulation operation must be tested in isolation via unit tests on `PathPlan` (see Section 6.4.7), plus integration tests on the brush's mouse logic.

**Integration tests on brush** (10+ tests):
1. First click → PathPlan created with single rally
2. Click on empty space → rally appended
3. Click on existing rally → rally removed (or loop toggled for first)
4. Drag rally → rally moved to new position
5. Drag non-rally point → plan moved by drag offset
6. Drag start director circle → start direction changed
7. Drag end director circle → end direction changed
8. Left-up finalizes → UpdateTilingPathPlanEditorAction created
9. Null plan after removal → plan reset
10. Annotation renderables match plan state

**Estimated test count**: ~12 tests for brush (annotations tested via snapshot), ~25 tests for PathPlan (see Section 6.4.7)

---

### 6.4 TilingPathTool

#### 6.4.1 Source

- `OpenRA/OpenRA.Mods.Common/Traits/World/TilingPathTool.cs` (580 lines)

#### 6.4.2 Target

- `src/OpenRA.Mods.Common/Traits/World/TilingPathTool.ts`
- `src/OpenRA.Mods.Common/Traits/World/TilingPathTool.test.ts`

#### 6.4.3 Class Summary

`TilingPathTool` is an `IEditorTool` trait (NOT a brush) attached to the editor world actor. It manages:
- **Segmented Brushes**: Loads all `MultiBrush` definitions from the map's terrain info, filtered to those with `Segment` defined.
- **Type categorization**: Organizes brushes into inner types, start types per inner, end types per inner.
- **Path planning**: Holds a `PathPlan` that represents the user's intended path shape.
- **Tiling computation**: `TilePlan()` converts a PathPlan into an `EditorBlitSource` by running the `TilingPath` algorithm.
- **State setters**: `SetStartType()`, `SetInnerType()`, `SetEndType()`, `SetClosedLoops()`, etc., each calls `Update()` to re-tile.

#### 6.4.4 Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `ITemplatedTerrainInfo` | **NOT YET MIGRATED** | Template data + MultiBrushCollections |
| `MultiBrush` (and MultiBrushInfo) | **NOT YET MIGRATED** | MultiBrush.LoadCollection(), Segment property |
| `TilingPath` | **NOT YET MIGRATED** | Core tiling algorithm (~500 lines C#) |
| `Direction` / `DirectionExts` / `DirectionMask` | **NOT YET MIGRATED** | 8-direction enum + bitmask + extension methods (~372 lines C#) |
| `CellLayerUtils` | **NOT YET MIGRATED** | `WPosToCorner()`, `CornerToWPos()`, `CPosToWPos()`, `CVecToWVec()` |
| `MersenneTwister` | **NOT YET MIGRATED** | Random number generator for tile selection |

**CRITICAL**: `TilingPathTool` has the most unmigrated dependencies of all Phase B files. The entire `MapGenerator` namespace (`TilingPath.cs`, `MultiBrush.cs`, `Direction.cs`) is unmigrated. A decision must be made:

**Option A (Recommended for Phase B)**: Migrate minimal stubs for Direction/DirectionExts (the extension methods are pure math — easy to port), and defer `TilingPath`/`MultiBrush` as TODO items. `TilingPathTool` itself is migrated as a structural shell that loads brush categories and manages plan state, but the actual `TilePlan()` method calls can be stubbed to return null.

**Option B (Full migration)**: Migrate the entire `MapGenerator` namespace (~1,500 lines across 3+ files) as part of Phase B. This would significantly expand scope.

**Decision**: **Option A**. The map generator namespace is a distinct subsystem. Phase B should focus on brush infrastructure. The actual path tiling algorithm can be completed as a follow-up task. The brush and tool architecture can be validated with stubbed tiling.

#### 6.4.5 PathPlan Class (Nested in TilingPathTool)

`PathPlan` is the most algorithmically interesting part of this file. It uses an **immutable data structure** pattern — every mutation returns a new instance:

```typescript
class PathPlan {
  readonly start: Direction      // Direction.None if not set
  readonly end: Direction        // Direction.None if not set
  readonly loop: boolean         // Close the path into a loop
  readonly rallies: readonly CPos[]  // User-defined waypoints (at least 1)
  
  // Factory
  constructor(firstOrAll: CPos | { start: Direction, end: Direction, loop: boolean, rallies: CPos[] })
  
  // Immutable mutators (each returns new PathPlan or null)
  withStart(d: Direction): PathPlan
  withEnd(d: Direction): PathPlan
  withLoop(loop: boolean): PathPlan
  withRallyAppended(cpos: CPos): PathPlan
  withRallyRemoved(index: number): PathPlan | null  // null if removing last rally
  withRallyReplaced(index: number, cpos: CPos): PathPlan
  withRallyInserted(index: number, cpos: CPos): PathPlan
  moved(offset: CVec): PathPlan
  reversed(): PathPlan
  
  // Computed properties
  autoStart(mask: DirectionMask): Direction
  autoEnd(mask: DirectionMask): Direction
  get firstPoint(): CPos
  get lastPoint(): CPos  // = firstPoint if loop
  
  // Point interpolation
  points(): CPos[]
  pointsWithRallyIndex(): Array<{ cpos: CPos, rallyIndex: number }>
}
```

#### 6.4.6 PointsWithRallyIndex Algorithm (CRITICAL)

This is the most complex algorithm in Phase B. It converts rally points (sparse waypoints) into a dense sequence of cell positions for the `TilingPath` tiler.

**Algorithm description** (from C# source, line 221-309):

```
Input: rallies = [R0, R1, R2, ...], start direction auto-detected
Output: Array of {cpos, rallyIndex} for every cell along the path

1. Start at R0, add (R0, 0) to result
2. inertia = autoStart(DirectionMask.All).ToCVec()
   - If diagonal (X!=0 and Y!=0): keep only X component
3. For each rally pair (Ri, Ri+1):
   a. Call AddPointsUpTo(Ri+1, i+1)
      - If cpos == target: throw (duplicate rally points)
      - offset = target - cpos
      - If axis-aligned (xStep==0 || yStep==0):
          Walk step by step, updating inertia to (xStep, yStep)
      - If diagonal:
          Use Bresenham-like supercover line algorithm:
          - xModulo = 2 * |offset.Y|, yModulo = 2 * |offset.X|
          - Track xUnderModulo, yUnderModulo (starting values = offset.Y, offset.X)
          - While cpos != target:
            - Determine step direction based on modulo comparison
            - cpos += inertia
            - Add (cpos, i) to result
4. If loop: AddPointsUpTo(R0, rallyCount)

Note on inertia: The algorithm preserves the last direction of movement
as "inertia" for the next step. This influences diagonal line stepping
to produce consistent 8-direction paths.
```

**TypeScript implementation considerations**:
- The Bresenham supercover variant used here is specific to 8-direction grid movement. It is NOT the standard Bresenham line algorithm — it ensures every cell that the line passes through is included (supercover), not just one cell per row/column.
- Modulo tracking (`xUnderModulo`, `yUnderModulo`) implements a fixed-point accumulator that toggles between X and Y steps to approximate a diagonal line on a discrete grid.
- Initial inertia handling (`if (inertia.X != 0 && inertia.Y != 0) inertia = new CVec(inertia.X, 0)`) ensures the algorithm never starts with a diagonal step.

#### 6.4.7 PathPlan Test Strategy

PathPlan is a pure-data class with no external dependencies — ideal for thorough unit testing.

1. **Construction** (2 tests)
   - Single rally: PathPlan created with empty start/end, loop=false
   - Full constructor: All fields set correctly

2. **Immutable mutators** (9 tests)
   - withStart: new instance, Start changed, other fields preserved
   - withEnd: new instance, End changed
   - withLoop: loop toggled
   - withRallyAppended: rally added at end
   - withRallyRemoved (index=0): last rally? null. middle? shrank
   - withRallyRemoved (index=last): End reset to None
   - withRallyReplaced: rally at index changed
   - withRallyInserted: rally inserted before index
   - moved: all rallies offset by CVec

3. **firstPoint / lastPoint** (3 tests)
   - Non-loop: lastPoint = rallies[last]
   - Loop: lastPoint = rallies[0]
   - Single rally: firstPoint === lastPoint

4. **autoStart / autoEnd** (5 tests)
   - Explicit start set: returns that direction
   - No explicit start, 2+ rallies: returns ClosestInMaskFromCVec(rallies[1]-rallies[0], mask)
   - No explicit start, 1 rally: returns Direction.None
   - autoEnd with loop: returns autoStart (mirrors)
   - autoEnd non-loop: returns direction from last two rallies

5. **pointsWithRallyIndex — axis-aligned** (3 tests)
   - Horizontal path: (0,0) to (3,0) → 4 points
   - Vertical path: (0,0) to (0,3) → 4 points
   - Single rally: 1 point

6. **pointsWithRallyIndex — diagonal** (4 tests)
   - 45-degree diagonal: (0,0) to (3,3) → correct supercover cells
   - Shallow diagonal: (0,0) to (5,2) → correct stepped path
   - Steep diagonal: (0,0) to (2,5) → correct stepped path
   - Multiple rally segments: rally indices increment correctly

7. **pointsWithRallyIndex — inertia** (2 tests)
   - Axis-aligned followed by diagonal: inertia transfers correctly
   - Diagonal with specific starting direction

8. **pointsWithRallyIndex — loops** (2 tests)
   - Loop closure: path returns to start
   - Loop rallyIndex: final index = rallies.length

9. **reversed** (3 tests)
   - Non-loop reverse: rallies reversed, start/end swapped
   - Loop reverse: rallies rotated, directions reversed
   - Reverse with auto-start: auto-detected direction reversed

10. **Edge cases** (3 tests)
    - Duplicate rally points: throws error
    - Empty rallies: throws error in constructor
    - PathPlan with loop=true but only 1 rally: loop forced to false (validation in constructor: `Loop = loop && rallies.Length >= 3`)

**Estimated test count**: ~36 tests

#### 6.4.8 TilingPathTool Constructor: Brush Categorization

The constructor loads all `MultiBrush` definitions and categorizes them:

```
1. Load all SegmentedBrushes from ITemplatedTerrainInfo.MultiBrushCollections
   - Filter: only brushes where Segment != null
2. Extract distinct InnerTypes from brush segment definitions:
   - If segment.Inner != null: use inner type prefix
   - Else: use start or end type prefix
3. For each innerType:
   - StartTypesByInner[innerType] = brushes where start type matches
   - EndTypesByInner[innerType] = brushes where end type matches
4. Set default InnerType from TilingPathToolInfo.DefaultInner
5. VerifyTypes(InnerType) → sets StartType, EndType defaults
```

**Segment type format**: `"Cliff.R"` — dot-separated (type.direction). The `.Split('.')[0]` extracts the base type without direction. The `.SkipLast(1)` extracts the type prefix for categorization.

#### 6.4.9 TilingPathTool Test Strategy

1. **Constructor — brush loading** (3 tests)
   - No segmented brushes available: IsEnabled = false
   - Segmented brushes with Inner type: InnerTypes extracted
   - Segmented brushes without Inner type: InnerTypes from start/end

2. **Constructor — default types** (2 tests)
   - DefaultInner from info matches available type: used directly
   - DefaultInner not available: first available used

3. **VerifyTypes** (4 tests)
   - Valid inner type: start/end types set to first available
   - Inner type with no start types: StartType = ""
   - Inner type with no end types: EndType = ""
   - Empty inner type: set to InnerTypes[0]

4. **State setters** (5 tests)
   - SetStartType: StartType updated, Update() called
   - SetInnerType: InnerType updated, VerifyTypes called, Update() called
   - SetEndType: EndType updated, Update() called
   - SetClosedLoops: ClosedLoops toggled, Update() called
   - SetMaxDeviation / SetAllowEndDeviation / SetRandomSeed: each calls Update()

5. **UpdateStartDirectionMask / UpdateEndDirectionMask** (3 tests)
   - Matching brush found: mask includes brush direction
   - No matching brush: mask = DirectionMask.None
   - Multiple matching brushes: masks OR'd together

6. **TilePlan** (deferred — see Option A above)
   - Stubbed to return null for Phase B

7. **SetPlan** (2 tests)
   - Plan set: stored, Update() called
   - Plan set to null: cleared, Update() called

**Estimated test count**: ~19 tests (excluding TilePlan)

---

## 7. Shared Data Structures

Several types are shared across multiple brush files. These should be defined in a shared module:

### 7.1 `src/OpenRA.Mods.Common/EditorBrushes/types.ts`

```typescript
// MapBlitFilters flags
export const enum MapBlitFilters {
  None = 0,
  Terrain = 1 << 0,
  Resources = 1 << 1,
  Actors = 1 << 2,
  All = Terrain | Resources | Actors
}

// EditorSelection state
export interface EditorSelection {
  area: CellCoordsRegion | null
  actor: EditorActorPreview | null
  readonly hasSelection: boolean
}

// BlitTile — snapshot of a single cell for copy/paste
export interface BlitTile {
  readonly terrainTile: TerrainTile
  readonly resourceTile: ResourceTile
  readonly resourceLayerContents: ResourceLayerContents | null
  readonly height: number
}

// EditorBlitSource — complete region snapshot
export interface EditorBlitSource {
  readonly cellCoords: CellCoordsRegion
  readonly actors: ReadonlyMap<string, EditorActorPreview>
  readonly tiles: ReadonlyMap<string, BlitTile>  // key = "X,Y"
}

// UndoTile — for PaintTileEditorAction undo
export interface UndoTile {
  readonly cell: CPos
  readonly mapTile: TerrainTile
  readonly height: number
}

// CellResource — for AddResourcesEditorAction undo
export interface CellResource {
  readonly cell: CPos
  readonly oldResourceTile: ResourceLayerContents
}

// PaintMarkerTile — for PaintMarkerTileEditorAction undo
export interface PaintMarkerTile {
  readonly cell: CPos
  readonly previous: number | null
}
```

### 7.2 Direction/DirectionMask/DirectionExts

These should be migrated as a standalone utility module since they are pure math and used by both `TilingPathTool` and `EditorTilingPathBrush`.

**Target**: `src/OpenRA.Mods.Common/MapGenerator/Direction.ts`

This is a straightforward port — enums and static methods with no OpenRA framework dependencies. The extension methods become plain exported functions:

```typescript
export enum Direction {
  None = -1,
  R = 0, RD = 1, D = 2, LD = 3,
  L = 4, LU = 5, U = 6, RU = 7
}

export enum DirectionMask {
  None = 0,
  MR = 1 << 0, MRD = 1 << 1, MD = 1 << 2, MLD = 1 << 3,
  ML = 1 << 4, MLU = 1 << 5, MU = 1 << 6, MRU = 1 << 7,
  All = 0xFF
}

export function directionToCVec(d: Direction): CVec { /* ... */ }
export function directionFromOffset(dx: number, dy: number): Direction { /* ... */ }
export function directionClosestFrom(dx: number, dy: number): Direction { /* ... */ }
export function directionClosestInMaskFrom(dx: number, dy: number, mask: DirectionMask): Direction { /* ... */ }
export function directionFromCVec(delta: CVec): Direction { /* ... */ }
export function directionClosestFromCVec(delta: CVec): Direction { /* ... */ }
export function directionClosestInMaskFromCVec(delta: CVec, mask: DirectionMask): Direction { /* ... */ }
export function directionFromCVecNonDiagonal(delta: CVec): Direction { /* ... */ }
export function directionReverse(d: Direction): Direction { /* ... */ }
export function directionToMask(d: Direction): DirectionMask { /* ... */ }
export function directionMaskCount(mask: DirectionMask): number { /* ... */ }
export function directionMaskToDirection(mask: DirectionMask): Direction { /* ... */ }
export function directionIsDiagonal(d: Direction): boolean { /* ... */ }
```

**Test count**: ~20 tests for Direction/DirectionExts functions (pure math, easy to test exhaustively).

---

## 8. Test Strategy

### 8.1 Unit Test Summary

| File | Tests | Category |
|------|:---:|----------|
| Direction.ts | ~20 | Pure math functions |
| EditorBlit.ts | ~17 | Commit/revert, mask, preview |
| EditorDefaultBrush.ts | ~30 | Mouse state machine, selection, actions |
| ChangeSelectionAction.ts | ~5 | Do/Undo/Text |
| DeleteAreaAction.ts | ~8 | Do/Undo with various filters |
| MoveActorAction.ts | ~6 | Move, HasMoved, Undo restore |
| RemoveActorAction.ts | ~4 | Do/Undo |
| RemoveResourceAction.ts | ~4 | Do/Undo, type matching |
| EditorTileBrush.ts | ~17 | Paint, flood fill, overlap detection |
| PaintTileEditorAction.ts | ~6 | Do/Undo with PickAny |
| FloodFillEditorAction.ts | ~8 | BFS algorithm, undo |
| EditorActorBrush.ts | ~13 | Owner selection, subcell, footprint |
| AddActorAction.ts | ~4 | Do/Undo |
| EditorResourceBrush.ts | ~12 | Accumulation, preview, undo |
| AddResourcesEditorAction.ts | ~6 | Do/Undo, type matching |
| EditorCopyPasteBrush.ts | ~10 | Preview, commit via EditorBlit |
| CopyPasteEditorAction.ts | ~3 | Do/Undo |
| EditorMarkerLayerBrush.ts | ~14 | Mirror positions, accumulation |
| MarkerLayer actions (3 classes) | ~10 | Do/Undo per action type |
| EditorTilingPathBrush.ts | ~12 | Path manipulation mouse logic, annotations |
| UpdateTilingPathPlanEditorAction.ts | ~4 | Do/Undo (plan swap) |
| PaintTilingPathEditorAction.ts | ~4 | Do/Undo (blit commit/revert) |
| TilingPathTool.ts | ~19 | Brush categorization, type validation |
| PathPlan.ts | ~36 | Immutable ops, point interpolation, inertia |
| **TOTAL** | **~262** | |

### 8.2 Integration Test Scenarios

After individual brush unit tests pass, integration tests validate the full workflow:

1. **Full selection-to-delete flow**: EditorDefaultBrush select area + DeleteSelection (EditorBlit snapshots + clears)
2. **Full copy-paste flow**: Select area + copy to clipboard + EditorCopyPasteBrush paste at new location
3. **Tile paint + undo**: EditorTileBrush paint + EditorActionManager.Undo() reverts
4. **Resource drag + undo**: EditorResourceBrush drag-paint across multiple cells + undo restores all
5. **Actor place + drag-move**: EditorActorBrush place + EditorDefaultBrush drag-move + undo restores position
6. **Tiling path plan + undo**: Create path plan + modify rallies + undo reverts plan changes

### 8.3 Mock Dependencies

All brushes depend on Phase A infrastructure. Unit tests use mocked versions:

| Interface to Mock | Mock Behavior |
|-------------------|---------------|
| `EditorActionManager` | Mock `add()` method that records actions for verification |
| `EditorActorLayer` | Mock with in-memory actor map; `PreviewsAtWorldPixel()` returns test data |
| `EditorResourceLayer` (`IResourceLayer`) | Mock with in-memory resource map; `CanAddResource()` always true |
| `EditorViewportControllerWidget` | Mock with `setTooltip()`, `clearBrush()` spies; provide test color values |
| `WorldRenderer` / `Viewport` | Mock `viewToWorld()` and `viewToWorldPx()` with simple mathematical transforms |
| `MarkerLayerOverlay` (`IMarkerLayer`) | Stub interface with in-memory `Map<string, number\|null>` |

---

## 9. Deferred Items

| # | Feature / File | Reason | TODO Ref |
|:---:|----------------|--------|----------|
| 1 | `ITiledTerrainRenderer` and `RenderPreview()` | Terrain renderer not yet migrated; preview can return empty array for Phase B | TODO-21.B.2-DEFER-1 |
| 2 | `IResourceRenderer` and `RenderPreview()` | Resource renderer not yet migrated; preview can return empty array for Phase B | TODO-21.B.2-DEFER-2 |
| 3 | Full `TilingPath` algorithm class | MapGenerator namespace not yet migrated; stub `TilePlan()` to return null | TODO-21.B.2-DEFER-3 |
| 4 | Full `MultiBrush` class | MapGenerator namespace not yet migrated; stub brush loading to return empty | TODO-21.B.2-DEFER-4 |
| 5 | `CellLayerUtils` (WPos ↔ CPos conversion) | MapGenerator namespace not yet migrated; implement inline conversion helpers | TODO-21.B.2-DEFER-5 |
| 6 | `MersenneTwister` for deterministic RNG | Not yet migrated; use `Math.random()` as substitute | TODO-21.B.2-DEFER-6 |
| 7 | `FluentProvider` for localized action descriptions | Not yet migrated; hardcode English strings | TODO-21.B.2-DEFER-7 |
| 8 | Full `MarkerLayerOverlay` trait | Not yet migrated; use `IMarkerLayer` stub interface for Phase B | TODO-21.B.2-DEFER-8 |
| 9 | `EditorActorPreview` 3D preview pipeline (`IActorPreview`, `IRenderActorPreviewInfo`) | Deferred from Phase A; preview actors render as simple billboards | TODO-21.A.5-DEFER-2 |
| 10 | `SelectionBoxAnnotationRenderable` for full actor selection box | Deferred from Phase A; use simple bounding box | TODO-21.A.5-DEFER-3 |

---

## 10. Migration Order Recommendation

### Recommended Execution Sequence

```
Step 1: Direction.ts (~2 hours)
  → Pure math, no dependencies, needed by TilingPathTool.PathPlan
  → ~20 tests, all pure functions

Step 2: types.ts (shared data structures) (~1 hour)
  → No logic, just interfaces and type definitions
  → No tests needed (types are compile-time)

Step 3: EditorBlit.ts (~3 hours)
  → Core utility, needed by EditorDefaultBrush.DeleteAreaAction + EditorCopyPasteBrush
  → ~17 tests

Step 4: EditorDefaultBrush.ts + all 5 action classes (~5 hours)
  → Foundation brush, all other brushes depend on its EditorSelection being understood
  → ~57 tests across 6 files

=== Wave 1 complete: Foundation ready ===

Step 5: EditorTileBrush.ts + PaintTileEditorAction + FloodFillEditorAction (~3 hours)
  → Independent brush
  → ~31 tests across 3 files
  → CAN RUN IN PARALLEL with Steps 6 and 7

Step 6: EditorActorBrush.ts + AddActorAction (~2 hours)
  → Independent brush
  → ~17 tests across 2 files
  → CAN RUN IN PARALLEL with Steps 5 and 7

Step 7: EditorResourceBrush.ts + AddResourcesEditorAction (~2 hours)
  → Independent brush
  → ~18 tests across 2 files
  → CAN RUN IN PARALLEL with Steps 5 and 6

=== Wave 2 complete: Independent brushes ready ===

Step 8: EditorCopyPasteBrush.ts + CopyPasteEditorAction (~2 hours)
  → Depends on EditorBlit, EditorSelection concept
  → ~13 tests across 2 files

Step 9: EditorMarkerLayerBrush.ts + 3 marker actions (~3 hours)
  → Depends on IMarkerLayer stub
  → ~24 tests across 4 files

Step 10: PathPlan.ts (nested within TilingPathTool) (~3 hours)
  → Complex algorithm, pure logic
  → ~36 tests
  → CAN RUN IN PARALLEL with Steps 8-9 (PathPlan has no external dependencies)

Step 11: TilingPathTool.ts (~3 hours)
  → Depends on Direction.ts, PathPlan, stubbed MultiBrush/TilingPath
  → ~19 tests
  → Depends on Step 1 + Step 10

Step 12: EditorTilingPathBrush.ts + 2 tiling path actions (~3 hours)
  → Depends on TilingPathTool, EditorBlit
  → ~20 tests across 3 files
  → Depends on Steps 3, 10, 11

=== Wave 3 complete: All brushes migrated ===
```

### Total Estimated Effort

| Wave | Files | Hours | Tests |
|------|-------|:---:|:---:|
| Shared (Direction + types) | 2 | 3 | ~20 |
| Wave 1 (Foundation) | 7 | 8 | ~74 |
| Wave 2 (Independent) | 8 | 7 | ~66 |
| Wave 3 (Dependent) | 10 | 12 | ~102 |
| **TOTAL** | **27** | **30** | **~262** |

Note: Hours are architect estimates. Actual implementation time depends on developer familiarity with the codebase and may vary by 2x.

---

## Appendix A: File Header Template

Every migrated `.ts` file must include:

```typescript
/**
 * [ClassName].ts — [Brief description]
 * OpenRA 对照: OpenRA.Mods.Common/[path]/[ClassName].cs ([N] lines C#)
 *
 * 核心范式转换:
 * - [Key paradigm shift 1]
 * - [Key paradigm shift 2]
 * - ...
 *
 * Migration: TODO-21.B.X — Chapter 21 Phase B
 */
```

## Appendix B: Action File Naming Convention

All editor action classes are placed in `src/OpenRA.Mods.Common/EditorBrushes/actions/` directory:

```
actions/
  ChangeSelectionAction.ts
  DeleteAreaAction.ts
  MoveActorAction.ts
  RemoveActorAction.ts
  RemoveResourceAction.ts
  PaintTileEditorAction.ts
  FloodFillEditorAction.ts
  AddActorAction.ts
  AddResourcesEditorAction.ts
  CopyPasteEditorAction.ts
  PaintMarkerTileEditorAction.ts
  ClearSelectedMarkerTilesEditorAction.ts
  ClearAllMarkerTilesEditorAction.ts
  UpdateTilingPathPlanEditorAction.ts
  PaintTilingPathEditorAction.ts
```

Each action file exports a single class implementing `IEditorAction`.

## Appendix C: Stub Strategy for Unmigrated Dependencies

For Phase B to proceed without blocking on the MapGenerator namespace migration, the following stubs are defined:

### C.1 IMarkerLayer (stub interface)

```typescript
// In src/OpenRA.Mods.Common/Traits/World/MarkerLayerOverlay.stub.ts
export interface IMarkerLayer {
  setTile(cell: CPos, type: number | null): void
  getTile(cell: CPos): number | null
  calculateMirrorPositions(cell: CPos): CPos[]
  clearSelected(tile: number): void
  clearAll(): void
  setSelected(tile: number, cells: readonly CPos[]): void
  setAll(tiles: ReadonlyMap<number, readonly CPos[]>): void
  readonly tiles: ReadonlyMap<number, readonly CPos[]>
}
```

### C.2 TilingPathTool TilePlan stub

```typescript
// In TilingPathTool.ts
private tilePlan(plan: PathPlan): EditorBlitSource | null {
  // TODO-21.B.2-DEFER-3: Integrate TilingPath algorithm
  // For Phase B, return null (path tiling not yet implemented)
  return null
}
```

### C.3 ITemplatedTerrainInfo template check

```typescript
// In EditorTileBrush.ts constructor
private isTemplatedTerrain(terrainInfo: unknown): boolean {
  // TODO-21.B.2-DEFER-1: Proper TemplatedTerrainInfo type check
  return false  // Stub: assume non-templated for Phase B
}
```
