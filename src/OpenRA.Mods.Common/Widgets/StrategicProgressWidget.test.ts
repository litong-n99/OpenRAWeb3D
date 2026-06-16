/**
 * StrategicProgressWidget.test.ts — StrategicProgressWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性: font, textColor, contrastColor, 阈值
 * - 委托: getValue, getLabel
 * - 颜色选择: 基于阈值的高/中/低颜色
 * - DOM 渲染: 填充条、标签文本
 * - tick() 更新: 值变化、颜色更新、标签文本
 * - Clone: 复制构造函数
 * - 边界情况: 0%, 100%, 负值, 零尺寸边界
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { StrategicProgressWidget } from './StrategicProgressWidget.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StrategicProgressWidget', () => {
  let widget: StrategicProgressWidget

  beforeEach(() => {
    widget = new StrategicProgressWidget()
  })

  // ---- Construction & defaults ----

  describe('construction', () => {
    it('creates with default font', () => {
      expect(widget.font).toBe('bold 14px Arial')
    })

    it('creates with default text color white', () => {
      expect(widget.textColor).toBe('#ffffff')
    })

    it('creates with default contrast color black', () => {
      expect(widget.textContrastColor).toBe('#000000')
    })

    it('creates with default contrast radius 1', () => {
      expect(widget.contrastRadius).toBe(1)
    })

    it('creates with default high threshold 67', () => {
      expect(widget.highThreshold).toBe(67)
    })

    it('creates with default medium threshold 33', () => {
      expect(widget.mediumThreshold).toBe(33)
    })

    it('default getValue returns 0', () => {
      expect(widget.getValue()).toBe(0)
    })

    it('default getLabel returns empty string', () => {
      expect(widget.getLabel()).toBe('')
    })

    it('default is visible', () => {
      expect(widget.visible).toBe(true)
      expect(widget.isVisible()).toBe(true)
    })

    it('default colors are green-high, yellow-medium, red-low', () => {
      expect(widget.colorHigh).toEqual({ r: 76, g: 175, b: 80, a: 255 })
      expect(widget.colorMedium).toEqual({ r: 255, g: 193, b: 7, a: 255 })
      expect(widget.colorLow).toEqual({ r: 244, g: 67, b: 54, a: 255 })
    })
  })

  // ---- Delegates ----

  describe('delegates', () => {
    it('getValue returns custom value when set', () => {
      widget.getValue = () => 85
      expect(widget.getValue()).toBe(85)
    })

    it('getLabel returns custom label when set', () => {
      widget.getLabel = () => 'Strategic Victory in 2:30'
      expect(widget.getLabel()).toBe('Strategic Victory in 2:30')
    })
  })

  // ---- Color selection by threshold ----

  describe('color selection', () => {
    it('shows high color (green) when value >= highThreshold', () => {
      widget.getValue = () => 75
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('76, 175, 80')
    })

    it('shows medium color (yellow) when mediumThreshold <= value < highThreshold', () => {
      widget.getValue = () => 50
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('255, 193, 7')
    })

    it('shows low color (red) when value < mediumThreshold', () => {
      widget.getValue = () => 10
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('244, 67, 54')
    })

    it('uses exact boundary: 67 shows high', () => {
      widget.getValue = () => 67
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('76, 175, 80') // green
    })

    it('uses exact boundary: 33 shows medium', () => {
      widget.getValue = () => 33
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('255, 193, 7') // yellow
    })

    it('uses exact boundary: 32 shows low', () => {
      widget.getValue = () => 32
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('244, 67, 54') // red
    })

    it('respects custom thresholds', () => {
      widget.highThreshold = 80
      widget.mediumThreshold = 40
      widget.getValue = () => 50
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      // 50 < 80 and 50 >= 40 → medium (yellow)
      expect(fillEl.style.background).toContain('255, 193, 7')
    })

    it('respects custom colors', () => {
      widget.colorLow = { r: 128, g: 128, b: 128, a: 255 }
      widget.getValue = () => 10
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.strategic-progress-fill') as HTMLElement
      expect(fillEl.style.background).toContain('128, 128, 128')
    })
  })

  // ---- DOM rendering ----

  describe('render', () => {
    it('creates a div with strategic-progress-widget class', () => {
      const el = widget.render()
      expect(el.tagName).toBe('DIV')
      expect(el.className).toContain('strategic-progress-widget')
      expect(el.style.position).toBe('absolute')
    })

    it('creates fill and label child elements', () => {
      const el = widget.render()
      const fillEl = el.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      const labelEl = el.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement

      expect(fillEl).not.toBeNull()
      expect(labelEl).not.toBeNull()
    })

    it('returns same element on second render', () => {
      const el1 = widget.render()
      const el2 = widget.render()
      expect(el1).toBe(el2)
    })

    it('sets data-widget-id when id is set', () => {
      widget.id = 'strat-progress-1'
      const el = widget.render()
      expect(el.getAttribute('data-widget-id')).toBe('strat-progress-1')
    })

    it('label element has pointer-events none', () => {
      const el = widget.render()
      const labelEl = el.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement
      expect(labelEl.style.pointerEvents).toBe('none')
    })
  })

  // ---- Tick & value updates ----

  describe('tick updates', () => {
    it('fill width changes with value', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.getValue = () => 25
      widget.render()
      widget.tick()

      const el1 = widget.render()
      const fillEl1 = el1.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      const width25 = fillEl1.style.width // 25% of 200 = 50px

      widget.getValue = () => 75
      widget.tick()

      const el2 = widget.render()
      const fillEl2 = el2.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      const width75 = fillEl2.style.width // 75% of 200 = 150px

      expect(width25).toBe('50px')
      expect(width75).toBe('150px')
      expect(width75).not.toBe(width25)
    })

    it('fill width is integer pixels (no sub-pixel)', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }
      widget.getValue = () => 33.3

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      // 33.3% of 200 = 66.6 → Math.round = 67px
      expect(fillEl.style.width).toBe('67px')
    })

    it('label text updates from getLabel delegate', () => {
      widget.getLabel = () => 'Victory in 5:00'
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const labelEl = el.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement
      expect(labelEl.textContent).toBe('Victory in 5:00')

      widget.getLabel = () => 'Defeat in 3:00'
      widget.tick()

      expect(labelEl.textContent).toBe('Defeat in 3:00')
    })

    it('label has text-shadow for contrast effect', () => {
      widget.getLabel = () => 'Test'
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const labelEl = el.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement
      expect(labelEl.style.textShadow).toContain('#000000')
    })

    it('tick does not update when not visible', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }
      widget.getValue = () => 50
      widget.getLabel = () => 'Half'

      widget.render()
      widget.tick()

      // Verify initial state
      const el1 = widget.render()
      const labelEl1 = el1.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement
      const fillEl1 = el1.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      expect(labelEl1.textContent).toBe('Half')
      expect(fillEl1.style.width).toBe('100px')

      widget.visible = false
      widget.isVisible = () => false
      widget.getValue = () => 100
      widget.getLabel = () => 'Full'
      widget.tick()

      // 值未变更（因为 tick 跳过，render 会重新计算所以直接检查元素）
      expect(labelEl1.textContent).toBe('Half')
      expect(fillEl1.style.width).toBe('100px')
    })
  })

  // ---- Boundary cases ----

  describe('boundary cases', () => {
    it('clamps value to 0 minimum', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }
      widget.getValue = () => -50

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      expect(fillEl.style.width).toBe('0px')
    })

    it('clamps value to 100 maximum', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }
      widget.getValue = () => 150

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      expect(fillEl.style.width).toBe('200px')
    })

    it('handles zero bounds', () => {
      widget.bounds = { x: 0, y: 0, width: 0, height: 0 }
      expect(() => {
        widget.render()
        widget.tick()
      }).not.toThrow()
    })

    it('tick without render does not throw', () => {
      expect(() => widget.tick()).not.toThrow()
    })

    it('handles exact 0%', () => {
      widget.bounds = { x: 0, y: 0, width: 100, height: 20 }
      widget.getValue = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      expect(fillEl.style.width).toBe('0px')
    })

    it('handles exact 100%', () => {
      widget.bounds = { x: 0, y: 0, width: 100, height: 20 }
      widget.getValue = () => 100

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector(
        '.strategic-progress-fill',
      ) as HTMLElement
      expect(fillEl.style.width).toBe('100px')
    })
  })

  // ---- Contrast color ----

  describe('custom contrast', () => {
    it('uses custom contrastRadius', () => {
      widget.contrastRadius = 2
      widget.getLabel = () => 'Test'
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const labelEl = el.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement
      expect(labelEl.style.textShadow).toContain('2px')
    })

    it('uses custom textContrastColor', () => {
      widget.textContrastColor = '#ff0000'
      widget.getLabel = () => 'Test'
      widget.bounds = { x: 0, y: 0, width: 200, height: 30 }

      widget.render()
      widget.tick()

      const el = widget.render()
      const labelEl = el.querySelector(
        '.strategic-progress-label',
      ) as HTMLElement
      expect(labelEl.style.textShadow).toContain('#ff0000')
    })
  })

  // ---- Clone ----

  describe('clone', () => {
    it('creates a copy with same properties', () => {
      widget.font = 'bold 16px Arial'
      widget.textColor = '#eeeeee'
      widget.textContrastColor = '#111111'
      widget.contrastRadius = 2
      widget.highThreshold = 80
      widget.mediumThreshold = 40
      widget.getValue = () => 75
      widget.getLabel = () => 'Clone test'

      const clone = widget.clone()

      expect(clone.font).toBe('bold 16px Arial')
      expect(clone.textColor).toBe('#eeeeee')
      expect(clone.textContrastColor).toBe('#111111')
      expect(clone.contrastRadius).toBe(2)
      expect(clone.highThreshold).toBe(80)
      expect(clone.mediumThreshold).toBe(40)
      expect(clone.getValue()).toBe(75)
      expect(clone.getLabel()).toBe('Clone test')
    })

    it('clone is a new instance', () => {
      const clone = widget.clone()
      expect(clone).not.toBe(widget)
    })

    it('clone colors are independent copies', () => {
      widget.colorLow = { r: 100, g: 100, b: 100, a: 255 }
      const clone = widget.clone()

      // 修改原 widget 的颜色不影响克隆
      widget.colorLow.r = 200
      expect(clone.colorLow.r).toBe(100)
    })

    it('clone delegate is same function reference', () => {
      const fn = () => 99
      widget.getValue = fn
      const clone = widget.clone()
      expect(clone.getValue).toBe(fn)
    })
  })

  // ---- Dispose ----

  describe('dispose', () => {
    it('cleans up element references', () => {
      widget.render()
      widget.dispose()

      expect(() => widget.dispose()).not.toThrow()
    })

    it('can call dispose without render', () => {
      expect(() => widget.dispose()).not.toThrow()
    })
  })
})
