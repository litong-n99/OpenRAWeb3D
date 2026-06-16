/**
 * CheckboxWidget.ts — 复选框 widget（带文本标签 + 勾选标记）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/CheckboxWidget.cs (90 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawText() + WidgetUtils.DrawSprite(checkmark)
 *   → CSS font + DOM 文本标签 + CSS 勾选标记（::before / ::after 伪元素）
 * - C# ChromeProvider.GetImage("checkmark-{type}", "checked"/"unchecked")
 *   → CSS data-checked 属性控制勾选标记可见性
 * - C# CachedTransform 双重缓存 (checkmarkType×checked, then state)
 *   → 简单 DOM 属性更新（不需要图像查找缓存）
 * - C# HandleKeyPress(KeyInput) + HotkeyReference → DOM keydown + Space/Enter
 * - C# CheckboxWidget 不自动切换；ChromeLogic 设置 OnClick
 *   → 我们添加内置切换行为（DOM 复选框标准行为），通过 toggleOnClick 属性控制
 * - C# ButtonWidget.Draw() + 额外 checkmark → render() 重写，在按钮内容上方叠加勾选元素
 */

import { ButtonWidget } from './ButtonWidget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'

// ---------------------------------------------------------------------------
// CheckboxWidget — 复选框
// OpenRA 对照: public class CheckboxWidget : ButtonWidget
// ---------------------------------------------------------------------------

/**
 * 复选框 widget — 带文本标签的可切换布尔状态控件。
 *
 * 支持：
 * - 可切换值（GetValue / SetValue 委托，默认使用内部 _value 字段）
 * - 勾选标记精灵（checkmark 名称 + 状态感知图像查找）
 * - 鼠标/键盘交互（点击切换，Space/Enter 切换）
 * - 四种视觉状态：未选中、已选中、禁用-未选中、禁用-已选中
 * - 与 ButtonWidget 相同的文本渲染和工具提示支持
 *
 * OpenRA 对照: public class CheckboxWidget : ButtonWidget
 */
export class CheckboxWidget extends ButtonWidget {
  // ---------------------------------------------------------------------------
  // Properties — OpenRA 对照: CheckboxWidget 字段
  // ---------------------------------------------------------------------------

  /** 内部值（当未提供 SetValue/GetValue 委托时使用）。
   * OpenRA 对照: 隐式（通过 IsChecked() 查询 ChromeLogic 状态） */
  private _value: boolean = false

  /** 获取当前复选值的委托。OpenRA 对照: 无（使用 IsChecked） */
  getValue: () => boolean

  /** 设置当前复选值的委托。OpenRA 对照: 无（ChromeLogic 处理） */
  setValue: (v: boolean) => void

  /** 勾选标记图像名称（ChromeProvider 集合）。
   * OpenRA 对照: CheckboxWidget.Checkmark ("tick") */
  checkmark: string = 'tick'

  /** 获取勾选标记类型的委托。
   * OpenRA 对照: CheckboxWidget.GetCheckmark */
  getCheckmark: () => string

  /** 获取当前复选状态的委托。
   * OpenRA 对照: CheckboxWidget.IsChecked */
  isChecked: () => boolean

  /** 是否在点击时自动切换值。默认为 true（DOM 复选框标准行为）。
   *
   * 如果设置为 false，则必须通过 OnClick 委托手动切换。
   * NOTE: OpenRA 原始行为为 false（ChromeLogic 负责切换），
   * 但 DOM 约定启用自动切换以匹配原生复选框行为。
   */
  toggleOnClick: boolean = true

  // ---- 静态默认键 ----

  static readonly DEFAULT_CHECKBOX_BACKGROUND_KEY = 'CheckboxBackground'
  static readonly DEFAULT_CHECKMARK_KEY = 'CheckboxCheckmark'
  static readonly DEFAULT_CHECKMARK_TYPE_KEY = 'CheckboxCheckmarkType'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: CheckboxWidget(ModData) / CheckboxWidget(CheckboxWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 CheckboxWidget。
   *
   * OpenRA 对照: public CheckboxWidget(ModData modData) : base(modData)
   *
   * 从 ChromeMetrics 加载默认值，初始化委托。
   */
  constructor() {
    super()

    // 默认复选框背景名称（与普通按钮不同）
    this.background = 'checkbox'

    // 委托初始化
    this.getValue = () => this._value
    this.setValue = (v: boolean) => {
      this._value = v
    }
    this.getCheckmark = () => this.checkmark
    this.isChecked = () => this.getValue()

    // OpenRA: TextColor / TextColorDisabled 从 ChromeMetrics 加载
    // 这些已在 ButtonWidget 构造函数中加载，但复选框可能使用不同键。
    // 我们保留基类的默认值，然后从复选框特定的键覆盖。
    this._loadCheckboxDefaults()

    // 设置默认 OnClick 为切换（DOM 复选框行为）
    this.onClick = () => {
      if (this.toggleOnClick) {
        this.toggle()
      }
    }
  }

  /**
   * 从 ChromeMetrics 加载复选框特定的默认值。
   */
  private _loadCheckboxDefaults(): void {
    try {
      const bg = ChromeMetrics.tryGet<string>(
        CheckboxWidget.DEFAULT_CHECKBOX_BACKGROUND_KEY,
      )
      if (bg) this.background = bg as string
    } catch { /* graceful degradation */ }

    try {
      const ck = ChromeMetrics.tryGet<string>(
        CheckboxWidget.DEFAULT_CHECKMARK_KEY,
      )
      if (ck) this.checkmark = ck as string
    } catch { /* graceful degradation */ }
  }

  // ---------------------------------------------------------------------------
  // Toggle behavior
  // ---------------------------------------------------------------------------

  /** 切换复选状态。
   *
   * 读取当前值，翻转为相反值，然后写入。
   * 如果未禁用，还会触发 OnChange（如果设置了的话）。
   *
   * OpenRA 对照: ChromeLogic 中的 IsChecked / SetValue 模式
   */
  toggle(): void {
    if (this.isDisabled()) return

    const current = this.getValue()
    this.setValue(!current)

    // 触发 onChange 回调（如果设置）
    if (this.onCheckboxChange) {
      this.onCheckboxChange(!current)
    }
  }

  /** 复选状态变更回调（DOM 扩展 — OpenRA 使用 ChromeLogic）。
   *
   * 在值通过 toggle() 更改后调用。
   * 设置此属性以监听复选状态更改。
   */
  onCheckboxChange: ((checked: boolean) => void) | null = null

  // ---------------------------------------------------------------------------
  // 复制构造函数支持
  // OpenRA 对照: protected CheckboxWidget(CheckboxWidget other) : base(other)
  // ---------------------------------------------------------------------------

  /**
   * 从另一个 CheckboxWidget 复制属性。
   *
   * OpenRA 对照: protected CheckboxWidget(CheckboxWidget other)
   */
  protected copyCheckboxFrom(other: CheckboxWidget): void {
    this._value = other._value
    this.getValue = other.getValue
    this.setValue = other.setValue
    this.checkmark = other.checkmark
    this.getCheckmark = other.getCheckmark
    this.isChecked = other.isChecked
    this.toggleOnClick = other.toggleOnClick
    this.onCheckboxChange = other.onCheckboxChange
  }

  // ---------------------------------------------------------------------------
  // Event handling — 键盘 Space/Enter 切换
  // OpenRA 对照: 隐式通过 base.HandleKeyPress → OnKeyPress → OnClick
  // ---------------------------------------------------------------------------

  /**
   * 处理事件 — 添加 Space/Enter 键盘切换支持。
   *
   * OpenRA 对照: 基类 ButtonWidget.HandleKeyPress(KeyInput)
   *
   * 基类 ButtonWidget 已通过 Hotkey 系统处理键盘输入。
   * 这里添加额外处理：如果未设置热键，Space/Enter 可切换复选框。
   */
  override handleEvent(event: WidgetEvent): boolean {
    // 键盘 Space/Enter 切换
    if (event.type === 'keydown') {
      const key = event.key || ''
      if (key === ' ' || key === 'Enter') {
        if (!this.isDisabled()) {
          this.toggle()
          return true
        }
      }
      // 回退到基类处理（可能触发 OnKeyPress → OnClick）
      return super.handleEvent(event)
    }

    // 鼠标事件委托给基类
    return super.handleEvent(event)
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: CheckboxWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染复选框为 DOM 元素。
   *
   * 继承 ButtonWidget 的渲染（背景 + 文本），
   * 额外添加勾选标记指示器。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    // 调用基类渲染（处理背景、文本、子 widget）
    const el = super.render()

    // 添加 data-checked 属性用于 CSS 样式
    const checked = this.isChecked()
    el.setAttribute('data-checked', checked ? 'true' : 'false')

    // 添加复选框特定的 CSS 类
    el.classList.add('checkbox-widget')

    // 渲染勾选标记元素
    this._renderCheckmark(el, checked)

    return el
  }

  /**
   * 渲染勾选标记指示器。
   *
   * OpenRA 对照:
   *   var checkmarkImage = getCheckmarkImageCache
   *     .Update((GetCheckmark(), IsChecked()))
   *     .Update((disabled, Depressed, hover, false, IsHighlighted()));
   *   WidgetUtils.DrawSprite(checkmarkImage, position)
   *
   * 迁移方案：
   * 使用 CSS 伪元素样式或内联 SVG 模拟勾选标记。
   * 勾选标记在复选框左侧（或根据布局方向）显示。
   * 使用 data-checked 属性在 CSS 中切换 checked/unchecked 状态。
   */
  private _renderCheckmark(el: HTMLElement, checked: boolean): void {
    // 移除旧的勾选标记元素
    const oldMark = el.querySelector('[data-checkbox-mark]')
    if (oldMark) oldMark.remove()

    const disabled = this.isDisabled()

    // 创建勾选标记容器
    const markEl = document.createElement('span')
    markEl.setAttribute('data-checkbox-mark', 'true')
    markEl.setAttribute('data-checked', checked ? 'true' : 'false')
    markEl.setAttribute('data-disabled', disabled ? 'true' : 'false')

    // 存为自定义属性以在 CSS 中使用
    const checkmarkType = this.getCheckmark()
    markEl.setAttribute('data-checkmark-type', checkmarkType)

    // 勾选标记尺寸: 与按钮高度相同（匹配 OpenRA 的 rect.Height）
    markEl.style.position = 'absolute'
    markEl.style.left = '0'
    markEl.style.top = '0'
    markEl.style.width = `${el.offsetHeight || 24}px`
    markEl.style.height = '100%'
    markEl.style.display = 'flex'
    markEl.style.alignItems = 'center'
    markEl.style.justifyContent = 'center'
    markEl.style.pointerEvents = 'none'
    markEl.style.fontSize = `${(el.offsetHeight || 24) * 0.6}px`

    // 勾选标记颜色
    if (disabled) {
      markEl.style.color = '#666666'
      markEl.style.opacity = '0.5'
    } else if (checked) {
      markEl.style.color = '#FFFFFF'
      markEl.style.opacity = '1'
    } else {
      markEl.style.color = '#999999'
      markEl.style.opacity = '0.3'
    }

    // 使用 Unicode 字符作为勾选标记
    // OpenRA C#: WidgetUtils.DrawSprite(checkmarkImage, position)
    // 勾选标记名称通过 ChromeProvider 查找状态感知图像:
    //   "checkmark-{type}-checked" / "checkmark-{type}-unchecked"
    // 各状态下带后缀: -disabled, -pressed, -hover
    //
    // 迁移方案：使用 CSS content 属性 + data 属性控制视觉外观。
    // 实际图像可通过 ChromeProvider CSS 变量注入。
    markEl.textContent = checked ? '✓' : ''

    // 如果未选中但鼠标悬停，显示浅色勾选轮廓
    if (!checked && !disabled) {
      const hovered = markEl.closest('[data-state="hover"]')
      if (hovered) {
        markEl.style.opacity = '0.15'
        markEl.textContent = '✓'
      }
    }

    el.appendChild(markEl)

    // 调整文本内边距以容纳勾选标记
    // OpenRA: textPosition = (Bounds.Left + Bounds.Height * 1.5f, ...)
    const textSpan = el.querySelector('[data-button-text]') as HTMLElement | null
    if (textSpan) {
      const checkSize = el.offsetHeight || 24
      textSpan.style.paddingLeft = `${checkSize * 1.5}px`
    }
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: CheckboxWidget.Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 CheckboxWidget。
   *
   * OpenRA 对照: public override CheckboxWidget Clone()
   */
  override clone(): CheckboxWidget {
    const c = new CheckboxWidget()
    c.copyFrom(this)
    c.copyCheckboxFrom(this)
    c.id = this.id
    c._xExpr = this._xExpr
    c._yExpr = this._yExpr
    c._widthExpr = this._widthExpr
    c._heightExpr = this._heightExpr
    c.logic = [...this.logic]
    c.visible = this.visible
    c.ignoreMouseOver = this.ignoreMouseOver
    c.ignoreChildMouseOver = this.ignoreChildMouseOver
    c.isVisible = this.isVisible
    c.isDisabled = this.isDisabled
    c.bounds = { ...this.bounds }
    for (const child of this.children) {
      c.addChild(child.clone())
    }
    return c
  }
}
