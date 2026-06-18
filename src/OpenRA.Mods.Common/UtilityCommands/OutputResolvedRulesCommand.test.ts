/**
 * OutputResolvedRulesCommand.test.ts — OutputResolvedRulesCommand unit tests
 *
 * Tests: IUtilityCommand contract, argument validation, resolveRules lookup,
 * missing key handling, map override.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect, vi } from 'vitest'
import { OutputResolvedRulesCommand } from './OutputResolvedRulesCommand.js'
import type { IUtilityCommand } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCommand(): OutputResolvedRulesCommand {
  return new OutputResolvedRulesCommand()
}

// ---------------------------------------------------------------------------
// IUtilityCommand contract
// ---------------------------------------------------------------------------

describe('OutputResolvedRulesCommand — IUtilityCommand contract', () => {
  const command = makeCommand()

  it('should have correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--resolved-rules')
  })

  it('should validate 2-3 arguments', () => {
    expect(command.validateArguments(['--resolved-rules', 'e1'])).toBe(true)
    expect(command.validateArguments(['--resolved-rules', 'e1', '/path/to/map'])).toBe(true)
  })

  it('should reject fewer than 2 arguments', () => {
    expect(command.validateArguments(['--resolved-rules'])).toBe(false)
  })

  it('should reject more than 3 arguments', () => {
    expect(command.validateArguments(['--resolved-rules', 'e1', '/map', 'extra'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveRules
// ---------------------------------------------------------------------------

describe('OutputResolvedRulesCommand — resolveRules', () => {
  const parsedRules = {
    e1: { Inherits: '^Soldier', Valued: { Cost: 100 } },
    e2: { Inherits: '^Soldier', Valued: { Cost: 150 } },
    harv: { Inherits: '^Tank', Valued: { Cost: 1400 } },
  }

  it('should find and output rule by key', () => {
    const cmd = makeCommand()
    const log = vi.fn()
    const result = cmd.resolveRules('e1', parsedRules, null, log)

    expect(result).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.Valued.Cost).toBe(100)
  })

  it('should return false for missing key', () => {
    const cmd = makeCommand()
    const log = vi.fn()
    const result = cmd.resolveRules('nonexistent', parsedRules, null, log)

    expect(result).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('should prefer map rules over mod rules', () => {
    const cmd = makeCommand()
    const mapRules = {
      e1: { Inherits: '^Soldier', Valued: { Cost: 50 } }, // Override in map
    }
    const log = vi.fn()
    // NOTE: getTopLevelNodeByKey checks mapRules first
    const result = cmd.resolveRules('e1', parsedRules, mapRules, log)

    expect(result).toBe(true)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    // Map rule overrides mod rule
    expect(parsed.Valued.Cost).toBe(50)
  })

  it('should find keys in mod rules when map is null', () => {
    const cmd = makeCommand()
    const log = vi.fn()
    const result = cmd.resolveRules('harv', parsedRules, null, log)

    expect(result).toBe(true)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.Valued.Cost).toBe(1400)
  })

  it('should output formatted JSON', () => {
    const cmd = makeCommand()
    const log = vi.fn()
    cmd.resolveRules('e1', parsedRules, null, log)

    const output = log.mock.calls[0][0] as string
    // Should be valid JSON with indentation
    const parsed = JSON.parse(output)
    expect(parsed).toBeDefined()
    expect(output).toContain('  ') // Indented
  })

  it('should return false for empty parsed rules', () => {
    const cmd = makeCommand()
    const log = vi.fn()
    const result = cmd.resolveRules('anything', {}, null, log)

    expect(result).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })
})
