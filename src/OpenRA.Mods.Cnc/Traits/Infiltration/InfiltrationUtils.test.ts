/**
 * InfiltrationUtils.test.ts — unit tests for type overlap utility
 */

import { describe, it, expect } from 'vitest'
import { typesOverlap } from './InfiltrationUtils.js'

describe('InfiltrationUtils', () => {
  describe('typesOverlap', () => {
    it('returns true when arrays share elements', () => {
      expect(typesOverlap(['A', 'B'], ['B', 'C'])).toBe(true)
    })

    it('returns false when arrays have no common elements', () => {
      expect(typesOverlap(['A', 'B'], ['C', 'D'])).toBe(false)
    })

    it('returns false when both arrays are empty', () => {
      expect(typesOverlap([], [])).toBe(false)
    })

    it('returns false when first array is empty', () => {
      expect(typesOverlap([], ['A'])).toBe(false)
    })

    it('returns false when second array is empty', () => {
      expect(typesOverlap(['A'], [])).toBe(false)
    })

    it('returns true for identical arrays', () => {
      expect(typesOverlap(['A', 'B'], ['A', 'B'])).toBe(true)
    })

    it('returns true for identical single-element arrays', () => {
      expect(typesOverlap(['Building'], ['Building'])).toBe(true)
    })

    it('handles large arrays', () => {
      const a = Array.from({ length: 100 }, (_, i) => `Type${i}`)
      const b = ['Type50', 'Type999']
      expect(typesOverlap(a, b)).toBe(true)
    })
  })
})
