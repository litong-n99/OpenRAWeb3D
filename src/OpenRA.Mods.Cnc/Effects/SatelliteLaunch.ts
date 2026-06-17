/**
 * SatelliteLaunch.ts — GPS 卫星发射舱门开启效果
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/SatelliteLaunch.cs (58 lines)
 *
 * 核心范式转换:
 * - C# IEffect + ISpatiallyPartitionable → TypeScript IEffect + ISpatiallyPartitionable
 * - C# Animation (door opening sprite sequence) → TypeScript animation stub
 * - C# Animation.PlayThen(sequence, callback) → TypeScript tick counter + callback
 * - C# ScreenMap.Add/Update/Remove → TypeScript stub (3D scene graph)
 * - C# world.AddFrameEndTask(w => w.Add(new GpsSatellite(...)))
 *   → TypeScript GpsSatellite creation stub
 * - C# launcher.Owner.InternalName → TypeScript player name resolution
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type { WorldRendererStub, IRenderable, PlayerStub, IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEffect } from '../../OpenRA.Game/Effects/IEffect.js'
import type { ISpatiallyPartitionable } from '../../OpenRA.Game/Effects/IEffect.js'

// ---------------------------------------------------------------------------
// Animation stub (same pattern as projectiles)
// ---------------------------------------------------------------------------

/** Minimal animation stub for door opening sequence. */
class AnimationStub {
  private _ticks: number = 0
  private _length: number = 0
  private _onComplete: (() => void) | null = null
  private _started: boolean = false

  readonly image: string

  constructor(_world: unknown, image: string) {
    this.image = image
  }

  playThen(sequence: string, onComplete: () => void): void {
    this._started = true
    this._length = 12
    this._onComplete = onComplete
    void sequence
  }

  tick(): void {
    if (!this._started) return
    this._ticks++
    if (this._ticks >= this._length && this._onComplete) {
      const cb = this._onComplete
      this._onComplete = null
      cb()
    }
  }

  get isComplete(): boolean {
    return this._ticks >= this._length
  }

  get currentTick(): number {
    return this._ticks
  }

  render(_pos: unknown, _palette: unknown): readonly IRenderable[] {
    return []
  }
}

// ---------------------------------------------------------------------------
// GpsPowerInfo (duck-typed)
// OpenRA 对照: GpsPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for GpsPower (subset needed by SatelliteLaunch).
 *
 * OpenRA 对照: GpsPowerInfo
 */
export interface GpsPowerInfoStub {
  readonly doorImage: string
  readonly doorSequence: string
  readonly doorPalette: string
  readonly doorPaletteIsPlayerPalette: boolean
  readonly satelliteImage: string
  readonly satelliteSequence: string
  readonly satellitePalette: string
  readonly satellitePaletteIsPlayerPalette: boolean
  readonly revealDelay: number
}

// ---------------------------------------------------------------------------
// GpsSatellite stub (forward reference)
// ---------------------------------------------------------------------------

type GpsSatelliteConstructor = new (
  world: unknown,
  pos: WPosStub,
  image: string,
  sequence: string,
  palette: string,
  revealDelay: number,
  launcher: PlayerStub,
) => unknown

interface WPosStub {
  X: number
  Y: number
  Z: number
}

// ---------------------------------------------------------------------------
// SatelliteLaunch — effect implementation
// OpenRA 对照: SatelliteLaunch : IEffect, ISpatiallyPartitionable
// ---------------------------------------------------------------------------

/**
 * Satellite launch effect: opens the construction yard doors and
 * spawns a GpsSatellite ascending into the sky.
 *
 * OpenRA 对照: SatelliteLaunch
 *
 * The door animation plays for 12 frames. At frame 19 (ticks),
 * the GpsSatellite is spawned and begins its ascent to orbit.
 */
export class SatelliteLaunch implements IEffect, ISpatiallyPartitionable {
  private readonly _info: GpsPowerInfoStub
  private readonly _launcher: IGameActor
  private readonly _doors: AnimationStub
  private readonly _pos: WPosStub
  private _frame: number = 0
  private _removed: boolean = false

  /** Factory for creating GpsSatellite. Injected for testability.
   *
   * OpenRA 对照: new GpsSatellite(...)
   */
  private readonly _satelliteFactory: GpsSatelliteConstructor | null

  constructor(
    launcher: IGameActor,
    info: GpsPowerInfoStub,
    satelliteFactory?: GpsSatelliteConstructor,
  ) {
    this._info = info
    this._launcher = launcher
    this._satelliteFactory = satelliteFactory ?? null

    this._doors = new AnimationStub(launcher, info.doorImage)
    this._doors.playThen(info.doorSequence, () => {
      // OpenRA: launcher.World.AddFrameEndTask(w => { w.Remove(this); w.ScreenMap.Remove(this); })
      this._removed = true
    })

    this._pos = (launcher as unknown as { centerPosition: WPosStub }).centerPosition

    // OpenRA: launcher.World.ScreenMap.Add(this, pos, doors.Image)
    // NOTE: ScreenMap deferred
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: SatelliteLaunch.Tick(World)
  // ---------------------------------------------------------------------------

  /**
   * Advance the satellite launch by one tick.
   *
   * OpenRA 对照: SatelliteLaunch.Tick(World)
   *
   * Advances the door animation. At frame 19, creates a GpsSatellite
   * that ascends to orbit and activates GPS.
   */
  tick(world: GameWorldManager): void {
    this._doors.tick()

    // OpenRA: world.ScreenMap.Update(this, pos, doors.Image)
    // NOTE: ScreenMap deferred

    if (++this._frame === 19) {
      // Resolve palette (player-specific or fixed)
      const palette = this._info.satellitePaletteIsPlayerPalette
        ? this._info.satellitePalette +
          ((this._launcher as unknown as { owner?: { internalName: string } }).owner
            ?.internalName ?? '')
        : this._info.satellitePalette

      // OpenRA: world.AddFrameEndTask(w => w.Add(new GpsSatellite(...)))
      if (this._satelliteFactory) {
        const satellite = new this._satelliteFactory(
          world,
          this._pos,
          this._info.satelliteImage,
          this._info.satelliteSequence,
          palette,
          this._info.revealDelay,
          (this._launcher as unknown as { owner: PlayerStub }).owner,
        )
        // NOTE: In OpenRA, the effect is added via frameEndTask
        void satellite
      }
    }

    void world
  }

  // ---------------------------------------------------------------------------
  // Render
  // OpenRA 对照: SatelliteLaunch.Render(WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * Collect renderables for the door animation.
   *
   * OpenRA 对照: SatelliteLaunch.Render(WorldRenderer)
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const palette = this._info.doorPaletteIsPlayerPalette
      ? this._info.doorPalette +
        ((this._launcher as unknown as { owner?: { internalName: string } }).owner
          ?.internalName ?? '')
      : this._info.doorPalette

    return this._doors.render(this._pos, palette)
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  /** Whether the effect has been removed.
   *
   * OpenRA 对照: SatelliteLaunch removal via frameEndTask
   */
  get isRemoved(): boolean {
    return this._removed
  }

  /** Current frame counter.
   *
   * OpenRA 对照: SatelliteLaunch.frame
   */
  get frame(): number {
    return this._frame
  }

  /** The door animation instance.
   *
   * OpenRA 对照: SatelliteLaunch.doors
   */
  get doors(): AnimationStub {
    return this._doors
  }

  /** The launch position.
   *
   * OpenRA 对照: SatelliteLaunch.pos
   */
  get pos(): WPosStub {
    return this._pos
  }

  /** Configuration info.
   *
   * OpenRA 对照: SatelliteLaunch.info
   */
  get info(): GpsPowerInfoStub {
    return this._info
  }
}
