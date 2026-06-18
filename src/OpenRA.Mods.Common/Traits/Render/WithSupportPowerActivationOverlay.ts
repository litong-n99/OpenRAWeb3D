/**
 * WithSupportPowerActivationOverlay.ts — 支援能力激活时显示装饰覆盖动画
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithSupportPowerActivationOverlay.cs (67 lines)
 *
 * 核心范式转换:
 * - C# Animation + AnimationWithOffset pipeline → TS Animation + AnimationWithOffset
 * - C# BodyOrientation.LocalToWorld / QuantizeOrientation → TS IBodyOrientation
 * - C# RenderUtils.ZOffsetFromCenter → TS 内联静态方法
 * - C# PlayThen callback → TS Animation.playThen(cb)
 * - C# overlay.CurrentSequence.Name → TS overlay.currentSequence?.name
 *
 * RENDER: AnimationWithOffset renders as a billboard Plane in 3D space,
 * positioned relative to the actor's body transform. The overlay appears
 * at the configured offset once on activation, plays through once, then hides.
 *
* WithSupportPowerActivationOverlay migration
 */

import { Animation } from '../../../OpenRA.Game/Graphics/Animation.js'
import { AnimationWithOffset } from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import type { ISequenceSet } from '../../../OpenRA.Game/Graphics/Animation.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifySupportPower,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { RenderSprites } from './RenderSprites.js'
import type { IRenderActor } from './RenderSprites.js'
import type { IBodyOrientation } from './WithIdleOverlay.js'

// ---------------------------------------------------------------------------
// IWorldWithSequences — forward reference to World with sequence sets
// ---------------------------------------------------------------------------

/** Minimal World interface exposing sequence sets for Animation construction. */
export interface IWorldWithSequences {
  readonly Sequences: ISequenceSet
}

// ---------------------------------------------------------------------------
// zOffsetFromCenter — matching OpenRA RenderUtils.ZOffsetFromCenter
// ---------------------------------------------------------------------------

/**
 * Compute Z-sorting offset from the actor's center to a world position.
 *
 * OpenRA 对照: RenderUtils.ZOffsetFromCenter(Actor self, WPos pos, int offset)
 *
 * @param center — the actor's center position
 * @param pos — the overlay world position
 * @param offset — base offset value
 * @returns delta.Y + delta.Z + offset
 */
function zOffsetFromCenter(center: WPos, pos: WPos, offset: number): number {
  const deltaY = pos.Y - center.Y
  const deltaZ = pos.Z - center.Z
  return deltaY + deltaZ + offset
}

// ---------------------------------------------------------------------------
// WithSupportPowerActivationOverlayInfo
// OpenRA 对照: WithSupportPowerActivationOverlayInfo : ConditionalTraitInfo, Requires<RenderSpritesInfo>, Requires<BodyOrientationInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithSupportPowerActivationOverlay.
 *
 * OpenRA 对照: WithSupportPowerActivationOverlayInfo
 */
export interface WithSupportPowerActivationOverlayInfo
  extends ConditionalTraitInfo {
  /** Sequence name to use (default "active").
   *
   * OpenRA 对照: WithSupportPowerActivationOverlayInfo.Sequence
   */
  readonly sequence: string

  /** Position relative to body (default WVec.Zero).
   *
   * OpenRA 对照: WithSupportPowerActivationOverlayInfo.Offset
   */
  readonly offset: WVec

  /** Custom palette name (default null — use actor palette).
   *
   * OpenRA 对照: WithSupportPowerActivationOverlayInfo.Palette
   */
  readonly palette: string | null

  /** Whether the palette is a player-specific palette (default false).
   *
   * OpenRA 对照: WithSupportPowerActivationOverlayInfo.IsPlayerPalette
   */
  readonly isPlayerPalette: boolean
}

/** Default values for WithSupportPowerActivationOverlayInfo. */
export const DEFAULT_ACTIVATION_OVERLAY_INFO: WithSupportPowerActivationOverlayInfo =
  {
    sequence: 'active',
    offset: WVec.Zero,
    palette: null,
    isPlayerPalette: false,
  }

// ---------------------------------------------------------------------------
// WithSupportPowerActivationOverlay
// OpenRA 对照: WithSupportPowerActivationOverlay : ConditionalTrait<Info>, INotifySupportPower
// ---------------------------------------------------------------------------

/**
 * Displays an overlay animation when a support power is triggered.
 *
 * OpenRA 对照: WithSupportPowerActivationOverlay
 *
 * Creates an Animation that plays once then hides. On activation, the
 * animation is made visible and replayed. The overlay is positioned at
 * a configurable offset from the actor's body, with Z-sorting based on
 * world position.
 */
export class WithSupportPowerActivationOverlay
  extends ConditionalTrait<WithSupportPowerActivationOverlayInfo>
  implements INotifySupportPower
{
  /** The underlying animation instance.
   *
   * OpenRA 对照: WithSupportPowerActivationOverlay.overlay
   */
  readonly overlay: Animation

  /** The AnimationWithOffset wrapper registered with RenderSprites. */
  private readonly anim: AnimationWithOffset

  /** The RenderSprites trait on the actor (for Add/Remove). */
  private readonly renderSprites: RenderSprites

  /** Whether the overlay is currently visible.
   *
   * OpenRA 对照: WithSupportPowerActivationOverlay.visible
   */
  private visible: boolean = false

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Construct a WithSupportPowerActivationOverlay.
   *
   * OpenRA 对照: WithSupportPowerActivationOverlay constructor
   *
   * @param info — trait configuration
   * @param self — the actor (must implement IRenderActor)
   * @param rs — the actor's RenderSprites trait
   * @param body — the actor's BodyOrientation trait
   * @param facing — the actor's IFacing trait (null if no facing)
   * @param world — the world with sequence sets
   */
  constructor(
    info: WithSupportPowerActivationOverlayInfo,
    self: IRenderActor,
    rs: RenderSprites,
    body: IBodyOrientation,
    facing: IFacing | null,
    world: IWorldWithSequences,
  ) {
    super(info)
    this.renderSprites = rs

    // Resolve image name from RenderSprites
    const image = rs.getImage(self)

    // Build facing function (same pattern as WithIdleOverlay)
    const facingFunc = WithSupportPowerActivationOverlay.makeFacingFunc(
      facing,
      body,
    )

    // Create the overlay animation
    this.overlay = new Animation(
      world.Sequences,
      image,
      facingFunc,
      () => this.isTraitDisabled,
    )

    // Play sequence once, then hide
    this.overlay.playThen(info.sequence, () => {
      this.visible = false
    })

    // Build position function: body.LocalToWorld(offset.Rotate(quantized))
    const positionFunc = (): WVec => {
      const orientation = facing?.orientation ?? WRot.None
      const quantized = body.quantizeOrientation(orientation)
      return info.offset.rotate(quantized)
    }

    // Build visibility function: hidden if disabled or not visible
    const visibilityFunc = (): boolean => {
      return this.isTraitDisabled || !this.visible
    }

    // Build Z-offset function
    const zOffsetFunc = (p: WPos) =>
      zOffsetFromCenter(self.CenterPosition, p, 1)

    // Create AnimationWithOffset wrapper and register with RenderSprites
    this.anim = new AnimationWithOffset(
      this.overlay,
      positionFunc,
      visibilityFunc,
      zOffsetFunc,
    )

    rs.add(this.anim, info.palette, info.isPlayerPalette)
  }

  // -----------------------------------------------------------------------
  // INotifySupportPower — Charged
  // -----------------------------------------------------------------------

  /**
   * Called when the support power finishes charging.
   * No-op — overlay appears on activation, not charge.
   *
   * OpenRA 对照: INotifySupportPower.Charged(Actor)
   */
  charged(_self: IGameActor): void {
    // Intentional no-op: overlay plays on activation
  }

  // -----------------------------------------------------------------------
  // INotifySupportPower — Activated
  // -----------------------------------------------------------------------

  /**
   * Called when the support power is activated.
   * Makes the overlay visible and replays the animation sequence.
   *
   * OpenRA 对照: INotifySupportPower.Activated(Actor)
   *
   * @param _self — the actor holding the support power
   */
  activated(_self: IGameActor): void {
    this.visible = true
    this.overlay.playThen(
      this.info.sequence,
      () => {
        this.visible = false
      },
    )
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * Dispose resources: remove the animation from RenderSprites.
   */
  override dispose(): void {
    this.renderSprites.remove(this.anim)
    super.dispose()
  }

  // -----------------------------------------------------------------------
  // Test accessors
  // -----------------------------------------------------------------------

  /** Expose visibility for test assertions. */
  get _testVisible(): boolean {
    return this.visible
  }

  /** Expose the AnimationWithOffset wrapper for test assertions. */
  get _testAnim(): AnimationWithOffset {
    return this.anim
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /**
   * Build a facing angle callback from IFacing and IBodyOrientation.
   *
   * OpenRA 对照:
   *   facing == null ? constant(WAngle.Zero)
   *     : body.QuantizeFacing(facing.Facing)
   *
   * @param facing — IFacing trait (null if no facing)
   * @param body — IBodyOrientation trait
   * @returns callback returning facing angle in degrees
   */
  static makeFacingFunc(
    facing: IFacing | null,
    body: IBodyOrientation,
  ): () => number {
    if (!facing) return () => 0
    return () => {
      const qf = body.quantizeFacing(facing.facing)
      return typeof qf === 'number' ? qf : qf.angle
    }
  }
}
