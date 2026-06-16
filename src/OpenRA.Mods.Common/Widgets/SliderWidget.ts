/**
 * SliderWidget.ts — 滑块控件（带拖拽手柄 + 刻度线 + 轨道）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/SliderWidget.cs (145 lines)
 *
 * 核心范式转换:
 * - C# HandleMouseInput(MouseInput) 手动命中测试 + 拖拽状态机
 *   → DOM pointerdown/pointermove/pointerup 事件 + setPointerCapture
 * - C# WidgetUtils.DrawPanel (9 片面板轨道) → CSS div + border/background
 * - C# WidgetUtils.DrawSprite (拇指手柄) → CSS 定位 div + border-radius + background
 * - C# ChromeProvider.GetImage("slider", "tick") 刻度线 → CSS div 刻度标记
 * - C# ButtonWidget.DrawBackground (状态感知拇指) → CSS data-state 属性
 * - C# HandleKeyPress(KeyInput) 方向键调整 → DOM keydown + ArrowLeft/ArrowRight
 * - C# OnChange event Action<float> → onChange 回调属性
 * - C# SliderWidget.ValueFromPx / PxFromValue → TypeScript 方法
 * - C# ThumbRect Rectangle 属性 → TypeScript getter
 * - C# YieldMouseFocus / TakeMouseFocus → DOM pointer capture + Ui 焦点管理
 */

import { InputWidget, boundsContains } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent, WidgetBounds } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// SliderWidget — 滑块控件
// OpenRA 对照: public class SliderWidget : InputWidget
// ---------------------------------------------------------------------------

/**
 * 滑块控件 — 可拖拽的值范围选择器。
 *
 * 支持：
 * - 鼠标拖拽（左键按下/移动/释放 + 焦点管理）
 * - 键盘调整（方向键 Left/Right，步长 = 范围 / ticks）
 * - 可选刻度线（Ticks 属性控制数量，0 = 连续无刻度）
 * - 轨道 + 拇指手柄 + 刻度标记的视觉渲染
 * - OnChange 值变化事件
 * - 值范围：[MinimumValue, MaximumValue]，内部表示为 [0, 1] 比例
 *
 * OpenRA 对照: public class SliderWidget : InputWidget
 */
export class SliderWidget extends InputWidget {
  // ---------------------------------------------------------------------------
  // Properties — OpenRA 对照: SliderWidget 字段
  // ---------------------------------------------------------------------------

  /** 值变化事件。OpenRA 对照: event Action<float> OnChange */
  onChange: ((value: number) => void) | null = null

  /** 刻度线数量（0 = 连续无刻度）。OpenRA 对照: SliderWidget.Ticks */
  ticks: number = 0

  /** 轨道高度（像素）。OpenRA 对照: SliderWidget.TrackHeight */
  trackHeight: number = 5

  /** 拇指手柄图像名称（ChromeProvider 集合）。
   * OpenRA 对照: SliderWidget.Thumb ("slider-thumb") */
  thumb: string = 'slider-thumb'

  /** 轨道图像名称（ChromeProvider 集合）。
   * OpenRA 对照: SliderWidget.Track ("slider-track") */
  track: string = 'slider-track'

  /** 最小值。OpenRA 对照: SliderWidget.MinimumValue (0) */
  minimumValue: number = 0

  /** 最大值。OpenRA 对照: SliderWidget.MaximumValue (1) */
  maximumValue: number = 1

  /** 当前值。OpenRA 对照: SliderWidget.Value (0) */
  value: number = 0

  /** 获取当前值的委托。OpenRA 对照: SliderWidget.GetValue */
  getValue: () => number

  // ---- 内部状态 ----

  /** 拇指是否正在被拖拽。OpenRA 对照: SliderWidget.isMoving */
  protected _isMoving: boolean = false

  /** 拇指是否被悬停。 */
  private _thumbHovered: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SliderWidget() / SliderWidget(SliderWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 SliderWidget。
   *
   * OpenRA 对照: public SliderWidget()
   */
  constructor() {
    super()
    this.getValue = () => this.value
  }

  /**
   * 从另一个 SliderWidget 复制属性。
   *
   * OpenRA 对照: public SliderWidget(SliderWidget other) : base(other)
   */
  protected copySliderFrom(other: SliderWidget): void {
    this.onChange = other.onChange
    this.ticks = other.ticks
    this.trackHeight = other.trackHeight
    this.thumb = other.thumb
    this.track = other.track
    this.minimumValue = other.minimumValue
    this.maximumValue = other.maximumValue
    this.value = other.value
    this.getValue = other.getValue
  }

  // ---------------------------------------------------------------------------
  // Value management
  // OpenRA 对照: UpdateValue(float)
  // ---------------------------------------------------------------------------

  /**
   * 更新滑块值并触发 OnChange。
   *
   * OpenRA 对照: public void UpdateValue(float newValue)
   *
   * @param newValue — 新值（会被 clamped 到 [MinimumValue, MaximumValue]）
   */
  updateValue(newValue: number): void {
    const clamped = this._clamp(newValue, this.minimumValue, this.maximumValue)
    const oldValue = this.value
    this.value = clamped
    if (oldValue !== this.value && this.onChange) {
      this.onChange(this.value)
    }
  }

  /** Clamp 值到 [min, max] 范围。 */
  protected _clamp(value: number, min: number, max: number): number {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  // ---------------------------------------------------------------------------
  // Pixel ↔ Value conversion
  // OpenRA 对照: ValueFromPx(int), PxFromValue(float)
  // ---------------------------------------------------------------------------

  /**
   * 将像素 x 坐标转换为滑块值。
   *
   * OpenRA 对照: protected virtual float ValueFromPx(int x)
   *
   * 公式:
   *   MinimumValue + (MaximumValue - MinimumValue) *
   *     (x - 0.5 * bounds.height) / (bounds.width - bounds.height)
   *
   * @param x — 相对于 RenderBounds 左边缘的像素位置
   */
  valueFromPx(x: number): number {
    const w = this.bounds.width
    const h = this.bounds.height
    if (w <= h) return this.minimumValue // 避免除零或负分母

    const ratio = (x - 0.5 * h) / (w - h)
    const clipped = this._clamp(ratio, 0, 1)
    return this.minimumValue + (this.maximumValue - this.minimumValue) * clipped
  }

  /**
   * 将滑块值转换为像素 x 坐标。
   *
   * OpenRA 对照: protected virtual int PxFromValue(float x)
   *
   * 公式:
   *   0.5 * bounds.height + (bounds.width - bounds.height) *
   *     (x - MinimumValue) / (MaximumValue - MinimumValue)
   *
   * @param x — 滑块值（在 [MinimumValue, MaximumValue] 范围内）
   */
  pxFromValue(x: number): number {
    const w = this.bounds.width
    const h = this.bounds.height
    if (this.maximumValue === this.minimumValue) return 0.5 * h

    const ratio = (x - this.minimumValue) / (this.maximumValue - this.minimumValue)
    const clipped = this._clamp(ratio, 0, 1)
    return Math.round(0.5 * h + (w - h) * clipped)
  }

  // ---------------------------------------------------------------------------
  // ThumbRect — 拇指手柄边界
  // OpenRA 对照: Rectangle ThumbRect { get { ... } }
  // ---------------------------------------------------------------------------

  /**
   * 获取拇指手柄的渲染矩形。
   *
   * OpenRA 对照: Rectangle ThumbRect
   *
   * 拇指尺寸: bounds.Height × bounds.Height（正方形）
   * 水平居中于像素位置 PxFromValue(Value)。
   */
  get thumbRect(): WidgetBounds {
    const thumbPx = this.pxFromValue(this.value)
    const rb = this.bounds
    const size = rb.height // 拇指尺寸 = bounds 高度
    const originX = rb.x + Math.round(thumbPx - size / 2)
    return { x: originX, y: rb.y, width: size, height: size }
  }

  // ---------------------------------------------------------------------------
  // Event handling — 鼠标拖拽 + 键盘调整
  // OpenRA 对照: HandleMouseInput(MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * 处理 DOM 事件（鼠标拖拽 + 键盘调整）。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   *
   * 状态机:
   * - pointerdown: 获取鼠标焦点 → _isMoving = true → updateValue(ValueFromPx)
   * - pointermove (while _isMoving): updateValue(ValueFromPx)
   * - pointerup: _isMoving = false → 释放鼠标焦点
   * - keydown (ArrowLeft/ArrowRight): 按步长调整值
   *
   * @returns 如果拇指矩形包含事件坐标，则返回 true（消费事件）
   */
  override handleEvent(event: WidgetEvent): boolean {
    const eventType = event.type

    // 键盘调整
    if (eventType === 'keydown') {
      return this._handleKeyEvent(event)
    }

    // 鼠标事件
    if (
      eventType === 'mousedown' ||
      eventType === 'pointerdown' ||
      eventType === 'mousemove' ||
      eventType === 'pointermove' ||
      eventType === 'mouseup' ||
      eventType === 'pointerup'
    ) {
      return this._handleMouseEvent(event)
    }

    return false
  }

  /**
   * 处理鼠标事件（精确匹配 OpenRA 的 HandleMouseInput 逻辑）。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   */
  private _handleMouseEvent(event: WidgetEvent): boolean {
    const eventType = event.type
    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number

    // Left button only check
    const button = (event['button'] as number) ?? 0
    if (button !== 0) return false

    // Disabled check
    if (this.isDisabled()) return false

    // ---- Down ----
    if (eventType === 'mousedown' || eventType === 'pointerdown') {
      // OpenRA: if (!TakeMouseFocus(mi)) return false
      if (!this.takeMouseFocus()) return false

      this._isMoving = true
      // NOTE: OpenRA 有 TODO 标记关于 "handle snapping to ticks" 和
      // "handle nudge via clicking outside the thumb"。
      // 当前实现: 点击任何位置立即将值设置为该位置（匹配 C#）。
      const localX = x - this.bounds.x
      this.updateValue(this.valueFromPx(localX))

      return this._thumbRectContains(x, y)
    }

    // ---- Up ----
    if (eventType === 'mouseup' || eventType === 'pointerup') {
      if (!this.hasMouseFocus) return false

      this._isMoving = false
      this.yieldMouseFocus()

      return this._thumbRectContains(x, y)
    }

    // ---- Move (when moving) ----
    if (eventType === 'mousemove' || eventType === 'pointermove') {
      if (!this._isMoving || !this.hasMouseFocus) return false

      const localX = x - this.bounds.x
      this.updateValue(this.valueFromPx(localX))

      return this._thumbRectContains(x, y)
    }

    return false
  }

  /**
   * 处理键盘事件 — 方向键调整值。
   *
   * OpenRA 对照: 无显式 HandleKeyPress 重写。
   * C# 依赖 HotkeyReference 绑定方向键。
   * 这里提供 DOM 标准的 ArrowLeft/ArrowRight 行为。
   */
  private _handleKeyEvent(event: WidgetEvent): boolean {
    const key = event.key || ''

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (this.isDisabled()) return false

      // 计算步长
      let step: number
      if (this.ticks > 0) {
        step = (this.maximumValue - this.minimumValue) / this.ticks
      } else {
        step = (this.maximumValue - this.minimumValue) / 20 // 连续模式下 5% 步长
      }

      if (key === 'ArrowLeft') {
        this.updateValue(this.value - step)
      } else {
        this.updateValue(this.value + step)
      }

      return true
    }

    return false
  }

  /** 检查点是否在拇指矩形内。 */
  private _thumbRectContains(px: number, py: number): boolean {
    return boundsContains(this.thumbRect, px, py)
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: SliderWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染滑块为 DOM 元素。
   *
   * 渲染顺序（匹配 OpenRA）:
   * 1. 更新值（从 GetValue 委托）
   * 2. 刻度线
   * 3. 轨道
   * 4. 拇指手柄
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'slider-widget')

    // 可见性检查
    if (!this.isVisible()) {
      el.style.display = 'none'
      return el
    }
    el.style.display = ''

    // 更新值
    // OpenRA: UpdateValue(GetValue())
    this.updateValue(this.getValue())

    const disabled = this.isDisabled()

    // 基础样式
    el.style.position = 'absolute'
    el.style.cursor = disabled ? 'not-allowed' : 'pointer'
    el.style.userSelect = 'none'
    el.style.overflow = 'visible'
    el.style.boxSizing = 'border-box'

    if (disabled) {
      el.setAttribute('data-state', 'disabled')
    } else {
      el.removeAttribute('data-state')
    }
    el.setAttribute('data-slider-track', this.track)
    el.setAttribute('data-slider-thumb', this.thumb)

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 清除并重建子元素
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }

    // 渲染刻度线
    // OpenRA: for (var i = 0; i < Ticks; i++) { DrawSprite(tick, tickPos) }
    this._renderTickmarks(el)

    // 渲染轨道
    // OpenRA: WidgetUtils.DrawPanel(Track, trackRect)
    this._renderTrack(el)

    // 渲染拇指手柄
    // OpenRA: ButtonWidget.DrawBackground(Thumb, tr, disabled, isMoving, thumbHover, false)
    this._renderThumb(el, disabled)

    return el
  }

  /**
   * 渲染刻度线。
   *
   * OpenRA 对照:
   *   var tick = ChromeProvider.GetImage("slider", "tick");
   *   for (var i = 0; i < Ticks; i++) {
   *     var tickPos = new float2(
   *       trackOrigin + i * (trackRect.Width - tick.Size.X) / (Ticks - 1) - tick.Size.X / 2,
   *       trackRect.Bottom);
   *     WidgetUtils.DrawSprite(tick, tickPos);
   *   }
   */
  private _renderTickmarks(el: HTMLElement): void {
    if (this.ticks <= 0) return

    const w = this.bounds.width
    const h = this.bounds.height
    const trackWidth = w - h
    const trackOriginX = h / 2
    const trackRectWidth = trackWidth
    const trackBottom = h

    // 创建刻度线容器
    const tickContainer = document.createElement('div')
    tickContainer.setAttribute('data-slider-ticks', 'true')
    tickContainer.style.position = 'absolute'
    tickContainer.style.left = '0'
    tickContainer.style.top = '0'
    tickContainer.style.width = '100%'
    tickContainer.style.height = '100%'
    tickContainer.style.pointerEvents = 'none'

    for (let i = 0; i < this.ticks; i++) {
      const tickSize = 6 // 刻度线尺寸（像素）
      let tickPosX: number

      if (this.ticks === 1) {
        tickPosX = trackOriginX - tickSize / 2
      } else {
        tickPosX =
          trackOriginX +
          (i * (trackRectWidth - tickSize)) / (this.ticks - 1) -
          tickSize / 2
      }

      const tickEl = document.createElement('div')
      tickEl.style.position = 'absolute'
      tickEl.style.left = `${tickPosX}px`
      tickEl.style.top = `${trackBottom - 2}px`
      tickEl.style.width = `${tickSize}px`
      tickEl.style.height = `${tickSize}px`
      tickEl.style.backgroundColor = '#888888'
      tickEl.style.borderRadius = '1px'
      tickContainer.appendChild(tickEl)
    }

    el.appendChild(tickContainer)
  }

  /**
   * 渲染轨道。
   *
   * OpenRA 对照: WidgetUtils.DrawPanel(Track, trackRect)
   *
   * trackRect = new Rectangle(
   *   trackOrigin - 1,
   *   rb.Y + (rb.Height - TrackHeight) / 2,
   *   trackWidth + 2,
   *   TrackHeight
   * )
   */
  private _renderTrack(el: HTMLElement): void {
    const w = this.bounds.width
    const h = this.bounds.height
    const trackWidth = w - h
    const trackOriginX = h / 2
    const trackRectTop = (h - this.trackHeight) / 2

    const trackEl = document.createElement('div')
    trackEl.setAttribute('data-slider-track-element', 'true')
    trackEl.style.position = 'absolute'
    trackEl.style.left = `${trackOriginX - 1}px`
    trackEl.style.top = `${trackRectTop}px`
    trackEl.style.width = `${trackWidth + 2}px`
    trackEl.style.height = `${this.trackHeight}px`
    trackEl.style.backgroundColor = '#333333'
    trackEl.style.border = '1px solid #555555'
    trackEl.style.borderRadius = '2px'
    trackEl.style.pointerEvents = 'none'

    // 填充部分（值左侧高亮）
    const thumbPx = this.pxFromValue(this.value)
    const filledWidth = thumbPx - trackOriginX

    const fillEl = document.createElement('div')
    fillEl.style.position = 'absolute'
    fillEl.style.left = '0'
    fillEl.style.top = '0'
    fillEl.style.width = `${Math.max(0, filledWidth)}px`
    fillEl.style.height = '100%'
    fillEl.style.backgroundColor = '#4a90d9'
    fillEl.style.borderRadius = '2px'
    trackEl.appendChild(fillEl)

    el.appendChild(trackEl)
  }

  /**
   * 渲染拇指手柄。
   *
   * OpenRA 对照:
   *   var thumbHover = Ui.MouseOverWidget == this && tr.Contains(Viewport.LastMousePos);
   *   ButtonWidget.DrawBackground(Thumb, tr, IsDisabled(), isMoving, thumbHover, false);
   */
  private _renderThumb(el: HTMLElement, disabled: boolean): void {
    const tr = this.thumbRect
    const localThumb = {
      x: tr.x - this.bounds.x,
      y: tr.y - this.bounds.y,
      width: tr.width,
      height: tr.height,
    }

    const thumbEl = document.createElement('div')
    thumbEl.setAttribute('data-slider-thumb-element', 'true')
    thumbEl.style.position = 'absolute'
    thumbEl.style.left = `${localThumb.x}px`
    thumbEl.style.top = `${localThumb.y}px`
    thumbEl.style.width = `${localThumb.width}px`
    thumbEl.style.height = `${localThumb.height}px`
    thumbEl.style.borderRadius = '3px'
    thumbEl.style.boxSizing = 'border-box'

    // 状态感知样式（模仿 ButtonWidget.DrawBackground）
    if (disabled) {
      thumbEl.style.backgroundColor = '#555555'
      thumbEl.style.border = '2px solid #333333'
      thumbEl.setAttribute('data-state', 'disabled')
    } else if (this._isMoving) {
      thumbEl.style.backgroundColor = '#1a3a5c'
      thumbEl.style.border = '2px solid #0d1f33'
      thumbEl.style.boxShadow = 'inset 0 2px 4px rgba(0,0,0,0.4)'
      thumbEl.setAttribute('data-state', 'pressed')
    } else if (this._thumbHovered) {
      thumbEl.style.backgroundColor = '#2a5a8c'
      thumbEl.style.border = '2px solid #1a3a5c'
      thumbEl.style.boxShadow = '0 0 6px rgba(100,180,255,0.3)'
      thumbEl.setAttribute('data-state', 'hover')
    } else {
      thumbEl.style.backgroundColor = '#1e4d7a'
      thumbEl.style.border = '2px solid #0d2a4a'
      thumbEl.setAttribute('data-state', 'normal')
    }

    el.appendChild(thumbEl)
  }

  // ---------------------------------------------------------------------------
  // MouseEntered / MouseExited — 拇指悬停跟踪
  // ---------------------------------------------------------------------------

  /**
   * 鼠标进入滑块时设置拇指悬停状态。
   */
  override mouseEntered(): void {
    this._thumbHovered = true
  }

  /**
   * 鼠标离开滑块时清除拇指悬停状态。
   */
  override mouseExited(): void {
    this._thumbHovered = false
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // ---------------------------------------------------------------------------

  /**
   * 返回滑块的光标 CSS 值。
   */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return this.isDisabled() ? 'not-allowed' : 'pointer'
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: SliderWidget.Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 SliderWidget。
   *
   * OpenRA 对照: public override SliderWidget Clone()
   */
  override clone(): SliderWidget {
    const c = new SliderWidget()
    c.copySliderFrom(this)
    c.id = this.id
    c._xExpr = this._xExpr
    c._yExpr = this._yExpr
    c._widthExpr = this._widthExpr
    c._heightExpr = this._heightExpr
    c.logic = [...this.logic]
    c.visible = this.visible
    c.disabled = this.disabled
    c.isDisabled = this.isDisabled
    c.isVisible = this.isVisible
    c.ignoreMouseOver = this.ignoreMouseOver
    c.ignoreChildMouseOver = this.ignoreChildMouseOver
    c.bounds = { ...this.bounds }
    for (const child of this.children) {
      c.addChild(child.clone())
    }
    return c
  }
}
