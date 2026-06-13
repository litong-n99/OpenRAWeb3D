/**
 * GrantConditionOnMovement.test.ts -- Unit tests for GrantConditionOnMovement
 *
 * Tests focus on: condition grant/revoke on movement changes,
 * movement type filtering, enabled/disabled state transitions.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GrantConditionOnMovement,
  GrantConditionOnMovementInfo,
} from './GrantConditionOnMovement.js'
import { MovementType } from '../World/Locomotor.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(): IGameActor {
  let nextToken = 1
  const granted: string[] = []
  const revoked: number[] = []

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
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
  } as unknown as IGameActor
}

function createMockMovement(movementTypes: MovementType = MovementType.None) {
  return { movementTypes }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrantConditionOnMovement', () => {
  // ---------------------------------------------------------------------------
  // GrantConditionOnMovementInfo tests
  // ---------------------------------------------------------------------------

  describe('GrantConditionOnMovementInfo', () => {
    it('default validMovementTypes is Horizontal', () => {
      const info = new GrantConditionOnMovementInfo({ condition: 'Moving' })
      expect(info.validMovementTypes).toBe(MovementType.Horizontal)
    })

    it('accepts custom validMovementTypes', () => {
      const info = new GrantConditionOnMovementInfo({
        condition: 'Turning',
        validMovementTypes: MovementType.Turn,
      })
      expect(info.validMovementTypes).toBe(MovementType.Turn)
    })

    it('accepts combined validMovementTypes', () => {
      const info = new GrantConditionOnMovementInfo({
        condition: 'Moving',
        validMovementTypes: MovementType.Horizontal | MovementType.Vertical,
      })
      expect(
        info.validMovementTypes & MovementType.Horizontal,
      ).toBe(MovementType.Horizontal)
      expect(
        info.validMovementTypes & MovementType.Vertical,
      ).toBe(MovementType.Vertical)
    })
  })

  // ---------------------------------------------------------------------------
  // GrantConditionOnMovement trait tests
  // ---------------------------------------------------------------------------

  describe('GrantConditionOnMovement', () => {
    let actor: IGameActor & { _granted: string[]; _revoked: number[] }
    let movement: { movementTypes: MovementType }

    beforeEach(() => {
      actor = createMockActor() as unknown as IGameActor & { _granted: string[]; _revoked: number[] }
    })

    it('grants condition when movement matches (Horizontal)', () => {
      movement = createMockMovement(MovementType.Horizontal)
      const info = new GrantConditionOnMovementInfo({ condition: 'IsMoving' })
      const trait = new GrantConditionOnMovement(info, movement)
      trait.onNotifyMoving(actor)
      expect(actor._granted).toContain('IsMoving')
      expect(actor._granted.length).toBe(1)
    })

    it('does not grant condition when movement is None', () => {
      movement = createMockMovement(MovementType.None)
      const info = new GrantConditionOnMovementInfo({ condition: 'IsMoving' })
      const trait = new GrantConditionOnMovement(info, movement)
      trait.onNotifyMoving(actor)
      expect(actor._granted.length).toBe(0)
    })

    it('revokes condition when movement stops', () => {
      movement = createMockMovement(MovementType.Horizontal)
      const info = new GrantConditionOnMovementInfo({ condition: 'IsMoving' })
      const trait = new GrantConditionOnMovement(info, movement)

      // Start moving: grant condition
      trait.onNotifyMoving(actor)
      expect(actor._granted.length).toBe(1)

      // Stop moving: revoke condition
      movement.movementTypes = MovementType.None
      trait.onNotifyMoving(actor)
      expect(actor._revoked.length).toBe(1)
    })

    it('does not grant condition when disabled', () => {
      movement = createMockMovement(MovementType.Horizontal)
      const info = new GrantConditionOnMovementInfo({ condition: 'IsMoving' })
      const trait = new GrantConditionOnMovement(info, movement)

      // Disable trait
      trait['traitDisabled']({} as never)
      trait.onNotifyMoving(actor)
      expect(actor._granted.length).toBe(0)
    })

    it('revokes condition when trait becomes disabled', () => {
      movement = createMockMovement(MovementType.Horizontal)
      const info = new GrantConditionOnMovementInfo({ condition: 'IsMoving' })
      const trait = new GrantConditionOnMovement(info, movement)

      // Grant condition first
      trait.onNotifyMoving(actor)
      expect(actor._granted.length).toBe(1)

      // Disable trait — should revoke
      trait['traitDisabled'](actor)
      expect(actor._revoked.length).toBe(1)
    })

    it('grants condition when re-enabled while moving', () => {
      movement = createMockMovement(MovementType.Horizontal)
      const info = new GrantConditionOnMovementInfo({ condition: 'IsMoving' })
      const trait = new GrantConditionOnMovement(info, movement)

      // Disable and then re-enable
      trait['traitDisabled'](actor)
      trait['traitEnabled'](actor)
      expect(actor._granted.length).toBe(1)
    })

    it('grants condition on Turn movement type', () => {
      movement = createMockMovement(MovementType.Turn)
      const info = new GrantConditionOnMovementInfo({
        condition: 'Turning',
        validMovementTypes: MovementType.Turn,
      })
      const trait = new GrantConditionOnMovement(info, movement)
      trait.onNotifyMoving(actor)
      expect(actor._granted).toContain('Turning')
    })

    it('does not grant condition for non-matching movement type', () => {
      movement = createMockMovement(MovementType.Vertical)
      const info = new GrantConditionOnMovementInfo({
        condition: 'IsMoving',
        validMovementTypes: MovementType.Horizontal | MovementType.Turn,
      })
      const trait = new GrantConditionOnMovement(info, movement)
      trait.onNotifyMoving(actor)
      expect(actor._granted.length).toBe(0)
    })
  })
})
