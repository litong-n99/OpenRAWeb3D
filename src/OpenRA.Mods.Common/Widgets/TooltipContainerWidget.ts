/**
 * TooltipContainerWidget.ts — 工具提示容器 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/TooltipContainerWidget.cs (114 lines)
 *
 * 核心范式转换:
 * - C# TooltipContainerWidget : Widget (Draw/ChildOrigin) → DOM 绝对定位 tooltip 元素
 * - C# Ui.LoadWidget (延迟加载 tooltip widget 模板) → DOM 模板创建
 * - C# int nextToken (并发安全) → TypeScript token 递增
 * - C# Game.Renderer.Resolution → window.innerWidth/innerHeight
 * - C# Viewport.LastMousePos + LastMoveRunTime → 全局鼠标位置追踪
 * - C# GraphicSettings.CursorDouble → 简化为缩放因子 1.0
 * - C# WidgetArgs + WidgetLoader → TypeScript Record<string, unknown> + 回调创建
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs } from '../../OpenRA.Game/Widgets/Widget.js'
import type { ITooltipContainer } from './ButtonWidget.js'

// ---------------------------------------------------------------------------
// 全局鼠标追踪（供 TooltipContainerWidget 使用）
// OpenRA 对照: Viewport.LastMousePos / Viewport.LastMoveRunTime
// ---------------------------------------------------------------------------

/** 全局鼠标位置追踪器。 */
interface MouseState {
  x: number
  y: number
  lastMoveTime: number
}

let globalMouseState: MouseState = {
  x: 0,
  y: 0,
  lastMoveTime: 0,
}

/**
 * 更新全局鼠标状态。
 * 由外部事件处理器在 mousemove 时调用。
 */
export function updateGlobalMouseState(x: number, y: number): void {
  globalMouseState = { x, y, lastMoveTime: performance.now() }
}

/**
 * 获取全局鼠标状态（只读）。
 */
export function getGlobalMouseState(): Readonly<MouseState> {
  return globalMouseState
}

// ---------------------------------------------------------------------------
// TooltipContainerWidget — 工具提示容器
// OpenRA 对照: public class TooltipContainerWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 工具提示容器 widget。
 *
 * 管理工具提示的延迟显示和定位。
 * 使用 token 机制避免过期的工具提示被错误显示。
 *
 * OpenRA 对照: TooltipContainerWidget
 */
export class TooltipContainerWidget extends Widget implements ITooltipContainer {
  // ---- 定位属性 ----

  /** 光标偏移量（像素）。OpenRA 对照: TooltipContainerWidget.CursorOffset */
  cursorOffset: { x: number; y: number } = { x: 0, y: 20 }

  /** 底部边缘 Y 偏移量。OpenRA 对照: TooltipContainerWidget.BottomEdgeYOffset */
  bottomEdgeYOffset: number = -5

  /** 工具提示延迟（毫秒）。OpenRA 对照: TooltipContainerWidget.TooltipDelayMilliseconds */
  tooltipDelayMilliseconds: number = 250

  // ---- 回调 ----

  /** 渲染前回调。OpenRA 对照: TooltipContainerWidget.BeforeRender */
  beforeRender: () => void = () => {}

  // ---- 内部状态 ----

  /** 当前 tooltip widget（延迟加载）。OpenRA 对照: tooltip field */
  private _tooltip: Widget | null = null

  /** Token 计数器（递增）。OpenRA 对照: nextToken */
  private _nextToken: number = 1

  /** 当前活跃 token。OpenRA 对照: currentToken */
  private _currentToken: number = 0

  /** 当前 tooltip 模板 ID。OpenRA 对照: id field */
  private _tooltipId: string | null = null

  /** 当前 tooltip 参数。OpenRA 对照: widgetArgs field */
  private _widgetArgs: WidgetArgs | null = null

  /** tooltip 模板工厂函数（替代 Ui.LoadWidget 的延迟加载）。
   * OpenRA 对照: Ui.LoadWidget(id, this, new WidgetArgs(widgetArgs) { { "tooltipContainer", this } })
   */
  private _templateFactory: ((template: string, args: WidgetArgs) => Widget) | null =
    null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // OpenRA: IsVisible = () => Game.RunTime > Viewport.LastMoveRunTime + TooltipDelayMilliseconds
    this.isVisible = () => {
      const now = performance.now()
      return now > globalMouseState.lastMoveTime + this.tooltipDelayMilliseconds
    }
  }

  // ---------------------------------------------------------------------------
  // Template factory — 设置 tooltip 模板工厂（替代 Ui.LoadWidget）
  // ---------------------------------------------------------------------------

  /**
   * 设置 tooltip 模板工厂函数。
   *
   * 替代 OpenRA 的 Ui.LoadWidget(id, parent, args)。
   * 工厂函数接收模板名称和参数，返回创建的 widget 实例。
   */
  setTemplateFactory(factory: (template: string, args: WidgetArgs) => Widget): void {
    this._templateFactory = factory
  }

  // ---------------------------------------------------------------------------
  // LoadWidget — 延迟加载 tooltip widget
  // OpenRA 对照: LoadWidget() private method
  // ---------------------------------------------------------------------------

  /**
   * 延迟加载 tooltip widget。
   *
   * 仅在 tooltip 可见时才创建 widget。
   *
   * OpenRA 对照: void LoadWidget()
   */
  private _loadWidget(): void {
    if (!this._tooltipId || this._tooltip) return

    if (!this._templateFactory) return

    const args: WidgetArgs = {
      ...(this._widgetArgs ?? {}),
      tooltipContainer: this,
    }

    this._tooltip = this._templateFactory(this._tooltipId, args)
    if (this._tooltip) {
      this.addChild(this._tooltip)
    }
  }

  // ---------------------------------------------------------------------------
  // SetTooltip / RemoveTooltip
  // OpenRA 对照: SetTooltip(string, WidgetArgs) / RemoveTooltip(int) / RemoveTooltip()
  // ---------------------------------------------------------------------------

  /**
   * 设置工具提示并返回 token。
   *
   * OpenRA 对照: public int SetTooltip(string id, WidgetArgs args)
   *
   * @param templateId — tooltip 模板 ID
   * @param args — tooltip 初始化参数
   * @returns token，用于 RemoveTooltip 验证
   */
  setTooltip(templateId: string, args: WidgetArgs): number {
    // 先移除旧的 tooltip
    this.removeTooltip()

    this._currentToken = this._nextToken++
    this._tooltip = null
    this._tooltipId = templateId
    this._widgetArgs = args

    // 如果已经可见，立即加载（OpenRA 中由 IsVisible 委托延迟加载）
    if (this.isVisible()) {
      this._loadWidget()
    }

    return this._currentToken
  }

  /**
   * 移除工具提示（带 token 验证）。
   *
   * OpenRA 对照: public void RemoveTooltip(int token)
   *
   * @param token — SetTooltip 返回的 token
   */
  removeTooltipToken(token: number): void {
    if (this._currentToken !== token) return

    this._tooltip?.removeChildren()
    if (this._tooltip) {
      this.removeChild(this._tooltip)
    }
    this._tooltip = null
    this._tooltipId = null
    this._widgetArgs = null
    this.beforeRender = () => {}
  }

  /**
   * 移除当前工具提示。
   *
   * OpenRA 对照: public void RemoveTooltip()
   */
  removeTooltip(): void {
    this.removeTooltipToken(this._currentToken)
  }

  // ---------------------------------------------------------------------------
  // ChildOrigin — 定位 tooltip
  // OpenRA 对照: public override int2 ChildOrigin
  // ---------------------------------------------------------------------------

  /**
   * 工具提示的子原点 — 靠近鼠标光标。
   *
   * 如果 tooltip 超出屏幕右边界，向左移动。
   * 如果 tooltip 超出屏幕下边界，移至光标上方。
   *
   * OpenRA 对照: public override int2 ChildOrigin
   */
  get childOrigin(): { x: number; y: number } {
    const scale = 1 // 简化: 不考虑 CursorDouble 缩放
    let pos = {
      x: globalMouseState.x + scale * this.cursorOffset.x,
      y: globalMouseState.y + scale * this.cursorOffset.y,
    }

    if (this._tooltip) {
      const screenWidth =
        (typeof window !== 'undefined' ? window.innerWidth : 1280) || 1280
      const screenHeight =
        (typeof window !== 'undefined' ? window.innerHeight : 720) || 720

      const tooltipRight = pos.x + this._tooltip.bounds.width
      if (tooltipRight > screenWidth) {
        pos = { x: screenWidth - this._tooltip.bounds.width, y: pos.y }
      }

      const tooltipBottom = pos.y + this._tooltip.bounds.height
      if (tooltipBottom > screenHeight) {
        pos = {
          x: pos.x,
          y:
            globalMouseState.y +
            scale * this.bottomEdgeYOffset -
            this._tooltip.bounds.height,
        }
      }
    }

    return pos
  }

  // ---------------------------------------------------------------------------
  // EventBoundsContains — 不捕获鼠标事件
  // OpenRA 对照: public override bool EventBoundsContains(int2 location) → false
  // ---------------------------------------------------------------------------

  /**
   * Tooltip 容器不参与命中测试。
   *
   * OpenRA 对照: public override bool EventBoundsContains(int2 location)
   */
  /** Tooltip 容器不参与命中测试。返回 false。
   *
   * NOTE: 基类 Widget 中没有 eventBoundsContains 方法（使用 _eventBoundsContains）。
   * 此方法为便利方法，实际命中测试在 handleEventOuter 中完成。
   */
  eventBoundsContains(_x: number, _y: number): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // OpenRA 对照: public override string GetCursor(int2 pos) → null
  // ---------------------------------------------------------------------------

  /**
   * Tooltip 容器不改变光标。
   */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染工具提示容器。
   *
   * 如果可见，自动加载 tooltip widget。
   * 调用 beforeRender 回调。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    // 如果可见且未加载，加载 widget
    if (this.isVisible()) {
      this._loadWidget()
    }

    this.beforeRender()

    const el = this.getOrCreateElement('div', 'tooltip-container-widget')
    el.style.position = 'absolute'
    el.style.pointerEvents = 'none' // tooltip 不消费鼠标事件

    // NOTE: Widget 子元素的挂载已由 Widget.renderOuter() 统一处理，
    // 不再在此处重复清理和挂载，避免产生重复 DOM 元素。

    return el
  }

  // ---------------------------------------------------------------------------
  // Tick — 每帧检查可见性
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新 — 当可见性改变时加载 widget。
   */
  override tick(): void {
    if (this.isVisible() && !this._tooltip && this._tooltipId) {
      this._loadWidget()
    }
  }

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 TooltipContainerWidget。
   */
  override clone(): TooltipContainerWidget {
    const w = new TooltipContainerWidget()
    w.id = this.id
    w.cursorOffset = { ...this.cursorOffset }
    w.bottomEdgeYOffset = this.bottomEdgeYOffset
    w.tooltipDelayMilliseconds = this.tooltipDelayMilliseconds
    w.beforeRender = this.beforeRender
    w._xExpr = this._xExpr
    w._yExpr = this._yExpr
    w._widthExpr = this._widthExpr
    w._heightExpr = this._heightExpr
    w.logic = [...this.logic]
    w.visible = this.visible
    w.bounds = { ...this.bounds }
    for (const child of this.children) {
      w.addChild(child.clone())
    }
    return w
  }
}
