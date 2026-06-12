/**
 * BuildingRepairBotModule.test.ts — STUB unit tests
 */

import { describe, it, expect } from 'vitest'
import { BuildingRepairBotModule } from './BuildingRepairBotModule.js'

describe('BuildingRepairBotModule', () => {
  it('constructs with default cooldown', () => {
    const m = new BuildingRepairBotModule()
    expect(m.repairAllBuildingsCoolDown).toBe(107)
  })

  it('constructs with custom cooldown', () => {
    const m = new BuildingRepairBotModule(200)
    expect(m.repairAllBuildingsCoolDown).toBe(200)
  })

  it('respondToAttack is a no-op', () => {
    const m = new BuildingRepairBotModule()
    expect(() => m.respondToAttack(null!, null!, null!)).not.toThrow()
  })

  it('dispose is safe to call', () => {
    const m = new BuildingRepairBotModule()
    expect(() => m.dispose()).not.toThrow()
  })
})
