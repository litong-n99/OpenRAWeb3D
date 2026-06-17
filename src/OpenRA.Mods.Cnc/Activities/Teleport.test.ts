/**
 * Teleport.test.ts — Teleport activity unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  TransformNode: class MockTransformNode {},
}))

import { Teleport } from './Teleport.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMobile(setPosSpy?: (cell: CPos) => void): any {
  return {
    setPosition(_self: GameActor, cell: CPos, _subCell?: number) {
      setPosSpy?.(cell)
    },
    canEnterCell: (_cell: CPos) => true,
  }
}

function makePortableChrono(overrides?: { canTeleport?: boolean }): any {
  return {
    canTeleport: overrides?.canTeleport ?? true,
    resetChargeTime: vi.fn(),
  }
}

function makeSelf(
  traits?: Map<string, unknown>,
  loc?: CPos,
): GameActor {
  const resolved = traits ?? new Map()
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    location: loc ?? new CPos(10, 10),
    centerPosition: new WPos(10 * 1024 + 512, 10 * 1024 + 512, 0),
    owner: {
      internalName: 'Multi0',
      shroud: { isExplored: (_cell: CPos) => true },
    },
    traits: resolved,
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Teleport', () => {
  describe('constructor', () => {
    it('initializes with correct properties', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      expect(tp).toBeDefined()
      expect(tp.destination).toEqual(dest)
      expect(tp.isInterruptible).toBe(true)
    })

    it('sets isInterruptible to false when requested', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', false)
      expect(tp.isInterruptible).toBe(false)
    })

    it('accepts all constructor parameters', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      const tp = new Teleport(
        teleporter, dest, 30, true, true, 'chronosound',
        true, true, new Set(['Explosion']),
      )
      expect(tp).toBeDefined()
    })

    it('handles null teleporter', () => {
      const dest = new CPos(20, 20)

      const tp = new Teleport(null, dest, null, false, false, 'chrono', true)
      expect(tp).toBeDefined()
    })
  })

  describe('tick', () => {
    it('sets position on successful teleport', () => {
      const dest = new CPos(20, 20)
      let setPosCell: CPos | null = null

      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile((cell) => { setPosCell = cell }))

      const self = makeSelf(traits)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teleporter: any = { ...self }

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      const result = tp.tick(self)

      expect(result).toBe(true)
      expect(setPosCell).toEqual(dest)
    })

    it('increments generation on success', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self: any = makeSelf(traits)
      self.generation = 5
      const teleporter = self

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      tp.tick(self as GameActor)

      expect(self.generation).toBe(6)
    })

    it('returns true in single tick', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      expect(tp.tick(self)).toBe(true)
    })

    it('handles killOnFailure when portable chrono cannot teleport', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const killSpy = vi.fn()
      traits.set('PortableChrono', makePortableChrono({ canTeleport: false }))
      traits.set('Kill', { kill: killSpy })

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, true, new Set(['TeleportDeath']),
      )
      const result = tp.tick(self)

      expect(result).toBe(true)
      expect(killSpy).toHaveBeenCalledTimes(1)
    })

    it('skips killOnFailure when chrono can teleport', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const killSpy = vi.fn()
      traits.set('PortableChrono', makePortableChrono({ canTeleport: true }))
      traits.set('Mobile', makeMobile())
      traits.set('Kill', { kill: killSpy })

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, true, new Set(),
      )
      tp.tick(self)

      expect(killSpy).not.toHaveBeenCalled()
    })

    it('consumes chrono charges when self is teleporter', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const pc = makePortableChrono()
      traits.set('PortableChrono', pc)
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      tp.tick(self)

      expect(pc.resetChargeTime).toHaveBeenCalledTimes(1)
    })

    it('does not consume charges when teleporter is different actor', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const pc = makePortableChrono()
      traits.set('PortableChrono', pc)
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = makeSelf(new Map())

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      tp.tick(self)

      expect(pc.resetChargeTime).not.toHaveBeenCalled()
    })
  })

  describe('chooseBestDestinationCell', () => {
    it('returns null when teleporter is null', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const tp = new Teleport(null, dest, null, false, false, 'chrono', true)
      const result = tp.tick(self)

      expect(result).toBe(true)
    })

    it('returns destination when cell is enterable and explored', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(teleporter, dest, 5, false, false, 'chrono', true)
      const result = tp.tick(self)

      expect(result).toBe(true)
    })
  })

  describe('killCargo', () => {
    it('kills cargo when killCargo is true', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      let killCalled = false
      const unloadSpy = vi.fn().mockReturnValue({
        actorId: 99,
        kill() { killCalled = true },
      } as any)

      const cargo = {
        isEmpty: () => false,
        unload: () => {
          // Second call returns empty
          ;((cargo as any).isEmpty as any) = () => true
          return unloadSpy()
        },
      }

      traits.set('Mobile', makeMobile())
      traits.set('Cargo', cargo)

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, true, false, 'chrono',
        true, false, new Set(),
      )
      tp.tick(self)

      expect(unloadSpy).toHaveBeenCalled()
      expect(killCalled).toBe(true)
    })

    it('skips cargo kill when killCargo is false', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      let unloadCalled = false
      const cargo = {
        isEmpty: () => false,
        unload() { unloadCalled = true },
      }

      traits.set('Mobile', makeMobile())
      traits.set('Cargo', cargo)

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      tp.tick(self)

      expect(unloadCalled).toBe(false)
    })
  })
})
