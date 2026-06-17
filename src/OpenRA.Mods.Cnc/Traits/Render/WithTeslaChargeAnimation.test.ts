/**
 * WithTeslaChargeAnimation.test.ts — Unit tests for WithTeslaChargeAnimation
 *
 * Tests focus on: charging event dispatch, sprite body resolution, animation lifecycle.
 */

import { describe, it, expect } from 'vitest'
import {
  WithTeslaChargeAnimation,
  WithTeslaChargeAnimationInfo,
  type ITeslaSpriteBody,
} from './WithTeslaChargeAnimation.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpriteBody(name: string): { body: ITeslaSpriteBody; callLog: string[] } {
  const callLog: string[] = []
  const body: ITeslaSpriteBody = {
    info: { name },
    playCustomAnimation(_self: IGameActor, sequence: string, onComplete?: () => void) {
      callLog.push(`play:${sequence}`)
      if (onComplete) onComplete()
    },
    cancelCustomAnimation(_self: IGameActor) {
      callLog.push('cancel')
    },
  }
  return { body, callLog }
}

function makeActor(_bodyName: string, spriteBodies: ITeslaSpriteBody[]): IGameActor {
  return {
    traitsImplementing(name: string): unknown[] {
      if (name === 'WithSpriteBody') return spriteBodies
      return []
    },
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithTeslaChargeAnimationInfo', () => {
  it('should have default values', () => {
    const info = new WithTeslaChargeAnimationInfo()
    expect(info.chargeSequence).toBe('active')
    expect(info.body).toBe('body')
  })

  it('should accept custom values', () => {
    const info = new WithTeslaChargeAnimationInfo({
      chargeSequence: 'charging',
      body: 'turret',
      instanceName: 'tesla-charge',
    })
    expect(info.chargeSequence).toBe('charging')
    expect(info.body).toBe('turret')
    expect(info.instanceName).toBe('tesla-charge')
  })

  it('should create trait via factory', () => {
    const info = new WithTeslaChargeAnimationInfo()
    const { body } = makeSpriteBody('body')
    const actor = makeActor('body', [body])
    const trait = info.create(actor)
    expect(trait).toBeInstanceOf(WithTeslaChargeAnimation)
  })
})

describe('WithTeslaChargeAnimation', () => {
  it('should resolve WithSpriteBody by name', () => {
    const { body: body1 } = makeSpriteBody('body')
    const { body: body2 } = makeSpriteBody('turret')
    const actor = makeActor('body', [body1, body2])
    const info = new WithTeslaChargeAnimationInfo({ body: 'turret' })
    const anim = new WithTeslaChargeAnimation(actor, info)
    expect(anim).toBeDefined()
  })

  it('should throw if no matching WithSpriteBody found', () => {
    const { body } = makeSpriteBody('other')
    const actor = makeActor('body', [body])
    const info = new WithTeslaChargeAnimationInfo({ body: 'nonexistent' })
    expect(() => new WithTeslaChargeAnimation(actor, info)).toThrow()
  })

  it('should play charge sequence on charging event', () => {
    const { body, callLog } = makeSpriteBody('body')
    const actor = makeActor('body', [body])
    const info = new WithTeslaChargeAnimationInfo({ chargeSequence: 'active' })
    const anim = new WithTeslaChargeAnimation(actor, info)

    anim.charging(actor, null)
    expect(callLog).toContain('play:active')
  })

  it('should cancel custom animation when charging completes', () => {
    const { body, callLog } = makeSpriteBody('body')
    const actor = makeActor('body', [body])
    const info = new WithTeslaChargeAnimationInfo()
    const anim = new WithTeslaChargeAnimation(actor, info)

    anim.charging(actor, null)
    // After play completes, cancelCustomAnimation should be called
    expect(callLog).toContain('cancel')
  })

  it('should implement INotifyTeslaCharging interface', () => {
    const { body } = makeSpriteBody('body')
    const actor = makeActor('body', [body])
    const info = new WithTeslaChargeAnimationInfo()
    const anim = new WithTeslaChargeAnimation(actor, info)
    expect(typeof anim.charging).toBe('function')
  })

  it('should dispose cleanly', () => {
    const { body } = makeSpriteBody('body')
    const actor = makeActor('body', [body])
    const info = new WithTeslaChargeAnimationInfo()
    const anim = new WithTeslaChargeAnimation(actor, info)
    expect(() => anim.dispose()).not.toThrow()
  })
})
