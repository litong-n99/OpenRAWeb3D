/**
 * HealthProperties.test.ts — Unit tests for HealthProperties
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { HealthProperties } from './HealthProperties.js'

function stubActor(traits: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, isIdle: false,
    owner: { playerName: 'TestPlayer' } as PlayerStub, disposed: false, traitName: 'test',
    world: {}, info: { name: 'testActor', traits: [] },
    trait: vi.fn((name: string) => traits[name] ?? null),
    traitsImplementing: vi.fn().mockReturnValue([]),
  } as unknown as IGameActor
}

function stubContext() { return { world: {}, worldRenderer: {}, fatalErrorOccurred: false, errorMessage: null } as any }

describe('HealthProperties', () => {
  let health: any
  let props: HealthProperties

  beforeEach(() => {
    health = {
      hp: 80, HP: 80,
      maxHp: 100, MaxHP: 100,
      inflictDamage: vi.fn(),
    }
    const actor = stubActor({ IHealth: health })
    props = new HealthProperties(stubContext(), actor)
  })

  it('has category General per C# source', () => {
    expect(HealthProperties.category).toBe('General')
  })

  it('requires IHealthInfo', () => {
    expect(HealthProperties.requiredTraits).toContain('IHealthInfo')
  })

  it('get Health returns current hp', () => {
    expect(props.Health).toBe(80)
  })

  it('set Health calls inflictDamage with correct damage', () => {
    props.Health = 50
    expect(health.inflictDamage).toHaveBeenCalledWith(expect.anything(), expect.anything(), { value: 30 }, true)
  })

  it('get MaxHealth returns maxHp', () => {
    expect(props.MaxHealth).toBe(100)
  })

  it('Kill with no damageTypes calls inflictDamage with max hp', () => {
    props.Kill()
    expect(health.inflictDamage).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { value: 100 }, true,
    )
  })

  it('Kill with string damageTypes includes damageType', () => {
    props.Kill('explosion')
    expect(health.inflictDamage).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { value: 100, damageTypes: ['explosion'] }, true,
    )
  })

  it('Kill with array damageTypes includes damageTypes', () => {
    props.Kill(['explosion', 'fire'])
    expect(health.inflictDamage).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { value: 100, damageTypes: ['explosion', 'fire'] }, true,
    )
  })

  it('getOwnMemberDescriptors returns Health, MaxHealth, Kill', () => {
    const names = props.getOwnMemberDescriptors().map(d => d.name)
    expect(names).toContain('Health')
    expect(names).toContain('MaxHealth')
    expect(names).toContain('Kill')
  })

  it('is registered in ScriptRegistry', () => {
    const reg = ScriptRegistry.getActorProperties().find(p => p.ctor === HealthProperties)
    expect(reg).toBeDefined()
  })

  it('returns 0 Health when no IHealth trait', () => {
    const actor = stubActor({})
    const p = new HealthProperties(stubContext(), actor)
    expect(p.Health).toBe(0)
    expect(p.MaxHealth).toBe(0)
  })
})
