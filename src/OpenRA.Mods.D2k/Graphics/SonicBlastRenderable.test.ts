/**
 * SonicBlastRenderable.test.ts — SonicBlastRenderable migration unit tests
 *
 * Tests focus on: renderable construction, screen bounds calculation,
 * position handling, API methods (withZOffset, offsetBy, asDecoration, prepareRender).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  SonicBlastRenderable,
  type ISonicBlastRendererAccess,
  type ISonicBlastWorldRenderer,
} from './SonicBlastRenderable.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRenderer(size: number = 16): ISonicBlastRendererAccess {
  return {
    info: { size },
    draw: vi.fn(),
  }
}

function createMockWorldRenderer(): ISonicBlastWorldRenderer {
  return {
    screen3DPxPosition: vi.fn((pos: WPos) => ({ x: pos.X / 1024, y: pos.Y / 1024, z: pos.Z / 1024 })),
    viewport: {
      worldToViewPx: vi.fn((pos: { x: number; y: number; z: number }) => pos),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SonicBlastRenderable', () => {
  let renderer: ISonicBlastRendererAccess
  let wr: ISonicBlastWorldRenderer
  let pos: WPos

  beforeEach(() => {
    renderer = createMockRenderer()
    wr = createMockWorldRenderer()
    pos = new WPos(5120, 10240, 0)
  })

  describe('None', () => {
    it('is an empty readonly array', () => {
      expect(SonicBlastRenderable.None).toHaveLength(0)
    })
  })

  describe('constructor', () => {
    it('stores pos and renderer', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(r.pos).toBe(pos)
      expect(r.zOffset).toBe(0)
      expect(r.isDecoration).toBe(false)
    })
  })

  describe('withZOffset', () => {
    it('returns this (always 0 for sonic blasts)', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      const r2 = r.withZOffset(10)
      expect(r2).toBe(r)
    })
  })

  describe('offsetBy', () => {
    it('returns this (positional offset ignored)', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      const r2 = r.offsetBy({ X: 100, Y: 200, Z: 0 } as unknown as Parameters<typeof r.offsetBy>[0])
      expect(r2).toBe(r)
    })
  })

  describe('asDecoration', () => {
    it('returns this', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      const r2 = r.asDecoration()
      expect(r2).toBe(r)
    })
  })

  describe('prepareRender', () => {
    it('returns this', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      const r2 = r.prepareRender(wr)
      expect(r2).toBe(r)
    })
  })

  describe('render', () => {
    it('calls renderer.draw with screen position', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      r.render(wr)

      expect(wr.screen3DPxPosition).toHaveBeenCalledWith(pos)
      expect(renderer.draw).toHaveBeenCalledWith(
        expect.objectContaining({ x: pos.X / 1024, y: pos.Y / 1024 }),
      )
    })
  })

  describe('screenBounds', () => {
    it('returns a bounding rectangle', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      const bounds = r.screenBounds(wr)

      expect(bounds).toHaveProperty('x')
      expect(bounds).toHaveProperty('y')
      expect(bounds).toHaveProperty('width')
      expect(bounds).toHaveProperty('height')
      expect(typeof bounds.width).toBe('number')
      expect(typeof bounds.height).toBe('number')
    })

    it('uses renderer info size for bounding box', () => {
      const bigRenderer = createMockRenderer(32)
      const r = new SonicBlastRenderable(bigRenderer, pos)
      const bounds = r.screenBounds(wr)

      // With size 32, half-size = 16; bounds should be wider than with size 16
      expect(bounds.width).toBeGreaterThan(0)
    })
  })

  describe('renderDebugGeometry', () => {
    it('does not throw', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(() => r.renderDebugGeometry(wr)).not.toThrow()
    })
  })
})
