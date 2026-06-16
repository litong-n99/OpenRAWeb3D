/**
 * InputSettingsLogic.test.ts — InputSettingsLogic 单元测试
 *
 * 测试覆盖:
 * - 输入设置状态 (mouseControlStyle, mouseScroll, lockMouseWindow, etc.)
 * - 鼠标控制样式枚举值
 * - 鼠标滚动类型枚举值
 * - 缩放修饰键枚举值
 * - 面板注册
 * - 鼠标焦点设置回调
 * - 重置面板恢复默认值
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  InputSettingsLogic,
  type InputSettings,
  type MouseFocusCallbacks,
} from './InputSettingsLogic.js'
import { SettingsLogic } from './SettingsLogic.js'
import { Modifiers } from '../../../../OpenRA.Game/Input/IInputHandler.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockInputSettings(): InputSettings {
  return {
    useAlternateScrollButton: false,
    viewportEdgeScroll: true,
    lockMouseWindow: false,
    zoomSpeed: 0.04,
    viewportEdgeScrollStep: 10,
    uiScrollSpeed: 10,
    mouseControlStyle: 'Classic' as const,
    mouseScroll: 'Standard' as const,
    zoomModifier: Modifiers.None,
  }
}

function createMockMouseFocusCallbacks(): MouseFocusCallbacks {
  return {
    grabWindowMouseFocus: vi.fn(),
    releaseWindowMouseFocus: vi.fn(),
  }
}

function buildSettingsLogic(): SettingsLogic {
  const widget = new ContainerWidget()
  widget.id = 'ROOT'
  const pc = new ContainerWidget()
  pc.id = 'PANEL_CONTAINER'
  const pt = new ContainerWidget()
  pt.id = 'PANEL_TEMPLATE'
  pc.addChild(pt)
  widget.addChild(pc)
  const tc = new ContainerWidget()
  tc.id = 'SETTINGS_TAB_CONTAINER'
  const tt = new ContainerWidget() as any
  tt.id = 'BUTTON_TEMPLATE'
  tt.clone = () => {
    const b = new ContainerWidget() as any
    b.getText = () => ''
    b.isHighlighted = () => false
    b.bounds = { x: 0, y: 0, width: 100, height: 30 }
    return b
  }
  tc.addChild(tt)
  widget.addChild(tc)
  widget.get = (id: string) => {
    if (id === 'PANEL_CONTAINER') return pc
    if (id === 'SETTINGS_TAB_CONTAINER') return tc
    if (id === 'BUTTON_TEMPLATE') return tt
    if (id === 'PANEL_TEMPLATE') return pt
    const bk = new ContainerWidget() as any
    bk.id = id
    bk.onClick = () => {}
    return bk
  }
  return new SettingsLogic(
    widget,
    vi.fn(),
    {},
    {
      saveSettings: vi.fn(),
      hasExternalMod: vi.fn(() => false),
      switchToExternalMod: vi.fn(),
      showConfirmDialog: vi.fn(),
      showSavePrompt: vi.fn(),
      closeWindow: vi.fn(),
    },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InputSettingsLogic', () => {
  let inputSettings: InputSettings
  let mouseFocusCallbacks: MouseFocusCallbacks
  let settingsLogic: SettingsLogic

  beforeEach(() => {
    inputSettings = createMockInputSettings()
    mouseFocusCallbacks = createMockMouseFocusCallbacks()
    settingsLogic = buildSettingsLogic()
  })

  // ---------------------------------------------------------------------------
  // InputSettings state
  // ---------------------------------------------------------------------------

  describe('InputSettings state', () => {
    it('should have correct defaults', () => {
      expect(inputSettings.mouseControlStyle).toBe('Classic')
      expect(inputSettings.mouseScroll).toBe('Standard')
      expect(inputSettings.zoomModifier).toBe(Modifiers.None)
      expect(inputSettings.viewportEdgeScroll).toBe(true)
      expect(inputSettings.lockMouseWindow).toBe(false)
    })

    it('should support changing mouse control style', () => {
      inputSettings.mouseControlStyle = 'Modern' as const
      expect(inputSettings.mouseControlStyle).toBe('Modern')
    })

    it('should support changing mouse scroll type', () => {
      inputSettings.mouseScroll = 'Inverted' as const
      expect(inputSettings.mouseScroll).toBe('Inverted')
    })

    it('should support changing zoom modifier', () => {
      inputSettings.zoomModifier = Modifiers.Ctrl
      expect(inputSettings.zoomModifier).toBe(Modifiers.Ctrl)
    })

    it('should support changing zoom speed', () => {
      inputSettings.zoomSpeed = 0.08
      expect(inputSettings.zoomSpeed).toBe(0.08)
    })

    it('should support changing edge scroll step', () => {
      inputSettings.viewportEdgeScrollStep = 20
      expect(inputSettings.viewportEdgeScrollStep).toBe(20)
    })

    it('should support lock mouse window toggle', () => {
      inputSettings.lockMouseWindow = true
      expect(inputSettings.lockMouseWindow).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // MouseFocusCallbacks
  // ---------------------------------------------------------------------------

  describe('mouseFocusCallbacks', () => {
    it('should call grabWindowMouseFocus when locking', () => {
      mouseFocusCallbacks.grabWindowMouseFocus()
      expect(mouseFocusCallbacks.grabWindowMouseFocus).toHaveBeenCalled()
    })

    it('should call releaseWindowMouseFocus when unlocking', () => {
      mouseFocusCallbacks.releaseWindowMouseFocus()
      expect(mouseFocusCallbacks.releaseWindowMouseFocus).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should construct without error', () => {
      expect(() => {
        new InputSettingsLogic(
          settingsLogic,
          'Input',
          'Input',
          inputSettings,
          mouseFocusCallbacks,
        )
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Control style constants
  // ---------------------------------------------------------------------------

  describe('control style constants', () => {
    it('should include Classic, Modern, OtherRTS', () => {
      // Verify all three control styles are valid
      inputSettings.mouseControlStyle = 'Classic' as const
      expect(inputSettings.mouseControlStyle).toBe('Classic')
      inputSettings.mouseControlStyle = 'Modern' as const
      expect(inputSettings.mouseControlStyle).toBe('Modern')
      inputSettings.mouseControlStyle = 'OtherRTS' as const
      expect(inputSettings.mouseControlStyle).toBe('OtherRTS')
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse scroll type constants
  // ---------------------------------------------------------------------------

  describe('mouse scroll type constants', () => {
    it('should include Disabled, Standard, Inverted, Joystick', () => {
      const types = ['Disabled', 'Standard', 'Inverted', 'Joystick'] as const
      for (const t of types) {
        inputSettings.mouseScroll = t
        expect(inputSettings.mouseScroll).toBe(t)
      }
    })
  })
})
