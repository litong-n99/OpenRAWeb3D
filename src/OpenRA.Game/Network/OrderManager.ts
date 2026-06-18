/**
 * OrderManager.ts — Lockstep frame coordinator: collect, broadcast, execute, verify
 * OpenRA 对照: OpenRA.Game/Network/OrderManager.cs (334 lines)
 *
 * 核心范式转换:
 * - C# ConcurrentDictionary<int, Queue<...>> → Map<number, Array<...>> (single-threaded)
 * - C# List<ClientOrder> struct → JS object with Client + Order
 * - C# float tickScale → number (same IEEE 754 semantics, NO game logic usage)
 * - C# BlockingCollection receive thread → pull model via Connection.Receive()
 * - C# SuggestedTimestep / Ui.Timestep → World.timestep-based calculation
 * - C# IsNetFrame (LocalFrameNumber % NetFrameInterval) → identical modulo logic
 * - C# OutOfSync / SyncReport →  placeholder (Phase B dependency)
 * - C# IDisposable → dispose() with explicit cleanup
 * - Configurable inputDelay (default 4, absorbs WebSocket latency)
 */

import type { Order, OrderPacket } from './Order'
import type { IConnection } from './Connection'
import {
  processOrder,
  clear as clearUnitOrders,
} from './UnitOrders'
import type {
  ClientStub,
  LobbyInfoStub,
  GlobalSettingsStub,
  WorldStub,
} from './UnitOrders'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sentinel value for client disconnection marker in pendingOrders queue.
 * OpenRA uses a null OrderPacket for this purpose.
 */
const CLIENT_DISCONNECTED = Symbol('ClientDisconnected')

/**
 * Default input delay in frames. Higher = more input lag but more resilience
 * to network jitter. OpenRA default is 3; increased to 4 for WebSocket.
 */
const DEFAULT_INPUT_DELAY = 4

// ---------------------------------------------------------------------------
// ClientOrder (对应 OrderManager.ClientOrder struct)
// ---------------------------------------------------------------------------

/**
 * A processed order with its originating client.
 *
 * OpenRA 对照: OrderManager.ClientOrder struct
 */
export interface ClientOrder {
  client: number
  order: Order
}

// ---------------------------------------------------------------------------
// TickTime (对应 TickTime struct in OpenRA)
// ---------------------------------------------------------------------------

/**
 * Tracks the last tick time for frame pacing.
 *
 * OpenRA 对照: TickTime struct
 */
export class TickTime {
  /** The timestamp of the last frame, in milliseconds. */
  value: number

  /** Function that returns the current time in milliseconds. */
  private readonly _timeFn: () => number

  constructor(timeFn: () => number, initialTime: number) {
    this._timeFn = timeFn
    this.value = initialTime
  }

  /** Update value to current time. */
  update(): void {
    this.value = this._timeFn()
  }
}

// ---------------------------------------------------------------------------
// OrderManager
// ---------------------------------------------------------------------------

/**
 * Manages the deterministic lockstep protocol: collects local orders,
 * broadcasts them, executes all clients' orders for the current frame,
 * and verifies sync hashes.
 *
 * OpenRA 对照: OrderManager class
 *
 * Lifecycle:
 *   const om = new OrderManager(connection)
 *   om.startGame()
 *   // In game loop:
 *   om.tickImmediate()  // send immediate orders, receive network data
 *   om.tryTick()        // attempt to advance one game frame
 *
 * The 4-phase Tick protocol:
 *   1. Collect: dump localOrders + localImmediateOrders → processClientOrders
 *   2. Broadcast: connection.send(netFrameNumber, localOrders)
 *   3. Execute: check all active clients have orders, inject into world.tick()
 *   4. Verify: compare sync hashes, increment frame number only after match
 */
export class OrderManager {
  // -----------------------------------------------------------------------
  // Public properties (readonly where possible)
  // -----------------------------------------------------------------------

  /** The network connection (WebSocket or loopback).
   *
   * OpenRA 对照: OrderManager.Connection
   */
  readonly connection: IConnection

  /** The game world (null before StartGame).
   *
   * OpenRA 对照: OrderManager.World
   */
  world: WorldStub | null = null

  /** Session / lobby information.
   *
   * OpenRA 对照: OrderManager.LobbyInfo
   */
  lobbyInfo: LobbyInfoStub

  /** Server error message (if any), shown to the player.
   *
   * OpenRA 对照: OrderManager.ServerError
   */
  serverError: string | null = null

  /** Whether the last error was an authentication failure.
   *
   * OpenRA 对照: OrderManager.AuthenticationFailed
   */
  authenticationFailed: boolean = false

  /** Server-defined map pool restriction.
   *
   * OpenRA 对照: OrderManager.ServerMapPool
   */
  serverMapPool: ReadonlySet<string> | null = null

  /** Timing tracker for the last frame.
   *
   * OpenRA 对照: OrderManager.LastTickTime
   */
  lastTickTime: TickTime

  /** Whether this OrderManager has been disposed.
   *
   * OpenRA 对照: disposed field
   */
  private _disposed = false

  /** Whether a sync desync has been detected.
   *
   * OpenRA 对照: OrderManager.IsOutOfSync
   */
  isOutOfSync: boolean = false

  /** Frame number of last saved game state (-1 = no save pending).
   *
   * OpenRA 对照: GameSaveLastFrame
   */
  gameSaveLastFrame: number = -1

  /** Frame number of last sync-saved game state.
   *
   * OpenRA 对照: GameSaveLastSyncFrame
   */
  gameSaveLastSyncFrame: number = -1

  // -----------------------------------------------------------------------
  // Frame counters
  // -----------------------------------------------------------------------

  /** The current network frame number.
   *
   * OpenRA 对照: OrderManager.NetFrameNumber
   */
  private _netFrameNumber: number = 0

  /** The local frame number (increments each local tick).
   *
   * OpenRA 对照: OrderManager.LocalFrameNumber
   */
  localFrameNumber: number = 0

  /** Whether the game has started (netFrameNumber !== 0).
   *
   * OpenRA 对照: OrderManager.GameStarted
   */
  get gameStarted(): boolean {
    return this._netFrameNumber !== 0
  }

  get netFrameNumber(): number {
    return this._netFrameNumber
  }

  // -----------------------------------------------------------------------
  // Internal data structures
  // -----------------------------------------------------------------------

  /**
   * Per-client queues of pending orders, keyed by client index.
   *
   * OpenRA 对照: pendingOrders: Dictionary<int, Queue<(int, OrderPacket)>>
   */
  private readonly _pendingOrders = new Map<
    number,
    Array<{
      frame: number
      orders: OrderPacket | typeof CLIENT_DISCONNECTED
    }>
  >()

  /**
   * Sync hash data per frame, keyed by frame number.
   *
   * OpenRA 对照: syncForFrame: Dictionary<int, (int, ulong)>
   */
  private readonly _syncForFrame = new Map<
    number,
    { syncHash: number; defeatState: bigint }
  >()

  /**
   * Local orders accumulated for the next frame broadcast.
   *
   * OpenRA 对照: localOrders: List<Order>
   */
  private readonly _localOrders: Order[] = []

  /**
   * Immediate orders (sent without frame queuing).
   *
   * OpenRA 对照: localImmediateOrders: List<Order>
   */
  private readonly _localImmediateOrders: Order[] = []

  /**
   * Orders being processed this frame (reset each Tick).
   *
   * OpenRA 对照: processClientOrders: List<ClientOrder>
   */
  private readonly _processClientOrders: ClientOrder[] = []

  /**
   * Clients to remove from pending after processing their disconnect.
   *
   * OpenRA 对照: processClientsToRemove: List<int>
   */
  private readonly _processClientsToRemove: number[] = []

  /**
   * The frame number of the last sent orders batch.
   *
   * OpenRA 对照: sentOrdersFrame
   */
  private _sentOrdersFrame: number = 0

  /**
   * Tick scale factor from the server (for latency compensation).
   *
   * OpenRA 对照: tickScale: float
   */
  private _tickScale: number = 1

  /**
   * Whether to generate sync reports (expensive, only when other players present).
   *
   * OpenRA 对照: generateSyncReport
   * NOTE: Used in Phase B when SyncReport is migrated.
   */
  get syncReportEnabled(): boolean {
    return this.__generateSyncReport
  }

  private __generateSyncReport: boolean = false

  /**
   * Input delay buffer in frames.
   */
  readonly inputDelay: number

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Create a new OrderManager.
   *
   * OpenRA 对照: OrderManager(IConnection)
   *
   * @param connection — the network connection to use
   * @param timeFn — function returning current time in ms (default: performance.now)
   * @param initialTime — initial time value (default: timeFn())
   * @param inputDelay — input delay buffer in frames (default: 4)
   */
  constructor(
    connection: IConnection,
    timeFn: () => number = () => performance.now(),
    initialTime?: number,
    inputDelay: number = DEFAULT_INPUT_DELAY,
  ) {
    this.connection = connection
    this.inputDelay = inputDelay
    this.lastTickTime = new TickTime(timeFn, initialTime ?? timeFn())
    this.lobbyInfo = createDefaultLobbyInfo()
  }

  // -----------------------------------------------------------------------
  // Local client accessor
  // -----------------------------------------------------------------------

  /**
   * The local client from the lobby info.
   *
   * OpenRA 对照: OrderManager.LocalClient
   */
  get localClient(): ClientStub | null {
    return this.lobbyInfo.clientWithIndex(this.connection.localClientId) ?? null
  }

  /**
   * The number of frame queues pending for the slowest client.
   *
   * OpenRA 对照: OrderManager.OrderQueueLength
   */
  get orderQueueLength(): number {
    if (this._pendingOrders.size === 0) return 0
    let min = Infinity
    for (const queue of this._pendingOrders.values()) {
      if (queue.length < min) min = queue.length
    }
    return min === Infinity ? 0 : min
  }

  // -----------------------------------------------------------------------
  // Game lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialize the lockstep state and start the game.
   *
   * OpenRA 对照: OrderManager.StartGame()
   */
  startGame(): void {
    if (this.gameStarted) return

    // Create per-client order queues for non-bot clients
    for (const client of this.lobbyInfo.clients) {
      if (!client.isBot) {
        this._pendingOrders.set(client.index, [])
      }
    }

    // Generate sync reports only if there are other players to compare against
    // NOTE: Phase B will use this when SyncReport is migrated
    this.__generateSyncReport =
      this.lobbyInfo.globalSettings.enableSyncReports

    this._netFrameNumber = 1
    this.localFrameNumber = 0
    this.lastTickTime.update()

    this.connection.startGame()
  }

  // -----------------------------------------------------------------------
  // Issue orders (local input)
  // -----------------------------------------------------------------------

  /**
   * Issue multiple orders at once.
   *
   * OpenRA 对照: OrderManager.IssueOrders(Order[])
   */
  issueOrders(orders: readonly Order[]): void {
    for (const order of orders) {
      this.issueOrder(order)
    }
  }

  /**
   * Issue a single order from local input.
   *
   * OpenRA 对照: OrderManager.IssueOrder(Order)
   *
   * Immediate orders are sent immediately via connection.sendImmediate().
   * Regular orders are accumulated in _localOrders for the next frame broadcast.
   */
  issueOrder(order: Order): void {
    if (order.isImmediate) {
      this._localImmediateOrders.push(order)
    } else {
      this._localOrders.push(order)
    }
  }

  // -----------------------------------------------------------------------
  // Receive orders (from network / replay / echo)
  // -----------------------------------------------------------------------

  /**
   * Receive a disconnect notification for a client.
   *
   * OpenRA 对照: OrderManager.ReceiveDisconnect(int, int)
   */
  receiveDisconnect(clientId: number, frame: number): void {
    if (this.gameStarted) {
      this.receiveOrders(clientId, {
        frame,
        orders: CLIENT_DISCONNECTED as unknown as OrderPacket,
      })
    }

    // Update client state immediately for UI
    const client = this.lobbyInfo.clientWithIndex(clientId)
    if (client) {
      ;(client as { state: number }).state = 1000 // Disconnected
    }
  }

  /**
   * Receive sync hash data for a frame.
   *
   * OpenRA 对照: OrderManager.ReceiveSync((int, int, ulong))
   */
  receiveSync(frame: number, syncHash: number, defeatState: bigint): void {
    const existing = this._syncForFrame.get(frame)
    if (existing) {
      if (
        existing.syncHash !== syncHash ||
        existing.defeatState !== defeatState
      ) {
        this.outOfSync(frame)
      }
    } else {
      this._syncForFrame.set(frame, { syncHash, defeatState })
    }
  }

  /**
   * Receive a tick scale adjustment from the server.
   *
   * OpenRA 对照: OrderManager.ReceiveTickScale(float)
   */
  receiveTickScale(scale: number): void {
    this._tickScale = scale
  }

  /**
   * Process immediate orders (no frame queuing).
   *
   * OpenRA 对照: OrderManager.ReceiveImmediateOrders(int, OrderPacket)
   */
  receiveImmediateOrders(clientId: number, packet: OrderPacket): void {
    for (const order of packet.getOrders(this.world)) {
      processOrder(this, this.world, clientId, order)

      // A mod switch or other event has disposed us
      if (this._disposed) return
    }
  }

  /**
   * Enqueue orders for a specific frame and client.
   *
   * OpenRA 对照: OrderManager.ReceiveOrders(int, (int, OrderPacket))
   */
  receiveOrders(
    clientId: number,
    data: { frame: number; orders: OrderPacket },
  ): void {
    const queue = this._pendingOrders.get(clientId)
    if (!queue) {
      throw new Error(
        `Received packet from disconnected client '${clientId}'`,
      )
    }
    queue.push({ frame: data.frame, orders: data.orders })
  }

  // -----------------------------------------------------------------------
  // Tick — lockstep frame driver (4 phases)
  // -----------------------------------------------------------------------

  /**
   * Send immediate orders and drain the network receive queue.
   *
   * OpenRA 对照: OrderManager.TickImmediate()
   *
   * Called once per render frame (or as often as possible) to keep the
   * network pipeline flowing. This is separate from tryTick() which
   * advances the game simulation at a fixed rate.
   */
  tickImmediate(): void {
    this.sendImmediateOrders()
    this.receiveAllOrdersAndCheckSync()
  }

  /**
   * Attempt to advance one game frame.
   *
   * OpenRA 对照: OrderManager.TryTick()
   *
   * Returns true if a frame was processed. The caller should use this to
   * drive the game loop at the suggested timestep.
   *
   * @returns true if the simulation advanced by one tick
   */
  tryTick(): boolean {
    let shouldTick = true

    if (this.isNetFrame()) {
      // Check whether we will be ready for a tick next frame.
      // We don't need to include ourselves because we can always generate orders.
      for (const [clientId, queue] of this._pendingOrders) {
        if (clientId !== this.connection.localClientId && queue.length === 0) {
          shouldTick = false
          break
        }
      }

      // Send orders only if currently ready (prevents sending too soon if stalling)
      if (shouldTick) {
        this.sendOrders()
      }
    }

    let willTick = shouldTick
    if (willTick && this.isNetFrame()) {
      // Double-check: all clients must have orders for the next frame
      if (!this.isReadyForNextFrame) {
        willTick = false
      }

      if (willTick) {
        this.processOrders()
      }
    }

    if (willTick) {
      this.localFrameNumber++
    }

    return willTick
  }

  // -----------------------------------------------------------------------
  // Internal — Phase 1: Collect (local order accumulation)
  // -----------------------------------------------------------------------

  /**
   * Send accumulated immediate orders.
   *
   * OpenRA 对照: SendImmediateOrders()
   */
  private sendImmediateOrders(): void {
    if (
      this._localImmediateOrders.length > 0 &&
      this.gameSaveLastFrame < this._netFrameNumber
    ) {
      this.connection.sendImmediate(this._localImmediateOrders)
    }
    this._localImmediateOrders.length = 0
  }

  // -----------------------------------------------------------------------
  // Internal — Phase 2: Broadcast (send local orders)
  // -----------------------------------------------------------------------

  /**
   * Send accumulated local orders to the network.
   *
   * OpenRA 对照: SendOrders()
   */
  private sendOrders(): void {
    if (
      this.gameStarted &&
      this.gameSaveLastFrame < this._netFrameNumber &&
      this._sentOrdersFrame < this._netFrameNumber
    ) {
      this.connection.send(this._netFrameNumber, this._localOrders)
      this._localOrders.length = 0
      this._sentOrdersFrame = this._netFrameNumber
    }
  }

  // -----------------------------------------------------------------------
  // Internal — Phase 3 & 4: Execute + Verify
  // -----------------------------------------------------------------------

  /**
   * Drain the network receive queue and check sync.
   *
   * OpenRA 对照: ReceiveAllOrdersAndCheckSync()
   */
  private receiveAllOrdersAndCheckSync(): void {
    this.connection.receive(this)
  }

  /**
   * Check if all active clients have submitted orders for the next frame.
   *
   * OpenRA 对照: IsReadyForNextFrame
   */
  private get isReadyForNextFrame(): boolean {
    if (!this.gameStarted) return false

    for (const queue of this._pendingOrders.values()) {
      if (queue.length === 0) return false
    }
    return true
  }

  /**
   * Check if this is a net frame (batch multiple local frames into one network frame).
   *
   * OpenRA 对照: IsNetFrame
   */
  private isNetFrame(): boolean {
    return (
      this.localFrameNumber %
        this.lobbyInfo.globalSettings.netFrameInterval ===
      0
    )
  }

  /**
   * Process all pending orders for the current frame, execute the world simulation,
   * and verify sync hashes.
   *
   * OpenRA 对照: ProcessOrders()
   *
   * This is the core of the lockstep protocol.
   */
  private processOrders(): void {
    for (const [clientId, queue] of this._pendingOrders) {
      // All clients must have a packet for this frame (guaranteed by isReadyForNextFrame)
      const entry = queue.shift()!
      const { frame: frameNumber, orders } = entry

      // Sanity check: frame number must match
      if (frameNumber !== this._netFrameNumber) {
        throw new Error(
          `Attempted to process orders from client ${clientId} for frame ${frameNumber} on frame ${this._netFrameNumber}`,
        )
      }

      // Handle client disconnect marker
      if ((orders as unknown) === CLIENT_DISCONNECTED) {
        this._processClientsToRemove.push(clientId)
        // Call world.onClientDisconnected(clientId) when World supports it
        continue
      }

      const orderPacket = orders as OrderPacket
      // Process each order in the packet
      for (const order of orderPacket.getOrders(this.world)) {
        processOrder(this, this.world, clientId, order)
        this._processClientOrders.push({
          client: clientId,
          order,
        })
      }
    }

    // Remove disconnected clients from pending
    for (const clientId of this._processClientsToRemove) {
      this._pendingOrders.delete(clientId)
    }
    this._processClientsToRemove.length = 0

    // Send sync hash
    if (this._netFrameNumber >= this.gameSaveLastSyncFrame && this.world) {
      let defeatState = 0n
      for (let i = 0; i < this.world.players.length; i++) {
        // Check if player has lost
        const player = this.world.players[i]
        if (player.winState === 2 /* WinState.Lost */) {
          defeatState |= 1n << BigInt(i)
        }
      }

      // Replace 0 with actual Sync.hash(world) when Sync module is migrated (Phase B)
      const syncHash = 0
      this.connection.sendSync(this._netFrameNumber, syncHash, defeatState)
    } else {
      this.connection.sendSync(this._netFrameNumber, 0, 0n)
    }

    // NOTE: SyncReport is expensive; deferred to Phase B
    // syncReport.updateSyncReport(processClientOrders)

    // Clear processed orders for next frame
    this._processClientOrders.length = 0

    // Advance frame number
    this._netFrameNumber++
  }

  // -----------------------------------------------------------------------
  // Out of sync detection
  // -----------------------------------------------------------------------

  /**
   * Handle a detected desync.
   *
   * OpenRA 对照: OutOfSync(int frame)
   *
   * Generates a desync report and marks the world as out of sync.
   * The game cannot reliably continue in this condition.
   */
  private outOfSync(frame: number): void {
    if (this.isOutOfSync) return

    // syncReport.dumpSyncReport(frame) — Phase B dependency
    if (this.world) {
      // world.outOfSync() — invoke World's out-of-sync handler
    }
    this.isOutOfSync = true

    console.error(
      `Out of sync detected at frame ${frame}! ` +
        `The game state has diverged and cannot continue reliably.`,
    )
  }

  // -----------------------------------------------------------------------
  // Suggested timestep
  // -----------------------------------------------------------------------

  /**
   * The suggested timestep for the game loop in milliseconds.
   *
   * OpenRA 对照: OrderManager.SuggestedTimestep
   *
   * Considers: replay speed, tick scale, game save loading, and world timestep.
   */
  get suggestedTimestep(): number {
    if (!this.world) return 40 // Default: 25 TPS (stub for Ui.Timestep)

    if (this.world.isLoadingGameSave) return 1 // Fast-forward during save loading
    if (this.world.isReplay) return this.world.replayTimestep // Replay speed
    if (this._tickScale !== 1) {
      return Math.max(Math.floor(this._tickScale * this.world.timestep), 1)
    }

    return this.world.timestep // World.Timestep equivalent
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  /**
   * Release all resources.
   *
   * OpenRA 对照: OrderManager.Dispose()
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    this.connection.dispose()
    this._pendingOrders.clear()
    this._syncForFrame.clear()
    this._localOrders.length = 0
    this._localImmediateOrders.length = 0
    this._processClientOrders.length = 0
    this._processClientsToRemove.length = 0
    clearUnitOrders()
  }
}

// ---------------------------------------------------------------------------
// Default lobby info factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal default lobby info.
 *
 * This is used before the server sends the full SyncInfo.
 */
function createDefaultLobbyInfo(): LobbyInfoStub {
  const clients: ClientStub[] = []
  const slots = new Map<string, import('./UnitOrders').SlotStub>()
  const globalSettings: GlobalSettingsStub = {
    map: '',
    randomSeed: 0,
    netFrameInterval: 3,
    gameTimestep: 0,
    enableSyncReports: false,
    dedicated: false,
    optionOrDefault(
      _key: string,
      defaultValue: string | boolean,
    ): string | boolean {
      return defaultValue
    },
  } as GlobalSettingsStub

  return {
    clients,
    globalSettings,
    slots,
    disabledSpawnPoints: [],
    clientWithIndex(id: number): ClientStub | undefined {
      return clients.find((c) => c.index === id)
    },
    nonBotClients(): readonly ClientStub[] {
      return clients.filter((c) => !c.bot)
    },
  }
}
