/**
 * ConyardChronoVortex.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { ConyardChronoVortex } from './ConyardChronoVortex.js'

describe('ConyardChronoVortex', () => {
  function makeLauncher(pos: { X: number; Y: number; Z: number } = { X: 0, Y: 0, Z: 0 }): any {
    return { centerPosition: pos }
  }

  it('should initialize at offset from launcher center', () => {
    const launcher = makeLauncher({ X: 100, Y: 200, Z: 0 })
    const vortex = new ConyardChronoVortex(launcher, vi.fn())
    expect(vortex.pos.X).toBeGreaterThan(100) // offset X: 171 from center
  })

  it('should report size', () => {
    const vortex = new ConyardChronoVortex(makeLauncher(), vi.fn())
    expect(vortex.size.width).toBe(64)
    expect(vortex.size.height).toBe(64)
  })

  it('should track frames and complete at frame 48 (no loops)', () => {
    const onComplete = vi.fn()
    const vortex = new ConyardChronoVortex(makeLauncher(), onComplete)
    // Disable loops so the straight 48-frame test is accurate
    ;(vortex as any).loops = 0

    // Tick to frame 47
    for (let i = 0; i < 47; i++) vortex.tick({})
    expect(vortex.isComplete).toBe(false)

    // Frame 48 triggers completion
    vortex.tick({})
    expect(vortex.isComplete).toBe(true)
    expect(onComplete).toHaveBeenCalled()
  })

  it('should loop frames 16-31 when loops remain', () => {
    const vortex = new ConyardChronoVortex(makeLauncher(), vi.fn())

    // Go through opening frames (0-15)
    for (let i = 0; i < 16; i++) vortex.tick({})
    expect(vortex.frame).toBe(16)

    // Go to frame 31 (end of loop section)
    for (let i = 0; i < 16; i++) vortex.tick({})
    expect(vortex.frame).toBe(16) // Should have looped back to 16 (loops: 3 -> 2)

    // Go to frame 31 again
    for (let i = 0; i < 16; i++) vortex.tick({})
    expect(vortex.frame).toBe(16) // Loops: 2 -> 1

    // Third time through
    for (let i = 0; i < 16; i++) vortex.tick({})
    expect(vortex.frame).toBe(32) // Loops: 1 -> 0, moves to closing section
  })
})
