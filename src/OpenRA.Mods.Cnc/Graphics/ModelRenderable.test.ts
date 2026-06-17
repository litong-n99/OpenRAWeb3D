/**
 * ModelRenderable.test.ts — ModelRenderable unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ModelRenderable } from './ModelRenderable'
import { ModelRenderer } from '../Traits/World/ModelRenderer'
import { VoxelNormalsPalette } from '../Traits/World/VoxelNormalsPalette'
import { WPos } from '../../OpenRA.Game/WPos'
import { WRot } from '../../OpenRA.Game/WRot'
import { WVec } from '../../OpenRA.Game/WVec'
import { ModelAnimation } from '../../OpenRA.Game/Graphics/ModelAnimation'
import type { IModel, IModelCache } from '../../OpenRA.Game/Graphics/Model'

function createMockModel(): IModel {
  return {
    frames: 1, sections: 1,
    transformationMatrix: () => new Float32Array(16),
    size: new Float32Array([1, 1, 1]),
    bounds: () => new Float32Array([-1, -1, -1, 1, 1, 1]),
    renderData: () => ({ start: 0, count: 4 }),
    aggregateBounds: { X: 0, Y: 0, Width: 2, Height: 2, Left: 0, Right: 2, Top: 0, Bottom: 2, isEmpty: false } as any,
  }
}

function createMockRenderer(): ModelRenderer {
  const modelCache: IModelCache = {
    getModel: () => createMockModel(),
    getModelSequence: () => createMockModel(),
    hasModelSequence: () => true,
  }
  return new ModelRenderer(
    { renderBufferSize: 2048 },
    modelCache,
    VoxelNormalsPalette.createTS(),
  )
}

function createMockAnimation(visible = true): ModelAnimation {
  const model = createMockModel()
  return new ModelAnimation(
    model, () => WVec.Zero, () => WRot.None,
    visible ? null : () => true, () => 0, true,
  )
}

describe('ModelRenderable', () => {
  let renderer: ModelRenderer

  beforeEach(() => {
    renderer = createMockRenderer()
  })

  describe('construction', () => {
    it('creates with all required parameters', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      expect(mr.pos.X).toBe(0)
      expect(mr.scale).toBe(12)
      expect(mr.alpha).toBe(1)
    })

    it('creates with custom alpha and tint', () => {
      const anim = createMockAnimation()
      const tint = new Float32Array([1, 0.5, 0])
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
        0.5, tint,
      )
      expect(mr.alpha).toBe(0.5)
      expect(mr.tint[1]).toBe(0.5)
    })
  })

  describe('prepareRender', () => {
    it('returns a render proxy', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const proxy = mr.prepareRender()
      expect(proxy).toBeDefined()
      expect(proxy.screenBounds).toBeDefined()
    })
  })

  describe('immutable setters', () => {
    it('offsetBy returns new instance with updated position', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const moved = mr.offsetBy(new WVec(1024, 0, 0))
      expect(moved.pos.X).toBe(1024)
      expect(mr.pos.X).toBe(0) // Original unchanged
    })

    it('withZOffset returns new instance', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const updated = mr.withZOffset(5)
      expect(updated.zOffset).toBe(5)
      expect(mr.zOffset).toBe(0)
    })

    it('withAlpha returns new instance', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const faded = mr.withAlpha(0.3)
      expect(faded.alpha).toBe(0.3)
      expect(mr.alpha).toBe(1)
    })

    it('withTint returns new instance', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const tinted = mr.withTint(new Float32Array([2, 0, 0]))
      expect(tinted.tint[0]).toBe(2)
      expect(mr.tint[0]).toBe(1)
    })

    it('asDecoration returns new instance with isDecoration true', () => {
      const anim = createMockAnimation()
      const mr = new ModelRenderable(
        renderer, [anim], WPos.Zero, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const dec = mr.asDecoration()
      expect(dec.isDecoration).toBe(true)
      expect(mr.isDecoration).toBe(false)
    })
  })
})
