/**
 * LabelForInputWidget.ts — 关联输入控件的标签 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LabelForInputWidget.cs (48 lines)
 *
 * 核心范式转换:
 * - C# LabelWidget + Lazy<InputWidget> 关联查找 → TypeScript DOM 查找 + label[for] 属性
 * - C# font.DrawText(text, position, textColor.Update(inputWidget.Value.IsDisabled()))
 *     → TypeScript CSS color 切换 (基于关联 input 的禁用状态)
 * - C# click → 转移焦点到关联 input → DOM click → input.focus()
 * - C# Exts.Lazy(() => Parent.Get<InputWidget>(For)) → TypeScript 延迟查找
 * - C# CachedTransform<bool, Color> textColor → TypeScript getter 动态颜色
 *
 * 无障碍模式: 点击标签自动聚焦关联的输入控件。
 */

import { LabelWidget } from './LabelWidget.js'
import type { Color } from './LabelWidget.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'

// ---------------------------------------------------------------------------
// InputWidget 最小接口 — 用于查找关联的输入控件
// ---------------------------------------------------------------------------

/**
 * 关联输入控件的最小接口。
 * 仅暴露 LabelForInputWidget 所需的方法。
 */
export interface IInputWidgetRef {
  /** 是否禁用。 */
  isDisabled(): boolean
  /** 获取键盘焦点。 */
  focus(): void
}

// ---------------------------------------------------------------------------
// LabelForInputWidget — 关联输入控件的标签
// OpenRA 对照: public class LabelForInputWidget : LabelWidget
// ---------------------------------------------------------------------------

/**
 * 关联输入控件的标签 widget。
 *
 * 点击标签时自动聚焦关联的输入控件。
 * 文本颜色根据关联输入控件的禁用状态动态切换。
 *
 * OpenRA 对照: LabelForInputWidget
 */
export class LabelForInputWidget extends LabelWidget {
  /** 关联的输入控件 ID。OpenRA 对照: LabelForInputWidget.For */
  for: string | null = null

  /** 禁用状态文本颜色。OpenRA 对照: LabelForInputWidget.TextDisabledColor */
  textDisabledColor: Color = '#888888'

  /** 关联输入控件的查找函数（延迟初始化）。
   *
   * OpenRA 对照: Exts.Lazy(() => Parent.Get<InputWidget>(For))
   */
  private _inputWidgetResolver: (() => IInputWidgetRef | null) | null = null

  /** 缓存的关联输入控件实例。 */
  private _inputWidgetCache: IInputWidgetRef | null = null

  /** 关联输入控件是否已创建。 */
  private _inputWidgetCreated: boolean = false

  // ---- ChromeMetrics 默认键 ----

  static readonly DEFAULT_DISABLED_COLOR_KEY = 'TextDisabledColor'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: LabelForInputWidget(ModData) / LabelForInputWidget(LabelForInputWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 LabelForInputWidget。
   *
   * OpenRA 对照: public LabelForInputWidget(ModData modData) : base(modData)
   */
  constructor(_modData?: unknown) {
    super(_modData)

    // 从 ChromeMetrics 加载默认禁用颜色
    try {
      const color = ChromeMetrics.tryGet<string>(
        LabelForInputWidget.DEFAULT_DISABLED_COLOR_KEY,
      )
      if (color) this.textDisabledColor = color as string
    } catch {
      /* graceful */
    }
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected LabelForInputWidget(LabelForInputWidget other) : base(other)
   */
  protected copyFrom(other: LabelForInputWidget): void {
    super.copyFrom(other)
    this.for = other.for
    this.textDisabledColor = other.textDisabledColor

    // 重置 Lazy 状态
    this._inputWidgetCreated = false
    this._inputWidgetCache = null
  }

  // ---------------------------------------------------------------------------
  // InputWidget 延迟查找
  // OpenRA 对照: Exts.Lazy(() => Parent.Get<InputWidget>(For))
  // ---------------------------------------------------------------------------

  /**
   * 获取关联的输入控件（延迟初始化，首次访问时调用工厂函数）。
   *
   * OpenRA 对照: Lazy<InputWidget>.Value
   */
  get inputWidget(): IInputWidgetRef | null {
    if (!this._inputWidgetCreated) {
      this._inputWidgetCreated = true
      if (this._inputWidgetResolver) {
        this._inputWidgetCache = this._inputWidgetResolver()
      }
    }
    return this._inputWidgetCache
  }

  /**
   * 设置关联输入控件的查找函数。
   *
   * 模拟 OpenRA 的 `Exts.Lazy(() => Parent.Get<InputWidget>(For))`。
   */
  setInputWidgetResolver(resolver: () => IInputWidgetRef | null): void {
    this._inputWidgetResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // 有效文本颜色 — 根据关联 input 的禁用状态选择
  // OpenRA 对照: textColor.Update(inputWidget.Value.IsDisabled())
  // ---------------------------------------------------------------------------

  /**
   * 根据关联输入控件的状态获取文本颜色。
   *
   * OpenRA 对照: textColor.Update(inputWidget.Value.IsDisabled())
   */
  getEffectiveColor(): Color {
    const input = this.inputWidget
    if (input && input.isDisabled()) {
      return this.textDisabledColor
    }
    return this.textColor
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: protected override void DrawInner(string text, SpriteFont font, Color color, int2 position)
  // ---------------------------------------------------------------------------

  /**
   * 渲染关联输入控件的标签。
   *
   * OpenRA 对照: DrawInner — 使用有效颜色渲染文本
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'label-for-input-widget')

    // Set base styles before early return
    el.style.position = 'absolute'
    el.style.boxSizing = 'border-box'
    el.style.userSelect = 'none'
    el.style.cursor = 'pointer' // 可点击聚焦关联输入

    const text = this.getText()
    if (text === null) {
      el.textContent = ''
      return el
    }

    const color = this.getEffectiveColor()

    // Text-specific styles
    el.style.font = this.font
    el.style.color = color
    el.style.textShadow = this._computeTextShadowForInput()
    el.style.whiteSpace = this.wordWrap ? 'pre-wrap' : 'pre'
    el.style.overflow = 'hidden'
    el.style.textOverflow = 'ellipsis'

    // 对齐
    switch (this.align) {
      case 'Center':
        el.style.textAlign = 'center'
        break
      case 'Right':
        el.style.textAlign = 'right'
        break
      default:
        el.style.textAlign = 'left'
    }

    // 换行
    if (this.wordWrap) {
      el.style.wordWrap = 'break-word'
      el.style.overflowWrap = 'break-word'
    }

    // 填写文本内容
    el.textContent = text

    return el
  }

  /**
   * 生成 text-shadow（复用父类逻辑）。
   */
  private _computeTextShadowForInput(): string {
    const r = this.contrastRadius

    if (this.contrast) {
      const bgDark = this.getContrastColorDark()
      const bgLight = this.getContrastColorLight()
      return [
        `-${r}px -${r}px 0 ${bgDark}`,
        `${r}px -${r}px 0 ${bgLight}`,
        `${r}px ${r}px 0 ${bgDark}`,
        `-${r}px ${r}px 0 ${bgLight}`,
      ].join(', ')
    }

    if (this.shadow) {
      const bgDark = this.getContrastColorDark()
      const offset = Math.max(r, 1)
      return `${offset}px ${offset}px 0 ${bgDark}`
    }

    return 'none'
  }

  // ---------------------------------------------------------------------------
  // Event handling — 点击聚焦关联 input
  // OpenRA 对照: 无显式 handleEvent (通过 widget 树查找 + 自动 focus 链路)
  // ---------------------------------------------------------------------------

  /**
   * 点击标签时聚焦关联的输入控件。
   *
   * OpenRA 对照: 点击标签自然聚焦关联 input (DOM label[for] 语义)
   */
  override handleEvent(event: import('../../OpenRA.Game/Widgets/Widget.js').WidgetEvent): boolean {
    if (event.type === 'click' || event.type === 'mousedown') {
      const input = this.inputWidget
      if (input && !input.isDisabled()) {
        input.focus()
        return true
      }
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override LabelForInputWidget Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 LabelForInputWidget。
   *
   * OpenRA 对照: public override LabelForInputWidget Clone()
   */
  override clone(): LabelForInputWidget {
    const w = new LabelForInputWidget()
    w.copyFrom(this)
    w.id = this.id
    w._xExpr = this._xExpr
    w._yExpr = this._yExpr
    w._widthExpr = this._widthExpr
    w._heightExpr = this._heightExpr
    w.logic = [...this.logic]
    w.visible = this.visible
    w.bounds = { ...this.bounds }
    return w
  }
}
