/**
 * RGBASpriteWidget.ts -- RGBA 颜色通道精灵渲染 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/RGBASpriteWidget.cs (39 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.DrawSprite() (SDL2 位图渲染) -> Canvas 2D drawImage() + globalCompositeOperation
 * - OpenRA RgbaSpriteRenderer 颜色调制 -> Canvas 2D globalCompositeOperation 色彩混合
 * - OpenRA Sprite + 颜色通道 (RGBA) -> Canvas 2D putImageData 逐像素颜色操作
 *
 * NOTE: OpenRA 原始版本继承 Widget（非 SpriteWidget）。
 * 迁移保持此继承关系以匹配 OpenRA 语义。
 * RGBASpriteWidget 与 SpriteWidget 的不同之处在于它支持
 * RGBA 颜色通道渲染（而非单通道调色板模式）。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'
import type { Sheet } from '../../OpenRA.Game/Graphics/Sheet.js'

// ---------------------------------------------------------------------------
// RGBASpriteWidget -- RGBA 颜色通道精灵渲染
// OpenRA 对照: public class RGBASpriteWidget : Widget
// ---------------------------------------------------------------------------

/**
 * RGBA 颜色通道精灵渲染 widget。
 *
 * 使用 Canvas 2D 从 Sheet 纹理图集渲染精灵，
 * 支持 RGBA 颜色通道（全彩色，无调色板限制）。
 *
 * 与 SpriteWidget 的关键区别:
 * - SpriteWidget: 使用调色板引用（单通道查色）
 * - RGBASpriteWidget: 直接使用 RGBA 像素颜色（全彩色）
 *
 * OpenRA 对照: public class RGBASpriteWidget : Widget
 */
export class RGBASpriteWidget extends Widget {
  // ---- 精灵属性 ----

  /** 获取精灵对象的委托。OpenRA 对照: RGBASpriteWidget.GetSprite */
  getSprite: () => Sprite | null

  /** Canvas 元素（用于精灵渲染）。 */
  private _canvas: HTMLCanvasElement | null = null

  /** 全局图像缓存（按 URL 索引）。 */
  private static _imageCache = new Map<string, HTMLImageElement>()

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: RGBASpriteWidget() / RGBASpriteWidget(RGBASpriteWidget)
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // OpenRA 对照: GetSprite = () => null
    this.getSprite = () => null
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected RGBASpriteWidget(RGBASpriteWidget other) : base(other)
   */
  protected copyFrom(other: RGBASpriteWidget): void {
    this.getSprite = other.getSprite
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override RGBASpriteWidget Clone()
  // ---------------------------------------------------------------------------

  override clone(): RGBASpriteWidget {
    const cloned = new RGBASpriteWidget()
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
  // Sprite rendering via Canvas 2D
  // OpenRA 对照: RGBASpriteWidget.Draw() -> WidgetUtils.DrawSprite(sprite, RenderOrigin)
  // ---------------------------------------------------------------------------

  /**
   * 使用 Canvas 2D 渲染 RGBA 精灵。
   *
   * 如果精灵为 null，清空 canvas。
   * Canvas 定位在 RenderOrigin（bounds.x, bounds.y）。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'rgba-sprite-widget')
    el.style.position = 'absolute'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'
    el.style.overflow = 'visible' // 精灵可超出 bounds

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    const sprite = this.getSprite()
    if (!sprite) {
      this._removeCanvas(el)
      return el
    }

    // 获取或创建 canvas
    if (!this._canvas) {
      this._canvas = document.createElement('canvas')
      this._canvas.style.position = 'absolute'
      this._canvas.style.left = '0'
      this._canvas.style.top = '0'
      el.appendChild(this._canvas)
    }

    // 设置 canvas 尺寸为精灵的实际像素尺寸
    const w = sprite.bounds.width
    const h = sprite.bounds.height
    this._canvas.width = w
    this._canvas.height = h
    this._canvas.style.width = `${w}px`
    this._canvas.style.height = `${h}px`

    const ctx = this._canvas.getContext('2d')
    if (!ctx) return el

    // 渲染 RGBA 精灵
    // OpenRA 对照: WidgetUtils.DrawSprite(sprite, RenderOrigin)
    this._drawRGBASprite(ctx, sprite)

    return el
  }

  /**
   * 在 Canvas 2D 上绘制 RGBA 精灵。
   *
   * 使用全局复合操作实现颜色通道渲染。
   * 与 OpenRA 的 RgbaSpriteRenderer 不同，Canvas 2D 原生支持
   * 全彩色 RGBA 绘制，无需手动通道操作。
   *
   * OpenRA 对照: RgbaSpriteRenderer.DrawSprite(sprite, position)
   */
  private _drawRGBASprite(
    ctx: CanvasRenderingContext2D,
    sprite: Sprite,
  ): void {
    const sheetImage = this._getSheetImage(sprite.sheet)
    if (!sheetImage) return

    // 源区域（精灵在纹理图集中的像素坐标）
    const sx = sprite.bounds.x
    const sy = sprite.bounds.y
    const sw = sprite.bounds.width
    const sh = sprite.bounds.height

    ctx.clearRect(0, 0, sw, sh)

    // RGBA 模式: 直接绘制全彩色精灵（无调色板限制）
    // OpenRA 对照: RgbaSpriteRenderer 使用着色器进行颜色通道调制
    // Canvas 2D 直接绘制 RGBA 像素，等效于 RGBA 通道模式
    ctx.drawImage(sheetImage, sx, sy, sw, sh, 0, 0, sw, sh)
  }

  /**
   * 获取 Sheet 的 HTMLImageElement。
   */
  private _getSheetImage(sheet: Sheet): HTMLImageElement | null {
    const sheetUrl = this._getSheetUrl(sheet)
    if (!sheetUrl) return null

    if (!RGBASpriteWidget._imageCache.has(sheetUrl)) {
      const img = new Image()
      img.src = sheetUrl
      img.crossOrigin = 'anonymous'
      RGBASpriteWidget._imageCache.set(sheetUrl, img)
      return img
    }
    return RGBASpriteWidget._imageCache.get(sheetUrl) ?? null
  }

  /**
   * 获取 Sheet 的纹理 URL。
   */
  private _getSheetUrl(sheet: Sheet): string {
    const sheetRecord = sheet as unknown as Record<string, unknown>
    if (typeof sheetRecord.getTexture === 'function') {
      const getTex = sheetRecord.getTexture as () => { url?: string } | null
      const texture = getTex()
      if (texture?.url) return texture.url
    }
    return ''
  }

  /**
   * 从容器元素中移除旧的 canvas 节点。
   */
  private _removeCanvas(_el: HTMLElement): void {
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas)
    }
    this._canvas = null
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // ---------------------------------------------------------------------------

  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }
}
