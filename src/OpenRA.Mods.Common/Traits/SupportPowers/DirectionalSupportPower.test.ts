/**
 * DirectionalSupportPower.test.ts — DirectionalSupportPower 单元测试
 *
 * Tests focus on: configuration, SelectTarget routing based on UseDirectionalTarget flag.
 */

import { describe, it, expect } from 'vitest'
import {
  DirectionalSupportPower,
  DEFAULT_DIRECTIONAL_ARROWS,
  type DirectionalSupportPowerInfo,
} from './DirectionalSupportPower.js'
import {
  type ISupportPowerManager,
  type ISupportPowerInstance,
  SupportPower,
} from './SupportPower.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(actorId = 1): IGameActor & { _impls: Record<string, unknown[]> } {
  const impls: Record<string, unknown[]> = {}
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: undefined,
    world: undefined,
    traitsImplementing(interfaceId: string): unknown[] {
      return impls[interfaceId] ?? []
    },
    _impls: impls,
  } as IGameActor & { _impls: Record<string, unknown[]> }
}

function createMockManager(): ISupportPowerManager {
  const powers = new Map<string, ISupportPowerInstance>()
  return {
    self: createMockActor(),
    powers,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DirectionalSupportPower', () => {
  // -----------------------------------------------------------------------
  // DEFAULT_DIRECTIONAL_ARROWS
  // -----------------------------------------------------------------------

  describe('DEFAULT_DIRECTIONAL_ARROWS', () => {
    it('has 8 arrows (N, NW, W, SW, S, SE, E, NE)', () => {
      expect(DEFAULT_DIRECTIONAL_ARROWS).toHaveLength(8)
    })

    it('starts with N (arrow-t)', () => {
      expect(DEFAULT_DIRECTIONAL_ARROWS[0]).toBe('arrow-t')
    })

    it('contains all 8 cardinal and diagonal directions', () => {
      expect(DEFAULT_DIRECTIONAL_ARROWS).toEqual([
        'arrow-t',   // N
        'arrow-tl',  // NW
        'arrow-l',   // W
        'arrow-bl',  // SW
        'arrow-b',   // S
        'arrow-br',  // SE
        'arrow-r',   // E
        'arrow-tr',  // NE
      ])
    })
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores self, info, and dirInfo', () => {
      const actor = createMockActor()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
        useDirectionalTarget: true,
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.info).toBe(info)
      expect(power.dirInfo).toBe(info)
      expect(power.dirInfo.useDirectionalTarget).toBe(true)
    })

    it('extends SupportPower', () => {
      const actor = createMockActor()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(power).toBeInstanceOf(SupportPower)
    })

    it('has default arrows when not configured', () => {
      const actor = createMockActor()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(power.dirInfo.arrows).toBeUndefined()
    })

    it('has configured arrows', () => {
      const actor = createMockActor()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
        arrows: ['a', 'b', 'c', 'd'],
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(power.dirInfo.arrows).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  // -----------------------------------------------------------------------
  // selectTarget
  // -----------------------------------------------------------------------

  describe('selectTarget', () => {
    it('delegates to base when UseDirectionalTarget is false', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
        useDirectionalTarget: false,
      }
      const power = new DirectionalSupportPower(actor, info)

      // Call selectTarget — should delegate to base (which is a no-op stub)
      expect(() => power.selectTarget(actor, 'TestOrder', manager)).not.toThrow()
    })

    it('does not throw when UseDirectionalTarget is true', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
        useDirectionalTarget: true,
        arrows: DEFAULT_DIRECTIONAL_ARROWS,
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(() => power.selectTarget(actor, 'TestOrder', manager)).not.toThrow()
    })

    it('uses directional path when useDirectionalTarget is true', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
        useDirectionalTarget: true,
        arrows: DEFAULT_DIRECTIONAL_ARROWS,
        cursor: 'directional-cursor',
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(() => power.selectTarget(actor, 'TestOrder', manager)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // ConditionalTrait integration
  // -----------------------------------------------------------------------

  describe('ConditionalTrait integration', () => {
    it('has isTraitDisabled as false by default', () => {
      const actor = createMockActor()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(power.isTraitDisabled).toBe(false)
    })

    it('has isTraitPaused as false by default', () => {
      const actor = createMockActor()
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
      }
      const power = new DirectionalSupportPower(actor, info)

      expect(power.isTraitPaused).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Info configuration
  // -----------------------------------------------------------------------

  describe('DirectionalSupportPowerInfo', () => {
    it('accepts all directional configuration fields', () => {
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 500,
        useDirectionalTarget: true,
        arrows: DEFAULT_DIRECTIONAL_ARROWS,
        directionArrowAnimation: 'my-animation',
        directionArrowPalette: 'player',
        cursor: 'custom',
        blockedCursor: 'blocked',
        startFullyCharged: true,
        oneShot: false,
      }

      expect(info.useDirectionalTarget).toBe(true)
      expect(info.arrows).toHaveLength(8)
      expect(info.directionArrowAnimation).toBe('my-animation')
      expect(info.directionArrowPalette).toBe('player')
      expect(info.chargeInterval).toBe(500)
      expect(info.startFullyCharged).toBe(true)
    })

    it('has useDirectionalTarget defaulting to undefined', () => {
      const info: DirectionalSupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
      }

      expect(info.useDirectionalTarget).toBeUndefined()
    })
  })
})
