/**
 * TerrainTunnelLayer.ts -- TerrainTunnel custom movement layer
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/TerrainTunnelLayer.cs
 *
 * 核心范式转换:
 * - C# ICustomMovementLayer interface → TypeScript ICustomMovementLayer interface
 * - C# CellLayer<WPos> / CellLayer<byte> → Map<number, ...> indexed by CPos.Bits
 * - C# HashSet<CPos> → Set<number> keyed by CPos.Bits
 * - C# IWorldLoaded → IWorldLoaded interface stub
 * - C# terrain index lookup via map.Rules.TerrainInfo → delegate function
 */

import type { CPos } from '../../../OpenRA.Game/CPos'
import { WPos } from '../../../OpenRA.Game/WPos'
import type {
  IWorldLoaded,
  WorldRendererStub,
  WorldStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import {
  CustomMovementLayerType,
  type LocomotorInfo,
} from './Locomotor'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import type { ICustomMovementLayer } from '../ICustomMovementLayer'
import { TerrainTunnelInfo } from './TerrainTunnel'

// ---------------------------------------------------------------------------
// TerrainTunnelLayerInfo -- Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the tunnel movement layer.
 *
 * OpenRA 对照: TerrainTunnelLayerInfo : TraitInfo, ILobbyCustomRulesIgnore,
 *   ICustomMovementLayerInfo
 *
 * This is a world-level trait that manages the underground tunnel movement
 * layer. It is placed on the world actor during map creation.
 */
export class TerrainTunnelLayerInfo {
  /** Terrain type used for cells outside any tunnel footprint.
   *
   * OpenRA 对照: TerrainTunnelLayerInfo.ImpassableTerrainType
   */
  readonly impassableTerrainType: string

  constructor(impassableTerrainType: string = 'Impassable') {
    this.impassableTerrainType = impassableTerrainType
  }
}

// ---------------------------------------------------------------------------
// TerrainTunnelLayer -- Tunnel movement layer implementation
// ---------------------------------------------------------------------------

/**
 * Implements ICustomMovementLayer for tunnel passages.
 *
 * OpenRA 对照: TerrainTunnelLayer : ICustomMovementLayer, IWorldLoaded
 *
 * Manages the underground tunnel movement layer. Reads tunnel footprints
 * from TerrainTunnelInfo entries on the world actor and populates the
 * cell centers, terrain indices, and portal cells.
 */
export class TerrainTunnelLayer implements ICustomMovementLayer, IWorldLoaded {
  /** Cell center positions indexed by CPos.Bits. */
  private _cellCenters: Map<number, WPos> = new Map()

  /** Terrain indices indexed by CPos.Bits. */
  private _terrainIndices: Map<number, number> = new Map()

  /** Portal cells (both layer 0 and tunnel layer copies) indexed by Bits. */
  private _portals: Set<number> = new Set()

  /** Whether this layer is enabled (set when tunnels exist). */
  private _enabled: boolean = false

  /** Terrain index resolver function (set from world rules during worldLoaded). */
  private _getTerrainIndex: ((terrainType: string) => number) | null = null

  /** Height of a map cell step (from world.Map.CellHeightStep). */
  private _cellHeight: number = 0

  constructor(_info: TerrainTunnelLayerInfo) {
    // NOTE: _info stored for future use (e.g., ImpassableTerrainType),
    // but currently unused since tunnel terrain types come from TerrainTunnelInfo.
  }

  // ---------------------------------------------------------------------------
  // ICustomMovementLayer properties
  // ---------------------------------------------------------------------------

  /**
   * Layer index for tunnel movement (always 1).
   *
   * OpenRA 对照: ICustomMovementLayer.Index
   */
  get Index(): number {
    return CustomMovementLayerType.Tunnel
  }

  /**
   * Whether actors on this layer interact with the default (ground) layer.
   *
   * OpenRA 对照: ICustomMovementLayer.InteractsWithDefaultLayer
   *
   * Tunnels are underground and do NOT interact with the ground layer.
   */
  get InteractsWithDefaultLayer(): boolean {
    return false
  }

  /**
   * Whether actors on this layer return to the ground layer on idle.
   *
   * OpenRA 对照: ICustomMovementLayer.ReturnToGroundLayerOnIdle
   *
   * NOTE: OpenRA sets this to true -- tunnel units perform their orders
   * then pop back to the ground layer when idle.
   */
  get ReturnToGroundLayerOnIdle(): boolean {
    return true
  }

  // ---------------------------------------------------------------------------
  // ICustomMovementLayer methods
  // ---------------------------------------------------------------------------

  /**
   * Whether this movement layer is enabled for a specific locomotor.
   *
   * OpenRA 对照: ICustomMovementLayer.EnabledForLocomotor(LocomotorInfo)
   *
   * Tunnel layers are enabled for all ground-based locomotor types when
   * any tunnels exist on the map.
   */
  enabledForLocomotor(_locomotorInfo: LocomotorInfo): boolean {
    return this._enabled
  }

  /**
   * Get the movement cost to enter this tunnel layer at a given cell.
   *
   * OpenRA 对照: ICustomMovementLayer.EntryMovementCost(LocomotorInfo, CPos)
   *
   * Entry is only allowed at portal cells. All other cells return
   * MovementCostForUnreachableCell.
   */
  entryMovementCost(_locomotorInfo: LocomotorInfo, cell: CPos): number {
    return this._portals.has(cell.Bits) ? 0 : PathGraph.MovementCostForUnreachableCell
  }

  /**
   * Get the movement cost to exit this tunnel layer at a given cell.
   *
   * OpenRA 对照: ICustomMovementLayer.ExitMovementCost(LocomotorInfo, CPos)
   *
   * Exit is only allowed at portal cells.
   */
  exitMovementCost(_locomotorInfo: LocomotorInfo, cell: CPos): number {
    return this._portals.has(cell.Bits) ? 0 : PathGraph.MovementCostForUnreachableCell
  }

  /**
   * Get the 3D center position of a cell on this layer.
   *
   * OpenRA 对照: ICustomMovementLayer.CenterOfCell(CPos)
   *
   * Returns the sub-surface position offset by the tunnel height.
   * Falls back to ground-level center if the cell is not mapped.
   */
  centerOfCell(cell: CPos): WPos {
    return this._cellCenters.get(cell.Bits) ?? WPos.Zero
  }

  /**
   * Get the terrain index for a cell on this layer.
   *
   * OpenRA 对照: ICustomMovementLayer.GetTerrainIndex(CPos)
   *
   * Used by Locomotor to compute terrain movement costs on the tunnel layer.
   */
  getTerrainIndex(cell: CPos): number {
    return this._terrainIndices.get(cell.Bits) ?? 255
  }

  // ---------------------------------------------------------------------------
  // IWorldLoaded
  // ---------------------------------------------------------------------------

  /**
   * Called when the world has finished loading.
   *
   * OpenRA 对照: TerrainTunnelLayer.WorldLoaded(World, WorldRenderer)
   *
   * Scans the world actor's TerrainTunnelInfo entries and populates
   * cell centers, terrain indices, and portal cells for each tunnel.
   *
   * NOTE: The first parameter is typed as WorldStub to satisfy the
   * IWorldLoaded interface, but internally we cast to access the
   * full World object's properties.
   *
   * @param w -- the game world
   * @param _wr -- world renderer (unused)
   */
  worldLoaded(w: WorldStub, _wr: WorldRendererStub): void {
    // HACK: Access World.Map via the stub interface.
    const worldAny = w as unknown as Record<string, unknown>
    const map = worldAny['map'] as Record<string, unknown> | undefined
    if (!map) return

    // Resolve cell height step
    if (typeof (map as Record<string, unknown>)['cellHeightStep'] === 'object') {
      const cellHeightStep = (map as Record<string, unknown>)['cellHeightStep'] as { length: number } | undefined
      this._cellHeight = cellHeightStep?.length ?? 0
    }

    // Resolve terrain index function
    if (typeof (map as Record<string, unknown>)['rules'] === 'object') {
      const rules = (map as Record<string, unknown>)['rules'] as Record<string, unknown> | undefined
      const terrainInfo = rules?.['terrainInfo'] as Record<string, unknown> | undefined
      if (typeof terrainInfo?.['getTerrainIndex'] === 'function') {
        this._getTerrainIndex = terrainInfo['getTerrainIndex'] as (type: string) => number
      }
    }

    // Resolve center of cell function
    const centerOfCell = (map as Record<string, unknown>)['centerOfCell'] as ((c: CPos) => WPos) | undefined
    if (!centerOfCell) return

    // Iterate over TerrainTunnelInfo entries on the world actor
    const worldActor = worldAny['worldActor'] as Record<string, unknown> | undefined
    const traitInfos = worldActor?.['info'] as Record<string, unknown> | undefined
    const getTunnelInfos = traitInfos?.['traitInfos'] as (() => TerrainTunnelInfo[]) | undefined

    if (getTunnelInfos) {
      const infos = getTunnelInfos()
      for (const tti of infos) {
        this._enabled = true

        const terrain = this._getTerrainIndex?.(tti.terrainType) ?? 255
        const heightOffset = this._cellHeight * tti.height

        // Populate cell centers and terrain indices
        const tunnelCells = tti.tunnelCells()
        for (const c of tunnelCells) {
          this._terrainIndices.set(c.Bits, terrain)

          const pos = centerOfCell(c)
          const undergroundPos = new WPos(
            pos.X,
            pos.Y,
            pos.Z - heightOffset,
          )
          this._cellCenters.set(c.Bits, undergroundPos)
        }

        // Register portal cells on both layers
        const portalCells = tti.portalCells()
        for (const c of portalCells) {
          const CPosClass = c.constructor as typeof CPos
          this._portals.add(new CPosClass(c.X, c.Y, 0).Bits)
          this._portals.add(new CPosClass(c.X, c.Y, CustomMovementLayerType.Tunnel).Bits)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal accessors
  // ---------------------------------------------------------------------------

  /**
   * Whether this tunnel layer has been enabled (has at least one tunnel).
   *
   * OpenRA 对照: enabled field
   */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * The set of portal cell Bits entries.
   *
   * OpenRA 对照: portals HashSet<CPos>
   */
  get portals(): ReadonlySet<number> {
    return this._portals
  }

  /**
   * The cell centers map.
   */
  get cellCenters(): ReadonlyMap<number, WPos> {
    return this._cellCenters
  }
}
