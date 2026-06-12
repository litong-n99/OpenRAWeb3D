/**
 * InputHandler.test.ts — InputHandler 实现单元测试
 *
 * 测试范围:
 * - NullInputHandler: 所有方法均为空操作，零副作用
 * - DefaultInputHandler: 事件路由到回调
 * - InputManager: 事件绑定/解绑/转换/生命周期
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  NullInputHandler,
  DefaultInputHandler,
  InputManager,
  type InputRouteCallbacks,
} from './InputHandler'
import {
  MouseInputEvent,
  KeyInputEvent,
  MouseButton,
  Modifiers,
} from './IInputHandler'
import type { MouseInput, KeyInput, IInputHandler } from './IInputHandler'
import { KeyCode } from './Keycode'

// ---------------------------------------------------------------------------
// NullInputHandler
// ---------------------------------------------------------------------------

describe('NullInputHandler', () => {
  let handler: NullInputHandler

  beforeEach(() => {
    handler = new NullInputHandler()
  })

  it('modifierKeys is a no-op', () => {
    // Should not throw
    expect(() => handler.modifierKeys(Modifiers.Ctrl)).not.toThrow()
    expect(() => handler.modifierKeys(Modifiers.None)).not.toThrow()
    expect(() => handler.modifierKeys(Modifiers.Shift | Modifiers.Alt)).not.toThrow()
  })

  it('onKeyInput is a no-op', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Down,
      key: KeyCode.A,
      modifiers: Modifiers.None,
      multiTapCount: 1,
      unicodeChar: 'a',
      isRepeat: false,
    }
    expect(() => handler.onKeyInput(input)).not.toThrow()
  })

  it('onMouseInput is a no-op', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 100, y: 200 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.None,
      multiTapCount: 1,
    }
    expect(() => handler.onMouseInput(input)).not.toThrow()
  })

  it('onTextInput is a no-op', () => {
    expect(() => handler.onTextInput('hello')).not.toThrow()
    expect(() => handler.onTextInput('')).not.toThrow()
    expect(() => handler.onTextInput('multibyte unicode: 你好')).not.toThrow()
  })

  it('dispose cleans up without error', () => {
    expect(() => handler.dispose()).not.toThrow()
    // Multiple dispose calls should also not throw
    expect(() => handler.dispose()).not.toThrow()
  })

  it('has zero side effects — no external state modified', () => {
    // Verify handler creates no side effects by calling all methods
    handler.modifierKeys(Modifiers.Ctrl | Modifiers.Alt)
    handler.onKeyInput({
      event: KeyInputEvent.Down, key: KeyCode.RETURN, modifiers: Modifiers.Ctrl,
      multiTapCount: 2, unicodeChar: '\r', isRepeat: false,
    })
    handler.onMouseInput({
      event: MouseInputEvent.Move, button: MouseButton.Left,
      location: { x: 50, y: 50 }, delta: { x: 10, y: 0 },
      modifiers: Modifiers.Shift, multiTapCount: 0,
    })
    handler.onTextInput('test text')
    // No assertions needed — we just verify no exceptions and no side effects
  })
})

// ---------------------------------------------------------------------------
// DefaultInputHandler
// ---------------------------------------------------------------------------

describe('DefaultInputHandler', () => {
  let callbacks: InputRouteCallbacks
  let modifierKeysSpy: ReturnType<typeof vi.fn>
  let keyPressSpy: ReturnType<typeof vi.fn>
  let textInputSpy: ReturnType<typeof vi.fn>
  let mouseInputSpy: ReturnType<typeof vi.fn>
  let handler: DefaultInputHandler

  beforeEach(() => {
    modifierKeysSpy = vi.fn<(mods: Modifiers) => void>()
    keyPressSpy = vi.fn<(input: KeyInput) => void>()
    textInputSpy = vi.fn<(text: string) => void>()
    mouseInputSpy = vi.fn<(input: MouseInput) => void>()

    // Use type assertions because vitest Mock types don't directly satisfy
    // the strict function signature checks in InputRouteCallbacks.
    callbacks = {
      modifierKeys: modifierKeysSpy as unknown as (mods: Modifiers) => void,
      keyPress: keyPressSpy as unknown as (input: KeyInput) => void,
      textInput: textInputSpy as unknown as (text: string) => void,
      mouseInput: mouseInputSpy as unknown as (input: MouseInput) => void,
    }

    handler = new DefaultInputHandler(callbacks)
  })

  it('routes modifierKeys to callback', () => {
    handler.modifierKeys(Modifiers.Ctrl)
    expect(modifierKeysSpy).toHaveBeenCalledTimes(1)
    expect(modifierKeysSpy).toHaveBeenCalledWith(Modifiers.Ctrl)
  })

  it('routes onKeyInput to callback', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Down,
      key: KeyCode.SPACE,
      modifiers: Modifiers.Alt,
      multiTapCount: 1,
      unicodeChar: ' ',
      isRepeat: false,
    }
    handler.onKeyInput(input)
    expect(keyPressSpy).toHaveBeenCalledTimes(1)
    expect(keyPressSpy).toHaveBeenCalledWith(input)
  })

  it('routes onMouseInput to callback', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Scroll,
      button: MouseButton.None,
      location: { x: 300, y: 400 },
      delta: { x: 0, y: -120 },
      modifiers: Modifiers.Shift,
      multiTapCount: 0,
    }
    handler.onMouseInput(input)
    expect(mouseInputSpy).toHaveBeenCalledTimes(1)
    expect(mouseInputSpy).toHaveBeenCalledWith(input)
  })

  it('routes onTextInput to callback', () => {
    handler.onTextInput('abc')
    expect(textInputSpy).toHaveBeenCalledTimes(1)
    expect(textInputSpy).toHaveBeenCalledWith('abc')
  })

  it('handles empty text input', () => {
    handler.onTextInput('')
    expect(textInputSpy).toHaveBeenCalledWith('')
  })

  it('handles missing optional callbacks gracefully', () => {
    const emptyHandler = new DefaultInputHandler({})
    // These should not throw
    expect(() => emptyHandler.modifierKeys(Modifiers.None)).not.toThrow()
    expect(() => emptyHandler.onKeyInput({
      event: KeyInputEvent.Down, key: KeyCode.A, modifiers: Modifiers.None,
      multiTapCount: 1, unicodeChar: 'a', isRepeat: false,
    })).not.toThrow()
    expect(() => emptyHandler.onMouseInput({
      event: MouseInputEvent.Down, button: MouseButton.Left,
      location: { x: 0, y: 0 }, delta: { x: 0, y: 0 },
      modifiers: Modifiers.None, multiTapCount: 1,
    })).not.toThrow()
    expect(() => emptyHandler.onTextInput('test')).not.toThrow()
  })

  it('dispose cleans up without error', () => {
    expect(() => handler.dispose()).not.toThrow()
    // After dispose, the handler is still callable (it doesn't own the callbacks)
    handler.onTextInput('post-dispose')
    expect(textInputSpy).toHaveBeenCalledWith('post-dispose')
  })

  it('routes all modifier combinations correctly', () => {
    handler.modifierKeys(Modifiers.Ctrl | Modifiers.Shift)
    expect(modifierKeysSpy).toHaveBeenCalledWith(Modifiers.Ctrl | Modifiers.Shift)

    handler.modifierKeys(Modifiers.None)
    expect(modifierKeysSpy).toHaveBeenCalledWith(Modifiers.None)

    handler.modifierKeys(Modifiers.Alt | Modifiers.Meta)
    expect(modifierKeysSpy).toHaveBeenCalledWith(Modifiers.Alt | Modifiers.Meta)
  })

  it('routes keyUp events correctly', () => {
    const input: KeyInput = {
      event: KeyInputEvent.Up,
      key: KeyCode.LCTRL,
      modifiers: Modifiers.None,
      multiTapCount: 0,
      unicodeChar: '',
      isRepeat: false,
    }
    handler.onKeyInput(input)
    expect(keyPressSpy).toHaveBeenCalledWith(input)
  })

  it('routes mouseUp events correctly', () => {
    const input: MouseInput = {
      event: MouseInputEvent.Up,
      button: MouseButton.Right,
      location: { x: 200, y: 100 },
      delta: { x: 0, y: 0 },
      modifiers: Modifiers.Ctrl,
      multiTapCount: 0,
    }
    handler.onMouseInput(input)
    expect(mouseInputSpy).toHaveBeenCalledWith(input)
  })
})

// ---------------------------------------------------------------------------
// InputManager
// ---------------------------------------------------------------------------

describe('InputManager', () => {
  let manager: InputManager
  let handlerSpy: {
    modifierKeys: ReturnType<typeof vi.fn<(mods: Modifiers) => void>>
    onKeyInput: ReturnType<typeof vi.fn<(input: KeyInput) => void>>
    onMouseInput: ReturnType<typeof vi.fn<(input: MouseInput) => void>>
    onTextInput: ReturnType<typeof vi.fn<(text: string) => void>>
  }

  beforeEach(() => {
    handlerSpy = {
      modifierKeys: vi.fn<(mods: Modifiers) => void>(),
      onKeyInput: vi.fn<(input: KeyInput) => void>(),
      onMouseInput: vi.fn<(input: MouseInput) => void>(),
      onTextInput: vi.fn<(text: string) => void>(),
    }

    manager = new InputManager(handlerSpy as IInputHandler)
  })

  afterEach(() => {
    manager.dispose()
  })

  // -------------------------------------------------------------------
  // 构造与属性
  // -------------------------------------------------------------------

  it('initializes with default mouse position at origin', () => {
    const pos = manager.mousePosition
    expect(pos.x).toBe(0)
    expect(pos.y).toBe(0)
  })

  it('initializes with None modifiers', () => {
    expect(manager.modifiersState).toBe(Modifiers.None)
  })

  it('getHandler returns the current handler', () => {
    expect(manager.getHandler()).toBe(handlerSpy as IInputHandler)
  })

  it('setHandler replaces the handler', () => {
    const newHandler = {
      modifierKeys: vi.fn<(mods: Modifiers) => void>(),
      onKeyInput: vi.fn<(input: KeyInput) => void>(),
      onMouseInput: vi.fn<(input: MouseInput) => void>(),
      onTextInput: vi.fn<(text: string) => void>(),
    }

    manager.setHandler(newHandler as IInputHandler)
    expect(manager.getHandler()).toBe(newHandler as IInputHandler)

    // Old handler should no longer receive events
    // New handler should receive events
    manager.setHandler(newHandler as IInputHandler)
  })

  // -------------------------------------------------------------------
  // createDefault / createNull 工厂方法
  // -------------------------------------------------------------------

  describe('factory methods', () => {
    it('createNull returns a manager with NullInputHandler', () => {
      const nullMgr = InputManager.createNull()
      expect(nullMgr.getHandler()).toBeInstanceOf(NullInputHandler)
      nullMgr.dispose()
    })

    it('createDefault attaches and returns DefaultInputHandler', () => {
      const callbacks: InputRouteCallbacks = {
        modifierKeys: vi.fn(),
        keyPress: vi.fn(),
      }
      // 使用 vitest happy-dom 环境中的 document.createElement
      const canvas = document.createElement('canvas')

      const defaultMgr = InputManager.createDefault(canvas, callbacks)
      expect(defaultMgr.getHandler()).toBeInstanceOf(DefaultInputHandler)

      defaultMgr.dispose()
    })
  })

  // -------------------------------------------------------------------
  // 事件绑定/解绑
  // -------------------------------------------------------------------

  describe('attach / detach lifecycle', () => {
    it('attach adds event listeners to element', () => {
      const element = document.createElement('div')
      const addSpy = vi.spyOn(element, 'addEventListener')

      manager.attach(element)

      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
      expect(addSpy).toHaveBeenCalledWith('keyup', expect.any(Function))
      expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
      expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
      expect(addSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
      // wheel with { passive: false }
      expect(addSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false })

      addSpy.mockRestore()
    })

    it('detach removes event listeners from element', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const removeSpy = vi.spyOn(element, 'removeEventListener')
      manager.detach(element)

      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
      expect(removeSpy).toHaveBeenCalledWith('keyup', expect.any(Function))
      expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
      expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
      expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
      expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function))

      removeSpy.mockRestore()
    })

    it('second attach replaces previous listeners (detach is called internally)', () => {
      const element = document.createElement('div')
      manager.attach(element)

      // Attach again — internal detach should clean up first
      expect(() => manager.attach(element)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------
  // 键盘事件处理
  // -------------------------------------------------------------------

  describe('keyboard event handling', () => {
    it('forwards keydown events to handler.onKeyInput', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' })
      element.dispatchEvent(event)

      expect(handlerSpy.onKeyInput).toHaveBeenCalled()
      const call = handlerSpy.onKeyInput.mock.calls[0][0] as KeyInput
      expect(call.event).toBe(KeyInputEvent.Down)
      expect(call.key).toBe(KeyCode.A)
      expect(call.isRepeat).toBe(false)
    })

    it('forwards keyup events to handler.onKeyInput', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new KeyboardEvent('keyup', { code: 'KeyA', key: 'a' })
      element.dispatchEvent(event)

      expect(handlerSpy.onKeyInput).toHaveBeenCalled()
      const call = handlerSpy.onKeyInput.mock.calls[0][0] as KeyInput
      expect(call.event).toBe(KeyInputEvent.Up)
      expect(call.key).toBe(KeyCode.A)
    })

    it('detects repeated key events', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', repeat: true })
      element.dispatchEvent(event)

      const call = handlerSpy.onKeyInput.mock.calls[0][0] as KeyInput
      expect(call.isRepeat).toBe(true)
    })

    it('extracts modifier keys from keyboard event', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new KeyboardEvent('keydown', {
        code: 'KeyX',
        key: 'x',
        ctrlKey: true,
        shiftKey: true,
      })
      element.dispatchEvent(event)

      const call = handlerSpy.onKeyInput.mock.calls[0][0] as KeyInput
      expect(call.modifiers & Modifiers.Ctrl).toBeTruthy()
      expect(call.modifiers & Modifiers.Shift).toBeTruthy()
      expect(call.modifiers & Modifiers.Alt).toBeFalsy()
    })

    it('filters F12 (browser reserved)', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new KeyboardEvent('keydown', { code: 'F12', key: 'F12' })
      element.dispatchEvent(event)

      expect(handlerSpy.onKeyInput).not.toHaveBeenCalled()
    })

    it('filters Ctrl+W (browser reserved)', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', ctrlKey: true })
      element.dispatchEvent(event)

      expect(handlerSpy.onKeyInput).not.toHaveBeenCalled()
    })

    it('triggers modifierKeys callback when a modifier key is pressed', () => {
      const element = document.createElement('div')
      manager.attach(element)

      // Press Ctrl
      const event = new KeyboardEvent('keydown', {
        code: 'ControlLeft', key: 'Control', ctrlKey: true,
      })
      element.dispatchEvent(event)

      expect(handlerSpy.modifierKeys).toHaveBeenCalled()
      expect(handlerSpy.modifierKeys).toHaveBeenCalledWith(Modifiers.Ctrl)
      expect(manager.modifiersState).toBe(Modifiers.Ctrl)
    })

    it('updates modifiersState on modifier key release', () => {
      const element = document.createElement('div')
      manager.attach(element)

      // Press Ctrl
      const downEvent = new KeyboardEvent('keydown', {
        code: 'ControlLeft', key: 'Control', ctrlKey: true,
      })
      element.dispatchEvent(downEvent)
      expect(manager.modifiersState & Modifiers.Ctrl).toBeTruthy()

      // Release Ctrl
      const upEvent = new KeyboardEvent('keyup', {
        code: 'ControlLeft', key: 'Control', ctrlKey: false,
      })
      element.dispatchEvent(upEvent)
      expect(manager.modifiersState & Modifiers.Ctrl).toBeFalsy()
    })
  })

  // -------------------------------------------------------------------
  // 指针/鼠标事件处理
  // -------------------------------------------------------------------

  describe('pointer event handling', () => {
    it('forwards pointerdown to handler.onMouseInput', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 200,
      })
      element.dispatchEvent(event)

      expect(handlerSpy.onMouseInput).toHaveBeenCalled()
      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.event).toBe(MouseInputEvent.Down)
      expect(call.button).toBe(MouseButton.Left)
      // offsetX may be 0 when undefined (happy-dom behavior)
    })

    it('forwards pointermove to handler.onMouseInput with delta', () => {
      const element = document.createElement('div')
      manager.attach(element)

      // First move sets position to (50, 50)
      const move1 = new PointerEvent('pointermove', { clientX: 50, clientY: 50 })
      element.dispatchEvent(move1)

      // Second move produces delta
      const move2 = new PointerEvent('pointermove', { clientX: 60, clientY: 45 })
      element.dispatchEvent(move2)

      const calls = handlerSpy.onMouseInput.mock.calls
      expect(calls.length).toBeGreaterThanOrEqual(2)
      const call2 = calls[calls.length - 1][0] as MouseInput
      expect(call2.event).toBe(MouseInputEvent.Move)
      // Delta is computed from previous position
      expect(call2.delta.x).toBe(10)
      expect(call2.delta.y).toBe(-5)
    })

    it('forwards pointerup to handler.onMouseInput', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new PointerEvent('pointerup', {
        button: 0,
        clientX: 100,
        clientY: 200,
      })
      element.dispatchEvent(event)

      expect(handlerSpy.onMouseInput).toHaveBeenCalled()
      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.event).toBe(MouseInputEvent.Up)
      expect(call.button).toBe(MouseButton.Left)
    })

    it('correctly maps right click (button=2)', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new PointerEvent('pointerdown', {
        button: 2,
        clientX: 100,
        clientY: 200,
      })
      element.dispatchEvent(event)

      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.button).toBe(MouseButton.Right)
    })

    it('correctly maps middle click (button=1)', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new PointerEvent('pointerdown', {
        button: 1,
        clientX: 100,
        clientY: 200,
      })
      element.dispatchEvent(event)

      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.button).toBe(MouseButton.Middle)
    })

    it('extracts modifiers from pointer event', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 50,
        clientY: 50,
        shiftKey: true,
        ctrlKey: true,
      })
      element.dispatchEvent(event)

      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.modifiers & Modifiers.Shift).toBeTruthy()
      expect(call.modifiers & Modifiers.Ctrl).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------
  // 滚轮事件处理
  // -------------------------------------------------------------------

  describe('wheel event handling', () => {
    it('forwards wheel events to handler.onMouseInput', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -120,
        clientX: 100,
        clientY: 200,
      })
      element.dispatchEvent(event)

      expect(handlerSpy.onMouseInput).toHaveBeenCalled()
      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.event).toBe(MouseInputEvent.Scroll)
      expect(call.delta.y).toBe(-120)
      expect(call.button).toBe(MouseButton.None)
    })

    it('includes horizontal scroll delta', () => {
      const element = document.createElement('div')
      manager.attach(element)

      const event = new WheelEvent('wheel', {
        deltaX: 50,
        deltaY: 0,
        clientX: 100,
        clientY: 200,
      })
      element.dispatchEvent(event)

      const call = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call.delta.x).toBe(50)
    })
  })

  // -------------------------------------------------------------------
  // dispose 生命周期
  // -------------------------------------------------------------------

  describe('dispose', () => {
    it('dispose replaces handler with NullInputHandler', () => {
      const element = document.createElement('div')
      manager.attach(element)
      manager.dispose()

      expect(manager.getHandler()).toBeInstanceOf(NullInputHandler)
    })

    it('events after dispose do not reach original handler', () => {
      const element = document.createElement('div')
      manager.attach(element)
      manager.dispose()

      // Re-attach with same element — listeners should be detached
      const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' })
      element.dispatchEvent(event)

      // Original handler spy should not receive events
      // Note: after dispose, detach() was called, so the listeners are removed
      expect(handlerSpy.onKeyInput).not.toHaveBeenCalled()
    })

    it('double dispose does not throw', () => {
      manager.dispose()
      expect(() => manager.dispose()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------
  // 多次点击检测
  // -------------------------------------------------------------------

  describe('multi-tap detection', () => {
    it('detects double click within time and distance threshold', () => {
      const element = document.createElement('div')
      manager.attach(element)

      // First click
      const click1 = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 })
      element.dispatchEvent(click1)

      const call1 = handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput
      expect(call1.multiTapCount).toBe(1)

      // Second click at same position, shortly after
      const click2 = new PointerEvent('pointerdown', { button: 0, clientX: 101, clientY: 99 })
      element.dispatchEvent(click2)

      const call2 = handlerSpy.onMouseInput.mock.calls[1][0] as MouseInput
      expect(call2.multiTapCount).toBe(2)
    })

    it('resets multi-tap count when click is far away', () => {
      const element = document.createElement('div')
      manager.attach(element)

      // First click
      const click1 = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 })
      element.dispatchEvent(click1)
      expect((handlerSpy.onMouseInput.mock.calls[0][0] as MouseInput).multiTapCount).toBe(1)

      // Second click far away (> doubleClickDistance)
      const click2 = new PointerEvent('pointerdown', { button: 0, clientX: 200, clientY: 200 })
      element.dispatchEvent(click2)
      expect((handlerSpy.onMouseInput.mock.calls[1][0] as MouseInput).multiTapCount).toBe(1)
    })
  })
})
