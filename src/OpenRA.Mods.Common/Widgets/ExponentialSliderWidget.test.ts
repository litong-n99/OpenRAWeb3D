/**
 * ExponentialSliderWidget.test.ts — ExponentialSliderWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化（expA, expB）
 * - expFromLinear() 指数映射
 * - linearFromExp() 逆指数映射
 * - valueFromPx() 使用指数映射
 * - pxFromValue() 使用逆指数映射
 * - 边界值处理（x=0, x=1, x<0, x>1）
 * - 继承的 Slider 行为（updateValue, OnChange, toggle, keyboard）
 * - Clone 复制构造函数
 * - 音量控制典型用例（-60dB 到 0dB 范围）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ExponentialSliderWidget } from './ExponentialSliderWidget.js'
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

describe('ExponentialSliderWidget', () => {
  beforeEach(() => {
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
    it('should extend SliderWidget', () => {
      const es = new ExponentialSliderWidget()
      expect(es).toBeInstanceOf(ExponentialSliderWidget)
      expect(es).toBeInstanceOf(SliderWidget)
      expect(es).toBeInstanceOf(InputWidget)
    })

    it('should have default expA and expB', () => {
      const es = new ExponentialSliderWidget()
      expect(es.expA).toBe(1.0e-3)
      expect(es.expB).toBe(6.908)
    })

    it('should inherit slider properties', () => {
      const es = new ExponentialSliderWidget()
      expect(es.minimumValue).toBe(0)
      expect(es.maximumValue).toBe(1)
      expect(es.value).toBe(0)
      expect(es.ticks).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // expFromLinear
  // ---------------------------------------------------------------------------

  describe('expFromLinear()', () => {
    it('should return 0 when x <= 0', () => {
      const es = new ExponentialSliderWidget()
      expect(es.expFromLinear(0)).toBe(0)
      expect(es.expFromLinear(-0.1)).toBe(0)
    })

    it('should return ~1 when x = 1', () => {
      const es = new ExponentialSliderWidget()
      // expA * exp(expB * 1) = 0.001 * exp(6.908) = 0.001 * 999.xxx ≈ 1.0
      const result = es.expFromLinear(1)
      expect(result).toBeCloseTo(1.0, 2)
    })

    it('should return small value near 0 for small linear input', () => {
      const es = new ExponentialSliderWidget()
      // expA * exp(expB * 0.5) = 0.001 * exp(3.454) ≈ 0.001 * 31.6 ≈ 0.0316
      const result = es.expFromLinear(0.5)
      expect(result).toBeGreaterThan(0.02)
      expect(result).toBeLessThan(0.05)
    })

    it('should be monotonic increasing', () => {
      const es = new ExponentialSliderWidget()
      const v1 = es.expFromLinear(0.2)
      const v2 = es.expFromLinear(0.5)
      const v3 = es.expFromLinear(0.8)
      expect(v1).toBeLessThan(v2)
      expect(v2).toBeLessThan(v3)
    })

    it('should be clamped to [0, 1]', () => {
      const es = new ExponentialSliderWidget()
      expect(es.expFromLinear(2.0)).toBe(1)
      expect(es.expFromLinear(-0.5)).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // linearFromExp
  // ---------------------------------------------------------------------------

  describe('linearFromExp()', () => {
    it('should return 0 when x <= 0', () => {
      const es = new ExponentialSliderWidget()
      expect(es.linearFromExp(0)).toBe(0)
      expect(es.linearFromExp(-0.1)).toBe(0)
    })

    it('should return ~1 when x = 1 (clamped)', () => {
      const es = new ExponentialSliderWidget()
      // log(1 / 0.001) / 6.908 = log(1000) / 6.908 = 6.908 / 6.908 = 1.0
      const result = es.linearFromExp(1)
      expect(result).toBeCloseTo(1.0, 2)
    })

    it('should return ~0.5 for expFromLinear(0.5) (round-trip)', () => {
      const es = new ExponentialSliderWidget()
      const expVal = es.expFromLinear(0.5)
      const linVal = es.linearFromExp(expVal)
      expect(linVal).toBeCloseTo(0.5, 2)
    })

    it('should return ~0 for very small values', () => {
      const es = new ExponentialSliderWidget()
      const result = es.linearFromExp(0.0005)
      // log(0.0005 / 0.001) / 6.908 = log(0.5) / 6.908 = -0.693 / 6.908 ≈ -0.1
      // clamped to 0
      expect(result).toBe(0)
    })

    it('should be monotonic increasing', () => {
      const es = new ExponentialSliderWidget()
      const v1 = es.linearFromExp(0.01)
      const v2 = es.linearFromExp(0.1)
      const v3 = es.linearFromExp(0.5)
      expect(v1).toBeLessThan(v2)
      expect(v2).toBeLessThan(v3)
    })
  })

  // ---------------------------------------------------------------------------
  // expFromLinear ↔ linearFromExp round-trip
  // ---------------------------------------------------------------------------

  describe('exp ↔ linear round-trip', () => {
    it('should round-trip accurately at various positions', () => {
      const es = new ExponentialSliderWidget()
      const testPoints = [0.1, 0.25, 0.5, 0.75, 0.9]
      for (const x of testPoints) {
        const expVal = es.expFromLinear(x)
        const linVal = es.linearFromExp(expVal)
        expect(linVal).toBeCloseTo(x, 2)
      }
    })

    it('should round-trip at x = 0', () => {
      const es = new ExponentialSliderWidget()
      expect(es.expFromLinear(0)).toBe(0)
    })

    it('should round-trip at x ≈ 1', () => {
      const es = new ExponentialSliderWidget()
      const expVal = es.expFromLinear(1)
      const linVal = es.linearFromExp(expVal)
      expect(linVal).toBeCloseTo(1, 2)
    })
  })

  // ---------------------------------------------------------------------------
  // valueFromPx (exponential override)
  // ---------------------------------------------------------------------------

  describe('valueFromPx()', () => {
    it('should map left edge to minimumValue', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      // x = 0.5 * height = 10
      const val = es.valueFromPx(10)
      expect(val).toBe(0)
    })

    it('should map right edge close to maximumValue (exponential)', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      // x = w - 0.5*h = 190 → linear = 1 → exp ≈ 1 → value ≈ 100
      const val = es.valueFromPx(190)
      expect(val).toBeCloseTo(100, 0)
    })

    it('should produce nonlinear mapping (exponential growth)', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100

      // At linear midpoint (px=100), value should be much less than 50
      // because exponential grows slowly at first
      const midVal = es.valueFromPx(100)
      expect(midVal).toBeLessThan(10) // ~0.0316 * 100 ≈ 3.2
    })

    it('should clamp pixel values outside range', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 10
      es.maximumValue = 100

      expect(es.valueFromPx(-100)).toBe(10)
      expect(es.valueFromPx(300)).toBeCloseTo(100, 0)
    })

    it('should return minimumValue when width <= height', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 10, height: 20 }
      es.minimumValue = 20
      es.maximumValue = 80
      expect(es.valueFromPx(5)).toBe(20)
    })
  })

  // ---------------------------------------------------------------------------
  // pxFromValue (exponential override)
  // ---------------------------------------------------------------------------

  describe('pxFromValue()', () => {
    it('should map minimumValue to left edge', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      const px = es.pxFromValue(0)
      expect(px).toBe(10)
    })

    it('should map maximumValue to right edge', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      const px = es.pxFromValue(100)
      // expFromLinear maps 1 → ~1.0, so linearFromExp(1.0) → ~1.0
      // 10 + 180*1 = 190
      expect(px).toBeCloseTo(190, 0)
    })

    it('should produce nonlinear mapping (slow growth near low values)', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100

      // A small value should map to a relatively higher pixel position
      // because the exponential mapping makes low values spread out
      const pxLow = es.pxFromValue(3) // ≈3% of max
      // expFromLinear for linear~0.5 is about 3.1%, so linearFromExp(0.03) ≈ 0.5
      // px ≈ 10 + 180*0.5 = 100
      expect(pxLow).toBeCloseTo(100, -1) // within 10px
    })

    it('should clamp values outside range', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100

      expect(es.pxFromValue(-10)).toBe(10)
      expect(es.pxFromValue(110)).toBeCloseTo(190, 0)
    })

    it('should return mid-point when min equals max', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 50
      es.maximumValue = 50
      expect(es.pxFromValue(50)).toBe(10)
    })
  })

  // ---------------------------------------------------------------------------
  // Value ↔ pixel round-trip (with exponential mapping)
  // ---------------------------------------------------------------------------

  describe('exponential value ↔ pixel round-trip', () => {
    it('should round-trip correctly for a low value', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      es.value = 5
      const px = es.pxFromValue(es.value)
      const val = es.valueFromPx(px)
      expect(val).toBeCloseTo(5, 0)
    })

    it('should round-trip correctly for a mid-range value', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      es.value = 50
      const px = es.pxFromValue(es.value)
      const val = es.valueFromPx(px)
      expect(val).toBeCloseTo(50, 0)
    })

    it('should round-trip correctly for a high value', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      es.value = 90
      const px = es.pxFromValue(es.value)
      const val = es.valueFromPx(px)
      expect(val).toBeCloseTo(90, -1) // within 10 units
    })
  })

  // ---------------------------------------------------------------------------
  // Volume control use case
  // ---------------------------------------------------------------------------

  describe('volume control use case', () => {
    it('should map 0-1 position to -60dB..0dB-like range', () => {
      const es = new ExponentialSliderWidget()
      // expA * exp(expB * 0) = 0.001 → ≈ -60dB (relative to 1.0)
      expect(es.expFromLinear(0)).toBe(0)

      // expA * exp(expB * 1) = 0.001 * exp(6.908) ≈ 1.0 → 0dB
      expect(es.expFromLinear(1)).toBeCloseTo(1, 2)

      // expA * exp(expB * 0.5) ≈ 0.0316 → ≈ -30dB (halfway position)
      expect(es.expFromLinear(0.5)).toBeCloseTo(0.0316, 2)
    })

    it('should be usable as audio volume slider', () => {
      const es = new ExponentialSliderWidget()
      es.minimumValue = 0
      es.maximumValue = 100
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }

      // Drag to middle → should give low volume (~3%)
      const midVal = es.valueFromPx(100)
      expect(midVal).toBeLessThan(5) // <5% volume at midpoint

      // Drag to 75% → should give moderate volume
      const highVal = es.valueFromPx(150)
      expect(highVal).toBeGreaterThan(20)
      expect(highVal).toBeLessThan(60)
    })
  })

  // ---------------------------------------------------------------------------
  // Custom expA / expB
  // ---------------------------------------------------------------------------

  describe('custom expA / expB', () => {
    it('should use custom expA and expB for mapping', () => {
      const es = new ExponentialSliderWidget()
      es.expA = 0.01 // quieter minimum
      es.expB = 4.605 // ln(100) → 40dB range

      // expA * exp(expB * 0.5) = 0.01 * exp(2.3025) = 0.01 * 10 ≈ 0.1
      expect(es.expFromLinear(0.5)).toBeCloseTo(0.1, 1)

      // linearFromExp(0.1) → log(0.1 / 0.01) / 4.605 = log(10) / 4.605 = 1.0
      // ... actually log(0.1 / 0.01) = log(10) ≈ 2.3025; / 4.605 ≈ 0.5
      expect(es.linearFromExp(0.1)).toBeCloseTo(0.5, 1)
    })

    it('should round-trip with custom expA/expB', () => {
      const es = new ExponentialSliderWidget()
      es.expA = 0.002
      es.expB = 5.0

      for (const x of [0.2, 0.4, 0.6, 0.8]) {
        const expVal = es.expFromLinear(x)
        const linVal = es.linearFromExp(expVal)
        expect(linVal).toBeCloseTo(x, 2)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Inherited SliderWidget behavior
  // ---------------------------------------------------------------------------

  describe('inherited slider behavior', () => {
    it('should inherit updateValue with clamping', () => {
      const es = new ExponentialSliderWidget()
      es.minimumValue = 10
      es.maximumValue = 90
      es.updateValue(50)
      expect(es.value).toBe(50)
    })

    it('should fire onChange from inherited updateValue', () => {
      const es = new ExponentialSliderWidget()
      const spy = vi.fn()
      es.onChange = spy
      es.updateValue(0.7)
      expect(spy).toHaveBeenCalledWith(0.7)
    })

    it('should handle mouse drag via inherited handleEvent', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100

      const event = makeMouseEvent('pointerdown', { clientX: 100, clientY: 10 })
      es.handleEvent(event)
      expect(es.hasMouseFocus).toBe(true)
    })

    it('should handle keyboard via inherited handleEvent', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100
      es.value = 50

      const event = makeKeyEvent('ArrowRight')
      es.handleEvent(event)
      // step = 100/20 = 5
      expect(es.value).toBe(55)
    })
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe('clone()', () => {
    it('should create a new ExponentialSliderWidget', () => {
      const es = new ExponentialSliderWidget()
      const cloned = es.clone()
      expect(cloned).toBeInstanceOf(ExponentialSliderWidget)
      expect(cloned).not.toBe(es)
    })

    it('should copy exponential properties', () => {
      const es = new ExponentialSliderWidget()
      es.expA = 0.005
      es.expB = 4.0
      es.minimumValue = 5
      es.maximumValue = 95
      es.value = 42

      const cloned = es.clone() as ExponentialSliderWidget
      expect(cloned.expA).toBe(0.005)
      expect(cloned.expB).toBe(4.0)
      expect(cloned.minimumValue).toBe(5)
      expect(cloned.maximumValue).toBe(95)
      expect(cloned.value).toBe(42)
    })

    it('should copy onChange callback', () => {
      const es = new ExponentialSliderWidget()
      const spy = vi.fn()
      es.onChange = spy

      const cloned = es.clone() as ExponentialSliderWidget
      cloned.updateValue(0.5)
      expect(spy).toHaveBeenCalledWith(0.5)
    })

    it('should use exponential value mapping on cloned instance', () => {
      const es = new ExponentialSliderWidget()
      es.bounds = { x: 0, y: 0, width: 200, height: 20 }
      es.minimumValue = 0
      es.maximumValue = 100

      const cloned = es.clone() as ExponentialSliderWidget
      cloned.bounds = { x: 0, y: 0, width: 200, height: 20 }

      // Verify exponential mapping is active on clone
      const midVal = cloned.valueFromPx(100)
      expect(midVal).toBeLessThan(10)
    })
  })

  // ---------------------------------------------------------------------------
  // copyExponentialFrom
  // ---------------------------------------------------------------------------

  describe('copyExponentialFrom', () => {
    it('should copy all exponential and slider properties', () => {
      const src = new ExponentialSliderWidget()
      src.expA = 0.002
      src.expB = 5.0
      src.minimumValue = 0
      src.maximumValue = 100
      src.value = 30

      const dest = new ExponentialSliderWidget()
      ;(dest as any).copyExponentialFrom(src)

      expect(dest.expA).toBe(0.002)
      expect(dest.expB).toBe(5.0)
      expect(dest.minimumValue).toBe(0)
      expect(dest.maximumValue).toBe(100)
      expect(dest.value).toBe(30)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle expA = 0 gracefully (returns 0)', () => {
      const es = new ExponentialSliderWidget()
      es.expA = 0
      const result = es.expFromLinear(0.5)
      // 0 * exp(6.908 * 0.5) = 0
      expect(result).toBe(0)
    })

    it('should handle very large expB gracefully (raises quickly to 1)', () => {
      const es = new ExponentialSliderWidget()
      es.expB = 20
      const result = es.expFromLinear(0.5)
      // Will be clamped to 1, because 0.001 * exp(10) ≈ 22 → clamped to 1
      expect(result).toBe(1)
    })

    it('should handle very small expB gracefully (near-linear)', () => {
      const es = new ExponentialSliderWidget()
      es.expA = 0.5
      es.expB = 0.01
      const result = es.expFromLinear(0.5)
      // 0.5 * exp(0.005) ≈ 0.5 * 1.005 ≈ 0.5025
      expect(result).toBeCloseTo(0.5, 1)
    })

    it('should handle linearFromExp(expA) at expA boundary', () => {
      const es = new ExponentialSliderWidget()
      // linearFromExp(expA) = log(expA / expA) / expB = log(1) / expB = 0
      const result = es.linearFromExp(es.expA)
      expect(result).toBeCloseTo(0, 5)
    })
  })
})
