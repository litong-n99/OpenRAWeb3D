/**
 * GpsDot.ts — GPS minimap dot indicator (shows enemy positions when GPS active)
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/GpsDot.cs (58 lines)
 *
 * 核心范式转换:
 * - C# GpsDotEffect (IRenderable added to World) → TypeScript GpsDotEffect class
 *   (full rendering implemented in Phase B.8 via Billboard IRenderable)
 * - C# INotifyCreated/INotifyAddedToWorld/INotifyRemovedFromWorld
 *   → TypeScript same interfaces (already migrated in Ch3)
 * - C# frameEndTask to add/remove World effects → direct add/remove on world
 *
 * Phase B.8: Replaced the forward stub {} with the real GpsDotEffect class
 * that renders GPS dots as Billboard renderables through fog of war.
 */

import type {
  IGameActor,
  INotifyCreated,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  ITraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { GpsDotEffect } from '../Effects/GpsDotEffect.js'
import type { GpsDotInfo as GpsDotEffectInfo } from '../Effects/GpsDotEffect.js'

// ---------------------------------------------------------------------------
// GpsDotInfo
// OpenRA 对照: GpsDotInfo : TraitInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the GPS minimap dot indicator.
 *
 * OpenRA 对照: GpsDotInfo
 */
export class GpsDotInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Sprite collection for the GPS dot symbol.
   *
   * OpenRA 对照: GpsDotInfo.Image
   */
  readonly image: string

  /** Sprite sequence name used for this actor type.
   *
   * OpenRA 对照: GpsDotInfo.String
   */
  readonly string: string

  /** Palette prefix for the indicator (defaults to player color).
   *
   * OpenRA 对照: GpsDotInfo.IndicatorPalettePrefix
   */
  readonly indicatorPalettePrefix: string

  constructor(params?: {
    image?: string
    string?: string
    indicatorPalettePrefix?: string
  }) {
    this.image = params?.image ?? 'gpsdot'
    this.string = params?.string ?? 'Infantry'
    this.indicatorPalettePrefix = params?.indicatorPalettePrefix ?? 'player'
  }

  create(_init: IGameActor): GpsDot {
    return new GpsDot(this)
  }
}

// ---------------------------------------------------------------------------
// GpsDot
// OpenRA 对照: GpsDot : INotifyCreated, INotifyAddedToWorld, INotifyRemovedFromWorld
// ---------------------------------------------------------------------------

/**
 * Shows an indicator revealing the actor underneath the fog when a GPSWatcher
 * is activated.
 *
 * OpenRA 对照: GpsDot
 *
 * This trait is attached to individual units. It creates a GpsDotEffect
 * that renders a small dot on the minimap when GPS is active.
 *
 * @traitLocation Actor (unit/building that should show GPS dot)
 */
export class GpsDot
  implements INotifyCreated, INotifyAddedToWorld, INotifyRemovedFromWorld
{
  readonly info: GpsDotInfo

  /** The GPS dot effect instance.
   *
   * OpenRA 对照: GpsDot.effect
   */
  private _effect: GpsDotEffect | null = null

  constructor(info: GpsDotInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // INotifyCreated
  // -------------------------------------------------------------------------

  /** Create the GpsDotEffect on actor creation.
   *
   * OpenRA 对照: GpsDot.INotifyCreated.Created(Actor)
   */
  created(self: IGameActor): void {
    const effectInfo: GpsDotEffectInfo = {
      image: this.info.image,
      string_: this.info.string,
      indicatorPalettePrefix: this.info.indicatorPalettePrefix,
    }
    this._effect = new GpsDotEffect(self, effectInfo)
  }

  // -------------------------------------------------------------------------
  // INotifyAddedToWorld
  // -------------------------------------------------------------------------

  /** Add the GpsDotEffect to the world when the actor enters the game.
   *
   * OpenRA 对照: GpsDot.INotifyAddedToWorld.AddedToWorld(Actor)
   *
   * Uses frameEndTask to safely add the effect after all other tick tasks
   * have completed (matching OpenRA behavior).
   */
  addedToWorld(self: IGameActor): void {
    if (this._effect) {
      // OpenRA: self.World.AddFrameEndTask(w => w.Add(effect))
      const world = (self as any).world
      if (world && typeof world.addEffect === 'function') {
        world.addEffect(this._effect)
      }
    }
  }

  // -------------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // -------------------------------------------------------------------------

  /** Remove the GpsDotEffect when the actor leaves the game.
   *
   * OpenRA 对照: GpsDot.INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   */
  removedFromWorld(self: IGameActor): void {
    if (this._effect) {
      // OpenRA: self.World.AddFrameEndTask(w => w.Remove(effect))
      const world = (self as any).world
      if (world && typeof world.removeEffect === 'function') {
        world.removeEffect(this._effect)
      }
      this._effect.dispose()
      this._effect = null
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** The GpsDotEffect instance, for testing.
   *
   * OpenRA 对照: GpsDot.effect (private field, exposed for testability)
   */
  get effect(): GpsDotEffect | null {
    return this._effect
  }
}
