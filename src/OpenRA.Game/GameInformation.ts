/**
 * GameInformation.ts — 游戏元数据的数据传输对象（DTO）
 * OpenRA 对照: OpenRA.Game/GameInformation.cs
 *
 * 核心范式转换:
 * - C# DateTime → JavaScript Date (toISOString() 用于序列化)
 * - C# TimeSpan Duration → number (秒，浮点)
 * - C# FieldLoader.Load / MiniYaml → JSON.parse / fromJSON 工厂方法
 * - C# List<Player> → GameInformationPlayer[] 带验证
 * - C# FrozenSet<int> → Set<number>
 * - C# 内部 Player 类 → GameInformationPlayer 内部类（避免与全局 Player 冲突）
 * - C# MiniYaml 序列化 → JSON 序列化（相同二进制帧内的兼容演进）
 */

import { WinState } from './Player.js'
import { MapGenerationArgs } from './Map/MapGenerationArgs.js'

// ---------------------------------------------------------------------------
// PlayerColor — player color representation
// ---------------------------------------------------------------------------

/**
 * Player color stored as RGBA components.
 *
 * OpenRA 对照: GameInformation.Player.Color (Color struct)
 */
export interface PlayerColor {
  r: number
  g: number
  b: number
  a: number
}

// ---------------------------------------------------------------------------
// GameInformationPlayer — 内部玩家信息类（对应 OpenRA GameInformation.Player）
// ---------------------------------------------------------------------------

/**
 * 回放/保存元数据中的单个玩家信息。
 *
 * OpenRA 对照: GameInformation.Player inner class
 *
 * 包含玩家标识、阵营、团队、出生点、是否人类/Bot、
 * 断开连接帧以及胜负结果信息。
 */
export class GameInformationPlayer {
  /** 玩家显示名称。
   *
   * OpenRA 对照: Player.Name
   */
  playerName: string

  /** 玩家槽位ID（0-based client index）。
   *
   * OpenRA 对照: Player.ClientIndex
   */
  playerId: number

  /** 玩家颜色（RGBA）。
   *
   * OpenRA 对照: Player.Color
   */
  color: PlayerColor

  /** 阵营内部名称（如 "allies", "soviet"）。
   *
   * OpenRA 对照: Player.FactionId
   */
  factionId: string

  /** 阵营显示名称（如 "Allies", "Soviet"）。
   *
   * OpenRA 对照: Player.FactionName
   */
  factionName: string

  /** 团队编号（0 = 无团队）。
   *
   * OpenRA 对照: Player.Team
   */
  team: number

  /** 出生点索引。
   *
   * OpenRA 对照: Player.SpawnPoint
   */
  spawnPoint: number

  /** 是否是真人玩家。
   *
   * OpenRA 对照: Player.IsHuman
   */
  isHuman: boolean

  /** 是否是Bot/AI玩家。
   *
   * OpenRA 对照: Player.IsBot
   */
  isBot: boolean

  /** Bot AI 类型名称（如 "EasyBot", "HardBot"）。
   *
   * OpenRA 对照: Player.BotType
   *
   * null 表示非 Bot 玩家。
   */
  botType: string | null

  /** 阵营显示名称（本地化版本）。
   *
   * OpenRA 对照: Player.DisplayFactionName
   */
  displayFactionName: string

  /** 用于显示的阵营 ID。
   *
   * OpenRA 对照: Player.DisplayFactionId
   */
  displayFactionId: string

  /** 阵营是否随机分配。
   *
   * OpenRA 对照: Player.IsRandomFaction
   */
  isRandomFaction: boolean

  /** 出生点是否随机分配。
   *
   * OpenRA 对照: Player.IsRandomSpawnPoint
   */
  isRandomSpawnPoint: boolean

  /** 唯一玩家标识（用于跨回放/存档的玩家关联）。
   *
   * OpenRA 对照: Player.Fingerprint
   */
  fingerprint: string

  /** 断开连接时的游戏帧编号（0 = 未断开）。
   *
   * OpenRA 对照: Player.DisconnectFrame
   *
   * 在回放中，此值表示玩家断开连接的帧。0 表示始终在线。
   */
  disconnectFrame: number

  /** 该玩家的胜负状态。
   *
   * OpenRA 对照: Player.Outcome
   */
  winState: WinState

  /** 玩家获胜或失败的时间戳。
   *
   * OpenRA 对照: Player.OutcomeTimestampUtc
   *
   * null 表示游戏尚未结束或结局尚未确定。
   */
  outcomeTimestampUtc: Date | null

  /** 运行时玩家Actor的ID（可选，用于回放/存档重新关联）。
   *
   * OpenRA 对照: (TypeScript 特有 — 用于重新关联 PlayerActor）
   *
   * null 表示尚未关联或回放中不可用。
   */
  playerActorId: number | null

  /**
   * 创建一个包含默认值的新 GameInformationPlayer。
   *
   * OpenRA 对照: new GameInformation.Player
   *
   * @param playerName — 玩家显示名称
   */
  constructor(playerName: string) {
    this.playerName = playerName
    this.playerId = 0
    this.color = { r: 0, g: 0, b: 0, a: 255 }
    this.factionId = ''
    this.factionName = ''
    this.team = 0
    this.spawnPoint = 0
    this.isHuman = true
    this.isBot = false
    this.botType = null
    this.displayFactionName = ''
    this.displayFactionId = ''
    this.isRandomFaction = false
    this.isRandomSpawnPoint = false
    this.fingerprint = ''
    this.disconnectFrame = 0
    this.winState = WinState.Undefined
    this.outcomeTimestampUtc = null
    this.playerActorId = null
  }

  /**
   * 将此玩家序列化为纯 JSON 对象。
   *
   * OpenRA 对照: FieldSaver.Save(Player) → MiniYaml nodes
   *
   * 日期序列化为 ISO 8601 字符串（兼容 JSON）。
   *
   * @returns 用于 JSON.stringify 的纯对象
   */
  toJSONObject(): Record<string, unknown> {
    return {
      playerName: this.playerName,
      playerId: this.playerId,
      color: this.color,
      factionId: this.factionId,
      factionName: this.factionName,
      team: this.team,
      spawnPoint: this.spawnPoint,
      isHuman: this.isHuman,
      isBot: this.isBot,
      botType: this.botType,
      displayFactionName: this.displayFactionName,
      displayFactionId: this.displayFactionId,
      isRandomFaction: this.isRandomFaction,
      isRandomSpawnPoint: this.isRandomSpawnPoint,
      fingerprint: this.fingerprint,
      disconnectFrame: this.disconnectFrame,
      winState: this.winState,
      outcomeTimestampUtc: this.outcomeTimestampUtc?.toISOString() ?? null,
      playerActorId: this.playerActorId,
    }
  }

  /**
   * 从纯 JSON 对象创建一个 GameInformationPlayer。
   *
   * OpenRA 对照: FieldLoader.Load<Player>(MiniYaml)
   *
   * @param data — 包含玩家属性的纯对象
   * @returns 一个新的 GameInformationPlayer 实例
   */
  static fromJSON(data: Record<string, unknown>): GameInformationPlayer {
    const player = new GameInformationPlayer(
      (data.playerName as string) ?? '',
    )
    player.playerId = (data.playerId as number) ?? 0
    player.color = parseColorFromJSON(data.color)
    player.factionId = (data.factionId as string) ?? ''
    player.factionName = (data.factionName as string) ?? ''
    player.team = (data.team as number) ?? 0
    player.spawnPoint = (data.spawnPoint as number) ?? 0
    player.isHuman = (data.isHuman as boolean) ?? true
    player.isBot = (data.isBot as boolean) ?? false
    player.botType = (data.botType as string) ?? null
    player.displayFactionName = (data.displayFactionName as string) ?? ''
    player.displayFactionId = (data.displayFactionId as string) ?? ''
    player.isRandomFaction = (data.isRandomFaction as boolean) ?? false
    player.isRandomSpawnPoint = (data.isRandomSpawnPoint as boolean) ?? false
    player.fingerprint = (data.fingerprint as string) ?? ''
    player.disconnectFrame = (data.disconnectFrame as number) ?? 0
    player.winState =
      (data.winState as WinState) ?? WinState.Undefined
    player.outcomeTimestampUtc =
      typeof data.outcomeTimestampUtc === 'string'
        ? new Date(data.outcomeTimestampUtc)
        : null
    player.playerActorId = (data.playerActorId as number) ?? null
    return player
  }
}

// ---------------------------------------------------------------------------
// GameInformation — 游戏元数据 DTO（对应 OpenRA GameInformation）
// ---------------------------------------------------------------------------

/**
 * 单个游戏会话的元数据：模组、版本、地图、玩家、持续时间和结果。
 *
 * OpenRA 对照: GameInformation class
 *
 * 存储于回放文件尾部（通过 ReplayMetadata）及存档文件中。
 * 提供序列化/反序列化方法，可在 JSON 与二进制格式之间转换。
 */
export class GameInformation {
  /** 模组标识符（如 "cnc", "ra"）。
   *
   * OpenRA 对照: GameInformation.Mod
   */
  mod: string

  /** 模组版本字符串。
   *
   * OpenRA 对照: GameInformation.Version
   */
  version: string

  /** 地图唯一标识符（UID）。
   *
   * OpenRA 对照: GameInformation.MapUid
   */
  mapUid: string

  /** 可读的地图标题。
   *
   * OpenRA 对照: GameInformation.MapTitle
   */
  mapTitle: string

  /** 游戏结束时的最终帧编号（未结束时为 0）。
   *
   * OpenRA 对照: GameInformation.FinalGameTick
   */
  finalGameTick: number

  /** 游戏开始时间戳（回放录制开始时）。
   *
   * OpenRA 对照: GameInformation.StartTimeUtc (DateTime)
   */
  startTimeUtc: Date

  /** 游戏结束时间戳（回放录制停止时）。
   *
   * OpenRA 对照: GameInformation.EndTimeUtc (DateTime)
   *
   * null 表示游戏尚未结束（回放录制中或意外终止）。
   */
  endTimeUtc: Date | null

  /** 游戏时长（秒）。
   *
   * OpenRA 对照: GameInformation.Duration (TimeSpan)
   *
   * 如果 EndTimeUtc 未设置或小于等于 StartTimeUtc，返回 0。
   */
  get duration(): number {
    if (
      this.endTimeUtc === null ||
      this.endTimeUtc <= this.startTimeUtc
    ) {
      return 0
    }
    return (this.endTimeUtc.getTime() - this.startTimeUtc.getTime()) / 1000
  }

  /** 所有玩家列表。
   *
   * OpenRA 对照: GameInformation.Players (IList<Player>)
   */
  players: GameInformationPlayer[]

  /** 真人玩家（非Bot）的筛选列表。
   *
   * OpenRA 对照: GameInformation.HumanPlayers
   */
  get humanPlayers(): GameInformationPlayer[] {
    return this.players.filter((p) => p.isHuman)
  }

  /** 是否仅有一个真人玩家（单人游戏）。
   *
   * OpenRA 对照: GameInformation.IsSinglePlayer
   */
  get isSinglePlayer(): boolean {
    return this.humanPlayers.length === 1
  }

  /** 被禁用的出生点集合。
   *
   * OpenRA 对照: GameInformation.DisabledSpawnPoints (FrozenSet<int>)
   */
  disabledSpawnPoints: Set<number>

  /** 程序化地图生成参数（仅限生成的地图，否则为 undefined）。
   *
   * OpenRA 对照: GameInformation.MapGenerationArgs
   */
  mapGenerationArgs?: MapGenerationArgs

  /**
   * 创建一个包含默认值的新 GameInformation。
   *
   * OpenRA 对照: new GameInformation()
   *
   * 使用当前 UTC 时间初始化 StartTimeUtc。
   */
  constructor() {
    this.mod = ''
    this.version = ''
    this.mapUid = ''
    this.mapTitle = ''
    this.finalGameTick = 0
    this.startTimeUtc = new Date()
    this.endTimeUtc = null
    this.players = []
    this.disabledSpawnPoints = new Set<number>()
    this.mapGenerationArgs = undefined
  }

  // ---------------------------------------------------------------------------
  // 序列化 / 反序列化（对应 OpenRA Serialize / Deserialize）
  // ---------------------------------------------------------------------------

  /**
   * 将 GameInformation 序列化为 JSON 字符串。
   *
   * OpenRA 对照: GameInformation.Serialize() → MiniYaml string
   *
   * 将所有字段（含玩家和地图生成参数）序列化为一个 JSON 字符串。
   * 用于嵌入二进制回放文件尾部（通过 ReplayMetadata）。
   *
   * @returns JSON 字符串表示形式
   */
  toJSONString(): string {
    const obj: Record<string, unknown> = {
      mod: this.mod,
      version: this.version,
      mapUid: this.mapUid,
      mapTitle: this.mapTitle,
      finalGameTick: this.finalGameTick,
      startTimeUtc: this.startTimeUtc.toISOString(),
      endTimeUtc: this.endTimeUtc?.toISOString() ?? null,
      players: this.players.map((p) => p.toJSONObject()),
      disabledSpawnPoints: Array.from(this.disabledSpawnPoints),
      mapGenerationArgs: this.mapGenerationArgs
        ? Object.fromEntries(
            this.mapGenerationArgs.serialize().map((kv) => [kv.key, kv.value]),
          )
        : null,
    }
    return JSON.stringify(obj)
  }

  /**
   * 从 JSON 字符串解析一个 GameInformation。
   *
   * OpenRA 对照: GameInformation.Deserialize(string, path)
   *
   * 此方法不会抛出异常：遇到无效 JSON 时返回 null。
   * 这与 ReplayMetadata 的 fail-safe 模式一致。
   *
   * @param json — JSON 字符串
   * @returns 一个新的 GameInformation 实例，解析失败时返回 null
   */
  static fromJSONString(json: string): GameInformation | null {
    try {
      const data = JSON.parse(json) as Record<string, unknown>
      const info = new GameInformation()

      info.mod = (data.mod as string) ?? ''
      info.version = (data.version as string) ?? ''
      info.mapUid = (data.mapUid as string) ?? ''
      info.mapTitle = (data.mapTitle as string) ?? ''
      info.finalGameTick = (data.finalGameTick as number) ?? 0

      if (typeof data.startTimeUtc === 'string') {
        info.startTimeUtc = new Date(data.startTimeUtc)
      }

      if (typeof data.endTimeUtc === 'string') {
        info.endTimeUtc = new Date(data.endTimeUtc)
      } else {
        info.endTimeUtc = null
      }

      // 解析玩家列表
      const playersData = data.players as Record<string, unknown>[] | undefined
      if (playersData && Array.isArray(playersData)) {
        for (const pData of playersData) {
          info.players.push(GameInformationPlayer.fromJSON(pData))
        }
      }

      // 解析禁用出生点
      const dsp = data.disabledSpawnPoints as number[] | undefined
      if (dsp && Array.isArray(dsp)) {
        info.disabledSpawnPoints = new Set<number>(dsp)
      }

      // 解析地图生成参数
      const mga = data.mapGenerationArgs as Record<string, unknown> | undefined
      if (mga && typeof mga === 'object' && !Array.isArray(mga)) {
        info.mapGenerationArgs = new MapGenerationArgs({
          uid: (mga.Uid ?? mga.uid) as string,
          generator: (mga.Generator ?? mga.generator) as string,
          tileset: (mga.Tileset ?? mga.tileset) as string,
          size: parseSizeFromJSON(mga.Size ?? mga.size),
          title: (mga.Title ?? mga.title) as string,
          author: (mga.Author ?? mga.author) as string,
          settings: mga.Settings ?? mga.settings,
        })
      }

      return info
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // 工厂与查询方法（对应 OpenRA AddPlayer / GetPlayer / disconnectedPlayers）
  // ---------------------------------------------------------------------------

  /**
   * 创建一个新的 GameInformationPlayer 并添加到玩家列表。
   *
   * OpenRA 对照: GameInformation.AddPlayer(OpenRA.Player, Session)
   *
   * 接受字符串（仅玩家名称）或 Partial<GameInformationPlayer> 选项对象。
   * 返回的实例已添加到 players 列表，调用方可进一步设置属性。
   *
   * @param optionsOrName — 玩家显示名称，或包含 playerName 的选项对象
   * @returns 新创建的 GameInformationPlayer 实例（已添加到 players 列表）
   */
  addPlayer(
    optionsOrName: string | (Partial<GameInformationPlayer> & { playerName: string }),
  ): GameInformationPlayer {
    let player: GameInformationPlayer
    if (typeof optionsOrName === 'string') {
      player = new GameInformationPlayer(optionsOrName)
    } else {
      player = new GameInformationPlayer(optionsOrName.playerName)
      // Apply optional fields from the options object
      if (optionsOrName.playerId !== undefined) player.playerId = optionsOrName.playerId
      if (optionsOrName.color) player.color = optionsOrName.color
      if (optionsOrName.factionId !== undefined) player.factionId = optionsOrName.factionId
      if (optionsOrName.factionName !== undefined) player.factionName = optionsOrName.factionName
      if (optionsOrName.team !== undefined) player.team = optionsOrName.team
      if (optionsOrName.spawnPoint !== undefined) player.spawnPoint = optionsOrName.spawnPoint
      if (optionsOrName.isHuman !== undefined) player.isHuman = optionsOrName.isHuman
      if (optionsOrName.isBot !== undefined) player.isBot = optionsOrName.isBot
      if (optionsOrName.botType !== undefined) player.botType = optionsOrName.botType
      if (optionsOrName.displayFactionName !== undefined) player.displayFactionName = optionsOrName.displayFactionName
      if (optionsOrName.displayFactionId !== undefined) player.displayFactionId = optionsOrName.displayFactionId
      if (optionsOrName.isRandomFaction !== undefined) player.isRandomFaction = optionsOrName.isRandomFaction
      if (optionsOrName.isRandomSpawnPoint !== undefined) player.isRandomSpawnPoint = optionsOrName.isRandomSpawnPoint
      if (optionsOrName.fingerprint !== undefined) player.fingerprint = optionsOrName.fingerprint
      if (optionsOrName.disconnectFrame !== undefined) player.disconnectFrame = optionsOrName.disconnectFrame
      if (optionsOrName.winState !== undefined) player.winState = optionsOrName.winState
      if (optionsOrName.outcomeTimestampUtc !== undefined) player.outcomeTimestampUtc = optionsOrName.outcomeTimestampUtc
      if (optionsOrName.playerActorId !== undefined) player.playerActorId = optionsOrName.playerActorId
    }
    this.players.push(player)
    return player
  }

  /**
   * 获取所有已断开连接的玩家（DisconnectFrame > 0）。
   *
   * OpenRA 对照: Players.Where(p => p.DisconnectFrame > 0)
   *
   * @returns 已断开玩家的数组
   */
  disconnectedPlayers(): GameInformationPlayer[] {
    return this.players.filter((p) => p.disconnectFrame > 0)
  }
}

// ---------------------------------------------------------------------------
// 辅助函数（对应 OpenRA 序列化/反序列化辅助方法）
// ---------------------------------------------------------------------------

/**
 * 从 JSON 字符串值解析 Size 对象。
 *
 * OpenRA 对照: FieldLoader.Load 中的 Size 解析（"width,height" 格式）
 *
 * @param value — Size 的未知 JSON 值
 * @returns Size 对象，默认为 { width: 0, height: 0 }
 */
/**
 * 从 JSON 值解析 PlayerColor 对象。
 *
 * @param value — 颜色的未知 JSON 值（对象 {r,g,b,a} 或 undefined）
 * @returns PlayerColor 对象，默认为 { r: 0, g: 0, b: 0, a: 255 }
 */
function parseColorFromJSON(value: unknown): PlayerColor {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>
    return {
      r: (obj.r as number) ?? 0,
      g: (obj.g as number) ?? 0,
      b: (obj.b as number) ?? 0,
      a: (obj.a as number) ?? 255,
    }
  }
  return { r: 0, g: 0, b: 0, a: 255 }
}

function parseSizeFromJSON(
  value: unknown,
): { width: number; height: number } {
  if (typeof value === 'string') {
    const parts = value.split(',')
    if (parts.length === 2) {
      return {
        width: parseInt(parts[0], 10) || 0,
        height: parseInt(parts[1], 10) || 0,
      }
    }
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>
    return {
      width: (obj.width as number) ?? (obj.Width as number) ?? 0,
      height: (obj.height as number) ?? (obj.Height as number) ?? 0,
    }
  }
  return { width: 0, height: 0 }
}
