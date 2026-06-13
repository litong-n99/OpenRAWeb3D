/**
 * TerrainModifiesDamage.test.ts -- TerrainModifiesDamage migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * Tests focus on: config defaults, terrain type lookup, damage modifier calculation,
 * healing behavior, and fallback to FULL_DAMAGE.
 */

import { describe, it, expect } from 'vitest'
import { Damage } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  TerrainModifiesDamage,
  TerrainModifiesDamageInfo,
} from './TerrainModifiesDamage.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTerrainInfo(type: string) {
  return { type }
}

function makeMap(terrainType: string) {
  return {
    cellContaining: (_pos: unknown) => ({ x: 0, y: 0 }),
    getTerrainInfo: (_cell: unknown) => makeTerrainInfo(terrainType),
  }
}

function makeWorld(terrainType: string) {
  return {
    map: makeMap(terrainType),
  }
}

function makeActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerrainModifiesDamageInfo', () => {
  it('has empty terrainModifier by default', () => {
    const info = new TerrainModifiesDamageInfo()
    expect(info.terrainModifier.size).toBe(0)
  })

  it('has default modifyHealing as false', () => {
    const info = new TerrainModifiesDamageInfo()
    expect(info.modifyHealing).toBe(false)
  })

  it('accepts Map terrainModifier', () => {
    const modifier = new Map([['Clear', 120], ['Rough', 80]])
    const info = new TerrainModifiesDamageInfo({ terrainModifier: modifier })
    expect(info.terrainModifier.get('Clear')).toBe(120)
    expect(info.terrainModifier.get('Rough')).toBe(80)
  })

  it('accepts Record terrainModifier', () => {
    const info = new TerrainModifiesDamageInfo({
      terrainModifier: { Clear: 120, Rough: 80 },
    })
    expect(info.terrainModifier.get('Clear')).toBe(120)
    expect(info.terrainModifier.get('Rough')).toBe(80)
  })

  it('accepts custom modifyHealing', () => {
    const info = new TerrainModifiesDamageInfo({ modifyHealing: true })
    expect(info.modifyHealing).toBe(true)
  })
})

describe('TerrainModifiesDamage', () => {
  it('FULL_DAMAGE constant is 100', () => {
    expect(TerrainModifiesDamage.FULL_DAMAGE).toBe(100)
  })

  describe('getDamageModifier', () => {
    it('returns configured damage for matching terrain type', () => {
      const info = new TerrainModifiesDamageInfo({
        terrainModifier: { Clear: 120 },
      })
      const actor = makeActor({
        world: makeWorld('Clear'),
        centerPosition: { x: 512, y: 512 },
      })
      const trait = new TerrainModifiesDamage(actor as any, info)
      const damage = new Damage(50)
      const attacker = makeActor({ actorId: 9 })

      const result = trait.getDamageModifier(attacker as any, damage)
      expect(result).toBe(120)
      trait.dispose()
    })

    it('returns FULL_DAMAGE for unmatched terrain type', () => {
      const info = new TerrainModifiesDamageInfo({
        terrainModifier: { Clear: 120 },
      })
      const actor = makeActor({
        world: makeWorld('Road'),
        centerPosition: { x: 512, y: 512 },
      })
      const trait = new TerrainModifiesDamage(actor as any, info)
      const damage = new Damage(50)
      const attacker = makeActor({ actorId: 9 })

      const result = trait.getDamageModifier(attacker as any, damage)
      expect(result).toBe(TerrainModifiesDamage.FULL_DAMAGE)
      trait.dispose()
    })

    it('returns FULL_DAMAGE when no world/map available', () => {
      const info = new TerrainModifiesDamageInfo({
        terrainModifier: { Clear: 120 },
      })
      const actor = makeActor({
        centerPosition: { x: 512, y: 512 },
      })
      const trait = new TerrainModifiesDamage(actor as any, info)
      const damage = new Damage(50)
      const attacker = makeActor({ actorId: 9 })

      const result = trait.getDamageModifier(attacker as any, damage)
      expect(result).toBe(TerrainModifiesDamage.FULL_DAMAGE)
      trait.dispose()
    })

    it('returns FULL_DAMAGE when no centerPosition', () => {
      const info = new TerrainModifiesDamageInfo({
        terrainModifier: { Clear: 120 },
      })
      const actor = makeActor({
        world: makeWorld('Clear'),
      })
      const trait = new TerrainModifiesDamage(actor as any, info)
      const damage = new Damage(50)
      const attacker = makeActor({ actorId: 9 })

      const result = trait.getDamageModifier(attacker as any, damage)
      expect(result).toBe(TerrainModifiesDamage.FULL_DAMAGE)
      trait.dispose()
    })

    describe('healing behavior', () => {
      it('returns FULL_DAMAGE for friendly healing when modifyHealing is false', () => {
        const info = new TerrainModifiesDamageInfo({
          terrainModifier: { Clear: 120 },
          modifyHealing: false,
        })
        const actor = makeActor({
          world: makeWorld('Clear'),
          centerPosition: { x: 512, y: 512 },
          owner: { isAlliedWith: () => true },
        })
        const attacker = makeActor({ actorId: 9, owner: {} })
        const trait = new TerrainModifiesDamage(actor as any, info)
        const damage = new Damage(-50) // Negative = healing

        const result = trait.getDamageModifier(attacker as any, damage)
        expect(result).toBe(TerrainModifiesDamage.FULL_DAMAGE)
        trait.dispose()
      })

      it('applies terrain modifier for friendly healing when modifyHealing is true', () => {
        const info = new TerrainModifiesDamageInfo({
          terrainModifier: { Clear: 80 },
          modifyHealing: true,
        })
        const actor = makeActor({
          world: makeWorld('Clear'),
          centerPosition: { x: 512, y: 512 },
          owner: { isAlliedWith: () => true },
        })
        const attacker = makeActor({ actorId: 9, owner: {} })
        const trait = new TerrainModifiesDamage(actor as any, info)
        const damage = new Damage(-50)

        const result = trait.getDamageModifier(attacker as any, damage)
        expect(result).toBe(80)
        trait.dispose()
      })

      it('applies terrain modifier for enemy damage (not healing check)', () => {
        const info = new TerrainModifiesDamageInfo({
          terrainModifier: { Clear: 120 },
          modifyHealing: false,
        })
        const actor = makeActor({
          world: makeWorld('Clear'),
          centerPosition: { x: 512, y: 512 },
          owner: { isAlliedWith: () => false },
        })
        const attacker = makeActor({ actorId: 9, owner: {} })
        const trait = new TerrainModifiesDamage(actor as any, info)
        const damage = new Damage(50) // Positive = damage

        const result = trait.getDamageModifier(attacker as any, damage)
        expect(result).toBe(120)
        trait.dispose()
      })
    })

    it('dispose is a no-op', () => {
      const info = new TerrainModifiesDamageInfo()
      const actor = makeActor()
      const trait = new TerrainModifiesDamage(actor as any, info)
      expect(() => trait.dispose()).not.toThrow()
    })

    it('stores info reference', () => {
      const info = new TerrainModifiesDamageInfo({ terrainModifier: { Clear: 150 } })
      const actor = makeActor()
      const trait = new TerrainModifiesDamage(actor as any, info)
      expect(trait.info).toBe(info)
      trait.dispose()
    })
  })
})
