/**
 * PowerManager.test.ts — PowerManager stub unit tests
 *
 * Tests focus on: PowerState enum values, stub getters returning defaults.
 */

import { describe, it, expect } from 'vitest'
import { PowerManager, PowerManagerInfo, PowerState } from './PowerManager.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PowerState', () => {
  it('has correct enum values', () => {
    expect(PowerState.Normal).toBe(0)
    expect(PowerState.Low).toBe(1)
    expect(PowerState.Critical).toBe(2)
  })
})

describe('PowerManagerInfo', () => {
  it('has optional instanceName', () => {
    const info = new PowerManagerInfo({ instanceName: 'power' })
    expect(info.instanceName).toBe('power')
  })

  it('works without instanceName', () => {
    const info = new PowerManagerInfo()
    expect(info.instanceName).toBeUndefined()
  })
})

describe('PowerManager', () => {
  it('always returns Normal power state (stub)', () => {
    const manager = new PowerManager()
    expect(manager.powerState).toBe(PowerState.Normal)
  })

  it('returns 0 for power (stub)', () => {
    const manager = new PowerManager()
    expect(manager.power).toBe(0)
  })

  it('returns 0 for powerDrained (stub)', () => {
    const manager = new PowerManager()
    expect(manager.powerDrained).toBe(0)
  })

  it('stores info reference', () => {
    const info = new PowerManagerInfo({ instanceName: 'test' })
    const manager = new PowerManager(info)
    expect(manager.info).toBe(info)
  })

  it('uses default info when none provided', () => {
    const manager = new PowerManager()
    expect(manager.info).toBeInstanceOf(PowerManagerInfo)
  })

  it('powerState is always Normal regardless of info', () => {
    const manager = new PowerManager(new PowerManagerInfo())
    expect(manager.powerState).toBe(PowerState.Normal)
    expect(manager.powerState).not.toBe(PowerState.Low)
    expect(manager.powerState).not.toBe(PowerState.Critical)
  })
})
