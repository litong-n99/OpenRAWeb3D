/**
 * ButtonWidget.test.ts — ButtonWidget 单元测试
 *
 * 测试覆盖:
 * - 默认属性初始化（从 ChromeMetrics 回退）
 * - 状态管理（disabled, depressed, highlighted, hovered）
 * - 鼠标事件处理（mousedown/mouseup/mousemove + Depressed 状态机）
 * - 键盘事件处理（keydown + Hotkey + DisableKeyRepeat）
 * - 工具提示集成（ITooltipContainer 交互）
 * - DOM 渲染（data-state 属性，背景样式，文本样式）
 * - Clone 复制构造函数
 * - YieldMouseFocus 重置 Depressed
 * - GetCursor + ChildOrigin + UsableWidth
 * - 文本对比/阴影效果
 * - 声音回调集成
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ButtonWidget, type ITooltipContainer } from './ButtonWidget.js'
import { TextAlign } from './TextAlign.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import { Hotkey } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建模拟 WidgetEvent。 */
function makeMouseEvent(
  type: string,
  overrides: Partial<WidgetEvent> = {},
): WidgetEvent {
  const stopped = { value: false }
  return {
    type,
    stopPropagation(): void {
      stopped.value = true
    },
    target: null,
    clientX: 0,
    clientY: 0,
    button: 0,
    ...overrides,
    _stopped: stopped,
  } as WidgetEvent & { _stopped: { value: boolean } }
}

/** 创建模拟键盘 WidgetEvent。 */
function makeKeyEvent(
  key: string,
  overrides: Partial<WidgetEvent> = {},
): WidgetEvent {
  const stopped = { value: false }
  return {
    type: 'keydown',
    stopPropagation(): void {
      stopped.value = true
    },
    target: null,
    key,
    ...overrides,
    _stopped: stopped,
  } as WidgetEvent & { _stopped: { value: boolean } }
}

/** 模拟 ITooltipContainer。 */
function makeTooltipContainer(): ITooltipContainer & {
  _tooltips: Array<{ template: string; args: Record<string, unknown> }>
  _removed: boolean
} {
  const _tooltips: Array<{
    template: string
    args: Record<string, unknown>
  }> = []
  return {
    _tooltips,
    _removed: false,
    setTooltip(template: string, args: Record<string, unknown>): void {
      _tooltips.push({ template, args })
    },
    removeTooltip(): void {
      _tooltips.length = 0
      ;(this as any)._removed = true
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ButtonWidget', () => {
  beforeEach(() => {
    ChromeMetrics.initialize({
      ButtonFont: '14px Arial',
      ButtonTextColor: '#FFFFFF',
      ButtonTextColorDisabled: '#888888',
      ButtonTextContrast: 'False',
      ButtonTextShadow: 'False',
      ButtonTextContrastColorDark: '#000000',
      ButtonTextContrastColorLight: '#AAAAAA',
      ButtonTextContrastRadius: '1',
      ClickSound: 'button-click',
      ClickDisabledSound: 'button-disabled',
      ButtonCursor: 'pointer',
    })
    ButtonWidget.soundPlayer = null
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
      const btn = new ButtonWidget()
      expect(btn.text).toBe('')
      expect(btn.align).toBe(TextAlign.Center)
      expect(btn.leftMargin).toBe(5)
      expect(btn.rightMargin).toBe(5)
      expect(btn.background).toBe('button')
      expect(btn.depressed).toBe(false)
      expect(btn.visualHeight).toBe(2)
      expect(btn.font).toBe('14px Arial')
      expect(btn.textColor).toBe('#FFFFFF')
      expect(btn.textColorDisabled).toBe('#888888')
      expect(btn.contrast).toBe(false)
      expect(btn.shadow).toBe(false)
      expect(btn.disabled).toBe(false)
      expect(btn.highlighted).toBe(false)
      expect(btn.onClick).toBeDefined()
    })

    it('loads defaults from ChromeMetrics when available', () => {
      ChromeMetrics.initialize({
        ButtonFont: '20px Sans',
        ButtonTextColor: '#FF0000',
        ButtonTextColorDisabled: '#444444',
        ButtonTextContrast: 'True',
        ButtonTextShadow: 'True',
        ButtonTextContrastColorDark: '#111111',
        ButtonTextContrastColorLight: '#EEEEEE',
        ButtonTextContrastRadius: '3',
        ClickSound: 'click',
        ClickDisabledSound: 'noclick',
        ButtonCursor: 'crosshair',
      })
      const btn = new ButtonWidget()
      expect(btn.font).toBe('20px Sans')
      expect(btn.textColor).toBe('#FF0000')
      expect(btn.textColorDisabled).toBe('#444444')
      expect(btn.contrast).toBe(true)
      expect(btn.shadow).toBe(true)
      expect(btn.contrastColorDark).toBe('#111111')
      expect(btn.contrastColorLight).toBe('#EEEEEE')
      expect(btn.contrastRadius).toBe(3)
      expect(btn.clickSound).toBe('click')
      expect(btn.clickDisabledSound).toBe('noclick')
      expect(btn.cursor).toBe('crosshair')
    })

    it('getText delegate returns empty string for empty text', () => {
      const btn = new ButtonWidget()
      expect(btn.getText()).toBe('')
    })

    it('getText delegate returns text when set', () => {
      const btn = new ButtonWidget()
      btn.text = 'Click Me'
      expect(btn.getText()).toBe('Click Me')
    })

    it('getColor delegates return property values', () => {
      const btn = new ButtonWidget()
      btn.textColor = '#ABCDEF'
      btn.textColorDisabled = '#333333'
      expect(btn.getColor()).toBe('#ABCDEF')
      expect(btn.getColorDisabled()).toBe('#333333')
    })

    it('isHighlighted delegate returns highlighted property', () => {
      const btn = new ButtonWidget()
      expect(btn.isHighlighted()).toBe(false)
      btn.highlighted = true
      expect(btn.isHighlighted()).toBe(true)
    })

    it('sets up onMouseUp to trigger onClick', () => {
      const btn = new ButtonWidget()
      let clicked = false
      btn.onClick = () => {
        clicked = true
      }
      btn.onMouseUp?.(makeMouseEvent('mouseup'))
      expect(clicked).toBe(true)
    })

    it('sets up onKeyPress to trigger onClick', () => {
      const btn = new ButtonWidget()
      let clicked = false
      btn.onClick = () => {
        clicked = true
      }
      btn.onKeyPress?.(makeKeyEvent('Enter'))
      expect(clicked).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse event handling — HandleMouseInput
  // ---------------------------------------------------------------------------

  describe('handleEvent — mouse', () => {
    it('mousedown acquires focus and sets depressed', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const event = makeMouseEvent('mousedown', { clientX: 50, clientY: 20 })
      const result = btn.handleEvent(event)

      expect(result).toBe(true)
      expect(btn.depressed).toBe(true)
      expect(btn.hasMouseFocus).toBe(true)
    })

    it('mousedown does nothing when disabled', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.disabled = true

      const event = makeMouseEvent('mousedown', { clientX: 50, clientY: 20 })
      const result = btn.handleEvent(event)

      expect(btn.depressed).toBe(false)
      expect(btn.hasMouseFocus).toBe(false)
      // Return value matches depressed state
      expect(result).toBe(false)
    })

    it('mousedown fires onMouseDown callback', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      let mouseDownFired = false
      btn.onMouseDown = () => {
        mouseDownFired = true
      }

      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))

      expect(mouseDownFired).toBe(true)
    })

    it('mousedown plays click sound', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.clickSound = 'my-sound'

      const sounds: string[] = []
      ButtonWidget.soundPlayer = (name: string) => sounds.push(name)

      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))

      expect(sounds).toContain('my-sound')
    })

    it('mousedown on disabled button plays disabled sound', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.disabled = true
      btn.clickDisabledSound = 'disabled-sound'

      const sounds: string[] = []
      ButtonWidget.soundPlayer = (name: string) => sounds.push(name)

      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))

      expect(sounds).toContain('disabled-sound')
    })

    it('mousedown fails when takeMouseFocus returns false', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      // Simulate another widget holding focus that refuses to yield
      // We override yieldMouseFocus to return false
      const focusHolder = new ButtonWidget()
      focusHolder.bounds = { x: 0, y: 0, width: 200, height: 40 }
      focusHolder.yieldMouseFocus = () => false

      // NOTE: takeMouseFocus checks current mouseFocusWidget and calls yieldMouseFocus.
      // If there's a stubborn widget, the second mousedown will fail.
      // For simplicity, we verify takeMouseFocus is called by checking
      // if depressed is NOT set.
      // Actually we can't easily simulate this. Let's verify the normal flow.
      // The event handler returns false when takeMouseFocus fails.
      // We can test by making takeMouseFocus fail.
      btn.takeMouseFocus = () => false

      const result = btn.handleEvent(
        makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }),
      )

      expect(result).toBe(false)
      expect(btn.depressed).toBe(false)
    })

    it('mouseup fires onClick when depressed and in bounds', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      // First mousedown to get focus
      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))

      let clicked = false
      btn.onClick = () => {
        clicked = true
      }

      // Then mouseup
      const result = btn.handleEvent(
        makeMouseEvent('mouseup', { clientX: 60, clientY: 25 }),
      )

      expect(clicked).toBe(true)
      expect(result).toBe(true) // true because yieldMouseFocus returns true
      expect(btn.depressed).toBe(false)
      expect(btn.hasMouseFocus).toBe(false)
    })

    it('mouseup without prior mousedown does not fire onClick', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      let clicked = false
      btn.onClick = () => {
        clicked = true
      }

      // mouseup without focus
      const result = btn.handleEvent(
        makeMouseEvent('mouseup', { clientX: 50, clientY: 20 }),
      )

      expect(clicked).toBe(false)
      expect(result).toBe(false) // hasMouseFocus is false
    })

    it('mouseup on disabled button does not fire onClick', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.disabled = true

      // Force depressed state and focus (simulate edge case)
      btn.depressed = true
      // We can't easily give it focus, but the handler checks isDisabled
      // and won't fire onMouseUp if disabled

      let clicked = false
      btn.onClick = () => {
        clicked = true
      }

      btn.handleEvent(makeMouseEvent('mouseup', { clientX: 50, clientY: 20 }))

      // Should not click because no focus
      expect(clicked).toBe(false)
    })

    it('mousemove updates depressed based on bounds containment', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      // First acquire focus via mousedown
      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))
      expect(btn.depressed).toBe(true)

      // Move outside bounds
      btn.handleEvent(
        makeMouseEvent('mousemove', { clientX: 300, clientY: 300 }),
      )
      expect(btn.depressed).toBe(false)

      // Move back inside bounds
      btn.handleEvent(makeMouseEvent('mousemove', { clientX: 50, clientY: 20 }))
      expect(btn.depressed).toBe(true)
    })

    it('mousemove without focus does not change depressed', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.depressed = false

      btn.handleEvent(makeMouseEvent('mousemove', { clientX: 50, clientY: 20 }))

      // Without focus, depressed should not change
      expect(btn.depressed).toBe(false)
    })

    it('ignores non-left button clicks', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const result = btn.handleEvent(
        makeMouseEvent('mousedown', {
          clientX: 50,
          clientY: 20,
          button: 2, // right button
        }),
      )

      expect(result).toBe(false)
      expect(btn.depressed).toBe(false)
    })

    it('double click fires onDoubleClick', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      // Acquire focus
      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))

      let doubleClicked = false
      let singleClicked = false
      btn.onDoubleClick = () => {
        doubleClicked = true
      }
      btn.onClick = () => {
        singleClicked = true
      }

      // Double-click mouseup
      btn.handleEvent(
        makeMouseEvent('mouseup', {
          clientX: 50,
          clientY: 20,
          multiTapCount: 2,
        }),
      )

      expect(doubleClicked).toBe(true)
      // Double-click should not also trigger single click
      expect(singleClicked).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Keyboard event handling — HandleKeyPress
  // ---------------------------------------------------------------------------

  describe('handleEvent — keyboard', () => {
    it('triggers onKeyPress when matching hotkey is pressed', () => {
      const btn = new ButtonWidget()
      // Set a hotkey matching 'Enter' (KeyCode.RETURN)
      btn.key = new Hotkey(KeyCode.RETURN, 0)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      const result = btn.handleEvent(makeKeyEvent('Enter'))

      expect(keyPressed).toBe(true)
      expect(result).toBe(true)
    })

    it('does not trigger when hotkey does not match', () => {
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.RETURN, 0)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      const result = btn.handleEvent(makeKeyEvent('Escape'))

      expect(keyPressed).toBe(false)
      expect(result).toBe(false)
    })

    it('returns false when no hotkey is set', () => {
      const btn = new ButtonWidget()
      btn.key = null

      const result = btn.handleEvent(makeKeyEvent('Enter'))
      expect(result).toBe(false)
    })

    it('plays click sound on keypress when not disabled', () => {
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.SPACE, 0)
      btn.clickSound = 'key-sound'

      const sounds: string[] = []
      ButtonWidget.soundPlayer = (name: string) => sounds.push(name)

      btn.handleEvent(makeKeyEvent(' '))

      expect(sounds).toContain('key-sound')
    })

    it('plays disabled sound on keypress when disabled', () => {
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.SPACE, 0)
      btn.disabled = true
      btn.clickDisabledSound = 'disabled-key-sound'

      const sounds: string[] = []
      ButtonWidget.soundPlayer = (name: string) => sounds.push(name)

      btn.handleEvent(makeKeyEvent(' '))

      expect(sounds).toContain('disabled-key-sound')
    })

    it('suppresses sound when disableKeySound is true', () => {
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.RETURN, 0)
      btn.disableKeySound = true

      const sounds: string[] = []
      ButtonWidget.soundPlayer = (name: string) => sounds.push(name)

      btn.handleEvent(makeKeyEvent('Enter'))

      expect(sounds).toHaveLength(0)
    })

    it('handles disableKeyRepeat by consuming event but not acting', () => {
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.RETURN, 0)
      btn.disableKeyRepeat = true

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      const result = btn.handleEvent(
        makeKeyEvent('Enter', { repeat: true }),
      )

      // Should consume event but not trigger action
      expect(result).toBe(true)
      expect(keyPressed).toBe(false)
    })

    it('does NOT fire when modifier-required hotkey pressed without modifiers', () => {
      // Hotkey: Ctrl+S, pressing plain S should not activate
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.S, Modifiers.Ctrl)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      // Press plain 's' without Ctrl modifier
      const result = btn.handleEvent(
        makeKeyEvent('s', { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }),
      )

      expect(keyPressed).toBe(false)
      expect(result).toBe(false)
    })

    it('fires when modifier-required hotkey pressed with correct modifiers', () => {
      // Hotkey: Ctrl+S, pressing Ctrl+S should activate
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.S, Modifiers.Ctrl)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      // Press 's' with Ctrl modifier
      const result = btn.handleEvent(
        makeKeyEvent('s', { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }),
      )

      expect(keyPressed).toBe(true)
      expect(result).toBe(true)
    })

    it('does NOT fire when extra modifiers are pressed beyond what hotkey requires', () => {
      // Hotkey: Ctrl+S, pressing Ctrl+Shift+S should NOT activate
      // (OpenRA: IsActivatedBy does exact modifier equality)
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.S, Modifiers.Ctrl)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      // Press 's' with Ctrl+Shift modifiers (extra Shift)
      const result = btn.handleEvent(
        makeKeyEvent('s', { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }),
      )

      expect(keyPressed).toBe(false)
      expect(result).toBe(false)
    })

    it('does NOT fire when hotkey has no modifiers but event has modifiers', () => {
      // Hotkey: S (no modifier), pressing Ctrl+S should NOT activate
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.S, Modifiers.None)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      // Press 's' with Ctrl modifier (hotkey requires none)
      const result = btn.handleEvent(
        makeKeyEvent('s', { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }),
      )

      expect(keyPressed).toBe(false)
      expect(result).toBe(false)
    })

    it('fires when hotkey has multiple modifiers and event matches exactly', () => {
      // Hotkey: Ctrl+Shift+Enter, pressing Ctrl+Shift+Enter should activate
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.RETURN, Modifiers.Ctrl | Modifiers.Shift)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      const result = btn.handleEvent(
        makeKeyEvent('Enter', { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }),
      )

      expect(keyPressed).toBe(true)
      expect(result).toBe(true)
    })

    it('does NOT fire when hotkey has multiple modifiers but event misses one', () => {
      // Hotkey: Ctrl+Shift+Enter, pressing only Ctrl+Enter should NOT activate
      const btn = new ButtonWidget()
      btn.key = new Hotkey(KeyCode.RETURN, Modifiers.Ctrl | Modifiers.Shift)

      let keyPressed = false
      btn.onKeyPress = () => {
        keyPressed = true
      }

      const result = btn.handleEvent(
        makeKeyEvent('Enter', { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }),
      )

      expect(keyPressed).toBe(false)
      expect(result).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // YieldMouseFocus — resets Depressed
  // ---------------------------------------------------------------------------

  describe('yieldMouseFocus', () => {
    it('resets depressed to false', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      // Acquire focus and set depressed
      btn.handleEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 20 }))
      expect(btn.depressed).toBe(true)

      btn.yieldMouseFocus()
      expect(btn.depressed).toBe(false)
      expect(btn.hasMouseFocus).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // TooltipContainer integration
  // ---------------------------------------------------------------------------

  describe('tooltipContainer', () => {
    it('tooltipContainer is null by default (no resolver)', () => {
      const btn = new ButtonWidget()
      expect(btn.tooltipContainer).toBeNull()
      expect(btn.isTooltipContainerCreated).toBe(true) // lazy accessed
    })

    it('tooltipContainer lazy init works with resolver', () => {
      const btn = new ButtonWidget()
      const tc = makeTooltipContainer()
      btn.setTooltipContainerResolver(() => tc)

      expect(btn.isTooltipContainerCreated).toBe(false)
      const container = btn.tooltipContainer
      expect(btn.isTooltipContainerCreated).toBe(true)
      expect(container).toBe(tc)
    })

    it('mouseEntered sets tooltip when getTooltipText is defined', () => {
      const btn = new ButtonWidget()
      const tc = makeTooltipContainer()
      btn.setTooltipContainerResolver(() => tc)
      btn.tooltipContainerId = 'tooltip-container'
      btn.tooltipTemplate = 'MY_TIP'
      btn.getTooltipText = () => 'Button Tooltip'

      btn.mouseEntered()

      expect(tc._tooltips).toHaveLength(1)
      expect(tc._tooltips[0].template).toBe('MY_TIP')
      expect((tc._tooltips[0].args as any).getText()).toBe('Button Tooltip')
    })

    it('mouseEntered does nothing when tooltipContainerId is null', () => {
      const btn = new ButtonWidget()
      const tc = makeTooltipContainer()
      btn.setTooltipContainerResolver(() => tc)
      btn.tooltipContainerId = null
      btn.getTooltipText = () => 'Tooltip'

      btn.mouseEntered()

      expect(tc._tooltips).toHaveLength(0)
    })

    it('mouseEntered does nothing when getTooltipText is null', () => {
      const btn = new ButtonWidget()
      const tc = makeTooltipContainer()
      btn.setTooltipContainerResolver(() => tc)
      btn.tooltipContainerId = 'tooltip-container'
      btn.getTooltipText = null

      btn.mouseEntered()

      expect(tc._tooltips).toHaveLength(0)
    })

    it('mouseExited removes tooltip', () => {
      const btn = new ButtonWidget()
      const tc = makeTooltipContainer()
      btn.setTooltipContainerResolver(() => tc)
      btn.tooltipContainerId = 'tooltip-container'
      // Access tooltipContainer to mark it as created
      btn.tooltipContainer

      btn.mouseExited()

      expect(tc._removed).toBe(true)
    })

    it('mouseExited does nothing when tooltipContainer not created', () => {
      const btn = new ButtonWidget()
      btn.tooltipContainerId = 'tooltip-container'
      // Don't access tooltipContainer — not created yet

      // Should not throw
      expect(() => btn.mouseExited()).not.toThrow()
    })

    it('mouseEntered sets hovered to true', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      // The button records hover state; since _hovered is private,
      // we verify via data-state attribute
      btn.mouseEntered()
      const el = btn.render()
      expect(el.getAttribute('data-state')).toBe('hover')
    })

    it('mouseExited clears hovered', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.mouseEntered()
      btn.mouseExited()
      const el = btn.render()
      expect(el.getAttribute('data-state')).toBe('normal')
    })
  })

  // ---------------------------------------------------------------------------
  // GetCursor / ChildOrigin / UsableWidth
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns the cursor property', () => {
      const btn = new ButtonWidget()
      btn.cursor = 'crosshair'
      expect(btn.getCursor({ x: 0, y: 0 })).toBe('crosshair')
    })

    it('returns default pointer cursor by default', () => {
      const btn = new ButtonWidget()
      expect(btn.getCursor({ x: 0, y: 0 })).toBe('pointer')
    })
  })

  describe('childOrigin', () => {
    it('returns zero offset when not depressed', () => {
      const btn = new ButtonWidget()
      btn.depressed = false
      expect(btn.childOrigin).toEqual({ x: 0, y: 0 })
    })

    it('returns visualHeight offset when depressed', () => {
      const btn = new ButtonWidget()
      btn.depressed = true
      btn.visualHeight = 3
      expect(btn.childOrigin).toEqual({ x: 3, y: 3 })
    })
  })

  describe('usableWidth', () => {
    it('returns bounds.width to match OpenRA (margins handled by CSS flexbox)', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.leftMargin = 10
      btn.rightMargin = 20
      // OpenRA: UsableWidth returns Bounds.Width (full width).
      // Margins are applied separately in GetTextPosition; CSS flexbox handles centering.
      expect(btn.usableWidth).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('renders a div with button-widget class', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      expect(el.tagName.toLowerCase()).toBe('div')
      expect(el.classList.contains('button-widget')).toBe(true)
    })

    it('sets data-state to normal by default', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      expect(el.getAttribute('data-state')).toBe('normal')
    })

    it('sets data-state to disabled when disabled', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.disabled = true
      const el = btn.render()
      expect(el.getAttribute('data-state')).toBe('disabled')
    })

    it('sets data-state to pressed when depressed', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.depressed = true
      const el = btn.render()
      expect(el.getAttribute('data-state')).toBe('pressed')
    })

    it('sets data-highlighted when highlighted', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.highlighted = true
      const el = btn.render()
      expect(el.getAttribute('data-highlighted')).toBe('true')
    })

    it('sets data-widget-id when id is present', () => {
      const btn = new ButtonWidget()
      btn.id = 'my-button'
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      expect(el.getAttribute('data-widget-id')).toBe('my-button')
    })

    it('sets data-background attribute', () => {
      const btn = new ButtonWidget()
      btn.background = 'my-panel'
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      expect(el.getAttribute('data-background')).toBe('my-panel')
    })

    it('sets cursor style to not-allowed when disabled', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      btn.disabled = true
      const el = btn.render()
      expect(el.style.cursor).toBe('not-allowed')
    })

    it('renders text in a span element', () => {
      const btn = new ButtonWidget()
      btn.text = 'My Button'
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      const span = el.querySelector('[data-button-text]')
      expect(span).not.toBeNull()
      expect(span!.textContent).toBe('My Button')
    })

    it('does not render text span when text is empty', () => {
      const btn = new ButtonWidget()
      btn.text = ''
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      const span = el.querySelector('[data-button-text]')
      expect(span).toBeNull()
    })

    it('uses getText delegate for dynamic text', () => {
      const btn = new ButtonWidget()
      btn.getText = () => 'Dynamic Text'
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }
      const el = btn.render()
      const span = el.querySelector('[data-button-text]')
      expect(span!.textContent).toBe('Dynamic Text')
    })

    it('applies text color based on disabled state', () => {
      const btn = new ButtonWidget()
      btn.text = 'Color'
      btn.textColor = '#FF0000'
      btn.textColorDisabled = '#888888'
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      // Enabled
      const el1 = btn.render()
      const span1 = el1.querySelector('[data-button-text]') as HTMLElement
      expect(span1.style.color).toMatch(/#FF0000|rgb\(255,\s*0,\s*0\)/i)

      // Disabled
      btn.disabled = true
      const el2 = btn.render()
      const span2 = el2.querySelector('[data-button-text]') as HTMLElement
      expect(span2.style.color).toMatch(/#888888|rgb\(136,\s*136,\s*136\)/i)
    })

    it('applies depressed transform when depressed', () => {
      const btn = new ButtonWidget()
      btn.text = 'Pressed'
      btn.visualHeight = 3
      btn.depressed = true
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el = btn.render()
      const span = el.querySelector('[data-button-text]') as HTMLElement
      expect(span.style.transform).toContain('translate')
    })

    it('applies text alignment via flexbox', () => {
      const btn = new ButtonWidget()
      btn.text = 'Aligned'
      btn.align = TextAlign.Left
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el = btn.render()
      const span = el.querySelector('[data-button-text]') as HTMLElement
      expect(span.style.justifyContent).toBe('flex-start')
    })

    it('caches the DOM element via getOrCreateElement', () => {
      const btn = new ButtonWidget()
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el1 = btn.render()
      const el2 = btn.render()
      expect(el1).toBe(el2) // same element returned
    })
  })

  // ---------------------------------------------------------------------------
  // DrawBackground — static method
  // ---------------------------------------------------------------------------

  describe('getBackgroundStyle (static)', () => {
    it('returns empty object for empty baseName', () => {
      const style = ButtonWidget.getBackgroundStyle('', false, false, false, false)
      expect(style).toEqual({})
    })

    it('returns disabled style when disabled', () => {
      const style = ButtonWidget.getBackgroundStyle(
        'button',
        true,
        false,
        false,
        false,
      )
      expect((style as any).backgroundColor).toBe('#555555')
    })

    it('returns pressed style when pressed', () => {
      const style = ButtonWidget.getBackgroundStyle(
        'button',
        false,
        true,
        false,
        false,
      )
      expect((style as any).backgroundColor).toBe('#1a3a5c')
      expect((style as any).boxShadow).toContain('inset')
    })

    it('returns hover style when hover', () => {
      const style = ButtonWidget.getBackgroundStyle(
        'button',
        false,
        false,
        true,
        false,
      )
      expect((style as any).backgroundColor).toBe('#2a5a8c')
    })

    it('returns highlighted variant when highlighted', () => {
      const style = ButtonWidget.getBackgroundStyle(
        'button',
        false,
        false,
        false,
        true,
      )
      expect((style as any)['--button-bg-name']).toBe('button-highlighted')
    })

    it('returns disabled-pressed variant when both', () => {
      const style = ButtonWidget.getBackgroundStyle(
        'panel',
        true,
        true,
        false,
        false,
      )
      expect((style as any)['--button-bg-name']).toBe('panel-disabled-pressed')
    })
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe('clone', () => {
    it('creates a copy with identical properties', () => {
      const btn = new ButtonWidget()
      btn.id = 'test-btn'
      btn.text = 'Clone Me'
      btn.align = TextAlign.Left
      btn.leftMargin = 10
      btn.rightMargin = 20
      btn.background = 'my-panel'
      btn.visualHeight = 4
      btn.font = 'bold 16px Arial'
      btn.textColor = '#123456'
      btn.textColorDisabled = '#654321'
      btn.contrast = true
      btn.shadow = false
      btn.highlighted = true
      btn.depressed = true
      btn.disabled = false
      btn.bounds = { x: 10, y: 20, width: 150, height: 50 }

      const cloned = btn.clone()

      expect(cloned).toBeInstanceOf(ButtonWidget)
      expect(cloned.id).toBe('test-btn')
      expect(cloned.text).toBe('Clone Me')
      expect(cloned.align).toBe(TextAlign.Left)
      expect(cloned.leftMargin).toBe(10)
      expect(cloned.rightMargin).toBe(20)
      expect(cloned.background).toBe('my-panel')
      expect(cloned.visualHeight).toBe(4)
      expect(cloned.font).toBe('bold 16px Arial')
      expect(cloned.textColor).toBe('#123456')
      expect(cloned.textColorDisabled).toBe('#654321')
      expect(cloned.contrast).toBe(true)
      expect(cloned.shadow).toBe(false)
      expect(cloned.highlighted).toBe(true)
      expect(cloned.depressed).toBe(true)
      expect(cloned.disabled).toBe(false)
      expect(cloned.bounds.x).toBe(10)
      expect(cloned.bounds.y).toBe(20)
      expect(cloned.bounds.width).toBe(150)
      expect(cloned.bounds.height).toBe(50)
    })

    it('clone is independent of original', () => {
      const btn = new ButtonWidget()
      btn.text = 'Original'
      btn.bounds = { x: 0, y: 0, width: 100, height: 30 }

      const cloned = btn.clone()
      cloned.text = 'Cloned'
      cloned.bounds = { x: 50, y: 50, width: 200, height: 40 }

      expect(btn.text).toBe('Original')
      expect(cloned.text).toBe('Cloned')
      expect(btn.bounds.x).toBe(0)
      expect(cloned.bounds.x).toBe(50)
    })

    it('clone resets onMouseUp/onKeyPress to trigger its own onClick', () => {
      // NOTE: OpenRA's copy constructor does NOT copy OnClick from source.
      // It resets OnMouseUp/OnKeyPress to invoke the clone's own OnClick
      // (which remains the default no-op). This matches OpenRA behavior:
      // callers must set OnClick on cloned buttons explicitly.
      const btn = new ButtonWidget()
      btn.onClick = () => {
        /* source click */
      }

      const cloned = btn.clone()

      // Clone's onMouseUp should trigger clone's own onClick (no-op)
      // Verify the clone has its own onClick (default no-op)
      let cloneClicked = false
      cloned.onClick = () => {
        cloneClicked = true
      }

      cloned.onMouseUp?.(makeMouseEvent('mouseup'))
      expect(cloneClicked).toBe(true)

      // onKeyPress should also trigger cloned onClick
      let cloneKeyClicked = false
      cloned.onClick = () => {
        cloneKeyClicked = true
      }

      cloned.onKeyPress?.(makeKeyEvent('Enter'))
      expect(cloneKeyClicked).toBe(true)
    })

    it('clone copies children', () => {
      const btn = new ButtonWidget()
      const child = new ButtonWidget()
      child.id = 'child-btn'
      btn.addChild(child)

      const cloned = btn.clone()
      expect(cloned.children).toHaveLength(1)
      expect(cloned.children[0].id).toBe('child-btn')
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('renders empty text gracefully', () => {
      const btn = new ButtonWidget()
      btn.text = ''
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el = btn.render()
      expect(el).toBeDefined()
    })

    it('handles zero-size bounds', () => {
      const btn = new ButtonWidget()
      btn.text = 'Zero'
      btn.bounds = { x: 0, y: 0, width: 0, height: 0 }

      const el = btn.render()
      expect(el).toBeDefined()
    })

    it('handles disabled + highlighted combo in render', () => {
      const btn = new ButtonWidget()
      btn.disabled = true
      btn.highlighted = true
      btn.text = 'Disabled Highlighted'
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el = btn.render()
      // disabled takes priority over highlighted in data-state
      expect(el.getAttribute('data-state')).toBe('disabled')
      // but highlighted attribute is still set
      expect(el.getAttribute('data-highlighted')).toBe('true')
    })

    it('handles text contrast with large radius', () => {
      const btn = new ButtonWidget()
      btn.text = 'High Contrast'
      btn.contrast = true
      btn.contrastColorDark = '#000'
      btn.contrastColorLight = '#FFF'
      btn.contrastRadius = 5
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el = btn.render()
      const span = el.querySelector('[data-button-text]') as HTMLElement
      const shadow = span.style.textShadow
      expect(shadow).toContain('5px')
    })

    it('handles text shadow with default radius', () => {
      const btn = new ButtonWidget()
      btn.text = 'Shadow Text'
      btn.shadow = true
      btn.contrastColorDark = '#444'
      btn.contrastRadius = 1
      btn.bounds = { x: 0, y: 0, width: 200, height: 40 }

      const el = btn.render()
      const span = el.querySelector('[data-button-text]') as HTMLElement
      const shadow = span.style.textShadow
      expect(shadow).not.toBe('none')
      expect(shadow).toContain('#444')
    })
  })
})
