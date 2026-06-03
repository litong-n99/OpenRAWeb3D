/**
 * SpatiallyPartitioned.test.ts — SpatiallyPartitioned migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { SpatiallyPartitioned } from './SpatiallyPartitioned'
import { Rectangle } from './Rectangle'

describe('SpatiallyPartitioned', () => {
  it('constructs with width, height, binSize', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 25)
    expect(sp.rows).toBe(4)
    expect(sp.cols).toBe(4)
    expect(sp.count).toBe(0)
  })

  it('add stores item and bounds', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    const bounds = new Rectangle(10, 10, 30, 30)
    sp.add('a', bounds)
    expect(sp.count).toBe(1)
    expect(sp.containsKey('a')).toBe(true)
  })

  it('throws on empty bounds', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    expect(() => sp.add('a', new Rectangle(0, 0, 0, 100))).toThrow(/empty/)
    expect(() => sp.add('a', new Rectangle(0, 0, 100, 0))).toThrow(/empty/)
  })

  it('at returns items at a point', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(0, 0, 50, 50))
    sp.add('b', new Rectangle(50, 50, 50, 50))

    expect(sp.at(25, 25)).toEqual(['a'])
    expect(sp.at(75, 75)).toEqual(['b'])
    expect(sp.at(125, 125)).toEqual([])
  })

  it('inBox returns items intersecting a rectangle', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(0, 0, 40, 40))
    sp.add('b', new Rectangle(60, 60, 40, 40))
    sp.add('c', new Rectangle(20, 20, 40, 40)) // overlaps with 'a'

    const results = sp.inBox(new Rectangle(10, 10, 15, 15))
    expect(results).toContain('a')
    expect(results).toContain('c')
    expect(results).not.toContain('b')
  })

  it('inBox handles multi-bin items without duplicates', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 25)
    // Add an item that spans multiple bins
    sp.add('big', new Rectangle(0, 0, 100, 100))

    const results = sp.inBox(new Rectangle(25, 25, 50, 50))
    // 'big' should appear exactly once
    expect(results.filter(x => x === 'big').length).toBe(1)
  })

  it('remove removes item', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(10, 10, 30, 30))
    expect(sp.count).toBe(1)

    const removed = sp.remove('a')
    expect(removed).toBe(true)
    expect(sp.count).toBe(0)
    expect(sp.containsKey('a')).toBe(false)
  })

  it('remove returns false for missing item', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    expect(sp.remove('missing')).toBe(false)
  })

  it('setItemBounds updates bounds', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(0, 0, 20, 20))

    // Update to a different location
    sp.setItemBounds('a', new Rectangle(80, 80, 20, 20))

    // Old location should no longer contain 'a'
    expect(sp.at(10, 10)).toEqual([])
    // New location should
    expect(sp.at(90, 90)).toEqual(['a'])
  })

  it('clear removes all items', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(0, 0, 20, 20))
    sp.add('b', new Rectangle(80, 80, 20, 20))
    expect(sp.count).toBe(2)

    sp.clear()
    expect(sp.count).toBe(0)
    expect(sp.at(10, 10)).toEqual([])
  })

  it('tryGetValue returns bounds', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(10, 20, 30, 40))

    const result = sp.tryGetValue('a')
    expect(result).toBeDefined()
    expect(result!.value.X).toBe(10)
    expect(result!.value.Y).toBe(20)
    expect(result!.value.Width).toBe(30)
    expect(result!.value.Height).toBe(40)
  })

  it('tryGetValue returns undefined for missing', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    expect(sp.tryGetValue('missing')).toBeUndefined()
  })

  it('keys and values iterate', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('a', new Rectangle(0, 0, 10, 10))
    sp.add('b', new Rectangle(50, 50, 10, 10))

    expect(Array.from(sp.keys()).sort()).toEqual(['a', 'b'])
    expect(Array.from(sp.values()).length).toBe(2)
  })

  it('iterator yields key-value pairs', () => {
    const sp = new SpatiallyPartitioned<string>(100, 100, 50)
    sp.add('x', new Rectangle(0, 0, 10, 10))
    const pairs = Array.from(sp)
    expect(pairs).toEqual([['x', new Rectangle(0, 0, 10, 10)]])
  })
})
