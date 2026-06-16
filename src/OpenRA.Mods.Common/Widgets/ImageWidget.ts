/**
 * ImageWidget.ts -- 静态图像/精灵显示 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ImageWidget.cs (98 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.DrawSprite() (SDL2 位图渲染) -> DOM <img> 元素 或 CSS background-image
 * - OpenRA ChromeProvider.GetImage() (运行时精灵查找) -> ChromeProvider.getImage() 返回图像 URL
 * - OpenRA CachedTransform<(string, string), Sprite> -> 简单函数闭包缓存
 * - OpenRA TooltipContainerWidget lazy 引用 -> _tooltipContainerResolver 延迟初始化模式
 * - OpenRA Func<string> 委托 -> TypeScript () => string 函数
 * - OpenRA HandleMouseInput 命中测试 -> DOM pointer-events 控制 + boundsContains
 */
import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import { boundsContains } from '../../OpenRA.Game/Widgets/Widget.js'
import { ChromeProvider } from '../../OpenRA.Game/Graphics/ChromeProvider.js'

import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'
import type { WidgetArgs, WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// ImageWidget -- 静态图像/精灵显示
// OpenRA 对照: public class ImageWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 静态图像/精灵显示 widget。
 *
 * 通过 ChromeProvider 精灵图集或直接图像 URL 渲染精灵。
 * 支持动态图像切换（通过 GetImageName/GetImageCollection 委托）。
 * 可选工具提示集成。
 *
 * OpenRA 对照: public class ImageWidget : Widget
 */
export class ImageWidget extends Widget {
  // ---- 图像属性 ----

  /** ChromeProvider 集合名称。OpenRA 对照: ImageWidget.ImageCollection */
  imageCollection: string = ''

  /** 集合中的图像名称。OpenRA 对照: ImageWidget.ImageName */
  imageName: string = ''

  /** 是否穿透点击（true 时不消费鼠标事件）。OpenRA 对照: ImageWidget.ClickThrough */
  clickThrough: boolean = true

  /** 是否缩放纹理以填充 bounds（CSS background-size: cover vs contain）。
   *
   * NOTE: OpenRA 原始版本无此属性。web 迁移新增，用于控制 CSS
   * background-size 行为。true = cover (裁剪填充), false = contain (完整显示)。
   */
  scaleTexture: boolean = false

  // ---- Func 委托 ----

  /** 获取图像名称的委托。OpenRA 对照: ImageWidget.GetImageName */
  getImageName: () => string

  /** 获取图像集合名称的委托。OpenRA 对照: ImageWidget.GetImageCollection */
  getImageCollection: () => string

  /** 获取精灵对象的委托（从 ChromeProvider 查找）。
   * OpenRA 对照: ImageWidget.GetSprite */
  getSprite: () => Sprite | null

  // ---- 工具提示属性 ----

  /** 工具提示模板名称。OpenRA 对照: ImageWidget.TooltipTemplate */
  tooltipTemplate: string | null = null

  /** 工具提示容器 ID。OpenRA 对照: ImageWidget.TooltipContainer */
  tooltipContainerId: string | null = null

  /** 工具提示文本（Fluent 键）。OpenRA 对照: ImageWidget.TooltipText */
  tooltipText: string | null = null

  /** 获取工具提示文本的委托。OpenRA 对照: ImageWidget.GetTooltipText */
  getTooltipText: (() => string) | null = null

  // ---- 内部状态 ----

  /** 工具提示容器延迟解析器。 */
  private _tooltipContainerResolver:
    | (() => ITooltipContainer | null)
    | null = null

  /** 缓存的工具提示容器。 */
  private _tooltipContainerCache: ITooltipContainer | null = null

  /** 工具提示容器是否已创建。 */
  private _tooltipContainerCreated: boolean = false

  /** 缓存的精灵 URL（用于 CSS background-image）。 */
  private _cachedImageUrl: string = ''

  /** 图像集合 + 名称缓存输入（用于精灵查找缓存失效）。 */
  private _cachedCollection: string = ''
  private _cachedImageName: string = ''

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: ImageWidget() / ImageWidget(ImageWidget)
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // OpenRA 对照: 委托初始化
    this.getImageName = () => this.imageName
    this.getImageCollection = () => this.imageCollection

    // OpenRA 对照: CachedTransform<(string, string), Sprite>
    // 按 (collection, imageName) 键缓存 Sprite 查找结果
    // NOTE: 迁移后，"sprite" 由 URL + CSS 渲染，但保持相同的缓存语义
    this._cachedCollection = ''
    this._cachedImageName = ''

    this.getSprite = () => {
      const col = this.getImageCollection()
      const name = this.getImageName()
      if (col !== this._cachedCollection || name !== this._cachedImageName) {
        this._cachedCollection = col
        this._cachedImageName = name
        // NOTE: ChromeProvider.getImage() 返回 DPI 感知的 URL
        // 单独的具名精灵查找在此简化 — 返回 URL 字符串以驱动 CSS
        this._cachedImageUrl = ChromeProvider.getImage(col)
      }
      // 返回 null 是有效的（当集合不存在时）
      if (!this._cachedImageUrl) return null
      // 构造一个最小 Sprite 表示（仅用于 URL 引用）
      // NOTE: 迁移后 WidgetUtils.DrawSprite 不使用真实的 Sprite 对象
      // 而是使用 CSS background-image。getSprite() 返回 null 表示无图像。
      return null // 提示: CSS 路径由 getImageUrl() 单独处理
    }

    // OpenRA 对照: CachedTransform + FluentProvider.GetMessage (工具提示)
    // TODO-16.A.3: Fluent 集成尚未迁移，使用直通模式。
    let tooltipCache: string | null = null
    let tooltipCacheInput: string | null = null
    this.getTooltipText = () => {
      const raw = this.tooltipText
      if (raw !== tooltipCacheInput) {
        tooltipCacheInput = raw
        tooltipCache = raw && raw.length > 0 ? raw : ''
      }
      return tooltipCache || ''
    }
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected ImageWidget(ImageWidget other) : base(other)
   */
  protected copyFrom(other: ImageWidget): void {
    this.imageCollection = other.imageCollection
    this.imageName = other.imageName
    this.clickThrough = other.clickThrough
    this.scaleTexture = other.scaleTexture
    this.getImageName = other.getImageName
    this.getImageCollection = other.getImageCollection
    this.getSprite = other.getSprite
    this.tooltipTemplate = other.tooltipTemplate
    this.tooltipContainerId = other.tooltipContainerId
    this.tooltipText = other.tooltipText
    this.getTooltipText = other.getTooltipText
    this._tooltipContainerResolver = other._tooltipContainerResolver
    this._cachedImageUrl = other._cachedImageUrl
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override ImageWidget Clone()
  // ---------------------------------------------------------------------------

  override clone(): ImageWidget {
    const cloned = new ImageWidget()
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
  // TooltipContainer 延迟初始化
  // OpenRA 对照: Exts.Lazy(() => Ui.Root.Get<TooltipContainerWidget>(...))
  // ---------------------------------------------------------------------------

  /** 获取工具提示容器（延迟初始化）。 */
  get tooltipContainer(): ITooltipContainer | null {
    if (!this._tooltipContainerCreated) {
      this._tooltipContainerCreated = true
      if (this._tooltipContainerResolver) {
        this._tooltipContainerCache = this._tooltipContainerResolver()
      }
    }
    return this._tooltipContainerCache
  }

  /** 工具提示容器是否已创建。 */
  get isTooltipContainerCreated(): boolean {
    return this._tooltipContainerCreated
  }

  /** 设置工具提示容器查找函数。 */
  setTooltipContainerResolver(
    resolver: () => ITooltipContainer | null,
  ): void {
    this._tooltipContainerResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // Image URL resolution
  // ---------------------------------------------------------------------------

  /**
   * 获取当前图像的 URL。
   *
   * 优先调用 getImageCollection/getImageName 委托查找 ChromeProvider 精灵。
   * 如果集合为空，尝试将 imageName 解释为直接 URL。
   *
   * @returns 图像 URL，如果找不到则返回空字符串
   */
  getImageUrl(): string {
    const col = this.getImageCollection()
    const name = this.getImageName()

    if (col !== this._cachedCollection || name !== this._cachedImageName) {
      this._cachedCollection = col
      this._cachedImageName = name

      if (col && col.length > 0) {
        // ChromeProvider 精灵图集路径
        this._cachedImageUrl = ChromeProvider.getImage(col)
      } else if (name && name.length > 0) {
        // 直接 URL
        this._cachedImageUrl = name
      } else {
        this._cachedImageUrl = ''
      }
    }

    return this._cachedImageUrl
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // OpenRA 对照: ImageWidget.HandleMouseInput (MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * 处理鼠标事件。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   *
   * 如果 ClickThrough 为 true，则不消费任何鼠标事件。
   * 否则，如果鼠标在 RenderBounds 内则消费事件。
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (this.clickThrough) return false

    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number
    return boundsContains(this.bounds, x, y)
  }

  // ---------------------------------------------------------------------------
  // MouseEntered / MouseExited -- 工具提示集成
  // OpenRA 对照: ImageWidget.MouseEntered() / MouseExited()
  // ---------------------------------------------------------------------------

  override mouseEntered(): void {
    if (!this.tooltipContainerId || !this.getTooltipText) return

    const container = this.tooltipContainer
    if (!container) return

    container.setTooltip(this.tooltipTemplate || 'IMAGE_TOOLTIP', {
      getText: () => this.getTooltipText!(),
    } as WidgetArgs)
  }

  override mouseExited(): void {
    if (
      !this.tooltipContainerId ||
      !this._tooltipContainerCreated
    )
      return

    const container = this.tooltipContainer
    if (!container) return

    container.removeTooltip()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Widget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染图像为 DOM 元素。
   *
   * 使用 CSS background-image 显示精灵。
   * 如果 ClickThrough 为 true，设置 pointer-events: none 允许事件穿透。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'image-widget')
    el.style.position = 'absolute'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'

    // 点击穿透
    if (this.clickThrough) {
      el.style.pointerEvents = 'none'
    } else {
      el.style.pointerEvents = ''
    }

    // 设置 widget ID
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 获取图像 URL 并应用为背景
    const url = this.getImageUrl()
    if (url) {
      el.style.backgroundImage = `url("${url}")`
      el.style.backgroundRepeat = 'no-repeat'
      el.style.backgroundPosition = 'center'
      el.style.backgroundSize = this.scaleTexture ? 'cover' : 'contain'
    } else {
      el.style.backgroundImage = ''
    }

    return el
  }
}

// ---------------------------------------------------------------------------
// ITooltipContainer -- 工具提示容器接口
// OpenRA 对照: TooltipContainerWidget 的最小接口
// ---------------------------------------------------------------------------

/**
 * TooltipContainerWidget 的最小接口。
 *
 * 仅暴露 setTooltip / removeTooltip 方法。
 * 避免循环依赖。
 *
 * OpenRA 对照: TooltipContainerWidget
 */
export interface ITooltipContainer {
  /** 设置工具提示。OpenRA 对照: TooltipContainerWidget.SetTooltip */
  setTooltip(template: string, args: WidgetArgs): void
  /** 移除工具提示。OpenRA 对照: TooltipContainerWidget.RemoveTooltip */
  removeTooltip(): void
}
