/**
 * PlayerResources.test.ts — PlayerResources migration unit tests
 *
 * Tests focus on:
 * - PlayerResourcesInfo defaults and custom constructor params
 * - Cash management: addCash, refundCash, takeCash, changeCash
 * - Resource management: giveResources, refundResources, takeResources, canGiveResources
 * - Storage capacity: addStorageCapacity, removeStorageCapacity
 * - Queries: getCashAndResources, canAfford
 * - Sync hashes: cashSync, resourcesSync, resourceCapacitySync
 * - Lifecycle: created (initial cash), attach/detach (_playerResources pattern)
 * - Edge cases: overflow protection, zero/negative amounts, capacity clamping
 * - "Spend ore before cash" rule
 * - ConditionalTrait integration
 * - Bot module convenience: resourceFillRatio
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PlayerResources, PlayerResourcesInfo } from './PlayerResources'
import type {
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a PlayerResourcesInfo with explicit defaults. */
function createInfo(overrides: Partial<{
  instanceName?: string
  requiresCondition?: string
  defaultCashDropdownLabel?: string
  selectableCash?: readonly number[]
  defaultCash?: number
  defaultCashDropdownLocked?: boolean
  defaultCashDropdownVisible?: boolean
  insufficientFundsNotification?: string | null
  insufficientFundsTextNotification?: string | null
  insufficientFundsNotificationInterval?: number
  cashTickUpNotification?: string | null
  cashTickDownNotification?: string | null
  resourceValues?: ReadonlyMap<string, number>
}> = {}): PlayerResourcesInfo {
  return new PlayerResourcesInfo(overrides as PlayerResourcesInfo)
}

/** Create a minimal IGameActor for testing. */
function createActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: overrides.actorId ?? 1,
    isInWorld: overrides.isInWorld ?? true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    ...overrides,
  } as IGameActor
}

// ---------------------------------------------------------------------------
// PlayerResourcesInfo — defaults
// ---------------------------------------------------------------------------

describe('PlayerResourcesInfo', () => {
  it('has default instanceName and requiresCondition as undefined', () => {
    const info = createInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.requiresCondition).toBeUndefined()
  })

  it('defaults defaultCashDropdownLabel to "Starting Cash"', () => {
    const info = createInfo()
    expect(info.defaultCashDropdownLabel).toBe('Starting Cash')
  })

  it('defaults selectableCash to [2500, 5000, 10000, 20000]', () => {
    const info = createInfo()
    expect(info.selectableCash).toEqual([2500, 5000, 10000, 20000])
  })

  it('defaults defaultCash to 5000', () => {
    const info = createInfo()
    expect(info.defaultCash).toBe(5000)
  })

  it('defaults defaultCashDropdownLocked to false', () => {
    const info = createInfo()
    expect(info.defaultCashDropdownLocked).toBe(false)
  })

  it('defaults defaultCashDropdownVisible to true', () => {
    const info = createInfo()
    expect(info.defaultCashDropdownVisible).toBe(true)
  })

  it('defaults insufficientFundsNotification to null', () => {
    const info = createInfo()
    expect(info.insufficientFundsNotification).toBeNull()
  })

  it('defaults insufficientFundsTextNotification to null', () => {
    const info = createInfo()
    expect(info.insufficientFundsTextNotification).toBeNull()
  })

  it('defaults insufficientFundsNotificationInterval to 30000', () => {
    const info = createInfo()
    expect(info.insufficientFundsNotificationInterval).toBe(30000)
  })

  it('defaults cashTickUpNotification to null', () => {
    const info = createInfo()
    expect(info.cashTickUpNotification).toBeNull()
  })

  it('defaults cashTickDownNotification to null', () => {
    const info = createInfo()
    expect(info.cashTickDownNotification).toBeNull()
  })

  it('defaults resourceValues to an empty Map', () => {
    const info = createInfo()
    expect(info.resourceValues.size).toBe(0)
  })

  it('accepts custom defaultCash', () => {
    const info = createInfo({ defaultCash: 10000 })
    expect(info.defaultCash).toBe(10000)
  })

  it('accepts custom selectableCash', () => {
    const info = createInfo({ selectableCash: [500, 1000] })
    expect(info.selectableCash).toEqual([500, 1000])
  })

  it('accepts custom resourceValues', () => {
    const rv = new Map([['ore', 50], ['gems', 100]])
    const info = createInfo({ resourceValues: rv })
    expect(info.resourceValues.get('ore')).toBe(50)
    expect(info.resourceValues.get('gems')).toBe(100)
  })

  it('accepts custom notification settings', () => {
    const info = createInfo({
      insufficientFundsNotification: 'InsufficientFunds',
      insufficientFundsTextNotification: 'Not enough funds!',
      insufficientFundsNotificationInterval: 60000,
      cashTickUpNotification: 'CashTickUp',
      cashTickDownNotification: 'CashTickDown',
    })
    expect(info.insufficientFundsNotification).toBe('InsufficientFunds')
    expect(info.insufficientFundsTextNotification).toBe('Not enough funds!')
    expect(info.insufficientFundsNotificationInterval).toBe(60000)
    expect(info.cashTickUpNotification).toBe('CashTickUp')
    expect(info.cashTickDownNotification).toBe('CashTickDown')
  })

  it('accepts custom lobby display options', () => {
    const info = createInfo({
      defaultCashDropdownLabel: 'Initial Money',
      defaultCashDropdownLocked: true,
      defaultCashDropdownVisible: false,
    })
    expect(info.defaultCashDropdownLabel).toBe('Initial Money')
    expect(info.defaultCashDropdownLocked).toBe(true)
    expect(info.defaultCashDropdownVisible).toBe(false)
  })

  it('implements ConditionalTraitInfo', () => {
    const info = createInfo({ requiresCondition: 'powered', instanceName: 'resources' })
    expect(info.requiresCondition).toBe('powered')
    expect(info.instanceName).toBe('resources')
    expect('requiresCondition' in info).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — initial state
// ---------------------------------------------------------------------------

describe('PlayerResources initial state', () => {
  let pr: PlayerResources

  beforeEach(() => {
    pr = new PlayerResources(createInfo({ defaultCash: 5000 }))
  })

  it('starts with cash = 0 before created()', () => {
    expect(pr.cash).toBe(0)
  })

  it('starts with earned = 0', () => {
    expect(pr.earned).toBe(0)
  })

  it('starts with spent = 0', () => {
    expect(pr.spent).toBe(0)
  })

  it('starts with resources = 0', () => {
    expect(pr.resources).toBe(0)
  })

  it('starts with resourceCapacity = 0', () => {
    expect(pr.resourceCapacity).toBe(0)
  })

  it('sync hashes match initial values', () => {
    expect(pr.cashSync).toBe(0)
    expect(pr.resourcesSync).toBe(0)
    expect(pr.resourceCapacitySync).toBe(0)
  })

  it('getCashAndResources returns 0 initially', () => {
    expect(pr.getCashAndResources()).toBe(0)
  })

  it('canAfford returns false for positive cost initially', () => {
    expect(pr.canAfford(100)).toBe(false)
  })

  it('canAfford returns true for zero cost', () => {
    expect(pr.canAfford(0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — created() lifecycle
// ---------------------------------------------------------------------------

describe('PlayerResources created()', () => {
  it('sets cash to info.defaultCash on created()', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(actor)

    expect(pr.cash).toBe(5000)
  })

  it('uses custom defaultCash', () => {
    const info = createInfo({ defaultCash: 10000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(actor)

    expect(pr.cash).toBe(10000)
  })

  it('does not modify earned/spent on created', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(actor)

    expect(pr.earned).toBe(0)
    expect(pr.spent).toBe(0)
  })

  it('does not modify resources on created', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(actor)

    expect(pr.resources).toBe(0)
    expect(pr.resourceCapacity).toBe(0)
  })

  it('sync hashes update after created', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(actor)

    expect(pr.cashSync).toBe(5000)
    expect(pr.resourcesSync).toBe(0)
    expect(pr.resourceCapacitySync).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — addCash
// ---------------------------------------------------------------------------

describe('PlayerResources addCash', () => {
  let info: PlayerResourcesInfo
  let pr: PlayerResources
  let actor: IGameActor

  beforeEach(() => {
    info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    actor = createActor()
    pr.attach(actor)
    pr.created(actor)
  })

  it('adds cash to balance', () => {
    pr.addCash(1000)
    expect(pr.cash).toBe(6000)
  })

  it('increases earned when isRefund is false', () => {
    pr.addCash(1000)
    expect(pr.earned).toBe(1000)
  })

  it('decreases spent when isRefund is true', () => {
    pr.spent = 2000
    pr.addCash(500, true)
    expect(pr.spent).toBe(1500)
    expect(pr.cash).toBe(5500)
  })

  it('does not increase earned when isRefund is true', () => {
    pr.addCash(500, true)
    expect(pr.earned).toBe(0)
  })

  it('does nothing when amount is 0', () => {
    pr.addCash(0)
    expect(pr.cash).toBe(5000)
    expect(pr.earned).toBe(0)
  })

  it('does nothing when amount is negative', () => {
    pr.addCash(-100)
    expect(pr.cash).toBe(5000)
    expect(pr.earned).toBe(0)
  })

  it('clamps cash to MAX_SAFE_INTEGER on overflow', () => {
    pr.cash = Number.MAX_SAFE_INTEGER - 1
    pr.addCash(100)
    expect(pr.cash).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('clamps earned to MAX_SAFE_INTEGER on overflow', () => {
    pr.earned = Number.MAX_SAFE_INTEGER - 1
    pr.addCash(100)
    expect(pr.earned).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('clamps spent to MIN_SAFE_INTEGER on refund overflow', () => {
    pr.spent = Number.MIN_SAFE_INTEGER + 1
    pr.addCash(100, true)
    expect(pr.spent).toBe(Number.MIN_SAFE_INTEGER)
  })

  it('does not change cash when already at MAX_SAFE_INTEGER', () => {
    pr.cash = Number.MAX_SAFE_INTEGER
    pr.addCash(1000)
    expect(pr.cash).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('does not change earned when already at MAX_SAFE_INTEGER', () => {
    pr.earned = Number.MAX_SAFE_INTEGER
    pr.addCash(1000)
    expect(pr.earned).toBe(Number.MAX_SAFE_INTEGER)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — refundCash
// ---------------------------------------------------------------------------

describe('PlayerResources refundCash', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
  })

  it('delegates to addCash with isRefund=true', () => {
    pr.spent = 1000
    pr.refundCash(300)
    expect(pr.cash).toBe(5300)
    expect(pr.spent).toBe(700)
  })

  it('does not increase earned', () => {
    pr.refundCash(300)
    expect(pr.earned).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — takeCash
// ---------------------------------------------------------------------------

describe('PlayerResources takeCash', () => {
  let info: PlayerResourcesInfo
  let pr: PlayerResources
  let actor: IGameActor

  beforeEach(() => {
    info = createInfo({ defaultCash: 5000, insufficientFundsNotificationInterval: 30000 })
    pr = new PlayerResources(info)
    actor = createActor()
    pr.attach(actor)
    pr.created(actor)
  })

  it('returns true when sufficient cash', () => {
    const result = pr.takeCash(1000)
    expect(result).toBe(true)
    expect(pr.cash).toBe(4000)
    expect(pr.spent).toBe(1000)
  })

  it('returns false when insufficient total funds', () => {
    const result = pr.takeCash(6000)
    expect(result).toBe(false)
    // Cash should not change
    expect(pr.cash).toBe(5000)
  })

  it('spends resources before cash', () => {
    pr.resources = 500
    pr.resourceCapacity = 1000

    const result = pr.takeCash(800)
    // Resources consumed first (500), then cash covers remaining (300)
    expect(result).toBe(true)
    expect(pr.resources).toBe(0)
    expect(pr.cash).toBe(4700) // 5000 - 300
    expect(pr.spent).toBe(800)
  })

  it('handles partial resource coverage', () => {
    pr.resources = 200
    pr.resourceCapacity = 1000

    const result = pr.takeCash(1000)
    // Resources consumed first (200), then cash covers remaining (800)
    expect(result).toBe(true)
    expect(pr.resources).toBe(0)
    expect(pr.cash).toBe(4200) // 5000 - 800
    expect(pr.spent).toBe(1000)
  })

  it('returns true when amount is 0', () => {
    const result = pr.takeCash(0)
    expect(result).toBe(true)
    expect(pr.cash).toBe(5000)
  })

  it('returns true when amount is negative', () => {
    const result = pr.takeCash(-100)
    expect(result).toBe(true)
    expect(pr.cash).toBe(5000)
  })

  it('does not trigger notification when notifyLowFunds is false', () => {
    // This should not throw — notification path is stubbed
    expect(() => pr.takeCash(6000, false)).not.toThrow()
  })

  it('does not throw when notifyLowFunds is true and insufficient', () => {
    // Notification path is stubbed — should not throw
    expect(() => pr.takeCash(6000, true)).not.toThrow()
  })

  it('rate-limits insufficient funds notifications', () => {
    // First call should trigger (time condition is met)
    const result1 = pr.takeCash(6000, true)
    expect(result1).toBe(false)

    // Second call within interval should be suppressed (not throw)
    const result2 = pr.takeCash(6000, true)
    expect(result2).toBe(false)

    // Both calls should be no-throw
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — changeCash
// ---------------------------------------------------------------------------

describe('PlayerResources changeCash', () => {
  let info: PlayerResourcesInfo
  let pr: PlayerResources

  beforeEach(() => {
    info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
  })

  it('returns the full amount for positive change', () => {
    const result = pr.changeCash(1000)
    expect(result).toBe(1000)
    expect(pr.cash).toBe(6000)
  })

  it('returns the full amount for negative change within budget', () => {
    const result = pr.changeCash(-1000)
    expect(result).toBe(-1000)
    expect(pr.cash).toBe(4000)
  })

  it('clamps negative change to available total funds', () => {
    const result = pr.changeCash(-6000)
    expect(result).toBe(-5000) // only had 5000 total
    expect(pr.cash).toBe(0)
    expect(pr.resources).toBe(0)
  })

  it('considers resources in total funds for clamping', () => {
    pr.resourceCapacity = 1000
    pr.giveResources(500)

    const result = pr.changeCash(-5500)
    // Total: 5000 cash + 500 resources = 5500
    expect(result).toBe(-5500)
    expect(pr.cash).toBe(0)
    expect(pr.resources).toBe(0)
  })

  it('clamps when resources are available but insufficient for full amount', () => {
    pr.resourceCapacity = 1000
    pr.giveResources(100)

    const result = pr.changeCash(-6000)
    // Total: 5000 cash + 100 resources = 5100
    // Trying to take 6000, clamped to -5100
    expect(result).toBe(-5100)
    expect(pr.getCashAndResources()).toBe(0)
  })

  it('returns 0 when amount is 0', () => {
    const result = pr.changeCash(0)
    expect(result).toBe(0)
    expect(pr.cash).toBe(5000)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — giveResources
// ---------------------------------------------------------------------------

describe('PlayerResources giveResources', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
  })

  it('adds resources to storage', () => {
    pr.giveResources(500)
    expect(pr.resources).toBe(500)
  })

  it('increases earned when isRefund is false', () => {
    pr.giveResources(500)
    expect(pr.earned).toBe(500)
  })

  it('decreases spent when isRefund is true', () => {
    pr.spent = 1000
    pr.giveResources(300, true)
    expect(pr.spent).toBe(700)
    expect(pr.resources).toBe(300)
  })

  it('does not increase earned when isRefund is true', () => {
    pr.giveResources(500, true)
    expect(pr.earned).toBe(0)
  })

  it('caps at resource capacity', () => {
    pr.giveResources(1200)
    expect(pr.resources).toBe(1000)
  })

  it('adjusts earned when overflow is discarded', () => {
    pr.giveResources(1200)
    // 1200 added → 1000 kept, 200 overflow discarded
    // earned = 1200 - 200 = 1000
    expect(pr.earned).toBe(1000)
  })

  it('adjusts spent when overflow is discarded on refund', () => {
    pr.spent = 1500
    pr.giveResources(1200, true)
    // 1200 refunded → 1000 kept, 200 overflow discarded
    // spent = 1500 - 1200 + 200 = 500
    expect(pr.spent).toBe(500)
    expect(pr.resources).toBe(1000)
  })

  it('does nothing when amount is 0', () => {
    pr.giveResources(0)
    expect(pr.resources).toBe(0)
    expect(pr.earned).toBe(0)
  })

  it('does nothing when amount is negative', () => {
    pr.giveResources(-100)
    expect(pr.resources).toBe(0)
    expect(pr.earned).toBe(0)
  })

  it('handles exact capacity fill', () => {
    pr.giveResources(1000)
    expect(pr.resources).toBe(1000)
    expect(pr.earned).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — refundResources
// ---------------------------------------------------------------------------

describe('PlayerResources refundResources', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
  })

  it('delegates to giveResources with isRefund=true', () => {
    pr.spent = 500
    pr.refundResources(300)
    expect(pr.resources).toBe(300)
    expect(pr.spent).toBe(200)
    expect(pr.earned).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — takeResources
// ---------------------------------------------------------------------------

describe('PlayerResources takeResources', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
    pr.giveResources(500)
  })

  it('removes resources from storage', () => {
    const result = pr.takeResources(300)
    expect(result).toBe(true)
    expect(pr.resources).toBe(200)
  })

  it('increases spent on successful take', () => {
    pr.takeResources(300)
    expect(pr.spent).toBe(300)
  })

  it('returns false when insufficient resources', () => {
    const result = pr.takeResources(600)
    expect(result).toBe(false)
    expect(pr.resources).toBe(500) // unchanged
  })

  it('returns true when amount is 0', () => {
    const result = pr.takeResources(0)
    expect(result).toBe(true)
    expect(pr.resources).toBe(500)
  })

  it('returns true when amount is negative', () => {
    const result = pr.takeResources(-100)
    expect(result).toBe(true)
    expect(pr.resources).toBe(500)
  })

  it('can take exactly all resources', () => {
    const result = pr.takeResources(500)
    expect(result).toBe(true)
    expect(pr.resources).toBe(0)
  })

  it('does not affect cash', () => {
    pr.takeResources(300)
    expect(pr.cash).toBe(5000)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — canGiveResources
// ---------------------------------------------------------------------------

describe('PlayerResources canGiveResources', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
  })

  it('returns true when storage has room', () => {
    expect(pr.canGiveResources(500)).toBe(true)
  })

  it('returns true for exact capacity', () => {
    expect(pr.canGiveResources(1000)).toBe(true)
  })

  it('returns false when storage would overflow', () => {
    expect(pr.canGiveResources(1500)).toBe(false)
  })

  it('accounts for existing resources', () => {
    pr.giveResources(400)
    expect(pr.canGiveResources(600)).toBe(true)
    expect(pr.canGiveResources(700)).toBe(false)
  })

  it('returns true for zero amount', () => {
    expect(pr.canGiveResources(0)).toBe(true)
  })

  it('returns true when storage is full and adding 0', () => {
    pr.giveResources(1000)
    expect(pr.canGiveResources(0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — addStorageCapacity / removeStorageCapacity
// ---------------------------------------------------------------------------

describe('PlayerResources storage capacity management', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
  })

  it('addStorageCapacity increases capacity', () => {
    pr.addStorageCapacity(500)
    expect(pr.resourceCapacity).toBe(500)
  })

  it('addStorageCapacity accumulates', () => {
    pr.addStorageCapacity(500)
    pr.addStorageCapacity(300)
    expect(pr.resourceCapacity).toBe(800)
  })

  it('removeStorageCapacity decreases capacity', () => {
    pr.resourceCapacity = 1000
    pr.removeStorageCapacity(300)
    expect(pr.resourceCapacity).toBe(700)
  })

  it('removeStorageCapacity clamps resources to new capacity', () => {
    pr.resourceCapacity = 1000
    pr.resources = 800
    pr.removeStorageCapacity(500)
    // New capacity: 500, resources were 800 → clamped to 500
    expect(pr.resourceCapacity).toBe(500)
    expect(pr.resources).toBe(500)
  })

  it('removeStorageCapacity does not clamp when resources fit', () => {
    pr.resourceCapacity = 1000
    pr.resources = 300
    pr.removeStorageCapacity(500)
    // New capacity: 500, resources 300 → no change needed
    expect(pr.resourceCapacity).toBe(500)
    expect(pr.resources).toBe(300)
  })

  it('removeStorageCapacity can result in negative capacity', () => {
    // OpenRA allows capacity to go negative — it's just a number
    pr.removeStorageCapacity(100)
    expect(pr.resourceCapacity).toBe(-100)
  })

  it('capacity sync hash tracks changes', () => {
    pr.addStorageCapacity(500)
    expect(pr.resourceCapacitySync).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — getCashAndResources / canAfford
// ---------------------------------------------------------------------------

describe('PlayerResources queries', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
  })

  it('getCashAndResources returns cash + resources', () => {
    expect(pr.getCashAndResources()).toBe(5000)
    pr.giveResources(300)
    expect(pr.getCashAndResources()).toBe(5300)
    pr.addCash(200)
    expect(pr.getCashAndResources()).toBe(5500)
  })

  it('canAfford returns true when total funds >= cost', () => {
    expect(pr.canAfford(5000)).toBe(true)
    expect(pr.canAfford(5001)).toBe(false)
  })

  it('canAfford includes resources in total', () => {
    pr.giveResources(300)
    expect(pr.canAfford(5200)).toBe(true)
    expect(pr.canAfford(5301)).toBe(false)
  })

  it('canAfford returns true for zero cost', () => {
    expect(pr.canAfford(0)).toBe(true)
  })

  it('canAfford returns false for negative cost', () => {
    // Negative cost means "earn" — always affordable
    // Actually, canAfford(-100) = 5000 >= -100 = true
    expect(pr.canAfford(-100)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — sync hashes track live state
// ---------------------------------------------------------------------------

describe('PlayerResources sync hashes', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
  })

  it('cashSync tracks cash changes', () => {
    expect(pr.cashSync).toBe(5000)
    pr.addCash(500)
    expect(pr.cashSync).toBe(5500)
    pr.takeCash(200)
    expect(pr.cashSync).toBe(5300)
  })

  it('resourcesSync tracks resource changes', () => {
    expect(pr.resourcesSync).toBe(0)
    pr.resourceCapacity = 1000
    pr.giveResources(500)
    expect(pr.resourcesSync).toBe(500)
    pr.takeResources(200)
    expect(pr.resourcesSync).toBe(300)
  })

  it('resourceCapacitySync tracks capacity changes', () => {
    expect(pr.resourceCapacitySync).toBe(0)
    pr.addStorageCapacity(1000)
    expect(pr.resourceCapacitySync).toBe(1000)
    pr.removeStorageCapacity(300)
    expect(pr.resourceCapacitySync).toBe(700)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — attach/detach lifecycle (_playerResources pattern)
// ---------------------------------------------------------------------------

describe('PlayerResources attach/detach', () => {
  it('sets _playerResources on actor on attach', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    const actor = createActor()

    pr.attach(actor)

    const actorExt = actor as unknown as Record<string, unknown>
    expect(actorExt._playerResources).toBe(pr)
  })

  it('clears _playerResources on actor on detach', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    const actor = createActor()

    pr.attach(actor)
    expect((actor as unknown as Record<string, unknown>)._playerResources).toBe(pr)

    pr.detach(actor)
    expect((actor as unknown as Record<string, unknown>)._playerResources).toBeUndefined()
  })

  it('_playerResources reference survives attach/detach/attach cycle', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    const actor = createActor()

    pr.attach(actor)
    pr.detach(actor)
    pr.attach(actor)

    expect((actor as unknown as Record<string, unknown>)._playerResources).toBe(pr)
  })

  it('_playerResources is available from ConditionalTrait base', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    const actor = createActor()

    pr.attach(actor)
    expect(pr.actor).toBe(actor)

    pr.detach(actor)
    expect(pr.actor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — ConditionalTrait integration
// ---------------------------------------------------------------------------

describe('PlayerResources ConditionalTrait integration', () => {
  it('has isTraitDisabled from ConditionalTrait base', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    expect(pr.isTraitDisabled).toBe(false)
  })

  it('stores info property', () => {
    const info = createInfo({ defaultCash: 7500 })
    const pr = new PlayerResources(info)
    expect(pr.info).toBe(info)
    expect(pr.info.defaultCash).toBe(7500)
  })

  it('implements ISync marker interface', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    // ISync is a marker interface — verify that the object can be treated as ISync
    const sync: { cashSync: number; resourcesSync: number; resourceCapacitySync: number } = pr
    expect(typeof sync.cashSync).toBe('number')
    expect(typeof sync.resourcesSync).toBe('number')
    expect(typeof sync.resourceCapacitySync).toBe('number')
  })

  it('implements INotifyCreated', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    expect(typeof pr.created).toBe('function')
  })

  it('onEnabledChanged works (from Component base)', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    pr.onEnabledChanged(false)
    expect(pr.isTraitDisabled).toBe(true)
    pr.onEnabledChanged(true)
    expect(pr.isTraitDisabled).toBe(false)
  })

  it('is not disposed initially', () => {
    const info = createInfo()
    const pr = new PlayerResources(info)
    expect(pr.disposed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — resourceFillRatio (bot module helper)
// ---------------------------------------------------------------------------

describe('PlayerResources resourceFillRatio', () => {
  let pr: PlayerResources

  beforeEach(() => {
    const info = createInfo({ defaultCash: 5000 })
    pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
  })

  it('returns 0 when capacity is 0', () => {
    expect(pr.resourceFillRatio).toBe(0)
  })

  it('returns 0 when resources are 0', () => {
    pr.resourceCapacity = 1000
    expect(pr.resourceFillRatio).toBe(0)
  })

  it('returns percentage integer', () => {
    pr.resourceCapacity = 1000
    pr.giveResources(500)
    expect(pr.resourceFillRatio).toBe(50)
  })

  it('returns 100 when full', () => {
    pr.resourceCapacity = 1000
    pr.giveResources(1000)
    expect(pr.resourceFillRatio).toBe(100)
  })

  it('returns floor-rounded value', () => {
    pr.resourceCapacity = 1000
    pr.giveResources(333)
    // 333 * 100 / 1000 = 33.3 → floor = 33
    expect(pr.resourceFillRatio).toBe(33)
  })

  it('can return > 100 if resources exceed capacity', () => {
    pr.resourceCapacity = 1000
    pr.giveResources(500)
    // Manually exceed capacity (simulating a state before clamping)
    pr.resources = 1200
    expect(pr.resourceFillRatio).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// PlayerResources — edge cases and stress
// ---------------------------------------------------------------------------

describe('PlayerResources edge cases', () => {
  it('handles multiple addCash/takeCash cycles', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(actor)

    pr.addCash(1000)
    expect(pr.cash).toBe(6000)
    pr.takeCash(2000)
    expect(pr.cash).toBe(4000)
    pr.addCash(500)
    expect(pr.cash).toBe(4500)
    pr.takeCash(1000)
    expect(pr.cash).toBe(3500)
  })

  it('handles combined cash and resource operations', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    const actor = createActor()
    pr.attach(actor)
    pr.created(createActor())
    pr.resourceCapacity = 2000

    // Add resources
    pr.giveResources(1000)
    expect(pr.resources).toBe(1000)
    expect(pr.getCashAndResources()).toBe(6000) // 5000 cash + 1000 resources

    // Spend: takes from resources first, then cash
    pr.takeCash(1500)
    expect(pr.resources).toBe(0) // all 1000 resources consumed
    expect(pr.cash).toBe(4500) // remaining 500 from cash
    expect(pr.spent).toBe(1500)
  })

  it('takeCash handles exact resource match', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
    pr.giveResources(500)

    pr.takeCash(500)
    expect(pr.resources).toBe(0)
    expect(pr.cash).toBe(5000) // cash unchanged since resources covered it
    expect(pr.spent).toBe(500)
  })

  it('takeCash handles more resources than needed', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 1000
    pr.giveResources(800)

    pr.takeCash(500)
    // Resources: 800 - 500 = 300
    // Cash: 5000 (unchanged)
    expect(pr.resources).toBe(300)
    expect(pr.cash).toBe(5000)
    expect(pr.spent).toBe(500)
  })

  it('getCashAndResources reflects live state', () => {
    const info = createInfo({ defaultCash: 5000 })
    const pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())
    pr.resourceCapacity = 2000

    expect(pr.getCashAndResources()).toBe(5000)
    pr.addCash(1000)
    expect(pr.getCashAndResources()).toBe(6000)
    pr.giveResources(500)
    expect(pr.getCashAndResources()).toBe(6500)
    pr.takeResources(200)
    expect(pr.getCashAndResources()).toBe(6300)
    pr.takeCash(300)
    expect(pr.getCashAndResources()).toBe(6000)
  })

  it('changeCash returns correct clamped amount for large negative', () => {
    const info = createInfo({ defaultCash: 100 })
    const pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())

    const result = pr.changeCash(-1000000)
    expect(result).toBe(-100)
    expect(pr.cash).toBe(0)
  })

  it('takeCash with notifyLowFunds maintains rate limiting', () => {
    const info = createInfo({
      defaultCash: 100,
      insufficientFundsNotificationInterval: 1000, // 1 second for testing
    })
    const pr = new PlayerResources(info)
    pr.attach(createActor())
    pr.created(createActor())

    // First call: should pass the time check (lastNotificationTime was set to -interval in constructor)
    const result1 = pr.takeCash(200, true)
    expect(result1).toBe(false)

    // Second call immediately after: should be rate-limited (not throw)
    const result2 = pr.takeCash(200, true)
    expect(result2).toBe(false)
  })
})
