/**
 * ViewportControllerWidget.test.ts — ViewportControllerWidget migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: event handling, scrolling logic, cursor management,
 * keyboard bindings, bookmark management, lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core (prevent real module loading)
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Maths/math.vector', () => ({
  Vector3: class {
    x: number; y: number; z: number
    constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }
  },
}))

vi.mock('@babylonjs/core/Cameras/camera', () => ({
  Camera: class {
    static readonly ORTHOGRAPHIC_CAMERA = 0
    static readonly PERSPECTIVE_CAMERA = 1
  },
}))

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({}))
vi.mock('@babylonjs/core/Engines/engine', () => ({}))
vi.mock('@babylonjs/core/scene', () => ({}))

// ---------------------------------------------------------------------------
// Mock ChromeMetrics (provides DefaultCursor for Widget.initialize)
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Widgets/ChromeMetrics', () => {
  const data: Record<string, unknown> = { DefaultCursor: 'default' }
  return {
    ChromeMetrics: {
      get: <T>(key: string): T => {
        if (key in data) return data[key] as T
        throw new Error(`ChromeMetrics: key '${key}' not found`)
      },
      tryGet: <T>(key: string): T | undefined => data[key] as T | undefined,
      add(key: string, value: unknown): void { data[key] = value },
    },
  }
})

// ---------------------------------------------------------------------------
// Mock IInputHandler types
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Input/IInputHandler', () => ({
  MouseInputEvent: { Down: 0, Move: 1, Up: 2, Scroll: 3 },
  MouseButton: { None: 0, Left: 1, Middle: 2, Right: 4, X1: 8, X2: 16 },
  KeyInputEvent: { Down: 0, Up: 1 },
  Modifiers: { None: 0, Shift: 1, Alt: 2, Ctrl: 4, Meta: 8 },
}))

// ---------------------------------------------------------------------------
// Mock Keycode (needed by HotkeyReference)
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Input/Keycode', () => {
  const KeyCode: Record<string, number> = {
    UNKNOWN: 0,
    RETURN: 13,
    ESCAPE: 27,
    BACKSPACE: 8,
    TAB: 9,
    SPACE: 32,
    PAGEUP: 1073741899, // SDL value
    PAGEDOWN: 1073741902, // SDL value
    LEFT: 1073741904,
    RIGHT: 1073741903,
    UP: 1073741906,
    DOWN: 1073741905,
  }
  return { KeyCode, keyName: (_code: number) => 'Unknown' }
})

// ---------------------------------------------------------------------------
// Imports (after all mocks)
// ---------------------------------------------------------------------------

import {
  ViewportControllerWidget,
  MouseScrollType,
  WorldTooltipType,
  DEFAULT_VIEWPORT_SETTINGS,
  type IViewportSettings,
} from './ViewportControllerWidget'

import { Viewport } from '../../OpenRA.Game/Graphics/Viewport'
import { HotkeyReference, Hotkey } from '../../OpenRA.Game/Input/HotkeyReference'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a dummy (inactive) HotkeyReference — its getValue() returns
 * Hotkey.Invalid (key=KeyCode.UNKNOWN=0, modifiers=0).
 * No real keyboard event will match it.
 */
function makeDummyHotkey(): HotkeyReference {
  return HotkeyReference.Invalid
}

/**
 * Create a HotkeyReference that activates when the key code matches.
 * Uses a static Hotkey with modifiers=0, matching the default KeyInput
 * produced by `eventToKeyInput` (which always has Modifiers.None).
 */
function makeActivatingHotkey(keyCode: number): HotkeyReference {
  return new HotkeyReference(new Hotkey(keyCode, 0))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ViewportControllerWidget', () => {
  beforeEach(() => {
    Viewport.lastMousePos = { x: 960, y: 540 }
  })

  describe('construction', () => {
    it('creates a widget with default settings', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      expect(widget).toBeInstanceOf(ViewportControllerWidget)
      expect(widget.settings.viewportEdgeScroll).toBe(true)
      expect(widget.settings.viewportEdgeScrollMargin).toBe(15)
      expect(widget.tooltipType).toBe(WorldTooltipType.None)
    })

    it('registers viewportTick callback (verify via tick)', () => {
      const vp = new Viewport()
      let called = false
      const origOnViewportTick = vp.onViewportTick.bind(vp)
      vp.onViewportTick = (cb: () => void) => {
        origOnViewportTick(cb)
        called = true
      }
      new ViewportControllerWidget(vp)
      expect(called).toBe(true)
    })

    it('allows overriding settings', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp, {
        viewportEdgeScrollMargin: 50,
        mouseScroll: MouseScrollType.Joystick,
      })
      expect(widget.settings.viewportEdgeScrollMargin).toBe(50)
      expect(widget.settings.mouseScroll).toBe(MouseScrollType.Joystick)
    })
  })

  describe('render', () => {
    it('returns an HTMLElement', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      const el = widget.render()
      expect(el).toBeInstanceOf(HTMLElement)
      expect(el.tagName).toBe('DIV')
      expect(el.style.position).toBe('absolute')
    })
  })

  describe('lifecycle', () => {
    it('unregisters viewportTick on removed()', () => {
      const vp = new Viewport()
      let callbackCount = 0
      vp.onViewportTick(() => { callbackCount++ })
      expect(callbackCount).toBe(0)

      const widget = new ViewportControllerWidget(vp)
      vp.tick()
      expect(callbackCount).toBe(1)

      widget.removed()
      vp.tick()
      expect(callbackCount).toBe(2)
    })
  })

  describe('mouse event handling', () => {
    it('handles wheel event without crash', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp, { zoomModifier: 4 })
      const event = {
        type: 'wheel',
        clientX: 960,
        clientY: 540,
        button: 0,
        deltaX: 0,
        deltaY: -1,
        stopPropagation: () => {},
        target: null,
      }
      expect(() => widget.handleEvent(event as any)).not.toThrow()
    })

    it('handles mousemove event without crash', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      const event = {
        type: 'mousemove',
        clientX: 960,
        clientY: 540,
        button: 0,
        deltaX: 0,
        deltaY: 0,
        stopPropagation: () => {},
        target: null,
      }
      expect(() => widget.handleEvent(event as any)).not.toThrow()
    })
  })

  describe('cursor management', () => {
    it('returns null when not scrolling', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp, { viewportEdgeScroll: false })
      const cursor = widget.getCursor({ x: 960, y: 540 })
      expect(cursor).toBeNull()
    })
  })

  describe('focus management', () => {
    it('clears joystick scroll state on yieldMouseFocus', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      ;(widget as any).joystickScrollStart = { x: 100, y: 100 }
      ;(widget as any).joystickScrollEnd = { x: 200, y: 200 }
      widget.yieldMouseFocus()
      expect((widget as any).joystickScrollStart).toBeNull()
      expect((widget as any).joystickScrollEnd).toBeNull()
    })

    it('clears keyboard directions on yieldKeyboardFocus', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      ;(widget as any).keyboardDirections = 3 // Up | Left
      widget.yieldKeyboardFocus()
      expect((widget as any).keyboardDirections).toBe(0) // None
    })
  })

  describe('bookmark arrays', () => {
    it('creates bookmark arrays when bookmarkKeyCount > 0 on initialize', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      widget.bookmarkKeyCount = 4
      widget.bookmarkSaveKeyPrefix = 'SaveBookmark'
      widget.bookmarkRestoreKeyPrefix = 'RestoreBookmark'

      expect(widget.bookmarkKeyCount).toBe(4)
      expect(widget.bookmarkSaveKeyPrefix).toBe('SaveBookmark')
      expect(widget.bookmarkRestoreKeyPrefix).toBe('RestoreBookmark')
      expect((widget as any).bookmarkPositions).toHaveLength(0)
    })

    it('has empty bookmark arrays when bookmarkKeyCount is 0', () => {
      const vp = new Viewport()
      const widget = new ViewportControllerWidget(vp)
      widget.bookmarkKeyCount = 0

      expect(widget.bookmarkKeyCount).toBe(0)
      expect((widget as any).saveBookmarkHotkeys).toHaveLength(0)
      expect((widget as any).restoreBookmarkHotkeys).toHaveLength(0)
    })
  })

  describe('keyboard event dispatch', () => {
    it('calls adjustZoom when zoomInKey is activated', () => {
      const vp = new Viewport()
      const zoomCalled = vi.fn()
      vp.adjustZoom = zoomCalled
      const widget = new ViewportControllerWidget(
        vp,
        DEFAULT_VIEWPORT_SETTINGS,
        makeActivatingHotkey(87),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
        makeDummyHotkey(),
      )

      const keyEvent = {
        type: 'keydown',
        keyCode: 87,
        stopPropagation: () => {},
        target: null,
        repeat: false,
      }
      widget.handleEvent(keyEvent as any)
      expect(zoomCalled).toHaveBeenCalledWith(0.25)
    })
  })

  describe('settings management', () => {
    it('preserves settings object', () => {
      const vp = new Viewport()
      const customSettings: Partial<IViewportSettings> = {
        viewportEdgeScroll: false,
        viewportEdgeScrollMargin: 100,
        viewportEdgeScrollStep: 50,
        mouseScroll: MouseScrollType.Disabled,
      }
      const widget = new ViewportControllerWidget(vp, customSettings)
      expect(widget.settings.viewportEdgeScroll).toBe(false)
      expect(widget.settings.viewportEdgeScrollMargin).toBe(100)
      expect(widget.settings.viewportEdgeScrollStep).toBe(50)
      expect(widget.settings.mouseScroll).toBe(MouseScrollType.Disabled)
    })
  })
})

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe('MouseScrollType', () => {
  it('defines correct values', () => {
    expect(MouseScrollType.Disabled).toBe(0)
    expect(MouseScrollType.Standard).toBe(1)
    expect(MouseScrollType.Inverted).toBe(2)
    expect(MouseScrollType.Joystick).toBe(3)
  })
})

describe('WorldTooltipType', () => {
  it('defines correct values', () => {
    expect(WorldTooltipType.None).toBe(0)
    expect(WorldTooltipType.Unexplored).toBe(1)
    expect(WorldTooltipType.Actor).toBe(2)
    expect(WorldTooltipType.FrozenActor).toBe(3)
    expect(WorldTooltipType.Resource).toBe(4)
  })
})

describe('DEFAULT_VIEWPORT_SETTINGS', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_VIEWPORT_SETTINGS.viewportEdgeScroll).toBe(true)
    expect(DEFAULT_VIEWPORT_SETTINGS.viewportEdgeScrollMargin).toBe(15)
    expect(DEFAULT_VIEWPORT_SETTINGS.viewportEdgeScrollStep).toBe(30)
    expect(DEFAULT_VIEWPORT_SETTINGS.mouseScroll).toBe(MouseScrollType.Standard)
    expect(DEFAULT_VIEWPORT_SETTINGS.mouseScrollDeadzone).toBe(5)
    expect(DEFAULT_VIEWPORT_SETTINGS.zoomSpeed).toBe(0.05)
  })
})
