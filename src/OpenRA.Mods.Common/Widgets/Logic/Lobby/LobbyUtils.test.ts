/**
 * LobbyUtils.test.ts — Unit tests for LobbyUtils static utilities
 *
 * Tests focus on: color calculations, splitOnFirstToken, latency helpers,
 * availableSpawnPoints, insufficientEnabledSpawnPoints.
 *
 * Widget setup functions are tested via mock widget trees.
 */

import { describe, it, expect } from 'vitest'
import {
  getPlayerColor,
  latencyColor,
  latencyDescription,
  splitOnFirstToken,
  availableSpawnPoints,
  insufficientEnabledSpawnPoints,
  slotStateImage,
  clientStateImage,
  hideChildWidget,
} from './LobbyUtils'
import { ConnectionQuality } from './LobbyTypes'
import type { SessionClient, LobbyInfo, MapPreviewLobby } from './LobbyTypes'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockClient(overrides: Partial<SessionClient> = {}): SessionClient {
  return {
    index: 0,
    name: 'TestPlayer',
    color: 'FF0000',
    team: 1,
    slot: '0',
    bot: null,
    isAdmin: false,
    isObserver: false,
    isBot: false,
    isReady: false,
    isInvalid: false,
    state: 'NotReady',
    connectionQuality: ConnectionQuality.Good,
    spawnPoint: 0,
    handicap: 0,
    faction: 'random',
    fingerprint: null,
    ...overrides,
  }
}

function mockMap(overrides: Partial<MapPreviewLobby> = {}): MapPreviewLobby {
  return {
    uid: 'test-map',
    title: 'Test Map',
    status: 'Available',
    class: 'System',
    spawnPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
    playerCount: 4,
    gridType: 'Rectangular',
    worldActorInfo: null,
    playerActorInfo: null,
    generationArgs: null,
    players: { players: new Map() },
    tryGetMessage: () => undefined,
    getMessage: (k: string) => k,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getPlayerColor
// ---------------------------------------------------------------------------

describe('getPlayerColor', () => {
  it('returns white text for dark background', () => {
    expect(getPlayerColor('000000')).toBe('FFFFFF')
    expect(getPlayerColor('333333')).toBe('FFFFFF')
    expect(getPlayerColor('0000FF')).toBe('FFFFFF')
    expect(getPlayerColor('FF0000')).toBe('FFFFFF')
  })

  it('returns black text for light background', () => {
    expect(getPlayerColor('FFFFFF')).toBe('000000')
    expect(getPlayerColor('FFFF00')).toBe('000000')
    expect(getPlayerColor('00FF00')).toBe('000000')
    expect(getPlayerColor('CCCCCC')).toBe('000000')
  })

  it('returns white for mid-luminance colors', () => {
    // 808080 is roughly mid-gray, luminance ~0.216 → white text
    expect(getPlayerColor('808080')).toBe('FFFFFF')
  })
})

// ---------------------------------------------------------------------------
// latencyColor / latencyDescription
// ---------------------------------------------------------------------------

describe('latencyColor', () => {
  it('returns gray for null client', () => {
    expect(latencyColor(null)).toBe('888888')
  })

  it('returns green for good connection', () => {
    expect(latencyColor(mockClient({ connectionQuality: ConnectionQuality.Good }))).toBe('32CD32')
  })

  it('returns orange for moderate connection', () => {
    expect(latencyColor(mockClient({ connectionQuality: ConnectionQuality.Moderate }))).toBe('FFA500')
  })

  it('returns red for poor connection', () => {
    expect(latencyColor(mockClient({ connectionQuality: ConnectionQuality.Poor }))).toBe('FF0000')
  })
})

describe('latencyDescription', () => {
  it('returns Unknown for null client', () => {
    expect(latencyDescription(null)).toBe('Unknown')
  })

  it('returns human-readable descriptions', () => {
    expect(latencyDescription(mockClient({ connectionQuality: ConnectionQuality.Good }))).toBe('Good')
    expect(latencyDescription(mockClient({ connectionQuality: ConnectionQuality.Moderate }))).toBe('Moderate')
    expect(latencyDescription(mockClient({ connectionQuality: ConnectionQuality.Poor }))).toBe('Poor')
  })
})

// ---------------------------------------------------------------------------
// splitOnFirstToken
// ---------------------------------------------------------------------------

describe('splitOnFirstToken', () => {
  it('returns null tuple for null input', () => {
    expect(splitOnFirstToken(null)).toEqual([null, null])
  })

  it('returns input as first for no token found', () => {
    expect(splitOnFirstToken('Hello World')).toEqual(['Hello World', null])
  })

  it('splits on newline by default', () => {
    expect(splitOnFirstToken('First\nSecond')).toEqual(['First', 'Second'])
  })

  it('splits on custom token', () => {
    expect(splitOnFirstToken('Name|Description', '|')).toEqual(['Name', 'Description'])
  })

  it('handles token at start', () => {
    expect(splitOnFirstToken('\nSecond')).toEqual(['', 'Second'])
  })

  it('handles empty input', () => {
    expect(splitOnFirstToken('')).toEqual([null, null])
  })
})

// ---------------------------------------------------------------------------
// slotStateImage / clientStateImage
// ---------------------------------------------------------------------------

describe('slotStateImage', () => {
  it('returns lowercased image name', () => {
    expect(slotStateImage('Open')).toBe('slot-open')
    expect(slotStateImage('CLOSED')).toBe('slot-closed')
  })
})

describe('clientStateImage', () => {
  it('returns lowercased image name', () => {
    expect(clientStateImage('Ready')).toBe('client-ready')
    expect(clientStateImage('NotReady')).toBe('client-notready')
  })
})

// ---------------------------------------------------------------------------
// availableSpawnPoints / insufficientEnabledSpawnPoints
// ---------------------------------------------------------------------------

describe('availableSpawnPoints', () => {
  it('returns all spawn points when none disabled', () => {
    const lobby: LobbyInfo = {
      globalSettings: {} as unknown as LobbyInfo['globalSettings'],
      clients: [],
      slots: new Map(),
      disabledSpawnPoints: [],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    }
    expect(availableSpawnPoints(4, lobby)).toEqual([1, 2, 3, 4])
  })

  it('excludes disabled spawn points', () => {
    const lobby: LobbyInfo = {
      globalSettings: {} as unknown as LobbyInfo['globalSettings'],
      clients: [],
      slots: new Map(),
      disabledSpawnPoints: [2],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    }
    expect(availableSpawnPoints(4, lobby)).toEqual([1, 3, 4])
  })

  it('returns empty for all disabled', () => {
    const lobby: LobbyInfo = {
      globalSettings: {} as unknown as LobbyInfo['globalSettings'],
      clients: [],
      slots: new Map(),
      disabledSpawnPoints: [1, 2, 3, 4],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    }
    expect(availableSpawnPoints(4, lobby)).toEqual([])
  })
})

describe('insufficientEnabledSpawnPoints', () => {
  it('returns false when map has no spawn points', () => {
    const map = mockMap({ spawnPoints: [] })
    const lobby: LobbyInfo = {
      globalSettings: {} as unknown as LobbyInfo['globalSettings'],
      clients: [],
      slots: new Map(),
      disabledSpawnPoints: [],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    }
    expect(insufficientEnabledSpawnPoints(map, lobby)).toBe(false)
  })

  it('returns true when not enough spawns for non-observer clients', () => {
    const map = mockMap({ spawnPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    const lobby: LobbyInfo = {
      globalSettings: {} as unknown as LobbyInfo['globalSettings'],
      clients: [mockClient(), mockClient(), mockClient()],
      slots: new Map(),
      disabledSpawnPoints: [],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    }
    expect(insufficientEnabledSpawnPoints(map, lobby)).toBe(true)
  })

  it('returns false when enough spawn points', () => {
    const map = mockMap({ spawnPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] })
    const lobby: LobbyInfo = {
      globalSettings: {} as unknown as LobbyInfo['globalSettings'],
      clients: [mockClient(), mockClient()],
      slots: new Map(),
      disabledSpawnPoints: [],
      nonBotPlayers: [],
      clientInSlot: () => undefined,
      clientWithIndex: () => undefined,
    }
    expect(insufficientEnabledSpawnPoints(map, lobby)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hideChildWidget
// ---------------------------------------------------------------------------

describe('hideChildWidget', () => {
  it('sets widget isVisible to false', () => {
    const mockWidget = { isVisible: () => true } as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget
    const parent = { child: mockWidget } as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget
    hideChildWidget(parent, 'child')
    expect(mockWidget.isVisible()).toBe(false)
  })

  it('handles missing widget gracefully', () => {
    const parent = {} as unknown as import('../../../../OpenRA.Game/Widgets/Widget.js').Widget
    expect(() => hideChildWidget(parent, 'nonexistent')).not.toThrow()
  })
})
