/**
 * WithVoxelBody.test.ts — WithVoxelBody unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WithVoxelBody, type WithVoxelBodyInfo } from './WithVoxelBody'
import { RenderVoxels, defaultRenderVoxelsInfo } from './RenderVoxels'
import { ModelRenderer } from '../World/ModelRenderer'
import { VoxelNormalsPalette } from '../World/VoxelNormalsPalette'
import { WRot } from '../../../OpenRA.Game/WRot'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { WPos } from '../../../OpenRA.Game/WPos'
import type { IModel, IModelCache } from '../../../OpenRA.Game/Graphics/Model'

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

function createMockModelCache(): IModelCache {
  return {
    getModel: () => createMockModel(),
    getModelSequence: () => createMockModel(),
    hasModelSequence: () => true,
  }
}

function createMockRenderer(): ModelRenderer {
  return new ModelRenderer(
    { renderBufferSize: 2048 },
    createMockModelCache(),
    VoxelNormalsPalette.createTS(),
  )
}

describe('WithVoxelBody', () => {
  let renderer: ModelRenderer
  let renderVoxels: RenderVoxels
  let modelCache: IModelCache
  let info: WithVoxelBodyInfo

  beforeEach(() => {
    renderer = createMockRenderer()
    modelCache = createMockModelCache()
    renderVoxels = new RenderVoxels(
      defaultRenderVoxelsInfo(),
      renderer,
      WAngle.fromDegrees(85),
      'testActor',
    )
    info = {
      sequence: 'idle',
      offset: WVec.Zero,
      showShadow: true,
    }
  })

  describe('construction', () => {
    it('creates and registers with RenderVoxels', () => {
      const body = new WithVoxelBody(
        info, renderVoxels, modelCache,
        () => WRot.None,
      )
      expect(body.modelAnimation).toBeDefined()
      expect(body.renderVoxels).toBe(renderVoxels)
      expect(renderVoxels.components).toHaveLength(1)
    })

    it('registers the body model animation', () => {
      const body = new WithVoxelBody(
        info, renderVoxels, modelCache,
        () => WRot.None,
      )
      expect(renderVoxels.components[0]).toBe(body.modelAnimation)
    })
  })

  describe('disabled state', () => {
    it('defaults to not disabled', () => {
      const body = new WithVoxelBody(
        info, renderVoxels, modelCache,
        () => WRot.None,
      )
      expect(body.disabled).toBe(false)
    })

    it('can be set disabled', () => {
      const body = new WithVoxelBody(
        info, renderVoxels, modelCache,
        () => WRot.None,
      )
      body.disabled = true
      expect(body.disabled).toBe(true)
    })
  })

  describe('getScreenBounds', () => {
    it('returns a rectangle', () => {
      const body = new WithVoxelBody(
        info, renderVoxels, modelCache,
        () => WRot.None,
      )
      const bounds = body.getScreenBounds(WPos.Zero, 100, 100)
      expect(bounds).toBeDefined()
    })
  })

  describe('renderPreview (static)', () => {
    it('returns preview animation array', () => {
      const result = WithVoxelBody.renderPreview(
        modelCache, 'testImage', 'idle',
        WVec.Zero, () => WRot.None, true,
      )
      expect(result).toHaveLength(1)
    })
  })
})
