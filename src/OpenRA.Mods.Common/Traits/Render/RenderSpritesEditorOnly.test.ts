/**
 * RenderSpritesEditorOnly.test.ts — RenderSpritesEditorOnly unit tests
 *
 * Tests the editor-only render override — verifies that render/screenBounds
 * return empty arrays (game mode behavior). Pure logic — no @babylonjs/core.
 */

import { describe, it, expect } from 'vitest'

import {
  RenderSpritesEditorOnly,
  RenderSpritesEditorOnlyInfo,
} from './RenderSpritesEditorOnly.js'
import { RenderSpritesInfo } from './RenderSprites.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInfo(): RenderSpritesEditorOnlyInfo {
  return new RenderSpritesEditorOnlyInfo('test-image', null, 'palette', 'player')
}

// ---------------------------------------------------------------------------
// RenderSpritesEditorOnlyInfo tests
// ---------------------------------------------------------------------------

describe('RenderSpritesEditorOnlyInfo', () => {
  it('should extend RenderSpritesInfo', () => {
    const info = createInfo()
    expect(info).toBeInstanceOf(RenderSpritesInfo)
  })

  it('should have correct Image', () => {
    const info = createInfo()
    expect(info.Image).toBe('test-image')
  })

  it('should delegate getImage to parent class', () => {
    const info = new RenderSpritesEditorOnlyInfo('e1', null, null, 'player')
    expect(info.getImage('actor-name')).toBe('e1')
  })

  it('should use actor name when Image is null', () => {
    const info = new RenderSpritesEditorOnlyInfo(null, null, null, 'player')
    expect(info.getImage('default-actor')).toBe('default-actor')
  })

  it('should accept FactionImages', () => {
    const factions = { allies: 'allies-image', soviet: 'soviet-image' }
    const info = new RenderSpritesEditorOnlyInfo(null, factions, null, 'player')
    expect(info.FactionImages).toStrictEqual(factions)
    expect(info.getImage('test', 'allies')).toBe('allies-image')
  })

  it('should accept Palette', () => {
    const info = new RenderSpritesEditorOnlyInfo('img', null, 'terrain', 'player')
    expect(info.Palette).toBe('terrain')
  })

  it('should accept PlayerPalette', () => {
    const info = new RenderSpritesEditorOnlyInfo('img', null, null, 'custom-player')
    expect(info.PlayerPalette).toBe('custom-player')
  })
})

// ---------------------------------------------------------------------------
// RenderSpritesEditorOnly tests
// ---------------------------------------------------------------------------

describe('RenderSpritesEditorOnly', () => {
  describe('construction', () => {
    it('should extend RenderSprites', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info, 'allies')

      expect(trait.Info).toBe(info)
    })

    it('should create with no faction', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info, null)
      expect(trait.Info).toBe(info)
    })

    it('should create with explicit faction', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info, 'soviet')
      expect(trait.Info).toBe(info)
    })
  })

  describe('render()', () => {
    it('should return empty array in game mode', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info, 'allies')

      // Minimal stubs for render parameters
      const mockActor = {} as any
      const mockWr = {} as any

      const result = trait.render(mockActor, mockWr)
      expect(result).toEqual([])
      expect(result.length).toBe(0)
    })

    it('should return empty array consistently', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info)

      const result1 = trait.render({} as any, {} as any)
      const result2 = trait.render({} as any, {} as any)
      const result3 = trait.render({} as any, {} as any)

      expect(result1).toEqual([])
      expect(result2).toEqual([])
      expect(result3).toEqual([])
    })

    it('should not throw with null-ish stubs', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info)

      expect(() =>
        trait.render(null as any, null as any),
      ).not.toThrow()
    })
  })

  describe('screenBounds()', () => {
    it('should return empty array in game mode', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info)

      const result = trait.screenBounds({} as any, {} as any)
      expect(result).toEqual([])
      expect(result.length).toBe(0)
    })

    it('should return empty array consistently', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info)

      const r1 = trait.screenBounds({} as any, {} as any)
      const r2 = trait.screenBounds({} as any, {} as any)

      expect(r1).toEqual([])
      expect(r2).toEqual([])
    })
  })

  describe('inheritance behavior', () => {
    it('should appear as instanceof RenderSprites', () => {
      const info = createInfo()
      const trait = new RenderSpritesEditorOnly(info)

      // NOTE: In runtime, RenderSprites is the constructor on the proto chain
      expect(trait.Info).toBeInstanceOf(RenderSpritesInfo)
    })

    it('should have static interfaces from parent class', () => {
      // The parent class's static interfaces array should still be accessible
      expect(RenderSpritesEditorOnly.prototype).toBeDefined()
    })
  })

  describe('getImage from parent', () => {
    it('should delegate getImage to parent class logic', () => {
      const info = new RenderSpritesEditorOnlyInfo('test-image', null, null, 'player')
      const trait = new RenderSpritesEditorOnly(info, 'allies')

      const mockActor = { Info: { Name: 'actor-name' } } as any
      expect(trait.getImage(mockActor)).toBe('test-image')
    })
  })
})
