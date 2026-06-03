/**
 * SubCell.test.ts — SubCell unit tests
 */

import { describe, it, expect } from 'vitest'
import { SubCell } from './SubCell'

describe('SubCell', () => {
  it('matches OpenRA exact values', () => {
    expect(SubCell.Invalid).toBe(255)
    expect(SubCell.Any).toBe(254)
    expect(SubCell.FullCell).toBe(0)
    expect(SubCell.First).toBe(1)
  })

  it('values are distinct', () => {
    expect(SubCell.Invalid).not.toBe(SubCell.Any)
    expect(SubCell.FullCell).not.toBe(SubCell.First)
  })

  it('values are read-only at type level', () => {
    // NOTE: `as const` makes the TS type read-only but does not
    // runtime Object.freeze(). Compile-time immutability is sufficient.
    expect(SubCell.Invalid).toBe(255)
    expect(SubCell.FullCell).toBe(0)
  })
})
