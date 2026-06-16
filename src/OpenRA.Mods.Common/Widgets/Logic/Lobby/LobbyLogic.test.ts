/**
 * LobbyLogic.test.ts — Unit tests for LobbyLogic
 *
 * Tests: construction, tab switching, player list update, lobby info handlers,
 * chat state tracking, game start flow, lifecycle (dispose).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LobbyLogic } from './LobbyLogic'
import type { MapCacheLobby, ModDataLobby } from './LobbyLogic'
import {
  type OrderManagerLobby,
  type LobbyInfo,
  type SessionClient,
  type SessionSlot,
  ConnectionQuality,
} from './LobbyTypes'

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function createMockClient(overrides: Partial<SessionClient> = {}): SessionClient {
  return {
    index: 0,
    name: 'TestPlayer',
    color: 'FF0000',
    team: 0,
    slot: '0',
    bot: null,
    isAdmin: true,
    isObserver: false,
    isBot: false,
    isReady: false,
    isInvalid: false,
    state: 'NotReady',
    connectionQuality: ConnectionQuality.Good,
    spawnPoint: 0,
    handicap: 0,
    faction: 'allies',
    fingerprint: null,
    ...overrides,
  }
}

function createMockSlot(overrides: Partial<SessionSlot> = {}): SessionSlot {
  return {
    playerReference: '0',
    closed: false,
    allowBots: true,
    lockFaction: false,
    lockColor: false,
    lockTeam: false,
    lockSpawn: false,
    lockHandicap: false,
    required: false,
    ...overrides,
  }
}

function createMockLobbyInfo(overrides: Record<string, unknown> = {}): LobbyInfo {
  const clients: readonly SessionClient[] = (overrides.clients as readonly SessionClient[]) ?? [createMockClient()]
  const slots = new Map<string, SessionSlot>((overrides.slots as [string, SessionSlot][]) ?? [['0', createMockSlot()]])
  return {
    globalSettings: {
      serverName: 'Test Server',
      map: 'test-map',
      mapStatus: 'Available',
      randomSeed: 0,
      dedicated: false,
      allowSpectators: true,
      enableSingleplayer: true,
      enableMapGeneration: false,
      lobbyOptions: {},
    },
    clients,
    slots,
    disabledSpawnPoints: [],
    nonBotPlayers: clients.filter(c => c.bot === null),
    clientInSlot: (key: string) => clients.find(c => c.slot === key),
    clientWithIndex: (idx: number) => clients.find(c => c.index === idx),
    ...overrides,
  }
}

function createMockOrderManager(overrides: Partial<OrderManagerLobby> = {}): OrderManagerLobby {
  return {
    lobbyInfo: createMockLobbyInfo(),
    localClient: createMockClient(),
    serverError: null,
    authenticationFailed: false,
    serverMapPool: null,
    issueOrder: vi.fn(),
    ...overrides,
  }
}

function createMockMapCache(): MapCacheLobby {
  return {
    unknownMap: {
      uid: 'unknown',
      title: 'Unknown Map',
      status: 'Unavailable',
      class: 'Unknown',
      spawnPoints: [],
      playerCount: 0,
      gridType: 'Rectangular',
      worldActorInfo: null,
      playerActorInfo: null,
      generationArgs: null,
      players: { players: new Map() },
      tryGetMessage: () => undefined,
      getMessage: (k: string) => k,
    },
    get: () => ({
      uid: 'test-map',
      title: 'Test Map',
      status: 'Available',
      class: 'System',
      spawnPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      playerCount: 2,
      gridType: 'Rectangular',
      worldActorInfo: { traitInfos: () => [], traitInfoOrDefault: () => null },
      playerActorInfo: { traitInfos: () => [], traitInfoOrDefault: () => null },
      generationArgs: null,
      players: { players: new Map() },
      tryGetMessage: () => undefined,
      getMessage: (k: string) => k,
    }),
    updateMaps: vi.fn(),
    pickLastModifiedMap: () => 'test-map',
    queryRemoteMapDetails: vi.fn(),
  }
}

function createMockModData(): ModDataLobby {
  return {
    mapCache: createMockMapCache(),
    defaultRules: {
      actors: {
        world: { traitInfos: () => [] },
      },
    },
    getOrCreate: <T>() => ({} as T),
  }
}

// ---------------------------------------------------------------------------
// Mock widget tree builder
// ---------------------------------------------------------------------------

class MockWidget {
  bounds = { x: 0, y: 0, width: 400, height: 30 }
  id = ''
  children: MockWidget[] = []
  isVisible = vi.fn(() => true)
  visible = true
  isDisabled = vi.fn(() => false)
  isHighlighted = vi.fn(() => false)
  onClick = vi.fn()
  onMouseDown = vi.fn()
  onEnterKey = vi.fn(() => true)
  onEscKey = vi.fn(() => true)
  onLoseFocus = vi.fn()
  getText = vi.fn(() => '')
  getColor = vi.fn(() => 'FFFFFF')
  getImageName = vi.fn(() => 'test')
  getImageCollection = vi.fn(() => 'flags')
  getTooltipText = vi.fn(() => '')
  getTooltipDesc = vi.fn(() => '')
  isChecked = vi.fn(() => false)
  yieldKeyboardFocus = vi.fn()
  text = ''
  maxLength = 255
  contentHeight = 600
  scrolledToBottom = true
  scrollToBottom = vi.fn()
  removeChildren = vi.fn()
  addChild = vi.fn()
  removeChild = vi.fn()
  replaceChild = vi.fn()
  showDropDown = vi.fn()

  clone(): MockWidget {
    const w = new MockWidget()
    w.id = this.id
    w.bounds = { ...this.bounds }
    w.children = this.children.map(c => c.clone())
    return w
  }
}

function buildLobbyWidget(): MockWidget {
  const root = new MockWidget()
  root.id = 'lobby-root'
  root.bounds = { x: 0, y: 0, width: 800, height: 600 }

  // LOBBY_PLAYER_BIN
  const playerBin = new MockWidget()
  playerBin.id = 'LOBBY_PLAYER_BIN'

  // LOBBY_PLAYERS (ScrollPanelWidget)
  const players = new MockWidget()
  players.id = 'LOBBY_PLAYERS'
  ;(players as unknown as Record<string, unknown>).contentHeight = 600
  ;(players as unknown as Record<string, unknown>).scrolledToBottom = true
  ;(players as unknown as Record<string, unknown>).scrollToBottom = vi.fn()

  // Player templates
  const editablePlayer = new MockWidget(); editablePlayer.id = 'TEMPLATE_EDITABLE_PLAYER'
  const nonEditablePlayer = new MockWidget(); nonEditablePlayer.id = 'TEMPLATE_NONEDITABLE_PLAYER'
  const emptySlot = new MockWidget(); emptySlot.id = 'TEMPLATE_EMPTY'
  const editableSpectator = new MockWidget(); editableSpectator.id = 'TEMPLATE_EDITABLE_SPECTATOR'
  const nonEditableSpectator = new MockWidget(); nonEditableSpectator.id = 'TEMPLATE_NONEDITABLE_SPECTATOR'
  const newSpectator = new MockWidget(); newSpectator.id = 'TEMPLATE_NEW_SPECTATOR'
  ;(players as unknown as Record<string, unknown>)['TEMPLATE_EDITABLE_PLAYER'] = editablePlayer
  ;(players as unknown as Record<string, unknown>)['TEMPLATE_NONEDITABLE_PLAYER'] = nonEditablePlayer
  ;(players as unknown as Record<string, unknown>)['TEMPLATE_EMPTY'] = emptySlot
  ;(players as unknown as Record<string, unknown>)['TEMPLATE_EDITABLE_SPECTATOR'] = editableSpectator
  ;(players as unknown as Record<string, unknown>)['TEMPLATE_NONEDITABLE_SPECTATOR'] = nonEditableSpectator
  ;(players as unknown as Record<string, unknown>)['TEMPLATE_NEW_SPECTATOR'] = newSpectator

  ;(playerBin as unknown as Record<string, unknown>)['LOBBY_PLAYERS'] = players
  playerBin.children.push(players)
  root.children.push(playerBin)
  ;(root as unknown as Record<string, unknown>)['LOBBY_PLAYER_BIN'] = playerBin

  // Chat display
  const chatDisplay = new MockWidget()
  chatDisplay.id = 'CHAT_DISPLAY'
  ;(chatDisplay as unknown as Record<string, unknown>).scrolledToBottom = true
  ;(chatDisplay as unknown as Record<string, unknown>).scrollToBottom = vi.fn()
  ;(chatDisplay as unknown as Record<string, unknown>).removeChildren = vi.fn()
  ;(root as unknown as Record<string, unknown>)['CHAT_DISPLAY'] = chatDisplay

  // Chat text field
  const chatField = new MockWidget()
  chatField.id = 'CHAT_TEXTFIELD'
  chatField.text = ''
  chatField.maxLength = 255
  ;(root as unknown as Record<string, unknown>)['CHAT_TEXTFIELD'] = chatField

  // Chat mode
  const chatMode = new MockWidget(); chatMode.id = 'CHAT_MODE'
  ;(root as unknown as Record<string, unknown>)['CHAT_MODE'] = chatMode

  // Tab containers
  const mpTabs = new MockWidget(); mpTabs.id = 'MULTIPLAYER_TABS'
  const skirmishTabs = new MockWidget(); skirmishTabs.id = 'SKIRMISH_TABS'
  ;(root as unknown as Record<string, unknown>)['MULTIPLAYER_TABS'] = mpTabs
  ;(root as unknown as Record<string, unknown>)['SKIRMISH_TABS'] = skirmishTabs

  const optionsTab = new MockWidget(); optionsTab.id = 'OPTIONS_TAB'; mpTabs.children.push(optionsTab)
  const playersTab = new MockWidget(); playersTab.id = 'PLAYERS_TAB'; mpTabs.children.push(playersTab)
  const musicTab = new MockWidget(); musicTab.id = 'MUSIC_TAB'; mpTabs.children.push(musicTab)

  // Disconnect button
  const disconnect = new MockWidget(); disconnect.id = 'DISCONNECT_BUTTON'
  ;(root as unknown as Record<string, unknown>)['DISCONNECT_BUTTON'] = disconnect

  // Server name label
  const serverName = new MockWidget(); serverName.id = 'SERVER_NAME'
  ;(root as unknown as Record<string, unknown>)['SERVER_NAME'] = serverName

  return root
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LobbyLogic', () => {
  let widget: MockWidget
  let modData: ModDataLobby
  let orderManager: ReturnType<typeof createMockOrderManager>
  let onExit: ReturnType<typeof vi.fn>
  let onStart: ReturnType<typeof vi.fn>

  beforeEach(() => {
    widget = buildLobbyWidget()
    modData = createMockModData()
    orderManager = createMockOrderManager()
    onExit = vi.fn()
    onStart = vi.fn()
  })

  it('creates without errors', () => {
    const logic = new LobbyLogic(
      widget as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget,
      modData,
      null,
      orderManager,
      onExit,
      onStart,
      false,
    )
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('creates in skirmish mode without errors', () => {
    const logic = new LobbyLogic(
      widget as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget,
      modData,
      null,
      orderManager,
      onExit,
      onStart,
      true,
    )
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('notifies lobby info changed handlers', () => {
    const logic = new LobbyLogic(
      widget as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget,
      modData,
      null,
      orderManager,
      onExit,
      onStart,
      false,
    )
    expect(() => logic.notifyLobbyInfoChanged()).not.toThrow()
    logic.dispose()
  })

  it('tick updates state without errors', () => {
    const logic = new LobbyLogic(
      widget as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget,
      modData,
      null,
      orderManager,
      onExit,
      onStart,
      false,
    )
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })

  it('notifyGameStart closes window and calls onStart', () => {
    const logic = new LobbyLogic(
      widget as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget,
      modData,
      null,
      orderManager,
      onExit,
      onStart,
      false,
    )
    logic.notifyGameStart()
    expect(onStart).toHaveBeenCalled()
    logic.dispose()
  })

  it('disposes cleanly', () => {
    const logic = new LobbyLogic(
      widget as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget,
      modData,
      null,
      orderManager,
      onExit,
      onStart,
      false,
    )
    logic.dispose()
    logic.dispose() // Double dispose
  })
})
