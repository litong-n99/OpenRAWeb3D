/**
 * Connection.ts -- Per-client WebSocket connection handler implementing the
 * OpenRA binary protocol state machine for the server side.
 *
 * OpenRA 对照: OpenRA.Game/Server/Connection.cs (220 lines C#)
 *
 * 核心范式转换:
 * - C# Thread-based SendReceiveLoop with socket.Poll()/Receive()/Send() ->
 *   WebSocket event handlers: onMessage, onClose, onError
 * - C# BlockingCollection<byte[]> send queue ->
 *   Direct transport.send() call (WebSocket handles buffering internally)
 * - C# MemoryStream + BinaryWriter for frame construction ->
 *   DataView + Uint8Array with little-endian writes
 * - C# Stopwatch for ping timing ->
 *   Date.now() for timestamps
 * - C# ConcurrentQueue<int> for ping history ->
 *   number[] with push/shift (single-threaded, no concurrent access)
 * - C# socket.Poll() for non-blocking receive ->
 *   Event-driven message delivery via WebSocket
 * - C# sendQueue.TryTake / CompleteAdding ->
 *   Direct transport.send() with boolean return
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { OrderType, MaxOrderLength, type ReceiveState } from './ProtocolVersion.js'
import type { IClientTransport } from './Server.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cap ping history at 15 seconds as a balance between expiring stale state
 * and having enough data for decent statistics.
 *
 * OpenRA 对照: Connection.MaxPingSamples = 15
 */
const MaxPingSamples = 15

/**
 * Ping interval in milliseconds.
 */
const PingInterval = 1000

// ---------------------------------------------------------------------------
// ServerCallbacks — internal interface for methods Connection needs from Server
// ---------------------------------------------------------------------------

/**
 * Internal interface documenting the Server methods that Connection calls.
 * These are private methods on the Server class but are accessed at runtime
 * via structural typing (TypeScript `private` is compile-time only).
 *
 * OpenRA 对照:
 *   Server.OnConnectionPacket(Connection, int, byte[])
 *   Server.OnConnectionDisconnect(Connection)
 *   Server.OnConnectionPing(Connection, int[])
 *
 * @remarks
 * queueLength (byte 9 of ping packets) is intentionally omitted from the
 * callback signature — the current Server implementation does not use it,
 * matching the simplified web architecture.
 */
export interface ServerCallbacks {
  _onConnectionPacket(conn: Connection, frame: number, data: Uint8Array): void
  _onConnectionDisconnect(conn: Connection): void
  _receivePing(conn: Connection, pingHistory: number[]): void
  isMultiplayer: boolean
}

// ---------------------------------------------------------------------------
// Connection Class
// ---------------------------------------------------------------------------

/**
 * Server-side per-client connection handler. Manages the binary protocol
 * state machine, ping measurement, and lifecycle for a single connected
 * client. Replaces the C# multi-threaded SendReceiveLoop with event-driven
 * WebSocket handlers.
 *
 * OpenRA 对照: sealed class Connection : IDisposable
 */
export class Connection {
  // ---- Public Properties (对应 C# public readonly / public fields) ----

  readonly playerIndex: number
  readonly authToken: string
  readonly endPoint: string
  readonly connectionTimer: number

  /** Whether the client has completed handshake validation. */
  validated = false

  /** The most recent orders frame number sent by this client. */
  lastOrdersFrame = 0

  /** Whether a timeout warning has been shown to this client. */
  timeoutMessageShown = false

  // ---- Private Properties ----

  private readonly _server: ServerCallbacks
  private readonly _transport: IClientTransport

  /** Timestamp (Date.now()) of the last message received from the client. */
  private _lastReceivedTime = Date.now()

  /** Ring buffer of recent ping sample values (capped at MaxPingSamples). */
  private readonly _pingHistory: number[] = []

  /** Accumulated read buffer for the binary protocol state machine. */
  private _readBuffer = new Uint8Array(0)

  /** Current state of the binary protocol read state machine. */
  private _state: ReceiveState = 'Header'

  /** Number of bytes expected in the current state. */
  private _expectLength = 8

  /** Frame number parsed from the most recent header. */
  private _frame = 0

  /** Handle for the periodic ping interval timer. */
  private _pingTimer: ReturnType<typeof setInterval> | null = null

  /** Whether dispose() has been called (prevents double cleanup). */
  private _disposed = false

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA Connection constructor)
  // ---------------------------------------------------------------------------

  /**
   * Create a new server-side connection handler for a client.
   *
   * OpenRA 对照: Connection(Server, Socket, string)
   *
   * @param server       -- Server back-reference for event dispatch
   * @param transport    -- Transport layer for sending/receiving data
   * @param playerIndex  -- Assigned player index
   * @param authToken    -- Authentication token for this connection
   */
  constructor(
    server: ServerCallbacks,
    transport: IClientTransport,
    playerIndex: number,
    authToken: string,
  ) {
    this._server = server
    this._transport = transport
    this.playerIndex = playerIndex
    this.authToken = authToken
    this.endPoint = transport.remoteAddress
    this.connectionTimer = Date.now()

    // Register WebSocket event handlers
    transport.onMessage((data: Uint8Array) => this._handleMessage(data))
    transport.onClose(() => this._handleClose())
    transport.onError((err: Error) => this._handleError(err))

    // Start periodic ping timer
    this._pingTimer = setInterval(() => this._sendPing(), PingInterval)
  }

  // ---------------------------------------------------------------------------
  // timeSinceLastResponse (对应 C# TimeSinceLastResponse getter)
  // ---------------------------------------------------------------------------

  /**
   * Time in milliseconds since the last message was received from the client.
   *
   * OpenRA 对照: Connection.TimeSinceLastResponse -> Game.RunTime - lastReceivedTime
   */
  get timeSinceLastResponse(): number {
    return Date.now() - this._lastReceivedTime
  }

  // ---------------------------------------------------------------------------
  // createPingFrame (static) — 对应 C# CreatePingFrame()
  // ---------------------------------------------------------------------------

  /**
   * Create a binary ping frame for server-to-client latency measurement.
   *
   * The frame is sent to the client, which echoes the timestamp back.
   * The server then computes round-trip time from the difference.
   *
   * Frame layout (SERVER->CLIENT format, matching Server.createFrame):
   *   [len: int32 LE = 13] [client: int32 LE = 0] [frame: int32 LE = 0]
   *   [0x20: OrderType.Ping] [timestamp: BigInt64 LE]
   * Total: 4 + 4 + 4 + 1 + 8 = 21 bytes
   *
   * OpenRA 对照: static byte[] CreatePingFrame()
   *   MemoryStream(21), Write(13), Write(0), Write(0), WriteByte(0x20),
   *   Write(Game.RunTime)
   *
   * @remarks
   * SERVER->CLIENT frames have a 12-byte header [length: int32][clientId:
   * int32][frame: int32]. CLIENT->SERVER frames (received in _handleMessage)
   * have an 8-byte header [length: int32][frame: int32].
   */
  static createPingFrame(): Uint8Array {
    const dataLength = 1 + 8 // 1 byte OrderType.Ping + 8 bytes timestamp
    const totalLength = 12 + dataLength // 12-byte header + 9-byte data
    const buf = new Uint8Array(totalLength)
    const dv = new DataView(buf.buffer)

    // Header
    dv.setInt32(0, dataLength + 4, true) // length = 9 + 4 = 13 (excludes self)
    dv.setInt32(4, 0, true)              // client = 0 (server-authored)
    dv.setInt32(8, 0, true)              // frame = 0

    // Data: [OrderType.Ping][timestamp: BigInt64]
    buf[12] = OrderType.Ping
    dv.setBigInt64(13, BigInt(Date.now()), true)

    return buf
  }

  // ---------------------------------------------------------------------------
  // trySendData (对应 C# TrySendData)
  // ---------------------------------------------------------------------------

  /**
   * Attempt to send data to the client.
   *
   * OpenRA 对照: Connection.TrySendData(byte[])
   *
   * @param data -- Binary frame data to send
   * @returns true if the data was accepted for sending, false on failure
   */
  trySendData(data: Uint8Array): boolean {
    return this._transport.send(data)
  }

  // ---------------------------------------------------------------------------
  // dispose (对应 C# Dispose)
  // ---------------------------------------------------------------------------

  /**
   * Dispose the connection, stopping the ping timer and closing the
   * transport layer.
   *
   * OpenRA 对照: Connection.Dispose() -- sendQueue.CompleteAdding()
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }

    this._transport.close()
  }

  // ---------------------------------------------------------------------------
  // _sendPing — periodic ping transmission
  // ---------------------------------------------------------------------------

  /**
   * Send a ping frame to the client. Called on the ping interval timer.
   *
   * OpenRA 对照: SendReceiveLoop ping section:
   *   if (lastPingSent.ElapsedMilliseconds > 1000 && TrySendData(CreatePingFrame()))
   *     lastPingSent.Restart()
   */
  private _sendPing(): void {
    if (this._disposed) return
    this.trySendData(Connection.createPingFrame())
  }

  // ---------------------------------------------------------------------------
  // _handleMessage — binary protocol receive state machine
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming WebSocket message. Implements the OpenRA binary
   * protocol receive state machine (Header/Data states) with buffering
   * for multi-packet messages.
   *
   * Protocol format (CLIENT->SERVER):
   *   [length: int32 LE]   -- total bytes after this field, minus 4 (for frame)
   *   [frame: int32 LE]    -- frame number
   *   [data: bytes]        -- order data (variable length)
   *
   * Receive states:
   *   'Header': expectLength = 8 (read length + frame)
   *   'Data':   expectLength = length - 4 (read order data)
   *
   * After processing data, resets to 'Header' with expectLength = 8.
   *
   * OpenRA 对照: SendReceiveLoop socket read + state machine
   *
   * @param data -- Raw binary data received from the WebSocket
   */
  private _handleMessage(data: Uint8Array): void {
    if (this._disposed) return

    // Concatenate to read buffer
    const combined = new Uint8Array(this._readBuffer.length + data.length)
    combined.set(this._readBuffer, 0)
    combined.set(data, this._readBuffer.length)
    this._readBuffer = combined

    this._lastReceivedTime = Date.now()
    this.timeoutMessageShown = false

    // Process all complete protocol-level packets in the buffer
    while (this._readBuffer.length >= this._expectLength) {
      const bytes = this._readBuffer.slice(0, this._expectLength)
      this._readBuffer = this._readBuffer.slice(this._expectLength)

      if (this._state === 'Header') {
        this._processHeader(bytes)
      } else {
        this._processData(bytes)
      }
    }
  }

  /**
   * Process a header packet (8 bytes: [length: int32][frame: int32]).
   *
   * OpenRA 对照: ReceiveState.Header case
   */
  private _processHeader(bytes: Uint8Array): void {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    // Parse header fields
    const length = dv.getInt32(0, true)
    this._frame = dv.getInt32(4, true)

    // Compute expected data length: length field counts frame (4 bytes) + data,
    // so data length = length - 4. After data, we return to 8-byte header.
    this._expectLength = length - 4

    this._state = 'Data'

    // Validate length: must be non-negative, and for multiplayer within limit
    if (this._expectLength < 0 || (this._server.isMultiplayer && this._expectLength > MaxOrderLength)) {
      console.error(
        `Connection: excessive order length ${this._expectLength} from ${this.endPoint}`,
      )
      this._handleClose()
    }
  }

  /**
   * Process a data packet (variable length, routing based on content).
   *
   * OpenRA 对照: ReceiveState.Data case
   */
  private _processData(bytes: Uint8Array): void {
    // Ping packets are processed internally to reduce server-introduced
    // latencies from polling loops.
    // Ping data layout: [0x20: byte][timestamp: int64 LE] = 9 bytes from server.
    // Client response adds queueLength: [0x20: byte][timestamp: int64 LE][queueLength: byte] = 10 bytes.
    if (this._expectLength === 10 && bytes.length >= 1 && bytes[0] === OrderType.Ping) {
      if (bytes.length >= 9) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const pingTimestamp = Number(dv.getBigInt64(1, true))

        // Add to ping history, capped at MaxPingSamples
        this._pingHistory.push(Date.now() - pingTimestamp)
        if (this._pingHistory.length > MaxPingSamples) {
          this._pingHistory.shift()
        }

        // queueLength is at bytes[9] but Server._receivePing doesn't use it
        // (simplified from C# which passes bytes[9] to Server.OnConnectionPing)
        this._server._receivePing(this, [...this._pingHistory])
      }
    } else {
      // Non-ping data: forward to server for order interpretation
      this._server._onConnectionPacket(this, this._frame, bytes)
    }

    // Reset for next packet
    this._expectLength = 8
    this._state = 'Header'
  }

  // ---------------------------------------------------------------------------
  // _handleClose — WebSocket close event
  // ---------------------------------------------------------------------------

  /**
   * Handle transport close event. Notifies the server and cleans up.
   *
   * OpenRA 对照: SendReceiveLoop socket close / exception handler
   */
  private _handleClose(): void {
    if (this._disposed) return

    // Stop the ping timer
    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }

    this._server._onConnectionDisconnect(this)
  }

  // ---------------------------------------------------------------------------
  // _handleError — WebSocket error event
  // ---------------------------------------------------------------------------

  /**
   * Handle transport error event. Logs the error and triggers close handling.
   *
   * OpenRA 对照: SendReceiveLoop SocketException catch block
   */
  private _handleError(err: Error): void {
    console.error(
      `Connection error from ${this.endPoint}:`,
      err.message ?? String(err),
    )
    this._handleClose()
  }
}
