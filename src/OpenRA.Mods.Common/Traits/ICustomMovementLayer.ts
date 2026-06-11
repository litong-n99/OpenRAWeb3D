/**
 * ICustomMovementLayer.ts — Custom movement layer interface stub
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (ICustomMovementLayer interface)
 *
 * 核心范式转换:
 * - C# interface with byte Index → TypeScript interface with number Index
 * - C# short return types → number (TypeScript has no short)
 *
 * STUB: This is a minimal stub for Phase G pathfinding.
 * Full custom movement layer implementations (Tunnel, Subterranean,
 * Jumpjet, ElevatedBridge) will be expanded in Chapter 5.
 */

import type { CPos } from '../../OpenRA.Game/CPos'
import type { LocomotorInfo } from './World/Locomotor'

// ---------------------------------------------------------------------------
// ICustomMovementLayer interface
// ---------------------------------------------------------------------------

/**
 * Interface for custom movement layers (tunnels, bridges, etc.).
 *
 * OpenRA 对照: ICustomMovementLayer
 *
 * Custom movement layers allow actors to move on non-ground layers
 * (e.g. tunnels, elevated bridges). Each layer has an index and
 * provides entry/exit movement costs.
 *
 * STUB: Only methods needed by DensePathGraph are included.
 * Additional methods (GetTerrainIndex, CenterOfCell, etc.) will be
 * added when the full movement layer system is migrated.
 */
export interface ICustomMovementLayer {
  /** Layer index (0 = ground, 1+ = custom layers). */
  readonly Index: number

  /**
   * Whether this layer is enabled for the given locomotor.
   *
   * OpenRA 对照: ICustomMovementLayer.EnabledForLocomotor(LocomotorInfo)
   *
   * @param locomotorInfo — the locomotor configuration
   * @returns true if this layer can be used by the locomotor
   */
  enabledForLocomotor(locomotorInfo: LocomotorInfo): boolean

  /**
   * Cost to enter this layer from the ground layer.
   *
   * OpenRA 对照: ICustomMovementLayer.EntryMovementCost(LocomotorInfo, CPos)
   *
   * @param locomotorInfo — the locomotor configuration
   * @param cell — the cell position
   * @returns movement cost, or MovementCostForUnreachableCell if blocked
   */
  entryMovementCost(locomotorInfo: LocomotorInfo, cell: CPos): number

  /**
   * Cost to exit this layer back to the ground layer.
   *
   * OpenRA 对照: ICustomMovementLayer.ExitMovementCost(LocomotorInfo, CPos)
   *
   * @param locomotorInfo — the locomotor configuration
   * @param cell — the cell position
   * @returns movement cost, or MovementCostForUnreachableCell if blocked
   */
  exitMovementCost(locomotorInfo: LocomotorInfo, cell: CPos): number
}
