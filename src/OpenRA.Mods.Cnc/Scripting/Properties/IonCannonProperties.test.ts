/**
 * IonCannonProperties.test.ts — Unit tests for IonCannonProperties
 *
 * Tests: registration, category, requiredTraits, exposedForDestroyedActors,
 * method invocation, member descriptor completeness.
 *
 *
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { MethodDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { IonCannonProperties } from './IonCannonProperties.js'

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
    world: {
      map: {
        mapSize: { width: 128, height: 128 },
      },
    },
    info: { name: 'testActor', traits: [] },
    trait: vi.fn().mockReturnValue(null),
    traitsImplementing: vi.fn().mockReturnValue([]),
    queueActivity: vi.fn(),
    ...overrides,
  } as unknown as IGameActor
}

function stubActorWithoutMap(): IGameActor {
  return stubActor({
    world: {},
  })
}

function stubContext() {
  return { world: {}, worldRenderer: {}, fatalErrorOccurred: false, errorMessage: null } as any
}

// ---------------------------------------------------------------------------
// IonCannonProperties
// ---------------------------------------------------------------------------

describe('IonCannonProperties', () => {
  beforeEach(() => {
    // Module-level registrations handled by file import
  })

  it('has category Support Powers', () => {
    expect(IonCannonProperties.category).toBe('Support Powers')
  })

  it('requires IonCannonPowerInfo', () => {
    expect(IonCannonProperties.requiredTraits).toContain('IonCannonPowerInfo')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(IonCannonProperties.exposedForDestroyedActors).toBe(false)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const reg = props.find(p => p.ctor === IonCannonProperties)
    expect(reg).toBeDefined()
    expect(reg!.category).toBe('Support Powers')
    expect(reg!.requiredTraits).toContain('IonCannonPowerInfo')
  })

  it('ActivateIonCannon calls activate on the ion cannon power trait', () => {
    const icp = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp]
        return []
      }),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    const target = { x: 5, y: 3 }
    p.ActivateIonCannon(target)
    expect(icp.activate).toHaveBeenCalledWith(actor, target)
  })

  it('ActivateIonCannon does nothing when no IonCannonPower trait', () => {
    const actor = stubActor({
      traitsImplementing: vi.fn().mockReturnValue([]),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    // Should not throw
    expect(() => p.ActivateIonCannon({ x: 5, y: 3 })).not.toThrow()
  })

  it('ActivateIonCannon uses first power when multiple traits exist', () => {
    const icp1 = { activate: vi.fn() }
    const icp2 = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp1, icp2]
        return []
      }),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    const target = { x: 10, y: 20 }
    p.ActivateIonCannon(target)
    expect(icp1.activate).toHaveBeenCalledWith(actor, target)
    expect(icp2.activate).not.toHaveBeenCalled()
  })

  it('getOwnMemberDescriptors returns ActivateIonCannon', () => {
    const actor = stubActor()
    const p = new IonCannonProperties(stubContext(), actor)
    const names = p.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('ActivateIonCannon')
    // Verify descriptor structure
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'ActivateIonCannon')
    expect(desc).toBeDefined()
    expect(desc!.memberType).toBe('method')
    expect(desc!.returnType).toBe('nil')
    expect((desc as MethodDescriptor).parameters).toHaveLength(1)
    expect((desc as MethodDescriptor).parameters[0].name).toBe('target')
  })

  it('member descriptor invoke calls ActivateIonCannon', () => {
    const icp = { activate: vi.fn() }
    const actor = stubActor({
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp]
        return []
      }),
    })
    const p = new IonCannonProperties(stubContext(), actor)
    const desc = p.getOwnMemberDescriptors().find(d => d.name === 'ActivateIonCannon')
    expect(desc).toBeDefined()
    const target = { x: 7, y: 8 }
    ;(desc as MethodDescriptor).invoke?.(p, [target])
    expect(icp.activate).toHaveBeenCalledWith(actor, target)
  })

  // -------------------------------------------------------------------------
  // Map bounds validation — P1-E.9
  // -------------------------------------------------------------------------

  describe('Map bounds validation', () => {
    it('rejects target with negative coordinates', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon({ x: -1, y: 5 })
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('rejects target with x beyond map width', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon({ x: 200, y: 5 })
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('rejects target with y beyond map height', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon({ x: 5, y: 200 })
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('accepts target at map boundary (0, 0)', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon({ x: 0, y: 0 })
      expect(icp.activate).toHaveBeenCalled()
    })

    it('accepts target at map boundary (max-1, max-1)', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon({ x: 127, y: 127 })
      expect(icp.activate).toHaveBeenCalled()
    })

    it('rejects null target', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon(null)
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('rejects undefined target', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon(undefined)
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('rejects non-object target (number)', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon(42)
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('rejects object without x/y properties', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActor({
        traitsImplementing: vi.fn((name: string) => {
          if (name === 'IonCannonPower') return [icp]
          return []
        }),
      })
      const p = new IonCannonProperties(stubContext(), actor)
      p.ActivateIonCannon({ foo: 'bar' })
      expect(icp.activate).not.toHaveBeenCalled()
    })

    it('allows activation when map bounds info is unavailable', () => {
      const icp = { activate: vi.fn() }
      const actor = stubActorWithoutMap()
      // Override traitsImplementing for this actor
      ;(actor.traitsImplementing as any) = vi.fn((name: string) => {
        if (name === 'IonCannonPower') return [icp]
        return []
      })
      const p = new IonCannonProperties(stubContext(), actor)
      // Even with seemingly out-of-bounds coordinates, when map is unavailable
      // we allow it through (the trait handles its own validation)
      p.ActivateIonCannon({ x: 500, y: 500 })
      expect(icp.activate).toHaveBeenCalledWith(actor, { x: 500, y: 500 })
    })
  })
})
