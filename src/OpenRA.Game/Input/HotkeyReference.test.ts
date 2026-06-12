/**
 * HotkeyReference.test.ts — HotkeyReference + Hotkey migration unit tests
 *
 * Tests focus on: Hotkey construction, validation, parsing, equality,
 * display strings; HotkeyReference construction, getValue, isActivatedBy.
 * No WebGL dependency — all logic is pure TypeScript.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Need real KeyCode module (no WebGL, so no need to mock)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { HotkeyReference, Hotkey, modsDisplayString, modsHasModifier } from './HotkeyReference'
import { KeyCode } from './Keycode'
import { Modifiers } from './IInputHandler'
import type { KeyInput } from './IInputHandler'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Locally defined to avoid import type issue with const object */
const KIE_Down = 0 as KeyInput['event']
const KIE_Up = 1 as KeyInput['event']

function makeKeyInput(
  key: number,
  modifiers: number = Modifiers.None,
  event: KeyInput['event'] = KIE_Down,
): KeyInput {
  return {
    event,
    key,
    modifiers,
    multiTapCount: 0,
    unicodeChar: '',
    isRepeat: false,
  }
}

// ---------------------------------------------------------------------------
// ModifiersExts
// ---------------------------------------------------------------------------

describe('modsDisplayString', () => {
  it('returns empty string for None', () => {
    expect(modsDisplayString(Modifiers.None)).toBe('')
  })

  it('returns single modifier names', () => {
    expect(modsDisplayString(Modifiers.Shift)).toBe('Shift')
    expect(modsDisplayString(Modifiers.Alt)).toBe('Alt')
    expect(modsDisplayString(Modifiers.Ctrl)).toBe('Ctrl')
    expect(modsDisplayString(Modifiers.Meta)).toBe('Meta')
  })

  it('returns combined modifier names', () => {
    const combined = Modifiers.Shift | Modifiers.Ctrl
    expect(modsDisplayString(combined)).toBe('Shift + Ctrl')
  })

  it('handles all modifiers combined', () => {
    const all = Modifiers.Shift | Modifiers.Alt | Modifiers.Ctrl | Modifiers.Meta
    const result = modsDisplayString(all)
    expect(result).toContain('Shift')
    expect(result).toContain('Alt')
    expect(result).toContain('Ctrl')
    expect(result).toContain('Meta')
  })
})

describe('modsHasModifier', () => {
  it('returns true when modifier is present', () => {
    expect(modsHasModifier(Modifiers.Shift | Modifiers.Ctrl, Modifiers.Shift)).toBe(true)
    expect(modsHasModifier(Modifiers.Shift | Modifiers.Ctrl, Modifiers.Ctrl)).toBe(true)
  })

  it('returns false when modifier is absent', () => {
    expect(modsHasModifier(Modifiers.Shift, Modifiers.Alt)).toBe(false)
    expect(modsHasModifier(Modifiers.None, Modifiers.Shift)).toBe(false)
  })

  it('returns true for None in None', () => {
    expect(modsHasModifier(Modifiers.None, Modifiers.None)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Hotkey
// ---------------------------------------------------------------------------

describe('Hotkey', () => {
  describe('static Invalid', () => {
    it('has key UNKNOWN and modifiers None', () => {
      const invalid = Hotkey.Invalid
      expect(invalid.key).toBe(KeyCode.UNKNOWN)
      expect(invalid.modifiers).toBe(Modifiers.None)
    })

    it('isValid returns false', () => {
      expect(Hotkey.Invalid.isValid()).toBe(false)
    })
  })

  describe('construction', () => {
    it('stores key and modifiers', () => {
      const hotkey = new Hotkey(KeyCode.A, Modifiers.Ctrl)
      expect(hotkey.key).toBe(KeyCode.A)
      expect(hotkey.modifiers).toBe(Modifiers.Ctrl)
    })

    it('creates valid hotkey for known key', () => {
      const hotkey = new Hotkey(KeyCode.RETURN, Modifiers.None)
      expect(hotkey.isValid()).toBe(true)
    })
  })

  describe('isValid', () => {
    it('returns false when key is UNKNOWN', () => {
      const hotkey = new Hotkey(KeyCode.UNKNOWN, Modifiers.Ctrl)
      expect(hotkey.isValid()).toBe(false)
    })

    it('returns true when key is valid known key', () => {
      const hotkey = new Hotkey(KeyCode.ESCAPE, Modifiers.None)
      expect(hotkey.isValid()).toBe(true)
    })
  })

  describe('equals', () => {
    it('returns true for equal hotkeys', () => {
      const a = new Hotkey(KeyCode.A, Modifiers.None)
      const b = new Hotkey(KeyCode.A, Modifiers.None)
      expect(a.equals(b)).toBe(true)
    })

    it('returns false for different keys', () => {
      const a = new Hotkey(KeyCode.A, Modifiers.None)
      const b = new Hotkey(KeyCode.B, Modifiers.None)
      expect(a.equals(b)).toBe(false)
    })

    it('returns false for different modifiers', () => {
      const a = new Hotkey(KeyCode.A, Modifiers.None)
      const b = new Hotkey(KeyCode.A, Modifiers.Ctrl)
      expect(a.equals(b)).toBe(false)
    })

    it('returns false when either has UNKNOWN key (matching OpenRA behavior)', () => {
      const unknown = new Hotkey(KeyCode.UNKNOWN, Modifiers.None)
      const valid = new Hotkey(KeyCode.A, Modifiers.None)
      // UNKNOWN keys are never equal — per OpenRA operator == logic
      expect(unknown.equals(valid)).toBe(false)
      // Also: Hotkey(A, None).equals(UNKNOWN) should be false
      // because Hotkey(UNKNOWN).key !== A.key, so it's already caught
    })

    it('Invalid is not equal to Invalid (UNKNOWN keys never equal)', () => {
      expect(Hotkey.Invalid.equals(Hotkey.Invalid)).toBe(false)
    })

    it('is symmetric', () => {
      const a = new Hotkey(KeyCode.W, Modifiers.Shift | Modifiers.Ctrl)
      const b = new Hotkey(KeyCode.W, Modifiers.Shift | Modifiers.Ctrl)
      expect(a.equals(b)).toBe(b.equals(a))
    })
  })

  describe('fromKeyInput', () => {
    it('creates hotkey from KeyInput', () => {
      const input = makeKeyInput(KeyCode.RETURN, Modifiers.Alt)
      const hotkey = Hotkey.fromKeyInput(input)
      expect(hotkey.key).toBe(KeyCode.RETURN)
      expect(hotkey.modifiers).toBe(Modifiers.Alt)
    })

    it('creates hotkey with no modifiers', () => {
      const input = makeKeyInput(KeyCode.SPACE)
      const hotkey = Hotkey.fromKeyInput(input)
      expect(hotkey.key).toBe(KeyCode.SPACE)
      expect(hotkey.modifiers).toBe(Modifiers.None)
    })
  })

  describe('tryParse', () => {
    it('parses simple key name', () => {
      const result = Hotkey.tryParse('RETURN')
      expect(result.success).toBe(true)
      expect(result.value.key).toBe(KeyCode.RETURN)
      expect(result.value.modifiers).toBe(Modifiers.None)
    })

    it('parses key with single modifier', () => {
      const result = Hotkey.tryParse('A Ctrl')
      expect(result.success).toBe(true)
      expect(result.value.key).toBe(KeyCode.A)
      expect(result.value.modifiers).toBe(Modifiers.Ctrl)
    })

    it('parses key with multiple modifiers', () => {
      const result = Hotkey.tryParse('F1 Shift,Alt')
      expect(result.success).toBe(true)
      expect(result.value.key).toBe(KeyCode.F1)
      expect(result.value.modifiers).toBe(Modifiers.Shift | Modifiers.Alt)
    })

    it('parses numeric SDL key code', () => {
      // KeyCode.A = 97
      const result = Hotkey.tryParse('97')
      expect(result.success).toBe(true)
      expect(result.value.key).toBe(KeyCode.A)
    })

    it('fails for null input', () => {
      const result = Hotkey.tryParse(null)
      expect(result.success).toBe(false)
      expect(result.value).toBe(Hotkey.Invalid)
    })

    it('fails for empty string', () => {
      const result = Hotkey.tryParse('')
      expect(result.success).toBe(false)
      expect(result.value).toBe(Hotkey.Invalid)
    })

    it('fails for unknown key name', () => {
      const result = Hotkey.tryParse('INVALID_KEY_NAME_XYZ')
      expect(result.success).toBe(false)
    })

    it('is case-insensitive for key names', () => {
      const result = Hotkey.tryParse('return')
      expect(result.success).toBe(true)
      expect(result.value.key).toBe(KeyCode.RETURN)
    })
  })

  describe('toString', () => {
    it('returns key name only for no-modifier hotkey', () => {
      const hotkey = new Hotkey(KeyCode.A, Modifiers.None)
      expect(hotkey.toString()).toContain('A')
    })

    it('includes modifier name', () => {
      const hotkey = new Hotkey(KeyCode.A, Modifiers.Ctrl)
      const str = hotkey.toString()
      expect(str).toContain('Ctrl')
    })
  })

  describe('displayString', () => {
    it('returns modifier-prefixed display string', () => {
      const hotkey = new Hotkey(KeyCode.A, Modifiers.Ctrl | Modifiers.Shift)
      const str = hotkey.displayString()
      expect(str).toContain('Ctrl')
      expect(str).toContain('Shift')
      expect(str).toContain('+')
    })

    it('returns key display string only when no modifiers', () => {
      const hotkey = new Hotkey(KeyCode.ESCAPE, Modifiers.None)
      const str = hotkey.displayString()
      expect(str).toContain('Escape')
      expect(str).not.toContain('+')
    })
  })
})

// ---------------------------------------------------------------------------
// HotkeyReference
// ---------------------------------------------------------------------------

describe('HotkeyReference', () => {
  describe('static Invalid', () => {
    it('has an Invalid reference', () => {
      expect(HotkeyReference.Invalid).toBeInstanceOf(HotkeyReference)
    })

    it('getValue returns Hotkey.Invalid', () => {
      expect(HotkeyReference.Invalid.getValue()).toBe(Hotkey.Invalid)
    })

    it('isActivatedBy returns false for any input', () => {
      const input = makeKeyInput(KeyCode.RETURN)
      expect(HotkeyReference.Invalid.isActivatedBy(input)).toBe(false)
    })
  })

  describe('construction', () => {
    it('default constructor creates Invalid', () => {
      const ref = new HotkeyReference()
      expect(ref.getValue()).toBe(Hotkey.Invalid)
      expect(ref.isActivatedBy(makeKeyInput(KeyCode.A))).toBe(false)
    })

    it('constructor with static Hotkey', () => {
      const hotkey = new Hotkey(KeyCode.A, Modifiers.Ctrl)
      const ref = new HotkeyReference(hotkey)
      expect(ref.getValue()).toBe(hotkey)
      expect(ref.getValue().key).toBe(KeyCode.A)
      expect(ref.getValue().modifiers).toBe(Modifiers.Ctrl)
    })

    it('constructor with getter function', () => {
      let value = new Hotkey(KeyCode.B, Modifiers.None)
      const ref = new HotkeyReference(() => value)
      expect(ref.getValue().key).toBe(KeyCode.B)

      // Change the value dynamically
      value = new Hotkey(KeyCode.C, Modifiers.Alt)
      expect(ref.getValue().key).toBe(KeyCode.C)
      expect(ref.getValue().modifiers).toBe(Modifiers.Alt)
    })
  })

  describe('getValue', () => {
    it('returns the stored hotkey', () => {
      const hotkey = new Hotkey(KeyCode.TAB, Modifiers.None)
      const ref = new HotkeyReference(hotkey)
      const result = ref.getValue()
      expect(result.key).toBe(KeyCode.TAB)
      expect(result.modifiers).toBe(Modifiers.None)
    })

    it('returns latest value with dynamic getter', () => {
      let hotkey = new Hotkey(KeyCode.W, Modifiers.None)
      const ref = new HotkeyReference(() => hotkey)
      hotkey = new Hotkey(KeyCode.W, Modifiers.Ctrl)
      expect(ref.getValue().modifiers).toBe(Modifiers.Ctrl)
    })
  })

  describe('isActivatedBy', () => {
    it('returns true when key and modifiers match', () => {
      const hotkey = new Hotkey(KeyCode.RETURN, Modifiers.Ctrl)
      const ref = new HotkeyReference(hotkey)
      const input = makeKeyInput(KeyCode.RETURN, Modifiers.Ctrl)
      expect(ref.isActivatedBy(input)).toBe(true)
    })

    it('returns false when key matches but modifiers differ', () => {
      const hotkey = new Hotkey(KeyCode.RETURN, Modifiers.Ctrl)
      const ref = new HotkeyReference(hotkey)
      const input = makeKeyInput(KeyCode.RETURN, Modifiers.Shift)
      expect(ref.isActivatedBy(input)).toBe(false)
    })

    it('returns false when modifiers match but key differs', () => {
      const hotkey = new Hotkey(KeyCode.RETURN, Modifiers.Ctrl)
      const ref = new HotkeyReference(hotkey)
      const input = makeKeyInput(KeyCode.A, Modifiers.Ctrl)
      expect(ref.isActivatedBy(input)).toBe(false)
    })

    it('returns false when neither key nor modifiers match', () => {
      const hotkey = new Hotkey(KeyCode.RETURN, Modifiers.Ctrl)
      const ref = new HotkeyReference(hotkey)
      const input = makeKeyInput(KeyCode.A, Modifiers.None)
      expect(ref.isActivatedBy(input)).toBe(false)
    })

    it('returns false for Invalid reference (using a real key)', () => {
      // Hotkey.Invalid has key=UNKNOWN, modifiers=None.
      // A real KeyInput should never have key=UNKNOWN, so isActivatedBy
      // will always return false for Invalid in practice.
      const input = makeKeyInput(KeyCode.A, Modifiers.None)
      expect(HotkeyReference.Invalid.isActivatedBy(input)).toBe(false)
    })

    it('handles KeyUp events correctly (still checks key match)', () => {
      const hotkey = new Hotkey(KeyCode.X, Modifiers.None)
      const ref = new HotkeyReference(hotkey)
      const input = makeKeyInput(KeyCode.X, Modifiers.None, KIE_Up)
      expect(ref.isActivatedBy(input)).toBe(true)
    })
  })

  describe('integration: reference + key input round-trip', () => {
    it('Hotkey.fromKeyInput can be used to create a matching reference', () => {
      const input = makeKeyInput(KeyCode.F5, Modifiers.Alt | Modifiers.Shift)
      const hotkey = Hotkey.fromKeyInput(input)
      const ref = new HotkeyReference(hotkey)
      expect(ref.isActivatedBy(input)).toBe(true)
    })

    it('reference with different key does not match', () => {
      const input = makeKeyInput(KeyCode.F5, Modifiers.None)
      const hotkey = new Hotkey(KeyCode.F6, Modifiers.None)
      const ref = new HotkeyReference(hotkey)
      expect(ref.isActivatedBy(input)).toBe(false)
    })
  })
})
