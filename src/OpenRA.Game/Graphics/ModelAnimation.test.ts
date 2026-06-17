/**
 * ModelAnimation.test.ts — ModelAnimation unit tests
 */

import { describe, it, expect } from 'vitest'
import { ModelAnimation } from './ModelAnimation'
import { WVec } from '../WVec'
import { WRot } from '../WRot'
import { WAngle } from '../WAngle'
import { WPos } from '../WPos'
import { Rectangle } from '../Primitives/Rectangle'
import type { IModel } from './Model'

function createMockModel(aggregateBounds: Rectangle = Rectangle.fromLTRB(-1, -1, 1, 1)): IModel {
  return {
    frames: 1,
    sections: 1,
    transformationMatrix: () => new Float32Array(16),
    size: new Float32Array([1, 1, 1]),
    bounds: () => new Float32Array([-1, -1, -1, 1, 1, 1]),
    renderData: () => ({ start: 0, count: 4 }),
    aggregateBounds,
  }
}

describe('ModelAnimation', () => {
  describe('construction', () => {
    it('creates with all required parameters', () => {
      const model = createMockModel()
      const anim = new ModelAnimation(
        model,
        () => WVec.Zero,
        () => WRot.None,
        null,
        () => 0,
        true,
      )
      expect(anim.model).toBe(model)
      expect(anim.isVisible).toBe(true)
      expect(anim.showShadow).toBe(true)
    })

    it('is visible when disableFunc returns false (not disabled)', () => {
      const model = createMockModel()
      const anim = new ModelAnimation(
        model,
        () => WVec.Zero,
        () => WRot.None,
        () => false, // disableFunc returns false = NOT disabled
        () => 0,
        true,
      )
      expect(anim.isVisible).toBe(true)
    })

    it('is hidden when disableFunc returns true (disabled)', () => {
      const model = createMockModel()
      const anim = new ModelAnimation(
        model,
        () => WVec.Zero,
        () => WRot.None,
        () => true, // disableFunc returns true = disabled
        () => 0,
        true,
      )
      expect(anim.isVisible).toBe(false)
    })
  })

  describe('isVisible', () => {
    it('returns true when disableFunc is null', () => {
      const model = createMockModel()
      const anim = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, null, () => 0, false,
      )
      expect(anim.isVisible).toBe(true)
    })

    it('returns false when disableFunc returns true (actor disabled)', () => {
      const model = createMockModel()
      const anim = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, () => true, () => 0, false,
      )
      expect(anim.isVisible).toBe(false)
    })

    it('returns true when disableFunc returns false (actor not disabled)', () => {
      const model = createMockModel()
      const anim = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, () => false, () => 0, false,
      )
      expect(anim.isVisible).toBe(true)
    })
  })

  describe('offset and rotation callbacks', () => {
    it('calls offsetFunc to get the offset', () => {
      const model = createMockModel()
      const offset = new WVec(100, 200, 0)
      const anim = new ModelAnimation(
        model, () => offset, () => WRot.None, null, () => 0, false,
      )
      const result = anim.offsetFunc()
      expect(result.X).toBe(100)
      expect(result.Y).toBe(200)
      expect(result.Z).toBe(0)
    })

    it('calls rotationFunc to get the rotation', () => {
      const model = createMockModel()
      const rot = WRot.fromFacing(16)
      const anim = new ModelAnimation(
        model, () => WVec.Zero, () => rot, null, () => 0, false,
      )
      const result = anim.rotationFunc()
      expect(WRot.equals(result, rot)).toBe(true)
    })

    it('calls frameFunc to get the frame', () => {
      const model = createMockModel()
      let frameValue = 0
      const anim = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, null, () => frameValue, false,
      )
      expect(anim.frameFunc()).toBe(0)
      frameValue = 3
      expect(anim.frameFunc()).toBe(3)
    })
  })

  describe('screenBounds', () => {
    it('computes bounds from aggregateBounds and scale', () => {
      const model = createMockModel(Rectangle.fromLTRB(-2, -2, 2, 2))
      const anim = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, null, () => 0, false,
      )
      const bounds = anim.screenBounds(WPos.Zero, 100, 100, 12)
      expect(bounds.Left).toBeLessThanOrEqual(100 - 20) // 100 + (-2 * 12) ≈ 76
      expect(bounds.Right).toBeGreaterThanOrEqual(100 + 20) // 100 + (2 * 12) ≈ 124
    })

    it('applies offset to screen bounds', () => {
      const model = createMockModel(Rectangle.fromLTRB(-1, -1, 1, 1))
      const offset = new WVec(1024, 0, 0) // 1 cell offset
      const anim = new ModelAnimation(
        model, () => offset, () => WRot.None, null, () => 0, false,
      )
      const boundsNoOffset = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, null, () => 0, false,
      ).screenBounds(WPos.Zero, 100, 100, 12)
      const boundsWithOffset = anim.screenBounds(WPos.Zero, 100, 100, 12)
      // offset should shift the bounds
      expect(boundsWithOffset.Left).toBeGreaterThan(boundsNoOffset.Left)
    })
  })

  describe('showShadow', () => {
    it('stores showShadow flag', () => {
      const model = createMockModel()
      const withShadow = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, null, () => 0, true,
      )
      const withoutShadow = new ModelAnimation(
        model, () => WVec.Zero, () => WRot.None, null, () => 0, false,
      )
      expect(withShadow.showShadow).toBe(true)
      expect(withoutShadow.showShadow).toBe(false)
    })
  })
})
