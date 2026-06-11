/**
 * ChromeMetrics.test.ts — ChromeMetrics 主题默认值存储 单元测试
 *
 * 测试覆盖:
 * - initialize 从 JSON 初始化
 * - get 类型化访问器（字符串和数字）
 * - get 抛出异常（未找到的键）
 * - tryGet 安全访问器
 * - CSS 自定义属性回退
 * - reset 清除数据
 * - initialized 标志
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ChromeMetrics } from './ChromeMetrics.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  ChromeMetrics.reset()
})

afterEach(() => {
  ChromeMetrics.reset()
})

// ===========================================================================
// Initialization
// ===========================================================================

describe('ChromeMetrics initialization', () => {
  it('initialize stores key-value pairs', () => {
    ChromeMetrics.initialize({
      ButtonDepth: 2,
      FontSize: '14px',
      BackgroundColor: '#1a1a1a',
    })

    expect(ChromeMetrics.initialized).toBe(true)
    expect(ChromeMetrics.keys).toContain('ButtonDepth')
    expect(ChromeMetrics.keys).toContain('FontSize')
    expect(ChromeMetrics.keys).toContain('BackgroundColor')
  })

  it('initialize clears previous data', () => {
    ChromeMetrics.initialize({ OldKey: 1 })
    ChromeMetrics.initialize({ NewKey: 2 })

    expect(ChromeMetrics.keys).not.toContain('OldKey')
    expect(ChromeMetrics.keys).toContain('NewKey')
  })

  it('initialized is false before initialize', () => {
    expect(ChromeMetrics.initialized).toBe(false)
  })

  it('initialized is true after initialize', () => {
    ChromeMetrics.initialize({ Key: 42 })
    expect(ChromeMetrics.initialized).toBe(true)
  })
})

// ===========================================================================
// get — typed accessor
// ===========================================================================

describe('ChromeMetrics.get', () => {
  beforeEach(() => {
    ChromeMetrics.initialize({
      ButtonDepth: 2,
      FontSize: '14px',
      TitleHeight: 30,
      ColorPanel: '#1a1a1a',
      NumericStringValue: '42',
    })
  })

  it('get returns string value as string', () => {
    const result = ChromeMetrics.get<string>('FontSize')
    expect(result).toBe('14px')
  })

  it('get returns number value as number', () => {
    const result = ChromeMetrics.get<number>('ButtonDepth')
    expect(result).toBe(2)
    expect(typeof result).toBe('number')
  })

  it('get returns numeric string as string (no auto-conversion)', () => {
    const result = ChromeMetrics.get<string>('NumericStringValue')
    expect(result).toBe('42')
  })

  it('get returns stored number as number', () => {
    ChromeMetrics.initialize({ PureNumber: 99 })
    const result = ChromeMetrics.get<number>('PureNumber')
    expect(result).toBe(99)
    expect(typeof result).toBe('number')
  })

  it('get throws for non-existent key', () => {
    expect(() => ChromeMetrics.get('NonExistentKey')).toThrow(
      /not found in data or CSS/,
    )
  })

  it('get returns CSS-pixel value from number correctly', () => {
    ChromeMetrics.initialize({ ButtonDepth: 2 })
    const result = ChromeMetrics.get<number>('ButtonDepth')
    expect(result).toBe(2)
  })
})

// ===========================================================================
// tryGet — safe accessor
// ===========================================================================

describe('ChromeMetrics.tryGet', () => {
  beforeEach(() => {
    ChromeMetrics.initialize({
      ButtonDepth: 2,
      FontSize: '14px',
    })
  })

  it('tryGet returns value for existing key', () => {
    expect(ChromeMetrics.tryGet<string>('FontSize')).toBe('14px')
    expect(ChromeMetrics.tryGet<number>('ButtonDepth')).toBe(2)
  })

  it('tryGet returns undefined for non-existent key', () => {
    expect(ChromeMetrics.tryGet('MissingKey')).toBeUndefined()
  })

  it('tryGet returns undefined when not initialized', () => {
    ChromeMetrics.reset()
    expect(ChromeMetrics.tryGet('AnyKey')).toBeUndefined()
  })
})

// ===========================================================================
// CSS Fallback
// ===========================================================================

describe('ChromeMetrics CSS fallback', () => {
  it('tryGet falls back to CSS custom property', () => {
    // Set up CSS custom property on documentElement
    document.documentElement.style.setProperty('--css-test-key', '24px')

    const result = ChromeMetrics.tryGet<string>('css-test-key')
    expect(result).toBe('24px')

    document.documentElement.style.removeProperty('--css-test-key')
  })

  it('tryGet prefers in-memory value over CSS', () => {
    ChromeMetrics.initialize({ 'overlap-key': 'from-memory' })
    document.documentElement.style.setProperty('--overlap-key', 'from-css')

    const result = ChromeMetrics.tryGet<string>('overlap-key')
    expect(result).toBe('from-memory')

    document.documentElement.style.removeProperty('--overlap-key')
  })

  it('tryGet returns undefined when key exists in neither memory nor CSS', () => {
    const result = ChromeMetrics.tryGet('completely-missing-key')
    expect(result).toBeUndefined()
  })
})

// ===========================================================================
// reset
// ===========================================================================

describe('ChromeMetrics.reset', () => {
  it('reset clears all data', () => {
    ChromeMetrics.initialize({ Key1: 1, Key2: 'two' })
    ChromeMetrics.reset()

    expect(ChromeMetrics.initialized).toBe(false)
    expect(ChromeMetrics.keys.length).toBe(0)
    expect(ChromeMetrics.data.size).toBe(0)
  })
})

// ===========================================================================
// Data access
// ===========================================================================

describe('ChromeMetrics data access', () => {
  it('data returns a read-only map', () => {
    ChromeMetrics.initialize({ A: 1, B: 2 })
    const d = ChromeMetrics.data
    expect(d.get('A')).toBe(1)
    expect(d.get('B')).toBe(2)
    expect(d.size).toBe(2)
  })

  it('keys returns all key names', () => {
    ChromeMetrics.initialize({ A: 1, B: 'two' })
    const keys = ChromeMetrics.keys
    expect(keys).toContain('A')
    expect(keys).toContain('B')
    expect(keys.length).toBe(2)
  })
})

// ===========================================================================
// Edge cases
// ===========================================================================

describe('ChromeMetrics edge cases', () => {
  it('get handles empty string values', () => {
    ChromeMetrics.initialize({ EmptyStr: '' })
    // Empty string is valid, get should return it (as string)
    const result = ChromeMetrics.tryGet<string>('EmptyStr')
    expect(result).toBe('')
  })

  it('get returns negative string as string', () => {
    ChromeMetrics.initialize({ Negative: '-10' })
    const result = ChromeMetrics.get<string>('Negative')
    expect(result).toBe('-10')
  })

  it('get returns float string as string', () => {
    ChromeMetrics.initialize({ Float: '3.14' })
    const result = ChromeMetrics.get<string>('Float')
    expect(result).toBe('3.14')
  })

  it('non-numeric strings are returned as-is', () => {
    ChromeMetrics.initialize({ Color: 'rgb(255, 0, 0)' })
    const result = ChromeMetrics.get<string>('Color')
    expect(result).toBe('rgb(255, 0, 0)')
  })
})
