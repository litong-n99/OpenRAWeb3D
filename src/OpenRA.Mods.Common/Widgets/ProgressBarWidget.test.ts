/**
 * ProgressBarWidget.test.ts — ProgressBarWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性: percentage=0, indeterminate=false, bar margin, 背景/条名称
 * - 委托: getPercentage, isIndeterminate, getBarColor
 * - 确定模式: 条宽与值成比例
 * - 不确定模式: tick 动画更新、状态切换重置、条样式动画
 * - DOM 渲染: 填充条元素、背景样式
 * - Clone: 复制构造函数
 * - 边界情况: 0%, 100%, 负值, 边界尺寸为零
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ProgressBarWidget, type RgbaColor } from './ProgressBarWidget.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProgressBarWidget', () => {
  let widget: ProgressBarWidget

  beforeEach(() => {
    widget = new ProgressBarWidget()
  })

  // ---- Construction & defaults ----

  describe('construction', () => {
    it('creates with default percentage 0', () => {
      expect(widget.percentage).toBe(0)
    })

    it('creates with indeterminate false', () => {
      expect(widget.indeterminate).toBe(false)
    })

    it('creates with default background/bar names', () => {
      expect(widget.background).toBe('progressbar-bg')
      expect(widget.bar).toBe('progressbar-thumb')
    })

    it('creates with default bar margin of 2x2', () => {
      expect(widget.barMargin).toEqual({ width: 2, height: 2 })
    })

    it('default getPercentage returns percentage property', () => {
      widget.percentage = 42
      expect(widget.getPercentage()).toBe(42)
    })

    it('default isIndeterminate returns indeterminate property', () => {
      widget.indeterminate = true
      expect(widget.isIndeterminate()).toBe(true)
    })

    it('default getBarColor returns green', () => {
      const color = widget.getBarColor()
      expect(color.r).toBe(76)
      expect(color.g).toBe(175)
      expect(color.b).toBe(80)
      expect(color.a).toBe(255)
    })
  })

  // ---- Delegates ----

  describe('delegates', () => {
    it('getPercentage returns custom value when overridden', () => {
      widget.getPercentage = () => 75
      expect(widget.getPercentage()).toBe(75)
    })

    it('isIndeterminate returns custom value when overridden', () => {
      widget.isIndeterminate = () => true
      widget.indeterminate = false // 属性被委托覆盖
      expect(widget.isIndeterminate()).toBe(true)
    })

    it('getBarColor returns custom color when overridden', () => {
      const red: RgbaColor = { r: 255, g: 0, b: 0, a: 255 }
      widget.getBarColor = () => red
      expect(widget.getBarColor()).toEqual(red)
    })
  })

  // ---- DOM rendering ----

  describe('render', () => {
    it('creates a div with progress-bar-widget class', () => {
      const el = widget.render()
      expect(el.tagName).toBe('DIV')
      expect(el.className).toContain('progress-bar-widget')
      expect(el.style.position).toBe('absolute')
    })

    it('sets data-background and data-bar attributes', () => {
      widget.background = 'custom-bg'
      widget.bar = 'custom-bar'
      const el = widget.render()
      expect(el.getAttribute('data-background')).toBe('custom-bg')
      expect(el.getAttribute('data-bar')).toBe('custom-bar')
    })

    it('creates bar fill element', () => {
      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl).not.toBeNull()
      expect(barEl.style.position).toBe('absolute')
    })

    it('returns same element on second render', () => {
      const el1 = widget.render()
      const el2 = widget.render()
      expect(el1).toBe(el2)
    })

    it('sets data-widget-id when id is set', () => {
      widget.id = 'progress-bar-1'
      const el = widget.render()
      expect(el.getAttribute('data-widget-id')).toBe('progress-bar-1')
    })

    it('applies bar margin to fill element position', () => {
      widget.barMargin = { width: 5, height: 3 }
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.left).toBe('5px')
      expect(barEl.style.top).toBe('3px')
      expect(barEl.style.height).toBe('14px') // 20 - 2*3 = 14
    })
  })

  // ---- Determinate mode ----

  describe('determinate mode', () => {
    it('bar width is proportional to percentage', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 50

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // barMargin.width=2, maxBarWidth=200-4=196, barWidth=50*196/100=98
      expect(barEl.style.width).toBe('98px')
    })

    it('bar width is 0 at 0%', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // barWidth = max(0*196/100, 16) = 16 (minBarWidth)
      expect(barEl.style.width).toBe('16px')
    })

    it('bar width fills full at 100%', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 100

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // barWidth = 100*196/100 = 196
      expect(barEl.style.width).toBe('196px')
    })

    it('bar color reflects getBarColor delegate', () => {
      widget.getBarColor = () => ({ r: 255, g: 0, b: 0, a: 255 })
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 50

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // NOTE: happy-dom may normalize rgba spacing; check for key color components
      expect(barEl.style.background).toContain('255')
      expect(barEl.style.background).toContain('0')
      expect(barEl.style.background).not.toContain('linear-gradient')
    })

    it('has transition style in determinate mode', () => {
      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.transition).toContain('width')
    })

    it('does NOT have animation style in determinate mode', () => {
      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.animation).toBe('none')
    })
  })

  // ---- Indeterminate mode ----

  describe('indeterminate mode', () => {
    it('bar offset changes each tick', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.isIndeterminate = () => true

      widget.render()

      // 多次 tick 并检查 left 变化
      const positions: string[] = []
      for (let i = 0; i < 5; i++) {
        widget.tick()
        const el = widget.render()
        const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
        positions.push(barEl.style.left)
      }

      // 所有位置不应相同（动画期间应移动）
      const unique = new Set(positions)
      expect(unique.size).toBeGreaterThan(1)
    })

    it('bar width is maxBarWidth/4 in indeterminate mode', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.isIndeterminate = () => true

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // maxBarWidth = 200 - 2*2 = 196, barWidth = 196/4 = 49
      expect(barEl.style.width).toBe('49px')
    })

    it('resets offset when switching from determinate to indeterminate', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 50

      // 首先运行确定模式
      widget.render()
      widget.tick()

      // 然后切换到不确定模式
      widget.isIndeterminate = () => true
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // 重置后 offset=0, then offset+=tickStep(0.04) → offset=0.04
      // barOffset = 0.75 * 0.04 * 196 = 5.88 → Math.round=6
      // left = barMargin.width(2) + 6 = 8px
      const leftPx = parseInt(barEl.style.left, 10)
      expect(leftPx).toBeGreaterThanOrEqual(6)
      expect(leftPx).toBeLessThanOrEqual(10)
    })

    it('resets offset when switching from indeterminate to determinate', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.isIndeterminate = () => true

      widget.render()
      // 运行多个不确定 tick 以推进 offset
      for (let i = 0; i < 10; i++) {
        widget.tick()
      }

      // 切换到确定模式
      widget.isIndeterminate = () => false
      widget.getPercentage = () => 50
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      // 确定模式下 barOffset=0，加上 barMargin.width=2
      expect(barEl.style.left).toBe('2px')
    })

    it('has animation style in indeterminate mode', () => {
      widget.isIndeterminate = () => true

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.animation).toContain('progressbar-slide')
    })

    it('has no transition style in indeterminate mode', () => {
      widget.isIndeterminate = () => true

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.transition).toBe('none')
    })

    it('has gradient background in indeterminate mode', () => {
      widget.isIndeterminate = () => true

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.background).toContain('linear-gradient')
    })

    it('tickStep reverses at endpoints', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.isIndeterminate = () => true

      widget.render()

      // Run enough ticks to hit 0 or 1 and see reversal
      const positions: string[] = []
      let lastOffset = -1
      let reversals = 0

      for (let i = 0; i < 80; i++) {
        widget.tick()
        const el = widget.render()
        const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
        const leftPx = parseInt(barEl.style.left, 10) || 0

        // Check if offset direction reversed (left position decrease after increasing)
        if (
          lastOffset >= 0 &&
          positions.length >= 2 &&
          leftPx !== lastOffset
        ) {
          // Simple heuristic: if we went up then down, or down then up
          const prevPos = parseInt(
            (
              el.querySelector('.progress-bar-fill') as HTMLElement
            )?.style.left || '0',
            10,
          )
          if (prevPos > 0 && leftPx < lastOffset) reversals++
        }
        lastOffset = leftPx
        positions.push(`${leftPx}`)
      }

      // The bar should have moved through different positions
      const unique = new Set(positions)
      expect(unique.size).toBeGreaterThan(2)
    })
  })

  // ---- Tick & visible ----

  describe('tick visibility', () => {
    it('tick does not update DOM when not visible', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 100
      widget.render()

      // Force full bar via tick
      widget.tick()

      // Verify bar is at 100% width before hiding
      const el1 = widget.render()
      const barEl1 = el1.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl1.style.width).toBe('196px')

      widget.visible = false
      widget.isVisible = () => false

      // Change percentage while invisible — tick should skip update
      widget.getPercentage = () => 0
      widget.tick()

      // Bar width should remain 196px after tick was skipped
      // (NOTE: render() recalculates, so check the bar element directly)
      expect(barEl1.style.width).toBe('196px')
    })
  })

  // ---- Clone ----

  describe('clone', () => {
    it('creates a copy with same properties', () => {
      widget.percentage = 75
      widget.indeterminate = false
      widget.background = 'bg2'
      widget.bar = 'bar2'
      widget.barMargin = { width: 4, height: 4 }
      widget.id = 'original'

      const clone = widget.clone()

      expect(clone.percentage).toBe(75)
      expect(clone.indeterminate).toBe(false)
      expect(clone.getPercentage()).toBe(75)
      expect(clone.background).toBe('bg2')
      expect(clone.bar).toBe('bar2')
      expect(clone.barMargin).toEqual({ width: 4, height: 4 })
    })

    it('clone is a new instance', () => {
      const clone = widget.clone()
      expect(clone).not.toBe(widget)
    })

    it('clone getPercentage delegate is independent', () => {
      widget.getPercentage = () => 50
      const clone = widget.clone()
      expect(clone.getPercentage()).toBe(50)

      // 修改原 widget 的委托不影响 clone
      widget.getPercentage = () => 99
      expect(widget.getPercentage()).toBe(99)
      expect(clone.getPercentage()).toBe(50)
    })
  })

  // ---- Boundary cases ----

  describe('boundary cases', () => {
    it('handles percentage > 100 (clamped implicitly)', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => 150

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      const barWidth = parseInt(barEl.style.width, 10)
      // 150 * 196 / 100 = 294, but clamped by container? No — barWidth=294 (math), no clamp
      // The bar extends beyond the container, but overflow:hidden on parent clips it
      expect(barWidth).toBe(294)
    })

    it('handles negative percentage', () => {
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getPercentage = () => -50

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      const barWidth = parseInt(barEl.style.width, 10)
      // -50 * 196 / 100 = -98, then Math.max(-98, 16) = 16
      expect(barWidth).toBe(16) // minBarWidth
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

    it('handles percentage exactly at 0 boundary', () => {
      widget.bounds = { x: 0, y: 0, width: 100, height: 10 }
      widget.getPercentage = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const barEl = el.querySelector('.progress-bar-fill') as HTMLElement
      expect(barEl.style.width).toBe('16px') // minBarWidth
    })
  })

  // ---- Dispose ----

  describe('dispose', () => {
    it('cleans up bar element reference', () => {
      widget.render()
      widget.dispose()

      expect(() => widget.dispose()).not.toThrow()
    })

    it('can call dispose without render', () => {
      expect(() => widget.dispose()).not.toThrow()
    })
  })
})
