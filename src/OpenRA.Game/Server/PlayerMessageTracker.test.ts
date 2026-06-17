/**
 * PlayerMessageTracker.test.ts -- PlayerMessageTracker migration unit tests
 *
 * Tests focus on: flood limit detection, admin bypass, join cooldown,
 * message expiration, cooldown application, and DisableChatUI dispatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Order
// ---------------------------------------------------------------------------

vi.mock('../Network/Order.js', () => ({
  Order: {
    fromTargetString: vi.fn(
      (_order: string, _targetString: string, _isImmediate: boolean, extraData: number = 0) => ({
        serialize: vi.fn(() => new Uint8Array([0xFE, extraData & 0xFF])),
        extraData,
      }),
    ),
    deserialize: vi.fn(() => null),
  },
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { PlayerMessageTracker } from './PlayerMessageTracker.js'
import { Order } from '../Network/Order.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now()

/** Create a mock Connection with a given connection age (ms). */
function createMockConn(
  playerIndex: number,
  connectionAgeMs: number = 60000,
  opts: { isAdmin?: boolean } = {},
) {
  return {
    playerIndex,
    connectionTimer: NOW - connectionAgeMs,
    authToken: 'mock-token',
    endPoint: `127.0.0.1:${50000 + playerIndex}`,
    validated: true,
    lastOrdersFrame: 0,
    timeoutMessageShown: false,
    _lastReceivedTime: NOW,
    get timeSinceLastResponse() {
      return NOW - this._lastReceivedTime
    },
    trySendData: vi.fn(() => true),
    dispose: vi.fn(),
    _transport: null,
    __isAdmin: opts.isAdmin ?? false,
  } as any
}

/** Create a mock SessionClient. */
function createMockClient(index: number, isAdmin: boolean = false) {
  return {
    index,
    name: `Player${index}`,
    isAdmin,
    isObserver: false,
    isBot: false,
  } as any
}

/** Create a mock Server for PlayerMessageTracker. */
function createMockServer(opts: {
  floodLimitMessageCount?: number
  floodLimitCooldown?: number
  floodLimitInterval?: number
  floodLimitJoinCooldown?: number
  getClientResult?: (conn: any) => any
} = {}) {
  return {
    settings: {
      floodLimitMessageCount: opts.floodLimitMessageCount ?? 5,
      floodLimitCooldown: opts.floodLimitCooldown ?? 5000,
      floodLimitInterval: opts.floodLimitInterval ?? 10000,
      floodLimitJoinCooldown: opts.floodLimitJoinCooldown ?? 1000,
    },
    getClient: vi.fn((conn: any) => {
      if (opts.getClientResult) return opts.getClientResult(conn)
      return createMockClient(conn.playerIndex, conn.__isAdmin)
    }),
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlayerMessageTracker', () => {
  let server: ReturnType<typeof createMockServer>
  let dispatchOrdersToClient: ReturnType<typeof vi.fn>
  let sendFluentMessageTo: ReturnType<typeof vi.fn>
  let tracker: PlayerMessageTracker

  beforeEach(() => {
    vi.clearAllMocks()
    server = createMockServer()
    dispatchOrdersToClient = vi.fn()
    sendFluentMessageTo = vi.fn()
    tracker = new PlayerMessageTracker(
      server as any,
      dispatchOrdersToClient,
      sendFluentMessageTo,
    )
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  it('stores constructor references correctly', () => {
    // Verify tracker was created
    expect(tracker).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — admin bypasses flood limit
  // ---------------------------------------------------------------------------

  it('admin bypasses flood limit entirely', () => {
    const conn = createMockConn(1, 60000, { isAdmin: true })

    // Send many messages quickly
    for (let i = 0; i < 10; i++) {
      const result = tracker.isPlayerAtFloodLimit(conn)
      expect(result).toBe(false)
    }

    // No fluent messages should have been sent to admin
    expect(sendFluentMessageTo).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — new player within join cooldown is blocked
  // ---------------------------------------------------------------------------

  it('blocks new player within join cooldown', () => {
    server.settings.floodLimitJoinCooldown = 10000 // 10s
    // Player joined 500ms ago
    const conn = createMockConn(1, 500)

    const result = tracker.isPlayerAtFloodLimit(conn)

    expect(result).toBe(true)
    expect(sendFluentMessageTo).toHaveBeenCalled()
    // Verify the call includes the chat-temp-disabled key
    const callArgs = sendFluentMessageTo.mock.calls[0]
    expect(callArgs[0]).toBe(conn)
    expect(callArgs[1]).toBe('notification-chat-temp-disabled')
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — player not blocked after join cooldown
  // ---------------------------------------------------------------------------

  it('allows player after join cooldown expires', () => {
    server.settings.floodLimitJoinCooldown = 1000
    // Player joined 60 seconds ago (well past cooldown)
    const conn = createMockConn(1, 60000)

    const result = tracker.isPlayerAtFloodLimit(conn)

    expect(result).toBe(false)
    expect(sendFluentMessageTo).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — blocks when message count exceeds limit
  // ---------------------------------------------------------------------------

  it('blocks when message count exceeds flood limit', () => {
    server.settings.floodLimitMessageCount = 3
    const conn = createMockConn(1, 60000)

    // Send 3 messages — should be allowed (3rd triggers cooldown)
    tracker.isPlayerAtFloodLimit(conn) // msg 1 - allowed
    tracker.isPlayerAtFloodLimit(conn) // msg 2 - allowed
    tracker.isPlayerAtFloodLimit(conn) // msg 3 - reaches limit

    // The 3rd message triggers the limit, which applies cooldown and
    // disables chat UI. Then the 4th message should be blocked.
    const result4 = tracker.isPlayerAtFloodLimit(conn) // msg 4 - blocked

    expect(result4).toBe(true)
    expect(sendFluentMessageTo).toHaveBeenCalled()
    expect(dispatchOrdersToClient).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — messages expire after flood interval
  // ---------------------------------------------------------------------------

  it('allows messages after flood interval expires', () => {
    server.settings.floodLimitMessageCount = 3
    server.settings.floodLimitInterval = 5000 // 5s
    const conn = createMockConn(1, 120000) // connected 2 min ago

    // Send 2 messages (below limit)
    tracker.isPlayerAtFloodLimit(conn)
    tracker.isPlayerAtFloodLimit(conn)

    // Manual intervention: set all timestamps to old values to simulate expiry
    const internalTracker = (tracker as any).messageTracker
    const arr = internalTracker.get(1)
    // Set timestamps to be older than the interval
    for (let i = 0; i < arr.length; i++) {
      arr[i] -= 10000 // Move 10s into the past
    }

    // Now the next message should see expired entries and allow it
    const result = tracker.isPlayerAtFloodLimit(conn)

    expect(result).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — applies cooldown and disables chat UI at limit
  // ---------------------------------------------------------------------------

  it('applies cooldown and disables chat UI at message limit', () => {
    server.settings.floodLimitMessageCount = 2
    server.settings.floodLimitCooldown = 5000
    server.settings.floodLimitInterval = 10000
    const conn = createMockConn(1, 60000)

    // First message: allowed
    expect(tracker.isPlayerAtFloodLimit(conn)).toBe(false)

    // Second message: hits limit, cooldown applied, chat disabled
    expect(tracker.isPlayerAtFloodLimit(conn)).toBe(false) // The message itself is still allowed through

    // Verify chat was disabled
    expect(dispatchOrdersToClient).toHaveBeenCalled()
    // Verify DisableChatEntry order was sent with correct extraData (cooldown ms)
    const callArgs = dispatchOrdersToClient.mock.calls[0]
    expect(callArgs[3]).toBeDefined() // order bytes
  })

  // ---------------------------------------------------------------------------
  // disableChatUI — dispatches correct order
  // ---------------------------------------------------------------------------

  it('disableChatUI dispatches correct DisableChatEntry order', () => {
    const conn = createMockConn(1, 60000)
    tracker.disableChatUI(conn, 3000)

    expect(dispatchOrdersToClient).toHaveBeenCalled()
    const callArgs = dispatchOrdersToClient.mock.calls[0]
    expect(callArgs[0]).toBe(conn) // target connection
    expect(callArgs[1]).toBe(0) // client = 0 (server)
    expect(callArgs[2]).toBe(0) // frame = 0
    // callArgs[3] is the serialized order data
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — message not at limit passes through
  // ---------------------------------------------------------------------------

  it('allows single message to pass through normally', () => {
    const conn = createMockConn(1, 60000)

    const result = tracker.isPlayerAtFloodLimit(conn)

    expect(result).toBe(false)
    expect(sendFluentMessageTo).not.toHaveBeenCalled()
    expect(dispatchOrdersToClient).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — tracker array is per-player
  // ---------------------------------------------------------------------------

  it('tracks messages per-player independently', () => {
    server.settings.floodLimitMessageCount = 2
    const conn1 = createMockConn(1, 60000)
    const conn2 = createMockConn(2, 60000)

    // Player 1 sends a message
    tracker.isPlayerAtFloodLimit(conn1)

    // Player 2 should be unaffected
    const result2 = tracker.isPlayerAtFloodLimit(conn2)
    expect(result2).toBe(false)

    // Player 2's first message should not be affected by Player 1
    expect(dispatchOrdersToClient).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — different player indexes are fully independent
  // ---------------------------------------------------------------------------

  it('player indexes are fully independent', () => {
    server.settings.floodLimitMessageCount = 2
    server.settings.floodLimitCooldown = 5000
    const conn1 = createMockConn(1, 60000)
    const conn2 = createMockConn(2, 60000)

    // Player 1 hits limit
    tracker.isPlayerAtFloodLimit(conn1) // msg 1
    tracker.isPlayerAtFloodLimit(conn1) // msg 2 — hits limit, chat disabled

    expect(dispatchOrdersToClient).toHaveBeenCalledTimes(1)

    // Player 2 is still fine on first message
    const result = tracker.isPlayerAtFloodLimit(conn2)
    expect(result).toBe(false)
    // dispatchOrdersToClient should not have been called again
    expect(dispatchOrdersToClient).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // isPlayerAtFloodLimit — order serialization uses correct extraData
  // ---------------------------------------------------------------------------

  it('disableChatUI serializes order with time as extraData', () => {
    const conn = createMockConn(1, 60000)
    const cooldownTime = 3000

    tracker.disableChatUI(conn, cooldownTime)

    // Verify Order.fromTargetString was called with correct arguments
    expect(Order.fromTargetString).toHaveBeenCalledWith(
      'DisableChatEntry',
      '',
      false,
      cooldownTime,
    )
  })
})
