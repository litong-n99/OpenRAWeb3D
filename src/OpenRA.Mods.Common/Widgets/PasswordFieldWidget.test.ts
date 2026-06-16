/**
 * PasswordFieldWidget.test.ts — PasswordFieldWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and type initialization
 * - Text storage in plaintext (value not masked)
 * - Inheritance from TextFieldWidget (cursor, selection, validation)
 * - Clone creates PasswordFieldWidget instance
 * - Visual masking via input type="password"
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PasswordFieldWidget } from './PasswordFieldWidget.js'
import { TextFieldWidget } from './TextFieldWidget.js'
import { TextFieldType } from './TextFieldType.js'

// ---------------------------------------------------------------------------
// Tests: Construction & Type
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — construction', () => {
  it('extends TextFieldWidget', () => {
    const w = new PasswordFieldWidget()
    expect(w).toBeInstanceOf(TextFieldWidget)
    expect(w).toBeInstanceOf(PasswordFieldWidget)
  })

  it('initializes type to Password', () => {
    const w = new PasswordFieldWidget()
    expect(w.type).toBe(TextFieldType.Password)
  })

  it('initializes with empty text', () => {
    const w = new PasswordFieldWidget()
    expect(w.text).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Tests: Text Storage (Plaintext)
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — text storage', () => {
  let w: PasswordFieldWidget

  beforeEach(() => {
    w = new PasswordFieldWidget()
  })

  it('stores text in plaintext', () => {
    w.text = 'mySecret123'
    expect(w.text).toBe('mySecret123')
  })

  it('text is NOT masked in internal storage', () => {
    w.text = 'password'
    // The text property returns the actual value, not asterisks
    expect(w.text).toBe('password')
    // It should NOT be '********'
    expect(w.text).not.toBe('********')
  })

  it('getText delegate still accesses plaintext', () => {
    w.getText = () => 'delegatePassword'
    expect(w.text).toBe('delegatePassword')
  })

  it('setText delegate receives plaintext', () => {
    let captured = ''
    w.setText = (v: string) => { captured = v }
    w.text = 'newPassword'
    expect(captured).toBe('newPassword')
  })
})

// ---------------------------------------------------------------------------
// Tests: Visual Masking via DOM
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — visual masking', () => {
  it('renders with input type password', () => {
    const w = new PasswordFieldWidget()
    w.render()
    expect(w.inputElement).not.toBeNull()
    expect(w.inputElement!.type).toBe('password')
  })

  it('input value is plaintext', () => {
    const w = new PasswordFieldWidget()
    w.text = 'secret123'
    w.render()
    // The HTML input type="password" visually masks but value is plaintext
    expect(w.inputElement!.value).toBe('secret123')
  })

  it('password type persists after re-render', () => {
    const w = new PasswordFieldWidget()
    w.render()
    expect(w.inputElement!.type).toBe('password')
    w.text = 'another'
    w.render()
    expect(w.inputElement!.type).toBe('password')
  })
})

// ---------------------------------------------------------------------------
// Tests: Inherited Functionality
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — inherited from TextFieldWidget', () => {
  let w: PasswordFieldWidget

  beforeEach(() => {
    w = new PasswordFieldWidget()
    w.render()
  })

  it('supports cursor positioning', () => {
    w.text = 'hello'
    w.setCursorPosition(3)
    expect(w.cursorPosition).toBe(3)
  })

  it('supports selectAll', () => {
    w.text = 'hello world'
    w.selectAll()
    expect(w.hasSelection()).toBe(true)
    expect(w.getSelectedText()).toBe('hello world')
  })

  it('supports insertText', () => {
    w.text = 'hello'
    w.setCursorPosition(5)
    w.insertText('!')
    expect(w.text).toBe('hello!')
  })

  it('supports deleteText', () => {
    w.text = 'hello'
    w.setCursorPosition(5)
    w.deleteText(-1)
    expect(w.text).toBe('hell')
  })

  it('supports maxLength enforcement', () => {
    w.maxLength = 3
    w.text = 'ab'
    w.setCursorPosition(2)
    w.insertText('cdef')
    expect(w.text).toBe('abc')
  })

  it('supports callbacks (onTextEdited via insertText)', () => {
    // NOTE: OpenRA C# Text property setter does NOT call OnTextEdited()
    // Callbacks fire on user interaction methods like insertText
    const edited = vi.fn()
    w.onTextEdited = edited
    w.insertText('new value')
    expect(edited).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: Password Type Validation
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — validation', () => {
  it('Password type allows all characters (no filtering)', () => {
    const w = new PasswordFieldWidget()
    expect(w.removeInvalidCharacters('abc123!@#$%^&*()')).toBe('abc123!@#$%^&*()')
  })

  it('Password type allows spaces', () => {
    const w = new PasswordFieldWidget()
    expect(w.removeInvalidCharacters('my password with spaces')).toBe('my password with spaces')
  })

  it('Password type allows empty string', () => {
    const w = new PasswordFieldWidget()
    expect(w.removeInvalidCharacters('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — clone', () => {
  it('clone creates a PasswordFieldWidget', () => {
    const w = new PasswordFieldWidget()
    const c = w.clone()
    expect(c).toBeInstanceOf(PasswordFieldWidget)
    expect(c).toBeInstanceOf(TextFieldWidget)
  })

  it('clone preserves text', () => {
    const w = new PasswordFieldWidget()
    w.text = 'secretValue'
    const c = w.clone()
    expect(c.text).toBe('secretValue')
  })

  it('clone preserves type as Password', () => {
    const w = new PasswordFieldWidget()
    w.text = 'something'
    const c = w.clone()
    expect(c.type).toBe(TextFieldType.Password)
  })

  it('clone preserves visual properties', () => {
    const w = new PasswordFieldWidget()
    w.font = 'monospace'
    w.bordered = false
    w.caretColor = '#ff0000'
    const c = w.clone()
    expect(c.font).toBe('monospace')
    expect(c.bordered).toBe(false)
    expect(c.caretColor).toBe('#ff0000')
  })

  it('clone preserves callbacks', () => {
    const w = new PasswordFieldWidget()
    const enterFn = vi.fn()
    w.onEnterKey = enterFn
    const c = w.clone()
    expect(c.onEnterKey).toBe(enterFn)
  })

  it('clone preserves delegates', () => {
    const w = new PasswordFieldWidget()
    const getFn = () => 'ext'
    const setFn = vi.fn()
    w.getText = getFn
    w.setText = setFn
    const c = w.clone()
    expect(c.getText).toBe(getFn)
    expect(c.setText).toBe(setFn)
  })

  it('clone preserves maxLength', () => {
    const w = new PasswordFieldWidget()
    w.maxLength = 32
    const c = w.clone()
    expect(c.maxLength).toBe(32)
  })

  it('clone preserves disabled state', () => {
    const w = new PasswordFieldWidget()
    w.disabled = true
    const c = w.clone()
    expect(c.disabled).toBe(true)
  })

  it('clone creates independent instance', () => {
    const w = new PasswordFieldWidget()
    w.text = 'original'
    const c = w.clone()
    c.text = 'modified'
    expect(w.text).toBe('original')
    expect(c.text).toBe('modified')
  })
})

// ---------------------------------------------------------------------------
// Tests: Placeholder
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — placeholder', () => {
  it('placeholder can be set and retrieved', () => {
    const w = new PasswordFieldWidget()
    w.placeholder = 'Enter password'
    expect(w.placeholder).toBe('Enter password')
  })

  it('placeholder applied to input element', () => {
    const w = new PasswordFieldWidget()
    w.placeholder = 'Password...'
    w.render()
    expect(w.inputElement!.placeholder).toBe('Password...')
  })
})

// ---------------------------------------------------------------------------
// Tests: Disabled State
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — disabled state', () => {
  it('disabled set to true disables input', () => {
    const w = new PasswordFieldWidget()
    w.render()
    w.disabled = true
    w.render()
    expect(w.inputElement!.disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: Dispose
// ---------------------------------------------------------------------------

describe('PasswordFieldWidget — dispose', () => {
  it('dispose clears DOM references', () => {
    const w = new PasswordFieldWidget()
    w.render()
    expect(w.inputElement).not.toBeNull()
    w.dispose()
    expect(w.inputElement).toBeNull()
  })
})
