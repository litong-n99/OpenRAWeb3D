/**
 * Int32Matrix4x4.test.ts — Int32Matrix4x4 migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { Int32Matrix4x4 } from './Int32Matrix4x4'

describe('Int32Matrix4x4', () => {
  const identity = new Int32Matrix4x4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  )

  const zero = new Int32Matrix4x4(
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  )

  it('stores all 16 fields correctly', () => {
    const m = new Int32Matrix4x4(
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    )
    expect(m.m11).toBe(1)
    expect(m.m12).toBe(2)
    expect(m.m13).toBe(3)
    expect(m.m14).toBe(4)
    expect(m.m21).toBe(5)
    expect(m.m22).toBe(6)
    expect(m.m23).toBe(7)
    expect(m.m24).toBe(8)
    expect(m.m31).toBe(9)
    expect(m.m32).toBe(10)
    expect(m.m33).toBe(11)
    expect(m.m34).toBe(12)
    expect(m.m41).toBe(13)
    expect(m.m42).toBe(14)
    expect(m.m43).toBe(15)
    expect(m.m44).toBe(16)
  })

  it('truncates to int32', () => {
    const m = new Int32Matrix4x4(
      1.7, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    )
    expect(m.m11).toBe(1)
  })

  it('equals returns true for identical matrices', () => {
    expect(identity.equals(identity)).toBe(true)
    expect(Int32Matrix4x4.equals(identity, identity)).toBe(true)
  })

  it('equals returns false for different matrices', () => {
    expect(identity.equals(zero)).toBe(false)
    expect(Int32Matrix4x4.equals(identity, zero)).toBe(false)
  })

  it('equals catches single-field differences', () => {
    const m1 = new Int32Matrix4x4(
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    )
    const m2 = new Int32Matrix4x4(
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    )
    expect(m1.equals(m2)).toBe(false)
  })

  it('toString produces correct format', () => {
    expect(identity.toString()).toBe(
      '[1 0 0 0],[0 1 0 0],[0 0 1 0],[0 0 0 1]',
    )
  })
})
