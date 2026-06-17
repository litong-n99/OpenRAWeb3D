/**
 * VoxelLoader.test.ts — VoxelLoader unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { VoxelLoader } from './VoxelLoader'
import type { IModelCache, IModel } from '../../OpenRA.Game/Graphics/Model'
import { Voxel } from './Voxel'

function createMockModelCache(): IModelCache {
  const models = new Map<string, IModel>()
  return {
    getModel: (name: string) => {
      const cached = models.get(name)
      if (cached) return cached
      throw new Error(`Model "${name}" not found`)
    },
    getModelSequence: (name: string, _seq: string) => {
      const cached = models.get(name)
      if (cached) return cached
      throw new Error(`Model "${name}" not found`)
    },
    hasModelSequence: (name: string, seq: string) => {
      return models.has(name) || seq === 'idle'
    },
  }
}

describe('VoxelLoader', () => {
  let modelCache: IModelCache
  let loader: VoxelLoader

  beforeEach(() => {
    modelCache = createMockModelCache()
    loader = new VoxelLoader(modelCache)
  })

  describe('construction', () => {
    it('creates with a model cache', () => {
      expect(loader.modelCache).toBe(modelCache)
      expect(loader.cacheCount).toBe(0)
    })
  })

  describe('load', () => {
    it('loads a model by vxl/hva names', () => {
      const result = loader.load('test', 'test')
      expect(result).toBeInstanceOf(Voxel)
      expect(loader.cacheCount).toBe(1)
    })

    it('returns cached model on second load', () => {
      const r1 = loader.load('test', 'test')
      const r2 = loader.load('test', 'test')
      expect(r1).toBe(r2)
      expect(loader.cacheCount).toBe(1) // Not incremented
    })

    it('loads different vxl and hva as separate cache entry', () => {
      const r1 = loader.load('model1', 'model1')
      const r2 = loader.load('model2', 'model2')
      expect(r1).not.toBe(r2)
      expect(loader.cacheCount).toBe(2)
    })
  })

  describe('loadSameName', () => {
    it('loads with same vxl and hva name', () => {
      const result = loader.loadSameName('unit')
      expect(result).toBeInstanceOf(Voxel)
    })
  })

  describe('isLoaded', () => {
    it('returns false before loading', () => {
      expect(loader.isLoaded('test', 'test')).toBe(false)
    })

    it('returns true after loading', () => {
      loader.load('test', 'test')
      expect(loader.isLoaded('test', 'test')).toBe(true)
    })
  })

  describe('clearCache', () => {
    it('clears all cached models', () => {
      loader.load('a', 'a')
      loader.load('b', 'b')
      expect(loader.cacheCount).toBe(2)
      loader.clearCache()
      expect(loader.cacheCount).toBe(0)
    })
  })

  describe('finish', () => {
    it('is a no-op that does not throw', () => {
      expect(() => loader.finish()).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('clears all cached models', () => {
      loader.load('a', 'a')
      loader.dispose()
      expect(loader.cacheCount).toBe(0)
    })
  })

  describe('createFromParsedData', () => {
    it('requires matching limb counts', () => {
      const vxlReader = {
        limbCount: 2,
        limbs: [
          { name: 'a', scale: 1, bounds: new Float32Array(6), size: new Uint8Array([1, 1, 1]), type: 2, voxelCount: 0, voxelMap: [] },
          { name: 'b', scale: 1, bounds: new Float32Array(6), size: new Uint8Array([1, 1, 1]), type: 2, voxelCount: 0, voxelMap: [] },
        ],
      } as any
      const hvaReader = { limbCount: 1, frameCount: 1, transforms: new Float32Array(16), getTransform: () => new Float32Array(16) } as any
      expect(() => loader.createFromParsedData(vxlReader, hvaReader, [{ start: 0, count: 0 }]))
        .toThrow(/doesn't match/)
    })
  })
})
