/**
 * MapGenerationArgs.test.ts — MapGenerationArgs migration unit tests
 *
 * Tests focus on: default construction, field assignment, serialization,
 * and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { MapGenerationArgs } from './MapGenerationArgs.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapGenerationArgs', () => {
  describe('default constructor', () => {
    it('creates instance with all default values', () => {
      const args = new MapGenerationArgs()

      expect(args.uid).toBe('')
      expect(args.generator).toBe('')
      expect(args.tileset).toBe('')
      expect(args.size).toEqual({ width: 0, height: 0 })
      expect(args.title).toBe('')
      expect(args.author).toBe('')
      expect(args.settings).toBeNull()
    })
  })

  describe('constructor with partial object', () => {
    it('assigns all provided fields', () => {
      const args = new MapGenerationArgs({
        uid: 'test-uid-123',
        generator: 'Cave',
        tileset: 'TEMPERAT',
        size: { width: 128, height: 128 },
        title: 'Test Map',
        author: 'Test Author',
        settings: { seed: 42, density: 0.5 },
      })

      expect(args.uid).toBe('test-uid-123')
      expect(args.generator).toBe('Cave')
      expect(args.tileset).toBe('TEMPERAT')
      expect(args.size).toEqual({ width: 128, height: 128 })
      expect(args.title).toBe('Test Map')
      expect(args.author).toBe('Test Author')
      expect(args.settings).toEqual({ seed: 42, density: 0.5 })
    })

    it('uses defaults for unspecified fields', () => {
      const args = new MapGenerationArgs({
        uid: 'partial',
        title: 'Only Title',
      })

      expect(args.uid).toBe('partial')
      expect(args.title).toBe('Only Title')
      expect(args.generator).toBe('')
      expect(args.size).toEqual({ width: 0, height: 0 })
    })
  })

  describe('serialize', () => {
    it('returns all fields as key-value pairs', () => {
      const args = new MapGenerationArgs({
        uid: 'abc',
        generator: 'Cave',
        tileset: 'TEMPERAT',
        size: { width: 64, height: 48 },
        title: 'My Map',
        author: 'Author',
        settings: { seed: 123 },
      })

      const result = args.serialize()

      expect(result).toEqual([
        { key: 'Uid', value: 'abc' },
        { key: 'Generator', value: 'Cave' },
        { key: 'Tileset', value: 'TEMPERAT' },
        { key: 'Size', value: '64,48' },
        { key: 'Settings', value: { seed: 123 } },
        { key: 'Title', value: 'My Map' },
        { key: 'Author', value: 'Author' },
      ])
    })

    it('formats size as "width,height" string', () => {
      const args = new MapGenerationArgs({
        size: { width: 256, height: 128 },
      })

      const result = args.serialize()
      const sizeEntry = result.find((r) => r.key === 'Size')

      expect(sizeEntry).toEqual({ key: 'Size', value: '256,128' })
    })

    it('handles null settings', () => {
      const args = new MapGenerationArgs()
      const result = args.serialize()
      const settingsEntry = result.find((r) => r.key === 'Settings')

      expect(settingsEntry).toEqual({ key: 'Settings', value: null })
    })

    it('returns exactly 7 entries in correct order', () => {
      const args = new MapGenerationArgs()
      const result = args.serialize()

      expect(result).toHaveLength(7)
      expect(result.map((r) => r.key)).toEqual([
        'Uid',
        'Generator',
        'Tileset',
        'Size',
        'Settings',
        'Title',
        'Author',
      ])
    })
  })

  describe('edge cases', () => {
    it('handles zero-size map', () => {
      const args = new MapGenerationArgs({
        size: { width: 0, height: 0 },
      })
      expect(args.size).toEqual({ width: 0, height: 0 })
      const serialized = args.serialize()
      const sizeEntry = serialized.find((r) => r.key === 'Size')
      expect(sizeEntry!.value).toBe('0,0')
    })

    it('handles empty string fields', () => {
      const args = new MapGenerationArgs()
      const serialized = args.serialize()

      for (const entry of serialized) {
        if (entry.key !== 'Size' && entry.key !== 'Settings') {
          expect(entry.value).toBe('')
        }
      }
    })

    it('handles complex nested settings object', () => {
      const settings = {
        terrain: { roughness: 0.7, waterLevel: 0.3 },
        resources: { ore: true, gems: false },
      }
      const args = new MapGenerationArgs({ settings })
      expect(args.settings).toEqual(settings)
    })
  })
})
