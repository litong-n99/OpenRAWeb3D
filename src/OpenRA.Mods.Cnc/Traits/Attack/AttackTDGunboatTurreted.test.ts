/**
 * AttackTDGunboatTurreted.test.ts — unit tests for gunboat turret attack
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  AttackTDGunboatTurreted,
  AttackTDGunboatTurretedInfo,
} from './AttackTDGunboatTurreted.js'

describe('AttackTDGunboatTurreted', () => {
  describe('AttackTDGunboatTurretedInfo', () => {
    it('has correct defaults', () => {
      const info = new AttackTDGunboatTurretedInfo()
      expect(info.turrets).toEqual(['primary'])
    })
  })

  describe('constructor', () => {
    it('creates valid instance', () => {
      const info = new AttackTDGunboatTurretedInfo()
      const trait = new AttackTDGunboatTurreted(info)
      expect(trait).toBeDefined()
      expect(trait.isTraitDisabled).toBe(false)
    })
  })

  describe('getAttackActivity', () => {
    it('returns GunboatAttackActivity', () => {
      const info = new AttackTDGunboatTurretedInfo()
      const trait = new AttackTDGunboatTurreted(info)
      const target = { type: 0 } as any
      const self = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false,
      } as any

      const activity = trait.getAttackActivity(self, 0, target, false, false, '') as {
        tick?: () => boolean
        targetLineNodes?: () => unknown[]
      }
      expect(activity).toBeDefined()
      expect(typeof activity.tick).toBe('function')
      expect(typeof activity.targetLineNodes).toBe('function')
    })
  })

  describe('getRequestedTarget', () => {
    it('returns Invalid target by default', () => {
      const info = new AttackTDGunboatTurretedInfo()
      const trait = new AttackTDGunboatTurreted(info)
      const target = trait.getRequestedTarget()
      expect(target.type).toBe(0) // TargetType.Invalid
    })
  })

  describe('chooseArmamentsForTarget', () => {
    it('returns empty array when no armaments', () => {
      const info = new AttackTDGunboatTurretedInfo()
      const trait = new AttackTDGunboatTurreted(info)
      const target = { type: 0 } as any
      const chosen = trait.chooseArmamentsForTarget(target, false)
      expect(chosen).toEqual([])
    })
  })
})
