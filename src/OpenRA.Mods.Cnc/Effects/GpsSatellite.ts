/**
 * GpsSatellite.ts — GPS 卫星升空效果
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/GpsSatellite.cs (60 lines)
 *
 * 核心范式转换:
 * - C# IEffect + ISpatiallyPartitionable → TypeScript IEffect interface
 * - C# Animation (2D sprite) → TypeScript logical animation stub
 * - C# ScreenMap.Add/Update/Remove → TypeScript stub (3D scene graph)
 * - C# WPos += new WVec(0, 0, 427) → TypeScript position Z increment
 *
 * NOTE: Visual rendering (Animation, ScreenMap) is deferred to Phase C rendering.
 * This class tracks the satellite state and calls GpsWatcher.ReachedOrbit().
 */

import type { PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// GpsSatellite
// OpenRA 对照: GpsSatellite : IEffect, ISpatiallyPartitionable
// ---------------------------------------------------------------------------

/** Satellite launch animation and GPS activation sequence.
 *
 * OpenRA 对照: GpsSatellite
 *
 * Represents a GPS satellite ascending from a launch structure into orbit.
 * When the reveal delay expires, it triggers GpsWatcher.ReachedOrbit() to
 * activate GPS reveal for the owning player and then removes itself.
 */
export class GpsSatellite {
  /** The player who launched this satellite.
   *
   * OpenRA 对照: GpsSatellite.launcher (Player)
   */
  readonly launcher: PlayerStub

  /** Image used for the satellite animation.
   *
   * OpenRA 对照: GpsSatellite.anim.Image
   */
  readonly image: string

  /** Animation sequence name.
   *
   * OpenRA 对照: GpsSatellite.anim current sequence
   */
  readonly sequence: string

  /** Palette name for rendering.
   *
   * OpenRA 对照: GpsSatellite.palette
   */
  readonly palette: string

  /** Ticks until GPS reveal activates.
   *
   * OpenRA 对照: GpsSatellite.revealDelay
   */
  readonly revealDelay: number

  /** World position of the satellite.
   *
   * OpenRA 对照: GpsSatellite.pos (WPos)
   */
  pos: { X: number; Y: number; Z: number }

  /** Tick counter since launch.
   *
   * OpenRA 对照: GpsSatellite.tick (field)
   */
  private _tickCounter: number = 0

  /** Whether the satellite has reached orbit and triggered GPS.
   *
   * OpenRA 对照: tick > revealDelay check
   */
  private _reachedOrbit: boolean = false

  /** World reference for accessing GpsWatcher.
   *
   * OpenRA 对照: GpsWatcher access via launcher.PlayerActor.Trait<GpsWatcher>()
   */
  private readonly _gpsWatcherResolver: (launcher: PlayerStub) => {
    reachedOrbit(launcher: PlayerStub): void
  } | null

  constructor(
    world: unknown,
    pos: { X: number; Y: number; Z: number },
    image: string,
    sequence: string,
    palette: string,
    revealDelay: number,
    launcher: PlayerStub,
    gpsWatcherResolver: (launcher: PlayerStub) => { reachedOrbit(launcher: PlayerStub): void } | null,
  ) {
    this.pos = { X: pos.X, Y: pos.Y, Z: pos.Z }
    this.image = image
    this.sequence = sequence
    this.palette = palette
    this.revealDelay = revealDelay
    this.launcher = launcher
    this._gpsWatcherResolver = gpsWatcherResolver

    // NOTE: In OpenRA, this would create an Animation and add to ScreenMap:
    //   anim = new Animation(world, image);
    //   anim.PlayRepeating(sequence);
    //   world.ScreenMap.Add(this, pos, anim.Image);
    void world
  }

  /** Tick the satellite effect.
   *
   * OpenRA 对照: GpsSatellite.Tick(World)
   *
   * Advances the animation, moves the satellite upward, and triggers
   * GPS activation when the reveal delay expires.
   */
  tick(_world: unknown): void {
    // Once orbit is reached, stop all processing.
    // In C#, the effect is removed via AddFrameEndTask after reachedOrbit.
    if (this._reachedOrbit) return

    // Advance animation
    // NOTE: anim.Tick() — deferred to Phase C rendering
    this._tickCounter++

    // Move satellite upward
    // OpenRA: pos += new WVec(0, 0, 427)
    this.pos = {
      X: this.pos.X,
      Y: this.pos.Y,
      Z: this.pos.Z + 427,
    }

    // Check if GPS should activate (one-shot: only on the tick that exceeds revealDelay)
    if (this._tickCounter > this.revealDelay) {
      this._reachedOrbit = true

      const gpsWatcher = this._gpsWatcherResolver(this.launcher)
      if (gpsWatcher) {
        gpsWatcher.reachedOrbit(this.launcher)
      }

      // NOTE: In OpenRA, the effect is removed via frameEndTask:
      //   world.AddFrameEndTask(w => { w.Remove(this); w.ScreenMap.Remove(this); });
    }

    // NOTE: world.ScreenMap.Update(this, pos, anim.Image) — deferred to Phase C
  }

  /** Whether the satellite has reached orbit.
   *
   * OpenRA 对照: tick > revealDelay
   */
  get reachedOrbit(): boolean {
    return this._reachedOrbit
  }

  /** Current tick count since launch.
   *
   * OpenRA 对照: GpsSatellite.tick
   */
  get currentTick(): number {
    return this._tickCounter
  }
}
