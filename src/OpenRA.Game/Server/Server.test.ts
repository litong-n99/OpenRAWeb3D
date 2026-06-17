/**
 * Server.test.ts -- Server unit tests
 *
 * Tests focus on: binary frame construction, player index management,
 * syncClientToPlayerReference, win state tracking, shutdown, server state
 * transitions, and order dispatch logic. WebSocket-dependent features are
 * tested via mock transports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Server, type IClientTransport } from './Server.js'
import { ServerState, ServerType, WinState, defaultServerSettings, SessionClient } from './SessionTypes.js'
import { OrderType } from './ProtocolVersion.js'
import { GameInformation, GameInformationPlayer } from '../GameInformation.js'
import { SYNC_HASH_ORDER_LENGTH } from '../Network/Order.js'

// ---------------------------------------------------------------------------
// Mock ModData
// ---------------------------------------------------------------------------

function createMockModData() {
  return {
    manifest: {
      id: 'test-mod',
      metadata: { version: 'release-2023', title: 'Test Mod' },
      serverTraits: [],
      mounts: [],
    },
    modFiles: {
      dispose: vi.fn(),
      mount: vi.fn(),
      exists: vi.fn(() => false),
    },
    objectCreator: {
      register: vi.fn(),
      createObject: vi.fn(() => null),
      getType: vi.fn(() => undefined),
      dispose: vi.fn(),
      registeredNames: [],
    },
    mapCache: {
      *[Symbol.iterator]() {
        // empty cache
      },
      dispose: vi.fn(),
    },
    dispose: vi.fn(),
  } as any
}

// ---------------------------------------------------------------------------
// Mock Transport
// ---------------------------------------------------------------------------

function createMockTransport() {
  const onConnectionHandlers: Array<(transport: IClientTransport) => void> = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transport = {
    listen: vi.fn(async (_port: number) => {}),
    onConnection: vi.fn((handler: (transport: IClientTransport) => void) => {
      onConnectionHandlers.push(handler)
    }),
    close: vi.fn(async () => {}),
    getLocalEndpoints: vi.fn(() => ['127.0.0.1:1234', '[::1]:1234']),
    _triggerConnection: (clientTransport: IClientTransport) => {
      for (const h of onConnectionHandlers) h(clientTransport)
    },
  } as any

  return transport
}

function createMockClientTransport(remoteAddr: string = '127.0.0.1:54321') {
  const msgHandlers: Array<(data: Uint8Array) => void> = []
  const closeHandlers: Array<() => void> = []
  const errorHandlers: Array<(err: Error) => void> = []

  const sendFn = vi.fn(() => true)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ct = {
    send: sendFn,
    onMessage: vi.fn((handler) => { msgHandlers.push(handler) }),
    onClose: vi.fn((handler) => { closeHandlers.push(handler) }),
    onError: vi.fn((handler) => { errorHandlers.push(handler) }),
    close: vi.fn(),
    remoteAddress: remoteAddr,
    _triggerMessage: (data: Uint8Array) => {
      for (const h of msgHandlers) h(data)
    },
    _triggerClose: () => {
      for (const h of closeHandlers) h()
    },
    _triggerError: (err: Error) => {
      for (const h of errorHandlers) h(err)
    },
  } as any

  return ct
}

// ---------------------------------------------------------------------------
// Helper: create a test server
// ---------------------------------------------------------------------------

function createTestServer(type: ServerType = ServerType.Local) {
  const transport = createMockTransport()
  const modData = createMockModData()
  const settings = defaultServerSettings('Test Server')
  settings.listenPort = 1234

  const server = new Server(transport, settings, modData as any, type)
  return { server, transport, modData, settings }
}

// ---------------------------------------------------------------------------
// Binary Frame Construction Tests
// ---------------------------------------------------------------------------

describe('Server.createFrame', () => {
  it('produces correct byte layout with known test vector', () => {
    const data = new Uint8Array([0x41, 0x42, 0x43]) // "ABC"
    const frame = Server.createFrame(1, 42, data)

    expect(frame.length).toBe(15) // 12 header + 3 data

    const view = new DataView(frame.buffer)
    // Length field: data.length + 4 = 3 + 4 = 7
    expect(view.getInt32(0, true)).toBe(7)
    // Client field
    expect(view.getInt32(4, true)).toBe(1)
    // Frame field
    expect(view.getInt32(8, true)).toBe(42)
    // Data
    expect(frame[12]).toBe(0x41)
    expect(frame[13]).toBe(0x42)
    expect(frame[14]).toBe(0x43)
  })

  it('handles empty data', () => {
    const frame = Server.createFrame(0, 0, new Uint8Array(0))
    expect(frame.length).toBe(12)

    const view = new DataView(frame.buffer)
    expect(view.getInt32(0, true)).toBe(4) // 0 + 4
    expect(view.getInt32(4, true)).toBe(0)
    expect(view.getInt32(8, true)).toBe(0)
  })

  it('handles larger frame numbers', () => {
    const frame = Server.createFrame(5, 1000, new Uint8Array([0xFF]))
    const frameView = new DataView(frame.buffer)
    expect(frameView.getInt32(8, true)).toBe(1000)
  })

  it('uses little-endian encoding for all multi-byte fields', () => {
    const data = new Uint8Array(4)
    const frame = Server.createFrame(0x01020304, 0x05060708, data)
    // Verify little-endian by checking raw byte order
    const clientBytes = new Uint8Array(frame.buffer, 4, 4)
    expect(clientBytes[0]).toBe(0x04) // LSB first
    expect(clientBytes[1]).toBe(0x03)
    expect(clientBytes[2]).toBe(0x02)
    expect(clientBytes[3]).toBe(0x01)
  })
})

describe('Server.createAckFrame', () => {
  it('produces correct byte layout', () => {
    const frame = Server.createAckFrame(42, 1)

    expect(frame.length).toBe(14)
    const view = new DataView(frame.buffer)

    // Length = 6 (4 bytes client + 2 bytes data)
    expect(view.getInt32(0, true)).toBe(6)
    // Client = 0
    expect(view.getInt32(4, true)).toBe(0)
    // Frame
    expect(view.getInt32(8, true)).toBe(42)
    // OrderType.Ack = 0x10
    expect(frame[12]).toBe(0x10)
    // Count
    expect(frame[13]).toBe(1)
  })

  it('handles count up to 255 (byte range)', () => {
    const frame = Server.createAckFrame(0, 255)
    expect(frame[13]).toBe(255)
  })
})

describe('Server.createTickScaleFrame', () => {
  it('produces correct byte layout', () => {
    const frame = Server.createTickScaleFrame(1.5)

    expect(frame.length).toBe(17)
    const view = new DataView(frame.buffer)

    // Length = 9
    expect(view.getInt32(0, true)).toBe(9)
    // Client = 0
    expect(view.getInt32(4, true)).toBe(0)
    // Frame = 0
    expect(view.getInt32(8, true)).toBe(0)
    // OrderType.TickScale = 0x76
    expect(frame[12]).toBe(0x76)
    // Scale (float32 LE)
    expect(view.getFloat32(13, true)).toBeCloseTo(1.5, 2)
  })

  it('handles scale of 1.0', () => {
    const frame = Server.createTickScaleFrame(1.0)
    const view = new DataView(frame.buffer)
    expect(view.getFloat32(13, true)).toBeCloseTo(1.0, 2)
  })
})

// ---------------------------------------------------------------------------
// Server Construction Tests
// ---------------------------------------------------------------------------

describe('Server construction', () => {
  it('initializes with correct ServerState (WaitingPlayers)', () => {
    const { server } = createTestServer()
    expect(server.state).toBe(ServerState.WaitingPlayers)
  })

  it('creates LobbyInfo with RandomSeed, ServerName, GameUid', () => {
    const { server } = createTestServer()
    expect(server.lobbyInfo).toBeDefined()
    expect(server.lobbyInfo.globalSettings.serverName).toBe('Test Server')
    expect(server.lobbyInfo.globalSettings.gameUid).toBeTruthy()
    expect(server.lobbyInfo.globalSettings.gameUid.length).toBeGreaterThan(0)
  })

  it('isMultiplayer returns correct value for each ServerType', () => {
    const local = createTestServer(ServerType.Local).server
    expect(local.isMultiplayer).toBe(false)

    const skirmish = createTestServer(ServerType.Skirmish).server
    expect(skirmish.isMultiplayer).toBe(false)

    const mp = createTestServer(ServerType.Multiplayer).server
    expect(mp.isMultiplayer).toBe(true)

    const dedicated = createTestServer(ServerType.Dedicated).server
    expect(dedicated.isMultiplayer).toBe(true)
  })

  it('registers onConnection handler on transport', () => {
    const { transport } = createTestServer()
    expect(transport.onConnection).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// chooseFreePlayerIndex Tests
// ---------------------------------------------------------------------------

describe('Server.chooseFreePlayerIndex', () => {
  it('increments on each call', () => {
    const { server } = createTestServer()
    expect(server.chooseFreePlayerIndex()).toBe(0)
    expect(server.chooseFreePlayerIndex()).toBe(1)
    expect(server.chooseFreePlayerIndex()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// syncClientToPlayerReference Tests
// ---------------------------------------------------------------------------

describe('Server.syncClientToPlayerReference', () => {
  it('applies locked faction', () => {
    const client = new SessionClient()
    client.faction = 'Random'
    const pr = {
      faction: 'allies',
      lockFaction: true,
    }

    Server.syncClientToPlayerReference(client, pr)
    expect(client.faction).toBe('allies')
  })

  it('does not change faction when not locked', () => {
    const client = new SessionClient()
    client.faction = 'Random'
    const pr = {
      faction: 'allies',
      lockFaction: false,
    }

    Server.syncClientToPlayerReference(client, pr)
    expect(client.faction).toBe('Random')
  })

  it('applies locked spawn point', () => {
    const client = new SessionClient()
    client.spawnPoint = 0
    const pr = { spawn: 3, lockSpawn: true }
    Server.syncClientToPlayerReference(client, pr)
    expect(client.spawnPoint).toBe(3)
  })

  it('applies locked team', () => {
    const client = new SessionClient()
    client.team = 0
    const pr = { team: 2, lockTeam: true }
    Server.syncClientToPlayerReference(client, pr)
    expect(client.team).toBe(2)
  })

  it('applies locked handicap', () => {
    const client = new SessionClient()
    client.handicap = 0
    const pr = { handicap: 50, lockHandicap: true }
    Server.syncClientToPlayerReference(client, pr)
    expect(client.handicap).toBe(50)
  })

  it('applies locked color (overrides preferred color)', () => {
    const client = new SessionClient()
    client.preferredColor = 0xFF0000FF
    client.color = 0xFF0000FF
    const pr = { color: 0x00FF00FF, lockColor: true }
    Server.syncClientToPlayerReference(client, pr)
    expect(client.color).toBe(0x00FF00FF)
  })

  it('uses preferred color when color is not locked', () => {
    const client = new SessionClient()
    client.preferredColor = 0xFF0000FF
    client.color = 0x00FF00FF
    const pr = { color: 0x0000FFFF, lockColor: false }
    Server.syncClientToPlayerReference(client, pr)
    expect(client.color).toBe(client.preferredColor)
  })

  it('handles null player reference gracefully', () => {
    const client = new SessionClient()
    client.faction = 'Random'
    Server.syncClientToPlayerReference(client, null)
    expect(client.faction).toBe('Random')
  })
})

// ---------------------------------------------------------------------------
// Shutdown Tests
// ---------------------------------------------------------------------------

describe('Server.shutdown', () => {
  it('sets state to ShuttingDown', () => {
    const { server } = createTestServer()
    expect(server.state).toBe(ServerState.WaitingPlayers)
    server.shutdown()
    expect(server.state).toBe(ServerState.ShuttingDown)
  })
})

// ---------------------------------------------------------------------------
// getEndpointForLocalConnection Tests
// ---------------------------------------------------------------------------

describe('Server.getEndpointForLocalConnection', () => {
  it('returns loopback endpoints from transport', () => {
    const { server, transport } = createTestServer()
    const target = server.getEndpointForLocalConnection()
    expect(target.endpoints.length).toBeGreaterThan(0)
    expect(transport.getLocalEndpoints).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// mapIsKnown / mapIsUnknown Tests
// ---------------------------------------------------------------------------

describe('Server.mapIsKnown / mapIsUnknown', () => {
  it('empty uid is always unknown', () => {
    const { server } = createTestServer()
    expect(server.mapIsUnknown('')).toBe(true)
    expect(server.mapIsKnown('')).toBe(false)
  })

  it('unknown uid returns true for isUnknown', () => {
    const { server } = createTestServer()
    // With empty MapCache, everything is unknown
    expect(server.mapIsUnknown('some-unknown-map-uid')).toBe(true)
  })

  it('mapIsKnown returns false when mapPool restricts', () => {
    const result = createTestServer()
    const srv = result.server
    // Set a map pool that doesn't contain the UID
    ;(srv as any).mapPool = new Set(['only-this-map'])
    expect(srv.mapIsKnown('some-other-map')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Client Connection Lifecycle Tests (with mocks)
// ---------------------------------------------------------------------------

describe('Server client connection lifecycle', () => {
  let transport: ReturnType<typeof createMockTransport>
  let server: Server
  let clientTransport: ReturnType<typeof createMockClientTransport>

  beforeEach(() => {
    const result = createTestServer(ServerType.Local)
    transport = result.transport
    server = result.server
    clientTransport = createMockClientTransport()
  })

  it('creates a Connection when transport connects during WaitingPlayers', () => {
    transport._triggerConnection(clientTransport)
    expect(server.conns.length).toBe(1)
    const conn = server.conns[0]
    expect(conn.playerIndex).toBe(0)
    expect(conn.validated).toBe(false)
    expect(conn.authToken).toBeTruthy()
  })

  it('sends handshake protocol version on connect', () => {
    transport._triggerConnection(clientTransport)
    expect(clientTransport.send).toHaveBeenCalled()

    // Check that handshake data was sent (ProtocolVersion.Handshake + playerIndex)
    const sentData = (clientTransport.send as any).mock.calls[0][0] as Uint8Array
    expect(sentData.length).toBe(8)
    const view = new DataView(sentData.buffer, sentData.byteOffset, sentData.byteLength)
    expect(view.getInt32(0, true)).toBe(7) // ProtocolVersion.Handshake
    expect(view.getInt32(4, true)).toBe(0) // playerIndex
  })

  it('does not accept connections when game is started', () => {
    server.state = ServerState.GameStarted
    transport._triggerConnection(clientTransport)
    // Connection should not be added because server rejects during GameStarted
    expect(server.conns.length).toBe(0)
  })

  it('_handleConnection ignores connections when not WaitingPlayers', () => {
    server.state = ServerState.ShuttingDown
    transport._triggerConnection(clientTransport)
    expect(server.conns.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Win State Tracking Tests (mock world players)
// ---------------------------------------------------------------------------

describe('Server win state tracking (via _setPlayerDefeat)', () => {
  it('_anyUndefinedWinStates returns false when no game info', () => {
    const { server } = createTestServer()
    // _anyUndefinedWinStates is private; test via invoking directly
    const result = (server as any)._anyUndefinedWinStates()
    expect(result).toBe(false)
  })

  it('_setPlayerDefeat sets player to Lost', () => {
    const { server } = createTestServer()
    const gameInfo = new GameInformation()
    gameInfo.players = []
    const player = new GameInformationPlayer('Player1')
    player.playerId = 1
    player.team = 0
    player.winState = WinState.Undefined
    gameInfo.players.push(player)

    ;(server as any)._gameInfo = gameInfo
    ;(server as any)._worldPlayers = [null, player]

    ;(server as any)._setPlayerDefeat(1)
    expect(player.winState).toBe(WinState.Lost)
    expect(player.outcomeTimestampUtc).toBeInstanceOf(Date)
  })

  it('_setPlayerDefeat does nothing for already defeated player', () => {
    const { server } = createTestServer()
    const player = new GameInformationPlayer('Player1')
    player.winState = WinState.Lost
    ;(server as any)._worldPlayers = [null, player]
    ;(server as any)._gameInfo = { players: [player] }

    const oldTimestamp = player.outcomeTimestampUtc
    ;(server as any)._setPlayerDefeat(1)
    expect(player.winState).toBe(WinState.Lost)
    // Timestamp should not change for already-defeated player
    expect(player.outcomeTimestampUtc).toBe(oldTimestamp)
  })

  it('_setPlayerDefeat declares remaining players as winners when only one team left', () => {
    const { server } = createTestServer()
    const gameInfo = new GameInformation()
    const p1 = new GameInformationPlayer('Player1')
    p1.playerId = 1
    p1.team = 1
    p1.winState = WinState.Undefined
    const p2 = new GameInformationPlayer('Player2')
    p2.playerId = 2
    p2.team = 2
    p2.winState = WinState.Undefined
    gameInfo.players.push(p1, p2)

    ;(server as any)._gameInfo = gameInfo
    ;(server as any)._worldPlayers = [null, p1, p2]

    // Defeat Player2 (team 2). Now only team 1 (Player1) remains undefeated.
    ;(server as any)._setPlayerDefeat(2)

    expect(p2.winState).toBe(WinState.Lost)
    expect(p1.winState).toBe(WinState.Won) // Automatically declared winner
  })

  it('_setPlayerDefeat does NOT auto-win when multiple teams remain undefeated', () => {
    const { server } = createTestServer()
    const gameInfo = new GameInformation()
    const p1 = new GameInformationPlayer('Player1')
    p1.playerId = 1
    p1.team = 1
    p1.winState = WinState.Undefined
    const p2 = new GameInformationPlayer('Player2')
    p2.playerId = 2
    p2.team = 2
    p2.winState = WinState.Undefined
    const p3 = new GameInformationPlayer('Player3')
    p3.playerId = 3
    p3.team = 3
    p3.winState = WinState.Undefined
    gameInfo.players.push(p1, p2, p3)

    ;(server as any)._gameInfo = gameInfo
    ;(server as any)._worldPlayers = [null, p1, p2, p3]

    // Defeat Player3 (team 3). Teams 1 and 2 still have players.
    ;(server as any)._setPlayerDefeat(3)

    expect(p3.winState).toBe(WinState.Lost)
    expect(p1.winState).toBe(WinState.Undefined) // Not auto-won
    expect(p2.winState).toBe(WinState.Undefined) // Not auto-won
  })

  it('_anyUndefinedWinStates detects multi-team remaining', () => {
    const { server } = createTestServer()
    const gameInfo = new GameInformation()
    const p1 = new GameInformationPlayer('Player1')
    p1.team = 1
    p1.winState = WinState.Undefined
    const p2 = new GameInformationPlayer('Player2')
    p2.team = 2
    p2.winState = WinState.Undefined
    gameInfo.players.push(p1, p2)

    ;(server as any)._gameInfo = gameInfo
    expect((server as any)._anyUndefinedWinStates()).toBe(true)
  })

  it('_anyUndefinedWinStates returns false for single-team remaining', () => {
    const { server } = createTestServer()
    const gameInfo = new GameInformation()
    const p1 = new GameInformationPlayer('Player1')
    p1.team = 1
    p1.winState = WinState.Undefined
    const p2 = new GameInformationPlayer('Player2')
    p2.team = 1
    p2.winState = WinState.Undefined
    gameInfo.players.push(p1, p2)

    ;(server as any)._gameInfo = gameInfo
    expect((server as any)._anyUndefinedWinStates()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Sync Hash Handling Tests
// ---------------------------------------------------------------------------

describe('Server sync hash handling (via _handleSyncOrder)', () => {
  it('stores first sync packet for a frame', () => {
    const { server } = createTestServer()
    const packet = new Uint8Array(17) // 1 byte type + 4 hash + 8 defeat + 4 data padding
    packet[0] = OrderType.SyncHash // SyncHash marker

    ;(server as any)._handleSyncOrder(1, packet)
    expect((server as any)._syncForFrame.has(1)).toBe(true)
  })

  it('detects byte mismatch as desync (via _outOfSync)', () => {
    const { server } = createTestServer()
    // Set up a recorder to verify it gets invalidated on desync
    ;(server as any)._recorder = {
      metadata: { gameInfo: 'test' },
      receiveFrame: vi.fn(),
      dispose: vi.fn(),
    }

    const packet1 = new Uint8Array([0x65, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    const packet2 = new Uint8Array([0x65, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

    ;(server as any)._handleSyncOrder(1, packet1)
    ;(server as any)._handleSyncOrder(1, packet2) // Should detect mismatch

    // After desync, recorder should be null and metadata invalidated
    expect((server as any)._recorder).toBeNull()
  })

  it('accepts identical sync packets for the same frame', () => {
    const { server } = createTestServer()
    const packet = new Uint8Array([0x65, 0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

    ;(server as any)._handleSyncOrder(1, packet)
    ;(server as any)._handleSyncOrder(1, packet) // Should be fine -- same data

    // Recorder should still exist (we didn't create one, but the sync check passed)
    expect((server as any)._syncForFrame.has(1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// endGame Tests
// ---------------------------------------------------------------------------

describe('Server.endGame', () => {
  it('disposes recorder and clears state', () => {
    const { server } = createTestServer()
    ;(server as any)._recorder = {
      metadata: null,
      receiveFrame: vi.fn(),
      dispose: vi.fn(),
    }

    server.endGame()

    expect((server as any)._recorder).toBeNull()
    expect((server as any)._gameInfo).toBeNull()
    expect((server as any)._worldPlayers).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Tick Loop Tests
// ---------------------------------------------------------------------------

describe('Server tick loop', () => {
  let server: Server

  beforeEach(() => {
    const result = createTestServer()
    server = result.server
  })

  it('tick does not throw when state is WaitingPlayers', () => {
    expect(() => {
      (server as any)._tick()
    }).not.toThrow()
  })

  it('tick initiates shutdown sequence when state is ShuttingDown', () => {
    server.shutdown()
    expect(server.state).toBe(ServerState.ShuttingDown)

    // The tick should perform shutdown
    // But since we already manually shut down, state is already ShuttingDown
    expect(() => {
      (server as any)._performShutdown()
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// ServerSettings default values
// ---------------------------------------------------------------------------

describe('defaultServerSettings', () => {
  it('provides sensible defaults', () => {
    const settings = defaultServerSettings()
    expect(settings.listenPort).toBe(1234)
    expect(settings.recordReplays).toBe(false)
    expect(settings.enableSingleplayer).toBe(true)
    expect(settings.floodLimitMessageCount).toBe(5)
    expect(settings.floodLimitCooldown).toBe(5000)
    expect(settings.voteKickTimer).toBe(30000)
  })
})

// ---------------------------------------------------------------------------
// BLOCKER-1 Regression: _recordOrder accepts valid 13-byte sync hash packet
// ---------------------------------------------------------------------------

describe('_recordOrder sync hash length check (BLOCKER-1 regression)', () => {
  it('records valid 13-byte sync hash and is NOT dropped', () => {
    const { server } = createTestServer()
    // Build a valid 13-byte sync hash: [0x65][4-byte hash][8-byte defeatState]
    const packet = new Uint8Array(SYNC_HASH_ORDER_LENGTH)
    packet[0] = OrderType.SyncHash // 0x65
    // Fill hash bytes with non-zero dummy data
    packet[1] = 0xDE
    packet[2] = 0xAD
    packet[3] = 0xBE
    packet[4] = 0xEF
    // defeatState all zeros (no defeats)

    ;(server as any)._recordOrder(1, packet, 0)

    // The packet should NOT be dropped -- it should be stored in _syncForFrame
    expect((server as any)._syncForFrame.has(1)).toBe(true)
    const stored = (server as any)._syncForFrame.get(1)
    expect(stored.length).toBe(SYNC_HASH_ORDER_LENGTH)
    expect(stored[0]).toBe(OrderType.SyncHash)
  })

  it('drops oversized sync hash packet (> 13 bytes)', () => {
    const { server } = createTestServer()
    const packet = new Uint8Array(17) // incorrect size
    packet[0] = OrderType.SyncHash

    ;(server as any)._recordOrder(1, packet, 0)

    // Should NOT be stored -- length does not match
    expect((server as any)._syncForFrame.has(1)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// BLOCKER-2 Regression: disconnect packet is exactly 5 bytes
// ---------------------------------------------------------------------------

describe('_dropClient disconnect packet size (BLOCKER-2 regression)', () => {
  it('creates a disconnect packet of exactly 5 bytes', () => {
    const { server, transport } = createTestServer(ServerType.Local)

    // Create TWO mock client transports; client2 will capture ALL sent data
    const allSent: Uint8Array[] = []
    const clientTransport1 = createMockClientTransport('127.0.0.1:1111')
    const clientTransport2 = createMockClientTransport('127.0.0.1:2222')

    // Connect both clients
    transport._triggerConnection(clientTransport1)
    transport._triggerConnection(clientTransport2)
    expect(server.conns.length).toBe(2)

    // Validate both
    const conn1 = server.conns[0]
    conn1.validated = true
    const conn2 = server.conns[1]
    conn2.validated = true

    // Add correspondng lobby clients
    const c1 = new SessionClient()
    c1.index = conn1.playerIndex
    c1.name = 'Player1'
    c1.state = 1
    const c2 = new SessionClient()
    c2.index = conn2.playerIndex
    c2.name = 'Player2'
    c2.state = 1
    server.lobbyInfo.clients.push(c1, c2)

    // Replace client2's send to capture ALL data sent to it
    clientTransport2.send = vi.fn((data: Uint8Array) => {
      allSent.push(data)
      return true
    })

    // Drop client1 -- client2 should receive FluentMessage(s) + disconnect frame
    ;(server as any)._dropClient(conn1)

    // Find the disconnect frame in all sent data
    // The disconnect frame is a CreateFrame wrapper: [length:4][client:4][frame:4][payload]
    // Payload: [0xBF:1 byte][playerIndex:4 bytes LE] = 5 bytes
    // Full frame: 12 header + 5 payload = 17 bytes
    const disconnectFrames = allSent.filter(
      (data) => data.length >= 13 && data[12] === OrderType.Disconnect,
    )
    expect(disconnectFrames.length).toBe(1)
    const frame = disconnectFrames[0]
    expect(frame.length).toBe(17)
    // Extract payload (skip 12-byte frame header)
    const payload = new Uint8Array(frame.buffer, frame.byteOffset + 12, 5)
    expect(payload.length).toBe(5)
    expect(payload[0]).toBe(OrderType.Disconnect) // 0xBF
    // Verify playerIndex in the disconnect packet (playerIndex is int32 LE at byte 1)
    const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    expect(pv.getInt32(1, true)).toBe(conn1.playerIndex)
  })
})
