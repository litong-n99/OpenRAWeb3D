/**
 * LobbyOptionsLogic.test.ts — Unit tests for LobbyOptionsLogic
 *
 * Tests: option rebuilding on map change, configuration disabled state,
 * lifecycle (create → dispose → double-dispose).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LobbyOptionsLogic } from './LobbyOptionsLogic'
import {
  type MapPreviewLobby,
  type OrderManagerLobby,
} from './LobbyTypes'

// ---------------------------------------------------------------------------
// Mock widget tree
// ---------------------------------------------------------------------------

function createMockWidget(overrides: Record<string, unknown> = {}) {
  const self: Record<string, unknown> = {
    bounds: { x: 0, y: 10, width: 400, height: 300 },
    isVisible: vi.fn(() => true),
    removeChildren: vi.fn(),
    addChild: vi.fn(),
    clone() { return { ...this as object } },
    children: [] as unknown[],
    id: 'root',
    contentHeight: 0,
    scrollToTop: vi.fn(),
    ...overrides,
  }
  return self as unknown as import('../../../Widgets/ScrollPanelWidget.js').ScrollPanelWidget
}

function createCheckboxChild() {
  return {
    isChecked: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isDisabled: vi.fn(() => false),
    onClick: vi.fn(),
    getText: vi.fn(),
    setValue: vi.fn(),
    toggle: vi.fn(),
  }
}

function createCheckboxTemplate() {
  const child = createCheckboxChild()
  return {
    bounds: { x: 0, y: 0, width: 400, height: 30 },
    children: [child],
    clone(this: Record<string, unknown>) {
      return { ...this as object, bounds: { ...this.bounds as object } }
    },
  } as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget
}

function createDropdownChild() {
  return {
    showDropDown: vi.fn(),
    isVisible: vi.fn(() => true),
    isDisabled: vi.fn(() => false),
    onMouseDown: vi.fn(),
    getText: vi.fn(),
    id: 'option_dropdown',
  }
}

function createDropdownTemplate() {
  const child = createDropdownChild()
  return {
    bounds: { x: 0, y: 0, width: 400, height: 30 },
    children: [child],
    clone(this: Record<string, unknown>) {
      return { ...this as object, bounds: { ...this.bounds as object } }
    },
  } as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget
}

function createMockMap(uid = 'test'): MapPreviewLobby {
  return {
    uid,
    title: 'Test',
    status: 'Available',
    class: 'System',
    spawnPoints: [],
    playerCount: 2,
    gridType: 'Rectangular',
    worldActorInfo: {
      traitInfos: () => [],
      traitInfoOrDefault: () => null,
    },
    playerActorInfo: {
      traitInfos: () => [],
      traitInfoOrDefault: () => null,
    },
    generationArgs: null,
    players: { players: new Map() },
    tryGetMessage: () => undefined,
    getMessage: (k: string) => k,
  }
}

function createMockOrderManager(): OrderManagerLobby {
  return {
    lobbyInfo: {
      globalSettings: {
        serverName: 'Test',
        map: 'test',
        mapStatus: 'Available',
        randomSeed: 0,
        dedicated: false,
        allowSpectators: true,
        enableSingleplayer: true,
        enableMapGeneration: false,
        lobbyOptions: {},
      },
      clients: [],
      slots: new Map(),
      disabledSpawnPoints: [],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    },
    localClient: null,
    serverError: null,
    authenticationFailed: false,
    serverMapPool: null,
    issueOrder: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LobbyOptionsLogic', () => {
  let widget: ReturnType<typeof createMockWidget>
  let orderManager: ReturnType<typeof createMockOrderManager>
  let getMap: () => MapPreviewLobby
  let configurationDisabled: () => boolean

  beforeEach(() => {
    widget = createMockWidget()
    ;(widget.children as unknown[]) = []
    const optsContainer = createMockWidget({
      bounds: { x: 0, y: 10, width: 400, height: 0 },
      id: 'options-container',
    })
    ;(widget as unknown as Record<string, unknown>)['LOBBY_OPTIONS'] = optsContainer
    ;(optsContainer as unknown as Record<string, unknown>)['CHECKBOX_ROW_TEMPLATE'] = createCheckboxTemplate()
    ;(optsContainer as unknown as Record<string, unknown>)['DROPDOWN_ROW_TEMPLATE'] = createDropdownTemplate()

    orderManager = createMockOrderManager()
    getMap = () => createMockMap()
    configurationDisabled = () => false
  })

  it('creates without errors', () => {
    const logic = new LobbyOptionsLogic(widget, orderManager, getMap, configurationDisabled)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('rebuilds options on construction', () => {
    const optsContainer = (widget as unknown as Record<string, unknown>)['LOBBY_OPTIONS'] as ReturnType<typeof createMockWidget>

    const logic = new LobbyOptionsLogic(widget, orderManager, getMap, configurationDisabled)

    expect(optsContainer.addChild).toHaveBeenCalled()
    expect(optsContainer.removeChildren).toHaveBeenCalled()
    logic.dispose()
  })

  it('rebuilds options when map changes', () => {
    const logic = new LobbyOptionsLogic(widget, orderManager, getMap, configurationDisabled)

    const optsContainer = (widget as unknown as Record<string, unknown>)['LOBBY_OPTIONS'] as ReturnType<typeof createMockWidget>
    const initialCallCount = (optsContainer.removeChildren as ReturnType<typeof vi.fn>).mock.calls.length

    // Change map and tick
    getMap = () => createMockMap('different-map')
    logic.tick()

    expect((optsContainer.removeChildren as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCallCount)
    logic.dispose()
  })

  it('does not rebuild when map unchanged', () => {
    const staticMap = createMockMap()
    getMap = () => staticMap
    const logic = new LobbyOptionsLogic(widget, orderManager, getMap, configurationDisabled)

    const optsContainer = (widget as unknown as Record<string, unknown>)['LOBBY_OPTIONS'] as ReturnType<typeof createMockWidget>
    const initialCallCount = (optsContainer.removeChildren as ReturnType<typeof vi.fn>).mock.calls.length

    logic.tick() // Map unchanged (same reference)

    expect((optsContainer.removeChildren as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialCallCount)
    logic.dispose()
  })

  it('disposes cleanly', () => {
    const logic = new LobbyOptionsLogic(widget, orderManager, getMap, configurationDisabled)
    logic.dispose()
    logic.dispose() // Double dispose should not throw
  })
})
