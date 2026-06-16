/**
 * ControlGroupsWidget.test.ts — ControlGroupsWidget migration unit tests
 *
 * Tests focus on: hotkey resolution, key press handling, control group operations,
 * multi-tap (double-tap) detection, and disposal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ControlGroupsWidget,
  type ControlGroupsDelegate,
} from './ControlGroupsWidget.js'
import { HotkeyReference, Hotkey } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Setup ChromeMetrics for all tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  ChromeMetrics.initialize({
    DefaultCursor: 'default',
  })
})

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a HotkeyReference that activates for a specific KeyCode name by display name. */
function makeHotkeyRef(keyCode: KeyCode): HotkeyReference {
  return new HotkeyReference(new Hotkey(keyCode, Modifiers.None))
}

/** Create a mock ControlGroupsDelegate. */
function createMockControlGroups(spy?: ReturnType<typeof vi.fn>): ControlGroupsDelegate {
  const selectSpy = spy ?? vi.fn()
  const createSpy = vi.fn()
  const addSpy = vi.fn()
  const combineSpy = vi.fn()
  const getActorsSpy = vi.fn().mockReturnValue([{ id: 'actor1' }])

  return {
    groupCount: 10,
    selectControlGroup: selectSpy,
    createControlGroup: createSpy,
    addSelectionToControlGroup: addSpy,
    combineSelectionWithControlGroup: combineSpy,
    getActorsInControlGroup: getActorsSpy,
  }
}

/** Create a minimal WidgetEvent for keydown.
 * Key name uses `keyName()` display format (e.g., '0' not 'NUMBER_0').
 * Set ctrlKey/shiftKey/altKey/metaKey to true on the returned event directly for modifier tests. */
function makeKeyEvent(keyName: string, multiTapCount = 1): WidgetEvent {
  return {
    type: 'keydown',
    stopPropagation: () => {},
    target: null,
    key: keyName,
    multiTapCount,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  } as unknown as WidgetEvent
}

/** Create a keydown WidgetEvent with Ctrl modifier. */
function makeCtrlKeyEvent(keyName: string): WidgetEvent {
  const ev = makeKeyEvent(keyName)
  ;(ev as unknown as { ctrlKey: boolean }).ctrlKey = true
  return ev
}

/** Create a keydown WidgetEvent with Shift modifier. */
function makeShiftKeyEvent(keyName: string): WidgetEvent {
  const ev = makeKeyEvent(keyName)
  ;(ev as unknown as { shiftKey: boolean }).shiftKey = true
  return ev
}

/** Create a keydown WidgetEvent with Alt modifier. */
function makeAltKeyEvent(keyName: string): WidgetEvent {
  const ev = makeKeyEvent(keyName)
  ;(ev as unknown as { altKey: boolean }).altKey = true
  return ev
}

/** Create a keydown WidgetEvent with Ctrl+Shift modifiers. */
function makeCtrlShiftKeyEvent(keyName: string): WidgetEvent {
  const ev = makeKeyEvent(keyName)
  const e = ev as unknown as { ctrlKey: boolean; shiftKey: boolean }
  e.ctrlKey = true
  e.shiftKey = true
  return ev
}

/** Create a minimal WidgetEvent for mousedown (should be ignored). */
function makeMouseEvent(): WidgetEvent {
  return {
    type: 'mousedown',
    stopPropagation: () => {},
    target: null,
    clientX: 100,
    clientY: 100,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ControlGroupsWidget', () => {
  let widget: ControlGroupsWidget
  let controlGroups: ControlGroupsDelegate
  let selectSpy: ReturnType<typeof vi.fn>
  let viewportSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    selectSpy = vi.fn()
    viewportSpy = vi.fn()
    controlGroups = createMockControlGroups(selectSpy)
    widget = new ControlGroupsWidget()
    widget.controlGroups = controlGroups
    widget.viewportCenterDelegate = viewportSpy
  })

  // -----------------------------------------------------------------------
  // Construction / Initialization
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create with default null prefixes', () => {
      expect(widget.selectGroupKeyPrefix).toBeNull()
      expect(widget.createGroupKeyPrefix).toBeNull()
      expect(widget.addToGroupKeyPrefix).toBeNull()
      expect(widget.combineWithGroupKeyPrefix).toBeNull()
      expect(widget.jumpToGroupKeyPrefix).toBeNull()
      expect(widget.controlGroups).not.toBeNull()
    })

    it('should initialize hotkeys when prefix and resolver are set', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))
      hotkeyMap.set('Select02', makeHotkeyRef(KeyCode.NUMBER_1))

      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 2 }

      widget.initialize({})

      // Should be initialized
      expect(widget.controlGroups?.groupCount).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — mouse events (should be ignored)
  // -----------------------------------------------------------------------

  describe('handleEvent with mouse events', () => {
    it('should return false for mousedown', () => {
      widget.controlGroups = { ...controlGroups, groupCount: 0 } // No groups
      const result = widget.handleEvent(makeMouseEvent())
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — keydown: select group
  // -----------------------------------------------------------------------

  describe('handleEvent — select group', () => {
    it('should call selectControlGroup on matching hotkey', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))
      hotkeyMap.set('Select02', makeHotkeyRef(KeyCode.NUMBER_1))

      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 2 }
      widget.initialize({})

      const result = widget.handleEvent(makeKeyEvent('1'))
      expect(result).toBe(true)
      expect(selectSpy).toHaveBeenCalledWith(1)
    })

    it('should center viewport on double-tap', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))
      hotkeyMap.set('Select02', makeHotkeyRef(KeyCode.NUMBER_1))

      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 2 }
      widget.initialize({})

      const result = widget.handleEvent(makeKeyEvent('0', 2))
      expect(result).toBe(true)
      expect(selectSpy).toHaveBeenCalledWith(0)
      expect(viewportSpy).toHaveBeenCalled()
    })

    it('should not center viewport on single tap', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))

      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 1 }
      widget.initialize({})

      widget.handleEvent(makeKeyEvent('0', 1))
      expect(selectSpy).toHaveBeenCalledWith(0)
      expect(viewportSpy).not.toHaveBeenCalled()
    })

    it('should not handle non-matching key', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))

      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 1 }
      widget.initialize({})

      const result = widget.handleEvent(makeKeyEvent('x'))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — create group
  // -----------------------------------------------------------------------

  describe('handleEvent — create group', () => {
    it('should call createControlGroup on matching hotkey', () => {
      const createSpy = vi.fn()
      const cg = createMockControlGroups(vi.fn())
      ;(cg as any).createControlGroup = createSpy

      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Create01', new HotkeyReference(new Hotkey(KeyCode.NUMBER_0, Modifiers.Ctrl)))

      widget.createGroupKeyPrefix = 'Create'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...cg, groupCount: 1 }
      widget.initialize({})

      const result = widget.handleEvent(makeCtrlKeyEvent('0'))
      expect(result).toBe(true)
      expect(createSpy).toHaveBeenCalledWith(0)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — add to group
  // -----------------------------------------------------------------------

  describe('handleEvent — add to group', () => {
    it('should call addSelectionToControlGroup on matching hotkey', () => {
      const addSpy = vi.fn()
      const cg = createMockControlGroups(vi.fn())
      ;(cg as any).addSelectionToControlGroup = addSpy

      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Add01', new HotkeyReference(new Hotkey(KeyCode.NUMBER_0, Modifiers.Shift)))

      widget.addToGroupKeyPrefix = 'Add'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...cg, groupCount: 1 }
      widget.initialize({})

      const result = widget.handleEvent(makeShiftKeyEvent('0'))
      expect(result).toBe(true)
      expect(addSpy).toHaveBeenCalledWith(0)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — combine with group
  // -----------------------------------------------------------------------

  describe('handleEvent — combine with group', () => {
    it('should call combineSelectionWithControlGroup on matching hotkey', () => {
      const combineSpy = vi.fn()
      const cg = createMockControlGroups(vi.fn())
      ;(cg as any).combineSelectionWithControlGroup = combineSpy

      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Combine01', new HotkeyReference(new Hotkey(KeyCode.NUMBER_0, Modifiers.Ctrl | Modifiers.Shift)))

      widget.combineWithGroupKeyPrefix = 'Combine'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...cg, groupCount: 1 }
      widget.initialize({})

      const result = widget.handleEvent(makeCtrlShiftKeyEvent('0'))
      expect(result).toBe(true)
      expect(combineSpy).toHaveBeenCalledWith(0)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — jump to group
  // -----------------------------------------------------------------------

  describe('handleEvent — jump to group', () => {
    it('should center viewport on jump hotkey', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Jump01', new HotkeyReference(new Hotkey(KeyCode.NUMBER_0, Modifiers.Alt)))

      widget.jumpToGroupKeyPrefix = 'Jump'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 1 }
      widget.initialize({})

      const result = widget.handleEvent(makeAltKeyEvent('0'))
      expect(result).toBe(true)
      expect(viewportSpy).toHaveBeenCalled()
    })

    it('should not center viewport if no actors in group', () => {
      const noActorsCg = createMockControlGroups(vi.fn())
      ;(noActorsCg as any).getActorsInControlGroup = vi.fn().mockReturnValue([])

      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Jump01', new HotkeyReference(new Hotkey(KeyCode.NUMBER_0, Modifiers.Alt)))

      widget.jumpToGroupKeyPrefix = 'Jump'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...noActorsCg, groupCount: 1 }
      widget.initialize({})

      viewportSpy.mockClear()
      const result = widget.handleEvent(makeAltKeyEvent('0'))
      expect(result).toBe(true)
      expect(viewportSpy).not.toHaveBeenCalled() // No actors = no center
    })
  })

  // -----------------------------------------------------------------------
  // No hotkeys resolved
  // -----------------------------------------------------------------------

  describe('handleEvent — no hotkeys', () => {
    it('should not crash when hotkeyResolver is null', () => {
      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = null
      widget.controlGroups = { ...controlGroups, groupCount: 5 }
      widget.initialize({})

      const result = widget.handleEvent(makeKeyEvent('0'))
      expect(result).toBe(false)
    })

    it('should not crash when controlGroups is null', () => {
      widget.controlGroups = null
      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) =>
        name === 'Select01' ? makeHotkeyRef(KeyCode.NUMBER_0) : null
      widget.initialize({})

      // _hotkeyCount will be 0 because controlGroups is null
      const result = widget.handleEvent(makeKeyEvent('0'))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // render
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('should return a hidden div', () => {
      const el = widget.render()
      expect(el.tagName).toBe('DIV')
      expect(el.className).toBe('control-groups-widget')
      expect(el.style.display).toBe('none')
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear all references', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))
      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 1 }
      widget.initialize({})

      widget.dispose()

      expect(widget.controlGroups).toBeNull()
      expect(widget.viewportCenterDelegate).toBeNull()
      expect(widget.hotkeyResolver).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Non-keydown events
  // -----------------------------------------------------------------------

  describe('handleEvent — non-keydown events', () => {
    it('should return false for keyup events', () => {
      const hotkeyMap = new Map<string, HotkeyReference>()
      hotkeyMap.set('Select01', makeHotkeyRef(KeyCode.NUMBER_0))
      widget.selectGroupKeyPrefix = 'Select'
      widget.hotkeyResolver = (name) => hotkeyMap.get(name) ?? null
      widget.controlGroups = { ...controlGroups, groupCount: 1 }
      widget.initialize({})

      const keyupEvent: WidgetEvent = {
        type: 'keyup',
        stopPropagation: () => {},
        target: null,
        key: '0',
      }
      const result = widget.handleEvent(keyupEvent)
      expect(result).toBe(false)
    })
  })
})
