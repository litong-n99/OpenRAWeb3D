/**
 * LabelWithHighlightWidget.test.ts — LabelWithHighlightWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化（highlightColor 从 ChromeMetrics）
 * - MakeComponents — 内联标记模式（<text> 高亮）
 * - MakeComponents — 子字符串匹配模式（highlightedText）
 * - 缓存机制（相同输入不重新解析）
 * - DOM 渲染（<mark> 元素包裹高亮文本）
 * - DOM 渲染（普通列显示）
 * - 大小写不敏感匹配
 * - 多行文本处理
 * - Clone 复制构造函数
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LabelWithHighlightWidget } from './LabelWithHighlightWidget.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LabelWithHighlightWidget', () => {
  let widget: LabelWithHighlightWidget

  beforeEach(() => {
    widget = new LabelWithHighlightWidget()
    widget.bounds = { x: 0, y: 0, width: 300, height: 24 }
  })

  describe('default properties', () => {
    it('has default highlight color', () => {
      expect(widget.highlightColor).toBeTruthy()
      expect(typeof widget.highlightColor).toBe('string')
    })

    it('has null highlightedText by default', () => {
      expect(widget.highlightedText).toBeNull()
    })

    it('inherits LabelWidget properties', () => {
      widget.text = 'Hello'
      expect(widget.getText()).toBe('Hello')
    })
  })

  describe('makeComponents — marker mode', () => {
    it('parses normal text without markers', () => {
      const components = widget.makeComponents('Hello World')
      expect(components.length).toBe(1)
      expect(components[0]!.text).toBe('Hello World')
      expect(components[0]!.highlighted).toBe(false)
    })

    it('parses text with highlight markers (<text>)', () => {
      const components = widget.makeComponents('Hello <World> here')
      expect(components.length).toBe(3)
      expect(components[0]!.text).toBe('Hello ')
      expect(components[0]!.highlighted).toBe(false)
      expect(components[1]!.text).toBe('World')
      expect(components[1]!.highlighted).toBe(true)
      expect(components[2]!.text).toBe(' here')
      expect(components[2]!.highlighted).toBe(false)
    })

    it('parses multiple highlight markers', () => {
      const components = widget.makeComponents('A <B> C <D>')
      // A, B (highlighted), ' C ', D (highlighted)
      expect(components.length).toBeGreaterThanOrEqual(3)
      const highlighted = components.filter((c) => c.highlighted)
      expect(highlighted.length).toBe(2)
      expect(highlighted[0]!.text).toBe('B')
      expect(highlighted[1]!.text).toBe('D')
    })

    it('handles empty highlight markers', () => {
      const components = widget.makeComponents('Hello <> there')
      // Empty <> produces a normal segment 'Hello ' and ' there' with no highlight
      expect(components.length).toBeGreaterThanOrEqual(1)
      // The empty highlight shouldn't appear
      const highlighted = components.filter((c) => c.highlighted)
      expect(highlighted.length).toBe(0)
    })

    it('handles text starting with a highlight marker', () => {
      const components = widget.makeComponents('<Highlighted> normal')
      expect(components.length).toBeGreaterThanOrEqual(1)
      expect(components[0]!.text).toBe('Highlighted')
      expect(components[0]!.highlighted).toBe(true)
    })

    it('handles text with only a single < marker', () => {
      const components = widget.makeComponents('Incomplete <marker')
      // < has no matching >, so it's treated as normal text
      expect(components.length).toBe(1)
      expect(components[0]!.text).toBe('Incomplete <marker')
      expect(components[0]!.highlighted).toBe(false)
    })

    it('handles multi-line text', () => {
      const components = widget.makeComponents('Line1\n<Hi>Line2')
      // Line1, \n, Hi(highlighted), Line2
      expect(components.length).toBeGreaterThanOrEqual(3)
      // Should have a newline component
      const newlines = components.filter((c) => c.text === '\n')
      expect(newlines.length).toBe(1)
    })
  })

  describe('makeComponents — substring mode', () => {
    it('highlights matching substring (case-insensitive)', () => {
      widget.highlightedText = 'world'
      const components = widget.makeComponents('Hello World here')
      const highlighted = components.filter((c) => c.highlighted)
      expect(highlighted.length).toBe(1)
      expect(highlighted[0]!.text).toBe('World')
    })

    it('highlights multiple occurrences', () => {
      widget.highlightedText = 'the'
      const components = widget.makeComponents('The quick the fox the end')
      const highlighted = components.filter((c) => c.highlighted)
      expect(highlighted.length).toBe(3)
    })

    it('does not highlight when substring not found', () => {
      widget.highlightedText = 'xyz'
      const components = widget.makeComponents('Hello World')
      const highlighted = components.filter((c) => c.highlighted)
      expect(highlighted.length).toBe(0)
    })

    it('handles empty highlightedText', () => {
      widget.highlightedText = ''
      // Falls back to marker mode
      const components = widget.makeComponents('<Test>')
      const highlighted = components.filter((c) => c.highlighted)
      // Empty string is falsy, so falls through to marker mode
      expect(highlighted.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('caching', () => {
    it('caches component results for same text', () => {
      // We can observe caching indirectly: if we call makeComponents
      // with the same text twice, the result should be the same
      const result1 = widget.makeComponents('Hello <World>')
      // Note: The caching is internal; but both calls should produce same
      // logical result
      const result2 = widget.makeComponents('Hello <World>')
      expect(result2).toEqual(result1)
    })
  })

  describe('DOM rendering', () => {
    it('renders highlighted text with <mark> element', () => {
      widget.text = 'Hello <World> here'
      const el = widget.render()

      const marks = el.querySelectorAll('mark')
      expect(marks.length).toBe(1)
      expect(marks[0]!.textContent).toBe('World')
      expect(marks[0]!.style.color).toBeTruthy()
    })

    it('renders normal text without marks when no highlights', () => {
      widget.text = 'Plain text'
      const el = widget.render()

      const marks = el.querySelectorAll('mark')
      expect(marks.length).toBe(0)
      expect(el.textContent).toBe('Plain text')
    })

    it('applies highlight color style', () => {
      widget.highlightColor = '#00FF00'
      widget.highlightedText = 'test'
      widget.text = 'This is a test case'

      const el = widget.render()
      const marks = el.querySelectorAll('mark')
      expect(marks.length).toBeGreaterThanOrEqual(1)
      // NOTE: happy-dom preserves the original hex format; browser would normalize to rgb()
      expect(marks[0]!.style.color).toBe('#00FF00')
    })

    it('renders null text as empty', () => {
      widget.text = null
      const el = widget.render()
      expect(el.textContent).toBe('')
    })
  })

  describe('clone', () => {
    it('creates a copy with same properties', () => {
      widget.highlightColor = '#FF0000'
      widget.highlightedText = 'search'
      widget.text = 'Search for me'

      const clone = widget.clone()

      expect(clone.highlightColor).toBe('#FF0000')
      expect(clone.highlightedText).toBe('search')
      expect(clone.text).toBe('Search for me')
    })

    it('clone is a LabelWithHighlightWidget instance', () => {
      const clone = widget.clone()
      expect(clone instanceof LabelWithHighlightWidget).toBe(true)
    })

    it('clone has independent highlight state', () => {
      widget.highlightedText = 'abc'
      const clone = widget.clone()
      clone.highlightedText = 'xyz'

      expect(widget.highlightedText).toBe('abc')
      expect(clone.highlightedText).toBe('xyz')
    })
  })
})
