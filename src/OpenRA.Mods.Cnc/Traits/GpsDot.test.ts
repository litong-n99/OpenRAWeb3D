/**
 * GpsDot.test.ts — unit tests for GPS minimap dot trait
 *
 * Tests focus on: lifecycle management (create/add/remove), GpsDotInfo
 * defaults, and effect creation/cleanup.
 *
 * Phase B.8: Updated tests to use real GpsDotEffect instead of stub {}.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GpsDotInfo, GpsDot } from './GpsDot.js'
import { GpsDotEffect } from '../Effects/GpsDotEffect.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'testUnit'): IGameActor {
  return {
    actorId: 42,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
  }
}

// ---------------------------------------------------------------------------
// GpsDotInfo
// ---------------------------------------------------------------------------

describe('GpsDotInfo', () => {
  describe('defaults', () => {
    const info = new GpsDotInfo()

    it('has default image of "gpsdot"', () => {
      expect(info.image).toBe('gpsdot')
    })

    it('has default string of "Infantry"', () => {
      expect(info.string).toBe('Infantry')
    })

    it('has default indicatorPalettePrefix of "player"', () => {
      expect(info.indicatorPalettePrefix).toBe('player')
    })
  })

  describe('custom params', () => {
    it('accepts custom image', () => {
      const info = new GpsDotInfo({ image: 'customdot' })
      expect(info.image).toBe('customdot')
    })

    it('accepts custom string', () => {
      const info = new GpsDotInfo({ string: 'Vehicle' })
      expect(info.string).toBe('Vehicle')
    })

    it('accepts custom indicatorPalettePrefix', () => {
      const info = new GpsDotInfo({ indicatorPalettePrefix: 'enemy' })
      expect(info.indicatorPalettePrefix).toBe('enemy')
    })
  })

  describe('create', () => {
    it('creates a GpsDot instance', () => {
      const info = new GpsDotInfo()
      const actor = makeActor()
      const dot = info.create(actor)
      expect(dot).toBeInstanceOf(GpsDot)
      expect(dot.info).toBe(info)
    })
  })
})

// ---------------------------------------------------------------------------
// GpsDot
// ---------------------------------------------------------------------------

describe('GpsDot', () => {
  let info: GpsDotInfo
  let gpsDot: GpsDot
  let actor: IGameActor

  beforeEach(() => {
    info = new GpsDotInfo({ string: 'Tank' })
    gpsDot = new GpsDot(info)
    actor = makeActor()
  })

  describe('initial state', () => {
    it('has no effect before created() is called', () => {
      expect(gpsDot.effect).toBeNull()
    })

    it('stores info reference', () => {
      expect(gpsDot.info).toBe(info)
    })
  })

  describe('created()', () => {
    it('creates a real GpsDotEffect instance', () => {
      gpsDot.created(actor)
      expect(gpsDot.effect).not.toBeNull()
      expect(gpsDot.effect).toBeInstanceOf(GpsDotEffect)
    })

    it('stores actor and info in the effect', () => {
      gpsDot.created(actor)
      const effect = gpsDot.effect!
      expect(effect.actor).toBe(actor)
      expect(effect.info.indicatorPalettePrefix).toBe(info.indicatorPalettePrefix)
    })
  })

  describe('addedToWorld()', () => {
    it('does not throw when effect is created (world may not have addEffect)', () => {
      gpsDot.created(actor)
      expect(() => gpsDot.addedToWorld(actor)).not.toThrow()
    })

    it('does not throw when effect is not yet created', () => {
      expect(() => gpsDot.addedToWorld(actor)).not.toThrow()
    })

    it('adds effect to world when world supports addEffect', () => {
      gpsDot.created(actor)
      const addedEffects: unknown[] = []
      const actorWithWorld = {
        ...actor,
        world: { addEffect: (e: unknown) => addedEffects.push(e) },
      } as unknown as IGameActor
      gpsDot.addedToWorld(actorWithWorld)
      expect(addedEffects.length).toBe(1)
    })
  })

  describe('removedFromWorld()', () => {
    it('does not throw when effect is created', () => {
      gpsDot.created(actor)
      expect(() => gpsDot.removedFromWorld(actor)).not.toThrow()
    })

    it('does not throw when effect is not yet created', () => {
      expect(() => gpsDot.removedFromWorld(actor)).not.toThrow()
    })

    it('clears effect reference after removal', () => {
      gpsDot.created(actor)
      gpsDot.removedFromWorld(actor)
      expect(gpsDot.effect).toBeNull()
    })

    it('removes effect from world when world supports removeEffect', () => {
      gpsDot.created(actor)
      const removedEffects: unknown[] = []
      const actorWithWorld = {
        ...actor,
        world: {
          addEffect: () => {},
          removeEffect: (e: unknown) => removedEffects.push(e),
        },
      } as unknown as IGameActor
      gpsDot.removedFromWorld(actorWithWorld)
      expect(removedEffects.length).toBe(1)
    })
  })

  describe('full lifecycle', () => {
    it('completes create → add → remove cycle and cleans up', () => {
      const actor2 = makeActor('lifecycleActor')
      gpsDot.created(actor2)
      expect(gpsDot.effect).not.toBeNull()
      gpsDot.addedToWorld(actor2)
      gpsDot.removedFromWorld(actor2)
      // Effect is cleaned up on removal
      expect(gpsDot.effect).toBeNull()
    })

    it('works with multiple actors', () => {
      const dot1 = new GpsDot(new GpsDotInfo({ string: 'Infantry' }))
      const dot2 = new GpsDot(new GpsDotInfo({ string: 'Vehicle' }))
      const a1 = makeActor('actor1')
      const a2 = makeActor('actor2')

      dot1.created(a1)
      dot2.created(a2)

      expect(dot1.effect!.actor).toBe(a1)
      expect(dot2.effect!.actor).toBe(a2)
      expect(dot1.info.string).toBe('Infantry')
      expect(dot2.info.string).toBe('Vehicle')
    })
  })
})
