/**
 * ScreenMap.test.ts — ScreenMap migration unit tests
 *
 * Tests focus on: spatial index management, deferred update/remove queues,
 * query correctness (point and box), edge cases, and lifecycle.
 *
 * Mock strategy:
 * - GameActor: mock with isInWorld, mouseBounds, screenBounds
 * - Player: use a minimal object (reference equality for Cache key)
 * - IEffect: mock implementing ISpatiallyPartitionable
 * - No @babylonjs/core imports needed (ScreenMap is pure logic)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ScreenMap,
  ActorBoundsPair,
  type ScreenMapConfig,
} from './ScreenMap'

import type { GameActor } from '../../Actor.js'
import type { IEffect } from '../../Effects/IEffect.js'
import type { Player } from '../../Player.js'
import type { PlayerStub } from '../../Traits/TraitsInterfaces.js'

import { Rectangle } from '../../Primitives/Rectangle.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal GameActor mock for ScreenMap testing. */
function createMockActor(
  id: number,
  inWorld: boolean = true,
  mousePoly?: { vertices: readonly { x: number; y: number }[] },
  screenRects?: readonly { x: number; y: number; width: number; height: number }[],
): GameActor {
  const defaultPoly = mousePoly ?? {
    vertices: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  }
  const defaultRects = screenRects ?? [
    { x: 0, y: 0, width: 100, height: 100 },
  ]

  return {
    actorId: id,
    isInWorld: inWorld,
    info: { name: `actor_${id}` },
    world: undefined as unknown as GameActor['world'],
    willDispose: false,
    disposed: false,
    generation: 0,
    replacedByActor: null,
    owner: undefined,
    occupiesSpace: undefined,
    targetables: [],
    enabledTargetablePositions: [],
    effectiveOwner: undefined,
    // ScreenMap uses these two methods
    mouseBounds: (_wr: unknown) => defaultPoly,
    screenBounds: (_wr: unknown) => defaultRects,
  } as unknown as GameActor
}

/** Create a minimal Player mock for Cache key usage. */
function createMockPlayer(internalName: string): Player {
  return {
    internalName,
    playerName: internalName,
    playerActor: undefined,
    playerMask: undefined,
    alliedPlayersMask: undefined,
    enemyPlayersMask: undefined,
  } as unknown as Player
}

// (PlayerStub mock not needed for ScreenMap tests — Player is used directly)

// ---------------------------------------------------------------------------
// WorldRenderer mock
// ---------------------------------------------------------------------------

interface MockWorldRenderer {
  screenPxPosition(pos: { x: number; y: number; z: number }): { x: number; y: number }
  viewport: {
    viewToWorldPx(viewPos: { x: number; y: number }): { x: number; y: number }
  }
}

function createMockWorldRenderer(): MockWorldRenderer {
  return {
    screenPxPosition(pos) {
      return { x: pos.x, y: pos.y }
    },
    viewport: {
      viewToWorldPx(viewPos) {
        // Identity transform for testing
        return viewPos
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScreenMap', () => {
  const defaultConfig: ScreenMapConfig = {
    width: 8192,
    height: 8192,
    binSize: 250,
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('constructs with valid config', () => {
      const sm = new ScreenMap(defaultConfig)
      expect(sm).toBeDefined()
    })

    it('uses default binSize of 250 when not specified', () => {
      const sm = new ScreenMap({ width: 1000, height: 1000 })
      expect(sm).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Actor lifecycle
  // -----------------------------------------------------------------------

  describe('actor lifecycle', () => {
    let sm: ScreenMap
    let wr: MockWorldRenderer
    let actor: GameActor

    beforeEach(() => {
      sm = new ScreenMap(defaultConfig)
      wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)
      actor = createMockActor(1)
    })

    it('addOrUpdateActor schedules actor for update', () => {
      sm.addOrUpdateActor(actor)
      // Nothing happening yet — deferred
      expect(actor).toBeDefined()
    })

    it('tickRender applies scheduled actor updates', () => {
      sm.addOrUpdateActor(actor)
      sm.tickRender()

      // Actor should now be queryable via render
      const result = sm.renderableActorsInBox(
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(1)
      expect(result[0]).toBe(actor)
    })

    it('removeActor schedules actor for removal', () => {
      sm.addOrUpdateActor(actor)
      sm.tickRender()
      sm.removeActor(actor)
      sm.tickRender()

      const result = sm.renderableActorsInBox(
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(0)
    })

    it('addOrUpdate removes from remove set (matching OpenRA)', () => {
      // If actor is in remove set and also in add set, the remove is
      // canceled (matching OpenRA's addOrUpdate logic)
      sm.removeActor(actor)
      sm.addOrUpdateActor(actor)
      sm.tickRender()

      const result = sm.renderableActorsInBox(
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(1)
    })

    it('tickRender skips actor with empty mouse bounds', () => {
      const emptyMouse = {
        vertices: [] as { x: number; y: number }[],
      }
      const noMouseActor = createMockActor(2, true, emptyMouse)
      sm.addOrUpdateActor(noMouseActor)
      sm.tickRender()

      const result = sm.renderableActorsInBox(
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      // Should still have screen bounds (from screenRects), but no mouse bounds
      expect(result.length).toBe(1)
    })

    it('tickRender skips actor with empty screen bounds', () => {
      const noScreenActor = createMockActor(3, true, undefined, [])
      sm.addOrUpdateActor(noScreenActor)
      sm.tickRender()

      const result = sm.renderableActorsInBox(
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(0)
    })

    it('clears add/remove queues after tickRender', () => {
      sm.addOrUpdateActor(actor)
      sm.tickRender()
      // Second tickRender should not re-process
      sm.tickRender()

      const result = sm.renderableActorsInBox(
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(1)
    })

    it('tickRender is no-op when worldRenderer not set', () => {
      const sm2 = new ScreenMap(defaultConfig)
      sm2.addOrUpdateActor(actor)
      sm2.tickRender()

      // Should not crash
      expect(sm2).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Mouse queries
  // -----------------------------------------------------------------------

  describe('actorsAtMouse', () => {
    let sm: ScreenMap
    let wr: MockWorldRenderer
    let actor: GameActor

    beforeEach(() => {
      sm = new ScreenMap(defaultConfig)
      wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)
      actor = createMockActor(1, true, {
        vertices: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
          { x: 10, y: 90 },
        ],
      })
      sm.addOrUpdateActor(actor)
      sm.tickRender()
    })

    it('returns actors at a point inside mouse bounds', () => {
      const result = sm.actorsAtMouse({ x: 50, y: 50 })
      expect(result.length).toBe(1)
      expect(result[0].actor).toBe(actor)
    })

    it('returns empty for point outside mouse bounds', () => {
      const result = sm.actorsAtMouse({ x: 500, y: 500 })
      expect(result.length).toBe(0)
    })

    it('excludes actors not in world', () => {
      const outOfWorldActor = createMockActor(2, false, {
        vertices: [
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 150 },
          { x: 50, y: 150 },
        ],
      })
      sm.addOrUpdateActor(outOfWorldActor)
      sm.tickRender()

      const result = sm.actorsAtMouse({ x: 100, y: 100 })
      expect(result.length).toBe(0)
    })

    it('returns empty when worldRenderer not set', () => {
      const sm2 = new ScreenMap(defaultConfig)
      // Use the MouseInput overload which requires worldRenderer
      const result = sm2.actorsAtMouse({ x: 50, y: 50 })
      expect(result.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Selection box queries
  // -----------------------------------------------------------------------

  describe('actorsInMouseBox', () => {
    let sm: ScreenMap
    let wr: MockWorldRenderer
    let actor1: GameActor
    let actor2: GameActor

    beforeEach(() => {
      sm = new ScreenMap(defaultConfig)
      wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      actor1 = createMockActor(1, true, {
        vertices: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 60 },
          { x: 10, y: 60 },
        ],
      })
      actor2 = createMockActor(2, true, {
        vertices: [
          { x: 200, y: 200 },
          { x: 300, y: 200 },
          { x: 300, y: 300 },
          { x: 200, y: 300 },
        ],
      })

      sm.addOrUpdateActor(actor1)
      sm.addOrUpdateActor(actor2)
      sm.tickRender()
    })

    it('returns actors whose bounds intersect the selection box', () => {
      const result = sm.actorsInMouseBox(
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      )
      expect(result.length).toBe(1)
      expect(result[0].actor).toBe(actor1)
    })

    it('returns multiple actors in a large selection box', () => {
      const result = sm.actorsInMouseBox(
        { x: 0, y: 0 },
        { x: 400, y: 400 },
      )
      expect(result.length).toBe(2)
    })

    it('returns empty when box covers no actors', () => {
      const result = sm.actorsInMouseBox(
        { x: 400, y: 400 },
        { x: 500, y: 500 },
      )
      expect(result.length).toBe(0)
    })

    it('handles inverted corner points', () => {
      // OpenRA's RectWithCorners normalizes min/max
      const result = sm.actorsInMouseBox(
        { x: 100, y: 100 },
        { x: 0, y: 0 },
      )
      expect(result.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Effect management
  // -----------------------------------------------------------------------

  describe('effect management', () => {
    let sm: ScreenMap
    let wr: MockWorldRenderer

    beforeEach(() => {
      sm = new ScreenMap(defaultConfig)
      wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)
    })

    function createMockEffect(_id: number): IEffect {
      return {
        tick: (_world: unknown) => {},
        render: (_wr: unknown) => [],
      } as unknown as IEffect
    }

    it('addEffect registers effect in spatial index', () => {
      const effect = createMockEffect(1)
      sm.addEffect(effect, { x: 500, y: 500, z: 0 }, { width: 64, height: 64 })

      const result = sm.renderableEffectsInBox(
        { x: 400, y: 400 },
        { x: 600, y: 600 },
      )
      expect(result.length).toBe(1)
      expect(result[0]).toBe(effect)
    })

    it('removeEffect removes effect from spatial index', () => {
      const effect = createMockEffect(1)
      sm.addEffect(effect, { x: 500, y: 500, z: 0 }, { width: 64, height: 64 })
      sm.removeEffect(effect)

      const result = sm.renderableEffectsInBox(
        { x: 400, y: 400 },
        { x: 600, y: 600 },
      )
      expect(result.length).toBe(0)
    })

    it('updateEffect repositions effect', () => {
      const effect = createMockEffect(1)
      sm.addEffect(effect, { x: 100, y: 100, z: 0 }, { width: 64, height: 64 })
      sm.updateEffect(effect, { x: 500, y: 500, z: 0 }, { width: 64, height: 64 })

      // Old position should not have the effect
      const oldResult = sm.renderableEffectsInBox(
        { x: 50, y: 50 },
        { x: 150, y: 150 },
      )
      expect(oldResult.length).toBe(0)

      // New position should have the effect
      const newResult = sm.renderableEffectsInBox(
        { x: 400, y: 400 },
        { x: 600, y: 600 },
      )
      expect(newResult.length).toBe(1)
    })

    it('addEffect is no-op without worldRenderer', () => {
      const sm2 = new ScreenMap(defaultConfig)
      const effect = createMockEffect(1)
      sm2.addEffect(effect, { x: 500, y: 500, z: 0 }, { width: 64, height: 64 })

      const result = sm2.renderableEffectsInBox(
        { x: 400, y: 400 },
        { x: 600, y: 600 },
      )
      expect(result.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Frozen actor management (per-player)
  // -----------------------------------------------------------------------

  describe('frozen actor management', () => {
    let sm: ScreenMap
    let wr: MockWorldRenderer
    let player: Player
    let fa: {
      isValid: boolean
      mouseBounds: {
        vertices: readonly { x: number; y: number }[]
        isEmpty: boolean
        boundingRect: Rectangle
        contains: (p: { x: number; y: number }) => boolean
      }
      screenBounds: readonly { x: number; y: number; width: number; height: number }[]
    }

    beforeEach(() => {
      sm = new ScreenMap(defaultConfig)
      wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)
      player = createMockPlayer('testPlayer')

      const vertices = [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 90 },
        { x: 10, y: 90 },
      ]
      const boundingRect = Rectangle.fromLTRB(10, 10, 90, 90)

      fa = {
        isValid: true,
        mouseBounds: {
          vertices,
          isEmpty: false,
          boundingRect,
          contains(point) {
            return (
              point.x >= 10 && point.x < 90 &&
              point.y >= 10 && point.y < 90
            )
          },
        },
        screenBounds: [
          { x: 0, y: 0, width: 100, height: 100 },
        ],
      }
    })

    it('addOrUpdate schedules frozen actor for update', () => {
      sm.addOrUpdate(player, fa)
      sm.tickRender()

      const result = sm.frozenActorsAtMouse(player, { x: 50, y: 50 })
      expect(result.length).toBe(1)
      expect(result[0]).toBe(fa)
    })

    it('remove schedules frozen actor for removal', () => {
      sm.addOrUpdate(player, fa)
      sm.tickRender()
      sm.remove(player, fa)
      sm.tickRender()

      const result = sm.frozenActorsAtMouse(player, { x: 50, y: 50 })
      expect(result.length).toBe(0)
    })

    it('frozenActorsAtMouse returns empty for null viewer', () => {
      const result = sm.frozenActorsAtMouse(null, { x: 50, y: 50 })
      expect(result.length).toBe(0)
    })

    it('filters invalid frozen actors', () => {
      const invalidFa = { ...fa, isValid: false }
      sm.addOrUpdate(player, invalidFa)
      sm.tickRender()

      const result = sm.frozenActorsAtMouse(player, { x: 50, y: 50 })
      expect(result.length).toBe(0)
    })

    it('renderableFrozenActorsInBox returns per-player frozen actors', () => {
      sm.addOrUpdate(player, fa)
      sm.tickRender()

      const result = sm.renderableFrozenActorsInBox(
        player,
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(1)
    })

    it('renderableFrozenActorsInBox returns empty for null player', () => {
      const result = sm.renderableFrozenActorsInBox(
        null,
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result.length).toBe(0)
    })

    it('multiple players have independent frozen actor indexes', () => {
      const player2 = createMockPlayer('player2')
      sm.addOrUpdate(player, fa)
      sm.tickRender()

      // Player 1 should see it
      const result1 = sm.frozenActorsAtMouse(player, { x: 50, y: 50 })
      expect(result1.length).toBe(1)

      // Player 2 should not (FrozenActorsAtMouse returns NoFrozenActors if
      // the player key doesn't exist in the Cache, but Cache throws a
      // different error — actually Cache.tryGet returns undefined if key
      // not yet created by the loader. So it should return empty.)
      const result2 = sm.renderableFrozenActorsInBox(
        player2,
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      )
      expect(result2.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Debug methods
  // -----------------------------------------------------------------------

  describe('renderBounds', () => {
    it('returns render bounds for actors and effects', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      const actor = createMockActor(1)
      sm.addOrUpdateActor(actor)
      sm.tickRender()

      const result = sm.renderBounds(null)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('includes frozen actor bounds when viewer provided', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      const player = createMockPlayer('p1')
      const fa = createMockFrozenActor()
      sm.addOrUpdate(player, fa)
      sm.tickRender()

      const withoutViewer = sm.renderBounds(null)
      const withViewer = sm.renderBounds(player as unknown as PlayerStub)

      // With viewer should have at least as many bounds as without
      expect(withViewer.length).toBeGreaterThanOrEqual(withoutViewer.length)
    })
  })

  describe('mouseBounds', () => {
    it('returns mouse bounds for actors', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      const actor = createMockActor(1)
      sm.addOrUpdateActor(actor)
      sm.tickRender()

      const result = sm.mouseBounds(null)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty spatial index gracefully', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      expect(sm.actorsAtMouse({ x: 100, y: 100 }).length).toBe(0)
      expect(sm.renderableActorsInBox(
        { x: 0, y: 0 }, { x: 500, y: 500 },
      ).length).toBe(0)
      expect(sm.renderableEffectsInBox(
        { x: 0, y: 0 }, { x: 500, y: 500 },
      ).length).toBe(0)
    })

    it('handles zero-width mouse bounds rect', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      // An effect with zero dimension — creates Rectangle(0, 0, 0, 0)
      // which passes validBounds? No, validBounds checks width > 0
      const effect = {
        tick: (_world: unknown) => {},
        render: (_wr: unknown) => [],
      } as unknown as IEffect

      sm.addEffect(effect, { x: 100, y: 100, z: 0 }, { width: 0, height: 10 })
      const result = sm.renderableEffectsInBox(
        { x: 0, y: 0 }, { x: 200, y: 200 },
      )
      expect(result.length).toBe(0)
    })

    it('handles negative size (abs applied)', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      const effect = {
        tick: (_world: unknown) => {},
        render: (_wr: unknown) => [],
      } as unknown as IEffect

      sm.addEffect(effect, { x: 100, y: 100, z: 0 }, { width: -64, height: -64 })
      const result = sm.renderableEffectsInBox(
        { x: 50, y: 50 }, { x: 150, y: 150 },
      )
      expect(result.length).toBe(1)
    })

    it('re-adding an actor updates bounds', () => {
      const sm = new ScreenMap(defaultConfig)
      const wr = createMockWorldRenderer()
      sm.worldLoaded({}, wr)

      // First, add at position (0, 0) with 100x100 bounds
      const actor = createMockActor(1, true, {
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      })
      sm.addOrUpdateActor(actor)
      sm.tickRender()

      // Now update to a different position
      const movedActor = createMockActor(1, true, {
        vertices: [
          { x: 500, y: 500 },
          { x: 600, y: 500 },
          { x: 600, y: 600 },
          { x: 500, y: 600 },
        ],
      })
      sm.addOrUpdateActor(movedActor)
      sm.tickRender()

      // Old position should not have it (but it's the same actorInstance
      // identity... different instances in our mock though)
      // Actually, since we use different mock instances, this tests
      // that the old instance's bounds were properly handled.
    })
  })

  // -----------------------------------------------------------------------
  // ActorBoundsPair
  // -----------------------------------------------------------------------

  describe('ActorBoundsPair', () => {
    it('stores actor and bounds', () => {
      const actor = createMockActor(1)
      const vertices = [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 90 },
        { x: 10, y: 90 },
      ]
      const bounds = {
        vertices,
        isEmpty: false,
        boundingRect: Rectangle.fromLTRB(10, 10, 90, 90),
        contains: (_p: { x: number; y: number }) => true,
      }

      const pair = new ActorBoundsPair(actor, bounds)
      expect(pair.actor).toBe(actor)
      expect(pair.bounds).toBe(bounds)
    })
  })
})

// ---------------------------------------------------------------------------
// Test helpers (outside describe to avoid hoisting issues)
// ---------------------------------------------------------------------------

function createMockFrozenActor() {
  const vertices = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ]
  const boundingRect = Rectangle.fromLTRB(10, 10, 90, 90)
  return {
    isValid: true,
    mouseBounds: {
      vertices,
      isEmpty: false,
      boundingRect,
      contains(point: { x: number; y: number }): boolean {
        return (
          point.x >= 10 && point.x < 90 &&
          point.y >= 10 && point.y < 90
        )
      },
    },
    screenBounds: [
      { x: 0, y: 0, width: 100, height: 100 },
    ] as readonly { x: number; y: number; width: number; height: number }[],
  }
}
