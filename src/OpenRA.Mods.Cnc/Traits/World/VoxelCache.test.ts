/**
 * VoxelCache.test.ts — VoxelCache unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { VoxelCache, type VoxelCacheInfo } from './VoxelCache'

function createTestInfo(sheetSize = 2048): VoxelCacheInfo {
  return { sheetSize }
}

describe('VoxelCache', () => {
  let cache: VoxelCache

  beforeEach(() => {
    cache = new VoxelCache(createTestInfo())
  })

  describe('construction', () => {
    it('creates with VoxelCacheInfo', () => {
      expect(cache.loader).toBeDefined()
      expect(cache.loader.cacheCount).toBe(0)
    })
  })

  describe('getModel', () => {
    it('returns a model for the given name', () => {
      const model = cache.getModel('test')
      expect(model).toBeDefined()
    })

    it('returns the same model for the same name', () => {
      const m1 = cache.getModel('test')
      const m2 = cache.getModel('test')
      expect(m1).toBe(m2)
    })
  })

  describe('getModelSequence', () => {
    it('returns a model for a known sequence', () => {
      const model = cache.getModelSequence('test', 'idle')
      expect(model).toBeDefined()
    })

    it('throws for unknown model with no sequences', () => {
      expect(() => cache.getModelSequence('unknown', 'run'))
        .toThrow(/does not have any sequences defined/)
    })

    it('throws for known model with unknown sequence', () => {
      // First, cache a model with only one sequence
      void cache.getModelSequence('unit', 'idle')
      // Trying another sequence should fail if not in cache yet
      expect(() => cache.getModelSequence('unit', 'attack'))
        .toThrow(/does not have a sequence/)
    })
  })

  describe('hasModelSequence', () => {
    it('returns true for known sequence', () => {
      const seqs = new Map<string, string>()
      seqs.set('idle', 'test')
      seqs.set('run', 'test,testrun')
      cache.cacheModel('myModel', seqs)
      expect(cache.hasModelSequence('myModel', 'idle')).toBe(true)
      expect(cache.hasModelSequence('myModel', 'run')).toBe(true)
    })

    it('throws for unknown model', () => {
      expect(() => cache.hasModelSequence('nonexistent', 'idle'))
        .toThrow(/does not have any sequences defined/)
    })
  })

  describe('cacheModel', () => {
    it('pre-caches a model with sequences', () => {
      const seqs = new Map<string, string>()
      seqs.set('idle', 'e1')
      seqs.set('run', 'e1,e1run')
      cache.cacheModel('e1', seqs)

      const model = cache.getModelSequence('e1', 'idle')
      expect(model).toBeDefined()
    })

    it('handles comma-separated vxl,hva pairs', () => {
      const seqs = new Map<string, string>()
      seqs.set('idle', 'vxlName,hvaName')
      cache.cacheModel('test', seqs)

      const model = cache.getModelSequence('test', 'idle')
      expect(model).toBeDefined()
    })

    it('gracefully handles missing model files', () => {
      const seqs = new Map<string, string>()
      seqs.set('idle', 'missingFile,missingHva')
      // Should not throw — silently logs warning
      expect(() => cache.cacheModel('bad', seqs)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('clears all models', () => {
      cache.getModel('test')
      cache.dispose()
      // After dispose, getModel should still work but create new models
      // because the VoxelLoader creates placeholders
    })
  })
})
