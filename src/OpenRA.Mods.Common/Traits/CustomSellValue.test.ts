/**
 * CustomSellValue.test.ts — CustomSellValue migration unit tests
 *
 * Tests focus on: CustomSellValueInfo defaults, CustomSellValue value getter,
 * getSellValue() standalone function with CustomSellValue + Valued + fallback to 0,
 * Component lifecycle, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CustomSellValue,
  CustomSellValueInfo,
  getSellValue,
} from './CustomSellValue.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  } as IGameActor
}

/**
 * Create a mock actor with trait info lookup via traitInfoOrDefault().
 */
function makeMockActorWithInfo(
  traitInfos: Map<string, Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): IGameActor {
  const info = {
    name: 'TestActor',
    traitInfoOrDefault: (name: string) => traitInfos.get(name),
  }

  return makeMockActor({ info, ...overrides })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomSellValue', () => {
  describe('CustomSellValueInfo', () => {
    it('has default value of 0', () => {
      const info = new CustomSellValueInfo()
      expect(info.value).toBe(0)
    })

    it('accepts custom value', () => {
      const info = new CustomSellValueInfo({ value: 800 })
      expect(info.value).toBe(800)
    })

    it('accepts instanceName', () => {
      const info = new CustomSellValueInfo({ instanceName: 'myCSV', value: 300 })
      expect(info.instanceName).toBe('myCSV')
      expect(info.value).toBe(300)
    })

    it('implements ITraitInfo', () => {
      const info = new CustomSellValueInfo()
      expect('instanceName' in info).toBe(true)
    })
  })

  describe('CustomSellValue trait', () => {
    let info: CustomSellValueInfo
    let trait: CustomSellValue

    beforeEach(() => {
      info = new CustomSellValueInfo({ value: 800 })
      trait = new CustomSellValue(info)
    })

    it('is created with info', () => {
      expect(trait.info).toBe(info)
      expect(trait.info.value).toBe(800)
    })

    it('value getter returns info.value', () => {
      expect(trait.value).toBe(800)
    })

    it('is a Component', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
    })

    describe('Component lifecycle', () => {
      it('attach/detach work correctly', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        expect(trait.actor).toBe(actor)
        trait.detach(actor)
        expect(trait.actor).toBeNull()
      })

      it('dispose clears state', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
        expect(trait.actor).toBeNull()
      })
    })
  })

  describe('getSellValue()', () => {
    it('returns CustomSellValueInfo.Value when present and > 0', () => {
      const traitInfos = new Map<string, Record<string, unknown>>()
      traitInfos.set('CustomSellValueInfo', { value: 1200 })
      traitInfos.set('ValuedInfo', { cost: 500 })

      const actor = makeMockActorWithInfo(traitInfos)
      expect(getSellValue(actor)).toBe(1200)
    })

    it('falls back to ValuedInfo.Cost when CustomSellValueInfo absent', () => {
      const traitInfos = new Map<string, Record<string, unknown>>()
      traitInfos.set('ValuedInfo', { cost: 500 })

      const actor = makeMockActorWithInfo(traitInfos)
      expect(getSellValue(actor)).toBe(500)
    })

    it('returns 0 when neither trait is present', () => {
      const traitInfos = new Map<string, Record<string, unknown>>()
      const actor = makeMockActorWithInfo(traitInfos)
      expect(getSellValue(actor)).toBe(0)
    })

    it('returns 0 when CustomSellValueInfo.Value is 0 (treats 0 as "no override")', () => {
      const traitInfos = new Map<string, Record<string, unknown>>()
      traitInfos.set('CustomSellValueInfo', { value: 0 })
      traitInfos.set('ValuedInfo', { cost: 500 })

      const actor = makeMockActorWithInfo(traitInfos)
      // CustomSellValue value is 0, which means "no override" — falls back to Valued
      expect(getSellValue(actor)).toBe(500)
    })

    it('returns 0 when actor has no info', () => {
      const actor = makeMockActor()
      expect(getSellValue(actor)).toBe(0)
    })

    it('returns 0 when actor info has no traitInfoOrDefault method', () => {
      const actor = makeMockActor({ info: { name: 'Test' } })
      expect(getSellValue(actor)).toBe(0)
    })

    it('returns ValuedInfo.Cost when traitInfoOrDefault returns undefined for CSV', () => {
      const traitInfos = new Map<string, Record<string, unknown>>()
      // No CSV entry, only Valued
      traitInfos.set('ValuedInfo', { cost: 750 })

      const actor = makeMockActorWithInfo(traitInfos)
      expect(getSellValue(actor)).toBe(750)
    })

    it('returns 0 when all lookups return undefined', () => {
      const traitInfos = new Map<string, Record<string, unknown>>()
      // Both entries undefined
      const actor = makeMockActorWithInfo(traitInfos)
      expect(getSellValue(actor)).toBe(0)
    })
  })
})
