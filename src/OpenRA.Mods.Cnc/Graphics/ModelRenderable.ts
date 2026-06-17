/**
 * ModelRenderable.ts — World-space model renderable (voxel models in the world scene)
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/ModelRenderable.cs
 *
 * 核心范式转换:
 * - C# IPalettedRenderable + IModifyableRenderable with FinalizedModelRenderable
 *   → TypeScript world-space renderable state struct (ADR-19.1)
 * - C# per-frame CPU rendering via sprite sheets → Babylon.js scene graph
 *   TransformNode auto-rendered by engine
 * - C# PrepareRender/Render split → simplified: render proxy computed at creation
 * - C# TintModifiers/IgnoreWorldTint → BABYLON.Material alpha/tint uniforms
 *
 * ADR-19.1:
 * - ModelRenderable becomes a lightweight state holder that maps an actor's
 *   model animations to screen-space bounds for hit-testing and culling.
 * - The actual GPU rendering is handled by the TransformNode hierarchy in
 *   the Babylon.js scene graph.
 */

import type { ModelAnimation } from '../../OpenRA.Game/Graphics/ModelAnimation'
import type { ModelRenderer } from '../Traits/World/ModelRenderer'
import type { ModelRenderProxy } from '../Traits/World/ModelRenderer'
import { WPos } from '../../OpenRA.Game/WPos'
import type { WRot } from '../../OpenRA.Game/WRot'
import type { WVec } from '../../OpenRA.Game/WVec'

// ---------------------------------------------------------------------------
// ModelRenderable — world-space model renderable
// ---------------------------------------------------------------------------

/** State holder for a world-space voxel model renderable.
 *
 * OpenRA 对照: ModelRenderable class (IPalettedRenderable, IModifyableRenderable)
 *
 * Under ADR-19.1, this is a lightweight struct that:
 * 1. Holds the model animations and rendering parameters
 * 2. Computes a ModelRenderProxy at preparation time
 * 3. Provides screen-space bounds for hit-testing and culling
 *
 * Immutable — mutation methods return new instances.
 */
export class ModelRenderable {
  /** Associated world position.
   *
   * OpenRA 对照: ModelRenderable.Pos
   */
  readonly pos: WPos

  /** Z-buffer offset.
   *
   * OpenRA 对照: ModelRenderable.ZOffset
   */
  readonly zOffset: number

  /** Model animations for this renderable.
   */
  private readonly _models: ModelAnimation[]

  /** The ModelRenderer that will process this renderable.
   */
  private readonly _renderer: ModelRenderer

  /** Camera rotation.
   */
  private readonly _camera: WRot

  /** Model scale.
   */
  private readonly _scale: number

  /** Light source rotation.
   */
  private readonly _lightSource: WRot

  /** Light ambient color [R, G, B].
   */
  private readonly _lightAmbient: Float32Array<ArrayBufferLike>

  /** Light diffuse color [R, G, B].
   */
  private readonly _lightDiffuse: Float32Array<ArrayBufferLike>

  /** Alpha multiplier.
   */
  private readonly _alpha: number

  /** Color tint [R, G, B].
   */
  private readonly _tint: Float32Array<ArrayBufferLike>

  /** Whether this is a decoration (not interactive).
   */
  private readonly _isDecoration: boolean

  /** Ground orientation.
   */
  private readonly _groundOrientation: WRot

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param renderer — the ModelRenderer world trait
   * @param models — model animations to render
   * @param pos — world position of the model
   * @param zOffset — Z-buffer offset
   * @param camera — camera rotation
   * @param scale — model scale factor
   * @param lightSource — light source rotation
   * @param lightAmbient — ambient light [R, G, B] (0..1)
   * @param lightDiffuse — diffuse light [R, G, B] (0..1)
   * @param groundOrientation — ground plane orientation
   * @param alpha — alpha multiplier (1.0 = fully opaque)
   * @param tint — color tint [R, G, B]
   * @param isDecoration — if true, non-interactive
   */
  constructor(
    renderer: ModelRenderer,
    models: ModelAnimation[],
    pos: WPos,
    zOffset: number,
    camera: WRot,
    scale: number,
    lightSource: WRot,
    lightAmbient: Float32Array<ArrayBufferLike>,
    lightDiffuse: Float32Array<ArrayBufferLike>,
    groundOrientation: WRot,
    alpha = 1.0,
    tint: Float32Array<ArrayBufferLike> = new Float32Array([1, 1, 1]),
    isDecoration = false,
  ) {
    this._renderer = renderer
    this._models = models
    this.pos = pos
    this.zOffset = zOffset
    this._camera = camera
    this._scale = scale
    this._lightSource = lightSource
    this._lightAmbient = lightAmbient
    this._lightDiffuse = lightDiffuse
    this._groundOrientation = groundOrientation
    this._alpha = alpha
    this._tint = tint
    this._isDecoration = isDecoration
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  /** Get the model animations.
   */
  get models(): ModelAnimation[] {
    return this._models
  }

  /** Get the renderer reference.
   */
  get renderer(): ModelRenderer {
    return this._renderer
  }

  /** Get the camera rotation.
   */
  get camera(): WRot {
    return this._camera
  }

  /** Get the scale.
   */
  get scale(): number {
    return this._scale
  }

  /** Get the light source rotation.
   */
  get lightSource(): WRot {
    return this._lightSource
  }

  /** Get the light ambient color.
   */
  get lightAmbient(): Float32Array<ArrayBufferLike> {
    return this._lightAmbient
  }

  /** Get the light diffuse color.
   */
  get lightDiffuse(): Float32Array<ArrayBufferLike> {
    return this._lightDiffuse
  }

  /** Get the alpha value.
   */
  get alpha(): number {
    return this._alpha
  }

  /** Get the tint color.
   */
  get tint(): Float32Array<ArrayBufferLike> {
    return this._tint
  }

  /** Whether this is a decoration.
   */
  get isDecoration(): boolean {
    return this._isDecoration
  }

  /** Get the ground orientation.
   */
  get groundOrientation(): WRot {
    return this._groundOrientation
  }

  // -----------------------------------------------------------------------
  // Prepare — produce finalized render proxy
  // -----------------------------------------------------------------------

  /** Prepare rendering and return a finalized render proxy.
   *
   * OpenRA 对照: ModelRenderable.PrepareRender(WorldRenderer wr)
   *
   * Under ADR-19.1, this computes the screen-space bounds and shadow
   * projection. The actual GPU rendering is deferred to Babylon.js.
   */
  prepareRender(): ModelRenderProxy {
    const visibleModels = this._models.filter((m) => m.isVisible)

    return this._renderer.renderAsync(
      this.pos,
      visibleModels,
      this._camera,
      this._scale,
      this._groundOrientation,
      this._lightSource,
    )
  }

  // -----------------------------------------------------------------------
  // Immutable setters (matching C# interface)
  // -----------------------------------------------------------------------

  /** Create a copy with a different world position offset.
   *
   * OpenRA 对照: ModelRenderable.OffsetBy(WVec)
   */
  offsetBy(vec: WVec): ModelRenderable {
    return new ModelRenderable(
      this._renderer,
      this._models,
      WPos.add(this.pos, vec),
      this.zOffset,
      this._camera,
      this._scale,
      this._lightSource,
      this._lightAmbient,
      this._lightDiffuse,
      this._groundOrientation,
      this._alpha,
      this._tint,
      this._isDecoration,
    )
  }

  /** Create a copy with a different Z offset.
   *
   * OpenRA 对照: ModelRenderable.WithZOffset(int)
   */
  withZOffset(newOffset: number): ModelRenderable {
    return new ModelRenderable(
      this._renderer,
      this._models,
      this.pos,
      newOffset,
      this._camera,
      this._scale,
      this._lightSource,
      this._lightAmbient,
      this._lightDiffuse,
      this._groundOrientation,
      this._alpha,
      this._tint,
      this._isDecoration,
    )
  }

  /** Create a copy with a different alpha.
   *
   * OpenRA 对照: ModelRenderable.WithAlpha(float)
   */
  withAlpha(newAlpha: number): ModelRenderable {
    return new ModelRenderable(
      this._renderer,
      this._models,
      this.pos,
      this.zOffset,
      this._camera,
      this._scale,
      this._lightSource,
      this._lightAmbient,
      this._lightDiffuse,
      this._groundOrientation,
      newAlpha,
      this._tint,
      this._isDecoration,
    )
  }

  /** Create a copy with a different tint.
   *
   * OpenRA 对照: ModelRenderable.WithTint(float3, TintModifiers)
   */
  withTint(newTint: Float32Array): ModelRenderable {
    return new ModelRenderable(
      this._renderer,
      this._models,
      this.pos,
      this.zOffset,
      this._camera,
      this._scale,
      this._lightSource,
      this._lightAmbient,
      this._lightDiffuse,
      this._groundOrientation,
      this._alpha,
      newTint,
      this._isDecoration,
    )
  }

  /** Mark as a decoration.
   *
   * OpenRA 对照: ModelRenderable.AsDecoration()
   */
  asDecoration(): ModelRenderable {
    return new ModelRenderable(
      this._renderer,
      this._models,
      this.pos,
      this.zOffset,
      this._camera,
      this._scale,
      this._lightSource,
      this._lightAmbient,
      this._lightDiffuse,
      this._groundOrientation,
      this._alpha,
      this._tint,
      true,
    )
  }
}
