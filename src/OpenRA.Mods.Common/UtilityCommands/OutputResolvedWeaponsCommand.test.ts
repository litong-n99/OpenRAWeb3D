/**
 * OutputResolvedWeaponsCommand.test.ts — OutputResolvedWeaponsCommand unit tests
 *
 * Tests: IUtilityCommand contract, argument validation, resolveWeapons lookup,
 * missing key handling, map override.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect, vi } from 'vitest'
import { OutputResolvedWeaponsCommand } from './OutputResolvedWeaponsCommand.js'
import type { IUtilityCommand } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// IUtilityCommand contract
// ---------------------------------------------------------------------------

describe('OutputResolvedWeaponsCommand — IUtilityCommand contract', () => {
  const command = new OutputResolvedWeaponsCommand()

  it('should have correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--resolved-weapons')
  })

  it('should validate 2-3 arguments', () => {
    expect(command.validateArguments(['--resolved-weapons', 'Minigun'])).toBe(true)
    expect(command.validateArguments(['--resolved-weapons', 'Minigun', '/map/path'])).toBe(true)
  })

  it('should reject fewer than 2 arguments', () => {
    expect(command.validateArguments(['--resolved-weapons'])).toBe(false)
  })

  it('should reject more than 3 arguments', () => {
    expect(
      command.validateArguments(['--resolved-weapons', 'Minigun', '/map', 'extra']),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveWeapons
// ---------------------------------------------------------------------------

describe('OutputResolvedWeaponsCommand — resolveWeapons', () => {
  const parsedWeapons = {
    Minigun: {
      Inherits: '^MachineGun',
      ReloadDelay: 20,
      Range: '4c0',
      Report: 'mgun1.aud',
      Warhead: 'Bullet',
    },
    Bazooka: {
      Inherits: '^Rocket',
      ReloadDelay: 50,
      Range: '5c0',
      Report: 'rocket1.aud',
      Warhead: 'HE',
    },
    Sniper: {
      Inherits: '^SniperRifle',
      ReloadDelay: 60,
      Range: '7c0',
      Warhead: 'Sniper',
    },
  }

  it('should find and output weapon by key', () => {
    const cmd = new OutputResolvedWeaponsCommand()
    const log = vi.fn()
    const result = cmd.resolveWeapons('Minigun', parsedWeapons, null, log)

    expect(result).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.ReloadDelay).toBe(20)
    expect(parsed.Warhead).toBe('Bullet')
  })

  it('should return false for missing key', () => {
    const cmd = new OutputResolvedWeaponsCommand()
    const log = vi.fn()
    const result = cmd.resolveWeapons('Flamethrower', parsedWeapons, null, log)

    expect(result).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('should prefer map weapons over mod weapons', () => {
    const cmd = new OutputResolvedWeaponsCommand()
    const mapWeapons = {
      Minigun: { Inherits: '^MachineGun', ReloadDelay: 10, Range: '5c0' }, // Override
    }
    const log = vi.fn()
    const result = cmd.resolveWeapons('Minigun', parsedWeapons, mapWeapons, log)

    expect(result).toBe(true)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.ReloadDelay).toBe(10) // Map override
    expect(parsed.Range).toBe('5c0')
  })

  it('should output formatted JSON', () => {
    const cmd = new OutputResolvedWeaponsCommand()
    const log = vi.fn()
    cmd.resolveWeapons('Sniper', parsedWeapons, null, log)

    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.Range).toBe('7c0')
    expect(output).toContain('  ')
  })

  it('should find weapon not in map when map is non-null but does not contain key', () => {
    const cmd = new OutputResolvedWeaponsCommand()
    const mapWeapons = {
      Bazooka: { Inherits: '^Rocket', ReloadDelay: 40 },
    }
    const log = vi.fn()
    // Minigun is not in map, should come from mod
    const result = cmd.resolveWeapons('Minigun', parsedWeapons, mapWeapons, log)

    expect(result).toBe(true)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.ReloadDelay).toBe(20) // From mod, not map
  })
})
