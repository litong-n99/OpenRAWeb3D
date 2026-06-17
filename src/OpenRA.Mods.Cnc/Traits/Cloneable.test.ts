/**
 * Cloneable.test.ts — Cloneable marker trait unit tests
 */

import { describe, it, expect } from 'vitest'
import { Cloneable, CloneableInfo } from './Cloneable.js'

describe('CloneableInfo', () => {
  it('should create with default empty types set', () => {
    const info = new CloneableInfo()
    expect(info.types.size).toBe(0)
  })

  it('should create with specified types', () => {
    const info = new CloneableInfo({ types: new Set(['Infantry', 'Vehicle']) })
    expect(info.types.size).toBe(2)
    expect(info.types.has('Infantry')).toBe(true)
    expect(info.types.has('Vehicle')).toBe(true)
  })

  it('should create a Cloneable instance', () => {
    const info = new CloneableInfo()
    const trait = info.create({} as any)
    expect(trait).toBeInstanceOf(Cloneable)
  })
})

describe('Cloneable', () => {
  it('should be instantiable', () => {
    const c = new Cloneable()
    expect(c).toBeDefined()
    expect(c).toBeInstanceOf(Cloneable)
  })
})
