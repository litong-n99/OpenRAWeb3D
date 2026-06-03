/**
 * Rectangle.test.ts — Rectangle migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { Rectangle } from './Rectangle'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('Rectangle construction', () => {
  it('stores X, Y, Width, Height', () => {
    const r = new Rectangle(10, 20, 100, 200)
    expect(r.X).toBe(10)
    expect(r.Y).toBe(20)
    expect(r.Width).toBe(100)
    expect(r.Height).toBe(200)
  })

  it('truncates to int32', () => {
    const r = new Rectangle(1.7, 2.3, 3.5, 4.8)
    expect(r.X).toBe(1)
    expect(r.Y).toBe(2)
    expect(r.Width).toBe(3)
    expect(r.Height).toBe(4)
  })

  it('has Empty static constant', () => {
    expect(Rectangle.Empty.X).toBe(0)
    expect(Rectangle.Empty.Y).toBe(0)
    expect(Rectangle.Empty.Width).toBe(0)
    expect(Rectangle.Empty.Height).toBe(0)
    expect(Rectangle.Empty.isEmpty).toBe(true)
  })

  it('fromLTRB computes width and height', () => {
    const r = Rectangle.fromLTRB(10, 20, 110, 220)
    expect(r.X).toBe(10)
    expect(r.Y).toBe(20)
    expect(r.Width).toBe(100)
    expect(r.Height).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Edge properties
// ---------------------------------------------------------------------------

describe('Rectangle edge properties', () => {
  it('Left equals X', () => {
    const r = new Rectangle(10, 20, 100, 200)
    expect(r.Left).toBe(10)
  })

  it('Right equals X + Width', () => {
    const r = new Rectangle(10, 20, 100, 200)
    expect(r.Right).toBe(110)
  })

  it('Top equals Y', () => {
    const r = new Rectangle(10, 20, 100, 200)
    expect(r.Top).toBe(20)
  })

  it('Bottom equals Y + Height', () => {
    const r = new Rectangle(10, 20, 100, 200)
    expect(r.Bottom).toBe(220)
  })

  it('isEmpty true only for (0,0,0,0)', () => {
    expect(Rectangle.Empty.isEmpty).toBe(true)
    expect(new Rectangle(0, 0, 10, 0).isEmpty).toBe(false)
    expect(new Rectangle(0, 0, 0, 10).isEmpty).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Contains
// ---------------------------------------------------------------------------

describe('Rectangle.contains', () => {
  const r = new Rectangle(10, 20, 100, 200)

  it('point inside rectangle', () => {
    expect(r.contains(10, 20)).toBe(true)
    expect(r.contains(50, 100)).toBe(true)
  })

  it('point on left/top edge is inside', () => {
    expect(r.contains(10, 50)).toBe(true)
  })

  it('point on right/bottom edge is outside (exclusive)', () => {
    expect(r.contains(110, 50)).toBe(false)
    expect(r.contains(50, 220)).toBe(false)
  })

  it('point outside rectangle', () => {
    expect(r.contains(0, 0)).toBe(false)
    expect(r.contains(200, 300)).toBe(false)
  })

  it('containsRect for fully contained rect', () => {
    const inner = new Rectangle(20, 30, 50, 100)
    expect(r.containsRect(inner)).toBe(true)
  })

  it('containsRect for overlapping rect', () => {
    const overlapping = new Rectangle(100, 200, 50, 50)
    expect(r.containsRect(overlapping)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Intersection and union
// ---------------------------------------------------------------------------

describe('Rectangle intersection and union', () => {
  it('intersectsWith for overlapping rectangles', () => {
    const a = new Rectangle(0, 0, 100, 100)
    const b = new Rectangle(50, 50, 100, 100)
    expect(a.intersectsWith(b)).toBe(true)
  })

  it('intersectsWith for non-overlapping rectangles', () => {
    const a = new Rectangle(0, 0, 100, 100)
    const b = new Rectangle(200, 200, 100, 100)
    expect(a.intersectsWith(b)).toBe(false)
  })

  it('intersectsWith for adjacent (touching) rectangles', () => {
    const a = new Rectangle(0, 0, 100, 100)
    const b = new Rectangle(100, 0, 100, 100)
    // Adjacent means Left(100) < Right(100) is false → no intersection
    expect(a.intersectsWith(b)).toBe(false)
  })

  it('intersect returns intersection area', () => {
    const a = new Rectangle(0, 0, 100, 100)
    const b = new Rectangle(50, 50, 100, 100)
    const isect = Rectangle.intersect(a, b)
    expect(isect.X).toBe(50)
    expect(isect.Y).toBe(50)
    expect(isect.Width).toBe(50)
    expect(isect.Height).toBe(50)
  })

  it('intersect of non-overlapping returns Empty', () => {
    const a = new Rectangle(0, 0, 100, 100)
    const b = new Rectangle(200, 200, 100, 100)
    expect(Rectangle.intersect(a, b).isEmpty).toBe(true)
  })

  it('union returns bounding box', () => {
    const a = new Rectangle(0, 0, 100, 100)
    const b = new Rectangle(50, 50, 100, 100)
    const u = Rectangle.union(a, b)
    expect(u.Left).toBe(0)
    expect(u.Top).toBe(0)
    expect(u.Right).toBe(150)
    expect(u.Bottom).toBe(150)
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('Rectangle static operators', () => {
  it('equals checks all components', () => {
    const a = new Rectangle(1, 2, 3, 4)
    const b = new Rectangle(1, 2, 3, 4)
    expect(Rectangle.equals(a, b)).toBe(true)
    expect(Rectangle.equals(a, Rectangle.Empty)).toBe(false)
  })

  it('multiply scales all components', () => {
    const r = new Rectangle(1, 2, 3, 4)
    const scaled = Rectangle.multiply(2, r)
    expect(scaled.X).toBe(2)
    expect(scaled.Y).toBe(4)
    expect(scaled.Width).toBe(6)
    expect(scaled.Height).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('Rectangle standard methods', () => {
  it('instance equals matches static', () => {
    expect(new Rectangle(1, 2, 3, 4).equals(new Rectangle(1, 2, 3, 4))).toBe(true)
    expect(new Rectangle(1, 2, 3, 4).equals(new Rectangle(5, 6, 7, 8))).toBe(false)
  })

  it('toString returns components', () => {
    expect(new Rectangle(1, 2, 3, 4).toString()).toBe('1,2,3,4')
  })
})
