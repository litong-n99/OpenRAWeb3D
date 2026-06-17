/**
 * ModelRenderer.test.ts — ModelRenderer unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ModelRenderer, type ModelRendererInfo } from './ModelRenderer'
import { VoxelNormalsPalette } from './VoxelNormalsPalette'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WRot } from '../../../OpenRA.Game/WRot'
import type { IModelCache, IModel } from '../../../OpenRA.Game/Graphics/Model'

function createMockModelCache(): IModelCache {
  const model: IModel = {
    frames: 1, sections: 1,
    transformationMatrix: () => new Float32Array(16),
    size: new Float32Array([1, 1, 1]),
    bounds: () => new Float32Array([-1, -1, -1, 1, 1, 1]),
    renderData: () => ({ start: 0, count: 4 }),
    aggregateBounds: { X: 0, Y: 0, Width: 2, Height: 2, Left: 0, Right: 2, Top: 0, Bottom: 2, isEmpty: false } as any,
  }
  return {
    getModel: () => model,
    getModelSequence: () => model,
    hasModelSequence: () => true,
  }
}

function createTestInfo(renderBufferSize = 2048): ModelRendererInfo {
  return { renderBufferSize }
}

describe('ModelRenderer', () => {
  let renderer: ModelRenderer
  let modelCache: IModelCache

  beforeEach(() => {
    modelCache = createMockModelCache()
    const normalsPalette = VoxelNormalsPalette.createTS()
    renderer = new ModelRenderer(createTestInfo(), modelCache, normalsPalette)
  })

  describe('construction', () => {
    it('creates with model cache and normals palette', () => {
      expect(renderer.modelCache).toBe(modelCache)
      expect(renderer.normalsPalette).toBeDefined()
    })
  })

  describe('beginFrame / endFrame', () => {
    it('beginFrame marks frame as in progress', () => {
      renderer.beginFrame()
      expect(() => renderer.beginFrame()).toThrow(/already been called/)
    })

    it('endFrame after beginFrame succeeds', () => {
      renderer.beginFrame()
      expect(() => renderer.endFrame()).not.toThrow()
    })

    it('double endFrame throws', () => {
      renderer.beginFrame()
      renderer.endFrame()
      expect(() => renderer.endFrame()).toThrow(/no frame to end/)
    })

    it('endFrame without beginFrame throws', () => {
      expect(() => renderer.endFrame()).toThrow(/no frame to end/)
    })
  })

  describe('renderAsync', () => {
    it('returns a render proxy with screen bounds', () => {
      const proxy = renderer.renderAsync(
        WPos.Zero, [], WRot.None, 12, WRot.None,
        new WRot(WAngle.Zero, new WAngle(256), new WAngle(240)),
      )
      expect(proxy).toBeDefined()
      expect(proxy.screenBounds).toBeDefined()
      expect(proxy.shadowBounds).toBeDefined()
    })
  })

  describe('registerActor / unregisterActor', () => {
    it('registers and retrieves actor models', () => {
      const models: any[] = [{ isVisible: true, model: {}, offsetFunc: () => ({}), frameFunc: () => 0 }]
      renderer.registerActor('actor1', models)
      expect(renderer.getActorModels('actor1')).toBe(models)
    })

    it('unregisters actor models', () => {
      const models: any[] = [{ isVisible: true }]
      renderer.registerActor('actor1', models)
      renderer.unregisterActor('actor1')
      expect(renderer.getActorModels('actor1')).toBeUndefined()
    })

    it('returns undefined for unknown actor', () => {
      expect(renderer.getActorModels('nonexistent')).toBeUndefined()
    })
  })

  describe('computeCameraRotation', () => {
    it('computes camera rotation from pitch', () => {
      const camPitch = WAngle.fromDegrees(85)
      const rot = ModelRenderer.computeCameraRotation(camPitch)
      expect(rot).toBeInstanceOf(WRot)
      expect(rot.roll.angle).toBe(0)
    })
  })

  describe('computeLightRotation', () => {
    it('computes light rotation from pitch and yaw', () => {
      const lightPitch = WAngle.fromDegrees(50)
      const lightYaw = WAngle.fromDegrees(240)
      const rot = ModelRenderer.computeLightRotation(lightPitch, lightYaw)
      expect(rot).toBeInstanceOf(WRot)
      expect(rot.yaw.angle).toBe(lightYaw.angle)
    })
  })

  describe('dispose', () => {
    it('clears registered actors', () => {
      const models: any[] = [{ isVisible: true }]
      renderer.registerActor('actor1', models)
      renderer.dispose()
      expect(renderer.getActorModels('actor1')).toBeUndefined()
    })
  })
})
