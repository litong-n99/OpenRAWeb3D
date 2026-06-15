/**
 * CrateAction.test.ts — CrateAction base class unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CrateAction, type CrateActionInfo } from './CrateAction.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<CrateActionInfo> = {}): CrateActionInfo {
  return {
    selectionShares: overrides.selectionShares ?? 10,
    image: overrides.image,
    sequence: overrides.sequence,
    palette: overrides.palette,
    sound: overrides.sound,
    notification: overrides.notification,
    textNotification: overrides.textNotification,
    timeDelay: overrides.timeDelay ?? 0,
    prerequisites: overrides.prerequisites,
    excludedActorTypes: overrides.excludedActorTypes,
  }
}

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name: 'testActor' },
    ...overrides,
  }
}

// Concrete subclass for testing abstract CrateAction
class TestCrateAction extends CrateAction {
  activated: boolean = false
  lastCollector: IGameActor | null = null

  override activate(collector: IGameActor): void {
    this.activated = true
    this.lastCollector = collector
    super.activate(collector)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrateAction', () => {
  let actor: IGameActor

  beforeEach(() => {
    actor = makeActor()
  })

  describe('construction', () => {
    it('stores self reference', () => {
      const info = makeInfo()
      const ca = new TestCrateAction(actor, info)
      expect(ca.self).toBe(actor)
    })

    it('stores info reference', () => {
      const info = makeInfo({ selectionShares: 15 })
      const ca = new TestCrateAction(actor, info)
      expect(ca.info.selectionShares).toBe(15)
    })
  })

  describe('getSelectionShares', () => {
    it('returns info.selectionShares by default', () => {
      const info = makeInfo({ selectionShares: 20 })
      const ca = new TestCrateAction(actor, info)
      expect(ca.getSelectionShares(actor)).toBe(20)
    })
  })

  describe('getSelectionSharesOuter', () => {
    it('returns 0 when trait is disabled', () => {
      const info = makeInfo({ selectionShares: 10 })
      const ca = new TestCrateAction(actor, info)
      ;(ca as unknown as { _enabled: boolean })._enabled = false
      expect(ca.getSelectionSharesOuter(actor)).toBe(0)
    })

    it('returns 0 when collector is in excludedActorTypes', () => {
      const info = makeInfo({
        selectionShares: 10,
        excludedActorTypes: ['testActor'],
      })
      const ca = new TestCrateAction(actor, info)
      expect(ca.getSelectionSharesOuter(actor)).toBe(0)
    })

    it('returns selection shares when collector is not excluded', () => {
      const info = makeInfo({
        selectionShares: 10,
        excludedActorTypes: ['otherActor'],
      })
      const ca = new TestCrateAction(actor, info)
      expect(ca.getSelectionSharesOuter(actor)).toBe(10)
    })

    it('returns selection shares when no excluded types', () => {
      const info = makeInfo({ selectionShares: 5 })
      const ca = new TestCrateAction(actor, info)
      expect(ca.getSelectionSharesOuter(actor)).toBe(5)
    })
  })

  describe('activate', () => {
    it('calls subclass activate and base effects', () => {
      const info = makeInfo()
      const ca = new TestCrateAction(actor, info)
      const collector = makeActor({ actorId: 2 })
      ca.activate(collector)
      expect(ca.activated).toBe(true)
      expect(ca.lastCollector).toBe(collector)
    })
  })

  describe('checkPrerequisites', () => {
    it('returns true (stubbed, accessed via subclass)', () => {
      const info = makeInfo()
      const ca = new TestCrateAction(actor, info)
      // Access protected method via subclass
      const result = (ca as any).checkPrerequisites({} as never, ['someTech'])
      expect(result).toBe(true)
    })
  })
})
