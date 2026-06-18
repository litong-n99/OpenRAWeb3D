/**
 * GeneralProperties.test.ts — Unit tests for GeneralProperties (4 classes)
 *
 * Tests: registration, exposedForDestroyedActors, property get/set delegation,
 * method invocation, HasProperty, Flash, tags, stance, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// Import to trigger registration
import { BaseActorProperties, GeneralProperties, LocationProperties, FacingProperties } from './GeneralProperties.js'

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
    ...overrides,
  } as unknown as IGameActor
}

function stubContext() {
  return { world: {}, worldRenderer: {}, fatalErrorOccurred: false, errorMessage: null } as any
}

// ---------------------------------------------------------------------------
// Registration Tests
// ---------------------------------------------------------------------------

describe('BaseActorProperties — registration', () => {
  it('has category General', () => {
    expect(BaseActorProperties.category).toBe('General')
  })

  it('has empty requiredTraits (safe on dead actors)', () => {
    expect(BaseActorProperties.requiredTraits).toEqual([])
  })

  it('has exposedForDestroyedActors = true', () => {
    expect(BaseActorProperties.exposedForDestroyedActors).toBe(true)
  })

  it('is registered with ScriptRegistry', () => {
    const props = ScriptRegistry.getActorProperties()
    const bp = props.find(p => p.ctor === BaseActorProperties)
    expect(bp).toBeDefined()
    expect(bp!.exposedForDestroyedActors).toBe(true)
    expect(bp!.category).toBe('General')
  })
})

describe('GeneralProperties — registration', () => {
  it('has category General', () => {
    expect(GeneralProperties.category).toBe('General')
  })

  it('has exposedForDestroyedActors = false', () => {
    expect(GeneralProperties.exposedForDestroyedActors).toBe(false)
  })
})

describe('LocationProperties — registration', () => {
  it('has requiredTraits IOccupySpaceInfo', () => {
    expect(LocationProperties.requiredTraits).toContain('IOccupySpaceInfo')
  })
})

describe('FacingProperties — registration', () => {
  it('has requiredTraits IFacingInfo', () => {
    expect(FacingProperties.requiredTraits).toContain('IFacingInfo')
  })
})

// ---------------------------------------------------------------------------
// BaseActorProperties — property tests
// ---------------------------------------------------------------------------

describe('BaseActorProperties', () => {
  let props: BaseActorProperties
  let actor: ReturnType<typeof stubActor>

  beforeEach(() => {
    actor = stubActor()
    props = new BaseActorProperties(stubContext(), actor)
  })

  it('get IsInWorld delegates to actor.isInWorld', () => {
    const actorInWorld = stubActor({ isInWorld: true })
    const pInWorld = new BaseActorProperties(stubContext(), actorInWorld)
    expect(pInWorld.IsInWorld).toBe(true)

    const actorNotInWorld = stubActor({ isInWorld: false })
    const pNotInWorld = new BaseActorProperties(stubContext(), actorNotInWorld)
    expect(pNotInWorld.IsInWorld).toBe(false)
  })

  it('get IsDead delegates to actor.isDead', () => {
    const actorDead = stubActor({ isDead: true })
    const pDead = new BaseActorProperties(stubContext(), actorDead)
    expect(pDead.IsDead).toBe(true)

    const actorAlive = stubActor({ isDead: false })
    const pAlive = new BaseActorProperties(stubContext(), actorAlive)
    expect(pAlive.IsDead).toBe(false)
  })

  it('get IsIdle delegates to actor.isIdle', () => {
    const actorIdle = stubActor({ isIdle: true })
    const pIdle = new BaseActorProperties(stubContext(), actorIdle)
    expect(pIdle.IsIdle).toBe(true)

    const actorBusy = stubActor({ isIdle: false })
    const pBusy = new BaseActorProperties(stubContext(), actorBusy)
    expect(pBusy.IsIdle).toBe(false)
  })

  it('get Owner returns actor.owner', () => {
    const owner = { playerName: 'Owner1' } as PlayerStub
    const a = stubActor({ owner })
    const p = new BaseActorProperties(stubContext(), a)
    expect(p.Owner).toBe(owner)
  })

  it('set Owner to nil throws', () => {
    expect(() => { props.Owner = null as unknown as PlayerStub }).toThrow()
  })

  it('set Owner calls changeOwner', () => {
    const changeOwner = vi.fn()
    const newOwner = { playerName: 'NewOwner' } as PlayerStub
    const a = stubActor({ owner: { playerName: 'OldOwner' } as PlayerStub })
    ;(a as any).changeOwner = changeOwner
    const p = new BaseActorProperties(stubContext(), a)
    p.Owner = newOwner
    expect(changeOwner).toHaveBeenCalledWith(newOwner)
  })

  it('get Type returns actor.info.name', () => {
    expect(props.Type).toBe('testActor')
  })

  it('HasProperty delegates to hasScriptProperty', () => {
    const hasScript = vi.fn().mockReturnValue(true)
    ;(actor as any).hasScriptProperty = hasScript
    expect(props.HasProperty('SomeProp')).toBe(true)
    expect(hasScript).toHaveBeenCalledWith('SomeProp')
  })

  it('Flash calls world.addEffect with FlashTarget', () => {
    const addEffect = vi.fn()
    ;(actor as any).world = { addEffect }
    props.Flash({ r: 255, g: 0, b: 0 })
    expect(addEffect).toHaveBeenCalledWith('FlashTarget', expect.objectContaining({
      target: actor, color: expect.any(Object), duration: 0.5, count: 2,
    }))
  })

  // ---- Descriptor completeness ----
  it('getOwnMemberDescriptors returns all expected members', () => {
    const descs = props.getOwnMemberDescriptors()
    const names = descs.map(d => d.name).sort()
    expect(names).toContain('IsInWorld')
    expect(names).toContain('IsDead')
    expect(names).toContain('IsIdle')
    expect(names).toContain('Owner')
    expect(names).toContain('Type')
    expect(names).toContain('HasProperty')
    expect(names).toContain('Flash')
    expect(names).toContain('EffectiveOwner')
  })
})

// ---------------------------------------------------------------------------
// GeneralProperties — method and property tests
// ---------------------------------------------------------------------------

describe('GeneralProperties', () => {
  let props: GeneralProperties
  let actor: ReturnType<typeof stubActor>
  let autotarget: any
  let scriptTags: any
  let tooltip: any

  beforeEach(() => {
    autotarget = { stance: { toString: () => 'HoldFire' }, setStance: vi.fn() }
    scriptTags = { addTag: vi.fn().mockReturnValue(true), removeTag: vi.fn().mockReturnValue(true), hasTag: vi.fn().mockReturnValue(false) }
    tooltip = { isDisabled: false, info: { name: 'Test Tooltip' } }

    actor = stubActor({
      trait: vi.fn((name: string) => {
        if (name === 'AutoTarget') return autotarget
        if (name === 'ScriptTags') return scriptTags
        return null
      }),
      traitsImplementing: vi.fn((name: string) => {
        if (name === 'Tooltip') return [tooltip]
        return []
      }),
      queueActivity: vi.fn(),
      cancelActivity: vi.fn(),
    })
    props = new GeneralProperties(stubContext(), actor)
  })

  it('Teleport queues SimpleTeleport activity', () => {
    props.Teleport({ x: 5, y: 3 })
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('SimpleTeleport')
  })

  it('Wait queues Wait activity with ticks', () => {
    props.Wait(25)
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('Wait')
    expect(arg.activityParams?.ticks).toBe(25)
  })

  it('Destroy queues RemoveSelf activity', () => {
    props.Destroy()
    expect(actor.queueActivity).toHaveBeenCalled()
    const arg = (actor.queueActivity as any).mock.calls[0][0]
    expect(arg.activityName).toBe('RemoveSelf')
  })

  it('Stop calls cancelActivity', () => {
    props.Stop()
    expect(actor.cancelActivity).toHaveBeenCalled()
  })

  it('get Stance returns autotarget stance string', () => {
    expect(props.Stance).toBe('HoldFire')
  })

  it('get TooltipName returns first enabled tooltip name', () => {
    expect(props.TooltipName).toBe('Test Tooltip')
  })

  it('get IsTaggable returns true when ScriptTags present', () => {
    expect(props.IsTaggable).toBe(true)
  })

  it('AddTag returns true on success', () => {
    expect(props.AddTag('mytag')).toBe(true)
    expect(scriptTags.addTag).toHaveBeenCalledWith('mytag')
  })

  it('RemoveTag returns true on success', () => {
    expect(props.RemoveTag('mytag')).toBe(true)
    expect(scriptTags.removeTag).toHaveBeenCalledWith('mytag')
  })

  it('HasTag delegates to scriptTags.hasTag', () => {
    scriptTags.hasTag.mockReturnValue(true)
    expect(props.HasTag('mytag')).toBe(true)
  })

  it('getOwnMemberDescriptors returns all expected members', () => {
    const descs = props.getOwnMemberDescriptors()
    const names = descs.map(d => d.name).sort()
    expect(names).toContain('Teleport')
    expect(names).toContain('CallFunc')
    expect(names).toContain('Wait')
    expect(names).toContain('Destroy')
    expect(names).toContain('Stop')
    expect(names).toContain('Stance')
    expect(names).toContain('TooltipName')
    expect(names).toContain('IsTaggable')
    expect(names).toContain('AddTag')
    expect(names).toContain('RemoveTag')
    expect(names).toContain('HasTag')
  })
})

// ---------------------------------------------------------------------------
// LocationProperties
// ---------------------------------------------------------------------------

describe('LocationProperties', () => {
  it('get Location delegates to actor location', () => {
    const actor = stubActor({ location: { x: 10, y: 20 } })
    const props = new LocationProperties(stubContext(), actor)
    expect(props.Location).toEqual({ x: 10, y: 20 })
  })

  it('getOwnMemberDescriptors returns Location and CenterPosition', () => {
    const actor = stubActor()
    const props = new LocationProperties(stubContext(), actor)
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Location')
    expect(names).toContain('CenterPosition')
  })
})

// ---------------------------------------------------------------------------
// FacingProperties
// ---------------------------------------------------------------------------

describe('FacingProperties', () => {
  it('get Facing returns IFacing.facing', () => {
    const facing = { facing: 128 }
    const actor = stubActor({
      trait: vi.fn().mockImplementation((name: string) => {
        if (name === 'IFacing') return facing
        return null
      }),
    })
    const props = new FacingProperties(stubContext(), actor)
    expect(props.Facing).toBe(128)
  })

  it('getOwnMemberDescriptors returns Facing', () => {
    const actor = stubActor({
      trait: vi.fn().mockImplementation((name: string) => {
        if (name === 'IFacing') return { facing: 0 }
        return null
      }),
    })
    const props = new FacingProperties(stubContext(), actor)
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Facing')
  })
})
