/**
 * CellInfo.ts — Cell status enum and pathfinding node information
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/CellInfo.cs
 *
 * 核心范式转换:
 * - C# enum CellStatus : byte → TypeScript const object + union type
 * - C# readonly struct CellInfo → immutable TypeScript class with readonly fields
 * - C# default(CellInfo) represents Unvisited → static CellInfo.unvisited() factory
 * - Validation: Unvisited status cannot be explicitly constructed
 */

import { CPos } from '../../OpenRA.Game/CPos'

// ---------------------------------------------------------------------------
// CellStatus enum
// ---------------------------------------------------------------------------

/**
 * Describes the three states that a node in the graph can have.
 * Based on A* algorithm specification.
 *
 * OpenRA 对照: CellStatus : byte
 */
export const CellStatus = {
  /** Node has not been visited by the search. */
  Unvisited: 0,
  /** Node is in the open set (frontier of the search). */
  Open: 1,
  /** Node has been fully explored (closed set). */
  Closed: 2,
} as const

/** Type for CellStatus values (0 = Unvisited, 1 = Open, 2 = Closed). */
export type CellStatusValue = (typeof CellStatus)[keyof typeof CellStatus]

// ---------------------------------------------------------------------------
// CellInfo
// ---------------------------------------------------------------------------

/**
 * Stores information about nodes in the pathfinding graph.
 * The default value represents an Unvisited location.
 *
 * OpenRA 对照: CellInfo (readonly struct)
 *
 * Immutable. All fields are readonly.
 * The static factory `unvisited()` creates the default Unvisited state.
 * The constructor validates that status is not Unvisited.
 */
export class CellInfo {
  /**
   * The status of this node. Accessing other fields is only valid when
   * the status is not Unvisited.
   *
   * OpenRA 对照: CellInfo.Status
   */
  readonly Status: CellStatusValue

  /**
   * The cost to move from the start up to this node.
   *
   * OpenRA 对照: CellInfo.CostSoFar
   */
  readonly CostSoFar: number

  /**
   * The estimation of how far this node is from our target.
   *
   * OpenRA 对照: CellInfo.EstimatedTotalCost
   */
  readonly EstimatedTotalCost: number

  /**
   * The previous node of this one that follows the shortest path.
   *
   * OpenRA 对照: CellInfo.PreviousNode
   */
  readonly PreviousNode: CPos

  /**
   * Create a CellInfo for an Unvisited node.
   *
   * OpenRA 对照: default(CellInfo)
   *
   * This is the ONLY way to create an Unvisited CellInfo.
   * The constructor rejects Unvisited status to enforce this.
   *
   * @returns a CellInfo with Status = Unvisited and all other fields at default
   */
  static unvisited(): CellInfo {
    // Use the private constructor bypass (second overload with _unvisited flag)
    return new CellInfo(CellStatus.Unvisited, 0, 0, CPos.Zero, true)
  }

  /**
   * Create a new CellInfo with validation.
   *
   * OpenRA 对照: CellInfo(CellStatus, int, int, CPos)
   *
   * @param status — node status (must not be Unvisited)
   * @param costSoFar — cost from start to this node
   * @param estimatedTotalCost — estimated total cost to target
   * @param previousNode — previous node on the shortest path
   * @throws if status is Unvisited (use CellInfo.unvisited() instead)
   */
  constructor(
    status: CellStatusValue,
    costSoFar: number,
    estimatedTotalCost: number,
    previousNode: CPos,
  )
  /**
   * Internal constructor for unvisited nodes (bypasses validation).
   *
   * @param status — node status
   * @param costSoFar — cost from start to this node
   * @param estimatedTotalCost — estimated total cost to target
   * @param previousNode — previous node on the shortest path
   * @param _unvisited — internal flag to bypass validation. NOT part of the public API;
   *   only accessible within the module. Callers outside this file must use CellInfo.unvisited().
   */
  constructor(
    status: CellStatusValue,
    costSoFar: number,
    estimatedTotalCost: number,
    previousNode: CPos,
    _unvisited?: boolean,
  )
  constructor(
    status: CellStatusValue,
    costSoFar: number,
    estimatedTotalCost: number,
    previousNode: CPos,
    _unvisited?: boolean,
  ) {
    if (status === CellStatus.Unvisited && _unvisited !== true) {
      throw new Error(
        `The default CellInfo is the only such CellInfo allowed for representing an Unvisited location. ` +
          `Use CellInfo.unvisited() instead.`,
      )
    }

    this.Status = status
    this.CostSoFar = costSoFar
    this.EstimatedTotalCost = estimatedTotalCost
    this.PreviousNode = previousNode
  }

  /**
   * String representation.
   *
   * OpenRA 对照: CellInfo.ToString()
   */
  toString(): string {
    if (this.Status === CellStatus.Unvisited) {
      return 'Unvisited'
    }

    const statusName =
      this.Status === CellStatus.Open ? 'Open' : 'Closed'
    return (
      `${statusName} CostSoFar=${this.CostSoFar} ` +
      `EstimatedTotalCost=${this.EstimatedTotalCost} PreviousNode=${this.PreviousNode.toString()}`
    )
  }
}
