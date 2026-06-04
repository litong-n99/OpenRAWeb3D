# OpenRA to Babylon.js Migration Plan: Chapter 4 -- Map and Terrain System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 5 (lines 627-849)
> **Chapter Status**: Chapter 4 -- Implementation Phase (12/34 migrated, 35%)
> **Updated**: 2026-06-04 (Phase B COMPLETE: CellRamp + MapGrid, 138 tests, review approved; 12/34, 35%)
> **Prerequisite**: Chapter 3 (Actor System) -- COMPLETE (36/36, 1035%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: CellLayer Infrastructure](#31-phase-a-celllayer-infrastructure)
   - 3.2 [Phase B: MapGrid -- Grid Geometry](#32-phase-b-mapgrid----grid-geometry)
   - 3.3 [Phase C: TerrainInfo / TileSet](#33-phase-c-terraininfo--tileset----terrain-type-system)
   - 3.4 [Phase D: Map.cs -- Core Map Container](#34-phase-d-mapcs----core-map-container)
   - 3.5 [Phase E: Map Support Files](#35-phase-e-map-support-files)
   - 3.6 [Phase F: 3D Terrain Mesh Generation](#36-phase-f-3d-terrain-mesh-generation)
   - 3.7 [Phase G: Pathfinding System](#37-phase-g-pathfinding-system)
   - 3.8 [Phase H: MiniYAML Preprocessing Pipeline](#38-phase-h-miniyaml-preprocessing-pipeline)
   - 3.9 [Phase I: CoordinateTransformer Utility](#39-phase-i-coordinatetransformer-utility)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Map and Terrain system is the **most geometrically complex** phase of the project. The core paradigm shift: **from 2D tile-based terrain with discrete CellRamp shapes to a continuous 3D terrain mesh with texture splatting and height-based geometry**.

OpenRA's map system is the data foundation of the entire engine. It stores terrain grids, tile definitions, height data, and ramp geometry. The map is loaded from `.oramap` packages containing MiniYAML metadata and `map.bin` binary data. In the 3D Babylon.js environment, this transforms into:

- **Data layer**: Map loading from preprocessed JSON + ArrayBuffer (replacing runtime MiniYAML + map.bin parsing)
- **Geometry layer**: Custom 3D terrain mesh generated from CellRamp height data and corner offsets
- **Texture layer**: PBRCustomMaterial with texture splatting from TerrainType classification
- **Pathfinding layer**: HPA* port or RecastNavigation NavMesh from generated terrain geometry

### 1.2 Four Core Architectural Principles

1. **Build-time preprocessing over runtime parsing**: MiniYAML is compiled to JSON at build time; map.bin is converted to ArrayBuffer. The browser never sees MiniYAML.
2. **CellRamp as geometry source of truth**: The 21 CellRamp shapes directly drive 3D vertex generation, producing continuous terrain surfaces with correct slope geometry.
3. **TypedArray storage over .NET generics**: CellLayer<T> maps to TypedArrays (Float32Array, Uint8Array) for efficient GPU upload and minimal GC pressure.
4. **Dual pathfinding strategy**: HPA* abstract graph for game logic determinism; RecastNavigation NavMesh for 3D crowd movement and visual path smoothing.

### 1.3 Coordinate System Summary (Already Migrated)

The coordinate system foundation is already complete from Chapter 3 Phase A:

| Coordinate Type | Status | Source File | Target File |
|:---|:---:|:---|:---|
| `CPos` (Cell position, X/Y/Layer) | Done | `OpenRA.Game/CPos.cs` | `src/OpenRA.Game/CPos.ts` |
| `MPos` (Map position, U/V) | Done | `OpenRA.Game/MPos.cs` | `src/OpenRA.Game/MPos.ts` |
| `WPos` (World position, X/Y/Z) | Done | `OpenRA.Game/WPos.cs` | `src/OpenRA.Game/WPos.ts` |
| `WVec` (World vector) | Done | `OpenRA.Game/WVec.cs` | `src/OpenRA.Game/WVec.ts` |
| `WAngle` (World angle, 0-1024) | Done | `OpenRA.Game/WAngle.cs` | `src/OpenRA.Game/WAngle.ts` |
| `WDist` (World distance) | Done | `OpenRA.Game/WDist.cs` | `src/OpenRA.Game/WDist.ts` |
| `WRot` (World rotation) | Done | `OpenRA.Game/WRot.cs` | `src/OpenRA.Game/WRot.ts` |
| `CVec` (Cell vector) | Done | `OpenRA.Game/CVec.cs` | `src/OpenRA.Game/CVec.ts` |
| `MapGridType` enum | Done | `OpenRA.Game/Map/MapGrid.cs` | `src/OpenRA.Game/Map/MapGridType.ts` |

### 1.4 Architecture Diagram Reference

Refer to **Section 5** in `docs/openra_migration.agent.final.converted.md` (lines 627-849) for the complete OpenRA Map system architecture analysis. Key structural mappings:

```
Map.cs            -->  MapLoader (build pipeline) + TerrainData (runtime)
MapGrid.cs        -->  MapGridConfig (data) + CellRampDefinitions (geometry templates)
CellLayer<T>      -->  TypedArray wrappers (Uint8Array, Float32Array)
CellRamp (20)     -->  3D vertex generation templates
TerrainInfo.cs    -->  TerrainTypeLookup (Map<string, TerrainProperties>)
TileSet (static)  -->  TileSetDatabase (JSON, build-time compiled)
PathSearch        -->  AStarSearch class (TS port)
HierarchicalPathFinder -->  HPAStar class (TS port) OR RecastNavigation NavMesh
```

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (34 files across 9 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: CellLayer Infrastructure (Foundation)** | | | | | |
| 1 | `OpenRA.Game/Map/CellLayerBase.cs` | `src/OpenRA.Game/Map/CellLayerBase.ts` | `CellLayerBase<T>` | 78 | Low | A |
| 2 | `OpenRA.Game/Map/CellLayer.cs` | `src/OpenRA.Game/Map/CellLayer.ts` | `CellLayer<T>` | 175 | Medium | A |
| 3 | `OpenRA.Game/Map/CellRegion.cs` | `src/OpenRA.Game/Map/CellRegion.ts` | `CellRegion` | 169 | Low | A |
| 4 | `OpenRA.Game/Map/ProjectedCellLayer.cs` | `src/OpenRA.Game/Map/ProjectedCellLayer.ts` | `ProjectedCellLayer<T>` | 63 | Low | A |
| 5 | `OpenRA.Game/Map/ProjectedCellRegion.cs` | `src/OpenRA.Game/Map/ProjectedCellRegion.ts` | `ProjectedCellRegion` | 125 | Low | A |

| **Phase B: MapGrid -- Grid Geometry** | | | | | |
| 6 | `OpenRA.Game/Map/MapGrid.cs` | `src/OpenRA.Game/Map/MapGrid.ts` | `MapGrid` | 256 | HIGH | B |
| 7 | `OpenRA.Game/Map/MapGrid.cs` (extracted) | `src/OpenRA.Game/Map/CellRamp.ts` | `CellRamp`, `RampCornerHeight`, `RampSplit` | -- | HIGH | B |
| 7a | (already done) | `src/OpenRA.Game/Map/MapGridType.ts` | `MapGridType` | -- | Done | B |

| **Phase C: TerrainInfo / TileSet -- Terrain Type System** | | | | | |
| 8 | `OpenRA.Game/Map/TerrainInfo.cs` | `src/OpenRA.Game/Map/TerrainInfo.ts` | `TerrainTileInfo`, `TerrainTypeInfo`, `TileSet` | 197 | Medium | C |

| **Phase D: Map.cs -- Core Map Container** | | | | | |
| 9 | `OpenRA.Game/Map/Map.cs` | `src/OpenRA.Game/Map/Map.ts` | `Map` / `TerrainData` | 1450 | HIGH | D |

| **Phase E: Map Support Files** | | | | | |
| 10 | `OpenRA.Game/Map/MapCache.cs` | `src/OpenRA.Game/Map/MapCache.ts` | `MapCache` | 462 | Medium | E |
| 11 | `OpenRA.Game/Map/MapPlayers.cs` | `src/OpenRA.Game/Map/MapPlayers.ts` | `MapPlayers` | 82 | Low | E |
| 12 | `OpenRA.Game/Map/MapPreview.cs` | `src/OpenRA.Game/Map/MapPreview.ts` | `MapPreview` | 781 | Medium | E |
| 13 | `OpenRA.Game/Map/MapDirectoryTracker.cs` | `src/OpenRA.Game/Map/MapDirectoryTracker.ts` | `MapDirectoryTracker` | 127 | Low | E |
| 14 | `OpenRA.Game/Map/MapGenerationArgs.cs` | `src/OpenRA.Game/Map/MapGenerationArgs.ts` | `MapGenerationArgs` | 58 | Low | E |
| 15 | `OpenRA.Game/Map/CellCoordsRegion.cs` | `src/OpenRA.Game/Map/CellCoordsRegion.ts` | `CellCoordsRegion` | 121 | Low | A (done) |
| 16 | `OpenRA.Game/Map/MapCoordsRegion.cs` | `src/OpenRA.Game/Map/MapCoordsRegion.ts` | `MapCoordsRegion` | 89 | Low | A (done) |
| 17 | `OpenRA.Game/Map/TileReference.cs` | `src/OpenRA.Game/Map/TileReference.ts` | `TileReference` | 46 | Low | E |
| 18 | `OpenRA.Game/Map/ActorInitializer.cs` | `src/OpenRA.Game/Map/ActorInitializer.ts` | `ActorInitializer` | 271 | Medium | E |
| 19 | `OpenRA.Game/Map/ActorReference.cs` | `src/OpenRA.Game/Map/ActorReference.ts` | `ActorReference` | 208 | Medium | E |
| 20 | `OpenRA.Game/Map/PlayerReference.cs` | `src/OpenRA.Game/Map/PlayerReference.ts` | `PlayerReference` | 65 | Low | E |

| **Phase F: 3D Terrain Mesh Generation (NEW -- no OpenRA equivalent)** | | | | | |
| 21 | *(new file)* | `src/OpenRA.Game/Map/TerrainMeshBuilder.ts` | `TerrainMeshBuilder` | 0 (new) | HIGH | F |
| 22 | *(new file)* | `src/OpenRA.Game/Map/TerrainMaterial.ts` | `TerrainMaterial` | 0 (new) | HIGH | F |

| **Phase G: Pathfinding System** | | | | | |
| 23 | `OpenRA.Mods.Common/Pathfinder/IPathGraph.cs` | `src/OpenRA.Mods.Common/Pathfinder/IPathGraph.ts` | `IPathGraph` | 109 | Medium | G |
| 24 | `OpenRA.Mods.Common/Pathfinder/PathSearch.cs` | `src/OpenRA.Mods.Common/Pathfinder/PathSearch.ts` | `PathSearch` | 421 | HIGH | G |
| 25 | `OpenRA.Mods.Common/Pathfinder/CellInfo.cs` | `src/OpenRA.Mods.Common/Pathfinder/CellInfo.ts` | `CellInfo` | 76 | Low | G |
| 26 | `OpenRA.Mods.Common/Pathfinder/CellInfoLayerPool.cs` | `src/OpenRA.Mods.Common/Pathfinder/CellInfoLayerPool.ts` | `CellInfoLayerPool` | 86 | Low | G |
| 27 | `OpenRA.Mods.Common/Pathfinder/Grid.cs` | `src/OpenRA.Mods.Common/Pathfinder/Grid.ts` | `Grid` | 94 | Low | G |
| 28 | `OpenRA.Mods.Common/Pathfinder/DensePathGraph.cs` | `src/OpenRA.Mods.Common/Pathfinder/DensePathGraph.ts` | `DensePathGraph` | 235 | Medium | G |
| 29 | `OpenRA.Mods.Common/Pathfinder/MapPathGraph.cs` | `src/OpenRA.Mods.Common/Pathfinder/MapPathGraph.ts` | `MapPathGraph` | 56 | Low | G |
| 30 | `OpenRA.Mods.Common/Pathfinder/GridPathGraph.cs` | `src/OpenRA.Mods.Common/Pathfinder/GridPathGraph.ts` | `GridPathGraph` | 54 | Low | G |
| 31 | `OpenRA.Mods.Common/Pathfinder/SparsePathGraph.cs` | `src/OpenRA.Mods.Common/Pathfinder/SparsePathGraph.ts` | `SparsePathGraph` | 53 | Low | G |
| 32 | `OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.cs` | `src/OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.ts` | `HierarchicalPathFinder` | 1284 | HIGH | G |

| **Phase H: MiniYAML Preprocessing Pipeline** | | | | | |
| 33 | *(new, build tooling)* | `utils/miniyaml-to-json.ts` | `MiniYamlToJson` | 0 (new) | HIGH | H |

| **Phase I: CoordinateTransformer Utility** | | | | | |
| 34 | *(new file)* | `src/OpenRA.Game/CoordinateTransformer.ts` | `CoordinateTransformer` | 0 (new) | Medium | I |

> **Complexity Legend**:
> - **LOW**: Data structures with no external dependencies beyond Phase A. 40-170 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Some dependency on Phase A/B types. 170-780 lines of C# with moderate Babylon.js integration.
> - **HIGH**: Complex architecture requiring careful design. 256-1450+ lines of C# with significant Babylon.js integration, algorithm porting, or 3D geometry generation.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 34 (29 from OpenRA + 5 new) |
| **Phase A (CellLayer infra)** | 8 files (5 original + 3 supporting) |
| **Phase B (MapGrid)** | 1 file (+1 already done) |
| **Phase C (TerrainInfo)** | 1 file |
| **Phase D (Map core)** | 1 file |
| **Phase E (Support files)** | 9 files (2 moved to Phase A) |
| **Phase F (3D terrain, new)** | 2 files |
| **Phase G (Pathfinding)** | 10 files |
| **Phase H (MiniYAML pipeline, new)** | 1 file |
| **Phase I (CoordinateTransformer, new)** | 1 file |
| **Deferrable (to later chapters)** | 4 files (MapPreview, ActorInitializer, ActorReference, PlayerReference) |
| **HIGH complexity** | 6 files (MapGrid, Map, TerrainMeshBuilder, TerrainMaterial, PathSearch, HierarchicalPathFinder, MiniYAML pipeline) |
| **MEDIUM complexity** | 6 files |
| **LOW complexity** | 21 files |
| **Total OpenRA C# source lines** | ~6,400 |
| **New TypeScript lines (no OpenRA source)** | ~2,500 (TerrainMeshBuilder, TerrainMaterial, MiniYAML pipeline, CoordinateTransformer) |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: CellLayer Infrastructure

**Status**: COMPLETE (8/8 implemented, 195/195 tests, review approved)
**Complexity**: Low-Medium
**Completed**: 2026-06-04
**Review**: 2 rounds (1 Architect WR + 1 final), 0 BLOCKERs
**Blocked by**: Chapter 3 Phase A (CPos, MPos, MapGridType) -- already COMPLETE
**Blocks**: Phase D (Map.cs -- uses CellLayer for all data planes)

**Description**: CellLayer infrastructure provides the 2D grid data storage foundation for the entire map system. `CellLayerBase<T>` wraps a 1D array with grid-aware indexing. `CellLayer<T>` adds event-driven mutation with `CellEntryChanged`. `CellRegion` provides iterable cell region enumeration. In TypeScript, this maps to TypedArray wrappers for efficient GPU upload and minimal GC pressure.

**Paradigm Shifts**:
- C# `T[]` (generic managed array) -> `Float32Array` / `Uint8Array` / `Array<T>` (TypedArray for numeric layers, Array for object layers)
- C# `event Action<CPos>` -> observer callback pattern
- C# `IEnumerable<T>` -> TypeScript `Iterable<T>` / `[Symbol.iterator]()`
- C# `ReadOnlyMemory<T>` -> `readonly` TypedArray slice views
- Index formulas EXACTLY preserved: Rectangular: `v * width + u`, Isometric: `v * width + u` where `u = (x - y) / 2, v = x + y`

#### 3.1.1 CellLayerBase<T>

- [x] **TODO-4.A.1** `src/OpenRA.Game/Map/CellLayerBase.ts` (78 lines C#) -- Abstract base for grid data storage:
  - Generic class `CellLayerBase<T>` with `Size: Size`, `GridType: MapGridType`, `entries: T[] | TypedArray`
  - Constructor from `MapGridType` + `Size`: allocates `width * height` entries
  - Constructor from `Map` instance: delegates to `Map.Grid.Type` and `Map.MapSize`
  - `copyValuesFrom(other: CellLayerBase<T>): void` -- bulk copy (size and grid type must match)
  - `clear(): void` -- fill with default value
  - `clear(value: T): void` -- fill with explicit value
  - `[Symbol.iterator](): Iterator<T>` -- iterate all entries
  - **Non-numeric layers** (e.g., `CellLayer<TerrainTile>`) use standard `Array<T>`; **numeric layers** (e.g., `CellLayer<byte>` for height) use `Uint8Array` / `Float32Array`
  - **Performance**: TypedArray `.fill()` is O(n) but native-fast; avoid per-frame realloc cycles

#### 3.1.2 CellLayer<T>

- [x] **TODO-4.A.2** `src/OpenRA.Game/Map/CellLayer.ts` (175 lines C#) -- Event-driven typed cell layer:
  - Extends `CellLayerBase<T>`
  - Observer pattern: `addObserver(cb)` / `removeObserver(cb)` for CellEntryChanged
  - `get(cell: CPos): T` / `getByMPos(uv: MPos): T` -- O(1) lookup via index formula
  - `set(cell: CPos, value: T): void` / `setByMPos(uv: MPos, value: T): void` -- O(1) write + notify
  - `tryGetValue(cell: CPos): T | undefined` -- bounds-checked with isometric X<Y guard
  - `contains(cell: CPos): boolean` / `contains(uv: MPos): boolean` -- bounds check
  - `clamp(cell: CPos): CPos` / `clamp(uv: MPos): MPos` -- clamp to bounds
  - `cellRegion: CellRegion` getter
  - `Resize(layer, newSize, defaultValue)` static helper
  - **Key invariant**: `copyValuesFrom`/`clear`/`clear(T)` throw if observers are attached (prevents stale events)
  - **Index formulas** (from CellLayer.cs lines 56-77): Rectangular: `y * width + x`; Isometric: `u = (x-y)/2, v = x+y, v * width + u`
  - **Isometric guard** (CellLayer.cs lines 110-111): `X < Y` cells are invalid in isometric, return false/undefined

#### 3.1.3 CellRegion

- [x] **TODO-4.A.3** `src/OpenRA.Game/Map/CellRegion.ts` (169 lines C#) -- Enumerable cell region:
  - Immutable region: `GridType`, `topLeft: MPos`, `bottomRight: MPos`
  - `[Symbol.iterator](): Iterator<MPos>` and `[Symbol.iterator](): Iterator<CPos>` (two iteration modes)
  - `size: number`, `isEmpty: boolean`
  - `mapCoords: MapCoordsRegion`, `cellCoords: CellCoordsRegion` getters
  - Empty region: yields nothing when topLeft > bottomRight

#### 3.1.4 ProjectedCellLayer<T> + ProjectedCellRegion

- [x] **TODO-4.A.4** `src/OpenRA.Game/Map/ProjectedCellLayer.ts` (63 lines C#) -- PPos-indexed layer
- [x] **TODO-4.A.5** `src/OpenRA.Game/Map/ProjectedCellRegion.ts` (125 lines C#) -- PPos region iteration

#### 3.1.5 Supporting Files (migrated alongside Phase A as dependencies)

- [x] **TODO-4.A.6** `src/OpenRA.Game/Map/CellCoordsRegion.ts` (121 lines C#) -- Cell-coordinate region iteration (originally Phase E)
- [x] **TODO-4.A.7** `src/OpenRA.Game/Map/MapCoordsRegion.ts` (89 lines C#) -- Map-coordinate region iteration (originally Phase E)
- [x] **TODO-4.A.8** `src/OpenRA.Game/Primitives/Size.ts` (21 lines TS new) -- 2D size primitive required by CellLayer (no OpenRA equivalent, extracted from OpenRA.Size)

**Acceptance Criteria**:
- CellLayer index formulas match OpenRA for all 4 combinations (Rectangular/CPos, Rectangular/MPos, Isometric/CPos, Isometric/MPos)
- Isometric X<Y guard correctly rejects invalid cells
- CellEntryChanged fires exactly once per set with correct CPos
- copyValuesFrom/clear throw when observers attached
- CellRegion iteration yields correct sequences
- 512x512 map layer allocation under 10ms

**Actual Results**: ~2,857 lines implementation + ~969 lines test = 3,826 total lines, 195/195 tests passing, 7 files + 1 supporting (Size.ts). 2 review rounds (1 Architect WR + 1 final), 0 BLOCKERs.

| File | Lines (impl) | Lines (test) |
|:---|:---:|:---:|
| CellLayerBase.ts | 213 | 281 |
| CellLayer.ts | 468 | 722 |
| CellRegion.ts | 309 | 356 |
| ProjectedCellLayer.ts | 183 | 227 |
| ProjectedCellRegion.ts | 234 | 262 |
| CellCoordsRegion.ts | 171 | 140 |
| MapCoordsRegion.ts | 122 | 117 |
| Size.ts (Primitives/) | 21 | -- |
| **Total** | **~2,857** | **~969** |

---

### 3.2 Phase B: MapGrid -- Grid Geometry

**Status**: COMPLETE (2/2 files: MapGrid.ts + CellRamp.ts extracted, 138 tests, review approved)
**Complexity**: HIGH (CellRamp geometry)
**Completed**: 2026-06-04
**Review**: 1 round (Architect WR), 5 BLOCKERs resolved, 0 remaining
**Blocked by**: Chapter 3 Phase A (WVec, WRot, WAngle -- all COMPLETE)
**Blocks**: Phase C (TerrainInfo for RampType), Phase D (Map holds MapGrid), Phase F (3D terrain from CellRamp)

**Description**: `MapGrid` defines the geometric foundation of the map. The `CellRamp` class is the critical piece -- it defines 21 discrete slope shapes with corner heights and triangle splits, and provides `heightOffset(dx, dy)` for barycentric height interpolation within a cell. **Architect WR**: CellRamp extracted to separate `CellRamp.ts` file for modularity; `RampCornerHeight` and `RampSplit` enums added; `Exts.isqrtCeiling()` added for OpenRA `ISqrt(ISqrtRoundMode.Ceiling)` equivalence; `CVec.hashCode()` added for deterministic sort tiebreaker.

#### 3.2.1 MapGrid Configuration + CellRamp

- [x] **TODO-4.B.1** `src/OpenRA.Game/Map/MapGrid.ts` (256 lines C#) -- `MapGrid` class:
  - `type: MapGridType`, `tileScale: number` (1024/1448), `maximumTerrainHeight: number`, `enableDepthBuffer: boolean`, `maximumTileSearchRange: number` (default 50)
  - `subCellOffsets: WVec[]` -- 6 predefined offsets: (0,0,0), (-299,-256,0), (256,-256,0), (0,0,0), (-299,256,0), (256,256,0)
  - `offsetOfSubCell(subCell: number): WVec`
  - `tilesByDistance: CVec[][]` -- cells grouped by integer ceiling distance, deterministically sorted

- [x] **TODO-4.B.2** `CellRamp` class (within MapGrid.ts):
  - `centerHeightOffset: number`, `corners: WVec[]` (4 corners: TL, TR, BR, BL), `polygons: WVec[][]` (1-2 triangles), `orientation: WRot`
  - Rectangular corners: (-512,-512,z), (512,-512,z), (512,512,z), (-512,512,z)
  - Isometric corners: (0,-724,z), (724,0,z), (0,724,z), (-724,0,z)
  - `heightOffset(dx, dy): number` -- barycentric interpolation: find containing triangle via u,v in [0,1024], interpolate `(u*z0 + v*z1 + (1024-u-v)*z2) / 1024`
  - Split modes: Flat (1 quad), X (2 tri: 0-1-3 + 1-2-3), Y (2 tri: 0-1-2 + 0-2-3)
  - **21 predefined ramps** matching OpenRA hardcoded array:
    - 1 Flat
    - 4 two-adjacent-corners half (tr+br, br+bl, tl+bl, tl+tr with orientation)
    - 4 one-corner half (br/splitX, bl/splitY, tl/splitX, tr/splitY with orientation)
    - 4 three-corners half (various combinations with split + orientation)
    - 4 full sloped (mid-half, far-full with orientation)
    - 4 opposite-corners half (tr+bl/splitY, tl+br/splitY, tr+bl/splitX, tl+br/splitX)

- [x] **TODO-4.B.3** `TilesByDistance` generation: cells within range, grouped by integer distance, sorted by LengthSquared -> hash -> X -> Y

**Acceptance Criteria**:
- All 21 CellRamp corner heights and polygon splits match OpenRA exactly
- `heightOffset()` barycentric interpolation verified at corners and center for each ramp type
- TileScale: 1024 Rectangular, 1448 Isometric
- SubCellOffsets match OpenRA values
- TilesByDistance deterministic sort order

**Estimated Effort**: ~500 lines implementation + ~400 lines test (3 developer-days)

**Actual Results**: ~674 lines implementation + ~843 lines test = ~1,517 total lines. 138 tests total (39 CellRamp + 49 MapGrid + 10 Exts.isqrtCeiling + 40 CVec.hashCode). 1 review round (Architect WR), 5 BLOCKERs resolved, 0 remaining. C# integer division -> `Math.trunc()` for heightOffset truncation toward zero. `Exts.isqrtCeiling()` replaces OpenRA `ISqrt(Ceiling)`. `CVec.hashCode()` replaces C# `CVec.GetHashCode()`.

| File | Lines (impl) | Lines (test) |
|:---|:---:|:---:|
| MapGrid.ts | 436 | 491 |
| CellRamp.ts | 238 | 352 |
| Exts.ts (updated) | 67 (+19) | 41 (+10) |
| CVec.ts (updated) | 271 (+18) | 34 (+40) |
| **Total** | **~674** (new/changed) | **~843** |

---

### 3.3 Phase C: TerrainInfo / TileSet -- Terrain Type System

**Status**: Pending (0/1)
**Complexity**: Medium
**Blocked by**: Phase B (CellRamp for RampType)
**Blocks**: Phase D (Map.Tiles uses TerrainTileInfo)

**Description**: All three classes (`TerrainTileInfo`, `TerrainTypeInfo`, `TileSet`) are in a single C# file (197 lines). TileSet is a static class indexing terrain templates from YAML.

- [x] **TODO-4.C.1** `TerrainTypeInfo` (in `TerrainInfo.ts`): `type: string`, `targetTypes: Set<string>`, `acceptsSmudgeType: Set<string>`, `color: Color`, static `types` registry

- [x] **TODO-4.C.2** `TerrainTileInfo` (in `TerrainInfo.ts`): `terrainType: number`, `height: number` (0-255), `rampType: number` (index into Ramps), `minColor`/`maxColor`, `riser: Int8Array` (8 directions: TL,TR,R,BR,B,BL,L,TL2). Support short-form (`"LU=6"`) and long-form (`"6,6,0,0,0,0,6,6"`) Riser parsing.

- [x] **TODO-4.C.3** `TileSet` static class (in `TerrainInfo.ts`): `templates: Map<string, TileTemplate>`, `tiles: Map<number, TerrainTileInfo>`, `terrainTypes: Map<string, TerrainTypeInfo>`, `getTileInfo()`, `getTerrainType()`. JSON format from build-time YAML compilation.

**Estimated Effort**: ~400 lines implementation + ~350 lines test (2 developer-days)

---

### 3.4 Phase D: Map.cs -- Core Map Container

**Status**: Pending (0/1)
**Complexity**: HIGH
**Blocked by**: Phases A, B, C
**Blocks**: Phase F (3D terrain), Phase G (pathfinding), Chapter 5+ (game logic)

**Description**: `Map` is the 1450-line heart of the terrain system. In 3D, responsibilities split into `MapLoader` (build pipeline) and `TerrainData` (runtime).

- [ ] **TODO-4.D.1** `src/OpenRA.Game/Map/Map.ts` -- `Map` class: `grid`, `mapSize`, `tiles`, `resources`, `height` (Uint8Array), `ramp`, `customTerrain`, `projectedCells`, metadata fields

- [ ] **TODO-4.D.2** `MapLoader.fromOramap(packageData: ArrayBuffer): Promise<Map>` -- extract map.yaml + map.bin from ZIP via fflate, parse, construct Map. `Map.createBlank(gridType, size, tileSet): Map` -- editor blank map

- [ ] **TODO-4.D.3** `MapBinParser` -- 17-byte header (Width:2, Height:2, Reserved:2, Zero:4, Zero:4, Flags:1, Zero:2). Tile data: `w*h*2` bytes (Uint16LE per cell). Resource data: `w*h*2` bytes. Height data: optional `w*h` bytes if flags bit 0 set.

- [ ] **TODO-4.D.4** Coordinate methods: `contains(CPos/MPos/PPos)`, `centerOfCell(CPos): WPos` (Rectangular: `(x*1024, y*1024, height)`; Isometric: `((x+y)*724, (y-x)*724, height)`), `cellContaining(WPos): CPos`, `heightAt(CPos): number` (base height + ramp offset)

- [ ] **TODO-4.D.5** Data layer management: `updateRamp(cell)`, `updateProjection(cell)`, `resize(newSize)`, `fixOpenAreas()`

- [ ] **TODO-4.D.6** `Map.toJSON()` -- JSON with base64-encoded TypedArray blobs for tile/resource/height data

**Estimated Effort**: ~1,200 lines implementation + ~800 lines test (5-6 developer-days)

---

### 3.5 Phase E: Map Support Files

**Status**: Pending (0/11)
**Complexity**: Low-Medium
**Blocked by**: Phase D (Map referenced by most support files)

- [ ] **TODO-4.E.1** `src/OpenRA.Game/Map/MapCache.ts` (462 lines C#) -- map directory scanner, web-adapted to index JSON manifest
- [ ] **TODO-4.E.2** `src/OpenRA.Game/Map/MapPreview.ts` (781 lines C#) -- **DEFERRABLE** (requires terrain rendering pipeline, defer to Chapter 5+)
- [ ] **TODO-4.E.3** `src/OpenRA.Game/Map/MapDirectoryTracker.ts` (127 lines C#) -- file watcher, browser: polling manifest
- [ ] **TODO-4.E.4** `src/OpenRA.Game/Map/MapGenerationArgs.ts` (58 lines C#) -- simple data class
- [ ] **TODO-4.E.5** `src/OpenRA.Game/Map/CellCoordsRegion.ts` (121 lines C#) -- CPos-based region iteration
- [ ] **TODO-4.E.6** `src/OpenRA.Game/Map/MapCoordsRegion.ts` (89 lines C#) -- MPos-based region iteration
- [ ] **TODO-4.E.7** `src/OpenRA.Game/Map/MapPlayers.ts` (82 lines C#) -- spawn management, player slot validation
- [ ] **TODO-4.E.8** `src/OpenRA.Game/Map/PlayerReference.ts` (65 lines C#) -- simple data class, deferrable
- [ ] **TODO-4.E.9** `src/OpenRA.Game/Map/ActorReference.ts` (208 lines C#) -- **DEFER to Chapter 5+** (needs full Actor/Trait system)
- [ ] **TODO-4.E.10** `src/OpenRA.Game/Map/ActorInitializer.ts` (271 lines C#) -- **DEFER to Chapter 5+** (tied to Actor lifecycle)
- [ ] **TODO-4.E.11** `src/OpenRA.Game/Map/TileReference.ts` (46 lines C#) -- simple (TemplateID, TileIndex) pair

**Estimated Effort**: ~600 lines implementation + ~400 lines test for non-deferrable items (2-3 developer-days)

---

### 3.6 Phase F: 3D Terrain Mesh Generation

**Status**: Pending (0/2 -- new files)
**Complexity**: HIGH
**Blocked by**: Phases A-D, Phase I (CoordinateTransformer)
**Blocks**: Visual map rendering

**Description**: The critical paradigm-shift phase. 2D tile rendering becomes continuous 3D mesh with height displacement and texture splatting.

- [ ] **TODO-4.F.1** `src/OpenRA.Game/Map/TerrainMeshBuilder.ts` -- Generate terrain mesh:
  - Per-cell 4-corner vertex generation from height + CellRamp corner offsets
  - Index buffer with shared vertices between adjacent cells
  - Smooth normals via adjacent face averaging
  - World-space UV = (X/mapWidth, Y/mapHeight) for texture tiling
  - Cliff face quads where Riser non-zero between cells
  - Both grid types supported
  - Target: 512x512 map under 1 second generation time

- [ ] **TODO-4.F.2** `src/OpenRA.Game/Map/TerrainMaterial.ts` -- Texture splatting:
  - RGBA splat map from TerrainType classification (4 types per cell)
  - Up to 12 texture arrays (diffuse + normal per type)
  - Custom ShaderMaterial: vertex (world-space UV), fragment (splat-weighted blend + PBR)
  - Tiling scale, height blend parameters
  - Fallback StandardMaterial for dev/testing

**Estimated Effort**: ~1,500 lines implementation + ~600 lines test (7-8 developer-days)

---

### 3.7 Phase G: Pathfinding System

**Status**: Pending (0/10)
**Complexity**: HIGH (HPA*), Medium (A*)
**Blocked by**: Phase D (Map for terrain passability)
**Key Architecture Decision**: Port HPA* to TypeScript (ADR-4.1)

- [ ] **TODO-4.G.1** `src/OpenRA.Mods.Common/Pathfinder/IPathGraph.ts` (109 lines C#) -- path graph interface
- [ ] **TODO-4.G.2** `src/OpenRA.Mods.Common/Pathfinder/PathSearch.ts` (421 lines C#) -- A* engine with priority queue, maxCost cutoff, reverse search, bidirectional search
- [ ] **TODO-4.G.3** `src/OpenRA.Mods.Common/Pathfinder/Grid.ts` (94 lines C#) -- grid discretization helper
- [ ] **TODO-4.G.4** `src/OpenRA.Mods.Common/Pathfinder/CellInfo.ts` + `CellInfoLayerPool.ts` (76+86 lines) -- cell state + object pool for zero-allocation search
- [ ] **TODO-4.G.5** `src/OpenRA.Mods.Common/Pathfinder/DensePathGraph.ts` (235 lines C#) -- 8-directional uniform-cost graph
- [ ] **TODO-4.G.6** `src/OpenRA.Mods.Common/Pathfinder/GridPathGraph.ts` (54 lines C#)
- [ ] **TODO-4.G.7** `src/OpenRA.Mods.Common/Pathfinder/MapPathGraph.ts` (56 lines C#) -- stub (delegates to DensePathGraph until Locomotor available)
- [ ] **TODO-4.G.8** `src/OpenRA.Mods.Common/Pathfinder/SparsePathGraph.ts` (53 lines C#) -- abstract graph stub
- [ ] **TODO-4.G.9** `src/OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.ts` (1284 lines C#) -- HPA*: 10x10 clusters, abstract nodes/edges, hierarchical two-level search, dynamic obstacle updates
- [ ] **TODO-4.G.10** RecastNavigation integration investigation (ADR-4.1, deferred post-Chapter 4)

**Estimated Effort**: ~2,500 lines implementation + ~1,500 lines test (8-10 developer-days for full HPA*; 3-4 days for A* only)

---

### 3.8 Phase H: MiniYAML Preprocessing Pipeline

**Status**: Pending (0/1 -- new build tooling)
**Complexity**: HIGH
**Blocked by**: Nothing (pure build tooling)

**MANDATORY**: MiniYAML MUST be compiled to JSON at build time (ADR-4.2). The browser never sees MiniYAML.

- [ ] **TODO-4.H.1** `utils/miniyaml-to-json.ts` -- Recursive descent parser:
  - `@` named nodes: `Key@Name` -> `{ type: "Key", id: "Name", ... }`
  - `-TraitName` removal: `{ __remove: true }` marker
  - Tab-based indentation nesting, comments, block scalars
  - Expression variable preservation (`WINDOW_WIDTH - 100`)
  - Trait inheritance: parent merge, child override
  - Vite plugin integration: auto-rebuild on YAML change

- [ ] **TODO-4.H.2** Map-specific pipeline: map.yaml -> map.json (metadata, players, actors, rules sections); tileset.yaml -> JSON index

**Estimated Effort**: ~800 lines implementation + ~500 lines test (5-6 developer-days)

---

### 3.9 Phase I: CoordinateTransformer Utility

**Status**: Pending (0/1 -- new file)
**Complexity**: Medium
**Blocked by**: Chapter 3 Phase A (done)
**Blocks**: Phase F (TerrainMeshBuilder)

- [ ] **TODO-4.I.1** `src/OpenRA.Game/CoordinateTransformer.ts`:
  - `worldScale = 1/1024`, `heightScale = 1/512`
  - `wPosToVector3(wpos: WPos): Vector3` -- OpenRA (X,Y,Z) -> Babylon (X * scale, Z * heightScale, Y * scale)
  - `cellToVector3(cpos: CPos, height: number): Vector3`
  - `cellToVector3WithRamp(cpos, height, ramp, grid): Vector3` -- barycentric height from CellRamp
  - `vector3ToWPos(vec: Vector3): WPos` -- reverse for ray-picking
  - `cellsToVertices(...): Float32Array` -- batch conversion for mesh generation
  - LRU cache (1000 entries) for repeated conversions

**Estimated Effort**: ~400 lines implementation + ~300 lines test (2-3 developer-days)

---

## 4. Dependency Graph

```
Chapter 3 Phase A (CPos, MPos, WPos, WVec, WAngle, WRot, CVec) -- ALREADY DONE
  |
  +--> Phase A (CellLayer, CellLayerBase, CellRegion, ProjectedCellLayer, ProjectedCellRegion)
  |     |
  |     +--> Phase B (MapGrid / CellRamp) ----+
  |     |     |                                |
  |     |     +--> Phase C (TerrainInfo / TileSet) --+
  |     |     |                                |      |
  |     |     +--> Phase D (Map.cs) <----------+------+
  |     |           |
  |     |           +--> Phase E (MapCache, MapPlayers, ...)
  |     |           +--> Phase F (TerrainMeshBuilder, TerrainMaterial) [NEW]
  |     |           |     +--> (depends on Phase I)
  |     |           +--> Phase G (Pathfinding: IPathGraph, PathSearch, HPA*, ...)
  |     |
  |     +--> Phase I (CoordinateTransformer) -- starts after Phase A
  |
  +--> Phase H (MiniYAML Pipeline) -- independent, pure build tooling
```

### Critical Path

```
Phase H (MiniYAML) -- independent, parallel
Phase I (CoordXform) -- parallel with A/B
Phase A -> Phase B -> Phase C -> Phase D -> Phase F -> Phase G
                                         |-> Phase E
```

**Total estimate**: 5-6 weeks (2 devs) or 3-4 weeks (4 devs).

### External Dependencies (Chapters 2 & 3)

| Dependency | Required By | Status |
|:---|:---|:---|
| CPos, MPos, WPos, WVec, WAngle, WRot, CVec | Phases A, B, I | Complete |
| MapGridType.ts | Phases A, B | Complete |
| PriorityQueue.ts | Phase G (A* open set) | Complete |
| Cache.ts | Phase I (position cache) | Complete |
| SpatiallyPartitioned.ts | Phase G (HPA* cluster management) | Complete |
| Renderer.ts, FrameBuffer.ts, Shader.ts, Texture.ts | Phase F (terrain rendering) | Complete |

---

## 5. Verification and Test Strategy

- [ ] **TEST-4.1** CellLayer index formulas match OpenRA (10K random pairs, all 4 grid/coordinate combos)
- [ ] **TEST-4.2** CellRamp geometry: all 21 ramp types, corner heights, heightOffset at corners+center, both grid types
- [ ] **TEST-4.3** map.bin parser round-trip; 1x1/512x512 edges; with/without height; invalid data errors
- [ ] **TEST-4.4** Map coordinates: centerOfCell/cellContaining round-trip, contains bounds, heightAt validates ramp offset
- [ ] **TEST-4.5** TerrainMeshBuilder: 4x4 flat map = 25 vertices + 32 triangles; ramp cell slope geometry; Riser cliff faces; isometric diamond layout
- [ ] **TEST-4.6** PathSearch A*: shortest path on uniform grid, wall avoidance, unreachable target, maxCost cutoff
- [ ] **TEST-4.7** HPA*: 256x256 map + 500 obstacles under 5ms; path length under 135% longer than optimal; incremental obstacle updates
- [ ] **TEST-4.8** MiniYAML: @ node parsing, -TraitName removal, nesting, all shipped OpenRA map.yaml files without errors
- [ ] **TEST-4.9** CoordinateTransformer: WPos->Vector3->WPos round-trip; isometric diamond layout; ramp height offset; batch conversion under 50ms for 512x512
- [ ] **TEST-4.10** E2E integration (Playwright, deferred): load test map -> terrain mesh in scene -> click-to-cell

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **CellRamp 21 shapes -> 3D geometry fidelity** | HIGH | Sloped terrain looks wrong if barycentric interpolation off by 1 unit | Port CellRamp.cs line-for-line; verify heightOffset at all corners + center |
| **map.bin format undocumented edge cases** | MEDIUM | Some maps may have unexpected binary variations | Test against all OpenRA shipped maps |
| **MiniYAML @ node semantics too complex for regex** | HIGH | Regex parsing fails on nested @ nodes | Proper recursive descent parser, not regex |
| **HPA* port ~1500 lines of complex algorithm** | HIGH | Buggy pathfinding breaks all movement and AI | Start with pure A* baseline; add HPA* as optimization; RecastNavigation as fallback |
| **3D terrain mesh too large (512^2 = 1M+ triangles)** | MEDIUM | Frame rate drops, mobile devices crash | LOD: near = full detail, distant = simplified; Babylon.js Mesh.simplify() |
| **Isometric grid parity errors** | MEDIUM | Half-cell offset on isometric maps | Port exact V&1 parity logic from CPos.ToMPos |
| **Texture splatting limited to 4 textures per pass** | LOW | Maps with >4 terrain types need multi-pass | Region-based splat map switching |
| **CoordinateTransformer floating-point drift** | MEDIUM | FP error on extreme map sizes | Math.round() for integer results; cached positions |
| **MiniYAML build step adds complexity** | LOW | Devs must rebuild YAML after changes | Vite plugin auto-rebuilds on file change |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-4.1: Pathfinding Strategy -- HPA* Port vs RecastNavigation

- **Decision**: **Port HPA* to TypeScript as primary.** RecastNavigation as optional visual enhancement.
- **Rationale**: Deterministic behavior matching OpenRA; incremental abstract graph updates; fine control over movement costs.
- **Mitigation**: Implement pure A* first as baseline; add HPA* as optimization layer.

### ADR-4.2: MiniYAML Build-Time Compilation (MANDATORY)

- **Decision**: **MiniYAML MUST be compiled to JSON at build time.** Browser never sees MiniYAML.
- **Rationale**: Fast JSON.parse(), no MiniYAML library, clear build-time errors.
- **Mitigation**: Vite plugin auto-rebuilds; comprehensive error messages.

### ADR-4.3: 3D Terrain -- Custom Mesh vs Height Map

- **Decision**: **Generate custom terrain mesh from CellRamp data.** NOT CreateGroundFromHeightMap.
- **Rationale**: Complete fidelity to OpenRA's discrete slope geometry and cliff faces.
- **Mitigation**: Generate once at map load; cache in GPU memory.

### ADR-4.4: Texture Splatting vs Tile-Based Texture Atlas

- **Decision**: **Texture splatting with up to 4 terrain types per cell.**
- **Rationale**: Smooth transitions, scalable; requires custom ShaderMaterial.
- **Mitigation**: Region-based switching for maps with >4 types.

### ADR-4.5: Map Serialization -- JSON with Base64 Blobs

- **Decision**: **JSON with base64-encoded TypedArray blobs.** Not porting map.bin to web output.
- **Rationale**: Self-contained, gzip-friendly, readable metadata.
- **Mitigation**: atob() decode is fast; one-time load cost.

### ADR-4.6: MapPreview Deferral

- **Decision**: **Defer MapPreview to post-Chapter 4.** Needs terrain rendering pipeline.
- **Mitigation**: Canvas 2D interim minimap from height + terrain type colors.

### ADR-4.7: ActorInitializer / ActorReference / PlayerReference Deferral

- **Decision**: **Defer to Chapter 5+** (Mod System / Game Logic). Stub interfaces in Chapter 4.
- **Mitigation**: Define TypeScript interfaces for Chapter 5 implementations to satisfy.

---

## Migration Order and Phasing Strategy

| Week | Phase | Files | Description | Parallelizable |
|:---:|:---|:---:|:---|:---:|
| 1 | Phase H + I | 2 | MiniYAML pipeline + CoordinateTransformer | YES |
| 1-2 | Phase A | 5 | CellLayer infrastructure | YES (all 5) |
| 2 | Phase B | 1 | MapGrid + CellRamp | After Phase A |
| 2-3 | Phase C | 1 | TerrainInfo + TileSet | After Phase B |
| 3-4 | Phase D | 1 | Map.cs core container (CRITICAL PATH) | After A+B+C |
| 4-5 | Phase F | 2 | 3D terrain mesh + material | After D+I |
| 4-5 | Phase G | 10 | Pathfinding (parallel with F) | After D |
| 5 | Phase E | 7 | Map support files (non-deferrable) | After D stable |
| -- | Phase E def | 4 | MapPreview, ActorInit, ActorRef, PlayerRef | Deferred Chapter 5+ |

**Total**: 5-6 weeks (2 devs) or 3-4 weeks (4 devs).

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 5 (lines 627-849) -- Architecture analysis
> - `docs/actor_system_migration_plan.md` -- Chapter 3 plan (format reference)
> - `docs/rendering_migration_plan.md` -- Chapter 2 plan
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
