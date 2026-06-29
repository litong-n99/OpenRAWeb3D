/**
 * DropDownButtonWidget.ts — 下拉按钮 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/DropDownButtonWidget.cs (256 lines)
 *
 * 核心范式转换:
 * - C# Widget.Draw() (SDL2 9-slice 面板 + Sprite 装饰) → DOM CSS background-color + data-state
 * - C# MaskWidget (全屏遮罩捕获点击) → DOM 全屏固定遮罩 + pointerdown 处理
 * - C# Ui.Root.Get<T>(PanelRoot) → TypeScript 延迟查找模式
 * - C# WidgetUtils.DrawSprite (箭头 + 分隔线) → CSS border-arrow 或内联 SVG 箭头
 * - C# ShowDropDown<T> (ScrollPanelWidget 填充) → TypeScript 泛型方法 + DOM 列表
 * - C# Panel Bounds 定位 (考虑屏幕边缘) → TypeScript bounds 调整 + 屏幕约束
 * - C# TakeKeyboardFocus/YieldKeyboardFocus → TypeScript 焦点方法
 */

import { ButtonWidget } from './ButtonWidget.js'
import { Widget, boundsContains } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { TextAlign } from './TextAlign.js'

// ---------------------------------------------------------------------------
// MaskWidget — 全屏遮罩，用于点击外部关闭下拉面板
// OpenRA 对照: MaskWidget : Widget (定义在同一文件内)
// ---------------------------------------------------------------------------

/**
 * 全屏遮罩 widget。
 *
 * 当下拉面板打开时，覆盖整个屏幕以捕获所有鼠标事件。
 * 点击遮罩会关闭下拉面板。
 *
 * OpenRA 对照: public class MaskWidget : Widget
 */
class MaskWidget extends Widget {
  /** 遮罩被点击时的回调。OpenRA 对照: MaskWidget.OnMouseDown */
  onMouseDown: (event: WidgetEvent) => void

  constructor(onMouseDown?: (event: WidgetEvent) => void) {
    super()
    this.onMouseDown = onMouseDown ?? (() => {})
    // Cover full screen
    this.bounds = {
      x: 0,
      y: 0,
      width: 99999,
      height: 99999,
    }
  }

  /**
   * 处理鼠标事件 — Move 事件穿透，Down 事件触发回调并消费。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   */
  override handleEvent(event: WidgetEvent): boolean {
    const type = event.type
    if (type === 'mousemove' || type === 'pointermove') return false

    if (
      type === 'mousedown' ||
      type === 'pointerdown' ||
      type === 'click'
    ) {
      this.onMouseDown(event)
      return true
    }

    return true
  }

  /** 遮罩不改变光标。 */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }

  /** 遮罩不渲染可见内容（transparent overlay）。 */
  override render(): HTMLElement {
    return this.getOrCreateElement('div', 'mask-widget')
  }
}

// ---------------------------------------------------------------------------
// DropDownButtonWidget — 下拉按钮
// OpenRA 对照: public class DropDownButtonWidget : ButtonWidget
// ---------------------------------------------------------------------------

/**
 * 下拉按钮 widget。
 *
 * 点击时打开一个关联的下拉面板（通常包含选项列表）。
 * 点击遮罩、按 Escape 键或选择选项时关闭面板。
 *
 * OpenRA 对照: DropDownButtonWidget
 */
export class DropDownButtonWidget extends ButtonWidget {
  // ---- 下拉面板属性 ----

  /** 装饰面板名称（ChromeMetrics 键）。OpenRA 对照: DropDownButtonWidget.Decorations */
  decorations: string = 'dropdown-decorations'

  /** 装饰箭头标记名称。OpenRA 对照: DropDownButtonWidget.DecorationMarker */
  decorationMarker: string = 'marker'

  /** 分隔符面板名称。OpenRA 对照: DropDownButtonWidget.Separators */
  separators: string = 'dropdown-separators'

  /** 分隔符图像名称。OpenRA 对照: DropDownButtonWidget.SeparatorImage */
  separatorImage: string = 'separator'

  /** 面板水平对齐方式。OpenRA 对照: DropDownButtonWidget.PanelAlign */
  panelAlign: string = TextAlign.Left

  /** 面板根 widget ID（null = Ui.root）。
   * OpenRA 对照: DropDownButtonWidget.PanelRoot */
  panelRoot: string | null = null

  // ---- 内部状态 ----

  /** 当前打开的面板 widget。OpenRA 对照: panel field */
  private _panel: Widget | null = null

  /** 面板打开时的全屏遮罩。OpenRA 对照: fullscreenMask field */
  private _fullscreenMask: MaskWidget | null = null

  /** 面板的父 widget。OpenRA 对照: panelRoot field */
  private _panelRoot: Widget | null = null

  /** 下拉面板是否打开。 */
  get isOpen(): boolean {
    return this._panel !== null
  }

  // ---- 回调 ----

  /** 面板取消时的回调。OpenRA 对照: onCancel Action */
  onCancel: (() => void) | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: DropDownButtonWidget(ModData) / DropDownButtonWidget(DropDownButtonWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 DropDownButtonWidget。
   *
   * OpenRA 对照: public DropDownButtonWidget(ModData modData) : base(modData)
   */
  constructor(_modData?: unknown) {
    super(_modData)
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected DropDownButtonWidget(DropDownButtonWidget widget) : base(widget)
   */
  protected copyFrom(other: DropDownButtonWidget): void {
    super.copyFrom(other)
    this.panelRoot = other.panelRoot
    this.decorations = other.decorations
    this.decorationMarker = other.decorationMarker
    this.separators = other.separators
    this.separatorImage = other.separatorImage
    this.panelAlign = other.panelAlign
  }

  // ---------------------------------------------------------------------------
  // Event handling (outer) — 面板打开时按钮自身的点击优先于遮罩
  // OpenRA 对照: HandleMouseInputOuter (遮罩事件拦截)
  // ---------------------------------------------------------------------------

  /**
   * 外部事件分发 — 当面板打开时，如果点击落在按钮自身区域内，则
   * 首先交由按钮处理，避免全屏遮罩（MaskWidget）拦截按钮的点击事件。
   *
   * OpenRA 对照: 在 C# 中，全屏遮罩通过 HandleMouseInput 返回 true
   * 来消费所有鼠标事件，但按钮的事件由 SDL2 事件循环单独分派。
   * 基于 widget 树的事件模型中，我们需要确保按钮在遮罩之前处理
   * 自身区域内的点击。
   */
  override handleEventOuter(event: WidgetEvent): boolean {
    if (this.isOpen) {
      const eventType = event.type
      if (
        eventType === 'mousedown' || eventType === 'pointerdown' ||
        eventType === 'mouseup' || eventType === 'pointerup' ||
        eventType === 'click'
      ) {
        const posX = (event.clientX ?? 0) as number
        const posY = (event.clientY ?? 0) as number
        // 仅检查按钮自身的渲染边界（不包含子 widget，尤其是全屏遮罩）
        if (boundsContains(this.bounds, posX, posY)) {
          // 直接交由按钮处理，跳过子 widget 迭代（遮罩+面板）
          return this.handleEvent(event)
        }
      }
    }
    return super.handleEventOuter(event)
  }

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // OpenRA 对照: HandleKeyPress + YieldKeyboardFocus
  // ---------------------------------------------------------------------------

  /**
   * 处理键盘事件 — Escape 键关闭面板。
   *
   * OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (
      this.hasKeyboardFocus &&
      event.type === 'keydown' &&
      (event.key === 'Escape' || event.key === 'Esc')
    ) {
      if (this.isOpen) {
        this.removePanel()
        return true
      }
    }

    return super.handleEvent(event)
  }

  /**
   * 释放键盘焦点时关闭面板。
   *
   * OpenRA 对照: public override bool YieldKeyboardFocus()
   */
  override yieldKeyboardFocus(): boolean {
    this.removePanel()
    return super.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // UsableWidth — 可用宽度（预留箭头空间）
  // OpenRA 对照: public override int UsableWidth => Bounds.Width - Bounds.Height
  // ---------------------------------------------------------------------------

  get usableWidth(): number {
    return this.bounds.width - this.bounds.height // space for dropdown arrow
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — Hidden / Removed 时关闭面板
  // OpenRA 对照: Hidden() / Removed()
  // ---------------------------------------------------------------------------

  /**
   * 隐藏时关闭面板。
   *
   * OpenRA 对照: public override void Hidden()
   */
  override hidden(): void {
    this.removePanel()
    super.hidden()
  }

  /**
   * 移除时关闭面板。
   *
   * OpenRA 对照: public override void Removed()
   */
  override removed(): void {
    this.removePanel()
    super.removed()
  }

  // ---------------------------------------------------------------------------
  // Panel management
  // OpenRA 对照: AttachPanel / RemovePanel
  // ---------------------------------------------------------------------------

  /**
   * 移除当前打开的下拉面板。
   *
   * 从父 widget 移除遮罩和面板，释放键盘焦点，调用 onCancel 回调。
   *
   * OpenRA 对照: public void RemovePanel()
   */
  removePanel(): void {
    if (this._panel === null) return

    if (this._panelRoot) {
      if (this._fullscreenMask) {
        this._panelRoot.removeChild(this._fullscreenMask)
      }
      this._panelRoot.removeChild(this._panel)
    }

    this._panel = null
    this._fullscreenMask = null

    this.yieldKeyboardFocus()
    this.onCancel?.()
    // NOTE: Ui.ResetTooltips() is not applicable in DOM model — tooltip is handled by CSS/system
  }

  /**
   * 附加一个下拉面板到此按钮。
   *
   * 创建一个全屏遮罩来捕获点击，设置面板位置（默认在按钮下方，
   * 如果空间不足则在按钮上方），并将面板添加到 widget 树。
   *
   * OpenRA 对照: public void AttachPanel(Widget p, Action onCancel)
   *
   * @param panel — 要附加的面板 widget
   * @param cancelCallback — 面板关闭时的可选回调
   */
  attachPanel(panel: Widget, cancelCallback?: (() => void) | null): void {
    if (this._panel !== null) {
      throw new Error('Attempted to attach a panel to an open dropdown')
    }

    this._panel = panel
    this.onCancel = cancelCallback ?? null

    // 获取键盘焦点
    this.takeKeyboardFocus()

    // 创建全屏遮罩
    // OpenRA: fullscreenMask = new MaskWidget { Bounds = ... }
    this._fullscreenMask = new MaskWidget(() => {
      this.removePanel()
    })

    // 确定面板的父 widget
    // OpenRA: panelRoot = PanelRoot == null ? Ui.Root : Ui.Root.Get(PanelRoot)
    this._panelRoot = this._resolvePanelRoot()

    // 添加遮罩
    this._panelRoot.addChild(this._fullscreenMask)

    // 定位面板
    // OpenRA: 计算 panelX, panelY 并设置 panel.Bounds
    this._positionPanel(panel)

    // 添加面板到 widget 树
    this._panelRoot.addChild(panel)
  }

  /**
   * 解析面板的父 widget。
   *
   * OpenRA 对照: PanelRoot == null ? Ui.Root : Ui.Root.Get(PanelRoot)
   */
  private _resolvePanelRoot(): Widget {
    if (this.panelRoot) {
      // Walk up to find the root (or parent with matching id)
      let current: Widget | null = this.parent
      while (current) {
        if (current.id === this.panelRoot) return current
        current = current.parent
      }
    }
    // Fallback: use the button's parent, or walk to root
    let root: Widget = this
    while (root.parent) {
      root = root.parent
    }
    return root
  }

  /**
   * 根据按钮位置和屏幕约束定位下拉面板。
   *
   * OpenRA 对照: AttachPanel 中的定位逻辑
   */
  private _positionPanel(panel: Widget): void {
    const oldBounds = panel.bounds
    // 面板相对于按钮的 X 偏移
    let panelX = this.bounds.x

    if (this.panelAlign === TextAlign.Right) {
      panelX += this.bounds.width - oldBounds.width
    } else if (this.panelAlign === TextAlign.Center) {
      panelX += (this.bounds.width - oldBounds.width) / 2
    }

    // 默认在按钮下方
    let panelY = this.bounds.y + this.bounds.height

    // 检查屏幕高度约束
    const screenHeight =
      (typeof window !== 'undefined' ? window.innerHeight : 720) || 720
    if (panelY + oldBounds.height > screenHeight) {
      // 空间不足，放在按钮上方
      panelY = this.bounds.y - oldBounds.height
    }

    // 检查屏幕右侧约束
    const screenWidth =
      (typeof window !== 'undefined' ? window.innerWidth : 1280) || 1280
    const buttonRightEdge = this.bounds.x + this.bounds.width
    if (panelX + oldBounds.width > screenWidth) {
      panelX = buttonRightEdge - oldBounds.width
    }

    // 确保面板不超出左边界
    if (panelX < 0) {
      panelX = 0
    }
    if (panelY < 0) {
      panelY = 0
    }

    panel.bounds = {
      x: panelX,
      y: panelY,
      width: oldBounds.width,
      height: oldBounds.height,
    }
  }

  /**
   * 显示一个下拉面板，填充选项列表。
   *
   * 从模板创建 ScrollPanelWidget，为每个选项调用 setupItem。
   * 选项被点击后自动关闭面板。
   *
   * OpenRA 对照: public void ShowDropDown<T>(string panelTemplate, int maxHeight, IEnumerable<T> options, Func<T, ScrollItemWidget, ScrollItemWidget> setupItem)
   *
   * @param panelTemplate — 面板模板名称
   * @param maxHeight — 面板最大高度
   * @param options — 选项列表
   * @param setupItem — 为每个选项创建 ScrollItemWidget 的工厂函数
   *
   * NOTE: 该方法需要 ScrollPanelWidget 和 Ui.LoadWidget 基础设施。
* 当 ScrollPanelWidget 完全迁移后，启用 ScrollPanelWidget 集成。
   * 当前回退：创建简单的 DOM 列表面板。
   */
  showDropDown<T>(
    _panelTemplate: string,
    maxHeight: number,
    options: T[],
    setupItem: (option: T, template: unknown) => unknown,
  ): void {
    // 创建简单的面板容器
    const DropDownPanel = class extends Widget {
      public items: HTMLElement[] = []

      override render(): HTMLElement {
        const el = this.getOrCreateElement('div', 'dropdown-panel')
        el.style.position = 'absolute'
        el.style.backgroundColor = '#1e1e2e'
        el.style.border = '1px solid #444'
        el.style.borderRadius = '4px'
        el.style.overflow = 'hidden'
        el.style.zIndex = '1000'
        el.style.padding = '4px 0'

        while (el.lastChild) el.removeChild(el.lastChild)
        for (const item of this.items) {
          el.appendChild(item)
        }
        return el
      }
    }

    const panel = new DropDownPanel()
    panel.bounds = { x: 0, y: 0, width: this.bounds.width, height: 0 }

    const panelHeight = Math.min(maxHeight, options.length * 28)
    panel.bounds.height = panelHeight

    for (const option of options) {
      const itemEl = document.createElement('div')
      itemEl.className = 'dropdown-item'
      itemEl.style.padding = '8px 12px'
      itemEl.style.cursor = 'pointer'
      itemEl.style.color = '#fff'
      itemEl.style.fontSize = '14px'
      itemEl.style.whiteSpace = 'nowrap'
      itemEl.style.overflow = 'hidden'
      itemEl.style.textOverflow = 'ellipsis'
      itemEl.textContent = String(option)

      itemEl.addEventListener('click', () => {
        this.removePanel()
      })

      itemEl.addEventListener('pointerenter', () => {
        itemEl.style.backgroundColor = '#3a3a4a'
      })
      itemEl.addEventListener('pointerleave', () => {
        itemEl.style.backgroundColor = ''
      })

      const result = setupItem(option, itemEl)
      if (result && typeof result === 'object') {
        const res = result as Record<string, unknown>
        if (res['itemEl'] && res['itemEl'] instanceof HTMLElement) {
          panel.items.push(res['itemEl'] as HTMLElement)
        } else {
          panel.items.push(itemEl)
        }
      } else {
        panel.items.push(itemEl)
      }
    }

    this.attachPanel(panel)
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw() — 绘制箭头装饰和分隔线
  // ---------------------------------------------------------------------------

  /**
   * 渲染下拉按钮的 DOM 元素。
   *
   * 在按钮右侧渲染下拉箭头（▼）。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = super.render()

    // 确保有箭头指示器
    let arrowEl = el.querySelector('[data-dropdown-arrow]') as HTMLElement | null
    if (!arrowEl) {
      arrowEl = document.createElement('span')
      arrowEl.setAttribute('data-dropdown-arrow', 'true')
      arrowEl.style.position = 'absolute'
      arrowEl.style.right = '8px'
      arrowEl.style.top = '50%'
      arrowEl.style.transform = 'translateY(-50%)'
      arrowEl.style.pointerEvents = 'none'
      arrowEl.style.fontSize = '10px'
      arrowEl.style.color = '#aaa'
      arrowEl.textContent = '▼' // ▼
      el.appendChild(arrowEl)
    }

    // 设置 data-is-open 属性
    if (this.isOpen) {
      el.setAttribute('data-is-open', 'true')
    } else {
      el.removeAttribute('data-is-open')
    }

    return el
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override DropDownButtonWidget Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 DropDownButtonWidget。
   *
   * OpenRA 对照: public override DropDownButtonWidget Clone()
   */
  override clone(): DropDownButtonWidget {
    const b = new DropDownButtonWidget()
    b.copyFrom(this)
    b.id = this.id
    b._xExpr = this._xExpr
    b._yExpr = this._yExpr
    b._widthExpr = this._widthExpr
    b._heightExpr = this._heightExpr
    b.logic = [...this.logic]
    b.visible = this.visible
    b.ignoreMouseOver = this.ignoreMouseOver
    b.ignoreChildMouseOver = this.ignoreChildMouseOver
    b.isVisible = this.isVisible
    b.isDisabled = this.isDisabled
    b.bounds = { ...this.bounds }
    for (const child of this.children) {
      // Skip internal panel children (MaskWidget + panel widgets added by attachPanel)
      // These are managed by the dropdown lifecycle and should not be cloned
      if (child === this._fullscreenMask || child === this._panel) continue
      b.addChild(child.clone())
    }
    return b
  }
}
