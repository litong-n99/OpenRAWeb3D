import { describe, it, expect } from 'vitest'
import { add } from './math'

describe('math utils', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3)
  })

  it('handles negative numbers', () => {
    expect(add(-1, 1)).toBe(0)
  })
})
