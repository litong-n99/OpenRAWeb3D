# Chapter 21 Phase A — Editor Core Infrastructure Design Specification

**Author**: Migration Architect
**Date**: 2026-06-18
**Status**: APPROVED — Manager approved 2026-06-18
**OpenRA Sources Analyzed**: 8 files (189 + 26 + 79 + 53 + 333 + 313 + 495 + 132 = 1,620 lines C#)
**Target**: `src/OpenRA.Mods.Common/Editor/` (shared interfaces), `src/OpenRA.Mods.Common/Traits/World/` (traits), `src/OpenRA.Mods.Common/Graphics/` (renderables), and `src/OpenRA.Mods.Common/Widgets/` (widgets)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Wave 1 — Foundation](#wave-1--foundation)
   - [TODO-21.A.1: EditorActionManager](#todo-21a1-editoractionmanager)
3. [Wave 2 — Independent Components](#wave-2--independent-components)
   - [TODO-21.A.2: MapEditorData](#todo-21a2-mapeditordata)
   - [TODO-21.A.3: EditorSelectionAnnotationRenderable](#todo-21a3-editorselectionannotationrenderable)
   - [TODO-21.A.4: EditorCursorLayer](#todo-21a4-editorcursorlayer)
   - [TODO-21.A.5: EditorActorPreview](#todo-21a5-editoractorpreview)
   - [TODO-21.A.6: EditorResourceLayer](#todo-21a6-editorresourcelayer)
4. [Wave 3 — Dependents](#wave-3--dependents)
   - [TODO-21.A.7: EditorActorLayer](#todo-21a7-editoractorlayer)
   - [TODO-21.A.8: EditorViewportControllerWidget](#todo-21a8-editorviewportcontrollerwidget)
5. [Shared Types & Interfaces](#shared-types--interfaces)
6. [Migration Order & Dependencies](#migration-order--dependencies)
7. [Key Architecture Decisions](#key-architecture-decisions)

---

## Architecture Overview

Chapter 21 Phase A migrates the core infrastructure for the OpenRA map editor. The editor is **not a separate application** — it shares the same game engine as the RTS gameplay, with the `World` set to an "editor world" (`SystemActors.EditorWorld`) where simulation is disabled (no ITick, no Activity, no player orders). Actors are represented as lightweight `EditorActorPreview` proxies (render-only, no TraitDictionary) rather than full `GameActor` instances.

### System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    EditorViewportControllerWidget            │
│  (extends ViewportControllerWidget from Ch7)                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  IEditorBrush (interface)                                ││
│  │  ├── EditorDefaultBrush (default cursor/selection brush) ││
│  │  ├── EditorSelectionBrush (Phase B — actor placement)    ││
│  │  └── EditorResourceBrush (Phase B — resource painting)   ││
│  └──────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  EditorCursorLayer (trait on world actor)                    │
│  Routes ITickRender + IRenderAboveShroud to active brush     │
├──────────────────────────────────────────────────────────────┤
│  EditorActorLayer (trait on world actor)                     │
│  Manages EditorActorPreview[] + SpatiallyPartitioned indexes │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  EditorActorPreview (per-actor, render-only proxy)       ││
│  │  - ActorReference init store (Location, Owner, Faction)  ││
│  │  - IActorPreview[] rendering pipeline                    ││
│  │  - Selection box annotation (SelectionBoxAnnotation)     ││
│  │  - NO TraitDictionary, NO ITick, NO Activity             ││
│  └──────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  EditorActionManager (trait on world actor)                  │
│  IEditorAction { execute(), do(), undo() } command stack     │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │  undoStack   │  │  redoStack   │                         │
│  │  (Stack<T>)  │  │  (Stack<T>)  │                         │
│  └──────────────┘  └──────────────┘                         │
├──────────────────────────────────────────────────────────────┤
│  EditorResourceLayer (trait on world actor)                  │
│  Implements IResourceLayer for editor resource manipulation  │
│  (different rules from gameplay ResourceLayer)               │
├──────────────────────────────────────────────────────────────┤
│  MapEditorData (trait info on rules actors)                  │
│  Metadata marker: tileset requirements, categories           │
├──────────────────────────────────────────────────────────────┤
│  EditorSelectionAnnotationRenderable                         │
│  IRenderable: draws colored cell polygonal grid overlay      │
│  (selection regions, paste regions)                          │
└──────────────────────────────────────────────────────────────┘
```

### ADR References

| ADR | Title | Key Decision |
|-----|-------|-------------|
| ADR-21.1 | Editor shares game engine | EditorWorld extends World, simulation disabled |
| ADR-21.2 | Command pattern undo/redo | IEditorAction with execute/do/undo methods |
| ADR-21.3 | EditorActorPreview is render-only | Billboard — no TraitDictionary, no ITick, no Activity |
| ADR-21.5 | Undo stack capped at 100 | Batched cell diffs, not full map copies |

---

## Wave 1 — Foundation

### TODO-21.A.1: EditorActionManager

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Traits/World/EditorActionManager.cs` (189 lines)
- **Target file**: `src/OpenRA.Mods.Common/Traits/World/EditorActionManager.ts`
- **Target test**: `src/OpenRA.Mods.Common/Traits/World/EditorActionManager.test.ts`

#### Class Summary
The `EditorActionManager` is the **undo/redo command infrastructure** for all editor operations. It maintains two stacks (`undoStack` and `redoStack`) of `EditorActionContainer` objects, each wrapping an `IEditorAction`. The manager:

1. Pushes a sentinel `OpenMapAction` at startup (always preserved on undo stack)
2. Executes new actions via `Add()`, clearing the redo stack (standard command pattern behavior)
3. Supports `Undo()`, `Redo()`, `Rewind(id)`, and `Forward(id)` for navigation through action history
4. Fires events: `ItemAdded`, `ItemRemoved`, `OnChange`
5. Tracks `Modified` and `SaveFailed` flags for dirty-state detection
6. Capped at 100 entries per ADR-21.5

#### Dependencies
| Type | File Path | Status |
|------|-----------|--------|
| `IWorldLoaded` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `WorldStub` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `WorldRendererStub` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |

#### TypeScript Migration Approach

**`Stack<T>` → `Array<T>` with push/pop**

The C# `Stack<EditorActionContainer>` maps directly to `Array<EditorActionContainer>` with `push()` for Push and `pop()` for Pop. Peek is `array[array.length - 1]`.

Note: Per ADR-21.5, the undo stack is capped at 100 entries. When an `Add()` would exceed 100 items, the **oldest** entry (index 0, after the sentinel `OpenMapAction`) should be shifted off.

**C# events → TypeScript `Set<Function>` callbacks**

```typescript
// C#: public event Action<EditorActionContainer> ItemAdded;
// TS:
private _itemAddedCallbacks = new Set<(container: EditorActionContainer) => void>()
onItemAdded(cb: (container: EditorActionContainer) => void): void { this._itemAddedCallbacks.add(cb) }
offItemAdded(cb: (container: EditorActionContainer) => void): void { this._itemAddedCallbacks.delete(cb) }
```

This pattern matches how `ResourceLayer.onCellChanged` is implemented in Ch10.

**Undo stack depth tracking**

The C# `HasUndos()` checks `undoStack.Count > 1` to preserve the initial `OpenMapAction`. The TypeScript implementation must replicate this sentinel pattern exactly.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `Modified` | `boolean` (get/set) | Dirty-flag for unsaved changes |
| `SaveFailed` | `boolean` (get/set) | Flag when save operation fails |
| `Add(action: IEditorAction): void` | Execute action + push to undo stack + clear redo |
| `Undo(): void` | Pop undo, execute undo, push to redo |
| `Redo(): void` | Pop redo, execute do, push to undo |
| `HasUndos(): boolean` | `undoStack.length > 1` |
| `HasRedos(): boolean` | `redoStack.length > 0` |
| `Rewind(id: number): void` | Undo until top of undo stack has target id |
| `Forward(id: number): void` | Redo until top of undo stack has target id |
| `HasUnsavedItems(): boolean` | Modified AND not at initial OpenMapAction |
| `ItemAdded` event | Callback registration |
| `ItemRemoved` event | Callback registration |
| `OnChange` event | Callback registration |
| `worldLoaded(w: WorldStub, wr: WorldRendererStub): void` | IWorldLoaded implementation |

#### Interfaces to Define

```typescript
// EditorActionStatus enum
export const EditorActionStatus = {
  History: 0,
  Active: 1,
  Future: 2,
} as const
export type EditorActionStatus = (typeof EditorActionStatus)[keyof typeof EditorActionStatus]

// IEditorAction interface
export interface IEditorAction {
  execute(): void
  do(): void
  undo(): void
  readonly text: string
}

// EditorActionContainer class
export class EditorActionContainer {
  readonly id: number
  readonly action: IEditorAction
  status: EditorActionStatus
  constructor(id: number, action: IEditorAction)
}

// OpenMapAction (sentinel, always at bottom of undo stack)
export class OpenMapAction implements IEditorAction {
  readonly text: string
  execute(): void { this.do() }
  do(): void {}
  undo(): void {}
}
```

#### Test Strategy

| Test Category | Specific Tests | Approach |
|---------------|---------------|----------|
| **Command execution** | Add() executes action, pushes to undo, clears redo | Mock IEditorAction, verify execute() called |
| **Undo/Redo** | Undo pops undo stack, pushes to redo, calls action.undo(); Redo reverses | Verify stack state and method calls |
| **Sentinel action** | HasUndos() returns false when only OpenMapAction present | Verify cannot undo past initial state |
| **Rewind/Forward** | Rewind(id) calls Undo until target id on top; Forward uses Redo | Construct multi-entry stack, verify navigation |
| **Events** | ItemAdded/ItemRemoved/OnChange fire correctly | Register callbacks, verify invocation |
| **Modified flag** | Modified=true on Add/Undo/Redo; reset on WorldLoaded | Verify flag state |
| **Stack cap (ADR-21.5)** | Adding 101+ actions removes oldest (after sentinel) | Verify max 101 entries (100 + sentinel) |
| **HasUnsavedItems** | Returns false at OpenMapAction; true after Add | Verify dirty detection |
| **Edge cases** | Undo with no undos (no-op), Redo with no redos (no-op) | Verify no errors, no state change |
| **IWorldLoaded** | worldLoaded() pushes OpenMapAction, resets Modified | Verify sentinel present after load |

#### Potential Pitfalls
- The sentinel `OpenMapAction` has empty `do()`/`undo()` — calling `Undo()` past it must be a no-op, not an error
- `Add()` must clear the entire redo stack and fire `ItemRemoved` for each cleared item
- Stack cap enforcement must **never** remove the sentinel `OpenMapAction` (index 0)
- `Rewind(id)` calls `Undo()` repeatedly — it uses `undoStack.Peek().Id != id` as the loop condition, so the target ID remains on the undo stack after rewind

---

## Wave 2 — Independent Components

### TODO-21.A.2: MapEditorData

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Traits/MapEditorData.cs` (26 lines)
- **Target file**: `src/OpenRA.Mods.Common/Traits/MapEditorData.ts`
- **Target test**: `src/OpenRA.Mods.Common/Traits/MapEditorData.test.ts`

#### Class Summary
`MapEditorData` is a **metadata marker trait** attached to actor definitions in the mod YAML. It declares:

1. `RequireTilesets` — which tilesets are required for this actor to be available in the editor
2. `ExcludeTilesets` — which tilesets exclude this actor
3. `Categories` — categories for organizing the editor actor palette

The trait class itself (`MapEditorData`) is an **empty class** — it carries no runtime logic. The `MapEditorDataInfo` holds all the data.

#### Dependencies
| Type | File Path | Status |
|------|-----------|--------|
| `ITraitInfo` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |

#### TypeScript Migration Approach

This is a **data-only trait**. In C#, `TraitInfo<MapEditorData>` means the Info class creates a `MapEditorData` instance. In TypeScript:

```typescript
export class MapEditorDataInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly requireTilesets: ReadonlySet<string>  // FrozenSet<string>
  readonly excludeTilesets: ReadonlySet<string>  // FrozenSet<string>
  readonly categories: readonly string[]         // ImmutableArray<string>
}
```

The empty `MapEditorData` class serves as a type tag only.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `MapEditorDataInfo.requireTilesets` | `ReadonlySet<string>` | null → empty set |
| `MapEditorDataInfo.excludeTilesets` | `ReadonlySet<string>` | null → empty set |
| `MapEditorDataInfo.categories` | `readonly string[]` | null → empty array |

#### Test Strategy

| Test Category | Specific Tests |
|---------------|---------------|
| **Defaults** | All fields default to empty collections when not configured |
| **JSON loading** | Deserialize from rules JSON correctly |
| **Filtering** | Actor is available when tileset in requireTilesets |
| **Exclusion** | Actor is excluded when tileset in excludeTilesets (exclude takes priority) |

#### Potential Pitfalls
- `RequireTilesets = null` means "no restriction" — must default to empty set, not throw NPE
- `ExcludeTilesets = null` means "no exclusion" — must default to empty set
- Tileset filtering logic (checking if an actor is available) will be implemented in a later phase (editor actor palette widget)

---

### TODO-21.A.3: EditorSelectionAnnotationRenderable

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.cs` (79 lines)
- **Target file**: `src/OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.ts`
- **Target test**: `src/OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.test.ts`

#### Class Summary
Renders a **colored polygonal selection outline** over a region of map cells. Used for:
1. Selection rectangles (drag-select in the editor)
2. Copy/paste region preview
3. Brush area preview

In the OpenRA C#, this implements `IRenderable` + `IFinalizedRenderable`, drawing lines along each cell's terrain ramp polygons using `Game.Renderer.RgbaColorRenderer.DrawLine()`.

#### Dependencies
| Type | File Path | Status |
|------|-----------|--------|
| `IRenderable` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS (stub) |
| `CellCoordsRegion` | `src/OpenRA.Game/Map/CellCoordsRegion.ts` | EXISTS |
| `CVec` | `src/OpenRA.Game/CVec.ts` | EXISTS |
| `CPos` | `src/OpenRA.Game/CPos.ts` | EXISTS |
| `MPos` | `src/OpenRA.Game/MPos.ts` | EXISTS |
| `WPos` | `src/OpenRA.Game/WPos.ts` | EXISTS |
| `Color` | `src/OpenRA.Game/Primitives/Color.ts` | EXISTS |
| `Rectangle` | `src/OpenRA.Game/Primitives/Rectangle.ts` | EXISTS |

#### TypeScript Migration Approach

**OpenGL `IRenderable` → Babylon.js Mesh-based rendering**

The C# code does **per-frame, per-cell line drawing** through the `RgbaColorRenderer`. This is hot-path code that draws along every polygon edge of every cell's terrain ramp. In Babylon.js, this maps to two approaches:

**Approach A (Recommended for Phase A): Line-based overlay**
Create a `LinesMesh` from `MeshBuilder.CreateLineSystem()` that draws all polygon edges for the entire cell region. Update the mesh when the region changes. This batch-creates a single GPU draw call instead of per-cell iteration.

**Approach B (Performance-optimized): Decal/plane overlay**
For large regions, create a semi-transparent colored plane at the terrain height. Less precise but cheaper for large selections.

**Adopted: Approach A for selection (colored lines), with Approach B deferred.**

```typescript
// In Babylon.js:
// For each cell in the region, compute the ramp polygon edges in world space
// Then create a LinesMesh from all line segments
const points: Vector3[] = []
for (const cellPos of region) {
  // Compute terrain ramp polygon edges in world space
  // Append line vertex pairs to points array
}
const linesMesh = MeshBuilder.CreateLines("selectionOverlay", { points }, scene)
linesMesh.color = new Color3(color.r / 255, color.g / 255, color.b / 255)
```

**Key paradigm shift**: Instead of calling `DrawLine()` per polygon edge per frame (OpenRA imperative), we build a single `LinesMesh` once when the region changes and let Babylon.js render it through the scene graph each frame. This follows the "declarative 3D scene graph" paradigm.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| Constructor | `(bounds: CellCoordsRegion, color: Color, altPixelOffset: {x:number,y:number}, offset: CVec)` | |
| `Pos` | `WPos` getter — always `WPos.Zero` | Decoration — not used for Z-sorting |
| `ZOffset` | `0` | Always 0 |
| `IsDecoration` | `true` | |
| `WithZOffset(newOffset: number)` | Returns `this` | Immutable |
| `OffsetBy(vec: WVec)` | Returns `this` | Immutable |
| `AsDecoration()` | Returns `this` | |
| `PrepareRender(wr)` | Returns `this` | No-op in TS (scene graph handles preparation) |
| `Render(wr)` | `void` — creates/updates LinesMesh | Main rendering logic |
| `ScreenBounds(wr)` | Returns `Rectangle.Empty` | Decoration, no screen bounds |

#### Test Strategy

| Test Category | Specific Tests |
|---------------|---------------|
| **Region rendering** | Creates line mesh for all cells in region |
| **Color application** | Line color matches input (white=selection, green=paste, black=alt) |
| **Terrain ramp handling** | Cells with non-zero ramp use ramp polygon edges |
| **Out-of-bounds cells** | Cells outside map height bounds are silently skipped |
| **Empty region** | No mesh created for zero-cell region |
| **IsDecoration handling** | Always returns IsDecoration=true |
| **altPixelOffset** | Offset applied to viewport transform |

#### Potential Pitfalls
- Cell positions must be transformed through `CoordinateTransformer.cellToVector3()` to get world-space coordinates
- Ramp polygon vertices are in **WVec** (world vector) space, relative to cell center — must add to cell center position
- Must skip cells where `map.Height` does not contain the MPos (out of map bounds)
- The `cv` offset parameter shifts the entire region — used for alternating grid colors (`SelectionAltOffset`)
- LinesMesh must be **disposed** when the renderable is no longer needed (memory leak risk)

---

### TODO-21.A.4: EditorCursorLayer

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Traits/World/EditorCursorLayer.cs` (53 lines)
- **Target file**: `src/OpenRA.Mods.Common/Traits/World/EditorCursorLayer.ts`
- **Target test**: `src/OpenRA.Mods.Common/Traits/World/EditorCursorLayer.test.ts`

#### Class Summary
`EditorCursorLayer` is a **thin delegation trait** on the world actor. It holds a reference to the active `IEditorBrush` and routes trait interface calls (`ITickRender`, `IRenderAboveShroud`, `IRenderAnnotations`) to the brush.

Key insight: The brush **is** the active editor tool (selection, resource painting, actor placement). By holding it in a trait, the editor viewport widget can swap brushes without modifying the world actor's trait composition.

#### Dependencies
| Type | File Path | Status |
|------|-----------|--------|
| `ITickRender` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IRenderAboveShroud` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IRenderAnnotations` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IGameActor` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `WorldRendererStub` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IRenderable` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS (stub) |

**Note**: `EditorCursorLayerInfo` in C# has `Requires<EditorActorLayerInfo>` and `Requires<ITiledTerrainRendererInfo>`. The `ITiledTerrainRenderer` requirement is for the terrain brush to access terrain rendering — this will be a deferred TODO. For Phase A, we can remove this requirement or stub the terrain renderer reference.

#### TypeScript Migration Approach

**`IEditorBrush` interface** — must be defined as a shared interface:

```typescript
export interface IEditorBrush {
  tickRender(wr: WorldRendererStub, self: IGameActor): void
  renderAboveShroud(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  renderAnnotations(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  handleMouseInput(mi: unknown): boolean
  tick(): void
  dispose(): void
}
```

**Empty null-object pattern**: When `brush` is null, return `[]` (empty array) instead of throwing.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `SetBrush(brush: IEditorBrush \| null): void` | Swap the active brush |
| `tickRender(wr, self): void` | ITickRender — delegate to brush |
| `renderAboveShroud(self, wr): readonly IRenderable[]` | IRenderAboveShroud — delegate to brush |
| `renderAnnotations(self, wr): readonly IRenderable[]` | IRenderAnnotations — delegate to brush |
| `spatiallyPartitionable` | `false` (getter) | Both IRenderAboveShroud and IRenderAnnotations |

#### Test Strategy

| Test Category | Specific Tests |
|---------------|---------------|
| **Null brush** | All render methods return empty array when brush is null |
| **SetBrush** | Setting a brush routes all methods to new brush |
| **TickRender** | Delegates to brush.tickRender() |
| **RenderAboveShroud** | Delegates to brush.renderAboveShroud() |
| **RenderAnnotations** | Delegates to brush.renderAnnotations() |
| **SpatiallyPartitionable** | Always returns false |

#### Potential Pitfalls
- The `IEditorBrush` interface must be defined in a shared location (e.g., `src/OpenRA.Mods.Common/Editor/IEditorBrush.ts`) since it will be used by Phase B brush implementations
- `IRenderAboveShroud.SpatiallyPartitionable` and `IRenderAnnotations.SpatiallyPartitionable` both return `false` — editor brush renderables are always full-pass, not spatially partitioned
- The C# uses explicit interface implementation (`ITickRender.TickRender` vs `IRenderAboveShroud.RenderAboveShroud`) — TypeScript doesn't have this, so all implementations are public

---

### TODO-21.A.5: EditorActorPreview

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Traits/World/EditorActorPreview.cs` (333 lines)
- **Target file**: `src/OpenRA.Mods.Common/Traits/World/EditorActorPreview.ts`
- **Target test**: `src/OpenRA.Mods.Common/Traits/World/EditorActorPreview.test.ts`

#### Class Summary
`EditorActorPreview` is a **render-only proxy** for an actor in the editor. Per ADR-21.3, it:
- Does NOT have a `TraitDictionary`
- Does NOT implement `ITick` (no simulation)
- Does NOT run `Activity` graphs
- Does NOT participate in game logic or networking

It stores the actor's configuration as an `ActorReference` (a dictionary of `ActorInit` key-value pairs). It generates preview renderables from `IRenderActorPreviewInfo` trait infos, manages footprint/position calculation, selection state, and save/export operations.

#### Dependencies
| Type | File Path | Status |
|------|-----------|--------|
| `WPos` | `src/OpenRA.Game/WPos.ts` | EXISTS |
| `CPos` | `src/OpenRA.Game/CPos.ts` | EXISTS |
| `SubCell` | `src/OpenRA.Game/Traits/SubCell.ts` | EXISTS |
| `PlayerReference` (stub) | `src/OpenRA.Game/Map/PlayerReference.ts` | EXISTS |
| `ActorInfoStub` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IRenderable` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS (stub) |
| `IOccupySpaceInfo` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `Color` | `src/OpenRA.Game/Primitives/Color.ts` | EXISTS |
| `Rectangle` | `src/OpenRA.Game/Primitives/Rectangle.ts` | EXISTS |

**Not yet migrated** (stub/defer required):
- `ActorReference` class (the init dictionary) — may exist in Ch3 as ActorInitializer
- `IActorPreview` + `IRenderActorPreviewInfo` (preview pipeline) — may exist in Ch3
- `SelectionBoxAnnotationRenderable` — may exist in Ch3
- `ActorPreviewInitializer` — may exist in Ch3
- `ActorInit` types (LocationInit, OwnerInit, FactionInit, HealthInit, SubCellInit, CenterPositionInit)
- `MiniYaml` save format
- `RadarColorFromTerrainInfo` / `TooltipInfo` / `EditorOnlyTooltipInfo`
- `BuildingInfo` (for center offset calculation)
- `INotifyEditorPlacementInfo`

Let me check what already exists in the Ch3 migration.

Looking at the existing codebase, `IOccupySpaceInfo` has the `occupiedCells` method already. `SubCell` exists. `WPos`, `CPos`, `Color` all exist.

#### TypeScript Migration Approach

**ActorReference → `Map<string, unknown>` with typed accessors**

In C#, `ActorReference` is a dictionary of `ActorInit` keyed by type. In TypeScript, we use `Map<string, unknown>` with typed helper methods:

```typescript
class EditorActorPreview {
  private reference: Map<string, unknown>  // key = init type name, value = init instance

  addInit<T>(initType: string, init: T): void {
    this.reference.set(initType, init)
    this.generatePreviews()
  }

  getInitOrDefault<T>(initType: string): T | undefined {
    return this.reference.get(initType) as T | undefined
  }

  replaceInit<T>(initType: string, init: T): void {
    this.reference.set(initType, init)
    this.generatePreviews()
  }
}
```

**IActorPreview rendering → Babylon.js Billboard/Mesh rendering**

Each `IActorPreview` from `IRenderActorPreviewInfo.RenderPreview()` produces renderables. In TypeScript:
- For sprite-based actors: Create `MeshBuilder.CreatePlane()` with sprite texture, positioned at `CenterPosition` via `CoordinateTransformer.wPosToVector3()`
- Selection highlight: When `Selected === true`, tint with `float3.Ones` + alpha 0.5 (same as C#)
- Selection box: `SelectionBoxAnnotationRenderable` — a Babylon.js `LinesMesh` around the actor's screen bounds

**Footprint computation**: Already handled by `IOccupySpaceInfo.occupiedCells()`. For actors without this trait, fall back to a single-cell footprint at `Location`.

**CenterPosition calculation** (from `PreviewPosition()`):
1. If `CenterPositionInit` exists → use that value
2. If `LocationInit` exists → `map.CenterOfSubCell(location, subCell) + buildingOffset`
3. Otherwise → throw (must have one or the other)

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `DescriptiveName` | `string` (getter) | From tooltip or Info.Name |
| `Info` | `ActorInfoStub` (getter) | Actor type metadata |
| `Tooltip` | `string` (getter) | Multi-line tooltip text |
| `Type` | `string` (getter) | `reference.type` — actor type name |
| `ID` | `string` (getter) | Unique actor identifier |
| `Owner` | `PlayerReference` (get/set) | Owning player |
| `CenterPosition` | `WPos` (get/set) | World-space center |
| `Footprint` | `ReadonlyMap<CPos, SubCell>` (get) | Occupied cells |
| `Bounds` | `Rectangle` (get) | Screen-space bounds |
| `Selected` | `boolean` (get/set) | Selection state |
| `RadarColor` | `Color` (get) | Minimap color |
| `Location` | `CPos` (get) | Top-left cell of footprint |
| Constructor | `(worldRenderer, id, reference, owner)` | |
| `WithId(id): EditorActorPreview` | Clone with new ID |
| `UpdateFromCellChange()` | Recalculate position + bounds on terrain change |
| `UpdateFromMove()` | Recalculate position + footprint on move |
| `Tick()` | Advance preview animations |
| `Render(): IRenderable[]` | Render at CenterPosition |
| `RenderWithOffset(offset): IRenderable[]` | Render at offset position |
| `RenderAnnotations(): IRenderable[]` | Selection box when selected |
| `AddInit<T>(init)` | Add an init value |
| `ReplaceInit<T>(init, info?)` | Replace an init value |
| `RemoveInit<T>(info?)` | Remove an init value |
| `RemoveInits<T>()` | Remove all inits of a type |
| `GetInitOrDefault<T>(info?)` | Get typed init |
| `GetInits<T>()` | Get all inits of a type |
| `AddedToEditor()` | Notify INotifyEditorPlacement |
| `RemovedFromEditor()` | Notify INotifyEditorPlacement |
| `Save()` | Serialize to save format |
| `Export()` | Clone reference for copy/paste |
| `Equals(other)` | Compare by ID (case-insensitive) |
| `GetHashCode()` | Hash of ID |

#### MVP Scope (Phase A Deliverable)

Manager approved reduced scope for Phase A. The MVP must deliver:
- **Sprite rendering at cell position**: Create a Babylon.js plane mesh at the actor's `CenterPosition` (via `CoordinateTransformer.wPosToVector3()`) with the actor's sprite texture applied
- **Facing rotation**: Apply the `FacingInit` angle as Y-axis rotation on the plane mesh
- **Owner color**: Apply the owner's player color as a tint/remap on the sprite
- **Selection highlight**: When `Selected === true`, apply `float3.Ones` tint with 0.5 alpha (matching OpenRA's selection tint)
- **Dispose pattern**: All Babylon.js meshes/textures must implement `dispose()` for GPU resource cleanup

#### Features That Can Be Deferred (APPROVED by Manager)

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `INotifyEditorPlacementInfo` callbacks (`AddedToEditor`, `RemovedFromEditor`) | Requires trait system full integration | TODO-21.A.5-DEFER-1 |
| `IRenderActorPreviewInfo.RenderPreview()` pipeline | Requires Ch3 actor preview system — MVP uses direct sprite rendering | TODO-21.A.5-DEFER-2 |
| `SelectionBoxAnnotationRenderable` (selection box) | MVP uses a simple Babylon.js wireframe box | TODO-21.A.5-DEFER-3 |
| `RadarColorFromTerrainInfo` | Minimap not yet migrated | TODO-21.A.5-DEFER-4 |
| `EditorOnlyTooltipInfo` / `TooltipInfo` name resolution | Requires trait info query on ActorInfo — MVP uses `Info.Name` | TODO-21.A.5-DEFER-5 |
| `BuildingInfo.CenterOffset()` | Requires BuildingInfo trait — MVP calculates position from LocationInit only | TODO-21.A.5-DEFER-6 |
| `MiniYaml` Save() output | MiniYaml pipeline deferred — MVP uses JSON serialization | TODO-21.A.5-DEFER-7 |
| `RuntimeNeighbourInit` (neighbor awareness) | EditorActorLayer.UpdateNeighbours calls ReplaceInit with this | TODO-21.A.5-DEFER-8 |

#### Test Strategy

Many tests require an `ActorReference` class. Create a simple mock:

```typescript
class MockActorReference {
  private inits = new Map<string, unknown>()
  type = 'testActor'
  add(init: unknown): void {}
  get<T>(type: string): T | undefined { return this.inits.get(type) as T }
  // ...
}
```

| Test Category | Specific Tests |
|---------------|---------------|
| **Construction** | Creates preview with valid ID, reference, owner |
| **Unknown type** | Throws InvalidDataException for unknown actor type |
| **Footprint generation** | Single cell for no IOccupySpace, multi-cell for building |
| **CenterPosition from LocationInit** | Position calculated from map's CenterOfSubCell |
| **CenterPosition from CenterPositionInit** | Direct use of provided position |
| **Missing position** | Throws if neither Location nor CenterPosition provided |
| **Faction/Owner init defaults** | Adds FactionInit and OwnerInit if missing |
| **Selection rendering** | Selected=true produces tinted renderables + selection box |
| **Deselection** | Selected=false produces normal renderables only |
| **Tick** | Calls tick() on all previews |
| **WithId clone** | Returns new instance with same reference, different ID |
| **UpdateFromMove** | Recalculates footprint, position, bounds |
| **UpdateFromCellChange** | Recalculates position, previews, bounds on terrain change |
| **Init management** | AddInit, ReplaceInit, RemoveInit, GetInitOrDefault all work correctly |
| **Equals/GetHashCode** | Case-insensitive ID comparison |
| **Export** | Returns cloned ActorReference (not same object) |
| **Tooltip fallback** | DescriptiveName falls back to Info.Name when no tooltip |

#### Potential Pitfalls
- `LocationInit` and `CenterPositionInit` are **mutually exclusive fallbacks** — C# tries one, then the other
- `FactionInit` and `OwnerInit` are auto-added from the `PlayerReference` if not already present
- The `Footprint` can be empty (`Count == 0`) for actors without spatial info — `OccupiedCells()` fallback uses `CellContaining(CenterPosition)`
- `WithId()` creates a **clone** with new ID — used for copy/paste (not a mutation)
- Preview positions must be recalculated when terrain height/ramp changes (map editing triggers `UpdateFromCellChange`)
- The selection box is positioned at `Z = 8192` in C# (above everything) — in Babylon.js, use `renderingGroupId` 3 (overlay)

---

### TODO-21.A.6: EditorResourceLayer

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Traits/World/EditorResourceLayer.cs` (313 lines)
- **Target file**: `src/OpenRA.Mods.Common/Traits/World/EditorResourceLayer.ts`
- **Target test**: `src/OpenRA.Mods.Common/Traits/World/EditorResourceLayer.test.ts`

#### Class Summary
`EditorResourceLayer` is the **editor-specific resource management trait**. It extends the functionality of the gameplay `ResourceLayer` (Ch10) with editor-specific behaviors:

1. **Resource type replacement**: Allows painting one resource type over another (gameplay ResourceLayer rejects this)
2. **Net worth tracking**: Tracks total resource value on the map for the editor HUD
3. **Region value calculation**: `CalculateRegionValue()` for brush previews
4. **RecalculateResourceDensity option**: Editor-specific density algorithm
5. **Resource value awareness**: Reads `PlayerResourcesInfo.ResourceValues` for NetWorth calculation

It implements `IResourceLayer` (same interface as Ch10's `ResourceLayer`) plus `IWorldLoaded` and `INotifyActorDisposing`.

#### Dependencies
| Type | File Path | Status |
|------|-----------|--------|
| `IResourceLayer` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IResourceLayerInfo` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IWorldLoaded` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `INotifyActorDisposing` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `ResourceLayerContents` (type) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `ResourceLayerContentsEmpty` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `ResourceLayerInfo` (class) | `src/OpenRA.Mods.Common/Traits/World/ResourceLayer.ts` | EXISTS |
| `ResourceTypeInfoConfig` (type) | `src/OpenRA.Mods.Common/Traits/World/ResourceLayer.ts` | EXISTS |
| `IResourceMap` (interface) | `src/OpenRA.Mods.Common/Traits/World/ResourceLayer.ts` | EXISTS |
| `CellLayer` | `src/OpenRA.Game/Map/CellLayer.ts` | EXISTS |
| `CPos` | `src/OpenRA.Game/CPos.ts` | EXISTS |
| `CVec` | `src/OpenRA.Game/CVec.ts` | EXISTS |
| `CellCoordsRegion` | `src/OpenRA.Game/Map/CellCoordsRegion.ts` | EXISTS |

**Note**: `ResourceTile` type (binary map resource tile: `{ type: number, index: number }`) is used via `Map.Resources`. In the existing Ch10 `ResourceLayer`, this is typed as `{ readonly type: number; readonly index: number }` in the `IResourceMap` interface.

#### TypeScript Migration Approach

**Extend the gameplay `ResourceLayer` vs. stand-alone**

The C# `EditorResourceLayer` is a completely separate trait from `ResourceLayer`. Both implement `IResourceLayer`. In TypeScript, we have two approaches:

**Option A (Recommended): Stand-alone class with shared interface**
Create a separate class that implements the same `IResourceLayer` interface. This matches the C# design — the editor world uses `EditorResourceLayer`, the game world uses `ResourceLayer`.

**Option B: Extend ResourceLayer with editor overrides**
Extend `ResourceLayer` and override `canAddResource`, `addResource`, `removeResource` with editor-specific logic.

**Adopted: Option A** — matches OpenRA's trait architecture exactly, avoids coupling gameplay and editor logic.

**NetWorth tracking**: The C# `EditorResourceLayer` maintains `NetWorth` as a running total, updated on each cell change via `UpdateNetWorth()`. This is a pure computation — no external dependencies.

**Resource value lookup**: The `PlayerResourcesInfo` is read from the ruleset actors on `WorldLoaded`. This requires access to `Ruleset.actors["player"].TraitInfo<PlayerResourcesInfo>()`. In TypeScript, we read from the World's map rules:

```typescript
worldLoaded(w: WorldStub, wr: WorldRendererStub): void {
  // Access rules from world.map.rules
  const playerActorInfo = /* world.map.rules.actors.get('player') */
  // Get PlayerResourcesInfo.ResourceValues
  // Build resourceValues Map<string, number>
}
```

This will need a TODO deferral marker if `PlayerResourcesInfo` is not yet migrated.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `NetWorth` | `number` (get) | Total resource value on map |
| `CellChanged` event | `(cell: CPos, resourceType: string) => void` callback registration | |
| `getResource(cell)` | `ResourceLayerContents` | IResourceLayer |
| `getMaxDensity(resourceType)` | `number` | IResourceLayer |
| `canAddResource(resourceType, cell, amount?)` | `boolean` | IResourceLayer — EDITOR: allows type replacement |
| `addResource(resourceType, cell, amount?)` | `number` | IResourceLayer — EDITOR: replaces different types |
| `removeResource(resourceType, cell, amount?)` | `number` | IResourceLayer |
| `clearResources(cell)` | `void` | IResourceLayer |
| `isVisible(cell)` | `boolean` | IResourceLayer — always true in editor |
| `isEmpty` | `boolean` (get) | false in editor (always has resources) |
| `info` | `IResourceLayerInfo` (get) | |
| `CalculateRegionValue(region)` | `number` | Sum resource value in region |
| `CalculateCellDensity(contents, cell)` | `number` | Density algorithm (supports RecalculateResourceDensity) |
| `UpdateCell(cell)` | `void` | Called on Map.Resources.CellEntryChanged |
| `WorldLoaded(w, wr)` | `void` | Initialize from map + register resource change listener |
| `Disposing(self)` | `void` | Unregister resource change listener |

#### Editor-Specific Behavior Differences from ResourceLayer

| Behavior | Gameplay ResourceLayer | EditorResourceLayer |
|----------|----------------------|---------------------|
| **Resource type at cell already has different type** | Rejects add (`content.type !== resourceType`) | Allows replacement (treats as empty) |
| **AllowResourceAt ramp check** | Same | Checks `Map.Ramp[cell] !== 0` |
| **Resource values** | Not tracked | Tracked via `PlayerResourcesInfo.ResourceValues` |
| **NetWorth** | Not computed | Maintained as running total |
| **RecalculateResourceDensity option** | Not available | Configurable via EditorResourceLayerInfo |
| **IsEmpty** | Returns actual empty state | Always false (forces renderer to show editor overlay) |
| **Map.Resources listener** | Not registered | Registered on construction, controls resource update pipeline |

#### Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `PlayerResourcesInfo.ResourceValues` lookup | Requires PlayerResourcesInfo trait info to be available | TODO-21.A.6-DEFER-1 |
| Building check in `AllowResourceAt` (TODO comment at line 239) | Editor doesn't check building occupation yet | TODO-21.A.6-DEFER-2 |
| `ResourceRenderer` integration (visual update on CellChanged) | Editor resource rendering | TODO-21.A.6-DEFER-3 |

#### Test Strategy

| Test Category | Specific Tests |
|---------------|---------------|
| **Construction** | Creates with info, map, empty tiles layer |
| **WorldLoaded** | Initializes all cells from Map.Resources |
| **Cell update from map** | UpdateCell reads resource tile and creates contents |
| **Type replacement** | canAddResource returns true for different resource type (editor allows repainting) |
| **Add resource** | addResource with different type replaces (not rejects) |
| **Remove resource** | removeResource reduces density, clears at 0 |
| **Clear resources** | clearResources sets cell to default |
| **NetWorth tracking** | NetWorth updates as resources are added/removed |
| **RecalculateResourceDensity** | When enabled, density based on neighbor count |
| **Region value** | CalculateRegionValue sums resource values in region |
| **Dispose** | Unregisters Map.Resources listener |
| **Neighbor updates** | Changing one cell updates neighbor densities when RecalculateResourceDensity |
| **Out-of-bounds cells** | Access methods return default/empty for invalid cells |

#### Potential Pitfalls
- The C# `EditorResourceLayer` subscribes to `Map.Resources.CellEntryChanged` on construction and unsubscribes on disposal — this is the **primary data flow**: map changes trigger `UpdateCell`, which updates the CellLayer and fires `CellChanged`
- `AllowResourceAt` checks `Map.Ramp[cell] !== 0` — resources cannot spawn on sloped terrain
- The editor's `CanAddResource` treats mismatching resource type as an **empty cell** (allows replacement), unlike the gameplay version which rejects
- `ResourceTypesByIndex` maps `byte index → string typeName` — must handle missing indices gracefully (default to empty)
- When `RecalculateResourceDensity` is enabled, changing one cell triggers neighbor density updates for all 8 adjacent cells
- `CellChanged?.Invoke(cell, resourceType)` fires on EVERY density change — performance consideration for large brush operations
- `CalculateCellDensity` uses `int2.Lerp(0, maxDensity, adjacent, 9)` — the "9" is a known OpenRA bug (should be 8). Match exactly for compatibility: `Math.max(lerp(0, maxDensity, adjacent, 9), 1)`

---

## Wave 3 — Dependents

### TODO-21.A.7: EditorActorLayer

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Traits/World/EditorActorLayer.cs` (495 lines)
- **Target file**: `src/OpenRA.Mods.Common/Traits/World/EditorActorLayer.ts`
- **Target test**: `src/OpenRA.Mods.Common/Traits/World/EditorActorLayer.test.ts`

#### Class Summary
`EditorActorLayer` is the **central editor actor management trait** on the world actor. It:

1. Stores all `EditorActorPreview` objects in a list + two `SpatiallyPartitioned` indexes (cell-space and screen-space)
2. Creates/removes previews from `ActorReference` definitions
3. Manages actor IDs (auto-incrementing "Actor000", "Actor001", ...)
4. Handles multiplayer spawn counting (creates/removes "Multi0", "Multi1" etc. player slots based on `mpspawn` count)
5. Creates `MapPlayers` from map definitions
6. Routes rendering (IRender, IRenderAnnotations) and per-tick updates (ITickRender)
7. Handles actor movement (remove + reposition + re-add)
8. Notifies neighbors when actors are added/removed (via `UpdateNeighbours`)
9. Saves all actors to serialized format

#### Dependencies

| Type | File Path | Status |
|------|-----------|--------|
| `IRender` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IRenderAnnotations` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `ITickRender` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IWorldLoaded` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `ICreatePlayers` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `INotifyActorDisposing` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | EXISTS |
| `IRadarSignature` (interface) | NOT YET MIGRATED | Might exist in Ch12 |
| `SpatiallyPartitioned<T>` | `src/OpenRA.Game/Primitives/SpatiallyPartitioned.ts` | EXISTS |
| `EditorActorPreview` | TODO-21.A.5 | IN THIS PHASE |
| `EditorActionManager` | TODO-21.A.1 | IN THIS PHASE |
| `PlayerReference` | `src/OpenRA.Game/Map/PlayerReference.ts` | EXISTS |
| `CellCoordsRegion` | `src/OpenRA.Game/Map/CellCoordsRegion.ts` | EXISTS |
| `Rectangle` | `src/OpenRA.Game/Primitives/Rectangle.ts` | EXISTS |
| `WAngle` | `src/OpenRA.Game/WAngle.ts` | EXISTS |
| `CPos` | `src/OpenRA.Game/CPos.ts` | EXISTS |
| `SubCell` | `src/OpenRA.Game/Traits/SubCell.ts` | EXISTS |

**Not yet migrated** (stub/defer required):
- `MapPlayers` (map player definitions) — Ch4 has `MapPlayers.ts`? Let me check... Yes, `src/OpenRA.Game/Map/MapPlayers.ts` might exist
- `IRadarSignature` — Ch12 shroud system
- `MersenneTwister` — Ch17 replay/save
- `PerfTimer` — utility, could stub as `console.time`/`console.timeEnd`
- `Util.ExpandFootprint` — Ch3 utility
- `RuntimeNeighbourInit` — Ch3 actor init types
- `IOccupySpaceInfo` (for SharesCell check) — EXISTS in Ch3

#### TypeScript Migration Approach

**SpatiallyPartitioned dual-indexing**: The layer maintains two spatial indexes:
1. **cellMap**: Uses cell coordinates (offset by min cell X/Y) + `BinSize / TileSize` for bin sizing. Query method: `PreviewsInCellRegion()`, `PreviewsAtCell()`
2. **screenMap**: Uses world pixel coordinates (MapSize * TileSize) + `BinSize` for bin sizing. Query method: `PreviewsInScreenBox()`, `PreviewsAtWorldPixel()`

Both use the existing `SpatiallyPartitioned<T>` class from `src/OpenRA.Game/Primitives/SpatiallyPartitioned.ts`.

**Actor ID management**: The C# code uses a `HashSet<uint>` to track which numeric actor IDs are in use, then finds the next free ID. Actor IDs follow the pattern `Actor[n]` where n is an unsigned integer.

```typescript
private nextActorName(): string {
  let currentId = 0
  while (this.previewIds.has(currentId)) {
    currentId++
  }
  return `Actor${currentId}`
}
```

**Multiplayer spawn sync**: When an actor of type `mpspawn` is added or removed, `SyncMultiplayerCount()` runs to add/remove "Multi[n]" player slots. This requires `MapPlayers` access and `worldRenderer.UpdatePalettesForPlayer()`.

**UpdateNeighbours**: When actors are added/removed, neighboring cells (expanded footprint) are queried for affected previews, and each affected preview gets a `RuntimeNeighbourInit`. This can be **deferred** as a stub — the neighbor system is a quality-of-life feature, not critical for basic editor function.

**IRadarSignature**: `PopulateRadarSignatureCells()` provides cell-color pairs for the minimap. Can be deferred until the radar/minimap is implemented.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `Info` | `EditorActorLayerInfo` (get) | Config (BinSize, DefaultActorFacing) |
| `Players` | `MapPlayers` (get) | Player definitions |
| `Add(reference): EditorActorPreview` | Add single actor from reference |
| `AddRange(references, names?)` | Add multiple actors |
| `Remove(preview)` | Remove single preview |
| `RemoveRange(previews)` | Remove multiple previews |
| `RemoveRegion(region, mask?)` | Remove all actors in cell region |
| `MoveActor(preview, location)` | Reposition an actor |
| `PreviewsInScreenBox(a, b) / PreviewsInScreenBox(r)` | Spatial query: screen-space |
| `PreviewsInCellRegion(region)` | Spatial query: cell-space |
| `PreviewsAtCell(cell)` | Spatial query: point |
| `PreviewsAtWorldPixel(x, y)` | Spatial query: world pixel |
| `FreeSubCellAt(cell)` | Find available subcell |
| `Save()` | Serialize all actors |
| `render(self, wr)` | IRender — render visible previews |
| `renderAnnotations(self, wr)` | IRenderAnnotations — render selection boxes |
| `tickRender(wr, self)` | ITickRender — tick all previews |
| `worldLoaded(w, wr)` | IWorldLoaded — initialize from map |
| `createPlayers(w, playerRandom)` | ICreatePlayers — create MapPlayers |
| `disposing(self)` | INotifyActorDisposing — cleanup |
| `populateRadarSignatureCells(self, buffer)` | IRadarSignature — deferred |
| Indexer `[id: string]` | `EditorActorPreview | undefined` — lookup by ID |

#### Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `UpdateNeighbours` (RuntimeNeighbourInit) | Requires RuntimeNeighbourInit + neighbor computation | TODO-21.A.7-DEFER-1 |
| `IRadarSignature.PopulateRadarSignatureCells` | Minimap not yet migrated | TODO-21.A.7-DEFER-2 |
| `SyncMultiplayerCount` | Requires UpdatePalettesForPlayer + full MapPlayers manipulation | TODO-21.A.7-DEFER-3 |
| `PerfTimer` usage | PerfTimer utility not yet migrated (can stub) | TODO-21.A.7-DEFER-4 |
| `ICreatePlayersInfo.CreateServerPlayers` (throws) | Not needed in editor | already throws |

#### Test Strategy

| Test Category | Specific Tests |
|---------------|---------------|
| **Construction** | Creates with Info, empty preview list |
| **WorldLoaded** | Loads actors from map definitions, initializes spatial indexes |
| **Add single actor** | Creates EditorActorPreview, adds to list + indexes, fires AddedToEditor |
| **AddRange** | Batch-adds multiple actors, updates indexes, syncs multiplayer |
| **Remove single actor** | Removes from list + indexes, fires RemovedFromEditor |
| **RemoveRange** | Batch-removes, updates indexes |
| **RemoveRegion** | Removes actors intersecting cell region |
| **MoveActor** | Remove + re-add at new location with LocationInit |
| **Actor ID generation** | NextActorName skips used IDs |
| **Spatial queries** | PreviewsInScreenBox, PreviewsInCellRegion, PreviewsAtCell return correct results |
| **FreeSubCellAt** | Finds unoccupied sub-cell, returns Invalid when all taken |
| **Save** | Serializes all previews |
| **Rendering** | render() returns renderables for previews in viewport |
| **Annotations** | renderAnnotations returns selection boxes |
| **TickRender** | Calls tick() on all previews |
| **Map change handler** | Terrain change triggers UpdateFromCellChange on affected previews |
| **Indexer** | `layer[id]` returns correct preview or undefined |
| **CreatePlayers** | Creates MapPlayers with worldOwner |

#### Potential Pitfalls
- The `cellOffset` (min X/Y of all map cells) must be subtracted when storing in `cellMap`, and re-added when converting back
- `ScreenBounds` for IRender always yields `break` (empty enumerator) — the world actor's render trait doesn't need screen bounds
- `MoveActor` does a full remove + re-add cycle, which triggers `RemovedFromEditor` and `AddedToEditor` lifecycle events
- When an actor has `IOccupySpaceInfo.SharesCell === true`, `MoveActor` tries to find a free sub-cell; if none exists, it removes the `SubCellInit`
- The `FreeSubCellAt` method returns `SubCell.Invalid` (0xFF) when all sub-cells are occupied
- `TryGetActorId` extracts the numeric ID from the "Actor[n]" prefix — watch for integer overflow with large ID values
- `NextActorNames(count)` is more efficient than calling `NextActorName()` count times (single pass through ID space)

---

### TODO-21.A.8: EditorViewportControllerWidget

#### Source
- **OpenRA file**: `OpenRA/OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.cs` (132 lines)
- **Target file**: `src/OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.ts`
- **Target test**: `src/OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.test.ts`

#### Class Summary
`EditorViewportControllerWidget` extends the gameplay `ViewportControllerWidget` (Ch7) with editor-specific input handling:

1. **Brush management**: Holds the active `IEditorBrush`, sets it on the `EditorCursorLayer`
2. **Editor zoom settings**: Unlocks minimum zoom (0.25f) for seeing the full map
3. **Mouse input routing**: Scroll events go to `worldRenderer.Viewport.AdjustZoom()` directly (editor overrides the base zoom handling), then delegates to the active brush
4. **Tooltip management**: Editor-specific tooltip display (hovered actor preview names)
5. **Brush tick**: Calls `CurrentBrush.Tick()` each frame
6. **Brush dispose**: Non-default brushes are disposed when replaced

#### Dependencies

| Type | File Path | Status |
|------|-----------|--------|
| `Widget` (base class) | `src/OpenRA.Game/Widgets/Widget.ts` | EXISTS |
| `ViewportControllerWidget` (base class) | `src/OpenRA.Mods.Common/Widgets/ViewportControllerWidget.ts` | EXISTS |
| `EditorCursorLayer` | TODO-21.A.4 | IN THIS PHASE |
| `IEditorBrush` | Shared interface (see EditorCursorLayer) | IN THIS PHASE |
| `Viewport` | `src/OpenRA.Game/Graphics/Viewport.ts` | EXISTS |
| `Modifiers` (enum) | `src/OpenRA.Game/Input/IInputHandler.ts` | EXISTS |
| `MouseInputEvent` (enum) | `src/OpenRA.Game/Input/IInputHandler.ts` | EXISTS |
| `Color` | `src/OpenRA.Game/Primitives/Color.ts` | EXISTS |
| `MapGridType` | `src/OpenRA.Game/Map/MapGridType.ts` | EXISTS |
| `TooltipContainerWidget` | `src/OpenRA.Game/Widgets/Widget.ts` (via Ui.Root.Get) | NOT CERTAIN |

**Note**: The C# constructor takes `WorldRenderer` directly and accesses `worldRenderer.World.WorldActor.Trait<EditorCursorLayer>()`. In TypeScript, this will need either:
- Direct dependency injection (pass EditorCursorLayer as constructor parameter), or
- World/Trait system access (trait lookup on world actor)

The C# `DefaultBrush` class (`EditorDefaultBrush`) and `IEditorBrush` interface are defined in `EditorViewportControllerWidget.cs` or in a separate file. The C# source only references `EditorDefaultBrush`, `IEditorBrush`, and the action classes through `[IncludeStaticFluentReferences]`.

#### TypeScript Migration Approach

**UI System: Existing DOM/Widget system (MANAGER APPROVED, NOT Babylon.js GUI)**

Per Manager decision: The editor viewport widget uses the same Ch5/Ch7 Widget/DOM system, NOT Babylon.js GUI. This maintains consistency with Ch7's `ViewportControllerWidget` which already uses DOM events for mouse handling. HTML overlay panels (tooltips, brush indicators) render via the Widget tree, not via Babylon.js GUI advanced texture.

**Extending ViewportControllerWidget**: The Editor version overrides:
- `constructor`: Creates `DefaultBrush`, sets brush on `EditorCursorLayer`, unlocks minimum zoom
- `handleMouseInput(mi)`: Scroll events go directly to `worldRenderer.Viewport.AdjustZoom()` (the editor has different zoom behavior from the game), then delegates to brush
- `tick()`: Clear tooltips when viewport scrolled, then tick the active brush
- `mouseEntered()` / `mouseExited()`: Tooltip enable/disable

**Brush lifecycle**: Non-default brushes are disposed when replaced. The default brush is never disposed.

**SelectionAltOffset calculation**: Based on `MapGrid.Type`:
```typescript
this.selectionAltOffset = world.Map.Grid.Type === MapGridType.Rectangular
  ? { x: 1, y: 1 }
  : { x: 0, y: 1 }
```

**Tooltip integration**: The OpenRA source uses `Lazy<TooltipContainerWidget>` for deferred tooltip access. In TypeScript, we can use a getter that lazily resolves the widget from the UI tree.

**C# events → TypeScript callbacks**: `BrushChanged` event maps to `onBrushChanged` callback array pattern.

#### Key Public Members

| Member | TypeScript Signature | Notes |
|--------|---------------------|-------|
| `SelectionMainColor` | `Color` (config) | White (default) |
| `SelectionAltColor` | `Color` (config) | Black (default) |
| `PasteColor` | `Color` (config) | Green (`#4CFF00`, default) |
| `CurrentBrush` | `IEditorBrush` (get) | Active brush |
| `DefaultBrush` | `EditorDefaultBrush` (get) | Default brush (readonly) |
| `TooltipContainer` | `string` (config) | Tooltip widget ID |
| `TooltipTemplate` | `string` (config) | Tooltip template ID |
| `SelectionAltOffset` | `{ x: number; y: number }` (get) | Grid-dependent offset |
| `BrushChanged` event | Callback registration | Fires when brush changes |
| `clearBrush()` | Reset to default brush | |
| `setBrush(brush)` | Swap active brush | Disposes previous non-default |
| `setTooltip(tooltip)` | Show/hide tooltip | |
| `handleMouseInput(mi)` | Override: scroll → zoom, otherwise → brush |
| `tick()` | Override: clear tooltips on viewport move, tick brush |
| `mouseEntered()` | Override: enable tooltips |
| `mouseExited()` | Override: disable tooltips, remove currently shown |

#### Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| `EditorDefaultBrush` implementation | This is a brush that will be implemented in Phase B | TODO-21.A.8-DEFER-1 |
| `TooltipContainerWidget` full integration | Requires TooltipContainerWidget to be migrated | TODO-21.A.8-DEFER-2 |
| `FluentProvider` static references (`ChangeSelectionAction`, etc.) | Localization not yet migrated | TODO-21.A.8-DEFER-3 |
| `Game.Settings.Game.ZoomModifier` / `Game.Settings.Game.ZoomSpeed` | Requires full GameSettings | TODO-21.A.8-DEFER-4 |

#### Test Strategy

| Test Category | Specific Tests |
|---------------|---------------|
| **Construction** | Creates with worldRenderer, default brush, sets brush on cursor layer |
| **ClearBrush** | Reset to default brush |
| **SetBrush** | Replaces current brush, disposes previous non-default, fires BrushChanged |
| **SelectionAltOffset** | Rectangular grid → {1,1}, Isometric → {0,1} |
| **Mouse Scroll** | Scroll events with zoom modifier adjust viewport zoom |
| **Mouse Delegate** | Other mouse events delegate to CurrentBrush.handleMouseInput |
| **Tick** | Calls CurrentBrush.tick(), clears tooltip on viewport move |
| **Tooltip** | setTooltip shows/hides tooltip when tooltips enabled |
| **MouseEnter/MouseExit** | enableTooltips flag toggles |
| **Zoom unlock** | Viewport minimum zoom set to 0.25 (allows full map view) |

#### Potential Pitfalls
- The editor override of `handleMouseInput` replaces the base class zoom behavior — editor scroll always adjusts zoom (no `ZoomModifier` check in the C# code's scroll path)
- The base class `ViewportControllerWidget.handleEvent` dispatches to `handleKeyEvent`/`handleMouseEvent`. The editor widget must override `handleEvent` or `handleMouseInput` to intercept scroll events before the base class processes them. **Check the C# call flow**: the editor's `HandleMouseInput` calls `worldRenderer.Viewport.AdjustZoom()` on scroll, THEN calls `CurrentBrush.HandleMouseInput()`, THEN falls back to `base.HandleMouseInput()`. The base handles scroll differently — the editor intercepts scroll first.
- `SetBrush(null)` calls `ClearBrush()` which resets to default brush (not null)
- `CurrentBrush` is never null — always at least the `DefaultBrush`
- The C# uses `[ObjectCreator.UseCtor]` on the constructor — this means WidgetLoader creates it via constructor injection (receives `WorldRenderer`). In TypeScript, the WidgetLoader pattern needs to support this.
- The `[IncludeStaticFluentReferences]` attribute on the class lists action types (`ChangeSelectionAction`, `DeleteAreaAction`, `RemoveActorAction`, `RemoveResourceAction`, `MoveActorAction`). These are localization hints — in TypeScript, document these as JSDoc comments.

---

## Shared Types & Interfaces

All shared editor interfaces live under `src/OpenRA.Mods.Common/Editor/` (APPROVED by Manager). This mirrors OpenRA's `OpenRA.Mods.Common/EditorBrushes/` directory structure as the natural parent for editor types.

### IEditorBrush

Defined in `src/OpenRA.Mods.Common/Editor/IEditorBrush.ts`:

```typescript
import type { IGameActor, IRenderable, WorldRendererStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

export interface IEditorBrush {
  /** Called each render frame. OpenRA 对照: IEditorBrush.TickRender() */
  tickRender(wr: WorldRendererStub, self: IGameActor): void

  /** Render above the shroud layer. OpenRA 对照: IEditorBrush.RenderAboveShroud() */
  renderAboveShroud(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[]

  /** Render annotations on top (range circles, etc.). OpenRA 对照: IEditorBrush.RenderAnnotations() */
  renderAnnotations(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[]

  /** Handle a mouse input event. Returns true if handled.
   * OpenRA 对照: IEditorBrush.HandleMouseInput(MouseInput) */
  handleMouseInput(mi: unknown): boolean

  /** Called each logic tick. OpenRA 对照: IEditorBrush.Tick() */
  tick(): void

  /** Release resources. OpenRA 对照: IDisposable.Dispose() */
  dispose(): void
}
```

### IEditorAction

Defined in `src/OpenRA.Mods.Common/Editor/IEditorAction.ts` (or co-located with EditorActionManager):

```typescript
export interface IEditorAction {
  /** Execute the action for the first time. OpenRA 对照: IEditorAction.Execute() */
  execute(): void

  /** Execute (or re-execute) the action. OpenRA 对照: IEditorAction.Do() */
  do(): void

  /** Reverse the action. OpenRA 对照: IEditorAction.Undo() */
  undo(): void

  /** Human-readable description. OpenRA 对照: IEditorAction.Text */
  readonly text: string
}
```

### EditorActionStatus

```typescript
export const EditorActionStatus = {
  History: 0,
  Active: 1,
  Future: 2,
} as const
export type EditorActionStatus = (typeof EditorActionStatus)[keyof typeof EditorActionStatus]
```

### EditorActionContainer

```typescript
export class EditorActionContainer {
  readonly id: number
  readonly action: IEditorAction
  status: EditorActionStatus

  constructor(id: number, action: IEditorAction) {
    this.id = id
    this.action = action
    this.status = EditorActionStatus.Active
  }
}
```

### EditorSelection

Defined in `src/OpenRA.Mods.Common/Editor/EditorSelection.ts`:

```typescript
/** Selection state for the editor. Tracks which actor previews are selected
 * and the source cell region of the selection.
 *
 * OpenRA 对照: N/A (state managed in EditorDefaultBrush internally)
 *
 * Extracted as a shared type because EditorDefaultBrush (Phase B),
 * EditorSelectionAnnotationRenderable, and EditorViewportControllerWidget
 * all need access to selection state.
 */
export interface EditorSelection {
  /** Currently selected actor previews. */
  readonly selectedActors: readonly (import('../Traits/World/EditorActorPreview').EditorActorPreview)[]

  /** The source cell region (e.g., for copy/paste or area delete). */
  readonly sourceRegion: import('../../../OpenRA.Game/Map/CellCoordsRegion').CellCoordsRegion | null

  /** The paste region (target for copy/paste operations). */
  readonly pasteRegion: import('../../../OpenRA.Game/Map/CellCoordsRegion').CellCoordsRegion | null

  /** Whether anything is currently selected. */
  readonly isEmpty: boolean
}

export const EditorSelectionEmpty: EditorSelection = Object.freeze({
  selectedActors: Object.freeze([]),
  sourceRegion: null,
  pasteRegion: null,
  get isEmpty() { return this.selectedActors.length === 0 && this.sourceRegion === null },
})
```

---

## Migration Order & Dependencies

```
Wave 1 (Foundation — block all editor operations):
  TODO-21.A.1  EditorActionManager          ← NO dependencies on other Ch21 files
                                            ← Depends on: IWorldLoaded, WorldStub, WorldRendererStub

Wave 2 (Independent — can be parallel after Wave 1):
  TODO-21.A.2  MapEditorData                ← NO deps on other Ch21 files (data-only)
  TODO-21.A.4  EditorCursorLayer            ← Depends on: IEditorBrush (new interface, co-defined)
  TODO-21.A.6  EditorResourceLayer          ← Depends on: IResourceLayer, ResourceLayer (Ch10)
  TODO-21.A.3  EditorSelectionAnnotation... ← Depends on: CellCoordsRegion, IRenderable (Ch3/Ch4)
  TODO-21.A.5  EditorActorPreview           ← Depends on: ActorReference stubs, IRenderable (Ch3)

Wave 3 (Dependents — after Wave 1 + Wave 2):
  TODO-21.A.7  EditorActorLayer             ← Depends on: EditorActorPreview (A.5), EditorActionManager (A.1),
                                               SpatiallyPartitioned, EditorActorPreview
  TODO-21.A.8  EditorViewportControllerWidget  ← Depends on: EditorCursorLayer (A.4),
                                                    IEditorBrush, ViewportControllerWidget (Ch7),
                                                    EditorDefaultBrush (can be stub)
```

**Recommended execution order**:
1. EditorActionManager + IEditorAction (TypeScript interfaces first)
2. IEditorBrush interface + MapEditorData (data-only, trivial)
3. EditorCursorLayer + EditorResourceLayer (parallel)
4. EditorSelectionAnnotationRenderable + EditorActorPreview (parallel)
5. EditorActorLayer (depends on A.1 + A.5)
6. EditorViewportControllerWidget (depends on A.4 + A.7 features)

### Total New Files: 8 TS + 8 test + 3 shared interface files = 19 files

| # | Target File | Test File | Lines (est.) |
|---|-------------|-----------|-------------|
| 1 | `Editor/IEditorAction.ts` | (tested via EditorActionManager test) | ~20 |
| 2 | `Editor/EditorActionStatus.ts` | (shared enum, tested via EditorActionManager test) | ~15 |
| 3 | `Editor/IEditorBrush.ts` | (tested via brush implementations in Phase B) | ~30 |
| 4 | `Editor/EditorSelection.ts` | (pure type, tested via EditorDefaultBrush in Phase B) | ~30 |
| 5 | `Traits/World/EditorActionManager.ts` | `Traits/World/EditorActionManager.test.ts` | ~250 / ~300 |
| 6 | `Traits/MapEditorData.ts` | `Traits/MapEditorData.test.ts` | ~80 / ~90 |
| 7 | `Graphics/EditorSelectionAnnotationRenderable.ts` | `Graphics/EditorSelectionAnnotationRenderable.test.ts` | ~200 / ~200 |
| 8 | `Traits/World/EditorCursorLayer.ts` | `Traits/World/EditorCursorLayer.test.ts` | ~100 / ~120 |
| 9 | `Traits/World/EditorActorPreview.ts` | `Traits/World/EditorActorPreview.test.ts` | ~500 / ~450 |
| 10 | `Traits/World/EditorResourceLayer.ts` | `Traits/World/EditorResourceLayer.test.ts` | ~450 / ~400 |
| 11 | `Traits/World/EditorActorLayer.ts` | `Traits/World/EditorActorLayer.test.ts` | ~600 / ~500 |
| 12 | `Widgets/EditorViewportControllerWidget.ts` | `Widgets/EditorViewportControllerWidget.test.ts` | ~250 / ~250 |

**Estimated total**: ~2,525 implementation lines + ~2,310 test lines ≈ 4,835 lines

---

## Key Architecture Decisions

### ADR-21.1-A: Editor uses shared engine with disabled simulation

The editor world is a standard `World` instance with `SystemActors.EditorWorld` trait location. The key difference is that the editor world has no `ITick` processing, no player orders, and no networking. Actors are represented as `EditorActorPreview` (render-only proxy) rather than full `GameActor` instances.

**Consequences**: Editor and game share the terrain system, rendering pipeline, and map data types. Editor-specific traits use `[TraitLocation(SystemActors.EditorWorld)]` to prevent accidental use in gameplay.

### ADR-21.2-A: IEditorAction with explicit do/undo

The `IEditorAction` interface uses three methods (`execute`/`do`/`undo`) rather than a simpler two-method approach (`execute`/`undo` where `execute` = first-time `do`). This separates the first-time execution (which may allocate resources) from re-execution (which reuses allocated resources).

**Consequences**: Action implementations must track their own state (what resources were created/removed). This enables efficient undo/redo without full state clones.

### ADR-21.3-A: EditorActorPreview is render-only

`EditorActorPreview` does not create a `TraitDictionary`, does not process `ITick`, and does not run `Activity` graphs. It uses `IRenderActorPreviewInfo` trait infos to generate preview renderables. This is a fundamental design choice: editor actors are **preview proxies**, not simulated entities.

**Consequences**: Much lighter weight than GameActor (no component lifecycle). Cannot participate in combat, movement, or resource harvesting. Must be converted to full ActorReference → GameActor when the map is saved and loaded as a game.

### ADR-21.5-A: Undo stack capped at 100

The undo stack holds at most 101 entries (100 user actions + 1 sentinel `OpenMapAction`). When the cap is exceeded, the oldest action (after the sentinel) is removed. This prevents unbounded memory growth during long editing sessions.

**Consequences**: Actions older than the cap cannot be undone. The action at index 0 is always `OpenMapAction` — never removed. Batched cell diffs (not full map copies) mean actions are small and fixed-size.

### ADR-21.A-APPROVED-1: Editor/ subdirectory for shared interfaces (Manager 2026-06-18)

Shared editor interfaces (`IEditorBrush`, `IEditorAction`, `EditorSelection`) live under `src/OpenRA.Mods.Common/Editor/`. This mirrors OpenRA's `OpenRA.Mods.Common/EditorBrushes/` directory as the natural parent namespace for editor types in TypeScript. Directory parity is preserved because the C# EditorBrushes directory implies `Editor/` as its parent namespace.

### ADR-21.A-APPROVED-2: EditorActorPreview MVP scope reduction (Manager 2026-06-18)

Phase A delivers a minimal viable EditorActorPreview with: sprite rendering at cell position, facing rotation, owner color, selection highlight, and dispose. Eight features are explicitly deferred (INotifyEditorPlacementInfo, IActorPreview pipeline, SelectionBoxAnnotationRenderable, RadarColorFromTerrainInfo, building CenterOffset, MiniYaml save, RuntimeNeighbourInit). All deferred features have clear TODO markers and can be added incrementally when Phase B brushes need them.

### ADR-21.A-APPROVED-3: DOM/Widget system for UI, NOT Babylon.js GUI (Manager 2026-06-18)

EditorViewportControllerWidget extends the existing Ch5/Ch7 Widget/DOM system, not Babylon.js GUI advanced textures. This maintains consistency: Ch7's ViewportControllerWidget already uses DOM events for mouse handling, and HTML overlay panels are preferred for tooltips, brush indicators, and editor chrome. Babylon.js is reserved for 3D scene rendering only.

### ADR-21.A-NEW: Brush-based editor tool system

The editor uses a brush abstraction (`IEditorBrush`) for all editing tools. The `EditorCursorLayer` holds the active brush, and `EditorViewportControllerWidget` manages brush lifecycle. This enables hot-swapping between selection, painting, actor placement, and other tools without changing the world actor's trait composition.

**Consequences**: Brush implementations (Phase B) must be self-contained — they handle their own input, rendering, and state. The cursor layer is a pure delegation pass-through.
