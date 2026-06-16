/**
 * ProgressBarWidget.ts — 进度条 widget（确定/不确定模式）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ProgressBarWidget.cs (85 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.DrawPanel(Background, rb) → CSS background/border 实色背景
 * - OpenRA WidgetUtils.DrawPanel(Bar, barRect) → CSS 宽度百分比填充条
 * - OpenRA float offset + tickStep 不确定动画 → CSS animation 滑动渐变
 * - OpenRA ChromeProvider.GetMinimumPanelSize(Bar) → 可配置最小条宽度
 * - OpenRA BarMargin Size struct → 边距 CSS 内边距
 * - OpenRA Tick() 动画更新 → CSS @keyframes 动画（GPU 加速）
 *
 * NOTE: 不确定模式使用 CSS animation 实现滑动渐变效果（2s 周期），
 * 匹配 OpenRA 的 offset += tickStep; offset.Clamp(0,1); tickStep * -1 逻辑。
 * CSS animation 消除了每帧 JS tick 的需求，利用 GPU 合成。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// CSS 颜色辅助
// ---------------------------------------------------------------------------

/** 颜色接口（RGBA 数字值）。 */
export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/** CSS rgba 颜色字符串。 */
type CssColor = string

/** 将 RgbaColor 转换为 CSS rgba 字符串。 */
function toCssColor(c: RgbaColor): CssColor {
  return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
}

// ---------------------------------------------------------------------------
// ProgressBarWidget — 进度条
// OpenRA 对照: public class ProgressBarWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 进度条 widget。
 *
 * 支持两种模式：
 * - **确定模式**（Indeterminate = false）：填充条宽度与值（0-100）成比例
 * - **不确定模式**（Indeterminate = true）：滑动渐变条纹动画（2s 周期）
 *
 * OpenRA 对照: public class ProgressBarWidget : Widget
 */
export class ProgressBarWidget extends Widget {
  // ---- 背景/条 ChromeProvider 面板名称 ----

  /** 背景面板名称（ChromeProvider 键）。OpenRA 对照: Background */
  background: string = 'progressbar-bg'

  /** 条面板名称（ChromeProvider 键）。OpenRA 对照: Bar */
  bar: string = 'progressbar-thumb'

  /** 条边距（像素）。OpenRA 对照: BarMargin */
  barMargin: { width: number; height: number } = { width: 2, height: 2 }

  // ---- 值和模式 ----

  /** 进度百分比（0-100）。OpenRA 对照: Percentage */
  percentage: number = 0

  /** 是否为不确定模式。OpenRA 对照: Indeterminate */
  indeterminate: boolean = false

  // ---- Func 委托 ----

  /** 获取进度百分比的委托。OpenRA 对照: GetPercentage */
  getPercentage: () => number

  /** 判断是否为不确定模式的委托。OpenRA 对照: IsIndeterminate */
  isIndeterminate: () => boolean

  /** 获取条填充颜色的委托。OpenRA 对照: GetColor（web 扩展，C# 使用固定颜色） */
  getBarColor: () => RgbaColor

  // ---- 不确定模式动画状态 ----

  /** 动画偏移量。OpenRA 对照: offset */
  private _offset: number = 0

  /** 每 tick 步进值。OpenRA 对照: tickStep */
  private _tickStep: number = 0.04

  /** 前一个 tick 是否为不确定模式。OpenRA 对照: wasIndeterminate */
  private _wasIndeterminate: boolean = false

  // ---- DOM 元素引用 ----

  /** 条填充元素。 */
  private _barEl: HTMLElement | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: public ProgressBarWidget() + protected ProgressBarWidget(ProgressBarWidget)
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // 默认委托
    this.getPercentage = () => this.percentage
    this.isIndeterminate = () => this.indeterminate
    this.getBarColor = () => ({ r: 76, g: 175, b: 80, a: 255 })
  }

  // ---------------------------------------------------------------------------
  // Tick — 不确定模式动画更新
  // OpenRA 对照: public override void Tick()
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新不确定模式动画。
   *
   * OpenRA 对照: ProgressBarWidget.Tick()
   *
   * 逻辑等价于：
   * 1. 检测 Indeterminate 状态切换 → 重置 offset
   * 2. 不确定模式时：offset += tickStep; offset = Clamp(0, 1)
   * 3. offset == 0 || offset == 1 时反转 tickStep
   * 4. 更新 DOM 条元素位置/样式
   */
  override tick(): void {
    if (!this.visible) return

    const indeterminate = this.isIndeterminate()

    // 状态切换时重置
    if (indeterminate !== this._wasIndeterminate) {
      this._offset = 0
    }

    if (indeterminate) {
      this._offset += this._tickStep
      // 限制到 [0, 1]
      if (this._offset < 0) this._offset = 0
      if (this._offset > 1) this._offset = 1
      // 端点反转
      if (this._offset <= 0 || this._offset >= 1) {
        this._tickStep *= -1
      }
    }

    this._wasIndeterminate = indeterminate

    // 更新 DOM
    this._updateBarDom()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: ProgressBarWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染进度条为 DOM 元素。
   *
   * 使用两个嵌套 div 实现：外层为背景，内层为填充条。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'progress-bar-widget')
    el.style.position = 'absolute'
    el.style.overflow = 'hidden'
    el.style.boxSizing = 'border-box'
    el.style.background = '#1a1a2e'
    el.style.border = '1px solid #3a3a5e'
    el.style.borderRadius = '2px'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }
    el.setAttribute('data-background', this.background)

    // 创建条填充元素
    if (!this._barEl) {
      this._barEl = document.createElement('div')
      this._barEl.className = 'progress-bar-fill'
      this._barEl.style.position = 'absolute'
      this._barEl.style.height = '100%'
      this._barEl.style.top = '0'
      this._barEl.style.left = '0'
      this._barEl.style.borderRadius = '1px'
      this._barEl.style.transition = 'width 0.05s linear' // 平滑宽度过渡用于确定模式
      el.appendChild(this._barEl)
    }
    el.setAttribute('data-bar', this.bar)

    // 初始更新
    this._updateBarDom()

    return el
  }

  // ---------------------------------------------------------------------------
  // 内部: 更新条 DOM 元素
  // ---------------------------------------------------------------------------

  /**
   * 根据当前模式和值更新条元素的位置、尺寸和样式。
   *
   * 确定模式：barWidth = percentage * maxBarWidth / 100
   * 不确定模式：barWidth = maxBarWidth / 4, barOffset = 0.75 * offset * maxBarWidth
   */
  private _updateBarDom(): void {
    if (!this._barEl) return

    const rb = this.bounds
    const maxBarWidth = rb.width - this.barMargin.width * 2
    const minBarWidth = 16 // 最小条宽度（匹配典型的 ChromeProvider 最小面板尺寸）

    const indeterminate = this.isIndeterminate()
    const percentage = this.getPercentage()

    let barWidth: number
    let barOffset: number

    if (indeterminate) {
      barWidth = Math.max(maxBarWidth / 4, minBarWidth)
      barOffset = Math.round(0.75 * this._offset * maxBarWidth)
    } else {
      barWidth = Math.max(
        Math.round((percentage * maxBarWidth) / 100),
        minBarWidth,
      )
      barOffset = 0
      // 确定模式下不使用 slider 动画
    }

    const color = this.getBarColor()
    const cssColor = toCssColor(color)

    this._barEl.style.left = `${this.barMargin.width + barOffset}px`
    this._barEl.style.top = `${this.barMargin.height}px`
    this._barEl.style.width = `${barWidth}px`
    this._barEl.style.height = `${rb.height - 2 * this.barMargin.height}px`
    this._barEl.style.background = indeterminate
      ? `linear-gradient(90deg, transparent 0%, ${cssColor} 50%, transparent 100%)`
      : cssColor

    if (indeterminate) {
      // 不确定模式：使用 CSS animation 实现滑动渐变
      this._barEl.style.transition = 'none'
      this._barEl.style.animation =
        'progressbar-slide 2s ease-in-out infinite'
    } else {
      this._barEl.style.animation = 'none'
      this._barEl.style.transition = 'width 0.05s linear'
    }
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override ProgressBarWidget Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 ProgressBarWidget。
   *
   * OpenRA 对照: public override ProgressBarWidget Clone() {
   *   return new ProgressBarWidget(this); }
   */
  override clone(): ProgressBarWidget {
    const b = new ProgressBarWidget()
    b.copyFrom(this)
    return b
  }

  /**
   * 从另一个 ProgressBarWidget 复制属性。
   *
   * OpenRA 对照: protected ProgressBarWidget(ProgressBarWidget other) : base(other)
   */
  protected copyFrom(other: ProgressBarWidget): void {
    this.percentage = other.percentage
    this.getPercentage = other.getPercentage
    this.getBarColor = other.getBarColor
    this.isIndeterminate = other.isIndeterminate
    this.indeterminate = other.indeterminate
    this.background = other.background
    this.bar = other.bar
    this.barMargin = { ...other.barMargin }
    this.id = other.id
    this._xExpr = other._xExpr
    this._yExpr = other._yExpr
    this._widthExpr = other._widthExpr
    this._heightExpr = other._heightExpr
    this.logic = [...other.logic]
    this.visible = other.visible
    this.ignoreMouseOver = other.ignoreMouseOver
    this.ignoreChildMouseOver = other.ignoreChildMouseOver
    this.isVisible = other.isVisible
    this.bounds = { ...other.bounds }
    for (const child of other.children) {
      this.addChild(child.clone())
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /** 清理资源。 */
  override dispose(): void {
    if ((this as unknown as { _disposed?: boolean })._disposed) return
    this._barEl = null
    super.dispose()
  }
}

// ---------------------------------------------------------------------------
// 注入全局 CSS 关键帧动画（仅一次）
// 用于不确定模式的滑动渐变效果
// ---------------------------------------------------------------------------

let _cssInjected = false

/** 注入进度条动画 CSS（仅调用一次）。 */
function injectProgressBarCss(): void {
  if (_cssInjected) return
  _cssInjected = true

  if (typeof document === 'undefined') return

  const style = document.createElement('style')
  style.textContent = `
    @keyframes progressbar-slide {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .progress-bar-fill[style*="animation: progressbar-slide"] {
      background-size: 200% 100%;
      background-repeat: no-repeat;
    }
  `
  document.head.appendChild(style)
}

// 在模块加载时注入
injectProgressBarCss()
