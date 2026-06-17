/**
 * ClonesProducedUnits.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import {
  ClonesProducedUnits,
  ClonesProducedUnitsInfo,
} from './ClonesProducedUnits.js'

describe('ClonesProducedUnits', () => {
  it('should create with given production type', () => {
    const info = new ClonesProducedUnitsInfo({
      cloneableTypes: new Set(['Infantry']),
      productionType: 'Infantry',
    })
    expect(info.productionType).toBe('Infantry')
    expect(info.cloneableTypes.has('Infantry')).toBe(true)
  })

  it('should not clone when trait is disabled', () => {
    const info = new ClonesProducedUnitsInfo({ cloneableTypes: new Set(['Infantry']) })
    const trait = new ClonesProducedUnits({} as any, info)
    ;(trait as any)._isDisabled = true
    const produce = vi.fn()
    const producer = {
      owner: { id: 1 },
      info: { hasTraitInfo: () => false },
      traitsImplementing: () => [{ info: {}, produce }],
    } as any
    const self = { owner: { id: 1 }, traitsImplementing: () => [{ info: {}, produce }] } as any
    const produced = { info: { getTraitInfo: () => ({ types: new Set(['Infantry']) }) } } as any
    // Should return early due to disabled
    trait.unitProducedByOther(self, producer, produced, 'Infantry', new Map())
    expect(produce).not.toHaveBeenCalled()
  })

  it('should not clone when producer is self (recursive check)', () => {
    const info = new ClonesProducedUnitsInfo({ cloneableTypes: new Set(['Infantry']) })
    const trait = new ClonesProducedUnits({} as any, info)
    const produce = vi.fn()
    const producer = {
      owner: { id: 1 },
      info: { hasTraitInfo: () => true }, // Has ClonesProducedUnits itself
      traitsImplementing: () => [],
    } as any
    const self = { owner: { id: 1 }, traitsImplementing: () => [{ info: {}, produce }] } as any
    const produced = { info: { getTraitInfo: () => ({ types: new Set(['Infantry']) }) } } as any
    trait.unitProducedByOther(self, producer, produced, 'Infantry', new Map())
    expect(produce).not.toHaveBeenCalled()
  })

  it('should not clone when produced unit has no Cloneable trait', () => {
    const info = new ClonesProducedUnitsInfo({ cloneableTypes: new Set(['Infantry']) })
    const trait = new ClonesProducedUnits({} as any, info)
    const produce = vi.fn()
    const producer = {
      owner: { id: 1 },
      info: { hasTraitInfo: () => false },
    } as any
    const self = { owner: { id: 1 }, traitsImplementing: () => [{ info: {}, produce }] } as any
    const produced = { info: { getTraitInfo: () => null } } as any
    trait.unitProducedByOther(self, producer, produced, 'Infantry', new Map())
    expect(produce).not.toHaveBeenCalled()
  })

  it('should not clone when cloneable types do not overlap', () => {
    const info = new ClonesProducedUnitsInfo({ cloneableTypes: new Set(['Vehicle']) })
    const trait = new ClonesProducedUnits({} as any, info)
    const produce = vi.fn()
    const producer = {
      owner: { id: 1 },
      info: { hasTraitInfo: () => false },
    } as any
    const self = { owner: { id: 1 }, traitsImplementing: () => [{ info: {}, produce }] } as any
    const produced = {
      info: { getTraitInfo: () => ({ types: new Set(['Infantry']) }) },
    } as any
    trait.unitProducedByOther(self, producer, produced, 'Infantry', new Map())
    expect(produce).not.toHaveBeenCalled()
  })
})
