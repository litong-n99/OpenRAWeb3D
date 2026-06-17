/**
 * GpsSatellite.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { GpsSatellite } from './GpsSatellite.js'

describe('GpsSatellite', () => {
  const makeLauncher = () => ({ playerName: 'testPlayer' })

  it('should initialize with given parameters', () => {
    const resolver = vi.fn().mockReturnValue(null)
    const sat = new GpsSatellite(
      {},
      { X: 100, Y: 200, Z: 0 },
      'gps',
      'idle',
      'effect',
      50,
      makeLauncher(),
      resolver,
    )
    expect(sat.image).toBe('gps')
    expect(sat.sequence).toBe('idle')
    expect(sat.palette).toBe('effect')
    expect(sat.revealDelay).toBe(50)
    expect(sat.pos.Z).toBe(0)
    expect(sat.reachedOrbit).toBe(false)
  })

  it('should move satellite upward each tick', () => {
    const sat = new GpsSatellite({}, { X: 0, Y: 0, Z: 0 }, 'img', 'seq', 'pal', 10, makeLauncher(), vi.fn())
    sat.tick({})
    expect(sat.pos.Z).toBe(427)
    sat.tick({})
    expect(sat.pos.Z).toBe(854)
  })

  it('should trigger GPS when tick exceeds revealDelay', () => {
    const reachedOrbit = vi.fn()
    const resolver = vi.fn().mockReturnValue({ reachedOrbit })
    const sat = new GpsSatellite({}, { X: 0, Y: 0, Z: 0 }, 'img', 'seq', 'pal', 2, makeLauncher(), resolver)

    sat.tick({}) // tick=1
    expect(sat.reachedOrbit).toBe(false)
    sat.tick({}) // tick=2
    expect(sat.reachedOrbit).toBe(false)
    sat.tick({}) // tick=3 > 2
    expect(sat.reachedOrbit).toBe(true)
    expect(reachedOrbit).toHaveBeenCalled()
  })

  it('should track current tick count', () => {
    const sat = new GpsSatellite({}, { X: 0, Y: 0, Z: 0 }, 'img', 'seq', 'pal', 100, makeLauncher(), vi.fn())
    expect(sat.currentTick).toBe(0)
    sat.tick({})
    expect(sat.currentTick).toBe(1)
    sat.tick({})
    expect(sat.currentTick).toBe(2)
  })
})
