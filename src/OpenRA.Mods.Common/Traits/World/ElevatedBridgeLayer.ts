/**
 * ElevatedBridgeLayer.ts — 高架桥梁自定义移动层 (ICustomMovementLayer for bridges)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ElevatedBridgeLayer.cs
 *
 * 核心范式转换:
 * - C# ICustomMovementLayer explicit implementation → TypeScript interface implementation
 * - C# CellLayer<WPos> / CellLayer<byte> → TypeScript CellLayer<WPos> / CellLayer<number>
 * - C# HashSet<CPos> → TypeScript Set<string> (serializable cell keys)
 * - C# WDist.CellHeightStep.Length → constant CELL_HEIGHT_STEP (512)
 * - C# IWorldLoaded trait lifecycle → TypeScript worldLoaded() method
 *
 * The ElevatedBridgeLayer reads bridge footprints from
 * ElevatedBridgePlaceholderInfo traits on the world actor. For each bridge,
 * it sets the terrain type and calculates the bridge deck center positions.
 *
 * 3D mapping: Actors on the bridge have Y-offset matching bridge deck height
 * (via centerOfCell returning WPos with elevated Z).
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { WPos } from '../../../OpenRA.Game/WPos'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import { CustomMovementLayerType } from './Locomotor'
import type { LocomotorInfo } from './Locomotor'
import type { ICustomMovementLayer } from '../ICustomMovementLayer'
import type { ElevatedBridgePlaceholderInfo } from './ElevatedBridgePlaceholder'
import type { Size } from '../../../OpenRA.Game/Primitives/Size'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Height of a single map cell height step in WDist units.
 *
 * OpenRA 对照: WDist.CellHeightStep (new WDist(512))
 *
 * Each height step represents 512 world sub-units. Bridge heights are
 * specified in height steps; multiply by this to get WPos Z coordinate.
 */
export const CELL_HEIGHT_STEP = 512

// ---------------------------------------------------------------------------
// Forward interfaces (map/terrain contracts needed by ElevatedBridgeLayer)
// ---------------------------------------------------------------------------

/**
 * Terrain info contract — provides terrain type index lookup.
 *
 * OpenRA 对照: TileSet.TerrainInfo.GetTerrainIndex(string)
 */
export interface IElevatedBridgeTerrainInfo {
  getTerrainIndex(terrainType: string): number
}

/**
 * Map contract needed by ElevatedBridgeLayer.
 *
 * OpenRA 对照: Map (subset)
 */
export interface IElevatedBridgeMap {
  readonly gridType: MapGridType
  readonly mapSize: Size
  centerOfCell(cell: CPos): WPos
  readonly rules: { readonly terrainInfo: IElevatedBridgeTerrainInfo }
}

/**
 * World actor info contract for reading trait infos.
 *
 * OpenRA 对照: WorldActor.Info.TraitInfos<T>()
 */
export interface IElevatedBridgeWorldActorInfo {
  traitInfos(): ElevatedBridgePlaceholderInfo[]
}

/**
 * World contract needed by ElevatedBridgeLayer.
 *
 * OpenRA 对照: World (subset)
 */
export interface IElevatedBridgeWorld {
  readonly map: IElevatedBridgeMap
  readonly worldActor: { readonly info: IElevatedBridgeWorldActorInfo }
}

// ---------------------------------------------------------------------------
// ElevatedBridgeLayerInfo
// 对应 OpenRA ElevatedBridgeLayerInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the ElevatedBridgeLayer.
 *
 * OpenRA 对照: ElevatedBridgeLayerInfo (TraitInfo, ILobbyCustomRulesIgnore, ICustomMovementLayerInfo)
 */
export class ElevatedBridgeLayerInfo {
  /**
   * Terrain type used for cells outside any elevated bridge footprint.
   *
   * OpenRA 对照: ElevatedBridgeLayerInfo.ImpassableTerrainType
   */
  readonly ImpassableTerrainType: string

  /** Optional instance name for trait disambiguation.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /**
   * Create an ElevatedBridgeLayerInfo.
   *
   * @param opts — configuration options
   * @param opts.impassableTerrainType — terrain type for non-bridge cells (default "Impassable")
   */
  constructor(opts: { impassableTerrainType?: string; instanceName?: string } = {}) {
    this.ImpassableTerrainType = opts.impassableTerrainType ?? 'Impassable'
    this.instanceName = opts.instanceName
  }

  /**
   * Create an ElevatedBridgeLayer instance.
   *
   * OpenRA 对照: ElevatedBridgeLayerInfo.Create(ActorInitializer)
   */
  create(world: IElevatedBridgeWorld): ElevatedBridgeLayer {
    return new ElevatedBridgeLayer(world, this)
  }
}

// ---------------------------------------------------------------------------
// ElevatedBridgeLayer
// 对应 OpenRA ElevatedBridgeLayer
// ---------------------------------------------------------------------------

/**
 * Custom movement layer for elevated bridges.
 *
 * OpenRA 对照: ElevatedBridgeLayer (ICustomMovementLayer, IWorldLoaded)
 *
 * Manages terrain indices and cell centers for the ElevatedBridge layer.
 * Actors on this layer move at bridge deck height above the ground.
 *
 * For now this is largely copied from TerrainTunnelLayer's structure.
 * This will change once bridge destruction is implemented.
 */
export class ElevatedBridgeLayer implements ICustomMovementLayer {
  // -------------------------------------------------------------------------
  // ICustomMovementLayer properties
  // -------------------------------------------------------------------------

  /** Layer index — ElevatedBridge (4).
   *
   * OpenRA 对照: ICustomMovementLayer.Index → CustomMovementLayerType.ElevatedBridge
   */
  readonly Index: number = CustomMovementLayerType.ElevatedBridge

  /** Whether this layer interacts with the default (ground) layer.
   *
   * OpenRA 对照: ElevatedBridgeLayer.InteractsWithDefaultLayer → true
   */
  readonly InteractsWithDefaultLayer: boolean = true

  /** Whether actors should return to ground layer when idle.
   *
   * OpenRA 对照: ElevatedBridgeLayer.ReturnToGroundLayerOnIdle → false
   *
   * NOTE: Bridge actors stay on the bridge; they do not auto-return to ground.
   */
  readonly ReturnToGroundLayerOnIdle: boolean = false

  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  private readonly map: IElevatedBridgeMap
  private readonly cellCenters: CellLayer<WPos>
  private readonly terrainIndices: CellLayer<number>
  private readonly ends: Set<number> = new Set()
  private enabled: boolean = false

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Create an ElevatedBridgeLayer.
   *
   * OpenRA 对照: ElevatedBridgeLayer(Actor self, ElevatedBridgeLayerInfo info)
   *
   * Creates CellLayers for terrain indices and cell centers. Initializes
   * all terrain indices to the impassable terrain type.
   *
   * @param world — the game world
   * @param info — layer configuration
   */
  constructor(world: IElevatedBridgeWorld, info: ElevatedBridgeLayerInfo) {
    this.map = world.map
    this.cellCenters = new CellLayer<WPos>(world.map.gridType, world.map.mapSize)
    this.terrainIndices = new CellLayer<number>(world.map.gridType, world.map.mapSize)

    // Initialize all terrain indices to the impassable terrain type
    const impassableIndex = world.map.rules.terrainInfo.getTerrainIndex(info.ImpassableTerrainType)
    this.terrainIndices.clear(impassableIndex)
  }

  // -------------------------------------------------------------------------
  // WorldLoaded
  // -------------------------------------------------------------------------

  /**
   * Called when the world finishes loading.
   *
   * OpenRA 对照: ElevatedBridgeLayer.WorldLoaded(World, WorldRenderer)
   *
   * Reads all ElevatedBridgePlaceholderInfo traits from the world
   * actor and sets up bridge cell centers and terrain indices.
   *
   * @param world — the game world
   */
  worldLoaded(world: IElevatedBridgeWorld): void {
    const cellHeight = CELL_HEIGHT_STEP

    for (const tti of world.worldActor.info.traitInfos()) {
      this.enabled = true

      const terrain = this.map.rules.terrainInfo.getTerrainIndex(tti.TerrainType)
      for (const c of tti.bridgeCells()) {
        const uv = c.toMPos(this.map.gridType)
        this.terrainIndices.setMPos(uv, terrain)

        const pos = this.map.centerOfCell(c)
        this.cellCenters.setMPos(
          uv,
          new WPos(pos.X, pos.Y, cellHeight * tti.Height),
        )
      }

      const end = tti.endCells()
      for (const c of end) {
        // Need to explicitly set both default and tunnel layers,
        // otherwise the .Contains check will fail
        this.ends.add(new CPos(c.X, c.Y, 0).Bits)
        this.ends.add(new CPos(c.X, c.Y, CustomMovementLayerType.ElevatedBridge).Bits)
      }
    }
  }

  // -------------------------------------------------------------------------
  // ICustomMovementLayer: enabledForLocomotor
  // -------------------------------------------------------------------------

  /**
   * Whether this layer is enabled for the given locomotor.
   *
   * OpenRA 对照: ElevatedBridgeLayer.EnabledForLocomotor(LocomotorInfo)
   *
   * Elevated bridges are enabled for any ground locomotor
   * when at least one bridge footprint exists on the map.
   *
   * @returns true if any bridge footprints exist on this map
   */
  enabledForLocomotor(_locomotorInfo: LocomotorInfo): boolean {
    return this.enabled
  }

  // -------------------------------------------------------------------------
  // ICustomMovementLayer: centerOfCell
  // -------------------------------------------------------------------------

  /**
   * Get the world-space center of a cell on this layer.
   *
   * OpenRA 对照: ElevatedBridgeLayer.CenterOfCell(CPos)
   *
   * Returns the bridge deck position (elevated height) for cells
   * within the bridge footprint.
   *
   * @param cell — the cell position
   * @returns the bridge deck center position
   */
  centerOfCell(cell: CPos): WPos {
    return this.cellCenters.get(cell)
  }

  // -------------------------------------------------------------------------
  // ICustomMovementLayer: entryMovementCost
  // -------------------------------------------------------------------------

  /**
   * Cost to enter the bridge layer at a cell.
   *
   * OpenRA 对照: ElevatedBridgeLayer.EntryMovementCost(LocomotorInfo, CPos)
   *
   * Entry is free (cost 0) at end cells. Entry is blocked
   * (MovementCostForUnreachableCell) at non-end cells.
   *
   * @param _locomotorInfo — the locomotor configuration (unused)
   * @param cell — the cell to check
   * @returns 0 if entry cell, otherwise MovementCostForUnreachableCell
   */
  entryMovementCost(_locomotorInfo: LocomotorInfo, cell: CPos): number {
    return this.ends.has(cell.Bits) ? 0 : PathGraph.MovementCostForUnreachableCell
  }

  // -------------------------------------------------------------------------
  // ICustomMovementLayer: exitMovementCost
  // -------------------------------------------------------------------------

  /**
   * Cost to exit the bridge layer at a cell.
   *
   * OpenRA 对照: ElevatedBridgeLayer.ExitMovementCost(LocomotorInfo, CPos)
   *
   * Exit is free (cost 0) at end cells. Exit is blocked
   * (MovementCostForUnreachableCell) at non-end cells.
   *
   * @param _locomotorInfo — the locomotor configuration (unused)
   * @param cell — the cell to check
   * @returns 0 if exit cell, otherwise MovementCostForUnreachableCell
   */
  exitMovementCost(_locomotorInfo: LocomotorInfo, cell: CPos): number {
    return this.ends.has(cell.Bits) ? 0 : PathGraph.MovementCostForUnreachableCell
  }

  // -------------------------------------------------------------------------
  // ICustomMovementLayer: getTerrainIndex
  // -------------------------------------------------------------------------

  /**
   * Get the terrain type index for a cell on this layer.
   *
   * OpenRA 对照: ElevatedBridgeLayer.GetTerrainIndex(CPos)
   *
   * @param cell — the cell position
   * @returns the terrain type index at this cell
   */
  getTerrainIndex(cell: CPos): number {
    return this.terrainIndices.get(cell)
  }
}
