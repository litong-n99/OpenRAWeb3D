/**
 * ChronoshiftPostProcessEffect.ts — 超时空传送后处理特效（全屏颜色偏移）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.cs (56 lines)
 *
 * 核心范式转换:
 * - C# RenderPostProcessPassBase (OpenGL shader-driven fullscreen pass)
 *   → TypeScript forward stub (Babylon.js PostProcess deferred to Ch19 Phase C)
 * - C# shader.SetVec("Blend", ...) → TypeScript stored blend factor
 * - C# ITick → TypeScript ITick with tick actor lifecycle
 *
 * NOTE: The actual Babylon.js PostProcess shader (chroma-shift) is deferred to
 * Phase C rendering subsystem. This trait stores the state and exposes the
 * blend factor for the post-process renderer to consume at render time.
 */

import type { IGameActor, ITick, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ChronoshiftPostProcessEffectInfo
// OpenRA 对照: ChronoshiftPostProcessEffectInfo : TraitInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the chronoshift screen color-shift effect.
 *
 * OpenRA 对照: ChronoshiftPostProcessEffectInfo
 *
 * Applied to the World actor. When enabled, a fullscreen chroma-shift
 * post-process effect blends the screen for the configured duration.
 */
export class ChronoshiftPostProcessEffectInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Duration of the chronoshift effect, measured in ticks.
   *
   * OpenRA 对照: ChronoshiftPostProcessEffectInfo.ChronoEffectLength
   */
  readonly chronoEffectLength: number

  constructor(params?: { chronoEffectLength?: number }) {
    this.chronoEffectLength = params?.chronoEffectLength ?? 60
  }

  create(_init: IGameActor): ChronoshiftPostProcessEffect {
    return new ChronoshiftPostProcessEffect(this)
  }
}

// ---------------------------------------------------------------------------
// ChronoshiftPostProcessEffect
// OpenRA 对照: ChronoshiftPostProcessEffect : RenderPostProcessPassBase, ITick
// ---------------------------------------------------------------------------

/**
 * Applies a palette full-screen rotation during chronoshifts.
 *
 * OpenRA 对照: ChronoshiftPostProcessEffect
 *
 * For the configured number of ticks after Enable() is called, the blend
 * factor decreases linearly from 1.0 to 0.0, producing a fading color-shift.
 *
 * NOTE: The Babylon.js PostProcess rendering pipeline integration is deferred
 * to TODO-19.C.2. This class stores state and exposes the blend factor for
 * the future post-process renderer.
 */
export class ChronoshiftPostProcessEffect implements ITick {
  readonly info: ChronoshiftPostProcessEffectInfo

  /** Remaining frames of the effect.
   *
   * OpenRA 对照: ChronoshiftPostProcessEffect.remainingFrames
   */
  private _remainingFrames: number = 0

  /** The post-process pass name.
   *
   * OpenRA 对照: RenderPostProcessPassBase("chronoshift", AfterWorld)
   *
   * NOTE: This is a logical pass name. The actual Babylon.js PostProcess
   * attachment is deferred to Phase C.
   */
  readonly passName: string = 'chronoshift'

  constructor(info: ChronoshiftPostProcessEffectInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /** Tick the remaining frames counter down.
   *
   * OpenRA 对照: ChronoshiftPostProcessEffect.ITick.Tick(Actor)
   */
  tick(_self: IGameActor): void {
    if (this._remainingFrames > 0) {
      this._remainingFrames--
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Enable the chronoshift effect for the configured duration.
   *
   * OpenRA 对照: ChronoshiftPostProcessEffect.Enable()
   */
  enable(): void {
    this._remainingFrames = this.info.chronoEffectLength
  }

  /** Whether the effect is currently active.
   *
   * OpenRA 对照: ChronoshiftPostProcessEffect.Enabled
   */
  get enabled(): boolean {
    return this._remainingFrames > 0
  }

  /** The current blend factor (1.0 → 0.0 fading over the effect duration).
   *
   * OpenRA 对照: PrepareRender() → shader.SetVec("Blend", ...)
   *
   * Returns 0.0 if the effect is not active.
   */
  get blendFactor(): number {
    if (!this.enabled || this.info.chronoEffectLength <= 0) return 0
    return this._remainingFrames / this.info.chronoEffectLength
  }

  /** Remaining frames, exposed for testing.
   *
   * OpenRA 对照: ChronoshiftPostProcessEffect.remainingFrames (private)
   */
  get remainingFrames(): number {
    return this._remainingFrames
  }
}
