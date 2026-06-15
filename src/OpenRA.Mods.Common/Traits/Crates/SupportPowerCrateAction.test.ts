/**
 * SupportPowerCrateAction.test.ts — SupportPowerCrateAction unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupportPowerCrateAction, type SupportPowerCrateActionInfo } from './SupportPowerCrateAction.js'
import type { CrateActionInfo } from './CrateAction.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(
  overrides: Partial<SupportPowerCrateActionInfo & CrateActionInfo> = {},
): SupportPowerCrateActionInfo {
  return {
    selectionShares: overrides.selectionShares ?? 10,
    proxy: overrides.proxy ?? 'power.proxy',
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
    owner: { playerName: 'testOwner' },
    world: { actors: [] } as any,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupportPowerCrateAction', () => {
  let actor: IGameActor

  beforeEach(() => {
    actor = makeActor()
  })

  describe('construction', () => {
    it('stores info with proxy', () => {
      const info = makeInfo({ proxy: 'power.nuke' })
      const action = new SupportPowerCrateAction(actor, info)
      expect(action.typedInfo.proxy).toBe('power.nuke')
    })

    it('stores self reference', () => {
      const info = makeInfo()
      const action = new SupportPowerCrateAction(actor, info)
      expect(action.self).toBe(actor)
    })
  })

  describe('activate', () => {
    it('creates proxy actor when collector has world and owner', () => {
      const info = makeInfo({ proxy: 'power.superweapon' })
      const action = new SupportPowerCrateAction(actor, info)
      const collector = makeActor({
        actorId: 2,
        owner: { playerName: 'newOwner' },
        world: { actors: [] } as any,
      })

      // Spy on createProxyActor
      const spy = vi.spyOn(action as any, 'createProxyActor')
      action.activate(collector)
      expect(spy).toHaveBeenCalledWith(collector, 'power.superweapon', collector.owner)
    })

    it('does not create proxy when collector has no world', () => {
      const info = makeInfo({ proxy: 'power.superweapon' })
      const action = new SupportPowerCrateAction(actor, info)
      const collector = makeActor({
        actorId: 2,
        owner: { playerName: 'newOwner' },
        world: undefined,
      })

      const spy = vi.spyOn(action as any, 'createProxyActor')
      action.activate(collector)
      expect(spy).not.toHaveBeenCalled()
    })

    it('does not create proxy when collector has no owner', () => {
      const info = makeInfo({ proxy: 'power.superweapon' })
      const action = new SupportPowerCrateAction(actor, info)
      const collector = makeActor({
        actorId: 2,
        owner: undefined,
        world: { actors: [] } as any,
      })

      const spy = vi.spyOn(action as any, 'createProxyActor')
      action.activate(collector)
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('integration with CrateAction', () => {
    it('getSelectionShares returns info.selectionShares', () => {
      const info = makeInfo({ selectionShares: 15 })
      const action = new SupportPowerCrateAction(actor, info)
      expect(action.getSelectionShares(actor)).toBe(15)
    })

    it('getSelectionSharesOuter returns 0 when disabled', () => {
      const info = makeInfo({ selectionShares: 15 })
      const action = new SupportPowerCrateAction(actor, info)
      ;(action as unknown as { _enabled: boolean })._enabled = false
      expect(action.getSelectionSharesOuter(actor)).toBe(0)
    })
  })
})
