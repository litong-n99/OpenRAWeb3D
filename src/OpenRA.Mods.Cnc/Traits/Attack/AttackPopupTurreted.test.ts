/**
 * AttackPopupTurreted.test.ts — unit tests for AttackPopupTurreted
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  AttackPopupTurreted,
  AttackPopupTurretedInfo,
  PopupState,
} from './AttackPopupTurreted.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeActor(traits?: unknown): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    traitsImplementing: () => traits ?? [],
  } as unknown as IGameActor
}

describe('AttackPopupTurreted', () => {
  describe('AttackPopupTurretedInfo', () => {
    it('has correct defaults', () => {
      const info = new AttackPopupTurretedInfo()
      expect(info.closeDelay).toBe(125)
      expect(info.closedDamageMultiplier).toBe(50)
      expect(info.openingSequence).toBe('opening')
      expect(info.closingSequence).toBe('closing')
      expect(info.closedIdleSequence).toBe('closed-idle')
      expect(info.body).toBe('body')
    })
  })

  describe('constructor', () => {
    it('creates instance in Open state', () => {
      const info = new AttackPopupTurretedInfo()
      const wsBody = {
        info: { name: 'body', sequence: 'idle' },
        playCustomAnimationRepeating() {},
        playCustomAnimation(_s: IGameActor, _seq: string, cb: () => void) { cb() },
      }
      const turretTrait = { faceTarget() {}, hasAchievedDesiredFacing: true }

      const self = makeActor([wsBody, turretTrait])
      const init = { self, contains: () => false }

      const trait = new AttackPopupTurreted(init, info)
      expect(trait.getState()).toBe(PopupState.Open)
    })

    it('starts in Closed state for map-placed actors', () => {
      const info = new AttackPopupTurretedInfo()
      const wsBody = {
        info: { name: 'body', sequence: 'idle' },
        playCustomAnimationRepeating() {},
        playCustomAnimation(_s: IGameActor, _seq: string, _cb: () => void) {},
      }
      const turretTrait = { faceTarget() {}, hasAchievedDesiredFacing: true }

      const self = makeActor([wsBody, turretTrait])
      const init = { self, contains: () => true }

      const trait = new AttackPopupTurreted(init, info)
      trait.onCreated(self)

      expect(trait.getState()).toBe(PopupState.Closed)
    })

    it('handles missing sprite body gracefully', () => {
      const info = new AttackPopupTurretedInfo()
      const self = makeActor([])
      const init = { self, contains: () => false }

      const trait = new AttackPopupTurreted(init, info)
      expect(trait).toBeDefined()
      expect(trait.getState()).toBe(PopupState.Open)
    })
  })

  describe('getDamageModifier', () => {
    it('returns 100 when Open', () => {
      const info = new AttackPopupTurretedInfo()
      const self = makeActor([])
      const trait = new AttackPopupTurreted({ self, contains: () => false }, info)
      expect(trait.getDamageModifier()).toBe(100)
    })

    it('returns closedDamageMultiplier when Closed', () => {
      const info = new AttackPopupTurretedInfo({ closedDamageMultiplier: 50 })
      const wsBody = {
        info: { name: 'body' },
        playCustomAnimationRepeating() {},
        playCustomAnimation() {},
      }
      const turretTrait = { faceTarget() {} }
      const self = makeActor([wsBody, turretTrait])
      const init = { self, contains: () => true }

      const trait = new AttackPopupTurreted(init, info)
      trait.onCreated(self)

      expect(trait.getState()).toBe(PopupState.Closed)
      expect(trait.getDamageModifier()).toBe(50)
    })
  })

  describe('tickIdle', () => {
    it('increments idle ticks when open', () => {
      const info = new AttackPopupTurretedInfo({ closeDelay: 10 })
      const wsBody = {
        info: { name: 'body' },
        playCustomAnimationRepeating() {},
        playCustomAnimation() {},
      }
      const turretTrait = { faceTarget() {}, hasAchievedDesiredFacing: true }
      const self = makeActor([wsBody, turretTrait])

      const trait = new AttackPopupTurreted({ self, contains: () => false }, info)
      expect(trait.getIdleTicks()).toBe(0)

      // Simulate idle ticks
      for (let i = 0; i < 5; i++) {
        trait.tickIdle(self)
      }
      expect(trait.getIdleTicks()).toBe(5)
    })

    it('transitions to Rotating after close delay exceeded', () => {
      const info = new AttackPopupTurretedInfo({ closeDelay: 3 })
      const wsBody = {
        info: { name: 'body' },
        playCustomAnimationRepeating() {},
        playCustomAnimation() {},
      }
      const turretTrait = { faceTarget() {}, hasAchievedDesiredFacing: true }
      const self = makeActor([wsBody, turretTrait])

      const trait = new AttackPopupTurreted({ self, contains: () => false }, info)

      // Tick idle enough times to exceed closeDelay
      for (let i = 0; i < 5; i++) {
        trait.tickIdle(self)
      }
      expect(trait.getState()).toBe(PopupState.Rotating)
    })
  })
})
