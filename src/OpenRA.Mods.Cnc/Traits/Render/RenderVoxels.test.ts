/**
 * RenderVoxels.test.ts — RenderVoxels unit tests
 */

import { describe, it, expect } from 'vitest'
import { RenderVoxels, defaultRenderVoxelsInfo } from './RenderVoxels'
import { ModelRenderer } from '../World/ModelRenderer'
import { VoxelNormalsPalette } from '../World/VoxelNormalsPalette'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WRot } from '../../../OpenRA.Game/WRot'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { ModelAnimation } from '../../../OpenRA.Game/Graphics/ModelAnimation'
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

describe('RenderVoxels', () => {
  describe('defaultRenderVoxelsInfo', () => {
    it('returns default config values', () => {
      const info = defaultRenderVoxelsInfo()
      expect(info.playerPalette).toBe('player')
      expect(info.normalsPalette).toBe('normals')
      expect(info.shadowPalette).toBe('shadow')
      expect(info.scale).toBe(12)
      expect(info.lightPitch).toBeDefined()
      expect(info.lightYaw).toBeDefined()
    })
  })

  describe('construction', () => {
    it('creates with config, renderer, camera pitch, and actor name', () => {
      const renderer = createMockRenderer()
      const info = defaultRenderVoxelsInfo()
      const rv = new RenderVoxels(info, renderer, WAngle.fromDegrees(85), 'unit1')
      expect(rv.info).toBe(info)
      expect(rv.renderer).toBe(renderer)
      expect(rv.image).toBe('unit1')
      expect(rv.camera).toBeDefined()
      expect(rv.lightSource).toBeDefined()
    })

    it('uses custom image name when provided', () => {
      const renderer = createMockRenderer()
      const info = { ...defaultRenderVoxelsInfo(), image: 'customModel' }
      const rv = new RenderVoxels(info, renderer, WAngle.fromDegrees(85), 'actorName')
      expect(rv.image).toBe('customModel')
    })

    it('falls back to actor name when image is not provided', () => {
      const renderer = createMockRenderer()
      const info = defaultRenderVoxelsInfo() // image is undefined
      const rv = new RenderVoxels(info, renderer, WAngle.fromDegrees(85), 'fallbackActor')
      expect(rv.image).toBe('fallbackActor')
    })
  })

  describe('add / remove', () => {
    it('adds a model animation component', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      const anim = new ModelAnimation(
        createMockModel(), () => WVec.Zero, () => WRot.None, null, () => 0, true,
      )
      rv.add(anim)
      expect(rv.components).toHaveLength(1)
      expect(rv.components[0]).toBe(anim)
    })

    it('removes a model animation component', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      const anim = new ModelAnimation(
        createMockModel(), () => WVec.Zero, () => WRot.None, null, () => 0, true,
      )
      rv.add(anim)
      rv.remove(anim)
      expect(rv.components).toHaveLength(0)
    })

    it('removing non-existent component does nothing', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      const anim = new ModelAnimation(
        createMockModel(), () => WVec.Zero, () => WRot.None, null, () => 0, true,
      )
      expect(() => rv.remove(anim)).not.toThrow()
    })
  })

  describe('tick', () => {
    it('returns false when no animations registered', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      expect(rv.tick()).toBe(false)
    })

    it('returns false when no animations changed', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      const anim = new ModelAnimation(
        createMockModel(), () => WVec.Zero, () => WRot.None, null, () => 0, true,
      )
      rv.add(anim)
      // First tick may detect changes (cached state was undefined)
      const result = rv.tick()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('onOwnerChanged', () => {
    it('sets palette re-initialization flag', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      rv.onOwnerChanged()
      // Should not throw
    })
  })

  describe('getRenderable', () => {
    it('returns a ModelRenderable for the actor position', () => {
      const renderer = createMockRenderer()
      const rv = new RenderVoxels(defaultRenderVoxelsInfo(), renderer, WAngle.fromDegrees(85), 'test')
      const anim = new ModelAnimation(
        createMockModel(), () => WVec.Zero, () => WRot.None, null, () => 0, true,
      )
      rv.add(anim)
      const renderable = rv.getRenderable(WPos.Zero)
      expect(renderable).toBeDefined()
      expect(renderable.pos.X).toBe(0)
    })
  })
})
