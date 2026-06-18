/**
 * LabelWidget.ts — 非交互式文本标签 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LabelWidget.cs (132 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawText() (SDL bitmap 渲染) → CSS font + text-align (DOM 渲染)
 * - C# SpriteFont.DrawTextWithContrast/Shadow → CSS text-shadow 属性
 * - C# Font.Measure() → Canvas 2D measureText() (文本大小测量)
 * - C# Color 结构体 → CSS 颜色字符串
 * - C# Func<string> GetText 等委托 → TypeScript () => string 函数
 * - C# CachedTransform (Fluent 文本缓存) → 简单函数闭包
 * - C# RenderOrigin → bounds.x/y 作为 DOM 定位
 * - C# int2 偏移计算 → CSS flexbox + padding 调整
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import { TextAlign, TextVAlign } from './TextAlign.js'

// ---------------------------------------------------------------------------
// Color type alias — CSS 颜色字符串
// OpenRA 对照: OpenRA.Primitives.Color (32-bit ARGB struct)
// ---------------------------------------------------------------------------

/** CSS 颜色字符串类型（迁移后使用 CSS 颜色表示）。
 *
 * OpenRA 对照: OpenRA.Primitives.Color
 * 支持格式: "#RRGGBB", "#RRGGBBAA", "rgb(r,g,b)", "rgba(r,g,b,a)", 命名颜色
 */
export type Color = string

// ---------------------------------------------------------------------------
// Text measurement helper
// ---------------------------------------------------------------------------

/** 文本测量缓存。避免创建过多 canvas 元素。 */
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

/** 使用 Canvas 2D 测量文本尺寸（如果可用），否则使用字体大小估算。
 *
 * OpenRA 对照: SpriteFont.Measure(string) → int2
 *
 * @param text — 要测量的文本
 * @param font — CSS font 字符串（如 "16px Arial"）
 * @returns { width: number; height: number } 文本边界框
 */
function measureText(
  text: string,
  font: string,
): { width: number; height: number } {
  const fontSizeMatch = font.match(/(\d+)px/)
  const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 16
  const lineHeight = fontSize * 1.2 // 默认行高 ~1.2

  const ctx = getMeasureCtx()
  if (ctx) {
    ctx.font = font
    const metrics = ctx.measureText(text)
    return { width: metrics.width, height: lineHeight }
  }

  // Canvas 不可用时的回退（happy-dom 等环境）: 使用近似字符宽度
  // 等宽字体每个字符约 fontSize * 0.6；比例字体约 fontSize * 0.55
  const avgCharWidth = fontSize * 0.6
  return { width: text.length * avgCharWidth, height: lineHeight }
}

// ---------------------------------------------------------------------------
// wordWrap — 文本换行
// 对应 OpenRA WidgetUtils.WrapText
// ---------------------------------------------------------------------------

/** 将文本按指定宽度换行。
 *
 * OpenRA 对照: WidgetUtils.WrapText(string, int, SpriteFont)
 *
 * DOM 渲染使用 CSS `word-wrap: break-word`，但此方法用于
 * IncreaseHeightToFitCurrentText 中的高度计算。
 *
 * @param text — 待换行文本
 * @param maxWidth — 最大宽度（像素）
 * @param font — CSS font 字符串
 * @returns 换行后的文本（带 \n 字符）
 */
function wordWrap(text: string, maxWidth: number, font: string): string {
  if (!text || maxWidth <= 0) return text

  const ctx = getMeasureCtx()

  // Canvas 不可用时的回退: 按字符数估算换行
  if (!ctx) {
    const fontSizeMatch = font.match(/(\d+)px/)
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 16
    const avgCharWidth = fontSize * 0.6
    const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth))
    const words = text.split(/(?<=\s)/)
    const lines: string[] = []
    let currentLine = ''
    for (const word of words) {
      if (currentLine.length + word.length > charsPerLine && currentLine.length > 0) {
        lines.push(currentLine.trimEnd())
        currentLine = word.trimStart()
      } else {
        currentLine += word
      }
    }
    if (currentLine.trim().length > 0) {
      lines.push(currentLine.trim())
    }
    return lines.join('\n') || text
  }

  ctx.font = font

  const words = text.split(/(?<=\s)/) // 在空格后分割（保留空格）
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine + word
    if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine.trimEnd())
      currentLine = word.trimStart()
    } else {
      currentLine = testLine
    }
  }
  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trim())
  }

  return lines.join('\n') || text
}

// ---------------------------------------------------------------------------
// LabelWidget — 非交互式文本标签
// OpenRA 对照: LabelWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 非交互式文本标签 widget。
 *
 * 在 DOM 中渲染为具有 CSS 字体、颜色、对齐和文本阴影样式的 `<div>` 元素。
 * 不支持用户交互；不消耗鼠标或键盘事件。
 *
 * OpenRA 对照: public class LabelWidget : Widget
 */
export class LabelWidget extends Widget {
  // ---- 文本属性 ----

  /** 要显示的文本（可为 null，null 时不渲染）。OpenRA 对照: LabelWidget.Text */
  text: string | null = null

  /** 水平对齐方式。OpenRA 对照: LabelWidget.Align */
  align: TextAlign = TextAlign.Left

  /** 垂直对齐方式。OpenRA 对照: LabelWidget.VAlign */
  vAlign: TextVAlign = TextVAlign.Middle

  /** CSS font 字符串。OpenRA 对照: LabelWidget.Font (string) */
  font: string = '16px Arial'

  /** 文本颜色（CSS 字符串）。OpenRA 对照: LabelWidget.TextColor (Color) */
  textColor: Color = '#FFFFFF'

  /** 是否使用对比色文字效果。OpenRA 对照: LabelWidget.Contrast */
  contrast: boolean = false

  /** 是否使用文字阴影。OpenRA 对照: LabelWidget.Shadow */
  shadow: boolean = false

  /** 对比色-暗。OpenRA 对照: LabelWidget.ContrastColorDark */
  contrastColorDark: Color = '#000000'

  /** 对比色-亮。OpenRA 对照: LabelWidget.ContrastColorLight */
  contrastColorLight: Color = '#000000'

  /** 对比半径（阴影偏移像素）。OpenRA 对照: LabelWidget.ContrastRadius */
  contrastRadius: number = 1

  /** 是否自动换行。OpenRA 对照: LabelWidget.WordWrap */
  wordWrap: boolean = false

  // ---- Func 委托 ----
  // OpenRA 对照: Func<string> GetText, Func<Color> GetColor,
  //              Func<Color> GetContrastColorDark, Func<Color> GetContrastColorLight

  /** 获取显示文本的委托。OpenRA 对照: LabelWidget.GetText */
  getText: () => string | null

  /** 获取文本颜色的委托。OpenRA 对照: LabelWidget.GetColor */
  getColor: () => Color

  /** 获取对比色-暗的委托。OpenRA 对照: LabelWidget.GetContrastColorDark */
  getContrastColorDark: () => Color

  /** 获取对比色-亮的委托。OpenRA 对照: LabelWidget.GetContrastColorLight */
  getContrastColorLight: () => Color

  // ---- ChromeMetrics 默认键 ----
  // OpenRA 在字段声明时通过 ChromeMetrics.Get<T> 初始化默认值。
  // 这些默认键用于构造函数中的回退。

  /** 字体 ChromeMetrics 键。OpenRA 对照: "TextFont" */
  static readonly DEFAULT_FONT_KEY = 'TextFont'

  /** 文本颜色 ChromeMetrics 键。OpenRA 对照: "TextColor" */
  static readonly DEFAULT_TEXT_COLOR_KEY = 'TextColor'

  /** 对比色开启状态 ChromeMetrics 键。OpenRA 对照: "TextContrast" */
  static readonly DEFAULT_CONTRAST_KEY = 'TextContrast'

  /** 文字阴影开启状态 ChromeMetrics 键。OpenRA 对照: "TextShadow" */
  static readonly DEFAULT_SHADOW_KEY = 'TextShadow'

  /** 对比色-暗 ChromeMetrics 键。OpenRA 对照: "TextContrastColorDark" */
  static readonly DEFAULT_CONTRAST_DARK_KEY = 'TextContrastColorDark'

  /** 对比色-亮 ChromeMetrics 键。OpenRA 对照: "TextContrastColorLight" */
  static readonly DEFAULT_CONTRAST_LIGHT_KEY = 'TextContrastColorLight'

  /** 对比半径 ChromeMetrics 键。OpenRA 对照: "TextContrastRadius" */
  static readonly DEFAULT_CONTRAST_RADIUS_KEY = 'TextContrastRadius'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: LabelWidget(ModData) / LabelWidget(LabelWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 LabelWidget。
   *
   * OpenRA 对照: public LabelWidget(ModData modData)
   *
   * 从 ChromeMetrics 加载默认值，并初始化委托。
   * 支持 Fluent 文本缓存：getText 委托缓存翻译后的文本。
   *
   * @param _modData — ModData 引用（保留用于未来 Fluent 集成）
   */
  constructor(_modData?: unknown) {
    super()

    // 从 ChromeMetrics 加载默认值（如果可用）
    // OpenRA 对照: 各属性 = ChromeMetrics.Get<T>("key")
    try {
      this.font =
        (ChromeMetrics.tryGet<string>(LabelWidget.DEFAULT_FONT_KEY) as string) ||
        this.font
    } catch {
      // ChromeMetrics 未初始化时使用类默认值
    }
    try {
      this.textColor =
        (ChromeMetrics.tryGet<string>(
          LabelWidget.DEFAULT_TEXT_COLOR_KEY,
        ) as string) || this.textColor
    } catch {
      // 使用类默认值
    }
    try {
      this.contrast =
        Boolean(
          ChromeMetrics.tryGet<string>(LabelWidget.DEFAULT_CONTRAST_KEY),
        ) || this.contrast
    } catch {
      // 使用类默认值
    }
    try {
      this.shadow =
        Boolean(
          ChromeMetrics.tryGet<string>(LabelWidget.DEFAULT_SHADOW_KEY),
        ) || this.shadow
    } catch {
      // 使用类默认值
    }
    try {
      this.contrastColorDark =
        (ChromeMetrics.tryGet<string>(
          LabelWidget.DEFAULT_CONTRAST_DARK_KEY,
        ) as string) || this.contrastColorDark
    } catch {
      // 使用类默认值
    }
    try {
      this.contrastColorLight =
        (ChromeMetrics.tryGet<string>(
          LabelWidget.DEFAULT_CONTRAST_LIGHT_KEY,
        ) as string) || this.contrastColorLight
    } catch {
      // 使用类默认值
    }
    try {
      const radiusStr = ChromeMetrics.tryGet<string>(
        LabelWidget.DEFAULT_CONTRAST_RADIUS_KEY,
      ) as string | undefined
      if (radiusStr !== undefined) {
        this.contrastRadius = parseInt(radiusStr, 10) || 1
      }
    } catch {
      // 使用类默认值
    }

    // OpenRA 对照: CachedTransform + FluentProvider.GetMessage 文本缓存
    // NOTE: Fluent 本地化暂未迁移，使用直通缓存。
    // 当 Fluent 系统迁移完成后，替换为真正的 Fluent 文本查找。
    let textCache: string | null = null
    let textCacheInput: string | null | undefined = undefined
    this.getText = () => {
      const raw = this.text
      if (raw !== textCacheInput || textCacheInput === undefined) {
        textCacheInput = raw
        // Fluent pass-through: null → null, non-null → string (empty OK)
        textCache = raw !== null ? (raw.length > 0 ? raw : '') : null
      }
      return textCache
    }

    this.getColor = () => this.textColor
    this.getContrastColorDark = () => this.contrastColorDark
    this.getContrastColorLight = () => this.contrastColorLight
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected LabelWidget(LabelWidget other) : base(other)
   */
  protected copyFrom(other: LabelWidget): void {
    this.text = other.text
    this.align = other.align
    this.vAlign = other.vAlign
    this.font = other.font
    this.textColor = other.textColor
    this.contrast = other.contrast
    this.contrastColorDark = other.contrastColorDark
    this.contrastColorLight = other.contrastColorLight
    this.contrastRadius = other.contrastRadius
    this.shadow = other.shadow
    this.wordWrap = other.wordWrap
    this.getText = other.getText
    this.getColor = other.getColor
    this.getContrastColorDark = other.getContrastColorDark
    this.getContrastColorLight = other.getContrastColorLight
  }

  // ---------------------------------------------------------------------------
  // IncreaseHeightToFitCurrentText
  // OpenRA 对照: LabelWidget.IncreaseHeightToFitCurrentText()
  // ---------------------------------------------------------------------------

  /**
   * 根据当前文本内容调整 Bounds.Height 以适合文本。
   *
   * OpenRA 对照: public void IncreaseHeightToFitCurrentText()
   *
   * 如果启用了 WordWrap，则先对文本执行换行。
   * 调整后，Bounds.Height 不小于原高度。
   */
  increaseHeightToFitCurrentText(): void {
    let line = this.getText()
    if (!line) return

    const font = this.font
    if (this.wordWrap) {
      line = wordWrap(line, this.bounds.width, font)
    }

    const { height } = measureText(line, font)
    // 计算包含换行符的行数
    const lineCount = line.split('\n').length
    const minimalHeight = height * lineCount

    this.bounds.height = Math.max(this.bounds.height, minimalHeight)
  }

  // ---------------------------------------------------------------------------
  // Draw text with contrast / shadow effects (DrawInner)
  // OpenRA 对照: LabelWidget.DrawInner() + LabelWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 生成 CSS `text-shadow` 值来模拟对比/阴影效果。
   *
   * OpenRA 对照: DrawInner(string, SpriteFont, Color, int2)
   *
   * OpenRA 在四个对角方向额外绘制文字实现对比效果。
   * 迁移使用 CSS `text-shadow` 达到相同视觉效果：
   *
   * - Contrast: 4 个对角方向偏移，使用 bgDark + bgLight
   * - Shadow: 1 个底部-右侧偏移，使用 bgDark
   * - 其他: 无 text-shadow
   */
  private _computeTextShadow(): string {
    const r = this.contrastRadius

    if (this.contrast) {
      const bgDark = this.getContrastColorDark()
      const bgLight = this.getContrastColorLight()
      // OpenRA: 四个对角方向偏移
      // Top-left: dark, Top-right: light, Bottom-right: dark, Bottom-left: light
      return [
        `-${r}px -${r}px 0 ${bgDark}`,
        `${r}px -${r}px 0 ${bgLight}`,
        `${r}px ${r}px 0 ${bgDark}`,
        `-${r}px ${r}px 0 ${bgLight}`,
      ].join(', ')
    }

    if (this.shadow) {
      const bgDark = this.getContrastColorDark()
      // OpenRA: 底部-右侧偏移 1px，使用 bgDark
      const offset = Math.max(r, 1)
      return `${offset}px ${offset}px 0 ${bgDark}`
    }

    return 'none'
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Widget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 将标签渲染为 DOM 元素。
   *
   * 返回一个包含 CSS 样式的 `<div>` 元素，
   * 带有 font、color、text-align 和可选的 text-shadow 效果。
   * 如果文本为 null，则返回空元素。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'label-widget')

    // 获取当前文本
    const text = this.getText()
    if (text === null) {
      el.textContent = ''
      return el
    }

    // 处理换行
    let displayText = text
    if (this.wordWrap) {
      const font = this.font
      displayText = wordWrap(text, this.bounds.width, font)
      // CSS 自动换行作为后备
      el.style.wordWrap = 'break-word'
      el.style.overflowWrap = 'break-word'
    } else {
      el.style.whiteSpace = 'pre'
      el.style.overflow = 'hidden'
      el.style.textOverflow = 'ellipsis'
      el.style.wordWrap = ''
      el.style.overflowWrap = ''
    }

    // 文本颜色
    const color = this.getColor()
    el.style.color = color

    // 字体
    el.style.fontFamily = ''

    // 解析字体 CSS 以正确应用
    el.style.font = this.font

    // text-shadow (对比/阴影效果)
    const textShadow = this._computeTextShadow()
    el.style.textShadow = textShadow

    // 对齐方式
    switch (this.align) {
      case TextAlign.Center:
        el.style.textAlign = 'center'
        break
      case TextAlign.Right:
        el.style.textAlign = 'right'
        break
      default:
        el.style.textAlign = 'left'
    }

    // 垂直对齐
    switch (this.vAlign) {
      case TextVAlign.Top:
        el.style.display = 'flex'
        el.style.alignItems = 'flex-start'
        break
      case TextVAlign.Middle:
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        break
      case TextVAlign.Bottom:
        el.style.display = 'flex'
        el.style.alignItems = 'flex-end'
        break
    }

    // 当 wordWrap 为 true 时，允许多行文本
    if (this.wordWrap) {
      el.style.whiteSpace = 'normal'
      el.style.overflow = ''
      el.style.textOverflow = ''
    }

    // 设置文本内容
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'

    // 直接使用 textContent = displayText 或 innerHTML
    // 使用 textContent 设置纯文本（保留换行符）
    el.textContent = ''
    // 将 \n 转换为 <br> 通过 innerHTML，或者保持 pre 格式
    if (this.wordWrap) {
      // 对于自动换行，我们设置 white-space: pre-wrap, 这样 \n 生效且自动换行
      el.style.whiteSpace = 'pre-wrap'
    }
    el.textContent = displayText

    return el
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: LabelWidget.Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 LabelWidget。
   *
   * OpenRA 对照: public override LabelWidget Clone()
   */
  override clone(): LabelWidget {
    const cloned = new LabelWidget()
    cloned.copyFrom(this)
    cloned.id = this.id
    cloned._xExpr = this._xExpr
    cloned._yExpr = this._yExpr
    cloned._widthExpr = this._widthExpr
    cloned._heightExpr = this._heightExpr
    cloned.logic = [...this.logic]
    cloned.visible = this.visible
    cloned.bounds = { ...this.bounds }
    return cloned
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // OpenRA 对照: LabelWidget.GetCursor(int2) → null
  // ---------------------------------------------------------------------------

  /**
   * 标签不更改光标（返回 null）。
   *
   * OpenRA 对照: public override string GetCursor(int2 pos)
   */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }
}
