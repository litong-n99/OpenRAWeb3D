/**
 * Valued.test.ts — Valued migration unit tests
 *
 * Tests focus on: ValuedInfo defaults, Valued cost getter, attach/detach lifecycle,
 * Component inheritance, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Valued, ValuedInfo } from './Valued.js'
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Valued', () => {
  describe('ValuedInfo', () => {
    it('has default cost of 0', () => {
      const info = new ValuedInfo()
      expect(info.cost).toBe(0)
    })

    it('accepts custom cost', () => {
      const info = new ValuedInfo({ cost: 500 })
      expect(info.cost).toBe(500)
    })

    it('accepts instanceName', () => {
      const info = new ValuedInfo({ instanceName: 'myValued', cost: 100 })
      expect(info.instanceName).toBe('myValued')
      expect(info.cost).toBe(100)
    })

    it('implements ITraitInfo', () => {
      const info = new ValuedInfo()
      expect(info).toBeDefined()
      expect('instanceName' in info).toBe(true)
    })

    it('cost defaults to 0 when not provided', () => {
      const info = new ValuedInfo({ instanceName: 'test' })
      expect(info.cost).toBe(0)
    })
  })

  describe('Valued trait', () => {
    let info: ValuedInfo
    let trait: Valued

    beforeEach(() => {
      info = new ValuedInfo({ cost: 500 })
      trait = new Valued(info)
    })

    it('is created with info', () => {
      expect(trait.info).toBe(info)
      expect(trait.info.cost).toBe(500)
    })

    it('cost getter returns info.cost', () => {
      expect(trait.cost).toBe(500)
    })

    it('cost getter reflects info changes', () => {
      // Create new info since properties are readonly
      const newInfo = new ValuedInfo({ cost: 1000 })
      const newTrait = new Valued(newInfo)
      expect(newTrait.cost).toBe(1000)
    })

    it('is a Component (has attach/detach lifecycle)', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
      expect(trait.actor).toBeNull()
    })

    it('cost defaults to 0 when info has default', () => {
      const defaultInfo = new ValuedInfo()
      const defaultTrait = new Valued(defaultInfo)
      expect(defaultTrait.cost).toBe(0)
    })

    describe('Component lifecycle', () => {
      it('attach sets actor reference', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        expect(trait.actor).toBe(actor)
      })

      it('detach clears actor reference', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        trait.detach(actor)
        expect(trait.actor).toBeNull()
      })

      it('dispose marks component as disposed and clears actor', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        trait.dispose()
        expect(trait.disposed).toBe(true)
        expect(trait.actor).toBeNull()
      })

      it('detach does not clear actor if different actor passed', () => {
        const actor1 = makeMockActor({ actorId: 1 })
        const actor2 = makeMockActor({ actorId: 2 })
        trait.attach(actor1)
        trait.detach(actor2)
        expect(trait.actor).toBe(actor1)
      })
    })
  })
})
