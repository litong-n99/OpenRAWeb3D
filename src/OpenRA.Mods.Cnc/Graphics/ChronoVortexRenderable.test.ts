/**
 * ChronoVortexRenderable.test.ts — Unit tests
 *
 * Tests focus on: frame validation, position tracking, render delegate, bounds computation.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ChronoVortexRenderable,
  type IChronoVortexRendererAccess,
  type IChronoVortexWorldRenderer,
} from './ChronoVortexRenderable.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

function makeRenderer(): IChronoVortexRendererAccess {
  return { drawVortex: vi.fn() }
}

function makeWorldRenderer(): IChronoVortexWorldRenderer {
  return {
    screen3DPxPosition: vi.fn().mockReturnValue({ x: 100, y: 200, z: 0 }),
    viewport: {
      worldToViewPx: vi.fn().mockReturnValue({ x: 100, y: 200, z: 0 }),
    },
  }
}

describe('ChronoVortexRenderable', () => {
  it('should have static None as empty array', () => {
    expect(ChronoVortexRenderable.None).toEqual([])
  })

  it('should store pos, frame', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(renderable.pos.equals(pos)).toBe(true)
  })

  it('should reject frame out of range [0, 47]', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    expect(() => new ChronoVortexRenderable(renderer, pos, -1)).toThrow(RangeError)
    expect(() => new ChronoVortexRenderable(renderer, pos, 48)).toThrow(RangeError)
  })

  it('should accept frame in range [0, 47]', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    expect(() => new ChronoVortexRenderable(renderer, pos, 0)).not.toThrow()
    expect(() => new ChronoVortexRenderable(renderer, pos, 47)).not.toThrow()
  })

  it('should have zOffset = 0 and isDecoration = false', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(renderable.zOffset).toBe(0)
    expect(renderable.isDecoration).toBe(false)
  })

  it('should delegate render to ChronoVortexRenderer', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const renderable = new ChronoVortexRenderable(renderer, pos, 24)
    const wr = makeWorldRenderer()

    renderable.render(wr)
    expect(renderer.drawVortex).toHaveBeenCalledWith(
      { x: 100, y: 200, z: 0 },
      24,
    )
  })

  it('should compute screen bounds that are non-negative', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    const wr = makeWorldRenderer()

    const bounds = renderable.screenBounds(wr)
    expect(bounds.width).toBeGreaterThanOrEqual(0)
    expect(bounds.height).toBeGreaterThanOrEqual(0)
  })

  it('should prepareRender returning itself', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    const wr = makeWorldRenderer()
    expect(renderable.prepareRender(wr)).toBe(renderable)
  })

  it('withZOffset, offsetBy, asDecoration return self (immutable)', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(renderable.withZOffset(5)).toBe(renderable)
    expect(renderable.offsetBy({ x: 1, y: 1, z: 0 } as any)).toBe(renderable)
    expect(renderable.asDecoration()).toBe(renderable)
  })

  it('should not throw on renderDebugGeometry', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    const wr = makeWorldRenderer()
    expect(() => renderable.renderDebugGeometry(wr)).not.toThrow()
  })
})
