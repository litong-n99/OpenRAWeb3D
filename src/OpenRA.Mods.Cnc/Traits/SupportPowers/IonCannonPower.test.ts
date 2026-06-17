/**
 * IonCannonPower.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { IonCannonPower, IonCannonPowerInfo } from './IonCannonPower.js'

describe('IonCannonPowerInfo', () => {
  it('should have default values', () => {
    const info = new IonCannonPowerInfo()
    expect(info.weapon).toBe('IonCannon')
    expect(info.weaponDelay).toBe(7)
    expect(info.effect).toBe('ionsfx')
    expect(info.effectSequence).toBe('idle')
  })
})

describe('IonCannonPower', () => {
  it('should construct with given info', () => {
    const info = new IonCannonPowerInfo({ weapon: 'SuperIonCannon', weaponDelay: 5 })
    const actor: any = { world: { addEffect: vi.fn() } }
    const power = new IonCannonPower(actor, info)
    expect(power.info.weapon).toBe('SuperIonCannon')
    expect(power.info.weaponDelay).toBe(5)
  })

  it('should activate and spawn effect', () => {
    const info = new IonCannonPowerInfo({ weapon: 'IonCannon', onFireSound: 'ionboom.aud' })
    const addEffect = vi.fn()
    const actor: any = {
      world: { addEffect },
      owner: { id: 1 },
      centerPosition: { X: 100, Y: 200, Z: 0 },
    }
    const power = new IonCannonPower(actor, info)
    const order = {
      orderName: 'IonCannonPowerInfoOrder',
      target: { centerPosition: { X: 300, Y: 400, Z: 0 } },
    }
    const manager: any = { self: actor, powers: new Map() }
    power.activate(actor, order, manager)
    // Effect should be added to world
    expect(addEffect).toHaveBeenCalled()
    const effect = addEffect.mock.calls[0][0]
    expect(effect.weaponInfo).toBe(info.weaponInfo)
    expect(effect.image).toBe('ionsfx')
  })

  it('should not spawn effect when no world', () => {
    const info = new IonCannonPowerInfo()
    const actor: any = {} // No world
    const power = new IonCannonPower(actor, info)
    const order = { orderName: 'test', target: null }
    const manager: any = { self: actor, powers: new Map() }
    // Should not throw
    expect(() => power.activate(actor, order, manager)).not.toThrow()
  })
})
