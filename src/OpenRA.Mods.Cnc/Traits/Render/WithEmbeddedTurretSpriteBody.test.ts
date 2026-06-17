/**
 * WithEmbeddedTurretSpriteBody.test.ts — Unit tests
 *
 * Tests focus on: turret facing resolution, quantized facings auto-detection.
 */

import { describe, it, expect } from 'vitest'
import {
  WithEmbeddedTurretSpriteBody,
  WithEmbeddedTurretSpriteBodyInfo,
  type IEmbeddedTurreted,
  type IEmbeddedSpriteBody,
  type IEmbeddedAnimation,
} from './WithEmbeddedTurretSpriteBody.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

function makeTurreted(): IEmbeddedTurreted {
  return {
    worldOrientation: { yaw: WAngle.fromDegrees(90) },
    quantizedFacings: 8,
  }
}

function makeBody(anim?: Partial<IEmbeddedAnimation>): IEmbeddedSpriteBody {
  return {
    info: { name: 'body', enabledByDefault: true },
    defaultAnimation: {
      name: 'test',
      currentSequence: { name: 'idle', facings: 8 },
      playFetchIndex() {},
      playRepeating() {},
      ...anim,
    },
  }
}

function makeActor(turreted: IEmbeddedTurreted): IGameActor {
  return {
    traitsImplementing(name: string): unknown[] {
      if (name === 'Turreted') return [turreted]
      return []
    },
  } as unknown as IGameActor
}

describe('WithEmbeddedTurretSpriteBodyInfo', () => {
  it('should have default values', () => {
    const info = new WithEmbeddedTurretSpriteBodyInfo()
    expect(info.quantizedFacings).toBe(-1)
    expect(info.sequence).toBe('idle')
  })

  it('should accept custom quantizedFacings', () => {
    const info = new WithEmbeddedTurretSpriteBodyInfo({ quantizedFacings: 32 })
    expect(info.quantizedFacings).toBe(32)
  })
})

describe('WithEmbeddedTurretSpriteBody', () => {
  it('should throw if no Turreted trait found', () => {
    const actor = { traitsImplementing: () => [] } as unknown as IGameActor
    const info = new WithEmbeddedTurretSpriteBodyInfo()
    expect(() => new WithEmbeddedTurretSpriteBody(actor, info)).toThrow()
  })

  it('should resolve the first Turreted trait', () => {
    const turreted = makeTurreted()
    const actor = makeActor(turreted)
    const info = new WithEmbeddedTurretSpriteBodyInfo()
    const body = new WithEmbeddedTurretSpriteBody(actor, info)
    ;(body as any)._body = makeBody()

    expect(body.turreted).toBe(turreted)
  })

  it('should set quantizedFacings from info when >= 0', () => {
    const turreted = makeTurreted()
    const actor = makeActor(turreted)
    const info = new WithEmbeddedTurretSpriteBodyInfo({ quantizedFacings: 32 })
    const body = new WithEmbeddedTurretSpriteBody(actor, info)
    ;(body as any)._body = makeBody()

    body.traitEnabled({} as IGameActor)
    expect(turreted.quantizedFacings).toBe(32)
  })

  it('should auto-detect quantizedFacings from sequence when = -1', () => {
    const turreted = makeTurreted()
    const actor = makeActor(turreted)
    const info = new WithEmbeddedTurretSpriteBodyInfo({ quantizedFacings: -1 })
    const body = new WithEmbeddedTurretSpriteBody(actor, info)
    ;(body as any)._body = makeBody({
      currentSequence: { name: 'idle', facings: 16 },
    })

    body.traitEnabled({} as IGameActor)
    expect(turreted.quantizedFacings).toBe(16)
  })

  it('should update facings on damage state change', () => {
    const turreted = makeTurreted()
    const actor = makeActor(turreted)
    const info = new WithEmbeddedTurretSpriteBodyInfo({ quantizedFacings: 32 })
    const body = new WithEmbeddedTurretSpriteBody(actor, info)
    ;(body as any)._body = makeBody()

    body.damageStateChanged({} as IGameActor)
    expect(turreted.quantizedFacings).toBe(32)
  })

  it('should dispose cleanly', () => {
    const turreted = makeTurreted()
    const actor = makeActor(turreted)
    const info = new WithEmbeddedTurretSpriteBodyInfo()
    const body = new WithEmbeddedTurretSpriteBody(actor, info)
    expect(() => body.dispose()).not.toThrow()
  })
})
