/**
 * BlockedByActor.test.ts — BlockedByActor enum unit tests
 *
 * Tests focus on:
 * - Enum values match OpenRA
 * - Type safety
 */

import { describe, it, expect } from 'vitest'
import { BlockedByActor } from './BlockedByActor'

// ---------------------------------------------------------------------------
// Enum value tests
// ---------------------------------------------------------------------------

describe('BlockedByActor enum values', () => {
  it('None equals 0', () => {
    expect(BlockedByActor.None).toBe(0)
  })

  it('Immovable equals 1', () => {
    expect(BlockedByActor.Immovable).toBe(1)
  })

  it('Stationary equals 2', () => {
    expect(BlockedByActor.Stationary).toBe(2)
  })

  it('All equals 3', () => {
    expect(BlockedByActor.All).toBe(3)
  })

  it('values are ordered by restrictiveness', () => {
    expect(BlockedByActor.None).toBeLessThan(BlockedByActor.Immovable)
    expect(BlockedByActor.Immovable).toBeLessThan(BlockedByActor.Stationary)
    expect(BlockedByActor.Stationary).toBeLessThan(BlockedByActor.All)
  })
})

// ---------------------------------------------------------------------------
// Usage tests
// ---------------------------------------------------------------------------

describe('BlockedByActor usage', () => {
  it('can be used in comparisons', () => {
    const check = BlockedByActor.Stationary
    expect(check <= BlockedByActor.Stationary).toBe(true)
    expect(check <= BlockedByActor.All).toBe(true)
    expect(check <= BlockedByActor.Immovable).toBe(false)
  })

  it('can be used in switch-like logic', () => {
    function getDescription(level: BlockedByActor): string {
      switch (level) {
        case BlockedByActor.None:
          return 'none'
        case BlockedByActor.Immovable:
          return 'immovable'
        case BlockedByActor.Stationary:
          return 'stationary'
        case BlockedByActor.All:
          return 'all'
        default:
          return 'unknown'
      }
    }

    expect(getDescription(BlockedByActor.None)).toBe('none')
    expect(getDescription(BlockedByActor.All)).toBe('all')
  })
})
