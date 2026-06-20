/**
 * ActorEntryParser.test.ts — ActorEntryParser unit tests
 *
 * Tests focus on: parsing raw JSON entries, init type resolution,
 * error handling, array parsing.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  parseActorEntry,
  parseActorEntries,
  type ActorEntry,
} from './ActorEntryParser.js'
import { LocationInit, OwnerNameInit, FacingInit } from '../Traits/ActorInitializer.js'

// ---------------------------------------------------------------------------
// parseActorEntry — basic
// ---------------------------------------------------------------------------

describe('parseActorEntry', () => {
  it('parses entry with location', () => {
    const entry: ActorEntry = {
      type: 'e1',
      location: { x: 42, y: 17 },
    }
    const result = parseActorEntry(entry)
    expect(result.contains('LocationInit')).toBe(true)

    const loc = result.get<LocationInit>('LocationInit')
    expect(loc.value.X).toBe(42)
    expect(loc.value.Y).toBe(17)
  })

  it('parses entry with owner', () => {
    const entry: ActorEntry = {
      type: 'harv',
      owner: 'Multi0',
    }
    const result = parseActorEntry(entry)
    expect(result.contains('OwnerNameInit')).toBe(true)

    const owner = result.get<OwnerNameInit>('OwnerNameInit')
    expect(owner.value).toBe('Multi0')
  })

  it('parses entry with facing', () => {
    const entry: ActorEntry = {
      type: 'tank',
      facing: 256,
    }
    const result = parseActorEntry(entry)
    expect(result.contains('FacingInit')).toBe(true)

    const facing = result.get<FacingInit>('FacingInit')
    expect(facing.value).toBe(256)
  })

  it('parses entry with all fields', () => {
    const entry: ActorEntry = {
      type: 'mcv',
      location: { x: 10, y: 20 },
      owner: 'Multi1',
      facing: 128,
    }
    const result = parseActorEntry(entry)
    expect(result.contains('LocationInit')).toBe(true)
    expect(result.contains('OwnerNameInit')).toBe(true)
    expect(result.contains('FacingInit')).toBe(true)
    expect(result.size).toBe(3)
  })

  it('parses entry with minimal fields (type only)', () => {
    const entry: ActorEntry = { type: 'camera' }
    const result = parseActorEntry(entry)
    expect(result.size).toBe(0)
  })

  it('throws for missing type', () => {
    expect(() => parseActorEntry({ type: '' })).toThrow(
      'ActorEntryParser: entry is missing required field "type"',
    )
  })

  it('throws for null/undefined type', () => {
    expect(() => parseActorEntry({ type: null as unknown as string })).toThrow()
    expect(() => parseActorEntry({ type: undefined as unknown as string })).toThrow()
  })

  // -----------------------------------------------------------------------
  // Location edge cases
  // -----------------------------------------------------------------------

  it('skips location with missing x', () => {
    const entry: ActorEntry = {
      type: 'e1',
      location: { y: 10 } as { x: number; y: number },
    }
    const result = parseActorEntry(entry)
    expect(result.contains('LocationInit')).toBe(false)
  })

  it('skips location with missing y', () => {
    const entry: ActorEntry = {
      type: 'e1',
      location: { x: 10 } as { x: number; y: number },
    }
    const result = parseActorEntry(entry)
    expect(result.contains('LocationInit')).toBe(false)
  })

  it('skips null location', () => {
    const entry: ActorEntry = {
      type: 'e1',
      location: null,
    }
    const result = parseActorEntry(entry)
    expect(result.contains('LocationInit')).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Owner edge cases
  // -----------------------------------------------------------------------

  it('skips empty owner string', () => {
    const entry: ActorEntry = { type: 'e1', owner: '' }
    const result = parseActorEntry(entry)
    expect(result.contains('OwnerNameInit')).toBe(false)
  })

  it('skips null owner', () => {
    const entry: ActorEntry = { type: 'e1', owner: null }
    const result = parseActorEntry(entry)
    expect(result.contains('OwnerNameInit')).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Facing edge cases
  // -----------------------------------------------------------------------

  it('skips non-numeric facing', () => {
    const entry: ActorEntry = {
      type: 'e1',
      facing: 'north' as unknown as number,
    }
    const result = parseActorEntry(entry)
    expect(result.contains('FacingInit')).toBe(false)
  })

  it('handles facing = 0', () => {
    const entry: ActorEntry = { type: 'e1', facing: 0 }
    const result = parseActorEntry(entry)
    expect(result.contains('FacingInit')).toBe(true)
    expect(result.get<FacingInit>('FacingInit').value).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Unknown properties (ignored)
  // -----------------------------------------------------------------------

  it('ignores unknown properties', () => {
    const entry: ActorEntry = {
      type: 'e1',
      customField: 'value',
      extraData: 123,
    }
    // Should not throw
    const result = parseActorEntry(entry)
    expect(result.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// parseActorEntries — array parsing
// ---------------------------------------------------------------------------

describe('parseActorEntries', () => {
  it('parses multiple entries', () => {
    const entries: ActorEntry[] = [
      { type: 'e1', location: { x: 1, y: 1 } },
      { type: 'e2', location: { x: 2, y: 2 } },
      { type: 'harv', owner: 'Multi0' },
    ]
    const results = parseActorEntries(entries)

    expect(results).toHaveLength(3)
    expect(results[0].type).toBe('e1')
    expect(results[1].type).toBe('e2')
    expect(results[2].type).toBe('harv')
  })

  it('returns empty array for empty input', () => {
    const results = parseActorEntries([])
    expect(results).toEqual([])
  })

  it('skips invalid entries (missing type)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const entries: ActorEntry[] = [
      { type: '' }, // Invalid
      { type: 'valid', location: { x: 1, y: 1 } }, // Valid
    ]
    const results = parseActorEntries(entries)

    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('valid')
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })

  it('result has type and initializer', () => {
    const entries: ActorEntry[] = [
      { type: 'mcv', location: { x: 5, y: 5 }, owner: 'Multi0' },
    ]
    const results = parseActorEntries(entries)

    expect(results[0].type).toBe('mcv')
    expect(results[0].initializer).toBeDefined()
    expect(results[0].initializer.contains('LocationInit')).toBe(true)
    expect(results[0].initializer.contains('OwnerNameInit')).toBe(true)
  })
})
