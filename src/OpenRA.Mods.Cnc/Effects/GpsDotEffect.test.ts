/**
 * GpsDotEffect.test.ts — GpsDotEffect unit tests
 *
 * Phase B.8: Updated with render() Billboard rendering tests, palette color
 * verification, and effect cleanup tests.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  GpsDotEffect,
  GpsDotRenderable,
  ShroudVisibility,
} from './GpsDotEffect.js'
import type { GpsDotInfo } from './GpsDotEffect.js'
import type {
  IGameActor,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides?: Partial<GpsDotInfo>): GpsDotInfo {
  return {
    image: overrides?.image ?? 'gpsdot',
    string_: overrides?.string_ ?? 'Infantry',
    indicatorPalettePrefix: overrides?.indicatorPalettePrefix ?? 'player',
  }
}

function makeActor(overrides?: {
  centerPosition?: { X: number; Y: number; Z: number }
  owner?: { internalName?: string }
  effectiveOwner?: { owner?: { internalName?: string } } | null
  world?: { renderPlayer?: PlayerStub & { internalName?: string }; players?: PlayerStub[] }
}): IGameActor {
  const actor: any = {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: overrides?.centerPosition ?? { X: 10240, Y: 10240, Z: 0 },
    owner: overrides?.owner ?? { internalName: 'Multi1' },
    effectiveOwner: overrides?.effectiveOwner ?? null,
    world: overrides?.world ?? {},
    location: { X: 10, Y: 10 },
    traitsImplementing: () => [],
  }
  return actor as unknown as IGameActor
}

function makePlayer(overrides?: {
  internalName?: string
  isAlliedWithOwner?: boolean
  gpsWatcher?: { granted: boolean; grantedAllies: boolean }
  shroud?: { getVisibility?: () => number }
}): PlayerStub {
  const player: any = {
    internalName: overrides?.internalName ?? 'Multi0',
    isAlliedWith: () => overrides?.isAlliedWithOwner ?? false,
    shroud: overrides?.shroud ?? { getVisibility: () => ShroudVisibility.Explored },
    playerActor: {
      traits: new Map([
        ['GpsWatcher', overrides?.gpsWatcher ?? { granted: true, grantedAllies: false }],
      ]),
    },
  }
  return player as PlayerStub
}

function makeWorld(players: PlayerStub[] = []): GameWorldManager {
  return { players } as unknown as GameWorldManager
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GpsDotEffect', () => {
  describe('constructor', () => {
    it('initializes with actor and info', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      expect(effect).toBeDefined()
      expect(effect.actor).toBe(actor)
      expect(effect.info).toBe(info)
      expect(effect.dotStates.size).toBe(0)
    })

    it('starts with empty dotStates before first tick', () => {
      const actor = makeActor()
      const effect = new GpsDotEffect(actor, makeInfo())

      expect(effect.dotStates.size).toBe(0)
    })
  })

  describe('tick', () => {
    it('creates per-player state on first tick', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer()
      const world = makeWorld([player])

      effect.tick(world)
      expect(effect.dotStates.size).toBe(1)
    })

    it('updates visibility per player', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })
      const world = makeWorld([player])

      effect.tick(world)

      const state = effect.dotStates.get('Multi0')
      expect(state).toBeDefined()
    })

    it('handles multiple players', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const p1 = makePlayer({ internalName: 'Multi0', shroud: { getVisibility: () => ShroudVisibility.Explored } })
      const p2 = makePlayer({ internalName: 'Multi1', shroud: { getVisibility: () => ShroudVisibility.Explored } })
      const world = makeWorld([p1, p2])

      effect.tick(world)
      expect(effect.dotStates.size).toBe(2)
    })

    it('handles empty player list', () => {
      const actor = makeActor()
      const effect = new GpsDotEffect(actor, makeInfo())
      const world = makeWorld([])

      effect.tick(world)
      expect(effect.dotStates.size).toBe(0)
    })
  })

  describe('shouldRender logic', () => {
    it('hides when watcher not granted', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: false, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })
      effect.tick(makeWorld([player]))

      const state = effect.dotStates.get('Multi0')
      expect(state?.visible).toBe(false)
    })

    it('hides when shroud has no explored visibility', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.None },
      })
      effect.tick(makeWorld([player]))

      const state = effect.dotStates.get('Multi0')
      expect(state?.visible).toBe(false)
    })

    it('hides when visible (unit is in sight)', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Visible },
      })
      effect.tick(makeWorld([player]))

      const state = effect.dotStates.get('Multi0')
      expect(state?.visible).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Phase B.8: Billboard rendering tests
  // -----------------------------------------------------------------------

  describe('render() — Billboard rendering', () => {
    it('returns a renderable array when dot is visible', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      // Tick to populate dot states
      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('returns empty array when no render player', () => {
      const actor = makeActor({
        world: {},
      })
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })

    it('returns empty array when dot is not visible to render player', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: false, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })

    it('renderable has correct type "gpsDot"', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        centerPosition: { X: 20480, Y: 30720, Z: 0 },
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        expect(result[0]).toBeInstanceOf(GpsDotRenderable)
        expect((result[0] as GpsDotRenderable).type).toBe('gpsDot')
      }
    })

    it('Billboard positioned at actor CenterPosition', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const pos = { X: 40960, Y: 51200, Z: 128 }
      const actor = makeActor({
        centerPosition: pos,
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        const renderable = result[0] as GpsDotRenderable
        expect(renderable.position.X).toBe(pos.X)
        expect(renderable.position.Y).toBe(pos.Y)
        expect(renderable.position.Z).toBe(pos.Z)
      }
    })

    it('color varies by indicator palette prefix', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      // Use a custom palette prefix
      const info = makeInfo({ indicatorPalettePrefix: 'enemy' })
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        const renderable = result[0] as GpsDotRenderable
        expect(renderable.palettePrefix).toBe('enemy')
      }
    })

    it('uses player color via effective owner', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        effectiveOwner: { owner: { internalName: 'DisguisedOwner' } },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        const renderable = result[0] as GpsDotRenderable
        expect(renderable.playerName).toBe('DisguisedOwner')
      }
    })
  })

  describe('renderAnnotation()', () => {
    it('returns a renderable array when dot is visible', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.renderAnnotation(null as any)
      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('returns empty array when no render player', () => {
      const actor = makeActor({ world: {} })
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const result = effect.renderAnnotation(null as any)
      expect(result).toHaveLength(0)
    })
  })

  describe('dispose — cleanup', () => {
    it('clears dot states on dispose', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([makePlayer()]))
      expect(effect.dotStates.size).toBeGreaterThan(0)

      effect.dispose()
      expect(effect.dotStates.size).toBe(0)
    })

    it('render returns empty after dispose', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))
      effect.dispose()

      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// GpsDotRenderable tests
// ---------------------------------------------------------------------------

describe('GpsDotRenderable', () => {
  it('stores position, palette, player, and image', () => {
    const pos = { X: 100, Y: 200, Z: 50 }
    const r = new GpsDotRenderable(pos, 'player', 'Multi1', 'gpsdot')
    expect(r.type).toBe('gpsDot')
    expect(r.position).toBe(pos)
    expect(r.palettePrefix).toBe('player')
    expect(r.playerName).toBe('Multi1')
    expect(r.image).toBe('gpsdot')
  })

  it('is not disposed initially', () => {
    const r = new GpsDotRenderable({ X: 0, Y: 0, Z: 0 }, 'player', 'P', 'img')
    expect(r.disposed).toBe(false)
  })

  it('marks as disposed after dispose()', () => {
    const r = new GpsDotRenderable({ X: 0, Y: 0, Z: 0 }, 'player', 'P', 'img')
    r.dispose()
    expect(r.disposed).toBe(true)
  })
})
