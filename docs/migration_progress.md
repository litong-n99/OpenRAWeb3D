# OpenRAWeb3D Migration Progress

> **Last updated**: 2026-06-12
> **Current phase**: Chapter 5 (UI System & Resource Management) — IN PROGRESS (15/16, 94%)
> **Overall status**: Chapter 2: 27/27 (100%), Chapter 3: 36/36 (100%), Chapter 4: 37/37 (100%), Chapter 5: 15/16 (94%, Phases A+B+C+D COMPLETE), Chapters 2-4 COMPLETE, Chapter 5 in progress

---

## Overall Stats

| Metric | Count |
|--------|-------|
| **Chapter 2 rendering files** | 27 (100% complete) |
| **Chapter 3 planned files** | 31 in-scope + 2 deferrable + 5 support = 36 |
| **Chapter 3 status** | Implementation complete: 36/36 (100%), Phases A-I complete |
| **Chapter 4 planned files** | 37 (32 from OpenRA + 5 new; 34 originally planned + 3 dep files) |
| **Chapter 4 status** | ALL PHASES COMPLETE: 37/37 (100%), 603+190+additional=750+ tests, Phase A (8/8) + Phase B (2/2) + Phase C (1/1) + Phase D (2/2) + Phase E (7/7) + Phase F (2/2) + Phase G (13/13) + Phase H (1/1) + Phase I (1/1) = 37 |
| **Deferred (low priority, documented)** | 1 (TODO-2.6.6 mobile optimization) |
| **Chapter 5 planned files** | 16 (5 Phases A-E, Phases A+B+C+D complete) |
| **Chapter 5 status** | IN PROGRESS: 15/16 (94%), Phase A (FileSystem Foundation) COMPLETE, Phase B (C&C Package Formats) COMPLETE, Phase C (MOD System Core) COMPLETE, Phase D (UI Widget Core) COMPLETE |
| **Remaining chapters** | Chapters 6-8+ (networking, audio, game logic) |
| **Overall project completion** | Chapters 2+3+4/8+ complete (100/100 rendering+actors+map), Chapter 5 in progress (15/16) |

> **Note**: Chapters 2 and 3 are fully complete. Chapter 4 is now complete at 37/37 (100%). Phase A (CellLayer): 8 files, 195 tests. Phase B (MapGrid + CellRamp): 2 files + 2 updated, 138 tests. Phase C (TerrainInfo): 1 file, 93 tests. Phase D (Map Core): 2 files, 38+ tests. Phase E (Map Support): 7 files + 2 stubs, 96 tests. Phase F (Terrain Mesh): 2 new files, 43 tests. Phase G (Pathfinding): 13 files (10 pathfinder + 3 dep), 190 tests, HPA* + A*. Phase H (MiniYAML): 1 new file, build-time JSON compiler. Phase I (CoordinateTransformer): 1 new file, WPos<->Vector3 bridge. Chapter 5: Phase A (FileSystem Foundation) COMPLETE (4/16, 25%, 1,430 impl + 1,961 test lines, 132 tests). Phase B (C&C Package Formats) COMPLETE (5/16, 56%, ~1,472 impl + ~1,653 test lines, 108 tests). Phase C (MOD System Core) COMPLETE (2/16, 69%, 832 impl + 1,296 test lines, 115 tests). Phase D (UI Widget Core) COMPLETE (4/16, 94%, 2,129 impl + 2,333 test lines, 174 tests). Phase E pending.

---

## Rendering Engine (Chapter 2) Progress

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 24 | 89% |
| Completed (no test) | 2 | 7% |
| NOP (intentional omission) | 1 | 4% |
| **Total** | **27** | **100%** |

### Detailed File Status

#### Completed (Full Implementation + Tests)

| # | File | Lines (impl) | Lines (test) | Test Cases | Reviewed |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | `src/OpenRA.Game/Renderer.ts` | 1134 | 928 | 91 | Yes |
| 2 | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | 1314 | 1104 | 74 | Yes |
| 3 | `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | 855 | 679 | 55 | Yes |
| 4 | `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | 1012 | 858 | 68 | Yes |
| 5 | `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.ts` | 161 | 462 | — | Pending |
| 7 | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | 407 | 118 | — | Yes |
| 8 | `src/OpenRA.Game/Graphics/ShaderBindings.ts` | 174 | 205 | — | Yes |
| 9 | `src/OpenRA.Game/Graphics/Vertex.ts` | 340 | 413 | — | Yes |
| 10 | `src/OpenRA.Platforms.Default/Shader.ts` | 417 | 572 | — | Yes |
| 11 | `src/glsl/combined.vert` | 108 | — | — | Yes |
| 12 | `src/glsl/combined.frag` | 345 | — | — | Yes |
| 13 | `src/OpenRA.Platforms.Default/FrameBuffer.ts` | 415 | 649 | 58 | Yes |
| 14 | `src/glsl/postprocess.vert` + 7 `*.frag` shaders | 269 | — | — | Yes |
| 15 | `src/OpenRA.Game/Graphics/Sprite.ts` | 296 | 268 | — | Yes |
| 16 | `src/OpenRA.Game/Graphics/Sheet.ts` | 437 | 351 | — | Yes |
| 17 | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | 502 | 367 | — | Yes |
| 18 | `src/OpenRA.Game/Graphics/HardwarePalette.ts` | 658 | 463 | — | Yes |
| 19 | `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` | 154 | 191 | — | Yes |
| 20 | `src/OpenRA.Game/Graphics/Animation.ts` | 558 | 451 | — | Yes |
| 21 | `src/OpenRA.Game/Graphics/CursorManager.ts` | 548 | 288 | — | Yes |
| 22 | `src/OpenRA.Game/Graphics/TerrainSpriteLayer.ts` | 631 | 346 | — | Yes |
| 23 | `src/OpenRA.Platforms.Default/Texture.ts` | 526 | 485 | 61 (shared) | Yes |
| 24 | `src/OpenRA.Platforms.Default/VertexBuffer.ts` | 375 | 341 | 61 (shared) | Yes |
| 25 | `src/OpenRA.Platforms.Default/StaticIndexBuffer.ts` | 174 | 149 | 61 (shared) | Yes |

> **Note**: Texture.ts, VertexBuffer.ts, and StaticIndexBuffer.ts share 61 test cases across 3 test files (Texture.test.ts: ~485 lines, VertexBuffer.test.ts: ~341 lines, StaticIndexBuffer.test.ts: ~149 lines).

#### Completed (Implementation, No Test File)

| # | File | Lines (impl) | Migration Plan Reference | Reviewed |
|:---:|:---|:---:|:---|:---:|
| 26 | `src/OpenRA.Game/Graphics/RenderPostProcessPassVertex.ts` | 142 | — | Pending |
| 27 | `src/OpenRA.Platforms.Default/ITextureInternal.ts` | 49 | — | Yes |

#### Additional Migrated Files (Beyond Migration Plan 27)

| # | File | Lines (impl) | Lines (test) | Reviewed |
|:---:|:---|:---:|:---:|:---:|
| A1 | `src/OpenRA.Game/Graphics/Util.ts` | 558 | 511 | Yes |
| A2 | `src/OpenRA.Game/Graphics/Palette.ts` | 477 | 381 | Yes |
| A3 | `src/OpenRA.Game/Graphics/PaletteReference.ts` | 91 | 89 | Yes |
| A4 | `src/OpenRA.Game/Primitives/Color.ts` | 272 | 319 | Yes |

> **Note**: Files A1–A4 were migrated alongside Section 3.7 as dependencies/enablers. They are not tracked in the original 27-item migration plan but are now fully implemented with tests.

#### NOP Stubs (Intentional Omissions — Documented)

These files are retained to preserve directory structure parity with OpenRA but contain no migrated code. Each file documents why migration is unnecessary (browser APIs / Babylon.js replace the functionality).

| # | File | Lines | Reason |
|:---:|:---|:---:|:---|
| N1 | `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | 29 | Babylon.js Engine auto-creates WebGL 2.0 context |
| N2 | `src/OpenRA.Platforms.Default/Sdl2PlatformWindow.ts` | 27 | HTMLCanvasElement + Fullscreen API |
| N3 | `src/OpenRA.Platforms.Default/Sdl2Input.ts` | 29 | DeviceSourceManager + Observable |
| N4 | `src/OpenRA.Platforms.Default/Sdl2HardwareCursor.ts` | 28 | CSS `cursor: url(...)` |
| N5 | `src/OpenRA.Platforms.Default/DefaultPlatform.ts` | 4 | Browser platform detection |
| N6 | `src/OpenRA.Platforms.Default/ThreadAffine.ts` | 19 | Web Worker model (no shared memory) |
| N7 | `src/OpenRA.Platforms.Default/OpenGL.ts` | 26 | Babylon.js thin abstraction layer |
| N8 | `src/glsl/model.vert` | 32 | Babylon.js StandardMaterial handles vertex transforms internally |
| N9 | `src/glsl/model.frag` | 38 | Babylon.js PBRMaterial provides built-in PBR lighting pipeline |

> **Note**: N1-N7 replace SDL2 and OpenGL-specific platform code. N1 is item #22 in the 27-item plan. N2-N7 are beyond the 27-item plan. N8-N9 are model shaders with full @nop documentation, replacing custom GLSL with Babylon.js StandardMaterial/PBRMaterial.

#### Remaining Pending Stubs (Post-Chapter 2 Deferred)

No remaining stubs in the original 27-item migration plan. All 27 items are resolved.

> Note: Stub files in `OpenRA.Game/Graphics/` (~16 files: AnimationWithOffset, ChromeProvider, CursorSequence, etc.) and `OpenRA.Platforms.Default/` (~5 files: audio, font stubs) are beyond Chapter 2 scope and will be addressed in subsequent chapters. Model shaders (model.vert: 32 lines, model.frag: 38 lines) are now documented NOP stubs with full @nop annotations — see NOP stubs table below.

---

## By OpenRA Module

| OpenRA Module | Total Files | Done | Stubs | Empty Dirs |
|---------------|:-----------:|:----:|:-----:|:----------:|
| `OpenRA.Game/Graphics/` | 37 | 20 | 17 | 0 |
| `OpenRA.Game/` (root) | 3 | 3 | 0 | 0 |
| `OpenRA.Game/Primitives/` | 1 | 1 | 0 | 0 |
| `OpenRA.Platforms.Default/` | 18 | 6 | 12 | 0 |
| `glsl/` | 12 | 10 | 0 + 2 NOP | 0 |
| `OpenRA.Game/Traits/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Activities/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Network/` | 0 | 0 | 0 | All |
| `OpenRA.Game/FileSystem/` | 5 | 5 | 0 | 0 |
| `OpenRA.Game/Widgets/` | 3 | 3 | 0 | COMPLETE (Phase D) |
| `OpenRA.Game/Map/` | 23 | 23 | 0 | 0 |
| `OpenRA.Mods.Common/Pathfinder/` | 10 | 10 | 0 | 0 |
| `OpenRA.Mods.Common/Traits/` | 3 | 3 | 0 | 0 |
| `OpenRA.Mods.Common/Widgets/` | 0 | 0 | 0 | Chapter 5 Phase E (pending, now unblocked) |
| `OpenRA.Mods.Cnc/FileSystem/` | 5 | 5 | 0 | COMPLETE (Phase B, 108 tests) |
| `utils/` | 1 | 1 | 0 | 0 |
| Other modules | 0 | 0 | 0 | All |

---

## Test Infrastructure

| Test Type | Framework | Files | Status |
|-----------|-----------|:-----:|--------|
| Unit tests | Vitest + happy-dom | 27 test files | 23 pass, 3 with failures, 1 pending |
| E2E tests | Playwright | 0 | Not yet configured |

### Existing Test Files

| Test File | Lines | Test Cases | Status |
|-----------|:-----:|:----------:|--------|
| `src/OpenRA.Game/Renderer.test.ts` | 928 | 91 | Passing |
| `src/OpenRA.Game/Graphics/WorldRenderer.test.ts` | 1104 | 74 | Passing |
| `src/OpenRA.Game/Graphics/SpriteRenderer.test.ts` | 679 | 55 | Passing |
| `src/OpenRA.Game/Graphics/RgbaColorRenderer.test.ts` | 858 | 68 | Passing |
| `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.test.ts` | 462 | — | Pending |
| `src/OpenRA.Game/Graphics/PlatformInterfaces.test.ts` | 118 | — | Passing |
| `src/OpenRA.Game/Graphics/ShaderBindings.test.ts` | 205 | — | Passing |
| `src/OpenRA.Game/Graphics/Vertex.test.ts` | 413 | — | Passing |
| `src/OpenRA.Platforms.Default/Shader.test.ts` | 572 | — | Passing |
| `src/OpenRA.Platforms.Default/FrameBuffer.test.ts` | 649 | 58 | Passing |
| `src/OpenRA.Platforms.Default/Texture.test.ts` | 485 | 61 (shared) | Passing |
| `src/OpenRA.Platforms.Default/VertexBuffer.test.ts` | 341 | 61 (shared) | Passing |
| `src/OpenRA.Platforms.Default/StaticIndexBuffer.test.ts` | 149 | 61 (shared) | Passing |
| `src/OpenRA.Game/Graphics/Sprite.test.ts` | 268 | — | Passing |
| `src/OpenRA.Game/Graphics/Sheet.test.ts` | 351 | — | Failures (3) |
| `src/OpenRA.Game/Graphics/SheetBuilder.test.ts` | 367 | — | Passing |
| `src/OpenRA.Game/Graphics/HardwarePalette.test.ts` | 463 | — | Passing |
| `src/OpenRA.Game/Graphics/PlayerColorRemap.test.ts` | 191 | — | Passing |
| `src/OpenRA.Game/Graphics/Animation.test.ts` | 451 | — | Passing |
| `src/OpenRA.Game/Graphics/CursorManager.test.ts` | 288 | — | Passing |
| `src/OpenRA.Game/Graphics/TerrainSpriteLayer.test.ts` | 346 | — | Failures (4) |
| `src/OpenRA.Game/Graphics/Util.test.ts` | 511 | — | Failures (2) |
| `src/OpenRA.Game/Graphics/Palette.test.ts` | 381 | — | Passing |
| `src/OpenRA.Game/Graphics/PaletteReference.test.ts` | 89 | — | Passing |
| `src/OpenRA.Game/Primitives/Color.test.ts` | 319 | — | Passing |
| `src/utils/math.test.ts` | — | — | Passing |
| `src/counter.test.ts` | — | — | Passing |

> **Note**: 3 test files have failures (Sheet.test.ts: 3, TerrainSpriteLayer.test.ts: 4, Util.test.ts: 2). These are recorded as post-migration fixes needed.

---

## Recent Completions

| Date | File | Developer | Reviewer | Notes |
|------|------|-----------|----------|-------|
| 2026-06-12 | **Ch5 Phase D UI Widget Core** (4 files) | migration-develop | migration-review | APPROVED (3 rounds, 0 BLOCKERs remaining): Widget.ts (1062 lines, 104 tests, Widget/ContainerWidget/InputWidget/Ui/ChromeLogic), ChromeMetrics.ts (166 lines, 23 tests, CSS custom property themes), WidgetLoader.ts (470 lines, 43 tests, JSON->Widget tree loader), ChromeProvider.ts (431 lines, 48 tests, CSS border-image skin manager). 2,129 impl + 2,333 test lines, 174 tests. No manual visual tests needed (core widget tree infrastructure). |
| 2026-06-12 | **Ch5 Phase C MOD System Core** (2 files) | migration-develop | migration-review | APPROVED (2 rounds, 0 BLOCKERs): Manifest.ts (506 lines, 72 tests, mod.json parser + dependency validation), ModData.ts (326 lines, 43 tests, ObjectCreator registry + runtime coordinator). 832 impl + 1,296 test lines, 115 tests. No manual visual tests needed (pure infrastructure). |
| 2026-06-12 | **Ch5 Phase B C&C Package Formats** (5 files) | migration-develop | migration-review | APPROVED (3 rounds, 0 BLOCKERs): PackageEntry.ts (332 lines, 30 tests), MixFile.ts (350 lines, 22 tests), BigFile.ts (268 lines, 19 tests), MegFile.ts (282 lines, 17 tests), Pak.ts (240 lines, 18 tests). ~1,472 impl + ~1,653 test lines, 108 tests. MixFile is documentation stub per ADR-5.1. |
| 2026-06-12 | **Ch5 Phase A FileSystem Foundation** (4 files) | migration-develop | migration-review | APPROVED (2 rounds, 0 BLOCKERs): IPackage.ts (188+337 lines, 21 tests), Folder.ts (198+337 lines, 24 tests), ZipFile.ts (371+518 lines, 37 tests), FileSystem.ts (673+769 lines, 50 tests). IReadOnlyPackage.ts refactored to 19-line re-export shim. ~1,430 impl + ~1,961 test lines, 132 tests. Deps: fflate. Commits `c9f6dd3`, `49aa8be`. |
| 2026-06-11 | **Ch4 Phase I CoordinateTransformer** (1 file) | migration-develop | migration-review | APPROVED: CoordinateTransformer.ts (334+509 lines), WPos<->Vector3 conversion, LRU cache, batch Float32Array output. |
| 2026-06-11 | **Ch4 Phase H MiniYAML Pipeline** (1 file) | migration-develop | migration-review | APPROVED: miniyaml-to-json.ts (762+962 lines), recursive descent parser, Vite plugin, build-time YAML->JSON compilation. |
| 2026-06-11 | **Ch4 Phase G Pathfinding System** (13 files) | migration-develop | migration-review | APPROVED (3 BLOCKERs + 5 MAJORs resolved): HierarchicalPathFinder (1524+535), PathSearch (828+724), DensePathGraph (477+443), MapPathGraph (165+259), GridPathGraph (137+380), SparsePathGraph (104+150), IPathGraph (216+163), CellInfo (166+132), Grid (237+210), CellInfoLayerPool (176+182), BlockedByActor (39+71), ICustomMovementLayer (69), Locomotor (261+221). ~4,399 impl + ~3,470 test lines, 190 tests. HPA* + A* + 4 path graph impls. |
| 2026-06-11 | **Phase F 3D Terrain Mesh Generation** (2 files) | migration-develop | migration-review | APPROVED (2 rounds, 0 BLOCKERs): TerrainMeshBuilder.ts (713+739 lines, 32 tests), TerrainMaterial.ts (454+284 lines, 11 tests). ~1167 impl + ~1023 test lines, 43 tests. E2E acceptance test page at `src/__e2e__/manual/terrain-mesh/basic/`. Commits `9cbd7cc`, `ebdd5f6`, `2bb5009`. |
| 2026-06-11 | **Phase E Map Support Files** (7 files) | migration-develop | migration-review | APPROVED: MapCache.ts (816+465, 30 tests), MapPlayers.ts (241+266, 12 tests), MapDirectoryTracker.ts (271+291, 15 tests), MapGenerationArgs.ts (84+156, 8 tests), PlayerReference.ts (163+165, 15 tests), TileReference.ts (103+83, 8 tests), MapPreview.ts stub (241), IReadOnlyPackage.ts stub (78). ~940 impl + ~1030 test lines, 96 tests. Commits `8c49914`, `92c8a33`, `f8a0664`, `e53b66f`. |
| 2026-06-11 | **Phase D Map Core** (2 files) | migration-develop | migration-review | APPROVED: Map.ts (1699+1409, 30+ tests), MapBinParser.ts (325+290, 8 tests). ~2024 impl + ~1699 test lines. Binary map.bin parser, ZIP extraction, coordinate methods, CellLayer data planes. Commit `8c49914`. |
| 2026-06-08 | **SpriteRenderer.ts fix** | migration-develop | migration-review | APPROVED: Resolved 5 issues (3 BLOCKER + 2 MAJOR) from lessons-learned audit. BLOCKER #1: CreatePlane->CreateGround, removed billboardMode. BLOCKER #2: Added emissiveTexture + emissiveColor for disableLighting. MAJOR #4: ToRef matrix variants + pre-allocated buffers for zero GC. MAJOR #5: alwaysSelectAsActiveMesh=true for frustum culling. Rotation: Z->Y axis for XZ ground plane. Commit `e96bc06`. |
| 2026-06-08 | **Renderer.ts fix** | migration-develop | migration-review | APPROVED: Resolved 2 issues (1 BLOCKER + 1 MAJOR). BLOCKER #3: try-catch in render loop callback to prevent silent death. MAJOR #6: Added emissiveTexture to world quad material. Commit `623cb4f`. |
| 2026-06-04 | **Chapter 4 Phase C TerrainInfo** (1 file) | migration-develop | migration-review | APPROVED (2 rounds, 0 BLOCKERs): TerrainInfo.ts (814 lines, TerrainTypeInfo + TerrainTileInfo + TileSet), 93 tests, 1205 test lines. Paradigm: C# ulong bits -> Int8Array, BitSet -> Set<string>, FrozenDictionary -> Map, MiniYAML -> JSON. Chapter 4: 12/34 (35%). |
| 2026-06-04 | **Chapter 4 Phase B MapGrid** (2+2 files) | migration-develop | migration-review | APPROVED (1 Architect WR round, 5 BLOCKERs resolved): MapGrid.ts (436 line), CellRamp.ts (238 lines extracted), Exts.ts isqrtCeiling (+19), CVec.ts hashCode (+18). 138 tests total (39 CellRamp + 49 MapGrid + 10 Exts + 40 CVec). ~674 impl + ~843 test lines. Chapter 4: 11/34 (32%). |
| 2026-06-04 | **Chapter 4 Phase A CellLayer** (8 files) | migration-develop | migration-review | APPROVED (2 rounds, 0 BLOCKERs): CellLayerBase.ts, CellLayer.ts, CellRegion.ts, ProjectedCellLayer.ts, ProjectedCellRegion.ts, CellCoordsRegion.ts, MapCoordsRegion.ts, Size.ts. 195/195 tests, ~3,826 total lines. Chapter 4: 8/34 (24%). |
| 2026-06-04 | **Phase I ScreenMap** (1 file) | migration-develop | migration-review | Round 1 approved: ScreenMap.ts (~350 lines, spatial hash grid, rectangle/point queries, 2D-to-3D dual approach -- CPU spatial index for deterministic selection + GPU ray-picking for hover). Chapter 3 COMPLETE (36/36, 100%). |
| 2026-06-04 | **Phase H Effects** (3 files) | migration-develop | migration-review | Round 1 approved, 103 tests: IEffect.ts (165 lines, tick/render interface), DelayedAction.ts (144 lines, deferred callback), DelayedImpact.ts (212 lines, projectile position interpolation). 521 TS + 687 test lines. 0 BLOCKERs |
| 2026-06-04 | **Phase G Player** (1 file) | migration-develop | migration-review | Round 1 approved, 82 tests: Player.ts (1272 lines), LongBitSet diplomacy (O(1) bitwise), PlayerActor two-phase init, WinState immutability guard, FactionInfo resolution, relationship coloring, PlayerStub compatibility, stubs for unmigrated deps (Shroud, FrozenActorLayer, Session.Client). 0 BLOCKERs |
| 2026-06-04 | **Phase F Activity System** (3 files) | migration-develop | migration-review | Round 2 approved, 73 tests: Activity.ts (~722 lines, activity state machine, TickOuter, child activity priority, cancellation, linked-list chain), CallFunc.ts (~90 lines, 15 tests, one-shot callback activity), ActivityUtils.ts (~87 lines, 8 tests, activity composition helpers). 0 BLOCKERs |
| 2026-06-04 | **Phase E ActorConfig** (1 file) | migration-develop | migration-review | Round 2 approved, 64 tests: ActorInfo.ts (~916 lines, ActorConfig class, trait composition from JSON, TraitConfig interface, YAML-to-JSON pipeline design, Object.freeze() immutability, topological sort for trait dependencies). 0 BLOCKERs |
| 2026-06-04 | **Phase D GameActor** (1 file) | migration-develop | migration-review | Round 2 approved, 91 tests: Actor.ts (~1840 lines, GameActor extends TransformNode, component system, condition system, activity integration, lifecycle state machine, cached trait references, ResolveOrder, SyncHash placeholder). 0 BLOCKERs |
| 2026-06-04 | **Phase C GameWorldManager** (1 file) | migration-develop | migration-review | Round 2 approved, 66 tests: World.ts (~1903 lines, GameWorldManager class, fixed timestep loop, tick execution order, actor lifecycle, player management, WorldActor, pause state, SyncHash placeholder). 0 BLOCKERs |
| 2026-06-04 | **Phase B Trait System Core** (2 files) | migration-develop | migration-review | Round 2 approved, 149 tests: TraitsInterfaces.ts (~1930 lines, 92 tests, 45+ interfaces, 22 type guards), TraitDictionary.ts (~450 lines, 57 tests, 8 query methods). ~2380 TS + 149 test lines total |
| 2026-06-04 | **Phase A 3.1.2 + 3.1.3 Map Coords + Primitives** (11 files) | migration-develop | migration-review | 1 round, 0 BLOCKERs, 1219 tests: MPos, CPos, CVec, Target, BitSet, LongBitSet, TypeDictionary, SpatiallyPartitioned, PriorityQueue, Cache, CachedTransform, ActionQueue. ~2700 TS + ~2500 test lines total (Phase A) |
| 2026-06-04 | **Phase A 3.1.1 World Coordinate Types** (7 files) | migration-develop | migration-review | Round 2 approved, 191 tests pass: WPos(180+24), WVec(230+35), WAngle(270+54), WDist(170+32), WRot(310+32), Int32Matrix4x4(120+5), Exts(48+10) |
| 2026-06-03 | **Chapter 2 FINALIZED** | migration-docs | — | 27/27 (100%), 24+2+1 resolved, ~14,400+ impl lines, ~10,800+ test lines, 27 test files |
| 2026-06-03 | Platform Abstraction (Section 3.8) — 11 files | migration-develop | migration-review | 3 review rounds, 1068 lines impl, 61 tests, 7 NOP stubs, core wrappers + SDL2 removal |
| 2026-06-03 | Sprite & Texture System (Section 3.7) — 12 files | migration-develop | migration-review | 2 review rounds, ~4900 lines impl, 12 test files, 252 new tests, Palette + Sprite/Sheet + Animation + TerrainLayer |
| 2026-06-03 | FrameBuffer & Post-Processing (Section 3.6) | migration-develop | migration-review | 2 review rounds, 58 tests, 8 GLSL shaders, RTT + DefaultRenderingPipeline |
| 2026-06-03 | Shader/Material System (6 files) | migration-develop | migration-review | 2 review rounds, 142 new tests, ShaderMaterial + GLSL |
| 2026-06-03 | RgbaColorRenderer.ts | migration-develop | migration-review | 3 review rounds, 68 test cases, dynamic Mesh + ShaderMaterial |
| 2026-06-03 | SpriteRenderer.ts | migration-develop | Pending | 55 test cases, ThinInstances backend |
| ~2026-06-02 | WorldRenderer.ts | migration-develop | migration-review | Reviewed, fixes applied |
| ~2026-06-01 | Renderer.ts | migration-develop | migration-review | Reviewed, 89 tests |

---

## Dependency Graph & Unblocked Items

### Chapter 2 Complete

All 27 migration plan items are now resolved. The rendering pipeline is fully operational:
- **Core rendering**: Renderer.ts, WorldRenderer.ts, SpriteRenderer.ts, RgbaColorRenderer.ts, RgbaSpriteRenderer.ts
- **Shader system**: Shader.ts, ShaderBindings.ts, Vertex.ts, PlatformInterfaces.ts, + GLSL shaders
- **Frame buffer**: FrameBuffer.ts + 8 postprocess shaders
- **Sprite & texture**: Sprite.ts, Sheet.ts, SheetBuilder.ts, HardwarePalette.ts, PlayerColorRemap.ts, Animation.ts, CursorManager.ts, TerrainSpriteLayer.ts
- **Platform layer**: Texture.ts, VertexBuffer.ts, StaticIndexBuffer.ts, ITextureInternal.ts + 9 NOP stubs (7 SDL2 + 2 model shaders)
- **Extra enablers**: Palette.ts, PaletteReference.ts, Util.ts, Color.ts

### Post-Chapter 2 Deferred Items

| Priority | Item | Reason |
|:--------:|------|--------|
| MEDIUM | `TODO-2.6.6` 移动端优化 | 合并渲染模式减少中间缓冲，待移动端适配阶段实施 |
| MEDIUM | E2E 测试 | Playwright 基础设施未搭建，当前仅单元测试覆盖 |
| LOW | Remaining Graphics/ stubs (~16 files) | Beyond Chapter 2 scope — AnimationWithOffset, ChromeProvider, CursorSequence, etc. |

### Remaining Stubs (Beyond Chapter 2)

| Directory | Approx. Count | Status |
|-----------|:---:|--------|
| `OpenRA.Game/Graphics/` | ~16 files | Placeholder stubs (AnimationWithOffset, ChromeProvider, CursorSequence, etc.) |
| `OpenRA.Platforms.Default/` | ~5 files | Audio/font stubs (DummySoundEngine, OpenAlSoundEngine, FreeTypeFont, etc.) |
| `OpenRA.Game/Traits/`, `Network/`, etc. | Empty dirs | Future chapters |

---

## Chapter 3: Game World & Actor System Progress

> **Migration Plan**: [docs/actor_system_migration_plan.md](docs/actor_system_migration_plan.md)
> **Created**: 2026-06-04 | **Updated**: 2026-06-04 (Phase H complete)
> **Status**: IMPLEMENTATION PHASE (35/36 files migrated, 32 in-scope + 5 support)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 36 | 100% |
| In Progress | 0 | 0% |
| Pending | 0 | 0% |
| **Total planned** | **36** | **100%** |
| **In-scope** | **29** (28 Phases A-H + 1 Phase I) | |
| **Deferrable** | **2** (Phase J: Weapon system) | |
| **Support** | **5** (migrate as needed) | |

### Phase A: Coordinate System & Primitives (17 files, Foundation) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Lines (C#) | Status |
|:---:|:---|:---|:---:|:---:|:---:|
| A1 | `MPos.cs` | `src/OpenRA.Game/MPos.ts` | Low | 94 | ✅ Completed |
| A2 | `CPos.cs` | `src/OpenRA.Game/CPos.ts` | Low | 148 | ✅ Completed |
| A3 | `CVec.cs` | `src/OpenRA.Game/CVec.ts` | Low | 147 | ✅ Completed |
| A4 | `WPos.cs` | `src/OpenRA.Game/WPos.ts` | Low | 180 (24 tests) | ✅ Completed |
| A5 | `WVec.cs` | `src/OpenRA.Game/WVec.ts` | Low | 230 (35 tests) | ✅ Completed |
| A6 | `WAngle.cs` | `src/OpenRA.Game/WAngle.ts` | Medium | 270 (54 tests) | ✅ Completed |
| A7 | `WDist.cs` | `src/OpenRA.Game/WDist.ts` | Low | 170 (32 tests) | ✅ Completed |
| A8 | `WRot.cs` | `src/OpenRA.Game/WRot.ts` | Medium | 310 (32 tests) | ✅ Completed |
| A9 | `BitSet.cs` | `src/OpenRA.Game/Primitives/BitSet.ts` | Low | 171 | ✅ Completed |
| A10 | `LongBitSet.cs` | `src/OpenRA.Game/Primitives/LongBitSet.ts` | Medium | 189 | ✅ Completed |
| A11 | `TypeDictionary.cs` | `src/OpenRA.Game/Primitives/TypeDictionary.ts` | Medium | 183 | ✅ Completed |
| A12 | `SpatiallyPartitioned.cs` | `src/OpenRA.Game/Primitives/SpatiallyPartitioned.ts` | Medium | 169 | ✅ Completed |
| A13 | `PriorityQueue.cs` | `src/OpenRA.Game/Primitives/PriorityQueue.ts` | Low | 159 | ✅ Completed |
| A14 | `Cache.cs` | `src/OpenRA.Game/Primitives/Cache.ts` | Low | 50 | ✅ Completed |
| A15 | `CachedTransform.cs` | `src/OpenRA.Game/Primitives/CachedTransform.ts` | Low | 41 | ✅ Completed |
| A16 | `ActionQueue.cs` | `src/OpenRA.Game/Primitives/ActionQueue.ts` | Low | 93 | ✅ Completed |
| A17 | `Target.cs` | `src/OpenRA.Game/Traits/Target.ts` | Medium | 295 | ✅ Completed |

#### Additional Migrated Files (Beyond 17-Item Phase A Plan)

| # | File | Lines (impl) | Lines (test) | Note |
|:---:|:---|:---:|:---:|:---|
| A+1 | `src/OpenRA.Game/Int32Matrix4x4.ts` | 120 | 5 | Required by WRot.ts for 3D rotation matrix representation |

### Phase B: Trait System Core (2 files) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Lines (C#) | Status |
|:---:|:---|:---|:---:|:---:|:---:|
| B1 | `TraitDictionary.cs` | `src/OpenRA.Game/TraitDictionary.ts` | Medium | 450 (57 tests) | ✅ Completed |
| B2 | `TraitsInterfaces.cs` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Medium | 1930 (92 tests) | ✅ Completed |

### Phases C-D: World + Actor (2 files, Core Containers) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Lines (C#) | Status |
|:---:|:---|:---|:---:|:---:|:---:|
| C | `World.cs` | `src/OpenRA.Game/World.ts` | HIGH | 1903 (66 tests) | ✅ Completed |
| D | `Actor.cs` | `src/OpenRA.Game/Actor.ts` | HIGH | 1840 (91 tests) | ✅ Completed |

### Phase E: ActorInfo (1 file, Actor Metadata) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Lines (C#) | Status |
|:---:|:---|:---|:---:|:---:|:---:|
| E | `ActorInfo.cs` | `src/OpenRA.Game/GameRules/ActorInfo.ts` | Medium | 916 (64 tests) | ✅ Completed |

### Phase F: Activity System (2 files + 1 support) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Lines (TS) | Status |
|:---:|:---|:---|:---:|:---|:---:|
| F1 | `Activity.cs` | `src/OpenRA.Game/Activities/Activity.ts` | HIGH | 722 (50 tests) | ✅ Completed |
| F2 | `CallFunc.cs` | `src/OpenRA.Game/Activities/CallFunc.ts` | Low | 90 (15 tests) | ✅ Completed |
| S5 | `ActivityUtils.cs` | `src/OpenRA.Game/Traits/ActivityUtils.ts` | Low | 87 (8 tests) | ✅ Completed |

**Implementation**: ~899 lines TS + ~1051 lines test, 73 tests total. Activity state machine with linked-list chain + child activity priority. TickOuter: "near-perfect line-for-line" per reviewer. ActivityUtils.ts (support file S5) migrated as dependency.
**Review**: 2 rounds, 0 BLOCKERs | **Date**: 2026-06-04

### Phase G: Player System (1 file) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Lines (TS) | Status |
|:---:|:---|:---|:---:|:---|:---:|
| G | `Player.cs` | `src/OpenRA.Game/Player.ts` | Low | 1272 (82 tests) | ✅ Completed |

**Implementation**: ~1272 lines TS + ~1407 lines test, 82 tests total. LongBitSet<PlayerBitMask> diplomacy with O(1) bitwise queries. PlayerActor two-phase init pattern. WinState immutability guard (Won/Lost cannot revert). ResolveFaction with Random resolution (max 10 iterations). PlayerRelationshipColor with ChromeMetrics stubs. FactionInfo/Shroud/FrozenActorLayer/Session.Client stub interfaces for unmigrated dependencies.
**Review**: 1 round, 0 BLOCKERs | **Date**: 2026-06-04

### Phase H: Effects System (3 files) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Status |
|:---:|:---|:---|:---:|:---:|
| H1 | `IEffect.cs` | `src/OpenRA.Game/Effects/IEffect.ts` | Low | ✅ Completed |
| H2 | `DelayedAction.cs` | `src/OpenRA.Game/Effects/DelayedAction.ts` | Low | ✅ Completed |
| H3 | `DelayedImpact.cs` | `src/OpenRA.Game/Effects/DelayedImpact.ts` | Low | ✅ Completed |

**Implementation**: ~521 lines TS (IEffect: 165, DelayedAction: 144, DelayedImpact: 212) + ~687 lines test (103 tests). IEffect interface with tick/render lifecycle. DelayedAction defers callback by tick count. DelayedImpact interpolates projectile position toward target.
**Review**: 1 round, 0 BLOCKERs | **Date**: 2026-06-04

### Phase I: Spatial Query (ScreenMap) (1 file) ✅ COMPLETE (2026-06-04)

| # | Source | Target | Complexity | Status |
|:---:|:---|:---|:---:|:---:|
| I | `ScreenMap.cs` | `src/OpenRA.Game/Traits/World/ScreenMap.ts` | Medium | ✅ Completed |

### Phase J: Weapon System (2 files, DEFERRABLE)

| # | Source | Target | Complexity | Status |
|:---:|:---|:---|:---:|:---:|
| J1 | `WeaponInfo.cs` | `src/OpenRA.Game/GameRules/WeaponInfo.ts` | Medium | Deferred |
| J2 | `Ruleset.cs` | `src/OpenRA.Game/GameRules/Ruleset.ts` | Low | Deferred |

### Support Files (5, migrate as needed)

| # | Source | Target | Lines (C#) | Status |
|:---:|:---|:---|:---:|:---:|
| S1 | `Sync.cs` | `src/OpenRA.Game/Sync.ts` | 212 | Support |
| S2 | `Exts.cs` | `src/OpenRA.Game/Exts.ts` | 680 (48 TS + 10 tests) | ✅ Completed |
| S3 | `WorldUtils.cs` | `src/OpenRA.Game/WorldUtils.ts` | 112 | Support |
| S4 | `GameSpeed.cs` | `src/OpenRA.Game/GameSpeed.ts` | 62 | Support |
| S5 | `ActivityUtils.cs` | `src/OpenRA.Game/Traits/ActivityUtils.ts` | 39 (87 TS + 8 tests) | ✅ Completed |

### Chapter 3 Dependency Graph

```
Phase A (17 files) <-- FOUNDATION, no internal deps
  |
  +--> Phase B (TraitsInterfaces, TraitDictionary)
        |
        +--> Phase C (World) --> Phase D (Actor)
              |
              +--> Phase E (ActorInfo), Phase F (Activity), Phase G (Player)
              +--> Phase H (Effects), Phase I (ScreenMap)
              +--> Phase J (Weapon) [DEFERRED]
```

### Chapter 3 Dependencies on Chapter 2

- Renderer.ts (Engine.runRenderLoop()) -- Phase C tick loop
- WorldRenderer.ts (BABYLON.Scene) -- Phase C GameWorldManager
- ShaderMaterial system -- Future trait rendering
- Sprite & Texture system -- Future visual effects

### Phase Strategy

| Phase | Files | Complexity | Est. Weeks | Depends On |
|-------|:---:|:---|:---:|-----------|
| A: Coordinates & Primitives | 17 | Low-Medium | 1-2 | Nothing |
| B: Trait System Core | 2 | Medium | 1 | Phase A |
| C+D: World + Actor | 2 | HIGH | 2 | Phases A, B |
| E: ActorInfo | 1 | Medium | 0.5 | Phase A, B |
| F: Activity | 2 | HIGH | 1 | Phase A, D |
| G: Player | 1 | Low | 0.5 | Phase A, D |
| H: Effects | 3 | Low | 0.5 | Phase C |
| I: ScreenMap | 1 | Medium | 0.5 | Phase A, D |
| J: Weapon System | 2 | Medium | DEFERRED | — |

**Total estimated**: 7-8 weeks (2 devs) or 4-5 weeks (4 devs)

---

## Verification Notes (2026-06-03)

Chapter 2 (Rendering Engine) is now complete at 27/27 (100%):

- **Migration plan accuracy**: All 8 sections (3.1–3.8) completed. All 27 mapping table items resolved: 24 completed with tests, 2 completed without tests, 1 NOP stub.
- **RgbaSpriteRenderer.ts**: Fully implemented (161 lines implementation + 462 lines test). Thin validation wrapper around SpriteRenderer; validates RGBA texture channel before delegating.
- **Model shaders**: model.vert (32 lines) and model.frag (38 lines) converted to fully-documented NOP stubs with @nop annotations, explaining StandardMaterial/PBRMaterial replacement.
- **Section 3.8 completion**: Platform abstraction layer fully migrated. 3 core wrapper files with 61 shared tests. 1 interface file (ITextureInternal.ts: 49 lines). 7 SDL2/platform files converted to NOP stubs.
- **RenderPostProcessPassVertex.ts**: Implemented (142 lines), no test file.
- **Additional files**: 4 extra files beyond the 27-item plan — Util (558 lines), Palette (477 lines), PaletteReference (91 lines), Color (272 lines). Total: ~1,398 extra implementation lines.
- **NOP stubs**: 9 total — 7 SDL2/platform files + 2 model shaders (model.vert, model.frag), all with full documentation explaining browser/Babylon.js API alternatives.
- **Stub files**: ~16 files in `OpenRA.Game/Graphics/` and ~5 in `OpenRA.Platforms.Default/` remain as 4-line placeholder stubs (beyond Chapter 2 scope).
- **Empty directories**: `Activities/`, `FileSystem/`, `Map/`, `Network/`, `Orders/`, `Scripting/`, `Sound/`, `Traits/`, `Widgets/` — future chapters.
- **Test coverage**: 27 test files exist. 3 test files with known issues (Sheet.test.ts: 3, TerrainSpriteLayer.test.ts: 4, Util.test.ts: 2). No E2E test infrastructure.
- **GLSL files**: 10 shader files fully migrated (WebGL 2.0 / GLSL ES 3.0). 2 model shaders as documented NOP stubs.
- **No missing files**: All 27 items in the migration plan's mapping table have corresponding entries in `src/`.

---

## Chapter 3 Completion Notes (2026-06-04)

Chapter 3 (Game World & Actor System) is now complete at 36/36 (100%):

- **Phase A (17 files)**: All coordinate types (WPos, WVec, WAngle, WDist, WRot, MPos, CPos, CVec) and primitives (BitSet, LongBitSet, TypeDictionary, SpatiallyPartitioned, PriorityQueue, Cache, CachedTransform, ActionQueue, Target) migrated with full test coverage. ~2700 TS + ~2500 test lines, 1219 tests. Plus 1 extra file (Int32Matrix4x4.ts). 2 review rounds, 0 BLOCKERs.
- **Phase B (2 files)**: TraitsInterfaces.ts (~1930 lines, 45+ interfaces, 22 type guards) + TraitDictionary.ts (~450 lines, 8 query methods). 149 tests. 2 review rounds, 0 BLOCKERs.
- **Phase C (1 file)**: World.ts (~1903 lines, GameWorldManager, fixed timestep loop, tick execution order, actor lifecycle). 66 tests. 2 review rounds, 0 BLOCKERs.
- **Phase D (1 file)**: Actor.ts (~1840 lines, GameActor extends TransformNode, component system, condition system, lifecycle state machine). 91 tests. 2 review rounds, 0 BLOCKERs.
- **Phase E (1 file)**: ActorInfo.ts (~916 lines, ActorConfig, trait composition from JSON, topological sort). 64 tests. 2 review rounds, 0 BLOCKERs.
- **Phase F (3 files)**: Activity.ts (~722 lines), CallFunc.ts (~90 lines), ActivityUtils.ts (~87 lines). 73 tests total. 2 review rounds, 0 BLOCKERs.
- **Phase G (1 file)**: Player.ts (~1272 lines, diplomacy, PlayerActor, LongBitSet O(1) queries). 82 tests. 1 review round, 0 BLOCKERs.
- **Phase H (3 files)**: IEffect.ts (165 lines), DelayedAction.ts (144 lines), DelayedImpact.ts (212 lines). 103 tests total. 1 review round, 0 BLOCKERs.
- **Phase I (1 file)**: ScreenMap.ts (~350 lines, spatial hash grid, rectangle/point queries, dual GPU+CPU approach). ~250 test lines. 1 review round, 0 BLOCKERs.
- **Support files (2 of 5 migrated)**: Exts.ts (48 lines + 10 tests), ActivityUtils.ts (87 lines + 8 tests, part of Phase F).
- **Deferrable (Phase J, 2 files)**: WeaponInfo.ts + Ruleset.ts deferred to future chapter (requires full trait ecosystem from mod system).
- **Total Chapter 3 code**: ~13,000+ TS implementation lines + ~10,000+ test lines across 36 files.
- **All review rounds**: 15+ rounds across 9 phases, 0 BLOCKERs total.
- **Remaining support files**: Sync.ts, WorldUtils.ts, GameSpeed.ts (deferred to respective chapters).

---

## Chapter 4: Map & Terrain System (ALL PHASES COMPLETE)

> **Migration Plan**: [docs/map_system_migration_plan.md](docs/map_system_migration_plan.md)
> **Created**: 2026-06-04 | **Updated**: 2026-06-11 | **Status**: ALL PHASES COMPLETE (37/37 migrated, 100%), Phases A-I complete
> **Prerequisite**: Chapter 3 (Actor System) -- COMPLETE (36/36, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 37 | 100% |
| Pending | 0 | 0% |
| **Total** | **37** | **100%** |
| **From OpenRA** | **32** (29 originally planned + 3 dependency files) | |
| **New files (no OpenRA equivalent)** | **5** | |
| **Deferrable** | **3** (MapPreview stub, ActorInit, ActorRef) | |

### Chapter 4 Phases

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | CellLayer Infrastructure | 8 | Low-Medium | COMPLETE (8/8, 195 tests) |
| Phase B | MapGrid + CellRamp Geometry | 2 (+1 done) | HIGH | COMPLETE (2/2, 138 tests) |
| Phase C | TerrainInfo / TileSet | 1 | Medium | COMPLETE (1/1, 93 tests) |
| Phase D | Map.cs Core Container | 2 | HIGH | COMPLETE (2/2, 30+ tests) |
| Phase E | Map Support Files | 7 (+2 stubs) | Low-Medium | COMPLETE (7/7, 96 tests) |
| Phase F | 3D Terrain Mesh Generation | 2 (new) | HIGH | COMPLETE (2/2, 43 tests) |
| Phase G | Pathfinding System (A* + HPA*) | 13 (10 + 3 dep) | HIGH | COMPLETE (13/13, 190 tests) |
| Phase H | MiniYAML Preprocessing Pipeline | 1 (new) | HIGH | COMPLETE (1/1) |
| Phase I | CoordinateTransformer Utility | 1 (new) | Medium | COMPLETE (1/1) |

### Already Available (from Chapter 3 Phase A)

- CPos.ts, MPos.ts, WPos.ts, WVec.ts, WAngle.ts, WDist.ts, WRot.ts, CVec.ts (hashCode added)
- Exts.ts (isqrtCeiling added)
- MapGridType.ts (with test)
- PriorityQueue.ts, Cache.ts, SpatiallyPartitioned.ts, BitSet.ts

### Phase A Completed: CellLayer Infrastructure (8 files, 2026-06-04)

See map_system_migration_plan.md Section 3.1 for full details. 2,857 lines implementation + 969 lines test. 2 review rounds, 0 BLOCKERs.

### Phase B Completed: MapGrid + CellRamp Geometry (2 files + 2 updated, 2026-06-04)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| MapGrid.ts | 436 | 491 | 49 | grid config, subCellOffsets, tilesByDistance, 21 ramps |
| CellRamp.ts | 238 | 352 | 39 | extracted: RampCornerHeight, RampSplit, heightOffset(), WRot orientation |
| Exts.ts (updated) | 67 (+19) | 41 (+10) | 10 | isqrtCeiling() for OpenRA ISqrt(Ceiling) |
| CVec.ts (updated) | 271 (+18) | 34 (+40) | 40 | hashCode() for deterministic sort tiebreaker |
| **Total** | **~674** (new) | **~843** | **138** | |

**Implementation details**:
- 21 CellRamp shapes (correct count; doc previously stated 20)
- Barycentric heightOffset() with `Math.trunc()` for C#-compatible truncation
- `Exts.isqrtCeiling()` replaces OpenRA `ISqrt(ISqrtRoundMode.Ceiling)`
- `CVec.hashCode()` deterministic tiebreaker for `tilesByDistance` sort
- Architect WR: CellRamp extracted to separate file with RampCornerHeight/RampSplit enums
- 1 review round (Architect WR), 5 BLOCKERs resolved, 0 remaining

### Phase C Completed: TerrainInfo / TileSet (1 file, 2026-06-04)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| TerrainInfo.ts | 814 | 1205 | 93 | TerrainTypeInfo, TerrainTileInfo, TileSet + TileTemplate |
| **Total** | **814** | **1205** | **93** | |

**Implementation details**:
- 3 classes + 1 interface in single file (OpenRA: 197 lines C# -> 814 lines TS)
- `TerrainTypeInfo`: `type`, `targetTypes: Set<string>`, `acceptsSmudgeType: Set<string>`, `color: Color`, static `types` registry, `fromJSON()` factory
- `TerrainTileInfo`: `terrainType`, `height` (0-255), `rampType`, `minColor`/`maxColor`, `riser: Int8Array` (8 directions), `getColor()`, `parseRiser()`
- `TileSet`: `templates`, `tiles`, `terrainTypes` maps; `getTileInfo()`, `getTerrainType()`, `getTerrainIndex()`, `tryGetTileInfo()`, `fromJSON()` factory
- `makeTileKey`: combined `(templateId << 8) | tileIndex` key scheme
- Riser parsing: short-form (`"LU=6"`) and long-form (`"6,6,0,0,0,0,6,6"`) byte-for-byte with OpenRA
- Paradigm: C# `ulong` bits -> `Int8Array`, `BitSet` -> `Set<string>`, `FrozenDictionary` -> `Map<string,T>`, MiniYAML -> JSON
- 2 review rounds, 0 BLOCKERs | **Commit**: `a15bee4`

### Phase D Completed: Map.cs Core Container (2 files, 2026-06-11)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Map.ts | 1699 | 1409 | 30+ | Core map container: grid, mapSize, tiles, resources, height, ramp, customTerrain, projectedCells |
| MapBinParser.ts | 325 | 290 | 8 | Binary map.bin parser: 17-byte header, tile/resource/height data |
| **Total** | **2024** | **1699** | **38+** | |

**Implementation details**:
- `Map` class: full map container with CellLayer-based data planes, coordinate conversion, height at position
- `MapBinParser`: parses OpenRA map.bin format (Uint16LE tile data, optional height byte array)
- `MapLoader.fromOramap()`: ZIP extraction via fflate, delegates to MapBinParser
- `Map.createBlank()`: editor blank map creation
- Coordinate methods: `centerOfCell()`, `cellContaining()`, `heightAt()` with ramp offset
- Review: APPROVED | **Commit**: `8c49914`

### Phase E Completed: Map Support Files (7 files + 2 stubs, 2026-06-11)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| MapCache.ts | 816 | 465 | 30 | Map directory scanner with LRU cache, JSON manifest indexing |
| MapPlayers.ts | 241 | 266 | 12 | Spawn management, player slot validation |
| MapDirectoryTracker.ts | 271 | 291 | 15 | File watcher abstraction, polling manifest with debouncing |
| MapGenerationArgs.ts | 84 | 156 | 8 | Map generation parameters: seed, size, terrain config |
| PlayerReference.ts | 163 | 165 | 15 | Player metadata: name, faction, spawn, color, team |
| TileReference.ts | 103 | 83 | 8 | (TemplateID, TileIndex) pair with makeTileKey() helper |
| MapPreview.ts | 241 | -- | stub | Stub for Chapter 5+ (needs terrain rendering pipeline) |
| IReadOnlyPackage.ts | 78 | -- | stub | Package abstraction interface stub |
| **Total (7 impl + 2 stub)** | **~940** | **~1030** | **96** | |

**Implementation details**:
- All 7 non-deferrable files fully implemented with tests
- MapPreview and IReadOnlyPackage stubbed for future chapters
- ActorReference and ActorInitializer deferred to Chapter 5+ (per ADR-4.7)
- Review: APPROVED | **Commits**: `8c49914`, `92c8a33`, `f8a0664`, `e53b66f`

### Phase F Completed: 3D Terrain Mesh Generation (2 new files, 2026-06-11)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| TerrainMeshBuilder.ts | 713 | 739 | 32 | 3D terrain mesh generation from CellRamp data |
| TerrainMaterial.ts | 454 | 284 | 11 | PBR texture splatting material system |
| **Total** | **1,167** | **1,023** | **43** | |

**Implementation details**:
- `TerrainMeshBuilder`: Per-cell 4-corner vertex generation from height + CellRamp corner offsets. Shared vertices between adjacent cells. Smooth normals via adjacent face averaging. World-space UV for texture tiling. Cliff face quads where Riser non-zero between cells. Both rectangular and isometric grid types supported.
- `TerrainMaterial`: RGBA splat map from TerrainType classification (4 types per cell). Custom ShaderMaterial with vertex shader (world-space UV) and fragment shader (splat-weighted blend + PBR). Fallback StandardMaterial for dev/testing.
- E2E acceptance test page created at `src/__e2e__/manual/terrain-mesh/basic/` (index.html + main.ts + README.md)
- Review: APPROVED (2 rounds, 0 BLOCKERs) | **Commits**: `9cbd7cc`, `ebdd5f6`, `2bb5009`

### Phase G Completed: Pathfinding System (13 files: 10 pathfinder + 3 dep, 2026-06-11)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| HierarchicalPathFinder.ts | 1524 | 535 | -- | HPA* hierarchical two-level search, abstract graph, cluster management |
| PathSearch.ts | 828 | 724 | -- | A* engine: expand, expandAll, findPath, findBidiPath, maxCost cutoff |
| DensePathGraph.ts | 477 | 443 | -- | 8-directional uniform-cost dense path graph |
| MapPathGraph.ts | 165 | 259 | -- | CellLayer-backed path graph with movement cost |
| GridPathGraph.ts | 137 | 380 | -- | Grid boundary dense path graph |
| SparsePathGraph.ts | 104 | 150 | -- | Sparse abstract graph stub |
| IPathGraph.ts | 216 | 163 | -- | Graph edge, connection, and interface definitions |
| CellInfo.ts | 166 | 132 | -- | CellStatus enum + CellInfo data class |
| Grid.ts | 237 | 210 | -- | Grid discretization boundary helper |
| CellInfoLayerPool.ts | 176 | 182 | -- | CellInfo layer object pool for zero-allocation search |
| BlockedByActor.ts | 39 | 71 | -- | BlockedByActor flags enum (Immovable, Mobile, All) |
| ICustomMovementLayer.ts | 69 | -- | -- | Custom movement layer interface |
| Locomotor.ts | 261 | 221 | -- | ILocomotor interface + SimpleLocomotor + WallAwareLocomotor stub |
| **Total** | **~4,399** | **~3,470** | **190** | |

**Implementation details**:
- Full HPA* port (1524 lines HierarchicalPathFinder.ts): cluster-based abstract graph, hierarchical two-level search, dynamic obstacle updates
- A* engine (828 lines PathSearch.ts): priority queue open set, bidirectional search (findBidiPath), maxCost cutoff, reverse search
- Four path graph implementations: DensePathGraph (8-dir uniform), MapPathGraph (CellLayer-backed), GridPathGraph (grid boundaries), SparsePathGraph (sparse abstract)
- CellInfoLayerPool: zero-GC object pooling for CellInfo layers during repeated path searches
- BlockedByActor flags enum for movement blocking classification
- ILocomotor interface + SimpleLocomotor (enter/exit cell) + WallAwareLocomotor stub
- ICustomMovementLayer interface for non-standard movement layers (e.g., tunnels)
- **Review**: 5-dimension review, 3 BLOCKERs + 5 MAJORs resolved, APPROVED
- **Tests**: 190 pathfinding tests all passing

### Phase H Completed: MiniYAML Preprocessing Pipeline (1 new file, 2026-06-11)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| miniyaml-to-json.ts | 762 | 962 | -- | Build-time MiniYAML to JSON converter + Vite plugin |

**Implementation details**:
- Recursive descent parser: @ named nodes (Key@Name), -TraitName removal markers, tab-indentation nesting
- Block scalars, comments, expression variable preservation
- Trait inheritance: parent merge with child override
- Vite plugin integration: auto-rebuild on YAML file change
- Map-specific pipeline: map.yaml -> map.json (metadata, players, actors, rules sections)
- Per ADR-4.2: browser never sees MiniYAML, everything compiled to JSON at build time

### Phase I Completed: CoordinateTransformer Utility (1 new file, 2026-06-11)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| CoordinateTransformer.ts | 334 | 509 | -- | WPos <-> BABYLON.Vector3 conversion with LRU cache |

**Implementation details**:
- `wPosToVector3()`: OpenRA (X,Y,Z) -> Babylon.js (X*scale, Z*heightScale, Y*scale) with worldScale=1/1024
- `cellToVector3WithRamp()`: includes barycentric height from CellRamp corner offsets
- `vector3ToWPos()`: reverse transform for ray-picking
- `cellsToVertices()`: batch Float32Array conversion for mesh generation
- LRU cache (1000 entries) for repeated coordinate lookups
- Both rectangular and isometric grid type support

### Key Architecture Decisions (7 ADRs)

| ADR | Decision |
|-----|----------|
| ADR-4.1 | HPA* port as primary pathfinding; RecastNavigation optional |
| ADR-4.2 | MiniYAML MANDATORY build-time compilation to JSON |
| ADR-4.3 | Custom terrain mesh from CellRamp data (not CreateGroundFromHeightMap) |
| ADR-4.4 | Texture splatting (4 types/cell) via custom ShaderMaterial |
| ADR-4.5 | JSON + base64 TypedArray blobs for map serialization |
| ADR-4.6 | MapPreview deferred post-Chapter 4 |
| ADR-4.7 | ActorInitializer/Reference deferred to Chapter 5+ |

---

## Chapter 4 Completion Notes (2026-06-11)

Chapter 4 (Map & Terrain System) is now complete at 37/37 (100%):

- **Phase A (8 files, COMPLETE)**: CellLayerBase, CellLayer, CellRegion, ProjectedCellLayer, ProjectedCellRegion, CellCoordsRegion, MapCoordsRegion, Size. 195 tests, 2 review rounds, 0 BLOCKERs.
- **Phase B (2 files + 2 updated, COMPLETE)**: MapGrid.ts (436 impl + 491 test), CellRamp.ts (238 impl + 352 test), Exts.ts isqrtCeiling (+19), CVec.ts hashCode (+18). 138 tests, 1 Architect WR round, 5 BLOCKERs resolved.
- **Phase C (1 file, COMPLETE)**: TerrainInfo.ts (814 impl + 1205 test). TerrainTypeInfo, TerrainTileInfo, TileSet. 93 tests, 2 review rounds, 0 BLOCKERs.
- **Phase D (2 files, COMPLETE)**: Map.ts (1699 impl + 1409 test), MapBinParser.ts (325 impl + 290 test). ~2024 impl + ~1699 test lines, 38+ tests. Core map container + binary parser.
- **Phase E (7 files + 2 stubs, COMPLETE)**: MapCache, MapPlayers, MapDirectoryTracker, MapGenerationArgs, PlayerReference, TileReference, MapPreview (stub), IReadOnlyPackage (stub). ~940 impl + ~1030 test lines, 96 tests.
- **Phase F (2 new files, COMPLETE)**: TerrainMeshBuilder.ts (713 impl + 739 test, 32 tests), TerrainMaterial.ts (454 impl + 284 test, 11 tests). ~1,167 impl + ~1,023 test lines, 43 tests. 2 review rounds, 0 BLOCKERs. E2E acceptance test page.
- **Phase G (13 files: 10 pathfinder + 3 dep, COMPLETE)**: HierarchicalPathFinder (1524), PathSearch (828), DensePathGraph (477), MapPathGraph (165), GridPathGraph (137), SparsePathGraph (104), IPathGraph (216), CellInfo (166), Grid (237), CellInfoLayerPool (176), BlockedByActor (39), ICustomMovementLayer (69), Locomotor (261). ~4,399 impl + ~3,470 test lines, 190 tests. Full HPA* + A* port. 5-dimension review, 3 BLOCKERs + 5 MAJORs resolved.
- **Phase H (1 new file, COMPLETE)**: miniyaml-to-json.ts (762 impl + 962 test lines). Recursive descent MiniYAML parser + Vite plugin. Build-time YAML->JSON compilation per ADR-4.2.
- **Phase I (1 new file, COMPLETE)**: CoordinateTransformer.ts (334 impl + 509 test lines). WPos<->Vector3 conversion with LRU cache. Batch Float32Array output for mesh generation.
- **Total Chapter 4 code**: ~18,500+ TS implementation lines + ~16,000+ test lines across 37 files.
- **Total tests**: ~790+ (195+138+93+38+96+43+190 = Phase A-G; H+I additional).
- **All review rounds**: 15+ rounds across 9 phases.
- **Remaining deferred**: MapPreview stub, ActorInitializer, ActorReference (Chapter 5+).

---

## Chapter 5: UI System & Resource Management (IN PROGRESS)

> **Migration Plan**: [docs/ui_system_migration_plan.md](docs/ui_system_migration_plan.md)
> **Created**: 2026-06-11 | **Updated**: 2026-06-12 | **Status**: IN PROGRESS (15/16 migrated, 94%), Phases A+B+C+D COMPLETE, Phase E pending
> **Prerequisite**: Chapter 4 (Map & Terrain System) -- COMPLETE (37/37, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 15 | 94% |
| Pending | 1 | 6% |
| **Total** | **16** | **100%** |
| **From OpenRA** | **15** (plus 1 IReadOnlyPackage refactor) | |
| **New files (no OpenRA equivalent)** | **0** | |

### Chapter 5 Phases

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | FileSystem Foundation (VFS) | 4 | Low-Medium | COMPLETE (4/4, 132 tests) |
| Phase B | C&C Package Formats | 5 | Low-HIGH | COMPLETE (5/5, 108 tests) |
| Phase C | MOD System Core | 2 | Low-Medium | COMPLETE (2/2, 115 tests) |
| Phase D | UI Widget Core | 4 | Low-Medium | COMPLETE (4/4, 174 tests) |
| Phase E | World Interaction Bridge | 1 | HIGH | PENDING (blocked by C, D -- D now complete, fully unblocked) |

### Already Available (from Prior Chapters)

| Dependency | Source | Status |
|:---|:---|:---|
| MiniYAML -> JSON pipeline | `utils/miniyaml-to-json.ts` | COMPLETE (Ch4 Phase H) |
| `IReadOnlyPackage` interface stub | `src/OpenRA.Game/FileSystem/IReadOnlyPackage.ts` | REFACTORED to re-export shim (Ch5 Phase A) |
| `MapCache` | `src/OpenRA.Game/Map/MapCache.ts` | COMPLETE (Ch4 Phase E) |
| `MapDirectoryTracker` | `src/OpenRA.Game/Map/MapDirectoryTracker.ts` | COMPLETE (Ch4 Phase E) |
| Coordinate types (WPos, CPos, etc.) | `src/OpenRA.Game/` | COMPLETE (Ch3 Phase A) |
| `World.ts` / `GameWorldManager` | `src/OpenRA.Game/World.ts` | COMPLETE (Ch3 Phase C) |
| `Actor.ts` / `GameActor` | `src/OpenRA.Game/Actor.ts` | COMPLETE (Ch3 Phase D) |
| `Renderer.ts` + `WorldRenderer.ts` | `src/OpenRA.Game/` | COMPLETE (Ch2) |
| CoordinateTransformer | `src/OpenRA.Game/CoordinateTransformer.ts` | COMPLETE (Ch4 Phase I) |
| `fflate` (ZIP library) | npm dependency | Already installed (Ch4) |

### Key Architecture Decisions (5 ADRs)

| ADR | Decision |
|-----|----------|
| ADR-5.1 | MIX files unpacked at build time (not browser runtime) -- `MixFile.ts` is a documentation stub |
| ADR-5.2 | Pure TypeScript Widget tree (not React-first); React bridge optional |
| ADR-5.3 | Event bus for UI-to-World communication (no direct Widget-to-World calls) |
| ADR-5.4 | Four-level asset cache: L1 memory (100MB LRU), L2 IndexedDB, L3 Cache API, L4 CDN |
| ADR-5.5 | `IPackageLoader` registration pattern via explicit `FileSystem.registerLoader()` at import time |

### Dependency Graph

```
Phase A: FileSystem (4 files) -- FOUNDATION
  |
  +--> Phase B: C&C Packages (5 files) -- can run parallel with Phase C
  +--> Phase C: MOD System (2 files)
              |
              v
        Phase D: UI Widget Core (4 files)
              |
              v
        Phase E: World Interaction (1 file) -- LEAF
```

### Phase A: FileSystem Foundation (4 files, COMPLETE)

**Status**: COMPLETE (4/4). Review: APPROVED (2 rounds, 0 BLOCKERs). No manual visual tests needed (pure infrastructure layer).
**Commits**: `c9f6dd3` (initial), `49aa8be` (review fixes).
**Date**: 2026-06-12

| # | Target File | Class/Interface | Complexity | Lines (C#) | Impl lines | Test lines | Tests |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|
| A1 | `src/OpenRA.Game/FileSystem/IPackage.ts` | IPackage, IReadOnlyPackage, IPackageLoader | Low (refactor of existing stub) | 42 | 188 | 337 | 21 |
| A2 | `src/OpenRA.Game/FileSystem/Folder.ts` | Folder | Low | 110 | 198 | 337 | 24 |
| A3 | `src/OpenRA.Game/FileSystem/ZipFile.ts` | ZipFile, ZipFileLoader | Low | 262 | 371 | 518 | 37 |
| A4 | `src/OpenRA.Game/FileSystem/FileSystem.ts` | FileSystem, IReadOnlyFileSystem | Medium | 304 | 673 | 769 | 50 |
| **Total** | | | | **~718** | **1,430** | **1,961** | **132** |

> **Note**: `IReadOnlyPackage.ts` was refactored from a 78-line stub (Ch4 Phase E) into a 19-line re-export shim pointing to `IPackage.ts`. Existing consumers (`MapCache.ts`, `MapDirectoryTracker.ts`) had their imports updated.

### Phase B: C&C Package Formats (5 files, COMPLETE)

**Status**: COMPLETE (5/5). Review: APPROVED (3 rounds, 0 BLOCKERs). No manual visual tests needed (pure infrastructure, no GPU/visual output).
**Date**: 2026-06-12

| # | Target File | Class/Interface | Complexity | Lines (C#) | Impl lines | Tests | Notes |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---|
| B1 | `src/OpenRA.Mods.Cnc/FileSystem/PackageEntry.ts` | PackageEntry | Low | 118 | 332 | 30 | 32-bit rolling hash algorithm |
| B2 | `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` | MixFile, MixLoader | HIGH | 248 | 350 | 22 | Documentation stub per ADR-5.1 |
| B3 | `src/OpenRA.Mods.Cnc/FileSystem/BigFile.ts` | BigFile, BigFileLoader | Low | 124 | 268 | 19 | EA BIG format (BE + ASCIIZ) |
| B4 | `src/OpenRA.Mods.Cnc/FileSystem/MegFile.ts` | MegFile, MegFileLoader | Low | 141 | 282 | 17 | MEG V3 format |
| B5 | `src/OpenRA.Mods.Cnc/FileSystem/Pak.ts` | Pak, PakLoader | Low | 103 | 240 | 18 | PAK linked-list format |
| **Total** | | | | **~734** | **~1,472** | **108** | **~1,653 test lines** |

### Phase C: MOD System Core (2 files, COMPLETE)

**Status**: COMPLETE (2/2). Review: APPROVED (2 rounds, 0 BLOCKERs). No manual visual tests needed (pure infrastructure, no GPU/visual output).
**Date**: 2026-06-12

| # | Target File | Class/Interface | Complexity | Lines (C#) | Impl lines | Test lines | Tests |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|
| C1 | `src/OpenRA.Game/Manifest.ts` | Manifest, ModMetadata | Low | 206 | 506 | 739 | 72 |
| C2 | `src/OpenRA.Game/ModData.ts` | ModData, ObjectCreator | Medium | 258 | 326 | 557 | 43 |
| **Total** | | | | **~464** | **832** | **1,296** | **115** |

### Phase D: UI Widget Core (4 files, COMPLETE)

**Status**: COMPLETE (4/4). Review: APPROVED (3 rounds, 0 BLOCKERs remaining). No manual visual tests needed (core widget tree infrastructure).
**Date**: 2026-06-12

| # | Target File | Class/Interface | Complexity | Lines (C#) | Impl lines | Test lines | Tests |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|
| D1 | `src/OpenRA.Game/Widgets/Widget.ts` | Widget, ContainerWidget, InputWidget, Ui, ChromeLogic | Medium | 708 | 1062 | 1284 | 104 |
| D2 | `src/OpenRA.Game/Widgets/ChromeMetrics.ts` | ChromeMetrics | Low | 49 | 166 | 247 | 23 |
| D3 | `src/OpenRA.Game/Widgets/WidgetLoader.ts` | WidgetLoader | Medium | 83 | 470 | 552 | 43 |
| D4 | `src/OpenRA.Game/Graphics/ChromeProvider.ts` | ChromeProvider, Collection, PanelRegion, PanelSides | Low | 305 | 431 | 250 (shared) | 48 |
| **Total** | | | | **~1,145** | **2,129** | **2,333** | **174** |

> **Note**: ChromeProvider.ts replaced the previous 4-line placeholder stub in `src/OpenRA.Game/Graphics/`. Review rounds: Round 1 (4 BLOCKER + 4 MAJOR + 3 MINOR), Round 2 (2 MAJOR cascading from Round 1 fixes), Round 3 (APPROVED). Specific widget visual subclasses (ButtonWidget, LabelWidget, etc.) not yet implemented -- deferred to future UI widget subclass chapters.

### Phase E: World Interaction Bridge (1 file, PENDING -- now fully unblocked)

| # | Target File | Class/Interface | Complexity | Lines (C#) |
|:---:|:---|:---|:---:|:---:|
| E1 | `src/OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.ts` | WorldInteractionControllerWidget | HIGH | 235 |
| **Total** | | | | **~235** | **~480 impl + ~520 test lines, ~38 tests** |

> **Note**: Phase D (UI Widget Core) is now COMPLETE, fully unblocking Phase E. `WorldInteractionControllerWidget` extends `Widget` from Phase D and needs `ModData`/`World` from Phase C, both of which are complete.

### Chapter 5 Phase Strategy Summary

| Phase | Files | Complexity | Est. Lines (impl+test) | Est. Tests | Depends On |
|-------|:---:|:---|:---:|:---:|-----------|
| A: FileSystem Foundation | 4 | Low-Medium | 3,391 (completed) | 132 (completed) | Nothing |
| B: C&C Package Formats | 5 | Low-HIGH | 3,125 (completed) | 108 (completed) | Phase A |
| C: MOD System Core | 2 | Low-Medium | 2,128 (completed) | 115 (completed) | Phase A |
| D: UI Widget Core | 4 | Low-Medium | 4,462 (completed) | 174 (completed) | Phase C |
| E: World Interaction | 1 | HIGH | ~1,000 | ~38 | Phases C, D |
| **Total** | **16** | | **~14,106** | **~529** | |

**Total completed**: ~13,106 lines of implementation + test code (13,106 done, ~1,000 remaining). Phase E is now fully unblocked. 1 developer-week remaining.
