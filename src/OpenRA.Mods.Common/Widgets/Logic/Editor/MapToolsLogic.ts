/**
 * MapToolsLogic.ts — 编辑器工具面板控制器
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/MapToolsLogic.cs (94 lines)
 *
 * 核心范式转换:
 * - C# List<Widget> toolPanels → TypeScript Array<Widget>
 * - C# Dictionary<Widget, string> toolLabels → TypeScript Map<Widget, string>
 * - C# ScrollItemWidget.Setup(…, selected, onClick) → TypeScript 等效
 * - C# DropDownButtonWidget.ShowDropDown → TypeScript showDropDown
 * - C# static event Action<bool> OnSelected → TypeScript Set<(boolean) => void>
 * - C# FluentProvider.GetMessage → 硬编码标签字符串（TODO-21.C-DEFER-1）
 *
 * 加载所有 IEditorTool trait 面板，管理工具选择下拉框，
 * 在 TabChanged 事件时触发 OnSelected 回调以通知工具专属逻辑类。
 *
 * Migration: TODO-21.C.4 — Chapter 21 Phase C Wave 1
 */

import { ChromeLogic, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
// ScrollItemWidget pattern used via setupItem callback
import { MapEditorTabsLogic } from './MapEditorTabsLogic.js'

// ---------------------------------------------------------------------------
// IEditorTool minimal interface
// ---------------------------------------------------------------------------

/** Minimal IEditorTool interface for tool panel loading.
 *
 * OpenRA 对照: IEditorTool { string PanelWidget, string Label, bool IsEnabled }
 */
export interface IEditorToolInfo {
  /** Widget ID of the tool's panel. */
  readonly panelWidget: string
  /** Human-readable label for this tool. */
  readonly label: string
  /** Whether this tool is currently enabled. */
  readonly isEnabled: boolean
}

// ---------------------------------------------------------------------------
// Tool loader function (injectable for testing)
// ---------------------------------------------------------------------------

/** Load a tool panel widget.
 *
 * OpenRA 对照: Game.LoadWidget(world, tool.PanelWidget, widget, new WidgetArgs() { { "tool", tool } })
 */
export type ToolPanelLoader = (
  world: { readonly worldActor: { traitsImplementing: <T>(_: new () => T) => Iterable<T> } },
  panelId: string,
  parent: Widget,
  args: WidgetArgs,
) => Widget

// ---------------------------------------------------------------------------
// MapToolsLogic
// OpenRA 对照: public class MapToolsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 编辑器工具面板逻辑。
 *
 * 管理工具选择下拉菜单，加载 IEditorTool 面板，
 * 并在 Tab 切换和工具选择时触发 OnSelected 事件。
 *
 * OpenRA 对照: MapToolsLogic
 */
export class MapToolsLogic extends ChromeLogic {
  // ---- Static event (对应 OpenRA static event Action<bool> OnSelected) ----

  /** 工具选中或 Tab 切换时的回调集合。
   *
   * OpenRA 对照: static event Action<bool> OnSelected
   */
  static onSelected: Set<(isVisible: boolean) => void> = new Set()

  // ---- Instance state (对应 OpenRA 字段) ----

  /** 已加载的工具面板列表。OpenRA 对照: List<Widget> toolPanels */
  private readonly _toolPanels: Widget[] = []

  /** 工具面板 → 标签文本映射。OpenRA 对照: Dictionary<Widget, string> toolLabels */
  private readonly _toolLabels = new Map<Widget, string>()

  /** 父 widget（用于可见性检查）。OpenRA 对照: Widget widget */
  private readonly _widget: Widget

  /** 当前选中的工具面板。OpenRA 对照: Widget selectedPanel */
  private _selectedPanel: Widget | null = null

  /** 工具选择下拉按钮。OpenRA 对照: DropDownButtonWidget toolDropdownWidget */
  private readonly _toolDropdownWidget: DropDownButtonWidget

  /** OnTabChanged 回调引用（用于 dispose）。 */
  private readonly _onTabChanged: () => void

  /** 当前 widget 是否可见。 */
  private _widgetIsVisible(): boolean {
    return this._widget.isVisible()
  }

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: MapToolsLogic(Widget widget, World world)
  // ---------------------------------------------------------------------------

  /**
   * 构造 MapToolsLogic。
   *
   * OpenRA 对照: MapToolsLogic(Widget widget, World world)
   *
   * @param widget — 父 widget（TOOLS_DROPDOWN 的父级）
   * @param world — 游戏世界（用于查询 IEditorTool traits）
   * @param loadPanel — 可选的工具面板加载函数（用于测试注入）
   */
  constructor(
    widget: Widget,
    world: { readonly worldActor: { traitsImplementing: <T>(_: new () => T) => Iterable<T> } },
    loadPanel?: ToolPanelLoader,
  ) {
    super()
    this._widget = widget
    this._toolDropdownWidget = widget.get<DropDownButtonWidget>('TOOLS_DROPDOWN')

    // Subscribe to TabChanged
    this._onTabChanged = () => this._selectedTab()
    MapEditorTabsLogic.onTabChanged.add(this._onTabChanged)

    const loader = loadPanel ?? MapToolsLogic._defaultLoadPanel

    const tools = world.worldActor.traitsImplementing<IEditorToolInfo>(
      EditorToolPlaceholder as unknown as new () => IEditorToolInfo,
    )
    for (const tool of tools) {
      if (!tool.isEnabled) continue

      const panel = loader(world, tool.panelWidget, widget, { tool } as WidgetArgs)
      this._toolPanels.push(panel)
      // NOTE: FluentProvider not yet migrated, use direct label
      this._toolLabels.set(panel, tool.label)
    }

    // Select the first tool panel
    this._selectTool(this._toolPanels[0] ?? null)

    this._toolDropdownWidget.onMouseDown = () => this._showToolsDropDown(this._toolDropdownWidget)
    this._toolDropdownWidget.getText = () => this._selectedPanel
      ? (this._toolLabels.get(this._selectedPanel) ?? '')
      : ''

    // Disable dropdown if only one tool
    if (this._toolPanels.length <= 1) {
      this._toolDropdownWidget.isDisabled = () => true
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose (对应 OpenRA Dispose)
  // ---------------------------------------------------------------------------

  /**
   * 清理资源：取消订阅 OnTabChanged。
   *
   * OpenRA 对照: protected override void Dispose(bool disposing)
   */
  override dispose(): void {
    MapEditorTabsLogic.onTabChanged.delete(this._onTabChanged)
  }

  // ---------------------------------------------------------------------------
  // SelectedTab (对应 OpenRA SelectedTab)
  // ---------------------------------------------------------------------------

  /**
   * Tab 切换时的回调：触发 OnSelected 事件。
   *
   * OpenRA 对照: void SelectedTab()
   */
  private _selectedTab(): void {
    MapToolsLogic.fireOnSelected(this._widgetIsVisible())
  }

  // ---------------------------------------------------------------------------
  // ShowToolsDropDown (对应 OpenRA ShowToolsDropDown)
  // ---------------------------------------------------------------------------

  /**
   * 显示工具选择下拉菜单。
   *
   * OpenRA 对照: void ShowToolsDropDown(DropDownButtonWidget dropdown)
   *
   * @param dropdown — 下拉按钮 widget
   */
  private _showToolsDropDown(dropdown: DropDownButtonWidget): void {
    const toolPanels = this._toolPanels
    const toolLabels = this._toolLabels
    const selectedPanel = () => this._selectedPanel
    const selectTool = (panel: Widget) => this._selectTool(panel)

    function setupItem(
      panel: Widget,
      _itemTemplate: unknown,
    ): unknown {
      // In the real implementation, this calls ScrollItemWidget.Setup()
      // We return a minimal mock ScrollItemWidget-like object
      const item = {
        isSelected: () => selectedPanel() === panel,
        onClick: () => selectTool(panel),
        getText: () => toolLabels.get(panel) ?? '',
      }
      return item
    }

    dropdown.showDropDown('LABEL_DROPDOWN_TEMPLATE', 150, toolPanels, setupItem)
  }

  // ---------------------------------------------------------------------------
  // SelectTool (对应 OpenRA SelectTool)
  // ---------------------------------------------------------------------------

  /**
   * 选择指定的工具面板。
   *
   * 隐藏之前选中的面板，显示新选中的面板。
   * 触发 OnSelected 事件。
   *
   * OpenRA 对照: void SelectTool(Widget panel)
   *
   * @param panel — 要选中的面板，或 null 表示不选中任何面板
   */
  private _selectTool(panel: Widget | null): void {
    if (panel !== this._selectedPanel && this._selectedPanel !== null) {
      this._selectedPanel.visible = false
    }

    this._selectedPanel = panel
    if (panel !== null) {
      panel.visible = true
    }

    MapToolsLogic.fireOnSelected(this._widgetIsVisible())
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * 触发所有 OnSelected 回调。
   *
   * @param isVisible — 当前工具面板是否可见
   */
  static fireOnSelected(isVisible: boolean): void {
    for (const cb of MapToolsLogic.onSelected) {
      cb(isVisible)
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新（无需操作）。
   */
  tick(): void {
    // No-op
  }

  // ---------------------------------------------------------------------------
  // Default panel loader (no-op, replaced in production)
  // ---------------------------------------------------------------------------

  /** 默认工具面板加载器（no-op，由 WidgetLoader 在运行时注入）。 */
  private static _defaultLoadPanel: ToolPanelLoader = (
    _world,
    _panelId,
    _parent,
    _args,
  ): Widget => {
    // Stub: return a minimal widget
    return { id: _panelId, visible: false, isVisible: () => false } as unknown as Widget
  }
}

// ---------------------------------------------------------------------------
// Placeholder class for trait lookup
// ---------------------------------------------------------------------------

/** Placeholder for IEditorToolInfo trait-based lookup.
 * @internal */
class EditorToolPlaceholder implements IEditorToolInfo {
  panelWidget: string = ''
  label: string = ''
  isEnabled: boolean = true
}
