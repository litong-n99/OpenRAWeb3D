/**
 * EditorResourceLayer.ts — 编辑器资源操作层
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/EditorResourceLayer.cs (313 lines)
 *
 * 核心范式转换:
 * - C# Map.Resources binary layer + Tiles CellLayer → Map<string, {type, density}> keyed store
 * - C# CellEntryChanged subscription → direct mutation with onCellChanged callback
 * - C# CellLayer<ResourceLayerContents> → Map keyed by "X,Y" string
 * - C# Clone via serialization → manual deep copy of Map + state
 * - C# BuildingInfluence check → stubbed (always passes)
 * - C# TraitInfo + IResourceLayerInfo → ITraitInfo + IResourceLayerInfo
 * - C# OpenRA resource values → configurable resourceValues Map
 * - Editor allows replacing one resource type with another (unlike gameplay ResourceLayer)
 *
 * Migration:  — Chapter 21 Phase A
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import type {
  ITraitInfo,
  IResourceLayer,
  IResourceLayerInfo,
  IWorldLoaded,
  IGameActor,
  WorldStub,
  WorldRendererStub,
  ResourceLayerContents,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ResourceLayerContentsEmpty } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ResourceTypeInfoConfig } from './ResourceLayer.js'

// ---------------------------------------------------------------------------
// Cell key encoding
// ---------------------------------------------------------------------------

/** Encode a CPos to a string key for Map lookup.
 *
 * OpenRA 对照: implicit cell → index conversion via CellLayer
 *
 * @param cell — the cell position
 * @returns a string key like "X,Y"
 */
function cellKey(cell: CPos): string {
  return `${cell.X},${cell.Y}`
}

// ---------------------------------------------------------------------------
// EditorResourceLayerInfo
// OpenRA 对照: EditorResourceLayerInfo : TraitInfo, IResourceLayerInfo
// ---------------------------------------------------------------------------

/** Configuration for the EditorResourceLayer.
 *
 * OpenRA 对照: EditorResourceLayerInfo
 *
 * Attached to the editor world actor. Defines available resource types
 * and their properties (terrain type, resource index, max density, etc.).
 */
export class EditorResourceLayerInfo implements ITraitInfo, IResourceLayerInfo {
  /** Optional instance name for disambiguation.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /** All known resource types, keyed by resource type name.
   *
   * OpenRA 对照: EditorResourceLayerInfo.ResourceTypes (FrozenDictionary)
   */
  readonly resourceTypes: Map<string, ResourceTypeInfoConfig>

  /** Override the density saved in maps with values calculated based on
   * the number of neighbouring resource cells.
   *
   * OpenRA 对照: EditorResourceLayerInfo.RecalculateResourceDensity (default false)
   *
   * NOTE: This flag is defined but not yet consumed by the editor. In OpenRA
   * it drives neighbor-based density recalculation in UpdateCell. When the
   * editor brush interacts with full terrain data, this flag should control
   * whether getDensity() uses raw or neighbor-averaged values.
* Wire RecalculateResourceDensity to density computation.
   */
  recalculateResourceDensity: boolean

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Create a new EditorResourceLayerInfo.
   *
   * OpenRA 对照: EditorResourceLayerInfo (parameterless constructor + FieldLoader)
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

  // -----------------------------------------------------------------------
  // ITraitInfo
  // -----------------------------------------------------------------------

  /** Create the EditorResourceLayer trait instance.
   *
   * OpenRA 对照: EditorResourceLayerInfo.Create(ActorInitializer)
   *
   * @param _init — actor initializer (unused by this trait)
   * @returns a new EditorResourceLayer instance
   */
  create(_init: { self: IGameActor }): EditorResourceLayer {
    return new EditorResourceLayer(this)
  }
}

// ---------------------------------------------------------------------------
// ResourceCellData — internal storage for a single cell's resource state
// ---------------------------------------------------------------------------

/** Internal storage for a single resource cell's data.
 *
 * OpenRA 对照: ResourceLayerContents + the raw density value
 */
interface ResourceCellData {
  /** The resource type identifier (e.g., "ore", "gems"), empty string if none. */
  type: string
  /** The density/amount of resource at this cell (0 if empty). */
  density: number
}

// ---------------------------------------------------------------------------
// EditorResourceLayer
// OpenRA 对照: EditorResourceLayer : IResourceLayer, IWorldLoaded, INotifyActorDisposing
// ---------------------------------------------------------------------------

/** Editor resource manipulation layer.
 *
 * OpenRA 对照: EditorResourceLayer
 *
 * Stores resources in a Map<string, ResourceCellData> keyed by cell position
 * ("X,Y" format). Implements the IResourceLayer interface for editor mode.
 *
 * Unlike the gameplay ResourceLayer, the editor allows replacing one resource
 * type with another (replaces the cell content entirely). The editor also
 * provides clone() for undo/redo snapshots and clearAllResources() for
 * bulk deletion.
 *
 * NOTE: BuildingInfluence checks are stubbed — all terrain types are treated
 * as valid for resource placement. Full integration via TODO-11.B.X.
 *
* CalculateRegionValue(region) — sum resource value over a
 * CellCoordsRegion. Needed when editor brushes show region statistics.
* CalculateCellDensity() + neighbor-based recalculation —
 * matching OpenRA's ResourceLayer density averaging. gated by
 * RecalculateResourceDensity flag.
* AllowResourceAt terrain/ramp checks — editor currently allows
 * resource placement anywhere. Terrain validation should be added when
 * editor terrain data integration is complete.
 */
export class EditorResourceLayer implements IResourceLayer, IWorldLoaded {
  /** Configuration for this resource layer.
   *
   * OpenRA 对照: EditorResourceLayer.info
   */
  readonly info: EditorResourceLayerInfo

  /** Available resource types (derived from info).
   *
   * OpenRA 对照: EditorResourceLayerInfo.ResourceTypes.Keys
   */
  get resourceTypes(): string[] {
    return Array.from(this.info.resourceTypes.keys())
  }

  // -----------------------------------------------------------------------
  // Internal storage — Map keyed by "X,Y" cell position
  // -----------------------------------------------------------------------

  /** Per-cell resource data.
   *
   * OpenRA 对照: EditorResourceLayer.Tiles (CellLayer<ResourceLayerContents>)
   *
   * Only populated entries exist in this map — missing keys are equivalent
   * to empty resource cells.
   */
  private _cells: Map<string, ResourceCellData> = new Map()

  // -----------------------------------------------------------------------
  // Resource values — economic valuation per resource unit
  // -----------------------------------------------------------------------

  /** Resource unit values for netWorth calculation.
   *
   * OpenRA 对照: EditorResourceLayer.resourceValues (FrozenDictionary<string, int>)
   *
   * Keys are resource type names, values are economic value per density unit.
   * If empty, netWorth will always be 0.
   */
  private _resourceValues: Map<string, number> = new Map()

  // -----------------------------------------------------------------------
  // netWorth — cumulative resource value
  // -----------------------------------------------------------------------

  /** Total economic value of all resources on the map.
   *
   * OpenRA 对照: EditorResourceLayer.NetWorth
   *
   * Calculated as sum of (density × resourceValue) for all cells.
   * Updated incrementally on add/remove/clear operations for efficiency.
   */
  private _netWorth: number = 0

  /** Get the current net resource worth.
   *
   * OpenRA 对照: EditorResourceLayer.NetWorth { get; protected set; }
   */
  get netWorth(): number {
    return this._netWorth
  }

  // -----------------------------------------------------------------------
  // Cell changed callbacks
  // -----------------------------------------------------------------------

  /** Cell changed callbacks.
   *
   * OpenRA 对照: EditorResourceLayer.CellChanged (event Action<CPos, string>)
   */
  private _cellChangedCallbacks: Array<(cell: CPos, resourceType: string | null) => void> = []

  // -----------------------------------------------------------------------
  // Disposal flag
  // -----------------------------------------------------------------------

  private _disposed: boolean = false

  // -----------------------------------------------------------------------
  // Resource cell count
  // -----------------------------------------------------------------------

  /** Count of non-empty resource cells.
   *
   * OpenRA 对照: implicit from CellLayer iteration
   */
  private _resCells: number = 0

  // -----------------------------------------------------------------------
  // Construction
  // OpenRA 对照: EditorResourceLayer(Actor self, EditorResourceLayerInfo info)
  // -----------------------------------------------------------------------

  /** Create a new EditorResourceLayer.
   *
   * OpenRA 对照: EditorResourceLayer(Actor self, EditorResourceLayerInfo info)
   *
   * @param info — the trait configuration
   */
  constructor(info: EditorResourceLayerInfo) {
    this.info = info
  }

  // -----------------------------------------------------------------------
  // IWorldLoaded
  // OpenRA 对照: EditorResourceLayer.WorldLoaded(World w, WorldRenderer wr)
  // -----------------------------------------------------------------------

  /** Initialize resource values from the world's player resources config.
   *
   * OpenRA 对照: EditorResourceLayer.WorldLoaded(World w, WorldRenderer wr)
   *
   * In OpenRA, reads playerResourcesInfo.ResourceValues to populate
   * resourceValues for netWorth calculation. In TypeScript editor mode,
   * this is simplified — resource values are configured directly.
   *
   * @param _w — the world (unused)
   * @param _wr — the world renderer (unused)
   */
  worldLoaded(_w: WorldStub, _wr: WorldRendererStub): void {
    // NOTE: OpenRA reads w.Map.Rules.Actors[SystemActors.Player]
    //   .TraitInfoOrDefault<PlayerResourcesInfo>().ResourceValues
    // In TypeScript, resource values are configured separately via
    // setResourceValues() before worldLoaded or loaded from JSON config.
  }

  // -----------------------------------------------------------------------
  // Resource values configuration
  // -----------------------------------------------------------------------

  /** Set the resource unit values for netWorth calculation.
   *
   * OpenRA 对照: resourceValues = playerResourcesInfo.ResourceValues
   *
   * After setting resource values, netWorth is recalculated from current cell data.
   *
   * @param values — map of resource type name to value per unit
   */
  setResourceValues(values: Map<string, number>): void {
    this._resourceValues = new Map(values)
    this._recalculateNetWorth()
  }

  /** Get a copy of the current resource values.
   *
   * @returns a new Map of resource type name to value per unit
   */
  getResourceValues(): Map<string, number> {
    return new Map(this._resourceValues)
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — isEmpty
  // OpenRA 对照: IResourceLayer.IsEmpty
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
   * OpenRA 对照: EditorResourceLayer.GetResource(CPos) (explicit IResourceLayer)
   *
   * @param cell — the map cell to query
   * @returns the resource contents (type and density), EMPTY if none
   */
  getResource(cell: CPos): ResourceLayerContents {
    const key = cellKey(cell)
    const data = this._cells.get(key)
    if (!data || !data.type || data.density === 0) return ResourceLayerContentsEmpty
    return { type: data.type, density: data.density }
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — GetMaxDensity
  // OpenRA 对照: IResourceLayer.GetMaxDensity(string)
  // -----------------------------------------------------------------------

  /** Get the maximum density for a resource type.
   *
   * OpenRA 对照: EditorResourceLayer.GetMaxDensity(string) (explicit IResourceLayer)
   *
   * @param resourceType — the resource type name
   * @returns the maximum density value, or 0 if unknown
   */
  getMaxDensity(resourceType: string): number {
    const resInfo = this.info.resourceTypes.get(resourceType)
    return resInfo?.maxDensity ?? 0
  }

  // -----------------------------------------------------------------------
  // getDensity — normalized 0-100% for display
  // -----------------------------------------------------------------------

  /** Get the normalized density percentage (0-100%) for a resource at a cell.
   *
   * OpenRA 对照: implicit density visualization
   *
   * Calculated as (cell.density / maxDensity) × 100.
   * Returns 0 if the cell is empty or the resource type has 0 max density.
   *
   * @param cell — the map cell to query
   * @returns density as percentage (0-100), rounded to integer
   */
  getDensity(cell: CPos): number {
    const key = cellKey(cell)
    const data = this._cells.get(key)
    if (!data || !data.type || data.density <= 0) return 0

    const maxDensity = this.getMaxDensity(data.type)
    if (maxDensity <= 0) return 0

    return Math.round((data.density / maxDensity) * 100)
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — IsVisible
  // OpenRA 对照: IResourceLayer.IsVisible(CPos) → Map.Contains(cell)
  // -----------------------------------------------------------------------

  /** Check whether resources at a cell are visible.
   *
   * OpenRA 对照: EditorResourceLayer.IsVisible(CPos)
   *
   * In editor mode, resources are always visible (no shroud/fog).
   *
   * @param _cell — the map cell (unused in editor)
   * @returns always true in editor mode
   */
  isVisible(_cell: CPos): boolean {
    // NOTE: OpenRA checks Map.Contains(cell) in EditorResourceLayer
    // In TypeScript, editor mode always reveals all resources.
    return true
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — onCellChanged
  // OpenRA 对照: EditorResourceLayer.CellChanged event
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
  // IResourceLayer — CanAddResource
  // OpenRA 对照: EditorResourceLayer.CanAddResource(string, CPos, byte)
  // -----------------------------------------------------------------------

  /** Check whether a resource can be added to a cell.
   *
   * OpenRA 对照: EditorResourceLayer.CanAddResource(string, CPos, int)
   *
   * In editor mode, the user can replace one resource type with another,
   * so mismatching resource type is treated as an empty cell.
   *
   * A resource can be added if:
   * - The resource type is known
   * - The cell's existing resource type matches OR the cell is empty/mismatched
   * - The resulting density (old or 0 + amount) <= MaxDensity
   *
   * @param resourceType — the resource type to add
   * @param cell — the target map cell
   * @param amount — the amount to add (default 1)
   * @returns true if the resource can be added
   */
  canAddResource(resourceType: string, cell: CPos, amount: number = 1): boolean {
    if (!resourceType) return false

    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) return false

    const key = cellKey(cell)
    const data = this._cells.get(key)
    const oldDensity = data && data.type === resourceType ? data.density : 0

    return oldDensity + amount <= resInfo.maxDensity
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — AddResource
  // OpenRA 对照: EditorResourceLayer.AddResource(string, CPos, int)
  // -----------------------------------------------------------------------

  /** Add resources to a cell, respecting MaxDensity.
   *
   * OpenRA 对照: EditorResourceLayer.AddResource(string, CPos, int)
   *
   * In editor mode, the user can replace one resource type with another.
   * If the cell has a different resource type, the old type is replaced.
   * If the cell is empty, a new resource is created.
   *
   * @param resourceType — the resource type to add
   * @param cell — the target map cell
   * @param amount — the amount to add (default 1)
   * @returns the amount actually added
   */
  addResource(resourceType: string, cell: CPos, amount: number = 1): number {
    // Guard: zero or negative amount on an empty cell must not create a
    // zombie {type, density:0} entry that inflates _resCells.
    if (amount <= 0) return 0

    if (!resourceType) return 0

    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) return 0

    const key = cellKey(cell)
    const existing = this._cells.get(key)

    // Editor allows replacing one resource type with another
    const oldDensity = existing && existing.type === resourceType ? existing.density : 0
    const density = Math.min(resInfo.maxDensity, oldDensity + amount)

    const wasEmpty = !existing || !existing.type || existing.density === 0

    // Update netWorth: subtract old value, add new value.
    // For type replacement (ore→gems): old type value is subtracted above,
    // new type value is added below.
    if (existing && existing.type && existing.density > 0) {
      this._updateNetWorthDelta(existing.type, -existing.density)
    }
    this._updateNetWorthDelta(resourceType, density)

    this._cells.set(key, { type: resourceType, density })

    if (wasEmpty) {
      ++this._resCells
    }

    this.onCellChanged(cell, resourceType)

    return density - oldDensity
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — RemoveResource
  // OpenRA 对照: EditorResourceLayer.RemoveResource(string, CPos, int)
  // -----------------------------------------------------------------------

  /** Remove resources from a cell.
   *
   * OpenRA 对照: EditorResourceLayer.RemoveResource(string, CPos, int)
   *
   * Reduces density by the given amount. If density reaches 0, the
   * cell is cleared. Fires CellChanged on success.
   *
   * @param resourceType — the resource type to remove
   * @param cell — the target map cell
   * @param amount — the amount to remove (default 1)
   * @returns the amount actually removed
   */
  removeResource(resourceType: string, cell: CPos, amount: number = 1): number {
    if (!resourceType) return 0

    const resInfo = this.info.resourceTypes.get(resourceType)
    if (!resInfo) return 0

    const key = cellKey(cell)
    const existing = this._cells.get(key)

    // No resource, or different resource type — nothing to remove
    if (!existing || !existing.type || existing.type !== resourceType) return 0

    const oldDensity = existing.density
    const density = Math.max(0, oldDensity - amount)

    // Update netWorth: use actual removed amount (oldDensity - density),
    // not the requested amount. If removing 10 from cell with density 3,
    // only 3 units should be subtracted from netWorth.
    this._updateNetWorthDelta(resourceType, -(oldDensity - density))

    if (density === 0) {
      this._cells.delete(key)
      --this._resCells
      this.onCellChanged(cell, null)
    } else {
      this._cells.set(key, { type: resourceType, density })
      this.onCellChanged(cell, resourceType)
    }

    return oldDensity - density
  }

  // -----------------------------------------------------------------------
  // IResourceLayer — ClearResources (per cell)
  // OpenRA 对照: EditorResourceLayer.ClearResources(CPos)
  // -----------------------------------------------------------------------

  /** Clear all resources from a specific cell.
   *
   * OpenRA 对照: EditorResourceLayer.ClearResources(CPos)
   *
   * Does nothing if the cell has no resources.
   *
   * @param cell — the cell to clear
   */
  clearResources(cell: CPos): void {
    const key = cellKey(cell)
    const existing = this._cells.get(key)

    if (!existing || !existing.type || existing.density <= 0) return

    this._updateNetWorthDelta(existing.type, -existing.density)
    this._cells.delete(key)
    --this._resCells

    this.onCellChanged(cell, null)
  }

  // -----------------------------------------------------------------------
  // clearAllResources — remove ALL resources from the entire map
  // OpenRA 对照: (editor bulk clear — no direct C# equivalent, built from
  //   iterating ClearResources over all cells)
  // -----------------------------------------------------------------------

  /** Remove all resources from the entire map.
   *
   * Clears the internal cell storage, resets netWorth to 0, and fires
   * CellChanged for each previously-occupied cell.
   */
  clearAllResources(): void {
    if (this._cells.size === 0) return

    const clearedCells: Array<{ cell: CPos }> = []
    for (const [key] of this._cells) {
      const [x, y] = key.split(',').map(Number)
      clearedCells.push({ cell: new CPos(x, y) })
    }

    this._cells.clear()
    this._netWorth = 0
    this._resCells = 0

    for (const { cell } of clearedCells) {
      this.onCellChanged(cell, null)
    }
  }

  // -----------------------------------------------------------------------
  // clone — deep copy for undo/redo snapshots
  // OpenRA 对照: EditorActionManager uses action snapshots for undo/redo
  //   (no direct Clone() in C# — constructed from resource state snapshots)
  // -----------------------------------------------------------------------

  /** Create a deep copy of the editor resource layer for undo/redo snapshots.
   *
   * The cloned instance shares the same info reference (read-only) but has
   * independent copies of all mutable state: cells, netWorth, resCells.
   * Callbacks are NOT copied — the clone is a data snapshot only.
   *
   * @returns an independent deep copy of this editor resource layer
   */
  clone(): EditorResourceLayer {
    const clone = new EditorResourceLayer(this.info)
    clone._cells = new Map<string, ResourceCellData>()
    for (const [key, data] of this._cells) {
      clone._cells.set(key, { type: data.type, density: data.density })
    }
    clone._netWorth = this._netWorth
    clone._resCells = this._resCells
    clone._resourceValues = new Map(this._resourceValues)
    // NOTE: callbacks are intentionally NOT copied — clone is a data snapshot
    return clone
  }

  // -----------------------------------------------------------------------
  // applySnapshot — restore state from a clone
  // -----------------------------------------------------------------------

  /** Restore the editor resource layer state from a snapshot (clone).
   *
   * Used by EditorActionManager for undo/redo. Replaces all internal state
   * with the snapshot's data. Fires CellChanged for cells that differ.
   *
   * @param snapshot — a cloned EditorResourceLayer containing the target state
   */
  applySnapshot(snapshot: EditorResourceLayer): void {
    // Save old cell data BEFORE overwriting so the diff can compare
    // old vs new correctly. BLOCKER: must copy before this._cells is replaced.
    const oldCells = new Map<string, ResourceCellData>()
    for (const [key, data] of this._cells) {
      oldCells.set(key, { type: data.type, density: data.density })
    }
    const oldKeys = new Set(oldCells.keys())
    const newKeys = new Set(snapshot._cells.keys())

    // Apply new state
    this._cells = new Map<string, ResourceCellData>()
    for (const [key, data] of snapshot._cells) {
      this._cells.set(key, { type: data.type, density: data.density })
    }
    this._netWorth = snapshot._netWorth
    this._resCells = snapshot._resCells

    // Fire CellChanged for differences — diff oldCells vs snapshot data
    const allKeys = new Set([...oldKeys, ...newKeys])
    for (const key of allKeys) {
      const oldData = oldCells.get(key) // use saved oldCells, not overwritten this._cells
      const newData = snapshot._cells.get(key)

      const oldType = oldData?.type || null
      const newType = newData?.type || null

      if (oldType !== newType || oldData?.density !== newData?.density) {
        const [x, y] = key.split(',').map(Number)
        this.onCellChanged(new CPos(x, y), newType)
      }
    }
  }

  // -----------------------------------------------------------------------
  // getResourceTypeNames — list of available resource type names
  // -----------------------------------------------------------------------

  /** Get the list of available resource type names from the config.
   *
   * OpenRA 对照: EditorResourceLayerInfo.ResourceTypes.Keys
   *
   * @returns array of resource type name strings
   */
  getResourceTypeNames(): string[] {
    return this.resourceTypes
  }

  // -----------------------------------------------------------------------
  // getUsedResourceTypes — list of resource types currently on the map
  // -----------------------------------------------------------------------

  /** Get the list of resource types that are currently placed on the map.
   *
   * @returns array of unique resource type strings in use
   */
  getUsedResourceTypes(): string[] {
    const types = new Set<string>()
    for (const [, data] of this._cells) {
      if (data.type) {
        types.add(data.type)
      }
    }
    return Array.from(types)
  }

  // -----------------------------------------------------------------------
  // getCellCount — total number of resource cells
  // -----------------------------------------------------------------------

  /** Get the total number of cells that have resources.
   *
   * OpenRA 对照: resCells (private field)
   *
   * @returns count of non-empty resource cells
   */
  getCellCount(): number {
    return this._resCells
  }

  // -----------------------------------------------------------------------
  // getCell — get raw cell data (including for internal cell iteration)
  // -----------------------------------------------------------------------

  /** Get the raw cell data, or undefined if the cell is empty.
   *
   * @param cell — the map cell to query
   * @returns the cell data, or undefined if empty
   */
  getCell(cell: CPos): ResourceCellData | undefined {
    const key = cellKey(cell)
    return this._cells.get(key)
  }

  // -----------------------------------------------------------------------
  // getAllCells — iterate over all non-empty resource cells
  // -----------------------------------------------------------------------

  /** Get all non-empty resource cells as [CPos, ResourceCellData] pairs.
   *
   * Useful for serialization, bulk operations, and testing.
   *
   * @returns iterator of [cell, data] pairs
   */
  getAllCells(): Array<[CPos, ResourceCellData]> {
    const result: Array<[CPos, ResourceCellData]> = []
    for (const [key, data] of this._cells) {
      const [x, y] = key.split(',').map(Number)
      result.push([new CPos(x, y), data])
    }
    return result
  }

  // -----------------------------------------------------------------------
  // isValidResourceType — validate a resource type name
  // -----------------------------------------------------------------------

  /** Check whether a resource type name is valid (defined in the config).
   *
   * OpenRA 对照: info.ResourceTypes.TryGetValue(resourceType, out _)
   *
   * @param resourceType — the resource type name to validate
   * @returns true if the resource type is known
   */
  isValidResourceType(resourceType: string): boolean {
    if (!resourceType) return false
    return this.info.resourceTypes.has(resourceType)
  }

  // -----------------------------------------------------------------------
  // isCellEmpty — check if a cell has no resources
  // -----------------------------------------------------------------------

  /** Check whether a cell has no resources.
   *
   * @param cell — the map cell to check
   * @returns true if the cell is empty or out of bounds
   */
  isCellEmpty(cell: CPos): boolean {
    const key = cellKey(cell)
    const data = this._cells.get(key)
    return !data || !data.type || data.density <= 0
  }

  // -----------------------------------------------------------------------
  // dispose — cleanup
  // OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
  // -----------------------------------------------------------------------

  /** Dispose of the editor resource layer, clearing all state and callbacks.
   *
   * OpenRA 对照: EditorResourceLayer.Disposing(Actor self)
   */
  dispose(): void {
    if (this._disposed) return

    this._cells.clear()
    this._cellChangedCallbacks = []
    this._resourceValues.clear()
    this._netWorth = 0
    this._resCells = 0
    this._disposed = true
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Update netWorth by adding/subtracting value for a resource type.
   *
   * OpenRA 对照: UpdateNetWorth(oldType, oldDensity, newType, newDensity)
   *
   * @param resourceType — the resource type
   * @param densityDelta — change in density (positive for add, negative for remove)
   */
  private _updateNetWorthDelta(resourceType: string, densityDelta: number): void {
    const valuePerUnit = this._resourceValues.get(resourceType)
    if (valuePerUnit !== undefined && valuePerUnit > 0) {
      this._netWorth += densityDelta * valuePerUnit
    }
  }

  /** Recalculate netWorth from scratch based on all cell data.
   *
   * Used after setting new resource values.
   */
  private _recalculateNetWorth(): void {
    this._netWorth = 0
    for (const [, data] of this._cells) {
      if (data.type && data.density > 0) {
        const valuePerUnit = this._resourceValues.get(data.type)
        if (valuePerUnit !== undefined && valuePerUnit > 0) {
          this._netWorth += data.density * valuePerUnit
        }
      }
    }
  }
}
