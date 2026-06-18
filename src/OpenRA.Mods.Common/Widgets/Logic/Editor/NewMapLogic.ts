/**
 * NewMapLogic.ts — 新建地图对话框
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/NewMapLogic.cs (84 lines)
 *
 * 核心范式转换:
 * - C# Action onExit / Action<string> onSelect → TypeScript 函数回调
 * - C# DropDownButtonWidget + ScrollItemWidget.Setup → TypeScript 等效
 * - C# CachedTransform<ITerrainInfo, string> → 闭包缓存
 * - C# Map(Game.ModData, ITerrainInfo, Size) → TypeScript Map 构造
 * - C# Map.SetBounds(PPos, PPos) → TypeScript setBounds
 * - C# MapPlayers(Rules, playerCount).ToMiniYaml() → TypeScript MapPlayers.toMiniYaml()
 * - C# ZipFileLoader.ReadWriteZipFile() → TypeScript 等效
 * - C# Map.Save(IReadWritePackage) → TypeScript save(package)
 * - C# Game.LoadEditor(Map) → TypeScript 全局函数
 * - C# Ui.CloseWindow() → TypeScript Ui.closeWindow()
 * - C# FluentProvider.GetMessage → 硬编码字符串（TODO-21.C-DEFER-1）
 * - C# ITerrainInfoNotifyMapCreated.MapCreated → TypeScript 回调
 *
 * 显示新建地图对话框，包含地形选择下拉框、宽高输入框和创建按钮。
 * 创建时构造新的 Map，设置边界和玩家定义，保存到内存包中。
 *
 * Migration: TODO-21.C.8 — Chapter 21 Phase C Wave 1
 */

import { ChromeLogic, Ui, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { ButtonWidget } from '../../../Widgets/ButtonWidget.js'
import type { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
import type { TextFieldWidget } from '../../../Widgets/TextFieldWidget.js'

// ---------------------------------------------------------------------------
// Minimal interfaces for NewMapLogic
// ---------------------------------------------------------------------------

/** Minimal terrain info for new map creation.
 *
 * OpenRA 对照: ITerrainInfo { string Name, string Id }
 */
export interface INewMapTerrainInfo {
  readonly name: string
  readonly id: string
}

/** Minimal MapPlayers for player configuration.
 *
 * OpenRA 对照: MapPlayers { toMiniYaml() }
 */
export interface INewMapPlayers {
  toMiniYaml(): unknown[]
}

/** Minimal Map for new map creation.
 *
 * OpenRA 对照: Map { Rules, PlayerDefinitions, Package, Uid, Save, SetBounds }
 */
export interface INewMap {
  readonly rules: {
    readonly terrainInfo: {
      readonly name: string
    } & Partial<{
      mapCreated(_map: INewMap): void
    }>
  }
  playerDefinitions: unknown[] | null
  save(_package: INewMapPackage): void
  setBounds(topLeft: { readonly x: number; readonly y: number }, bottomRight: { readonly x: number; readonly y: number }): void
  readonly uid: string
}

/** Minimal package for map storage.
 *
 * OpenRA 对照: IReadWritePackage
 */
export interface INewMapPackage {
  readonly name?: string
}

/** Minimal grid for terrain height.
 *
 * OpenRA 对照: MapGrid { int MaximumTerrainHeight }
 */
export interface INewMapGrid {
  readonly maximumTerrainHeight: number
}

/** Minimal ModData for new map creation.
 *
 * OpenRA 对照: ModData { DefaultTerrainInfo }
 */
export interface INewMapModData {
  readonly defaultTerrainInfo: {
    readonly values: readonly INewMapTerrainInfo[]
  }
}

// ---------------------------------------------------------------------------
// Map constructor type (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Creates a new Map instance.
 *
 * OpenRA 对照: new Map(Game.ModData, ITerrainInfo, new Size(width+2, height+maxTerrainHeight+2))
 *
 * @param terrain — the selected terrain info
 * @param width — playable width in cells
 * @param height — playable height in cells
 * @param maxTerrainHeight — maximum terrain height from map grid
 * @returns a new Map instance
 */
export type NewMapConstructor = (
  terrain: INewMapTerrainInfo,
  width: number,
  height: number,
  maxTerrainHeight: number,
) => INewMap

/** Creates a MapPlayers instance.
 *
 * OpenRA 对照: new MapPlayers(map.Rules, 0)
 */
export type NewMapPlayersConstructor = (rules: { readonly terrainInfo: unknown }, playerCount: number) => INewMapPlayers

/** Creates a read-write package for map storage. */
export type NewMapPackageConstructor = () => INewMapPackage

/** Loads the editor with the given map.
 *
 * OpenRA 对照: Game.LoadEditor(Map)
 */
export type LoadEditorFunction = (map: INewMap) => void

// ---------------------------------------------------------------------------
// NewMapLogic
// OpenRA 对照: public class NewMapLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 新建地图对话框逻辑。
 *
 * 提供地形选择、地图尺寸输入和创建按钮。
 * 创建时构造新的 Map 对象，设置边界和玩家定义，然后加载到编辑器中。
 *
 * OpenRA 对照: NewMapLogic
 */
export class NewMapLogic extends ChromeLogic {
  /** 面板 widget。OpenRA 对照: Widget panel */
  private readonly _panel: Widget

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: NewMapLogic(Action onExit, Action<string> onSelect, Widget widget, World world, ModData modData)
  // ---------------------------------------------------------------------------

  /**
   * 构造 NewMapLogic。
   *
   * OpenRA 对照: NewMapLogic(Action onExit, Action<string> onSelect,
   *   Widget widget, World world, ModData modData)
   *
   * @param onExit — 用户取消时的回调
   * @param onSelect — 用户选择地图后的回调（参数为地图 UID）
   * @param widget — 对话框父 widget
   * @param world — 游戏世界（提供 Map.Grid）
   * @param modData — ModData（提供 DefaultTerrainInfo）
   * @param createMap — 可选的地图构造工厂（用于测试注入）
   * @param createPackage — 可选的包构造工厂（用于测试注入）
   * @param createPlayers — 可选的 MapPlayers 构造工厂（用于测试注入）
   * @param loadEditor — 可选的编辑器加载函数（用于测试注入）
   */
  constructor(
    onExit: () => void,
    onSelect: (uid: string) => void,
    widget: Widget,
    world: {
      readonly map: {
        readonly grid: INewMapGrid
        readonly rules: { readonly terrainInfo: unknown }
      }
    },
    modData: INewMapModData,
    createMap?: NewMapConstructor,
    createPackage?: NewMapPackageConstructor,
    createPlayers?: NewMapPlayersConstructor,
    loadEditor?: LoadEditorFunction,
  ) {
    super()
    this._panel = widget

    const makeMap = createMap ?? NewMapLogic._defaultCreateMap
    const makePackage = createPackage ?? NewMapLogic._defaultCreatePackage
    const makePlayers = createPlayers ?? NewMapLogic._defaultCreatePlayers
    const loadEdit = loadEditor ?? NewMapLogic._defaultLoadEditor

    const panel = this._panel

    // ---- Cancel button (对应 OpenRA CANCEL_BUTTON) ----
    panel.get<ButtonWidget>('CANCEL_BUTTON').onClick = () => {
      Ui.closeWindow()
      onExit()
    }

    // ---- Tileset dropdown (对应 OpenRA TILESET) ----
    const terrains = modData.defaultTerrainInfo.values
    let selectedTerrain = terrains[0]!
    const tilesetDropDown = panel.get<DropDownButtonWidget>('TILESET')

    function setupItem(
      option: INewMapTerrainInfo,
      _template: unknown,
    ): unknown {
      return {
        isSelected: () => selectedTerrain === option,
        onClick: () => { selectedTerrain = option },
        getText: () => cachedLabel(option),
      }
    }

    // Simple label cache (对应 OpenRA CachedTransform)
    let _cachedTerrain: INewMapTerrainInfo | null = null
    let _cachedLabel: string = ''
    function cachedLabel(ti: INewMapTerrainInfo): string {
      if (_cachedTerrain !== ti) {
        _cachedTerrain = ti
        // NOTE: FluentProvider not yet migrated, use name field directly
        _cachedLabel = ti.name
      }
      return _cachedLabel
    }

    tilesetDropDown.getText = () => cachedLabel(selectedTerrain)
    tilesetDropDown.onClick = () => {
      tilesetDropDown.showDropDown(
        'LABEL_DROPDOWN_TEMPLATE',
        210,
        [...terrains],
        setupItem,
      )
    }

    // ---- Width / Height text fields (对应 OpenRA WIDTH / HEIGHT) ----
    const widthTextField = panel.get<TextFieldWidget>('WIDTH')
    const heightTextField = panel.get<TextFieldWidget>('HEIGHT')

    // ---- Create button (对应 OpenRA CREATE_BUTTON) ----
    panel.get<ButtonWidget>('CREATE_BUTTON').onClick = () => {
      let width = parseInt(widthTextField.text, 10)
      let height = parseInt(heightTextField.text, 10)

      // Require at least a 2x2 playable area
      width = Math.max(2, width || 0)
      height = Math.max(2, height || 0)

      const maxTerrainHeight = world.map.grid.maximumTerrainHeight
      const map = makeMap(selectedTerrain, width, height, maxTerrainHeight)

      const tl = { x: 1, y: 1 + maxTerrainHeight }
      const br = { x: width, y: height + maxTerrainHeight }
      map.setBounds(tl, br)

      map.playerDefinitions = makePlayers(world.map.rules, 0).toMiniYaml()

      // Notify terrain info of map creation (if supported)
      const terrainInfo = map.rules.terrainInfo as { mapCreated?: (m: INewMap) => void }
      terrainInfo.mapCreated?.(map)

      const pkg = makePackage()
      map.save(pkg)

      loadEdit(map)
      Ui.closeWindow()
      onSelect(map.uid)
    }
  }

  /**
   * 每帧更新（无需操作）。
   */
  tick(): void {
    // No-op
  }

  // ---- Default factories (no-op in browser context, replaced at runtime) ----

  /** 默认地图构造器（stub）。 */
  private static _defaultCreateMap: NewMapConstructor = (_t, _w, _h, _mh) => ({
    rules: { terrainInfo: { name: _t.name } },
    playerDefinitions: null,
    save: () => {},
    setBounds: () => {},
    uid: '',
  })

  /** 默认包构造器（stub）。 */
  private static _defaultCreatePackage: NewMapPackageConstructor = () => ({})

  /** 默认 MapPlayers 构造器（stub）。 */
  private static _defaultCreatePlayers: NewMapPlayersConstructor = () => ({
    toMiniYaml: () => [],
  })

  /** 默认编辑器加载函数（stub）。 */
  private static _defaultLoadEditor: LoadEditorFunction = (_map) => {}
}
