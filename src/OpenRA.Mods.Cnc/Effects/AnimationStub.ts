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
 */

import { MeshBuilder, type Mesh } from '@babylonjs/core'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

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
   */
  constructor(
    _world: unknown,
    image: string,
    frameCount: number = 12,
    tickPerFrame: number = 1,
  ) {
    this.image = image
    this._length = frameCount
    this._tickPerFrame = tickPerFrame
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
   *
   * Returns an empty array if the animation has not been started.
   *
   * @param pos     — world-space position for the mesh
   * @param _palette — palette reference (reserved for future palette integration)
   * @returns array with one IRenderable (the mesh)
   */
  render(pos: WPos, _palette: unknown): readonly IRenderable[] {
    if (!this._started) return []

    // Lazy-create mesh on first render
    if (!this._mesh) {
      this._mesh = MeshBuilder.CreatePlane(
        `anim-ws-${this.image}`,
        { width: 1, height: 1 },
      )
      this._updateUVs()
    }

    // Update world-space position
    this._mesh.position.x = pos.X
    this._mesh.position.y = pos.Y
    this._mesh.position.z = pos.Z

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
    if (!this._started) return []

    // Lazy-create UI mesh on first renderUI call
    if (!this._uiMesh) {
      this._uiMesh = MeshBuilder.CreatePlane(
        `anim-ui-${this.image}`,
        { width: 1, height: 1 },
      )
      this._updateUVs()
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

    return [this._uiMesh as unknown as IRenderable]
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

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Update UV coordinates on existing meshes to show the current frame.
   *
   * Assumes the sprite sheet is laid out as a horizontal strip with
   * `_length` equally-spaced frames. Frame `i` occupies the UV range:
   *   left = i / _length,  right = (i + 1) / _length
   *
   * TODO: Integrate with Ch2 Sheet/Sprite infrastructure for actual sprite
   * sheet UV resolution when sprite sequences are available from mod assets.
   * Currently uses an evenly-spaced horizontal strip assumption.
   */
  private _updateUVs(): void {
    const frameCount = this._length
    if (frameCount <= 0) return

    const i = this._frame
    const u0 = i / frameCount
    const u1 = (i + 1) / frameCount
    const v0 = 0
    const v1 = 1

    // Plane vertex UV order (4 vertices, counter-clockwise from bottom-left):
    //   [u0, v0,  u1, v0,  u1, v1,  u0, v1]
    // PERF: Reuse pre-allocated Float32Array to avoid per-frame allocation
    const uvs = this._uvArray
    uvs[0] = u0; uvs[1] = v0
    uvs[2] = u1; uvs[3] = v0
    uvs[4] = u1; uvs[5] = v1
    uvs[6] = u0; uvs[7] = v1

    if (this._mesh) {
      this._mesh.updateVerticesData('uv', uvs, false, false)
    }
    if (this._uiMesh) {
      this._uiMesh.updateVerticesData('uv', uvs, false, false)
    }
  }

  /** Dispose GPU resources (mesh planes).
   *
   * Cleans up the world-space and UI-space backing meshes.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void {
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
