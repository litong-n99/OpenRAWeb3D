/**
 * UIModelRenderable.ts — UI-space model renderable (voxel models in UI widgets)
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/UIModelRenderable.cs
 *
 * 核心范式转换:
 * - C# IRenderable + IPalettedRenderable with FinalizedUIModelRenderable
 *   → TypeScript UI-space renderable state struct (ADR-19.1)
 * - C# fixed orthographic UI rendering via sprite sheets → separate UI Scene
 *   with orthographic camera for model preview (ADR-19.1)
 * - C# screenPos int2 → TypeScript (screenX, screenY) coordinates
 *
 * ADR-19.1:
 * - UIModelRenderable is used by ModelPreview.RenderUI() for sidebar build
 *   queue and purchase dialog previews.
 * - The model is rendered in a separate UI Scene with orthographic camera.
 * - This class holds the rendering parameters; the actual rendering is
 *   delegated to a UI model rendering subsystem.
 */

import type { ModelAnimation } from '../../OpenRA.Game/Graphics/ModelAnimation'
import { WPos } from '../../OpenRA.Game/WPos'
import type { WRot } from '../../OpenRA.Game/WRot'
import type { ModelRenderer } from '../Traits/World/ModelRenderer'
import type { ModelRenderProxy } from '../Traits/World/ModelRenderer'

// ---------------------------------------------------------------------------
// UIModelRenderable — UI-space model renderable
// ---------------------------------------------------------------------------

/** State holder for a UI-space voxel model renderable.
 *
 * OpenRA 对照: UIModelRenderable class (IRenderable, IPalettedRenderable)
 *
 * Used for rendering voxel models in UI widgets such as the sidebar
 * build queue and purchase dialog.
 */
export class UIModelRenderable {
  /** World position used for lighting computation.
   *
   * OpenRA 对照: UIModelRenderable.Pos
   */
  readonly pos: WPos

  /** Screen X position.
   *
   * OpenRA 对照: screenPos.X
   */
  readonly screenX: number

  /** Screen Y position.
   *
   * OpenRA 对照: screenPos.Y
   */
  readonly screenY: number

  /** Z-buffer offset.
   *
   * OpenRA 对照: UIModelRenderable.ZOffset
   */
  readonly zOffset: number

  /** Whether this is a decoration.
   *
   * OpenRA 对照: UIModelRenderable.IsDecoration
   */
  readonly isDecoration = false

  private readonly _renderer: ModelRenderer
  private readonly _models: ModelAnimation[]
  private readonly _camera: WRot
  private readonly _scale: number
  private readonly _lightSource: WRot
  private readonly _lightAmbient: Float32Array
  private readonly _lightDiffuse: Float32Array
  private readonly _groundOrientation: WRot

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param renderer — the ModelRenderer world trait
   * @param models — model animations to render
   * @param effectiveWorldPos — world position for lighting (usually Zero + offset)
   * @param screenX — screen X coordinate
   * @param screenY — screen Y coordinate
   * @param zOffset — Z-buffer offset
   * @param camera — camera rotation
   * @param scale — model scale
   * @param lightSource — light source rotation
   * @param lightAmbient — ambient light [R, G, B]
   * @param lightDiffuse — diffuse light [R, G, B]
   * @param groundOrientation — ground plane orientation
   */
  constructor(
    renderer: ModelRenderer,
    models: ModelAnimation[],
    effectiveWorldPos: WPos,
    screenX: number,
    screenY: number,
    zOffset: number,
    camera: WRot,
    scale: number,
    lightSource: WRot,
    lightAmbient: Float32Array,
    lightDiffuse: Float32Array,
    groundOrientation: WRot,
  ) {
    this._renderer = renderer
    this._models = models
    this.pos = effectiveWorldPos
    this.screenX = screenX
    this.screenY = screenY
    this.zOffset = zOffset
    this._camera = camera
    this._scale = scale
    this._lightSource = lightSource
    this._lightAmbient = lightAmbient
    this._lightDiffuse = lightDiffuse
    this._groundOrientation = groundOrientation
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
  get lightAmbient(): Float32Array {
    return this._lightAmbient
  }

  /** Get the light diffuse color.
   */
  get lightDiffuse(): Float32Array {
    return this._lightDiffuse
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
   * OpenRA 对照: UIModelRenderable.PrepareRender(WorldRenderer wr)
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
}
