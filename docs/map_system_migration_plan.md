# OpenRA to Babylon.js Migration Plan: Chapter 4 -- Map and Terrain System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 5 (lines 627-850)
> **Chapter Status**: Chapter 4 -- PLANNING (0/19 migrated, 0%)
> **Planning Date**: 2026-06-04
> **Prerequisite**: Chapter 2 (Rendering Engine) -- COMPLETE (27/27, 100%); Chapter 3 (Actor System) -- COMPLETE (36/36, 100%)
> **Coordinate System Dependencies**: WPos, WVec, CPos, MPos, WAngle, WDist -- ALREADY COMPLETE (Chapter 3 Phase A)
> **Overall Complexity**: VERY HIGH (Map.cs is 45K; HierarchicalPathFinder is 55K; combined ~130K+ lines C#)

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: MapGrid + CellLayer (Grid Foundation)](#31-phase-a-mapgrid--celllayer-grid-foundation)
   - 3.2 [Phase B: TerrainInfo (Tile & Terrain Types)](#32-phase-b-terraininfo-tile--terrain-types)
   - 3.3 [Phase C: Map.cs (Map Core -- HIGHEST COMPLEXITY)](#33-phase-c-mapcs--map-core)
   - 3.4 [Phase D: CellRegion + ProjectedCellLayer (Spatial Regions)](#34-phase-d-cellregion--projectedcelllayer-spatial-regions)
   - 3.5 [Phase E: MapCache & MapPreview (Map Metadata)](#35-phase-e-mapcache--mappreview-map-metadata)
   - 3.6 [Phase F: HierarchicalPathFinder (Pathfinding -- HIGH)](#36-phase-f-hierarchicalpathfinder--pathfinding)
   - 3.7 [Phase G: Terrain 3D Mesh Generation (NEW)](#37-phase-g-terrain-3d-mesh-generation-new)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

OpenRA's map system is the **data foundation** of the entire game engine. It stores terrain data in a 2D grid of cells with discrete height values (0-255), 20 discrete ramp shapes, and binary tile/resource layers. The migration to Babylon.js 3D involves the most fundamental paradigm shift in the entire project: **from 2D tile maps with discrete height bytes to continuous 3D terrain meshes**.

The core challenge is that OpenRA treats height as a visual offset applied during 2D sprite rendering, while in 3D, height becomes actual geometry -- Y-axis vertex displacement on a terrain mesh. The `CellRamp` system's 20 discrete shapes (flat, half-corner, full-corner, diagonal split) must be translated into continuous 3D vertex coordinates with proper triangle tessellation.

### 1.2 Five Core Architectural Principles

1. **Data-first, mesh-later**: Load and parse ALL map data (tiles, height, resources, ramps) as pure data structures BEFORE generating any 3D geometry. This enables previews, validation, and unit testing without WebGL.
2. **Build-time MiniYAML compilation**: OpenRA's custom YAML dialect (MiniYAML with `@` named nodes, conditional fields) MUST be pre-compiled to JSON at build time. Browser-side parsing is not feasible.
3. **Height as geometry**: The 0-255 byte height values drive actual Y-axis vertex displacement on 3D terrain mesh, not 2D sprite offsets.
4. **CellRamp → vertex corners**: Each of 20 discrete `CellRamp` shapes maps to specific per-corner height offsets on a quad cell, with diagonal splits determining triangle tessellation.
5. **Pathfinding as pure algorithm**: HPA* is a pure data-structure algorithm with NO rendering deps. It can be developed and tested in complete isolation from the 3D engine.

### 1.3 What's Already Done (Chapter 3 Phase A)

The coordinate system foundation is COMPLETE. These types MUST be reused, NOT reimplemented:

| Type | Location | Status |
|------|----------|--------|
| `WPos` (3D world position, 1024 units/cell) | `src/OpenRA.Game/WPos.ts` | Complete |
| `WVec` (3D world vector) | `src/OpenRA.Game/WVec.ts` | Complete |
| `CPos` (Cell position, X/Y/Layer) | `src/OpenRA.Game/CPos.ts` | Complete |
| `MPos` (Map array index, U/V) | `src/OpenRA.Game/MPos.ts` | Complete |
| `CVec` (Cell vector, 8 directions) | `src/OpenRA.Game/CVec.ts` | Complete |
| `WAngle` (World angle, 0-1024 = full circle) | `src/OpenRA.Game/WAngle.ts` | Complete |
| `WDist` (World distance) | `src/OpenRA.Game/WDist.ts` | Complete |
| `WRot` (3D rotation matrix) | `src/OpenRA.Game/WRot.ts` | Complete |
| `MapGridType` (Rectangular/RectangularIsometric) | `src/OpenRA.Game/Map/MapGridType.ts` | Complete |
| `MapGridType.test.ts` | `src/OpenRA.Game/Map/MapGridType.test.ts` | Complete |
| `PriorityQueue` (min-heap, used by pathfinding) | `src/OpenRA.Game/Primitives/PriorityQueue.ts` | Complete |
| `SpatiallyPartitioned` (spatial hash) | `src/OpenRA.Game/Primitives/SpatiallyPartitioned.ts` | Complete |
| `Cache` / `CachedTransform` | `src/OpenRA.Game/Primitives/` | Complete |
| `ActionQueue` (deferred actions) | `src/OpenRA.Game/Primitives/ActionQueue.ts` | Complete |

### 1.4 Key Architecture Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MiniYAML parsing | Build-time pre-compilation to JSON | Browser YAML parsers cannot handle OpenRA's custom dialect |
| Height representation | Keep 0-255 byte + HEIGHT_SCALE normalization factor | Preserves data fidelity; rendering multiplies by scale |
| CellRamp → 3D geometry | Direct conversion: Corners → vertex Y offsets, Polygons → triangle indices | Preserves exact OpenRA terrain shapes |
| Pathfinding engine | Hybrid: HPA* core in TypeScript + RecastNavigation option for 3D crowd simulation | HPA* gives deterministic behavior; Recast gives 3D obstacle avoidance |
| map.bin parsing | Custom `DataView`-based binary parser in TypeScript | No equivalent npm package for OpenRA's proprietary format |
| Terrain textures | Texture splatting with custom `ShaderMaterial` | Replaces per-tile sprite rendering; enables smooth terrain blending |
| `IReadOnlyFileSystem` dependency | Stub interface + `AssetManager` fetch-based loading | Browser has no local filesystem; all assets loaded via HTTP |
| ProjectedCellLayer | NOP stub (Babylon.js frustum culling replaces projection) | 3D engine handles visibility natively |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (19 files across 7 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Grid Foundation** | | | | | | |
| 1 | `OpenRA.Game/Map/MapGrid.cs` | `src/OpenRA.Game/Map/MapGrid.ts` | `MapGrid`, `CellRamp`, `RampSplit`, `RampCornerHeight` | 274 | HIGH | A |
| 2 | `OpenRA.Game/Map/CellLayerBase.cs` | `src/OpenRA.Game/Map/CellLayerBase.ts` | `CellLayerBase<T>` (abstract) | 68 | Low | A |
| 3 | `OpenRA.Game/Map/CellLayer.cs` | `src/OpenRA.Game/Map/CellLayer.ts` | `CellLayer<T>` | 142 | Medium | A |
| **Phase B: Terrain & Tile Types** | | | | | | |
| 4 | `OpenRA.Game/Map/TerrainInfo.cs` | `src/OpenRA.Game/Map/TerrainInfo.ts` | `ITerrainInfo`, `TerrainTypeInfo`, `TerrainTileInfo`, `TileSet`, `Riser`, `ITerrainLoader` | 195 | Medium | B |
| **Phase C: Map Core (HIGHEST COMPLEXITY)** | | | | | | |
| 5 | `OpenRA.Game/Map/Map.cs` | `src/OpenRA.Game/Map/Map.ts` | `Map`, `BinaryDataHeader` | 1331 | **VERY HIGH** | C |
| 6 | `OpenRA.Game/Map/ActorReference.cs` | `src/OpenRA.Game/Map/ActorReference.ts` | `ActorReference` | 176 | Low | C |
| 7 | `OpenRA.Game/Map/ActorInitializer.cs` | `src/OpenRA.Game/Map/ActorInitializer.ts` | `ActorInitializer` | 236 | Medium | C |
| 8 | `OpenRA.Game/Map/MapPlayers.cs` | `src/OpenRA.Game/Map/MapPlayers.ts` | `MapPlayers`, `PlayerReference` | 78 | Low | C |
| 9 | `OpenRA.Game/Map/TileReference.ts` | `src/OpenRA.Game/Map/TileReference.ts` | `TileReference<T>` (NEW -- extracted from Map.cs) | — | Low | C |
| **Phase D: Spatial Regions** | | | | | | |
| 10 | `OpenRA.Game/Map/CellRegion.cs` | `src/OpenRA.Game/Map/CellRegion.ts` | `CellRegion`, `CellCoordsRegion`, `MapCoordsRegion` | 250 | Medium | D |
| 11 | `OpenRA.Game/Map/ProjectedCellLayer.cs` | `src/OpenRA.Game/Map/ProjectedCellLayer.ts` | `ProjectedCellLayer` | 48 | NOP | D |
| 12 | `OpenRA.Game/Map/ProjectedCellRegion.cs` | `src/OpenRA.Game/Map/ProjectedCellRegion.ts` | `ProjectedCellRegion` | 109 | NOP/Low | D |
| **Phase E: Map Metadata (Deferrable)** | | | | | | |
| 13 | `OpenRA.Game/Map/MapCache.cs` | `src/OpenRA.Game/Map/MapCache.ts` | `MapCache` | 395 | Medium | E |
| 14 | `OpenRA.Game/Map/MapPreview.cs` | `src/OpenRA.Game/Map/MapPreview.ts` | `MapPreview` | 737 | HIGH | E |
| 15 | `OpenRA.Game/Map/MapDirectoryTracker.cs` | `src/OpenRA.Game/Map/MapDirectoryTracker.ts` | `MapDirectoryTracker` | 103 | Low | E |
| 16 | `OpenRA.Game/Map/MapGenerationArgs.cs` | `src/OpenRA.Game/Map/MapGenerationArgs.ts` | `MapGenerationArgs` | 44 | Low | E |
| **Phase F: Pathfinding (HIGH)** | | | | | | |
| 17 | `OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.cs` | `src/OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.ts` | `HierarchicalPathFinder` | 1743 | **VERY HIGH** | F |
| 18 | `OpenRA.Mods.Common/Pathfinder/PathSearch.cs` | `src/OpenRA.Mods.Common/Pathfinder/PathSearch.ts` | `PathSearch` | 482 | HIGH | F |
| 19 | `OpenRA.Mods.Common/Pathfinder/*PathGraph.cs` (4 files) | `src/OpenRA.Mods.Common/Pathfinder/PathGraphs.ts` | `IPathGraph`, `DensePathGraph`, `GridPathGraph`, `MapPathGraph`, `SparsePathGraph` | 454 | Medium | F |
| 20 | `OpenRA.Mods.Common/Pathfinder/CellInfo.cs` + `CellInfoLayerPool.cs` | `src/OpenRA.Mods.Common/Pathfinder/CellInfo.ts` | `CellInfo`, `CellInfoLayerPool` | 118 | Low | F |
| 21 | `OpenRA.Mods.Common/Pathfinder/Grid.cs` | `src/OpenRA.Mods.Common/Pathfinder/Grid.ts` | `Grid` (utility) | 95 | Low | F |
| **Phase G: 3D Terrain Mesh (NEW -- No OpenRA Counterpart)** | | | | | | |
| 22 | *(No OpenRA source)* | `src/OpenRA.Game/Map/TerrainMeshGenerator.ts` | `TerrainMeshGenerator` | — | HIGH | G |

> **Complexity Legend**:
> - **LOW**: Pure data structures, no external deps beyond Chapter 3 primitives. <200 lines C#. Can be parallel-assigned.
> - **MEDIUM**: Some algorithmic complexity or multiple dependencies. 200-500 lines C#.
> - **HIGH**: Complex algorithms or significant 3D integration. 500-1000+ lines C#.
> - **VERY HIGH**: Architectural keystones. 1000+ lines C# with many dependencies and complex state management.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 22 (19 from OpenRA + 3 new) |
| **Phase A (grid foundation)** | 3 files |
| **Phase B (terrain types)** | 1 file |
| **Phase C (map core)** | 5 files |
| **Phase D (spatial regions)** | 3 files (1 NOP) |
| **Phase E (map metadata)** | 4 files (deferrable) |
| **Phase F (pathfinding)** | 5 files |
| **Phase G (3D terrain mesh)** | 1 file (new) |
| **VERY HIGH complexity** | 2 files (Map.cs, HierarchicalPathFinder.cs) |
| **HIGH complexity** | 3 files (MapGrid.cs, MapPreview.cs, TerrainMeshGenerator.ts) |
| **MEDIUM complexity** | 5 files |
| **LOW complexity** | 11 files |
| **NOP/stub** | 1 file (ProjectedCellLayer) |
| **Total C# source lines** | ~6,400 |
| **Total planned TODO items** | ~55 |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: MapGrid + CellLayer (Grid Foundation)

**Status**: 2/3 -- MapGridType.ts exists; MapGrid.ts, CellLayerBase.ts, CellLayer.ts pending
**Complexity**: Medium-HIGH
**Blocked by**: Nothing beyond Chapter 3 Phase A (WPos, WVec, CPos, MPos -- all complete)
**Blocks**: EVERYTHING else in Chapter 4 (Map.cs, TerrainInfo, Pathfinding, TerrainMesh)

**Description**: The grid system defines the geometric foundation of the entire map. `MapGrid` specifies the grid type (Rectangle/Isometric), tile scale, maximum terrain height, and -- critically -- the 20 discrete `CellRamp` shapes. `CellLayer<T>` provides the generic 2D storage layer that all map data (Tiles, Height, Resources, Ramp) uses. Both MUST be migrated first as they are dependencies of Map.cs.

**Key Paradigm Shifts**:
- C# `readonly struct CellRamp` (stack-allocated, immutable) -> TypeScript class with `readonly` fields
- C# `ImmutableArray<WVec>` -> TypeScript `readonly WVec[]` (frozen after construction)
- C# `CellLayer<T>` with `event CellEntryChanged` -> TypeScript with `Observable` pattern for change notifications
- `SubCellOffsets` (6 WVec values for unit sub-positioning) -> 3D Vector3 offsets sampled from terrain height

#### 3.1.1 MapGrid.ts -- Grid Geometry Definition

- [ ] **TODO-4.A.1** `src/OpenRA.Game/Map/MapGrid.ts` -- Full `MapGrid` class and `CellRamp` structure:
  - `MapGrid` class:
    - `type: MapGridType` (reuse `src/OpenRA.Game/Map/MapGridType.ts`, already migrated)
    - `tileScale: number` (1024 for Rectangular, 1448 for RectangularIsometric)
    - `maximumTerrainHeight: number` (byte, default 0)
    - `ramps: readonly CellRamp[]` (all 20 pre-defined ramp types, computed once on construction)
    - `subCellOffsets: readonly WVec[]` (6 sub-cell offset vectors for fine-grained unit positioning)
    - `tileSize: Size` (derived: 1024x1024 or 1448x1448)
  - `CellRamp` class (immutable):
    - `centerHeightOffset: number` (integer height offset for cell center)
    - `corners: readonly WVec[]` (4 corners: TL, TR, BR, BL)
    - `polygons: readonly (readonly WVec[])[]` (triangle tessellation faces -- each face is an array of 3 WVec vertices)
    - `orientation: WRot` (rotation for isometric variants)
    - Static factory method: `CellRamp.create(type, orientation, tl, tr, br, bl, split)`
  - `RampCornerHeight` enum: `Low = 0, Half = 1, Full = 2`
  - `RampSplit` enum: `Flat, X, Y`
  - Static ramp generation for all 20 types (6 flat + 4 two-adjacent + 4 one-corner + 4 three-corner + 2 diagonal):
    - Flat (all Low): centerH=0
    - Two adjacent Half: 4 variants (TL+TR, TR+BR, BR+BL, BL+TL)
    - One corner Half: 4 variants, each split X or Y based on position
    - Three corners Half: 4 variants (all-but-one Half, centerH increments)
    - Two diagonal Half: 2 variants (TL+BR diagonal = split Flat; TR+BL diagonal = X split)
    - Full-height ramps: all corners Full (centerH=2)
  - **CRITICAL**: Corner Z-components for rectangular: `WVec(±512, ±512, ±512*h)`. For isometric: `WVec(0, ±724, ±724*h)` and `WVec(±724, 0, ±724*h)`.

- [ ] **TODO-4.A.2** `src/OpenRA.Game/Map/CellLayerBase.ts` -- Abstract base for typed cell layers:
  - Generic `CellLayerBase<T>` abstract class
  - Internal storage: `data: T[]` (flat array, length = `width * height`)
  - `width: number`, `height: number`, `gridType: MapGridType`
  - Index computation: `indexOf(mpos: MPos): number` -- implements rectangular AND isometric formulas
    - Rectangular: `v * width + u`
    - Isometric: `u = (x - y) / 2`, `v = x + y`, `index = v * width + u`
    - Invalid cell detection for isometric: `x < y` returns -1
  - Abstract: `copyValuesFrom(other: CellLayerBase<T>): void`, `clear(): void`
  - Concrete: `get(mpos: MPos): T`, `set(mpos: MPos, value: T): void`
  - `contains(mpos: MPos): boolean`
  - `toArray(): T[]` (returns copy of internal data)

- [ ] **TODO-4.A.3** `src/OpenRA.Game/Map/CellLayer.ts` -- Typed cell layer with change events:
  - Extends `CellLayerBase<T>`
  - `onCellEntryChanged: Observable<CPos>` (replaces C# `event Action<CPos> CellEntryChanged`)
  - Constructor: `CellLayer(map: Map)` or `CellLayer(gridType: MapGridType, size: Size)`
  - Override `copyValuesFrom()` -- throws if listeners are attached (matches OpenRA invariant)
  - Override `clear()` -- throws if listeners are attached
  - `set(mpos, value)` -- fires `onCellEntryChanged` after write
  - **Performance**: No per-cell allocation. Reuse a single CPos instance for event notification, or fire with primitive (x, y) tuple to avoid object creation.

| Babylon.js API Mapping | |
|:---|:---|
| `CellRamp.Corners` (WVec with Z height) | Vertex Y-axis displacement in `TerrainMeshGenerator` |
| `CellRamp.Polygons` (triangle faces) | `MeshBuilder` index buffer triangulation |
| `MapGrid.TileScale` (1024/1448) | WORLD_SCALE conversion factor to Babylon meters |
| `CellLayer<T>` data array | `Float32Array` / `Uint8Array` TypedArrays for GPU upload |
| `CellLayer.onCellEntryChanged` | Dirty-region tracking for terrain mesh partial updates |

**Acceptance Criteria**:
- All 20 CellRamp shapes generate correct corner WVec values and polygon triangulations for both grid types
- `CellLayerBase.indexOf()` correctly handles rectangular and isometric grids including invalid cell detection
- `CellLayer.set()` fires change event with correct CPos
- Ramps computed once (static initialization) and reused -- not recomputed per cell
- Isometric grid cell indexing matches OpenRA exactly (odd-row offset handling)

**Estimated Effort**: MapGrid.ts: ~400 lines + CellLayerBase.ts: ~180 lines + CellLayer.ts: ~150 lines + ~500 lines test (3-4 dev-days)

---

### 3.2 Phase B: TerrainInfo (Tile & Terrain Types)

**Status**: Pending (0/1)
**Complexity**: Medium
**Blocked by**: Phase A (MapGrid for RampType references), Chapter 3 Phase A (WPos, CPos)
**Blocks**: Phase C (Map.cs -- Map needs TerrainInfo to parse terrain data)

**Description**: `TerrainInfo.cs` contains ALL terrain-related type definitions in one file: `ITerrainInfo` interface, `TerrainTypeInfo` (passability, color), `TerrainTileInfo` (height, ramp type, riser), `TileSet` (template dictionary), and `Riser` (8-direction height discontinuity). `TileSet` is NOT a separate file -- it's a class within TerrainInfo.cs. This file defines the data schema for every cell on the map.

**Key Paradigm Shifts**:
- `TerrainTypeInfo.TargetTypes: BitSet` -> TypeScript `Set<string>` (string-based target type names)
- `Riser` 64-bit packed 8-direction heights -> `Uint8Array(8)` or `number[]` (byte per direction)
- `TileSet.Templates: Dictionary<ushort, TerrainTemplateInfo>` -> `Map<number, TerrainTemplateInfo>`
- `FieldLoader` YAML deserialization -> JSON Schema validation (build-time compiled)

- [ ] **TODO-4.B.1** `src/OpenRA.Game/Map/TerrainInfo.ts` -- Complete terrain type system:
  - `ITerrainInfo` interface:
    - `id: string`, `name: string`
    - `tileSize: Size` (width, height of a single tile in pixels)
    - `terrainTypes: readonly TerrainTypeInfo[]`
    - `getTerrainInfo(tile: TerrainTile): TerrainTileInfo`
    - `tryGetTerrainInfo(tile: TerrainTile): TerrainTileInfo | undefined`
    - `getTerrainIndex(type: string): number` (byte index)
    - `getTerrainIndex(tile: TerrainTile): number`
    - `defaultTerrainTile: TerrainTile`
    - `heightDebugColors: readonly Color[]`, `restrictedPlayerColors: readonly Color[]`
  - `TerrainTypeInfo` class:
    - `type: string` (name: "Clear", "Road", "Water", "Cliff", "Beach", etc.)
    - `targetTypes: Set<string>` (for passability queries)
    - `acceptsSmudgeType: Set<string>` (footprint/decal types)
    - `color: Color` (for minimap / debug rendering)
    - `isWater: boolean` (convenience, derived from targetTypes)
    - `fromJSON(json: unknown): TerrainTypeInfo` factory with validation
  - `TerrainTileInfo` class:
    - `terrainType: number` (byte index into terrainTypes array, default = 255 = unset)
    - `height: number` (byte, 0-255, tile base height)
    - `rampType: number` (byte, index into MapGrid.Ramps, 0 = flat)
    - `minColor: Color`, `maxColor: Color` (debug/preview colors)
    - `riser: Riser` (8-direction height discontinuity info)
    - `fromJSON(json: unknown): TerrainTileInfo` factory
  - `TileSet` class:
    - `name: string` (theater name: "TEMPERAT", "SNOW", "INTERIOR", etc.)
    - `id: string` (unique identifier)
    - `templates: Map<number, TerrainTemplateInfo>` (template ID -> template)
    - `terrainTypes: readonly TerrainTypeInfo[]`
    - `fromJSON(json: unknown, fileSystem: IReadOnlyFileSystem): TileSet` factory
  - `TerrainTemplateInfo` class:
    - `id: number`
    - `images: string[]` (SHP/TEM file references -- resolved by asset system)
    - `sizeX: number`, `sizeY: number` (template dimensions in cells: 1x1, 2x2, etc.)
    - `tiles: TerrainTileInfo[]` (sizeX * sizeY tile definitions for this template)
  - `Riser` class:
    - `rises: Uint8Array` (8 bytes, one per direction: UL, UR, RR, DR, DL, LL, LU, LD)
    - Directions index mapping (`Connection` enum order): 0=UpperLeft, 1=UpperRight, 2=RightRight, 3=DownRight, 4=DownLeft, 5=LeftLeft, 6=LeftUp, 7=LeftDown
    - `getHeight(direction: number): number | undefined` (returns undefined if riser uses default height)
    - `fromString(definition: string): Riser` static parser (handles both long-format "6,6,0,0,0,0,6,6" and short-format "LU=6")
    - Default sentinel value: `0xFF` (matches OpenRA's `Default = 0xFF`)
  - `ITerrainLoader` interface:
    - `parseTerrain(fileSystem: IReadOnlyFileSystem, path: string): ITerrainInfo`
    - Implementation deferred to file system chapter (stub for now)

**Acceptance Criteria**:
- `TerrainTileInfo.fromJSON()` correctly parses all fields from JSON (height, rampType, terrainType)
- `Riser.fromString()` handles both long and short formats with correct direction mapping
- `TileSet.fromJSON()` handles template definitions with 1x1, 2x2, 3x3 template sizes
- `TerrainTypeInfo` target types correctly modeled as `Set<string>`
- All terrain info objects are immutable after construction (`Object.freeze()`)

**Estimated Effort**: ~500 lines implementation + ~400 lines test (2-3 dev-days)

---

### 3.3 Phase C: Map.cs -- Map Core (HIGHEST COMPLEXITY)

**Status**: Pending (0/5)
**Complexity**: **VERY HIGH** (largest single file: 1331 lines C#, 45K bytes)
**Blocked by**: Phases A, B (MapGrid + CellLayer + TerrainInfo)
**Blocks**: Phase F (Pathfinding -- needs Map for cell data), Phase G (TerrainMesh -- needs Map for height/ramp data), World integration (game world needs Map)

**Description**: `Map.cs` is the single most complex file in the map system. It implements `IReadOnlyFileSystem` and `IDisposable`, manages all data layers (Tiles, Resources, Height, Ramp, CustomTerrain), handles `map.bin` binary parsing, coordinates `map.yaml` metadata loading, provides spatial queries (`Contains`, `CenterOfCell`, `CellContaining`), and manages the projection system. The file is ~46KB of C# -- approximately 3-4x larger than any single file migrated in Chapters 2-3.

**Migration Strategy**: Split into 5 files to manage complexity:
1. `Map.ts` -- Core Map class (data layers, spatial queries, lifecycle)
2. `MapBinaryParser.ts` -- Binary `map.bin` format parser (from the `BinaryDataHeader` struct + loading methods)
3. `MapYamlLoader.ts` -- YAML/JSON metadata loading (MiniYAML -> JSON pre-compiled)
4. `ActorReference.ts` -- Map actor reference data
5. `ActorInitializer.ts` -- Actor initialization context for map-placed actors

**Key Paradigm Shifts**:
- `IReadOnlyFileSystem` interface -> `AssetManager` + fetch-based loading (browser has no filesystem)
- `map.bin` binary parsing via `Stream.ReadUInt8/16/32` -> `DataView.getUint8/16/32` (little-endian)
- `Map.Save()` writing to filesystem -> browser download (`Blob` + `URL.createObjectURL`)
- Map loading from `.oramap` ZIP package -> fetch + `fflate` decompression + JSON parsing
- `ProjectedCellLayer` rendering projection -> NOP (Babylon.js frustum culling)
- `CellRamp` geometry per cell -> computed from `RampType` index + `MapGrid.Ramps` lookup at mesh generation time

#### 3.3.1 Map.ts -- Core Map Class

- [ ] **TODO-4.C.1** `src/OpenRA.Game/Map/Map.ts` -- Core `Map` class:
  - Properties:
    - `grid: MapGrid` (grid type and geometry)
    - `size: Size` (map dimensions in cells: width x height)
    - `tiles: CellLayer<TerrainTile>` (tile data layer)
    - `resources: CellLayer<ResourceTile>` (resource type + density per cell)
    - `height: CellLayer<number>` (height data, 0-255 byte per cell)
    - `ramp: CellLayer<number>` (ramp type index per cell, references MapGrid.Ramps)
    - `customTerrain: CellLayer<number>` (custom terrain type overrides)
    - `projectedCells: CPos[]` (ordered array of cells for 2D rendering -- retained for logic, NOP for 3D render)
    - `allCells: CellCoordsRegion` (iterable over all cells, used for effects/radar)
    - `terrainInfo: ITerrainInfo` (reference to loaded terrain type definitions)
    - `playerReferences: Map<string, PlayerReference>` (spawn points and player configs)
    - `actorReferences: ActorReference[]` (pre-placed actors on the map)
    - `title: string`, `author: string`, `description: string` (metadata)
    - `bounds: Rectangle` (axis-aligned world-space bounding box in WPos units)
    - `rules: Map<string, unknown>` (MiniYAML rule overrides -- deferred to mod system)
  - Spatial methods:
    - `containsCell(cell: CPos): boolean` -- Check if CPos is within map logical bounds
    - `containsMPos(mpos: MPos): boolean` -- Check if MPos is valid for data access
    - `centerOfCell(cell: CPos): WPos` -- World position of cell center
      - Rectangular: `new WPos(x * 1024, y * 1024, heightOffset)`
      - Isometric: `new WPos((x + y) * 724, (y - x) * 724, heightOffset)`
      - `heightOffset` = height data * HEIGHT_SCALE + ramp center offset
    - `cellContaining(wpos: WPos): CPos` -- Reverse: world position to cell (uses MPos round-trip)
  - Lifecycle methods:
    - `dispose(): void` -- Clean up CellLayer data, release references
  - Serialization:
    - `toMapYaml(): Record<string, unknown>` -- Export metadata to JSON (replaces MiniYAML serialization)
    - `toMapBin(): ArrayBuffer` -- Export binary tile/resource/height data for download

- [ ] **TODO-4.C.2** `src/OpenRA.Game/Map/MapBinaryParser.ts` -- Binary `map.bin` format parser:
  - `BinaryDataHeader` parser (17-byte header):
    - Format byte (1 or 2) at offset 0
    - Width (Uint16) at offset 1, Height (Uint16) at offset 3
    - For Format 1: TilesOffset=5, HeightsOffset=0 (no heights), ResourcesOffset=3*W*H+5
    - For Format 2: TilesOffset (Uint32 at offset 5), HeightsOffset (Uint32 at offset 9), ResourcesOffset (Uint32 at offset 13)
    - Validation: width/height must match expected map size
  - Tile data parsing:
    - Each cell = 2 bytes (Uint16 LE): tile template ID
    - Parse `TerrainTile` from template ID + terrain info lookup
  - Resource data parsing:
    - Each cell = 2 bytes: byte 0 = resource type (0 = none), byte 1 = resource density (0-255)
    - `ResourceTile { type: number, density: number }`
  - Height data parsing (Format 2 only):
    - Each cell = 1 byte (Uint8): height value 0-255
    - ZSTD compression support: OpenRA v2 format uses ZSTD for height data
    - Decompression via `fzstd` npm package or browser `DecompressionStream`
  - `parseMapBin(buffer: ArrayBuffer, gridType: MapGridType, size: Size, terrainInfo: ITerrainInfo): MapBinaryData`
  - **CRITICAL**: All multi-byte reads are **little-endian** (OpenRA uses .NET `BinaryReader` which is always LE)

- [ ] **TODO-4.C.3** `src/OpenRA.Game/Map/MapYamlLoader.ts` -- JSON metadata loader:
  - `MapMetadata` interface (what was in `map.yaml`):
    - `mapFormat: number` (format version, 11+)
    - `title: string`, `description: string`, `author: string`
    - `tileset: string` (theater name reference)
    - `mapSize: { width: number, height: number }`
    - `bounds: { x: number, y: number, width: number, height: number }`
    - `visibility: string` (Lobby, Shellmap, MissionSelect)
    - `categories: string[]`
    - `players: PlayerReference[]`
    - `actors: ActorReference[]`
    - `rules: Record<string, unknown>`
    - `translations: Record<string, string>`
  - `parseMapYaml(json: unknown): MapMetadata` -- Parse and validate pre-compiled JSON
  - Document the build-time MiniYAML -> JSON pipeline:
    - Source: `mods/<mod>/maps/<mapname>/map.yaml` (MiniYAML format)
    - Build step: Custom Vite plugin or pre-build Node.js script
    - Tool: OpenRA's own `OpenRA.Utility.exe --map-hash` or custom MiniYAML parser
    - Output: `assets/maps/<mapname>/map.json`
    - Runtime: `fetch('assets/maps/<mapname>/map.json')` + `JSON.parse()`

- [ ] **TODO-4.C.4** `src/OpenRA.Game/Map/ActorReference.ts` -- Map-placed actor reference:
  - `ActorReference` class:
    - `type: string` (actor type name, e.g., "E1", "HARV")
    - `location: CPos` (deployment cell)
    - `owner: string` (player internal name)
    - `facing: WAngle` (initial facing direction)
    - `health: number` (override default health, fraction 0-1)
    - `subCell: SubCell` (sub-cell position within cell, 0-5)
    - `init: Record<string, unknown>` (additional initialization properties)
  - `fromJSON(json: unknown): ActorReference` factory

- [ ] **TODO-4.C.5** `src/OpenRA.Game/Map/MapPlayers.ts` -- Player configuration:
  - `MapPlayers` class:
    - `players: Map<string, PlayerReference>`
    - `playablePlayers: PlayerReference[]` (only playable, non-Neutral/Spectator)
  - `PlayerReference` class:
    - `name: string` (internal name, e.g., "Multi0", "Neutral")
    - `faction: string` (faction identifier)
    - `spawn: CPos` (spawn point)
    - `playable: boolean` (can be controlled by a human)
    - `required: boolean` (must be filled for game to start)
    - `owner: string` (bot/human assignment)
    - `colorRamp: Color[]` (player color ramp)
    - `enemies: string[]`, `allies: string[]` (diplomacy config)
  - `fromJSON(json: unknown): MapPlayers` factory

| Babylon.js API Mapping | |
|:---|:---|
| `Map.CenterOfCell(cpos)` → WPos | `CoordinateTransformer.cellToWorld(cpos): Vector3` (existing util) |
| `Map.Height` (0-255 byte) | Multiplied by `HEIGHT_SCALE` to get Y-axis displacement |
| `Map.Ramp` (index) | `MapGrid.Ramps[index]` → `CellRamp.Corners` → vertex Y offsets |
| `Map.Contains(CPos)` | Camera frustum + map bounds check (use existing CoordinateTransformer) |
| `Map.bounds` (Rectangle in WPos) | `BoundingBox` in world-space for camera clamping |
| `ProjectedCells` | **NOP** -- Babylon.js handles visibility via frustum culling natively |

**Acceptance Criteria**:
- `MapBinaryParser` correctly parses both Format 1 and Format 2 `map.bin` files
- Header validation rejects files with incorrect size (with clear error message)
- Binary data correctly populates `CellLayer<TerrainTile>`, `CellLayer<ResourceTile>`, `CellLayer<number>` (height), `CellLayer<number>` (ramp)
- `Map.centerOfCell()` returns correct WPos for both grid types
- `Map.cellContaining()` is the inverse of `centerOfCell()` (round-trip: cellContaining(centerOfCell(c)) == c)
- All public members from OpenRA Map.cs accounted for (implemented, NOTE-documented, or TODO-deferred)
- ZSTD decompression handled gracefully if not available (clear error: "ZSTD-compressed maps require the decompression module")
- `IReadOnlyFileSystem` dependency replaced with `AssetManager` interface
- No per-frame allocation in spatial query methods

**Estimated Effort**: Map.ts: ~800 lines + MapBinaryParser.ts: ~400 lines + MapYamlLoader.ts: ~250 lines + ActorReference.ts: ~120 lines + MapPlayers.ts: ~100 lines + ~1200 lines test (6-8 dev-days)

---

### 3.4 Phase D: CellRegion + ProjectedCellLayer (Spatial Regions)

**Status**: Pending (0/3)
**Complexity**: Medium (1 NOP)
**Blocked by**: Phase A (CellLayer, MapGrid), Phase C (Map)
**Blocks**: Phase F (Pathfinding uses CellRegion for search space)

**Description**: Spatial region and coordinate region abstractions. `CellRegion` provides iterable rectangles of cells for spatial queries and effects. `MapCoordsRegion` and `CellCoordsRegion` adapt between CPos and MPos coordinate spaces for region iteration. `ProjectedCellLayer` and `ProjectedCellRegion` exist for 2D rendering projection -- these are largely NOP in 3D as Babylon.js handles projection natively.

- [ ] **TODO-4.D.1** `src/OpenRA.Game/Map/CellRegion.ts` -- Cell region types:
  - `CellRegion` class:
    - Represents a rectangular region of CPos cells
    - `topLeft: CPos`, `bottomRight: CPos`
    - `contains(cell: CPos): boolean`
    - `iterator(): Generator<CPos>` (yields all CPos in the rectangle)
    - `cellCount: number` (derived: width * height)
    - `width: number`, `height: number`
  - `MapCoordsRegion` class:
    - Same as CellRegion but uses MPos (U/V) for data-layer access
    - `iterator(): Generator<MPos>`
  - `CellCoordsRegion` class:
    - `iterator(): Generator<MPos>` for special cell order (used by `Map.AllCells`)
    - Provides the ordered traversal pattern that matches OpenRA's rendering order

- [ ] **TODO-4.D.2** `src/OpenRA.Game/Map/ProjectedCellLayer.ts` -- **NOP stub**:
  - Contains documentation explaining why projection layers are unnecessary in 3D:
    - OpenRA uses `ProjectedCellLayer` to map 2D isometric cells to screen-space X coordinates for sprite sorting (painter's algorithm)
    - Babylon.js 3D rendering uses Z-buffer depth testing -- no sprite sorting needed
    - Frustum culling replaces projection-based visibility determination
  - Stub with ~30 lines and full `@nop` documentation

- [ ] **TODO-4.D.3** `src/OpenRA.Game/Map/ProjectedCellRegion.ts` -- Reduced implementation or NOP:
  - If retained: simplified region that maps CPos rectangles to array index ranges
  - Primary use case (sprite rendering order) is NOP in 3D
  - May be needed for effects/radar that iterate over screen-space regions
  - Decision: **NOP with documentation** unless Phase C implementation reveals a need

**Acceptance Criteria**:
- `CellRegion.iterator()` yields all CPos in correct order
- `MapCoordsRegion.iterator()` yields all MPos with correct isometric cell skipping
- NOP stubs have complete `@nop` documentation explaining 3D alternatives
- Region contains/intersects checks are O(1)

**Estimated Effort**: CellRegion.ts: ~200 lines + NOP stubs: ~60 lines + ~150 lines test (1-2 dev-days)

---

### 3.5 Phase E: MapCache & MapPreview (Map Metadata)

**Status**: Pending (0/4) -- **DEFERRABLE**
**Complexity**: Medium-HIGH
**Blocked by**: Phase C (Map.cs for map loading)
**Blocks**: Nothing critical (UI/launcher feature, not game engine)

**Description**: Map metadata management system. `MapCache` maintains a catalog of available maps with lazy loading. `MapPreview` generates minimap previews from map data (reads `map.bin` to produce a small colored image). `MapDirectoryTracker` watches for filesystem changes (NOP in browser). `MapGenerationArgs` holds map generator parameters. These are primarily UI/launcher features and can be deferred until the map launcher UI is built.

- [ ] **TODO-4.E.1** `src/OpenRA.Game/Map/MapCache.ts` -- Map catalog (DEFERRABLE):
  - `MapCache` class:
    - `maps: Map<string, MapPreview>` (map UID -> preview)
    - `loadMaps(): Promise<void>` (fetch map JSON index from assets)
    - `getMap(uid: string): MapPreview | undefined`
    - `findMaps(query: string): MapPreview[]` (search by title/category)
  - Deferred to UI/launcher chapter

- [ ] **TODO-4.E.2** `src/OpenRA.Game/Map/MapPreview.ts` -- Minimap generation (DEFERRABLE):
  - Reads map tiles + height data and generates a small colored preview image
  - In 3D: render terrain to offscreen `RenderTargetTexture` at low resolution OR use CPU color-map from `TerrainTypeInfo.Color`
  - Deferred to UI/launcher chapter

- [ ] **TODO-4.E.3** `src/OpenRA.Game/Map/MapDirectoryTracker.ts` -- **NOP stub**:
  - Filesystem watching is not available in browsers
  - Replaced by server-side map list API
  - Full `@nop` documentation

- [ ] **TODO-4.E.4** `src/OpenRA.Game/Map/MapGenerationArgs.ts` -- Map generator parameters:
  - Simple data class: `width`, `height`, `seed`, `terrainType`
  - Can be implemented as a quick data interface (Low complexity, but low priority)

**Acceptance Criteria**:
- MapCache loading succeeds with mock JSON map index
- MapPreview generates correct-sized colored preview from terrain type colors
- NOP stubs have complete documentation

**Estimated Effort**: MapCache.ts: ~200 lines + MapPreview.ts: ~300 lines + stubs: ~60 lines + ~200 lines test (deferred, 2-3 dev-days when unblocked)

---

### 3.6 Phase F: HierarchicalPathFinder -- Pathfinding (HIGH)

**Status**: Pending (0/5)
**Complexity**: **VERY HIGH** (1743 lines C#, 55K bytes)
**Blocked by**: Phase A (CellLayer, MapGrid), Phase C (Map), Chapter 3 Phases C-D (World, Actor)
**Blocks**: Unit movement, AI, attack-move, patrol

**Description**: HPA* (Hierarchical Pathfinding A*) algorithm implementation. The most algorithmically complex component in the map system. Divides the map into 10x10 cell clusters, builds abstract graphs within each cluster, connects clusters via portal edges, performs two-level search (abstract graph + fine-grained A*). Supports dynamic obstacle updates for building placement/destruction. Depends on `PathSearch` for the core A* implementation and multiple `IPathGraph` implementations for different movement models.

**Key Architecture Decision -- HPA* vs RecastNavigation** (see ADR-4.2):
- **Decision**: Implement core HPA* in TypeScript, provide RecastNavigation as optional 3D integration layer
- **Rationale**: HPA* ensures deterministic pathfinding (critical for lockstep networking); RecastNavigation offers realistic 3D obstacle avoidance. The two can coexist: HPA* for game-logic pathfinding, Recast for visual agent steering.
- **Implementation order**: Port HPA* fully first; Recast integration is a post-Chapter 4 enhancement.

- [ ] **TODO-4.F.1** `src/OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.ts` -- HPA* core:
  - Properties:
    - `world: GameWorldManager` (reference for actor queries)
    - `locomotor: Locomotor` (movement rules and capabilities)
    - `grid: Grid` (abstract grid size, default 10x10 cells per cluster)
    - `abstractGraph: Map<number, AbstractNode[]>` (cluster ID -> nodes within cluster)
    - `abstractEdges: Map<number, AbstractEdge[]>` (cluster ID -> edges between clusters)
    - `dirtyClusters: Set<number>` (clusters needing rebuild due to obstacle changes)
  - `findPath(source: CPos, target: CPos): CPos[]` -- Main public API:
    - If source and target are in same cluster, use fine-grained A* directly
    - Otherwise: find abstract path through clusters -> refine to cell path via `PathSearch`
    - Return ordered array of CPos waypoints
  - `addObstacle(region: CellRegion): void` -- Mark clusters containing obstacle as dirty
  - `removeObstacle(region: CellRegion): void` -- Mark clusters as dirty for rebuild
  - `rebuildDirtyClusters(): void` -- Rebuild abstract graph for all dirty clusters
  - `rebuildAbstractGraph(clusterId: number): void`:
    - Within the cluster's 10x10 cells, find connected regions of passable cells
    - Each connected region = one `AbstractNode`
    - For each node, identify portal cells (cells on cluster boundary connected to adjacent cluster)
    - Create `AbstractEdge` between portals in different clusters
  - `heuristic(from: CPos, to: CPos): number` -- Improved heuristic using abstract graph distance:
    - If in same cluster: Euclidean/Chebyshev distance
    - If different clusters: abstract graph shortest-path distance + intra-cluster distance
  - **CRITICAL**: Maintain `PathSearch` instance pool to avoid per-query allocation
  - **CRITICAL**: `CellInfoLayerPool` for reusing cell state arrays between searches (avoid GC)

- [ ] **TODO-4.F.2** `src/OpenRA.Mods.Common/Pathfinder/PathSearch.ts` -- Core A* search:
  - `PathSearch` class (implements A*):
    - `openQueue: PriorityQueue<CPos>` (min-heap keyed by f = g + h)
    - `costSoFar: Map<string, number>` (g-values keyed by CPos serialization)
    - `cameFrom: Map<string, CPos>` (parent pointers for path reconstruction)
    - `heuristic: (from: CPos, to: CPos) => number` (injected, default or HPA* heuristic)
    - `expand(cpos: CPos): void` -- Expand one node (examine neighbors, update g/f values)
    - `search(source: CPos, target: CPos, maxNodes?: number): CPos[]`:
      - Standard A* loop with max-nodes safety limit
      - Returns empty array if no path found or max nodes exceeded
      - Returns reversed path from source to target
    - `costEstimator(source: CPos, target: CPos): number` -- Default cost (straight-line WDist)
    - `cellCost(cell: CPos): number` -- Terrain movement cost (from locomotor / terrain type)
    - `canEnter(cell: CPos): boolean` -- Passability check (terrain + blocking actors)
  - **Performance**: No allocation in hot loop -- reuse temporary CPos objects, use number-indexed maps where possible

- [ ] **TODO-4.F.3** `src/OpenRA.Mods.Common/Pathfinder/PathGraphs.ts` -- Path graph implementations:
  - `IPathGraph` interface:
    - `neighbors(cell: CPos): CPos[]` -- Get passable neighbor cells
    - `cost(from: CPos, to: CPos): number` -- Movement cost between adjacent cells
    - `isPassable(cell: CPos): boolean` -- Check if cell is enterable
  - `DensePathGraph` -- Ignores terrain height, 8-directional grid movement. Simplest.
  - `GridPathGraph` -- 8-directional grid with terrain height consideration.
  - `MapPathGraph` -- Uses `Locomotor` for movement rules (flying units, amphibious, etc.). Most complex.
  - `SparsePathGraph` -- Only considers cells with specific properties (for resource collection, etc.).

- [ ] **TODO-4.F.4** `src/OpenRA.Mods.Common/Pathfinder/CellInfo.ts` -- Cell state for pathfinding:
  - `CellInfo` enum/const: `Unvisited`, `Open`, `Closed`
  - `CellInfoLayerPool` class:
    - Pool of `CellInfo[][]` arrays for reuse across pathfinding queries
    - `acquire(map: Map): CellInfo[][]` -- Get a layer from pool or create new
    - `release(layer: CellInfo[][]): void` -- Return layer to pool
    - Pool size limit to prevent memory leaks

- [ ] **TODO-4.F.5** `src/OpenRA.Mods.Common/Pathfinder/Grid.ts` -- Abstract grid utility:
  - `Grid` class:
    - `cellSize: number` (default 10 -- cells per cluster side)
    - `clusterId(cell: CPos): number` -- Map cell to cluster ID
    - `clusterBounds(clusterId: number): CellRegion` -- Get cell region for a cluster
    - `clustersInRegion(region: CellRegion): number[]` -- All cluster IDs overlapping a region
    - `clusterCountX: number`, `clusterCountY: number` -- Grid dimensions in clusters

**Acceptance Criteria**:
- HPA* finds a valid path from source to target on a flat map with no obstacles
- HPA* correctly routes around impassable terrain (water, cliffs)
- Path quality: path length is within 5% of optimal (A* without hierarchy) for test maps
- Performance: long-distance path (across 128x128 map) found in under 10ms
- Dynamic obstacle: after `addObstacle()`, path reroutes around the obstacle
- Abstract graph rebuild for a single 10x10 cluster completes in under 1ms
- 1000 concurrent pathfinding queries: lowest-priority queries capped at `maxNodes` limit
- `CellInfoLayerPool` correctly reuses arrays without leaking memory

**Estimated Effort**: HierarchicalPathFinder.ts: ~1000 lines + PathSearch.ts: ~400 lines + PathGraphs.ts: ~350 lines + CellInfo.ts: ~80 lines + Grid.ts: ~60 lines + ~1500 lines test (8-12 dev-days)

---

### 3.7 Phase G: Terrain 3D Mesh Generation (NEW)

**Status**: Pending (0/1)
**Complexity**: **HIGH**
**Blocked by**: Phases A, B, C (MapGrid + TerrainInfo + Map -- needs full map data)
**Blocks**: Visual rendering of terrain in 3D scene

**Description**: This file has NO OpenRA counterpart. OpenRA renders terrain by drawing 2D tile sprites sorted by projection order. In 3D, terrain becomes an actual mesh with height displacement. This phase generates the 3D terrain geometry from the Map data: one large mesh (or chunked meshes for large maps) with vertex heights from `Height` byte data and corner shaping from `CellRamp` definitions.

**Key Paradigm Shifts**:
- 2D tile sprite rendering -> 3D terrain mesh with height displacement
- Per-tile sprite UV coordinates -> Texture splatting via custom ShaderMaterial
- Projection-based sprite sorting -> Z-buffer depth testing
- Tile-based terrain blending -> GPU texture splatting (4+ terrain textures blended per-pixel)

- [ ] **TODO-4.G.1** `src/OpenRA.Game/Map/TerrainMeshGenerator.ts` -- 3D terrain mesh from Map data:
  - `TerrainMeshGenerator` class:
    - `generate(map: Map, scene: Scene): Mesh` -- Main entry point:
      - For each cell (i, j) in map:
        - Compute cell center world position via `map.centerOfCell(CPos(i, j))`
        - Look up `CellRamp` from `MapGrid.Ramps[map.ramp.get(MPos(i, j))]`
        - Apply corner offsets from `CellRamp.Corners` to get 4 vertex positions
        - Calculate vertex normals for the cell (shared normals for smooth shading)
      - Create `VertexData` with positions, normals, UVs
      - If CellRamp has diagonal split (X or Y), generate 2 triangles with split at diagonal
      - If no split, generate 2 triangles: (TL, TR, BR) and (TL, BR, BL)
      - Apply to `MeshBuilder` or create `Mesh` with custom geometry
    - `generateChunked(map: Map, scene: Scene, chunkSize: number): Mesh[]`:
      - For large maps (256x256+), split into chunks (e.g., 32x32 cells per chunk)
      - Each chunk is a separate `Mesh` for frustum culling granularity
    - `updateChunk(map: Map, chunk: Mesh, dirtyRegion: CellRegion): void`:
      - Partial update when terrain changes (building placed, terrain modified)
      - Only update vertices in the dirty region
      - Update corresponding GPU buffer via `mesh.updateVerticesData()`
    - `createTerrainMaterial(map: Map, tileSet: TileSet, scene: Scene): ShaderMaterial`:
      - Custom `ShaderMaterial` with texture splatting
      - Uniforms: `splatMap: RawTexture` (per-cell terrain type -> RGBA channel), `texture0-3: Texture` (terrain textures)
      - Vertex shader: pass through positions + generate world-space UV
      - Fragment shader: sample splatMap, blend 4 textures by RGBA weights
      - Support for cliff/ramp edge texturing (special texture for steep slopes)
    - **Performance targets**:
      - 128x128 map: mesh generation in under 500ms (one-time cost)
      - 256x256 map: chunked generation in under 2s (one-time cost)
      - Dirty region update (10x10 cells): under 16ms (single frame)
  - Constants:
    - `HEIGHT_SCALE: number` -- Maps 0-255 height to world Y displacement
    - `CELL_WORLD_SIZE: number` -- Cell width in world units (1024 internal units / WORLD_SCALE)
    - `ISO_SCALE_X: number`, `ISO_SCALE_Z: number` -- Isometric cell dimensions in world units
  - **CRITICAL**: Vertex weld adjacent cell corners to avoid gaps/seams
  - **CRITICAL**: Calculate smooth normals by averaging face normals at shared vertices

| OpenRA 2D Pattern | Babylon.js 3D Replacement | Notes |
|:---|:---|:---|
| Tile sprite at (px, py) sorted by Y | Mesh vertex at (wx, wy, wz) with Z-buffer | Depth testing replaces sorting |
| Tile UV in 2D sprite sheet | World-space UV for texture splatting | Avoids stretching on slopes |
| Palette-based terrain coloring | PBR material with splatMap | Terrain type -> texture channel |
| Ramp Z-offset in 2D projection | Actual Y-axis vertex displacement | Height becomes geometry |
| Riser 8-direction edge heights | Vertical cliff face geometry | Generated from Riser height diffs |

**Acceptance Criteria**:
- Flat terrain mesh generated with correct cell count and spacing
- Height data produces correct Y-axis displacement on vertices
- CellRamp corner offsets produce correct 3D terrain shapes (verify visually)
- 20 ramp types all render correctly (flat, half-corners, diagonal splits, full ramp)
- No visible gaps between adjacent cells (vertex welding works)
- Normals produce smooth lighting across cell boundaries
- Chunked terrain for 256x256 map with frustum culling on individual chunks
- TerrainMaterial blends textures correctly at terrain type boundaries
- Dirty region partial update completes in one frame

**Estimated Effort**: ~600 lines implementation + ~400 lines test (4-6 dev-days, plus visual iteration)

---

## 4. Dependency Graph

```
Phase A (3 files: MapGrid + CellLayer) <-- FOUNDATION, depends only on Ch3 Phase A ✓
  |
  +--> Phase B (1 file: TerrainInfo)
  |     |
  |     +--> Phase C (5 files: Map core)
  |           |
  |           +--> Phase D (3 files: CellRegion)
  |           |
  |           +--> Phase E (4 files: MapCache/Preview) [DEFERRABLE]
  |           |
  |           +--> Phase F (5 files: Pathfinding)
  |           |     |
  |           |     +--> Depends on: World, Actor (Ch3 Phase C-D) ✓
  |           |     +--> Depends on: Locomotor trait (NOT YET MIGRATED -- stub interface)
  |           |
  |           +--> Phase G (1 file: TerrainMesh)
  |                 |
  |                 +--> Depends on: Scene, Mesh, ShaderMaterial (Ch2) ✓
  |                 +--> Depends on: TerrainSpriteLayer (Ch2) ✓
  +----------------------------------------------------------+
```

### External Dependencies (Chapters 2-3)

| Dependency | Required By | Status |
|:---|:---|:---|
| `WPos`, `WVec`, `CPos`, `MPos`, `CVec` | Phases A, B, C, D, F, G | COMPLETE (Chapter 3 Phase A) |
| `WAngle`, `WDist`, `WRot` | Phase A (CellRamp orientation) | COMPLETE (Chapter 3 Phase A) |
| `MapGridType` enum | Phase A | COMPLETE (`src/OpenRA.Game/Map/MapGridType.ts`) |
| `PriorityQueue<T>` | Phase F (PathSearch A*) | COMPLETE (Chapter 3 Phase A) |
| `SpatiallyPartitioned<T>` | Phase F (actor spatial queries) | COMPLETE (Chapter 3 Phase A) |
| `Cache<K, V>` | Phase C (cached computations) | COMPLETE (Chapter 3 Phase A) |
| `ActionQueue` | Phase C (deferred map operations) | COMPLETE (Chapter 3 Phase A) |
| `Color` | Phase B (terrain colors) | COMPLETE (Chapter 2 extra) |
| `BABYLON.Scene`, `Mesh`, `ShaderMaterial` | Phase G (terrain mesh) | COMPLETE (Chapter 2) |
| `GameWorldManager` (World) | Phase F (pathfinding needs actor positions) | COMPLETE (Chapter 3 Phase C) |
| `GameActor extends TransformNode` | Phase F (mobile actor pathfinding queries) | COMPLETE (Chapter 3 Phase D) |
| `ITick`, `INotifyCreated` (Traits) | Phase F (pathfinder trait integration) | COMPLETE (Chapter 3 Phase B) |
| `CoordinateTransformer` (WPos → Vector3) | Phase G (mesh vertex positions) | COMPLETE (Chapter 3) |
| `TerrainSpriteLayer` (dirty row tracking) | Phase G (dirty region mesh updates) | COMPLETE (Chapter 2) |

### Unresolved Dependencies (Need Stub Interfaces)

| Dependency | Required By | Action |
|:---|:---|:---|
| `Locomotor` trait (movement rules) | Phase F (MapPathGraph) | Define `ILocomotor` interface stub in Chapter 4; full implementation in Mod System chapter |
| `IReadOnlyFileSystem` | Phase C (Map loading) | Define `IAssetManager` interface; implement with fetch-based loader |
| `ModData` | Phase C (mod context for map loading) | Stub interface; full implementation in Mod System chapter |
| `Session.Client` | Phase C (player slot mapping) | Stub interface; full implementation in Networking chapter |

### Parallelization Strategy

- **Phase A** (3 files): All 3 are tightly coupled. One developer.
- **Phase B** (1 file): Can start once Phase A is 80% done (needs CellRamp type). One developer.
- **Phases C + D** (8 files): Phase C is the blocker. C.1 (Map.ts) must be done first; C.2-C.5 and D.1-D.3 can follow. 1-2 developers.
- **Phase E** (4 files): Deferrable. Can be done independently when needed.
- **Phase F** (5 files): Can start AFTER Phase C Map.ts is stable. Algorithmically complex -- best for one experienced developer. Can proceed in parallel with Phase D and Phase G.
- **Phase G** (1 file): Can start once Phases A+B+C are done. Babylon.js-heavy -- best for developer with 3D graphics experience. Can proceed in parallel with Phase F.

---

## 5. Verification and Test Strategy

### 5.1 Unit Tests

- [ ] **TEST-4.1** MapGrid and CellRamp tests:
  - All 20 ramp shapes generate correct corner WVec values for both grid types
  - `RampCornerHeight` and `RampSplit` enums map correctly
  - `subCellOffsets` has correct 6 values per grid type
  - Ramps are immutable (cannot modify after construction)

- [ ] **TEST-4.2** CellLayer tests:
  - Rectangular grid: indexOf(mpos) = y * width + x
  - Isometric grid: index formula with correct odd-row handling
  - `get/set` round-trip: set value, get returns same value
  - `onCellEntryChanged` fires with correct CPos on set
  - `copyValuesFrom` throws when listeners attached (matching OpenRA invariant)
  - `clear` throws when listeners attached
  - Invalid MPos for isometric grid (x < y) returns undefined / error

- [ ] **TEST-4.3** TerrainInfo tests:
  - `TerrainTypeInfo.fromJSON()` validates required fields
  - `TileSet.fromJSON()` handles 1x1, 2x2, 3x3 template sizes
  - `Riser.fromString()` handles long format: "6,6,0,0,0,0,6,6"
  - `Riser.fromString()` handles short format: "LU=6", "LU=6,RU=3"
  - `Riser.getHeight(direction)` returns correct values (default = undefined)
  - `ITerrainInfo.getTerrainIndex()` returns correct byte indices

- [ ] **TEST-4.4** Map binary parser tests:
  - Parse Format 1 header (5-byte header)
  - Parse Format 2 header (17-byte header)
  - Reject incorrect size (header width/height mismatch)
  - Parse tile data correctly (2 bytes per cell)
  - Parse resource data correctly (2 bytes per cell: type + density)
  - Parse height data correctly (1 byte per cell)
  - Verify tile data round-trip: parse → serialize → parse yields same data
  - Test with real OpenRA map.bin files (if available in test fixtures)

- [ ] **TEST-4.5** Map core tests:
  - `containsCell(cpos)` boundary checks (in-bounds, out-of-bounds, edge)
  - `containsMPos(mpos)` with isometric invalid cell detection
  - `centerOfCell(cpos)` returns correct WPos for both grid types
  - `cellContaining(wpos)` is inverse of `centerOfCell()`
  - Map construction from binary data + JSON metadata yields correct state
  - `dispose()` cleans up all CellLayers

- [ ] **TEST-4.6** Pathfinding tests:
  - Straight line path on empty flat map (8-directional)
  - Path around rectangular obstacle (ensures correct detour)
  - Path through maze-like terrain
  - Path across cluster boundaries (verifies abstract graph)
  - Dynamic obstacle: add obstacle -> path reroutes -> remove obstacle -> path returns
  - No path exists: returns empty array (no crash)
  - Source == target: returns trivial single-point path
  - Path length verification: actual cost matches expected movement cost
  - Performance: long path on 128x128 map in under 10ms
  - `CellInfoLayerPool` acquires and releases without leak

- [ ] **TEST-4.7** Terrain mesh generation tests:
  - Flat terrain: all vertices at correct XZ positions, Y = 0
  - Height terrain: vertices displaced by correct Y values
  - Ramp terrain: corner vertices at correct heights per CellRamp definition
  - Vertex count: (width+1) * (height+1) vertices for flat mesh
  - Triangle count: 2 * width * height triangles
  - Chunked mesh: correct chunk boundaries, no gaps between chunks
  - Normals: all point upward for flat terrain

### 5.2 Integration Tests

- [ ] **TEST-4.8** Full map loading pipeline integration:
  - Load JSON metadata → load map.bin binary → construct Map → verify all layers
  - Map spatial queries work on loaded map
  - CellLayer data accessible via both CPos and MPos

- [ ] **TEST-4.9** Pathfinding + Map integration:
  - Create Map with obstacle layout → run HPA* → verify path avoids obstacles
  - Verify path waypoints are valid CPos on the map

- [ ] **TEST-4.10** Terrain mesh + Map integration:
  - Load map → generate terrain mesh → verify mesh matches map dimensions
  - Verify mesh heights match Map.Height data

### 5.3 E2E Tests (Playwright, deferred to post-Chapter 4)

- [ ] **TEST-4.11** Terrain renders correctly in browser:
  - Load a small test map
  - Verify terrain mesh appears in scene
  - Verify terrain textures are applied
  - Camera can orbit around terrain

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **MiniYAML parsing complexity** | **CRITICAL** | Cannot load maps without YAML parsing | Mandatory build-time pre-compilation to JSON using custom Vite plugin; validate with real OpenRA mod maps |
| **map.bin format variants** | HIGH | Binary parsing may fail on edge-case maps | Support both Format 1 (legacy, 5-byte header) and Format 2 (current, 17-byte header); test with all official OpenRA maps |
| **ZSTD decompression** | MEDIUM | Some v2 maps use ZSTD for height data | Evaluate `fzstd` npm package (~8KB WASM) or browser `DecompressionStream`; fallback error for unsupported maps |
| **CellRamp → 3D geometry gaps** | HIGH | Visible seams between adjacent cells with different ramps | Vertex welding: adjacent cell corners share exact same vertex; smooth normals across cell boundaries |
| **Terrain mesh memory for large maps** | MEDIUM | 256x256 map = 66K cells = 264K triangles; ~8MB GPU memory | Chunked generation (32x32 chunks); VRAM budget within modern browser limits |
| **HPA* path quality** | MEDIUM | Abstract graph may produce suboptimal paths in complex terrain | Hierarchical paths are post-smoothed; max 5% length increase vs optimal is acceptable |
| **Locomotor trait dependency** | MEDIUM | Pathfinding needs movement rules; Locomotor in Mod System chapter | Define `ILocomotor` stub interface; pathfinding tested with simple movement models first |
| **Isometric grid cell indexing** | HIGH | Odd-row offset in isometric grid is easy to get wrong | Port exact C# logic; comprehensive test matrix for both grid types at all boundary conditions |
| **IReadOnlyFileSystem replacement** | MEDIUM | Map loading assumes filesystem access; browser uses fetch | Define `IAssetManager` interface; implement `FetchAssetManager` for HTTP loading |
| **Per-frame allocation in spatial queries** | LOW | `Contains()`, `CenterOfCell()` called frequently | Return cached/frozen CPos/MPos values; use number-indexed flat maps where possible |
| **TileSet terrain textures not yet available** | LOW | Texture splatting needs source textures | Use procedural/gradient textures for initial testing; real textures loaded from asset pipeline |
| **Map.Save() serialization** | LOW | Browser cannot write to filesystem; save = download | Implement `Map.toMapBin()` returning `ArrayBuffer` → `Blob` → `URL.createObjectURL` download |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-4.1: MiniYAML Build-Time Compilation

- **Context**: OpenRA uses MiniYAML, a custom YAML dialect with `@` named nodes, conditional fields, and special indentation rules. Standard YAML parsers (js-yaml, yaml) cannot parse it. Browser-side parsing would be slow and complex.
- **Decision**: Mandatory build-time pre-compilation of all MiniYAML files to JSON. Runtime only loads JSON via `fetch()` + `JSON.parse()`.
- **Alternatives considered**:
  - Custom MiniYAML parser in TypeScript (high maintenance burden, ~2000 lines, handles rare edge cases poorly)
  - Use OpenRA's `OpenRA.Utility.exe --map-hash` to pre-process maps during build (requires .NET runtime in CI pipeline)
  - Server-side conversion API (adds network dependency, slower load times)
- **Consequences**:
  - Pro: Fast load times (native JSON.parse), no runtime YAML library, simple TypeScript code
  - Con: Build step required; MiniYAML errors surfaced at build time, not runtime
  - Mitigation: Clear error messages in build step; validate JSON schema during compilation; include sample pre-compiled maps in test fixtures

### ADR-4.2: HPA* Port vs RecastNavigation

- **Context**: OpenRA's pathfinding uses HPA* (Hierarchical A*) with 10x10 clusters, abstract graphs, and dynamic obstacle updates. RecastNavigation provides 3D navigation mesh baking and crowd simulation.
- **Decision**: Implement core HPA* in TypeScript as the primary pathfinding engine. Provide RecastNavigation as an optional 3D integration layer for visual agent steering.
- **Alternatives considered**:
  - RecastNavigation only: Simpler implementation, but loses determinism (Recast navmesh baking is non-deterministic across browsers), and dynamic obstacle updates require full navmesh rebake (expensive)
  - HPA* only: Preserves determinism, but no 3D obstacle avoidance or crowd simulation
- **Consequences**:
  - Pro: Deterministic pathfinding for network sync; incremental abstract graph updates for dynamic obstacles; familiar behavior for OpenRA players
  - Con: More code to maintain (~2000 lines); Recast integration is additional work
  - Implementation order: Port HPA* first (critical path); RecastNav integration is a post-Chapter 4 enhancement

### ADR-4.3: Terrain Mesh Chunking Strategy

- **Context**: Large maps (256x256 cells = 65,536 cells) generate significant mesh data. A single mesh with ~264K triangles is acceptable for modern GPUs but limits frustum culling granularity.
- **Decision**: Generate terrain as 32x32 cell chunks (1024 cells per chunk). For a 256x256 map: 64 chunks of ~4K triangles each. For maps smaller than 64x64: single mesh (no chunking overhead).
- **Alternatives considered**:
  - Single mesh for all map sizes (simpler code, but no frustum culling granularity)
  - Per-cell mesh (excessive draw calls -- 65K+ meshes kills performance)
  - Dynamic LOD with `GeometryBufferRenderer` (Babylon.js experimental, adds complexity)
- **Consequences**:
  - Pro: Good frustum culling granularity; dirty region updates affect single chunk; reasonable draw call count (64 for 256x256 map)
  - Con: Chunk boundary vertex duplication (acceptable -- 32 extra vertices per boundary edge); chunk management code overhead
  - Chunk size configurable via `TerrainMeshGenerator` constructor

### ADR-4.4: Height Data Representation

- **Context**: OpenRA stores height as 0-255 byte values. 3D rendering requires floating-point world-unit heights.
- **Decision**: Keep height as `Uint8Array` (0-255) in `CellLayer<number>`. Convert to world Y coordinates at mesh generation time using `HEIGHT_SCALE` constant.
- **Alternatives considered**:
  - Convert to float at load time (loses data precision for network sync; doubles memory usage)
  - Use WPos Z component directly (mixes concerns: height is terrain data, not world position)
- **Consequences**:
  - Pro: Preserves exact byte values for network determinism; compact memory (1 byte/cell); conversion deferred to render boundary
  - Con: Extra multiplication at mesh generation time (one-time cost)
  - `HEIGHT_SCALE = 1 / 1024` as starting value (one internal unit = 1 Babylon meter)

### ADR-4.5: IReadOnlyFileSystem Replacement with AssetManager

- **Context**: Map loading in OpenRA assumes `IReadOnlyFileSystem` (virtual filesystem abstraction). Browser has no filesystem.
- **Decision**: Define `IAssetManager` interface with `fetch(path: string): Promise<ArrayBuffer>` and `exists(path: string): Promise<boolean>`. Implement `FetchAssetManager` that loads from HTTP/HTTPS. Map constructor takes `IAssetManager` instead of `IReadOnlyFileSystem`.
- **Alternatives considered**:
  - Bundle all map data at build time (impractical -- maps are large and user-generated)
  - Use IndexedDB for local map cache (adds complexity without benefit until offline support is needed)
- **Consequences**:
  - Pro: Clean separation of loading from map logic; testable (mock AssetManager returns ArrayBuffers); future-proof (IndexedDB, Service Worker cache can implement same interface)
  - Con: All file operations become async; Map construction is async
  - Mitigation: `Map.load(assetManager, mapPath): Promise<Map>` static factory method

---

## Migration Order and Phasing Strategy

**Recommended execution sequence** (optimized for dependency resolution and parallel development):

| Week | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase A | 3 | MapGrid + CellLayer + CellLayerBase. Grid geometry foundation. | Single dev (tightly coupled) |
| 1-2 | Phase B | 1 | TerrainInfo. Can start once CellRamp is defined. | Same dev (needs Phase A) |
| 2-4 | Phase C | 5 | Map.cs (split into Map, BinaryParser, YamlLoader, ActorReference, MapPlayers). Highest complexity. | 1-2 devs (Map.ts must be first) |
| 4-5 | Phase D | 3 | CellRegion + 2 ProjectedCell NOP stubs. Low complexity. | Can run parallel with Phase C late stage |
| — | Phase E | 4 | MapCache, MapPreview, etc. DEFERRED. | — |
| 5-8 | Phase F | 5 | HierarchicalPathFinder + PathSearch + PathGraphs + CellInfo + Grid. Algorithmically complex. | 1 dev (experienced), parallel with Phase G |
| 5-7 | Phase G | 1 | TerrainMeshGenerator. Babylon.js-heavy 3D mesh generation. | 1 dev (3D graphics), parallel with Phase F |
| 8-9 | Integration | — | Map loading pipeline, terrain rendering, pathfinding end-to-end. | All devs |

**Total estimate**: 8-9 weeks with 2 developers; 5-6 weeks with 3 developers.

**Critical Path**: Phase A → Phase B → Phase C (Map.ts core) → Phase F (pathfinding) AND Phase G (terrain mesh) in parallel.

### Post-Chapter 4 Deferred Items

| Priority | Item | Reason |
|:--------:|------|--------|
| MEDIUM | Phase E (MapCache/MapPreview) | UI/launcher feature; not needed for game engine |
| LOW | RecastNavigation 3D integration | Post-HPA* enhancement; visual steering only |
| LOW | Map editor (blank map creation) | Separate subsystem; depends on UI chapter |
| LOW | ZSTD decompression for legacy maps | Most maps use Format 2 without ZSTD |
| LOW | Map.Save() download feature | Map editor feature |

---

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 5 (lines 627-850) -- Full architecture analysis of Map System
> - `docs/actor_system_migration_plan.md` -- Chapter 3 migration plan (format reference, coordinate system details)
> - `docs/rendering_migration_plan.md` -- Chapter 2 migration plan (format reference, shader/texture system)
> - `docs/migration_progress.md` -- Current project progress tracking
> - `CLAUDE.md` -- Project overview and conventions