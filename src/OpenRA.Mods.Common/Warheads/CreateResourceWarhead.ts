/**
 * CreateResourceWarhead.ts -- Creates resources in a circle on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/CreateResourceWarhead.cs
 *
 * 核心范式转换:
 * - C# IResourceLayer trait → ResourceEffect[] deferred effects
 * - C# world.SharedRandom → Math.random() (stub -- full MersenneTwister later)
 * - C# resourceLayer.CanAddResource / AddResource → deferred
 */

import type { WPos } from '../../OpenRA.Game/WPos.js'
import {
  Warhead,
  type WarheadArgs,
  type ResourceEffect,
  type WarheadEffect,
  type WarheadActorLike,
  type WarheadWorldLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CreateResourceWarhead (对应 OpenRA CreateResourceWarhead)
// ---------------------------------------------------------------------------

/**
 * Creates resources in a circle on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.CreateResourceWarhead
 *
 * Adds resource splatters to cells within a configurable radius.
 * Each cell receives a random amount up to max density minus current.
 */
export class CreateResourceWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Size of the affected area. Provide 2 values for ring (outer/inner).
   *
   * OpenRA 对照: CreateResourceWarhead.Size (ImmutableArray<int>)
   */
  size: number[] = [0, 0]

  /** Resource type to add.
   *
   * OpenRA 对照: CreateResourceWarhead.AddsResourceType
   */
  addsResourceType: string = ''

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Size !== undefined) this.size = json.Size as number[]
    if (json.AddsResourceType !== undefined) this.addsResourceType = json.AddsResourceType as string
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Create resources at the impact position.
   *
   * OpenRA 对照: CreateResourceWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    _args: WarheadArgs,
  ): WarheadEffect[] {
    const effects: ResourceEffect[] = []

    if (!this.addsResourceType) return effects

    const actorLike = firedBy as unknown as WarheadActorLike
    const world: WarheadWorldLike | undefined = actorLike.world
    if (!world?.map) return effects

    const map = world.map

    // Check air threshold
    const dat = map.distanceAboveTerrain(pos)
    if (dat.length > this.airThreshold.length) return effects

    const targetTile = map.cellContaining(pos)

    const maxRange = this.size.length > 0 ? this.size[0] : 0
    const minRange = (this.size.length > 1 && this.size[1] > 0) ? this.size[1] : 0

    const allCells = map.findTilesInAnnulus(targetTile, minRange, maxRange)

    for (const cell of allCells) {
      // Random splatter amount: 1 to 255 (byte range)
      const randomAmount = Math.floor(Math.random() * 255) + 1

      // NOTE: CanAddResource(), maxDensity, and GetResource() checks (C# lines
      // 48-55) are deferred to the frame-end ResourceEffect handler. The handler
      // must validate resource capacity before applying the effect.
      effects.push({
        type: 'resource',
        cell,
        resourceType: this.addsResourceType,
        action: 'create',
        amount: randomAmount,
        removeAllTypes: false,
      })
    }

    return effects
  }
}
