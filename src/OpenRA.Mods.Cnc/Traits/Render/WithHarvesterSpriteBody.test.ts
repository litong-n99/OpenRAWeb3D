/**
 * WithHarvesterSpriteBody.test.ts — Unit tests for WithHarvesterSpriteBody
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: fullness-to-image mapping, state transitions, edge cases.
 */

import { describe, it, expect } from 'vitest'
import {
  WithHarvesterSpriteBody,
  WithHarvesterSpriteBodyInfo,
  type IFacingSpriteBody,
  type IHarvesterAccess,
} from './WithHarvesterSpriteBody.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBody(fullness: number, imageByFullness: readonly string[]): {
  body: WithHarvesterSpriteBody
  harvesterAccess: IHarvesterAccess
  animState: { currentImage: string; currentSequence: string }
} {
  const animState = { currentImage: '', currentSequence: '' }
  const harvesterAccess: IHarvesterAccess = { fullness }

  const bodyStub = {
    info: { name: 'body', enabledByDefault: true },
    defaultAnimation: {
      currentSequence: { name: 'idle' },
      changeImage(image: string, sequence: string) {
        animState.currentImage = image
        animState.currentSequence = sequence
      },
    },
  } as IFacingSpriteBody

  const actorStub = {
    trait(name: string): unknown {
      if (name === 'Harvester') return { fullness }
      return bodyStub
    },
  } as unknown as IGameActor

  const info = new WithHarvesterSpriteBodyInfo({ imageByFullness })
  const body = new WithHarvesterSpriteBody(actorStub, info)
  // Override internal references for testing
  ;(body as any)._body = bodyStub
  ;(body as any)._harvester = harvesterAccess

  return { body, harvesterAccess, animState }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithHarvesterSpriteBodyInfo', () => {
  it('should have sensible defaults', () => {
    const info = new WithHarvesterSpriteBodyInfo()
    expect(info.imageByFullness).toEqual([])
    expect(info.enabledByDefault).toBe(true)
  })

  it('should accept custom imageByFullness', () => {
    const images = ['harv-empty', 'harv-half', 'harv-full']
    const info = new WithHarvesterSpriteBodyInfo({ imageByFullness: images })
    expect(info.imageByFullness).toEqual(images)
  })

  it('should create trait via factory method', () => {
    const info = new WithHarvesterSpriteBodyInfo({
      imageByFullness: ['a', 'b'],
    })
    const actor = { trait: () => ({ fullness: 50 }) } as unknown as IGameActor
    const body = info.create(actor)
    expect(body).toBeInstanceOf(WithHarvesterSpriteBody)
  })
})

describe('WithHarvesterSpriteBody', () => {
  it('should not crash when Harvester trait is absent', () => {
    const { body } = makeBody(50, ['empty', 'full'])
    const actor = {} as IGameActor
    ;(body as any)._harvester = null
    expect(() => body.tick(actor)).not.toThrow()
  })

  it('should do nothing when imageByFullness is empty', () => {
    const { body, animState } = makeBody(50, [])
    body.tick({} as IGameActor)
    expect(animState.currentImage).toBe('')
  })

  it('should select first image when fullness is 0', () => {
    const { body, animState } = makeBody(0, ['empty', 'half', 'full'])
    body.tick({} as IGameActor)
    expect(animState.currentImage).toBe('empty')
  })

  it('should select last image when fullness is 100', () => {
    const { body, animState } = makeBody(100, ['empty', 'half', 'full'])
    body.tick({} as IGameActor)
    expect(animState.currentImage).toBe('full')
  })

  it('should select middle image when fullness is 50 (3-image array)', () => {
    const { body, animState } = makeBody(50, ['e', 'h', 'f'])
    body.tick({} as IGameActor)
    // desiredState = 50 * (3-1) / 100 = 1 => middle image
    expect(animState.currentImage).toBe('h')
  })

  it('should map fullness proportionally (2-image array)', () => {
    const images = ['low', 'high']
    // fullness 0 -> 0 * 1 / 100 = 0 -> images[0] = 'low'
    {
      const { body, animState } = makeBody(0, images)
      body.tick({} as IGameActor)
      expect(animState.currentImage).toBe('low')
    }
    // fullness 100 -> 100 * 1 / 100 = 1 -> images[1] = 'high'
    {
      const { body: b2, animState: s2 } = makeBody(100, images)
      b2.tick({} as IGameActor)
      expect(s2.currentImage).toBe('high')
    }
  })

  it('should map fullness 100 to high with 2-image array', () => {
    const { body, animState } = makeBody(100, ['low', 'high'])
    body.tick({} as IGameActor)
    expect(animState.currentImage).toBe('high')
  })

  it('should update animation sequence on tick', () => {
    const { body, animState } = makeBody(0, ['a', 'b', 'c'])
    body.tick({} as IGameActor)
    expect(animState.currentSequence).toBe('idle')
  })

  it("should handle single-image array (fullness doesn't matter)", () => {
    const { body, animState } = makeBody(75, ['only'])
    body.tick({} as IGameActor)
    expect(animState.currentImage).toBe('only')
  })

  it('should dispose cleanly', () => {
    const { body } = makeBody(50, ['a', 'b'])
    expect(() => body.dispose()).not.toThrow()
  })
})
