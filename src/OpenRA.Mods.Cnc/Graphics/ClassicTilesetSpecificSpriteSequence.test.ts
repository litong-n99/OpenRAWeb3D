/**
 * ClassicTilesetSpecificSpriteSequence.test.ts — Unit tests
 *
 * Tests focus on: tileset-specific filename resolution, pattern overrides,
 * combine parsing, filename pattern expansion (P1-E.22).
 */

import { describe, it, expect } from 'vitest'
import {
  ClassicTilesetSpecificSpriteSequence,
  ClassicTilesetSpecificSpriteSequenceLoader,
} from './ClassicTilesetSpecificSpriteSequence.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    // Each expanded entry has %d substituted
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!.filename).toBe('unit-desert-0')
    expect(result.length).toBe(4)
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

  // -----------------------------------------------------------------------
  // P1-E.22: Filename pattern expansion tests
  // -----------------------------------------------------------------------

  it('should use explicit filename when provided', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      length: 1,
      filename: 'units.shp',
    })
    const result = seq.parseFilenames(null, 'TEMPERATE', [])
    expect(result[0]!.filename).toBe('units.shp')
  })

  it('should expand FilenamePattern with %d substitution', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      length: 1,
      filenamePattern: 'unit-%d.shp',
      patternStart: 0,
      patternCount: 3,
    })
    const result = seq.parseFilenames(null, 'TEMPERATE', [])
    expect(result.length).toBe(3)
    expect(result[0]!.filename).toBe('unit-0.shp')
    expect(result[1]!.filename).toBe('unit-1.shp')
    expect(result[2]!.filename).toBe('unit-2.shp')
  })

  it('should use custom patternStart in FilenamePattern expansion', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      filenamePattern: 'unit-%d.shp',
      patternStart: 5,
      patternCount: 2,
    })
    const result = seq.parseFilenames(null, 'TEMPERATE', [])
    expect(result.length).toBe(2)
    expect(result[0]!.filename).toBe('unit-5.shp')
    expect(result[1]!.filename).toBe('unit-6.shp')
  })

  it('should combine FilenamePattern with tileset overrides', () => {
    // When both FilenamePattern and TilesetFilenames exist, tileset wins
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      filenamePattern: 'unit-%d.shp',
      patternCount: 3,
      tilesetFilenames: { DESERT: 'desert-unit.shp' },
    })
    const result = seq.parseFilenames(null, 'DESERT', [])
    expect(result[0]!.filename).toBe('desert-unit.shp')
  })

  it('should use TilesetFilenamesPattern for combine when set', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      tilesetFilenamesPattern: { DESERT: 'desert-combined-%d' },
    })
    const result = seq.parseCombineFilenames(null, 'DESERT', [0, 1, 2, 3])
    expect(result[0]!.filename).toBe('desert-combined-0')
  })

  it('should use TilesetFilenamePatterns over TilesetFilenames', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit', 'idle', {
      facings: 8,
      tilesetFilenames: { DESERT: 'desert-unit.shp' },
      tilesetFilenamePatterns: {
        DESERT: { value: 'pattern-unit-%d', start: 0, count: 2 },
      },
    })
    const result = seq.parseFilenames(null, 'DESERT', [])
    // Pattern overrides have higher priority than simple filenames.
    // Each expanded entry has %d substituted.
    expect(result.length).toBe(2)
    expect(result[0]!.filename).toBe('pattern-unit-0')
    expect(result[1]!.filename).toBe('pattern-unit-1')
  })

  it('should fall back to base filename with explicit filename when no tileset', () => {
    const seq = new ClassicTilesetSpecificSpriteSequence('unit-image', 'idle', {
      facings: 1,
      filename: 'specific-unit.shp',
    })
    const result = seq.parseFilenames(null, 'TEMPERATE', [])
    expect(result[0]!.filename).toBe('specific-unit.shp')
  })

  // -----------------------------------------------------------------------
  // Legacy tests
  // -----------------------------------------------------------------------

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
