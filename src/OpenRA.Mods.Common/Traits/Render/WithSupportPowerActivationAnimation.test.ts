/**
 * WithSupportPowerActivationAnimation.test.ts — migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WithSupportPowerActivationAnimation,
  type WithSupportPowerActivationAnimationInfo,
  type IWithSpriteBody,
  DEFAULT_ACTIVATION_ANIMATION_INFO,
} from './WithSupportPowerActivationAnimation.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<WithSupportPowerActivationAnimationInfo> = {}): WithSupportPowerActivationAnimationInfo {
  return {
    ...DEFAULT_ACTIVATION_ANIMATION_INFO,
    ...overrides,
  }
}

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

function makeMockSpriteBody(
  overrides: Partial<IWithSpriteBody> = {},
): IWithSpriteBody {
  return {
    info: overrides.info ?? { name: 'body' },
    playCustomAnimation: overrides.playCustomAnimation ?? vi.fn(),
    cancelCustomAnimation: overrides.cancelCustomAnimation ?? vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithSupportPowerActivationAnimation', () => {
  let actor: IGameActor
  let mockBody: IWithSpriteBody

  beforeEach(() => {
    actor = makeActor()
    mockBody = makeMockSpriteBody()
  })

  describe('construction', () => {
    it('stores info with sequence default "active"', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      expect(trait.info.sequence).toBe('active')
    })

    it('stores info with body default "body"', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      expect(trait.info.body).toBe('body')
    })
  })

  describe('init', () => {
    it('stores the sprite body reference', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)
      expect(trait._testWsb).toBe(mockBody)
    })
  })

  describe('charged', () => {
    it('is a no-op', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)
      // Should not throw
      trait.charged(actor)
      expect(mockBody.playCustomAnimation).not.toHaveBeenCalled()
    })
  })

  describe('activated', () => {
    it('calls playCustomAnimation with sequence and completion callback', () => {
      const info = makeInfo({ sequence: 'powerActive' })
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)

      trait.activated(actor)

      expect(mockBody.playCustomAnimation).toHaveBeenCalledTimes(1)
      const [calledActor, sequence, onComplete] = (
        mockBody.playCustomAnimation as ReturnType<typeof vi.fn>
      ).mock.calls[0]
      expect(calledActor).toBe(actor)
      expect(sequence).toBe('powerActive')
      expect(typeof onComplete).toBe('function')
    })

    it('completion callback calls cancelCustomAnimation', () => {
      const info = makeInfo({ sequence: 'powerActive' })
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)

      trait.activated(actor)

      const onComplete = (mockBody.playCustomAnimation as ReturnType<typeof vi.fn>).mock.calls[0][2]
      onComplete()
      expect(mockBody.cancelCustomAnimation).toHaveBeenCalledWith(actor)
    })

    it('does nothing when trait is disabled', () => {
      const info = makeInfo({ sequence: 'powerActive' })
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)
      ;(trait as unknown as { _enabled: boolean })._enabled = false

      trait.activated(actor)
      expect(mockBody.playCustomAnimation).not.toHaveBeenCalled()
    })

    it('does nothing when no sprite body', () => {
      const info = makeInfo({ sequence: 'powerActive' })
      const trait = new WithSupportPowerActivationAnimation(info)
      // No init call — _testWsb is null

      trait.activated(actor)
      expect(mockBody.playCustomAnimation).not.toHaveBeenCalled()
    })
  })

  describe('traitDisabled', () => {
    it('calls cancelCustomAnimation on the sprite body', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)

      ;(trait as any).traitDisabled(actor)

      expect(mockBody.cancelCustomAnimation).toHaveBeenCalledWith(actor)
    })

    it('does not throw when sprite body is null', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      // No init — wsb is null

      expect(() => {
        ;(trait as any).traitDisabled(actor)
      }).not.toThrow()
    })
  })

  describe('attach', () => {
    it('tries to resolve WithSpriteBody from actor when not initialized', () => {
      const info = makeInfo({ body: 'body' })
      const trait = new WithSupportPowerActivationAnimation(info)

      const actorWithTraits = makeActor({
        traitsImplementing: (id: string) => {
          if (id === 'WithSpriteBody') return [mockBody]
          return []
        },
      })
      trait.attach(actorWithTraits)
      expect(trait._testWsb).toBe(mockBody)
    })

    it('does not overwrite explicitly initialized WSB', () => {
      const info = makeInfo({ body: 'body' })
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)

      const anotherBody = makeMockSpriteBody({ info: { name: 'turret' } })
      const actorWithTraits = makeActor({
        traitsImplementing: (id: string) => {
          if (id === 'WithSpriteBody') return [anotherBody]
          return []
        },
      })
      trait.attach(actorWithTraits)
      // Should keep the explicitly set body
      expect(trait._testWsb).toBe(mockBody)
    })
  })

  describe('test injection', () => {
    it('allows injecting WSB via _testWsb', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      trait._testWsb = mockBody
      expect(trait._testWsb).toBe(mockBody)
    })

    it('allows clearing WSB via _testWsb = null', () => {
      const info = makeInfo()
      const trait = new WithSupportPowerActivationAnimation(info)
      trait.init(mockBody)
      trait._testWsb = null
      expect(trait._testWsb).toBeNull()
    })
  })
})
