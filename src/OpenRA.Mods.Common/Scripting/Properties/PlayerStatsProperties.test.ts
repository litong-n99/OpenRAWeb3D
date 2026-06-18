/**
 * PlayerStatsProperties.test.ts — Unit tests for PlayerStatsProperties
 *
 * Tests: registration, category, requiredTraits, all 6 read-only properties,
 * null trait handling, getOwnMemberDescriptors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { PlayerStatsProperties } from './PlayerStatsProperties.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubPlayer(overrides: Record<string, unknown> = {}): PlayerStub {
  return {
    playerName: 'TestPlayer',
    playerActor: {
      trait: vi.fn().mockReturnValue(null),
    },
    ...overrides,
  } as unknown as PlayerStub
}

function stubContext(): any {
  return {
    world: { actors: [], map: { rules: { actors: new Map() } } },
    worldRenderer: {},
    fatalErrorOccurred: false,
    errorMessage: null,
  }
}

describe('PlayerStatsProperties', () => {
  beforeEach(() => {
    // Module import handles registration
  })

  // ---- Category & Registration ----

  it('has category Player via ScriptRegistry', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerStatsProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Player')
  })

  it('requires PlayerStatisticsInfo', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerStatsProperties,
    )
    expect(reg!.requiredTraits).toContain('PlayerStatisticsInfo')
  })

  it('is registered with ScriptRegistry.registerPlayerProperty', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerStatsProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.description).toContain('KillsCost')
  })

  // ---- Properties with trait ----

  function createProps(statsOverrides: Record<string, unknown> = {}) {
    const stats = {
      killsCost: 1500,
      deathsCost: 800,
      unitsKilled: 25,
      unitsDead: 10,
      buildingsKilled: 5,
      buildingsDead: 2,
      ...statsOverrides,
    }
    const playerActor = {
      trait: vi.fn((name: string) => name === 'PlayerStatistics' ? stats : null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerStatsProperties(stubContext(), player)
    return { props, stats }
  }

  it('KillsCost returns killsCost', () => {
    const { props } = createProps({ killsCost: 1500 })
    expect(props.KillsCost).toBe(1500)
  })

  it('DeathsCost returns deathsCost', () => {
    const { props } = createProps({ deathsCost: 800 })
    expect(props.DeathsCost).toBe(800)
  })

  it('UnitsKilled returns unitsKilled', () => {
    const { props } = createProps({ unitsKilled: 25 })
    expect(props.UnitsKilled).toBe(25)
  })

  it('UnitsLost returns unitsDead (matching C# UnitsDead field)', () => {
    const { props } = createProps({ unitsDead: 10 })
    expect(props.UnitsLost).toBe(10)
  })

  it('BuildingsKilled returns buildingsKilled', () => {
    const { props } = createProps({ buildingsKilled: 5 })
    expect(props.BuildingsKilled).toBe(5)
  })

  it('BuildingsLost returns buildingsDead', () => {
    const { props } = createProps({ buildingsDead: 2 })
    expect(props.BuildingsLost).toBe(2)
  })

  // ---- PascalCase fallback ----

  it('properties fall back to PascalCase field names', () => {
    const stats = {
      KillsCost: 3000,
      DeathsCost: 2000,
      UnitsKilled: 50,
      UnitsDead: 20,
      BuildingsKilled: 10,
      BuildingsDead: 5,
    }
    const playerActor = {
      trait: vi.fn((name: string) => name === 'PlayerStatistics' ? stats : null),
    }
    const player = stubPlayer({ playerActor })
    const props = new PlayerStatsProperties(stubContext(), player)
    expect(props.KillsCost).toBe(3000)
    expect(props.DeathsCost).toBe(2000)
    expect(props.UnitsKilled).toBe(50)
    expect(props.UnitsLost).toBe(20)
    expect(props.BuildingsKilled).toBe(10)
    expect(props.BuildingsLost).toBe(5)
  })

  // ---- Null trait handling ----

  it('all properties return 0 when no PlayerStatistics trait', () => {
    const player = stubPlayer()
    const props = new PlayerStatsProperties(stubContext(), player)
    expect(props.KillsCost).toBe(0)
    expect(props.DeathsCost).toBe(0)
    expect(props.UnitsKilled).toBe(0)
    expect(props.UnitsLost).toBe(0)
    expect(props.BuildingsKilled).toBe(0)
    expect(props.BuildingsLost).toBe(0)
  })

  it('all properties return 0 when playerActor is undefined', () => {
    const player = stubPlayer({ playerActor: undefined })
    const props = new PlayerStatsProperties(stubContext(), player)
    expect(props.KillsCost).toBe(0)
    expect(props.DeathsCost).toBe(0)
    expect(props.UnitsKilled).toBe(0)
    expect(props.UnitsLost).toBe(0)
  })

  // ---- Member Descriptors ----

  it('getOwnMemberDescriptors returns all 6 properties', () => {
    const { props } = createProps()
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('KillsCost')
    expect(names).toContain('DeathsCost')
    expect(names).toContain('UnitsKilled')
    expect(names).toContain('UnitsLost')
    expect(names).toContain('BuildingsKilled')
    expect(names).toContain('BuildingsLost')
  })

  it('getOwnMemberDescriptors all are read-only (no set function)', () => {
    const { props } = createProps()
    const descs = props.getOwnMemberDescriptors()
    for (const d of descs) {
      expect(d.memberType).toBe('property')
      if (d.memberType === 'property') {
        expect(d.get).toBeDefined()
        expect(d.set).toBeUndefined() // read-only
      }
    }
  })
})
