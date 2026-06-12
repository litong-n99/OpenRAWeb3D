/**
 * PowerDownBotManager.test.ts — STUB unit tests
 */

import { describe, it, expect } from 'vitest'
import { PowerDownBotManager } from './PowerDownBotManager.js'

describe('PowerDownBotManager', () => {
  it('constructs with defaults', () => {
    const m = new PowerDownBotManager()
    expect(m.interval).toBe(150)
    expect(m.powerDownOrder).toBe('PowerDown')
    expect(m.powerDownTypes.size).toBe(0)
  })

  it('constructs with custom values', () => {
    const m = new PowerDownBotManager(300, new Set(['BuildingA']), 'CustomOrder', 10)
    expect(m.interval).toBe(300)
    expect(m.powerDownOrder).toBe('CustomOrder')
    expect(m.powerDownTypes.has('BuildingA')).toBe(true)
  })

  it('botTick is a no-op', () => {
    const m = new PowerDownBotManager()
    expect(() => m.botTick(null!)).not.toThrow()
  })

  it('dispose is safe', () => {
    const m = new PowerDownBotManager()
    expect(() => m.dispose()).not.toThrow()
  })
})
