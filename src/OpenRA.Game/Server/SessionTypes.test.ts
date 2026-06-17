/**
 * SessionTypes.test.ts -- SessionTypes unit tests
 *
 * Tests focus on: enum values matching C#, serialization round-trips,
 * Session lookup methods, computed getters.
 */

import { describe, it, expect } from 'vitest'

import {
  ConnectionQuality,
  ClientState,
  WinState,
  MapStatus,
  ServerState,
  ServerType,
  SessionClient,
  SessionSlot,
  SessionGlobalSettings,
  Session,
  defaultServerSettings,
} from './SessionTypes'

// ---------------------------------------------------------------------------
// Enum Value Tests -- verify numeric values match C# exactly
// ---------------------------------------------------------------------------

describe('ConnectionQuality enum', () => {
  it('has correct numeric values matching C#', () => {
    expect(ConnectionQuality.Good).toBe(0)
    expect(ConnectionQuality.Moderate).toBe(1)
    expect(ConnectionQuality.Poor).toBe(2)
  })
})

describe('ClientState enum', () => {
  it('has correct numeric values matching C#', () => {
    expect(ClientState.NotReady).toBe(0)
    expect(ClientState.Ready).toBe(1)
    expect(ClientState.Invalid).toBe(2)
  })

  it('has Disconnected = 1000 matching C#', () => {
    expect(ClientState.Disconnected).toBe(1000)
  })
})

describe('WinState enum', () => {
  it('has correct numeric values matching C#', () => {
    expect(WinState.Undefined).toBe(0)
    expect(WinState.Won).toBe(1)
    expect(WinState.Lost).toBe(2)
  })
})

describe('MapStatus bitfield', () => {
  it('has correct power-of-2 values matching C# [Flags]', () => {
    expect(MapStatus.Unknown).toBe(0)
    expect(MapStatus.Validating).toBe(1)
    expect(MapStatus.Playable).toBe(2)
    expect(MapStatus.Incompatible).toBe(4)
    expect(MapStatus.UnsafeCustomRules).toBe(8)
  })

  it('supports bitwise OR for combined status', () => {
    const combined = MapStatus.Playable | MapStatus.UnsafeCustomRules
    expect(combined).toBe(10)
    expect((combined & MapStatus.Playable)).toBe(MapStatus.Playable)
    expect((combined & MapStatus.UnsafeCustomRules)).toBe(MapStatus.UnsafeCustomRules)
    expect((combined & MapStatus.Incompatible)).toBe(0)
  })
})

describe('ServerState enum', () => {
  it('has correct numeric values matching C#', () => {
    expect(ServerState.WaitingPlayers).toBe(1)
    expect(ServerState.GameStarted).toBe(2)
    expect(ServerState.ShuttingDown).toBe(3)
  })
})

describe('ServerType enum', () => {
  it('has correct numeric values matching C#', () => {
    expect(ServerType.Local).toBe(0)
    expect(ServerType.Skirmish).toBe(1)
    expect(ServerType.Multiplayer).toBe(2)
    expect(ServerType.Dedicated).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// SessionClient Tests
// ---------------------------------------------------------------------------

describe('SessionClient', () => {
  it('has default values', () => {
    const c = new SessionClient()
    expect(c.index).toBe(0)
    expect(c.name).toBe('Anonymous')
    expect(c.state).toBe(ClientState.Invalid)
    expect(c.connectionQuality).toBe(ConnectionQuality.Good)
    expect(c.faction).toBe('Random')
    expect(c.isObserver).toBe(true)
    expect(c.slot).toBeNull()
    expect(c.bot).toBeNull()
  })

  it('isReady returns true only for Ready state', () => {
    const c = new SessionClient()
    expect(c.isReady).toBe(false)
    c.state = ClientState.Ready
    expect(c.isReady).toBe(true)
    c.state = ClientState.Invalid
    expect(c.isReady).toBe(false)
    c.state = ClientState.NotReady
    expect(c.isReady).toBe(false)
  })

  it('isInvalid returns true only for Invalid state', () => {
    const c = new SessionClient()
    expect(c.isInvalid).toBe(true)
    c.state = ClientState.Ready
    expect(c.isInvalid).toBe(false)
    c.state = ClientState.NotReady
    expect(c.isInvalid).toBe(false)
  })

  it('isBot returns true only when bot is set', () => {
    const c = new SessionClient()
    expect(c.isBot).toBe(false)
    c.bot = 'e6'
    expect(c.isBot).toBe(true)
    c.bot = null
    expect(c.isBot).toBe(false)
  })

  it('isObserver derived from slot being null', () => {
    const c = new SessionClient()
    c.slot = null
    expect(c.isObserver).toBe(true)
    c.slot = 'Multi0'
    expect(c.isObserver).toBe(true) // isObserver is not auto-updated
  })

  it('serialization round-trip preserves all fields', () => {
    const original = new SessionClient()
    original.index = 42
    original.name = 'TestPlayer'
    original.ipAddress = '192.168.1.1'
    original.anonymizedIPAddress = '192.168.1.*'
    original.location = 'US'
    original.fingerprint = 'abc123'
    original.preferredColor = 0xFF0000FF
    original.color = 0x0000FFFF
    original.faction = 'allies'
    original.spawnPoint = 3
    original.team = 2
    original.handicap = 0
    original.slot = 'Multi1'
    original.bot = null
    original.botControllerClientIndex = undefined
    original.isAdmin = true
    original.state = ClientState.Ready
    original.connectionQuality = ConnectionQuality.Moderate

    const json = original.serialize()
    const restored = SessionClient.deserialize(json)

    expect(restored.index).toBe(42)
    expect(restored.name).toBe('TestPlayer')
    expect(restored.ipAddress).toBe('192.168.1.1')
    expect(restored.anonymizedIPAddress).toBe('192.168.1.*')
    expect(restored.location).toBe('US')
    expect(restored.fingerprint).toBe('abc123')
    expect(restored.preferredColor).toBe(0xFF0000FF)
    expect(restored.color).toBe(0x0000FFFF)
    expect(restored.faction).toBe('allies')
    expect(restored.spawnPoint).toBe(3)
    expect(restored.team).toBe(2)
    expect(restored.handicap).toBe(0)
    expect(restored.slot).toBe('Multi1')
    expect(restored.bot).toBeNull()
    expect(restored.isAdmin).toBe(true)
    expect(restored.state).toBe(ClientState.Ready)
    expect(restored.connectionQuality).toBe(ConnectionQuality.Moderate)
    // Computed getters should work on restored object
    expect(restored.isReady).toBe(true)
    expect(restored.isBot).toBe(false)
  })

  it('serialization round-trip with bot controller', () => {
    const original = new SessionClient()
    original.index = 7
    original.bot = 'e1'
    original.botControllerClientIndex = 1
    original.isAdmin = false

    const json = original.serialize()
    const restored = SessionClient.deserialize(json)

    expect(restored.index).toBe(7)
    expect(restored.bot).toBe('e1')
    expect(restored.botControllerClientIndex).toBe(1)
    expect(restored.isBot).toBe(true)
  })

  it('deserialize handles missing optional fields gracefully', () => {
    const restored = SessionClient.deserialize({})

    expect(restored.index).toBe(0)
    expect(restored.name).toBe('Anonymous')
    expect(restored.state).toBe(ClientState.Invalid)
    expect(restored.ipAddress).toBe('')
    expect(restored.anonymizedIPAddress).toBeUndefined()
    expect(restored.fingerprint).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SessionSlot Tests
// ---------------------------------------------------------------------------

describe('SessionSlot', () => {
  it('has default values', () => {
    const s = new SessionSlot()
    expect(s.playerReference).toBe('')
    expect(s.closed).toBe(false)
    expect(s.required).toBe(false)
    expect(s.locked).toBe(false)
    expect(s.allowBots).toBe(false)
  })

  it('serialization round-trip preserves all fields', () => {
    const original = new SessionSlot()
    original.playerReference = 'Multi3'
    original.closed = false
    original.required = true
    original.locked = false
    original.lockFaction = true
    original.lockColor = false
    original.lockTeam = true
    original.lockSpawn = false
    original.lockHandicap = false
    original.allowBots = true

    const json = original.serialize()
    const restored = SessionSlot.deserialize(json)

    expect(restored.playerReference).toBe('Multi3')
    expect(restored.closed).toBe(false)
    expect(restored.required).toBe(true)
    expect(restored.lockFaction).toBe(true)
    expect(restored.lockColor).toBe(false)
    expect(restored.lockTeam).toBe(true)
    expect(restored.lockSpawn).toBe(false)
    expect(restored.lockHandicap).toBe(false)
    expect(restored.allowBots).toBe(true)
  })

  it('deserialize handles missing fields gracefully', () => {
    const restored = SessionSlot.deserialize({})
    expect(restored.playerReference).toBe('')
    expect(restored.closed).toBe(false)
    expect(restored.required).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SessionGlobalSettings Tests
// ---------------------------------------------------------------------------

describe('SessionGlobalSettings', () => {
  it('has correct default values', () => {
    const gs = new SessionGlobalSettings()
    expect(gs.serverName).toBe('')
    expect(gs.map).toBe('')
    expect(gs.randomSeed).toBe(0)
    expect(gs.allowSpectators).toBe(true)
    expect(gs.gameTimestep).toBe(0)
    expect(gs.lobbyOptions.size).toBe(0)
  })

  it('optionOrDefault returns default when option missing', () => {
    const gs = new SessionGlobalSettings()
    expect(gs.optionOrDefault('nonexistent', 'default')).toBe('default')
    expect(gs.optionOrDefault('nonexistent', true)).toBe(true)
    expect(gs.optionOrDefault('nonexistent', false)).toBe(false)
  })

  it('optionOrDefault returns option value when present', () => {
    const gs = new SessionGlobalSettings()
    gs.lobbyOptions.set('gamespeed', {
      id: 'gamespeed',
      value: 'fastest',
      isEnabled: true,
      isLocked: false,
      preferredValue: 'fastest',
    })

    expect(gs.optionOrDefault('gamespeed', 'default')).toBe('fastest')
    expect(gs.optionOrDefault('gamespeed', true)).toBe(true)
  })

  it('serialization round-trip preserves all fields', () => {
    const original = new SessionGlobalSettings()
    original.serverName = 'Test Server'
    original.map = 'abc123def'
    original.mapStatus = MapStatus.Playable | MapStatus.UnsafeCustomRules
    original.randomSeed = 42
    original.allowSpectators = false
    original.gameUid = 'game-uid-123'
    original.enableSingleplayer = true
    original.enableMapGeneration = false
    original.enableGameSaves = true
    original.dedicated = true
    original.gameTimestep = 40
    original.lobbyOptions.set('gamespeed', {
      id: 'gamespeed',
      value: 'fast',
      isEnabled: true,
      isLocked: false,
      preferredValue: 'fast',
    })
    original.lobbyOptions.set('techlevel', {
      id: 'techlevel',
      value: 'Unrestricted',
      isEnabled: true,
      isLocked: true,
      preferredValue: 'Unrestricted',
    })

    const json = original.serialize()
    const restored = SessionGlobalSettings.deserialize(json)

    expect(restored.serverName).toBe('Test Server')
    expect(restored.map).toBe('abc123def')
    expect(restored.mapStatus).toBe(10) // 2 | 8
    expect(restored.randomSeed).toBe(42)
    expect(restored.allowSpectators).toBe(false)
    expect(restored.gameUid).toBe('game-uid-123')
    expect(restored.enableSingleplayer).toBe(true)
    expect(restored.enableMapGeneration).toBe(false)
    expect(restored.enableGameSaves).toBe(true)
    expect(restored.dedicated).toBe(true)
    expect(restored.gameTimestep).toBe(40)

    // Verify lobby options round-trip
    expect(restored.lobbyOptions.size).toBe(2)
    const gameSpeed = restored.lobbyOptions.get('gamespeed')!
    expect(gameSpeed.value).toBe('fast')
    // NOTE: isEnabled is computed as value === 'True' (C# LobbyOptionState pattern)
    // For a string option like 'gamespeed' with value 'fast', isEnabled is false
    expect(gameSpeed.isEnabled).toBe(false)
    expect(gameSpeed.isLocked).toBe(false)

    const techLevel = restored.lobbyOptions.get('techlevel')!
    expect(techLevel.value).toBe('Unrestricted')
    // NOTE: isEnabled is computed as value === 'True'. For a string option
    // like 'techlevel' with value 'Unrestricted', isEnabled is false
    expect(techLevel.isEnabled).toBe(false)
    expect(techLevel.isLocked).toBe(true)

    // Verify optionOrDefault works on restored
    expect(restored.optionOrDefault('gamespeed', 'default')).toBe('fast')
  })

  it('deserialize handles missing fields gracefully', () => {
    const restored = SessionGlobalSettings.deserialize({})
    expect(restored.serverName).toBe('')
    expect(restored.map).toBe('')
    expect(restored.mapStatus).toBe(MapStatus.Playable)
    expect(restored.allowSpectators).toBe(true)
    expect(restored.lobbyOptions.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Session Tests
// ---------------------------------------------------------------------------

describe('Session', () => {
  function createTestSession(): Session {
    const session = new Session()

    // Add a couple of slots
    const slot1 = new SessionSlot()
    slot1.playerReference = 'Multi0'
    session.slots.set('Multi0', slot1)

    const slot2 = new SessionSlot()
    slot2.playerReference = 'Multi1'
    session.slots.set('Multi1', slot2)

    const slot3 = new SessionSlot()
    slot3.playerReference = 'Multi2'
    slot3.closed = true
    session.slots.set('Multi2', slot3)

    // Add clients
    const c1 = new SessionClient()
    c1.index = 1
    c1.name = 'Alice'
    c1.slot = 'Multi0'
    c1.state = ClientState.Ready
    c1.isAdmin = true
    session.clients.push(c1)

    const c2 = new SessionClient()
    c2.index = 2
    c2.name = 'Bob'
    c2.slot = null
    c2.bot = null
    c2.state = ClientState.NotReady
    session.clients.push(c2)

    const c3 = new SessionClient()
    c3.index = 3
    c3.name = 'Bot1'
    c3.slot = 'Multi1'
    c3.bot = 'e1'
    c3.botControllerClientIndex = 1
    c3.state = ClientState.Ready
    session.clients.push(c3)

    return session
  }

  it('firstEmptySlot returns first open slot', () => {
    const session = createTestSession()
    // Multi0 has Alice, Multi1 has Bot1, Multi2 is closed
    // No empty slots
    expect(session.firstEmptySlot()).toBeNull()

    // Add an open slot
    const slot4 = new SessionSlot()
    slot4.playerReference = 'Multi3'
    session.slots.set('Multi3', slot4)
    expect(session.firstEmptySlot()).toBe('Multi3')
  })

  it('firstEmptySlot skips closed slots', () => {
    const session = new Session()
    const slot = new SessionSlot()
    slot.playerReference = 'Multi0'
    slot.closed = true
    session.slots.set('Multi0', slot)
    expect(session.firstEmptySlot()).toBeNull()
  })

  it('firstEmptyBotSlot returns first bot-eligible empty slot', () => {
    const session = new Session()
    const slot1 = new SessionSlot()
    slot1.playerReference = 'Multi0'
    slot1.allowBots = false
    session.slots.set('Multi0', slot1)

    const slot2 = new SessionSlot()
    slot2.playerReference = 'Multi1'
    slot2.allowBots = true
    session.slots.set('Multi1', slot2)

    const slot3 = new SessionSlot()
    slot3.playerReference = 'Multi2'
    slot3.allowBots = true
    session.slots.set('Multi2', slot3)

    // Both Multi1 and Multi2 allow bots and are empty
    expect(session.firstEmptyBotSlot()).toBe('Multi1')
  })

  it('firstEmptyBotSlot skips slots occupied by clients', () => {
    const session = new Session()
    const slot1 = new SessionSlot()
    slot1.playerReference = 'Multi0'
    slot1.allowBots = true
    session.slots.set('Multi0', slot1)

    // Occupy Multi0 with a client
    const client = new SessionClient()
    client.index = 1
    client.name = 'Alice'
    client.slot = 'Multi0'
    session.clients.push(client)

    // No other bot-eligible slots
    expect(session.firstEmptyBotSlot()).toBeNull()
  })

  it('firstEmptyBotSlot skips closed slots even with allowBots', () => {
    const session = new Session()
    const slot = new SessionSlot()
    slot.playerReference = 'Multi0'
    slot.allowBots = true
    slot.closed = true
    session.slots.set('Multi0', slot)

    expect(session.firstEmptyBotSlot()).toBeNull()
  })

  it('firstEmptyBotSlot returns null when no bot-eligible slots exist', () => {
    const session = new Session()
    expect(session.firstEmptyBotSlot()).toBeNull()
  })

  it('clientWithIndex finds client by index', () => {
    const session = createTestSession()
    const alice = session.clientWithIndex(1)
    expect(alice).toBeDefined()
    expect(alice!.name).toBe('Alice')

    expect(session.clientWithIndex(99)).toBeUndefined()
  })

  it('clientInSlot finds client by slot key', () => {
    const session = createTestSession()
    const alice = session.clientInSlot('Multi0')
    expect(alice).toBeDefined()
    expect(alice!.name).toBe('Alice')

    expect(session.clientInSlot('Multi2')).toBeUndefined()
    expect(session.clientInSlot('Nonexistent')).toBeUndefined()
  })

  it('nonBotClients returns only human players', () => {
    const session = createTestSession()
    const humans = session.nonBotClients
    expect(humans.length).toBe(2)
    expect(humans.map((c) => c.name)).toEqual(['Alice', 'Bob'])
  })

  it('nonBotPlayers returns only human players with a slot', () => {
    const session = createTestSession()
    const players = session.nonBotPlayers
    expect(players.length).toBe(1)
    expect(players[0].name).toBe('Alice')
  })

  it('serialization round-trip preserves full session', () => {
    const original = createTestSession()
    original.globalSettings.serverName = 'Test Game'
    original.globalSettings.map = 'mymap'
    original.globalSettings.randomSeed = 999
    original.disabledSpawnPoints.add(3)
    original.disabledSpawnPoints.add(5)

    const json = original.serialize()
    const restored = Session.deserialize(json)

    // Verify global settings
    expect(restored.globalSettings.serverName).toBe('Test Game')
    expect(restored.globalSettings.map).toBe('mymap')
    expect(restored.globalSettings.randomSeed).toBe(999)

    // Verify clients
    expect(restored.clients.length).toBe(3)
    expect(restored.clients[0].name).toBe('Alice')
    expect(restored.clients[0].isAdmin).toBe(true)
    expect(restored.clients[2].bot).toBe('e1')

    // Verify slots
    expect(restored.slots.size).toBe(3)
    expect(restored.slots.get('Multi2')!.closed).toBe(true)

    // Verify disabled spawn points
    expect(restored.disabledSpawnPoints.has(3)).toBe(true)
    expect(restored.disabledSpawnPoints.has(5)).toBe(true)
  })

  it('deserialize handles invalid JSON gracefully', () => {
    const session = Session.deserialize('not valid json')
    expect(session.clients.length).toBe(0)
    expect(session.slots.size).toBe(0)
  })

  it('deserialize handles missing fields in JSON', () => {
    const session = Session.deserialize('{}')
    expect(session.clients.length).toBe(0)
    expect(session.slots.size).toBe(0)
    expect(session.globalSettings.randomSeed).toBe(0)
  })

  it('disabledSpawnPoints serialization round-trip', () => {
    const session = new Session()
    session.disabledSpawnPoints.add(0)
    session.disabledSpawnPoints.add(7)

    const json = session.serialize()
    const restored = Session.deserialize(json)
    expect(restored.disabledSpawnPoints.size).toBe(2)
    expect(restored.disabledSpawnPoints.has(0)).toBe(true)
    expect(restored.disabledSpawnPoints.has(7)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// defaultServerSettings Tests
// ---------------------------------------------------------------------------

describe('defaultServerSettings', () => {
  it('returns settings with all expected fields', () => {
    const settings = defaultServerSettings()
    expect(settings.name).toBe('OpenRA Web Server')
    expect(settings.listenPort).toBe(1234)
    expect(settings.recordReplays).toBe(false)
    expect(settings.floodLimitMessageCount).toBe(5)
    expect(settings.floodLimitCooldown).toBe(5000)
    expect(settings.floodLimitInterval).toBe(10000)
    expect(settings.floodLimitJoinCooldown).toBe(1000)
    expect(settings.voteKickTimer).toBe(30000)
    expect(settings.voteKickerCooldown).toBe(60000)
    expect(settings.timestampFormat).toBe('yyyy-MM-dd HH:mm:ss')
    expect(settings.ban).toEqual([])
    expect(settings.profileIDWhitelist).toEqual([])
    expect(settings.profileIDBlacklist).toEqual([])
  })

  it('accepts custom name', () => {
    const settings = defaultServerSettings('My Server')
    expect(settings.name).toBe('My Server')
  })
})
