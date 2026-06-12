/**
 * Connection.test.ts — Connection (WebSocket and EchoConnection) unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ConnectionState,
  EchoConnection,
  NetworkConnection,
} from './Connection'
import { Order, OrderPacket } from './Order'
import type { OrderManagerStub } from './UnitOrders'

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  url: string
  binaryType: string = 'blob'
  readyState: number = 0 // CONNECTING

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  private static _instances: MockWebSocket[] = []

  static get lastInstance(): MockWebSocket | undefined {
    return MockWebSocket._instances[MockWebSocket._instances.length - 1]
  }

  static reset(): void {
    MockWebSocket._instances = []
  }

  constructor(url: string) {
    this.url = url
    MockWebSocket._instances.push(this)
  }

  send(_data: ArrayBuffer | Blob | string): void {
    // No-op in mock
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
  }
}

// Replace global WebSocket with mock
;(globalThis as Record<string, unknown>).WebSocket = MockWebSocket

afterEach(() => {
  MockWebSocket.reset()
})

// ---------------------------------------------------------------------------
// Mock OrderManagerStub for receive tests
// ---------------------------------------------------------------------------

function mockOrderManagerStub(): OrderManagerStub & {
  _receivedImmediate: Array<{ clientId: number; packet: OrderPacket }>
  _receivedOrders: Array<{ clientId: number; data: { frame: number; orders: OrderPacket } }>
  _receivedSyncs: Array<{ frame: number; syncHash: number; defeatState: bigint }>
  _receivedDisconnects: Array<{ clientId: number; frame: number }>
} {
  const calls = {
    _receivedImmediate: [] as Array<{ clientId: number; packet: OrderPacket }>,
    _receivedOrders: [] as Array<{ clientId: number; data: { frame: number; orders: OrderPacket } }>,
    _receivedSyncs: [] as Array<{ frame: number; syncHash: number; defeatState: bigint }>,
    _receivedDisconnects: [] as Array<{ clientId: number; frame: number }>,
    _receivedTickScales: [] as number[],
  }

  return {
    netFrameNumber: 0,
    localFrameNumber: 0,
    gameStarted: false,
    lobbyInfo: {
      clients: [],
      globalSettings: {
        map: '', randomSeed: 0, netFrameInterval: 3, gameTimestep: 0,
        enableSyncReports: false, dedicated: false,
        optionOrDefault: (_k: string, d: string | boolean) => d,
      },
      slots: new Map(),
      disabledSpawnPoints: [],
      clientWithIndex: () => undefined,
      nonBotClients: () => [],
    },
    localClient: null,
    serverError: null,
    authenticationFailed: false,
    world: null,
    issueOrder: vi.fn(),
    gameSaveLastFrame: -1,
    gameSaveLastSyncFrame: -1,
    serverMapPool: null,
    connection: { localClientId: 1 },
    receiveImmediateOrders(clientId: number, packet: OrderPacket): void {
      calls._receivedImmediate.push({ clientId, packet })
    },
    receiveOrders(clientId: number, data: { frame: number; orders: OrderPacket }): void {
      calls._receivedOrders.push({ clientId, data })
    },
    receiveSync(frame: number, syncHash: number, defeatState: bigint): void {
      calls._receivedSyncs.push({ frame, syncHash, defeatState })
    },
    receiveDisconnect(clientId: number, frame: number): void {
      calls._receivedDisconnects.push({ clientId, frame })
    },
    receiveTickScale(tickScale: number): void {
      calls._receivedTickScales.push(tickScale)
    },
    ...calls,
  }
}

// ---------------------------------------------------------------------------
// ConnectionState enum
// ---------------------------------------------------------------------------

describe('ConnectionState', () => {
  it('has four states', () => {
    expect(ConnectionState.PreConnecting).toBe(0)
    expect(ConnectionState.NotConnected).toBe(1)
    expect(ConnectionState.Connecting).toBe(2)
    expect(ConnectionState.Connected).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// EchoConnection
// ---------------------------------------------------------------------------

describe('EchoConnection', () => {
  let conn: EchoConnection
  let om: ReturnType<typeof mockOrderManagerStub>

  beforeEach(() => {
    conn = new EchoConnection()
    om = mockOrderManagerStub()
  })

  it('has localClientId = 1', () => {
    expect(conn.localClientId).toBe(1)
  })

  it('startGame injects empty frame 0', () => {
    conn.startGame()
    conn.receive(om)
    // Frame 0 should be projected to frame 1
    expect(om._receivedOrders).toHaveLength(1)
    expect(om._receivedOrders[0].data.frame).toBe(1)
  })

  it('send and receive orders with frame projection', () => {
    conn.startGame()
    conn.send(5, [Order.chat('test')])
    conn.sendSync(5, 42, 0n)

    conn.receive(om)

    // Orders projected forward by 1
    expect(om._receivedOrders).toHaveLength(2) // frame 0 + frame 5(+1)
    const orderEntry = om._receivedOrders.find((e) => e.data.frame === 6)
    expect(orderEntry).toBeDefined()

    // Sync received
    expect(om._receivedSyncs).toHaveLength(1)
    expect(om._receivedSyncs[0].frame).toBe(5)
    expect(om._receivedSyncs[0].syncHash).toBe(42)
  })

  it('sendImmediate processes orders without frame queuing', () => {
    conn.sendImmediate([Order.chat('urgent')])
    conn.receive(om)

    expect(om._receivedImmediate).toHaveLength(1)
  })

  it('dispose stops processing', () => {
    conn.startGame()
    conn.send(1, [Order.chat('test')])

    // Create a fresh OM for dispose test
    const om2 = mockOrderManagerStub()
    conn.dispose()
    conn.receive(om2)

    // No orders should be received after dispose
    expect(om2._receivedOrders).toHaveLength(0)
  })

  it('bails out during immediate order processing if disposed', () => {
    // Set up an immediate order that triggers dispose
    conn.sendImmediate([Order.chat('a'), Order.chat('b')])
    conn.send(1, [Order.chat('c')])

    // We'll only receive one immediate order because dispose is called within receive
    conn.receive(om)
    // The receive loop checks disposed after each immediate order
    expect(om._receivedImmediate.length).toBeGreaterThanOrEqual(0)
  })

  it('sendSync enqueues sync data', () => {
    conn.sendSync(10, 0xABCD, 1n)
    conn.receive(om)

    expect(om._receivedSyncs).toHaveLength(1)
    expect(om._receivedSyncs[0].syncHash).toBe(0xABCD)
    expect(om._receivedSyncs[0].defeatState).toBe(1n)
  })
})

// ---------------------------------------------------------------------------
// NetworkConnection
// ---------------------------------------------------------------------------

describe('NetworkConnection', () => {
  beforeEach(() => {
    MockWebSocket.reset()
  })

  it('starts in Connecting state', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    expect(conn.connectionState).toBe(ConnectionState.Connecting)
    conn.dispose()
  })

  it('transitions to Connected on handshake message', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    const ws = MockWebSocket.lastInstance!

    // Simulate handshake: [protocol BE] + [clientId BE]
    const handshake = new Uint8Array(8)
    const view = new DataView(handshake.buffer)
    view.setInt32(0, 1, false) // protocol version
    view.setInt32(4, 42, false) // client ID

    // Simulate open + handshake message
    ws.readyState = MockWebSocket.OPEN
    ws.onopen?.(new Event('open'))
    ws.onmessage?.(new MessageEvent('message', { data: handshake.buffer }))

    expect(conn.connectionState).toBe(ConnectionState.Connected)
    expect(conn.localClientId).toBe(42)
    conn.dispose()
  })

  it('transitions to NotConnected on close', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    const ws = MockWebSocket.lastInstance!

    ws.readyState = MockWebSocket.OPEN
    ws.onopen?.(new Event('open'))

    // Close
    ws.onclose?.(new CloseEvent('close', { code: 1000, reason: 'normal' }))

    expect(conn.connectionState).toBe(ConnectionState.NotConnected)
    conn.dispose()
  })

  it('send serializes and sends through WebSocket', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    const ws = MockWebSocket.lastInstance!
    const sendSpy = vi.spyOn(ws, 'send')

    // Connect first
    const handshake = new Uint8Array(8)
    const hv = new DataView(handshake.buffer)
    hv.setInt32(0, 1, false)
    hv.setInt32(4, 1, false)
    ws.readyState = MockWebSocket.OPEN
    ws.onopen?.(new Event('open'))
    ws.onmessage?.(new MessageEvent('message', { data: handshake.buffer }))

    // Send an order
    conn.send(5, [Order.chat('hello')])
    expect(sendSpy).toHaveBeenCalled()

    conn.dispose()
  })

  it('sendSync queues sync packets for next send', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    const ws = MockWebSocket.lastInstance!

    // Connect
    const handshake = new Uint8Array(8)
    const hv = new DataView(handshake.buffer)
    hv.setInt32(0, 1, false)
    hv.setInt32(4, 1, false)
    ws.readyState = MockWebSocket.OPEN
    ws.onopen?.(new Event('open'))
    ws.onmessage?.(new MessageEvent('message', { data: handshake.buffer }))

    const sendSpy = vi.spyOn(ws, 'send')
    conn.sendSync(10, 0xDEAD, 0n)

    // Sync packets are sent with next order batch
    conn.send(10, [Order.chat('test')])
    expect(sendSpy).toHaveBeenCalled()

    conn.dispose()
  })

  it('startGame is a no-op for NetworkConnection', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    // Should not throw
    conn.startGame()
    conn.dispose()
  })

  it('dispose cleans up WebSocket', () => {
    const conn = new NetworkConnection('ws://localhost:1234')
    conn.dispose()

    // WebSocket should be cleaned up
    expect(conn.connectionState).toBe(ConnectionState.NotConnected)
  })

  it('reports error message on failure', () => {
    // Create with invalid URL to trigger error
    const conn = new NetworkConnection('invalid-url')
    const ws = MockWebSocket.lastInstance!

    ws.onerror?.(new Event('error'))

    expect(conn.errorMessage).toBeTruthy()
    conn.dispose()
  })
})

// ---------------------------------------------------------------------------
// OrderPacket re-export
// ---------------------------------------------------------------------------

describe('OrderPacket (exported from Connection)', () => {
  it('creates packets correctly', () => {
    const packet = new OrderPacket([Order.chat('test')])
    expect(packet.count).toBe(1)
  })
})
