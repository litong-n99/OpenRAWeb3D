/**
 * StoresResources.test.ts — StoresResources migration unit tests
 *
 * Tests focus on:
 * - StoresResourcesInfo defaults (capacity=28, resources=[])
 * - hasType: known vs unknown resource types
 * - addResource: within capacity, overflow, unknown type
 * - removeResource: within stored, underflow, unknown type
 * - contentsSum tracking through add/remove cycles
 * - contents Map live view behavior
 * - contentHash matches OpenRA algorithm
 * - Multiple resource types tracked independently
 * - Shared capacity limit across all types
 * - ConditionalTrait integration (isTraitDisabled)
 */

import { describe, it, expect } from 'vitest'
import { StoresResources, StoresResourcesInfo } from './StoresResources'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a StoresResourcesInfo with explicit defaults for testing. */
function createInfo(overrides: Partial<StoresResourcesInfo> = {}): StoresResourcesInfo {
  return new StoresResourcesInfo(overrides)
}

// ---------------------------------------------------------------------------
// StoresResourcesInfo defaults
// ---------------------------------------------------------------------------

describe('StoresResourcesInfo', () => {
  it('defaults capacity to 28', () => {
    const info = createInfo()
    expect(info.capacity).toBe(28)
  })

  it('defaults resources to empty array', () => {
    const info = createInfo()
    expect(info.resources).toEqual([])
  })

  it('resourceTypes getter matches resources', () => {
    const info = createInfo({ resources: ['Ore', 'Tiberium'] })
    expect(info.resourceTypes).toEqual(['Ore', 'Tiberium'])
  })

  it('resourceTypes is a live reference to resources', () => {
    const info = createInfo({ resources: ['Ore'] })
    expect(info.resourceTypes).toEqual(['Ore'])
  })

  it('accepts custom capacity', () => {
    const info = createInfo({ capacity: 100 })
    expect(info.capacity).toBe(100)
  })

  it('accepts custom resources list', () => {
    const info = createInfo({ resources: ['Tiberium', 'Spice', 'Gems'] })
    expect(info.resources).toEqual(['Tiberium', 'Spice', 'Gems'])
  })

  it('accepts requiresCondition', () => {
    const info = createInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })

  it('accepts instanceName', () => {
    const info = createInfo({ instanceName: 'cargo' })
    expect(info.instanceName).toBe('cargo')
  })

  it('implements ConditionalTraitInfo', () => {
    const info = createInfo({ requiresCondition: 'building' })
    expect(info.requiresCondition).toBe('building')
    // ConditionalTraitInfo extends ITraitInfo which has instanceName
    expect('instanceName' in info).toBe(true)
  })

  it('implements IStoresResourcesInfo', () => {
    const info = createInfo()
    expect(info.resourceTypes).toBeDefined()
    expect(Array.isArray(info.resourceTypes)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// StoresResources construction + hasType
// ---------------------------------------------------------------------------

describe('StoresResources construction and hasType', () => {
  it('initializes known resource types to 0 in contents map', () => {
    const info = createInfo({ resources: ['Ore', 'Tiberium'], capacity: 50 })
    const trait = new StoresResources(info)

    expect(trait.contents.get('Ore')).toBe(0)
    expect(trait.contents.get('Tiberium')).toBe(0)
    expect(trait.contentsSum).toBe(0)
  })

  it('hasType returns true for known resource types', () => {
    const info = createInfo({ resources: ['Ore', 'Tiberium', 'Gems'] })
    const trait = new StoresResources(info)

    expect(trait.hasType('Ore')).toBe(true)
    expect(trait.hasType('Tiberium')).toBe(true)
    expect(trait.hasType('Gems')).toBe(true)
  })

  it('hasType returns false for unknown resource types', () => {
    const info = createInfo({ resources: ['Ore'] })
    const trait = new StoresResources(info)

    expect(trait.hasType('Tiberium')).toBe(false)
    expect(trait.hasType('Spice')).toBe(false)
    expect(trait.hasType('')).toBe(false)
  })

  it('hasType returns false for all types when resources is empty', () => {
    const info = createInfo({ resources: [] })
    const trait = new StoresResources(info)

    expect(trait.hasType('Ore')).toBe(false)
    expect(trait.hasType('Anything')).toBe(false)
  })

  it('capacity exposes info.capacity', () => {
    const info = createInfo({ capacity: 100 })
    const trait = new StoresResources(info)

    expect(trait.capacity).toBe(100)
  })

  it('starts with isTraitDisabled as false', () => {
    const info = createInfo()
    const trait = new StoresResources(info)

    expect(trait.isTraitDisabled).toBe(false)
  })

  it('extends ConditionalTrait', () => {
    const info = createInfo({ requiresCondition: 'building' })
    const trait = new StoresResources(info)

    expect(trait.isTraitDisabled).toBe(false)
    expect(trait.info).toBe(info)
  })

  it('implements ISync', () => {
    const info = createInfo()
    const trait = new StoresResources(info)

    // ISync is a marker interface — contentHash is the sync data
    expect(typeof trait.contentHash).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// StoresResources — addResource
// ---------------------------------------------------------------------------

describe('StoresResources addResource', () => {
  let trait: StoresResources
  let info: StoresResourcesInfo

  beforeEach(() => {
    info = createInfo({ resources: ['Ore', 'Tiberium'], capacity: 50 })
    trait = new StoresResources(info)
  })

  it('adds resources within capacity, returns 0 overflow', () => {
    const overflow = trait.addResource('Ore', 10)
    expect(overflow).toBe(0)
    expect(trait.contents.get('Ore')).toBe(10)
    expect(trait.contentsSum).toBe(10)
  })

  it('adds multiple batches within capacity', () => {
    trait.addResource('Ore', 10)
    trait.addResource('Ore', 15)
    trait.addResource('Tiberium', 5)

    expect(trait.contents.get('Ore')).toBe(25)
    expect(trait.contents.get('Tiberium')).toBe(5)
    expect(trait.contentsSum).toBe(30)
  })

  it('returns overflow when capacity is exceeded', () => {
    trait.addResource('Ore', 40) // 40 in, 10 remaining capacity

    const overflow = trait.addResource('Ore', 20) // tries to add 20, only 10 fits
    expect(overflow).toBe(10) // 20 - 10 = 10 overflow
    expect(trait.contents.get('Ore')).toBe(50)
    expect(trait.contentsSum).toBe(50)
  })

  it('returns full value when adding beyond full capacity', () => {
    trait.addResource('Ore', 50) // fills to capacity

    const overflow = trait.addResource('Tiberium', 10)
    expect(overflow).toBe(10) // nothing added, all overflowed
    expect(trait.contents.get('Tiberium')).toBe(0) // unchanged
    expect(trait.contentsSum).toBe(50)
  })

  it('returns full value as overflow for unknown resource type', () => {
    const overflow = trait.addResource('Spice', 10)
    expect(overflow).toBe(10)
    expect(trait.contentsSum).toBe(0) // nothing stored
    expect(trait.contents.has('Spice')).toBe(false)
  })

  it('shared capacity across all resource types', () => {
    trait.addResource('Ore', 30) // 30 / 50
    trait.addResource('Tiberium', 10) // 40 / 50

    const overflow = trait.addResource('Ore', 20) // tries 20, only 10 fits
    expect(overflow).toBe(10)
    expect(trait.contents.get('Ore')).toBe(40)
    expect(trait.contents.get('Tiberium')).toBe(10)
    expect(trait.contentsSum).toBe(50)
  })

  it('handles zero value add (no-op)', () => {
    const overflow = trait.addResource('Ore', 0)
    expect(overflow).toBe(0)
    expect(trait.contents.get('Ore')).toBe(0)
    expect(trait.contentsSum).toBe(0)
  })

  it('handles exact capacity fill', () => {
    const overflow = trait.addResource('Ore', 50)
    expect(overflow).toBe(0)
    expect(trait.contents.get('Ore')).toBe(50)
    expect(trait.contentsSum).toBe(50)
  })

  it('handles partial fill when remaining capacity is positive but less than value', () => {
    trait.addResource('Ore', 45) // 45 / 50
    const overflow = trait.addResource('Tiberium', 10) // tries 10, only 5 fits
    expect(overflow).toBe(5)
    expect(trait.contents.get('Tiberium')).toBe(5)
    expect(trait.contentsSum).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// StoresResources — removeResource
// ---------------------------------------------------------------------------

describe('StoresResources removeResource', () => {
  let trait: StoresResources
  let info: StoresResourcesInfo

  beforeEach(() => {
    info = createInfo({ resources: ['Ore', 'Tiberium'], capacity: 100 })
    trait = new StoresResources(info)
    // Pre-fill: 40 Ore, 30 Tiberium = 70 total
    trait.addResource('Ore', 40)
    trait.addResource('Tiberium', 30)
  })

  it('removes resources within stored amount, returns 0 underflow', () => {
    const underflow = trait.removeResource('Ore', 15)
    expect(underflow).toBe(0)
    expect(trait.contents.get('Ore')).toBe(25)
    expect(trait.contentsSum).toBe(55) // 70 - 15
  })

  it('removes multiple batches', () => {
    trait.removeResource('Ore', 10) // Ore: 30
    trait.removeResource('Tiberium', 5) // Tiberium: 25

    expect(trait.contents.get('Ore')).toBe(30)
    expect(trait.contents.get('Tiberium')).toBe(25)
    expect(trait.contentsSum).toBe(55)
  })

  it('returns underflow when removing more than stored', () => {
    const underflow = trait.removeResource('Ore', 50) // has 40, tries 50
    expect(underflow).toBe(10) // 50 - 40 = 10 underflow
    expect(trait.contents.get('Ore')).toBe(0)
    expect(trait.contentsSum).toBe(30) // only Tiberium remains
  })

  it('returns full value as underflow for unknown resource type', () => {
    const underflow = trait.removeResource('Spice', 10)
    expect(underflow).toBe(10)
    expect(trait.contentsSum).toBe(70) // unchanged
  })

  it('removes exactly the stored amount (zero underflow)', () => {
    const underflow = trait.removeResource('Ore', 40)
    expect(underflow).toBe(0)
    expect(trait.contents.get('Ore')).toBe(0)
    expect(trait.contentsSum).toBe(30)
  })

  it('remove from empty storage returns full value as underflow', () => {
    // Remove all
    trait.removeResource('Ore', 40)
    trait.removeResource('Tiberium', 30)
    expect(trait.contentsSum).toBe(0)

    const underflow = trait.removeResource('Ore', 5)
    expect(underflow).toBe(5)
    expect(trait.contents.get('Ore')).toBe(0)
    expect(trait.contentsSum).toBe(0)
  })

  it('handles zero value remove (no-op)', () => {
    const underflow = trait.removeResource('Ore', 0)
    expect(underflow).toBe(0)
    expect(trait.contents.get('Ore')).toBe(40)
    expect(trait.contentsSum).toBe(70)
  })
})

// ---------------------------------------------------------------------------
// StoresResources — contentsSum tracking
// ---------------------------------------------------------------------------

describe('StoresResources contentsSum tracking', () => {
  it('tracks add and remove across multiple types', () => {
    const info = createInfo({ resources: ['A', 'B', 'C'], capacity: 100 })
    const trait = new StoresResources(info)

    trait.addResource('A', 20)
    expect(trait.contentsSum).toBe(20)

    trait.addResource('B', 30)
    expect(trait.contentsSum).toBe(50)

    trait.removeResource('A', 5)
    expect(trait.contentsSum).toBe(45)

    trait.addResource('C', 10)
    expect(trait.contentsSum).toBe(55)

    trait.removeResource('B', 10)
    expect(trait.contentsSum).toBe(45)
  })

  it('contentsSum never goes negative on underflow remove', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 100 })
    const trait = new StoresResources(info)

    trait.addResource('Ore', 5)
    expect(trait.contentsSum).toBe(5)

    // Remove more than stored
    trait.removeResource('Ore', 20)
    expect(trait.contentsSum).toBe(0)
  })

  it('contentsSum capped at capacity on add overflow', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 50 })
    const trait = new StoresResources(info)

    trait.addResource('Ore', 100)
    expect(trait.contentsSum).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// StoresResources — contents Map live view
// ---------------------------------------------------------------------------

describe('StoresResources contents Map view', () => {
  it('returns a live view of internal storage', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 50 })
    const trait = new StoresResources(info)

    const view1 = trait.contents
    expect(view1.get('Ore')).toBe(0)

    trait.addResource('Ore', 10)

    const view2 = trait.contents
    expect(view2.get('Ore')).toBe(10)
    // Same reference — both views reflect the current state
    expect(view1.get('Ore')).toBe(10)
  })

  it('initial contents map has keys for all configured resource types', () => {
    const info = createInfo({ resources: ['Ore', 'Tiberium', 'Gems'] })
    const trait = new StoresResources(info)

    const contents = trait.contents
    expect(contents.has('Ore')).toBe(true)
    expect(contents.has('Tiberium')).toBe(true)
    expect(contents.has('Gems')).toBe(true)
    expect(contents.has('Spice')).toBe(false)

    expect(contents.size).toBe(3)
  })

  it('contents map size matches resources count', () => {
    const info = createInfo({ resources: ['A', 'B'] })
    const trait = new StoresResources(info)

    expect(trait.contents.size).toBe(2)
  })

  it('empty resources results in empty contents map', () => {
    const info = createInfo({ resources: [] })
    const trait = new StoresResources(info)

    expect(trait.contents.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// StoresResources — contentHash (sync)
// ---------------------------------------------------------------------------

describe('StoresResources contentHash', () => {
  it('returns 0 for empty storage', () => {
    const info = createInfo({ resources: [], capacity: 50 })
    const trait = new StoresResources(info)

    expect(trait.contentHash).toBe(0)
  })

  it('returns 0 when all stored amounts are 0', () => {
    const info = createInfo({ resources: ['Ore', 'Tiberium'], capacity: 50 })
    const trait = new StoresResources(info)

    expect(trait.contentHash).toBe(0)
  })

  it('matches OpenRA algorithm: sum(value << key.length)', () => {
    const info = createInfo({ resources: ['Ore', 'Tiberium'], capacity: 50 })
    const trait = new StoresResources(info)

    trait.addResource('Ore', 5) // 5 << 3 = 5 * 8 = 40
    trait.addResource('Tiberium', 3) // 3 << 8 = 3 * 256 = 768

    // Expected: (5 << 3) + (3 << 8) = 40 + 768 = 808
    expect(trait.contentHash).toBe(808)
  })

  it('updates after add/remove operations', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 50 })
    const trait = new StoresResources(info)

    expect(trait.contentHash).toBe(0)

    trait.addResource('Ore', 10)
    // 10 << 3 = 80
    expect(trait.contentHash).toBe(80)

    trait.removeResource('Ore', 7)
    // 3 << 3 = 24
    expect(trait.contentHash).toBe(24)
  })

  it('handles resource types with different name lengths', () => {
    const info = createInfo({ resources: ['X', 'Short', 'VeryLongName'], capacity: 100 })
    const trait = new StoresResources(info)

    trait.addResource('X', 1) // 1 << 1 = 2
    trait.addResource('Short', 2) // 2 << 5 = 64
    trait.addResource('VeryLongName', 3) // 3 << 12 = 12288

    const expected = (1 << 1) + (2 << 5) + (3 << 12)
    expect(trait.contentHash).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// StoresResources — ConditionalTrait integration
// ---------------------------------------------------------------------------

describe('StoresResources ConditionalTrait integration', () => {
  it('has isTraitDisabled property from ConditionalTrait base', () => {
    const info = createInfo()
    const trait = new StoresResources(info)
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('stores info property from ConditionalTrait base', () => {
    const info = createInfo({ capacity: 99, resources: ['Test'] })
    const trait = new StoresResources(info)
    expect(trait.info).toBe(info)
    expect(trait.info.capacity).toBe(99)
  })

  it('addResource works when trait is disabled (no gating in original OpenRA)', () => {
    // In OpenRA C#, StoresResources does NOT check isTraitDisabled before
    // addResource/removeResource. The ConditionalTrait extension in TS
    // preserves this behavior — resource operations are NOT gated.
    const info = createInfo({ resources: ['Ore'], capacity: 50 })
    const trait = new StoresResources(info)
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const overflow = trait.addResource('Ore', 10)
    expect(overflow).toBe(0)
    expect(trait.contentsSum).toBe(10)
  })

  it('removeResource works when trait is disabled (no gating in original OpenRA)', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 50 })
    const trait = new StoresResources(info)
    trait.addResource('Ore', 10)
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const underflow = trait.removeResource('Ore', 5)
    expect(underflow).toBe(0)
    expect(trait.contentsSum).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// StoresResources — edge cases
// ---------------------------------------------------------------------------

describe('StoresResources edge cases', () => {
  it('capacity of 0 accepts nothing', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 0 })
    const trait = new StoresResources(info)

    const overflow = trait.addResource('Ore', 10)
    expect(overflow).toBe(10)
    expect(trait.contentsSum).toBe(0)
  })

  it('single resource type with full add/remove cycle', () => {
    const info = createInfo({ resources: ['Ore'], capacity: 100 })
    const trait = new StoresResources(info)

    // Add
    expect(trait.addResource('Ore', 60)).toBe(0)
    expect(trait.contentsSum).toBe(60)
    expect(trait.contents.get('Ore')).toBe(60)

    // Add overflow
    expect(trait.addResource('Ore', 60)).toBe(20) // 40 added, 20 overflow
    expect(trait.contentsSum).toBe(100)
    expect(trait.contents.get('Ore')).toBe(100)

    // Remove
    expect(trait.removeResource('Ore', 30)).toBe(0)
    expect(trait.contentsSum).toBe(70)
    expect(trait.contents.get('Ore')).toBe(70)

    // Remove underflow
    expect(trait.removeResource('Ore', 100)).toBe(30) // 70 removed, 30 underflow
    expect(trait.contentsSum).toBe(0)
    expect(trait.contents.get('Ore')).toBe(0)
  })

  it('many resource types share capacity', () => {
    const types = ['A', 'B', 'C', 'D', 'E']
    const info = createInfo({ resources: types, capacity: 25 })
    const trait = new StoresResources(info)

    // Add 5 to each = 25 total (exactly fills capacity)
    for (const t of types) {
      expect(trait.addResource(t, 5)).toBe(0)
    }
    expect(trait.contentsSum).toBe(25)
    for (const t of types) {
      expect(trait.contents.get(t)).toBe(5)
    }

    // One more should overflow
    expect(trait.addResource('A', 1)).toBe(1)
    expect(trait.contentsSum).toBe(25)
  })
})
