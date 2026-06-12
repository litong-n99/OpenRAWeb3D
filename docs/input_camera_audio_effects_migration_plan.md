# OpenRA to Babylon.js Migration Plan: Chapter 7 -- Input, Camera, Audio & Effects

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 8 (lines 1056-1264)
> **Chapter Status**: Chapter 7 -- IN PROGRESS (10/13 migrated, Phases A-E COMPLETE)
> **Planning Date**: 2026-06-12
> **Last Update**: 2026-06-12 (Phase E COMPLETE)
> **Prerequisite**: Chapter 6 (Network Sync & Game Logic) -- COMPLETE (29/29, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Input Foundation](#31-phase-a-input-foundation)
   - 3.2 [Phase B: Camera System](#32-phase-b-camera-system)
   - 3.3 [Phase C: Selection System](#33-phase-c-selection-system)
   - 3.4 [Phase D: Audio System](#34-phase-d-audio-system)
   - 3.5 [Phase E: Visual Effects](#35-phase-e-visual-effects)
   - 3.6 [Phase F: Projectiles](#36-phase-f-projectiles)
   - 3.7 [Phase G: Sprite Rendering Traits](#37-phase-g-sprite-rendering-traits)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Input, Camera, Audio, and Effects systems constitutes the **player experience layer** -- every interaction between the player and the game world flows through these subsystems. The core paradigm shift: **from SDL2 input polling + OpenGL 2D orthographic projection + OpenAL audio to Babylon.js DeviceSourceManager + ArcRotateCamera + Web Audio API**.

OpenRA's input/camera/audio/effects pipeline processes hardware events through a 2D screen coordinate system, routes them through Widget trees, and dispatches orders and camera movements. In the 3D Babylon.js environment, this transforms into:

- **Input layer**: `DeviceSourceManager` + `onPointerObservable` replacing SDL2 keyboard/mouse polling + `IInputHandler` interface
- **Camera layer**: `ArcRotateCamera` (orthographic or perspective mode) replacing manual 2D `Viewport` with CPU-computed coordinate transforms
- **Selection layer**: 3D raycasting + frustum-based box selection replacing 2D `ScreenMap` spatial index queries
- **Audio layer**: Howler.js / Web Audio API replacing OpenAL `ISoundEngine` with `Listener`/`Source`/`Buffer` abstraction
- **Effects layer**: `ParticleSystem` / `GPUParticleSystem` replacing CPU sprite-based `SpriteEffect` frame animation
- **Projectile layer**: `Sprite` + `TrailMesh` + ray-based collision replacing 2D `Bullet` with manual trail rendering

### 1.2 Five Core Architectural Principles

1. **Unified input pipeline over per-frame polling**: Babylon.js `DeviceSourceManager` provides a unified event-driven input abstraction. The custom `InputManager` class wraps DSM and mirrors OpenRA's `NullInputHandler`/`DefaultInputHandler` dual-implementation pattern for headless and interactive modes.

2. **Dual camera mode with runtime toggle**: `ArcRotateCamera` supports both `ORTHOGRAPHIC_CAMERA` mode (traditional RTS top-down feel) and `PERSPECTIVE_CAMERA` mode (3D immersive view). The player can toggle between modes via game settings. Default mode is orthographic to maintain RTS user expectations.

3. **3D raycasting over 2D spatial indexing**: Unit selection migrates from `ScreenMap` 2D rectangle queries to `scene.pickWithRay()` for point selection and frustum-plane intersection for box selection. The `GPUPicker` (Babylon.js v8.0+) provides hardware-accelerated picking for large-scale unit counts.

4. **Layered audio architecture over single OpenAL context**: Howler.js provides the baseline 2D/3D audio API compatible with OpenRA's `ISoundEngine` interface. For advanced use cases, direct Web Audio API access enables custom `AudioNode` graphs (EQ, reverb, spatial effects). Volume control preserves OpenRA's chain multiplication model: `FinalVolume = SoundVolume × soundVolumeModifier × volumeModifier × pool.VolumeModifier`.

5. **GPU particles over CPU sprite effects**: All visual effects (explosions, smoke, fire) migrate from CPU-driven sprite animation loops to Babylon.js `ParticleSystem` and `GPUParticleSystem`. Projectile trails use `TrailMesh` for GPU-generated dynamic geometry. A distance-based LOD system controls particle emission rates to maintain performance.

### 1.3 Prerequisites (Already Completed in Prior Chapters)

| Dependency | Source | Status |
|:---|:---|:---|
| `WorldRenderer.ts` (ScreenPxPosition) | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | COMPLETE (Ch2, 1314 lines) |
| `Animation.ts` (sprite animation engine) | `src/OpenRA.Game/Graphics/Animation.ts` | COMPLETE (Ch2, 558 lines) |
| `WorldInteractionControllerWidget.ts` (unit selection) | `src/OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.ts` | COMPLETE (Ch5 Phase E, 1157 lines) |
| Coordinate types (WPos, WVec, CPos, etc.) | `src/OpenRA.Game/` | COMPLETE (Ch3 Phase A) |
| `World.ts` / `GameWorldManager` | `src/OpenRA.Game/World.ts` | COMPLETE (Ch3 Phase C) |
| `Actor.ts` / `GameActor` | `src/OpenRA.Game/Actor.ts` | COMPLETE (Ch3 Phase D) |
| `Player.ts` | `src/OpenRA.Game/Player.ts` | COMPLETE (Ch3 Phase G) |
| `Target` type | `src/OpenRA.Game/Target.ts` | COMPLETE (Ch3 Phase A) |
| `Order.ts` / `UnitOrders.ts` | `src/OpenRA.Game/Network/` | COMPLETE (Ch6 Phase A) |
| `ModData.ts` + `Manifest.ts` | `src/OpenRA.Game/` | COMPLETE (Ch5 Phase C) |
| `FileSystem.ts` (VFS) | `src/OpenRA.Game/FileSystem/` | COMPLETE (Ch5 Phase A) |
| `Map.ts` / terrain mesh | `src/OpenRA.Game/Map/Map.ts` | COMPLETE (Ch4 Phase D) |
| `CoordinateTransformer.ts` (WPos<->Vector3) | `src/OpenRA.Game/CoordinateTransformer.ts` | COMPLETE (Ch4 Phase I) |
| `Renderer.ts` | `src/OpenRA.Game/Renderer.ts` | COMPLETE (Ch2) |

### 1.4 Architecture Diagram Reference

Refer to **Section 8** in `docs/openra_migration.agent.final.converted.md` (lines 1056-1264) for the complete OpenRA Input/Camera/Audio/Effects system architecture analysis. Key structural mappings:

```
IInputHandler.cs         -->  InputManager (DSM wrapper + Observable)
  +-- NullInputHandler         +-- NullInputHandler (headless no-op)
  +-- DefaultInputHandler      +-- DefaultInputHandler (DSM -> Widget tree)

Keycode.cs              -->  KeyCode enum (SDL -> KeyboardEvent.code mapping)

Viewport.cs             -->  RTSCameraController (ArcRotateCamera wrapper)
  +-- ViewToWorldPx          +-- Vector3.Unproject() + terrain plane intersection
  +-- AdjustZoom             +-- ArcRotateCamera.orthoTop/Bottom/Left/Right or .radius

ViewportControllerWidget.cs -->  CameraControlWidget (hotkey bindings + edge scroll)

SelectionUtils.cs       -->  UnitSelectionManager (raycasting + frustum culling)
  +-- SelectHighestPriority  +-- scene.pickWithRay() + priority ranking

Sound.cs                -->  AudioManager (Howler.js wrapper)
  +-- ISoundEngine           +-- Howler global / AudioContext
  +-- Play(WPos)             +-- howl.pos(x,y,z) + howl.play()

SoundDevice.cs          -->  WebAudioEngine interface (AudioContext + PannerNode)

SpriteEffect.cs         -->  ParticleSystem / ParticleHelper preset mapping
  +-- Tick + Render          +-- ParticleSystem.start() + auto-simulation

Bullet.cs               -->  ProjectileSystem (Sprite + TrailMesh + ray collision)
  +-- Tick trajectory        +-- Timeline animation + scene.onBeforeRenderObservable
  +-- Contrail render        +-- TrailMesh GPU dynamic geometry

FloatingSpriteEmitter.cs -->  GPUParticleSystem + custom emitter config

RenderSprites.cs        -->  SpriteManager + Sprite rendering management
  +-- WithIdleOverlay        +-- Billboard Sprite / Decal overlay

Animation.cs            -->  SpriteManager + Sprite.playAnimation()  [ALREADY DONE Ch2]

WorldInteractionControllerWidget.cs --> 3D raycasting + box selection  [ALREADY DONE Ch5]

WorldRenderer.cs        -->  Scene.render() + Vector3.Project()  [ALREADY DONE Ch2]
```

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (16 files across 7 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Already Completed (Prior Chapters)** | | | | | | |
| -- | `OpenRA.Game/Graphics/WorldRenderer.cs` | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | `WorldRenderer` | 1314 | HIGH | Ch2 ✅ |
| -- | `OpenRA.Game/Graphics/Animation.cs` | `src/OpenRA.Game/Graphics/Animation.ts` | `Animation` | 259 | MEDIUM | Ch2 ✅ |
| -- | `OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.ts` | `WorldInteractionControllerWidget` | 235 | HIGH | Ch5 ✅ |
| | | | | | | |
| **Phase A: Input Foundation (3 files)** | | | | | | |
| 1 | `OpenRA.Game/Input/IInputHandler.cs` | `src/OpenRA.Game/Input/IInputHandler.ts` | `IInputHandler`, `MouseInput`, `KeyInput`, `Modifiers` | 84 | LOW | A |
| 2 | `OpenRA.Game/Input/InputHandler.cs` | `src/OpenRA.Game/Input/InputHandler.ts` | `DefaultInputHandler`, `NullInputHandler` | 53 | MEDIUM | A |
| 3 | `OpenRA.Game/Input/Keycode.cs` | `src/OpenRA.Game/Input/Keycode.ts` | `Keycode` (SDL key enum) | 513 | LOW | A |
| | | | | | | |
| **Phase B: Camera System (2 files)** | | | | | | |
| 4 | `OpenRA.Game/Graphics/Viewport.cs` | `src/OpenRA.Game/Graphics/Viewport.ts` | `Viewport`, `CameraController` | 441 | HIGH | B |
| 5 | `OpenRA.Mods.Common/Widgets/ViewportControllerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/ViewportControllerWidget.ts` | `ViewportControllerWidget` | 506 | MEDIUM | B |
| | | | | | | |
| **Phase C: Selection System (1 file)** | | | | | | |
| 6 | `OpenRA.Mods.Common/Widgets/SelectionUtils.cs` | `src/OpenRA.Mods.Common/Widgets/SelectionUtils.ts` | `SelectionUtils` | 86 | MEDIUM | C |
| | | | | | | |
| **Phase D: Audio System (2 files)** | | | | | | |
| 7 | `OpenRA.Game/Sound/Sound.cs` | `src/OpenRA.Game/Sound/Sound.ts` | `Sound`, `SoundType` | 481 | MEDIUM | D |
| 8 | `OpenRA.Game/Sound/SoundDevice.cs` | `src/OpenRA.Game/Sound/SoundDevice.ts` | `ISoundEngine`, `ISound`, `ISoundSource` | 46 | MEDIUM | D |
| | | | | | | |
| **Phase E: Visual Effects (2 files)** | | | | | | |
| 9 | `OpenRA.Mods.Common/Effects/SpriteEffect.cs` | `src/OpenRA.Mods.Common/Effects/SpriteEffect.ts` | `SpriteEffect` | 86 | MEDIUM | E |
| 10 | `OpenRA.Mods.Common/Traits/Render/FloatingSpriteEmitter.cs` | `src/OpenRA.Mods.Common/Traits/Render/FloatingSpriteEmitter.ts` | `FloatingSpriteEmitter` | 126 | MEDIUM | E |
| | | | | | | |
| **Phase F: Projectiles (1 file)** | | | | | | |
| 11 | `OpenRA.Mods.Common/Projectiles/Bullet.cs` | `src/OpenRA.Mods.Common/Projectiles/Bullet.ts` | `Bullet`, `IProjectile` | 397 | HIGH | F |
| | | | | | | |
| **Phase G: Sprite Rendering Traits (2 files)** | | | | | | |
| 12 | `OpenRA.Mods.Common/Traits/Render/RenderSprites.cs` | `src/OpenRA.Mods.Common/Traits/Render/RenderSprites.ts` | `RenderSprites`, `SpriteRenderable` | 302 | MEDIUM | G |
| 13 | `OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.cs` | `src/OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.ts` | `WithIdleOverlay` | 124 | LOW | G |

> **Complexity Legend**:
> - **LOW**: Simple data structures or thin adapters. 40-170 lines of C#. Enum mappings or interface definitions.
> - **MEDIUM**: Moderate logic with dependencies on Phase A/B types or external libraries. 170-510 lines of C#.
> - **HIGH**: Complex architecture requiring careful design. 390-440 lines of C# with significant Babylon.js integration, coordinate system transformation, or 3D collision detection.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total files in plan** | 16 (3 already completed in prior chapters + 8 completed in Phases A-E + 5 pending migration) |
| **Phase A (Input foundation)** | 3 files (COMPLETE) |
| **Phase B (Camera system)** | 2 files (COMPLETE) |
| **Phase C (Selection system)** | 1 file (COMPLETE) |
| **Phase D (Audio system)** | 2 files (COMPLETE) |
| **Phase E (Visual effects)** | 2 files (COMPLETE) |
| **Phase F (Projectiles)** | 1 file (all pending) |
| **Phase G (Sprite rendering traits)** | 2 files (all pending) |
| **HIGH complexity** | 2 files (Viewport, Bullet) |
| **MEDIUM complexity** | 9 files |
| **LOW complexity** | 2 files |
| **Total OpenRA C# source lines (new, pending)** | ~1,940 |
| **Total OpenRA C# source lines (including already done)** | ~4,600 |
| **Estimated TypeScript lines (new, pending)** | ~4,500-5,800 (including test files) |
| **Actual TypeScript lines (Phases A-E completed)** | Phase A: 1,337 (IInputHandler 176 + Keycode 544 + InputHandler 617) + 155 tests | Phase B: 2,251 (Viewport 1,023 + ViewportControllerWidget 868 + HotkeyReference 360) + 86 tests | Phase C: 723 (SelectionUtils) + 58 tests | Phase D: 1,652 (Sound 1,383 + SoundDevice 269) + 133 tests | Phase E: SpriteEffect + FloatingSpriteEmitter + 92 tests |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Input Foundation

**Status**: ✅ 已完成 (3/3)
**Complexity**: LOW-MEDIUM
**Completed**: 2026-06-12
**Commits**: `4260360` (initial), `1920155` (review fixes)
**Review**: APPROVED (2 rounds, 1 BLOCKER + 3 MAJOR resolved)
**Implementation**: IInputHandler.ts (176行), Keycode.ts (544行), InputHandler.ts (617行) = 1,337行
**Tests**: 3 test files, 155 tests
**Blocked by**: Nothing (standalone phase)
**Blocks**: Phase B (Camera needs input events), Phase C (Selection needs input events)
**External dependency**: None (Babylon.js DSM built into `@babylonjs/core`)

**Description**: Phase A establishes the input abstraction layer, translating OpenRA's SDL2-based input system to Babylon.js's `DeviceSourceManager` (DSM) and pointer observables. This phase creates the `IInputHandler` interface (mirroring the C# contract), two handler implementations (`NullInputHandler` for headless mode, `DefaultInputHandler` for interactive play), and a `Keycode` enum mapping SDL key codes to JavaScript `KeyboardEvent.code` values. The input pipeline must handle keyboard, mouse, and text input through a unified observable-based architecture that feeds into the existing Widget system.

**Paradigm Shifts**:
- C# `SDL2.SDL_Event` polling -> Babylon.js `DeviceSourceManager.onInputChangedObservable` event-driven
- C# `MouseInput` record struct (int2 pixel coords) -> `PointerEvent` with normalized device coordinates (NDC) converted back to pixel coords via `engine.getRenderWidth/Height()`
- C# `[Flags] Modifiers` enum -> `{ shift, alt, ctrl, meta }` boolean flags from `KeyboardEvent`
- C# `[Flags] MouseButton` enum -> `PointerEvent.button` (0=left, 1=middle, 2=right) + `buttons` bitmask
- C# `Keycode` SDL 2.0.1 enum -> TypeScript `KeyCode` enum mapped to `KeyboardEvent.code` string values (e.g., `ArrowUp`, `KeyA`, `F1`)
- Browser `preventDefault()` required for scroll blocking with `{ passive: false }` listener option

#### 3.1.1 IInputHandler Interface + Input Types

- [x] **TODO-7.A.1** `src/OpenRA.Game/Input/IInputHandler.ts` (84 lines C#) ✅ 已完成 (176行 TS) -- Input handler contract:
  - `MouseInput` interface: `event: MouseEventType` enum (`Down`, `Move`, `Up`, `Scroll`), `button: MouseButton` flags enum, `location: { x: number, y: number }` (pixel coords), `delta: { x: number, y: number }`, `modifiers: Modifiers`, `multiTapCount: number`
  - `KeyInput` interface: `event: KeyEventType` enum (`Down`, `Up`), `key: KeyCode`, `modifiers: Modifiers`
  - `Modifiers` interface: `shift: boolean`, `alt: boolean`, `ctrl: boolean`, `meta: boolean`
  - `MouseButton` flags enum: `None = 0`, `Left = 1`, `Middle = 2`, `Right = 4`, `X1 = 8`, `X2 = 16`
  - `MouseEventType` enum: `Down`, `Move`, `Up`, `Scroll`
  - `KeyEventType` enum: `Down`, `Up`
  - `IInputHandler` interface: `modifierKeys(mods: Modifiers): void`, `onKeyInput(input: KeyInput): void`, `onMouseInput(input: MouseInput): void`, `onTextInput(text: string): void`
  - **Design decision**: Use TypeScript interfaces for input data types (not classes) to match C# `record struct` semantics (immutable value types). Use `Object.freeze()` or `Readonly<>` for immutability.
  - **Coordinate note**: All coordinates in pixel space (window-relative), NOT NDC. DSM returns NDC; adapter layer must convert.

#### 3.1.2 InputHandler Implementations

- [x] **TODO-7.A.2** `src/OpenRA.Game/Input/InputHandler.ts` (53 lines C#) ✅ 已完成 (617行 TS) -- Handler implementations:
  - `NullInputHandler` class implementing `IInputHandler`: all methods are no-ops. Used for dedicated server, replay playback, and headless testing modes.
  - `DefaultInputHandler` class implementing `IInputHandler`:
    - Constructor takes `DeviceSourceManager` + `Scene` (for `onPointerObservable`)
    - `modifierKeys(mods)`: updates global modifier state, delegates to `Game.HandleModifierKeys(mods)` equivalent
    - `onKeyInput(input)`: routes to Widget system via `Sync.RunUnsynced(world, () => Ui.HandleInput(input))` equivalent -- uses scene's `onBeforeRenderObservable` for frame-aligned input dispatch
    - `onMouseInput(input)`: routes to Widget tree; calls `Ui.HandleInput(input)` for Widget-based input consumption
    - `onTextInput(text)`: routes text input events (IME-aware)
  - `InputManager` helper class (new, no C# equivalent):
    - Wraps `DeviceSourceManager` instantiation and cleanup
    - `createDefault(): InputManager` -- registers DSM for keyboard + mouse
    - `dispose(): void` -- unregisters all DSM observers, cleans up pointer observable
    - DSM keyboard observer converts `KeyboardInfo` to `KeyInput` events
    - DSM pointer observer converts `PointerInfo` to `MouseInput` events (with pixel coordinate conversion from NDC)
    - Scroll blocking: registers `wheel` event on canvas with `{ passive: false }` and calls `preventDefault()`
  - **Browser safety**: Avoid `F12`, `Ctrl+W`, `Ctrl+N`, `Ctrl+T` and other browser-reserved shortcuts. Document these in the KeyCode enum.

#### 3.1.3 Keycode Enum

- [x] **TODO-7.A.3** `src/OpenRA.Game/Input/Keycode.ts` (513 lines C#) ✅ 已完成 (544行 TS) -- SDL keycode mapping:
  - `KeyCode` enum with ~230 members covering: letter keys (`A`-`Z`), number keys (`0`-`9`), function keys (`F1`-`F15`), navigation keys (`Up`, `Down`, `Left`, `Right`), modifier keys (`Shift`, `Ctrl`, `Alt`, `Meta`), special keys (`Escape`, `Enter`, `Space`, `Tab`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`), numpad keys (`NumPad0`-`NumPad9`), mouse buttons (`Mouse1`-`Mouse5`)
  - Static helper: `KeyCode.fromKeyboardEvent(event: KeyboardEvent): KeyCode` -- maps `event.code` string to enum value
  - Static helper: `KeyCode.fromSDLK(sdlKey: number): KeyCode` -- maps numeric SDL keycode to enum (for legacy/configuration compatibility)
  - `keyName(code: KeyCode): string` -- human-readable key name for UI display (hotkey configuration screen)
  - **Design decision**: Use numeric enum values matching SDL keycodes where possible, but the runtime resolution uses `KeyboardEvent.code` string mapping. The SDL-to-Code mapping table covers all 230+ keys.

**Acceptance Criteria**:
- `NullInputHandler` no-ops all methods with zero side effects
- `DefaultInputHandler` correctly translates DSM keyboard events to `KeyInput` and dispatches to widget system
- `DefaultInputHandler` correctly translates pointer events to `MouseInput` with pixel coordinates
- Scroll events call `preventDefault()` to prevent page scrolling during gameplay
- `KeyCode.fromKeyboardEvent()` correctly maps all standard `KeyboardEvent.code` values
- Input dispatch occurs within `scene.onBeforeRenderObservable` for frame-aligned processing
- `InputManager.dispose()` cleanly removes all event listeners without leaks

**Actual Effort**: 1,337 lines implementation + 155 tests (3 test files). Completed 2026-06-12. Review: 2 rounds, 1 BLOCKER + 3 MAJOR resolved.

---

### 3.2 Phase B: Camera System

**Status**: ✅ 已完成 (2/2)
**Complexity**: HIGH (Viewport), MEDIUM (ViewportControllerWidget)
**Completed**: 2026-06-12
**Commits**: `3688b66` (Viewport), `feca8b6` (ViewportControllerWidget), `6d722c4` (HotkeyReference prereq)
**Review**: APPROVED (2 rounds, 3 BLOCKER + 5 MAJOR resolved)
**Implementation**: Viewport.ts (1,023行), ViewportControllerWidget.ts (868行), HotkeyReference.ts (360行 prereq) = 2,251行
**Tests**: 2 test files, 86 tests (Viewport.test.ts: 742 lines, ViewportControllerWidget.test.ts: 573 lines = ~1,315 test lines)
**Blocked by**: Phase A (Input Foundation -- for camera control events) ✅, `WorldRenderer.ts` (COMPLETE Ch2), `CoordinateTransformer.ts` (COMPLETE Ch4 Phase I)
**Blocks**: Phase C (Selection needs camera coordinate transforms)

**Description**: Phase B migrates OpenRA's 2D orthographic viewport management to Babylon.js `ArcRotateCamera`. The `Viewport` class manages the camera target (`CenterLocation`), zoom level, viewport size, and map boundary clamping. The `ViewportControllerWidget` handles user-facing camera controls: hotkey bindings, edge scrolling, mouse-wheel zoom, and cursor context switching. A new prereq file `HotkeyReference.ts` was added to support configurable hotkey bindings. The core challenge is mapping OpenRA's three-layer coordinate system (screen -> viewport -> world) to Babylon.js's unified 3D world coordinate system with GPU-managed projection/unprojection.

**Paradigm Shifts**:
- C# CPU-computed `ViewToWorldPx(int2)` (pixel math) -> `Vector3.Unproject()` + terrain plane intersection (GPU-backed)
- C# `zoom` float factor + exponential scaling -> `ArcRotateCamera.orthoTop/Bottom/Left/Right` (ortho mode) or `.radius` (perspective mode) with `zoomToMouseLocation`
- C# `mapBounds` clamping -> custom `clampTarget(target: Vector3): Vector3` with map boundary check
- C# `GetBlockedDirections()` scroll edge detection -> comparing `camera.target` against map min/max bounds
- C# `EdgeScrollThreshold` (15px default) -> checking pointer position against canvas edge in `onPointerMove`
- C# hotkey-based scroll (`ScrollUpKey` etc.) -> `DeviceSourceManager` keyboard observer with configurable key bindings (via `HotkeyReference` class)
- C# `ToggleZoom()` min/max toggle -> `camera.radius` or `orthoTop` interpolation with easing

#### 3.2.1 Viewport (Camera Controller)

- [x] **TODO-7.B.1** `src/OpenRA.Game/Graphics/Viewport.ts` (441 lines C#) ✅ 已完成 (1,023行 TS) -- RTS camera controller:
  - `CameraController` class (renamed from `Viewport` to avoid confusion with screen viewport):
    - Constructor: `(camera: ArcRotateCamera, mapBounds: { minX: number, maxX: number, minZ: number, maxZ: number }, engine: Engine)`
    - `centerLocation: Vector3` -- maps to `camera.target`. Defaults to map center.
    - `zoom: number` -- in ortho mode controls `orthoTop/Bottom/Left/Right`; in perspective mode controls `radius`
    - `viewportSize: { width: number, height: number }` -- read from `engine.getRenderWidth/Height()`
    - `minZoom: number` (default 1.0), `maxZoom: number` (default 2.0)
    - `MapBounds: { minX, maxX, minZ, maxZ }` -- geographic limits
  - Methods (all implemented):
    - `viewToWorldPx(v)`: converts viewport pixel coordinates to world position via `scene.createPickingRay()` + terrain plane intersection
    - `viewToWorld(v)`: calls `viewToWorldPx()` then delegates to projected cell coordinates
    - `adjustZoom(dz)`: exponential zoom scaling; clamp to `[minZoom, maxZoom]`
    - `adjustZoom(dz, center)`: zoom toward a screen point (zoom-to-mouse)
    - `toggleZoom()`: switches between `minZoom` and `maxZoom`
    - `getBlockedDirections()`: bitmask of blocked scroll directions from map boundary comparison
    - `clampTarget()`: clamps camera target to map bounds; called every frame in `onBeforeRenderObservable`
    - `updateViewportSize()`: updates viewport dimensions on resize
  - Properties: `terrainMousePosition` (WPos getter), `cameraMode` (Orthographic/Perspective enum toggle)
  - **LH coordinate system constraint**: Babylon.js uses `Matrix.LookAtLH`. ArcRotateCamera uses `alpha = -PI/2` (camera on -Z side) ensuring screen-right = world+X.
  - **Actual implementation**: 1,023 lines implementation + 742 lines test. Full ArcRotateCamera wrapper with dual ortho/perspective mode, zoom-to-cursor, boundary clamping, bookmark system, and scroll direction detection.

#### 3.2.2 ViewportControllerWidget

- [x] **TODO-7.B.2** `src/OpenRA.Mods.Common/Widgets/ViewportControllerWidget.ts` (506 lines C#) ✅ 已完成 (868行 TS) -- Camera control widget:
  - `ViewportControllerWidget` class:
    - Inherits from `Widget` (already migrated in Ch5 Phase D)
    - `cameraController: CameraController` -- reference to the Phase B.1 controller
    - `inputManager: InputManager` -- reference to Phase A `InputManager`
  - Hotkey configuration (declarative, from JSON/manifest):
    - `ZoomInKey: KeyCode` (via `HotkeyReference`), `ZoomOutKey: KeyCode`
    - `ScrollUpKey: KeyCode`, `ScrollDownKey: KeyCode`, `ScrollLeftKey: KeyCode`, `ScrollRightKey: KeyCode`
    - `JumpToTopEdgeKey: KeyCode`, `JumpToBottomEdgeKey: KeyCode`, etc.
    - `BookmarkSaveKeyPrefix: string`, `BookmarkRestoreKeyPrefix: string`
  - Input mode configuration:
    - `mouseScroll: MouseScrollType` enum (`Zoom`, `Scroll`, `Disabled`) -- default `Zoom`
    - `edgeScrollThreshold: number` (default 15 pixels)
    - `smoothScroll: boolean` (default true) -- enables smooth camera panning
    - `scrollSpeed: number` -- pixels per second for arrow key / edge scroll
  - Behavior methods (all implemented):
    - `handleKeyInput(input)`: dispatches to hotkey actions via `HotkeyReference`
    - `handleMouseInput(input)`: handles edge scroll + mouse wheel zoom
    - `handleEdgeScroll()`: checks pointer proximity to canvas edge, scrolls camera
    - `updateCursor()`: directional arrow cursors based on scroll direction
    - `saveBookmark(slot)` / `restoreBookmark(slot)`: jump to saved map positions
  - **Integration note**: `WorldInteractionControllerWidget` (already migrated in Ch5) handles unit selection. `ViewportControllerWidget` only handles camera movement. Both consume the same input stream but for different purposes. Input routing ensures camera controls do not interfere with selection controls.
  - **Actual implementation**: 868 lines implementation + 573 lines test. Full Widget integration with existing Ch5 Widget infrastructure, HotkeyReference-based configurable bindings, edge scrolling with directional cursor feedback.

#### 3.2.3 HotkeyReference (Prerequisite)

- **`src/OpenRA.Game/Input/HotkeyReference.ts`** (new prereq file, 360 lines) -- Configurable hotkey binding:
  - `HotkeyReference` class wrapping a `Func<KeyCode>` that can be rebound at runtime
  - Enables declarative hotkey configuration in `ViewportControllerWidget` and other Widgets
  - Integrates with `KeyCode` enum and `KeyInput` event system from Phase A

**Acceptance Criteria** (all met):
- ✅ `viewToWorldPx()` returns correct world position for all four screen corners
- ✅ `adjustZoom(dz, center)` correctly zooms toward the specified screen point
- ✅ Map boundary clamping prevents camera target from leaving map bounds in all 8 scroll directions
- ✅ `cameraMode` toggle correctly switches between orthographic and perspective modes
- ✅ Edge scrolling activates when pointer is within `edgeScrollThreshold` pixels of canvas edge
- ✅ All hotkeys are configurable and work in both orthographic and perspective modes
- ✅ `terrainMousePosition` correctly returns the world position under the cursor
- ✅ Camera controller respects the LH coordinate system constraint (screen-right = world+X)
- ✅ HotkeyReference allows runtime rebinding without recompilation

**Actual Effort**: 2,251 lines implementation (Viewport 1,023 + ViewportControllerWidget 868 + HotkeyReference 360) + ~1,315 lines test (86 tests). Completed 2026-06-12. Review: 2 rounds, 3 BLOCKER + 5 MAJOR resolved.

---

### 3.3 Phase C: Selection System

**Status**: ✅ 已完成 (1/1)
**Complexity**: MEDIUM
**Completed**: 2026-06-12
**Commits**: `ee38601` (initial), `406df32`, `816bb5a` (review fixes)
**Review**: APPROVED (3 rounds)
**Implementation**: SelectionUtils.ts (723行)
**Tests**: 1 test file, 58 tests
**Blocked by**: Phase B (Camera for coordinate transforms) ✅, `WorldInteractionControllerWidget.ts` (COMPLETE Ch5 -- already migrated and provides the main selection logic), `CoordinateTransformer.ts` (COMPLETE Ch4 Phase I)
**Blocks**: Nothing (leaf phase)

**Description**: Phase C migrates `SelectionUtils`, a utility class providing the low-level selection algorithms that `WorldInteractionControllerWidget` (already migrated) calls. The core paradigm shift replaces OpenRA's `ScreenMap.ActorsInMouseBox()` 2D spatial index queries with pre-filtered candidates passed from `WorldInteractionControllerWidget`, which performs 3D raycasting/frustum queries. The selection priority algorithm (`calculateActorSelectionPriority`) is preserved from OpenRA's formula with pixel distance scaling.

**Paradigm Shifts**:
- C# `ScreenMap.ActorsInMouseBox()` 2D spatial index -> Pre-filtered candidates (3D queries performed by WorldInteractionControllerWidget)
- C# `SelectHighestPriorityActorAtPoint()` + pixel distance -> `withHighestSelectionPriority()` with pre-ranked candidates
- C# `CalculateActorSelectionPriority()` (modifiers - pixelDistance << 16) -> Preserved formula with `selectionPriority()` modifier lookup
- C# `SelectActorsInBoxWithDeadzone()` -> `selectActorsInBoxWithDeadzone()` with deadzone-to-point fallback and tier-based subset filtering
- C# `WithHighestSelectionPriority` LINQ extension -> `Array.reduce()` single-pass priority comparison
- C# `AllPlayers`, `NonObservingVisitors`, `ObservingVisitors` -> `getPlayersToIncludeInSelection()` with identical shroud/observer logic

#### 3.3.1 SelectionUtils

- [x] **TODO-7.C.1** `src/OpenRA.Mods.Common/Widgets/SelectionUtils.ts` (86 lines C#) ✅ 已完成 (723行 TS) -- Selection algorithms:
  - `UnitSelectionManager` class (renamed from static `SelectionUtils` for consistency with TypeScript OOP style):
    - `selectHighestPriorityActorAtPoint(scene: Scene, camera: Camera, screenX: number, screenY: number, candidates: GameActor[], modifiers: Modifiers): GameActor | undefined`
      - Creates picking ray from screen coordinates
      - Calls `scene.pickWithRay(ray, (mesh) => mesh.metadata?.selectable === true)`
      - If no hit, returns `undefined`
      - If `GPUPicker` is available (Babylon.js v8.0+), uses GPU picker for performance
      - Priority calculated via: `CalculatePriority(modifiers) - (cameraDistance * someWeight)`
    - `selectActorsInBoxWithDeadzone(scene: Scene, camera: Camera, boxStart: { x: number, y: number }, boxEnd: { x: number, y: number }, deadzone: number, candidates: GameActor[]): GameActor[]`
      - If box diagonal < deadzone: returns empty (deadzone filter)
      - Builds frustum from 4 corners of selection rectangle:
        1. `Vector3.UnprojectFrustumToWorld()` or manual unproject of each corner
        2. Creates `BABYLON.Frustum` from 6 planes (4 sides + near + far)
      - Iterates candidates, tests `mesh.getBoundingInfo().boundingBox.isInFrustum(frustumPlanes)`
      - Returns all actors whose bounding box intersects the frustum
      - **Performance note**: For large unit counts, pre-filter using spatial hash or octree before frustum test
    - `selectActorsOnScreen(camera: Camera, candidates: GameActor[]): GameActor[]`
      - Returns all actors within camera frustum (uses `camera.isInFrustum()` or bounding box test)
    - `calculateActorSelectionPriority(actor: GameActor, modifiers: Modifiers, cameraDistance: number): number`
      - Preserves OpenRA formula: `selectionPriority(modifiers) - (cameraDistance << 16)`
      - `selectionPriority(modifiers)` queries actor's `ISelectable` trait with modifier flag adjustment
      - Camera distance is in world units from camera position to actor position
  - `SelectionPriority` enum: standard priority values for different unit types
  - Integration with existing `WorldInteractionControllerWidget`:
    - Replace stub methods in WICW with calls to `UnitSelectionManager`
    - Box selection: WICW's drag handler calls `selectActorsInBoxWithDeadzone()` instead of placeholder logic
    - Point selection: WICW's click handler calls `selectHighestPriorityActorAtPoint()`

**Acceptance Criteria** (all met):
- ✅ Point selection with raycasting correctly identifies the closest selectable unit under the cursor
- ✅ Box selection correctly identifies all units whose bounding boxes intersect the selection frustum
- ✅ Deadzone logic: drag distances below threshold (default 4px) are treated as clicks, not box selections
- ✅ Priority algorithm correctly ranks units by type priority and distance with same relative ordering as OpenRA
- ✅ Performance: box selection of 500 units completes in under 16ms (one frame)
- ✅ Integration test: `WorldInteractionControllerWidget` calls `UnitSelectionManager` and receives correct selection sets

**Actual Effort**: 723 lines implementation + 58 tests. Completed 2026-06-12. Review: 3 rounds, APPROVED.

---

### 3.4 Phase D: Audio System

**Status**: ✅ 已完成 (2/2)
**Complexity**: MEDIUM
**Completed**: 2026-06-12
**Commit**: `3f1b511`
**Review**: APPROVED
**Implementation**: Sound.ts (1,383行), SoundDevice.ts (269行) = 1,652行
**Tests**: 2 test files, 133 tests (Sound.test.ts: ~110 tests/1,553行, SoundDevice.test.ts: ~23 tests/368行)
**Blocked by**: Chapter 3 Phase A (WPos for 3D positioning), `FileSystem.ts` (COMPLETE Ch5 Phase A -- for audio file loading)
**Blocks**: Nothing (independent subsystem)
**External dependency**: `howler` npm package (Howler.js v2.x for 3D spatial audio)

**Description**: Phase D migrates OpenRA's audio system from OpenAL to Howler.js (with Web Audio API fallback for advanced features). The `ISoundEngine` interface defines the audio engine contract (device enumeration, sound loading, 2D/3D playback, listener positioning). The `Sound` class is the central audio manager that maintains sound caches, volume chains, and the sound pool system with overlap/interrupt/do-not-play semantics. The volume model preserves OpenRA's chain multiplication: `FinalVolume = SoundVolume × soundVolumeModifier × volumeModifier × pool.VolumeModifier`.

**Paradigm Shifts**:
- C# OpenAL `ISoundEngine` -> Howler.js global instance + custom `WebAudioEngine` wrapper class
- C# `AL.ListenerPosition` -> `Howler.pos(x, y, z)` or `AudioListener.positionX/Y/Z`
- C# `AL.SourcePosition` -> `howl.pos(x, y, z, soundId)` per-instance positioning
- C# `SoundType` enum (`World`, `UI`) -> retained as TypeScript enum; `World` sounds use 3D spatial positioning, `UI` sounds use 2D (no spatialization)
- C# `SoundPool` with `InterruptType` (`Overlap`, `Interrupt`, `DoNotPlay`) -> custom `SoundPool` class tracking active sound IDs per pool
- C# AUD/VOC/WAV format loading -> WebM (Vorbis) / MP3 dual-format with Howler.js auto-format selection
- C# `Cache<string, ISoundSource>` -> `Map<string, Howl>` with lazy loading

#### 3.4.1 SoundEngine Interface

- [x] **TODO-7.D.1** `src/OpenRA.Game/Sound/SoundDevice.ts` (46 lines C#) ✅ 已完成 (269行 TS) -- Audio engine interface:
  - `ISoundEngine` interface:
    - `availableDevices(): string[]` -- enumerates available audio output devices (limited browser support; returns `['default']` for most browsers)
    - `addSoundSourceFromMemory(name: string, data: ArrayBuffer): ISoundSource` -- decodes audio data, creates `Howl` instance
    - `play2D(sound: ISoundSource, volume: number, loop: boolean, startTime?: number): ISound` -- non-spatialized playback
    - `play3D(sound: ISoundSource, position: WPos, volume: number, loop: boolean): ISound` -- spatialized 3D playback
    - `setListenerPosition(position: WPos): void` -- updates listener position (called once per frame, maps to camera center)
    - `setSoundPosition(sound: ISound, position: WPos): void` -- updates individual sound source position
    - `setSoundVolume(sound: ISound, volume: number): void` -- per-sound volume control
    - `stopSound(sound: ISound): void` -- stops and releases a sound instance
    - `pauseSound(sound: ISound): void` / `resumeSound(sound: ISound): void`
    - `dispose(): void` -- releases all audio resources
  - `ISound` interface: `id: number`, `source: ISoundSource`, `playing: boolean`, `volume: number`, `looping: boolean`
  - `ISoundSource` interface: `name: string`, `duration: number` (seconds)
  - `WebAudioEngine` class implementing `ISoundEngine`:
    - Wraps Howler.js global: `Howler.autoUnlock = true` for browser autoplay policy
    - `AudioContext` initialization: creates on first user interaction, resumes if suspended
    - `play3D()` uses `howl.pos(x, y, z, soundId)` and `Howler.pos(x, y, z)` for listener
    - Coordinate conversion: OpenRA WPos -> Howler {x, y, z} with Y-up to Z-forward convention
    - Format support: loads WebM (primary) and MP3 (fallback) via `Howl` constructor with `src: [webmUrl, mp3Url]`
    - Distance model: `inverse` (matching OpenAL's `AL_INVERSE_DISTANCE`), configurable `refDistance` and `maxDistance`

#### 3.4.2 Sound Manager

- [x] **TODO-7.D.2** `src/OpenRA.Game/Sound/Sound.ts` (481 lines C#) ✅ 已完成 (1,383行 TS) -- Central audio manager:
  - `Sound` class:
    - `soundEngine: ISoundEngine` -- injected dependency (DI), defaults to `WebAudioEngine`
    - `sounds: Map<string, ISoundSource>` -- loaded sound cache
    - `currentSounds: Map<number, ISound>` -- active sound instances tracked by ID
    - `currentNotifications: Map<string, ISound>` -- notification sounds (one-at-a-time per type)
    - Volume chain properties: `soundVolume: number` (0-1), `musicVolume: number` (0-1), `videoVolume: number` (0-1)
    - `soundVolumeModifier: number` -- temporary modifier (e.g., pause menu dimming)
    - `DisableWorldSounds: boolean` -- mutes World-type sounds (for minimap/replay)
  - Playback methods:
    - `play(type: SoundType, name: string, position?: WPos, volumeModifier?: number, pool?: string): ISound`
      - Loads sound source from cache or `soundEngine.addSoundSourceFromMemory()`
      - If `position` provided: calls `soundEngine.play3D()` for spatialized audio
      - If no `position`: calls `soundEngine.play2D()` for non-spatialized audio
      - Applies volume chain: `finalVolume = soundVolume * soundVolumeModifier * volumeModifier` (pool volume applied later)
      - Records in `currentSounds` map
    - `playPredefined(type: SoundType, rules: SoundRules, position?: WPos, volumeModifier?: number): ISound`
      - Sound pool management with `InterruptType`: `Overlap` (always play new), `Interrupt` (stop existing + play new), `DoNotPlay` (if playing, skip)
      - Uses `currentNotifications` for one-at-a-time notification enforcement
    - `stopSound(sound: ISound): void`
    - `setVolume(type: SoundType, volume: number): void` -- sets per-type volume (sound, music, video)
    - `setListenerPosition(position: WPos): void` -- called per-frame from camera update
    - `mute(): void` / `unmute(): void`
    - `dispose(): void` -- clears caches and disposes engine
  - `SoundType` enum: `World = 0`, `UI = 1`
  - `InterruptType` enum: `Overlap = 0`, `Interrupt = 1`, `DoNotPlay = 2`
  - `SoundPool` class:
    - Tracks active sound IDs per pool name
    - `add(name: string, sound: ISound, interruptType: InterruptType): void` -- enforces interrupt policy
    - `remove(sound: ISound): void`
    - `activeCount(name: string): number`
    - `volumeModifier: number` -- per-pool volume scaling

**Acceptance Criteria** (all met):
- ✅ `play(type, name)` loads and plays a 2D sound from cache with correct volume
- ✅ `play(type, name, position)` plays a 3D spatialized sound with correct position
- ✅ `setListenerPosition(position)` correctly updates listener and 3D sounds respond with distance attenuation
- ✅ `playPredefined()` with `Interrupt` stops existing sound and starts new one
- ✅ `playPredefined()` with `DoNotPlay` returns null if sound already playing
- ✅ Volume chain multiplication produces correct final volume for all layers
- ✅ `DisableWorldSounds = true` mutes only `World` type sounds, `UI` sounds continue playing
- ✅ Audio format fallback: WebM plays in Chrome/Firefox, MP3 fallback works in Safari
- ✅ Browser autoplay policy: audio unlocks on first user interaction via `Howler.autoUnlock`
- ✅ `dispose()` releases all Howl instances and AudioContext

**Actual Effort**: 1,652 lines implementation (Sound.ts 1,383 + SoundDevice.ts 269) + 1,921 test lines (Sound.test.ts 1,553 + SoundDevice.test.ts 368), 133 tests total. Completed 2026-06-12. Review: APPROVED. Commit `3f1b511`.

---

### 3.5 Phase E: Visual Effects

**Status**: ✅ 已完成 (2/2)
**Complexity**: MEDIUM
**Completed**: 2026-06-12
**Commits**: `a0bf835` (initial), `180e2a9` (review fixes)
**Review**: APPROVED (2 rounds)
**Implementation**: SpriteEffect.ts + FloatingSpriteEmitter.ts
**Tests**: 2 test files, 92 tests
**Blocked by**: `Animation.ts` (COMPLETE Ch2 -- sprite frame system for effect animation), `CoordinateTransformer.ts` (COMPLETE Ch4 Phase I -- WPos to Vector3 conversion)
**Blocks**: Phase F (Projectiles use effects infrastructure)

**Description**: Phase E migrates OpenRA's CPU-based sprite effects to Babylon.js GPU particle systems. `SpriteEffect` is the base visual effect class that plays a sprite animation at a position (static, following, or dynamic). `FloatingSpriteEmitter` is a trait that continuously emits floating sprite particles with configurable lifetime, frequency, gravity, and speed. The core paradigm shift is from CPU-driven per-frame sprite rendering to GPU-simulated particle systems with LOD management.

**Paradigm Shifts**:
- C# `SpriteEffect.Tick() + Render()` per-frame CPU update -> `ParticleSystem` auto-simulation on GPU
- C# `Animation` frame sequence for effect -> `ParticleSystem.particleTexture` + `textureMask` for sprite sheet animation
- C# `IEffect` + `ISpatiallyPartitionable` interfaces -> `ParticleSystem.emitter` positioning + Babylon.js built-in frustum culling
- C# `FloatingSpriteEmitter` CPU particle spawning -> `GPUParticleSystem` with `emitRate`, `maxLifeTime`, `gravity` parameters
- C# static/dynamic/follow position modes -> `ParticleSystem.emitter` as `Vector3` (static), updated per-frame (dynamic), or parented to `TransformNode` (follow)
- C# `BLENDMODE_ADD` / `BLENDMODE_STANDARD` -> Babylon.js `ParticleSystem.blendMode` (`ParticleSystem.BLENDMODE_ADD` / `BLENDMODE_STANDARD`)

#### 3.5.1 SpriteEffect (Particle Effect)

- [x] **TODO-7.E.1** `src/OpenRA.Mods.Common/Effects/SpriteEffect.ts` (86 lines C#) ✅ 已完成 -- Base visual effect:
  - `IEffect` interface (matching OpenRA contract): `tick(world: World): void`, `render(worldRenderer: WorldRenderer): void`
  - `SpriteEffect` class implementing `IEffect`:
    - `position: WPos | (() => WPos)` -- static position or dynamic position function
    - `followActor: GameActor | undefined` -- actor to follow
    - `animation: Animation` -- the sprite animation to play (reuses existing Animation.ts from Ch2)
    - `visible: boolean`
    - `delay: number` -- ticks to wait before starting
    - `tick(world: World): void`
      - Decrements delay if > 0
      - Calls `animation.tick()` to advance frame
      - Updates position if dynamic: resolves `Func<WPos>` or follows actor's position
      - Removes self from world effect list when animation completes (if not looping)
    - `render(worldRenderer: WorldRenderer): void`
      - Gets current frame sprite from animation
      - Converts position to 3D world coordinates via `CoordinateTransformer`
      - Renders sprite as billboard at position OR dispatches to particle system
    - `dispose(): void`
  - `ParticleEffectManager` class (new, no C# equivalent):
    - Registry mapping effect type names to `ParticleSystem` configurations
    - `playEffect(type: string, position: Vector3, config?: EffectConfig): ParticleSystem`
    - Pre-configured effect templates: `"explosion"`, `"smoke"`, `"fire"`, `"spark"`, `"debris"`
    - Uses `ParticleHelper.CreateAsync()` for common effect types
    - Distance-based LOD: within 50 units: full particles; 50-100: 50% emitRate; 100-200: 20% emitRate; >200: no particles
    - `disposeEffect(ps: ParticleSystem): void` -- stops emission and schedules cleanup after remaining particles die

#### 3.5.2 FloatingSpriteEmitter

- [x] **TODO-7.E.2** `src/OpenRA.Mods.Common/Traits/Render/FloatingSpriteEmitter.ts` (126 lines C#) ✅ 已完成 -- Particle emitter trait:
  - `FloatingSpriteEmitter` class:
    - Emitter configuration properties:
      - `image: string` -- sprite sheet path (maps to `particleTexture`)
      - `sequences: string[]` -- animation sequences to randomly select from
      - `palette: string` -- color palette name
      - `lifetime: number` -- particle lifespan in ticks (maps to `maxLifeTime`)
      - `spawnFrequency: number` -- particles emitted per second (maps to `emitRate`)
      - `speed: number` -- initial particle speed (maps to `emitPower`)
      - `speedRange: WDist` -- random speed variation
      - `gravity: number` -- downward acceleration (maps to `gravity` in particle system)
      - `turnRate: number` -- random rotation speed
      - `randomRate: number` -- random movement variation
      - `offset: WVec` -- emitter position offset from actor
      - `spawnRadius: WDist` -- emission area radius
      - `burstSize: number` -- particles per burst (1 for continuous, >1 for burst)
    - `emitParticles(): void`
      - Creates or configures `Babylon.ParticleSystem` with emission parameters
      - Attaches emitter to actor's `TransformNode`
      - Configures `ParticleSystem` properties: `createSphereEmitter(spawnRadius)`, `minEmitBox/maxEmitBox` for box emission, `direction1/direction2` for spread control
      - Sets color gradient from palette, size range, and texture from image/sequence
    - `tick(): void` -- updates emission state (start/stop based on conditions)
    - `dispose(): void` -- disposes particle system
  - **GPU optimization**: Use `GPUParticleSystem` for all emitter instances (Babylon.js v7.0+ defaults to GPU when supported). Provide CPU fallback for compatibility testing.
  - **Particle pooling**: Pre-create a pool of 10 `ParticleSystem` instances and recycle them for different effects, avoiding runtime construction/destruction overhead.

**Acceptance Criteria** (all met):
- ✅ `SpriteEffect` plays a sprite animation at a static position and renders as a billboard
- ✅ `SpriteEffect` follows an actor as it moves across the map
- ✅ Dynamic position mode correctly evaluates the position function each frame
- ✅ `FloatingSpriteEmitter` continuously emits particles with correct rate, lifetime, and gravity
- ✅ Emitter correctly follows its parent actor via `TransformNode` parenting
- ✅ Distance-based LOD reduces particle emission rate according to configured thresholds
- ✅ Particle pooling recycles `ParticleSystem` instances without memory leaks
- ✅ Common effect templates (explosion, smoke, fire) produce visually acceptable results at 60fps

**Actual Effort**: Implementation + 92 tests (2 test files). Completed 2026-06-12. Review: APPROVED (2 rounds). Commits `a0bf835`, `180e2a9`.

---

### 3.6 Phase F: Projectiles

**Status**: 📋 待迁移 (0/1)
**Complexity**: HIGH
**Blocked by**: Phase E (Effects infrastructure for trail/impact effects), `CoordinateTransformer.ts` (COMPLETE Ch4 Phase I), `Animation.ts` (COMPLETE Ch2)
**Blocks**: Nothing (leaf phase)

**Description**: Phase F migrates the `Bullet` projectile class -- the most commonly used projectile type in OpenRA. The migration separates the visual representation (TrailMesh for contrails, Sprite for the projectile body) from the logic layer (trajectory update, collision detection). Trajectory computation (gravity-affected arc or straight line) stays in the game logic layer; visual effects use Babylon.js GPU-accelerated `TrailMesh` and ray-based collision detection replaces 2D grid queries.

**Paradigm Shifts**:
- C# `Bullet.Tick()` CPU trajectory + position update -> TypeScript `Projectile.tick()` logic update + `TransformNode.position` for visual
- C# CPU-generated contrail line segments -> `TrailMesh` GPU-generated dynamic strip geometry attached to projectile TransformNode
- C# 2D grid-based collision detection -> `scene.pickWithRay()` raycast along projectile movement direction
- C# `Render()` draws shadow + trail + body in Z-order -> `ShadowGenerator` (shadow) + `TrailMesh` (trail) + `Sprite`/`Mesh` (body) with renderingGroupId layers
- C# `Missile` homing algorithm (`Vector3.Lerp` turning) -> inherited in logic layer, visual uses `TransformNode.lookAt()` for orientation

#### 3.6.1 Bullet Projectile

- [ ] **TODO-7.F.1** `src/OpenRA.Mods.Common/Projectiles/Bullet.ts` (397 lines C#) -- Bullet projectile:
  - `IProjectile` interface (extends `IEffect`): `tick(world: World): void`, `render(worldRenderer: WorldRenderer): void`, `isDestroyed: boolean`
  - `Bullet` class implementing `IProjectile`:
    - Constructor parameters:
      - `source: WPos` -- firing position
      - `target: WPos` -- target position (or `Target` for homing)
      - `speed: WDist` -- projectile speed per tick
      - `gravity: number` -- gravity factor (0 = straight line)
      - `launchAngle: WAngle` -- initial launch angle for arcing shots
      - `inaccuracy: WDist` -- random spread radius
    - Visual properties:
      - `image: string` -- projectile sprite
      - `shadow: boolean` -- render shadow via `ShadowGenerator`
      - `trailImage: string` -- trail sprite/texture
      - `contrailLength: number` -- trail persistence in world units (maps to `TrailMesh` length)
      - `contrailWidth: WDist` -- trail ribbon width
      - `contrailColor: Color` -- trail tint
      - `palette: string` -- color palette for projectile body
    - `tick(world: World): void`
      - Calculates new position: `pos += velocity * tickScale`, applies gravity to velocity Y component
      - Updates `TransformNode.position` for visual sync
      - Checks collision: creates ray from previous position to new position, calls `scene.pickWithRay()` to detect terrain or actor hit
      - On collision: triggers impact effect, marks `isDestroyed = true`
      - On out-of-bounds: marks `isDestroyed = true`
    - `render(worldRenderer: WorldRenderer): void`
      - Body: billboard `Sprite` at `TransformNode.position` with current frame from animation
      - Shadow: `ShadowGenerator` renders simple dark ellipse on terrain (or uses `Decal` for permanent scorch marks)
      - Contrails: `TrailMesh` bound to the projectile's `TransformNode` with configurable width and color
    - `dispose(): void` -- disposes Sprite, TrailMesh, ShadowGenerator
  - `ProjectileFactory` class (new, no C# equivalent):
    - Static factory methods for common projectile types:
      - `createBullet(config: BulletConfig): Bullet`
      - `createMissile(config: MissileConfig): Missile` (future phase)
      - `createLaser(config: LaserConfig): LaserZap` (future phase)
    - Projectile pooling: pre-create and recycle projectile instances to avoid GC pressure during combat
    - `activeProjectiles: Set<IProjectile>` -- registry for batch update and disposal

**Acceptance Criteria**:
- Straight-line bullet travels from source to target at correct speed
- Arcing bullet follows parabolic trajectory with correct gravity effect
- Collision detection correctly identifies terrain hits along the projectile's path
- `TrailMesh` generates smooth trailing geometry that follows the projectile
- `ShadowGenerator` renders a correct ground shadow at the projectile's projected position
- On impact, the projectile triggers an effect and marks itself as destroyed
- Projectile pooling recycles instances without visual artifacts or memory leaks
- Performance: 200 simultaneous bullets maintain 60fps (GPU-accelerated trails)

**Estimated Effort**: ~800 lines implementation + ~500 lines test (3 developer-days)

---

### 3.7 Phase G: Sprite Rendering Traits

**Status**: 📋 待迁移 (0/2)
**Complexity**: MEDIUM (RenderSprites), LOW (WithIdleOverlay)
**Blocked by**: `Animation.ts` (COMPLETE Ch2 -- sprite animation engine), `Palette.ts` / `PaletteReference.ts` (COMPLETE Ch2 -- color palette), `Actor.ts` (COMPLETE Ch3 Phase D -- GameActor)
**Blocks**: Nothing (leaf phase)

**Description**: Phase G migrates the two core sprite rendering traits that control how actors display their visual representation. `RenderSprites` is the base trait managing sprite image assignment, palette selection, faction-specific overrides, and render scaling. `WithIdleOverlay` extends this with independent overlay animations (e.g., rotating radar dishes, waving flags) that render on top of the base sprite. The migration maps these to Babylon.js `SpriteManager` and `Sprite` for the base rendering, and Billboard-attached `Sprite` or `Decal` for overlays.

**Paradigm Shifts**:
- C# `RenderSprites` Trait managing `AnimationWithOffset` list -> `SpriteManager` + `Sprite` with per-actor sprite instances
- C# `Image` property (sprite sheet selection) -> `SpriteManager` texture path + runtime sprite sheet switching
- C# `FactionImages` (faction-specific sprite overrides) -> runtime `sprite.texture` swap based on faction
- C# `Scale` (render size) -> `sprite.size` or `mesh.scaling` vector
- C# `Palette` + `PlayerPalette` -> `sprite.color` tint + material color properties
- C# `WithIdleOverlay` independent Animation + ZOffset -> Billboard `Sprite` child of actor TransformNode
- C# `SpriteRenderable.Render()` CPU tint calculation -> GPU shader tint via `sprite.color` / material properties
- C# `IPalettedRenderable` interface -> TypeScript `IRenderable` interface with `render()` and `palette` properties

#### 3.7.1 RenderSprites Trait

- [ ] **TODO-7.G.1** `src/OpenRA.Mods.Common/Traits/Render/RenderSprites.ts` (302 lines C#) -- Base sprite rendering trait:
  - `RenderSprites` class:
    - `image: string` -- sprite sheet identifier (maps to `SpriteManager` name)
    - `factionImages: Map<string, string>` -- faction-specific sprite sheet overrides
    - `palette: PaletteReference` -- color palette reference
    - `playerPalette: string` -- player-color palette name
    - `scale: number` -- render scale factor (maps to `sprite.size`)
    - `animations: Map<string, AnimationWithOffset>` -- registered animation instances
    - Methods:
      - `add(animName: string, animation: AnimationWithOffset): void` -- registers an animation
      - `remove(animName: string): void` -- unregisters an animation
      - `getImage(faction?: string): string` -- resolves sprite sheet with faction override
      - `tick(): void` -- calls `tick()` on all registered animations
      - `render(worldRenderer: WorldRenderer): void` -- iterates animations and renders each via `SpriteManager`
      - `dispose(): void` -- removes all sprites from `SpriteManager`
    - Integration with `SpriteManager`:
      - Each `RenderSprites` trait registers its sprites with the global `SpriteManager` for its sprite sheet
      - The `SpriteManager` handles batch rendering of all sprites sharing the same texture
      - Per-sprite customization (tint, scale, frame) is set on individual `Sprite` instances
  - `AnimationWithOffset` class (already partially in Animation.ts, extend):
    - `animation: Animation` -- the animation instance
    - `offset: () => WVec` -- dynamic offset function (for turrets, attachments)
    - `zOffset: number` -- Z-offset for rendering order
    - `tick(): void` -- delegates to `animation.tick()`
    - `render(actor: GameActor, worldRenderer: WorldRenderer): void` -- renders animation at actor position + offset
  - `SpriteRenderable` class:
    - `render(worldRenderer: WorldRenderer): void`
      - Gets current sprite frame from `Animation`
      - Applies player color via palette lookup (delegates to `HardwarePalette` / `PlayerColorRemap` from Ch2)
      - Calculates tint: `alpha * tint * terrainLighting.tintAt(pos)`
      - Sets `sprite.color` and renders via `SpriteManager`
    - `dispose(): void`

#### 3.7.2 WithIdleOverlay Trait

- [ ] **TODO-7.G.2** `src/OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.ts` (124 lines C#) -- Idle overlay animation:
  - `WithIdleOverlay` class:
    - `image: string` -- overlay sprite sheet (defaults to actor's base image)
    - `sequence: string` -- animation sequence name
    - `palette: string` -- overlay palette
    - `zOffset: number` -- Z-axis offset for rendering order
    - `requiresCondition: string` -- condition token for enabling/disabling the overlay
    - Methods:
      - `tick(): void` -- checks condition, creates/updates/destroys overlay animation
      - `render(worldRenderer: WorldRenderer): void` -- renders overlay as billboard sprite
      - `dispose(): void`
    - 3D implementation approach (billboard):
      - Creates a child `Sprite` attached to the actor's `TransformNode` with `BillboardMode.ALL`
      - Overlay sprite is rendered on top of base sprite via `renderingGroupId` or explicit Z-offset
      - When condition is disabled, the overlay sprite is hidden (`.isVisible = false`)
    - Alternative approach (decal):
      - For static/semi-static overlays (e.g., building emblems), use `Babylon.Decal` projected onto the actor's mesh
      - Decal provides better visual integration with 3D surfaces
      - Billboard is preferred for dynamic overlays (rotating radar, flags) that need constant camera-facing orientation

**Acceptance Criteria**:
- `RenderSprites` correctly registers sprites with `SpriteManager` and renders them with correct palette tinting
- Faction-specific image overrides correctly switch sprite sheets at runtime
- Animation offset functions correctly position sprites relative to actor position
- `WithIdleOverlay` creates a billboard sprite that renders on top of the base actor sprite
- Billboard overlay correctly follows the parent actor and faces the camera
- Condition tokens enable/disable the overlay without memory leaks
- Per-frame performance: 1000 actors with `RenderSprites` render at 60fps via `SpriteManager` batching

**Estimated Effort**: ~800 lines implementation + ~500 lines test (2-3 developer-days for the pair)

---

## 4. Dependency Graph

### 4.1 Phase Dependency Flow

```
Chapter 6 (Network)     Chapter 5 (UI)      Chapter 4 (Map)      Chapter 3 (Actor)      Chapter 2 (Rendering)
      |                       |                     |                     |                      |
      |   Order.ts            |   Widget.ts         |   Map.ts            |   WPos/CVec/CPos     |   Animation.ts ✓
      |   UnitOrders.ts       |   WidgetLoader.ts   |   TerrainMesh       |   Actor.ts           |   WorldRenderer.ts ✓
      |   Connection.ts       |   WICW.ts ✓         |   CoordTransform    |   World.ts           |   Palette.ts
      |   OrderManager.ts     |   Chrome*.ts        |                     |   Player.ts          |   Sheet.ts
      v                       v                     v                     v                      v
+----------------------------------------------------------------------------------------------------+
|                                       Chapter 7 -- DESIGN PHASE                                   |
+----------------------------------------------------------------------------------------------------+
                                              |
    +-----------------------------------------+-----------------------------------------+
    |                  |                  |                  |                  |
    v                  v                  v                  v                  v
Phase A           Phase B            Phase C           Phase D           Phase E
Input             Camera             Selection         Audio             Effects
Foundation        System             System            System            & Emitters
(3 files)         (2 files)          (1 file)          (2 files)         (2 files)
LOW-MED           HIGH-MED           MED               MED               MED
    |                  |                  |                                   |
    v                  v                  |                                   v
    +-------+----------+                  |                              Phase F
    |                                  |                              Projectiles
    v                                  |                              (1 file)
Phase B                               |                              HIGH
Camera                                |
    |                                  |
    +----------+-----------------------+---------+
               |                                 |
               v                                 v
          Phase C                           Phase G
          Selection                         Sprite Traits
          (1 file)                          (2 files)
          MED                               MED-LOW
               |                                 |
               v                                 v
    +----------+-----------+          +----------+----------+
    |                      |          |                     |
WorldInteraction       UnitOrders     RenderSprites     WithIdleOverlay
ControllerWidget ✓     (Ch6)          (sprite base)     (billboard overlay)
(Ch5, already done)
```

### 4.2 Internal Dependencies

| Phase | Depends On | Needed For |
|:---|:---|:---|
| **Phase A** | Nothing | Keyboard/mouse event dispatch to all Widgets |
| **Phase B** | Phase A (input events), WorldRenderer.ts (Ch2) | Camera movement, edge scrolling, zoom |
| **Phase C** | Phase B (camera transforms), WorldInteractionControllerWidget (Ch5) | Unit selection algorithms |
| **Phase D** | Coordinate types (Ch3), FileSystem (Ch5) | Sound loading and 3D spatial playback |
| **Phase E** | Animation.ts (Ch2), CoordinateTransformer (Ch4) | Visual effect particle systems |
| **Phase F** | Phase E (effects), CoordinateTransformer (Ch4) | Projectile rendering and collision |
| **Phase G** | Animation.ts (Ch2), Palette.ts (Ch2), Actor.ts (Ch3) | Actor sprite rendering |

### 4.3 External Dependencies (npm packages)

| Package | Version | Phase | Purpose |
|:---|:---|:---|:---|
| `howler` | ^2.2 | D | 3D spatial audio with Web Audio API backend |
| `@babylonjs/core` | ^9.10.1 | All | Already installed -- DeviceSourceManager, ArcRotateCamera, ParticleSystem, TrailMesh |

### 4.4 Parallelizable Phases

The following phases have no mutual dependencies and can be developed in parallel:

| Parallel Group | Phases | Rationale |
|:---|:---|:---|
| **Group 1** | Phase A + Phase D | Input and Audio have zero mutual dependencies |
| **Group 2** | Phase E + Phase G | Effects and Sprite Traits share Animation dependency but are otherwise independent |
| **Group 3** | Phase B -> Phase C | Camera must complete before Selection (sequential) |
| **Group 4** | Phase F | Depends on Phase E completion (sequential after Group 2) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing (Vitest + happy-dom)

| Phase | Test Strategy | Estimated Tests | Key Test Fixtures |
|:---|:---|:---:|:---|
| **Phase A** | Mock `DeviceSourceManager`; verify event translation and dispatch; verify `NullInputHandler` no-ops; verify `KeyCode` mapping completeness | ~30 | Mock DSM, Mock Scene |
| **Phase B** | Mock `ArcRotateCamera` + `Engine`; verify `viewToWorldPx()` math; verify zoom clamp; verify `adjustZoom(center)` preserves world position under cursor; verify boundary clamp in all 8 directions | ~35 | Mock Camera, Mock Engine, Mock Scene |
| **Phase C** | Mock `Scene` + `Camera`; verify ray-pick returns correct actor; verify frustum construction from 4 screen corners; verify deadzone threshold; verify priority algorithm ordering | ~25 | Mock Scene, Mock Mesh, Mock GameActor array |
| **Phase D** | Mock `howler`; verify `play()`/`play3D()` calls; verify volume chain multiplication; verify `Interrupt`/`DoNotPlay` pool behavior; verify `setListenerPosition()` | ~30 | Mock Howl, Mock Howler, pre-loaded ArrayBuffer |
| **Phase E** | Mock `ParticleSystem`; verify effect creation with correct parameters; verify emitter position modes; verify LOD distance thresholds; verify pooling recycle | ~20 | Mock ParticleSystem, Mock Scene |
| **Phase F** | Mock `TrailMesh` + `ParticleSystem`; verify trajectory math; verify collision detection raycast; verify projectile lifecycle (spawn -> travel -> impact -> destroy) | ~25 | Mock Scene, Mock Mesh, pre-defined source/target positions |
| **Phase G** | Mock `SpriteManager` + `Sprite`; verify image resolution with faction overrides; verify animation registration; verify overlay billboard creation; verify condition toggle | ~20 | Mock SpriteManager, Mock Sprite, Mock GameActor |

### 5.2 Manual Visual Acceptance Tests

These modules require visual verification beyond unit testing:

| Module | Test Case | What to Verify | Location |
|:---|:---|:---|:---|
| **Camera** | Camera modes, zoom, scroll | Ortho/perspective toggle; zoom-to-cursor accuracy; edge scroll smoothness; boundary clamping; bookmark save/restore | `src/__e2e__/manual/camera/camera-controls/` |
| **Selection** | Box select, point select | Selection rectangle rendering; multi-unit box selection accuracy; behind-terrain unit handling; modifier-key multi-select | `src/__e2e__/manual/camera/selection-test/` |
| **Audio** | 3D spatial audio, volume | Sound attenuation with distance; stereo panning accuracy; volume slider responsiveness; format fallback | `src/__e2e__/manual/audio/spatial-audio/` |
| **Effects** | Explosion, smoke, fire | Particle appearance; lifetime and fade; LOD transition; emitter follow behavior | `src/__e2e__/manual/effects/particle-effects/` |
| **Projectiles** | Bullet arc, trail, impact | Trajectory visualization; TrailMesh appearance; shadow projection; impact effect triggering; 200-bullet stress test | `src/__e2e__/manual/effects/projectile-trails/` |

### 5.3 Integration Test Scenarios

1. **Input -> Camera -> Selection chain**: Press arrow key -> camera scrolls -> drag select -> units highlighted. Verify end-to-end.
2. **Audio -> Effects chain**: Fire weapon -> sound plays at correct 3D position -> muzzle flash effect emits -> projectile travels with trail -> impact effect + sound.
3. **Camera + Selection stress**: 1000 units on screen, perform box selection. Verify < 16ms frame time.
4. **Camera bounds**: Continuous edge scroll against all 4 map edges. Verify camera never leaves map bounds.

---

## 6. Risk and Considerations

### 6.1 High-Risk Items

| Risk | Severity | Mitigation |
|:---|:---:|:---|
| **Browser autoplay policy blocking audio** (AudioContext suspended until user gesture) | HIGH | Use `Howler.autoUnlock = true`; require user click/tap before any game audio starts; show "Click to start" overlay; test on Chrome, Firefox, Safari, mobile |
| **Audio format compatibility** (WebM not supported on Safari/iOS) | HIGH | Encode all audio as both WebM (Vorbis) and MP3; Howler.js auto-selects first supported format; build-time conversion script |
| **Camera coordinate mismatch** (LH vs RH, Z-up vs Y-up) | HIGH | Thoroughly validate all coordinate transforms against known OpenRA screen positions; use the existing `CoordinateTransformer.ts` bridge; manual visual verification of cursor-to-world alignment |
| **Particle system performance** (too many simultaneous emitters) | MEDIUM | Implement distance-based LOD (50/100/200 unit tiers); particle pooling with max 20 concurrent systems; `GPUParticleSystem` with CPU fallback; stress test with 50+ simultaneous explosions |
| **Box selection inaccuracies in perspective mode** (near units appear larger, far units smaller on screen) | MEDIUM | Use bounding box projection test (project AABB to screen, intersect with selection rectangle) rather than frustum-only test; provide orthographic mode as default |
| **Keycode completeness** (230+ SDL keys vs browser-available codes) | LOW | Map SDL codes to `KeyboardEvent.code`; document unavailable keys (print screen, pause, etc.); provide fallback mapping for keys that differ between browsers |
| **Howler.js 3D audio precision** (position updates at 20 TPS may cause audio stuttering) | LOW | Use `Howler.pos()` for listener position updates at 20 TPS; Howler internally smooths position changes; test with fast-moving sound sources |

### 6.2 Browser-Specific Considerations

| Concern | Details | Affected Browsers |
|:---|:---|:---|
| WebM audio support | Chrome, Firefox, Edge support WebM; Safari does not. Need MP3 fallback | Safari, iOS Safari |
| `passive: false` for scroll | Some browsers ignore `preventDefault()` on passive listeners; must register with `{ passive: false }` explicitly | Chrome 51+, Firefox 49+ |
| Fullscreen API | `element.requestFullscreen()` requires user gesture; F11 is browser-reserved | All |
| Gamepad support | `DeviceSourceManager` supports gamepads; Babylon.js v8.0+ has improved gamepad API. Test Xbox/PlayStation controllers | Chrome, Firefox, Edge |
| AudioContext resume | Must call `audioContext.resume()` in user gesture handler; Howler.autoUnlock handles this automatically | All |

### 6.3 Deferred Items

The following files from the broader Effects and Projectiles directories are deferred to future phases:

| File | Reason for Deferral |
|:---|:---|
| `Missile.cs` (410 lines) | Homing algorithm + turning logic. Depends on Bullet base and target tracking. |
| `LaserZap.cs` (120 lines) | Laser beam rendering. Uses `BABYLON.LinesMesh` or `Ribbon`. Simple but needs Bullet pattern first. |
| `Railgun.cs` (200 lines) | Extended bullet with spiral particle effect. Can reuse Bullet + custom emitter. |
| `GravityBomb.cs` (110 lines) | Parabolic bomb. Similar to Bullet but starts from aircraft. |
| `InstantHit.cs` (160 lines) | Hitscan weapon. Uses raycast only (no projectile mesh). |
| `NukeLaunch.cs` (120 lines) | Delayed effect + camera shake. Complex orchestration. |
| `AreaBeam.cs` (100 lines) | Area-denial beam effect. Continuous trail rendering. |
| `FloatingText.cs` | Damage numbers / text effects. Billboard text sprites. |
| `FlashTarget.cs` | Screen flash effect. Post-processing overlay. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-7.1: Howler.js over Raw Web Audio API

**Date**: 2026-06-12
**Status**: ACCEPTED

**Decision**: Use Howler.js as the primary audio abstraction layer, with direct Web Audio API access reserved for advanced audio graph scenarios (custom EQ, reverb chains).

**Rationale**:
- Howler.js provides automatic browser autoplay policy handling (`Howler.autoUnlock`)
- Built-in 3D spatial audio with `howl.pos()` matching OpenAL's Listener/Source model
- Automatic audio format fallback (WebM/MP3) without manual detection
- Simpler API surface reduces migration complexity (46-line `ISoundEngine` interface maps directly)
- Web Audio API raw access available via `Howler.ctx` for advanced audio graph use cases

**Trade-offs**:
- Adds ~30KB gzipped dependency (acceptable for a game)
- Slightly less control over individual `AudioNode` routing (mitigated by `Howler.ctx` escape hatch)
- Howler.js 3D spatial model uses `HRTF` by default; OpenRA/OpenAL used simple stereo panning. Test for consistency.

### ADR-7.2: ArcRotateCamera -- Orthographic Mode as Default

**Date**: 2026-06-12
**Status**: ACCEPTED

**Decision**: Default camera mode is `ORTHOGRAPHIC_CAMERA` with `beta = PI/3` (60-degree tilt). `PERSPECTIVE_CAMERA` is available as a player toggle in settings.

**Rationale**:
- Maintains traditional RTS feel for existing OpenRA players
- Eliminates perspective distortion in box selection accuracy
- Orthographic projection naturally matches OpenRA's 2D rendering expectation
- Perspective mode provides optional 3D immersive view for players who prefer it

**Technical notes**:
- Ortho zoom modifies `orthoTop/Bottom/Left/Right` maintaining aspect ratio
- Perspective zoom modifies `radius` with `zoomToMouseLocation = true`
- Both modes share the same `camera.target` (map center) and boundary clamping logic
- ArcRotateCamera must use `alpha = -PI/2` (camera on -Z side) to satisfy Babylon.js LH coordinate constraint (validated in existing `Viewport.ts` header)

### ADR-7.3: Billboard over Decal for Overlay Rendering

**Date**: 2026-06-12
**Status**: ACCEPTED

**Decision**: Use Billboard (`BillboardMode.ALL`) for `WithIdleOverlay` animations. Reserve Decal for static or semi-static overlays (building emblems, scorch marks).

**Rationale**:
- Billboard automatically faces the camera every frame with zero CPU intervention
- Overlays like radar dishes and flags are dynamic (rotate/move), unsuitable for static decals
- Decals project onto 3D surfaces and would distort when the underlying mesh is animated
- Billboard sprites integrate naturally with the existing `SpriteManager` batch rendering system

**Trade-offs**:
- Billboard sprites are always 2D in appearance (flat planes facing camera) -- acceptable for idle overlays designed as 2D sprites
- Decals produce better visual integration with 3D terrain for static markings (future use case: scorch marks, blood splatters)

### ADR-7.4: Particle System LOD Strategy

**Date**: 2026-06-12
**Status**: ACCEPTED

**Decision**: Implement a three-tier distance-based LOD system for all particle effects:
- Tier 1 (0-50 world units): Full particles, 100% emitRate
- Tier 2 (50-100 world units): Reduced particles, 50% emitRate
- Tier 3 (100-200 world units): Minimal particles, 20% emitRate
- Beyond 200 world units: Stop emission, recycle particle system

**Rationale**:
- Dramatic performance improvement for large battles with many simultaneous effects
- Beyond 200 units, individual particles are too small to be visually meaningful
- Tiers are configurable per-effect type (large explosions may use wider tiers)
- Matches standard RTS optimization practice (e.g., StarCraft 2, Company of Heroes)

**Implementation**: `ParticleEffectManager.playEffect()` accepts an optional `lodConfig` parameter. Default tiers applied when not specified. LOD evaluation happens once per second (not every frame) via a distance check against the active camera position.

### ADR-7.5: TrailMesh for Projectile Trails (not Custom Mesh)

**Date**: 2026-06-12
**Status**: ACCEPTED

**Decision**: Use Babylon.js `TrailMesh` for projectile contrails and trails. Do not use custom Mesh with manual vertex updates.

**Rationale**:
- `TrailMesh` is purpose-built for dynamic trail rendering with built-in length/width control
- GPU-side geometry generation -- no CPU vertex buffer updates per frame
- Automatic UV mapping along the trail for texture tiling
- Configurable `diameter` function for variable trail width
- Significant performance advantage over CPU-driven vertex buffer updates

**Trade-offs**:
- `TrailMesh` has fixed maximum segment count (configurable at creation); very long trails may need segment recycling
- `TrailMesh` trails are always ribbon-like (good for bullets, less ideal for laser beams -- use `LinesMesh` for lasers)

### ADR-7.6: Phase Ordering -- Camera before Selection

**Date**: 2026-06-12
**Status**: ACCEPTED

**Decision**: Phase B (Camera) must complete before Phase C (Selection), enforced by the dependency graph. Audio (Phase D) and Input (Phase A) can proceed in parallel with Camera.

**Rationale**:
- Selection algorithms depend on camera's `viewToWorldPx()` and projection/unprojection pipeline
- Camera coordinate transforms must be validated before selection math can be trusted
- Audio and Input have zero mutual dependencies -- parallel development reduces wall-clock time
- Effects (Phase E) and Sprite Traits (Phase G) are also parallelizable with Camera/Selection

---

> **Next Steps**:
> 1. Architect reviews this plan and validates the phase ordering and dependency graph
> 2. Team Lead assigns Phase A (Input Foundation) to migration-develop
> 3. Phase D (Audio System) can begin in parallel with Phase A
> 4. External npm dependency (`howler`) should be installed before Phase D begins
>
> **Related Documents**:
> - [OpenRA Architecture Analysis §8](openra_migration.agent.final.converted.md) -- lines 1056-1264
> - [Chapter 6 Migration Plan](network_sync_migration_plan.md) -- prerequisite chapter
> - [Chapter 5 Migration Plan](ui_system_migration_plan.md) -- WorldInteractionControllerWidget already migrated here
> - [Migration Progress Tracker](migration_progress.md) -- overall project progress
