/**
 * ResourcePurifier.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { ResourcePurifier, ResourcePurifierInfo } from './ResourcePurifier.js'

describe('ResourcePurifier', () => {
  it('should initialize with default values', () => {
    const info = new ResourcePurifierInfo()
    expect(info.modifier).toBe(0)
    expect(info.showTicks).toBe(true)
    expect(info.tickRate).toBe(10)
    expect(info.tickLifetime).toBe(30)
  })

  it('should accumulate display value on resource accepted', () => {
    const info = new ResourcePurifierInfo({ modifier: 20, showTicks: true })
    const trait = new ResourcePurifier(info)
    // Simulate player resources
    const giveCash = vi.fn()
    const actor: any = {
      owner: { playerActor: { getPlayerResources: () => ({ giveCash }) } },
    }
    trait.onOwnerChanged(actor)
    trait.onResourceAccepted(actor, {} as any, 'Ore', 100, 1000)
    // 1000 * 20 / 100 = 200 extra cash
    expect(giveCash).toHaveBeenCalledWith(200)
    expect(trait.currentDisplayValue).toBe(200)
  })

  it('should not accumulate when trait is disabled', () => {
    const info = new ResourcePurifierInfo({ modifier: 20 })
    const trait = new ResourcePurifier(info)
    // ConditionalTrait._enabled = false makes isTraitDisabled return true
    ;(trait as any)._enabled = false
    const giveCash = vi.fn()
    const actor: any = {
      owner: { playerActor: { getPlayerResources: () => ({ giveCash }) } },
    }
    trait.onOwnerChanged(actor)
    trait.onResourceAccepted(actor, {} as any, 'Ore', 100, 1000)
    expect(giveCash).not.toHaveBeenCalled()
    expect(trait.currentDisplayValue).toBe(0)
  })

  it('should reset display on tick rate countdown', () => {
    const info = new ResourcePurifierInfo({ modifier: 50, showTicks: true, tickRate: 2 })
    const trait = new ResourcePurifier(info)
    const actor: any = {
      owner: { playerActor: { getPlayerResources: () => ({ giveCash: vi.fn() }) } },
    }
    trait.onOwnerChanged(actor)
    trait.onResourceAccepted(actor, {} as any, 'Ore', 100, 1000)
    // display value = 500
    trait.tick(actor) // tickRate = 2, goes to 1
    expect(trait.currentDisplayValue).toBe(500)
    trait.tick(actor) // tickRate goes to 0, resets
    expect(trait.currentDisplayValue).toBe(0)
  })
})
