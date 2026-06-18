/**
 * EditorQuickSaveHotkeyLogic.test.ts — Unit tests for EditorQuickSaveHotkeyLogic
 *
 * Tests: construction, hotkey activation (modified, not-modified, save failed),
 * save function delegation, dispose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  EditorQuickSaveHotkeyLogic,
  type EditorSaveFunction,
  type ISaveWorld,
} from './EditorQuickSaveHotkeyLogic'
import type { Widget, WidgetArgs } from '../../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const handlerAddCalls: Array<(key: string) => boolean> = []
const handlerRemoveCalls: Array<(key: string) => boolean> = []

function makeMockWidget(): Widget {
  return {
    id: 'root',
    get: vi.fn(() => ({
      addHandler: vi.fn((h: (key: string) => boolean) => { handlerAddCalls.push(h) }),
      removeHandler: vi.fn((h: (key: string) => boolean) => { handlerRemoveCalls.push(h) }),
      clearHandlers: vi.fn(),
    })),
    getOrNull: vi.fn(() => null),
    isVisible: () => true,
    visible: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [],
    parent: null,
    isDisabled: () => false,
  } as unknown as Widget
}

function makeMockWorld(): ISaveWorld {
  return {
    worldActor: {
      traitOrDefault: vi.fn(() => null),
    } as unknown as ISaveWorld['worldActor'],
    map: {
      actorDefinitions: null,
      playerDefinitions: null,
      package: { name: 'test.oramap' },
      uid: 'test-uid',
    },
  }
}

// ---------------------------------------------------------------------------
// EditorQuickSaveHotkeyLogic
// ---------------------------------------------------------------------------

describe('EditorQuickSaveHotkeyLogic', () => {
  let widget: Widget
  let world: ISaveWorld
  let logicArgs: WidgetArgs

  beforeEach(() => {
    handlerAddCalls.length = 0
    handlerRemoveCalls.length = 0
    widget = makeMockWidget()
    world = makeMockWorld()
    logicArgs = {}
  })

  it('constructs with hotkey handler', () => {
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, world, logicArgs, 'Ctrl+S')
    expect(logic).toBeDefined()
    expect(handlerAddCalls.length).toBe(1)
    logic.dispose()
  })

  it('dispose removes handler', () => {
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, world, logicArgs, 'Ctrl+S')
    logic.dispose()
    expect(handlerRemoveCalls.length).toBe(1)
  })

  it('does not save when not modified', () => {
    const testWorld = makeMockWorld()
    ;(testWorld.worldActor.traitOrDefault as ReturnType<typeof vi.fn>).mockReturnValue({
      Modified: false,
      SaveFailed: false,
    })

    let saveCalled = false
    const saveFn: EditorSaveFunction = () => { saveCalled = true }
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, testWorld, logicArgs, 'F5', saveFn)

    const result = logic['onHotkeyActivated']({ key: 'F5', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })
    expect(result).toBe(false)
    expect(saveCalled).toBe(false)
    logic.dispose()
  })

  it('does not save when save failed', () => {
    const testWorld = makeMockWorld()
    ;(testWorld.worldActor.traitOrDefault as ReturnType<typeof vi.fn>).mockReturnValue({
      Modified: true,
      SaveFailed: true,
    })

    let saveCalled = false
    const saveFn: EditorSaveFunction = () => { saveCalled = true }
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, testWorld, logicArgs, 'F5', saveFn)

    const result = logic['onHotkeyActivated']({ key: 'F5', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })
    expect(result).toBe(false)
    expect(saveCalled).toBe(false)
    logic.dispose()
  })

  it('saves when actionManager is null (no editor — falls through)', () => {
    let saveCalled = false
    const saveFn: EditorSaveFunction = () => { saveCalled = true }
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, world, logicArgs, 'F5', saveFn)

    const result = logic['onHotkeyActivated']({ key: 'F5', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })
    expect(result).toBe(true)
    expect(saveCalled).toBe(true)
    logic.dispose()
  })

  it('saves when modified and not save-failed', () => {
    const testWorld = makeMockWorld()
    ;(testWorld.worldActor.traitOrDefault as ReturnType<typeof vi.fn>).mockReturnValue({
      Modified: true,
      SaveFailed: false,
    })

    let saveCalled = false
    let savePath: string | null = null
    const saveFn: EditorSaveFunction = (_md, _w, _m, path) => { saveCalled = true; savePath = path }
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, testWorld, logicArgs, 'F5', saveFn)

    const result = logic['onHotkeyActivated']({ key: 'F5', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })
    expect(result).toBe(true)
    expect(saveCalled).toBe(true)
    expect(savePath).toBe('test.oramap')
    logic.dispose()
  })

  it('tick is a no-op', () => {
    const logic = new EditorQuickSaveHotkeyLogic(widget, {}, world, logicArgs, 'Ctrl+S')
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })
})
