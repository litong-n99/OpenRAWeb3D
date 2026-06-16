/**
 * HotkeyEntryWidget.ts — 热键输入捕获 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/HotkeyEntryWidget.cs (162 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawText() bitmap 字形渲染 → DOM span + CSS font
 * - C# Game.Renderer.Fonts[Font] + font.Measure → Canvas 2D measureText
 * - C# WidgetUtils.DrawPanel(state, renderBounds) → CSS data-state 属性
 * - C# HandleMouseInput → DOM mousedown/click 获取键盘焦点
 * - C# HandleKeyPress + Hotkey.FromKeyInput → DOM keydown + Hotkey 捕获
 * - C# Tick + blinkCycle + showEntry → requestAnimationFrame / CSS animation 闪烁光标
 * - C# EnableScissor/DisableScissor → CSS overflow: hidden + text-overflow: ellipsis
 * - C# IgnoreKeys (修饰键独立按下时不捕获) → DOM keydown 过滤
 */

import { InputWidget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { Hotkey } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import type { Color } from './LabelWidget.js'

// ---------------------------------------------------------------------------
// 独立的修饰键 — 不应捕获为热键
// OpenRA 对照: static readonly Keycode[] IgnoreKeys
// ---------------------------------------------------------------------------

/** 独立按下时不应捕获为热键的修饰键。
 *
 * OpenRA 对照: IgnoreKeys = [RSHIFT, LSHIFT, RCTRL, LCTRL, RALT, LALT, RGUI, LGUI]
 */
const IGNORE_KEYS: ReadonlySet<KeyCode> = new Set([
  KeyCode.RSHIFT,
  KeyCode.LSHIFT,
  KeyCode.RCTRL,
  KeyCode.LCTRL,
  KeyCode.RALT,
  KeyCode.LALT,
  KeyCode.RGUI,
  KeyCode.LGUI,
])

// ---------------------------------------------------------------------------
// DOM key string → KeyCode 映射
// ---------------------------------------------------------------------------

/**
 * 将 DOM key 字符串转换为 KeyCode。
 * 映射常见的 DOM 键名到 SDL KeyCode 值。
 */
function domKeyToKeyCode(key: string): KeyCode {
  const upper = key.toUpperCase()
  // 查找 KeyCode 中的名称
  for (const [name, code] of Object.entries(KeyCode)) {
    if (typeof code === 'number' && name.toUpperCase() === upper) {
      return code as KeyCode
    }
  }
  // 也检查 display name 映射
  const displayMap: Record<string, KeyCode> = {
    ENTER: KeyCode.RETURN,
    ESC: KeyCode.ESCAPE,
    ESCAPE: KeyCode.ESCAPE,
    ' ': KeyCode.SPACE,
    SPACE: KeyCode.SPACE,
    ARROWUP: KeyCode.UP,
    ARROWDOWN: KeyCode.DOWN,
    ARROWLEFT: KeyCode.LEFT,
    ARROWRIGHT: KeyCode.RIGHT,
    PAGEUP: KeyCode.PAGEUP,
    PAGEDOWN: KeyCode.PAGEDOWN,
    HOME: KeyCode.HOME,
    END: KeyCode.END,
    INSERT: KeyCode.INSERT,
    DELETE: KeyCode.DELETE,
    BACKSPACE: KeyCode.BACKSPACE,
    TAB: KeyCode.TAB,
    CAPSLOCK: KeyCode.CAPSLOCK,
    NUMLOCK: KeyCode.NUMLOCKCLEAR,
    SCROLLLOCK: KeyCode.SCROLLLOCK,
    PRINTSCREEN: KeyCode.PRINTSCREEN,
    PAUSE: KeyCode.PAUSE,
  }
  if (displayMap[upper] !== undefined) return displayMap[upper]!

  // F1-F12
  const fMatch = key.match(/^F(\d+)$/i)
  if (fMatch) {
    const fn = parseInt(fMatch[1]!, 10)
    if (fn >= 1 && fn <= 12) {
      const fk = (KeyCode as Record<string, KeyCode>)[`F${fn}`]
      if (typeof fk === 'number') return fk
    }
  }

  // D0-D9
  const dMatch = key.match(/^(\d)$/)
  if (dMatch) {
    const dk = (KeyCode as Record<string, KeyCode>)[`D${dMatch[1]}`]
    if (typeof dk === 'number') return dk
  }

  // 字母键 A-Z
  if (key.length === 1 && /^[a-zA-Z]$/.test(key)) {
    const ak = (KeyCode as Record<string, KeyCode>)[key.toUpperCase()]
    if (typeof ak === 'number') return ak
  }

  return KeyCode.UNKNOWN
}

/**
 * 从 DOM 键盘事件计算 Modifiers 位标志。
 */
function domEventModifiers(event: WidgetEvent): Modifiers {
  let mods = Modifiers.None
  if (event['ctrlKey'] === true || event['metaKey'] === true) mods |= Modifiers.Ctrl
  if (event['altKey'] === true) mods |= Modifiers.Alt
  if (event['shiftKey'] === true) mods |= Modifiers.Shift
  // Meta/Super key 合并到 Ctrl
  return mods
}

// ---------------------------------------------------------------------------
// HotkeyEntryWidget — 热键输入捕获 widget
// OpenRA 对照: public class HotkeyEntryWidget : InputWidget
// ---------------------------------------------------------------------------

/**
 * 热键输入捕获 widget。
 *
 * 焦点时捕获下一个按键作为热键绑定。
 * 滚动修饰键（Ctrl, Alt, Shift, Meta）作为组合键的一部分。
 * Escape 清除绑定，Backspace 取消绑定。
 * 焦点状态下有闪烁光标指示。
 *
 * OpenRA 对照: HotkeyEntryWidget
 */
export class HotkeyEntryWidget extends InputWidget {
  // ---- 热键值 ----

  /** 当前绑定的热键值。OpenRA 对照: HotkeyEntryWidget.Key */
  key: Hotkey = Hotkey.Invalid

  // ---- 视觉属性 ----

  /** 视觉高度偏移。OpenRA 对照: HotkeyEntryWidget.VisualHeight */
  visualHeight: number = 1

  /** 左内边距。OpenRA 对照: HotkeyEntryWidget.LeftMargin */
  leftMargin: number = 5

  /** 右内边距。OpenRA 对照: HotkeyEntryWidget.RightMargin */
  rightMargin: number = 5

  /** CSS font 字符串。OpenRA 对照: HotkeyEntryWidget.Font */
  font: string = '14px Arial'

  /** 文本颜色。OpenRA 对照: HotkeyEntryWidget.TextColor */
  textColor: Color = '#FFFFFF'

  /** 禁用状态文本颜色。OpenRA 对照: HotkeyEntryWidget.TextColorDisabled */
  textColorDisabled: Color = '#888888'

  /** 无效热键文本颜色。OpenRA 对照: HotkeyEntryWidget.TextColorInvalid */
  textColorInvalid: Color = '#FF4444'

  // ---- 回调 ----

  /** Escape 键回调。OpenRA 对照: HotkeyEntryWidget.OnEscKey */
  onEscKey: (event: WidgetEvent) => void = () => {}

  /** 失去焦点回调。OpenRA 对照: HotkeyEntryWidget.OnLoseFocus */
  onLoseFocus: () => void = () => {}

  /** 验证回调 — 返回当前热键是否有效。OpenRA 对照: HotkeyEntryWidget.IsValid */
  isValid: () => boolean = () => false

  // ---- 关键事件捕获状态 ----

  /** 闪烁周期计数器。OpenRA 对照: blinkCycle */
  private _blinkCycle: number = 15

  /** 是否显示文本（用于闪烁）。OpenRA 对照: showEntry */
  private _showEntry: boolean = true

  // ---- ChromeMetrics 默认键 ----

  static readonly DEFAULT_FONT_KEY = 'HotkeyFont'
  static readonly DEFAULT_TEXT_COLOR_KEY = 'HotkeyColor'
  static readonly DEFAULT_TEXT_COLOR_DISABLED_KEY = 'HotkeyColorDisabled'
  static readonly DEFAULT_TEXT_COLOR_INVALID_KEY = 'HotkeyColorInvalid'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: HotkeyEntryWidget() / HotkeyEntryWidget(HotkeyEntryWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 HotkeyEntryWidget。
   *
   * OpenRA 对照: public HotkeyEntryWidget()
   */
  constructor() {
    super()
    this._loadDefaults()
  }

  /**
   * 从 ChromeMetrics 加载默认值。
   */
  private _loadDefaults(): void {
    try {
      const f = ChromeMetrics.tryGet<string>(HotkeyEntryWidget.DEFAULT_FONT_KEY)
      if (f) this.font = f as string
    } catch { /* graceful */ }
    try {
      const c = ChromeMetrics.tryGet<string>(HotkeyEntryWidget.DEFAULT_TEXT_COLOR_KEY)
      if (c) this.textColor = c as string
    } catch { /* graceful */ }
    try {
      const cd = ChromeMetrics.tryGet<string>(
        HotkeyEntryWidget.DEFAULT_TEXT_COLOR_DISABLED_KEY,
      )
      if (cd) this.textColorDisabled = cd as string
    } catch { /* graceful */ }
    try {
      const ci = ChromeMetrics.tryGet<string>(
        HotkeyEntryWidget.DEFAULT_TEXT_COLOR_INVALID_KEY,
      )
      if (ci) this.textColorInvalid = ci as string
    } catch { /* graceful */ }
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected HotkeyEntryWidget(HotkeyEntryWidget widget) : base(widget)
   */
  protected copyFrom(other: HotkeyEntryWidget): void {
    this.key = other.key
    this.font = other.font
    this.textColor = other.textColor
    this.textColorDisabled = other.textColorDisabled
    this.textColorInvalid = other.textColorInvalid
    this.visualHeight = other.visualHeight
    this.leftMargin = other.leftMargin
    this.rightMargin = other.rightMargin
    this.onEscKey = other.onEscKey
    this.onLoseFocus = other.onLoseFocus
    this.isValid = other.isValid
    this.disabled = other.disabled
    this.isDisabled = other.isDisabled
  }

  // ---------------------------------------------------------------------------
  // Focus management
  // OpenRA 对照: YieldKeyboardFocus / ForceYieldKeyboardFocus
  // ---------------------------------------------------------------------------

  /**
   * 释放键盘焦点。如果当前值无效则拒绝。
   *
   * OpenRA 对照: public override bool YieldKeyboardFocus()
   */
  override yieldKeyboardFocus(): boolean {
    this.onLoseFocus()
    if (!this.isValid()) return false
    return super.yieldKeyboardFocus()
  }

  /**
   * 强制释放键盘焦点（忽略验证）。
   *
   * OpenRA 对照: public bool ForceYieldKeyboardFocus()
   */
  forceYieldKeyboardFocus(): boolean {
    this.onLoseFocus()
    return super.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // GetValue / SetValue
  // OpenRA 对照: Func<Hotkey> GetValue / setter pattern
  // ---------------------------------------------------------------------------

  /** 获取当前热键值。 */
  getValue(): Hotkey {
    return this.key
  }

  /** 设置当前热键值。 */
  setValue(h: Hotkey): void {
    this.key = h
    this._showEntry = true
  }

  // ---------------------------------------------------------------------------
  // Event handling — HandleMouseInput + HandleKeyPress
  // OpenRA 对照: HandleMouseInput + HandleKeyPress
  // ---------------------------------------------------------------------------

  /**
   * 处理事件 — 鼠标点击获取焦点，按键捕获热键。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   *              public override bool HandleKeyPress(KeyInput e)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (this.isDisabled()) return false

    const eventType = event.type

    // ---- 鼠标点击处理 ----
    // OpenRA: mi.Event == MouseInputEvent.Down → TakeKeyboardFocus
    if (eventType === 'mousedown' || eventType === 'pointerdown') {
      if (!this.takeKeyboardFocus()) return false
      this._blinkCycle = 15
      this._showEntry = true
      return true
    }

    // ---- 键盘事件处理 ----
    if (eventType === 'keydown') {
      return this._handleKeyPress(event)
    }

    return false
  }

  /**
   * 处理键盘事件 — 捕获热键组合。
   *
   * OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
   */
  private _handleKeyPress(event: WidgetEvent): boolean {
    if (this.isDisabled()) return false
    if (!this.hasKeyboardFocus) return false

    const key = event.key || ''
    const keyCode = domKeyToKeyCode(key)

    // 忽略独立的修饰键
    if (IGNORE_KEYS.has(keyCode)) return false

    // 处理特殊键
    switch (keyCode) {
      case KeyCode.ESCAPE:
        // Escape 清除绑定
        this.onEscKey(event)
        this.key = Hotkey.Invalid
        this.forceYieldKeyboardFocus()
        event.stopPropagation()
        return true

      default: {
        // 捕获热键
        const mods = domEventModifiers(event)
        this.key = new Hotkey(keyCode, mods)
        this._showEntry = true
        this.yieldKeyboardFocus()
        event.stopPropagation()
        return true
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick — 闪烁状态
  // OpenRA 对照: public override void Tick()
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新闪烁周期。
   *
   * OpenRA 对照: public override void Tick()
   */
  override tick(): void {
    if (this.hasKeyboardFocus && --this._blinkCycle <= 0) {
      this._blinkCycle = 15
      this._showEntry = !this._showEntry
    }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw()
  // ---------------------------------------------------------------------------

  /**
   * 渲染热键输入 widget 的 DOM 元素。
   *
   * 显示当前绑定的热键名称，焦点时闪烁。
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'hotkey-entry-widget')
    el.style.position = 'absolute'
    el.style.boxSizing = 'border-box'
    el.style.overflow = 'hidden'
    el.style.userSelect = 'none'
    el.style.cursor = this.isDisabled() ? 'not-allowed' : 'text'

    const disabled = this.isDisabled()
    const valid = this.isValid()

    // 状态属性
    if (disabled) {
      el.setAttribute('data-state', 'disabled')
    } else if (this.hasKeyboardFocus) {
      el.setAttribute('data-state', 'focused')
    } else {
      el.setAttribute('data-state', 'normal')
    }

    // 背景面板 — 模拟 WidgetUtils.DrawPanel(state, RenderBounds)
    el.style.backgroundColor = disabled
      ? '#333'
      : this.hasKeyboardFocus
        ? '#1a2a4a'
        : '#1e1e2e'
    el.style.border = disabled
      ? '1px solid #444'
      : this.hasKeyboardFocus
        ? '1px solid #5a8aca'
        : '1px solid #555'
    el.style.borderRadius = '3px'

    // 清除旧文本
    const oldText = el.querySelector('[data-hotkey-text]')
    if (oldText) oldText.remove()

    // 焦点时闪烁 — 隐藏文本
    // OpenRA: if (HasKeyboardFocus && !showEntry) return
    if (this.hasKeyboardFocus && !this._showEntry) {
      // 只显示闪烁光标
      const caretEl = document.createElement('span')
      caretEl.setAttribute('data-hotkey-caret', 'true')
      caretEl.style.position = 'absolute'
      caretEl.style.left = `${this.leftMargin}px`
      caretEl.style.top = `${(this.bounds.height - 16) / 2}px`
      caretEl.style.width = '2px'
      caretEl.style.height = '16px'
      caretEl.style.backgroundColor = '#ccc'
      el.appendChild(caretEl)
      return el
    }

    // 显示热键文本
    const apparentText =
      this.key !== Hotkey.Invalid ? this.key.displayString() : ''

    const textEl = document.createElement('span')
    textEl.setAttribute('data-hotkey-text', 'true')
    textEl.style.position = 'absolute'
    textEl.style.left = `${this.leftMargin}px`
    textEl.style.top = '50%'
    textEl.style.transform = 'translateY(-50%)'
    textEl.style.font = this.font
    textEl.style.whiteSpace = 'nowrap'
    textEl.style.overflow = 'hidden'
    textEl.style.textOverflow = 'ellipsis'
    textEl.style.maxWidth = `${
      this.bounds.width - this.leftMargin - this.rightMargin
    }px`

    // 文本颜色
    if (disabled) {
      textEl.style.color = this.textColorDisabled
    } else if (!valid) {
      textEl.style.color = this.textColorInvalid
    } else {
      textEl.style.color = this.textColor
    }

    // 无绑定键时显示占位符
    if (apparentText.length === 0) {
      textEl.textContent = this.hasKeyboardFocus ? '...' : ''
      textEl.style.color = '#888'
    } else {
      textEl.textContent = apparentText
    }

    el.appendChild(textEl)

    // 焦点时也显示光标
    if (this.hasKeyboardFocus) {
      const caretEl = document.createElement('span')
      caretEl.setAttribute('data-hotkey-caret', 'true')
      caretEl.style.position = 'absolute'
      caretEl.style.left = `${
        this.leftMargin +
        (apparentText.length > 0
          ? Math.min(
              apparentText.length * 9,
              this.bounds.width - this.leftMargin - this.rightMargin - 10,
            )
          : 2)
      }px`
      caretEl.style.top = `${(this.bounds.height - 16) / 2}px`
      caretEl.style.width = '2px'
      caretEl.style.height = '16px'
      caretEl.style.backgroundColor = '#ccc'
      el.appendChild(caretEl)
    }

    return el
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override HotkeyEntryWidget Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 HotkeyEntryWidget。
   *
   * OpenRA 对照: public override HotkeyEntryWidget Clone()
   */
  override clone(): HotkeyEntryWidget {
    const w = new HotkeyEntryWidget()
    w.copyFrom(this)
    w.id = this.id
    w._xExpr = this._xExpr
    w._yExpr = this._yExpr
    w._widthExpr = this._widthExpr
    w._heightExpr = this._heightExpr
    w.logic = [...this.logic]
    w.visible = this.visible
    w.ignoreMouseOver = this.ignoreMouseOver
    w.ignoreChildMouseOver = this.ignoreChildMouseOver
    w.isVisible = this.isVisible
    w.isDisabled = this.isDisabled
    w.bounds = { ...this.bounds }
    for (const child of this.children) {
      w.addChild(child.clone())
    }
    return w
  }
}
