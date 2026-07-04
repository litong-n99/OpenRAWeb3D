/**
 * GameSave.ts — 游戏存档序列化/反序列化（含 SlotClient 内部类）
 * OpenRA 对照: OpenRA.Game/Network/GameSave.cs (333 lines)
 *
 * 核心范式转换:
 * - C# FileStream + BinaryWriter/BinaryReader → Uint8Array + DataView (内存二进制)
 * - C# MemoryStream ordersStream → Uint8Array 块数组（仅追加，save()时展平）
 * - C# BinaryWriter.WriteLengthPrefixedString(UTF8, ...) → TextEncoder + int32 LE 长度前缀
 * - C# MiniYaml.FromString / FieldLoader.Load → JSON.parse / fromJSON 工厂方法
 * - C# Session.Global.Deserialize / Serialize 往返深拷贝 → JSON.parse(JSON.stringify(...))
 * - C# FieldSaver.Save / FieldLoader.Load for SlotClient → toJSON/fromJSON
 * - C# server calls DispatchOrders/ParseOrders → LocalGameCoordinator 虚拟服务器模式
 * - C# Connection.PlayerIndex → GameSaveConnection.playerIndex (最小接口)
 * - C# MiniYaml trait data → JSON trait data (ADR-17.5)
 */

import { SYNC_HASH_ORDER_LENGTH } from './Order.js'
import { Order } from './Order.js'
import type { SessionClient } from '../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'
import type { SessionSlot } from '../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'
import type { SessionGlobal } from '../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'
import { MapGenerationArgs } from '../Map/MapGenerationArgs.js'

// ---------------------------------------------------------------------------
// Constants (对应 OpenRA GameSave const)
// ---------------------------------------------------------------------------

/** End-of-file sentinel marker.
 *
 * OpenRA 对照: GameSave.EOFMarker = -2
 */
export const EOF_MARKER = -2

/** Metadata section start marker.
 *
 * OpenRA 对照: GameSave.MetadataMarker = -1
 */
export const METADATA_MARKER = -1

/** Trait data section start marker.
 *
 * OpenRA 对照: GameSave.TraitDataMarker = -3
 */
export const TRAIT_DATA_MARKER = -3

/** Maximum length for a length-prefixed string in the save format.
 *
 * OpenRA 对照: Connection.MaxOrderLength = 131072
 */
const MAX_STRING_LENGTH = 131072

/** Size of an int32 in bytes. */
const INT32_SIZE = 4

// ---------------------------------------------------------------------------
// Internal binary I/O helpers
// ---------------------------------------------------------------------------

/**
 * Write a length-prefixed UTF-8 string to a buffer.
 *
 * OpenRA 对照: BinaryWriter.WriteLengthPrefixedString(Encoding.UTF8, str)
 *
 * Format: [length: int32 LE][UTF-8 bytes]
 *
 * @param buffer — target buffer
 * @param offset — write position in buffer
 * @param str — string to write (empty string is valid)
 * @returns number of bytes written (4 + encoded length)
 */
function writeLengthPrefixedString(
  buffer: Uint8Array,
  offset: number,
  str: string,
): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const encoded = new TextEncoder().encode(str)
  view.setInt32(offset, encoded.length, true)
  offset += INT32_SIZE
  buffer.set(encoded, offset)
  return INT32_SIZE + encoded.length
}

/**
 * Read a length-prefixed UTF-8 string from a buffer.
 *
 * OpenRA 对照: BinaryReader.ReadLengthPrefixedString(Encoding.UTF8, maxLength)
 *
 * @param buffer — source buffer
 * @param offset — read position in buffer (updated by this function)
 * @returns the decoded string
 */
function readLengthPrefixedString(
  buffer: Uint8Array,
  offsetRef: { value: number },
): string {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const length = view.getInt32(offsetRef.value, true)
  offsetRef.value += INT32_SIZE

  if (length < 0 || length > MAX_STRING_LENGTH) {
    throw new Error(
      `Invalid string length in save file: ${length} (max ${MAX_STRING_LENGTH})`,
    )
  }

  const bytes = buffer.subarray(offsetRef.value, offsetRef.value + length)
  offsetRef.value += length
  return new TextDecoder().decode(bytes)
}

/**
 * Calculate the number of bytes needed to write a length-prefixed string.
 */
function lengthPrefixedStringByteCount(str: string): number {
  const encoded = new TextEncoder().encode(str)
  return INT32_SIZE + encoded.length
}

// ---------------------------------------------------------------------------
// SlotClientColor — simple 8-bit RGBA color (对应 OpenRA Color struct)
// ---------------------------------------------------------------------------

/**
 * 8-bit RGBA color for SlotClient serialization.
 *
 * OpenRA 对照: OpenRA.Primitives.Color (R, G, B, A byte fields)
 */
export interface SlotClientColor {
  r: number
  g: number
  b: number
  a: number
}

// ---------------------------------------------------------------------------
// Minimal interfaces for GameSave dependencies
// ---------------------------------------------------------------------------

/**
 * Minimal connection interface for dispatchOrders.
 *
 * OpenRA 对照: Server.Connection.PlayerIndex
 */
export interface GameSaveConnection {
  readonly playerIndex: number
}

/**
 * Minimal mutable client interface for SlotClient.applyTo.
 *
 * OpenRA 对照: Session.Client (mutable properties)
 */
export interface MutableSessionClient {
  color: string
  faction: string
  spawnPoint: number
  team: number
  handicap: number
  slot: string | null
  bot: string | null
  isAdmin: boolean
  name: string
}

/**
 * Extended client interface for bot remapping in parseOrders.
 *
 * OpenRA 对照: Session.Client with BotControllerClientIndex
 */
interface SessionClientWithBot extends SessionClient {
  readonly botControllerClientIndex?: number
}

/**
 * Minimal lobby info interface for GameSave methods.
 *
 * OpenRA 对照: Session (lobby state)
 *
 * Provides the subset of Session methods that GameSave depends on:
 * slot iteration, client lookup, and global settings access.
 */
export interface GameSaveLobbyInfo {
  readonly globalSettings: SessionGlobal
  readonly slots: ReadonlyMap<string, SessionSlot>
  readonly clients: readonly SessionClient[]
  clientInSlot(slotKey: string): SessionClient | undefined
  clientWithIndex(index: number): SessionClientWithBot | undefined
}

/**
 * Minimal map preview interface for startGame.
 *
 * OpenRA 对照: MapPreview (subset)
 */
export interface GameSaveMapPreview {
  readonly class: string
  readonly generationArgs?: unknown
  readonly players: {
    readonly players: ReadonlyMap<
      string,
      { readonly playable: boolean; readonly allowBots: boolean }
    >
  }
}

// ---------------------------------------------------------------------------
// SlotClient (对应 OpenRA SlotClient 内部类)
// ---------------------------------------------------------------------------

/**
 * 表示游戏存档中保存的玩家槽位配置。
 *
 * OpenRA 对照: SlotClient class (inner class of GameSave)
 *
 * 仅包含游戏相关的字段（阵营、团队、颜色、出生点），
 * 不包含大厅管理状态（就绪、连接质量等），这些在加载时
 * 由服务器或 LocalGameCoordinator 重新分配。
 *
 * Bot 名称仅在 Bot 类型非空时保存（对应 C# 构造函数中的条件赋值）。
 */
export class SlotClient {
  /** Player color (8-bit per channel).
   *
   * OpenRA 对照: SlotClient.Color
   */
  color: SlotClientColor

  /** Faction internal name.
   *
   * OpenRA 对照: SlotClient.Faction
   */
  faction: string

  /** Spawn point index.
   *
   * OpenRA 对照: SlotClient.SpawnPoint
   */
  spawnPoint: number

  /** Team number (0 = no team).
   *
   * OpenRA 对照: SlotClient.Team
   */
  team: number

  /** Handicap percentage (0-100).
   *
   * OpenRA 对照: SlotClient.Handicap
   */
  handicap: number

  /** Slot key string (e.g., "Multi0", "Multi1").
   *
   * OpenRA 对照: SlotClient.Slot
   */
  slot: string

  /** Bot type identifier, or null for human players.
   *
   * OpenRA 对照: SlotClient.Bot
   */
  bot: string | null

  /** Whether this player is a lobby admin.
   *
   * OpenRA 对照: SlotClient.IsAdmin
   */
  isAdmin: boolean

  /** Bot display name (only meaningful when Bot is not null).
   *
   * OpenRA 对照: SlotClient.BotName
   */
  botName: string

  /**
   * Create a SlotClient with default values.
   *
   * OpenRA 对照: SlotClient() (parameterless constructor)
   */
  constructor()

  /**
   * Create a SlotClient from a Session.Client.
   *
   * OpenRA 对照: SlotClient(Session.Client client)
   *
   * Copies the game-relevant fields from the lobby client.
   * If the client represents a bot (client.bot !== null),
   * also stores the bot's display name.
   *
   * @param client — the lobby session client to copy from
   */
  constructor(client: SessionClient)

  constructor(client?: SessionClient) {
    if (client) {
      this.color = parseColor(client.color)
      this.faction = client.faction
      this.spawnPoint = client.spawnPoint
      this.team = client.team
      this.handicap = client.handicap
      this.slot = client.slot ?? ''
      this.bot = client.bot ?? null
      this.isAdmin = client.isAdmin

      if (client.bot !== null) {
        this.botName = client.name
      } else {
        this.botName = ''
      }
    } else {
      this.color = { r: 0, g: 0, b: 0, a: 255 }
      this.faction = ''
      this.spawnPoint = 0
      this.team = 0
      this.handicap = 0
      this.slot = ''
      this.bot = null
      this.isAdmin = false
      this.botName = ''
    }
  }

  /**
   * Copy this SlotClient's state back to a Session.Client.
   *
   * OpenRA 对照: SlotClient.ApplyTo(Session.Client client)
   *
   * Reverses the extraction in the Session.Client constructor:
   * overwrites the client's game-relevant fields with the saved values.
   * Bot name is only copied if Bot is not null.
   *
   * @param client — mutable client object to update
   */
  applyTo(client: MutableSessionClient): void {
    client.color = colorToString(this.color)
    client.faction = this.faction
    client.spawnPoint = this.spawnPoint
    client.team = this.team
    client.handicap = this.handicap
    client.slot = this.slot
    client.bot = this.bot
    client.isAdmin = this.isAdmin

    if (this.bot !== null) {
      client.name = this.botName
    }
  }

  /**
   * Deserialize a SlotClient from a JSON-compatible object.
   *
   * OpenRA 对照: SlotClient.Deserialize(MiniYaml data)
   *
   * @param data — plain object with SlotClient properties
   * @returns a new SlotClient instance
   */
  static deserialize(data: Record<string, unknown>): SlotClient {
    const sc = new SlotClient()
    sc.color = parseColorObject(data.color)
    sc.faction = (data.faction as string) ?? ''
    sc.spawnPoint = (data.spawnPoint as number) ?? 0
    sc.team = (data.team as number) ?? 0
    sc.handicap = (data.handicap as number) ?? 0
    sc.slot = (data.slot as string) ?? ''
    sc.bot = (data.bot as string) ?? null
    sc.isAdmin = (data.isAdmin as boolean) ?? false
    sc.botName = (data.botName as string) ?? ''
    return sc
  }

  /**
   * Serialize this SlotClient to a JSON-compatible key-value pair.
   *
   * OpenRA 对照: SlotClient.Serialize(string key) → MiniYamlNode
   *
   * The key is formatted as "SlotClient@{key}" to match OpenRA's naming.
   *
   * @param key — the slot key (e.g., "Multi0")
   * @returns an object with `key` and `value` properties (JSON-compatible)
   */
  serialize(key: string): { key: string; value: Record<string, unknown> } {
    return {
      key: `SlotClient@${key}`,
      value: this.toJSON(),
    }
  }

  /**
   * Convert to a plain JSON-compatible object.
   *
   * OpenRA 对照: FieldSaver.Save(this)
   */
  toJSON(): Record<string, unknown> {
    return {
      color: this.color,
      faction: this.faction,
      spawnPoint: this.spawnPoint,
      team: this.team,
      handicap: this.handicap,
      slot: this.slot,
      bot: this.bot,
      isAdmin: this.isAdmin,
      botName: this.botName,
    }
  }
}

// ---------------------------------------------------------------------------
// Color conversion helpers (对应 OpenRA Color <-> string)
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string (e.g., "#FF0000" or "FF0000") to a SlotClientColor.
 *
 * OpenRA 对照: Color.FromArgb / ColorTranslator
 */
function parseColor(hex: string): SlotClientColor {
  const clean = hex.replace('#', '')
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
      a: 255,
    }
  }
  if (clean.length === 8) {
    return {
      r: parseInt(clean.substring(2, 4), 16),
      g: parseInt(clean.substring(4, 6), 16),
      b: parseInt(clean.substring(6, 8), 16),
      a: parseInt(clean.substring(0, 2), 16),
    }
  }
  return { r: 0, g: 0, b: 0, a: 255 }
}

/**
 * Parse a color object (r,g,b,a fields) from JSON/unknown input.
 */
function parseColorObject(data: unknown): SlotClientColor {
  if (typeof data === 'object' && data !== null) {
    const c = data as Record<string, unknown>
    return {
      r: (c.r as number) ?? 0,
      g: (c.g as number) ?? 0,
      b: (c.b as number) ?? 0,
      a: (c.a as number) ?? 255,
    }
  }
  if (typeof data === 'string') {
    return parseColor(data)
  }
  return { r: 0, g: 0, b: 0, a: 255 }
}

/**
 * Convert a SlotClientColor to a hex string (e.g., "#RRGGBB").
 */
function colorToString(color: SlotClientColor): string {
  const r = color.r.toString(16).padStart(2, '0')
  const g = color.g.toString(16).padStart(2, '0')
  const b = color.b.toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

// ---------------------------------------------------------------------------
// GameSave (对应 OpenRA GameSave)
// ---------------------------------------------------------------------------

/**
 * 完整的游戏存档序列化/反序列化引擎。
 *
 * OpenRA 对照: GameSave class
 *
 * 处理 .orasav 二进制格式，包含三个由标记哨兵分隔的部分：
 * 1. 原始网络帧数据的订单流（可变长度）
 * 2. 元数据部分（大厅设置、槽位、槽位客户端、地图参数）
 * 3. 特性数据部分（每个特性的自定义数据，以 trait 索引为键）
 * 4. 尾部（最后 12 字节）：[ordersStreamLength: int32][traitDataOffset: int32][EOFMarker: int32]
 *
 * 所有文件 I/O 均在内存中通过 Uint8Array 完成。
 * 调用方负责持久化（IndexedDB、Blob 下载等）。
 */
export class GameSave {
  // ---------------------------------------------------------------------------
  // Public constants (对应 OpenRA const int)
  // ---------------------------------------------------------------------------

  /** EOF sentinel value for the binary footer. */
  static readonly EOFMarker = EOF_MARKER

  /** Metadata section start sentinel. */
  static readonly MetadataMarker = METADATA_MARKER

  /** Trait data section start sentinel. */
  static readonly TraitDataMarker = TRAIT_DATA_MARKER

  // ---------------------------------------------------------------------------
  // Core state (loaded from file or set during gameplay)
  // ---------------------------------------------------------------------------

  /** Last frame number containing orders in the stream.
   *
   * OpenRA 对照: GameSave.LastOrdersFrame
   *
   * Initialized to -1 for an empty save.
   */
  LastOrdersFrame: number

  /** Last frame number containing a sync hash update.
   *
   * OpenRA 对照: GameSave.LastSyncFrame
   *
   * Initialized to -1.
   */
  LastSyncFrame: number

  /** Lobby global settings snapshot (deep-cloned at game start).
   *
   * OpenRA 对照: GameSave.GlobalSettings
   */
  GlobalSettings: SessionGlobal | null

  /** Lobby slot configuration snapshot (deep-cloned at game start).
   *
   * OpenRA 对照: GameSave.Slots
   */
  Slots: Map<string, SessionSlot>

  /** Slot client data snapshot (game-relevant fields only).
   *
   * OpenRA 对照: GameSave.SlotClients
   */
  SlotClients: Map<string, SlotClient>

  /** Trait-specific data keyed by trait index.
   *
   * OpenRA 对照: GameSave.TraitData (Dictionary<int, MiniYaml>)
   *
   * Values are JSON-compatible objects (ADR-17.5: JSON replaces MiniYaml).
   */
  TraitData: Map<number, unknown>

  /** Map generation args for procedurally-generated maps.
   *
   * OpenRA 对照: GameSave.MapGenerationArgs
   */
  MapGenerationArgs?: MapGenerationArgs | undefined

  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  /**
   * Last sync packet bytes (length = SYNC_HASH_ORDER_LENGTH = 13).
   *
   * OpenRA 对照: lastSyncPacket byte[]
   */
  private _lastSyncPacket: Uint8Array

  /**
   * Append-only orders stream as binary chunks.
   *
   * Each chunk is a self-contained order entry:
   * [totalLength: int32 LE][frame: int32 LE][clientSlot: int32 LE][data: bytes]
   *
   * OpenRA 对照: ordersStream (MemoryStream)
   *
   * Using a chunks array avoids repeated reallocation on append.
   * Total stream length is the sum of all chunk lengths.
   */
  private _ordersChunks: Uint8Array[] = []

  /**
   * Sum of all _ordersChunks byte lengths.
   */
  private _ordersTotalLength = 0

  /**
   * Maps slot index → client index.
   * Index into this array is the slot position; value is the client index.
   * -1 for spectators (non-playable slots).
   *
   * OpenRA 对照: clientsBySlotIndex int[]
   */
  private _clientsBySlotIndex: number[] = []

  /**
   * The first bot client's slot index (for spectator-to-bot order remapping HACK).
   * -1 if no bot clients.
   *
   * OpenRA 对照: firstBotSlotIndex
   */
  private _firstBotSlotIndex = -1

  // ---------------------------------------------------------------------------
  // Constructors
  // ---------------------------------------------------------------------------

  /**
   * Create an empty game save.
   *
   * OpenRA 对照: GameSave()
   *
   * LastOrdersFrame is initialized to -1, LastSyncFrame to -1.
   * Slots and SlotClients are empty. ordersStream has zero length.
   */
  constructor()

  /**
   * Load a game save from a binary .orasav buffer.
   *
   * OpenRA 对照: GameSave(string filepath)
   *
   * Parses the binary format:
   * 1. Reads footer (last 12 bytes) to locate metadata and trait data sections
   * 2. Reads metadata section: frame numbers, sync packet, lobby settings
   * 3. Reads trait data section
   * 4. Copies orders section (bytes 0..metadataOffset) into the stream
   *
   * Throws if EOFMarker is missing or markers are invalid.
   *
   * @param filepath — virtual file path (for error messages only)
   * @param data — the complete .orasav file contents as ArrayBuffer
   */
  constructor(filepath: string, data: ArrayBuffer)

  constructor(filepath?: string, data?: ArrayBuffer)

  constructor(filepath?: string, data?: ArrayBuffer) {
    this.LastOrdersFrame = -1
    this.LastSyncFrame = -1
    this._lastSyncPacket = new Uint8Array(SYNC_HASH_ORDER_LENGTH)
    this.GlobalSettings = null
    this.Slots = new Map()
    this.SlotClients = new Map()
    this.TraitData = new Map()
    this.MapGenerationArgs = undefined

    if (filepath !== undefined && data !== undefined) {
      this._loadFromBuffer(filepath, data)
    }
  }

  /**
   * Internal: parse a binary .orasav buffer into this GameSave instance.
   */
  private _loadFromBuffer(_filepath: string, data: ArrayBuffer): void {
    const buffer = new Uint8Array(data)
    const view = new DataView(data)

    if (buffer.length < 12) {
      throw new Error(`Invalid orasav file: too small (${buffer.length} bytes)`)
    }

    // Read footer: last 12 bytes
    const footerStart = buffer.length - 12
    const metadataOffset = view.getInt32(footerStart, true)
    const traitDataOffset = view.getInt32(footerStart + 4, true)
    const eofMarker = view.getInt32(footerStart + 8, true)

    if (eofMarker !== EOF_MARKER) {
      throw new Error(
        `Invalid orasav file: missing EOF marker (got ${eofMarker}, expected ${EOF_MARKER})`,
      )
    }

    // Read metadata section
    const metaOff = { value: metadataOffset }
    const metaMarker = view.getInt32(metaOff.value, true)
    metaOff.value += INT32_SIZE

    if (metaMarker !== METADATA_MARKER) {
      throw new Error(
        `Invalid orasav file: missing metadata marker (got ${metaMarker}, expected ${METADATA_MARKER})`,
      )
    }

    this.LastOrdersFrame = view.getInt32(metaOff.value, true)
    metaOff.value += INT32_SIZE

    this.LastSyncFrame = view.getInt32(metaOff.value, true)
    metaOff.value += INT32_SIZE

    // Read sync packet
    this._lastSyncPacket = buffer.subarray(
      metaOff.value,
      metaOff.value + SYNC_HASH_ORDER_LENGTH,
    )
    metaOff.value += SYNC_HASH_ORDER_LENGTH

    // Read global settings
    const globalSettingsStr = readLengthPrefixedString(buffer, metaOff)
    this.GlobalSettings = JSON.parse(globalSettingsStr) as SessionGlobal

    // Read slots
    const slotsStr = readLengthPrefixedString(buffer, metaOff)
    this.Slots = new Map()
    const slotsObj = JSON.parse(slotsStr) as Record<string, SessionSlot>
    for (const [key, value] of Object.entries(slotsObj)) {
      this.Slots.set(key, value as SessionSlot)
    }

    // Read slot clients
    const slotClientsStr = readLengthPrefixedString(buffer, metaOff)
    this.SlotClients = new Map()
    const slotClientsObj = JSON.parse(slotClientsStr) as Record<
      string,
      Record<string, unknown>
    >
    for (const [_key, value] of Object.entries(slotClientsObj)) {
      const sc = SlotClient.deserialize(value)
      this.SlotClients.set(sc.slot, sc)
    }

    // Read map generation args (may be empty)
    const mapGenArgsStr = readLengthPrefixedString(buffer, metaOff)
    if (mapGenArgsStr.length > 0) {
      this.MapGenerationArgs = parseMapGenerationArgs(
        JSON.parse(mapGenArgsStr) as Record<string, unknown>,
      )
    }

    // Verify trait data section position
    if (metaOff.value !== traitDataOffset) {
      throw new Error(
        `Invalid orasav file: metadata section ends at ${metaOff.value} but trait data offset is ${traitDataOffset}`,
      )
    }

    const traitMarker = view.getInt32(metaOff.value, true)
    metaOff.value += INT32_SIZE

    if (traitMarker !== TRAIT_DATA_MARKER) {
      throw new Error(
        `Invalid orasav file: missing trait data marker (got ${traitMarker}, expected ${TRAIT_DATA_MARKER})`,
      )
    }

    // Read trait data
    const traitDataStr = readLengthPrefixedString(buffer, metaOff)
    if (traitDataStr.length > 0) {
      const traitDataObj = JSON.parse(traitDataStr) as Record<string, unknown>
      for (const [key, value] of Object.entries(traitDataObj)) {
        const index = parseInt(key, 10)
        if (!isNaN(index)) {
          this.TraitData.set(index, value)
        }
      }
    }

    // Copy orders section (bytes 0..metadataOffset) into stream
    const ordersBytes = buffer.subarray(0, metadataOffset)
    if (ordersBytes.length > 0) {
      this._ordersChunks = [ordersBytes]
      this._ordersTotalLength = ordersBytes.length
    }
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle methods
  // ---------------------------------------------------------------------------

  /**
   * Initialize the game save with lobby configuration.
   *
   * OpenRA 对照: GameSave.StartGame(Session lobbyInfo, MapPreview map)
   *
   * Called when the game starts. Performs:
   * 1. Stores MapGenerationArgs for generated maps
   * 2. Builds clientsBySlotIndex (slot key → client index mapping)
   * 3. Deep-clones GlobalSettings, Slots, and SlotClients from lobby info
   * 4. Identifies firstBotSlotIndex for bot order remapping HACK
   * 5. Skips non-playable player references
   *
   * @param lobbyInfo — the current lobby session state
   * @param map — the map being played
   */
  startGame(
    lobbyInfo: GameSaveLobbyInfo,
    map: GameSaveMapPreview,
  ): void {
    // Store map generation args for generated maps
    if (map.class === 'Generated' && map.generationArgs) {
      this.MapGenerationArgs = map.generationArgs as MapGenerationArgs
    }

    // Build clientsBySlotIndex: maps slot key → client index
    this._clientsBySlotIndex = Array.from(lobbyInfo.slots.keys()).map((s) => {
      const client = lobbyInfo.clientInSlot(s)
      return client ? client.index : -1
    })

    // Deep-clone GlobalSettings via JSON round-trip
    this.GlobalSettings = JSON.parse(
      JSON.stringify(lobbyInfo.globalSettings),
    ) as SessionGlobal

    // Deep-clone slots and slot clients
    this.Slots = new Map()
    this.SlotClients = new Map()

    for (const [slotKey, slot] of lobbyInfo.slots) {
      // Deep-clone slot via JSON round-trip
      this.Slots.set(
        slotKey,
        JSON.parse(JSON.stringify(slot)) as SessionSlot,
      )

      const playerReference = map.players.players.get(slot.playerReference)
      const client = lobbyInfo.clientInSlot(slotKey)

      // Only save the client state relevant to the game (faction, team, etc).
      // Admin and bot controller state is inherited and/or reassigned by the
      // server at load time
      if (playerReference?.playable && client) {
        this.SlotClients.set(slotKey, new SlotClient(client))

        // See HACK comment in DispatchOrders about reassigning bot orders
        if (client.bot !== null && this._firstBotSlotIndex < 0) {
          this._firstBotSlotIndex = this._clientsBySlotIndex.indexOf(
            client.index,
          )
        }
      }
    }
  }

  /**
   * Record a network order into the save stream.
   *
   * OpenRA 对照: GameSave.DispatchOrders(Connection conn, int frame, byte[] data)
   *
   * Handles:
   * - Sync packet updates (only the latest sync hash is kept)
   * - Frame deduplication (skips orders with frame <= LastOrdersFrame)
   * - Immediate order filtering (skips 0xFE prefix orders)
   * - Client-to-slot mapping via clientsBySlotIndex
   * - HACK: Spectator bot order remapping to firstBotSlotIndex
   *
   * @param conn — the sending connection
   * @param frame — the frame number of this order
   * @param data — the raw order data bytes (may include frame prefix)
   */
  dispatchOrders(
    conn: GameSaveConnection,
    frame: number,
    data: Uint8Array,
  ): void {
    // Sync packet - we only care about the last value
    if (
      data.length > 0 &&
      data[0] === 0x65 && // OrderType.SyncHash
      frame > this.LastSyncFrame
    ) {
      if (data.length !== SYNC_HASH_ORDER_LENGTH) {
        console.debug(
          `Dropped sync order with length ${data.length}. Expected length ${SYNC_HASH_ORDER_LENGTH}.`,
        )
        return
      }

      this.LastSyncFrame = frame
      this._lastSyncPacket = new Uint8Array(data)
      // NOTE: C# GameSave.cs line 210-212 intentionally falls through to
      // order recording after sync packet handling (no `return`).
      // Sync packets are recorded as orders in the replay stream.
    }

    if (frame <= this.LastOrdersFrame) return

    // Ignore immediate orders
    if (data.length > 0 && data[0] === 0xfe) return

    let clientSlot = this._clientsBySlotIndex.indexOf(conn.playerIndex)

    // Handle orders that were sent by spectators
    if (clientSlot === -1) {
      // HACK: Assume that this is a bot order sent by its controller client
      // who is a spectator. The network data doesn't contain enough information
      // for us to confirm this, or to know which bot this is supposed to belong to...
      //
      // For skirmish games it is sufficient to map everything to the first bot,
      // because even if the bot choice is wrong, the bot-to-client remapping in ParseOrders
      // will give the right client as there is only one human client to choose from!
      // TODO: This will need to be fixed properly before implementing multiplayer saves
      clientSlot = this._firstBotSlotIndex
    }

    if (clientSlot < 0) return // No valid slot for this order

    // Write to orders stream: [totalLength: int32 LE][frame: int32 LE][clientSlot: int32 LE][data: bytes]
    const headerSize = 12 // 3 x int32
    const chunkLength = headerSize + data.length
    const chunk = new Uint8Array(chunkLength)
    const chunkView = new DataView(chunk.buffer)

    chunkView.setInt32(0, data.length + 8, true) // total length
    chunkView.setInt32(4, frame, true) // frame
    chunkView.setInt32(8, clientSlot, true) // client slot
    chunk.set(data, headerSize)

    this._ordersChunks.push(chunk)
    this._ordersTotalLength += chunkLength
    this.LastOrdersFrame = frame
  }

  /**
   * Replay all saved orders and trait data through a callback.
   *
   * OpenRA 对照: GameSave.ParseOrders(Session lobbyInfo, Action<int,int,byte[]> packetFn)
   *
   * Order of emission:
   * 1. All trait data entries as "SaveTraitData" orders (frame 0, immediate)
   * 2. All saved frame orders in sequence, with bot-client remapping
   * 3. The last sync packet to validate restore
   *
   * Bot orders are remapped to their controller client via
   * client.BotControllerClientIndex when available.
   *
   * @param lobbyInfo — the lobby state for client/slot resolution
   * @param packetFn — callback receiving (frame, clientIndex, serializedOrderData)
   */
  parseOrders(
    lobbyInfo: GameSaveLobbyInfo,
    packetFn: (frame: number, clientIndex: number, data: Uint8Array) => void,
  ): void {
    // Send the trait data first to guarantee that it is available when needed
    for (const [traitIndex, traitValue] of this.TraitData) {
      const data = JSON.stringify({
        [traitIndex.toString()]: traitValue,
      })
      const traitOrder = Order.fromTargetString(
        'SaveTraitData',
        data,
        true,
      )
      packetFn(0, 0, traitOrder.serialize())
    }

    // Replay all frame orders
    for (const chunk of this._ordersChunks) {
      const chunkView = new DataView(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength,
      )

      const totalLength = chunkView.getInt32(0, true)
      const dataLength = totalLength - 8
      const frame = chunkView.getInt32(4, true)
      const slot = chunkView.getInt32(8, true)
      const orderData = chunk.subarray(12, 12 + dataLength)

      // Remap bot orders to their controller client
      let clientIndex = this._clientsBySlotIndex[slot]
      if (clientIndex !== undefined) {
        const client = lobbyInfo.clientWithIndex(clientIndex)
        if (client?.bot !== null && client?.bot !== undefined) {
          clientIndex = client.botControllerClientIndex ?? clientIndex
        }
      }

      packetFn(frame, clientIndex, orderData)
    }

    // Send sync hash to validate restore
    if (this._lastSyncPacket.length > 0) {
      packetFn(this.LastSyncFrame, 0, this._lastSyncPacket)
    }
  }

  /**
   * Store trait-specific data for later restoration.
   *
   * OpenRA 对照: GameSave.AddTraitData(int traitIndex, MiniYaml data)
   *
   * Called by game world code when collecting IGameSaveTraitData
   * from actors before a save. The data is stored as JSON-compatible
   * values (ADR-17.5).
   *
   * @param traitIndex — the trait's unique index
   * @param data — JSON-compatible trait data
   */
  addTraitData(traitIndex: number, data: unknown): void {
    this.TraitData.set(traitIndex, data)
  }

  // ---------------------------------------------------------------------------
  // Serialization (对应 OpenRA Save)
  // ---------------------------------------------------------------------------

  /**
   * Serialize the complete game save to a binary .orasav buffer.
   *
   * OpenRA 对照: GameSave.Save(string path)
   *
   * File format:
   * ```
   * [orders stream bytes (variable)]
   * [MetadataMarker: int32 LE = -1]
   * [LastOrdersFrame: int32 LE]
   * [LastSyncFrame: int32 LE]
   * [lastSyncPacket: SYNC_HASH_ORDER_LENGTH bytes]
   * [length-prefixed UTF-8: globalSettings JSON]
   * [length-prefixed UTF-8: slots JSON (Map<string, SessionSlot>)]
   * [length-prefixed UTF-8: slotClients JSON (Map<string, SlotClient JSON>)]
   * [length-prefixed UTF-8: mapGenerationArgs JSON (or empty string)]
   * [TraitDataMarker: int32 LE = -3]
   * [length-prefixed UTF-8: traitData JSON (Map<number, any>)]
   * [ordersStream.length: int32 LE]
   * [traitDataOffset: int32 LE]
   * [EOFMarker: int32 LE = -2]
   * ```
   *
   * All multi-byte values use little-endian encoding to match C# BinaryWriter.
   *
   * @returns the complete .orasav file as a Uint8Array
   */
  save(): Uint8Array {
    // Pre-serialize all strings to compute sizes
    const globalSettingsJson = JSON.stringify(this.GlobalSettings ?? {})

    const slotsObj: Record<string, SessionSlot> = {}
    for (const [key, slot] of this.Slots) {
      slotsObj[key] = slot
    }
    const slotsJson = JSON.stringify(slotsObj)

    const slotClientsObj: Record<string, Record<string, unknown>> = {}
    for (const [key, sc] of this.SlotClients) {
      const serialized = sc.serialize(key)
      slotClientsObj[serialized.key] = serialized.value
    }
    const slotClientsJson = JSON.stringify(slotClientsObj)

    const mapGenArgsJson = this.MapGenerationArgs
      ? JSON.stringify(
          Object.fromEntries(
            this.MapGenerationArgs.serialize().map((kv) => [kv.key, kv.value]),
          ),
        )
      : ''

    const traitDataObj: Record<string, unknown> = {}
    for (const [key, value] of this.TraitData) {
      traitDataObj[key.toString()] = value
    }
    const traitDataJson = JSON.stringify(traitDataObj)

    // Calculate sizes for metadata section
    let metadataSectionSize =
      INT32_SIZE + // MetadataMarker
      INT32_SIZE + // LastOrdersFrame
      INT32_SIZE + // LastSyncFrame
      SYNC_HASH_ORDER_LENGTH + // lastSyncPacket
      lengthPrefixedStringByteCount(globalSettingsJson) +
      lengthPrefixedStringByteCount(slotsJson) +
      lengthPrefixedStringByteCount(slotClientsJson) +
      lengthPrefixedStringByteCount(mapGenArgsJson)

    // Trait data section
    const traitDataSectionSize =
      INT32_SIZE + // TraitDataMarker
      lengthPrefixedStringByteCount(traitDataJson)

    // Footer
    const footerSize = 12 // ordersStreamLength: int32 + traitDataOffset: int32 + EOFMarker: int32

    // Calculate trait data offset (position where TraitDataMarker is written)
    const ordersLength = this._ordersTotalLength
    const traitDataOffset = ordersLength + metadataSectionSize

    const totalSize = ordersLength + metadataSectionSize + traitDataSectionSize + footerSize

    // Allocate output buffer
    const buffer = new Uint8Array(totalSize)
    const view = new DataView(buffer.buffer)
    let offset = 0

    // Write orders stream
    for (const chunk of this._ordersChunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    // Write metadata section
    view.setInt32(offset, METADATA_MARKER, true)
    offset += INT32_SIZE

    view.setInt32(offset, this.LastOrdersFrame, true)
    offset += INT32_SIZE

    view.setInt32(offset, this.LastSyncFrame, true)
    offset += INT32_SIZE

    // Write last sync packet
    if (this._lastSyncPacket.length > 0) {
      buffer.set(this._lastSyncPacket, offset)
    }
    offset += SYNC_HASH_ORDER_LENGTH

    // Write length-prefixed strings
    offset += writeLengthPrefixedString(buffer, offset, globalSettingsJson)
    offset += writeLengthPrefixedString(buffer, offset, slotsJson)
    offset += writeLengthPrefixedString(buffer, offset, slotClientsJson)
    offset += writeLengthPrefixedString(buffer, offset, mapGenArgsJson)

    // Verify trait data offset
    if (offset !== traitDataOffset) {
      throw new Error(
        `Internal error: trait data offset mismatch (expected ${traitDataOffset}, actual ${offset})`,
      )
    }

    // Write trait data section
    view.setInt32(offset, TRAIT_DATA_MARKER, true)
    offset += INT32_SIZE

    offset += writeLengthPrefixedString(buffer, offset, traitDataJson)

    // Write footer
    view.setInt32(offset, ordersLength, true)
    offset += INT32_SIZE

    view.setInt32(offset, traitDataOffset, true)
    offset += INT32_SIZE

    view.setInt32(offset, EOF_MARKER, true)
    // offset += INT32_SIZE (not needed, final write)

    return buffer
  }

  // ---------------------------------------------------------------------------
  // Query / introspection
  // ---------------------------------------------------------------------------

  /**
   * Total length of the orders stream (for testing/inspection).
   *
   * OpenRA 对照: ordersStream.Length
   */
  get ordersStreamLength(): number {
    return this._ordersTotalLength
  }

  /**
   * Number of order chunks in the stream (for testing/inspection).
   */
  get ordersChunkCount(): number {
    return this._ordersChunks.length
  }

  /**
   * Clients-by-slot-index mapping (for testing).
   */
  get clientsBySlotIndex(): readonly number[] {
    return this._clientsBySlotIndex
  }

  /**
   * First bot slot index (for testing).
   */
  get firstBotSlotIndex(): number {
    return this._firstBotSlotIndex
  }

  /**
   * The last sync packet bytes (for testing).
   */
  get lastSyncPacket(): Uint8Array {
    return this._lastSyncPacket
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse MapGenerationArgs from a parsed JSON object.
 *
 * OpenRA 对照: FieldLoader.Load<MapGenerationArgs>(MiniYaml)
 */
function parseMapGenerationArgs(
  data: Record<string, unknown>,
): MapGenerationArgs {
  return new MapGenerationArgs({
    uid: (data.uid as string) ?? (data.Uid as string) ?? '',
    generator: (data.generator as string) ?? (data.Generator as string) ?? '',
    tileset: (data.tileset as string) ?? (data.Tileset as string) ?? '',
    size: parseSize(data.size ?? data.Size),
    title: (data.title as string) ?? (data.Title as string) ?? '',
    author: (data.author as string) ?? (data.Author as string) ?? '',
    settings: data.settings ?? data.Settings,
  })
}

/**
 * Parse a Size object from unknown input.
 */
function parseSize(
  value: unknown,
): { width: number; height: number } {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return {
      width: (obj.width as number) ?? (obj.Width as number) ?? 0,
      height: (obj.height as number) ?? (obj.Height as number) ?? 0,
    }
  }
  return { width: 0, height: 0 }
}
