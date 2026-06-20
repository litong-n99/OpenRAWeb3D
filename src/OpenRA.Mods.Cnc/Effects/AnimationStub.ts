/**
 * AnimationStub.ts — shared animation stub for C&C projectiles and effects
 * OpenRA 对照: OpenRA.Graphics.Animation
 *
 * 核心范式转换:
 * - C# Animation (2D sprite sequence with palette, ticks, rendering)
 *   → TypeScript frame-accurate animation with Babylon.js Mesh-backed rendering
 * - C# Animation.Render(WPos, PaletteReference)
 *   → TypeScript render() creates/updates Mesh plane + UV per-frame
 * - C# Animation.RenderUI(WorldRenderer, int2, WVec, int, PaletteReference)
 *   → TypeScript renderUI() for UI-space overlay rendering
 *
 * Replaces duplicated AnimationStub in TeslaZap, IonCannon, DropPodImpact,
 * SatelliteLaunch, ConyardChronoVortex, GpsDotEffect, and other C&C effects.
 *
 * KEYSTONE for Phase B: This single file unblocks ALL C&C effect rendering.
 * Each downstream consumer remains zero-change — the API surface is preserved.
 *
 * Ch24 Phase A: Material Integration
 * - No-material meshes → ShaderMaterial with Sheet texture + per-frame UV uniform
 * - Evenly-spaced strip UV → explicit frameUVs[] resolution from Sheet/Sprite
 * - No render pipeline → renderingGroupId + scene attachment
 */

import {
  MeshBuilder,
  ShaderMaterial,
  StandardMaterial,
  Color3,
  Vector4,
  Constants,
  type Mesh,
  type Scene,
} from '@babylonjs/core'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { RenderGroup } from '../../OpenRA.Game/Graphics/WorldRenderer.js'
import type { Sheet } from '../../OpenRA.Game/Graphics/Sheet.js'

// ---------------------------------------------------------------------------
// Shader sources (pre-compiled GLSL for WebGL 2.0 / GLSL ES 3.0)
// ---------------------------------------------------------------------------

/** Vertex shader: pass-through position + UV with standard worldViewProjection.
 *
 * Uses Babylon.js standard attribute names (position, uv) so it works with
 * any Mesh created by MeshBuilder.
 */
const SPRITE_VERTEX_SHADER = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;

void main(void) {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vUV = uv;
}
`

/** Fragment shader: sample a sub-region of the sprite sheet texture.
 *
 * uFrameUV = vec4(uMin, vMin, uMax, vMax) selects the current frame's
 * UV rectangle within the atlas texture.
 *
 * Uses GLSL ES 1.0 built-ins (gl_FragColor, texture2D) for compatibility
 * with Babylon.js ShaderMaterial which wraps these for WebGL 2.0.
 */
const SPRITE_FRAGMENT_SHADER = /* glsl */`
precision highp float;
varying vec2 vUV;
uniform sampler2D uTexture;
uniform vec4 uFrameUV;

void main(void) {
    vec2 uv = vec2(
        mix(uFrameUV.x, uFrameUV.z, vUV.x),
        mix(uFrameUV.y, uFrameUV.w, vUV.y)
    );
    gl_FragColor = texture2D(uTexture, uv);
}
`

// ---------------------------------------------------------------------------
// AnimationStub
// OpenRA 对照: Animation (OpenRA.Graphics)
// ---------------------------------------------------------------------------

/** Shared animation for C&C effects.
 *
 * OpenRA 对照: Animation
 *
 * Tracks frame advancement with configurable ticks-per-frame, fires
 * callbacks on completion, and creates Babylon.js Mesh planes with UV
 * updates for sprite-rendered animation.
 *
 * API surface is identical to the original stub — downstream consumers
 * require zero changes.
 *
 * Ch24 Phase A: Assigns a ShaderMaterial with sheet texture on first
 * render, integrates with Sheet/Sprite UV resolution, and registers
 * meshes in the WorldRenderer render pipeline via renderingGroupId.
 *
 * Consumers must call `tick()` in their own `ITick.tick()` method each
 * game tick. The optional `registerWithWorld()` convenience method
 * subscribes tick to a world tick callback.
 */
export class AnimationStub {
  /** The image/collection name this animation uses.
   *
   * OpenRA 对照: Animation.Image
   */
  readonly image: string

  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------

  /** Total elapsed game ticks (advances on each tick() call). */
  private _ticks: number = 0

  /** Total frame count for the current sequence. */
  private _length: number

  /** Number of game ticks per animation frame (configurable). */
  private readonly _tickPerFrame: number

  /** Completion callback — invoked after the last frame finishes. */
  private _onComplete: (() => void) | null = null

  /** Whether the animation has been started. */
  private _started: boolean = false

  /** Name of the currently playing sequence. */
  private _sequence: string = ''

  /** Whether the animation loops (playRepeating). */
  private _repeating: boolean = false

  /** Current logical frame index (0-based, advances every tickPerFrame ticks). */
  private _frame: number = 0

  /** Whether the completion callback has been fired (prevents double-fire). */
  private _completed: boolean = false

  // -----------------------------------------------------------------------
  // Ch24 Phase A: Material + texture resources
  // -----------------------------------------------------------------------

  /** Optional Sheet providing the GPU texture atlas.
   *
   * When set, the ShaderMaterial samples this sheet's texture. When null,
   * a magenta debug StandardMaterial is used as fallback.
   */
  private _sheet: Sheet | null = null

  /** Per-frame UV rectangles [uMin, vMin, uMax, vMax] in 0..1 texture space.
   *
   * Array length should match `_length`. Each element is a Float32Array(4).
   * When null, evenly-spaced horizontal strip UVs are used as fallback.
   */
  private _frameUVs: Float32Array[] | null = null

  /** Babylon.js Scene for material creation and mesh attachment.
   *
   * Required for creating ShaderMaterial / StandardMaterial. If not
   * provided, meshes are created without materials (invisible).
   */
  private _scene: Scene | null = null

  /** ShaderMaterial with sheet texture (created lazily on first render).
   *
   * Created when both _sheet and _scene are available. If _sheet is null
   * but _scene is available, a magenta StandardMaterial is created instead.
   */
  private _shaderMaterial: ShaderMaterial | StandardMaterial | null = null

  // -----------------------------------------------------------------------
  // Babylon.js resources
  // -----------------------------------------------------------------------

  /** Backing mesh for world-space rendering (created lazily). */
  private _mesh: Mesh | null = null

  /** Backing mesh for UI-space rendering (created lazily). */
  private _uiMesh: Mesh | null = null

  /** Pre-allocated UV array for _updateUVs (8 floats: 4 vertices x 2 coordinates).
   *
   * PERF: Reused across all _updateUVs calls to avoid per-frame allocation
   * on the hot path (tick → frame change → UV update).
   */
  private readonly _uvArray: Float32Array = new Float32Array(8)

  /** Pre-allocated Vector4 for _updateShaderUniform.
   *
   * PERF: Reused across all _updateShaderUniform calls to avoid per-frame
   * allocation of Vector4 instances for setVector4('uFrameUV', ...).
   * Created lazily on first _updateShaderUniform call.
   */
  private _frameUVVector4: Vector4 | null = null

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Construct an AnimationStub.
   *
   * OpenRA 对照: Animation(World, string name, ...)
   *
   * @param _world  — world reference (reserved for future Scene extraction)
   * @param image    — the image/collection name for this animation
   * @param frameCount — total number of frames in the sequence (default 12)
   * @param tickPerFrame — game ticks per animation frame (default 1, i.e. one frame per tick)
   * @param sheet   — (Ch24 Phase A) optional Sheet providing the GPU texture atlas
   * @param frameUVs — (Ch24 Phase A) optional per-frame UV rectangles
   * @param scene   — (Ch24 Phase A) optional Babylon.js Scene for material creation
   */
  constructor(
    _world: unknown,
    image: string,
    frameCount: number = 12,
    tickPerFrame: number = 1,
    sheet?: Sheet,
    frameUVs?: Float32Array[],
    scene?: Scene,
  ) {
    this.image = image
    this._length = frameCount
    this._tickPerFrame = tickPerFrame
    this._sheet = sheet ?? null
    this._frameUVs = frameUVs ?? null
    this._scene = scene ?? null
  }

  // -----------------------------------------------------------------------
  // Playback control
  // -----------------------------------------------------------------------

  /** Start playing a sequence, then call onComplete.
   *
   * OpenRA 对照: Animation.PlayThen(sequence, callback)
   *
   * Resets frame to 0, clears repeating mode. The callback fires once
   * when the last frame has been displayed (after tickPerFrame ticks).
   *
   * @param sequence   — the sequence name to play
   * @param onComplete — invoked after the last frame completes
   */
  playThen(sequence: string, onComplete: () => void): void {
    this._started = true
    this._sequence = sequence
    this._ticks = 0
    this._frame = 0
    this._repeating = false
    this._completed = false
    this._onComplete = onComplete
  }

  /** Start playing a repeating sequence.
   *
   * OpenRA 对照: Animation.PlayRepeating(sequence)
   *
   * Plays indefinitely, looping back to frame 0 after the last frame.
   * No completion callback is invoked.
   *
   * @param sequence — the sequence name to play
   */
  playRepeating(sequence: string): void {
    this._started = true
    this._sequence = sequence
    this._ticks = 0
    this._frame = 0
    this._repeating = true
    this._completed = false
    this._onComplete = null
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  /** Advance the animation by one game tick.
   *
   * OpenRA 对照: Animation.Tick()
   *
   * Increments the tick counter. When enough ticks have elapsed to
   * advance a frame (per tickPerFrame), the frame index changes and
   * the mesh UVs are updated.
   *
   * - Non-repeating: fires onComplete after the last frame, then stops.
   * - Repeating: loops back to frame 0 after the last frame.
   */
  tick(): void {
    if (!this._started) return

    this._ticks++

    // Compute which frame we should be on
    const newFrame = Math.floor(this._ticks / this._tickPerFrame)

    if (newFrame !== this._frame) {
      this._frame = newFrame

      // Update UVs on existing meshes
      this._updateUVs()
    }

    if (this._repeating) {
      // Loop: wrap frame back to 0 when past the end
      if (this._frame >= this._length) {
        this._frame = 0
        this._ticks = 0
        this._updateUVs()
      }
    } else {
      // One-shot: fire callback when past the last frame
      if (this._frame >= this._length) {
        this._frame = this._length - 1 // clamp to last frame
        if (!this._completed && this._onComplete) {
          this._completed = true
          const cb = this._onComplete
          this._onComplete = null
          cb()
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Render — world-space
  // -----------------------------------------------------------------------

  /** Get renderables for this animation at the given world position.
   *
   * OpenRA 对照: Animation.Render(WPos, PaletteReference)
   *
   * Creates (or reuses) a Babylon.js Mesh plane positioned at `pos`.
   * UVs are set to the current frame's subsection of the sprite sheet.
   * The mesh is assigned a ShaderMaterial with the sheet texture,
   * or a magenta StandardMaterial as fallback when no sheet is available.
   *
   * Returns an empty array if the animation has not been started.
   *
   * @param pos     — world-space position for the mesh
   * @param _palette — palette reference (reserved for future palette integration)
   * @returns array with one IRenderable (the mesh)
   */
  render(pos: WPos, _palette: unknown): readonly IRenderable[] {
    if (!this._started) {
      // Hide mesh if it was previously visible
      if (this._mesh) this._mesh.setEnabled(false)
      return []
    }

    // Lazy-create mesh on first render
    if (!this._mesh) {
      this._mesh = MeshBuilder.CreatePlane(
        `anim-ws-${this.image}`,
        { width: 1, height: 1 },
        this._scene ?? undefined,
      )

      // Register in render pipeline
      this._mesh.renderingGroupId = RenderGroup.Actor

      this._updateUVs()
    }

    // Ensure material is assigned (Ch24 Phase A)
    this._ensureMaterial()
    // NOTE: Always reassign material after _ensureMaterial() because:
    // - If material was just created, _ensureMaterial() assigned it
    // - If material already existed (created by renderUI()), the
    //   newly-created _mesh would otherwise never get a material
    if (this._shaderMaterial) {
      this._mesh.material = this._shaderMaterial
    }

    // Update world-space position
    this._mesh.position.x = pos.X
    this._mesh.position.y = pos.Y
    this._mesh.position.z = pos.Z

    // Ensure mesh is visible
    this._mesh.setEnabled(true)

    return [this._mesh as unknown as IRenderable]
  }

  // -----------------------------------------------------------------------
  // RenderUI — screen-space overlay
  // -----------------------------------------------------------------------

  /** Get renderables for UI overlay rendering.
   *
   * OpenRA 对照: Animation.RenderUI(WorldRenderer, int2, WVec, int, PaletteReference)
   *
   * Creates (or reuses) a Babylon.js Mesh plane positioned in screen space.
   * UVs are set to the current frame's subsection of the sprite sheet.
   *
   * Returns an empty array if the animation has not been started.
   *
   * @param _wr       — WorldRenderer (for coordinate conversion, reserved)
   * @param _screenPos — screen-space pixel position (Int2-like: {x, y})
   * @param _offset   — world-space offset (reserved)
   * @param _scale    — rendering scale
   * @param _palette  — palette reference (reserved)
   * @returns array with one IRenderable (the mesh)
   */
  renderUI(
    _wr: unknown,
    _screenPos: unknown,
    _offset: WPos,
    _scale: number,
    _palette: unknown,
  ): readonly IRenderable[] {
    if (!this._started) {
      if (this._uiMesh) this._uiMesh.setEnabled(false)
      return []
    }

    // Lazy-create UI mesh on first renderUI call
    if (!this._uiMesh) {
      this._uiMesh = MeshBuilder.CreatePlane(
        `anim-ui-${this.image}`,
        { width: 1, height: 1 },
        this._scene ?? undefined,
      )
      // NOTE: UI mesh uses same renderingGroupId as world mesh for now.
      // Future UI overlay rendering may use a separate layer.
      this._uiMesh.renderingGroupId = RenderGroup.Actor

      this._updateUVs()
    }

    // Assign material to UI mesh as well (Ch24 Phase A)
    this._ensureMaterial()
    // NOTE: Always reassign material after _ensureMaterial() because:
    // - If material was just created, _ensureMaterial() assigned it
    // - If material already existed (created by render()), the
    //   newly-created _uiMesh would otherwise never get a material
    if (this._shaderMaterial) {
      this._uiMesh.material = this._shaderMaterial
    }

    // Position in screen space
    const sp = _screenPos as { x?: number; y?: number }
    if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
      this._uiMesh.position.x = sp.x
      this._uiMesh.position.y = sp.y
      this._uiMesh.position.z = 0
    }

    // Apply scale
    if (typeof _scale === 'number') {
      this._uiMesh.scaling.x = _scale
      this._uiMesh.scaling.y = _scale
    }

    this._uiMesh.setEnabled(true)

    return [this._uiMesh as unknown as IRenderable]
  }

  // ---------------------------------------------------------------------------
  // Ch24 Phase A: Sheet / frameUVs configuration
  // ---------------------------------------------------------------------------

  /** Set the sprite sheet and frame UVs for this animation.
   *
   * Allows the animation to be created before asset loading, then
   * configured with the sheet and UV data when assets arrive.
   *
   * If a material was already created (e.g. magenta fallback), it is
   * disposed and replaced with a new ShaderMaterial using the sheet.
   *
   * @param sheet    — the Sheet providing the GPU RawTexture
   * @param frameUVs — per-frame UV rectangles [uMin, vMin, uMax, vMax]
   * @param scene    — optional Babylon.js Scene (if not set in constructor)
   */
  setSheet(sheet: Sheet, frameUVs: Float32Array[], scene?: Scene): void {
    this._sheet = sheet
    this._frameUVs = frameUVs
    if (scene) this._scene = scene

    // If we already created a fallback material, dispose it so a proper
    // ShaderMaterial can be created on next render.
    if (this._shaderMaterial) {
      // Clear mesh references to the disposed material
      if (this._mesh) this._mesh.material = null
      if (this._uiMesh) this._uiMesh.material = null
      this._shaderMaterial.dispose()
      this._shaderMaterial = null
    }

    // Update UVs on existing meshes
    this._updateUVs()
  }

  /** Update the per-frame UV rectangles without changing the sheet.
   *
   * Useful when the same sheet has different frame layouts for
   * different sequences.
   *
   * @param frameUVs — per-frame UV rectangles [uMin, vMin, uMax, vMax]
   */
  setFrameUVs(frameUVs: Float32Array[]): void {
    this._frameUVs = frameUVs
    this._updateUVs()
  }

  /** Convenience method to subscribe tick() to a world tick callback.
   *
   * When the consumer has access to a world object with an `onTick`
   * callback, this wires up automatic frame advancement. Consumers
   * that implement ITick directly should call `this.tick()` in their
   * own `ITick.tick()` method instead.
   *
   * The world parameter uses a minimal interface — no dependency on
   * the full World / GameWorldManager type.
   *
   * @param world — object with optional onTick callback
   */
  registerWithWorld(world: { onTick?: (cb: () => void) => void }): void {
    if (world.onTick) world.onTick(() => this.tick())
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Whether the animation has completed its sequence.
   *
   * OpenRA 对照: Animation ticks >= length
   *
   * For non-repeating animations, returns true once the completion
   * callback has been invoked (after the last frame has been displayed).
   * For repeating animations, always returns false.
   */
  get isComplete(): boolean {
    return this._completed
  }

  /** Current game tick count.
   *
   * OpenRA 对照: (derived from Animation state)
   */
  get currentTick(): number {
    return this._ticks
  }

  /** Current sequence name.
   *
   * OpenRA 对照: Animation.CurrentSequence?.Name
   */
  get sequence(): string {
    return this._sequence
  }

  /** Whether the animation has been started.
   *
   * OpenRA 对照: (derived from Animation state)
   */
  get isStarted(): boolean {
    return this._started
  }

  /** Current logical frame index (0-based).
   *
   * OpenRA 对照: Animation.CurrentFrame
   */
  get currentFrame(): number {
    return this._frame
  }

  /** Total frame count of the animation.
   *
   * OpenRA 对照: sequence.Length
   */
  get length(): number {
    return this._length
  }

  /** Ticks per animation frame.
   *
   * OpenRA 对照: sequence.Tick / DefaultTick
   */
  get tickPerFrame(): number {
    return this._tickPerFrame
  }

  /** The world-space mesh (for external integration, e.g. WorldRenderer).
   *
   * Returns null if render() has never been called.
   */
  get mesh(): Mesh | null {
    return this._mesh
  }

  /** The UI-space mesh (for external integration).
   *
   * Returns null if renderUI() has never been called.
   */
  get uiMesh(): Mesh | null {
    return this._uiMesh
  }

  /** The current material (ShaderMaterial or StandardMaterial).
   *
   * Returns null if no render() call has triggered material creation,
   * or if no Scene was provided.
   */
  get material(): ShaderMaterial | StandardMaterial | null {
    return this._shaderMaterial
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Ensure a material is assigned to all existing meshes.
   *
   * Ch24 Phase A: Created lazily on first render call.
   *
   * Priority:
   * 1. If _sheet is available → ShaderMaterial with sheet texture
   * 2. If _sheet is null but _scene is available → magenta StandardMaterial
   * 3. If _scene is null → no material (mesh remains invisible)
   */
  private _ensureMaterial(): void {
    if (this._shaderMaterial) return
    if (!this._scene) return // Cannot create material without a scene

    if (this._sheet) {
      // Create ShaderMaterial with the sprite sheet texture
      this._shaderMaterial = new ShaderMaterial(
        `anim-shader-${this.image}`,
        this._scene,
        {
          vertex: SPRITE_VERTEX_SHADER,
          fragment: SPRITE_FRAGMENT_SHADER,
        },
        {
          attributes: ['position', 'uv'],
          uniforms: ['worldViewProjection', 'uFrameUV'],
          samplers: ['uTexture'],
          needAlphaBlending: true,
        },
      )

      // Configure material properties
      this._shaderMaterial.alphaMode = Constants.ALPHA_PREMULTIPLIED
      this._shaderMaterial.backFaceCulling = false

      // Bind the sheet texture
      const texture = this._sheet.getTexture(this._scene)
      this._shaderMaterial.setTexture('uTexture', texture)

      // Set initial frame UV uniform
      this._updateShaderUniform()
    } else {
      // NOTE: Fallback magenta debug material — makes missing-texture
      // animations visibly distinguishable rather than invisible.
      this._shaderMaterial = new StandardMaterial(
        `anim-fallback-${this.image}`,
        this._scene,
      )
      this._shaderMaterial.emissiveColor = new Color3(1, 0, 1)
      this._shaderMaterial.alphaMode = Constants.ALPHA_PREMULTIPLIED
      this._shaderMaterial.backFaceCulling = false
    }

    // Assign material to all existing meshes
    if (this._mesh) {
      this._mesh.material = this._shaderMaterial
    }
    if (this._uiMesh) {
      this._uiMesh.material = this._shaderMaterial
    }
  }

  /** Update the uFrameUV uniform on the ShaderMaterial.
   *
   * Only applies when the material is a ShaderMaterial (not the
   * magenta StandardMaterial fallback).
   *
   * When explicit frameUVs are available for the current frame, the
   * uniform is set to that rect. Otherwise, the evenly-spaced strip
   * fallback is computed — matching the vertex UVs set by _updateUVs().
   * This ensures the shader uniform never desyncs from the mesh UV data.
   *
   * PERF: Reuses a pre-allocated Vector4 to avoid per-frame allocation.
   */
  private _updateShaderUniform(): void {
    if (!this._shaderMaterial) return
    // Duck-type check: ShaderMaterial has setVector4, StandardMaterial does not.
    // Using duck-typing instead of instanceof so the check works in both
    // production (real Babylon.js) and test (mocked modules) environments.
    const mat = this._shaderMaterial as ShaderMaterial
    if (typeof mat.setVector4 !== 'function') return

    const frameCount = this._length
    if (frameCount <= 0) return

    let uMin: number, vMin: number, uMax: number, vMax: number

    if (this._frameUVs && this._frame < this._frameUVs.length) {
      // Explicit UV rect from Sheet/Sprite data
      const rect = this._frameUVs[this._frame]
      uMin = rect[0] ?? 0
      vMin = rect[1] ?? 0
      uMax = rect[2] ?? 1
      vMax = rect[3] ?? 1
    } else {
      // Fallback: evenly-spaced horizontal strip (matches _updateUVs else branch)
      const i = this._frame < frameCount ? this._frame : frameCount - 1
      uMin = i / frameCount
      uMax = (i + 1) / frameCount
      vMin = 0
      vMax = 1
    }

    // PERF: Reuse pre-allocated Vector4 to avoid per-frame allocation
    if (!this._frameUVVector4) {
      this._frameUVVector4 = new Vector4(0, 0, 1, 1)
    }
    this._frameUVVector4.x = uMin
    this._frameUVVector4.y = vMin
    this._frameUVVector4.z = uMax
    this._frameUVVector4.w = vMax
    mat.setVector4('uFrameUV', this._frameUVVector4)
  }

  /** Update UV coordinates on existing meshes to show the current frame.
   *
   * Ch24 Phase A: Vertex UVs are ALWAYS the full quad [0,0,1,0,1,1,0,1].
   * The fragment shader remaps to the correct frame sub-region via the
   * uFrameUV uniform. This avoids double-mapping: if vertex UVs were set
   * to the frame rect AND the fragment shader did mix() within that rect,
   * the result would be a sub-sub-rect (wrong).
   *
   * The uFrameUV uniform is always updated to match the current frame,
   * whether from explicit frameUVs or the evenly-spaced strip fallback.
   */
  private _updateUVs(): void {
    const frameCount = this._length
    if (frameCount <= 0) return

    // Warn once if no frameUVs provided (fallback strip behavior)
    if (!this._frameUVs) {
      if (!AnimationStub._fallbackWarningEmitted) {
        AnimationStub._fallbackWarningEmitted = true
        console.warn(
          `AnimationStub("${this.image}"): using fallback strip UVs, ` +
          `no frameUVs provided. Call setSheet() or provide frameUVs ` +
          `in the constructor for correct sprite rendering.`,
        )
      }
    }

    // Plane vertex UV order (4 vertices, counter-clockwise from bottom-left):
    // Full quad [0,0, 1,0, 1,1, 0,1] — the fragment shader remaps to the
    // correct frame sub-region via the uFrameUV uniform.
    // PERF: Reuse pre-allocated Float32Array to avoid per-frame allocation
    const uvs = this._uvArray
    uvs[0] = 0; uvs[1] = 0
    uvs[2] = 1; uvs[3] = 0
    uvs[4] = 1; uvs[5] = 1
    uvs[6] = 0; uvs[7] = 1

    if (this._mesh) {
      this._mesh.updateVerticesData('uv', uvs, false, false)
    }
    if (this._uiMesh) {
      this._uiMesh.updateVerticesData('uv', uvs, false, false)
    }

    // Also update the ShaderMaterial uniform
    this._updateShaderUniform()
  }

  /** Static flag to avoid spamming the fallback console warning. */
  private static _fallbackWarningEmitted: boolean = false

  /** Dispose GPU resources (mesh planes + material).
   *
   * Cleans up the world-space and UI-space backing meshes,
   * and the ShaderMaterial or StandardMaterial.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void {
    // Dispose material first (Ch24 Phase A)
    if (this._shaderMaterial) {
      this._shaderMaterial.dispose()
      this._shaderMaterial = null
    }

    if (this._mesh) {
      this._mesh.dispose()
      this._mesh = null
    }
    if (this._uiMesh) {
      this._uiMesh.dispose()
      this._uiMesh = null
    }
  }
}
