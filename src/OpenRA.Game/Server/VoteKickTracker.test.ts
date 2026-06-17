/**
 * VoteKickTracker.test.ts -- VoteKickTracker migration unit tests
 *
 * Tests focus on: vote lifecycle, state transitions, eligibility checks,
 * cooldown enforcement, edge cases (dead admin, observer kick, expired votes).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules
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

import { VoteKickTracker } from './VoteKickTracker.js'
import { ServerState, ServerType } from './SessionTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Connection. */
function createMockConn(playerIndex: number, connectionTimerOffset: number = 0) {
  return {
    playerIndex,
    connectionTimer: Date.now() - connectionTimerOffset,
    authToken: 'mock-token',
    endPoint: `127.0.0.1:${50000 + playerIndex}`,
    validated: true,
    lastOrdersFrame: 0,
    timeoutMessageShown: false,
    _lastReceivedTime: Date.now(),
    get timeSinceLastResponse() {
      return Date.now() - this._lastReceivedTime
    },
    trySendData: vi.fn(() => true),
    dispose: vi.fn(),
    _transport: null,
  } as any
}

/** Create a mock SessionClient. */
function createMockClient(
  index: number,
  name: string,
  opts: {
    isAdmin?: boolean
    isObserver?: boolean
    isBot?: boolean
    state?: number
    wonOrLost?: boolean
  } = {},
) {
  return {
    index,
    name,
    isAdmin: opts.isAdmin ?? false,
    isObserver: opts.isObserver ?? false,
    isBot: opts.isBot ?? false,
    state: opts.state ?? 0,
    __wonOrLost: opts.wonOrLost ?? false,
  } as any
}

/** Create a mock Server with minimal API surface. */
function createMockServer(opts: {
  state?: number
  type?: number
  voteKickTimer?: number
  voteKickerCooldown?: number
  conns?: any[]
  getClientReturn?: (c: any) => any
  hasClientWonOrLostReturn?: (c: any) => boolean
} = {}) {
  const mockConns: any[] = opts.conns ?? []

  return {
    state: opts.state ?? ServerState.GameStarted,
    type: opts.type ?? ServerType.Multiplayer,
    settings: {
      voteKickTimer: opts.voteKickTimer ?? 30000,
      voteKickerCooldown: opts.voteKickerCooldown ?? 60000,
    },
    conns: mockConns,
    getClient: vi.fn((conn: any) => {
      if (opts.getClientReturn) return opts.getClientReturn(conn)
      return mockConns.find((c) => c === conn)?.__client ?? undefined
    }),
    hasClientWonOrLost: vi.fn((client: any) => {
      if (opts.hasClientWonOrLostReturn)
        return opts.hasClientWonOrLostReturn(client)
      return client.__wonOrLost ?? false
    }),
    sendFluentMessageTo: vi.fn(),
    sendFluentMessage: vi.fn(),
    dispatchServerOrdersToClients: vi.fn(),
    _hasConn: (conn: any) => mockConns.includes(conn),
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoteKickTracker', () => {
  let server: ReturnType<typeof createMockServer>
  let tracker: VoteKickTracker

  beforeEach(() => {
    vi.clearAllMocks()
    server = createMockServer()
    tracker = new VoteKickTracker(server as any)
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  it('stores server reference on construction', () => {
    expect(tracker).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // tick() — no vote active
  // ---------------------------------------------------------------------------

  it('tick() no-ops when no vote is active', () => {
    // Should not throw
    expect(() => tracker.tick()).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // tick() — ends expired vote
  // ---------------------------------------------------------------------------

  it('tick() ends expired vote and blocks kicker', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker', { isAdmin: true })
    const client2 = createMockClient(2, 'Player2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3

    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)
    server.settings.voteKickTimer = 30000

    // Start a vote (3 players: 2 eligible non-kickee → vote starts)
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    // Override voteStartTime to simulate expiry
    ;(tracker as any).voteStartTime = Date.now() - 31000

    // Tick should end the vote
    tracker.tick()

    // Vote should be cleared
    expect((tracker as any).voteStartTime).toBeNull()
    expect((tracker as any).kickee).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // tick() — ends vote when kickee disconnected
  // ---------------------------------------------------------------------------

  it('tick() ends vote when kickee is no longer in conns', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker', { isAdmin: true })
    const client2 = createMockClient(2, 'Player2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3

    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // Start a vote
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    // Remove kickee from conns
    server.conns = [conn1, conn2]

    tracker.tick()

    // Vote should be cleared
    expect((tracker as any).voteStartTime).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // voteKick() — rejects when server not in GameStarted state
  // ---------------------------------------------------------------------------

  it('voteKick() rejects when server is not in GameStarted state', () => {
    server.state = ServerState.WaitingPlayers
    const conn1 = createMockConn(1)
    const client1 = createMockClient(1, 'Player1', { isAdmin: true })
    const conn2 = createMockConn(2)
    const client2 = createMockClient(2, 'Player2')

    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, true)

    expect(result).toBe(false)
    expect(server.sendFluentMessageTo).toHaveBeenCalledWith(
      conn1,
      'notification-unable-to-start-a-vote',
    )
  })

  // ---------------------------------------------------------------------------
  // voteKick() — rejects when kickee is admin on non-dedicated server
  // ---------------------------------------------------------------------------

  it('voteKick() rejects when kickee is admin on non-dedicated server', () => {
    server.type = ServerType.Multiplayer
    const conn1 = createMockConn(1)
    const client1 = createMockClient(1, 'Kicker', { isAdmin: true })
    const conn2 = createMockConn(2)
    const client2 = createMockClient(2, 'AdminKickee', { isAdmin: true })

    conn1.__client = client1
    conn2.__client = client2
    server.conns = [conn1, conn2]
    server.getClient = vi.fn((c: any) => c.__client)

    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, true)

    expect(result).toBe(false)
    expect(server.sendFluentMessageTo).toHaveBeenCalledWith(
      conn1,
      'notification-unable-to-start-a-vote',
    )
  })

  // ---------------------------------------------------------------------------
  // voteKick() — allows kicking admin on dedicated server
  // ---------------------------------------------------------------------------

  it('voteKick() allows kicking admin on dedicated server', () => {
    server.type = ServerType.Dedicated
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker')
    const client2 = createMockClient(2, 'Player2')
    const client3 = createMockClient(3, 'AdminKickee', { isAdmin: true })

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3
    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // Should not reject — admin can be kicked on dedicated server
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    // Vote should be started (StartKickVote order dispatched)
    expect(server.dispatchServerOrdersToClients).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // voteKick() — rejects starting a vote with a downvote
  // ---------------------------------------------------------------------------

  it('voteKick() rejects starting with a downvote', () => {
    const conn1 = createMockConn(1)
    const client1 = createMockClient(1, 'Player1', { isAdmin: true })
    const conn2 = createMockConn(2)
    const client2 = createMockClient(2, 'Player2')

    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, false)

    expect(result).toBe(false)
    expect(server.sendFluentMessageTo).toHaveBeenCalledWith(
      conn1,
      'notification-unable-to-start-a-vote',
    )
  })

  // ---------------------------------------------------------------------------
  // voteKick() — prevents double voting
  // ---------------------------------------------------------------------------

  it('voteKick() prevents double voting', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Player1', { isAdmin: true })
    const client2 = createMockClient(2, 'Player2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3
    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // First vote — should start the vote (3 players, eligible=2 → starts)
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    // Second vote from same player — should be rejected as already voted
    const result = tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    expect(result).toBe(false)
    expect(server.sendFluentMessageTo).toHaveBeenCalledWith(
      conn1,
      'notification-kick-already-voted',
    )
  })

  // ---------------------------------------------------------------------------
  // voteKick() — counts votes correctly and succeeds when threshold reached
  // ---------------------------------------------------------------------------

  it('voteKick() succeeds when threshold is reached with multiple voters', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker1')
    const client2 = createMockClient(2, 'Kicker2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3
    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // First player starts vote (eligible=2 non-kickee, then +1 kickee = 3, needs 2)
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)
    // Vote is ongoing, voteFor=1, eligible=3, need 2

    // Second player votes yes → should pass (2 >= 2)
    const result = tracker.voteKick(conn2, client2, conn3, client3, 3, true)

    expect(result).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // voteKick() — ends vote when it becomes impossible
  // ---------------------------------------------------------------------------

  it('voteKick() blocks and ends vote when it becomes impossible', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker1')
    const client2 = createMockClient(2, 'Kicker2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3
    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // First player starts vote
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    // Second player votes NO
    const result = tracker.voteKick(conn2, client2, conn3, client3, 3, false)

    // With 3 eligible (2 non-kickee + kickee), need 2 for
    // votesFor=1, votesAgainst=2 (kickee counts as against + voter2's no)
    // eligible - votesAgainst = 3 - 2 = 1 < votesNeeded(2) → impossible
    expect(result).toBe(false)
    // Vote should be ended and kicker blocked
    expect((tracker as any).voteStartTime).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // voteKick() — observer without power is rejected
  // ---------------------------------------------------------------------------

  it('voteKick() rejects when kicker is observer without power', () => {
    const conn1 = createMockConn(1)
    const client1 = createMockClient(1, 'Observer', { isObserver: true, isAdmin: false })
    const conn2 = createMockConn(2)
    const client2 = createMockClient(2, 'Player2')

    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, true)

    expect(result).toBe(false)
    expect(server.sendFluentMessageTo).toHaveBeenCalledWith(
      conn1,
      'notification-unable-to-start-a-vote',
    )
  })

  // ---------------------------------------------------------------------------
  // voteKick() — dead player without power is rejected
  // ---------------------------------------------------------------------------

  it('voteKick() rejects when kicker has won or lost', () => {
    const conn1 = createMockConn(1)
    const client1 = createMockClient(1, 'DeadPlayer', { isObserver: false, wonOrLost: true })
    const conn2 = createMockConn(2)
    const client2 = createMockClient(2, 'Player2')

    server.hasClientWonOrLost = vi.fn((c: any) => c.__wonOrLost ?? false)

    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, true)

    expect(result).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // endKickVote() — clears state and sends messaging
  // ---------------------------------------------------------------------------

  it('endKickVote() clears all vote state', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker', { isAdmin: true })
    const client2 = createMockClient(2, 'Player2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3
    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // Start a vote
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)
    expect((tracker as any).voteStartTime).not.toBeNull()

    // End via tick (simulate kickee disconnect)
    server.conns = [conn1, conn2]
    tracker.tick()

    expect((tracker as any).voteStartTime).toBeNull()
    expect((tracker as any).kickee).toBeNull()
    expect((tracker as any).voteKickerStarter).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Failed vote starter cooldown
  // ---------------------------------------------------------------------------

  it('failed vote starter is blocked by cooldown', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const client1 = createMockClient(1, 'Kicker1')
    const client2 = createMockClient(2, 'Kicker2')
    const client3 = createMockClient(3, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    conn3.__client = client3
    server.conns = [conn1, conn2, conn3]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // Start and fail a vote with conn1+kicker
    tracker.voteKick(conn1, client1, conn3, client3, 3, true)

    // Second player votes NO — makes it impossible
    tracker.voteKick(conn2, client2, conn3, client3, 3, false)
    // Vote ended, kicker (client1) blocked

    // Now try to start another vote with the same kicker
    // The failedVoteKickers should block client1
    const conn4 = createMockConn(4)
    const client4 = createMockClient(4, 'NewTarget')

    conn4.__client = client4
    server.conns = [conn1, conn2, conn4]
    server.getClient = vi.fn((c: any) => c.__client)

    const result = tracker.voteKick(conn1, client1, conn4, client4, 4, true)

    // Should be rejected due to cooldown
    expect(result).toBe(false)
    expect(server.sendFluentMessageTo).toHaveBeenCalledWith(
      conn1,
      'notification-unable-to-start-a-vote',
    )
  })

  // ---------------------------------------------------------------------------
  // voteKick() — single player can kick observer
  // ---------------------------------------------------------------------------

  it('single player can kick observer when they are the only player', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const client1 = createMockClient(1, 'OnlyPlayer', { isAdmin: true })
    const client2 = createMockClient(2, 'Observer', { isObserver: true })

    conn1.__client = client1
    conn2.__client = client2
    server.conns = [conn1, conn2]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // eligiblePlayers starts at 0
    // client1 has power (admin), client2 is observer (no power)
    // But client2 IS the kickee, so eligiblePlayers = 1 (just client1)
    // eligiblePlayers (1) < 2 → goes to the else branch
    // kickee.isObserver=true AND vote=true → endKickVote(false) return true
    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, true)

    expect(result).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // voteKick() — rejects when kickee is not in conns
  // ---------------------------------------------------------------------------

  it('voteKick() returns false when kickee is not online', () => {
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const client1 = createMockClient(1, 'Kicker', { isAdmin: true })
    const client2 = createMockClient(2, 'Kickee')

    conn1.__client = client1
    conn2.__client = client2
    // kickee conn2 IS in conns, but we don't include it in the server getClient mock
    server.conns = [conn1]
    server.getClient = vi.fn((c: any) => {
      if (c === conn1) return client1
      return undefined
    })

    const result = tracker.voteKick(conn1, client1, conn2, client2, 2, true)

    // isKickeeOnline stays false because conn2 is not in server.conns loop
    expect(result).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // voteKick() — admin can always participate
  // ---------------------------------------------------------------------------

  it('admin observer can participate in vote kick', () => {
    // 4 players: Admin (observer/dead), Player2, Player3, Kickee (observer).
    // eligible=3 (admin+2 players), avoids adminIsDeadButOnline edge case check
    // (<3). Kickee observer means no power → votesNeeded=2 from eligible=3.
    const conn1 = createMockConn(1)
    const conn2 = createMockConn(2)
    const conn3 = createMockConn(3)
    const conn4 = createMockConn(4)
    const adminClient = createMockClient(1, 'Admin', { isAdmin: true, isObserver: true })
    const player2 = createMockClient(2, 'Player2')
    const player3 = createMockClient(3, 'Player3')
    const kickeeClient = createMockClient(4, 'Kickee', { isObserver: true })

    conn1.__client = adminClient
    conn2.__client = player2
    conn3.__client = player3
    conn4.__client = kickeeClient
    server.conns = [conn1, conn2, conn3, conn4]
    server.getClient = vi.fn((c: any) => c.__client)
    server.hasClientWonOrLost = vi.fn(() => false)

    // Admin starts vote
    tracker.voteKick(conn1, adminClient, conn4, kickeeClient, 4, true)

    // eligible non-kickee = 3, adminIsDeadButOnline=true but eligible>=3 → OK
    // Kickee observer → no power → eligible stays 3, need 2
    // Admin votes yes, then Player2 votes yes → 2 >= 2 → pass
    const result = tracker.voteKick(
      conn2,
      player2,
      conn4,
      kickeeClient,
      4,
      true,
    )

    expect(result).toBe(true)
  })
})
