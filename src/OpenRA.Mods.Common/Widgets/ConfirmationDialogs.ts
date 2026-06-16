/**
 * ConfirmationDialogs.ts — 静态类：模态确认对话框和文本输入对话框
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ConfirmationDialogs.cs (194 lines)
 *
 * 核心范式转换:
 * - OpenRA FluentProvider.GetMessage() 本地化 → 直接传入字符串（Fluent 暂未迁移）
 * - OpenRA YAML widget 模板 (THREEBUTTON_PROMPT/TWOBUTTON_PROMPT/TEXT_INPUT_PROMPT)
 *   → 编程式创建 DOM 模态对话框
 * - OpenRA ButtonWidget + LabelWidget + TextFieldWidget widget 树
 *   → 复用已迁移的 DOM widget
 * - OpenRA Ui.OpenWindow/Ui.CloseWindow 模态窗口栈
 *   → 直接构建 DOM 元素 + 焦点管理（不依赖 YAML widget 模板）
 * - OpenRA Clone() + AddChild widget 复制 → 直接创建新 widget 实例
 *
 * NOTE: 由于 FluentProvider 和 YAML widget 模板尚未迁移，本实现使用
 * 编程式创建 DOM 模态对话框。当 WidgetLoader 支持从 JSON 加载 widget 树后
 * (TODO-16.B.1 WidgetUtils)，可重构为使用模板加载。
 */

import type { ModData } from '../../OpenRA.Game/ModData.js'

// ---------------------------------------------------------------------------
// ConfirmationDialogs — 静态模态对话框工具类
// OpenRA 对照: public static class ConfirmationDialogs
// ---------------------------------------------------------------------------

/**
 * 静态模态对话框工具类。
 *
 * 提供两种标准对话框:
 * - `buttonPrompt()` — 2 或 3 按钮确认对话框
 * - `textInputPrompt()` — 文本输入对话框
 *
 * 所有 DOM 元素由编程式创建，不依赖 YAML 模板。
 *
 * OpenRA 对照: public static class ConfirmationDialogs
 */
export class ConfirmationDialogs {
  // ---- 常量 ----

  /** 模态叠加层 CSS 类名。 */
  static readonly OVERLAY_CLASS = 'modal-overlay'

  /** 对话框面板 CSS 类名。 */
  static readonly DIALOG_CLASS = 'modal-dialog'

  // ---------------------------------------------------------------------------
  // buttonPrompt — 2 或 3 按钮确认对话框
  // OpenRA 对照: ConfirmationDialogs.ButtonPrompt(ModData, string, string, ...)
  // ---------------------------------------------------------------------------

  /**
   * 打开一个 2 或 3 按钮模态确认对话框。
   *
   * 如果提供了 `onOther + otherText` 则为 3 按钮对话框，
   * 否则为 2 按钮对话框（确认+取消）。
   *
   * OpenRA 对照: ConfirmationDialogs.ButtonPrompt(...)
   *
   * @param _modData — ModData 引用（保留用于未来 Fluent/Ruleset 集成）
   * @param title — 对话框标题
   * @param text — 对话框正文（可含 \n 换行）
   * @param onConfirm — 确认按钮回调
   * @param onCancel — 取消按钮回调
   * @param confirmText — 确认按钮文本（可选，默认 "OK"）
   * @param cancelText — 取消按钮文本（可选，默认 "Cancel"）
   * @param onOther — 第三个按钮回调（可选）
   * @param otherText — 第三个按钮文本（可选）
   */
  static buttonPrompt(
    _modData: ModData | null,
    title: string,
    text: string,
    onConfirm: (() => void) | null,
    onCancel: (() => void) | null,
    confirmText?: string,
    cancelText?: string,
    onOther?: (() => void) | null,
    otherText?: string,
  ): void {
    // 创建叠加层（阻止背景交互）
    const overlay = document.createElement('div')
    overlay.className = ConfirmationDialogs.OVERLAY_CLASS
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10000;' +
      'background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;'

    // 创建对话框面板
    const dialog = document.createElement('div')
    dialog.className = ConfirmationDialogs.DIALOG_CLASS
    dialog.style.cssText =
      'background:#1a1a2e;border:2px solid #3a3a5e;border-radius:6px;' +
      'padding:20px;min-width:360px;max-width:520px;color:#e0e0e0;' +
      'font-family:Arial,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);'

    // ---- 标题 ----
    const titleEl = document.createElement('div')
    titleEl.style.cssText =
      'font-size:16px;font-weight:bold;margin-bottom:12px;color:#ffffff;'
    titleEl.textContent = title || 'Confirm'
    dialog.appendChild(titleEl)

    // ---- 正文（支持多行） ----
    const textContainer = document.createElement('div')
    textContainer.style.cssText = 'margin-bottom:20px;'

    const lines = (text || '').split('\n')
    for (const line of lines) {
      const lineEl = document.createElement('div')
      lineEl.style.cssText =
        'font-size:13px;line-height:1.5;margin-bottom:2px;color:#c0c0c0;'
      lineEl.textContent = line || ' '
      textContainer.appendChild(lineEl)
    }
    dialog.appendChild(textContainer)

    // ---- 按钮容器 ----
    const buttonContainer = document.createElement('div')
    buttonContainer.style.cssText =
      'display:flex;justify-content:flex-end;gap:8px;'

    // ---- 取消按钮 ----
    if (onCancel) {
      const cancelBtn = ConfirmationDialogs._createDialogButton(
        cancelText || 'Cancel',
        '#555',
        '#777',
      )
      cancelBtn.addEventListener('click', () => {
        ConfirmationDialogs._closeModal(overlay)
        onCancel()
      })
      cancelBtn.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          ConfirmationDialogs._closeModal(overlay)
          onCancel()
        }
      })
      buttonContainer.appendChild(cancelBtn)
    }

    // ---- 第三个按钮 (onOther) ----
    if (onOther && otherText) {
      const otherBtn = ConfirmationDialogs._createDialogButton(
        otherText,
        '#3a7a3a',
        '#4a9a4a',
      )
      otherBtn.addEventListener('click', () => {
        ConfirmationDialogs._closeModal(overlay)
        onOther()
      })
      buttonContainer.appendChild(otherBtn)
    }

    // ---- 确认按钮 ----
    if (onConfirm) {
      const confirmBtn = ConfirmationDialogs._createDialogButton(
        confirmText || 'OK',
        '#2a5a8c',
        '#3a7abc',
      )
      confirmBtn.addEventListener('click', () => {
        ConfirmationDialogs._closeModal(overlay)
        onConfirm()
      })
      // 自动聚焦确认按钮
      setTimeout(() => confirmBtn.focus(), 0)
      buttonContainer.appendChild(confirmBtn)
    }

    dialog.appendChild(buttonContainer)

    // ---- 键盘处理 (Escape = Cancel, Enter = Confirm) ----
    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ConfirmationDialogs._closeModal(overlay)
        onCancel?.()
      } else if (e.key === 'Enter') {
        ConfirmationDialogs._closeModal(overlay)
        onConfirm?.()
      }
    })

    // 叠加层点击背景关闭（视为取消）
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        ConfirmationDialogs._closeModal(overlay)
        onCancel?.()
      }
    })

    overlay.appendChild(dialog)

    // 添加到 body
    document.body.appendChild(overlay)
    overlay.focus()
  }

  // ---------------------------------------------------------------------------
  // textInputPrompt — 文本输入对话框
  // OpenRA 对照: ConfirmationDialogs.TextInputPrompt(ModData, string, string, string, ...)
  // ---------------------------------------------------------------------------

  /**
   * 打开一个文本输入模态对话框。
   *
   * 包含标题、提示文本、文本输入字段、接受/取消按钮。
   * 支持输入验证和 Enter/Escape 键盘快捷键。
   *
   * OpenRA 对照: ConfirmationDialogs.TextInputPrompt(...)
   *
   * @param _modData — ModData 引用（保留用于未来集成）
   * @param title — 对话框标题
   * @param prompt — 输入提示文本（可为空字符串）
   * @param initialText — 输入字段的初始文本
   * @param onAccept — 接受回调（接收输入文本）
   * @param onCancel — 取消回调（可选）
   * @param acceptText — 接受按钮文本（可选，默认 "OK"）
   * @param cancelText — 取消按钮文本（可选，默认 "Cancel"）
   * @param inputValidator — 输入验证函数（可选，返回 true 表示有效）
   */
  static textInputPrompt(
    _modData: ModData | null,
    title: string,
    prompt: string,
    initialText: string,
    onAccept: (text: string) => void,
    onCancel?: (() => void) | null,
    acceptText?: string,
    cancelText?: string,
    inputValidator?: ((text: string) => boolean) | null,
  ): void {
    // 创建叠加层
    const overlay = document.createElement('div')
    overlay.className = ConfirmationDialogs.OVERLAY_CLASS
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10000;' +
      'background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;'

    // 创建对话框面板
    const dialog = document.createElement('div')
    dialog.className = ConfirmationDialogs.DIALOG_CLASS
    dialog.style.cssText =
      'background:#1a1a2e;border:2px solid #3a3a5e;border-radius:6px;' +
      'padding:20px;width:420px;max-width:90vw;color:#e0e0e0;' +
      'font-family:Arial,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);'

    // ---- 标题 ----
    const titleEl = document.createElement('div')
    titleEl.style.cssText =
      'font-size:16px;font-weight:bold;margin-bottom:12px;color:#ffffff;'
    titleEl.textContent = title || 'Input'
    dialog.appendChild(titleEl)

    // ---- 提示文本 ----
    if (prompt) {
      const promptEl = document.createElement('div')
      promptEl.style.cssText =
        'font-size:13px;line-height:1.5;margin-bottom:10px;color:#c0c0c0;'
      promptEl.textContent = prompt
      dialog.appendChild(promptEl)
    }

    // ---- 文本输入字段 ----
    const inputContainer = document.createElement('div')
    inputContainer.style.cssText = 'margin-bottom:16px;'

    const input = document.createElement('input')
    input.type = 'text'
    input.value = initialText || ''
    input.style.cssText =
      'width:100%;padding:8px 10px;font-size:14px;' +
      'background:#0d0d1a;border:1px solid #3a3a5e;border-radius:4px;' +
      'color:#e0e0e0;box-sizing:border-box;outline:none;'

    // 无效输入样式
    let isValid = true
    const setValidStyle = (valid: boolean): void => {
      isValid = valid
      input.style.borderColor = valid ? '#3a3a5e' : '#cc3333'
      input.style.boxShadow = valid ? 'none' : '0 0 4px rgba(204,51,51,0.4)'
    }

    const validate = (): boolean => {
      if (!inputValidator) {
        setValidStyle(true)
        return true
      }
      const result = inputValidator(input.value)
      setValidStyle(result)
      return result
    }

    input.addEventListener('input', () => {
      validate()
    })

    // 初始验证
    validate()

    inputContainer.appendChild(input)
    dialog.appendChild(inputContainer)

    // ---- 按钮容器 ----
    const buttonContainer = document.createElement('div')
    buttonContainer.style.cssText =
      'display:flex;justify-content:flex-end;gap:8px;'

    // ---- 取消按钮 ----
    if (onCancel !== undefined && onCancel !== null) {
      const cancelBtn = ConfirmationDialogs._createDialogButton(
        cancelText || 'Cancel',
        '#555',
        '#777',
      )
      cancelBtn.addEventListener('click', () => {
        ConfirmationDialogs._closeModal(overlay)
        onCancel()
      })
      buttonContainer.appendChild(cancelBtn)
    }

    // ---- 接受按钮 ----
    const acceptBtn = ConfirmationDialogs._createDialogButton(
      acceptText || 'OK',
      '#2a5a8c',
      '#3a7abc',
    )
    const checkAcceptDisabled = (): void => {
      const disabled = inputValidator !== undefined && inputValidator !== null && !isValid
      acceptBtn.disabled = disabled
      acceptBtn.style.opacity = disabled ? '0.5' : '1'
      acceptBtn.style.cursor = disabled ? 'not-allowed' : 'pointer'
    }

    acceptBtn.addEventListener('click', () => {
      if (!validate()) return
      ConfirmationDialogs._closeModal(overlay)
      onAccept(input.value)
    })

    // 初始检查禁用状态
    checkAcceptDisabled()

    // 每当输入变化时更新接受按钮状态
    input.addEventListener('input', () => {
      validate()
      checkAcceptDisabled()
    })

    buttonContainer.appendChild(acceptBtn)
    dialog.appendChild(buttonContainer)

    // ---- 键盘处理 ----
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (!validate()) return
        ConfirmationDialogs._closeModal(overlay)
        onAccept(input.value)
      } else if (e.key === 'Escape') {
        ConfirmationDialogs._closeModal(overlay)
        onCancel?.()
      }
    })

    // 叠加层点击背景关闭（视为取消）
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        ConfirmationDialogs._closeModal(overlay)
        onCancel?.()
      }
    })

    overlay.appendChild(dialog)

    // 添加到 body 并聚焦输入
    document.body.appendChild(overlay)

    // 聚焦输入并设置光标位置
    setTimeout(() => {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }, 0)
  }

  // ---------------------------------------------------------------------------
  // 内部辅助方法
  // ---------------------------------------------------------------------------

  /**
   * 创建对话框按钮 DOM 元素。
   *
   * @param text — 按钮文本
   * @param bgColor — 背景颜色（CSS 颜色字符串）
   * @param hoverColor — 悬停颜色（CSS 颜色字符串）
   * @returns 按钮 DOM 元素
   */
  private static _createDialogButton(
    text: string,
    bgColor: string,
    hoverColor: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.textContent = text
    btn.style.cssText =
      `padding:8px 20px;font-size:13px;font-weight:bold;` +
      `border:none;border-radius:4px;cursor:pointer;` +
      `background:${bgColor};color:#ffffff;` +
      `transition:background 0.15s;min-width:80px;`
    btn.addEventListener('mouseenter', () => {
      btn.style.background = hoverColor
    })
    btn.addEventListener('mouseleave', () => {
      btn.style.background = bgColor
    })
    return btn
  }

  /**
   * 关闭模态对话框（从 DOM 中移除叠加层）。
   *
   * @param overlay — 要移除的叠加层元素
   */
  private static _closeModal(overlay: HTMLElement): void {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
    }
  }
}
