/**
 * DeathSounds.test.ts — DeathSounds migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { DeathSounds, DeathSoundsInfo } from './DeathSounds.js'
import { AttackInfo, Damage } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeMockActor(playVoiceLocal?: ReturnType<typeof vi.fn>) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    playVoiceLocal: playVoiceLocal ?? vi.fn(),
  }
}

function makeMockAttackInfo(damageTypesEmpty = true) {
  return new AttackInfo(
    new Damage(50, {
      isEmpty: () => damageTypesEmpty,
      contains: () => false,
    }),
    { actorId: 2, isInWorld: true, isDead: false, disposed: false } as never,
    4,
    2,
  )
}

describe('DeathSoundsInfo', () => {
  it('has default voice "Die"', () => {
    const info = new DeathSoundsInfo()
    expect(info.voice).toBe('Die')
  })

  it('has default volumeMultiplier 1.0', () => {
    const info = new DeathSoundsInfo()
    expect(info.volumeMultiplier).toBe(1.0)
  })

  it('deathTypes defaults to empty', () => {
    const info = new DeathSoundsInfo()
    expect(info.deathTypes.isEmpty()).toBe(true)
  })
})

describe('DeathSounds', () => {
  it('plays voice when killed with empty deathTypes', () => {
    const info = new DeathSoundsInfo({ voice: 'Die' })
    const sounds = new DeathSounds(info)
    const playVoice = vi.fn()
    const self = makeMockActor(playVoice)

    sounds.killed(self, makeMockAttackInfo(true))
    expect(playVoice).toHaveBeenCalledWith('Die', 1.0)
  })

  it('does not play when trait is disabled', () => {
    const info = new DeathSoundsInfo({ voice: 'Die' })
    const sounds = new DeathSounds(info)
    const playVoice = vi.fn()
    const self = makeMockActor(playVoice)
    ;(sounds as unknown as { _enabled: boolean })._enabled = false

    sounds.killed(self, makeMockAttackInfo(true))
    expect(playVoice).not.toHaveBeenCalled()
  })

  it('passes volume multiplier', () => {
    const info = new DeathSoundsInfo({ voice: 'Scream', volumeMultiplier: 2.0 })
    const sounds = new DeathSounds(info)
    const playVoice = vi.fn()
    const self = makeMockActor(playVoice)

    sounds.killed(self, makeMockAttackInfo(true))
    expect(playVoice).toHaveBeenCalledWith('Scream', 2.0)
  })

  it('does not play when playVoiceLocal is not defined', () => {
    const info = new DeathSoundsInfo({ voice: 'Die' })
    const sounds = new DeathSounds(info)
    const self = makeMockActor(undefined as unknown as ReturnType<typeof vi.fn>)

    // Should not throw
    expect(() => sounds.killed(self, makeMockAttackInfo(true))).not.toThrow()
  })
})
