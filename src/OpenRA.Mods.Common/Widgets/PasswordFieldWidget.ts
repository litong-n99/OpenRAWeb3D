/**
 * PasswordFieldWidget.ts — 密码输入字段 widget（文本视觉屏蔽）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/PasswordFieldWidget.cs (23 lines)
 *
 * 核心范式转换:
 * - C# 重写 GetApparentText() 返回 '*' 字符 × N 实现视觉屏蔽
 *   → 使用 HTML <input type="password">（浏览器原生密码屏蔽）
 * - C# 手动渲染文本 + 光标 → 浏览器原生密码输入框
 * - 文本值以明文存储（与 C# 行为一致），仅视觉显示被屏蔽
 */

import { TextFieldWidget } from './TextFieldWidget.js'
import { TextFieldType } from './TextFieldType.js'

// ---------------------------------------------------------------------------
// PasswordFieldWidget — 密码输入 widget
// OpenRA 对照: public class PasswordFieldWidget : TextFieldWidget
// ---------------------------------------------------------------------------

/** 密码输入字段 widget — 在视觉上屏蔽文本显示。
 *
 * 内部以明文存储文本（与 OpenRA 行为完全一致），
 * 仅通过 HTML `<input type="password">` 在视觉上进行屏蔽。
 * 继承 TextFieldWidget 的所有光标、选择和验证功能。
 *
 * OpenRA 对照: PasswordFieldWidget : TextFieldWidget
 */
export class PasswordFieldWidget extends TextFieldWidget {
  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: public PasswordFieldWidget() { }
  // ---------------------------------------------------------------------------

  constructor() {
    super()
    // Set type to Password for validation behavior
    this.type = TextFieldType.Password
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: Clone() => new PasswordFieldWidget(this)
  // ---------------------------------------------------------------------------

  /** 克隆此 password widget。
   * OpenRA 对照: PasswordFieldWidget.Clone() */
  override clone(): PasswordFieldWidget {
    const w = new PasswordFieldWidget()
    // Copy base TextFieldWidget properties
    w._text = this.text // Uses getter which may be delegate-backed
    w._maxLength = this._maxLength
    w.leftMargin = this.leftMargin
    w.rightMargin = this.rightMargin
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
  // NOTE: GetApparentText() 不需要重写 — 使用 <input type="password">
  // 浏览器原生处理密码屏蔽，与 C# 的 GetApparentText() 返回 '*' 效果相同。
  // 文本在内部以明文存储（通过 this.text getter/setter），
  // 与 OpenRA 行为完全一致。
  // ---------------------------------------------------------------------------
}
