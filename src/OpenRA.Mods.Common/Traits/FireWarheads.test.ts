/**
 * FireWarheads.test.ts — FireWarheads migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { FireWarheads, FireWarheadsInfo } from './FireWarheads.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

function makeMockActor() {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: new WPos(100, 200, 0),
  }
}

describe('FireWarheadsInfo', () => {
  it('defaults weapons to empty', () => {
    const info = new FireWarheadsInfo()
    expect(info.weapons).toEqual([])
  })

  it('startCooldown defaults to 0', () => {
    const info = new FireWarheadsInfo()
    expect(info.startCooldown).toBe(0)
  })

  it('interval defaults to 1', () => {
    const info = new FireWarheadsInfo()
    expect(info.interval).toBe(1)
  })

  it('accepts custom weapons and interval', () => {
    const info = new FireWarheadsInfo({
      weapons: ['Gun', 'Cannon'],
      interval: 10,
      startCooldown: 5,
    })
    expect(info.weapons).toEqual(['Gun', 'Cannon'])
    expect(info.interval).toBe(10)
    expect(info.startCooldown).toBe(5)
  })
})

describe('FireWarheads', () => {
  it('initializes cooldown from startCooldown', () => {
    const info = new FireWarheadsInfo({ startCooldown: 10 })
    const trait = new FireWarheads(info)
    expect(trait.cooldown).toBe(10)
  })

  it('decrements cooldown each tick', () => {
    const info = new FireWarheadsInfo({ startCooldown: 5 })
    const trait = new FireWarheads(info)
    const self = makeMockActor()
    trait.tick(self)
    expect(trait.cooldown).toBe(4)
  })

  it('fires weapons when cooldown reaches 0', () => {
    const info = new FireWarheadsInfo({ startCooldown: 1, interval: 3 })
    const trait = new FireWarheads(info)
    const mockImpact = vi.fn()
    trait.weaponInfos = [{ impact: mockImpact }]
    const self = makeMockActor()

    // Tick 1: cooldown 1->0 (decrement only, no fire)
    trait.tick(self)
    expect(trait.cooldown).toBe(0)

    // Tick 2: cooldown is 0, triggers fire, resets to interval (3)
    trait.tick(self)
    expect(mockImpact).toHaveBeenCalledTimes(1)
    expect(trait.cooldown).toBe(3)
  })

  it('does not fire when trait is disabled', () => {
    const info = new FireWarheadsInfo({ startCooldown: 0, interval: 1 })
    const trait = new FireWarheads(info)
    const mockImpact = vi.fn()
    trait.weaponInfos = [{ impact: mockImpact }]
    ;(trait as unknown as { _enabled: boolean })._enabled = false
    const self = makeMockActor()

    trait.tick(self)
    expect(mockImpact).not.toHaveBeenCalled()
  })

  it('does not fire when trait is paused', () => {
    const info = new FireWarheadsInfo({ startCooldown: 0, interval: 1 })
    const trait = new FireWarheads(info)
    const mockImpact = vi.fn()
    trait.weaponInfos = [{ impact: mockImpact }]
    ;(trait as unknown as { _paused: boolean })._paused = true
    const self = makeMockActor()

    trait.tick(self)
    expect(mockImpact).not.toHaveBeenCalled()
  })

  it('fires multiple weapons per interval', () => {
    const info = new FireWarheadsInfo({ startCooldown: 0, interval: 1 })
    const trait = new FireWarheads(info)
    const mock1 = vi.fn()
    const mock2 = vi.fn()
    trait.weaponInfos = [{ impact: mock1 }, { impact: mock2 }]
    const self = makeMockActor()

    trait.tick(self)
    expect(mock1).toHaveBeenCalledTimes(1)
    expect(mock2).toHaveBeenCalledTimes(1)
  })

  it('resets cooldown on traitDisabled', () => {
    const info = new FireWarheadsInfo({ startCooldown: 10, interval: 5 })
    const trait = new FireWarheads(info)
    const self = makeMockActor()

    // Tick a few times to reduce cooldown
    trait.tick(self)
    trait.tick(self)
    expect(trait.cooldown).toBeLessThan(10)

    // Reset
    ;(trait as unknown as { traitDisabled: (s: typeof self) => void }).traitDisabled(self)
    expect(trait.cooldown).toBe(10)
  })

  it('does not fire when no centerPosition', () => {
    const info = new FireWarheadsInfo({ startCooldown: 0, interval: 1 })
    const trait = new FireWarheads(info)
    const mockImpact = vi.fn()
    trait.weaponInfos = [{ impact: mockImpact }]
    const self = {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
      // No centerPosition
    }

    trait.tick(self)
    expect(mockImpact).not.toHaveBeenCalled()
  })
})
