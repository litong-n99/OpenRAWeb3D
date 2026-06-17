/**
 * ConyardChronoVortex.ts — 建造场超时空涡旋特效
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/ConyardChronoVortex.cs (63 lines)
 *
 * 核心范式转换:
 * - C# IEffect + ISpatiallyPartitionable → TypeScript IEffect interface
 * - C# ChronoVortexRenderer lookup via WorldActor → TypeScript renderer resolver
 * - C# WPos + WAngle rotation → TypeScript {X,Y,Z} + angle counter
 * - C# ChronoVortexRenderable → TypeScript stub (deferred to Phase C)
 *
 * NOTE: Visual rendering (ChronoVortexRenderable, ScreenMap) is deferred to
 * Phase C rendering. This class tracks vortex position/orientation and calls
 * the completion callback after 48 frames.
 */

import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Visual size of the vortex.
 *
 * OpenRA 对照: new Size(64, 64)
 */
const VORTEX_SIZE = { width: 64, height: 64 }

/** Offset from the center of the ConYard for the vortex position.
 *
 * OpenRA 对照: new WVec(171, 0, 0)
 */
const VORTEX_OFFSET = { X: 171, Y: 0, Z: 0 }

/** Angular velocity per tick (in WAngle units).
 *
 * OpenRA 对照: new WAngle(42)
 */
const ANGLE_STEP = 42

// ---------------------------------------------------------------------------
// ConyardChronoVortex
// OpenRA 对照: ConyardChronoVortex : IEffect, ISpatiallyPartitionable
// ---------------------------------------------------------------------------

/** Chrono-vortex particle effect at a construction yard during chronoshift.
 *
 * OpenRA 对照: ConyardChronoVortex
 *
 * Creates a rotating vortex sprite around the construction yard. The animation
 * has three phases: opening (frames 0-15), looping (frames 16-31, repeats 3x),
 * and closing (frames 32-47). The completion callback is invoked when the
 * effect finishes.
 */
export class ConyardChronoVortex {
  /** Center position of the ConYard.
   *
   * OpenRA 对照: ConyardChronoVortex.center (WPos)
   */
  readonly center: { X: number; Y: number; Z: number }

  /** Callback invoked when the vortex effect completes.
   *
   * OpenRA 对照: ConyardChronoVortex.onCompletion (Action)
   */
  private readonly _onCompletion: () => void

  /** Current vortex position (rotates around center).
   *
   * OpenRA 对照: ConyardChronoVortex.pos (WPos)
   */
  pos: { X: number; Y: number; Z: number }

  /** Current rotation angle.
   *
   * OpenRA 对照: ConyardChronoVortex.angle (WAngle)
   */
  angle: number = 0

  /** Number of remaining loop iterations (1 opening + N loops + 1 closing).
   *
   * OpenRA 对照: ConyardChronoVortex.loops
   */
  private loops: number = 3

  /** Current animation frame (0-47).
   *
   * OpenRA 对照: ConyardChronoVortex.frame
   */
  frame: number = 0

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(launcher: IGameActor, onCompletion: () => void) {
    this._onCompletion = onCompletion
    this.center = (launcher as any).centerPosition ?? { X: 0, Y: 0, Z: 0 }
    // Initial position: center + offset rotated by angle
    this.pos = this._rotatePosition(0)
  }

  /** Rotate the offset by the given angle around the Y axis (simplified 2D rotation).
   *
   * OpenRA 对照: Offset.Rotate(WRot.FromYaw(angle))
   *
   * NOTE: Full 3D rotation is deferred. This uses a simplified 2D XY rotation.
   * WAngle → radians approximation.
   */
  private _rotatePosition(_angle: number): { X: number; Y: number; Z: number } {
    // NOTE: Simplified 2D rotation in the XY plane.
    const radians = (this.angle / 1024) * Math.PI * 2
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return {
      X: this.center.X + VORTEX_OFFSET.X * cos - VORTEX_OFFSET.Y * sin,
      Y: this.center.Y + VORTEX_OFFSET.X * sin + VORTEX_OFFSET.Y * cos,
      Z: this.center.Z + VORTEX_OFFSET.Z,
    }
  }

  /** Tick the vortex effect.
   *
   * OpenRA 对照: ConyardChronoVortex.Tick(World)
   *
   * Advances the frame counter with loop logic (opening→loop→closing).
   * Rotates the position around the center. Removes itself on completion.
   */
  tick(_world: unknown): void {
    // Frame logic: frames 0-15 opening, 16-31 loop, 32-47 closing
    this.frame++

    if (this.frame === 32 && --this.loops > 0) {
      this.frame = 16 // Loop back
    }

    // Rotate position around center
    this.angle += ANGLE_STEP
    this.pos = this._rotatePosition(this.angle)

    // Remove on completion
    if (this.frame === 48) {
      this._onCompletion()
    }
  }

  /** The visual size of the vortex.
   *
   * OpenRA 对照: new Size(64, 64)
   */
  get size(): { width: number; height: number } {
    return VORTEX_SIZE
  }

  /** Whether the vortex has completed.
   *
   * OpenRA 对照: frame == 48
   */
  get isComplete(): boolean {
    return this.frame >= 48
  }
}
