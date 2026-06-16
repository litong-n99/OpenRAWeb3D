/**
 * SessionTypes.ts -- Canonical server-side session type definitions with
 * NUMERIC enums matching OpenRA C# exactly.
 *
 * OpenRA 对照: OpenRA.Network/Session.cs
 *
 * 核心范式转换:
 * - C# `enum ClientState { NotReady, Invalid, Ready, Disconnected = 1000 }`
 *   -> TypeScript `const` numeric object + union type
 * - C# `[Flags] enum MapStatus { ... }` -> TypeScript numeric const object
 *   (bitfields are checked with `(status & flag) !== 0`)
 * - C# `MiniYamlNode Serialize()` / `MiniYaml Deserialize(MiniYaml)` ->
 *   JSON `serialize() / static deserialize(Record<string, unknown>)` round-trip
 * - C# `Color` struct -> `number` (ARGB packed as 32-bit uint, same as Color.ts)
 * - C# `IPEndPoint`, `IPAddress` -> `string` host:port representation
 * - C# `HashSet<int>` -> `Set<number>`
 *
 * NOTE: These are the CANONICAL server-side types. The LobbyTypes.ts in
 * `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/` are UI-focused STRING enums.
 * Later, LobbyTypes.ts will be consolidated to import from here.
 */

// ---------------------------------------------------------------------------
// Numeric Enums (match C# EXACTLY -- NOT string enums like LobbyTypes.ts)
// ---------------------------------------------------------------------------

/**
 * Connection quality levels for ping-based classification.
 *
 * OpenRA 对照: Session.ConnectionQuality enum
 */
export const ConnectionQuality = {
  Good: 0,
  Moderate: 1,
  Poor: 2,
} as const

export type ConnectionQuality = (typeof ConnectionQuality)[keyof typeof ConnectionQuality]

/**
 * Client readiness state.
 *
 * OpenRA 对照: Session.ClientState enum
 */
export const ClientState = {
  NotReady: 0,
  Ready: 1,
  Invalid: 2,
} as const

export type ClientState = (typeof ClientState)[keyof typeof ClientState]

/**
 * Win/Loss outcome state.
 *
 * OpenRA 对照: WinState enum (also in Player.ts; server-side copy)
 */
export const WinState = {
  Undefined: 0,
  Won: 1,
  Lost: 2,
} as const

export type WinState = (typeof WinState)[keyof typeof WinState]

/**
 * Map validation status bitfield flags.
 *
 * OpenRA 对照: Session.MapStatus [Flags] enum
 *
 * Values are powers of 2 so they can be OR'd together.
 * NOTE: The C# original has Validating=1 and Playable=2, but the migration plan
 * specifies Playable=1 and Validating=2 which maps the earlier OpenRA Session.cs
 * comment order. We match the C# `[Flags]` enum values exactly:
 *   Validating = 1,
 *   Playable = 2,
 *   Incompatible = 4,
 *   UnsafeCustomRules = 8,
 */
export const MapStatus = {
  Validating: 1,
  Playable: 2,
  Incompatible: 4,
  UnsafeCustomRules: 8,
} as const

export type MapStatus = number // bitfield, not a single enum value

/**
 * Server lifecycle state.
 *
 * OpenRA 对照: ServerState enum
 */
export const ServerState = {
  WaitingPlayers: 1,
  GameStarted: 2,
  ShuttingDown: 3,
} as const

export type ServerState = (typeof ServerState)[keyof typeof ServerState]

/**
 * Server hosting type.
 *
 * OpenRA 对照: ServerType enum
 */
export const ServerType = {
  Local: 0,
  Skirmish: 1,
  Multiplayer: 2,
  Dedicated: 3,
} as const

export type ServerType = (typeof ServerType)[keyof typeof ServerType]

// ---------------------------------------------------------------------------
// LobbyOptionState
// ---------------------------------------------------------------------------

/**
 * State for a single lobby option (game speed, tech level, etc.).
 *
 * OpenRA 对照: Session.LobbyOptionState
 */
export interface LobbyOptionState {
  id: string
  value: string
  isEnabled: boolean
  isLocked: boolean
  preferredValue: string
}

// ---------------------------------------------------------------------------
// SessionClient (对应 OpenRA Session.Client)
// ---------------------------------------------------------------------------

/**
 * Mutable server-side session client record.
 *
 * Unlike LobbyTypes.SessionClient (readonly, UI-focused), this class is MUTABLE
 * and used by the server to track client state during the lobby phase.
 *
 * OpenRA 对照: Session.Client
 */
export class SessionClient {
  index: number = 0
  name: string = 'Anonymous'
  ipAddress: string = ''
  anonymizedIPAddress?: string
  location?: string
  fingerprint?: string
  preferredColor: number = 0xFFFFFFFF
  color: number = 0xFFFFFFFF
  faction: string = 'Random'
  spawnPoint: number = 0
  team: number = 0
  handicap: number = 0
  slot: string | null = null
  bot: string | null = null
  botControllerClientIndex?: number
  isAdmin: boolean = false
  isObserver: boolean = true
  state: ClientState = ClientState.Invalid
  connectionQuality: ConnectionQuality = ConnectionQuality.Good

  /**
   * Whether this client is ready to start.
   *
   * OpenRA 对照: Session.Client.IsReady
   */
  get isReady(): boolean {
    return this.state === ClientState.Ready
  }

  /**
   * Whether this client is in Invalid state.
   *
   * OpenRA 对照: Session.Client.IsInvalid
   */
  get isInvalid(): boolean {
    return this.state === ClientState.Invalid
  }

  /**
   * Whether this client is a bot.
   *
   * OpenRA 对照: Session.Client.IsBot
   */
  get isBot(): boolean {
    return this.bot !== null
  }

  /**
   * Serialize to a plain object for JSON transmission.
   *
   * OpenRA 对照: Session.Client.Serialize() -> MiniYamlNode
   */
  serialize(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      Index: this.index,
      Name: this.name,
      PreferredColor: this.preferredColor,
      Color: this.color,
      Faction: this.faction,
      SpawnPoint: this.spawnPoint,
      Team: this.team,
      Handicap: this.handicap,
      State: this.state,
      IsAdmin: this.isAdmin,
      Slot: this.slot,
      Bot: this.bot,
      ConnectionQuality: this.connectionQuality,
    }

    if (this.ipAddress) result.IPAddress = this.ipAddress
    if (this.anonymizedIPAddress) result.AnonymizedIPAddress = this.anonymizedIPAddress
    if (this.location) result.Location = this.location
    if (this.fingerprint) result.Fingerprint = this.fingerprint
    if (this.botControllerClientIndex !== undefined)
      result.BotControllerClientIndex = this.botControllerClientIndex

    return result
  }

  /**
   * Deserialize from a plain object.
   *
   * OpenRA 对照: Session.Client.Deserialize(MiniYaml)
   */
  static deserialize(data: Record<string, unknown>): SessionClient {
    const c = new SessionClient()
    c.index = (data.Index as number) ?? 0
    c.name = (data.Name as string) ?? 'Anonymous'
    c.preferredColor = (data.PreferredColor as number) ?? 0xFFFFFFFF
    c.color = (data.Color as number) ?? 0xFFFFFFFF
    c.faction = (data.Faction as string) ?? 'Random'
    c.spawnPoint = (data.SpawnPoint as number) ?? 0
    c.team = (data.Team as number) ?? 0
    c.handicap = (data.Handicap as number) ?? 0
    c.state = (data.State as ClientState) ?? ClientState.Invalid
    c.isAdmin = Boolean(data.IsAdmin)
    c.slot = (data.Slot as string | null) ?? null
    c.bot = (data.Bot as string | null) ?? null
    c.connectionQuality = (data.ConnectionQuality as ConnectionQuality) ?? ConnectionQuality.Good

    if (data.IPAddress !== undefined) c.ipAddress = data.IPAddress as string
    if (data.AnonymizedIPAddress !== undefined) c.anonymizedIPAddress = data.AnonymizedIPAddress as string
    if (data.Location !== undefined) c.location = data.Location as string
    if (data.Fingerprint !== undefined) c.fingerprint = data.Fingerprint as string
    if (data.BotControllerClientIndex !== undefined)
      c.botControllerClientIndex = data.BotControllerClientIndex as number

    // Recompute isObserver from slot
    c.isObserver = c.slot === null

    return c
  }
}

// ---------------------------------------------------------------------------
// SessionSlot (对应 OpenRA Session.Slot)
// ---------------------------------------------------------------------------

/**
 * Session slot configuration for a player reference.
 *
 * OpenRA 对照: Session.Slot
 */
export class SessionSlot {
  playerReference: string = ''
  closed: boolean = false
  required: boolean = false
  locked: boolean = false
  lockFaction: boolean = false
  lockColor: boolean = false
  lockTeam: boolean = false
  lockSpawn: boolean = false
  lockHandicap: boolean = false
  allowBots: boolean = false

  /**
   * Serialize to a plain object for JSON transmission.
   *
   * OpenRA 对照: Session.Slot.Serialize() -> MiniYamlNode
   */
  serialize(): Record<string, unknown> {
    return {
      PlayerReference: this.playerReference,
      Closed: this.closed,
      Required: this.required,
      Locked: this.locked,
      LockFaction: this.lockFaction,
      LockColor: this.lockColor,
      LockTeam: this.lockTeam,
      LockSpawn: this.lockSpawn,
      LockHandicap: this.lockHandicap,
      AllowBots: this.allowBots,
    }
  }

  /**
   * Deserialize from a plain object.
   *
   * OpenRA 对照: Session.Slot.Deserialize(MiniYaml)
   */
  static deserialize(data: Record<string, unknown>): SessionSlot {
    const s = new SessionSlot()
    s.playerReference = (data.PlayerReference as string) ?? ''
    s.closed = Boolean(data.Closed)
    s.required = Boolean(data.Required)
    s.locked = Boolean(data.Locked)
    s.lockFaction = Boolean(data.LockFaction)
    s.lockColor = Boolean(data.LockColor)
    s.lockTeam = Boolean(data.LockTeam)
    s.lockSpawn = Boolean(data.LockSpawn)
    s.lockHandicap = Boolean(data.LockHandicap)
    s.allowBots = Boolean(data.AllowBots)
    return s
  }
}

// ---------------------------------------------------------------------------
// SessionGlobalSettings (对应 OpenRA Session.Global)
// ---------------------------------------------------------------------------

/**
 * Global lobby settings.
 *
 * OpenRA 对照: Session.Global
 */
export class SessionGlobalSettings {
  serverName: string = ''
  map: string = ''
  mapStatus: MapStatus = MapStatus.Playable
  randomSeed: number = 0
  allowSpectators: boolean = true
  gameUid: string = ''
  enableSingleplayer: boolean = false
  enableMapGeneration: boolean = false
  enableGameSaves: boolean = false
  enableSyncReports: boolean = false
  dedicated: boolean = false
  netFrameInterval: number = 3
  gameTimestep: number = 0
  lobbyOptions: Map<string, LobbyOptionState> = new Map()

  /**
   * Get a boolean lobby option with a default.
   *
   * OpenRA 对照: Session.Global.OptionOrDefault(string, bool)
   */
  optionOrDefault(key: string, defaultValue: boolean): boolean
  /**
   * Get a string lobby option with a default.
   *
   * OpenRA 对照: Session.Global.OptionOrDefault(string, string)
   */
  optionOrDefault(key: string, defaultValue: string): string
  optionOrDefault(key: string, defaultValue: boolean | string): boolean | string {
    const option = this.lobbyOptions.get(key)
    if (!option) return defaultValue

    if (typeof defaultValue === 'boolean') {
      return option.isEnabled
    }
    return option.value
  }

  /**
   * Serialize to a plain object for JSON transmission.
   *
   * OpenRA 对照: Session.Global.Serialize() -> MiniYamlNode
   */
  serialize(): Record<string, unknown> {
    const optionsObj: Record<string, unknown> = {}
    for (const [key, opt] of this.lobbyOptions) {
      optionsObj[key] = {
        Value: opt.value,
        PreferredValue: opt.preferredValue,
        IsLocked: opt.isLocked,
      }
    }

    return {
      ServerName: this.serverName,
      Map: this.map,
      MapStatus: this.mapStatus,
      RandomSeed: this.randomSeed,
      AllowSpectators: this.allowSpectators,
      GameUid: this.gameUid,
      EnableSingleplayer: this.enableSingleplayer,
      EnableMapGeneration: this.enableMapGeneration,
      EnableGameSaves: this.enableGameSaves,
      EnableSyncReports: this.enableSyncReports,
      Dedicated: this.dedicated,
      NetFrameInterval: this.netFrameInterval,
      GameTimestep: this.gameTimestep,
      Options: optionsObj,
    }
  }

  /**
   * Deserialize from a plain object.
   *
   * OpenRA 对照: Session.Global.Deserialize(MiniYaml)
   */
  static deserialize(data: Record<string, unknown>): SessionGlobalSettings {
    const gs = new SessionGlobalSettings()
    gs.serverName = (data.ServerName as string) ?? ''
    gs.map = (data.Map as string) ?? ''
    gs.mapStatus = (data.MapStatus as number) ?? MapStatus.Playable
    gs.randomSeed = (data.RandomSeed as number) ?? 0
    gs.allowSpectators = data.AllowSpectators !== undefined
      ? Boolean(data.AllowSpectators) : true
    gs.gameUid = (data.GameUid as string) ?? ''
    gs.enableSingleplayer = Boolean(data.EnableSingleplayer)
    gs.enableMapGeneration = Boolean(data.EnableMapGeneration)
    gs.enableGameSaves = Boolean(data.EnableGameSaves)
    gs.enableSyncReports = Boolean(data.EnableSyncReports)
    gs.dedicated = Boolean(data.Dedicated)
    gs.netFrameInterval = (data.NetFrameInterval as number) ?? 3
    gs.gameTimestep = (data.GameTimestep as number) ?? 0

    // Parse LobbyOptions
    const optionsData = data.Options as Record<string, Record<string, unknown>> | undefined
    if (optionsData) {
      for (const [key, optData] of Object.entries(optionsData)) {
        gs.lobbyOptions.set(key, {
          id: key,
          value: (optData.Value as string) ?? 'False',
          preferredValue: (optData.PreferredValue as string) ?? 'False',
          isEnabled: (optData.Value as string) === 'True',
          isLocked: Boolean(optData.IsLocked),
        })
      }
    }

    return gs
  }
}

// ---------------------------------------------------------------------------
// Session (对应 OpenRA Session)
// ---------------------------------------------------------------------------

/**
 * Complete lobby state: clients, slots, global settings.
 *
 * This is the server's single source of truth for the lobby. All modifications
 * happen synchronously (no locking needed in JS single-threaded runtime).
 *
 * OpenRA 对照: Session
 */
export class Session {
  globalSettings: SessionGlobalSettings = new SessionGlobalSettings()
  slots: Map<string, SessionSlot> = new Map()
  clients: SessionClient[] = []
  disabledSpawnPoints: Set<number> = new Set()

  /**
   * Non-bot clients (human players).
   *
   * OpenRA 对照: Session.NonBotClients
   */
  get nonBotClients(): SessionClient[] {
    return this.clients.filter((c) => c.bot === null)
  }

  /**
   * Non-bot clients occupying a slot (human players, not spectators).
   *
   * OpenRA 对照: Session.NonBotPlayers
   */
  get nonBotPlayers(): SessionClient[] {
    return this.clients.filter((c) => c.bot === null && c.slot !== null)
  }

  /**
   * Find the first empty slot (not closed, no client assigned).
   *
   * OpenRA 对照: Session.FirstEmptySlot()
   *
   * @returns slot key string, or null if all open slots are occupied
   */
  firstEmptySlot(): string | null {
    for (const [key, slot] of this.slots) {
      if (!slot.closed && !this.clientInSlot(key)) {
        return key
      }
    }
    return null
  }

  /**
   * Find a client by player index.
   *
   * OpenRA 对照: Session.ClientWithIndex(int)
   *
   * @returns the client, or undefined if not found
   */
  clientWithIndex(index: number): SessionClient | undefined {
    return this.clients.find((c) => c.index === index)
  }

  /**
   * Find the client occupying a specific slot.
   *
   * OpenRA 对照: Session.ClientInSlot(string)
   *
   * @returns the client, or undefined if the slot is empty
   */
  clientInSlot(slotKey: string): SessionClient | undefined {
    return this.clients.find((c) => c.slot === slotKey)
  }

  /**
   * Serialize the full session to a JSON string.
   *
   * OpenRA 对照: Session.Serialize() -> string (MiniYaml)
   */
  serialize(): string {
    const data: Record<string, unknown> = {
      Clients: this.clients.map((c) => c.serialize()),
      Slots: Array.from(this.slots.entries()).map(([key, slot]) => ({
        Key: key,
        ...slot.serialize(),
      })),
      GlobalSettings: this.globalSettings.serialize(),
      DisabledSpawnPoints: Array.from(this.disabledSpawnPoints),
    }
    return JSON.stringify(data)
  }

  /**
   * Deserialize a JSON string back into a Session.
   *
   * OpenRA 对照: Session.Deserialize(string, string)
   */
  static deserialize(json: string): Session {
    const session = new Session()
    try {
      const data = JSON.parse(json) as Record<string, unknown>

      // Parse clients
      const clientsData = data.Clients as Record<string, unknown>[] | undefined
      if (clientsData) {
        session.clients = clientsData.map((c) => SessionClient.deserialize(c))
      }

      // Parse slots
      const slotsData = data.Slots as ({ Key: string } & Record<string, unknown>)[] | undefined
      if (slotsData) {
        for (const s of slotsData) {
          const { Key, ...slotData } = s
          session.slots.set(Key as string, SessionSlot.deserialize(slotData))
        }
      }

      // Parse global settings
      const gsData = data.GlobalSettings as Record<string, unknown> | undefined
      if (gsData) {
        session.globalSettings = SessionGlobalSettings.deserialize(gsData)
      }

      // Parse disabled spawn points
      const dspData = data.DisabledSpawnPoints as number[] | undefined
      if (dspData) {
        session.disabledSpawnPoints = new Set(dspData)
      }
    } catch {
      // Return empty session on parse failure
    }
    return session
  }
}

// ---------------------------------------------------------------------------
// ServerSettings (server configuration)
// ---------------------------------------------------------------------------

/**
 * Server configuration settings.
 *
 * OpenRA 对照: OpenRA.ServerSettings class
 */
export interface ServerSettings {
  name: string
  listenPort: number
  password?: string
  recordReplays: boolean
  enableSingleplayer: boolean
  enableMapGeneration: boolean
  enableSyncReports: boolean
  enableGeoIP: boolean
  enableLintChecks: boolean
  shareAnonymizedIPs: boolean
  requireAuthentication: boolean
  ban: string[]
  profileIDWhitelist: number[]
  profileIDBlacklist: number[]
  floodLimitMessageCount: number
  floodLimitCooldown: number
  floodLimitInterval: number
  floodLimitJoinCooldown: number
  voteKickTimer: number
  voteKickerCooldown: number
  timestampFormat: string
}

// ---------------------------------------------------------------------------
// Default ServerSettings
// ---------------------------------------------------------------------------

/**
 * Default server settings values.
 */
export function defaultServerSettings(name?: string): ServerSettings {
  return {
    name: name ?? 'OpenRA Web Server',
    listenPort: 1234,
    password: undefined,
    recordReplays: false,
    enableSingleplayer: true,
    enableMapGeneration: false,
    enableSyncReports: false,
    enableGeoIP: false,
    enableLintChecks: false,
    shareAnonymizedIPs: false,
    requireAuthentication: false,
    ban: [],
    profileIDWhitelist: [],
    profileIDBlacklist: [],
    floodLimitMessageCount: 5,
    floodLimitCooldown: 5000,
    floodLimitInterval: 10000,
    floodLimitJoinCooldown: 1000,
    voteKickTimer: 30000,
    voteKickerCooldown: 60000,
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
  }
}

// ---------------------------------------------------------------------------
// HandshakeRequest / HandshakeResponse (forward ref types for Server.ts)
// ---------------------------------------------------------------------------

/**
 * Handshake request sent from server to client.
 *
 * OpenRA 对照: HandshakeRequest (HandshakeRequest.cs)
 */
export interface HandshakeRequestData {
  mod: string
  version: string
  authToken?: string
}

/**
 * Handshake response sent from client to server.
 *
 * OpenRA 对照: HandshakeResponse (HandshakeResponse.cs)
 */
export interface HandshakeResponseData {
  mod: string
  version: string
  ordersProtocol: number
  password?: string
  fingerprint?: string
  authSignature?: string
  client: {
    name: string
    preferredColor?: number
    color?: number
  }
}
