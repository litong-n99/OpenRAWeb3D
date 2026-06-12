/**
 * DestroyResourceWarhead.ts -- Destroys resources in a circle on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/DestroyResourceWarhead.cs
 *
 * 核心范式转换:
 * - C# IResourceLayer trait → ResourceEffect[] deferred effects
 * - C# Map.FindTilesInAnnulus → duck-typed map.findTilesInAnnulus()
 * - C# resourceLayer.GetResource / ClearResources / RemoveResource → deferred
 * - C# byte ResourceAmount → number converted to byte range
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
// DestroyResourceWarhead (对应 OpenRA DestroyResourceWarhead)
// ---------------------------------------------------------------------------

/**
 * Destroys resources in a circle on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.DestroyResourceWarhead
 *
 * Removes resources from cells within a configurable radius.
 * Can target specific resource types or all types.
 * ResourceAmount = 0 means destroy all resources in the cell.
 */
export class DestroyResourceWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Size of the affected area. Provide 2 values for ring (outer/inner).
   *
   * OpenRA 对照: DestroyResourceWarhead.Size (ImmutableArray<int>)
   */
  size: number[] = [0, 0]

  /** Amount of resources to remove. 0 = all resources.
   *
   * OpenRA 对照: DestroyResourceWarhead.ResourceAmount (byte)
   */
  resourceAmount: number = 0

  /** Resource types to remove. Empty = all types.
   *
   * OpenRA 对照: DestroyResourceWarhead.ResourceTypes (FrozenSet<string>)
   */
  resourceTypes: Set<string> = new Set<string>()

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Size !== undefined) this.size = json.Size as number[]
    if (json.ResourceAmount !== undefined) this.resourceAmount = json.ResourceAmount as number
    if (json.ResourceTypes !== undefined) {
      this.resourceTypes = new Set(json.ResourceTypes as string[])
    }
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Destroy resources at the impact position.
   *
   * OpenRA 对照: DestroyResourceWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    _args: WarheadArgs,
  ): WarheadEffect[] {
    const effects: ResourceEffect[] = []

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
    const removeAllTypes = this.resourceTypes.size === 0

    for (const cell of allCells) {
      if (removeAllTypes) {
        effects.push({
          type: 'resource',
          cell,
          resourceType: '', // all types
          action: 'destroy',
          amount: this.resourceAmount,
          removeAllTypes: true,
        })
      } else {
        for (const resType of this.resourceTypes) {
          effects.push({
            type: 'resource',
            cell,
            resourceType: resType,
            action: 'destroy',
            amount: this.resourceAmount,
            removeAllTypes: false,
          })
        }
      }
    }

    return effects
  }
}
