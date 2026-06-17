/**
 * UIModelRenderable.test.ts — UIModelRenderable unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { UIModelRenderable } from './UIModelRenderable'
import { ModelRenderer } from '../Traits/World/ModelRenderer'
import { VoxelNormalsPalette } from '../Traits/World/VoxelNormalsPalette'
import { WPos } from '../../OpenRA.Game/WPos'
import { WRot } from '../../OpenRA.Game/WRot'
import { WVec } from '../../OpenRA.Game/WVec'
import { ModelAnimation } from '../../OpenRA.Game/Graphics/ModelAnimation'
import type { IModel, IModelCache } from '../../OpenRA.Game/Graphics/Model'

function createMockRenderer(): ModelRenderer {
  const model: IModel = {
    frames: 1, sections: 1,
    transformationMatrix: () => new Float32Array(16),
    size: new Float32Array([1, 1, 1]),
    bounds: () => new Float32Array([-1, -1, -1, 1, 1, 1]),
    renderData: () => ({ start: 0, count: 4 }),
    aggregateBounds: { X: 0, Y: 0, Width: 2, Height: 2, Left: 0, Right: 2, Top: 0, Bottom: 2, isEmpty: false } as any,
  }
  const modelCache: IModelCache = {
    getModel: () => model,
    getModelSequence: () => model,
    hasModelSequence: () => true,
  }
  return new ModelRenderer(
    { renderBufferSize: 2048 },
    modelCache,
    VoxelNormalsPalette.createTS(),
  )
}

function createMockAnimation(): ModelAnimation {
  return new ModelAnimation(
    { frames: 1, sections: 1, transformationMatrix: () => new Float32Array(16), size: new Float32Array([1,1,1]), bounds: () => new Float32Array([-1,-1,-1,1,1,1]), renderData: () => ({ start: 0, count: 4 }), aggregateBounds: { X: 0, Y: 0, Width: 2, Height: 2, Left: 0, Right: 2, Top: 0, Bottom: 2, isEmpty: false } as any },
    () => WVec.Zero, () => WRot.None, null, () => 0, true,
  )
}

describe('UIModelRenderable', () => {
  let renderer: ModelRenderer

  beforeEach(() => {
    renderer = createMockRenderer()
  })

  describe('construction', () => {
    it('creates with all parameters', () => {
      const ui = new UIModelRenderable(
        renderer,
        [createMockAnimation()],
        WPos.Zero,
        100, 200,
        0,
        WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      expect(ui.screenX).toBe(100)
      expect(ui.screenY).toBe(200)
      expect(ui.zOffset).toBe(0)
      expect(ui.isDecoration).toBe(false)
    })
  })

  describe('prepareRender', () => {
    it('returns a render proxy', () => {
      const ui = new UIModelRenderable(
        renderer,
        [createMockAnimation()],
        WPos.Zero,
        100, 100, 0, WRot.None, 12,
        WRot.None,
        new Float32Array([0.6, 0.6, 0.6]),
        new Float32Array([0.4, 0.4, 0.4]),
        WRot.None,
      )
      const proxy = ui.prepareRender()
      expect(proxy).toBeDefined()
    })
  })
})
