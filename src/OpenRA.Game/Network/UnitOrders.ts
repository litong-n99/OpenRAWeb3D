/**
 * UnitOrders.ts — Order routing and dispatch for player commands
 * OpenRA 对照: OpenRA.Game/Network/UnitOrders.cs (431 lines)
 *
 * 核心范式转换:
 * - C# switch-case dispatch → TypeScript Map<string, OrderHandler> registry (extensible)
 * - C# TextNotificationsManager static calls → stub ()
 * - C# MiniYaml parsing for lobby messages → simplified string parsing
 * - C# FluentMessage/FluentReference → simplified placeholder ()
 * - C# static KickVoteTarget → module-level mutable state
 */

import { Order, OrderPacket, OrderType, NULL_ACTOR_ID } from './Order'
import type { IGameActor } from '../Traits/TraitsInterfaces'
import type { IResolveOrder } from '../Traits/TraitsInterfaces'
import type { IValidateOrder } from '../Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Forward type stubs (not yet migrated)
// ---------------------------------------------------------------------------

/**
 * Session Client stub — minimal interface for lobby player info.
 *
 * OpenRA 对照: Session.Client
 * TODO-6.X: Replace with full Session.Client when Session is migrated.
 */
export interface ClientStub {
  readonly index: number
  readonly name: string
  readonly color: string
  readonly team: number
  readonly slot: string | null
  readonly bot: string | null
  readonly isAdmin: boolean
  readonly isObserver: boolean
  readonly isBot: boolean
  readonly state: ClientStateStub
  connectionQuality: ConnectionQualityStub
}

/**
 * Session Client state enum stub.
 *
 * OpenRA 对照: Session.ClientState
 */
export const ClientState = {
  NotReady: 0,
  Invalid: 1,
  Ready: 2,
  Disconnected: 1000,
} as const

export type ClientStateStub = (typeof ClientState)[keyof typeof ClientState]

/**
 * Session ConnectionQuality enum stub.
 *
 * OpenRA 对照: Session.ConnectionQuality
 */
export const ConnectionQuality = {
  Good: 0,
  Moderate: 1,
  Poor: 2,
} as const

export type ConnectionQualityStub =
  (typeof ConnectionQuality)[keyof typeof ConnectionQuality]

/**
 * Session GlobalSettings stub.
 *
 * OpenRA 对照: Session.Global
 */
export interface GlobalSettingsStub {
  readonly map: string
  readonly randomSeed: number
  readonly netFrameInterval: number
  readonly gameTimestep: number
  readonly enableSyncReports: boolean
  readonly dedicated: boolean
  optionOrDefault(key: string, defaultValue: string | boolean): string | boolean
}

/**
 * OrderManager stub — forward reference for order processing.
 *
 * OpenRA 对照: OrderManager
 */
export interface OrderManagerStub {
  readonly netFrameNumber: number
  readonly localFrameNumber: number
  readonly gameStarted: boolean
  readonly lobbyInfo: LobbyInfoStub
  readonly localClient: ClientStub | null
  readonly serverError: string | null
  readonly authenticationFailed: boolean
  readonly world: WorldStub | null
  issueOrder(order: Order): void
  gameSaveLastFrame: number
  gameSaveLastSyncFrame: number
  serverMapPool: ReadonlySet<string> | null
  connection: ConnectionStub
  /** Receive immediate orders (no frame queuing). */
  receiveImmediateOrders(clientId: number, packet: OrderPacket): void
  /** Receive orders for a specific frame. */
  receiveOrders(clientId: number, data: { frame: number; orders: OrderPacket }): void
  /** Receive sync hash data. */
  receiveSync(frame: number, syncHash: number, defeatState: bigint): void
  /** Receive disconnect notification. */
  receiveDisconnect(clientId: number, frame: number): void
  /** Receive tick scale adjustment from server. */
  receiveTickScale(tickScale: number): void
}

/**
 * LobbyInfo stub.
 *
 * OpenRA 对照: Session
 */
export interface LobbyInfoStub {
  readonly clients: readonly ClientStub[]
  readonly globalSettings: GlobalSettingsStub
  readonly slots: ReadonlyMap<string, SlotStub>
  readonly disabledSpawnPoints: readonly number[]
  clientWithIndex(id: number): ClientStub | undefined
  nonBotClients(): readonly ClientStub[]
}

/**
 * Session.Slot stub.
 */
export interface SlotStub {
  readonly playerReference: string
  readonly closed: boolean
  readonly allowBots: boolean
  readonly lockFaction: boolean
  readonly lockColor: boolean
  readonly lockTeam: boolean
  readonly lockSpawn: boolean
  readonly required: boolean
}

/**
 * Connection stub.
 */
export interface ConnectionStub {
  readonly localClientId: number
  dispose?(): void
}

/**
 * World stub for order processing.
 */
export interface WorldStub {
  readonly isReplay: boolean
  readonly paused: boolean
  predictedPaused: boolean
  readonly localPlayer: PlayerStub | null
  readonly players: readonly PlayerStub[]
  readonly actors: ReadonlyMap<number, IGameActor>
  readonly lobbyInfo: LobbyInfoStub | null
  readonly orderValidators: readonly IValidateOrder[]
  readonly isGameOver: boolean
  readonly isGameStarted: boolean
  /** Whether the world is fast-forwarding through a loaded game save.
   *
   * OpenRA 对照: World.IsLoadingGameSave
   */
  readonly isLoadingGameSave: boolean
  /** The configured game simulation timestep in milliseconds (default 40).
   *
   * OpenRA 对照: World.Timestep
   */
  readonly timestep: number
  /** The replay playback timestep in milliseconds (0 = paused).
   *
   * OpenRA 对照: World.ReplayTimestep
   */
  readonly replayTimestep: number
  readonly worldTick: number
  readonly worldActor: IGameActor
  getActorById(id: number): IGameActor | undefined
  actorsHavingTrait<T extends object>(interfaceName: string): readonly (T & IGameActor)[]
}

/**
 * Player stub for order processing.
 */
export interface PlayerStub {
  readonly clientIndex: number
  readonly playerReference: PlayerReferenceStub
  readonly winState: WinStateStub
  readonly spectating: boolean
  readonly nonCombatant: boolean
  readonly resolvedPlayerName: string
}

/**
 * PlayerReference stub.
 */
export interface PlayerReferenceStub {
  readonly playable: boolean
}

/**
 * WinState stub.
 */
export const WinState = {
  Undefined: 0,
  Won: 1,
  Lost: 2,
} as const

export type WinStateStub = (typeof WinState)[keyof typeof WinState]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard limit on chat message length to prevent exploits.
 *
 * OpenRA 对照: UnitOrders.ChatMessageMaxLength = 2500
 */
export const ChatMessageMaxLength = 2500

// ---------------------------------------------------------------------------
// Kick vote target (module-level mutable state)
// ---------------------------------------------------------------------------

/**
 * The client index currently being voted to kick, or null.
 *
 * OpenRA 对照: UnitOrders.KickVoteTarget (static field)
 */
export let kickVoteTarget: number | null = null

// ---------------------------------------------------------------------------
// Notification key constants (对应 C# FluentReference constants)
// NOTE: 'notification-joined' and 'notification-lobby-disconnected' are
// declared inline where used; export as constants when needed by mod code.
// ---------------------------------------------------------------------------

const GameStarted = 'notification-game-has-started'
const GamePaused = 'notification-game-paused'
const GameUnpaused = 'notification-game-unpaused'

// ---------------------------------------------------------------------------
// Notification stubs (: replace with real notification system)
// ---------------------------------------------------------------------------

/**
 * Add a system line notification.
 *
 * OpenRA 对照: TextNotificationsManager.AddSystemLine(string, ...)
* Replace with real text notification system.
 */
let addSystemLineFn: ((key: string, ...args: unknown[]) => void) | null = null
let addChatLineFn:
  | ((
      clientId: number,
      name: string,
      message: string,
      color: string,
    ) => void)
  | null = null

export function setNotificationHandlers(
  systemLine: (key: string, ...args: unknown[]) => void,
  chatLine: (clientId: number, name: string, message: string, color: string) => void,
): void {
  addSystemLineFn = systemLine
  addChatLineFn = chatLine
}

function addSystemLine(key: string, ...args: unknown[]): void {
  addSystemLineFn?.(key, ...args)
}

function addChatLine(
  clientId: number,
  name: string,
  message: string,
  color: string,
): void {
  addChatLineFn?.(clientId, name, message, color)
}

// ---------------------------------------------------------------------------
// Order handler type
// ---------------------------------------------------------------------------

/**
 * A function that handles a specific order type.
 *
 * OpenRA 对照: case branches in ProcessOrder switch statement
 *
 * @returns true if the order was fully handled and should not be passed
 *   to ResolveOrder; false to fall through to default actor-based resolution.
 */
export type OrderHandler = (
  orderManager: OrderManagerStub,
  world: WorldStub | null,
  clientId: number,
  order: Order,
) => boolean

// ---------------------------------------------------------------------------
// Order handler registry (upgrade from switch-case to extensible map)
// ---------------------------------------------------------------------------

/**
 * Registry of order handlers keyed by order string.
 *
 * OpenRA 对照: switch(order.OrderString) in ProcessOrder
 *
 * Mods can register additional order handlers via registerHandler().
 */
const orderHandlers = new Map<string, OrderHandler>()

/**
 * Register a custom order handler.
 *
 * OpenRA 对照: extending the switch statement (C# not possible without patching)
 *
 * This is an upgrade over OpenRA's hardcoded switch-case: mods can add
 * custom order types without modifying engine code.
 */
export function registerHandler(
  orderString: string,
  handler: OrderHandler,
): void {
  orderHandlers.set(orderString, handler)
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Find the player associated with a client.
 *
 * OpenRA 对照: UnitOrders.FindPlayerByClient(World, Session.Client)
 */
function findPlayerByClient(
  world: WorldStub,
  client: ClientStub,
): PlayerStub | undefined {
  return world.players.find(
    (p) =>
      p.clientIndex === client.index && p.playerReference.playable,
  )
}

/**
 * Check if an order is from the server or from a replay world.
 *
 * OpenRA 对照: OrderNotFromServerOrWorldIsReplay(int clientId, World world)
 */
function orderNotFromServerOrWorldIsReplay(
  clientId: number,
  world: WorldStub | null,
): boolean {
  return clientId !== 0 || (world !== null && world.isReplay)
}

// ---------------------------------------------------------------------------
// Default order handlers (built-in)
// ---------------------------------------------------------------------------

function initDefaultHandlers(): void {
  // "Message" — server message displayed as system notification
  // OpenRA 对照: ProcessOrder case "Message"
  registerHandler('Message', (_om, _world, _clientId, order) => {
    if (order.targetString) {
      addSystemLine(order.targetString)
    }
    return true
  })

  // "Chat" — player chat message
  // OpenRA 对照: ProcessOrder case "Chat"
  registerHandler('Chat', (om, world, clientId, order) => {
    const client = om.lobbyInfo.clientWithIndex(clientId)
    if (!client) return true

    // Cut chat messages to the hard limit to avoid exploits
    let message = order.targetString ?? ''
    if (message.length > ChatMessageMaxLength) {
      message = message.substring(0, ChatMessageMaxLength)
    }

    // ExtraData 0 means this is a normal chat order, everything else is team chat
    if (order.extraData === 0) {
      const p = world ? findPlayerByClient(world, client) : undefined
      const suffix =
        p && p.winState === WinState.Lost
          ? ' (Dead)'
          : client.isObserver
            ? ' (Spectator)'
            : ''

      let fullSuffix = suffix
      if (
        om.localClient &&
        client !== om.localClient &&
        client.team > 0 &&
        client.team === om.localClient.team
      ) {
        fullSuffix += ' (Ally)'
      }

      addChatLine(clientId, client.name + fullSuffix, message, client.color)
      return true
    }

    // Team chat
    if (world === null) {
      // Still in lobby
      const prefix =
        order.extraData === NULL_ACTOR_ID ? '[Spectators] ' : '[Team] '
      if (
        om.localClient &&
        client.team === om.localClient.team
      ) {
        addChatLine(clientId, prefix + client.name, message, client.color)
      }
      return true
    }

    return true
  })

  // "StartGame" — start the game
  // OpenRA 对照: ProcessOrder case "StartGame"
  registerHandler('StartGame', (_om, _world, _clientId, order) => {
    if (order.targetString && order.targetString.length > 0) {
      // Parse save frame data from target string
      // NOTE: Simplified — full MiniYAML parsing deferred to
      addSystemLine(GameStarted)
    } else {
      addSystemLine(GameStarted)
    }
    // Game.StartGame would be called here
    // Call Game.StartGame(om.lobbyInfo.globalSettings.map, WorldType.Regular)
    return true
  })

  // "PauseGame" — pause or unpause the game
  // OpenRA 对照: ProcessOrder case "PauseGame"
  registerHandler('PauseGame', (om, world, clientId, order) => {
    if (!world) return true

    const client = om.lobbyInfo.clientWithIndex(clientId)
    if (!client) return true

    const pause = order.targetString === 'Pause'

    // Prevent injected unpause orders from restarting a finished game
    if (world.isGameOver && !pause) return true

    if (
      world.paused !== pause &&
      world.lobbyInfo &&
      world.lobbyInfo.nonBotClients().length > 1
    ) {
      addSystemLine(pause ? GamePaused : GameUnpaused, 'player', client.name)
    }

    // NOTE: world.paused and world.predictedPaused are set by the caller
    // (OrderManager) — matching OpenRA where UnitOrders modifies world state
    world.predictedPaused = pause
    return true
  })

  // "HandshakeRequest" — respond to server handshake
  // OpenRA 对照: ProcessOrder case "HandshakeRequest"
  registerHandler('HandshakeRequest', (om, _world, _clientId, _order) => {
    // NOTE: Full production handshake response requires settings, mod config,
    // profiles, and auth signatures. This simplified implementation issues a
    // placeholder HandshakeResponse to allow the connection handshake to
    // complete. The server may reject this for production games.
    // Implement full HandshakeRequest/HandshakeResponse logic
    //   including mod switching, player profile, and auth token signing.
    const response = {
      client: {
        name: 'Player',
        preferredColor: '#FFFFFF',
        color: '#FFFFFF',
        faction: 'Random',
        spawnPoint: 0,
        team: 0,
        state: 0, // ClientState.Invalid
      },
      mod: 'cnc',
      version: 'release-20230225',
      password: '',
      fingerprint: null,
      ordersProtocol: 1,
    }
    const respOrder = Order.fromTargetString(
      'HandshakeResponse',
      JSON.stringify(response),
      true,
    )
    respOrder.type = OrderType.Handshake
    om.issueOrder(respOrder)
    return true
  })

  // "ServerError" — server error notification
  // OpenRA 对照: ProcessOrder case "ServerError"
  registerHandler('ServerError', (om, _world, _clientId, order) => {
    // NOTE: orderManager is mutated here — matching OpenRA
    ;(om as { serverError: string | null }).serverError = order.targetString
    ;(om as { authenticationFailed: boolean }).authenticationFailed = false
    return true
  })

  // "AuthenticationError" — authentication failure
  // OpenRA 对照: ProcessOrder case "AuthenticationError"
  registerHandler('AuthenticationError', (om, _world, _clientId, order) => {
    ;(om as { serverError: string | null }).serverError = order.targetString
    ;(om as { authenticationFailed: boolean }).authenticationFailed = true
    return true
  })

  // "SyncInfo" — lobby info sync
  // OpenRA 对照: ProcessOrder case "SyncInfo"
  registerHandler('SyncInfo', (_om, _world, _clientId, _order) => {
    // NOTE: LobbyInfo deserialization from targetString
    // Implement Session.Deserialize for full lobby sync
    return true
  })

  // "Disconnected" — another client disconnected
  // OpenRA 对照: ProcessOrder case "Disconnected" (via ReceiveDisconnect)
  registerHandler('Disconnected', (_om, _world, _clientId, _order) => {
    // NOTE: Client disconnection is handled in OrderManager.ReceiveDisconnect
    return true
  })

  // "Ping" — latency measurement
  // OpenRA 对照: ping response handled in Connection.Receive
  registerHandler('Ping', (_om, _world, _clientId, _order) => {
    // NOTE: Ping is handled at the transport layer (Connection.Receive)
    return true
  })

  // "DisableChatEntry" — server disables chat temporarily
  // OpenRA 对照: ProcessOrder case "DisableChatEntry"
  registerHandler('DisableChatEntry', (_om, world, clientId, _order) => {
    if (orderNotFromServerOrWorldIsReplay(clientId, world)) return true
    // NOTE: ChatDisabledUntil tracking — deferred to
    return true
  })

  // "StartKickVote" — begin a kick vote
  // OpenRA 对照: ProcessOrder case "StartKickVote"
  registerHandler('StartKickVote', (_om, world, clientId, order) => {
    if (orderNotFromServerOrWorldIsReplay(clientId, world)) return true
    kickVoteTarget = order.extraData
    return true
  })

  // "EndKickVote" — end a kick vote
  // OpenRA 对照: ProcessOrder case "EndKickVote"
  registerHandler('EndKickVote', (_om, world, clientId, order) => {
    if (orderNotFromServerOrWorldIsReplay(clientId, world)) return true
    if (kickVoteTarget === order.extraData) {
      kickVoteTarget = null
    }
    return true
  })
}

// Initialize default handlers
initDefaultHandlers()

// ---------------------------------------------------------------------------
// ProcessOrder (main entry point)
// ---------------------------------------------------------------------------

/**
 * Process an order from a client.
 *
 * OpenRA 对照: UnitOrders.ProcessOrder(OrderManager, World, int, Order)
 *
 * Dispatches to registered order handlers based on order.orderString.
 * If no handler claims the order (returns false), falls through to
 * the default ResolveOrder path for actor-based command processing.
 *
 * @param orderManager — the order manager
 * @param world — the game world (can be null in lobby)
 * @param clientId — the client that sent the order
 * @param order — the order to process
 */
export function processOrder(
  orderManager: OrderManagerStub,
  world: WorldStub | null,
  clientId: number,
  order: Order,
): void {
  const handler = orderHandlers.get(order.orderString)
  if (handler) {
    const handled = handler(orderManager, world, clientId, order)
    if (handled) return
  }

  // Fall through to default actor-based resolution
  if (world === null) return

  if (order.groupedActorIds.length === 0) {
    resolveOrder(order, world, orderManager, clientId)
  } else {
    for (const subjectId of order.groupedActorIds) {
      const groupedOrder = Order.fromGroupedOrder(order, subjectId)
      resolveOrder(groupedOrder, world, orderManager, clientId)
    }
  }
}

// ---------------------------------------------------------------------------
// ResolveOrder
// ---------------------------------------------------------------------------

/**
 * Dispatch an order to its subject actor's IResolveOrder traits.
 *
 * OpenRA 对照: UnitOrders.ResolveOrder(Order, World, OrderManager, int)
 *
 * Validates that the subject actor is alive and that all order validators
 * pass, then calls ResolveOrder directly on the subject actor (matching
 * OpenRA's `order.Subject.ResolveOrder(order)` pattern).
 */
function resolveOrder(
  order: Order,
  world: WorldStub,
  orderManager: OrderManagerStub,
  clientId: number,
): void {
  if (order.subjectId === NULL_ACTOR_ID) return

  const subject = world.getActorById(order.subjectId)
  if (!subject || subject.isDead) return

  // Run all order validators
  // NOTE: Cast worlds through unknown because our WorldStub differs from
  // TraitsInterfaces.WorldStub (actors field type). Both implement the same
  // runtime contract; the type mismatch is a stub migration ordering artifact.
  for (const vo of world.orderValidators) {
    if (
      !vo.orderValidation(
        orderManager as unknown,
        world as unknown as Parameters<typeof vo.orderValidation>[1],
        clientId,
        order as unknown as Parameters<typeof vo.orderValidation>[3],
      )
    )
      return
  }

  // Call ResolveOrder directly on the subject actor (matches OpenRA:
  // `order.Subject.ResolveOrder(order)`). The subject itself implements
  // IResolveOrder; we do NOT scan all actors.
  // NOTE: Order.targetString is string|null but OrderStub expects string.
  // Cast through unknown to satisfy the interface contract.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolvableSubject = subject as unknown as IResolveOrder
    resolvableSubject.resolveOrder(
      subject,
      order as unknown as Parameters<typeof resolvableSubject.resolveOrder>[1],
    )
  } catch (e) {
    console.debug(
      `Error resolving order ${order.orderString} on actor ${subject.actorId}: ${String(e)}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Clear / Reset
// ---------------------------------------------------------------------------

/**
 * Reset module-level state (used on game exit / disconnect).
 *
 * OpenRA 对照: UnitOrders.Clear()
 */
export function clear(): void {
  kickVoteTarget = null
  orderHandlers.clear()
  initDefaultHandlers()
}
