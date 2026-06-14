/**
 * Exit.test.ts — Exit migration unit tests
 *
 * Tests focus on:
 * - ExitInfo defaults and custom constructor params
 * - ExitExts.nearestExitOrDefault priority and filtering
 * - ExitExts.exits filtering by productionType and predicate
 * - ExitExts.randomExitOrDefault priority grouping
 * - Edge cases: empty exits, all disabled, no matching production type
 */

import { describe, it, expect } from 'vitest'
import { Exit, ExitInfo, ExitExts } from './Exit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createExit(overrides: Partial<{
  productionTypes: readonly string[]
  priority: number
  exitDelay: number
  isTraitDisabled: boolean
}> = {}): Exit {
  const info = new ExitInfo({
    productionTypes: overrides.productionTypes ?? [],
    priority: overrides.priority ?? 1,
    exitDelay: overrides.exitDelay ?? 0,
  })
  const exit = new Exit(info)
  if (overrides.isTraitDisabled !== undefined) {
    exit.isTraitDisabled = overrides.isTraitDisabled
  }
  return exit
}

// ---------------------------------------------------------------------------
// ExitInfo
// ---------------------------------------------------------------------------

describe('ExitInfo', () => {
  it('defaults productionTypes to empty set', () => {
    const info = new ExitInfo()
    expect(info.productionTypes.size).toBe(0)
  })

  it('accepts productionTypes as string array', () => {
    const info = new ExitInfo({ productionTypes: ['Infantry', 'Vehicle'] })
    expect(info.productionTypes.has('Infantry')).toBe(true)
    expect(info.productionTypes.has('Vehicle')).toBe(true)
  })

  it('defaults priority to 1', () => {
    const info = new ExitInfo()
    expect(info.priority).toBe(1)
  })

  it('accepts custom priority', () => {
    const info = new ExitInfo({ priority: 5 })
    expect(info.priority).toBe(5)
  })

  it('defaults exitDelay to 0', () => {
    const info = new ExitInfo()
    expect(info.exitDelay).toBe(0)
  })

  it('defaults spawnOffset to null', () => {
    const info = new ExitInfo()
    expect(info.spawnOffset).toBeNull()
  })

  it('defaults exitCell to null', () => {
    const info = new ExitInfo()
    expect(info.exitCell).toBeNull()
  })

  it('defaults facing to null', () => {
    const info = new ExitInfo()
    expect(info.facing).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------

describe('Exit', () => {
  it('is not disabled by default', () => {
    const exit = createExit()
    expect(exit.isTraitDisabled).toBe(false)
  })

  it('stores the info reference', () => {
    const info = new ExitInfo({ priority: 3 })
    const exit = new Exit(info)
    expect(exit.info).toBe(info)
  })
})

// ---------------------------------------------------------------------------
// ExitExts.exits
// ---------------------------------------------------------------------------

describe('ExitExts.exits', () => {
  it('returns all non-disabled exits when no filter', () => {
    const e1 = createExit()
    const e2 = createExit()
    const e3 = createExit({ isTraitDisabled: true })
    const result = ExitExts.exits([e1, e2, e3])
    expect(result).toEqual([e1, e2])
  })

  it('returns empty when all exits disabled', () => {
    const e1 = createExit({ isTraitDisabled: true })
    const e2 = createExit({ isTraitDisabled: true })
    const result = ExitExts.exits([e1, e2])
    expect(result).toEqual([])
  })

  it('filters by productionType', () => {
    const e1 = createExit({ productionTypes: ['Infantry'] })
    const e2 = createExit({ productionTypes: ['Vehicle'] })
    const result = ExitExts.exits([e1, e2], 'Infantry')
    expect(result).toEqual([e1])
  })

  it('includes exit with empty productionTypes for any type', () => {
    const e1 = createExit({ productionTypes: [] })
    const e2 = createExit({ productionTypes: ['Vehicle'] })
    const result = ExitExts.exits([e1, e2], 'Infantry')
    expect(result).toEqual([e1])
  })

  it('applies predicate filter', () => {
    const e1 = createExit({ priority: 1 })
    const e2 = createExit({ priority: 2 })
    const result = ExitExts.exits([e1, e2], null, (e) => e.info.priority > 1)
    expect(result).toEqual([e2])
  })

  it('returns empty for empty input', () => {
    const result = ExitExts.exits([])
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ExitExts.nearestExitOrDefault
// ---------------------------------------------------------------------------

describe('ExitExts.nearestExitOrDefault', () => {
  it('returns null for empty exits', () => {
    const result = ExitExts.nearestExitOrDefault([], null)
    expect(result).toBeNull()
  })

  it('returns null when all disabled', () => {
    const e1 = createExit({ isTraitDisabled: true })
    const result = ExitExts.nearestExitOrDefault([e1], null)
    expect(result).toBeNull()
  })

  it('returns highest priority exit', () => {
    const e1 = createExit({ priority: 1 })
    const e2 = createExit({ priority: 3 })
    const e3 = createExit({ priority: 2 })
    const result = ExitExts.nearestExitOrDefault([e1, e2, e3], null)
    expect(result).toBe(e2)
  })

  it('filters by productionType', () => {
    const e1 = createExit({ productionTypes: ['Infantry'], priority: 5 })
    const e2 = createExit({ productionTypes: ['Vehicle'], priority: 10 })
    const result = ExitExts.exits([e1, e2], "Infantry")[0]
    expect(result).toBe(e1)
  })

  it('applies predicate filter', () => {
    const e1 = createExit({ priority: 5 })
    const e2 = createExit({ priority: 3 })
    const result = ExitExts.exits([e1, e2], null, (e: Exit) => e.info.priority < 4)[0]
    expect(result).toBe(e2)
  })
})

// ---------------------------------------------------------------------------
// ExitExts.randomExitOrDefault
// ---------------------------------------------------------------------------

describe('ExitExts.randomExitOrDefault', () => {
  it('returns null for empty exits', () => {
    const result = ExitExts.randomExitOrDefault([])
    expect(result).toBeNull()
  })

  it('returns null when all disabled', () => {
    const e1 = createExit({ isTraitDisabled: true })
    const result = ExitExts.randomExitOrDefault([e1])
    expect(result).toBeNull()
  })

  it('returns exit from highest priority group', () => {
    const e1 = createExit({ priority: 1 })
    const e2 = createExit({ priority: 3 })
    const e3 = createExit({ priority: 2 })
    const result = ExitExts.randomExitOrDefault([e1, e2, e3])
    // Should always return e2 (only exit in priority 3 group)
    expect(result).toBe(e2)
  })

  it('returns one of multiple exits in highest priority group', () => {
    const e1 = createExit({ priority: 1 })
    const e2 = createExit({ priority: 3 })
    const e3 = createExit({ priority: 3 })
    const result = ExitExts.randomExitOrDefault([e1, e2, e3])
    // Should return either e2 or e3
    expect(result === e2 || result === e3).toBe(true)
  })

  it('filters by productionType', () => {
    const e1 = createExit({ productionTypes: ['Infantry'], priority: 5 })
    const e2 = createExit({ productionTypes: ['Vehicle'], priority: 10 })
    const result = ExitExts.randomExitOrDefault([e1, e2], 'Infantry')
    expect(result).toBe(e1)
  })
})
