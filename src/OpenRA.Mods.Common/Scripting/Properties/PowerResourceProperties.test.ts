/**
 * PowerResourceProperties.test.ts — Unit tests for power/resource/diplomacy property classes
 *
 * Covers: PlayerPowerProperties (player-scoped), ActorPowerProperties (actor-scoped),
 * ResourceProperties (player-scoped), DiplomacyProperties (player-scoped)
 *
 * Tests: registration, category, requiredTraits, property get/set,
 * method invocation, member descriptor completeness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { PlayerPowerProperties, ActorPowerProperties } from './PowerProperties.js'
import { ResourceProperties } from './ResourceProperties.js'
import { DiplomacyProperties } from './DiplomacyProperties.js'

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    isIdle: false,
    owner: { playerName: 'TestPlayer' } as PlayerStub,
    disposed: false,
    traitName: 'test',
    world: {},
    info: { name: 'testActor', traits: [] },
    trait: vi.fn().mockReturnValue(null),
    traitsImplementing: vi.fn().mockReturnValue([]),
    queueActivity: vi.fn(),
    ...overrides,
  } as unknown as IGameActor
}

function stubContext() {
  return { world: {}, worldRenderer: {}, fatalErrorOccurred: false, errorMessage: null } as any
}

// ---------------------------------------------------------------------------
// PlayerPowerProperties (player-scoped)
// ---------------------------------------------------------------------------

describe('PlayerPowerProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  function stubPlayer(pmOverrides: Record<string, unknown> = {}): PlayerStub {
    const pm = {
      powerProvided: 100,
      powerDrained: 50,
      powerState: 'Normal' as const,
      playLowPowerNotification: false,
      triggerPowerOutage: vi.fn(),
      ...pmOverrides,
    }
    return {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(pm) },
    } as unknown as PlayerStub & { playerActor: any }
  }

  it('is registered with ScriptRegistry as player property', () => {
    const props = ScriptRegistry.getPlayerProperties()
    const reg = props.find(p => p.ctor === PlayerPowerProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Power')
    expect(reg!.requiredTraits).toContain('PowerManagerInfo')
  })

  it('requires PowerManagerInfo', () => {
    expect(PlayerPowerProperties.requiredTraits).toContain('PowerManagerInfo')
  })

  it('get PowerProvided returns pm.powerProvided', () => {
    const player = stubPlayer({ powerProvided: 200 })
    const p = new PlayerPowerProperties(stubContext(), player)
    expect(p.PowerProvided).toBe(200)
  })

  it('get PowerDrained returns pm.powerDrained', () => {
    const player = stubPlayer({ powerDrained: 80 })
    const p = new PlayerPowerProperties(stubContext(), player)
    expect(p.PowerDrained).toBe(80)
  })

  it('get PowerState returns pm.powerState', () => {
    const player = stubPlayer({ powerState: 'Low' })
    const p = new PlayerPowerProperties(stubContext(), player)
    expect(p.PowerState).toBe('Low')
  })

  it('get PlayLowPowerNotification returns false when disabled', () => {
    const player = stubPlayer({ playLowPowerNotification: false })
    const p = new PlayerPowerProperties(stubContext(), player)
    expect(p.PlayLowPowerNotification).toBe(false)
  })

  it('set PlayLowPowerNotification updates the flag', () => {
    const pm = { playLowPowerNotification: false }
    const player = {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(pm) },
    } as unknown as PlayerStub & { playerActor: any }
    const p = new PlayerPowerProperties(stubContext(), player)
    p.PlayLowPowerNotification = true
    expect(pm.playLowPowerNotification).toBe(true)
  })

  it('TriggerPowerOutage calls pm.triggerPowerOutage', () => {
    const player = stubPlayer()
    const p = new PlayerPowerProperties(stubContext(), player)
    const pm = (player as any).playerActor.trait()
    p.TriggerPowerOutage(10)
    expect(pm.triggerPowerOutage).toHaveBeenCalledWith(10)
  })

  it('getOwnMemberDescriptors returns all 5 members', () => {
    const player = stubPlayer()
    const p = new PlayerPowerProperties(stubContext(), player)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('PowerProvided')
    expect(names).toContain('PowerDrained')
    expect(names).toContain('PowerState')
    expect(names).toContain('PlayLowPowerNotification')
    expect(names).toContain('TriggerPowerOutage')
  })

  it('returns 0 PowerProvided when no PowerManager', () => {
    const player = {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(null) },
    } as unknown as PlayerStub & { playerActor: any }
    const p = new PlayerPowerProperties(stubContext(), player)
    expect(p.PowerProvided).toBe(0)
    expect(p.PowerDrained).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ActorPowerProperties (actor-scoped)
// ---------------------------------------------------------------------------

describe('ActorPowerProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Power', () => {
    expect(ActorPowerProperties.category).toBe('Power')
  })

  it('requires PowerInfo', () => {
    expect(ActorPowerProperties.requiredTraits).toContain('PowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(ActorPowerProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === ActorPowerProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Power')
    expect(reg!.requiredTraits).toContain('PowerInfo')
  })

  it('get Power sums enabled power from all traits', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([
        { getEnabledPower: () => 50 },
        { getEnabledPower: () => 30 },
      ]),
    })
    const p = new ActorPowerProperties(stubContext(), actor)
    expect(p.Power).toBe(80)
  })

  it('get Power returns 0 when no power traits', () => {
    const actor = stubActor()
    const p = new ActorPowerProperties(stubContext(), actor)
    expect(p.Power).toBe(0)
  })

  it('getOwnMemberDescriptors returns Power', () => {
    const actor = stubActor()
    const p = new ActorPowerProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Power')
  })
})

// ---------------------------------------------------------------------------
// ResourceProperties (player-scoped)
// ---------------------------------------------------------------------------

describe('ResourceProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  function stubPlayer(prOverrides: Record<string, unknown> = {}): PlayerStub {
    const pr = {
      resources: 500,
      resourceCapacity: 1000,
      cash: 300,
      ...prOverrides,
    }
    return {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(pr) },
    } as unknown as PlayerStub & { playerActor: any }
  }

  it('is registered with ScriptRegistry as player property', () => {
    const props = ScriptRegistry.getPlayerProperties()
    const reg = props.find(p => p.ctor === ResourceProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Resources')
    expect(reg!.requiredTraits).toContain('PlayerResourcesInfo')
  })

  it('requires PlayerResourcesInfo', () => {
    expect(ResourceProperties.requiredTraits).toContain('PlayerResourcesInfo')
  })

  it('get Resources returns pr.resources', () => {
    const player = stubPlayer({ resources: 750 })
    const p = new ResourceProperties(stubContext(), player)
    expect(p.Resources).toBe(750)
  })

  it('set Resources clamps between 0 and capacity', () => {
    const pr = { resources: 500, resourceCapacity: 1000, cash: 0 }
    const player = {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(pr) },
    } as unknown as PlayerStub & { playerActor: any }
    const p = new ResourceProperties(stubContext(), player)
    p.Resources = 1500
    expect(pr.resources).toBe(1000) // clamped to capacity
    p.Resources = -100
    expect(pr.resources).toBe(0) // clamped to 0
  })

  it('get ResourceCapacity returns pr.resourceCapacity', () => {
    const player = stubPlayer({ resourceCapacity: 2000 })
    const p = new ResourceProperties(stubContext(), player)
    expect(p.ResourceCapacity).toBe(2000)
  })

  it('get Cash returns pr.cash', () => {
    const player = stubPlayer({ cash: 500 })
    const p = new ResourceProperties(stubContext(), player)
    expect(p.Cash).toBe(500)
  })

  it('set Cash clamps to 0 minimum', () => {
    const pr = { resources: 0, resourceCapacity: 1000, cash: 100 }
    const player = {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(pr) },
    } as unknown as PlayerStub & { playerActor: any }
    const p = new ResourceProperties(stubContext(), player)
    p.Cash = -50
    expect(pr.cash).toBe(0)
    p.Cash = 200
    expect(pr.cash).toBe(200)
  })

  it('getOwnMemberDescriptors returns Resources, ResourceCapacity, Cash', () => {
    const player = stubPlayer()
    const p = new ResourceProperties(stubContext(), player)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Resources')
    expect(names).toContain('ResourceCapacity')
    expect(names).toContain('Cash')
  })

  it('returns 0 for all values when no PlayerResources trait', () => {
    const player = {
      playerName: 'TestPlayer',
      playerActor: { trait: vi.fn().mockReturnValue(null) },
    } as unknown as PlayerStub & { playerActor: any }
    const p = new ResourceProperties(stubContext(), player)
    expect(p.Resources).toBe(0)
    expect(p.ResourceCapacity).toBe(0)
    expect(p.Cash).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// DiplomacyProperties (player-scoped)
// ---------------------------------------------------------------------------

describe('DiplomacyProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('is registered with ScriptRegistry as player property', () => {
    const props = ScriptRegistry.getPlayerProperties()
    const reg = props.find(p => p.ctor === DiplomacyProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Diplomacy')
    expect(reg!.requiredTraits).toEqual([])
  })

  it('has empty requiredTraits (no trait dependency)', () => {
    expect(DiplomacyProperties.requiredTraits).toEqual([])
  })

  it('IsAlliedWith returns true when players are allied', () => {
    const player = {
      playerName: 'TestPlayer',
      isAlliedWith: vi.fn().mockReturnValue(true),
    } as unknown as PlayerStub & { isAlliedWith: any }
    const targetPlayer = { playerName: 'AllyPlayer' } as PlayerStub
    const p = new DiplomacyProperties(stubContext(), player)
    expect(p.IsAlliedWith(targetPlayer)).toBe(true)
    expect(player.isAlliedWith).toHaveBeenCalledWith(targetPlayer)
  })

  it('IsAlliedWith returns false when not allied', () => {
    const player = {
      playerName: 'TestPlayer',
      isAlliedWith: vi.fn().mockReturnValue(false),
    } as unknown as PlayerStub & { isAlliedWith: any }
    const targetPlayer = { playerName: 'EnemyPlayer' } as PlayerStub
    const p = new DiplomacyProperties(stubContext(), player)
    expect(p.IsAlliedWith(targetPlayer)).toBe(false)
  })

  it('IsAlliedWith returns false when no isAlliedWith method', () => {
    const player = { playerName: 'TestPlayer' } as PlayerStub
    const targetPlayer = { playerName: 'OtherPlayer' } as PlayerStub
    const p = new DiplomacyProperties(stubContext(), player)
    expect(p.IsAlliedWith(targetPlayer)).toBe(false)
  })

  it('getOwnMemberDescriptors returns IsAlliedWith', () => {
    const player = { playerName: 'TestPlayer' } as PlayerStub
    const p = new DiplomacyProperties(stubContext(), player)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('IsAlliedWith')
  })
})
