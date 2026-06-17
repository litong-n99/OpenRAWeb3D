/**
 * WithVoxelBody.ts — Voxel body rendering trait (main body limb)
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithVoxelBody.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<WithVoxelBodyInfo> pattern → TypeScript conditional
 *   trait that attaches the body ModelAnimation to RenderVoxels (ADR-19.1)
 * - C# BodyOrientation + QuantizeOrientation → WRot facing computation
 * - C# IAutoMouseBounds → ModelAnimation.screenBounds for hit-testing
 *
 * ADR-19.1:
 * - The body is the root TransformNode in the multi-part hierarchy.
 * - Body rotation is driven by actor facing (yaw only, quantized).
 * - The body ModelAnimation is created at construction and registered with
 *   RenderVoxels via add().
 */

import { ModelAnimation } from '../../../OpenRA.Game/Graphics/ModelAnimation'
import { WRot } from '../../../OpenRA.Game/WRot'
import { WVec } from '../../../OpenRA.Game/WVec'
import type { WPos } from '../../../OpenRA.Game/WPos'
import type { IModelCache } from '../../../OpenRA.Game/Graphics/Model'
import { RenderVoxels } from './RenderVoxels'

// ---------------------------------------------------------------------------
// WithVoxelBodyInfo
// ---------------------------------------------------------------------------

/** Configuration info for the WithVoxelBody trait.
 *
 * OpenRA 对照: WithVoxelBodyInfo : ConditionalTraitInfo, IRenderActorPreviewVoxelsInfo, Requires<RenderVoxelsInfo>
 */
export interface WithVoxelBodyInfo {
  /** Sequence name to use (default: "idle").
   *
   * OpenRA 对照: WithVoxelBodyInfo.Sequence
   */
  readonly sequence: string

  /** Offset from actor center.
   *
   * OpenRA 对照: WithVoxelBodyInfo.Offset
   */
  readonly offset: WVec

  /** Whether the body casts a shadow.
   *
   * OpenRA 对照: WithVoxelBodyInfo.ShowShadow
   */
  readonly showShadow: boolean
}

// ---------------------------------------------------------------------------
// WithVoxelBody
// ---------------------------------------------------------------------------

/** Actor trait that attaches a voxel body model.
 *
 * OpenRA 对照: WithVoxelBody class (ConditionalTrait<WithVoxelBodyInfo>, IAutoMouseBounds)
 *
 * The body is the root of the model hierarchy. It handles:
 * 1. Loading the model from the ModelCache
 * 2. Creating the body ModelAnimation with facing-based rotation
 * 3. Registering with RenderVoxels
 */
export class WithVoxelBody {
  /** Trait configuration.
   */
  readonly info: WithVoxelBodyInfo

  /** The body model animation registered with RenderVoxels.
   */
  readonly modelAnimation: ModelAnimation

  /** Reference to the parent RenderVoxels trait.
   */
  readonly renderVoxels: RenderVoxels

  /** Whether this trait is currently disabled by a condition.
   */
  private _disabled = false

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param info — trait configuration
   * @param renderVoxels — the actor's RenderVoxels trait
   * @param modelCache — the world's model cache
   * @param getFacingFunc — function returning the actor's current facing (WRot)
   *   This is a closure over the actor's body orientation.
   */
  constructor(
    info: WithVoxelBodyInfo,
    renderVoxels: RenderVoxels,
    modelCache: IModelCache,
    getFacingFunc: () => WRot,
  ) {
    this.info = info
    this.renderVoxels = renderVoxels

    const model = modelCache.getModelSequence(renderVoxels.image, info.sequence)

    this.modelAnimation = new ModelAnimation(
      model,
      () => info.offset,
      getFacingFunc,
      () => this._disabled,
      () => 0, // frame 0 for body idle
      info.showShadow,
    )

    renderVoxels.add(this.modelAnimation)
  }

  // -----------------------------------------------------------------------
  // Condition control
  // -----------------------------------------------------------------------

  /** Enable or disable this trait by condition.
   */
  set disabled(value: boolean) {
    this._disabled = value
  }

  /** Whether the trait is disabled.
   */
  get disabled(): boolean {
    return this._disabled
  }

  // -----------------------------------------------------------------------
  // Screen bounds (for mouse hit testing)
  // -----------------------------------------------------------------------

  /** Compute screen-space bounds for auto mouse-over.
   *
   * OpenRA 对照: IAutoMouseBounds.AutoMouseoverBounds
   *
   * @param centerPos — actor center in world sub-units
   * @param screenX — screen X offset for the actor
   * @param screenY — screen Y offset for the actor
   * @returns Screen-space bounding rectangle
   */
  getScreenBounds(centerPos: WPos, screenX: number, screenY: number) {
    return this.modelAnimation.screenBounds(
      centerPos,
      screenX,
      screenY,
      this.renderVoxels.info.scale,
    )
  }

  // -----------------------------------------------------------------------
  // Preview helper (static)
  // -----------------------------------------------------------------------

  /** Generate preview model animations for the build queue / sidebar.
   *
   * OpenRA 对照: WithVoxelBodyInfo.RenderPreviewVoxels
   *
   * @param modelCache — the world's model cache
   * @param image — model image name
   * @param sequence — sequence name
   * @param offset — body offset
   * @param previewFacingFunc — function returning preview rotation
   * @param showShadow — whether to show shadow in preview
   */
  static renderPreview(
    modelCache: IModelCache,
    image: string,
    sequence: string,
    offset: WVec,
    previewFacingFunc: () => WRot,
    showShadow: boolean,
  ): ModelAnimation[] {
    const model = modelCache.getModelSequence(image, sequence)
    return [
      new ModelAnimation(
        model,
        () => offset,
        previewFacingFunc,
        null, // always visible in preview
        () => 0,
        showShadow,
      ),
    ]
  }
}
