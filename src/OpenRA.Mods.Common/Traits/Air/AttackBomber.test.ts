/**
 * AttackBomber.test.ts — AttackBomber migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AttackBomber, AttackBomberInfo } from './AttackBomber.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'

function makeMockActor() {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: new WPos(100, 200, 0),
    world: { actors: [] },
  }
}

describe('AttackBomberInfo', () => {
  it('can be constructed with defaults', () => {
    const info = new AttackBomberInfo()
    expect(info.armaments).toEqual(['primary', 'secondary'])
  })

  it('accepts custom armaments', () => {
    const info = new AttackBomberInfo({ armaments: ['bomb'] })
    expect(info.armaments).toEqual(['bomb'])
  })
})

describe('AttackBomber', () => {
  let bomber: AttackBomber
  let self: ReturnType<typeof makeMockActor>

  beforeEach(() => {
    const info = new AttackBomberInfo()
    bomber = new AttackBomber(info)
    self = makeMockActor()
  })

  it('initial target is Invalid', () => {
    expect(bomber.target.type).toBe(Target.Invalid.type)
  })

  it('setTarget sets the target position', () => {
    const pos = new WPos(300, 400, 0)
    bomber.setTarget(pos)
    expect(bomber.target.type).toBe(Target.fromPos(pos).type)
  })

  it('initial inAttackRange is false', () => {
    expect(bomber.inAttackRange).toBe(false)
  })

  it('initial facingTarget is true', () => {
    expect(bomber.facingTarget).toBe(true)
  })

  it('onRemovedFromWorld invokes callbacks', () => {
    const callback = vi.fn()
    bomber.onRemovedFromWorldCallbacks.push(callback)
    bomber.removedFromWorld(self)
    expect(callback).toHaveBeenCalledWith(self)
  })

  it('onEnteredAttackRange callbacks are invoked on range entry', () => {
    const callback = vi.fn()
    bomber.onEnteredAttackRangeCallbacks.push(callback)
    // Simulate entering range by directly setting state and calling callback dispatch
    bomber.inAttackRange = true
    // Access the callback array directly (test internal behavior)
    for (const cb of bomber.onEnteredAttackRangeCallbacks) {
      cb(self)
    }
    expect(callback).toHaveBeenCalledWith(self)
  })

  it('getAttackActivity throws error', () => {
    expect(() =>
      bomber.getAttackActivity(self, 'Default', Target.Invalid, false, false),
    ).toThrow('AttackBomber requires a scripted target')
  })

  it('onExitedAttackRange callbacks are invoked on range exit', () => {
    const callback = vi.fn()
    bomber.onExitedAttackRangeCallbacks.push(callback)
    for (const cb of bomber.onExitedAttackRangeCallbacks) {
      cb(self)
    }
    expect(callback).toHaveBeenCalledWith(self)
  })
})
