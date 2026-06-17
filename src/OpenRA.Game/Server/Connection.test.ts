/**
 * Connection.test.ts -- Connection unit tests
 *
 * Tests focus on: binary protocol state machine (header/data parsing),
 * ping frame construction, ping handling, transport delegation, lifecycle
 * (create -> use -> dispose), and edge cases like multi-packet buffering
 * and excessive order length rejection.
 *
 * Since Connection does not depend on @babylonjs/core, no Babylon.js mocks
 * are needed. The transport and server callbacks are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Connection, type ServerCallbacks } from './Connection.js'
import { OrderType } from './ProtocolVersion.js'
import type { IClientTransport } from './Server.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock IClientTransport with full control over event dispatch.
 */
function createMockTransport(remoteAddr = '127.0.0.1:54321') {
  const msgHandlers: Array<(data: Uint8Array) => void> = []
  const closeHandlers: Array<() => void> = []
  const errorHandlers: Array<(err: Error) => void> = []

  return {
    send: vi.fn(() => true),
    onMessage: vi.fn((handler: (data: Uint8Array) => void) => { msgHandlers.push(handler) }),
    onClose: vi.fn((handler: () => void) => { closeHandlers.push(handler) }),
    onError: vi.fn((handler: (err: Error) => void) => { errorHandlers.push(handler) }),
    close: vi.fn(),
    remoteAddress: remoteAddr,

    // Test helpers
    _triggerMessage: (data: Uint8Array) => {
      for (const h of msgHandlers) h(data)
    },
    _triggerClose: () => {
      for (const h of closeHandlers) h()
    },
    _triggerError: (err: Error) => {
      for (const h of errorHandlers) h(err)
    },
  } as IClientTransport & {
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    _triggerMessage: (data: Uint8Array) => void
    _triggerClose: () => void
    _triggerError: (err: Error) => void
  }
}

/**
 * Create mock ServerCallbacks for verifying Connection -> Server calls.
 */
function createMockServerCallbacks(): ServerCallbacks & {
  _onConnectionPacket: ReturnType<typeof vi.fn>
  _onConnectionDisconnect: ReturnType<typeof vi.fn>
  _receivePing: ReturnType<typeof vi.fn>
} {
  return {
    _onConnectionPacket: vi.fn(),
    _onConnectionDisconnect: vi.fn(),
    _receivePing: vi.fn(),
    isMultiplayer: false,
  }
}

/**
 * Build a CLIENT->SERVER binary frame:
 *   [length: int32 LE][frame: int32 LE][data: bytes]
 */
function buildClientFrame(frame: number, data: Uint8Array): Uint8Array {
  const totalLen = 8 + data.length // 8-byte header + data
  const buf = new Uint8Array(totalLen)
  const dv = new DataView(buf.buffer)
  dv.setInt32(0, data.length + 4, true) // length = data.length + 4 (for frame field)
  dv.setInt32(4, frame, true)
  buf.set(data, 8)
  return buf
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Connection', () => {
  // These use vi.useFakeTimers, so they need their own describe block
  // without timer manipulation for basic tests.

  describe('constructor', () => {
    it('sets all public properties correctly', () => {
      const transport = createMockTransport('10.0.0.1:9999')
      const server = createMockServerCallbacks()

      const conn = new Connection(server, transport, 5, 'test-token')

      expect(conn.playerIndex).toBe(5)
      expect(conn.authToken).toBe('test-token')
      expect(conn.endPoint).toBe('10.0.0.1:9999')
      expect(conn.connectionTimer).toBeGreaterThan(0)
      expect(conn.validated).toBe(false)
      expect(conn.lastOrdersFrame).toBe(0)
      expect(conn.timeoutMessageShown).toBe(false)
    })

    it('registers transport event handlers', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()

      new Connection(server, transport, 0, 'token')

      expect(transport.onMessage).toHaveBeenCalledTimes(1)
      expect(transport.onClose).toHaveBeenCalledTimes(1)
      expect(transport.onError).toHaveBeenCalledTimes(1)
    })

    it('starts ping interval timer', () => {
      vi.useFakeTimers()
      const transport = createMockTransport()
      const server = createMockServerCallbacks()

      new Connection(server, transport, 0, 'token')

      // Advance time and check that send was called with a ping frame
      vi.advanceTimersByTime(1000)
      expect(transport.send).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('timeSinceLastResponse', () => {
    it('returns time since last message', () => {
      vi.useFakeTimers()
      const transport = createMockTransport()
      const server = createMockServerCallbacks()

      const conn = new Connection(server, transport, 0, 'token')

      // Initially close to 0
      const initial = conn.timeSinceLastResponse
      expect(initial).toBeGreaterThanOrEqual(0)

      // Advance time without receiving messages
      vi.advanceTimersByTime(5000)
      expect(conn.timeSinceLastResponse).toBeGreaterThanOrEqual(5000)

      vi.useRealTimers()
    })

    it('resets when a message is received', () => {
      vi.useFakeTimers()
      const transport = createMockTransport()
      const server = createMockServerCallbacks()

      const conn = new Connection(server, transport, 0, 'token')

      vi.advanceTimersByTime(3000)
      expect(conn.timeSinceLastResponse).toBeGreaterThanOrEqual(3000)

      // Send any valid frame to trigger message handling
      const frame = buildClientFrame(0, new Uint8Array([0x01]))
      transport._triggerMessage(frame)

      expect(conn.timeSinceLastResponse).toBeLessThan(1000)

      vi.useRealTimers()
    })
  })

  describe('createPingFrame', () => {
    it('produces 21-byte frame', () => {
      const frame = Connection.createPingFrame()
      expect(frame.length).toBe(21)
    })

    it('has correct header structure', () => {
      const frame = Connection.createPingFrame()
      const dv = new DataView(frame.buffer)

      // Length = 13 (9 data bytes + 4 for frame field)
      expect(dv.getInt32(0, true)).toBe(13)
      // Client = 0 (server-authored)
      expect(dv.getInt32(4, true)).toBe(0)
      // Frame = 0
      expect(dv.getInt32(8, true)).toBe(0)
    })

    it('has OrderType.Ping at byte 12', () => {
      const frame = Connection.createPingFrame()
      expect(frame[12]).toBe(OrderType.Ping)
    })

    it('contains a BigInt64 timestamp at bytes 13-20', () => {
      const frame = Connection.createPingFrame()
      const dv = new DataView(frame.buffer)

      const ts = dv.getBigInt64(13, true)
      const dateFromTs = Number(ts)
      const now = Date.now()

      // Timestamp should be very close to current time
      expect(Math.abs(dateFromTs - now)).toBeLessThan(100)
    })
  })

  describe('_handleMessage', () => {
    let transport: ReturnType<typeof createMockTransport>
    let server: ReturnType<typeof createMockServerCallbacks>
    let conn: Connection

    beforeEach(() => {
      transport = createMockTransport()
      server = createMockServerCallbacks()
      conn = new Connection(server, transport, 3, 'token')
    })

    // -----------------------------------------------------------------------
    // Header parsing
    // -----------------------------------------------------------------------

    it('parses header correctly (extracts frame number)', () => {
      const data = new Uint8Array([0xAB, 0xCD])
      const frame = buildClientFrame(42, data)

      transport._triggerMessage(frame)

      expect(server._onConnectionPacket).toHaveBeenCalledTimes(1)

      // Check the frame number that was passed to the server
      const callArgs = server._onConnectionPacket.mock.calls[0]
      expect(callArgs[1]).toBe(42) // frame
    })

    it('transitions Header -> Data -> Header state machine correctly', () => {
      // Send frame 1
      const frame1 = buildClientFrame(1, new Uint8Array([0x01, 0x02]))
      transport._triggerMessage(frame1)

      expect(server._onConnectionPacket).toHaveBeenCalledTimes(1)
      const args1 = server._onConnectionPacket.mock.calls[0]
      expect(args1[1]).toBe(1)
      expect(args1[2].length).toBe(2)

      // Send frame 2
      const frame2 = buildClientFrame(2, new Uint8Array([0x03]))
      transport._triggerMessage(frame2)

      expect(server._onConnectionPacket).toHaveBeenCalledTimes(2)
      const args2 = server._onConnectionPacket.mock.calls[1]
      expect(args2[1]).toBe(2)
      expect(args2[2].length).toBe(1)
    })

    // -----------------------------------------------------------------------
    // Multi-packet buffering
    // -----------------------------------------------------------------------

    it('handles multiple packets in a single message', () => {
      const frame1 = buildClientFrame(10, new Uint8Array([0xAA]))
      const frame2 = buildClientFrame(20, new Uint8Array([0xBB, 0xCC]))

      // Concatenate both frames
      const combined = new Uint8Array(frame1.length + frame2.length)
      combined.set(frame1, 0)
      combined.set(frame2, frame1.length)
      transport._triggerMessage(combined)

      expect(server._onConnectionPacket).toHaveBeenCalledTimes(2)
      expect(server._onConnectionPacket.mock.calls[0][1]).toBe(10)
      expect(server._onConnectionPacket.mock.calls[1][1]).toBe(20)
    })

    it('handles partial data across multiple message events', () => {
      // Send half of a frame header
      const fullFrame = buildClientFrame(99, new Uint8Array([0xFF]))
      const firstHalf = fullFrame.slice(0, 4)
      const secondHalf = fullFrame.slice(4)

      transport._triggerMessage(firstHalf)
      // Should not have triggered server callback yet (incomplete header)
      expect(server._onConnectionPacket).toHaveBeenCalledTimes(0)

      transport._triggerMessage(secondHalf)
      expect(server._onConnectionPacket).toHaveBeenCalledTimes(1)
      expect(server._onConnectionPacket.mock.calls[0][1]).toBe(99)
    })

    it('handles data split across message boundaries', () => {
      const largeData = new Uint8Array(100)
      for (let i = 0; i < 100; i++) largeData[i] = i & 0xFF
      const frame = buildClientFrame(5, largeData)

      // Send header + first 10 bytes of data
      transport._triggerMessage(frame.slice(0, 18))
      expect(server._onConnectionPacket).toHaveBeenCalledTimes(0)

      // Send remaining data
      transport._triggerMessage(frame.slice(18))
      expect(server._onConnectionPacket).toHaveBeenCalledTimes(1)
      expect(server._onConnectionPacket.mock.calls[0][2].length).toBe(100)
    })

    // -----------------------------------------------------------------------
    // Ping handling
    // -----------------------------------------------------------------------

    it('correctly identifies and handles ping packets', () => {
      // Client ping response: [length=14][frame=0][0x20][timestamp:8][queueLength=1]
      const pingTs = BigInt(Date.now() - 50) // 50ms ago
      const data = new Uint8Array(10)
      data[0] = OrderType.Ping
      const dv = new DataView(data.buffer)
      dv.setBigInt64(1, pingTs, true)
      data[9] = 3 // queueLength

      const frame = buildClientFrame(0, data)
      transport._triggerMessage(frame)

      // Should NOT call _onConnectionPacket for pings
      expect(server._onConnectionPacket).toHaveBeenCalledTimes(0)
      // Should call _receivePing instead
      expect(server._receivePing).toHaveBeenCalledTimes(1)
    })

    it('routes non-ping packets to server._onConnectionPacket', () => {
      const data = new Uint8Array([0xAB, 0xCD, 0xEF])
      const frame = buildClientFrame(7, data)

      transport._triggerMessage(frame)

      expect(server._onConnectionPacket).toHaveBeenCalledTimes(1)
      expect(server._receivePing).toHaveBeenCalledTimes(0)

      const callArgs = server._onConnectionPacket.mock.calls[0]
      expect(callArgs[0]).toBe(conn)
      expect(callArgs[1]).toBe(7) // frame
      expect(callArgs[2]).toEqual(data)
    })

    // -----------------------------------------------------------------------
    // Excessive order length
    // -----------------------------------------------------------------------

    it('rejects excessive order length in multiplayer mode', () => {
      server.isMultiplayer = true

      // Create a frame with length exceeding MaxOrderLength
      // We need to craft the header manually
      const hugeDataLen = 200000 // > 131072
      const buf = new Uint8Array(8) // header only
      const dv = new DataView(buf.buffer)
      dv.setInt32(0, hugeDataLen + 4, true) // header says length = hugeDataLen + 4
      dv.setInt32(4, 0, true)

      // Trigger message with just the header (no actual data needed)
      transport._triggerMessage(buf)

      // Should have triggered close -> disconnect
      expect(server._onConnectionDisconnect).toHaveBeenCalledTimes(1)
    })

    it('allows large orders in non-multiplayer mode', () => {
      server.isMultiplayer = false

      // Same large data but in single-player mode
      const hugeDataLen = 200000
      const buf = new Uint8Array(8)
      const dv = new DataView(buf.buffer)
      dv.setInt32(0, hugeDataLen + 4, true)
      dv.setInt32(4, 0, true)

      // Should NOT close immediately (even though we'd need hugeDataLen bytes of data)
      transport._triggerMessage(buf)
      // The header is accepted; now it's looking for hugeDataLen bytes of data,
      // which isn't available, so nothing happens. No disconnect.
      expect(server._onConnectionDisconnect).toHaveBeenCalledTimes(0)
    })
  })

  describe('trySendData', () => {
    it('delegates to transport.send', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      const conn = new Connection(server, transport, 0, 'token')

      const data = new Uint8Array([0x01, 0x02, 0x03])
      const result = conn.trySendData(data)

      expect(transport.send).toHaveBeenCalledWith(data)
      expect(result).toBe(true)
    })

    it('returns false when transport.send fails', () => {
      const transport = createMockTransport()
      transport.send.mockReturnValue(false)
      const server = createMockServerCallbacks()
      const conn = new Connection(server, transport, 0, 'token')

      const result = conn.trySendData(new Uint8Array([0x01]))
      expect(result).toBe(false)
    })
  })

  describe('dispose', () => {
    it('clears ping timer and closes transport', () => {
      vi.useFakeTimers()
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      const conn = new Connection(server, transport, 0, 'token')

      // Verify ping was being sent
      vi.advanceTimersByTime(1000)
      expect(transport.send).toHaveBeenCalled()

      // Reset mock and dispose
      transport.send.mockClear()
      conn.dispose()

      // Advance time -- ping should NOT fire after dispose
      vi.advanceTimersByTime(5000)
      expect(transport.send).not.toHaveBeenCalled()

      expect(transport.close).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('does not double-cleanup on multiple dispose calls', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      const conn = new Connection(server, transport, 0, 'token')

      conn.dispose()
      conn.dispose()

      // close should only be called once
      expect(transport.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('_handleClose', () => {
    it('notifies server on transport close', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      new Connection(server, transport, 0, 'token')

      transport._triggerClose()

      expect(server._onConnectionDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('_handleError', () => {
    it('logs error and triggers close handling', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()

      // Spy on console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      new Connection(server, transport, 0, 'token')

      transport._triggerError(new Error('test error'))

      expect(consoleSpy).toHaveBeenCalled()
      expect(server._onConnectionDisconnect).toHaveBeenCalledTimes(1)

      consoleSpy.mockRestore()
    })
  })

  describe('ping history', () => {
    it('caps ping history at MaxPingSamples (15)', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      new Connection(server, transport, 0, 'token')

      // Send 20 ping frames
      for (let i = 0; i < 20; i++) {
        const pingTs = BigInt(Date.now() - 10 * (i + 1))
        const data = new Uint8Array(10)
        data[0] = OrderType.Ping
        const dv = new DataView(data.buffer)
        dv.setBigInt64(1, pingTs, true)
        data[9] = 0

        const frame = buildClientFrame(0, data)
        transport._triggerMessage(frame)
      }

      // Check the last call to _receivePing had at most 15 samples
      const lastCall = server._receivePing.mock.calls[
        server._receivePing.mock.calls.length - 1
      ]
      const pingHistory = lastCall[1] as number[]
      expect(pingHistory.length).toBeLessThanOrEqual(15)
    })
  })

  describe('ping interval', () => {
    it('sends ping every 1 second', () => {
      vi.useFakeTimers()
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      new Connection(server, transport, 0, 'token')

      // First interval
      vi.advanceTimersByTime(1000)
      expect(transport.send).toHaveBeenCalledTimes(1)

      // Second interval
      vi.advanceTimersByTime(1000)
      expect(transport.send).toHaveBeenCalledTimes(2)

      // Third interval
      vi.advanceTimersByTime(1000)
      expect(transport.send).toHaveBeenCalledTimes(3)

      vi.useRealTimers()
    })
  })

  describe('empty message handling', () => {
    it('handles empty message gracefully (no crash)', () => {
      const transport = createMockTransport()
      const server = createMockServerCallbacks()
      new Connection(server, transport, 0, 'token')

      // Sending empty data should not crash
      expect(() => transport._triggerMessage(new Uint8Array(0))).not.toThrow()
    })
  })
})
