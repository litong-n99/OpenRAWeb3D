/**
 * ClassicSpriteSequence.test.ts — Unit tests
 *
 * Tests focus on: UseClassicFacings validation, facing frame offset, config merging.
 */

import { describe, it, expect } from 'vitest'
import {
  ClassicSpriteSequence,
  ClassicSpriteSequenceLoader,
  mergeConfig,
  type ClassicSpriteSequenceConfig,
} from './ClassicSpriteSequence.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'

describe('mergeConfig', () => {
  it('should return data values when provided', () => {
    const data: ClassicSpriteSequenceConfig = { useClassicFacings: true, facings: 32 }
    const defaults: ClassicSpriteSequenceConfig = { useClassicFacings: false, facings: 1 }
    const result = mergeConfig(data, defaults)
    expect(result.useClassicFacings).toBe(true)
    expect(result.facings).toBe(32)
  })

  it('should fall back to defaults when data is missing', () => {
    const data: ClassicSpriteSequenceConfig = {}
    const defaults: ClassicSpriteSequenceConfig = { tick: 100 }
    const result = mergeConfig(data, defaults)
    expect(result.tick).toBe(100)
  })

  it('should use built-in defaults when neither data nor defaults provide', () => {
    const result = mergeConfig({})
    expect(result.tick).toBe(40)
    expect(result.facings).toBe(1)
    expect(result.length).toBe(1)
    expect(result.scale).toBe(1)
    expect(result.useClassicFacings).toBe(false)
    expect(result.ignoreWorldTint).toBe(false)
  })
})

describe('ClassicSpriteSequence', () => {
  it('should create sequence with basic config', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {
      useClassicFacings: false,
      facings: 8,
      length: 16,
    })
    expect(seq.name).toBe('idle')
    expect(seq.image).toBe('unit')
    expect(seq.facings).toBe(8)
    expect(seq.length).toBe(16)
  })

  it('should throw when UseClassicFacings=true but facings != 32', () => {
    expect(() => {
      new ClassicSpriteSequence('unit', 'idle', {
        useClassicFacings: true,
        facings: 8,
      })
    }).toThrow(/UseClassicFacings is only valid for 32 facings/)
  })

  it('should accept UseClassicFacings=true with facings=32', () => {
    expect(() => {
      new ClassicSpriteSequence('unit', 'idle', {
        useClassicFacings: true,
        facings: 32,
      })
    }).not.toThrow()
  })

  it('should return a stub sprite from getSprite', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
    const sprite = seq.getSprite(0, WAngle.Zero)
    expect(sprite).toBeDefined()
    expect(sprite.sheet).toBeNull()
  })

  it('should return alpha=1 for any frame', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {})
    expect(seq.getAlpha(0)).toBe(1)
    expect(seq.getAlpha(5)).toBe(1)
  })

  it('should convert facing to frame offset via getFacingFrameOffset', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {
      useClassicFacings: false,
      facings: 8,
    })
    // For 8 facings with standard linear facing, angle 0 -> frame 0
    const offset0 = seq.getFacingFrameOffset(WAngle.Zero)
    expect(offset0).toBeGreaterThanOrEqual(0)
    expect(offset0).toBeLessThan(8)
  })

  it('should use classic facings when enabled', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {
      useClassicFacings: true,
      facings: 32,
    })
    // For 32 classic facings, angle 0 -> classicIndexFacing should return frame index
    const offset = seq.getFacingFrameOffset(WAngle.Zero)
    expect(offset).toBeGreaterThanOrEqual(0)
    expect(offset).toBeLessThan(32)
  })

  it('should get sprite with rotation', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {
      useClassicFacings: true,
      facings: 32,
    })
    const result = seq.getSpriteWithRotation(0, WAngle.fromDegrees(90))
    expect(result.sprite).toBeDefined()
    expect(typeof result.rotation).toBe('number')
  })

  it('should return null shadow when shadowStart < 0', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
    expect(seq.getShadow(0, WAngle.Zero)).toBeNull()
  })

  it('should return default bounds', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {})
    expect(seq.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('ClassicSpriteSequenceLoader', () => {
  it('should create ClassicSpriteSequence instances', () => {
    const loader = new ClassicSpriteSequenceLoader()
    const seq = loader.createSequence('unit', 'idle', { facings: 8 })
    expect(seq).toBeInstanceOf(ClassicSpriteSequence)
    expect(seq.name).toBe('idle')
    expect(seq.image).toBe('unit')
  })

  it('should merge data and defaults', () => {
    const loader = new ClassicSpriteSequenceLoader()
    const seq = loader.createSequence(
      'unit',
      'walk',
      { length: 8 },
      { facings: 8, tick: 80 },
    )
    expect(seq.length).toBe(8)
    expect(seq.facings).toBe(8)
    expect(seq.tick).toBe(80)
  })
})
