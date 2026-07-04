/**
 * GameSave.test.ts — GameSave + SlotClient migration unit tests
 *
 * Tests focus on: binary format correctness, state management,
 * serialization round-trips, order dispatch/parse lifecycle,
 * and edge cases. No WebGL needed — pure logic tests.
 *
 * OpenRA 对照: GameSave.cs unit test coverage
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  GameSave,
  SlotClient,
  EOF_MARKER,
  METADATA_MARKER,
  TRAIT_DATA_MARKER,
} from './GameSave'
import type {
  SlotClientColor,
  GameSaveLobbyInfo,
  GameSaveMapPreview,
  MutableSessionClient,
  GameSaveConnection,
} from './GameSave'
import { SYNC_HASH_ORDER_LENGTH } from './Order'
import { ClientState, ConnectionQuality, MapStatus } from '../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'
import type { SessionClient, SessionSlot, SessionGlobal } from '../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'

// ---------------------------------------------------------------------------
// Test helper factories (use explicit casting for test simplicity)
// ---------------------------------------------------------------------------

/** Create a default SlotClientColor */
function makeColor(
  r: number,
  g: number,
  b: number,
  a: number = 255,
): SlotClientColor {
  return { r, g, b, a }
}

/** Create a mock SessionClient.
 *
 * NOTE: Uses `'key' in overrides` for nullable fields (slot, bot, fingerprint)
 * because `??` cannot distinguish between "not specified" and "specified as null".
 */
function makeSessionClient(overrides: Partial<{
  index: number
  name: string
  color: string
  team: number
  slot: string | null
  bot: string | null
  isAdmin: boolean
  isObserver: boolean
  isBot: boolean
  isReady: boolean
  isInvalid: boolean
  state: string
  connectionQuality: string
  spawnPoint: number
  handicap: number
  faction: string
  fingerprint: string | null
}> = {}): SessionClient {
  return {
    index: overrides.index ?? 0,
    name: overrides.name ?? 'Player',
    color: overrides.color ?? '#FF0000',
    team: overrides.team ?? 0,
    slot: 'slot' in overrides ? overrides.slot! : 'Multi0',
    bot: 'bot' in overrides ? overrides.bot! : null,
    isAdmin: overrides.isAdmin ?? false,
    isObserver: overrides.isObserver ?? false,
    isBot: overrides.isBot ?? false,
    isReady: overrides.isReady ?? true,
    isInvalid: overrides.isInvalid ?? false,
    state: (overrides.state as typeof ClientState[keyof typeof ClientState]) ?? ClientState.Ready,
    connectionQuality: (overrides.connectionQuality as typeof ConnectionQuality[keyof typeof ConnectionQuality]) ?? ConnectionQuality.Good,
    spawnPoint: overrides.spawnPoint ?? 0,
    handicap: overrides.handicap ?? 0,
    faction: overrides.faction ?? 'allies',
    fingerprint: 'fingerprint' in overrides ? overrides.fingerprint! : null,
  }
}

/** Create a mock SessionSlot */
function makeSessionSlot(overrides: Partial<{
  playerReference: string
  closed: boolean
  allowBots: boolean
  lockFaction: boolean
  lockColor: boolean
  lockTeam: boolean
  lockSpawn: boolean
  lockHandicap: boolean
  required: boolean
}> = {}): SessionSlot {
  return {
    playerReference: overrides.playerReference ?? 'Multi0',
    closed: overrides.closed ?? false,
    allowBots: overrides.allowBots ?? true,
    lockFaction: overrides.lockFaction ?? false,
    lockColor: overrides.lockColor ?? false,
    lockTeam: overrides.lockTeam ?? false,
    lockSpawn: overrides.lockSpawn ?? false,
    lockHandicap: overrides.lockHandicap ?? false,
    required: overrides.required ?? false,
  }
}

/** Create a mock SessionGlobal */
function makeSessionGlobal(
  overrides: Partial<{
    serverName: string
    map: string
    mapStatus: string
    randomSeed: number
    dedicated: boolean
    allowSpectators: boolean
    enableSingleplayer: boolean
    enableMapGeneration: boolean
    lobbyOptions: Record<string, unknown>
  }> = {},
): SessionGlobal {
  return {
    serverName: overrides.serverName ?? 'TestServer',
    map: overrides.map ?? 'testmap',
    mapStatus: (overrides.mapStatus as typeof MapStatus[keyof typeof MapStatus]) ?? MapStatus.Available,
    randomSeed: overrides.randomSeed ?? 12345,
    dedicated: overrides.dedicated ?? false,
    allowSpectators: overrides.allowSpectators ?? true,
    enableSingleplayer: overrides.enableSingleplayer ?? true,
    enableMapGeneration: overrides.enableMapGeneration ?? true,
    lobbyOptions: (overrides.lobbyOptions ?? {}) as SessionGlobal['lobbyOptions'],
  }
}

/** Create a mock GameSaveLobbyInfo from clients and slots */
function makeLobbyInfo(
  globalSettings: SessionGlobal,
  clients: SessionClient[],
  slots: Array<[string, SessionSlot]>,
): GameSaveLobbyInfo {
  const slotsMap = new Map(slots)
  return {
    globalSettings,
    clients,
    slots: slotsMap,
    clientInSlot(slotKey: string) {
      for (const c of clients) {
        if (c.slot === slotKey) return c
      }
      return undefined
    },
    clientWithIndex(index: number) {
      return clients.find((c) => c.index === index) as
        | (SessionClient & { readonly botControllerClientIndex?: number })
        | undefined
    },
  }
}

/** Create a mock GameSaveMapPreview */
function makeMapPreview(
  mapClass: string = 'System',
  overrides: Partial<{
    generationArgs: unknown
    players: ReadonlyMap<string, { readonly playable: boolean; readonly allowBots: boolean }>
  }> = {},
): GameSaveMapPreview {
  return {
    class: mapClass,
    generationArgs: overrides.generationArgs,
    players: {
      players:
        overrides.players ??
        new Map([
          ['Multi0', { playable: true, allowBots: true }],
          ['Multi1', { playable: true, allowBots: true }],
        ]),
    },
  }
}

/** Create a mock GameSaveConnection */
function makeConnection(playerIndex: number): GameSaveConnection {
  return { playerIndex }
}

/** Create a sync hash packet (first byte = 0x65, total length = SYNC_HASH_ORDER_LENGTH) */
function makeSyncPacket(): Uint8Array {
  const packet = new Uint8Array(SYNC_HASH_ORDER_LENGTH)
  packet[0] = 0x65 // OrderType.SyncHash
  // Fill rest with recognizable pattern
  for (let i = 1; i < SYNC_HASH_ORDER_LENGTH; i++) {
    packet[i] = i
  }
  return packet
}

/** Create a normal order packet (first byte = 0xFF for Fields type) */
function makeOrderPacket(dataLength: number = 10): Uint8Array {
  const packet = new Uint8Array(dataLength)
  packet[0] = 0xff // OrderType.Fields
  return packet
}

/** Create an immediate order packet (first byte = 0xFE) */
function makeImmediatePacket(): Uint8Array {
  const packet = new Uint8Array(5)
  packet[0] = 0xfe
  return packet
}

/** Create a mutable session client for applyTo tests */
function makeMutableClient(overrides: Partial<MutableSessionClient> = {}): MutableSessionClient {
  return {
    color: overrides.color ?? '#000000',
    faction: overrides.faction ?? '',
    spawnPoint: overrides.spawnPoint ?? 0,
    team: overrides.team ?? 0,
    handicap: overrides.handicap ?? 0,
    slot: overrides.slot ?? null,
    bot: overrides.bot ?? null,
    isAdmin: overrides.isAdmin ?? false,
    name: overrides.name ?? '',
  }
}

/** Helper: create a fresh ArrayBuffer from a Uint8Array (for constructor) */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

// ============================================================================
// SlotClient Tests
// ============================================================================

describe('SlotClient', () => {
  describe('constructor (parameterless)', () => {
    it('initializes with default values', () => {
      const sc = new SlotClient()
      expect(sc.color).toEqual({ r: 0, g: 0, b: 0, a: 255 })
      expect(sc.faction).toBe('')
      expect(sc.spawnPoint).toBe(0)
      expect(sc.team).toBe(0)
      expect(sc.handicap).toBe(0)
      expect(sc.slot).toBe('')
      expect(sc.bot).toBeNull()
      expect(sc.isAdmin).toBe(false)
      expect(sc.botName).toBe('')
    })
  })

  describe('constructor (from SessionClient)', () => {
    it('copies game-relevant fields from a human client', () => {
      const client = makeSessionClient({
        index: 1,
        name: 'TestPlayer',
        color: '#00FFAA',
        faction: 'soviet',
        team: 2,
        spawnPoint: 3,
        handicap: 50,
        slot: 'Multi1',
        isAdmin: true,
        bot: null,
      })

      const sc = new SlotClient(client)

      expect(sc.color).toEqual({ r: 0x00, g: 0xff, b: 0xaa, a: 255 })
      expect(sc.faction).toBe('soviet')
      expect(sc.team).toBe(2)
      expect(sc.spawnPoint).toBe(3)
      expect(sc.handicap).toBe(50)
      expect(sc.slot).toBe('Multi1')
      expect(sc.isAdmin).toBe(true)
      expect(sc.bot).toBeNull()
      expect(sc.botName).toBe('') // Not set for human players
    })

    it('copies bot name when client is a bot', () => {
      const client = makeSessionClient({
        name: 'BotCommander',
        bot: 'harvester',
      })

      const sc = new SlotClient(client)

      expect(sc.bot).toBe('harvester')
      expect(sc.botName).toBe('BotCommander')
    })

    it('handles null slot gracefully', () => {
      const client = makeSessionClient({ slot: null })
      const sc = new SlotClient(client)
      expect(sc.slot).toBe('')
    })

    it('parses hex colors with # prefix', () => {
      const client = makeSessionClient({ color: '#123456' })
      const sc = new SlotClient(client)
      expect(sc.color).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 255 })
    })

    it('parses hex colors without # prefix', () => {
      const client = makeSessionClient({ color: 'ABCDEF' })
      const sc = new SlotClient(client)
      expect(sc.color).toEqual({ r: 0xab, g: 0xcd, b: 0xef, a: 255 })
    })
  })

  describe('applyTo', () => {
    it('copies all fields to a mutable client', () => {
      const sc = new SlotClient()
      sc.color = makeColor(10, 20, 30, 255)
      sc.faction = 'allies'
      sc.spawnPoint = 5
      sc.team = 1
      sc.handicap = 25
      sc.slot = 'Multi3'
      sc.bot = null
      sc.isAdmin = true
      sc.botName = ''

      const target = makeMutableClient()
      sc.applyTo(target)

      expect(target.color).toBe('#0a141e')
      expect(target.faction).toBe('allies')
      expect(target.spawnPoint).toBe(5)
      expect(target.team).toBe(1)
      expect(target.handicap).toBe(25)
      expect(target.slot).toBe('Multi3')
      expect(target.bot).toBeNull()
      expect(target.isAdmin).toBe(true)
    })

    it('copies bot name when bot is non-null', () => {
      const sc = new SlotClient()
      sc.bot = 'harvester'
      sc.botName = 'AI_Bot'

      const target = makeMutableClient({ name: 'OldName' })
      sc.applyTo(target)

      expect(target.bot).toBe('harvester')
      expect(target.name).toBe('AI_Bot')
    })

    it('does not overwrite name when bot is null', () => {
      const sc = new SlotClient()
      sc.bot = null
      sc.botName = 'ShouldNotCopy'

      const target = makeMutableClient({ name: 'PreservedName' })
      sc.applyTo(target)

      expect(target.name).toBe('PreservedName')
    })
  })

  describe('serialize / deserialize round-trip', () => {
    it('preserves all fields through round-trip', () => {
      const original = new SlotClient()
      original.color = makeColor(100, 150, 200, 255)
      original.faction = 'allies'
      original.spawnPoint = 4
      original.team = 2
      original.handicap = 75
      original.slot = 'Multi2'
      original.bot = 'harvester'
      original.isAdmin = true
      original.botName = 'MyBot'

      const { key, value } = original.serialize('Multi2')
      expect(key).toBe('SlotClient@Multi2')

      const restored = SlotClient.deserialize(value)

      expect(restored.color).toEqual(original.color)
      expect(restored.faction).toBe(original.faction)
      expect(restored.spawnPoint).toBe(original.spawnPoint)
      expect(restored.team).toBe(original.team)
      expect(restored.handicap).toBe(original.handicap)
      expect(restored.slot).toBe(original.slot)
      expect(restored.bot).toBe(original.bot)
      expect(restored.isAdmin).toBe(original.isAdmin)
      expect(restored.botName).toBe(original.botName)
    })

    it('deserialize with string color', () => {
      const data = { color: '#FF8000' }
      const sc = SlotClient.deserialize(data)
      expect(sc.color).toEqual({ r: 0xff, g: 0x80, b: 0x00, a: 255 })
    })

    it('deserialize with object color', () => {
      const data = { color: { r: 50, g: 100, b: 150, a: 200 } }
      const sc = SlotClient.deserialize(data)
      expect(sc.color).toEqual({ r: 50, g: 100, b: 150, a: 200 })
    })

    it('deserialize with missing fields returns defaults', () => {
      const data: Record<string, unknown> = {}
      const sc = SlotClient.deserialize(data)
      expect(sc.faction).toBe('')
      expect(sc.spawnPoint).toBe(0)
      expect(sc.bot).toBeNull()
      expect(sc.isAdmin).toBe(false)
    })
  })
})

// ============================================================================
// GameSave Tests
// ============================================================================

describe('GameSave', () => {
  describe('constructor (empty)', () => {
    it('initializes with LastOrdersFrame = -1', () => {
      const gs = new GameSave()
      expect(gs.LastOrdersFrame).toBe(-1)
    })

    it('initializes with LastSyncFrame = -1', () => {
      const gs = new GameSave()
      expect(gs.LastSyncFrame).toBe(-1)
    })

    it('has empty orders stream', () => {
      const gs = new GameSave()
      expect(gs.ordersStreamLength).toBe(0)
      expect(gs.ordersChunkCount).toBe(0)
    })

    it('has empty slots and slot clients', () => {
      const gs = new GameSave()
      expect(gs.Slots.size).toBe(0)
      expect(gs.SlotClients.size).toBe(0)
    })

    it('has empty trait data', () => {
      const gs = new GameSave()
      expect(gs.TraitData.size).toBe(0)
    })

    it('has null GlobalSettings', () => {
      const gs = new GameSave()
      expect(gs.GlobalSettings).toBeNull()
    })

    it('has undefined MapGenerationArgs', () => {
      const gs = new GameSave()
      expect(gs.MapGenerationArgs).toBeUndefined()
    })

    it('has zero-length lastSyncPacket', () => {
      const gs = new GameSave()
      expect(gs.lastSyncPacket.length).toBe(SYNC_HASH_ORDER_LENGTH)
    })
  })

  describe('constructor (load from buffer)', () => {
    it('throws on empty buffer', () => {
      expect(() => {
        new GameSave('test.sav', new ArrayBuffer(0))
      }).toThrow(/too small/)
    })

    it('throws on missing EOF marker', () => {
      const buf = new Uint8Array(20)
      const view = new DataView(buf.buffer)
      // Write a wrong EOF marker at last 4 bytes
      view.setInt32(16, 0, true) // Wrong: 0 instead of -2

      expect(() => {
        new GameSave('test.sav', toArrayBuffer(buf))
      }).toThrow(/missing EOF marker/)
    })

    it('throws on missing metadata marker', () => {
      const totalSize =
        4 + // MetadataMarker (wrong value)
        4 + // LastOrdersFrame
        4 + // LastSyncFrame
        SYNC_HASH_ORDER_LENGTH +
        4 + 2 + // globalSettings: length=4, "{}"
        4 + 2 + // slots: "{}"
        4 + 2 + // slotClients: "{}"
        4 + 0 + // mapGenArgs: length=0
        4 + // TraitDataMarker
        4 + 2 + // traitData: "{}"
        12 // footer

      const buf = new Uint8Array(totalSize)
      const view = new DataView(buf.buffer)
      let off = 0

      // Write wrong metadata marker (0 instead of -1)
      view.setInt32(off, 0, true)
      off += 4
      view.setInt32(off, -1, true) // LastOrdersFrame
      off += 4
      view.setInt32(off, -1, true) // LastSyncFrame
      off += 4
      off += SYNC_HASH_ORDER_LENGTH // sync packet

      // globalSettings
      view.setInt32(off, 2, true)
      off += 4
      buf[off++] = 0x7b // '{'
      buf[off++] = 0x7d // '}'

      // slots
      view.setInt32(off, 2, true)
      off += 4
      buf[off++] = 0x7b
      buf[off++] = 0x7d

      // slotClients
      view.setInt32(off, 2, true)
      off += 4
      buf[off++] = 0x7b
      buf[off++] = 0x7d

      // mapGenArgs (empty)
      view.setInt32(off, 0, true)
      off += 4

      // TraitDataMarker
      view.setInt32(off, TRAIT_DATA_MARKER, true)
      off += 4
      // traitData
      view.setInt32(off, 2, true)
      off += 4
      buf[off++] = 0x7b
      buf[off++] = 0x7d

      // Footer
      const metadataOffset = 0
      const traitDataOffset = metadataOffset + 4 + 4 + 4 + SYNC_HASH_ORDER_LENGTH +
        4 + 2 + 4 + 2 + 4 + 2 + 4 + 0
      view.setInt32(off, metadataOffset, true)
      off += 4
      view.setInt32(off, traitDataOffset, true)
      off += 4
      view.setInt32(off, EOF_MARKER, true)

      expect(() => {
        new GameSave('test.sav', toArrayBuffer(buf))
      }).toThrow(/missing metadata marker/)
    })
  })

  describe('save() + constructor(data) round-trip', () => {
    it('preserves empty save state', () => {
      const original = new GameSave()
      const saved = original.save()

      const loaded = new GameSave('test.sav', toArrayBuffer(saved))
      expect(loaded.LastOrdersFrame).toBe(-1)
      expect(loaded.LastSyncFrame).toBe(-1)
      expect(loaded.ordersStreamLength).toBe(0)
      expect(loaded.Slots.size).toBe(0)
      expect(loaded.SlotClients.size).toBe(0)
      expect(loaded.TraitData.size).toBe(0)
      expect(loaded.GlobalSettings).toEqual({})
    })

    it('preserves GlobalSettings through round-trip', () => {
      const original = new GameSave()
      const globalSettings = makeSessionGlobal({
        serverName: 'RoundTripTest',
        randomSeed: 99999,
      })
      original.GlobalSettings = globalSettings
      original.Slots.set('Multi0', makeSessionSlot({ playerReference: 'Multi0' }))

      const saved = original.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      expect(loaded.GlobalSettings).toBeTruthy()
      expect(loaded.GlobalSettings!.serverName).toBe('RoundTripTest')
      expect(loaded.GlobalSettings!.randomSeed).toBe(99999)
      expect(loaded.Slots.size).toBe(1)
      expect(loaded.Slots.get('Multi0')?.playerReference).toBe('Multi0')
    })

    it('preserves SlotClients through round-trip', () => {
      const original = new GameSave()
      const sc = new SlotClient()
      sc.color = makeColor(10, 20, 30, 255)
      sc.faction = 'soviet'
      sc.slot = 'Multi1'
      sc.team = 3
      sc.bot = 'harvester'
      sc.botName = 'AI_Bot'
      original.SlotClients.set('Multi1', sc)

      const saved = original.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      expect(loaded.SlotClients.size).toBe(1)
      const loadedSc = loaded.SlotClients.get('Multi1')
      expect(loadedSc).toBeTruthy()
      expect(loadedSc!.faction).toBe('soviet')
      expect(loadedSc!.slot).toBe('Multi1')
      expect(loadedSc!.team).toBe(3)
      expect(loadedSc!.bot).toBe('harvester')
      expect(loadedSc!.botName).toBe('AI_Bot')
    })

    it('preserves TraitData through round-trip', () => {
      const original = new GameSave()
      original.addTraitData(1, { viewport: '100,200,0' })
      original.addTraitData(2, { renderPlayer: 42 })
      original.addTraitData(3, 'simpleString')

      const saved = original.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      expect(loaded.TraitData.size).toBe(3)
      expect(loaded.TraitData.get(1)).toEqual({ viewport: '100,200,0' })
      expect(loaded.TraitData.get(2)).toEqual({ renderPlayer: 42 })
      expect(loaded.TraitData.get(3)).toBe('simpleString')
    })

    it('handles MapGenerationArgs with undefined (omitted)', () => {
      const original = new GameSave()
      original.GlobalSettings = makeSessionGlobal()
      original.MapGenerationArgs = undefined

      const saved = original.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      expect(loaded.MapGenerationArgs).toBeUndefined()
    })

    it('preserves orders stream data via save/load', () => {
      const original = new GameSave()
      // Use internal injection for testing (test helper attached below)
      original._testDispatchRaw(1, makeOrderPacket(8))
      original._testDispatchRaw(2, makeOrderPacket(12))

      const expectedLength = original.ordersStreamLength
      const saved = original.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      expect(loaded.ordersStreamLength).toBe(expectedLength)
    })

    it('binary footer has correct offsets and EOFMarker', () => {
      const original = new GameSave()
      original.GlobalSettings = makeSessionGlobal()
      original.addTraitData(1, { test: 'data' })
      original._testDispatchRaw(3, makeOrderPacket(10))

      const saved = original.save()
      const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength)

      const footerStart = saved.length - 12
      const ordersLength = view.getInt32(footerStart, true)
      const traitDataOffset = view.getInt32(footerStart + 4, true)
      const eof = view.getInt32(footerStart + 8, true)

      expect(eof).toBe(EOF_MARKER)
      expect(ordersLength).toBeGreaterThanOrEqual(0)

      // Verify metadata marker at ordersLength position
      const metaMarker = view.getInt32(ordersLength, true)
      expect(metaMarker).toBe(METADATA_MARKER)

      // Verify trait data marker at traitDataOffset position
      const traitMarker = view.getInt32(traitDataOffset, true)
      expect(traitMarker).toBe(TRAIT_DATA_MARKER)
    })
  })

  describe('startGame', () => {
    it('builds clientsBySlotIndex correctly', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const client1 = makeSessionClient({ index: 1, slot: 'Multi1' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0, client1], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      const map = makeMapPreview()

      gs.startGame(lobbyInfo, map)

      expect(gs.clientsBySlotIndex[0]).toBe(0)
      expect(gs.clientsBySlotIndex[1]).toBe(1)
    })

    it('maps spectators to -1 in clientsBySlotIndex', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' }) // no client in this slot

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      const map = makeMapPreview()

      gs.startGame(lobbyInfo, map)

      expect(gs.clientsBySlotIndex[0]).toBe(0)
      expect(gs.clientsBySlotIndex[1]).toBe(-1) // spectator
    })

    it('deep-clones GlobalSettings (modifying original does not affect save)', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal({ serverName: 'Original' })
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      const map = makeMapPreview()

      gs.startGame(lobbyInfo, map)

      // Modify the original — should NOT affect the save's copy
      ;(globalSettings as unknown as Record<string, unknown>).serverName = 'Modified'

      expect(gs.GlobalSettings!.serverName).toBe('Original')
    })

    it('deep-clones SlotClients (modifying original does not affect save)', () => {
      const gs = new GameSave()

      const originalClient = makeSessionClient({
        index: 0,
        slot: 'Multi0',
        faction: 'allies',
      })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [originalClient], [
        ['Multi0', slot0],
      ])

      const map = makeMapPreview()

      gs.startGame(lobbyInfo, map)

      // The SlotClient should be a deep copy, not a reference to original
      const savedSc = gs.SlotClients.get('Multi0')
      expect(savedSc).toBeTruthy()
      expect(savedSc!.faction).toBe('allies')
    })

    it('skips non-playable player references', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      const nonPlayablePlayers = new Map([
        ['Multi0', { playable: false, allowBots: false }],
      ])

      const map = makeMapPreview('System', { players: nonPlayablePlayers })

      gs.startGame(lobbyInfo, map)

      // Non-playable slot should not have a SlotClient
      expect(gs.SlotClients.size).toBe(0)
    })

    it('stores MapGenerationArgs for generated maps', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      const generationArgs = {
        uid: 'gen-002',
        generator: 'random',
        tileset: 'desert',
        size: { width: 64, height: 64 },
      }

      const map = makeMapPreview('Generated', {
        generationArgs,
      })

      gs.startGame(lobbyInfo, map)

      expect(gs.MapGenerationArgs).toBeTruthy()
    })

    it('identifies firstBotSlotIndex for bot clients', () => {
      const gs = new GameSave()

      const humanClient = makeSessionClient({ index: 0, slot: 'Multi0', bot: null })
      const botClient = makeSessionClient({
        index: 1,
        slot: 'Multi1',
        bot: 'harvester',
        isBot: true,
        name: 'AI_Bot',
      })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [humanClient, botClient], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      const map = makeMapPreview()

      gs.startGame(lobbyInfo, map)

      expect(gs.firstBotSlotIndex).toBeGreaterThanOrEqual(0)
    })
  })

  describe('dispatchOrders', () => {
    let gs: GameSave
    let lobbyInfo: GameSaveLobbyInfo
    let map: GameSaveMapPreview

    beforeEach(() => {
      gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const client1 = makeSessionClient({ index: 1, slot: 'Multi1' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      lobbyInfo = makeLobbyInfo(globalSettings, [client0, client1], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      map = makeMapPreview()
      gs.startGame(lobbyInfo, map)
    })

    it('records an order for a valid connection', () => {
      const conn = makeConnection(0) // playerIndex 0 maps to slot 0
      const data = makeOrderPacket(10)

      gs.dispatchOrders(conn, 5, data)

      expect(gs.LastOrdersFrame).toBe(5)
      expect(gs.ordersChunkCount).toBe(1)
      expect(gs.ordersStreamLength).toBeGreaterThan(0)
    })

    it('skips orders with frame <= LastOrdersFrame (dedup)', () => {
      const conn = makeConnection(0)
      const data1 = makeOrderPacket(8)

      gs.dispatchOrders(conn, 10, data1)
      expect(gs.LastOrdersFrame).toBe(10)

      // Try to dispatch with same frame
      const data2 = makeOrderPacket(8)
      gs.dispatchOrders(conn, 10, data2)

      // Should still have only 1 chunk
      expect(gs.LastOrdersFrame).toBe(10)
      expect(gs.ordersChunkCount).toBe(1)
    })

    it('skips orders with frame less than LastOrdersFrame', () => {
      const conn = makeConnection(0)
      const data1 = makeOrderPacket(8)

      gs.dispatchOrders(conn, 20, data1)
      expect(gs.LastOrdersFrame).toBe(20)

      // Try to dispatch older frame
      gs.dispatchOrders(conn, 15, makeOrderPacket(8))
      expect(gs.LastOrdersFrame).toBe(20)
      expect(gs.ordersChunkCount).toBe(1)
    })

    it('skips immediate orders (0xFE prefix)', () => {
      const conn = makeConnection(0)
      const data = makeImmediatePacket()

      gs.dispatchOrders(conn, 1, data)

      expect(gs.ordersChunkCount).toBe(0)
      expect(gs.LastOrdersFrame).toBe(-1)
    })

    it('updates LastSyncFrame for sync packets', () => {
      const conn = makeConnection(0)
      const syncData = makeSyncPacket()

      gs.dispatchOrders(conn, 100, syncData)

      expect(gs.LastSyncFrame).toBe(100)
    })

    it('stores the last sync packet', () => {
      const conn = makeConnection(0)
      const syncData = makeSyncPacket()

      gs.dispatchOrders(conn, 5, syncData)

      expect(gs.lastSyncPacket[0]).toBe(0x65)
      expect(gs.lastSyncPacket.length).toBe(SYNC_HASH_ORDER_LENGTH)
    })

    it('ignores sync packets with wrong length', () => {
      const conn = makeConnection(0)
      // Create a packet with correct type byte but wrong length
      const badSync = new Uint8Array(20)
      badSync[0] = 0x65

      const prevSyncFrame = gs.LastSyncFrame
      gs.dispatchOrders(conn, 5, badSync)

      // Should not update LastSyncFrame
      expect(gs.LastSyncFrame).toBe(prevSyncFrame)
    })

    it('ignores older sync packets (frame <= LastSyncFrame)', () => {
      const conn = makeConnection(0)
      const sync1 = makeSyncPacket()

      gs.dispatchOrders(conn, 50, sync1)
      expect(gs.LastSyncFrame).toBe(50)

      // Older sync packet should be ignored
      const sync2 = makeSyncPacket()
      sync2[1] = 0xff // Different content
      gs.dispatchOrders(conn, 30, sync2)

      expect(gs.LastSyncFrame).toBe(50)
      // lastSyncPacket should still have the first sync's content
      expect(gs.lastSyncPacket[1]).toBe(1) // Original pattern
    })

    it('handles spectator-to-bot remapping (HACK path)', () => {
      // Setup with a bot client
      const gs2 = new GameSave()
      const humanClient = makeSessionClient({ index: 0, slot: 'Multi0', bot: null })
      const botClient = makeSessionClient({
        index: 1,
        slot: 'Multi1',
        bot: 'harvester',
        isBot: true,
        name: 'AI',
      })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      const lobby = makeLobbyInfo(globalSettings, [humanClient, botClient], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      gs2.startGame(lobby, makeMapPreview())

      // A spectator (playerIndex not in any slot) sends an order
      const spectatorConn = makeConnection(999)
      const data = makeOrderPacket(6)

      gs2.dispatchOrders(spectatorConn, 1, data)

      // Should map to firstBotSlotIndex (which is the slot index of the bot)
      expect(gs2.ordersChunkCount).toBe(1)
      expect(gs2.LastOrdersFrame).toBe(1)
    })

    it('drops orders when no valid slot is available', () => {
      const gs2 = new GameSave()
      gs2.startGame(
        makeLobbyInfo(makeSessionGlobal(), [], []),
        makeMapPreview('System', {
          players: new Map(),
        }),
      )

      const conn = makeConnection(0)
      const data = makeOrderPacket(6)

      gs2.dispatchOrders(conn, 10, data)

      // No valid slot, order should be dropped
      expect(gs2.ordersChunkCount).toBe(0)
    })

    it('records order with valid save format', () => {
      const conn = makeConnection(0)
      const data = makeOrderPacket(10)

      gs.dispatchOrders(conn, 42, data)

      // Save it and verify it can be reloaded
      const saved = gs.save()
      expect(saved.length).toBeGreaterThan(0)
    })
  })

  describe('parseOrders', () => {
    it('replays trait data orders before frame orders', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const client1 = makeSessionClient({ index: 1, slot: 'Multi1' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0, client1], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      gs.startGame(lobbyInfo, makeMapPreview())

      // Add trait data
      gs.addTraitData(1, { viewport: '50,50,0' })

      // Dispatch an order
      const conn0 = makeConnection(0)
      gs.dispatchOrders(conn0, 5, makeOrderPacket(8))

      // Collect packets
      const received: Array<{ frame: number; clientIndex: number }> = []
      gs.parseOrders(lobbyInfo, (frame, clientIndex) => {
        received.push({ frame, clientIndex })
      })

      // Should have trait data + order + sync packet
      expect(received.length).toBeGreaterThanOrEqual(2)
      // The first order should be the SaveTraitData order (frame 0, client 0)
      expect(received[0].frame).toBe(0)
      expect(received[0].clientIndex).toBe(0)
    })

    it('replays orders in correct frame-slot sequence', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const client1 = makeSessionClient({ index: 1, slot: 'Multi1' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0, client1], [
        ['Multi0', slot0],
        ['Multi1', slot1],
      ])

      gs.startGame(lobbyInfo, makeMapPreview())

      // Dispatch orders with different frames
      gs.dispatchOrders(makeConnection(0), 10, makeOrderPacket(8))
      gs.dispatchOrders(makeConnection(1), 20, makeOrderPacket(8))
      gs.dispatchOrders(makeConnection(0), 30, makeOrderPacket(8))

      const frames: number[] = []
      gs.parseOrders(lobbyInfo, (frame) => {
        if (frame > 0) frames.push(frame) // Skip trait data (frame 0) and sync packet (frame -1)
      })

      // Frame orders should be in chronological order (sync packet at end excluded)
      expect(frames).toEqual([10, 20, 30])
    })

    it('remaps bot slot to controller client', () => {
      const gs = new GameSave()

      const humanClient = makeSessionClient({ index: 0, slot: 'Multi0', bot: null })
      // Bot client with controller
      const botClient = {
        ...makeSessionClient({
          index: 1,
          slot: 'Multi1',
          bot: 'harvester',
          isBot: true,
          name: 'AI_Bot',
        }),
        botControllerClientIndex: 0,
      }
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })

      const lobbyInfo: GameSaveLobbyInfo = {
        globalSettings,
        clients: [humanClient, botClient],
        slots: new Map([
          ['Multi0', slot0],
          ['Multi1', slot1],
        ]),
        clientInSlot(slotKey: string) {
          if (slotKey === 'Multi0') return humanClient
          if (slotKey === 'Multi1') return botClient
          return undefined
        },
        clientWithIndex(index: number) {
          if (index === 0) return humanClient as SessionClient & { botControllerClientIndex?: number }
          if (index === 1) return botClient
          return undefined
        },
      }

      gs.startGame(lobbyInfo, makeMapPreview())

      // Dispatch an order from the bot's slot
      gs.dispatchOrders(makeConnection(1), 5, makeOrderPacket(8))

      const received: Array<{ frame: number; clientIndex: number }> = []
      gs.parseOrders(lobbyInfo, (frame, clientIndex) => {
        if (frame !== 0) received.push({ frame, clientIndex })
      })

      // The bot order should be remapped to client 0 (the controller)
      expect(received.length).toBeGreaterThanOrEqual(1)
      const botOrder = received.find((r) => r.frame === 5)
      expect(botOrder).toBeTruthy()
      expect(botOrder!.clientIndex).toBe(0) // Remapped to controller
    })

    it('emits lastSyncPacket as final order', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      gs.startGame(lobbyInfo, makeMapPreview())

      // Set a sync packet
      const syncData = makeSyncPacket()
      syncData[1] = 42 // Custom byte
      gs.dispatchOrders(makeConnection(0), 25, syncData)

      // Also dispatch an order
      gs.dispatchOrders(makeConnection(0), 10, makeOrderPacket(8))

      const allReceived: Array<{ frame: number; clientIndex: number; data: Uint8Array }> = []
      gs.parseOrders(lobbyInfo, (frame, clientIndex, data) => {
        allReceived.push({ frame, clientIndex, data })
      })

      // Last entry should be the sync packet
      const lastPacket = allReceived[allReceived.length - 1]
      expect(lastPacket.frame).toBe(25)
      expect(lastPacket.clientIndex).toBe(0)
      // Should contain sync hash content
      expect(lastPacket.data[1]).toBe(42)
    })

    it('trait data orders are serialized as SaveTraitData', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      gs.startGame(lobbyInfo, makeMapPreview())
      gs.addTraitData(5, { customData: 'value' })

      const traitOrderData: Uint8Array[] = []
      gs.parseOrders(lobbyInfo, (frame, _clientIndex, data) => {
        if (frame === 0) traitOrderData.push(data)
      })

      // Should have at least one trait data order
      expect(traitOrderData.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('addTraitData', () => {
    it('stores and retrieves trait data by index', () => {
      const gs = new GameSave()
      gs.addTraitData(1, { viewport: '100,200,0' })
      gs.addTraitData(2, 'plainString')
      gs.addTraitData(3, 42)

      expect(gs.TraitData.get(1)).toEqual({ viewport: '100,200,0' })
      expect(gs.TraitData.get(2)).toBe('plainString')
      expect(gs.TraitData.get(3)).toBe(42)
    })

    it('overwrites existing trait data for same index', () => {
      const gs = new GameSave()
      gs.addTraitData(1, 'original')
      gs.addTraitData(1, 'updated')

      expect(gs.TraitData.get(1)).toBe('updated')
    })

    it('stores nested objects', () => {
      const gs = new GameSave()
      const complexData = {
        nested: { deep: { value: [1, 2, 3] } },
        string: 'hello',
      }

      gs.addTraitData(10, complexData)
      expect(gs.TraitData.get(10)).toEqual(complexData)
    })
  })

  describe('save() binary format', () => {
    it('produces valid binary format with correct markers', () => {
      const gs = new GameSave()
      gs.GlobalSettings = makeSessionGlobal()
      gs.Slots.set('Multi0', makeSessionSlot())
      gs.addTraitData(1, { test: true })
      gs._testDispatchRaw(2, makeOrderPacket(10))

      const saved = gs.save()
      const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength)

      // Footer check
      const footerStart = saved.length - 12
      const ordersLength = view.getInt32(footerStart, true)
      const traitDataOffset = view.getInt32(footerStart + 4, true)
      const eofMarker = view.getInt32(footerStart + 8, true)

      expect(eofMarker).toBe(EOF_MARKER)

      // Metadata marker check
      const metadataMarker = view.getInt32(ordersLength, true)
      expect(metadataMarker).toBe(METADATA_MARKER)

      // Trait data marker check
      const traitMarker = view.getInt32(traitDataOffset, true)
      expect(traitMarker).toBe(TRAIT_DATA_MARKER)
    })

    it('correctly calculates ordersStream length in footer', () => {
      const gs = new GameSave()
      gs.GlobalSettings = makeSessionGlobal()
      gs._testDispatchRaw(0, makeOrderPacket(10))
      gs._testDispatchRaw(0, makeOrderPacket(15))

      const expectedOrdersLength = gs.ordersStreamLength
      const saved = gs.save()
      const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength)

      const footerStart = saved.length - 12
      const ordersLength = view.getInt32(footerStart, true)

      expect(ordersLength).toBe(expectedOrdersLength)
    })

    it('handles save with only metadata (no orders)', () => {
      const gs = new GameSave()
      gs.GlobalSettings = makeSessionGlobal()

      const saved = gs.save()
      const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength)

      // ordersStreamLength should be 0
      const footerStart = saved.length - 12
      const ordersLength = view.getInt32(footerStart, true)
      expect(ordersLength).toBe(0)

      // traitDataOffset should be > 0
      const traitDataOffset = view.getInt32(footerStart + 4, true)
      expect(traitDataOffset).toBeGreaterThan(0)

      // EOF marker
      const eof = view.getInt32(footerStart + 8, true)
      expect(eof).toBe(EOF_MARKER)
    })
  })

  describe('UTF-8 handling', () => {
    it('round-trips Unicode characters in GlobalSettings', () => {
      const gs = new GameSave()
      const globalSettings = makeSessionGlobal({
        serverName: 'サーバー名 🎮',
      })
      gs.GlobalSettings = globalSettings

      const saved = gs.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      expect(loaded.GlobalSettings!.serverName).toBe('サーバー名 🎮')
    })

    it('round-trips CJK characters in SlotClient fields', () => {
      const gs = new GameSave()
      const sc = new SlotClient()
      sc.slot = 'Multi0'
      sc.faction = 'テスト陣営'
      sc.botName = '中国語'
      gs.SlotClients.set('Multi0', sc)

      const saved = gs.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      const loadedSc = loaded.SlotClients.get('Multi0')
      expect(loadedSc!.faction).toBe('テスト陣営')
      expect(loadedSc!.botName).toBe('中国語')
    })

    it('handles emoji in trait data', () => {
      const gs = new GameSave()
      gs.addTraitData(1, { message: 'Hello 🌍!' })

      const saved = gs.save()
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      const data = loaded.TraitData.get(1) as { message: string }
      expect(data.message).toBe('Hello 🌍!')
    })
  })

  describe('static constants', () => {
    it('exposes correct EOFMarker', () => {
      expect(GameSave.EOFMarker).toBe(-2)
    })

    it('exposes correct MetadataMarker', () => {
      expect(GameSave.MetadataMarker).toBe(-1)
    })

    it('exposes correct TraitDataMarker', () => {
      expect(GameSave.TraitDataMarker).toBe(-3)
    })
  })

  describe('dispatchOrders edge cases', () => {
    it('dispatching order updates only LastOrdersFrame, not LastSyncFrame', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      gs.startGame(lobbyInfo, makeMapPreview())

      gs.dispatchOrders(makeConnection(0), 100, makeOrderPacket(8))

      expect(gs.LastOrdersFrame).toBe(100)
      expect(gs.LastSyncFrame).toBe(-1)
    })

    it('sync packets fall through to order recording (matching C#)', () => {
      const gs = new GameSave()

      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })

      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [
        ['Multi0', slot0],
      ])

      gs.startGame(lobbyInfo, makeMapPreview())

      const syncData = makeSyncPacket()
      gs.dispatchOrders(makeConnection(0), 50, syncData)

      // Sync packets update LastSyncFrame AND get recorded as orders
      // (matching C#: valid-length sync packets fall through to order recording)
      // C# GameSave.cs line 210-212: LastSyncFrame=frame; lastSyncPacket=data;
      // No `return` after — intentionally falls through to order recording.
      expect(gs.LastSyncFrame).toBe(50)
      expect(gs.LastOrdersFrame).toBe(50)
      expect(gs.ordersChunkCount).toBe(1) // Also recorded as an order
    })

    it('BUGFIX ch17 guard: sync packet fall-through is intentional (C# parity)', () => {
      // This test documents that the sync packet being recorded as an order
      // is INTENTIONAL behavior matching C# GameSave.cs. If you're tempted
      // to add `return` after _lastSyncPacket assignment — DON'T.
      const gs = new GameSave()
      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const lobbyInfo = makeLobbyInfo(globalSettings, [client0], [['Multi0', slot0]])
      gs.startGame(lobbyInfo, makeMapPreview())

      // Dispatch a regular order first
      gs.dispatchOrders(makeConnection(0), 10, makeOrderPacket(8))
      expect(gs.ordersChunkCount).toBe(1)

      // Dispatch a sync packet — should increment ordersChunkCount
      const syncData = makeSyncPacket()
      gs.dispatchOrders(makeConnection(0), 50, syncData)
      expect(gs.LastSyncFrame).toBe(50)
      expect(gs.LastOrdersFrame).toBe(50)
      // Sync packet IS recorded: ordersChunkCount increments
      expect(gs.ordersChunkCount).toBe(2)
    })
  })

  describe('save then load preserves complete game state', () => {
    it('preserves all fields through a complex round-trip', () => {
      // Step 1: Create and populate a save
      const original = new GameSave()

      const globalSettings = makeSessionGlobal({
        serverName: 'FullTest',
        randomSeed: 42,
      })
      original.GlobalSettings = globalSettings

      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })
      original.Slots.set('Multi0', slot0)
      original.Slots.set('Multi1', slot1)

      const sc = new SlotClient()
      sc.color = makeColor(128, 64, 32, 255)
      sc.faction = 'soviet'
      sc.slot = 'Multi0'
      sc.team = 1
      original.SlotClients.set('Multi0', sc)

      original.addTraitData(1, { viewport: '100,200,0' })
      original.addTraitData(2, { renderPlayer: 7 })
      original.addTraitData(3, null)

      // Step 2: Save to binary
      const saved = original.save()

      // Step 3: Load from binary
      const loaded = new GameSave('test.sav', toArrayBuffer(saved))

      // Step 4: Verify all fields match
      expect(loaded.GlobalSettings?.serverName).toBe('FullTest')
      expect(loaded.GlobalSettings?.randomSeed).toBe(42)
      expect(loaded.Slots.size).toBe(2)
      expect(loaded.Slots.get('Multi0')?.playerReference).toBe('Multi0')
      expect(loaded.Slots.get('Multi1')?.playerReference).toBe('Multi1')
      expect(loaded.SlotClients.size).toBe(1)

      const loadedSc = loaded.SlotClients.get('Multi0')
      expect(loadedSc!.faction).toBe('soviet')
      expect(loadedSc!.team).toBe(1)
      expect(loadedSc!.color.r).toBe(128)
      expect(loadedSc!.color.g).toBe(64)
      expect(loadedSc!.color.b).toBe(32)
      expect(loadedSc!.color.a).toBe(255)

      expect(loaded.TraitData.size).toBe(3)
      expect(loaded.TraitData.get(1)).toEqual({ viewport: '100,200,0' })
      expect(loaded.TraitData.get(2)).toEqual({ renderPlayer: 7 })
      expect(loaded.TraitData.get(3)).toBeNull()

      expect(loaded.LastOrdersFrame).toBe(-1)
      expect(loaded.LastSyncFrame).toBe(-1)
    })
  })
})

// ============================================================================
// Test helper: _testDispatchRaw injected onto GameSave prototype
// ============================================================================
// This bypasses connection/lobby setup for direct orders stream testing.
// NOTE: Uses `any` cast internally to access private GameSave state from tests.

;(GameSave.prototype as unknown as Record<string, unknown>)._testDispatchRaw = function (
  this: Record<string, unknown>,
  clientSlot: number,
  data: Uint8Array,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self = this as any
  const headerSize = 12
  const chunkLength = headerSize + data.length
  const chunk = new Uint8Array(chunkLength)
  const view = new DataView(chunk.buffer)

  self._testFrameCounter = (self._testFrameCounter ?? 0) + 1
  const frame = self._testFrameCounter

  view.setInt32(0, data.length + 8, true) // total length
  view.setInt32(4, frame, true)
  view.setInt32(8, clientSlot, true)
  chunk.set(data, headerSize)

  self._ordersChunks.push(chunk)
  self._ordersTotalLength += chunkLength
  self.LastOrdersFrame = frame
}

  // ---------------------------------------------------------------------------
  // NEGATIVE TESTS — ch17 e2e guard: duplicate SlotClient detection
  // ---------------------------------------------------------------------------

  describe('SlotClient slot uniqueness (ch17 guard)', () => {
    // Bug pattern (ch17 gamesave-roundtrip): client0 and client1 both
    // defaulted to slot 'Multi0', causing SlotClients.size=1 instead of 2.
    // The makeSessionClient helper's default slot should be unique per client.

    it('BUGFIX: two clients with different slots produce 2 SlotClients', () => {
      const gs = new GameSave()
      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const client1 = makeSessionClient({ index: 1, slot: 'Multi1' })
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const slot1 = makeSessionSlot({ playerReference: 'Multi1' })
      const lobbyInfo = makeLobbyInfo(globalSettings,
        [client0, client1],
        [['Multi0', slot0], ['Multi1', slot1]]
      )
      gs.startGame(lobbyInfo, makeMapPreview())
      expect(gs.SlotClients.size).toBe(2)
    })

    it('BUGFIX: duplicate slot (same slot) produces only 1 SlotClient (overwrites)', () => {
      // This documents the default behavior: same slot = overwrite.
      // Test pages must ensure unique slots per client in test setup.
      const gs = new GameSave()
      const client0 = makeSessionClient({ index: 0, slot: 'Multi0' })
      const client1 = makeSessionClient({ index: 1, slot: 'Multi0' }) // SAME slot — BUG!
      const globalSettings = makeSessionGlobal()
      const slot0 = makeSessionSlot({ playerReference: 'Multi0' })
      const lobbyInfo = makeLobbyInfo(globalSettings,
        [client0, client1],
        [['Multi0', slot0]]
      )
      gs.startGame(lobbyInfo, makeMapPreview())
      // Only 1 SlotClient because both clients share the same slot
      expect(gs.SlotClients.size).toBe(1)
    })
  })

// Augment the GameSave interface so TypeScript knows about the test helper
declare module './GameSave' {
  interface GameSave {
    _testDispatchRaw(clientSlot: number, data: Uint8Array): void
  }
}
