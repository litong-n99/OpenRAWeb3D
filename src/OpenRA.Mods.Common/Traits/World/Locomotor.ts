/**
 * Locomotor.ts — Locomotor stub for pathfinding (minimal interface)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/Locomotor.cs
 *
 * 核心范式转换:
 * - C# class LocomotorInfo + Locomotor → TypeScript class + interface
 * - C# FrozenDictionary<string, TerrainInfo> → Map<string, { speed, cost }>
 * - C# short return types → number (TypeScript has no short)
 *
 * STUB: This is a minimal stub for Phase G pathfinding.
 * Full Locomotor implementation (actor blocking, cell cache, terrain costs)
 * will be expanded in Chapter 5.
 */

import type { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type { BlockedByActor } from '../BlockedByActor'
import type { SubCell as SubCellType } from '../../../OpenRA.Game/Traits/SubCell'
import { PathGraph } from '../../Pathfinder/IPathGraph'

// ---------------------------------------------------------------------------
// LocomotorInfo — configuration data
// ---------------------------------------------------------------------------

/**
 * Configuration data for a Locomotor.
 *
 * OpenRA 对照: LocomotorInfo
 *
 * STUB: Only fields needed by pathfinding are included.
 * Full implementation will include CrushClasses, WaitAverage, etc.
 */
export class LocomotorInfo {
  /** Locomotor ID/name. */
  readonly Name: string

  /**
   * Terrain speed/cost lookup.
   * Maps terrain type string to { speed, cost }.
   *
   * OpenRA 对照: FrozenDictionary<string, TerrainInfo>
   */
  readonly TerrainSpeeds: Map<string, { speed: number; cost: number }>

  /**
   * Create a new LocomotorInfo.
   *
   * @param name — locomotor name (default: 'default')
   * @param terrainSpeeds — terrain speed/cost map (default: empty)
   */
  constructor(
    name: string = 'default',
    terrainSpeeds: Map<string, { speed: number; cost: number }> = new Map(),
  ) {
    this.Name = name
    this.TerrainSpeeds = terrainSpeeds
  }
}

// ---------------------------------------------------------------------------
// ILocomotor — minimal interface for pathfinding
// ---------------------------------------------------------------------------

/**
 * Minimal Locomotor interface for pathfinding operations.
 *
 * OpenRA 对照: Locomotor class (subset)
 *
 * STUB: Only methods needed by DensePathGraph and PathSearch factory
 * methods are included. Full implementation will include:
 * - MovementSpeedForCell
 * - CanStayInCell
 * - GetAvailableSubCell
 * - CellCostChanged event
 * - ActorMap caching
 *
 * NOTE: TypeScript does not support method overloads in interfaces the same
 * way as C#. We use a single method with optional parameters and a
 * discriminating parameter object pattern for the two overloads.
 */
export interface ILocomotor {
  /** Locomotor configuration. */
  readonly Info: LocomotorInfo

  /**
   * Get the movement cost to enter a destination cell.
   *
   * OpenRA 对照: Locomotor.MovementCostToEnterCell (both overloads)
   *
   * Two calling conventions:
   * 1. With srcNode: movementCostToEnterCell(actor, srcNode, destNode, check, ignoreActor)
   * 2. Without srcNode: movementCostToEnterCell(actor, destNode, check, ignoreActor, ignoreSelf)
   *
   * The implementation should check if the second argument is a CPos with
   * a Layer property (destNode) or use a parameter object.
   *
   * @param actor — the actor moving (null for theoretical checks)
   * @param args — either [srcNode, destNode, check, ignoreActor] or [destNode, check, ignoreActor, ignoreSelf]
   * @returns movement cost, or MovementCostForUnreachableCell if blocked
   */
  movementCostToEnterCell(
    actor: IGameActor | null,
    ...args: [CPos, CPos, BlockedByActor, IGameActor | null] | [CPos, BlockedByActor, IGameActor | null, boolean?]
  ): number

  /**
   * Check if an actor can freely move into a cell.
   *
   * OpenRA 对照: Locomotor.CanMoveFreelyInto(Actor, CPos, SubCell, BlockedByActor, Actor, bool)
   *
   * @param actor — the actor moving
   * @param destNode — destination cell
   * @param subCell — sub-cell position
   * @param check — blocking level
   * @param ignoreActor — actor to ignore
   * @param ignoreSelf — whether to ignore the moving actor
   * @returns true if movement is allowed
   */
  canMoveFreelyInto(
    actor: IGameActor | null,
    destNode: CPos,
    subCell: SubCellType,
    check: BlockedByActor,
    ignoreActor: IGameActor | null,
    ignoreSelf?: boolean,
  ): boolean

  /**
   * Get the terrain movement cost for a cell.
   *
   * OpenRA 对照: Locomotor.MovementCostForCell(CPos)
   *
   * @param cell — the cell to check
   * @returns terrain movement cost
   */
  movementCostForCell(cell: CPos): number
}

// ---------------------------------------------------------------------------
// SimpleLocomotor — basic stub implementation for testing
// ---------------------------------------------------------------------------

/**
 * Simple stub Locomotor implementation for testing pathfinding.
 *
 * Returns uniform terrain costs (all passable with cost 100).
 * Does not implement actor blocking.
 *
 * STUB: This is a test-only stub. Real Locomotor will query the
 * world map for terrain types and the actor map for blocking actors.
 */
export class SimpleLocomotor implements ILocomotor {
  readonly Info: LocomotorInfo

  /**
   * Create a SimpleLocomotor.
   *
   * @param info — optional LocomotorInfo (default: empty)
   */
  constructor(info?: LocomotorInfo) {
    this.Info = info ?? new LocomotorInfo()
  }

  /** @inheritdoc */
  movementCostToEnterCell(
    _actor: IGameActor | null,
    ..._args: [CPos, CPos, BlockedByActor, IGameActor | null] | [CPos, BlockedByActor, IGameActor | null, boolean?]
  ): number {
    // STUB: All cells are passable with cost 100
    return 100
  }

  /** @inheritdoc */
  canMoveFreelyInto(
    _actor: IGameActor | null,
    _destNode: CPos,
    _subCell: SubCellType,
    _check: BlockedByActor,
    _ignoreActor: IGameActor | null,
    _ignoreSelf?: boolean,
  ): boolean {
    // STUB: All cells are freely enterable
    return true
  }

  /** @inheritdoc */
  movementCostForCell(_cell: CPos): number {
    // STUB: All cells have cost 100
    return 100
  }
}

// ---------------------------------------------------------------------------
// WallAwareLocomotor — test stub that blocks specific cells
// ---------------------------------------------------------------------------

/**
 * Test Locomotor that treats certain cells as walls (unreachable).
 *
 * Used for testing pathfinding around obstacles.
 */
export class WallAwareLocomotor implements ILocomotor {
  readonly Info: LocomotorInfo

  /** Set of blocked cell keys (X * 10000 + Y). */
  private readonly blockedCells: Set<number>

  /**
   * Create a WallAwareLocomotor.
   *
   * @param blockedCells — set of blocked cell positions (as CPos)
   * @param info — optional LocomotorInfo
   */
  constructor(blockedCells: CPos[] = [], info?: LocomotorInfo) {
    this.Info = info ?? new LocomotorInfo('default', new Map([['Clear', { speed: 100, cost: 100 }]]))
    this.blockedCells = new Set(blockedCells.map((c) => c.X * 10000 + c.Y))
  }

  /** Check if a cell is blocked. */
  private isBlocked(cell: CPos): boolean {
    return this.blockedCells.has(cell.X * 10000 + cell.Y)
  }

  /** @inheritdoc */
  movementCostToEnterCell(
    _actor: IGameActor | null,
    ...args: [CPos, CPos, BlockedByActor, IGameActor | null] | [CPos, BlockedByActor, IGameActor | null, boolean?]
  ): number {
    // Determine which overload was called.
    // Overload 1: (actor, srcNode, destNode, check, ignoreActor) — args[3] is IGameActor|null
    // Overload 2: (actor, destNode, check, ignoreActor, ignoreSelf) — args[3] is boolean
    const isOverload2 = args.length >= 4 && typeof args[3] === 'boolean'
    const destNode = isOverload2 ? (args[0] as CPos) : (args[1] as CPos)
    if (this.isBlocked(destNode)) {
      return PathGraph.MovementCostForUnreachableCell
    }
    return 100
  }

  /** @inheritdoc */
  canMoveFreelyInto(
    _actor: IGameActor | null,
    destNode: CPos,
    _subCell: SubCellType,
    _check: BlockedByActor,
    _ignoreActor: IGameActor | null,
    _ignoreSelf?: boolean,
  ): boolean {
    return !this.isBlocked(destNode)
  }

  /** @inheritdoc */
  movementCostForCell(cell: CPos): number {
    if (this.isBlocked(cell)) {
      return PathGraph.MovementCostForUnreachableCell
    }
    return 100
  }
}
