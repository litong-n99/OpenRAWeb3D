/**
 * SliderWidget.test.ts — SliderWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化（minimumValue, maximumValue, ticks, trackHeight, etc.）
 * - 委托默认值 (getValue)
 * - updateValue() 钳制和 OnChange 触发
 * - valueFromPx / pxFromValue 像素↔值转换
 * - thumbRect 计算
 * - 鼠标拖拽状态机（pointerdown → pointermove → pointerup）
 * - 键盘调整（ArrowLeft / ArrowRight）
 * - disabled 状态保护
 * - DOM 渲染（轨道、拇指、刻度线）
 * - 拇指悬停状态跟踪（mouseEntered / mouseExited）
 * - Clone 复制构造函数
 * - 光标查询（getCursor）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SliderWidget } from './SliderWidget.js'
import { InputWidget, Ui } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

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

describe('SliderWidget', () => {
  beforeEach(() => {
    // Reset Ui state
    Ui.mouseFocusWidget = null
    Ui.keyboardFocusWidget = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Construction & Inheritance
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should extend InputWidget', () => {
      const slider = new SliderWidget()
      expect(slider).toBeInstanceOf(SliderWidget)
      expect(slider).toBeInstanceOf(InputWidget)
    })

    it('should have default property values', () => {
      const slider = new SliderWidget()
      expect(slider.minimumValue).toBe(0)
      expect(slider.maximumValue).toBe(1)
      expect(slider.value).toBe(0)
      expect(slider.ticks).toBe(0)
      expect(slider.trackHeight).toBe(5)
      expect(slider.thumb).toBe('slider-thumb')
      expect(slider.track).toBe('slider-track')
    })

    it('should have onChange null by default', () => {
      const slider = new SliderWidget()
      expect(slider.onChange).toBeNull()
    })

    it('should have getValue delegate returning value by default', () => {
      const slider = new SliderWidget()
      expect(slider.getValue()).toBe(0)
      slider.value = 0.5
      expect(slider.getValue()).toBe(0.5)
    })
  })

  // ---------------------------------------------------------------------------
  // updateValue
  // ---------------------------------------------------------------------------

  describe('updateValue()', () => {
    it('should set value and clamp to range', () => {
      const slider = new SliderWidget()
      slider.updateValue(0.5)
      expect(slider.value).toBe(0.5)
    })

    it('should clamp below minimumValue', () => {
      const slider = new SliderWidget()
      slider.updateValue(-0.5)
      expect(slider.value).toBe(0)
    })

    it('should clamp above maximumValue', () => {
      const slider = new SliderWidget()
      slider.updateValue(1.5)
      expect(slider.value).toBe(1)
    })

    it('should fire onChange when value changes', () => {
      const slider = new SliderWidget()
      const spy = vi.fn()
      slider.onChange = spy
      slider.updateValue(0.7)
      expect(spy).toHaveBeenCalledWith(0.7)
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should not fire onChange when value does not change', () => {
      const slider = new SliderWidget()
      slider.value = 0.5
      const spy = vi.fn()
      slider.onChange = spy
      slider.updateValue(0.5)
      expect(spy).not.toHaveBeenCalled()
    })

    it('should fire onChange with clamped value', () => {
      const slider = new SliderWidget()
      const spy = vi.fn()
      slider.onChange = spy
      slider.updateValue(2.0)
      expect(spy).toHaveBeenCalledWith(1.0)
    })

    it('should update value and fire onChange for custom min/max range', () => {
      const slider = new SliderWidget()
      slider.minimumValue = 10
      slider.maximumValue = 100
      slider.value = 50
      const spy = vi.fn()
      slider.onChange = spy
      slider.updateValue(75)
      expect(slider.value).toBe(75)
      expect(spy).toHaveBeenCalledWith(75)
    })
  })

  // ---------------------------------------------------------------------------
  // valueFromPx
  // ---------------------------------------------------------------------------

  describe('valueFromPx()', () => {
    it('should map left edge to minimumValue', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // Left edge: x = 0.5 * h = 10
      const val = slider.valueFromPx(10)
      expect(val).toBe(0)
    })

    it('should map right edge to maximumValue', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // Right edge: x = w - 0.5 * h = 200 - 10 = 190
      const val = slider.valueFromPx(190)
      expect(val).toBe(100)
    })

    it('should map midpoint to mid-value', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // Midpoint: x = 0.5 * 200 = 100 → ratio = (100 - 10) / 180 = 0.5
      const val = slider.valueFromPx(100)
      expect(val).toBeCloseTo(50, 0)
    })

    it('should clamp pixel values outside range', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100

      // Too far left → clamp to min
      expect(slider.valueFromPx(-100)).toBe(0)
      // Too far right → clamp to max
      expect(slider.valueFromPx(300)).toBe(100)
    })

    it('should return minimumValue when width <= height', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 10, height: 20 }
      slider.minimumValue = 10
      slider.maximumValue = 100
      expect(slider.valueFromPx(5)).toBe(10)
    })
  })

  // ---------------------------------------------------------------------------
  // pxFromValue
  // ---------------------------------------------------------------------------

  describe('pxFromValue()', () => {
    it('should map minimumValue to left edge pixel', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // h/2 = 10
      const px = slider.pxFromValue(0)
      expect(px).toBe(10)
    })

    it('should map maximumValue to right edge pixel', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // h/2 + (w - h) = 10 + 180 = 190
      const px = slider.pxFromValue(100)
      expect(px).toBe(190)
    })

    it('should map mid-value to center pixel', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // 10 + 180 * 0.5 = 100
      const px = slider.pxFromValue(50)
      expect(px).toBe(100)
    })

    it('should clamp values outside range', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      // Below min → clamp to left edge
      expect(slider.pxFromValue(-10)).toBe(10)
      // Above max → clamp to right edge
      expect(slider.pxFromValue(110)).toBe(190)
    })

    it('should return mid-point when min equals max', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 50
      slider.maximumValue = 50
      // h/2 = 10
      expect(slider.pxFromValue(50)).toBe(10)
    })
  })

  // ---------------------------------------------------------------------------
  // Value round-trip (valueFromPx ↔ pxFromValue)
  // ---------------------------------------------------------------------------

  describe('value ↔ pixel round-trip', () => {
    it('should round-trip correctly for mid-value', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 50
      const px = slider.pxFromValue(slider.value)
      const val = slider.valueFromPx(px)
      expect(val).toBeCloseTo(50, 0)
    })

    it('should round-trip correctly for custom range', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 300, height: 30 }
      slider.minimumValue = 20
      slider.maximumValue = 80
      slider.value = 50
      const px = slider.pxFromValue(slider.value)
      const val = slider.valueFromPx(px)
      expect(val).toBeCloseTo(50, 0)
    })
  })

  // ---------------------------------------------------------------------------
  // thumbRect
  // ---------------------------------------------------------------------------

  describe('thumbRect', () => {
    it('should have size equal to bounds height', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 50, y: 10, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      const rect = slider.thumbRect
      expect(rect.width).toBe(20)
      expect(rect.height).toBe(20)
    })

    it('should be centered on the value position', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 50, y: 10, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 50
      const rect = slider.thumbRect
      // px = 50 + 10 + 180*0.5 = 150; center at 150, left = 150 - 10 = 140
      expect(rect.x).toBe(140)
    })

    it('should be at left edge when value is minimum', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 50, y: 10, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 0
      const rect = slider.thumbRect
      // px = 50 + 10 = 60; left = 60 - 10 = 50
      expect(rect.x).toBe(50)
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse drag handling
  // ---------------------------------------------------------------------------

  describe('mouse drag', () => {
    it('should take mouse focus on pointerdown', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      const event = makeMouseEvent('pointerdown', { clientX: 100, clientY: 10 })
      slider.handleEvent(event)
      expect(slider.hasMouseFocus).toBe(true)
    })

    it('should set _isMoving true on pointerdown', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      const event = makeMouseEvent('pointerdown', { clientX: 100, clientY: 10 })
      slider.handleEvent(event)
      expect((slider as any)._isMoving).toBe(true)
    })

    it('should update value on pointerdown', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      const event = makeMouseEvent('pointerdown', { clientX: 100, clientY: 10 })
      slider.handleEvent(event)
      expect(slider.value).toBeCloseTo(50, 0)
    })

    it('should update value on pointermove when isMoving', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100

      // Start drag
      const downEvt = makeMouseEvent('pointerdown', { clientX: 50, clientY: 10 })
      slider.handleEvent(downEvt)

      // Move
      const moveEvt = makeMouseEvent('pointermove', { clientX: 150, clientY: 10 })
      slider.handleEvent(moveEvt)
      // x=150 → local=150 → ratio = (150-10)/180 ≈ 0.778 → value ≈ 77.8
      expect(slider.value).toBeCloseTo(77.8, 0)
    })

    it('should not update value on pointermove without focus', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100

      const moveEvt = makeMouseEvent('pointermove', { clientX: 150, clientY: 10 })
      const prevValue = slider.value
      slider.handleEvent(moveEvt)
      expect(slider.value).toBe(prevValue)
    })

    it('should reset _isMoving and yield focus on pointerup', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }

      // Start drag
      slider.handleEvent(makeMouseEvent('pointerdown', { clientX: 50, clientY: 10 }))
      expect(slider.hasMouseFocus).toBe(true)

      // Release
      slider.handleEvent(makeMouseEvent('pointerup', { clientX: 50, clientY: 10 }))
      expect((slider as any)._isMoving).toBe(false)
      expect(slider.hasMouseFocus).toBe(false)
    })

    it('should not respond to non-left buttons', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      const event = makeMouseEvent('pointerdown', {
        clientX: 100,
        clientY: 10,
        button: 1,
      })
      slider.handleEvent(event)
      expect(slider.hasMouseFocus).toBe(false)
    })

    it('should not respond when disabled', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.disabled = true

      const event = makeMouseEvent('pointerdown', { clientX: 100, clientY: 10 })
      slider.handleEvent(event)
      expect(slider.hasMouseFocus).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Keyboard adjustment
  // ---------------------------------------------------------------------------

  describe('keyboard adjustment', () => {
    it('should decrease value with ArrowLeft', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 50

      const event = makeKeyEvent('ArrowLeft')
      slider.handleEvent(event)
      // Step = (100 - 0) / 20 = 5
      expect(slider.value).toBe(45)
    })

    it('should increase value with ArrowRight', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 50

      const event = makeKeyEvent('ArrowRight')
      slider.handleEvent(event)
      // Step = (100 - 0) / 20 = 5
      expect(slider.value).toBe(55)
    })

    it('should use tick-based step when ticks > 0', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.ticks = 10
      slider.value = 50

      const event = makeKeyEvent('ArrowRight')
      slider.handleEvent(event)
      // Step = (100 - 0) / 10 = 10
      expect(slider.value).toBe(60)
    })

    it('should clamp at minimum', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 2

      const event = makeKeyEvent('ArrowLeft')
      slider.handleEvent(event)
      // step = 5, value clamped at 0
      expect(slider.value).toBe(0)
    })

    it('should clamp at maximum', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.minimumValue = 0
      slider.maximumValue = 100
      slider.value = 98

      const event = makeKeyEvent('ArrowRight')
      slider.handleEvent(event)
      // step = 5, value clamped at 100
      expect(slider.value).toBe(100)
    })

    it('should not respond when disabled', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.disabled = true
      slider.value = 50

      const event = makeKeyEvent('ArrowRight')
      slider.handleEvent(event)
      expect(slider.value).toBe(50)
    })

    it('should not respond to non-arrow keys', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 20 }
      slider.value = 50

      const event = makeKeyEvent('a')
      const result = slider.handleEvent(event)
      expect(result).toBe(false)
      expect(slider.value).toBe(50)
    })
  })

  // ---------------------------------------------------------------------------
  // copySliderFrom
  // ---------------------------------------------------------------------------

  describe('copySliderFrom', () => {
    it('should copy all slider properties', () => {
      const src = new SliderWidget()
      src.minimumValue = 10
      src.maximumValue = 90
      src.value = 50
      src.ticks = 5
      src.trackHeight = 8
      src.thumb = 'custom-thumb'
      src.track = 'custom-track'
      const fn = vi.fn()
      src.onChange = fn

      const dest = new SliderWidget()
      ;(dest as any).copySliderFrom(src)

      expect(dest.minimumValue).toBe(10)
      expect(dest.maximumValue).toBe(90)
      expect(dest.value).toBe(50)
      expect(dest.ticks).toBe(5)
      expect(dest.trackHeight).toBe(8)
      expect(dest.thumb).toBe('custom-thumb')
      expect(dest.track).toBe('custom-track')
      expect(dest.onChange).toBe(fn)
    })
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe('clone()', () => {
    it('should create a new SliderWidget instance', () => {
      const slider = new SliderWidget()
      const cloned = slider.clone()
      expect(cloned).toBeInstanceOf(SliderWidget)
      expect(cloned).not.toBe(slider)
    })

    it('should copy slider properties', () => {
      const slider = new SliderWidget()
      slider.minimumValue = 5
      slider.maximumValue = 95
      slider.value = 42
      slider.ticks = 8
      slider.trackHeight = 6

      const cloned = slider.clone() as SliderWidget
      expect(cloned.minimumValue).toBe(5)
      expect(cloned.maximumValue).toBe(95)
      expect(cloned.value).toBe(42)
      expect(cloned.ticks).toBe(8)
      expect(cloned.trackHeight).toBe(6)
    })

    it('should copy onChange callback', () => {
      const slider = new SliderWidget()
      const spy = vi.fn()
      slider.onChange = spy

      const cloned = slider.clone() as SliderWidget
      cloned.updateValue(0.7)
      expect(spy).toHaveBeenCalledWith(0.7)
    })

    it('should copy disabled state', () => {
      const slider = new SliderWidget()
      slider.disabled = true

      const cloned = slider.clone() as SliderWidget
      expect(cloned.disabled).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // getCursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('should return "pointer" when enabled', () => {
      const slider = new SliderWidget()
      expect(slider.getCursor({ x: 0, y: 0 })).toBe('pointer')
    })

    it('should return "not-allowed" when disabled', () => {
      const slider = new SliderWidget()
      slider.disabled = true
      expect(slider.getCursor({ x: 0, y: 0 })).toBe('not-allowed')
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse hover tracking
  // ---------------------------------------------------------------------------

  describe('mouse hover', () => {
    it('should set thumb hover on mouseEntered', () => {
      const slider = new SliderWidget()
      slider.mouseEntered()
      expect((slider as any)._thumbHovered).toBe(true)
    })

    it('should clear thumb hover on mouseExited', () => {
      const slider = new SliderWidget()
      slider.mouseEntered()
      slider.mouseExited()
      expect((slider as any)._thumbHovered).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  describe('render()', () => {
    it('should return an HTMLElement', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      const el = slider.render()
      expect(el).toBeInstanceOf(HTMLElement)
    })

    it('should render track element', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      const el = slider.render()
      const track = el.querySelector('[data-slider-track-element]')
      expect(track).not.toBeNull()
    })

    it('should render thumb element', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      const el = slider.render()
      const thumb = el.querySelector('[data-slider-thumb-element]')
      expect(thumb).not.toBeNull()
    })

    it('should not render tickmarks when ticks = 0', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      slider.ticks = 0
      const el = slider.render()
      const tickContainer = el.querySelector('[data-slider-ticks]')
      expect(tickContainer).toBeNull()
    })

    it('should render tickmarks when ticks > 0', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      slider.ticks = 5
      const el = slider.render()
      const tickContainer = el.querySelector('[data-slider-ticks]')
      expect(tickContainer).not.toBeNull()
      // 5 tick divs
      const tickDivs = tickContainer!.querySelectorAll('div')
      expect(tickDivs.length).toBe(5)
    })

    it('should not have duplicate elements on repeated renders', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      slider.render()
      const el = slider.render()
      const tracks = el.querySelectorAll('[data-slider-track-element]')
      const thumbs = el.querySelectorAll('[data-slider-thumb-element]')
      expect(tracks.length).toBe(1)
      expect(thumbs.length).toBe(1)
    })

    it('should hide element when not visible', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      slider.visible = false
      const el = slider.render()
      expect(el.style.display).toBe('none')
    })

    it('should set data-state="disabled" when disabled', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      slider.disabled = true
      const el = slider.render()
      expect(el.getAttribute('data-state')).toBe('disabled')
    })
  })

  // ---------------------------------------------------------------------------
  // Single tick case
  // ---------------------------------------------------------------------------

  describe('single tick', () => {
    it('should render one tick at center when ticks = 1', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      slider.ticks = 1
      const el = slider.render()
      const tickContainer = el.querySelector('[data-slider-ticks]')
      expect(tickContainer).not.toBeNull()
      const tickDivs = tickContainer!.querySelectorAll('div')
      expect(tickDivs.length).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Custom getValue delegate
  // ---------------------------------------------------------------------------

  describe('custom getValue delegate', () => {
    it('should update from getValue delegate during render', () => {
      const slider = new SliderWidget()
      slider.bounds = { x: 0, y: 0, width: 200, height: 24 }
      let externalValue = 0.75
      slider.getValue = () => externalValue
      slider.render()
      // updateValue is called with GetValue() during render
      expect(slider.value).toBe(0.75)
    })
  })
})
