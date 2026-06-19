# OpenRAWeb3D Migration Progress

> **Last updated**: 2026-06-19
> **Current phase**: 🎉 ALL CHAPTERS 2-22 COMPLETE (100%). Content Installer Phase A COMPLETE.
> **Overall status**: Chapters 2-21 COMPLETE: Ch2-20: 665/665 (100%) + Ch21: 54+ active files (100%, ALL PHASES A-G COMPLETE, 25 deferred + 12 legacy deferred). Chapter 22: ALL 5 PHASES COMPLETE (100%, 7 impl/test files + build script + 150+ generated assets). Content Installer: Phase A COMPLETE (13/13, 34 files, ~4,800 impl lines, 171 tests). Total project: ~763+ files + 34 content installer files, all **100% complete** 🎉.
> **Planning document**: [docs/remaining_systems_migration_plan.md](docs/remaining_systems_migration_plan.md)

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
| **Chapter 5 planned files** | 16 (5 Phases A-E, all phases complete) |
| **Chapter 5 status** | COMPLETE: 16/16 (100%), Phase A (FileSystem Foundation) COMPLETE, Phase B (C&C Package Formats) COMPLETE, Phase C (MOD System Core) COMPLETE, Phase D (UI Widget Core) COMPLETE, Phase E (World Interaction Bridge) COMPLETE |
| **Chapter 8 planned files (Weapons & Combat)** | 57 (56 core + 1 optional MusicInfo; 5 Phases A-E: 15 Warheads + 7 Projectiles + 2-3 Config + 17 Core Combat Traits + 15 Support Traits), **57/57 (100%, ALL PHASES COMPLETE)**, ~8,264 C# lines source, ~24,870 combined TS lines, 758 tests |
| **Chapter 9 planned files (Movement & Physics)** | 32 (30 active + 2 deferred; 4 Phases A-D COMPLETE), 30/30 active migrated, 2 deferred, ~11,723 TS lines, 1,084 tests. See [chapter9_movement_physics_migration_plan.md](docs/chapter9_movement_physics_migration_plan.md) |
| **Chapter 10 planned files (Resource & Economy)** | 17 core (2 Phases A-B) + 8 optional, ALL PHASES COMPLETE: 25/25 (100%), Phase A: 8/8, Phase B: 11/11, Phase B-Optional: 8/8, 972 tests |
| **Chapter 11 planned files (Production & Building)** | ~25 original plan + 13 additional = 37 total (2 Phases A-B), 37/37 COMPLETE, ALL PHASES COMPLETE |
| **Chapter 12 planned files (Shroud & Fog of War)** | 16 (1 Phase A), COMPLETE: 16/16 APPROVED. Plan: [docs/chapter12_shroud_fog_of_war_migration_plan.md](docs/chapter12_shroud_fog_of_war_migration_plan.md) |
| **Chapter 13 planned files (Support Powers)** | 14 + 1 interface (1 Phase A), COMPLETE: 14/14 APPROVED, 285 tests. Plan: [docs/chapter13_support_powers_migration_plan.md](docs/chapter13_support_powers_migration_plan.md) |
| **Chapter 14 planned files (Activity Implementations)** | 49 concrete + 2 already-migrated base files (6 Phases A-F planned), **49/49 (100%, ALL PHASES COMPLETE)**, ~421+~48+45 tests. Plans: [chapter14_activity_implementations_analysis.md](docs/chapter14_activity_implementations_analysis.md), [chapter14_activity_implementations_migration_plan.md](docs/chapter14_activity_implementations_migration_plan.md), [chapter14_phase_d_plan.md](docs/chapter14_phase_d_plan.md) |
| **Chapter 15 planned files (Order Generators)** | 11 (3 Phases A-C), **11/11 (100%, ALL PHASES COMPLETE, 206 tests)**. Plan: [chapter15_order_generators_migration_plan.md](docs/chapter15_order_generators_migration_plan.md) |
| **Chapter 16 planned files (UI Widget Extensions)** | 65 (3 Phases A-C, ALL PHASES COMPLETE. Plan: [chapter16_ui_widget_extensions_migration_plan.md](docs/chapter16_ui_widget_extensions_migration_plan.md)), 65/65 migrated, 100%, 1,900+ tests |
| **Chapter 17 planned files (Replay & Save)** | 8 (4 Phases A-D, ALL PHASES COMPLETE. Plan: [chapter17_replay_save_system_migration_plan.md](docs/chapter17_replay_save_system_migration_plan.md)), 8/8 migrated, 100%, 237 tests |
| **Chapter 18 planned files (Server System)** | 10 (4 Phases A-D, ALL PHASES COMPLETE. Plan: [chapter18_server_system_migration_plan.md](docs/chapter18_server_system_migration_plan.md)), 10/10 migrated, 100%, ALL PHASES A-D COMPLETE, 240 tests |
| **Chapter 19 planned files (Mod-Specific C&C/D2K)** | **119** (4 Phases A-D planned, 45 deferred). Plan: [chapter19_mod_content_migration_plan.md](docs/chapter19_mod_content_migration_plan.md). Phase A (C&C Core): 47/47 COMPLETE (R2 APPROVED, ~528 tests), Phase B (D2K): 17/17 COMPLETE (R2 APPROVED, ~234 tests), Phase C (Rendering/Voxel): 37/37 COMPLETE (R2 APPROVED, ~200 tests), Phase D (Infrastructure): 18/18 COMPLETE (ALL APPROVED, ~120 tests). 119/119 migrated (100%, ALL PHASES A-D COMPLETE). |
| **Chapter 20 planned files (Scripting System)** | **62** total (62 migrated; 7 Phases A-G). ALL PHASES A-G COMPLETE (62/62, 100%). Phase A (Scripting Core): COMPLETE (7 files, ~128 tests). Phase B (Trigger System): COMPLETE (3+1 files, 88 tests). Phase C (Global API Tables): COMPLETE (16+1 files, 84 tests). Phase D (Actor Properties): COMPLETE (29 files). Phase E (Player Properties): COMPLETE (5 files). Phase F (C&C Mod Properties): COMPLETE (4 files). Phase G (Lua VM): COMPLETE (fengari integration). Plan: [docs/chapter20_scripting_system_migration_plan.md](docs/chapter20_scripting_system_migration_plan.md) |
| **Chapter 21 planned files (Editor & Utilities)** | ~91 (7 Phases A-G, 54 active + 25 deferred + 12 legacy import), **ALL PHASES A-G COMPLETE (54+ active files, 100%)**. Plan: [chapter21_editor_utilities_tooling_migration_plan.md](docs/chapter21_editor_utilities_tooling_migration_plan.md) |
| **Chapter 22 planned files (Game Entry & App Shell)** | 7 (5 Phases A-E planned, 4 impl + 3 test files + build script + 150+ generated assets), **7/7 migrated (ALL PHASES A-E COMPLETE, 100%, ~132 tests)**. Plan: [chapter22_game_entry_migration_plan.md](docs/chapter22_game_entry_migration_plan.md) |
| **Overall project completion** | ALL Chapters 2-22 COMPLETE (665/665 + 54+ active + 7 = ~726+ files, **100%**). Content Installer Phase A COMPLETE (13/13 tasks, 34 new/modified files, ~4,800 impl lines, 171 tests). Post-migration completion phase: 52 remaining items tracked in [post_migration_completion_plan.md](docs/post_migration_completion_plan.md). |

> **Note**: Chapters 2-21 are fully complete (665 + 54+ active = ~719+ files, ~100%). Chapter 8 (57/57, 758 tests, ALL PHASES A-E COMPLETE). Chapter 9 (30/30 active, 1,084 tests, ALL PHASES A-D COMPLETE): Phase A (5 files, 361 tests), Phase B (4 files, 358 tests), Phase C (10 files, 175 tests), Phase D (11 files, 190 tests). 2 deferred: PathFinderOverlay, HierarchicalPathFinderOverlay. Chapter 10 ALL PHASES COMPLETE (25/25 = 17 core + 8 optional, 972 tests, ~8,665 TS lines): Phase A (8 files, 344 tests, 2 review rounds), Phase B (11 files, 425 tests), Phase B-Optional (8 files, 203 tests). **Chapter 11 ALL PHASES COMPLETE (37 files: 14 Phase A + 23 Phase B, ~9,571 TS lines, ~771 tests, 2 review rounds per phase)**. Phase A (14 files, ~4,216 TS lines, ~296 tests): ProductionQueue.ts (~1,554 TS), Production.ts (~248 TS), ClassicProductionQueue.ts (~256 TS), ProductionParadrop.ts (~148 TS), ProductionFromMapEdge.ts (~123 TS), ProductionAirdrop.ts (~156 TS), Exit.ts (~228 TS), RallyPoint.ts (~268 TS), PrimaryBuilding.ts (~185 TS), plus prereqs (Buildable, TechTree, PowerManager, DeveloperMode, ActorInitializer). Phase B (23 files, ~5,355 TS lines, ~475 tests): Building.ts (~550 TS), BuildingInfluence.ts (~180 TS), BuildingUtils.ts (~260 TS), PlaceBuilding.ts (~470 TS), PlaceBuildingOrderGenerator.ts (~600 TS), plus gap additions (ActorMap, GivesBuildableArea, LineBuildNode, Plug/Pluggable, etc.). **Chapter 12 ALL PHASES COMPLETE (16 files, Phase A APPROVED)**: Shroud.ts, ShroudRenderer.ts, FrozenActorLayer.ts, Cloak.ts, AffectsShroud.ts, FrozenUnderFog.ts, RevealsMap.ts, PlayerRadarTerrain.ts, CreatesShroud.ts, RevealsShroud.ts, HiddenUnderShroud.ts, HiddenUnderFog.ts, DetectCloaked.ts, ShroudExts.ts, ShroudPalette.ts, RevealsShroudMultiplier.ts. **Chapter 13 ALL PHASES COMPLETE (14 files + 1 interface, Phase A APPROVED, 285 tests)**: SupportPower.ts (745 TS), SupportPowerManager.ts (864 TS), AirstrikePower.ts (599 TS), NukePower.ts (731 TS), ParatroopersPower.ts (622 TS), ProduceActorPower.ts (316 TS), SpawnActorPower.ts (442 TS), GrantExternalConditionPower.ts (511 TS), DirectionalSupportPower.ts (154 TS), SelectDirectionalTarget.ts (485 TS), SupportPowerChargeBar.ts (271 TS), WithSupportPowerActivationAnimation.ts (255 TS), WithSupportPowerActivationOverlay.ts (310 TS), SupportPowerCrateAction.ts (118 TS). **Chapter 14 ALL PHASES COMPLETE (49/49 files, 100%, Phases A-F, 82+70+~180+161+~48+45 tests, 3 E2E pages)**: Phase A (11 files, 82 tests): Move.ts (~1,400 TS), MoveAdjacentTo.ts (~200 TS), MoveOnto.ts (~80 TS), MoveOntoAndTurn.ts (~70 TS), MoveWithinRange.ts (~120 TS), Drag.ts (~90 TS), Nudge.ts (~80 TS), Follow.ts (~130 TS), LocalMoveIntoTarget.ts (~110 TS), AttackMoveActivity.ts (~160 TS), MoveCooldownHelper.ts (~120 TS). Phase B (6 files, ~70 tests): Enter.ts (~350 TS), Attack.ts (~620 TS), Hunt.ts (~110 TS), CaptureActor.ts (~340 TS), Demolish.ts (~180 TS), Turn.ts (~90 TS). Phase C (12 files, ~180 tests): Fly.ts (~370 TS), TakeOff.ts (~120 TS), Land.ts (~360 TS), FlyForward.ts (~80 TS), FlyIdle.ts (~110 TS), FlyOffMap.ts (~110 TS), FlyAttack.ts (~400 TS), FlyFollow.ts (~130 TS), ReturnToBase.ts (~270 TS), FallToEarth.ts (~120 TS), DeliverBulkOrder.ts (~230 TS), Parachute.ts (~110 TS), plus shared `AircraftFlightUtils.ts`. Phase D (7 files, 161 tests): MoveToDock.ts, GenericDockSequence.ts, Resupply.ts, HarvestResource.ts, FindAndDeliverResources.ts, Sell.ts, LayMines.ts, plus shared `EconomicActivityInterfaces.ts`. Phase E (7 files, ~48 tests): EnterTransport.ts, ExitTransport.ts, UnloadCargo.ts, DeliverUnit.ts, PickupUnit.ts, RideTransport.ts, Transform.ts. Phase F (8+1 files, ~45 tests): MovePart.ts, RepairBuilding.ts, RepairBridge.ts, TeleportAttack.ts, ChronoResourceDelivery.ts, Infiltrate.ts, Disguise.ts, DonateSupplies.ts, plus shared `ActivityInterfaces.ts`. Commits: `4501c29` (Phase A), `d307624` (Phase A review), `68d9e14` (E2E), `b58a891` (Phase D), `487ba29` (Phase D fix), `1545492` (Phase E), `3b78f83` (Phase F), `bf09913` (merge ALL PHASES). **Chapter 15 ALL PHASES COMPLETE (11/11 files, 100%, Phases A-C, 59+104+43 = 206 tests)**: Phase A: OrderGenerator.ts (275 lines, 29 tests), EnterAlliedActorTargeter.ts (262 lines, 30 tests), TraitsInterfaces.ts (IOrderGenerator interface + MouseActionType + IMouseSettings). Phase B: UnitOrderGenerator.ts (~460 lines, 42 tests), RepairOrderGenerator.ts (~200 lines, 21 tests), BeaconOrderGenerator.ts (~120 lines, 13 tests), GlobalButtonOrderGenerator.ts (~300 lines, 28 tests). Phase C: GuardOrderGenerator.ts (~260 lines, 28 tests), ForceModifiersOrderGenerator.ts (~200 lines, 15 tests). All 3 Phases APPROVED (Phase A R1, Phase B R2, Phase C R2, 0 BLOCKERs across all). Commits: `d47edf3` (plan), `cb792bd` (Phase A), `5070c5b` (Phase B), `af57cb2` (Phase C), `cb6f6aa`/`5d1f760`/`ff3d917` (review fixes), `016798e`/`59e7933` (docs).

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
| `OpenRA.Game/Graphics/` | 37 | 21 | 16 | 0 |
| `OpenRA.Game/` (root) | 3 | 3 | 0 | 0 |
| `OpenRA.Game/Primitives/` | 1 | 1 | 0 | 0 |
| `OpenRA.Platforms.Default/` | 18 | 6 | 12 | 0 |
| `glsl/` | 12 | 10 | 0 + 2 NOP | 0 |
| `OpenRA.Game/Traits/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Activities/` | 0 | 0 | 0 | All |
| `OpenRA.Game/Network/` | 4 | 4 | 0 | COMPLETE (Ch6 Phase A) |
| `OpenRA.Game/FileSystem/` | 5 | 5 | 0 | COMPLETE (Ch5 Phase A) |
| `OpenRA.Game/Widgets/` | 3 | 3 | 0 | COMPLETE (Ch5 Phase D) |
| `OpenRA.Game/Map/` | 23 | 23 | 0 | COMPLETE (Ch4) |
| `OpenRA.Mods.Common/Pathfinder/` | 10 | 10 | 0 | COMPLETE (Ch4 Phase G) |
| `OpenRA.Mods.Common/Traits/` | 3 | 3 | 0 | COMPLETE (Ch4 Phase G) |
| `OpenRA.Mods.Common/Traits/BotModules/` | 14 | 14 | 0 | COMPLETE (Ch6 Phases D+E) |
| `OpenRA.Mods.Common/Traits/BotModules/Squads/` | 4 | 4 | 0 | COMPLETE (Ch6 Phase D) |
| `OpenRA.Mods.Common/Traits/BotModules/Squads/States/` | 3 | 3 | 0 | COMPLETE (Ch6 Phase E) |
| `OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/` | 3 | 3 | 0 | COMPLETE (Ch6 Phase E) |
| `OpenRA.Game/Input/` | 4 | 4 | 0 | COMPLETE (Ch7 Phase A+B) |
| `OpenRA.Mods.Common/Effects/` | 1 | 1 | 0 | COMPLETE (Ch7 Phase E) |
| `OpenRA.Mods.Common/Traits/Render/` | 2 | 2 | 0 | COMPLETE (Ch7 Phase E + Ch4 Phase G) |
| `OpenRA.Mods.Common/Widgets/` | 3 | 3 | 0 | COMPLETE (Ch5 Phase E + Ch7 Phase B + Ch7 Phase C) |
| `OpenRA.Mods.Cnc/FileSystem/` | 5 | 5 | 0 | COMPLETE (Ch5 Phase B) |
| `OpenRA.Game/GameRules/` | 2 | 2 | 0 | COMPLETE (Ch6 Phase C + Ch3 Phase E) |
| `utils/` | 1 | 1 | 0 | COMPLETE (Ch4 Phase H) |
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
| 2026-06-18 | **Ch22 Phase A Foundation (Router + ModSelector)** (2 files + 2 modified + 2 static, 51 tests) | migration-develop | migration-review | APPROVED (0 BLOCKER, 0 MAJOR, 0 MINOR). Router.ts (146 lines, 22 tests) -- client-side path router with pattern matching, pushState support, popstate listener. ModSelector.ts (249 lines, 29 tests) -- static DOM mod cards, fetch _index.json, lazy engine loading via dynamic import(). index.html rewritten as game shell. vite.config.ts switched to SPA mode. main.ts rewritten as SPA entry. Plus public/mods/_index.json + public/mods/_test/mod.json. Phase A is the first 2 of 7 chapter files migrated. 4 Phases B-E remaining. Commit: `686b312`. |
| 2026-06-18 | **Ch22 Phase B Bootstrap (Game + main.ts)** (1 file + 1 test + 1 modified, 81 tests) | migration-develop | migration-review | APPROVED (R2, 0 BLOCKERs). Game.ts (588 lines, 47 tests) -- root coordinator: instance-based Game class with Engine creation, loadMod(), startGame(), loadShellMap(), dispose(), fixed-timestep game loop at 25 TPS. Game.test.ts (~1056 lines, 47 tests) -- lifecycle, state transitions, mod loading, error handling, game loop verification. main.ts rewired with Router->ModSelector->Game flow. Combined Phase A+B: 132 tests (51 + 81), 3 Phases C-E remaining. Commits: `0a6e5d8` (initial), `ec88735` (review fixes). |
| 2026-06-18 | **MILESTONE: Chapter 21 ALL PHASES COMPLETE (54+ active files, 100%, ALL PHASES A-G COMPLETE)** | migration-develop, migration-review | migration-docs | ALL 7 PHASES A-G COMPLETE. Phase A (Editor Core): 8 files. Phase B (Editor Brushes): 10 files. Phase C (Editor UI Logic): 18 files. Phase D (Debug & Dev Tools): 7 files. Phase E (Core Build Tools): 22 files. Phase F (Docs & Export): 7 files. Phase G (Legacy Map Import): 6 files. 54+ active implementation files with tests. 25 deferred + 12 legacy import deferred. Chapters 2-21 now 100% COMPLETE (665 + 54+ = ~719+ files). Commits: `cf376cc` (Phase G), `77106c0` (Phase G), `5e88ce3` (Phase F), `3163886`/`2cfe788`/`cc06f0f`/`a764cca`/`b32bfc6` (Phase E), `a74c17f`/`e0ada03`/`e124258`/`553a1ad` (Phase D), `44fb5fd` (Phase C), earlier phases A-B. |
| 2026-06-17 | **MILESTONE: Chapter 19 ALL PHASES COMPLETE (119/119 files, 100%, ALL PHASES A-D COMPLETE, ~1,082 tests)** | migration-develop, migration-review | migration-docs | ALL 4 PHASES A-D COMPLETE: 119/119 (100%). Phase A: 47/47 (R2 APPROVED, ~528 tests). Phase B: 17/17 (R2 APPROVED, ~234 tests). Phase C: 37/37 (R2 APPROVED, ~200 tests). Phase D: 18/18 (ALL APPROVED, ~120 tests). Total: 119 implementation files, ~18,500 TS lines, 45 deferred to build-time/post-MVP. Chapters 2-19 now 100% COMPLETE (603/603). Commits: `d4ded91`, `29ec098`, `b93be83`, `847b07f`, `4573480` (Phase D). |
| 2026-06-17 | **MILESTONE: Chapter 19 Phase C COMPLETE (37/37 files, 100%, ~200 tests, ALL APPROVED R2)** | migration-develop, migration-review | migration-docs | Phase C COMPLETE (37/37, ALL APPROVED R2): C&C Rendering & Voxel -- 6 implementation batches across 6+ commits: `0977a1e` (C3 Voxel impl), `f349c4d` (C1+C2 impl), `b87b5a2` (C4+C5+C6 impl), `f1b0b24` (C4 fix), `2682352` (C1+C2 fix), `af44d57` (C3 fix). Sub-phases: C1 Render Traits (10 files), C2 Graphics Renderables (4 files), C3 Voxel Rendering Pipeline (12 files + 3 Phase D format readers), C4 Projectiles (3 files), C5 Activities (3 files), C6 Effects (3 files). Total: 37 impl files, ~5,000 TS lines, ~200 tests. Chapter 19: 101/119 (85%, Phases A-B-C COMPLETE). |
| 2026-06-17 | **MILESTONE: Chapter 19 Phase B COMPLETE (17/17 files, 100%, ~234 tests, ALL APPROVED R2)** | migration-develop, migration-review | migration-docs | Phase B COMPLETE (17/17, ALL APPROVED R2): D2K mod traits -- 4 implementation batches across 4 commits: `1c49537` (Sandworm+Spice impl: Sandworm.ts, AttackSwallow.ts, AttractsWorms.ts, SwallowActor.ts, SpiceBloom.ts, D2kResourceRenderer.ts), `5c80ec1` (Building+Visual impl: D2kBuilding.ts, BuildableTerrainLayer.ts, D2kActorPreviewPlaceBuildingPreview.ts, DamagesConcreteWarhead.ts, HarvesterInsurance.ts, WithCrumbleOverlay.ts, WithDeliveryOverlay.ts, SonicBlastRenderer.ts, SonicBlast.ts, SonicBlastRenderable.ts, D2kSpriteSequence.ts), `fe21eab` (Sandworm R1 fix), `7dba413` (Building R1 fix). 2 review rounds. Phase B total: 17 impl files, ~2,500 TS lines, ~234 tests. Chapter 19: 64/119 (54%, Phases A-B COMPLETE). |
| 2026-06-17 | **MILESTONE: Chapter 19 Phase A COMPLETE (47/47 files, 100%, ~528 tests, ALL APPROVED R2)** | migration-develop, migration-review | migration-docs | Phase A COMPLETE (47/47, ALL APPROVED R2): 4 implementation batches across 8 commits: `34b29e4` (HIGH complexity: ChronoshiftPower, Disguise, TSVeinsRenderer), `0b4f059` (Chrono+GPS traits: 8 impl + 8 test, 248 tests), `b67b989` (Infiltration System + Attack Variants: 13 files), `f8347b4` (A5-A8: Support Powers + Misc Traits + World/Resource + Conditions, 23 files). 4 review rounds: `62f4d19`, `87f1c64`, `699f5bf`, `fa9e61c`. Phase A total: 47 impl files, ~8,000 TS lines, ~528 tests. Chapter 19: 47/119 (40%). |
| 2026-06-17 | **MILESTONE: Chapter 18 ALL PHASES COMPLETE (10/10 files, 100%, 240 tests)** | migration-develop, migration-review | migration-docs | ALL 4 PHASES A-D COMPLETE: 10/10 (100%). Phase A: 3 files, 52 tests. Phase B: 2 files, 87 tests. Phase C: 2 files, 57 tests. Phase D: 3 files, 44 tests. Total: 10 implementation files (5,183 TS lines), 10 test files (4,288 test lines), 240 tests. Commits: `da21496` + `0b9b8d3` (Phase A), `374e0ad` + `d86ae8f` (Phase B), `64756ef` (Phase C), `031f275` (Phase D). Full suite: all passing. |
| 2026-06-17 | **Ch18 Phase D Server Support Systems** (3 files, 44 tests) | migration-develop | migration-review | Phase D COMPLETE. 3 implementation files: VoteKickTracker.ts (375 lines, ~16 tests) -- vote-to-kick lifecycle, eligible vote counting, cooldown enforcement, admin dead-but-online edge case handling. MapStatusCache.ts (306 lines, ~15 tests) -- cached map validation status, async remote linting via queueMicrotask, ILintServerMapPass interface. PlayerMessageTracker.ts (188 lines, ~13 tests) -- chat flood control with join cooldown, message count limits, admin bypass, DisableChatEntry order dispatch. Total: 869 TS implementation lines, 44 tests, ~1,327 test lines. Commit: `031f275`. Chapter 18: 10/10 (100%, ALL PHASES COMPLETE). |
| 2026-06-17 | **Ch18 Phase C Connection Layer** (2 files, 57 tests) | migration-develop | migration-review | Phase C COMPLETE. 2 implementation files: Connection.ts (425 lines, ~30 tests) -- per-client WebSocket connection handler, packet header/data state machine, ping measurement, multi-packet buffering, send queue, dispose/close lifecycle. OrderBuffer.ts (293 lines, ~27 tests) -- dynamic order timing system, per-player delta median computation, tick scale adjustment (1.0-1.1 range), baseline player tracking, player removal handling. Total: 718 TS implementation lines, 57 tests (30 + 27), ~1,074 test lines. Commit: `64756ef`. Chapter 18: 7/10 (70%). |
| 2026-06-17 | **Ch18 Phase B Server Core** (2 files, 87 tests) | migration-develop | migration-review | Phase B COMPLETE (R2 APPROVED). 2 implementation files: SessionTypes.ts (695 lines, 35 tests) -- full Session/Client/Slot/GlobalSettings types, serialization/deserialization. Server.ts (2,397 lines, 52 tests) -- complete game server orchestrator: WebSocket transport abstraction, client lifecycle (accept/validate/drop), order broadcasting (unicast/broadcast), sync hash verification, lobby synchronization (info/clients/slots/global), game start/end, chat/command interpretation, save/load integration, player defeat tracking, ping quality monitoring. Combined Phase A+B: 5/10 files, ~3,596 TS lines, 139 tests. Commits: `374e0ad` (initial implementation), `d86ae8f` (docs). Chapter 18: 5/10 (50%). |
| 2026-06-17 | **Ch18 Phase A Protocol & Interfaces Foundation** (3 files, 52 tests) | migration-develop | migration-review | Phase A COMPLETE. 3 implementation files: ProtocolVersion.ts (206 lines, 16 tests) -- binary protocol constants, packet framing, order type byte enum, handshake flow documentation. TraitInterfaces.ts (257 lines, 22 tests) -- 9 server trait interfaces (IInterpretCommand, INotifySyncLobbyInfo, INotifyServerStart, INotifyServerEmpty, INotifyServerShutdown, IStartGame, IClientJoined, IEndGame, ITick), ServerTrait abstract base, DebugServerTrait debug implementation. Exts.ts (41 lines, 14 tests) -- `except()` utility function. All 3 files independent, zero internal deps, zero deps on rest of codebase. 3 test files, 52 tests all passing (16 + 22 + 14). Commits: `da21496` (initial implementation), `0b9b8d3` (review fixes). Chapter 18: 3/9 (33%). |
|| 2026-06-16 | **Ch15 Phase C Extended Order Generators** (2 files, 43 tests) | migration-develop | migration-review | Phase C APPROVED (R2, 0 BLOCKERs, 0 MAJORs, 0 MINORs). 2 implementation files: GuardOrderGenerator.ts (~260 lines, 28 tests) -- guard command mode extending UnitOrderGenerator, friendly guardable unit targeting, selectionChanged auto-cancel, FriendlyGuardableUnits static helper. ForceModifiersOrderGenerator.ts (~200 lines, 15 tests) -- modifier key passthrough decorator extending UnitOrderGenerator, modifiers.or() bitwise OR, cancelOnFirstUse behavior, clearSelectionOnLeftClick=false override. 2 test files, 43 tests all passing (28 + 15). 9869 total tests pass. Commits: `af57cb2` (implementation), `ff3d917` (review fixes). Chapter 15: 11/11 (100%, ALL PHASES COMPLETE). |
| 2026-06-16 | **Ch15 Phase B Core Order Generators** (4 files, 104 tests) | migration-develop | migration-review | Phase B APPROVED (R2, 0 BLOCKERs, 0 MAJORs, 0 MINORs). 4 implementation files: UnitOrderGenerator.ts (~460 lines, 42 tests) -- main unit command generator, targetForInput resolution (live actor > frozen actor > cell), orderForUnit two-pass trait iteration, cursor resolution, CreateGroup APM tracking. RepairOrderGenerator.ts (~200 lines, 21 tests) -- repair cursor mode, RepairableBuilding/Repairable/RepairableNear paths, game-over auto-cancel. BeaconOrderGenerator.ts (~120 lines, 13 tests) -- one-shot beacon placement, suppressVisualFeedback. GlobalButtonOrderGenerator.ts (~300 lines, 28 tests) -- generic base (traitKey string parameter), PowerDownOrderGenerator + SellOrderGenerator concretions. 4 test files, 104 tests all passing (42+21+13+28). 9826 total tests pass. Commits: `5070c5b` (implementation), `5d1f760` (review fixes). Chapter 15: 7/11 (64%, Phases A-B COMPLETE). |
| 2026-06-16 | **Ch15 Phase A Order Generator Foundation** (2 files + TraitsInterfaces update) | migration-develop | migration-review | Phase A APPROVED (R1, 0 BLOCKERs, 0 MAJORs, 3 MINORs). 2 implementation files: OrderGenerator.ts (275 lines, 29 tests) -- abstract base class for all concrete order generators, button dispatch logic, cancel-on-game-over, Classic mode selection clearing. EnterAlliedActorTargeter.ts (262 lines, 30 tests) -- allied-actor enter targeter extending UnitOrderTargeter, alliance check, trait key validation, cursor resolution. TraitsInterfaces.ts updates: IOrderGenerator interface verification + MouseActionType enum + IMouseSettings interface. 2 test files, 59 tests all passing (29 + 30). Foundation for Phases B-C (all 6 remaining generators extend OrderGenerator). Commit: `cb792bd`. Chapter 15: 3/11 (27%, Phase A COMPLETE). |
| 2026-06-16 | **MILESTONE: Chapter 16 ALL PHASES COMPLETE (65/65 files, 100%, 1,900+ tests)** | migration-develop, migration-review | migration-docs | ALL 3 PHASES A-C COMPLETE: 65/65 (100%). Phase A: 23+7 deps, 998 tests. Phase B: 17 files, 577 tests. Phase C: 25 files, 325 tests. Total: 1,900+ tests, 21 commits, 0 residual BLOCKERs. Full suite: 426 test files, 11,649 tests ALL PASSING. |
| 2026-06-16 | **Ch16 Phase C Menu Screen Logic** (25 files, 325 tests) | | | Phase C COMPLETE (R1, 6 BLOCKER + 10 MAJOR fixed). 25 files: MainMenu, LobbyLogic+LobbyUtils+LobbyOptions, ServerList, ServerCreation, Connection, SettingsLogic+7 sub-screens, MapChooser, MissionBrowser, MapGenerator, LoadGameBrowser, ReplayBrowser, GameSaveBrowser, Encyclopedia, MusicPlayer, Credits, MapPreviewWidget. Commits: `65236da`..`883bf6e`. |
| 2026-06-16 | **Ch16 Phase B Game HUD Widgets & Utilities** (17 files, 577 tests) |  ProductionPaletteWidget.ts (~1010 lines, 41 tests) -- production icon grid with CSS conic-gradient clock overlay, ProductionTabsWidget.ts (~690 lines, 23 tests), ProductionTypeButtonWidget.ts (~85 lines, 13 tests), SupportPowersWidget.ts (~720 lines, 33 tests), SupportPowerTimerWidget.ts (~230 lines, 25 tests), RadarWidget.ts (~1030 lines, 40 tests) -- Canvas 2D minimap with terrain/actor/shroud layers, ResourceBarWidget.ts (~420 lines, 47 tests), ResourcePreviewWidget.ts (~310 lines, 14 tests), ControlGroupsWidget.ts (~310 lines, 15 tests), StrategicProgressWidget.ts (~370 lines, 44 tests), ConfirmationDialogs.ts (~200 lines, 36 tests), TextNotificationsDisplayWidget.ts (~440 lines, 26 tests), ProgressBarWidget.ts (~350 lines, 41 tests), LogicTickerWidget.ts (~100 lines, 12 tests), LogicKeyListenerWidget.ts (~170 lines, 22 tests), ColorMixerWidget.ts (~710 lines, 30 tests). 17 test files. Commits: `2a349b5` (utility widgets), `68f9273` (dialogs+bars), `ba1bcb1` (WidgetUtils), `83a25be` (production HUD), `a15bd7a` (radar+support powers+control groups), `0ef828d` (review fix: clock angle + DOM caching + perf), `80ece3a` (review fix: double-callback + isometric coords). Total: ~9,700 TS implementation lines + ~9,100 test lines, 577 tests. Full suite: 11,323/11,324 pass (1 unrelated flake). Chapter 16: 40/65 (62%, Phases A+B COMPLETE). |
| 2026-06-16 | **Ch16 Phase A Primitive UI Controls** (23 files + 7 deps, 998 tests) | migration-develop | migration-review | Phase A COMPLETE (R1, 1 BLOCKER + 5 MAJOR fixed). 23 implementation files: ButtonWidget.ts (~1168 lines, 79 tests), LabelWidget.ts (~574 lines, 41 tests), ImageWidget.ts (~340 lines), CheckboxWidget.ts (~269 lines, 52 tests), TextFieldWidget.ts (~780 lines, 123 tests), PasswordFieldWidget.ts (~80 lines, 6 tests), SliderWidget.ts (~389 lines, 60 tests), ExponentialSliderWidget.ts (~215 lines, 46 tests), DropDownButtonWidget.ts (~540 lines, 27 tests), ScrollPanelWidget.ts (~1236 lines, 96 tests), ScrollItemWidget.ts (~232 lines, 42 tests), HotkeyEntryWidget.ts (~380 lines, 33 tests), TooltipContainerWidget.ts (~330 lines, 23 tests), LabelWithTooltipWidget.ts (~210 lines, 19 tests), LabelWithHighlightWidget.ts (~310 lines, 22 tests), LabelForInputWidget.ts (~280 lines, 17 tests), SpriteWidget.ts (~370 lines), RGBASpriteWidget.ts (~220 lines), ColorBlockWidget.ts (~320 lines), GradientColorBlockWidget.ts (~370 lines), BackgroundWidget.ts (~220 lines), GridLayout.ts (~180 lines, 14 tests), ListLayout.ts (~113 lines). Plus 7 dependency files: TextAlign.ts, TextFieldType.ts, ILayout.ts + test files for all. Commits: `82ea537` (TextField+PasswordField), `95552bf` (Button+Label), `88b41de` (ScrollPanel+ScrollItem+ILayout+ListLayout), `644d9ea` (Checkbox+Slider+ExponentialSlider), `e5b926e` (Image+ColorBlock+Gradient+Background+Sprite+RGBASprite), `9c729de` (DropDown+HotkeyEntry+TooltipContainer+LabelVariants+GridLayout), `02cd489` (review fix: BLOCKER hotkey modifier + MAJOR usableWidth), `864f6a0` (review fix: 4 MAJOR across ScrollPanel+ScrollItem+TextField+HotkeyEntry). Total: ~8,500 TS implementation lines, 998 widget tests (25 test files), full suite: 10,729/10,730 tests pass (1 unrelated performance flake). Chapter 16: 23/65 (35%, Phase A COMPLETE). |
| 2026-06-16 | **MILESTONE: Chapter 15 ALL PHASES COMPLETE (11/11 files, 100%, 206 tests)** | migration-develop, migration-review | migration-docs | All 3 phases A-C COMPLETE: Phase A (3 files, 59 tests, APPROVED R1), Phase B (4 files, 104 tests, APPROVED R2), Phase C (2 files, 43 tests, APPROVED R2). Plus 3 already-migrated from Ch11: UnitOrderTargeter, DeployOrderTargeter, PlaceBuildingOrderGenerator. Total: 11 files (8 new + 3 existing), ~1,870 TS lines, 206 new tests, 9869 total test suite pass. ALL PHASES APPROVED with 0 BLOCKERs across all rounds. Commits: `d47edf3` (plan), `cb792bd` (Phase A), `5070c5b` (Phase B), `af57cb2` (Phase C), `cb6f6aa`/`5d1f760`/`ff3d917` (review fixes), `016798e`/`59e7933` (docs). Chapters 2-15 now 100% COMPLETE (401/401 files). Chapters 16-21 remaining: 0/~160 (0%). |
| 2026-06-15 | **Ch13 Phase A Support Powers** (14 files + 1 interface) | migration-develop | migration-review | Phase A COMPLETE (R2 APPROVED). 14 files: SupportPower.ts (745 TS, 30 tests), SupportPowerManager.ts (864 TS, 62 tests), AirstrikePower.ts (599 TS, 14 tests), NukePower.ts (731 TS, 18 tests), ParatroopersPower.ts (622 TS, 11 tests), ProduceActorPower.ts (316 TS, 10 tests), SpawnActorPower.ts (442 TS, 12 tests), GrantExternalConditionPower.ts (511 TS, 16 tests), DirectionalSupportPower.ts (154 TS, 14 tests), SelectDirectionalTarget.ts (485 TS, 43 tests), SupportPowerChargeBar.ts (271 TS, 19 tests), WithSupportPowerActivationAnimation.ts (255 TS, 14 tests), WithSupportPowerActivationOverlay.ts (310 TS, 13 tests), SupportPowerCrateAction.ts (118 TS, 7 tests). Plus INotifySupportPower interface in TraitsInterfaces.ts + Cloak.ts update. Total: 6,423 TS impl, 5,126 test lines, 285 tests. Commits: `aac45e2` (core infra), `8194110` (power implementations), `55be5d4` (render/crate), `830951d` (review fixes). Chapter 13 now 100% COMPLETE (14/14). |
| 2026-06-15 | **Ch14 Phase A Movement Activities** (11 files + 11 tests) | migration-develop | migration-review | Phase A COMPLETE (R2 APPROVED, 0 BLOCKERs). 11 implementation files (~2,660 TS lines): Move.ts (~1,400 TS, ~25 tests), MoveAdjacentTo.ts (~200 TS, ~8 tests), MoveOnto.ts (~80 TS, ~4 tests), MoveOntoAndTurn.ts (~70 TS, ~4 tests), MoveWithinRange.ts (~120 TS, ~6 tests), Drag.ts (~90 TS, ~4 tests), Nudge.ts (~80 TS, ~5 tests), Follow.ts (~130 TS, ~7 tests), LocalMoveIntoTarget.ts (~110 TS, ~5 tests), AttackMoveActivity.ts (~160 TS, ~8 tests), MoveCooldownHelper.ts (~120 TS, ~6 tests). 11 test files, 82 tests all passing. 3 E2E acceptance test pages: `activities/move/`, `activities/attack-move/`, `activities/target-lines/` (R2 APPROVED). Commits: `4501c29` (Phase A implementation), `d307624` (review fixes: 8 BLOCKER + 12 MAJOR resolved), `68d9e14` (E2E acceptance test pages). Chapter 14: 11/49 (22%, Phase A COMPLETE). |
| 2026-06-15 | **Ch12 Phase A Shroud & Fog of War** (16 files) | migration-develop | migration-review | Phase A COMPLETE (ALL APPROVED). 16 files total: Shroud.ts, ShroudRenderer.ts, FrozenActorLayer.ts, Cloak.ts, AffectsShroud.ts (`6472844`), FrozenUnderFog.ts (`1add6ae`), RevealsMap.ts (`a045d9f`), PlayerRadarTerrain.ts (`29737f7`), CreatesShroud.ts (`a15a410`), RevealsShroud.ts (`a15a410`), HiddenUnderShroud.ts (`1add6ae`), HiddenUnderFog.ts (`1add6ae`), DetectCloaked.ts (`a15a410`), ShroudExts.ts (`43a256d`), ShroudPalette.ts (`c37ef75`), RevealsShroudMultiplier.ts (`c37ef75`). E2E acceptance test page at `src/__e2e__/manual/shroud/basic/` (`dd9e69f`). Chapter 12 now 100% COMPLETE (16/16 files). |
| 2026-06-15 | **Ch11 Phase B Building System** (23 files) | migration-develop | migration-review | Phase B COMPLETE (all review findings fixed, 0 BLOCKERs). 15 original plan + 8 gap analysis additions. Original: Building.ts (~550 TS, ~45 tests), BuildingInfluence.ts (~180 TS, ~25 tests), BuildingUtils.ts (~260 TS, ~28 tests), PlaceBuilding.ts (~470 TS, ~35 tests), PlaceBuildingOrderGenerator.ts (~600 TS, ~40 tests), BaseProvider.ts (~250 TS, ~20 tests), RepairableBuilding.ts (~380 TS, ~30 tests), Gate.ts (~290 TS, ~25 tests), Transforms.ts (~310 TS, ~22 tests), Demolition.ts (~280 TS, ~20 tests), LineBuild.ts (~240 TS, ~22 tests), plus smaller files. Gap additions: ActorMap.ts (~380 TS, ~35 tests), GivesBuildableArea.ts (~80 TS), LineBuildNode.ts (~120 TS), Replacement.ts (~90 TS), Replaceable.ts (~60 TS), Plug.ts (~100 TS), Pluggable.ts (~120 TS), DeployOrderTargeter.ts + UnitOrderTargeter.ts (~280 TS). TraitsInterfaces.ts extended with ITargetableCells, IPlaceBuildingDecorationInfo, IDemolishable*, IPlaceBuildingPreview*, IOrderGenerator, EnterBehaviour, PlaceBuildingCellType. Total Phase B: ~5,355 TS impl + ~475 tests. Commits: `3428989` (prereqs), `51906f6` (BuildingInfluence), `84717e8` (infrastructure), `c73328e` (BaseBuilding+), `ddbceb8` (BuildingUtils), `fe50197` (LineBuild+), `eaebcb6` (PlaceBuilding), `2cc9e93` (PlaceBuildingOrderGenerator), `b17c914`+`ad4a0a1`+`56da79d` (review fixes). Chapter 11 now 100% COMPLETE (37/37 files, 25/25 original plan). |
| 2026-06-14 | **Ch11 Phase A Production Queue System** (14 files) | migration-develop | migration-review | Phase A COMPLETE (R2 APPROVED, 0 BLOCKERs). 9 core + 5 prerequisite files: ProductionQueue.ts (~1,554 TS, ~1,017 test lines), Production.ts (~248 TS), ClassicProductionQueue.ts (~256 TS, ~361 test lines), ProductionParadrop.ts (~148 TS, ~113 test lines), ProductionFromMapEdge.ts (~123 TS, ~105 test lines), ProductionAirdrop.ts (~156 TS, ~139 test lines), Exit.ts (~228 TS, ~227 test lines), RallyPoint.ts (~268 TS, ~211 test lines), PrimaryBuilding.ts (~185 TS, ~132 test lines). Plus prereqs: Buildable.ts (~185 TS, ~118 test), TechTree.ts (~353 TS, ~300 test), PowerManager.ts (~107 TS, ~67 test), DeveloperMode.ts (~131 TS, ~104 test), ActorInitializer.ts (~274 TS, ~214 test). Total: ~4,216 TS impl + ~4,108 test lines, ~296 tests. Commits: `cb11b31` (initial), `b012f90` (prereqs), `7a92416` (R1 fixes). |
| 2026-06-14 | **Ch10 Phase B-Optional Extended Economy Traits** (8 files) | migration-develop | migration-review | Phase B-Optional COMPLETE. 8 implementation files (~1,300 TS lines): ResourceValueMultiplier.ts (~90 lines, 6 tests), GrantConditionOnPlayerResources.ts (~180 lines, 8 tests), WithResourceLevelOverlay.ts (~200 lines, 24 tests), WithResourceLevelSpriteBody.ts (~220 lines, 24 tests), WithResourceStoragePipsDecoration.ts (~230 lines, 24 tests), WithStoresResourcesPipsDecoration.ts (~290 lines, 24 tests), CarryableHarvester.ts (~170 lines, 8 tests), SpawnActorsOnSell.ts (~400 lines, 85 tests). 5 test files, 203 tests all passing. 1 commit: `2c77e8f`. Render traits have GPU rendering calls stubbed (TODO-10.B-Opt.X-RENDER). CarryableHarvester has transport interfaces stubbed (TODO-10.B-Opt.7-TRANSPORT). Chapter 10: 25/25 (100% = 17 core + 8 optional). |
| 2026-06-14 | **Ch10 Phase B Economy Support Traits** (11 files) | migration-develop | migration-review | Phase B COMPLETE (R1, 0 BLOCKER + 5 MAJOR resolved + 5 MINOR resolved, R2 pending). 11 implementation files (~2,400 TS lines): StoresResources.ts (219), StoresPlayerResources.ts (288), PlayerResources.ts (540), Valued.ts (76), CustomSellValue.ts (118), AcceptsDeliveredCash.ts (149), GivesBounty.ts (268), GivesCashOnCapture.ts (232), CashTrickler.ts (294), DeliversCash.ts (298), Sellable.ts (314). 11 test files, 425 tests all passing. 6 commits: 4 implementation + 2 review fix. Chapter 10: 17/17 core (100%). |
| 2026-06-14 | **Ch10 Phase A Resource Infrastructure** (8 files) | migration-develop | migration-review | Phase A COMPLETE (R1, 4 BLOCKER + 4 MAJOR resolved, R2 pending). 8 implementation files (~4,965 TS lines): TraitsInterfaces.ts expansion (+497 lines, IDockHost, IAcceptResources, IResourceLayer, IResourceRenderer, IStoresResources interfaces), DockClientBase.ts (385 lines, abstract generic base class), Harvester.ts (1,075 lines, central resource-gathering orchestrator, extends DockClientBase, implements IStoresResources + ISpeedModifier + IResolveOrder), ResourceLayer.ts (799 lines, CellLayer<ResourceContents> World trait, density recalculation, cell-changed events), ResourceRenderer.ts (1,106 lines, TerrainSpriteLayer-based sprite rendering, variant selection, dirty cell tracking), ResourceClaimLayer.ts (240 lines, harvester-to-cell claim tracking), SeedsResource.ts (348 lines, timer-based resource spawner), Refinery.ts (705 lines, IAcceptResources + IDockHost implementation, dual-mode resource processing). 7 test files (6,224 test lines, 344 tests): DockClientBase.test.ts (44 tests), Harvester.test.ts (81 tests), Refinery.test.ts (43 tests), ResourceLayer.test.ts (83 tests), ResourceRenderer.test.ts (41 tests), ResourceClaimLayer.test.ts (24 tests), SeedsResource.test.ts (28 tests). 5 commits: `d65c51c` (DockClientBase + TraitsInterfaces), `548756c` (ResourceClaimLayer + SeedsResource), `d78de60` (Harvester + Refinery), `7a72af7` (ResourceLayer + ResourceRenderer), `f55ed14` (BLOCKER#1,#2 + MAJOR#1,#2 fixes), `20380ca` (4 BLOCKER + 1 MAJOR fixes). R1: 4 BLOCKER + 4 MAJOR -> NEEDS FIXES. R2: pending. Chapter 10: 8/17 core (47%). |
| 2026-06-13 | **Ch9 ALL PHASES A-D COMPLETE** (30 files) | migration-develop | migration-review | ALL PHASES COMPLETE (4 phases, 30/30 active migrated, 2 deferred). ~11,723 TS impl lines, 1,084 tests (361+358+175+190), 19 commits. Phase A (5 files, ~4,200 lines, 361 tests, 7 commits, 2 review rounds): IMove interface, Mobile.ts (1079 C# -> ~2,500 TS), Immobile.ts, Locomotor.ts (526 C# -> full upgrade from 261-line stub), PathFinder.ts. Phase B (4 files, ~3,873 lines, 358 tests, 4 commits, 1 round): Aircraft.ts (1381 C# -> ~2,500 TS), FallsToEarth.ts, BodyOrientation.ts, QuantizeFacingsFromSequence.ts. Phase C (10 files, ~2,100 lines, 175 tests, 4 commits, 1 round): SubterraneanLocomotor, SubterraneanActorLayer, BridgeLayer, LegacyBridgeLayer, ElevatedBridgeLayer, ElevatedBridgePlaceholder, TerrainTunnel, TerrainTunnelLayer, TunnelEntrance, EntersTunnels. Phase D (11 files, ~1,550 lines, 190 tests, 4 commits, 1 round): BlocksProjectiles, Crushable, AutoCrusher, TransformCrusherOnCrush, GrantConditionOnMovement, Hovers, TerrainModifiesDamage, SpeedMultiplier, AttackMove (upgrade from stub), ClassicFacingBodyOrientation, JumpjetLocomotor. Deferred: PathFinderOverlay, HierarchicalPathFinderOverlay. Chapter 9: 30/30 active (100%, ALL PHASES COMPLETE). |
| 2026-06-13 | **Ch8 Phase E Combat Support Traits** (15 files) | migration-develop | migration-review | APPROVED (R2, 1 BLOCKER + 2 MAJOR + 1 MINOR resolved): FireWarheads.ts (144 lines, 8 tests), FireWarheadsOnDeath.ts (414 lines, 24 tests), FireProjectilesOnDeath.ts (271 lines, 8 tests), AttackSounds.ts (186 lines, 7 tests), DeathSounds.ts (121 lines, 6 tests), DamageMultiplier.ts (99 lines, 6 tests), ReloadDelayMultiplier.ts (90 lines, 4 tests), InaccuracyMultiplier.ts (90 lines, 4 tests), ExplosionOnDamageTransition.ts (146 lines, 10 tests), WithMuzzleOverlay.ts (257 lines, 13 tests), WithAttackAnimation.ts (243 lines, 12 tests), WithAttackOverlay.ts (278 lines, 10 tests), Turreted.ts (581 lines, 32 tests), AttackBomber.ts (227 lines, 12 tests), AttackAircraft.ts (188 lines, 12 tests). 30 files total (15 source + 15 test), 156 tests, ~3,335 impl + ~1,859 test lines. R1: 1 BLOCKER (FireWarheadsOnDeath kill-target), 2 MAJOR (RNG >= vs >), 1 MINOR (AttackBomber super.tick comment) -> NEEDS FIXES. R2: All fixed -> APPROVED. Commits `accbced`, `b04e8e1`. Chapter 8: 57/57 (100%, ALL PHASES COMPLETE). |
| 2026-06-13 | **Ch8 Phase D Core Combat Traits** (17 files) | migration-develop | migration-review | APPROVED (R2, 3 BLOCKER + 7 MAJOR + 7 MINOR resolved): CombatInterfaces.ts, Armament.ts (~25 tests), AutoTarget.ts (~30 tests), AttackBase.ts (~20 tests), AttackTurreted.ts, AttackFrontal.ts, AttackOmni.ts, AttackMove.ts, AttackFollow.ts, AttackCharges.ts, AttackWander.ts (DEFERRED STUB), AttackGarrisoned.ts (DEFERRED STUB), HitShape.ts + HitShapeCircle.ts + HitShapeRectangle.ts + HitShapeCapsule.ts + HitShapeInfo.ts, Armor.ts, AmmoPool.ts, ReloadAmmoPool.ts, RangeMultiplier.ts, FirepowerMultiplier.ts. 38 files total (17 source + 4 hit-shape support + 1 shared interface + 16 test), 158 tests, ~7,109 lines. R1: 3 BLOCKER + 7 MAJOR + 7 MINOR -> NEEDS FIXES. R2: All fixed -> APPROVED. Commits `bbbe871`, `5cf9b93`. Chapter 8: 42/57 (74%). |
| 2026-06-13 | **Ch8 Phase C Weapon Configuration Data** (2+1 files) | migration-develop | migration-review | APPROVED (R1, 0 BLOCKERs): WeaponInfo.ts (52 tests), SoundInfo.ts (45 tests), MusicInfo.ts (18 tests) + shared: WarheadRegistry.ts + modifications: Warhead.ts (WarheadArgs extended), DelayedImpact.ts (canonical types), Bullet.ts (imports), DelayedImpact.test.ts. 11 files total (~2,923 insertions, ~100 deletions), 115 new tests. Commit `ab3b3d4`. Chapter 8: 25/56 (45%). |
| 2026-06-12 | **Ch8 Phase B Projectiles System** (7 files) | migration-develop | migration-review | APPROVED (R2): Missile.ts (32 tests), AreaBeam.ts (12 tests), Railgun.ts (13 tests), LaserZap.ts (12 tests), NukeLaunch.ts (11 tests), GravityBomb.ts (15 tests), InstantHit.ts (14 tests) + shared: MissileMath.ts (23 tests), ProjectileRegistry.ts, BeamRenderableShape.ts. 17 files total (9 source + 8 test), 186 tests, ~4,483 lines. R1: 2 BLOCKER, 8 MAJOR, 5 MINOR -> NEEDS FIXES. R2: All fixed -> APPROVED. Commits `0f02230`, `28b4602`. Chapter 8: 22/56 (39%). |
| 2026-06-12 | **Ch8 Phase A Warheads Foundation** (15 files) | migration-develop | migration-review | APPROVED (R2): Warhead.ts, DamageWarhead.ts, SpreadDamageWarhead.ts, TargetDamageWarhead.ts, CreateEffectWarhead.ts, FireClusterWarhead.ts, LeaveSmudgeWarhead.ts, DestroyResourceWarhead.ts, CreateResourceWarhead.ts, ChangeOwnerWarhead.ts, GrantExternalConditionWarhead.ts, FlashEffectWarhead.ts, ShakeScreenWarhead.ts, HealthPercentageDamageWarhead.ts, FlashTargetsInRadiusWarhead.ts. 15 impl + 4 test files = 19 files, 143 tests. R1: 1 BLOCKER (int2Lerp numerical bug), 7 MAJOR, 6 MINOR. R2: All fixed. Commits `d9f6c34`, `9b25839`. Chapter 8: 15/56 (27%). |
| 2026-06-12 | **Ch7 Phase G Sprite Rendering Traits** (2+3 files) | migration-develop | migration-review | APPROVED (R2): AnimationWithOffset.ts (163 lines, 17 tests), RenderSprites.ts (~500 lines, 37 tests), WithIdleOverlay.ts (~413 lines, 24 tests), Animation.ts (+112 lines, +9 tests), TraitsInterfaces.ts (+10 lines). ~1,198 impl + ~940 test lines, 120 tests. Commits `e108a5a`, `11e49a3`. Chapter 7 now 100% COMPLETE (13/13). |
| 2026-06-12 | **Ch7 Phase F Projectiles** (1 file) | migration-develop | migration-review | APPROVED (R2): Bullet.ts (1,463 lines). 1 test file, 56 tests. Commits `bb5358c`, `1387d82`. Chapter 7: 11/13 (~85%). |
| 2026-06-12 | **Ch7 Phase E Visual Effects** (2 files) | migration-develop | migration-review | APPROVED (2 rounds): SpriteEffect.ts + FloatingSpriteEmitter.ts. 2 test files, 92 tests. Commits `a0bf835`, `180e2a9`. Chapter 7: 10/13 (~77%). |
| 2026-06-12 | **Ch7 Phase D Audio System** (2 files) | migration-develop | migration-review | APPROVED: Sound.ts (1,383 lines), SoundDevice.ts (269 lines). 2 test files, 133 tests. Commit `3f1b511`. Chapter 7: 8/13 (~62%). |
| 2026-06-12 | **Ch7 Phase C Selection System** (1 file) | migration-develop | migration-review | APPROVED (3 rounds): SelectionUtils.ts (723 lines). 1 test file, 58 tests. Commits `ee38601`, `406df32`, `816bb5a`. Chapter 7: 6/13 (~46%). |
| 2026-06-12 | **Ch7 Phase B Camera System** (2+1 files) | migration-develop | migration-review | APPROVED (2 rounds, 3 BLOCKER + 5 MAJOR resolved): Viewport.ts (1,023 lines), ViewportControllerWidget.ts (868 lines), HotkeyReference.ts (360 lines prereq). 2 test files, 86 tests (Viewport.test.ts: 742 lines, ViewportControllerWidget.test.ts: 573 lines). ~2,251 impl + ~1,315 test lines. Commits `3688b66`, `feca8b6`, `6d722c4`. Chapter 7: 5/13 (~38%). |
| 2026-06-12 | **Ch7 Phase A Input Foundation** (3 files) | migration-develop | migration-review | APPROVED (2 rounds, 1 BLOCKER + 3 MAJOR resolved): IInputHandler.ts (176 lines), Keycode.ts (544 lines), InputHandler.ts (617 lines). 3 test files, 155 tests. ~1,337 impl lines. Commits `4260360`, `1920155`. |
| 2026-06-12 | **Ch6 Phase E AI BotModule Extended** (11 files) | migration-develop | migration-review | APPROVED (2 rounds): BaseBuilderQueueManager (~984+238 lines), MinelayerBotModule (~495+156 lines), SupportPowerDecision (~377+246 lines), GroundStates (~340+193 lines), AirStates (~283+143 lines), McvExpansionManagerBotModule (~1053+182 lines), CaptureManagerBotModule (~311+115 lines), McvManagerBotModule (~402+138 lines), BuildingRepairBotModule stub (~63+28 lines), PowerDownBotManager stub (~81+32 lines), ProtectionStates stub (~74+44 lines). Phase E: ~4,463 impl + ~1,515 test lines, 119 tests. Commits `9adf549`, `56c0c85`. Chapter 6 now 100% COMPLETE (29/29). |
| 2026-06-12 | **Ch6 Phase D AI BotModule Core** (10+1 files) | migration-develop | migration-review | APPROVED (2 rounds, 2 BLOCKER + 4 MAJOR): SquadManagerBotModule (~750 lines), BaseBuilderBotModule (~496+66 lines), UnitBuilderBotModule (~350 lines), HarvesterBotModule (~670+209 lines), SupportPowerBotModule (~290 lines), ResourceMapBotModule (~400 lines), Squad (~550 lines), AttackOrFleeFuzzy (~300 lines), StateMachine.ts+StateBase.ts (~340 lines), TraitsInterfaces.ts extension (+10 interfaces). Phase D: ~5,769 initial + ~390 fix lines. Commits `fee0774`, `51c6265`. |
| 2026-06-12 | **Ch6 Phase C Ruleset Container** (2+1 files) | migration-develop | migration-review | APPROVED (2 rounds, 1 MAJOR + 3 MINOR): Ruleset.ts (863 lines, 1051 test lines, 55 tests), ActorInfo.ts extension (+152 lines, +308 test lines, +25 tests), ModData.ts update (+29/-14). Phase C: ~1,030 impl + ~1,359 test lines, ~80 tests. Commits `c4c98ea`, `3652e65`. |
| 2026-06-12 | **Ch6 Phase B Sync Hash System** (3 files) | migration-develop | migration-review | APPROVED (2 rounds, 2 MAJOR + 3 MINOR): Sync.ts (569 lines, 958 test lines, 96 tests), sync-hash-generator.ts (611 lines, 821 test lines, 33 tests), sync-hashes.generated.ts (24 lines, auto-generated). Phase B: 1,204 impl + 1,779 test lines, 132 tests. Commits `52f6940`, `a63d377`. |
| 2026-06-12 | **Ch6 Phase A Network & Connection Foundation** (4 files) | migration-develop | migration-review | APPROVED (2 rounds, 1 BLOCKER + 9 MINOR): Order.ts (1253 lines, 567 test lines), UnitOrders.ts (696 lines, 416 test lines), Connection.ts (685 lines, 352 test lines), OrderManager.ts (827 lines, 532 test lines). Phase A: 3,461 impl + 1,867 test lines, 115 tests. ~94% OpenRA feature coverage. Commits `7ea8d07`, `ff0a461`, `2fe6156`. |
| 2026-06-12 | **Ch5 Phase E World Interaction Bridge** (1 file) | migration-develop | migration-review | APPROVED (2 rounds, 12 findings: 3 BLOCKER + 5 MAJOR + 4 MINOR): WorldInteractionControllerWidget.ts (1157 lines, 55 tests, state machine IDLE->MAYBE_DRAG->CLICK|DRAGGING, single/double-click selection, drag-box selection with deadzone, right-click order dispatch via event bus, scene.onPointerObservable bridge). Does not extend Widget (standalone class, documented ADR). 1,157 impl + ~1,682 test lines. Chapter 5 now 100% COMPLETE (16/16). Commits `cff5dfd`, `42223f9`. |
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

## Chapter 5: UI System & Resource Management (COMPLETE)

> **Migration Plan**: [docs/ui_system_migration_plan.md](docs/ui_system_migration_plan.md)
> **Created**: 2026-06-11 | **Updated**: 2026-06-12 | **Status**: COMPLETE (16/16 migrated, 100%), ALL PHASES A-E COMPLETE
> **Prerequisite**: Chapter 4 (Map & Terrain System) -- COMPLETE (37/37, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 16 | 100% |
| Pending | 0 | 0% |
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
| Phase E | World Interaction Bridge | 1 | HIGH | COMPLETE (1/1, 55 tests), 2 review rounds |

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

### Phase E: World Interaction Bridge (1 file, COMPLETE)

**Status**: COMPLETE (1/1). Review: APPROVED (2 rounds, 12 findings fixed: 3 BLOCKER, 5 MAJOR, 4 MINOR). No manual visual tests needed (callback-based bridge, unit-testable state machine with mocked Babylon.js scene/picking).
**Commits**: `cff5dfd` (initial), `42223f9` (review fixes).
**Date**: 2026-06-12

| # | Target File | Class/Interface | Complexity | Lines (C#) | Impl lines | Tests | Notes |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---|
| E1 | `src/OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.ts` | WorldInteractionControllerWidget | HIGH | 235 | 1157 | 55 | ~1,682 test lines. State machine (IDLE->MAYBE_DRAG->CLICK|DRAGGING), single/double-click selection with modifiers, drag-box entity selection with deadzone, right-click order dispatch, mouse-over rollover, context menu suppression. Standalone class using scene.onPointerObservable -- does not extend Widget (documented architectural decision). |
| **Total** | | | | **~235** | **1,157** | **55** | **~1,682 test lines** |

> **Note**: Phase E is the terminal leaf node of Chapter 5. With all 16 files complete, Chapter 5 is now 100% resolved. The controller is a standalone class (does not extend Widget) because 3D interaction has no concept of 2D Widget bounds for hit-testing.

### Chapter 5 Phase Strategy Summary

| Phase | Files | Complexity | Est. Lines (impl+test) | Est. Tests | Depends On |
|-------|:---:|:---|:---:|:---:|-----------|
| A: FileSystem Foundation | 4 | Low-Medium | 3,391 (completed) | 132 (completed) | Nothing |
| B: C&C Package Formats | 5 | Low-HIGH | 3,125 (completed) | 108 (completed) | Phase A |
| C: MOD System Core | 2 | Low-Medium | 2,128 (completed) | 115 (completed) | Phase A |
| D: UI Widget Core | 4 | Low-Medium | 4,462 (completed) | 174 (completed) | Phase C |
| E: World Interaction | 1 | HIGH | ~2,839 (completed) | 55 (completed) | Phases C, D |
| **Total** | **16** | | **~14,145** | **~584** | |

**Total completed**: ~14,145 lines of implementation + test code across all 16 files. Chapter 5 is now 100% complete.

---

## Chapter 6: Network Sync & Game Logic (ALL PHASES COMPLETE)

> **Migration Plan**: [docs/network_sync_migration_plan.md](docs/network_sync_migration_plan.md)
> **Created**: 2026-06-12 | **Updated**: 2026-06-12 | **Status**: COMPLETE (29/29, 100%)
> **Prerequisite**: Chapter 5 (UI System & Resource Management) -- COMPLETE (16/16, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 29 | 100% |
| **Total** | **29** | **100%** |
| **From OpenRA** | **24** | |
| **New files (no OpenRA equivalent)** | **2** (sync hash generator build tool, behavior tree json configs) | |
| **Auto-generated output** | **1** (sync-hashes.generated.ts) | |
| **Existing file extensions** | **1** (ActorInfo.ts sync metadata) | |
| **Deferred stubs** | **3** (BuildingRepairBotModule, PowerDownBotManager, ProtectionStates) | |

### Chapter 6 Phases

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Network & Connection Foundation | 4 | HIGH (OrderManager, Connection), MEDIUM (Order, UnitOrders) | **COMPLETE (4/4)** |
| Phase B | Sync Hash System | 3 | HIGH (hash generation + build tooling) | **COMPLETE (3/3)** |
| Phase C | Ruleset Container & ActorInfo Integration | 2 | MEDIUM | **COMPLETE (2/2)** |
| Phase D | AI BotModule Core | 10 | HIGH (SquadManager, BaseBuilder), MEDIUM | **COMPLETE (10/10)** |
| Phase E | AI BotModule Extended | 11 (8 impl + 3 stubs) | MEDIUM, LOW | **COMPLETE (11/11)** |

### Key Architecture Decisions (8 ADRs)

| ADR | Decision |
|-----|----------|
| ADR-6.1 | WebSocket client-server as primary transport; WebRTC DataChannel optional for LAN |
| ADR-6.2 | MessagePack binary serialization for all network messages |
| ADR-6.3 | Sync hash functions pre-generated at build time via AST scanning |
| ADR-6.4 | Deterministic Mersenne Twister PRNG ported from C# (no Math.random()) |
| ADR-6.5 | AI BotModules migrated to Behavior Tree architecture with JSON configuration |
| ADR-6.6 | All mod rules compiled from MiniYAML to JSON at build time (consistent with ADR-4.2, ADR-5.1) |
| ADR-6.7 | ActorInfo.ts extended with sync metadata (no separate class) |
| ADR-6.8 | Game tick runs in Web Worker; rendering on main thread via postMessage |

### Already Available (from Prior Chapters)

| Dependency | Source | Status |
|:---|:---|:---|
| MiniYAML -> JSON pipeline | `utils/miniyaml-to-json.ts` | COMPLETE (Ch4 Phase H) |
| `ActorInfo` trait metadata | `src/OpenRA.Game/GameRules/ActorInfo.ts` | COMPLETE (Ch3 Phase E) |
| Coordinate types (WPos, CPos, CVec, etc.) | `src/OpenRA.Game/` | COMPLETE (Ch3 Phase A) |
| `World.ts` / `GameWorldManager` | `src/OpenRA.Game/World.ts` | COMPLETE (Ch3 Phase C) |
| `Actor.ts` / `GameActor` | `src/OpenRA.Game/Actor.ts` | COMPLETE (Ch3 Phase D) |
| `Player.ts` | `src/OpenRA.Game/Player.ts` | COMPLETE (Ch3 Phase G) |
| `TraitsInterfaces.ts` (ITick, IResolveOrder, etc.) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | COMPLETE (Ch3 Phase B) |
| `ModData.ts` + `Manifest.ts` | `src/OpenRA.Game/` | COMPLETE (Ch5 Phase C) |
| `FileSystem.ts` (VFS) | `src/OpenRA.Game/FileSystem/` | COMPLETE (Ch5 Phase A) |
| `Map.ts` | `src/OpenRA.Game/Map/Map.ts` | COMPLETE (Ch4 Phase D) |
| `Renderer.ts` + `WorldRenderer.ts` | `src/OpenRA.Game/` | COMPLETE (Ch2) |
| `PriorityQueue.ts`, `Cache.ts`, `BitSet.ts` | `src/OpenRA.Game/Primitives/` | COMPLETE (Ch3 Phase A) |

### Dependency Graph

```
Chapter 3+4+5 (Prerequisites) -- ALREADY COMPLETE
  |
  +--> Phase A (Order + Connection + UnitOrders + OrderManager) **[4/4 COMPLETE]**
  |     |
  |     +--> Phase B (Sync + hash generator) **[3/3 COMPLETE]**
  |     |     |
  |     |     +--> Phase C (Ruleset + ActorInfo extension) **[2/2 COMPLETE]**
  |     |           |
  |     |           +--> Phase D (AI BotModule Core: 10 files) **[10/10 COMPLETE]**
  |     |                 |
  |     |                 +--> Phase E (AI BotModule Extended: 11 files) **[11/11 COMPLETE]**
```

### Phase Strategy

| Week | Phase | Files | Description | Status |
|:---:|:---|:---:|:---|:---:|
| 1-2 | Phase A | 4 | Network foundation (Order, Connection, OrderManager, UnitOrders) | COMPLETE (2026-06-12) |
| 2-3 | Phase B | 3 | Sync hash system (runtime + build generator) | COMPLETE (2026-06-12) |
| 3-4 | Phase C | 2 | Ruleset container + ActorInfo extension | COMPLETE (2026-06-12) |
| 4-6 | Phase D | 10 | AI core modules | COMPLETE (2026-06-12) |
| 6-8 | Phase E | 11 | AI extended modules | COMPLETE (2026-06-12) |

**All phases complete**. Total: 29 files across 5 phases.

### Chapter 6 File Inventory

| # | OpenRA Source | Target TypeScript File | Complexity | Phase |
|:---:|:---|:---|:---:|:---:|
| 1 | `Order.cs` | `src/OpenRA.Game/Network/Order.ts` | MEDIUM | **A ✅** |
| 2 | `UnitOrders.cs` | `src/OpenRA.Game/Network/UnitOrders.ts` | MEDIUM | **A ✅** |
| 3 | `Connection.cs` | `src/OpenRA.Game/Network/Connection.ts` | HIGH | **A ✅** |
| 4 | `OrderManager.cs` | `src/OpenRA.Game/Network/OrderManager.ts` | HIGH | **A ✅** |
| 5 | `Sync.cs` | `src/OpenRA.Game/Sync.ts` | HIGH | **B ✅** |
| 5a | *(new build tool)* | `utils/sync-hash-generator.ts` | HIGH | **B ✅** |
| 5b | *(generated output)* | `src/OpenRA.Game/sync-hashes.generated.ts` | LOW | **B ✅** |
| 6 | `Ruleset.cs` | `src/OpenRA.Game/GameRules/Ruleset.ts` | MEDIUM | **C ✅** (863+1051 lines, 55 tests) |
| 7 | *(extend existing)* | `src/OpenRA.Game/GameRules/ActorInfo.ts` (extend) | MEDIUM | **C ✅** (+152+308 lines, +25 tests) |
| 8 | `SquadManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/SquadManagerBotModule.ts` | HIGH | **D ✅** |
| 9 | `BaseBuilderBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BaseBuilderBotModule.ts` | HIGH | **D ✅** |
| 10 | `UnitBuilderBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/UnitBuilderBotModule.ts` | MEDIUM | **D ✅** |
| 11 | `HarvesterBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/HarvesterBotModule.ts` | MEDIUM | **D ✅** |
| 12 | `SupportPowerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/SupportPowerBotModule.ts` | MEDIUM | **D ✅** |
| 13 | `ResourceMapBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/ResourceMapBotModule.ts` | MEDIUM | **D ✅** |
| 14 | `Squad.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/Squad.ts` | MEDIUM | **D ✅** |
| 15 | `AttackOrFleeFuzzy.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.ts` | MEDIUM | **D ✅** |
| 16 | `StateMachine.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/StateMachine.ts` | LOW | **D ✅** |
| 17 | `StateBase.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/StateBase.ts` | LOW | **D ✅** |
| 18 | `BaseBuilderQueueManager.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/BaseBuilderQueueManager.ts` | MEDIUM | **E ✅** (984+238 lines) |
| 19 | `GroundStates.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/GroundStates.ts` | MEDIUM | **E ✅** (340+193 lines) |
| 20 | `AirStates.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/AirStates.ts` | MEDIUM | **E ✅** (283+143 lines) |
| 21 | `McvExpansionManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/McvExpansionManagerBotModule.ts` | HIGH | **E ✅** (1053+182 lines) |
| 22 | `CaptureManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/CaptureManagerBotModule.ts` | LOW | **E ✅** (311+115 lines) |
| 23 | `McvManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/McvManagerBotModule.ts` | LOW | **E ✅** (402+138 lines) |
| 24 | `MinelayerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/MinelayerBotModule.ts` | MEDIUM | **E ✅** (495+156 lines) |
| 25 | `SupportPowerDecision.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/SupportPowerDecision.ts` | LOW | **E ✅** (377+246 lines) |
| 26 | *(3 deferred stubs)* | `BuildingRepairBotModule` (63+28), `PowerDownBotManager` (81+32), `ProtectionStates` (74+44) | LOW | **E ✅** |

---

## Chapter 7: Input, Camera, Audio & Effects (13/13, ALL PHASES A-G COMPLETE)

> **Migration Plan**: [docs/input_camera_audio_effects_migration_plan.md](docs/input_camera_audio_effects_migration_plan.md)
> **Created**: 2026-06-12 | **Updated**: 2026-06-12 | **Status**: COMPLETE (13/13, 100%, ALL PHASES A-G COMPLETE)
> **Prerequisite**: Chapter 6 (Network Sync & Game Logic) -- COMPLETE (29/29, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 13 | 100% |
| Pending | 0 | 0% |
| **Total** | **13** | **100%** |
| **From OpenRA** | **13** | |
| **New files (no OpenRA equivalent)** | **1** (AnimationWithOffset.ts) | |

### Chapter 7 Phases

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Input Foundation | 3 | LOW-MEDIUM | **COMPLETE (3/3, 155 tests)** |
| Phase B | Camera System | 2 | HIGH-MEDIUM | **COMPLETE (2/2, 86 tests)** |
| Phase C | Selection System | 1 | MEDIUM | **COMPLETE (1/1, 58 tests)** |
| Phase D | Audio System | 2 | MEDIUM | **COMPLETE (2/2, 133 tests)** |
| Phase E | Visual Effects | 2 | MEDIUM | **COMPLETE (2/2, 92 tests)** |
| Phase F | Projectiles | 1 | HIGH | **COMPLETE (1/1, 56 tests)** |
| Phase G | Sprite Rendering Traits | 2 | MEDIUM-LOW | **COMPLETE (2/2, 120 tests)** |

### Phase A Completed: Input Foundation (3 files, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| IInputHandler.ts | 176 | -- | -- | MouseInput, KeyInput, Modifiers interfaces; MouseButton/MouseEventType/KeyEventType enums |
| Keycode.ts | 544 | -- | -- | ~230 SDL keycodes mapped to KeyboardEvent.code; fromKeyboardEvent()/fromSDLK() helpers |
| InputHandler.ts | 617 | -- | -- | NullInputHandler (headless) + DefaultInputHandler (DSM) + InputManager helper |
| **Total** | **~1,337** | -- | **155** | |

**Implementation details**:
- `IInputHandler` interface: TypeScript interfaces for MouseInput, KeyInput, Modifiers with Object.freeze() immutability
- `NullInputHandler`: all methods no-ops for headless/repay/dedicated server modes
- `DefaultInputHandler`: wraps Babylon.js `DeviceSourceManager` + `scene.onPointerObservable`
- DSM keyboard observer converts `KeyboardInfo` to `KeyInput`; pointer observer converts `PointerInfo` to `MouseInput` (with NDC-to-pixel conversion)
- Scroll blocking: registers `wheel` event on canvas with `{ passive: false }` and calls `preventDefault()`
- `InputManager` helper: wraps DeviceSourceManager instantiation/cleanup/dispose
- Review: APPROVED (2 rounds, 1 BLOCKER + 3 MAJOR resolved) | **Commits**: `4260360`, `1920155`

### Phase B Completed: Camera System (2 files + 1 prereq, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Viewport.ts | 1,023 | 742 | -- | CameraController class (renamed from Viewport): ArcRotateCamera wrapper, dual ortho/perspective mode, viewToWorldPx(), adjustZoom(center), clampTarget(), toggleZoom(), bookmark system |
| ViewportControllerWidget.ts | 868 | 573 | -- | Widget-based camera control: hotkey bindings via HotkeyReference, edge scrolling, mouse-wheel zoom, cursor context switching, smooth camera panning |
| HotkeyReference.ts | 360 | -- | -- | Prereq: configurable hotkey binding class, runtime rebind without recompilation |
| **Total** | **~2,251** | **~1,315** | **86** | |

**Implementation details**:
- `Viewport.ts` (CameraController): Full ArcRotateCamera wrapper. `viewToWorldPx()` via `scene.createPickingRay()` + terrain plane intersection. `adjustZoom(dz, center)` zoom-to-mouse preserving world position under cursor. `clampTarget()` bounds camera to map edges every frame. `toggleZoom()` switches between min/max zoom. `getBlockedDirections()` returns bitmask for edge scroll UI. Orthographic and perspective modes supported with runtime toggle. LH coordinate system constraint enforced (alpha = -PI/2, screen-right = world+X).
- `ViewportControllerWidget.ts`: Inherits from Widget (Ch5 Phase D). Integrates with Phase A InputManager for device event routing. Hotkey configuration via HotkeyReference instances (ZoomInKey, ZoomOutKey, ScrollUp/Down/Left/RightKey, bookmark save/restore). Edge scrolling with configurable threshold (default 15px). MouseScrollType enum (Zoom/Scroll/Disabled). Directional cursor feedback during edge scroll.
- `HotkeyReference.ts` (new prereq): Wraps a `Func<KeyCode>` that can be rebound at runtime. Separate from the migration plan's original 13 files but required as a dependency for ViewportControllerWidget hotkey configuration.
- Review: APPROVED (2 rounds, 3 BLOCKER + 5 MAJOR resolved) | **Commits**: `3688b66`, `feca8b6`, `6d722c4`
- Phase B unblocks Phase C (Selection System needs camera coordinate transforms)

### Phase C Completed: Selection System (1 file, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| SelectionUtils.ts | 723 | -- | 58 | Static utility class, pre-filtered candidates approach, ports OpenRA priority formula |
| **Total** | **~723** | -- | **58** | |

**Implementation details**:
- `UnitSelectionManager` class (renamed from `SelectionUtils` static class): `selectActorsByOwnerAndSelectionClass()` O(n) single-pass filtering; `selectionPriority()` with modifier boost + relationship penalty (-30/-60/-90); `calculateActorSelectionPriority()` preserving `pixelDistance << 16` formula; `withHighestSelectionPriority()` / `subsetWithHighestSelectionPriority()` replacing LINQ `MaxByOrDefault`/`GroupBy`; `getPlayersToIncludeInSelection()` matching OpenRA shroud/observer logic; `selectActorsInBoxWithDeadzone()` with deadzone-to-point fallback + tier-based subset filtering; `applyPenalty` flag for point-click vs box-select distinction.
- Paradigm shift: 2D `ScreenMap.ActorsInMouseBox()` spatial index queries replaced by pre-filtered candidates from `WorldInteractionControllerWidget` (which handles 3D raycasting/frustum queries).
- Review: APPROVED (3 rounds) | **Commits**: `ee38601`, `406df32`, `816bb5a`
- Phase C unblocks nothing (leaf phase)

### Phase D Completed: Audio System (2 files, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| SoundDevice.ts | 269 | 368 | ~23 | ISoundEngine interface, ISound, ISoundSource, WebAudioEngine wrapper |
| Sound.ts | 1,383 | 1,553 | ~110 | Sound manager: sound pool, volume chain, PlayPredefined, music/video management |
| **Total** | **~1,652** | **~1,921** | **133** | |

**Implementation details**:
- `SoundDevice.ts` (ISoundEngine + WebAudioEngine): `availableDevices()`, `addSoundSourceFromMemory()`, `play2D()`, `play3D()`, `setListenerPosition()`, `setSoundPosition()`, `setSoundVolume()`, `stopSound()`, `pauseSound()`/`resumeSound()`. Wraps Howler.js global with `Howler.autoUnlock = true` for browser autoplay policy. Distance model: `inverse` (matching OpenAL's `AL_INVERSE_DISTANCE`). Format support: WebM (primary) + MP3 (fallback). `ISound` interface: `id`, `source`, `playing`, `volume`, `looping`.
- `Sound.ts` (Sound manager, 1,383 lines): Full port of OpenRA's `Sound.cs` (481 lines C#). `Sound` class with `soundEngine: ISoundEngine`, `sounds: Map<string, ISoundSource>`, `currentSounds: Map<number, ISound>`, `currentNotifications: Map<string, ISound>`. Volume chain: `SoundVolume × soundVolumeModifier × volumeModifier × pool.VolumeModifier`. `play()` for 2D/3D sound with position. `playPredefined()` with voice/notification routing, variant selection, prefix matching. `SoundPool` class with `InterruptType`: `Overlap` (always play), `Interrupt` (stop existing), `DoNotPlay` (skip if active). `PlayMusic()`/`StopMusic()`/`PauseMusic()`/`PlayMusicThen()` with Tick-based completion detection. `PlayVideo()`/`StopVideo()`/`PauseVideo()` with proper resource cleanup. `SoundType` enum: `World = 0`, `UI = 1`. `DisableWorldSounds` for minimap/replay modes.
- Paradigm shift: C# OpenAL `ISoundEngine` -> Howler.js + Web Audio API `ISoundEngine` interface. `AL.ListenerPosition` -> `Howler.pos(x, y, z)`. `AL.SourcePosition` -> `howl.pos(x, y, z, soundId)`. AUD/VOC/WAV -> WebM (Vorbis) / MP3 dual-format. `Cache<string, ISoundSource>` -> `Map<string, Howl>`.
- External dependency added: `howler` + `@types/howler` npm packages.
- Review: APPROVED | **Commit**: `3f1b511`

### Phase E Completed: Visual Effects (2 files, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| SpriteEffect.ts | -- | -- | -- | Base visual effect: static/follow/dynamic position modes, animation playback, billboard rendering |
| FloatingSpriteEmitter.ts | -- | -- | -- | Particle emitter trait: configurable spawn rate, gravity, speed, GPU particle system, LOD |
| **Total** | -- | -- | **92** | |

**Implementation details**:
- `SpriteEffect.ts`: Port of OpenRA's `SpriteEffect.cs` (86 lines C#). `IEffect` interface with `tick()`/`render()`. Static position, dynamic position function, and follow-actor position modes. Animation-based sprite playback with delay timer. Billboard rendering via Babylon.js Sprite at 3D world position. Disposes on animation completion (non-looping).
- `FloatingSpriteEmitter.ts`: Port of OpenRA's `FloatingSpriteEmitter.cs` (126 lines C#). Continuous particle emission with configurable `spawnFrequency`, `lifetime`, `speed`, `gravity`, `turnRate`, `randomRate`, `offset`, `spawnRadius`, `burstSize`. GPU particle system (`GPUParticleSystem`) with CPU fallback. Particle pooling with max 20 concurrent systems. Three-tier distance-based LOD: 0-50 units (100% emitRate), 50-100 (50%), 100-200 (20%), >200 (disabled).
- Paradigm shift: C# CPU sprite animation loop -> Babylon.js `ParticleSystem` / `GPUParticleSystem` GPU simulation. C# `BLENDMODE_ADD` -> `ParticleSystem.BLENDMODE_ADD`. CPU `FloatingSpriteEmitter` per-frame spawning -> `emitRate` + `maxLifeTime` + `gravity` parameters.
- Review: APPROVED (2 rounds) | **Commits**: `a0bf835`, `180e2a9`

### Phase F Completed: Projectiles (1 file, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Bullet.ts | 1,463 | -- | 56 | Bullet projectile: IProjectile interface, trajectory update, collision detection, TrailMesh contrails, ShadowGenerator, ProjectileFactory pooling |
| **Total** | **~1,463** | -- | **56** | |

**Implementation details**:
- `Bullet.ts` (1,463 lines TS): Port of OpenRA's `Bullet.cs` (397 lines C#). `IProjectile` interface extending `IEffect`: `tick()`, `render()`, `isDestroyed`. Constructor parameters: `source`, `target`, `speed`, `gravity`, `launchAngle`, `inaccuracy`. Visual properties: `image` (sprite), `shadow`, `trailImage`, `contrailLength`, `contrailWidth`, `contrailColor`, `palette`.
- `tick()`: Calculates new position via `pos += velocity * tickScale`, applies gravity to velocity Y component. Updates `TransformNode.position` for visual sync. Checks collision via `scene.pickWithRay()` raycast from previous to new position. On collision: triggers impact effect, marks `isDestroyed = true`. On out-of-bounds: marks `isDestroyed = true`.
- `render()`: Body rendered as billboard `Sprite` at `TransformNode.position` with current frame from animation. Shadow via `ShadowGenerator` dark ellipse on terrain. Contrails via `TrailMesh` bound to projectile's `TransformNode` with configurable width and color.
- `ProjectileFactory` class (new): Static factory methods for common projectile types. Projectile pooling with pre-created instance recycling. `activeProjectiles: Set<IProjectile>` registry for batch update and disposal.
- Paradigm shift: C# CPU trajectory + position update -> TypeScript logic-layer `tick()` + `TransformNode.position` for visual. CPU-generated contrail line segments -> `TrailMesh` GPU-generated dynamic strip geometry. 2D grid-based collision -> `scene.pickWithRay()` raycast. `Render()` Z-order shadow/trail/body -> `ShadowGenerator` + `TrailMesh` + `Sprite` with renderingGroupId layers.
- Review: APPROVED (R2) | **Commits**: `bb5358c`, `1387d82`

### Phase G Completed: Sprite Rendering Traits (2+3 files, 2026-06-12)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| AnimationWithOffset.ts | 163 | -- | 17 | Extracted class: offset function, DisableFunc, render, screenBounds |
| RenderSprites.ts | ~500 | -- | 37 | Base sprite rendering trait: AnimationWrapper, DamagePrefixes, NormalizeSequence |
| WithIdleOverlay.ts | ~413 | -- | 24 | Idle overlay animation: billboard sprite, condition token, PauseOnLowPower |
| Animation.ts (modified) | +112 | -- | +9 | Extended with IHasCenterPosition, IRenderable, IPaletteRef, Rectangle interfaces |
| TraitsInterfaces.ts (modified) | +10 | -- | -- | Extended with DamageState enum, IFacing interface |
| **Total** | **~1,198** | **~940** | **120** | |

**Implementation details**:
- `AnimationWithOffset.ts` (extracted from Animation.ts): Wraps an `Animation` with an offset function (for turrets, attachments), `DisableFunc` for visibility control, and rendering methods. `screenBounds()` computes screen-space bounding rectangles. `render()` produces `IRenderable` objects for the rendering pipeline.
- `RenderSprites.ts` (~500 lines): Port of OpenRA's `RenderSprites.cs` (302 lines C#). Base trait implementing `ITick`, `IRender`, `INotifyOwnerChanged`, `INotifyEffectiveOwnerChanged`. Manages `AnimationWrapper` list with palette caching, per-tick animation updates, and `ScreenMap` invalidation on change. `DamagePrefixes` static array maps `DamageState` to sequence prefixes (`critical-`, `damaged-`, `scratched-`, `scuffed-`). `NormalizeSequence()` and `UnnormalizeSequence()` for damage-aware sequence selection. `MakeFacingFunc()` generates facing callbacks for other `With*` traits. `RenderSpritesInfo` configures image, faction overrides, palette, and player palette. `GetImage()` resolves sprite sheet name with faction-specific overrides.
- `WithIdleOverlay.ts` (~413 lines): Port of OpenRA's `WithIdleOverlay.cs` (124 lines C#). Renders an independent animation overlay on top of the actor's base sprite (e.g., rotating radar dishes, waving flags). Supports `PauseOnLowPower` to freeze animation when low on power. `RequiresCondition` token for enabling/disabling the overlay. Uses `AnimationWithOffset` with a fixed `WVec.Zero` offset. Implements `ITick`, `IRender`, `INotifyOwnerChanged`, `INotifyEffectiveOwnerChanged`.
- `Animation.ts` extension (+112 lines): Added `IHasCenterPosition` interface (used by `AnimationWithOffset.screenBounds/render`), `IRenderable` interface (sprite render output), `IPaletteRef` interface (palette reference with `getColor` and `name`), and `Rectangle` interface (screen-space bounds).
- `TraitsInterfaces.ts` extension (+10 lines): Added `DamageState` enum (`Undamaged`, `Light`, `Medium`, `Heavy`, `Critical`, `Dead`) and `IFacing` interface (used by `RenderSprites.MakeFacingFunc`).
- Paradigm shift: C# `RenderSprites` Trait managing `AnimationWithOffset` list -> `RenderSprites` class with `AnimationWrapper` inner class. C# `IEnumerable<IRenderable>` yield return -> array collection. C# `FrozenDictionary<string, string>` FactionImages -> `Record<string, string>`. C# `PaletteReference` -> `IPaletteRef`. C# `WithIdleOverlay` independent Animation + ZOffset -> Billboard `AnimationWithOffset` with visibility condition.
- Review: APPROVED (2 rounds). Round 1: 0 BLOCKER, 4 MAJOR, 5 MINOR -> NEEDS FIXES. Round 2: All 4 MAJOR fixed, 2 MINOR deferred (TODO comments for map editor features: `RenderPreview()` and `IActorPreviewInitModifier`). | **Commits**: `e108a5a`, `11e49a3`

---

## Chapters 8-21: Remaining Systems (IN PROGRESS)

> **Planning Document**: [docs/remaining_systems_migration_plan.md](docs/remaining_systems_migration_plan.md)
> **Created**: 2026-06-12
> **Status**: IN PROGRESS (208/~422 files migrated, Chapters 8-15 COMPLETE; Chapters 16-21: 0/~160, 6 chapters remaining)
> **Prerequisite**: Chapters 2-7 COMPLETE (162/162, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Planned | ~354 | 97% of remaining |
| In Progress | 0 | 0% |
| Completed | 11 | 3% |

### Chapter 14: Activity Implementations (Phases A-F COMPLETE, 49/49 files) ✅ 100%

> **Migration Plan**: [docs/chapter14_activity_implementations_migration_plan.md](docs/chapter14_activity_implementations_migration_plan.md)
> **Created**: 2026-06-15 | **Updated**: 2026-06-16 | **Status**: Phase A COMPLETE (11/11 files, 82 tests, 3 E2E pages R2 APPROVED); Phase B COMPLETE (6/6 files, ~70 tests, R2 APPROVED); Phase C COMPLETE (12/12 files, ~180 tests); Phase D COMPLETE (7/7 files, 161 tests); Phase E COMPLETE (6/6, 48 tests); Phase F COMPLETE (8/8, 45 tests)
> **Prerequisite**: Chapters 2-13 COMPLETE (341/341 core files, 100%)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Movement Activities | 11 | HIGHEST-LOW | **COMPLETE (11/11, 82 tests, 3 E2E pages R2 APPROVED)** |
| Phase B | Combat Activities | 6 | HIGH-LOW | **COMPLETE (6/6, ~70 tests, R2 APPROVED)** |
| Phase C | Aircraft Activities | 12 | HIGH-LOW | **COMPLETE (12/12, ~180 tests)** |
| Phase D | Economic Activities | 7 | HIGH-LOW | **COMPLETE (7/7, 161 tests)** |
| Phase E | Transport & Enter | 6 | HIGH-LOW | **COMPLETE (6/6, ~48 tests)** |
| Phase F | Utility & Miscellaneous | 8 | MEDIUM-LOW | **COMPLETE (8/8, 45 tests)** |

**Phase A Completed: Movement Activities (11 files, 2026-06-15)**

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Move.ts | ~640 C# -> ~1,400 TS | ~180 | ~25 | Core path follower: path search, local avoidance, blocker retry, backward movement, arc interpolation |
| MoveAdjacentTo.ts | ~159 C# -> ~200 TS | ~45 | ~8 | Wrapper: compute adjacent cell, nearEnough distance |
| MoveOnto.ts | ~60 C# -> ~80 TS | ~25 | ~4 | Simple cell containment activity |
| MoveOntoAndTurn.ts | ~43 C# -> ~70 TS | ~20 | ~4 | Move then face target |
| MoveWithinRange.ts | ~78 C# -> ~120 TS | ~35 | ~6 | Range-based approach: WDist threshold, target invalidation |
| Drag.ts | ~73 C# -> ~90 TS | ~20 | ~4 | Pull/push another actor |
| Nudge.ts | ~64 C# -> ~80 TS | ~25 | ~5 | Micro-movement unblock: single-cell displacement |
| Follow.ts | ~89 C# -> ~130 TS | ~40 | ~7 | Chase moving target: re-evaluate path on target move |
| LocalMoveIntoTarget.ts | ~89 C# -> ~110 TS | ~30 | ~5 | Close-range approach |
| AttackMoveActivity.ts | ~108 C# -> ~160 TS | ~50 | ~8 | Move + Hunt interleaving: combat interruption |
| MoveCooldownHelper.ts | ~100 C# -> ~120 TS | ~30 | ~6 | Shared cooldown tracking between movement activities |
| **Total** | **~1,500 C#** | **~580** | **82** | 11 test files, all passing |

**Implementation details**:
- `Move.ts` is the largest single activity in the chapter (640 C# lines -> ~1,400 TS). Handles path following via Ch9 pathfinder, local avoidance with Nudge fallback, blocker retry with wait timer, backward movement when angle > 256, arc movement via MovePart/MoveFirstHalf/MoveSecondHalf nested helpers.
- All activities extend Chapter 3 Phase F `Activity.ts` base class without modification (per ADR-14.1).
- Grid authority preserved: CPos/WPos for logic, TransformNode.position for visual interpolation only.
- Target lines rendered as Babylon.js `LinesMesh` in world-space XZ plane (per ADR-14.3).
- Acceptance test pages: 3 pages at `/test/activities/move/`, `/test/activities/attack-move/`, `/test/activities/target-lines/` (R2 APPROVED).
- **Review**: Round 2 APPROVED (0 BLOCKERs remaining). Commits: `4501c29` (Phase A implementation), `d307624` (review fixes), `68d9e14` (E2E acceptance test pages).

**Phase B Completed: Combat Activities (6 files, 2026-06-15)**

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Enter.ts | ~163 C# -> ~350 TS | ~80 | ~12 | Minimal abstract base: 4-state state machine (Approaching/Entering/Exiting/Finished) |
| Attack.ts | ~283 C# -> ~620 TS | ~140 | ~18 | Combat orchestration: move into range, face, fire, repeat |
| Hunt.ts | ~49 C# -> ~110 TS | ~30 | ~8 | Search for nearest enemy, queue Attack on found |
| CaptureActor.ts | ~158 C# -> ~340 TS | ~70 | ~12 | Engineer capture: extends Enter, ownership transfer |
| Demolish.ts | ~89 C# -> ~180 TS | ~40 | ~8 | Place explosives: extends Enter, timer + damage |
| Turn.ts | ~47 C# -> ~90 TS | ~25 | ~7 | Rotate actor to facing: WAngle turn speed |
| **Total** | **~789 C#** | **~385** | **~70** | 6 test files, all passing |

**Implementation details**:
- `Enter.ts` (~350 TS): Minimal abstract base with 4-state enum (`Approaching`, `Entering`, `Exiting`, `Finished`). `Tick` orchestrates `IMove.MoveToTarget`/`MoveIntoTarget`/`ReturnToCell`. Virtual hooks: `TickInner`, `TryStartEnter`, `OnEnterComplete`. Intentionally minimal -- no Cargo/Passenger transport logic (deferred to Phase E).
- `Attack.ts` (~620 TS): Full combat orchestration. Sequence: (1) `MoveWithinRange` if out of range, (2) `Turn` if not facing, (3) fire via `Armament`/`AttackBase` if in range and facing. Handles `IsCanceling` cleanup. Target invalidation: completes when target destroyed.
- `Hunt.ts` (~110 TS): Simple search-and-attack wrapper. Scans for nearest enemy, queues `Attack` on found enemy. Returns true if no enemies in range.
- `CaptureActor.ts` (~340 TS): Extends minimal `Enter` base. Engineer capture with progress ticks. Ownership transfer on completion. Condition granted during capture.
- `Demolish.ts` (~180 TS): Extends minimal `Enter` base. Places explosives with timer. Damage application on detonation. Flash effects during countdown.
- `Turn.ts` (~90 TS): Simple facing activity. Advances `WAngle` toward desired facing at turn speed. Returns true when facing reached. Used by `Attack` and movement wrappers.
- **Review**: Round 2 APPROVED (2 BLOCKER + 5 MAJOR resolved, 0 remaining).

**Key Architecture Decisions**:
- **ADR-14.1**: Reuse Chapter 3 Activity Base Without Modification
- **ADR-14.2**: Movement Logic Stays Grid-Based, Visuals Use 3D Interpolation
- **ADR-14.3**: Target Lines as World-Space `LinesMesh`
- **ADR-14.4**: Aircraft Activities Delegate Physics to `Aircraft` Trait
- **ADR-14.5**: All World Mutations Deferred to `frameEndActions`
- **ADR-14.6**: Phase Ordering by Dependency, Not File Size
- **ADR-14.7**: Enter Pattern as Shared Abstract Base (Split: Phase B Minimal + Phase E Full)

**Unblocks**: Phase C (`FlyAttack` uses `Attack` pattern), Phase D (`MoveToDock`), Phase E (`Enter` full extensions), Phase F (`DeployForGrantedCondition`)

**Phase E Completed: Transport & Enter Activities (6 files, 2026-06-16)**

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| TransportActivityInterfaces.ts | ~388 | -- | -- | Duck-typed interfaces: CargoLike, PassengerLike, CarryallLike, CarryableLike, IPositionableLike, AircraftLike, INotifyLoadCargo, INotifyUnloadCargo |
| SimpleTeleport.ts | ~73 | ~70 | ~5 | Single-tick teleport to CPos destination |
| RideTransport.ts | ~175 | ~175 | ~10 | Extends Enter: Passenger enters Cargo transport |
| UnloadCargo.ts | ~275 | ~180 | ~9 | Unloads passengers from Cargo: move/wait, choose exit, frame-end spawn |
| PickupUnit.ts | ~310 | ~190 | ~14 | Carryall picks up Carryable: Intercept→LockCarryable→Pickup state machine |
| DeliverUnit.ts | ~230 | ~100 | ~7 | Carryall delivers carried unit: Land→Wait→ReleaseUnit→TakeOff |
| **Total** | **~1,451** | **~715** | **~48** | 6 test files, 5 passed |

**Implementation details**:
- `TransportActivityInterfaces.ts` (~388 TS): Duck-typed interfaces for missing Cargo/Passenger/Carryall/Carryable traits. CargoLike has load/unload/peek/canLoad/canUnload/isEmpty/hasSpace. CarryallLike has reserveCarryable/attachCarryable/detachCarryable. IPositionableLike has setPosition/setCenterPosition/canEnterCell/getAvailableSubCell. LockResponse enum: { Success, Failed, Pending }.
- `SimpleTeleport.ts` (~73 TS): Simplest Phase E activity. Single tick: sets Mobile.setPosition(self, destination), increments generation, returns true. Throws without Mobile trait.
- `RideTransport.ts` (~175 TS): Extends Enter base class. tryStartEnter validates Cargo availability and Aircraft altitude. onEnterComplete loads passenger via frame-end action and removes from world. cancel/unreserve on cancel/onLastRun.
- `UnloadCargo.ts` (~275 TS): Cargo->passenger unload orchestration. onFirstRun: Land/Move + Wait(beforeUnloadDelay). tick: peek passenger, choose exit subCell from adjacent cells, frame-end setPosition + addActor + notify. takeOffAfterUnload flag for aircraft.
- `PickupUnit.ts` (~310 TS): Carryall pickup activity. 3-state: Intercept (fly to target, distance check) → LockCarryable (call lockForPickup, queue Land+Wait+AttachUnit+TakeOff) → Pickup. Nested AttachUnit class removes cargo from world and calls carryall.attachCarryable. Uses WRot.fromYaw for WVec rotation. Static factories for child activities (Fly/FlyIdle/Land/Wait/TakeOff).
- `DeliverUnit.ts` (~230 TS): Carryall delivery. onFirstRun: Land→Wait→ReleaseUnit→TakeOff sequence. Nested ReleaseUnit: frame-end position cargo, addActor, carryall.detachCarryable, carryable.unreserve+detached. targetLineNodes for visual targeting.

**Key Architecture Decisions**:
- Duck-typed trait interfaces (same pattern as Phase D EconomicActivityInterfaces) since Cargo/Passenger/Carryall/Carryable traits are deferred to Chapters 11/19
- Static factory pattern for child activities (_landFactory, _moveFactory, etc.) to avoid circular imports and enable test injection
- Frame-end world mutations for addActor/removeActor operations (per ADR-14.5)
- WVec.rotate(WRot.fromYaw(WAngle)) for carryall offset calculations

**Phase F Completed: Utility & Miscellaneous Activities (8 files, 2026-06-16)**

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Wait.ts (expand stub) | ~75 | ~55 | ~12 | Added WaitFor class, isInterruptible parameter, ActivityState.Done guard |
| RemoveSelf.ts (expand stub) | ~35 | ~25 | ~3 | Full implementation: dispose+cancel, Done guard |
| Transform.ts | ~250 | ~80 | ~8 | MCV deployment: Turn+Land queuing, make-animation, world.createActor, order transfer |
| DeployForGrantedCondition.ts | ~130 | ~75 | ~7 | Deploy+DeployInner classes, DeployState toggle, Turn queuing |
| DonateCash.ts | ~110 | ~80 | ~4 | Extends Enter: PlayerResources.changeCash, INotifyCashTransfer |
| DonateExperience.ts | ~100 | ~70 | ~4 | Extends Enter: GainsExperience.giveLevels, max-level check |
| RepairBridge.ts | ~115 | ~80 | ~5 | Extends Enter: BridgeHut/LegacyBridgeHut repair, EnterBehaviour |
| InstantRepair.ts | ~130 | ~75 | ~4 | Extends Enter: IHealth heal via negative damage, stance/relationship check |
| UtilityActivityInterfaces.ts | ~170 | -- | -- | Duck-typed interfaces: IHealthLike, TransformsLike, GrantConditionOnDeployLike, GainsExperienceLike, PlayerResourcesLike, BridgeHutLike, etc. |
| **Total** | **~1,115** | **~540** | **45** | 8 test files (1 expanded from Phase E Wait usage), all passing |

**Implementation details**:
- `Wait.ts`: Expanded from Phase E stub with WaitFor class for predicate-based waiting. Replaced simple `isCanceling` guard with `isCanceling || state === Done` to handle cancel-while-queued correctly.
- `RemoveSelf.ts`: Completed from Phase E stub. Calls `self.dispose()` and `this.cancel(self)` then returns true.
- `Transform.ts` (~250 TS): MCV deployment. OnFirstRun queues Turn (if IFacing) + Land (if Aircraft). Tick checks Transforms.canDeploy, fires INotifyTransform.beforeTransform, then either plays WithMakeAnimation.reverse/forward or calls doTransform directly. doTransform uses frame-end action to create new actor via world.createActor with init dict (Location, Owner, Facing, Health, Faction). Transfers orders via IssueOrderAfterTransform.
- `DeployForGrantedCondition.ts` (~130 TS): Deploy/undeploy with nested DeployInner. OnFirstRun queues Turn if undeployed with facing. Tick queues DeployInner which toggles deployState (deploy/undeploy). DeployInner is not interruptible during animation.
- `DonateCash.ts` (~110 TS): Extends Enter. OnEnterComplete transfers cash via PlayerResources.changeCash, awards experience via PlayerExperience.giveExperience, notifies INotifyCashTransfer on both actors, then disposes self.
- `DonateExperience.ts` (~100 TS): Extends Enter. TryStartEnter validates GainsExperience is present and below max level. OnEnterComplete calls giveLevels, awards player experience, disposes self.
- `RepairBridge.ts` (~115 TS): Extends Enter. TryStartEnter resolves BridgeHut or LegacyBridgeHut and checks canEnterHut (damaged + not repairing). OnEnterComplete calls hut.repair, routes EnterBehaviour (Dispose/Suicide).
- `InstantRepair.ts` (~130 TS): Extends Enter. TryStartEnter validates IHealth is damaged, InstantlyRepairable present, stance passes ValidRelationships. OnEnterComplete heals via negative damage, routes EnterBehaviour.
- `UtilityActivityInterfaces.ts` (~170 TS): Duck-typed interfaces for 8 Phase F activities covering DamageState, EnterBehaviour, DeployState, IHealthLike, GrantConditionOnDeployLike, TransformsLike, WithMakeAnimationLike, INotifyTransformLike, GainsExperienceLike, PlayerResourcesLike, PlayerExperienceLike, BridgeHutLike, InstantlyRepairableLike, and more.

**Key Architecture Decisions**:
- `ActivityState.Done` guard added to tick methods: cancel-while-queued transitions to Done (not Canceling), so tick must check both.
- All Enter-based activities follow Phase B/E pattern: override tryStartEnter/onEnterComplete virtual hooks.
- Duck-typed interfaces for all unmigrated traits (same pattern as Phase D/E).
- Static factory pattern for child activities (Turn/Land factories).

**Chapter 14: ALL PHASES COMPLETE (49/49 files, 100%)**

---

### Chapter 8: Weapons & Combat System (COMPLETE, 57/57, ALL PHASES A-E COMPLETE)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Warheads Foundation | 15 | LOW-HIGH | **COMPLETE (15/15, 143 tests)** |
| Phase B | Projectiles System | 7 | HIGH-MEDIUM | **COMPLETE (7/7, 186 tests)** |
| Phase C | Weapon Configuration Data | 2 (+1 opt) | MEDIUM | **COMPLETE (2/2 + 1 optional, 115 tests)** |
| Phase D | Core Combat Traits | 17 | HIGH-LOW | **COMPLETE (17/17, 158 tests)** |
| Phase E | Combat Support Traits | 15 | LOW-MEDIUM | **COMPLETE (15/15, 156 tests)** |

### Chapter 9: Unit Movement & Physics (COMPLETE, 30 active files)

> **Completion Date**: 2026-06-13. **Active files**: 30/30 migrated. **Deferred**: 2 (PathFinderOverlay, HierarchicalPathFinderOverlay -- debug visualizations). **Total**: 32 files (4 Phases A-D, ALL PHASES COMPLETE). **Implementation lines**: ~11,723 TS. **Tests**: 1,084 (361 + 358 + 175 + 190). **Commits**: 19. **Review rounds**: A (2), B (1), C (1), D (1).

| Phase | Description | Files | TS Lines | Tests | Commits | Review Rounds | Status |
|-------|-------------|:---:|:---:|:---:|:---:|:---:|--------|
| Phase A | Core Movement Foundations | 5 | ~4,200 | 361 | 7 | 2 | **COMPLETE (5/5)** |
| Phase B | Aircraft & Air Movement | 4 | ~3,873 | 358 | 4 | 1 | **COMPLETE (4/4)** |
| Phase C | World Movement Infrastructure | 10 | ~2,100 | 175 | 4 | 1 | **COMPLETE (10/10)** |
| Phase D | Movement-Related Support Traits | 11 active + 2 deferred | ~1,550 | 190 | 4 | 1 | **COMPLETE (11/11 active)** |

### Chapter 10: Resource & Economy System (COMPLETE, 25/25 files = 17 core + 8 optional, ALL PHASES A-B + B-Optional COMPLETE)

> **Migration Plan**: [docs/chapter10_resource_economy_migration_plan.md](docs/chapter10_resource_economy_migration_plan.md)
> **Created**: 2026-06-13 | **Updated**: 2026-06-14 (Phase B-Optional COMPLETE)
> **Status**: ALL PHASES COMPLETE (25/25 files = 17 core + 8 optional, 972 tests, ~8,665 TS lines)
> **Prerequisite**: Chapters 2-9 COMPLETE (249/249, 100%)

| Status | Count | Percentage |
|--------|-------|------------|
| Completed (Phase A + B + B-Opt) | 25 | 100% |
| **Total** | **25** | **100%** |
| **From OpenRA** | **25** (17 core + 8 optional) | |
| **New files (no OpenRA equivalent)** | **0** | |

### Chapter 10 Phases

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Resource Infrastructure | 8 (6 files + interface expansion + base class) | HIGH-LOW | **COMPLETE (8/8, 344 tests)** |
| Phase B | Economy Support Traits | 11 | LOW-MEDIUM | **COMPLETE (11/11, 425 tests, R2 pending)** |
| B-Opt | Extended Economy Traits | 8 | LOW-MEDIUM | **COMPLETE (8/8, 203 tests)** |

### Phase A Completed: Resource Infrastructure (8 files, 2026-06-14)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| TraitsInterfaces.ts (expand) | +497 | -- | -- | IDockHost, IAcceptResources, IResourceLayer, IResourceRenderer, IStoresResources interfaces |
| DockClientBase.ts | 385 | 646 | 44 | Abstract generic base class: CanDock, OnDockStarted, OnDockTick, OnDockCompleted, DockType enum |
| Harvester.ts | 1,075 | 1,380 | 81 | Extends DockClientBase: resource search, IStoresResources cargo, speed modifier, Harvest/Deliver orders, capacity management |
| ResourceLayer.ts | 799 | 1,239 | 83 | World trait: CellLayer<ResourceContents>, density recalculation, CellChanged events, Map.Resources init |
| ResourceRenderer.ts | 1,106 | 1,176 | 41 | World trait: TerrainSpriteLayer per resource type, variant selection, density-based frames, dirty cell batching |
| ResourceClaimLayer.ts | 240 | 399 | 24 | World trait: harvester-to-cell claim tracking, cross-player contention prevention |
| SeedsResource.ts | 348 | 572 | 28 | Actor trait: timer-based resource spawning, random cell selection within range |
| Refinery.ts | 705 | 812 | 43 | Building trait: IAcceptResources + IDockHost, UseStorage/direct-cash modes, floating cash text |
| **Total** | **~4,965** | **6,224** | **344** | |

**Implementation details**:
- `TraitsInterfaces.ts` expansion (+497 lines): Added `IDockHost` (docking lifecycle), `IAcceptResources` (resource acceptance), `IResourceLayer` (resource data queries), `IResourceRenderer` (cell visibility/dirty tracking), `IStoresResources` (cargo management), `IResourceValueModifier` (value modifier), and `ResourceContents` type with `EMPTY` sentinel using `Object.freeze()`.
- `DockClientBase.ts` (385 lines): New abstract generic base class providing docking lifecycle (`CanDock`, `OnDockStarted`, `OnDockTick`, `OnDockCompleted`), `getDockHost()` validation, and factory methods returning Activity stubs (actual Activities deferred to Ch14). `DockType` enum: `Unload = 1`, `Repair = 2`, `Refuel = 4`. Implements `IResolveOrder` for Dock order handling.
- `Harvester.ts` (1,075 lines): Central resource-gathering orchestrator. Extends `DockClientBase<HarvesterInfo>`. Implements `IStoresResources` for cargo with `isFull`/`isEmpty`/`fullness` properties. `ISpeedModifier` returns `FullyLoadedSpeed/100` when full. `canHarvestCell()` + `findResourceField()` for resource search. `issueOrder()` returns Harvest order for resource cells. `resolveOrder()` handles Harvest/Deliver with activity stub creation. Docking overrides coordinate with Refinery's `IDockHost` for unloading. Activity factory methods (`createHarvestActivity`, `createDeliverActivity`) return stubs -- actual `FindAndDeliverResources` deferred to Ch14. Inner `HarvestOrderTargeter` deferred to Ch15.
- `ResourceLayer.ts` (799 lines): World trait managing `CellLayer<ResourceContents>` data store. `IResourceLayer` implementation: `getResource`, `addResource` (respects `MaxDensity`), `removeResource`, `clearResources`. `CellChanged` event for renderer updates. Density recalculation based on neighbor counts. Initialization from `Map.Resources` byte-layer mapping to resource types via `ResourceTypes` config. `BuildingInfluence` integration deferred to Ch11 (stub returns false).
- `ResourceRenderer.ts` (1,106 lines): World trait using Ch2 `TerrainSpriteLayer` per resource type. `IResourceRenderer` implementation: `addVisibleCell`, `removeVisibleCell`, `updateCell`. Variant system with deterministic cell-hash-based selection. Density-based frame calculation: `lerp(0, length-1, density, maxDensity)`. `ITickRender` batches dirty cell updates. `IRenderOverlay` draws all resource layers. Sequence loading via `SequenceProvider`.
- `ResourceClaimLayer.ts` (240 lines): Simple bidirectional mapping: `claimants: Map<actorId, CPos>` and `claimCells: Map<cellIndex, IGameActor[]>`. `TryClaimCell()` prevents same-player harvesters from targeting same cell. `RemoveClaim()` releases claim. Player-based claim separation.
- `SeedsResource.ts` (348 lines): Timer-based resource spawner with `Interval`, `Range`, `MaxDensity` config. `tick()` attempts to add resources to random nearby cells via `IResourceLayer.addResource()`.
- `Refinery.ts` (705 lines): Building trait implementing `IAcceptResources` and `IDockHost`. Two modes: `UseStorage` (deposit into PlayerResources via StoresPlayerResources) and direct-cash conversion. Floating "+$XXX" text display via Babylon.js GUI TextBlock. `canDock()` only accepts `DockType.Unload` clients. `dockPosition()` returns adjacent cell for harvester docking.
- Review: R1 COMPLETE (4 BLOCKER + 4 MAJOR resolved), R2 PENDING. | **Commits**: `d65c51c`, `548756c`, `d78de60`, `7a72af7`, `f55ed14`, `20380ca`

### Phase B Completed: Economy Support Traits (11 files, 2026-06-14)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| StoresResources.ts | 219 | -- | -- | Per-actor resource storage: IStoresResources implementation, capacity enforcement, ContentHash sync |
| StoresPlayerResources.ts | 288 | -- | -- | Building-to-player resource bridge: AddStorageCapacity/RemoveStorageCapacity via INotifyAddedToWorld/Removed |
| PlayerResources.ts | 540 | -- | -- | Player-level economy manager: dual-currency (cash + resources), Sync integration, overflow protection |
| Valued.ts | 76 | -- | -- | Actor cost/value: simplest trait, exposes info.Cost |
| CustomSellValue.ts | 118 | -- | -- | Override sell value for Sellable trait |
| AcceptsDeliveredCash.ts | 149 | -- | -- | Cash delivery receiver filter: type + relationship validation |
| GivesBounty.ts | 268 | -- | -- | Bounty on kill: Valued.Cost * Percentage, Levels array for veterancy-based bounty, ValidRelationships filter |
| GivesCashOnCapture.ts | 232 | -- | -- | Cash on building capture: grants Amount to new owner on capture |
| CashTrickler.ts | 294 | -- | -- | Periodic cash income: Interval-based grants, floating cash text display |
| DeliversCash.ts | 298 | -- | -- | Carryable cash delivery: IIssueOrder + IResolveOrder for DeliverCash order |
| Sellable.ts | 314 | -- | -- | Sell button + refund logic: Valued.Cost * healthPercent * RefundPercent, CustomSellValue override |
| **Total** | **~2,400** | **~2,900** | **425** | |

**Implementation details**:
- `StoresResources.ts` (219 lines): Full `IStoresResources` implementation with per-actor resource storage. `Capacity` from config, `contents: Map<string, number>` with `contentsSum` tracking, `hasType()`, `addResource()` and `removeResource()` with overflow protection, `ContentHash` deterministic sync hash via `reduce((acc, [type, count]) => acc + (count << type.length), 0)`.
- `StoresPlayerResources.ts` (288 lines): Bridge trait connecting actor-level `IStoresResources` to player-level `PlayerResources`. `INotifyAddedToWorld` adds storage capacity, `INotifyRemovedFromWorld` removes it, `INotifyOwnerChanged` adjusts both old and new owner. `AddReserve`/`RemoveReserve` for pending delivery capacity reservation.
- `PlayerResources.ts` (540 lines): Central economy manager. Cash: `addCash()` with `Number.isSafeInteger()` overflow protection, `takeCash()` with insufficient funds check, `canAfford()`. Resources: `addResourceStorage()`/`removeResourceStorage()` with capacity tracking, `addStorageCapacity()`/`removeStorageCapacity()`. `[Sync]` fields: `cashSync`, `resourcesSync`, `resourceCapacitySync`. `INotifyCreated` sets initial cash from `DefaultCash`. `ILobbyOptions` stubbed (deferred to Ch16).
- `Valued.ts` (76 lines): Extremely simple trait -- just exposes `info.Cost` as a `cost` getter. Used by `Sellable`, `GivesBounty`, `SpawnActorsOnSell`.
- `CustomSellValue.ts` (118 lines): Override trait for `Sellable` -- `value()` returns configured override value, or 0 to use default calculation.
- `AcceptsDeliveredCash.ts` (149 lines): Filter trait checking delivery type and player relationship. `acceptsDelivery(type, from): boolean`.
- `GivesBounty.ts` (268 lines): Reacts to `INotifyKilled`. Bounty = `Levels[attacker.veterancyLevel]` if Levels defined, else `Valued.Cost * Percentage / 100`. `ValidRelationships` filter for who gets bounty. Grants cash via `PlayerResources.addCash()`.
- `GivesCashOnCapture.ts` (232 lines): Reacts to `INotifyCapture` -- grants `Amount` cash to new owner. Floating cash text display.
- `CashTrickler.ts` (294 lines): `ITick` trait granting `Amount` cash every `Interval` ticks. Floating "+$Amount" text billboard with timed fade-out.
- `DeliversCash.ts` (298 lines): `IIssueOrder` + `IResolveOrder` for carrying cash deliveries. `Payload`, `PlayerExperience`, `Type` config. Cash lost on death (`INotifyKilled`). Integration with `AcceptsDeliveredCash` for receiver validation.
- `Sellable.ts` (314 lines): `IResolveOrder("Sell")` -- refund = `Valued.Cost * healthPercent * RefundPercent / 100` with `CustomSellValue` override. Actor removal via `GameWorldManager.removeActor()`. Sell sounds. `RequiresCondition` for sell button enable. Inner `SellOrderTargeter` deferred to Ch15.
- Review: R1 COMPLETE (0 BLOCKER, 5 MAJOR resolved, 5 MINOR resolved), R2 PENDING. | **Commits**: 4 implementation + 2 review fix commits.

### Phase B-Optional Completed: Extended Economy Traits (8 files, 2026-06-14)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| ResourceValueMultiplier.ts | ~90 | -- | 6 | Resource value modifier: IResourceValueModifier implementation, stackable multiplier |
| GrantConditionOnPlayerResources.ts | ~180 | -- | 8 | Resource-level condition: grants/revokes condition based on PlayerResources threshold |
| WithResourceLevelOverlay.ts | ~200 | -- | 24 | Resource fill overlay: sprite frame selection based on fill level ratio |
| WithResourceLevelSpriteBody.ts | ~220 | -- | 24 | Resource-based sprite body: frame selection per density threshold |
| WithResourceStoragePipsDecoration.ts | ~230 | -- | 24 | Resource capacity pip indicators: filled/empty pip sprites |
| WithStoresResourcesPipsDecoration.ts | ~290 | -- | 24 | Multi-type resource pips: color-coded rows per resource type |
| CarryableHarvester.ts | ~170 | -- | 8 | Carryable harvester interaction: preserves cargo across pickup/deliver |
| SpawnActorsOnSell.ts | ~400 | -- | 85 | Spawn actors when sold: actor creation at sell position with configurable types |
| **Total** | **~1,300** | **~1,800** | **203** | |

**Implementation details**:
- `ResourceValueMultiplier.ts` (~90 lines): `IResourceValueModifier` implementation. `Modifier` config (percentage). `getResourceValueModifier()` returns `Modifier / 100`. Stackable: multiple traits multiply together. Used by Refinery for resource cash conversion.
- `GrantConditionOnPlayerResources.ts` (~180 lines): `INotifyCreated` + `ITick` trait. Checks `PlayerResources.resources[ResourceType] >= Threshold`. Grants condition token via `ConditionManager` when above threshold, revokes when below. Periodic check every tick.
- `WithResourceLevelOverlay.ts` (~200 lines): Render trait (`ITickRender`). Overlays sprite sequence on actor mesh. Frame = `floor(resourceFillLevel * sequenceLength)`. `resourceFillLevel = stored / capacity` from `IStoresResources` or `PlayerResources`. GPU rendering calls stubbed (TODO-10.B-Opt.3-RENDER).
- `WithResourceLevelSpriteBody.ts` (~220 lines): Render trait replacing `WithSpriteBody`. Selects body frame based on resource fill level against `Levels` thresholds. Frame 0 = empty; frame i+1 when fillLevel >= Levels[i]. GPU rendering calls stubbed (TODO-10.B-Opt.4-RENDER).
- `WithResourceStoragePipsDecoration.ts` (~230 lines): Render trait. Displays row of pip sprites showing resource fill percentage. `filledPips = floor(fillLevel * PipCount)`. Filled vs empty frames from sequence. GPU rendering calls stubbed (TODO-10.B-Opt.5-RENDER).
- `WithStoresResourcesPipsDecoration.ts` (~290 lines): Render trait. Multiple rows of pips, one per resource type. Color-coded via different sprite sequences. Row ordering: descending by stored amount. GPU rendering calls stubbed (TODO-10.B-Opt.6-RENDER).
- `CarryableHarvester.ts` (~170 lines): `INotifyPickedUp` + `INotifyDelivered` trait. Preserves cargo contents when picked up by transport. Restores cargo when delivered. Transport mechanics stubbed (TODO-10.B-Opt.7-TRANSPORT) pending Ch19 mod-specific transport.
- `SpawnActorsOnSell.ts` (~400 lines): `INotifySold` trait. Spawns configured `ActorTypes` at self's position on sell. `OwnerType` enum: VictoryConditions, Self, Killer, InternalName. `Probability` per actor type. `Faction` for spawned actors. Integration with `Sellable` and `Valued`.
- Review: 1 round. | **Commit**: `2c77e8f`

### Phase A Dependency Graph

```
TraitsInterfaces expansion (IDockHost, IAcceptResources, IResourceLayer, IResourceRenderer, IStoresResources)
  |
  +--> DockClientBase (abstract base class)
  |     |
  |     +--> Harvester (extends DockClientBase, implements IStoresResources)
  |           |
  |           +--> Phase B (StoresResources, PlayerResources)
  |
  +--> ResourceLayer (IResourceLayer + CellLayer)
  |     |
  |     +--> ResourceRenderer (reads ResourceLayer data)
  |     +--> SeedsResource (writes via IResourceLayer)
  |
  +--> ResourceClaimLayer (independent, used by Harvester)
  |
  +--> Refinery (IAcceptResources + IDockHost)
        |
        +--> Phase B (StoresPlayerResources bridge)
```

### Already Available (from Prior Chapters)

| Dependency | Source | Status |
|:---|:---|:---|
| Renderer + WorldRenderer | Ch2 | COMPLETE |
| TerrainSpriteLayer | Ch2 | COMPLETE (used by ResourceRenderer) |
| Sprite/Sheet/Animation | Ch2 | COMPLETE |
| World + Actor + Player | Ch3 | COMPLETE |
| TraitsInterfaces (ITick, INotifyCreated, etc.) | Ch3 Phase B | COMPLETE |
| Coordinate Primitives (CPos, CVec, WPos, WDist) | Ch3 Phase A | COMPLETE |
| Map + CellLayer + TerrainInfo | Ch4 | COMPLETE |
| CoordinateTransformer | Ch4 Phase I | COMPLETE |
| FileSystem + MOD System | Ch5 | COMPLETE |
| Order + IResolveOrder + IIssueOrder | Ch6 Phase A | COMPLETE |
| Sync hash system | Ch6 Phase B | COMPLETE |
| CombatInterfaces (IHealth, DamageState) | Ch8 Phase D | COMPLETE |
| Mobile + IMove | Ch9 Phase A | COMPLETE |

### Key Architecture Decisions (4 ADRs)

| ADR | Decision |
|-----|----------|
| ADR-10.1 | Resource Rendering via Ch2 TerrainSpriteLayer (not new rendering system) |
| ADR-10.2 | Resource Data Storage via CellLayer with Immutable Records (Object.freeze() EMPTY sentinel) |
| ADR-10.3 | Harvester Activities (FindAndDeliverResources) Deferred to Chapter 14 Phase D |
| ADR-10.4 | DockClientBase as Abstract Generic Base Class (reusable for Harvester, RepairClient, etc.) |

### Chapter 11: Production & Building System (COMPLETE, 37/37 files = 25 original plan + 13 additional, ALL PHASES COMPLETE)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Production Queue System | 9 + 5 prereqs | HIGH-LOW | **COMPLETE (14/14, ~296 tests, 2 review rounds)** |
| Phase B | Building System | 15 + 8 gap additions | MEDIUM-HIGH | **COMPLETE (23/23, ~475 tests, all findings fixed)** |

### Phase A Completed: Production Queue System (14 files, 2026-06-14)

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| ProductionQueue.ts | ~1,554 | ~1,017 | ~80 | Central queue manager: deterministic tick, order handling, cost/time calc |
| Production.ts | ~248 | 0 | 0 | Base production trait: actor spawning at exits |
| ClassicProductionQueue.ts | ~256 | ~361 | ~35 | Shared queue speed-up: multi-factory build time reduction |
| ProductionParadrop.ts | ~148 | ~113 | ~15 | Paradrop delivery: aircraft + parachute spawn |
| ProductionFromMapEdge.ts | ~123 | ~105 | ~12 | Map edge spawn: closest edge cell + pathfinding |
| ProductionAirdrop.ts | ~156 | ~139 | ~15 | Airdrop delivery: land at building, produce, take off |
| Exit.ts | ~228 | ~227 | ~25 | Exit definition: priority-based selection, type filtering |
| RallyPoint.ts | ~268 | ~211 | ~20 | Post-production waypoint: path-based, order handling |
| PrimaryBuilding.ts | ~185 | ~132 | ~18 | Primary production flag: condition token, queue priority |
| Buildable.ts | ~185 | ~118 | ~15 | Buildable marker: prerequisites, queues, limits, icons |
| TechTree.ts | ~353 | ~300 | ~25 | Prerequisite tracking: !/~ prefix support, watcher callbacks |
| PowerManager.ts | ~107 | ~67 | ~8 | Power state tracking: Normal/Low/Critical |
| DeveloperMode.ts | ~131 | ~104 | ~10 | Cheat modes: FastBuild, AllTech, BuildAnywhere |
| ActorInitializer.ts | ~274 | ~214 | ~18 | Type-safe inits: ValueActorInit, RuntimeFlagInit |
| **Total** | **~4,216** | **~4,108** | **~296** | |

**Implementation details**:
- `ProductionQueue.ts` (~1,554 lines): Full deterministic tick processing with explicit loops (no LINQ). `[Sync]`-compatible fields with `VerifySync` decorator. `Map<string, ProductionState>` for producible cache. `ProductionItem[]` for queue storage. Order handling: StartProduction, PauseProduction, CancelProduction. `getBuildTime()` with FastBuild=0, BuildDurationModifier, and IProductionTimeModifierInfo. `getProductionCost()` with IProductionCostModifierInfo. `cancelUnbuildableItems()` for prerequisite loss. Low-power slowdown via `LowPowerModifier`.
- `ClassicProductionQueue.ts` (~256 lines): Build time speed reduction table [100, 86, 75, 67, 60, 55, 50] applied per active producer count. Primary building priority in producer selection. `mostLikelyProducer()` ordered by: not paused, is primary, highest ActorID.
- `Production.ts` (~248 lines): Base production trait with `doProduction()` spawning actors at exit points. `selectExit()` uses rally point or nearest exit. `canUseExit()` checks Mobile traversal from Ch9. `INotifyOwnerChanged` updates Faction on capture.
- `ProductionParadrop.ts` (~148 lines): Paradrop delivery spawning aircraft at map edge, flying to drop point, dropping unit with parachute. Integrates with Ch9 Aircraft trait.
- `ProductionAirdrop.ts` (~156 lines): Airdrop delivery with aircraft landing at building, producing unit, then taking off. Activity queue: Fly -> Land -> Wait -> produce -> Wait -> FlyOffMap -> RemoveSelf.
- `ProductionFromMapEdge.ts` (~123 lines): Map edge spawn for ground and air units. `ChooseClosestEdgeCell()` for aircraft, `ChooseClosestMatchingEdgeCell()` with pathfinding for mobile units.
- `Exit.ts` (~228 lines): `ExitExts.nearestExitOrDefault()` with priority-based selection and distance sorting. `exits()` filters by `ProductionTypes`. `randomExitOrDefault()` for priority-group random selection.
- `RallyPoint.ts` (~268 lines): Path-based waypoint system (`CPos[]`). `SetRallyPoint` order handling. `RallyPointOrderTargeter` for terrain click targeting. `resetPath()` to initial offsets. `isForceSet()` for force-set grouping.
- `PrimaryBuilding.ts` (~185 lines): Condition token management (`-1` sentinel). `setPrimaryProducer()` revokes other primaries for same queue type. `PrimaryExts.isPrimaryBuilding()` static helper. Auto-unset on trait disable.
- `Buildable.ts` (~185 lines): Full `BuildableInfo` with `Prerequisites` (string[] with `!` invert and `~` hide prefixes), `Queue` (Set<string>), `BuildLimit`, `ForceFaction`, `Icon`, `BuildDuration`, `BuildPaletteOrder`. `getInitialFaction()` helper.
- `TechTree.ts` (~353 lines): Prerequisite tracking with `!` invert and `~` hide prefix parsing. `Watchers` callback system for prerequisite change notifications. `HasPrerequisites()` and `IsHidden()` queries. `ITechTreeElement` interface implementation.
- `PowerManager.ts` (~107 lines): Power state enum (Normal/Low/Critical). `PowerDrained`/`PowerProvided` aggregation. `INotifyCreated` initialization. Low power detection for ProductionQueue slowdown.
- `DeveloperMode.ts` (~131 lines): Cheat modes (FastBuild, AllTech, BuildAnywhere). `ILobbyOptions` stub for future lobby UI. `INotifyCreated` reads lobby options.
- `ActorInitializer.ts` (~274 lines): Type-safe initializer system with `ValueActorInit<T>` and `RuntimeFlagInit`. `LocationInit`, `OwnerInit`, `FactionInit`, `CenterPositionInit`, `FacingInit`, `CreationActivityDelayInit`, `RallyPointInit` support. `TypeDictionary`-like container with `getOrDefault()`.

**Review**: 2 review rounds (R1: findings fixed, R2: APPROVED). 0 BLOCKERs remaining.
**Commits**: `cb11b31` (initial 9 core files), `b012f90` (5 prereq files), `7a92416` (R1 fixes).

### Phase B Completed: Building System (23 files, 2026-06-15)

**Original Plan (15 files, Buildable already done in Phase A)**:

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Building.ts | ~550 | -- | ~45 | Core building trait: footprint, occupancy, lifecycle, BaseProvider proximity |
| BuildingInfluence.ts | ~180 | -- | ~25 | World trait: CellLayer<InfluenceNode> linked-list spatial index |
| BaseBuilding.ts | ~40 | -- | ~8 | Tag trait for construction yards |
| BaseProvider.ts | ~250 | -- | ~20 | Build radius provider with cooldown timer + range circle renderables |
| PlaceBuilding.ts | ~470 | -- | ~35 | Building placement order handler: PlaceBuilding/LineBuild/PlacePlug orders |
| PlaceBuildingVariants.ts | ~60 | -- | ~8 | Actor variant cycling for placement |
| LineBuild.ts | ~240 | -- | ~22 | Wall line building: parent nodes, child segments, segment-notify interface |
| RequiresBuildableArea.ts | ~55 | -- | ~8 | Area type requirement for placement |
| BuildingUtils.ts | ~260 | -- | ~28 | Placement validation: isCellBuildable, canPlaceBuilding, getLineBuildCells |
| RepairableBuilding.ts | ~380 | -- | ~30 | Building repair: multi-player repairer list, HP step, bonus scaling |
| Gate.ts | ~290 | -- | ~25 | Animated gate: open/close state machine, ITemporaryBlocker, projectile height |
| Transforms.ts | ~310 | -- | ~22 | Actor transformation: canDeploy, deployTransform, Activity stub |
| Demolition.ts | ~280 | -- | ~20 | C4 demolition: DetonationDelay, flash effects, Demolish Activity stub |
| MapBuildRadius.ts | ~160 | -- | ~12 | Lobby options for ally/self build radius toggles |
| PlaceBuildingOrderGenerator.ts | ~600 | -- | ~40 | Building placement UI: ghost preview, footprint validation, variant cycling |
| **Subtotal** | **~4,125** | -- | **~348** | |

**Gap Analysis Additions (8 files)**:

| File | Lines (impl) | Tests | Notes |
|:---|:---:|:---:|:---|
| GivesBuildableArea.ts | ~80 | ~10 | Buildable area provider tag trait |
| LineBuildNode.ts | ~120 | ~15 | Line build connector node trait |
| Replacement.ts | ~90 | ~10 | Replacement config on placement |
| Replaceable.ts | ~60 | ~8 | Actor marked as replaceable |
| Plug.ts | ~100 | ~12 | Building plug connector trait |
| Pluggable.ts | ~120 | ~15 | Plug slot management on buildings |
| ActorMap.ts | ~380 | ~35 | World trait: spatial query index for actor occupancy |
| DeployOrderTargeter.ts + UnitOrderTargeter.ts | ~280 | ~22 | Order targeters for building placement |
| **Subtotal** | **~1,230** | **~127** | |

**Interface Additions**:
- `TraitsInterfaces.ts`: `ITargetableCells`, `IPlaceBuildingDecorationInfo`, `IDemolishable*`, `IPlaceBuildingPreview*`, `IOrderGenerator`, `EnterBehaviour`, `PlaceBuildingCellType`

**Key implementation details**:
- `Building.ts` (~550 lines): Full footprint management with `Map<string, FootprintCellType>`. `fromJSON()` parses footprint strings. `findBaseProvider()` proximity check with GivesBuildableArea integration. `IOccupySpace` implementation for actor map registration.
- `BuildingInfluence.ts` (~180 lines): Linked-list per cell via `CellLayer<InfluenceNode>`. `addInfluence()`/`removeInfluence()` with proper node prepend and recursive removal. `getBuildingsAt()` yields all actors at a cell.
- `BuildingUtils.ts` (~260 lines): `isCellBuildable()` checks map bounds, actor occupancy (via ActorMap), terrain types, and ramps. `canPlaceBuilding()` validates all footprint cells. `getLineBuildCells()` finds wall segments in 4 directions.
- `PlaceBuildingOrderGenerator.ts` (~600 lines): `IOrderGenerator` implementation for building placement. Ghost preview via footprint cell validation with colored rendering (green=valid, red=invalid). Variant cycling via hotkey. Line build mode with segment detection. Plug acceptance check. `clearBlockersOrders()` for replacement.
- `ActorMap.ts` (~380 lines): Spatial query index using CellLayer with efficient add/remove and query operations. Replaces the stubbed approach of checking only BuildingInfluence.
- `Gate.ts` (~290 lines): Position interpolation from 0 to OpenPosition over TransitionDelay ticks. `ITemporaryBlocker` reports blocking state. `IBlocksProjectiles` height based on open position. Auto-close after CloseDelay when no blockers.
- `RepairableBuilding.ts` (~380 lines): Multi-player repair with bonus scaling array [100, 150, 175, 200, 220, 240, 260, 280, 300]. `tick()` repairs HP and deducts cash at configured interval. Stops when fully repaired or repairers leave.
- `Transforms.ts` (~310 lines): `canDeploy()` checks placement validity at transform destination. `deployTransform()` queues Transform Activity (stub, full in Ch14). `IIssueOrder`/`IResolveOrder` for DeployTransform orders.
- `Demolition.ts` (~280 lines): C4 demolition with DetonationDelay, flash count + interval. `getDemolishActivity()` returns Demolish Activity (stub, full in Ch14). `DemolitionOrderTargeter` validates target relationships.

**Review**: All BLOCKER and MAJOR findings addressed in fix rounds.
**Commits**: `3428989` (6 prereqs), `51906f6` (BuildingInfluence), `84717e8` (infrastructure blockers), `c73328e` (BaseBuilding+RequiresBuildableArea+PlaceBuildingVariants), `ddbceb8` (BuildingUtils), `fe50197` (LineBuild+MapBuildRadius+BaseProvider), `eaebcb6` (PlaceBuilding), `2cc9e93` (PlaceBuildingOrderGenerator), `b17c914` (fixes), `ad4a0a1` (placement chain fixes), `56da79d` (Building core fixes).

**Test Status**: 281 test files, ~8,273 tests. Pre-existing flaky pool: 11 files, 368 failures (unchanged from Phase A baseline). `tsc --noEmit`: 0 errors.

**Phase B Summary**: 23 files total (15 original plan + 8 gap analysis). ~5,355 TS implementation lines, ~475 tests. Combined Chapter 11: 37 files, ~9,571 TS lines, ~771 tests. Chapter 11 is now 100% COMPLETE (ALL PHASES).

---

### Chapter 12: Shroud & Fog of War (IN PROGRESS, 15/16 committed, Phase A)

> **Migration Plan**: [docs/chapter12_shroud_fog_of_war_migration_plan.md](docs/chapter12_shroud_fog_of_war_migration_plan.md)
> **Created**: 2026-06-15 | **Updated**: 2026-06-15 | **Status**: IN PROGRESS (15/16 committed: 9 APPROVED + 6 under review, A.8 blocked)
> **Prerequisite**: Chapters 2-11 COMPLETE (311/311, 100%)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Shroud System | 15 (+1 optional) | LOW-HIGHEST | **IN PROGRESS (15/16 committed, 9 APPROVED, 6 under review, 1 blocked)** |

**APPROVED Files**:

| # | File | Lines (impl) | Lines (test) | Tests | Review | Date |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|
| A.1 | `src/OpenRA.Game/Traits/Player/Shroud.ts` | -- | -- | -- | APPROVED | 2026-06-15 |
| A.2 | `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` | ~720 | -- | 28 | APPROVED (R2) | 2026-06-15 |
| A.3 | `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` | -- | -- | 63 | APPROVED (R2) | 2026-06-15 |
| A.4 | `src/OpenRA.Mods.Common/Traits/Cloak.ts` | -- | -- | -- | APPROVED | 2026-06-15 |
| A.5 | `src/OpenRA.Mods.Common/Traits/AffectsShroud.ts` | -- | -- | -- | APPROVED | 2026-06-15 |
| A.7 | `src/OpenRA.Mods.Common/Traits/RevealsMap.ts` | -- | -- | -- | APPROVED | 2026-06-15 |
| A.9 | `src/OpenRA.Mods.Common/Traits/CreatesShroud.ts` | -- | -- | 76 | APPROVED | 2026-06-15 |
| A.10 | `src/OpenRA.Mods.Common/Traits/RevealsShroud.ts` | -- | -- | -- | APPROVED | 2026-06-15 |
| A.14 | `src/OpenRA.Mods.Common/ShroudExts.ts` | ~103 | -- | 17 | APPROVED | 2026-06-15 |

**Committed / Under Review**:

| # | File | Lines (impl) | Lines (test) | Tests | Review | Date | Commit |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| A.6 | `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts` | -- | -- | -- | Under Review | 2026-06-15 | `67b7731` |
| A.11 | `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.ts` | -- | -- | -- | Under Review | 2026-06-15 | `c68750e` |
| A.12 | `src/OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.ts` | -- | -- | -- | Under Review | 2026-06-15 | `114a8b1` |
| A.13 | `src/OpenRA.Mods.Common/Traits/DetectCloaked.ts` | -- | -- | -- | Under Review | 2026-06-15 | `2508bae` |
| A.15 | `src/OpenRA.Mods.Cnc/Traits/World/ShroudPalette.ts` | -- | -- | 23 | Under Review | 2026-06-15 | `5085dc0` |
| A.16 | `src/OpenRA.Mods.Common/Traits/Multipliers/RevealsShroudMultiplier.ts` | -- | -- | -- | Under Review | 2026-06-15 | `77255dc` |

**Blocked**:

| # | File | Reason |
|:---:|:---|:---|
| A.8 | `src/OpenRA.Mods.Common/Traits/Player/PlayerRadarTerrain.ts` | Awaiting architect design (97 C# lines, MEDIUM) |

**Estimated Effort**: ~2,594 C# source lines, ~5,500-7,000 TS implementation lines, ~200-250 tests.

**Key Architecture Decisions**:
- **ADR-12.1**: RTT fog-of-war overlay with per-cell `Uint8Array` visibility bitfield
- **ADR-12.2**: FrozenActor rendering with reduced-opacity `TransformNode` clones
- **ADR-12.3**: Centralized `VisibilityService` with per-player LRU cache
- **ADR-12.4**: Cloak as material effect (alpha/color/palette), not scene removal
- **ADR-12.5**: Shroud source reference counting identical to C# OpenRA
- **ADR-12.6**: Lazy shroud resolution with dirty cell tracking

**Next Steps**: 15/16 committed (94%). 9 APPROVED, 6 under review, 1 blocked (A.8 PlayerRadarTerrain). Await review results for the 6 under-review files before committing doc updates.

---

### Chapter 13: Support Powers (COMPLETE, 14/14 migrated)

> **Migration Plan**: [docs/chapter13_support_powers_migration_plan.md](docs/chapter13_support_powers_migration_plan.md)
> **Created**: 2026-06-15 | **Updated**: 2026-06-15 | **Status**: COMPLETE (14/14 migrated, 285 tests, R2 APPROVED)
> **Prerequisite**: Chapters 3, 5 Phase E, 6 Phases A/C, 7 Phases D/E, 8 Phase B, 9, 11, 12 COMPLETE

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Support Power System | 14 (+1 interface) | LOW-HIGHEST | **COMPLETE (14/14, 285 tests, R2 APPROVED)** |

**Phase A File Breakdown**:

| # | File | Target | C# Lines | TS Lines | Tests | Complexity | Status |
|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|
| A.1 | `SupportPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.ts` | 261 | 745 | 30 | HIGHEST | COMPLETE |
| A.2 | `SupportPowerManager.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.ts` | 321 | 864 | 62 | HIGHEST | COMPLETE |
| A.3 | `AirstrikePower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.ts` | 227 | 599 | 14 | HIGH | COMPLETE |
| A.4 | `NukePower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/NukePower.ts` | 244 | 731 | 18 | HIGH | COMPLETE |
| A.5 | `ParatroopersPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.ts` | 277 | 622 | 11 | HIGH | COMPLETE |
| A.6 | `ProduceActorPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.ts` | 114 | 316 | 10 | MEDIUM | COMPLETE |
| A.7 | `SpawnActorPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.ts` | 164 | 442 | 12 | MEDIUM | COMPLETE |
| A.8 | `GrantExternalConditionPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.ts` | 178 | 511 | 16 | MEDIUM | COMPLETE |
| A.9 | `DirectionalSupportPower.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.ts` | 51 | 154 | 14 | LOW | COMPLETE |
| A.10 | `SelectDirectionalTarget.cs` | `src/OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.ts` | 180 | 485 | 43 | LOW | COMPLETE |
| A.11 | `SupportPowerChargeBar.cs` | `src/OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.ts` | 65 | 271 | 19 | LOW | COMPLETE |
| A.12 | `WithSupportPowerActivationAnimation.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationAnimation.ts` | 53 | 255 | 14 | LOW | COMPLETE |
| A.13 | `WithSupportPowerActivationOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.ts` | 67 | 310 | 13 | LOW | COMPLETE |
| A.14 | `SupportPowerCrateAction.cs` | `src/OpenRA.Mods.Common/Traits/Crates/SupportPowerCrateAction.ts` | 48 | 118 | 7 | LOW | COMPLETE |
| -- | `INotifySupportPower` (interface) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (addition) | ~10 | ~39 | -- | LOW | COMPLETE |

**Actual Effort**: ~2,260 C# source lines, 6,423 TS implementation lines, 5,126 test lines, 285 tests. Commits: `aac45e2` (core infra), `8194110` (power implementations), `55be5d4` (render/crate), `830951d` (review fixes).

**Deferred to Chapter 19**: 6 C&C-specific powers (ChronoshiftPower, AttackOrderPower, DropPodsPower, GpsPower, GrantPrerequisiteChargeDrainPower, IonCannonPower).

**Key Architecture Decisions**:
- **ADR-13.1**: SupportPowerManager on Player actor (SystemActors.Player)
- **ADR-13.2**: Sub-tick precision timer as integer accumulator (no floating-point)
- **ADR-13.3**: OrderGenerator reuse via callback-based targeting modes (not subclassing)
- **ADR-13.4**: Beacon as world-space billboard with canvas-drawn clock animation
- **ADR-13.5**: C&C-specific powers deferred to Chapter 19
- **ADR-13.6**: INotifySupportPower interface in TraitsInterfaces.ts
- **ADR-13.7**: Aircraft formation path via Ch9 Fly activity

**Parallelization**:
- Track 1 (core): SupportPower + INotifySupportPower + SupportPowerManager (Week 1)
- Track 2 (directional): DirectionalSupportPower + SelectDirectionalTarget + AirstrikePower + ParatroopersPower (Weeks 1-2)
- Track 3 (standalone): NukePower + SpawnActorPower (Week 2-3)
- Track 4 (production/condition): ProduceActorPower + GrantExternalConditionPower (Week 3)
- Track 5 (visual): SupportPowerChargeBar + WithSupportPowerActivationAnimation + WithSupportPowerActivationOverlay + SupportPowerCrateAction (Week 3)

---

### Chapter 14: Activity Implementations (Phase A+B+C+D+E COMPLETE, 42/49 migrated)

> **Migration Plan**: [docs/chapter14_activity_implementations_migration_plan.md](docs/chapter14_activity_implementations_migration_plan.md)
> **Created**: 2026-06-15 | **Updated**: 2026-06-16 | **Status**: Phase A COMPLETE (11/11 files, 82 tests, 3 E2E pages R2 APPROVED); Phase B COMPLETE (6/6 files, ~70 tests, R2 APPROVED); Phase C COMPLETE (12/12 files, ~180 tests); Phase D COMPLETE (7/7 files, 161 tests)
> **Prerequisite**: Chapters 2-13 COMPLETE (341/341 core files, 100%)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Movement Activities | 11 | HIGHEST-MEDIUM | **COMPLETE (11/11, 82 tests, R2 APPROVED)** |
| Phase B | Combat Activities | 6 | HIGH-LOW | **COMPLETE (6/6, ~70 tests, R2 APPROVED)** |
| Phase C | Aircraft Activities | 12 | HIGH-LOW | **COMPLETE (12/12, ~180 tests)** |
| Phase D | Economic Activities | 7 | HIGH-LOW | **COMPLETE (7/7, 161 tests)** |
| Phase E | Transport & Enter Activities | 6 | HIGH-LOW | PLANNING (0/6) |
| Phase F | Utility & Miscellaneous | 8 | MEDIUM-LOW | **COMPLETE (8/8, 45 tests)** |

**Phase A Completed: Movement Activities (11 files, 2026-06-15)**

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Move.ts | ~640 | ~-- | ~-- | Core path follower with nested MovePart/MoveFirstHalf/MoveSecondHalf |
| MoveAdjacentTo.ts | ~159 | -- | -- | Wrapper: compute adjacent target cell and nearEnough distance |
| MoveOnto.ts | ~60 | -- | -- | Simple move-into-target-cell activity |
| MoveOntoAndTurn.ts | ~43 | -- | -- | Move onto cell then face target |
| MoveWithinRange.ts | ~78 | -- | -- | Move within WDist range of target |
| Drag.ts | ~73 | -- | -- | Pull/push another actor |
| Nudge.ts | ~64 | -- | -- | Micro-movement to unblock |
| Follow.ts | ~89 | -- | -- | Chase moving target, re-evaluate path |
| LocalMoveIntoTarget.ts | ~89 | -- | -- | Close-range approach to target |
| AttackMoveActivity.ts | ~108 | -- | -- | Combines Move + Hunt for attack-move orders |
| MoveCooldownHelper.ts | ~100 | -- | -- | Shared movement cooldown tracking |
| **Total** | **~1,500 C#** | **~--** | **82** | 11 test files, all passing |

**Acceptance Test Pages**: 3 pages created and R2 APPROVED:
- `src/__e2e__/manual/activities/move/` -- Ground movement path following
- `src/__e2e__/manual/activities/target-lines/` -- Target line rendering in 3D world space
- `src/__e2e__/manual/activities/attack-move/` -- Attack-move combat interruption

**Review**: ch14-reviewer, Round 2 APPROVED (0 BLOCKERs remaining).

**Key Architecture Decisions**:
- **ADR-14.1**: Reuse Chapter 3 Activity Base Without Modification
- **ADR-14.2**: Movement Logic Stays Grid-Based, Visuals Use 3D Interpolation
- **ADR-14.3**: Target Lines as World-Space LinesMesh
- **ADR-14.4**: Aircraft Activities Delegate Physics to Aircraft Trait
- **ADR-14.5**: All World Mutations Deferred to frameEndActions
- **ADR-14.6**: Phase Ordering by Dependency, Not File Size
- **ADR-14.7**: Enter Pattern as Shared Abstract Base

**Unblocks**: Phase B (Attack, Hunt, CaptureActor, Demolish, Turn), Phase D (MoveToDock), Phase E (Enter, UnloadCargo, Resupply, PickupUnit, DeliverUnit), Phase F (DeployForGrantedCondition)

---

### Chapter 15: Order Generators (COMPLETE, 11/11, 100%, 206 tests)

> **Migration Plan**: [docs/chapter15_order_generators_migration_plan.md](docs/chapter15_order_generators_migration_plan.md)
> **Status**: ALL PHASES COMPLETE (11/11, 100%, 206 tests)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Order Generator Foundation | 3 | LOW-MEDIUM | **COMPLETE (3/3, 59 tests, R1 APPROVED)** |
| Phase B | Core Order Generators | 4 | MEDIUM | **COMPLETE (4/4, 104 tests, R2 APPROVED)** |
| Phase C | Extended Order Generators | 2 | MEDIUM | **COMPLETE (2/2, 43 tests, R2 APPROVED)** |

Phase A: OrderGenerator.ts (275 lines, 29 tests), EnterAlliedActorTargeter.ts (262 lines, 30 tests), TraitsInterfaces.ts (IOrderGenerator + MouseActionType + IMouseSettings).

Phase B: UnitOrderGenerator.ts (~460 lines, 42 tests), RepairOrderGenerator.ts (~200 lines, 21 tests), BeaconOrderGenerator.ts (~120 lines, 13 tests), GlobalButtonOrderGenerator.ts (~300 lines, 28 tests).

Phase C: GuardOrderGenerator.ts (~260 lines, 28 tests), ForceModifiersOrderGenerator.ts (~200 lines, 15 tests).

Plus 3 already-migrated from Ch11: UnitOrderTargeter, DeployOrderTargeter, PlaceBuildingOrderGenerator.
Total: 11 files, ~1,870 TS lines, 206 tests. ALL PHASES APPROVED (0 BLOCKERs across all rounds).
Commits: `d47edf3` (plan), `cb792bd` (Phase A), `5070c5b` (Phase B), `af57cb2` (Phase C), `016798e`/`59e7933` (docs).

---

### Chapter 16: UI Widget Extensions (COMPLETE, 65/65, 100%, 1,900+ tests)

> **Migration Plan**: [docs/chapter16_ui_widget_extensions_migration_plan.md](docs/chapter16_ui_widget_extensions_migration_plan.md)
> **Status**: ALL PHASES COMPLETE (65/65, 100%, 1,900+ tests)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Primitive UI Controls | 23+7 deps | LOW-HIGH | **COMPLETE (30/30, 998 tests)** |
| Phase B | Game HUD Widgets & Utilities | 17 | LOW-HIGH | **COMPLETE (17/17, 577 tests)** |
| Phase C | Menu Screen Logic | 25 | LOW-HIGH | **COMPLETE (25/25, 325 tests)** |

Total: 65 files, 1,900+ tests, ~28,200 TS implementation lines across all phases.

---

### Chapter 17: Replay & Save System (COMPLETE, 8/8, 100%, 237 tests)

> **Migration Plan**: [docs/chapter17_replay_save_system_migration_plan.md](docs/chapter17_replay_save_system_migration_plan.md)
> **Status**: ALL PHASES COMPLETE (8/8, 100%, 237 tests)

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | GameInformation + ReplayMetadata | 2 | LOW-MEDIUM | **COMPLETE (2/2, 60 tests)** |
| Phase B | ReplayRecorder + ReplayConnection | 2 | HIGH | **COMPLETE (2/2, 67 tests)** |
| Phase C | GameSave + SlotClient | 2 | HIGH | **COMPLETE (2/2, 54 tests)** |
| Phase D | SyncReport + AutoSave + GameSaveViewportManager | 2 | MEDIUM | **COMPLETE (2/2, 56 tests)** |

Total: 8 files, 237 tests, ~4,900 TS lines. Commits: `57750d6` (docs finalize), `60ea67a` (review fixes), `0092808` (Phase D).

---

### Chapter 18: Server System (COMPLETE, 10/10, 100%, 240 tests)

> **Migration Plan**: [docs/chapter18_server_system_migration_plan.md](docs/chapter18_server_system_migration_plan.md)
> **Created**: 2026-06-16 | **Updated**: 2026-06-17 | **Status**: ALL PHASES COMPLETE (10/10, 100%, 240 tests)
> **Prerequisite**: Chapters 2-7 + 17 COMPLETE

| Phase | Description | Files | Complexity | Status |
|-------|-------------|:---:|:---:|--------|
| Phase A | Protocol and Interfaces Foundation | 3 | LOW | **COMPLETE (3/3, 52 tests, R1 APPROVED)** |
| Phase B | Server Core | 2 | HIGHEST | **COMPLETE (2/2, 87 tests, R2 APPROVED)** |
| Phase C | Connection Layer | 2 | LOW-MEDIUM | **COMPLETE (2/2, 57 tests)** |
| Phase D | Support Systems | 3 | LOW | **COMPLETE (3/3, 44 tests)** |

**Phase A Completed (2026-06-17)**:

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| ProtocolVersion.ts | 206 | 116 | 16 | Binary protocol constants (Handshake=7, Orders=21), order type byte enum, handshake flow documentation |
| TraitInterfaces.ts | 257 | 248 | 22 | 9 server trait interfaces, ServerTrait abstract base, DebugServerTrait |
| Exts.ts | 41 | 106 | 14 | `except()` utility function |
| **Total** | **504** | **470** | **52** | Commits: `da21496` (initial), `0b9b8d3` (review fixes) |

**Phase B Completed (2026-06-17)**:

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| SessionTypes.ts | 695 | 621 | 35 | Session, SessionClient (20+ fields), SessionSlot, SessionGlobalSettings, ConnectionQuality enum, serialization |
| Server.ts | 2,397 | 796 | 52 | Complete game server: IServerTransport/IClientTransport interfaces, WebSocket lifecycle, client validation, order broadcasting, sync hash verification, lobby synchronization, game start/end, chat/commands, save/load, player defeat |
| **Total** | **3,092** | **1,417** | **87** | Commits: `374e0ad` (initial), `d86ae8f` (docs). R2 APPROVED (2 review rounds) |

**Phase C Completed (2026-06-17)**:

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| Connection.ts | 425 | 544 | ~30 | Per-client WebSocket handler, header/data state machine, ping measurement, send queue, dispose/close |
| OrderBuffer.ts | 293 | 530 | ~27 | Dynamic order timing, per-player delta median, tick scale (1.0-1.1), baseline player, player removal |
| **Total** | **718** | **1,074** | **57** | Commit: `64756ef` |

**Phase D Completed (2026-06-17)**:

| File | Lines (impl) | Lines (test) | Tests | Notes |
|:---|:---:|:---:|:---:|:---|
| VoteKickTracker.ts | 375 | 605 | ~16 | Vote-to-kick lifecycle, eligible counting, cooldown, admin edge cases |
| MapStatusCache.ts | 306 | 380 | ~15 | Cached map validation, async remote linting, ILintServerMapPass |
| PlayerMessageTracker.ts | 188 | 342 | ~13 | Chat flood control, join cooldown, message limits, admin bypass |
| **Total** | **869** | **1,327** | **44** | Commit: `031f275` |

**Chapter 18 Overall Stats**:

| Metric | Value |
|--------|:---:|
| Total implementation files | 10 |
| Total test files | 10 |
| TS implementation lines | 5,183 |
| TS test lines | 4,288 |
| Combined TS lines | 9,471 |
| Total tests | 240 |
| Review rounds | 5+ across all phases |
| BLOCKERs remaining | 0 |

**Key Architecture Decisions (from chapter plan)**:
- ADR-18.1: Node.js game server with `ws` WebSocket library
- ADR-18.2: Web Worker hosted server for peer-hosted games
- ADR-18.3: Event-driven architecture replaces thread-based polling
- ADR-18.4: Session type consolidation in SessionTypes.ts
- ADR-18.5: Binary protocol preserved byte-for-byte over WebSocket
- ADR-18.6: IServerTransport interface for runtime-agnostic server

---

| ADR | Chapter | Decision |
|-----|---------|----------|
| ADR-8.1 | Ch8 | Warhead effects deferred to frame-end execution |
| ADR-8.2 | Ch8 | Projectile collision via `scene.pickWithRay()` |
| ADR-8.3 | Ch8 | `renderingGroupId=1` for combat overlays |
| ADR-8.4 | Ch8 | BoundingBox/BoundingSphere HitShape mapping |
| ADR-9.1 | Ch9 | TransformNode as position authority for Mobile |
| ADR-9.2 | Ch9 | Pathfinding integration via Ch4 Phase G BlockedByActor |
| ADR-10.1 | Ch10 | Billboard sprites for resource rendering |
| ADR-11.1 | Ch11 | Ghost mesh for building placement preview |
| ADR-12.1 | Ch12 | RTT fog-of-war overlay with visibility bitfield |
| ADR-12.2 | Ch12 | FrozenActor rendering with reduced opacity |
| ADR-13.1 | Ch13 | SupportPowerManager on Player actor (SystemActors.Player) |
| ADR-13.2 | Ch13 | Sub-tick precision timer as integer accumulator (no floating-point) |
| ADR-13.3 | Ch13 | OrderGenerator reuse via callback-based targeting modes (not subclassing) |
| ADR-13.4 | Ch13 | Beacon as world-space billboard with canvas-drawn clock animation |
| ADR-13.5 | Ch13 | C&C-specific powers deferred to Chapter 19 |
| ADR-13.6 | Ch13 | INotifySupportPower interface in TraitsInterfaces.ts |
| ADR-13.7 | Ch13 | Aircraft formation path via Ch9 Fly activity |
| ADR-15.1 | Ch15 | OrderGenerator as Command pattern |
| ADR-18.1 | Ch18 | Node.js game server with `ws` WebSocket |
| ADR-18.2 | Ch18 | Web Worker hosted server for peer-hosted games |
| ADR-19.1 | Ch19 | Voxel build-time conversion to glTF |
| ADR-19.2 | Ch19 | Mod-specific code lazy loading via dynamic `import()` |
| ADR-20.1 | Ch20 | Dual scripting strategy (JSON triggers + optional fengari Lua) |
| ADR-20.2 | Ch20 | Build-time Lua precompilation where possible |

### Phase Strategy (Dependency Order)

| Priority | Phase | Chapters | Est. Weeks (1 dev) | Depends On |
|:---:|:---|:---|:---:|-----------|
| **1** | Core Gameplay | 8, 9, 10 | ~25 | Ch2-7 |
| **2** | Game Loop Complete | 11, 14, 12 | ~16 | Phase 1 |
| **3** | Extended Features | 13, 15, 17 | ~7 (Ch13, Ch15 COMPLETE; Ch17 0/6) | Phase 1-2 |
| **4** | Polish & Mods | 16, 18, 19 | ~16 | Phase 1-3 |
| **5** | Stretch Goals | 20, 21 | ~8 | Phase 1-4 |

**Total estimated**: ~72 weeks (single developer) or ~20-24 weeks (3-4 developers with parallel tracks)

---

## Chapter 19: Mod-Specific Content (ALL PHASES COMPLETE, 119/119, 100%)

> **Migration Plan**: [docs/chapter19_mod_content_migration_plan.md](docs/chapter19_mod_content_migration_plan.md)
> **Created**: 2026-06-17 | **Updated**: 2026-06-17
> **Status**: ALL PHASES A-D COMPLETE (119/119 files, 100%, 4 Phases A-D + 45 deferred). Phase A R2 APPROVED (~528 tests), Phase B R2 APPROVED (~234 tests), Phase C R2 APPROVED (~200 tests), Phase D ALL APPROVED (~120 tests).

| Status | Count | Percentage |
|--------|-------|------------|
| Completed (Phase A+B+C+D) | 119 | 100% |
| Completed | 119 | 100% |
| In Progress | 0 | 0% |
| Pending | 0 | 0% |
| Deferred | 45 | Post-MVP |
| Already Migrated (prior chapters) | 8 | N/A |
| **Total planned** | **119** | **100%** |

### Phase Overview

| Phase | Description | Files | C# Lines | Est. TS Lines | Est. Tests | Status |
|:---|:---|:---:|:---:|:---:|:---:|:---|
| A | C&C Core Traits (Chrono, GPS, Infiltration, Attack, Support Powers, Misc) | 47 | ~6,600 | ~8,000 | ~528 | ✅ COMPLETE (R2 APPROVED) |
| B | D2K Mod Traits (Sandworm, Spice, Building, Visual) | 17 | ~2,000 | ~2,500 | ~90 | ✅ COMPLETE (R2 APPROVED) |
| C | C&C Rendering & Voxel (Render traits, Graphics, Voxel pipeline, Projectiles, Activities) | 37 | ~4,700 | ~5,000 | ~200 | ✅ COMPLETE (R2 APPROVED) |
| D | Supporting Infrastructure (File formats, Sprite loaders, Interfaces) | 18 | ~2,500 | ~3,000 | ~120 | ✅ COMPLETE (ALL APPROVED) |
| **Subtotal** | **4 Phases** | **119** | **~15,800** | **~18,500** | **~1,082** | **ALL PHASES A-D COMPLETE (100%)** |
| | | | | | | |
| Deferred | Build tools, video, audio, map generators, scripting | 45 | ~7,300 | 0 | 0 | DEFERRED |
| Already Migrated | FileSystem + ClassicFacingBodyOrientation + JumpjetLocomotor + ShroudPalette | 8 | ~600 | ~1,500 | Done | COMPLETE (Ch5/7/9/12) |

### Key Architecture Decisions (10 ADRs)

| ADR | Title |
|-----|-------|
| ADR-19.1 | Voxel Rendering Strategy — build-time `.vxl`→`.glb` conversion |
| ADR-19.2 | Mod-specific code lazy loading via dynamic `import()` |
| ADR-19.3 | Infiltration trait composition pattern (priority-ordered stacking) |
| ADR-19.4 | Sandworm underground state via mesh visibility + collision toggle |
| ADR-19.5 | Chronoshift deferred teleport (queue in tick, apply in frameEndActions) |
| ADR-19.6 | Multi-part voxel model hierarchy via parent-child TransformNode |
| ADR-19.7 | Sprite sequence loader factory pattern |
| ADR-19.8 | File format compression — line-for-line port strategy |
| ADR-19.9 | Legacy utility commands as build-time Node.js tools |
| ADR-19.10 | Proprietary audio/video — AUD/VOC build-time conversion, VQA/WSA deferred |

### Phase Dependencies

```
Ch2-18 Foundation → Phase D (Infrastructure) → Phase A (C&C Core) → Phase C (Rendering/Voxel)
                                          ↘ Phase B (D2K) ↗
```

Phase D must begin early (sprite loaders + file formats unblock all other phases). Phases A and B can run in parallel with Phase D. Phase C depends on Phase A + D.

### Deferred Items (Post-MVP)

| Category | Files | Lines | Reason |
|----------|:---:|:---:|--------|
| Utility Commands (C&C 11 + D2K 2) | 13 | ~3,200 | Build-time Node.js tools |
| Video loaders/formats (VqaVideo, WsaVideo, VqaLoader, WsaLoader) | 4 | ~833 | Video playback deferred (ADR-19B) |
| Audio loaders (AudLoader, VocLoader) | 2 | ~468 | Build-time conversion to WAV/Opus (ADR-19C) |
| Map generators (TSMapGenerator, D2kMapGenerator) | 2 | ~1,639 | Requires MapGenerator infrastructure (ADR-19.5) |
| Scripting properties (4 C&C) | 4 | ~170 | Depends on Chapter 20 |
| Other (CncLoadScreen, Installer, Widgets, Editor, Xcc databases, PurchaseWidgetLogic) | 11 | ~990 | Low priority / editor-only / build tools |
| **Subtotal Deferred** | **45** | **~7,300** | |

---

## Chapter 22: Game Entry & Application Shell (ALL PHASES A-E COMPLETE, 7/7, 100%)

> **Migration Plan**: [docs/chapter22_game_entry_migration_plan.md](docs/chapter22_game_entry_migration_plan.md)
> **Original Design Doc**: [docs/game_entry_design.md](docs/game_entry_design.md)
> **Created**: 2026-06-18 | **Updated**: 2026-06-18
> **Status**: COMPLETE (7/7 migrated, 100%, ALL 5 PHASES A-E COMPLETE). Phase A: Router + ModSelector + HTML Shell + Vite Config (51 tests, APPROVED). Phase B: Game class + loadMod pipeline + main.ts wiring (81 tests, APPROVED). Phase C: Main Menu shellmap fallback + widgets (COMPLETE). Phase D: Editor Stub /editor/:modId placeholder (COMPLETE). Phase E: Real Assets build pipeline + generated mod data (COMPLETE, 150+ generated assets).

| Status | Count | Percentage |
|--------|-------|------------|
| Completed | 7 | 100% |
| In Progress | 0 | 0% |
| Pending | 0 | 0% |
| **Total planned** | **7** | **100%** |

### Phase Overview

| Phase | Description | Files | Est. TS Lines | Est. Tests | Status |
|:---|:---|:---:|:---:|:---:|:---|
| A | Foundation (Router + ModSelector + HTML shell + Vite SPA switch) | 4 + 2 modified | ~400 | 51 | ✅ COMPLETE (2026-06-18) |
| B | Bootstrap (Game class + loadMod pipeline + main.ts wiring) | 2 + 1 modified | ~700 | 81 | ✅ COMPLETE (2026-06-18) |
| C | Main Menu (shellmap fallback + main menu widgets) | 0 (extend Game.ts) | ~200 | ~20 | ✅ COMPLETE (2026-06-18) |
| D | Editor Stub (/editor/:modId placeholder) | 0 (extend main.ts) | ~50 | ~0 | ✅ COMPLETE (2026-06-18) |
| E | Real Assets (build pipeline, OpenRA mod data conversion) | 0 (build tools) | ~50 | ~0 | ✅ COMPLETE (2026-06-18) |
| **Total** | **5 Phases (5/5 COMPLETE)** | **7** | **~1,200** | **~160** | **100% (ALL PHASES COMPLETE)** |

### File Inventory

| # | File | Lines (C# ref) | Complexity | Phase |
|:---:|:---|:---:|:---:|:---:|
| 1 | `src/OpenRA.Game/Router.ts` (NEW) | — | LOW | A |
| 2 | `src/OpenRA.Game/Router.test.ts` (NEW) | — | LOW | A |
| 3 | `src/OpenRA.Game/ModSelector.ts` (NEW) | — | MEDIUM | A |
| 4 | `src/OpenRA.Game/ModSelector.test.ts` (NEW) | — | MEDIUM | A |
| 5 | `src/OpenRA.Game/Game.ts` (NEW, ~1000 C# ref) | ~1000 (Game.cs) | HIGH | B |
| 6 | `src/OpenRA.Game/Game.test.ts` (NEW) | — | HIGH | B |
| 7 | `src/main.ts` (REWRITE) | — | MEDIUM | B |

### Modified Files

| # | File | Change | Phase |
|:---:|:---|:---|:---:|
| M1 | `index.html` | Rewrite Vite scaffold → Game app shell (canvas + mod selector + loader) | A |
| M2 | `vite.config.ts` | Remove `appType: 'mpa'` → SPA mode (test plugin preserved) | A |

### New Static Resources

| # | File | Description | Phase |
|:---:|:---|:---|:---:|
| SR1 | `public/mods/_index.json` | Available mods manifest | A |
| SR2 | `public/mods/_test/mod.json` | Minimal test mod (pipeline verification) | A |
| SR3-6 | `public/mods/{ra,td,d2k,ts}/mod.json` | Mod stub manifests | E |

### Key Architecture Decisions (5 ADRs)

| ADR | Title | Phase |
|-----|-------|:---:|
| ADR-22.1 | Game class is instance-based (not static) | B |
| ADR-22.2 | SPA mode with client-side Router (not MPA) | A |
| ADR-22.3 | Mod Selector uses plain DOM (no game engine) | A |
| ADR-22.4 | Mod assets as static files (not a single bundle) | E |
| ADR-22.5 | Shellmap phased rollout (static → preview → dynamic) | C |

### Phase Dependencies

```
Phase A (Foundation: Router + ModSelector + HTML + Vite SPA)
  |
  +---> Phase B (Bootstrap: Game class + loadMod + main.ts wiring)
          |
          +---> Phase C (Main Menu: shellmap fallback)
          |
          +---> Phase D (Editor Stub: /editor/:modId placeholder)
          
Phase E (Real Assets: build pipeline, blocked on external dependencies)
```

### External Dependencies

| Dependency | Source Chapter | Needed By |
|------------|:---:|:---|
| Renderer, WorldRenderer, Babylon.js Engine | Ch2 | Phase B (Game.initializeEngine) |
| World, GameWorldManager | Ch3 | Phase B (Game.startGame) |
| FileSystem, ModData, Manifest | Ch5 | Phase B (Game.loadMod) |
| OrderManager, Order | Ch6 | Phase B (Game.loadMod local play) |
| Sound, SoundDevice | Ch7 | Phase B (Game.loadMod audio init) |
| MiniYAML pipeline | Ch4 Phase H | Phase E (build pipeline) |

**Chapter 22 can begin in parallel with Chapter 21 (Editor & Utilities).** No hard dependency between the two.


---

## Content Installer Pipeline (Phase A COMPLETE, 13/13, 100%)

> **Execution Plan**: [docs/content_installer_execution_plan.md](docs/content_installer_execution_plan.md)
> **Design Document**: [docs/content_installer_design.md](docs/content_installer_design.md)
> **Created**: 2026-06-19 | **Updated**: 2026-06-19
> **Status**: Phase A COMPLETE (13/13 tasks, 100%). Phase B PLANNING. Phase C PLANNING.

| Status | Count | Percentage |
|--------|-------|------------|
| Completed (Phase A) | 13 | 52% (of 25 total) |
| Planning (Phase B) | 8 | 32% |
| Planning (Phase C) | 4 | 16% |
| **Total planned** | **25** | **100%** |

### Phase A Completion

| Phase | Description | Files | Status |
|:---|:---|:---:|:---|
| A | Core Download Pipeline | 13 (8 new TS + 2 modified + 2 build scripts + 1 test batch) | COMPLETE |
| B | Polish & Offline | 8 | PLANNING |
| C | Multi-Mod Support | 4 | PLANNING |

### Phase A Details

| Metric | Value |
|--------|-------|
| **Date Completed** | 2026-06-19 |
| **Commit Range** | `f6970d8` through `c908c43` |
| **Files Created/Modified** | 34 |
| **Implementation Lines** | ~4,800 |
| **Test Lines** | ~800+ |
| **Phase A Tests** | 171+ (all passing) |
| **Total Test Suite** | 17,047 tests, all passing |

### New Modules (Phase A)

| Module | File | Description |
|--------|------|-------------|
| ContentInstallerTypes | `src/OpenRA.Game/ContentInstaller/ContentInstallerTypes.ts` | Type definitions for installation pipeline |
| Sha1Verifier | `src/OpenRA.Game/ContentInstaller/Sha1Verifier.ts` | SHA1 via Web Crypto API |
| MirrorResolver | `src/OpenRA.Game/ContentInstaller/MirrorResolver.ts` | Fetch mirror list, random selection |
| DownloadManager | `src/OpenRA.Game/ContentInstaller/DownloadManager.ts` | Streaming download + retry |
| MixFileRuntime | `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` | Runtime C&C MIX parser |
| PackageExtractor | `src/OpenRA.Game/ContentInstaller/PackageExtractor.ts` | ZIP + sub-format extraction |
| ContentInstallerService | `src/OpenRA.Game/ContentInstaller/ContentInstallerService.ts` | State machine orchestrator |
| ContentInstallerUI | `src/OpenRA.Game/ContentInstaller/ContentInstallerUI.ts` | DOM overlay UI |

### Build Scripts (Phase A)

| Script | Description |
|--------|-------------|
| `scripts/build-content.ts` | Converts OpenRA installer YAML to web JSON manifests |
| `scripts/build-mixdb.ts` | Generates MIX filename hash database |

### Modified Existing Files (Phase A)

| File | Change |
|------|--------|
| `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` | Updated MixLoader to use MixFileRuntime |
| `src/OpenRA.Game/Game.ts` | Content install check in loadMod pipeline |

---

## Post-Migration Completion (2026-06-18)

> **Plan**: [docs/post_migration_completion_plan.md](docs/post_migration_completion_plan.md)
> **Status**: PLANNING (0/52 items, 0%). All 22 chapters migrated (100%); remaining work is deferred 3D rendering, stubs, and polish.

All 22 migration chapters (2-22) are at 100% file count (~763+ files). However, ~52 genuinely unfinished items remain. These were intentionally scoped out during the initial migration as deferred TODOs, stub implementations, and post-MVP polish items.

### Summary Statistics

| Category | Count | Priority |
|----------|:-----:|----------|
| **Phase A: Runtime Critical Fixes** | 3 | BLOCKER (2) + HIGH (1) |
| **Phase B: 3D Rendering Integration** | 11 | MEDIUM (9) + LOW (2) |
| **Phase C: Shroud/Fog Completion** | 7 | MEDIUM (5) + LOW (2) |
| **Phase D: Infrastructure Fill-in** | 8 | HIGH (2) + MEDIUM (4) + LOW (2) |
| **Phase E: Mod Content & Polish** | 23 | LOW (19) + MEDIUM (4) |
| **NOP/DOC-ONLY: Platform Stubs** | 9 | No work needed (intentionally empty) |
| **Total** | **52** | BLOCKER: 2, HIGH: 3, MEDIUM: 22, LOW: 25 |

### Phase Status

| Phase | Items | Status | Est. Lines | Est. Tests |
|:---|:---:|:---|:---:|:---:|
| A: Runtime Critical | 3 | 📋 PLANNING | ~430 | ~15 |
| B: 3D Rendering | 11 | 📋 PLANNING | ~2,220 | ~80 |
| C: Shroud/Fog | 7 | 📋 PLANNING | ~670 | ~35 |
| D: Infrastructure | 8 | 📋 PLANNING | ~1,790 | ~45 |
| E: Mod Polish | 23 | 📋 PLANNING | ~2,500 | ~80 |
| **Total** | **52** | **0%** | **~7,600** | **~255** |

### Key Notes

- The AnimationStub replacement (P1-B.1) is the **keystone** -- replacing it unblocks 6+ C&C visual effects simultaneously
- Phase A items are all independent and can run in parallel (estimated 1-2 days)
- Phase E items are 23 mostly-independent mod polish tasks (all LOW complexity)
- 9 NOP platform stubs require no work (browser APIs replace SDL2/OpenGL/OpenAL/FreeType)
- See the full plan at [docs/post_migration_completion_plan.md](docs/post_migration_completion_plan.md) for detailed TODO checklists, ADRs, and dependency graphs

**Chapter-level deferred TODO references preserved from original migration**:
- `TODO-12.DEFERRED.6` through `TODO-12.DEFERRED.17` (13 Shroud/Fog items, now tracked in Phases A+C)
- `TODO-19.C.2` through `TODO-19.C.16` (15 C&C rendering items, now tracked in Phases B+E)
- `TODO-22.C` through `TODO-22.E` (3 Game Entry items, now tracked in Phases A+D)
- `TODO-2.8.3` (Texture readPixels, now tracked in Phase B)
- `TODO-4.E.5` (Logging, now tracked in Phase D)
