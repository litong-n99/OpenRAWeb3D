/**
 * WithResourceAnimation.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import {
  WithResourceAnimation,
  WithResourceAnimationInfo,
} from './WithResourceAnimation.js'

describe('WithResourceAnimation', () => {
  function makeWorldActor(): any {
    return {
      world: { localRandom: { nextInt: (max: number) => 0 } },
    }
  }

  it('should initialize with default parameters', () => {
    const info = new WithResourceAnimationInfo()
    expect(info.image).toBe('')
    expect(info.sequences).toEqual(['idle'])
    expect(info.interval).toEqual([200, 500])
    expect(info.ratio).toEqual([1, 10])
  })

  it('should set initial tick interval', () => {
    const trait = new WithResourceAnimation(makeWorldActor(), new WithResourceAnimationInfo({ interval: [10, 10] }))
    expect(trait.ticks).toBe(10)
  })

  it('should count down ticks each tick', () => {
    const trait = new WithResourceAnimation(makeWorldActor(), new WithResourceAnimationInfo({ interval: [5, 5] }))
    expect(trait.ticks).toBe(5)
    trait.tick(makeWorldActor())
    expect(trait.ticks).toBe(4)
  })

  it('should have empty pending spawns initially', () => {
    const trait = new WithResourceAnimation(makeWorldActor(), new WithResourceAnimationInfo())
    expect(trait.pendingSpawns.length).toBe(0)
  })

  it('should clear pending spawns', () => {
    const trait = new WithResourceAnimation(makeWorldActor(), new WithResourceAnimationInfo())
    // Manually add one
    ;(trait as any)._pendingSpawns = [{ position: {}, image: 'a', sequence: 'b', palette: 'c' }]
    expect(trait.pendingSpawns.length).toBe(1)
    trait.clearPendingSpawns()
    expect(trait.pendingSpawns.length).toBe(0)
  })
})
