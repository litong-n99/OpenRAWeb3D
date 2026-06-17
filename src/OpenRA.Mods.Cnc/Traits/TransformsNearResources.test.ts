/**
 * TransformsNearResources.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import {
  TransformsNearResources,
  TransformsNearResourcesInfo,
} from './TransformsNearResources.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

describe('TransformsNearResources', () => {
  function makeActor(resourceAt: (pos: CPos) => { type: string | null; density: number }): any {
    const resourceLayer = { getResource: resourceAt }
    return {
      location: new CPos(10, 10),
      world: {
        worldActor: {
          traitsImplementing: () => [resourceLayer],
        },
        sharedRandom: {
          nextInt: (max: number) => 0, // Always returns 0
        },
      },
    }
  }

  it('should initialize with delay from range', () => {
    const info = new TransformsNearResourcesInfo({
      type: 'Ore',
      delay: [1000, 3000],
    })
    // With rng.nextInt returning 0, delay = 1000
    const trait = new TransformsNearResources(makeActor(() => ({ type: null, density: 0 })), info)
    expect(trait.delay).toBe(1000)
  })

  it('should count adjacent resource cells matching criteria', () => {
    const info = new TransformsNearResourcesInfo({
      type: 'Ore',
      density: 1,
      adjacency: 1,
      delay: [10, 10],
    })
    const trait = new TransformsNearResources(
      makeActor((pos) => ({
        type: pos.X === 11 && pos.Y === 10 ? 'Ore' : null,
        density: pos.X === 11 && pos.Y === 10 ? 2 : 0,
      })),
      info,
    )
    trait.setDelay(0)
    const actor = makeActor(() => ({ type: 'Ore', density: 2 }))
    actor.queueActivity = vi.fn()
    trait.tick(actor)
    expect(trait.delay).toBe(-1) // Delay decremented
    expect(actor.queueActivity).toHaveBeenCalled()
  })

  it('should not count cells with wrong resource type', () => {
    const info = new TransformsNearResourcesInfo({
      type: 'Ore',
      density: 1,
      adjacency: 2,
      delay: [10, 10],
    })
    const trait = new TransformsNearResources(makeActor(() => ({ type: 'Gems', density: 2 })), info)
    trait.setDelay(0)
    const actor = makeActor(() => ({ type: 'Ore', density: 2 }))
    actor.queueActivity = vi.fn()
    trait.tick(actor)
    // No match — delay unchanged (but already 0 when set... should still not go below 0)
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })

  it('should not transform when delay is negative', () => {
    const info = new TransformsNearResourcesInfo({ type: 'Ore' })
    const trait = new TransformsNearResources(makeActor(() => ({ type: null, density: 0 })), info)
    trait.setDelay(-1)
    const actor = makeActor(() => ({ type: 'Ore', density: 2 }))
    actor.queueActivity = vi.fn()
    trait.tick(actor)
    expect(actor.queueActivity).not.toHaveBeenCalled()
  })
})
