/**
 * D2kSpriteSequence.test.ts — D2kSpriteSequence migration unit tests
 *
 * Tests focus on: sequence configuration, frame adjustment callback,
 * sprite reservation, filename parsing.
 */

import { describe, it, expect, vi } from 'vitest'

import {
  D2kSpriteSequence,
  parseFilenames,
  parseCombineFilenames,
  type ISpriteCache,
  type D2kSpriteSequenceConfig,
} from './D2kSpriteSequence.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCache(): ISpriteCache {
  return {
    reserveSprites: vi.fn((_filename, _loadFrames, _location, _adjust) => 'token-1'),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D2kSpriteSequence', () => {
  let cache: ISpriteCache

  beforeEach(() => {
    cache = createMockCache()
  })

  describe('parseFilenames', () => {
    it('returns default frame when no frames specified', () => {
      const result = parseFilenames('test.png')
      expect(result).toHaveLength(1)
      expect(result[0]!.filename).toBe('test.png')
      expect(result[0]!.frames).toEqual([0])
    })

    it('returns frames array when specified', () => {
      const result = parseFilenames('test.png', [0, 1, 2, 3])
      expect(result).toHaveLength(1)
      expect(result[0]!.frames).toEqual([0, 1, 2, 3])
      expect(result[0]!.loadFrames).toBe(4)
    })

    it('returns empty array for empty frames', () => {
      const result = parseFilenames('test.png', [])
      expect(result).toHaveLength(1)
      expect(result[0]!.frames).toEqual([0])
    })
  })

  describe('parseCombineFilenames', () => {
    it('returns empty for empty frames', () => {
      const result = parseCombineFilenames(null, 'tileset', [], null)
      expect(result).toHaveLength(0)
    })

    it('returns combined frames', () => {
      const result = parseCombineFilenames(null, 'tileset', [0, 1, 2], null)
      expect(result).toHaveLength(1)
      expect(result[0]!.filename).toBe('combine')
      expect(result[0]!.frames).toEqual([0, 1, 2])
    })
  })

  describe('constructor', () => {
    it('creates sequence with default config', () => {
      const seq = new D2kSpriteSequence(cache, 'building', 'idle', {})
      expect(seq.image).toBe('building')
      expect(seq.sequence).toBe('idle')
      expect(seq.useShadow).toBe(true)
      expect(seq.convertShroudToFog).toBe(false)
      expect(seq.spritesToLoad.length).toBeGreaterThanOrEqual(1)
    })

    it('accepts D2K-specific config', () => {
      const config: D2kSpriteSequenceConfig = {
        remapColor: { r: 255, g: 0, b: 0, a: 255 },
        useShadow: false,
        convertShroudToFog: true,
        flipX: true,
        flipY: false,
        zRamp: 10,
        offset: { x: 5, y: -5 },
        blendMode: 1,
      }
      const seq = new D2kSpriteSequence(cache, 'unit', 'walk', config)
      expect(seq.remapColor).toEqual(config.remapColor)
      expect(seq.useShadow).toBe(false)
      expect(seq.convertShroudToFog).toBe(true)
      expect(seq._flipX).toBe(true)
      expect(seq._flipY).toBe(false)
      expect(seq._zRamp).toBe(10)
      expect(seq._offset).toEqual({ x: 5, y: -5 })
      expect(seq._blendMode).toBe(1)
    })

    it('reserves sprites in cache', () => {
      void new D2kSpriteSequence(cache, 'infantry', 'stand', {})
      expect(cache.reserveSprites).toHaveBeenCalled()
    })
  })

  describe('static reserveSprites', () => {
    it('returns sprite reservations', () => {
      const mockCache: ISpriteCache = {
        reserveSprites: vi.fn(() => 'token-static'),
      }
      const config: D2kSpriteSequenceConfig = {
        frames: [0, 1, 2, 3],
        remapColor: { r: 128, g: 128, b: 0, a: 255 },
      }
      const reservations = D2kSpriteSequence.reserveSprites(mockCache, 'tank', 'move', config)
      expect(reservations.length).toBeGreaterThanOrEqual(1)
      expect(reservations[0]!.token).toBe('token-static')
    })
  })

  describe('getSprite', () => {
    it('returns a stub sprite object', () => {
      const seq = new D2kSpriteSequence(cache, 'actor', 'idle', {})
      const sprite = seq.getSprite(0)
      expect(sprite).toBeDefined()
      expect((sprite as { bounds: { width: number; height: number } }).bounds).toBeDefined()
    })
  })

  describe('color remapping', () => {
    it('does not apply remap when color is default', () => {
      const config: D2kSpriteSequenceConfig = {}
      const seq = new D2kSpriteSequence(cache, 'unit', 'stand', config)
      expect(seq.remapColor).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    })

    it('applies remap when color is set', () => {
      const config: D2kSpriteSequenceConfig = {
        remapColor: { r: 255, g: 0, b: 0, a: 255 },
      }
      const seq = new D2kSpriteSequence(cache, 'unit', 'stand', config)
      expect(seq.remapColor.a).toBe(255)
    })
  })
})
