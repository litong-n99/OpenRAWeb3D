/**
 * ModelActorPreview.test.ts — ModelPreview unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ModelPreview } from './ModelActorPreview'
import { ModelRenderer } from '../Traits/World/ModelRenderer'
import { VoxelNormalsPalette } from '../Traits/World/VoxelNormalsPalette'
import { WPos } from '../../OpenRA.Game/WPos'
import { WRot } from '../../OpenRA.Game/WRot'
import { WVec } from '../../OpenRA.Game/WVec'
import { WAngle } from '../../OpenRA.Game/WAngle'
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

describe('ModelPreview', () => {
  let renderer: ModelRenderer
  let preview: ModelPreview

  beforeEach(() => {
    renderer = createMockRenderer()
    preview = new ModelPreview(
      renderer,
      [createMockAnimation()],
      WVec.Zero,
      0,
      12,
      WAngle.fromDegrees(50),
      WAngle.fromDegrees(240),
      new Float32Array([0.6, 0.6, 0.6]),
      new Float32Array([0.4, 0.4, 0.4]),
      WAngle.fromDegrees(85),
    )
  })

  describe('construction', () => {
    it('creates with all parameters', () => {
      expect(preview).toBeDefined()
    })
  })

  describe('tick', () => {
    it('is a no-op', () => {
      expect(() => preview.tick()).not.toThrow()
    })
  })

  describe('render', () => {
    it('returns a renderable array', () => {
      const result = preview.render(WPos.Zero)
      expect(result).toHaveLength(1)
    })
  })

  describe('renderUI', () => {
    it('returns a UI renderable array', () => {
      const result = preview.renderUI(100, 100, 1)
      expect(result).toHaveLength(1)
    })
  })
})
