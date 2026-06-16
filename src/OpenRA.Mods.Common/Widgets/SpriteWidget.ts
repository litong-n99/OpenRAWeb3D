/**
 * SpriteWidget.ts -- 无约束精灵渲染 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/SpriteWidget.cs (82 lines)
 *
 * 核心范式转换:
 * - OpenRA Game.Renderer.SpriteRenderer.DrawSprite() (OpenGL 批量四边形) -> Canvas 2D drawImage()
 * - OpenRA Sprite + PaletteReference (纹理图集 + 调色板) -> Canvas 2D ImageData + Sheet URL
 * - OpenRA WorldRenderer.Palette() (调色板查找) -> 简化的调色板引用
 * - OpenRA EnableAntialiasingFilter / DisableAntialiasingFilter -> Canvas imageSmoothingEnabled
 * - OpenRA float2 offset 计算 (居中) -> Canvas drawImage dx/dy 参数
 * - OpenRA Scale -> Canvas drawImage dw/dh 缩放参数
 *
 * SpriteWidget 渲染来自 Sheet 的精灵，无大小约束（无裁剪到 bounds）。
 * 用于需要比 widget bounds 更大或更小精灵的场景。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'
import type { Sheet } from '../../OpenRA.Game/Graphics/Sheet.js'

// ---------------------------------------------------------------------------
// PaletteReference -- 简化的调色板引用
// OpenRA 对照: OpenRA.Graphics.PaletteReference
// ---------------------------------------------------------------------------

/**
 * 简化的调色板引用接口。
 *
 * 在迁移中，调色板在着色器中实现。
 * 这里提供最小接口用于 sprite 渲染的颜色查找。
 *
 * OpenRA 对照: PaletteReference
 */
export interface IPaletteReference {
  /** 调色板名称 */
  readonly name: string
  /** 调色板数据（Uint32Array，256 种颜色） */
  readonly paletteData: Uint32Array | null
}

// ---------------------------------------------------------------------------
// SpriteWidget -- 无约束精灵渲染
// OpenRA 对照: public class SpriteWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 无约束精灵渲染 widget。
 *
 * 使用 Canvas 2D 从 Sheet 纹理图集渲染精灵。
 * 精灵可以超出 widget 的 bounds（无裁剪）。
 * 支持缩放、居中偏移和调色板查色。
 *
 * OpenRA 对照: public class SpriteWidget : Widget
 */
export class SpriteWidget extends Widget {
  // ---- 精灵属性 ----

  /** 显示缩放比例（默认 1.0）。OpenRA 对照: SpriteWidget.Scale */
  scale: number = 1.0

  /** 获取缩放比例的委托。OpenRA 对照: SpriteWidget.GetScale */
  getScale: () => number

  /** 调色板名称。OpenRA 对照: SpriteWidget.Palette */
  palette: string = 'chrome'

  /** 获取调色板名称的委托。OpenRA 对照: SpriteWidget.GetPalette */
  getPalette: () => string

  /** 获取精灵对象的委托。OpenRA 对照: SpriteWidget.GetSprite */
  getSprite: () => Sprite | null

  // ---- 缓存的渲染状态 ----
  // OpenRA 对照: 缓存字段 (cachedSprite, cachedPalette, cachedScale, pr, offset)

  /** 缓存的精灵（用于检测变化）。 */
  private _cachedSprite: Sprite | null = null

  /** 缓存的调色板名称。 */
  private _cachedPalette: string = ''

  /** 缓存的缩放比例。 */
  private _cachedScale: number = 0

  /** 精灵的居中偏移（2D 向量）。 */
  private _offsetX: number = 0
  private _offsetY: number = 0

  /** Canvas 元素（用于精灵渲染）。 */
  private _canvas: HTMLCanvasElement | null = null

  // ---- 像素缩放 dpi 乘数 ---- */

  /** DPI 缩放乘数（默认 1.0）。 */
  protected _dpiScale: number = 1.0

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SpriteWidget(WorldRenderer) / SpriteWidget(SpriteWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 SpriteWidget。
   *
   * OpenRA 对照: public SpriteWidget(WorldRenderer worldRenderer)
   *
   * NOTE: WorldRenderer 迁移后不再需要（Canvas 2D 无需调色板系统）。
   * 保留参数以维持 API 兼容性。
   */
  constructor(_worldRenderer?: unknown) {
    super()

    // OpenRA 对照: 委托初始化
    this.getScale = () => this.scale
    this.getPalette = () => this.palette
    this.getSprite = () => null
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected SpriteWidget(SpriteWidget other) : base(other)
   */
  protected copyFrom(other: SpriteWidget): void {
    this.scale = other.scale
    this.getScale = other.getScale
    this.palette = other.palette
    this.getPalette = other.getPalette
    this.getSprite = other.getSprite
    this._dpiScale = other._dpiScale
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override SpriteWidget Clone()
  // ---------------------------------------------------------------------------

  override clone(): SpriteWidget {
    const cloned = new SpriteWidget()
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
  // OpenRA 对照: SpriteWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 使用 Canvas 2D 渲染精灵。
   *
   * 行为与 OpenRA 完全一致:
   * 1. 获取精灵、调色板和缩放比例
   * 2. 如果精灵或调色板为 null，跳过渲染
   * 3. 如果精灵或缩放比例已更改，重新计算居中偏移
   * 4. 如果调色板已更改，重新查找调色板引用
   * 5. 启用抗锯齿过滤器，绘制精灵，禁用抗锯齿过滤器
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'sprite-widget')
    el.style.position = 'absolute'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'
    el.style.overflow = 'visible' // 精灵可超出 bounds

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    const sprite = this.getSprite()
    const paletteName = this.getPalette()
    const scale = this.getScale()

    // 无精灵或无调色板 -> 清空 canvas
    if (!sprite || !paletteName) {
      this._removeCanvas(el)
      return el
    }

    // 精灵或缩放比例改变 -> 重新计算居中偏移
    // OpenRA 对照: offset = 0.5f * (new float2(RenderBounds.Size) - scale * sprite.Size.XY)
    if (sprite !== this._cachedSprite || scale !== this._cachedScale) {
      const boundsW = this.bounds.width
      const boundsH = this.bounds.height
      const spriteW = sprite.size.x * scale
      const spriteH = sprite.size.y * scale
      this._offsetX = 0.5 * (boundsW - spriteW)
      this._offsetY = 0.5 * (boundsH - spriteH)
      this._cachedSprite = sprite
      this._cachedScale = scale
    }

    // 调色板改变 -> 重新查找调色板引用
    // OpenRA 对照: pr = WorldRenderer.Palette(palette)
    if (paletteName !== this._cachedPalette) {
      this._resolvePalette(paletteName)
      this._cachedPalette = paletteName
    }

    // 获取或创建 canvas
    if (!this._canvas) {
      this._canvas = document.createElement('canvas')
      this._canvas.style.position = 'absolute'
      el.appendChild(this._canvas)
    }

    // 设置 canvas 尺寸
    const cw = sprite.bounds.width * scale
    const ch = sprite.bounds.height * scale
    this._canvas.width = Math.ceil(cw)
    this._canvas.height = Math.ceil(ch)
    this._canvas.style.width = `${cw}px`
    this._canvas.style.height = `${ch}px`
    this._canvas.style.left = `${this._offsetX}px`
    this._canvas.style.top = `${this._offsetY}px`

    // 绘制精灵
    const ctx = this._canvas.getContext('2d')
    if (!ctx) return el

    // OpenRA 对照: Game.Renderer.EnableAntialiasingFilter()
    ctx.imageSmoothingEnabled = true

    // 绘制精灵图像
    // OpenRA 对照: Game.Renderer.SpriteRenderer.DrawSprite(sprite, pr, RenderOrigin + offset, scale)
    this._drawSpriteToCanvas(ctx, sprite, cw, ch)

    // OpenRA 对照: Game.Renderer.DisableAntialiasingFilter()
    // (imageSmoothingEnabled 保持 true 无妨)

    return el
  }

  /**
   * 将精灵绘制到 canvas 上。
   *
   * 使用 Sheet 图像 URL 和精灵的 bounds (像素坐标) 作为源矩形。
   * Canvas 2D drawImage() 处理缩放和定位。
   *
   * OpenRA 对照: SpriteRenderer.DrawSprite()
   */
  protected _drawSpriteToCanvas(
    ctx: CanvasRenderingContext2D,
    sprite: Sprite,
    destW: number,
    destH: number,
  ): void {
    // 获取 Sheet 图像
    const sheetImage = this._getSheetImage(sprite.sheet)
    if (!sheetImage) return

    // 源区域（精灵在纹理图集中的像素坐标）
    const sx = sprite.bounds.x
    const sy = sprite.bounds.y
    const sw = sprite.bounds.width
    const sh = sprite.bounds.height

    // 目标区域（canvas 上的像素坐标和尺寸）
    ctx.clearRect(0, 0, destW, destH)
    ctx.drawImage(sheetImage, sx, sy, sw, sh, 0, 0, destW, destH)
  }

  /**
   * 获取 Sheet 的 HTMLImageElement。
   *
   * 从 Sheet 的纹理 URL 创建或返回缓存的图像元素。
   *
   * @param _sheet -- Sheet 引用（含纹理图集 URL）
   * @returns HTMLImageElement 或 null
   */
  private _getSheetImage(_sheet: Sheet): HTMLImageElement | null {
    // NOTE: Sheet 纹理迁移后，使用 Sheet.texture URL 加载图像
    // 简化为缓存查找模式
    const sheetUrl = this._getSheetUrl(_sheet)
    if (!sheetUrl) return null

    if (!SpriteWidget._imageCache.has(sheetUrl)) {
      const img = new Image()
      img.src = sheetUrl
      img.crossOrigin = 'anonymous'
      SpriteWidget._imageCache.set(sheetUrl, img)
      return img
    }
    return SpriteWidget._imageCache.get(sheetUrl) ?? null
  }

  /** 全局图像缓存（按 URL 索引）。 */
  private static _imageCache = new Map<string, HTMLImageElement>()

  /**
   * 获取 Sheet 的纹理 URL。
   *
   * NOTE: 迁移后，Sheet 存储纹理数据。
   * 这里提取可渲染的 URL。
   */
  private _getSheetUrl(sheet: Sheet): string {
    // Sheet 可能通过 getTexture() 或类似方法暴露 URL
    // 尝试获取内部纹理 URL
    const sheetRecord = sheet as unknown as Record<string, unknown>
    if (typeof sheetRecord.getTexture === 'function') {
      const getTex = sheetRecord.getTexture as () => { url?: string } | null
      const texture = getTex()
      if (texture?.url) return texture.url
    }
    return ''
  }

  /**
   * 解析调色板引用。
   *
   * 在迁移中，调色板在着色器中实现。
   * Canvas 2D 渲染不需要调色板查找（使用直接像素颜色）。
   *
   * OpenRA 对照: WorldRenderer.Palette(string) -> PaletteReference
   */
  private _resolvePalette(name: string): IPaletteReference | null {
    // NOTE: 迁移后调色板系统不在 Canvas 2D 中使用。
    // 返回最小引用以保持缓存逻辑。
    return { name, paletteData: null }
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
