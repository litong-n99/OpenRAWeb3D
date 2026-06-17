/**
 * SatelliteLaunch.test.ts — SatelliteLaunch effect unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import { SatelliteLaunch } from './SatelliteLaunch.js'
import type { GpsPowerInfoStub } from './SatelliteLaunch.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides?: Partial<GpsPowerInfoStub>): GpsPowerInfoStub {
  return {
    doorImage: 'door',
    doorSequence: 'open',
    doorPalette: 'effect',
    doorPaletteIsPlayerPalette: false,
    satelliteImage: 'sat',
    satelliteSequence: 'ascent',
    satellitePalette: 'player',
    satellitePaletteIsPlayerPalette: true,
    revealDelay: 100,
    ...overrides,
  }
}

function makeLauncher(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    centerPosition: { X: 10240, Y: 10240, Z: 0 },
    owner: { internalName: 'Multi0' },
    location: { X: 10, Y: 10 },
  } as unknown as IGameActor
}

function makeWorld(): GameWorldManager {
  return { players: [], addFrameEndTask: vi.fn() } as unknown as GameWorldManager
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SatelliteLaunch', () => {
  describe('constructor', () => {
    it('initializes correctly', () => {
      const launcher = makeLauncher()
      const info = makeInfo()
      const effect = new SatelliteLaunch(launcher, info)

      expect(effect).toBeDefined()
      expect(effect.frame).toBe(0)
      expect(effect.isRemoved).toBe(false)
      expect(effect.info).toBe(info)
    })

    it('stores the launch position from actor centerPosition', () => {
      const launcher = makeLauncher()
      const launch = new SatelliteLaunch(launcher, makeInfo())

      expect(launch.pos).toEqual({ X: 10240, Y: 10240, Z: 0 })
    })

    it('creates door animation with correct image', () => {
      const launcher = makeLauncher()
      const info = makeInfo({ doorImage: 'testdoor' })
      const launch = new SatelliteLaunch(launcher, info)

      expect(launch.doors).toBeDefined()
      expect(launch.doors.image).toBe('testdoor')
    })
  })

  describe('tick', () => {
    it('increments frame counter each tick', () => {
      const launch = new SatelliteLaunch(makeLauncher(), makeInfo())
      const world = makeWorld()

      launch.tick(world)
      expect(launch.frame).toBe(1)

      launch.tick(world)
      expect(launch.frame).toBe(2)
    })

    it('advances door animation each tick', () => {
      const launch = new SatelliteLaunch(makeLauncher(), makeInfo())
      expect(launch.doors.currentTick).toBe(0)

      launch.tick(makeWorld())
      expect(launch.doors.currentTick).toBe(1)
    })

    it('creates satellite at frame 19', () => {
      let satelliteCreated = false

      class MockGpsSatellite {
        constructor(
          _world: unknown, _pos: unknown, _img: string,
          _seq: string, _pal: string, _delay: number,
          _launcher: PlayerStub,
        ) {
          satelliteCreated = true
        }
      }

      const launch = new SatelliteLaunch(
        makeLauncher(),
        makeInfo(),
        MockGpsSatellite,
      )

      const world = makeWorld()
      for (let i = 0; i < 18; i++) launch.tick(world)
      expect(satelliteCreated).toBe(false)

      launch.tick(world) // frame 19
      expect(satelliteCreated).toBe(true)
    })

    it('does not create duplicate satellites', () => {
      let count = 0

      class MockGpsSatellite {
        constructor() { count++ }
      }

      const launch = new SatelliteLaunch(
        makeLauncher(),
        makeInfo(),
        MockGpsSatellite,
      )

      const world = makeWorld()
      // Tick past frame 19
      for (let i = 0; i < 25; i++) launch.tick(world)

      // Only one satellite should be created (at frame 19)
      expect(count).toBe(1)
    })

    it('handles no satelliteFactory gracefully', () => {
      const launch = new SatelliteLaunch(makeLauncher(), makeInfo())

      const world = makeWorld()
      // Tick past frame 19 — should not crash
      for (let i = 0; i < 25; i++) {
        expect(() => launch.tick(world)).not.toThrow()
      }
    })
  })

  describe('door animation completion', () => {
    it('marks as removed after door animation completes', () => {
      const launch = new SatelliteLaunch(makeLauncher(), makeInfo())

      // Advance 12 ticks for animation completion
      for (let i = 0; i < 12; i++) launch.tick(makeWorld())
      expect(launch.isRemoved).toBe(true)
    })
  })

  describe('palette resolution', () => {
    it('uses player-specific palette when doorPaletteIsPlayerPalette is true', () => {
      // NOTE: Render output is deferred. This tests that the constructor
      // doesn't crash with player-specific palette configuration.
      const info = makeInfo({ doorPaletteIsPlayerPalette: true, doorPalette: 'player' })
      const launch = new SatelliteLaunch(makeLauncher(), info)
      expect(launch).toBeDefined()
    })
  })

  describe('render', () => {
    it('returns empty array (visuals deferred)', () => {
      const launch = new SatelliteLaunch(makeLauncher(), makeInfo())
      expect(launch.render(null as any)).toHaveLength(0)
    })
  })
})
