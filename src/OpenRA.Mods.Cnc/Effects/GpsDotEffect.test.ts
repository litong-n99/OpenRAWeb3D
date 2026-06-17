/**
 * GpsDotEffect.test.ts — GpsDotEffect unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import { GpsDotEffect, ShroudVisibility } from './GpsDotEffect.js'
import type { GpsDotInfo } from './GpsDotEffect.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(): GpsDotInfo {
  return {
    image: 'gpsdot',
    string_: 'Infantry',
    indicatorPalettePrefix: 'player',
  }
}

function makeActor(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    centerPosition: { X: 10240, Y: 10240, Z: 0 },
    owner: { internalName: 'Multi1', isAlliedWith: () => false },
    location: { X: 10, Y: 10 },
    traitsImplementing: () => [],
  } as unknown as IGameActor
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

  describe('render', () => {
    it('returns empty array (renders as annotation)', () => {
      const effect = new GpsDotEffect(makeActor(), makeInfo())
      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })
  })

  describe('renderAnnotation', () => {
    it('returns empty array (visuals deferred)', () => {
      const effect = new GpsDotEffect(makeActor(), makeInfo())
      const result = effect.renderAnnotation(null as any)
      expect(result).toHaveLength(0)
    })
  })
})
