/**
 * TypeDictionary.test.ts — TypeDictionary migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { TypeDictionary } from './TypeDictionary'

// ---------------------------------------------------------------------------
// Test classes
// ---------------------------------------------------------------------------

class HealthTrait {
  static readonly interfaces = ['HealthTrait', 'ITick', 'object']
  hp: number
  constructor(hp: number) { this.hp = hp }
}

class MobileTrait {
  static readonly interfaces = ['MobileTrait', 'ITick', 'object']
  speed: number
  constructor(speed: number) { this.speed = speed }
}

class ArmorTrait {
  static readonly interfaces = ['ArmorTrait', 'object']
  armor: number
  constructor(armor: number) { this.armor = armor }
}

// A class without interfaces should throw on add
class PlainClass {
  value: number
  constructor(value: number) { this.value = value }
}

describe('TypeDictionary', () => {
  it('constructs empty', () => {
    const td = new TypeDictionary()
    expect(td.size).toBe(0)
  })

  it('add registers object under all interfaces', () => {
    const td = new TypeDictionary()
    const health = new HealthTrait(100)
    td.add(health)

    expect(td.contains('HealthTrait')).toBe(true)
    expect(td.contains('ITick')).toBe(true)
    expect(td.contains('object')).toBe(true)
    expect(td.contains('MobileTrait')).toBe(false)
  })

  it('get returns the single object of a type', () => {
    const td = new TypeDictionary()
    const health = new HealthTrait(100)
    td.add(health)

    const result = td.get<HealthTrait>('HealthTrait')
    expect(result).toBe(health)
    expect(result.hp).toBe(100)
  })

  it('get throws if type not found', () => {
    const td = new TypeDictionary()
    expect(() => td.get('MissingType')).toThrow(
      /does not contain instance/,
    )
  })

  it('getOrDefault returns undefined for missing type', () => {
    const td = new TypeDictionary()
    expect(td.getOrDefault('MissingType')).toBeUndefined()
  })

  it('get throws if multiple objects of same type', () => {
    const td = new TypeDictionary()
    // Two different classes that both implement 'ITick'
    td.add(new HealthTrait(100))
    td.add(new MobileTrait(10))
    expect(() => td.get('ITick')).toThrow(/multiple instances/)
  })

  it('withInterface returns all objects of a type', () => {
    const td = new TypeDictionary()
    td.add(new HealthTrait(100))
    td.add(new MobileTrait(10))
    td.add(new ArmorTrait(5))

    const ticks = td.withInterface<{ hp?: number; speed?: number; armor?: number }>('ITick')
    expect(ticks.length).toBe(2)

    const objects = td.withInterface<unknown>('object')
    expect(objects.length).toBe(3)
  })

  it('remove deregisters from all interfaces', () => {
    const td = new TypeDictionary()
    const health = new HealthTrait(100)
    td.add(health)
    td.remove(health)

    expect(td.contains('HealthTrait')).toBe(false)
    expect(td.contains('ITick')).toBe(false)
  })

  it('remove handles object not in dictionary gracefully', () => {
    const td = new TypeDictionary()
    const health = new HealthTrait(100)
    // Does not throw
    td.remove(health)
  })

  it('add throws for class without interfaces', () => {
    const td = new TypeDictionary()
    const plain = new PlainClass(42)
    expect(() => td.add(plain)).toThrow(/does not declare static interfaces/)
  })

  it('supports clone constructor', () => {
    const td = new TypeDictionary()
    td.add(new HealthTrait(100))
    td.add(new ArmorTrait(5))

    const clone = new TypeDictionary(td)
    expect(clone.contains('HealthTrait')).toBe(true)
    expect(clone.contains('ArmorTrait')).toBe(true)

    const h = clone.get<HealthTrait>('HealthTrait')
    expect(h.hp).toBe(100)
  })

  it('trimExcess does not throw', () => {
    const td = new TypeDictionary()
    td.add(new HealthTrait(100))
    td.trimExcess()
  })
})
