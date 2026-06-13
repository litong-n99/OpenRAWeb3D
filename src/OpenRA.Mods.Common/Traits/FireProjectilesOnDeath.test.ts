/**
 * FireProjectilesOnDeath.test.ts — FireProjectilesOnDeath migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  FireProjectilesOnDeath,
  FireProjectilesOnDeathInfo,
} from './FireProjectilesOnDeath.js'
import { AttackInfo, Damage } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WDist } from '../../OpenRA.Game/WDist.js'

function makeMockActor(worldOverrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: { X: 100, Y: 200, Z: 0 },
    world: {
      actors: [],
      sharedRandom: { next: (_max: number) => Math.floor((_max ?? 10) / 2) },
      ...worldOverrides,
    },
  }
}

function makeAttackInfo(overrides: Partial<{
  damageValue: number
  damageTypes: { isEmpty: () => boolean; contains: (v: number) => boolean }
}> = {}) {
  return new AttackInfo(
    new Damage(overrides.damageValue ?? 100),
    { actorId: 2, isInWorld: true, isDead: false, disposed: false } as never,
    4,
    2,
  )
}

describe('FireProjectilesOnDeathInfo', () => {
  it('defaults pieces to [3, 10]', () => {
    const info = new FireProjectilesOnDeathInfo()
    expect(info.pieces).toEqual([3, 10])
  })

  it('defaults range to 2-5 cells', () => {
    const info = new FireProjectilesOnDeathInfo()
    expect(info.range[0].length).toBe(WDist.fromCells(2).length)
    expect(info.range[1].length).toBe(WDist.fromCells(5).length)
  })

  it('defaults weapons to empty', () => {
    const info = new FireProjectilesOnDeathInfo()
    expect(info.weapons).toEqual([])
  })
})

describe('FireProjectilesOnDeath', () => {
  it('does not fire when trait disabled', () => {
    const info = new FireProjectilesOnDeathInfo({ weapons: ['test'] })
    const trait = new FireProjectilesOnDeath(info)
    trait.weaponInfos = [{ projectileType: 'bullet', impact: vi.fn() }]
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const self = makeMockActor()
    // Should not throw
    expect(() => trait.killed(self, makeAttackInfo())).not.toThrow()
  })

  it('skips when damage value below minimum', () => {
    const info = new FireProjectilesOnDeathInfo({
      weapons: ['test'],
      minimumDamage: 200,
    })
    const trait = new FireProjectilesOnDeath(info)
    const addFrameEndTask = vi.fn()
    const self = makeMockActor({ addFrameEndTask })

    trait.killed(self, makeAttackInfo({ damageValue: 100 }))
    expect(addFrameEndTask).not.toHaveBeenCalled()
  })

  it('skips when damage value above maximum', () => {
    const info = new FireProjectilesOnDeathInfo({
      weapons: ['test'],
      maximumDamage: 50,
    })
    const trait = new FireProjectilesOnDeath(info)
    const addFrameEndTask = vi.fn()
    const self = makeMockActor({ addFrameEndTask })

    trait.killed(self, makeAttackInfo({ damageValue: 100 }))
    expect(addFrameEndTask).not.toHaveBeenCalled()
  })

  it('skips when deathTypes filter does not match', () => {
    const dtEmpty = vi.fn(() => false)
    const dtContains = vi.fn(() => false)
    const info = new FireProjectilesOnDeathInfo({
      weapons: ['test'],
      deathTypes: { isEmpty: dtEmpty, contains: dtContains },
    })
    const trait = new FireProjectilesOnDeath(info)
    const addFrameEndTask = vi.fn()
    const self = makeMockActor({ addFrameEndTask })

    trait.killed(self, makeAttackInfo())
    expect(addFrameEndTask).not.toHaveBeenCalled()
  })

  it('adds a frame end task for valid damage', () => {
    const info = new FireProjectilesOnDeathInfo({
      weapons: ['test'],
      pieces: [2, 2], // Fixed 2 pieces
    })
    const trait = new FireProjectilesOnDeath(info)
    trait.weaponInfos = [{ projectileType: 'bullet' }]
    const addFrameEndTask = vi.fn()
    const self = makeMockActor({ addFrameEndTask })

    trait.killed(self, makeAttackInfo({ damageValue: 100 }))
    expect(addFrameEndTask).toHaveBeenCalledTimes(2)
  })

  it('does nothing for weapon without projectileType', () => {
    const info = new FireProjectilesOnDeathInfo({
      weapons: ['test'],
      pieces: [1, 1],
    })
    const trait = new FireProjectilesOnDeath(info)
    trait.weaponInfos = [{ projectileType: null }]
    const addFrameEndTask = vi.fn()
    const self = makeMockActor({ addFrameEndTask })

    trait.killed(self, makeAttackInfo({ damageValue: 100 }))
    expect(addFrameEndTask).not.toHaveBeenCalled()
  })
})
