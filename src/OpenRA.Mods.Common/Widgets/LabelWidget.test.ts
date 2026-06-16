/**
 * LabelWidget.test.ts — LabelWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化（从 ChromeMetrics 回退）
 * - 文本渲染（getText 委托）
 * - 水平/垂直对齐（TextAlign / TextVAlign → CSS text-align / align-items）
 * - 对比色/阴影文字效果（contrast / shadow → CSS text-shadow）
 * - WordWrap 行为
 * - IncreaseHeightToFitCurrentText
 * - Clone 复制构造函数
 * - GetCursor 返回 null
 * - 空文本处理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LabelWidget } from './LabelWidget.js'
import { TextAlign, TextVAlign } from './TextAlign.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LabelWidget', () => {
  beforeEach(() => {
    // 初始化 ChromeMetrics 以防止默认值加载失败时抛出异常
    try {
      ChromeMetrics.initialize({
        TextFont: '14px Arial',
        TextColor: '#FFFFFF',
        TextContrast: 'False',
        TextShadow: 'False',
        TextContrastColorDark: '#000000',
        TextContrastColorLight: '#AAAAAA',
        TextContrastRadius: '1',
      })
    } catch {
      // 可能已初始化
    }
  })

  afterEach(() => {
    ChromeMetrics.reset()
  })

  // ---------------------------------------------------------------------------
  // Construction & default values
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('creates with default values when no ChromeMetrics', () => {
      ChromeMetrics.reset()
      const label = new LabelWidget()
      expect(label.text).toBeNull()
      expect(label.align).toBe(TextAlign.Left)
      expect(label.vAlign).toBe(TextVAlign.Middle)
      expect(label.font).toBe('16px Arial')
      expect(label.textColor).toBe('#FFFFFF')
      expect(label.contrast).toBe(false)
      expect(label.shadow).toBe(false)
      expect(label.contrastColorDark).toBe('#000000')
      expect(label.contrastColorLight).toBe('#000000')
      expect(label.contrastRadius).toBe(1)
      expect(label.wordWrap).toBe(false)
    })

    it('loads defaults from ChromeMetrics when available', () => {
      ChromeMetrics.initialize({
        TextFont: '20px Sans',
        TextColor: '#FF0000',
        TextContrast: 'True',
        TextShadow: 'True',
        TextContrastColorDark: '#111111',
        TextContrastColorLight: '#EEEEEE',
        TextContrastRadius: '3',
      })
      const label = new LabelWidget()
      expect(label.font).toBe('20px Sans')
      expect(label.textColor).toBe('#FF0000')
      expect(label.contrast).toBe(true)
      expect(label.shadow).toBe(true)
      expect(label.contrastColorDark).toBe('#111111')
      expect(label.contrastColorLight).toBe('#EEEEEE')
      expect(label.contrastRadius).toBe(3)
    })

    it('sets up getText delegate with caching behavior', () => {
      const label = new LabelWidget()
      // getText returns null when text is null
      expect(label.getText()).toBeNull()

      // getText returns text when set
      label.text = 'Hello World'
      expect(label.getText()).toBe('Hello World')

      // getText returns empty string for empty text (Fluent behavior)
      label.text = ''
      expect(label.getText()).toBe('') // empty string via Fluent pass-through
    })

    it('sets up getColor delegate returning textColor', () => {
      const label = new LabelWidget()
      label.textColor = '#ABC123'
      expect(label.getColor()).toBe('#ABC123')
    })

    it('sets up contrast color delegates', () => {
      const label = new LabelWidget()
      label.contrastColorDark = '#222222'
      label.contrastColorLight = '#DDDDDD'
      expect(label.getContrastColorDark()).toBe('#222222')
      expect(label.getContrastColorLight()).toBe('#DDDDDD')
    })
  })

  // ---------------------------------------------------------------------------
  // Text rendering
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('renders text in a div element', () => {
      const label = new LabelWidget()
      label.text = 'Test Label'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.tagName.toLowerCase()).toBe('div')
      expect(el.textContent).toContain('Test Label')
    })

    it('renders empty content when text is null', () => {
      const label = new LabelWidget()
      label.text = null
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.textContent).toBe('')
    })

    it('applies text color via CSS color property', () => {
      const label = new LabelWidget()
      label.text = 'Colored'
      label.textColor = '#FF5500'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.color).toMatch(/#FF5500|rgb\(255,\s*85,\s*0\)/i)
    })

    it('applies font via CSS font property', () => {
      const label = new LabelWidget()
      label.text = 'Styled'
      label.font = 'bold 18px "Times New Roman"'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.font).toContain('18px')
    })

    it('uses getText delegate for dynamic text', () => {
      const label = new LabelWidget()
      let counter = 0
      label.getText = () => `Count: ${counter++}`
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el1 = label.render()
      expect(el1.textContent).toBe('Count: 0')

      const el2 = label.render()
      expect(el2.textContent).toBe('Count: 1')
    })

    it('uses getColor delegate for dynamic color', () => {
      const label = new LabelWidget()
      label.text = 'Dynamic'
      label.getColor = () => '#00FF00'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.color).toMatch(/#00FF00|rgb\(0,\s*255,\s*0\)/i)
    })
  })

  // ---------------------------------------------------------------------------
  // TextAlign (horizontal alignment)
  // ---------------------------------------------------------------------------

  describe('horizontal alignment', () => {
    it('renders with text-align: left for TextAlign.Left', () => {
      const label = new LabelWidget()
      label.text = 'Left'
      label.align = TextAlign.Left
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.textAlign).toBe('left')
    })

    it('renders with text-align: center for TextAlign.Center', () => {
      const label = new LabelWidget()
      label.text = 'Center'
      label.align = TextAlign.Center
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.textAlign).toBe('center')
    })

    it('renders with text-align: right for TextAlign.Right', () => {
      const label = new LabelWidget()
      label.text = 'Right'
      label.align = TextAlign.Right
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.textAlign).toBe('right')
    })
  })

  // ---------------------------------------------------------------------------
  // TextVAlign (vertical alignment)
  // ---------------------------------------------------------------------------

  describe('vertical alignment', () => {
    it('renders with align-items: flex-start for TextVAlign.Top', () => {
      const label = new LabelWidget()
      label.text = 'Top'
      label.vAlign = TextVAlign.Top
      label.bounds = { x: 0, y: 0, width: 200, height: 60 }

      const el = label.render()
      expect(el.style.display).toBe('flex')
      expect(el.style.alignItems).toBe('flex-start')
    })

    it('renders with align-items: center for TextVAlign.Middle', () => {
      const label = new LabelWidget()
      label.text = 'Middle'
      label.vAlign = TextVAlign.Middle
      label.bounds = { x: 0, y: 0, width: 200, height: 60 }

      const el = label.render()
      expect(el.style.display).toBe('flex')
      expect(el.style.alignItems).toBe('center')
    })

    it('renders with align-items: flex-end for TextVAlign.Bottom', () => {
      const label = new LabelWidget()
      label.text = 'Bottom'
      label.vAlign = TextVAlign.Bottom
      label.bounds = { x: 0, y: 0, width: 200, height: 60 }

      const el = label.render()
      expect(el.style.display).toBe('flex')
      expect(el.style.alignItems).toBe('flex-end')
    })
  })

  // ---------------------------------------------------------------------------
  // Text contrast / shadow effects
  // ---------------------------------------------------------------------------

  describe('text contrast (CSS text-shadow)', () => {
    it('renders no text-shadow when contrast and shadow are both false', () => {
      const label = new LabelWidget()
      label.text = 'Plain'
      label.contrast = false
      label.shadow = false
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.textShadow).toBe('none')
    })

    it('renders 4-corner shadow when contrast is true', () => {
      const label = new LabelWidget()
      label.text = 'Contrast'
      label.contrast = true
      label.shadow = false
      label.contrastColorDark = '#000000'
      label.contrastColorLight = '#FFFFFF'
      label.contrastRadius = 2
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      const shadow = el.style.textShadow
      // Should contain 4 comma-separated shadow values
      expect(shadow).toContain('#000000')
      expect(shadow).toContain('#FFFFFF')
      // Count commas — should have 3 (4 shadows)
      const commaCount = (shadow.match(/,/g) || []).length
      expect(commaCount).toBe(3) // 4 shadows = 3 commas
    })

    it('renders single offset shadow when shadow is true', () => {
      const label = new LabelWidget()
      label.text = 'Shadow'
      label.contrast = false
      label.shadow = true
      label.contrastColorDark = '#333333'
      label.contrastRadius = 1
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      const shadow = el.style.textShadow
      expect(shadow).toContain('#333333')
      // Should be a single shadow value (no comma or none -> single)
      expect(shadow).not.toBe('none')
    })

    it('contrast takes precedence over shadow when both are true', () => {
      const label = new LabelWidget()
      label.text = 'Both'
      label.contrast = true
      label.shadow = true
      label.contrastColorDark = '#000'
      label.contrastColorLight = '#FFF'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      const shadow = el.style.textShadow
      // Contrast produces 4 shadows (3 commas), shadow produces 1
      const commaCount = (shadow.match(/,/g) || []).length
      expect(commaCount).toBe(3) // 4 shadows = contrast mode
    })

    it('uses getContrastColorDark and getContrastColorLight delegates', () => {
      const label = new LabelWidget()
      label.text = 'Delegates'
      label.contrast = true
      label.getContrastColorDark = () => '#111111'
      label.getContrastColorLight = () => '#EEEEEE'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      const shadow = el.style.textShadow
      expect(shadow).toContain('#111111')
      expect(shadow).toContain('#EEEEEE')
    })
  })

  // ---------------------------------------------------------------------------
  // WordWrap
  // ---------------------------------------------------------------------------

  describe('word wrap', () => {
    it('sets white-space: pre and overflow: hidden when wordWrap is false', () => {
      const label = new LabelWidget()
      label.text = 'No wrap text here'
      label.wordWrap = false
      label.bounds = { x: 0, y: 0, width: 100, height: 30 }

      const el = label.render()
      expect(el.style.whiteSpace).toBe('pre')
      expect(el.style.overflow).toBe('hidden')
      expect(el.style.textOverflow).toBe('ellipsis')
    })

    it('allows word wrapping when wordWrap is true', () => {
      const label = new LabelWidget()
      label.text = 'A very long text that should wrap around the container bounds'
      label.wordWrap = true
      label.bounds = { x: 0, y: 0, width: 100, height: 100 }

      const el = label.render()
      expect(el.style.wordWrap).toBe('break-word')
      expect(el.style.overflowWrap).toBe('break-word')
      // With wordWrap, white-space should allow wrapping
      expect(el.style.whiteSpace).toBe('pre-wrap')
    })

    it('wraps text for IncreaseHeightToFitCurrentText calculation', () => {
      const label = new LabelWidget()
      label.text = 'Short text'
      label.wordWrap = true
      label.bounds = { x: 0, y: 0, width: 200, height: 20 }

      const before = label.bounds.height
      label.increaseHeightToFitCurrentText()
      // Height should be at least the original
      expect(label.bounds.height).toBeGreaterThanOrEqual(before)
    })
  })

  // ---------------------------------------------------------------------------
  // IncreaseHeightToFitCurrentText
  // ---------------------------------------------------------------------------

  describe('increaseHeightToFitCurrentText', () => {
    it('does nothing when text is null', () => {
      const label = new LabelWidget()
      label.text = null
      label.bounds = { x: 0, y: 0, width: 200, height: 20 }
      const originalHeight = label.bounds.height

      label.increaseHeightToFitCurrentText()
      expect(label.bounds.height).toBe(originalHeight)
    })

    it('increases height to fit text when text is taller than bounds', () => {
      const label = new LabelWidget()
      label.text = 'Line1\nLine2\nLine3'
      label.font = 'bold 18px Arial'
      label.bounds = { x: 0, y: 0, width: 400, height: 10 }

      label.increaseHeightToFitCurrentText()
      // Multi-line text should make height larger
      expect(label.bounds.height).toBeGreaterThan(10)
    })

    it('does not shrink height below current bounds height', () => {
      const label = new LabelWidget()
      label.text = 'Tiny'
      label.font = '12px Arial'
      label.bounds = { x: 0, y: 0, width: 400, height: 100 }

      label.increaseHeightToFitCurrentText()
      // Should keep the larger value
      expect(label.bounds.height).toBe(100)
    })

    it('wraps text before measuring when wordWrap is true', () => {
      const label = new LabelWidget()
      label.text =
        'This is a very long text string that should be wrapped to multiple lines'
      label.font = '16px monospace'
      label.wordWrap = true
      label.bounds = { x: 0, y: 0, width: 100, height: 10 }

      label.increaseHeightToFitCurrentText()
      // Wrapped text should produce greater height than unwrapped
      expect(label.bounds.height).toBeGreaterThan(10)
    })
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe('clone', () => {
    it('creates a copy with identical properties', () => {
      const label = new LabelWidget()
      label.id = 'test-label'
      label.text = 'Clone Me'
      label.align = TextAlign.Center
      label.vAlign = TextVAlign.Top
      label.font = 'italic 14px Verdana'
      label.textColor = '#123456'
      label.contrast = true
      label.shadow = false
      label.contrastColorDark = '#000'
      label.contrastColorLight = '#FFF'
      label.contrastRadius = 3
      label.wordWrap = true
      label.bounds = { x: 10, y: 20, width: 300, height: 50 }

      const cloned = label.clone()

      expect(cloned).toBeInstanceOf(LabelWidget)
      expect(cloned.id).toBe('test-label')
      expect(cloned.text).toBe('Clone Me')
      expect(cloned.align).toBe(TextAlign.Center)
      expect(cloned.vAlign).toBe(TextVAlign.Top)
      expect(cloned.font).toBe('italic 14px Verdana')
      expect(cloned.textColor).toBe('#123456')
      expect(cloned.contrast).toBe(true)
      expect(cloned.shadow).toBe(false)
      expect(cloned.contrastColorDark).toBe('#000')
      expect(cloned.contrastColorLight).toBe('#FFF')
      expect(cloned.contrastRadius).toBe(3)
      expect(cloned.wordWrap).toBe(true)
      expect(cloned.bounds.x).toBe(10)
      expect(cloned.bounds.y).toBe(20)
      expect(cloned.bounds.width).toBe(300)
      expect(cloned.bounds.height).toBe(50)
    })

    it('clone renders independently of original', () => {
      const label = new LabelWidget()
      label.text = 'Original'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const cloned = label.clone()
      cloned.text = 'Cloned'
      cloned.bounds = { x: 50, y: 50, width: 100, height: 20 }

      // Verify independence
      expect(label.text).toBe('Original')
      expect(cloned.text).toBe('Cloned')
      expect(label.bounds.x).toBe(0)
      expect(cloned.bounds.x).toBe(50)
    })

    it('clone copies delegate functions', () => {
      const label = new LabelWidget()
      let counter = 0
      label.getText = () => `Count: ${counter++}`

      const cloned = label.clone()
      // Both should use the same delegate (shared function reference)
      expect(cloned.getText()).toBe('Count: 0')
      expect(label.getText()).toBe('Count: 1')
      expect(cloned.getText()).toBe('Count: 2')
    })
  })

  // ---------------------------------------------------------------------------
  // GetCursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns null (labels do not change cursor)', () => {
      const label = new LabelWidget()
      const cursor = label.getCursor({ x: 0, y: 0 })
      expect(cursor).toBeNull()
    })

    it('returns null regardless of position', () => {
      const label = new LabelWidget()
      expect(label.getCursor({ x: 100, y: 100 })).toBeNull()
      expect(label.getCursor({ x: -1, y: -1 })).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Viewport integration
  // ---------------------------------------------------------------------------

  describe('viewport integration', () => {
    it('getOrCreateElement caches the DOM element', () => {
      const label = new LabelWidget()
      label.text = 'Cached'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el1 = label.render()
      const el2 = label.render()
      // Should return the same element
      expect(el1).toBe(el2)
    })

    it('each LabelWidget gets its own element', () => {
      const label1 = new LabelWidget()
      const label2 = new LabelWidget()
      label1.text = 'One'
      label2.text = 'Two'
      label1.bounds = { x: 0, y: 0, width: 100, height: 20 }
      label2.bounds = { x: 0, y: 0, width: 100, height: 20 }

      const el1 = label1.render()
      const el2 = label2.render()
      expect(el1).not.toBe(el2)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty string text', () => {
      const label = new LabelWidget()
      label.text = ''
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.textContent).toBe('')
    })

    it('handles very long text with word wrap', () => {
      const label = new LabelWidget()
      label.text = 'A'.repeat(1000)
      label.wordWrap = true
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      expect(el.style.wordWrap).toBe('break-word')
    })

    it('handles zero-size bounds gracefully', () => {
      const label = new LabelWidget()
      label.text = 'Zero'
      label.bounds = { x: 0, y: 0, width: 0, height: 0 }

      const el = label.render()
      expect(el).toBeDefined()
    })

    it('handles negative bounds on increaseHeightToFitCurrentText', () => {
      const label = new LabelWidget()
      label.text = 'Negative height test'
      label.bounds = { x: 0, y: 0, width: 200, height: -5 }

      // Should not throw
      expect(() => label.increaseHeightToFitCurrentText()).not.toThrow()
      // Height should be made positive by Math.max
      expect(label.bounds.height).toBeGreaterThanOrEqual(0)
    })

    it('supports custom font strings', () => {
      const label = new LabelWidget()
      label.text = 'Custom'
      label.font = 'italic small-caps bold 16px/2 cursive'
      label.bounds = { x: 0, y: 0, width: 200, height: 30 }

      const el = label.render()
      // font property should include at least the size
      expect(el.style.font).toContain('16px')
    })
  })
})
