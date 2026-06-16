/**
 * TextFieldWidget.test.ts — TextFieldWidget migration unit tests
 *
 * Tests focus on:
 * - Text get/set with and without delegate overrides
 * - Placeholder and MaxLength property access
 * - Type get/set with revalidation
 * - Cursor management (setCursorPosition, moveCursor, cursorToEnd/Start)
 * - Selection management (selectAll, clearSelection, hasSelection, getSelectedText)
 * - Text manipulation (insertText, deleteText)
 * - Validation (removeInvalidCharacters for Text, Integer, Float types)
 * - Callback invocation (onEnterKey, onEscapeKey, onTextEdited, onLoseFocus)
 * - Blink cycle management (tick, resetBlinkCycle)
 * - Disabled state handling
 * - Clone preserves all properties
 * - Dispose cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TextFieldWidget } from './TextFieldWidget.js'
import { TextFieldType } from './TextFieldType.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helper: create a WidgetEvent for callback testing
// ---------------------------------------------------------------------------

function makeWidgetEvent(overrides: Partial<WidgetEvent> = {}): WidgetEvent {
  return {
    type: 'keydown',
    key: 'Enter',
    stopPropagation: vi.fn(),
    target: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests: Construction & Defaults
// ---------------------------------------------------------------------------

describe('TextFieldWidget — construction and defaults', () => {
  it('creates with default values', () => {
    const w = new TextFieldWidget()
    expect(w.text).toBe('')
    expect(w.placeholder).toBe('')
    expect(w.maxLength).toBe(0)
    expect(w.type).toBe(TextFieldType.Text)
    expect(w.bordered).toBe(true)
    expect(w.cursorPosition).toBe(0)
    expect(w.hasSelection()).toBe(false)
    expect(w.selectionStart).toBe(-1)
    expect(w.selectionEnd).toBe(-1)
    expect(w.getSelectedText()).toBe('')
  })

  it('default values for callback properties are null', () => {
    const w = new TextFieldWidget()
    expect(w.onEnterKey).toBeNull()
    expect(w.onEscapeKey).toBeNull()
    expect(w.onTabKey).toBeNull()
    expect(w.onArrowUp).toBeNull()
    expect(w.onArrowDown).toBeNull()
    expect(w.onAltKey).toBeNull()
    expect(w.onLoseFocus).toBeNull()
    expect(w.onTextEdited).toBeNull()
    expect(w.isValid).toBeNull()
  })

  it('default values for delegate properties are null', () => {
    const w = new TextFieldWidget()
    expect(w.getText).toBeNull()
    expect(w.setText).toBeNull()
    expect(w.getMaxLength).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: Text Property
// ---------------------------------------------------------------------------

describe('TextFieldWidget — text property', () => {
  let w: TextFieldWidget

  beforeEach(() => {
    w = new TextFieldWidget()
  })

  it('get returns empty string by default', () => {
    expect(w.text).toBe('')
  })

  it('set updates text value', () => {
    w.text = 'hello'
    expect(w.text).toBe('hello')
  })

  it('set filters invalid characters based on type', () => {
    w.type = TextFieldType.Integer
    w.text = 'abc123def'
    expect(w.text).toBe('123')
  })

  it('set to empty string works', () => {
    w.text = 'hello'
    w.text = ''
    expect(w.text).toBe('')
  })

  it('set to null/undefined uses empty string', () => {
    w.text = null as unknown as string
    expect(w.text).toBe('')
    w.text = undefined as unknown as string
    expect(w.text).toBe('')
  })

  it('getText delegate overrides internal text', () => {
    w.text = 'internal'
    w.getText = () => 'external'
    expect(w.text).toBe('external')
  })

  it('setText delegate receives value on set', () => {
    let captured = ''
    w.setText = (v: string) => { captured = v }
    w.text = 'new-text'
    expect(captured).toBe('new-text')
    // Internal text should NOT be updated (delegate takes precedence)
    // Note: _text is protected, but we test behavior through the public API
  })

  it('setText delegate still filters invalid characters', () => {
    w.type = TextFieldType.Integer
    let captured = ''
    w.setText = (v: string) => { captured = v }
    w.text = 'abc123'
    expect(captured).toBe('123')
  })
})

// ---------------------------------------------------------------------------
// Tests: Placeholder
// ---------------------------------------------------------------------------

describe('TextFieldWidget — placeholder', () => {
  it('get returns empty string by default', () => {
    const w = new TextFieldWidget()
    expect(w.placeholder).toBe('')
  })

  it('set updates placeholder', () => {
    const w = new TextFieldWidget()
    w.placeholder = 'Enter text...'
    expect(w.placeholder).toBe('Enter text...')
  })
})

// ---------------------------------------------------------------------------
// Tests: MaxLength
// ---------------------------------------------------------------------------

describe('TextFieldWidget — maxLength', () => {
  it('default is 0 (unlimited)', () => {
    const w = new TextFieldWidget()
    expect(w.maxLength).toBe(0)
  })

  it('set updates maxLength', () => {
    const w = new TextFieldWidget()
    w.maxLength = 10
    expect(w.maxLength).toBe(10)
  })

  it('getMaxLength delegate overrides internal value', () => {
    const w = new TextFieldWidget()
    w.maxLength = 5
    w.getMaxLength = () => 20
    expect(w.maxLength).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Tests: Type Property
// ---------------------------------------------------------------------------

describe('TextFieldWidget — type property', () => {
  it('default is Text type', () => {
    const w = new TextFieldWidget()
    expect(w.type).toBe(TextFieldType.Text)
  })

  it('set type to Integer and back', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    expect(w.type).toBe(TextFieldType.Integer)
    w.type = TextFieldType.Text
    expect(w.type).toBe(TextFieldType.Text)
  })

  it('changing type re-validates existing text', () => {
    const w = new TextFieldWidget()
    w.text = 'abc123'
    w.type = TextFieldType.Integer
    expect(w.text).toBe('123')
  })

  it('changing type to Float preserves valid float text', () => {
    const w = new TextFieldWidget()
    w.text = '-3.14'
    w.type = TextFieldType.Float
    expect(w.text).toBe('-3.14')
  })

  it('changing type to Float filters invalid float chars', () => {
    const w = new TextFieldWidget()
    w.text = '-3.14abcxyz'
    w.type = TextFieldType.Float
    expect(w.text).toBe('-3.14')
  })
})

// ---------------------------------------------------------------------------
// Tests: RemoveInvalidCharacters
// ---------------------------------------------------------------------------

describe('TextFieldWidget — removeInvalidCharacters', () => {
  let w: TextFieldWidget

  beforeEach(() => {
    w = new TextFieldWidget()
  })

  describe('Text type (no filtering)', () => {
    it('passes through all characters', () => {
      w.type = TextFieldType.Text
      expect(w.removeInvalidCharacters('hello world 123!@#')).toBe('hello world 123!@#')
    })

    it('passes through empty string', () => {
      expect(w.removeInvalidCharacters('')).toBe('')
    })
  })

  describe('Integer type', () => {
    beforeEach(() => { w.type = TextFieldType.Integer })

    it('keeps only digits', () => {
      expect(w.removeInvalidCharacters('abc123def456')).toBe('123456')
    })

    it('keeps leading minus sign', () => {
      expect(w.removeInvalidCharacters('-123')).toBe('-123')
    })

    it('removes minus sign if not leading', () => {
      expect(w.removeInvalidCharacters('12-34')).toBe('1234')
    })

    it('returns empty for non-numeric input', () => {
      expect(w.removeInvalidCharacters('abc')).toBe('')
    })
  })

  describe('Float type', () => {
    beforeEach(() => { w.type = TextFieldType.Float })

    it('keeps digits and one decimal point', () => {
      expect(w.removeInvalidCharacters('3.14')).toBe('3.14')
    })

    it('keeps only first decimal point', () => {
      expect(w.removeInvalidCharacters('3.14.15')).toBe('3.1415')
    })

    it('keeps leading minus sign', () => {
      expect(w.removeInvalidCharacters('-3.14')).toBe('-3.14')
    })

    it('filters alphabetic characters', () => {
      expect(w.removeInvalidCharacters('abc3.14xyz')).toBe('3.14')
    })

    it('returns empty for non-numeric input', () => {
      expect(w.removeInvalidCharacters('abc')).toBe('')
    })

    it('keeps decimal point even without digits', () => {
      // Behavior: the filter keeps '.' but there's no extra validation
      expect(w.removeInvalidCharacters('.')).toBe('.')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: Cursor Management (with rendered input)
// ---------------------------------------------------------------------------

describe('TextFieldWidget — cursor management', () => {
  let w: TextFieldWidget

  beforeEach(() => {
    w = new TextFieldWidget()
    w.text = 'hello world'
    // render() creates the input element for cursor operations
    w.render()
  })

  it('cursorPosition starts at 0', () => {
    expect(w.cursorPosition).toBe(0)
  })

  it('setCursorPosition clamps to valid range', () => {
    w.setCursorPosition(5)
    expect(w.cursorPosition).toBe(5)
  })

  it('setCursorPosition clamps to 0 for negative', () => {
    w.setCursorPosition(-5)
    expect(w.cursorPosition).toBe(0)
  })

  it('setCursorPosition clamps to text length for overflow', () => {
    w.setCursorPosition(999)
    expect(w.cursorPosition).toBe(11) // "hello world" length
  })

  it('moveCursor moves forward', () => {
    w.setCursorPosition(3)
    w.moveCursor(2)
    expect(w.cursorPosition).toBe(5)
  })

  it('moveCursor moves backward', () => {
    w.setCursorPosition(5)
    w.moveCursor(-3)
    expect(w.cursorPosition).toBe(2)
  })

  it('cursorToEnd moves to text end', () => {
    w.cursorToEnd()
    expect(w.cursorPosition).toBe(11)
  })

  it('cursorToStart moves to text start', () => {
    w.setCursorPosition(5)
    w.cursorToStart()
    expect(w.cursorPosition).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Selection Management (with rendered input)
// ---------------------------------------------------------------------------

describe('TextFieldWidget — selection management', () => {
  let w: TextFieldWidget

  beforeEach(() => {
    w = new TextFieldWidget()
    w.text = 'hello world'
    w.render()
  })

  it('hasSelection returns false initially', () => {
    expect(w.hasSelection()).toBe(false)
  })

  it('selectionStart returns -1 initially', () => {
    expect(w.selectionStart).toBe(-1)
  })

  it('selectionEnd returns -1 initially', () => {
    expect(w.selectionEnd).toBe(-1)
  })

  it('getSelectedText returns empty string initially', () => {
    expect(w.getSelectedText()).toBe('')
  })

  it('selectAll selects entire text', () => {
    w.selectAll()
    expect(w.hasSelection()).toBe(true)
    expect(w.getSelectedText()).toBe('hello world')
  })

  it('clearSelection removes selection', () => {
    w.selectAll()
    w.clearSelection()
    expect(w.hasSelection()).toBe(false)
  })

  it('selectAll then clearSelection resets to no selection', () => {
    w.selectAll()
    expect(w.hasSelection()).toBe(true)
    w.clearSelection()
    expect(w.hasSelection()).toBe(false)
    expect(w.selectionStart).toBe(-1)
    expect(w.selectionEnd).toBe(-1)
  })

  it('getSelectedText returns correct substring', () => {
    w.setCursorPosition(0)
    // Simulate selection by setting range directly on input
    const input = w.inputElement!
    input.setSelectionRange(0, 5)
    expect(w.getSelectedText()).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// Tests: Text Manipulation (with rendered input)
// ---------------------------------------------------------------------------

describe('TextFieldWidget — text manipulation', () => {
  let w: TextFieldWidget

  beforeEach(() => {
    w = new TextFieldWidget()
    w.render()
  })

  describe('insertText', () => {
    it('inserts text at cursor position', () => {
      w.text = 'hello'
      w.setCursorPosition(5)
      w.insertText(' world')
      expect(w.text).toBe('hello world')
    })

    it('inserts text in the middle', () => {
      w.text = 'helworld'
      w.setCursorPosition(3)
      w.insertText('lo ')
      expect(w.text).toBe('hello world')
    })

    it('filters invalid characters during insert', () => {
      w.type = TextFieldType.Integer
      w.text = '123'
      w.setCursorPosition(3)
      w.insertText('abc456')
      expect(w.text).toBe('123456')
    })

    it('enforces maxLength during insert', () => {
      w.maxLength = 5
      w.text = 'hi'
      w.setCursorPosition(2)
      w.insertText(' world')
      expect(w.text).toBe('hi wo')
    })

    it('inserting empty string does nothing', () => {
      w.text = 'hello'
      w.insertText('')
      expect(w.text).toBe('hello')
    })

    it('replaces selected text on insert', () => {
      w.text = 'hello world'
      w.setCursorPosition(0)
      const input = w.inputElement!
      input.setSelectionRange(0, 6) // select "hello "
      w.insertText('Hi ')
      expect(w.text).toBe('Hi world')
    })
  })

  describe('deleteText', () => {
    it('deleteText(-1) backspaces before cursor', () => {
      w.text = 'hello'
      w.setCursorPosition(5)
      w.deleteText(-1)
      expect(w.text).toBe('hell')
    })

    it('deleteText(1) deletes after cursor', () => {
      w.text = 'hello'
      w.setCursorPosition(0)
      w.deleteText(1)
      expect(w.text).toBe('ello')
    })

    it('deleteText(-1) at position 0 does nothing', () => {
      w.text = 'hello'
      w.setCursorPosition(0)
      w.deleteText(-1)
      expect(w.text).toBe('hello')
    })

    it('deleteText(1) at end does nothing', () => {
      w.text = 'hello'
      w.setCursorPosition(5)
      w.deleteText(1)
      expect(w.text).toBe('hello')
    })

    it('deleteText deletes selected text instead', () => {
      w.text = 'hello world'
      const input = w.inputElement!
      input.setSelectionRange(0, 6) // select "hello "
      w.deleteText(1) // direction doesn't matter when selection exists
      expect(w.text).toBe('world')
    })
  })

  describe('deleteSelectedText', () => {
    it('deletes selected text', () => {
      w.text = 'hello world'
      const input = w.inputElement!
      input.setSelectionRange(0, 6) // select "hello "
      w.deleteSelectedText()
      expect(w.text).toBe('world')
      expect(w.hasSelection()).toBe(false)
      expect(w.cursorPosition).toBe(0)
    })

    it('does nothing when no selection', () => {
      w.text = 'hello'
      w.deleteSelectedText()
      expect(w.text).toBe('hello')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: Callbacks
// ---------------------------------------------------------------------------

describe('TextFieldWidget — callbacks', () => {
  let w: TextFieldWidget

  beforeEach(() => {
    w = new TextFieldWidget()
    w.render()
  })

  it('onTextEdited is NOT called on programmatic text set (C# behavior)', () => {
    // NOTE: OpenRA C# Text property setter does NOT call OnTextEdited()
    // OnTextEdited is only triggered by user interactions (typing, delete, paste)
    const edited = vi.fn()
    w.onTextEdited = edited
    w.text = 'new text'
    expect(edited).not.toHaveBeenCalled()
  })

  it('onTextEdited is called after insertText', () => {
    const edited = vi.fn()
    w.onTextEdited = edited
    w.insertText('hello')
    expect(edited).toHaveBeenCalledTimes(1)
  })

  it('onTextEdited is called after deleteText', () => {
    w.text = 'hello'
    const edited = vi.fn()
    w.onTextEdited = edited
    w.deleteText(-1)
    expect(edited).toHaveBeenCalledTimes(1)
  })

  it('onTextEdited is called after deleteSelectedText', () => {
    w.text = 'hello'
    const input = w.inputElement!
    input.setSelectionRange(0, 3)
    const edited = vi.fn()
    w.onTextEdited = edited
    w.deleteSelectedText()
    expect(edited).toHaveBeenCalledTimes(1)
  })

  it('onEnterKey is called on Enter key event', () => {
    const handler = vi.fn().mockReturnValue(true)
    w.onEnterKey = handler
    const ev = makeWidgetEvent({ key: 'Enter' })
    const result = w.onEnterKey!(ev)
    expect(result).toBe(true)
    expect(handler).toHaveBeenCalledWith(ev)
  })

  it('onEscapeKey is called on Escape key event', () => {
    const handler = vi.fn().mockReturnValue(false)
    w.onEscapeKey = handler
    const ev = makeWidgetEvent({ key: 'Escape' })
    const result = w.onEscapeKey!(ev)
    expect(result).toBe(false)
    expect(handler).toHaveBeenCalledWith(ev)
  })
})

// ---------------------------------------------------------------------------
// Tests: Text Validation Filters (edge cases)
// ---------------------------------------------------------------------------

describe('TextFieldWidget — validation edge cases', () => {
  it('Integer: allows empty string', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    expect(w.removeInvalidCharacters('')).toBe('')
  })

  it('Integer: allows just minus sign (no digits)', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    // "-" alone is allowed by the filter (min/max validation is separate)
    expect(w.removeInvalidCharacters('-')).toBe('-')
  })

  it('Integer: only first char can be minus', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    expect(w.removeInvalidCharacters('1-2-3')).toBe('123')
  })

  it('Float: multiple decimal points filtered', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Float
    expect(w.removeInvalidCharacters('1.2.3.4')).toBe('1.234')
  })

  it('Float: minus allowed only at start', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Float
    expect(w.removeInvalidCharacters('1-2.3')).toBe('12.3')
  })
})

// ---------------------------------------------------------------------------
// Tests: Input Type Propagation to DOM
// ---------------------------------------------------------------------------

describe('TextFieldWidget — DOM input type', () => {
  it('Text type creates text input', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Text
    w.render()
    expect(w.inputElement!.type).toBe('text')
  })

  it('Integer type creates text input', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    w.render()
    expect(w.inputElement!.type).toBe('text')
  })

  it('Float type creates text input', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Float
    w.render()
    expect(w.inputElement!.type).toBe('text')
  })

  it('Password type creates password input', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Password
    w.render()
    expect(w.inputElement!.type).toBe('password')
  })
})

// ---------------------------------------------------------------------------
// Tests: Input Value Sync on Render
// ---------------------------------------------------------------------------

describe('TextFieldWidget — input value sync', () => {
  it('render syncs input value to text', () => {
    const w = new TextFieldWidget()
    w.text = 'initial'
    w.render()
    expect(w.inputElement!.value).toBe('initial')
  })

  it('render updates input value when text changed externally', () => {
    const w = new TextFieldWidget()
    w.text = 'first'
    w.render()
    w.text = 'second'
    w.render()
    expect(w.inputElement!.value).toBe('second')
  })

  it('render uses getText delegate if set', () => {
    const w = new TextFieldWidget()
    w.text = 'internal'
    w.getText = () => 'external'
    w.render()
    expect(w.inputElement!.value).toBe('external')
  })
})

// ---------------------------------------------------------------------------
// Tests: MaxLength on DOM Input
// ---------------------------------------------------------------------------

describe('TextFieldWidget — maxLength DOM sync', () => {
  it('maxLength 0 does not set maxLength attribute', () => {
    const w = new TextFieldWidget()
    w.maxLength = 0
    w.render()
    expect(w.inputElement!.maxLength).toBe(-1)
  })

  it('maxLength > 0 sets maxLength attribute', () => {
    const w = new TextFieldWidget()
    w.maxLength = 10
    w.render()
    expect(w.inputElement!.maxLength).toBe(10)
  })

  it('setting maxLength after render updates input', () => {
    const w = new TextFieldWidget()
    w.render()
    w.maxLength = 5
    expect(w.inputElement!.maxLength).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Tests: Placeholder on DOM Input
// ---------------------------------------------------------------------------

describe('TextFieldWidget — placeholder DOM sync', () => {
  it('placeholder set before render applied to input', () => {
    const w = new TextFieldWidget()
    w.placeholder = 'type here...'
    w.render()
    expect(w.inputElement!.placeholder).toBe('type here...')
  })

  it('placeholder set after render updates input', () => {
    const w = new TextFieldWidget()
    w.render()
    w.placeholder = 'updated'
    expect(w.inputElement!.placeholder).toBe('updated')
  })
})

// ---------------------------------------------------------------------------
// Tests: Blink Cycle
// ---------------------------------------------------------------------------

describe('TextFieldWidget — blink cycle', () => {
  it('blinkCycle starts at 10', () => {
    const w = new TextFieldWidget()
    // blinkCycle is protected, access via (w as any) or just test tick behavior
    w.render()
    // After 10 ticks, showCursor should toggle
    for (let i = 0; i < 10; i++) {
      w.tick()
    }
    // After exactly 10 ticks, cycle hits 0 and toggles, then resets to 20
    // showCursor starts true, toggles to false
    expect((w as any).showCursor).toBe(false)
    expect((w as any).blinkCycle).toBe(20)
  })

  it('resetBlinkCycle restores showCursor', () => {
    const w = new TextFieldWidget()
    w.render()
    // Force showCursor to false by ticking through
    for (let i = 0; i < 10; i++) { w.tick() }
    expect((w as any).showCursor).toBe(false)
    // Reset
    ;(w as any).resetBlinkCycle()
    expect((w as any).showCursor).toBe(true)
    expect((w as any).blinkCycle).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Tests: Disabled State
// ---------------------------------------------------------------------------

describe('TextFieldWidget — disabled state', () => {
  it('disabled defaults to false', () => {
    const w = new TextFieldWidget()
    expect(w.disabled).toBe(false)
    expect(w.isDisabled()).toBe(false)
  })

  it('disabled set to true disables input', () => {
    const w = new TextFieldWidget()
    w.render()
    w.disabled = true
    w.render()
    expect(w.inputElement!.disabled).toBe(true)
  })

  it('isDisabled returns true when disabled', () => {
    const w = new TextFieldWidget()
    w.disabled = true
    expect(w.isDisabled()).toBe(true)
  })

  it('setting disabled via isDisabled delegate', () => {
    const w = new TextFieldWidget()
    w.isDisabled = () => true
    expect(w.isDisabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: Bordered Property
// ---------------------------------------------------------------------------

describe('TextFieldWidget — bordered property', () => {
  it('defaults to true', () => {
    const w = new TextFieldWidget()
    expect(w.bordered).toBe(true)
  })

  it('can be set to false', () => {
    const w = new TextFieldWidget()
    w.bordered = false
    expect(w.bordered).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: Margin Properties
// ---------------------------------------------------------------------------

describe('TextFieldWidget — margin properties', () => {
  it('leftMargin defaults to 5', () => {
    const w = new TextFieldWidget()
    expect(w.leftMargin).toBe(5)
  })

  it('rightMargin defaults to 5', () => {
    const w = new TextFieldWidget()
    expect(w.rightMargin).toBe(5)
  })

  it('visualHeight defaults to 1', () => {
    const w = new TextFieldWidget()
    expect(w.visualHeight).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: Font and Color Properties
// ---------------------------------------------------------------------------

describe('TextFieldWidget — font and color properties', () => {
  it('font defaults to empty string', () => {
    const w = new TextFieldWidget()
    expect(w.font).toBe('')
  })

  it('textColor defaults to white', () => {
    const w = new TextFieldWidget()
    expect(w.textColor).toBe('#ffffff')
  })

  it('textColorDisabled defaults to gray', () => {
    const w = new TextFieldWidget()
    expect(w.textColorDisabled).toBe('#888888')
  })

  it('textColorInvalid defaults to red', () => {
    const w = new TextFieldWidget()
    expect(w.textColorInvalid).toBe('#ff4444')
  })

  it('textColorHighlight defaults to blue', () => {
    const w = new TextFieldWidget()
    expect(w.textColorHighlight).toBe('#4040ff')
  })

  it('caretColor defaults to white', () => {
    const w = new TextFieldWidget()
    expect(w.caretColor).toBe('#ffffff')
  })

  it('caretFlashInterval defaults to 500ms', () => {
    const w = new TextFieldWidget()
    expect(w.caretFlashInterval).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('TextFieldWidget — clone', () => {
  it('clone creates a TextFieldWidget', () => {
    const w = new TextFieldWidget()
    const c = w.clone()
    expect(c).toBeInstanceOf(TextFieldWidget)
  })

  it('clone copies text', () => {
    const w = new TextFieldWidget()
    w.text = 'original text'
    const c = w.clone()
    expect(c.text).toBe('original text')
  })

  it('clone copies maxLength', () => {
    const w = new TextFieldWidget()
    w.maxLength = 20
    const c = w.clone()
    expect(c.maxLength).toBe(20)
  })

  it('clone copies type', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    const c = w.clone()
    expect(c.type).toBe(TextFieldType.Integer)
  })

  it('clone copies visual properties', () => {
    const w = new TextFieldWidget()
    w.font = 'Arial'
    w.textColor = '#ff0000'
    w.textColorDisabled = '#333333'
    w.textColorInvalid = '#ffff00'
    w.textColorHighlight = '#00ff00'
    w.visualHeight = 2
    w.bordered = false
    w.caretColor = '#ff0000'
    w.caretFlashInterval = 1000
    const c = w.clone()
    expect(c.font).toBe('Arial')
    expect(c.textColor).toBe('#ff0000')
    expect(c.textColorDisabled).toBe('#333333')
    expect(c.textColorInvalid).toBe('#ffff00')
    expect(c.textColorHighlight).toBe('#00ff00')
    expect(c.visualHeight).toBe(2)
    expect(c.bordered).toBe(false)
    expect(c.caretColor).toBe('#ff0000')
    expect(c.caretFlashInterval).toBe(1000)
  })

  it('clone copies margins', () => {
    const w = new TextFieldWidget()
    w.leftMargin = 10
    w.rightMargin = 20
    const c = w.clone()
    expect(c.leftMargin).toBe(10)
    expect(c.rightMargin).toBe(20)
  })

  it('clone copies callbacks', () => {
    const w = new TextFieldWidget()
    const enterFn = vi.fn()
    const escapeFn = vi.fn()
    w.onEnterKey = enterFn
    w.onEscapeKey = escapeFn
    const c = w.clone()
    expect(c.onEnterKey).toBe(enterFn)
    expect(c.onEscapeKey).toBe(escapeFn)
  })

  it('clone copies delegates', () => {
    const w = new TextFieldWidget()
    const getFn = () => 'delegate-text'
    const setFn = vi.fn()
    w.getText = getFn
    w.setText = setFn
    const c = w.clone()
    expect(c.getText).toBe(getFn)
    expect(c.setText).toBe(setFn)
  })

  it('clone copies disabled state', () => {
    const w = new TextFieldWidget()
    w.disabled = true
    const c = w.clone()
    expect(c.disabled).toBe(true)
  })

  it('clone creates independent instance', () => {
    const w = new TextFieldWidget()
    w.text = 'original'
    w.render()
    const c = w.clone()
    c.text = 'modified'
    expect(w.text).toBe('original')
    expect(c.text).toBe('modified')
  })
})

// ---------------------------------------------------------------------------
// Tests: Dispose
// ---------------------------------------------------------------------------

describe('TextFieldWidget — dispose', () => {
  it('dispose clears input element reference', () => {
    const w = new TextFieldWidget()
    w.render()
    expect(w.inputElement).not.toBeNull()
    w.dispose()
    expect(w.inputElement).toBeNull()
    expect(w.containerElement).toBeNull()
  })

  it('double dispose is safe', () => {
    const w = new TextFieldWidget()
    w.render()
    w.dispose()
    w.dispose() // should not throw
    expect(w.inputElement).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: handleEvent (widget framework integration)
// ---------------------------------------------------------------------------

describe('TextFieldWidget — handleEvent', () => {
  it('returns false when disabled', () => {
    const w = new TextFieldWidget()
    w.disabled = true
    const ev = makeWidgetEvent({ type: 'textinput', text: 'test' })
    expect(w.handleEvent(ev)).toBe(false)
  })

  it('returns false for non-textinput events', () => {
    const w = new TextFieldWidget()
    const ev = makeWidgetEvent({ type: 'mousedown' })
    expect(w.handleEvent(ev)).toBe(false)
  })

  it('accepts textinput events when focused', () => {
    const w = new TextFieldWidget()
    w.render()
    w.takeKeyboardFocus()
    const ev = makeWidgetEvent({ type: 'textinput', text: 'abc' })
    expect(w.handleEvent(ev)).toBe(true)
    expect(w.text).toBe('abc')
  })

  it('ignores textinput events when not focused', () => {
    const w = new TextFieldWidget()
    w.render()
    // Yield focus first
    w.yieldKeyboardFocus()
    const ev = makeWidgetEvent({ type: 'textinput', text: 'abc' })
    expect(w.handleEvent(ev)).toBe(false)
    expect(w.text).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Tests: Input Event Handler (DOM simulation)
// ---------------------------------------------------------------------------

describe('TextFieldWidget — DOM input event', () => {
  it('input event updates internal text', () => {
    const w = new TextFieldWidget()
    w.render()
    const input = w.inputElement!
    input.value = 'typed text'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(w.text).toBe('typed text')
  })

  it('input event filters invalid characters', () => {
    const w = new TextFieldWidget()
    w.type = TextFieldType.Integer
    w.render()
    const input = w.inputElement!
    input.value = 'abc123'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(w.text).toBe('123')
    expect(input.value).toBe('123') // input value is corrected
  })

  it('input event triggers onTextEdited', () => {
    const w = new TextFieldWidget()
    w.render()
    const edited = vi.fn()
    w.onTextEdited = edited
    const input = w.inputElement!
    input.value = 'new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(edited).toHaveBeenCalledTimes(1)
  })

  it('input event uses setText delegate if set', () => {
    const w = new TextFieldWidget()
    let captured = ''
    w.setText = (v: string) => { captured = v }
    w.render()
    const input = w.inputElement!
    input.value = 'delegated'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(captured).toBe('delegated')
  })
})

// ---------------------------------------------------------------------------
// Tests: Focus Management
// ---------------------------------------------------------------------------

describe('TextFieldWidget — focus management', () => {
  it('takeKeyboardFocus sets Widget focus', () => {
    const w = new TextFieldWidget()
    w.render()
    expect(w.takeKeyboardFocus()).toBe(true)
    expect(w.hasKeyboardFocus).toBe(true)
  })

  it('yieldKeyboardFocus releases Widget focus', () => {
    const w = new TextFieldWidget()
    w.render()
    w.takeKeyboardFocus()
    expect(w.yieldKeyboardFocus()).toBe(true)
    expect(w.hasKeyboardFocus).toBe(false)
  })

  it('yieldKeyboardFocus calls onLoseFocus', () => {
    const w = new TextFieldWidget()
    w.render()
    const lostFocus = vi.fn()
    w.onLoseFocus = lostFocus
    w.takeKeyboardFocus()
    w.yieldKeyboardFocus()
    expect(lostFocus).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: Container Element
// ---------------------------------------------------------------------------

describe('TextFieldWidget — container element', () => {
  it('render creates container element', () => {
    const w = new TextFieldWidget()
    w.render()
    expect(w.containerElement).not.toBeNull()
    expect(w.containerElement!.tagName).toBe('DIV')
    expect(w.containerElement!.className).toBe('textfield-widget')
  })

  it('container contains input element', () => {
    const w = new TextFieldWidget()
    w.render()
    expect(w.containerElement!.contains(w.inputElement!)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: selectionToEnd
// ---------------------------------------------------------------------------

describe('TextFieldWidget — selectionToEnd', () => {
  it('extends selection from cursor to end', () => {
    const w = new TextFieldWidget()
    w.text = 'hello world'
    w.render()
    w.setCursorPosition(3)
    w.selectionToEnd()
    expect(w.getSelectedText()).toBe('lo world')
  })
})
