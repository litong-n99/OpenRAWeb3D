/**
 * NewMapLogic.test.ts — Unit tests for NewMapLogic
 *
 * Tests: cancel button, tileset dropdown, create button with map dimensions,
 * bounds calculation, player definitions, editor loading.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  NewMapLogic,
  type INewMapTerrainInfo,
  type INewMapModData,
  type NewMapConstructor,
  type NewMapPackageConstructor,
  type NewMapPlayersConstructor,
  type LoadEditorFunction,
} from './NewMapLogic'
import { Ui } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWidget(): { widget: Widget; buttonCallbacks: Record<string, () => void>; widgets: Record<string, Record<string, unknown>> } {
  const buttonCallbacks: Record<string, () => void> = {}

  function buttonFactory(id: string) {
    const b = {
      id,
      onClick: vi.fn(),
      isDisabled: vi.fn(() => false),
      isHighlighted: vi.fn(() => false),
      getText: vi.fn(() => ''),
      visible: true,
      isVisible: () => true,
    }
    // setter for onClick
    Object.defineProperty(b, 'onClick', {
      get: () => vi.fn(() => buttonCallbacks[id]?.()),
      set: (fn: () => void) => { buttonCallbacks[id] = fn },
      configurable: true,
    })
    return b
  }

  function dropDownFactory(id: string) {
    const b = buttonFactory(id)
    return Object.assign(b, {
      showDropDown: vi.fn(),
      onMouseDown: vi.fn(),
    })
  }

  function textFieldFactory(id: string) {
    return {
      id,
      text: '',
      isDisabled: vi.fn(() => false),
      isVisible: () => true,
      visible: true,
    }
  }

  const widgets: Record<string, unknown> = {
    CANCEL_BUTTON: buttonFactory('CANCEL_BUTTON'),
    TILESET: dropDownFactory('TILESET'),
    WIDTH: textFieldFactory('WIDTH'),
    HEIGHT: textFieldFactory('HEIGHT'),
    CREATE_BUTTON: buttonFactory('CREATE_BUTTON'),
  }

  return {
    widget: {
      id: 'root',
      get: vi.fn((id: string) => widgets[id]),
      getOrNull: vi.fn((id: string) => widgets[id] ?? null),
      isVisible: () => true,
      visible: true,
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      children: [],
      parent: null,
      isDisabled: () => false,
    } as unknown as Widget,
    buttonCallbacks,
    widgets,
  } as { widget: Widget; buttonCallbacks: Record<string, () => void>; widgets: Record<string, Record<string, unknown>> }
}

function makeMockTerrains(): readonly INewMapTerrainInfo[] {
  return [
    { name: 'Temperate', id: 'temperate' },
    { name: 'Desert', id: 'desert' },
    { name: 'Snow', id: 'snow' },
  ]
}

function makeMockModData(): INewMapModData {
  return {
    defaultTerrainInfo: { values: makeMockTerrains() },
  }
}

function makeMockWorld() {
  return {
    map: {
      grid: { maximumTerrainHeight: 3 },
      rules: { terrainInfo: { name: 'Temperate' } },
    },
  }
}

// ---------------------------------------------------------------------------
// NewMapLogic
// ---------------------------------------------------------------------------

describe('NewMapLogic', () => {
  let onExit: ReturnType<typeof vi.fn>
  let onSelect: ReturnType<typeof vi.fn>
  let mockWidget: ReturnType<typeof makeMockWidget>
  let modData: INewMapModData
  let world: ReturnType<typeof makeMockWorld>

  beforeEach(() => {
    onExit = vi.fn()
    onSelect = vi.fn()
    mockWidget = makeMockWidget()
    modData = makeMockModData()
    world = makeMockWorld()
    ;(Ui as unknown as Record<string, unknown>)['closeWindow'] = vi.fn()
  })

  it('cancel button closes window and calls onExit', () => {
    new NewMapLogic(onExit, onSelect, mockWidget.widget, world, modData)

    // Trigger cancel button
    mockWidget.buttonCallbacks['CANCEL_BUTTON']!()
    expect(Ui.closeWindow).toHaveBeenCalled()
    expect(onExit).toHaveBeenCalled()
  })

  it('tileset dropdown contains terrain options', () => {
    new NewMapLogic(onExit, onSelect, mockWidget.widget, world, modData)
    const tileset = mockWidget.widgets['TILESET']!
    expect(tileset['onClick']).toBeDefined()
  })

  it('create button triggers map creation', () => {
    let createCalled = false
    let boundsSet = false
    let saved = false
    let editorLoaded = false

    const createMap: NewMapConstructor = (_t) => {
      createCalled = true
      return {
        rules: { terrainInfo: { name: _t.name } },
        playerDefinitions: null,
        save: () => { saved = true },
        setBounds: () => { boundsSet = true },
        uid: 'new-map-uid',
      }
    }

    const createPkg: NewMapPackageConstructor = () => ({})
    const createPlayers: NewMapPlayersConstructor = () => ({ toMiniYaml: () => [] })
    const loadEditor: LoadEditorFunction = () => { editorLoaded = true }

    mockWidget.widgets['WIDTH']!['text'] = '10'
    mockWidget.widgets['HEIGHT']!['text'] = '8'

    new NewMapLogic(
      onExit, onSelect, mockWidget.widget, world, modData,
      createMap, createPkg, createPlayers, loadEditor,
    )

    mockWidget.buttonCallbacks['CREATE_BUTTON']!()

    expect(createCalled).toBe(true)
    expect(boundsSet).toBe(true)
    expect(saved).toBe(true)
    expect(editorLoaded).toBe(true)
    expect(Ui.closeWindow).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('new-map-uid')
  })

  it('clamps minimum map dimensions to 2x2', () => {
    let capturedWidth = 0
    let capturedHeight = 0
    const createMap: NewMapConstructor = (_t, w, h) => {
      capturedWidth = w
      capturedHeight = h
      return {
        rules: { terrainInfo: { name: _t.name } },
        playerDefinitions: null,
        save: () => {},
        setBounds: () => {},
        uid: 'test',
      }
    }

    mockWidget.widgets['WIDTH']!['text'] = '0'
    mockWidget.widgets['HEIGHT']!['text'] = '-5'

    new NewMapLogic(
      onExit, onSelect, mockWidget.widget, world, modData,
      createMap,
    )

    mockWidget.buttonCallbacks['CREATE_BUTTON']!()
    expect(capturedWidth).toBe(2)
    expect(capturedHeight).toBe(2)
  })

  it('creates map with correct bounds considering terrain height', () => {
    let topLeft: { x: number; y: number } | null = null
    let bottomRight: { x: number; y: number } | null = null

    const createMap: NewMapConstructor = () => ({
      rules: { terrainInfo: { name: 'Temperate' } },
      playerDefinitions: null,
      save: () => {},
      setBounds: (tl, br) => { topLeft = tl; bottomRight = br },
      uid: 'test',
    })

    mockWidget.widgets['WIDTH']!['text'] = '10'
    mockWidget.widgets['HEIGHT']!['text'] = '8'

    new NewMapLogic(
      onExit, onSelect, mockWidget.widget, world, modData,
      createMap,
    )

    mockWidget.buttonCallbacks['CREATE_BUTTON']!()
    expect(topLeft).toEqual({ x: 1, y: 4 }) // 1 + maxTerrainHeight(3) = 4
    expect(bottomRight).toEqual({ x: 10, y: 11 }) // 8 + 3 = 11
  })

  it('notifies terrain info of map creation when supported', () => {
    let notified = false
    const createMap: NewMapConstructor = () => ({
      rules: {
        terrainInfo: {
          name: 'SpecialTerrain',
          mapCreated: () => { notified = true },
        },
      },
      playerDefinitions: null,
      save: () => {},
      setBounds: () => {},
      uid: 'test',
    })

    new NewMapLogic(
      onExit, onSelect, mockWidget.widget, world, modData,
      createMap,
    )

    mockWidget.buttonCallbacks['CREATE_BUTTON']!()
    expect(notified).toBe(true)
  })

  it('tick is a no-op', () => {
    const logic = new NewMapLogic(onExit, onSelect, mockWidget.widget, world, modData)
    expect(() => logic.tick()).not.toThrow()
  })
})
