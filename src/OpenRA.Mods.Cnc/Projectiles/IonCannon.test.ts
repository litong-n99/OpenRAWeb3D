/**
 * IonCannon.test.ts — IonCannon projectile unit tests
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

import { IonCannon } from './IonCannon.js'
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
  return {
    addFrameEndTask: vi.fn(),
    players: [],
  } as unknown as GameWorldManager
}

function makeWeapon(overrides?: { report?: string | null; impact?: typeof vi.fn }) {
  return {
    report: overrides?.report ?? null,
    impact: overrides?.impact ?? vi.fn(),
  }
}

function makeTarget() {
  return { centerPosition: makeWPos(100, 200, 0) }
}

describe('IonCannon', () => {
  let player: PlayerStub
  let weapon: ReturnType<typeof makeWeapon>
  let world: GameWorldManager
  let target: ReturnType<typeof makeTarget>
  let launchPos: WPos

  beforeEach(() => {
    player = makePlayer()
    weapon = makeWeapon()
    world = makeWorld()
    target = makeTarget()
    launchPos = makeWPos(50, 50, 0)
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes without error', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 5,
      )
      expect(ion).toBeDefined()
      expect(ion.isDestroyed).toBe(false)
    })

    it('sets weaponDelay from constructor parameter', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 10,
      )
      expect(ion.weaponDelay).toBe(10)
    })

    it('accepts delay of 0', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 0,
      )
      expect(ion.weaponDelay).toBe(0)
    })

    it('creates animation with the effect image', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 5,
      )
      expect(ion.anim).toBeDefined()
      expect(ion.anim.image).toBe('ionsfx')
    })
  })

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('decrements weaponDelay each tick', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 3,
      )
      ion.tick(world)
      expect(ion.weaponDelay).toBe(2)
      ion.tick(world)
      expect(ion.weaponDelay).toBe(1)
    })

    it('applies weapon impact after weaponDelay reaches 0', () => {
      const impactSpy = vi.fn()
      weapon = makeWeapon({ impact: impactSpy })
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 2,
      )

      ion.tick(world) // delay: 2→1
      expect(impactSpy).not.toHaveBeenCalled()

      ion.tick(world) // delay: 1→0
      expect(impactSpy).not.toHaveBeenCalled()

      ion.tick(world) // delay: 0→-1, impact!
      expect(impactSpy).toHaveBeenCalledTimes(1)
      expect(ion.impacted).toBe(true)
    })

    it('applies weapon impact on tick 0 for delay=0', () => {
      const impactSpy = vi.fn()
      weapon = makeWeapon({ impact: impactSpy })
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 0,
      )

      ion.tick(world) // delay: 0→-1, impact immediately
      expect(impactSpy).toHaveBeenCalledTimes(1)
      expect(ion.impacted).toBe(true)
    })

    it('does not apply multiple impacts after first', () => {
      const impactSpy = vi.fn()
      weapon = makeWeapon({ impact: impactSpy })
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 0,
      )

      ion.tick(world)
      ion.tick(world)
      ion.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(1)
    })

    it('advances animation each tick', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 5,
      )
      expect(ion.anim.currentTick).toBe(0)
      ion.tick(world)
      expect(ion.anim.currentTick).toBe(1)
      ion.tick(world)
      expect(ion.anim.currentTick).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Animation completion
  // ---------------------------------------------------------------------------

  describe('animation completion', () => {
    it('marks as destroyed after animation completes', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 5,
      )

      // Advance 12 ticks (animation length)
      for (let i = 0; i < 12; i++) {
        ion.tick(world)
      }
      expect(ion.isDestroyed).toBe(true)
    })

    it('is not destroyed before animation completes', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 5,
      )

      for (let i = 0; i < 11; i++) {
        ion.tick(world)
      }
      expect(ion.isDestroyed).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('returns non-empty renderable array after animation is started', () => {
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 5,
      )
      const result = ion.render(null as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('handle no-delay weapon: immediate impact + delayed destroy', () => {
      const impactSpy = vi.fn()
      weapon = makeWeapon({ impact: impactSpy })
      const ion = new IonCannon(
        player, weapon, world, launchPos, target,
        'ionsfx', 'beam', 'effect', 0,
      )

      // Impact on first tick
      ion.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(1)
      expect(ion.impacted).toBe(true)
      expect(ion.isDestroyed).toBe(false)

      // Animation plays out
      for (let i = 0; i < 11; i++) {
        ion.tick(world)
      }
      expect(ion.isDestroyed).toBe(true)
      expect(impactSpy).toHaveBeenCalledTimes(1)
    })
  })
})
