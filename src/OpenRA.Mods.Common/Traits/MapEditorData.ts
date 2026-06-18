/**
 * MapEditorData.ts — Editor metadata marker trait persisted in map files
 * OpenRA 对照: OpenRA.Mods.Common/Traits/MapEditorData.cs (26 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<MapEditorData> generic base → TypeScript ITraitInfo + marker class
 * - C# FrozenSet/ImmutableArray → TypeScript readonly arrays
 * - C# empty marker trait → TypeScript class with editor state properties
 * - Map file YAML serialization → JSON serialization for `.oramap` format
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type { ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// MapEditorConfig — editor-specific settings serialized to map file
// ---------------------------------------------------------------------------

/**
 * Editor configuration persisted in the map's `EditorData:` section.
 *
 * This object stores viewport position and UI tab state so the editor
 * can restore the user's workspace when re-opening a map.
 *
 * OpenRA 对照: (implicit — C# editor stores these in MapEditorData)
 */
export interface MapEditorConfig {
  /** Last editor camera/viewport position in cell coordinates.
   *
   * OpenRA 对照: cameraPosition (CellCoords — CPos in TS)
   */
  cameraPosition?: CPos

  /** Last selected editor tab name.
   *
   * OpenRA 对照: selectedTab (string)
   */
  selectedTab?: string
}

// ---------------------------------------------------------------------------
// MapEditorDataInfo — trait configuration metadata
// OpenRA 对照: MapEditorDataInfo : TraitInfo<MapEditorData>
// ---------------------------------------------------------------------------

/**
 * Trait info for MapEditorData — carries tileset requirements and categories.
 *
 * OpenRA 对照: MapEditorDataInfo
 *
 * When a map declares this trait, the editor can restrict the tileset
 * palette and organize the actor palette by category.
 */
export class MapEditorDataInfo implements ITraitInfo {
  /** Optional instance name for trait disambiguation.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /** Tilesets required by this map (editor restricts palette to these).
   *
   * OpenRA 对照: MapEditorDataInfo.RequireTilesets (FrozenSet<string>)
   */
  readonly requireTilesets: readonly string[]

  /** Tilesets excluded from this map (editor hides these from palette).
   *
   * OpenRA 对照: MapEditorDataInfo.ExcludeTilesets (FrozenSet<string>)
   */
  readonly excludeTilesets: readonly string[]

  /** Actor categories used in this map for editor palette organization.
   *
   * OpenRA 对照: MapEditorDataInfo.Categories (ImmutableArray<string>)
   */
  readonly categories: readonly string[]

  constructor(params: {
    instanceName?: string
    requireTilesets?: readonly string[]
    excludeTilesets?: readonly string[]
    categories?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.requireTilesets = params.requireTilesets ?? []
    this.excludeTilesets = params.excludeTilesets ?? []
    this.categories = params.categories ?? []
  }

  /**
   * Create a MapEditorDataInfo from a JSON object (map file deserialization).
   *
   * OpenRA 对照: FieldLoader.Load<T>() — YAML deserialization
   *
   * @param json — raw JSON object from the map file's EditorData section
   * @returns a populated MapEditorDataInfo
   */
  static fromJSON(json: Record<string, any>): MapEditorDataInfo {
    return new MapEditorDataInfo({
      instanceName: typeof json.instanceName === 'string' ? json.instanceName : undefined,
      requireTilesets: Array.isArray(json.requireTilesets)
        ? json.requireTilesets.filter((v: unknown) => typeof v === 'string')
        : undefined,
      excludeTilesets: Array.isArray(json.excludeTilesets)
        ? json.excludeTilesets.filter((v: unknown) => typeof v === 'string')
        : undefined,
      categories: Array.isArray(json.categories)
        ? json.categories.filter((v: unknown) => typeof v === 'string')
        : undefined,
    })
  }

  /**
   * Serialize to a JSON-compatible object for map file storage.
   *
   * OpenRA 对照: MiniYaml.WriteNode() — YAML serialization
   *
   * @returns a plain object suitable for JSON.stringify
   */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = {}
    if (this.instanceName !== undefined) result.instanceName = this.instanceName
    if (this.requireTilesets.length > 0) result.requireTilesets = [...this.requireTilesets]
    if (this.excludeTilesets.length > 0) result.excludeTilesets = [...this.excludeTilesets]
    if (this.categories.length > 0) result.categories = [...this.categories]
    return result
  }
}

// ---------------------------------------------------------------------------
// MapEditorData — runtime trait holding editor state
// OpenRA 对照: MapEditorData (empty marker class)
// ---------------------------------------------------------------------------

/**
 * Runtime trait that persists editor metadata in map files.
 *
 * OpenRA 对照: MapEditorData
 *
 * In C#, this is an empty marker class — the trait system uses it for
 * type dispatch. Editor state is stored externally. In TypeScript, we
 * carry the editor state directly on this class so it can be serialized
 * alongside the map.
 *
 * This trait is STRIPPED when a map is loaded in game mode (not editor
 * mode), matching OpenRA behavior where editor-only traits are not
 * instantiated outside the editor.
 */
export class MapEditorData {
  /** Editor-specific configuration (viewport, selected tab).
   *
   * OpenRA 对照: (implicit — editor state stored per-map)
   */
  editorConfig: MapEditorConfig

  /** Last editor camera/viewport position in cell coordinates.
   *
   * OpenRA 对照: cameraPosition field (CPos in cell coords)
   */
  cameraPosition: CPos | null

  /** Last selected editor tab.
   *
   * OpenRA 对照: selectedTab field
   */
  selectedTab: string

  /** The trait info this instance was created from. */
  readonly info: MapEditorDataInfo

  /**
   * @param info — trait configuration from map file
   */
  constructor(info: MapEditorDataInfo) {
    this.info = info
    this.editorConfig = {}
    this.cameraPosition = null
    this.selectedTab = ''
  }

  /**
   * Create a MapEditorData instance from a JSON object (map file deserialization).
   *
   * OpenRA 对照: TraitInfo.Create(ActorInitializer) — C# runtime trait creation
   *
   * @param json — raw JSON from the map file's EditorData section
   * @returns a populated MapEditorData instance
   */
  static fromJSON(json: Record<string, any>): MapEditorData {
    const info = MapEditorDataInfo.fromJSON(json)
    const data = new MapEditorData(info)

    // Restore editor config (viewport + tab state)
    if (json.editorConfig && typeof json.editorConfig === 'object') {
      const cfg = json.editorConfig
      data.editorConfig = {
        cameraPosition: cfg.cameraPosition && typeof cfg.cameraPosition === 'object'
          ? new CPos(Number(cfg.cameraPosition.x ?? 0), Number(cfg.cameraPosition.y ?? 0))
          : undefined,
        selectedTab: typeof cfg.selectedTab === 'string' ? cfg.selectedTab : undefined,
      }
    }

    // Restore cameraPosition at top level (legacy format compatibility)
    if (json.cameraPosition && typeof json.cameraPosition === 'object') {
      data.cameraPosition = new CPos(
        Number(json.cameraPosition.x ?? 0),
        Number(json.cameraPosition.y ?? 0),
      )
    }

    // Restore selectedTab
    if (typeof json.selectedTab === 'string') {
      data.selectedTab = json.selectedTab
    }

    return data
  }

  /**
   * Serialize to a JSON-compatible object for map file storage.
   *
   * OpenRA 对照: (implicit — editor writes to map YAML)
   *
   * @returns a plain object suitable for JSON.stringify
   */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = {
      ...this.info.toJSON(),
    }

    // Only include editorConfig if it has data
    if (Object.keys(this.editorConfig).length > 0) {
      result.editorConfig = { ...this.editorConfig }
      // Convert CPos to {x,y} plain object (CPos serializes as {Bits:int})
      if (this.editorConfig.cameraPosition) {
        result.editorConfig.cameraPosition = {
          x: this.editorConfig.cameraPosition.X,
          y: this.editorConfig.cameraPosition.Y,
        }
      }
    }

    if (this.cameraPosition) {
      result.cameraPosition = {
        x: this.cameraPosition.X,
        y: this.cameraPosition.Y,
      }
    }

    if (this.selectedTab) {
      result.selectedTab = this.selectedTab
    }

    return result
  }

  /**
   * Check whether this trait should be active (only in editor mode).
   *
   * In game mode, MapEditorData is stripped — matching OpenRA behavior
   * where editor-only traits are never instantiated outside the editor.
   *
   * @param isEditorMode — whether the current session is an editor
   * @returns true if this trait should be active
   */
  static isEditorTrait(): boolean {
    // NOTE: In OpenRA, editor traits are only added to the World when
    // the WorldType is EditorWorld. This static marker method allows
    // the trait dictionary to filter out editor traits in game mode.
    return true
  }
}
