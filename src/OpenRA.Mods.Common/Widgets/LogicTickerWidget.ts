/**
 * LogicTickerWidget.ts — 无形 tick 桥接 widget（将游戏 tick 转发给 Logic 回调）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LogicTickerWidget.cs (22 lines)
 *
 * 核心范式转换:
 * - OpenRA Action OnTick 委托 → TypeScript () => void 回调函数
 * - 无形 widget（无渲染输出，仅用于 tick 生命周期）
 * - render() 返回隐藏的空 div（不可见，不占空间）
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// LogicTickerWidget — tick 桥接 widget
// OpenRA 对照: public class LogicTickerWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 无形 tick 桥接 widget。
 *
 * 每帧调用 onTick 回调函数，将游戏 tick 循环桥接到 widget Logic 类。
 * 此 widget 不可见，不渲染任何视觉内容，不消费任何事件。
 *
 * 用法:
 * ```
 * const ticker = new LogicTickerWidget()
 * ticker.onTick = () => { console.log('tick!') }
 * // 添加到 widget 树中，每帧自动调用 onTick()
 * ```
 *
 * OpenRA 对照: public class LogicTickerWidget : Widget
 */
export class LogicTickerWidget extends Widget {
  // ---- 回调 (OpenRA 对照: public Action OnTick) ----

  /** 每 tick 调用的回调函数。
   * OpenRA 对照: public Action OnTick = () => { } */
  onTick: () => void = () => {}

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: 默认构造函数
  // ---------------------------------------------------------------------------

  constructor() {
    super()
    // 无形 widget — 不参与鼠标悬停检测
    this.ignoreMouseOver = true
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: public override void Tick() { OnTick(); }
  // ---------------------------------------------------------------------------

  /**
   * 每帧 tick — 调用 OnTick 回调。
   *
   * OpenRA 对照: public override void Tick()
   */
  override tick(): void {
    this.onTick()
  }

  // ---------------------------------------------------------------------------
  // DOM rendering (无形 — 返回隐藏元素)
  // ---------------------------------------------------------------------------

  /**
   * 返回隐藏的空 DOM 元素（无形 widget，不渲染可见内容）。
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'logic-ticker-widget')
    el.style.display = 'none'
    el.style.position = 'absolute'
    el.style.width = '0'
    el.style.height = '0'
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }
    return el
  }

  // ---------------------------------------------------------------------------
  // Event handling (不消费任何事件)
  // ---------------------------------------------------------------------------

  override handleEvent(_event: WidgetEvent): boolean {
    return false
  }

  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }
}
