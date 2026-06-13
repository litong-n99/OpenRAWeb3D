/**
 * ResourceLayer.ts — World trait managing the map's resource deposits
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ResourceLayer.cs (302 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo + Requires<BuildingInfluenceInfo> → ITraitInfo +
 *   IResourceLayerInfo (BuildingInfluence deferred TODO-11.B.X)
 * - C# FrozenDictionary<string, ResourceTypeInfo> → Map<string, ResourceTypeInfo>
 * - C# CellLayer<ResourceLayerContents> → CellLayer<ResourceLayerContents>
 * - C# event Action<CPos, string> CellChanged → onCellChanged callback array
 * - C# Map.Resources[cell] → map.resources.get(cell)
 * - C# world.FogObscures(cell) → deferred (shroud) — always returns true
 * - C# BuildingInfluence → stubbed (returns false for building check)
 * - C# Map.Rules.TerrainInfo.GetTerrainIndex() → TileSet.getTerrainIndex()
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import type { Size } from '../../../OpenRA.Game/Primitives/Size'
import type { TerrainTypeInfo } from '../../../OpenRA.Game/Map/TerrainInfo'
import { TileSet } from '../../../OpenRA.Game/Map/TerrainInfo'
import type { MapGridType as MapGridTypeEnum } from '../../../OpenRA.Game/Map/MapGridType'
import type {
  ITraitInfo,
  IResourceLayer,
  IResourceLayerInfo,
  IWorldLoaded,
  WorldStub,
  WorldRendererStub,
  ResourceLayerContents,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import { ResourceLayerContentsEmpty } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// IResourceMap — minimal Map interface for ResourceLayer
// ---------------------------------------------------------------------------

/** Subset of Map needed by ResourceLayer.
 *
 * OpenRA 对照: Map class (subset of resource-related members)
 */
export interface IResourceMap {
  readonly mapSize: Size
  readonly grid: { readonly type: MapGridTypeEnum }
  contains(cell: CPos): boolean
  getTerrainInfo(cell: CPos): TerrainTypeInfo
  readonly resources: CellLayer<{ readonly type: number; readonly index: number }>
  readonly customTerrain: CellLayer<number>
  readonly ramp: CellLayer<number>
  readonly allCells: Iterable<CPos>
}

// ---------------------------------------------------------------------------
// IResourceWorld — extended WorldStub with Map access
// ---------------------------------------------------------------------------

/** World interface extended with Map and related services for ResourceLayer.
 *
 * OpenRA 对照: World class (resource-related subset)
 */
export interface IResourceWorld extends WorldStub {
  readonly map: IResourceMap
}

// ---------------------------------------------------------------------------
// ResourceTypeInfoConfig (ResourceLayerInfo inner)
// ---------------------------------------------------------------------------

/** Configuration for a specific resource type within ResourceLayerInfo.
 *
 * OpenRA 对照: ResourceLayerInfo.ResourceTypeInfo
 */
export interface ResourceTypeInfoConfig {
  /** Resource index in the binary map data.
   *
   * OpenRA 对照: ResourceTypeInfo.ResourceIndex (byte)
   */
  readonly resourceIndex: number

  /** Terrain type used to determine unit movement and minimap colors.
   *
   * OpenRA 对照: ResourceTypeInfo.TerrainType
   */
  readonly terrainType: string

  /** Terrain types that this resource can spawn on.
   *
   * OpenRA 对照: ResourceTypeInfo.AllowedTerrainTypes (FrozenSet<string>)
   */
  readonly allowedTerrainTypes: ReadonlySet<string>

  /** Maximum number of resource units allowed in a single cell.
   *
   * OpenRA 对照: ResourceTypeInfo.MaxDensity (default 10)
   */
  readonly maxDensity: number
}

// ---------------------------------------------------------------------------
// ResourceLayerInfo
// OpenRA 对照: ResourceLayerInfo : TraitInfo, IResourceLayerInfo, Requires<BuildingInfluenceInfo>
// ---------------------------------------------------------------------------

/** Configuration for the ResourceLayer world trait.
 *
 * OpenRA 对照: ResourceLayerInfo
 *
 * Attached to the world actor. Maps the binary resource indices from the
 * map file to resource types with terrain associations and max densities.
 */
export class ResourceLayerInfo implements ITraitInfo, IResourceLayerInfo {
  /** Optional instance name for disambiguation.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /** All known resource types, keyed by resource type name.
   *
   * OpenRA 对照: ResourceLayerInfo.ResourceTypes (FrozenDictionary)
   */
  readonly resourceTypes: Map<string, ResourceTypeInfoConfig>

  /** Override the density saved in maps with values calculated based on
   * the number of neighbouring resource cells.
   *
   * OpenRA 对照: ResourceLayerInfo.RecalculateResourceDensity (default false)
   */
  recalculateResourceDensity: boolean

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Create a new ResourceLayerInfo.
   *
   * OpenRA 对照: ResourceLayerInfo (default parameterless constructor + FieldLoader)
   *
   * @param params — configuration parameters
   */
  constructor(params: {
    instanceName?: string
    resourceTypes?: Map<string, ResourceTypeInfoConfig>
    recalculateResourceDensity?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.resourceTypes = params.resourceTypes ?? new Map()
    this.recalculateResourceDensity = params.recalculateResourceDensity ?? false
  }

  // -----------------------------------------------------------------------
  // Loading from JSON (OpenRA YAML → JSON pipeline)
  // -----------------------------------------------------------------------

  /** Load configuration from JSON (MiniYAML → JSON pipeline output).
   *
   * OpenRA 对照: ResourceLayerInfo.LoadResourceTypes(MiniYaml)
   *
   * @param json — parsed JSON from the rules YAML
   */
  loadFromJSON(json: Record<string, unknown>): void {
    if (json.RecalculateResourceDensity !== undefined) {
      this.recalculateResourceDensity = json.RecalculateResourceDensity as boolean
    }

    const resourceTypesRaw = json.ResourceTypes as Record<string, Record<string, unknown>> | undefined
    if (resourceTypesRaw) {
      for (const [key, rJson] of Object.entries(resourceTypesRaw)) {
        const allowedRaw = rJson.AllowedTerrainTypes
        let allowedTerrainTypes: Set<string>
        if (Array.isArray(allowedRaw)) {
          allowedTerrainTypes = new Set(allowedRaw as string[])
        } else if (typeof allowedRaw === 'string') {
          allowedTerrainTypes = new Set([allowedRaw])
        } else {
          allowedTerrainTypes = new Set()
        }

        this.resourceTypes.set(key, {
          resourceIndex: (rJson.ResourceIndex as number) ?? 0,
          terrainType: (rJson.TerrainType as string) ?? '',
          allowedTerrainTypes,
          maxDensity: (rJson.MaxDensity as number) ?? 10,
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // IResourceLayerInfo
  // OpenRA 对照: IResourceLayerInfo.TryGetTerrainType / TryGetResourceIndex
  // -----------------------------------------------------------------------

  /** Try to get the terrain type associated with a resource type.
   *
   * OpenRA 对照: IResourceLayerInfo.TryGetTerrainType(string, out string)
   *
   * @param resourceType — the resource type to look up
   * @returns the terrain type string, or undefined if not found
   */
  tryGetTerrainType(resourceType: string): string | undefined {
    if (!resourceType) return undefined
    const info = this.resourceTypes.get(resourceType)
    return info?.terrainType
  }

  /** Try to get the resource index for a resource type.
   *
   * OpenRA 对照: IResourceLayerInfo.TryGetResourceIndex(string, out byte)
   *
   * @param resourceType — the resource type to look up
   * @returns the resource index (0-255), or undefined if not found
   */
  tryGetResourceIndex(resourceType: string): number | undefined {
    if (!resourceType) return undefined
    const info = this.resourceTypes.get(resourceType)
    return info?.resourceIndex
  }
}

// ---------------------------------------------------------------------------
// Helper: ResourceLayerContents factory + clamp utility
// ---------------------------------------------------------------------------

/** Create a ResourceLayerContents value.
 *
 * OpenRA 对照: new ResourceLayerContents(string, byte)
 *
 * @param type — resource type name (empty string = empty cell)
 * @param density — resource density at this cell
 */
function makeContents(type: string, density: number): ResourceLayerContents {
  if (!type && density === 0) return ResourceLayerContentsEmpty
  return { type, density }
}

/** Clamp a value between min and max (inclusive).
 *
 * OpenRA 对照: value.Clamp(min, max) (Exts.cs)
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ---------------------------------------------------------------------------
// ResourceLayer
// OpenRA 对照: ResourceLayer : IResourceLayer, IWorldLoaded
// ---------------------------------------------------------------------------

/** Manages the resource deposits layered on the map terrain.
 *
 * OpenRA 对照: ResourceLayer
 *
 * Stores a CellLayer<ResourceLayerContents> (type + density per cell),
 * initializes from the map's binary resource data on world load,
 * provides mutating operations (add/remove/clear) for harvester gameplay,
 * and fires CellChanged callbacks so the ResourceRenderer can update visuals.
 *
 * NOTE: BuildingInfluence checks (AllowResourceAt) are stubbed.
 *   Buildings always allow resource placement at cells they occupy.
 *   Full integration via TODO-11.B.X.
 * NOTE: Fog-of-war visibility (IsVisible) is stubbed — always returns true.
 *   Full integration via TODO-12.A.X.
 */
export class ResourceLayer implements IResourceLayer, IWorldLoaded {
  /** Configuration for this resource layer.
   *
   * OpenRA 对照: ResourceLayer.info
   */
  readonly info: ResourceLayerInfo

  /** The game map.
   *
   * OpenRA 对照: ResourceLayer.Map
   */
  protected readonly map: IResourceMap

  /** CellLayer storing resource contents (type + density per cell).
   *
   * OpenRA 对照: ResourceLayer.Content (CellLayer<ResourceLayerContents>)
   */
  protected readonly content: CellLayer<ResourceLayerContents>

  /** Reverse lookup: resource index (byte) → resource type name.
   *
   * OpenRA 对照: ResourceLayer.ResourceTypesByIndex (Dictionary<byte, string>)
   */
  protected readonly resourceTypesByIndex: Map<number, string>

  /** Count of non-empty resource cells.
   *
   * OpenRA 对照: ResourceLayer.resCells
   */
  private _resCells = 0

  /** Cell changed callbacks.
   *
   * OpenRA 对照: ResourceLayer.CellChanged (event Action<CPos, string>)
   */
  private _cellChangedCallbacks: Array<(cell: CPos, resourceType: string | null) => void> = []

  // -----------------------------------------------------------------------
  // Construction
  // OpenRA 对照: ResourceLayer(Actor self, ResourceLayerInfo info)
  // -----------------------------------------------------------------------

  /** Create a new ResourceLayer.
   *
   * OpenRA 对照: ResourceLayer(Actor self, ResourceLayerInfo info)
   *
   * @param world — the game world (with Map)
   * @param info — the trait configuration
   */
  constructor(world: IResourceWorld, info: ResourceLayerInfo) {
    this.info = info
    this.map = world.map
    this.content = new CellLayer<ResourceLayerContents>(
      this.map.grid.type,
      this.map.mapSize,
    )
    this.content.clear(ResourceLayerContentsEmpty)

    this.resourceTypesByIndex = new Map()
    for (const [key, resInfo] of info.resourceTypes) {
      this.resourceTypesByIndex.set(resInfo.resourceIndex, key)
    }
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — Info
  // OpenRA 对照: IResourceLayer.Info => info
  // -----------------------------------------------------------------------

  get isEmpty(): boolean {
    return this._resCells < 1
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — GetResource
  // OpenRA 对照: IResourceLayer.GetResource(CPos)
  // -----------------------------------------------------------------------

  /** Get the resource contents at a map cell.
   *
   * OpenRA 对照: ResourceLayer.GetResource(CPos) (explicit IResourceLayer)
   *
   * @param cell — the map cell to query
   * @returns the resource contents, or EMPTY if cell is out of bounds
   */
  getResource(cell: CPos): ResourceLayerContents {
    if (!this.content.contains(cell)) return ResourceLayerContentsEmpty
    return this.content.get(cell)
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — GetMaxDensity
  // OpenRA 对照: IResourceLayer.GetMaxDensity(string)
  // -----------------------------------------------------------------------

  /** Get the maximum density for a resource type.
   *
   * OpenRA 对照: ResourceLayer.GetMaxDensity(string)
   *
   * @param resourceType — the resource type name
   * @returns the maximum density value, or 0 if unknown
   */
  getMaxDensity(resourceType: string): number {
    const resInfo = this.info.resourceTypes.get(resourceType)
    return resInfo?.maxDensity ?? 0
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — IsVisible
  // OpenRA 对照: IResourceLayer.IsVisible(CPos)
  //   → !world.FogObscures(cell)
  // -----------------------------------------------------------------------

  /** Check whether the resource at the given cell is visible.
   *
   * OpenRA 对照: ResourceLayer.IsVisible(CPos)
   *
   * NOTE: Fog-of-war/shroud integration deferred to Chapter 12.
   * Initial implementation always returns true.
   * TODO-12.A.X: Integrate with shroud system.
   *
   * @param _cell — the map cell to query (unused until shroud integration)
   * @returns always true (until shroud is migrated)
   */
  isVisible(_cell: CPos): boolean {
    // NOTE: OpenRA checks !world.FogObscures(cell)
    // Shroud not yet migrated — always return true.
    return true
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — onCellChanged
  // OpenRA 对照: ResourceLayer.CellChanged event
  // -----------------------------------------------------------------------

  /** Called when a cell's resource state changes.
   *
   * OpenRA 对照: CellChanged?.Invoke(cell, resourceType)
   *
   * @param cell — the cell that changed
   * @param resourceType — the new resource type, or null if cleared
   */
  onCellChanged(cell: CPos, resourceType: string | null): void {
    for (const cb of this._cellChangedCallbacks) {
      cb(cell, resourceType)
    }
  }

  // -----------------------------------------------------------------------
  // CellChanged callback registration
  // OpenRA 对照: CellChanged += handler / CellChanged -= handler
  // -----------------------------------------------------------------------

  /** Register a callback for cell change events.
   *
   * OpenRA 对照: CellChanged += handler
   *
   * @param callback — invoked with (cell, resourceType | null) on change
   */
  addCellChangedListener(callback: (cell: CPos, resourceType: string | null) => void): void {
    this._cellChangedCallbacks.push(callback)
  }

  /** Unregister a previously registered cell change callback.
   *
   * OpenRA 对照: CellChanged -= handler
   *
   * @param callback — the callback to remove
   */
  removeCellChangedListener(callback: (cell: CPos, resourceType: string | null) => void): void {
    const idx = this._cellChangedCallbacks.indexOf(callback)
    if (idx >= 0) {
      this._cellChangedCallbacks.splice(idx, 1)
    }
  }

  // -----------------------------------------------------------------------
  // IWorldLoaded
  // OpenRA 对照: ResourceLayer.WorldLoaded(World, WorldRenderer)
  // -----------------------------------------------------------------------

  /** Initialize the resource layer from the map's binary resource data.
   *
   * OpenRA 对照: ResourceLayer.WorldLoaded(World w, WorldRenderer wr)
   *
   * Iterates every cell of the map, reads the binary resource tile,
   * and creates ResourceLayerContents entries for valid resource types.
   * Optionally recalculates density based on neighbor counts.
   *
   * @param _w — the world (not used, already stored)
   * @param _wr — the world renderer (not used by resource layer)
   */
  worldLoaded(_w: WorldStub, _wr: WorldRendererStub): void {
    const allCells = this._getMapAllCells()

    for (const cell of allCells) {
      const resourceTile = this.map.resources.get(cell)
      const resourceType = this.resourceTypesByIndex.get(resourceTile.type)
      if (!resourceType) continue

      if (!this.allowResourceAt(resourceType, cell)) continue

      this.content.set(cell, this.createResourceCell(resourceType, cell, resourceTile.index))
    }

    if (!this.info.recalculateResourceDensity) return

    // Set initial density based on the number of neighboring resources
    for (const cell of allCells) {
      const resource = this.content.get(cell)
      if (!resource.type || !this.info.resourceTypes.has(resource.type)) continue

      const resInfo = this.info.resourceTypes.get(resource.type)
      if (!resInfo) continue

      let adjacent = 0
      const directions = CVec.Directions
      for (let i = 0; i < directions.length; i++) {
        const c = CPos.add(cell, directions[i])
        if (this.content.contains(c) && this.content.get(c).type === resource.type) {
          ++adjacent
        }
      }

      // We need to have at least one resource in the cell.
      // HACK: we should not be lerping to 9, as maximum adjacent resources is 8.
      // HACK: it's too disruptive to fix.
      const density = Math.max(
        lerp(0, resInfo.maxDensity, adjacent, 9),
        1,
      )
      this.content.set(cell, makeContents(resource.type, Math.floor(density)))
    }
  }

  // -----------------------------------------------------------------------
  // AllowResourceAt — check if a resource can exist at a cell
  // OpenRA 对照: ResourceLayer.AllowResourceAt(string, CPos)
  // -----------------------------------------------------------------------

  /** Check if a resource type is allowed at the given cell.
   *
   * OpenRA 对照: ResourceLayer.AllowResourceAt(string, CPos)
   *
   * Verifies:
   * 1. Cell is within map bounds
   * 2. Cell has no ramp
   * 3. Resource type is known
   * 4. Cell's terrain type is in the resource's allowed terrain types
   * 5. Buildings at the cell accept the resource's terrain type
   *    (stubbed — always passes)
   *
   * @param resourceType — the resource type to test
   * @param cell — the map cell to test
   * @returns true if the resource can exist at this cell
   */
  protected allowResourceAt(resourceType: string, cell: CPos): boolean {
    if (!this.map.contains(cell) || this.map.ramp.get(cell) !== 0) {
      return false
    }

    if (!resourceType) {
      return false
    }

    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) {
      return false
    }

    const cellTerrainInfo = this.map.getTerrainInfo(cell)
    if (!resInfo.allowedTerrainTypes.has(cellTerrainInfo.type)) {
      return false
    }

    // NOTE: BuildingInfluence check deferred
    // OpenRA: BuildingInfluence.GetBuildingsAt(cell).All(a =>
    //   a.Info.TraitInfo<BuildingInfo>().TerrainTypes.Contains(resInfo.TerrainType))
    // TODO-11.B.X: Integrate BuildingInfluence when building system is migrated
    return true
  }

  // -----------------------------------------------------------------------
  // CreateResourceCell — initialize a cell with a resource type
  // OpenRA 对照: ResourceLayer.CreateResourceCell(string, CPos, int)
  // -----------------------------------------------------------------------

  /** Create a new resource cell entry, setting the custom terrain.
   *
   * OpenRA 对照: ResourceLayer.CreateResourceCell(string, CPos, int)
   *
   * @param resourceType — the resource type to create
   * @param cell — the target map cell
   * @param density — the initial density (will be clamped to valid range)
   * @returns the ResourceLayerContents entry
   */
  protected createResourceCell(
    resourceType: string,
    cell: CPos,
    density: number,
  ): ResourceLayerContents {
    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) {
      this.map.customTerrain.set(cell, 0xff /* byte.MaxValue */)
      return ResourceLayerContentsEmpty
    }

    // Set the custom terrain to the resource's terrain type
    const terrainIndex = TileSet.getTerrainIndex(resInfo.terrainType)
    this.map.customTerrain.set(cell, terrainIndex)
    ++this._resCells

    return makeContents(
      resourceType,
      clamp(density, 1, resInfo.maxDensity),
    )
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — CanAddResource
  // OpenRA 对照: IResourceLayer.CanAddResource(string, CPos, byte)
  // -----------------------------------------------------------------------

  /** Check whether a resource can be added to a cell.
   *
   * OpenRA 对照: ResourceLayer.CanAddResource(string, CPos, byte)
   *
   * A resource can be added if:
   * - The cell is within map bounds
   * - The resource type is known
   * - If the cell is empty: AllowResourceAt passes AND amount <= MaxDensity
   * - If the cell has the same resource: density + amount <= MaxDensity
   * - If the cell has a different resource: cannot add
   *
   * @param resourceType — the resource type to add
   * @param cell — the target map cell
   * @param amount — the amount to add (default 1)
   * @returns true if the resource can be added
   */
  canAddResource(resourceType: string, cell: CPos, amount: number = 1): boolean {
    if (!this.map.contains(cell)) return false

    if (!resourceType) return false

    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) return false

    const content = this.content.get(cell)

    if (!content.type) {
      return amount <= resInfo.maxDensity && this.allowResourceAt(resourceType, cell)
    }

    if (content.type !== resourceType) return false

    return content.density + amount <= resInfo.maxDensity
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — AddResource
  // OpenRA 对照: IResourceLayer.AddResource(string, CPos, byte)
  // -----------------------------------------------------------------------

  /** Add resources to a cell, respecting MaxDensity.
   *
   * OpenRA 对照: ResourceLayer.AddResource(string, CPos, byte)
   *
   * If the cell is empty, creates a new resource cell (respecting
   * AllowResourceAt). If the cell has the same resource type,
   * increases density up to MaxDensity. Fires CellChanged on success.
   *
   * @param resourceType — the resource type to add
   * @param cell — the target map cell
   * @param amount — the amount to add (default 1)
   * @returns the amount actually added
   */
  addResource(resourceType: string, cell: CPos, amount: number = 1): number {
    if (!this.content.contains(cell)) return 0

    if (!resourceType) return 0

    let content = this.content.get(cell)

    if (!content.type) {
      content = this.createResourceCell(resourceType, cell, 0)
    }

    if (content.type !== resourceType) return 0

    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) return 0

    const oldDensity = content.density
    const density = Math.min(resInfo.maxDensity, oldDensity + amount)
    this.content.set(cell, makeContents(content.type, density))

    this.onCellChanged(cell, content.type)

    return density - oldDensity
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — RemoveResource
  // OpenRA 对照: IResourceLayer.RemoveResource(string, CPos, byte)
  // -----------------------------------------------------------------------

  /** Remove resources from a cell.
   *
   * OpenRA 对照: ResourceLayer.RemoveResource(string, CPos, byte)
   *
   * Reduces density by the given amount. If density reaches 0, the
   * cell is cleared (custom terrain reset, resCells decremented).
   * Fires CellChanged on success.
   *
   * @param resourceType — the resource type to remove
   * @param cell — the target map cell
   * @param amount — the amount to remove (default 1)
   * @returns the amount actually removed
   */
  removeResource(resourceType: string, cell: CPos, amount: number = 1): number {
    if (!this.content.contains(cell)) return 0

    const content = this.content.get(cell)
    if (!content.type || content.type !== resourceType) return 0

    const oldDensity = content.density
    const density = Math.max(0, oldDensity - amount)

    if (density === 0) {
      this.content.set(cell, ResourceLayerContentsEmpty)
      this.map.customTerrain.set(cell, 0xff /* byte.MaxValue */)
      --this._resCells

      this.onCellChanged(cell, null)
    } else {
      this.content.set(cell, makeContents(content.type, density))
      this.onCellChanged(cell, content.type)
    }

    return oldDensity - density
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — ClearResources
  // OpenRA 对照: IResourceLayer.ClearResources(CPos)
  // -----------------------------------------------------------------------

  /** Clear all resources from a cell.
   *
   * OpenRA 对照: ResourceLayer.ClearResources(CPos)
   *
   * Sets the cell to empty, resets custom terrain, and fires CellChanged.
   * Does nothing if the cell has no resources.
   *
   * @param cell — the cell to clear
   */
  clearResources(cell: CPos): void {
    if (!this.content.contains(cell)) return

    // Don't break other users of CustomTerrain if there are no resources
    const content = this.content.get(cell)
    if (!content.type) return

    this.content.set(cell, ResourceLayerContentsEmpty)
    this.map.customTerrain.set(cell, 0xff /* byte.MaxValue */)
    --this._resCells

    this.onCellChanged(cell, null)
  }

  // -----------------------------------------------------------------------
  // Public helpers
  // -----------------------------------------------------------------------

  /** Count of non-empty resource cells.
   *
   * OpenRA 对照: ResourceLayer.resCells (private)
   */
  get resourceCellCount(): number {
    return this._resCells
  }

  /** Get all cells of the map.
   *
   * OpenRA 对照: Map.AllCells
   *
   * Uses the map's allCells property if available, otherwise falls
   * back to iterating over the map dimensions.
   */
  private _getMapAllCells(): Iterable<CPos> {
    if (this.map.allCells && typeof this.map.allCells[Symbol.iterator] === 'function') {
      const iter = this.map.allCells[Symbol.iterator]()
      if (iter.next && !iter.next().done) {
        // Reset by creating a new iterator
        return this.map.allCells
      }
    }

    // Fallback: iterate over map dimensions
    const size = this.map.mapSize
    const cells: CPos[] = []
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        cells.push(new CPos(x, y))
      }
    }
    return cells
  }
}

// ---------------------------------------------------------------------------
// Integer linear interpolation (lerp)
// OpenRA 对照: int2.Lerp(int, int, int, int)
// ---------------------------------------------------------------------------

/** Linear interpolation for integers.
 *
 * OpenRA 对照: int2.Lerp(int a, int b, int mu, int muMax)
 *
 * NOTE: OpenRA uses fixed-point Lerp with rounding (512 bias),
 * then truncates to int. This implementation uses floating point
 * for simplicity.
 *
 * @param a — minimum value
 * @param b — maximum value
 * @param mu — current position (0..muMax)
 * @param muMax — maximum position
 * @returns the interpolated value
 */
function lerp(a: number, b: number, mu: number, muMax: number): number {
  if (muMax <= 0) return a
  const t = mu / muMax
  return a + (b - a) * t
}
