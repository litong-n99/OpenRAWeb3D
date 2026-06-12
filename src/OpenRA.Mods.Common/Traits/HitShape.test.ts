/**
 * HitShape.test.ts -- Unit tests for HitShape trait
 */

import { describe, it, expect } from 'vitest'
import { HitShape, HitShapeInfo } from './HitShape.js'
import { CircleShape } from './HitShape/CircleShape.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'

describe('HitShape', () => {
  describe('HitShapeInfo', () => {
    it('has default CircleShape', () => {
      const info = new HitShapeInfo()
      expect(info.type instanceof CircleShape).toBe(true)
    })

    it('accepts custom shape', () => {
      const circle = new CircleShape({ radius: 512 })
      const info = new HitShapeInfo({ type: circle })
      expect(info.type).toBe(circle)
    })

    it('has default targetableOffsets [WVec.Zero]', () => {
      const info = new HitShapeInfo()
      expect(info.targetableOffsets.length).toBe(1)
      expect(WVec.equals(info.targetableOffsets[0]!, WVec.Zero)).toBe(true)
    })
  })

  describe('HitShape trait', () => {
    it('computes targetable positions', () => {
      const info = new HitShapeInfo({
        type: new CircleShape({ radius: 512 }),
        targetableOffsets: [new WVec(100, 0, 0)],
      })
      const hitShape = new HitShape(info)
      const actor = { centerPosition: new WPos(500, 500, 0), orientation: undefined }
      const positions = hitShape.targetablePositions(actor as never)
      expect(positions.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty array when trait is disabled', () => {
      const info = new HitShapeInfo()
      const hitShape = new HitShape(info)
      const internal = hitShape as unknown as { _enabled: boolean }
      internal._enabled = false
      const actor = {} as never
      const positions = hitShape.targetablePositions(actor)
      expect(positions.length).toBe(0)
    })

    it('distanceFromEdge delegates to shape type', () => {
      const circle = new CircleShape({ radius: 500 })
      circle.initialize()
      const info = new HitShapeInfo({ type: circle })
      const hitShape = new HitShape(info)
      const actor = {
        centerPosition: new WPos(0, 0, 0),
      }
      const dist = hitShape.distanceFromEdge(actor as never, new WPos(1000, 0, 0))
      expect(dist.length).toBeGreaterThan(0)
    })

    // MAJOR 9 fix: cache key uses string concatenation, not JSON.stringify
    it('caches targetable positions with string-concat key', () => {
      const circle = new CircleShape({ radius: 500 })
      circle.initialize()
      const info = new HitShapeInfo({
        type: circle,
        targetableOffsets: [new WVec(100, 0, 0)],
      })
      const hitShape = new HitShape(info)
      const actor = {
        centerPosition: new WPos(500, 500, 0),
        orientation: undefined,
      }
      // First call computes and caches
      const pos1 = hitShape.targetablePositions(actor as never)
      // Second call returns cached result (cacheKey matches)
      const pos2 = hitShape.targetablePositions(actor as never)
      expect(pos1).toBe(pos2) // Same array reference (cached)
      // Non-JSON-stringify key: asterisk is valid separator in concat key
      expect(pos1.length).toBeGreaterThan(0)
    })
  })
})
