/**
 * CheckboxWidget.test.ts — CheckboxWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化
 * - 委托默认值 (getValue, setValue, getCheckmark, isChecked)
 * - toggle() 行为（值翻转 + 禁用保护 + onChange 回调）
 * - toggleOnClick 属性控制自动切换
 * - 键盘事件处理 (Space/Enter 切换)
 * - 鼠标事件处理 (继承自 ButtonWidget)
 * - DOM 渲染（data-checked 属性、勾选标记元素、文本标签）
 * - disabled 状态下的 checkmark 样式
 * - ChromeMetrics 默认值加载
 * - Clone 复制构造函数
 * - copyCheckboxFrom 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CheckboxWidget } from './CheckboxWidget.js'
import { ButtonWidget } from './ButtonWidget.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { InputWidget } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// ChromeMetrics - mock
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Widgets/ChromeMetrics.js', () => {
  const _metrics: Map<string, unknown> = new Map()
  return {
    ChromeMetrics: {
      get: vi.fn(<T>(key: string, _fallback?: T): T => {
        if (_metrics.has(key)) return _metrics.get(key) as T
        if (_fallback !== undefined) return _fallback
        throw new Error(`ChromeMetrics key '${key}' not found`)
      }),
      tryGet: vi.fn(<T>(key: string): T | undefined => {
        return _metrics.has(key) ? (_metrics.get(key) as T) : undefined
      }),
      _reset: () => _metrics.clear(),
      _register: (key: string, value: unknown) => _metrics.set(key, value),
    },
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMouseEvent(
  type: string,
  overrides: Partial<WidgetEvent> = {},
): WidgetEvent {
  return {
    type,
    stopPropagation: vi.fn(),
    target: null,
    clientX: 0,
    clientY: 0,
    button: 0,
    ...overrides,
  }
}

function makeKeyEvent(
  key: string,
  overrides: Partial<WidgetEvent> = {},
): WidgetEvent {
  return {
    type: 'keydown',
    stopPropagation: vi.fn(),
    target: null,
    key,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckboxWidget', () => {
  beforeEach(() => {
    ;(ChromeMetrics as any)._reset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Construction & Inheritance
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should extend ButtonWidget', () => {
      const cb = new CheckboxWidget()
      expect(cb).toBeInstanceOf(CheckboxWidget)
      expect(cb).toBeInstanceOf(ButtonWidget)
      expect(cb).toBeInstanceOf(InputWidget)
    })

    it('should have default background "checkbox"', () => {
      const cb = new CheckboxWidget()
      expect(cb.background).toBe('checkbox')
    })

    it('should initialize default delegates', () => {
      const cb = new CheckboxWidget()

      expect(cb.getValue()).toBe(false)
      expect(cb.isChecked()).toBe(false)
      expect(cb.getCheckmark()).toBe('tick')
    })

    it('should have toggleOnClick true by default', () => {
      const cb = new CheckboxWidget()
      expect(cb.toggleOnClick).toBe(true)
    })

    it('should have default checkmark name "tick"', () => {
      const cb = new CheckboxWidget()
      expect(cb.checkmark).toBe('tick')
    })
  })

  // ---------------------------------------------------------------------------
  // Default value delegates
  // ---------------------------------------------------------------------------

  describe('getValue / setValue', () => {
    it('should return default internal value (false)', () => {
      const cb = new CheckboxWidget()
      expect(cb.getValue()).toBe(false)
    })

    it('should set and get internal value', () => {
      const cb = new CheckboxWidget()
      cb.setValue(true)
      expect(cb.getValue()).toBe(true)
    })

    it('should support custom getValue delegate', () => {
      const cb = new CheckboxWidget()
      let external = true
      cb.getValue = () => external
      expect(cb.getValue()).toBe(true)
    })

    it('should support custom setValue delegate', () => {
      const cb = new CheckboxWidget()
      let external = false
      cb.setValue = (v: boolean) => {
        external = v
      }
      cb.setValue(true)
      expect(external).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // isChecked
  // ---------------------------------------------------------------------------

  describe('isChecked', () => {
    it('should delegate to getValue by default', () => {
      const cb = new CheckboxWidget()
      cb.setValue(true)
      expect(cb.isChecked()).toBe(true)
      cb.setValue(false)
      expect(cb.isChecked()).toBe(false)
    })

    it('should support custom isChecked delegate', () => {
      const cb = new CheckboxWidget()
      cb.isChecked = () => true
      expect(cb.isChecked()).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // getCheckmark
  // ---------------------------------------------------------------------------

  describe('getCheckmark', () => {
    it('should return checkmark name by default', () => {
      const cb = new CheckboxWidget()
      expect(cb.getCheckmark()).toBe('tick')
    })

    it('should support custom getCheckmark delegate', () => {
      const cb = new CheckboxWidget()
      cb.getCheckmark = () => 'custom-check'
      expect(cb.getCheckmark()).toBe('custom-check')
    })
  })

  // ---------------------------------------------------------------------------
  // toggle()
  // ---------------------------------------------------------------------------

  describe('toggle()', () => {
    it('should flip value from false to true', () => {
      const cb = new CheckboxWidget()
      cb.toggle()
      expect(cb.getValue()).toBe(true)
    })

    it('should flip value from true to false', () => {
      const cb = new CheckboxWidget()
      cb.setValue(true)
      cb.toggle()
      expect(cb.getValue()).toBe(false)
    })

    it('should not toggle when disabled', () => {
      const cb = new CheckboxWidget()
      cb.disabled = true
      cb.toggle()
      expect(cb.getValue()).toBe(false)
    })

    it('should call onCheckboxChange callback with new value', () => {
      const cb = new CheckboxWidget()
      let changedValue: boolean | null = null
      cb.onCheckboxChange = (v: boolean) => {
        changedValue = v
      }
      cb.toggle()
      expect(changedValue).toBe(true)
    })

    it('should call onCheckboxChange when toggling from true to false', () => {
      const cb = new CheckboxWidget()
      cb.setValue(true)
      let changedValue: boolean | null = null
      cb.onCheckboxChange = (v: boolean) => {
        changedValue = v
      }
      cb.toggle()
      expect(changedValue).toBe(false)
    })

    it('should not call onCheckboxChange when disabled', () => {
      const cb = new CheckboxWidget()
      cb.disabled = true
      const spy = vi.fn()
      cb.onCheckboxChange = spy
      cb.toggle()
      expect(spy).not.toHaveBeenCalled()
    })

    it('should not fire onCheckboxChange if not set', () => {
      const cb = new CheckboxWidget()
      cb.onCheckboxChange = null
      // should not throw
      expect(() => cb.toggle()).not.toThrow()
      expect(cb.getValue()).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // toggleOnClick
  // ---------------------------------------------------------------------------

  describe('toggleOnClick', () => {
    it('should toggle when toggleOnClick is true (default)', () => {
      const cb = new CheckboxWidget()
      // The onClick delegate should toggle
      cb.onClick()
      expect(cb.getValue()).toBe(true)
    })

    it('should not toggle when toggleOnClick is false', () => {
      const cb = new CheckboxWidget()
      cb.toggleOnClick = false
      cb.onClick()
      expect(cb.getValue()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Keyboard event handling
  // ---------------------------------------------------------------------------

  describe('keyboard events', () => {
    it('should toggle on Space key', () => {
      const cb = new CheckboxWidget()
      const event = makeKeyEvent(' ')
      const result = cb.handleEvent(event)
      expect(result).toBe(true)
      expect(cb.getValue()).toBe(true)
    })

    it('should toggle on Enter key', () => {
      const cb = new CheckboxWidget()
      const event = makeKeyEvent('Enter')
      const result = cb.handleEvent(event)
      expect(result).toBe(true)
      expect(cb.getValue()).toBe(true)
    })

    it('should not toggle on Space when disabled', () => {
      const cb = new CheckboxWidget()
      cb.disabled = true
      const event = makeKeyEvent(' ')
      cb.handleEvent(event)
      expect(cb.getValue()).toBe(false)
    })

    it('should not toggle on arbitrary keys', () => {
      const cb = new CheckboxWidget()
      const event = makeKeyEvent('a')
      cb.handleEvent(event)
      expect(cb.getValue()).toBe(false)
    })

    it('should toggle even when toggleOnClick is false (keyboard always toggles)', () => {
      const cb = new CheckboxWidget()
      cb.toggleOnClick = false
      const event = makeKeyEvent(' ')
      cb.handleEvent(event)
      // Space/Enter directly calls toggle(), not onClick
      expect(cb.getValue()).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse events (from ButtonWidget inheritance)
  // ---------------------------------------------------------------------------

  describe('mouse events', () => {
    it('should handle mousedown via ButtonWidget inheritance', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 100, height: 30 }
      const event = makeMouseEvent('mousedown', { clientX: 10, clientY: 10 })
      cb.handleEvent(event)
      // ButtonWidget should have taken mouse focus
      expect(cb.hasMouseFocus).toBe(true)
    })

    it('should not take focus when left button is not pressed', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 100, height: 30 }
      const event = makeMouseEvent('mousedown', {
        clientX: 10,
        clientY: 10,
        button: 2,
      })
      cb.handleEvent(event)
      expect(cb.hasMouseFocus).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // ChromeMetrics defaults
  // ---------------------------------------------------------------------------

  describe('ChromeMetrics defaults', () => {
    it('should use "checkbox" background from ChromeMetrics if available', () => {
      ;(ChromeMetrics as any)._register('CheckboxBackground', 'custom-checkbox-bg')
      const cb = new CheckboxWidget()
      expect(cb.background).toBe('custom-checkbox-bg')
    })

    it('should use default "checkbox" background if ChromeMetrics not set', () => {
      const cb = new CheckboxWidget()
      expect(cb.background).toBe('checkbox')
    })

    it('should use custom checkmark from ChromeMetrics if available', () => {
      ;(ChromeMetrics as any)._register('CheckboxCheckmark', 'custom-tick')
      const cb = new CheckboxWidget()
      expect(cb.checkmark).toBe('custom-tick')
    })

    it('should gracefully handle ChromeMetrics failures', () => {
      // ChromeMetrics.tryGet throws for non-existent keys in mock;
      // but our _loadCheckboxDefaults catches exceptions
      const cb = new CheckboxWidget()
      expect(cb.background).toBe('checkbox')
      expect(cb.checkmark).toBe('tick')
    })
  })

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  describe('render()', () => {
    it('should return an HTMLElement', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      const el = cb.render()
      expect(el).toBeInstanceOf(HTMLElement)
    })

    it('should set data-checked="true" when checked', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      cb.setValue(true)
      const el = cb.render()
      expect(el.getAttribute('data-checked')).toBe('true')
    })

    it('should set data-checked="false" when unchecked', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      const el = cb.render()
      expect(el.getAttribute('data-checked')).toBe('false')
    })

    it('should render a checkmark element with data-checkbox-mark attribute', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      cb.setValue(true)
      const el = cb.render()
      const mark = el.querySelector('[data-checkbox-mark]')
      expect(mark).not.toBeNull()
      expect(mark!.getAttribute('data-checked')).toBe('true')
    })

    it('should show checkmark character when checked', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      cb.setValue(true)
      const el = cb.render()
      const mark = el.querySelector('[data-checkbox-mark]') as HTMLElement
      expect(mark.textContent).toContain('✓')
    })

    it('should not show checkmark character when unchecked', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      const el = cb.render()
      const mark = el.querySelector('[data-checkbox-mark]') as HTMLElement
      expect(mark.textContent).toBe('')
    })

    it('should set data-disabled on checkmark when disabled', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      cb.disabled = true
      cb.setValue(true)
      const el = cb.render()
      const mark = el.querySelector('[data-checkbox-mark]') as HTMLElement
      expect(mark.getAttribute('data-disabled')).toBe('true')
    })

    it('should add checkbox-widget CSS class', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      const el = cb.render()
      expect(el.classList.contains('checkbox-widget')).toBe(true)
    })

    it('should not have duplicate checkmark elements on repeated renders', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      cb.render()
      const el = cb.render()
      const marks = el.querySelectorAll('[data-checkbox-mark]')
      expect(marks.length).toBe(1)
    })

    it('should set data-checkmark-type on mark element', () => {
      const cb = new CheckboxWidget()
      cb.bounds = { x: 0, y: 0, width: 120, height: 28 }
      cb.checkmark = 'radio-tick'
      const el = cb.render()
      const mark = el.querySelector('[data-checkbox-mark]') as HTMLElement
      expect(mark.getAttribute('data-checkmark-type')).toBe('radio-tick')
    })
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe('clone()', () => {
    it('should create a new CheckboxWidget instance', () => {
      const cb = new CheckboxWidget()
      const cloned = cb.clone()
      expect(cloned).toBeInstanceOf(CheckboxWidget)
      expect(cloned).not.toBe(cb)
    })

    it('should copy checkbox-specific properties', () => {
      const cb = new CheckboxWidget()
      cb.setValue(true)
      cb.checkmark = 'custom-mark'
      cb.getCheckmark = () => 'delegate-mark'
      cb.toggleOnClick = false

      const cloned = cb.clone() as CheckboxWidget
      expect(cloned.getValue()).toBe(true)
      expect(cloned.checkmark).toBe('custom-mark')
      expect(cloned.getCheckmark()).toBe('delegate-mark')
      expect(cloned.toggleOnClick).toBe(false)
    })

    it('should copy ButtonWidget properties', () => {
      const cb = new CheckboxWidget()
      cb.text = 'Hello'
      cb.font = '16px Arial'
      cb.disabled = true

      const cloned = cb.clone() as CheckboxWidget
      expect(cloned.text).toBe('Hello')
      expect(cloned.font).toBe('16px Arial')
      expect(cloned.disabled).toBe(true)
    })

    it('should copy custom isChecked delegate', () => {
      const cb = new CheckboxWidget()
      cb.isChecked = () => true

      const cloned = cb.clone() as CheckboxWidget
      expect(cloned.isChecked()).toBe(true)
    })

    it('should copy onCheckboxChange callback', () => {
      const cb = new CheckboxWidget()
      const fn = vi.fn()
      cb.onCheckboxChange = fn

      const cloned = cb.clone() as CheckboxWidget
      cloned.toggle()
      expect(fn).toHaveBeenCalledWith(true)
    })
  })

  // ---------------------------------------------------------------------------
  // copyCheckboxFrom
  // ---------------------------------------------------------------------------

  describe('copyCheckboxFrom', () => {
    it('should copy value state', () => {
      const src = new CheckboxWidget()
      src.setValue(true)
      src.checkmark = 'src-mark'

      const dest = new CheckboxWidget()
      ;(dest as any).copyCheckboxFrom(src)
      expect(dest.getValue()).toBe(true)
      expect(dest.checkmark).toBe('src-mark')
    })
  })

  // ---------------------------------------------------------------------------
  // Disabled state interaction
  // ---------------------------------------------------------------------------

  describe('disabled state', () => {
    it('should not toggle via onClick when disabled', () => {
      const cb = new CheckboxWidget()
      cb.disabled = true
      // Click should not toggle
      cb.onClick()
      expect(cb.getValue()).toBe(false)
    })

    it('should not allow keyboard toggle when disabled via isDisabled override', () => {
      const cb = new CheckboxWidget()
      cb.isDisabled = () => true
      const event = makeKeyEvent(' ')
      cb.handleEvent(event)
      expect(cb.getValue()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Integration: value round-trip
  // ---------------------------------------------------------------------------

  describe('value round-trip', () => {
    it('should correctly round-trip external value', () => {
      const cb = new CheckboxWidget()

      // Use external storage
      let external = false
      cb.getValue = () => external
      cb.setValue = (v: boolean) => {
        external = v
      }
      cb.isChecked = () => external

      // Initially unchecked
      expect(cb.isChecked()).toBe(false)

      // Toggle to checked
      cb.toggle()
      expect(external).toBe(true)
      expect(cb.isChecked()).toBe(true)

      // Toggle back
      cb.toggle()
      expect(external).toBe(false)
      expect(cb.isChecked()).toBe(false)
    })
  })
})
