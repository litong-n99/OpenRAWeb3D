/**
 * ModelAnimation.ts — Per-model animation state (frame, offset, rotation)
 * OpenRA 对照: OpenRA.Game/Graphics/ModelAnimation.cs
 *
 * 核心范式转换:
 * - C# readonly struct with delegate fields → TypeScript class with closure callbacks
 * - C# value-type copy semantics → mutable reference semantics (single instance per model)
 * - screenBounds() computation: C# via WorldRenderer.ScreenPxPosition/ScreenPxOffset
 *   → WPos + scale arithmetic (ADIS-19.1: scale-based with pre-computed aggregateBounds)
 *
 * ADR-19.1 Impact:
 * - Frame callback returns animation index for glTF animation clip selection
 * - Rotation callback drives TransformNode.rotation via WRot.asBabylonQuaternion()
 * - Offset callback drives TransformNode.position offset
 */

import type { IModel } from './Model'
import { Rectangle } from '../Primitives/Rectangle'
import type { WVec } from '../WVec'
import type { WPos } from '../WPos'
import type { WRot } from '../WRot'

// ---------------------------------------------------------------------------
// ModelAnimation
// ---------------------------------------------------------------------------

/** Per-instance animation state binding a model to its world transforms.
 *
 * OpenRA 对照: ModelAnimation (readonly struct)
 *
 * Callbacks are closures capturing the trait instance state, matching
 * OpenRA's delegate pattern. Under ADR-19.1, these drive TransformNode
 * properties each frame.
 */
export class ModelAnimation {
  /** The model this animation applies to.
   *
   * OpenRA 对照: ModelAnimation.Model
   */
  readonly model: IModel

  /** Offset from the actor's center position (in world sub-units).
   *
   * OpenRA 对照: ModelAnimation.OffsetFunc
   */
  readonly offsetFunc: () => WVec

  /** Rotation function returning the model's world rotation.
   *
   * OpenRA 对照: ModelAnimation.RotationFunc
   */
  readonly rotationFunc: () => WRot

  /** If true (or function returns true), this model animation is hidden.
   *
   * OpenRA 对照: ModelAnimation.DisableFunc
   */
  readonly disableFunc: (() => boolean) | null

  /** Returns the current animation frame index.
   *
   * OpenRA 对照: ModelAnimation.FrameFunc
   */
  readonly frameFunc: () => number

  /** Whether to render a shadow for this model part.
   *
   * OpenRA 对照: ModelAnimation.ShowShadow
   */
  readonly showShadow: boolean

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param model — the loaded voxel/glTF model
   * @param offsetFunc — offset from actor center (WVec)
   * @param rotationFunc — world rotation (WRot)
   * @param disableFunc — null for always visible; function for conditional visibility
   * @param frameFunc — current animation frame index (0 = default/idle)
   * @param showShadow — whether this model part casts a shadow
   */
  constructor(
    model: IModel,
    offsetFunc: () => WVec,
    rotationFunc: () => WRot,
    disableFunc: (() => boolean) | null,
    frameFunc: () => number,
    showShadow: boolean,
  ) {
    this.model = model
    this.offsetFunc = offsetFunc
    this.rotationFunc = rotationFunc
    this.disableFunc = disableFunc
    this.frameFunc = frameFunc
    this.showShadow = showShadow
  }

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  /** Whether this model part is currently visible.
   *
   * OpenRA 对照: ModelAnimation.IsVisible
   */
  get isVisible(): boolean {
    return this.disableFunc === null || !this.disableFunc()
  }

  // -----------------------------------------------------------------------
  // Screen bounds
  // -----------------------------------------------------------------------

  /**
   * Compute the screen-space bounding rectangle for this model at the
   * given world position.
   *
   * OpenRA 对照: ModelAnimation.ScreenBounds(WPos, WorldRenderer, float)
   *
   * Under ADR-19.1, uses the pre-computed aggregateBounds multiplied by scale.
   * This is a simplified version since we don't have a WorldRenderer reference
   * in the data model — callers must provide the screen offset.
   *
   * @param centerPos — actor center in world sub-units
   * @param screenOffsetX — screen X offset for the actor center
   * @param screenOffsetY — screen Y offset for the actor center
   * @param scale — model scale factor (from RenderVoxels.Info.Scale)
   * @returns Screen-space bounding rectangle
   */
  screenBounds(
    _centerPos: WPos,
    screenOffsetX: number,
    screenOffsetY: number,
    scale: number,
  ): Rectangle {
    const r = this.model.aggregateBounds
    const offset = this.offsetFunc()
    // Note: screen space offset from world offset uses a simplified projection.
    // For full accuracy, WorldRenderer.screenVectorComponents is needed.
    // Here we approximate by using the aggregate bounds with the scale factor.
    const ox = screenOffsetX + offset.X * scale / 1024
    const oy = screenOffsetY + offset.Y * scale / 1024

    return Rectangle.fromLTRB(
      Math.floor(ox + r.Left * scale),
      Math.floor(oy + r.Top * scale),
      Math.floor(ox + r.Right * scale),
      Math.floor(oy + r.Bottom * scale),
    )
  }
}
