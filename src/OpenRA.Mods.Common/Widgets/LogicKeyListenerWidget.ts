/**
 * LogicKeyListenerWidget.ts — 无形全局按键监听 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LogicKeyListenerWidget.cs (36 lines)
 *
 * 核心范式转换:
 * - OpenRA Func<KeyInput, bool> 处理器列表 → TypeScript ((key: string) => boolean)[]
 * - OpenRA HandleKeyPress(KeyInput) (SDL2 keycode) → DOM keydown 事件 key 属性
 * - 无形 widget（无渲染输出），无论焦点状态始终监听按键
 * - 用于 Logic 类需要全局热键支持的场景（暂停、截图等）
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// KeyHandler — 按键处理器委托类型
// OpenRA 对照: Func<KeyInput, bool>
// ---------------------------------------------------------------------------

/**
 * 按键处理器委托类型。
 *
 * 接收按键字符串（DOM keydown 事件的 `key` 属性），
 * 返回 true 表示已消费该事件（阻止进一步传播）。
 *
 * OpenRA 对照: Func<KeyInput, bool>
 */
export type KeyHandler = (key: string) => boolean

// ---------------------------------------------------------------------------
// LogicKeyListenerWidget — 全局按键监听
// OpenRA 对照: public class LogicKeyListenerWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 无形全局按键监听 widget。
 *
 * 无论键盘焦点在哪个 widget 上，始终监听按键事件。
 * 维护一个处理器函数列表，按注册顺序依次调用。
 * 第一个返回 true 的处理器消费事件（后续处理器不再调用）。
 *
 * 用法:
 * ```
 * const listener = new LogicKeyListenerWidget()
 * listener.addHandler((key) => {
 *   if (key === 'Escape') { pause(); return true }
 *   return false
 * })
 * ```
 *
 * OpenRA 对照: public class LogicKeyListenerWidget : Widget
 */
export class LogicKeyListenerWidget extends Widget {
  // ---- 处理器列表 (OpenRA 对照: readonly List<Func<KeyInput, bool>> handlers) ----

  /** 按键处理器列表。OpenRA 对照: handlers */
  private _handlers: KeyHandler[] = []

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
  // AddHandler — 注册处理器
  // OpenRA 对照: public void AddHandler(Func<KeyInput, bool> func)
  // ---------------------------------------------------------------------------

  /**
   * 注册按键处理器。
   *
   * 处理器按注册顺序依次调用，第一个返回 true 的处理器消费事件。
   *
   * OpenRA 对照: public void AddHandler(Func<KeyInput, bool> func)
   *
   * @param handler — 按键处理器函数
   */
  addHandler(handler: KeyHandler): void {
    this._handlers.push(handler)
  }

  // ---------------------------------------------------------------------------
  // RemoveHandler — 移除处理器
  // ---------------------------------------------------------------------------

  /**
   * 移除之前注册的按键处理器。
   *
   * @param handler — 要移除的处理器函数（按引用比较）
   */
  removeHandler(handler: KeyHandler): void {
    const idx = this._handlers.indexOf(handler)
    if (idx >= 0) {
      this._handlers.splice(idx, 1)
    }
  }

  /**
   * 清除所有已注册的按键处理器。
   */
  clearHandlers(): void {
    this._handlers = []
  }

  /**
   * 获取当前已注册的处理器数量。
   */
  get handlerCount(): number {
    return this._handlers.length
  }

  // ---------------------------------------------------------------------------
  // Event handling — 按键事件
  // OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
  // ---------------------------------------------------------------------------

  /**
   * 处理按键事件。
   *
   * 依次调用所有已注册的处理器，第一个返回 true 的处理器消费事件。
   *
   * OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (event.type !== 'keydown') return false

    const key = event.key || ''
    if (!key) return false

    for (const handler of this._handlers) {
      if (handler(key)) {
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // DOM rendering (无形 — 返回隐藏元素)
  // ---------------------------------------------------------------------------

  /**
   * 返回隐藏的空 DOM 元素（无形 widget，不渲染可见内容）。
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'logic-key-listener-widget')
    el.style.display = 'none'
    el.style.position = 'absolute'
    el.style.width = '0'
    el.style.height = '0'
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }
    return el
  }

  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }
}
