# OpenRAWeb3D Acceptance Test Completion Plan

> **Source Reference**: [CLAUDE.md](../CLAUDE.md) — Project Status table, Acceptance Testing section
> **Audit Date**: 2026-06-19
> **Current Coverage**: 87 test pages across 16 chapter directories (Ch02-Ch22). P0-A: ✅ (7/7), P0-B: ✅ (4/4)
> **Target**: Comprehensive manual visual acceptance test coverage for all rendering-dependent modules
>
> **Important Statement**: Test pages reside under `src/__e2e__/manual/`. The `acceptance-test-assistant` agent owns this directory exclusively. The `acceptance-test-runner` agent executes Playwright automated verification. All test page creation must follow the agent workflow defined in [CLAUDE.md](../CLAUDE.md) and `.claude/agents/acceptance-test-assistant.md`.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [Coverage Gap Analysis](#2-coverage-gap-analysis)
3. [Test Page Mapping Table](#3-test-page-mapping-table)
4. [Core Tasks (TODO)](#4-core-tasks-todo)
   - 4.1 [Phase P0-A: Ch08 Projectile Visuals](#41-phase-p0-a-ch08-projectile-visuals)
   - 4.2 [Phase P0-B: Ch08 Combat VFX & Warhead Effects](#42-phase-p0-b-ch08-combat-vfx--warhead-effects)
   - 4.3 [Phase P1-A: Ch21 Editor Visuals](#43-phase-p1-a-ch21-editor-visuals)
   - 4.4 [Phase P1-B: Ch07 Effects, Selection & Render Traits](#44-phase-p1-b-ch07-effects-selection--render-traits)
   - 4.5 [Phase P2-A: Ch11 Production & Building Placement](#45-phase-p2-a-ch11-production--building-placement)
   - 4.6 [Phase P2-B: Ch08 Air Combat & Turreted](#46-phase-p2-b-ch08-air-combat--turreted)
   - 4.7 [Phase P3-A: Ch05 UI Core Layout](#47-phase-p3-a-ch05-ui-core-layout)
   - 4.8 [Phase P3-B: Ch09 Movement Visuals](#48-phase-p3-b-ch09-movement-visuals)
   - 4.9 [Phase P3-C: Ch16 Widget Primitives](#49-phase-p3-c-ch16-widget-primitives)
   - 4.10 [Phase P3-D: Ch03 Actor Visuals & Ch20 Scripting Visuals](#410-phase-p3-d-ch03-actor-visuals--ch20-scripting-visuals)
5. [Dependency Graph](#5-dependency-graph)
6. [Verification and Test Strategy](#6-verification-and-test-strategy)
7. [Risk and Considerations](#7-risk-and-considerations)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Objective

This plan addresses the gaps identified in the 2026-06-19 acceptance test coverage audit. The audit found **76 existing test pages** across 16 chapter directories, with significant gaps in chapters with heavy visual/rendering components: Ch08 (1/57 files covered), Ch21 (0/54+ files), Ch07 (1/13 files), and Ch11 (0/37 files).

### 1.2 Prioritization Principles

Test pages are prioritized by three factors:

1. **Visual complexity**: Modules with shader effects, particle systems, projectile trajectories, or real-time animations take priority over static UI layouts.
2. **Gameplay criticality**: Combat systems (Ch08) directly affect game balance and player experience — visual bugs here have the highest user impact.
3. **Coverage density**: A single well-designed test page can cover multiple related modules (e.g., one "projectile gallery" page tests Missile + LaserZap + Railgun + GravityBomb simultaneously).

### 1.3 Test Page Design Principles

1. **One page, one observable behavior**: Each test page verifies a specific visual/behavioral aspect. Avoid "kitchen sink" pages.
2. **Quantifiable expectations**: Every README.md must contain at least 3 measurable criteria (color hex values, pixel thresholds, frame counts, time ranges).
3. **`__testHarness` API exposure**: Each `main.ts` exposes a `window.__testHarness` object for Playwright programmatic verification, following the acceptance-test-runner spec.
4. **Self-contained**: Test pages must run independently without depending on main application state.
5. **Coordinate system fidelity**: All directional/angular tests must reference OpenRA's WAngle convention (0=North, counter-clockwise increasing).

### 1.4 Completed Foundation

The following test infrastructure is already in place:

| Infrastructure | Location | Status |
|---------------|----------|--------|
| Hub page (auto-discovery) | [src/__e2e__/manual/index.html](../src/__e2e__/manual/index.html) | ✅ Active |
| Vite test route plugin | [vite.config.ts](../vite.config.ts) | ✅ Active |
| Page layout template | `.claude/agents/acceptance-test-assistant.md` | ✅ Defined |
| Playwright test runner | `.claude/agents/acceptance-test-runner.md` | ✅ Defined |
| Redundancy check + commit gate | `.claude/teams/openra-acceptance-test/config.json` | ✅ Defined |

---

## 2. Coverage Gap Analysis

### 2.1 Current State

| Chapter | Source Files | Existing Tests | Coverage | Gap Severity |
|---------|:---:|:---:|--------|:---:|
| Ch02 Rendering | 27 | 13 | 🟢 Good | None |
| Ch03 Actor System | 36 | 3 | 🟡 Sparse | Minor |
| Ch04 Map & Terrain | 37 | 6 | 🟢 Good | None |
| Ch05 UI System | 16 | 1 | 🟠 Thin | Moderate |
| Ch06 Network Sync | 29 | 0 | ⚪ N/A | None (pure logic) |
| Ch07 Input/Camera/Audio/Effects | 13 | 1 | 🔴 Very Sparse | **MAJOR** |
| Ch08 Weapons & Combat | 57 | 8 | 🟡 Improved | Moderate (P0-A complete, P0-B pending) |
| Ch09 Movement & Physics | 30 | 0 | 🟡 Missing | Minor |
| Ch10 Resource Economy | 25 | 3 | 🟢 Good | None |
| Ch11 Production & Building | 37 | 0 | 🟠 Missing | Moderate |
| Ch12 Shroud & Fog | 16 | 6 | 🟢 Good | None |
| Ch13 Support Powers | 14 | 3 | 🟡 Adequate | Minor |
| Ch14 Activities | 49 | 11 | 🟢 Good | None |
| Ch15 Order Generators | 11 | 0 | ⚪ N/A | None (pure logic) |
| Ch16 UI Widgets | 65 | 4 | 🟡 Sparse | Minor |
| Ch17 Replay & Save | 8 | 4 | 🟢 Good | None |
| Ch18 Server System | 10 | 0 | ⚪ N/A | None (pure logic) |
| Ch19 Mod Content | 119 | 15 | 🟡 Adequate | Minor |
| Ch20 Scripting | 62 | 1 | 🟡 Sparse | Minor |
| Ch21 Editor & Utilities | 54+ | 0 | 🔴 Missing | **MAJOR** |
| Ch22 Game Entry | 7 | 4 | 🟢 Good | None |

### 2.2 Gap Summary

| Priority | Chapters | New Pages Needed | Modules Covered |
|:---:|---------|:---:|---|
| **P0** | Ch08 Projectiles + Combat VFX | 11 | Missile, LaserZap, NukeLaunch, AreaBeam, Railgun, GravityBomb, InstantHit, warhead effects, muzzle overlays, attack animations, explosion VFX |
| **P1** | Ch21 Editor + Ch07 Effects | 7 | Editor actor layer, cursor/brush, resource paint, selection visual, sprite effects, idle overlay, bullet trajectory |
| **P2** | Ch11 Production + Ch08 Air | 5 | Building placement, rally point, production queue, bomber run, turret rotation |
| **P3** | Ch05 UI + Ch09 Movement + Ch16 Widgets + Ch03/Ch20 | 8 | Widget layout, chrome theme, path follow, turn animation, button/slider/dropdown, actor selection, Lua scripting visual |
| **Total** | | **31** | |

---

## 3. Test Page Mapping Table

### 3.1 Complete Test Page Inventory (31 new pages across 10 phases)

| # | Test Case ID | Directory | Primary Module(s) | Visual Aspect | Complexity | Phase |
|:---:|:---|:---|:---|:---|:---:|:---:|
| **Phase P0-A: Ch08 Projectile Visuals** | | | | | | |
| 1 | `missile-trajectory` | `ch08-weapons-combat/missile-trajectory/` | `Missile.ts` | Missile flight path, contrail, homing curve | HIGH | P0-A |
| 2 | `laser-zap-beam` | `ch08-weapons-combat/laser-zap-beam/` | `LaserZap.ts` | Instant laser beam, glow, player color, duration | MEDIUM | P0-A |
| 3 | `nuke-launch` | `ch08-weapons-combat/nuke-launch/` | `NukeLaunch.ts` | Ascent trail, altitude detonation, flash | HIGH | P0-A |
| 4 | `area-beam-tesla` | `ch08-weapons-combat/area-beam-tesla/` | `AreaBeam.ts` | Cylinder beam, width falloff, fade-in/out | MEDIUM | P0-A |
| 5 | `railgun-trail` | `ch08-weapons-combat/railgun-trail/` | `Railgun.ts` | Beam trail, high-velocity projectile, instant hit | MEDIUM | P0-A |
| 6 | `gravity-bomb` | `ch08-weapons-combat/gravity-bomb/` | `GravityBomb.ts` | Ballistic arc, gravity drop, ground impact | LOW | P0-A |
| 7 | `instant-hit-hitscan` | `ch08-weapons-combat/instant-hit-hitscan/` | `InstantHit.ts` | Zero-travel-time, blocked-by-actor line check | LOW | P0-A |
| **Phase P0-B: Ch08 Combat VFX & Warhead Effects** | | | | | | |
| 8 | `explosion-effects` | `ch08-weapons-combat/explosion-effects/` | `CreateEffectWarhead.ts`, `SpriteEffect.ts` | Explosion sprite sequence, ground scorch, debris | HIGH | P0-B |
| 9 | `muzzle-overlay` | `ch08-weapons-combat/muzzle-overlay/` | `WithMuzzleOverlay.ts` | Muzzle flash at weapon hardpoint, camera-facing | MEDIUM | P0-B |
| 10 | `attack-animation` | `ch08-weapons-combat/attack-animation/` | `WithAttackAnimation.ts`, `WithAttackOverlay.ts` | Attack sprite sequence, overlay timing | MEDIUM | P0-B |
| 11 | `warhead-impact-gallery` | `ch08-weapons-combat/warhead-impact-gallery/` | `SpreadDamageWarhead.ts`, `FireClusterWarhead.ts`, `FlashEffectWarhead.ts` | AOE radius, cluster sub-explosions, screen flash, camera shake | MEDIUM | P0-B |
| **Phase P1-A: Ch21 Editor Visuals** | | | | | | |
| 12 | `actor-placement` | `ch21-editor/actor-placement/` | `EditorActorLayer.ts`, `EditorActorPreview.ts` | Actor drag, placement preview, ghost rendering, grid snap | HIGH | P1-A |
| 13 | `cursor-brush` | `ch21-editor/cursor-brush/` | `EditorCursorLayer.ts`, `TilingPathTool.ts` | Brush size overlay, tile selection, path draw preview | MEDIUM | P1-A |
| 14 | `resource-paint` | `ch21-editor/resource-paint/` | `EditorResourceLayer.ts` | Resource painting on terrain, density visualization | LOW | P1-A |
| 15 | `editor-ui-shell` | `ch21-editor/editor-ui-shell/` | Editor UI layout | Toolbar, minimap, property panel, menu bar | MEDIUM | P1-A |
| **Phase P1-B: Ch07 Effects, Selection & Render Traits** | | | | | | |
| 16 | `sprite-particle-effects` | `ch07-input-camera/sprite-particle-effects/` | `SpriteEffect.ts`, `FloatingSpriteEmitter.ts` | Billboard particles, emitter lifetime, spawn rate | HIGH | P1-B |
| 17 | `selection-visual` | `ch07-input-camera/selection-visual/` | `SelectionUtils.ts` | Selection box drag, multi-select, double-click, highlight | MEDIUM | P1-B |
| 18 | `idle-overlay` | `ch07-input-camera/idle-overlay/` | `WithIdleOverlay.ts` | Idle animation overlay, pause/play, timing | LOW | P1-B |
| **Phase P2-A: Ch11 Production & Building Placement** | | | | | | |
| 19 | `building-placement` | `ch11-production/building-placement/` | `PlaceBuilding.ts`, `BuildingUtils.ts` | Ghost preview, valid/invalid cell highlight, grid snap | HIGH | P2-A |
| 20 | `rally-point` | `ch11-production/rally-point/` | `RallyPoint.ts` | Rally flag visual, multi-rally, line rendering | MEDIUM | P2-A |
| 21 | `production-queue` | `ch11-production/production-queue/` | `ProductionQueue.ts`, `ClassicProductionQueue.ts` | Queue UI, progress bars, countdown, ready indicator | MEDIUM | P2-A |
| **Phase P2-B: Ch08 Air Combat & Turreted** | | | | | | |
| 22 | `bomber-run` | `ch08-weapons-combat/bomber-run/` | `AttackBomber.ts`, `Aircraft.ts` | Bombing run path, bomb drop sequence, fly-over | HIGH | P2-B |
| 23 | `turret-rotation` | `ch08-weapons-combat/turret-rotation/` | `Turreted.ts`, `AttackTurreted.ts` | Turret rotation, turn rate limit, target tracking | MEDIUM | P2-B |
| **Phase P3-A: Ch05 UI Core Layout** | | | | | | |
| 24 | `widget-layout` | `ch05-ui/widget-layout/` | `Widget.ts`, `WidgetLoader.ts` | Widget nesting, margin/padding, z-ordering, bounds | MEDIUM | P3-A |
| 25 | `chrome-theme` | `ch05-ui/chrome-theme/` | `ChromeProvider.ts`, `ChromeMetrics.ts` | Theme colors, border styles, panel rendering | LOW | P3-A |
| **Phase P3-B: Ch09 Movement Visuals** | | | | | | |
| 26 | `path-follow-visual` | `ch09-movement/path-follow-visual/` | `Mobile.ts`, `Locomotor.ts` | Unit path following, waypoint traversal, speed | MEDIUM | P3-B |
| 27 | `turn-animation` | `ch09-movement/turn-animation/` | `Mobile.ts` (turn), `WAngle.ts` | Unit turn animation, facing direction, turn rate caps | LOW | P3-B |
| **Phase P3-C: Ch16 Widget Primitives** | | | | | | |
| 28 | `button-states` | `ch16-widgets/button-states/` | ButtonWidget | Hover, press, disabled, active states; color transitions | LOW | P3-C |
| 29 | `slider-control` | `ch16-widgets/slider-control/` | SliderWidget | Thumb drag, track fill, value display, step snap | LOW | P3-C |
| 30 | `dropdown-menu` | `ch16-widgets/dropdown-menu/` | DropDownWidget | Open/close animation, item highlight, scroll, selection | LOW | P3-C |
| **Phase P3-D: Ch03 Actor Visuals & Ch20 Scripting Visuals** | | | | | | |
| 31 | `script-driven-effects` | `ch20-scripting/script-driven-effects/` | Lua scripting API | Script-triggered animations, camera moves, dialogue | MEDIUM | P3-D |

> **Complexity Legend**:
> - **LOW**: Simple static rendering or single-property verification. ~2-3 quantifiable expectations. ~1-2 hours.
> - **MEDIUM**: Multiple interacting components or dynamic behavior. ~4-6 quantifiable expectations. ~3-5 hours.
> - **HIGH**: Complex multi-stage simulation with timing-sensitive behavior. ~7+ quantifiable expectations. ~5-8 hours.

### 3.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total new test pages** | 31 |
| **P0 (Critical)** | 11 pages (Ch08 projectiles + combat VFX) |
| **P1 (Major)** | 7 pages (Ch21 editor + Ch07 effects) |
| **P2 (Moderate)** | 5 pages (Ch11 production + Ch08 air) |
| **P3 (Minor)** | 8 pages (Ch05, Ch09, Ch16, Ch03/Ch20) |
| **HIGH complexity** | 7 pages |
| **MEDIUM complexity** | 17 pages |
| **LOW complexity** | 7 pages |
| **Existing test pages (unchanged)** | 76 |
| **Target total after completion** | 107 |

| Phase | Priority | Pages | Est. Hours | Status |
|:---|:---:|:---:|:---:|:---|
| P0-A: Ch08 Projectile Visuals | P0 | 7 | ~35 | ✅ COMPLETE (2026-06-19) |
| P0-B: Ch08 Combat VFX & Warheads | P0 | 4 | ~20 | ✅ COMPLETE (2026-06-19) |
| P1-A: Ch21 Editor Visuals | P1 | 4 | ~20 | 📋 PLANNED |
| P1-B: Ch07 Effects & Selection | P1 | 3 | ~12 | 📋 PLANNED |
| P2-A: Ch11 Production & Building | P2 | 3 | ~15 | 📋 PLANNED |
| P2-B: Ch08 Air & Turreted | P2 | 2 | ~10 | 📋 PLANNED |
| P3-A: Ch05 UI Core | P3 | 2 | ~6 | 📋 PLANNED |
| P3-B: Ch09 Movement | P3 | 2 | ~8 | 📋 PLANNED |
| P3-C: Ch16 Widget Primitives | P3 | 3 | ~6 | 📋 PLANNED |
| P3-D: Ch03/Ch20 Misc | P3 | 1 | ~4 | 📋 PLANNED |

---

## 4. Core Tasks (TODO)

### 4.1 Phase P0-A: Ch08 Projectile Visuals

**Status**: ✅ COMPLETE (7/7, 2026-06-19) — 21 files, 14 review rounds, 0 TS errors
**Priority**: P0 (Critical)
**Complexity**: High (Missile, NukeLaunch complex multi-stage trajectories)
**Blocked by**: Ch02 (Renderer), Ch03 (Actor/World), Ch08 source migration (COMPLETE)
**Blocks**: Phase P0-B (explosion effects triggered by projectile impact) — NOW UNBLOCKED

**Description**: The projectiles system is the most visually complex subsystem in Ch08 and has the largest test gap (only 1 existing test page: `projectile-lifecycle`). Each projectile type has a unique visual signature — Missile has arcing paths with contrails, LaserZap renders instant beams with player-color glow, NukeLaunch has a multi-stage ascent-descent-detonation sequence. These visual behaviors directly affect gameplay readability and player feedback. Each test page must validate the 3D rendering, timing, and coordinate-space correctness against OpenRA's 2D reference behavior.

**Paradigm Shifts**:
- OpenRA 2D sprite-based projectiles → Babylon.js 3D `Mesh` / `LinesMesh` / `SpriteEffect` rendering
- OpenRA cell-grid collision detection → 3D `scene.pickWithRay()` raycast collision
- OpenRA pixel-based projectile position → 3D `Vector3` world-space position via `CoordinateTransformer`
- OpenRA WAngle-based trajectory angles → 3D quaternion rotation on XZ plane

#### 4.1.1 Missile Trajectory

- [ ] **TODO-AT-P0A.1** `src/__e2e__/manual/ch08-weapons-combat/missile-trajectory/` (3 files: index.html, main.ts, README.md) — Missile flight path and homing behavior:
  - Render missile projectile with visible contrail/trail from source to current position
  - Demonstrate 3 flight modes: straight (no homing), homing (tracking moving target), arcing (parabolic lob)
  - Show `horizontalRateOfTurn` and `verticalRateOfTurn` angle correction per tick
  - Visualize predicted impact point and terminal guidance phase
  - **`__testHarness` API**: `fireStraight(targetPos)`, `fireHoming(targetActor)`, `fireArcing(targetPos)`, `getMissilePosition()`, `getMissileAngle()`, `getTrailLength()`
  - **Expectations**: (1) Straight missile reaches target within ±2 world units of predicted position. (2) Homing missile corrects angle by ≤ turn rate per tick. (3) Arcing missile apex height matches configured `loft` parameter within 5%. (4) Contrails fade over time (alpha drops by 10% per second). (5) Missile self-disposes within 3 ticks of impact.

#### 4.1.2 Laser Zap Beam

- [ ] **TODO-AT-P0A.2** `src/__e2e__/manual/ch08-weapons-combat/laser-zap-beam/` — Instant laser beam with glow effect:
  - Render `LinesMesh` laser beam from source to target on tick 0
  - Player color tinting (verify against `PlayerColorRemap` palette)
  - Beam persistence: visual remains for `duration` ticks after damage applied
  - Beam width: respects `width: WDist` config (measure pixel width at camera)
  - `tracksTarget`: beam endpoint follows moving target position
  - **`__testHarness` API**: `fireLaser(from, to, playerColor)`, `getBeamWidth()`, `getBeamColor()`, `isBeamVisible()`
  - **Expectations**: (1) Beam appears within 1 frame of fire command. (2) Beam color matches player color within 5% RGB tolerance. (3) Beam visible for exactly `duration` ticks (±1 tick). (4) Beam width at 10 world units distance matches configured WDist within 3px. (5) Tracking beam endpoint moves by same delta as target per tick.

#### 4.1.3 Nuke Launch

- [ ] **TODO-AT-P0A.3** `src/__e2e__/manual/ch08-weapons-combat/nuke-launch/` — Nuclear missile ascent and detonation:
  - Multi-stage flight: vertical ascent trail (phase 1), parabolic arc descent (phase 2), altitude detonation (phase 3)
  - Ascending trail: `LinesMesh` with emissive glow, expanding width
  - Detonation flash: full-screen white flash via post-process or overlay, duration-based decay
  - Mushroom cloud: placeholder or `SpriteEffect` at detonation altitude
  - **`__testHarness` API**: `launchNuke(targetPos)`, `getMissileAltitude()`, `getFlightPhase()`, `getFlashIntensity()`
  - **Expectations**: (1) Ascent velocity matches configured `velocity: WVec` within 5%. (2) Detonation altitude equals `detonationAltitude: WDist` within 1 world unit. (3) Flash peaks at 100% for first 3 ticks then linear decay to 0% over 20 ticks. (4) Missile visible for all 3 flight phases without pop-in. (5) Total flight time from launch to detonation matches C# reference within 5 ticks.

#### 4.1.4 Area Beam (Tesla)

- [ ] **TODO-AT-P0A.4** `src/__e2e__/manual/ch08-weapons-combat/area-beam-tesla/` — Cylinder beam with width and fade:
  - Render cylinder/beam shape from source to target with configurable `width`
  - Beam fade-in on creation (opacity 0→1 over `fadeInTicks`)
  - Beam fade-out before disposal (opacity 1→0 over `fadeOutTicks`)
  - Damage applied to all actors within beam cylinder radius
  - **`__testHarness` API**: `fireBeam(from, to, width)`, `getBeamOpacity()`, `getActorsInBeam()`
  - **Expectations**: (1) Beam opacity reaches 1.0 within `fadeInTicks` ±1 tick. (2) Beam width at midpoint matches configured WDist within 5%. (3) Actor at beam edge (within width/2) receives damage. (4) Actor outside beam edge (beyond width/2) receives no damage. (5) Beam fully disposed after `fadeOutTicks` completion.

#### 4.1.5 Railgun Trail

- [ ] **TODO-AT-P0A.5** `src/__e2e__/manual/ch08-weapons-combat/railgun-trail/` — High-velocity projectile with beam trail:
  - Instant bullet travel (or near-instant high speed)
  - Beam trail rendered as `LinesMesh` from source to current position, updated each frame
  - Trail color and width configurable
  - Impact position triggers warhead effects
  - **`__testHarness` API**: `fireRailgun(from, to)`, `getProjectilePosition()`, `getTrailColor()`, `getTrailWidth()`
  - **Expectations**: (1) Projectile reaches target within 1 tick. (2) Trail color matches config RGB within 5%. (3) Trail is visible from fire position to end position. (4) Trail disposed within 5 ticks after impact. (5) Impact warhead applied at exact target position.

#### 4.1.6 Gravity Bomb

- [ ] **TODO-AT-P0A.6** `src/__e2e__/manual/ch08-weapons-combat/gravity-bomb/` — Ballistic gravity-affected projectile:
  - Simple ballistic arc: horizontal velocity + downward gravity acceleration
  - Euler integration per tick for position update
  - Ground collision detection at terrain height
  - `Mesh` (sphere or bomb shape) with visible trajectory
  - **`__testHarness` API**: `dropBomb(from, velocity)`, `getBombPosition()`, `getBombVelocity()`, `hasDetonated()`
  - **Expectations**: (1) Bomb horizontal velocity remains constant (no drag). (2) Bomb vertical position follows `y(t) = y0 + vy*t + 0.5*g*t²` within 1 world unit. (3) Bomb detonates when Y ≤ terrain height. (4) Impact position XZ matches predicted landing point within 2 world units.

#### 4.1.7 Instant Hit (Hitscan)

- [ ] **TODO-AT-P0A.7** `src/__e2e__/manual/ch08-weapons-combat/instant-hit-hitscan/` — Zero-travel-time hitscan projectile:
  - Warheads applied immediately at target on tick 0 (no visual projectile)
  - Line-of-sight check: `Ray` from source to target, blocked by `BlockedByActor` actors
  - Effect handled by warhead's `CreateEffect` at impact point
  - **`__testHarness` API**: `fireHitscan(from, target)`, `isTargetHit()`, `getBlockingActor()`
  - **Expectations**: (1) Target receives damage on tick 0 (same tick as fire command). (2) Blocking actor between source and target prevents hit. (3) No visual projectile mesh created. (4) Impact effect spawned at target position. (5) Hitscan self-disposes on tick 0.

---

### 4.2 Phase P0-B: Ch08 Combat VFX & Warhead Effects

**Status**: 🔧 IN PROGRESS (0/4 completed)
**Priority**: P0 (Critical)
**Complexity**: High (explosion effects), Medium (muzzle, animation, gallery)
**Blocked by**: Phase P0-A (projectile impact triggers warhead effects) — ✅ RESOLVED, Ch07 Phase E (SpriteEffect, FloatingSpriteEmitter) — ✅ COMPLETE
**Blocks**: None (terminal visual layer)

**Description**: Combat VFX — explosions, muzzle flashes, attack animations, and warhead impact effects — are the most player-facing visual feedback in an RTS. These effects must be visually punchy, correctly positioned in 3D space, and synchronized with combat logic timing. OpenRA uses 2D sprite sequences with palette-based color cycling; Babylon.js equivalents use `SpriteEffect` billboards, `ParticleSystem` for debris, and `ShaderMaterial` effects for screen flash and shake.

#### 4.2.1 Explosion Effects

- [ ] **TODO-AT-P0B.1** `src/__e2e__/manual/ch08-weapons-combat/explosion-effects/` — Explosion sprite sequence and particle system:
  - Large explosion: multi-frame `SpriteEffect` billboard at impact position, cameras-facing
  - Small explosion: scaled-down variant for light weapons
  - Debris particles: `ParticleSystem` emitting 10-20 debris chunks with random velocity
  - Ground scorch: terrain splatmap update at impact cells (via `LeaveSmudgeWarhead`)
  - Water explosion variant: alternate sprite + splash particles
  - **`__testHarness` API**: `triggerExplosion(pos, size)`, `triggerWaterExplosion(pos)`, `getParticleCount()`, `getScorchCells()`, `getExplosionProgress()`
  - **Expectations**: (1) Explosion sprite cycle completes within configured frame count ±2 frames. (2) Billboard always faces camera (angle deviation < 5°). (3) Debris particles spawn within 1 tick of detonation. (4) Scorch appears on correct map cells within 1 tick. (5) Water variant uses different sprite sequence than land variant.

#### 4.2.2 Muzzle Overlay

- [ ] **TODO-AT-P0B.2** `src/__e2e__/manual/ch08-weapons-combat/muzzle-overlay/` — Muzzle flash at weapon hardpoint:
  - Muzzle flash sprite appears at weapon barrel position on fire
  - Sprite faces camera (billboard)
  - Duration: visible for `duration` ticks then auto-hides
  - Multiple muzzle positions for multi-barrel weapons
  - **`__testHarness` API**: `fireWeapon(actor, weaponSlot)`, `getMuzzlePosition(slot)`, `isMuzzleVisible(slot)`, `getMuzzleDuration()`
  - **Expectations**: (1) Muzzle flash appears at hardpoint world position within 0.1 world units. (2) Flash visible for exactly `duration` ticks. (3) Multi-barrel weapons show flash at correct alternating positions. (4) Billboard always faces camera. (5) Flash disposed cleanly (no residual sprite).

#### 4.2.3 Attack Animation

- [ ] **TODO-AT-P0B.3** `src/__e2e__/manual/ch08-weapons-combat/attack-animation/` — Attack sprite sequence and overlay:
  - `WithAttackAnimation`: switches actor body sprite to attack sequence on fire
  - `WithAttackOverlay`: additional overlay sprite (e.g., recoil effect, barrel smoke)
  - Sequence timing: attack anim plays once per burst, returns to idle after
  - **`__testHarness` API**: `triggerAttack(actor)`, `getCurrentSequence()`, `getOverlaySequence()`, `getSequenceProgress()`
  - **Expectations**: (1) Attack animation starts within 1 tick of fire command. (2) Sequence completes full cycle before returning to idle. (3) Overlay sprite matches configured sequence name. (4) Animation frame rate matches config (default 25fps). (5) Multiple burst shots each trigger fresh animation cycle.

#### 4.2.4 Warhead Impact Gallery

- [ ] **TODO-AT-P0B.4** `src/__e2e__/manual/ch08-weapons-combat/warhead-impact-gallery/` — Multi-warhead effect showcase:
  - Spread damage: visualize AOE circle at impact point, distance-based damage tinting
  - Fire cluster: show N sub-explosion positions within spread radius
  - Screen flash: `FlashEffectWarhead` full-screen white overlay with exponential decay
  - Camera shake: `ShakeScreenWarhead` camera position oscillation with amplitude decay
  - **`__testHarness` API**: `triggerWarhead(type, pos, config)`, `getAOERadius()`, `getFlashIntensity()`, `getCameraShakeAmplitude()`, `getSubExplosionPositions()`
  - **Expectations**: (1) AOE radius circle matches `spread: WDist` within 0.5 world units. (2) Sub-explosions (cluster) all fall within spread radius. (3) Screen flash peaks at 100% white then decays to 0% within configured duration. (4) Camera shake amplitude halves every N ticks. (5) Multiple simultaneous warheads stack effects additively.

---

### 4.3 Phase P1-A: Ch21 Editor Visuals

**Status**: 📋 PLANNED (0/4 completed)
**Priority**: P1 (Major)
**Complexity**: High (actor placement), Medium (cursor, UI shell), Low (resource paint)
**Blocked by**: Ch03 (Actor system), Ch04 (Map/Terrain), Ch21 source migration (COMPLETE)
**Blocks**: None

**Description**: The editor is the primary content creation tool and has zero visual acceptance tests. Editor visual tests validate actor placement preview (ghost rendering, grid snapping), cursor/brush overlays (tile selection, path drawing), resource painting (density visualization on terrain), and the overall editor UI shell layout.

#### 4.3.1 Actor Placement

- [ ] **TODO-AT-P1A.1** `src/__e2e__/manual/ch21-editor/actor-placement/` — Actor drag, placement preview, ghost rendering:
  - Actor list panel with search/filter
  - Drag actor from list to map: ghost preview at cursor position
  - Valid placement: green highlight; invalid (blocked cell, out of bounds): red highlight
  - Grid snap: actor snaps to nearest cell center
  - Multi-select: rubber-band select placed actors, drag to move
  - **`__testHarness` API**: `selectActor(type)`, `moveCursorToCell(cell)`, `placeActor()`, `getGhostColor()`, `getPlacedActors()`, `getSelectionBounds()`
  - **Expectations**: (1) Ghost preview follows cursor within 1 frame (<33ms). (2) Valid cell shows green tint (rgba match within 5%). (3) Invalid cell shows red tint. (4) Placed actor position snaps to cell center (±0.1 world units). (5) Rubber-band selection box renders with dashed line style.

#### 4.3.2 Cursor & Brush

- [ ] **TODO-AT-P1A.2** `src/__e2e__/manual/ch21-editor/cursor-brush/` — Brush size overlay and tile selection:
  - Brush size overlay: semi-transparent highlight on cells within brush radius
  - Brush resize: +/- keys or slider change brush diameter (1x1, 3x3, 5x5, etc.)
  - Tile selection palette: click tile type, brush paints that tile
  - Path draw (TilingPathTool): click start and end cells, path preview rendered
  - **`__testHarness` API**: `setBrushSize(n)`, `selectTileType(id)`, `setPathStart(cell)`, `setPathEnd(cell)`, `getHighlightedCells()`, `getPathCells()`
  - **Expectations**: (1) Brush highlight covers exactly N×N cells for brush size N. (2) Highlight color matches editor theme (blue-tinted, 40% opacity). (3) Path preview connects start and end cells with shortest HPA* path. (4) Tile type change reflects immediately on next brush stroke.

#### 4.3.3 Resource Paint

- [ ] **TODO-AT-P1A.3** `src/__e2e__/manual/ch21-editor/resource-paint/` — Resource painting on terrain:
  - Select resource type (Ore, Gems, Tiberium)
  - Brush paints resource density on terrain cells
  - Density visualization: cell color intensity proportional to resource amount (0-100%)
  - Resource overlay toggle: show/hide resource layer
  - **`__testHarness` API**: `selectResource(type)`, `paintCell(cell, density)`, `getCellDensity(cell)`, `getResourceColor(cell)`
  - **Expectations**: (1) Cell color intensity linearly maps to resource density (0%=base terrain, 100%=full resource color). (2) Ore renders in orange-brown (#C8641E at 100%). (3) Gems render in blue-white (#6496FF at 100%). (4) Multiple cells painted in one brush stroke all receive correct density.

#### 4.3.4 Editor UI Shell

- [ ] **TODO-AT-P1A.4** `src/__e2e__/manual/ch21-editor/editor-ui-shell/` — Overall editor layout:
  - Toolbar: top bar with tool icons (select, paint, fill, erase)
  - Minimap: bottom-right corner with map overview + viewport rectangle
  - Property panel: left sidebar showing selected actor/tile properties
  - Menu bar: File (New, Open, Save), Edit, View menus
  - **`__testHarness` API**: `getToolbarTools()`, `getMinimapViewport()`, `getPropertyPanelFields()`, `clickMenu(menu, item)`
  - **Expectations**: (1) All toolbar tools present and clickable. (2) Minimap updates viewport rectangle on camera move. (3) Property panel shows relevant fields for selected object. (4) Menu items trigger correct actions. (5) Layout does not overflow at 1280×720 minimum viewport.

---

### 4.4 Phase P1-B: Ch07 Effects, Selection & Render Traits

**Status**: 📋 PLANNED (0/3 completed)
**Priority**: P1 (Major)
**Complexity**: High (particle effects), Medium (selection), Low (idle overlay)
**Blocked by**: Ch02 (Renderer), Ch03 (Actor), Ch07 source migration (COMPLETE)
**Blocks**: None

#### 4.4.1 Sprite Particle Effects

- [ ] **TODO-AT-P1B.1** `src/__e2e__/manual/ch07-input-camera/sprite-particle-effects/` — Billboard particle emitter:
  - `SpriteEffect`: single billboard sprite with animation sequence
  - `FloatingSpriteEmitter`: GPU particle emitter spawning multiple billboard particles
  - Emitter parameters: spawn rate, lifetime, initial velocity, gravity, size, color
  - Camera-facing: all particles billboard toward camera
  - **`__testHarness` API**: `spawnEffect(type, pos, config)`, `getParticleCount()`, `getParticlePositions()`, `getParticleColors()`, `setEmitterRate(rate)`
  - **Expectations**: (1) Particles spawn at configured rate (±1 particle per second). (2) Each particle lives for configured lifetime ±0.1s. (3) All particles face camera (normal.dot(cameraForward) > 0.99). (4) Particle color matches config within 5% RGB. (5) Particles disposed after lifetime expires (no leak check: count returns to 0).

#### 4.4.2 Selection Visual

- [ ] **TODO-AT-P1B.2** `src/__e2e__/manual/ch07-input-camera/selection-visual/` — Selection box and highlight:
  - Single-click select: highlight ring/outline around selected actor
  - Drag-select: rubber-band box from drag start to current mouse position
  - Multi-select: shift+click to add to selection, shift+drag to add group
  - Double-click: select all same-type actors on screen
  - Selection health bars: show health bar above selected actors
  - **`__testHarness` API**: `clickActor(id)`, `dragSelect(start, end)`, `getSelectedActors()`, `getSelectionBoxBounds()`, `getHealthBarVisibility()`
  - **Expectations**: (1) Selection highlight appears within 1 frame of click. (2) Rubber-band box renders as dashed white rectangle (#FFFFFF, 2px dash). (3) Multi-select with shift adds to existing selection (does not replace). (4) Health bar shows correct percentage (height proportional to HP%). (5) Deselect with empty click clears all selections.

#### 4.4.3 Idle Overlay

- [ ] **TODO-AT-P1B.3** `src/__e2e__/manual/ch07-input-camera/idle-overlay/` — Idle animation overlay:
  - `WithIdleOverlay`: secondary sprite animation that plays periodically while actor is idle
  - Overlay positioning: offset from actor body sprite by configured pixel offset
  - Play/pause cycle: overlay plays for N ticks, pauses for M ticks, repeats
  - **`__testHarness` API**: `setActorIdle(actor)`, `getOverlayVisibility()`, `getOverlaySequence()`, `getOverlayOffset()`
  - **Expectations**: (1) Overlay visible during play phase, hidden during pause phase. (2) Play phase duration matches configured ticks (±2 ticks). (3) Pause phase duration matches configured ticks (±2 ticks). (4) Overlay position offset from body matches config within 2px. (5) Overlay stops immediately when actor becomes non-idle.

---

### 4.5 Phase P2-A: Ch11 Production & Building Placement

**Status**: 📋 PLANNED (0/3 completed)
**Priority**: P2 (Moderate)
**Complexity**: High (building placement), Medium (rally, production queue)
**Blocked by**: Ch03 (Actor), Ch04 (Map), Ch05 (UI Widgets), Ch11 source migration (COMPLETE)
**Blocks**: None

#### 4.5.1 Building Placement

- [ ] **TODO-AT-P2A.1** `src/__e2e__/manual/ch11-production/building-placement/` — Ghost preview and grid validation:
  - Building ghost: semi-transparent preview of building at cursor position
  - Valid placement: cells highlighted green, placement allowed
  - Invalid placement: cells highlighted red (blocked by terrain, other buildings, shroud)
  - Grid snap: building footprint snaps to cell grid
  - Rotation: rotate building orientation with hotkey (if multi-variant)
  - **`__testHarness` API**: `selectBuilding(type)`, `moveCursorToCell(cell)`, `getFootprintCells()`, `canPlace()`, `getCellColor(cell)`, `rotateBuilding()`
  - **Expectations**: (1) Ghost preview renders with 50% opacity. (2) Footprint cells match building `Footprint` definition exactly. (3) Valid cells colored green (#00FF00 at 40% opacity). (4) Invalid cells colored red (#FF0000 at 40% opacity). (5) Rotation cycles through all configured variants.

#### 4.5.2 Rally Point

- [ ] **TODO-AT-P2A.2** `src/__e2e__/manual/ch11-production/rally-point/` — Rally flag and line rendering:
  - Rally point flag: small animated flag sprite at rally target cell
  - Line from building exit to rally point (dashed line)
  - Multi-rally: set different rally points per production queue slot
  - Move rally point: click new location, flag moves with animation
  - **`__testHarness` API**: `setRallyPoint(building, cell)`, `getRallyPosition()`, `getRallyLine()`, `getRallyFlags()`, `clearRallyPoint(building)`
  - **Expectations**: (1) Rally flag visible at target cell center (±0.1 world units). (2) Dashed line connects building exit to rally flag. (3) Flag animates (bob/wave) at ≥15fps. (4) Multi-rally shows separate flag per slot with slot number. (5) Line updates within 1 frame of rally point change.

#### 4.5.3 Production Queue

- [ ] **TODO-AT-P2A.3** `src/__e2e__/manual/ch11-production/production-queue/` — Queue UI and progress display:
  - Queue list: icons of items in production queue, ordered by build sequence
  - Progress bar: fill animation for current item (0%→100% over build time)
  - Countdown timer: numeric seconds remaining on current item
  - Ready indicator: pulsing glow when item complete and awaiting placement
  - Cancel button: X button on each queue item
  - **`__testHarness` API**: `enqueueItem(type)`, `getQueueItems()`, `getProgressPercent()`, `getTimeRemaining()`, `isReadyPulsing()`, `cancelItem(index)`
  - **Expectations**: (1) Progress bar fills linearly from 0% to 100% over build time (±1%). (2) Countdown displays correct seconds remaining (±0.5s). (3) Ready item pulses with glow animation (brightness oscillates every 1s). (4) Cancel removes item from queue and refunds cost. (5) Queue reorders correctly when item at front is cancelled.

---

### 4.6 Phase P2-B: Ch08 Air Combat & Turreted

**Status**: 📋 PLANNED (0/2 completed)
**Priority**: P2 (Moderate)
**Complexity**: High (bomber run), Medium (turret rotation)
**Blocked by**: Phase P0-A (projectile system), Ch08 Phase E source migration (COMPLETE)
**Blocks**: None

#### 4.6.1 Bomber Run

- [ ] **TODO-AT-P2B.1** `src/__e2e__/manual/ch08-weapons-combat/bomber-run/` — Aircraft bombing run visuals:
  - Aircraft flight path: straight line pass over target area
  - Bomb drop sequence: bombs release at configured interval along flight path
  - Bomb fall: GravityBomb projectiles dropping with ballistic arc
  - Return to base: aircraft exits map edge after bomb run complete
  - **`__testHarness` API**: `startBomberRun(aircraft, targetArea)`, `getBombCount()`, `getBombPositions()`, `getAircraftPosition()`, `isRunComplete()`
  - **Expectations**: (1) Aircraft flies straight line at constant altitude. (2) Bombs release at configured interval (±1 tick). (3) Each bomb follows ballistic trajectory (see P0A.6 criteria). (4) Aircraft exits map after last bomb release + configured delay. (5) No bomb-bomb collisions during drop sequence.

#### 4.6.2 Turret Rotation

- [ ] **TODO-AT-P2B.2** `src/__e2e__/manual/ch08-weapons-combat/turret-rotation/` — Turret tracking and turn rate:
  - Turret barrel rotation toward target: smooth interpolation
  - Turn rate limit: rotation speed capped at `turnRate: WAngle` per tick
  - Target tracking: turret follows moving target with angular lag
  - Multiple turrets: independent rotation per turret definition
  - **`__testHarness` API**: `setTarget(actor, target)`, `getTurretAngle(turretIndex)`, `getTurretTurnRate()`, `isTurretFacingTarget()`
  - **Expectations**: (1) Turret rotates at exactly `turnRate` WAngle/tick when catching up to target. (2) Turret reaches facing within ±1° of target bearing. (3) Quaternion interpolation uses shortest path (no 360° back-flips). (4) Multiple turrets rotate independently. (5) Turret stops rotating when facing target (no oscillation).

---

### 4.7 Phase P3-A: Ch05 UI Core Layout

**Status**: 📋 PLANNED (0/2 completed)
**Priority**: P3 (Minor)
**Complexity**: Medium (widget layout), Low (chrome theme)
**Blocked by**: Ch05 source migration (COMPLETE)
**Blocks**: None

#### 4.7.1 Widget Layout

- [ ] **TODO-AT-P3A.1** `src/__e2e__/manual/ch05-ui/widget-layout/` — Widget nesting and bounds:
  - Parent-child widget hierarchy: nested widgets with margin/padding
  - Bounds calculation: child widget bounds clipped to parent bounds
  - Z-ordering: widgets rendered in correct depth order
  - Alignment: top-left, center, bottom-right child widget alignment
  - **`__testHarness` API**: `createWidgetTree(config)`, `getWidgetBounds(id)`, `getWidgetZOrder(id)`, `getComputedPadding(id)`
  - **Expectations**: (1) Child widget bounds do not exceed parent bounds. (2) Padding reduces content area by correct pixel values. (3) Z-order respects Widget.zIndex property (higher renders on top). (4) Center-aligned widget centered in parent within ±1px. (5) Widget tree of depth 5 renders all levels without clipping artifacts.

#### 4.7.2 Chrome Theme

- [ ] **TODO-AT-P3A.2** `src/__e2e__/manual/ch05-ui/chrome-theme/` — ChromeProvider theme rendering:
  - Panel background: themed panel with border, header, body
  - Button chrome: themed button with hover/press/disabled states
  - Scrollbar chrome: themed scrollbar track, thumb, arrows
  - Color scheme swap: change theme (RA vs CNC vs D2K) and verify re-render
  - **`__testHarness` API**: `loadTheme(name)`, `getPanelStyle()`, `getButtonStyle(state)`, `getScrollbarStyle()`
  - **Expectations**: (1) Panel border width matches ChromeMetrics value. (2) Button background changes on hover (lighter by 20%), press (darker by 20%), disabled (grayed out). (3) Scrollbar thumb proportional to content/viewport ratio. (4) Theme switch fully re-renders all chrome within 1 frame. (5) Default theme (RA) panel background matches #2B2B2B within 5%.

---

### 4.8 Phase P3-B: Ch09 Movement Visuals

**Status**: 📋 PLANNED (0/2 completed)
**Priority**: P3 (Minor)
**Complexity**: Medium (path follow), Low (turn animation)
**Blocked by**: Ch04 (Pathfinding), Ch09 source migration (COMPLETE)
**Blocks**: None

#### 4.8.1 Path Follow Visual

- [ ] **TODO-AT-P3B.1** `src/__e2e__/manual/ch09-movement/path-follow-visual/` — Unit path following:
  - Unit moves along waypoint path from HPA* pathfinder
  - Smooth movement between waypoints (no teleport)
  - Speed respects `speed: WDist` per tick
  - Visualize path: render path line from unit to destination (debug overlay)
  - **`__testHarness` API**: `moveUnit(unit, destination)`, `getUnitPosition()`, `getUnitSpeed()`, `getPathWaypoints()`, `isAtDestination()`
  - **Expectations**: (1) Unit moves at configured speed (WDist/tick) within 5%. (2) Unit position changes each tick (no stalls on clear path). (3) Unit reaches final destination within 2 world units. (4) Path visualization shows all waypoints. (5) Unit slow-down near destination (deceleration phase).

#### 4.8.2 Turn Animation

- [ ] **TODO-AT-P3B.2** `src/__e2e__/manual/ch09-movement/turn-animation/` — Unit turning and facing:
  - Turn animation: sprite sequence for rotation (avoid instant facing change)
  - Turn rate cap: rotation limited to configured degrees per tick
  - Facing direction: unit faces movement direction after turn complete
  - **`__testHarness` API**: `moveUnitTo(unit, direction)`, `getUnitFacing()`, `getTurnRate()`, `getTurnAnimationFrame()`
  - **Expectations**: (1) Turn animation plays during rotation (not skipped). (2) Turn rate does not exceed configured WAngle/tick. (3) Final facing direction matches movement direction within ±1°. (4) Turn animation frame count proportional to angle change. (5) No turn animation for angle change < 5°.

---

### 4.9 Phase P3-C: Ch16 Widget Primitives

**Status**: 📋 PLANNED (0/3 completed)
**Priority**: P3 (Minor)
**Complexity**: Low (all 3)
**Blocked by**: Ch05 (Widget core), Ch16 source migration (COMPLETE)
**Blocks**: None

#### 4.9.1 Button States

- [ ] **TODO-AT-P3C.1** `src/__e2e__/manual/ch16-widgets/button-states/` — Button visual states:
  - Default: base background and text color
  - Hover: background lightens, optional border highlight
  - Press: background darkens, slight inset shadow
  - Disabled: grayed out, no interaction
  - **`__testHarness` API**: `setButtonState(id, state)`, `getButtonBackground(id)`, `getButtonTextColor(id)`, `isButtonClickable(id)`
  - **Expectations**: (1) Hover background lighter than default by 20% (±5%). (2) Press background darker than default by 20% (±5%). (3) Disabled state ignores click events. (4) State transition completes within 150ms (CSS transition). (5) Button text remains vertically centered in all states.

#### 4.9.2 Slider Control

- [ ] **TODO-AT-P3C.2** `src/__e2e__/manual/ch16-widgets/slider-control/` — Slider thumb and track:
  - Track: horizontal bar with filled portion up to thumb position
  - Thumb: draggable handle, snaps to step values
  - Value display: numeric label showing current value
  - **`__testHarness` API**: `setSliderValue(id, value)`, `getSliderValue(id)`, `getThumbPosition(id)`, `getTrackFillWidth(id)`
  - **Expectations**: (1) Thumb position linearly maps to value (min→max). (2) Track fill width matches thumb position within ±2px. (3) Thumb snaps to nearest step when released. (4) Value display updates within 1 frame of thumb move. (5) Thumb cannot be dragged beyond track endpoints.

#### 4.9.3 Dropdown Menu

- [ ] **TODO-AT-P3C.3** `src/__e2e__/manual/ch16-widgets/dropdown-menu/` — Dropdown open/close and selection:
  - Closed state: shows selected item text with dropdown arrow
  - Open animation: menu expands downward with slide animation
  - Item highlight: hovered item gets background highlight
  - Selection: click item closes menu and updates displayed text
  - Scroll: scrollbar appears when items exceed max visible height
  - **`__testHarness` API**: `openDropdown(id)`, `selectItem(id, index)`, `getSelectedItem(id)`, `getMenuHeight(id)`, `isMenuOpen(id)`
  - **Expectations**: (1) Menu open animation completes within 200ms. (2) Selected item text updates within 1 frame of click. (3) Hovered item shows highlight color (different from background). (4) Menu closes on outside click. (5) Scrollbar appears when item count > visible limit.

---

### 4.10 Phase P3-D: Ch03 Actor Visuals & Ch20 Scripting Visuals

**Status**: 📋 PLANNED (0/1 completed)
**Priority**: P3 (Minor)
**Complexity**: Medium
**Blocked by**: Ch03 (Actor), Ch20 (Scripting) source migration (COMPLETE)
**Blocks**: None

#### 4.10.1 Script-Driven Effects

- [ ] **TODO-AT-P3D.1** `src/__e2e__/manual/ch20-scripting/script-driven-effects/` — Lua script-triggered visual effects:
  - Camera movement: script commands camera pan to position, zoom level
  - Actor animation: script triggers specific animation sequences on actors
  - Dialogue/text: floating text or dialogue panel triggered by script
  - Timed sequence: multiple script commands executed in sequence with delays
  - **`__testHarness` API**: `runScript(code)`, `getCameraPosition()`, `getActorAnimation(actor)`, `getDialogueText()`, `getScriptStatus()`
  - **Expectations**: (1) Script camera.move() reaches target position within 1 world unit. (2) Script actor.animate() plays correct sequence name. (3) Dialogue text appears within 1 tick of script trigger. (4) Sequential commands execute in order with correct delays (±1 tick). (5) Script errors reported on Lua VM console without crashing renderer.

---

## 5. Dependency Graph

```
P0-A (Ch08 Projectiles)
  ├──► P0-B (Ch08 Combat VFX) — projectiles trigger warhead effects
  ├──► P2-B (Ch08 Air) — bomber drops GravityBomb projectiles
  └──► P2-B (Ch08 Turreted) — turrets fire projectiles

P0-B (Ch08 Combat VFX)
  └── (terminal — no downstream phases)

P1-A (Ch21 Editor)
  └── (independent — can run in parallel with P0/P1)

P1-B (Ch07 Effects)
  └── (independent — but SpriteEffect used by P0-B explosion effects)

P2-A (Ch11 Production)
  └── (independent — can run in parallel with P2-B)

P2-B (Ch08 Air & Turreted)
  └── (depends on P0-A for projectile visuals)

P3-A, P3-B, P3-C, P3-D
  └── (all independent — can run in parallel with any phase)
```

### Execution Order Recommendation

```
Phase 1 (parallel): P0-A + P1-A + P1-B
Phase 2 (parallel): P0-B + P2-A + P3-*
Phase 3 (parallel): P2-B

P3 phases can be inserted anywhere as filler work.
```

---

## 6. Verification and Test Strategy

### 6.1 Unit Test Relationship

Acceptance test pages complement unit tests — they do NOT replace them. The following division applies:

| Aspect | Unit Tests | Acceptance Test Pages |
|--------|:---:|:---:|
| Logic correctness (damage calculation, timing) | ✅ Primary | ❌ |
| Rendering correctness (color, position, sprite) | ❌ | ✅ Primary |
| Visual timing (animation frames, fade) | ❌ | ✅ Primary |
| Interaction feel (click response, drag) | ❌ | ✅ Primary |
| 3D spatial behavior (billboarding, trajectory) | ❌ | ✅ Primary |

### 6.2 Per-Page Deliverables

Every test page MUST contain:

- [ ] `index.html` — Vite entry point with layout template (header, sandbox, controls, info-bar)
- [ ] `main.ts` — Babylon.js scene setup + `window.__testHarness` API + interaction controls
- [ ] `README.md` — ≥3 quantifiable expectations + step-by-step verification procedure + boundary/edge case tests
- [ ] `npx tsc --noEmit` passing (must compile cleanly)
- [ ] Accessible at `http://localhost:5173/test/{chapter}/{test-case-id}/`
- [ ] Environment info bar displays UA, viewport, engine, FPS, timestamp

### 6.3 Playwright Script Conventions

Each test page gets a `script/` subdirectory with Playwright test files (written by `acceptance-test-runner` via Kimi MCP):

```
src/__e2e__/manual/ch08-weapons-combat/missile-trajectory/
├── index.html
├── main.ts
├── README.md
└── script/
    ├── test-1-straight-flight.spec.ts
    ├── test-2-homing.spec.ts
    └── test-3-arcing.spec.ts
```

### 6.4 Verification Checklist Per Phase

| Phase | Verify |
|:---|:---|
| P0-A | All 7 projectile types render correctly; trajectory timing matches C# reference |
| P0-B | Explosion sprite cycles, muzzle overlays, attack animations, warhead gallery all functional |
| P1-A | Editor actor placement, brush, resource paint, and UI shell visually correct |
| P1-B | Particle effects, selection visuals, idle overlays all functional |
| P2-A | Building ghost preview, rally point lines, production queue UI correct |
| P2-B | Bomber run trajectory, turret rotation tracking correct |
| P3-A | Widget layout nesting, chrome theme rendering correct |
| P3-B | Path following, turn animation correct |
| P3-C | Button, slider, dropdown widget states correct |
| P3-D | Script-driven camera, animation, dialogue correct |

---

## 7. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Headless rendering limitations** | MEDIUM | Playwright headless mode cannot verify FPS, pixel-accurate color, or WebGL precision | Run critical pages in headed mode for final pass; document headless deviation tolerance in README.md |
| **Babylon.js mock complexity** | MEDIUM | Test pages need real Babylon.js; unit tests need mocks. Double maintenance. | Use real Babylon.js in test pages (dev server provides full WebGL context). Keep test pages simple — one Babylon.js scene per page. |
| **Test page rot** | MEDIUM | Source code changes break test pages, pages not updated | Each README.md includes last-verified date and source file references. `acceptance-test-runner` re-runs periodically. |
| **31 new test pages — resource estimate** | HIGH | ~136 estimated hours total. With parallel development by multiple agents, ~2-3 weeks elapsed. | Prioritize P0 (11 pages) first — these provide the most value. P3 pages can be deferred if timeline is tight. |
| **Ch08 inter-page dependencies** | MEDIUM | Projectile pages (P0-A) need working warhead effects (P0-B) for full impact verification | Each page testable in isolation via `__testHarness` API. P0-A pages simulate impact without real warhead; P0-B pages verify warhead effects independently. |
| **Editor page complexity (P1-A)** | HIGH | Editor requires a working map, actor list, and tool system — may need significant bootstrap code | Build a minimal editor harness that loads a test map + test actor set. Scope to visual layout only; do not re-implement editor logic. |
| **Coordinate system mismatch** | LOW | Test expectations using wrong coordinate convention (e.g., WAngle 0=East assumption) | All test pages referencing angles MUST document the OpenRA convention (WAngle 0=North, counter-clockwise). Verify against [CoordinateTransformer.ts](../src/OpenRA.Game/CoordinateTransformer.ts). |

---

## Appendix: Quick Reference

### Existing Test Pages (76 total — unchanged)

| Chapter | Count | Directories |
|---------|:---:|------|
| Ch02 Rendering | 13 | animation-frame-switching, animation-orientation, animation-play-modes, atlas-packing, batch-rendering, color-accuracy, rgba-alpha-blending, rgba-debug-graphics, sprite-batch-rendering, sprite-billboarding, sprite-blend-modes, world-layer-ordering, world-z-sorting |
| Ch03 Actor | 3 | actor-scene-rendering, player-diplomacy, spatial-query |
| Ch04 Map | 6 | basic, cell-ramp-visual, map-data-viewer, pathfinding-visual, terrain-types, transform-visual |
| Ch05 UI | 1 | bridge |
| Ch07 Input | 1 | camera-controls |
| Ch08 Weapons | 1 | projectile-lifecycle |
| Ch10 Resources | 3 | color-mapping, dirty-cell-update, rendering |
| Ch12 Shroud | 6 | basic, cloak-alpha, cloak-detect, edges, frozen, reveal-map |
| Ch13 Powers | 3 | airstrike, charge-bar, nuke |
| Ch14 Activities | 11 | attack, attack-move, enter-capture, fly, fly-attack, land-takeoff, move, parachute, return-to-base, target-lines, turn |
| Ch16 Widgets | 4 | primitives, production-palette, radar, scroll-panel |
| Ch17 Replay | 4 | gamesave-roundtrip, replay-roundtrip, slotclient, syncreport |
| Ch19 CNC | 12 | chrono-post-process, chrono-vortex, drop-pods, gps-satellite, infantry-body, ion-cannon, leap-attack, mad-tank-detonation, palette-rotator, tesla-zap, voxel-body, voxel-walker |
| Ch19 D2K | 3 | concrete-placement, sandworm, sonic-blast |
| Ch20 Scripting | 1 | lua-vm-integration |
| Ch22 Entry | 4 | editor-stub, game-loading, mod-selector, router-navigation |

### Agent Workflow for Test Page Creation

1. **Team Lead** dispatches task to `acceptance-test-assistant` with TODO ID and module details
2. **acceptance-test-assistant** creates `index.html` + `main.ts` + `README.md` under the specified directory
3. **acceptance-test-assistant** verifies `npx tsc --noEmit` passes
4. **migration-review** reviews the test page (5 dimensions adapted for e2e)
5. **acceptance-test-runner** writes Playwright scripts + executes + generates `reproduce.md` + `report.md`
6. If failures: follow the redundancy check + commit gate workflow in `.claude/teams/openra-acceptance-test/config.json`

### Naming Conventions

- Chapter directory: `ch{num}-{title}` (e.g., `ch08-weapons-combat`)
- Test case ID: kebab-case descriptive (e.g., `missile-trajectory`, `building-placement`)
- Full path: `src/__e2e__/manual/{chapter}/{test-case-id}/`
- URL: `http://localhost:5173/test/{chapter}/{test-case-id}/`
