/**
 * ActorMap.ts — spatial index of all actors on the game map using cell-based
 *               linked-list influence nodes and partitioned bin queries
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ActorMap.cs
 *
 * 核心范式转换:
 * - C# sealed class InfluenceNode (Next/SubCell/Actor) → TS interface (linked list)
 * - C# CellLayer<InfluenceNode> → TS CellLayer<ActorMapInfluenceNode | null>
 * - C# yield return → TS generators / arrays (depending on perf context)
 * - C# sparse bin partition (rows×cols array) → TS flat array of Bin
 * - C# IEnumerable<Actor> → TS IGameActor[]
 * - C# AddPosition/RemovePosition deferred via HashSet → TS Set<IGameActor>
 * - C# cell.ToMPos(map) + CellLayer[MPos] → TS CellLayer.get/set(CPos) directly
 *   (CellLayer does MPos conversion internally via indexFromCPos)
 *
 * NOTE: This is a minimum viable implementation for Chapter 11 Phase B.
 * Proximity triggers, cell triggers, and bin-based spatial indexing for
 * box queries are stubbed with minimal functional placeholders.
 * Full implementation deferred to Chapter 11 Phase C.
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer.js'
import type { Size } from '../../../OpenRA.Game/Primitives/Size.js'
import type {
  IGameActor,
  OccupiedCell,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ActorMapInfluenceNode — linked-list node for occupancy tracking per cell
// OpenRA 对照: ActorMap.InfluenceNode (sealed class)
// ---------------------------------------------------------------------------

/**
 * A node in the per-cell linked list of occupying actors.
 *
 * OpenRA 对照: ActorMap.InfluenceNode
 *
 * Each non-empty map cell has a linked list of these nodes, one per
 * actor occupying that cell (with its sub-cell position).
 */
export interface ActorMapInfluenceNode {
  /** Next node in the linked list, or null if this is the last node. */
  next: ActorMapInfluenceNode | null
  /** The sub-cell position this actor occupies at this cell. */
  subCell: number
  /** The actor occupying this cell. */
  actor: IGameActor
}

// ---------------------------------------------------------------------------
// IActorMapQuery — public interface for cell-based actor queries
// OpenRA 对照: IActorMap (subset used by building/placement code)
// ---------------------------------------------------------------------------

/** Minimal public interface exposed by ActorMap for spatial queries.
 *
 * OpenRA 对照: IActorMap (subset used by building/placement code)
 *
 * NOTE: The canonical IActorMap definition is in TraitsInterfaces.ts.
 * ActorMap implements the full interface. This subset documents what
 * the Chapter 11 Phase B implementation provides.
 */
export interface IActorMapQuery {
  /** Get all actors at a cell position (any sub-cell).
   *
   * OpenRA 对照: ActorMap.GetActorsAt(CPos)
   */
  getActorsAt(cell: CPos): IGameActor[]

  /** Check whether any actors occupy a given cell.
   *
   * OpenRA 对照: ActorMap.AnyActorsAt(CPos)
   */
  anyActorsAt(cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// ActorMap — spatial index of all actors on the map
// OpenRA 对照: ActorMap class : IActorMap, ITick, INotifyCreated
// ---------------------------------------------------------------------------

/**
 * Spatial index tracking which cells each actor occupies.
 *
 * OpenRA 对照: ActorMap
 *
 * Maintains a CellLayer<ActorMapInfluenceNode | null> for the ground layer
 * (layer 0) plus additional layers for each CustomMovementLayer.
 * Actors are registered by calling addInfluence/addActorPosition and
 * unregistered by calling removeInfluence/removeActorPosition.
 *
 * Minimal Phase B implementation provides:
 * - addInfluence / removeInfluence (cell-level tracking)
 * - addActorPosition / removeActorPosition (deferred batch processing)
 * - getActorsAt / anyActorsAt (cell queries)
 * - Internal linked-list storage via CellLayer
 */
export class ActorMap implements IActorMapQuery {
  /** Per-cell linked list heads for the ground layer (layer index 0). */
  private influence: CellLayer<ActorMapInfluenceNode | null>

  /** Actors waiting to be added to positional bins (processed at end of tick). */
  private addActorPositionSet: Set<IGameActor> = new Set()

  /** Actors waiting to be removed from positional bins (processed at end of tick). */
  private removeActorPositionSet: Set<IGameActor> = new Set()

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Create an ActorMap covering the given map size.
   *
   * OpenRA 对照: ActorMap(World, ActorMapInfo)
   *
   * @param mapSize — the map dimensions in cells
   * @param gridType — the map grid type
   */
  constructor(
    mapSize: Size,
    gridType: (typeof MapGridType)[keyof typeof MapGridType] = MapGridType.Rectangular,
  ) {
    this.influence = new CellLayer<ActorMapInfluenceNode | null>(gridType, mapSize)

    // Initialize all cells with null (empty linked list).
    for (let y = 0; y < mapSize.height; y++) {
      for (let x = 0; x < mapSize.width; x++) {
        const cell = new CPos(x, y, 0)
        if (this.influence.contains(cell)) {
          this.influence.set(cell, null)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Influence tracking (cell-level occupancy)
  // OpenRA 对照: ActorMap.AddInfluence / RemoveInfluence
  // ---------------------------------------------------------------------------

  /**
   * Register an actor's occupied cells in the influence grid.
   *
   * OpenRA 对照: ActorMap.AddInfluence(Actor, IOccupySpace)
   *
   * For each cell the actor occupies, prepends an InfluenceNode to the
   * cell's linked list.
   *
   * @param actor — the actor to register
   * @param cells — the cell/sub-cell pairs the actor occupies
   */
  addInfluence(actor: IGameActor, cells: readonly OccupiedCell[]): void {
    for (const c of cells) {
      const cell = c.cell
      if (!this.influence.contains(cell)) continue

      const existingHead = this.influence.get(cell)
      const node: ActorMapInfluenceNode = {
        next: existingHead,
        subCell: c.subCell as number,
        actor,
      }
      this.influence.set(cell, node)
    }
  }

  /**
   * Unregister an actor from the influence grid.
   *
   * OpenRA 对照: ActorMap.RemoveInfluence(Actor, IOccupySpace)
   *
   * Removes all InfluenceNode entries for this actor from the cells it occupied.
   *
   * @param actor — the actor to unregister
   * @param cells — the cell/sub-cell pairs the actor occupied
   */
  removeInfluence(actor: IGameActor, cells: readonly OccupiedCell[]): void {
    for (const c of cells) {
      const cell = c.cell
      if (!this.influence.contains(cell)) continue

      const head = this.influence.get(cell)
      if (!head) continue

      const newHead = this._removeInfluenceFromChain(head, actor)
      this.influence.set(cell, newHead)
    }
  }

  /**
   * Recursively rebuild a linked list, removing all nodes for the given actor.
   *
   * OpenRA 对照: ActorMap.RemoveInfluenceInner (static method)
   */
  private _removeInfluenceFromChain(
    node: ActorMapInfluenceNode | null,
    actor: IGameActor,
  ): ActorMapInfluenceNode | null {
    if (node === null) return null

    // Recursively clean the tail first, then check the current node.
    const cleanedTail = this._removeInfluenceFromChain(node.next, actor)

    if (node.actor === actor) {
      // Skip this node — return whatever the tail resolved to
      return cleanedTail
    }

    // Keep this node, but update its next pointer
    return { next: cleanedTail, subCell: node.subCell, actor: node.actor }
  }

  // ---------------------------------------------------------------------------
  // Position tracking (deferred batch processing)
  // OpenRA 对照: ActorMap.AddPosition / RemovePosition
  // ---------------------------------------------------------------------------

  /**
   * Defer adding an actor to the spatial bin index.
   *
   * OpenRA 对照: ActorMap.AddPosition(Actor, IOccupySpace)
   *
   * Position updates are processed in batch at tick time to ensure
   * consistency during a single tick.
   *
   * @param actor — the actor to add
   */
  addActorPosition(actor: IGameActor): void {
    this.removeActorPositionSet.delete(actor)
    this.addActorPositionSet.add(actor)
  }

  /**
   * Defer removing an actor from the spatial bin index.
   *
   * OpenRA 对照: ActorMap.RemovePosition(Actor, IOccupySpace)
   *
   * @param actor — the actor to remove
   */
  removeActorPosition(actor: IGameActor): void {
    this.addActorPositionSet.delete(actor)
    this.removeActorPositionSet.add(actor)
  }

  /**
   * Process all deferred position updates.
   *
   * OpenRA 对照: ActorMap.Tick (ITick)
   *
   * Must be called once per logic tick to flush pending
   * add/remove position operations.
   */
  tick(): void {
    // Process removals first, then additions
    // In the full implementation, this updates spatial bins.
    // For Phase B minimal implementation, we just clear the sets.
    this.removeActorPositionSet.clear()
    this.addActorPositionSet.clear()
  }

  // ---------------------------------------------------------------------------
  // Cell queries
  // OpenRA 对照: ActorMap.GetActorsAt / AnyActorsAt
  // ---------------------------------------------------------------------------

  /**
   * Get all actors at a cell position (any sub-cell).
   *
   * OpenRA 对照: ActorMap.GetActorsAt(CPos)
   *
   * @param cell — the map cell to query
   * @returns array of actors occupying this cell (empty if none)
   */
  getActorsAt(cell: CPos): IGameActor[] {
    if (!this.influence.contains(cell)) return []

    const actors: IGameActor[] = []
    let node = this.influence.get(cell)
    while (node !== null) {
      actors.push(node.actor)
      node = node.next
    }
    return actors
  }

  /**
   * Check whether any actors occupy a given cell.
   *
   * OpenRA 对照: ActorMap.AnyActorsAt(CPos)
   *
   * @param cell — the map cell to query
   * @returns true if at least one actor occupies this cell
   */
  anyActorsAt(cell: CPos): boolean {
    if (!this.influence.contains(cell)) return false
    return this.influence.get(cell) !== null
  }

  // ---------------------------------------------------------------------------
  // All actors enumeration
  // ---------------------------------------------------------------------------

  /**
   * Enumerate all actors registered in the influence grid.
   *
   * OpenRA 对照: ActorMap.AllActors()
   *
   * NOTE: This is an O(map_area) scan. For frequent queries, prefer
   * getActorsAt() or the bin-based spatial queries (Phase C).
   *
   * @returns array of all registered actors (without duplicates)
   */
  allActors(): IGameActor[] {
    const seen = new Set<IGameActor>()
    const result: IGameActor[] = []

    // CellLayer implements Iterable<T>, so we can iterate all cells.
    for (const node of this.influence) {
      let current: ActorMapInfluenceNode | null = node
      while (current !== null) {
        if (!seen.has(current.actor)) {
          seen.add(current.actor)
          result.push(current.actor)
        }
        current = current.next
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * Release all resources held by this ActorMap.
   */
  dispose(): void {
    this.addActorPositionSet.clear()
    this.removeActorPositionSet.clear()
    // CellLayer does not currently have a dispose() method,
    // but the underlying array will be GC'd when this class is released.
  }
}
