/**
 * ClassicSpriteSequence.test.ts — Unit tests
 *
 * Tests focus on: UseClassicFacings validation, facing frame offset, config merging,
 * sprite provider integration (P1-E.21).
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ClassicSpriteSequence,
  ClassicSpriteSequenceLoader,
  mergeConfig,
  type ClassicSpriteSequenceConfig,
  type SpriteProvider,
} from './ClassicSpriteSequence.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'

// ---------------------------------------------------------------------------
// Stub sprite for testing
// ---------------------------------------------------------------------------

function makeStubSprite(overrides: Partial<Sprite> = {}): Sprite {
  return {
    sheet: null as unknown as Sprite['sheet'],
    bounds: { x: 0, y: 0, width: 32, height: 32 },
    blendMode: 0 as unknown as Sprite['blendMode'],
    channel: 4 as Sprite['channel'],
    zRamp: 0,
    size: { x: 32, y: 32, z: 0 },
    offset: { x: 0, y: 0, z: 0 },
    top: 0, left: 0, bottom: 1, right: 1,
    ...overrides,
  } as Sprite
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it('should return a stub sprite from getSprite (descriptor mode)', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
    const sprite = seq.getSprite(0, WAngle.Zero)
    expect(sprite).toBeDefined()
    expect(sprite.sheet).toBeNull()
  })

  describe('sprite provider integration (P1-E.21)', () => {
    it('should start without a sprite provider', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
      expect(seq.hasSpriteProvider).toBe(false)
    })

    it('should set a sprite provider', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
      const provider: SpriteProvider = vi.fn().mockReturnValue(makeStubSprite())
      seq.setSpriteProvider(provider)
      expect(seq.hasSpriteProvider).toBe(true)
    })

    it('should delegate getSprite to sprite provider when set', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', {
        useClassicFacings: false,
        facings: 8,
      })
      const customSprite = makeStubSprite({ bounds: { x: 10, y: 20, width: 64, height: 64 } })
      const provider: SpriteProvider = vi.fn().mockReturnValue(customSprite)
      seq.setSpriteProvider(provider)

      const result = seq.getSprite(0, WAngle.Zero)
      expect(provider).toHaveBeenCalled()
      expect(result).toBe(customSprite)
      expect(result.bounds.width).toBe(64)
      expect(result.bounds.height).toBe(64)
    })

    it('should pass correct frame and facing offset to provider', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', {
        useClassicFacings: false,
        facings: 8,
      })
      const provider: SpriteProvider = vi.fn().mockReturnValue(makeStubSprite())
      seq.setSpriteProvider(provider)

      // For 8 facings, WAngle(896) -> facing offset 0
      // The standard indexFacing formula: ((angle - 64 + 1024) % 1024) / 128
      // WAngle(896): (896 - 64 + 1024) mod 1024 = 832 -> 832/128 = 6... actually 896/128 = 7
      // WAngle(0): (0 - 64 + 1024) mod 1024 = 960 -> 960/128 = 7 (not 0)
      // WAngle(64): (64 - 64 + 1024) mod 1024 = 0 -> 0/128 = 0
      // So WAngle(64) gives facing offset 0 for 8 facings
      seq.getSprite(3, new WAngle(64))
      expect(provider).toHaveBeenCalledWith(3, 0)
    })

    it('should compute bounds from provider sprite', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
      const customSprite = makeStubSprite({ bounds: { x: 5, y: 5, width: 48, height: 48 } })
      seq.setSpriteProvider(() => customSprite)
      expect(seq.bounds).toEqual({ x: 5, y: 5, width: 48, height: 48 })
    })

    it('should return stub when provider returns null', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
      seq.setSpriteProvider(() => null)
      const sprite = seq.getSprite(0, WAngle.Zero)
      expect(sprite.sheet).toBeNull()
      expect(sprite.bounds.width).toBe(0)
    })

    it('should get shadow via provider when shadowStart >= 0', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', {
        facings: 8,
        shadowStart: 32,
      })
      const shadowSprite = makeStubSprite()
      const provider: SpriteProvider = vi.fn().mockReturnValue(shadowSprite)
      seq.setSpriteProvider(provider)

      const shadow = seq.getShadow(0, WAngle.Zero)
      expect(shadow).not.toBeNull()
      expect(provider).toHaveBeenCalled()
    })

    it('should return null shadow when shadowStart < 0 even with provider', () => {
      const seq = new ClassicSpriteSequence('unit', 'idle', { facings: 8 })
      seq.setSpriteProvider(() => makeStubSprite())
      expect(seq.getShadow(0, WAngle.Zero)).toBeNull()
    })
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
    const offset0 = seq.getFacingFrameOffset(WAngle.Zero)
    expect(offset0).toBeGreaterThanOrEqual(0)
    expect(offset0).toBeLessThan(8)
  })

  it('should use classic facings when enabled', () => {
    const seq = new ClassicSpriteSequence('unit', 'idle', {
      useClassicFacings: true,
      facings: 32,
    })
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

  it('should return zero bounds in descriptor mode', () => {
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
