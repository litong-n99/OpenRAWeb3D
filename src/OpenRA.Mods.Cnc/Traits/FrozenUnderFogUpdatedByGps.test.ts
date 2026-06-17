/**
 * FrozenUnderFogUpdatedByGps.test.ts — unit tests for GPS-updated frozen actors
 *
 * Tests focus on: trait initialization, player registration, owner change
 * dispatch, disposal cleanup, and GPS refresh notification handling.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FrozenUnderFogUpdatedByGpsInfo,
  FrozenUnderFogUpdatedByGps,
} from './FrozenUnderFogUpdatedByGps.js'
import { GpsWatcher } from './GpsWatcher.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'testBuilding', id: number = 1): IGameActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
  }
}

function makeFrozenActorLayerStub(): Record<string, unknown> {
  const frozenActors = new Map<number, { hasRenderables: boolean; invalidated: boolean; removed: boolean }>()
  return {
    frozenActors,
    FromID(id: number) {
      return frozenActors.get(id) ?? null
    },
    Remove(fa: Record<string, unknown>) {
      fa.removed = true
    },
  }
}

// ---------------------------------------------------------------------------
// FrozenUnderFogUpdatedByGpsInfo
// ---------------------------------------------------------------------------

describe('FrozenUnderFogUpdatedByGpsInfo', () => {
  it('creates a FrozenUnderFogUpdatedByGps instance', () => {
    // info is used by create() below
    const _info = new FrozenUnderFogUpdatedByGpsInfo()
    const actor = makeActor()
    const trait = _info.create(actor)
    expect(trait).toBeInstanceOf(FrozenUnderFogUpdatedByGps)
  })
})

// ---------------------------------------------------------------------------
// FrozenUnderFogUpdatedByGps
// ---------------------------------------------------------------------------

describe('FrozenUnderFogUpdatedByGps', () => {
  let _info: FrozenUnderFogUpdatedByGpsInfo
  let trait: FrozenUnderFogUpdatedByGps
  let actor: IGameActor

  beforeEach(() => {
    _info = new FrozenUnderFogUpdatedByGpsInfo()
    actor = makeActor()
    trait = new FrozenUnderFogUpdatedByGps(actor); void _info
  })

  describe('initial state', () => {
    it('stores self reference', () => {
      expect(trait.self).toBe(actor)
    })

    it('has zero registered players', () => {
      expect(trait.playerCount).toBe(0)
    })
  })

  describe('registerPlayer', () => {
    it('adds a player entry', () => {
      const player: PlayerStub & { frozenActorLayer?: any; playerActor?: IGameActor } = {
        playerName: 'player1',
        frozenActorLayer: makeFrozenActorLayerStub() as any,
        playerActor: makeActor('playerActor', 99),
      }
      trait.registerPlayer(0, player)
      expect(trait.playerCount).toBe(1)
    })

    it('does not add duplicate entries for the same index', () => {
      const player = { playerName: 'p1', frozenActorLayer: makeFrozenActorLayerStub() as any }
      trait.registerPlayer(0, player)
      trait.registerPlayer(0, player)
      expect(trait.playerCount).toBe(1)
    })

    it('registers with GpsWatcher when player actor has one', () => {
      const watcher = new GpsWatcher()
      const playerActor = makeActor('playerActor', 99)
      ;(playerActor as unknown as Record<string, unknown>)['gpsWatcher'] = watcher

      const player = {
        playerName: 'p1',
        frozenActorLayer: makeFrozenActorLayerStub() as any,
        playerActor,
      }
      trait.registerPlayer(0, player)
      expect(watcher.listenerCount).toBe(1)
    })
  })

  describe('onOwnerChanged', () => {
    it('does not throw with no registered players', () => {
      expect(() => trait.onOwnerChanged(actor, { playerName: 'old' }, { playerName: 'new' })).not.toThrow()
    })

    it('does not throw with registered players', () => {
      const player = {
        playerName: 'p1',
        frozenActorLayer: makeFrozenActorLayerStub() as any,
      }
      trait.registerPlayer(0, player)
      expect(() => trait.onOwnerChanged(actor, { playerName: 'old' }, { playerName: 'new' })).not.toThrow()
    })
  })

  describe('onGpsRefresh', () => {
    it('does not throw when actor is dead', () => {
      const deadActor = { ...actor, isDead: true }
      const player: PlayerStub = { playerName: 'p1' }
      expect(() => trait.onGpsRefresh(deadActor, player)).not.toThrow()
    })

    it('does not throw when actor is alive', () => {
      const player: PlayerStub = { playerName: 'p1' }
      expect(() => trait.onGpsRefresh(actor, player)).not.toThrow()
    })
  })

  describe('disposing', () => {
    it('cleans up all registered players', () => {
      const watcher = new GpsWatcher()
      const playerActor = makeActor('playerActor', 99)
      ;(playerActor as unknown as Record<string, unknown>)['gpsWatcher'] = watcher

      const player = {
        playerName: 'p1',
        frozenActorLayer: makeFrozenActorLayerStub() as any,
        playerActor,
      }
      trait.registerPlayer(0, player)
      expect(trait.playerCount).toBe(1)
      expect(watcher.listenerCount).toBe(1)

      trait.disposing(actor)
      expect(trait.playerCount).toBe(0)
      expect(watcher.listenerCount).toBe(0)
    })

    it('does not throw when no players registered', () => {
      expect(() => trait.disposing(actor)).not.toThrow()
    })
  })

  describe('full lifecycle', () => {
    it('register → onOwnerChanged → disposing cycle', () => {
      const player = {
        playerName: 'p1',
        frozenActorLayer: makeFrozenActorLayerStub() as any,
      }
      trait.registerPlayer(0, player)
      trait.onOwnerChanged(actor, { playerName: 'old' }, { playerName: 'new' })
      trait.disposing(actor)
      expect(trait.playerCount).toBe(0)
    })
  })
})
