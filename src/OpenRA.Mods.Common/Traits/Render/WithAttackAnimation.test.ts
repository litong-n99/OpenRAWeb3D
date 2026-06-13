/**
 * WithAttackAnimation.test.ts — WithAttackAnimation migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WithAttackAnimation, WithAttackAnimationInfo, type IWithSpriteBody } from './WithAttackAnimation.js'
import { AttackDelayType } from '../CombatInterfaces.js'

function makeMockSpriteBody(): IWithSpriteBody {
  return {
    isTraitDisabled: false,
    info: { name: 'body' },
    playCustomAnimation: vi.fn(),
  }
}

describe('WithAttackAnimationInfo', () => {
  it('defaults armament to primary', () => {
    const info = new WithAttackAnimationInfo()
    expect(info.armament).toBe('primary')
  })

  it('defaults body to body', () => {
    const info = new WithAttackAnimationInfo()
    expect(info.body).toBe('body')
  })

  it('defaults delay to 0', () => {
    const info = new WithAttackAnimationInfo()
    expect(info.delay).toBe(0)
  })

  it('defaults delayRelativeTo to Preparation', () => {
    const info = new WithAttackAnimationInfo()
    expect(info.delayRelativeTo).toBe(AttackDelayType.Preparation)
  })
})

describe('WithAttackAnimation', () => {
  let mockWsBody: IWithSpriteBody
  let mockArmament: unknown

  beforeEach(() => {
    mockWsBody = makeMockSpriteBody()
    mockArmament = { info: { name: 'primary' }, isReloading: false }
  })

  it('playCustomAnimation is called when attacking with delay=0', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'shoot',
      delay: 0,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)

    trait.attacking({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).toHaveBeenCalledWith(expect.anything(), 'shoot')
  })

  it('preparingAttack triggers when delayRelativeTo=Preparation', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'prepare',
      delay: 0,
      delayRelativeTo: AttackDelayType.Preparation,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)

    trait.preparingAttack({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).toHaveBeenCalledWith(expect.anything(), 'prepare')
  })

  it('does not trigger for different armament', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'shoot',
      delay: 0,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)
    const otherArm = { info: { name: 'secondary' } }

    trait.attacking({} as never, {} as never, otherArm, {} as never)
    expect(mockWsBody.playCustomAnimation).not.toHaveBeenCalled()
  })

  it('delay countdown via tick', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'shoot',
      delay: 2,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)

    trait.attacking({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).not.toHaveBeenCalled()

    trait.tick({} as never)
    trait.tick({} as never)
    expect(mockWsBody.playCustomAnimation).toHaveBeenCalledWith(expect.anything(), 'shoot')
  })

  it('does not play when trait is disabled', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'shoot',
      delay: 0,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    trait.attacking({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).not.toHaveBeenCalled()
  })

  it('does not play when WSB is disabled', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'shoot',
      delay: 0,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    const disabledWsb = { ...mockWsBody, isTraitDisabled: true }
    trait.init(mockArmament, disabledWsb)

    trait.attacking({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).not.toHaveBeenCalled()
  })

  it('does not play when sequence is null', () => {
    const info = new WithAttackAnimationInfo({
      sequence: null,
      delay: 0,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)

    trait.attacking({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).not.toHaveBeenCalled()
  })

  it('ignores preparingAttack when delayRelativeTo=Attack', () => {
    const info = new WithAttackAnimationInfo({
      sequence: 'shoot',
      delay: 0,
      delayRelativeTo: AttackDelayType.Attack,
    })
    const trait = new WithAttackAnimation(info)
    trait.init(mockArmament, mockWsBody)

    trait.preparingAttack({} as never, {} as never, mockArmament, {} as never)
    expect(mockWsBody.playCustomAnimation).not.toHaveBeenCalled()
  })
})
