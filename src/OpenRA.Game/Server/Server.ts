/**
 * Server.ts -- Complete game server orchestrator: manages WebSocket connections,
 * order dispatch, sync hash verification, lobby synchronization, game start/end,
 * replay recording, and server trait lifecycle.
 *
 * OpenRA 对照: OpenRA.Game/Server/Server.cs (1594 lines C#)
 *
 * 核心范式转换:
 * - C# TcpListener + raw Socket with thread-per-connection ->
 *   IServerTransport / IClientTransport abstraction (WebSocket or mock)
 * - C# BlockingCollection<IServerEvent> polling loop ->
 *   direct event handlers: transport.onConnection(), Message events
 * - C# Thread-based main loop ->
 *   setInterval() for server tick, event-driven for connection handling
 * - C# lock (LobbyInfo) { ... } ->
 *   JavaScript single-threaded -- no locking needed
 * - C# volatile ServerState internalState ->
 *   TypeScript `let state: ServerState` (no volatile in JS)
 * - C# MemoryStream + BinaryWriter for frame construction ->
 *   Uint8Array + DataView with little-endian writes
 * - C# MiniYaml serialization for lobby data ->
 *   JSON serialization (compatible evolution)
 * - C# GeoIP.Initialize(), Nat.TryForwardPort() ->
 *   NOP stubs in browser mode
 * - C# Console.WriteLine ->
 *   console.log with ISO timestamp prefix
 * - C# Stopwatch -> performance.now() / Date.now()
 */

// ---------------------------------------------------------------------------
// Imports from migrated modules
// ---------------------------------------------------------------------------

import {
  Session,
  SessionClient,
  ServerState,
  ServerType,
  ConnectionQuality,
  ClientState,
  WinState,
  MapStatus,
  type ServerSettings,
  type HandshakeRequestData,
  type HandshakeResponseData,
} from './SessionTypes.js'

import {
  OrderType,
} from './ProtocolVersion.js'
// NOTE: Handshake + Orders protocol version constants are imported as ProtocolVersion constants
import * as ProtocolVersion from './ProtocolVersion.js'

import {
  type IInterpretCommand,
  type INotifySyncLobbyInfo,
  type INotifyServerStart,
  type INotifyServerEmpty,
  type INotifyServerShutdown,
  type IStartGame,
  type IClientJoined,
  type IEndGame,
  type ITick,
  ServerTrait,
} from './TraitInterfaces.js'

import { Order, SYNC_HASH_ORDER_LENGTH } from '../Network/Order.js'
import type { ModData } from '../ModData.js'
import { GameInformation, GameInformationPlayer } from '../GameInformation.js'

// ---------------------------------------------------------------------------
// Forward references (created in Phases C/D)
// ---------------------------------------------------------------------------

/**
 * Forward reference for Connection (Phase C).
 * TODO-18.C: Replace with `import type { Connection } from './Connection.js'`
 */
export interface Connection {
  playerIndex: number
  authToken: string
  endPoint: string
  connectionTimer: number
  validated: boolean
  lastOrdersFrame: number
  timeoutMessageShown: boolean
  _lastReceivedTime: number
  get timeSinceLastResponse(): number
  dispose(): void
  trySendData(data: Uint8Array): boolean
}

/**
 * Forward reference for OrderBuffer (Phase C).
 * TODO-18.C: Replace with `import type { OrderBuffer } from './OrderBuffer.js'`
 */
export interface OrderBuffer {
  start(gameSpeed: GameSpeed, players: Iterable<number>): void
  addOrderTimestamp(playerIndex: number): void
  removePlayer(playerIndex: number): void
  getTickScales(): Array<{ playerIndex: number; tickScale: number }>
}

/**
 * Forward reference for VoteKickTracker (Phase D).
 * TODO-18.D: Replace with `import type { VoteKickTracker } from './VoteKickTracker.js'`
 */
export interface VoteKickTrackerStub {
  tick(): void
}

/**
 * Forward reference for MapStatusCache (Phase D).
 * TODO-18.D: Replace with `import type { MapStatusCache } from './MapStatusCache.js'`
 */
export interface MapStatusCacheStub {
  getStatus(map: MapPreviewStub): MapStatus
}

/**
 * Forward reference for PlayerMessageTracker (Phase D).
 * TODO-18.D: Replace with `import type { PlayerMessageTracker } from './PlayerMessageTracker.js'`
 */
export interface PlayerMessageTrackerStub {
  isPlayerAtFloodLimit(conn: Connection): boolean
  disableChatUI(conn: Connection, time: number): void
}

// ---------------------------------------------------------------------------
// Transport Interfaces
// ---------------------------------------------------------------------------

/**
 * Server-side transport abstraction. Implementations provide the actual
 * network I/O (Node.js WebSocket, Web Worker MessageChannel, or mock).
 *
 * ADR-18.6: IServerTransport decouples Server from specific network APIs.
 */
export interface IServerTransport {
  /** Start listening for connections. */
  listen(port: number): Promise<void>

  /** Register a handler for incoming client connections. */
  onConnection(handler: (transport: IClientTransport) => void): void

  /** Stop listening and close all connections. */
  close(): Promise<void>

  /** Get local endpoints for local game connection. */
  getLocalEndpoints(): string[]
}

/**
 * Client-side transport abstraction. One instance per connected client.
 */
export interface IClientTransport {
  /** Send binary data to the client. Returns true on success. */
  send(data: Uint8Array): boolean

  /** Register a handler for incoming messages. */
  onMessage(handler: (data: Uint8Array) => void): void

  /** Register a handler for connection close. */
  onClose(handler: () => void): void

  /** Register a handler for connection errors. */
  onError(handler: (err: Error) => void): void

  /** Close the connection. */
  close(): void

  /** Remote address string (IP:port). */
  remoteAddress: string
}

// ---------------------------------------------------------------------------
// ConnectionTarget
// ---------------------------------------------------------------------------

/**
 * Target for local game connection.
 *
 * OpenRA 对照: ConnectionTarget
 */
export interface ConnectionTarget {
  endpoints: Array<{ host: string; port: number }>
}

// ---------------------------------------------------------------------------
// GameSpeed
// ---------------------------------------------------------------------------

/**
 * Game speed configuration (timestep + order latency).
 *
 * OpenRA 对照: GameSpeed
 */
export interface GameSpeed {
  timestep: number
  orderLatency: number
  name: string
}

// ---------------------------------------------------------------------------
// MapPreview stub
// ---------------------------------------------------------------------------

/**
 * Minimal MapPreview type for server integration.
 * The real MapPreview is in MapCache.ts; the server only needs uid, status,
 * title, class, and player info access.
 */
export interface MapPreviewStub {
  uid: string
  title?: string
  status: number
  class?: string
  players?: {
    players: Map<string, { playable: boolean; allowBots: boolean }>
  }
  worldActorInfo?: {
    traitInfos<T>(): T[]
  }
  generationArgs?: unknown
  updateFromGenerationArgs?(args: unknown): void
}

// ---------------------------------------------------------------------------
// PlayerReference stub
// ---------------------------------------------------------------------------

/**
 * Minimal PlayerReference for SyncClientToPlayerReference.
 */
export interface PlayerReferenceStub {
  faction?: string
  spawn?: number
  team?: number
  handicap?: number
  color?: number
  lockFaction?: boolean
  lockSpawn?: boolean
  lockTeam?: boolean
  lockHandicap?: boolean
  lockColor?: boolean
}

// ---------------------------------------------------------------------------
// FluentMessage stub (simple serialization for server notifications)
// ---------------------------------------------------------------------------

/**
 * Simple FluentMessage serializer stub.
 * The full FluentMessage system is in Ch6's FluentProvider. This stub provides
 * the serialize(key, args) function needed by the server for order dispatch.
 */
const FluentMessage = {
  /**
   * Serialize a Fluent message key and arguments into a JSON string.
   *
   * OpenRA 对照: FluentMessage.Serialize(string, object[])
   */
  serialize(key: string, args?: unknown[]): string {
    if (!args || args.length === 0) {
      return key
    }

    // Build key-value pairs: [key, arg0, key1, arg1, ...]
    const pairs: unknown[] = []
    const strArgs = args as unknown[]
    for (let i = 0; i < strArgs.length; i += 2) {
      if (i + 1 < strArgs.length) {
        pairs.push(strArgs[i], strArgs[i + 1])
      }
    }
    return JSON.stringify([key, ...pairs])
  },

  /**
   * Get the localized message string for a key (for console output).
   *
   * OpenRA 对照: FluentProvider.GetMessage(string, object[])
   */
  getMessage(key: string, args?: unknown[]): string {
    if (!args || args.length === 0) return key
    // Best-effort: use the key as fallback
    return `[${key}] ${args.join(', ')}`
  },
}

// ---------------------------------------------------------------------------
// MersenneTwister — minimal inline implementation
// ---------------------------------------------------------------------------

/**
 * Minimal Mersenne Twister PRNG implementation for server random generation.
 *
 * OpenRA 对照: OpenRA.Support/MersenneTwister.cs
 *
 * NOTE: This is a simplified implementation sufficient for server-side use
 * (session IDs, auth token generation). For deterministic combat RNG, the
 * full implementation should be migrated as a separate Primitive module.
 */
class MersenneTwister {
  private mt: Uint32Array
  private index: number

  constructor(seed?: number) {
    this.mt = new Uint32Array(624)
    this.index = 0

    // Initialize from seed
    this.mt[0] = seed !== undefined ? seed : Math.floor(Math.random() * 0xFFFFFFFF)
    for (let i = 1; i < 624; i++) {
      this.mt[i] = (1812433253 * (this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0
    }
  }

  /** Generate next 32-bit random integer. */
  next(): number {
    if (this.index === 0) this._generate()

    let y = this.mt[this.index]
    y ^= (y >>> 11)
    y ^= (y << 7) & 0x9D2C5680
    y ^= (y << 15) & 0xEFC60000
    y ^= (y >>> 18)

    this.index = (this.index + 1) % 624
    return y >>> 0
  }

  private _generate(): void {
    for (let i = 0; i < 624; i++) {
      const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % 624] & 0x7FFFFFFF)
      this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1)
      if (y % 2 !== 0) this.mt[i] ^= 0x9908B0DF
    }
  }
}

// ---------------------------------------------------------------------------
// Server Class
// ---------------------------------------------------------------------------

/**
 * Central game server orchestrator. Manages all aspects of the multiplayer
 * game lifecycle: client connections, order dispatch, sync verification,
 * lobby state, game start/end, replay recording, and server trait hooks.
 *
 * OpenRA 对照: Server class (sealed)
 */
export class Server {
  // ---- Public Properties ----

  readonly random: MersenneTwister = new MersenneTwister()
  readonly type: ServerType

  /** All connected clients (validated and unvalidated). */
  conns: Connection[] = []

  /** Lobby session state. */
  lobbyInfo: Session

  /** Server configuration. */
  settings: ServerSettings

  /** Mod runtime data. */
  modData: ModData

  /** Temporary IP bans (lifted after server restart). */
  tempBans: string[] = []

  /** Generated map data string (for map generation). */
  generatedMapData: string = ''

  /** Currently selected map preview. */
  map: MapPreviewStub | null = null

  /** Map status cache. */
  mapStatusCache: MapStatusCacheStub

  /** Game save (if enabled). */
  gameSave: unknown | null = null // TODO-18.B: import GameSave from '../Network/GameSave.js' for proper typing

  /** Map pool restriction (frozen set of allowed map UIDs). */
  mapPool: ReadonlySet<string> | null = null

  /**
   * Order latency (frames to project orders into the future).
   * Defaults to 1 for Local/Skirmish (non-Multiplayer) servers.
   * Multiplayer servers override this from GameSpeed.orderLatency in startGame().
   *
   * OpenRA 对照: Server.OrderLatency
   */
  orderLatency: number = 1

  /** Vote kick tracker. */
  voteKickTracker: VoteKickTrackerStub

  // ---- Private Properties ----

  private readonly _randomSeed: number
  private _serverTraits: ServerTrait[] = []

  /** Per-frame sync hash storage: frame -> packet bytes (first received). */
  private readonly _syncForFrame: Map<number, Uint8Array> = new Map()

  private _lastDefeatStateFrame: number = 0
  private _lastDefeatState: bigint = 0n

  /** Game information for replay metadata. */
  private _gameInfo: GameInformation | null = null

  /** World players (null = non-combatant / non-playable). */
  private _worldPlayers: Array<GameInformationPlayer | null> = []

  /** Timestamp of last ping-based connection quality update. */
  private _pingUpdated: number = Date.now()

  /** Order buffer for dynamic order timing. */
  private _orderBuffer: OrderBuffer | null = null

  /** Server internal state. C# uses volatile; JS is single-threaded. */
  private _state: ServerState = ServerState.WaitingPlayers

  /** Replay recorder (if enabled). */
  private _recorder: {
    metadata: unknown | null
    receiveFrame(from: number, frame: number, data: Uint8Array): void
    dispose(): void
  } | null = null

  /** Player message tracker (chat flood control). */
  private readonly _playerMessageTracker: PlayerMessageTrackerStub

  /** Next available player index. */
  private _nextPlayerIndex: number = 0

  /** Main tick interval timer handle. */
  private _tickTimer: ReturnType<typeof setInterval> | null = null

  /** Transport for network I/O. */
  private readonly _transport: IServerTransport

  // ---------------------------------------------------------------------------
  // State accessor
  // ---------------------------------------------------------------------------

  get state(): ServerState {
    return this._state
  }

  set state(value: ServerState) {
    this._state = value
  }

  /**
   * Whether this is a multiplayer server (dedicated or peer-hosted).
   *
   * OpenRA 对照: Server.IsMultiplayer
   */
  get isMultiplayer(): boolean {
    return this.type === ServerType.Dedicated || this.type === ServerType.Multiplayer
  }

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA Server constructor)
  // ---------------------------------------------------------------------------

  /**
   * Create a new game server.
   *
   * OpenRA 对照: Server(List<IPEndPoint>, ServerSettings, ModData, ServerType)
   *
   * @param transport -- network transport implementation
   * @param settings -- server configuration
   * @param modData -- mod runtime
   * @param type -- server hosting type
   */
  constructor(
    transport: IServerTransport,
    settings: ServerSettings,
    modData: ModData,
    type: ServerType,
  ) {
    this._transport = transport
    this.type = type
    this.settings = settings
    this.modData = modData

    this._randomSeed = Math.floor(Date.now()) ^ Math.floor(Math.random() * 0xFFFFFFFF)

    // Initialize server traits from mod manifest
    this._initializeServerTraits()

    // Create MapStatusCache
    // TODO-18.D: Replace with real MapStatusCache when Phase D is complete
    this.mapStatusCache = {
      getStatus: (_map: MapPreviewStub): MapStatus => {
        return MapStatus.Playable
      },
    }

    // Create PlayerMessageTracker
    this._playerMessageTracker =
      this._createPlayerMessageTracker()

    // Create VoteKickTracker
    this.voteKickTracker = this._createVoteKickTracker()

    // Initialize lobby info
    this.lobbyInfo = new Session()
    this.lobbyInfo.globalSettings.randomSeed = this._randomSeed
    this.lobbyInfo.globalSettings.serverName = settings.name
    this.lobbyInfo.globalSettings.enableSingleplayer =
      settings.enableSingleplayer || type !== ServerType.Dedicated
    this.lobbyInfo.globalSettings.enableMapGeneration = settings.enableMapGeneration
    this.lobbyInfo.globalSettings.enableSyncReports = settings.enableSyncReports
    this.lobbyInfo.globalSettings.gameUid = this._generateGameUid()
    this.lobbyInfo.globalSettings.dedicated = type === ServerType.Dedicated

    // Create ReplayRecorder for dedicated servers with recording enabled
    if (settings.recordReplays && type === ServerType.Dedicated) {
      this._createReplayRecorder()
      this._recordFakeHandshake()
    }

    // Register connection handler
    transport.onConnection((clientTransport) => {
      this._handleConnection(clientTransport)
    })

    // Fire INotifyServerStart on all server traits
    for (const t of this._getTraits<INotifyServerStart>('serverStarted')) {
      t.serverStarted(this)
    }

    // Start main tick loop
    this._startTickLoop()
  }

  // ---------------------------------------------------------------------------
  // Server Trait Management
  // ---------------------------------------------------------------------------

  /**
   * Initialize server traits from the mod manifest.
   */
  private _initializeServerTraits(): void {
    const traitNames = this.modData.manifest.serverTraits
    this._serverTraits = []

    for (const name of traitNames) {
      const instance = this.modData.objectCreator.createObject<ServerTrait>(name)
      if (instance) {
        this._serverTraits.push(instance)
      }
    }
  }

  /**
   * Get all server traits that implement a specific interface.
   * Uses duck-typing: checks for the presence of a method name.
   */
  private _getTraits<T>(methodName: string): T[] {
    const result: T[] = []
    for (const trait of this._serverTraits) {
      if (methodName in trait) {
        result.push(trait as unknown as T)
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // PlayerMessageTracker factory (stub until Phase D)
  // ---------------------------------------------------------------------------

  /**
   * Create a PlayerMessageTracker stub.
   * TODO-18.D: Replace with real PlayerMessageTracker when Phase D is complete
   */
  private _createPlayerMessageTracker(): PlayerMessageTrackerStub {
    const messageTracker = new Map<number, number[]>()

    return {
      isPlayerAtFloodLimit: (conn: Connection): boolean => {
        const idx = conn.playerIndex
        let timestamps = messageTracker.get(idx)
        if (!timestamps) {
          timestamps = []
          messageTracker.set(idx, timestamps)
        }

        // Admin bypass
        const client = this._getClient(conn)
        if (client?.isAdmin) return false

        const now = Date.now()

        // Expire old entries
        const filtered = timestamps.filter(
          (t) => now - t < this.settings.floodLimitInterval,
        )
        messageTracker.set(idx, filtered)

        // Join cooldown check
        const connAge = now - conn.connectionTimer
        if (connAge < this.settings.floodLimitJoinCooldown) return true

        // Message count check
        if (filtered.length >= this.settings.floodLimitMessageCount) return true

        // Add current timestamp
        filtered.push(now)
        messageTracker.set(idx, filtered)
        return false
      },

      disableChatUI: (conn: Connection, time: number): void => {
        // Stub: dispatch DisableChatEntry order
        this._sendOrderTo(conn, 'DisableChatEntry', String(time))
      },
    }
  }

  // ---------------------------------------------------------------------------
  // VoteKickTracker factory (stub until Phase D)
  // ---------------------------------------------------------------------------

  /**
   * Create a VoteKickTracker stub.
   * TODO-18.D: Replace with real VoteKickTracker when Phase D is complete
   */
  private _createVoteKickTracker(): VoteKickTrackerStub {
    return {
      tick: (): void => {
        // Stub: no-op until Phase D
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Replay Recorder
  // ---------------------------------------------------------------------------

  /**
   * Create a ReplayRecorder for dedicated servers.
   */
  private _createReplayRecorder(): void {
    // Dynamic import-style: check if ReplayRecorder is available via ModData
    // TODO-18.B: Import ReplayRecorder statically from '../Network/ReplayRecorder.js'
    // For now, use a stub that captures frames to memory
    const frames: Array<{ from: number; frame: number; data: Uint8Array }> = []

    this._recorder = {
      metadata: null,
      receiveFrame(from: number, frame: number, data: Uint8Array): void {
        frames.push({ from, frame, data: data.slice() })
      },
      dispose(): void {
        frames.length = 0
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Static Utility: syncClientToPlayerReference
  // ---------------------------------------------------------------------------

  /**
   * Apply player-reference locked settings to a session client.
   *
   * OpenRA 对照: Server.SyncClientToPlayerReference(Session.Client, PlayerReference)
   */
  static syncClientToPlayerReference(
    c: SessionClient,
    pr: PlayerReferenceStub | null,
  ): void {
    if (!pr) return

    if (pr.lockFaction && pr.faction !== undefined) c.faction = pr.faction
    if (pr.lockSpawn && pr.spawn !== undefined) c.spawnPoint = pr.spawn
    if (pr.lockTeam && pr.team !== undefined) c.team = pr.team
    if (pr.lockHandicap && pr.handicap !== undefined) c.handicap = pr.handicap

    c.color = pr.lockColor && pr.color !== undefined ? pr.color : c.preferredColor
  }

  // ---------------------------------------------------------------------------
  // chooseFreePlayerIndex
  // ---------------------------------------------------------------------------

  /**
   * Choose the next available player index.
   *
   * OpenRA 对照: Server.ChooseFreePlayerIndex()
   */
  chooseFreePlayerIndex(): number {
    return this._nextPlayerIndex++
  }

  // ---------------------------------------------------------------------------
  // Binary Frame Construction (static helpers)
  // ---------------------------------------------------------------------------

  /**
   * Create a binary frame: [length: int32 LE][client: int32 LE][frame: int32 LE][data]
   *
   * OpenRA 对照: Server.CreateFrame(int, int, byte[])
   */
  static createFrame(client: number, frame: number, data: Uint8Array): Uint8Array {
    const totalLength = 12 + data.length
    const result = new Uint8Array(totalLength)
    const view = new DataView(result.buffer)
    // Frame layout (OpenRA C#: MemoryStream.Write sequence):
    //   [0..3]  int32 LE: length = data.length + 4  (bytes after this field: client+frame+data)
    //   [4..7]  int32 LE: client
    //   [8..11] int32 LE: frame
    //   [12..]  data payload bytes
    // Total: 4 + 4 + 4 + data.length = 12 + data.length
    view.setInt32(0, data.length + 4, true)
    view.setInt32(4, client, true)
    view.setInt32(8, frame, true)
    result.set(data, 12)
    return result
  }

  /**
   * Create an ack frame: [6: int32 LE][0: int32 LE][frame: int32 LE][0x10: byte][count: byte]
   *
   * OpenRA 对照: Server.CreateAckFrame(int, byte)
   */
  static createAckFrame(frame: number, count: number): Uint8Array {
    const result = new Uint8Array(14)
    const view = new DataView(result.buffer)
    view.setInt32(0, 6, true) // length (excludes 4-byte length field): 4 (client) + 2 (data)
    view.setInt32(4, 0, true) // client = 0 (server)
    view.setInt32(8, frame, true)
    result[12] = OrderType.Ack
    result[13] = count & 0xFF
    return result
  }

  /**
   * Create a tick scale frame: [9: int32 LE][0: int32 LE][0: int32 LE][0x76: byte][scale: float32 LE]
   *
   * OpenRA 对照: Server.CreateTickScaleFrame(float)
   */
  static createTickScaleFrame(scale: number): Uint8Array {
    const result = new Uint8Array(17)
    const view = new DataView(result.buffer)
    view.setInt32(0, 9, true) // length: 4 (client) + 5 (data = 1 byte type + 4 bytes float)
    view.setInt32(4, 0, true) // client = 0
    view.setInt32(8, 0, true) // frame = 0
    result[12] = OrderType.TickScale
    view.setFloat32(13, scale, true)
    return result
  }

  // ---------------------------------------------------------------------------
  // Client Connection Handling
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming transport connection.
   *
   * OpenRA 对照: Server.AcceptConnection(Socket)
   */
  private _handleConnection(transport: IClientTransport): void {
    if (this.state !== ServerState.WaitingPlayers) return

    // Generate auth token: 256 random bytes -> base64
    const token = this._generateAuthToken()

    // Choose free player index
    const playerIndex = this.chooseFreePlayerIndex()

    // Create Connection object
    // TODO-18.C: new Connection(this, transport, playerIndex, token)
    const newConn = this._createConnection(transport, playerIndex, token)

    try {
      // Send handshake protocol version and client index
      const handshakeBuf = new Uint8Array(8)
      const handshakeView = new DataView(handshakeBuf.buffer)
      handshakeView.setInt32(0, ProtocolVersion.Handshake, true)
      handshakeView.setInt32(4, playerIndex, true)
      newConn.trySendData(handshakeBuf)

      // Dispatch handshake request order
      const request: HandshakeRequestData = {
        mod: this.modData.manifest.id,
        version: this.modData.manifest.metadata.version,
        authToken: token,
      }

      const requestOrder = Order.fromTargetString(
        'HandshakeRequest',
        JSON.stringify(request),
        true,
      )

      this._dispatchOrdersToClient(newConn, 0, 0, requestOrder.serialize())
    } catch (e) {
      this._log(
        `Handshake for client ${newConn.endPoint} failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }

    this.conns.push(newConn)
  }

  /**
   * Generate a cryptographically secure random auth token
   * (base64-encoded 256 random bytes).
   *
   * NOTE: Uses crypto.getRandomValues() instead of MersenneTwister for
   * cryptographic-strength entropy. The C# original lacks a CSPRNG due to
   * platform constraints; the web platform provides one natively.
   */
  private _generateAuthToken(): string {
    const bytes = new Uint8Array(256)
    crypto.getRandomValues(bytes)
    return btoa(String.fromCharCode(...bytes))
  }

  /**
   * Create a Connection object (stub until Phase C).
   * TODO-18.C: Replace with `new Connection(this, transport, playerIndex, token)`
   */
  private _createConnection(
    transport: IClientTransport,
    playerIndex: number,
    token: string,
  ): Connection {
    const self = this

    const conn: Connection = {
      playerIndex,
      authToken: token,
      endPoint: transport.remoteAddress,
      connectionTimer: Date.now(),
      validated: false,
      lastOrdersFrame: 0,
      timeoutMessageShown: false,

      get timeSinceLastResponse(): number {
        return Date.now() - conn._lastReceivedTime
      },

      // _lastReceivedTime and _transport are internal properties
      // not exposed on the public Connection interface. They are accessed
      // via (conn as any) casts within the server tick and message handlers.
      _lastReceivedTime: Date.now(),
      _transport: transport,

      trySendData(data: Uint8Array): boolean {
        try {
          return transport.send(data)
        } catch {
          return false
        }
      },

      dispose(): void {
        transport.close()
      },
    } as Connection & { _lastReceivedTime: number; _transport: IClientTransport }

    // Register message handler
    // NOTE: (conn as any) accesses internal properties (_lastReceivedTime,
    // _transport) that are added to the object literal above but not exposed
    // on the public Connection interface. These casts are temporary until
    // Phase C when Connection becomes a proper class (TODO-18.C).
    transport.onMessage((data: Uint8Array) => {
      ;(conn as any)._lastReceivedTime = Date.now()
      self._onConnectionPacket(conn, 0, data)
    })

    // Register close handler
    transport.onClose(() => {
      self._onConnectionDisconnect(conn)
    })

    // Register error handler
    transport.onError((err: Error) => {
      self._log(`Connection error from ${conn.endPoint}: ${err.message}`)
      self._onConnectionDisconnect(conn)
    })

    return conn
  }

  // ---------------------------------------------------------------------------
  // Event dispatch (replaces C# IServerEvent + BlockingCollection)
  // ---------------------------------------------------------------------------

  /**
   * Called when a connection receives data.
   *
   * OpenRA 对照: OnConnectionPacket -> ConnectionPacketEvent.Invoke
   */
  private _onConnectionPacket(conn: Connection, frame: number, data: Uint8Array): void {
    this._receiveOrders(conn, frame, data)
  }

  /**
   * Called when a connection is disconnected.
   *
   * OpenRA 对照: OnConnectionDisconnect -> ConnectionDisconnectEvent.Invoke
   */
  private _onConnectionDisconnect(conn: Connection): void {
    this._dropClient(conn)
  }

  // ---------------------------------------------------------------------------
  // _receivePing (internal: called by Connection stub)
  // ---------------------------------------------------------------------------

  /**
   * Handle a ping response and update connection quality.
   *
   * OpenRA 对照: Server.ReceivePing(Connection, int[])
   */
  _receivePing(conn: Connection, pingHistory: number[]): void {
    const latency =
      pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length

    let quality: ConnectionQuality
    if (latency < 240) {
      quality = ConnectionQuality.Good
    } else if (latency < 360) {
      quality = ConnectionQuality.Moderate
    } else {
      quality = ConnectionQuality.Poor
    }

    // Update connection quality for the player and any bots they control
    for (const c of this.lobbyInfo.clients) {
      if (
        c.index === conn.playerIndex ||
        (c.bot !== null && c.botControllerClientIndex === conn.playerIndex)
      ) {
        c.connectionQuality = quality
      }
    }

    // Dispatch SyncConnectionQuality every 5 seconds
    const now = Date.now()
    if (now - this._pingUpdated > 5000) {
      const qualities: Record<number, number> = {}
      for (const c of this.lobbyInfo.clients) {
        qualities[c.index] = c.connectionQuality
      }

      this._dispatchServerOrdersToClients(
        Order.fromTargetString(
          'SyncConnectionQuality',
          JSON.stringify(qualities),
          true,
        ).serialize(),
      )

      this._pingUpdated = now
    }
  }

  // ---------------------------------------------------------------------------
  // _recordFakeHandshake
  // ---------------------------------------------------------------------------

  /**
   * Record a fake handshake request/response for replay initialization.
   *
   * OpenRA 对照: Server.RecordFakeHandshake()
   */
  private _recordFakeHandshake(): void {
    if (!this._recorder) return

    const request: HandshakeRequestData = {
      mod: this.modData.manifest.id,
      version: this.modData.manifest.metadata.version,
    }

    this._recorder.receiveFrame(
      0,
      0,
      Order.fromTargetString('HandshakeRequest', JSON.stringify(request), true).serialize(),
    )

    const response: HandshakeResponseData = {
      mod: this.modData.manifest.id,
      version: this.modData.manifest.metadata.version,
      ordersProtocol: ProtocolVersion.Orders,
      client: { name: 'Server' },
    }

    this._recorder.receiveFrame(
      0,
      0,
      Order.fromTargetString('HandshakeResponse', JSON.stringify(response), true).serialize(),
    )
  }

  // ---------------------------------------------------------------------------
  // Client Validation
  // ---------------------------------------------------------------------------

  /**
   * Validate a connecting client against server requirements.
   *
   * OpenRA 对照: Server.ValidateClient(Connection, string, string)
   */
  private _validateClient(newConn: Connection, data: string): void {
    try {
      if (this.state === ServerState.GameStarted) {
        this._log(`Rejected connection from ${newConn.endPoint}; game is already started.`)
        this._sendOrderTo(newConn, 'ServerError', 'notification-error-game-started')
        this._dropClient(newConn)
        return
      }

      let handshake: HandshakeResponseData
      try {
        handshake = JSON.parse(data) as HandshakeResponseData
      } catch {
        this._log(`Rejected connection from ${newConn.endPoint}; invalid handshake data.`)
        this._dropClient(newConn)
        return
      }

      // Create client record from SessionClient class
      const client = new SessionClient()

      // Password check
      if (
        this.settings.password &&
        this.settings.password.length > 0 &&
        handshake.password !== this.settings.password
      ) {
        const message = !handshake.password
          ? 'notification-requires-password'
          : 'notification-incorrect-password'
        this._sendOrderTo(newConn, 'AuthenticationError', message)
        this._dropClient(newConn)
        return
      }

      // Mod check
      if (this.modData.manifest.id !== handshake.mod) {
        this._log(`Rejected connection from ${newConn.endPoint}; mods do not match.`)
        this._sendOrderTo(newConn, 'ServerError', 'notification-incompatible-mod')
        this._dropClient(newConn)
        return
      }

      // Version check
      if (this.modData.manifest.metadata.version !== handshake.version) {
        this._log(`Rejected connection from ${newConn.endPoint}; versions do not match.`)
        this._sendOrderTo(newConn, 'ServerError', 'notification-incompatible-version')
        this._dropClient(newConn)
        return
      }

      // Orders protocol check
      if (handshake.ordersProtocol !== ProtocolVersion.Orders) {
        this._log(
          `Rejected connection from ${newConn.endPoint}; incompatible protocol version ${handshake.ordersProtocol}.`,
        )
        this._sendOrderTo(newConn, 'ServerError', 'notification-incompatible-protocol')
        this._dropClient(newConn)
        return
      }

      // IP ban check
      const ip = newConn.endPoint
      const bans = [...this.settings.ban, ...this.tempBans]
      if (bans.includes(ip)) {
        this._log(`Rejected connection from ${newConn.endPoint}; Banned.`)
        const message = this.settings.ban.includes(ip)
          ? 'notification-you-were-banned'
          : 'notification-you-were-temp-banned'
        this._sendOrderTo(newConn, 'ServerError', message)
        this._dropClient(newConn)
        return
      }

      // Build client record
      client.index = newConn.playerIndex
      client.name = this._sanitizeName(handshake.client.name)
      client.ipAddress = ip
      client.preferredColor = handshake.client.preferredColor ?? 0xFFFFFFFF
      client.color = handshake.client.color ?? client.preferredColor
      client.state = ClientState.Invalid

      // Non-multiplayer: trust identity without validation
      if (!this.isMultiplayer) {
        client.fingerprint = handshake.fingerprint
        this._completeConnection(newConn, client)
      } else {
        // Multiplayer: skip auth for now (TODO-18.B: implement authenticator)
        // For now, complete connection directly
        this._completeConnection(newConn, client)
      }
    } catch (ex) {
      this._log(
        `Dropping connection ${newConn.endPoint} because an error occurred: ${ex instanceof Error ? ex.message : String(ex)}`,
      )
      this._dropClient(newConn)
    }
  }

  /**
   * Complete the connection process: assign slot, set admin, sync lobby.
   *
   * OpenRA 对照: ValidateClient inner function CompleteConnection()
   */
  private _completeConnection(
    newConn: Connection,
    client: SessionClient,
  ): void {
    client.slot = this.lobbyInfo.firstEmptySlot()
    client.isAdmin = !this.lobbyInfo.clients.some((c) => c.isAdmin)
    client.isObserver = client.slot === null

    if (client.isObserver && !this.lobbyInfo.globalSettings.allowSpectators) {
      this._sendOrderTo(newConn, 'ServerError', 'notification-game-full')
      this._dropClient(newConn)
      return
    }

    if (client.slot !== null && this.map) {
      Server.syncClientToPlayerReference(client, null)
      // NOTE: Real PlayerReference lookup requires Map.Players.Players[client.slot]
      // which depends on MapPreview having a players property
    } else {
      client.color = 0xFFFFFFFF // White for observers
    }

    // Promote connection to validated
    this.lobbyInfo.clients.push(client)
    newConn.validated = true

    // Disable chat UI for non-admin during join cooldown
    if (!client.isAdmin && this.settings.floodLimitJoinCooldown > 0) {
      this._playerMessageTracker.disableChatUI(
        newConn,
        this.settings.floodLimitJoinCooldown,
      )
    }

    this._log(
      `Client ${newConn.playerIndex}: Accepted connection from ${newConn.endPoint}.`,
    )

    // Fire IClientJoined trait hooks
    for (const t of this._getTraits<IClientJoined>('clientJoined')) {
      t.clientJoined(this, newConn)
    }

    // Send generated map data if applicable
    if (this.map && this.generatedMapData) {
      this._sendOrderTo(newConn, 'GenerateMap', this.generatedMapData)
    }

    this._syncLobbyInfo()

    this._log(`${client.name} (${newConn.endPoint}) has joined the game.`)

    // Notify other clients
    const otherConns = this.conns.filter((c) => c !== newConn)
    this._sendFluentMessageSet(
      otherConns,
      'notification-joined',
      ['player', client.name],
    )

    // MOTD for dedicated servers
    if (this.type === ServerType.Dedicated) {
      // NOTE: In browser mode, we skip MOTD file reading.
      // TODO-18.B: In Node.js mode, read from path.join(platformSupportDir, 'motd.txt')
      this._sendOrderTo(newConn, 'Message', 'Welcome, have fun and good luck!')
    }

    // Custom rules warning
    if (
      this.type !== ServerType.Local &&
      (this.lobbyInfo.globalSettings.mapStatus & MapStatus.UnsafeCustomRules) !== 0
    ) {
      this._sendFluentMessageTo(newConn, 'notification-custom-rules')
    }
  }

  // ---------------------------------------------------------------------------
  // Client Drop
  // ---------------------------------------------------------------------------

  /**
   * Drop a client and clean up all associated state.
   *
   * OpenRA 对照: Server.DropClient(Connection)
   */
  private _dropClient(toDrop: Connection): void {
    this._orderBuffer?.removePlayer(toDrop.playerIndex)
    this.conns = this.conns.filter((c) => c !== toDrop)

    const dropClient = this.lobbyInfo.clients.find(
      (c) => c.index === toDrop.playerIndex,
    )
    if (!dropClient) {
      toDrop.dispose()
      return
    }

    // Send disconnect notification
    if (this.state === ServerState.GameStarted) {
      if (dropClient.isObserver) {
        this._sendFluentMessage(
          'notification-observer-disconnected',
          ['player', dropClient.name],
        )
      } else if (dropClient.team > 0) {
        this._sendFluentMessage(
          'notification-team-player-disconnected',
          ['player', dropClient.name, 'team', String(dropClient.team)],
        )
      } else {
        this._sendFluentMessage(
          'notification-player-disconnected',
          ['player', dropClient.name],
        )
      }
    } else {
      this._sendFluentMessage(
        'notification-lobby-disconnected',
        ['player', dropClient.name],
      )
    }

    // Remove client from lobby
    this.lobbyInfo.clients = this.lobbyInfo.clients.filter(
      (c) => c.index !== toDrop.playerIndex,
    )

    // Reassign admin for dedicated servers
    if (
      this.type === ServerType.Dedicated &&
      dropClient.isAdmin &&
      this.state === ServerState.WaitingPlayers
    ) {
      // Remove bots controlled by admin
      this.lobbyInfo.clients = this.lobbyInfo.clients.filter(
        (c) =>
          !(c.bot !== null && c.botControllerClientIndex === toDrop.playerIndex),
      )

      const nextAdmin = this.lobbyInfo.clients
        .filter((c) => c.bot === null)
        .sort((a, b) => a.index - b.index)[0]

      if (nextAdmin) {
        nextAdmin.isAdmin = true
        this._sendFluentMessage(
          'notification-new-admin',
          ['player', nextAdmin.name],
        )
      }
    }

    // Send Disconnect order to remaining clients
    // 5 bytes: [0xBF: byte][playerIndex: int32 LE]
    const disconnectPacket = new Uint8Array(5)
    const dpView = new DataView(disconnectPacket.buffer)
    disconnectPacket[0] = OrderType.Disconnect
    dpView.setInt32(1, toDrop.playerIndex, true)
    this._dispatchServerOrdersToClients(
      disconnectPacket,
      toDrop.lastOrdersFrame + 1,
    )

    // Update GameInformation disconnect frame
    if (this._gameInfo) {
      for (const p of this._gameInfo.players) {
        if (p.playerId === toDrop.playerIndex) {
          p.disconnectFrame = toDrop.lastOrdersFrame + 1
        }
      }
    }

    // Fire INotifyServerEmpty if no validated clients remain
    if (!this.conns.some((c) => c.validated)) {
      for (const t of this._getTraits<INotifyServerEmpty>('serverEmpty')) {
        t.serverEmpty(this)
      }
    }

    // Sync lobby if players remain
    if (this.conns.some((c) => c.validated) || this.type === ServerType.Dedicated) {
      this._syncLobbyClients()
    }

    // Shutdown non-dedicated server if admin left
    if (this.type !== ServerType.Dedicated && dropClient.isAdmin) {
      this.shutdown()
    }

    toDrop.dispose()
  }

  // ---------------------------------------------------------------------------
  // Order Dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a frame to a specific client.
   */
  private _dispatchFrameToClient(
    c: Connection,
    _client: number,
    frameData: Uint8Array,
  ): void {
    if (!c.trySendData(frameData)) {
      this._dropClient(c)
      this._log(
        `Dropping client ${c.playerIndex} because dispatching orders failed!`,
      )
    }
  }

  /**
   * Dispatch orders to a single client.
   *
   * OpenRA 对照: Server.DispatchOrdersToClient(Connection, int, int, byte[])
   */
  private _dispatchOrdersToClient(
    c: Connection,
    client: number,
    frame: number,
    data: Uint8Array,
  ): void {
    this._dispatchFrameToClient(
      c,
      client,
      Server.createFrame(client, frame, data),
    )
  }

  /**
   * Dispatch orders from a client to all other clients.
   *
   * OpenRA 对照: Server.DispatchOrdersToClients(Connection, int, byte[])
   */
  private _dispatchOrdersToClients(
    conn: Connection,
    frame: number,
    data: Uint8Array,
  ): void {
    const from = conn.playerIndex
    const frameData = Server.createFrame(from, frame, data)

    // Copy array before iteration (may mutate during dispatch)
    for (const c of [...this.conns]) {
      if (c !== conn && c.validated) {
        this._dispatchFrameToClient(c, from, frameData)
      }
    }

    this._recordOrder(frame, data, from)
  }

  /**
   * Dispatch server-authored orders to all validated clients.
   *
   * OpenRA 对照: Server.DispatchServerOrdersToClients(byte[], int)
   */
  private _dispatchServerOrdersToClients(
    data: Uint8Array,
    frame: number = 0,
  ): void {
    const from = 0
    const frameData = Server.createFrame(from, frame, data)

    for (const c of [...this.conns]) {
      if (c.validated) {
        this._dispatchFrameToClient(c, from, frameData)
      }
    }

    this._recordOrder(frame, data, from)
  }

  /**
   * Dispatch server-authored orders to a specific set of connections.
   *
   * OpenRA 对照: Server.DispatchServerOrdersToClients(ReadOnlySpan<Connection>, byte[], int)
   */
  private _dispatchServerOrdersToClientsSet(
    conns: readonly Connection[],
    data: Uint8Array,
    frame: number = 0,
  ): void {
    const from = 0
    const frameData = Server.createFrame(from, frame, data)

    for (const c of conns) {
      if (c.validated) {
        this._dispatchFrameToClient(c, from, frameData)
      }
    }

    this._recordOrder(frame, data, from)
  }

  // ---------------------------------------------------------------------------
  // Order Reception
  // ---------------------------------------------------------------------------

  /**
   * Receive orders from a client.
   *
   * OpenRA 对照: Server.ReceiveOrders(Connection, int, byte[])
   */
  private _receiveOrders(
    conn: Connection,
    frame: number,
    data: Uint8Array,
  ): void {
    // Make sure we don't forward orders from clients we have just dropped
    if (!this.conns.includes(conn)) return

    if (frame === 0) {
      this._interpretServerOrders(conn, data)
    } else {
      // Non-immediate orders: project frame into the future
      if (
        data.length === 0 ||
        data[0] !== OrderType.SyncHash
      ) {
        frame += this.orderLatency
        this._dispatchFrameToClient(
          conn,
          conn.playerIndex,
          Server.createAckFrame(frame, 1),
        )

        this._orderBuffer?.addOrderTimestamp(conn.playerIndex)
        conn.lastOrdersFrame = frame
      }

      this._dispatchOrdersToClients(conn, frame, data)
    }

    // Dispatch to game save if active
    // TODO-18.B: if (this.gameSave) this.gameSave.dispatchOrders(conn, frame, data)
  }

  // ---------------------------------------------------------------------------
  // Interpret Server Orders
  // ---------------------------------------------------------------------------

  /**
   * Interpret frame-0 orders (handshake, commands, chat, save/load).
   *
   * OpenRA 对照: Server.InterpretServerOrders(Connection, byte[])
   */
  private _interpretServerOrders(conn: Connection, data: Uint8Array): void {
    try {
      const o = Order.deserialize(null, data)
      if (o) {
        this._interpretServerOrder(conn, o)
      }
    } catch {
      // EndOfStream / NotImplemented equivalent: ignore
    }
  }

  /**
   * Interpret a single frame-0 order.
   *
   * OpenRA 对照: Server.InterpretServerOrder(Connection, Order)
   */
  private _interpretServerOrder(conn: Connection, o: Order): void {
    const orderStr = o.orderString
    const targetStr = o.targetString ?? ''

    // Only accept HandshakeResponse from unvalidated clients
    if (!conn.validated) {
      if (orderStr === 'HandshakeResponse') {
        this._validateClient(conn, targetStr)
      } else {
        this._log(
          `Rejected connection from ${conn.endPoint}; Order '${orderStr}' is not a 'HandshakeResponse'.`,
        )
        this._dropClient(conn)
      }
      return
    }

    switch (orderStr) {
      case 'Command': {
        if (!this._interpretCommand(targetStr, conn)) {
          this._log(`Unknown server command: ${targetStr}`)
          this._sendFluentMessageTo(conn, 'notification-unknown-server-command', [
            'command',
            targetStr,
          ])
        }
        break
      }

      case 'Chat': {
        if (
          !this.isMultiplayer ||
          !this._playerMessageTracker.isPlayerAtFloodLimit(conn)
        ) {
          this._dispatchOrdersToClients(conn, 0, o.serialize())
        }
        break
      }

      case 'GameSaveTraitData': {
        // TODO-18.B: Integrate with GameSave
        break
      }

      case 'CreateGameSave': {
        // TODO-18.B: Integrate with GameSave
        break
      }

      case 'LoadGameSave': {
        // TODO-18.B: Integrate with GameSave
        break
      }

      case 'GenerateMap': {
        const client = this._getClient(conn)
        if (!client?.isAdmin || this.state >= ServerState.GameStarted) break
        if (!this.lobbyInfo.globalSettings.enableMapGeneration) break

        try {
          this.generatedMapData = targetStr
          this._dispatchServerOrdersToClients(
            Order.fromTargetString('GenerateMap', targetStr, true).serialize(),
          )
        } catch (e) {
          this._log(`GenerateMap error: ${e instanceof Error ? e.message : String(e)}`)
        }
        break
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Command Interpretation
  // ---------------------------------------------------------------------------

  /**
   * Interpret a server command string.
   *
   * OpenRA 对照: Server.InterpretCommand(string, Connection)
   */
  private _interpretCommand(command: string, conn: Connection): boolean {
    const client = this._getClient(conn)
    for (const t of this._getTraits<IInterpretCommand>('interpretCommand')) {
      if (t.interpretCommand(this, conn, client!, command)) {
        return true
      }
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Order Sending Helpers
  // ---------------------------------------------------------------------------

  /**
   * Send an order to a single client.
   *
   * OpenRA 对照: Server.SendOrderTo(Connection, string, string)
   */
  private _sendOrderTo(conn: Connection, order: string, data: string): void {
    this._dispatchOrdersToClient(
      conn,
      0,
      0,
      Order.fromTargetString(order, data, true).serialize(),
    )
  }

  /**
   * Send a Fluent message to all clients.
   *
   * OpenRA 对照: Server.SendFluentMessage(string, params object[])
   */
  private _sendFluentMessage(key: string, args?: unknown[]): void {
    const conns = [...this.conns]
    this._sendFluentMessageSet(conns, key, args)
  }

  /**
   * Send a Fluent message to a specific set of connections.
   *
   * OpenRA 对照: Server.SendFluentMessage(ReadOnlySpan<Connection>, string, params object[])
   */
  private _sendFluentMessageSet(
    conns: readonly Connection[],
    key: string,
    args?: unknown[],
  ): void {
    const text = FluentMessage.serialize(key, args)
    this._dispatchServerOrdersToClientsSet(
      conns,
      Order.fromTargetString('FluentMessage', text, true).serialize(),
    )

    if (this.type === ServerType.Dedicated) {
      this._writeLineWithTimeStamp(FluentMessage.getMessage(key, args))
    }
  }

  /**
   * Send a Fluent message to a single client.
   *
   * OpenRA 对照: Server.SendFluentMessageTo(Connection, string, object[])
   */
  private _sendFluentMessageTo(
    conn: Connection,
    key: string,
    args?: unknown[],
  ): void {
    const text = FluentMessage.serialize(key, args)
    this._dispatchOrdersToClient(
      conn,
      0,
      0,
      Order.fromTargetString('FluentMessage', text, true).serialize(),
    )
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  /**
   * Write a line to the server log with timestamp.
   *
   * OpenRA 对照: Server.WriteLineWithTimeStamp(string)
   */
  private _writeLineWithTimeStamp(line: string): void {
    const now = new Date()
    // Simple timestamp formatting (settings.timestampFormat is a .NET format string)
    const ts = now.toISOString().replace('T', ' ').substring(0, 19)
    console.log(`[${ts}] ${line}`)
  }

  /**
   * Log a server message.
   */
  private _log(message: string): void {
    this._writeLineWithTimeStamp(message)
  }

  // ---------------------------------------------------------------------------
  // Lobby Synchronization
  // ---------------------------------------------------------------------------

  /**
   * Sync lobby info to all clients.
   *
   * OpenRA 对照: Server.SyncLobbyInfo()
   */
  private _syncLobbyInfo(): void {
    if (this.state === ServerState.WaitingPlayers) {
      this._dispatchServerOrdersToClients(
        Order.fromTargetString(
          'SyncInfo',
          this.lobbyInfo.serialize(),
          true,
        ).serialize(),
      )
    }

    for (const t of this._getTraits<INotifySyncLobbyInfo>('lobbyInfoSynced')) {
      t.lobbyInfoSynced(this)
    }
  }

  /**
   * Sync lobby clients to all clients.
   *
   * OpenRA 对照: Server.SyncLobbyClients()
   */
  private _syncLobbyClients(): void {
    if (this.state !== ServerState.WaitingPlayers) return

    const clientData = this.lobbyInfo.clients.map((c) => c.serialize())
    this._dispatchServerOrdersToClients(
      Order.fromTargetString(
        'SyncLobbyClients',
        JSON.stringify(clientData),
        true,
      ).serialize(),
    )

    for (const t of this._getTraits<INotifySyncLobbyInfo>('lobbyInfoSynced')) {
      t.lobbyInfoSynced(this)
    }

    this._pingUpdated = Date.now()
  }

  /**
   * Sync lobby slots to all clients.
   *
   * OpenRA 对照: Server.SyncLobbySlots()
   */
  private _syncLobbySlots(): void {
    if (this.state !== ServerState.WaitingPlayers) return

    const slotData = Array.from(this.lobbyInfo.slots.entries()).map(
      ([_key, slot]) => slot.serialize(),
    )
    this._dispatchServerOrdersToClients(
      Order.fromTargetString(
        'SyncLobbySlots',
        JSON.stringify(slotData),
        true,
      ).serialize(),
    )

    for (const t of this._getTraits<INotifySyncLobbyInfo>('lobbyInfoSynced')) {
      t.lobbyInfoSynced(this)
    }
  }

  /**
   * Sync lobby global settings to all clients.
   *
   * OpenRA 对照: Server.SyncLobbyGlobalSettings()
   */
  private _syncLobbyGlobalSettings(): void {
    if (this.state !== ServerState.WaitingPlayers) return

    const sessionData = [this.lobbyInfo.globalSettings.serialize()]
    this._dispatchServerOrdersToClients(
      Order.fromTargetString(
        'SyncLobbyGlobalSettings',
        JSON.stringify(sessionData),
        true,
      ).serialize(),
    )

    for (const t of this._getTraits<INotifySyncLobbyInfo>('lobbyInfoSynced')) {
      t.lobbyInfoSynced(this)
    }
  }

  // ---------------------------------------------------------------------------
  // Sync Hash Handling
  // ---------------------------------------------------------------------------

  /**
   * Handle a sync hash order from a client.
   *
   * OpenRA 对照: Server.HandleSyncOrder(int, byte[])
   */
  private _handleSyncOrder(frame: number, packet: Uint8Array): void {
    // Defensive: packet must be at least 13 bytes (1 type + 4 hash + 8 defeatState)
    if (packet.length < SYNC_HASH_ORDER_LENGTH) {
      this._log(
        `Dropped undersized sync order at frame ${frame}: length ${packet.length}, min ${SYNC_HASH_ORDER_LENGTH}.`,
      )
      return
    }

    const existingSync = this._syncForFrame.get(frame)

    if (existingSync) {
      // Compare byte-for-byte with existing sync data
      if (packet.length !== existingSync.length) {
        this._outOfSync(frame)
        return
      }

      for (let i = 0; i < packet.length; i++) {
        if (packet[i] !== existingSync[i]) {
          this._outOfSync(frame)
          return
        }
      }
    } else {
      // Extract defeat state from new sync packet
      // Layout: [0x65: byte][hash: int32][defeatState: uint64]
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
      const playerDefeatState = view.getBigUint64(5, true) // skip 0x65 byte + 4-byte hash

      // Check for new defeat states
      if (frame > this._lastDefeatStateFrame && this._lastDefeatState !== playerDefeatState) {
        const newDefeats = playerDefeatState & ~this._lastDefeatState
        for (let i = 0; i < this._worldPlayers.length; i++) {
          if ((newDefeats & (1n << BigInt(i))) !== 0n) {
            this._setPlayerDefeat(i)
          }
        }
        this._lastDefeatState = playerDefeatState
        this._lastDefeatStateFrame = frame
      }

      this._syncForFrame.set(frame, packet)
    }
  }

  /**
   * Handle an out-of-sync detection.
   *
   * OpenRA 对照: Server.OutOfSync(int)
   */
  private _outOfSync(frame: number): void {
    this._log(`Out of sync detected at frame ${frame}, cancel replay recording`)

    if (this._recorder) {
      this._recorder.metadata = null
      this._recorder.dispose()
    }

    this._recorder = null
  }

  // ---------------------------------------------------------------------------
  // Order Recording
  // ---------------------------------------------------------------------------

  /**
   * Record an order for replay and sync hash processing.
   *
   * OpenRA 对照: Server.RecordOrder(int, byte[], int)
   */
  private _recordOrder(frame: number, data: Uint8Array, from: number): void {
    this._recorder?.receiveFrame(from, frame, data)

    if (data.length > 0 && data[0] === OrderType.SyncHash) {
      if (data.length === SYNC_HASH_ORDER_LENGTH) {
        this._handleSyncOrder(frame, data)
      } else {
        this._log(
          `Dropped sync order with length ${data.length} from client ${from}. Expected length ${SYNC_HASH_ORDER_LENGTH}.`,
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Player Defeat / Win State
  // ---------------------------------------------------------------------------

  /**
   * Mark a player as defeated.
   *
   * OpenRA 对照: Server.SetPlayerDefeat(int)
   */
  private _setPlayerDefeat(playerIndex: number): void {
    const defeatedPlayer = this._worldPlayers[playerIndex]
    if (!defeatedPlayer || defeatedPlayer.winState !== WinState.Undefined) return

    defeatedPlayer.winState = WinState.Lost
    defeatedPlayer.outcomeTimestampUtc = new Date()

    // Set remaining players as winners if only one side remains
    if (!this._anyUndefinedWinStates()) {
      const now = new Date()
      const remainingPlayers = this._gameInfo?.players.filter(
        (p) => p.winState === WinState.Undefined,
      ) ?? []
      for (const winner of remainingPlayers) {
        winner.winState = WinState.Won
        winner.outcomeTimestampUtc = now
      }
    }
  }

  /**
   * Check if multiple teams still have undefined win states.
   *
   * OpenRA 对照: Server.AnyUndefinedWinStates()
   */
  private _anyUndefinedWinStates(): boolean {
    if (!this._gameInfo) return false

    let lastTeam = -1
    const remainingPlayers = this._gameInfo.players.filter(
      (p) => p.winState === WinState.Undefined,
    )

    for (const player of remainingPlayers) {
      if (lastTeam >= 0 && (player.team !== lastTeam || player.team === 0)) {
        return true
      }
      lastTeam = player.team
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Game Start
  // ---------------------------------------------------------------------------

  /**
   * Start the game.
   *
   * OpenRA 对照: Server.StartGame()
   */
  startGame(): void {
    this._writeLineWithTimeStamp(
      FluentMessage.getMessage('notification-game-started'),
    )

    // Drop any non-ready clients
    for (const c of [...this.conns].filter(
      (c) => !c.validated || this._getClient(c)?.isInvalid,
    )) {
      this._sendOrderTo(c, 'ServerError', 'notification-you-were-kicked')
      this._dropClient(c)
    }

    // Enable game saves for singleplayer only
    this.lobbyInfo.globalSettings.enableGameSaves =
      this.type !== ServerType.Dedicated &&
      this.lobbyInfo.nonBotClients.length === 1

    // Create world players
    this._worldPlayers = []
    const playerRandom = new MersenneTwister(
      this.lobbyInfo.globalSettings.randomSeed,
    )

    // Create server players (simplified - real impl uses map.WorldActorInfo.TraitInfos<ICreatePlayersInfo>)
    this._createServerPlayers(playerRandom)

    // Create GameInformation
    this._gameInfo = new GameInformation()
    this._gameInfo.mod = this.modData.manifest.id
    this._gameInfo.version = this.modData.manifest.metadata.version
    this._gameInfo.mapUid = this.map?.uid ?? ''
    this._gameInfo.mapTitle = this.map?.title ?? 'Unknown Map'
    this._gameInfo.startTimeUtc = new Date()

    // Add non-null world players
    for (const p of this._worldPlayers) {
      if (p) this._gameInfo.players.push(p)
    }

    // Set replay metadata
    if (this._recorder) {
      // Import ReplayMetadata dynamically
      // TODO-18.B: Use static import
      this._recorder.metadata = this._gameInfo
    }

    this._syncLobbyInfo()

    // Get game speed from lobby options
    const gameSpeedName = this.lobbyInfo.globalSettings.optionOrDefault(
      'gamespeed',
      'default',
    )
    const gameSpeed: GameSpeed = this._getGameSpeed(gameSpeedName)

    // Create OrderBuffer
    // TODO-18.C: Replace with real OrderBuffer
    const validatedPlayers = this.conns
      .filter((c) => c.validated)
      .map((c) => c.playerIndex)

    this._orderBuffer = {
      start(_gs: GameSpeed, _players: Iterable<number>): void {
        // Stub
      },
      addOrderTimestamp(_playerIndex: number): void {
        // Stub
      },
      removePlayer(_playerIndex: number): void {
        // Stub
      },
      getTickScales(): Array<{ playerIndex: number; tickScale: number }> {
        // Return empty tick scales -- real implementation in Phase C
        return []
      },
    }

    this._orderBuffer.start(gameSpeed, validatedPlayers)

    this.state = ServerState.GameStarted

    if (this.isMultiplayer) {
      this.orderLatency = gameSpeed.orderLatency
    }

    this.lobbyInfo.globalSettings.gameTimestep = gameSpeed.timestep

    // Create GameSave if enabled
    // TODO-18.B: Integrate with GameSave module
    // if (!this.gameSave && this.lobbyInfo.globalSettings.enableGameSaves)
    //   this.gameSave = new GameSave()

    let startGameData = ''
    // if (this.gameSave) {
    //   this.gameSave.startGame(this.lobbyInfo, this.map)
    //   if (this.gameSave.lastOrdersFrame >= 0) {
    //     startGameData = JSON.stringify({
    //       SaveLastOrdersFrame: this.gameSave.lastOrdersFrame,
    //       SaveSyncFrame: this.gameSave.lastSyncFrame,
    //     })
    //   }
    // }

    // Dispatch StartGame order
    this._dispatchServerOrdersToClients(
      Order.fromTargetString('StartGame', startGameData, true).serialize(),
    )

    // Fire IStartGame trait hooks
    for (const t of this._getTraits<IStartGame>('gameStarted')) {
      t.gameStarted(this)
    }

    // Inject empty latency-fill frames
    const conns = this.conns.filter((c) => c.validated)
    const firstFrame = 1 // + (this.gameSave?.lastOrdersFrame ?? 0)

    for (const fromConn of conns) {
      for (let i = 0; i < this.orderLatency; i++) {
        fromConn.lastOrdersFrame = firstFrame + i
        const frameData = Server.createFrame(
          fromConn.playerIndex,
          fromConn.lastOrdersFrame,
          new Uint8Array(0),
        )

        for (const toConn of conns) {
          this._dispatchFrameToClient(toConn, fromConn.playerIndex, frameData)
        }

        this._recordOrder(
          fromConn.lastOrdersFrame,
          new Uint8Array(0),
          fromConn.playerIndex,
        )
      }
    }
  }

  /**
   * Get game speed configuration from a name.
   */
  private _getGameSpeed(name: string): GameSpeed {
    // Default game speeds matching OpenRA defaults
    const speeds: Record<string, GameSpeed> = {
      slowest: { name: 'slowest', timestep: 160, orderLatency: 12 },
      slower: { name: 'slower', timestep: 120, orderLatency: 9 },
      normal: { name: 'normal', timestep: 80, orderLatency: 6 },
      fast: { name: 'fast', timestep: 60, orderLatency: 5 },
      faster: { name: 'faster', timestep: 40, orderLatency: 3 },
      fastest: { name: 'fastest', timestep: 20, orderLatency: 2 },
      default: { name: 'default', timestep: 40, orderLatency: 3 },
    }

    return speeds[name] ?? speeds.default
  }

  /**
   * Create server-side player records.
   * Simplified stub -- real impl uses ICreatePlayersInfo trait.
   */
  private _createServerPlayers(_playerRandom: MersenneTwister): void {
    // Create player records from lobby clients
    for (const client of this.lobbyInfo.clients) {
      if (client.bot !== null) continue // Skip bots for now, they will be created by ICreatePlayers

      const player = new GameInformationPlayer(client.name)
      player.playerId = client.index
      player.factionId = client.faction
      player.factionName = client.faction
      player.team = client.team
      player.spawnPoint = client.spawnPoint
      player.isHuman = true
      // NOTE: isObserver is not a field on GameInformationPlayer; bots are identified via isBot
      player.color = {
        r: (client.color >> 16) & 0xFF,
        g: (client.color >> 8) & 0xFF,
        b: client.color & 0xFF,
        a: (client.color >> 24) & 0xFF,
      }
      player.winState = WinState.Undefined

      // Pad worldPlayers array so playerIndex matches index
      while (this._worldPlayers.length <= client.index) {
        this._worldPlayers.push(null)
      }
      this._worldPlayers[client.index] = player
    }
  }

  // ---------------------------------------------------------------------------
  // Game End
  // ---------------------------------------------------------------------------

  /**
   * End the current game.
   *
   * OpenRA 对照: Server.EndGame()
   */
  endGame(): void {
    for (const t of this._getTraits<IEndGame>('gameEnded')) {
      t.gameEnded(this)
    }

    this._recorder?.dispose()
    this._recorder = null
    this._gameInfo = null
    this._worldPlayers = []
    this._syncForFrame.clear()
    this._orderBuffer = null
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  /**
   * Initiate server shutdown.
   *
   * OpenRA 对照: Server.Shutdown()
   */
  shutdown(): void {
    this.state = ServerState.ShuttingDown
  }

  /**
   * Perform the actual shutdown sequence.
   */
  private _performShutdown(): void {
    this.endGame()

    // Fire INotifyServerShutdown on all traits
    for (const t of this._getTraits<INotifyServerShutdown>('serverShutdown')) {
      t.serverShutdown(this)
    }

    // Close all connections
    for (const c of this.conns) {
      c.dispose()
    }
    this.conns = []

    // Stop tick loop
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer)
      this._tickTimer = null
    }
  }

  // ---------------------------------------------------------------------------
  // Tick Loop
  // ---------------------------------------------------------------------------

  /**
   * Start the main server tick loop.
   *
   * OpenRA 对照: Server main Thread lambda
   */
  private _startTickLoop(): void {
    this._tickTimer = setInterval(() => {
      this._tick()
    }, 1000) // 1-second interval matching C#
  }

  /**
   * Main server tick.
   *
   * OpenRA 对照: Server main loop body
   */
  private _tick(): void {
    if (this.state !== ServerState.ShuttingDown) {
      // Tick server traits
      for (const t of this._getTraits<ITick>('tick')) {
        t.tick(this)
      }

      // Tick VoteKickTracker
      this.voteKickTracker.tick()

      // Dispatch tick scale frames during game
      if (this.state === ServerState.GameStarted && this._orderBuffer) {
        for (const { playerIndex, tickScale } of this._orderBuffer.getTickScales()) {
          const frame = Server.createTickScaleFrame(tickScale)
          const con = this.conns.find((c) => c.playerIndex === playerIndex)

          if (con && con.validated) {
            this._dispatchFrameToClient(con, playerIndex, frame)
          }
        }
      }
    }

    if (this.state === ServerState.ShuttingDown) {
      this._performShutdown()
    }
  }

  // ---------------------------------------------------------------------------
  // Utility: Get Client
  // ---------------------------------------------------------------------------

  /**
   * Get the SessionClient for a connection.
   *
   * OpenRA 对照: Server.GetClient(Connection)
   */
  private _getClient(conn: Connection): SessionClient | undefined {
    if (!conn) return undefined
    return this.lobbyInfo.clientWithIndex(conn.playerIndex)
  }

  /**
   * Check if a client has won or lost.
   *
   * OpenRA 对照: Server.HasClientWonOrLost(Session.Client)
   */
  private _hasClientWonOrLost(client: SessionClient): boolean {
    const player = this._worldPlayers.find((p) => p?.playerId === client.index)
    return player ? player.winState !== WinState.Undefined : false
  }

  // ---------------------------------------------------------------------------
  // Utility: Map Known/Unknown
  // ---------------------------------------------------------------------------

  /**
   * Check if a map UID is unknown to the server.
   *
   * OpenRA 对照: Server.MapIsUnknown(string)
   */
  mapIsUnknown(uid: string): boolean {
    if (!uid) return true

    // Use MapCache if available
    // TODO-18.B: Properly integrate MapCache lookup when MapCache API is finalized
    const mapCache = this.modData.mapCache
    if (mapCache) {
      // MapCache is iterable; check if UID is known
      for (const preview of mapCache) {
        if (preview.uid === uid) {
          const status = (preview as { status: number }).status
          return status !== 1 && status !== 2 // Not Available or DownloadAvailable
        }
      }
    }

    return true
  }

  /**
   * Check if a map UID is known to the server.
   *
   * OpenRA 对照: Server.MapIsKnown(string)
   */
  mapIsKnown(uid: string): boolean {
    if (!uid) return false

    if (this.mapPool && !this.mapPool.has(uid)) return false

    return !this.mapIsUnknown(uid)
  }

  // ---------------------------------------------------------------------------
  // Utility: Local Connection Endpoint
  // ---------------------------------------------------------------------------

  /**
   * Get the endpoint for a local game connection.
   *
   * OpenRA 对照: Server.GetEndpointForLocalConnection()
   */
  getEndpointForLocalConnection(): ConnectionTarget {
    const endpoints = this._transport.getLocalEndpoints().map((addr) => {
      const lastColon = addr.lastIndexOf(':')
      if (lastColon >= 0) {
        return {
          host: addr.substring(0, lastColon),
          port: parseInt(addr.substring(lastColon + 1), 10),
        }
      }
      return { host: '127.0.0.1', port: 1234 }
    })

    return { endpoints }
  }

  // ---------------------------------------------------------------------------
  // Utility: Name Sanitization
  // ---------------------------------------------------------------------------

  /**
   * Sanitize a player name.
   */
  private _sanitizeName(name: string): string {
    if (!name || name.trim().length === 0) return 'Anonymous'
    // Remove control characters and trim
    return name.replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, 32)
  }

  // ---------------------------------------------------------------------------
  // Utility: Game UID Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a unique game UID.
   */
  private _generateGameUid(): string {
    const bytes = new Uint8Array(16)
    for (let i = 0; i < 16; i++) {
      bytes[i] = this.random.next() & 0xFF
    }
    // UUID-like format
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`
  }

  // ---------------------------------------------------------------------------
  // Public API: Lobby Sync Methods (exposed for server traits)
  // ---------------------------------------------------------------------------

  /** @inheritdoc Server.SyncLobbyInfo */
  syncLobbyInfo(): void {
    this._syncLobbyInfo()
  }

  /** @inheritdoc Server.SyncLobbyClients */
  syncLobbyClients(): void {
    this._syncLobbyClients()
  }

  /** @inheritdoc Server.SyncLobbySlots */
  syncLobbySlots(): void {
    this._syncLobbySlots()
  }

  /** @inheritdoc Server.SyncLobbyGlobalSettings */
  syncLobbyGlobalSettings(): void {
    this._syncLobbyGlobalSettings()
  }

  /**
   * Update the status of a map and sync lobby info if the current map
   * is affected.
   *
   * OpenRA 对照: Server.MapStatusChanged(string, MapStatus)
   */
  mapStatusChanged(uid: string, status: MapStatus): void {
    if (this.lobbyInfo.globalSettings.map === uid)
      this.lobbyInfo.globalSettings.mapStatus = status
    this.syncLobbyInfo()
  }

  /** Public dispatch for server traits to use. */
  dispatchServerOrdersToClients(data: Uint8Array, frame: number = 0): void {
    this._dispatchServerOrdersToClients(data, frame)
  }

  /** Public sendFluentMessage for server traits. */
  sendFluentMessage(key: string, ...args: unknown[]): void {
    this._sendFluentMessage(key, args)
  }

  /** Public sendFluentMessageTo for server traits. */
  sendFluentMessageTo(conn: Connection, key: string, args?: unknown[]): void {
    this._sendFluentMessageTo(conn, key, args)
  }

  /** Public getClient for server traits. */
  getClient(conn: Connection): SessionClient | undefined {
    return this._getClient(conn)
  }

  /** Public hasClientWonOrLost for server traits. */
  hasClientWonOrLost(client: SessionClient): boolean {
    return this._hasClientWonOrLost(client)
  }
}
