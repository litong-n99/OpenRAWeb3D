/**
 * GradientColorBlockWidget.ts -- 四角渐变色矩形 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/GradientColorBlockWidget.cs (57 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.FillRectWithColor(4色) (SDL2 四角填充) -> Canvas 2D 四角色双线性插值
 * - OpenRA Color 结构体 (32-bit ARGB) -> CSS 颜色字符串
 * - OpenRA Func<Color> 委托 -> TypeScript () => Color 函数
 *
 * NOTE: OpenRA 原始版本使用 4 个角颜色（TopLeft, TopRight, BottomRight, BottomLeft）
 * 的完全通用四边形渐变。这在 CSS 中无原生支持，因此使用 Canvas 2D 渲染。
 * 仅当简单水平/垂直渐变时，可使用 CSS linear-gradient 作为优化路径。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { Color } from './LabelWidget.js'

// ---------------------------------------------------------------------------
// GradientColorBlockWidget -- 四角渐变色矩形
// OpenRA 对照: public class GradientColorBlockWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 四角渐变色矩形 widget。
 *
 * 使用 Canvas 2D 渲染四个角的颜色渐变（双线性插值）。
 * 每个角有独立的颜色和动态委托。
 * 用于 UI 面板的渐变背景、标题栏着色等。
 *
 * OpenRA 对照: public class GradientColorBlockWidget : Widget
 */
export class GradientColorBlockWidget extends Widget {
  // ---- 角颜色属性 ----
  // OpenRA 对照: TopLeftColor / TopRightColor / BottomRightColor / BottomLeftColor

  /** 左上角颜色（CSS 字符串）。OpenRA 对照: TopLeftColor */
  topLeftColor: Color = '#000000'

  /** 右上角颜色（CSS 字符串）。OpenRA 对照: TopRightColor */
  topRightColor: Color = '#000000'

  /** 右下角颜色（CSS 字符串）。OpenRA 对照: BottomRightColor */
  bottomRightColor: Color = '#000000'

  /** 左下角颜色（CSS 字符串）。OpenRA 对照: BottomLeftColor */
  bottomLeftColor: Color = '#000000'

  // ---- Func 委托 ----

  /** 获取左上角颜色的委托。OpenRA 对照: GetTopLeftColor */
  getTopLeftColor: () => Color

  /** 获取右上角颜色的委托。OpenRA 对照: GetTopRightColor */
  getTopRightColor: () => Color

  /** 获取右下角颜色的委托。OpenRA 对照: GetBottomRightColor */
  getBottomRightColor: () => Color

  /** 获取左下角颜色的委托。OpenRA 对照: GetBottomLeftColor */
  getBottomLeftColor: () => Color

  // ---- 内部状态 ----

  /** Canvas 元素引用（用于四角渐变渲染）。 */
  private _canvas: HTMLCanvasElement | null = null

  /** 缓存的 canvas 尺寸，用于检测是否需要重绘。 */
  private _cachedWidth: number = -1
  private _cachedHeight: number = -1

  /** 缓存的角颜色，用于检测是否需要重绘。 */
  private _cachedTL: Color = ''
  private _cachedTR: Color = ''
  private _cachedBR: Color = ''
  private _cachedBL: Color = ''

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: GradientColorBlockWidget() / GradientColorBlockWidget(GradientColorBlockWidget)
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // OpenRA 对照: 委托初始化为默认属性直通
    this.getTopLeftColor = () => this.topLeftColor
    this.getTopRightColor = () => this.topRightColor
    this.getBottomRightColor = () => this.bottomRightColor
    this.getBottomLeftColor = () => this.bottomLeftColor
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected GradientColorBlockWidget(GradientColorBlockWidget widget) : base(widget)
   */
  protected copyFrom(other: GradientColorBlockWidget): void {
    this.topLeftColor = other.topLeftColor
    this.topRightColor = other.topRightColor
    this.bottomRightColor = other.bottomRightColor
    this.bottomLeftColor = other.bottomLeftColor
    this.getTopLeftColor = other.getTopLeftColor
    this.getTopRightColor = other.getTopRightColor
    this.getBottomRightColor = other.getBottomRightColor
    this.getBottomLeftColor = other.getBottomLeftColor
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override GradientColorBlockWidget Clone()
  // ---------------------------------------------------------------------------

  override clone(): GradientColorBlockWidget {
    const cloned = new GradientColorBlockWidget()
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
  // Canvas gradient rendering
  // OpenRA 对照: WidgetUtils.FillRectWithColor(RenderBounds, TL, TR, BR, BL)
  // ---------------------------------------------------------------------------

  /**
   * 在 canvas 上渲染四角颜色双线性插值渐变。
   *
   * 算法: 对每个像素，根据其相对于四个角的位置进行双线性插值。
   * 三个通道（R, G, B）分别插值；alpha 通道独立插值。
   *
   * OpenRA 对照: WidgetUtils.FillRectWithColor(rect, TL, TR, BR, BL)
   * （OpenRA 使用 SDL2 的逐角填充，语义上等价于双线性插值。）
   *
   * @param ctx — Canvas 2D 渲染上下文
   * @param w — 宽度（像素）
   * @param h — 高度（像素）
   * @param tl — 左上角颜色
   * @param tr — 右上角颜色
   * @param br — 右下角颜色
   * @param bl — 左下角颜色
   */
  private _drawGradient(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    tl: Color,
    tr: Color,
    br: Color,
    bl: Color,
  ): void {
    if (w <= 0 || h <= 0) return

    // 解析 CSS 颜色为 RGBA 分量
    const tlRGBA = this._parseColor(tl)
    const trRGBA = this._parseColor(tr)
    const brRGBA = this._parseColor(br)
    const blRGBA = this._parseColor(bl)

    // 创建 ImageData 进行逐像素双线性插值
    const imageData = ctx.createImageData(w, h)
    const data = imageData.data

    for (let y = 0; y < h; y++) {
      const ty = h > 1 ? y / (h - 1) : 0 // 垂直插值因子

      for (let x = 0; x < w; x++) {
        const tx = w > 1 ? x / (w - 1) : 0 // 水平插值因子

        // 双线性插值: 先插值上边、下边，再插值垂直
        const topR = tlRGBA.r + (trRGBA.r - tlRGBA.r) * tx
        const topG = tlRGBA.g + (trRGBA.g - tlRGBA.g) * tx
        const topB = tlRGBA.b + (trRGBA.b - tlRGBA.b) * tx
        const topA = tlRGBA.a + (trRGBA.a - tlRGBA.a) * tx

        const botR = blRGBA.r + (brRGBA.r - blRGBA.r) * tx
        const botG = blRGBA.g + (brRGBA.g - blRGBA.g) * tx
        const botB = blRGBA.b + (brRGBA.b - blRGBA.b) * tx
        const botA = blRGBA.a + (brRGBA.a - blRGBA.a) * tx

        const idx = (y * w + x) * 4
        data[idx] = Math.round(topR + (botR - topR) * ty) // R
        data[idx + 1] = Math.round(topG + (botG - topG) * ty) // G
        data[idx + 2] = Math.round(topB + (botB - topB) * ty) // B
        data[idx + 3] = Math.round(topA + (botA - topA) * ty) // A
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }

  /**
   * 解析 CSS 颜色字符串为 RGBA 分量（0-255）。
   *
   * 支持格式: #RGB, #RRGGBB, #RGBA, #RRGGBBAA, rgb(), rgba()
   */
  private _parseColor(color: Color): {
    r: number
    g: number
    b: number
    a: number
  } {
    if (!color) return { r: 0, g: 0, b: 0, a: 255 }

    // 使用浏览器原生解析（创建临时元素）
    // 回退: 手动解析 hex 格式
    const hexMatch = color.match(
      /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    )
    if (hexMatch) {
      let hex = hexMatch[1]
      if (hex.length === 3 || hex.length === 4) {
        // 展开短格式
        hex = hex
          .split('')
          .map((c) => c + c)
          .join('')
      }
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a =
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255
      return { r, g, b, a }
    }

    // rgb/rgba 格式
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
        a: rgbMatch[4] ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255,
      }
    }

    // 回退: 黑色
    return { r: 0, g: 0, b: 0, a: 255 }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: GradientColorBlockWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 使用 Canvas 2D 渲染四角渐变。
   *
   * Canvas 元素定位为绝对定位，填充 widget 的整个 bounds。
   * 仅在颜色或尺寸变化时重绘（性能优化）。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'gradient-color-block-widget')
    el.style.position = 'absolute'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'
    el.style.overflow = 'hidden'

    // 设置 widget ID
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    const w = this.bounds.width
    const h = this.bounds.height

    // 获取当前颜色
    const tl = this.getTopLeftColor()
    const tr = this.getTopRightColor()
    const br = this.getBottomRightColor()
    const bl = this.getBottomLeftColor()

    // 简单情况: 四个角颜色相同 -> 纯 CSS background-color（无 canvas 开销）
    if (tl === tr && tr === br && br === bl) {
      // 移除旧 canvas
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas)
        this._canvas = null
      }
      el.style.backgroundColor = tl
      el.style.backgroundImage = ''
      return el
    }

    // 简单情况: 仅水平渐变（上边两色相等且下边两色相等）
    if (tl === tr && bl === br && w > 0 && h > 0) {
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas)
        this._canvas = null
      }
      el.style.backgroundColor = ''
      el.style.backgroundImage = `linear-gradient(to bottom, ${tl}, ${bl})`
      return el
    }

    // 一般情况: 四角渐变 -> canvas 渲染
    el.style.backgroundColor = ''
    el.style.backgroundImage = ''

    if (!this._canvas) {
      this._canvas = document.createElement('canvas')
      this._canvas.style.position = 'absolute'
      this._canvas.style.left = '0'
      this._canvas.style.top = '0'
      this._canvas.style.width = '100%'
      this._canvas.style.height = '100%'
      el.appendChild(this._canvas)
    }

    // 仅在尺寸或颜色变化时重绘
    if (
      w !== this._cachedWidth ||
      h !== this._cachedHeight ||
      tl !== this._cachedTL ||
      tr !== this._cachedTR ||
      br !== this._cachedBR ||
      bl !== this._cachedBL
    ) {
      this._cachedWidth = w
      this._cachedHeight = h
      this._cachedTL = tl
      this._cachedTR = tr
      this._cachedBR = br
      this._cachedBL = bl

      this._canvas.width = w
      this._canvas.height = h

      const ctx = this._canvas.getContext('2d')
      if (ctx) {
        this._drawGradient(ctx, w, h, tl, tr, br, bl)
      }
    }

    return el
  }
}
