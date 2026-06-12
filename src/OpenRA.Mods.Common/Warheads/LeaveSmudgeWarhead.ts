/**
 * LeaveSmudgeWarhead.ts -- Creates terrain scorch smudges on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/LeaveSmudgeWarhead.cs
 *
 * 核心范式转换:
 * - C# SmudgeLayer trait lookup → ephemeral smudge effects (SmudgeEffect)
 * - C# Map.FindTilesInAnnulus → duck-typed map.findTilesInAnnulus()
 * - C# FrozenSet<SmudgeType> → Set<string>
 * - C# TerrainInfo.AcceptsSmudgeType → duck-typed acceptsSmudgeType
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  Warhead,
  type WarheadArgs,
  type SmudgeEffect,
  type WarheadEffect,
  type WarheadActorLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// LeaveSmudgeWarhead (对应 OpenRA LeaveSmudgeWarhead)
// ---------------------------------------------------------------------------

/**
 * Creates a smudge (terrain scorch mark) on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.LeaveSmudgeWarhead
 *
 * Applies smudge types to terrain cells within a configurable
 * size (annulus or circle). Only affects cells where the
 * terrain accepts the smudge type.
 */
export class LeaveSmudgeWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Size of the area. A smudge is created in each tile within this radius.
   * Provide 2 values for a ring effect (outer/inner).
   *
   * OpenRA 对照: LeaveSmudgeWarhead.Size (ImmutableArray<int>)
   */
  size: number[] = [0, 0]

  /** Types of smudge to apply to terrain.
   *
   * OpenRA 对照: LeaveSmudgeWarhead.SmudgeType (FrozenSet<string>)
   */
  smudgeType: Set<string> = new Set<string>()

  /** Percentage chance the smudge is created (0-100).
   *
   * OpenRA 对照: LeaveSmudgeWarhead.Chance
   */
  chance: number = 100

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Size !== undefined) this.size = json.Size as number[]
    if (json.SmudgeType !== undefined) {
      this.smudgeType = new Set(json.SmudgeType as string[])
    }
    if (json.Chance !== undefined) this.chance = json.Chance as number
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Apply smudge marks to terrain at the impact position.
   *
   * OpenRA 对照: LeaveSmudgeWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    _args: WarheadArgs,
  ): WarheadEffect[] {
    const effects: SmudgeEffect[] = []

    const world = (firedBy as unknown as WarheadActorLike).world
    if (!world?.map) return effects

    // Random chance check
    if (this.chance < Math.floor(Math.random() * 100)) return effects

    const map = world.map

    // Check air threshold
    const dat = map.distanceAboveTerrain(pos)
    if (dat.length > this.airThreshold.length) return effects

    const targetTile = map.cellContaining(pos)

    // Compute range: 2-valued Size = ring (outer/inner), 1-valued = circle
    const maxRange = this.size.length > 0 ? this.size[0] : 0
    const minRange = (this.size.length > 1 && this.size[1] > 0) ? this.size[1] : 0

    const allCells = map.findTilesInAnnulus(targetTile, minRange, maxRange)

    for (const cell of allCells) {
      // Find the first smudge type that this terrain accepts
      const terrainInfo = map.getTerrainInfo(cell) as unknown as {
        acceptsSmudgeType?: string[]
        targetTypes?: Set<string>
      }
      const acceptsSmudgeTypes = terrainInfo?.acceptsSmudgeType
      if (!acceptsSmudgeTypes) continue

      const matchingType = acceptsSmudgeTypes.find(t => this.smudgeType.has(t))
      if (!matchingType) continue

      // Check cell actors for validity
      // NOTE: Full implementation uses world.ActorMap.GetActorsAt(cell).
      // For now, we use a small-radius search as approximation.
      if (world.findActorsOnCircle) {
        const cellCenter = map.centerOfCell(cell)
        const cellActors = world.findActorsOnCircle(
          cellCenter,
          WDist.fromCells(1),
        )
        if (cellActors && cellActors.some(a => !this.isValidAgainst(a as unknown as IGameActor, firedBy))) {
          continue
        }
      }

      effects.push({
        type: 'smudge',
        cell,
        smudgeType: matchingType,
      })
    }

    return effects
  }
}
