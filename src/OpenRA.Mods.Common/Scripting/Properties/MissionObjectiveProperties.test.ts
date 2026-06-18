/**
 * MissionObjectiveProperties.test.ts — Unit tests for MissionObjectiveProperties
 *
 * Tests: registration, category, requiredTraits, all 10 methods,
 * error paths for invalid objective IDs, null trait handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { MissionObjectiveProperties } from './MissionObjectiveProperties.js'

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

function stubContext(overrides: Record<string, unknown> = {}): any {
  return {
    world: {
      actors: [],
      worldActor: {
        trait: vi.fn().mockReturnValue({ shortGame: false }),
      },
      map: { rules: { actors: new Map() } },
      ...overrides,
    },
    worldRenderer: {},
    fatalErrorOccurred: false,
    errorMessage: null,
  }
}

describe('MissionObjectiveProperties', () => {
  beforeEach(() => {
    // Module import handles registration
  })

  // ---- Category & Registration ----

  it('has category MissionObjectives via ScriptRegistry', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === MissionObjectiveProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('MissionObjectives')
  })

  it('requires MissionObjectivesInfo', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === MissionObjectiveProperties,
    )
    expect(reg!.requiredTraits).toContain('MissionObjectivesInfo')
  })

  it('is registered with ScriptRegistry.registerPlayerProperty', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === MissionObjectiveProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.description).toContain('AddObjective')
  })

  // ---- Setup with trait ----

  function createProps(moOverrides: Record<string, unknown> = {}) {
    const objectives: any[] = []
    const mo = {
      add: vi.fn().mockReturnValue(0),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      objectives,
      ...moOverrides,
    }
    const playerActor = { trait: vi.fn((name: string) => name === 'MissionObjectives' ? mo : null) }
    const player = stubPlayer({ playerActor })
    const props = new MissionObjectiveProperties(stubContext(), player)
    return { props, mo, objectives }
  }

  // ---- AddObjective ----

  it('AddObjective calls mo.add with defaults', () => {
    const { props, mo } = createProps()
    const id = props.AddObjective('Destroy enemy base')
    expect(mo.add).toHaveBeenCalledWith(expect.anything(), 'Destroy enemy base', 'Primary', true)
    expect(id).toBe(0)
  })

  it('AddObjective passes type and required params', () => {
    const { props, mo } = createProps()
    props.AddObjective('Scout area', 'Secondary', false)
    expect(mo.add).toHaveBeenCalledWith(expect.anything(), 'Scout area', 'Secondary', false)
  })

  it('AddPrimaryObjective calls AddObjective with defaults', () => {
    const { props, mo } = createProps()
    const id = props.AddPrimaryObjective('Primary task')
    expect(mo.add).toHaveBeenCalledWith(expect.anything(), 'Primary task', 'Primary', true)
    expect(id).toBe(0)
  })

  it('AddSecondaryObjective calls AddObjective as Secondary, not required', () => {
    const { props, mo } = createProps()
    const id = props.AddSecondaryObjective('Side task')
    expect(mo.add).toHaveBeenCalledWith(expect.anything(), 'Side task', 'Secondary', false)
    expect(id).toBe(0)
  })

  // ---- MarkCompleted / MarkFailed ----

  it('MarkCompletedObjective calls mo.markCompleted with player and id', () => {
    const { props, mo, objectives } = createProps()
    objectives.push({ id: 0, state: 'Incomplete', description: 'test', type: 'Primary' })
    props.MarkCompletedObjective(0)
    expect(mo.markCompleted).toHaveBeenCalledWith(expect.anything(), 0)
  })

  it('MarkFailedObjective calls mo.markFailed with player and id', () => {
    const { props, mo, objectives } = createProps()
    objectives.push({ id: 0, state: 'Incomplete', description: 'test', type: 'Primary' })
    props.MarkFailedObjective(0)
    expect(mo.markFailed).toHaveBeenCalledWith(expect.anything(), 0)
  })

  it('MarkCompletedObjective throws for out-of-range ID', () => {
    const { props } = createProps()
    expect(() => props.MarkCompletedObjective(-1)).toThrow('Objective ID is out of range')
    expect(() => props.MarkCompletedObjective(0)).toThrow('Objective ID is out of range')
  })

  it('MarkFailedObjective throws for out-of-range ID', () => {
    const { props } = createProps()
    expect(() => props.MarkFailedObjective(5)).toThrow('Objective ID is out of range')
  })

  // ---- IsObjectiveCompleted / IsObjectiveFailed ----

  it('IsObjectiveCompleted returns true for Completed state', () => {
    const { props, objectives } = createProps()
    objectives.push({ id: 0, state: 'Completed', description: 'test', type: 'Primary' })
    expect(props.IsObjectiveCompleted(0)).toBe(true)
  })

  it('IsObjectiveCompleted returns false for non-Completed state', () => {
    const { props, objectives } = createProps()
    objectives.push({ id: 0, state: 'Incomplete', description: 'test', type: 'Primary' })
    expect(props.IsObjectiveCompleted(0)).toBe(false)
  })

  it('IsObjectiveFailed returns true for Failed state', () => {
    const { props, objectives } = createProps()
    objectives.push({ id: 0, state: 'Failed', description: 'test', type: 'Primary' })
    expect(props.IsObjectiveFailed(0)).toBe(true)
  })

  it('IsObjectiveFailed returns false for non-Failed state', () => {
    const { props, objectives } = createProps()
    objectives.push({ id: 0, state: 'Incomplete', description: 'test', type: 'Primary' })
    expect(props.IsObjectiveFailed(0)).toBe(false)
  })

  // ---- GetObjectiveDescription / GetObjectiveType ----

  it('GetObjectiveDescription returns description field', () => {
    const { props, objectives } = createProps()
    objectives.push({ id: 0, state: 'Incomplete', description: 'Do the thing', type: 'Primary' })
    expect(props.GetObjectiveDescription(0)).toBe('Do the thing')
  })

  it('GetObjectiveType returns type field', () => {
    const { props, objectives } = createProps()
    objectives.push({ id: 0, state: 'Incomplete', description: 'test', type: 'Secondary' })
    expect(props.GetObjectiveType(0)).toBe('Secondary')
  })

  it('GetObjectiveDescription throws for out-of-range ID', () => {
    const { props } = createProps()
    expect(() => props.GetObjectiveDescription(-1)).toThrow('Objective ID is out of range')
  })

  // ---- HasNoRequiredUnits ----

  it('HasNoRequiredUnits delegates to player.hasNoRequiredUnits', () => {
    const mo = {
      add: vi.fn().mockReturnValue(0),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      objectives: [],
    }
    const playerActor = { trait: vi.fn((name: string) => name === 'MissionObjectives' ? mo : null) }
    const player = stubPlayer({
      playerActor,
      hasNoRequiredUnits: vi.fn().mockReturnValue(true),
    })
    const worldActor = { trait: vi.fn().mockReturnValue({ shortGame: true }) }
    // stubContext spreads overrides into the world object, so pass properties directly
    const ctx = stubContext({ worldActor })
    const props = new MissionObjectiveProperties(ctx, player)
    expect(props.HasNoRequiredUnits()).toBe(true)
    expect((player as any).hasNoRequiredUnits).toHaveBeenCalledWith(true)
  })

  it('HasNoRequiredUnits returns false when method absent', () => {
    const { props } = createProps()
    expect(props.HasNoRequiredUnits()).toBe(false)
  })

  // ---- Null trait handling ----

  it('throws when MissionObjectives trait not found on player actor', () => {
    const player = stubPlayer({ playerActor: undefined })
    const props = new MissionObjectiveProperties(stubContext(), player)
    expect(() => props.AddObjective('test')).toThrow('MissionObjectives trait not found on player actor')
  })

  // ---- Member Descriptors ----

  it('getOwnMemberDescriptors returns all 10 methods', () => {
    const { props } = createProps()
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('AddObjective')
    expect(names).toContain('AddPrimaryObjective')
    expect(names).toContain('AddSecondaryObjective')
    expect(names).toContain('MarkCompletedObjective')
    expect(names).toContain('MarkFailedObjective')
    expect(names).toContain('IsObjectiveCompleted')
    expect(names).toContain('IsObjectiveFailed')
    expect(names).toContain('GetObjectiveDescription')
    expect(names).toContain('GetObjectiveType')
    expect(names).toContain('HasNoRequiredUnits')
  })
})
