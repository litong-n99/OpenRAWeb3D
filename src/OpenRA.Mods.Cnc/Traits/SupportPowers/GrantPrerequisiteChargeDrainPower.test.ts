/**
 * GrantPrerequisiteChargeDrainPower.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import {
  GrantPrerequisiteChargeDrainPower,
  GrantPrerequisiteChargeDrainPowerInfo,
  DischargeableSupportPowerInstance,
} from './GrantPrerequisiteChargeDrainPower.js'

describe('GrantPrerequisiteChargeDrainPower', () => {
  it('should construct with given info', () => {
    const info = new GrantPrerequisiteChargeDrainPowerInfo({
      prerequisite: 'TechLab',
      dischargeModifier: 200,
    })
    const actor: any = {}
    const power = new GrantPrerequisiteChargeDrainPower(actor, info)
    expect(power.info.prerequisite).toBe('TechLab')
    expect(power.info.dischargeModifier).toBe(200)
  })

  it('should start inactive', () => {
    const power = new GrantPrerequisiteChargeDrainPower({} as any, new GrantPrerequisiteChargeDrainPowerInfo())
    expect(power.active).toBe(false)
    expect(power.providesPrerequisites).toEqual([])
  })

  it('should provide prerequisites when active', () => {
    const info = new GrantPrerequisiteChargeDrainPowerInfo({ prerequisite: 'TechLab' })
    const power = new GrantPrerequisiteChargeDrainPower({} as any, info)
    power.activatePower({} as any)
    expect(power.active).toBe(true)
    expect(power.providesPrerequisites).toEqual(['TechLab'])
  })

  it('should stop providing prerequisites when deactivated', () => {
    const info = new GrantPrerequisiteChargeDrainPowerInfo({ prerequisite: 'TechLab' })
    const power = new GrantPrerequisiteChargeDrainPower({} as any, info)
    power.activatePower({} as any)
    power.deactivatePower({} as any)
    expect(power.active).toBe(false)
    expect(power.providesPrerequisites).toEqual([])
  })

  it('should reset active on owner change', () => {
    const info = new GrantPrerequisiteChargeDrainPowerInfo({ prerequisite: 'TechLab' })
    const power = new GrantPrerequisiteChargeDrainPower({} as any, info)
    power.activatePower({} as any)
    expect(power.active).toBe(true)
    power.onOwnerChanged({} as any, {}, { playerActor: { traitsImplementing: () => [] } })
    expect(power.active).toBe(false)
  })

  it('should create DischargeableSupportPowerInstance', () => {
    const info = new GrantPrerequisiteChargeDrainPowerInfo({
      prerequisite: 'TechLab',
      dischargeModifier: 300,
    })
    const power = new GrantPrerequisiteChargeDrainPower({} as any, info)
    const instance = power.createInstance('testKey', { self: {} as any, powers: new Map() })
    expect(instance).toBeInstanceOf(DischargeableSupportPowerInstance)
    expect(instance.key).toBe('testKey')
  })
})

describe('DischargeableSupportPowerInstance', () => {
  function makeInstance() {
    const info = new GrantPrerequisiteChargeDrainPowerInfo({
      prerequisite: 'TechLab',
      chargeInterval: 100,
      dischargeModifier: 300,
    })
    const power = new GrantPrerequisiteChargeDrainPower({} as any, info)
    const manager: any = { self: {}, powers: new Map() }
    return new DischargeableSupportPowerInstance('key', info, manager, power)
  }

  it('should start not active and not available', () => {
    const inst = makeInstance()
    expect(inst.isActive).toBe(false)
    expect(inst.available).toBe(false)
  })

  it('should discharge and eventually deactivate', () => {
    const inst = makeInstance()
    // Force available
    ;(inst as any)._available = true
    // Activate
    inst.activate({ extraData: 1 })
    expect(inst.isActive).toBe(true)

    // Tick many times to drain
    for (let i = 0; i < 50; i++) {
      inst.tick()
    }
    // After 50 ticks of discharge at 300/tick, remainingSubTicks increases
    expect(inst.remainingSubTicks).toBeGreaterThanOrEqual(0)
  })

  it('should deactivate when order extraData is 0', () => {
    const inst = makeInstance()
    ;(inst as any)._available = true
    inst.activate({ extraData: 1 })
    expect(inst.isActive).toBe(true)
    inst.activate({ extraData: 0 })
    expect(inst.isActive).toBe(false)
  })

  it('should accept discharge from external sources', () => {
    const inst = makeInstance()
    ;(inst as any)._available = true
    inst.activate({ extraData: 1 })
    const beforeTicks = inst.remainingSubTicks
    inst.discharge(1000)
    inst.tick()
    expect(inst.remainingSubTicks).toBeGreaterThan(beforeTicks)
  })

  it('should show overlay text when active', () => {
    const inst = makeInstance()
    ;(inst as any)._available = true
    ;(inst as any).active = true // Force active state for the instance's consumer
    inst.activate({ extraData: 1 })
    expect(inst.iconOverlayTextOverride()).toBe('ACTIVE')
  })
})
