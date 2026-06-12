/**
 * SupportPowerDecision.test.ts — unit tests for SupportPowerDecision and Consideration
 */

import { describe, it, expect } from 'vitest'
import {
  SupportPowerDecision,
  Consideration,
  DecisionMetric,
  type SupportPowerDecisionConfig,
  type ConsiderationConfig,
} from './SupportPowerDecision.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createConsideration(overrides: Partial<ConsiderationConfig> = {}): Consideration {
  return new Consideration({
    against: 'Enemy',
    types: new Set(['Ground', 'Water']),
    attractiveness: 100,
    targetMetric: DecisionMetric.None,
    checkRadius: 5 * 1024,
    ...overrides,
  })
}

function createDecision(overrides: Partial<SupportPowerDecisionConfig> = {}): SupportPowerDecision {
  return new SupportPowerDecision({
    minimumAttractiveness: 1,
    orderName: 'AirstrikePowerInfoOrder',
    coarseScanRadius: 20,
    fineScanRadius: 2,
    considerations: [createConsideration()],
    minimumScanTimeInterval: 250,
    maximumScanTimeInterval: 262,
    ...overrides,
  })
}

function makeActor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner: { playerName: 'Enemy' },
    isTargetableBy: () => true,
    canBeViewedByPlayer: () => true,
    getEnabledTargetTypes: () => ({ isEmpty: false, overlaps: (_o: unknown) => true }),
    traitInfo: () => undefined,
    ...overrides,
  }
}

function makePlayer(): Record<string, unknown> {
  return {
    playerActor: { actorId: 1 },
    relationshipWith: (_other: unknown) => 'Enemy',
  }
}

// ---------------------------------------------------------------------------
// Consideration tests
// ---------------------------------------------------------------------------

describe('Consideration', () => {
  describe('constructor', () => {
    it('stores all config fields correctly', () => {
      const c = new Consideration({
        against: 'Enemy',
        types: new Set(['Air', 'Ground']),
        attractiveness: 75,
        targetMetric: DecisionMetric.Health,
        checkRadius: 10 * 1024,
      })

      expect(c.against).toBe('Enemy')
      expect(c.types.has('Air')).toBe(true)
      expect(c.types.has('Ground')).toBe(true)
      expect(c.attractiveness).toBe(75)
      expect(c.targetMetric).toBe(DecisionMetric.Health)
      expect(c.checkRadius).toBe(10 * 1024)
    })
  })

  describe('getAttractiveness', () => {
    it('returns 0 when stance does not match against', () => {
      const c = createConsideration({ against: 'Enemy' })
      const a = makeActor({ owner: { playerName: 'Ally' } })
      const p = { ...makePlayer(), relationshipWith: () => 'Ally' }
      expect(c.getAttractiveness(a as any, 'Ally', p as any)).toBe(0)
    })

    it('returns 0 when actor is null', () => {
      const c = createConsideration()
      const p = makePlayer() as any
      expect(c.getAttractiveness(null, 'Enemy', p)).toBe(0)
    })

    it('returns 0 when actor is not targetable', () => {
      const c = createConsideration()
      const a = makeActor({ isTargetableBy: () => false })
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(0)
    })

    it('returns 0 when actor is not viewable', () => {
      const c = createConsideration()
      const a = makeActor({ canBeViewedByPlayer: () => false })
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(0)
    })

    it('returns 0 when target types do not overlap', () => {
      const c = createConsideration({ types: new Set(['Air']) })
      const a = makeActor({
        getEnabledTargetTypes: () => ({ isEmpty: false, overlaps: () => false }),
      })
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(0)
    })

    it('returns attractiveness for DecisionMetric.None', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.None, attractiveness: 100 })
      const a = makeActor()
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(100)
    })

    it('returns value-based attractiveness for DecisionMetric.Value', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.Value, attractiveness: 2 })
      const a = makeActor({
        traitInfo: (name: string) => name === 'Valued' ? { cost: 50 } : undefined,
      })
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(100) // 50 * 2
    })

    it('returns health-weighted attractiveness for DecisionMetric.Health', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.Health, attractiveness: 100 })
      const a = makeActor({
        health: { hp: 50, maxHP: 100 },
      })
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(50) // 50 * 100 / 100
    })

    it('returns 0 for DecisionMetric.Health when no health trait', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.Health, attractiveness: 100 })
      const a = makeActor({ health: undefined })
      const p = makePlayer() as any
      expect(c.getAttractiveness(a as any, 'Enemy', p)).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// SupportPowerDecision tests
// ---------------------------------------------------------------------------

describe('SupportPowerDecision', () => {
  describe('constructor', () => {
    it('stores configuration fields', () => {
      const considerations = [createConsideration()]
      const d = new SupportPowerDecision({
        minimumAttractiveness: 10,
        orderName: 'NukePowerInfoOrder',
        coarseScanRadius: 30,
        fineScanRadius: 3,
        considerations,
        minimumScanTimeInterval: 300,
        maximumScanTimeInterval: 400,
      })

      expect(d.minimumAttractiveness).toBe(10)
      expect(d.orderName).toBe('NukePowerInfoOrder')
      expect(d.coarseScanRadius).toBe(30)
      expect(d.fineScanRadius).toBe(3)
      expect(d.considerations).toBe(considerations)
      expect(d.minimumScanTimeInterval).toBe(300)
      expect(d.maximumScanTimeInterval).toBe(400)
    })
  })

  describe('getAttractivenessForActors', () => {
    it('scores a list of actors through all considerations', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.None, attractiveness: 10 })
      const d = createDecision({ considerations: [c] })
      const a = makeActor()
      const p = makePlayer() as any
      const result = d.getAttractivenessForActors(
        [a as any, a as any],
        p,
      )
      expect(result).toBe(20) // 2 actors * 10
    })

    it('returns 0 for empty list', () => {
      const c = createConsideration()
      const d = createDecision({ considerations: [c] })
      const p = makePlayer() as any
      expect(d.getAttractivenessForActors([], p)).toBe(0)
    })
  })

  describe('getAttractivenessForFrozen', () => {
    it('scores frozen actors through all considerations', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.None, attractiveness: 5 })
      const d = createDecision({ considerations: [c] })
      const p = makePlayer() as any
      const fa = {
        isValid: true,
        visible: true,
        owner: { playerName: 'Enemy' },
        hp: 100,
        targetTypes: { isEmpty: false, overlaps: () => true },
        traitInfo: () => undefined,
      }
      // getAttractiveness returns 0 because fa is a frozen actor and relationshipWith returns 'Enemy' which matches
      const result = d.getAttractivenessForFrozen(
        [fa as any],
        p,
      )
      expect(result).toBe(5)
    })

    it('skips invalid frozen actors', () => {
      const c = createConsideration({ targetMetric: DecisionMetric.None, attractiveness: 5 })
      const d = createDecision({ considerations: [c] })
      const p = makePlayer() as any
      const fa = { isValid: false, visible: true, owner: {}, hp: 100, targetTypes: { isEmpty: false, overlaps: () => true }, traitInfo: () => undefined }
      expect(d.getAttractivenessForFrozen([fa as any], p)).toBe(0)
    })
  })

  describe('getNextScanTime', () => {
    it('returns value within scan interval range', () => {
      const d = createDecision({
        minimumScanTimeInterval: 250,
        maximumScanTimeInterval: 262,
      })
      const prng = { nextIntRange: (min: number, _max: number) => min }
      const result = d.getNextScanTime(prng)
      expect(result).toBeGreaterThanOrEqual(250)
      expect(result).toBeLessThanOrEqual(262)
    })
  })
})
