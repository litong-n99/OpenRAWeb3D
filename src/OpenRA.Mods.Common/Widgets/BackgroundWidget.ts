/**
 * BackgroundWidget.ts -- 9-Slice 面板背景装饰器 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/BackgroundWidget.cs (43 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.DrawPanel() (SDL2 9-slice 四边形渲染) -> CSS border-image
 * - OpenRA ChromeProvider.GetPanelImages() (运行时精灵查找) -> ChromeProvider.getPanelSliceCss()
 * - OpenRA EventBounds.Contains (命中测试) -> boundsContains
 * - OpenRA ClickThrough readonly 字段 -> clickThrough 属性
 *
 * BackgroundWidget 是一个装饰器 widget，放置在其他 widget 后面
 * 以渲染 9-slice 面板背景（对话框、边框、窗口等）。
 */

import { Widget, boundsContains } from '../../OpenRA.Game/Widgets/Widget.js'
import { ChromeProvider } from '../../OpenRA.Game/Graphics/ChromeProvider.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// BackgroundWidget -- 9-Slice 面板背景
// OpenRA 对照: public class BackgroundWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 9-Slice 面板背景装饰器 widget。
 *
 * 使用 CSS `border-image`（由 ChromeProvider 的 PanelRegion 驱动）
 * 渲染 9-slice 面板背景。
 * 通常放置在其他 widget 后面作为视觉装饰。
 * 可选地消费鼠标事件（ClickThrough = false 时）。
 *
 * OpenRA 对照: public class BackgroundWidget : Widget
 */
export class BackgroundWidget extends Widget {
  // ---- 面板属性 ----

  /** ChromeProvider 面板集合名称。OpenRA 对照: BackgroundWidget.Background */
  background: string = 'dialog'

  /** 是否穿透点击（true 时不消费鼠标事件）。
   * OpenRA 对照: BackgroundWidget.ClickThrough */
  clickThrough: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: BackgroundWidget() / BackgroundWidget(BackgroundWidget)
  // ---------------------------------------------------------------------------

  constructor() {
    super()
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected BackgroundWidget(BackgroundWidget other) : base(other)
   */
  protected copyFrom(other: BackgroundWidget): void {
    this.background = other.background
    this.clickThrough = other.clickThrough
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override BackgroundWidget Clone()
  // ---------------------------------------------------------------------------

  override clone(): BackgroundWidget {
    const cloned = new BackgroundWidget()
    cloned.copyFrom(this)
    cloned.id = this.id
    cloned._xExpr = this._xExpr
    cloned._yExpr = this._yExpr
    cloned._widthExpr = this._widthExpr
    cloned._heightExpr = this._heightExpr
    cloned.logic = [...this.logic]
    cloned.visible = this.visible
    cloned.ignoreMouseOver = this.ignoreMouseOver
    cloned.ignoreChildMouseOver = this.ignoreChildMouseOver
    cloned.isVisible = this.isVisible
    cloned.bounds = { ...this.bounds }
    for (const child of this.children) {
      cloned.addChild(child.clone())
    }
    return cloned
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // OpenRA 对照: BackgroundWidget.HandleMouseInput(MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * 处理鼠标事件。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   *
   * 如果 ClickThrough 为 false 且鼠标在 EventBounds 内，消费事件。
   * 注意: OpenRA 使用 EventBounds.Contains（而非 RenderBounds.Contains），
   * EventBounds 返回 RenderBounds（不包含子 widget 的扩展范围）。
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (this.clickThrough) return false

    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number
    return boundsContains(this.bounds, x, y)
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: BackgroundWidget.Draw() -> WidgetUtils.DrawPanel(Background, RenderBounds)
  // ---------------------------------------------------------------------------

  /**
   * 使用 CSS border-image 渲染 9-slice 面板背景。
   *
   * - 从 ChromeProvider 获取面板区域的 PanelRegion
   * - 应用 CSS border-image-source（来自集合图像 URL）
   * - 应用 CSS border-image-slice（来自 PanelRegion）
   * - 应用 CSS border-image-repeat: stretch（匹配 OpenRA 的拉伸行为）
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'background-widget')
    el.style.position = 'absolute'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'

    // 点击穿透
    if (this.clickThrough) {
      el.style.pointerEvents = 'none'
    } else {
      el.style.pointerEvents = 'auto'
    }

    // 设置 widget ID
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 设置背景集合名称数据属性（供 CSS 样式表引用）
    el.setAttribute('data-background', this.background)

    // 应用 9-slice 面板背景
    this._applyPanelBackground(el)

    return el
  }

  /**
   * 将 9-slice 面板背景应用到 DOM 元素。
   *
   * 使用以下 ChromeProvider API:
   * - ChromeProvider.getImage(collection) -- 面板图像 URL
   * - ChromeProvider.getPanelSliceCss(collection) -- border-image-slice 值
   *
   * OpenRA 对照: WidgetUtils.DrawPanel(string, Rectangle)
   */
  private _applyPanelBackground(el: HTMLElement): void {
    if (!this.background) return

    // 获取面板图像 URL
    const imageUrl = ChromeProvider.getImage(this.background)
    if (!imageUrl) return

    // 获取 border-image-slice 值
    const sliceCss = ChromeProvider.getPanelSliceCss(this.background)

    // 应用 CSS border-image
    // OpenRA 的 9-slice 面板: 图像被切分为 9 个区域，拉伸到元素边界
    el.style.borderStyle = 'solid'
    el.style.borderWidth = '0' // border-image 完全填充（无边距偏移）
    el.style.borderImageSource = `url("${imageUrl}")`
    el.style.borderImageRepeat = 'stretch'

    if (sliceCss) {
      el.style.borderImageSlice = sliceCss
    } else {
      // 无 PanelRegion: 回退到简单背景图像（非 9-slice）
      el.style.borderImageSlice = ''
      el.style.backgroundImage = `url("${imageUrl}")`
      el.style.backgroundSize = '100% 100%'
      el.style.backgroundRepeat = 'no-repeat'
      return
    }

    // 清除回退样式
    el.style.backgroundImage = ''
    el.style.backgroundSize = ''
    el.style.backgroundRepeat = ''
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // ---------------------------------------------------------------------------

  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }
}
