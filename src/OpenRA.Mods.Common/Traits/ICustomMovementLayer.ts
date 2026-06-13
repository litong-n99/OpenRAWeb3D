/**
 * ICustomMovementLayer.ts — Custom movement layer interface
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (ICustomMovementLayer interface)
 *
 * 核心范式转换:
 * - C# interface with byte Index → TypeScript interface with number Index
 * - C# short return types → number (TypeScript has no short)
 * - C# byte GetTerrainIndex → number return (TypeScript has no byte)
 *
 * Expanded from Phase G stub for Chapter 9 bridge infrastructure.
 * Full custom movement layer implementations: ElevatedBridgeLayer,
 * TerrainTunnelLayer, SubterraneanLayer, JumpjetLayer.
 */

import type { CPos } from '../../OpenRA.Game/CPos'
import type { WPos } from '../../OpenRA.Game/WPos'
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
 * provides entry/exit movement costs, terrain indices, and cell
 * center positions.
 */
export interface ICustomMovementLayer {
  /** Layer index (0 = ground, 1+ = custom layers).
   *
   * OpenRA 对照: ICustomMovementLayer.Index
   */
  readonly Index: number

  /** Whether this layer interacts with the default (ground) layer.
   *
   * OpenRA 对照: ICustomMovementLayer.InteractsWithDefaultLayer
   *
   * When true, actors can transition between this layer and the ground
   * layer at end cells (entry/exit points). When false, the layers are
   * completely separate.
   */
  readonly InteractsWithDefaultLayer: boolean

  /** Whether actors should return to the ground layer when idle.
   *
   * OpenRA 对照: ICustomMovementLayer.ReturnToGroundLayerOnIdle
   *
   * When true, idle actors on this layer will automatically transition
   * back to the ground layer (e.g. for subterranean units surfacing).
   */
  readonly ReturnToGroundLayerOnIdle: boolean

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

  /**
   * Get the terrain index for a cell on this layer.
   *
   * OpenRA 对照: ICustomMovementLayer.GetTerrainIndex(CPos)
   *
   * Returns the terrain type index used for movement cost/speed lookups.
   *
   * @param cell — the cell position
   * @returns terrain type index, or 255 (byte.MaxValue) if undefined
   */
  getTerrainIndex(cell: CPos): number

  /**
   * Get the world-space center position of a cell on this layer.
   *
   * OpenRA 对照: ICustomMovementLayer.CenterOfCell(CPos)
   *
   * For elevated bridges, this returns a position at bridge deck height
   * rather than ground height.
   *
   * @param cell — the cell position
   * @returns the world-space center of the cell on this layer
   */
  centerOfCell(cell: CPos): WPos
}
