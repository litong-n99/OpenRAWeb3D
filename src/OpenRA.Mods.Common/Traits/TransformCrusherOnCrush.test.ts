/**
 * TransformCrusherOnCrush.test.ts -- TransformCrusherOnCrush migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * Tests focus on: config defaults, crush class filtering, onCrush transformation
 * logic, warnCrush no-op, faction handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BitSet } from '../../OpenRA.Game/Primitives/BitSet.js'
import {
  TransformCrusherOnCrush,
  TransformCrusherOnCrushInfo,
} from './TransformCrusherOnCrush.js'
import {
  CRUSH_CLASS_TYPENAME,
  type CrushClass,
} from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransformCrusherOnCrushInfo', () => {
  beforeEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  afterEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  it('has default intoActor as empty string', () => {
    const info = new TransformCrusherOnCrushInfo()
    expect(info.intoActor).toBe('')
  })

  it('has default skipMakeAnims as true', () => {
    const info = new TransformCrusherOnCrushInfo()
    expect(info.skipMakeAnims).toBe(true)
  })

  it('has empty default crushClasses', () => {
    const info = new TransformCrusherOnCrushInfo()
    expect(info.crushClasses.isEmpty).toBe(true)
  })

  it('accepts custom intoActor', () => {
    const info = new TransformCrusherOnCrushInfo({ intoActor: 'e3' })
    expect(info.intoActor).toBe('e3')
  })

  it('accepts custom skipMakeAnims', () => {
    const info = new TransformCrusherOnCrushInfo({ skipMakeAnims: false })
    expect(info.skipMakeAnims).toBe(false)
  })

  it('accepts custom crushClasses', () => {
    const info = new TransformCrusherOnCrushInfo({ crushClasses: ['infantry'] })
    expect(info.crushClasses.contains('infantry')).toBe(true)
  })
})

describe('TransformCrusherOnCrush', () => {
  let info: TransformCrusherOnCrushInfo
  let trait: TransformCrusherOnCrush
  let infantryCC: BitSet<CrushClass>
  let vehicleCC: BitSet<CrushClass>

  beforeEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
    // Create the BitSets first (after reset), then the info so both
    // share the same allocator state and bit indices don't collide.
    infantryCC = new BitSet<CrushClass>(CRUSH_CLASS_TYPENAME, 'infantry')
    vehicleCC = new BitSet<CrushClass>(CRUSH_CLASS_TYPENAME, 'vehicle')
    info = new TransformCrusherOnCrushInfo({ intoActor: 'e3', crushClasses: ['infantry'] })
    trait = new TransformCrusherOnCrush(info, 'allies')
  })

  afterEach(() => {
    trait.dispose()
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  it('stores info reference', () => {
    expect(trait.info).toBe(info)
  })

  it('stores faction string', () => {
    expect(trait['_faction']).toBe('allies')
  })

  describe('warnCrush', () => {
    it('is a no-op', () => {
      expect(() => {
        trait.warnCrush(
          { actorId: 1, isInWorld: true, isDead: false, disposed: false } as any,
          { actorId: 2, isInWorld: true, isDead: false, disposed: false } as any,
          infantryCC as any,
        )
      }).not.toThrow()
    })
  })

  describe('onCrush', () => {
    it('does nothing when crush classes do not overlap', () => {
      let created = false
      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: {
          createActor: () => { created = true },
        },
      }
      const crusher = {
        actorId: 2,
        isInWorld: true,
        isDead: false,
        disposed: false,
      }

      trait.onCrush(self as any, crusher as any, vehicleCC as any)
      expect(created).toBe(false)
    })

    it('triggers actor creation when crush classes overlap', () => {
      let createdName = ''
      let createdInit: Map<string, unknown> | undefined

      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: {
          createActor: (name: string, init?: Map<string, unknown>) => {
            createdName = name
            createdInit = init
          },
        },
      }
      const crusher = {
        actorId: 2,
        isInWorld: true,
        isDead: false,
        disposed: false,
        traitOrDefault: () => null,
      }

      trait.onCrush(self as any, crusher as any, infantryCC as any)
      expect(createdName).toBe('e3')
      expect(createdInit?.get('faction')).toBe('allies')
    })

    it('does nothing when intoActor is empty', () => {
      const info2 = new TransformCrusherOnCrushInfo({ crushClasses: ['infantry'] })
      const trait2 = new TransformCrusherOnCrush(info2, 'allies')

      let created = false
      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: { createActor: () => { created = true } },
      }
      const crusher = {
        actorId: 2,
        isInWorld: true,
        isDead: false,
        disposed: false,
      }

      trait2.onCrush(self as any, crusher as any, infantryCC as any)
      expect(created).toBe(false)
      trait2.dispose()
    })

    it('preserves facing when crusher has IFacing', () => {
      const createdInits: Map<string, unknown>[] = []
      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: {
          createActor: (_name: string, init?: Map<string, unknown>) => {
            createdInits.push(init!)
          },
        },
      }
      const crusher = {
        actorId: 2,
        isInWorld: true,
        isDead: false,
        disposed: false,
        traitOrDefault: (tag: string) => {
          if (tag === 'IFacing') return { facing: 128 }
          return null
        },
      }

      trait.onCrush(self as any, crusher as any, infantryCC as any)
      expect(createdInits.length).toBe(1)
      expect(createdInits[0].get('facing')).toBe(128)
    })

    it('defaults to empty faction when not specified', () => {
      const trait2 = new TransformCrusherOnCrush(info)

      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: {
          createActor: (_name: string, _init?: Map<string, unknown>) => {
            // no-op
          },
        },
      }
      const crusher = {
        actorId: 2,
        isInWorld: true,
        isDead: false,
        disposed: false,
        traitOrDefault: () => null,
      }

      expect(() => trait2.onCrush(self as any, crusher as any, infantryCC as any)).not.toThrow()
      trait2.dispose()
    })
  })
})
