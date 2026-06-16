/**
 * ScrollItemWidget.ts — 可选择的滚动面板条目 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ScrollItemWidget.cs (97 lines)
 *
 * 核心范式转换:
 * - OpenRA ButtonWidget 子类 + stateful panel sprite → DOM <div> + data-selected 属性
 * - OpenRA WidgetUtils.DrawPanel with (-selected, -hover) suffixes → CSS 类切换
 * - OpenRA Setup() 静态工厂模式 → TypeScript 静态方法
 * - OpenRA Func<bool> IsSelected → TypeScript () => boolean
 *
 * ScrollItemWidget 作为 ScrollPanelWidget 的项目模板使用。
 * 当 ScrollPanelWidget 绑定到集合时，该模板被克隆以创建项目。
 */

import { ButtonWidget } from './ButtonWidget.js'

// ---------------------------------------------------------------------------
// ScrollItemWidget — 可选择列表项
// OpenRA 对照: public class ScrollItemWidget : ButtonWidget
// ---------------------------------------------------------------------------

/** 可选择的滚动面板条目。
 *
 * 扩展 ButtonWidget，添加选中状态和支持集合键的项目键。
 * 用作 ScrollPanelWidget 的项目模板。
 *
 * OpenRA 对照: ScrollItemWidget
 */
export class ScrollItemWidget extends ButtonWidget {
  /** 选中状态委托。OpenRA 对照: ScrollItemWidget.IsSelected */
  isSelected: () => boolean

  /** 集合绑定中的项目键。OpenRA 对照: ScrollItemWidget.ItemKey */
  itemKey: string = ''

  /** 是否启用子 widget 的鼠标悬停检测。
   * 默认忽略子 widget 鼠标悬停。
   * OpenRA 对照: ScrollItemWidget.EnableChildMouseOver */
  enableChildMouseOver: boolean = false

  constructor() {
    super()
    this.isSelected = () => false
    this.background = 'scrollitem'
    // HACK: 我们希望默认 IgnoreChildMouseOver = true
    // 但仍允许显式设置 EnableChildMouseOver 来禁用它
    this.ignoreChildMouseOver = true
  }

  /** 复制构造函数。
   *
   * OpenRA 对照: protected ScrollItemWidget(ScrollItemWidget other)
   */
  protected copyConstructor(other: ScrollItemWidget): void {
    this.isSelected = other.isSelected
    this.itemKey = other.itemKey
    this.background = other.background
    this.enableChildMouseOver = other.enableChildMouseOver
    this.ignoreChildMouseOver = !other.enableChildMouseOver
  }

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  /** 克隆此 ScrollItemWidget。
   *
   * OpenRA 对照: ScrollItemWidget.Clone()
   */
  override clone(): ScrollItemWidget {
    const s = new ScrollItemWidget()
    // 复制 ButtonWidget 属性
    s.id = this.id
    s._xExpr = this._xExpr
    s._yExpr = this._yExpr
    s._widthExpr = this._widthExpr
    s._heightExpr = this._heightExpr
    s.logic = [...this.logic]
    s.visible = false // 克隆时默认不可见（匹配 OpenRA: IsVisible = () => false）
    s.disabled = this.disabled
    s.background = this.background
    s.depressed = this.depressed
    s.align = this.align
    s.leftMargin = this.leftMargin
    s.rightMargin = this.rightMargin
    s.text = this.text
    s.getText = this.getText
    s.visualHeight = this.visualHeight
    s.font = this.font
    s.textColor = this.textColor
    s.textColorDisabled = this.textColorDisabled
    s.disableKeyRepeat = this.disableKeyRepeat
    s.disableKeySound = this.disableKeySound
    s.highlighted = this.highlighted
    s.isHighlighted = this.isHighlighted
    s.onClick = this.onClick
    s.onDoubleClick = this.onDoubleClick
    s.cursor = this.cursor
    s.clickSound = this.clickSound
    s.clickDisabledSound = this.clickDisabledSound
    s.tooltipText = this.tooltipText
    s.tooltipContainerId = this.tooltipContainerId
    s.tooltipTemplate = this.tooltipTemplate
    s.ignoreMouseOver = this.ignoreMouseOver
    s.ignoreChildMouseOver = this.ignoreChildMouseOver
    s.isVisible = this.isVisible
    s.isDisabled = this.isDisabled
    s.bounds = { ...this.bounds }
    // 复制 ScrollItemWidget 属性
    s.isSelected = this.isSelected
    s.itemKey = this.itemKey
    s.enableChildMouseOver = this.enableChildMouseOver
    for (const child of this.children) {
      s.addChild(child.clone())
    }
    return s
  }

  // ---------------------------------------------------------------------------
  // Setup — 静态工厂方法
  // OpenRA 对照: ScrollItemWidget.Setup(...)
  // ---------------------------------------------------------------------------

  /** 从模板创建 ScrollItemWidget（带单击处理）。
   *
   * 克隆模板，设置可见性为 true，并连接 isSelected 和 onClick 委托。
   *
   * OpenRA 对照: ScrollItemWidget.Setup(template, isSelected, onClick)
   *
   * @param template — 要克隆的模板 widget
   * @param isSelected — 选中状态委托
   * @param onClick — 单击回调
   * @returns 配置好的 ScrollItemWidget
   */
  static setup(
    template: ScrollItemWidget,
    isSelected: () => boolean,
    onClick: () => void,
  ): ScrollItemWidget {
    const w = template.clone()
    w.isVisible = () => true
    w.visible = true
    w.isSelected = isSelected
    w.onClick = onClick
    return w
  }

  /** 从模板创建 ScrollItemWidget（带单击和双击处理）。
   *
   * OpenRA 对照: ScrollItemWidget.Setup(template, isSelected, onClick, onDoubleClick)
   *
   * @param template — 要克隆的模板 widget
   * @param isSelected — 选中状态委托
   * @param onClick — 单击回调
   * @param onDoubleClick — 双击回调
   * @returns 配置好的 ScrollItemWidget
   */
  static setupWithDoubleClick(
    template: ScrollItemWidget,
    isSelected: () => boolean,
    onClick: () => void,
    onDoubleClick: () => void,
  ): ScrollItemWidget {
    const w = ScrollItemWidget.setup(template, isSelected, onClick)
    w.onDoubleClick = onDoubleClick
    return w
  }

  /** 从模板创建带项目键的 ScrollItemWidget（带单击和双击处理）。
   *
   * OpenRA 对照: ScrollItemWidget.Setup(key, template, isSelected, onClick, onDoubleClick)
   *
   * @param key — 项目键（用于集合绑定）
   * @param template — 要克隆的模板 widget
   * @param isSelected — 选中状态委托
   * @param onClick — 单击回调
   * @param onDoubleClick — 双击回调
   * @returns 配置好的 ScrollItemWidget
   */
  static setupWithKey(
    key: string,
    template: ScrollItemWidget,
    isSelected: () => boolean,
    onClick: () => void,
    onDoubleClick: () => void,
  ): ScrollItemWidget {
    const w = ScrollItemWidget.setupWithDoubleClick(
      template,
      isSelected,
      onClick,
      onDoubleClick,
    )
    w.itemKey = key
    return w
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  /** 渲染滚动条目为 DOM 元素。
   *
   * 添加 data-selected 和 data-key 属性用于 CSS 样式设置。
   * 选中状态通过 data-selected="true" 反映。
   *
   * OpenRA 对照: ScrollItemWidget.Draw()
   */
  override render(): HTMLElement {
    const el = super.render()

    // 选中状态
    if (this.isSelected()) {
      el.setAttribute('data-selected', 'true')
    } else {
      el.removeAttribute('data-selected')
    }

    // 项目键
    if (this.itemKey) {
      el.setAttribute('data-key', this.itemKey)
    }

    // 启用/禁用子 widget 鼠标悬停
    // 注意: ignoreChildMouseOver 在 Widget 基类中设置
    // EnableChildMouseOver 在 initialize() 期间将 ignoreChildMouseOver 设置为相反值
    if (this.enableChildMouseOver) {
      el.setAttribute('data-enable-child-hover', 'true')
    }

    return el
  }
}
