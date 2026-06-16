/**
 * ResourceBarWidget.test.ts — ResourceBarWidget + EWMA 单元测试
 *
 * 测试覆盖:
 * - EWMA: 构造、首次样本、平滑更新、重置
 * - ResourceBarWidget: 默认属性、方向设置、委托绑定
 * - DOM 渲染: 填充条和指示器元素创建
 * - tick() 更新: 垂直/水平布局位置计算
 * - 工具提示: 延迟初始化和 mouseEntered/mouseExited
 * - 边界情况: 零值、极大值、零尺寸边界
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ResourceBarWidget,
  EWMA,
  ResourceBarOrientation,
  type RgbaColor,
} from './ResourceBarWidget.js'

// ---------------------------------------------------------------------------
// EWMA Tests
// ---------------------------------------------------------------------------

describe('EWMA', () => {
  it('constructs with default alpha of 0.3', () => {
    const ewma = new EWMA()
    expect(ewma.alpha).toBe(0.3)
  })

  it('constructs with custom alpha', () => {
    const ewma = new EWMA(0.5)
    expect(ewma.alpha).toBe(0.5)
  })

  it('returns 0 as initial value before any updates', () => {
    const ewma = new EWMA()
    expect(ewma.value).toBe(0)
  })

  it('first update sets value directly to sample (no smoothing)', () => {
    const ewma = new EWMA(0.3)
    const result = ewma.update(100)
    expect(result).toBe(100)
    expect(ewma.value).toBe(100)
  })

  it('second update applies smoothing: α*sample + (1-α)*oldValue', () => {
    const ewma = new EWMA(0.3)
    ewma.update(100) // 第一次：直接设为 100
    const result = ewma.update(50) // 第二次：0.3*50 + 0.7*100 = 15 + 70 = 85
    expect(result).toBeCloseTo(85, 1)
    expect(ewma.value).toBeCloseTo(85, 1)
  })

  it('converges toward sample with repeated updates', () => {
    const ewma = new EWMA(0.3)
    ewma.update(0)
    for (let i = 0; i < 20; i++) {
      ewma.update(100)
    }
    // 经过 20 次更新后，值应接近 100
    expect(ewma.value).toBeGreaterThan(95)
    expect(ewma.value).toBeLessThanOrEqual(100)
  })

  it('reset clears value and hasValue state', () => {
    const ewma = new EWMA(0.3)
    ewma.update(50)
    ewma.update(75)

    ewma.reset()

    expect(ewma.value).toBe(0)
    // 重置后第一次 update 又直接设置样本值
    expect(ewma.update(30)).toBe(30)
  })

  it('with alpha=1, update follows sample exactly', () => {
    const ewma = new EWMA(1.0)
    ewma.update(100)
    expect(ewma.update(50)).toBe(50) // 1.0*50 + 0*100 = 50
    expect(ewma.update(75)).toBe(75) // 1.0*75 + 0*50 = 75
  })

  it('with alpha close to 0, changes very slowly', () => {
    const ewma = new EWMA(0.01)
    ewma.update(0)
    const result = ewma.update(100)
    // 0.01*100 + 0.99*0 = 1
    expect(result).toBeCloseTo(1, 0)
  })

  it('handles negative samples', () => {
    const ewma = new EWMA(0.3)
    ewma.update(0)
    const result = ewma.update(-10)
    expect(result).toBeCloseTo(-3, 1)
  })
})

// ---------------------------------------------------------------------------
// ResourceBarWidget Tests
// ---------------------------------------------------------------------------

describe('ResourceBarWidget', () => {
  let widget: ResourceBarWidget

  beforeEach(() => {
    widget = new ResourceBarWidget()
  })

  // ---- Construction & defaults ----

  describe('construction', () => {
    it('creates with default orientation Vertical', () => {
      expect(widget.orientation).toBe(ResourceBarOrientation.Vertical)
    })

    it('creates with default indicator collection/image names', () => {
      expect(widget.indicatorCollection).toBe('sidebar-bits')
      expect(widget.indicatorImage).toBe('indicator')
    })

    it('creates with default indicator size', () => {
      expect(widget.indicatorSize).toEqual({ x: 8, y: 8 })
    })

    it('creates with default tooltip template', () => {
      expect(widget.tooltipTemplate).toBe('RESOURCE_BAR_TOOLTIP')
    })

    it('default delegates return 0 for provided/used and white for color', () => {
      expect(widget.getProvided()).toBe(0)
      expect(widget.getUsed()).toBe(0)
      const color = widget.getBarColor()
      expect(color.r).toBe(255)
      expect(color.g).toBe(255)
      expect(color.b).toBe(255)
      expect(color.a).toBe(255)
    })

    it('has null tooltipContainerId by default', () => {
      expect(widget.tooltipContainerId).toBeNull()
    })

    it('tooltipContainer returns null initially', () => {
      expect(widget.tooltipContainer).toBeNull()
    })
  })

  // ---- Delegates ----

  describe('delegates', () => {
    it('getProvided returns custom value when set', () => {
      widget.getProvided = () => 500
      expect(widget.getProvided()).toBe(500)
    })

    it('getUsed returns custom value when set', () => {
      widget.getUsed = () => 300
      expect(widget.getUsed()).toBe(300)
    })

    it('getBarColor returns custom color when set', () => {
      const customColor: RgbaColor = { r: 255, g: 0, b: 0, a: 255 }
      widget.getBarColor = () => customColor
      expect(widget.getBarColor()).toEqual(customColor)
    })
  })

  // ---- Tooltip container ----

  describe('tooltipContainer', () => {
    it('returns null when resolver not set', () => {
      expect(widget.tooltipContainer).toBeNull()
    })

    it('returns value from resolver after first access', () => {
      const mockContainer = {
        setTooltip: vi.fn(),
        removeTooltip: vi.fn(),
      }
      widget.setTooltipContainerResolver(() => mockContainer)

      const container = widget.tooltipContainer
      expect(container).toBe(mockContainer)
    })

    it('caches resolver result (only calls resolver once)', () => {
      const resolver = vi.fn().mockReturnValue({
        setTooltip: vi.fn(),
        removeTooltip: vi.fn(),
      })
      widget.setTooltipContainerResolver(resolver)

      widget.tooltipContainer // 第一次
      widget.tooltipContainer // 第二次
      widget.tooltipContainer // 第三次

      expect(resolver).toHaveBeenCalledTimes(1)
    })

    it('mouseEntered sets tooltip when container available', () => {
      const mockContainer = {
        setTooltip: vi.fn(),
        removeTooltip: vi.fn(),
      }
      widget.tooltipContainerId = 'test-container'
      widget.setTooltipContainerResolver(() => mockContainer)

      widget.mouseEntered()

      expect(mockContainer.setTooltip).toHaveBeenCalled()
      expect(mockContainer.setTooltip).toHaveBeenCalledWith(
        'RESOURCE_BAR_TOOLTIP',
        expect.objectContaining({
          getText: expect.any(Function),
        }),
      )
    })

    it('mouseEntered does nothing when tooltipContainerId is null', () => {
      const mockContainer = {
        setTooltip: vi.fn(),
        removeTooltip: vi.fn(),
      }
      widget.setTooltipContainerResolver(() => mockContainer)

      widget.mouseEntered()

      expect(mockContainer.setTooltip).not.toHaveBeenCalled()
    })

    it('mouseExited removes tooltip when container exists', () => {
      const mockContainer = {
        setTooltip: vi.fn(),
        removeTooltip: vi.fn(),
      }
      widget.tooltipContainerId = 'test-container'
      widget.setTooltipContainerResolver(() => mockContainer)

      // 触发容器创建
      widget.mouseEntered()
      widget.mouseExited()

      expect(mockContainer.removeTooltip).toHaveBeenCalled()
    })

    it('mouseExited does nothing when container not created', () => {
      const mockContainer = {
        setTooltip: vi.fn(),
        removeTooltip: vi.fn(),
      }
      widget.tooltipContainerId = 'test-container'
      // 不访问 widget.tooltipContainer 以避免触发创建

      widget.mouseExited()

      expect(mockContainer.removeTooltip).not.toHaveBeenCalled()
    })
  })

  // ---- DOM rendering ----

  describe('render', () => {
    it('creates a div element with resource-bar-widget class', () => {
      const el = widget.render()
      expect(el.tagName).toBe('DIV')
      expect(el.className).toContain('resource-bar-widget')
      expect(el.style.position).toBe('absolute')
    })

    it('creates fill and indicator child elements', () => {
      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement

      expect(fillEl).not.toBeNull()
      expect(indicatorEl).not.toBeNull()
      expect(fillEl.style.position).toBe('absolute')
      expect(indicatorEl.style.position).toBe('absolute')
    })

    it('returns same element on second render (caching)', () => {
      const el1 = widget.render()
      const el2 = widget.render()
      expect(el1).toBe(el2)
    })

    it('sets data-widget-id when id is set', () => {
      widget.id = 'test-resource-bar'
      const el = widget.render()
      expect(el.getAttribute('data-widget-id')).toBe('test-resource-bar')
    })

    it('indicator has correct initial size', () => {
      const el = widget.render()
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement
      expect(indicatorEl.style.width).toBe('8px')
      expect(indicatorEl.style.height).toBe('8px')
    })

    it('respects custom indicatorSize', () => {
      widget.indicatorSize = { x: 12, y: 12 }
      const el = widget.render()
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement
      expect(indicatorEl.style.width).toBe('12px')
      expect(indicatorEl.style.height).toBe('12px')
    })
  })

  // ---- Vertical layout ----

  describe('vertical layout', () => {
    it('fill bar grows from bottom upward', () => {
      widget.orientation = ResourceBarOrientation.Vertical
      widget.bounds = { x: 0, y: 0, width: 20, height: 200 }
      widget.getProvided = () => 50
      widget.getUsed = () => 30

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement

      // max(50,30)=50, scaleBy stays 100 (50<100), providedFrac=50/100=0.5
      // fillHeight=0.5*200=100px
      expect(fillEl.style.bottom).toBe('0px')
      expect(fillEl.style.height).toBe('100px')
    })

    it('indicator centers horizontally in vertical mode', () => {
      widget.orientation = ResourceBarOrientation.Vertical
      widget.bounds = { x: 0, y: 0, width: 20, height: 200 }
      widget.getProvided = () => 50
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement

      // indicatorSize.x = 8, width = 20 → (20-8)/2 = 6
      expect(indicatorEl.style.left).toBe('6px')
    })
  })

  // ---- Horizontal layout ----

  describe('horizontal layout', () => {
    it('fill bar grows from left to right', () => {
      widget.orientation = ResourceBarOrientation.Horizontal
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getProvided = () => 75
      widget.getUsed = () => 50

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement

      // max(75,50)=75, scaleBy stays 100 (75<100), providedFrac=75/100=0.75
      // fillWidth=0.75*200=150px
      expect(fillEl.style.left).toBe('0px')
      expect(fillEl.style.top).toBe('0px')
      expect(fillEl.style.width).toBe('150px')
      expect(fillEl.style.height).toBe('100%')
    })

    it('indicator centers vertically in horizontal mode', () => {
      widget.orientation = ResourceBarOrientation.Horizontal
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getProvided = () => 50
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement

      // indicatorSize.y = 8, height = 20 → (20-8)/2 = 6
      expect(indicatorEl.style.top).toBe('6px')
    })
  })

  // ---- Scale-by logic ----

  describe('scale-by logic', () => {
    it('auto-scales when values exceed 100', () => {
      widget.orientation = ResourceBarOrientation.Vertical
      widget.bounds = { x: 0, y: 0, width: 20, height: 200 }
      widget.getProvided = () => 500 // max=500, scaleBy: 100→200→400→800
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement

      // scaleBy=800, providedFrac=500/800=0.625
      // fillHeight=0.625*200=125px
      expect(fillEl.style.height).toBe('125px')
    })

    it('scales correctly when max is 400', () => {
      widget.orientation = ResourceBarOrientation.Horizontal
      widget.bounds = { x: 0, y: 0, width: 200, height: 20 }
      widget.getProvided = () => 400 // max=400, scaleBy: 100→200→400→800
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement

      // scaleBy=800, providedFrac=400/800=0.5
      // fillWidth=0.5*200=100px
      expect(fillEl.style.width).toBe('100px')
    })
  })

  // ---- Boundary cases ----

  describe('boundary cases', () => {
    it('handles zero values', () => {
      widget.bounds = { x: 0, y: 0, width: 100, height: 100 }
      widget.getProvided = () => 0
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement
      // scaleBy with max=0: 0>=100? No → scaleBy=100
      // providedFrac=0/100=0 → fillHeight/fillWidth=0
      expect(
        fillEl.style.width === '0px' || fillEl.style.height === '0px',
      ).toBe(true)
    })

    it('handles zero bounds (no update)', () => {
      widget.bounds = { x: 0, y: 0, width: 0, height: 0 }
      widget.getProvided = () => 100

      // 不应抛出异常
      expect(() => {
        widget.render()
        widget.tick()
      }).not.toThrow()
    })

    it('handles negative bounds gracefully', () => {
      widget.bounds = { x: 0, y: 0, width: 0, height: -10 }
      widget.getProvided = () => 100

      expect(() => {
        widget.render()
        widget.tick()
      }).not.toThrow()
    })

    it('handles max=100 without divide by zero', () => {
      widget.orientation = ResourceBarOrientation.Vertical
      widget.bounds = { x: 0, y: 0, width: 100, height: 100 }
      widget.getProvided = () => 100
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      // max=100, scaleBy starts at 100: 100>=100 → scaleBy=200
      // providedFrac=100/200=0.5 → fillHeight=50px
      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement

      expect(fillEl.style.height).toBe('50px')
    })
  })

  // ---- Orientation switching ----

  describe('orientation switching', () => {
    it('vertical orientation renders fill from bottom', () => {
      widget.orientation = ResourceBarOrientation.Vertical
      widget.bounds = { x: 0, y: 0, width: 30, height: 100 }
      widget.getProvided = () => 100
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement

      // 垂直模式：max=100, scaleBy=200, providedFrac=100/200=0.5 → fillHeight=50px
      // fill aligns to bottom
      expect(fillEl.style.bottom).toBe('0px')
      expect(fillEl.style.width).toBe('100%')
      expect(fillEl.style.height).toBe('50px')
      // 指示器水平居中
      expect(indicatorEl.style.left).toBe('11px') // (30-8)/2 = 11
    })

    it('horizontal orientation renders fill from left', () => {
      widget.orientation = ResourceBarOrientation.Horizontal
      widget.bounds = { x: 0, y: 0, width: 100, height: 30 }
      widget.getProvided = () => 100
      widget.getUsed = () => 0

      widget.render()
      widget.tick()

      const el = widget.render()
      const fillEl = el.querySelector('.resource-bar-fill') as HTMLElement
      const indicatorEl = el.querySelector(
        '.resource-bar-indicator',
      ) as HTMLElement

      // 水平模式：max=100, scaleBy=200, providedFrac=100/200=0.5 → fillWidth=50px
      // fill 左对齐
      expect(fillEl.style.left).toBe('0px')
      expect(fillEl.style.height).toBe('100%')
      expect(fillEl.style.width).toBe('50px')
      // 指示器垂直居中
      expect(indicatorEl.style.top).toBe('11px') // (30-8)/2 = 11
    })
  })

  // ---- Dispose ----

  describe('dispose', () => {
    it('cleans up references', () => {
      widget.render()
      widget.dispose()

      // 不应抛出异常
      expect(() => widget.dispose()).not.toThrow()
    })

    it('can call dispose without prior render', () => {
      expect(() => widget.dispose()).not.toThrow()
    })
  })
})
