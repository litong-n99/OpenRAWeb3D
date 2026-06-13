/**
 * AttackSounds.test.ts — AttackSounds migration unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { AttackSounds, AttackSoundsInfo } from './AttackSounds.js'
import { AttackDelayType } from '../CombatInterfaces.js'

function makeMockActor() {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: { X: 0, Y: 0, Z: 0 },
  }
}

describe('AttackSoundsInfo', () => {
  it('defaults to no sounds', () => {
    const info = new AttackSoundsInfo()
    expect(info.sounds).toEqual([])
  })

  it('delay defaults to 0', () => {
    const info = new AttackSoundsInfo()
    expect(info.delay).toBe(0)
  })

  it('delayRelativeTo defaults to Preparation', () => {
    const info = new AttackSoundsInfo()
    expect(info.delayRelativeTo).toBe(AttackDelayType.Preparation)
  })
})

describe('AttackSounds', () => {
  let self: ReturnType<typeof makeMockActor>

  beforeEach(() => {
    self = makeMockActor()
  })

  it('preparingAttack starts delay when DelayRelativeTo is Preparation', () => {
    const info = new AttackSoundsInfo({
      sounds: ['boom'],
      delay: 5,
      delayRelativeTo: AttackDelayType.Preparation,
    })
    const sounds = new AttackSounds(info)
    sounds.preparingAttack(self, {} as never, null, {} as never)
    expect((sounds as unknown as { tickCount: number }).tickCount).toBe(5)
  })

  it('attacking starts delay when DelayRelativeTo is Attack', () => {
    const info = new AttackSoundsInfo({
      sounds: ['boom'],
      delay: 3,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const sounds = new AttackSounds(info)
    sounds.attacking(self, {} as never, null, {} as never)
    expect((sounds as unknown as { tickCount: number }).tickCount).toBe(3)
  })

  it('tick decrements delay', () => {
    const info = new AttackSoundsInfo({ sounds: ['test'], delay: 5 })
    const sounds = new AttackSounds(info)
    sounds.preparingAttack(self, {} as never, null, {} as never)
    sounds.tick(self)
    expect((sounds as unknown as { tickCount: number }).tickCount).toBe(4)
  })

  it('plays sound immediately when delay is 0', () => {
    // No crash test — with delay=0, playSound is called immediately
    const info = new AttackSoundsInfo({ sounds: ['test'], delay: 0 })
    const sounds = new AttackSounds(info)
    expect(() => sounds.preparingAttack(self, {} as never, null, {} as never)).not.toThrow()
  })

  it('does not decrement when trait is disabled', () => {
    const info = new AttackSoundsInfo({ sounds: ['test'], delay: 5 })
    const sounds = new AttackSounds(info)
    ;(sounds as unknown as { _enabled: boolean })._enabled = false
    sounds.preparingAttack(self, {} as never, null, {} as never)
    const before = (sounds as unknown as { tickCount: number }).tickCount
    sounds.tick(self)
    expect((sounds as unknown as { tickCount: number }).tickCount).toBe(before)
  })

  it('preparingAttack ignores when DelayRelativeTo is Attack', () => {
    const info = new AttackSoundsInfo({
      sounds: ['test'],
      delay: 5,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const sounds = new AttackSounds(info)
    sounds.preparingAttack(self, {} as never, null, {} as never)
    expect((sounds as unknown as { tickCount: number }).tickCount).toBe(0)
  })

  it('attacking ignores when DelayRelativeTo is Preparation', () => {
    const info = new AttackSoundsInfo({ sounds: ['test'], delay: 5 })
    const sounds = new AttackSounds(info)
    sounds.attacking(self, {} as never, null, {} as never)
    expect((sounds as unknown as { tickCount: number }).tickCount).toBe(0)
  })
})
