/**
 * ColorBlockWidget.ts -- 纯色矩形 widget（健康条、队伍颜色指示器、UI 强调色）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ColorBlockWidget.cs (80 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.FillRectWithColor() (SDL2 矩形填充) -> CSS background-color
 * - OpenRA Color 结构体 (32-bit ARGB) -> CSS 颜色字符串
 * - OpenRA HandleMouseInput 状态机 -> DOM pointerdown/pointerup 事件
 * - OpenRA Game.Sound.PlayNotification -> 可替换静态 SoundCallback
 * - OpenRA ModData.DefaultRules + Ruleset -> 简化为可选的 Ruleset 引用
 * - OpenRA MouseButton.Left / MouseInputEvent 枚举 -> DOM event.button === 0 / event.type
 */

import { InputWidget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import type { Color } from './LabelWidget.js'

// ---------------------------------------------------------------------------
// Sound callback -- 可替换的声音播放回调
// OpenRA 对照: Game.Sound.PlayNotification(ModRules, null, "Sounds", name, null)
// ---------------------------------------------------------------------------

export type SoundCallback = (soundName: string) => void

// ---------------------------------------------------------------------------
// ColorBlockWidget -- 纯色矩形
// OpenRA 对照: public class ColorBlockWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 纯色矩形 widget。
 *
 * 渲染为具有 CSS `background-color` 的 `<div>` 元素。
 * 用于健康条、队伍颜色指示器、UI 强调色等。
 * 支持左键点击和声音反馈。
 *
 * OpenRA 对照: public class ColorBlockWidget : Widget
 *
 * NOTE: 迁移后继承 InputWidget（支持 disabled 状态）。
 * OpenRA 原始版本继承 Widget 并自行管理 ModData/Ruleset 引用。
 */
export class ColorBlockWidget extends InputWidget {
  // ---- 声音回调（可替换） ----

  /** 可替换的声音播放器。测试时可替换为 mock。
   * OpenRA 对照: Game.Sound.PlayNotification(...) */
  static soundPlayer: SoundCallback | null = null

  // ---- 颜色属性 ----

  /** 当前颜色（CSS 字符串）。OpenRA 对照: ColorBlockWidget.Color */
  color: Color = '#000000'

  /** 获取颜色的委托。OpenRA 对照: ColorBlockWidget.GetColor */
  getColor: () => Color

  // ---- 鼠标事件 ----

  /** 鼠标按下事件。OpenRA 对照: ColorBlockWidget.OnMouseDown */
  onMouseDown: (event: WidgetEvent) => void

  /** 鼠标释放事件。OpenRA 对照: ColorBlockWidget.OnMouseUp */
  onMouseUp: (event: WidgetEvent) => void

  // ---- 声音属性 ----

  /** 点击声音名称（null 表示无声音）。
   * OpenRA 对照: ColorBlockWidget.ClickSound */
  clickSound: string | null = null

  // ---- 内部状态 ----

  /** 是否处于按下状态。 */
  private _depressed: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: ColorBlockWidget(ModData) / ColorBlockWidget(ColorBlockWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 ColorBlockWidget。
   *
   * OpenRA 对照: public ColorBlockWidget(ModData modData)
   */
  constructor() {
    super()

    this.getColor = () => this.color
    this.onMouseDown = () => {}
    this.onMouseUp = () => {}
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected ColorBlockWidget(ColorBlockWidget widget) : base(widget)
   */
  protected copyFrom(other: ColorBlockWidget): void {
    this.color = other.color
    this.getColor = other.getColor
    this.onMouseDown = other.onMouseDown
    this.onMouseUp = other.onMouseUp
    this.clickSound = other.clickSound
    this.disabled = other.disabled
    this.isDisabled = other.isDisabled
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override ColorBlockWidget Clone()
  // ---------------------------------------------------------------------------

  override clone(): ColorBlockWidget {
    const cloned = new ColorBlockWidget()
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
  // Event handling
  // OpenRA 对照: ColorBlockWidget.HandleMouseInput(MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * 处理鼠标事件（精确匹配 OpenRA 的 HandleMouseInput 逻辑）。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   *
   * 状态机:
   * - 仅左键: mi.Button != MouseButton.Left -> return false
   * - Down: 尝试获取鼠标焦点 -> 失败返回 false -> 否则调用 OnMouseDown + 播放声音
   * - Up (有焦点): 调用 OnMouseUp + 释放焦点
   * - 始终返回 false（不消费事件给父级）
   */
  override handleEvent(event: WidgetEvent): boolean {
    const eventType = event.type

    // 仅处理鼠标事件
    if (
      eventType !== 'mousedown' &&
      eventType !== 'mouseup' &&
      eventType !== 'pointerdown' &&
      eventType !== 'pointerup'
    ) {
      return false
    }

    // 仅左键
    const button = (event['button'] as number) ?? 0
    if (button !== 0) return false

    // ---- Down ----
    if (eventType === 'mousedown' || eventType === 'pointerdown') {
      // OpenRA: if (mi.Event == MouseInputEvent.Down && !TakeMouseFocus(mi)) return false
      if (!this.takeMouseFocus()) return false

      this._depressed = true

      // OpenRA: OnMouseDown(mi)
      this.onMouseDown(event)

      // OpenRA: Game.Sound.PlayNotification(modRules, null, "Sounds", ClickSound, null)
      if (this.clickSound) {
        ColorBlockWidget._playSound(this.clickSound)
      }

      return false
    }

    // ---- Up ----
    if (eventType === 'mouseup' || eventType === 'pointerup') {
      if (!this.hasMouseFocus) return false

      // OpenRA: if (HasMouseFocus && mi.Event == MouseInputEvent.Up)
      if (this._depressed) {
        // OpenRA: OnMouseUp(mi)
        this.onMouseUp(event)

        // OpenRA: return YieldMouseFocus(mi)
      }

      this._depressed = false
      return this.yieldMouseFocus()
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // YieldMouseFocus -- 释放焦点时重置按下状态
  // ---------------------------------------------------------------------------

  override yieldMouseFocus(): boolean {
    this._depressed = false
    return super.yieldMouseFocus()
  }

  // ---------------------------------------------------------------------------
  // Sound playback
  // ---------------------------------------------------------------------------

  private static _playSound(soundName: string): void {
    ColorBlockWidget.soundPlayer?.(soundName)
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: ColorBlockWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染为具有 CSS background-color 的 DOM 元素。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'color-block-widget')
    el.style.position = 'absolute'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'
    el.style.pointerEvents = 'auto'

    // 应用颜色
    const color = this.getColor()
    el.style.backgroundColor = color

    // 设置 widget ID
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 设置按下状态属性（供 CSS 使用）
    if (this._depressed) {
      el.setAttribute('data-state', 'pressed')
    } else {
      el.removeAttribute('data-state')
    }

    // 禁用状态
    if (this.isDisabled()) {
      el.setAttribute('data-disabled', 'true')
      el.style.opacity = '0.5'
      el.style.pointerEvents = 'none'
    } else {
      el.removeAttribute('data-disabled')
      el.style.opacity = ''
    }

    return el
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // ---------------------------------------------------------------------------

  override getCursor(_pos: { x: number; y: number }): string | null {
    return this.isDisabled() ? null : 'default'
  }
}
