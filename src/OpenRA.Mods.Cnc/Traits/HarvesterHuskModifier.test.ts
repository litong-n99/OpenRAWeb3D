/**
 * HarvesterHuskModifier.test.ts — Unit tests
 */

import { describe, it, expect } from 'vitest'
import { HarvesterHuskModifier, HarvesterHuskModifierInfo } from './HarvesterHuskModifier.js'

describe('HarvesterHuskModifier', () => {
  it('should create with default values', () => {
    const info = new HarvesterHuskModifierInfo()
    expect(info.fullnessThreshold).toBe(50)
    expect(info.fullHuskActor).toBeNull()
  })

  it('should return null when fullness is below threshold', () => {
    const info = new HarvesterHuskModifierInfo({ fullHuskActor: 'huskfull', fullnessThreshold: 50 })
    const trait = new HarvesterHuskModifier(info)
    const actor = { _harvester: { fullness: 30 } } as any
    expect(trait.huskActor(actor)).toBeNull()
  })

  it('should return full husk actor when fullness exceeds threshold', () => {
    const info = new HarvesterHuskModifierInfo({ fullHuskActor: 'huskfull', fullnessThreshold: 50 })
    const trait = new HarvesterHuskModifier(info)
    const actor = { _harvester: { fullness: 75 } } as any
    expect(trait.huskActor(actor)).toBe('huskfull')
  })

  it('should check direct fullness property as fallback', () => {
    const info = new HarvesterHuskModifierInfo({ fullHuskActor: 'huskfull', fullnessThreshold: 50 })
    const trait = new HarvesterHuskModifier(info)
    const actor = { fullness: 80 } as any
    expect(trait.huskActor(actor)).toBe('huskfull')
  })
})
