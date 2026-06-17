/**
 * ModelActorPreview.ts — Voxel model actor preview for UI (sidebar, build queue)
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/ModelActorPreview.cs (ModelPreview class)
 *
 * 核心范式转换:
 * - C# IActorPreview interface with Render/RenderUI/Tick → TypeScript preview
 *   state holder generating ModelRenderable for world scene and UIModelRenderable
 *   for UI overlays (ADR-19.1)
 * - C# y-return generator with yield → array return
 * - C# WorldRenderer camera/light setup → computed WRot transforms
 *
 * ADR-19.1:
 * - ModelPreview generates ModelRenderable (for world preview) and
 *   UIModelRenderable (for sidebar build queue preview).
 * - Preview uses a fixed camera angle and static light source.
 */

import type { ModelAnimation } from '../../OpenRA.Game/Graphics/ModelAnimation'
import { Rectangle } from '../../OpenRA.Game/Primitives/Rectangle'
import { WAngle } from '../../OpenRA.Game/WAngle'
import { WPos } from '../../OpenRA.Game/WPos'
import { WRot } from '../../OpenRA.Game/WRot'
import type { WVec } from '../../OpenRA.Game/WVec'
import { ModelRenderable } from './ModelRenderable'
import type { ModelRenderer } from '../Traits/World/ModelRenderer'
import { UIModelRenderable } from './UIModelRenderable'

// ---------------------------------------------------------------------------
// ModelPreview — IActorPreview for voxel models
// ---------------------------------------------------------------------------

/** Generates preview renderables for voxel models in UI and world contexts.
 *
 * OpenRA 对照: ModelPreview class (IActorPreview)
 */
export class ModelPreview {
  private readonly _renderer: ModelRenderer
  private readonly _components: ModelAnimation[]
  private readonly _scale: number
  private readonly _lightAmbient: Float32Array
  private readonly _lightDiffuse: Float32Array
  private readonly _lightSource: WRot
  private readonly _camera: WRot
  private readonly _offset: WVec
  private readonly _zOffset: number

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param renderer — the ModelRenderer world trait
   * @param components — model animation components
   * @param offset — world-space offset from actor center
   * @param zOffset — Z-buffer offset
   * @param scale — model scale
   * @param lightPitch — light pitch angle
   * @param lightYaw — light yaw angle
   * @param lightAmbient — ambient light [R, G, B]
   * @param lightDiffuse — diffuse light [R, G, B]
   * @param cameraPitch — camera pitch angle
   */
  constructor(
    renderer: ModelRenderer,
    components: ModelAnimation[],
    offset: WVec,
    zOffset: number,
    scale: number,
    lightPitch: WAngle,
    lightYaw: WAngle,
    lightAmbient: Float32Array,
    lightDiffuse: Float32Array,
    cameraPitch: WAngle,
  ) {
    this._renderer = renderer
    this._components = components
    this._scale = scale
    this._lightAmbient = lightAmbient
    this._lightDiffuse = lightDiffuse

    // lightSource = new WRot(WAngle.Zero, new WAngle(256) - lightPitch, lightYaw)
    this._lightSource = new WRot(
      WAngle.Zero,
      WAngle.subtract(new WAngle(256), lightPitch),
      lightYaw,
    )

    // camera = new WRot(WAngle.Zero, cameraPitch - new WAngle(256), new WAngle(256))
    this._camera = new WRot(
      WAngle.Zero,
      WAngle.subtract(cameraPitch, new WAngle(256)),
      new WAngle(256),
    )

    this._offset = offset
    this._zOffset = zOffset
  }

  // -----------------------------------------------------------------------
  // Tick — no-op (preview models don't animate)
  // -----------------------------------------------------------------------

  /** No-op — preview models don't tick.
   *
   * OpenRA 对照: IActorPreview.Tick()
   */
  tick(): void {
    // Not supported for voxel previews
  }

  // -----------------------------------------------------------------------
  // Render in world
  // -----------------------------------------------------------------------

  /** Generate world-space renderables for this model at a given position.
   *
   * OpenRA 对照: IActorPreview.Render(WorldRenderer wr, WPos pos)
   */
  render(worldPos: WPos): ModelRenderable[] {
    return [
      new ModelRenderable(
        this._renderer,
        this._components,
        WPos.add(worldPos, this._offset),
        this._zOffset,
        this._camera,
        this._scale,
        this._lightSource,
        this._lightAmbient,
        this._lightDiffuse,
        WRot.None, // ground orientation — flat plane for preview
      ),
    ]
  }

  // -----------------------------------------------------------------------
  // ScreenBounds — UI hit-testing for build queue previews
  // -----------------------------------------------------------------------

  /** Compute the screen-space bounding rectangles for UI hit-testing.
   *
   * OpenRA 对照: IActorPreview.ScreenBounds(WorldRenderer wr, WPos pos)
   *
   * @param worldPos — world position for offset computation
   * @param screenOffsetX — screen X offset of the actor
   * @param screenOffsetY — screen Y offset of the actor
   * @param previewScale — preview scale factor
   */
  screenBounds(
    worldPos: WPos,
    screenOffsetX: number,
    screenOffsetY: number,
    previewScale: number,
  ): Rectangle[] {
    return this._components.map((comp) =>
      comp.screenBounds(
        worldPos,
        screenOffsetX,
        screenOffsetY,
        previewScale * this._scale,
      ),
    )
  }

  // -----------------------------------------------------------------------
  // Render in UI
  // -----------------------------------------------------------------------

  /** Generate UI-space renderables for this model at a screen position.
   *
   * OpenRA 对照: IActorPreview.RenderUI(WorldRenderer wr, int2 pos, float scale)
   */
  renderUI(screenX: number, screenY: number, uiScale: number): UIModelRenderable[] {
    const groundOrientation = WRot.None

    return [
      new UIModelRenderable(
        this._renderer,
        this._components,
        WPos.add(WPos.Zero, this._offset),
        screenX,
        screenY,
        this._zOffset,
        this._camera,
        uiScale * this._scale,
        this._lightSource,
        this._lightAmbient,
        this._lightDiffuse,
        groundOrientation,
      ),
    ]
  }
}
