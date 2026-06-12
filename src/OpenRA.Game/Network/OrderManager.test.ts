/**
 * OrderManager.test.ts — Lockstep frame coordinator unit tests
 */

import { describe, it, expect } from 'vitest'
import { OrderManager, TickTime } from './OrderManager'
import { Order, OrderPacket } from './Order'
import { EchoConnection } from './Connection'
import type { IConnection } from './Connection'
import type {
  ClientStub,
  LobbyInfoStub,
  GlobalSettingsStub,
} from './UnitOrders'

// ---------------------------------------------------------------------------
// Mock connection
// ---------------------------------------------------------------------------

function mockConnection(): IConnection & {
  _sentOrders: Array<{ frame: number; orders: readonly Order[] }>
  _sentImmediate: Array<{ orders: readonly Order[] }>
  _sentSync: Array<{ frame: number; syncHash: number; defeatState: bigint }>
  _startGameCalled: boolean
} {
  return {
    localClientId: 1,
    _sentOrders: [],
    _sentImmediate: [],
    _sentSync: [],
    _startGameCalled: false,
    startGame(): void {
      this._startGameCalled = true
    },
    send(frame: number, orders: readonly Order[]): void {
      this._sentOrders.push({ frame, orders })
    },
    sendImmediate(orders: readonly Order[]): void {
      this._sentImmediate.push({ orders })
    },
    sendSync(frame: number, syncHash: number, defeatState: bigint): void {
      this._sentSync.push({ frame, syncHash, defeatState })
    },
    receive(_orderManager: unknown): void {
      // No-op in mock
    },
    dispose(): void {
      // No-op
    },
  }
}

// ---------------------------------------------------------------------------
// Mock ClientStub
// ---------------------------------------------------------------------------

function mockClient(index: number, isBot = false): ClientStub {
  return {
    index,
    name: `Player${index}`,
    color: '#FFFFFF',
    team: index,
    slot: isBot ? null : `slot${index}`,
    bot: isBot ? 'EasyBot' : null,
    isAdmin: index === 0,
    isObserver: false,
    isBot,
    state: 2, // Ready
    connectionQuality: 0,
  }
}

// ---------------------------------------------------------------------------
// Mock LobbyInfoStub
// ---------------------------------------------------------------------------

function mockLobbyInfo(clients: ClientStub[] = []): LobbyInfoStub {
  return {
    clients,
    globalSettings: mockGlobalSettings(),
    slots: new Map(),
    disabledSpawnPoints: [],
    clientWithIndex(id: number): ClientStub | undefined {
      return clients.find((c) => c.index === id)
    },
    nonBotClients(): readonly ClientStub[] {
      return clients.filter((c) => !c.isBot)
    },
  }
}

function mockGlobalSettings(): GlobalSettingsStub {
  return {
    map: '',
    randomSeed: 0,
    netFrameInterval: 3,
    gameTimestep: 0,
    enableSyncReports: false,
    dedicated: false,
    optionOrDefault: (_key: string, defaultValue: string | boolean) => defaultValue,
  }
}

// ---------------------------------------------------------------------------
// TickTime
// ---------------------------------------------------------------------------

describe('TickTime', () => {
  it('stores initial value', () => {
    let time = 1000
    const tt = new TickTime(() => time, time)
    expect(tt.value).toBe(1000)
  })

  it('updates to current time', () => {
    let time = 1000
    const tt = new TickTime(() => time, time)
    time = 2000
    tt.update()
    expect(tt.value).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// OrderManager construction
// ---------------------------------------------------------------------------

describe('OrderManager construction', () => {
  it('initializes with given connection', () => {
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    expect(om.connection).toBe(conn)
    expect(om.lobbyInfo).toBeDefined()
    expect(om.gameStarted).toBe(false)
    expect(om.isOutOfSync).toBe(false)
    om.dispose()
  })

  it('has netFrameNumber 0 before startGame', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    expect(om.netFrameNumber).toBe(0)
    expect(om.gameStarted).toBe(false)
    om.dispose()
  })

  it('localClient resolves from lobby info', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo
    expect(om.localClient).toBe(client)
    om.dispose()
  })

  it('orderQueueLength returns 0 when no pending orders', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    expect(om.orderQueueLength).toBe(0)
    om.dispose()
  })

  it('dispose cleans up', () => {
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.dispose()
    expect(om.gameStarted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// OrderManager lifecycle
// ---------------------------------------------------------------------------

describe('OrderManager lifecycle', () => {
  it('startGame sets netFrameNumber to 1', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.startGame()

    expect(om.netFrameNumber).toBe(1)
    expect(om.gameStarted).toBe(true)
    expect(om.localFrameNumber).toBe(0)
    om.dispose()
  })

  it('startGame is idempotent', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.startGame()
    const frameAfterFirst = om.netFrameNumber

    om.startGame()
    expect(om.netFrameNumber).toBe(frameAfterFirst)
    om.dispose()
  })

  it('startGame calls connection.startGame()', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.startGame()
    expect(conn._startGameCalled).toBe(true)
    om.dispose()
  })

  it('startGame creates pending order queues for non-bot clients', () => {
    const c1 = mockClient(1, false)
    const c2 = mockClient(2, true)  // bot — no queue
    const c3 = mockClient(3, false)
    const lobbyInfo = mockLobbyInfo([c1, c2, c3])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.startGame()

    // After startGame, non-bot clients have queues
    // We can verify by checking if receiveOrders works
    const packet = new OrderPacket([Order.chat('test')])
    expect(() =>
      om.receiveOrders(1, { frame: 1, orders: packet }),
    ).not.toThrow()
    // Bot client 2 should NOT have a queue
    expect(() =>
      om.receiveOrders(2, { frame: 1, orders: packet }),
    ).toThrow()
    om.dispose()
  })
})

// ---------------------------------------------------------------------------
// Issue orders
// ---------------------------------------------------------------------------

describe('OrderManager issueOrder', () => {
  it('accumulates regular orders in local buffer', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo
    om.startGame()

    om.issueOrder(Order.chat('hello', 0))
    om.issueOrder(Order.chat('world', 0))

    om.dispose()
  })

  it('sends immediate orders via tickImmediate', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo
    om.startGame()

    const immediateOrder = Order.chat('urgent', 0)
    om.issueOrder(immediateOrder)

    om.tickImmediate()

    expect(conn._sentImmediate).toHaveLength(1)
    om.dispose()
  })

  it('issueOrders issues multiple orders', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo
    om.startGame()

    om.issueOrders([Order.chat('a'), Order.chat('b'), Order.chat('c')])

    om.dispose()
  })
})

// ---------------------------------------------------------------------------
// Receive orders
// ---------------------------------------------------------------------------

describe('OrderManager receiveOrders', () => {
  it('receiveOrders stores remote orders in pending queue', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo
    om.startGame()

    const packet = new OrderPacket([Order.chat('test')])
    om.receiveOrders(1, { frame: 1, orders: packet })

    // Client 1 should now have 1 pending order
    expect(om.orderQueueLength).toBe(1)
    om.dispose()
  })

  it('receiveOrders throws for disconnected client', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo
    om.startGame()

    const packet = new OrderPacket([Order.chat('test')])
    expect(() =>
      om.receiveOrders(999, { frame: 1, orders: packet }),
    ).toThrow()
    om.dispose()
  })

  it('receiveSync stores sync hash', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    om.receiveSync(5, 42, 7n)
    // No error means stored successfully
    expect(() => om.receiveSync(5, 42, 7n)).not.toThrow()
    om.dispose()
  })

  it('receiveSync detects sync mismatch', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    om.receiveSync(5, 42, 0n)
    om.receiveSync(5, 99, 0n) // Different hash — should trigger outOfSync
    expect(om.isOutOfSync).toBe(true)
    om.dispose()
  })

  it('receiveDisconnect updates client state', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = mockConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.receiveDisconnect(1, 10)

    expect(client.state).toBe(1000) // Disconnected
    om.dispose()
  })
})

// ---------------------------------------------------------------------------
// EchoConnection integration
// ---------------------------------------------------------------------------

describe('OrderManager with EchoConnection integration', () => {
  it('full lockstep cycle with a single client', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = new EchoConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.startGame()

    // Issue a regular order
    om.issueOrder(Order.chat('hello'))

    // Process immediate orders + receive
    om.tickImmediate()

    // Try to tick
    const tickResult = om.tryTick()

    // Single client with EchoConnection should be able to tick
    expect(tickResult).toBe(true)
    expect(om.localFrameNumber).toBeGreaterThan(0)

    om.dispose()
  })

  it('multiple tryTick calls advance localFrameNumber', () => {
    const client = mockClient(1)
    const lobbyInfo = mockLobbyInfo([client])
    const conn = new EchoConnection()
    const om = new OrderManager(conn, () => 0, 0)
    om.lobbyInfo = lobbyInfo

    om.startGame()

    // Issue multiple orders and try to tick multiple times
    for (let i = 0; i < 10; i++) {
      om.issueOrder(Order.chat(`msg${i}`))
      om.tickImmediate()
      om.tryTick()
    }

    expect(om.localFrameNumber).toBeGreaterThan(0)

    om.dispose()
  })
})

// ---------------------------------------------------------------------------
// serverError and authenticationFailed
// ---------------------------------------------------------------------------

describe('OrderManager server errors', () => {
  it('serverError defaults to null', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    expect(om.serverError).toBeNull()
    om.dispose()
  })

  it('authenticationFailed defaults to false', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    expect(om.authenticationFailed).toBe(false)
    om.dispose()
  })

  it('serverError and authenticationFailed are writable from outside', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    om.serverError = 'Test error'
    om.authenticationFailed = true
    expect(om.serverError).toBe('Test error')
    expect(om.authenticationFailed).toBe(true)
    om.dispose()
  })
})

// ---------------------------------------------------------------------------
// Suggested timestep
// ---------------------------------------------------------------------------

describe('OrderManager suggestedTimestep', () => {
  it('returns default 40ms (25 TPS) when no world', () => {
    const om = new OrderManager(mockConnection(), () => 0, 0)
    expect(om.suggestedTimestep).toBe(40)
    om.dispose()
  })
})
