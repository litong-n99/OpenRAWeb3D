/**
 * AttackOrderPower.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import {
  AttackOrderPower,
  AttackOrderPowerInfo,
  SelectAttackPowerTarget,
} from './AttackOrderPower.js'

describe('AttackOrderPower', () => {
  it('should construct with given info', () => {
    const info = new AttackOrderPowerInfo({ circleColor: 0xff0000ff })
    const actor: any = {}
    const power = new AttackOrderPower(actor, info)
    expect(power.info.circleColor).toBe(0xff0000ff)
  })

  it('should resolve AttackBase on created', () => {
    const info = new AttackOrderPowerInfo()
    const actor: any = {
      traitsImplementing: () => [{ name: 'AttackBase', attackTarget: vi.fn() }],
    }
    const power = new AttackOrderPower(actor, info)
    ;(power as any).onCreated(actor)
    expect(power.attack).toBeDefined()
  })

  it('should issue attack target on activate', () => {
    const info = new AttackOrderPowerInfo()
    const attackFn = vi.fn()
    const actor: any = {
      traitsImplementing: () => [{ name: 'AttackBase', attackTarget: attackFn }],
    }
    const power = new AttackOrderPower(actor, info)
    ;(power as any).onCreated(actor)
    const order = { orderName: 'test', target: { type: 'actor', id: 42 } }
    const manager: any = { self: actor, powers: new Map() }
    power.activate(actor, order, manager)
    expect(attackFn).toHaveBeenCalled()
  })
})

describe('SelectAttackPowerTarget', () => {
  function makeManager(): any {
    return {
      self: { centerPosition: { X: 0, Y: 0, Z: 0 } },
      powers: new Map(),
    }
  }

  it('should create with cursor and blocked cursor', () => {
    const targeter = new SelectAttackPowerTarget(
      {} as any, 'testOrder', makeManager(), 'attack', { getMaximumRange: () => 10 },
    )
    expect(targeter.cursor).toBe('attack')
    expect(targeter.cursorBlocked).toBe('attack-blocked')
  })

  it('should invalidate when map does not contain cell', () => {
    const manager = makeManager()
    const world: any = { map: { contains: () => false } }
    const targeter = new SelectAttackPowerTarget(
      {} as any, 'test', manager, 'cursor', { getMaximumRange: () => 100 },
    )
    expect(targeter.isValidTarget(world, { X: 0, Y: 0 })).toBe(false)
  })

  it('should cancel when power is not ready', () => {
    const manager = makeManager()
    manager.powers.set('test', { active: false, ready: false })
    const world: any = { cancelInputMode: vi.fn() }
    const targeter = new SelectAttackPowerTarget(
      {} as any, 'test', manager, 'cursor', null,
    )
    targeter.tick(world)
    expect(world.cancelInputMode).toHaveBeenCalled()
  })

  it('should return blocked cursor for invalid cells', () => {
    const targeter = new SelectAttackPowerTarget(
      {} as any, 'test', makeManager(), 'attack', null,
    )
    const world: any = { map: { contains: () => false } }
    expect(targeter.getCursor(world, { X: 0, Y: 0 })).toBe('attack-blocked')
  })
})
