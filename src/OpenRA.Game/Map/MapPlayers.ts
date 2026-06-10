/**
 * MapPlayers.ts — 地图玩家槽位集合管理器
 * OpenRA 对照: OpenRA.Game/Map/MapPlayers.cs
 *
 * 核心范式转换:
 * - C# Dictionary<string, PlayerReference> → Map<string, PlayerReference>
 * - C# IEnumerable<MiniYamlNode> → PlayerDefinition[] (JSON adaptation)
 * - C# ImmutableArray<string> Enemies → string[]
 * - C# FieldSaver.SaveDifferences → JSON object diff (simplified)
 * - C# Ruleset.Actors[SystemActors.World].TraitInfos<FactionInfo>() →
 *   RulesetStub with getWorldFactionInfos() helper
 */

import { PlayerReference, type PlayerDefinition } from './PlayerReference.js'
import type { RulesetStub } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// MapPlayers
// ---------------------------------------------------------------------------

/**
 * 管理地图中定义的所有玩家槽位。
 *
 * OpenRA 对照: MapPlayers class
 *
 * 从地图 YAML 解析玩家定义，或为遭遇战/多人游戏创建默认配置。
 * 玩家掩码使用 64 位整数表示；"Everyone" 观战者玩家在运行时创建，
 * 将可用玩家数量减少 1（MaximumPlayerCount = 63）。
 */
export class MapPlayers {
  /**
   * 最大玩家数量（64 位掩码减去 1 个观战者 "Everyone" 玩家）。
   *
   * OpenRA 对照: MapPlayers.MaximumPlayerCount
   */
  static readonly MaximumPlayerCount = 63

  /** 玩家引用映射，按键名索引。
   *
   * OpenRA 对照: MapPlayers.Players (Dictionary<string, PlayerReference>)
   */
  readonly players: Map<string, PlayerReference>

  /**
   * 创建空的玩家映射。
   *
   * OpenRA 对照: MapPlayers() : this([])
   */
  constructor()

  /**
   * 从玩家定义数组解析玩家。
   *
   * OpenRA 对照: MapPlayers(IEnumerable<MiniYamlNode> playerDefinitions)
   *
   * @param playerDefinitions — 玩家定义数组（JSON 适配的 MiniYamlNode）
   */
  constructor(playerDefinitions: PlayerDefinition[])

  /**
   * 为遭遇战/多人游戏创建默认玩家配置。
   *
   * OpenRA 对照: MapPlayers(Ruleset rules, int playerCount)
   *
   * 创建:
   * - Neutral: ownsWorld=true, nonCombatant=true
   * - Creeps: nonCombatant=true, enemies=Multi0..MultiN-1
   * - Multi0..MultiN-1: playable=true, enemies=Creeps, faction="Random"
   *
   * @param rules — 规则集（用于查找可选阵营）
   * @param playerCount — 人类玩家数量
   */
  constructor(rules: RulesetStub, playerCount: number)

  constructor(
    arg1?: PlayerDefinition[] | RulesetStub,
    arg2?: number,
  ) {
    if (arg1 === undefined) {
      // Default constructor: empty players
      this.players = new Map()
    } else if (Array.isArray(arg1)) {
      // PlayerDefinition[] constructor
      this.players = new Map()
      for (const def of arg1) {
        const pr = new PlayerReference(def as unknown as Partial<PlayerReference>)
        this.players.set(pr.name, pr)
      }
    } else {
      // Ruleset + playerCount constructor
      const rules = arg1 as RulesetStub
      const playerCount = arg2!

      // Find first selectable faction
      // NOTE: RulesetStub has actors: Map<string, unknown>
      // In OpenRA: rules.Actors[SystemActors.World].TraitInfos<FactionInfo>()
      // We use a simplified approach via the stub.
      const firstFaction = this.getFirstSelectableFaction(rules)

      this.players = new Map()

      // Neutral player
      const neutral = new PlayerReference({
        name: 'Neutral',
        faction: firstFaction,
        ownsWorld: true,
        nonCombatant: true,
      })
      this.players.set('Neutral', neutral)

      // Creeps player
      const creepsEnemies: string[] = []
      for (let i = 0; i < playerCount; i++) {
        creepsEnemies.push(`Multi${i}`)
      }
      const creeps = new PlayerReference({
        name: 'Creeps',
        faction: firstFaction,
        nonCombatant: true,
        enemies: creepsEnemies,
      })
      this.players.set('Creeps', creeps)

      // Multi players
      for (let index = 0; index < playerCount; index++) {
        const p = new PlayerReference({
          name: `Multi${index}`,
          faction: 'Random',
          playable: true,
          enemies: ['Creeps'],
        })
        this.players.set(p.name, p)
      }
    }
  }

  /**
   * 从规则集中获取第一个可选阵营。
   *
   * OpenRA 对照: rules.Actors[SystemActors.World].TraitInfos<FactionInfo>()
   *   .First(f => f.Selectable).InternalName
   *
   * NOTE: 这是 RulesetStub 的简化。完整的 FactionInfo 解析将在
   * ActorInfo/YAML 系统迁移后实现（TODO-3.C.1）。
   *
   * @param rules — 规则集存根
   * @returns 第一个可选阵营的内部名称，如果没有则返回 "Random"
   */
  private getFirstSelectableFaction(rules: RulesetStub): string {
    // Try to get faction info from the ruleset stub
    // The stub's actors map may contain FactionInfo objects
    const worldActor = rules.actors.get('World')
    if (worldActor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actor = worldActor as any
      if (actor.factions && Array.isArray(actor.factions)) {
        for (const faction of actor.factions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((faction as any).selectable) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (faction as any).internalName ?? 'Random'
          }
        }
      }
    }
    return 'Random'
  }

  /**
   * 将玩家序列化为键值对数组（JSON 适配的 MiniYaml）。
   *
   * OpenRA 对照: MapPlayers.ToMiniYaml()
   *
   * 每个玩家序列化为 PlayerReference@name 格式，值是与默认
   * PlayerReference 的差异对象。
   *
   * @returns 序列化的玩家定义数组
   */
  toMiniYaml(): { key: string; value: Record<string, unknown> }[] {
    const defaultRef = new PlayerReference()
    const result: { key: string; value: Record<string, unknown> }[] = []

    for (const [name, player] of this.players) {
      const diff = this.computeDifferences(player, defaultRef)
      result.push({
        key: `PlayerReference@${name}`,
        value: diff,
      })
    }

    return result
  }

  /**
   * 计算玩家引用与默认值之间的差异。
   *
   * OpenRA 对照: FieldSaver.SaveDifferences(p.Value, new PlayerReference())
   *
   * 只包含与默认值不同的字段。
   *
   * @param player — 要比较的玩家
   * @param defaults — 默认玩家引用
   * @returns 差异对象
   */
  private computeDifferences(
    player: PlayerReference,
    defaults: PlayerReference,
  ): Record<string, unknown> {
    const diff: Record<string, unknown> = {}

    if (player.palette !== defaults.palette) diff.Palette = player.palette
    if (player.bot !== defaults.bot) diff.Bot = player.bot
    if (player.startingUnitsClass !== defaults.startingUnitsClass)
      diff.StartingUnitsClass = player.startingUnitsClass
    if (player.allowBots !== defaults.allowBots) diff.AllowBots = player.allowBots
    if (player.playable !== defaults.playable) diff.Playable = player.playable
    if (player.required !== defaults.required) diff.Required = player.required
    if (player.ownsWorld !== defaults.ownsWorld) diff.OwnsWorld = player.ownsWorld
    if (player.spectating !== defaults.spectating) diff.Spectating = player.spectating
    if (player.nonCombatant !== defaults.nonCombatant) diff.NonCombatant = player.nonCombatant
    if (player.lockFaction !== defaults.lockFaction) diff.LockFaction = player.lockFaction
    if (player.faction !== defaults.faction) diff.Faction = player.faction
    if (player.lockColor !== defaults.lockColor) diff.LockColor = player.lockColor
    if (player.color !== defaults.color) diff.Color = player.color
    if (!player.homeLocation.equals(defaults.homeLocation))
      diff.HomeLocation = player.homeLocation.toString()
    if (player.lockSpawn !== defaults.lockSpawn) diff.LockSpawn = player.lockSpawn
    if (player.spawn !== defaults.spawn) diff.Spawn = player.spawn
    if (player.lockTeam !== defaults.lockTeam) diff.LockTeam = player.lockTeam
    if (player.team !== defaults.team) diff.Team = player.team
    if (player.lockHandicap !== defaults.lockHandicap) diff.LockHandicap = player.lockHandicap
    if (player.handicap !== defaults.handicap) diff.Handicap = player.handicap
    if (player.allies.length > 0) diff.Allies = player.allies
    if (player.enemies.length > 0) diff.Enemies = player.enemies

    return diff
  }
}
