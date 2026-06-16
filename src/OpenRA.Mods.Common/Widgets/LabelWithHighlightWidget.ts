/**
 * LabelWithHighlightWidget.ts — 高亮文本标签 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LabelWithHighlightWidget.cs (86 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawText() 逐段绘制 (normal/highlight 颜色切换) → DOM innerHTML 嵌套 span
 * - C# CachedTransform<string, (string Text, bool Highlighted)[]> → TypeScript 缓存解析
 * - C# <highlight>text</highlight> 标记符 → 解析为 `<mark>` 或 `<strong>` 元素
 * - C# SpriteFont.Measure 计算 advance → CSS 内联 span 自然流式布局
 * - C# Color HighlightColor → CSS color 字符串
 *
 * 文本标记支持两种模式:
 * 1. C# 原生模式: 文本中的 `<highlighted>` 和 `</highlighted>` 标记 (由 MakeComponents 解析)
 * 2. 便捷模式: highlightedText 属性，不区分大小写匹配并高亮子字符串
 */

import { LabelWidget } from './LabelWidget.js'
import type { Color } from './LabelWidget.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'

// ---------------------------------------------------------------------------
// 文本组件类型
// ---------------------------------------------------------------------------

/** 文本片段: 文本内容 + 是否高亮。
 *
 * OpenRA 对照: (string Text, bool Highlighted) 元组
 */
interface TextComponent {
  text: string
  highlighted: boolean
}

// ---------------------------------------------------------------------------
// LabelWithHighlightWidget — 高亮文本标签
// OpenRA 对照: public class LabelWithHighlightWidget : LabelWidget
// ---------------------------------------------------------------------------

/**
 * 高亮文本标签 widget。
 *
 * 将文本中包含 `<highlighted>...</highlighted>` (或 `<` 和 `>` 简写标记)
 * 的部分用高亮颜色渲染。
 *
 * OpenRA 对照: LabelWithHighlightWidget
 */
export class LabelWithHighlightWidget extends LabelWidget {
  /** 高亮颜色。OpenRA 对照: LabelWithHighlightWidget.HighlightColor */
  highlightColor: Color = '#FFFF00'

  /** 要高亮的子字符串（便捷属性，不区分大小写匹配）。
   *
   * NOTE: OpenRA 原始实现使用 `<` 和 `>` 内联标记，
   * 不使用单独的 highlightedText 属性。此属性为 TypeScript 迁移的便利扩展。
   * 如果设置了 highlightedText，将覆盖内联标记解析。
   */
  highlightedText: string | null = null

  /** 解析缓存（带有失效逻辑的 CachedTransform）。
   * OpenRA 对照: CachedTransform<string, (string Text, bool Highlighted)[]>
   */
  private _cacheKey: string | null = null
  private _cachedComponents: TextComponent[] | null = null

  // ---- ChromeMetrics 默认键 ----

  static readonly DEFAULT_HIGHLIGHT_COLOR_KEY = 'TextHighlightColor'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: LabelWithHighlightWidget(ModData) / LabelWithHighlightWidget(LabelWithHighlightWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 LabelWithHighlightWidget。
   *
   * OpenRA 对照: public LabelWithHighlightWidget(ModData modData) : base(modData)
   */
  constructor(_modData?: unknown) {
    super(_modData)

    // 从 ChromeMetrics 加载默认高亮颜色
    try {
      const color = ChromeMetrics.tryGet<string>(
        LabelWithHighlightWidget.DEFAULT_HIGHLIGHT_COLOR_KEY,
      )
      if (color) this.highlightColor = color as string
    } catch {
      /* graceful */
    }
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected LabelWithHighlightWidget(LabelWithHighlightWidget other) : base(other)
   */
  protected copyFrom(other: LabelWithHighlightWidget): void {
    super.copyFrom(other)
    this.highlightColor = other.highlightColor
    this.highlightedText = other.highlightedText
  }

  // ---------------------------------------------------------------------------
  // MakeComponents — 解析文本为高亮/普通组件
  // OpenRA 对照: (string, bool)[] MakeComponents(string text)
  // ---------------------------------------------------------------------------

  /**
   * 将文本解析为 (文本片段, 是否高亮) 组件数组。
   *
   * 支持两种模式:
   * 1. highlightedText 不为 null: 按子字符串（不区分大小写）分割并高亮
   * 2. highlightedText 为 null: 使用 `<` 和 `>` 内联标记（OpenRA 原生）
   *
   * OpenRA 对照: MakeComponents(string text)
   */
  /** 将文本解析为 (文本片段, 是否高亮) 组件数组。
   *
   * 公开方法，方便测试和子类使用。
   */
  makeComponents(text: string): TextComponent[] {
    if (this.highlightedText && this.highlightedText.length > 0) {
      return this._makeSubstringComponents(text, this.highlightedText)
    }
    return this._makeMarkerComponents(text)
  }

  /**
   * 按子字符串高亮模式解析文本。
   * 不区分大小写匹配，将匹配部分标记为高亮。
   */
  private _makeSubstringComponents(
    text: string,
    highlight: string,
  ): TextComponent[] {
    const components: TextComponent[] = []
    const lowerText = text.toLowerCase()
    const lowerHighlight = highlight.toLowerCase()
    let remaining = text
    let lowerRemaining = lowerText

    while (lowerRemaining.length > 0) {
      const idx = lowerRemaining.indexOf(lowerHighlight)
      if (idx === -1) {
        if (remaining.length > 0) {
          components.push({ text: remaining, highlighted: false })
        }
        break
      }

      // 匹配前的文本
      if (idx > 0) {
        components.push({
          text: remaining.substring(0, idx),
          highlighted: false,
        })
      }

      // 高亮的匹配文本
      components.push({
        text: remaining.substring(idx, idx + highlight.length),
        highlighted: true,
      })

      // 继续处理剩余部分
      remaining = remaining.substring(idx + highlight.length)
      lowerRemaining = lowerRemaining.substring(idx + lowerHighlight.length)
    }

    return components
  }

  /**
   * 按内联标记模式解析文本（OpenRA 原生）。
   *
   * OpenRA 使用 `<>` 尖括号作为高亮标记:
   * - `<highlighted>text</highlighted>` 标记高亮段
   * - 也支持简写 `<text>` 标记
   *
   * OpenRA 对照: MakeComponents — 使用 `<` 和 `>` 查找高亮边界
   */
  private _makeMarkerComponents(text: string): TextComponent[] {
    const components: TextComponent[] = []

    // 按行分割
    const lines = text.split('\n')
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (lineIdx > 0) {
        // 添加换行符作为普通组件
        components.push({ text: '\n', highlighted: false })
      }

      let line = lines[lineIdx]!
      while (line.length > 0) {
        const highlightStart = line.indexOf('<')
        const highlightEnd = line.indexOf('>', highlightStart + 1)

        if (
          highlightStart >= 0 &&
          highlightEnd > highlightStart
        ) {
          // 高亮标记前的普通文本
          if (highlightStart > 0) {
            components.push({
              text: line.substring(0, highlightStart),
              highlighted: false,
            })
          }

          // 高亮段
          const highlightText = line.substring(
            highlightStart + 1,
            highlightEnd,
          )
          if (highlightText.length > 0) {
            components.push({ text: highlightText, highlighted: true })
          }

          line = line.substring(highlightEnd + 1)
        } else {
          // 剩余普通文本
          if (line.length > 0) {
            components.push({ text: line, highlighted: false })
          }
          break
        }
      }
    }

    return components
  }

  /**
   * 获取缓存的文本组件（带失效检查）。
   *
   * OpenRA 对照: textComponents.Update(text)
   */
  private _getComponents(text: string): TextComponent[] {
    if (text !== this._cacheKey) {
      this._cacheKey = text
      this._cachedComponents = this.makeComponents(text)
    }
    return this._cachedComponents ?? []
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: protected override void DrawInner(string text, SpriteFont font, Color color, int2 position)
  // ---------------------------------------------------------------------------

  /**
   * 渲染高亮文本标签。
   *
   * 使用内联 span 元素，高亮部分用 `<mark>` 或带颜色的 `<strong>`。
   *
   * OpenRA 对照: DrawInner — 逐段调用 font.DrawText
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'label-highlight-widget')

    const text = this.getText()
    if (text === null) {
      el.textContent = ''
      return el
    }

    const color = this.getColor()
    const components = this._getComponents(text)

    // 设置基础样式
    el.style.position = 'absolute'
    el.style.boxSizing = 'border-box'
    el.style.userSelect = 'none'
    el.style.font = this.font
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

    // Text shadow for contrast/shadow effects
    el.style.textShadow = this._computeTextShadowPrivate()

    // 清除旧内容
    el.textContent = ''

    // 添加每个组件作为 span
    for (const comp of components) {
      if (comp.text.length === 0) continue

      if (comp.highlighted) {
        const mark = document.createElement('mark')
        mark.textContent = comp.text
        mark.style.color = this.highlightColor
        mark.style.backgroundColor = 'transparent'
        mark.style.fontWeight = 'bold'
        el.appendChild(mark)
      } else {
        const span = document.createElement('span')
        span.textContent = comp.text
        span.style.color = color
        el.appendChild(span)
      }
    }

    return el
  }

  /**
   * 生成 text-shadow（复用父类逻辑，但访问需通过私有方法同名实现）。
   * 与 LabelWidget._computeTextShadow 逻辑相同。
   */
  private _computeTextShadowPrivate(): string {
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
  // Clone
  // OpenRA 对照: public override LabelWithHighlightWidget Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 LabelWithHighlightWidget。
   *
   * OpenRA 对照: public override LabelWithHighlightWidget Clone()
   */
  override clone(): LabelWithHighlightWidget {
    const w = new LabelWithHighlightWidget()
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
