/**
 * LabelWithTooltipWidget.test.ts — LabelWithTooltipWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化
 * - TooltipTemplate / TooltipContainerId 属性
 * - GetTooltipText 委托
 * - TooltipContainer 延迟初始化
 * - setTooltipContainerResolver
 * - MouseEntered → 显示 tooltip
 * - MouseExited → 移除 tooltip (仅当容器已创建)
 * - LabelWidget 继承的属性（text, font, color 等）
 * - DOM 渲染（标准标签输出）
 * - Clone 复制构造函数
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LabelWithTooltipWidget } from './LabelWithTooltipWidget.js'
import type { ITooltipContainer } from './ButtonWidget.js'
import type { WidgetArgs } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Mock tooltip container
// ---------------------------------------------------------------------------

function createMockTooltipContainer(): ITooltipContainer & {
  _lastTemplate: string
  _lastArgs: WidgetArgs | null
  _removeCallCount: number
} {
  return {
    _lastTemplate: '',
    _lastArgs: null,
    _removeCallCount: 0,
    setTooltip(template: string, args: WidgetArgs): number {
      this._lastTemplate = template
      this._lastArgs = args
      return 1
    },
    removeTooltip(): void {
      this._removeCallCount++
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LabelWithTooltipWidget', () => {
  let widget: LabelWithTooltipWidget

  beforeEach(() => {
    widget = new LabelWithTooltipWidget()
    widget.bounds = { x: 0, y: 0, width: 200, height: 24 }
  })

  describe('default properties', () => {
    it('has default tooltipTemplate', () => {
      expect(widget.tooltipTemplate).toBe('LABEL_WITH_TOOLTIP')
    })

    it('has null tooltipContainerId by default', () => {
      expect(widget.tooltipContainerId).toBeNull()
    })

    it('has default getTooltipText returning empty string', () => {
      expect(widget.getTooltipText()).toBe('')
    })

    it('inherits LabelWidget properties', () => {
      widget.text = 'Test Label'
      expect(widget.getText()).toBe('Test Label')
    })
  })

  describe('tooltipContainer lazy initialization', () => {
    it('returns null when no resolver is set', () => {
      widget.tooltipContainerId = 'some-container'
      const container = widget.tooltipContainer
      expect(container).toBeNull()
    })

    it('isTooltipContainerCreated is false before access', () => {
      expect(widget.isTooltipContainerCreated).toBe(false)
    })

    it('isTooltipContainerCreated becomes true after first access', () => {
      widget.tooltipContainerId = 'some-container'
      // Access triggers creation
      widget.tooltipContainer
      expect(widget.isTooltipContainerCreated).toBe(true)
    })

    it('returns container from resolver', () => {
      const mockContainer = createMockTooltipContainer()
      widget.setTooltipContainerResolver(() => mockContainer)
      widget.tooltipContainerId = 'test-container'

      const container = widget.tooltipContainer
      expect(container).toBe(mockContainer)
    })

    it('caches container after first access', () => {
      let callCount = 0
      const mockContainer = createMockTooltipContainer()
      widget.setTooltipContainerResolver(() => {
        callCount++
        return mockContainer
      })
      widget.tooltipContainerId = 'test-container'

      widget.tooltipContainer
      widget.tooltipContainer // Second access

      expect(callCount).toBe(1) // Only called once
    })
  })

  describe('mouseEntered', () => {
    it('shows tooltip when containerId and resolver are set', () => {
      const mockContainer = createMockTooltipContainer()
      widget.tooltipContainerId = 'test-container'
      widget.setTooltipContainerResolver(() => mockContainer)
      widget.tooltipTemplate = 'test-template'
      widget.getTooltipText = () => 'Hello Tooltip'

      widget.mouseEntered()

      expect(mockContainer._lastTemplate).toBe('test-template')
      expect(mockContainer._lastArgs).not.toBeNull()
      expect(
        (mockContainer._lastArgs as any)?.getText,
      ).toBe(widget.getTooltipText)
    })

    it('does nothing when tooltipContainerId is null', () => {
      const mockContainer = createMockTooltipContainer()
      widget.setTooltipContainerResolver(() => mockContainer)

      widget.mouseEntered()

      expect(mockContainer._lastArgs).toBeNull()
    })

    it('does nothing when resolver returns null', () => {
      widget.tooltipContainerId = 'missing-container'
      widget.setTooltipContainerResolver(() => null)

      expect(() => widget.mouseEntered()).not.toThrow()
    })
  })

  describe('mouseExited', () => {
    it('removes tooltip only if container was created', () => {
      const mockContainer = createMockTooltipContainer()
      widget.tooltipContainerId = 'test-container'
      widget.setTooltipContainerResolver(() => mockContainer)

      // First, enter to create the container
      widget.mouseEntered()

      // Now exit
      widget.mouseExited()

      expect(mockContainer._removeCallCount).toBe(1)
    })

    it('does not call removeTooltip if container not yet created', () => {
      const mockContainer = createMockTooltipContainer()
      widget.tooltipContainerId = 'test-container'
      widget.setTooltipContainerResolver(() => mockContainer)

      // Exit before entering — container not created
      widget.mouseExited()

      expect(mockContainer._removeCallCount).toBe(0)
    })

    it('does nothing when containerId is null', () => {
      expect(() => widget.mouseExited()).not.toThrow()
    })
  })

  describe('DOM rendering', () => {
    it('renders text content (inherited from LabelWidget)', () => {
      widget.text = 'Tooltip Label'
      const el = widget.render()
      expect(el.textContent).toContain('Tooltip Label')
    })
  })

  describe('clone', () => {
    it('creates a copy with same properties', () => {
      widget.tooltipTemplate = 'custom-template'
      widget.tooltipContainerId = 'custom-container-id'
      widget.getTooltipText = () => 'custom tooltip'
      widget.text = 'My Label'

      const clone = widget.clone()

      expect(clone.tooltipTemplate).toBe('custom-template')
      expect(clone.tooltipContainerId).toBe('custom-container-id')
      expect(clone.getTooltipText()).toBe('custom tooltip')
      expect(clone.text).toBe('My Label')
    })

    it('clone is a LabelWithTooltipWidget instance', () => {
      const clone = widget.clone()
      expect(clone instanceof LabelWithTooltipWidget).toBe(true)
    })

    it('clone resets lazy container state', () => {
      widget.tooltipContainerId = 'test'
      widget.tooltipContainer // Create

      const clone = widget.clone()
      expect(clone.isTooltipContainerCreated).toBe(false)
    })
  })
})
