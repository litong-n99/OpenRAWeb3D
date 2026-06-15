/**
 * Parachute.ts — 降落伞下落活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Parachute.cs
 *
 * 核心范式转换:
 * - C# IPositionable trait access → TypeScript duck-typed access
 * - C# self.Info.TraitInfo<ParachutableInfo>() → actor info lookup
 * - C# IsInterruptible = false → this.interruptible = false
 * - C# self.World.Map.CenterOfCell(self.Location).Z → map.centerOfCell().Z
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { IPositionable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { INotifyParachute, ParachutableInfo } from './Air/AircraftActivityInterfaces.js'

// ---------------------------------------------------------------------------
// Parachute
// ---------------------------------------------------------------------------

/**
 * Slowly descend to the ground under a parachute.
 *
 * OpenRA 对照: Parachute activity
 *
 * - Non-interruptible.
 * - On first run: records ground level and notifies INotifyParachute traits.
 * - Each tick: moves down by fallRate.
 * - On last run: snaps to ground level and notifies landing.
 */
export class Parachute extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Positionable trait used to update actor position. */
  private readonly pos: IPositionable

  /** Fall vector (0, 0, fallRate). */
  private readonly fallVector: WVec

  /** Ground level Z coordinate. */
  private groundLevel: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Parachute activity.
   *
   * OpenRA 对照: Parachute(Actor self)
   *
   * @param self — the actor parachuting
   */
  constructor(self: GameActor) {
    super()
    this.isInterruptible = false

    const actorAny = self as unknown as {
      occupiesSpace?: unknown
      info?: { traitInfo?: <T>(name: string) => T | null }
    }
    const pos = actorAny.occupiesSpace as IPositionable | undefined
    if (!pos) {
      throw new Error('Parachute requires an IPositionable trait on the actor')
    }
    this.pos = pos

    const parachutableInfo = actorAny.info?.traitInfo?.<ParachutableInfo>('Parachutable')
    const fallRate = parachutableInfo?.fallRate?.length ?? 0
    this.fallVector = new WVec(0, 0, fallRate)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Record ground level and notify parachute start.
   *
   * OpenRA 对照: Parachute.OnFirstRun(Actor)
   */
  protected override onFirstRun(self: GameActor): void {
    const actorAny = self as unknown as {
      location?: { X: number; Y: number; Bits: number }
      world?: { map?: { centerOfCell: (cell: unknown) => WPos } }
    }
    const location = actorAny.location
    if (location && actorAny.world?.map?.centerOfCell) {
      this.groundLevel = actorAny.world.map.centerOfCell(location).Z
    }

    const actorTraits = self as unknown as { traits?: Map<string, unknown> }
    if (actorTraits.traits) {
      for (const [, trait] of actorTraits.traits) {
        const notify = trait as Partial<INotifyParachute>
        if (typeof notify.onParachute === 'function') {
          notify.onParachute(self)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Fall by fallRate each tick.
   *
   * OpenRA 对照: Parachute.Tick(Actor)
   *
   * @param self — the actor parachuting
   * @returns true when the actor reaches the ground
   */
  override tick(self: GameActor): boolean {
    const centerPos = this.pos.centerPosition
    const nextPosition = WPos.subtractVec(centerPos, this.fallVector)
    if (nextPosition.Z < this.groundLevel) {
      return true
    }

    this.pos.setCenterPosition(self, nextPosition)
    return false
  }

  // ---------------------------------------------------------------------------
  // Last run
  // ---------------------------------------------------------------------------

  /**
   * Snap to ground level and notify landing.
   *
   * OpenRA 对照: Parachute.OnLastRun(Actor)
   */
  protected override onLastRun(self: GameActor): void {
    const centerPosition = this.pos.centerPosition
    const landingPosition = new WPos(centerPosition.X, centerPosition.Y, this.groundLevel)
    this.pos.setCenterPosition(self, landingPosition)

    const actorTraits = self as unknown as { traits?: Map<string, unknown> }
    if (actorTraits.traits) {
      for (const [, trait] of actorTraits.traits) {
        const notify = trait as Partial<INotifyParachute>
        if (typeof notify.onLanded === 'function') {
          notify.onLanded(self)
        }
      }
    }
  }
}
