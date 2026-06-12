/**
 * IInputHandler.test.ts — IInputHandler 接口和输入类型定义单元测试
 *
 * 测试范围:
 * - 枚举常量值正确性 (MouseInputEvent, MouseButton, Modifiers, KeyInputEvent)
 * - Modifiers 位标志运算
 * - MouseButton 位标志运算
 * - MouseInput 和 KeyInput 接口结构
 */

import { describe, it, expect } from 'vitest'
import {
  MouseInputEvent,
  KeyInputEvent,
  MouseButton,
  Modifiers,
  type MouseInput,
  type KeyInput,
  type IInputHandler,
} from './IInputHandler'
import { KeyCode } from './Keycode'

// ---------------------------------------------------------------------------
// MouseInputEvent
// ---------------------------------------------------------------------------

describe('MouseInputEvent enum', () => {
  it('has correct values matching OpenRA', () => {
    expect(MouseInputEvent.Down).toBe(0)
    expect(MouseInputEvent.Move).toBe(1)
    expect(MouseInputEvent.Up).toBe(2)
    expect(MouseInputEvent.Scroll).toBe(3)
  })

  it('has 4 distinct values', () => {
    const values = new Set(Object.values(MouseInputEvent))
    expect(values.size).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// MouseButton enum
// ---------------------------------------------------------------------------

describe('MouseButton enum', () => {
  it('has correct bit flag values matching OpenRA', () => {
    expect(MouseButton.None).toBe(0)
    expect(MouseButton.Left).toBe(1)
    expect(MouseButton.Middle).toBe(2)
    expect(MouseButton.Right).toBe(4)
    expect(MouseButton.X1).toBe(8)
    expect(MouseButton.X2).toBe(16)
  })

  it('supports bitwise combination', () => {
    const both = MouseButton.Left | MouseButton.Right
    expect(both & MouseButton.Left).toBeTruthy()
    expect(both & MouseButton.Right).toBeTruthy()
    expect(both & MouseButton.Middle).toBeFalsy()
  })

  it('None has no bits set', () => {
    expect(MouseButton.None).toBe(0)
    // None & anything should be 0
    expect(MouseButton.None & MouseButton.Left).toBe(0)
  })

  it('X1 and X2 do not overlap with standard buttons', () => {
    expect(MouseButton.X1 & MouseButton.Left).toBe(0)
    expect(MouseButton.X1 & MouseButton.Middle).toBe(0)
    expect(MouseButton.X1 & MouseButton.Right).toBe(0)
    expect(MouseButton.X2 & MouseButton.Left).toBe(0)
    expect(MouseButton.X2 & MouseButton.Middle).toBe(0)
    expect(MouseButton.X2 & MouseButton.Right).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Modifiers enum
// ---------------------------------------------------------------------------

describe('Modifiers enum', () => {
  it('has correct bit flag values matching OpenRA', () => {
    expect(Modifiers.None).toBe(0)
    expect(Modifiers.Shift).toBe(1)
    expect(Modifiers.Alt).toBe(2)
    expect(Modifiers.Ctrl).toBe(4)
    expect(Modifiers.Meta).toBe(8)
  })

  it('supports bitwise OR combination', () => {
    const ctrlShift = Modifiers.Ctrl | Modifiers.Shift
    expect(ctrlShift & Modifiers.Ctrl).toBeTruthy()
    expect(ctrlShift & Modifiers.Shift).toBeTruthy()
    expect(ctrlShift & Modifiers.Alt).toBeFalsy()
    expect(ctrlShift & Modifiers.Meta).toBeFalsy()
  })

  it('supports three modifier combination', () => {
    const combo = Modifiers.Ctrl | Modifiers.Alt | Modifiers.Shift
    expect(combo & Modifiers.Ctrl).toBeTruthy()
    expect(combo & Modifiers.Alt).toBeTruthy()
    expect(combo & Modifiers.Shift).toBeTruthy()
    expect(combo & Modifiers.Meta).toBeFalsy()
  })

  it('None has zero value', () => {
    expect(Modifiers.None).toBe(0)
    expect(Modifiers.None & Modifiers.Shift).toBe(0)
  })

  it('all flags are power-of-two (non-overlapping)', () => {
    expect(Modifiers.Shift & Modifiers.Alt).toBe(0)
    expect(Modifiers.Shift & Modifiers.Ctrl).toBe(0)
    expect(Modifiers.Shift & Modifiers.Meta).toBe(0)
    expect(Modifiers.Alt & Modifiers.Ctrl).toBe(0)
    expect(Modifiers.Alt & Modifiers.Meta).toBe(0)
    expect(Modifiers.Ctrl & Modifiers.Meta).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// KeyInputEvent enum
// ---------------------------------------------------------------------------

describe('KeyInputEvent enum', () => {
  it('has correct values matching OpenRA', () => {
    expect(KeyInputEvent.Down).toBe(0)
    expect(KeyInputEvent.Up).toBe(1)
  })

  it('has 2 distinct values', () => {
    const values = new Set(Object.values(KeyInputEvent))
    expect(values.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// MouseInput interface (structural contract)
// ---------------------------------------------------------------------------

describe('MouseInput interface', () => {
  it('accepts valid Down event object', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 100, y: 200 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 1,
    }
    expect(input.event).toBe(MouseInputEvent.Down)
    expect(input.button).toBe(MouseButton.Left)
    expect(input.location.x).toBe(100)
    expect(input.location.y).toBe(200)
    expect(input.multiTapCount).toBe(1)
  })

  it('accepts Move event with delta', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Move,
      button: MouseButton.None,
      location: { x: 150, y: 250 },
      delta: { x: 5, y: -3 },
      modifiers: Modifiers.Shift,
      multiTapCount: 0,
    }
    expect(input.event).toBe(MouseInputEvent.Move)
    expect(input.delta.x).toBe(5)
    expect(input.delta.y).toBe(-3)
    expect(input.modifiers).toBe(Modifiers.Shift)
  })

  it('accepts Scroll event', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Scroll,
      button: MouseButton.None,
      location: { x: 500, y: 300 },
      delta: { x: 0, y: -120 },
      modifiers: Modifiers.Ctrl,
      multiTapCount: 0,
    }
    expect(input.event).toBe(MouseInputEvent.Scroll)
    expect(input.delta.y).toBe(-120)
    expect(input.modifiers).toBe(Modifiers.Ctrl)
  })

  it('accepts Up event with triple-click', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Up,
      button: MouseButton.Right,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.Alt | Modifiers.Shift,
      multiTapCount: 3,
    }
    expect(input.multiTapCount).toBe(3)
    expect(input.modifiers & Modifiers.Alt).toBeTruthy()
    expect(input.modifiers & Modifiers.Shift).toBeTruthy()
  })

  it('supports Middle button events', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Middle,
      location: { x: 50, y: 50 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 1,
    }
    expect(input.button).toBe(MouseButton.Middle)
    expect(input.button & MouseButton.Middle).toBeTruthy()
  })

  it('supports X1/X2 buttons', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.X1,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 1,
    }
    expect(input.button).toBe(MouseButton.X1)
  })
})

// ---------------------------------------------------------------------------
// KeyInput interface (structural contract)
// ---------------------------------------------------------------------------

describe('KeyInput interface', () => {
  it('accepts valid Down key event', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Down,
      key: KeyCode.A,
      modifiers: Modifiers.None,
      multiTapCount: 1,
      unicodeChar: 'a',
      isRepeat: false,
    }
    expect(input.event).toBe(KeyInputEvent.Down)
    expect(input.key).toBe(KeyCode.A)
    expect(input.unicodeChar).toBe('a')
    expect(input.isRepeat).toBe(false)
  })

  it('accepts Up key event', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Up,
      key: KeyCode.ESCAPE,
      modifiers: Modifiers.Shift,
      multiTapCount: 0,
      unicodeChar: '',
      isRepeat: false,
    }
    expect(input.event).toBe(KeyInputEvent.Up)
    expect(input.key).toBe(KeyCode.ESCAPE)
    expect(input.modifiers).toBe(Modifiers.Shift)
  })

  it('accepts repeat key event', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Down,
      key: KeyCode.BACKSPACE,
      modifiers: Modifiers.None,
      multiTapCount: 5,
      unicodeChar: '',
      isRepeat: true,
    }
    expect(input.isRepeat).toBe(true)
    expect(input.multiTapCount).toBe(5)
  })

  it('accepts Ctrl+A combo', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Down,
      key: KeyCode.A,
      modifiers: Modifiers.Ctrl,
      multiTapCount: 1,
      unicodeChar: 'a',
      isRepeat: false,
    }
    expect(input.modifiers & Modifiers.Ctrl).toBeTruthy()
    expect(input.key).toBe(KeyCode.A)
  })

  it('accepts empty unicodeChar for non-printable keys', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Down,
      key: KeyCode.F1,
      modifiers: Modifiers.None,
      multiTapCount: 1,
      unicodeChar: '',
      isRepeat: false,
    }
    expect(input.unicodeChar).toBe('')
  })
})

// ---------------------------------------------------------------------------
// IInputHandler interface (contract verification)
// ---------------------------------------------------------------------------

describe('IInputHandler interface', () => {
  it('can be implemented by a mock object', () => {
    let modifierKeysCalls = 0
    let keyInputCalls = 0
    let mouseInputCalls = 0
    let textInputCalls = 0

    const handler: IInputHandler = {
      modifierKeys(_mods) { modifierKeysCalls++ },
      onKeyInput(_input) { keyInputCalls++ },
      onMouseInput(_input) { mouseInputCalls++ },
      onTextInput(_text) { textInputCalls++ },
    }

    handler.modifierKeys(Modifiers.Ctrl)
    handler.onKeyInput({
      event: KeyInputEvent.Down, key: KeyCode.RETURN,
      modifiers: Modifiers.None, multiTapCount: 1,
      unicodeChar: '', isRepeat: false,
    })
    handler.onMouseInput({
      event: MouseInputEvent.Down, button: MouseButton.Left,
      location: { x: 0, y: 0 }, delta: { x: 0, y: 0 },
      modifiers: Modifiers.None, multiTapCount: 1,
    })
    handler.onTextInput('hello')

    expect(modifierKeysCalls).toBe(1)
    expect(keyInputCalls).toBe(1)
    expect(mouseInputCalls).toBe(1)
    expect(textInputCalls).toBe(1)
  })
})
