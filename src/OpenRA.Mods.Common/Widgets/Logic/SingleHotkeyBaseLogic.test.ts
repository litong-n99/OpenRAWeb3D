/**
 * SingleHotkeyBaseLogic.test.ts — Unit tests for SingleHotkeyBaseLogic
 *
 * Tests: construction, handler registration, hotkey matching, dispose cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SingleHotkeyBaseLogic,
  hotkeyMatches,
  type KeyInputContext,
} from './SingleHotkeyBaseLogic'
import type { Widget, WidgetArgs } from '../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class ConcreteHotkeyLogic extends SingleHotkeyBaseLogic {
  public activated = false
  public lastCtx: KeyInputContext | null = null

  protected override onHotkeyActivated(ctx: KeyInputContext): boolean {
    this.activated = true
    this.lastCtx = ctx
    return true
  }

  override tick(): void {}
}

function makeMockKeyHandler() {
  const handlers: Array<(key: string) => boolean> = []
  return {
    addHandler: vi.fn((h: (key: string) => boolean) => handlers.push(h)),
    removeHandler: vi.fn((h: (key: string) => boolean) => {
      const idx = handlers.indexOf(h)
      if (idx >= 0) handlers.splice(idx, 1)
    }),
    getHandlers: () => handlers,
    clearHandlers: vi.fn(() => { handlers.length = 0 }),
    handlerCount: 0,
    id: 'keyhandler',
    isVisible: () => true,
  }
}

function makeMockWidget(keyHandler: ReturnType<typeof makeMockKeyHandler>): Widget {
  return {
    id: 'root',
    get: <T>(_id: string): T => keyHandler as unknown as T,
    getOrNull: <T>(_id: string): T | null => keyHandler as unknown as T,
    isVisible: () => true,
    visible: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [],
    parent: null,
    isDisabled: () => false,
    onClick: () => {},
    getText: () => '',
  } as unknown as Widget
}

function makeCtx(key: string, mods: Partial<KeyInputContext> = {}): KeyInputContext {
  return {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  }
}

// ---------------------------------------------------------------------------
// hotkeyMatches
// ---------------------------------------------------------------------------

describe('hotkeyMatches', () => {
  it('matches plain key', () => {
    expect(hotkeyMatches('F5', makeCtx('F5'))).toBe(true)
    expect(hotkeyMatches('F5', makeCtx('F6'))).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(hotkeyMatches('Ctrl+S', makeCtx('s', { ctrlKey: true }))).toBe(true)
    expect(hotkeyMatches('Ctrl+S', makeCtx('S', { ctrlKey: true }))).toBe(true)
  })

  it('matches modifiers', () => {
    expect(hotkeyMatches('Ctrl+S', makeCtx('s', { ctrlKey: true }))).toBe(true)
    expect(hotkeyMatches('Ctrl+S', makeCtx('s', { ctrlKey: false }))).toBe(false)
    expect(hotkeyMatches('Ctrl+S', makeCtx('s', { ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('matches multi-modifier hotkeys', () => {
    expect(hotkeyMatches('Ctrl + Shift + A', makeCtx('a', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(hotkeyMatches('Ctrl + Shift + A', makeCtx('a', { ctrlKey: true, shiftKey: false }))).toBe(false)
  })

  it('returns false for empty hotkey', () => {
    expect(hotkeyMatches('', makeCtx('s'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SingleHotkeyBaseLogic
// ---------------------------------------------------------------------------

describe('SingleHotkeyBaseLogic', () => {
  let keyHandler: ReturnType<typeof makeMockKeyHandler>
  let widget: Widget
  let logicArgs: WidgetArgs

  beforeEach(() => {
    keyHandler = makeMockKeyHandler()
    widget = makeMockWidget(keyHandler)
    logicArgs = {}
  })

  it('constructs and registers handler', () => {
    const logic = new ConcreteHotkeyLogic(widget, {}, 'testKey', 'GLOBAL_KEYHANDLER', logicArgs, 'F5')
    expect(keyHandler.addHandler).toHaveBeenCalledTimes(1)
    logic.dispose()
  })

  it('calls onHotkeyActivated when matching key pressed', () => {
    const logic = new ConcreteHotkeyLogic(widget, {}, 'testKey', 'GLOBAL_KEYHANDLER', logicArgs, 'F5')
    const handlers = keyHandler.getHandlers()
    expect(handlers.length).toBe(1)

    const result = handlers[0]!('F5')
    expect(result).toBe(true)
    expect(logic.activated).toBe(true)
    expect(logic.lastCtx?.key).toBe('F5')
    logic.dispose()
  })

  it('returns false when non-matching key pressed', () => {
    const logic = new ConcreteHotkeyLogic(widget, {}, 'testKey', 'GLOBAL_KEYHANDLER', logicArgs, 'Ctrl+S')
    const handlers = keyHandler.getHandlers()
    expect(handlers.length).toBe(1)

    const result = handlers[0]!('F5')
    expect(result).toBe(false)
    expect(logic.activated).toBe(false)
    logic.dispose()
  })

  it('dispose removes handler from keyHandler', () => {
    const logic = new ConcreteHotkeyLogic(widget, {}, 'testKey', 'GLOBAL_KEYHANDLER', logicArgs, 'F5')
    expect(keyHandler.getHandlers().length).toBe(1)

    logic.dispose()
    expect(keyHandler.removeHandler).toHaveBeenCalledTimes(1)
  })

  it('empty hotkey display never matches', () => {
    const logic = new ConcreteHotkeyLogic(widget, {}, 'testKey', 'GLOBAL_KEYHANDLER', logicArgs, '')
    const handlers = keyHandler.getHandlers()
    expect(handlers.length).toBe(1)

    const result = handlers[0]!('F5')
    expect(result).toBe(false)
    logic.dispose()
  })
})
