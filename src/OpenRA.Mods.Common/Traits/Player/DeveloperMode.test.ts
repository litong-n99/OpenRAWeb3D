/**
 * DeveloperMode.test.ts — DeveloperMode stub unit tests
 *
 * Tests focus on: default values, configuration passthrough, all cheat flags.
 */

import { describe, it, expect } from 'vitest'
import { DeveloperMode, DeveloperModeInfo } from './DeveloperMode.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeveloperModeInfo', () => {
  it('has all defaults as false', () => {
    const info = new DeveloperModeInfo()
    expect(info.fastBuild).toBe(false)
    expect(info.allTech).toBe(false)
    expect(info.buildAnywhere).toBe(false)
    expect(info.unlimitedPower).toBe(false)
  })

  it('accepts all configurable fields', () => {
    const info = new DeveloperModeInfo({
      fastBuild: true,
      allTech: true,
      buildAnywhere: true,
      unlimitedPower: true,
    })
    expect(info.fastBuild).toBe(true)
    expect(info.allTech).toBe(true)
    expect(info.buildAnywhere).toBe(true)
    expect(info.unlimitedPower).toBe(true)
  })

  it('has optional instanceName', () => {
    const info = new DeveloperModeInfo({ instanceName: 'dev' })
    expect(info.instanceName).toBe('dev')
  })

  it('works without instanceName', () => {
    const info = new DeveloperModeInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('partial configuration leaves others as false', () => {
    const info = new DeveloperModeInfo({ fastBuild: true })
    expect(info.fastBuild).toBe(true)
    expect(info.allTech).toBe(false)
    expect(info.buildAnywhere).toBe(false)
    expect(info.unlimitedPower).toBe(false)
  })
})

describe('DeveloperMode', () => {
  it('returns false for all cheats with default info', () => {
    const mode = new DeveloperMode()
    expect(mode.fastBuild).toBe(false)
    expect(mode.allTech).toBe(false)
    expect(mode.buildAnywhere).toBe(false)
    expect(mode.unlimitedPower).toBe(false)
  })

  it('returns true for all cheats when configured', () => {
    const info = new DeveloperModeInfo({
      fastBuild: true,
      allTech: true,
      buildAnywhere: true,
      unlimitedPower: true,
    })
    const mode = new DeveloperMode(info)
    expect(mode.fastBuild).toBe(true)
    expect(mode.allTech).toBe(true)
    expect(mode.buildAnywhere).toBe(true)
    expect(mode.unlimitedPower).toBe(true)
  })

  it('stores info reference', () => {
    const info = new DeveloperModeInfo({ fastBuild: true })
    const mode = new DeveloperMode(info)
    expect(mode.info).toBe(info)
  })

  it('uses default info when none provided', () => {
    const mode = new DeveloperMode()
    expect(mode.info).toBeInstanceOf(DeveloperModeInfo)
  })

  it('individual cheat flags can be toggled', () => {
    const fastBuildMode = new DeveloperMode(new DeveloperModeInfo({ fastBuild: true }))
    expect(fastBuildMode.fastBuild).toBe(true)
    expect(fastBuildMode.allTech).toBe(false)

    const allTechMode = new DeveloperMode(new DeveloperModeInfo({ allTech: true }))
    expect(allTechMode.allTech).toBe(true)
    expect(allTechMode.fastBuild).toBe(false)

    const anywhereMode = new DeveloperMode(new DeveloperModeInfo({ buildAnywhere: true }))
    expect(anywhereMode.buildAnywhere).toBe(true)

    const powerMode = new DeveloperMode(new DeveloperModeInfo({ unlimitedPower: true }))
    expect(powerMode.unlimitedPower).toBe(true)
  })
})
