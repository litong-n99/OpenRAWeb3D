/**
 * GameSaveViewportManager.test.ts — GameSaveViewportManager migration unit tests
 *
 * Tests focus on: issueTraitData viewport serialization, resolveTraitData
 * viewport restoration, observer mode RenderPlayer handling, null returns
 * for non-local players, worldLoaded storage.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  GameSaveViewportManager,
  GameSaveViewportManagerInfo,
  type GameSaveViewport,
  type GameSavePlayerStub,
  type GameSaveViewportWorld,
  type GameSaveViewportWorldRenderer,
} from './GameSaveViewportManager.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Create a mock WPos (minimal object matching WPos interface). */
function makeWPos(x: number, y: number, z: number): WPos {
  return { X: x, Y: y, Z: z, toString: () => `${x},${y},${z}` } as unknown as WPos
}

/** Create a mock player actor. */
function makePlayerActor(id: number) {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
  }
}

/** Create a mock player stub. */
function makePlayer(
  actorId: number,
  isBot: boolean = false,
): GameSavePlayerStub {
  return {
    playerActor: makePlayerActor(actorId),
    isBot,
    playerName: isBot ? `Bot${actorId}` : `Player${actorId}`,
  }
}

/** Create a mock viewport. */
function makeViewport(
  initialCenter: WPos = makeWPos(100, 200, 0),
): GameSaveViewport & { _lastCenter: WPos | null } {
  const vp = {
    _centerPosition: initialCenter,
    _lastCenter: null as WPos | null,
    get centerPosition(): WPos {
      return this._centerPosition
    },
    center(pos: WPos): void {
      this._lastCenter = pos
      this._centerPosition = pos
    },
  }
  return vp
}

/** Create a mock world. */
function makeWorld(overrides: {
  localPlayer?: GameSavePlayerStub | undefined
  renderPlayer?: GameSavePlayerStub | undefined
  players?: readonly GameSavePlayerStub[]
  getActorById?: (id: number) => unknown | undefined
} = {}): GameSaveViewportWorld {
  return {
    localPlayer: overrides.localPlayer,
    renderPlayer: overrides.renderPlayer,
    players: overrides.players ?? [],
    getActorById: (overrides.getActorById ?? (() => undefined)) as (actorId: number) => ReturnType<typeof makeActor> | undefined,
  }
}

/** Create a mock world renderer. */
function makeWorldRenderer(overrides: {
  world?: GameSaveViewportWorld
  viewport?: GameSaveViewport
} = {}): GameSaveViewportWorldRenderer {
  return {
    world: overrides.world ?? makeWorld(),
    viewport: overrides.viewport ?? makeViewport(),
  }
}

/** Create a mock actor with owner and world.
 *
 * NOTE: Cast to IGameActor for compatibility with trait interface signatures.
 * The IGameActor.world expects WorldStub which requires `actors`, but our
 * test stubs only provide the subset of World needed by the trait.
 */
function makeActor(overrides: {
  actorId?: number
  owner?: GameSavePlayerStub
  world?: GameSaveViewportWorld
} = {}): IGameActor {
  return {
    actorId: overrides.actorId ?? 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: overrides.owner ?? makePlayer(1),
    world: overrides.world ?? makeWorld(),
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// describe('GameSaveViewportManager')
// ---------------------------------------------------------------------------

describe('GameSaveViewportManager', () => {
  // ---------------------------------------------------------------------------
  // worldLoaded
  // ---------------------------------------------------------------------------

  describe('worldLoaded', () => {
    it('stores the world renderer reference', () => {
      const mgr = new GameSaveViewportManager()
      // Setup: create the actor that will double as localPlayer.playerActor
      const world = makeWorld()
      // Use a mutable ref that we can set localPlayer into
      const worldAny = world as unknown as Record<string, unknown>
      const self = makeActor({ actorId: 1, world })
      worldAny.localPlayer = {
        playerActor: self,
        isBot: false,
        playerName: 'Test1',
      } satisfies GameSavePlayerStub
      worldAny.players = [worldAny.localPlayer]
      const wr = makeWorldRenderer({ world })
      mgr.worldLoaded(null as unknown as object, wr)

      // self === localPlayer.playerActor (reference equality, same object)
      const data = mgr.issueTraitData(self)
      expect(data).not.toBeNull()
    })

    it('issueTraitData returns null when worldRenderer not loaded', () => {
      const mgr = new GameSaveViewportManager()
      // worldLoaded not called
      const data = mgr.issueTraitData(makeActor())
      expect(data).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // issueTraitData
  // ---------------------------------------------------------------------------

  describe('issueTraitData', () => {
    let mgr: GameSaveViewportManager
    let vp: ReturnType<typeof makeViewport>
    let wr: ReturnType<typeof makeWorldRenderer>

    beforeEach(() => {
      mgr = new GameSaveViewportManager()
      vp = makeViewport(makeWPos(512, 256, 0))
      wr = makeWorldRenderer({ viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)
    })

    it('returns Viewport WPos string for local player actor', () => {
      const world = makeWorld()
      const worldAny = world as unknown as Record<string, unknown>
      const self = makeActor({ actorId: 42, world, owner: makePlayer(42) })
      worldAny.localPlayer = {
        playerActor: self,
        isBot: false,
        playerName: 'Player42',
      } satisfies GameSavePlayerStub
      wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      const data = mgr.issueTraitData(self)
      expect(data).not.toBeNull()
      expect(data!.Viewport).toBe('512,256,0')
    })

    it('returns null for non-local player actor (other human)', () => {
      const localPlayer = makePlayer(1)
      const otherPlayer = makePlayer(2)
      const world = makeWorld({ localPlayer, players: [localPlayer, otherPlayer] })
      wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      const actor = makeActor({
        actorId: 2,
        owner: otherPlayer,
        world,
      })

      // This actor belongs to a different player than localPlayer
      const data = mgr.issueTraitData(actor)
      expect(data).toBeNull()
    })

    it('returns data for first bot when observer (no local player)', () => {
      const bot1 = makePlayer(10, true)
      const bot2 = makePlayer(20, true)
      const world = makeWorld({
        localPlayer: undefined, // observer mode
        players: [bot1, bot2],
      })
      wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      const actor = makeActor({
        actorId: 10,
        owner: bot1,
        world,
      })

      const data = mgr.issueTraitData(actor)
      expect(data).not.toBeNull()
      expect(data!.Viewport).toBe('512,256,0')
    })

    it('returns null for second bot when observer', () => {
      const bot1 = makePlayer(10, true)
      const bot2 = makePlayer(20, true)
      const world = makeWorld({
        localPlayer: undefined, // observer mode
        players: [bot1, bot2],
      })
      wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      const actor = makeActor({
        actorId: 20,
        owner: bot2,
        world,
      })

      // This is NOT the first bot
      const data = mgr.issueTraitData(actor)
      expect(data).toBeNull()
    })

    it('includes RenderPlayer in observer mode', () => {
      const bot1 = makePlayer(10, true)
      const observerPlayer = makePlayer(99)
      const world = makeWorld({
        localPlayer: undefined,
        renderPlayer: observerPlayer,
        players: [bot1, observerPlayer],
      })
      wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      const actor = makeActor({
        actorId: 10,
        owner: bot1,
        world,
      })

      const data = mgr.issueTraitData(actor)
      expect(data).not.toBeNull()
      expect(data!.Viewport).toBe('512,256,0')
      expect(data!.RenderPlayer).toBe(99)
    })

    it('does not include RenderPlayer when local player exists', () => {
      const world = makeWorld()
      const worldAny = world as unknown as Record<string, unknown>
      const self = makeActor({ actorId: 1, world, owner: makePlayer(1) })
      const renderPlayerActor = makeActor({ actorId: 2, world })
      worldAny.localPlayer = {
        playerActor: self,
        isBot: false,
        playerName: 'Player1',
      } satisfies GameSavePlayerStub
      const renderPlayer = {
        playerActor: renderPlayerActor,
        isBot: false,
        playerName: 'Player2',
      } satisfies GameSavePlayerStub
      worldAny.renderPlayer = renderPlayer
      worldAny.players = [worldAny.localPlayer, renderPlayer]
      wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      const data = mgr.issueTraitData(self)
      expect(data).not.toBeNull()
      expect(data!.RenderPlayer).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // resolveTraitData
  // ---------------------------------------------------------------------------

  describe('resolveTraitData', () => {
    let mgr: GameSaveViewportManager
    let vp: ReturnType<typeof makeViewport>

    beforeEach(() => {
      mgr = new GameSaveViewportManager()
      vp = makeViewport(makeWPos(0, 0, 0))
    })

    it('restores viewport center position from WPos string', () => {
      const world = makeWorld()
      const wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      mgr.resolveTraitData(makeActor(), { Viewport: '1024,2048,0' })

      expect(vp._lastCenter).not.toBeNull()
      expect(vp._lastCenter!.X).toBe(1024)
      expect(vp._lastCenter!.Y).toBe(2048)
      expect(vp._lastCenter!.Z).toBe(0)
    })

    it('does not crash when Viewport is missing', () => {
      const world = makeWorld()
      const wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      // Should not throw
      mgr.resolveTraitData(makeActor(), { SomeOtherKey: 'value' })
    })

    it('restores RenderPlayer from actor ID', () => {
      const renderPlayer = makePlayer(77)
      const actor77 = makeActor({ actorId: 77, owner: renderPlayer })
      const world = makeWorld({
        players: [renderPlayer],
        getActorById: (id: number) => (id === 77 ? actor77 : undefined),
        renderPlayer: undefined,
      })
      const wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      mgr.resolveTraitData(makeActor(), {
        Viewport: '100,200,0',
        RenderPlayer: 77,
      })

      expect(world.renderPlayer).toBe(renderPlayer)
    })

    it('does nothing when render player actor not found', () => {
      const world = makeWorld({
        getActorById: () => undefined,
      })
      const wr = makeWorldRenderer({ world, viewport: vp })
      mgr.worldLoaded(null as unknown as object, wr)

      // Should not throw
      mgr.resolveTraitData(makeActor(), {
        Viewport: '100,200,0',
        RenderPlayer: 999,
      })

      expect(world.renderPlayer).toBeUndefined()
    })

    it('does nothing when worldRenderer not loaded', () => {
      const mgr2 = new GameSaveViewportManager()
      // worldLoaded not called

      // Should not throw
      mgr2.resolveTraitData(makeActor(), { Viewport: '100,200,0' })
    })
  })

  // ---------------------------------------------------------------------------
  // GameSaveViewportManagerInfo
  // ---------------------------------------------------------------------------

  describe('GameSaveViewportManagerInfo', () => {
    it('create() returns a GameSaveViewportManager instance', () => {
      const info = new GameSaveViewportManagerInfo()
      const mgr = info.create({ self: makeActor() })
      expect(mgr).toBeInstanceOf(GameSaveViewportManager)
    })
  })
})
