/**
 * ClassicTilesetSpecificSpriteSequence.test.ts — Unit tests
 *
 * Tests focus on: tileset-specific filename resolution, pattern overrides, combine parsing.
 */

import { describe, it, expect } from 'vitest'
import {
  ClassicTilesetSpecificSpriteSequence,
  ClassicTilesetSpecificSpriteSequenceLoader,
} from './ClassicTilesetSpecificSpriteSequence.js'

describe('ClassicTilesetSpecificSpriteSequence', () => {
  it('should extend ClassicSpriteSequence', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
    })
    expect(seq.name).toBe('idle')
    expect(seq.image).toBe('unit')
    expect(seq.facings).toBe(8)
  })

  it('should have null tilesetFilenames by default', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {})
    expect(seq.tilesetFilenames).toBeNull()
    expect(seq.tilesetFilenamesPattern).toBeNull()
    expect(seq.tilesetFilenamePatterns).toBeNull()
  })

  it('should have tilesetFilenames when provided', () => {
    const tilesetFilenames = { DESERT: 'unit-desert' }
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      tilesetFilenames,
      facings: 8,
    })
    expect(seq.tilesetFilenames).toEqual(tilesetFilenames)
  })

  it('should return base image when tileset has no override', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      tilesetFilenames: { DESERT: 'unit-desert' },
      facings: 8,
    })
    expect(seq.getFilenameForTileset('TEMPERATE')).toBe('unit')
  })

  it('should return tileset-specific filename when override exists', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      tilesetFilenames: { DESERT: 'unit-desert' },
      facings: 8,
    })
    expect(seq.getFilenameForTileset('DESERT')).toBe('unit-desert')
  })

  it('should resolve filenames based on tileset', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      tilesetFilenames: { DESERT: 'unit-desert' },
      facings: 8,
      length: 4,
    })
    const result = seq.parseFilenames(null, 'DESERT', [])
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!.filename).toBe('unit-desert')
  })

  it('should fall back to base filename when no tileset override', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      length: 1,
    })
    const result = seq.parseFilenames(null, 'TEMPERATE', [])
    expect(result[0]!.filename).toBe('unit')
  })

  it('should use pattern overrides when available', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      length: 4,
      tilesetFilenamePatterns: {
        DESERT: { value: 'unit-desert-%d', start: 0, count: 4 },
      },
    })
    const result = seq.parseFilenames(null, 'DESERT', [])
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!.filename).toBe('unit-desert-%d')
  })

  it('should handle combine filenames with tileset override', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      tilesetFilenames: { DESERT: 'unit-desert-combined' },
      facings: 8,
      length: 4,
    })
    const result = seq.parseCombineFilenames(null, 'DESERT', [0, 1, 2, 3])
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!.filename).toBe('unit-desert-combined')
  })

  it('should get sprite like base class', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
    })
    const sprite = seq.getSprite(0, { angle: 0 } as any)
    expect(sprite).toBeDefined()
    expect(sprite.sheet).toBeNull()
  })
})

describe('ClassicTilesetSpecificSpriteSequenceLoader', () => {
  it('should create ClassicTilesetSpecificSpriteSequence instances', () => {
    const loader = new ClassicTilesetSpecificSpriteSequenceLoader()
    const seq = loader.createSequence('unit', 'idle', { facings: 8 })
    expect(seq).toBeInstanceOf(ClassicTilesetSpecificSpriteSequence)
  })

  it('should pass tileset config through', () => {
    const loader = new ClassicTilesetSpecificSpriteSequenceLoader()
    const seq = loader.createSequence('unit', 'idle', {
      facings: 8,
      tilesetFilenames: { DESERT: 'unit-desert' },
    })
    expect(seq.tilesetFilenames).toEqual({ DESERT: 'unit-desert' })
  })
})
