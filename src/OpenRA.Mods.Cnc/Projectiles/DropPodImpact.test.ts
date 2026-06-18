/**
 * DropPodImpact.test.ts — DropPodImpact projectile unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  MeshBuilder: {
    CreatePlane: vi.fn(() => ({
      dispose: vi.fn(),
      material: null,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scaling: { x: 1, y: 1, z: 1 },
      isVisible: true,
      updateVerticesData: vi.fn(),
      getVerticesData: vi.fn(() => new Float32Array(24)),
    })),
  },
}))

import { DropPodImpact } from './DropPodImpact.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

function makeWPos(x = 0, y = 0, z = 0): WPos {
  return new WPos(x, y, z)
}

function makePlayer(): PlayerStub {
  return {
    playerActor: { actorId: 1, isInWorld: true },
    internalName: 'Multi0',
  } as unknown as PlayerStub
}

function makeWorld(): GameWorldManager {
  return { addFrameEndTask: vi.fn(), players: [] } as unknown as GameWorldManager
}

function makeWeapon(overrides?: { report?: string | null; impact?: typeof vi.fn }) {
  return {
    report: overrides?.report ?? null,
    impact: overrides?.impact ?? vi.fn(),
  }
}

describe('DropPodImpact', () => {
  let player: PlayerStub
  let weapon: ReturnType<typeof makeWeapon>
  let world: GameWorldManager
  let launchPos: WPos

  beforeEach(() => {
    player = makePlayer()
    weapon = makeWeapon()
    world = makeWorld()
    launchPos = makeWPos(50, 50, 1000) // Sky entry
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes without error', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        5, 'podfx', 'entry', 'effect',
      )
      expect(pod).toBeDefined()
      expect(pod.isDestroyed).toBe(false)
    })

    it('sets weaponDelay from constructor parameter', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        8, 'podfx', 'entry', 'effect',
      )
      expect(pod.weaponDelay).toBe(8)
    })

    it('stores launchPos for rendering', () => {
      const lp = makeWPos(10, 20, 500)
      const pod = new DropPodImpact(
        player, weapon, world, lp,
        { centerPosition: makeWPos(100, 200, 0) },
        5, 'podfx', 'entry', 'effect',
      )
      expect(pod.launchPos).toEqual(lp)
    })

    it('creates entry animation with the entry effect', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        5, 'podfx', 'entry', 'effect',
      )
      expect(pod.entryAnimation).toBeDefined()
      expect(pod.entryAnimation.image).toBe('podfx')
    })
  })

  // ---------------------------------------------------------------------------
  // Tick and Delay
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('decrements weaponDelay each tick', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        3, 'podfx', 'entry', 'effect',
      )
      pod.tick(world)
      expect(pod.weaponDelay).toBe(2)
      pod.tick(world)
      expect(pod.weaponDelay).toBe(1)
    })

    it('applies weapon impact after weaponDelay expires', () => {
      const impactSpy = vi.fn()
      weapon = makeWeapon({ impact: impactSpy })
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        1, 'podfx', 'entry', 'effect',
      )

      pod.tick(world) // delay: 1→0
      expect(impactSpy).not.toHaveBeenCalled()

      pod.tick(world) // delay: 0→-1, impact
      expect(impactSpy).toHaveBeenCalledTimes(1)
      expect(pod.impacted).toBe(true)
    })

    it('does not apply multiple impacts', () => {
      const impactSpy = vi.fn()
      weapon = makeWeapon({ impact: impactSpy })
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        0, 'podfx', 'entry', 'effect',
      )

      pod.tick(world)
      pod.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(1)
    })

    it('advances entry animation each tick', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        5, 'podfx', 'entry', 'effect',
      )
      expect(pod.entryAnimation.currentTick).toBe(0)
      pod.tick(world)
      expect(pod.entryAnimation.currentTick).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Animation completion
  // ---------------------------------------------------------------------------

  describe('animation completion', () => {
    it('marks as destroyed after animation completes', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        5, 'podfx', 'entry', 'effect',
      )
      for (let i = 0; i < 12; i++) {
        pod.tick(world)
      }
      expect(pod.isDestroyed).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('returns non-empty renderable array after entry animation is started', () => {
      const pod = new DropPodImpact(
        player, weapon, world, launchPos,
        { centerPosition: makeWPos(100, 200, 0) },
        5, 'podfx', 'entry', 'effect',
      )
      const result = pod.render(null as any)
      expect(result.length).toBeGreaterThan(0)
      expect(result).toHaveLength(1)
    })
  })
})
