/**
 * ResourceBarWidget.ts — 资源/现金显示条 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ResourceBarWidget.cs (107 lines)
 *
 * 核心范式转换:
 * - OpenRA Game.Renderer.RgbaColorRenderer.FillRect() → CSS div + background-color
 * - OpenRA WidgetUtils.DrawSprite(indicator, pos) → CSS 定位的小型指示器元素
 * - OpenRA EWMA (Exponentially Weighted Moving Average) 平滑动画
 *   → TypeScript 等效 EWMA 类（α=0.3）
 * - OpenRA float2 Lerp 线性插值 → TypeScript lerp 函数
 * - OpenRA TooltipContainerWidget 延迟初始化 (Lazy<T>)
 *   → TypeScript 延迟工厂函数模式
 * - OpenRA ResourceBarOrientation enum → const 对象模式
 * - OpenRA ChromeProvider.GetImage() sprite 渲染 → CSS background-color 指示器块
 *
 * NOTE: ChromeProvider.GetImage() 尚未完全迁移 sprite 查找。
 * 指示器渲染使用 CSS 定位的彩色块。当 ChromeProvider sprite 查找可用后
 * 可替换为 sprite 图像渲染 ()。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs } from '../../OpenRA.Game/Widgets/Widget.js'
import type { ITooltipContainer } from './ButtonWidget.js'

// ---------------------------------------------------------------------------
// ResourceBarOrientation — 条方向常量
// OpenRA 对照: public enum ResourceBarOrientation { Vertical, Horizontal }
// ---------------------------------------------------------------------------

/** 资源条方向。OpenRA 对照: ResourceBarOrientation */
export const ResourceBarOrientation = {
  Vertical: 'Vertical',
  Horizontal: 'Horizontal',
} as const

/** 资源条方向类型。 */
export type ResourceBarOrientation =
  (typeof ResourceBarOrientation)[keyof typeof ResourceBarOrientation]

// ---------------------------------------------------------------------------
// EWMA — 指数加权移动平均
// OpenRA 对照: OpenRA.Primitives.EWMA (float alpha)
// ---------------------------------------------------------------------------

/**
 * 指数加权移动平均，用于平滑动画。
 *
 * 公式: value = α * newSample + (1-α) * oldValue
 *
 * OpenRA 对照: internal class EWMA
 */
export class EWMA {
  /** 平滑因子 (0 < α <= 1)。较大值响应更快，较小值更平滑。 */
  readonly alpha: number

  /** 当前 EWMA 值。 */
  private _value: number = 0

  /** 是否有过至少一个样本。 */
  private _hasValue: boolean = false

  /**
   * @param alpha — 平滑因子（默认 0.3，与 OpenRA 一致）
   */
  constructor(alpha: number = 0.3) {
    this.alpha = alpha
  }

  /** 获取当前 EWMA 值。 */
  get value(): number {
    return this._value
  }

  /**
   * 用新样本更新 EWMA 并返回新值。
   *
   * 如果是第一个样本，则直接设置为样本值（无平滑）。
   *
   * @param sample — 新样本值
   * @returns 更新后的 EWMA 值
   */
  update(sample: number): number {
    if (!this._hasValue) {
      this._value = sample
      this._hasValue = true
    } else {
      this._value = this.alpha * sample + (1 - this.alpha) * this._value
    }
    return this._value
  }

  /** 重置 EWMA 到初始状态。 */
  reset(): void {
    this._value = 0
    this._hasValue = false
  }
}

// ---------------------------------------------------------------------------
// CSS 颜色辅助
// ---------------------------------------------------------------------------

/** CSS rgba 颜色字符串。 */
type CssColor = string

/**
 * RGBA 数字颜色值接口。
 *
 * OpenRA 对照: OpenRA.Primitives.Color (32-bit ARGB struct)
 */
export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/** 将 RgbaColor 转换为 CSS rgba 字符串。 */
function toCssColor(c: RgbaColor): CssColor {
  return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
}

// ---------------------------------------------------------------------------
// ResourceBarWidget — 资源/现金条
// OpenRA 对照: public class ResourceBarWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 资源/现金显示条 widget。
 *
 * 显示已提供资源（填充条）和已使用资源（指示器标记）。
 * 使用 EWMA 平滑动画来过渡数值变化。
 *
 * OpenRA 对照: public class ResourceBarWidget : Widget
 */
export class ResourceBarWidget extends Widget {
  // ---- 配置属性 ----

  /** 工具提示模板名称。OpenRA 对照: TooltipTemplate */
  tooltipTemplate: string = 'RESOURCE_BAR_TOOLTIP'

  /** 工具提示容器 widget ID。OpenRA 对照: TooltipContainer */
  tooltipContainerId: string | null = null

  /** 资源条方向。OpenRA 对照: Orientation */
  orientation: ResourceBarOrientation = ResourceBarOrientation.Vertical

  /** ChromeProvider 集合名称（用于指示器 sprite）。OpenRA 对照: IndicatorCollection */
  indicatorCollection: string = 'sidebar-bits'

  /** 指示器图像名称。OpenRA 对照: IndicatorImage */
  indicatorImage: string = 'indicator'

  /** 指示器大小（像素）。OpenRA 对照: indicator.Size */
  indicatorSize: { x: number; y: number } = { x: 8, y: 8 }

  // ---- Func 委托 ----

  /** 获取已提供资源数量的委托。OpenRA 对照: GetProvided */
  getProvided: () => number

  /** 获取已使用资源数量的委托。OpenRA 对照: GetUsed */
  getUsed: () => number

  /** 获取条颜色的委托。OpenRA 对照: GetBarColor */
  getBarColor: () => RgbaColor

  // ---- EWMA 平滑器 ----

  /** 已提供资源的 EWMA 平滑器。OpenRA 对照: providedLerp */
  private readonly providedLerp: EWMA = new EWMA(0.3)

  /** 已使用资源的 EWMA 平滑器。OpenRA 对照: usedLerp */
  private readonly usedLerp: EWMA = new EWMA(0.3)

  // ---- 工具提示延迟初始化 ----

  /** 工具提示容器查找函数（延迟初始化）。OpenRA 对照: Lazy<TooltipContainerWidget> */
  private _tooltipContainerResolver: (() => ITooltipContainer | null) | null = null

  /** 缓存的工具提示容器实例。 */
  private _tooltipContainerCache: ITooltipContainer | null = null

  /** 工具提示容器是否已创建。 */
  private _tooltipContainerCreated: boolean = false

  // ---- DOM 元素引用 ----

  /** 填充条元素。 */
  private _fillEl: HTMLElement | null = null

  /** 指示器元素。 */
  private _indicatorEl: HTMLElement | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: public ResourceBarWidget(World world)
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // 默认委托
    this.getProvided = () => 0
    this.getUsed = () => 0
    this.getBarColor = () => ({ r: 255, g: 255, b: 255, a: 255 })
  }

  // ---------------------------------------------------------------------------
  // Tooltip container lazy initialization
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

  /** 设置工具提示容器查找函数。 */
  setTooltipContainerResolver(
    resolver: () => ITooltipContainer | null,
  ): void {
    this._tooltipContainerResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // MouseEntered / MouseExited — 工具提示集成
  // OpenRA 对照: ResourceBarWidget.MouseEntered() / MouseExited()
  // ---------------------------------------------------------------------------

  /** 鼠标进入时显示工具提示。OpenRA 对照: MouseEntered() */
  override mouseEntered(): void {
    if (!this.tooltipContainerId) return

    const container = this.tooltipContainer
    if (!container) return

    const getText = (): string => {
      const used = this.getUsed()
      const provided = this.getProvided()
      return `Used: ${Math.round(used)} / Provided: ${Math.round(provided)}`
    }

    container.setTooltip(this.tooltipTemplate, {
      getText,
    } as unknown as WidgetArgs)
  }

  /** 鼠标离开时移除工具提示。OpenRA 对照: MouseExited() */
  override mouseExited(): void {
    if (!this.tooltipContainerId || !this._tooltipContainerCreated) return

    const container = this.tooltipContainer
    if (!container) return

    container.removeTooltip()
  }

  // ---------------------------------------------------------------------------
  // Tick — 使用最新值更新 DOM
  // OpenRA 对照: ResourceBarWidget.Draw() 每帧调用
  // ---------------------------------------------------------------------------

  /** 每帧更新。将最新值推送到 DOM 元素。 */
  override tick(): void {
    if (!this.visible) return
    this._updateDom()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: ResourceBarWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染资源条为 DOM 元素。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'resource-bar-widget')
    el.style.position = 'absolute'
    el.style.overflow = 'hidden'
    el.style.boxSizing = 'border-box'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 创建填充条元素
    if (!this._fillEl) {
      this._fillEl = document.createElement('div')
      this._fillEl.className = 'resource-bar-fill'
      this._fillEl.style.position = 'absolute'
      this._fillEl.style.transition = 'none' // 手动控制，不使用 CSS 过渡
      el.appendChild(this._fillEl)
    }

    // 创建指示器元素
    if (!this._indicatorEl) {
      this._indicatorEl = document.createElement('div')
      this._indicatorEl.className = 'resource-bar-indicator'
      this._indicatorEl.style.position = 'absolute'
      this._indicatorEl.style.background = '#ffffff'
      this._indicatorEl.style.width = `${this.indicatorSize.x}px`
      this._indicatorEl.style.height = `${this.indicatorSize.y}px`
      this._indicatorEl.style.border = '1px solid #00000044'
      this._indicatorEl.style.boxShadow = '0 0 4px rgba(255,255,255,0.6)'
      el.appendChild(this._indicatorEl)
    }

    // 初始更新
    this._updateDom()

    return el
  }

  // ---------------------------------------------------------------------------
  // 内部: 更新 DOM 元素位置和尺寸
  // ---------------------------------------------------------------------------

  /**
   * 根据当前委托值更新填充条和指示器的位置/尺寸。
   *
   * 逻辑与 OpenRA ResourceBarWidget.Draw() 等价：
   * 1. 计算已提供/已使用值的缩放（自动选择比例尺）
   * 2. EWMA 平滑
   * 3. 为填充条和指示器设置 CSS 位置
   */
  private _updateDom(): void {
    const b = this.bounds
    const w = b.width
    const h = b.height

    if (w <= 0 || h <= 0) return

    // ---- 值缩放（匹配 OpenRA 的 scaleBy 逻辑） ----
    let scaleBy = 100.0
    const provided = this.getProvided()
    const used = this.getUsed()
    const max = Math.max(provided, used)
    while (max >= scaleBy) {
      scaleBy *= 2
    }

    const providedFrac = this.providedLerp.update(provided / scaleBy)
    const usedFrac = this.usedLerp.update(used / scaleBy)

    // 限制到 [0, 1]
    const clampedProvided = Math.max(0, Math.min(1, providedFrac))
    const clampedUsed = Math.max(0, Math.min(1, usedFrac))

    const color = this.getBarColor()
    const cssColor = toCssColor(color)

    const fillEl = this._fillEl!
    const indicatorEl = this._indicatorEl!

    if (this.orientation === ResourceBarOrientation.Vertical) {
      // ---- 垂直布局 ----
      // 填充条从底部向上增长
      const fillHeight = Math.round(clampedProvided * h)
      fillEl.style.left = '0'
      fillEl.style.bottom = '0'
      fillEl.style.width = '100%'
      fillEl.style.height = `${fillHeight}px`
      fillEl.style.background = cssColor

      // 指示器在已使用比例处居中
      const indX = Math.round((w - this.indicatorSize.x) / 2)
      const indY = Math.round((1 - clampedUsed) * h - this.indicatorSize.y / 2)
      indicatorEl.style.left = `${indX}px`
      indicatorEl.style.top = `${indY}px`
    } else {
      // ---- 水平布局 ----
      // 填充条从左向右增长
      const fillWidth = Math.round(clampedProvided * w)
      fillEl.style.left = '0'
      fillEl.style.top = '0'
      fillEl.style.width = `${fillWidth}px`
      fillEl.style.height = '100%'
      fillEl.style.background = cssColor

      // 指示器在已使用比例处居中
      const indX = Math.round(clampedUsed * w - this.indicatorSize.x / 2)
      const indY = Math.round((h - this.indicatorSize.y) / 2)
      indicatorEl.style.left = `${indX}px`
      indicatorEl.style.top = `${indY}px`
    }

    // 指示器颜色：匹配填充条但更亮
    indicatorEl.style.background = cssColor.replace(
      /rgba\((\d+),(\d+),(\d+),([^)]+)\)/,
      (_, r, g, b, a) => {
        const brighten = (v: number): number =>
          Math.min(255, Math.round(Number(v) * 1.5))
        return `rgba(${brighten(r)},${brighten(g)},${brighten(b)},${a})`
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /** 清理资源。 */
  override dispose(): void {
    if ((this as unknown as { _disposed?: boolean })._disposed) return
    this._fillEl = null
    this._indicatorEl = null
    this._tooltipContainerCache = null
    this._tooltipContainerResolver = null
    super.dispose()
  }
}
