/**
 * Connection.ts — Network transport layer (WebSocket and loopback)
 * OpenRA 对照: OpenRA.Game/Network/Connection.cs (387 lines)
 *
 * 核心范式转换:
 * - C# TcpClient + multi-threaded receive → browser WebSocket + event-driven onmessage
 * - C# BlockingCollection/ConcurrentQueue → JS Array with explicit push/shift (single-threaded)
 * - C# Thread for connection → WebSocket async lifecycle (onopen/onmessage/onclose/onerror)
 * - C# EchoConnection memory queue → in-memory Array loopback
 * - C# NetworkConnectionSend → direct ws.send() with binary ArrayBuffer
 * - Auto-reconnect with exponential backoff (browser resilience)
 */

import { Order, OrderPacket } from './Order'
import {
  tryParseDisconnect,
  tryParseSync,
  tryParseAck,
  tryParseTickScale,
  tryParseOrderPacket,
  serializeSync,
  NO_ORDERS,
} from './Order'
import type { OrderManagerStub } from './UnitOrders'

// ---------------------------------------------------------------------------
// ConnectionState enum
// ---------------------------------------------------------------------------

/**
 * The current connection state.
 *
 * OpenRA 对照: ConnectionState enum
 */
export const ConnectionState = {
  /** Before any connection attempt has been made. */
  PreConnecting: 0,
  /** Disconnected and not currently trying to connect. */
  NotConnected: 1,
  /** Attempting to establish a connection. */
  Connecting: 2,
  /** Successfully connected and receiving data. */
  Connected: 3,
} as const

export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState]

// ---------------------------------------------------------------------------
// IConnection interface
// ---------------------------------------------------------------------------

/**
 * Network connection abstraction.
 *
 * OpenRA 对照: IConnection interface
 *
 * Implementations: NetworkConnection (WebSocket), EchoConnection (loopback).
 * Future: ReplayConnection (replay file reader).
 */
export interface IConnection {
  /** The local client's ID assigned by the server.
   *
   * OpenRA 对照: int IConnection.LocalClientId
   */
  readonly localClientId: number

  /** Signal that the game is starting (used by EchoConnection to inject frame 0).
   *
   * OpenRA 对照: void IConnection.StartGame()
   */
  startGame(): void

  /** Send orders for a specific frame.
   *
   * OpenRA 对照: void IConnection.Send(int, IEnumerable<Order>)
   */
  send(frame: number, orders: readonly Order[]): void

  /** Send immediate orders (no frame queuing).
   *
   * OpenRA 对照: void IConnection.SendImmediate(IEnumerable<Order>)
   */
  sendImmediate(orders: readonly Order[]): void

  /** Send a sync hash packet.
   *
   * OpenRA 对照: void IConnection.SendSync(int, int, ulong)
   */
  sendSync(frame: number, syncHash: number, defeatState: bigint): void

  /** Receive and process all queued packets.
   *
   * OpenRA 对照: void IConnection.Receive(OrderManager)
   */
  receive(orderManager: OrderManagerStub): void

  /** Release all resources.
   *
   * OpenRA 对照: void IDisposable.Dispose()
   */
  dispose(): void
}

// ---------------------------------------------------------------------------
// Received packet type
// ---------------------------------------------------------------------------

/** A packet received from the network.
 *
 * OpenRA 对照: (int FromClient, byte[] Data) tuple
 */
interface ReceivedPacket {
  fromClient: number
  data: Uint8Array
}

// ---------------------------------------------------------------------------
// EchoConnection — local loopback for single-player / offline mode
// ---------------------------------------------------------------------------

/**
 * In-memory loopback connection for local/offline games.
 *
 * OpenRA 对照: EchoConnection
 *
 * All orders are queued in local arrays and dequeued during receive().
 * Zero network latency. Uses client ID 1.
 */
export class EchoConnection implements IConnection {
  private static readonly LOCAL_CLIENT_ID = 1

  private readonly _sync: Array<{
    frame: number
    syncHash: number
    defeatState: bigint
  }> = []

  private readonly _orders: Array<{
    frame: number
    packet: OrderPacket
  }> = []

  private readonly _immediateOrders: OrderPacket[] = []

  private _disposed = false

  get localClientId(): number {
    return EchoConnection.LOCAL_CLIENT_ID
  }

  /**
   * Inject an empty frame 0 to fill the forward-projection gap.
   *
   * OpenRA 对照: EchoConnection.StartGame()
   */
  startGame(): void {
    this._orders.push({ frame: 0, packet: NO_ORDERS })
  }

  /**
   * Enqueue orders for a specific frame.
   *
   * OpenRA 对照: EchoConnection.Send(int, IEnumerable<Order>)
   */
  send(frame: number, orders: readonly Order[]): void {
    this._orders.push({ frame, packet: new OrderPacket(orders) })
  }

  /**
   * Enqueue immediate orders.
   *
   * OpenRA 对照: EchoConnection.SendImmediate(IEnumerable<Order>)
   */
  sendImmediate(orders: readonly Order[]): void {
    this._immediateOrders.push(new OrderPacket(orders))
  }

  /**
   * Enqueue a sync packet.
   *
   * OpenRA 对照: EchoConnection.SendSync(int, int, ulong)
   */
  sendSync(frame: number, syncHash: number, defeatState: bigint): void {
    this._sync.push({ frame, syncHash, defeatState })
  }

  /**
   * Dequeue and process all queued packets.
   *
   * OpenRA 对照: EchoConnection.Receive(OrderManager)
   *
   * Immediate orders are processed first, then regular orders (projected
   * forward by one frame), then sync packets.
   */
  receive(orderManager: OrderManagerStub): void {
    // Process immediate orders
    while (this._immediateOrders.length > 0) {
      const packet = this._immediateOrders.shift()!
      orderManager.receiveImmediateOrders(
        EchoConnection.LOCAL_CLIENT_ID,
        packet,
      )

      // An immediate order may trigger a chain of actions that disposes
      // the OrderManager and connection. Bail out.
      if (this._disposed) return
    }

    // Project orders forward to the next frame
    while (this._orders.length > 0) {
      const o = this._orders.shift()!
      orderManager.receiveOrders(EchoConnection.LOCAL_CLIENT_ID, {
        frame: o.frame + 1,
        orders: o.packet,
      })
    }

    // Process sync packets
    while (this._sync.length > 0) {
      const s = this._sync.shift()!
      orderManager.receiveSync(s.frame, s.syncHash, s.defeatState)
    }
  }

  dispose(): void {
    this._disposed = true
    this._sync.length = 0
    this._orders.length = 0
    this._immediateOrders.length = 0
  }
}

// ---------------------------------------------------------------------------
// NetworkConnection — WebSocket-based remote connection
// ---------------------------------------------------------------------------

/**
 * Network connection using browser WebSocket.
 *
 * OpenRA 对照: NetworkConnection
 *
 * Key differences from C#:
 * - WebSocket instead of TcpClient (browser API)
 * - Event-driven instead of multi-threaded (onmessage instead of receive thread)
 * - Auto-reconnect with exponential backoff
 * - No concurrent connection race — single WebSocket
 */
export class NetworkConnection implements IConnection {
  /** The WebSocket URL to connect to. */
  readonly url: string

  /** The current connection state. */
  private _state: ConnectionState = ConnectionState.PreConnecting

  /** The local client ID assigned by the server. */
  private _clientId = 0

  /** The underlying WebSocket instance. */
  private _ws: WebSocket | null = null

  /** Error message from the last connection failure. */
  private _errorMessage: string | null = null

  /** Queue of received packets from remote clients. */
  private readonly _receivedPackets: ReceivedPacket[] = []

  /** Queue of sent sync packets (for replay recording). */
  private readonly _sentSync: Array<{
    frame: number
    syncHash: number
    defeatState: bigint
  }> = []

  /** Queue of sync packets to be sent with next orders batch. */
  private readonly _queuedSyncPackets: Array<{
    frame: number
    syncHash: number
    defeatState: bigint
  }> = []

  /** Queue of sent orders (for replay recording and ack processing). */
  private readonly _sentOrders: Array<{ frame: number; packet: OrderPacket }> =
    []

  /** Queue of sent immediate orders (for replay recording). */
  private readonly _sentImmediateOrders: OrderPacket[] = []

  /** Whether this connection has been disposed. */
  private _disposed = false

  /** Reconnect timer handle. */
  private _reconnectTimerId: ReturnType<typeof setTimeout> | null = null

  /** Current reconnect backoff in milliseconds. */
  private _reconnectBackoff = 1000

  /** Maximum reconnect backoff in milliseconds. */
  private static readonly MAX_RECONNECT_BACKOFF = 30000

  /** Callback for connection state changes. */
  onStateChange: ((state: ConnectionState) => void) | null = null

  /** Callback for error messages. */
  onError: ((message: string) => void) | null = null

  constructor(url: string) {
    this.url = url
    this.connect()
  }

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  get connectionState(): ConnectionState {
    return this._state
  }

  get localClientId(): number {
    return this._clientId
  }

  get errorMessage(): string | null {
    return this._errorMessage
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initiate WebSocket connection.
   *
   * OpenRA 对照: NetworkConnectionConnect() thread
   */
  private connect(): void {
    if (this._disposed) return

    this._state = ConnectionState.Connecting
    this.onStateChange?.(ConnectionState.Connecting)

    try {
      const ws = new WebSocket(this.url)
      ws.binaryType = 'arraybuffer'
      this._ws = ws

      ws.onopen = () => {
        this._state = ConnectionState.Connected
        this._reconnectBackoff = 1000 // Reset backoff on successful connection
        this._errorMessage = null
        this.onStateChange?.(ConnectionState.Connected)

        // Read handshake: server sends protocol version + client ID
        // NOTE: Simplified — WebSocket messages are full packets,
        // not a stream. The server must send the handshake as the first message.
      }

      ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const data = new Uint8Array(event.data)
        this.handleMessage(data)
      }

      ws.onclose = (event: CloseEvent) => {
        this._ws = null
        this._state = ConnectionState.NotConnected
        this._errorMessage =
          this._errorMessage ??
          `Connection closed: code=${event.code} reason=${event.reason}`
        this.onStateChange?.(ConnectionState.NotConnected)

        // Auto-reconnect with exponential backoff
        if (!this._disposed) {
          this.scheduleReconnect()
        }
      }

      ws.onerror = () => {
        this._errorMessage = 'WebSocket error'
        this.onError?.('WebSocket connection error')
        // onclose will fire after onerror
      }
    } catch (e) {
      this._errorMessage = `Failed to connect: ${String(e)}`
      this._state = ConnectionState.NotConnected
      this.onStateChange?.(ConnectionState.NotConnected)

      if (!this._disposed) {
        this.scheduleReconnect()
      }
    }
  }

  /**
   * Handle an incoming WebSocket message.
   *
   * OpenRA 对照: NetworkConnectionReceive() message processing
   */
  private handleMessage(data: Uint8Array): void {
    // First message from server is the handshake
    if (this._clientId === 0) {
      // Handshake: [4b protocol version BE] + [4b client ID BE]
      if (data.length >= 8) {
        const view = new DataView(data.buffer, data.byteOffset, 8)
        const clientId = view.getInt32(4, false)
        // NOTE: Protocol version (bytes 0-3) validation deferred
        this._clientId = clientId
      }
      return
    }

    // All subsequent messages are from-client packets
    // Format: [4b fromClient BE] + [remaining: payload]
    if (data.length >= 4) {
      const view = new DataView(data.buffer, data.byteOffset, 4)
      const fromClient = view.getInt32(0, false)
      const payload = data.subarray(4)
      this._receivedPackets.push({ fromClient, data: payload })
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this._disposed) return

    this._reconnectTimerId = setTimeout(() => {
      this._reconnectTimerId = null
      if (!this._disposed) {
        this.connect()
      }
    }, this._reconnectBackoff)

    // Exponential backoff: 1s -> 2s -> 4s -> 8s -> ... -> max 30s
    this._reconnectBackoff = Math.min(
      this._reconnectBackoff * 2,
      NetworkConnection.MAX_RECONNECT_BACKOFF,
    )
  }

  // -----------------------------------------------------------------------
  // IConnection implementation
  // -----------------------------------------------------------------------

  /**
   * Start the game (no-op for network connection).
   *
   * OpenRA 对照: NetworkConnection.StartGame()
   */
  startGame(): void {
    // Nothing to do for network connections
  }

  /**
   * Send orders for a specific frame.
   *
   * OpenRA 对照: NetworkConnection.Send(int, IEnumerable<Order>)
   */
  send(frame: number, orders: readonly Order[]): void {
    const packet = new OrderPacket(orders)
    this._sentOrders.push({ frame, packet })
    this.sendRaw(packet.serialize(frame))
  }

  /**
   * Send immediate orders.
   *
   * OpenRA 对照: NetworkConnection.SendImmediate(IEnumerable<Order>)
   */
  sendImmediate(orders: readonly Order[]): void {
    const packet = new OrderPacket(orders)
    this._sentImmediateOrders.push(packet)
    this.sendRaw(packet.serialize(0))
  }

  /**
   * Queue a sync packet to be sent with the next orders batch.
   *
   * OpenRA 对照: NetworkConnection.SendSync(int, int, ulong)
   *
   * Sync packets are batched with the next outgoing orders to reduce
   * TCP overhead (OpenRA original optimization preserved).
   */
  sendSync(frame: number, syncHash: number, defeatState: bigint): void {
    this._queuedSyncPackets.push({ frame, syncHash, defeatState })
  }

  /**
   * Send raw binary data through the WebSocket, including any queued sync packets.
   *
   * OpenRA 对照: NetworkConnection.Send(byte[])
   *
   * Each sub-packet is prefixed with a 4-byte big-endian Int32 length prefix
   * so the server can split concatenated packets on the stream.
   */
  private sendRaw(packet: Uint8Array): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return

    try {
      // Calculate total size: 4b length prefix per sub-packet + data
      let totalSize = 4 + packet.length // 4-byte length + main packet
      const syncDatas: Uint8Array[] = []
      for (const s of this._queuedSyncPackets) {
        const syncData = serializeSync(s.frame, s.syncHash, s.defeatState)
        syncDatas.push(syncData)
        totalSize += 4 + syncData.length // 4-byte length + sync packet
      }

      const combined = new Uint8Array(totalSize)
      const view = new DataView(combined.buffer)
      let offset = 0

      // Write main order packet with 4-byte length prefix (big-endian)
      view.setInt32(offset, packet.length, false) // false = big-endian (network byte order)
      offset += 4
      combined.set(packet, offset)
      offset += packet.length

      // Write each sync packet with 4-byte length prefix
      for (const syncData of syncDatas) {
        view.setInt32(offset, syncData.length, false) // false = big-endian
        offset += 4
        combined.set(syncData, offset)
        offset += syncData.length
      }

      // Record sync packets to local sent queue
      for (const s of this._queuedSyncPackets) {
        this._sentSync.push(s)
      }
      this._queuedSyncPackets.length = 0

      this._ws.send(combined.buffer)
    } catch (_e) {
      // Drop on the floor; disconnect will be detected by onclose
    }
  }

  /**
   * Receive and process all queued network packets.
   *
   * OpenRA 对照: NetworkConnection.Receive(OrderManager)
   */
  receive(orderManager: OrderManagerStub): void {
    // Process locally-generated immediate orders
    while (this._sentImmediateOrders.length > 0) {
      const packet = this._sentImmediateOrders.shift()!
      orderManager.receiveImmediateOrders(this._clientId, packet)

      if (this._disposed) return
    }

    // Process locally-generated sync packets
    while (this._sentSync.length > 0) {
      const s = this._sentSync.shift()!
      orderManager.receiveSync(s.frame, s.syncHash, s.defeatState)
    }

    // Process received packets from remote clients
    while (this._receivedPackets.length > 0) {
      const p = this._receivedPackets.shift()!

      // Try to parse as disconnect (only accepted from server, fromClient=0)
      const disconnect = tryParseDisconnect(p.data, p.fromClient)
      if (disconnect) {
        orderManager.receiveDisconnect(
          disconnect.clientId,
          disconnect.frame,
        )
        continue
      }

      // Try to parse as sync
      const sync = tryParseSync(p.data)
      if (sync) {
        orderManager.receiveSync(
          sync.frame,
          sync.syncHash,
          sync.defeatState,
        )
        continue
      }

      // Try to parse as tick scale (only accepted from server)
      const tickScale = tryParseTickScale(p.data, p.fromClient)
      if (tickScale !== null) {
        orderManager.receiveTickScale(tickScale)
        continue
      }

      // Try to parse as ack (only accepted from server, fromClient=0)
      const ack = tryParseAck(p.data, p.fromClient)
      if (ack) {
        if (ack.count > this._sentOrders.length) {
          throw new Error(
            `Received Ack for ${ack.count} > ${this._sentOrders.length} frames.`,
          )
        }

        // The Acknowledgement packet is a placeholder that tells us to process
        // the first packets in our local sent buffer at the given frame.
        let packet: OrderPacket
        if (ack.count !== 1) {
          const packets: OrderPacket[] = []
          for (let i = 0; i < ack.count; i++) {
            packets.push(this._sentOrders.shift()!.packet)
          }
          packet = OrderPacket.combine(packets)
        } else {
          packet = this._sentOrders.shift()!.packet
        }

        orderManager.receiveOrders(this._clientId, {
          frame: ack.frame,
          orders: packet,
        })
        continue
      }

      // Try to parse as order packet
      const orderPacket = tryParseOrderPacket(p.data)
      if (orderPacket) {
        if (orderPacket.frame === 0) {
          orderManager.receiveImmediateOrders(
            p.fromClient,
            orderPacket.packet,
          )
        } else {
          orderManager.receiveOrders(p.fromClient, {
          frame: orderPacket.frame,
          orders: orderPacket.packet,
        })
        }
        continue
      }

      // Unknown packet type — log for debugging but don't throw
      // (may be from newer protocol versions or extensions)
      console.debug(
        `[Connection] Unknown packet from client ${p.fromClient} ` +
        `(length=${p.data.length}, typeByte=${p.data.length >= 5 ? '0x' + p.data[4].toString(16) : 'none'})`,
      )

      if (this._disposed) return
    }
  }

  /**
   * Dispose the connection, closing the WebSocket and clearing all queues.
   *
   * OpenRA 对照: NetworkConnection.Dispose()
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    if (this._reconnectTimerId !== null) {
      clearTimeout(this._reconnectTimerId)
      this._reconnectTimerId = null
    }

    if (this._ws) {
      this._ws.onopen = null
      this._ws.onmessage = null
      this._ws.onclose = null
      this._ws.onerror = null
      this._ws.close()
      this._ws = null
    }

    this._receivedPackets.length = 0
    this._sentOrders.length = 0
    this._sentImmediateOrders.length = 0
    this._sentSync.length = 0
    this._queuedSyncPackets.length = 0
    this._state = ConnectionState.NotConnected
  }
}

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export { OrderPacket }
