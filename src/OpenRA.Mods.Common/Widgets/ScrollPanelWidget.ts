/**
 * ScrollPanelWidget.ts — 可滚动内容容器 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ScrollPanelWidget.cs (527 lines)
 *
 * 核心范式转换:
 * - OpenRA Game.Renderer.EnableScissor() 裁剪 → CSS overflow: hidden
 * - OpenRA ChildOrigin 偏移渲染子 widget → CSS transform: translateY(scrollOffset)
 * - OpenRA 自定义滚动条 sprite 渲染 → DOM 定位的 scrollbar/thumb div
 * - OpenRA 平滑滚动物理 → performance.now() 增量 + 摩擦减速
 * - OpenRA IObservableCollection 绑定 → TypeScript 回调模式
 * - OpenRA WidgetUtils.DrawPanel 9-slice → CSS border-image (由背景类处理)
 *
 * ScrollPanelWidget 是最复杂的 Phase A widget。它管理可滚动内容区域、
 * 渲染滚动条（含拖拽滑块和上下箭头按钮）、支持鼠标滚轮和键盘导航、
 * 以及平滑/动量滚动。它还可以绑定到 IObservableCollection 进行动态项目列表。
 */

import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { ILayout } from './ILayout.js'
import { ListLayout, type ILayoutHost } from './ListLayout.js'
import type { ScrollItemWidget } from './ScrollItemWidget.js'

// ---------------------------------------------------------------------------
// ScrollPanelAlign — 内容对齐方式
// OpenRA 对照: public enum ScrollPanelAlign { Bottom, Top }
//
// NOTE: 使用 const 对象 + 类型别名替代 TypeScript enum，
//       以兼容 tsconfig erasableSyntaxOnly。
// ---------------------------------------------------------------------------

/** 内容对齐方式常量。OpenRA 对照: ScrollPanelAlign */
export const ScrollPanelAlign = {
  /** 内容从顶部对齐（标准行为）。 */
  Top: 'Top',
  /** 内容从底部对齐（如聊天窗口）。 */
  Bottom: 'Bottom',
} as const

/** 内容对齐方式类型。 */
export type ScrollPanelAlign =
  (typeof ScrollPanelAlign)[keyof typeof ScrollPanelAlign]

// ---------------------------------------------------------------------------
// ScrollBar — 滚动条位置
// OpenRA 对照: public enum ScrollBar { Left, Right, Hidden }
// ---------------------------------------------------------------------------

/** 滚动条位置常量。OpenRA 对照: ScrollBar */
export const ScrollBar = {
  /** 滚动条在左侧。 */
  Left: 'Left',
  /** 滚动条在右侧（默认）。 */
  Right: 'Right',
  /** 隐藏滚动条。 */
  Hidden: 'Hidden',
} as const

/** 滚动条位置类型。 */
export type ScrollBar = (typeof ScrollBar)[keyof typeof ScrollBar]

// ---------------------------------------------------------------------------
// IObservableCollection — 可观察集合接口
// OpenRA 对照: IObservableCollection (framework interface)
// ---------------------------------------------------------------------------

/** 可观察集合接口。
 *
 * 允许 ScrollPanelWidget 绑定到动态数据源。
 * 集合变化触发 ScrollPanelWidget 重新创建子 widget。
 *
 * OpenRA 对照: IObservableCollection
 */
export interface IObservableCollection<T = unknown> {
  /** 集合中的所有项目。 */
  observedItems: T[]

  /** 添加项目时触发。 */
  onAdd?: ((col: IObservableCollection<T>, item: T) => void) | null

  /** 移除项目时触发。 */
  onRemove?: ((col: IObservableCollection<T>, item: T) => void) | null

  /** 按索引移除项目时触发。 */
  onRemoveAt?: ((col: IObservableCollection<T>, index: number) => void) | null

  /** 项目被替换时触发。 */
  onSet?:
    | ((col: IObservableCollection<T>, oldItem: T, newItem: T) => void)
    | null

  /** 整个集合需要刷新时触发。 */
  onRefresh?: ((col: IObservableCollection<T>) => void) | null
}

// ---------------------------------------------------------------------------
// ScrollPanelWidget — 可滚动内容容器
// OpenRA 对照: public class ScrollPanelWidget : Widget
// ---------------------------------------------------------------------------

/** 可滚动内容容器 widget。
 *
 * 管理可滚动内容区域，渲染滚动条（含可拖拽滑块），
 * 处理鼠标滚轮、键盘导航和平滑动量滚动。
 * 可绑定到 IObservableCollection 进行动态项目列表。
 *
 * OpenRA 对照: ScrollPanelWidget
 */
export class ScrollPanelWidget extends Widget implements ILayoutHost {
  // ---- 布局配置 ----

  /** 滚动条宽度（像素）。OpenRA 对照: ScrollbarWidth */
  scrollbarWidth: number = 24

  /** 边框宽度（像素）。OpenRA 对照: BorderWidth */
  borderWidth: number = 1

  /** 顶部/底部间距。OpenRA 对照: TopBottomSpacing */
  topBottomSpacing: number = 2

  /** 条目间距。OpenRA 对照: ItemSpacing */
  itemSpacing: number = 0

  /** 最小滑块高度。OpenRA 对照: MinimumThumbSize */
  minimumThumbSize: number = 10

  /** 内容对齐方式。OpenRA 对照: Align */
  panelAlign: ScrollPanelAlign = ScrollPanelAlign.Top

  /** 滚动条位置。OpenRA 对照: ScrollBar */
  scrollBar: ScrollBar = ScrollBar.Right

  /** 是否折叠隐藏的子 widget。OpenRA 对照: CollapseHiddenChildren */
  collapseHiddenChildren: boolean = false

  /** 加速滚动速度（像素/帧，当按钮被持续按下时）。OpenRA 对照: UIScrollSpeed */
  uiScrollSpeed: number = 30

  // ---- 滚动状态 ----

  /** 总内容高度（像素）。OpenRA 对照: ContentHeight */
  contentHeight: number = 0

  /** 平滑滚动速度（每 40ms 剩余增量的比例）。
   * OpenRA 对照: SmoothScrollSpeed */
  smoothScrollSpeed: number = 0.333

  // ---- 布局 ----

  /** 子 widget 布局策略。OpenRA 对照: Layout */
  layout: ILayout

  // ---- 项目模板 ----

  /** 项目模板 ID（用于克隆每个集合项的 widget）。OpenRA 对照: 隐含在 WidgetLoader 中 */
  itemTemplateId: string | null = null

  /** 预缓存的模板 widget（从 itemTemplateId 加载）。 */
  private _itemTemplate: Widget | null = null

  // ---- 内部滚动状态 ----

  /** 目标列表偏移量。OpenRA 对照: targetListOffset */
  private _targetListOffset: number = 0

  /** 当前实际列表偏移量。OpenRA 对照: currentListOffset */
  private _currentListOffset: number = 0

  /** 上次调用 updateSmoothScrolling 的时间戳。
   * OpenRA 对照: lastSmoothScrollTime */
  private _lastSmoothScrollTime: number = 0

  // ---- 按钮/滑块状态 ----

  /** 上箭头按钮是否被按下。OpenRA 对照: upPressed */
  private _upPressed: boolean = false

  /** 下箭头按钮是否被按下。OpenRA 对照: downPressed */
  private _downPressed: boolean = false

  /** 上箭头按钮是否禁用。OpenRA 对照: upDisabled */
  private _upDisabled: boolean = false

  /** 下箭头按钮是否禁用。OpenRA 对照: downDisabled */
  private _downDisabled: boolean = false

  /** 滑块是否被按下。OpenRA 对照: thumbPressed */
  private _thumbPressed: boolean = false

  /** 上次鼠标位置（用于滑块拖拽）。OpenRA 对照: lastMouseLocation */
  private _lastMouseY: number = 0

  // NOTE: _thumbHovered, _upHovered, _downHovered 状态追踪在
  // _handleMouseMove 中更新，用于未来 CSS 状态类。当前通过 rect 包含检测计算。

  // ---- 集合绑定 ----

  /** 绑定的可观察集合。OpenRA 对照: collection */
  // NOTE: 使用 any 类型以匹配 OpenRA 的 object 通用类型擦除
  private _collection: IObservableCollection<any> | null = null

  /** Widget 工厂函数。OpenRA 对照: makeWidget */
  private _makeWidget: ((item: any) => Widget) | null = null

  /** Widget 与项目比较函数。OpenRA 对照: widgetItemEquals */
  private _widgetItemEquals:
    | ((widget: Widget, item: any) => boolean)
    | null = null

  /** 是否自动滚动到底部。OpenRA 对照: autoScroll */
  private _autoScroll: boolean = false

  // ---- DOM 元素缓存 ----

  /** 内容容器 div ref。 */
  private _contentEl: HTMLElement | null = null

  /** 滚动条容器 div ref。 */
  private _scrollbarEl: HTMLElement | null = null

  /** 滑块 div ref。 */
  private _thumbEl: HTMLElement | null = null

  /** 上箭头按钮 div ref。 */
  private _upArrowEl: HTMLElement | null = null

  /** 下箭头按钮 div ref。 */
  private _downArrowEl: HTMLElement | null = null

  // ---- 缓存的矩形（用于点击检测） ----

  private _upButtonRect: { x: number; y: number; w: number; h: number } = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  }
  private _downButtonRect: { x: number; y: number; w: number; h: number } = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  }
  private _thumbRect: { x: number; y: number; w: number; h: number } = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  }
  // NOTE: _scrollbarRect 在 _updateRects 中计算但尚未在渲染中使用，
  // 未来可用于滚动条背景样式。

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()
    // 默认布局为 ListLayout
    this.layout = new ListLayout(this)
    // ScrollPanel 忽略自身的鼠标悬停
    this.ignoreMouseOver = true
  }

  // ---------------------------------------------------------------------------
  // Public scroll API
  // OpenRA 对照: ScrollToTop, ScrollToBottom, ScrollToItem, ScrollToSelectedItem
  // ---------------------------------------------------------------------------

  /** 获取当前滚动位置（像素，<=0 表示内容已向上滚动）。
   * OpenRA 对照: currentListOffset */
  get scrollPosition(): number {
    return this._currentListOffset
  }

  /** 是否已滚动到底部。
   * OpenRA 对照: ScrolledToBottom */
  get scrolledToBottom(): boolean {
    const bottomLimit = Math.min(0, this.bounds.height - this.contentHeight)
    return (
      this._targetListOffset === bottomLimit ||
      this.contentHeight <= this.bounds.height
    )
  }

  /** 滚动到顶部。
   *
   * OpenRA 对照: ScrollToTop(bool smooth)
   *
   * @param smooth — 如果为 true，使用平滑滚动；否则立即滚动
   */
  scrollToTop(smooth: boolean = false): void {
    const value =
      this.panelAlign === ScrollPanelAlign.Top
        ? 0
        : Math.max(0, this.bounds.height - this.contentHeight)
    this._setListOffset(value, smooth)
  }

  /** 滚动到底部。
   *
   * OpenRA 对照: ScrollToBottom(bool smooth)
   *
   * @param smooth — 如果为 true，使用平滑滚动；否则立即滚动
   */
  scrollToBottom(smooth: boolean = false): void {
    const value =
      this.panelAlign === ScrollPanelAlign.Top
        ? Math.min(0, this.bounds.height - this.contentHeight)
        : this.bounds.height - this.contentHeight
    this._setListOffset(value, smooth)
  }

  /** 滚动到指定位置。
   *
   * @param position — 目标滚动偏移量（像素）
   * @param smooth — 如果为 true，使用平滑滚动；否则立即滚动
   */
  scrollTo(position: number, smooth: boolean = false): void {
    const clamped = Math.min(
      0,
      Math.max(this.bounds.height - this.contentHeight, position),
    )
    this._setListOffset(clamped, smooth)
  }

  /** 滚动指定量（正数 = 向上滚动，负数 = 向下滚动）。
   *
   * OpenRA 对照: Scroll(int amount, bool smooth)
   *
   * @param amount — 滚动步数（每步 uiScrollSpeed 像素）
   * @param smooth — 如果为 true，使用平滑滚动
   */
  scroll(amount: number, smooth: boolean = false): void {
    const newTarget =
      this._targetListOffset + amount * this.uiScrollSpeed
    const clamped = Math.min(
      0,
      Math.max(this.bounds.height - this.contentHeight, newTarget),
    )
    this._setListOffset(clamped, smooth)
  }

  /** 滚动使项目 widget 可见。
   *
   * OpenRA 对照: ScrollToItem(Widget item, bool smooth)
   *
   * @param item — 要滚动到可见区域的项目 widget
   * @param smooth — 如果为 true，使用平滑滚动
   */
  scrollToItem(item: Widget, smooth: boolean = false): void {
    let newOffset: number | null = null
    if (item.bounds.y + this._currentListOffset < 0) {
      newOffset = this.itemSpacing - item.bounds.y
    }
    if (
      item.bounds.y + item.bounds.height + this._currentListOffset >
      this.bounds.height
    ) {
      newOffset =
        this.bounds.height - item.bounds.y - item.bounds.height - this.itemSpacing
    }
    if (newOffset !== null) {
      this._setListOffset(newOffset, smooth)
    }
  }

  /** 按项目键滚动使项目可见。
   *
   * OpenRA 对照: ScrollToItem(string itemKey, bool smooth)
   *
   * @param itemKey — 要查找的项目键
   * @param smooth — 如果为 true，使用平滑滚动
   */
  scrollToItemByKey(itemKey: string, smooth: boolean = false): void {
    const item = this.children.find(
      (c) => (c as ScrollItemWidget).itemKey === itemKey,
    )
    if (item) {
      this.scrollToItem(item, smooth)
    }
  }

  /** 滚动到当前选中项目。
   *
   * OpenRA 对照: ScrollToSelectedItem()
   */
  scrollToSelectedItem(): void {
    const item = this.children.find(
      (c) => (c as ScrollItemWidget).isSelected?.(),
    )
    if (item) {
      this.scrollToItem(item)
    }
  }

  // ---------------------------------------------------------------------------
  // Collection binding
  // OpenRA 对照: Bind / Unbind / BindingAdd / BindingRemove / etc.
  // ---------------------------------------------------------------------------

  /** 解除集合绑定。
   *
   * OpenRA 对照: Unbind()
   */
  unbind(): void {
    this.bindToCollection(null, null, null, false)
  }

  /** 绑定到可观察集合。
   *
   * 绑定后，集合的变化（添加、移除、替换、刷新）会自动更新
   * 滚动面板的子 widget。
   *
   * OpenRA 对照: Bind(IObservableCollection, Func, Func, bool)
   *
   * @param collection — 要绑定的可观察集合，null 表示解除绑定
   * @param makeWidget — 从集合项创建 widget 的工厂函数
   * @param widgetItemEquals — 比较 widget 和集合项的函数
   * @param autoScroll — 添加新项目时是否自动滚动到底部
   */
  bindToCollection<T = unknown>(
    collection: IObservableCollection<T> | null,
    makeWidget: ((item: T) => Widget) | null,
    widgetItemEquals:
      | ((widget: Widget, item: T) => boolean)
      | null,
    autoScroll: boolean,
  ): void {
    this._autoScroll = autoScroll

    // 使用微任务延迟执行（模拟 Game.RunAfterTick）
    // 这确保在解除旧绑定的同一帧内不会处理旧集合事件
    queueMicrotask(() => {
      // 解除旧集合的事件订阅
      if (this._collection) {
        if (this._collection.onAdd) {
          this._collection.onAdd = null
        }
        if (this._collection.onRemove) {
          this._collection.onRemove = null
        }
        if (this._collection.onRemoveAt) {
          this._collection.onRemoveAt = null
        }
        if (this._collection.onSet) {
          this._collection.onSet = null
        }
        if (this._collection.onRefresh) {
          this._collection.onRefresh = null
        }
      }

      this._makeWidget = makeWidget
      this._widgetItemEquals = widgetItemEquals

      this.removeChildren()
      this._collection = collection

      if (collection) {
        // 为每个现有项目创建 widget
        for (const item of collection.observedItems) {
          this._bindingAddImpl(item)
        }

        // 订阅集合变化事件
        collection.onAdd = (col, item) => {
          if (col !== this._collection) return
          queueMicrotask(() => {
            if (col !== this._collection) return
            this._bindingAddImpl(item)
          })
        }

        collection.onRemove = (col, item) => {
          if (col !== this._collection) return
          queueMicrotask(() => {
            if (col !== this._collection) return
            const widget = this._widgetItemEquals
              ? this.children.find((w) =>
                  this._widgetItemEquals!(w, item),
                )
              : null
            if (widget) {
              this.removeChild(widget)
            }
          })
        }

        collection.onRemoveAt = (col, index) => {
          if (col !== this._collection) return
          queueMicrotask(() => {
            if (
              col !== this._collection ||
              index < 0 ||
              index >= this.children.length
            )
              return
            this.removeChild(this.children[index])
          })
        }

        collection.onSet = (col, oldItem, newItem) => {
          if (col !== this._collection) return
          queueMicrotask(() => {
            if (col !== this._collection || !this._makeWidget) return
            const newWidget = this._makeWidget(newItem)
            newWidget.parent = this

            if (this._widgetItemEquals) {
              const i = this.children.findIndex((w) =>
                this._widgetItemEquals!(w, oldItem),
              )
              if (i >= 0) {
                const oldWidget = this.children[i]
                oldWidget.removed()
                this.children[i] = newWidget
                this.layout.adjustChildren()
              } else {
                this.addChild(newWidget)
              }
            } else {
              this.addChild(newWidget)
            }
          })
        }

        collection.onRefresh = (col) => {
          if (col !== this._collection) return
          queueMicrotask(() => {
            if (col !== this._collection) return
            this.removeChildren()
            for (const item of collection.observedItems) {
              this._bindingAddImpl(item)
            }
          })
        }
      }
    })
  }

  /** 添加单个集合项目到面板（内部实现）。
   * OpenRA 对照: BindingAddImpl(object) */
  private _bindingAddImpl(item: unknown): void {
    if (!this._makeWidget) return
    const widget = this._makeWidget(item)
    const scrollToBottom = this._autoScroll && this.scrolledToBottom
    this.addChild(widget)
    if (scrollToBottom) {
      this.scrollToBottom()
    }
  }

  // ---------------------------------------------------------------------------
  // Layout host implementation (ILayoutHost)
  // ---------------------------------------------------------------------------

  // children, contentHeight, topBottomSpacing, itemSpacing, collapseHiddenChildren
  // are already defined above as class properties

  // ---------------------------------------------------------------------------
  // Item template
  // ---------------------------------------------------------------------------

  /** 设置项目模板 widget。
   *
   * 此模板将被克隆以创建集合中的每个项目。
   *
   * @param widget — 模板 widget（通常为 ScrollItemWidget）
   */
  setItemTemplate(widget: Widget): void {
    this._itemTemplate = widget
  }

  /** 获取项目模板。 */
  getItemTemplate(): Widget | null {
    return this._itemTemplate
  }

  // ---------------------------------------------------------------------------
  // Add / Remove children — 重写以集成 Layout
  // OpenRA 对照: AddChild / RemoveChild / RemoveChildren
  // ---------------------------------------------------------------------------

  /** 添加子 widget 并集成 Layout。
   * OpenRA 对照: ScrollPanelWidget.AddChild(Widget) */
  override addChild(child: Widget): void {
    this.layout.adjustChild(child)
    super.addChild(child)
  }

  /** 移除子 widget 并重新计算 Layout。
   * OpenRA 对照: ScrollPanelWidget.RemoveChild(Widget) */
  override removeChild(child: Widget): void {
    super.removeChild(child)
    this.layout.adjustChildren()
    this.scroll(0)
  }

  /** 移除所有子 widget 并重置 ContentHeight。
   * OpenRA 对照: ScrollPanelWidget.RemoveChildren() */
  override removeChildren(): void {
    this.contentHeight = 0
    super.removeChildren()
    this.scroll(0)
  }

  /** 替换子 widget。
   * OpenRA 对照: ReplaceChild(Widget, Widget) */
  replaceChild(oldChild: Widget, newChild: Widget): void {
    oldChild.removed()
    newChild.parent = this
    const idx = this.children.indexOf(oldChild)
    if (idx >= 0) {
      this.children[idx] = newChild
    }
    this.layout.adjustChildren()
    this.scroll(0)
  }

  // ---------------------------------------------------------------------------
  // Internal scroll state management
  // ---------------------------------------------------------------------------

  /** 设置列表偏移量。
   *
   * 当 smooth=false 时，立即设置 currentListOffset；
   * 当 smooth=true 时，仅设置 targetListOffset，平滑滚动会逐渐调整。
   *
   * OpenRA 对照: SetListOffset(float value, bool smooth)
   */
  private _setListOffset(value: number, smooth: boolean): void {
    this._targetListOffset = value
    if (!smooth) {
      const oldOffset = this._currentListOffset
      this._currentListOffset = value
      // 如果偏移量改变，重置提示
      if (oldOffset !== value) {
        // NOTE: 在 DOM 实现中，我们更新内容变换而不是调用 Ui.ResetTooltips
        this._updateContentTransform()
      }
    }
  }

  /** 更新内容 div 的 CSS 变换。
   * 将 currentListOffset 应用到内容容器。 */
  private _updateContentTransform(): void {
    if (this._contentEl) {
      this._contentEl.style.transform = `translateY(${this._currentListOffset}px)`
    }
  }

  // ---------------------------------------------------------------------------
  // Smooth scrolling physics
  // OpenRA 对照: UpdateSmoothScrolling()
  // ---------------------------------------------------------------------------

  /** 每帧更新平滑滚动。
   *
   * 使用指数衰减向目标偏移移动 currentListOffset。
   * 当剩余差值 <= 1px 时捕捉到目标。
   *
   * OpenRA 对照: UpdateSmoothScrolling()
   */
  private _updateSmoothScrolling(): void {
    const now = performance.now()

    if (this._lastSmoothScrollTime === 0) {
      this._lastSmoothScrollTime = now
      return
    }

    const offsetDiff = this._targetListOffset - this._currentListOffset
    const absOffsetDiff = Math.abs(offsetDiff)

    if (absOffsetDiff > 1.0) {
      const dt = now - this._lastSmoothScrollTime
      // 匹配 OpenRA: currentListOffset += offsetDiff * SmoothScrollSpeed.Clamp(0.1f, 1.0f) * dt / 40
      const clampedSpeed = Math.min(
        1.0,
        Math.max(0.1, this.smoothScrollSpeed),
      )
      this._currentListOffset +=
        offsetDiff * clampedSpeed * (dt / 40)
      this._updateContentTransform()
    } else {
      this._setListOffset(this._targetListOffset, false)
    }

    this._lastSmoothScrollTime = now
  }

  // ---------------------------------------------------------------------------
  // Tick — 每帧更新
  // OpenRA 对照: Tick()
  // ---------------------------------------------------------------------------

  /** 每帧调用 — 处理持续按钮按下和平滑滚动。
   * OpenRA 对照: ScrollPanelWidget.Tick() */
  override tick(): void {
    // 持续按下上/下按钮时滚动
    if (this._upPressed) {
      this.scroll(1)
    }
    if (this._downPressed) {
      this.scroll(-1)
    }

    // 更新平滑滚动
    this._updateSmoothScrolling()

    // 更新箭头按钮的禁用状态
    this._upDisabled =
      this._thumbHeight === 0 || this._currentListOffset >= 0
    this._downDisabled =
      this._thumbHeight === 0 ||
      this._currentListOffset <=
        this.bounds.height - this.contentHeight

    // 更新 DOM 滑块位置和大小
    this._syncThumbToDOM()
  }

  // ---------------------------------------------------------------------------
  // Scrollbar geometry helpers
  // ---------------------------------------------------------------------------

  /** 获取渲染边界的高度（用于滚动计算）。 */
  private get _renderHeight(): number {
    return this.bounds.height
  }

  /** 滚动条轨道高度（减去上下按钮）。 */
  private get _scrollbarHeight(): number {
    return this._renderHeight - 2 * this.scrollbarWidth
  }

  /** 计算滑块高度（像素）。
   * 匹配 OpenRA: thumbHeight = Math.Max(MinimumThumbSize, scrollbarHeight * rb.Height / ContentHeight) */
  private get _thumbHeight(): number {
    if (this.contentHeight <= this.bounds.height) return 0
    return Math.max(
      this.minimumThumbSize,
      (this._scrollbarHeight * this.bounds.height) / this.contentHeight,
    )
  }

  /** 计算滑块 Y 原点（相对于滚动条轨道顶部）。
   * 匹配 OpenRA: thumbOrigin += (int)((scrollbarHeight - thumbHeight) * currentListOffset / (rb.Height - ContentHeight)) */
  private get _thumbOrigin(): number {
    const thumbHeight = this._thumbHeight
    if (thumbHeight === 0) return 0
    const travelRange = this._scrollbarHeight - thumbHeight
    const scrollRange = this.bounds.height - this.contentHeight
    if (scrollRange === 0) return 0
    return (travelRange * this._currentListOffset) / scrollRange
  }

  // ---------------------------------------------------------------------------
  // Scrollbar rect calculations (matching OpenRA DrawOuter rects)
  // ---------------------------------------------------------------------------

  /** 更新滚动条组件的缓存矩形。 */
  private _updateRects(): void {
    const rb = this.bounds
    const sw = this.scrollbarWidth
    // const { _scrollbarHeight: trackH } = this — 保留用于 _scrollbarRect 计算

    switch (this.scrollBar) {
      case ScrollBar.Left:
        this._upButtonRect = { x: rb.x, y: rb.y, w: sw, h: sw }
        this._downButtonRect = {
          x: rb.x,
          y: rb.y + rb.height - sw,
          w: sw,
          h: sw,
        }
        // NOTE: _scrollbarRect 计算保留以备将来使用（滚动条轨道背景样式）
        this._thumbRect = {
          x: rb.x,
          y: rb.y + sw + this._thumbOrigin,
          w: sw,
          h: this._thumbHeight,
        }
        break
      case ScrollBar.Right:
        this._upButtonRect = {
          x: rb.x + rb.width - sw,
          y: rb.y,
          w: sw,
          h: sw,
        }
        this._downButtonRect = {
          x: rb.x + rb.width - sw,
          y: rb.y + rb.height - sw,
          w: sw,
          h: sw,
        }
        // NOTE: _scrollbarRect 计算保留以备将来使用
        this._thumbRect = {
          x: rb.x + rb.width - sw,
          y: rb.y + sw + this._thumbOrigin,
          w: sw,
          h: this._thumbHeight,
        }
        break
      case ScrollBar.Hidden:
        // 所有矩形保持零
        break
    }
  }

  /** 同步滑块 DOM 元素的位置和大小。 */
  private _syncThumbToDOM(): void {
    this._updateRects()
    if (this._thumbEl && this.scrollBar !== ScrollBar.Hidden) {
      const th = this._thumbHeight
      if (th > 0) {
        this._thumbEl.style.display = ''
        this._thumbEl.style.top = `${this._thumbRect.y - this.bounds.y}px`
        this._thumbEl.style.height = `${th}px`
      } else {
        this._thumbEl.style.display = 'none'
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hit testing helpers
  // ---------------------------------------------------------------------------

  /** 检查点是否在矩形内。 */
  private _rectContains(
    rect: { x: number; y: number; w: number; h: number },
    px: number,
    py: number,
  ): boolean {
    return (
      px >= rect.x &&
      px < rect.x + rect.w &&
      py >= rect.y &&
      py < rect.y + rect.h
    )
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // OpenRA 对照: HandleMouseInput(MouseInput)
  // ---------------------------------------------------------------------------

  /** 处理 widget 事件。
   *
   * 路由鼠标滚轮进行滚动，处理滑块拖拽，
   * 处理上/下按钮点击，并处理键盘事件进行导航。
   *
   * OpenRA 对照: ScrollPanelWidget.HandleMouseInput(MouseInput)
   */
  override handleEvent(event: WidgetEvent): boolean {
    const px = (event.clientX ?? 0) as number
    const py = (event.clientY ?? 0) as number

    // ---- 鼠标滚轮 ----
    // NOTE: 在 DOM 实现中，我们使用 'wheel' 事件类型
    if (event.type === 'wheel') {
      const deltaY = (event.deltaY ?? 0) as number
      // 匹配 OpenRA: Scroll(mi.Delta.Y, true)
      // DOM wheel deltaY: positive = scroll down = OpenRA negative Delta.Y
      this.scroll(-deltaY, true)
      return true
    }

    // ---- 键盘事件 ----
    if (event.type === 'keydown') {
      return this._handleKeyDown(event)
    }

    // ---- 鼠标事件（用于滚动条交互） ----
    // 仅处理左键
    if (event.type === 'mousedown') {
      return this._handleMouseDown(px, py)
    }

    if (event.type === 'mouseup') {
      return this._handleMouseUp()
    }

    if (event.type === 'mousemove') {
      return this._handleMouseMove(px, py)
    }

    // 未处理 — 让子 widget 有机会处理
    return false
  }

  /** 处理鼠标按下 — 启动滑块拖拽或按钮按下。
   * OpenRA 对照: HandleMouseInput 的 MouseInputEvent.Down 分支 */
  private _handleMouseDown(px: number, py: number): boolean {
    this._updateRects()

    // 尝试获取鼠标焦点
    if (!this.takeMouseFocus()) return false

    // 检查滑块是否被点击
    if (
      this._thumbHeight > 0 &&
      this._rectContains(this._thumbRect, px, py)
    ) {
      this._thumbPressed = true
      this._lastMouseY = py
      this._upPressed = false
      this._downPressed = false
      return true
    }

    // 检查上箭头
    if (this._rectContains(this._upButtonRect, px, py)) {
      this._upPressed = true
      this._downPressed = false
      this._thumbPressed = false
      return !this._upDisabled
    }

    // 检查下箭头
    if (this._rectContains(this._downButtonRect, px, py)) {
      this._downPressed = true
      this._upPressed = false
      this._thumbPressed = false
      return !this._downDisabled
    }

    return false
  }

  /** 处理鼠标释放 — 停止所有按钮和滑块交互。
   * OpenRA 对照: HandleMouseInput 的 MouseInputEvent.Up 分支 */
  private _handleMouseUp(): boolean {
    if (!this.hasMouseFocus) return false

    this._upPressed = false
    this._downPressed = false
    this._thumbPressed = false
    this.yieldMouseFocus()
    return true
  }

  /** 处理鼠标移动 — 滑块拖拽或悬停追踪。
   * OpenRA 对照: HandleMouseInput 的 MouseInputEvent.Move 分支 */
  private _handleMouseMove(_px: number, py: number): boolean {
    this._updateRects()

    // 滑块拖拽
    if (this._thumbPressed) {
      const trackH = this._scrollbarHeight
      const thumbH = this._thumbHeight
      if (thumbH === 0) return true

      const travelRange = trackH - thumbH
      const scrollRange = this.contentHeight - this.bounds.height
      if (scrollRange <= 0) return true

      // 鼠标移动的像素映射到滚动偏移变化
      // 匹配 OpenRA: newOffset = currentListOffset + (int)((lastMouseLocation.Y - mi.Location.Y) * (ContentHeight - rb.Height) * 1f / (scrollbarHeight - thumbHeight))
      const mouseDelta = this._lastMouseY - py
      const newOffset =
        this._currentListOffset +
        (mouseDelta * scrollRange) / travelRange

      const clamped = Math.min(
        0,
        Math.max(this.bounds.height - this.contentHeight, newOffset),
      )

      if (clamped !== this._currentListOffset) {
        this._lastMouseY = py
      }
      this._setListOffset(clamped, false)
      return true
    }

    // NOTE: 悬停状态追踪（用于未来 CSS 类切换）
    // _upHovered = _rectContains(_upButtonRect, px, py) 等

    return this._upPressed || this._downPressed || this._thumbPressed
  }

  /** 处理键盘事件 — 导航键。
   * OpenRA 对照: 无显式键盘处理（由子项目处理），但我们在此添加上下文导航 */
  private _handleKeyDown(event: WidgetEvent): boolean {
    const key = event.key ?? ''

    switch (key) {
      case 'ArrowUp':
        // 向上滚动一项的高度
        this.scroll(1, false)
        return true
      case 'ArrowDown':
        // 向下滚动一项的高度
        this.scroll(-1, false)
        return true
      case 'PageUp':
        // 向上滚动一页
        this.scrollTo(
          this._currentListOffset + this.bounds.height,
          false,
        )
        return true
      case 'PageDown':
        // 向下滚动一页
        this.scrollTo(
          this._currentListOffset - this.bounds.height,
          false,
        )
        return true
      case 'Home':
        this.scrollToTop(false)
        return true
      case 'End':
        this.scrollToBottom(false)
        return true
      default:
        return false
    }
  }

  // ---------------------------------------------------------------------------
  // Focus management
  // ---------------------------------------------------------------------------

  /** 释放鼠标焦点 — 重置所有按钮/滑块状态。
   * OpenRA 对照: YieldMouseFocus(MouseInput) */
  override yieldMouseFocus(): boolean {
    this._upPressed = false
    this._downPressed = false
    this._thumbPressed = false
    return super.yieldMouseFocus()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  /** 渲染滚动面板为 DOM 元素。
   *
   * 结构：
   * ```
   * <div class="scroll-panel-widget" style="overflow:hidden;">
   *   <div class="scroll-panel-content" style="transform:translateY(...)">
   *     <!-- 子 widget 在此处 -->
   *   </div>
   *   <div class="scroll-panel-scrollbar">
   *     <div class="scroll-panel-arrow-up"></div>
   *     <div class="scroll-panel-track">
   *       <div class="scroll-panel-thumb"></div>
   *     </div>
   *     <div class="scroll-panel-arrow-down"></div>
   *   </div>
   * </div>
   * ```
   *
   * OpenRA 对照: ScrollPanelWidget.DrawOuter()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'scroll-panel-widget')
    el.style.position = 'absolute'
    el.style.overflow = 'hidden'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 内容区域
    const contentX =
      this.scrollBar === ScrollBar.Left ? this.scrollbarWidth : 0
    const contentW =
      this.scrollBar !== ScrollBar.Hidden
        ? this.bounds.width - this.scrollbarWidth
        : this.bounds.width

    // 清除并重建内容
    // 保留 scrollbar 元素，回收内容元素
    this._ensureContentElement(el, contentX, contentW)

    // 重建子 widget
    while (this._contentEl!.firstChild) {
      this._contentEl!.removeChild(this._contentEl!.firstChild)
    }
    for (const child of this.children) {
      if (child.visible) {
        this._contentEl!.appendChild(child.renderOuter())
      }
    }

    // 滚动条（如果不是 Hidden）
    if (this.scrollBar !== ScrollBar.Hidden) {
      this._ensureScrollbarElement(el)
    }

    // 更新内容变换
    this._updateContentTransform()
    // 同步滑块
    this._updateRects()
    this._syncThumbToDOM()

    return el
  }

  /** 创建或获取内容容器 div。 */
  private _ensureContentElement(
    parent: HTMLElement,
    x: number,
    w: number,
  ): void {
    if (!this._contentEl || this._contentEl.parentElement !== parent) {
      // 从父元素中移除旧的内容元素
      if (this._contentEl?.parentElement) {
        this._contentEl.parentElement.removeChild(this._contentEl)
      }
      this._contentEl = document.createElement('div')
      this._contentEl.className = 'scroll-panel-content'
      this._contentEl.style.position = 'absolute'
      this._contentEl.style.left = `${x}px`
      this._contentEl.style.top = '0px'
      this._contentEl.style.width = `${w}px`
      this._contentEl.style.willChange = 'transform'
      parent.appendChild(this._contentEl)
    } else {
      this._contentEl.style.left = `${x}px`
      this._contentEl.style.width = `${w}px`
    }
  }

  /** 创建或获取滚动条 DOM 元素。 */
  private _ensureScrollbarElement(parent: HTMLElement): void {
    if (
      !this._scrollbarEl ||
      this._scrollbarEl.parentElement !== parent
    ) {
      if (this._scrollbarEl?.parentElement) {
        this._scrollbarEl.parentElement.removeChild(this._scrollbarEl)
      }

      const sw = this.scrollbarWidth
      const scrollbarX =
        this.scrollBar === ScrollBar.Left ? 0 : this.bounds.width - sw

      this._scrollbarEl = document.createElement('div')
      this._scrollbarEl.className = 'scroll-panel-scrollbar'
      this._scrollbarEl.style.position = 'absolute'
      this._scrollbarEl.style.left = `${scrollbarX}px`
      this._scrollbarEl.style.top = '0px'
      this._scrollbarEl.style.width = `${sw}px`
      this._scrollbarEl.style.height = `${this.bounds.height}px`

      // 上箭头
      this._upArrowEl = document.createElement('div')
      this._upArrowEl.className = 'scroll-panel-arrow scroll-panel-arrow-up'
      this._upArrowEl.style.position = 'absolute'
      this._upArrowEl.style.top = '0px'
      this._upArrowEl.style.left = '0px'
      this._upArrowEl.style.width = `${sw}px`
      this._upArrowEl.style.height = `${sw}px`
      this._scrollbarEl.appendChild(this._upArrowEl)

      // 轨道（上下箭头之间）
      const trackEl = document.createElement('div')
      trackEl.className = 'scroll-panel-track'
      trackEl.style.position = 'absolute'
      trackEl.style.top = `${sw}px`
      trackEl.style.left = '0px'
      trackEl.style.width = `${sw}px`
      trackEl.style.height = `${this.bounds.height - 2 * sw}px`

      // 滑块
      this._thumbEl = document.createElement('div')
      this._thumbEl.className = 'scroll-panel-thumb'
      this._thumbEl.style.position = 'absolute'
      this._thumbEl.style.left = '0px'
      this._thumbEl.style.width = `${sw}px`
      trackEl.appendChild(this._thumbEl)

      this._scrollbarEl.appendChild(trackEl)

      // 下箭头
      this._downArrowEl = document.createElement('div')
      this._downArrowEl.className =
        'scroll-panel-arrow scroll-panel-arrow-down'
      this._downArrowEl.style.position = 'absolute'
      this._downArrowEl.style.bottom = '0px'
      this._downArrowEl.style.left = '0px'
      this._downArrowEl.style.width = `${sw}px`
      this._downArrowEl.style.height = `${sw}px`
      this._scrollbarEl.appendChild(this._downArrowEl)

      parent.appendChild(this._scrollbarEl)
    }
  }

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  /** 克隆此 ScrollPanelWidget。
   *
   * OpenRA 对照: 无显式 Clone 方法；通过 Widget.Clone() 间接支持
   * 注意：OpenRA 的 ScrollPanelWidget 没有继承支持 Clone 的基类，
   * 但在模板化场景中可能需要克隆。所有可克隆子 widget 都会被深度复制。
   */
  override clone(): ScrollPanelWidget {
    const s = new ScrollPanelWidget()
    s.id = this.id
    s._xExpr = this._xExpr
    s._yExpr = this._yExpr
    s._widthExpr = this._widthExpr
    s._heightExpr = this._heightExpr
    s.logic = [...this.logic]
    s.visible = this.visible
    s.scrollbarWidth = this.scrollbarWidth
    s.borderWidth = this.borderWidth
    s.topBottomSpacing = this.topBottomSpacing
    s.itemSpacing = this.itemSpacing
    s.minimumThumbSize = this.minimumThumbSize
    s.panelAlign = this.panelAlign
    s.scrollBar = this.scrollBar
    s.collapseHiddenChildren = this.collapseHiddenChildren
    s.uiScrollSpeed = this.uiScrollSpeed
    s.smoothScrollSpeed = this.smoothScrollSpeed
    s.itemTemplateId = this.itemTemplateId
    s._itemTemplate = this._itemTemplate?.clone() ?? null
    s.bounds = { ...this.bounds }
    // 布局由构造函数默认设置（ListLayout）；必要时在此覆盖
    for (const child of this.children) {
      s.addChild(child.clone())
    }
    return s
  }
}
