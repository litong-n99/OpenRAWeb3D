/**
 * LoadMapEditorLogic.test.ts — Unit tests for LoadMapEditorLogic
 *
 * Tests: construction loads both widget subtrees.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  LoadMapEditorLogic,
  type EditorWidgetLoader,
} from './LoadMapEditorLogic'
import type { Widget, WidgetArgs } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { WorldStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWidget(): Widget {
  return {
    id: 'root',
    get: vi.fn((_id: string) => ({ id: 'WORLD_ROOT' })),
    getOrNull: vi.fn(() => null),
    isVisible: () => true,
    visible: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [],
    parent: null,
    isDisabled: () => false,
  } as unknown as Widget
}

function makeMockWorld(): WorldStub {
  return { actors: [] }
}

// ---------------------------------------------------------------------------
// LoadMapEditorLogic
// ---------------------------------------------------------------------------

describe('LoadMapEditorLogic', () => {
  let widget: Widget
  let world: WorldStub

  beforeEach(() => {
    widget = makeMockWidget()
    world = makeMockWorld()
  })

  it('loads EDITOR_WORLD_ROOT widget subtree', () => {
    const loadCalls: Array<{ name: string; parent: unknown }> = []
    const loader: EditorWidgetLoader = (_w, name, parent, _args) => {
      loadCalls.push({ name, parent })
    }

    new LoadMapEditorLogic(widget, world, loader)

    expect(loadCalls.length).toBe(2)
    expect(loadCalls[0]!.name).toBe('EDITOR_WORLD_ROOT')
  })

  it('loads TRANSIENTS_PANEL widget subtree', () => {
    const loadCalls: Array<{ name: string }> = []
    const loader: EditorWidgetLoader = (_w, name, _parent, _args) => {
      loadCalls.push({ name })
    }

    new LoadMapEditorLogic(widget, world, loader)

    expect(loadCalls.length).toBe(2)
    expect(loadCalls[1]!.name).toBe('TRANSIENTS_PANEL')
  })

  it('passes world to widget loader', () => {
    let passedWorld: WorldStub | null = null
    const loader: EditorWidgetLoader = (w, _name, _parent, _args) => {
      passedWorld = w
    }

    new LoadMapEditorLogic(widget, world, loader)
    expect(passedWorld).toBe(world)
  })

  it('passes empty args to widget loader', () => {
    let passedArgs: WidgetArgs | null = null
    const loader: EditorWidgetLoader = (_w, _name, _parent, args) => {
      passedArgs = args
    }

    new LoadMapEditorLogic(widget, world, loader)
    expect(passedArgs).toEqual({})
  })

  it('uses defaultLoader when no loader provided', () => {
    // Should not throw — defaultLoader is a no-op
    expect(() => new LoadMapEditorLogic(widget, world)).not.toThrow()
  })

  it('tick is a no-op', () => {
    const logic = new LoadMapEditorLogic(widget, world)
    expect(() => logic.tick()).not.toThrow()
  })
})
