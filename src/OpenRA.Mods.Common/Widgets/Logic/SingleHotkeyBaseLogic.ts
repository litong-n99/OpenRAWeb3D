/**
 * SingleHotkeyBaseLogic.ts — 单热键基类：监听全局热键并调用子类回调
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/SingleHotkeyBaseLogic.cs (37 lines)
 *
 * 核心范式转换:
 * - C# HotkeyReference(Func<Hotkey>) → TypeScript HotkeyReference(getter)
 * - C# LogicKeyListenerWidget.AddHandler(KeyInput → bool) → TypeScript addHandler(string → bool)
 * - C# [ChromeLogicArgsHotkeys] 注解 → JSDoc @ChromeLogicArgsHotkeys
 * - C# KeyInput { Event, Key, Modifiers } → string key (DOM keydown event.key)
 *
 * 抽象的 ChromeLogic 子类，为编辑器/游戏逻辑提供单热键绑定。
 * 子类重写 onHotkeyActivated() 以响应热键按下。
 *
 * Migration: TODO-21.C.18 dependency (needed by EditorQuickSaveHotkeyLogic)
 */

import { ChromeLogic } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget, WidgetArgs } from '../../../OpenRA.Game/Widgets/Widget.js'
import { LogicKeyListenerWidget } from '../../Widgets/LogicKeyListenerWidget.js'

// ---------------------------------------------------------------------------
// KeyInputContext — minimal keyboard input context
// ---------------------------------------------------------------------------

/**
 * Minimal keyboard input data available to hotkey handlers.
 * Uses DOM key string + modifiers since the LogicKeyListenerWidget
 * dispatches string-based key events.
 *
 * NOTE: The full KeyInput (with numeric SDL keycodes) is not yet
 * integrated with the DOM widget event system. When the keyboard
 * input bridge is completed, this can be replaced with the full
 * KeyInput type from IInputHandler.
 *
 * TODO-21.C.18-FUTURE: bridge to full KeyInput with numeric keycodes
 */
export interface KeyInputContext {
  /** DOM key string (e.g., "s", "Escape", "F5") */
  readonly key: string
  /** Modifier keys held (Ctrl, Shift, Alt, Meta) */
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

// ---------------------------------------------------------------------------
// Hotkey match helper
// ---------------------------------------------------------------------------

/**
 * Check whether a displayed hotkey string (e.g., "Ctrl+S", "F5")
 * matches a given key input context.
 *
 * OpenRA 对照: HotkeyReference.IsActivatedBy(KeyInput)
 *
 * Uses a simplified display-string-based matching since the full
 * numeric keycode infrastructure is not yet bridged to DOM events.
 *
 * @param hotkeyDisplay — the display string of the hotkey (e.g., "Ctrl+S")
 * @param ctx — the key input context from the DOM event
 * @returns true if the input matches the hotkey
 */
export function hotkeyMatches(hotkeyDisplay: string, ctx: KeyInputContext): boolean {
  if (!hotkeyDisplay || hotkeyDisplay.length === 0) return false

  // Split on '+' or ' + ' to handle both compact ("Ctrl+S") and
  // display ("Ctrl + S") formats. Trim whitespace from each part.
  const parts = hotkeyDisplay.split(/\+/).map(s => s.trim())
  const keyName = parts[parts.length - 1] ?? ''
  const expectedMods = parts.length > 1
    ? parts.slice(0, -1).map(s => s.toLowerCase())
    : []

  // Match the key (case-insensitive for displayed letters)
  if (ctx.key.toLowerCase() !== keyName.toLowerCase()) return false

  // NOTE: Modifier state is not yet available from the string-only
  // LogicKeyListenerWidget handler. When the full keyboard input bridge
  // is available (TODO-21.C.18-FUTURE), enable modifier validation below.
  // For now, match on key portion only, ignoring modifier requirements.
  if (expectedMods.length === 0) return true

  // Stub phase: check if ctx has any modifier info.
  // If all modifiers are false, we cannot determine modifier state,
  // so match on key alone (safe fallback for stub phase).
  const hasModifierInfo = ctx.ctrlKey || ctx.shiftKey || ctx.altKey || ctx.metaKey
  if (!hasModifierInfo) return true

  // Match modifiers (when modifier info is available)
  const hasShift = expectedMods.includes('shift')
  const hasCtrl = expectedMods.includes('ctrl')
  const hasAlt = expectedMods.includes('alt')
  const hasMeta = expectedMods.includes('meta')

  if (hasShift !== ctx.shiftKey) return false
  if (hasCtrl !== ctx.ctrlKey) return false
  if (hasAlt !== ctx.altKey) return false
  if (hasMeta !== ctx.metaKey) return false

  return true
}

// ---------------------------------------------------------------------------
// SingleHotkeyBaseLogic — 单热键逻辑基类
// OpenRA 对照: public abstract class SingleHotkeyBaseLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 抽象基类：监听单个全局热键并调用子类的 onHotkeyActivated()。
 *
 * 用法：子类在构造函数中调用 super(widget, modData, argName, parentId, logicArgs)，
 * 然后重写 onHotkeyActivated(ctx) 实现自定义逻辑。
 *
 * OpenRA 对照: SingleHotkeyBaseLogic
 *
 * @ChromeLogicArgsHotkeys argName
 */
export abstract class SingleHotkeyBaseLogic extends ChromeLogic {
  /** 按键监听器 widget。OpenRA 对照: keyhandler */
  protected readonly keyHandler: LogicKeyListenerWidget

  /** 热键显示字符串（如 "Ctrl+S", "F5"）。 */
  protected readonly hotkeyDisplay: string

  /** 按键处理器注册引用（用于 dispose 时注销）。 */
  private readonly _handlerFn: (key: string) => boolean

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SingleHotkeyBaseLogic(Widget, ModData, string, string, Dictionary)
  // ---------------------------------------------------------------------------

  /**
   * 构造 SingleHotkeyBaseLogic。
   *
   * OpenRA 对照: protected SingleHotkeyBaseLogic(Widget widget, ModData modData,
   *   string argName, string parentName, Dictionary<string, MiniYaml> logicArgs)
   *
   * @param widget — 父 widget
   * @param _modData — ModData（保留以匹配 OpenRA 签名，当前未使用）
   * @param _argName — 逻辑参数中的热键键名（保留用于未来 ModData 查找）
   * @param parentId — 按键监听 widget 的 ID（如 "GLOBAL_KEYHANDLER"）
   * @param _logicArgs — 逻辑参数字典（保留用于未来 ModData 查找）
   * @param hotkeyDisplayOverride — 热键显示字符串（如 "Ctrl+S"）
   */
  constructor(
    widget: Widget,
    _modData: unknown,
    _argName: string,
    parentId: string,
    _logicArgs: WidgetArgs,
    hotkeyDisplayOverride?: string,
  ) {
    super()
    this.hotkeyDisplay = hotkeyDisplayOverride ?? ''

    this.keyHandler = widget.get<LogicKeyListenerWidget>(parentId)

    this._handlerFn = (key: string) => {
      // Build a KeyInputContext from the string key
      // NOTE: Modifier state is not available from the string-only handler.
      // When the full keyboard input bridge is available, this will be enhanced.
      const ctx: KeyInputContext = {
        key,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }
      if (hotkeyMatches(this.hotkeyDisplay, ctx)) {
        return this.onHotkeyActivated(ctx)
      }
      return false
    }

    this.keyHandler.addHandler(this._handlerFn)
  }

  // ---------------------------------------------------------------------------
  // Abstract hotkey handler
  // OpenRA 对照: protected abstract bool OnHotkeyActivated(KeyInput e)
  // ---------------------------------------------------------------------------

  /**
   * 当热键被激活时调用。子类必须重写。
   *
   * OpenRA 对照: OnHotkeyActivated(KeyInput e)
   *
   * @param ctx — 触发热键的按键上下文
   * @returns true 表示事件已消费（阻止传播）
   */
  protected abstract onHotkeyActivated(ctx: KeyInputContext): boolean

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  /**
   * 清理资源：移除按键处理器。
   */
  override dispose(): void {
    this.keyHandler.removeHandler(this._handlerFn)
  }

  /**
   * 每帧更新（默认无操作，子类可重写）。
   */
  tick(): void {
    // No-op by default
  }
}
