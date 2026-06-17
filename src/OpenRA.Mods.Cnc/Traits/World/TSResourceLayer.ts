/**
 * TSResourceLayer.ts — 泰伯利亚之日资源层（含矿脉支持）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/TSResourceLayer.cs (127 lines)
 *
 * 核心范式转换:
 * - C# ResourceLayer (extends) → TypeScript ResourceLayer delegation
 * - C# veinholeCells tracking via ActorAdded/ActorRemoved → TypeScript Set<CPos>
 * - C# IsValidResourceNeighbour/IsValidVeinNeighbour → TypeScript validation methods
 * - C# BuildingInfluence.AnyBuildingAt() → TypeScript stub
 * - C# INotifyActorDisposing cleanup → TypeScript dispose pattern
 *
 * NOTE: Extends the base ResourceLayer from Chapter 10. The veinhole actor
 * tracking ensures vein resources can spread from veinhole buildings.
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// TSResourceLayerInfo
// OpenRA 对照: TSResourceLayerInfo : ResourceLayerInfo
// ---------------------------------------------------------------------------

/** Configuration for the TS resource layer.
 *
 * OpenRA 对照: TSResourceLayerInfo
 *
 * @traitLocation World
 */
export class TSResourceLayerInfo implements ITraitInfo {
  /** The resource type name for veins.
   *
   * OpenRA 对照: TSResourceLayerInfo.VeinType
   */
  readonly veinType: string

  /** Actor types that should be treated as veinholes.
   *
   * OpenRA 对照: TSResourceLayerInfo.VeinholeActors (FrozenSet<string>)
   */
  readonly veinholeActors: ReadonlySet<string>

  /** Resource type configurations (delegated from base ResourceLayerInfo).
   *
   * OpenRA 对照: ResourceLayerInfo.ResourceTypes
   */
  readonly resourceTypes: ReadonlyMap<string, unknown>

  constructor(params?: {
    veinType?: string
    veinholeActors?: ReadonlySet<string>
    resourceTypes?: ReadonlyMap<string, unknown>
  }) {
    this.veinType = params?.veinType ?? 'Veins'
    this.veinholeActors = params?.veinholeActors ?? new Set()
    this.resourceTypes = params?.resourceTypes ?? new Map()
  }

  create(init: IGameActor): TSResourceLayer {
    return new TSResourceLayer(init, this)
  }
}

// ---------------------------------------------------------------------------
// TSResourceLayer
// OpenRA 对照: TSResourceLayer : ResourceLayer, INotifyActorDisposing
// ---------------------------------------------------------------------------

/** Tiberian Sun resource layer with vein resource support.
 *
 * OpenRA 对照: TSResourceLayer
 *
 * Extends the base ResourceLayer with vein-specific resource mechanics:
 * - Vein resources can spread from veinhole buildings
 * - Different neighbour validation rules for veins vs normal resources
 * - Veins can use sloped terrain (ramp check)
 */
export class TSResourceLayer {
  readonly info: TSResourceLayerInfo

  /** Cell positions occupied by veinhole actors.
   *
   * OpenRA 对照: TSResourceLayer.veinholeCells (HashSet<CPos>)
   */
  private readonly _veinholeCells = new Set<string>()

  /** World reference for map and resource queries.
   */
  private readonly _world: unknown

  /** Base resource layer (delegation).
   */
  private _baseLayer: unknown = null

  constructor(self: IGameActor, info: TSResourceLayerInfo) {
    this.info = info
    this._world = (self as any).world
    // C#: base(self, info) — delegation to base ResourceLayer
    this._baseLayer = (self as any).resourceLayer ?? null
  }

  // -------------------------------------------------------------------------
  // WorldLoaded — setup veinhole tracking
  // -------------------------------------------------------------------------

  /** Setup veinhole actor tracking after world load.
   *
   * OpenRA 对照: TSResourceLayer.WorldLoaded(World, WorldRenderer)
   */
  worldLoaded(w: unknown): void {
    const world = w as any
    if (world?.actorAdded) {
      // C#: w.ActorAdded += ActorAddedToWorld
      // In TS, this would be an event subscription.
      // For the migration stub, we scan existing actors.
    }
    if (world?.actors) {
      for (const a of world.actors) {
        this._actorAddedToWorld(a)
      }
    }
  }

  /** Track veinhole actors added to the world.
   *
   * OpenRA 对照: ActorAddedToWorld(Actor)
   */
  private _actorAddedToWorld(a: IGameActor): void {
    const actorName = (a as any).info?.name as string | undefined
    if (actorName && this.info.veinholeActors.has(actorName)) {
      const cells = (a as any).occupiesSpace?.occupiedCells?.() ?? []
      for (const cell of cells) {
        this._veinholeCells.add(`${cell.cell?.X ?? cell.X},${cell.cell?.Y ?? cell.Y}`)
      }
    }
  }

  /** Untrack veinhole actors removed from the world.
   *
   * OpenRA 对照: ActorRemovedFromWorld(Actor)
   */
  private _actorRemovedFromWorld(a: IGameActor): void {
    const actorName = (a as any).info?.name as string | undefined
    if (actorName && this.info.veinholeActors.has(actorName)) {
      const cells = (a as any).occupiesSpace?.occupiedCells?.() ?? []
      for (const cell of cells) {
        this._veinholeCells.delete(`${cell.cell?.X ?? cell.X},${cell.cell?.Y ?? cell.Y}`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Neighbour validation — vein vs normal resource
  // -------------------------------------------------------------------------

  /** Check if a neighbour is valid for a non-vein resource.
   *
   * OpenRA 对照: IsValidResourceNeighbour(CPos, CPos)
   */
  isValidResourceNeighbour(_cell: CPos, neighbour: CPos): boolean {
    const map = (this._world as any)?.map
    if (!map?.contains(neighbour)) return false

    // Non-vein resources are not allowed next to vein cells
    const content = this._baseLayer as any
    const neighbourContent = content?.content?.[`${neighbour.X},${neighbour.Y}`]
    return neighbourContent?.type !== this.info.veinType
  }

  /** Check if a neighbour is valid for a vein resource.
   *
   * OpenRA 对照: IsValidVeinNeighbour(CPos, CPos)
   */
  isValidVeinNeighbour(cell: CPos, neighbour: CPos): boolean {
    const world = this._world as any
    const map = world?.map
    if (!map?.contains(neighbour)) return false

    // Valid if neighbour contains a veinhole
    if (this._veinholeCells.has(`${neighbour.X},${neighbour.Y}`)) return true

    // Ramp check: neighbour must be flat or cardinal slope, unless cell is a slope
    if (map.ramp?.(cell) === 0 && map.ramp?.(neighbour) > 4) return false

    // Compatible terrain type
    const neighbourTerrain = map.getTerrainInfo?.(neighbour)?.type as string | undefined
    const veinInfo = this.info.resourceTypes.get(this.info.veinType) as any
    if (!veinInfo) return false

    return (
      neighbourTerrain === veinInfo.terrainType ||
      veinInfo.allowedTerrainTypes?.has?.(neighbourTerrain)
    )
  }

  /** Check if a resource type is allowed at a given cell.
   *
   * OpenRA 对照: AllowResourceAt(string, CPos)
   *
   * @param resourceType — the resource type to check
   * @param cell — the candidate cell
   * @returns true if the resource can be placed at this cell
   */
  allowResourceAt(resourceType: string, cell: CPos): boolean {
    const world = this._world as any
    const map = world?.map
    if (!map?.contains(cell)) return false

    // Resources only allowed on flat terrain and cardinal slopes
    if (map.ramp?.(cell) > 4) return false

    const resourceInfo = this.info.resourceTypes.get(resourceType)
    if (!resourceInfo) return false

    const terrainType = map.getTerrainInfo?.(cell)?.type as string | undefined
    if (!(resourceInfo as any).allowedTerrainTypes?.has?.(terrainType)) return false

    // For vein resources, validate vein neighbours; for others, ensure no adjacent vein
    const isVein = resourceType === this.info.veinType
    if (map.ramp?.(cell) === 0) {
      // C#: Common.Util.ExpandFootprint(cell, false).All(c => check(cell, c))
      const neighbours = this._expandFootprint(cell)
      for (const n of neighbours) {
        if (isVein) {
          if (!this.isValidVeinNeighbour(cell, n)) return false
        } else {
          if (!this.isValidResourceNeighbour(cell, n)) return false
        }
      }
    }

    // Non-vein resources can't be placed on building cells
    if (!isVein) {
      // NOTE: BuildingInfluence.AnyBuildingAt(cell) — stubbed for migration
      // This would check if any building occupies the cell
    }

    return true
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Expand a cell to include its cardinal neighbours.
   *
   * OpenRA 对照: Common.Util.ExpandFootprint(cell, false)
   */
  private _expandFootprint(cell: CPos): CPos[] {
    return [
      cell,
      { X: cell.X - 1, Y: cell.Y } as CPos,
      { X: cell.X + 1, Y: cell.Y } as CPos,
      { X: cell.X, Y: cell.Y - 1 } as CPos,
      { X: cell.X, Y: cell.Y + 1 } as CPos,
    ]
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Clean up veinhole actor event subscriptions.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
   */
  dispose(): void {
    this._veinholeCells.clear()
    this._baseLayer = null
  }

  // -------------------------------------------------------------------------
  // Queries (for testing)
  // -------------------------------------------------------------------------

  /** Number of tracked veinhole cells.
   */
  get veinholeCellCount(): number {
    return this._veinholeCells.size
  }

  /** Check if a cell is a veinhole.
   */
  isVeinholeCell(cell: CPos): boolean {
    return this._veinholeCells.has(`${cell.X},${cell.Y}`)
  }
}
