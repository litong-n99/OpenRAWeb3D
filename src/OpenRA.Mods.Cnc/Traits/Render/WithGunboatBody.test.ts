/**
 * WithGunboatBody.test.ts — Unit tests
 *
 * Tests focus on: left/right facing toggle, wake animation, turret resolution.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithGunboatBody,
  WithGunboatBodyInfo,
  type IGunboatFacing,
  type IGunboatTurreted,
  type IGunboatAnimation,
} from './WithGunboatBody.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

function makeTurreted(name: string): IGunboatTurreted {
  return {
    name,
    worldOrientation: { yaw: WAngle.Zero },
    quantizedFacings: 8,
  }
}

function makeFacing(angle: number): IGunboatFacing {
  return { facing: new WAngle(angle) }
}

function makeBodyAnimation(replaceCalls?: string[]): IGunboatAnimation {
  const _replaceCalls: string[] = replaceCalls ?? []
  return {
    name: 'gunboat',
    currentSequence: { name: 'idle', facings: 8 },
    playFetchIndex() {},
    playRepeating() {},
    replaceAnim(seq: string) { _replaceCalls.push(seq) },
    hasSequence() { return true },
  }
}

function makeActor(turrets: IGunboatTurreted[], facing: IGunboatFacing): IGameActor {
  return {
    trait(name: string): unknown {
      if (name === 'IFacing') return facing
      if (name === 'RenderSprites') return {
        getImage: () => 'gunboat-image',
        add: vi.fn(),
      }
      return null
    },
    traitsImplementing(name: string): unknown[] {
      if (name === 'Turreted') return turrets
      return []
    },
  } as unknown as IGameActor
}

describe('WithGunboatBodyInfo', () => {
  it('should have default values', () => {
    const info = new WithGunboatBodyInfo()
    expect(info.turret).toBe('primary')
    expect(info.leftSequence).toBe('left')
    expect(info.rightSequence).toBe('right')
    expect(info.wakeLeftSequence).toBe('wake-left')
    expect(info.wakeRightSequence).toBe('wake-right')
  })
})

describe('WithGunboatBody', () => {
  it('should throw if no matching Turreted found', () => {
    const turreted = makeTurreted('other')
    const facing = makeFacing(0)
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo({ turret: 'primary' })
    expect(() => new WithGunboatBody(actor, info)).toThrow()
  })

  it('should find turret by name', () => {
    const turret1 = makeTurreted('primary')
    const turret2 = makeTurreted('secondary')
    const facing = makeFacing(0)
    const actor = makeActor([turret1, turret2], facing)
    const info = new WithGunboatBodyInfo({ turret: 'primary' })
    const body = new WithGunboatBody(actor, info)
    expect(body.turret).toBe(turret1)
  })

  it('should use right-facing sequence when angle <= 512', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(256) // Right side
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    const replaceCalls: string[] = []
    const anim = makeBodyAnimation(replaceCalls)
    ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

    body.tick({} as unknown as IGameActor)
    expect(replaceCalls.some((c) => c.includes('right'))).toBe(true)
  })

  it('should use left-facing sequence when angle > 512', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(768) // Left side
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    const replaceCalls: string[] = []
    const anim = makeBodyAnimation(replaceCalls)
    ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

    body.tick({} as unknown as IGameActor)
    expect(replaceCalls.some((c) => c.includes('left'))).toBe(true)
  })

  it('should update quantizedFacings on traitEnabled', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(0)
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    const anim = makeBodyAnimation()
    ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

    body.traitEnabled({} as unknown as IGameActor)
    expect(turreted.quantizedFacings).toBe(8)
  })

  it('should dispose cleanly', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(0)
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    expect(() => body.dispose()).not.toThrow()
  })
})
