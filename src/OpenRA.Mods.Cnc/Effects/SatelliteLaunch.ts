/**
 * SatelliteLaunch.ts — GPS 卫星发射舱门开启效果
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/SatelliteLaunch.cs (58 lines)
 *
 * 核心范式转换:
 * - C# IEffect + ISpatiallyPartitionable → TypeScript IEffect + ISpatiallyPartitionable
 * - C# Animation (door opening sprite sequence) → shared AnimationStub
 * - C# Animation.PlayThen(sequence, callback) → TypeScript tick counter + callback
 * - C# ScreenMap.Add/Update/Remove → TypeScript stub (3D scene graph)
 * - C# world.AddFrameEndTask(w => w.Add(new GpsSatellite(...)))
 *   → TypeScript world.addEffect(satellite) via deferred task
 * - C# world.AddFrameEndTask(w => { w.Remove(this); w.ScreenMap.Remove(this); })
 *   → TypeScript world.removeEffect(this) via deferred task
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type { WorldRendererStub, IRenderable, PlayerStub, IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEffect } from '../../OpenRA.Game/Effects/IEffect.js'
import type { ISpatiallyPartitionable } from '../../OpenRA.Game/Effects/IEffect.js'
import { AnimationStub } from './AnimationStub.js'

// ---------------------------------------------------------------------------
// GpsPowerInfo (duck-typed)
// ---------------------------------------------------------------------------

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
// GpsSatellite constructor type
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GpsSatelliteConstructor = new (...args: any[]) => any

interface WPosStub {
  X: number
  Y: number
  Z: number
}

// ---------------------------------------------------------------------------
// SatelliteLaunch — effect implementation
// OpenRA 对照: SatelliteLaunch : IEffect, ISpatiallyPartitionable
// ---------------------------------------------------------------------------

export class SatelliteLaunch implements IEffect, ISpatiallyPartitionable {
  private readonly _info: GpsPowerInfoStub
  private readonly _launcher: IGameActor
  private readonly _doors: AnimationStub
  private readonly _pos: WPosStub
  private _frame: number = 0
  private _removed: boolean = false
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
      // OpenRA: launcher.World.AddFrameEndTask(w => {
      //   w.Remove(this);
      //   w.ScreenMap.Remove(this);
      // })
      // The world will call removeEffect on the next frameEndTasks drain.
      // We set _removed so the world knows to clean this up.
      this._removed = true

      // Signal world to remove this effect
      const launcherWorld = (launcher as unknown as { world?: GameWorldManager }).world
      launcherWorld?.addFrameEndTask?.(() => {
        launcherWorld.removeEffect?.(this)
      })
    })

    this._pos = (launcher as unknown as { centerPosition: WPosStub }).centerPosition
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  tick(world: GameWorldManager): void {
    this._doors.tick()

    if (++this._frame === 19) {
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

        // Add to world via frameEndTask (deferred, safe for mid-tick effect creation)
        world.addFrameEndTask?.(() => {
          world.addEffect?.(satellite)
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const palette = this._info.doorPaletteIsPlayerPalette
      ? this._info.doorPalette +
        ((this._launcher as unknown as { owner?: { internalName: string } }).owner
          ?.internalName ?? '')
      : this._info.doorPalette

    return this._doors.render(this._pos as any, palette)
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  get isRemoved(): boolean {
    return this._removed
  }

  get frame(): number {
    return this._frame
  }

  get doors(): AnimationStub {
    return this._doors
  }

  get pos(): WPosStub {
    return this._pos
  }

  get info(): GpsPowerInfoStub {
    return this._info
  }
}
