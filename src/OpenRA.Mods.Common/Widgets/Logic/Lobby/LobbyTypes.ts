/**
 * LobbyTypes.ts — Multiplayer lobby session type definitions
 * OpenRA 对照: OpenRA.Network/Session.cs + OpenRA.Network/GameServer.cs
 *
 * 核心范式转换:
 * - C# Session.Client / Session.Slot / Session.Global → TypeScript interfaces
 * - C# CachedTransform<T, U> → function-based lazy evaluation with equality check
 * - C# enum → const objects with type aliases (erasableSyntaxOnly compliance)
 * - C# Color → string hex color
 * - C# MapStatus → const object (matches existing MapCache.ts)
 */

// ---------------------------------------------------------------------------
// ClientState — player ready state
// OpenRA 对照: Session.ClientState enum
// ---------------------------------------------------------------------------

export const ClientState = {
  NotReady: 'NotReady',
  Invalid: 'Invalid',
  Ready: 'Ready',
  Disconnected: 'Disconnected',
} as const

export type ClientState = (typeof ClientState)[keyof typeof ClientState]

// ---------------------------------------------------------------------------
// ConnectionQuality — network connection quality
// OpenRA 对照: Session.ConnectionQuality enum
// ---------------------------------------------------------------------------

export const ConnectionQuality = {
  Good: 'Good',
  Moderate: 'Moderate',
  Poor: 'Poor',
} as const

export type ConnectionQuality = (typeof ConnectionQuality)[keyof typeof ConnectionQuality]

// ---------------------------------------------------------------------------
// MapStatus — map availability status
// OpenRA 对照: MapStatus enum / Session.MapStatus
// ---------------------------------------------------------------------------

export const MapStatus = {
  Available: 'Available',
  Unavailable: 'Unavailable',
  Searching: 'Searching',
  DownloadAvailable: 'DownloadAvailable',
} as const

export type MapStatus = (typeof MapStatus)[keyof typeof MapStatus]

// ---------------------------------------------------------------------------
// ServerState — game server state
// OpenRA 对照: ServerState enum
// ---------------------------------------------------------------------------

export const ServerState = {
  WaitingPlayers: 0,
  GameStarted: 1,
  ShuttingDown: 2,
} as const

// ---------------------------------------------------------------------------
// Session.Client — lobby player info
// OpenRA 对照: Session.Client
// ---------------------------------------------------------------------------

export interface SessionClient {
  readonly index: number
  readonly name: string
  readonly color: string
  readonly team: number
  readonly slot: string | null
  readonly bot: string | null
  readonly isAdmin: boolean
  readonly isObserver: boolean
  readonly isBot: boolean
  readonly isReady: boolean
  readonly isInvalid: boolean
  readonly state: ClientState
  readonly connectionQuality: ConnectionQuality
  readonly spawnPoint: number
  readonly handicap: number
  readonly faction: string
  readonly fingerprint: string | null
}

// ---------------------------------------------------------------------------
// Session.Slot — player slot configuration
// OpenRA 对照: Session.Slot
// ---------------------------------------------------------------------------

export interface SessionSlot {
  readonly playerReference: string
  readonly closed: boolean
  readonly allowBots: boolean
  readonly lockFaction: boolean
  readonly lockColor: boolean
  readonly lockTeam: boolean
  readonly lockSpawn: boolean
  readonly lockHandicap: boolean
  readonly required: boolean
}

// ---------------------------------------------------------------------------
// LobbyOptionState — per-option state
// OpenRA 对照: Session.LobbyOptionState
// ---------------------------------------------------------------------------

export interface LobbyOptionState {
  readonly id: string
  readonly value: string
  readonly isEnabled: boolean
  readonly isLocked: boolean
  readonly preferredValue: string
}

// ---------------------------------------------------------------------------
// Session.Global — lobby global settings
// OpenRA 对照: Session.Global
// ---------------------------------------------------------------------------

export interface SessionGlobal {
  readonly serverName: string
  readonly map: string
  readonly mapStatus: MapStatus
  readonly randomSeed: number
  readonly dedicated: boolean
  readonly allowSpectators: boolean
  readonly enableSingleplayer: boolean
  readonly enableMapGeneration: boolean
  readonly lobbyOptions: Readonly<Record<string, LobbyOptionState>>
}

// ---------------------------------------------------------------------------
// LobbyInfo — complete lobby state
// OpenRA 对照: Session
// ---------------------------------------------------------------------------

export interface LobbyInfo {
  readonly globalSettings: SessionGlobal
  readonly clients: readonly SessionClient[]
  readonly slots: ReadonlyMap<string, SessionSlot>
  readonly disabledSpawnPoints: readonly number[]
  readonly nonBotPlayers: readonly SessionClient[]
  clientInSlot(slotKey: string): SessionClient | undefined
  clientWithIndex(index: number): SessionClient | undefined
}

// ---------------------------------------------------------------------------
// LobbyFaction — faction metadata for dropdown
// OpenRA 对照: LobbyFaction class
// ---------------------------------------------------------------------------

export interface LobbyFaction {
  selectable: boolean
  name: string
  description: string | null
  side: string | null
}

// ---------------------------------------------------------------------------
// SpawnOccupant — player occupying a spawn point
// OpenRA 对照: SpawnOccupant
// ---------------------------------------------------------------------------

export interface SpawnOccupant {
  readonly client: SessionClient
  readonly disabled: boolean
}

// ---------------------------------------------------------------------------
// MapPreview — map metadata for lobby display
// OpenRA 对照: MapPreview
// ---------------------------------------------------------------------------

export interface MapPreviewLobby {
  readonly uid: string
  readonly title: string
  readonly status: MapStatus
  readonly class: string
  readonly spawnPoints: readonly { x: number; y: number }[]
  readonly playerCount: number
  readonly gridType: string
  readonly worldActorInfo: MapPreviewActorInfo | null
  readonly playerActorInfo: MapPreviewActorInfo | null
  readonly generationArgs: unknown | null
  readonly players: MapPreviewPlayers
  tryGetMessage(key: string): string | undefined
  getMessage(key: string): string
}

export interface MapPreviewPlayers {
  readonly players: ReadonlyMap<string, MapPreviewPlayer>
}

export interface MapPreviewPlayer {
  readonly playable: boolean
  readonly allowBots: boolean
}

export interface MapPreviewActorInfo {
  traitInfos<T extends object>(): T[]
  traitInfoOrDefault<T extends object>(): T | null
}

// ---------------------------------------------------------------------------
// GameServer — server listing entry
// OpenRA 对照: GameServer
// ---------------------------------------------------------------------------

export interface GameServer {
  readonly id: number
  readonly name: string
  readonly address: string
  readonly state: number
  readonly players: number
  readonly bots: number
  readonly spectators: number
  readonly maxPlayers: number
  readonly map: string
  readonly mod: string
  readonly modLabel: string
  readonly version: string
  readonly location: string
  readonly started: number
  readonly playTime: number
  readonly protected: boolean
  readonly authentication: boolean
  readonly isJoinable: boolean
  readonly isCompatible: boolean
  readonly clients: readonly GameClient[]
  readonly disabledSpawnPoints: readonly number[]
}

// ---------------------------------------------------------------------------
// GameClient — player in server listing
// OpenRA 对照: GameClient
// ---------------------------------------------------------------------------

export interface GameClient {
  readonly name: string
  readonly color: string
  readonly faction: string
  readonly team: number
  readonly spawnPoint: number
  readonly isBot: boolean
  readonly isSpectator: boolean
}

// ---------------------------------------------------------------------------
// MPGameFilters — bitmask filters for server browser
// OpenRA 对照: MPGameFilters enum
// ---------------------------------------------------------------------------

export const MPGameFilters = {
  None: 0,
  Waiting: 1 << 0,
  Empty: 1 << 1,
  Started: 1 << 2,
  Protected: 1 << 3,
  Incompatible: 1 << 4,
} as const

export type MPGameFilters = number

// ---------------------------------------------------------------------------
// LobbyOption — map lobby option descriptor
// OpenRA 对照: LobbyOption / LobbyBooleanOption
// ---------------------------------------------------------------------------

export interface LobbyOption {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly defaultValue: string
  readonly isVisible: boolean
  readonly displayOrder: number
  readonly values: Readonly<Record<string, string>>
  label(value: string): string
}

export interface LobbyBooleanOption extends LobbyOption {
  readonly enabledByDefault: boolean
}

// ---------------------------------------------------------------------------
// OrderManager (lobby subset) — minimal interface for lobby logic
// OpenRA 对照: OrderManager (subset)
// ---------------------------------------------------------------------------

export interface OrderManagerLobby {
  readonly lobbyInfo: LobbyInfo
  readonly localClient: SessionClient | null
  readonly serverError: string | null
  readonly authenticationFailed: boolean
  readonly serverMapPool: ReadonlySet<string> | null
  issueOrder(order: unknown): void
  /** OpenRA 对照: Game.BeforeGameStart event — 注册游戏开始回调 */
  onBeforeGameStart?(handler: () => void): void
  /** OpenRA 对照: Game.BeforeGameStart event — 解绑游戏开始回调 */
  offBeforeGameStart?(handler: () => void): void
  /** OpenRA 对照: Game.ConnectionStateChanged event — 注册连接状态变化回调 */
  onConnectionStateChanged?(handler: (orderManager: OrderManagerLobby, connectionState: string) => void): void
  /** OpenRA 对照: Game.ConnectionStateChanged event — 解绑连接状态变化回调 */
  offConnectionStateChanged?(handler: (orderManager: OrderManagerLobby, connectionState: string) => void): void
}

// ---------------------------------------------------------------------------
// DropDownOption — option entry for dropdown menus
// OpenRA 对照: DropDownOption (nested in LobbyLogic.cs)
// ---------------------------------------------------------------------------

export interface DropDownOption {
  title: string
  isSelected: () => boolean
  onClick: () => void
}

// ---------------------------------------------------------------------------
// CachedTransform — lazy evaluation with cache
// OpenRA 对照: CachedTransform<T, U>
// ---------------------------------------------------------------------------

export class CachedTransform<T, U> {
  private _lastInput: T | undefined
  private _lastOutput: U | undefined
  private _initialized = false
  private readonly _transform: (input: T) => U

  constructor(transform: (input: T) => U) {
    this._transform = transform
  }

  update(input: T): U {
    if (!this._initialized || input !== this._lastInput) {
      this._lastOutput = this._transform(input)
      this._lastInput = input
      this._initialized = true
    }
    return this._lastOutput!
  }

  invalidate(): void {
    this._initialized = false
  }
}

// ---------------------------------------------------------------------------
// PredictedCachedTransform — optimistic prediction transform
// OpenRA 对照: PredictedCachedTransform
// ---------------------------------------------------------------------------

export class PredictedCachedTransform<T, U> extends CachedTransform<T, U> {
  private _predicted: U | undefined
  private _hasPrediction = false

  predict(value: U): void {
    this._predicted = value
    this._hasPrediction = true
  }

  override update(input: T): U {
    if (this._hasPrediction) {
      this._hasPrediction = false
      return this._predicted!
    }
    return super.update(input)
  }
}
