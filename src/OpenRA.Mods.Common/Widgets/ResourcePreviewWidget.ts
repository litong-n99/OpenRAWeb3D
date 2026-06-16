/**
 * ResourcePreviewWidget.ts — 资源预览控件: 显示资源类型图标与密度指示
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ResourcePreviewWidget.cs (92 lines)
 *
 * 核心范式转换:
 * - C# IResourceRenderer.RenderUIPreview() 批量 sprite 渲染 → HTML Canvas 2D 像素绘制
 * - C# ViewportSizes.DefaultScale → scale 参数直接传入
 * - C# SpriteRenderable.PrepareRender().Render() → Canvas drawImage() 操作
 * - C# Size 结构体 → { width: number, height: number }
 * - C# Clone() 复制构造器 → TypeScript 结构化克隆
 * - Density color gradient: low=yellow, medium=orange, high=red (通过 Canvas fillStyle)
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// ResourceTypeColor — 资源密度颜色映射
// OpenRA 对照: 无 (C# 使用 WorldRenderer 调色板)
// ---------------------------------------------------------------------------

/** 资源密度阈值和对应的 CSS 颜色。
 *
 * 密度 0-33: yellow (低)
 * 密度 34-66: orange (中)
 * 密度 67-100: red (高)
 */
const DENSITY_LOW_THRESHOLD = 33
const DENSITY_MED_THRESHOLD = 66

const DENSITY_COLOR_LOW = '#FFD700'    // gold/yellow
const DENSITY_COLOR_MED = '#FF8C00'    // dark orange
const DENSITY_COLOR_HIGH = '#FF0000'   // red

// ---------------------------------------------------------------------------
// Stub interfaces for resource rendering
// OpenRA 对照: IResourceRenderer, SpriteRenderable
// ---------------------------------------------------------------------------

/** Minimal resource renderer interface.
 *
 * OpenRA 对照: IResourceRenderer
 */
export interface IResourceRenderer {
  readonly resourceTypes: ReadonlyArray<string>
  renderPreview(
    renderer: unknown,
    resourceType: string,
    scale: number,
  ): IResourceSpriteInfo | null
}

/** Minimal sprite info for Canvas rendering.
 *
 * OpenRA 对照: Sprite (bounds + sprite sheet data)
 */
export interface IResourceSpriteInfo {
  readonly image: HTMLImageElement | HTMLCanvasElement
  readonly srcX: number
  readonly srcY: number
  readonly srcWidth: number
  readonly srcHeight: number
}

// ---------------------------------------------------------------------------
// ResourcePreviewWidget
// OpenRA 对照: ResourcePreviewWidget : Widget
// ---------------------------------------------------------------------------

/**
 * Widget that renders a small resource type icon with a density color indicator.
 *
 * OpenRA 对照: ResourcePreviewWidget
 *
 * Used in map preview tooltips and resource information displays.
 *
 * Set `resourceType` and `density` properties, then call render().
 * Renders a <canvas> element that draws the resource sprite colored
 * by density level.
 */
export class ResourcePreviewWidget extends Widget {
  /** Display scale (multiplied by tile size to get canvas size).
   *
   * OpenRA 对照: ResourcePreviewWidget.Scale
   */
  scale: number = 1

  /** Ideal size for this preview (used by parent layout).
   *
   * OpenRA 对照: ResourcePreviewWidget.IdealPreviewSize
   */
  idealPreviewSize: { width: number; height: number } = { width: 32, height: 32 }

  /** The resource type identifier string.
   *
   * OpenRA 对照: ResourcePreviewWidget.resourceType (string)
   */
  private _resourceType: string | null = null

  get resourceType(): string | null {
    return this._resourceType
  }

  /** The density value (0-100). Default 0.
   *
   * 0-33: low (yellow), 34-66: medium (orange), 67-100: high (red)
   */
  private _density: number = 0

  get density(): number {
    return this._density
  }

  /** Reference to the active resource renderer. */
  private _resourceRenderer: IResourceRenderer | null = null

  /** Available resource renderers (injected).
   *
   * OpenRA 对照: ResourcePreviewWidget.resourceRenderers
   */
  resourceRenderers: IResourceRenderer[] = []

  /** Base tile size in pixels (at default scale 1).
   *
   * OpenRA 对照: ResourcePreviewWidget.tileSize
   */
  tileSize: { width: number; height: number } = { width: 24, height: 24 }

  /** Default viewport scale.
   *
   * OpenRA 对照: viewportSizes.DefaultScale
   */
  defaultScale: number = 1

  /** Cached sprite info for current resource type. */
  private _spriteInfo: IResourceSpriteInfo | null = null

  /** Cached sprite offset. */
  private _spriteOffset: { x: number; y: number } = { x: 0, y: 0 }

  /** Canvas element for rendering. */
  private _canvas: HTMLCanvasElement | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /** Create a ResourcePreviewWidget.
   *
   * OpenRA 对照: ResourcePreviewWidget(ModData, WorldRenderer, World)
   *
   * @param resourceRenderers — available resource renderers
   * @param tileSize — base tile size
   * @param defaultScale — default viewport scale
   */
  constructor(
    resourceRenderers?: IResourceRenderer[],
    tileSize?: { width: number; height: number },
    defaultScale?: number,
  ) {
    super()
    if (resourceRenderers) this.resourceRenderers = resourceRenderers
    if (tileSize) this.tileSize = tileSize
    if (defaultScale !== undefined) this.defaultScale = defaultScale
  }

  // ---------------------------------------------------------------------------
  // Resource type setter
  // OpenRA 对照: ResourcePreviewWidget.SetResourceType(string)
  // ---------------------------------------------------------------------------

  /**
   * Set the resource type and find matching renderer.
   *
   * OpenRA 对照: ResourcePreviewWidget.SetResourceType(value)
   *
   * @param value — resource type identifier string (e.g., "ore", "gems")
   */
  setResourceType(value: string | null): void {
    this._resourceType = value
    this._spriteInfo = null

    if (value !== null) {
      // Find the first renderer that can handle this resource type
      this._resourceRenderer =
        this.resourceRenderers.find(
          (r) => r.resourceTypes.indexOf(value) >= 0,
        ) ?? null

      // Get preview sprite info
      if (this._resourceRenderer) {
        const info = this._resourceRenderer.renderPreview(
          null,
          value,
          this.defaultScale,
        )
        if (info) {
          this._spriteInfo = info
          this._spriteOffset = { x: 0, y: 0 }
          this.idealPreviewSize = {
            width: info.srcWidth || (this.tileSize.width * this.defaultScale),
            height: info.srcHeight || (this.tileSize.height * this.defaultScale),
          }
        }
      }
    } else {
      this._resourceRenderer = null
    }

    this.idealPreviewSize = {
      width: this.tileSize.width * this.defaultScale,
      height: this.tileSize.height * this.defaultScale,
    }
  }

  // ---------------------------------------------------------------------------
  // Set density value
  // ---------------------------------------------------------------------------

  /**
   * Set density value and invalidate cached canvas.
   *
   * @param density — value 0-100, clamped internally
   */
  setDensity(density: number): void {
    this._density = Math.max(0, Math.min(100, Math.round(density)))
    this._canvas = null // invalidate cache
  }

  // ---------------------------------------------------------------------------
  // Density color helper
  // ---------------------------------------------------------------------------

  /**
   * Get the density indicator color based on current density value.
   *
   * @returns CSS color string
   */
  private getDensityColor(): string {
    if (this._density <= DENSITY_LOW_THRESHOLD) return DENSITY_COLOR_LOW
    if (this._density <= DENSITY_MED_THRESHOLD) return DENSITY_COLOR_MED
    return DENSITY_COLOR_HIGH
  }

  // ---------------------------------------------------------------------------
  // Canvas rendering
  // ---------------------------------------------------------------------------

  /**
   * Draw the resource preview onto an internal canvas.
   *
   * @returns HTMLCanvasElement with the rendered preview
   */
  private drawToCanvas(): HTMLCanvasElement {
    const scale = this.scale * this.defaultScale
    const width = Math.round(this.idealPreviewSize.width * this.scale)
    const height = Math.round(this.idealPreviewSize.height * this.scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    // Draw resource sprite if available
    if (this._spriteInfo && this._spriteInfo.image) {
      const img = this._spriteInfo.image
      const sx = this._spriteInfo.srcX || 0
      const sy = this._spriteInfo.srcY || 0
      const sw = this._spriteInfo.srcWidth || img.width
      const sh = this._spriteInfo.srcHeight || img.height

      ctx.drawImage(
        img,
        sx,
        sy,
        sw,
        sh,
        this._spriteOffset.x * scale,
        this._spriteOffset.y * scale,
        sw * scale,
        sh * scale,
      )
    } else if (this._resourceType) {
      // Fallback: draw a colored rectangle as resource indicator
      ctx.fillStyle = this.getDensityColor()
      ctx.fillRect(2, 2, width - 4, height - 4)

      // Draw border
      ctx.strokeStyle = '#666666'
      ctx.lineWidth = 1
      ctx.strokeRect(1, 1, width - 2, height - 2)
    }

    // Density indicator bar at the bottom
    if (this._resourceType) {
      const barHeight = Math.max(3, Math.round(height * 0.15))
      const barY = height - barHeight
      const barWidth = Math.round((this._density / 100) * width)

      ctx.fillStyle = this.getDensityColor()
      ctx.fillRect(0, barY, barWidth, barHeight)

      // Background for unfilled portion
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.fillRect(barWidth, barY, width - barWidth, barHeight)
    }

    return canvas
  }

  // ---------------------------------------------------------------------------
  // Widget lifecycle
  // OpenRA 对照: ResourcePreviewWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * Initialize widget from args.
   *
   * OpenRA 对照: Widget.Initialize(WidgetArgs) — called by WidgetLoader
   * No extra init needed beyond parent.
   */
  override initialize(_args: WidgetArgs): void {
    super.initialize(_args)
  }

  /**
   * Render the resource preview to a DOM element.
   *
   * Renders a <canvas> element with the resource sprite and density bar.
   * OpenRA 对照: ResourcePreviewWidget.Draw()
   *
   * @returns HTMLElement — a <div> containing a <canvas>
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'resource-preview-widget')

    // Rebuild canvas if needed
    if (!this._canvas) {
      this._canvas = this.drawToCanvas()
    }

    // Clear and re-append
    while (el.lastChild) {
      el.removeChild(el.lastChild)
    }
    el.appendChild(this._canvas)

    return el
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: ResourcePreviewWidget.Clone()
  // ---------------------------------------------------------------------------

  /**
   * Clone this widget.
   *
   * OpenRA 对照: ResourcePreviewWidget.Clone()
   */
  override clone(): ResourcePreviewWidget {
    const c = new ResourcePreviewWidget(
      this.resourceRenderers,
      this.tileSize,
      this.defaultScale,
    )
    c.id = this.id
    c._xExpr = this._xExpr
    c._yExpr = this._yExpr
    c._widthExpr = this._widthExpr
    c._heightExpr = this._heightExpr
    c.logic = [...this.logic]
    c.visible = this.visible
    c.scale = this.scale
    c.idealPreviewSize = { ...this.idealPreviewSize }
    if (this._resourceType !== null) {
      c.setResourceType(this._resourceType)
    }
    c.setDensity(this._density)
    c.bounds = { ...this.bounds }
    return c
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  /**
   * Dispose widget resources.
   */
  override dispose(): void {
    this._canvas = null
    this._spriteInfo = null
    this._resourceRenderer = null
    super.dispose()
  }
}
