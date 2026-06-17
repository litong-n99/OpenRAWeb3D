/**
 * GpsDot.test.ts — unit tests for GPS minimap dot trait
 *
 * Tests focus on: lifecycle management (create/add/remove), GpsDotInfo
 * defaults, and effect creation/cleanup.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GpsDotInfo, GpsDot } from './GpsDot.js'
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
    it('creates a GpsDotEffect stub', () => {
      gpsDot.created(actor)
      expect(gpsDot.effect).not.toBeNull()
    })

    it('stores references in the effect stub', () => {
      gpsDot.created(actor)
      const effect = gpsDot.effect!
      expect(effect.self).toBe(actor)
      expect(effect.info).toBe(info)
    })
  })

  describe('addedToWorld()', () => {
    it('does not throw when effect is created', () => {
      gpsDot.created(actor)
      expect(() => gpsDot.addedToWorld(actor)).not.toThrow()
    })

    it('does not throw when effect is not yet created', () => {
      expect(() => gpsDot.addedToWorld(actor)).not.toThrow()
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
  })

  describe('full lifecycle', () => {
    it('completes create → add → remove cycle without errors', () => {
      const actor2 = makeActor('lifecycleActor')
      gpsDot.created(actor2)
      expect(gpsDot.effect).not.toBeNull()
      gpsDot.addedToWorld(actor2)
      gpsDot.removedFromWorld(actor2)
      // Effect reference is maintained (cleanup is handled by World)
      expect(gpsDot.effect).not.toBeNull()
    })

    it('works with multiple actors', () => {
      const dot1 = new GpsDot(new GpsDotInfo({ string: 'Infantry' }))
      const dot2 = new GpsDot(new GpsDotInfo({ string: 'Vehicle' }))
      const a1 = makeActor('actor1')
      const a2 = makeActor('actor2')

      dot1.created(a1)
      dot2.created(a2)

      expect(dot1.effect!.self).toBe(a1)
      expect(dot2.effect!.self).toBe(a2)
      expect(dot1.info.string).toBe('Infantry')
      expect(dot2.info.string).toBe('Vehicle')
    })
  })
})
