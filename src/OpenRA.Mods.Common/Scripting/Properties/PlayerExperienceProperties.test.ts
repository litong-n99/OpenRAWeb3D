/**
 * PlayerExperienceProperties.test.ts — Unit tests for PlayerExperienceProperties
 *
 * Tests: registration, category, requiredTraits, Experience get/set,
 * null trait handling, delta calculation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { PlayerExperienceProperties } from './PlayerExperienceProperties.js'

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

describe('PlayerExperienceProperties', () => {
  beforeEach(() => {
    // Module import handles registration
  })

  // ---- Category & Registration ----

  it('has category Player via ScriptRegistry', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerExperienceProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Player')
  })

  it('requires PlayerExperienceInfo', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerExperienceProperties,
    )
    expect(reg!.requiredTraits).toContain('PlayerExperienceInfo')
  })

  it('is registered with ScriptRegistry.registerPlayerProperty', () => {
    const reg = ScriptRegistry.getPlayerProperties().find(
      p => p.ctor === PlayerExperienceProperties,
    )
    expect(reg).toBeDefined()
    expect(reg!.description).toContain('Experience')
  })

  // ---- Experience get ----

  it('Experience get returns current experience', () => {
    const exp = { experience: 500, giveExperience: vi.fn() }
    const playerActor = { trait: vi.fn((name: string) => name === 'PlayerExperience' ? exp : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerExperienceProperties(stubContext(), player)
    expect(props.Experience).toBe(500)
  })

  it('Experience get returns 0 when no trait', () => {
    const player = stubPlayer()
    const props = new PlayerExperienceProperties(stubContext(), player)
    expect(props.Experience).toBe(0)
  })

  it('Experience get works with PascalCase field', () => {
    const exp = { Experience: 750, giveExperience: vi.fn() }
    const playerActor = { trait: vi.fn((name: string) => name === 'PlayerExperience' ? exp : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerExperienceProperties(stubContext(), player)
    expect(props.Experience).toBe(750)
  })

  // ---- Experience set ----

  it('Experience set calls giveExperience with delta', () => {
    const giveExperience = vi.fn()
    const exp = { experience: 500, giveExperience }
    const playerActor = { trait: vi.fn((name: string) => name === 'PlayerExperience' ? exp : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerExperienceProperties(stubContext(), player)
    props.Experience = 800
    expect(giveExperience).toHaveBeenCalledWith(300)
  })

  it('Experience set with negative delta', () => {
    const giveExperience = vi.fn()
    const exp = { experience: 1000, giveExperience }
    const playerActor = { trait: vi.fn((name: string) => name === 'PlayerExperience' ? exp : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerExperienceProperties(stubContext(), player)
    props.Experience = 300
    expect(giveExperience).toHaveBeenCalledWith(-700)
  })

  it('Experience set no-ops when trait missing', () => {
    const player = stubPlayer()
    const props = new PlayerExperienceProperties(stubContext(), player)
    // Should not throw
    expect(() => { props.Experience = 100 }).not.toThrow()
    expect(props.Experience).toBe(0)
  })

  // ---- Member Descriptors ----

  it('getOwnMemberDescriptors returns Experience', () => {
    const player = stubPlayer()
    const props = new PlayerExperienceProperties(stubContext(), player)
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Experience')
  })

  // ---- Descriptor property get/set ----

  it('descriptor get returns Experience value', () => {
    const exp = { experience: 250, giveExperience: vi.fn() }
    const playerActor = { trait: vi.fn((name: string) => name === 'PlayerExperience' ? exp : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerExperienceProperties(stubContext(), player)
    const d = props.getOwnMemberDescriptors().find(d => d.name === 'Experience')!
    expect(d.memberType).toBe('property')
    let v: number = 0
    if (d.memberType === 'property' && d.get) v = d.get({}) as number
    expect(v).toBe(250)
  })

  it('descriptor set calls setter with correct value', () => {
    const giveExperience = vi.fn()
    const exp = { experience: 200, giveExperience }
    const playerActor = { trait: vi.fn((name: string) => name === 'PlayerExperience' ? exp : null) }
    const player = stubPlayer({ playerActor })
    const props = new PlayerExperienceProperties(stubContext(), player)
    const d = props.getOwnMemberDescriptors().find(d => d.name === 'Experience')!
    if (d.memberType === 'property' && d.set) d.set({}, 350)
    expect(giveExperience).toHaveBeenCalledWith(150)
  })
})
