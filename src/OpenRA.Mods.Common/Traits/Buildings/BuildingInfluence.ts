/**
 * BuildingInfluence.ts — 建筑物空间索引：按地图单元格追踪建筑占用（链表结构）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/BuildingInfluence.cs (92 lines)
 *
 * 核心范式转换:
 * - C# CellLayer<InfluenceNode> (sealed inner class, linked list) → TS CellLayer<InfluenceNode | null>
 * - C# Actor → TS IGameActor (forward interface)
 * - C# IEnumerable<CPos> → TS readonly CPos[]
 * - C# yield return generator pattern → TS 显式数组收集
 * - C# static recursive RemoveInfluenceInner → TS private recursive method
 * - C# TraitLocation(SystemActors.World) attribute → TS 约定：注册到世界 Actor 上
 *
 * BuildingInfluence 是一个 World trait，维护一个 CellLayer，每个单元格存储
 * 一个 InfluenceNode 链表，记录占据该单元格的所有建筑 Actor。
 * Building.addedToWorld() / removedFromWorld() 会调用 addInfluence / removeInfluence。
 */

import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer.js'
import { type MapGridType as MapGridTypeEnum } from '../../../OpenRA.Game/Map/MapGridType.js'
import type { Size } from '../../../OpenRA.Game/Primitives/Size.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  ITraitInfo,
  INotifyCreated,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// InfluenceNode
// OpenRA 对照: sealed class InfluenceNode (inner class of BuildingInfluence)
// ---------------------------------------------------------------------------

/**
 * A node in a per-cell linked list of building actors.
 *
 * OpenRA 对照: BuildingInfluence.InfluenceNode
 *
 * Each cell in the influence layer stores the head of a linked list.
 * Multiple buildings can occupy the same cell (e.g., overlap).
 * Adding a building prepends a node (O(1)); removal traverses the list.
 */
export class InfluenceNode {
  /** Next node in the linked list, or null for end of list.
   *
   * OpenRA 对照: InfluenceNode.Next
   */
  Next: InfluenceNode | null = null

  /** The building actor at this cell.
   *
   * OpenRA 对照: InfluenceNode.Actor
   */
  Actor: IGameActor

  /** Construct an InfluenceNode for the given actor.
   *
   * OpenRA 对照: InfluenceNode{ Actor = a } (object initializer)
   *
   * @param actor — the building actor occupying this cell
   */
  constructor(actor: IGameActor) {
    this.Actor = actor
  }
}

// ---------------------------------------------------------------------------
// BuildingInfluenceInfo
// OpenRA 对照: BuildingInfluenceInfo (TraitInfo, TraitLocation(SystemActors.World))
// ---------------------------------------------------------------------------

/**
 * Configuration for the BuildingInfluence world trait.
 *
 * OpenRA 对照: BuildingInfluenceInfo
 *
 * This is a marker trait info attached to the world actor.
 * It requires no special configuration — the CellLayer is sized to the map.
 *
 * NOTE: OpenRA has a TraitLocation(SystemActors.World) attribute indicating
 * this trait can only be placed on the world actor. In TypeScript, this is
 * enforced by convention — the trait is always registered on the world actor.
 */
export class BuildingInfluenceInfo implements ITraitInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// BuildingInfluence
// OpenRA 对照: BuildingInfluence class
// ---------------------------------------------------------------------------

/**
 * A spatial index tracking which buildings occupy which map cells.
 *
 * OpenRA 对照: BuildingInfluence
 *
 * Maintains a CellLayer where each cell stores a linked list (InfluenceNode)
 * of the building actors that occupy it. Used by pathfinding, rally point
 * placement, and construction validation to check cell occupancy.
 *
 * Implements INotifyCreated to allow future late-initialization from the
 * world actor (currently a no-op since initialization happens in constructor).
 *
 * Usage:
 *   const influence = new BuildingInfluence(gridType, mapSize)
 *   influence.addInfluence(buildingActor, occupiedCells)
 *   const buildings = influence.getBuildingsAt(cell)
 *   influence.removeInfluence(buildingActor, occupiedCells)
 */
export class BuildingInfluence implements INotifyCreated {
  /** The per-cell linked list of building actors.
   *
   * OpenRA 对照: influence (CellLayer<InfluenceNode>)
   *
   * Each cell entry is either null (no buildings) or the head of a linked
   * list of InfluenceNode instances.
   */
  readonly influence: CellLayer<InfluenceNode | null>

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: BuildingInfluence(World world)
  // ---------------------------------------------------------------------------

  /**
   * Construct the BuildingInfluence for a map.
   *
   * OpenRA 对照: BuildingInfluence(World world)
   *
   * In OpenRA, the constructor receives World and extracts Map to create
   * the CellLayer. In TypeScript, we pass gridType and size directly,
   * following the same pattern as CellLayer(ModeGridType, Size).
   *
   * @param gridType — the map's grid type (Rectangular or RectangularIsometric)
   * @param size — the map's size in cells (width × height)
   */
  constructor(gridType: MapGridTypeEnum, size: Size) {
    this.influence = new CellLayer<InfluenceNode | null>(gridType, size)
    // Initialize all entries to null (matching C# default(ReferenceType) = null).
    // CellLayer defaults to undefined for generic T; we need explicit null.
    this.influence.clear(null)
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: N/A (C# BuildingInfluence does not implement INotifyCreated)
  // ---------------------------------------------------------------------------

  /**
   * Called when the world actor is created.
   *
   * NOTE: In TypeScript, BuildingInfluence implements INotifyCreated as
   * specified in the migration plan. The CellLayer is already initialized
   * in the constructor, so this is a no-op. It exists as a lifecycle hook
   * for future integration with the world actor's trait system.
   *
   * @param _actor — the world actor
   */
  created(_actor: IGameActor): void {
    // CellLayer is already initialized in constructor. No additional setup needed.
  }

  // ---------------------------------------------------------------------------
  // addInfluence
  // OpenRA 对照: AddInfluence(Actor a, IEnumerable<CPos> cells)
  // ---------------------------------------------------------------------------

  /**
   * Register a building actor at the given cells.
   *
   * OpenRA 对照: AddInfluence(Actor a, IEnumerable<CPos> cells)
   *
   * For each cell, prepends a new InfluenceNode to the linked list (O(1) per cell).
   * The actor is prepended, not appended, matching OpenRA's object-initializer
   * pattern `new InfluenceNode { Next = influence[uv], Actor = a }`.
   *
   * @param actor — the building actor to register
   * @param cells — the cells occupied by the building
   */
  addInfluence(actor: IGameActor, cells: readonly CPos[]): void {
    const gridType = this.influence.GridType

    for (const c of cells) {
      // Convert to MPos for CellLayer containment check and indexed access,
      // matching OpenRA's c.ToMPos(map) pattern.
      const uv = c.toMPos(gridType)

      if (!this.influence.contains(uv)) {
        continue
      }

      // Prepend new node: existing head becomes Next
      const existing = this.influence.getMPos(uv)
      const node = new InfluenceNode(actor)
      node.Next = existing
      this.influence.setMPos(uv, node)
    }
  }

  // ---------------------------------------------------------------------------
  // removeInfluence
  // OpenRA 对照: RemoveInfluence(Actor a, IEnumerable<CPos> cells)
  // ---------------------------------------------------------------------------

  /**
   * Remove a building actor from the given cells.
   *
   * OpenRA 对照: RemoveInfluence(Actor a, IEnumerable<CPos> cells)
   *
   * For each cell, recursively traverses the linked list and removes the
   * node(s) matching the given actor. The list may contain multiple nodes
   * for the same actor if it was registered multiple times (unlikely but
   * handled gracefully).
   *
   * @param actor — the building actor to remove
   * @param cells — the cells to remove the actor from
   */
  removeInfluence(actor: IGameActor, cells: readonly CPos[]): void {
    const gridType = this.influence.GridType

    for (const c of cells) {
      const uv = c.toMPos(gridType)

      if (!this.influence.contains(uv)) {
        continue
      }

      const newHead = this._removeInfluenceInner(
        this.influence.getMPos(uv),
        actor,
      )
      this.influence.setMPos(uv, newHead)
    }
  }

  /**
   * Recursively remove all nodes matching `toRemove` from a linked list.
   *
   * OpenRA 对照: RemoveInfluenceInner(InfluenceNode, Actor)
   *
   * This is a static method in OpenRA. In TypeScript it is a private instance
   * method for simplicity (no static allocation concerns in JS).
   *
   * @param node — the current node (or null)
   * @param toRemove — the actor to remove
   * @returns the new head of the (sub)list after removal
   */
  private _removeInfluenceInner(
    node: InfluenceNode | null,
    toRemove: IGameActor,
  ): InfluenceNode | null {
    if (node === null) return null

    // Recursively process the rest of the list
    node.Next = this._removeInfluenceInner(node.Next, toRemove)

    // If this node matches, skip it (return Next instead)
    return node.Actor === toRemove ? node.Next : node
  }

  // ---------------------------------------------------------------------------
  // getBuildingsAt
  // OpenRA 对照: GetBuildingsAt(CPos cell)
  // ---------------------------------------------------------------------------

  /**
   * Get all building actors occupying a given cell.
   *
   * OpenRA 对照: GetBuildingsAt(CPos cell)
   *
   * Iterates the linked list at the specified cell and collects all actors.
   * Returns an empty array if the cell is invalid or has no buildings.
   *
   * NOTE: OpenRA uses C# `yield return` (lazy iterator). TypeScript returns a
   * concrete array for simplicity. The linked list is typically small (few
   * buildings per cell), so the allocation cost is negligible.
   *
   * @param cell — the cell position to query
   * @returns all building actors at the cell, or empty array
   */
  getBuildingsAt(cell: CPos): IGameActor[] {
    if (!this.influence.contains(cell)) {
      return []
    }

    const result: IGameActor[] = []
    let node = this.influence.get(cell)

    while (node !== null) {
      result.push(node.Actor)
      node = node.Next
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // anyBuildingAt
  // OpenRA 对照: AnyBuildingAt(CPos cell)
  // ---------------------------------------------------------------------------

  /**
   * Quick check whether a cell has any buildings.
   *
   * OpenRA 对照: AnyBuildingAt(CPos cell)
   *
   * Equivalent to `influence.Contains(cell) && influence[cell] != null`.
   * Avoids iterating the linked list — just checks if the head is non-null.
   *
   * @param cell — the cell position to check
   * @returns true if at least one building occupies the cell
   */
  anyBuildingAt(cell: CPos): boolean {
    if (!this.influence.contains(cell)) {
      return false
    }
    return this.influence.get(cell) !== null
  }
}
