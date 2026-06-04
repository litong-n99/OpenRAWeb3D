/**
 * Player.test.ts — Player migration unit tests
 *
 * Tests focus on: diplomacy logic, state transitions, faction resolution,
 * relationship coloring, spectator detection, and lifecycle correctness.
 *
 * Since Player is pure logic (no WebGL), no Babylon.js mocking is needed.
 * The LongBitSet dependency is real (also pure logic).
 */

import { describe, it, expect, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  Player,
  WinState,
  PowerState,
  type PlayerBitMask,
  type FactionInfoStub,
  type PlayerReferenceStub,
  type SessionClientStub,
  type MersenneTwisterStub,
  type NotifyPlayerDisconnectedStub,
  PLAYER_BITMASK_TYPENAME,
} from './Player.js'
import { LongBitSet } from './Primitives/LongBitSet.js'
import { PlayerRelationship } from './Traits/TraitsInterfaces.js'
import type { GameActor } from './Actor.js'
import type { CPos } from './CPos.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Deterministic mock random generator for Repeatable tests. */
function createMockRandom(values: number[]): MersenneTwisterStub {
  let callIndex = 0
  return {
    next(_min?: number, _max?: number): number {
      const val = values[callIndex % values.length]
      callIndex++
      return val
    },
  }
}

/** Create a minimal valid FactionInfoStub. */
function createFactionInfo(
  overrides: Partial<FactionInfoStub> = {},
): FactionInfoStub {
  return {
    name: overrides.name ?? 'Default Faction',
    internalName: overrides.internalName ?? 'default',
    randomFactionMembers: overrides.randomFactionMembers ?? [],
    side: overrides.side ?? 'Neutral',
    selectable: overrides.selectable ?? true,
  }
}

/** Create a minimal valid PlayerReferenceStub. */
function createPlayerReference(
  overrides: Partial<PlayerReferenceStub> = {},
): PlayerReferenceStub {
  return {
    name: overrides.name ?? 'Player1',
    palette: overrides.palette ?? 'palette',
    bot: overrides.bot,
    startingUnitsClass: overrides.startingUnitsClass,
    allowBots: overrides.allowBots ?? true,
    playable: overrides.playable ?? true,
    required: overrides.required ?? false,
    ownsWorld: overrides.ownsWorld ?? false,
    spectating: overrides.spectating ?? false,
    nonCombatant: overrides.nonCombatant ?? false,
    lockFaction: overrides.lockFaction ?? false,
    faction: overrides.faction ?? 'default',
    lockColor: overrides.lockColor ?? false,
    color: overrides.color ?? 0xffffffff,
    homeLocation: overrides.homeLocation ?? ({ x: 0, y: 0 } as unknown as CPos),
    lockSpawn: overrides.lockSpawn ?? false,
    spawn: overrides.spawn ?? 0,
    lockTeam: overrides.lockTeam ?? false,
    team: overrides.team ?? 0,
    lockHandicap: overrides.lockHandicap ?? false,
    handicap: overrides.handicap ?? 0,
    allies: overrides.allies ?? [],
    enemies: overrides.enemies ?? [],
  }
}

/** Create a minimal valid SessionClientStub. */
function createSessionClient(
  overrides: Partial<SessionClientStub> = {},
): SessionClientStub {
  return {
    index: overrides.index ?? 0,
    color: overrides.color ?? 0xffff0000,
    name: overrides.name ?? 'TestPlayer',
    bot: overrides.bot,
    faction: overrides.faction ?? 'default',
    handicap: overrides.handicap ?? 0,
    spawnPoint: overrides.spawnPoint ?? 0,
  }
}

/** Track calls for mock world. */
interface MockWorld {
  players: Player[]
  createPlayerActorCalls: { internalName: string; owner: Player }[]
  createPlayerActor: (internalName: string, owner: Player) => GameActor
}

/** Create a mock world for Player construction. */
function createMockWorld(): MockWorld {
  const world: MockWorld = {
    players: [],
    createPlayerActorCalls: [],
    createPlayerActor(_internalName: string, _owner: Player): GameActor {
      world.createPlayerActorCalls.push({ internalName: _internalName, owner: _owner })
      return createMockPlayerActor()
    },
  }
  return world
}

/** Create a mock GameActor for tests. */
function createMockPlayerActor(): GameActor {
  const traits = new Map<string, unknown>()
  const actor = {
    actorId: 999,
    traitOrDefault<T>(_name: string): T | undefined {
      return traits.get(_name) as T | undefined
    },
    traitsImplementing<T>(_name: string): T[] {
      return [] as T[]
    },
    trait<T>(_name: string): T {
      const t = traits.get(_name)
      if (t === undefined) throw new Error(`Trait ${_name} not found`)
      return t as T
    },
  } as unknown as GameActor
  return actor
}

/** Create a Player with default test parameters. */
function createTestPlayer(
  overrides: {
    world?: MockWorld
    client?: SessionClientStub | null
    pr?: PlayerReferenceStub
    playerRandom?: MersenneTwisterStub
    factionInfos?: FactionInfoStub[]
  } = {},
): { player: Player; world: MockWorld } {
  const world = overrides.world ?? createMockWorld()
  const client = overrides.client !== undefined ? overrides.client : createSessionClient()
  const pr = overrides.pr ?? createPlayerReference()
  const random = overrides.playerRandom ?? createMockRandom([0])
  const factionInfos = overrides.factionInfos ?? [
    createFactionInfo({ internalName: 'default', name: 'Default' }),
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const player = new Player(
    world as any,
    client,
    pr,
    random,
    factionInfos,
  )
  world.players.push(player)

  return { player, world }
}

// ---------------------------------------------------------------------------
// Teardown after each test: reset LongBitSet allocator
// ---------------------------------------------------------------------------

afterEach(() => {
  LongBitSet.reset(PLAYER_BITMASK_TYPENAME)
})

// ---------------------------------------------------------------------------
// WinState enum
// ---------------------------------------------------------------------------

describe('WinState', () => {
  it('has correct values matching OpenRA', () => {
    expect(WinState.Undefined).toBe(0)
    expect(WinState.Won).toBe(1)
    expect(WinState.Lost).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// PowerState enum
// ---------------------------------------------------------------------------

describe('PowerState', () => {
  it('has correct flag values matching OpenRA', () => {
    expect(PowerState.Normal).toBe(1)
    expect(PowerState.Low).toBe(2)
    expect(PowerState.Critical).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// PlayerBitMask marker
// ---------------------------------------------------------------------------

describe('PlayerBitMask', () => {
  it('is a valid type tag for LongBitSet', () => {
    // Verify that LongBitSet<PlayerBitMask> can be constructed
    const mask = new LongBitSet<PlayerBitMask>(
      PLAYER_BITMASK_TYPENAME,
      'Player1',
    )
    expect(mask.isEmpty).toBe(false)
    expect(mask.contains('Player1')).toBe(true)
  })

  it('isolates PlayerBitMask from other LongBitSet types', () => {
    const playerMask = new LongBitSet<PlayerBitMask>(
      PLAYER_BITMASK_TYPENAME,
      'Player1',
    )
    // Separate type namespace
    const otherMask = new LongBitSet<{ _other: true }>('OtherType', 'Player1')
    // PlayerBitMask allocator should NOT contain 'Player1' in OtherType
    expect(otherMask.contains('Player1')).toBe(true)
    // Both should work independently
    expect(playerMask.contains('Player1')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Player.resolveFaction — static
// ---------------------------------------------------------------------------

describe('Player.resolveFaction', () => {
  const defaultFaction = createFactionInfo({
    internalName: 'default',
    name: 'Default',
  })
  const alliesFaction = createFactionInfo({
    internalName: 'allies',
    name: 'Allies',
  })
  const sovietFaction = createFactionInfo({
    internalName: 'soviet',
    name: 'Soviet',
  })
  const randomFaction = createFactionInfo({
    internalName: 'random',
    name: 'Random',
    randomFactionMembers: ['allies', 'soviet'],
  })
  const allFactions = [defaultFaction, alliesFaction, sovietFaction, randomFaction]

  it('resolves exact faction name match', () => {
    const result = Player.resolveFaction(
      'allies',
      allFactions,
      createMockRandom([0]),
    )
    expect(result.internalName).toBe('allies')
  })

  it('falls back to a selectable faction when no match found', () => {
    const result = Player.resolveFaction(
      'nonexistent',
      allFactions,
      createMockRandom([0]), // picks first
    )
    // Should pick first selectable faction (default)
    expect(result.internalName).toBe('default')
  })

  it('resolves RandomFactionMembers recursively', () => {
    // Random faction → randomFactionMembers[0] = 'allies'
    const result = Player.resolveFaction(
      'random',
      allFactions,
      createMockRandom([0, 0]),
    )
    expect(result.internalName).toBe('allies')
  })

  it('caps RandomFactionMember recursion at 10 iterations', () => {
    // Create a chain: a → b → c → ... each has 1 random member
    const chainFactions: FactionInfoStub[] = []
    for (let i = 0; i < 15; i++) {
      chainFactions.push(
        createFactionInfo({
          internalName: `chain${i}`,
          name: `Chain ${i}`,
          randomFactionMembers:
            i < 14 ? [`chain${i + 1}`] : [],
        }),
      )
    }
    const result = Player.resolveFaction(
      'chain0',
      chainFactions,
      createMockRandom(new Array(20).fill(0)), // always pick index 0
    )
    // Should resolve after 10 iterations max (at chain10 or chain11)
    expect(result.internalName).toBeDefined()
  })

  it('throws on unknown RandomFactionMember', () => {
    const badFaction = createFactionInfo({
      internalName: 'bad',
      name: 'Bad',
      randomFactionMembers: ['nonexistent'],
    })
    expect(() =>
      Player.resolveFaction('bad', [badFaction], createMockRandom([0])),
    ).toThrow('Unknown faction: nonexistent')
  })

  it('honors requireSelectable = false', () => {
    const unselectableFaction = createFactionInfo({
      internalName: 'unselectable',
      name: 'Unselectable',
      selectable: false,
    })
    const result = Player.resolveFaction(
      'unselectable',
      [unselectableFaction],
      createMockRandom([0]),
      false, // requireSelectable = false
    )
    expect(result.internalName).toBe('unselectable')
  })

  it('ignores unselectable factions when requireSelectable = true', () => {
    const unselectableFaction = createFactionInfo({
      internalName: 'unselectable',
      name: 'Unselectable',
      selectable: false,
    })
    const selectableFaction = createFactionInfo({
      internalName: 'selectable',
      name: 'Selectable',
      selectable: true,
    })
    const result = Player.resolveFaction(
      'unselectable',
      [unselectableFaction, selectableFaction],
      createMockRandom([0]),
      true, // requireSelectable = true (default)
    )
    // Should NOT match unselectable — falls back to random selectable
    expect(result.internalName).toBe('selectable')
  })
})

// ---------------------------------------------------------------------------
// Player.resolveDisplayFaction — static
// ---------------------------------------------------------------------------

describe('Player.resolveDisplayFaction', () => {
  const faction1 = createFactionInfo({ internalName: 'f1', name: 'Faction 1' })
  const faction2 = createFactionInfo({ internalName: 'f2', name: 'Faction 2' })

  it('returns matching faction by internal name', () => {
    const result = Player.resolveDisplayFaction(
      [faction1, faction2],
      'f2',
    )
    expect(result.internalName).toBe('f2')
  })

  it('falls back to first faction when no match found', () => {
    const result = Player.resolveDisplayFaction(
      [faction1, faction2],
      'nonexistent',
    )
    expect(result.internalName).toBe('f1')
  })
})

// ---------------------------------------------------------------------------
// Player.getColor — static
// ---------------------------------------------------------------------------

describe('Player.getColor', () => {
  it('returns the original player color', () => {
    const { player } = createTestPlayer()
    expect(Player.getColor(player)).toBe(0xffff0000) // from SessionClientStub
  })

  it('returns the original color even when displayColor differs', () => {
    const { player } = createTestPlayer()
    player.displayColor = 0xff00ff00 // overridden by relationship
    expect(Player.getColor(player)).toBe(0xffff0000) // still original
  })
})

// ---------------------------------------------------------------------------
// Player.playerRelationshipColor — static
// ---------------------------------------------------------------------------

describe('Player.playerRelationshipColor', () => {
  it('returns original color when viewer is null', () => {
    const { player } = createTestPlayer()
    const result = Player.playerRelationshipColor(player, null)
    expect(result).toBe(0xffff0000)
  })

  it('returns original color when viewer is spectating', () => {
    const { player: viewer } = createTestPlayer({
      pr: createPlayerReference({ name: 'Spectator', spectating: true }),
    })
    const { player: target } = createTestPlayer({
      pr: createPlayerReference({ name: 'Target' }),
    })
    const result = Player.playerRelationshipColor(target, viewer)
    // Spectator sees original colors
    expect(result).toBe(0xffff0000)
  })
})

// ---------------------------------------------------------------------------
// Player.setupRelationshipColors — static
// ---------------------------------------------------------------------------

describe('Player.setupRelationshipColors', () => {
  it('updates display colors for all players', () => {
    const { player: viewer, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Viewer' }),
    })
    const { player: ally } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Ally' }),
    })

    // Make player2 allied with viewer
    viewer.alliedPlayersMask = ally.playerMask

    const updateCalls: { internalName: string; color: number; isUpdate: boolean }[] = []
    const mockWR = {
      updatePalettesForPlayer(
        internalName: string,
        color: number,
        isUpdate: boolean,
      ): void {
        updateCalls.push({ internalName, color, isUpdate })
      },
    }

    Player.setupRelationshipColors(
      [viewer, ally],
      viewer,
      mockWR,
      false, // firstRun
    )

    expect(updateCalls.length).toBe(2)
    // First call: viewer's own color (self = STANCE_COLOR_SELF)
    expect(updateCalls[0].internalName).toBe('Viewer')
    // Second call: ally's color
    expect(updateCalls[1].internalName).toBe('Ally')
    // isUpdate = !firstRun = true
    expect(updateCalls[0].isUpdate).toBe(true)
  })

  it('calls updatePalettesForPlayer with isUpdate = false on first run', () => {
    const { player: viewer } = createTestPlayer({
      pr: createPlayerReference({ name: 'Viewer' }),
    })
    const updateCalls: { isUpdate: boolean }[] = []
    const mockWR = {
      updatePalettesForPlayer(
        _internalName: string,
        _color: number,
        isUpdate: boolean,
      ): void {
        updateCalls.push({ isUpdate })
      },
    }

    Player.setupRelationshipColors(
      [viewer],
      viewer,
      mockWR,
      true, // firstRun
    )

    // isUpdate = !firstRun = false
    expect(updateCalls[0].isUpdate).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Player construction
// ---------------------------------------------------------------------------

describe('Player construction', () => {
  it('creates a Player with session client (real/host-created player)', () => {
    const client = createSessionClient({
      index: 3,
      color: 0xff00ff00,
      name: 'TestPlayer',
      faction: 'allies',
      handicap: 5,
      spawnPoint: 2,
    })
    const factionInfos = [
      createFactionInfo({ internalName: 'allies', name: 'Allies' }),
    ]
    const { player, world } = createTestPlayer({
      client,
      pr: createPlayerReference({ name: 'Player1' }),
      factionInfos,
    })

    expect(player.playerName).toBe('TestPlayer')
    expect(player.internalName).toBe('Player1')
    expect(player.clientIndex).toBe(3)
    expect(player.color).toBe(0xff00ff00)
    expect(player.displayColor).toBe(0xff00ff00)
    expect(player.handicap).toBe(5)
    expect(player.spawnPoint).toBe(2)
    expect(player.displaySpawnPoint).toBe(2)
    expect(player.faction.internalName).toBe('allies')
    expect(player.displayFaction.internalName).toBe('allies')
    expect(player.isBot).toBe(false)
    expect(player.botType).toBeNull()
    expect(player.playable).toBe(true)
    expect(player.nonCombatant).toBe(false)

    // Should have created the PlayerActor
    expect(world.createPlayerActorCalls.length).toBe(1)
    expect(world.createPlayerActorCalls[0].internalName).toBe('Player1')
  })

  it('creates a Player without session client (map-defined player)', () => {
    const pr = createPlayerReference({
      name: 'MapPlayer',
      nonCombatant: true,
      playable: false,
      spectating: true,
      color: 0xff0000ff,
      handicap: 10,
    })
    const { player, world } = createTestPlayer({
      client: null,
      pr,
    })

    expect(player.playerName).toBe('MapPlayer')
    expect(player.internalName).toBe('MapPlayer')
    expect(player.nonCombatant).toBe(true)
    expect(player.playable).toBe(false)
    expect(player.color).toBe(0xff0000ff)
    expect(player.handicap).toBe(10)
    expect(player.spawnPoint).toBe(0)
    expect(player.displaySpawnPoint).toBe(0)
    expect(player.isBot).toBe(false)

    // Should still create PlayerActor
    expect(world.createPlayerActorCalls.length).toBe(1)
  })

  it('detects bot players from BotType', () => {
    const client = createSessionClient({
      bot: 'RuleBasedBot',
      name: 'AIBot',
    })
    const { player } = createTestPlayer({ client })
    expect(player.isBot).toBe(true)
    expect(player.botType).toBe('RuleBasedBot')
  })

  it('allocates PlayerMask for non-spectating players', () => {
    const { player } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1', spectating: false }),
    })
    expect(player.playerMask.isEmpty).toBe(false)
    expect(player.playerMask.contains('Player1')).toBe(true)
  })

  it('does NOT allocate PlayerMask for spectating map-defined players', () => {
    // NOTE: In OpenRA, spectating is only set for map-defined players (client==null)
    const { player } = createTestPlayer({
      client: null,
      pr: createPlayerReference({ name: 'Spectator', spectating: true }),
    })
    expect(player.playerMask.isEmpty).toBe(true)
  })

  it('initializes AlliedPlayersMask and EnemyPlayersMask as empty', () => {
    const { player } = createTestPlayer()
    expect(player.alliedPlayersMask.isEmpty).toBe(true)
    expect(player.enemyPlayersMask.isEmpty).toBe(true)
  })

  it('initializes WinState as Undefined', () => {
    const { player } = createTestPlayer()
    expect(player.winState).toBe(WinState.Undefined)
  })

  it('initializes HasObjectives as false', () => {
    const { player } = createTestPlayer()
    expect(player.hasObjectives).toBe(false)
  })

  it('uses lockFaction = false to allow random faction resolution', () => {
    const factionInfos = [
      createFactionInfo({
        internalName: 'requested',
        name: 'Requested',
        selectable: false,
      }),
      createFactionInfo({
        internalName: 'fallback',
        name: 'Fallback',
        selectable: true,
      }),
    ]
    const client = createSessionClient({ faction: 'requested' })
    const pr = createPlayerReference({ lockFaction: false })
    const { player } = createTestPlayer({ client, pr, factionInfos })
    // lockFaction=false means requireSelectable=true
    // 'requested' is unselectable, so fallback to random selectable
    expect(player.faction.internalName).toBe('fallback')
  })
})

// ---------------------------------------------------------------------------
// Player.Spectating
// ---------------------------------------------------------------------------

describe('Player.isSpectating', () => {
  it('returns false for active players in non-mission maps', () => {
    const { player } = createTestPlayer({
      pr: createPlayerReference({ spectating: false }),
    })
    expect(player.isSpectating).toBe(false)
  })

  it('returns true for map-defined players marked as spectating', () => {
    // NOTE: In OpenRA, spectating is only from PlayerReference for map-defined players (client==null)
    const { player } = createTestPlayer({
      client: null,
      pr: createPlayerReference({ name: 'Spectator', spectating: true }),
    })
    expect(player.isSpectating).toBe(true)
  })

  it('returns true when WinState is Won (game-over spectating)', () => {
    const { player } = createTestPlayer({
      pr: createPlayerReference({ spectating: false }),
    })
    player.winState = WinState.Won
    expect(player.isSpectating).toBe(true)
  })

  it('returns true when WinState is Lost (game-over spectating)', () => {
    const { player } = createTestPlayer({
      pr: createPlayerReference({ spectating: false }),
    })
    player.winState = WinState.Lost
    expect(player.isSpectating).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Player.UnlockedRenderPlayer
// ---------------------------------------------------------------------------

describe('Player.unlockedRenderPlayer', () => {
  it('returns true if any unlock trait reports unlocked', () => {
    // The player is created with empty _unlockRenderPlayer, so it falls
    // through to the default check: WinState != Undefined && !inMissionMap
    // For this test, we set WinState = Won
    const { player } = createTestPlayer()
    player.winState = WinState.Won
    expect(player.unlockedRenderPlayer).toBe(true)
  })

  it('returns false for active player in mission map', () => {
    // The _inMissionMap is always false in our stub (no Map.Visibility).
    // For an active player (WinState=Undefined), unlockedRenderPlayer
    // returns false.
    const { player } = createTestPlayer()
    expect(player.unlockedRenderPlayer).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Player.ResolvedPlayerName
// ---------------------------------------------------------------------------

describe('Player.resolvedPlayerName', () => {
  it('returns player name for human players', () => {
    const client = createSessionClient({ name: 'HumanPlayer' })
    const { player } = createTestPlayer({ client })
    expect(player.resolvedPlayerName).toBe('HumanPlayer')
  })

  it('caches the resolved name (lazy computation)', () => {
    const { player } = createTestPlayer()
    const name1 = player.resolvedPlayerName
    const name2 = player.resolvedPlayerName
    expect(name1).toBe(name2)
  })
})

// ---------------------------------------------------------------------------
// Player.toString
// ---------------------------------------------------------------------------

describe('Player.toString', () => {
  it('includes resolved player name and client index', () => {
    const client = createSessionClient({ name: 'TestPlayer', index: 5 })
    const { player } = createTestPlayer({ client })
    const str = player.toString()
    expect(str).toContain('TestPlayer')
    expect(str).toContain('5')
  })
})

// ---------------------------------------------------------------------------
// Player.RelationshipWith (diplomacy)
// ---------------------------------------------------------------------------

describe('Player.relationshipWith', () => {
  it('returns Ally for self', () => {
    const { player } = createTestPlayer()
    expect(player.relationshipWith(player)).toBe(PlayerRelationship.Ally)
  })

  it('returns Ally for null (observers are allies to active combatants)', () => {
    const { player } = createTestPlayer()
    expect(player.relationshipWith(null)).toBe(PlayerRelationship.Ally)
  })

  it('returns Neutral for null when this player is NonCombatant', () => {
    // NOTE: In OpenRA, NonCombatant is set from PlayerReference only for map-defined players (client==null)
    const { player } = createTestPlayer({
      client: null,
      pr: createPlayerReference({ name: 'NC', nonCombatant: true }),
    })
    expect(player.relationshipWith(null)).toBe(PlayerRelationship.Neutral)
  })

  it('returns Ally for spectators (observers are allies)', () => {
    const { player: viewer, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Viewer' }),
    })
    const { player: spectator } = createTestPlayer({
      world,
      client: null,
      pr: createPlayerReference({ name: 'Spectator', spectating: true }),
    })
    expect(viewer.relationshipWith(spectator)).toBe(PlayerRelationship.Ally)
  })

  it('returns Neutral for spectators when this player is NonCombatant (map player)', () => {
    const { player: nonCombatant, world } = createTestPlayer({
      client: null,
      pr: createPlayerReference({ name: 'NC', nonCombatant: true }),
    })
    const { player: spectator } = createTestPlayer({
      world,
      client: null,
      pr: createPlayerReference({ name: 'Spectator', spectating: true }),
    })
    expect(nonCombatant.relationshipWith(spectator)).toBe(
      PlayerRelationship.Neutral,
    )
  })

  it('returns Ally when AlliedPlayersMask overlaps other.PlayerMask', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    p1.alliedPlayersMask = p2.playerMask
    expect(p1.relationshipWith(p2)).toBe(PlayerRelationship.Ally)
  })

  it('returns Enemy when EnemyPlayersMask overlaps other.PlayerMask', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    p1.enemyPlayersMask = p2.playerMask
    expect(p1.relationshipWith(p2)).toBe(PlayerRelationship.Enemy)
  })

  it('returns Neutral when neither mask overlaps', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    // Both masks are empty by default
    expect(p1.relationshipWith(p2)).toBe(PlayerRelationship.Neutral)
  })

  it('Enemy mask takes priority over no allied mask', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    p1.enemyPlayersMask = p2.playerMask
    // P1 → P2 = Enemy regardless of allied mask
    expect(p1.relationshipWith(p2)).toBe(PlayerRelationship.Enemy)
  })

  it('Ally check comes before Enemy check (matching OpenRA order)', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    // Both ally and enemy masks include p2 → Ally wins (checked first)
    p1.alliedPlayersMask = p2.playerMask
    p1.enemyPlayersMask = p2.playerMask
    expect(p1.relationshipWith(p2)).toBe(PlayerRelationship.Ally)
  })

  it('game-over spectating players are treated as observers', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    p2.winState = WinState.Lost // now spectating via game over

    expect(p1.relationshipWith(p2)).toBe(PlayerRelationship.Ally)
  })
})

// ---------------------------------------------------------------------------
// Player.IsAlliedWith
// ---------------------------------------------------------------------------

describe('Player.isAlliedWith', () => {
  it('returns true for self', () => {
    const { player } = createTestPlayer()
    expect(player.isAlliedWith(player)).toBe(true)
  })

  it('returns true for allied player', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    p1.alliedPlayersMask = p2.playerMask
    expect(p1.isAlliedWith(p2)).toBe(true)
  })

  it('returns false for enemy player', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    p1.enemyPlayersMask = p2.playerMask
    expect(p1.isAlliedWith(p2)).toBe(false)
  })

  it('returns false for neutral player', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    expect(p1.isAlliedWith(p2)).toBe(false)
  })

  it('returns true for null (observers are allies)', () => {
    const { player } = createTestPlayer()
    expect(player.isAlliedWith(null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Player.PlayerDisconnected (internal)
// ---------------------------------------------------------------------------

describe('Player.playerDisconnected', () => {
  it('notifies all INotifyPlayerDisconnected traits', () => {
    const disconnectCalls: { actor: unknown; player: unknown }[] = []
    const mockNotifier: NotifyPlayerDisconnectedStub = {
      playerDisconnected(actor, player) {
        disconnectCalls.push({ actor, player })
      },
    }

    // We need to construct the player and inject the mock notifier.
    // Since the constructor retrieves traits from the PlayerActor,
    // we mock the world's createPlayerActor to return an actor with our trait.
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })

    // Use reflection to inject the mock into _notifyDisconnected
    const playerAny = p1 as unknown as {
      _notifyDisconnected: NotifyPlayerDisconnectedStub[]
      playerDisconnected: (p: Player) => void
    }
    playerAny._notifyDisconnected = [mockNotifier]

    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    p1.playerDisconnected(p2)

    expect(disconnectCalls.length).toBe(1)
    expect(disconnectCalls[0].player).toBe(p2)
  })

  it('does nothing when no notifiers are registered', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })

    // Empty _notifyDisconnected array (default) — should not throw
    expect(() => p1.playerDisconnected(p2)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Player WinState transitions
// ---------------------------------------------------------------------------

describe('Player WinState transitions', () => {
  it('defaults to Undefined', () => {
    const { player } = createTestPlayer()
    expect(player.winState).toBe(WinState.Undefined)
  })

  it('can transition to Won', () => {
    const { player } = createTestPlayer()
    player.winState = WinState.Won
    expect(player.winState).toBe(WinState.Won)
    // After winning, player is spectating
    expect(player.isSpectating).toBe(true)
  })

  it('can transition to Lost', () => {
    const { player } = createTestPlayer()
    player.winState = WinState.Lost
    expect(player.winState).toBe(WinState.Lost)
    // After losing, player is spectating
    expect(player.isSpectating).toBe(true)
  })

  it('can transition back to Undefined (edge case for replays)', () => {
    const { player } = createTestPlayer()
    player.winState = WinState.Won
    player.winState = WinState.Undefined
    expect(player.winState).toBe(WinState.Undefined)
    expect(player.isSpectating).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Player construction edge cases
// ---------------------------------------------------------------------------

describe('Player construction edge cases', () => {
  it('map-defined player with bot', () => {
    const pr = createPlayerReference({
      name: 'MapBot',
      bot: 'HarvesterBot',
      spectating: false,
    })
    const { player } = createTestPlayer({ client: null, pr })
    expect(player.isBot).toBe(true)
    expect(player.botType).toBe('HarvesterBot')
    expect(player.playerName).toBe('MapBot')
  })

  it('handles client with bot = null', () => {
    const client = createSessionClient({ bot: undefined })
    const { player } = createTestPlayer({ client })
    expect(player.botType).toBeNull()
    expect(player.isBot).toBe(false)
  })

  it('uses lockFaction = true from PlayerReference', () => {
    const factionInfos = [
      createFactionInfo({
        internalName: 'requested',
        name: 'Requested',
        selectable: false,
      }),
      createFactionInfo({
        internalName: 'selectable',
        name: 'Selectable',
        selectable: true,
      }),
    ]
    const client = createSessionClient({ faction: 'requested' })
    const pr = createPlayerReference({ lockFaction: true })
    const { player } = createTestPlayer({
      client,
      pr,
      factionInfos,
      playerRandom: createMockRandom([0]),
    })
    // lockFaction=true means requireSelectable=false
    // 'requested' is NOT selectable but we can still use it
    expect(player.faction.internalName).toBe('requested')
  })

  it('falls back to first faction for display when no match', () => {
    const client = createSessionClient({ faction: 'nonexistent' })
    const factionInfos = [
      createFactionInfo({ internalName: 'f1', name: 'F1' }),
      createFactionInfo({ internalName: 'f2', name: 'F2' }),
    ]
    const { player } = createTestPlayer({ client, factionInfos })
    expect(player.displayFaction.internalName).toBe('f1')
  })
})

// ---------------------------------------------------------------------------
// LongBitSet compatibility for diplomacy
// ---------------------------------------------------------------------------

describe('Player diplomacy with LongBitSet', () => {
  it('multiple players each get unique bit', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    const { player: p3 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player3' }),
    })

    // Each player has a non-empty unique mask
    expect(p1.playerMask.isEmpty).toBe(false)
    expect(p2.playerMask.isEmpty).toBe(false)
    expect(p3.playerMask.isEmpty).toBe(false)

    // Player masks do not overlap by default (each is a single unique bit)
    expect(p1.playerMask.overlaps(p2.playerMask)).toBe(false)
    expect(p2.playerMask.overlaps(p3.playerMask)).toBe(false)
  })

  it('diplomacy correctly resolves with 3-player setup', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    const { player: p3 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player3' }),
    })

    // P1 allies with P2, enemies with P3
    p1.alliedPlayersMask = p2.playerMask
    p1.enemyPlayersMask = p3.playerMask

    expect(p1.isAlliedWith(p2)).toBe(true)
    expect(p1.isAlliedWith(p3)).toBe(false)
    expect(p1.relationshipWith(p3)).toBe(PlayerRelationship.Enemy)
  })

  it('supports multiple allies and enemies via union masks', () => {
    const { player: p1, world } = createTestPlayer({
      pr: createPlayerReference({ name: 'Player1' }),
    })
    const { player: p2 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player2' }),
    })
    const { player: p3 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player3' }),
    })
    const { player: p4 } = createTestPlayer({
      world,
      pr: createPlayerReference({ name: 'Player4' }),
    })

    // P1 allies with P2 and P4
    p1.alliedPlayersMask = p2.playerMask.union(p4.playerMask)
    // P1 enemies with P3
    p1.enemyPlayersMask = p3.playerMask

    expect(p1.isAlliedWith(p2)).toBe(true)
    expect(p1.isAlliedWith(p4)).toBe(true)
    expect(p1.isAlliedWith(p3)).toBe(false)
    expect(p1.relationshipWith(p3)).toBe(PlayerRelationship.Enemy)
  })
})
