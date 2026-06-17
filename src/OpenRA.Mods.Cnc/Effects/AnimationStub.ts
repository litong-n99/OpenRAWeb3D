/**
 * AnimationStub.ts — shared animation stub for C&C projectiles and effects
 * OpenRA 对照: OpenRA.Graphics.Animation
 *
 * 核心范式转换:
 * - C# Animation (2D sprite sequence with palette, ticks, rendering)
 *   → TypeScript logical animation tracker
 * - C# Animation.Render(WPos, PaletteReference) → TypeScript stub render
 *
 * Replaces duplicated AnimationStub in TeslaZap, IonCannon, DropPodImpact,
 * SatelliteLaunch, and other C&C effects.
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// AnimationStub
// OpenRA 对照: Animation (OpenRA.Graphics)
// ---------------------------------------------------------------------------

export class AnimationStub {
  private _ticks: number = 0
  private _length: number = 0
  private _onComplete: (() => void) | null = null
  private _started: boolean = false
  private _sequence: string = ''

  /** The image/collection name this animation uses.
   *
   * OpenRA 对照: Animation.Image
   */
  readonly image: string

  constructor(_world: unknown, image: string, frameCount: number = 12) {
    this.image = image
    this._length = frameCount
  }

  /** Start playing a sequence, then call onComplete.
   *
   * OpenRA 对照: Animation.PlayThen(sequence, callback)
   *
   * @param sequence — the sequence name to play
   * @param onComplete — invoked after the last frame completes
   */
  playThen(sequence: string, onComplete: () => void): void {
    this._started = true
    this._sequence = sequence
    this._ticks = 0
    this._onComplete = onComplete
  }

  /** Start playing a repeating sequence.
   *
   * OpenRA 对照: Animation.PlayRepeating(sequence)
   */
  playRepeating(sequence: string): void {
    this._started = true
    this._sequence = sequence
    this._ticks = 0
    this._onComplete = null
  }

  /** Advance the animation by one frame.
   *
   * OpenRA 对照: Animation.Tick()
   */
  tick(): void {
    if (!this._started) return
    this._ticks++

    if (this._onComplete && this._ticks >= this._length) {
      const cb = this._onComplete
      this._onComplete = null
      cb()
    }
  }

  /** Get renderables for this animation at the given position.
   *
   * OpenRA 对照: Animation.Render(WPos, PaletteReference)
   *
   * NOTE: Actual sprite rendering is deferred to Phase C rendering.
   */
  render(_pos: WPos, _palette: unknown): readonly IRenderable[] {
    return []
  }

  /** Get renderables for UI overlay rendering.
   *
   * OpenRA 对照: Animation.RenderUI(WorldRenderer, int2, WVec, int, PaletteReference)
   *
   * NOTE: Actual sprite rendering is deferred to Phase C rendering.
   */
  renderUI(
    _wr: unknown,
    _screenPos: unknown,
    _offset: WPos,
    _scale: number,
    _palette: unknown,
  ): readonly IRenderable[] {
    return []
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  get isComplete(): boolean {
    return this._ticks >= this._length
  }

  get currentTick(): number {
    return this._ticks
  }

  get sequence(): string {
    return this._sequence
  }

  get isStarted(): boolean {
    return this._started
  }
}
