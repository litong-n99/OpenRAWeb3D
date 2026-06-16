/**
 * SupportPowerTimerWidget.ts — 支援技能图标倒计时叠加 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/SupportPowerTimerWidget.cs (97 lines)
 *
 * 核心范式转换:
 * - OpenRA SpriteFont.DrawTextWithShadow (SDL bitmap 文本)
 *   → CSS text-shadow + DOM 文本渲染
 * - OpenRA World.ActorsWithTrait<SupportPowerManager> (遍历世界 actor)
 *   → 外部传入 getText / isVisible 委托（解耦游戏逻辑）
 * - OpenRA FluentProvider.GetMessage (本地化文本模板)
 *   → 委托返回格式化文本（外部负责本地化）
 * - OpenRA Game.LocalTick % 50 < 25 (闪烁)
 *   → 委托返回颜色（外部控制闪烁逻辑）
 * - OpenRA Widget.Tick() (每帧更新文本数组)
 *   → 每帧调用委托获取最新文本和颜色
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { TextAlign } from './TextAlign.js'

// ---------------------------------------------------------------------------
// TimerOrder — 计时器排序方向
// OpenRA 对照: public enum TimerOrder { Ascending = -1, Descending = 1 }
// ---------------------------------------------------------------------------

/** 计时器排序方向。OpenRA 对照: TimerOrder */
export const TimerOrder = {
  /** 升序：从上到下排列 (值 = -1) */
  Ascending: -1 as const,
  /** 降序：从下到上排列 (值 = 1) */
  Descending: 1 as const,
}
export type TimerOrder = (typeof TimerOrder)[keyof typeof TimerOrder]

// ---------------------------------------------------------------------------
// SupportPowerTimerWidget — 支援技能倒计时
// OpenRA 对照: public class SupportPowerTimerWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 支援技能图标倒计时叠加 widget。
 *
 * 显示各支援技能的剩余冷却时间（如 "2:30"）。
 * 文本颜色：正常冷却为白色，就绪状态或即将就绪（<10s）为闪烁颜色。
 *
 * 通过委托与游戏系统解耦：
 * - getText: () => string[] — 每个支援技能的时间文本数组
 * - isVisible: () => boolean — 控制整个 widget 的可见性
 * - getTextColor: () => string — 每条文本的颜色
 *
 * OpenRA 对照: public class SupportPowerTimerWidget : Widget
 */
export class SupportPowerTimerWidget extends Widget {
  // ---- 配置属性 (OpenRA 对照: 同名字段) ----

  /** 字体 CSS 字符串。OpenRA 对照: Font */
  font: string = 'bold 14px Arial'

  /** 文本对齐方式。OpenRA 对照: Align */
  align: TextAlign = TextAlign.Left

  /** 排序方向。OpenRA 对照: Order */
  order: TimerOrder = TimerOrder.Descending

  /** 行间距（像素）。OpenRA 对照: 硬编码 5px */
  lineSpacing: number = 5

  // ---- 委托 (OpenRA 对照: computed properties) ----

  /** 获取要显示的文本列表的委托。
   * OpenRA 对照: Tick() 中的 texts 数组计算 */
  getText: () => string[]

  /** 获取每条文本对应颜色的委托。
   * OpenRA 对照: Tick() 中 p.Ready ? ownerColor : White */
  getTextColor: (index: number) => string

  /** 可见性委托。OpenRA 对照: IsVisible() */
  isVisible: () => boolean

  // ---- 内部状态 ----

  /** 缓存的文本数组 */
  private _cachedTexts: string[] = []

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: [ObjectCreator.UseCtor] SupportPowerTimerWidget(World world)
  // ---------------------------------------------------------------------------

  constructor() {
    super()

    // 默认委托
    this.getText = () => []
    this.getTextColor = (_index: number) => '#FFFFFF'
    this.isVisible = () => this.visible

    // 不参与鼠标交互
    this.ignoreMouseOver = true
  }

  // ---------------------------------------------------------------------------
  // Tick — 每帧更新
  // OpenRA 对照: public override void Tick()
  // ---------------------------------------------------------------------------

  /**
   * 每帧 tick — 刷新文本和颜色。
   *
   * OpenRA 对照: public override void Tick()
   */
  override tick(): void {
    if (!this.isVisible()) return
    this._cachedTexts = this.getText()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: public override void Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染倒计时文本为 DOM 元素。
   *
   * 每条文本渲染为一个独立的 `<div>`，支持 CSS text-shadow 模拟对比效果。
   * 排序方向控制列表从上到下还是从下到上。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'support-power-timer-widget')
    el.style.position = 'absolute'
    el.style.display = 'flex'
    el.style.flexDirection =
      this.order === TimerOrder.Descending ? 'column' : 'column-reverse'
    el.style.gap = `${this.lineSpacing}px`
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'
    el.style.pointerEvents = 'none'
    el.style.font = this.font

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 文本对齐
    switch (this.align) {
      case TextAlign.Center:
        el.style.alignItems = 'center'
        el.style.textAlign = 'center'
        break
      case TextAlign.Right:
        el.style.alignItems = 'flex-end'
        el.style.textAlign = 'right'
        break
      default:
        el.style.alignItems = 'flex-start'
        el.style.textAlign = 'left'
    }

    // 清除旧子元素并渲染每条文本
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }

    for (let i = 0; i < this._cachedTexts.length; i++) {
      const text = this._cachedTexts[i]
      const color = this.getTextColor(i)

      const lineEl = document.createElement('div')
      lineEl.className = 'timer-line'
      lineEl.textContent = text
      lineEl.style.color = color
      lineEl.style.whiteSpace = 'nowrap'
      lineEl.style.textShadow =
        `1px 1px 0 rgba(0,0,0,0.8), ` +
        `-1px -1px 0 rgba(0,0,0,0.5), ` +
        `1px -1px 0 rgba(255,255,255,0.3), ` +
        `-1px 1px 0 rgba(255,255,255,0.3)`
      lineEl.style.lineHeight = '1.2'

      el.appendChild(lineEl)
    }

    return el
  }

  // ---------------------------------------------------------------------------
  // Event handling (不消费事件)
  // ---------------------------------------------------------------------------

  override handleEvent(_event: WidgetEvent): boolean {
    return false
  }

  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  override clone(): SupportPowerTimerWidget {
    const cloned = new SupportPowerTimerWidget()
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

    cloned.font = this.font
    cloned.align = this.align
    cloned.order = this.order
    cloned.lineSpacing = this.lineSpacing
    cloned.getText = this.getText
    cloned.getTextColor = this.getTextColor
    cloned.isVisible = this.isVisible

    for (const child of this.children) {
      cloned.addChild(child.clone())
    }
    return cloned
  }
}
