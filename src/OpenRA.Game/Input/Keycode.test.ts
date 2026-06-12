/**
 * Keycode.test.ts — KeyCode 枚举和映射函数单元测试
 *
 * 测试范围:
 * - KeyCode 枚举值正确性 (与 OpenRA SDL 键码保持一致)
 * - keyCodeFromKeyboardEvent 映射准确性
 * - keyCodeFromSDLK 数值查找
 * - keyName 显示名称
 * - isBrowserReservedKey 检测
 */

import { describe, it, expect } from 'vitest'
import {
  KeyCode,
  keyCodeFromKeyboardEvent,
  keyCodeFromSDLK,
  keyName,
  isBrowserReservedKey,
} from './Keycode'

// ---------------------------------------------------------------------------
// KeyCode 值正确性 (抽样检查关键键)
// ---------------------------------------------------------------------------

describe('KeyCode values', () => {
  it('has correct UNKNOWN value', () => {
    expect(KeyCode.UNKNOWN).toBe(0)
  })

  it('has correct ASCII values for basic control keys', () => {
    expect(KeyCode.RETURN).toBe(13)    // '\r'
    expect(KeyCode.ESCAPE).toBe(27)
    expect(KeyCode.BACKSPACE).toBe(8)  // '\b'
    expect(KeyCode.TAB).toBe(9)        // '\t'
    expect(KeyCode.SPACE).toBe(32)     // ' '
    expect(KeyCode.DELETE).toBe(127)
  })

  it('has correct ASCII values for numbers 0-9', () => {
    expect(KeyCode.NUMBER_0).toBe(48)
    expect(KeyCode.NUMBER_1).toBe(49)
    expect(KeyCode.NUMBER_2).toBe(50)
    expect(KeyCode.NUMBER_3).toBe(51)
    expect(KeyCode.NUMBER_4).toBe(52)
    expect(KeyCode.NUMBER_5).toBe(53)
    expect(KeyCode.NUMBER_6).toBe(54)
    expect(KeyCode.NUMBER_7).toBe(55)
    expect(KeyCode.NUMBER_8).toBe(56)
    expect(KeyCode.NUMBER_9).toBe(57)
  })

  it('has correct ASCII values for letters A-Z (lowercase)', () => {
    expect(KeyCode.A).toBe(97)  // 'a'
    expect(KeyCode.B).toBe(98)  // 'b'
    expect(KeyCode.C).toBe(99)  // 'c'
    expect(KeyCode.Z).toBe(122) // 'z'
    // Spot check continuity
    expect(KeyCode.M).toBe(109) // 'm'
    expect(KeyCode.N).toBe(110) // 'n'
    expect(KeyCode.O).toBe(111) // 'o'
  })

  it('has correct values for symbol keys', () => {
    expect(KeyCode.EXCLAIM).toBe(33)     // '!'
    expect(KeyCode.QUOTEDBL).toBe(34)    // '"'
    expect(KeyCode.HASH).toBe(35)        // '#'
    expect(KeyCode.DOLLAR).toBe(36)      // '$'
    expect(KeyCode.AT).toBe(64)          // '@'
    expect(KeyCode.LEFTBRACKET).toBe(91) // '['
    expect(KeyCode.BACKSLASH).toBe(92)   // '\\'
    expect(KeyCode.RIGHTBRACKET).toBe(93) // ']'
  })
})

// ---------------------------------------------------------------------------
// KeyCode SDL SCANCODE_MASK 键值
// ---------------------------------------------------------------------------

describe('KeyCode SCANCODE_MASK values', () => {
  const SCANCODE_MASK = 1 << 30 // 1073741824

  it('has correct F-key values with SCANCODE_MASK', () => {
    expect(KeyCode.F1).toBe(58 | SCANCODE_MASK)
    expect(KeyCode.F5).toBe(62 | SCANCODE_MASK)
    expect(KeyCode.F10).toBe(67 | SCANCODE_MASK)
    expect(KeyCode.F12).toBe(69 | SCANCODE_MASK)
    expect(KeyCode.F13).toBe(104 | SCANCODE_MASK)
    expect(KeyCode.F24).toBe(115 | SCANCODE_MASK)
  })

  it('has correct navigation key values with SCANCODE_MASK', () => {
    expect(KeyCode.UP).toBe(82 | SCANCODE_MASK)
    expect(KeyCode.DOWN).toBe(81 | SCANCODE_MASK)
    expect(KeyCode.LEFT).toBe(80 | SCANCODE_MASK)
    expect(KeyCode.RIGHT).toBe(79 | SCANCODE_MASK)
    expect(KeyCode.HOME).toBe(74 | SCANCODE_MASK)
    expect(KeyCode.END).toBe(77 | SCANCODE_MASK)
    expect(KeyCode.PAGEUP).toBe(75 | SCANCODE_MASK)
    expect(KeyCode.PAGEDOWN).toBe(78 | SCANCODE_MASK)
  })

  it('has correct numpad key values with SCANCODE_MASK', () => {
    expect(KeyCode.KP_0).toBe(98 | SCANCODE_MASK)
    expect(KeyCode.KP_1).toBe(89 | SCANCODE_MASK)
    expect(KeyCode.KP_9).toBe(97 | SCANCODE_MASK)
    expect(KeyCode.KP_ENTER).toBe(88 | SCANCODE_MASK)
    expect(KeyCode.KP_PLUS).toBe(87 | SCANCODE_MASK)
    expect(KeyCode.KP_MINUS).toBe(86 | SCANCODE_MASK)
    expect(KeyCode.KP_MULTIPLY).toBe(85 | SCANCODE_MASK)
    expect(KeyCode.KP_DIVIDE).toBe(84 | SCANCODE_MASK)
    expect(KeyCode.KP_PERIOD).toBe(99 | SCANCODE_MASK)
  })

  it('has correct modifier key values with SCANCODE_MASK', () => {
    expect(KeyCode.LCTRL).toBe(224 | SCANCODE_MASK)
    expect(KeyCode.LSHIFT).toBe(225 | SCANCODE_MASK)
    expect(KeyCode.LALT).toBe(226 | SCANCODE_MASK)
    expect(KeyCode.LGUI).toBe(227 | SCANCODE_MASK)
    expect(KeyCode.RCTRL).toBe(228 | SCANCODE_MASK)
    expect(KeyCode.RSHIFT).toBe(229 | SCANCODE_MASK)
    expect(KeyCode.RALT).toBe(230 | SCANCODE_MASK)
    expect(KeyCode.RGUI).toBe(231 | SCANCODE_MASK)
  })

  it('has correct MOUSE4/MOUSE5 values with SCANCODE_MASK', () => {
    expect(KeyCode.MOUSE4).toBe(283 | SCANCODE_MASK)
    expect(KeyCode.MOUSE5).toBe(284 | SCANCODE_MASK)
  })

  it('all SCANCODE_MASK keys have bit 30 set', () => {
    const maskKeys = [
      KeyCode.F1, KeyCode.UP, KeyCode.KP_1, KeyCode.LCTRL, KeyCode.MOUSE4, KeyCode.CAPSLOCK,
    ]
    for (const k of maskKeys) {
      expect(k & SCANCODE_MASK).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// keyCodeFromKeyboardEvent — 标准映射
// ---------------------------------------------------------------------------

describe('keyCodeFromKeyboardEvent', () => {
  it('maps KeyA to KeyCode.A', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.A)
  })

  it('maps Digit0 to KeyCode.NUMBER_0', () => {
    const event = new KeyboardEvent('keydown', { code: 'Digit0', key: '0' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.NUMBER_0)
  })

  it('maps F1 to KeyCode.F1', () => {
    const event = new KeyboardEvent('keydown', { code: 'F1', key: 'F1' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.F1)
  })

  it('maps ArrowUp to KeyCode.UP', () => {
    const event = new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.UP)
  })

  it('maps ArrowDown to KeyCode.DOWN', () => {
    const event = new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.DOWN)
  })

  it('maps ArrowLeft to KeyCode.LEFT', () => {
    const event = new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.LEFT)
  })

  it('maps ArrowRight to KeyCode.RIGHT', () => {
    const event = new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.RIGHT)
  })

  it('maps Enter to KeyCode.RETURN', () => {
    const event = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.RETURN)
  })

  it('maps Escape to KeyCode.ESCAPE', () => {
    const event = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.ESCAPE)
  })

  it('maps Space to KeyCode.SPACE', () => {
    const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.SPACE)
  })

  it('maps Tab to KeyCode.TAB', () => {
    const event = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.TAB)
  })

  it('maps Backspace to KeyCode.BACKSPACE', () => {
    const event = new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.BACKSPACE)
  })

  it('maps Delete to KeyCode.DELETE', () => {
    const event = new KeyboardEvent('keydown', { code: 'Delete', key: 'Delete' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.DELETE)
  })

  it('maps Home to KeyCode.HOME', () => {
    const event = new KeyboardEvent('keydown', { code: 'Home', key: 'Home' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.HOME)
  })

  it('maps End to KeyCode.END', () => {
    const event = new KeyboardEvent('keydown', { code: 'End', key: 'End' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.END)
  })

  it('maps PageUp to KeyCode.PAGEUP', () => {
    const event = new KeyboardEvent('keydown', { code: 'PageUp', key: 'PageUp' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.PAGEUP)
  })

  it('maps PageDown to KeyCode.PAGEDOWN', () => {
    const event = new KeyboardEvent('keydown', { code: 'PageDown', key: 'PageDown' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.PAGEDOWN)
  })

  it('maps ShiftLeft to KeyCode.LSHIFT', () => {
    const event = new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.LSHIFT)
  })

  it('maps ShiftRight to KeyCode.RSHIFT', () => {
    const event = new KeyboardEvent('keydown', { code: 'ShiftRight', key: 'Shift' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.RSHIFT)
  })

  it('maps ControlLeft to KeyCode.LCTRL', () => {
    const event = new KeyboardEvent('keydown', { code: 'ControlLeft', key: 'Control' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.LCTRL)
  })

  it('maps ControlRight to KeyCode.RCTRL', () => {
    const event = new KeyboardEvent('keydown', { code: 'ControlRight', key: 'Control' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.RCTRL)
  })

  it('maps AltLeft to KeyCode.LALT', () => {
    const event = new KeyboardEvent('keydown', { code: 'AltLeft', key: 'Alt' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.LALT)
  })

  it('maps AltRight to KeyCode.RALT', () => {
    const event = new KeyboardEvent('keydown', { code: 'AltRight', key: 'Alt' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.RALT)
  })
})

// ---------------------------------------------------------------------------
// keyCodeFromKeyboardEvent — 符号键映射
// ---------------------------------------------------------------------------

describe('keyCodeFromKeyboardEvent — symbol keys', () => {
  it('maps Minus to KeyCode.MINUS', () => {
    const event = new KeyboardEvent('keydown', { code: 'Minus', key: '-' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.MINUS)
  })

  it('maps Equal to KeyCode.EQUALS', () => {
    const event = new KeyboardEvent('keydown', { code: 'Equal', key: '=' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.EQUALS)
  })

  it('maps BracketLeft to KeyCode.LEFTBRACKET', () => {
    const event = new KeyboardEvent('keydown', { code: 'BracketLeft', key: '[' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.LEFTBRACKET)
  })

  it('maps BracketRight to KeyCode.RIGHTBRACKET', () => {
    const event = new KeyboardEvent('keydown', { code: 'BracketRight', key: ']' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.RIGHTBRACKET)
  })

  it('maps Backslash to KeyCode.BACKSLASH', () => {
    const event = new KeyboardEvent('keydown', { code: 'Backslash', key: '\\' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.BACKSLASH)
  })

  it('maps Semicolon to KeyCode.SEMICOLON', () => {
    const event = new KeyboardEvent('keydown', { code: 'Semicolon', key: ';' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.SEMICOLON)
  })

  it('maps Quote to KeyCode.QUOTE', () => {
    const event = new KeyboardEvent('keydown', { code: 'Quote', key: "'" })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.QUOTE)
  })

  it('maps Comma to KeyCode.COMMA', () => {
    const event = new KeyboardEvent('keydown', { code: 'Comma', key: ',' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.COMMA)
  })

  it('maps Period to KeyCode.PERIOD', () => {
    const event = new KeyboardEvent('keydown', { code: 'Period', key: '.' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.PERIOD)
  })

  it('maps Slash to KeyCode.SLASH', () => {
    const event = new KeyboardEvent('keydown', { code: 'Slash', key: '/' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.SLASH)
  })

  it('maps Backquote to KeyCode.BACKQUOTE', () => {
    const event = new KeyboardEvent('keydown', { code: 'Backquote', key: '`' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.BACKQUOTE)
  })
})

// ---------------------------------------------------------------------------
// keyCodeFromKeyboardEvent — 小键盘映射
// ---------------------------------------------------------------------------

describe('keyCodeFromKeyboardEvent — numpad keys', () => {
  it('maps Numpad0 to KeyCode.KP_0', () => {
    const event = new KeyboardEvent('keydown', { code: 'Numpad0', key: '0' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_0)
  })

  it('maps Numpad9 to KeyCode.KP_9', () => {
    const event = new KeyboardEvent('keydown', { code: 'Numpad9', key: '9' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_9)
  })

  it('maps NumpadEnter to KeyCode.KP_ENTER', () => {
    const event = new KeyboardEvent('keydown', { code: 'NumpadEnter', key: 'Enter' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_ENTER)
  })

  it('maps NumpadAdd to KeyCode.KP_PLUS', () => {
    const event = new KeyboardEvent('keydown', { code: 'NumpadAdd', key: '+' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_PLUS)
  })

  it('maps NumpadSubtract to KeyCode.KP_MINUS', () => {
    const event = new KeyboardEvent('keydown', { code: 'NumpadSubtract', key: '-' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_MINUS)
  })

  it('maps NumpadMultiply to KeyCode.KP_MULTIPLY', () => {
    const event = new KeyboardEvent('keydown', { code: 'NumpadMultiply', key: '*' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_MULTIPLY)
  })

  it('maps NumpadDivide to KeyCode.KP_DIVIDE', () => {
    const event = new KeyboardEvent('keydown', { code: 'NumpadDivide', key: '/' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_DIVIDE)
  })

  it('maps NumpadDecimal to KeyCode.KP_PERIOD', () => {
    const event = new KeyboardEvent('keydown', { code: 'NumpadDecimal', key: '.' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.KP_PERIOD)
  })
})

// ---------------------------------------------------------------------------
// keyCodeFromKeyboardEvent — 回退路径 (非美国键盘/字符推断)
// ---------------------------------------------------------------------------

describe('keyCodeFromKeyboardEvent — fallback path', () => {
  it('falls back to key character for ! if code is missing', () => {
    const event = new KeyboardEvent('keydown', { code: '', key: '!' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.EXCLAIM)
  })

  it('falls back to key character for @ if code is missing', () => {
    const event = new KeyboardEvent('keydown', { code: '', key: '@' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.AT)
  })

  it('falls back to key character for # if code is missing', () => {
    const event = new KeyboardEvent('keydown', { code: '', key: '#' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.HASH)
  })

  it('returns UNKNOWN for fully unrecognized key', () => {
    const event = new KeyboardEvent('keydown', { code: 'SomeUnknownCode', key: 'SomeUnknownKey' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.UNKNOWN)
  })

  it('falls back to ASCII lowercase letter when code is empty but key is a-z', () => {
    const event = new KeyboardEvent('keydown', { code: '', key: 'k' })
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.K)
  })

  it('falls back to ASCII digit when code is empty but key is 0-9', () => {
    const event = new KeyboardEvent('keydown', { code: '', key: '5' })
    // 5 is ASCII 53, which is NUMBER_5
    expect(keyCodeFromKeyboardEvent(event)).toBe(KeyCode.NUMBER_5)
  })
})

// ---------------------------------------------------------------------------
// keyCodeFromSDLK — 数值查找
// ---------------------------------------------------------------------------

describe('keyCodeFromSDLK', () => {
  it('returns correct KeyCode for known SDL values', () => {
    expect(keyCodeFromSDLK(KeyCode.A)).toBe(KeyCode.A)
    expect(keyCodeFromSDLK(KeyCode.RETURN)).toBe(KeyCode.RETURN)
    expect(keyCodeFromSDLK(KeyCode.ESCAPE)).toBe(KeyCode.ESCAPE)
    expect(keyCodeFromSDLK(KeyCode.F1)).toBe(KeyCode.F1)
    expect(keyCodeFromSDLK(KeyCode.UP)).toBe(KeyCode.UP)
    expect(keyCodeFromSDLK(KeyCode.KP_ENTER)).toBe(KeyCode.KP_ENTER)
  })

  it('returns UNKNOWN for invalid SDL key numbers', () => {
    expect(keyCodeFromSDLK(-1)).toBe(KeyCode.UNKNOWN)
    expect(keyCodeFromSDLK(999999)).toBe(KeyCode.UNKNOWN)
    expect(keyCodeFromSDLK(1337)).toBe(KeyCode.UNKNOWN)
  })

  it('returns UNKNOWN for 0 (only UNKNOWN is 0)', () => {
    expect(keyCodeFromSDLK(0)).toBe(KeyCode.UNKNOWN)
  })

  it('handles SDL key codes with SCANCODE_MASK', () => {
    const SCANCODE_MASK = 1 << 30
    expect(keyCodeFromSDLK(58 | SCANCODE_MASK)).toBe(KeyCode.F1)
    expect(keyCodeFromSDLK(225 | SCANCODE_MASK)).toBe(KeyCode.LSHIFT)
  })

  it('is idempotent: keyCodeFromSDLK(KeyCode.X) === KeyCode.X for all valid codes', () => {
    const allCodes = Object.values(KeyCode) as number[]
    for (const code of allCodes) {
      expect(keyCodeFromSDLK(code)).toBe(code)
    }
  })
})

// ---------------------------------------------------------------------------
// keyName — 人类可读名称
// ---------------------------------------------------------------------------

describe('keyName', () => {
  it('returns correct display name for common keys', () => {
    expect(keyName(KeyCode.A)).toBe('A')
    expect(keyName(KeyCode.RETURN)).toBe('Enter')
    expect(keyName(KeyCode.ESCAPE)).toBe('Escape')
    expect(keyName(KeyCode.SPACE)).toBe('Space')
    expect(keyName(KeyCode.BACKSPACE)).toBe('Backspace')
    expect(keyName(KeyCode.UP)).toBe('Up')
    expect(keyName(KeyCode.DOWN)).toBe('Down')
    expect(keyName(KeyCode.LEFT)).toBe('Left')
    expect(keyName(KeyCode.RIGHT)).toBe('Right')
  })

  it('returns correct display name for F-keys', () => {
    expect(keyName(KeyCode.F1)).toBe('F1')
    expect(keyName(KeyCode.F5)).toBe('F5')
    expect(keyName(KeyCode.F12)).toBe('F12')
  })

  it('returns correct display name for modifier keys', () => {
    expect(keyName(KeyCode.LSHIFT)).toBe('Left Shift')
    expect(keyName(KeyCode.LCTRL)).toBe('Left Ctrl')
    expect(keyName(KeyCode.LALT)).toBe('Left Alt')
    expect(keyName(KeyCode.RSHIFT)).toBe('Right Shift')
    expect(keyName(KeyCode.RCTRL)).toBe('Right Ctrl')
  })

  it('returns correct display name for numpad keys', () => {
    expect(keyName(KeyCode.KP_0)).toBe('Num 0')
    expect(keyName(KeyCode.KP_9)).toBe('Num 9')
    expect(keyName(KeyCode.KP_ENTER)).toBe('Num Enter')
    expect(keyName(KeyCode.KP_PLUS)).toBe('Num +')
    expect(keyName(KeyCode.KP_MULTIPLY)).toBe('Num *')
  })

  it('returns correct display name for symbol keys', () => {
    expect(keyName(KeyCode.MINUS)).toBe('-')
    expect(keyName(KeyCode.EQUALS)).toBe('=')
    expect(keyName(KeyCode.COMMA)).toBe(',')
    expect(keyName(KeyCode.PERIOD)).toBe('.')
    expect(keyName(KeyCode.SLASH)).toBe('/')
    expect(keyName(KeyCode.SEMICOLON)).toBe(';')
    expect(keyName(KeyCode.QUOTE)).toBe("'")
    expect(keyName(KeyCode.LEFTBRACKET)).toBe('[')
    expect(keyName(KeyCode.RIGHTBRACKET)).toBe(']')
    expect(keyName(KeyCode.BACKSLASH)).toBe('\\')
  })

  it('returns "Unknown" for UNKNOWN key', () => {
    expect(keyName(KeyCode.UNKNOWN)).toBe('Unknown')
  })

  it('returns "Unknown" for invalid key codes', () => {
    // keyCode 类型为 number, 所以可以传递无效的键码值进行测试
    expect(keyName(-1 as KeyCode)).toBe('Unknown')
    expect(keyName(99999 as KeyCode)).toBe('Unknown')
  })
})

// ---------------------------------------------------------------------------
// isBrowserReservedKey — 浏览器保留键检测
// ---------------------------------------------------------------------------

describe('isBrowserReservedKey', () => {
  it('identifies F12 as reserved', () => {
    const event = new KeyboardEvent('keydown', { code: 'F12' })
    expect(isBrowserReservedKey(event)).toBe(true)
  })

  it('identifies Ctrl+W as reserved', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true })
    expect(isBrowserReservedKey(event)).toBe(true)
  })

  it('identifies Ctrl+N as reserved', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyN', ctrlKey: true })
    expect(isBrowserReservedKey(event)).toBe(true)
  })

  it('identifies Ctrl+T as reserved', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyT', ctrlKey: true })
    expect(isBrowserReservedKey(event)).toBe(true)
  })

  it('identifies Ctrl+Shift+N as reserved', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'KeyN', ctrlKey: true, shiftKey: true,
    })
    expect(isBrowserReservedKey(event)).toBe(true)
  })

  it('identifies Ctrl+Shift+T as reserved', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'KeyT', ctrlKey: true, shiftKey: true,
    })
    expect(isBrowserReservedKey(event)).toBe(true)
  })

  it('does NOT flag plain W without Ctrl', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyW' })
    expect(isBrowserReservedKey(event)).toBe(false)
  })

  it('does NOT flag plain N without Ctrl', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyN' })
    expect(isBrowserReservedKey(event)).toBe(false)
  })

  it('does NOT flag plain T without Ctrl', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyT' })
    expect(isBrowserReservedKey(event)).toBe(false)
  })

  it('does NOT flag F1-F11', () => {
    for (let i = 1; i <= 11; i++) {
      const event = new KeyboardEvent('keydown', { code: `F${i}` })
      expect(isBrowserReservedKey(event)).toBe(false)
    }
  })

  it('does NOT flag standard letter keys', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyA' })
    expect(isBrowserReservedKey(event)).toBe(false)
  })

  it('does NOT flag arrow keys', () => {
    const event = new KeyboardEvent('keydown', { code: 'ArrowUp' })
    expect(isBrowserReservedKey(event)).toBe(false)
  })

  it('does NOT flag Shift+N or Alt+N', () => {
    const shiftEvent = new KeyboardEvent('keydown', { code: 'KeyN', shiftKey: true })
    expect(isBrowserReservedKey(shiftEvent)).toBe(false)
    const altEvent = new KeyboardEvent('keydown', { code: 'KeyN', altKey: true })
    expect(isBrowserReservedKey(altEvent)).toBe(false)
  })
})
