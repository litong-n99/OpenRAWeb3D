/**
 * PlayerReference.ts — 地图玩家槽位定义（从 YAML/JSON 解析的玩家配置）
 * OpenRA 对照: OpenRA.Game/Map/PlayerReference.cs
 *
 * 核心范式转换:
 * - C# PlayerReference 类（FieldLoader 反射加载）→ TypeScript 具体类（直接字段赋值）
 * - C# ImmutableArray<string> Allies/Enemies → TypeScript readonly string[]
 * - C# Color 结构体 → number (ARGB)
 * - C# MiniYaml 解析 → JSON 对象解析
 */

import { CPos } from '../CPos.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * JSON 适配的 player definition 节点结构。
 *
 * OpenRA 对照: MiniYamlNode (Key = "PlayerReference@name", Value.Nodes)
 *
 * NOTE: 在 OpenRA 中，PlayerReference 通过 FieldLoader.Load(this, MiniYaml)
 * 从 MiniYaml 节点加载。在浏览器中，我们使用一个平面 JSON 对象，其中
 * 每个属性对应一个 PlayerReference 字段。"nodes" 字段保留用于向后兼容
 * 基于 MiniYaml 的源格式；基于属性的格式是首选。
 */
export interface PlayerDefinition {
  /** 玩家引用名称（如 "Neutral", "Multi0"）。 */
  name: string
  /** 属性节点数组（JSON 适配的 MiniYamlNode 列表）—— 保留用于向后兼容。 */
  nodes?: unknown[]
  /** 玩家属性作为平面键值对（首选格式）。 */
  properties?: Partial<PlayerReference>
}

// ---------------------------------------------------------------------------
// PlayerReference
// ---------------------------------------------------------------------------

/**
 * 表示从地图 YAML 解析出的玩家槽位定义。
 *
 * OpenRA 对照: PlayerReference class
 *
 * 包含起始配置（阵营、颜色、出生点、队伍、盟友/敌人）和大厅锁定标志。
 * 地图定义的玩家使用默认值；客户端/大厅玩家在其之上应用覆盖。
 */
export class PlayerReference {
  /** 玩家名称（显示用）。 */
  name: string
  /** 调色板标识符（用于玩家颜色）。 */
  palette: string
  /** 默认机器人类型（此槽位）。 */
  bot: string | null
  /** 起始单位类别标识符。 */
  startingUnitsClass: string | null
  /** 是否允许机器人填充此槽位。 */
  allowBots: boolean
  /** 此槽位是否可以被玩家占据。 */
  playable: boolean
  /** 此玩家是否为游戏开始所必需。 */
  required: boolean
  /** 此玩家是否拥有世界（编辑器模式）。 */
  ownsWorld: boolean
  /** 此槽位是否为观战者。 */
  spectating: boolean
  /** 此玩家是否非战斗（不能攻击）。 */
  nonCombatant: boolean
  /** 阵营是否在大厅锁定。 */
  lockFaction: boolean
  /** 默认阵营内部名称。 */
  faction: string
  /** 颜色是否在大厅锁定。 */
  lockColor: boolean
  /** 默认玩家颜色（ARGB）。 */
  color: number
  /** 家/出生位置（以单元格为单位）。 */
  homeLocation: CPos
  /** 出生点是否在大厅锁定。 */
  lockSpawn: boolean
  /** 默认出生点索引。 */
  spawn: number
  /** 队伍是否在大厅锁定。 */
  lockTeam: boolean
  /** 默认队伍编号。 */
  team: number
  /**  handicap 是否在大厅锁定。 */
  lockHandicap: boolean
  /** 默认 handicap 百分比（0-100）。 */
  handicap: number
  /** 同盟玩家名称（用于外交设置）。 */
  allies: string[]
  /** 敌对玩家名称（用于外交设置）。 */
  enemies: string[]

  /**
   * 使用默认值构造 PlayerReference。
   *
   * OpenRA 对照: PlayerReference() 默认构造函数
   */
  constructor()

  /**
   * 从玩家定义构造 PlayerReference。
   *
   * OpenRA 对照: PlayerReference(MiniYaml my) { FieldLoader.Load(this, my); }
   *
   * NOTE: TypeScript 没有运行时 FieldLoader。此构造函数接受一个
   * 部分对象并直接分配字段。未提供的字段使用默认值。
   *
   * @param definition — 包含玩家属性的部分对象
   */
  constructor(definition: Partial<PlayerReference>)

  constructor(definition?: Partial<PlayerReference>) {
    const def = definition ?? {}

    this.name = def.name ?? ''
    this.palette = def.palette ?? ''
    this.bot = def.bot ?? null
    this.startingUnitsClass = def.startingUnitsClass ?? null
    this.allowBots = def.allowBots ?? true
    this.playable = def.playable ?? false
    this.required = def.required ?? false
    this.ownsWorld = def.ownsWorld ?? false
    this.spectating = def.spectating ?? false
    this.nonCombatant = def.nonCombatant ?? false

    this.lockFaction = def.lockFaction ?? false
    this.faction = def.faction ?? ''

    this.lockColor = def.lockColor ?? false
    // NOTE: OpenRA 默认使用 Game.ModData.GetOrCreate<DefaultPlayer>().Color
    // 在浏览器环境中，我们使用一个合理的默认值（白色）。
    this.color = def.color ?? 0xffffffff

    this.homeLocation = def.homeLocation ?? CPos.Zero

    this.lockSpawn = def.lockSpawn ?? false
    this.spawn = def.spawn ?? 0

    this.lockTeam = def.lockTeam ?? false
    this.team = def.team ?? 0

    this.lockHandicap = def.lockHandicap ?? false
    this.handicap = def.handicap ?? 0

    this.allies = def.allies ? [...def.allies] : []
    this.enemies = def.enemies ? [...def.enemies] : []
  }

  /**
   * 返回玩家名称。
   *
   * OpenRA 对照: PlayerReference.ToString()
   *
   * @returns 玩家名称
   */
  toString(): string {
    return this.name
  }
}
