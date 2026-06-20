# OpenRAWeb3D

Migrate the [OpenRA](https://github.com/OpenRA/OpenRA) 2D RTS game engine (C# / OpenGL 3.2 / SDL2) to a Web-based 3D engine using **TypeScript** and **Babylon.js**. The core paradigm shift: from imperative OpenGL programming to a declarative 3D scene graph.

## Project Status

**Phase**: ALL CHAPTERS 2-22 COMPLETE, CHAPTERS 23-25 COMPLETE, CHAPTER 26 PHASES A-C COMPLETE (8/10, 80%) (665/665 + 54+ active + 7 + 18 + 7 + 8 = ~759+ files, 100%).
**Progress**: Chapter 2: 27/27 (100%), Chapter 3: 36/36 (100%), Chapter 4: 37/37 (100%), Chapter 5: 16/16 (100%), Chapter 6: 29/29 (100%), Chapter 7: 13/13 (100%), Chapter 8: 57/57 (100%, ALL PHASES COMPLETE). Chapter 9: 30/32 (94%, COMPLETE; 2 deferred). Chapter 10: 25/25 (100%, Phases A-B + B-Optional COMPLETE, 972 tests). Chapter 11: 37/37 (100%, ALL PHASES COMPLETE). Chapter 12: 16/16 (100%, Phase A COMPLETE). Chapter 13: 14/14 (100%, Phase A COMPLETE, 285 tests). Chapter 14: 49/49 (100%, ALL PHASES COMPLETE). Chapter 15: 11/11 (100%, ALL PHASES COMPLETE, 206 tests). Chapter 16: 65/65 (100%, ALL PHASES COMPLETE, 1,900+ tests). Chapter 17: 8/8 (100%, ALL PHASES COMPLETE, 237 tests). Chapter 18: 10/10 (100%, ALL PHASES COMPLETE, 240 tests). Chapter 19: 119/119 (100%, ALL PHASES COMPLETE). Chapter 20: 62/62 (100%, ALL PHASES A-G COMPLETE). Chapter 21: ALL PHASES A-G COMPLETE (54+ active files, 100%, 25 deferred + 12 legacy deferred). Chapter 22: ALL PHASES A-E COMPLETE (7/7, 100% — 4 impl + 3 test files + 1 build script + 150+ generated assets).
**Planning Doc**: [docs/remaining_systems_migration_plan.md](docs/remaining_systems_migration_plan.md)
**Chapter 9 Plan**: [docs/chapter9_movement_physics_migration_plan.md](docs/chapter9_movement_physics_migration_plan.md)
**Chapter 10 Plan**: [docs/chapter10_resource_economy_migration_plan.md](docs/chapter10_resource_economy_migration_plan.md)
**Chapter 11 Plan**: [docs/chapter11_production_building_migration_plan.md](docs/chapter11_production_building_migration_plan.md)
**Chapter 12 Plan**: [docs/chapter12_shroud_fog_of_war_migration_plan.md](docs/chapter12_shroud_fog_of_war_migration_plan.md)
**Chapter 13 Plan**: [docs/chapter13_support_powers_migration_plan.md](docs/chapter13_support_powers_migration_plan.md)
**Chapter 15 Plan**: [docs/chapter15_order_generators_migration_plan.md](docs/chapter15_order_generators_migration_plan.md)
**Chapter 17 Plan**: [docs/chapter17_replay_save_system_migration_plan.md](docs/chapter17_replay_save_system_migration_plan.md)
**Chapter 18 Plan**: [docs/chapter18_server_system_migration_plan.md](docs/chapter18_server_system_migration_plan.md)
**Chapter 19 Plan**: [docs/chapter19_mod_content_migration_plan.md](docs/chapter19_mod_content_migration_plan.md)
**Chapter 20 Plan**: [docs/chapter20_scripting_system_migration_plan.md](docs/chapter20_scripting_system_migration_plan.md)
**Chapter 21 Plan**: [docs/chapter21_editor_utilities_tooling_migration_plan.md](docs/chapter21_editor_utilities_tooling_migration_plan.md)
**Chapter 22 Plan**: [docs/chapter22_game_entry_migration_plan.md](docs/chapter22_game_entry_migration_plan.md)
**Post-Migration Plan**: [docs/post_migration_completion_plan.md](docs/post_migration_completion_plan.md) (52 remaining items across 5 phases A-E)
**Acceptance Test Plan**: [docs/acceptance_test_completion_plan.md](docs/acceptance_test_completion_plan.md) (**✅ COMPLETE**: 31/31 pages, 107 total, all 10 phases P0-P3 done)
**Details**: [docs/migration_progress.md](docs/migration_progress.md)

| Module | Status |
|--------|--------|
| **Rendering Engine (27 files)** | COMPLETE (100%) |
| Renderer (main renderer) | Completed, reviewed |
| WorldRenderer (world scene) | Completed, reviewed |
| SpriteRenderer (batch sprites) | Completed, reviewed |
| RgbaColorRenderer (RGBA color renderer) | Completed, reviewed |
| Shader / Material System (6 files) | Completed, reviewed |
| FrameBuffer & Post-Processing (10 files) | Completed, reviewed |
| Sprite & Texture System (8 core + 4 extra files) | Completed, reviewed |
| Platform Abstraction (11 files) | Completed, reviewed |
| **Actor System (36 files)** | COMPLETE (100%) |
| **Map & Terrain System (37 files)** | **ALL PHASES COMPLETE (100%)** |
| CellLayer Infrastructure (8 files) | COMPLETE, 195/195 tests, 2 review rounds |
| MapGrid + CellRamp (2+2 files) | COMPLETE, 138 tests, 1 review round |
| TerrainInfo / TileSet (1 file) | COMPLETE, 93 tests, 2 review rounds |
| Map Core (Map.ts + MapBinParser.ts) | COMPLETE, ~1699 test lines, 38+ tests |
| Map Support Files (7 files) | COMPLETE, ~1030 test lines, 96 tests |
| 3D Terrain Mesh Generation (2 files) | COMPLETE, ~1023 test lines, 43 tests |
| Pathfinding System (13 files, Phase G) | COMPLETE, 190 tests, HPA* + A* |
| MiniYAML Pipeline (1 file, Phase H) | COMPLETE, build-time YAML->JSON |
| CoordinateTransformer (1 file, Phase I) | COMPLETE, WPos<->Vector3 bridge |
| **UI System & Resource Management (16 files)** | **COMPLETE (16/16, 100%), 5 Phases A-E** |
| FileSystem Foundation (4 files) | COMPLETE (IPackage, Folder, ZipFile, FileSystem), 132 tests |
| C&C Package Formats (5 files) | COMPLETE (PackageEntry, MixFile stub, BigFile, MegFile, Pak), 108 tests |
| MOD System Core (2 files) | COMPLETE (Manifest, ModData), 115 tests, 2 review rounds |
| UI Widget Core (4 files) | COMPLETE (Widget, ChromeMetrics, WidgetLoader, ChromeProvider), 174 tests, 3 review rounds |
| World Interaction Bridge (1 file) | COMPLETE (WorldInteractionControllerWidget, 1157 lines, 55 tests, 2 review rounds) |
| **Network Sync & Game Logic (29 files)** | **COMPLETE (29/29, 100%). All 5 Phases A-E COMPLETE** |
| Order & Connection System (4 files) | COMPLETE (Phase A, ~3,461 impl + ~1,867 test lines, 115 tests) |
| Sync Hash System (3 files) | COMPLETE (Phase B, ~1,204 impl + ~1,779 test lines, 132 tests) |
| Ruleset Container (2 files) | COMPLETE (Phase C, ~1,030 impl + ~1,359 test lines, ~80 tests) |
| AI BotModule Core (10 files) | COMPLETE (Phase D, ~5,769+390 impl lines, 2 review rounds) |
| AI BotModule Extended (11 files) | COMPLETE (Phase E, ~4,463 impl + ~1,515 test lines, 119 tests, 2 rounds) |
| **Input, Camera, Audio & Effects (13 files)** | **COMPLETE (13/13, 100%, ALL PHASES A-G COMPLETE)** |
| Input Foundation (3 files) | COMPLETE (IInputHandler 176, Keycode 544, InputHandler 617 lines, 155 tests) |
| Camera System (2+1 files) | COMPLETE (Viewport 1,023, ViewportControllerWidget 868, HotkeyReference 360 lines, 86 tests) |
| Selection System (1 file) | COMPLETE (SelectionUtils 723 lines, 58 tests, 3 review rounds) |
| Audio System (2 files) | COMPLETE (Sound 1,383, SoundDevice 269 lines, 133 tests) |
| Visual Effects (2 files) | COMPLETE (SpriteEffect + FloatingSpriteEmitter, 92 tests, 2 rounds) |
| Projectiles (1 file) | COMPLETE (Bullet 1,463 lines, 56 tests, 2 review rounds) |
| Sprite Traits (2+3 files) | COMPLETE (AnimationWithOffset 163, RenderSprites ~500, WithIdleOverlay ~413 lines; 120 tests, 2 review rounds) |
| **Chapters 8-22 (15 chapters)** | **ALL CHAPTERS COMPLETE (Ch8-22: ~726+ files, 100%).** |
| Weapons & Combat (Ch8) | COMPLETE (57 files, 5 phases A-E, ~8,264 C# lines -- Phase A: 15/15, 143 tests, `d9f6c34`/`9b25839`; Phase B: 7/7, 186 tests, `0f02230`/`28b4602`; Phase C: 2+1/2+1, 115 tests, `ab3b3d4`; Phase D: 17/17, 158 tests, `bbbe871`/`5cf9b93`; Phase E: 15/15, 156 tests, `accbced`/`b04e8e1`) |
| Movement & Physics (Ch9) | COMPLETE (30 files, 4 phases A-D, ~11,723 TS lines, 1,084 tests, ~5,355 C# source. Plan: [chapter9_movement_physics_migration_plan.md](docs/chapter9_movement_physics_migration_plan.md)) |
| Resource & Economy (Ch10) | COMPLETE (Phase A: 8 core + interface, 344 tests. Phase B: 11 files, 425 tests. Phase B-Optional: 8 files, 203 tests. Total: 25 files, 972 tests. Plan: [chapter10_resource_economy_migration_plan.md](docs/chapter10_resource_economy_migration_plan.md)) |
| Production & Building (Ch11) | COMPLETE (37 files, ALL PHASES A-B. Phase A: 14 files, ~4,216 TS lines, ~296 tests. Phase B: 23 files, ~5,355 TS lines, ~475 tests. Total: ~9,571 TS lines, ~771 tests. Plan: [chapter11_production_building_migration_plan.md](docs/chapter11_production_building_migration_plan.md)) |
| Shroud & Fog of War (Ch12) | COMPLETE (16/16, 100%, Phase A) |
| Support Powers (Ch13) | COMPLETE (14 files + 1 interface, Phase A: 14/14, 285 tests, R2 APPROVED). Plan: [chapter13_support_powers_migration_plan.md](docs/chapter13_support_powers_migration_plan.md) |
| Activity Implementations (Ch14) | **ALL PHASES COMPLETE (49/49 files, 100%, Phases A-F, 82+70+~180+161+~48+45 tests, 3 E2E pages)** |
| Order Generators (Ch15) | **ALL PHASES COMPLETE (11/11, 100%, 206 tests, Phases A-B-C all APPROVED)**. Plan: [chapter15_order_generators_migration_plan.md](docs/chapter15_order_generators_migration_plan.md) |
| UI Widget Extensions (Ch16) | COMPLETE (65/65 files, 100%, ALL PHASES A-C, 1,900+ tests) |
| Replay & Save (Ch17) | COMPLETE (8/8 files, 100%, ALL PHASES A-D, 237 tests) |
| Server System (Ch18) | COMPLETE (10/10 files, 100%, ALL PHASES A-D COMPLETE, 240 tests. Plan: [chapter18_server_system_migration_plan.md](docs/chapter18_server_system_migration_plan.md)) |
| Mod-Specific Content (Ch19) | COMPLETE (119/119 files, 100%, ALL PHASES A-D COMPLETE. 4 phases A-D + 45 deferred. Plan: [chapter19_mod_content_migration_plan.md](docs/chapter19_mod_content_migration_plan.md)) |
| Scripting System (Ch20) | ALL PHASES A-G COMPLETE (62/62, 100%. Phase A: 7 files, 128 tests. Phase B: 3+1 files, 88 tests. Phase C: 16+2 files, 84 tests. Phase D: 29 files Actor Props. Phase E: 5 files Player Props. Phase F: 4 files C&C Props. Phase G: Lua VM fengari integration. Plan: [chapter20_scripting_system_migration_plan.md](docs/chapter20_scripting_system_migration_plan.md)) |
| Editor & Utilities (Ch21) | **ALL PHASES A-G COMPLETE (54+ active files, 100%, 25 deferred + 12 legacy deferred)**. Plan: [chapter21_editor_utilities_tooling_migration_plan.md](docs/chapter21_editor_utilities_tooling_migration_plan.md) |
| **Chapters 22: Game Entry & App Shell (7 files)** | **ALL PHASES A-E COMPLETE (7/7, 100%)** |
| Router + ModSelector + Game (Ch22) | ALL PHASES COMPLETE (Phase A: Router/ModSelector 51 tests; Phase B: Game/main.ts 81 tests; Phase C: Main Menu/Shellmap; Phase D: Editor Stub; Phase E: Build Pipeline 150+ assets). Plan: [chapter22_game_entry_migration_plan.md](docs/chapter22_game_entry_migration_plan.md) |
| **Chapter 23: MIX File Runtime Parsing** | ALL PHASES COMPLETE (8/8, Phases A-C, ~850 lines) |
| **Chapter 24: Animation & 3D Visual Effects** | ALL PHASES A-D COMPLETE (10/10, 100%) |
| **Chapter 25: Shroud & Fog of War 3D** | ALL PHASES A-C COMPLETE (7/7, 100%) |
| **Chapter 26: Game World & Shellmap Integration** | PHASES A-C COMPLETE (8/10, 80%) -- map loading, actor spawning, skirmish game flow, shellmap AI + ModularBot + camera |
| **Content Installer Pipeline (ALL PHASES)** | COMPLETE (25/25 tasks, 100%), ~10,000 impl lines, 500+ tests |

## Directory Layout

```
OpenRA/                     ← Original C# source (READ-ONLY reference, NEVER modify)
  OpenRA.Game/              ← Core engine: Renderer, World, Actor, Graphics, Traits
  OpenRA.Platforms.Default/ ← Platform: Shader, Texture, FrameBuffer, SDL2 context
  OpenRA.Mods.Cnc/          ← C&C-specific mod code
  glsl/                     ← Original GLSL shaders (OpenGL 3.2 / GLSL 1.50)

src/                        ← TypeScript migration target (mirrors OpenRA/ structure)
  OpenRA.Game/              ← Core engine: Renderer.ts, Graphics/, Primitives/, etc.
    Renderer.ts             ← migrated (1134 lines, 91 tests)
    Primitives/
      Color.ts              ← migrated (272 lines, 319 test lines)
    Int32Matrix4x4.ts     ← migrated (120 lines, 5 tests) -- Phase A support
    Graphics/
      WorldRenderer.ts      ← migrated (1314 lines, 74 tests)
      SpriteRenderer.ts     ← migrated (855 lines, 55 tests)
      RgbaColorRenderer.ts  ← migrated (1012 lines, 68 tests)
      Sprite.ts             ← migrated (296 lines, 268 test lines)
      Sheet.ts              ← migrated (437 lines, 351 test lines)
      SheetBuilder.ts       ← migrated (502 lines, 367 test lines)
      HardwarePalette.ts    ← migrated (658 lines, 463 test lines)
      PlayerColorRemap.ts   ← migrated (154 lines, 191 test lines)
      Animation.ts          ← migrated (558+112 lines, 451+9 test lines) -- Ch7 Phase G extension
      AnimationWithOffset.ts ← migrated -- Ch7 Phase G (163 lines, 17 tests)
      CursorManager.ts      ← migrated (548 lines, 288 test lines)
      TerrainSpriteLayer.ts ← migrated (631 lines, 346 test lines)
      RgbaSpriteRenderer.ts ← migrated (161 lines, 462 test lines)
      Palette.ts            ← migrated (477 lines, 381 test lines)
      PaletteReference.ts   ← migrated (91 lines, 89 test lines)
      Util.ts               ← migrated (558 lines, 511 test lines)
      ChromeProvider.ts     ← migrated (431 lines, 48 tests) -- Phase D (replaces stub)
      Viewport.ts           ← migrated (1023 lines, 742 test lines) -- Ch7 Phase B (CameraController)
      *.ts                  ← ~13 remaining stubs (beyond Chapter 2 scope; AnimationWithOffset migrated in Ch7 Phase G)
    Input/                    ← Chapter 7 Phase A+B: Input Foundation + Camera (COMPLETE)
      IInputHandler.ts      ← migrated (176 lines) -- Phase A
      Keycode.ts            ← migrated (544 lines) -- Phase A
      InputHandler.ts       ← migrated (617 lines) -- Phase A
      HotkeyReference.ts    ← migrated (360 lines) -- Ch7 Phase B prereq
    Network/                  ← Chapter 6 Phase A: Network & Connection Foundation (COMPLETE)
      Order.ts              ← migrated (1253 lines, 567 test lines)
      UnitOrders.ts         ← migrated (696 lines, 416 test lines)
      Connection.ts         ← migrated (685 lines, 352 test lines)
      OrderManager.ts       ← migrated (827 lines, 532 test lines)
    Server/                   ← Chapter 18: Server System (COMPLETE, 10/10, 100%)
      ProtocolVersion.ts   ← migrated (206 lines, 16 tests) -- Phase A
      TraitInterfaces.ts   ← migrated (257 lines, 22 tests) -- Phase A
      Exts.ts              ← migrated (41 lines, 14 tests) -- Phase A
      SessionTypes.ts      ← migrated (695 lines, 35 tests) -- Phase B
      Server.ts            ← migrated (2397 lines, 52 tests) -- Phase B
      Connection.ts        ← migrated (425 lines, ~30 tests) -- Phase C
      OrderBuffer.ts       ← migrated (293 lines, ~27 tests) -- Phase C
      VoteKickTracker.ts   ← migrated (375 lines, ~16 tests) -- Phase D
      MapStatusCache.ts    ← migrated (306 lines, ~15 tests) -- Phase D
      PlayerMessageTracker.ts ← migrated (188 lines, ~13 tests) -- Phase D
    Sound/                    ← Chapter 7 Phase D: Audio System (COMPLETE)
      Sound.ts              ← migrated (1383 lines, ~110 tests) -- Phase D
      SoundDevice.ts        ← migrated (269 lines, ~23 tests) -- Phase D
    WPos.ts               ← migrated (180 lines, 24 tests) -- Phase A 3.1.1
    WVec.ts               ← migrated (230 lines, 35 tests) -- Phase A 3.1.1
    WAngle.ts             ← migrated (270 lines, 54 tests) -- Phase A 3.1.1
    WDist.ts              ← migrated (170 lines, 32 tests) -- Phase A 3.1.1
    WRot.ts               ← migrated (310 lines, 32 tests) -- Phase A 3.1.1
    Exts.ts               ← migrated (67 lines, 10 tests) -- Phase A support + isqrtCeiling (Phase B)
    CVec.ts               ← migrated (271 lines, 40 tests) -- hashCode added Phase B
    Map/                    ← Chapter 4: Map & Terrain System (37/37, 100%, ALL PHASES COMPLETE)
      MapGridType.ts      ← migrated -- Phase A prereq
      CellLayerBase.ts    ← migrated (213 lines, 281 test lines) -- Phase A
      CellLayer.ts        ← migrated (468 lines, 722 test lines) -- Phase A
      CellRegion.ts       ← migrated (309 lines, 356 test lines) -- Phase A
      ProjectedCellLayer.ts   ← migrated (183 lines, 227 test lines) -- Phase A
      ProjectedCellRegion.ts  ← migrated (234 lines, 262 test lines) -- Phase A
      CellCoordsRegion.ts ← migrated (171 lines, 140 test lines) -- Phase A
      MapCoordsRegion.ts  ← migrated (122 lines, 117 test lines) -- Phase A
      MapGrid.ts          ← migrated (436 lines, 491 test lines) -- Phase B
      CellRamp.ts         ← migrated (238 lines, 352 test lines) -- Phase B
      TerrainInfo.ts      ← migrated (814 lines, 1205 test lines) -- Phase C
      Map.ts              ← migrated (1699 lines, 1409 test lines) -- Phase D
      MapBinParser.ts     ← migrated (325 lines, 290 test lines) -- Phase D
      MapCache.ts         ← migrated (816 lines, 465 test lines) -- Phase E
      MapPlayers.ts       ← migrated (241 lines, 266 test lines) -- Phase E
      MapDirectoryTracker.ts  ← migrated (271 lines, 291 test lines) -- Phase E
      MapGenerationArgs.ts    ← migrated (84 lines, 156 test lines) -- Phase E
      PlayerReference.ts  ← migrated (163 lines, 165 test lines) -- Phase E
      TileReference.ts    ← migrated (103 lines, 83 test lines) -- Phase E
      TerrainMeshBuilder.ts   ← migrated (713 lines, 739 test lines) -- Phase F
      TerrainMaterial.ts  ← migrated (454 lines, 284 test lines) -- Phase F
      MapPreview.ts       ← stub (241 lines) -- deferred Chapter 5+
    CoordinateTransformer.ts  ← migrated (334 lines, 509 test lines) -- Phase I
    FileSystem/               ← Chapter 5 Phase A: Virtual File System (COMPLETE)
      IReadOnlyPackage.ts     ← re-export shim (19 lines) -- refactored in Ch5 Phase A
      IPackage.ts             ← migrated (188 lines, 21 tests) -- Chapter 5 Phase A
      Folder.ts               ← migrated (198 lines, 24 tests) -- Chapter 5 Phase A
      ZipFile.ts              ← migrated (371 lines, 37 tests) -- Chapter 5 Phase A
      FileSystem.ts           ← migrated (673 lines, 50 tests) -- Chapter 5 Phase A
    Widgets/                  ← Chapter 5 Phase D: UI Widget core (COMPLETE)
      Widget.ts              ← migrated (1062 lines, 104 tests) -- Phase D
      ChromeMetrics.ts       ← migrated (166 lines, 23 tests) -- Phase D
      WidgetLoader.ts        ← migrated (470 lines, 43 tests) -- Phase D
    Traits/                 ← Chapter 3: Trait interfaces and components (COMPLETE)
    Activities/             ← Chapter 3: Activity state machine (COMPLETE)
    GameRules/              ← Chapter 3+6+8: ActorInfo, WeaponInfo, SoundInfo, MusicInfo, Ruleset config (COMPLETE)
      ActorInfo.ts         ← migrated (64 tests) -- Chapter 3 Phase E
      Ruleset.ts            ← migrated (55 tests) -- Chapter 6 Phase C
      WeaponInfo.ts         ← migrated (52 tests) -- Chapter 8 Phase C
      SoundInfo.ts          ← migrated (45 tests) -- Chapter 8 Phase C
      MusicInfo.ts          ← migrated (18 tests) -- Chapter 8 Phase C
    Orders/                 ← Chapter 3: Order generation (empty, planned)
  OpenRA.Game/Manifest.ts     ← migrated (506 lines, 72 tests) -- Chapter 5 Phase C: MOD manifest
  OpenRA.Game/ModData.ts      ← migrated (326 lines, 43 tests) -- Chapter 5 Phase C: MOD runtime coordinator
  OpenRA.Mods.Cnc/            ← Chapter 5 Phase B: C&C package formats (COMPLETE)
    FileSystem/               ← Chapter 5 Phase B: PackageEntry (332 lines, 30 tests), MixFile (350 lines, 22 tests), BigFile (268 lines, 19 tests), MegFile (282 lines, 17 tests), Pak (240 lines, 18 tests)
  OpenRA.Mods.Common/         ← Chapter 4: Pathfinding + movement traits / Ch5: World interaction / Ch7: Effects + Projectiles / Ch8: Weapons & Combat
    Effects/                ← Ch7 Phase E: Visual Effects (COMPLETE)
      SpriteEffect.ts       ← migrated -- Ch7 Phase E (86 lines C# -> TS, billboard particle effects)
    Projectiles/            ← Ch7 Phase F + Ch8 Phase B: Projectiles (COMPLETE)
      Bullet.ts             ← migrated (1,463 lines, 56 tests) -- Ch7 Phase F
      Missile.ts            ← migrated (32 tests) -- Ch8 Phase B
      AreaBeam.ts           ← migrated (12 tests) -- Ch8 Phase B
      Railgun.ts            ← migrated (13 tests) -- Ch8 Phase B
      LaserZap.ts           ← migrated (12 tests) -- Ch8 Phase B
      NukeLaunch.ts         ← migrated (11 tests) -- Ch8 Phase B
      GravityBomb.ts        ← migrated (15 tests) -- Ch8 Phase B
      InstantHit.ts         ← migrated (14 tests) -- Ch8 Phase B
      MissileMath.ts        ← migrated (23 tests) -- Ch8 Phase B shared
      ProjectileRegistry.ts ← migrated -- Ch8 Phase B shared
      BeamRenderableShape.ts← migrated -- Ch8 Phase B shared
    Warheads/               ← Ch8 Phase A+C: Warhead effects + registry (COMPLETE)
      Warhead.ts            ← migrated -- Ch8 Phase A (abstract base)
      DamageWarhead.ts      ← migrated -- Ch8 Phase A
      SpreadDamageWarhead.ts← migrated -- Ch8 Phase A
      WarheadRegistry.ts    ← migrated -- Ch8 Phase C (shared, warhead factory registry)
      *.ts                  ← 11 additional warheads (TODO-8.A.4 through TODO-8.A.15)
    Pathfinder/             ← Phase G: Pathfinding System (10 files)
      IPathGraph.ts         ← migrated (216 lines) -- Phase G
      CellInfo.ts           ← migrated (166 lines) -- Phase G
      Grid.ts               ← migrated (237 lines) -- Phase G
      CellInfoLayerPool.ts  ← migrated (176 lines) -- Phase G
      SparsePathGraph.ts    ← migrated (104 lines) -- Phase G
      PathSearch.ts         ← migrated (828 lines) -- Phase G
      DensePathGraph.ts     ← migrated (477 lines) -- Phase G
      MapPathGraph.ts       ← migrated (165 lines) -- Phase G
      GridPathGraph.ts      ← migrated (137 lines) -- Phase G
      HierarchicalPathFinder.ts  ← migrated (1524 lines) -- Phase G
    Traits/                 ← Phase G: Movement traits + Ch7 Phase E: Render traits + Ch8 Phase D: Core Combat Traits (COMPLETE)
      CombatInterfaces.ts    ← migrated -- Ch8 Phase D (shared interfaces/enums: DamageState, IHealth, IFirepowerModifier, etc.)
      Armament.ts            ← migrated (~25 tests) -- Ch8 Phase D
      AutoTarget.ts          ← migrated (~30 tests) -- Ch8 Phase D
      AttackMove.ts          ← migrated -- Ch8 Phase D
      HitShape.ts            ← migrated (177 lines C#) -- Ch8 Phase D
      Armor.ts               ← migrated -- Ch8 Phase D
      AmmoPool.ts            ← migrated -- Ch8 Phase D
      ReloadAmmoPool.ts      ← migrated -- Ch8 Phase D
      AttackWander.ts        ← migrated (DEFERRED STUB) -- Ch8 Phase D
      BlockedByActor.ts     ← migrated (39 lines) -- Phase G
      ICustomMovementLayer.ts  ← migrated (69 lines) -- Phase G
      World/
        Locomotor.ts        ← migrated (261 lines) -- Phase G
      Attack/               ← Ch8 Phase D: Attack variant traits (COMPLETE)
        AttackBase.ts        ← migrated (~20 tests) -- Ch8 Phase D
        AttackTurreted.ts    ← migrated -- Ch8 Phase D
        AttackFrontal.ts     ← migrated -- Ch8 Phase D
        AttackOmni.ts        ← migrated -- Ch8 Phase D
        AttackFollow.ts      ← migrated -- Ch8 Phase D
        AttackCharges.ts     ← migrated -- Ch8 Phase D
        AttackGarrisoned.ts  ← migrated (DEFERRED STUB) -- Ch8 Phase D
      HitShape/              ← Ch8 Phase D: HitShape geometry (4 support files)
        HitShapeCircle.ts    ← migrated -- Ch8 Phase D
        HitShapeRectangle.ts ← migrated -- Ch8 Phase D
        HitShapeCapsule.ts   ← migrated -- Ch8 Phase D
        HitShapeInfo.ts      ← migrated -- Ch8 Phase D
      Multipliers/           ← Ch8 Phase D+E: Combat stat modifiers (ALL COMPLETE)
        RangeMultiplier.ts   ← migrated -- Ch8 Phase D
        FirepowerMultiplier.ts ← migrated -- Ch8 Phase D
        DamageMultiplier.ts  ← migrated (99 lines, 6 tests) -- Ch8 Phase E
        ReloadDelayMultiplier.ts ← migrated (90 lines, 4 tests) -- Ch8 Phase E
        InaccuracyMultiplier.ts  ← migrated (90 lines, 4 tests) -- Ch8 Phase E
      FireWarheads.ts        ← migrated (144 lines, 8 tests) -- Ch8 Phase E
      FireWarheadsOnDeath.ts ← migrated (414 lines, 24 tests) -- Ch8 Phase E
      FireProjectilesOnDeath.ts ← migrated (271 lines, 8 tests) -- Ch8 Phase E
      ExplosionOnDamageTransition.ts ← migrated (146 lines, 10 tests) -- Ch8 Phase E
      Turreted.ts            ← migrated (581 lines, 32 tests) -- Ch8 Phase E
      Render/
        FloatingSpriteEmitter.ts  ← migrated -- Ch7 Phase E (126 lines C# -> TS, GPU particle emitter)
        RenderSprites.ts       ← migrated -- Ch7 Phase G (~500 lines, 37 tests, base sprite rendering trait)
        WithIdleOverlay.ts     ← migrated -- Ch7 Phase G (~413 lines, 24 tests, idle overlay animation)
        WithMuzzleOverlay.ts   ← migrated (257 lines, 13 tests) -- Ch8 Phase E
        WithAttackAnimation.ts ← migrated (243 lines, 12 tests) -- Ch8 Phase E
        WithAttackOverlay.ts   ← migrated (278 lines, 10 tests) -- Ch8 Phase E
      Sound/                 ← Ch8 Phase E: Combat audio feedback (COMPLETE)
        AttackSounds.ts      ← migrated (186 lines, 7 tests) -- Ch8 Phase E
        DeathSounds.ts       ← migrated (121 lines, 6 tests) -- Ch8 Phase E
      Air/                   ← Ch8 Phase E: Aircraft combat traits (COMPLETE)
        AttackBomber.ts      ← migrated (227 lines, 12 tests) -- Ch8 Phase E
        AttackAircraft.ts    ← migrated (188 lines, 12 tests) -- Ch8 Phase E
    Widgets/                ← Chapter 5 Phase E: World Interaction Bridge + Chapter 7 Phase B/C
      WorldInteractionControllerWidget.ts  ← migrated (1157 lines, 55 tests) -- Phase E
      ViewportControllerWidget.ts  ← migrated (868 lines, 573 test lines) -- Ch7 Phase B
      SelectionUtils.ts    ← migrated (723 lines, 58 tests) -- Ch7 Phase C
  OpenRA.Platforms.Default/ ← Platform abstraction (6 migrated, 7 NOP, 5 stubs)
      Shader.ts             ← migrated (417 lines, 572 test lines)
      FrameBuffer.ts        ← migrated (415 lines, 649 test lines)
      Texture.ts            ← migrated (526 lines, 61 shared tests)
      VertexBuffer.ts       ← migrated (375 lines, 61 shared tests)
      StaticIndexBuffer.ts  ← migrated (174 lines, 61 shared tests)
      ITextureInternal.ts   ← migrated (49 lines)
      Sdl2*.ts (4 files)    ← NOP stubs (browser API replacement)
  glsl/                     ← Migrated GLSL shaders (WebGL 2.0 / GLSL ES 3.0)
                              ← model.vert/frag NOP stubs (StandardMaterial/PBRMaterial)
  assets/                   ← Static assets
  utils/                    ← Shared utilities
    miniyaml-to-json.ts      ← migrated (762 lines, 962 test lines) -- Phase H MiniYAML pipeline
  __e2e__/                  ← Manual acceptance test pages (dev-only, excluded from production builds)
    manual/
      index.html            ← Hub page: auto-lists all test pages (served at /test/)
      main.ts               ← Auto-discovery via import.meta.glob
      ch{num}-{title}/      ← Per-chapter test page directories (e.g., ch02-rendering)
        {test-case-id}/     ← Individual test cases (kebab-case)
          index.html        ← Test page entry
          main.ts           ← Test logic + Babylon.js scene
          README.md         ← Expected results + verification steps

vite.config.ts              ← Vite 8 MPA config + /test/ route plugin (dev-only)

.claude/
  agents/
    migration-architect.md   ← Architect agent spec
    migration-develop.md     ← Developer agent spec
    migration-review.md      ← Code review agent spec
    migration-docs.md        ← Documentation manager agent spec
  teams/
    openra-migration/              ← Original team template (legacy)
    openra-migration-deepseek/     ← DeepSeek model team configuration
    openra-migration-kimi/         ← Kimi model team configuration

docs/
  openra_migration.agent.final.converted.md   ← Comprehensive architecture analysis (~199KB)
  rendering_migration_plan.md                 ← Chapter 2 rendering plan with TODO checklist
  actor_system_migration_plan.md              ← Chapter 3 actor system plan with TODO checklist
  map_system_migration_plan.md                ← Chapter 4 map & terrain system plan with TODO checklist (37/37, 100%)
  ui_system_migration_plan.md                 ← Chapter 5 UI system & resource management plan (16 files, 5 phases)
  migration_progress.md                       ← Overall progress tracker with dependency graph
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | ~6.0 |
| 3D Engine | Babylon.js (`@babylonjs/core`) | ^9.10.1 |
| Build/Bundler | Vite | ^8.0.12 |
| Unit Testing | Vitest + happy-dom | ^4.1.8 / ^20.9.0 |
| Modules | ESM (`"type": "module"`) | — |
| Target | ES2023 | — |
| TS Config | `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` |

## Key Paradigm Mappings

| OpenRA (C# / OpenGL) | Babylon.js (TypeScript / WebGL) |
|----------------------|---------------------------------|
| `Renderer.BeginFrame/EndFrame` | `Engine.runRenderLoop()` |
| Dual FBO (`worldBuffer/screenBuffer`) | `RenderTargetTexture` + dual `Scene` |
| `SpriteRenderer` batch rendering | `ThinInstances` / `SpriteManager` |
| `HardwarePalette` (256xN texture) | `RawTexture` + custom `ShaderMaterial` |
| `WorldRenderer.Draw()` 6 phases | `renderingGroupId` layers + `Scene.render()` |
| `IShader.SetVec/SetTexture` | `ShaderMaterial.setVector3/setTexture` |
| `Vertex` 48-byte struct | `VertexData` multi-array |
| `Util.PremultiplyAlpha()` | `material.alphaMode = ALPHA_PREMULTIPLIED` |
| CPU vertex computation + inline types | Babylon.js dynamic Mesh + ShaderMaterial |
| `Sheet` (texture atlas / sprite sheet) | `BABYLON.Texture` / `RawTexture` with UV sub-regions |
| `Sprite` (single sprite from sheet) | `MeshBuilder.CreatePlane()` + custom UV offset/scale |
| `SheetBuilder` (runtime packing) | Build-time `maxrects-packer` / TexturePacker |
| `IPalette` / `ImmutablePalette` / `MutablePalette` | `Uint32Array` + custom TypeScript interface (indexer -> `at()` method) |
| `PlayerColorRemap` (HSV recolor) | GPU uniform lookup via 256x1 `RawTexture` |
| `Animation` (frame-based sprite anim) | `mesh.updateVerticesData("uv", ...)` frame swap + 25fps tick |
| `CursorManager` (hardware cursor) | CSS `cursor: url(...)` / HTML overlay element |
| `TerrainSpriteLayer` (large terrain grid) | Single large-plane `Mesh` + `updateVerticesData()` dirty-row update |
| `PaletteReference` (weak palette link) | TypeScript class with getter + setter (no `internal` keyword) |
| `RenderPostProcessPassVertex` (postprocess vertex) | Babylon.js `PostProcess` auto-generates fullscreen quad |

## Chapter 3 Paradigm Mappings (Actor System)

| OpenRA (C# / Reflection) | Babylon.js / TypeScript |
|---------------------------|-------------------------|
| `World` (game world container) | `BABYLON.Scene` + `GameWorldManager` |
| `Actor` (lightweight trait container) | `GameActor extends TransformNode` |
| `TraitDictionary` (generic type-keyed storage) | `Map<string, Component[]>` + type guard functions |
| `Trait<T>()` (compiler-enforced type lookup) | `getComponent<T>(name: string): T \| undefined` (runtime assertion) |
| `ITick` / `ITickRender` (logic vs render split) | Custom `ITick` + `scene.onBeforeRenderObservable` |
| `Activity` (coroutine-linked state machine) | Custom `Activity` abstract class + `ActivityRunner` |
| `Condition System` (token-based trait toggles) | `ConditionManager` with reference-counted tokens |
| `WeaponInfo` (YAML weapon config) | `WeaponConfig` with JSON Schema validation |
| `Player` (PlayerActor pattern) | `Player` class + component-based PlayerActor |
| `Requires<T>` (compile-time dependency) | Build-time JSON Schema validation + topological sort |
| `ScreenMap` (2D screen coordinate hash) | `scene.pick()` raycasting + GPU picker |
| `Relationships` (diplomacy bitmask) | `PlayerMask` bitmask + `RelationshipWith()` bitwise check |

## Agent Team Structure

The project uses six specialized agents defined in `.claude/agents/`, plus a dedicated acceptance test verification team in `.claude/teams/openra-acceptance-test/`:

| Agent | Spec File | Role |
|-------|-----------|------|
| **team-lead** | `team-lead.md` | Task coordination, routing, progress tracking. Does NOT write code. |
| **migration-architect** | `migration-architect.md` | Overall design, scaffolding, CI/CD, tech decisions, dependency management |
| **migration-develop** | `migration-develop.md` | TypeScript/Babylon.js implementation with unit tests |
| **migration-review** | `migration-review.md` | Code review across 5 dimensions: docs compliance, feature completeness, efficiency, bugs, format |
| **acceptance-test-assistant** | `acceptance-test-assistant.md` | Manual visual acceptance test pages for non-unit-testable modules |
| **acceptance-test-runner** | `acceptance-test-runner.md` | Playwright automated verification of acceptance test pages (pure orchestrator, delegates to Kimi MCP) |
| **migration-docs** | `migration-docs.md` | Documentation maintenance, progress tracking, task coordination, commit |

### Team Configurations

The project has two pre-configured team setups in `.claude/teams/`, selected by model provider:

| Model Provider | Team Config | Models Used |
|---------------|-------------|-------------|
| **DeepSeek** | `.claude/teams/openra-migration-deepseek/` | team-lead: `deepseek-v4-flash`, all others: `deepseek-v4-pro` |
| **Kimi** | `.claude/teams/openra-migration-kimi/` | all members: `kimi-k2.6` |
| **Acceptance Test** | `.claude/teams/openra-acceptance-test/` | test-runner, acceptance-tester, developer, reviewer, architect |

Spawn a team via `TeamCreate` with the appropriate config file when initiating migration work.

### Agent Communication

Agents communicate via `SendMessage` tool calls. **Team Lead handles all coordination** (merged with manager role):

```
Architect → Developer → Reviewer ─┬─→ Acceptance Tester → Team Lead (routing)
                                  └─→ Docs Manager → Team Lead (routing)
```

**Acceptance Test Verification Flow** (separate team, see `.claude/teams/openra-acceptance-test/`):

```
User / Team Lead dispatches acceptance-test team
  │
  ▼
test-runner (writes Playwright scripts, executes tests, collects evidence)
  │
  ├── Path A (all pass): update README status → done
  │
  └── Path B (failures): escalates to acceptance-tester
        │
        ├── Path B1 (test page bug):
        │     fix → reviewer → back to test-runner (max 3 rounds)
        │       │
        │       └── test-runner re-verify passes
        │             │
        │             ▼
        │           REDUNDANCY CHECK (acceptance-tester):
        │           Audit prior fix modifications for redundancy
        │           (e.g., workarounds made obsolete by root-cause fix)
        │             │
        │             ├── Redundant changes found → revert them
        │             │     └── test-runner FINAL re-verification
        │             │
        │             └── No redundancy
        │                   └── test-runner FINAL re-verification
        │                         │
        │                         └── PASS → COMMIT (gate unlocked)
        │
        └── Path B2 (source code bug):
              ├── B2a (minor, <=2 files):
              │     developer fixes + negative tests → reviewer → back to test-runner (max 3 rounds)
              │       │
              │       └── test-runner re-verify passes
              │             │
              │             ▼
              │           REDUNDANCY CHECK (developer):
              │           Audit prior bug-fix modifications for redundancy
              │           (e.g., workarounds made obsolete by root-cause fix)
              │             │
              │             ├── Redundant changes found → revert them
              │             │     └── test-runner FINAL re-verification
              │             │
              │             └── No redundancy
              │                   └── test-runner FINAL re-verification
              │                         │
              │                         └── PASS → COMMIT (gate unlocked)
              │
              └── B2b (major, >2 files or interface changes):
                    architect re-plans → reports to user

⚠️ COMMIT GATE (bug-fix phase only, Path B1/B2a): No commits allowed until test-runner's FINAL re-verification passes. Bug not fully resolved = commit gate locked.
   During initial test page DEVELOPMENT: normal commit rules apply — commit after reviewer APPROVED. Redundancy check + commit gate are NOT activated for new page creation.
```

### Agent Rules

**Team Lead must NOT modify code files.** The Team Lead cannot directly edit any source files (`.ts` / `.test.ts` / `.json` / `.css` / `.html`). They can only:

- Read files to understand project state
- Send tasks to sub-agents via `SendMessage`
- Route questions and feedback to the appropriate sub-agent
- Commit documentation updates that sub-agents have staged but cannot commit due to sandbox restrictions

Sub-agents (Architect, Developer, Reviewer, Acceptance Tester, Docs Manager) have full read/write access to the files within their domain.

- **Acceptance Tester may commit test code** — can write and commit files under `src/__e2e__/manual/` after verifying `tsc --noEmit` passes. **During development phase**: commit after migration-review APPROVED (normal rules). **During bug-fix phase (Path B1/B2a)**: commit gate is active — no commit until `test-runner`'s final re-verification passes (see Acceptance Test Verification Flow above). Bug not fully resolved = commit locked.
- **Acceptance test pages belong to acceptance-test-assistant** — all modifications, fixes, and thinking related to files under `src/__e2e__/manual/` must be delegated to the acceptance-test-assistant agent. The Team Lead and other agents should NOT directly modify these files.
- **Acceptance Tester creates test pages** — can write `.html`, `.ts`, `.md` files under `src/__e2e__/manual/`, verify with `tsc --noEmit`
- **Acceptance Tester commits after Reviewer APPROVED** — test pages must pass Reviewer's acceptance test review before commit (or commit and amend after approval)

## Development Workflow

### Migration Pipeline (per file)

1. **Team Lead** assigns task to Architect (if design needed) or Developer
2. **Architect** (if needed): analyzes OpenRA source, writes design spec, updates migration plan
3. **Developer**: reads OpenRA source + migration docs, implements TypeScript + unit tests, self-reviews
4. **Reviewer** (Code Review): reviews implementation across 5 dimensions (docs compliance, feature completeness, efficiency, bugs, format), assigns severity (BLOCKER/MAJOR/MINOR/INFO)
5. **Developer**: fixes review findings, resubmits (may require multiple rounds)
6. **Acceptance Tester** + **Docs Manager** (parallel start on code review APPROVED): Acceptance Tester creates manual visual acceptance test pages if needed; Docs Manager begins documentation updates
7. **Reviewer** (Acceptance Test Review): after Acceptance Tester completes, reviews the test pages across 5 dimensions; if NEEDS FIXES → Acceptance Tester fixes (max 5 rounds), then re-reviews
8. Finalize: Acceptance Tester commits test code (after test review APPROVED); Docs Manager commits documentation updates (independent of test review timing)

### Project Conventions

- **OpenRA/ is read-only** — original C# source is for reference only, never modify it
- **Directory parity** — `src/` paths must mirror `OpenRA/` paths for all migrated files
- **ESM only** — all code uses ES modules
- **Babylon.js tree-shaking** — import from `@babylonjs/core`, not the legacy barrel export
- **Mock Babylon.js in unit tests** — happy-dom has no WebGL, all `@babylonjs/core` imports must be mocked
- **Dispose pattern** — any class creating GPU resources must implement `dispose()`
- **No per-frame allocation** — hot-path code must reuse objects
- **File header required** — every migrated `.ts` file must have a header with OpenRA file reference and paradigm mapping notes

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
# Main app: http://localhost:5173/
# Acceptance test hub: http://localhost:5173/test/

# Build for production
npm run build

# Preview production build
npm run preview

# Run unit tests
npm test

# Type-check
npx tsc --noEmit
```

## Acceptance Testing (Manual Visual Verification)

The project includes a framework for manual visual acceptance testing of modules that cannot be verified through automated unit tests (animation, shader effects, visual layout, interaction feel, etc.). This is a **dev-only** infrastructure -- test pages are excluded from production builds.

### URL Scheme

| URL | Maps To | Purpose |
|-----|---------|---------|
| `/` | `index.html` | Main application |
| `/test/` | `src/__e2e__/manual/index.html` | Hub page listing all test pages |
| `/test/{ch-num-title}/{test-case}/` | `src/__e2e__/manual/{ch-num-title}/{test-case}/index.html` | Individual test case |

All `/test/` URLs are available only in dev mode (`npm run dev`). Production builds (`npm run build`) exclude all test pages from `dist/` via `build.rollupOptions.input` (only `index.html` is included).

### How It Works

- **`vite.config.ts`** uses a custom dev-only plugin (`vite-plugin-test-routes`) that rewrites `/test/...` URLs to `/src/__e2e__/manual/...` on the filesystem. Old `/src/__e2e__/manual/...` page URLs are blocked (404) to enforce the canonical `/test/` prefix.
- **Hub page auto-discovery**: `src/__e2e__/manual/main.ts` uses `import.meta.glob('./**/index.html', { eager: false })` to discover all test pages at dev server startup. No manual route registration is needed.
- **HMR-aware**: The hub page re-renders the test list on hot module updates, so adding a new test page directory takes effect after dev server restart or HMR refresh.

### Creating a New Test Page

1. Create a directory: `src/__e2e__/manual/ch{num}-{title}/{test-case-id}/`
   where `ch{num}-{title}` matches the chapter (e.g., `ch02-rendering`, `ch14-activities`), and `{test-case-id}` is a descriptive kebab-case name
2. Add three files inside:
   - `index.html` -- HTML entry point with inline styles and layout (see page template in `.claude/agents/acceptance-test-assistant.md`)
   - `main.ts` -- TypeScript logic + Babylon.js scene setup
   - `README.md` -- Expected results (at least 3 quantifiable criteria) + verification step-by-step
3. No config changes needed -- the hub page auto-discovers the new directory on next dev server start
4. Access the page at `http://localhost:5173/test/ch{num}-{title}/{test-case-id}/`

The agent responsible for creating these test pages is defined in `.claude/agents/acceptance-test-assistant.md`.

## Key Documentation

| Document | Description |
|----------|-------------|
| [docs/rendering_migration_plan.md](docs/rendering_migration_plan.md) | Chapter 2 rendering engine migration plan with TODO checklist and file mapping table (27 migration items, 100% complete) |
| [docs/actor_system_migration_plan.md](docs/actor_system_migration_plan.md) | Chapter 3 actor system migration plan with TODO checklist (36 total: 17 Phase A primitives + 14 core + 5 support; 61 TODO items) |
| [docs/openra_migration.agent.final.converted.md](docs/openra_migration.agent.final.converted.md) | Comprehensive OpenRA architecture analysis (~199KB) covering rendering, actor system, networking, resources |
| [docs/map_system_migration_plan.md](docs/map_system_migration_plan.md) | Chapter 4 map & terrain system migration plan with TODO checklist (37 files, 9 phases A-I, 100% complete) |
| [docs/ui_system_migration_plan.md](docs/ui_system_migration_plan.md) | Chapter 5 UI system & resource management migration plan (16 files, 5 phases A-E, 100% complete) |
| [docs/network_sync_migration_plan.md](docs/network_sync_migration_plan.md) | Network sync & game logic migration plan (29 files, 5 phases A-E, 100% complete) |
| [docs/input_camera_audio_effects_migration_plan.md](docs/input_camera_audio_effects_migration_plan.md) | Chapter 7 input, camera, audio & effects migration plan (13 files, 7 phases A-G, ALL PHASES COMPLETE) |
| [docs/chapter8_weapons_combat_migration_plan.md](docs/chapter8_weapons_combat_migration_plan.md) | Chapter 8 weapons & combat system migration plan with TODO checklist (57 files, 5 phases A-E, ALL PHASES COMPLETE: 57/57, 758 tests) |
| [docs/chapter9_movement_physics_migration_plan.md](docs/chapter9_movement_physics_migration_plan.md) | Chapter 9 unit movement & physics migration plan with TODO checklist (32 files, 4 phases A-D, COMPLETE: 30/30 active, 2 deferred, 1,084 tests) |
| [docs/chapter10_resource_economy_migration_plan.md](docs/chapter10_resource_economy_migration_plan.md) | Chapter 10 resource & economy system migration plan with TODO checklist (25 files, Phases A-B + B-Optional COMPLETE, 972 tests) |
| [docs/chapter11_production_building_migration_plan.md](docs/chapter11_production_building_migration_plan.md) | Chapter 11 production & building system migration plan with TODO checklist (37 files, 2 phases A-B, ALL PHASES COMPLETE, ~771 tests) |
| [docs/chapter12_shroud_fog_of_war_migration_plan.md](docs/chapter12_shroud_fog_of_war_migration_plan.md) | Chapter 12 shroud & fog of war migration plan with TODO checklist (16 files, Phase A, 100% COMPLETE) |
| [docs/chapter13_support_powers_migration_plan.md](docs/chapter13_support_powers_migration_plan.md) | Chapter 13 support powers migration plan with TODO checklist (14 files + 1 interface, Phase A, 100% COMPLETE, 285 tests) |
| [docs/chapter15_order_generators_migration_plan.md](docs/chapter15_order_generators_migration_plan.md) | Chapter 15 order generators migration plan with TODO checklist (11 files, 3 phases A-C, 3/11 already migrated from Ch11) |
| [docs/chapter17_replay_save_system_migration_plan.md](docs/chapter17_replay_save_system_migration_plan.md) | Chapter 17 replay & save system migration plan with TODO checklist (8 files, 4 phases A-D, COMPLETE, 237 tests) |
| [docs/chapter18_server_system_migration_plan.md](docs/chapter18_server_system_migration_plan.md) | Chapter 18 server system migration plan with TODO checklist (10 files, 4 phases A-D, COMPLETE, 240 tests) |
| [docs/chapter19_mod_content_migration_plan.md](docs/chapter19_mod_content_migration_plan.md) | Chapter 19 mod-specific content migration plan with TODO checklist (119 files, 4 phases A-D, ALL PHASES COMPLETE, 45 deferred) |
| [docs/chapter20_scripting_system_migration_plan.md](docs/chapter20_scripting_system_migration_plan.md) | Chapter 20 scripting system migration plan with TODO checklist (62 files, 7 phases A-G, ALL PHASES COMPLETE) |
| [docs/chapter21_editor_utilities_tooling_migration_plan.md](docs/chapter21_editor_utilities_tooling_migration_plan.md) | Chapter 21 editor, utilities & tooling migration plan with TODO checklist (~91 files, 7 phases A-G, ALL PHASES COMPLETE) |
| [docs/chapter22_game_entry_migration_plan.md](docs/chapter22_game_entry_migration_plan.md) | Chapter 22 game entry & application shell migration plan with TODO checklist (7 files, 5 phases A-E, ALL PHASES COMPLETE) |
| [docs/chapter23_mix_runtime_plan.md](docs/chapter23_mix_runtime_plan.md) | Chapter 23: MIX file format runtime parsing — CDN MIX extraction |
| [docs/chapter24_animation_effects_plan.md](docs/chapter24_animation_effects_plan.md) | Chapter 24: Animation & 3D visual effects — AnimationStub replacement + C&C effects |
| [docs/chapter25_shroud_3d_plan.md](docs/chapter25_shroud_3d_plan.md) | Chapter 25: Shroud & Fog of War 3D — vertex-based fog visualization |
| [docs/chapter26_gameworld_integration_plan.md](docs/chapter26_gameworld_integration_plan.md) | Chapter 26: Game World & Shellmap — map loading, actor spawning, skirmish |
| [docs/game_entry_design.md](docs/game_entry_design.md) | Chapter 22 original architecture design document (merged into chapter22 plan) |
| [docs/remaining_systems_migration_plan.md](docs/remaining_systems_migration_plan.md) | Chapters 8-22 remaining systems migration plan (15 chapters, Ch8-20 COMPLETE, Ch21-22 PLANNING) |
| [docs/post_migration_completion_plan.md](docs/post_migration_completion_plan.md) | Post-migration completion plan: 52 genuinely unfinished items across 5 phases A-E (Runtime Critical, 3D Rendering, Shroud/Fog, Infrastructure, Mod Polish) |
| [docs/acceptance_test_completion_plan.md](docs/acceptance_test_completion_plan.md) | Acceptance test completion plan: 31 new test pages across 10 phases P0-P3, covering Ch08/21/07/11/05/09/16/03/20 |
| [docs/content_installer_design.md](docs/content_installer_design.md) | Web Content Installer pipeline design — download from OpenRA mirrors, SHA1 verify, MIX extraction |
| [docs/content_installer_execution_plan.md](docs/content_installer_execution_plan.md) | Content Installer execution plan — 25 tasks across 3 phases (A-C), ALL PHASES COMPLETE (100%) |
| [docs/migration_progress.md](docs/migration_progress.md) | Overall migration progress tracker with file statuses, dependency graph, and recommended next tasks |
| [CLAUDE.md](CLAUDE.md) | This file — project overview, agent team structure, and development workflow |

## License

This project is based on [OpenRA](https://github.com/OpenRA/OpenRA), which is licensed under GPL-3.0.
