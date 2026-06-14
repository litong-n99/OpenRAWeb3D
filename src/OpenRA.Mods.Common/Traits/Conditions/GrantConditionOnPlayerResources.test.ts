/**
 * GrantConditionOnPlayerResources.test.ts — Unit tests for GrantConditionOnPlayerResources
 *
 * Tests focus on: condition grant/revoke based on resource threshold,
 * owner change handling, edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GrantConditionOnPlayerResources,
  GrantConditionOnPlayerResourcesInfo,
} from './GrantConditionOnPlayerResources.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerResources } from '../Player/PlayerResources.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock PlayerResources with configurable resource count.
 *
 *  Uses duck-typing — only the `resources` field is needed by
 *  GrantConditionOnPlayerResources.
 */
function createMockPlayerResources(initialResources: number = 0): PlayerResources {
  const pr = {
    resources: initialResources,
    cash: 0,
    resourceCapacity: 1000,
  }
  return pr as unknown as PlayerResources
}

/** Create a mock IGameActor with grantCondition/revokeCondition support.
 *
 *  Tracks granted conditions and revoked tokens for test assertions.
 */
function createMockActor(
  playerResources?: PlayerResources,
): IGameActor & { _granted: string[]; _revoked: number[] } {
  let nextToken = 1
  const granted: string[] = []
  const revoked: number[] = []

  const playerActor = {
    actorId: 999,
    isInWorld: true,
    isDead: false,
    disposed: false,
    _playerResources: playerResources,
  } as unknown as IGameActor

  const ownerExt = {
    playerName: 'TestPlayer',
    playerActor,
  } as unknown as PlayerStub

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: ownerExt,
    grantCondition(condition: string): number {
      granted.push(condition)
      return nextToken++
    },
    revokeCondition(token: number): number {
      revoked.push(token)
      return -1
    },
    _granted: granted,
    _revoked: revoked,
  } as unknown as IGameActor & { _granted: string[]; _revoked: number[] }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrantConditionOnPlayerResources', () => {
  // ---------------------------------------------------------------------------
  // GrantConditionOnPlayerResourcesInfo tests
  // ---------------------------------------------------------------------------

  describe('GrantConditionOnPlayerResourcesInfo', () => {
    it('stores condition string', () => {
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: 'HasResources' })
      expect(info.condition).toBe('HasResources')
    })

    it('has default threshold of 0', () => {
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: 'HasResources' })
      expect(info.threshold).toBe(0)
    })

    it('accepts custom threshold', () => {
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'Rich',
        threshold: 1000,
      })
      expect(info.threshold).toBe(1000)
    })

    it('has undefined instanceName by default', () => {
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: 'Test' })
      expect(info.instanceName).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // GrantConditionOnPlayerResources trait tests
  // ---------------------------------------------------------------------------

  describe('GrantConditionOnPlayerResources', () => {
    let actor: IGameActor & { _granted: string[]; _revoked: number[] }
    let playerResources: PlayerResources

    beforeEach(() => {
      playerResources = createMockPlayerResources(0)
      actor = createMockActor(playerResources)
    })

    it('does not grant condition when resources are at 0 and threshold is 0', () => {
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: 'HasResources', threshold: 0 })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      // Resources = 0, threshold = 0 → resources > 0 is false
      trait.tick(actor)
      expect(actor._granted.length).toBe(0)
    })

    it('grants condition when resources exceed threshold', () => {
      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted).toContain('HasResources')
      expect(actor._granted.length).toBe(1)
    })

    it('does not grant condition when resources are below threshold', () => {
      playerResources.resources = 50
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted.length).toBe(0)
    })

    it('grants condition when resources equal threshold + 1', () => {
      playerResources.resources = 101
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted.length).toBe(1)
    })

    it('revokes condition when resources drop below threshold', () => {
      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted.length).toBe(1)

      // Drop resources below threshold
      playerResources.resources = 50
      trait.tick(actor)
      expect(actor._revoked.length).toBe(1)
    })

    it('does not re-grant condition if already granted', () => {
      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted.length).toBe(1)

      // Tick again with same resource level — should not grant again
      trait.tick(actor)
      expect(actor._granted.length).toBe(1)
    })

    it('does not re-revoke condition if already revoked', () => {
      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor) // grants
      expect(actor._granted.length).toBe(1)

      playerResources.resources = 50
      trait.tick(actor) // revokes
      expect(actor._revoked.length).toBe(1)

      // Tick again with same low level — should not revoke again
      trait.tick(actor)
      expect(actor._revoked.length).toBe(1)
    })

    it('does nothing when condition string is empty', () => {
      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: '', threshold: 0 })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted.length).toBe(0)
      expect(actor._revoked.length).toBe(0)
    })

    it('does nothing when actor has no owner', () => {
      const noOwnerActor = createMockActor(playerResources)
      ;(noOwnerActor as unknown as { owner: undefined }).owner = undefined
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: 'HasResources' })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(noOwnerActor)
      trait.tick(noOwnerActor)
      expect(noOwnerActor._granted.length).toBe(0)
    })

    it('handles owner change to a new owner with more resources', () => {
      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actor)
      trait.tick(actor)
      expect(actor._granted.length).toBe(1)

      // Change owner — new owner has different PlayerResources
      const newPlayerResources = createMockPlayerResources(50) // below threshold
      const newPlayerActor = {
        actorId: 888,
        isInWorld: true,
        isDead: false,
        disposed: false,
        _playerResources: newPlayerResources,
      } as unknown as IGameActor

      const newOwnerExt = {
        playerName: 'NewOwner',
        playerActor: newPlayerActor,
      } as unknown as PlayerStub

      trait.onOwnerChanged(actor, actor.owner!, newOwnerExt)

      // Condition is revoked on the old owner during the change
      expect(actor._revoked.length).toBe(1)

      // Now tick with new owner's resources (below threshold) — should not re-grant
      trait.tick(actor)
      // No grant because resources are below threshold for new owner
      expect(actor._granted.length).toBe(1) // only the original grant
    })

    it('handles actor without grantCondition/revokeCondition gracefully', () => {
      const { grantCondition, revokeCondition, ...baseActor } = actor
      const actorWithoutMethod = baseActor as IGameActor & { _granted: string[]; _revoked: number[] }
      actorWithoutMethod._granted = actor._granted
      actorWithoutMethod._revoked = actor._revoked

      playerResources.resources = 500
      const info = new GrantConditionOnPlayerResourcesInfo({
        condition: 'HasResources',
        threshold: 100,
      })
      const trait = new GrantConditionOnPlayerResources(info)
      trait.created(actorWithoutMethod)
      trait.tick(actorWithoutMethod)
      // Should not throw; just silently does nothing
      expect(actorWithoutMethod._granted.length).toBe(0)
    })

    it('implements INotifyCreated, INotifyOwnerChanged, ITick', () => {
      const info = new GrantConditionOnPlayerResourcesInfo({ condition: 'Test' })
      const trait = new GrantConditionOnPlayerResources(info)
      expect(typeof trait.created).toBe('function')
      expect(typeof trait.onOwnerChanged).toBe('function')
      expect(typeof trait.tick).toBe('function')
    })
  })
})
