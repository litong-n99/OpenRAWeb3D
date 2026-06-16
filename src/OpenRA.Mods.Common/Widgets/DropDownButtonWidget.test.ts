/**
 * DropDownButtonWidget.test.ts — DropDownButtonWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化
 * - 键盘事件处理（Escape 关闭面板）
 * - 焦点管理（yieldKeyboardFocus 关闭面板）
 * - 面板管理（attachPanel, removePanel, isOpen）
 * - 生命周期（hidden, removed 关闭面板）
 * - UsableWidth 计算
 * - DOM 渲染（data-is-open 属性，箭头指示器）
 * - Clone 复制构造函数
 * - ShowDropDown (基本路径)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DropDownButtonWidget } from './DropDownButtonWidget.js'
import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import { TextAlign } from './TextAlign.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyEvent(
  key: string,
  overrides: Partial<WidgetEvent> = {},
): WidgetEvent {
  const stopped = { value: false }
  return {
    type: 'keydown',
    stopPropagation(): void {
      stopped.value = true
    },
    target: null,
    clientX: 0,
    clientY: 0,
    key,
    ...overrides,
    _stopped: stopped,
  } as WidgetEvent & { _stopped: { value: boolean } }
}

/** 简单的模拟面板 widget（用于面板附加测试）。 */
class MockPanelWidget extends Widget {
  override render(): HTMLElement {
    return this.getOrCreateElement('div', 'mock-panel')
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DropDownButtonWidget', () => {
  let widget: DropDownButtonWidget

  beforeEach(() => {
    widget = new DropDownButtonWidget()
    widget.bounds = { x: 100, y: 200, width: 160, height: 40 }
  })

  describe('default properties', () => {
    it('initializes with default values', () => {
      expect(widget.decorations).toBe('dropdown-decorations')
      expect(widget.decorationMarker).toBe('marker')
      expect(widget.separators).toBe('dropdown-separators')
      expect(widget.separatorImage).toBe('separator')
      expect(widget.panelAlign).toBe(TextAlign.Left)
      expect(widget.panelRoot).toBeNull()
      expect(widget.isOpen).toBe(false)
    })

    it('has text property inherited from ButtonWidget', () => {
      widget.text = 'Dropdown'
      expect(widget.getText()).toBe('Dropdown')
    })
  })

  describe('isOpen state', () => {
    it('returns false when no panel attached', () => {
      expect(widget.isOpen).toBe(false)
    })

    it('returns true when panel is attached', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)
      expect(widget.isOpen).toBe(true)
    })

    it('returns false after panel is removed', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)
      widget.removePanel()
      expect(widget.isOpen).toBe(false)
    })
  })

  describe('keyboard handling', () => {
    it('closes panel on Escape key press when focused', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      // Simulate keyboard focus
      widget.takeKeyboardFocus()

      const escEvent = makeKeyEvent('Escape')
      const result = widget.handleEvent(escEvent)
      expect(result).toBe(true)
      expect(widget.isOpen).toBe(false)
    })

    it('does not close panel on non-Escape key', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      widget.takeKeyboardFocus()

      const aEvent = makeKeyEvent('a')
      widget.handleEvent(aEvent)
      // handleEvent falls through to super.handleEvent which may return false
      // but isOpen should remain true
      expect(widget.isOpen).toBe(true)
    })
  })

  describe('yieldKeyboardFocus', () => {
    it('removes panel when yielding keyboard focus', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      widget.yieldKeyboardFocus()
      expect(widget.isOpen).toBe(false)
    })
  })

  describe('panel management', () => {
    it('throws when attaching panel to an already open dropdown', () => {
      const panel1 = new MockPanelWidget()
      panel1.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel1)

      const panel2 = new MockPanelWidget()
      panel2.bounds = { x: 0, y: 0, width: 160, height: 120 }

      expect(() => widget.attachPanel(panel2)).toThrow(
        'Attempted to attach a panel to an open dropdown',
      )
    })

    it('positions panel below button by default', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 100, height: 60 }
      widget.attachPanel(panel)

      // Panel should be below the button
      expect(panel.bounds.y).toBeGreaterThanOrEqual(widget.bounds.y + widget.bounds.height)
    })

    it('takes keyboard focus when attaching panel', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      expect(widget.hasKeyboardFocus).toBe(true)
    })

    it('yields keyboard focus when removing panel', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      widget.removePanel()
      expect(widget.hasKeyboardFocus).toBe(false)
    })

    it('calls onCancel when removing panel', () => {
      let cancelCalled = false
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel, () => {
        cancelCalled = true
      })

      widget.removePanel()
      expect(cancelCalled).toBe(true)
    })

    it('removePanel is safe to call when no panel is open', () => {
      expect(() => widget.removePanel()).not.toThrow()
    })
  })

  describe('lifecycle', () => {
    it('removes panel on hidden', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      widget.hidden()
      expect(widget.isOpen).toBe(false)
    })

    it('removes panel on removed', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      widget.removed()
      expect(widget.isOpen).toBe(false)
    })
  })

  describe('usableWidth', () => {
    it('returns bounds.width minus bounds.height (space for arrow)', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 40 }
      expect(widget.usableWidth).toBe(160)
    })

    it('returns 0 when width equals height', () => {
      widget.bounds = { x: 0, y: 0, width: 40, height: 40 }
      expect(widget.usableWidth).toBe(0)
    })
  })

  describe('panelAlign', () => {
    it('supports Left alignment (default)', () => {
      expect(widget.panelAlign).toBe(TextAlign.Left)
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 100, height: 60 }
      widget.attachPanel(panel)
      // Panel x should be at button left edge
      expect(panel.bounds.x).toBe(widget.bounds.x)
    })

    it('supports Right alignment', () => {
      widget.panelAlign = TextAlign.Right
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 100, height: 60 }
      widget.attachPanel(panel)
      // Panel x should be at button right edge - panel width
      expect(panel.bounds.x).toBe(widget.bounds.x + widget.bounds.width - panel.bounds.width)
    })

    it('supports Center alignment', () => {
      widget.panelAlign = TextAlign.Center
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 100, height: 60 }
      widget.attachPanel(panel)
      // Panel x should be centered
      expect(panel.bounds.x).toBe(
        widget.bounds.x + (widget.bounds.width - panel.bounds.width) / 2,
      )
    })
  })

  describe('DOM rendering', () => {
    it('renders with data-is-open attribute when panel is open', () => {
      const el = widget.render()
      expect(el.getAttribute('data-is-open')).toBeNull()

      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 160, height: 120 }
      widget.attachPanel(panel)

      const el2 = widget.render()
      expect(el2.getAttribute('data-is-open')).toBe('true')
    })

    it('renders dropdown arrow indicator', () => {
      const el = widget.render()
      const arrow = el.querySelector('[data-dropdown-arrow]')
      expect(arrow).not.toBeNull()
      expect(arrow!.textContent).toBe('▼')
    })
  })

  describe('clone', () => {
    it('creates a copy with same properties', () => {
      widget.decorations = 'custom-decorations'
      widget.decorationMarker = 'custom-marker'
      widget.panelRoot = 'custom-root'
      widget.panelAlign = TextAlign.Center
      widget.text = 'Test'

      const clone = widget.clone()

      expect(clone.decorations).toBe('custom-decorations')
      expect(clone.decorationMarker).toBe('custom-marker')
      expect(clone.panelRoot).toBe('custom-root')
      expect(clone.panelAlign).toBe(TextAlign.Center)
      expect(clone.text).toBe('Test')
      expect(clone.isOpen).toBe(false)
    })

    it('clone does not copy panel state', () => {
      const panel = new MockPanelWidget()
      panel.bounds = { x: 0, y: 0, width: 100, height: 60 }
      widget.attachPanel(panel)

      const clone = widget.clone()
      expect(clone.isOpen).toBe(false)
    })
  })

  describe('showDropDown', () => {
    it('sets isOpen to true after showing dropdown', () => {
      const options = ['Item 1', 'Item 2', 'Item 3']
      widget.showDropDown('dropdown-template', 100, options, (option, _template) => {
        return { itemEl: null, option }
      })
      expect(widget.isOpen).toBe(true)
    })

    it('creates items for each option', () => {
      const options = ['A', 'B', 'C']
      let setupCount = 0
      widget.showDropDown('dropdown-template', 200, options, (option, _template) => {
        setupCount++
        return { item: option }
      })
      expect(setupCount).toBe(3)
    })
  })
})
