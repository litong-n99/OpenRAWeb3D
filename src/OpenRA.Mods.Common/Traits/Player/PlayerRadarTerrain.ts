/**
 * PlayerRadarTerrain.ts — 玩家雷达地形颜色缓存器
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerRadarTerrain.cs (97 lines)
 *
 * 核心范式转换:
 * - C# event Action<MPos> CellTerrainColorChanged → TS callback array pattern
 * - C# CellLayer<(uint, uint)> single tuple layer → TS TWO CellLayer<number>
 *   (left/right) because CellLayer constructor copies a single value and a
 *   tuple/array would be shared by reference across cells
 * - C# Shroud.OnShroudChanged event +=/-= → TS addOnShroudChanged /
 *   removeOnShroudChanged
 * - C# Map.Unproject(PPos) → TS Map.unproject(PPos) (identical API)
 * - C# indexer this[MPos uv] → TS getTerrainColor(uv: MPos) method
 * - C# Game.CosmeticRandom → TS Math.random() (non-sync visual RNG)
 *
 * PlayerRadarTerrain 是附加到玩家 Actor 上的 trait。它维护每个 map cell
 * 的雷达/小地图颜色缓存（左右两个 ARGB 颜色值），当格子可见性变化或
 * 地形/资源单元格改变时自动更新。
 *
 * TraitLocation: SystemActors.Player
 * Requires: Shroud
 */

import { Component, type IWorldLoaded, type IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IRadarTerrainLayer } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WorldRendererStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WorldStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Shroud } from '../../../OpenRA.Game/Traits/Player/Shroud.js'
import { PPos, MPos } from '../../../OpenRA.Game/MPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { Map as GameMap } from '../../../OpenRA.Game/Map/Map.js'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer.js'

// ---------------------------------------------------------------------------
// CellTerrainColorChangedCallback
// ---------------------------------------------------------------------------

/** Callback for per-cell terrain color changes on the radar.
 *
 * OpenRA 对照: event Action<MPos> CellTerrainColorChanged
 */
export type CellTerrainColorChangedCallback = (uv: MPos) => void

// ---------------------------------------------------------------------------
// PlayerRadarTerrain (OpenRA 对照: PlayerRadarTerrain : IWorldLoaded)
// ---------------------------------------------------------------------------

/**
 * Per-player radar terrain color cache.
 *
 * OpenRA 对照: PlayerRadarTerrain
 *
 * Maintains a CellLayer of ARGB color pairs (left/right) for every map cell,
 * used by the radar minimap widget. Colors are populated lazily:
 * - On shroud visibility change, the newly visible cells are computed
 * - On terrain tile or radar layer change, affected cells are recomputed
 * - Static getColor queries all IRadarTerrainLayer implementations first,
 *   falling back to the map's default GetTerrainColorPair
 *
 * Uses TWO CellLayer<number> (left, right) instead of one CellLayer of tuples
 * because CellLayer constructor copies a single initial value and a tuple/array
 * would be shared by reference across all cells.
 */
export class PlayerRadarTerrain extends Component implements IWorldLoaded {
  /** Whether the terrain color cache has been fully initialized.
   *
   * OpenRA 对照: PlayerRadarTerrain.IsInitialized
   */
  isInitialized: boolean = false

  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** Reference to the player's shroud trait. */
  private readonly _shroud: Shroud

  /** Array of registered IRadarTerrainLayer implementations from the world actor. */
  private _radarTerrainLayers: readonly IRadarTerrainLayer[] = []

  /** CellLayer for the left terrain colour (ARGB uint32). */
  private _terrainColorLeft: CellLayer<number> | null = null

  /** CellLayer for the right terrain colour (ARGB uint32). */
  private _terrainColorRight: CellLayer<number> | null = null

  /** Bound UpdateShroudCell callback for subscription/unsubscription. */
  private readonly _boundUpdateShroudCell: (puv: PPos) => void

  /** Bound callback for map tile changes. */
  private _boundUpdateFromTileCell: ((cell: CPos) => void) | null = null

  /** Registered cell terrain color changed listeners. */
  private readonly _cellTerrainColorChangedCallbacks: CellTerrainColorChangedCallback[] = []

  /** Cached map reference (set during worldLoaded). */
  private _map: GameMap | null = null

  // -------------------------------------------------------------------------
  // Constructor (OpenRA 对照: PlayerRadarTerrain(Actor))
  // -------------------------------------------------------------------------

  /**
   * Construct a PlayerRadarTerrain trait on a player actor.
   *
   * OpenRA 对照: PlayerRadarTerrain(Actor self)
   *
   * Looks up the player's Shroud trait and subscribes to its visibility
   * change events so radar colours can be updated when cells become visible.
   *
   * @param self — the player actor this trait is attached to
   */
  constructor(self: IGameActor) {
    super()
    // Access Shroud from the player actor via runtime trait lookup
    // SAFETY: Shroud is a required trait on Player actors. At runtime,
    // the actor's traitsImplementing method returns all traits matching
    // the given interface name. We take the first matching one.
    const shroudTraits = (self as any).traitsImplementing?.('Shroud') as Shroud[] | undefined
    if (!shroudTraits || shroudTraits.length === 0) {
      throw new Error('PlayerRadarTerrain requires a Shroud trait on the player actor')
    }
    this._shroud = shroudTraits[0]!

    // Bind and subscribe to shroud changes
    this._boundUpdateShroudCell = this._updateShroudCell.bind(this)
    this._shroud.addOnShroudChanged(this._boundUpdateShroudCell)
  }

  // -------------------------------------------------------------------------
  // IWorldLoaded (OpenRA 对照: IWorldLoaded.WorldLoaded(World, WorldRenderer))
  // -------------------------------------------------------------------------

  /**
   * Called when the world has finished loading.
   *
   * OpenRA 对照: PlayerRadarTerrain.WorldLoaded(World w, WorldRenderer wr)
   *
   * Queries the world actor for IRadarTerrainLayer implementations, creates
   * the CellLayer storage, and schedules initial population of all cells
   * via a FrameEndTask. Subscribes to map tile changes and radar layer
   * cell changes for incremental updates.
   *
   * @param w — the game world
   * @param _wr — the world renderer (unused by this trait)
   */
  worldLoaded(w: WorldStub, _wr: WorldRendererStub): void {
    // SAFETY: Runtime access to world.map and world.worldActor
    const worldAny = w as any
    const map = worldAny.map as GameMap
    this._map = map

    // Collect radar terrain layers from the world actor
    const worldActor = worldAny.worldActor as IGameActor | undefined
    if (worldActor) {
      const layers = worldActor.traitsImplementing?.('IRadarTerrainLayer') as IRadarTerrainLayer[] | undefined
      this._radarTerrainLayers = layers ?? []
    }

    // Create CellLayers — use separate layers for left/right to avoid
    // tuple reference sharing (CellLayer constructor copies a single value)
    this._terrainColorLeft = new CellLayer<number>(map.grid.type, map.mapSize)
    this._terrainColorRight = new CellLayer<number>(map.grid.type, map.mapSize)

    // Schedule initial population via FrameEndTask
    const frameEndTask = (_: WorldStub) => {
      // Populate initial terrain colour for every map cell
      for (const uv of map.allCells.MapCoords) {
        this._updateTerrainCellColor(uv)
      }

      // Subscribe to map tile changes
      this._boundUpdateFromTileCell = (cell: CPos) => {
        this._updateTerrainCell(cell.toMPos(map.grid.type))
      }
      map.tiles.onCellEntryChanged(this._boundUpdateFromTileCell)

      // Subscribe to each radar layer's cell changes
      for (const rtl of this._radarTerrainLayers) {
        rtl.addCellEntryChangedListener((cell: CPos) => {
          this._updateTerrainCell(cell.toMPos(map.grid.type))
        })
      }

      this.isInitialized = true
    }
    ;(w as any).addFrameEndTask?.(frameEndTask) ?? frameEndTask(w)
  }

  // -------------------------------------------------------------------------
  // UpdateShroudCell (OpenRA 对照: UpdateShroudCell(PPos))
  // -------------------------------------------------------------------------

  /**
   * Called when the shroud visibility changes at a projected cell.
   *
   * OpenRA 对照: PlayerRadarTerrain.UpdateShroudCell(PPos puv)
   *
   * Unprojects the PPos back to map cells and updates each one that is
   * now visible to the player.
   *
   * @param puv — the projected cell position whose visibility changed
   */
  private _updateShroudCell(puv: PPos): void {
    if (!this._map) return

    const uvs = this._map.unproject(puv)
    for (const uv of uvs) {
      this._updateTerrainCell(uv)
    }
  }

  // -------------------------------------------------------------------------
  // UpdateTerrainCell (OpenRA 对照: UpdateTerrainCell(MPos))
  // -------------------------------------------------------------------------

  /**
   * Update the radar colour for a map cell if visible.
   *
   * OpenRA 对照: PlayerRadarTerrain.UpdateTerrainCell(MPos uv)
   *
   * Checks visibility via the shroud before computing the colour.
   *
   * @param uv — the map cell to update
   */
  private _updateTerrainCell(uv: MPos): void {
    if (this._shroud.isVisible(uv)) {
      this._updateTerrainCellColor(uv)
    }
  }

  // -------------------------------------------------------------------------
  // UpdateTerrainCellColor (OpenRA 对照: UpdateTerrainCellColor(MPos))
  // -------------------------------------------------------------------------

  /**
   * Compute and store the radar colour for a map cell.
   *
   * OpenRA 对照: PlayerRadarTerrain.UpdateTerrainCellColor(MPos uv)
   *
   * Calls the static getColor to query radar layers then fall back to
   * map defaults. Writes results to both CellLayers and fires the
   * CellTerrainColorChanged callbacks.
   *
   * @param uv — the map cell to colour
   */
  private _updateTerrainCellColor(uv: MPos): void {
    if (!this._map || !this._terrainColorLeft || !this._terrainColorRight) return

    const [left, right] = PlayerRadarTerrain.getColor(
      this._map,
      this._radarTerrainLayers,
      uv,
    )

    this._terrainColorLeft.setMPos(uv, left)
    this._terrainColorRight.setMPos(uv, right)

    // Fire callbacks
    for (const cb of this._cellTerrainColorChangedCallbacks) {
      cb(uv)
    }
  }

  // -------------------------------------------------------------------------
  // Static getColor (OpenRA 对照: static GetColor(Map, IRadarTerrainLayer[], MPos))
  // -------------------------------------------------------------------------

  /**
   * Compute the radar colour pair for a map cell.
   *
   * OpenRA 对照: PlayerRadarTerrain.GetColor(Map map, IRadarTerrainLayer[] radarTerrainLayers, MPos uv)
   *
   * Iterates over all registered IRadarTerrainLayer implementations in order.
   * The first layer that returns a colour pair wins. If none do, falls back
   * to the map's default terrain colour method.
   *
   * @param map — the game map
   * @param radarTerrainLayers — ordered array of radar terrain layer traits
   * @param uv — the map cell to colour
   * @returns [leftColor, rightColor] as ARGB uint32 values
   */
  static getColor(
    map: GameMap,
    radarTerrainLayers: readonly IRadarTerrainLayer[],
    uv: MPos,
  ): [number, number] {
    // Try each radar terrain layer in priority order
    for (const rtl of radarTerrainLayers) {
      const result = rtl.tryGetTerrainColorPair(uv)
      if (result[0]) {
        const { left, right } = result[1]!
        return [left, right]
      }
    }

    // Fall back to default map terrain colors
    return map.getTerrainColorPair(uv)
  }

  // -------------------------------------------------------------------------
  // Indexer (OpenRA 对照: this[MPos uv] -> (uint Left, uint Right))
  // -------------------------------------------------------------------------

  /**
   * Get the cached terrain colour pair for a map cell.
   *
   * OpenRA 对照: public (uint Left, uint Right) this[MPos uv]
   *
   * NOTE: In C# this is an indexer property. In TypeScript we use a method.
   *
   * @param uv — the map cell to query
   * @returns [leftColor, rightColor] as ARGB uint32 values.
   *   Returns [0, 0] if the cache has not been initialized.
   */
  getTerrainColor(uv: MPos): [number, number] {
    if (!this._terrainColorLeft || !this._terrainColorRight) {
      return [0, 0]
    }
    return [this._terrainColorLeft.getMPos(uv), this._terrainColorRight.getMPos(uv)]
  }

  // -------------------------------------------------------------------------
  // CellTerrainColorChanged callbacks
  // -------------------------------------------------------------------------

  /**
   * Register a callback for cell terrain colour changes.
   *
   * OpenRA 对照: event Action<MPos> CellTerrainColorChanged += handler
   *
   * @param callback — called with MPos whenever a cell's radar colour changes
   */
  addCellTerrainColorChangedListener(callback: CellTerrainColorChangedCallback): void {
    this._cellTerrainColorChangedCallbacks.push(callback)
  }

  /**
   * Unregister a previously registered callback.
   *
   * OpenRA 对照: event Action<MPos> CellTerrainColorChanged -= handler
   *
   * @param callback — the previously registered callback
   */
  removeCellTerrainColorChangedListener(callback: CellTerrainColorChangedCallback): void {
    const idx = this._cellTerrainColorChangedCallbacks.indexOf(callback)
    if (idx !== -1) {
      this._cellTerrainColorChangedCallbacks.splice(idx, 1)
    }
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /**
   * Clean up subscriptions and release resources.
   *
   * Unsubscribes from the shroud visibility change event and clears all
   * callback arrays. CellLayer data is garbage collected.
   */
  override dispose(): void {
    // Unsubscribe from shroud
    this._shroud.removeOnShroudChanged(this._boundUpdateShroudCell)

    // Unsubscribe from map tile changes
    if (this._boundUpdateFromTileCell && this._map) {
      this._map.tiles.offCellEntryChanged(this._boundUpdateFromTileCell)
      this._boundUpdateFromTileCell = null
    }

    // Clear callbacks
    this._cellTerrainColorChangedCallbacks.length = 0

    // Null out references
    this._terrainColorLeft = null
    this._terrainColorRight = null
    this._radarTerrainLayers = []
    this._map = null

    super.dispose()
  }
}
