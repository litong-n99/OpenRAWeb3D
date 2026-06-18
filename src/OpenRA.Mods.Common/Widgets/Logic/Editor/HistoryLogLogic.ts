/**
 * HistoryLogLogic.ts — 编辑器撤销/重做历史列表
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/HistoryLogLogic.cs (69 lines)
 *
 * 核心范式转换:
 * - C# EditorActionManager.ItemAdded / ItemRemoved events → TypeScript onItemAdded / onItemRemoved
 * - C# ScrollItemWidget.Setup(template, selected, onClick) → TypeScript 等效
 * - C# Dictionary<EditorActionContainer, ScrollItemWidget> → TypeScript Map
 * - C# Status-based color/text → TypeScript getText/getColor closures
 * - C# Rewind(id) / Forward(id) → TypeScript 等效
 *
 * 显示撤销/重做历史为可滚动列表。每个条目显示操作文本，
 * 未来操作以暗色显示，点击可回退/前进到特定操作。
 *
 * Migration:  — Chapter 21 Phase C Wave 2b
 */

import { ChromeLogic, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import {
  EditorActionStatus,
  type EditorActionManager,
  type EditorActionContainer,
  type EditorActionContainerCallback,
} from '../../../Traits/World/EditorActionManager.js'

// ---------------------------------------------------------------------------
// Minimal widget types for scroll item setup
// ---------------------------------------------------------------------------

type AnyWidget = Widget

/** Minimal LabelWidget for text/color access. */
interface MinimalLabelWidget extends AnyWidget {
  getText: () => string
  getColor: () => number
}

/** Minimal ScrollItemWidget with Setup pattern. */
interface MinimalScrollItemWidget extends AnyWidget {
  isSelected: () => boolean
  addChild(child: AnyWidget): void
  removeChild(child: AnyWidget): void
}

/** Minimal ScrollPanelWidget for history list. */
interface MinimalScrollPanelWidget extends AnyWidget {
  addChild(child: AnyWidget): void
  removeChild(child: AnyWidget): void
  readonly contentHeight: number
}

// ---------------------------------------------------------------------------
// HistoryLogLogic (对应 OpenRA HistoryLogLogic : ChromeLogic)
// ---------------------------------------------------------------------------

/**
 * Displays the undo/redo history as a scrollable list.
 *
 * OpenRA 对照: HistoryLogLogic : ChromeLogic
 *
 * Each entry shows the action text, colored dim for future actions,
 * and is clickable to rewind/forward to that specific action in the history.
 */
export class HistoryLogLogic extends ChromeLogic {
  // ---- Widget references ----
  private readonly panel: MinimalScrollPanelWidget
  private readonly template: MinimalScrollItemWidget
  private readonly editorActionManager: EditorActionManager

  // ---- State ----
  /** Map from action container to its scroll item widget. */
  private readonly states = new Map<EditorActionContainer, AnyWidget>()

  /** Bound event handlers (for cleanup). */
  private readonly _onItemAdded: EditorActionContainerCallback
  private readonly _onItemRemoved: EditorActionContainerCallback

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA HistoryLogLogic constructor)
  // -------------------------------------------------------------------------

  /**
   * @param widget — the root widget
   * @param editorActionManager — the editor action manager
   * @param panelWidgetId — widget ID for the scroll panel (default: "HISTORY_LIST")
   * @param templateWidgetId — widget ID for the item template (default: "HISTORY_TEMPLATE")
   */
  constructor(
    widget: AnyWidget,
    editorActionManager: EditorActionManager,
    panelWidgetId: string = 'HISTORY_LIST',
    templateWidgetId: string = 'HISTORY_TEMPLATE',
  ) {
    super()

    this.editorActionManager = editorActionManager

    const panelWidget = (widget as any)?.get?.(panelWidgetId) as MinimalScrollPanelWidget | undefined
    if (!panelWidget) {
      // MAJOR-FIX: warn instead of silently substituting a no-op panel
      console.warn(`[HistoryLogLogic] Widget "${panelWidgetId}" not found — history list will be non-functional`)
    }
    this.panel = (panelWidget ?? { addChild: () => {}, removeChild: () => {} }) as MinimalScrollPanelWidget
    const templateWidget = (panelWidget as any)?.get?.(templateWidgetId) as MinimalScrollItemWidget | undefined
    if (!templateWidget) {
      console.warn(`[HistoryLogLogic] Widget "${templateWidgetId}" not found in panel — history items will not render`)
    }
    this.template = (templateWidget ?? { clone: () => ({ get: () => null }) }) as MinimalScrollItemWidget

    // Bind event handlers
    this._onItemAdded = (editorAction: EditorActionContainer) => this.itemAdded(editorAction)
    this._onItemRemoved = (editorAction: EditorActionContainer) => this.itemRemoved(editorAction)

    this.editorActionManager.onItemAdded(this._onItemAdded)
    this.editorActionManager.onItemRemoved(this._onItemRemoved)
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  override dispose(): void {
    this.editorActionManager.offItemAdded(this._onItemAdded)
    this.editorActionManager.offItemRemoved(this._onItemRemoved)
    this.states.clear()
    super.dispose()
  }

  // -------------------------------------------------------------------------
  // Tick (abstract from ChromeLogic)
  // -------------------------------------------------------------------------

  override tick(): void {
    // History log has no per-frame logic — entries update reactively via events
  }

  // -------------------------------------------------------------------------
  // ItemAdded (对应 OpenRA ItemAdded)
  // -------------------------------------------------------------------------

  /** Handle a new action being added to the history.
   *
   * OpenRA 对照: ItemAdded(EditorActionContainer editorAction)
   */
  itemAdded(editorAction: EditorActionContainer): void {
    // Create a scroll item entry
    const item = this.setupScrollItem(this.template, editorAction)

    // Get title label and set dynamic text + color
    const titleLabel = (item as any).get('TITLE') as MinimalLabelWidget
    if (titleLabel) {
      const textColor = (this.template as any).textColor ?? 0xFFFFFFFF
      const futureTextColor = (this.template as any).textColorDisabled ?? 0x80808080

      ;(titleLabel as any).getText = () => editorAction.action.text
      ;(titleLabel as any).getColor = () =>
        editorAction.status === EditorActionStatus.Future ? futureTextColor : textColor
    }

    ;(item as any).isSelected = () => editorAction.status === EditorActionStatus.Active
    ;(this.panel as any).addChild(item)

    this.states.set(editorAction, item)
  }

  // -------------------------------------------------------------------------
  // ItemRemoved (对应 OpenRA ItemRemoved)
  // -------------------------------------------------------------------------

  /** Handle an action being removed from history (redo stack cleared).
   *
   * OpenRA 对照: ItemRemoved(EditorActionContainer editorAction)
   */
  itemRemoved(editorAction: EditorActionContainer): void {
    const widget = this.states.get(editorAction)
    if (widget) {
      ;(this.panel as any).removeChild(widget)
      this.states.delete(editorAction)
    }
  }

  // -------------------------------------------------------------------------
  // SetupScrollItem — create a scroll item for an action (对应 OpenRA pattern)
  // -------------------------------------------------------------------------

  /**
   * Create a ScrollItemWidget entry for the given action.
   *
   * OpenRA 对照: ScrollItemWidget.Setup(template, () => false, onClick)
   *
   * @param template — the template widget to clone
   * @param editorAction — the action to render
   * @returns the new scroll item widget
   */
  private setupScrollItem(
    template: MinimalScrollItemWidget,
    editorAction: EditorActionContainer,
  ): AnyWidget {
    // Clone the template — fallback to plain object for testing
    let item: AnyWidget
    try {
      item = (template as any).clone?.() ?? (template as unknown as AnyWidget)
    } catch (_e) {
      item = {} as AnyWidget
    }

    // Wire click behavior: rewind/forward to this action
    ;(item as any).onClick = () => {
      const status = editorAction.status
      const id = editorAction.id

      if (status === EditorActionStatus.History) {
        this.editorActionManager.Rewind(id)
      } else if (status === EditorActionStatus.Future) {
        this.editorActionManager.Forward(id)
      }
      // Active: no-op (clicking the current state does nothing)
    }

    return item
  }
}
