/**
 * PlayerProperties.test.ts — Unit tests for PlayerProperties
 *
 * Tests: registration, category, requiredTraits, all 11 properties,
 * 5 methods, null/missing field handling, error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { PlayerProperties } from './PlayerProperties.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StubPlayer extends PlayerStub {
  internalName?: string
  resolvedPlayerName?: string
  getColor?: (p: unknown) => unknown
  faction?: { internalName: string }
  spawnPoint?: number
  homeLocation?: unknown
  clientIndex?: number
  isBot?: boolean
  nonCombatant?: boolean
  playerActor?: unknown
}

function stubPlayer(overrides: Partial<StubPlayer> = {}): StubPlayer {
  return {
    playerName: 'TestPlayer',
    internalName: 'test_internal',
    resolvedPlayerName: 'Test Player',
    getColor: vi.fn().mockReturnValue({ r: 255, g: 128, b: 64 }),
    faction: { internalName: 'allies' },
    spawnPoint: 3,
    homeLocation: { x: 10, y: 20 },
    clientIndex: 0,
    isBot: false,
    nonCombatant: false,
    playerActor: {
      trait: vi.fn().mockReturnValue(null),
    },
    ...overrides,
  } as unknown as StubPlayer
}

function stubActor(owner: PlayerStub, overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    isIdle: false,
    owner,
    disposed: false,
    traitName: 'test',
    world: {},
    info: { name: 'e1', traits: ['MobileInfo'] },
    trait: vi.fn().mockReturnValue(null),
    traitsImplementing: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as IGameActor
}

function stubContext(overrides: Record<string, unknown> = {}): any {
  return {
    world: {
      actors: [] as IGameActor[],
      lobbyInfo: { clients: [] as unknown[] },
      map: { rules: { actors: new Map() } },
      ...overrides,
    },
    worldRenderer: {},
    fatalErrorOccurred: false,
    errorMessage: null,
  }
}

describe('PlayerProperties', () => {
  beforeEach(() => {
    // Module import handles registration
  })

  // ---- Category & Registration ----

  it('has category Player via ScriptRegistry registration', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Player')
  })

  it('has empty requiredTraits', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerProperties,
    )
    expect(reg!.requiredTraits).toEqual([])
  })

  it('is registered with ScriptRegistry.registerPlayerProperty', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.description).toContain('InternalName')
  })

  // ---- Properties ----

  it('InternalName returns player internalName', () => {
    const player = stubPlayer({ internalName: 'goodguy' })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.InternalName).toBe('goodguy')
  })

  it('InternalName returns empty string when internalName missing', () => {
    const player = stubPlayer({ internalName: undefined })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.InternalName).toBe('')
  })

  it('Name returns resolvedPlayerName', () => {
    const player = stubPlayer({ resolvedPlayerName: 'Commander' })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Name).toBe('Commander')
  })

  it('Name falls back to playerName', () => {
    const player = stubPlayer({ resolvedPlayerName: undefined, playerName: 'fallback' })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Name).toBe('fallback')
  })

  it('Color returns getColor result', () => {
    const player = stubPlayer()
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Color).toEqual({ r: 255, g: 128, b: 64 })
  })

  it('Color returns null when getColor is not a function', () => {
    const player = stubPlayer({ getColor: undefined as unknown as (p: unknown) => unknown })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Color).toBeNull()
  })

  it('Faction returns faction internalName', () => {
    const player = stubPlayer({ faction: { internalName: 'soviet' } })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Faction).toBe('soviet')
  })

  it('Faction returns empty string when faction missing', () => {
    const player = stubPlayer({ faction: undefined as unknown as { internalName: string } })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Faction).toBe('')
  })

  it('Spawn returns spawnPoint', () => {
    const player = stubPlayer({ spawnPoint: 5 })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Spawn).toBe(5)
  })

  it('Spawn returns 0 when spawnPoint missing', () => {
    const player = stubPlayer({ spawnPoint: undefined })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.Spawn).toBe(0)
  })

  it('HomeLocation returns homeLocation value', () => {
    const loc = { x: 15, y: 25 }
    const player = stubPlayer({ homeLocation: loc })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.HomeLocation).toBe(loc)
  })

  it('Team returns team from lobby info client', () => {
    const player = stubPlayer({ clientIndex: 2 })
    const ctx = stubContext({
      lobbyInfo: {
        clients: [
          { index: 0, team: 1 },
          { index: 2, team: 3 },
        ],
      },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.Team).toBe(3)
  })

  it('Team returns 0 when client not found', () => {
    const player = stubPlayer({ clientIndex: 99 })
    const ctx = stubContext({
      lobbyInfo: {
        clients: [{ index: 0, team: 1 }],
      },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.Team).toBe(0)
  })

  it('Team returns 0 when no lobbyInfo', () => {
    const player = stubPlayer()
    const ctx = stubContext({ lobbyInfo: undefined })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.Team).toBe(0)
  })

  it('Handicap returns handicap from lobby info client', () => {
    const player = stubPlayer({ clientIndex: 1 })
    const ctx = stubContext({
      lobbyInfo: {
        clients: [
          { index: 0, handicap: 0 },
          { index: 1, handicap: 50 },
        ],
      },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.Handicap).toBe(50)
  })

  it('IsBot returns isBot value', () => {
    const player = stubPlayer({ isBot: true })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.IsBot).toBe(true)
  })

  it('IsNonCombatant returns nonCombatant value', () => {
    const player = stubPlayer({ nonCombatant: true })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.IsNonCombatant).toBe(true)
  })

  it('IsLocalPlayer returns true when player matches renderPlayer', () => {
    const player = stubPlayer()
    const ctx = stubContext({ renderPlayer: player, localPlayer: null })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.IsLocalPlayer).toBe(true)
  })

  it('IsLocalPlayer returns false when player does not match', () => {
    const player = stubPlayer()
    const other = stubPlayer({ playerName: 'Other' })
    const ctx = stubContext({ renderPlayer: other, localPlayer: other })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.IsLocalPlayer).toBe(false)
  })

  // ---- GetActors ----

  it('GetActors returns living in-world actors owned by player', () => {
    const player = stubPlayer()
    const a1 = stubActor(player as PlayerStub, { actorId: 1, isInWorld: true, isDead: false })
    const a2 = stubActor(player as PlayerStub, { actorId: 2, isInWorld: true, isDead: false })
    const a3 = stubActor(player as PlayerStub, { actorId: 3, isInWorld: false, isDead: false })
    const a4 = stubActor(player as PlayerStub, { actorId: 4, isInWorld: true, isDead: true })

    const other = stubPlayer({ playerName: 'Other' })
    const a5 = stubActor(other as PlayerStub, { actorId: 5, isInWorld: true, isDead: false })

    const ctx = stubContext({ actors: [a1, a2, a3, a4, a5] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    const result = props.GetActors()
    expect(result.length).toBe(2)
    expect(result).toContain(a1)
    expect(result).toContain(a2)
  })

  // ---- GetGroundAttackers ----

  it('GetGroundAttackers returns actors with AttackBase AND MobileInfo', () => {
    const player = stubPlayer()
    // Actor has both AttackBase trait AND MobileInfo in info.traits
    const a1 = stubActor(player as PlayerStub, {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      info: { name: 'e1', traits: ['MobileInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    // Actor with AttackBase but no MobileInfo (should be excluded)
    const a2 = stubActor(player as PlayerStub, {
      actorId: 2,
      isInWorld: true,
      isDead: false,
      info: { name: 'e2', traits: ['OtherInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    // Actor with MobileInfo but no AttackBase (should be excluded)
    const a3 = stubActor(player as PlayerStub, {
      actorId: 3,
      isInWorld: true,
      isDead: false,
      info: { name: 'e3', traits: ['MobileInfo'] },
      trait: vi.fn().mockReturnValue(null),
    })

    const ctx = stubContext({ actors: [a1, a2, a3] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    const result = props.GetGroundAttackers()
    expect(result.length).toBe(1)
    expect(result[0]).toBe(a1)
  })

  it('GetGroundAttackers excludes dead actors', () => {
    const player = stubPlayer()
    const a1 = stubActor(player as PlayerStub, {
      actorId: 1,
      isInWorld: true,
      isDead: true,
      info: { name: 'e1', traits: ['MobileInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    const ctx = stubContext({ actors: [a1] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.GetGroundAttackers()).toEqual([])
  })

  it('GetGroundAttackers excludes non-in-world actors', () => {
    const player = stubPlayer()
    const a1 = stubActor(player as PlayerStub, {
      actorId: 1,
      isInWorld: false,
      isDead: false,
      info: { name: 'e1', traits: ['MobileInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    const ctx = stubContext({ actors: [a1] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.GetGroundAttackers()).toEqual([])
  })

  it('GetGroundAttackers excludes actors owned by other player', () => {
    const player = stubPlayer()
    const other = stubPlayer({ playerName: 'Other' })
    const a1 = stubActor(other as PlayerStub, {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      info: { name: 'e1', traits: ['MobileInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    const ctx = stubContext({ actors: [a1] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.GetGroundAttackers()).toEqual([])
  })

  it('GetGroundAttackers returns empty array for empty world', () => {
    const player = stubPlayer()
    const ctx = stubContext({ actors: [] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.GetGroundAttackers()).toEqual([])
  })

  it('GetGroundAttackers does not match Immobile or similar non-Mobile traits', () => {
    const player = stubPlayer()
    // Actor with "Immobile" in traits but NOT "MobileInfo" — should NOT match
    const a1 = stubActor(player as PlayerStub, {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      info: { name: 'building', traits: ['Immobile', 'BuildingInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    // Actor with "MobileArtilleryBlocked" but NOT "MobileInfo" — should NOT match
    const a2 = stubActor(player as PlayerStub, {
      actorId: 2,
      isInWorld: true,
      isDead: false,
      info: { name: 'arty', traits: ['MobileArtilleryBlocked', 'AttackInfo'] },
      trait: vi.fn((name: string) => name === 'AttackBase' ? {} : null),
    })
    const ctx = stubContext({ actors: [a1, a2] })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(props.GetGroundAttackers()).toEqual([])
  })

  // ---- GetActorsByType ----

  it('GetActorsByType returns matching actors', () => {
    const player = stubPlayer()
    const e1a = stubActor(player as PlayerStub, { actorId: 1, info: { name: 'e1', traits: [] } })
    const e1b = stubActor(player as PlayerStub, { actorId: 2, info: { name: 'e1', traits: [] } })
    const e2 = stubActor(player as PlayerStub, { actorId: 3, info: { name: 'e2', traits: [] } })

    const actorsMap = new Map<string, any>([
      ['e1', { name: 'e1' }],
      ['e2', { name: 'e2' }],
    ])
    const ctx = stubContext({
      actors: [e1a, e1b, e2],
      map: { rules: { actors: actorsMap } },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    const result = props.GetActorsByType('e1')
    expect(result.length).toBe(2)
    expect(result).toContain(e1a)
    expect(result).toContain(e1b)
  })

  it('GetActorsByType throws for unknown type', () => {
    const player = stubPlayer()
    const actorsMap = new Map<string, any>([['e1', { name: 'e1' }]])
    const ctx = stubContext({
      actors: [],
      map: { rules: { actors: actorsMap } },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(() => props.GetActorsByType('unknown')).toThrow("Unknown actor type 'unknown'")
  })

  // ---- GetActorsByTypes ----

  it('GetActorsByTypes returns matching actors for multiple types', () => {
    const player = stubPlayer()
    const e1 = stubActor(player as PlayerStub, { actorId: 1, info: { name: 'e1', traits: [] } })
    const e2 = stubActor(player as PlayerStub, { actorId: 2, info: { name: 'e2', traits: [] } })
    const e3 = stubActor(player as PlayerStub, { actorId: 3, info: { name: 'e3', traits: [] } })

    const actorsMap = new Map<string, any>([
      ['e1', { name: 'e1' }],
      ['e2', { name: 'e2' }],
      ['e3', { name: 'e3' }],
    ])
    const ctx = stubContext({
      actors: [e1, e2, e3],
      map: { rules: { actors: actorsMap } },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    const result = props.GetActorsByTypes(['e1', 'e3'])
    expect(result.length).toBe(2)
    expect(result).toContain(e1)
    expect(result).toContain(e3)
  })

  it('GetActorsByTypes throws if any type is unknown', () => {
    const player = stubPlayer()
    const actorsMap = new Map<string, any>([['e1', { name: 'e1' }]])
    const ctx = stubContext({
      actors: [],
      map: { rules: { actors: actorsMap } },
    })
    const props = new PlayerProperties(ctx, player as PlayerStub)
    expect(() => props.GetActorsByTypes(['e1', 'unknown'])).toThrow(
      "Unknown actor type 'unknown'",
    )
  })

  // ---- HasPrerequisites ----

  it('HasPrerequisites delegates to TechTree trait', () => {
    const tt = { hasPrerequisites: vi.fn().mockReturnValue(true) }
    const playerActor = { trait: vi.fn((name: string) => name === 'TechTree' ? tt : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(props.HasPrerequisites(['factory', 'radar'])).toBe(true)
    expect(tt.hasPrerequisites).toHaveBeenCalledWith(['factory', 'radar'])
  })

  it('HasPrerequisites throws when no playerActor', () => {
    const player = stubPlayer({ playerActor: undefined })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(() => props.HasPrerequisites(['test'])).toThrow('Missing playerActor')
  })

  it('HasPrerequisites throws when TechTree trait missing', () => {
    const playerActor = { trait: vi.fn().mockReturnValue(null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    expect(() => props.HasPrerequisites(['test'])).toThrow('Missing TechTree trait')
  })

  // ---- Member Descriptors ----

  it('getOwnMemberDescriptors returns all properties and methods', () => {
    const player = stubPlayer()
    const props = new PlayerProperties(stubContext(), player as PlayerStub)
    const descs = props.getOwnMemberDescriptors()
    const names = descs.map(d => d.name)
    expect(names).toContain('InternalName')
    expect(names).toContain('Name')
    expect(names).toContain('Color')
    expect(names).toContain('Faction')
    expect(names).toContain('Spawn')
    expect(names).toContain('HomeLocation')
    expect(names).toContain('Team')
    expect(names).toContain('Handicap')
    expect(names).toContain('IsBot')
    expect(names).toContain('IsNonCombatant')
    expect(names).toContain('IsLocalPlayer')
    expect(names).toContain('GetActors')
    expect(names).toContain('GetGroundAttackers')
    expect(names).toContain('GetActorsByType')
    expect(names).toContain('GetActorsByTypes')
    expect(names).toContain('HasPrerequisites')
  })
})
