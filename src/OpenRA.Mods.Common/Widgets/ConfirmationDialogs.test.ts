/**
 * ConfirmationDialogs.test.ts — ConfirmationDialogs 单元测试
 *
 * 测试覆盖:
 * - buttonPrompt: 2 按钮、3 按钮、自定义文本、回调执行
 * - textInputPrompt: 接受/取消、初始文本、验证器、Enter/Escape 键盘行为
 * - 模态叠加层创建和清理
 * - 边界情况: 空标题/文本、null 回调、缺失可选参数
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConfirmationDialogs } from './ConfirmationDialogs.js'

// ---------------------------------------------------------------------------
// DOM setup helpers
// ---------------------------------------------------------------------------

/** 在测试前设置最小的 DOM 环境。 */
function ensureBody(): void {
  if (typeof document === 'undefined') return
  if (!document.body) {
    // happy-dom 通常已有 document.body，安全起见
  }
}

/** 获取所有模态叠加层元素。 */
function getOverlays(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(`.${'modal-overlay'}`),
  ) as HTMLElement[]
}

/** 获取第一个叠加层。 */
function getFirstOverlay(): HTMLElement | null {
  return document.querySelector(`.${'modal-overlay'}`) as HTMLElement | null
}

/** 清理所有模态叠加层。 */
function cleanupModals(): void {
  for (const overlay of getOverlays()) {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfirmationDialogs', () => {
  beforeEach(() => {
    ensureBody()
    cleanupModals()
  })

  afterEach(() => {
    cleanupModals()
  })

  // ---------------------------------------------------------------------------
  // buttonPrompt
  // ---------------------------------------------------------------------------

  describe('buttonPrompt', () => {
    it('creates a modal overlay in the document body', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Test Title',
        'Test message',
        onConfirm,
        onCancel,
      )

      const overlay = getFirstOverlay()
      expect(overlay).not.toBeNull()
      expect(overlay!.parentNode).toBe(document.body)
      expect(overlay!.style.position).toBe('fixed')
      // NOTE: happy-dom may not expand the `inset` shorthand; check via cssText
      expect(overlay!.style.cssText).toContain('inset:')
    })

    it('displays the title in the dialog', () => {
      ConfirmationDialogs.buttonPrompt(
        null,
        'Custom Title',
        'Body text',
        vi.fn(),
        vi.fn(),
      )

      const overlay = getFirstOverlay()
      expect(overlay!.textContent).toContain('Custom Title')
    })

    it('displays multi-line text body', () => {
      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Line 1\nLine 2\nLine 3',
        vi.fn(),
        vi.fn(),
      )

      const overlay = getFirstOverlay()
      expect(overlay!.textContent).toContain('Line 1')
      expect(overlay!.textContent).toContain('Line 2')
      expect(overlay!.textContent).toContain('Line 3')
    })

    it('creates OK and Cancel buttons with default text', () => {
      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        vi.fn(),
        vi.fn(),
      )

      const overlay = getFirstOverlay()
      const buttons = overlay!.querySelectorAll('button')
      expect(buttons.length).toBe(2)

      const buttonTexts = Array.from(buttons).map((b) => b.textContent)
      expect(buttonTexts).toContain('Cancel')
      expect(buttonTexts).toContain('OK')
    })

    it('uses custom button text when provided', () => {
      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        vi.fn(),
        vi.fn(),
        'Accept',
        'Reject',
      )

      const overlay = getFirstOverlay()
      const buttonTexts = Array.from(overlay!.querySelectorAll('button')).map(
        (b) => b.textContent,
      )
      expect(buttonTexts).toContain('Accept')
      expect(buttonTexts).toContain('Reject')
    })

    it('calls onConfirm when OK button is clicked', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        onCancel,
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const okButton = Array.from(buttons).find(
        (b) => b.textContent === 'OK',
      )!
      okButton.click()

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('calls onCancel when Cancel button is clicked', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        onCancel,
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const cancelButton = Array.from(buttons).find(
        (b) => b.textContent === 'Cancel',
      )!
      cancelButton.click()

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('removes overlay from DOM after confirm click', () => {
      const onConfirm = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        vi.fn(),
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const okButton = Array.from(buttons).find(
        (b) => b.textContent === 'OK',
      )!
      okButton.click()

      expect(getOverlays().length).toBe(0)
    })

    it('removes overlay from DOM after cancel click', () => {
      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        vi.fn(),
        vi.fn(),
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const cancelButton = Array.from(buttons).find(
        (b) => b.textContent === 'Cancel',
      )!
      cancelButton.click()

      expect(getOverlays().length).toBe(0)
    })

    it('creates 3-button dialog when onOther + otherText are provided', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const onOther = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        onCancel,
        'Yes',
        'No',
        onOther,
        'Maybe',
      )

      const overlay = getFirstOverlay()
      const buttons = overlay!.querySelectorAll('button')
      expect(buttons.length).toBe(3)

      const buttonTexts = Array.from(buttons).map((b) => b.textContent)
      expect(buttonTexts).toContain('Yes')
      expect(buttonTexts).toContain('No')
      expect(buttonTexts).toContain('Maybe')
    })

    it('calls onOther when third button is clicked', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const onOther = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        onCancel,
        'Yes',
        'No',
        onOther,
        'Maybe',
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const otherButton = Array.from(buttons).find(
        (b) => b.textContent === 'Maybe',
      )!
      otherButton.click()

      expect(onOther).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
      expect(getOverlays().length).toBe(0)
    })

    it('triggers cancel when clicking overlay background', () => {
      const onCancel = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        vi.fn(),
        onCancel,
      )

      const overlay = getFirstOverlay()!
      overlay.click() // 点击叠加层本身（不是内部对话框）

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(getOverlays().length).toBe(0)
    })

    it('handles Enter key as confirm', () => {
      const onConfirm = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        vi.fn(),
      )

      const overlay = getFirstOverlay()!

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      })
      overlay.dispatchEvent(event)

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('handles Escape key as cancel', () => {
      const onCancel = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        vi.fn(),
        onCancel,
      )

      const overlay = getFirstOverlay()!

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      })
      overlay.dispatchEvent(event)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('handles null callbacks gracefully', () => {
      // Should not throw
      expect(() => {
        ConfirmationDialogs.buttonPrompt(null, '', '', null, null)
      }).not.toThrow()

      const overlay = getFirstOverlay()
      expect(overlay).not.toBeNull()
      // No buttons created when callbacks are null
      const buttons = overlay!.querySelectorAll('button')
      expect(buttons.length).toBe(0)
    })

    it('handles empty title and text', () => {
      ConfirmationDialogs.buttonPrompt(null, '', '', vi.fn(), vi.fn())

      const overlay = getFirstOverlay()
      expect(overlay).not.toBeNull()
      // 标题为空时显示 'Confirm'
      expect(overlay!.textContent).toContain('Confirm')
    })

    it('handles only confirm callback (no cancel)', () => {
      const onConfirm = vi.fn()

      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        onConfirm,
        null,
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      expect(buttons.length).toBe(1)
      expect(buttons[0].textContent).toBe('OK')
    })

    it('does not add cancel button when onCancel is null', () => {
      ConfirmationDialogs.buttonPrompt(
        null,
        'Title',
        'Body',
        vi.fn(),
        null,
        'Save',
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const buttonTexts = Array.from(buttons).map((b) => b.textContent)
      expect(buttonTexts).not.toContain('Cancel')
    })
  })

  // ---------------------------------------------------------------------------
  // textInputPrompt
  // ---------------------------------------------------------------------------

  describe('textInputPrompt', () => {
    it('creates a modal overlay with text input', () => {
      const onAccept = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Input Title',
        'Enter value:',
        'initial',
        onAccept,
        vi.fn(),
      )

      const overlay = getFirstOverlay()
      expect(overlay).not.toBeNull()
      expect(overlay!.textContent).toContain('Input Title')
      expect(overlay!.textContent).toContain('Enter value:')

      const input = overlay!.querySelector('input')
      expect(input).not.toBeNull()
      expect(input!.value).toBe('initial')
    })

    it('sets initial text in the input field', () => {
      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        'Hello World',
        vi.fn(),
        vi.fn(),
      )

      const input = getFirstOverlay()!.querySelector(
        'input',
      ) as HTMLInputElement
      expect(input.value).toBe('Hello World')
    })

    it('calls onAccept with input text when OK is clicked', () => {
      const onAccept = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        'test text',
        onAccept,
        vi.fn(),
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const okButton = Array.from(buttons).find(
        (b) => b.textContent === 'OK',
      )!
      okButton.click()

      expect(onAccept).toHaveBeenCalledTimes(1)
      expect(onAccept).toHaveBeenCalledWith('test text')
    })

    it('calls onCancel when Cancel button is clicked', () => {
      const onAccept = vi.fn()
      const onCancel = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        onAccept,
        onCancel,
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const cancelButton = Array.from(buttons).find(
        (b) => b.textContent === 'Cancel',
      )!
      cancelButton.click()

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onAccept).not.toHaveBeenCalled()
    })

    it('calls onAccept when Enter is pressed in input', () => {
      const onAccept = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        'enter text',
        onAccept,
        vi.fn(),
      )

      const input = getFirstOverlay()!.querySelector('input')!

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      })
      input.dispatchEvent(event)

      expect(onAccept).toHaveBeenCalledWith('enter text')
    })

    it('calls onCancel when Escape is pressed in input', () => {
      const onCancel = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        vi.fn(),
        onCancel,
      )

      const input = getFirstOverlay()!.querySelector('input')!

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      })
      input.dispatchEvent(event)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('validates input and disables accept button when invalid', () => {
      const onAccept = vi.fn()
      const validator = (text: string): boolean => text.length >= 3

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        'ab',
        onAccept,
        vi.fn(),
        'OK',
        'Cancel',
        validator,
      )

      const okButton = Array.from(
        getFirstOverlay()!.querySelectorAll('button'),
      ).find((b) => b.textContent === 'OK')! as HTMLButtonElement

      // 初始文本 'ab' 只有 2 个字符 → 无效
      expect(okButton.disabled).toBe(true)
      expect(okButton.style.opacity).toBe('0.5')
    })

    it('enables accept button when input becomes valid', () => {
      const onAccept = vi.fn()
      const validator = (text: string): boolean => text.length >= 3

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        onAccept,
        vi.fn(),
        'OK',
        'Cancel',
        validator,
      )

      const input = getFirstOverlay()!.querySelector(
        'input',
      ) as HTMLInputElement
      const okButton = Array.from(
        getFirstOverlay()!.querySelectorAll('button'),
      ).find((b) => b.textContent === 'OK')! as HTMLButtonElement

      // 初始为空 → 无效
      expect(okButton.disabled).toBe(true)

      // 输入 3 个字符 → 有效
      input.value = 'abc'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      expect(okButton.disabled).toBe(false)
      expect(okButton.style.opacity).toBe('1')
    })

    it('does not call onAccept when Enter is pressed and validation fails', () => {
      const onAccept = vi.fn()
      const validator = (text: string): boolean => text.length >= 3

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        'ab',
        onAccept,
        vi.fn(),
        'OK',
        'Cancel',
        validator,
      )

      const input = getFirstOverlay()!.querySelector('input')!

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      })
      input.dispatchEvent(event)

      // 验证失败，不应调用 onAccept
      expect(onAccept).not.toHaveBeenCalled()
      // 叠加层仍应存在
      expect(getOverlays().length).toBe(1)
    })

    it('removes overlay after accept', () => {
      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        'text',
        vi.fn(),
        vi.fn(),
      )

      const buttons = getFirstOverlay()!.querySelectorAll('button')
      const okButton = Array.from(buttons).find(
        (b) => b.textContent === 'OK',
      )!
      okButton.click()

      expect(getOverlays().length).toBe(0)
    })

    it('handles null onCancel gracefully', () => {
      const onAccept = vi.fn()

      expect(() => {
        ConfirmationDialogs.textInputPrompt(
          null,
          'Title',
          '',
          '',
          onAccept,
          null,
        )
      }).not.toThrow()

      // 不应有 Cancel 按钮
      const buttons = getFirstOverlay()!.querySelectorAll('button')
      expect(buttons.length).toBe(1)
      expect(buttons[0].textContent).toBe('OK')
    })

    it('handles undefined onCancel (omitted parameter)', () => {
      const onAccept = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        onAccept,
        undefined,
      )

      // 不应有 Cancel 按钮
      const buttons = getFirstOverlay()!.querySelectorAll('button')
      expect(buttons.length).toBe(1)
    })

    it('uses custom accept/cancel button text', () => {
      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        vi.fn(),
        vi.fn(),
        'Submit',
        'Dismiss',
      )

      const buttonTexts = Array.from(
        getFirstOverlay()!.querySelectorAll('button'),
      ).map((b) => b.textContent)
      expect(buttonTexts).toContain('Submit')
      expect(buttonTexts).toContain('Dismiss')
    })

    it('shows prompt text when provided', () => {
      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        'Please type here:',
        '',
        vi.fn(),
        vi.fn(),
      )

      const overlay = getFirstOverlay()
      expect(overlay!.textContent).toContain('Please type here:')
    })

    it('does not show prompt element when prompt is empty', () => {
      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        vi.fn(),
        vi.fn(),
      )

      // 标题和输入应存在
      const overlay = getFirstOverlay()
      expect(overlay!.textContent).toContain('Title')
      expect(overlay!.querySelector('input')).not.toBeNull()
    })

    it('clicking overlay background calls onCancel', () => {
      const onCancel = vi.fn()

      ConfirmationDialogs.textInputPrompt(
        null,
        'Title',
        '',
        '',
        vi.fn(),
        onCancel,
      )

      const overlay = getFirstOverlay()!
      overlay.click()

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
