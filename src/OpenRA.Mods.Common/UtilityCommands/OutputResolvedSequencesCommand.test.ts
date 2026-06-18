/**
 * OutputResolvedSequencesCommand.test.ts — OutputResolvedSequencesCommand unit tests
 *
 * Tests: IUtilityCommand contract, argument validation, resolveSequences lookup,
 * missing key handling, map override.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect, vi } from 'vitest'
import { OutputResolvedSequencesCommand } from './OutputResolvedSequencesCommand.js'
import type { IUtilityCommand } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// IUtilityCommand contract
// ---------------------------------------------------------------------------

describe('OutputResolvedSequencesCommand — IUtilityCommand contract', () => {
  const command = new OutputResolvedSequencesCommand()

  it('should have correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--resolved-sequences')
  })

  it('should validate 2-3 arguments', () => {
    expect(command.validateArguments(['--resolved-sequences', 'infantry'])).toBe(true)
    expect(command.validateArguments(['--resolved-sequences', 'infantry', '/map/path'])).toBe(true)
  })

  it('should reject fewer than 2 arguments', () => {
    expect(command.validateArguments(['--resolved-sequences'])).toBe(false)
  })

  it('should reject more than 3 arguments', () => {
    expect(command.validateArguments(['--resolved-sequences', 'infantry', '/map', 'extra'])).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// resolveSequences
// ---------------------------------------------------------------------------

describe('OutputResolvedSequencesCommand — resolveSequences', () => {
  const parsedSequences = {
    infantry: {
      idle: { Length: 4, Facings: 8 },
      run: { Length: 6, Facings: 8 },
    },
    vehicle: {
      idle: { Length: 16, Facings: 32 },
    },
  }

  it('should find and output sequence by key', () => {
    const cmd = new OutputResolvedSequencesCommand()
    const log = vi.fn()
    const result = cmd.resolveSequences('infantry', parsedSequences, null, log)

    expect(result).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.idle.Length).toBe(4)
    expect(parsed.run.Facings).toBe(8)
  })

  it('should return false for missing key', () => {
    const cmd = new OutputResolvedSequencesCommand()
    const log = vi.fn()
    const result = cmd.resolveSequences('aircraft', parsedSequences, null, log)

    expect(result).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('should prefer map sequences over mod sequences', () => {
    const cmd = new OutputResolvedSequencesCommand()
    const mapSequences = {
      infantry: { idle: { Length: 8, Facings: 16 } }, // Override
    }
    const log = vi.fn()
    const result = cmd.resolveSequences('infantry', parsedSequences, mapSequences, log)

    expect(result).toBe(true)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.idle.Length).toBe(8) // Map override
    expect(parsed.idle.Facings).toBe(16)
  })

  it('should output formatted JSON', () => {
    const cmd = new OutputResolvedSequencesCommand()
    const log = vi.fn()
    cmd.resolveSequences('vehicle', parsedSequences, null, log)

    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.idle.Length).toBe(16)
    expect(output).toContain('  ')
  })

  it('should handle keys with only one sequence', () => {
    const singleSeq = { simple: { idle: { Length: 1 } } }
    const cmd = new OutputResolvedSequencesCommand()
    const log = vi.fn()
    const result = cmd.resolveSequences('simple', singleSeq, null, log)

    expect(result).toBe(true)
    const output = log.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.idle.Length).toBe(1)
  })
})
