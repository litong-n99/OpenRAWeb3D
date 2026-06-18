/**
 * CommonSelectorLogic.ts — 编辑器选择器面板抽象基类
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/CommonSelectorLogic.cs (171 lines)
 *
 * 核心范式转换:
 * - C# ChromeLogic 抽象类 + event Action SelectionChanged → TypeScript 抽象类 +
 *   SelectionChanged 回调订阅（通过 EditorDefaultBrush.onSelectionChanged）
 * - C# HashSet<string> SelectedCategories → TypeScript Set<string>
 * - C# FluentProvider.GetMessage() → 硬编码英文字符串（TODO-21.C-DEFER-1）
 * - C# Ui.LoadWidget() → TypeScript Ui.loadWidget()
 * - C# Panel.Layout = new GridLayout(Panel) →
 *   Panel.layout = new GridLayout(Panel as IGridLayoutHost)
 * - C# PascalCase widget delegates → TypeScript camelCase
 *
 * 为瓦片/actor 选择器提供共享模式:
 * - 分类过滤下拉面板（全部选择/全不选按钮 + 复选框列表）
 * - 带 Escape 清除和去抖的搜索文本字段
 * - 带 GridLayout 的可滚动条目面板
 * - 选择变更时自动交出键盘焦点
 *
 * Migration: TODO-21.C.14 — Chapter 21 Phase C Wave 2
 */

import {
  type Widget,
  ChromeLogic,
  Ui,
  ContainerWidget,
  type WidgetEvent,
} from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ScrollPanelWidget } from '../../../Widgets/ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../../Widgets/ScrollItemWidget.js'
import { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
import { ButtonWidget } from '../../../Widgets/ButtonWidget.js'
import { CheckboxWidget } from '../../../Widgets/CheckboxWidget.js'
import { TextFieldWidget } from '../../../Widgets/TextFieldWidget.js'
import { GridLayout } from '../../../Widgets/GridLayout.js'
import type { IGridLayoutHost } from '../../../Widgets/GridLayout.js'
import type { EditorViewportControllerWidget } from '../../../Widgets/EditorViewportControllerWidget.js'

// ---------------------------------------------------------------------------
// ISelectionEventSource — brush event subscription subset
// ---------------------------------------------------------------------------

interface ISelectionEventSource {
  onSelectionChanged?(cb: () => void): void
  offSelectionChanged?(cb: () => void): void
}

// ---------------------------------------------------------------------------
// Localized strings (OpenRA 对照: FluentProvider static strings)
// TODO-21.C-DEFER-1: FluentProvider 迁移后替换为本地化字符串
// ---------------------------------------------------------------------------

const NONE_LABEL = 'None'
const SEARCH_RESULTS_LABEL = 'Search Results'
const ALL_LABEL = 'All'
const MULTIPLE_LABEL = 'Multiple'

// ---------------------------------------------------------------------------
// CommonSelectorLogic
// ---------------------------------------------------------------------------

/**
 * 编辑器选择器面板的抽象基类。
 *
 * OpenRA 对照: public abstract class CommonSelectorLogic : ChromeLogic
 */
export abstract class CommonSelectorLogic extends ChromeLogic {
  protected readonly widget: Widget
  protected readonly modData: Record<string, unknown>
  protected readonly world: Record<string, unknown>
  protected readonly worldRenderer: {
    world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
  }
  protected readonly editor: EditorViewportControllerWidget
  protected readonly panel: ScrollPanelWidget
  protected readonly itemTemplate: ScrollItemWidget
  protected readonly searchTextField: TextFieldWidget

  protected readonly selectedCategories: Set<string> = new Set()
  protected readonly filteredCategories: string[] = []
  protected allCategories: string[] = []
  protected searchFilter: string = ''

  private readonly _onSelectionChanged: () => void

  /**
   * 初始化共享的选择器基础设施。
   *
   * OpenRA 对照: CommonSelectorLogic(Widget, ModData, World, WorldRenderer, string templateListId, string previewTemplateId)
   */
  protected constructor(
    widget: Widget,
    modData: Record<string, unknown>,
    world: Record<string, unknown>,
    worldRenderer: {
      world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
    },
    templateListId: string,
    previewTemplateId: string,
  ) {
    super()

    this.widget = widget
    this.modData = modData
    this.world = world
    this.worldRenderer = worldRenderer

    // 通过 parent 链解析 EditorViewportControllerWidget
    const parentP = widget.parent as unknown as { parent: Widget | null } | null
    const editorParent = parentP?.parent
    if (!editorParent) {
      throw new Error(
        'CommonSelectorLogic: widget.parent.parent is null — cannot resolve MAP_EDITOR',
      )
    }
    this.editor = editorParent.get<EditorViewportControllerWidget>('MAP_EDITOR')

    this.panel = widget.get<ScrollPanelWidget>(templateListId)
    this.itemTemplate = this.panel.get<ScrollItemWidget>(previewTemplateId)

    // 设置 GridLayout（OpenRA 对照: Panel.Layout = new GridLayout(Panel)）
    this.panel.layout = new GridLayout(this.panel as unknown as IGridLayoutHost)

    // 搜索文本字段
    this.searchTextField = widget.get<TextFieldWidget>('SEARCH_TEXTFIELD')
    this.searchTextField.onEscapeKey = (_event: WidgetEvent) => {
      if (!this.searchTextField.text || this.searchTextField.text.length === 0) {
        this.searchTextField.yieldKeyboardFocus()
      } else {
        this.searchTextField.text = ''
        if (this.searchTextField.onTextEdited) {
          this.searchTextField.onTextEdited()
        }
      }
      return true
    }

    // 订阅 SelectionChanged
    this._onSelectionChanged = this._handleSelectionChanged.bind(this)
    const brush = this.editor.defaultBrush as unknown as ISelectionEventSource
    if (brush.onSelectionChanged) {
      brush.onSelectionChanged(this._onSelectionChanged)
    }

    // 分类下拉按钮
    const categorySelector = widget.get<DropDownButtonWidget>('CATEGORIES_DROPDOWN')
    categorySelector.getText = () => {
      if (this.selectedCategories.size === 0) return NONE_LABEL
      if (this.searchFilter && this.searchFilter.length > 0) return SEARCH_RESULTS_LABEL
      if (this.selectedCategories.size === 1) {
        return this.selectedCategories.values().next().value ?? NONE_LABEL
      }
      if (this.selectedCategories.size === this.allCategories.length) return ALL_LABEL
      return MULTIPLE_LABEL
    }

    categorySelector.onMouseDown = (_event: WidgetEvent) => {
      this.searchTextField?.yieldKeyboardFocus()
      categorySelector.removePanel()
      categorySelector.attachPanel(this.createCategoriesPanel(this.panel))
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose (对应 OpenRA Dispose(bool disposing))
  // ---------------------------------------------------------------------------

  override dispose(): void {
    const brush = this.editor.defaultBrush as unknown as ISelectionEventSource
    if (brush.offSelectionChanged) {
      brush.offSelectionChanged(this._onSelectionChanged)
    }
    super.dispose()
  }

  // ---------------------------------------------------------------------------
  // handleSelectionChanged (对应 OpenRA HandleSelectionChanged)
  // ---------------------------------------------------------------------------

  private _handleSelectionChanged(): void {
    this.searchTextField.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // createCategoriesPanel (对应 OpenRA CreateCategoriesPanel)
  // ---------------------------------------------------------------------------

  protected createCategoriesPanel(panel: ScrollPanelWidget): Widget {
    const categoriesPanel = Ui.loadWidget<Widget>('CATEGORY_FILTER_PANEL', null, {})
    const categoryTemplate = categoriesPanel.get<CheckboxWidget>('CATEGORY_TEMPLATE')

    const selectButtons = categoriesPanel.get<ContainerWidget>('SELECT_CATEGORIES_BUTTONS')
    categoriesPanel.addChild(selectButtons)

    const selectAll = selectButtons.get<ButtonWidget>('SELECT_ALL')
    selectAll.onClick = () => {
      this.selectedCategories.clear()
      for (const c of this.allCategories) {
        this.selectedCategories.add(c)
      }
      this.initializePreviews()
    }

    const selectNone = selectButtons.get<ButtonWidget>('SELECT_NONE')
    selectNone.onClick = () => {
      this.selectedCategories.clear()
      this.initializePreviews()
    }

    let categoryHeight = 5 + selectButtons.bounds.height
    const catBounds = categoryTemplate.bounds
    for (const cat of this.filteredCategories) {
      const category = categoryTemplate.clone() as CheckboxWidget
      category.getText = () => cat
      category.isChecked = () => this.selectedCategories.has(cat)
      category.isVisible = () => true
      category.onClick = () => {
        if (!this.selectedCategories.delete(cat)) {
          this.selectedCategories.add(cat)
        }
        this.initializePreviews()
      }

      categoriesPanel.addChild(category)
      categoryHeight += catBounds.height
    }

    categoriesPanel.bounds = {
      ...categoriesPanel.bounds,
      height: Math.min(categoryHeight, panel.bounds.height),
    }

    return categoriesPanel
  }

  // ---------------------------------------------------------------------------
  // initializePreviews — abstract
  // ---------------------------------------------------------------------------

  protected abstract initializePreviews(): void
}
