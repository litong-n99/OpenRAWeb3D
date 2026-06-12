/**
 * CircleShape.test.ts -- Unit tests for CircleShape
 */

import { describe, it, expect } from 'vitest'
import { CircleShape } from './CircleShape.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'

describe('CircleShape', () => {
  it('has default radius 0', () => {
    const shape = new CircleShape()
    expect(shape.radius).toBe(0)
  })

  it('accepts radius', () => {
    const shape = new CircleShape({ radius: 512 })
    shape.initialize()
    expect(shape.radius).toBe(512)
  })

  it('distanceFromEdge is 0 for point inside circle', () => {
    const shape = new CircleShape({ radius: 1024 })
    shape.initialize()
    const origin = new WPos(0, 0, 0)
    const pos = new WPos(512, 0, 0) // Inside radius 1024
    const dist = shape.distanceFromEdge(pos, origin, WRot.None)
    expect(WDist.equals(dist, WDist.Zero)).toBe(true)
  })

  it('distanceFromEdge is 0 for point on edge', () => {
    const shape = new CircleShape({ radius: 1024 })
    shape.initialize()
    const origin = new WPos(0, 0, 0)
    const pos = new WPos(1024, 0, 0) // Exactly on edge
    const dist = shape.distanceFromEdge(pos, origin, WRot.None)
    expect(WDist.equals(dist, WDist.Zero)).toBe(true)
  })

  it('distanceFromEdge computes correct distance outside', () => {
    const shape = new CircleShape({ radius: 500 })
    shape.initialize()
    const origin = new WPos(0, 0, 0)
    const pos = new WPos(1000, 0, 0) // 500 units outside
    const dist = shape.distanceFromEdge(pos, origin, WRot.None)
    expect(dist.length).toBeGreaterThan(0)
    // distance = 1000 - 500 = 500 (within sqrt tolerance)
    expect(Math.abs(dist.length - 500)).toBeLessThanOrEqual(2)
  })

  it('distanceFromEdge ignores orientation (circle is rotation-agnostic)', () => {
    const shape = new CircleShape({ radius: 1024 })
    shape.initialize()
    const origin = new WPos(0, 0, 0)
    const pos = new WPos(0, 1500, 0)
    // Any orientation should give the same result
    const dist1 = shape.distanceFromEdge(pos, origin, WRot.None)
    const dist2 = shape.distanceFromEdge(pos, origin, WRot.fromFacing(128))
    expect(dist1.length).toBe(dist2.length)
  })
})
