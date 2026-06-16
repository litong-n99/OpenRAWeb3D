/**
 * GameInformation.test.ts — GameInformation 迁移单元测试
 *
 * 这些测试是纯逻辑测试——不涉及 Babylon.js 或 WebGL。
 * 无需模拟 @babylonjs/core。
 *
 * 测试覆盖:
 * - 默认构造和属性
 * - 添加玩家工厂方法
 * - 真人玩家和单人游戏过滤
 * - 已断开玩家过滤
 * - Duration 计算（含 null EndTimeUtc）
 * - JSON 序列化/反序列化往返
 * - 无效 JSON 和缺失字段的边缘情况
 */

import { describe, it, expect } from 'vitest'
import {
  GameInformation,
  GameInformationPlayer,
} from './GameInformation'
import { WinState } from './Player'

// ---------------------------------------------------------------------------
// GameInformationPlayer
// ---------------------------------------------------------------------------

describe('GameInformationPlayer', () => {
  it('constructor sets default values', () => {
    const p = new GameInformationPlayer('TestPlayer')

    expect(p.playerName).toBe('TestPlayer')
    expect(p.playerId).toBe(0)
    expect(p.color).toEqual({ r: 0, g: 0, b: 0, a: 255 })
    expect(p.factionId).toBe('')
    expect(p.factionName).toBe('')
    expect(p.team).toBe(0)
    expect(p.spawnPoint).toBe(0)
    expect(p.isHuman).toBe(true)
    expect(p.isBot).toBe(false)
    expect(p.botType).toBeNull()
    expect(p.displayFactionName).toBe('')
    expect(p.displayFactionId).toBe('')
    expect(p.isRandomFaction).toBe(false)
    expect(p.isRandomSpawnPoint).toBe(false)
    expect(p.fingerprint).toBe('')
    expect(p.disconnectFrame).toBe(0)
    expect(p.winState).toBe(WinState.Undefined)
    expect(p.outcomeTimestampUtc).toBeNull()
    expect(p.playerActorId).toBeNull()
  })

  it('toJSONObject serializes all fields', () => {
    const p = new GameInformationPlayer('TestPlayer')
    p.playerId = 3
    p.color = { r: 255, g: 0, b: 0, a: 255 }
    p.factionId = 'allies'
    p.factionName = 'Allies'
    p.team = 1
    p.spawnPoint = 2
    p.isHuman = true
    p.isBot = false
    p.botType = null
    p.displayFactionName = 'Allies (Localized)'
    p.displayFactionId = 'allies-display'
    p.isRandomFaction = false
    p.isRandomSpawnPoint = true
    p.fingerprint = 'fp-abc-123'
    p.disconnectFrame = 100
    p.winState = WinState.Won
    const outcomeDate = new Date('2024-06-15T12:00:00.000Z')
    p.outcomeTimestampUtc = outcomeDate
    p.playerActorId = 42

    const json = p.toJSONObject()

    expect(json.playerName).toBe('TestPlayer')
    expect(json.playerId).toBe(3)
    expect(json.color).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(json.factionId).toBe('allies')
    expect(json.factionName).toBe('Allies')
    expect(json.team).toBe(1)
    expect(json.spawnPoint).toBe(2)
    expect(json.isHuman).toBe(true)
    expect(json.isBot).toBe(false)
    expect(json.botType).toBeNull()
    expect(json.displayFactionName).toBe('Allies (Localized)')
    expect(json.displayFactionId).toBe('allies-display')
    expect(json.isRandomFaction).toBe(false)
    expect(json.isRandomSpawnPoint).toBe(true)
    expect(json.fingerprint).toBe('fp-abc-123')
    expect(json.disconnectFrame).toBe(100)
    expect(json.winState).toBe(WinState.Won)
    expect(json.outcomeTimestampUtc).toBe('2024-06-15T12:00:00.000Z')
    expect(json.playerActorId).toBe(42)
  })

  it('toJSONObject serializes null outcomeTimestampUtc as null', () => {
    const p = new GameInformationPlayer('Bot')
    p.isHuman = false
    p.isBot = true

    const json = p.toJSONObject()
    expect(json.outcomeTimestampUtc).toBeNull()
  })

  it('toJSONObject serializes null playerActorId as null', () => {
    const p = new GameInformationPlayer('P')

    const json = p.toJSONObject()
    expect(json.playerActorId).toBeNull()
  })

  it('fromJSON restores all fields from JSON object', () => {
    const data: Record<string, unknown> = {
      playerName: 'RestoredPlayer',
      playerId: 5,
      color: { r: 0, g: 255, b: 0, a: 128 },
      factionId: 'soviet',
      factionName: 'Soviet',
      team: 2,
      spawnPoint: 4,
      isHuman: false,
      isBot: true,
      botType: 'HardBot',
      displayFactionName: 'Soviet Union',
      displayFactionId: 'soviet',
      isRandomFaction: true,
      isRandomSpawnPoint: false,
      fingerprint: 'fp-xyz',
      disconnectFrame: 500,
      winState: WinState.Lost,
      outcomeTimestampUtc: '2024-01-01T00:00:00.000Z',
      playerActorId: 7,
    }

    const p = GameInformationPlayer.fromJSON(data)

    expect(p.playerName).toBe('RestoredPlayer')
    expect(p.playerId).toBe(5)
    expect(p.color).toEqual({ r: 0, g: 255, b: 0, a: 128 })
    expect(p.factionId).toBe('soviet')
    expect(p.factionName).toBe('Soviet')
    expect(p.team).toBe(2)
    expect(p.spawnPoint).toBe(4)
    expect(p.isHuman).toBe(false)
    expect(p.isBot).toBe(true)
    expect(p.botType).toBe('HardBot')
    expect(p.displayFactionName).toBe('Soviet Union')
    expect(p.displayFactionId).toBe('soviet')
    expect(p.isRandomFaction).toBe(true)
    expect(p.isRandomSpawnPoint).toBe(false)
    expect(p.fingerprint).toBe('fp-xyz')
    expect(p.disconnectFrame).toBe(500)
    expect(p.winState).toBe(WinState.Lost)
    expect(p.outcomeTimestampUtc).toBeInstanceOf(Date)
    expect(p.outcomeTimestampUtc?.toISOString()).toBe(
      '2024-01-01T00:00:00.000Z',
    )
    expect(p.playerActorId).toBe(7)
  })

  it('fromJSON handles missing fields with defaults', () => {
    const data: Record<string, unknown> = {
      playerName: 'MinimalPlayer',
    }

    const p = GameInformationPlayer.fromJSON(data)

    expect(p.playerName).toBe('MinimalPlayer')
    expect(p.playerId).toBe(0)
    expect(p.color).toEqual({ r: 0, g: 0, b: 0, a: 255 })
    expect(p.factionId).toBe('')
    expect(p.team).toBe(0)
    expect(p.isHuman).toBe(true)
    expect(p.isBot).toBe(false)
    expect(p.botType).toBeNull()
    expect(p.displayFactionName).toBe('')
    expect(p.displayFactionId).toBe('')
    expect(p.isRandomFaction).toBe(false)
    expect(p.isRandomSpawnPoint).toBe(false)
    expect(p.fingerprint).toBe('')
    expect(p.winState).toBe(WinState.Undefined)
    expect(p.outcomeTimestampUtc).toBeNull()
    expect(p.playerActorId).toBeNull()
  })

  it('fromJSON handles null outcomeTimestampUtc', () => {
    const data: Record<string, unknown> = {
      playerName: 'P',
      outcomeTimestampUtc: null,
    }

    const p = GameInformationPlayer.fromJSON(data)
    expect(p.outcomeTimestampUtc).toBeNull()
  })

  it('fromJSON toJSONObject round-trip preserves all data', () => {
    const original = new GameInformationPlayer('RoundTrip')
    original.playerId = 10
    original.color = { r: 100, g: 200, b: 50, a: 255 }
    original.factionId = 'gdi'
    original.factionName = 'GDI'
    original.team = 3
    original.spawnPoint = 5
    original.isHuman = true
    original.isBot = false
    original.botType = null
    original.displayFactionName = 'Global Defense Initiative'
    original.displayFactionId = 'gdi-display'
    original.isRandomFaction = false
    original.isRandomSpawnPoint = true
    original.fingerprint = 'fingerprint-001'
    original.disconnectFrame = 0
    original.winState = WinState.Won
    original.outcomeTimestampUtc = new Date('2025-06-16T10:30:00.000Z')
    original.playerActorId = 99

    const json = original.toJSONObject()
    const restored = GameInformationPlayer.fromJSON(json)

    expect(restored.playerName).toBe(original.playerName)
    expect(restored.playerId).toBe(original.playerId)
    expect(restored.color).toEqual(original.color)
    expect(restored.factionId).toBe(original.factionId)
    expect(restored.factionName).toBe(original.factionName)
    expect(restored.team).toBe(original.team)
    expect(restored.spawnPoint).toBe(original.spawnPoint)
    expect(restored.isHuman).toBe(original.isHuman)
    expect(restored.isBot).toBe(original.isBot)
    expect(restored.botType).toBe(original.botType)
    expect(restored.displayFactionName).toBe(original.displayFactionName)
    expect(restored.displayFactionId).toBe(original.displayFactionId)
    expect(restored.isRandomFaction).toBe(original.isRandomFaction)
    expect(restored.isRandomSpawnPoint).toBe(original.isRandomSpawnPoint)
    expect(restored.fingerprint).toBe(original.fingerprint)
    expect(restored.disconnectFrame).toBe(original.disconnectFrame)
    expect(restored.winState).toBe(original.winState)
    expect(restored.outcomeTimestampUtc?.toISOString()).toBe(
      original.outcomeTimestampUtc?.toISOString(),
    )
    expect(restored.playerActorId).toBe(original.playerActorId)
  })
})

// ---------------------------------------------------------------------------
// GameInformation
// ---------------------------------------------------------------------------

describe('GameInformation', () => {
  it('constructor sets default values', () => {
    const info = new GameInformation()

    expect(info.mod).toBe('')
    expect(info.version).toBe('')
    expect(info.mapUid).toBe('')
    expect(info.mapTitle).toBe('')
    expect(info.finalGameTick).toBe(0)
    expect(info.startTimeUtc).toBeInstanceOf(Date)
    expect(info.endTimeUtc).toBeNull()
    expect(info.players).toEqual([])
    expect(info.disabledSpawnPoints).toBeInstanceOf(Set)
    expect(info.disabledSpawnPoints.size).toBe(0)
    expect(info.mapGenerationArgs).toBeUndefined()
  })

  it('addPlayer creates player with given name and adds to list', () => {
    const info = new GameInformation()
    const player = info.addPlayer('Alice')

    expect(player).toBeInstanceOf(GameInformationPlayer)
    expect(player.playerName).toBe('Alice')
    expect(info.players).toHaveLength(1)
    expect(info.players[0]).toBe(player)
  })

  it('addPlayer returns player with default values', () => {
    const info = new GameInformation()
    const player = info.addPlayer('Bob')

    expect(player.isHuman).toBe(true)
    expect(player.isBot).toBe(false)
    expect(player.winState).toBe(WinState.Undefined)
    expect(player.outcomeTimestampUtc).toBeNull()
  })

  it('addPlayer with options sets provided fields', () => {
    const info = new GameInformation()
    const player = info.addPlayer({
      playerName: 'Commander',
      factionId: 'allies',
      isHuman: true,
      isBot: false,
      team: 1,
      spawnPoint: 3,
      color: { r: 0, g: 0, b: 255, a: 255 },
      isRandomFaction: true,
      fingerprint: 'fp-001',
    })

    expect(player.playerName).toBe('Commander')
    expect(player.factionId).toBe('allies')
    expect(player.isHuman).toBe(true)
    expect(player.isBot).toBe(false)
    expect(player.team).toBe(1)
    expect(player.spawnPoint).toBe(3)
    expect(player.color).toEqual({ r: 0, g: 0, b: 255, a: 255 })
    expect(player.isRandomFaction).toBe(true)
    expect(player.fingerprint).toBe('fp-001')
    // Fields not specified should have defaults
    expect(player.isRandomSpawnPoint).toBe(false)
    expect(player.botType).toBeNull()
  })

  it('humanPlayers filters only human players', () => {
    const info = new GameInformation()
    const alice = info.addPlayer('Alice')
    alice.isHuman = true
    alice.isBot = false

    const bot1 = info.addPlayer('Bot1')
    bot1.isHuman = false
    bot1.isBot = true

    const bob = info.addPlayer('Bob')
    bob.isHuman = true
    bob.isBot = false

    const humans = info.humanPlayers
    expect(humans).toHaveLength(2)
    expect(humans[0].playerName).toBe('Alice')
    expect(humans[1].playerName).toBe('Bob')
  })

  it('humanPlayers returns empty array when no humans', () => {
    const info = new GameInformation()
    const bot = info.addPlayer('Bot')
    bot.isHuman = false
    bot.isBot = true

    expect(info.humanPlayers).toHaveLength(0)
  })

  it('isSinglePlayer true when exactly one human', () => {
    const info = new GameInformation()
    const alice = info.addPlayer('Alice')
    alice.isHuman = true

    const bot = info.addPlayer('Bot')
    bot.isHuman = false
    bot.isBot = true

    expect(info.isSinglePlayer).toBe(true)
  })

  it('isSinglePlayer false when zero humans', () => {
    const info = new GameInformation()
    const bot = info.addPlayer('Bot')
    bot.isHuman = false
    bot.isBot = true

    expect(info.isSinglePlayer).toBe(false)
  })

  it('isSinglePlayer false when multiple humans', () => {
    const info = new GameInformation()
    const alice = info.addPlayer('Alice')
    alice.isHuman = true

    const bob = info.addPlayer('Bob')
    bob.isHuman = true

    expect(info.isSinglePlayer).toBe(false)
  })

  it('disconnectedPlayers filters players with disconnectFrame > 0', () => {
    const info = new GameInformation()
    const p1 = info.addPlayer('P1')
    p1.disconnectFrame = 0

    const p2 = info.addPlayer('P2')
    p2.disconnectFrame = 150

    const p3 = info.addPlayer('P3')
    p3.disconnectFrame = 300

    const disconnected = info.disconnectedPlayers()
    expect(disconnected).toHaveLength(2)
    expect(disconnected[0].playerName).toBe('P2')
    expect(disconnected[1].playerName).toBe('P3')
  })

  it('disconnectedPlayers returns empty when all connected', () => {
    const info = new GameInformation()
    const p1 = info.addPlayer('P1')
    p1.disconnectFrame = 0

    const p2 = info.addPlayer('P2')
    p2.disconnectFrame = 0

    expect(info.disconnectedPlayers()).toHaveLength(0)
  })

  it('duration returns 0 when endTimeUtc is null', () => {
    const info = new GameInformation()
    info.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    info.endTimeUtc = null

    expect(info.duration).toBe(0)
  })

  it('duration returns 0 when endTimeUtc <= startTimeUtc', () => {
    const info = new GameInformation()
    info.startTimeUtc = new Date('2024-01-01T01:00:00.000Z')
    info.endTimeUtc = new Date('2024-01-01T00:00:00.000Z')

    expect(info.duration).toBe(0)

    info.endTimeUtc = info.startTimeUtc
    expect(info.duration).toBe(0)
  })

  it('duration calculates correct seconds', () => {
    const info = new GameInformation()
    info.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    info.endTimeUtc = new Date('2024-01-01T00:30:00.000Z')

    expect(info.duration).toBe(1800) // 30 minutes in seconds
  })

  it('duration with fractional seconds', () => {
    const info = new GameInformation()
    info.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    info.endTimeUtc = new Date('2024-01-01T00:00:01.500Z')

    expect(info.duration).toBe(1.5)
  })

  it('toJSONString serializes basic fields', () => {
    const info = new GameInformation()
    info.mod = 'cnc'
    info.version = 'release-20230225'
    info.mapUid = 'abc123'
    info.mapTitle = 'Test Map'
    info.finalGameTick = 5000
    info.startTimeUtc = new Date('2024-06-01T12:00:00.000Z')
    info.endTimeUtc = new Date('2024-06-01T12:30:00.000Z')

    const json = info.toJSONString()
    const parsed = JSON.parse(json)

    expect(parsed.mod).toBe('cnc')
    expect(parsed.version).toBe('release-20230225')
    expect(parsed.mapUid).toBe('abc123')
    expect(parsed.mapTitle).toBe('Test Map')
    expect(parsed.finalGameTick).toBe(5000)
    expect(parsed.startTimeUtc).toBe('2024-06-01T12:00:00.000Z')
    expect(parsed.endTimeUtc).toBe('2024-06-01T12:30:00.000Z')
    expect(parsed.players).toEqual([])
    expect(parsed.disabledSpawnPoints).toEqual([])
    expect(parsed.mapGenerationArgs).toBeNull()
  })

  it('toJSONString serializes players', () => {
    const info = new GameInformation()
    const p = info.addPlayer('Alice')
    p.factionId = 'allies'
    p.isBot = false

    const json = info.toJSONString()
    const parsed = JSON.parse(json)

    expect(parsed.players).toHaveLength(1)
    expect(parsed.players[0].playerName).toBe('Alice')
    expect(parsed.players[0].factionId).toBe('allies')
  })

  it('toJSONString serializes disabledSpawnPoints', () => {
    const info = new GameInformation()
    info.disabledSpawnPoints.add(1)
    info.disabledSpawnPoints.add(3)
    info.disabledSpawnPoints.add(5)

    const json = info.toJSONString()
    const parsed = JSON.parse(json)

    expect(parsed.disabledSpawnPoints).toEqual([1, 3, 5])
  })

  it('toJSONString serializes null endTimeUtc', () => {
    const info = new GameInformation()
    info.endTimeUtc = null

    const json = info.toJSONString()
    const parsed = JSON.parse(json)

    expect(parsed.endTimeUtc).toBeNull()
  })

  it('fromJSONString restores basic fields', () => {
    const json = JSON.stringify({
      mod: 'ra',
      version: '1.0',
      mapUid: 'map123',
      mapTitle: 'RA Map',
      finalGameTick: 10000,
      startTimeUtc: '2024-07-01T08:00:00.000Z',
      endTimeUtc: '2024-07-01T09:00:00.000Z',
      players: [],
      disabledSpawnPoints: [],
      mapGenerationArgs: null,
    })

    const info = GameInformation.fromJSONString(json)
    expect(info).not.toBeNull()
    if (!info) return

    expect(info.mod).toBe('ra')
    expect(info.version).toBe('1.0')
    expect(info.mapUid).toBe('map123')
    expect(info.mapTitle).toBe('RA Map')
    expect(info.finalGameTick).toBe(10000)
    expect(info.startTimeUtc.toISOString()).toBe(
      '2024-07-01T08:00:00.000Z',
    )
    expect(info.endTimeUtc?.toISOString()).toBe(
      '2024-07-01T09:00:00.000Z',
    )
  })

  it('fromJSONString restores players', () => {
    const json = JSON.stringify({
      mod: 'cnc',
      version: '1.0',
      mapUid: 'mapX',
      mapTitle: 'Map X',
      finalGameTick: 0,
      startTimeUtc: '2024-01-01T00:00:00.000Z',
      endTimeUtc: null,
      players: [
        {
          playerName: 'Alice',
          playerId: 1,
          factionId: 'gdi',
          factionName: 'GDI',
          team: 1,
          spawnPoint: 0,
          isHuman: true,
          isBot: false,
          disconnectFrame: 0,
          winState: WinState.Won,
          outcomeTimestampUtc: '2024-02-02T12:00:00.000Z',
          playerActorId: 100,
        },
        {
          playerName: 'Bot1',
          playerId: 2,
          factionId: 'nod',
          factionName: 'Nod',
          team: 2,
          spawnPoint: 1,
          isHuman: false,
          isBot: true,
          disconnectFrame: 0,
          winState: WinState.Lost,
          outcomeTimestampUtc: null,
          playerActorId: null,
        },
      ],
      disabledSpawnPoints: [4, 5],
      mapGenerationArgs: null,
    })

    const info = GameInformation.fromJSONString(json)
    expect(info).not.toBeNull()
    if (!info) return

    expect(info.players).toHaveLength(2)
    expect(info.players[0].playerName).toBe('Alice')
    expect(info.players[0].winState).toBe(WinState.Won)
    expect(info.players[0].outcomeTimestampUtc).toBeInstanceOf(Date)
    expect(info.players[1].playerName).toBe('Bot1')
    expect(info.players[1].isBot).toBe(true)
    expect(info.players[1].outcomeTimestampUtc).toBeNull()
    expect(info.disabledSpawnPoints.has(4)).toBe(true)
    expect(info.disabledSpawnPoints.has(5)).toBe(true)
  })

  it('fromJSONString returns null for invalid JSON', () => {
    expect(GameInformation.fromJSONString('{invalid json')).toBeNull()
    expect(GameInformation.fromJSONString('')).toBeNull()
    expect(GameInformation.fromJSONString('not json at all')).toBeNull()
  })

  it('fromJSONString handles missing fields with defaults', () => {
    const json = JSON.stringify({
      mod: 'test',
    })

    const info = GameInformation.fromJSONString(json)
    expect(info).not.toBeNull()
    if (!info) return

    expect(info.mod).toBe('test')
    expect(info.version).toBe('')
    expect(info.mapUid).toBe('')
    expect(info.players).toEqual([])
    expect(info.disabledSpawnPoints).toBeInstanceOf(Set)
    expect(info.disabledSpawnPoints.size).toBe(0)
  })

  it('toJSONString fromJSONString round-trip preserves all data', () => {
    const original = new GameInformation()
    original.mod = 'cnc'
    original.version = 'release-20230225'
    original.mapUid = 'round-trip-map'
    original.mapTitle = 'Round Trip Map'
    original.finalGameTick = 9999
    original.startTimeUtc = new Date('2024-03-15T10:00:00.000Z')
    original.endTimeUtc = new Date('2024-03-15T10:45:00.000Z')

    const p1 = original.addPlayer('Human1')
    p1.playerId = 0
    p1.factionId = 'allies'
    p1.factionName = 'Allies'
    p1.isHuman = true
    p1.isBot = false
    p1.winState = WinState.Won

    const p2 = original.addPlayer('Bot1')
    p2.playerId = 1
    p2.factionId = 'soviet'
    p2.factionName = 'Soviet'
    p2.isHuman = false
    p2.isBot = true
    p2.disconnectFrame = 300
    p2.winState = WinState.Lost

    original.disabledSpawnPoints.add(7)

    const json = original.toJSONString()
    const restored = GameInformation.fromJSONString(json)

    expect(restored).not.toBeNull()
    if (!restored) return

    expect(restored.mod).toBe(original.mod)
    expect(restored.version).toBe(original.version)
    expect(restored.mapUid).toBe(original.mapUid)
    expect(restored.mapTitle).toBe(original.mapTitle)
    expect(restored.finalGameTick).toBe(original.finalGameTick)
    expect(restored.startTimeUtc.toISOString()).toBe(
      original.startTimeUtc.toISOString(),
    )
    expect(restored.endTimeUtc?.toISOString()).toBe(
      original.endTimeUtc?.toISOString(),
    )
    expect(restored.duration).toBe(original.duration)
    expect(restored.players).toHaveLength(2)
    expect(restored.players[0].playerName).toBe('Human1')
    expect(restored.players[0].winState).toBe(WinState.Won)
    expect(restored.players[1].playerName).toBe('Bot1')
    expect(restored.players[1].disconnectFrame).toBe(300)
    expect(restored.disconnectedPlayers()).toHaveLength(1)
    expect(restored.humanPlayers).toHaveLength(1)
    expect(restored.isSinglePlayer).toBe(true)
    expect(restored.disabledSpawnPoints.has(7)).toBe(true)
  })

  it('round-trip with null endTimeUtc', () => {
    const original = new GameInformation()
    original.mod = 'test'
    original.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    original.endTimeUtc = null

    const json = original.toJSONString()
    const restored = GameInformation.fromJSONString(json)

    expect(restored).not.toBeNull()
    if (!restored) return
    expect(restored.endTimeUtc).toBeNull()
    expect(restored.duration).toBe(0)
  })
})
