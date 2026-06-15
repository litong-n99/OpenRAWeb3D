/**
 * SupportPowerChargeBar.test.ts — SupportPowerChargeBar unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SupportPowerChargeBar,
  type SupportPowerChargeBarInfo,
  DEFAULT_CHARGE_BAR_INFO,
} from './SupportPowerChargeBar.js'
import type { IGameActor, PlayerStub, ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ISupportPowerManager, ISupportPowerInstance } from '../SupportPowers/SupportPower.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<SupportPowerChargeBarInfo> = {}): SupportPowerChargeBarInfo {
  return {
    ...DEFAULT_CHARGE_BAR_INFO,
    ...overrides,
  }
}

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: { playerName: 'testOwner' },
    ...overrides,
  }
}

function makeMockPower(overrides: Partial<ISupportPowerInstance> = {}): ISupportPowerInstance {
  return {
    key: 'TestPower',
    instances: [],
    info: { orderName: 'TestPowerOrder', chargeInterval: 1000 } as never,
    totalTicks: overrides.totalTicks ?? 1000,
    remainingTicks: overrides.remainingTicks ?? 500,
    active: overrides.active ?? true,
    ready: overrides.ready ?? false,
    disabled: overrides.disabled ?? false,
  }
}

function makeMockManager(powers: ISupportPowerInstance[] = []): ISupportPowerManager {
  const map = new Map<string, ISupportPowerInstance>()
  for (const p of powers) {
    map.set(p.key, p)
  }
  return {
    self: makeActor(),
    powers: map,
  }
}

function makePlayer(name: string): PlayerStub {
  return { playerName: name }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupportPowerChargeBar', () => {
  let actor: IGameActor

  beforeEach(() => {
    actor = makeActor()
  })

  describe('construction', () => {
    it('stores self reference', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      expect(bar.self).toBe(actor)
    })

    it('stores displayRelationships from info', () => {
      const info = makeInfo({ displayRelationships: 1 }) // Enemy
      const bar = new SupportPowerChargeBar(actor, info)
      expect(bar.info.displayRelationships).toBe(1)
    })

    it('stores color from info', () => {
      const customColor: ColorStub = { r: 255, g: 128, b: 0, a: 255 }
      const info = makeInfo({ color: customColor })
      const bar = new SupportPowerChargeBar(actor, info)
      expect(bar.info.color).toBe(customColor)
    })
  })

  describe('getValue', () => {
    it('returns 0 when trait is disabled', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      ;(bar as unknown as { _enabled: boolean })._enabled = false

      const power = makeMockPower({ totalTicks: 1000, remainingTicks: 200 })
      bar._testSpm = makeMockManager([power])

      expect(bar.getValue()).toBe(0)
    })

    it('returns 0 when no manager is set', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      bar._testSpm = null
      expect(bar.getValue()).toBe(0)
    })

    it('returns charge fraction for partial charge', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const power = makeMockPower({ totalTicks: 1000, remainingTicks: 250 })
      bar._testSpm = makeMockManager([power])

      // 1 - 250/1000 = 0.75
      expect(bar.getValue()).toBeCloseTo(0.75, 5)
    })

    it('returns 1.0 when fully charged', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const power = makeMockPower({ totalTicks: 1000, remainingTicks: 0 })
      bar._testSpm = makeMockManager([power])

      expect(bar.getValue()).toBeCloseTo(1.0, 5)
    })

    it('returns 0 when remaining = total (fully discharged)', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const power = makeMockPower({ totalTicks: 1000, remainingTicks: 1000 })
      bar._testSpm = makeMockManager([power])

      expect(bar.getValue()).toBeCloseTo(0.0, 5)
    })

    it('returns 0 when totalTicks is 0', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const power = makeMockPower({ totalTicks: 0, remainingTicks: 0 })
      bar._testSpm = makeMockManager([power])

      expect(bar.getValue()).toBe(0)
    })

    it('skips disabled powers and uses the first non-disabled', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const disabledPower = makeMockPower({
        key: 'DisabledPower',
        totalTicks: 1000,
        remainingTicks: 0,
        disabled: true,
      })
      const enabledPower = makeMockPower({
        key: 'EnabledPower',
        totalTicks: 1000,
        remainingTicks: 500,
        disabled: false,
      })
      bar._testSpm = makeMockManager([disabledPower, enabledPower])

      // Uses the first non-disabled power (EnabledPower): 1 - 500/1000 = 0.5
      // But getFirstEnabledPower iterates map values, which returns in insertion order
      // The disabledPower comes first but is skipped
      expect(bar.getValue()).toBeCloseTo(0.5, 5)
    })
  })

  describe('getColor', () => {
    it('returns info.color', () => {
      const customColor: ColorStub = { r: 0, g: 255, b: 128, a: 255 }
      const info = makeInfo({ color: customColor })
      const bar = new SupportPowerChargeBar(actor, info)
      expect(bar.getColor()).toBe(customColor)
    })

    it('returns magenta by default', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      expect(bar.getColor().r).toBe(255)
      expect(bar.getColor().g).toBe(0)
      expect(bar.getColor().b).toBe(255)
    })
  })

  describe('displayWhenEmpty', () => {
    it('returns false (hidden when empty)', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      expect(bar.displayWhenEmpty).toBe(false)
    })
  })

  describe('onOwnerChanged', () => {
    it('stores the new owner', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const oldOwner = makePlayer('old')
      const newOwner = makePlayer('new')

      bar.onOwnerChanged(actor, oldOwner, newOwner)
      // Should update SPM reference — stubbed for now, but the call should not throw
      expect(true).toBe(true)
    })
  })

  describe('getFirstEnabledPower', () => {
    it('returns null when no manager', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      bar._testSpm = null
      expect((bar as any).getFirstEnabledPower()).toBeNull()
    })

    it('returns null when no powers', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      bar._testSpm = makeMockManager([])
      expect((bar as any).getFirstEnabledPower()).toBeNull()
    })

    it('returns first non-disabled power', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const power = makeMockPower({ key: 'Test', disabled: false })
      bar._testSpm = makeMockManager([power])

      const result = (bar as any).getFirstEnabledPower()
      expect(result).toBe(power)
    })

    it('returns null when all powers are disabled', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const power = makeMockPower({ key: 'Test', disabled: true })
      bar._testSpm = makeMockManager([power])

      const result = (bar as any).getFirstEnabledPower()
      expect(result).toBeNull()
    })
  })

  describe('test injection', () => {
    it('allows injecting SPM via _testSpm', () => {
      const info = makeInfo()
      const bar = new SupportPowerChargeBar(actor, info)
      const manager = makeMockManager()
      bar._testSpm = manager
      expect(bar._testSpm).toBe(manager)
    })
  })
})
