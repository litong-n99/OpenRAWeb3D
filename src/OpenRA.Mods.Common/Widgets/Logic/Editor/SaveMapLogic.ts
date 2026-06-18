/**
 * SaveMapLogic.ts -- 编辑器保存地图对话框逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/SaveMapLogic.cs (360 lines)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage() 本地化 -> 硬编码英文字符串
 *   (TODO-21.C-DEFER-1: FluentProvider 迁移后替换)
 * - C# ConfirmationDialogs.ButtonPrompt() -> 已迁移，直接调用
 * - C# Platform.ResolvePath/Path.Combine/File.Create -> 浏览器兼容存根
 *   (TODO-21.C.9-DEFER-5: 文件系统 API 在浏览器中不可用)
 * - C# ZipFileLoader.Create / Folder(combinedPath) -> TODO-21.C.9-DEFER-4
 * - C# Map.Save(IReadWritePackage) -> Map.toJSON() JSON 序列化
 * - C# TextNotificationsManager.AddTransientLine -> console.log()
 *   (TODO-21.C-DEFER-3: 通知系统迁移后替换)
 * - C# MarkerLayerOverlay 序列化 -> TODO-21.C.9-DEFER-6
 * - C# ScrollItemWidget.Setup() 模板克隆 -> 适配到 DropDownButtonWidget DOM 元素
 * - C# Func<bool>/Action 委托 -> TypeScript 闭包
 *
 * Migration: TODO-21.C.9 -- Chapter 21 Phase C Wave 1
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  type Widget,
  type WidgetEvent,
  ChromeLogic,
  Ui,
} from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ButtonWidget } from '../../../Widgets/ButtonWidget.js'
import { TextFieldWidget } from '../../../Widgets/TextFieldWidget.js'
import { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
import { CheckboxWidget } from '../../../Widgets/CheckboxWidget.js'
import { ConfirmationDialogs } from '../../../Widgets/ConfirmationDialogs.js'
import { MapVisibility } from '../../../../OpenRA.Game/Map/Map.js'
import type { Map as GameMap } from '../../../../OpenRA.Game/Map/Map.js'
import type { ModData } from '../../../../OpenRA.Game/ModData.js'
import type { IReadOnlyPackage } from '../../../../OpenRA.Game/FileSystem/IPackage.js'
import { Folder } from '../../../../OpenRA.Game/FileSystem/Folder.js'
import { MapClassification, MapStatus } from '../../../../OpenRA.Game/Map/MapPreview.js'
import type { MapCache } from '../../../../OpenRA.Game/Map/MapCache.js'
import type { EditorActionManager } from '../../../Traits/World/EditorActionManager.js'

// ---------------------------------------------------------------------------
// Stub: MiniYamlNode (OpenRA 对照: MiniYamlNode)
//
// NOTE: MiniYaml serialization not yet fully migrated (TODO-4.H).
// This stub provides a minimal interface for passing actor/player
// definitions through the save pipeline.
// ---------------------------------------------------------------------------

/**
 * Minimal MiniYaml node stub for map save definitions.
 *
 * OpenRA 对照: OpenRA.MiniYamlNode
 */
export interface MiniYamlNode {
  key: string
  value: string | null
  nodes?: MiniYamlNode[]
}

// ---------------------------------------------------------------------------
// Localized strings (OpenRA 对照: FluentProvider static strings)
// TODO-21.C-DEFER-1: FluentProvider 迁移后替换为本地化字符串
// ---------------------------------------------------------------------------

const SAVE_MAP_FAILED_TITLE = 'Save Map Failed'
const SAVE_MAP_FAILED_PROMPT = 'The map could not be saved.'
const SAVE_MAP_FAILED_CONFIRM = 'OK'
const UNPACKED_LABEL = 'Unpacked Map'
const OVERWRITE_MAP_FAILED_TITLE = 'Overwrite Map'
const OVERWRITE_MAP_FAILED_PROMPT = 'A map with this name already exists. Overwrite?'
const OVERWRITE_MAP_FAILED_CONFIRM = 'Overwrite'
const OVERWRITE_MAP_OUTSIDE_EDIT_TITLE = 'Map Modified Externally'
const OVERWRITE_MAP_OUTSIDE_EDIT_PROMPT =
  'This map has been modified outside the editor. Save anyway?'
const SAVE_MAP_OUTSIDE_CONFIRM = 'Save'
const SAVE_CURRENT_MAP = 'Map saved.'

// ---------------------------------------------------------------------------
// MapFileType enum (对应 OpenRA enum MapFileType)
// ---------------------------------------------------------------------------

/**
 * Map file type for save format selection.
 *
 * OpenRA 对照: enum MapFileType { Unpacked, OraMap }
 */
export const MapFileType = {
  /** Unpacked folder. */
  Unpacked: 0,
  /** .oramap ZIP archive. */
  OraMap: 1,
} as const

export type MapFileType = (typeof MapFileType)[keyof typeof MapFileType]

// ---------------------------------------------------------------------------
// MapFileTypeInfo (对应 OpenRA struct MapFileTypeInfo)
// ---------------------------------------------------------------------------

/**
 * Info record for a map file type option.
 *
 * OpenRA 对照: struct MapFileTypeInfo { string Extension; string UiLabel; }
 */
export interface MapFileTypeInfo {
  /** File extension (e.g., ".oramap", "" for unpacked). */
  extension: string
  /** UI label displayed in the dropdown. */
  uiLabel: string
}

// ---------------------------------------------------------------------------
// SaveDirectory (对应 OpenRA sealed record SaveDirectory)
// ---------------------------------------------------------------------------

/**
 * Directory option for the save location dropdown.
 *
 * OpenRA 对照: sealed record SaveDirectory(Folder Folder, string DisplayName,
 *   MapClassification Classification)
 */
export interface SaveDirectory {
  /** The folder package. */
  folder: IReadOnlyPackage
  /** Display name shown in the dropdown. */
  displayName: string
  /** Classification (System/User) for priority ordering. */
  classification: MapClassification
}

// ---------------------------------------------------------------------------
// SaveMapLogic -- 保存地图对话框
// OpenRA 对照: public class SaveMapLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * Save map dialog logic -- validates inputs, selects directory and file type,
 * detects overwrite conflicts, and executes the save operation.
 *
 * OpenRA 对照: SaveMapLogic : ChromeLogic
 *
 * Widget tree children (within TRANSIENTS_PANEL):
 * - TITLE: TextFieldWidget -- map title
 * - AUTHOR: TextFieldWidget -- map author
 * - VISIBILITY_DROPDOWN: DropDownButtonWidget -- visibility checkboxes
 * - DIRECTORY_DROPDOWN: DropDownButtonWidget -- writable directories
 * - FILENAME: TextFieldWidget -- output filename
 * - TYPE_DROPDOWN: DropDownButtonWidget -- .oramap vs unpacked
 * - BACK_BUTTON: ButtonWidget -- cancel / go back
 * - SAVE_BUTTON: ButtonWidget -- execute save
 */
export class SaveMapLogic extends ChromeLogic {
  // -------------------------------------------------------------------------
  // Static string constants (对应 OpenRA [FluentReference] const strings)
  // -------------------------------------------------------------------------

  static readonly SAVE_MAP_FAILED_TITLE = SAVE_MAP_FAILED_TITLE
  static readonly SAVE_MAP_FAILED_PROMPT = SAVE_MAP_FAILED_PROMPT
  static readonly SAVE_MAP_FAILED_CONFIRM = SAVE_MAP_FAILED_CONFIRM
  static readonly UNPACKED_LABEL = UNPACKED_LABEL
  static readonly OVERWRITE_MAP_FAILED_TITLE = OVERWRITE_MAP_FAILED_TITLE
  static readonly OVERWRITE_MAP_FAILED_PROMPT = OVERWRITE_MAP_FAILED_PROMPT
  static readonly OVERWRITE_MAP_FAILED_CONFIRM = OVERWRITE_MAP_FAILED_CONFIRM
  static readonly OVERWRITE_MAP_OUTSIDE_EDIT_TITLE = OVERWRITE_MAP_OUTSIDE_EDIT_TITLE
  static readonly OVERWRITE_MAP_OUTSIDE_EDIT_PROMPT = OVERWRITE_MAP_OUTSIDE_EDIT_PROMPT
  static readonly SAVE_MAP_OUTSIDE_CONFIRM = SAVE_MAP_OUTSIDE_CONFIRM
  static readonly SAVE_CURRENT_MAP = SAVE_CURRENT_MAP

  // -------------------------------------------------------------------------
  // Instance state
  // -------------------------------------------------------------------------

  private readonly _modData: ModData
  private readonly _map: GameMap
  private readonly _onSave: (uid: string) => void
  private readonly _onExit: () => void
  private readonly _actionManager: EditorActionManager | undefined

  // Map identity
  private readonly _mapUid: string

  // Map editor data for saving (OpenRA 对照: actorDefinitions / playerDefinitions)
  private readonly _actorDefinitions: readonly MiniYamlNode[] | null
  private readonly _playerDefinitions: readonly MiniYamlNode[] | null

  /** Actor definitions for map save (OpenRA 对照: map.ActorDefinitions). */
  get actorDefinitions(): readonly MiniYamlNode[] | null {
    return this._actorDefinitions
  }

  /** Player definitions for map save (OpenRA 对照: map.PlayerDefinitions). */
  get playerDefinitions(): readonly MiniYamlNode[] | null {
    return this._playerDefinitions
  }

  // Writable directory state
  private _writableDirectories: SaveDirectory[] = []
  private _selectedDirectory: SaveDirectory | null = null

  // File type state
  private _fileType: MapFileType = MapFileType.OraMap
  private _fileTypes: Map<MapFileType, MapFileTypeInfo> = new Map()

  // Widget references
  private readonly _titleField: TextFieldWidget
  private readonly _authorField: TextFieldWidget
  private readonly _filenameField: TextFieldWidget
  private readonly _saveButton: ButtonWidget

  // Map package info (OpenRA 对照: map.Package?.Name)
  private readonly _mapPackageName: string | null

  // Whether the map is in unpacked format (folder, not ZIP)
  private readonly _mapIsUnpacked: boolean

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA SaveMapLogic 构造函数, line 68-228)
  // -------------------------------------------------------------------------

  /**
   * Create the save map dialog, wiring all widgets and setting up callbacks.
   *
   * OpenRA 对照: SaveMapLogic(Widget widget, ModData modData, Map map,
   *   Action<string> onSave, Action onExit, World world,
   *   IReadOnlyCollection<MiniYamlNode> playerDefinitions,
   *   IReadOnlyCollection<MiniYamlNode> actorDefinitions)
   *
   * @param widget -- the root widget of the save dialog panel
   * @param modData -- the mod's runtime data
   * @param map -- the map being saved
   * @param onSave -- callback invoked on successful save with the map UID
   * @param onExit -- callback invoked when dialog is closed
   * @param actionManager -- EditorActionManager for tracking save state (optional)
   * @param mapUid -- the map's unique identifier (optional, computed from package if absent)
   * @param mapPackageName -- the map's package path/name (optional, default null)
   * @param mapIsUnpacked -- whether the map was loaded from an unpacked folder (default false)
   * @param actorDefinitions -- MiniYAML actor definitions for map save (optional)
   * @param playerDefinitions -- MiniYAML player definitions for map save (optional)
   */
  constructor(
    widget: Widget,
    modData: ModData,
    map: GameMap,
    onSave: (uid: string) => void,
    onExit: () => void,
    actionManager?: EditorActionManager,
    mapUid?: string,
    mapPackageName?: string | null,
    mapIsUnpacked?: boolean,
    actorDefinitions?: readonly MiniYamlNode[] | null,
    playerDefinitions?: readonly MiniYamlNode[] | null,
  ) {
    super()

    this._modData = modData
    this._map = map
    this._onSave = onSave
    this._onExit = onExit
    this._actionManager = actionManager ?? undefined
    this._mapUid = mapUid ?? `map:${mapPackageName ?? 'unnamed'}`
    this._mapPackageName = mapPackageName ?? null
    this._mapIsUnpacked = mapIsUnpacked ?? false
    this._actorDefinitions = actorDefinitions ?? null
    this._playerDefinitions = playerDefinitions ?? null

    // -----------------------------------------------------------------------
    // Title field (OpenRA 对照: line 71-72)
    // -----------------------------------------------------------------------

    this._titleField = widget.get<TextFieldWidget>('TITLE')
    this._titleField.text = map.title

    // -----------------------------------------------------------------------
    // Author field (OpenRA 对照: line 74-75)
    // -----------------------------------------------------------------------

    this._authorField = widget.get<TextFieldWidget>('AUTHOR')
    this._authorField.text = map.author

    // -----------------------------------------------------------------------
    // Visibility dropdown (OpenRA 对照: line 77-99)
    // -----------------------------------------------------------------------

    const visibilityDropdown = widget.get<DropDownButtonWidget>(
      'VISIBILITY_DROPDOWN',
    )

    // Load visibility panel template
    const visibilityPanel = Ui.loadWidget<Widget>(
      'MAP_SAVE_VISIBILITY_PANEL',
      null,
      {},
    )
    const visOptionTemplate = visibilityPanel.get<CheckboxWidget>(
      'VISIBILITY_TEMPLATE',
    )
    visibilityPanel.removeChildren()

    // Build visibility checkboxes for each MapVisibility value
    const visibilityValues: MapVisibility[] = [
      MapVisibility.Lobby,
      MapVisibility.Shellmap,
      MapVisibility.MissionSelector,
    ]

    for (const visibilityOption of visibilityValues) {
      // Only show Shellmap option when already set (prevents users
      // from breaking the game by accidentally enabling shellmap)
      if (
        visibilityOption === MapVisibility.Shellmap &&
        !(map.visibility & visibilityOption)
      ) {
        continue
      }

      const checkbox = visOptionTemplate.clone()
      checkbox.getText = () => visibilityOption.toString()
      checkbox.isChecked = () => (map.visibility & visibilityOption) !== 0
      checkbox.onClick = () => {
        map.visibility ^= visibilityOption
      }
      visibilityPanel.addChild(checkbox)
    }

    visibilityDropdown.onMouseDown = (_event: WidgetEvent) => {
      visibilityDropdown.removePanel()
      visibilityDropdown.attachPanel(visibilityPanel)
    }

    // -----------------------------------------------------------------------
    // Directory dropdown (OpenRA 对照: line 101-147)
    // -----------------------------------------------------------------------

    const directoryDropdown = widget.get<DropDownButtonWidget>(
      'DIRECTORY_DROPDOWN',
    )

    this._writableDirectories = []
    this._selectedDirectory = null

    // Build list of writable directories from MapCache.MapLocations
    const mapCache = modData.mapCache as MapCache | undefined
    if (mapCache?.mapLocations) {
      for (const [pkg, classification] of mapCache.mapLocations) {
        // Only consider Folder packages (not ZIP). In C#, ZIP packages
        // are writable too if they have the IReadWritePackage interface,
        // but in browser context folders are simpler.
        if (!(pkg instanceof Folder)) continue

        // NOTE: C# tests writability via File.Create(".testwritable", 1,
        // FileOptions.DeleteOnClose). Browser has no filesystem API --
        // assume all folders from MapCache are writable.
        // TODO-21.C.9-DEFER-5: Browser writability check
        this._writableDirectories.push({
          folder: pkg,
          displayName: classification.toString(),
          classification,
        })
      }
    }

    // If map has a known package, prioritize that directory
    if (this._mapPackageName) {
      const pkgName = this._mapPackageName
      this._selectedDirectory =
        this._writableDirectories.find((d) =>
          (d.folder as Folder).contains(pkgName),
        ) ?? null

      if (!this._selectedDirectory) {
        this._selectedDirectory =
          this._writableDirectories.find((d) => {
            const folderName = (d.folder as Folder).name
            return folderName.includes(pkgName)
          }) ?? null
      }
    }

    // Fall back to User classification directories (higher value = higher priority)
    if (!this._selectedDirectory && this._writableDirectories.length > 0) {
      this._selectedDirectory = [...this._writableDirectories].sort(
        (a, b) => b.classification - a.classification,
      )[0] ?? null
    }

    directoryDropdown.getText = () =>
      this._selectedDirectory?.displayName ?? ''

    directoryDropdown.onClick = () => {
      directoryDropdown.showDropDown(
        'LABEL_DROPDOWN_TEMPLATE',
        210,
        this._writableDirectories,
        (option: SaveDirectory): HTMLElement => {
          const itemEl = document.createElement('div')
          itemEl.textContent = option.displayName
          itemEl.style.cssText =
            'padding:4px 8px;cursor:pointer;color:#e0e0e0;font-size:13px;'

          // Highlight if currently selected
          if (this._selectedDirectory === option) {
            itemEl.style.backgroundColor = '#2a5a8c'
          }

          itemEl.addEventListener('click', () => {
            this._selectedDirectory = option
            directoryDropdown.removePanel()
          })

          return itemEl
        },
      )
    }

    // -----------------------------------------------------------------------
    // Filename field (OpenRA 对照: line 149-154)
    // -----------------------------------------------------------------------

    this._filenameField = widget.get<TextFieldWidget>('FILENAME')

    // Pre-populate filename from package name
    if (this._mapPackageName) {
      if (this._mapIsUnpacked) {
        // Unpacked: get the last path segment
        const segments = this._mapPackageName.replace(/\\/g, '/').split('/')
        this._filenameField.text = segments[segments.length - 1] ?? ''
      } else {
        // ZIP: strip extension
        const segments = this._mapPackageName.replace(/\\/g, '/').split('/')
        const lastSegment = segments[segments.length - 1] ?? ''
        const dotIndex = lastSegment.lastIndexOf('.')
        this._filenameField.text =
          dotIndex > 0 ? lastSegment.substring(0, dotIndex) : lastSegment
      }
    } else {
      this._filenameField.text = ''
    }

    // Auto-focus filename if empty
    if (!this._filenameField.text) {
      this._filenameField.takeKeyboardFocus()
    }

    // -----------------------------------------------------------------------
    // File type dropdown (OpenRA 对照: line 156-180)
    // -----------------------------------------------------------------------

    this._fileType = this._mapIsUnpacked
      ? MapFileType.Unpacked
      : MapFileType.OraMap

    this._fileTypes = new Map<MapFileType, MapFileTypeInfo>([
      [MapFileType.OraMap, { extension: '.oramap', uiLabel: '.oramap' }],
      [
        MapFileType.Unpacked,
        { extension: '', uiLabel: `(${UNPACKED_LABEL})` },
      ],
    ])

    const typeDropdown = widget.get<DropDownButtonWidget>('TYPE_DROPDOWN')
    const currentTypeInfo = this._fileTypes.get(this._fileType)
    let typeLabel = currentTypeInfo?.uiLabel ?? ''

    typeDropdown.getText = () => typeLabel

    typeDropdown.onClick = () => {
      const typeOptions = [...this._fileTypes.entries()]
      typeDropdown.showDropDown(
        'LABEL_DROPDOWN_TEMPLATE',
        210,
        typeOptions,
        (option: [MapFileType, MapFileTypeInfo]): HTMLElement => {
          const [, info] = option
          const itemEl = document.createElement('div')
          itemEl.textContent = info.uiLabel
          itemEl.style.cssText =
            'padding:4px 8px;cursor:pointer;color:#e0e0e0;font-size:13px;'

          // Highlight if currently selected
          if (this._fileType === option[0]) {
            itemEl.style.backgroundColor = '#2a5a8c'
          }

          itemEl.addEventListener('click', () => {
            typeLabel = info.uiLabel
            this._fileType = option[0]
            typeDropdown.removePanel()
          })

          return itemEl
        },
      )
    }

    // -----------------------------------------------------------------------
    // Back button (OpenRA 对照: line 182-183)
    // -----------------------------------------------------------------------

    const backButton = widget.get<ButtonWidget>('BACK_BUTTON')
    backButton.onClick = () => {
      Ui.closeWindow()
      this._onExit()
    }

    // -----------------------------------------------------------------------
    // Save button (OpenRA 对照: line 220-227)
    // -----------------------------------------------------------------------

    this._saveButton = widget.get<ButtonWidget>('SAVE_BUTTON')
    this._saveButton.isDisabled = () =>
      this._isInputInvalid()

    this._saveButton.onClick = () => {
      const folderName =
        (this._selectedDirectory?.folder as Folder)?.name ?? ''
      const selectedExt =
        this._fileTypes.get(this._fileType)?.extension ?? '.oramap'
      const combinedPath = this._resolvePath(
        `${folderName}/${this._filenameField.text}${selectedExt}`,
      )

      // Call the static SaveMap method for overwrite detection
      SaveMapLogic.SaveMap(
        this._modData,
        this._map,
        combinedPath,
        this._mapPackageName,
        this._actionManager,
        (path) => this._saveMap(path),
      )
    }
  }

  // -------------------------------------------------------------------------
  // Inner save map callback (OpenRA 对照: void SaveMap(string) local function, line 185-218)
  // -------------------------------------------------------------------------

  /**
   * Inner save callback -- executes the actual save after overwrite check passes.
   *
   * OpenRA 对照: void SaveMap(string combinedPath) (local function within constructor)
   */
  private _saveMap(_combinedPath: string): void {
    // Update map metadata from form fields (OpenRA 对照: line 187-188)
    this._map.title = this._titleField.text
    this._map.author = this._authorField.text

    // Apply actor and player definitions (OpenRA 对照: line 190-194)
    if (this._actorDefinitions) {
      ;(this._map as unknown as Record<string, unknown>).actorDefinitions = this._actorDefinitions
    }
    if (this._playerDefinitions) {
      ;(this._map as unknown as Record<string, unknown>).playerDefinitions = this._playerDefinitions
    }

    Ui.closeWindow()
    this._onExit()

    try {
      // NOTE: C# creates or reuses an IReadWritePackage at combinedPath.
      // In browser, we serialize via Map.toJSON() and trigger download.
      // TODO-21.C.9-DEFER-4: Implement writable package for browser

      // Set required mod ID before serialization (OpenRA 对照: map.RequiresMod = modData.Manifest.Id)
      this._map.requiresMod = this._modData.manifest.id

      // Serialize map to JSON for browser download
      const mapJson = this._map.toJSON()

      // TODO-21.C.9-DEFER-4: Write map JSON to writable package / trigger download
      console.log('[SaveMapLogic] Map serialized successfully:', mapJson)

      if (this._actionManager) {
        this._actionManager.Modified = false
      }

      // TODO-21.C-DEFER-3: TextNotificationsManager 迁移后替换
      console.log(SAVE_CURRENT_MAP)
    } catch (e) {
      SaveMapLogic.SaveMapFailed(
        e instanceof Error ? e : new Error(String(e)),
        this._modData,
        this._actionManager,
      )
      return
    }

    // Pass the map's UID to the onSave callback (OpenRA 对照: onSave(map.Uid))
    this._onSave(this._map.uid || this._mapUid)
  }

  // -------------------------------------------------------------------------
  // Validation (OpenRA 对照: save.IsDisabled, line 221)
  // -------------------------------------------------------------------------

  /**
   * Check if any required input field is empty or whitespace.
   *
   * OpenRA 对照: save.IsDisabled = () =>
   *   string.IsNullOrWhiteSpace(filename.Text) ||
   *   string.IsNullOrWhiteSpace(title.Text) ||
   *   string.IsNullOrWhiteSpace(author.Text)
   */
  private _isInputInvalid(): boolean {
    const filename = this._filenameField.text?.trim() ?? ''
    const title = this._titleField.text?.trim() ?? ''
    const author = this._authorField.text?.trim() ?? ''
    return !filename || !title || !author
  }

  // -------------------------------------------------------------------------
  // Per-frame tick (对应 OpenRA ChromeLogic.Tick())
  // -------------------------------------------------------------------------

  /** No per-frame logic needed for this dialog. */
  override tick(): void {}

  // -------------------------------------------------------------------------
  // Path resolution (对应 OpenRA Platform.ResolvePath + Path.Combine)
  // -------------------------------------------------------------------------

  /**
   * Resolve a path string, normalizing separators.
   *
   * OpenRA 对照: Platform.ResolvePath(Path.Combine(...))
   *
   * TODO-21.C.9-DEFER-5: Implement proper browser path resolution
   */
  private _resolvePath(path: string): string {
    // Normalize to forward slashes
    return path.replace(/\\/g, '/').replace(/\/+/g, '/')
  }

  // -------------------------------------------------------------------------
  // Dispose (对应 OpenRA ChromeLogic.Dispose())
  // -------------------------------------------------------------------------

  /** Clean up references. No GPU resources to dispose for this logic. */
  override dispose(): void {
    this._writableDirectories = []
    this._selectedDirectory = null
    this._fileTypes.clear()
  }

  // -------------------------------------------------------------------------
  // Static: SaveMap (对应 OpenRA SaveMapLogic.SaveMap, line 230-293)
  // -------------------------------------------------------------------------

  /**
   * Check for overwrite conflicts before initiating save.
   *
   * OpenRA 对照: public static void SaveMap(ModData, World, Map,
   *   string combinedPath, Action<string> saveMap)
   *
   * Two conflict scenarios:
   * 1. Target path differs from current package and a map already exists there
   *    -- shows overwrite confirmation dialog
   * 2. Target path matches current package but map UID changed externally
   *    (e.g., updated by another process) -- warns about stale editing
   *
   * @param modData -- the mod's runtime data
   * @param map -- the map being saved
   * @param combinedPath -- target save path
   * @param mapPackageName -- current map package name (for overwrite comparison)
   * @param actionManager -- EditorActionManager for tracking SaveFailed state
   * @param saveMap -- callback to execute the actual save
   */
  static SaveMap(
    modData: ModData,
    _map: GameMap,
    combinedPath: string,
    mapPackageName: string | null,
    actionManager: EditorActionManager | undefined,
    saveMap: (path: string) => void,
  ): void {
    if (mapPackageName !== combinedPath) {
      // When creating a new map or file paths don't match:
      // check if a map already exists at the target path
      const mapCache = modData.mapCache as MapCache | undefined
      if (mapCache) {
        let existingMap = false
        for (const preview of mapCache) {
          if (
            preview.status === MapStatus.Available &&
            preview.path === combinedPath
          ) {
            existingMap = true
            break
          }
        }

        if (existingMap) {
          ConfirmationDialogs.buttonPrompt(
            modData,
            OVERWRITE_MAP_FAILED_TITLE,
            OVERWRITE_MAP_FAILED_PROMPT,
            () => {
              saveMap(combinedPath)
              if (actionManager) actionManager.SaveFailed = false
            },
            () => {
              if (actionManager) actionManager.SaveFailed = false
            },
            OVERWRITE_MAP_FAILED_CONFIRM,
          )

          if (actionManager) actionManager.SaveFailed = true
          return
        }
      }
    } else if (mapPackageName !== null) {
      // When file paths match: check for external modification
      const mapCache = modData.mapCache as MapCache | undefined
      if (mapCache) {
        const currentUid = `map:${mapPackageName}`
        const recentUid = mapCache.getUpdatedMap(currentUid)

        if (
          recentUid !== null &&
          currentUid !== recentUid &&
          mapCache.get(recentUid).status === MapStatus.Available
        ) {
          ConfirmationDialogs.buttonPrompt(
            modData,
            OVERWRITE_MAP_OUTSIDE_EDIT_TITLE,
            OVERWRITE_MAP_OUTSIDE_EDIT_PROMPT,
            () => {
              saveMap(combinedPath)
              if (actionManager) actionManager.SaveFailed = false
            },
            () => {
              if (actionManager) actionManager.SaveFailed = false
            },
            SAVE_MAP_OUTSIDE_CONFIRM,
          )

          if (actionManager) actionManager.SaveFailed = true
          return
        }
      }
    }

    // No conflicts -- proceed with save
    saveMap(combinedPath)

    // NOTE: C# calls SaveMapMarkerTiles after save.
    // TODO-21.C.9-DEFER-6: SaveMapMarkerTiles(map, modData, world)
  }

  // -------------------------------------------------------------------------
  // Static: SaveMapInner (对应 OpenRA SaveMapLogic.SaveMapInner, line 295-315)
  // -------------------------------------------------------------------------

  /**
   * Core save logic -- serializes map data to the output package.
   *
   * OpenRA 对照: public static void SaveMapInner(Map, IReadWritePackage,
   *   World, ModData)
   *
   * Sets map.RequiresMod, calls map.Save(package), resets Modified flag,
   * and shows a transient notification.
   *
   * @param map -- the map to save
   * @param _package -- writable package (unused in browser -- uses toJSON)
   * @param modData -- the mod's runtime data
   * @param actionManager -- EditorActionManager for state tracking
   */
  static SaveMapInner(
    map: GameMap,
    _package: unknown,
    modData: ModData,
    actionManager: EditorActionManager | undefined,
  ): void {
    try {
      // Set required mod ID before serialization (OpenRA 对照: map.RequiresMod = modData.Manifest.Id)
      map.requiresMod = modData.manifest.id

      const mapJson = map.toJSON()

      // TODO-21.C.9-DEFER-4: Write to writable package / trigger browser download
      console.log('[SaveMapLogic.SaveMapInner] Map serialized:', mapJson)

      if (actionManager) {
        actionManager.Modified = false
      }

      // TODO-21.C-DEFER-3: TextNotificationsManager 迁移后替换
      console.log(SAVE_CURRENT_MAP)
    } catch (e) {
      SaveMapLogic.SaveMapFailed(
        e instanceof Error ? e : new Error(String(e)),
        modData,
        actionManager,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Static: SaveMapFailed (对应 OpenRA SaveMapLogic.SaveMapFailed, line 317-335)
  // -------------------------------------------------------------------------

  /**
   * Handle a save failure -- log error, set SaveFailed flag, show error dialog.
   *
   * OpenRA 对照: static void SaveMapFailed(Exception e, ModData modData,
   *   World world)
   *
   * @param e -- the exception thrown during save
   * @param modData -- the mod's runtime data
   * @param actionManager -- EditorActionManager for setting SaveFailed
   */
  static SaveMapFailed(
    e: Error,
    modData: ModData,
    actionManager: EditorActionManager | undefined,
  ): void {
    console.debug('Failed to save map.')
    console.debug(e)

    if (actionManager) {
      actionManager.SaveFailed = true
    }

    ConfirmationDialogs.buttonPrompt(
      modData,
      SAVE_MAP_FAILED_TITLE,
      SAVE_MAP_FAILED_PROMPT,
      () => {
        if (actionManager) {
          actionManager.SaveFailed = false
        }
      },
      null,
      SAVE_MAP_FAILED_CONFIRM,
    )
  }

  // -------------------------------------------------------------------------
  // Static: SaveMapMarkerTiles (对应 OpenRA SaveMapLogic.SaveMapMarkerTiles, line 337-358)
  // -------------------------------------------------------------------------

  /**
   * Persist marker layer tiles to a YAML file in the support directory.
   *
   * OpenRA 对照: static void SaveMapMarkerTiles(Map, ModData, World)
   *
   * NOTE: Full implementation deferred -- MarkerLayerOverlay and platform
   * filesystem APIs not yet migrated.
   *
   * TODO-21.C.9-DEFER-6: Implement when MarkerLayerOverlay is available
   *
   * C# pseudocode:
   *   var marker = world.WorldActor.Trait<MarkerLayerOverlay>();
   *   if (marker.Tiles.Count === 0) return;
   *   var dir = Path.Combine(Platform.SupportDir, "Editor", modId, version, "MarkerTiles");
   *   Directory.CreateDirectory(dir);
   *   var filename = Path.GetFileNameWithoutExtension(map.Package.Name) + ".yaml";
   *   new MarkerLayer(marker).Serialize().WriteToFile(Path.Combine(dir, filename));
   *
   * @param _map -- the map that was saved (unused until full implementation)
   * @param _modData -- the mod's runtime data (unused until full implementation)
   * @param _actionManager -- EditorActionManager (unused until full implementation)
   */
  static SaveMapMarkerTiles(
    _map: GameMap,
    _modData: ModData,
    _actionManager: EditorActionManager | undefined,
  ): void {
    // TODO-21.C.9-DEFER-6: Implement marker tile persistence
  }
}
