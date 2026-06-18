/**
 * MapEditorTabsLogic.ts — 编辑器 Tab 栏控制器
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorTabsLogic.cs (100 lines)
 *
 * 核心范式转换:
 * - C# enum MenuType { Select, Tiles, Layers, Actors, Tools, History } → TypeScript const enum
 * - C# static event Action OnTabChanged → TypeScript Set<() => void>
 * - C# ButtonWidget.IsHighlighted / IsDisabled / OnClick 闭包 → TypeScript delegate
 * - C# ContainerWidget.IsVisible 闭包 → TypeScript delegate
 * - C# EditorDefaultBrush.UpdateSelectedTab += HandleUpdateSelectedTab → onUpdateSelectedTab()
 * - C# Ui.KeyboardFocusWidget = null → 直接设置 Ui.keyboardFocusWidget
 *
 * 管理 6 个编辑器 Tab 标签页，控制面板容器可见性，
 * 并在选区变化时自动切换到 Select Tab。
 *
 * Migration:  — Chapter 21 Phase C Wave 1
 */

import { ChromeLogic, Ui, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { ButtonWidget } from '../../../Widgets/ButtonWidget.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { EditorViewportControllerWidget } from '../../../Widgets/EditorViewportControllerWidget.js'
// EditorDefaultBrush types used via ITabBrush interface

// ---------------------------------------------------------------------------
// MenuType enum (对应 OpenRA MenuType enum)
// ---------------------------------------------------------------------------

/** 编辑器菜单标签页类型。
 *
 * OpenRA 对照: enum MenuType { Select, Tiles, Layers, Actors, Tools, History }
 */
export const MenuType = {
  Select: 0,
  Tiles: 1,
  Layers: 2,
  Actors: 3,
  Tools: 4,
  History: 5,
} as const

export type MenuType = (typeof MenuType)[keyof typeof MenuType]

// ---------------------------------------------------------------------------
// Selection minimal interface
// ---------------------------------------------------------------------------

/** Minimal selection info for tab auto-switch.
 *
 * OpenRA 对照: EditorSelection { bool HasSelection }
 */
export interface IHasSelection {
  readonly hasSelection: boolean
}

/** Minimal DefaultBrush for tab events.
 *
 * OpenRA 对照: EditorDefaultBrush { Selection, UpdateSelectedTab }
 */
export interface ITabBrush {
  readonly selection: IHasSelection
  onUpdateSelectedTab(callback: () => void): void
  offUpdateSelectedTab(callback: () => void): void
}

// ---------------------------------------------------------------------------
// IEditorTool minimal interface for Tools tab
// ---------------------------------------------------------------------------

/** Minimal IEditorTool for checking tool availability.
 *
 * OpenRA 对照: IEditorTool { bool IsEnabled }
 */
export interface IToolCheck {
  readonly isEnabled: boolean
}

/** Placeholder class for IEditorTool lookup. */
class EditorToolPlaceholder {
  isEnabled: boolean = true
}

// ---------------------------------------------------------------------------
// MapEditorTabsLogic
// OpenRA 对照: public class MapEditorTabsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 编辑器 Tab 栏逻辑。
 *
 * 管理 6 个标签页的面板可见性、高亮状态、禁用状态，
 * 并在选区变化时自动切换到 Select Tab。
 *
 * OpenRA 对照: MapEditorTabsLogic
 */
export class MapEditorTabsLogic extends ChromeLogic {
  // ---- Static event (对应 OpenRA static event Action OnTabChanged) ----

  /** Tab 切换时的回调集合。
   *
   * OpenRA 对照: static event Action OnTabChanged
   */
  static onTabChanged: Set<() => void> = new Set()

  // ---- Instance state (对应 OpenRA 字段) ----

  /** 当前菜单标签页类型。OpenRA 对照: MenuType menuType */
  private _menuType: MenuType = MenuType.Tiles

  /** 最后选择的非 Select 标签页。OpenRA 对照: MenuType lastSelectedTab */
  private _lastSelectedTab: MenuType = MenuType.Tiles

  /** 面板容器 widget。OpenRA 对照: Widget panelContainer */
  private readonly _panelContainer: Widget

  /** Tab 容器 widget。OpenRA 对照: Widget tabContainer */
  private readonly _tabContainer: Widget

  /** 编辑器 ViewportController。OpenRA 对照: EditorViewportControllerWidget editor */
  private readonly _editor: EditorViewportControllerWidget

  /** 编辑器默认笔刷引用。OpenRA 对照: editor.DefaultBrush */
  private readonly _brush: ITabBrush

  /** UpdateSelectedTab 回调引用（用于 dispose）。 */
  private readonly _onUpdateTab: () => void

  /** 世界中是否有可用的 IEditorTool traits。
   * 在构造函数中计算一次，因为在编辑器运行时不会变化。 */
  private readonly _toolsAvailable: boolean

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: MapEditorTabsLogic(Widget widget, World world)
  // ---------------------------------------------------------------------------

  /**
   * 构造 MapEditorTabsLogic。
   *
   * OpenRA 对照: MapEditorTabsLogic(Widget widget, World world)
   *
   * @param widget — 父 widget（MAP_EDITOR_TAB_CONTAINER 的父级）
   * @param world — 游戏世界（用于查询 IEditorTool traits）
   */
  constructor(
    widget: Widget,
    world: {
      readonly worldActor: {
        traitsImplementing<T>(_traitClass: new () => T): Iterable<T>
      }
    },
  ) {
    super()
    this._panelContainer = widget.parent!
    this._tabContainer = widget.get('MAP_EDITOR_TAB_CONTAINER')

    // Access editor from grandparent
    this._editor = widget.parent!.parent!.get<EditorViewportControllerWidget>('MAP_EDITOR')
    this._brush = this._editor.defaultBrush as unknown as ITabBrush

    // Check tool availability once
    const tools = world.worldActor.traitsImplementing<IToolCheck>(
      EditorToolPlaceholder as unknown as new () => IToolCheck,
    )
    this._toolsAvailable = [...tools].some(t => t.isEnabled)

    // Subscribe to UpdateSelectedTab (will auto-switch on selection change)
    this._onUpdateTab = () => this._handleUpdateSelectedTab()
    this._brush.onUpdateSelectedTab(this._onUpdateTab)

    // Setup all 6 tabs
    this._setupTab('SELECT_TAB', 'SELECT_WIDGETS', MenuType.Select)
    this._setupTab('TILES_TAB', 'TILE_WIDGETS', MenuType.Tiles)
    this._setupTab('OVERLAYS_TAB', 'LAYER_WIDGETS', MenuType.Layers)
    this._setupTab('ACTORS_TAB', 'ACTOR_WIDGETS', MenuType.Actors)
    this._setupTab('TOOLS_TAB', 'TOOLS_WIDGETS', MenuType.Tools)
    this._setupTab('HISTORY_TAB', 'HISTORY_WIDGETS', MenuType.History)
  }

  // ---------------------------------------------------------------------------
  // Dispose (对应 OpenRA Dispose)
  // ---------------------------------------------------------------------------

  /**
   * 清理资源：取消订阅 UpdateSelectedTab 和 OnTabChanged。
   *
   * OpenRA 对照: protected override void Dispose(bool disposing)
   */
  override dispose(): void {
    this._brush.offUpdateSelectedTab(this._onUpdateTab)
  }

  // ---------------------------------------------------------------------------
  // SetupTab (对应 OpenRA SetupTab)
  // ---------------------------------------------------------------------------

  /**
   * 配置单个标签页按钮及其关联的容器面板。
   *
   * OpenRA 对照: void SetupTab(string buttonId, string tabId, MenuType tabType)
   *
   * @param buttonId — Tab 按钮的 widget ID
   * @param tabId — 对应面板容器的 widget ID
   * @param tabType — 该 Tab 的枚举类型
   */
  private _setupTab(buttonId: string, tabId: string, tabType: MenuType): void {
    const tab = this._tabContainer.get<ButtonWidget>(buttonId)
    tab.isHighlighted = () => this._menuType === tabType
    tab.onClick = () => {
      if (tabType !== MenuType.Select) {
        this._lastSelectedTab = tabType
      }

      this._menuType = tabType
      MapEditorTabsLogic.fireOnTabChanged()

      // Clear keyboard focus when switching tabs
      Ui.keyboardFocusWidget = null
    }

    // Select tab is special: only enabled when a selection exists
    if (tabType === MenuType.Select) {
      tab.isDisabled = () => !this._brush.selection.hasSelection
    }

    // Tools tab is only enabled when IEditorTool traits are available
    if (tabType === MenuType.Tools) {
      tab.isDisabled = () => !this._toolsAvailable
    }

    const container = this._panelContainer.get<ContainerWidget>(tabId)
    container.isVisible = () => this._menuType === tabType
  }

  // ---------------------------------------------------------------------------
  // HandleUpdateSelectedTab (对应 OpenRA HandleUpdateSelectedTab)
  // ---------------------------------------------------------------------------

  /**
   * 当选区变化时，根据选区状态自动切换标签页。
   *
   * 如果有选区且当前不在 Select Tab，自动切换到 Select Tab。
   * 如果选区被清除且当前在 Select Tab，切换回上次选择的标签页。
   *
   * OpenRA 对照: void HandleUpdateSelectedTab()
   */
  private _handleUpdateSelectedTab(): void {
    const hasSelection = this._brush.selection.hasSelection

    if (this._menuType !== MenuType.Select && hasSelection) {
      this._menuType = MenuType.Select
    } else if (this._menuType === MenuType.Select && !hasSelection) {
      this._menuType = this._lastSelectedTab
    }

    MapEditorTabsLogic.fireOnTabChanged()
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * 触发所有 OnTabChanged 回调。
   */
  static fireOnTabChanged(): void {
    for (const cb of MapEditorTabsLogic.onTabChanged) {
      cb()
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新（无需操作 — 所有状态在闭包中延迟求值）。
   */
  tick(): void {
    // No-op
  }
}
