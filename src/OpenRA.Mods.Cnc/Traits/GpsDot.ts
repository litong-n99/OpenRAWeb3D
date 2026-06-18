/**
 * GpsDot.ts — GPS 小地图定位点（GPS激活时显示敌方单位位置）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/GpsDot.cs (58 lines)
 *
 * 核心范式转换:
 * - C# GpsDotEffect (IRenderable added to World) → TypeScript forward stub
 *   (GpsDotEffect migration is deferred to )
 * - C# INotifyCreated/INotifyAddedToWorld/INotifyRemovedFromWorld
 *   → TypeScript same interfaces (already migrated in Ch3)
 * - C# frameEndTask to add/remove World effects → direct add/remove
 *
 * NOTE: The GpsDotEffect visual rendering is deferred to  in Phase C.
 * This trait manages the lifecycle (create/add/remove) but the actual effect
 * rendering is stubbed.
 */

import type {
  IGameActor,
  INotifyCreated,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  ITraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

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
// GpsDotEffect forward stub
// ---------------------------------------------------------------------------

/**
 * Forward declaration for GpsDotEffect.
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.Effects.GpsDotEffect
 *
* Full migration of GpsDotEffect will provide the visual
 * rendering of the GPS dot on the minimap.
 *
 * NOTE: This stub is intentionally minimal. The real GpsDotEffect class
 * (119 lines C#) creates an IRenderable that draws a small sprite indicator
 * on the radar/minimap for enemy actors when GPS is active.
 */
interface GpsDotEffectStub {
  readonly self: IGameActor
  readonly info: GpsDotInfo
}

/** Create a stubbed GpsDotEffect instance. */
function createGpsDotEffectStub(self: IGameActor, info: GpsDotInfo): GpsDotEffectStub {
  return { self, info }
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
  private _effect: GpsDotEffectStub | null = null

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
    this._effect = createGpsDotEffectStub(self, this.info)
    // Replace with real GpsDotEffect(self, info)
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
      // NOTE: frameEndTask deferred — effect is already created in created().
      // The actual visual attachment to the scene will be done by the full
      // GpsDotEffect implementation in .
      void self
    }
  }

  // -------------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // -------------------------------------------------------------------------

  /** Remove the GpsDotEffect when the actor leaves the game.
   *
   * OpenRA 对照: GpsDot.INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   *
   * Uses frameEndTask to safely remove the effect.
   */
  removedFromWorld(self: IGameActor): void {
    if (this._effect) {
      // OpenRA: self.World.AddFrameEndTask(w => w.Remove(effect))
      // NOTE: frameEndTask deferred — cleanup is handled by dispose().
      void self
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** The GpsDotEffect instance, for testing.
   *
   * OpenRA 对照: GpsDot.effect (private field, exposed for testability)
   */
  get effect(): GpsDotEffectStub | null {
    return this._effect
  }
}
