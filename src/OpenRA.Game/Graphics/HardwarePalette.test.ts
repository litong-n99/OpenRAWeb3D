/**
 * HardwarePalette.test.ts — HardwarePalette 单元测试
 *
 * 测试 HardwarePalette 的调色板管理、颜色偏移、纹理创建、修改器应用和释放。
 *
 * @babylonjs/core 完全 mock：RawTexture、update、updateSamplingMode、dispose。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  const mockDispose = vi.fn()
  const mockUpdate = vi.fn()
  const mockUpdateSamplingMode = vi.fn()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockRawTexture: any = vi.fn(function (
    this: any,
    _data: ArrayBufferView,
    _width: number,
    _height: number,
    _format: number,
    _scene: any,
    _genMipMaps?: boolean,
    _invertY?: boolean,
    _samplingMode?: number,
    _type?: number,
  ) {
    this.update = mockUpdate
    this.updateSamplingMode = mockUpdateSamplingMode
    this.dispose = mockDispose
    return this
  })

  MockRawTexture.CreateRGBATexture = vi.fn(function (
    _data: ArrayBufferView,
    _width: number,
    _height: number,
    _scene: any,
    _genMipMaps?: boolean,
    _invertY?: boolean,
    _samplingMode?: number,
  ) {
    return {
      update: mockUpdate,
      updateSamplingMode: mockUpdateSamplingMode,
      dispose: mockDispose,
    }
  })

  return {
    RawTexture: MockRawTexture,
  }
})

// ---------------------------------------------------------------------------
// Mock Scene
// ---------------------------------------------------------------------------

function createMockScene(): any {
  return {} // Minimal scene mock — HardwarePalette only passes it to RawTexture
}

// ---------------------------------------------------------------------------
// Imports (after mock)
// ---------------------------------------------------------------------------

import { RawTexture } from '@babylonjs/core'
import { HardwarePalette } from './HardwarePalette'
import type { IPaletteModifier } from './HardwarePalette'
import { ImmutablePalette, getPaletteColor, PALETTE_SIZE } from './Palette'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestPalette(r: number, g: number, b: number): ImmutablePalette {
  return ImmutablePalette.fromColors(
    new Array(PALETTE_SIZE).fill(0).map((_, i) => {
      return ((255 << 24) | ((r + i) << 16) | ((g + i) << 8) | (b + i)) >>> 0
    }),
  )
}

function createMockModifier(name: string, calls: { track: string[] }): IPaletteModifier {
  return {
    adjustPalette(mutablePalettes: ReadonlyMap<string, any>): void {
      calls.track.push(name)
      // If our target palette exists, modify it
      const m = mutablePalettes.get(name)
      if (m) {
        m.setColor(0, { r: 255, g: 0, b: 0, a: 255 })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HardwarePalette', () => {
  let hp: HardwarePalette
  let scene: any

  beforeEach(() => {
    vi.clearAllMocks()
    hp = new HardwarePalette()
    scene = createMockScene()
    hp.setScene(scene)
  })

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('has initial height of 1 (row 0 reserved)', () => {
      expect(hp.height).toBe(1)
    })

    it('returns null textures when scene not set', () => {
      const noSceneHp = new HardwarePalette()
      expect(noSceneHp.getTexture()).toBeNull()
      expect(noSceneHp.getColorShiftsTexture()).toBeNull()
    })

    it('creates textures lazily when scene is set and getTexture called', () => {
      const result = hp.getTexture()
      expect(result).not.toBeNull()
      expect(RawTexture.CreateRGBATexture).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // addPalette
  // -----------------------------------------------------------------------

  describe('addPalette', () => {
    it('adds palette and returns PaletteReference', () => {
      const p = createTestPalette(100, 100, 100)
      const ref = hp.addPalette('test', p, false)
      expect(ref.name).toBe('test')
      expect(ref.textureIndex).toBe(1) // First palette gets index 1 (row 0 reserved)
    })

    it('increments palette index for each added palette', () => {
      const p1 = createTestPalette(10, 10, 10)
      const p2 = createTestPalette(20, 20, 20)
      const ref1 = hp.addPalette('pal1', p1, false)
      const ref2 = hp.addPalette('pal2', p2, false)
      expect(ref1.textureIndex).toBe(1)
      expect(ref2.textureIndex).toBe(2)
    })

    it('grows height when adding more palettes', () => {
      expect(hp.height).toBe(1)
      const p1 = createTestPalette(10, 10, 10)
      hp.addPalette('pal1', p1, false)
      expect(hp.height).toBe(2) // index=1, height = index+1 = 2
      const p2 = createTestPalette(20, 20, 20)
      hp.addPalette('pal2', p2, false)
      expect(hp.height).toBe(3)
    })

    it('throws on duplicate palette name', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('unique', p, false)
      expect(() => hp.addPalette('unique', p, false)).toThrow(/already been defined/)
    })

    it('allowModifiers=true creates mutable palette', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('modifiable', p, true)
      // The palette should exist and be accessible
      const palette = hp.getPalette('modifiable')
      expect(palette.at(0)).toBe(p.at(0))
    })
  })

  // -----------------------------------------------------------------------
  // contains
  // -----------------------------------------------------------------------

  describe('contains', () => {
    it('returns true for added palette', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('exists', p, false)
      expect(hp.contains('exists')).toBe(true)
    })

    it('returns false for unknown palette', () => {
      expect(hp.contains('nonexistent')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // getPalette
  // -----------------------------------------------------------------------

  describe('getPalette', () => {
    it('returns palette for added name', () => {
      const p = createTestPalette(42, 42, 42)
      hp.addPalette('myPal', p, false)
      const retrieved = hp.getPalette('myPal')
      expect(retrieved.at(0)).toBe(p.at(0))
    })

    it('throws for unknown palette name', () => {
      expect(() => hp.getPalette('missing')).toThrow(/does not exist/)
    })
  })

  // -----------------------------------------------------------------------
  // getPaletteIndex
  // -----------------------------------------------------------------------

  describe('getPaletteIndex', () => {
    it('returns correct texture row index', () => {
      const p = createTestPalette(1, 1, 1)
      hp.addPalette('first', p, false)
      expect(hp.getPaletteIndex('first')).toBe(1)
    })

    it('throws for unknown palette', () => {
      expect(() => hp.getPaletteIndex('unknown')).toThrow(/does not exist/)
    })
  })

  // -----------------------------------------------------------------------
  // replacePalette
  // -----------------------------------------------------------------------

  describe('replacePalette', () => {
    it('replaces an existing palette', () => {
      const p1 = createTestPalette(10, 10, 10)
      const p2 = createTestPalette(200, 200, 200)
      hp.addPalette('replaceMe', p1, false)
      hp.initialize()

      hp.replacePalette('replaceMe', p2)
      const result = hp.getPalette('replaceMe')
      expect(result.at(0)).toBe(p2.at(0))
    })

    it('throws for unknown palette', () => {
      const p = createTestPalette(1, 1, 1)
      expect(() => hp.replacePalette('unknown', p)).toThrow(/does not exist/)
    })
  })

  // -----------------------------------------------------------------------
  // setColorShift / hasColorShift
  // -----------------------------------------------------------------------

  describe('setColorShift and hasColorShift', () => {
    it('sets and reads color shift for a palette', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('shifted', p, false)

      hp.setColorShift('shifted', 0.1, 0.2, 1.5, 0.5, 0.8)
      expect(hp.hasColorShift('shifted')).toBe(true)
    })

    it('returns false when minHue and maxHue are both 0', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('noShift', p, false)

      // Default color shift buffer is all zeros → hasColorShift should be false
      expect(hp.hasColorShift('noShift')).toBe(false)
    })

    it('returns false when only hue is 0 (default)', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('defaultShift', p, false)
      expect(hp.hasColorShift('defaultShift')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  describe('initialize', () => {
    it('creates textures and uploads data', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('initPal', p, false)
      hp.initialize()

      const tex = hp.getTexture()
      const shiftTex = hp.getColorShiftsTexture()
      expect(tex).not.toBeNull()
      expect(shiftTex).not.toBeNull()
      // CreateRGBATexture should be called for the palette texture
      expect(RawTexture.CreateRGBATexture).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // applyModifiers
  // -----------------------------------------------------------------------

  describe('applyModifiers', () => {
    it('applies modifiers and then resets mutable palettes', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('modMe', p, true) // allowModifiers

      const calls: string[] = []
      const mod = createMockModifier('modMe', { track: calls })

      hp.initialize()
      hp.applyModifiers([mod])

      // The modifier should have been called
      expect(calls).toContain('modMe')

      // After applyModifiers, the mutable palette should be RESET to original
      const palette = hp.getPalette('modMe')
      const color = getPaletteColor(palette, 0)
      expect(color.r).toBe(100) // Original value
    })

    it('handles empty modifiers list', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('noMod', p, true)
      hp.initialize()

      expect(() => hp.applyModifiers([])).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('disposes both textures', () => {
      const p = createTestPalette(100, 100, 100)
      hp.addPalette('dispPal', p, false)
      hp.initialize()

      const tex = hp.getTexture()!
      const shiftTex = hp.getColorShiftsTexture()!

      hp.dispose()

      // Both textures should have dispose called
      expect((tex as any).dispose).toHaveBeenCalled()
      expect((shiftTex as any).dispose).toHaveBeenCalled()
    })

    it('is idempotent', () => {
      hp.dispose()
      expect(() => hp.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Multiple palette management
  // -----------------------------------------------------------------------

  describe('multiple palettes', () => {
    it('correctly assigns sequential indices', () => {
      const palettes: ReturnType<typeof createTestPalette>[] = []
      for (let i = 0; i < 5; i++) {
        palettes.push(createTestPalette(i * 10, i * 20, i * 30))
        hp.addPalette(`pal${i}`, palettes[i]!, false)
      }

      expect(hp.getPaletteIndex('pal0')).toBe(1)
      expect(hp.getPaletteIndex('pal1')).toBe(2)
      expect(hp.getPaletteIndex('pal4')).toBe(5)
      expect(hp.height).toBe(6) // 5 palettes + row 0
    })
  })
})
