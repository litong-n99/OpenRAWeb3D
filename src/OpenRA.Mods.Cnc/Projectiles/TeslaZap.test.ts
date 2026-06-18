/**
 * TeslaZap.test.ts — TeslaZap projectile unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, tick logic, target tracking, render output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  LinesMesh: vi.fn(),
  ShaderMaterial: vi.fn(),
  Color3: vi.fn(function (this: any, r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b }),
  MeshBuilder: {
    CreateLines: vi.fn(),
    CreateDisc: vi.fn(),
    CreatePlane: vi.fn(),
  },
  Mesh: {
    BILLBOARDMODE_ALL: 7,
    BILLBOARDMODE_NONE: 0,
  },
  Effect: { ShadersStore: {} },
  Vector3: vi.fn(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { TeslaZap, DEFAULT_TESLA_ZAP_INFO } from './TeslaZap.js'
import type { TeslaZapInfo, TeslaZapArgs } from './TeslaZap.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWPos(x = 0, y = 0, z = 0): WPos {
  return new WPos(x, y, z)
}

function makeActor(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    location: { X: 0, Y: 0 },
    owner: {},
  } as unknown as IGameActor
}

function makeWorld(): GameWorldManager {
  return {
    addFrameEndTask: vi.fn(),
    players: [],
  } as unknown as GameWorldManager
}

function makeValidGuidedTarget() {
  return {
    isValidFor: () => true,
    centerPosition: makeWPos(50, 50, 0),
    positions: {
      closestToIgnoringPath: () => makeWPos(50, 50, 0),
    },
  }
}

function makeInvalidGuidedTarget() {
  return {
    isValidFor: () => false,
    centerPosition: makeWPos(50, 50, 0),
    positions: {
      closestToIgnoringPath: () => makeWPos(50, 50, 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeslaZap', () => {
  let info: TeslaZapInfo
  let args: TeslaZapArgs
  let world: GameWorldManager

  beforeEach(() => {
    info = { ...DEFAULT_TESLA_ZAP_INFO }
    args = {
      sourceActor: makeActor(),
      source: makeWPos(0, 0, 0),
      passiveTarget: makeWPos(100, 100, 0),
      guidedTarget: makeValidGuidedTarget(),
      weapon: {
        targetActorCenter: false,
        impact: vi.fn(),
      },
    }
    world = makeWorld()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with correct ticksUntilRemove from Duration', () => {
      const zap = new TeslaZap(info, args)
      expect(zap.ticksUntilRemove).toBe(2)
    })

    it('clamps damageDuration to Duration', () => {
      const info2: TeslaZapInfo = { ...DEFAULT_TESLA_ZAP_INFO, duration: 1, damageDuration: 5 }
      const zap = new TeslaZap(info2, args)
      expect(zap.damageDuration).toBe(1)
    })

    it('sets initial target to passiveTarget', () => {
      const zap = new TeslaZap(info, args)
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })

    it('starts as not destroyed', () => {
      const zap = new TeslaZap(info, args)
      expect(zap.isDestroyed).toBe(false)
    })

    it('uses custom info values', () => {
      const custom: TeslaZapInfo = {
        ...DEFAULT_TESLA_ZAP_INFO,
        image: 'custom',
        brightSequence: 'flash',
        palette: 'player',
        brightZaps: 3,
        dimZaps: 5,
        duration: 10,
        damageDuration: 8,
        trackTarget: false,
        zOffset: 5,
      }
      const zap = new TeslaZap(custom, args)
      expect(zap.ticksUntilRemove).toBe(10)
      expect(zap.damageDuration).toBe(8)
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })
  })

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('decrements ticksUntilRemove each tick', () => {
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      expect(zap.ticksUntilRemove).toBe(1)
      zap.tick(world)
      expect(zap.ticksUntilRemove).toBe(0)
    })

    it('marks as destroyed after duration expires', () => {
      const zap = new TeslaZap(info, args)
      zap.tick(world) // ticksUntilRemove: 2→1
      zap.tick(world) // ticksUntilRemove: 1→0
      zap.tick(world) // ticksUntilRemove: 0→-1, destroyed
      expect(zap.isDestroyed).toBe(true)
      expect(zap.ticksUntilRemove).toBeLessThan(0)
    })

    it('applies weapon impact while damageDuration > 0', () => {
      const impactSpy = vi.fn()
      args.weapon.impact = impactSpy
      const zap = new TeslaZap(info, args)

      zap.tick(world) // damageDuration: 1→0, impact called
      expect(impactSpy).toHaveBeenCalledTimes(1)

      zap.tick(world) // damageDuration: 0→-1, no impact
      expect(impactSpy).toHaveBeenCalledTimes(1)
    })

    it('tracks target when TrackTarget is enabled and guidedTarget is valid', () => {
      const zap = new TeslaZap(info, args)
      // First tick: track target
      zap.tick(world)
      expect(zap.target).toEqual(makeWPos(50, 50, 0)) // centerPosition
    })

    it('uses closestToIgnoringPath when targetActorCenter is false', () => {
      args.weapon.targetActorCenter = false
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      expect(zap.target).toEqual(makeWPos(50, 50, 0))
    })

    it('uses centerPosition when targetActorCenter is true', () => {
      args.weapon.targetActorCenter = true
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      expect(zap.target).toEqual(makeWPos(50, 50, 0))
    })

    it('does not track target when TrackTarget is disabled', () => {
      info = { ...DEFAULT_TESLA_ZAP_INFO, trackTarget: false }
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      // target should remain at passiveTarget since tracking is disabled
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })

    it('does not track target when guidedTarget is invalid', () => {
      args.guidedTarget = makeInvalidGuidedTarget()
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      // target should remain at passiveTarget since guidedTarget is invalid
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('returns a renderable array with one element', () => {
      const zap = new TeslaZap(info, args)
      const renderables = zap.render(null as any)
      expect(renderables).toHaveLength(1)
    })

    it('updates the cached zap renderable each frame', () => {
      const zap = new TeslaZap(info, args)
      const r1 = zap.render(null as any)
      const r2 = zap.render(null as any)
      expect(zap.zap).toBeDefined()
      // The returned arrays are different (each tick creates new renderable in C#)
      expect(r1).toHaveLength(1)
      expect(r2).toHaveLength(1)
    })

    it('includes correct image and sequence info in renderable', () => {
      const zap = new TeslaZap(info, args)
      zap.render(null as any)
      const st = zap.zap
      expect(st?.image).toBe('litning')
      expect(st?.brightSequence).toBe('bright')
      expect(st?.dimSequence).toBe('dim')
      expect(st?.brightZaps).toBe(1)
      expect(st?.dimZaps).toBe(2)
      expect(st?.palette).toBe('effect')
    })
  })

  // ---------------------------------------------------------------------------
  // Full lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('tracks target, applies damage, then expires', () => {
      const impactSpy = vi.fn()
      args.weapon.impact = impactSpy
      info = { ...DEFAULT_TESLA_ZAP_INFO, duration: 5, damageDuration: 3 }
      const zap = new TeslaZap(info, args)

      // Tick 1-3: damage + tracking
      for (let i = 0; i < 3; i++) zap.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(3)

      // Tick 4-5: tracking only (damage complete)
      for (let i = 0; i < 2; i++) zap.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(3)
      expect(zap.isDestroyed).toBe(false)
      expect(zap.ticksUntilRemove).toBe(0)

      // Tick 6: expires
      zap.tick(world)
      expect(zap.isDestroyed).toBe(true)
    })
  })
})
