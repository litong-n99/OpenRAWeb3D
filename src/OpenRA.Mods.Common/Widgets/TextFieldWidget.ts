/**
 * TextFieldWidget.ts — 文本输入字段 widget（带光标、选择和验证）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/TextFieldWidget.cs (617 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawText() 手动渲染文本 + 光标 "|" 字符
 *   → DOM 原生 <input> 元素（浏览器处理光标、选择、键盘输入和 IME）
 * - C# blinkCycle 手动光标闪烁 → CSS caret-color + tick() 切换透明度
 * - C# HandleKeyPress 手动键盘处理 → DOM keydown 事件 + 浏览器原生行为
 * - C# HandleTextInput 手动字符插入 → 浏览器原生 input 事件
 * - C# HandleMouseInput 手动命中测试 + 光标定位 → 浏览器原生点击/拖拽选择
 * - C# Game.Renderer.SetClipboardText/GetClipboardText → navigator.clipboard API
 * - C# Game.Renderer.EnableScissor/DisableScissor for 文本溢出裁剪
 *   → CSS overflow: hidden + 浏览器原生输入滚动
 * - C# WidgetUtils.DrawPanel 背景面板 → CSS border + background
 * - C# Func<KeyInput, bool> 委托 → 可选回调属性 (WidgetEvent) => boolean
 */

import { InputWidget, Ui, type WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { TextFieldType } from './TextFieldType.js'

// ---------------------------------------------------------------------------
// TextFieldWidget — 文本输入 widget
// OpenRA 对照: public class TextFieldWidget : InputWidget
// ---------------------------------------------------------------------------

/** 文本输入字段 widget — 带光标、文本选择和输入验证的交互式文本输入。
 *
 * OpenRA 对照: TextFieldWidget : InputWidget
 *
 * 使用原生 HTML `<input>` 元素进行文本渲染和交互，
 * 浏览器原生处理光标定位、选择、键盘输入和剪贴板操作。
 * 通过 DOM 事件监听器添加自定义验证、快捷键和回调。
 */
export class TextFieldWidget extends InputWidget {
  // ---------------------------------------------------------------------------
  // Text storage (OpenRA 对照: string text = "")
  // ---------------------------------------------------------------------------

  /** 内部文本存储。protected 以便子类（PasswordFieldWidget）访问。
   * OpenRA 对照: string text = "" */
  protected _text: string = ''

  // ---------------------------------------------------------------------------
  // Visual properties (OpenRA 对照: public fields)
  // ---------------------------------------------------------------------------

  /** 占位文本（输入为空时显示）。OpenRA 对照: 无（web 扩展） */
  protected _placeholder: string = ''

  /** 最大字符数，0 表示无限制。OpenRA 对照: MaxLength */
  protected _maxLength: number = 0

  /** 输入字段类型（决定验证行为）。OpenRA 对照: Type */
  private _type: TextFieldType = TextFieldType.Text

  /** 是否显示边框。OpenRA 对照: 无独立属性（由 Background 控制） */
  bordered: boolean = true

  /** 字体族/CSS 字符串。OpenRA 对照: Font */
  font: string = ''

  /** 文本颜色（正常状态）。OpenRA 对照: TextColor */
  textColor: string = '#ffffff'

  /** 文本颜色（禁用状态）。OpenRA 对照: TextColorDisabled */
  textColorDisabled: string = '#888888'

  /** 文本颜色（无效输入）。OpenRA 对照: TextColorInvalid */
  textColorInvalid: string = '#ff4444'

  /** 文本选择高亮颜色。OpenRA 对照: TextColorHighlight */
  textColorHighlight: string = '#4040ff'

  /** 光标闪烁颜色。OpenRA 对照: CaretColor（无直接对照，web 扩展） */
  caretColor: string = '#ffffff'

  /** 光标闪烁间隔（毫秒）。OpenRA 对照: 由 blinkCycle 控制（~800ms） */
  caretFlashInterval: number = 500

  /** 左边距（像素）。OpenRA 对照: LeftMargin */
  leftMargin: number = 5

  /** 右边距（像素）。OpenRA 对照: RightMargin */
  rightMargin: number = 5

  /** 垂直高度调整。OpenRA 对照: VisualHeight */
  visualHeight: number = 1

  // ---------------------------------------------------------------------------
  // Delegate callbacks (OpenRA 对照: Func/Action delegates)
  // ---------------------------------------------------------------------------

  /** Enter 键回调。返回 true 表示事件已消费。
   * OpenRA 对照: Func<KeyInput, bool> OnEnterKey */
  onEnterKey: ((e: WidgetEvent) => boolean) | null = null

  /** Tab 键回调。OpenRA 对照: Func<KeyInput, bool> OnTabKey */
  onTabKey: ((e: WidgetEvent) => boolean) | null = null

  /** Escape 键回调。OpenRA 对照: Func<KeyInput, bool> OnEscKey */
  onEscapeKey: ((e: WidgetEvent) => boolean) | null = null

  /** 上箭头键回调。OpenRA 对照: Func<KeyInput, bool> OnArrowUp */
  onArrowUp: ((e: WidgetEvent) => boolean) | null = null

  /** 下箭头键回调。OpenRA 对照: Func<KeyInput, bool> OnArrowDown */
  onArrowDown: ((e: WidgetEvent) => boolean) | null = null

  /** Alt 键回调。OpenRA 对照: Func<bool> OnAltKey */
  onAltKey: (() => boolean) | null = null

  /** 失去焦点回调。OpenRA 对照: Action OnLoseFocus */
  onLoseFocus: (() => void) | null = null

  /** 文本编辑回调。OpenRA 对照: Action OnTextEdited */
  onTextEdited: (() => void) | null = null

  /** 验证回调（返回 false 表示文本无效）。OpenRA 对照: Func<bool> IsValid */
  isValid: (() => boolean) | null = null

  // ---------------------------------------------------------------------------
  // Optional external delegate overrides (OpenRA pattern: delegates override properties)
  // NOTE: These are NOT in the C# TextFieldWidget but follow the OpenRA widget
  // pattern used by ButtonWidget, LabelWidget, etc. They allow external
  // binding (e.g., settings UI) to override direct property access.
  // ---------------------------------------------------------------------------

  /** 外部文本获取委托（如果设置，get text() 返回其值而非 _text）。
   * OpenRA 对照: 遵循 ButtonWidget.GetText 模式 */
  getText: (() => string) | null = null

  /** 外部文本设置委托（如果设置，set text() 调用其而非更新 _text）。
   * OpenRA 对照: 遵循 ButtonWidget.SetText 模式 */
  setText: ((v: string) => void) | null = null

  /** 外部 maxLength 获取委托（如果设置，get maxLength() 返回其值）。
   * OpenRA 对照: 遵循 OpenRA 委托模式 */
  getMaxLength: (() => number) | null = null

  // ---------------------------------------------------------------------------
  // Blink state (OpenRA 对照: blinkCycle / showCursor)
  // ---------------------------------------------------------------------------

  /** 光标闪烁计数器。OpenRA 对照: blinkCycle */
  protected blinkCycle: number = 10

  /** 光标是否可见。OpenRA 对照: showCursor */
  protected showCursor: boolean = true

  /** 上一帧的禁用状态（用于检测变化）。OpenRA 对照: wasDisabled */
  private _wasDisabled: boolean = false

  // ---------------------------------------------------------------------------
  // DOM elements
  // ---------------------------------------------------------------------------

  private _inputEl: HTMLInputElement | null = null
  private _containerEl: HTMLDivElement | null = null

  // ---------------------------------------------------------------------------
  // Bound event handlers (stored for cleanup)
  // ---------------------------------------------------------------------------

  private _onInputBound: ((e: Event) => void) | null = null
  private _onKeyDownBound: ((e: KeyboardEvent) => void) | null = null
  private _onFocusBound: (() => void) | null = null
  private _onBlurBound: (() => void) | null = null
  private _onMouseDownBound: ((e: MouseEvent) => void) | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: public TextFieldWidget() { }
  // ---------------------------------------------------------------------------

  constructor() {
    super()
  }

  // ---------------------------------------------------------------------------
  // Text accessor (OpenRA 对照: string Text { get; set; })
  // ---------------------------------------------------------------------------

  /** 获取或设置当前文本值。
   *
   * 如果设置了 getText 委托，getter 返回委托的结果。
   * 如果设置了 setText 委托，setter 调用委托而非更新内部字段。
   *
   * OpenRA 对照: Text (property)
   */
  get text(): string {
    if (this.getText) return this.getText()
    return this._text
  }

  set text(value: string) {
    const filtered = this.removeInvalidCharacters(value ?? '')
    if (this.setText) {
      this.setText(filtered)
    } else {
      this._text = filtered
    }
    // Sync input element
    if (this._inputEl && this._inputEl.value !== filtered) {
      this._inputEl.value = filtered
    }
    // Clamp cursor position after external text change
    if (this._inputEl) {
      const cursorPos = this._inputEl.selectionStart ?? 0
      const clamped = Math.max(0, Math.min(cursorPos, filtered.length))
      if (cursorPos !== clamped) {
        this._inputEl.setSelectionRange(clamped, clamped)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Placeholder accessor (web 扩展)
  // ---------------------------------------------------------------------------

  /** 占位文本（输入为空时显示）。 */
  get placeholder(): string {
    return this._placeholder
  }

  set placeholder(value: string) {
    this._placeholder = value
    if (this._inputEl) {
      this._inputEl.placeholder = value
    }
  }

  // ---------------------------------------------------------------------------
  // MaxLength accessor (OpenRA 对照: MaxLength)
  // ---------------------------------------------------------------------------

  /** 获取最大字符数限制。0 表示无限制。
   *
   * 如果设置了 getMaxLength 委托，返回委托的结果。
   *
   * OpenRA 对照: MaxLength
   */
  get maxLength(): number {
    if (this.getMaxLength) return this.getMaxLength()
    return this._maxLength
  }

  set maxLength(value: number) {
    this._maxLength = value
    if (this._inputEl) {
      this._inputEl.maxLength = value > 0 ? value : -1
    }
  }

  // ---------------------------------------------------------------------------
  // Type accessor (OpenRA 对照: TextFieldType Type { get; set; })
  // ---------------------------------------------------------------------------

  /** 输入字段类型（决定验证行为）。
   *
   * 设置类型时重新验证当前文本。
   *
   * OpenRA 对照: Type
   */
  get type(): TextFieldType {
    return this._type
  }

  set type(value: TextFieldType) {
    this._type = value
    // Revalidate existing text when type changes
    const filtered = this.removeInvalidCharacters(this._text)
    if (filtered !== this._text) {
      this._text = filtered
      if (this._inputEl) {
        this._inputEl.value = filtered
        const cursorPos = this._inputEl.selectionStart ?? 0
        const clamped = Math.max(0, Math.min(cursorPos, filtered.length))
        this._inputEl.setSelectionRange(clamped, clamped)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cursor position accessors
  // OpenRA 对照: CursorPosition { get; set; }
  // ---------------------------------------------------------------------------

  /** 获取当前光标位置（字符索引）。
   * OpenRA 对照: CursorPosition */
  get cursorPosition(): number {
    if (this._inputEl) {
      return this._inputEl.selectionStart ?? 0
    }
    return 0
  }

  /** 设置光标位置。
   * OpenRA 对照: CursorPosition (set) */
  setCursorPosition(pos: number): void {
    if (!this._inputEl) return
    const clamped = Math.max(0, Math.min(pos, this.text.length))
    this._inputEl.setSelectionRange(clamped, clamped)
    this.resetBlinkCycle()
  }

  /** 移动光标指定偏移量。
   * OpenRA 对照: 左/右箭头键处理（CursorPosition-- / CursorPosition++） */
  moveCursor(offset: number): void {
    this.setCursorPosition(this.cursorPosition + offset)
  }

  /** 将光标移到文本末尾。
   * OpenRA 对照: CursorPosition = Text.Length (End 键) */
  cursorToEnd(): void {
    this.setCursorPosition(this.text.length)
  }

  /** 将光标移到文本开头。
   * OpenRA 对照: CursorPosition = 0 (Home 键) */
  cursorToStart(): void {
    this.setCursorPosition(0)
  }

  // ---------------------------------------------------------------------------
  // Selection management
  // OpenRA 对照: selectionStartIndex / selectionEndIndex / 相关方法
  // ---------------------------------------------------------------------------

  /** 获取选择起始位置。无选择时返回 -1。
   * OpenRA 对照: selectionStartIndex */
  get selectionStart(): number {
    if (!this._inputEl) return -1
    const start = this._inputEl.selectionStart ?? 0
    const end = this._inputEl.selectionEnd ?? 0
    return start !== end ? start : -1
  }

  /** 获取选择结束位置。无选择时返回 -1。
   * OpenRA 对照: selectionEndIndex */
  get selectionEnd(): number {
    if (!this._inputEl) return -1
    const start = this._inputEl.selectionStart ?? 0
    const end = this._inputEl.selectionEnd ?? 0
    return start !== end ? end : -1
  }

  /** 选择全部文本。
   * OpenRA 对照: HandleSelectionUpdate(0, Text.Length) (Ctrl+A) */
  selectAll(): void {
    if (this._inputEl) {
      this._inputEl.setSelectionRange(0, this.text.length)
      this.resetBlinkCycle()
    }
  }

  /** 清除选择。
   * OpenRA 对照: ClearSelection() */
  clearSelection(): void {
    if (this._inputEl) {
      const pos = this._inputEl.selectionEnd ?? this.cursorPosition
      this._inputEl.setSelectionRange(pos, pos)
    }
  }

  /** 是否有活动选择。
   * OpenRA 对照: selectionStartIndex != -1 */
  hasSelection(): boolean {
    if (!this._inputEl) return false
    return this._inputEl.selectionStart !== this._inputEl.selectionEnd
  }

  /** 获取当前选中的文本。无选择时返回空字符串。
   * OpenRA 对照: Text[lowestIndex..highestIndex] (Ctrl+C/X 逻辑) */
  getSelectedText(): string {
    if (!this._inputEl) return ''
    const start = this._inputEl.selectionStart ?? 0
    const end = this._inputEl.selectionEnd ?? 0
    if (start === end) return ''
    return this.text.substring(start, end)
  }

  /** 删除选中的文本。
   * OpenRA 对照: RemoveSelectedText() */
  deleteSelectedText(): void {
    if (!this.hasSelection()) return
    if (this._inputEl) {
      const start = this._inputEl.selectionStart ?? 0
      const end = this._inputEl.selectionEnd ?? 0
      const low = Math.min(start, end)
      const high = Math.max(start, end)
      this._text = this._text.substring(0, low) + this._text.substring(high)
      this._inputEl.value = this._text
      this._inputEl.setSelectionRange(low, low)
      if (this.setText) {
        this.setText(this._text)
      }
      this._notifyTextEdited()
    }
  }

  /** 将选择扩展到文本末尾。
   * OpenRA 对照: HandleSelectionUpdate(CursorPosition, Text.Length) */
  selectionToEnd(): void {
    if (this._inputEl) {
      const start = this._inputEl.selectionStart ?? 0
      this._inputEl.setSelectionRange(start, this.text.length)
    }
  }

  // ---------------------------------------------------------------------------
  // Text manipulation
  // ---------------------------------------------------------------------------

  /** 在光标位置插入文本。
   * OpenRA 对照: HandleTextInput(string) */
  insertText(input: string): void {
    if (input.length === 0) return

    const filtered = this.removeInvalidCharacters(input)
    if (filtered.length === 0) return

    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    // Check maxLength
    const effectiveMax = this.maxLength
    if (effectiveMax > 0 && this._text.length >= effectiveMax) return

    let pasteLength = filtered.length
    if (effectiveMax > 0 && effectiveMax > this._text.length) {
      pasteLength = Math.min(filtered.length, effectiveMax - this._text.length)
    }

    const cursorPos = this.cursorPosition
    const before = this._text.substring(0, cursorPos)
    const after = this._text.substring(cursorPos)
    const insert = filtered.substring(0, pasteLength)
    this._text = before + insert + after

    const newCursor = cursorPos + pasteLength
    if (this._inputEl) {
      this._inputEl.value = this._text
      this._inputEl.setSelectionRange(newCursor, newCursor)
    }

    if (this.setText) {
      this.setText(this._text)
    }

    this._notifyTextEdited()
  }

  /** 删除文本。
   *
   * @param direction — -1 表示退格（删除光标前），1 表示删除（删除光标后）
   *
   * OpenRA 对照: Backspace/Delete 键处理
   */
  deleteText(direction: -1 | 1): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return
    }

    const cursorPos = this.cursorPosition
    if (direction === -1) {
      // Backspace: delete character before cursor
      if (cursorPos <= 0) return
      this._text = this._text.substring(0, cursorPos - 1) + this._text.substring(cursorPos)
      if (this._inputEl) {
        this._inputEl.value = this._text
        this._inputEl.setSelectionRange(cursorPos - 1, cursorPos - 1)
      }
    } else {
      // Delete: delete character after cursor
      if (cursorPos >= this._text.length) return
      this._text = this._text.substring(0, cursorPos) + this._text.substring(cursorPos + 1)
      if (this._inputEl) {
        this._inputEl.value = this._text
        this._inputEl.setSelectionRange(cursorPos, cursorPos)
      }
    }

    if (this.setText) {
      this.setText(this._text)
    }

    this._notifyTextEdited()
  }

  // ---------------------------------------------------------------------------
  // Validation
  // OpenRA 对照: RemoveInvalidCharacters(string)
  // ---------------------------------------------------------------------------

  /** 根据当前类型过滤无效字符。
   *
   * - Text/Password: 无过滤
   * - Integer: 仅允许数字和可选前导负号
   * - Float: 允许数字、一个小数点和可选前导负号
   *
   * OpenRA 对照: RemoveInvalidCharacters(string)
   */
  removeInvalidCharacters(input: string): string {
    switch (this._type) {
      case TextFieldType.Integer: {
        // Allow optional leading minus sign and digits
        if (input.startsWith('-')) {
          return '-' + input.slice(1).replace(/\D/g, '')
        }
        return input.replace(/\D/g, '')
      }

      case TextFieldType.Float: {
        // Allow digits, one decimal point, optional leading minus
        let result = ''
        let hasDecimal = false
        for (let i = 0; i < input.length; i++) {
          const ch = input[i]
          if (ch === '-' && i === 0) {
            result += ch
          } else if (ch === '.' && !hasDecimal) {
            hasDecimal = true
            result += ch
          } else if (ch >= '0' && ch <= '9') {
            result += ch
          }
        }
        return result
      }

      default:
        return input
    }
  }

  // ---------------------------------------------------------------------------
  // Blink cycle management
  // OpenRA 对照: ResetBlinkCycle()
  // ---------------------------------------------------------------------------

  /** 重置光标闪烁周期。OpenRA 对照: ResetBlinkCycle() */
  protected resetBlinkCycle(): void {
    this.blinkCycle = 10
    this.showCursor = true
    this._applyCaretVisibility()
  }

  /** 将光标可见性应用到 DOM。 */
  private _applyCaretVisibility(): void {
    if (this._inputEl) {
      this._inputEl.style.caretColor = this.showCursor ? this.caretColor : 'transparent'
    }
  }

  // ---------------------------------------------------------------------------
  // DOM element accessors
  // ---------------------------------------------------------------------------

  /** 获取底层 HTML input 元素。 */
  get inputElement(): HTMLInputElement | null {
    return this._inputEl
  }

  /** 获取容器 div 元素。 */
  get containerElement(): HTMLDivElement | null {
    return this._containerEl
  }

  // ---------------------------------------------------------------------------
  // Tick (OpenRA 对照: Tick())
  // ---------------------------------------------------------------------------

  /** 每帧更新。
   *
   * - 检测禁用状态变化，必要时放弃焦点
   * - 更新光标闪烁
   *
   * OpenRA 对照: TextFieldWidget.Tick()
   */
  override tick(): void {
    // Remove blinking cursor when disabled
    const isDisabled = this.isDisabled()
    if (isDisabled !== this._wasDisabled) {
      this._wasDisabled = isDisabled
      if (isDisabled && Ui.keyboardFocusWidget === this) {
        this.yieldKeyboardFocus()
      }
    }

    // Cursor blink cycle
    if (--this.blinkCycle <= 0) {
      this.blinkCycle = 20
      this.showCursor = !this.showCursor
      this._applyCaretVisibility()
    }
  }

  // ---------------------------------------------------------------------------
  // Render (OpenRA 对照: Draw())
  // ---------------------------------------------------------------------------

  /** 返回包含输入元素的容器 div。
   *
   * OpenRA 对照: TextFieldWidget.Draw()
   */
  override render(): HTMLElement {
    // Create elements lazily (first render call)
    if (!this._containerEl) {
      this._createDom()
    }

    // Sync input value with internal state
    this._syncInputValue()

    // Update styles
    this._updateStyles()

    return this._containerEl!
  }

  /** 创建 DOM 元素并附加事件监听器。 */
  private _createDom(): void {
    // Container div
    this._containerEl = document.createElement('div')
    this._containerEl.className = 'textfield-widget'

    // Input element
    this._inputEl = document.createElement('input')
    this._inputEl.type = this._type === TextFieldType.Password ? 'password' : 'text'
    this._inputEl.className = 'textfield-input'
    this._inputEl.value = this._text
    // Cursor defaults to end when value is set programmatically; reset to start
    this._inputEl.setSelectionRange(0, 0)
    this._inputEl.placeholder = this._placeholder

    // Apply maxLength
    if (this._maxLength > 0) {
      this._inputEl.maxLength = this._maxLength
    }

    // Bind event handlers
    this._onInputBound = this._handleInput.bind(this)
    this._onKeyDownBound = this._handleKeyDown.bind(this)
    this._onFocusBound = this._handleFocus.bind(this)
    this._onBlurBound = this._handleBlur.bind(this)
    this._onMouseDownBound = this._handleMouseDown.bind(this)

    this._inputEl.addEventListener('input', this._onInputBound)
    this._inputEl.addEventListener('keydown', this._onKeyDownBound)
    this._inputEl.addEventListener('focus', this._onFocusBound)
    this._inputEl.addEventListener('blur', this._onBlurBound)
    this._inputEl.addEventListener('mousedown', this._onMouseDownBound)

    this._containerEl.appendChild(this._inputEl)
  }

  /** 同步输入元素的值到内部状态。 */
  private _syncInputValue(): void {
    if (!this._inputEl) return
    const currentText = this.text // Uses getter (may use delegate)
    if (this._inputEl.value !== currentText) {
      this._inputEl.value = currentText
    }
  }

  /** 更新容器和输入元素的样式。 */
  private _updateStyles(): void {
    if (!this._containerEl || !this._inputEl) return

    const disabled = this.isDisabled()
    const hasFocus = this.hasKeyboardFocus

    // Container styles
    this._containerEl.style.position = 'absolute'
    this._containerEl.style.left = '0'
    this._containerEl.style.top = '0'
    this._containerEl.style.width = '100%'
    this._containerEl.style.height = '100%'
    this._containerEl.style.boxSizing = 'border-box'
    this._containerEl.style.overflow = 'hidden'

    // Border style
    if (this.bordered) {
      this._containerEl.style.border = '1px solid #555'
      this._containerEl.style.borderRadius = '2px'
      if (hasFocus) {
        this._containerEl.style.borderColor = '#888'
      }
    } else {
      this._containerEl.style.border = 'none'
      this._containerEl.style.borderRadius = '0'
    }

    // Background
    this._containerEl.style.backgroundColor = disabled ? '#1a1a1a' : '#222222'

    // Input styles
    this._inputEl.style.width = '100%'
    this._inputEl.style.height = '100%'
    this._inputEl.style.border = 'none'
    this._inputEl.style.outline = 'none'
    this._inputEl.style.background = 'transparent'
    this._inputEl.style.padding = `0 ${this.rightMargin}px 0 ${this.leftMargin}px`
    this._inputEl.style.boxSizing = 'border-box'
    this._inputEl.style.fontFamily = this.font || 'inherit'
    this._inputEl.style.fontSize = 'inherit'
    this._inputEl.style.color = disabled ? this.textColorDisabled : this.textColor
    this._inputEl.style.caretColor = this.showCursor ? this.caretColor : 'transparent'

    // Selection highlight color (via CSS ::selection)
    this._inputEl.style.setProperty('--selection-bg', this.textColorHighlight)

    // Disabled state
    this._inputEl.disabled = disabled
    if (disabled) {
      this._inputEl.style.cursor = 'not-allowed'
    } else {
      this._inputEl.style.cursor = 'text'
    }
  }

  // ---------------------------------------------------------------------------
  // DOM Event handlers
  // ---------------------------------------------------------------------------

  /** 处理浏览器 input 事件（文本变化时）。 */
  private _handleInput(_e: Event): void {
    if (!this._inputEl) return
    const rawValue = this._inputEl.value
    const filtered = this.removeInvalidCharacters(rawValue)

    // Restore filtered value if needed
    if (filtered !== rawValue) {
      const cursorPos = this._inputEl.selectionStart ?? 0
      this._inputEl.value = filtered
      const adjustedPos = Math.min(cursorPos - (rawValue.length - filtered.length), filtered.length)
      this._inputEl.setSelectionRange(Math.max(0, adjustedPos), Math.max(0, adjustedPos))
    }

    this._text = filtered
    if (this.setText) {
      this.setText(filtered)
    }

    this._notifyTextEdited()
  }

  /** 处理浏览器 keydown 事件（特殊键和快捷键）。 */
  private _handleKeyDown(e: KeyboardEvent): void {
    if (!this._inputEl) return
    if (this.isDisabled()) return

    // Build WidgetEvent for callbacks
    const widgetEvent: WidgetEvent = {
      type: 'keydown',
      key: e.key,
      stopPropagation: () => e.stopPropagation(),
      target: this._inputEl,
      preventDefault: () => e.preventDefault(),
    }

    const isOSX = false // NOTE: Platform.CurrentPlatform check; web default = non-OSX
    const ctrlKey = e.ctrlKey
    const metaKey = e.metaKey

    switch (e.key) {
      case 'Enter':
        if (this.onEnterKey?.(widgetEvent)) {
          e.preventDefault()
          return
        }
        break

      case 'Tab':
        if (this.onTabKey?.(widgetEvent)) {
          e.preventDefault()
          return
        }
        break

      case 'Escape':
        this.clearSelection()
        if (this.onEscapeKey?.(widgetEvent)) {
          e.preventDefault()
          return
        }
        break

      case 'Alt':
        if (this.onAltKey?.()) {
          e.preventDefault()
          return
        }
        break

      case 'ArrowUp':
        if (this.onArrowUp?.(widgetEvent)) {
          e.preventDefault()
          return
        }
        break

      case 'ArrowDown':
        if (this.onArrowDown?.(widgetEvent)) {
          e.preventDefault()
          return
        }
        break

      // ---- Emacs-style keybindings from OpenRA ----
      // NOTE: These shortcuts are non-standard in web context.
      // Ctrl+D is "bookmark" in Chrome, Ctrl+K is "search" in Firefox.
      // We intercept them only within our input widget.

      case 'd':
      case 'D':
        // Ctrl+D: Delete character at cursor (forward delete without selection)
        if ((!isOSX && ctrlKey) || (isOSX && metaKey)) {
          if (!this.hasSelection() && this.cursorPosition < this.text.length) {
            e.preventDefault()
            this._text =
              this._text.substring(0, this.cursorPosition) +
              this._text.substring(this.cursorPosition + 1)
            this._inputEl.value = this._text
            if (this.setText) this.setText(this._text)
            this._notifyTextEdited()
          }
        }
        break

      case 'k':
      case 'K':
        // Ctrl+K: Delete from cursor to end of line
        if ((!isOSX && ctrlKey) || (isOSX && metaKey)) {
          if (this.cursorPosition < this.text.length) {
            e.preventDefault()
            this._text = this._text.substring(0, this.cursorPosition)
            this._inputEl.value = this._text
            this._inputEl.setSelectionRange(this._text.length, this._text.length)
            if (this.setText) this.setText(this._text)
            this._notifyTextEdited()
          }
        }
        break

      case 'u':
      case 'U':
        // Ctrl+U: Delete from start of line to cursor (non-OSX only)
        if (!isOSX && ctrlKey && this.cursorPosition > 0) {
          e.preventDefault()
          this._text = this._text.substring(this.cursorPosition)
          this._inputEl.value = this._text
          this._inputEl.setSelectionRange(0, 0)
          this.clearSelection()
          if (this.setText) this.setText(this._text)
          this._notifyTextEdited()
        }
        break

      // ---- Clipboard ----
      // NOTE: Ctrl+C, Ctrl+X, Ctrl+V are handled natively by the browser input.
      // We provide additional handling for the OpenRA pattern of clipboard
      // management, but primarily rely on the browser.

      case 'x':
      case 'X':
        // Ctrl+X: Cut
        if ((!isOSX && ctrlKey) || (isOSX && metaKey)) {
          if (this.hasSelection()) {
            // Browser handles the copy part natively
            // We handle the text removal
            // NOTE: Deferred to browser's native cut behavior
          }
        }
        break

      case 'c':
      case 'C':
        // Ctrl+C: Copy — handled natively by browser
        break

      case 'v':
      case 'V':
        // Ctrl+V: Paste — handled natively by browser
        // NOTE: The maxLength enforcement is handled by the input event handler
        // which filters/truncates after the browser inserts
        break

      default:
        break
    }

    // Reset blink on any key press
    this.resetBlinkCycle()
  }

  /** 处理输入元素获得焦点。 */
  private _handleFocus(): void {
    this.takeKeyboardFocus()
    this.resetBlinkCycle()
  }

  /** 处理输入元素失去焦点。 */
  private _handleBlur(): void {
    if (this.onLoseFocus) {
      this.onLoseFocus()
    }
    this.yieldKeyboardFocus()
  }

  /** 处理鼠标按下事件（重置闪烁）。 */
  private _handleMouseDown(_e: MouseEvent): void {
    this.resetBlinkCycle()
  }

  // ---------------------------------------------------------------------------
  // Event handling (Widget framework integration)
  // OpenRA 对照: HandleMouseInput / HandleKeyPress / HandleTextInput
  // ---------------------------------------------------------------------------

  /** 处理 widget 事件。
   *
   * 对于 TextFieldWidget，大多数事件由浏览器原生 <input> 元素处理。
   * 此方法仅处理通过 widget 框架路由的文本输入事件。
   *
   * OpenRA 对照: HandleKeyPress(KeyInput) + HandleTextInput(string)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (this.isDisabled()) return false

    // Handle text input from widget framework
    if (event.type === 'textinput' && event.text) {
      if (this.hasKeyboardFocus) {
        this.insertText(event.text)
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Focus management overrides
  // ---------------------------------------------------------------------------

  /** 获取键盘焦点（同步 DOM 焦点）。
   * OpenRA 对照: TakeKeyboardFocus() */
  override takeKeyboardFocus(): boolean {
    const result = super.takeKeyboardFocus()
    if (result && this._inputEl && document.activeElement !== this._inputEl) {
      this._inputEl.focus()
    }
    return result
  }

  /** 释放键盘焦点（同步 DOM 焦点）。
   * OpenRA 对照: YieldKeyboardFocus() */
  override yieldKeyboardFocus(): boolean {
    if (this.onLoseFocus) {
      this.onLoseFocus()
    }
    if (this._inputEl && document.activeElement === this._inputEl) {
      this._inputEl.blur()
    }
    return super.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /** 释放资源并移除 DOM 元素。
   * OpenRA 对照: Removed() + Widget 清理 */
  override dispose(): void {
    // Remove DOM event listeners
    if (this._inputEl) {
      if (this._onInputBound) this._inputEl.removeEventListener('input', this._onInputBound)
      if (this._onKeyDownBound) this._inputEl.removeEventListener('keydown', this._onKeyDownBound)
      if (this._onFocusBound) this._inputEl.removeEventListener('focus', this._onFocusBound)
      if (this._onBlurBound) this._inputEl.removeEventListener('blur', this._onBlurBound)
      if (this._onMouseDownBound) this._inputEl.removeEventListener('mousedown', this._onMouseDownBound)
    }

    this._inputEl = null
    this._containerEl = null
    this._onInputBound = null
    this._onKeyDownBound = null
    this._onFocusBound = null
    this._onBlurBound = null
    this._onMouseDownBound = null

    super.dispose()
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: Clone() => new TextFieldWidget(this)
  // ---------------------------------------------------------------------------

  /** 克隆此 widget。
   * OpenRA 对照: TextFieldWidget.Clone() */
  override clone(): TextFieldWidget {
    const w = new TextFieldWidget()
    w._text = this._text
    w._maxLength = this._maxLength
    w.leftMargin = this.leftMargin
    w.rightMargin = this.rightMargin
    w._type = this._type
    w.font = this.font
    w.textColor = this.textColor
    w.textColorDisabled = this.textColorDisabled
    w.textColorInvalid = this.textColorInvalid
    w.textColorHighlight = this.textColorHighlight
    w.visualHeight = this.visualHeight
    w._placeholder = this._placeholder
    w.bordered = this.bordered
    w.caretColor = this.caretColor
    w.caretFlashInterval = this.caretFlashInterval
    w.onEnterKey = this.onEnterKey
    w.onEscapeKey = this.onEscapeKey
    w.onTabKey = this.onTabKey
    w.onArrowUp = this.onArrowUp
    w.onArrowDown = this.onArrowDown
    w.onAltKey = this.onAltKey
    w.onLoseFocus = this.onLoseFocus
    w.onTextEdited = this.onTextEdited
    w.isValid = this.isValid
    w.getText = this.getText
    w.setText = this.setText
    w.getMaxLength = this.getMaxLength
    w.disabled = this.disabled
    return w
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** 通知文本已编辑（调用 onTextEdited 回调）。 */
  private _notifyTextEdited(): void {
    if (this.onTextEdited) {
      this.onTextEdited()
    }
  }
}
