/**
 * StrategicProgressWidget.ts — 战略胜利进度条 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/StrategicProgressWidget.cs (106 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.DrawSprite (ChromeProvider.GetImage) sprite 渲染
 *   → CSS background-color 分段指示器
 * - OpenRA SpriteFont.DrawTextWithContrast 文本渲染
 *   → CSS text-shadow 等效效果
 * - OpenRA Game.Renderer.Fonts["Bold"] + font.Measure → CSS font + canvas measureText
 * - OpenRA StrategicVictoryConditions 特性数据查找
 *   → 委托函数 getValue(), getLabel()（特性集成由外部提供）
 * - OpenRA int2 offset 累加 → CSS flexbox 流式布局
 * - OpenRA Player.RelationshipWith 盟友检测 → getColor() 委托基于阈值选择颜色
 *
 * NOTE: 原始 OpenRA StrategicProgressWidget 深度集成 StrategicVictoryConditions 特性
 * 和 World.Players 系统。本迁移版本提供简化实现，使用委托函数进行数据绑定，
 * 而非直接访问 game world。颜色阈值逻辑：高 → 绿色，中 → 黄色，低 → 红色。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// 颜色类型
// ---------------------------------------------------------------------------

/** 颜色接口（RGBA 数字值）。 */
export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/** CSS 颜色字符串。 */
type CssColor = string

/** 将 RgbaColor 转换为 CSS rgba 字符串。 */
function toCssColor(c: RgbaColor): CssColor {
  return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
}

// ---------------------------------------------------------------------------
// 默认颜色阈值
// ---------------------------------------------------------------------------

/** 值 >= 此阈值时显示绿色（接近胜利）。 */
const HIGH_THRESHOLD = 67

/** 值 >= 此阈值时显示黄色（进行中）。 */
const MEDIUM_THRESHOLD = 33

/** 低于此阈值显示红色（刚开始）。 */

/** 高进度颜色（绿色）。 */
const COLOR_HIGH: RgbaColor = { r: 76, g: 175, b: 80, a: 255 }

/** 中进度颜色（黄色/橙色）。 */
const COLOR_MEDIUM: RgbaColor = { r: 255, g: 193, b: 7, a: 255 }

/** 低进度颜色（红色）。 */
const COLOR_LOW: RgbaColor = { r: 244, g: 67, b: 54, a: 255 }

// ---------------------------------------------------------------------------
// 文本测量辅助
// ---------------------------------------------------------------------------

let _measureCanvas: HTMLCanvasElement | null = null
let _measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) {
    if (typeof document === 'undefined') return null
    if (!_measureCanvas) {
      _measureCanvas = document.createElement('canvas')
    }
    _measureCtx = _measureCanvas.getContext('2d')
  }
  return _measureCtx
}

/** 测量文本像素尺寸。 */
function measureText(
  text: string,
  font: string,
): { width: number; height: number } {
  const fontSizeMatch = font.match(/(\d+)px/)
  const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 14
  const lineHeight = fontSize * 1.2
  const ctx = getMeasureCtx()
  if (ctx) {
    ctx.font = font
    const metrics = ctx.measureText(text)
    return { width: metrics.width, height: lineHeight }
  }
  return { width: text.length * fontSize * 0.6, height: lineHeight }
}

// ---------------------------------------------------------------------------
// StrategicProgressWidget — 战略胜利进度条
// OpenRA 对照: public class StrategicProgressWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 战略胜利进度条 widget。
 *
 * 水平进度条，填充宽度与进度值成比例，居中显示文本标签。
 * 条填充颜色根据值自动选择：高(绿)、中(黄)、低(红)。
 *
 * OpenRA 对照: public class StrategicProgressWidget : Widget
 */
export class StrategicProgressWidget extends Widget {
  // ---- 配置属性 ----

  /** 字体 CSS 字符串。OpenRA 对照: "Bold" 字体查找 */
  font: string = 'bold 14px Arial'

  /** 文本颜色。OpenRA 对照: Color.White */
  textColor: string = '#ffffff'

  /** 文本对比色（暗）。OpenRA 对照: Color.Black */
  textContrastColor: string = '#000000'

  /** 文本对比半径（像素）。OpenRA 对照: 1 */
  contrastRadius: number = 1

  // ---- Func 委托 ----

  /** 获取进度值的委托（0-100%）。OpenRA 对照: 通过 StrategicVictoryConditions 计算 */
  getValue: () => number

  /** 获取显示标签的委托。OpenRA 对照: 格式化 "Strategic victory in ..." */
  getLabel: () => string

  // ---- 颜色阈值 ----

  /** 高进度阈值（>= 此值显示绿色）。 */
  highThreshold: number = HIGH_THRESHOLD

  /** 中进度阈值（>= 此值显示黄色，低于此值显示红色）。 */
  mediumThreshold: number = MEDIUM_THRESHOLD

  /** 高进度颜色。 */
  colorHigh: RgbaColor = { ...COLOR_HIGH }

  /** 中进度颜色。 */
  colorMedium: RgbaColor = { ...COLOR_MEDIUM }

  /** 低进度颜色。 */
  colorLow: RgbaColor = { ...COLOR_LOW }

  // ---- DOM 元素引用 ----

  /** 填充条元素。 */
  private _fillEl: HTMLElement | null = null

  /** 标签文本元素。 */
  private _labelEl: HTMLElement | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    this.getValue = () => 0
    this.getLabel = () => ''

    // 默认可见性
    this.isVisible = () => this.visible
  }

  // ---------------------------------------------------------------------------
  // Tick — 更新 DOM
  // ---------------------------------------------------------------------------

  /** 每帧更新进度和标签。 */
  override tick(): void {
    if (!this.visible) return
    this._updateDom()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: StrategicProgressWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染进度条为 DOM 元素。
   *
   * 结构：
   * - 外层容器（背景）
   * - 内层填充条（宽度随时间变化）
   * - 居中标签文本
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'strategic-progress-widget')
    el.style.position = 'absolute'
    el.style.overflow = 'hidden'
    el.style.boxSizing = 'border-box'
    el.style.background = '#1a1a2e'
    el.style.border = '1px solid #3a3a5e'
    el.style.borderRadius = '2px'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 创建填充条
    if (!this._fillEl) {
      this._fillEl = document.createElement('div')
      this._fillEl.className = 'strategic-progress-fill'
      this._fillEl.style.position = 'absolute'
      this._fillEl.style.top = '0'
      this._fillEl.style.left = '0'
      this._fillEl.style.height = '100%'
      this._fillEl.style.borderRadius = '1px'
      this._fillEl.style.transition = 'width 0.1s ease, background 0.3s ease'
      el.appendChild(this._fillEl)
    }

    // 创建标签文本
    if (!this._labelEl) {
      this._labelEl = document.createElement('div')
      this._labelEl.className = 'strategic-progress-label'
      this._labelEl.style.position = 'absolute'
      this._labelEl.style.inset = '0'
      this._labelEl.style.display = 'flex'
      this._labelEl.style.alignItems = 'center'
      this._labelEl.style.justifyContent = 'center'
      this._labelEl.style.font = this.font
      this._labelEl.style.pointerEvents = 'none' // 允许点击穿透到父级
      this._labelEl.style.zIndex = '1'
      el.appendChild(this._labelEl)
    }

    this._updateDom()

    return el
  }

  // ---------------------------------------------------------------------------
  // 内部: 更新 DOM 元素
  // ---------------------------------------------------------------------------

  /**
   * 更新填充条宽度、颜色和标签文本。
   *
   * 精确至整数像素宽度（匹配 OpenRA 规格）。
   */
  private _updateDom(): void {
    if (!this._fillEl || !this._labelEl) return

    const value = this.getValue()
    const clampedValue = Math.max(0, Math.min(100, value))

    const b = this.bounds

    // 条填充宽度（整数像素）
    const fillWidth = Math.round((clampedValue / 100) * b.width)

    this._fillEl.style.width = `${fillWidth}px`

    // 基于阈值选择颜色
    const color = this._getColorForValue(clampedValue)
    this._fillEl.style.background = toCssColor(color)

    // 标签文本
    const label = this.getLabel()
    this._labelEl.textContent = label
    this._labelEl.style.color = this.textColor
    this._labelEl.style.font = this.font

    // 文本对比效果（text-shadow）
    const r = this.contrastRadius
    this._labelEl.style.textShadow =
      `${r}px ${r}px 0 ${this.textContrastColor}, ` +
      `-${r}px -${r}px 0 ${this.textContrastColor}, ` +
      `${r}px -${r}px 0 ${this.textContrastColor}, ` +
      `-${r}px ${r}px 0 ${this.textContrastColor}`

    // 如果 BAR 宽度小于文本宽度，将文本颜色改为对比色以提高可读性
    const textSize = measureText(label, this.font)
    if (fillWidth < textSize.width + 8) {
      // 文本超出填充区域，使用对比色（在深色背景上可见）
      this._labelEl.style.color = '#e0e0e0'
    } else {
      this._labelEl.style.color = this.textColor
    }
  }

  // ---------------------------------------------------------------------------
  // 颜色选择
  // ---------------------------------------------------------------------------

  /**
   * 基于进度值选择条颜色。
   *
   * @param value — 进度值（0-100）
   * @returns 对应的 RgbaColor
   */
  private _getColorForValue(value: number): RgbaColor {
    if (value >= this.highThreshold) return this.colorHigh
    if (value >= this.mediumThreshold) return this.colorMedium
    return this.colorLow
  }

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 StrategicProgressWidget。
   */
  override clone(): StrategicProgressWidget {
    const s = new StrategicProgressWidget()
    s.copyFrom(this)
    return s
  }

  /**
   * 从另一个 StrategicProgressWidget 复制属性。
   */
  protected copyFrom(other: StrategicProgressWidget): void {
    this.font = other.font
    this.textColor = other.textColor
    this.textContrastColor = other.textContrastColor
    this.contrastRadius = other.contrastRadius
    this.getValue = other.getValue
    this.getLabel = other.getLabel
    this.highThreshold = other.highThreshold
    this.mediumThreshold = other.mediumThreshold
    this.colorHigh = { ...other.colorHigh }
    this.colorMedium = { ...other.colorMedium }
    this.colorLow = { ...other.colorLow }
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
    this._fillEl = null
    this._labelEl = null
    super.dispose()
  }
}
