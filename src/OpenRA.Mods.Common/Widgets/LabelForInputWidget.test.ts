/**
 * LabelForInputWidget.test.ts — LabelForInputWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化
 * - For 属性（关联 input ID）
 * - TextDisabledColor 属性
 * - InputWidget 延迟查找
 * - setInputWidgetResolver
 * - getEffectiveColor（根据关联 input 禁用状态返回颜色）
 * - Event handling（点击聚焦关联 input）
 * - DOM 渲染
 * - Clone 复制构造函数
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LabelForInputWidget, type IInputWidgetRef } from './LabelForInputWidget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Mock input widget
// ---------------------------------------------------------------------------

function createMockInputWidget(
  disabled: boolean = false,
): IInputWidgetRef & { _focusCallCount: number } {
  let disabledState = disabled
  return {
    _focusCallCount: 0,
    isDisabled(): boolean {
      return disabledState
    },
    focus(): void {
      this._focusCallCount++
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClickEvent(): WidgetEvent {
  const stopped = { value: false }
  return {
    type: 'click',
    stopPropagation(): void { stopped.value = true },
    target: null,
    clientX: 0,
    clientY: 0,
    _stopped: stopped,
  } as WidgetEvent & { _stopped: { value: boolean } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LabelForInputWidget', () => {
  let widget: LabelForInputWidget

  beforeEach(() => {
    widget = new LabelForInputWidget()
    widget.bounds = { x: 0, y: 0, width: 200, height: 24 }
  })

  describe('default properties', () => {
    it('has null For by default', () => {
      expect(widget.for).toBeNull()
    })

    it('has default textDisabledColor', () => {
      expect(widget.textDisabledColor).toBeTruthy()
      expect(typeof widget.textDisabledColor).toBe('string')
    })

    it('inherits LabelWidget properties', () => {
      widget.text = 'Input Label'
      expect(widget.getText()).toBe('Input Label')
    })
  })

  describe('inputWidget lazy initialization', () => {
    it('returns null when no resolver is set', () => {
      const input = widget.inputWidget
      expect(input).toBeNull()
    })

    it('returns input from resolver', () => {
      const mockInput = createMockInputWidget()
      widget.setInputWidgetResolver(() => mockInput)

      expect(widget.inputWidget).toBe(mockInput)
    })

    it('caches input after first access (Lazy pattern)', () => {
      let callCount = 0
      const mockInput = createMockInputWidget()
      widget.setInputWidgetResolver(() => {
        callCount++
        return mockInput
      })

      widget.inputWidget
      widget.inputWidget // Second access

      expect(callCount).toBe(1)
    })
  })

  describe('getEffectiveColor', () => {
    it('returns normal color when input is not disabled', () => {
      const mockInput = createMockInputWidget(false)
      widget.setInputWidgetResolver(() => mockInput)

      const color = widget.getEffectiveColor()
      expect(color).toBe(widget.textColor)
    })

    it('returns disabled color when input is disabled', () => {
      const mockInput = createMockInputWidget(true)
      widget.setInputWidgetResolver(() => mockInput)

      const color = widget.getEffectiveColor()
      expect(color).toBe(widget.textDisabledColor)
    })

    it('returns normal color when input resolver is not set', () => {
      const color = widget.getEffectiveColor()
      expect(color).toBe(widget.textColor)
    })
  })

  describe('event handling', () => {
    it('focuses associated input on click', () => {
      const mockInput = createMockInputWidget(false)
      widget.setInputWidgetResolver(() => mockInput)

      const result = widget.handleEvent(makeClickEvent())

      expect(result).toBe(true)
      expect(mockInput._focusCallCount).toBe(1)
    })

    it('does not focus disabled input on click', () => {
      const mockInput = createMockInputWidget(true)
      widget.setInputWidgetResolver(() => mockInput)

      const result = widget.handleEvent(makeClickEvent())

      expect(result).toBe(false)
      expect(mockInput._focusCallCount).toBe(0)
    })

    it('does nothing when input resolver is not set', () => {
      const result = widget.handleEvent(makeClickEvent())
      expect(result).toBe(false)
    })
  })

  describe('DOM rendering', () => {
    it('renders text content', () => {
      widget.text = 'Click me'
      const el = widget.render()
      expect(el.textContent).toContain('Click me')
    })

    it('renders with pointer cursor', () => {
      const el = widget.render()
      expect(el.style.cursor).toBe('pointer')
    })
  })

  describe('clone', () => {
    it('creates a copy with same properties', () => {
      widget.for = 'input-widget-id'
      widget.textDisabledColor = '#AAAAAA'
      widget.text = 'Label Text'

      const clone = widget.clone()

      expect(clone.for).toBe('input-widget-id')
      expect(clone.textDisabledColor).toBe('#AAAAAA')
      expect(clone.text).toBe('Label Text')
    })

    it('clone resets lazy input state', () => {
      const mockInput = createMockInputWidget()
      widget.setInputWidgetResolver(() => mockInput)
      widget.inputWidget // Create

      const clone = widget.clone()
      // Clone should not have the cached input
      expect(clone.inputWidget).toBeNull()
    })

    it('clone is a LabelForInputWidget instance', () => {
      const clone = widget.clone()
      expect(clone instanceof LabelForInputWidget).toBe(true)
    })
  })
})
