/**
 * WithLandingCraftAnimation.test.ts — Unit tests
 *
 * Tests focus on: open/close state transitions, terrain detection, animation calls.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithLandingCraftAnimation,
  WithLandingCraftAnimationInfo,
  MovementType,
  type ILandingCraftSpriteBody,
  type ILandingCraftMove,
  type ILandingCraftCargo,
  type ILandingCraftMap,
} from './WithLandingCraftAnimation.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeBody(name: string): ILandingCraftSpriteBody & { callLog: string[] } {
  const callLog: string[] = []
  return {
    info: { name },
    defaultAnimation: {
      name: 'test',
      currentSequence: { name: '' },
      hasSequence: vi.fn().mockReturnValue(true),
      replaceAnim() {},
    },
    playCustomAnimation(_self, sequence, onComplete?) {
      callLog.push(`custom:${sequence}`)
      if (onComplete) onComplete()
    },
    playCustomAnimationRepeating(_self, sequence) {
      callLog.push(`repeating:${sequence}`)
    },
    callLog,
  }
}

function makeActor(
  _bodyName: string,
  bodies: ILandingCraftSpriteBody[],
  terrainTypes: string[] = ['Clear'],
): IGameActor {
  const move: ILandingCraftMove = { currentMovementTypes: MovementType.None }
  const cargo: ILandingCraftCargo = {
    currentAdjacentCells() {
      return [{ x: 0, y: 0 }]
    },
  }
  const map: ILandingCraftMap = {
    contains: () => true,
    distanceAboveTerrain: () => ({ length: 0 }),
    getTerrainInfo: () => ({ type: terrainTypes[0]! }),
  }

  return {
    trait(name: string): unknown {
      if (name === 'Cargo') return cargo
      if (name === 'IMove') return move
      return null
    },
    traitsImplementing(name: string): unknown[] {
      if (name === 'WithSpriteBody') return bodies
      return []
    },
    world: { map },
    centerPosition: { x: 0, y: 0, z: 0 },
  } as unknown as IGameActor
}

describe('WithLandingCraftAnimationInfo', () => {
  it('should have default values', () => {
    const info = new WithLandingCraftAnimationInfo()
    expect(info.openSequence).toBe('open')
    expect(info.closeSequence).toBe('close')
    expect(info.unloadSequence).toBe('unload')
    expect(info.body).toBe('body')
    expect(info.openTerrainTypes.has('Clear')).toBe(true)
  })
})

describe('WithLandingCraftAnimation', () => {
  it('should throw if no matching WithSpriteBody', () => {
    const body = makeBody('other')
    const actor = makeActor('body', [body])
    const info = new WithLandingCraftAnimationInfo({ body: 'nonexistent' })
    expect(() => new WithLandingCraftAnimation(actor, info)).toThrow()
  })

  it('should start closed', () => {
    const body = makeBody('body')
    const actor = makeActor('body', [body])
    const info = new WithLandingCraftAnimationInfo()
    const anim = new WithLandingCraftAnimation(actor, info)
    expect(anim.isOpen).toBe(false)
  })

  it('should open when near valid terrain', () => {
    const body = makeBody('body')
    const actor = makeActor('body', [body], ['Clear'])
    const info = new WithLandingCraftAnimationInfo()
    const anim = new WithLandingCraftAnimation(actor, info)

    anim.tick({} as IGameActor)
    expect(anim.isOpen).toBe(true)
  })

  it('should not open when moving', () => {
    const body = makeBody('body')
    const actor = makeActor('body', [body], ['Clear'])
    // Override move state
    ;(actor as any).trait = () => ({ currentMovementTypes: MovementType.Horizontal })
    const info = new WithLandingCraftAnimationInfo()
    const anim = new WithLandingCraftAnimation(actor, info)

    anim.tick({} as IGameActor)
    expect(anim.isOpen).toBe(false)
  })

  it('should close when shouldBeOpen returns false', () => {
    const body = makeBody('body')
    const actor = makeActor('body', [body])
    const info = new WithLandingCraftAnimationInfo()
    const anim = new WithLandingCraftAnimation(actor, info)

    anim.setOpen(true)
    // Override close logic check
    ;(anim as any).shouldBeOpen = () => false
    anim.tick({} as IGameActor)
    expect(anim.isOpen).toBe(false)
  })

  it('should play custom animation on open', () => {
    const body = makeBody('body')
    const actor = makeActor('body', [body], ['Clear'])
    const info = new WithLandingCraftAnimationInfo()
    const anim = new WithLandingCraftAnimation(actor, info)

    anim.tick({} as IGameActor)
    expect(body.callLog.some((c) => c.includes('custom:open'))).toBe(true)
  })

  it('should dispose cleanly', () => {
    const body = makeBody('body')
    const actor = makeActor('body', [body])
    const info = new WithLandingCraftAnimationInfo()
    const anim = new WithLandingCraftAnimation(actor, info)
    expect(() => anim.dispose()).not.toThrow()
  })
})
