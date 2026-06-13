/**
 * TunnelEntrance.ts -- TerrainTunnel entrance portal for order targeting
 * OpenRA 对照: OpenRA.Mods.Common/Traits/TunnelEntrance.cs
 *
 * 核心范式转换:
 * - C# TraitInfo/Trait pair → TypeScript config class + trait class
 * - C# IWorld.AddFrameEndTask deferral → simplified eager resolution
 *   (TypeScript world simulation is not multi-threaded)
 * - C# WAngle facing on StagingPoint → WAngle for direction
 * - C# CPos? nullable Exit → Exit: CPos | null
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { CVec } from '../../OpenRA.Game/CVec'
import { WPos } from '../../OpenRA.Game/WPos'
import { WAngle } from '../../OpenRA.Game/WAngle'
import type { IGameActor, INotifyCreated } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { TerrainTunnelInfo } from './World/TerrainTunnel'

// ---------------------------------------------------------------------------
// StagingPoint -- Entry/exit staging position
// ---------------------------------------------------------------------------

/**
 * A staging position and facing for tunnel entry/exit.
 *
 * OpenRA 对照: TunnelEntrance.StagingPoint (class)
 *
 * Provides a specific world position and facing direction for actors
 * entering or exiting a tunnel.
 */
export class StagingPoint {
  /** World position for staging. */
  readonly position: WPos

  /** Facing direction for staging. */
  readonly facing: WAngle

  constructor(position: WPos, facing: WAngle) {
    this.position = position
    this.facing = facing
  }
}

// ---------------------------------------------------------------------------
// TunnelEntranceInfo -- Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a tunnel entrance trait.
 *
 * OpenRA 对照: TunnelEntranceInfo : TraitInfo
 *
 * Provides a target for players to issue orders for units to move through
 * a TerrainTunnel. The host actor should be placed so that the Sensor
 * position overlaps one of the TerrainTunnel portal cells.
 */
export class TunnelEntranceInfo {
  /** Offset to use as a staging point for actors entering or exiting.
   * Should be at least Margin cells away from the actual entrance.
   *
   * OpenRA 对照: TunnelEntranceInfo.RallyPoint
   */
  readonly rallyPoint: CVec

  /** Cell radius to use as a staging area around the RallyPoint.
   *
   * OpenRA 对照: TunnelEntranceInfo.Margin
   */
  readonly margin: number

  /** Offset to check for the corresponding TerrainTunnel portal cell(s).
   *
   * OpenRA 对照: TunnelEntranceInfo.Sensor
   */
  readonly sensor: CVec

  constructor(params: {
    rallyPoint?: CVec
    margin?: number
    sensor?: CVec
  } = {}) {
    this.rallyPoint = params.rallyPoint ?? CVec.Zero
    this.margin = params.margin ?? 2
    this.sensor = params.sensor ?? CVec.Zero
  }
}

// ---------------------------------------------------------------------------
// TunnelEntrance -- Trait implementation
// ---------------------------------------------------------------------------

/**
 * Tunnel entrance trait for linking actors to tunnel portal cells.
 *
 * OpenRA 对照: TunnelEntrance : INotifyCreated
 *
 * Placed on actors that represent tunnel entrance buildings/structures.
 * Links the actor's sensor position to a TerrainTunnel portal cell and
 * finds the matching entrance at the other end of the tunnel.
 *
 * @remarks
 * Only valid for actors placed on the two ends of a TerrainTunnel.
 * The Entrance property marks the rally point staging cell, and the
 * Exit property marks the other end's entrance for destination routing.
 */
export class TunnelEntrance implements INotifyCreated {
  /** Configuration info. */
  readonly info: TunnelEntranceInfo

  /** The cell position of this entrance's rally point.
   *
   * OpenRA 对照: TunnelEntrance.Entrance
   */
  readonly entrance: CPos

  /** The rally point of the matching entrance at the tunnel's other end.
   *
   * OpenRA 对照: TunnelEntrance.Exit
   */
  exit: CPos | null = null

  /** How close an actor should get to the entrance for staging.
   *
   * OpenRA 对照: TunnelEntrance.NearEnough
   */
  get nearEnough(): number {
    return this.info.margin
  }

  /**
   * Create a new TunnelEntrance.
   *
   * OpenRA 对照: TunnelEntrance(Actor self, TunnelEntranceInfo info)
   */
  constructor(info: TunnelEntranceInfo) {
    this.info = info
    // Entrance = self.Location + info.RallyPoint — computed in created()
    this.entrance = CPos.Zero
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // ---------------------------------------------------------------------------

  /**
   * Called after the actor is fully created.
   *
   * OpenRA 对照: TunnelEntrance.Created(Actor self)
   *
   * Sets the entrance rally point and links this entrance to the tunnel
   * and its matching exit portal at the opposite end.
   */
  created(self: IGameActor): void {
    // Set entrance = actor location + rally point
    const location = (self as unknown as Record<string, unknown>)['location'] as CPos | undefined
    if (location) {
      const ent = new CPos(
        location.X + this.info.rallyPoint.X,
        location.Y + this.info.rallyPoint.Y,
      )
      ;(this as { entrance: CPos }).entrance = ent
    }

    // Find the map tunnel associated with this entrance
    // sensor = self.Location + info.Sensor
    if (!location) return
    const sensor = new CPos(
      location.X + this.info.sensor.X,
      location.Y + this.info.sensor.Y,
    )

    // Look up TerrainTunnelInfo entries from the world actor
    const worldAny = self.world as unknown as Record<string, unknown> | null
    const worldActor = worldAny?.['worldActor'] as Record<string, unknown> | undefined
    const traitInfos = worldActor?.['info'] as Record<string, unknown> | undefined
    const getTunnelInfos = traitInfos?.['traitInfos'] as (() => TerrainTunnelInfo[]) | undefined

    if (!getTunnelInfos) return

    // Find the tunnel whose portal cells contain the sensor position
    let matchedTunnel: TerrainTunnelInfo | null = null
    for (const tti of getTunnelInfos()) {
      const portalCells = tti.portalCells()
      if (portalCells.some((c) => c.Bits === sensor.Bits)) {
        matchedTunnel = tti
        break
      }
    }

    if (!matchedTunnel) return

    // Find the matching entrance at the other end of the tunnel
    // In OpenRA, this is deferred to the end of the tick.
    // In our TS migration, we resolve it synchronously since we don't
    // have a tick-based world simulation for this infrastructure code.
    const portalCells = matchedTunnel.portalCells()

    // Look through all tunnel entrances in the world
    const actorsWithTrait = worldAny?.['actorsWithTrait'] as
      ((traitType: unknown) => Iterable<{ actor: IGameActor; trait: TunnelEntrance }>) | undefined

    if (actorsWithTrait) {
      for (const { actor, trait } of actorsWithTrait(TunnelEntrance)) {
        if (actor !== self) {
          const otherLocation = (actor as unknown as Record<string, unknown>)['location'] as CPos | undefined
          if (otherLocation) {
            const otherSensor = new CPos(
              otherLocation.X + trait.info.sensor.X,
              otherLocation.Y + trait.info.sensor.Y,
            )
            if (portalCells.some((c) => c.Bits === otherSensor.Bits)) {
              this.exit = trait.entrance
              break
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Staging point helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the staging position for entering this tunnel entrance.
   *
   * OpenRA 对照: Used by EntersTunnels for entry staging
   *
   * @param cellCenter -- function to compute center of a cell position
   * @returns staging point with position and facing
   */
  getStagingPoint(cellCenter: (cell: CPos) => WPos): StagingPoint {
    const pos = cellCenter(this.entrance)
    // Facing toward the tunnel: use the direction from entrance toward the exit.
    // OpenRA uses WAngle.arcTan with world-space Y,X for the proper facing.
    let facing = WAngle.Zero
    if (this.exit) {
      const exitCenter = cellCenter(this.exit)
      const dx = exitCenter.X - pos.X
      const dy = exitCenter.Y - pos.Y
      facing = WAngle.arcTan(
        dy,
        dx,
        Math.trunc(Math.sqrt(dx * dx + dy * dy)),
      )
    }
    return new StagingPoint(pos, facing)
  }
}
